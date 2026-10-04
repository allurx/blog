---
title: "PostgreSQL 快照隔离为什么仍会发生写偏斜"
date: "2026-10-04"
domain: "PostgreSQL"
tags: ["PostgreSQL", "Snapshot Isolation", "Write Skew", "Serializable"]
---

假设值班表里只有 Alice 和 Bob，并且业务要求任何时候至少一人值班。两人各自提交一笔事务：先确认当前至少有两人值班，再把自己改成休息。如果两笔事务依次执行，后一笔会看到只剩一人，从而拒绝修改；并发执行时，它们却可能都通过检查。

这类结果称为**写偏斜**（write skew）。它不是两笔事务覆盖同一行造成的丢失更新，而是两笔事务依据同一个旧状态作出决定，随后修改了不同的行。本文以 PostgreSQL 18.6 为基线，解释 `REPEATABLE READ` 下为何允许这种结果，以及 `SERIALIZABLE` 怎样识别它。需要先了解事务、MVCC 和基本 SQL；不同数据库对同名隔离级别的实现并不相同，结论不能直接套用到其他产品。

## 稳定快照只能保证读到一致的过去

先建立最小数据集：

```sql
CREATE TABLE on_call (
    doctor text PRIMARY KEY,
    on_call boolean NOT NULL
);

INSERT INTO on_call VALUES
    ('Alice', true),
    ('Bob', true);
```

PostgreSQL 的 `REPEATABLE READ` 使用快照隔离。事务中的查询看到第一条非事务控制语句开始时的数据库快照，也能看到本事务自己的写入；其他并发事务在此后提交的修改不会进入这个快照。这个稳定视图消除了脏读、不可重复读和幻读，却仍允许序列化异常。[PostgreSQL 18：事务隔离](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ)

让两个会话按下面的顺序交错执行。会话 A 负责 Alice，会话 B 负责 Bob。

| 顺序 | 会话 A | 会话 B |
| ---: | --- | --- |
| 1 | `BEGIN ISOLATION LEVEL REPEATABLE READ;` | |
| 2 | `SELECT count(*) FROM on_call WHERE on_call;` → `2` | |
| 3 | | `BEGIN ISOLATION LEVEL REPEATABLE READ;` |
| 4 | | `SELECT count(*) FROM on_call WHERE on_call;` → `2` |
| 5 | `UPDATE on_call SET on_call = false WHERE doctor = 'Alice';` | |
| 6 | | `UPDATE on_call SET on_call = false WHERE doctor = 'Bob';` |
| 7 | `COMMIT;` | |
| 8 | | `COMMIT;` |

表中的查询结果和提交行为依据 PostgreSQL 18.6 的隔离契约推导；执行时应在独立测试库的两个连接中逐步输入，不能把两列当作一段顺序脚本。两笔更新命中不同主键，不存在同一行的写写冲突，因此它们都可以提交。最终 Alice 和 Bob 都是 `false`，业务约束被破坏。

如果两笔事务更新同一行，情况会不同。后来的 `REPEATABLE READ` 更新会等待先行事务；先行事务提交后，后来者不能修改自己快照开始后已经变化的那一行，会收到并发更新导致的序列化失败。这里的问题恰好在于写集合彼此分离，行级写冲突没有出现。

## 两个方向的读写依赖组成一个环

判断结果能否串行化，不是看每个事务内部是否自洽，而是看所有已提交事务能否排列成某个顺序，并产生相同结果。

若 A 先于 B 串行执行，B 应看到 Alice 已经休息，只剩一人值班，因而不能再让 Bob 休息。若 B 先于 A，A 同样应该停止。两个可能的串行顺序都无法得到“两人都休息”的结果，所以并发结果不可串行化。

用序列化图可以看见矛盾来自哪里：

- A 读到 Bob 仍在值班，但 B 随后改写了 Bob 的状态，因此存在 A 到 B 的读写反依赖。
- B 读到 Alice 仍在值班，但 A 随后改写了 Alice 的状态，因此存在 B 到 A 的读写反依赖。

