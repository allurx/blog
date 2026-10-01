---
title: "普通 SELECT 与 SELECT FOR UPDATE 为何能读到不同版本"
date: "2026-09-01"
updated: "2026-10-01"
id: "2026-09-01-innodb-snapshot-vs-locking-read"
domain: "MySQL"
tags: ["MySQL", "InnoDB", "MVCC"]
---

同一个 InnoDB 事务里，普通 `SELECT` 先读到余额 `100`，随后 `SELECT ... FOR UPDATE` 却读到 `80`，并不一定是隔离失效。两条语句使用了不同的读取规则：前者可以沿历史快照读取，后者需要读取并锁定准备操作的记录。

本文采用 MySQL 8.4、InnoDB 和 `REPEATABLE READ`，讨论显式事务中的读取。先区分一致性读与锁定读，才能判断一次查询得到的值能否作为后续更新的依据。

## 快照固定的是可见性，不是整个数据库

InnoDB 是多版本存储引擎。记录被修改时，旧值可以通过 undo log 重建，从而让普通查询不必等待写锁释放。

在默认的 `REPEATABLE READ` 隔离级别中，第一次普通一致性读会建立 Read View；该事务后续的普通 `SELECT` 通常继续使用这一快照。

锁定读的目标则不是稳定地观察历史状态，而是读取准备操作的数据并阻止并发事务修改它。因此，它需要基于较新的记录状态加锁，而不是简单返回旧快照。[MySQL 8.4：一致性非锁定读](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)

普通一致性读根据 Read View 判断记录版本是否可见，必要时从 undo log 重建较早版本。在本文没有自行修改记录的例子中，同一事务后续普通读取仍使用此前的快照；事务也能看到自己的写入，不能把 Read View 理解成所有语句共同冻结的数据库副本。

`FOR UPDATE` 则按执行计划扫描并申请排他锁，遇到其他事务的冲突锁时可能等待。它不会先返回旧快照再给那个历史版本补一把锁。MySQL 因此不建议在同一 `REPEATABLE READ` 事务中混用两类语句后，假定它们观察到完全相同的状态。[MySQL 8.4：事务隔离级别](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)

## 用两个会话观察版本差异

在独立测试数据库中创建示例表，并在两个连接中设置相同隔离级别：

```sql
CREATE TABLE account_demo (
    id BIGINT NOT NULL PRIMARY KEY,
    balance INT NOT NULL
) ENGINE = InnoDB;
INSERT INTO account_demo VALUES (1, 100);

-- 会话 A 和 B 都执行
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

先在会话 A 中建立快照：

```sql
START TRANSACTION;
SELECT balance FROM account_demo WHERE id = 1;
-- 预期：100
```

再在会话 B 中修改并提交：

```sql
START TRANSACTION;
UPDATE account_demo SET balance = 80 WHERE id = 1;
COMMIT;
```

最后回到尚未结束的会话 A：

```sql
SELECT balance FROM account_demo WHERE id = 1;
-- 预期：100，同一快照

SELECT balance FROM account_demo WHERE id = 1 FOR UPDATE;
-- 预期：80，读取并锁定当前记录
COMMIT;
```

这里的数值是按给定操作顺序推导的预期结果。若会话 B 没有提交，第二个读取可能先等待；若会话 A 自己已经写过该记录，分析还需加入“事务可见自己的写入”这一规则。

## 读取与修改应处在同一保护范围

需要先检查余额、库存或状态再修改时，在同一短事务中执行锁定读、判断和更新，失败时回滚。`FOR UPDATE` 必须配合显式事务或关闭自动提交；一条语句结束即提交时，锁无法继续保护后续操作。[MySQL 8.4：锁定读](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)

如果规则只是“库存充足才扣减”，可以直接用条件更新：

```sql
UPDATE product
SET stock = stock - ?
WHERE id = ?
  AND stock >= ?;
```

第一个和第三个参数都是同一份经校验的正数扣减量，第二个参数是商品 ID。随后检查受影响行数：更新一行说明扣减成功，零行说明记录不存在或条件不满足。需要区分这两种失败原因时，再按业务契约查询；不要把原子更新又拆回未经保护的先查后改。

这种写法缩短了交互链路，但不能据此声称任意负载下更快。还应检查索引、执行计划、冲突程度和实际事务范围。

## 查询条件不等于加锁范围

`WHERE id = 1` 命中主键与用非唯一索引执行范围查询，可能产生不同锁范围。锁定读会按索引扫描和隔离规则工作，缺少合适索引时，扫描与锁竞争范围可能明显扩大；范围查询还可能涉及 next-key locks，以限制范围内的新记录插入。

锁也不会消除死锁。多个事务以不同顺序锁定记录时，仍需有一致的访问顺序，并按应用边界处理数据库报告的死锁失败。`REPEATABLE READ`、`FOR UPDATE` 和事务都是具体契约，不能替代对实际 SQL 与并发时序的分析。
