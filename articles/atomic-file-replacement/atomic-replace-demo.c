#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>

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

/* 读取并核对演示中写入的四字节内容，不处理任意用户文件。 */
static int expect_contents(int fd, const char *name, const char *expected) {
    char buffer[5] = {0};
    size_t used = 0;
    while (used < 4) {
        ssize_t count = read(fd, buffer + used, 4 - used);
        if (count < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (count == 0) {
            errno = EIO;
            return -1;
        }
        used += (size_t) count;
    }
    if (memcmp(buffer, expected, 4) != 0) {
        errno = EIO;
        return -1;
    }
    printf("%s=%s", name, buffer);
    return 0;
}

int main(void) {
    char directory[] = "./atomic-replace-XXXXXX";
    int dir_fd = -1;
    int old_fd = -1;
    int current_fd = -1;
    int result = EXIT_FAILURE;

    /* 独占创建实验目录，后面的路径都位于这个新目录内。 */
    if (mkdtemp(directory) == NULL) {
        perror("mkdtemp");
        return EXIT_FAILURE;
    }
    printf("directory=%s\n", directory);
    dir_fd = open(directory, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir_fd < 0) goto cleanup;

    if (replace_file(dir_fd, "new.tmp", "target.txt", "old\n", 4) < 0) goto cleanup;
    old_fd = openat(dir_fd, "target.txt", O_RDONLY | O_CLOEXEC);
    if (old_fd < 0) goto cleanup;

    /* 名称替换期间保持旧描述符打开，观察它仍指向旧 inode。 */
    if (replace_file(dir_fd, "new.tmp", "target.txt", "new\n", 4) < 0) goto cleanup;
    current_fd = openat(dir_fd, "target.txt", O_RDONLY | O_CLOEXEC);
    if (current_fd < 0) goto cleanup;
    if (expect_contents(old_fd, "old-descriptor", "old\n") < 0) goto cleanup;
    if (expect_contents(current_fd, "new-descriptor", "new\n") < 0) goto cleanup;
    result = EXIT_SUCCESS;

cleanup:
    if (result != EXIT_SUCCESS) perror("atomic replacement demo");
    if (current_fd >= 0 && close(current_fd) < 0) {
        perror("close current descriptor");
        result = EXIT_FAILURE;
    }
    if (old_fd >= 0 && close(old_fd) < 0) {
        perror("close old descriptor");
        result = EXIT_FAILURE;
    }
    if (dir_fd >= 0 && close(dir_fd) < 0) {
        perror("close directory descriptor");
        result = EXIT_FAILURE;
    }
    /* 保留本次新建的目录与目标文件，便于检查结果。 */
    return result;
}
