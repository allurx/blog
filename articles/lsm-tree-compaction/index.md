---
title: LSM-tree 为什么写得快，却离不开 Compaction
date: 2026-10-14
domain: 数据库
tags: [LSM-tree, SSTable, Compaction, Write Amplification]
---

面对持续写入，B-tree 通常要在目标页附近完成原地更新，LSM-tree 则先把变更写入日志和内存结构，积累到一定规模后再批量生成有序文件。单次前台写入因而避开了在巨大磁盘索引中立即寻找最终位置的工作。

这些工作没有消失，而是转移给后台的 Compaction：它反复归并有序文件，清理旧版本，并控制一次读取可能遇到多少份数据。本文沿写入、读取和归并三条路径解释这种转移，最后说明为什么 LSM-tree 的调优总是在写放大、读放大和空间放大之间取舍。讨论采用 LevelDB、RocksDB 一类键值存储的常见结构；具体数据库的文件格式、事务和压缩策略可能不同。

## 前台写入只决定数据先放在哪里

一次持久写入通常先追加到 Write-Ahead Log（WAL），再更新内存中的 MemTable。WAL 用于崩溃恢复，MemTable 以键顺序组织最新数据，读取时也必须查询它。MemTable 达到阈值后变为只读，并由后台按键顺序写成不可变的 Sorted String Table（SSTable）；新的写入同时进入另一张 MemTable。

