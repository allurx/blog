class Node {
    constructor(key, level) {
        this.key = key;
        this.next = Array(level + 1).fill(null);
    }
}

class SkipList {
    constructor({ probability = 0.5, maxLevel = 8, random = Math.random } = {}) {
        this.probability = probability;
        this.maxLevel = maxLevel;
        this.random = random;
        this.level = 0;
        this.head = new Node(Number.NEGATIVE_INFINITY, maxLevel);
    }

    randomLevel() {
        let level = 0;
        while (level < this.maxLevel && this.random() < this.probability) {
            level += 1;
        }
        return level;
    }

    add(key) {
        const update = Array(this.maxLevel + 1);
        let current = this.head;

        for (let level = this.level; level >= 0; level -= 1) {
            while (current.next[level] && current.next[level].key < key) {
                current = current.next[level];
            }
            update[level] = current;
        }

        if (current.next[0]?.key === key) {
            return false;
        }

        const nodeLevel = this.randomLevel();
        if (nodeLevel > this.level) {
            for (let level = this.level + 1; level <= nodeLevel; level += 1) {
                update[level] = this.head;
            }
            this.level = nodeLevel;
        }

        const node = new Node(key, nodeLevel);
        for (let level = 0; level <= nodeLevel; level += 1) {
            node.next[level] = update[level].next[level];
            update[level].next[level] = node;
        }
        return true;
    }

    find(key) {
        const path = [];
        let current = this.head;

        for (let level = this.level; level >= 0; level -= 1) {
            while (current.next[level] && current.next[level].key < key) {
                current = current.next[level];
                path.push(`L${level}: ${current.key}`);
            }
        }

        const candidate = current.next[0];
        return { found: candidate?.key === key, path };
    }

    levels() {
        const result = [];
        for (let level = this.level; level >= 0; level -= 1) {
            const keys = [];
            let current = this.head.next[level];
            while (current) {
                keys.push(current.key);
                current = current.next[level];
            }
            result.push(`L${level}: ${keys.join(" -> ")}`);
        }
        return result;
    }
}

function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const list = new SkipList({ random: mulberry32(20261018) });
for (const key of [21, 8, 42, 3, 34, 13, 39, 27]) {
    list.add(key);
}

console.log(list.levels().join("\n"));
const result = list.find(39);
console.log(`find 39: ${result.found}`);
console.log(`path: ${result.path.join(" | ")}`);
