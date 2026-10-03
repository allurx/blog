---
title: "If-Match 如何阻止并发编辑相互覆盖"
date: 2026-09-16
updated: 2026-10-03
domain: "Web"
tags: ["HTTP","ETag","乐观并发控制"]
---

两个人先后保存同一篇文档，不需要真正同时执行，也可能发生丢失更新。A、B 都读到版本 7，A 改完标题后保存；B 一分钟后仍把旧页面整篇提交，A 的标题就被覆盖了。

`If-Match` 可以让 B 表达“只有资源仍是我读到的版本，才接受这次保存”。有效保护还要求服务端把版本比较和写入做成一个原子动作：先查版本，再普通更新，仍然留下竞争窗口。它负责拒绝过期提交，合并冲突则由客户端与业务规则决定。

本文采用 RFC 9110 和 RFC 6585 的 HTTP 语义，Java 示例演示单 JVM 内的条件替换；多实例服务应把原子条件放到共同的数据存储中。

## 用强 ETag 表达读取时的版本

ETag 是服务器为某个资源表示生成的、不透明的验证器。客户端保存读取响应中的 ETag，在修改时原样带回；不应自行拆解其中的版本数字。它既能用于缓存验证，也能用于防止覆盖，并不要求一定是内容哈希。[MDN：ETag](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag)

例如服务器返回 `ETag: "doc-7"`，编辑保存时发送 `If-Match: "doc-7"`。引号属于字段值语法，不应丢掉。`If-Match` 使用强比较：弱标签 `W/"doc-7"` 不会与强标签匹配；`*` 只要求存在当前表示，不能证明它还是用户读取的版本。[MDN：If-Match](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match)

带上具体版本后，两次编辑形成如下提交顺序：

| 顺序 | 操作 | 结果 |
| --- | --- | --- |
| 1 | A、B 都读取文档 | 都获得 `"doc-7"` |
| 2 | A 携带 `If-Match: "doc-7"` 保存 | 原子替换成功，版本变为 8 |
| 3 | B 仍携带 `If-Match: "doc-7"` 保存 | 前置条件不满足，不覆盖 A 的结果 |
| 4 | B 获取当前版本并查看差异 | 合并后，基于新版本再次提交 |

在普通的编辑冲突路径中，前置条件不满足返回 `412 Precondition Failed`。它不表示服务器已接纳修改，更不应被客户端转成一次无条件重试。[MDN：412](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/412)

## 把版本比较放进提交点

**危险点是检查与使用之间的间隙。** 假设两个请求都先读到版本 7，分别执行 `if (version == 7)`；只要写入是后续独立动作，它们就都可能通过，最后写入者仍覆盖前者。给接口加 ETag 但保留这种执行结构，只改变了协议外观。

正确实现应有一个“只有旧状态仍匹配才替换”的提交点。在单进程内可以用同一把锁覆盖检查和写入，或对不可变快照执行 CAS。`AtomicReference.compareAndSet` 按引用身份比较，并原子地完成条件替换。[Java AtomicReference](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html#compareAndSet(V,V))

下面代码先比较标签，再 CAS 整个快照；如果比较后另一个请求已经提交，CAS 会失败。本例每次成功都产生新对象并递增版本，不复用旧快照，因此不能把失败后的旧修改直接套到新状态上循环重试。

对于数据库实现，对应设计通常是一次带条件的更新：条件同时包含资源 ID 和预期版本，写入时递增版本，再依据影响行数判断是否成功。这里描述的是设计形态，未提供或运行特定数据库 SQL。真实实现还要区分资源不存在、权限不允许和版本不匹配，并确保其他写入路径也遵循同一版本规则。

## 两个旧版本提交只能成功一个

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

## 让整个编辑流程尊重版本

- **读响应的内容与标签来自同一个快照。** 不要先查询内容，再独立查询版本，否则客户端可能得到“旧内容、新标签”，携带看似有效的标签提交过期数据。
- **所有表示变化都必须被验证器覆盖。** 若用行版本生成强 ETag，应确保相关内容变化都会推进版本；序列化规则、语言或压缩表示变化也要考虑。不同表示共用同一标签前必须验证其强一致性条件。[RFC 9110 §8.8.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1)
- **版本不能因重启或删除重建而复用。** 本例从 1 开始仅适合一次内存实验。持久服务应保存版本，必要时加入资源世代标识，避免旧客户端的标签意外命中新对象。
- **要求带条件，就明确拒绝缺失条件的请求。** 可使用 `428 Precondition Required` 并说明如何重新提交；它与“条件已给出但不匹配”的 412 不同。[RFC 6585 §3](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)
- **保留冲突现场。** 客户端保留用户未保存内容，重新读取当前版本，展示差异或按领域规则合并。自动改用最新 ETag 重发旧全文，会绕过原本要保护的用户意图。

乐观方案避免在用户编辑期间持有服务端锁，适合冲突相对少、能够重做或合并的编辑操作。若冲突频繁，频繁读取和重试会增加成本；此时应考虑缩小更新粒度或把业务操作表达为可验证命令，而不是不断提高重试次数。这是工程取舍，不是 HTTP 协议替应用作出的选择。

`412` 也不能证明此前的一次请求没有成功：如果首次保存成功、响应丢失，携带旧标签重试可能得到 412。结果查询或独立的操作幂等机制解决这类不确定性。PATCH 同样不会自动消除对同一字段的过期修改。
