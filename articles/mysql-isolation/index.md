---
title: "MySQL 的事务机制"
date: 2020-05-30
updated: 2026-10-03
tags:
  - MySql
  - MySql的事务机制
  - 数据库事务
domain: MySQL
---

事务把一组操作作为一个提交或回滚的单位，但一致性、隔离性与持久性解决的是不同问题。一致性要求事务前后满足数据和业务约束；隔离性限制并发事务之间的可见性与干扰；持久性要求已提交结果在相应故障模型下能够恢复。InnoDB 的锁、MVCC、日志与刷盘配置共同参与这些保障，不能把它们归结为一种机制。

以下讨论采用 **MySQL Community Server 9.7.2、InnoDB** 的服务端语义，属于 MySQL 9.7 LTS 分支。本文解释事务模型与配置边界，不给出并发压测或故障恢复实验结论。其他存储引擎、不同读写方式和持久化配置可能有不同保障；事务不能替代应用正确实现业务规则。[InnoDB 与 ACID](https://dev.mysql.com/doc/refman/9.7/en/mysql-acid.html)说明了这些保障涉及的机制与配置。


## 事务的基本属性（ACID）

### 原子性（atomicity）

一个事务中的变更要么提交，要么回滚。例如转账中的扣款和入账应放在同一事务内，避免只完成其中一步。原子性不意味着事务期间任何观察者都必然只能看到所有旧值或所有新值；并发可见性由隔离规则决定。

### 一致性（consistency）

一致性要求事务把满足约束的数据状态转换为另一个满足约束的状态。例如一次不含手续费的转账，转出方和转入方的余额总和应保持不变。数据库可维护唯一键、外键等约束，余额非负、转账金额有效等业务规则仍需由应用和数据库设计共同保证。错误的业务逻辑即使被原子提交，也不因此变得正确。

### 隔离性（isolation）

隔离性规定并发事务怎样观察和修改数据。InnoDB 同时使用锁和多版本并发控制（MVCC）；普通一致性读与锁定读并不相同。较低隔离级别允许更多可见性变化，不能一概说事务“不能看到彼此未提交数据”，因为 READ UNCOMMITTED 允许脏读。

### 持久性（durability）

持久性针对提交后的结果及故障恢复。InnoDB 的 redo log、提交刷盘策略、操作系统和存储设备共同影响崩溃后能否保留已提交事务；启用 binlog 时还要考虑 sync_binlog。doublewrite buffer 主要处理数据页部分写入问题，不是单独保证事务持久性的完整机制。为了性能降低刷盘要求，会改变可承受的数据丢失边界。

## 并发读取可能观察到什么

- 脏读：读取另一个事务尚未提交的数据，而对方之后可能回滚。
- 不可重复读：同一事务再次读取同一行时，发现值因其他事务提交而改变。
- 幻读：再次执行同一条件查询时，满足条件的行集合因其他事务的变更而不同。

这些现象用于描述并发可见性；实际应用还要区分普通 SELECT、SELECT ... FOR UPDATE 和 UPDATE 等操作，不能只根据隔离级别名称推断全部读写行为。

## InnoDB 的隔离级别

| 隔离级别 | 普通读取的主要语义 |
| --- | --- |
| READ UNCOMMITTED | 可以读取未提交数据，允许脏读。 |
| READ COMMITTED | 每次一致性读取得新的快照，不读未提交数据，但两次读取结果可能不同。 |
| REPEATABLE READ | 默认级别。同一事务的普通一致性读通常使用首次建立的同一快照；锁定读和写操作遵循锁规则。 |
| SERIALIZABLE | 提供更强隔离，可能把普通读取转换为加锁读取，增加阻塞；并非简单把所有事务按开始时间排成一条串行队列。 |

不能把通用隔离级别对照表里的“REPEATABLE READ 允许幻读”直接当作 InnoDB 所有场景的结论。InnoDB 的一致性读通过快照维持读取视图，范围锁定读可能通过 next-key locks 阻止范围内插入；具体锁范围受查询、索引和隔离级别影响。事务混用快照读与锁定读时，也不能承诺两者看到完全相同的状态。[官方隔离级别说明](https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-isolation-levels.html)给出了相应边界。

在 MySQL 9.7 客户端或能够执行 SQL 的连接工具中，先确认实际服务器、当前会话隔离级别与自动提交设置，再分析具体 SQL。连接工具的版本不等于服务器版本：

```sql
SELECT VERSION(), @@version_comment,
       @@SESSION.transaction_isolation, @@SESSION.autocommit;
```

上面的查询只读取环境，不证明某个并发异常已经出现或被排除。复现具体异常时，需要用两个独立连接明确列出事务开始、查询、写入和提交的交错，并给出表结构、索引及存储引擎。仅把级别调高并不能修正跨事务的错误业务流程。

## 资料来源

- [InnoDB 与 ACID 模型](https://dev.mysql.com/doc/refman/9.7/en/mysql-acid.html)
- [InnoDB 事务隔离级别](https://dev.mysql.com/doc/refman/9.7/en/innodb-transaction-isolation-levels.html)
- [MySQL LTS 与 Innovation 发布模型](https://dev.mysql.com/doc/refman/9.7/en/mysql-releases.html)
