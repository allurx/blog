---
title: MySql时区对时间字段的影响
date: 2020-06-11
categories:
- MySql
tags:
- MySql
---

# 概念

MySQL Server维护几个时区变量

1. 系统时区

   mysql在启动时会获取目标机器上的时区值作为全局变量system_time_zone的值，此后该值不变。如果是通过mysqld_safe命令来启动的可以通过--timezone在启动时设置该值

2. mysql当前运行时区

   全局变量time_zone代表了mysql服务器的当前正在运行的时区，time_zone的初始值为'SYSTEM'，代表当前时区值为system_time_zone，可以在启动mysql时通过--default-time-zone设置该值，或者在mysql配置文件中配置default-time-zone='timezone'

3. 会话时区

   每个客户端连接都能设置自己的时区，可以通过会话参数time_zone设置（SET time_zone = timezone;）每个会话的初始时区值是从全局变量time_zone中获取的，即每次会话的默认时区值为全局变量time_zone值。
   注意会话时区的改变会影响NOW()或CURTIME()的返回值，同时对于那些类型为TIMESTAMP的字段，会将会话时区转换为utc时区存储到表中以及将utc时区转换到会话时区展示。不过对于date、time、datetime类型字段的查询没有任何影响。
   
   <!-- more -->

# 非timestramp字段

## 数据入库

### 将now函数值存入数据库

首先mysql会获取到当前机器的时间t（即mysql运行时区的t），然后计算mysql运行时区与会话时区之间的差值为d=|mysql运行时区-会话时区|，则最终的时间值有以下三种情况：

1. 如果mysql运行时区大于会话时区，则最终时间为t - d
2. 如果mysql运行时区小于会话时区，则最终时间为t + d
3. 如果mysql运行时区等于会话时区，则最终时间为t

### 将具体的时间参数存入数据库

不进行时区差计算直接存入数据库，即原封不动的存入数据库

# timestramp字段

## 数据入库

### 将now函数值存入数据库

1. 计算出mysql服务器当前时间在会话时区的时间
2. 将第一步计算出来的时间值加减mysql运行时区与会话时区之间的差值（以mysql运行时区为基准）

### 将具体的时间参数存入数据库

直接将具体的时间值加减mysql运行时区与会话时区之间的差值

# 参考

com.mysql.cj.protocol.a.NativeProtocol#configureTimezone
https://dev.mysql.com/doc/refman/8.0/en/time-zone-support.html

