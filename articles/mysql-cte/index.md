---
title: "MySQL 的 CTE 表达式"
date: 2019-08-13
updated: 2026-10-03
tags:
  - MySql
  - CTE表达式
  - With语法
domain: MySQL
---

做月度报表时，最先卡住的有时并不是求和，而是没有订单的月份根本不会出现在查询结果里。折线图需要连续的月份轴，业务表却只能提供发生过交易的日期。可以先生成月份序列，再把业务数据接上去；CTE 让这两个步骤各自有名字，也让整条查询更容易读。

CTE（Common Table Expression，公用表表达式）是单条 SQL 内的命名结果集。普通 CTE 用来组织中间查询，递归 CTE 则从初始行出发，逐轮产生后续行。下面先看它的作用域，再用递归生成最近 24 个完整月份。

示例面向 **MySQL Community Server 9.7.2（9.7 LTS）**，使用 MySQL 客户端执行。运行前可用 `SELECT VERSION();` 确认服务端；文中的结果按 SQL 逻辑推导，未提供数据库实跑记录。语法与限制见 [MySQL 9.7 的 WITH 文档](https://dev.mysql.com/doc/refman/9.7/en/with.html)。

## 给查询的中间步骤起名字

### 一个名称只在当前语句内有效

最小的 CTE 包含名称、可选列名和一个查询：

```sql
WITH numbers (n) AS (
    SELECT 1
    UNION ALL
    SELECT 2
)
SELECT n FROM numbers ORDER BY n;
```

`numbers` 是结果集名称，`n` 是列名，括号内的查询产生两行。外层 SELECT 可以像读取表一样引用这个名称，预期结果是 1 和 2。

这条语句结束后，下一条 SQL 不能继续读取 `numbers`。CTE 的名称作用域属于当前语句；如果需要跨语句保存数据，应选择临时表或其他适合的存储方式。

### 后面的 CTE 可以继续使用前面的结果

同一个 WITH 可以定义多个 CTE，用逗号分隔。下面把“取得数值”和“筛选数值”分成两个命名步骤：

```sql
WITH numbers (n) AS (
    SELECT 1
    UNION ALL
    SELECT 2
),
selected AS (
    SELECT n FROM numbers WHERE n > 1
)
SELECT n FROM selected;
```

预期只返回 2。第二个定义引用已经出现的 `numbers`，外层查询再读取 `selected`。实际报表中，这些名称可以对应“已付款订单”“月度汇总”等业务概念，读者便不用在多层括号里反复寻找某个子查询承担的职责。

## 递归 CTE 怎样一轮一轮产生行

### 初始查询提供起点，递归查询推进一步

月份序列的关键是：有了某个月，就能求出它的上一个月。先用整数 1 到 5 观察同样的过程：

```sql
WITH RECURSIVE numbers (n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1
    FROM numbers
    WHERE n < 5
)
SELECT n FROM numbers ORDER BY n;
```

`SELECT 1` 只执行一次，产生初始行。递归部分随后读取上一轮产生的行，为满足 `n < 5` 的行加 1：

| 本轮输入 | 是否满足条件 | 本轮产生 |
| --- | --- | --- |
| 初始查询 | 不需要判断 | 1 |
| 1 | 是 | 2 |
| 2 | 是 | 3 |
| 3 | 是 | 4 |
| 4 | 是 | 5 |
| 5 | 否 | 没有新行，结束 |

最终结果包含初始行和各轮产生的行。这里使用 `UNION ALL` 保留它们；外层 `ORDER BY` 保证显示顺序，不能把递归产生顺序当成查询结果的排序承诺。

### 终止条件与列类型都从起点考虑

递归部分不再产生新行时，查询结束。本例用 `n < 5` 控制范围，服务器的 `cte_max_recursion_depth` 则为递归深度设置另一道限制。两者解决不同问题：前者表达我们想要多少行，后者限制执行资源。

列类型由非递归部分推导。若每轮都拼接更长的字符串，初始查询就需要用 CAST 给出足够的宽度；只在递归部分产生更宽的值，不会自动扩大最初确定的列类型。下面的月份查询也会显式使用 DATE，让后续日期运算延续同一种类型。

## 生成最近 24 个完整月份

### 固定参考日期，明确首尾范围

假设报表的参考日期为 **2026-10-03**。10 月尚未结束，最近一个完整月份是 2026 年 9 月，向前数 24 个月应从 2024 年 10 月开始。

```sql
SET @reference_date = DATE '2026-10-03';

WITH RECURSIVE months24 (n, month_start) AS (
    SELECT 1, CAST(DATE_FORMAT(
        DATE_SUB(@reference_date, INTERVAL 1 MONTH), '%Y-%m-01') AS DATE)
    UNION ALL
    SELECT n + 1, DATE_SUB(month_start, INTERVAL 1 MONTH)
    FROM months24
    WHERE n < 24
)
SELECT DATE_FORMAT(month_start, '%Y%m') AS month
FROM months24
ORDER BY month_start;
```

初始查询先减一个月，再取月初，得到 `2026-09-01`。递归每轮退一个月，编号从 1 到 24，因此包含初始行在内共 24 行。外层升序排列后，首行为 `202410`，末行为 `202609`，中间没有缺月。

固定参考日期便于核对边界。正式报表若按当天计算，可以把变量值换成 `CURRENT_DATE()`，月份范围也会随执行日期变化。

### 将月份轴与业务汇总连接

完整月份轴解决的是“哪些月份必须出现”。下一步让它作为 LEFT JOIN 的左侧，再关联按月汇总的订单数据：有汇总的月份显示金额，没有汇总的月份把缺失值转换为 0。

连接键最好保留 `month_start` 这样的日期值，显示时再格式化成 `YYYYMM`。这样生成、连接和展示各有清楚的职责。如果报表还要区分“确实没有交易”和“数据尚未到齐”，就需要额外的数据完整性标记，不能把所有缺失都解释成零销售额。

## 查询更好读之后，还要看执行计划

CTE 首先改善的是表达：一个复杂查询可以按中间步骤组织，同一语句也可以多次引用有名字的结果。至于执行成本，优化器可能合并或物化非递归 CTE；名称出现一次或被多次引用，并不能单独证明底层计算了几次。

对这份月度报表，应分别关注月份序列的规模、订单过滤条件、汇总扫描量以及连接方式。24 行的月份轴通常容易理解，真正的数据成本还需要结合业务表、索引和执行计划判断。语法更清楚，为定位这些成本提供了入口，但并不自动构成性能优化。[MySQL：派生表与 CTE 的优化](https://dev.mysql.com/doc/refman/9.7/en/derived-table-optimization.html)
