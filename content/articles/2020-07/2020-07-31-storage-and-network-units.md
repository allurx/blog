---
title: 数据单位
date: 2020-07-31
id: 2020-07-31-storage-and-network-units
tags:
  - 计算机基础
domain: 计算机基础
---

## 核心结论

bit 与 byte 差 8 倍，十进制前缀与二进制前缀则采用不同的倍数：1 kB = 1000 B，1 KiB = 1024 B。1 Mbps 表示每秒 100 万 bit，换算为 125 kB/s，约 122.07 KiB/s；实际下载还受协议开销和链路状态影响。

## 问题与适用范围

本文回答存储容量与网络速率为何常出现不同数值。区分大小写的 b/B，也区分 k/M/G 与 Ki/Mi/Gi。下面的计算采用明确的单位定义；界面只写 KB、MB 时，应再核对软件采用哪一种计量方式，不能只凭标签推断。

<!-- more -->

## 数据单位

b：比特位
B：字节
1B = 8b
比特位只有两种形式0和1，只能表示2种状态，而1个字节是由8个位组成的。可以表示256个状态。

## 数学单位

k = 1000（SI 中 kilo 的符号是小写 k）
Ki = 1024
M = 1000 * 1000
Mi = 1024 * 1024
G = 1000 * 1000 * 1000
Gi = 1024 * 1024 * 1024
...以此类推

运营商们所说的1M带宽全称是1Mbps(megabits per second，兆比特每秒)。bps是bit per Second的缩写，也就是每秒能够传输多少“位”(bit)的意思。
按十进制字节速率换算：1 Mbps = 1000000 bit/s ÷ 8 = 125000 B/s = 125 kB/s；按二进制前缀换算约为 122.07 KiB/s。实际下载速率还会扣除协议开销，不能保证达到这一理论值。

参考win10系统自带计算器中的数据转换

![](/images/Computer/data.png)

## 资料来源

- [NIST：二进制前缀与十进制前缀的区别](https://physics.nist.gov/cuu/Units/binary.html)
- [NIST：SI 前缀](https://www.nist.gov/pml/owm/metric-si-prefixes)
