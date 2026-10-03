---
title: "try-with-resources 为什么不会让 close 异常覆盖主异常"
date: 2026-09-28
updated: 2026-10-03
domain: "Java"
tags: ["Java","TryWithResources","SuppressedExceptions"]
---

业务代码先抛异常，`finally` 中的 `close()` 又失败。如果直接让关闭异常向外抛，原来的业务失败可能被覆盖。try-with-resources 会为这两类失败保留层次：业务异常继续作为主异常，关闭失败加入它的 suppressed 列表。

如果业务代码正常结束，最先失败的关闭操作成为主异常；多资源按声明逆序关闭，后续关闭失败继续附加。理解这个次序，才能解释日志中的 `Suppressed:`，也才能避免在异常包装时把有用的故障信息丢掉。

## 初始化和关闭的次序决定异常归属

[Java 语言规范 §14.20.3](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.20.3)规定：资源从左到右初始化、按相反顺序关闭；一个关闭失败不会阻止其他资源继续关闭。

异常选择遵循“先发生者为主”的因果顺序：

- `try` 块先抛出异常：它是主异常，所有关闭异常都被抑制。
- `try` 块正常：按逆序关闭，第一个失败的关闭操作提供主异常，后续关闭异常被抑制；如果所有关闭都成功，就没有异常。
- 某个资源初始化失败：已成功初始化的资源仍会逆序关闭；其关闭异常附加到初始化异常。

`Throwable.getSuppressed()` 返回这些被抑制的异常；它们不同于 `getCause()` 表示的显式因果链。该 API 自 Java 7 提供，[Java SE 25 API 文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html#getSuppressed())说明返回顺序就是异常被抑制的顺序。

## 主异常由语句语义保存，不由 close 保存

语言规范把单资源 try-with-resources 描述为类似以下结构的翻译：先保存主异常；`finally` 中调用 `close()`；若已有主异常，则调用 `primary.addSuppressed(closeFailure)`，否则让关闭异常直接向外传播。多资源语句等价于嵌套这个结构，所以自然形成逆序关闭。

这不是 `AutoCloseable` 接口自行完成的。接口只约定 `close()`；异常的主次组织由 try-with-resources 语句负责。[`AutoCloseable` 文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html)也提醒实现者不应依赖“异常一定会被抑制”，因为调用者可能手工调用 `close()`。

## 对照业务失败、正常返回与初始化失败

保存为 `SuppressedExceptionDemo.java`，使用 JDK 25 LTS 执行 `java SuppressedExceptionDemo.java`，无需第三方依赖。前两组让两个资源的 `close()` 都抛异常，分别观察业务失败和正常返回；第三组在第二个资源初始化时抛异常，检查已经打开的第一个资源如何关闭：

```java
import java.util.Arrays;

public final class SuppressedExceptionDemo {
    record FailingResource(String name) implements AutoCloseable {
        public void close() {
            System.out.println("closing " + name);
            throw new IllegalStateException("close-" + name);
        }
    }

    private static void report(Exception primary, String expectedPrimary,
                               String... expectedSuppressed) {
        String[] suppressed = Arrays.stream(primary.getSuppressed())
                .map(Throwable::getMessage).toArray(String[]::new);
        if (!primary.getMessage().equals(expectedPrimary)
                || !Arrays.equals(suppressed, expectedSuppressed)) {
            throw new AssertionError("exception order", primary);
        }
        System.out.println("primary=" + primary.getMessage());
        System.out.println("suppressed=" + Arrays.toString(suppressed));
    }

    private static void run(boolean failBody) {
        try (var first = new FailingResource("first");
             var second = new FailingResource("second")) {
            if (failBody) throw new IllegalArgumentException("body");
        } catch (Exception primary) {
            if (failBody) report(primary, "body", "close-second", "close-first");
            else report(primary, "close-second", "close-first");
        }
    }

    private static FailingResource openSecond() {
        throw new IllegalStateException("init-second");
    }

    private static void initializationFailure() {
        try (var first = new FailingResource("first");
             var second = openSecond()) {
            throw new AssertionError("initialization should have failed");
        } catch (Exception primary) {
            report(primary, "init-second", "close-first");
        }
    }

    public static void main(String[] args) {
        run(true);
        run(false);
        initializationFailure();
    }
}
```

三组检查已在 Windows、Oracle JDK 25.0.2 LTS 下按上述命令运行通过。程序既打印关闭过程，也检查异常消息及 suppressed 的顺序：

| 场景 | 关闭顺序 | 主异常消息 | suppressed 消息 |
| --- | --- | --- | --- |
| 业务代码失败 | second、first | `body` | `close-second`、`close-first` |
| 业务代码正常返回 | second、first | `close-second` | `close-first` |
| second 初始化失败 | 只有 first | `init-second` | `close-first` |

第三组没有成功创建 second，因此不会调用它的 `close()`；first 已经创建，仍必须关闭。这解释了为什么初始化失败不能简单理解为“还没进 try 块，所以无需清理”。

## 保留完整异常图，而不只保存消息

- 日志框架应接收完整的 `Throwable`，不要只记录 `getMessage()`；标准堆栈输出会显示 `Suppressed:` 段。
- 监控若按异常类型聚合，只看主异常可能漏掉磁盘刷写、网络连接关闭等清理故障；可单独统计 suppressed 类型和数量。
- `close()` 尽量短小、避免产生次生故障，但不要静默吞掉影响完整性的失败。`AutoCloseable` 不强制幂等，`Closeable` 才有重复关闭无效的契约；自定义资源要说明是否允许重复调用，不能把偏好写成接口保证。
- 自定义异常包装时保留原异常对象；重新创建只有消息的异常会丢失其 cause、suppressed 和堆栈。

这些例子使用默认启用 suppression 的异常。自定义 `Throwable` 可以关闭该能力，此时 `addSuppressed()` 不保存异常；资源也不应反复抛同一个异常对象，避免试图把异常抑制到自身。语言规则组织的是异常对象，不能保证任意错误的 `close()` 实现都保留完整诊断。[`Throwable.addSuppressed`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html#addSuppressed(java.lang.Throwable))
