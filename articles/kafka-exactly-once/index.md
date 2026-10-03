---
title: "Kafka Exactly-Once 为什么解决不了数据库与消息双写"
date: "2026-09-10"
updated: 2026-10-03
domain: "MQ"
tags: ["Kafka", "ExactlyOnce", "Outbox"]
---

订单 9001 已经写入 MySQL，用户也看到了创建成功，但库存服务始终没有收到 `OrderCreated`。如果进程恰好在数据库提交后、消息发布前崩溃，这个结果完全可能发生。重启后，程序甚至可能不知道还有哪条消息需要补发。

Kafka 的幂等 Producer 和事务各自提供保证，但要解决这个故障，首先要找到丢失的东西：应用没有把“这笔订单还需要发布事件”可靠地保存下来。

本文采用 Kafka 4.3 的公共契约，沿着订单创建、事件发布和库存消费三步展开：先找出双写窗口，再说明 Kafka 事务覆盖哪里，最后用 Transactional Outbox 保存发布意图，并用消费端幂等处理重发。

## 两种提交顺序都留下故障窗口

最直接的实现先保存订单，再异步发送事件：

```java
orderRepository.save(order);
kafkaProducer.send(new ProducerRecord<>("order-created", serializedEvent));
```

这里沿用 Kafka Client 4.3 的原生 `KafkaProducer`，`serializedEvent` 表示应用已序列化的事件。这个片段没有表达两个操作如何一起提交、发送失败如何恢复。即使把它们放进两个相互协调的事务，提交仍有先后：

### 数据库先提交

```text
1. MySQL COMMIT 成功
2. 进程崩溃
3. Kafka 消息尚未发布
```

订单已经存在，待发事件却可能只在进程内存里。如果没有持久化的补发线索，进程重启后也无法仅靠重试 Producer 恢复这条消息。

### Kafka 先提交

```text
1. Kafka Transaction COMMIT 成功
2. MySQL COMMIT 失败
```

这次变成了另一种不一致：库存服务可以收到订单创建事件，数据库却没有那笔订单。把提交顺序反过来，只是移动了故障窗口。

### 两个事务依次提交

即使代码组织成：

```text
BEGIN MySQL
BEGIN Kafka
写 MySQL
写 Kafka
COMMIT Kafka
COMMIT MySQL
```

这种写法让执行顺序更明确，但两次 COMMIT 仍然分别发生。第一个资源提交后，第二个资源可能失败；普通本地事务没有把它们合成一个原子提交点。

## Kafka 的保证在哪个边界结束

### 幂等 Producer 解决什么

网络请求超时时，Producer 无法立即确定 Broker 是否已成功写入消息。直接重试可能产生：

```text
第一次实际写入成功，但响应丢失
Producer 重试
同一消息再次写入
```

对于这类响应丢失，Kafka 可以用 Producer ID 和序列号识别同一 Producer 会话中的协议重试，避免重复追加日志记录。这处理的是“一次发送是否被 Broker 重复记录”，还没有处理订单表里的状态。

本文采用 Apache Kafka 4.3 的 Producer 契约：

