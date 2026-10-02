---
title: "Agent 工具重试为什么会重复执行副作用"
date: 2026-09-22
updated: 2026-10-02
domain: "Agent"
tags: ["Agent","Idempotency","ToolCalling"]
---

Agent 调用扣款工具，服务已扣款，响应却在网络中丢失。Agent 只看到超时；如果下一次尝试换了一个新的业务操作标识，服务端就可能再扣一次。超时没有回答“操作是否发生”，它只说明调用方没有及时得到结果。

幂等边界应由工具执行端保证：一次已确定的业务意图对应稳定的 `operation_id`，所有尝试复用它；执行端原子竞争执行权，保存请求摘要和可重放结果。若账本与外部副作用不能原子提交，还必须下传幂等键或查询、对账，不能把一个缓存中的成功标记称为 exactly-once。

## 协议请求 ID 为什么不能代替业务操作 ID

模型、SDK、代理层和工作流引擎都可能重试同一次调用。问题不专属于 LLM，但有多个重试发起者时，更不能把“没有再次执行”寄托在某个调用者的记忆上。

HTTP 语义把幂等定义为：多次相同请求对服务端产生的预期效果与一次相同。RFC 9110 也明确指出，通信失败发生在客户端读取响应之前时，幂等操作才适合自动重试；非幂等请求不应在没有额外保证时自动重试。[RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)

