---
title: 获取本机ip地址
date: 2019-06-22
categories:
- Java
- InetAddress
tags:
- Java
- InetAddress
---

# 概述

很多时候，在开发的过程中我们需要获取本机的ip地址，网上有很多现成的代码可以copy过来，但是由于自己对网络这一块的知识理解的不透彻，导致了开发过程中出现的一些问题无法解决。

<!-- more -->

# InetAddress

通常情况下我们我们会通过一行`InetAddress.getLocalHost().getHostAddress()`代码获取本机的IP地址，在windows上这没有任何问题，会正常返回本机在局域网中的ip地址，因为这段代码本质上是根据计算机的hostname（计算机名称）来获取相应的ip地址的（目前不清楚windows下是如何通过计算机名称找到对应的ip地址的），但是在linux系统上的实现是通过读取/etc/hosts来实现的，即如果某个机器的hostname是a，在/etc/hosts下添加一条127.0.0.1  a记录，此时调用`InetAddress.getLocalHost().getHostAddress()`方法返回的ip地址就是127.0.0.1，而不是内网的具体ip地址。因此我们不能依赖这个方法来读取本机的ip地址

# NetworkInterface

通过网上查阅资料，最终可以确定通过获取机器上的所有网络设备，根据其中的网卡接口绑定的ip地址来确定本机的ip地址，具体实现代码如下

```java
import lombok.extern.slf4j.Slf4j;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.Enumeration;

/**
 * @author zyc
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

## 一个网卡多个ip地址

### 本机ip配置

由于我本机没有物理网卡，使用的是一个无线usb连接的家里的无线网，所以我本机的网卡就是下图中的无线局域网适配器，接下来我们给网卡添加一个额外的ip地址，首先看一下本机的ip配置信息，命令行输入`ipconfig/all`，

![](/images/Java/IpAddress/IpAddress1.png)

### 配置多个ip

打开网络和共享中心-更改适配器设置，找到对应的网络连接，右击属性

![](/images/Java/IpAddress/IpAddress2.png)

选中Internet协议版本4（TCP/IPv4），点击属性按钮

![](/images/Java/IpAddress/IpAddress3.png)

点击高级按钮，添加一个新ip为192.168.100.117

![](/images/Java/IpAddress/IpAddress4.png)

查看ip是否添加成功，命令行输入`ipconfig/all`

![](/images/Java/IpAddress/IpAddress5.png)

新的ip添加成功，运行获取ip地址代码，发现控制台输出了两个ip，包含了刚刚添加的192.168.100.117

## 多个网卡多个ip地址

公司现在恰好就有一台机器配置了2个网卡，把上面的代码编译一下在这台双网卡的机器上跑一下，对比ip配置，和预期的结果是一致的。

# 总结

1. linux系统上如果在/etc/hosts文件中配置了hostname和ip的映射关系，`InetAddress.getLocalHost().getHostAddress()`的方法返回值就是对应的ip值
2. 实际生活中，机器的网络配置情况是很复杂的，很有可能肯存在一个网卡配置了多个ip、多个网卡配置了多个ip等情况，此时通过遍历筛选本机的网络接口来获取本机的ip地址才是比较正确的做法

通过以上的实践，其实还有一些问题没有解决

1. windows下是如何根据hostname获取对应的ip地址的，我尝试修改了C:\Windows\System32\drivers\etc\hosts文件，发现即便我将计算机名称映射到另一个内网ip上，最终返回的还是本机的实际内网ip地址，这和linux上的表现不一致
2. 一个网卡多个ip地址，多个网卡多个ip地址的情况下，如何确定本次网络访问使用的本机ip地址是哪一个？这依赖于本次网络访问的目的地址和本机的路由策略，如何获取到本机ip地址还没有找到好的解决方法

