---
title: "网络 I/O 模型"
date: 2020-08-10
updated: 2026-10-02
tags:
  - Java
  - 网络IO模型
domain: Java
---

网络读取可以从“等待数据就绪”和“完成读取”两个阶段理解。阻塞调用、非阻塞轮询、就绪通知和异步完成通知的区别，是谁等待、何时返回、谁执行后续操作。Java 的 `Socket`、`Selector` 和异步通道提供不同入口，选择时还要考虑连接数量、业务耗时和线程成本。

下面用五种经典模型比较调用与通知的时序，再对应到 Java 的 Socket、Selector 与异步通道。图示中的“等待数据”和“复制数据”是概念阶段；同步调用要等复制完成才返回，不等于线程在复制期间始终处于操作系统的睡眠状态。


## 阻塞IO

阻塞读取在没有数据时等待，取得数据并完成本次读取后才返回。调用线程在返回前不能继续执行调用后的代码，但其他线程仍可工作；不能把一个线程的等待描述成整个进程停止。

![](./images/blocking-io.png)

Java Socket 的输入流提供这种同步读取接口。没有可读数据时，调用可能等待数据、流结束、错误或配置的读取超时。一个连接对应一个读取任务，控制流容易理解；大量连接长期等待时，平台线程的数量与内存成本可能成为限制。使用虚拟线程会改变等待的线程成本，但不会增加下游资源容量。[Socket API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html) · [JEP 444](https://openjdk.org/jeps/444)

## 非阻塞IO

非阻塞读取在当前没有数据时立即返回，让调用方决定何时再试。在 Linux 中通常通过 O_NONBLOCK 配置套接字，读取暂时无法完成时返回 EAGAIN 或 EWOULDBLOCK；有数据时，本次调用仍同步完成实际读取。[Linux socket 接口](https://man7.org/linux/man-pages/man7/socket.7.html)

![](./images/non-blocking-io.png)

不断轮询所有连接可以避免等待在某一条连接上，却可能把 CPU 消耗在尚无进展的重试中。非阻塞接口并不要求忙等；它通常与后面的就绪通知机制配合，只在收到通知后尝试读写。

## 信号驱动IO

信号驱动 I/O 用信号通知就绪事件，应用收到信号后再读取。在 Linux 中，仅调用 sigaction 注册处理器还不够，还需要设置接收信号的所有者并启用 O_ASYNC。SIGIO 表示发生了相关事件，不表示应用缓冲区中已经有完整结果。[socket(7) 的信号机制](https://man7.org/linux/man-pages/man7/socket.7.html)

![](./images/signal-driven-io.png)

信号可能合并，收到信号时状态也可能已经变化。处理器需要遵守信号安全限制，并通过实际 I/O 结果确认发生了什么；不能把一次信号与一个完整报文对应起来，也不能据此把这种机制限定为 UDP 专用。

## IO多路复用

select、poll、epoll、kqueue 等接口让一个调用同时关注多条连接的就绪事件。等待调用可以阻塞、限时等待或立即返回；返回后，应用再对就绪连接执行非阻塞读写。这样一个事件循环可以交替推进多条连接，而不必为每条等待中的连接分配平台线程。

就绪通知不是成功读取的凭证。流结束也可能表现为可读，状态还可能在通知与读取之间改变；Linux select 文档也明确记录了虚假就绪的情况。因此读取仍要处理无数据、部分结果、结束与错误，不能保证每次通知都得到有效业务数据。[select(2) 的就绪语义与边界](https://man7.org/linux/man-pages/man2/select.2.html)

![](./images/io-multiplexing.png)

Java 的 Selector、SelectableChannel 与 ByteBuffer 可以表达这种 Reactor 结构：事件循环检测就绪并推进 I/O，耗时业务交给受控的执行器。事件循环中执行慢任务仍会拖延其他连接，业务队列也需要容量限制；多路复用解决的是如何等待多条连接，并不自动解决过载。[Selector 的选择操作](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/Selector.html)

## 异步IO

前面的模型最终都由应用发起一次同步读取，只是等待数据就绪的方式不同；其中也包含非阻塞调用，不能统称为阻塞 I/O。异步读取则在提交操作时提供目标缓冲区，随后通过完成通知取得结果，提交者不必等待本次读取完成。

![](./images/asynchronous-io.png)

AsynchronousSocketChannel.read 可以返回 Future，也可以接收 CompletionHandler。完成处理器由异步通道组的执行机制调用；Java API 不保证底层在所有平台都直接映射到同一种内核异步接口。操作完成前不能随意复用其缓冲区，同一通道也不允许同时挂起多个读操作。[AsynchronousSocketChannel 的操作契约](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/AsynchronousSocketChannel.html)

## 例子

可以用同一个 TCP 请求协议比较阻塞读取、就绪通知与异步完成三种编程接口，观察等待发生在哪里，以及任务如何交给业务处理代码。下面的工程提供相应实现供阅读：

[基于BIO、NIO、AIO模型实现的简单TCP服务器](https://github.com/allurx/socket)

比较性能时，需要同时固定请求协议、连接行为、业务工作量与资源上限，并记录超时、错误和拒绝数量。不同线程池与队列配置本身就会改变结果；单次吞吐量差异不能直接归因于 BIO、NIO 或 AIO 的名称。

## 资料来源

- [Socket：流式套接字 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html)
- [Selector：就绪事件选择](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/Selector.html)
- [AsynchronousSocketChannel：异步操作](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/AsynchronousSocketChannel.html)
- [JEP 444：虚拟线程的设计边界](https://openjdk.org/jeps/444)
