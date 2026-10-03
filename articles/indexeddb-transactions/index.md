---
title: "IndexedDB 事务为什么会在 await 之后失效"
date: "2026-09-12"
updated: 2026-10-03
domain: "Web"
tags: ["IndexedDB", "事务", "异步编程"]
---

电子书导入先创建 IndexedDB 事务，再等待文件读取或远程元数据，最后调用 `put()`，很容易在最后一步收到事务失效错误。变量 `tx` 还活着，只能证明 JavaScript 对象仍可访问，不能证明数据库仍接受新请求。

正确的划分通常是先准备文件和网络数据，再用短事务完成数据库读写；业务成功应以整个事务的 `complete` 事件为准。本文使用浏览器原生 IndexedDB 和 TypeScript，生命周期说明以 IndexedDB 2.0 Recommendation 为基线，并区分规范契约与浏览器中的实际验证。[IndexedDB 2.0 事务生命周期](https://www.w3.org/TR/IndexedDB-2/#transaction-lifetime)

## async 函数不是事务的保活范围

JavaScript 引用的存活期，与数据库事务可接受请求的时间窗口，是两个独立概念。

事务创建时可添加请求；其关联请求派发结果事件时，也有继续添加请求的机会。其他时候事务可能处于 inactive。已有请求及结果处理结束、没有新请求且事务未中止时，浏览器尝试提交；提交或中止后，旧事务不能复用。[W3C 生命周期算法](https://www.w3.org/TR/IndexedDB-2/#transaction-lifetime)

因此，关键不是源码是否还在同一个函数内，而是下一次数据库操作发生时，事务是否仍允许接收请求。

常见失败路径是：创建事务 → 发出一条写请求 → 等待网络 → 写请求完成且没有后续数据库工作 → 自动提交 → 网络返回 → 再次写入失败。

`await` 会暂停当前函数，但不会要求 IndexedDB 等待它。`idb` 文档明确区分了等待事务自己的 `get()`/`put()`，以及在中途等待 `fetch()` 的结果；前一种可以形成连续数据库操作，后一种会留下事务提前结束的窗口。原生 `IDBRequest` 本身也不是 Promise，直接 `await store.put(...)` 不会等待请求成功。[idb Promise 与事务说明](https://github.com/jakearchibald/idb#transaction-lifetime)

inactive 不等于已经提交，但同样不能添加请求；不要仅根据某一次错误文案推断全部状态。[3.0 状态定义](https://w3c.github.io/IndexedDB/#transaction-lifecycle)

下面的流程只说明失效窗口，不应作为写入实现：

```typescript
const tx = db.transaction("book", "readwrite");
const store = tx.objectStore("book");
store.put(firstBook);

await fetchMetadata();
store.put(secondBook); // 此时可能已经 inactive 或完成
```

等待数据库请求自身的 Promise 与等待网络不是同一个边界，但原生 `IDBRequest` 也不是 Promise。引入包装库时，应采用它对事务生命周期的明确契约，而不是认为任意 `await` 都会延长事务。

## 在一个短事务里保存已准备的数据

运行前提：浏览器已打开数据库 `db`，其中存在 `book` store，`keyPath` 为 `id`。代码以 TypeScript 7.0.2、`strict`、ES2023 与 DOM 类型为基线；接口传入已完成准备的书籍，不在事务内部读取文件或联网。这是接入已有应用的片段，数据库的创建、升级和关闭由调用方管理。

```ts
type Book = Readonly<{
  id: string;
  title: string;
  content: string;
}>;

function saveBooks(db: IDBDatabase, books: readonly Book[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("book", "readwrite");

    // 整批写入以事务完成为准，不以某一条请求成功为准。
    tx.addEventListener("complete", () => resolve(), { once: true });
    tx.addEventListener(
      "abort",
      () => reject(tx.error ?? new DOMException("事务已中止", "AbortError")),
      { once: true },
    );

    try {
      const store = tx.objectStore("book");
      for (const book of books) {
        store.put(book);
      }
    } catch (error: unknown) {
      // 同步入队失败时，先前已提交给事务的写入也必须回滚。
      try {
        tx.abort();
      } finally {
        reject(error);
      }
    }
  });
}

async function importText(db: IDBDatabase, file: File): Promise<void> {
  const content = await file.text();
  const book: Book = {
    id: crypto.randomUUID(),
    title: file.name,
    content,
  };
  await saveBooks(db, [book]);
}
```

这里所有写请求同步入队；同步入队异常触发主动中止，异步请求错误采用默认的事务中止行为，不调用 `preventDefault()`。Promise 仅在整个事务完成时成功。`crypto.randomUUID()` 需要支持该 API 的安全上下文；示例每次生成新 ID，不实现重复导入去重。

## 用完成与回滚事件验证整批结果

将代码保存为 `save-books.ts`，在 TypeScript 7.0.2 环境执行 `tsc --ignoreConfig save-books.ts --strict --target ES2023 --lib ES2023,DOM --noEmit` 可检查类型。事务行为还需要浏览器验证，类型检查本身不能证明请求提交或回滚正确。

打开[可直接运行的浏览器实验](./transaction-demo.html)，点击“运行三个事务场景”，即可复现下面的输入与读回结果。页面包含由上述 TypeScript 生成的 JavaScript，以及建库、唯一索引、异常输入、读回和清理过程；不依赖第三方库。也可以保存这个 HTML，通过自己的 localhost 或 HTTPS 服务打开。每次运行使用新的临时数据库，不读取已有应用数据。

本例在 Windows、Chromium 154.0.8037.93 的本机 HTTP 安全上下文中验证。每个场景使用独立数据库，创建 `book` store 和 `title` 唯一索引，操作完成后再用新事务读取记录数：

| 输入场景 | Promise 结果 | 后续事务读到的记录数 |
| --- | --- | --- |
| 两条不同 ID、不同标题的有效书籍 | 在事务完成后成功 | 2 |
| 两条不同 ID、相同标题的书籍，触发唯一索引冲突 | 异步失败，整批回滚 | 0 |
| 第二条书籍包含函数值，不能被结构化克隆 | 同步入队失败，主动中止 | 0 |

第三种输入是刻意绕过 TypeScript 类型检查的异常数据，用来检查 JavaScript 调用方或未经校验的外部值进入时的失败路径；不是合法的 `Book`。三个场景连续重复执行得到相同结果。实验确认了该 Chromium 版本中的事务边界，没有据此声称 Firefox、Safari、所有设备或断电场景也已验证。

## 数据准备与一致性检查不能混为一谈

文件解析、解压和远程请求适合在事务外完成；依赖数据库当前状态的判断则应和更新处在同一个读写事务中。例如，先读取一条记录的版本，再等待服务器返回结果，期间另一个标签页可能已修改它。重新进入事务后应核验版本，再决定应用结果或报告冲突。

只在事务外预先读取业务状态，会把“事务太早结束”的问题换成“基于旧数据覆盖新值”。边界应同时满足生命周期和并发一致性，而不是把所有读取机械挪到前面。

## 完成事件、错误与批量大小

单条请求 `success` 后，后续请求、唯一索引约束或最终提交仍可能失败。`saveBooks()` 只在 `complete` 时成功，异步请求错误沿默认路径中止事务；同步 `put()` 入队失败时主动 `abort()`，以免前面成功入队的部分写入独自提交。

`Promise.all()` 只能组合异步结果，不能给一个 inactive 或已完成的事务续期。无论采用回调还是 Promise，保存提示都应在整批事务成功后显示。

大量书籍一次写入会增加事务占用时间；分批则降低单次负担，但批次之间不再原子。需要分批导入时，可在数据模型中区分“准备中”和“可用”，在全部批次完成后再对读者开放，并在恢复时识别未完成记录。这是应用层生命周期，不是 IndexedDB 自动提供的行为。

`complete` 也不等同于所有浏览器、设备和断电条件下都绝不会丢失数据。持久化提示、浏览器存储管理和备份策略是另一组约束；不要将它们和请求能否继续入队混为一谈。[IndexedDB 事务持久化提示](https://w3c.github.io/IndexedDB/#transaction-durability-hint)
