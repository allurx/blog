---
title: "获取本机 IP 地址"
date: 2019-06-22
updated: 2026-10-03
tags:
  - Java
  - InetAddress
domain: Java
---

应用要把一个“本机 IP”写进日志，调用 `InetAddress.getLocalHost()` 得到的却是回环地址；换成枚举网卡，又出现了 Wi-Fi、VPN 和多个 IPv6 地址。哪个才是正确答案？先要看这条日志想表达什么：主机名解析到了哪里，机器绑定了哪些地址，还是某次连接实际用了哪个源地址。

一台机器可以同时拥有多个有效地址。与其写一个返回“第一个非回环地址”的通用方法，不如让 API 对应具体用途。

本文以 Java SE 25 API 为准，比较主机名解析、接口枚举和已建立连接的本地端点。枚举示例只依赖标准库，运行基线为 Windows、Oracle JDK 25.0.2（25.0.2+10-LTS-69），不需要修改网络配置。

## getLocalHost 返回主机名的解析结果

InetAddress.getLocalHost 获取本机主机名，再通过名称服务解析地址。hosts 文件可能参与解析，也可能使用 DNS、缓存和系统配置。返回回环地址不表示没有其他网卡；返回某个内网地址也不证明它是访问任意远端时使用的源地址。

例如日志要记录主机名对应的地址，`getLocalHost()` 就与这个需求一致。如果日志要诊断“这次连接走了哪张网卡”，主机名解析还没有涉及目标地址和路由选择，回答的便不是同一个问题。

## 枚举候选地址时保留接口关系

同一接口可能有多个 IPv4 或 IPv6 地址，机器也可能有物理、VPN、容器等多个接口。下面列出已启用、非回环接口中的非回环、非通配地址，并同时打印接口名；不把虚拟接口一律当作无效接口。

保存为 Ip.java，执行 `javac -encoding UTF-8 -d out Ip.java`、`java -cp out io.allurx.Ip`：

```java
package io.allurx;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Enumeration;

/**
 * @author allurx
 */
public class Ip {

    public static void main(String[] args) throws SocketException {
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        if (interfaces == null) {
            return;
        }

        while (interfaces.hasMoreElements()) {
            NetworkInterface network = interfaces.nextElement();
            if (!network.isUp() || network.isLoopback()) {
                continue;
            }
            Enumeration<InetAddress> addresses = network.getInetAddresses();
            while (addresses.hasMoreElements()) {
                InetAddress address = addresses.nextElement();
                if (!address.isLoopbackAddress() && !address.isAnyLocalAddress()) {
                    System.out.println(network.getName() + " " + address.getHostAddress());
                }
            }
        }
    }
}
```

每行同时保留接口名和一个地址，所以同一接口有多个绑定地址时，也会出现多行。实际地址和顺序由机器配置决定；如果代码找到第一项就 return，其他接口和地址会被遗漏。

程序让 SocketException 向调用方传播。枚举失败与没有候选地址需要分开处理，不能在异常后悄悄改用主机名解析，让同一个方法有时返回网卡地址、有时返回另一种含义的值。

链路本地 IPv6 地址还依赖作用域标识，输出中的接口关系不能随意去掉。枚举只得到当前绑定的候选地址，不会自动查询 NAT 后的公网地址。

## 从候选地址到实际连接的本地端点

| 需求 | 入口 | 不能据此推出 |
| --- | --- | --- |
| 主机名解析到的地址 | InetAddress.getLocalHost | 全部绑定地址或任意目的地的出口地址 |
| 当前接口绑定地址 | NetworkInterface 枚举 | 路由一定选择其中哪一个 |
| 已建立连接的本地端点 | 对应 Socket/Channel 的本地地址 | 其他目的地也使用同一个地址 |

已经连接的 Socket 可通过 getLocalAddress/getLocalSocketAddress 观察实际本地端点；这是那条连接的结果。多网卡时还要考虑目标地址、路由、接口状态及应用是否显式绑定，不能由一个全局“获取本机 IP”方法替所有场景作决定。

## 资料来源

- [InetAddress：本机主机名与地址解析](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/InetAddress.html)
- [NetworkInterface：接口和绑定地址](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/NetworkInterface.html)
- [Socket：连接的本地地址](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html)