以 MCP `2026-07-28` 规范为例，`tools/call` 使用 JSON-RPC `id` 关联协议请求与响应，多轮输入后的重试还要求使用不同的 `id`。因此，这个协议 ID 的生命周期不适合作为业务重放窗口；工具应另行接收稳定的操作标识。[MCP 2026-07-28 · Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## 区分尝试、意图和持久化结果

**区分“尝试”和“业务操作”**

- `attempt_id` / JSON-RPC `id` / trace ID：标识一次传输或执行尝试，重试时通常变化。
- `operation_id`：标识用户想完成的一次业务意图，重试时必须保持不变。
- 资源 ID：标识操作产物，例如订单号或付款号；它可能在操作成功后才产生，不能总是代替 `operation_id`。

幂等键应由调用方在“确定要做一次新操作”时生成并持久化，而不是由每次工具调用临时生成。Amazon 的幂等 API 实践同样偏好调用方提供唯一请求标识，因为仅对参数做哈希无法区分“同一意图的重试”和“用户确实想创建两个参数完全相同的资源”。[AWS Builders’ Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

**键必须绑定调用方和参数摘要**

数据库唯一键通常应是 `(principal_id, tool_name, operation_id)`，而不是全局裸 `operation_id`：不同租户或用户不能相互命中结果。首个请求同时写入 `request_hash`；后续请求只有摘要一致才允许重放。

参数摘要必须来自稳定的规范化表示。例如 JSON 对象需要固定字段顺序、数值与 Unicode 规则，并排除重试时间戳、trace ID 等每次变化的元数据。摘要不是幂等键本身，它负责检测“同一个键被错误地用于不同意图”。Stripe 的公开 API 也会保存首次结果，并在同一键被不同参数复用时返回错误。[Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

**账本是一台状态机**

一个实用的执行记录至少包含：

```text
principal_id, tool_name, operation_id  -- 唯一约束
request_hash
status: RUNNING | SUCCEEDED | FAILED_FINAL
result / error
created_at, updated_at, expires_at
```

到达请求时：

- 没有记录：原子插入 `RUNNING`，插入成功者取得执行权。
- 已有 `SUCCEEDED` 且摘要相同：不再执行，返回保存的结果。
- 已有相同键但摘要不同：返回冲突，防止键误用。
- 已有 `RUNNING`：等待、返回“处理中”，或按租约与状态探测接管；不能直接再做副作用。
- 已有 `FAILED_FINAL`：稳定重放最终错误；是否允许用同一键重试临时失败，必须在 API 契约中明确。

只把键写进缓存不够。进程重启、缓存淘汰或切换副本后，服务端会忘记已执行结果；对于付款、发信等操作，账本的保留期必须覆盖客户端最大重试窗口和迟到请求窗口。

## 把去重记录与副作用放在同一提交边界

最关键的原子性不是“查到没有，然后插入”，而是由唯一约束或条件写让并发请求竞争同一个执行权。否则两个线程都可能先读到不存在，再分别执行副作用。

理想情况是账本和业务变更位于同一数据库事务：

```sql
BEGIN;

INSERT INTO tool_operation(
    principal_id, tool_name, operation_id, request_hash, status
) VALUES (?, ?, ?, ?, 'RUNNING');
-- 唯一键冲突时转入读取并校验旧记录的路径

-- 同一事务内更新业务表
UPDATE account
SET balance = balance - :amount
WHERE account_id = :account_id AND balance >= :amount;
-- 检查影响行数；不是 1 时，保存明确的业务失败或回滚，不能继续标记成功

UPDATE tool_operation
SET status = 'SUCCEEDED', result_json = :result
WHERE principal_id = ? AND tool_name = ? AND operation_id = ?;

COMMIT;
```

这样不会出现“扣款成功但幂等记录丢失”或“记录成功但扣款没有发生”的中间状态。AWS 的实践也强调，记录幂等令牌与相关变更需要满足原子、持久的一致性边界。[AWS Builders’ Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)

若工具只是代理外部系统，账本和外部副作用通常无法处于一个本地事务。此时按优先级处理：

1. 把同一个 `operation_id` 传给下游的幂等接口，并保存下游返回的资源 ID和结果。
2. 若下游只支持“创建后查询”，把 `operation_id` 作为可查询的业务外部号，再通过对账确认结果。
3. 若下游既不幂等也不可对账，不要把超时后盲目重试伪装成安全；应转入人工确认、补偿流程，或重新设计边界。

`SUCCEEDED` 结果应保存并重放，而不仅仅返回“已存在”。调用方在首次响应丢失后需要的是同一张收据，而不是一个让它继续猜测结果的冲突错误。Stripe 的实现示例会按幂等键保存首次状态码与响应体，后续请求返回同一结果。[Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

## 在单进程中折叠并发尝试并保留未知失败

保存为 `IdempotencyLedgerDemo.java`，使用 Java 17+ 执行 `java IdempotencyLedgerDemo.java`。它固定返回值为收据字符串，使用完整的调用方、工具和操作键，避免通用泛型账本中的不安全类型转换。八个并发尝试共用一个操作键；失败示例故意先产生副作用再抛异常，验证后续调用不会重新执行。

```java
import java.util.ArrayList;
import java.util.HashSet;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

public final class IdempotencyLedgerDemo {
    record Key(String caller, String tool, String operation) {}
    record Slot(String hash, CompletableFuture<String> result) {}

    static final class Ledger {
        private final ConcurrentHashMap<Key, Slot> slots = new ConcurrentHashMap<>();

        String execute(Key key, String hash, Supplier<String> effect) {
            Slot candidate = new Slot(hash, new CompletableFuture<>());
            Slot existing = slots.putIfAbsent(key, candidate);
            Slot selected = existing == null ? candidate : existing;
            if (!selected.hash().equals(hash)) {
                throw new IllegalArgumentException("operation reused with different payload");
            }
            if (existing == null) {
                try {
                    candidate.result().complete(effect.get());
                } catch (RuntimeException | Error failure) {
                    candidate.result().completeExceptionally(failure);
                    // 失败可能发生在副作用之后；保留记录，不开放重新执行。
                    if (failure instanceof Error fatal) throw fatal;
                }
            }
            return selected.result().join();
        }
    }

    public static void main(String[] args) throws Exception {
        Ledger ledger = new Ledger();
        Key key = new Key("alice", "charge", "order-42-payment");
        AtomicInteger effects = new AtomicInteger();
        Supplier<String> charge = () -> "rcpt-" + effects.incrementAndGet();
        var pool = Executors.newFixedThreadPool(8);
        try {
            var attempts = new ArrayList<Future<String>>();
            for (int i = 0; i < 8; i++) {
                attempts.add(pool.submit(() -> ledger.execute(key, "amount=100", charge)));
            }
            var receipts = new HashSet<String>();
            for (var attempt : attempts) receipts.add(attempt.get());
            if (receipts.size() != 1 || effects.get() != 1) throw new AssertionError("duplicate");
            System.out.println("concurrent receipts=" + receipts);
            System.out.println("replayed receipt=" + ledger.execute(key, "amount=100", charge));
            try {
                ledger.execute(key, "amount=200", charge);
                throw new AssertionError("payload conflict accepted");
            } catch (IllegalArgumentException expected) {
                System.out.println("payload conflict rejected=true");
            }
        } finally {
            pool.shutdownNow();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) throw new AssertionError("shutdown");
        }

        Key uncertain = new Key("alice", "charge", "order-43-payment");
        for (int i = 0; i < 2; i++) {
            try {
                ledger.execute(uncertain, "amount=100", () -> {
                    effects.incrementAndGet();
                    throw new IllegalStateException("receipt unavailable after side effect");
                });
                throw new AssertionError("expected failure");
            } catch (CompletionException expected) {
                if (!(expected.getCause() instanceof IllegalStateException)) throw expected;
            }
        }
        if (effects.get() != 2) throw new AssertionError("uncertain operation repeated");
        System.out.println("physical side effects=" + effects.get());
        System.out.println("uncertain operation was not repeated");
    }
}
```

使用 JDK 25.0.2，以 `javac --release 17` 编译后运行，预期输出如下；程序中的检查会核对这些结果。

```text
concurrent receipts=[rcpt-1]
replayed receipt=rcpt-1
payload conflict rejected=true
physical side effects=2
uncertain operation was not repeated
```

两次副作用分别来自两个不同的业务操作；第二个操作重复调用时只重放异常，不再次执行。这里不把异常解释为“明确未执行”，也不实现自动接管。生产账本应进一步区分可确定的最终失败与需要查询、对账的未知结果。

该程序只覆盖单进程并发折叠、结果重放和冲突检测。映射不持久化，没有过期、超时和恢复协议；传入的摘要字符串也只是示意。它不能直接用于生产扣款或发信，更没有解决账本与外部副作用的原子性。

## 为重试、恢复和过期定义契约

- **在计划层生成键。** 一次用户确认产生一个 `operation_id`，工作流检查点必须保存它；超时、模型重试和进程恢复都复用。用户明确发起第二次相同操作时生成新键。
- **由执行端强制幂等。** Prompt 中写“不要重复调用”只是软约束，不能替代唯一约束、状态机和结果重放。
- **把身份纳入作用域。** 使用 `(tenant, user/service, tool, operation_id)`，每次读取旧结果仍要重新鉴权，避免通过猜键读取他人的执行结果。
- **摘要采用版本化规范。** 记录 `hash_version`；工具参数演进时兼容旧规范，避免同一逻辑请求在升级后得到不同摘要。
- **区分重试类别。** 请求未通过校验可直接修正后重试；执行已开始但结果不明必须用同一键查询或重放；明确的业务拒绝通常不应自动重试。
- **让运行中状态可恢复。** `RUNNING` 记录要有心跳、租约或外部状态查询。租约到期只允许取得“恢复权”，不代表原副作用一定没发生。
- **监控幂等行为。** 记录首次执行、结果重放、参数冲突、长时间运行中和账本过期命中；高冲突率可能意味着调用方每次重试都重新组装了意图。
- **敏感操作仍需确认。** MCP 当前规范也建议对操作提供可见输入和人工确认；幂等只处理重复效果，不决定用户是否授权该效果。[MCP 2026-07-28 · Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
