---
title: "截止时间为什么必须沿调用链递减"
date: 2026-09-17
updated: 2026-10-01
domain: "分布式"
tags: ["Deadline","Timeout","可靠性"]
---

网关给请求 1 秒时间，鉴权和排队花掉 250 ms，服务 A 再处理 600 ms，数据库还应拿到多少预算？重新设置 1 秒显然无法守住入口承诺；此时只剩约 150 ms，若为结果编码和回传预留 20 ms，数据库最多使用约 130 ms。

这个例子说明，调用链需要共享一份端到端预算。每次排队、重试或调用下游前，都要扣除已消耗的时间。传播预算也不等于强制停止工作：HTTP 客户端、数据库、重试器和业务循环还必须分别支持超时与协作取消。

## 用单调时钟计算剩余预算

### 超时是时长，截止时间是共享约束

超时通常表示“从现在起最多等多久”，截止时间表示“到某个边界后结果就不再有价值”。入口可以从 `timeout` 建立本地截止预算：

```text
remaining = max(0, originalBudget - elapsed)
childTimeout = max(0, remaining - responseReserve)
```

如果每一跳把 `elapsed` 清零，局部超时就会串联累加。三跳各自允许 1 秒，并不等于端到端只等待 1 秒；排队、连接建立、重试退避和响应回传还会继续增加时间。传播剩余预算的关键价值，是让所有下游共享同一个上界，而不是让每层拥有独立的等待额度。

