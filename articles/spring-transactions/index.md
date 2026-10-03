---
title: "Spring 事务"
date: 2020-06-20
updated: 2026-10-03
tags:
  - Spring
  - Spring-transaction
domain: Spring
---

Spring 事务的传播行为回答的是“被调用的方法如何参与已有事务”，隔离级别回答的是“并发事务之间怎样观察数据”。要判断一次调用是否会回滚，还必须把代理入口、事务管理器和异常规则放在一起看，不能只记住几个传播常量。

本文解释命令式事务，并以 **Spring Framework 5.2.5.RELEASE** 的 [TransactionAspectSupport](https://github.com/spring-projects/spring-framework/blob/v5.2.5.RELEASE/spring-tx/src/main/java/org/springframework/transaction/interceptor/TransactionAspectSupport.java) 为历史源码基线。讨论不包含响应式事务；不同数据库和事务管理器的资源能力也不完全相同。本文中的事务场景是按契约推导，不声称已在某个数据库上执行集成实验。

## 先区分属性、状态和拦截器上下文

| 类型 | 表达什么 |
| --- | --- |
| TransactionDefinition | 隔离级别、传播行为、超时和只读等定义 |
| TransactionAttribute | 在定义之外，提供 rollbackOn 等异常回滚规则 |
| TransactionStatus | 当前事务执行状态，包含 rollback-only、保存点等操作能力 |
| TransactionInfo | 拦截器维护的事务信息，用来恢复外层调用上下文 |

TransactionStatus 不要求业务调用方直接持有底层连接；TransactionInfo 的清理也不等于物理事务已经提交。后面两个时序问题都来自这一区分。

## 七种传播行为围绕当前事务展开

假设 A 方法通过 Spring 代理调用 B，传播属性定义在 B 上。表中的“已有事务”指与当前执行线程及对应事务管理器关联的事务：

| 传播行为 | 已有事务 | 没有事务 |
| --- | --- | --- |
| REQUIRED | 加入 | 新建 |
| SUPPORTS | 参与 | 不主动开启事务；同步行为仍受管理器配置影响 |
| MANDATORY | 加入 | 抛异常 |
| REQUIRES_NEW | 挂起外层，开启独立事务 | 新建 |
| NOT_SUPPORTED | 挂起外层，在无事务边界下执行 | 无事务执行 |
| NEVER | 抛异常 | 无事务执行 |
| NESTED | 在支持的管理器中建立嵌套边界，典型 JDBC 实现使用保存点 | 类似 REQUIRED |

传播不是让事务自动跟随任何 Java 调用或新线程。实际能否挂起资源、建立保存点，以及所谓无事务代码如何获得连接，都由管理器与资源集成决定。

### REQUIRED：逻辑边界可以共用一个物理事务

A 与 B 使用 REQUIRED 时，两个逻辑方法边界通常参与同一物理事务。如果 B 的事务拦截已经把共享事务标记为 rollback-only，A 捕获业务异常也不能把这个标记简单取消；外层最终提交可能收到 UnexpectedRollbackException。

这解释了为什么“异常已经被 catch，所以肯定能提交”不成立。需要同时看异常是否经过 B 的代理、回滚规则是否匹配，以及管理器如何标记事务。[传播行为与 rollback-only](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

### REQUIRES_NEW：独立提交也意味着额外资源

B 的事务可以与 A 独立提交或回滚，但 JDBC 场景中 A 的连接常常仍被保留，B 需要另一条连接。多个线程都持有外层连接并等待内层连接时，连接池可能耗尽。不能只根据“独立事务”选择传播方式，而忽略连接容量和并发关系。

### NESTED：保存点不等于另一条连接

典型 JDBC 嵌套事务在同一个物理事务内设置保存点。B 可以回滚到保存点后让 A 继续，但 A 最终整体回滚时，B 的工作也不会独立保留。它与 REQUIRES_NEW 的独立物理提交不同，也不等于 REQUIRED 的直接参与。

保存点依赖 JDBC 驱动、数据库和事务管理器支持，不能把 NESTED 当作所有管理器都支持的通用能力。

## 声明式事务先经过代理才会生效

默认代理模式下，外部经代理进入的方法调用由 TransactionInterceptor 处理；同一对象内部直接调用自己的另一个方法通常绕过代理。因此 A 内部的 `this.b()` 不会仅因为 B 有事务注解就自动开启新的传播边界。

TransactionInterceptor 取得目标类后，把继续调用的能力交给基类：

```java
return invokeWithinTransaction(invocation.getMethod(), targetClass, invocation::proceed);
```

`invocation::proceed` 是方法引用。基类先处理事务，再调用后续拦截器及目标方法；业务的返回值或异常随后沿同一调用栈返回。[TransactionInterceptor 5.2.5 源码](https://github.com/spring-projects/spring-framework/blob/v5.2.5.RELEASE/spring-tx/src/main/java/org/springframework/transaction/interceptor/TransactionInterceptor.java)

## 普通 PlatformTransactionManager 路径的顺序

下面摘录的是非响应式、非 CallbackPreferringPlatformTransactionManager 分支的主要顺序，省略 Vavr Try 等额外处理；它不是所有管理器共用的完整实现：

```java
TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);
Object retVal;
try {
    retVal = invocation.proceedWithInvocation();
}
catch (Throwable ex) {
    completeTransactionAfterThrowing(txInfo, ex);
    throw ex;
}
finally {
    cleanupTransactionInfo(txInfo);
}
commitTransactionAfterReturning(txInfo);
return retVal;
```

| 阶段 | 实际含义 |
| --- | --- |
| createTransactionIfNecessary | 按属性调用管理器，决定新建、参与或其他传播行为 |
| proceedWithInvocation | 在所建立的边界内执行下游调用 |
| completeTransactionAfterThrowing | 按回滚规则与事务状态决定提交或回滚，不是捕获到 Throwable 就一律回滚 |
| cleanupTransactionInfo | 恢复拦截器保存的外层线程上下文 |
| commitTransactionAfterReturning | 正常返回路径上，继续请求管理器提交 |

默认声明式回滚通常针对 RuntimeException 和 Error；受检异常需要结合 rollbackFor、noRollbackFor 等规则判断。正常返回也可能因为 rollback-only 而不能提交。具体资源提交、回滚和挂起仍由事务管理器执行。

源码摘录版权归 Spring 项目原作者，按 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 提供。完整分支应对照上述固定版本文件，不能用一个简化片段替代全部管理器契约。

## 把业务要求转成可观察场景

先决定 B 是否必须与 A 一起成功，还是需要独立提交，或仅需要局部回滚；再选择传播方式。验证时至少记录以下条件：调用是否经过代理、使用哪种管理器和数据库、异常在哪一层被捕获、最终哪些记录提交，以及连接如何占用。

同一业务需求在自调用和跨 Bean 调用中可能得到不同结果；同一个传播常量在不支持保存点的管理器中也可能失败。事务注解只是入口，完整的因果链必须覆盖代理、管理器、资源和最终数据状态。[代理模式的边界](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)
