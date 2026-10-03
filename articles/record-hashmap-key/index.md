---
title: record 作为 HashMap 的键，为什么仍会查找失败
date: 2026-10-02
updated: 2026-10-03
domain: Java
tags: [Java, Record, HashMap, Immutability]
---

一个查询缓存用 `record` 封装参数，刚放入 `HashMap` 时能命中，调用方修改筛选列表后，用同一个键对象却查不到了。缓存没有被清空，键的引用也没换。变化发生在键内部：列表内容参与了相等性和哈希值计算，而 `record` 并不会冻结它引用的列表。

这类键需要保证的是：在映射存续期间，用来判定键是否相等的状态保持稳定。`record` 的组件字段是 `final`，只满足了其中一层约束。下面先用一个标签列表复现问题，再逐步确定防御性复制应该做到哪一层。

## 同一个键为什么会查不到

### record 固定了引用，列表内容仍能改变

假设缓存键只有一个组件，业务约定标签的顺序也属于查询条件：

```java
record Key(List<String> tags) {}
```

在没有显式构造器和访问器的情况下，构造器保存传入的列表引用，`tags()` 返回这个引用。字段不能重新赋值，但调用方既可以通过原列表添加元素，也可以通过 `key.tags()` 修改它。两条访问路径指向同一个列表。

[Java SE 25 的 Record API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html) 将 record 定义为浅不可变的数据载体，并说明默认 `equals()`、`hashCode()` 由组件字段导出。对于这里的 `List<String>`，列表的元素和顺序决定其相等性与哈希值。把 `"jvm"` 加到 `["java"]` 后，键所代表的查询条件已经改变。

这个问题不需要并发触发。以下片段先插入键，再修改调用方持有的列表，最后同时观察缓存大小和查找结果。完整导入、入口和检查见文末附件。

```java
var tags = new ArrayList<>(List.of("java"));
var key = new Key(tags);
Map<Key, String> cache = new HashMap<>();
cache.put(key, "cached");

tags.add("jvm");

System.out.println(cache.size());
System.out.println(cache.keySet().iterator().next() == key);
System.out.println(cache.get(key));
```

本例运行得到 `1`、`true`、`null`。条目仍然存在，遍历也能拿到原键对象，但按键查找已经失败。

### HashMap 不会随着键变化重新定位条目

理解这个现象，需要区分规范约束与具体实现。[Map API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html) 明确指出：对象作为键期间，如果发生影响 `equals` 比较的变化，Map 的行为没有规定。因此，“修改后一定返回 null”不是适用于所有输入和所有 Map 实现的保证。

本例的失败可以从 [OpenJDK 25 GA 的 HashMap 实现](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/HashMap.java) 解释。插入时，节点保存当时计算的哈希值。查询时，`getNode` 用传入键的当前状态重新计算哈希值，定位桶，并先比较节点中保存的哈希值，再检查引用相同或 `equals` 相等。

于是，插入与查询依据了两个时刻的状态。列表变了，查询用的哈希值也可能变了；已保存的节点不会因为列表发生变化就自动移动或刷新哈希值。即使新旧哈希恰好落入同一个桶，节点的哈希值比较仍可能阻止匹配，不能指望“传入的还是同一个对象”挽救查找。

这也说明了排查时为什么不能只看 `size()`，或者只检查 `equals(key)` 是否为真。它们并不证明哈希查找路径仍然有效。换成并发容器也不会替业务冻结键的相等性状态。

## 把查询条件固定在构造时

现在需要修复的是两个共享入口：调用方还持有传入列表，访问器又会把组件交还给调用方。只关闭其中一个入口，键的内容仍可能变化。下面逐步比较三种处理方式。

### 只禁止通过视图修改，原列表仍然可变

一种常见修补是把列表包装起来：

```java
var tags = new ArrayList<>(List.of("java"));
var key = new Key(Collections.unmodifiableList(tags));
```

现在 `key.tags().add("jvm")` 会抛出 `UnsupportedOperationException`，但 `tags.add("jvm")` 仍然成功，键看到的内容也随之改变。

