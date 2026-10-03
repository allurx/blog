---
title: "AFTER_COMMIT 监听器为什么可能写不进数据库"
date: 2026-09-20
updated: 2026-10-03
domain: "Spring"
tags: ["Spring","TransactionalEventListener","事务"]
---

订单已提交，`AFTER_COMMIT` 监听器也调用了 `save()`，投影表里却没有新记录。问题在于“事务完成”和“事务资源解绑”是两个时刻：完成阶段仍可能拿到原连接或持久化上下文，但已经没有下一次提交来保存新增修改。

以“订单提交后再建立查询投影”为例，先要判断投影允许何时出现：必须与订单一起成功，还是可以稍后补齐？这个选择决定了写入应该留在原事务、使用新的事务，还是保存为可恢复的待处理事件。

下面先看提交时间线，再比较三种边界。讨论限定为 `PlatformTransactionManager` 管理的命令式事务，依据 Spring Framework 7.0.9 的事务事件语义。

## 提交完成了，资源却可能还在

事务事件监听器不是一个新的事务容器，而是把回调挂到现有事务的同步生命周期上。默认阶段是 `AFTER_COMMIT`；还可选择 `BEFORE_COMMIT`、`AFTER_ROLLBACK` 和 `AFTER_COMPLETION`。若发布事件时没有事务，默认不会调用监听器，除非显式设置 `fallbackExecution=true`。[事务绑定事件阶段](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)

### 监听器运行在提交与资源清理之间

以成功提交为例，关键时间线是：

```text
业务方法写入订单
  → 发布应用事件并登记事务同步回调
  → flush / beforeCommit
  → 数据库 commit              ← 原事务在这里完成
  → TransactionSynchronization.afterCommit()
  → afterCompletion(COMMITTED) ← AFTER_COMMIT 事件监听器在这里运行
  → 解绑并清理线程资源
```