两条边形成 `A → B → A` 的环。快照隔离会阻止同一数据项上的并发写入，却不会仅凭这两笔不相交的更新阻止该环。PostgreSQL 的 SSI 论文使用同一类值班示例说明这种简单写偏斜，并进一步给出结论：快照隔离的序列化异常图中，环至少包含两个相邻的读写反依赖。[Serializable Snapshot Isolation in PostgreSQL](https://arxiv.org/abs/1208.4179)

这也说明“没有脏读、不可重复读和幻读”不等于可串行化。快照隔离是在 SQL 标准常见三类现象之外定义的多版本隔离模型；Berenson 等人的原始论文正是通过更完整的事务历史讨论，指出只列举这些现象不足以刻画所有隔离行为。[A Critique of ANSI SQL Isolation Levels](https://arxiv.org/abs/cs/0701157)

## SERIALIZABLE 让危险的并发结果不能全部提交

把两个会话的事务开头改成：

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
```

其余查询和更新保持不变。PostgreSQL 的 `SERIALIZABLE` 仍以快照隔离为基础，但会监测可能导致不可串行化的读写依赖组合。上述交错中，至少一笔事务会在完成前因 `serialization_failure` 失败，SQLSTATE 为 `40001`；两笔事务不能都以破坏约束的结果提交。

这种机制称为 Serializable Snapshot Isolation（SSI）。`pg_locks` 中的 `SIReadLock` 用来记录事务实际读取过的元组、页或关系，以便发现某次写入是否影响了并发事务先前的读取。它是依赖跟踪标记，不会像普通阻塞锁那样挡住写入，也不会参与死锁；发现危险结构时，PostgreSQL 通过中止事务打破可能的环。[PostgreSQL 18：Serializable 隔离](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-SERIALIZABLE)

SSI 检查的是足以产生异常的危险结构，而不是等到完整的序列化图成环后才处理。因此它可能回滚一笔最终未必真的落入环中的事务。这个保守性换来了更低的在线检测成本；应用必须把事务回滚视为正常的并发控制结果。

## 正确处理失败要重做整个决定

收到 `40001` 后，应从事务开始处重新执行，包括读取、业务判断、参数选择和 SQL，而不是只重发失败的 `COMMIT` 或最后一条 `UPDATE`。新一轮事务需要取得新的快照，才能基于已经提交的值重新判断。PostgreSQL 不自动完成这件事，因为数据库不知道应用在事务外如何形成了后续 SQL 和参数。[PostgreSQL 18：序列化失败处理](https://www.postgresql.org/docs/18/mvcc-serialization-failure-handling.html)

通用重试边界可以写成下面的伪代码：

```text
repeat:
    begin serializable transaction
    read current state
    decide every value and statement from that state
    apply changes
    try commit
    if SQLSTATE is 40001:
        discard the attempt and retry the whole transaction
    otherwise:
        finish or report the persistent error
```

重试可能连续失败，尤其在高竞争或长事务中，因此应用还要限制尝试次数或总时长，并使用退避减少同时重试。事务内触发的外部副作用也要单独设计：例如先在数据库中原子地保存待发送事件，提交成功后再投递，避免数据库回滚后邮件或消息已经发出。

只有相关的读和写都遵循 `SERIALIZABLE` 协议，数据库才能用这项保证保护业务规则。若部分写入仍在较弱隔离级别下运行，它们不会完整参与 SSI 依赖检查。PostgreSQL 文档还明确指出，这种一致性保护目前不延伸到热备查询和逻辑副本；需要在副本上作决定时，应重新评估读源与写入协议。[应用层数据一致性检查](https://www.postgresql.org/docs/18/applevel-consistency.html)

## 不使用 SERIALIZABLE 时，要把逻辑冲突变成真实冲突

有些约束可以直接交给数据库的唯一键、外键或排除约束，这通常比应用先查后改更可靠。“至少一行保持 `true`”涉及多行集合，普通行级 `CHECK` 约束不能直接表达它。

若系统决定继续使用较弱隔离级别，就必须显式串行化所有可能共同破坏该约束的事务。例如建立一行稳定的值班规则记录，让每次调整值班状态都先用 `SELECT ... FOR UPDATE` 锁住同一行，然后在 `READ COMMITTED` 事务里重新查询人数并更新。两笔本来写不同医生行的事务由此会在规则行上发生真实冲突。

这个方案的正确性依赖完整协议：任何能修改值班状态的入口都必须先取得同一把逻辑锁，检查也必须在取得锁之后进行。只锁住“自己”的医生行没有作用；只在某个服务方法里约定，而允许后台脚本绕过，也不能保护约束。还可以用表锁或让所有事务更新同一份计数记录，但并发度、热点和维护成本需要结合业务评估。

写偏斜的核心并不是快照“不一致”。每笔事务看到的快照都很一致，问题在于两个一致的旧视图无法共同代表一个合法的串行历史。需要跨多行维护业务不变量时，应明确选择完整的可串行化事务并处理重试，或者把所有潜在冲突映射到数据库能够直接约束或锁定的同一对象上。