原因在于 [`Collections.unmodifiableList`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#unmodifiableList(java.util.List)) 返回的是原列表的不可修改视图。它限制通过视图发起的修改，查询仍然读取底层列表。这个 API 适合“调用方只能观察、拥有者继续维护”的场景；缓存键需要的是稳定的查询条件，直接包装一个外部仍可修改的列表无法提供这种保证。

另一种不完整的修补是只做 `new ArrayList<>(tags)`。它隔离了原列表，但默认访问器仍会暴露新的可变列表。输入时复制和输出时保护必须一起考虑。

### 保存不可修改快照，同时隔离输入和输出

对于 `List<String>`，可以在紧凑构造器中处理输入：

```java
record SnapshotKey(List<String> tags) {
    SnapshotKey {
        tags = List.copyOf(tags);
    }
}
```

构造器结束时，经过处理的参数会被赋给组件字段。这里使用 [`List.copyOf`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#copyOf(java.util.Collection)) 的关键是它的内容隔离与不可修改契约，不是“必须分配一个新对象”：后续修改原集合不会改变返回列表的元素序列，而调用者也不能通过返回列表增删或替换元素。对于符合条件的不可修改列表，实现可以复用实例。

因为元素是不可变的 `String`，这个键的相关状态已经稳定。调用方随后修改原列表，缓存键仍代表构造时的条件；重新创建内容相同的 `SnapshotKey` 也能命中它。

这里还包含一项明确的输入约束：`List.copyOf` 不接受空引用或 `null` 元素。如果业务允许这些值，需要先定义它们的含义，再选择相应的保存方式，不能在迁移旧 DTO 时悄悄改变契约。

### 嵌套列表需要继续固定内层内容

把组件换成 `List<List<String>>` 后，外层 `List.copyOf` 只固定了外层列表的元素引用。内层列表仍可能被共享，以下操作仍然合法：

```java
record NestedKey(List<List<String>> groups) {
    NestedKey {
        groups = List.copyOf(groups);
    }
}

var group = new ArrayList<>(List.of("java"));
var key = new NestedKey(List.of(group));
key.groups().get(0).add("jvm");
```

外层禁止 `add`，没有限制内层列表的 `add`。内层内容变化又会传递到外层列表的相等性与哈希值，最终影响整个键。

对于这个确定的两层结构，可以逐组固定内部列表，再收集为不可修改的外层列表：

```java
record GroupSnapshotKey(List<List<String>> groups) {
    GroupSnapshotKey {
        groups = groups.stream().map(List::copyOf).toList();
    }
}
```

[`Stream.toList()`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html#toList()) 保证返回列表不可修改。内层也已固定，叶子是 `String`，因而这里不再保留可改变键内容的列表入口。这个实现依赖当前的数据结构，并不是通用深复制工具；如果叶子换成有 setter、按属性比较的业务对象，就应继续转换为稳定的值对象或提取业务需要的不可变标识。

上述构造过程都假定输入在读取期间没有被其他线程修改。防御性复制可以隔离复制完成后的变化，但不会自动为并发写入的整个对象图建立原子快照。

## 用五组输入确认保护边界

下载 [RecordKeyDemo.java](./RecordKeyDemo.java)，在文件所在目录执行以下命令。示例以 JDK 25 LTS 为基线，只依赖标准库，包名为 `io.allurx`，不需要 Maven 或第三方库。

```sh
javac -Xlint:all -d out RecordKeyDemo.java
java -cp out io.allurx.RecordKeyDemo
```

五组场景依次比较：直接保存可变列表、保存不可修改视图、保存字符串列表快照、只保存外层快照，以及固定两层列表。除了输出，程序还检查受保护入口会拒绝修改，并用新建的等价键确认两种有效方案可以命中缓存。

本文在 Windows、Oracle JDK 25.0.2 LTS 上按上述命令编译并运行，`-Xlint:all` 未报告警告，输出如下。契约核对使用 Java SE 25 文档；源码解释定位到 OpenJDK 25 GA，用来说明保存哈希与重新计算哈希之间的关系，不把某次查找失败推广为所有 Map 的保证。

```text
mutable: hashChanged=true, sameReference=true, size=1, get=null
view: tags=[java, jvm], get=null
snapshot: tags=[java], equivalentKeyGet=cached
nested: groups=[[java, jvm]], get=null
groupSnapshot: groups=[[java]], equivalentKeyGet=cached
```

对照输出可以看到，`view` 仍会随原列表变化，`nested` 则会随内层列表变化；真正稳定的两组都是在构造时切断了参与相等性计算的可变共享状态。程序只验证这些输入，没有覆盖并发复制，也不能据此比较方案的性能。

## 复制之前，先定义“同一个查询”

本例把 `["java", "jvm"]` 与 `["jvm", "java"]` 当作不同条件，因为列表顺序参与相等性。如果标签在业务上是无序集合，那么稳定地保存错误的相等性定义，缓存依然会产生无意义的不同键。此时应先确定是否忽略顺序、是否合并重复值，再采用相应的规范化方式。

当缓存只按某个稳定 ID 区分对象时，直接用这个 ID 作键通常比复制整份业务对象更清楚。只有查询结果确实取决于一组条件的内容时，才需要保存这些条件的稳定快照。保护范围由键的相等性定义决定，不能仅凭类型声明里出现了 `record` 或 `final` 就判断已经安全。
