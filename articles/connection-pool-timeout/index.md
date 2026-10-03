---
title: "连接池超时为什么拦不住慢 SQL"
date: 2026-09-24
updated: 2026-10-03
domain: "数据库"
tags: ["ConnectionPool","JDBC","Timeout"]
---

`config.setConnectionTimeout(300)` 不能保证数据库调用在 300 ms 内结束。对于 HikariCP，它限制的是“从连接池借到连接”这一段；连接已借出以后，SQL、锁等待、结果读取和网络阻塞拥有各自的超时边界。

排查慢数据库调用时，先确认时间花在借连接、执行语句还是等网络，再配置对应计时器。各阶段都应读取剩余请求预算，网络超时通常作为更晚触发的失联保护。取消是否送达、事务是否已提交，仍要由驱动和数据库状态确认。

本文的目标组合是 JDK 25 LTS、HikariCP 7.1.0、MySQL Connector/J 26.7.0 与 MySQL 9.7 LTS。HikariCP 的 Java 11+ 要求、驱动的 Java 8+ 和 MySQL 8.4+ 要求均覆盖这一组合；这里只据公共契约解释边界，没有运行数据库取消实验。[HikariCP 依赖要求](https://github.com/brettwooldridge/HikariCP#artifacts) · [Connector/J 兼容范围](https://dev.mysql.com/doc/connector-j/en/connector-j-versions.html)

## 四种超时分别约束什么

### 连接池超时是容量保护

池的职责是复用有限的物理连接。连接全部在用时，新请求在队列中等待；`connectionTimeout` 给这段等待设置上限。它解决的是“没有连接可借时，调用线程最多排多久”，并帮助系统在过载时快速失败。

这个超时触发时，SQL 根本还没有开始。把值调大不会提高数据库吞吐量，只会允许更多调用线程积压，并把尾延迟和内存占用推高。

### 查询超时是执行预算

JDBC `Statement.setQueryTimeout(int seconds)` 限制驱动等待语句执行的秒数，默认值 `0` 表示没有限制；超限时抛出 `SQLTimeoutException`。JDBC 规范要求驱动将它应用于 `execute`、`executeQuery` 和 `executeUpdate`，但批处理的计时粒度以及是否覆盖 `ResultSet` 读取由实现决定。[Java SE 25 `Statement`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html#setQueryTimeout(int))

这意味着查询超时应在每个实际执行 SQL 的 `Statement` 上生效，不能由池的等待超时代替。框架提供的事务超时通常会进一步把剩余预算映射到语句，但具体传播方式仍需用所选框架与驱动做集成验证。

### 网络超时是失联兜底

JDBC `Connection.setNetworkTimeout` 限制连接等待数据库响应的时间，触发后连接会被标记为关闭。规范明确指出它与查询超时相互独立，而且应设置得足够高，不要早于更正常的事务或查询超时触发。[Java SE 25 `Connection`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html#setNetworkTimeout(java.util.concurrent.Executor,int))

驱动也可能提供套接字属性。例如 MySQL Connector/J 的 `connectTimeout` 限制建立 TCP 连接，`socketTimeout` 限制网络套接字操作；两者默认 `0` 都表示无限等待。[MySQL Connector/J 网络属性](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-networking.html)

网络套接字超时约束的是网络操作等待，不是整个结果集的总耗时。由此可知，流式结果持续返回小块数据时，每次等待都很短，总读取时间却仍可能超过入口预算；这时还需在读取和取消边界尊重请求截止时间，不能仅靠 `socketTimeout` 保证端到端上限。

因此，“获取连接”“建立物理连接”“执行 SQL”“等待网络响应”是不同计时器，名称相似但保护的阶段不同。

## 子预算必须在剩余总预算内

一次调用会先借连接，再执行 SQL、读取结果；查询计时器与网络计时器却可能同时覆盖执行期间的等待，不能把它们画成必然串行的三个耗时段：

```text
入口截止时间约束整个调用
│
├─ 借连接：connectionTimeout
└─ 使用连接
   ├─ 语句执行：queryTimeout 约束执行等待
   │             networkTimeout 同时防范数据库失联
   └─ 读取结果：网络保护继续有效
                 queryTimeout 是否覆盖此阶段取决于驱动
```

假设上游只剩 800 ms：

- 连接池最多等待 250 ms；
- 借到连接后，根据剩余时间设置 SQL/事务预算，例如最多 500 ms；
- 若已经花掉 250 ms，当前只剩 550 ms；网络兜底可以略长于 500 ms 的正常执行预算，但仍须在这 550 ms 内，并为回传留出余量。

这些数值还必须落在工具允许的范围内：HikariCP 7.1.0 的 `connectionTimeout` 最低为 250 ms，不能把 100 ms 的预算直接传给这个配置项；它又是共享池配置，不是每次 `getConnection()` 的独立参数，不能由并发请求临时修改。如果剩余期限不足以容纳既定的借连接上限，应在接纳边界停止这条路径，或使用能够传递逐次期限的获取机制。[HikariCP 超时约束](https://github.com/brettwooldridge/HikariCP#frequently-used)

关键不是把三个固定数值简单相加，而是在真实操作开始前重新计算剩余预算，并核对各计时器覆盖的范围。如果只给借连接设置 300 ms，而 SQL 或网络仍允许等待数秒，整个调用仍可能突破入口的 800 ms；反过来，给两个重叠计时器都设置 500 ms，也不意味着它们各自可以再消费 500 ms。

取消也有边界。JDBC 只承诺超时时驱动至少尝试取消当前语句；`Statement.cancel()` 是否能中止工作取决于驱动和 DBMS 是否支持。客户端收到异常后，数据库端仍可能短暂运行，甚至已经完成提交。因此不能把超时当作事务回滚或幂等保证。[Java SE 25 `Statement.cancel`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html#cancel())

## 取得连接后，给 Statement 设置自己的期限

下面的 Java 25 片段使用应用已经配置的 `javax.sql.DataSource dataSource` 和 `long orderId`，并导入 `java.sql.Connection`，展示取得连接后设置语句超时的位置。`orders` 表需要具有 `id`、`status` 两列，调用方法还应声明或处理 `SQLException`。这是 JDBC 接入示例，执行结果依赖数据库、驱动及表结构，本文没有提供它们的集成实测结果。

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

上面的 2 秒只是便于演示 API，不能直接套用到只剩 500 ms 的请求。`setQueryTimeout(int)` 只有秒级精度：向上取为 1 秒可能突破预算，向下取为 0 又变成无限等待。此时应采用经验证支持更细粒度期限的驱动或数据库能力，或在剩余时间不足时不再启动该语句。仅给外层 `Future.get` 设置 500 ms，会限制调用方等待，但不能证明数据库工作已停止。

## 用集成测试确认驱动到底取消了什么

- **分别观测三个阶段。** 至少记录连接获取耗时、SQL 执行耗时、超时类型和连接池 active/pending 指标。只看接口总耗时无法判断是池饱和、慢 SQL 还是网络故障。
- **用预算而不是孤立常量。** 从请求截止时间扣除已经消耗的时间，再设置后续阶段的上限；在进入数据库前若预算已不足，直接失败比启动一个注定超时的查询更安全。
- **让网络超时晚于正常超时。** 查询或事务超时负责可预期的慢操作，网络超时负责失联连接。反过来会频繁销毁本可复用的连接。
- **验证驱动行为。** 对慢查询、锁等待、流式结果集和网络黑洞分别做集成测试，确认抛出的异常、取消是否送达、连接能否继续使用，以及池是否淘汰该连接。
- **保护有副作用的写入。** 超时后结果可能未知；使用唯一约束、幂等键、条件更新或状态机，使重试不会重复扣款或重复推进状态。
- **不要用扩大池解决慢查询。** 池越大可能让更多并发 SQL 同时争用数据库 CPU、I/O 与锁。先依据数据库容量设定并发上限，再优化索引和访问路径。
