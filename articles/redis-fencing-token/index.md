---
title: "Redis 锁为什么还需要 Fencing Token"
date: 2026-09-19
updated: 2026-10-01
domain: "分布式"
tags: ["Redis","分布式锁","FencingToken"]
---

Redis 锁使用随机所有者值并在释放时比较它，可以防止旧客户端删掉新客户端的锁。然而旧客户端仍可能在暂停结束后，拿着过期计算结果向数据库写入。安全释放解决了锁键的归属，未解决下游副作用的先后顺序。

对库存、扣款等正确性敏感的写入，资源端还需要 fencing：每次获得租约分配一个严格递增的代次，写入携带该 token，资源原子地拒绝比已见代次更旧的请求。同一代次是否允许多次操作，需要另外定义序号或幂等规则；仅用于节省重复计算的效率锁则未必需要这套约束。

## 条件删除为什么挡不住陈旧写入

常见 Redis 锁会执行：

```text
SET order:42:lock <随机所有者值> NX PX 30000
```

释放时只在值仍等于自己的随机值时删除。这个做法解决了一个真实问题：客户端 A 的锁过期、客户端 B 获得新锁后，A 不能把 B 的锁删掉。Redis 官方锁文档给出的单实例模式正是“随机值 + 条件删除”；当前文档还说明 Redis 8.4 可使用 `DELEX key IFEQ value`，旧版本可用 Lua 做比较后删除。[Redis 分布式锁文档](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) · [SET 命令](https://redis.io/docs/latest/commands/set/)

但“不能误删新锁”不等于“不能写坏数据”。考虑下面的时序：

1. A 获得 30 秒租约，读取订单并开始计算。
2. A 因长时间暂停、调度饥饿或网络延迟而沉默超过 30 秒。
3. 租约到期，B 获得同一把锁并完成正确写入。
4. A 恢复。它的条件删除会失败，但它仍可能把旧计算结果写入订单。

问题的核心不是 Redis 是否正确删除了键，而是下游资源无法分辨“A 的请求属于已经失效的第几代持有者”。

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

### 1. 获取租约时生成代次

概念上，获取结果应是：

```java
record Lease(String ownerId, long fencingToken, long expiresAtMillis) {}
```

`ownerId` 用于安全释放；`fencingToken` 用于隔离陈旧副作用；`expiresAtMillis` 只用于客户端调度和放弃工作。三者不能互相替代。

在单个无回滚的协调状态机里，可以用递增计数器生成 token，但递增必须与成功获取租约的顺序一致。如果 A 先 `SET NX PX` 后暂停，B 在租约过期后获取锁并递增计数器，A 恢复后才执行 `INCR`，旧持有者反而拿到更大的 token。单纯把两个命令依次写在客户端代码里不够。

应在协调端把条件获取和 token 分配封装为一个原子操作；未成功获取时可以不发 token，序号跳号本身无害。还要考虑故障转移：若复制或恢复让计数器回退，单实例上的 `INCR` 语义就不能证明跨故障严格单调。

正确性敏感的场景应使用能提供一致顺序的协调服务或数据库序列，并把它的故障模型写入设计。ZooKeeper 的官方锁配方使用临时顺序节点；节点后缀是单调序号，可作为排序依据。[ZooKeeper Locks 配方](https://zookeeper.apache.org/doc/current/recipes.html#sc_recipes_Locks)

### 2. 资源端原子拒绝旧 token

关系数据库可把 token 与业务行放在一起：

```sql
UPDATE inventory
SET quantity = ?, last_fence = ?
WHERE sku = ? AND last_fence < ?;
```

第二和第四个占位符都传本次 token，第一个是新数量，第三个是 SKU。检查受影响行数；返回 0 可能是 token 已落后，也可能是 SKU 不存在，应按业务区分。若一次租约内需要多次写入，不能机械地用 `token > last_fence`：可扩展为 `(token, operation_seq)`，或允许同 token 的操作携带幂等键，并明确操作顺序。

对象存储或内部服务可通过一个支持条件写的网关执行同样约束。思想与 HTTP `If-Match` 类似：锁负责分配顺序，资源端条件提交负责阻止旧状态覆盖新状态。

### 3. 安全释放仍然保留

Fencing 不替代条件删除。前者阻止旧持有者造成副作用，后者阻止它删除新持有者的租约；两条防线解决不同问题。续约也可以减少租约过期概率，但遇到续约响应丢失时，客户端无法证明续约是否成功，仍必须把不确定状态当作“不可再裸写”。

## 先复现陈旧覆盖，再加入 fencing

下面程序只隔离资源端的比较规则：假设协调器已在 A 的租约过期后，把 token 2 交给 B。B 先写、A 的旧请求后到。保存为 `FencingTokenDemo.java`，使用 Java 17+ 运行 `java FencingTokenDemo.java`。

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
    }
}
```

2026-10-01 修订时，使用 JDK 25.0.2 的 `javac --release 17` 编译并运行，得到以下输出，代码中的检查均通过：

```text
without fencing: written-by-A-after-expiry
with fencing: written-by-B, stale A accepted=false, last token=2
```

这个实验覆盖一次租约只写一次的简化协议，没有实现 Redis 租约、续约、条件删除或 token 生成器。资源尚未见过 B 的较高 token 时，也不能仅凭 A 的旧 token 判断其已过期；fencing 保证的是拒绝比已接受代次更旧的写入，不是跨系统即时撤销一切过期请求。

## 检查 token 覆盖的故障边界

1. **先分类锁的目的。** 缓存回填、可重复计算等效率锁允许偶发重复执行；扣款、库存、主节点写入等正确性锁必须给出陈旧持有者的拒绝机制。
2. **按资源划分 token 空间。** token 只需在同一冲突域内严格递增；全局单计数器会制造不必要的热点。
3. **把 token 贯穿调用链。** 日志、消息头、数据库列和审计事件都记录它。任何未携带 token 的旁路写入都会绕过防线。
4. **让拒绝可观测。** 统计 `stale_fence_rejected`，同时记录资源键、请求 token、已见 token 和持有者 ID；它是暂停、重试风暴或租约配置失配的证据。
5. **把生成器故障纳入测试。** 测试进程暂停、响应丢失、主从切换、计数器恢复旧快照，以及下游请求延迟到达。只验证“同一时刻两个线程没进临界区”远远不够。
6. **对不可 fencing 的资源承认边界。** 旧文件系统、外部设备或第三方 API 若不能比较代次，应通过可 fencing 的代理串行化写入，或使用业务幂等/版本检查；不能把风险藏在更长 TTL 后面。
