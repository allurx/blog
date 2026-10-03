---
title: "If-Match 如何阻止并发编辑相互覆盖"
date: 2026-09-16
updated: 2026-10-03
domain: "Web"
tags: ["HTTP","ETag","乐观并发控制"]
---

两个人先后保存同一篇文档，不需要真正同时执行，也可能发生丢失更新。A、B 都读到版本 7，A 改完标题后保存；B 一分钟后仍把旧页面整篇提交，A 的标题就被覆盖了。

要保住 A 的标题，B 保存时需要附上一个条件：“这份文档仍然是我打开时的版本。”HTTP 的 `If-Match` 正好表达这个条件。服务端发现版本已经变化，就拒绝覆盖，让 B 有机会比较两份修改。

条件放进请求只是第一步。服务端还必须把版本比较与写入合成一个原子动作，否则两个请求仍可能先后通过检查，再相互覆盖。下面从这两层配合解释一次完整保存。

本文采用 RFC 9110 和 RFC 6585 的 HTTP 语义，Java 示例演示单 JVM 内的条件替换；多实例服务应把原子条件放到共同的数据存储中。

## 让保存请求带上读取时的版本

### ETag 是客户端应当原样保留的验证器

ETag 是服务器为某个资源表示生成的、不透明的验证器。客户端保存读取响应中的 ETag，在修改时原样带回；不应自行拆解其中的版本数字。它既能用于缓存验证，也能用于防止覆盖，并不要求一定是内容哈希。[MDN：ETag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag)

例如服务器返回 `ETag: "doc-7"`，编辑保存时发送 `If-Match: "doc-7"`。引号属于字段值语法，不应丢掉。`If-Match` 使用强比较：弱标签 `W/"doc-7"` 不会与强标签匹配；`*` 只要求存在当前表示，不能证明它还是用户读取的版本。[MDN：If-Match](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match)

### A 保存成功后，B 的旧标签不再匹配

带上具体版本后，两次编辑形成如下提交顺序：

| 顺序 | 操作 | 结果 |
| --- | --- | --- |
| 1 | A、B 都读取文档 | 都获得 `"doc-7"` |
| 2 | A 携带 `If-Match: "doc-7"` 保存 | 原子替换成功，版本变为 8 |
| 3 | B 仍携带 `If-Match: "doc-7"` 保存 | 前置条件不满足，不覆盖 A 的结果 |
| 4 | B 获取当前版本并查看差异 | 合并后，基于新版本再次提交 |

在普通的编辑冲突路径中，前置条件不满足返回 `412 Precondition Failed`。它不表示服务器已接纳修改，更不应被客户端转成一次无条件重试。[MDN：412](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/412)

## 服务端怎样让条件真正生效

### 先查后改仍然留下竞争窗口

**危险点是检查与使用之间的间隙。** 假设两个请求都先读到版本 7，分别执行 `if (version == 7)`；只要写入是后续独立动作，它们就都可能通过，最后写入者仍覆盖前者。给接口加 ETag 但保留这种执行结构，只改变了协议外观。

