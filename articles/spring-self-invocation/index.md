---
title: "Spring 事务为什么会在同类方法调用时失效"
date: "2026-09-03"
updated: 2026-10-03
domain: "Spring"
tags: ["Spring", "Transaction", "AOP"]
---

订单保存和库存扣减都能单独执行，不代表 Service 上的事务已经生效。一个常见故障是：同一对象内部调用带 `@Transactional` 的方法，数据库写入看起来正常，多步失败时却没有按预期一起回滚。

本文以 JDK 25 LTS、Spring Framework 7.0.9 为基线，讨论命令式事务和默认 `proxy` 模式。事务注解由代理拦截器解释；目标对象的普通内部调用不再次经过该代理，因此内层方法的传播、隔离、只读、超时和回滚规则不会被独立应用。[Spring：声明式事务注解](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)

这个版本组合处在 Spring 官方列出的兼容范围内；升级已有项目时，还应一起核对 Jakarta API 与持久化实现。[Spring 版本与兼容范围](https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-Versions)

## 事务注解取决于调用经过哪里

以下是接入现有应用的结构片段，假定已启用事务管理，Repository 与业务类型已由应用提供。本文没有运行数据库集成实验，后面的回滚与传播结果按代理契约推导。外部调用 `createOrder()` 后，`saveItem()` 上的注解不会为它单独建立事务边界：

```java
@Service
public class OrderService {

    public void createOrder(Order order) {
        validate(order);
        saveItem(order);
    }

    @Transactional
    public void saveItem(Order order) {
        orderRepository.save(order);
        inventoryRepository.deduct(order.productId());
    }
}
```

Spring 容器注入给外部调用者的通常是代理对象：

```text
Controller → OrderService Proxy → OrderService Target
```

但进入 `createOrder()` 后，调用 `saveItem()` 的接收者是当前 Target 对象自身：

```text
OrderService Target → this.saveItem()
```

第二段调用没有重新经过 Proxy，所以事务拦截器看不到 `saveItem()` 上的注解。

如果 Repository 自己使用事务，部分数据库操作可能仍然成功执行，这会制造一种“`@Transactional` 好像生效了”的错觉；真正遇到多步写入和异常回滚时，问题才会暴露。

`@Transactional` 本身只是元数据。它不会由 JVM 自动改变方法语义，也不会在编译后直接变成事务控制代码。

启用事务管理后，Spring 大致完成以下工作：

1. 找到带事务元数据的 Bean。
2. 为符合条件的 Bean 创建 AOP Proxy。
3. 外部调用进入 Proxy。
4. `TransactionInterceptor` 查找方法对应的事务属性。
5. 根据传播级别决定新建、加入、挂起或不使用事务。
6. 调用真正的目标方法。
7. 根据返回或异常结果提交、回滚或恢复外层事务。

核心调用关系可概括为：

```text
调用方
  → Proxy
    → TransactionInterceptor
      → TransactionManager
        → Target Method
```

self-invocation 实际路径则是：

```text
Target Method A
  → Target Method B
```

由于没有经过 `TransactionInterceptor`，方法 B 上声明的事务属性不会被解释。

这不是 `@Transactional` 特有的问题。默认 Proxy 模式下，基于 Spring AOP 实现的 `@Async`、`@Cacheable` 等功能也有相似边界。

## 代理类型与传播规则是两个问题

### JDK Dynamic Proxy 与 Class-based Proxy

Spring 常见的代理方式包括：

* JDK Dynamic Proxy：代理接口。
* Class-based Proxy：生成目标类的子类代理。

二者都会遇到 self-invocation，因为问题不在于代理采用接口还是子类，而在于内部调用已经进入目标对象，没有再次通过代理入口。

即使使用 class-based proxy，下面的调用仍然不会自动变成：

```java
proxy.saveItem(order);
```

它依然相当于：

```java
this.saveItem(order);
```

