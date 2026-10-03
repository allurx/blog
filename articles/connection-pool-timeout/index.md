---
title: "连接池超时为什么拦不住慢 SQL"
date: 2026-09-24
updated: 2026-10-03
domain: "数据库"
tags: ["ConnectionPool","JDBC","Timeout"]
---

把 HikariCP 的 `connectionTimeout` 设成 300 ms，接口却仍被慢 SQL 卡了几秒。这个配置可能完全正常地生效了：请求在 20 ms 内借到连接，池的等待任务已经结束，后面的查询还没有受到相应的执行期限约束。

连接池管理的是有限连接怎样分配，查询和网络则各有计时器。下面沿“借连接、执行 SQL、读取结果”的顺序区分它们，再看为什么一个 800 ms 的请求预算不能直接换成几个同样大小的配置值。

本文的目标组合是 JDK 25 LTS、HikariCP 7.1.0、MySQL Connector/J 26.7.0 与 MySQL 9.7 LTS。HikariCP 的 Java 11+ 要求、驱动的 Java 8+ 和 MySQL 8.4+ 要求均覆盖这一组合；这里只据公共契约解释边界，没有运行数据库取消实验。[HikariCP 依赖要求](https://github.com/brettwooldridge/HikariCP#artifacts) · [Connector/J 兼容范围](https://dev.mysql.com/doc/connector-j/en/connector-j-versions.html)

## 先确定请求停在哪个阶段

### 连接池超时是容量保护

池的职责是复用有限的物理连接。连接全部在用时，新请求在队列中等待；`connectionTimeout` 给这段等待设置上限。它解决的是“没有连接可借时，调用线程最多排多久”，并帮助系统在过载时快速失败。

这个超时触发时，SQL 根本还没有开始。把值调大不会提高数据库吞吐量，只会允许更多调用线程积压，并把尾延迟和内存占用推高。

### 查询超时是执行预算

JDBC `Statement.setQueryTimeout(int seconds)` 限制驱动等待语句执行的秒数，默认值 `0` 表示没有限制；超限时抛出 `SQLTimeoutException`。JDBC 规范要求驱动将它应用于 `execute`、`executeQuery` 和 `executeUpdate`，但批处理的计时粒度以及是否覆盖 `ResultSet` 读取由实现决定。[Java SE 25 `Statement`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html#setQueryTimeout(int))

这意味着查询超时应在每个实际执行 SQL 的 `Statement` 上生效，不能由池的等待超时代替。框架提供的事务超时通常会进一步把剩余预算映射到语句，但具体传播方式仍需用所选框架与驱动做集成验证。

### 网络超时是失联兜底

JDBC `Connection.setNetworkTimeout` 限制连接等待数据库响应的时间，触发后连接会被标记为关闭。规范明确指出它与查询超时相互独立，而且应设置得足够高，不要早于更正常的事务或查询超时触发。[Java SE 25 `Connection`](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html#setNetworkTimeout(java.util.concurrent.Executor,int))

驱动还可能提供 `socketTimeout`。例如 MySQL Connector/J 用它限制网络套接字操作，默认 `0` 表示无限等待。[MySQL Connector/J 网络属性](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-networking.html)

网络套接字超时约束的是网络操作等待，不是整个结果集的总耗时。由此可知，流式结果持续返回小块数据时，每次等待都很短，总读取时间却仍可能超过入口预算；这时还需在读取和取消边界尊重请求截止时间，不能仅靠 `socketTimeout` 保证端到端上限。

### 建立物理连接有另一个 connectTimeout

池里没有可复用连接、需要新建物理连接时，才涉及 TCP 建连。MySQL Connector/J 的 `connectTimeout` 约束这一过程，默认 `0` 也表示无限等待。它与 HikariCP 的 `connectionTimeout` 名称接近，但前者针对驱动建立连接，后者针对调用者向池借连接的等待，不能互相替代。

## 把各阶段放回 800 ms 的总预算

### 有些计时器重叠，不能直接相加

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

### 配置项的精度与作用域也限制了预算传播

这些数值还必须落在工具允许的范围内：HikariCP 7.1.0 的 `connectionTimeout` 最低为 250 ms，不能把 100 ms 的预算直接传给这个配置项；它又是共享池配置，不是每次 `getConnection()` 的独立参数，不能由并发请求临时修改。如果剩余期限不足以容纳既定的借连接上限，应在接纳边界停止这条路径，或使用能够传递逐次期限的获取机制。[HikariCP 超时约束](https://github.com/brettwooldridge/HikariCP/tree/HikariCP-7.1.0#frequently-used)

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

## 用驱动和数据库的实际行为验收超时

对开篇那次慢请求，先把借连接与执行 SQL 的耗时分开记录，并观察池的 active、pending 数量。借连接很快、SQL 很慢时，增大 `connectionTimeout` 不会缩短查询；若所有连接都被慢查询占住，扩大池还可能让数据库承受更多并发争用。

验证时分别制造慢查询、锁等待、缓慢返回的结果集和网络失联。除了客户端的异常与耗时，还要观察数据库端语句是否结束、连接是否可复用、池何时回收或淘汰它。查询超时与网络超时会走不同的资源处理路径，单次超时异常不能证明整条链已经停止。

写入还多一个提交结果问题：客户端超时以后，数据库可能已经提交。重试付款或状态更新前，应能通过唯一约束、幂等键或结果查询确认同一次操作，不能把“没有及时收到结果”解释成“没有写入”。
