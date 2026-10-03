---
title: "Redis TTL 到期为什么不等于立即删除"
date: "2026-09-08"
updated: 2026-10-03
domain: "Redis"
tags: ["Redis", "TTL", "缓存"]
---

一个 Redis Key 已经读不到，内存却没有在截止时刻同步下降，这两个观察并不冲突。TTL 定义的是数据何时逻辑失效，删除与内存回收则由后续处理完成；应用不能把它当成每个 Key 都有的精确定时回调。

本文讨论 Redis Key 级过期，命令以 Redis Open Source 8.2.10 为目标；8.2 属于 Extended 支持线。`SET ... KEEPTTL` 自 6.0 提供。本文没有运行 Redis 实例，返回值按命令契约说明；过期算法的抽样参数随版本变化，不作为应用保证。[Redis 支持线](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/) · [8.2.10 发布说明](https://github.com/redis/redis/releases/tag/8.2.10)

## 到期后的访问与回收

执行 `SET session:42 data EX 60` 后，到期的 Key 不再作为有效数据返回。主节点通常在访问时发现过期并删除，或者在主动过期周期中抽样命中它。一个不再被访问的过期 Key，可能在被主动处理前暂时占用内存；启用异步释放等机制时，移除 Key 与回收值占用的内存也可能分开。

### 用访问检查与抽样分摊过期成本

假设缓存中有一千万个带 TTL 的 Key，其中一个会话键刚刚到期。客户端下一次访问它时可以就地检查期限；但如果此后没人再访问它，仅靠请求路径就无法回收这部分空间。主动过期正是用来补上这个缺口的。

每次主动处理都遍历全部 Key，会把一次周期工作的成本放大到整个数据集：

```text
扫描所有 Key → 检查 TTL → 删除过期 Key
```

数据集越大，这种全量扫描花费的时间就越长；即使大部分 Key 尚未过期，也要逐一检查。

Redis 采用“访问时检查 + 后台抽样”，把回收成本分摊到请求路径和周期性工作中，在过期及时性、CPU 消耗和延迟稳定性之间取得平衡。Redis 官方文档明确说明，Key 同时通过 passive 和 active 两种方式过期。[Redis `EXPIRE` 官方文档](https://redis.io/docs/latest/commands/expire/)

### 到期依据是绝对时间，检查发生在访问或周期任务中

Redis 在内部以绝对 Unix 时间戳保存过期信息。即使 Redis 实例停止运行，时间仍然继续流逝；恢复或载入数据时，已经超过截止时间的 Key 会被视为过期。

这也意味着系统时钟异常跳变可能影响过期行为。例如，将服务器时钟大幅调到未来，可能使大量 Key 立即过期。官方建议保持主机时钟稳定；当前文档说明 Redis 2.6 以来的过期误差范围为 0–1 毫秒，但这描述的是过期时间精度，不等于物理内存一定在该毫秒完成回收。[Redis过期机制说明](https://redis.io/docs/latest/commands/expire/#appendix-redis-expires)

Redis 通常为带 TTL 的 Key 维护额外的过期时间信息。

读取一个 Key 时，大致执行：

```text
定位 Key
  → 检查是否设置 TTL
  → 比较当前时间与过期时间
  → 未过期：返回值
  → 已过期：删除并按不存在处理
```

主动过期流程则大致为：

```text
周期性运行
  → 从带 TTL 的 Key 中抽样
  → 删除样本中的过期 Key
  → 根据过期比例决定是否继续检查
```

具体抽样数量、时间预算和迭代策略属于实现细节，可能随 Redis 版本调整；不应让业务代码依赖某个固定扫描周期。

### 主从复制中的处理

在常规主从复制下，过期主要由主节点驱动。主节点删除过期 Key 时，会向 AOF 和副本传播合成的删除操作。副本即使尚未收到删除指令，也会在适当的只读操作中把逻辑上过期的 Key 当作不存在，避免返回陈旧缓存；副本晋升为主节点后才独立负责过期。[Redis复制与过期机制](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/#how-redis-replication-deals-with-expires-on-keys)

这一机制的目标是让数据集复制保持一致，而不是要求所有节点在同一个物理时刻释放 Key。

## 写入和更新时保留正确的 TTL

### 原子设置值和 TTL

以下命令可在独立测试实例的 `redis-cli` 8.2.10 交互会话执行，会写入文中给出的示例键。推荐在写入缓存时一次完成值与 TTL 设置：

```redis
SET user:42 '{"name":"Alice"}' EX 300
```

不要无必要地拆成：

```redis
SET user:42 '{"name":"Alice"}'
EXPIRE user:42 300
```

如果客户端在两条命令之间崩溃，Key 可能永久保留。必须执行多条关联命令时，应使用事务、Lua 脚本或客户端提供的等价原子能力。

### 更新操作不一定清除 TTL

部分原地修改值的命令会保留已有 TTL：

```redis
SET counter 0 EX 60
INCR counter
TTL counter
```

`INCR` 不会移除原 TTL。`LPUSH`、`HSET` 等原地修改命令也遵循类似原则。

但覆盖整个值的 `SET` 默认会清除已有 TTL：

```redis
SET counter 0 EX 60
SET counter 1
TTL counter
# -1：Key 存在，但没有过期时间
```

如果覆盖值时需要保留 TTL，可显式使用：

```redis
SET counter 0 EX 60
SET counter 1 KEEPTTL
TTL counter
```

这组命令先重新建立 TTL，再覆盖值，便于与上一组对照；若对已经没有 TTL 的键使用 `KEEPTTL`，它不会凭空补回期限。该行为由当前 [`EXPIRE`](https://redis.io/docs/latest/commands/expire/) 与 [`SET`](https://redis.io/docs/latest/commands/set/) 官方文档确认。

### 正确解释 TTL 返回值

```redis
TTL user:42
```

返回值含义：

|      返回值 | 含义             |
| -------: | -------------- |
| 正整数或 `0` | 剩余秒数           |
|     `-1` | Key 存在，但没有 TTL |
|     `-2` | Key 不存在        |

毫秒级观察使用 `PTTL`，但不要通过高频轮询等待其变成 `-2` 来实现业务调度。

## 缓存失效不能替代业务到期处理

### 为批量缓存增加 TTL 抖动

如果一百万个缓存同时设置为 30 分钟，它们可能集中失效，造成：

* 主动过期工作量短时升高。
* 大量请求同时回源数据库。
* CPU、网络和数据库连接池出现尖峰。

可以采用：

```text
实际 TTL = 基础 TTL + 随机抖动
```

例如允许最多陈旧 33 分钟的缓存，可以在 27–33 分钟内分散失效；若业务上限严格为 30 分钟，则抖动上界不能超过 30 分钟。TTL 抖动只分散不同 Key 的到期，不会防止一个热点 Key 失效时的并发回源；后者还需结合请求合并或限流。

### 订单关闭需要独立的可靠触发机制

假设订单要求 30 分钟未支付就关闭，把订单 ID 存成带 TTL 的 Key，再订阅过期事件，看起来正好能触发关闭动作。但这里存在两处空隙：Key 到期时可能尚未被处理，消费者也可能恰好断线。订单不能因为其中任一情况就永久停留在待支付状态。

过期事件在 Redis 实际处理删除时产生，并非到达时间戳就必然发出。通知还需要显式配置，基于 Pub/Sub 的消费者断线会丢失事件；不能由此构建准时且必达的业务保证。[Redis Keyspace Notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/)

可以让数据库中的截止时间与订单状态承担事实记录，再由能够重试的处理流程完成关闭：

1. 数据库保存明确的截止时间和业务状态。
2. 延迟队列或周期扫描负责触发。
3. 处理逻辑通过状态条件和幂等键保证重复执行安全。
4. Redis 只用于加速查询或减少重复扫描。

### 监控过期效果

可以关注：

```redis
INFO stats
INFO keyspace
```

重点观察：

* `expired_keys`：累计过期 Key 数量。
* Key 总量与带 TTL 的 Key 数量。
* 内存使用是否在批量到期后按预期下降。
* 缓存命中率、回源 QPS 和延迟是否同时出现异常。

例如 `expired_keys` 快速增长的同时，数据库 QPS 和请求延迟也陡增，就应检查是否有大量热点缓存集中失效。删除数量说明 Redis 做了多少过期工作，回源与延迟才说明这些失效对业务造成了什么影响。

### 区分 expiration 与 eviction

Expiration 是 TTL 到期后的失效。

Eviction 是内存达到限制后，根据 `maxmemory-policy` 主动淘汰尚未到期的数据。一个 Key 即使 TTL 还有很久，也可能因为内存压力被淘汰。

因此，缓存业务必须同时接受：

* Key 因到期而消失。
* Key 因淘汰而提前消失。
* Redis 重启、故障切换或数据丢失导致 Key 不存在。

缓存通常不能成为唯一事实来源。

观察时还要区分命令 `EXPIRE key 0` 和查询结果 `TTL key` 为 `0`：前者要求立即删除，后者是剩余秒数的展示值。判断 Key 是否存在应使用相应命令结果，不能把秒级 TTL 读数当作精密时钟。
