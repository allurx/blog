package io.allurx;

import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 在 JDK 25 中比较 volatile 自增与原子自增，不保证每次调度都暴露丢失更新。
 */
public final class VolatileIncrementDemo {
    private static final int ITERATIONS = 1_000_000;

    private static final class VolatileCounter {
        private volatile int value;

        void increment() {
            value++;
        }

        int get() {
            return value;
        }
    }

    private static final class AtomicCounter {
        private final AtomicInteger value = new AtomicInteger();

        void increment() {
            value.incrementAndGet();
        }

        int get() {
            return value.get();
        }
    }

    private static void incrementFromTwoThreads(Runnable increment)
            throws InterruptedException, ExecutionException {
        CountDownLatch start = new CountDownLatch(1);
        Callable<Void> worker = () -> {
            start.await();
            for (int index = 0; index < ITERATIONS; index++) {
                increment.run();
            }
            return null;
        };

        // 闩锁提供共同起点；读取两个 Future，确保异常不会留在后台任务中。
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(worker);
            var second = executor.submit(worker);
            start.countDown();
            first.get();
            second.get();
        }
    }

    public static void main(String[] args) throws InterruptedException, ExecutionException {
        VolatileCounter volatileCounter = new VolatileCounter();
        AtomicCounter atomicCounter = new AtomicCounter();
        incrementFromTwoThreads(volatileCounter::increment);
        incrementFromTwoThreads(atomicCounter::increment);

        int expected = ITERATIONS * 2;
        if (atomicCounter.get() != expected) {
            throw new AssertionError("atomic increments were lost");
        }
        System.out.printf("volatile=%d expected=%d%n", volatileCounter.get(), expected);
        System.out.printf("atomic=%d expected=%d%n", atomicCounter.get(), expected);
    }
}
