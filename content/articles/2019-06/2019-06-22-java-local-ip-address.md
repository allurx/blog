---
title: 获取本机ip地址
date: 2019-06-22
updated: 2026-10-01
id: 2019-06-22-java-local-ip-address
tags:
  - Java
  - InetAddress
domain: Java
---

## 核心结论

`InetAddress.getLocalHost()` 根据本机主机名解析地址，不能保证返回业务所需的内网地址。枚举 `NetworkInterface` 可以得到各接口绑定的地址，但多网卡、多地址场景仍需按目标网络和路由选择，不能把“第一个非回环地址”当成通用答案。

## 问题与适用范围

本文回答如何发现本机地址，以及为什么主机名解析与网卡枚举会给出不同结果。正文保留原来的 Windows、Linux 配置观察；这些是特定环境的实验结果，不能推导出所有系统都只依赖某个 hosts 文件。接口列表也不能单独确定访问某个远端时实际使用的源地址。

<!-- more -->

## InetAddress

常见调用 `InetAddress.getLocalHost().getHostAddress()` 先取得本机主机名，再由名称服务解析地址。解析路径受操作系统、名称服务与缓存配置影响，hosts 文件可能参与其中，也可能使用 DNS 等机制。原文 Linux 实验把 hostname 映射到 127.0.0.1 后返回了回环地址，这说明该调用不能保证得到业务所需的内网地址；它不是对所有 Windows 或 Linux 环境的统一结论。

## NetworkInterface

通过网上查阅资料，最终可以确定通过获取机器上的所有网络设备，根据其中的网卡接口绑定的ip地址来确定本机的ip地址，具体实现代码如下

```java
import lombok.extern.slf4j.Slf4j;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.Enumeration;

/**
 * @author allurx
 */
@Slf4j
public class Ip {

    /**
     * 首先遍历本机上所有可用的网络设备接口,获取第一个可用的网络地址.
     * 如果没有可用的地址则尝试调用{@link InetAddress#getLocalHost}
     * 方法来获取本机地址.
     *
     * @return 本机上第一个可用的网络地址
     */
    private static InetAddress getLocalIpAddress() {
        InetAddress inetAddress = null;
        try {
            // 获取本机上的所有网络设备接口
            Enumeration<NetworkInterface> netInterfaces = NetworkInterface.getNetworkInterfaces();
            while (netInterfaces.hasMoreElements()) {
                NetworkInterface networkInterface = netInterfaces.nextElement();
                // 过滤一些不正确的网络设备接口
                if (!isValidNetworkInterface(networkInterface)) {
                    continue;
                }
                // 绑定到该网络接口的所有网络地址
                Enumeration<InetAddress> addresses = networkInterface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    inetAddress = addresses.nextElement();
                    if (isValidAddress(inetAddress)) {
                        return inetAddress;
                    }
                }
            }
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
        // 本机网络接口没有可用的网络地址
        try {
            inetAddress = InetAddress.getLocalHost();
        } catch (UnknownHostException e) {
            log.error(e.getMessage(), e);
        }
        return inetAddress;
    }

    /**
     * @param networkInterface 本机网络设备接口
     * @return 网络设备接口是否有效
     * @throws SocketException SocketException
     */
    private static boolean isValidNetworkInterface(NetworkInterface networkInterface) throws SocketException {
        return  // 不是环回接口
                !networkInterface.isLoopback() &&
                        // 已启动并且正在运行
                        networkInterface.isUp() &&
                        // 不是虚拟接口
                        !networkInterface.isVirtual();
    }

    /**
     * @param address 网络地址
     * @return 网络地址是否有效
     */
    private static boolean isValidAddress(InetAddress address) {
        return
                // 不是环回地址
                !address.isLoopbackAddress() &&
                        // 不是通配符地址
                        !address.isAnyLocalAddress();
    }

    public static void main(String[] args) throws Exception {
        System.out.println(getLocalIpAddress().getHostAddress());
    }
}

```

通过以上方法就能获取到本机ip地址了，执行以上代码，控制台输出了192.168.100.116，和我本机的内网ip一致，接下来我们测试一下一个网卡多个ip的情况。

### 一个网卡多个ip地址

#### 本机ip配置

由于我本机没有物理网卡，使用的是一个无线usb连接的家里的无线网，所以我本机的网卡就是下图中的无线局域网适配器，接下来我们给网卡添加一个额外的ip地址，首先看一下本机的ip配置信息，命令行输入`ipconfig/all`，

![](/images/Java/IpAddress/IpAddress1.png)

#### 配置多个ip

打开网络和共享中心-更改适配器设置，找到对应的网络连接，右击属性

![](/images/Java/IpAddress/IpAddress2.png)

选中Internet协议版本4（TCP/IPv4），点击属性按钮

![](/images/Java/IpAddress/IpAddress3.png)

点击高级按钮，添加一个新ip为192.168.100.117

![](/images/Java/IpAddress/IpAddress4.png)

查看ip是否添加成功，命令行输入`ipconfig/all`

![](/images/Java/IpAddress/IpAddress5.png)

新的ip添加成功，运行获取ip地址代码，发现控制台输出了两个ip，包含了刚刚添加的192.168.100.117

### 多个网卡多个ip地址

公司现在恰好就有一台机器配置了2个网卡，把上面的代码编译一下在这台双网卡的机器上跑一下，对比ip配置，和预期的结果是一致的。

## 总结

1. linux系统上如果在/etc/hosts文件中配置了hostname和ip的映射关系，`InetAddress.getLocalHost().getHostAddress()`的方法返回值就是对应的ip值
2. 实际生活中，机器的网络配置情况是很复杂的，很有可能肯存在一个网卡配置了多个ip、多个网卡配置了多个ip等情况，此时通过遍历筛选本机的网络接口来获取本机的ip地址才是比较正确的做法

通过以上的实践，其实还有一些问题没有解决

1. windows下是如何根据hostname获取对应的ip地址的，我尝试修改了C:\Windows\System32\drivers\etc\hosts文件，发现即便我将计算机名称映射到另一个内网ip上，最终返回的还是本机的实际内网ip地址，这和linux上的表现不一致
2. 一个网卡多个ip地址，多个网卡多个ip地址的情况下，如何确定本次网络访问使用的本机ip地址是哪一个？这依赖于本次网络访问的目的地址和本机的路由策略，如何获取到本机ip地址还没有找到好的解决方法

## 资料来源

- [InetAddress：主机名与地址解析](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/InetAddress.html)
- [NetworkInterface：接口与绑定地址](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/NetworkInterface.html)