* `enable.idempotence` 默认启用，但冲突配置可能使其失效。
* 幂等要求 `acks=all`、`retries > 0`。
* `max.in.flight.requests.per.connection` 必须不大于 5。
* `acks=all` 是当前可用的最强确认级别。[Apache Kafka 4.3：Producer Configs](https://kafka.apache.org/43/configuration/producer-configs/)

幂等 Producer 的边界是同一会话中的 Kafka 协议重试。应用再次调用 `send()`，或重建 Producer 后重发同一业务事件，并不会自动得到业务去重；数据库业务状态也不在该保证内。[KafkaProducer：幂等范围](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html)

### Kafka Transaction 解决什么

Kafka Transaction 可以把以下操作放入一个 Kafka 事务：

* 向一个或多个 Topic Partition 写入记录。
* 提交本批消费记录对应的 Consumer Offset。

典型拓扑是：

```text
Kafka Topic A
    → 消费、计算
    → Kafka Topic B / C
```

事务提交后，输入 Offset 与输出消息同时生效；事务中止后，两者都不生效。`read_committed` 会过滤已中止的事务记录，并等待未完成事务的可见性边界；非事务消息仍会正常返回，不能理解成“只消费事务消息”。[Consumer isolation.level](https://kafka.apache.org/43/configuration/consumer-configs/)

Kafka 官方明确将一般 Exactly-Once 范围描述为“从 Kafka 读取、处理并写回 Kafka Topic”。对于外部目标系统，需要目标系统参与协调或提供等价机制。[Apache Kafka 4.3：Message Delivery Semantics](https://kafka.apache.org/43/design/design/#message-delivery-semantics)

### 为什么注解不能扩大事务边界

Spring 的：

```java
@Transactional
```

通常由某个 `PlatformTransactionManager` 管理。使用 JDBC 时，它控制数据库连接上的事务；Kafka Transaction Manager 控制 Kafka Producer 事务。

把两种 Transaction Manager 按顺序调用，可以协调执行顺序，却不能凭空建立一个原子提交协议。若第二个资源提交失败，第一个已经提交的资源无法执行真正意义上的回滚。

补偿操作也不等于原子性。例如 Kafka 已发布 `OrderCreated` 后再发布 `OrderCancelled`，两个事件之间仍存在可观测窗口，并且下游可能已发送邮件、扣减库存或调用外部支付系统。

## Outbox 把发布意图写进数据库事务

### 让订单与待发布事件一起提交

为订单 9001 增加一条持久记录，内容是“发布这个 eventId 对应的 OrderCreated”。这条记录和订单使用同一个 MySQL 事务：

```text
同一个 MySQL Transaction
├── INSERT order
└── INSERT outbox_event
```

对这两次插入，事务结束后便只有两种结果：

| 事务结果     | 订单  | Outbox 事件 |
| -------- | --- | --------- |
| COMMIT   | 存在  | 存在        |
| ROLLBACK | 不存在 | 不存在       |

数据库提交后，再由独立中继读取 Outbox 并发布 Kafka：

```text
MySQL Outbox
    → Relay / CDC
    → Kafka
```

发布过程允许重试，因此通常是至少一次：

```text
1. 向 Kafka 发布成功
2. Relay 在记录“已发布”之前崩溃
3. 重启后再次发布
```

只要 Outbox 已可靠保存、记录不会在发布前被清除，且中继能够持续恢复和重试，这个窗口可以通过重发恢复；它通常产生重复，而不要求丢弃未确认的事件。持久化记录本身不能保证最终投递，停机、永久失败、积压和日志保留期限仍需处理。消费者需要依据稳定的 `eventId` 实现幂等。

Debezium 官方将 Outbox Pattern 定义为避免服务内部数据库状态与其他服务消费事件之间的不一致；其 Outbox Event Router 可捕获 Outbox 表变更，并使用事件 ID 支持下游去重。[Debezium：Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)

### Polling Publisher 与 CDC

两种常见中继方式：

| 方案              | 优点                        | 主要代价                             |
| --------------- | ------------------------- | -------------------------------- |
| 应用轮询 Outbox     | 架构简单，依赖较少，应用可完全控制重试       | 需要抢占、批次、状态更新和清理；容易形成数据库轮询压力      |
| CDC，例如 Debezium | 直接读取数据库变更日志；无需高频扫描；通常延迟较低 | 增加 Connector、Schema、位点和变更日志运维复杂度 |

无论选轮询还是 CDC，恢复过程都可能重新交付已经发过的事件。因此中继选择解决的是怎样取得和搬运发布意图，消费端仍需处理重复。

### 同一个 eventId 再次到达时，只保留一次业务结果

假设消费者收到：

```json
{
  "eventId": "418b4b34-e1a3-48ec-bc71-a3da8c5e9f80",
  "type": "OrderCreated",
  "aggregateId": "9001",
  "payload": {}
}
```

可以在消费者自己的数据库事务中同时写入：

```text
业务结果
消费记录 eventId
```

下面的 MySQL 9.7 LTS/InnoDB 表把消费者与事件 ID 组合成唯一键。示例中的 `?` 由应用绑定，DDL、参数绑定及消息确认需要在实际集成中一起验证：

```sql
CREATE TABLE consumed_event (
    event_id     CHAR(36)     NOT NULL,
    consumer     VARCHAR(100) NOT NULL,
    processed_at DATETIME(6)  NOT NULL,
    PRIMARY KEY (event_id, consumer)
) ENGINE = InnoDB;
```

事务流程：

```sql
START TRANSACTION;

INSERT INTO consumed_event(event_id, consumer, processed_at)
VALUES (?, 'inventory-service', CURRENT_TIMESTAMP(6));

-- 执行业务更新

COMMIT;
```

假设库存服务已经处理过订单 9001 的这条事件，第二次投递携带同一个 eventId。插入消费记录时命中唯一键，业务代码就能识别已提交的处理记录，跳过本次重复更新。若第一次处理在提交前失败，去重记录与业务变更一起回滚，下一次仍有机会完整执行。

关键要求是去重记录与业务结果必须位于同一个本地事务中。否则仍会出现：

```text
业务更新成功
进程崩溃
去重记录未写入
事件重投后业务再次执行
```

## 业务写入与中继发布的代码边界

以下片段以 JDK 25 LTS、Spring Framework 7.0.9、Kafka Client 4.3 和 MySQL 9.7 LTS/InnoDB 为目标。Spring 7.0 支持 JDK 25，应用仍需让事务管理器与两个 Repository 使用同一数据源。[Spring 版本与 JDK 兼容范围](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)

这些片段只解释事务边界，本文没有运行 Spring、Kafka 与 MySQL 的联合实验。`OrderRepository`、`OutboxRepository`、序列化器及业务实体是应用提供的组件，片段不构成可以单独启动的完整项目；两个 Repository 必须使用同一数据库和受同一个事务管理器管理的连接。

### Outbox 表

```sql
CREATE TABLE outbox_event (
    id             CHAR(36)      NOT NULL,
    aggregate_type VARCHAR(100)  NOT NULL,
    aggregate_id   VARCHAR(100)  NOT NULL,
    event_type     VARCHAR(100)  NOT NULL,
    payload        JSON          NOT NULL,
    created_at     DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    published_at   DATETIME(6)   NULL,
    PRIMARY KEY (id),
    INDEX idx_outbox_unpublished (published_at, created_at)
) ENGINE = InnoDB;
```

`id` 必须在事件首次创建时生成，重试发布时不能重新生成，否则消费者无法识别重复事件。`created_at` 由数据库在插入时填入，表示持久化意图的时间；它不是全局事件顺序号，不能替代后文按实体维护的发布顺序。

### 同一事务写业务与事件

```java
public record CreateOrder(long customerId, long productId, int quantity) {
}

public record OrderCreated(
        String eventId,
        long orderId,
        long customerId,
        long productId,
        int quantity) {
}
```

```java
@Service
public class OrderApplicationService {

    private final OrderRepository orderRepository;
    private final OutboxRepository outboxRepository;
    private final JsonSerializer jsonSerializer;

    public OrderApplicationService(
            OrderRepository orderRepository,
            OutboxRepository outboxRepository,
            JsonSerializer jsonSerializer) {
        this.orderRepository = orderRepository;
        this.outboxRepository = outboxRepository;
        this.jsonSerializer = jsonSerializer;
    }

    @Transactional
    public long createOrder(CreateOrder command) {
        var order = Order.create(
                command.customerId(),
                command.productId(),
                command.quantity()
        );
        orderRepository.insert(order);

        var eventId = java.util.UUID.randomUUID().toString();
        var event = new OrderCreated(
                eventId,
                order.id(),
                order.customerId(),
                order.productId(),
                order.quantity()
        );

        outboxRepository.insert(new OutboxEvent(
                eventId,
                "Order",
                Long.toString(order.id()),
                "OrderCreated",
                jsonSerializer.serialize(event)
        ));

        return order.id();
    }
}
```

这里没有在数据库事务内直接调用 Kafka。事务提交时，订单和待发布事件一起持久化。该类没有实现代理接口，示例采用类代理，所以不能声明为 `final`；业务入口必须由外部通过 Spring Bean 调用。[Spring 代理限制](https://docs.spring.io/spring-framework/reference/core/aop/proxying.html)

### 至少一次发布

简化的 Polling Publisher 使用原生 `KafkaProducer<String, String>`，配置 `enable.idempotence=true`、`acks=all`，且不设置 `transactional.id`，因此发送的是非事务消息。payload 已序列化为字符串；`ExecutionException` 来自 `java.util.concurrent`。在这个前提下，等待 Broker 确认后才更新数据库标记：

```java
public void publish(OutboxEvent event)
        throws InterruptedException, ExecutionException {
    kafkaProducer.send(
            new ProducerRecord<>(
                    "order-events",
                    event.aggregateId(),
                    event.payload()
            )
    ).get();

    outboxRepository.markPublished(event.id());
}
```

如果 `send().get()` 成功后进程崩溃，`markPublished()` 尚未执行，事件之后会被重新发布。这是预期行为，不应尝试通过不可靠的内存标志消除它。

如果改用 Kafka 事务 Producer，`send().get()` 成功仍不表示事务已提交。必须在 `commitTransaction()` 成功之后才把 Outbox 标记为已发布；否则数据库标记先提交、Kafka 事务随后中止时，消息仍会丢失。事务提交结果未知时也应保留恢复路径，不能先写成功标记。[KafkaProducer 事务提交](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html#commitTransaction())

原生 `KafkaProducer.send()` 返回的是 `Future<RecordMetadata>`，等待方法是 `get()`，不是 `CompletableFuture.join()`。发送失败或被中断时异常向调用方传播，本方法不写已发布标记；上层负责中断策略及有界重试。[KafkaProducer.send](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html#send(org.apache.kafka.clients.producer.ProducerRecord))

按下面的失败点检查恢复流程，比只测试一次成功发送更能验证 Outbox 的边界。表中状态是从上述提交顺序推导的，未作为集成实测结果：

| 失败点 | 持久状态 | 恢复动作 |
| --- | --- | --- |
| 业务事务提交之前 | 订单与 Outbox 都未提交 | 按业务请求的幂等规则重新尝试 |
| 数据库已提交，Kafka 尚未确认 | Outbox 待发布 | 用原 `eventId` 重发；响应丢失时也可能重复 |
| Kafka 已确认，`markPublished` 尚未提交 | Kafka 可能已有消息，Outbox 仍待发布 | 允许重发，由消费者去重 |
| 已发布标记提交之后 | Outbox 记录已完成 | 按保留策略归档 |

把这个方法放进持续运行的中继后，还需要决定哪些实例负责哪些记录，以及失败后何时重试。多个 Publisher 要协调任务抢占；批量发送要给数据库和 Kafka 留出可承受的负载；持续失败的事件需要记录原因并进入人工处理或其他明确路径。已发布记录可以按保留策略归档，但待确认记录不能提前清除。

如果使用 Debezium CDC，应用不再维护 `published_at` 也很常见：Outbox 行只负责追加，由 Connector 从 Binlog 捕获，清理由独立保留策略完成。

## 重复、顺序与外部副作用

### 把事件 ID、业务 ID 和 Kafka Key 分开

| 标识 | 对订单 9001 的含义 | 是否在重发时改变 |
| --- | --- | --- |
| eventId | 这一次 OrderCreated 事件的身份 | 不改变，否则无法去重 |
| aggregateId | 事件所属订单，值为 9001 | 同一订单的不同事件相同 |
| Kafka Key | 用于选择分区，常采用订单 ID | 同一实体采用一致的分区策略 |

同一订单的 `OrderCreated`、`OrderPaid` 和 `OrderCancelled` 使用相同 Kafka Key，可以让它们进入同一个 Partition。但 Kafka 保存的是进入 Partition 的顺序，不会按业务时间替并行 Publisher 自动重排。若同一实体的事件被不同 Worker 倒序发送，即使用同一个 Key，消费者也会观察到倒序；中继还需有按实体串行发布、序号校验或其他符合业务需求的顺序策略。跨 Partition 也没有全局顺序保证。

### 幂等应建立在持久状态上

以下内存集合不能用于可靠去重：

```java
private final Set<String> processedEventIds =
        ConcurrentHashMap.newKeySet();
```

重启后集合丢失，多实例之间也不共享。

更可靠的方式包括：

* 数据库唯一键。
* 业务状态条件更新。
* 幂等结果表。
* 下游 API 提供持久化 Idempotency Key。

例如库存扣减可以使用事件 ID 唯一约束，也可以把合法状态迁移写入条件：

```sql
UPDATE inventory_reservation
SET status = 'CONFIRMED'
WHERE order_id = ?
  AND status = 'PENDING';
```

然后检查影响行数。哪种方式更合适取决于“重复请求应返回原结果”还是“重复状态转换只需不产生第二次副作用”。

### 外部副作用无法靠数据库回滚

发送邮件、短信或 HTTP 请求后，即使本地事务回滚，外部动作也可能已经发生。

需要将这些动作继续建模为事件驱动步骤：

```text
消费 OrderCreated
    → 本地事务写 EmailJob
    → 独立 Worker 发送
    → 使用 eventId / jobId 防重
```

这里又出现了与开篇相同的结构：先可靠保存需要发送邮件的意图，再由 Worker 执行。邮件服务能否按 jobId 去重，则决定最后一次外部调用能获得什么保证；仅在本地写去重记录，还不能撤回已经发出的邮件。

### 监控积压，而不只监控错误率

订单接口可以持续成功，发布中继却已经停止。要发现这种状态，最直接的是观察最旧未发布事件的年龄和未发布数量：前者反映一笔订单等待了多久，后者反映等待队列是否在增长。

定位原因时再看发布成功率、重试次数、Producer 错误；使用 CDC 时查看 Connector Lag，使用 Kafka 事务时查看中止率。消费者重复事件比例和失败队列中的记录，则帮助区分恢复重放与持续处理失败。监控需要能回答“哪一步停了、哪些事件受影响”，而不只是收集一组错误计数。

### 何时直接使用 Kafka Transaction

适合：

```text
Kafka 输入 → 纯计算 → Kafka 输出
```

例如聚合、过滤、Join 和 Topic 间转换。

如果输出落入关系数据库，提交边界又回到目标系统：可以让业务结果与消费位置共同持久化，或者用本文的事件 ID 去重，再确认消息。使用 Kafka Connect 等实现时，也要核对具体 Connector 怎样协调消费位置与目标写入，而不是仅凭组件名称推断保证。

Kafka 官方也指出，写入外部系统时，关键在于协调 Consumer Position 与外部输出；一种方案是把 Offset 与输出存入同一目标系统事务中。[Apache Kafka 4.3：外部系统一致性](https://kafka.apache.org/43/design/design/#message-delivery-semantics)

消费者数据库已经提交、Kafka Offset 尚未提交时发生崩溃，仍可能重新消费。因此去重记录的保留时间要覆盖系统允许的重放窗口；清理过早，会使旧事件重新产生副作用。若最终步骤是外部 API，还要使用对方支持的幂等键或承认该边界的重复风险，不能把本地去重表当作任意外部动作的一次性保证。
