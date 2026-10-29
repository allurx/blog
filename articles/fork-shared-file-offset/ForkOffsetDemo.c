#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void fail(const char *operation) {
    perror(operation);
    exit(EXIT_FAILURE);
}

static void write_all(int fd, const char *data, size_t length) {
    size_t written = 0;
    while (written < length) {
        const ssize_t result = write(fd, data + written, length - written);
        if (result < 0) {
            if (errno == EINTR) {
                continue;
            }
            fail("write");
        }
        written += (size_t) result;
    }
}

static ssize_t read_retry(int fd, void *buffer, size_t length) {
    ssize_t result;
    do {
        result = read(fd, buffer, length);
    } while (result < 0 && errno == EINTR);
    return result;
}

static off_t current_offset(int fd) {
    const off_t offset = lseek(fd, 0, SEEK_CUR);
    if (offset < 0) {
        fail("lseek");
    }
    return offset;
}

int main(void) {
    char path[] = "/tmp/fork-offset-XXXXXX";
    const int fd = mkstemp(path);
    if (fd < 0) {
        fail("mkstemp");
    }
    write_all(fd, "ABCDEFGHIJ", 10);
    if (lseek(fd, 0, SEEK_SET) < 0) {
        fail("lseek");
    }

    int ready[2];
    if (pipe(ready) < 0) {
        fail("pipe");
    }

    const pid_t child = fork();
    if (child < 0) {
        fail("fork");
    }

    if (child == 0) {
        if (close(ready[0]) < 0) {
            fail("close");
        }

        char buffer[4];
        const ssize_t length = read_retry(fd, buffer, sizeof(buffer));
        if (length < 0) {
            fail("read");
        }
        if (dprintf(STDOUT_FILENO, "child read: %.*s\n", (int) length, buffer) < 0 ||
            dprintf(STDOUT_FILENO, "child offset: %lld\n", (long long) current_offset(fd)) < 0) {
            fail("dprintf");
        }

        write_all(ready[1], "x", 1);
        if (close(ready[1]) < 0 || close(fd) < 0) {
            fail("close");
        }
        _exit(EXIT_SUCCESS);
    }

    if (close(ready[1]) < 0) {
        fail("close");
    }
    char signal;
    if (read_retry(ready[0], &signal, 1) != 1) {
        fail("read pipe");
    }
    if (close(ready[0]) < 0) {
        fail("close");
    }

    char buffer[4];
    const ssize_t length = read_retry(fd, buffer, 3);
    if (length < 0) {
        fail("read");
    }
    printf("parent read: %.*s\n", (int) length, buffer);
    printf("parent offset: %lld\n", (long long) current_offset(fd));

    const ssize_t positioned = pread(fd, buffer, 2, 0);
    if (positioned < 0) {
        fail("pread");
    }
    printf("pread at 0: %.*s\n", (int) positioned, buffer);
    printf("offset after pread: %lld\n", (long long) current_offset(fd));

    const int duplicate = dup(fd);
    if (duplicate < 0) {
        fail("dup");
    }
    if (lseek(duplicate, 1, SEEK_SET) < 0) {
        fail("lseek");
    }
    printf("offset after lseek(dup): %lld\n", (long long) current_offset(fd));

    const int separate = open(path, O_RDONLY);
    if (separate < 0) {
        fail("open");
    }
    if (read_retry(separate, buffer, 1) != 1) {
        fail("read separate");
    }
    printf("separate open read: %c\n", buffer[0]);
    if (read_retry(fd, buffer, 1) != 1) {
        fail("read shared");
    }
    printf("shared description read: %c\n", buffer[0]);

    int status;
    if (waitpid(child, &status, 0) < 0) {
        fail("waitpid");
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != EXIT_SUCCESS) {
        fputs("child failed\n", stderr);
        return EXIT_FAILURE;
    }

    if (close(separate) < 0 || close(duplicate) < 0 || close(fd) < 0) {
        fail("close");
    }
    if (unlink(path) < 0) {
        fail("unlink");
    }
    return EXIT_SUCCESS;
}
