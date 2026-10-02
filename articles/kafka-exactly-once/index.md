---
title: "Kafka Exactly-Once 为什么解决不了数据库与消息双写"
date: "2026-09-10"
updated: "2026-10-01"
domain: "MQ"
tags: ["Kafka", "ExactlyOnce", "Outbox"]
---

订单已经写入 MySQL，`OrderCreated` 却没能到达 Kafka，是消息系统常见的双写故障。开启幂等 Producer，或者给方法加上 `@Transactional`，都不能自动让这两个独立资源拥有同一个提交点。

Kafka 的 Exactly-Once Semantics 必须连同范围一起讨论：Producer 重试、Kafka 消息与消费位点可以得到各自保证，外部数据库、HTTP 调用和邮件发送则需要额外的协调。本文采用 Kafka 4.3 的公共契约，以订单和事件为例说明 Transactional Outbox 如何把不可恢复的双写窗口转为可重试的发布过程。

## 两种提交顺序都留下故障窗口

最直接的实现先保存订单，再异步发送事件：

```java
orderRepository.save(order);
kafkaTemplate.send("order-created", event);
```

它没有表达两个操作如何一起提交、发送失败如何恢复。即使把它们放进两个相互协调的事务，提交仍有先后：

### 数据库先提交

```text
1. MySQL COMMIT 成功
2. 进程崩溃
3. Kafka 消息尚未发布
```

结果：订单存在，但下游永远收不到事件。

### Kafka 先提交

```text
1. Kafka Transaction COMMIT 成功
2. MySQL COMMIT 失败
```

结果：下游收到订单创建事件，但订单在数据库中不存在。

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

两个独立资源也无法在普通本地事务中同时完成不可撤销提交。无论选择哪一个先提交，两个提交之间都存在故障窗口。

## Kafka 的保证在哪个边界结束

### 幂等 Producer 解决什么

网络请求超时时，Producer 无法立即确定 Broker 是否已成功写入消息。直接重试可能产生：

```text
第一次实际写入成功，但响应丢失
Producer 重试
同一消息再次写入
```

Kafka 的幂等 Producer 使用 Producer ID 和序列号，让 Broker 识别同一 Producer 会话中的重试，避免重试产生重复日志记录。

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

### Transactional Outbox

核心思想是把必须原子完成的写入收缩到一个资源中：

```text
同一个 MySQL Transaction
├── INSERT order
└── INSERT outbox_event
```

只存在两种提交结果：

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

CDC 并没有把端到端语义变成神奇的 Exactly Once。Connector 或下游仍可能重放事件，消费者依然需要幂等。

### 消费端幂等

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

并对 `event_id` 建立唯一约束：

```sql
CREATE TABLE consumed_event (
    event_id     CHAR(36)     NOT NULL,
    consumer     VARCHAR(100) NOT NULL,
    processed_at DATETIME(6)  NOT NULL,
    PRIMARY KEY (event_id, consumer)
);
```

事务流程：

```sql
START TRANSACTION;

INSERT INTO consumed_event(event_id, consumer, processed_at)
VALUES (?, 'inventory-service', CURRENT_TIMESTAMP(6));

-- 执行业务更新

COMMIT;
```

若事件已处理，唯一键冲突表明本次是重复投递。业务代码可以确认其已经成功处理，而不是再次执行副作用。

关键要求是去重记录与业务结果必须位于同一个本地事务中。否则仍会出现：

```text
业务更新成功
进程崩溃
去重记录未写入
事件重投后业务再次执行
```

## 业务写入与中继发布的代码边界

以下展示 Java 21、Spring Framework 6、MySQL 8.4 下的应用边界。`OrderRepository`、`OutboxRepository`、序列化器及业务实体是应用提供的组件，片段不构成可以单独启动的完整项目；两个 Repository 必须使用同一数据库和受同一个事务管理器管理的连接。

### Outbox 表

```sql
CREATE TABLE outbox_event (
    id             CHAR(36)      NOT NULL,
    aggregate_type VARCHAR(100)  NOT NULL,
    aggregate_id   VARCHAR(100)  NOT NULL,
    event_type     VARCHAR(100)  NOT NULL,
    payload        JSON          NOT NULL,
    created_at     DATETIME(6)   NOT NULL,
    published_at   DATETIME(6)   NULL,
    PRIMARY KEY (id),
    INDEX idx_outbox_unpublished (published_at, created_at)
) ENGINE = InnoDB;
```

`id` 必须在事件首次创建时生成，重试发布时不能重新生成，否则消费者无法识别重复事件。

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

简化的 Polling Publisher 使用原生 `KafkaProducer<String, String>`，假定 payload 已序列化为字符串；`ExecutionException` 来自 `java.util.concurrent`。这里等待 Broker 确认后才更新数据库标记：

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

原生 `KafkaProducer.send()` 返回的是 `Future<RecordMetadata>`，等待方法是 `get()`，不是 `CompletableFuture.join()`。发送失败或被中断时异常向调用方传播，本方法不写已发布标记；上层负责中断策略及有界重试。[KafkaProducer.send](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/producer/KafkaProducer.html#send(org.apache.kafka.clients.producer.ProducerRecord))

完整工程还需处理：

* 多 Publisher 实例的任务抢占。
* 批量发送和背压。
* 指数退避与永久失败事件。
* Outbox 积压告警。
* 已发布记录的归档或清理。
* 发布顺序与同一 Aggregate 的分区键。

如果使用 Debezium CDC，应用不再维护 `published_at` 也很常见：Outbox 行只负责追加，由 Connector 从 Binlog 捕获，清理由独立保留策略完成。

## 重复、顺序与外部副作用

### 把事件 ID、业务 ID 和 Kafka Key 分开

* `eventId`：一次事件事实的唯一身份，用于去重。
* `aggregateId`：所属业务实体，例如 `orderId`。
* Kafka Key：决定 Partition，通常采用 `aggregateId` 以维持同一实体事件顺序。

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

系统级可靠性来自每个边界上的持久意图、重试和幂等，而不是一个跨越所有服务的巨大事务。

### 监控积压，而不只监控错误率

Outbox 系统最危险的状态通常不是直接报错，而是事件长期未发布。至少监控：

* 最旧未发布事件年龄。
* 未发布事件数量。
* 发布成功率与重试次数。
* CDC Connector Lag。
* Kafka Producer 错误与事务中止率。
* 消费者重复事件比例。
* Dead Letter Queue 数量。

“接口创建订单成功”不能证明事件链路健康。

### 何时直接使用 Kafka Transaction

适合：

```text
Kafka 输入 → 纯计算 → Kafka 输出
```

例如聚合、过滤、Join 和 Topic 间转换。

如果输出落入关系数据库，应优先考虑：

* 在数据库事务中保存业务结果和已消费 Offset。
* 使用事件 ID 对数据库写入去重。
* 使用 Kafka Connect 等与目标系统协作的实现。

Kafka 官方也指出，写入外部系统时，关键在于协调 Consumer Position 与外部输出；一种方案是把 Offset 与输出存入同一目标系统事务中。[Apache Kafka 4.3：外部系统一致性](https://kafka.apache.org/43/design/design/#message-delivery-semantics)

消费者数据库已经提交、Kafka Offset 尚未提交时发生崩溃，仍可能重新消费。因此去重记录的保留时间要覆盖系统允许的重放窗口；清理过早，会使旧事件重新产生副作用。若最终步骤是外部 API，还要使用对方支持的幂等键或承认该边界的重复风险，不能把本地去重表当作任意外部动作的一次性保证。
