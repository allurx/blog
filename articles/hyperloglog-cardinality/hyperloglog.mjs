/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";

const PRECISION = 10;
const REGISTER_COUNT = 1 << PRECISION;
const REMAINING_BITS = 64 - PRECISION;
const REMAINING_MASK = (1n << BigInt(REMAINING_BITS)) - 1n;

function createSketch() {
    return Array(REGISTER_COUNT).fill(0);
}

function rank(value) {
    if (value === 0n) return REMAINING_BITS + 1;
    return value.toString(2).padStart(REMAINING_BITS, "0").indexOf("1") + 1;
}

function add(sketch, value) {
    const hash = createHash("sha256").update(value).digest().readBigUInt64BE();
    const index = Number(hash >> BigInt(REMAINING_BITS));
    const observedRank = rank(hash & REMAINING_MASK);
    sketch[index] = Math.max(sketch[index], observedRank);
}

function estimate(sketch) {
    const alpha = 0.7213 / (1 + 1.079 / REGISTER_COUNT);
    const denominator = sketch.reduce((sum, register) => sum + 2 ** -register, 0);
    const raw = (alpha * REGISTER_COUNT ** 2) / denominator;
    const emptyRegisters = sketch.filter((register) => register === 0).length;

    if (raw <= 2.5 * REGISTER_COUNT && emptyRegisters > 0) {
        return REGISTER_COUNT * Math.log(REGISTER_COUNT / emptyRegisters);
    }
    return raw;
}

function merge(left, right) {
    return left.map((value, index) => Math.max(value, right[index]));
}

const left = createSketch();
const right = createSketch();

for (let index = 0; index < 30_000; index += 1) add(left, `visitor-${index}`);
for (let index = 20_000; index < 50_000; index += 1) add(right, `visitor-${index}`);

const beforeDuplicates = [...left];
for (let index = 0; index < 1_000; index += 1) add(left, `visitor-${index}`);

const union = merge(left, right);
console.log(`registers=${REGISTER_COUNT}`);
console.log(`expected-standard-error=${((1.04 / Math.sqrt(REGISTER_COUNT)) * 100).toFixed(2)}%`);
console.log(`stream-a exact=30000 estimate=${Math.round(estimate(left))}`);
console.log(`stream-b exact=30000 estimate=${Math.round(estimate(right))}`);
console.log(`union exact=50000 estimate=${Math.round(estimate(union))}`);
console.log(`duplicates-changed=${beforeDuplicates.some((value, index) => value !== left[index])}`);
