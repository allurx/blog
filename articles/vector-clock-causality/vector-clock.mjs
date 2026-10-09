/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

const PROCESS_COUNT = 3;

function clock() {
    return Array(PROCESS_COUNT).fill(0);
}

function tick(current, process) {
    const next = [...current];
    next[process] += 1;
    return next;
}

function receive(current, process, message) {
    const merged = current.map((value, index) => Math.max(value, message[index]));
    return tick(merged, process);
}

function compare(left, right) {
    const leftLeRight = left.every((value, index) => value <= right[index]);
    const rightLeLeft = right.every((value, index) => value <= left[index]);

    if (leftLeRight && rightLeLeft) return "equal";
    if (leftLeRight) return "before";
    if (rightLeLeft) return "after";
    return "concurrent";
}

let a = clock();
let b = clock();
let c = clock();

const a1 = (a = tick(a, 0));
const a2 = (a = tick(a, 0));
const b1 = (b = tick(b, 1));
const b2 = (b = receive(b, 1, a2));
const c1 = (c = tick(c, 2));
const b3 = (b = tick(b, 1));
const c2 = (c = receive(c, 2, b3));

console.log(`a1 -> c2: ${compare(a1, c2)}`);
console.log(`a2 vs b1: ${compare(a2, b1)}`);
console.log(`b1 -> b2: ${compare(b1, b2)}`);
console.log(`c1 -> c2: ${compare(c1, c2)}`);
