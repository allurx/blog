import assert from 'node:assert/strict';

/**
 * Each edge [from, to] means that from must precede to.
 * Nodes are strings. Duplicate nodes and duplicate edges are normalized.
 * The graph is fixed for the duration of this synchronous calculation.
 */
export function topologicalSort(nodes, edges) {
  const vertices = [...new Set(nodes)];
  const successors = new Map(vertices.map(node => [node, new Set()]));
  const indegree = new Map(vertices.map(node => [node, 0]));

  for (const [from, to] of edges) {
    if (!successors.has(from) || !successors.has(to)) {
      throw new Error(`Unknown endpoint: ${from} -> ${to}`);
    }
    const targets = successors.get(from);
    if (!targets.has(to)) {
      targets.add(to);
      indegree.set(to, indegree.get(to) + 1);
    }
  }

  const ready = vertices.filter(node => indegree.get(node) === 0);
  const order = [];

  // Advance a cursor instead of repeatedly removing the first array element.
  for (let head = 0; head < ready.length; head += 1) {
    const node = ready[head];
    order.push(node);
    for (const target of successors.get(node)) {
      const remaining = indegree.get(target) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
  }

  const blocked = vertices.filter(node => indegree.get(node) > 0);
  return { order, blocked };
}

const nodes = ['A', 'B', 'C', 'D', 'E', 'F'];
const edges = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'B'],
  ['C', 'D'],
  ['E', 'F'],
];

const cyclic = topologicalSort(nodes, edges);
assert.deepEqual(cyclic, { order: ['A', 'E', 'F'], blocked: ['B', 'C', 'D'] });
console.log(`cyclic: order=${cyclic.order.join(',')}; blocked=${cyclic.blocked.join(',')}`);

// This changes the modeled requirements; it is not automatic cycle repair.
const repairedEdges = edges.filter(([from, to]) => !(from === 'C' && to === 'B'));
const repaired = topologicalSort(nodes, repairedEdges);
assert.equal(repaired.blocked.length, 0);
assert.equal(repaired.order.length, nodes.length);
const position = new Map(repaired.order.map((node, index) => [node, index]));
for (const [from, to] of repairedEdges) {
  assert.ok(position.get(from) < position.get(to));
}
console.log(`repaired: order=${repaired.order.join(',')}; blocked=(none)`);

const selfLoop = topologicalSort(['X', 'Y'], [['X', 'X'], ['X', 'Y']]);
assert.deepEqual(selfLoop, { order: [], blocked: ['X', 'Y'] });
console.log(`self-loop: order=(none); blocked=${selfLoop.blocked.join(',')}`);

assert.deepEqual(topologicalSort([], []), { order: [], blocked: [] });
assert.deepEqual(topologicalSort(['alone'], []), { order: ['alone'], blocked: [] });
assert.deepEqual(topologicalSort(['A', 'B'], [['A', 'B'], ['A', 'B']]), {
  order: ['A', 'B'], blocked: [],
});
