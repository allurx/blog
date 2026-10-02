---
title: "协调遗漏为什么会低估压测尾延迟"
date: 2026-09-23
updated: 2026-10-01
domain: "性能"
tags: ["LoadTesting","TailLatency","CoordinatedOmission"]
---

压测报告的 P99 只有 5 ms，最大延迟却出现过 500 ms。这个组合未必是百分位算错了：如果客户端总要等上一次响应后才发下一次请求，服务停顿时它也会停止发压，最坏时段恰好缺少请求样本。

协调遗漏关心的是样本生成过程是否符合真实到达过程。外部流量独立于响应持续到达时，应按计划到达率发压，并计入排队；如果真实用户必须等待上一步完成，闭环反而符合业务语义。不要用一种负载模型的数字，回答另一种负载模型下的容量问题。

## 闭环降压怎样改变尾延迟分布

### 闭环与开放模型

闭环模型中，下一个请求的到达依赖上一个请求完成。并发用户数固定时，可粗略写成：

```text
throughput ≈ concurrency / response_time
```

响应时间上升会自动降低吞吐。Grafana k6 的官方文档也明确区分两者：闭环模型的迭代只有在前一次结束后才开始；开放模型的到达与前一次迭代是否完成相互独立。文档把“系统变慢导致到达率下降”的问题直接称为 coordinated omission，并建议在目标是模拟给定到达率时使用开放模型（[Open and closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/)）。

开放模型先确定计划到达时刻，例如每 10 ms 一个请求。即使服务正在处理慢请求，新的逻辑请求仍应到达：压测器要么增加并发执行单元，要么显式记录无法发出的请求。k6 的 `constant-arrival-rate` executor 就按固定速率启动迭代，并通过分配不同数量的 VU 尽量维持速率（[Constant arrival rate](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/)）。

### 为什么尾延迟失真

百分位是样本分布的排序统计量。假设 300 个样本里只有 1 个是 500 ms，其余都是 5 ms，那么 P99 仍是 5 ms；最大值虽然暴露了停顿，却没有表达停顿影响了多少到达请求。

若按每 10 ms 的固定到达率发压，一次 500 ms 停顿会形成队列。停顿期间到达的请求会得到一串逐步下降的端到端延迟，许多高延迟样本进入分布，P95、P99 才能反映随机到达请求在坏时段的实际体验。

关键计时边界是：

```text
端到端延迟 = 完成时刻 - 计划到达时刻
            = 排队等待 + 实际执行
```

如果只从“压测器终于拿到线程并真正发出请求”开始计时，发压端的等待也会再次被遗漏。

## 同时检查调度、容量和计时边界

避免协调遗漏需要同时处理三个层次：

1. **调度层**：预先定义独立于响应时间的到达计划。固定 RPS、阶梯、斜坡或依据生产轨迹回放，都属于开放式到达模型。
2. **容量层**：为目标速率准备足够的并发执行资源。并发不足时，不应悄悄降低到达率；应报告 dropped iterations、未发出请求或发压器饱和。
3. **测量层**：以计划到达时刻为起点，记录排队、连接池等待、网络与服务处理的完整时延，并保留错误、超时和拒绝样本。

