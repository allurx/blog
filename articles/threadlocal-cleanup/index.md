---
title: "线程池里的 ThreadLocal 为什么必须清理"
date: 2026-09-21
updated: 2026-10-03
domain: "Java 并发"
tags: ["ThreadLocal","线程池","上下文泄漏"]
---

固定线程池里，第一个任务设置 `userId=alice`，第二个任务没有设置用户，却读到了 alice。线程池没有把请求混在一起；被复用的是 worker，而 `ThreadLocal` 的值恰好属于这个 worker，并不属于上一次任务。

`ThreadLocal` 的名字指出了值属于线程，但业务往往希望它只属于一次请求。问题就出在这两个生命周期的长度不同。下面用单线程池重现残留，再把清理放回真正执行任务的线程。示例针对 JDK 25 的平台线程池与普通 `ThreadLocal`。

## 任务结束不等于线程结束

每个访问 `ThreadLocal` 的线程都有自己的值副本。官方文档指出，只要线程仍存活且 `ThreadLocal` 实例仍可访问，线程就隐式持有这个副本。普通短命线程退出后，副本可以随线程回收；线程池 worker 则可能服务整个应用生命周期，因此“任务结束”不会触发 ThreadLocal 自动清理。[`ThreadLocal` 生命周期](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html)

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

`ThreadPoolExecutor` 还提供 `beforeExecute`、`afterExecute` 钩子，可用于重置 ThreadLocal 等执行环境；但业务通常不应通过自定义线程池猜测所有库使用了哪些上下文。更稳妥的做法是在请求过滤器、拦截器或任务包装器中，使用对应框架提供的设置和清理 API。[`ThreadPoolExecutor` 钩子](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)

## 对照未清理与 finally 清理

实验先让 alice 的任务留下用户信息，再让另一个任务读取；随后用 bob 的任务制造一次失败，观察 finally 是否仍然执行。两组共用同一条 worker，排除了“刚好换了一条线程”的干扰。

### 在同一条 worker 上依次执行

保存为 `ThreadLocalLeakDemo.java`，使用 JDK 25 LTS 执行 `java ThreadLocalLeakDemo.java`，无需第三方依赖。单个 worker 保证后续任务复用同一线程，`Future.get()` 保证先后关系；最后一组故意在任务里抛异常，检查 `finally` 仍清除了上下文。

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

### 从下一项任务读取结果

在 Windows、Oracle JDK 25.0.2 LTS 下执行上述源文件，得到以下输出；程序中的检查会核对这些结果。

```text
without cleanup: alice
inside guarded task: bob
after finally/remove: null
```

第一行说明 alice 的任务结束后值仍在。第二行说明包装器已经将本次任务的值设为 bob；第三行则来自后续任务，表明异常路径上的 finally 已删除绑定。这个实验只涉及普通 ThreadLocal，Web 容器与日志 MDC 还需要使用各自的上下文 API。

## 把清理放在上下文的拥有者那里

请求过滤器、拦截器或任务包装器知道一次工作何时开始、何时结束，适合同时负责设置与清理。调用链中的普通业务方法只读取上下文，就不用猜测谁负责收尾。MDC、链路追踪和安全上下文应使用框架公开的对应 API，保证它们各自维护的状态都得到处理。

如果请求再提交异步任务，普通 ThreadLocal 不会自动跟过去。需要传递时，在提交处捕获必要值，在任务内部建立并清理绑定；值很少时，直接传参通常更清楚。

嵌套调用则要多考虑一步。外层已经设置 alice，内层临时切换为 bob，内层结束后如果外层还要继续，应该恢复 alice，而非无条件清空。前面的包装器适用于拥有整项任务上下文的边界；嵌套作用域需要按自己的恢复规则实现。
