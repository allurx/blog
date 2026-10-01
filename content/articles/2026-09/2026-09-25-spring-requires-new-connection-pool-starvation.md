---
title: "REQUIRES_NEW 为什么会耗尽连接池"
date: 2026-09-25
updated: 2026-10-01
id: 2026-09-25-spring-requires-new-connection-pool-starvation
domain: "Spring"
tags: ["Spring","Transaction","ConnectionPool"]
---

四个线程各开一个外层事务，恰好占满四条数据库连接，然后一起调用 `REQUIRES_NEW` 写审计。内部事务都要再借一条连接，外部事务又只有等内部返回才能释放连接，于是所有线程都卡在连接获取上。

“挂起事务”只是暂存事务上下文，不是归还已借出的连接。独立提交带来了独立连接需求；获取超时最终可能打破等待，却只是让业务失败。解决它需要调整事务边界、限制同时进入嵌套事务的请求，并按数据库承载能力安排容量。

## 挂起外层事务为什么没有释放连接

### 逻辑事务与物理事务不是一回事

Spring 官方文档明确说明，`REQUIRES_NEW` 总是使用独立的物理事务；外层事务的资源保持绑定，内部事务需要获取自己的连接。多个线程同时处于这种状态时，可能耗尽连接池甚至形成潜在死锁，官方给出的最低经验规则是：连接池容量至少比并发线程数多 1。[Spring Framework 7.0.9：事务传播](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

这里的“挂起”是事务管理器暂停当前事务上下文，让内部调用暂时看不到它；它不等于提交或回滚外层事务，也不等于释放外层事务已经借出的连接。以 JDBC 的 `DataSourceTransactionManager` 为例，一个 `DataSource` 的连接会绑定到当前线程，事务完成后才释放。[DataSourceTransactionManager 7.0.9 API](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/jdbc/datasource/DataSourceTransactionManager.html)

内部事务必须有独立连接，是因为它要独立提交或回滚：内部提交后，即使外层随后回滚，内部结果仍然保留；内部的隔离级别、超时和只读属性也可以独立设置。这些语义不能复用一个尚未结束的 JDBC 物理事务来实现。

### 等待闭环如何形成

假设连接池上限为 4，恰好有 4 个工作线程同时执行：

1. 每个线程进入外层事务，各借到 1 个连接，池中空闲连接变为 0。
2. 每个线程到达 `REQUIRES_NEW` 边界，外层事务被挂起，但 4 个外层连接仍被占用。
3. 每个线程都同步申请第 2 个连接；没有任何申请能成功。
4. 线程只有在内部调用返回后才能结束外层事务并归还第 1 个连接，但内部调用正在等待第 2 个连接。

这不是数据库行锁死锁，而是应用侧的资源分配死锁形态。HikariCP 达到 `maximumPoolSize` 且无空闲连接时，`getConnection()` 最多阻塞到 `connectionTimeout`，随后抛出 `SQLException`。[HikariCP 7.1.0 配置](https://github.com/brettwooldridge/HikariCP#configuration-knobs-baby) 因而常见表象是请求集中等待约 30 秒后失败，而不是永久挂住；超时打破了等待，却没有让业务成功。

## 沿调用链计算同时占用量

典型代理调用链可简化为：

1. 事务拦截器为外层方法创建事务，事务管理器从 `DataSource` 取得连接并将资源绑定到当前线程。
2. 调用进入另一个 Spring 代理，拦截器识别 `REQUIRES_NEW`，保存并解绑外层事务上下文。
3. 事务管理器创建内部事务，再次从同一个连接池借连接。
4. 内部事务提交或回滚并归还内部连接，然后恢复外层事务上下文。
5. 外层事务最终完成，才归还外层连接。

因此一次线程调用在第 3 步可能同时占用两个连接。若还有更深层的独立事务，单个调用的瞬时占用可能继续增加。可用下面的容量思路做上界检查：

```text
所需连接数 ≈ 已持有外层连接 O + 同时申请的独立内层连接 I + 其他负载与安全余量 R
```

这是容量推导，不是 Spring 的固定公式。官方“并发线程数 + 1”只保证单层嵌套且负载模型简单时至少可能有一个内部事务取得进展；若每个线程都需要快速完成、存在多层嵌套、后台任务或健康检查也使用数据库，就需要根据实测的 `I` 和 `R` 继续留量。盲目把连接池调得很大也会把压力转移到数据库，容量应同时受数据库承载能力约束。

还要注意，默认代理模式只拦截经过代理的调用。同一个对象里的自调用不会触发新的事务边界；这种情况下表面写了 `REQUIRES_NEW`，实际可能仍在外层事务里。Spring 官方文档建议在代理模式下通过代理调用目标方法。[Spring `@Transactional` 文档](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)

## 四条连接与五条连接的对照

下面的 Java 17 实验用公平 `Semaphore` 模拟连接池。每个工作线程先持有“外层连接”，栅栏确保所有外层事务同时占满池，再申请“内部连接”。它不模拟 Spring 全部行为，只隔离验证连接分配这一条因果链。

完整源码：[RequiresNewPoolStarvationDemo.java](RequiresNewPoolStarvationDemo.java)

运行方式：

```bash
java -ea RequiresNewPoolStarvationDemo.java
```

2026-10-01 修订时，使用 JDK 25.0.2 执行附件并启用断言，输出：

```text
Result[workers=4, poolSize=4, innerSuccess=0, innerTimeouts=4, maxInUse=4]
Result[workers=4, poolSize=5, innerSuccess=4, innerTimeouts=0, maxInUse=5]
```

第一组用第二道栅栏保留所有外层连接，直到内部申请全部结束，因此四次内部申请都超时；真实应用可能在首次超时后释放外层连接，让其他线程继续。第二组增加一个连接后，内部事务能依次取得进展。这说明额外容量可以打破该模型的单层等待闭环，不代表已经满足生产吞吐或其他连接消费者的需求。

## 先调整事务边界，再验证容量

### 先从事务边界消除问题

- 不要在外层数据库事务中执行 HTTP、文件操作、消息确认或长时间计算；外层持有连接越久，重叠到 `REQUIRES_NEW` 峰值的概率越高。
- 如果内部动作可以稍后执行，让它在外层资源释放后运行。仅搬到同步 `AFTER_COMMIT` 监听器并不能保证释放外层连接；若要求“主数据提交与事件最终可靠一致”，使用同一事务写 Outbox，再由独立消费者处理。
- 只有确实需要“内部结果不受外层回滚影响”时才使用 `REQUIRES_NEW`，并让内部事务足够短。
- 用单独线程池限流内部工作只有在调用者不持有外层连接同步等待时才安全；把任务提交给另一个线程后立刻 `get()`，仍可能保留同样的等待关系。

### 容量与保护

- 压测要覆盖“并发外层事务同时到达嵌套边界”的场景，而不仅是平均吞吐量。
- 以峰值 `O + I + R` 校验连接池，并确认数据库的最大连接数、CPU 与锁竞争能够承担该容量。
- 为连接获取设置有限超时，使故障快速暴露；但不要把缩短 `connectionTimeout` 当成修复，它只改变失败速度。
- 对进入独立事务的路径设置并发上限和超时预算，避免一个次要审计或通知动作拖垮主路径。

### 诊断证据链

连接池指标通常会同时出现：`active == maximumPoolSize`、`idle == 0`、等待连接的线程数持续上升。线程转储中，大量业务线程停在连接池的 `getConnection()`，其调用栈上方能看到内部事务入口；与此同时，数据库会话仍显示外层事务持有的连接。把这三类证据按同一时间窗口对齐，比只看“连接池超时”日志更能确认根因。

`NESTED` 不能作为语义等价的省连接替换：它通常使用同一物理事务中的保存点，外层回滚仍会回滚全部结果。只有业务接受这一语义且事务管理器支持时才可选择。JTA/XA 的挂起能力和资源登记也应按对应管理器核对。
