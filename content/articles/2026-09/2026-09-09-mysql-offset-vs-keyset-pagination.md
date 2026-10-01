---
title: "MySQL 深分页为什么越翻越慢"
date: "2026-09-09"
updated: "2026-10-01"
id: "2026-09-09-mysql-offset-vs-keyset-pagination"
domain: "MySQL"
tags: ["MySQL", "索引", "分页"]
---

同样返回 20 篇文章，第一页很快，第一百万行之后的一页却明显变慢。`LIMIT` 只约束返回数量；数据库仍需要确定排序后的起点，使用索引也不会让这个位置凭空可得。

本文以 MySQL 8.4 的 InnoDB 查询为例。连续翻页可以把“跳过多少行”改成“从上一页最后一个排序值继续”，也就是 Keyset Pagination。它能避免深度增长带来的重复越过成本，但牺牲了直接按页码随机跳转的能力，也不自动提供跨请求快照。

## 按位置跳过与按值继续

### Offset Pagination 是按位置分页

Offset Pagination 将结果集理解为一个有序数组：

```text
跳过 offset 行 → 返回后续 size 行
```

其扫描成本可近似表示为：

$$
O(\text{offset} + \text{size})
$$

这不是严格的物理 I/O 公式，因为缓存命中、覆盖索引、回表、排序和执行计划都会改变实际成本，它用于描述能利用索引顺序时的扫描增长趋势；若还有过滤或排序，实际处理量可能更大。