正确实现应有一个“只有旧状态仍匹配才替换”的提交点。在单进程内可以用同一把锁覆盖检查和写入，或对不可变快照执行 CAS。`AtomicReference.compareAndSet` 按引用身份比较，并原子地完成条件替换。[Java AtomicReference](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html#compareAndSet(V,V))

### 用一次 CAS 竞争同一份快照

下面代码先比较标签，再 CAS 整个快照；如果比较后另一个请求已经提交，CAS 会失败。本例每次成功都产生新对象并递增版本，不复用旧快照，因此不能把失败后的旧修改直接套到新状态上循环重试。

对于数据库实现，对应设计通常是一次带条件的更新：条件同时包含资源 ID 和预期版本，写入时递增版本，再依据影响行数判断是否成功。这里描述的是设计形态，未提供或运行特定数据库 SQL。真实实现还要区分资源不存在、权限不允许和版本不匹配，并确保其他写入路径也遵循同一版本规则。

### 运行两个旧版本提交的竞争示例

示例以 JDK 25 LTS 为基线，只依赖标准库。保存为 `ConditionalUpdateDemo.java`，运行 `java ConditionalUpdateDemo.java`。两个线程持有同一个旧标签，竞争替换同一份文档，断言恰有一个成功。

这是条件写入核心的可执行实验，**不是完整 HTTP 服务**。协议适配层应先完成鉴权、请求体校验及标准字段解析；此方法只接收一个具体强 ETag，不处理标签列表、通配符、缺失请求头、资源删除或响应头。完整端点不能把它直接当作通用 `If-Match` 解析器。

```java
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class ConditionalUpdateDemo {
    record Document(long version, String text) {
        String etag() { return "\"doc-" + version + "\""; }
    }

    private final AtomicReference<Document> state =
            new AtomicReference<>(new Document(1, "draft"));

    Document read() { return state.get(); }

    // 协议适配层已完成鉴权和语法解析；此处只接收一个具体的强 ETag。
    int replace(String expectedTag, String text) {
        Objects.requireNonNull(text);
        Document before = state.get();
        if (!before.etag().equals(expectedTag)) return 412;
        Document after = new Document(Math.incrementExact(before.version()), text);
        // 比较的是同一个不可变快照引用；绝不能改成先 get 再无条件 set。
        return state.compareAndSet(before, after) ? 204 : 412;
    }

    public static void main(String[] args) throws InterruptedException {
        ConditionalUpdateDemo service = new ConditionalUpdateDemo();
        String sharedTag = service.read().etag();
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger success = new AtomicInteger();
        AtomicInteger conflict = new AtomicInteger();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Runnable edit = () -> {
            try {
                start.await();
                int status = service.replace(sharedTag, Thread.currentThread().getName());
                if (status == 204) success.incrementAndGet();
                else if (status == 412) conflict.incrementAndGet();
                else throw new AssertionError(status);
            } catch (Throwable ex) {
                failure.compareAndSet(null, ex);
            }
        };
        Thread a = new Thread(edit, "edit-A");
        Thread b = new Thread(edit, "edit-B");
        a.start();
        b.start();
        start.countDown();
        a.join();
        b.join();
        if (failure.get() != null) throw new AssertionError(failure.get());
        if (success.get() != 1 || conflict.get() != 1 || service.read().version() != 2)
            throw new AssertionError("lost-update protection failed");
        System.out.printf("success=%d conflict=%d version=%d%n",
                success.get(), conflict.get(), service.read().version());
    }
}
```

在 Windows、Oracle JDK 25.0.2 LTS 下执行源文件，输出为 `success=1 conflict=1 version=2`。闩锁提供竞争起点，不保证两次调用都走到 CAS；其中一个也可能在标签检查时就失败。HTTP 字段解析与数据库条件提交需要各自的集成测试。

## 冲突发生后，怎样继续编辑

### 从读取到再次保存，都保留版本关系

B 收到 412 后，页面应保留他未保存的正文，同时重新取得当前文档。B 看见 A 修改的标题，再决定怎样合并。只有这一步完成后，才应该携带新标签提交；自动换成最新 ETag 重发旧全文，会再次抹掉 A 的工作。

这条流程的起点也需要一致：响应的内容和 ETag 必须来自同一个快照。若先查内容、再独立查版本，客户端可能得到“旧内容、新标签”，看似合法的条件就保护不了它。

### 强标签必须确实对应当前表示

若用行版本生成强 ETag，应确保相关内容变化都会推进版本。序列化规则、语言或压缩方式改变了表示时，也需要考虑标签是否仍满足强比较要求。[RFC 9110 §8.8.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1)

版本也不能因重启或删除重建而被随意复用。本例从 1 开始只适合一次内存实验；持久服务应保存版本，必要时加入资源世代标识，避免旧文档的标签意外命中后来创建的新文档。

### 缺少条件、条件失败与结果未知分别处理

要求条件保存的接口，需要拒绝未提供条件的请求。可使用 `428 Precondition Required` 并说明怎样重新提交；它与“条件已给出但不匹配”的 412 不同。[RFC 6585 §3](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)

还有一种情况：首次保存成功，响应却丢失了。客户端携带旧标签重试，也可能收到 412。这个响应只能说明本次条件不成立，不能单独证明上一次没有保存；需要查询结果或使用独立的操作幂等机制，才能消除这项不确定性。

## 冲突频率决定编辑方式是否合适

乐观方案让用户编辑期间无需持有服务端锁，适合冲突较少、能够重新比较或合并的操作。回到 A 改标题、B 改正文的例子，如果接口能够按字段表达各自的修改，冲突处理可能比提交整篇文档更清楚。

不过，PATCH 或缩小请求体本身不保证并发安全。两个人都改标题时，仍然需要版本条件或明确的业务合并规则。若冲突经常发生，应重新考虑更新粒度和编辑方式，而不是让客户端不断换最新标签重试。
