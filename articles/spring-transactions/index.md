---
title: "Spring 事务"
date: 2020-06-20
updated: 2026-10-02
tags:
  - Spring
  - Spring-transaction
domain: Spring
---

Spring 事务把不同资源的事务管理统一成编程模型。传播行为决定被调用方法如何参与已有事务，隔离级别决定事务之间可见性，两者不能混用。声明式事务还受代理边界影响：默认代理模式下，自调用不会触发新的事务拦截。

下面从核心属性和七种传播行为进入命令式事务拦截链；源码采用 Spring Framework 5.2.5.RELEASE，可对照 [TransactionAspectSupport](https://github.com/spring-projects/spring-framework/blob/v5.2.5.RELEASE/spring-tx/src/main/java/org/springframework/transaction/interceptor/TransactionAspectSupport.java)。讨论范围不包含响应式事务；命令式事务也不会自动传播到新线程。`REQUIRES_NEW` 可能需要额外连接，`NESTED` 则依赖保存点等资源能力，不能对所有事务管理器作相同假设。


## 事务的相关属性

### TransactionDefinition

TransactionDefinition中定义了事务本身能够拥有的基本属性，例如事务的隔离级别、传播级别等。

### TransactionAttribute

构成当前事务的属性，继承TransactionDefinition并提供了额外的rollbackOn功能以支持在指定的异常下回滚。

### TransactionStatus

TransactionStatus 表示当前事务执行状态，提供回滚标记、保存点等操作；它不要求调用方直接持有底层连接等资源对象。

### TransactionInfo

保存事务执行期间的信息，例如事务的状态、事务的属性、当前方法执行时是否存在另一个事务信息

## 事务的传播级别

事务的传播级别是spring事务框架衍生出来的概念，和数据库本身的隔离界别不是一个概念，千万不要混淆了。传播级别指的是A方法调用B方法时B方法的事务应该以哪种形式参与到A方法的事务中。重点在于多个事务同时调用应该如何**传播**。spring中定义了七个事务的传播级别。

### PROPAGATION_REQUIRED

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话新建一个事务在其中执行。

### PROPAGATION_SUPPORTS

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话以非事务的方式执行。

### PROPAGATION_MANDATORY

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话抛出异常。

### PROPAGATION_REQUIRES_NEW

暂停当前已有事务，为该方法开启一个独立的物理事务。使用 JDBC 事务管理器时，外层连接仍被保留，内层可能需要另外取得一个连接，因此需要一起考虑连接池容量与并发量。具体资源管理由事务管理器决定。

### PROPAGATION_NOT_SUPPORTED

暂停当前执行方法的线程上下文中已存在另一个事务，然后以非事务的方式执行该方法

### PROPAGATION_NEVER

如果当前执行方法的线程上下文中已存在另一个事务，则抛出异常

### PROPAGATION_NESTED

如果当前已有事务，在支持的事务管理器中创建嵌套事务，通常通过同一个物理事务中的保存点实现局部回滚；外层事务仍能继续。它不同于 REQUIRED 的直接参与，也不同于 REQUIRES_NEW 的独立物理事务。没有已有事务时，其行为类似 REQUIRED。
该行为依赖事务管理器与资源支持。典型 JDBC 场景需要驱动支持保存点，不能只根据传播常量就保证所有管理器都能嵌套。

## 原理

Spring 声明式事务在默认代理模式下由 `TransactionInterceptor` 拦截经过代理的方法调用，再根据事务属性建立边界、提交或回滚。并非每个方法调用都经过拦截：同一对象内部的自调用通常绕过代理，编程式事务也有单独入口。

```java
public class TransactionInterceptor extends TransactionAspectSupport implements MethodInterceptor, Serializable {

        @Override
	@Nullable
	public Object invoke(MethodInvocation invocation) throws Throwable {
		// Work out the target class: may be {@code null}.
		// The TransactionAttributeSource should be passed the target class
		// as well as the method, which may be from an interface.
		Class<?> targetClass = (invocation.getThis() != null ? AopUtils.getTargetClass(invocation.getThis()) : null);

		// Adapt to TransactionAspectSupport's invokeWithinTransaction...
		return invokeWithinTransaction(invocation.getMethod(), targetClass, invocation::proceed);
	}
}
```

上面的`invocation::proceed`是一个lamda表达式，代表的是下一个拦截器的调用，当所有拦截器都执行完毕后，目标方法也就开始执行了。

```java
protected Object invokeWithinTransaction(Method method, @Nullable Class<?> targetClass,
			final InvocationCallback invocation) throws Throwable {

    // If the transaction attribute is null, the method is non-transactional.
    TransactionAttributeSource tas = getTransactionAttributeSource();
    final TransactionAttribute txAttr = (tas != null ? tas.getTransactionAttribute(method, targetClass) : null);
    final TransactionManager tm = determineTransactionManager(txAttr);

    if (this.reactiveAdapterRegistry != null && tm instanceof ReactiveTransactionManager) {
        ReactiveTransactionSupport txSupport = this.transactionSupportCache.computeIfAbsent(method, key -> {
            if (KotlinDetector.isKotlinType(method.getDeclaringClass()) && KotlinDelegate.isSuspend(method)) {
                throw new TransactionUsageException(
                    "Unsupported annotated transaction on suspending function detected: " + method +
                    ". Use TransactionalOperator.transactional extensions instead.");
            }
            ReactiveAdapter adapter = this.reactiveAdapterRegistry.getAdapter(method.getReturnType());
            if (adapter == null) {
                throw new IllegalStateException("Cannot apply reactive transaction to non-reactive return type: " +
                                                method.getReturnType());
            }
            return new ReactiveTransactionSupport(adapter);
        });
        return txSupport.invokeWithinTransaction(
            method, targetClass, invocation, txAttr, (ReactiveTransactionManager) tm);
    }

    PlatformTransactionManager ptm = asPlatformTransactionManager(tm);
    final String joinpointIdentification = methodIdentification(method, targetClass, txAttr);

    if (txAttr == null || !(ptm instanceof CallbackPreferringPlatformTransactionManager)) {
        // Standard transaction demarcation with getTransaction and commit/rollback calls.
        TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);

        Object retVal;
        try {
            // This is an around advice: Invoke the next interceptor in the chain.
            // This will normally result in a target object being invoked.
            retVal = invocation.proceedWithInvocation();
        }
        catch (Throwable ex) {
            // target invocation exception
            completeTransactionAfterThrowing(txInfo, ex);
            throw ex;
        }
        finally {
            cleanupTransactionInfo(txInfo);
        }

        if (vavrPresent && VavrDelegate.isVavrTry(retVal)) {
            // Set rollback-only in case of Vavr failure matching our rollback rules...
            TransactionStatus status = txInfo.getTransactionStatus();
            if (status != null && txAttr != null) {
                retVal = VavrDelegate.evaluateTryFailure(retVal, txAttr, status);
            }
        }

        commitTransactionAfterReturning(txInfo);
        return retVal;
    }else{
        ...省略相关代码
    }
}
```

invokeWithinTransaction方法的核心逻辑如下

```java
// Standard transaction demarcation with getTransaction and commit/rollback calls.
TransactionInfo txInfo = createTransactionIfNecessary(ptm, txAttr, joinpointIdentification);

Object retVal;
try {
    // This is an around advice: Invoke the next interceptor in the chain.
    // This will normally result in a target object being invoked.
    retVal = invocation.proceedWithInvocation();
}
catch (Throwable ex) {
    // target invocation exception
    completeTransactionAfterThrowing(txInfo, ex);
    throw ex;
}
finally {
    cleanupTransactionInfo(txInfo);
}
```

createTransactionIfNecessary 根据事务属性决定加入或创建事务，随后执行调用链。异常路径由 completeTransactionAfterThrowing 根据回滚规则处理；正常路径则在 cleanupTransactionInfo 恢复线程中的事务信息之后，继续调用 commitTransactionAfterReturning。清理拦截器上下文不等于已经提交或回滚，最终资源操作由事务管理器完成。

## 总结

选择传播行为时，先确定内层操作是否必须与外层一起成功，再判断它需要加入当前事务、独立事务还是保存点。实现是否符合这个选择，还取决于调用能否经过代理，以及事务管理器是否支持所需的资源行为。

## 资料来源

- [Spring Framework：事务传播行为](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)
- [Spring Framework：@Transactional 与代理边界](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)