MySQL 官方说明，`ORDER BY ... LIMIT row_count` 在使用有序索引时可以很快地找到前 `row_count` 行；如果必须执行 `filesort`，则需要先选出匹配行并对其中多数或全部进行排序。[MySQL 8.4：LIMIT Query Optimization](https://dev.mysql.com/doc/refman/8.4/en/limit-optimization.html)

对于带有大 `OFFSET` 的查询，可以据此合理推断：优化器即使利用索引顺序，也仍需越过 `offset` 对应的索引记录。

### Keyset Pagination 是按值定位

Keyset Pagination 不询问“第几页”，而是询问：

> 在上一页最后一条记录之后，接下来的 20 条是什么？

如果上一页最后一条记录为：

```text
created_at = 2026-09-09 08:00:00
id = 9001
```

下一页使用这两个值作为游标，直接从索引范围继续查找，而不必重新越过此前全部记录。

理想情况下，其主要成本接近：

$$
O(\log N + \text{size})
$$

其中 `log N` 对应 B+Tree 范围定位，`size` 对应读取本页记录。实际性能仍取决于索引覆盖、数据分布和回表成本。

## 为过滤、排序和游标建立同一索引

假设表结构为：

```sql
CREATE TABLE article (
    id         BIGINT       NOT NULL PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    status     VARCHAR(20)  NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX idx_status_created_id (
        status,
        created_at DESC,
        id DESC
    )
) ENGINE = InnoDB;
```

查询第一页：

```sql
SELECT id, title, created_at
FROM article
WHERE status = 'PUBLISHED'
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

查询下一页；`:lastCreatedAt`、`:lastId` 是应用绑定参数的示意写法，不是直接粘贴到 MySQL 命令行的语法：

```sql
SELECT id, title, created_at
FROM article
WHERE status = 'PUBLISHED'
  AND (
      created_at < :lastCreatedAt
      OR (
          created_at = :lastCreatedAt
          AND id < :lastId
      )
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

索引顺序与查询结构相互对应：

| 索引列               | 作用             |
| ----------------- | -------------- |
| `status`          | 等值过滤           |
| `created_at DESC` | 主要排序与游标范围      |
| `id DESC`         | 唯一 Tie-breaker |

`id` 不只是性能字段，还用于建立全序关系。如果只写：

```sql
ORDER BY created_at DESC
```

多行具有相同 `created_at` 时，它们之间的顺序不确定。MySQL 官方明确指出：`ORDER BY` 列值相同的记录可以按任意顺序返回，而且执行计划受到 `LIMIT` 影响，因此不同查询的相对顺序可能变化。需要稳定排序时，应增加唯一列。[MySQL 8.4：LIMIT 排序确定性](https://dev.mysql.com/doc/refman/8.4/en/limit-optimization.html)

## 对比执行计划与真实游标

### Offset Pagination

```sql
SELECT id, title, created_at
FROM article
WHERE status = 'PUBLISHED'
ORDER BY created_at DESC, id DESC
LIMIT 1000000, 20;
```

即使 `idx_status_created_id` 能提供排序顺序，数据库仍需沿索引跳过大量条目。

如果查询列不全在二级索引中，还可能出现回表。具体是否对所有跳过行回表取决于执行计划和查询形态，不能仅凭 SQL 文本断言。

应使用实际执行计划验证：

```sql
EXPLAIN ANALYZE
SELECT id, title, created_at
FROM article
WHERE status = 'PUBLISHED'
ORDER BY created_at DESC, id DESC
LIMIT 1000000, 20;
```

`EXPLAIN ANALYZE` 会执行查询，并提供实际迭代次数和耗时；生产环境使用前必须评估查询成本。[MySQL 8.4：EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)

### Keyset Pagination

第一页返回：

```text
最后一条：
created_at = 2026-09-08 18:30:00.123456
id = 8172
```

客户端将它编码为不透明游标。下一次请求解码后，将两个值绑定到范围条件：

```sql
SELECT id, title, created_at
FROM article
WHERE status = 'PUBLISHED'
  AND (
      created_at < '2026-09-08 18:30:00.123456'
      OR (
          created_at = '2026-09-08 18:30:00.123456'
          AND id < 8172
      )
  )
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

游标必须保留数据库字段的完整精度。若数据库使用 `DATETIME(6)`，却在 API 中把时间截断到秒，相同秒内的部分记录可能被跳过或重复。

## 游标稳定性与产品分页需求

### 使用不可变或稳定的排序键

理想游标字段包括：

* 单调递增的主键。
* 创建时间与唯一主键的组合。
* 业务生成的全局有序 ID。

如果排序字段会频繁变化，例如：

```sql
ORDER BY score DESC, id DESC
```

一条记录在翻页期间分数变化后，可能移动到游标另一侧，导致重复或遗漏。Keyset Pagination 减少了 Offset 因插入和删除造成的位置漂移，但不能提供跨请求的一致性快照。

如果需要严格的跨页快照，可以固定可查询的数据版本、物化结果集，或在有明确生命周期和资源预算的批处理中使用同一数据库一致性快照。普通网页不宜让数据库长事务跨越用户多次操作。

“记录开始时的最大 ID”只是在 ID 单调生成等前提下排除后续新记录的一种上界；它不会冻结已有记录的内容、状态或排序值，不能单独提供严格快照。应把“本轮不纳入新数据”和“重现完全相同的数据版本”作为不同需求。

### 游标应包含全部排序信息

对于：

```sql
ORDER BY priority DESC, created_at DESC, id DESC
```

游标至少需要保存：

```text
priority + created_at + id
```

只保存 `id` 无法表达上一页在完整排序空间中的位置。

API 层通常应返回不透明字符串，而不是暴露多个分页参数。例如：

```json
{
  "items": [],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTA4VDE4OjMwOjAwLjEyMzQ1NiIsImlkIjo4MTcyfQ"
}
```

不透明不等于可信。服务端必须独立执行租户与授权过滤，并验证游标字段与当前查询条件一致；不能信任游标自报的租户或权限。需要防篡改时可以签名，但签名也不能替代本次请求的授权检查。

### 区分产品需求

| 需求          | 推荐方式                    |
| ----------- | ----------------------- |
| 首页、下一页、无限滚动 | Keyset Pagination       |
| 后台批量扫描      | Keyset Pagination       |
| 导出大量记录      | Keyset Pagination 或流式处理 |
| 精确跳到第 37 页  | Offset Pagination       |
| 展示粗略页数      | 单独统计或估算                 |
| 小型、低频管理页面   | Offset Pagination 通常足够  |

Keyset Pagination 不是对 Offset 的全面替代。它牺牲随机跳页能力，换取稳定的深页性能。

### 不要默认执行精确 COUNT

分页接口常同时执行：

```sql
SELECT COUNT(*)
FROM article
WHERE status = 'PUBLISHED';
```

在复杂过滤和大数据集上，精确计数本身可能比取一页数据更贵。如果产品只需要判断是否还有下一页，可请求 `size + 1` 条：

```sql
LIMIT 21
```

返回超过 20 条时，保留前 20 条并设置 `hasNext = true`。

这里的复杂度是设计判断，不能代替测量。检查执行计划时应使用真实过滤条件、页深和代表性数据，区分扫描索引项、回表和排序的成本。先查询 ID 再回表可以降低部分开销，却不会自动消除大 `OFFSET`；同样，写了复合索引也不保证优化器必定使用它。
