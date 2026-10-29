---
title: fork() 后为什么会共享文件偏移量
date: 2026-10-29
domain: 操作系统
tags: [POSIX, Linux, fork, File Descriptor]
---

在可定位的普通文件上调用 `read()`，内核会从当前文件偏移量开始读取，并按实际读取的字节数推进偏移量。程序在 `fork()` 之后，父子进程各自拥有文件描述符表，却仍可能互相改变下一次读取的位置。

原因在于 `fork()` 复制的是文件描述符，偏移量并不保存在描述符数字里。父子进程中的对应描述符继续引用同一个 open file description，文件偏移量正属于这个被共享的内核对象。

## 描述符数字只是进程内的索引

`open()` 返回的非负整数是当前进程文件描述符表中的索引。表项指向一个 open file description；后者再关联实际文件，并保存当前偏移量、访问模式和 `O_APPEND`、`O_NONBLOCK` 等文件状态标志。

| 层次 | 归属 | 与本文相关的内容 |
| --- | --- | --- |
| 文件描述符表项 | 每个进程 | 指向 open file description；保存 `FD_CLOEXEC` 等描述符标志 |
| open file description | 可被多个描述符引用 | 当前文件偏移量、文件访问模式、文件状态标志 |
| 文件对象 | 文件系统 | 文件数据、类型、权限和元数据 |

