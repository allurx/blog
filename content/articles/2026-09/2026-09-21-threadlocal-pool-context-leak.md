---
title: "线程池里的 ThreadLocal 为什么必须清理"
date: 2026-09-21
updated: 2026-10-01
id: 2026-09-21-threadlocal-pool-context-leak
domain: "Java 并发"
tags: ["ThreadLocal","线程池","上下文泄漏"]
---

固定线程池里，第一个任务设置 `userId=alice`，第二个任务没有设置用户，却读到了 alice。线程池没有把请求混在一起；被复用的是 worker，而 `ThreadLocal` 的值恰好属于这个 worker，并不属于上一次任务。

因此上下文的设置与清理必须覆盖一次请求或任务的完整生命周期。把 `remove()` 放进 worker 自己执行的 `finally`，才能覆盖异常与提前返回；由提交任务的线程清理，删掉的只是提交者自己的值。以下针对平台线程池与普通 `ThreadLocal`。

## 任务结束不等于线程结束

每个访问 `ThreadLocal` 的线程都有自己的值副本。官方文档指出，只要线程仍存活且 `ThreadLocal` 实例仍可访问，线程就隐式持有这个副本。普通短命线程退出后，副本可以随线程回收；线程池 worker 则可能服务整个应用生命周期，因此“任务结束”不会触发 ThreadLocal 自动清理。[`ThreadLocal` 生命周期](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/ThreadLocal.html)

单线程池让问题最容易观察：任务 A 和任务 B 都在同一个 worker 上执行。A 调用 `set("alice")` 后退出，worker 仍然存在；B 调用 `get()`，读取的就是这个 worker 的旧副本，而不是“任务 B 的新副本”。

## 清理必须发生在使用上下文的线程

`remove()` 只删除**当前执行线程**中该 `ThreadLocal` 的值，因此必须由真正使用上下文的 worker 在任务结束时调用。提交任务的线程提前调用 `remove()`，清理的是提交者自己的副本，对工作线程没有作用。

可靠的任务边界是：

```java
CURRENT_USER.set(userId);
try {
    handleRequest();
} finally {
    CURRENT_USER.remove();
}
```

`ThreadPoolExecutor` 还提供 `beforeExecute`、`afterExecute` 钩子，可用于重置 ThreadLocal 等执行环境；但业务通常不应通过自定义线程池猜测所有库使用了哪些上下文。更稳妥的做法是在请求过滤器、拦截器或任务包装器中，使用对应框架提供的设置和清理 API。[`ThreadPoolExecutor` 钩子](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)

## 用单线程池观察前一个任务的残留

保存为 `ThreadLocalLeakDemo.java`，使用 Java 17+ 执行 `java ThreadLocalLeakDemo.java`。单个 worker 保证后续任务复用同一线程，`Future.get()` 保证先后关系；最后一组故意在任务里抛异常，检查 `finally` 仍清除了上下文。

```java
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class ThreadLocalLeakDemo {
    private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

    private static Runnable withUser(String user, Runnable task) {
        return () -> {
            CURRENT_USER.set(user);
            try {
                task.run();
            } finally {
                CURRENT_USER.remove();
            }
        };
    }

    public static void main(String[] args) throws Exception {
        var pool = Executors.newSingleThreadExecutor();
        try {
            pool.submit(() -> CURRENT_USER.set("alice")).get();
            String leaked = pool.submit(CURRENT_USER::get).get();
            if (!"alice".equals(leaked)) throw new AssertionError("expected leak");
            System.out.println("without cleanup: " + leaked);

            try {
                pool.submit(withUser("bob", () -> {
                    System.out.println("inside guarded task: " + CURRENT_USER.get());
                    throw new IllegalStateException("task failed");
                })).get();
                throw new AssertionError("expected task failure");
            } catch (ExecutionException expected) {
                if (!(expected.getCause() instanceof IllegalStateException)) throw expected;
            }
            String after = pool.submit(CURRENT_USER::get).get();
            if (after != null) throw new AssertionError("context not cleared");
            System.out.println("after finally/remove: " + after);
        } finally {
            pool.shutdownNow();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) throw new AssertionError("shutdown");
        }
    }
}
```

2026-10-01 修订时，使用 JDK 25.0.2 的 `javac --release 17` 编译并运行，得到以下输出，代码中的检查均通过：

```text
without cleanup: alice
inside guarded task: bob
after finally/remove: null
```

实验验证线程复用造成的值残留和 `remove()` 的清理效果；未测试 Web 容器、日志 MDC 或虚拟线程集成。

## 为上下文定义唯一的生命周期边界

- 在过滤器、拦截器或任务包装器的最外层设置上下文，并在同一层 `finally` 清理。
- 对 MDC、链路追踪和安全上下文使用框架公开的清理方法，避免只清理自己创建的一个 ThreadLocal。
- 线程池提交异步任务时，不要假设调用线程的 ThreadLocal 会自动传播；需要传播就显式捕获必要值，在任务内设置并清理。
- 上下文较少时，优先把用户、租户或请求信息作为参数传递，生命周期比隐式线程状态更清楚。
- 若确实存在嵌套上下文，先定义“内层结束后恢复外层”还是“统一清空”的契约；不能机械地让多层代码同时覆盖和删除同一变量。
