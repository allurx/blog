/*
 * Copyright 2026 allurx
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest();
const leafHash = (value) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(value)]));
const nodeHash = (left, right) => hash(Buffer.concat([Buffer.from([1]), left, right]));

const entries = ["alpha", "beta", "gamma", "delta"];
const leaves = entries.map(leafHash);
const left = nodeHash(leaves[0], leaves[1]);
const right = nodeHash(leaves[2], leaves[3]);
const root = nodeHash(left, right);

const proofForGamma = [
    { side: "right", hash: leaves[3] },
    { side: "left", hash: left },
];

function verify(value, proof, expectedRoot) {
    let current = leafHash(value);

    for (const step of proof) {
        current = step.side === "left" ? nodeHash(step.hash, current) : nodeHash(current, step.hash);
    }

    return current.equals(expectedRoot);
}

console.log(`root=${root.toString("hex")}`);
console.log(`proof[0]=${proofForGamma[0].hash.toString("hex")}`);
console.log(`proof[1]=${proofForGamma[1].hash.toString("hex")}`);
console.log(`gamma=${verify("gamma", proofForGamma, root)}`);
console.log(`Gamma=${verify("Gamma", proofForGamma, root)}`);
