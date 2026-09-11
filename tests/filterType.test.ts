import { expect, test } from 'vitest';

import { getAllFileTypes } from '../src/filterType.ts';
import type { Node } from '../src/node.ts';

function fileNode(name: string, size: number): Node {
  return { name, size, children: [], inodeDevice: null, depth: 1 };
}

test('test_others_node_is_sorted_by_size', () => {
  // These must be real files: only files are counted by extension.
  // Their sizes come from the Node, not from disk.
  const nodes = [
    fileNode('package.json', 40),
    fileNode('README.md', 30),
    fileNode('build.ts', 20),
    fileNode('LICENSE', 10),
  ];

  // 2 lines: '.json' then '(others)', which sums to 60 and so must sort first
  const tree = getAllFileTypes(nodes, 2, null);

  expect(tree.size).toBe(100);
  const displayed = tree.children.map((c) => [c.name, c.size]);
  expect(displayed).toEqual([
    ['(others)', 60],
    ['.json', 40],
  ]);
});
