/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

const query = [1, 2, -0.5, 3];
const key = [0.25, -1, 2, 0.5];
const frequencies = [1, 0.01];

function rotate(vector, position) {
    if (vector.length !== frequencies.length * 2) {
        throw new Error("The vector must contain one pair per frequency.");
    }

    const rotated = [];
    for (let pair = 0; pair < frequencies.length; pair++) {
        const angle = position * frequencies[pair];
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const x = vector[pair * 2];
        const y = vector[pair * 2 + 1];

        rotated.push(x * cosine - y * sine, x * sine + y * cosine);
    }
    return rotated;
}

function dot(left, right) {
    return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function norm(vector) {
    return Math.sqrt(dot(vector, vector));
}

function score(queryPosition, keyPosition) {
    return dot(rotate(query, queryPosition), rotate(key, keyPosition));
}

function approximatelyEqual(left, right, tolerance = 1e-12) {
    return Math.abs(left - right) <= tolerance;
}

const original = score(2, 7);
const shiftedTogether = score(102, 107);
const differentOffset = score(2, 8);
const rotatedQuery = rotate(query, 37);
const rotatedKey = rotate(key, 37);

console.log(`score(2, 7)=${original.toFixed(12)}`);
console.log(`score(102, 107)=${shiftedTogether.toFixed(12)}`);
console.log(`score(2, 8)=${differentOffset.toFixed(12)}`);
console.log(`same-relative-offset=${approximatelyEqual(original, shiftedTogether)}`);
console.log(`different-offset-changes-score=${!approximatelyEqual(original, differentOffset)}`);
console.log(`query-norm-preserved=${approximatelyEqual(norm(query), norm(rotatedQuery))}`);
console.log(`key-norm-preserved=${approximatelyEqual(norm(key), norm(rotatedKey))}`);
