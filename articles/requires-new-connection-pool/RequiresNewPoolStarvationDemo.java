import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

public final class RequiresNewPoolStarvationDemo {

    private record Result(int workers, int poolSize, int innerSuccess,
                          int innerTimeouts, int maxInUse) {
    }

    private static final class SimulatedConnectionPool {
        private final Semaphore permits;
        private final AtomicInteger inUse = new AtomicInteger();
        private final AtomicInteger maxInUse = new AtomicInteger();

        private SimulatedConnectionPool(int size) {
            permits = new Semaphore(size, true);
        }

        private Lease borrow(Duration timeout) throws InterruptedException, TimeoutException {
            if (!permits.tryAcquire(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                throw new TimeoutException("connection acquisition timed out");
            }
            int current = inUse.incrementAndGet();
            maxInUse.accumulateAndGet(current, Math::max);
            return new Lease(this);
        }

        private void release() {
            inUse.decrementAndGet();
            permits.release();
        }

        private int maxInUse() {
            return maxInUse.get();
        }
    }

    private static final class Lease implements AutoCloseable {
        private final SimulatedConnectionPool pool;
        private boolean closed;

        private Lease(SimulatedConnectionPool pool) {
            this.pool = pool;
        }

        @Override
        public void close() {
            if (!closed) {
                closed = true;
                pool.release();
            }
        }
    }

    public static void main(String[] args) throws Exception {
        Result saturated = runScenario(4, 4, Duration.ofMillis(200));
        Result withHeadroom = runScenario(4, 5, Duration.ofSeconds(2));

        System.out.println(saturated);
        System.out.println(withHeadroom);

        assert saturated.innerSuccess() == 0 : saturated;
        assert saturated.innerTimeouts() == 4 : saturated;
        assert saturated.maxInUse() == 4 : saturated;
        assert withHeadroom.innerSuccess() == 4 : withHeadroom;
        assert withHeadroom.innerTimeouts() == 0 : withHeadroom;
        assert withHeadroom.maxInUse() == 5 : withHeadroom;
    }

    private static Result runScenario(int workers, int poolSize, Duration innerTimeout)
            throws Exception {
        SimulatedConnectionPool pool = new SimulatedConnectionPool(poolSize);
        CyclicBarrier outerTransactionsReady = new CyclicBarrier(workers);
        CyclicBarrier innerAttemptsFinished = new CyclicBarrier(workers);
        AtomicInteger innerSuccess = new AtomicInteger();
        AtomicInteger innerTimeouts = new AtomicInteger();
        ExecutorService executor = Executors.newFixedThreadPool(workers);

        try {
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < workers; i++) {
                futures.add(executor.submit(() -> {
                    try (Lease outer = pool.borrow(Duration.ofSeconds(1))) {
                        await(outerTransactionsReady);

                        // The outer lease remains held while the simulated REQUIRES_NEW
                        // scope tries to borrow a second, independent connection.
                        try (Lease inner = pool.borrow(innerTimeout)) {
                            innerSuccess.incrementAndGet();
                            Thread.sleep(25);
                        } catch (TimeoutException e) {
                            innerTimeouts.incrementAndGet();
                        }
                        // Keep every outer lease until all inner attempts have finished.
                        // This prevents an early timeout from freeing an outer connection
                        // that a later inner attempt could consume.
                        await(innerAttemptsFinished);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(e);
                    } catch (TimeoutException e) {
                        throw new IllegalStateException("outer transaction could not start", e);
                    }
                }));
            }
            for (Future<?> future : futures) {
                future.get(5, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
        }

        return new Result(workers, poolSize, innerSuccess.get(),
                innerTimeouts.get(), pool.maxInUse());
    }

    private static void await(CyclicBarrier barrier) {
        try {
            barrier.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        } catch (BrokenBarrierException e) {
            throw new IllegalStateException(e);
        }
    }
}