`TransactionPhase.AFTER_COMMIT` 是成功完成分支，实际属于 `afterCompletion` 序列，并不等同于 `TransactionSynchronization.afterCommit()`。两者都发生在提交之后，但异常传播方式不同，不能只看名字把它们合并成一个回调。[Spring 7.0.9 `TransactionPhase`](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/transaction/event/TransactionPhase.html#AFTER_COMMIT)

“已经提交”与“资源已经清理”并非同一个时刻。事件监听器执行时，原事务资源仍可能可访问，数据访问代码也可能沿用它们。不过提交动作已经过去，不会为新增修改再执行第二次 commit。能拿到 EntityManager 或连接，不代表正处于一个还能提交的事务里。

### 为什么普通 REQUIRED 还不够

`PROPAGATION_REQUIRED` 的含义是有事务就加入，没有事务才新建。在这个窄窗口里，资源状态可能让它看起来仍在参与原事务，因此不能用普通 `REQUIRED` 表达“提交之后再开一次事务”。`PROPAGATION_REQUIRES_NEW` 才明确要求独立的物理事务，拥有自己的提交或回滚结果。[Spring 事务传播参考](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

## 按一致性要求选择写入边界

### 提交后的回调不能改变原结果

`AFTER_COMMIT` 只在主事务成功提交后触发，监听器失败不能撤销已经提交的订单。对于这里讨论的标准命令式事务同步路径，`afterCompletion` 中的异常会被记录，而不会像直接注册的 `afterCommit()` 异常一样向提交调用方传播。因此也不能靠 HTTP 请求是否成功来判断后处理是否成功，监听器需要自己的失败观测与恢复路径。[Spring 7.0.9 `afterCompletion`](https://docs.spring.io/spring-framework/docs/7.0.9/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html#afterCompletion(int))

若某项数据库变更必须与订单同成同败，它就不应放在 `AFTER_COMMIT`：应直接在原事务中执行，或谨慎使用 `BEFORE_COMMIT`。后者仍位于提交前，异常可使事务走向回滚，但 `beforeCommit` 本身也不保证最终一定提交——之后仍可能回滚。

### 新事务必须穿过 Spring 代理

正确边界通常是“监听器 Bean 调用写入 Bean”。`REQUIRES_NEW` 标注在另一个受 Spring 管理的 Bean 的公开方法上，跨 Bean 调用会经过事务代理。若把方法写在同一个类里再用 `this.write()` 调用，代理会被绕过，`REQUIRES_NEW` 也就不会生效。

对后面的同步监听器示例，假定投影表原先没有该订单记录，也没有额外重试，按事务边界可以推导出三种不同结果：

| 发生的情况 | 新订单 | 新投影 |
| --- | --- | --- |
| 主事务回滚 | 不存在 | 监听器不执行，不存在 |
| 主事务提交，独立投影事务提交 | 存在 | 存在 |
| 主事务提交，独立投影事务失败 | 存在 | 不存在 |

最后一行是设计允许的独立失败，不会撤销订单；这张表不是数据库实测记录。工程上必须决定：失败只记日志、有限重试、进入补偿队列，还是根本不允许这种可靠性缺口。独立事务也意味着外层事务资源仍可能占用，而内层事务需要另一条数据库连接；高并发下，连接池过小会导致等待甚至相互阻塞。Spring 官方建议连接池容量至少比并发线程数多 1，实际还要按嵌套深度和其他连接使用量验证。[`REQUIRES_NEW` 资源影响](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html#tx-propagation-requires_new)

### 需要崩溃恢复时，把待处理记录写入 Outbox

`REQUIRES_NEW` 能给提交后的数据库写入一个真正的事务，却不能保证进程在“订单已提交”和“监听器开始执行”之间不崩溃，也不能把数据库提交与 Kafka、邮件或 HTTP 调用变成一个原子动作。

Outbox 的做法是在原业务事务中同时写入业务数据和待投递记录。提交后由独立工作器扫描、投递并以幂等键处理重复。这把不可避免的失败窗口变成可恢复状态；代价是最终一致性、重复投递处理和清理机制。

## 让投影写入经过独立事务代理

选择允许独立提交的投影后，可以让监听器只转交订单 ID，由写入组件建立新的事务。下面的调用关系与前面“订单已存在、投影可以独立失败”的选择对应。

### 事件、监听器与写入组件

下面以 JDK 25 LTS、Spring Framework 7.0.9、Spring Data JPA 4.1.1 与 Hibernate ORM 7.4.5.Final 为目标组合；后三者来自 Spring Boot 4.1.1 的依赖管理，JDK 25 在该版本支持范围内。应用采用 Boot 时可沿用这组 BOM，避免独立升级其中一个组件后仍假设组合兼容。[依赖版本](https://docs.spring.io/spring-boot/appendix/dependency-versions/coordinates.html) · [Java 支持范围](https://docs.spring.io/spring-boot/system-requirements.html)

这是接入已有应用的结构示例，省略实体、Repository、import 和事务管理配置，不能单独作为源文件运行。本文没有提供该组合的数据库集成实测结果；代码用于明确事件回调与独立事务的调用边界。

```java
public record OrderCommitted(long orderId) {}

@Service
class OrderService {
    private final OrderRepository orders;
    private final ApplicationEventPublisher events;

    OrderService(OrderRepository orders, ApplicationEventPublisher events) {
        this.orders = orders;
        this.events = events;
    }

    @Transactional
    public long createOrder(CreateOrder command) {
        Order order = orders.save(Order.from(command));
        events.publishEvent(new OrderCommitted(order.id()));
        return order.id();
    }
}

@Component
final class OrderProjectionListener {
    private final ProjectionWriter writer;

    OrderProjectionListener(ProjectionWriter writer) {
        this.writer = writer;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(OrderCommitted event) {
        writer.write(event.orderId()); // 跨 Bean，经过事务代理
    }
}

@Service
class ProjectionWriter {
    private final OrderProjectionRepository projections;

    ProjectionWriter(OrderProjectionRepository projections) {
        this.projections = projections;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void write(long orderId) {
        projections.save(new OrderProjection(orderId));
    }
}
```

这里的两个事务 Bean 没有服务接口，因此使用类代理时不能声明为 `final`，事务方法也必须可被覆盖。拆到另一个 Bean 只是代理生效的条件之一，还要确保代理能够建立。[Spring 代理机制](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)

投影表应设置业务唯一键，例如 `order_id`，防止重复事件生成重复行；要实现成功重放，还需明确处理唯一键冲突或采用合适的 upsert，唯一约束本身不会把第二次调用变成成功。测试时应在测试事务之外重新查询数据库，分别覆盖主事务提交、主事务回滚、内层事务失败和重复事件。

### 必须一起保存时，改回原事务

若投影属于强一致业务状态，更简单的实现是在 `createOrder()` 的同一事务中直接写入。若事件要可靠发送到外部系统，则在同一事务中写 Outbox：

```java
@Transactional
public long createOrder(CreateOrder command) {
    Order order = orders.save(Order.from(command));
    outbox.save(OutboxEvent.pending("OrderCommitted", order.id()));
    return order.id();
}
```

## 从数据库结果判断监听器是否成功

测试时，在测试事务之外重新查询订单表和投影表。分别让主事务回滚、投影写入失败，并重复发布同一事件，才能区分“没有执行”“执行失败”和“已经独立提交”。日志记录事件 ID、订单 ID 和事务结果，可以将这些观察串起来；看到 `save()` 被调用还不够。

同步监听器仍占用发布事件的线程，内层事务也可能在外层连接尚未释放时申请另一条连接。并发压测需要同时观察请求耗时、连接池等待和监听器失败，否则慢后处理可能被误当成订单提交变慢。

若改成 `@Async`，处理器要在自己的线程里建立事务，异常也需要由异步执行路径处理。它能缩短请求等待，但内存中的任务仍可能因进程退出而丢失。需要恢复这些工作时，前面的 Outbox 记录才提供了重新开始的依据。

最后，无事务发布默认不会触发事务监听器。启用 `fallbackExecution=true` 会增加“立即执行”的路径，监听器因而不能再假定自己总在一次成功提交之后运行。是否启用，应由事件在没有事务时究竟代表什么决定。