wrk2 的说明给出了这种实现思路：以恒定吞吐发压，使用 HdrHistogram 记录数据，并从请求“计划发送”的时刻计算到响应到达的延迟（[wrk2 README](https://github.com/giltene/wrk2)）。HdrHistogram 则提供 `recordValueWithExpectedInterval()`：当一次记录值超过期望采样间隔时，它补入按间隔递减的值，用来校正因长响应而漏掉的样本（[HdrHistogram README](https://github.com/HdrHistogram/HdrHistogram#corrected-vs-raw-value-recording-calls)）。

这种校正依赖一个假设：停顿期间原本应按已知间隔持续采样。它适合修正“等待响应后才继续采样”这一类遗漏，但无法知道线上真实到达是否突发、请求是否被限流、队列是否有界，也无法替代对错误率和丢弃量的观测。

## 离散事件模拟同一次停顿

保存为 `CoordinatedOmissionDemo.java`，使用 Java 17+ 执行 `java CoordinatedOmissionDemo.java`。程序用整数毫秒做离散事件模拟：正常处理耗时 5 ms，开始时刻首次到达 500 ms 时，把那一次请求的服务时间设为 500 ms。闭环客户端收到响应后才继续；开放客户端每 10 ms 安排一个请求，两者都不受真实机器速度影响。

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class CoordinatedOmissionDemo {
    private static List<Long> simulate(boolean open) {
        List<Long> latencies = new ArrayList<>();
        long available = 0;
        long arrival = 0;
        boolean pauseInjected = false;
        while (arrival < 2_000) {
            long start = Math.max(arrival, available);
            long service = !pauseInjected && start >= 500 ? 500 : 5;
            pauseInjected |= service == 500;
            long finish = start + service;
            latencies.add(finish - arrival);
            available = finish;
            arrival = open ? arrival + 10 : finish;
        }
        return latencies;
    }

    // nearest-rank：先升序排序，再取 ceil(p * n) 对应的第几个样本。
    private static long percentile(List<Long> sorted, double p) {
        return sorted.get((int) Math.ceil(p * sorted.size()) - 1);
    }

    private static void report(String name, List<Long> samples, int count, long p99) {
        Collections.sort(samples);
        if (samples.size() != count || percentile(samples, .99) != p99) {
            throw new AssertionError("simulation result");
        }
        System.out.printf("%s: samples=%d p50=%dms p95=%dms p99=%dms max=%dms%n",
                name, samples.size(), percentile(samples, .5), percentile(samples, .95),
                percentile(samples, .99), samples.get(samples.size() - 1));
    }

    public static void main(String[] args) {
        report("closed-loop", simulate(false), 301, 5);
        report("fixed-arrival", simulate(true), 200, 490);
    }
}
```

2026-10-01 修订时，使用 JDK 25.0.2 的 `javac --release 17` 编译并运行，得到以下输出，代码中的检查均通过：

```text
closed-loop: samples=301 p50=5ms p95=5ms p99=5ms max=500ms
fixed-arrival: samples=200 p50=5ms p95=450ms p99=490ms max=500ms
```

两组结果共享同一个“正常 5 ms、一次 500 ms 停顿”的服务模型。闭环报告只留下一个慢样本，P99 仍为 5 ms；固定到达率把停顿造成的排队计入请求体验，P99 变为 490 ms。该程序验证的是负载模型与计时边界，不是生产级压测器，也没有模拟多服务器、网络、限流或超时取消。

## 让压测报告保留遗漏与过载证据

- **先描述工作负载，再选工具参数。** 固定在线用户逐步操作、终端思考时间、消息队列消费、公开 API 到达率是不同模型。不要因为“固定并发更容易配”就默认它代表固定 RPS。
- **同时报告目标、实际和丢弃速率。** 只有目标 10k RPS 没有实际启动数、完成数、错误数和 dropped iterations，无法判断结果属于被测系统还是发压器。
- **让发压端有余量。** 监控压测机 CPU、调度延迟、连接数、端口和网络带宽；分布式发压时检查各节点时钟与速率分配。发压器饱和会制造另一种遗漏。
- **延迟与过载结果一起看。** 达不到计划到达率、超时、429/503、连接拒绝和客户端放弃都应进入容量结论，不能只计算成功请求的百分位。
- **区分服务时间与端到端时间。** 服务端处理时长可用于定位瓶颈，但用户体验还包含客户端排队、连接池等待、网关与网络。两类指标应分别命名，避免把内部 service time 当成 response time。
- **保留完整分布和测试配置。** 记录负载模型、计划速率、并发上限、预热时间、直方图精度与最大可记录值；只保存平均值和 P99 会丢掉复核条件。
- **把校正结果标清楚。** 如果同时输出原始直方图与 coordinated-omission corrected 直方图，应明确二者含义和期望间隔，不能把事后推导值冒充实际发送请求的观测值。
