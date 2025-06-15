---
title: Spring事务
date: 2020-06-20
categories:
- Spring
- Spring-transaction
tags:
- Spring
- Spring-transaction
---

# 概述

Spring将Java Transaction API (JTA), JDBC, Hibernate, 和Java Persistence API (JPA)这些不同的事务api抽象成了统一的编程模型，其中TransactionManager作为spring事务的顶级接口负责声明一个事务管理器，PlatformTransactionManager则继承了该接口提供了事务的获取、提交、回滚的基本声明，通常我们可以通过编程式和声明式这两种方式来编写我们的事务代码，编程式事务通常是利用事务管理器来手动获取事务最后提交或者回滚，而声明式事务则是最为常见的使用方式，也就是我们在方法或类上标注的`@Transactional`注解。

<!-- more -->

# 事务的相关属性

## TransactionDefinition

TransactionDefinition中定义了事务本身能够拥有的基本属性，例如事务的隔离级别、传播级别等。

## TransactionAttribute

构成当前事务的属性，继承TransactionDefinition并提供了额外的rollbackOn功能以支持在指定的异常下回滚。

## TransactionStatus

包含明确的事务对象以及当前事务的一些状态信息

## TransactionInfo 

保存事务执行期间的信息，例如事务的状态、事务的属性、当前方法执行时是否存在另一个事务信息

# 事务的传播级别

事务的传播级别是spring事务框架衍生出来的概念，和数据库本身的隔离界别不是一个概念，千万不要混淆了。传播级别指的是A方法调用B方法时B方法的事务应该以哪种形式参与到A方法的事务中。重点在于多个事务同时调用应该如何**传播**。spring中定义了七个事务的传播级别。

## PROPAGATION_REQUIRED

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话新建一个事务在其中执行。

## PROPAGATION_SUPPORTS

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话以非事务的方式执行。

## PROPAGATION_MANDATORY

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话抛出异常。

## PROPAGATION_REQUIRES_NEW

暂停当前执行方法的线程上下文中已存在另一个事务，然后创建一个新事务运行该方法，内部是通过datasource再次获取一个新的connection实现的

## PROPAGATION_NOT_SUPPORTED

暂停当前执行方法的线程上下文中已存在另一个事务，然后以非事务的方式执行该方法

## PROPAGATION_NEVER

如果当前执行方法的线程上下文中已存在另一个事务，则抛出异常

## PROPAGATION_NESTED

如果当前执行方法的线程上下文中已存在事务的话则加入到当前事务中，否则的话新建一个事务在其中执行。
该事务传播级别只在特定的事务管理器中生效，例如对于DataSourceTransactionManager来说，如果使用的是jdbc3.0的驱动器的话，则可以使用该事务传播级别，其内部是通过Savepoint的特性来实现的。

# 原理

spring事务是通过AOP实现的，具体的实现是通过`TransactionInterceptor`这个方法拦截器在每个方法执行期间进行拦截，然后再根据发生异常的策略进行提交或者回滚。

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

首先通过createTransactionIfNecessary方法根据情况来创建事务信息，然后执行下一个拦截器的lamda表达式，如果发生异常的话则判断是否需要回滚或者提交，finally中清除本次事务的信息。其中最为核心的部分在于createTransactionIfNecessary这个方法，内部会根据当前的事务属性（事务的传播级别）来判断是否需要创建事务。有兴趣的同学可以自行翻阅源码。

# 总结

本文简单的讲述了spring事务框架的一些基本概念以及其背后的运行原理，同时解释了spring的几种事务传播机制，由于精力有限同时整个spring事务框架在事务创建、回滚那一块的逻辑的确十分复杂，并没有详细的分析源码。

