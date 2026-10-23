---
title: futex 为什么能让无竞争锁留在用户态
date: 2026-10-23
domain: Linux
tags: [futex, Mutex, 系统调用, 并发]
---

线程每次获取互斥锁都必须进入内核吗？在 Linux 上，常见答案是否定的。没有竞争时，锁通常只需在用户态执行一次原子读改写；只有获取者可能需要睡眠，或者释放者需要唤醒等待者时，才调用 futex。

futex 是 **fast userspace locking** 的基础设施，却不是一把由内核完整管理的锁。锁的状态和所有权协议主要由用户空间定义，内核只提供“当某个 32 位值仍等于预期值时睡眠”和“唤醒等待者”等操作。本文用一个简化互斥锁说明快路径与慢路径怎样衔接，以及 `FUTEX_WAIT` 的比较为什么能避免丢失唤醒。

示例面向 Linux，使用 C11 原子操作和直接系统调用。本文附件已在 x86-64、Linux 6.18.55、Ubuntu 24.04 用户空间、GCC 13.3.0 下编译运行；它用于展示协议，不替代 pthread mutex，也没有实现重入、超时、取消、健壮锁或优先级继承。

## futex word 保存协议状态，不由内核长期托管

[Linux `futex(2)` 手册](https://man7.org/linux/man-pages/man2/futex.2.html)把 futex word 定义为四字节对齐的 32 位值，64 位平台也是如此。线程通过普通原子指令读写它，只有执行 futex 操作时才把地址交给内核。没有线程在该地址上等待时，内核不必为它长期保留锁对象。

一个教学用互斥锁可以约定三种状态：

| 值 | 用户空间含义 |
| --- | --- |
| `0` | 未加锁 |
| `1` | 已加锁，尚未发现等待者 |
| `2` | 已加锁，可能存在等待者 |

这些数值不是 futex ABI 规定的通用锁格式，只属于当前实现。其他运行库可以在同一个 32 位字中保存拥有者 TID、等待者位或健壮锁标志。内核理解的是某次 futex 操作及其参数，不会凭 `1` 或 `2` 自动推断这把锁的业务语义。

## 快路径只竞争一个原子状态字

获取锁先尝试把 `0` 原子地改成 `1`：

```c
int observed = 0;
if (atomic_compare_exchange_strong_explicit(
        &mutex->state,
        &observed,
        1,
        memory_order_acquire,
        memory_order_relaxed)) {
    return;
}
```

CAS 成功说明此前没有拥有者，线程直接进入临界区。整条路径没有 `futex()`，内核也不知道这把锁刚被获取。释放时若状态仍为 `1`，一次 release 原子操作把它减到 `0`，同样无须系统调用：

```c
if (atomic_fetch_sub_explicit(&mutex->state, 1, memory_order_release) == 1) {
    return;
}
```

这里的性能来源不是“futex 系统调用特别快”，而是无竞争路径根本不调用它。代价仍然存在：原子读改写会参与缓存一致性，锁还会序列化临界区。线程争用同一缓存行时，即使暂时没有睡眠，成本也不会等同于普通局部变量访问。

## 慢路径把等待责任交给内核

CAS 失败表示锁已被占用。获取者把状态推进到 `2`，然后调用 `FUTEX_WAIT_PRIVATE`，请求仅在该字仍为 `2` 时睡眠。释放者看到状态不是 `1`，就把它发布为 `0`，再用 `FUTEX_WAKE_PRIVATE` 唤醒至多一个等待者。

附件中的核心循环如下：

```c
if (observed != 2) {
    observed = atomic_exchange_explicit(&mutex->state, 2, memory_order_acquire);
}
while (observed != 0) {
    futex_wait_private(&mutex->state, 2);
    observed = atomic_exchange_explicit(&mutex->state, 2, memory_order_acquire);
}
```

等待者醒来后并不自动拥有锁。它重新用原子交换竞争状态；读到 `0` 的线程把状态写成 `2` 并取得锁，其他线程继续等待。状态保持为 `2`，让后续释放知道仍应走唤醒路径。

内核慢路径的价值是把不能继续工作的线程从运行队列竞争中移开。它需要系统调用、等待队列操作和调度，成本远高于一次成功 CAS，却避免线程在持锁时间较长时持续自旋占用 CPU。成熟实现还可能先短暂自旋，再根据竞争情况决定是否睡眠。

## 比较后再睡眠封住了丢失唤醒窗口

如果等待接口只是无条件睡眠，会出现一个危险交错：

1. B 在用户态看到锁被 A 占用，决定睡眠。
2. A 把锁改成空闲并执行唤醒，但 B 尚未进入内核等待队列。
3. B 随后睡下，而不会再有人唤醒它。

`FUTEX_WAIT` 要求调用者同时提供预期值。根据 [`FUTEX_WAIT(2const)`](https://man7.org/linux/man-pages/man2/futex_wait.2const.html)，内核对 futex word 的读取、与预期值比较、开始阻塞这三步相对于同一 futex word 上的并发 futex 操作是原子的：

| A 与 B 的实际顺序 | 内核观察 | B 的结果 |
| --- | --- | --- |
| B 先完成比较并入队，A 后释放 | 值仍为 `2`，B 成为等待者 | A 的 wake 能找到 B |
| A 先发布 `0` 并 wake，B 后进入 wait | 值已不等于 `2` | wait 以 `EAGAIN` 立即返回 |

第二种情况下，wake 当时没有等待者并不构成丢失通知。B 的 wait 会发现决定睡眠的前提已经失效，于是回到用户态重新竞争。这就是手册所说的 **atomic compare-and-block**：它没有替用户空间决定条件，只保证“条件仍成立才睡眠”。

共享状态的发布必须发生在 wake 之前。先唤醒、后把锁改为 `0`，会让被唤醒线程重新看到旧状态并再次睡眠，且之后可能没有新的 wake。futex 不是能储存次数的通知邮箱；正确性来自状态变化、条件比较和唤醒顺序共同组成的协议。

## 一次实测把两条路径分开

下载 [FutexMutexDemo.c](./FutexMutexDemo.c)，使用以下命令编译：

```bash
gcc -std=c11 -O2 -Wall -Wextra -Werror -pthread \
  FutexMutexDemo.c -o futex_mutex_demo
```

`uncontended` 模式由单线程获取和释放 100,000 次。程序内部记录显式调用的 wait 与 wake 次数：

```text
$ ./futex_mutex_demo uncontended
mode=uncontended counter=100000 wait_calls=0 wake_calls=0 woken_threads=0
```

计数在每次 syscall 前递增，因此这次输出也说明教学锁的无竞争路径没有执行 futex 系统调用。若运行环境允许 `ptrace`，还可以用 `strace` 从进程边界独立观察：

```bash
strace -f -e trace=futex ./futex_mutex_demo uncontended
strace -f -e trace=futex ./futex_mutex_demo contended
```

`contended` 模式先由主线程持锁，再让第二个线程尝试获取，并保留 50 毫秒竞争窗口。实测输出为：

```text
$ ./futex_mutex_demo contended
mode=contended counter=2 wait_calls=1 wake_calls=2 woken_threads=1
```

第一次 wake 唤醒等待线程。它取得锁时把状态保留为 `2`，因为这个简化协议无法确定身后是否还有其他等待者；它随后释放时保守地再执行一次 wake，内核返回唤醒 0 人。因此 `wake_calls` 是 2，而 `woken_threads` 是 1。额外系统调用是简化状态编码换来的代价，不影响互斥正确性。

在允许跟踪的环境中，`strace` 应能显示等待线程执行 `FUTEX_WAIT_PRIVATE`，释放线程执行 `FUTEX_WAKE_PRIVATE`。跟踪中还可能出现线程库为 `pthread_join` 等操作使用的 futex；因此判断自定义锁时应同时看地址、操作类型和程序计数，不能把进程里的每个 futex 都归给这一把锁。

这个实验只证明指定环境和这两次受控执行中的路径。真实 pthread mutex 的状态编码、适应性自旋和各种 mutex 属性由具体 libc 实现决定，不能用附件的三个状态推断其内部布局。

## futex 不替代 acquire/release 内存序

睡眠和唤醒解决“线程何时停止运行、何时再尝试”，受保护数据的可见性仍由用户空间同步协议建立。示例在成功获取时使用 acquire，在释放时使用 release，使前一拥有者临界区中的写入先于下一拥有者通过获取观察这些数据。

只把普通整数地址交给 `FUTEX_WAIT` 和 `FUTEX_WAKE`，并不会自动把围绕它的所有非原子访问变成正确同步。编译器与处理器需要明确的原子操作和内存序；否则程序即使大多数时候能被唤醒，也可能仍有数据竞争。

醒来同样不等于条件已经成立。手册要求把成功返回也保守地视为可能的虚假唤醒；信号还可能令 wait 以 `EINTR` 返回，值不匹配会产生 `EAGAIN`。调用者必须在循环中重读状态，而不是把一次 wait 返回当作锁的所有权凭证。

## 地址范围决定内核怎样识别等待队列

示例使用 `_PRIVATE` 操作，因为所有线程都在同一进程。`FUTEX_PRIVATE_FLAG` 告诉内核无需处理跨进程共享，从而允许额外优化。若锁位于可供多个进程访问的共享内存中，就不能使用 private 变体；各进程的虚拟地址即使不同，只要映射到同一共享位置，普通 futex 操作仍可关联它们。

这也意味着 futex word 的生命周期必须覆盖全部等待者。等待期间释放或复用承载它的内存，可能让相同地址代表另一个对象，产生虚假唤醒甚至内存安全问题。销毁同步对象前，程序必须通过更高层协议确认没有线程仍会访问或等待该地址。

## 健壮性与优先级继承是额外协议

基础 wait/wake 不知道谁拥有锁。线程持锁退出时，普通 futex 不会自动把锁恢复为空闲；等待者可能永久阻塞。[Linux 的 robust futex ABI](https://docs.kernel.org/locking/robust-futex-ABI.html)通过每线程的用户态持锁链表和退出时的内核清理，标记 `FUTEX_OWNER_DIED` 并唤醒等待者，但这要求运行库严格维护规定布局。

优先级反转也不是基础 futex 自动解决的问题。实时场景可以使用 [PI futex](https://docs.kernel.org/locking/pi-futex.html)：无竞争时仍以用户态原子操作走快路径，发生竞争后由 `FUTEX_LOCK_PI` 把等待关系接入内核的 rt-mutex 和优先级继承机制。robust 与 PI 是两项独立属性，不能因为锁基于 futex 就默认同时具备。

应用代码通常应使用 pthread mutex、语言运行时同步器或经过验证的并发库。直接使用 futex 时，必须自行处理状态编码、内存序、虚假唤醒、中断、超时、对象生命周期、进程共享、拥有者退出与公平性。futex 提供的是连接用户态状态与内核阻塞的原语，不是省略这些协议的捷径。

无竞争锁之所以能留在用户态，是因为共享的原子状态字已经足以完成所有权转移。竞争发生后，`FUTEX_WAIT` 用“值仍匹配才阻塞”封住决定等待与真正入队之间的竞态，`FUTEX_WAKE` 再让释放者按需通知内核等待队列。快路径避开系统调用，慢路径避免无休止自旋，两者由同一个 futex word 上的状态协议衔接起来。
