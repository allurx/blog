---
title: "一致性哈希为什么能减少扩容时的数据迁移"
date: 2026-09-29
updated: 2026-10-02
domain: "系统设计"
tags: ["ConsistentHashing","Sharding","VirtualNodes"]
---

四个缓存节点按 `hash(key) % 4` 分片，扩容第五个节点时改为 `% 5`，绝大多数键都会换归属。即使扩容前后分布都很均匀，旧缓存仍可能大面积失效，导致后端突然承受回源流量。

一致性哈希把节点和键放进固定哈希空间，新增节点只接管相邻区间，减少成员变化造成的映射扰动。另一个问题则要分开看：迁移少不代表负载均衡。如果新节点只拿到很短的一段环，它迁移的数据很少，也可能几乎帮不上忙。下面用同一批确定性键同时观察迁移比例与负载离散度。

## 固定哈希空间怎样缩小重映射范围

取模分片把节点槽位数量当作除数。同一个哈希值对 4 和 5 取余通常不同；节点列表没有变更的前四项，也不意味着键会留在原节点。4→5 时，一个均匀随机哈希仅约 20% 的键保留原槽位，约 80% 被重映射。

一致性哈希使用固定大小的哈希空间：

1. 对节点标识求哈希，把节点放到一个首尾相接的环上。
2. 对键求哈希，从键的位置顺时针找到第一个节点。
3. 新节点加入时，只接管它与前驱之间的区间；其他区间的后继节点不变。
4. 节点移除时，只把它负责的区间交给下一个节点。

