#define _GNU_SOURCE

#include <errno.h>
#include <linux/futex.h>
#include <pthread.h>
#include <stdint.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

typedef struct {
    _Atomic int state;
} FutexMutex;

_Static_assert(sizeof(_Atomic int) == sizeof(uint32_t), "this demo requires a 32-bit atomic int");
_Static_assert(_Alignof(_Atomic int) >= 4, "this demo requires four-byte futex alignment");

static _Atomic unsigned int wait_calls;
static _Atomic unsigned int wake_calls;
static _Atomic unsigned int woken_threads;
static _Atomic int waiter_ready;
static int protected_counter;

static void fail(const char *message) {
    perror(message);
    exit(EXIT_FAILURE);
}

static void fail_pthread(const char *message, int error) {
    fprintf(stderr, "%s: %s\n", message, strerror(error));
    exit(EXIT_FAILURE);
}

static void futex_wait_private(_Atomic int *address, int expected) {
    atomic_fetch_add_explicit(&wait_calls, 1, memory_order_relaxed);
    long result = syscall(SYS_futex, (int *)(void *)address, FUTEX_WAIT_PRIVATE, expected, NULL, NULL, 0);
    if (result == -1 && errno != EAGAIN && errno != EINTR) {
        fail("futex wait");
    }
}

static void futex_wake_one_private(_Atomic int *address) {
    atomic_fetch_add_explicit(&wake_calls, 1, memory_order_relaxed);
    long result = syscall(SYS_futex, (int *)(void *)address, FUTEX_WAKE_PRIVATE, 1, NULL, NULL, 0);
    if (result == -1) {
        fail("futex wake");
    }
    atomic_fetch_add_explicit(&woken_threads, (unsigned int)result, memory_order_relaxed);
}

static void futex_mutex_lock(FutexMutex *mutex) {
    int observed = 0;
    if (atomic_compare_exchange_strong_explicit(
            &mutex->state,
            &observed,
            1,
            memory_order_acquire,
            memory_order_relaxed)) {
        return;
    }

    if (observed != 2) {
        observed = atomic_exchange_explicit(&mutex->state, 2, memory_order_acquire);
    }
    while (observed != 0) {
        futex_wait_private(&mutex->state, 2);
        observed = atomic_exchange_explicit(&mutex->state, 2, memory_order_acquire);
    }
}

static void futex_mutex_unlock(FutexMutex *mutex) {
    if (atomic_fetch_sub_explicit(&mutex->state, 1, memory_order_release) == 1) {
        return;
    }

    atomic_store_explicit(&mutex->state, 0, memory_order_release);
    futex_wake_one_private(&mutex->state);
}

static void print_result(const char *mode) {
    printf(
        "mode=%s counter=%d wait_calls=%u wake_calls=%u woken_threads=%u\n",
        mode,
        protected_counter,
        atomic_load_explicit(&wait_calls, memory_order_relaxed),
        atomic_load_explicit(&wake_calls, memory_order_relaxed),
        atomic_load_explicit(&woken_threads, memory_order_relaxed));
}

static void run_uncontended(void) {
    FutexMutex mutex = {0};
    for (int i = 0; i < 100000; i++) {
        futex_mutex_lock(&mutex);
        protected_counter++;
        futex_mutex_unlock(&mutex);
    }
    print_result("uncontended");
}

static void *waiter_main(void *argument) {
    FutexMutex *mutex = argument;
    atomic_store_explicit(&waiter_ready, 1, memory_order_release);
    futex_mutex_lock(mutex);
    protected_counter++;
    futex_mutex_unlock(mutex);
    return NULL;
}

static void run_contended(void) {
    FutexMutex mutex = {0};
    pthread_t waiter;

    futex_mutex_lock(&mutex);
    protected_counter++;
    int error = pthread_create(&waiter, NULL, waiter_main, &mutex);
    if (error != 0) {
        fail_pthread("pthread_create", error);
    }

    while (atomic_load_explicit(&waiter_ready, memory_order_acquire) == 0) {
    }
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 50000000};
    if (nanosleep(&delay, NULL) == -1) {
        fail("nanosleep");
    }

    futex_mutex_unlock(&mutex);
    error = pthread_join(waiter, NULL);
    if (error != 0) {
        fail_pthread("pthread_join", error);
    }
    print_result("contended");
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s uncontended|contended\n", argv[0]);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "uncontended") == 0) {
        run_uncontended();
        return EXIT_SUCCESS;
    }
    if (strcmp(argv[1], "contended") == 0) {
        run_contended();
        return EXIT_SUCCESS;
    }

    fprintf(stderr, "unknown mode: %s\n", argv[1]);
    return EXIT_FAILURE;
}
