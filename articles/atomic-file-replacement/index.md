---
title: "Linux 原子替换为什么不等于掉电持久"
date: "2026-09-13"
updated: 2026-10-03
domain: "Linux"
tags: ["Linux", "文件系统", "持久性"]
---

更新配置文件时，直接覆盖可能让并发读者看到半份内容。先写临时文件再 `rename()`，可以把这个过程收敛为一次文件名切换；但机器紧接着掉电时，新版本能否恢复，还取决于文件内容和目录项是否完成同步。

本文只讨论 Linux 本地文件系统、同一目录内普通文件的替换，并按 `rename(2)` 与 `fsync(2)` 的接口契约说明顺序。NFS、其他远程文件系统或特殊存储设备需要单独核对；原子可见性与崩溃持久性不能从一个成功返回值中同时推断。

## 原子切换保护读者看到的内容

原子性回答“观察者能否看到中间状态”，持久性回答“已完成的状态能否在崩溃后恢复”。两者不是同一承诺。

当 `newpath` 已存在时，Linux `rename()` 会原子替换它，所以并发打开 `target` 的进程不会遇到名称空档。已经打开旧文件的描述符仍指向旧 inode；之后按路径打开的读者看到新文件。这是名称映射切换，不表示脏数据已经越过页缓存、设备缓存并稳定落盘。[`rename(2)` 语义](https://man7.org/linux/man-pages/man2/rename.2.html)

`fsync(fileFd)` 刷新该文件的数据与相关 inode 元数据，但手册明确说明：这不一定把“目录中存在这个名字”的变更同步到磁盘；目录项还需要对目录文件描述符执行 `fsync()`。[`fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)

这一结论要求临时文件已经完整写好，并且改名后不再继续原地修改它。已经打开旧目标的读者可以继续读旧 inode；之后重新按名称打开的读者会得到新文件。`rename()` 没有让所有既存文件描述符切换到新内容。

## 数据与目录项需要按顺序同步

在本文同一目录的前提下，顺序如下：

1. 为使用本文的单目录同步顺序，临时文件就在目标目录中创建。`rename()` 的文件系统边界是同一挂载文件系统；跨挂载移动会因 `EXDEV` 失败，同一文件系统内的不同目录则需要额外考虑目录同步。
2. 先写完并 `fsync` 临时文件，保证被新名字指向的数据已同步。
3. `rename` 原子切换目录项，使运行中的读者不会读到半成品。
4. 再 `fsync` 目标目录，使名称替换本身持久化。

ext4 默认日志主要保护文件系统元数据的一致性，并不等价于应用数据已经按期望持久化；不能因为“启用了 journal”就删除应用层同步步骤。[Linux kernel ext4 journal 文档](https://docs.kernel.org/filesystems/ext4/journal.html)

如果临时文件与目标分处不同目录，持久化需求还涉及源目录项的移除，不能只照搬本文单目录代码。跨挂载文件系统的移动则通常不具备同一个 `rename()` 操作的语义。

`fflush()` 只把 C 标准库缓冲交给内核，不能替代 `fsync()`；内核和设备也必须正确履行其刷盘承诺。文件系统日志保护的内容与应用要求的“新配置已经持久化”并不天然相同。

## 一个检查写入与同步结果的辅助函数

以下辅助函数使用 Linux 上的 C11/POSIX API，在已经打开的同一目录内替换普通文件。临时文件由 `O_EXCL` 独占创建；示例采用 `0600` 权限，没有复制目标文件原有元数据。

```c
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <unistd.h>

static int write_all(int fd, const char *data, size_t size) {
    while (size > 0) {
        ssize_t written = write(fd, data, size);
        if (written < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (written == 0) {
            errno = EIO;
            return -1;
        }
        data += written;
        size -= (size_t) written;
    }
    return 0;
}

int replace_file(int dir_fd,
                 const char *temp_name,
                 const char *target_name,
                 const char *data,
                 size_t size) {
    int fd = openat(dir_fd, temp_name,
                    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) return -1;

    int failed = write_all(fd, data, size) < 0 || fsync(fd) < 0;
    int saved = errno;
    if (close(fd) < 0 && !failed) {
        failed = 1;
        saved = errno;
    }
    if (failed) {
        unlinkat(dir_fd, temp_name, 0);
        errno = saved;
        return -1;
    }

    if (renameat(dir_fd, temp_name, dir_fd, target_name) < 0) {
        int saved = errno;
        unlinkat(dir_fd, temp_name, 0);
        errno = saved;
        return -1;
    }

    return fsync(dir_fd);
}
```

该片段是一个需要调用方提供目录描述符的辅助函数，不包含 `main()`。`dir_fd` 应由调用方打开为目标目录，`temp_name` 和 `target_name` 必须是不同的、经过验证的单个文件名，不接受绝对路径或路径分隔符；临时名称在创建前不能已被占用，目录也应由应用控制，避免其他参与者替换临时项。

编译可检查 API 和类型使用，普通替换测试可检查内容变化；两者都不能证明真实掉电后的恢复结果。部署时仍需针对实际文件系统、挂载参数和存储设备验证相应保证。

## 用两个文件描述符观察名称切换

[atomic-replace-demo.c](./atomic-replace-demo.c) 在上述函数之外补齐了调用入口。它用 `mkdtemp()` 在当前目录独占创建实验目录，先写入 `old` 并保持旧文件描述符打开，再把同一路径替换为 `new`，最后分别通过旧描述符和重新打开的描述符读取。程序只操作自己创建的目录，退出后保留 `target.txt` 供检查。[mkdtemp 的创建契约](https://man7.org/linux/man-pages/man3/mkdtemp.3.html)

示例目标为 Linux 6.18 LTS、本地支持目录 `fsync` 的文件系统和 GCC 16.2，使用 C11/POSIX.1-2008 API。Linux 长期维护线与 GCC 稳定版本分别见[内核发布说明](https://www.kernel.org/releases.html)和 [GCC 发布记录](https://gcc.gnu.org/releases.html)。下面给出运行方法与按接口契约推导的预期；该程序尚未经过目标 Linux 环境的编译和实跑：

```sh
gcc -std=c11 -Wall -Wextra -Wpedantic atomic-replace-demo.c -o atomic-replace-demo
./atomic-replace-demo
```

成功完成写入与同步时，程序应报告旧描述符读到 `old`，新描述符读到 `new`：

```text
directory=./atomic-replace-<随机后缀>
old-descriptor=old
new-descriptor=new
```

第一行的随机后缀由 `mkdtemp` 生成。这个观察只能说明正常运行中的名称与 inode 关系；程序没有模拟断电。内核、文件系统、挂载选项和存储设备的持久性保证仍须在实际部署环境核对。

## 失败结果必须说明替换是否已经发生

上面函数有两个不同阶段的失败：

- `renameat()` 之前失败时，新内容尚未替换目标，代码尝试清理临时文件，并保留原始错误。
- `renameat()` 成功、目录 `fsync()` 失败时，运行中的目标已经是新文件，但它的崩溃持久性未确认。函数返回失败并不意味着目标仍是旧版本，更不意味着可以放心重做一遍上游业务。

调用方需要区分这些结果时，应把阶段或已替换状态纳入自己的返回契约，随后核对目标内容；不要在同步失败后盲目把旧备份写回，覆盖其他进程后来完成的更新。清理临时文件失败也不应掩盖原始写入错误。

这里不实现多写入者的版本协调。若多个进程都能替换同一个目标，它们仍可能互相覆盖；原子替换保证名称切换完整，不保证哪一次业务更新应该获胜。

## 权限、成本与验证范围

替换后的 inode 来自临时文件，权限、所有者、ACL、扩展属性和 SELinux label 不会自动复制旧目标的设置。业务需要保留哪些元数据，应在改名之前处理并纳入同步顺序；本文的 `0600` 只是示例策略。

`fsync()` 会增加延迟。缓存文件与账本状态可以有不同持久性要求，但应明确成功语义后再决定是否批处理，而不是省去同步后继续承诺同样的故障恢复能力。

在真实环境验证时，分别检查正常替换、写入失败、改名失败和目录同步失败后的可观察状态。断电恢复需要专门试验或明确的存储保证，不能用一次正常读回替代。`rename(2)` 还指出 NFS 中存在服务端已执行但客户端收到失败的情况，更说明本地示例不能直接代表远程故障语义。[rename(2) 的 NFS 边界](https://man7.org/linux/man-pages/man2/rename.2.html)
