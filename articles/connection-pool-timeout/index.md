---
title: "连接池超时为什么拦不住慢 SQL"
date: 2026-09-24
updated: 2026-10-01
domain: "数据库"
tags: ["ConnectionPool","JDBC","Timeout"]
---

`config.setConnectionTimeout(300)` 不能保证数据库调用在 300 ms 内结束。对于 HikariCP，它限制的是“从连接池借到连接”这一段；连接已借出以后，SQL、锁等待、结果读取和网络阻塞拥有各自的超时边界。

排查慢数据库调用时，先确认时间花在借连接、执行语句还是等网络，再配置对应计时器。各阶段都应读取剩余请求预算，网络超时通常作为更晚触发的失联保护。取消是否送达、事务是否已提交，仍要由驱动和数据库状态确认。

## 四种相似名称对应四段不同等待

### 连接池超时是容量保护

池的职责是复用有限的物理连接。连接全部在用时，新请求在队列中等待；`connectionTimeout` 给这段等待设置上限。它解决的是“没有连接可借时，调用线程最多排多久”，并帮助系统在过载时快速失败。

这个超时触发时，SQL 根本还没有开始。把值调大不会提高数据库吞吐量，只会允许更多调用线程积压，并把尾延迟和内存占用推高。

### 查询超时是执行预算

JDBC `Statement.setQueryTimeout(int seconds)` 限制驱动等待语句执行的秒数，默认值 `0` 表示没有限制；超限时抛出 `SQLTimeoutException`。JDBC 规范要求驱动将它应用于 `execute`、`executeQuery` 和 `executeUpdate`，但批处理的计时粒度以及是否覆盖 `ResultSet` 读取由实现决定。[Java SE 27 `Statement`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Statement.html#setQueryTimeout(int))

这意味着查询超时应在每个实际执行 SQL 的 `Statement` 上生效，不能由池的等待超时代替。框架提供的事务超时通常会进一步把剩余预算映射到语句，但具体传播方式仍需用所选框架与驱动做集成验证。

### 网络超时是失联兜底

JDBC `Connection.setNetworkTimeout` 限制连接等待数据库响应的时间，触发后连接会被标记为关闭。规范明确指出它与查询超时相互独立，而且应设置得足够高，不要早于更正常的事务或查询超时触发。[Java SE 27 `Connection`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Connection.html#setNetworkTimeout(java.util.concurrent.Executor,int))

驱动也可能提供套接字属性。例如 MySQL Connector/J 的 `connectTimeout` 限制建立 TCP 连接，`socketTimeout` 限制网络套接字操作；两者默认 `0` 都表示无限等待。[MySQL Connector/J 网络属性](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-networking.html)

因此，“获取连接”“建立物理连接”“执行 SQL”“等待网络响应”是不同计时器，名称相似但保护的阶段不同。

## 子预算必须在剩余总预算内

可以把一次调用抽象成以下时间线：

```text
请求截止时间
│
├─ 连接池等待 ── connectionTimeout
├─ SQL/事务执行 ─ queryTimeout / transaction timeout
└─ 网络读取 ───── networkTimeout / socketTimeout（更长的兜底）
```

假设上游只剩 800 ms：

- 连接池最多等待 100 ms；
- 借到连接后，根据剩余时间设置 SQL/事务预算，例如最多 650 ms；
- 若已经花掉 100 ms，当前只剩 700 ms；网络兜底可以略长于 650 ms 的正常执行预算，但仍须在这 700 ms 内，并为回传留出余量。

关键不是机械复制固定数值，而是每进入下一阶段都从单调时钟计算剩余预算。否则“获取连接 300 ms + 查询 1 s + 网络 5 s”可能把一个 800 ms 的请求拖到数秒。

取消也有边界。JDBC 只承诺超时时驱动至少尝试取消当前语句；`Statement.cancel()` 是否能中止工作取决于驱动和 DBMS 是否支持。客户端收到异常后，数据库端仍可能短暂运行，甚至已经完成提交。因此不能把超时当作事务回滚或幂等保证。[Java SE 27 `Statement.cancel`](https://docs.oracle.com/en/java/javase/27/docs/api/java.sql/java/sql/Statement.html#cancel())

## 取得连接后，给 Statement 设置自己的期限

下面片段使用应用已经配置的 `dataSource` 和 `orderId`，展示取得连接后设置语句超时的位置。这是 JDBC 接入示例，执行结果依赖数据库、驱动及表结构，本文没有提供它们的集成实测结果。

```java
try (Connection connection = dataSource.getConnection();
     var statement = connection.prepareStatement(
             "select id, status from orders where id = ?")) {
    statement.setQueryTimeout(2); // JDBC 单位是秒，0 表示无限
    statement.setLong(1, orderId);
    try (var rows = statement.executeQuery()) {
        // 消费结果；是否覆盖 ResultSet 读取需核对驱动文档
    }
}
```

上面的 2 秒只是便于演示 API，不能直接套用到只剩 650 ms 的请求。`setQueryTimeout(int)` 只有秒级精度：向上取为 1 秒可能突破预算，向下取为 0 又变成无限等待。此时应采用经验证支持更细粒度期限的驱动或数据库能力，或在剩余时间不足时不再启动该语句。仅给外层 `Future.get` 设置 650 ms，会限制调用方等待，但不能证明数据库工作已停止。

## 用集成测试确认驱动到底取消了什么

- **分别观测三个阶段。** 至少记录连接获取耗时、SQL 执行耗时、超时类型和连接池 active/pending 指标。只看接口总耗时无法判断是池饱和、慢 SQL 还是网络故障。
- **用预算而不是孤立常量。** 从请求截止时间扣除已经消耗的时间，再设置后续阶段的上限；在进入数据库前若预算已不足，直接失败比启动一个注定超时的查询更安全。
- **让网络超时晚于正常超时。** 查询或事务超时负责可预期的慢操作，网络超时负责失联连接。反过来会频繁销毁本可复用的连接。
- **验证驱动行为。** 对慢查询、锁等待、流式结果集和网络黑洞分别做集成测试，确认抛出的异常、取消是否送达、连接能否继续使用，以及池是否淘汰该连接。
- **保护有副作用的写入。** 超时后结果可能未知；使用唯一约束、幂等键、条件更新或状态机，使重试不会重复扣款或重复推进状态。
- **不要用扩大池解决慢查询。** 池越大可能让更多并发 SQL 同时争用数据库 CPU、I/O 与锁。先依据数据库容量设定并发上限，再优化索引和访问路径。
