---
title: "Redis 锁为什么还需要 Fencing Token"
date: 2026-09-19
updated: 2026-10-03
domain: "分布式"
tags: ["Redis","分布式锁","FencingToken"]
---

订单任务 A 拿到 30 秒的 Redis 锁，读出订单后暂停了 40 秒。期间任务 B 获得新锁，已经更新了订单。A 恢复后继续执行：即使它没有误删 B 的锁，手里的旧结果仍可能覆盖 B 的新结果。

释放时比较随机所有者值，能保护 Redis 里的锁键；订单数据库还需要自己的判断依据，才能识别这个延迟到达的写入。

对库存、扣款等正确性敏感的写入，资源端还需要 fencing：每次获得租约分配一个严格递增的代次，写入携带该 token，资源原子地拒绝比已见代次更旧的请求。同一代次是否允许多次操作，需要另外定义序号或幂等规则；仅用于节省重复计算的效率锁则未必需要这套约束。

## 条件删除为什么挡不住陈旧写入

下面以 Redis Open Source 8.2.10（8.2 Extended 支持线）为命令基线。这里只说明租约与写入顺序，没有运行 Redis 故障切换实验；后面的资源端模型使用 JDK 25 LTS。常见 Redis 锁会执行：

```text
SET order:42:lock <随机所有者值> NX PX 30000
```

