---
title: MySql的CTE表达式
date: 2019-08-13
categories:
- MySql
tags:
- MySql
- CTE表达式
- With语法
---

# 概述

mysql8.0之后新增了with语法，也被称作为公用表表达式（CTE），它是一个临时命名的结果集，仅在单个语句的执行范围内存在，并且在后续的sql中可以重复使用这个结果集。同时CTE分为递归CTE和非递归CTE。CTE的出现简化了复杂查询语句的编写，提高了sql性能。

<!-- more -->

# CTE语法

CTE的结构包括名称、可选列和定义CTE的查询这三部分组成。使用with关键字连接一个或多个逗号分隔的查询语句组成了CTE。下面是一个CTE的例子：

```mysql
WITH cte1 AS ( SELECT 1 ),
cte2 AS ( SELECT 2 ) 
SELECT * FROM cte1 
UNION
SELECT * FROM cte2
```

上面的例子中定义了两个CTE，可以通过这两个CTE的名称来访问他们。当然了我们也可以给CTE的列起一个名称

```mysql
WITH cte ( n ) AS ( SELECT 1 UNION SELECT 2 ) 
SELECT n FROM cte
```

同时我们也可以在其它CTE中引用另一个CTE

```mysql
WITH cte1 AS ( SELECT 1 UNION SELECT 2 ),
cte2 AS ( SELECT * FROM cte1 ) 
SELECT * FROM cte2
```

# 递归CTE

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

# CTE例子

通常我们会有这样一个需求，统计前xx个月的数据。但是很有可能表中的数据并没有覆盖到每个月，此时我们就需要生成一个临时的月份表通过left join来关联业务表进行统计。下面是一个生成前24个月月份的例子：

```mysql
WITH RECURSIVE months24 ( n, MONTH ) AS (
	SELECT
		1,
		date_format( date_add( now(), INTERVAL - 1 MONTH ), '%Y%m' ) UNION
	SELECT
		n + 1,
		date_format( date_add( now(), INTERVAL - 1-n MONTH ), '%Y%m' ) 
	FROM
		months24 
	WHERE
		n < 24 
	) 
	SELECT MONTH FROM months24 ORDER BY MONTH
```

执行结果：

```
201708
201709
201710
201711
201712
201801
201802
201803
201804
201805
201806
201807
201808
201809
201810
201811
201812
201901
201902
201903
201904
201905
201906
201907
```

# 总结

利用CTE我们可以将复杂查询语句进行简化，同时能够重复利用CTE的结果集，提高了sql的性能。

# 参考

[WITH Syntax (Common Table Expressions)](https://dev.mysql.com/doc/refman/8.0/en/with.html#common-table-expressions-syntax)

