---
title: "协调遗漏为什么会低估压测尾延迟"
date: 2026-09-23
updated: 2026-10-03
domain: "性能"
tags: ["LoadTesting","TailLatency","CoordinatedOmission"]
---

压测报告的 P99 只有 5 ms，最大延迟却出现过 500 ms。这个组合未必是百分位算错了：如果客户端总要等上一次响应后才发下一次请求，服务停顿时它也会停止发压，最坏时段恰好缺少请求样本。

问题藏在“服务变慢时，客户端还会不会继续来请求”里。公开 API 的请求可能持续到达，用户逐步操作一个表单时却通常要等待上一步返回。两种场景需要不同的负载模型。协调遗漏讨论的是：本应继续出现的请求，有没有因为压测器也跟着等待而从样本里消失。

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

先把停顿期间的几个请求展开，就能看见缺掉的是哪些样本。下面沿用“正常服务 5 ms、在 500 ms 开始的一次请求服务 500 ms”的模型：

| 开放模型的计划到达时刻 | 开始处理 | 完成时刻 | 端到端延迟 | 闭环在此时是否发新请求 |
| ---: | ---: | ---: | ---: | --- |
| 500 ms | 500 ms | 1000 ms | 500 ms | 是，随后等待这次响应 |
| 510 ms | 1000 ms | 1005 ms | 495 ms | 否，仍在等待 |
| 520 ms | 1005 ms | 1010 ms | 490 ms | 否，仍在等待 |

闭环不是把后两个请求测成了 5 ms，而是根本没有生成它们。关键计时边界是：

```text
端到端延迟 = 完成时刻 - 计划到达时刻
            = 排队等待 + 实际执行
```

如果只从“压测器终于拿到线程并真正发出请求”开始计时，发压端的等待也会再次被遗漏。

## 发压节奏与计时起点要一起检查

### 请求应当到达，却没有发出去时怎么办

避免协调遗漏需要同时处理三个层次：

1. **调度层**：预先定义独立于响应时间的到达计划。固定 RPS、阶梯、斜坡或依据生产轨迹回放，都属于开放式到达模型。
2. **容量层**：为目标速率准备足够的并发执行资源。并发不足时，不应悄悄降低到达率；应报告 dropped iterations、未发出请求或发压器饱和。
3. **测量层**：以计划到达时刻为起点，记录排队、连接池等待、网络与服务处理的完整时延，并保留错误、超时和拒绝样本。

wrk2 的说明给出了一种实现：按恒定吞吐发压，使用 HdrHistogram 记录数据，从请求“计划发送”的时刻计算到响应到达的延迟。这样，晚发出去的请求所经历的等待也进入测量。[wrk2 README](https://github.com/giltene/wrk2)

### 事后补样本需要知道原本的到达间隔

HdrHistogram 提供 `recordValueWithExpectedInterval()`：当一次记录值超过期望采样间隔时，它补入按间隔递减的值，估算长响应期间被漏掉的样本。例如期望间隔为 10 ms，一次 500 ms 的记录会提示停顿期间还应有多个观察点。[HdrHistogram README](https://github.com/HdrHistogram/HdrHistogram#corrected-vs-raw-value-recording-calls)

这种校正依赖一个假设：停顿期间原本应按已知间隔持续采样。它适合修正“等待响应后才继续采样”这一类遗漏，但无法知道线上真实到达是否突发、请求是否被限流、队列是否有界，也无法替代对错误率和丢弃量的观测。

## 离散事件模拟同一次停顿

保存为 `CoordinatedOmissionDemo.java`，使用 JDK 25 LTS 执行 `java CoordinatedOmissionDemo.java`，无需第三方依赖。程序用整数毫秒做离散事件模拟：正常处理耗时 5 ms，开始时刻首次到达 500 ms 时，把那一次请求的服务时间设为 500 ms。闭环客户端收到响应后才继续；开放客户端每 10 ms 安排一个请求，两者都不受真实机器速度影响。

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

在 Windows、Oracle JDK 25.0.2 LTS 下执行上述源文件，得到以下输出；程序中的检查会核对这些结果。

```text
closed-loop: samples=301 p50=5ms p95=5ms p99=5ms max=500ms
fixed-arrival: samples=200 p50=5ms p95=450ms p99=490ms max=500ms
```

两组结果共享同一个“正常 5 ms、一次 500 ms 停顿”的服务模型。闭环报告只留下一个慢样本，P99 仍为 5 ms；固定到达率把停顿造成的排队计入请求体验，P99 变为 490 ms。该程序验证的是负载模型与计时边界，不是生产级压测器，也没有模拟多服务器、网络、限流或超时取消。

## 怎样阅读一份包含停顿的压测报告

回到开篇的 `P99 = 5 ms、max = 500 ms`，首先要找到负载模型。如果客户端收到响应后才发下一个请求，这组数字可以正确描述这批已发送请求，却未必代表外部请求持续到达时的体验。报告需要同时给出目标速率、实际启动数、完成数、错误数与未发出的请求数量。

若实际到达率没有达到计划值，进一步检查发压机的 CPU、调度延迟、连接和端口资源、网络带宽。瓶颈可能在服务，也可能在生成请求的一方；两种情况都不能靠只保留成功请求的百分位来解释。超时、拒绝、429/503 和客户端放弃同样属于过载结果。

计时口径也要单独说明：服务端处理时长用于定位服务内部瓶颈，端到端延迟还包含排队、连接获取和网络。如果做了协调遗漏校正，应同时保留原始分布与校正分布，并注明期望间隔。补出来的样本是基于模型的估计，不能标成实际发送请求的观测。

保留负载模型、计划速率、并发上限、预热设置和直方图精度后，读者才能判断那个低 P99 说明了什么。百分位计算正确只是第一步，样本覆盖了哪些请求，才决定它能回答哪一种容量问题。
