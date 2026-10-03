import java.time.Duration;
import java.util.Objects;
import java.util.function.LongSupplier;

public final class DeadlineBudgetDemo {
    static final class Budget {
        private final LongSupplier clock;
        private final long started;
        private final long timeout;

        Budget(Duration timeout, LongSupplier clock) {
            this.clock = Objects.requireNonNull(clock);
            this.timeout = timeout.toNanos();
            if (this.timeout <= 0) throw new IllegalArgumentException("timeout");
            this.started = clock.getAsLong();
        }

        Duration remaining() {
            long elapsed = clock.getAsLong() - started;
            return Duration.ofNanos(elapsed >= timeout ? 0 : timeout - elapsed);
        }

        Duration childTimeout(Duration reserve) {
            if (reserve.isNegative()) throw new IllegalArgumentException("reserve");
            return Duration.ofNanos(Math.max(0, remaining().toNanos() - reserve.toNanos()));
        }
    }

    static final class ManualClock implements LongSupplier {
        private long nanos;
        ManualClock(long origin) { nanos = origin; }
        public long getAsLong() { return nanos; }
        void advanceMillis(long millis) { nanos += Duration.ofMillis(millis).toNanos(); }
    }

    public static void main(String[] args) {
        ManualClock gatewayClock = new ManualClock(10_000);
        Budget gateway = new Budget(Duration.ofSeconds(1), gatewayClock);
        gatewayClock.advanceMillis(250);
        Duration wireBudget = gateway.remaining();

        ManualClock serviceClock = new ManualClock(-900_000);
        Budget service = new Budget(wireBudget, serviceClock);
        serviceClock.advanceMillis(600);
        Duration database = service.childTimeout(Duration.ofMillis(20));
        if (wireBudget.toMillis() != 750 || database.toMillis() != 130) {
            throw new AssertionError("budget calculation");
        }
        System.out.printf("wire=%dms remaining=%dms database=%dms%n",
                wireBudget.toMillis(), service.remaining().toMillis(), database.toMillis());

        serviceClock.advanceMillis(200);
        if (!service.remaining().isZero()) throw new AssertionError("expired budget");
    }
}