一次 `open()` 会创建新的 open file description。即使两个进程打开同一路径，两次调用通常也得到两个独立的偏移量。相反，`dup()` 产生的新描述符与原描述符指向同一个 open file description，所以它们共享偏移量。[Linux `open(2)` 手册](https://man7.org/linux/man-pages/man2/open.2.html)把描述符、open file description 和文件之间的关系作了明确区分。

## fork() 复制引用，不复制被引用的打开状态

`fork()` 创建子进程时，会复制父进程的文件描述符表。复制完成后，两张表相互独立：父进程关闭描述符不会直接删除子进程的表项，子进程修改 `FD_CLOEXEC` 也不会改动父进程的描述符标志。

表项中的引用仍指向原来的 open file description。于是结构变成：

| 父进程描述符 | 子进程描述符 | 指向的 open file description | 文件偏移量 |
| --- | --- | --- | --- |
| `fd = 3` | `fd = 3` | 同一个对象 | 同一份状态 |

描述符数字在两个进程中碰巧相同，不是共享的原因；即使通过 `dup2()` 换成不同数字，只要引用的是同一个 open file description，偏移量仍然共享。[`fork(2)` 的继承规则](https://man7.org/linux/man-pages/man2/fork.2.html)明确规定，子进程的每个继承描述符都引用与父进程对应描述符相同的 open file description，并共享文件偏移量与文件状态标志。

## 顺序读取会沿同一个游标继续

配套的 [`ForkOffsetDemo.c`](./ForkOffsetDemo.c) 在 Linux 6.18、GCC 13.3.0 上用以下命令编译：

```sh
cc -std=c17 -D_POSIX_C_SOURCE=200809L -Wall -Wextra -Werror -pedantic \
  ForkOffsetDemo.c -o fork-offset-demo
./fork-offset-demo
```

示例在 `fork()` 前写入 `ABCDEFGHIJ` 并把偏移量移回 0。子进程先读取 4 字节，再通过管道通知父进程；这个同步只用于固定演示顺序。父进程随后读取 3 字节，结果是：

```text
child read: ABCD
child offset: 4
parent read: EFG
parent offset: 7
pread at 0: AB
offset after pread: 7
offset after lseek(dup): 1
separate open read: A
shared description read: B
```

子进程的 `read()` 把共享偏移量从 0 推进到 4，因此父进程不会重新读到 `ABC`，而是从位置 4 继续得到 `EFG`。父进程读完后，同一偏移量变为 7。`read(2)` 对可定位文件的定义正是从 open file description 的当前偏移量读取，并按返回的字节数推进它。[`read(2)` 手册](https://man7.org/linux/man-pages/man2/read.2.html)

示例又用 `dup(fd)` 得到第二个描述符，并通过它执行 `lseek()`。原描述符观察到的偏移量随即变成 1，因为 [`dup(2)`](https://man7.org/linux/man-pages/man2/dup.2.html)也只增加一个指向同一 open file description 的引用。

## 共享游标不等于固定的进程顺序

示例通过管道规定了“子进程先读、父进程后读”。如果去掉同步，调度器可以让任一进程先执行，谁先拿到哪一段数据就不确定。共享偏移量只说明两次操作作用于同一游标，不会自动提供业务需要的处理顺序。

POSIX 还要求普通文件上的相关 I/O 操作在更新共享偏移量时彼此原子。当前 Linux 会避免两个并发 `read()` 因偏移量更新竞争而错误地读取重叠区间，但先后顺序仍由实际调度决定。Linux 在 3.14 之前没有正确满足这项要求；[`read(2)` 的 BUGS 说明](https://man7.org/linux/man-pages/man2/read.2.html#BUGS)记录了这一历史修复。

这个保证也不把多次系统调用合并成一个事务。一次 `lseek()` 加一次 `read()` 之间，另一个进程仍可改变共享偏移量；依赖“先定位再读”的跨调用协议需要额外同步。

## 不想共享位置时，把偏移量变成显式参数

`pread()` 接收独立的 `offset` 参数，从指定位置读取而不改变 open file description 的当前偏移量。示例在共享偏移量为 7 时执行 `pread(fd, ..., 2, 0)`，读到 `AB`，随后偏移量仍是 7。[`pread(2)`](https://man7.org/linux/man-pages/man2/pread.2.html)因此适合多个线程或进程对同一描述符做互不干扰的随机读取。

另一种方法是在 `fork()` 后重新 `open()` 文件。新的调用创建新的 open file description，因此得到独立游标。示例中的新描述符从位置 0 读到 `A`，原描述符则从先前设定的位置 1 读到 `B`。如何选择取决于目标：

- 多个执行单元负责固定区间时，优先用 `pread()` 或 `pwrite()`，位置直接出现在每次操作中。
- 每个执行单元需要自己的顺序游标时，各自 `open()` 文件。
- 多个写入者只需向末尾追加时，使用 `O_APPEND`，让“定位到末尾并写入”成为一次原子操作；不要用 `lseek()` 加 `write()` 模拟追加。[`write(2)`](https://man7.org/linux/man-pages/man2/write.2.html)说明了这项原子语义。

`O_APPEND` 只保证每次写入前的末尾定位与该次写入不可分割，不保证多次写入组成的记录不会与其他写入者交错。Linux 还存在一个特定差异：描述符带有 `O_APPEND` 时，`pwrite()` 仍会追加到末尾，而不是按传入偏移写入；需要同时依赖两者时应先核对目标系统行为。

## 共享对象的生命周期由最后一个引用决定

父进程关闭自己的描述符后，子进程的描述符仍然有效。只有最后一个引用该 open file description 的描述符被关闭，相关内核资源才会释放。[`close(2)`](https://man7.org/linux/man-pages/man2/close.2.html)说明了这个引用生命周期。

还要区分内核偏移量与 C 标准 I/O 缓冲。`fork()` 会复制用户态的 `FILE` 缓冲区；若在 `fork()` 前有尚未刷新的输出，父子进程之后都刷新各自副本，可能产生重复内容。这是用户态缓冲复制问题，不是 open file description 共享导致的现象。

因此，理解 `fork()` 后的文件行为，关键不是追踪描述符数字，而是确认多个描述符最终指向哪个 open file description。共享对象就共享偏移量和文件状态标志；重新 `open()` 才创建独立状态，`pread()` 与 `pwrite()` 则绕开隐式游标，把访问位置放回每次 I/O 调用中。
