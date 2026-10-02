---
title: MySql时区对时间字段的影响
date: 2020-06-11
tags:
  - MySql
domain: MySQL
---

## 核心结论

TIMESTAMP 按会话时区解释输入，转换为 UTC 保存，再转换为读取会话的时区展示。DATETIME 保存日期时间字段本身，不进行同样的时区转换；但插入 NOW() 时，函数返回值已受会话时区影响，所以 DATETIME 的值也可能随写入会话的时区而不同。比较两种类型时，需要同时区分函数求值与列类型的存储语义。

## 问题与适用范围

本文回答：改变 MySQL 会话时区后，TIMESTAMP、DATETIME 和 NOW() 分别会发生什么变化？

本文按 MySQL 8.4 的服务端语义说明。以下例子使用不带显式时区偏移的日期时间字面量；驱动对 Java 时间类型的转换、连接参数和带偏移输入需要另行核对，不能从列类型独自推断。

<!-- more -->

## 三种时区设置

MySQL 维护系统时区 system_time_zone、全局 time_zone 和每个连接自己的会话 time_zone。新连接的会话值从全局值初始化；修改全局值并不等于修改所有已有连接的会话值。

```sql
SELECT @@GLOBAL.time_zone, @@SESSION.time_zone;
SET time_zone = '+08:00';
```

NOW() 和 CURTIME() 使用会话时区，UTC_TIMESTAMP() 返回 UTC 时间。使用命名时区，例如 Asia/Shanghai，需要先正确加载 MySQL 的时区表；固定偏移示例不依赖该表。[官方时区说明](https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html)。

## TIMESTAMP 与 DATETIME

对不带偏移的字面量：

- 写入 TIMESTAMP 时，MySQL 把输入理解为会话时区的时间并转换为 UTC；读取时反向转换。
- 写入 DATETIME 时，保存给定的年月日时分秒，不替它赋予某个时区，也不随读取会话转换。
- 写入 NOW() 时，先得到当前会话的当地时间，再按目标列的规则存储。不能把函数行为与 DATETIME 是否转换时区混为一谈。

原文把 TIMESTAMP 的计算基准写成“会话时区与服务器时区的差值”，容易混淆。存储转换的基准是 UTC；服务器系统时区只在相应配置下参与决定有效会话时区。

## 一个可以观察差异的例子

下面创建的是会话临时表，连接结束后移除：

```sql
SET time_zone = '+08:00';

CREATE TEMPORARY TABLE timezone_demo (
    stored_timestamp TIMESTAMP,
    stored_datetime DATETIME
);

INSERT INTO timezone_demo
VALUES ('2020-06-11 12:00:00', '2020-06-11 12:00:00');

SET time_zone = '+00:00';
SELECT stored_timestamp, stored_datetime FROM timezone_demo;
```

预期结果：

```text
stored_timestamp       stored_datetime
2020-06-11 04:00:00     2020-06-11 12:00:00
```

TIMESTAMP 表达同一个时刻在不同会话时区中的表示，DATETIME 则仍是原来的当地日期时间字段。为真实业务选择类型时，应先确定保存的是绝对时刻还是不带时区的当地时间，并保证应用、连接和数据库使用一致的解释规则。

## 资料来源

- [MySQL 8.4 时区支持](https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html)
- [DATE、DATETIME 与 TIMESTAMP 类型](https://dev.mysql.com/doc/refman/8.4/en/datetime.html)
