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

CTE 是单条语句范围内的命名结果集，可让复杂 SQL 的中间步骤更清楚；递归 CTE 用初始查询和递归查询逐轮生成结果，适合层级和连续序列。它是一种查询表达方式，不保证自动提升性能，执行计划、索引与物化策略仍需结合实际查询判断。

本文示例以 **MySQL Community Server 9.7.2（9.7 LTS）** 为目标基线，可在 MySQL 9.7 客户端中逐条执行；先运行 `SELECT VERSION();` 确认服务端版本。`WITH` 从 MySQL 8.0 起提供，这个版本号描述语法起点，不是当前推荐的运行环境。下文输出依据查询逻辑推导，未据此声称在所有 MySQL 分支上实测通过。

## 先给中间查询结果命名

公用表表达式（Common Table Expression，CTE）是在一条语句内可引用的命名结果集。它不是创建了一张跨语句保留的临时表：`WITH` 所属语句执行完毕，名称的作用域也随之结束。非递归 CTE 表达中间查询，递归 CTE 则让后续轮次继续引用上一轮的结果。


### 定义、命名列与组合

CTE的结构包括名称、可选列和定义CTE的查询这三部分组成。使用with关键字连接一个或多个逗号分隔的查询语句组成了CTE。下面是一个CTE的例子：

```mysql
WITH cte1 AS ( SELECT 1 ),
cte2 AS ( SELECT 2 )
SELECT * FROM cte1
UNION
SELECT * FROM cte2;
```

上面的例子中定义了两个CTE，可以通过这两个CTE的名称来访问他们。当然了我们也可以给CTE的列起一个名称

```mysql
WITH cte ( n ) AS ( SELECT 1 UNION SELECT 2 )
SELECT n FROM cte;
```

同时我们也可以在其它CTE中引用另一个CTE

```mysql
WITH cte1 AS ( SELECT 1 UNION SELECT 2 ),
cte2 AS ( SELECT * FROM cte1 )
SELECT * FROM cte2;
```

## 递归 CTE：从初始行逐轮生成

递归CTE是具有引用其自己名称的子查询的表达式。它和非递归CTE的不同之处在于非递归CTE的结果集是某个select返回的结果，而递归CTE的结果集是在其自身第一行的基础上递归生成接下来的其他行直到满足某个条件为止：

```mysql
WITH RECURSIVE cte (n) AS
(
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM cte WHERE n < 5
)
SELECT * FROM cte;
```

执行以上sql将会返回一个自增的列

```mysql
1
2
3
4
5
```

递归CTE子查询有两个部分，由UNION [ALL] 或 UNION DISTINCT组成：

```mysql
SELECT ...      -- 初始行
UNION ALL
SELECT ...      -- 其它行
```

* 第一个select生成CTE中的初始行，该select只会执行一次。
* 第二个select通过引用其from子句中的CTE名称来生成其他行和递归。当此部分不产生新行时，递归结束。因此，递归CTE由非递归 SELECT部分和递归SELECT部分组成。
* 递归部分的每次迭代仅对前一次递归产生的行进行操作，每次递归前都会先判断满足条件才会递归。

例如上面递归中的`SELECT n + 1 FROM cte WHERE n < 5`，第一次递归是根据初始行1进行自增，然后每次获取上一次递归的值进行递增直到n不超过5。

## 生成最近 24 个完整月份

统计最近几个月的数据时，业务表可能没有覆盖每个月。可以先生成完整月份序列，再用 `LEFT JOIN` 关联按月聚合的业务数据。这里先解决月份序列：以 **2026-10-03** 为固定参考日期，排除尚未结束的 10 月，生成此前 24 个完整月份。固定输入让读者在不同日期运行也能比较同一结果。

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

预期得到 2024 年 10 月至 2026 年 9 月，共 24 行：

```
202410
202411
202412
202501
202502
202503
202504
202505
202506
202507
202508
202509
202510
202511
202512
202601
202602
202603
202604
202605
202606
202607
202608
202609
```

初始查询把日期统一到月初，并显式转换为 `DATE`，递归部分每次减一个月。`n < 24` 保证初始行加上后续 23 行后终止，`UNION ALL` 保留每一轮结果；最终排序由外层 `ORDER BY` 保证，不能把递归产生顺序当作通用排序承诺。需要按当天查询时，把参考日期改成 `CURRENT_DATE()` 即可，输出范围也会随日期变化。

## 递归边界与执行计划

递归列的类型由非递归部分推导，字符串逐轮增长时尤其需要给初始值足够的宽度。递归还受 `cte_max_recursion_depth` 限制；终止条件与服务器限制各有作用，不能只靠调大深度让可能无限递归的查询继续执行。

利用CTE可以将复杂查询按中间步骤组织，并在同一语句中多次引用。优化器可能合并或物化CTE，表达式复用不等于结果必定只计算一次，也不保证性能更高。

## 资料来源
- [MySQL 9.7 CTE 语法、递归类型与限制](https://dev.mysql.com/doc/refman/9.7/en/with.html)
- [MySQL LTS 与 Innovation 发布模型](https://dev.mysql.com/doc/refman/9.7/en/mysql-releases.html)