### 传播级别失效比“没有事务”更隐蔽

考虑下面的代码：

```java
@Service
public class PaymentService {

    @Transactional
    public void pay(Payment payment) {
        paymentRepository.save(payment);
        writeAuditLog(payment);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void writeAuditLog(Payment payment) {
        auditRepository.save(payment.toAuditLog());
    }
}
```

很多开发者期望：

1. `pay()` 开启事务 T1。
2. `writeAuditLog()` 挂起 T1。
3. `writeAuditLog()` 开启独立事务 T2。
4. T2 提交后恢复 T1。

实际调用没有经过代理，`REQUIRES_NEW` 无法被拦截器读取，因此 `writeAuditLog()` 通常仍运行在 T1 中。T1 回滚时，审计记录也会一起回滚。

### 方法可见性仍存在边界

本文使用的 Spring Framework 7.0.9 延续了从 6.0 开始的规则：class-based proxy 默认可以处理 `protected` 和 package-visible 的事务方法；但 interface-based proxy 的事务方法仍需为 `public` 且定义在代理接口上。

无论方法是否可见，self-invocation 限制仍然存在。因此把内部方法从 `private` 改成 `public` 并不能解决调用未经过代理的问题。

## 同一个业务事务应放在外部入口

回到开头的订单例子：如果保存订单和扣减库存本来就应该同成同败，最小修复是把事务放在外部调用的入口，不必为了经过代理而拆出另一个 Bean。下面是同一个 `OrderService` 内的方法：

```java
@Transactional
public void createOrder(Order order) {
    validate(order);
    saveItem(order);
}

private void saveItem(Order order) {
    orderRepository.save(order);
    inventoryRepository.deduct(order.productId());
}
```

调用方通过 Spring Bean 进入 `createOrder()`，代理先建立事务；内部普通调用随后使用已绑定的事务资源。这里没有要求 `saveItem()` 的注解再次生效，也没有独立提交需求。异常必须按回滚规则传播，两个 Repository 也必须参与同一个事务管理器；后文的异常捕获边界仍然适用。

只有需求变成“每条记录独立提交”或“审计不随主事务回滚”时，才需要下面的独立事务边界。不能用一个统一的拆 Bean 方案替代对业务提交单位的判断。

## 为逐条导入建立可见的事务边界

### 批量处理中的内部调用

```java
@Service
public class ImportService {

    private final RecordRepository recordRepository;

    public ImportService(RecordRepository recordRepository) {
        this.recordRepository = recordRepository;
    }

    public void importAll(List<Record> records) {
        for (Record record : records) {
            importOne(record);
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void importOne(Record record) {
        recordRepository.save(record);
    }
}
```

设计意图是每条记录使用独立事务，单条失败不影响其他记录。但 `importAll()` 直接调用 `importOne()`，所以 `REQUIRES_NEW` 不会生效。

### 通过另一个 Bean 提供独立事务边界

```java
@Service
public class RecordImporter {

    private final RecordRepository recordRepository;

    public RecordImporter(RecordRepository recordRepository) {
        this.recordRepository = recordRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void importOne(Record record) {
        recordRepository.save(record);
    }
}
```

```java
@Service
public class ImportService {

    private final RecordImporter recordImporter;

    public ImportService(RecordImporter recordImporter) {
        this.recordImporter = recordImporter;
    }

    public ImportResult importAll(List<Record> records) {
        int succeeded = 0;
        List<ImportFailure> failures = new ArrayList<>();

        for (Record record : records) {
            try {
                recordImporter.importOne(record);
                succeeded++;
            } catch (RuntimeException exception) {
                failures.add(new ImportFailure(record, exception));
            }
        }

        return new ImportResult(succeeded, List.copyOf(failures));
    }
}
```

结果类型保留失败项及其原因，交给调用者显示、记录或重试；不要仅增加失败计数后丢弃异常。对应的数据类型可定义为：