[gRPC 的官方 Deadline 指南](https://grpc.io/docs/guides/deadlines/)将 deadline 定义为客户端不再愿意等待的时间点。服务调用下一跳时应尊重原始期限；gRPC 在传播时会把期限转换为扣除已耗时的 timeout，以降低跨机器时钟偏差的影响。

### 本地计时要用单调时间源

墙上时钟用于表达日历时间，可能因时钟同步、管理员调整或虚拟化环境而跳变。持续时间计算更适合使用单调时间源。Java 的 `System.nanoTime()` 返回当前 JVM 的高分辨率时间源；它与墙上时间无关，起点任意，只有同一 JVM 内两次读数的差值有意义。[Java SE 27 `System.nanoTime()`](https://docs.oracle.com/en/java/javase/27/docs/api/java.base/java/lang/System.html#nanoTime())

因此，以下做法有两个不同边界：

- 进程内：保存起始 `nanoTime` 与初始预算，使用差值计算剩余时间。
- 跨进程：传递相对剩余时长，接收方用自己的单调时间源重新建立预算；不要发送一个 JVM 的 `nanoTime` 数字让另一台机器比较。

相对时长也不会神奇地消除传输耗时：接收方按收到的预算重新计时，发送后到接收前的网络时间仍需要由协议、上游取消和必要余量处理。仅自定义一个 timeout header，不能由此证明所有服务共享了精确到同一时刻的硬截止线。

### 预算传播与取消是两件事

预算耗尽后，调用方停止等待只是第一步。服务器应用仍要停止为该请求派生的活动；gRPC 官方指南也明确把清理已启动工作留给应用负责。数据库查询、远程调用和长循环必须各自支持超时或检查取消信号，否则调用者已经返回错误，后台工作仍可能继续消耗资源。

## 把预算传到真正的阻塞点

一条可落地的处理链通常包含这些动作：

1. **入口建立预算。** 从客户端 deadline、网关最大值和服务自身上限中取最严格者；缺少客户端期限时也设置服务默认上限。
2. **每次开始工作前重算。** 任务可能已在事件循环、线程池或连接池中排队，不能沿用入队时算出的固定 timeout。
3. **为收尾留出余量。** 从剩余预算中扣除序列化、提交结果、释放资源和网络回传的保守余量；余量应由测量得出，而非永久写死。
4. **传给实际阻塞点。** HTTP 读取、数据库语句、锁等待、消息确认和重试退避都应取不超过剩余预算的上限。只限制最外层 Future，不能约束底层资源占用。
5. **预算不足时停止接纳。** 如果剩余时间小于某操作的最小有用窗口，返回明确的 deadline/timeout 结果，避免进入下游后再制造超时。
6. **派生工作继承预算。** 并行兄弟调用共享原截止约束；某个调用失败是否取消其他调用取决于聚合语义，但不能给每个兄弟重新发一整份串行预算。

重试尤其容易破坏端到端边界。每次尝试前应重新读取剩余时间，并从中同时容纳退避与下一次调用；若只按“最多重试三次”而不看总预算，最坏等待时间会随尝试次数成倍增长。对有副作用的请求，即使调用方因 deadline 返回失败，也不能据此断定服务端没有提交，重试必须另有幂等或结果查询机制。

## 用两个时钟起点演示跨进程转换

将完整代码保存为 `DeadlineBudgetDemo.java`，使用 Java 17+ 运行 `java DeadlineBudgetDemo.java`。可控时钟固定每一步耗时：网关从 1 秒中消耗 250 ms，把 750 ms 传给下游；下游使用不同的时钟起点，处理 600 ms 后剩 150 ms，再预留 20 ms。为隔离预算计算，示例把网络传输耗时设为零。

```java
import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

public final class DeadlineBudgetDemo {
    static final class Budget {
        private final LongSupplier clock;
        private final long started;
        private final long timeout;

        Budget(Duration timeout, LongSupplier clock) {
            this.clock = Objects.requireNonNull(clock);
            this.timeout = timeout.toNanos();
            if (this.timeout <= 0) throw new IllegalArgumentException("timeout");
            this.started = clock.getAsLong();
        }

        Duration remaining() {
            long elapsed = clock.getAsLong() - started;
            return Duration.ofNanos(elapsed >= timeout ? 0 : timeout - elapsed);
        }

        Duration childTimeout(Duration reserve) {
            if (reserve.isNegative()) throw new IllegalArgumentException("reserve");
            return Duration.ofNanos(Math.max(0, remaining().toNanos() - reserve.toNanos()));
        }
    }

    static final class ManualClock implements LongSupplier {
        private long nanos;
        ManualClock(long origin) { nanos = origin; }
        public long getAsLong() { return nanos; }
        void advanceMillis(long millis) { nanos += Duration.ofMillis(millis).toNanos(); }
    }

    public static void main(String[] args) {
        ManualClock gatewayClock = new ManualClock(10_000);
        Budget gateway = new Budget(Duration.ofSeconds(1), gatewayClock);
        gatewayClock.advanceMillis(250);
        Duration wireBudget = gateway.remaining();

        ManualClock serviceClock = new ManualClock(-900_000);
        Budget service = new Budget(wireBudget, serviceClock);
        serviceClock.advanceMillis(600);
        Duration database = service.childTimeout(Duration.ofMillis(20));
        if (wireBudget.toMillis() != 750 || database.toMillis() != 130) {
            throw new AssertionError("budget calculation");
        }
        System.out.printf("wire=%dms remaining=%dms database=%dms%n",
                wireBudget.toMillis(), service.remaining().toMillis(), database.toMillis());

        serviceClock.advanceMillis(200);
        if (!service.remaining().isZero()) throw new AssertionError("expired budget");
    }
}
```

程序2026-10-01 修订时，使用 JDK 25.0.2 的 `javac --release 17` 编译并运行，得到以下输出，代码中的检查均通过：

```text
wire=750ms remaining=150ms database=130ms
```

断言覆盖预算递减、预留余量和到期归零，未模拟网络、gRPC、数据库或真实时钟漂移。时钟必须单调前进，观测间隔和预算小于约 292 年；示例用差值计算持续时间，不比较两个 JVM 的绝对读数。

## 把超时、容量和业务结果一起设计

**统一传播语义。** 在服务框架的请求上下文中保存预算对象，并由 HTTP/gRPC 客户端、数据库适配器、重试器和线程池任务读取。若框架原生支持 deadline 传播，优先沿用其语义；手写 header 时必须定义单位、上限、缺失值、负值和序列化精度，且不可把不可信客户端给出的超长时间直接当作资源承诺。

**在边界处记录“剩余量”，而不只记录最终超时。** 建议采集入口预算、每跳接收时的剩余预算、队列耗时、下游调用耗时、预算不足而提前拒绝的数量，以及 deadline 之后仍运行的后台任务。这样才能区分“下游本身慢”和“上游已经花完大部分预算”。

**用延迟分布分配预算。** 子调用上限应参考真实的 p95/p99、网络开销和失败模式。串行步骤要分配总预算，并行步骤可以共享截止时间；不要简单把 1 秒平均分给四个步骤，也不要把每个步骤都设成 1 秒。预留余量过大可能造成过早失败，过小则来不及编码和回传，需要负载测试校准。

**让容量控制认识 deadline。** 有界队列不会自动删除已经过期的任务。任务真正开始执行时再次检查预算；如果已过期，立即释放接纳许可与上下文。连接池等待、限流器排队和重试退避也要遵守同一个边界，避免把过期请求继续推向瓶颈。

**明确超时后的业务状态。** 查询类操作通常可以停止等待；支付、写库、发消息等操作可能在客户端超时前后跨过提交点。返回 timeout 只说明调用方没有及时得到确定结果，不等于事务回滚。用幂等键、操作状态查询、Outbox 或补偿流程处理这种不确定性。
