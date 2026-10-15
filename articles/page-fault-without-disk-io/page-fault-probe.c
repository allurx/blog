/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

enum { REGION_SIZE = 32 * 1024 * 1024 };

struct Faults {
    long minor;
    long major;
};

static void fail(const char *operation) {
    fprintf(stderr, "%s: %s\n", operation, strerror(errno));
    exit(EXIT_FAILURE);
}

static struct Faults faults(void) {
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) == -1) {
        fail("getrusage");
    }
    return (struct Faults){.minor = usage.ru_minflt, .major = usage.ru_majflt};
}

static void print_delta(const char *label, struct Faults before) {
    const struct Faults after = faults();
    printf("%-27s minor=%ld major=%ld\n", label, after.minor - before.minor,
           after.major - before.major);
}

static uint64_t read_pages(const unsigned char *region, size_t length, size_t page_size) {
    uint64_t sum = 0;
    for (size_t offset = 0; offset < length; offset += page_size) {
        sum += region[offset];
    }
    return sum;
}

static void write_pages(unsigned char *region, size_t length, size_t page_size) {
    for (size_t offset = 0; offset < length; offset += page_size) {
        region[offset]++;
    }
}

static void write_all(int file_descriptor, const unsigned char *buffer, size_t length) {
    size_t written = 0;
    while (written < length) {
        const ssize_t result = write(file_descriptor, buffer + written, length - written);
        if (result == -1) {
            fail("write");
        }
        written += (size_t)result;
    }
}

int main(void) {
    const long configured_page_size = sysconf(_SC_PAGESIZE);
    if (configured_page_size <= 0) {
        fail("sysconf");
    }
    const size_t page_size = (size_t)configured_page_size;

    unsigned char *anonymous = mmap(NULL, REGION_SIZE, PROT_READ | PROT_WRITE,
                                    MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (anonymous == MAP_FAILED) {
        fail("mmap anonymous");
    }

    volatile uint64_t checksum = 0;
    struct Faults before = faults();
    checksum += read_pages(anonymous, REGION_SIZE, page_size);
    print_delta("anonymous first read", before);

    before = faults();
    write_pages(anonymous, REGION_SIZE, page_size);
    print_delta("anonymous first write", before);

    char path[] = "/tmp/page-fault-probe-XXXXXX";
    const int file_descriptor = mkstemp(path);
    if (file_descriptor == -1) {
        fail("mkstemp");
    }
    if (unlink(path) == -1) {
        fail("unlink");
    }

    unsigned char *block = calloc(page_size, 1);
    if (block == NULL) {
        fail("calloc");
    }
    for (size_t offset = 0; offset < REGION_SIZE; offset += page_size) {
        write_all(file_descriptor, block, page_size);
    }
    free(block);

    unsigned char *file_mapping = mmap(NULL, REGION_SIZE, PROT_READ, MAP_PRIVATE, file_descriptor, 0);
    if (file_mapping == MAP_FAILED) {
        fail("mmap file");
    }

    before = faults();
    checksum += read_pages(file_mapping, REGION_SIZE, page_size);
    print_delta("warm file mapping read", before);

    fflush(stdout);
    const pid_t child = fork();
    if (child == -1) {
        fail("fork");
    }
    if (child == 0) {
        before = faults();
        write_pages(anonymous, REGION_SIZE, page_size);
        print_delta("fork child COW write", before);
        fflush(stdout);
        _exit(EXIT_SUCCESS);
    }

    int status;
    if (waitpid(child, &status, 0) == -1) {
        fail("waitpid");
    }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != EXIT_SUCCESS) {
        fputs("child process failed\n", stderr);
        return EXIT_FAILURE;
    }

    if (munmap(file_mapping, REGION_SIZE) == -1 || close(file_descriptor) == -1 ||
        munmap(anonymous, REGION_SIZE) == -1) {
        fail("cleanup");
    }

    return checksum == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
