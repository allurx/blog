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