Karger 等人在 1997 年的[一致性哈希论文](https://doi.org/10.1145/258533.258660)中提出了成员变化时最小化映射扰动的核心性质。这里的“consistent”不是数据库强一致性，而是不同成员视图下的键映射尽可能保持稳定。

## 虚拟节点改善的是区间统计

最直接的实现是用有序映射保存环：键为节点令牌的哈希值，值为物理节点。查找时执行 `ceilingEntry(hash(key))`；若没有更大的令牌，就回绕到 `firstEntry()`。有 `V` 个虚拟节点、`N` 台物理机时，路由表约有 `N × V` 个令牌，树查找复杂度为 `O(log(NV))`。

一个物理节点只有一个令牌时，它获得的区间长度完全取决于随机落点，可能很小也可能很大。虚拟节点让一台物理机拥有多个分散令牌，把许多随机小区间汇总到一起，从而降低负载方差。Amazon Dynamo 论文明确采用虚拟节点，并指出它们还可按机器容量分配、在节点失效和恢复时把负载分散给多台机器；见 [Dynamo 论文 §4.2](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)及[作者对令牌映射的说明](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html)。

虚拟节点数不是越多越好。增加令牌会改善统计均衡，却也增大成员元数据、路由表和迁移计划；实际数量应通过节点规模、容量差异、目标负载偏差和控制面成本压测确定。

## 完整复现四节点扩到五节点

将下面的完整代码保存为 `ConsistentHashingDemo.java`，使用 Java 17+ 运行 `java ConsistentHashingDemo.java`。实验固定节点名 `node-0` 到 `node-4`、键名 `key-0` 到 `key-99999`，使用 UTF-8 和 SHA-256 的前 64 位，并用无符号比较保持哈希空间顺序。结果由这些输入共同决定，改变节点名也会改变区间分布。

```java
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Locale;
import java.util.NavigableMap;
import java.util.TreeMap;
import java.util.function.LongToIntFunction;

public final class ConsistentHashingDemo {
    private static final int KEY_COUNT = 100_000;
    private static final MessageDigest DIGEST = newDigest();

    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    // 本程序单线程使用该摘要实例，digest 完成后自动重置。
    private static long hash64(String value) {
        byte[] bytes = DIGEST.digest(value.getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.wrap(bytes).getLong();
    }

    private static LongToIntFunction ring(int nodes, int tokensPerNode) {
        NavigableMap<Long, Integer> tokens = new TreeMap<>(Long::compareUnsigned);
        for (int node = 0; node < nodes; node++) {
            for (int token = 0; token < tokensPerNode; token++) {
                long position = hash64("node-" + node + "#" + token);
                if (tokens.putIfAbsent(position, node) != null) {
                    throw new AssertionError("token collision");
                }
            }
        }
        return key -> {
            var next = tokens.ceilingEntry(key);
            return (next == null ? tokens.firstEntry() : next).getValue();
        };
    }

    private static void compare(String name, long[] keys,
                                LongToIntFunction before,
                                LongToIntFunction after,
                                boolean checkRingProperty) {
        int moved = 0;
        int[] loads = new int[5];
        for (long key : keys) {
            int oldOwner = before.applyAsInt(key);
            int newOwner = after.applyAsInt(key);
            loads[newOwner]++;
            if (oldOwner != newOwner) {
                moved++;
                if (checkRingProperty && newOwner != 4) {
                    throw new AssertionError("an old node gained remapped keys");
                }
            }
        }
        double mean = keys.length / 5.0;
        double variance = Arrays.stream(loads)
                .mapToDouble(load -> Math.pow(load - mean, 2))
                .average().orElseThrow();
        double cv = Math.sqrt(variance) / mean;
        System.out.printf(Locale.ROOT,
                "%s moved=%d (%.2f%%) cv=%.4f loads=%s%n",
                name, moved, moved * 100.0 / keys.length, cv,
                Arrays.toString(loads));
    }

    public static void main(String[] args) {
        long[] keys = new long[KEY_COUNT];
        for (int i = 0; i < keys.length; i++) keys[i] = hash64("key-" + i);

        compare("modulo", keys,
                key -> (int) Long.remainderUnsigned(key, 4),
                key -> (int) Long.remainderUnsigned(key, 5), false);
        compare("ring-1", keys, ring(4, 1), ring(5, 1), true);
        compare("ring-128", keys, ring(4, 128), ring(5, 128), true);
    }
}
```

`moved` 统计新旧所有者不同的键；`loads` 是扩容后五个节点的键数；CV 是五个负载的总体标准差除以均值，越小表示键数越均匀。两组环还检查了一条结构性质：只增加 `node-4` 且不改变旧令牌时，发生迁移的键应全部流向新节点，不应在旧节点之间互相迁移。

| 方案 | 扩容后迁移键 | 迁移比例 | 扩容后负载变异系数 CV |
| --- | ---: | ---: | ---: |
| `hash % N` | 79,781 | 79.78% | 0.0090 |
| 环上每节点 1 个令牌 | 30,654 | 30.65% | 0.4943 |
| 环上每节点 128 个虚拟节点 | 19,678 | 19.68% | 0.0588 |

表格对应上面的确定性输入，运行环境为 JDK 25.0.2，编译参数为 `--release 17`；程序还会检查所有迁移是否都流向新增节点。单令牌环给新节点分配了 30.65% 的键，超出五节点均分的 20%；128 个令牌时更接近该目标，CV 也明显降低。取模分片的 CV 最低，但迁移了近八成的键，说明两项指标必须同时看。

更多虚拟节点改善的是随机区间的统计分布；这组确定性输入的结果，不能保证每一种节点命名或规模下都获得相同改善。

这里测量的是确定输入下的键数量分布，没有真实网络、缓存节点或迁移过程。热门键会破坏“键均匀即请求负载均匀”的假设，CV 也不能代替容量上限、请求延迟和迁移期间的错误率。

## 路由变化之外，还需要迁移与故障协议

- **把成员视图版本化。** 路由方若看到不同节点集合，同一个键可能被发往不同位置；成员变更需要一致的配置发布、版本号和回滚策略。
- **先复制再切流。** 新节点接管区间时，先复制或预热数据，核对完整性后再更新路由，避免把“少迁移”误解成“无需迁移”。
- **迁移要限速。** 限制并发、带宽和后台读放大，并观测缓存命中率、后端 QPS、复制积压与各节点容量。
- **按容量分配令牌。** 高容量节点可以拥有更多虚拟节点，但权重调整同样会触发迁移；不要在高峰期频繁自动抖动权重。
- **对热点单独治理。** 对极热键使用本地缓存、复制、请求合并或拆键；增加虚拟节点只改善区间统计，不会拆散单个键。
- **明确故障策略。** 路由到“下一个节点”只决定归属；副本数、读写仲裁、故障转移和修复仍需单独设计。
