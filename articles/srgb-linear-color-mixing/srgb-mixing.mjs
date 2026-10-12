/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";

function decodeSrgb(channel) {
    assert.ok(channel >= 0 && channel <= 1);
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

function encodeSrgb(channel) {
    assert.ok(channel >= 0 && channel <= 1);
    return channel <= 0.0031308
        ? 12.92 * channel
        : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function mixSrgb(a, b, t) {
    assert.ok(t >= 0 && t <= 1);
    return a.map((channel, index) => channel * (1 - t) + b[index] * t);
}

function mixLinearLight(a, b, t) {
    assert.ok(t >= 0 && t <= 1);
    return a.map((channel, index) => {
        const linear = decodeSrgb(channel) * (1 - t) + decodeSrgb(b[index]) * t;
        return encodeSrgb(linear);
    });
}

function toHex(color) {
    return `#${color
        .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
        .join("")}`;
}

const black = [0, 0, 0];
const white = [1, 1, 1];
const red = [1, 0, 0];
const green = [0, 1, 0];

const blackWhiteSrgb = mixSrgb(black, white, 0.5);
const blackWhiteLinear = mixLinearLight(black, white, 0.5);
const redGreenSrgb = mixSrgb(red, green, 0.5);
const redGreenLinear = mixLinearLight(red, green, 0.5);

assert.equal(toHex(blackWhiteSrgb), "#808080");
assert.equal(toHex(blackWhiteLinear), "#bcbcbc");
assert.equal(toHex(redGreenSrgb), "#808000");
assert.equal(toHex(redGreenLinear), "#bcbc00");

console.log(`black-white-srgb=${toHex(blackWhiteSrgb)}`);
console.log(`black-white-linear=${toHex(blackWhiteLinear)}`);
console.log(`srgb-midpoint-linear-light=${decodeSrgb(128 / 255).toFixed(6)}`);
console.log("linear-light-target=0.500000");
console.log(`red-green-srgb=${toHex(redGreenSrgb)}`);
console.log(`red-green-linear=${toHex(redGreenLinear)}`);