```java
public record ImportFailure(Record record, RuntimeException cause) {}

public record ImportResult(int succeeded, List<ImportFailure> failures) {}
```

这里的 `Record` 是应用自己的业务类型，代码片段使用 `java.util.List`、`ArrayList` 等标准库类型，省略包声明与框架 import。调用路径变为：

```text
ImportService
  → RecordImporter Proxy
    → TransactionInterceptor
      → RecordImporter Target
```

每次调用都经过 `RecordImporter` 的代理，`REQUIRES_NEW` 因而能够挂起外层事务并创建独立事务。

### 可选：使用 TransactionTemplate

若事务边界很小且拆分 Bean 会使领域结构更差，可显式控制：

```java
@Service
public class ImportService {

    private final TransactionTemplate transactionTemplate;
    private final RecordRepository recordRepository;

    public ImportService(
            PlatformTransactionManager transactionManager,
            RecordRepository recordRepository) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.recordRepository = recordRepository;
    }

    public void importAll(List<Record> records) {
        for (Record record : records) {
            transactionTemplate.executeWithoutResult(status ->
                    recordRepository.save(record));
        }
    }
}
```

上述 `TransactionTemplate` 循环没有捕获失败，所以采用遇错停止的策略；已成功的前序独立事务仍会保留。若产品需要逐条继续，可以像上一个例子一样收集失败项。

Spring 官方对 imperative flow 通常推荐使用 `TransactionTemplate`，对 reactive flow 使用 `TransactionalOperator`。[Spring Framework：编程式事务管理](https://docs.spring.io/spring-framework/reference/data-access/transaction/programmatic.html)

## 验证事务行为并控制资源范围

### 根据业务边界选择声明式或编程式事务

另一个 Bean 已经承担独立业务职责时，声明式事务能清楚地表达调用边界。如果只是一个算法内部需要短事务，强行拆分 Service 反而增加转发，`TransactionTemplate` 可以更直接。是否拆分应由职责和实际事务需求决定，不能仅为了经过代理制造空壳层。

### 用集成测试验证回滚，而不是只看数据是否写入

至少覆盖以下情况：

* 第二次数据库写入失败时，第一次写入是否回滚。
* `REQUIRES_NEW` 内层提交后，外层回滚是否保留内层结果。
* checked exception 和 unchecked exception 的回滚差异。
* 捕获异常后，事务是否已经被标记为 rollback-only。

可以在诊断代码中临时检查：

```java
boolean active =
        TransactionSynchronizationManager.isActualTransactionActive();
```

但不应把这种检查散布到业务逻辑中作为事务控制方式。

### 保持事务短小

不要因为拆分 Bean 就把远程 HTTP 请求、文件解析或长时间计算全部放入事务。推荐流程通常是：

1. 事务外完成远程查询和输入解析。
2. 进入短事务执行一致性校验和数据库写入。
3. 提交后通过事件或 Outbox 驱动外部副作用。

### 谨慎捕获异常

即使代理正确生效，下面的写法也可能导致事务提交：

```java
@Transactional
public void createOrder(Order order) {
    try {
        inventoryRepository.deduct(order.productId());
    } catch (RuntimeException exception) {
        log.error("deduct failed", exception);
    }
}
```

该方法的事务拦截器只能根据它实际观察到的正常返回或异常决定规则。若底层 Repository 的事务拦截器已经把同一事务标记为 rollback-only，外层即使捕获异常，也可能在提交时得到 `UnexpectedRollbackException`。如果业务必须捕获异常，应重新抛出、显式设置 rollback-only，或者重新设计异常边界。

`REQUIRES_NEW` 挂起外层事务后，内层通常还需要另一条数据库连接。独立提交的需求应和连接池容量一起评估；“拆成另一个 Bean”解决调用路径，并不会自动解决资源耗尽。AspectJ 织入模式有不同的拦截边界，本文的 self-invocation 结论不应未经区分地套用到它。