释放时只在值仍等于自己的随机值时删除。这个做法解决了一个真实问题：客户端 A 的锁过期、客户端 B 获得新锁后，A 不能把 B 的锁删掉。Redis 官方锁文档给出的单实例模式正是“随机值 + 条件删除”；当前文档还说明 Redis 8.4 可使用 `DELEX key IFEQ value`，旧版本可用 Lua 做比较后删除。[Redis 分布式锁文档](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) · [SET 命令](https://redis.io/docs/latest/commands/set/)

但“不能误删新锁”不等于“不能写坏数据”。考虑下面的时序：

1. A 获得 30 秒租约，读取订单并开始计算。
2. A 因长时间暂停、调度饥饿或网络延迟而沉默超过 30 秒。
3. 租约到期，B 获得同一把锁并完成正确写入。
4. A 恢复。它的条件删除会失败，但它仍可能把旧计算结果写入订单。

此时 Redis 正常执行了到期和重新获取，问题出现在另一个系统：订单数据库只看到了 A 的更新语句，不知道 A 属于比 B 更早的一代持有者。

## 资源端用代次识别旧持有者

### 超时只能判断“可能失效”

超时是失败检测器，不是所有权证明。一次本地超时无法区分：远端失败、网络只是变慢，还是本进程被暂停。即使在写入前重新检查锁，线程也可能恰好在“检查通过”与“发出写请求”之间暂停；检查与下游提交不是一个原子动作。

Redis 的锁文档也把 validity time 定义为互斥保证的有限窗口，并明确建议在一致性要求高的场景实现 fencing token，尤其要防范长时间运行后误以为锁仍然有效的进程。[Redis 分布式锁文档](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)

### Fencing Token 把时间竞争变成顺序比较

令每次成功获取同一资源的租约得到严格递增的代次：

```text
A: token=41  -- 长暂停，租约过期
B: token=42  -- 写入资源，资源记录 last_token=42
A: token=41  -- 延迟到达，因 41 <= 42 被拒绝
```

随机 UUID 适合标识锁的所有者，但没有大小关系，不能充当 fencing token。墙上时钟时间戳也不可靠：时钟可能回拨、跨节点可能不同步。token 的关键性质是**同一受保护资源上的成功获取顺序严格单调**。

更重要的是，正确性落在资源端：检查 token 与执行写入必须在同一个原子提交中完成。Martin Kleppmann 对租约锁的分析给出了相同结论：旧持有者即使晚到，存储服务也能凭更高的已见 token 拒绝它。[分布式锁与 fencing 分析](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)

## 生成 token、提交写入与释放租约

### 获取租约时，一起确定它的代次

概念上，获取结果应是：

```java
record Lease(String ownerId, long fencingToken, long expiresAtMillis) {}
```

`ownerId` 用于安全释放；`fencingToken` 用于隔离陈旧副作用；`expiresAtMillis` 只用于客户端调度和放弃工作。三者不能互相替代。

在单个无回滚的协调状态机里，可以用递增计数器生成 token，但递增必须与成功获取租约的顺序一致。如果 A 先 `SET NX PX` 后暂停，B 在租约过期后获取锁并递增计数器，A 恢复后才执行 `INCR`，旧持有者反而拿到更大的 token。单纯把两个命令依次写在客户端代码里不够。

应在协调端把条件获取和 token 分配封装为一个原子操作；未成功获取时可以不发 token，序号跳号本身无害。还要考虑故障转移：若复制或恢复让计数器回退，单实例上的 `INCR` 语义就不能证明跨故障严格单调。

正确性敏感的场景应使用能提供一致顺序的协调服务或数据库序列，并把它的故障模型写入设计。ZooKeeper 的官方锁配方使用临时顺序节点；节点后缀是单调序号，可作为排序依据。[ZooKeeper Locks 配方](https://zookeeper.apache.org/doc/current/recipes.html#sc_recipes_Locks)

### 把代次检查放进资源端提交

以 MySQL 9.7 LTS、InnoDB 为目标，关系数据库可把 token 与业务行放在一起。以下是待集成验证的 SQL 片段，`inventory` 表需要预先存在，并让每行的 `last_fence` 从 0 开始：

```sql
UPDATE inventory
SET quantity = ?, last_fence = ?
WHERE sku = ? AND last_fence < ?;
```

第二和第四个占位符都传本次 token，第一个是新数量，第三个是 SKU。检查受影响行数；返回 0 可能是 token 已落后，也可能是 SKU 不存在，应按业务区分。若一次租约内需要多次写入，不能机械地用 `token > last_fence`：可扩展为 `(token, operation_seq)`，或允许同 token 的操作携带幂等键，并明确操作顺序。

对象存储或内部服务可通过一个支持条件写的网关执行同样约束。思想与 HTTP `If-Match` 类似：锁负责分配顺序，资源端条件提交负责阻止旧状态覆盖新状态。

### 释放时仍要比较所有者

Fencing 不替代条件删除。前者阻止旧持有者造成副作用，后者阻止它删除新持有者的租约；两条防线解决不同问题。续约也可以减少租约过期概率，但遇到续约响应丢失时，客户端无法证明续约是否成功，仍必须把不确定状态当作“不可再裸写”。

## 先复现陈旧覆盖，再加入 fencing

下面程序只隔离资源端的比较规则：假设协调器已在 A 的租约过期后，把 token 2 交给 B。B 先写、A 的旧请求后到。保存为 `FencingTokenDemo.java`，使用 JDK 25 LTS 运行 `java FencingTokenDemo.java`，无需第三方依赖。

```java
public final class FencingTokenDemo {
    static final class Resource {
        private String value = "initial";
        private long lastToken;

        synchronized boolean write(long token, String newValue) {
            if (token <= lastToken) return false;
            value = newValue;
            lastToken = token;
            return true;
        }
    }

    public static void main(String[] args) {
        String unprotected = "written-by-B";
        unprotected = "written-by-A-after-expiry";

        Resource resource = new Resource();
        if (!resource.write(2, "written-by-B")) throw new AssertionError("B rejected");
        boolean staleAccepted = resource.write(1, "written-by-A-after-expiry");
        if (staleAccepted || !resource.value.equals("written-by-B")) {
            throw new AssertionError("stale write accepted");
        }
        System.out.println("without fencing: " + unprotected);
        System.out.printf("with fencing: %s, stale A accepted=%s, last token=%d%n",
                resource.value, staleAccepted, resource.lastToken);

        Resource notYetFenced = new Resource();
        boolean staleBeforeB = notYetFenced.write(1, "stale-A-arrived-first");
        if (!staleBeforeB || !notYetFenced.write(2, "written-by-B")) {
            throw new AssertionError("arrival-order example");
        }
        System.out.printf("before B is seen: stale A accepted=%s, final value=%s%n",
                staleBeforeB, notYetFenced.value);
    }
}
```

在 Windows、Oracle JDK 25.0.2 LTS 下执行上述源文件，得到以下输出；程序中的检查会核对这些结果。

```text
without fencing: written-by-A-after-expiry
with fencing: written-by-B, stale A accepted=false, last token=2
before B is seen: stale A accepted=true, final value=written-by-B
```

第三行把到达顺序反过来：资源还没有见过 token 2 时，token 1 仍会通过比较，随后 B 用 token 2 覆盖它。这个反例说明，租约是否过期与资源已见的最大代次不是同一个状态。

实验覆盖一次租约只写一次的简化协议，没有实现 Redis 租约、续约、条件删除或 token 生成器。资源尚未见过 B 的较高 token 时，不能仅凭 A 的旧 token 判断其已过期；fencing 保证的是拒绝比已接受代次更旧的写入，不是跨系统即时撤销一切过期请求。

## 接入实际系统时，还有哪些地方必须成立

### 代次的顺序必须经得起故障恢复

token 只需在同一冲突域内递增，例如同一库存项的所有写入；全部资源共用一个计数器可能形成热点。真正要核对的是，主从切换或恢复旧快照后，这个资源会不会再次发出已使用的代次。因此验证需要包含进程暂停、响应丢失、计数器回退和请求延迟到达，单纯观察两个正常线程是否同时进入临界区并不充分。

### 所有写入路径都要经过同一判断

如果定时任务携带 token，管理接口却直接更新同一行，后者仍能绕过这套保护。token 需要经过调用链一直到资源提交处；日志同时记录资源键、请求 token、已见 token 和持有者 ID，才能解释一次拒绝。`stale_fence_rejected` 的增长可以提示长暂停或请求延迟，需要结合这些上下文分析。

对不支持条件写的第三方 API 或外部设备，增加 token 字段本身不会产生保护作用。只有可执行比较的代理、资源端版本检查或适用的业务幂等机制才能建立约束。若锁只是减少可重复的缓存计算，偶发重复可能是可接受成本；订单、库存等写入则必须先确定陈旧请求如何被拒绝，再决定租约多长。
