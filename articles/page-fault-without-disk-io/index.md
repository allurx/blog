---
title: "缺页异常为什么不一定意味着磁盘 I/O"
date: 2026-10-15
domain: 内存管理
tags: [Page Fault, Virtual Memory, Page Cache, Copy-on-Write]
---

程序第一次访问一段刚申请的内存时，即使机器没有发生内存交换，也可能出现大量 page fault。反过来，一次文件映射访问是否读取存储设备，单看 `mmap()` 是否成功也无法判断。这里的关键是：**page fault 描述地址转换在当前状态下无法完成，不直接描述数据位于磁盘。**

本文以带 MMU 的 Linux 为讨论范围，沿 CPU、页表和内核的处理路径区分 minor fault 与 major fault，再用一个 C 程序观察匿名页、文件映射和 Copy-on-Write。读者需要了解虚拟地址与物理内存的基本区别；具体计数会受体系结构、内核、文件系统、Transparent Huge Pages（THP）和当时的 page cache 状态影响。

## 一次 fault 从缺失的页表映射开始

进程发出的 load 或 store 使用虚拟地址。CPU 通过多级页表把它翻译成物理页帧，并检查读、写和执行权限。Linux 内核的[虚拟内存概览](https://docs.kernel.org/admin-guide/mm/concepts.html#virtual-memory-primer)说明了这层关系：虚拟内存允许系统只把当前需要的信息留在物理内存中，同时借助页表完成地址翻译、保护和受控共享。

若页表项尚未建立、页面不在当前物理内存中，或者访问权限与页表项不符，处理器会把控制权交给内核的 page fault handler。内核结合产生 fault 的地址、访问类型和该进程的虚拟内存区域（VMA）判断下一步：

1. 地址与权限合法时，内核取得或创建目标页，更新页表，然后让原指令重新执行。
2. 地址没有合法映射，或者访问违反了无法修复的权限时，内核向进程发送 `SIGSEGV` 或 `SIGBUS` 等信号。

因此，page fault 也不等于应用错误。按需分页故意让许多合法页面在第一次访问前没有完整映射，用 fault 把分配、装页和复制推迟到真正需要时。`mmap()` 创建的是虚拟地址空间中的映射；调用返回并不要求对应范围里的每一页都已驻留。

## minor 与 major 按是否需要 I/O 区分

Linux 的 `getrusage()` 为进程记录 `ru_minflt` 和 `ru_majflt`。当前 Linux man-pages 将前者定义为**没有 I/O 活动即可处理的 page fault**，将后者定义为**处理时需要 I/O 活动的 page fault**。[`getrusage(2)` 对两个字段的定义](https://man7.org/linux/man-pages/man2/getrusage.2.html#DESCRIPTION)

这两个名称容易让人误以为 minor 只是耗时较短、major 只是耗时较长。真正的分类边界是处理 fault 是否必须发起 I/O。一次 minor fault 仍会进入内核，可能分配物理页、清零、复制数据并修改页表；这些工作都需要时间。一次 major fault 通常还要等待存储层完成数据读取，所以延迟往往更大，但计数本身不承诺固定耗时。

常见路径可以这样区分：

| 访问场景 | 内核为了恢复访问所做的关键工作 | 通常的分类 |
| --- | --- | --- |
| 首次读取匿名映射 | 建立指向只读共享零页的映射，或者提供已清零页面 | minor |
| 首次写入匿名映射 | 分配可写物理页并清零 | minor |
| 访问已在 page cache 中的文件页 | 把现有缓存页映射进当前进程页表 | minor |
| 访问不在 page cache 中的文件页 | 从文件的后备存储读取页面，再建立映射 | major |
| 访问已换出且不在 swap cache 中的匿名页 | 从 swap 读回页面 | major |
| 写入共享只读页或 `fork()` 继承的私有页 | 分配新页、复制旧内容并改成当前进程私有映射 | minor |

表中的“通常”很重要。相邻文件页可能被 readahead 提前读入；目标页可能已经由其他进程放进 page cache；换出页也可能仍在 swap cache 中。此时同一行代码会走不同路径。正常的文件读取、写入和 `mmap()` 都以 page cache 为主要交互层，[Linux Page Cache 文档](https://docs.kernel.org/mm/page_cache.html)也明确指出了这一点，所以“文件支持的映射”不能直接推出“本次访问读取了磁盘”。

## 匿名内存先得到地址，再按访问方式得到页面

匿名映射没有文件作为后备存储，进程的堆和栈也属于这一类。Linux 的[匿名内存说明](https://docs.kernel.org/admin-guide/mm/concepts.html#anonymous-memory)给出了典型的延迟分配路径：匿名映射起初主要定义进程可访问的虚拟区域；读取可建立指向特殊零页的页表项，写入才分配保存实际数据的普通物理页。

假设程序申请 1 GiB 匿名地址空间，但只写其中 16 MiB。内核没有必要立即为整段范围准备 1 GiB 物理内存。首次读取一页时，所有尚未写过的字节都应为零，多个虚拟页甚至多个进程可以暂时共享同一张只读零页。首次写入必须让修改只属于当前映射，内核才分配并清零一个可写页。

两种访问都可能增加 minor fault，却代表不同的物理内存结果。只看 fault 总数，无法推出新增了多少 Resident Set Size（RSS）；只看 `mmap()` 的长度，也无法推出多少页面已经实际分配。

## page cache 让文件映射也可能只产生 minor fault

文件映射把文件区间关联到虚拟地址区间。访问其中一页时，内核先寻找该文件偏移对应的 page cache 页面：

- 页面已经缓存时，内核只需把它接入当前进程的页表。这是一次需要内核修复映射、但不需要重新读取文件的 minor fault。
- 页面尚未缓存时，内核必须发起读取并等待数据可用。这条路径产生 major fault；一次读取还可能通过 readahead 带入后续页面。

这解释了为什么同一个程序第一次运行较慢，立即再次运行却主要出现 minor fault：第二次执行时，文件数据可能仍留在系统级 page cache 中。缓存不属于某个进程私有，另一个进程先读过同一文件也会改变结果。要评估存储访问，不能把 major fault 数量当作完整 I/O 计数，还应结合块设备、文件系统和进程 I/O 指标观察。

`MAP_PRIVATE` 文件映射又增加了一层 Copy-on-Write。根据 [`mmap(2)`](https://man7.org/linux/man-pages/man2/mmap.2.html#DESCRIPTION)，它创建私有的写时复制映射，修改不会对其他映射可见，也不会写回底层文件。首次读取仍可共享 page cache 页；首次写入则通过可恢复的写保护 fault 分配私有页并复制原内容，通常属于 minor fault。

## Copy-on-Write 用权限 fault 延迟复制

`fork()` 后，父子进程起初可以共享同一批物理页。内核把相关页表项设为只读，并记录它们采用 Copy-on-Write。任何一方执行首次写入时，CPU 因写权限不足触发 fault；内核确认这不是非法写入，而是 COW 条件，于是分配新页、复制原内容并把新页映射给写入方。

这一过程没有从文件或 swap 读取数据，通常记为 minor fault。它也说明“权限 fault”不一定最终变成 `SIGSEGV`：相同的处理器现象交给内核后，结果取决于 VMA 和页表记录的语义。对真正只读且不允许 COW 的映射执行写入，内核才会把它作为无法修复的访问处理。

## 用 getrusage 观察四段访问

同目录的[完整 C 示例](./page-fault-probe.c)按系统页大小遍历 32 MiB 区域，并在每一段前后调用 `getrusage(RUSAGE_SELF, ...)`：

```sh
cc -std=c11 -O2 -Wall -Wextra -Wpedantic page-fault-probe.c -o page-fault-probe
./page-fault-probe
```

程序依次观察匿名映射首次读取、首次写入、已由 `write()` 填充的临时文件映射，以及子进程写入继承页面。一次实际运行可能得到类似结果：

```text
anonymous first read        minor=8192 major=0
anonymous first write       minor=8192 major=0
warm file mapping read      minor=513 major=0
fork child COW write        minor=8192 major=0
```

数值不应逐行硬编码成测试断言。文件映射的 fault 数通常明显少于页面数，因为 fault-around、readahead 和较大的内核内存管理单位可以一次覆盖邻近页面；THP 也可能让匿名内存不再按基础页逐一计数。示例只验证每段访问能够完成并打印实际增量，重点是观察“发生了 page fault，但 major 仍为零”的路径。

若要研究真正的冷文件访问，需要在受控机器上准备独立数据集，并明确处理 page cache、readahead、文件系统和存储设备缓存。生产机器上为了实验全局清空缓存会干扰其他负载，也无法模拟正常工作集，不能把它当作日常基准步骤。

## 计数用于定位路径，不直接等价于根因

minor fault 持续增加，可能只是进程按需触碰新匿名页，也可能来自 COW、共享库、文件缓存页重新映射或内存回收后的页表重建。major fault 增加则说明处理这些 fault 需要 I/O，但仍要继续判断数据来自普通文件还是 swap、延迟发生在哪个存储层，以及访问是否本来就属于预期的冷启动。

分析时应把地址空间、驻留集合、fault 和 I/O 分开观察：

- 映射大小说明进程拥有多少可用虚拟地址范围。
- RSS 近似说明当前有多少页面驻留在物理内存，但共享页的归属需要更细指标解释。
- `ru_minflt` 与 `ru_majflt` 说明内核处理过多少相应类别的 fault。
- 块 I/O、文件系统和 swap 指标说明实际数据传输与等待发生在哪里。

page fault 是虚拟内存实现延迟工作的入口。匿名零页、page cache 和 Copy-on-Write 都会通过 fault 在需要时建立正确映射，却不必读取磁盘；只有恢复访问必须等待 I/O 时，Linux 才把它计入 major fault。用这条边界理解指标，才能避免把正常的按需分页误判成存储故障，也不会把没有 major fault 误解成访问完全没有成本。