[LevelDB 的实现说明](https://github.com/google/leveldb/blob/main/doc/impl.md#files)描述了同样的流程：更新追加进日志，日志内容在内存中保存为 MemTable，达到阈值后转换成有序表。这个设计有三个直接结果：

1. 前台不必为每个键立即修改磁盘上的随机位置，可以把许多小更新合并成顺序批量输出。
2. 已落盘的 SSTable 保持不可变，读线程不需要等待原地页修改完成；新文件准备好后，通过元数据切换加入当前版本。
3. 写入延迟仍受 WAL 同步策略、MemTable 并发控制和后台积压影响。“写得快”是工作被批处理后的常见结果，不代表每次写入都不等待持久化，也不保证吞吐可以超过存储设备长期可承受的后台 I/O。

SSTable 不可变也意味着更新不会覆盖旧值。若同一个键先后写入 `v1` 和 `v2`，两份记录可能暂时位于不同文件。删除也不能立刻修改所有旧文件，只能写入一个 Tombstone（删除标记），让读取路径把更老的值视为已经删除。

## 读取必须在多份有序数据中找最新版本

点查通常按新旧顺序查询：活动 MemTable、等待刷盘的不可变 MemTable、Level 0 文件，再到更高层级。每条记录带有序列号或等价的版本信息；找到多个候选时，读取结果由目标快照可见的最新版本决定，而不是简单选择任意文件中的值。

Level 0 直接接收 MemTable 的刷盘结果，不同文件的键范围可以重叠，所以某个键可能需要检查多份 L0 文件。经典的 Leveled Compaction 会让 L1 及以上同一层内的文件键范围互不重叠。已知目标键后，每个高层最多只有一个文件的范围可能命中。[RocksDB 调优指南对 Leveled 布局的说明](https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide#level-style-compaction)明确区分了 L0 的重叠文件和高层的不重叠范围。

内存索引可以先定位文件中的数据块，Bloom Filter 可以排除“一定不在这个文件中”的键，缓存还能避免部分磁盘访问。这些优化降低的是实际 I/O 和 CPU 成本，没有改变数据分散在多份有序运行（sorted run）中的事实。Bloom Filter 还存在假阳性，范围扫描也不能靠它逐键跳过整段范围。因此，放任 L0 文件和有序运行持续增加，读取代价最终仍会恶化。

## Compaction 把延后的整理工作补回来

Compaction 选取一组 SSTable，像归并排序一样按键顺序读取，再生成新的不可变 SSTable。对 Leveled Compaction，常见选择是一层中的部分文件及下一层所有键范围重叠的文件。新文件完成并登记到版本元数据后，旧文件才可在没有读者引用时删除。[LevelDB 的 Compaction 说明](https://github.com/google/leveldb/blob/main/doc/impl.md#compactions)给出了这种 some-to-some 的选择方式。

归并过程不只是重新排序，还会判断哪些记录仍有意义：

- 同一键的较新值已经覆盖旧值，并且没有快照需要旧版本时，可以丢弃旧值。
- Tombstone 下面若仍可能存在更老的值，就必须继续保留，否则删除标记消失后，旧值会重新出现在读取结果中。
- 当归并已经覆盖最底层相关键范围，并确认没有快照依赖时，Tombstone 及其遮蔽的旧值才可以一起清除。

同目录的[完整 Node.js 示例](./lsm-compaction.mjs)用三份有序运行演示这个边界。示例假定没有活动快照，只保留每个键的最新版本：

```sh
node lsm-compaction.mjs
```

在 Node.js 24.21.0 上输出：

```text
before-book=v2
before-user:2=<deleted>
partial-compaction-kept-tombstone=true
if-tombstone-were-dropped-user:2=enabled
bottommost-user:2=<absent>
```

只归并 L0 和 L1 时，较老的 L2 仍保存 `user:2=enabled`，因此输出必须保留删除标记。示例随后故意丢掉 Tombstone，读取就错误地“复活”了 L2 中的值。最后把相关层全部归并到底层，才可以同时移除删除标记和旧值。真实引擎还要保留活动快照可见的历史版本，判断条件比示例更严格；RocksDB 的[快照说明](https://github.com/facebook/rocksdb/wiki/Snapshot)也指出，Compaction 会感知所有快照并保留各快照可见的数据。

## 三种放大来自同一份延迟工作

LSM-tree 的代价通常用三个放大指标观察。它们不是彼此独立的故障，而是文件布局和归并策略在不同资源上的表现。

| 指标 | 含义 | 常见成因 |
| --- | --- | --- |
| 写放大 | 存储设备实际写入字节数 ÷ 应用写入数据库的字节数 | 同一数据随 Compaction 多次重写，WAL、压缩与文件系统行为还会增加物理写入 |
| 读放大 | 一次逻辑读取需要检查的数据结构、文件或块数量 | L0 重叠文件、多份 sorted run、缓存未命中和 Bloom Filter 假阳性 |
| 空间放大 | 物理占用相对当前逻辑数据量的额外比例 | 旧版本和 Tombstone 尚未回收，Compaction 输入与输出暂时共存 |

假设应用以 `10 MB/s` 写入，而存储设备因刷盘和归并实际写入 `30 MB/s`，按这个统计口径写放大就是 3。这个数字必须注明统计边界：数据库内部 Compaction 计数、进程写入量和设备层写入量可能包含不同部分，压缩与 SSD 自身的垃圾回收也会改变最终物理写放大。[RocksDB 调优指南](https://github.com/facebook/rocksdb/wiki/RocksDB-Tuning-Guide#amplification-factors)使用相同示例解释数据库写入率与磁盘写入率的比值。

不能只看平均写入延迟来判断 LSM 是否健康。前台持续把数据放入 MemTable 和 L0，若后台归并速度长期低于进入速度，待处理字节和 L0 文件数就会增长。系统最终必须限速或暂停写入，让后台追上，否则读放大和空间占用会失去边界。RocksDB 的[写停顿说明](https://github.com/facebook/rocksdb/wiki/Write-Stalls)列出的典型触发条件正是过多不可变 MemTable、过多 L0 文件和过多待归并字节。

因此，LSM 的稳定吞吐由整条后台管线决定。一次突发写入可以被内存吸收，长期吞吐却不能超过刷盘、Compaction、压缩和设备写带宽共同形成的稳态能力。增加写缓冲只能扩大吸收突发的窗口，不能修复永久的吞吐缺口。

## Leveled 与 Tiered 选择不同的代价

Compaction 没有同时最小化三种放大的通用策略。两类常见布局展示了最主要的取舍：

| 策略 | 归并方式 | 主要收益 | 主要代价 |
| --- | --- | --- | --- |
| Leveled | 较小层的部分数据与下一层重叠范围积极归并；每层通常形成一份按范围分片的 sorted run | 高层范围不重叠，点查和范围扫描需要合并的运行较少，空间回收更及时 | 下一层已有数据可能被反复重写，写放大通常较高 |
| Tiered / Universal | 等待若干大小接近的 sorted run，再把它们整体归并成更大的运行 | 数据每次归并通常向更大运行前进，写放大通常较低 | 同时存在更多运行，读放大和空间放大较高，大归并还可能产生明显的 I/O 峰值 |

[RocksDB 的 Compaction 分类](https://github.com/facebook/rocksdb/wiki/Compaction#classic-leveled)把 Leveled 描述为以较高写放大换取较低空间放大；[Universal Compaction 文档](https://github.com/facebook/rocksdb/wiki/Universal-Compaction#conceptual-basis)则明确说明 Tiered 家族以更高的读放大和空间放大换取较低写放大。具体结果还取决于键分布、覆盖率、层级倍率、文件大小、缓存、压缩和并发度，不能只凭策略名称预估固定倍数。

选择策略时应从负载约束出发。点查和短范围扫描对尾延迟敏感、磁盘空间紧张时，Leveled 往往更合适；持续摄取占主导、允许更多读合并且能预留归并空间时，可以评估 Tiered。键按顺序写入、更新集中在小范围、值很大或数据带明确 TTL 时，结论还会改变，应使用目标引擎的实际统计和真实负载压测。

LSM-tree 加速写入的核心是把即时、分散的整理变成延后、批量的归并。WAL 和 MemTable 缩短前台路径，SSTable 提供不可变的有序落盘格式，Compaction 则负责恢复读取与空间的边界。理解这份工作如何转移后，写停顿就不再是与“写优化结构”矛盾的异常，而是后台债务超过处理能力时必然出现的流量控制。
