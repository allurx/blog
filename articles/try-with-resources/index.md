---
title: "try-with-resources 为什么不会让 close 异常覆盖主异常"
date: 2026-09-28
updated: 2026-10-03
domain: "Java"
tags: ["Java","TryWithResources","SuppressedExceptions"]
---

业务代码先抛异常，`finally` 中的 `close()` 又失败。如果直接让关闭异常向外抛，原来的业务失败可能被覆盖。try-with-resources 会为这两类失败保留层次：业务异常继续作为主异常，关闭失败加入它的 suppressed 列表。

例如，一次文件处理同时打开输入和输出资源：转换内容时失败，关闭输出文件时又遇到写入错误。排查需要知道这两件事，而不只是最后一次失败。try-with-resources 会把它们组织在同一个异常对象上；下面用两个故意关闭失败的资源，看清谁成为主异常、其余异常放在哪里。

## 先看资源顺序，再判断异常归属

### 初始化从左到右，关闭从右到左

[Java 语言规范 §14.20.3](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.20.3)规定：资源从左到右初始化、按相反顺序关闭；一个关闭失败不会阻止其他资源继续关闭。

异常选择遵循“先发生者为主”的因果顺序：

- `try` 块先抛出异常：它是主异常，所有关闭异常都被抑制。
- `try` 块正常：按逆序关闭，第一个失败的关闭操作提供主异常，后续关闭异常被抑制；如果所有关闭都成功，就没有异常。
- 某个资源初始化失败：已成功初始化的资源仍会逆序关闭；其关闭异常附加到初始化异常。

`Throwable.getSuppressed()` 返回这些被抑制的异常；它们不同于 `getCause()` 表示的显式因果链。该 API 自 Java 7 提供，[Java SE 25 API 文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html#getSuppressed())说明返回顺序就是异常被抑制的顺序。

### 语言怎样同时保存两次失败

语言规范把单资源 try-with-resources 描述为类似以下结构的翻译：先保存主异常；`finally` 中调用 `close()`；若已有主异常，则调用 `primary.addSuppressed(closeFailure)`，否则让关闭异常直接向外传播。多资源语句等价于嵌套这个结构，所以自然形成逆序关闭。

这不是 `AutoCloseable` 接口自行完成的。接口只约定 `close()`；异常的主次组织由 try-with-resources 语句负责。[`AutoCloseable` 文档](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html)也提醒实现者不应依赖“异常一定会被抑制”，因为调用者可能手工调用 `close()`。

## 对照业务失败、正常返回与初始化失败

### 让每个关闭操作都报告自己的名字

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

### 比较三条失败路径

三组检查已在 Windows、Oracle JDK 25.0.2 LTS 下按上述命令运行通过。程序既打印关闭过程，也检查异常消息及 suppressed 的顺序：

| 场景 | 关闭顺序 | 主异常消息 | suppressed 消息 |
| --- | --- | --- | --- |
| 业务代码失败 | second、first | `body` | `close-second`、`close-first` |
| 业务代码正常返回 | second、first | `close-second` | `close-first` |
| second 初始化失败 | 只有 first | `init-second` | `close-first` |

第三组没有成功创建 second，因此不会调用它的 `close()`；first 已经创建，仍必须关闭。这解释了为什么初始化失败不能简单理解为“还没进 try 块，所以无需清理”。

## 让日志保留这些失败的关系

记录日志时把完整的 `Throwable` 交给日志框架，标准堆栈会显示 `Suppressed:` 段。如果只保存 `getMessage()`，前面的例子就只剩 `body`，输出资源关闭失败的线索随之消失。包装异常时也应保留原异常作为 cause，让其中的 suppressed 列表仍可访问。

关闭失败可能涉及缓冲区刷写或连接收尾，值得按业务影响观察，不能因为它被标为 suppressed 就当作无关信息。这个名称表示主次关系，没有降低错误本身的严重性。

实现自定义资源时，还要说明能否重复关闭。`AutoCloseable` 本身没有强制幂等；`Closeable` 才约定对已关闭资源再次调用无效。调用方式和接口契约应当配套。

这些例子使用默认启用 suppression 的异常。自定义 `Throwable` 可以关闭该能力，此时 `addSuppressed()` 不保存异常；资源也不应反复抛同一个异常对象，避免试图把异常抑制到自身。语言规则组织的是异常对象，不能保证任意错误的 `close()` 实现都保留完整诊断。[`Throwable.addSuppressed`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html#addSuppressed(java.lang.Throwable))
