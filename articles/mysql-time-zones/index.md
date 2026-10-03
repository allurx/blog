---
title: "MySQL 时区对时间字段的影响"
date: 2020-06-11
updated: 2026-10-03
tags:
  - MySql
domain: MySQL
---

同一条 SQL 写入两个 `12:00:00`，换一个连接读取，一个变成 `04:00:00`，另一个仍是 `12:00:00`。数据没有丢失：`TIMESTAMP` 会按读取连接的时区展示同一时刻，`DATETIME` 则保留写入的日期时间字段。真正需要查清的是，应用交给数据库的“12 点”属于哪个时区，又希望它表达什么。

这还留下一个容易混淆的问题：既然 `DATETIME` 不随时区转换，为什么不同连接执行 `INSERT ... NOW()` 会写出不同的时间？原因在写入之前：`NOW()` 先按会话时区求值，列类型再保存这个结果。把这两个步骤分开，就能解释看起来矛盾的现象。

本文按 **MySQL Community Server 9.7.2（9.7 LTS）** 的服务端语义说明。使用 MySQL 9.7 客户端，在同一个连接和有创建临时表权限的测试数据库中执行下面的 SQL。例子使用不带显式时区偏移的字面量；驱动对 Java 时间类型的转换、连接参数和带偏移输入需要另行核对，不能从列类型独自推断。预期值依据类型转换规则推导，不是驱动兼容性或性能实验。


## 三种时区设置

MySQL 维护系统时区 system_time_zone、全局 time_zone 和每个连接自己的会话 time_zone。新连接的会话值从全局值初始化；修改全局值并不等于修改所有已有连接的会话值。

```sql
SELECT @@GLOBAL.time_zone, @@SESSION.time_zone;
```

NOW() 和 CURTIME() 使用会话时区，UTC_TIMESTAMP() 返回 UTC 时间。使用命名时区，例如 Asia/Shanghai，需要先正确加载 MySQL 的时区表；固定偏移示例不依赖该表。[官方时区说明](https://dev.mysql.com/doc/refman/9.7/en/time-zone-support.html)。

## 顺着一次写入和读取理解两种类型

### 列类型决定如何保存和展示输入

对不带偏移的字面量：

- 写入 TIMESTAMP 时，MySQL 把输入理解为会话时区的时间并转换为 UTC；读取时反向转换。
- 写入 DATETIME 时，保存给定的年月日时分秒，不替它赋予某个时区，也不随读取会话转换。
- 写入 NOW() 时，先得到当前会话的当地时间，再按目标列的规则存储。不能把函数行为与 DATETIME 是否转换时区混为一谈。

TIMESTAMP 的存储转换以 UTC 为基准，不按会话时区与服务器时区的差值计算；服务器系统时区只在相应配置下参与决定有效会话时区。

### 换成 UTC 读取同一行

下面创建的是会话临时表。先保存连接原有时区，再分别观察写入和读取；最后恢复会话设置并删除本次临时表。`VERSION()` 返回的是实际服务器版本，应先与文章基线比较：

```sql
SELECT VERSION(), @@SESSION.time_zone;
SET @original_time_zone = @@SESSION.time_zone;
SET time_zone = '+08:00';

CREATE TEMPORARY TABLE timezone_demo (
    stored_timestamp TIMESTAMP,
    stored_datetime DATETIME
);

INSERT INTO timezone_demo
VALUES ('2020-06-11 12:00:00', '2020-06-11 12:00:00');

SET time_zone = '+00:00';
SELECT stored_timestamp, stored_datetime FROM timezone_demo;

SET time_zone = @original_time_zone;
DROP TEMPORARY TABLE timezone_demo;
```

预期结果：

```text
stored_timestamp       stored_datetime
2020-06-11 04:00:00     2020-06-11 12:00:00
```

`+08:00` 的中午与 UTC 的凌晨 4 点是同一个时刻，所以 `stored_timestamp` 改变了显示值；`stored_datetime` 没有携带这层时区含义，仍返回原来的字段。

## 先确定业务要保存哪一种时间

订单创建时间需要在不同时区中指向同一时刻；门店“每天 9 点开门”则是一条当地时间规则，单独保存某天的 UTC 时间不能表达完整规则。类型选择要从这类需求出发，再统一应用、连接和数据库的解释方式。

排查时间差时，先读取实际连接的 `@@SESSION.time_zone`，再检查传入的是字面量、`NOW()` 结果还是驱动转换后的参数。只检查服务器所在时区，或者只看列名，都不足以还原写入过程。

## 资料来源

- [MySQL 9.7 时区支持](https://dev.mysql.com/doc/refman/9.7/en/time-zone-support.html)
- [DATE、DATETIME 与 TIMESTAMP 类型](https://dev.mysql.com/doc/refman/9.7/en/datetime.html)
