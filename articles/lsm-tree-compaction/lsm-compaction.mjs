/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";

function entry(key, sequence, value) {
    return { key, sequence, value };
}

function newestVisible(runs, key) {
    const candidates = runs.flatMap((run) => run.filter((item) => item.key === key));
    if (candidates.length === 0) return undefined;

    const newest = candidates.reduce((left, right) =>
        left.sequence > right.sequence ? left : right,
    );
    return newest.value;
}

function compact(runs, { bottommost }) {
    const byKey = new Map();
    for (const item of runs.flat()) {
        const current = byKey.get(item.key);
        if (current === undefined || item.sequence > current.sequence) {
            byKey.set(item.key, item);
        }
    }

    return [...byKey.values()]
        .filter((item) => !(bottommost && item.value === null))
        .sort((left, right) => left.key.localeCompare(right.key));
}

function display(value, missing = "<absent>") {
    if (value === null) return "<deleted>";
    return value ?? missing;
}

const level2 = [entry("book", 1, "old"), entry("user:2", 2, "enabled")];
const level1 = [entry("book", 3, "v1")];
const level0 = [
    entry("book", 5, "v2"),
    entry("cart", 4, "item-7"),
    entry("user:2", 6, null),
];

assert.equal(newestVisible([level0, level1, level2], "book"), "v2");
assert.equal(newestVisible([level0, level1, level2], "user:2"), null);

const compactedUpperLevels = compact([level0, level1], { bottommost: false });
const retainedTombstone = compactedUpperLevels.some(
    (item) => item.key === "user:2" && item.value === null,
);
assert.equal(retainedTombstone, true);
assert.equal(newestVisible([compactedUpperLevels, level2], "user:2"), null);

const withoutTombstone = compactedUpperLevels.filter((item) => item.value !== null);
const resurrected = newestVisible([withoutTombstone, level2], "user:2");
assert.equal(resurrected, "enabled");

const bottommost = compact([compactedUpperLevels, level2], { bottommost: true });
assert.equal(newestVisible([bottommost], "user:2"), undefined);

console.log(`before-book=${display(newestVisible([level0, level1, level2], "book"))}`);
console.log(`before-user:2=${display(newestVisible([level0, level1, level2], "user:2"))}`);
console.log(`partial-compaction-kept-tombstone=${retainedTombstone}`);
console.log(`if-tombstone-were-dropped-user:2=${display(resurrected)}`);
console.log(`bottommost-user:2=${display(newestVisible([bottommost], "user:2"))}`);
