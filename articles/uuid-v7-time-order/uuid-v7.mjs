/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";

const RFC_VECTOR = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";

function formatUuid(bytes) {
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseUuid(uuid) {
    const hex = uuid.replaceAll("-", "");
    assert.match(hex, /^[0-9a-fA-F]{32}$/);
    const bytes = Buffer.from(hex, "hex");
    const timestamp = bytes.readUIntBE(0, 6);
    const version = bytes[6] >> 4;
    const variant = (bytes[8] & 0xc0) === 0x80 ? "ietf" : "other";
    return { timestamp, version, variant };
}

function createUuidV7(timestamp, random) {
    assert.ok(Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp < 2 ** 48);
    assert.equal(random.length, 10);

    const bytes = Buffer.alloc(16);
    bytes.writeUIntBE(timestamp, 0, 6);
    bytes[6] = 0x70 | (random[0] & 0x0f);
    bytes[7] = random[1];
    bytes[8] = 0x80 | (random[2] & 0x3f);
    random.copy(bytes, 9, 3);
    return formatUuid(bytes);
}

const parsed = parseUuid(RFC_VECTOR);
assert.equal(parsed.timestamp, 1_645_557_742_000);
assert.equal(parsed.version, 7);
assert.equal(parsed.variant, "ietf");

const timestamp = 1_700_000_000_000;
const firstMillisecond = createUuidV7(timestamp, Buffer.alloc(10, 0xff));
const nextMillisecond = createUuidV7(timestamp + 1, Buffer.alloc(10));
const laterInSameMillisecond = createUuidV7(timestamp, Buffer.alloc(10));

console.log(`rfc-timestamp=${new Date(parsed.timestamp).toISOString()}`);
console.log(`rfc-version=${parsed.version}`);
console.log(`rfc-variant=${parsed.variant}`);
console.log(`different-millisecond-order=${firstMillisecond < nextMillisecond}`);
console.log(`same-millisecond-generation-order=${firstMillisecond < laterInSameMillisecond}`);
