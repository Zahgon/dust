import { describe, expect, test } from 'vitest';

import {
  compareDisplayNodes,
  getChildrenFromNode,
  numSiblings,
  toJsonValue,
  type DisplayNode,
} from '../src/displayNode.ts';
import { compareNodes, fileTimeFromCli, FileTime, nodeEquals, type Node } from '../src/node.ts';

function node(name: string, size: number, children: Node[] = []): Node {
  return { name, size, children, inodeDevice: null, depth: 0 };
}

function display(name: string, size: number, children: DisplayNode[] = []): DisplayNode {
  return { name, size, children };
}

describe('node', () => {
  test('Ord compares size, then name, then children', () => {
    expect(compareNodes(node('a', 1), node('b', 2))).toBeLessThan(0);
    expect(compareNodes(node('b', 1), node('a', 1))).toBeGreaterThan(0);
    expect(compareNodes(node('a', 1), node('a', 1))).toBe(0);
    expect(compareNodes(node('a', 1, [node('x', 1)]), node('a', 1))).toBeGreaterThan(0);
    expect(compareNodes(node('a', 1, [node('x', 1)]), node('a', 1, [node('x', 2)]))).toBeLessThan(
      0,
    );
  });

  test('PartialEq ignores the inode but not the children', () => {
    const withInode: Node = { ...node('a', 1), inodeDevice: [1n, 2n] };
    expect(nodeEquals(withInode, node('a', 1))).toBe(true);
    expect(nodeEquals(node('a', 1), node('a', 2))).toBe(false);
    expect(nodeEquals(node('a', 1, [node('x', 1)]), node('a', 1))).toBe(false);
    expect(nodeEquals(node('a', 1, [node('x', 1)]), node('a', 1, [node('x', 2)]))).toBe(false);
  });

  test('the CLI filetime values map onto the internal ones', () => {
    expect(fileTimeFromCli('a')).toBe(FileTime.Accessed);
    expect(fileTimeFromCli('c')).toBe(FileTime.Changed);
    expect(fileTimeFromCli('m')).toBe(FileTime.Modified);
  });
});

describe('displayNode', () => {
  test('children are iterated in reverse when the tree is reversed', () => {
    const root = display('root', 3, [display('a', 2), display('b', 1)]);
    expect(numSiblings(root)).toBe(2);
    expect(getChildrenFromNode(root, false).map((c) => c.name)).toEqual(['a', 'b']);
    expect(getChildrenFromNode(root, true).map((c) => c.name)).toEqual(['b', 'a']);
    // Reversing must not disturb the node itself.
    expect(root.children.map((c) => c.name)).toEqual(['a', 'b']);
  });

  test('Ord is derived over size, then name, then children', () => {
    expect(compareDisplayNodes(display('a', 1), display('b', 2))).toBeLessThan(0);
    expect(compareDisplayNodes(display('b', 1), display('a', 1))).toBeGreaterThan(0);
    expect(compareDisplayNodes(display('a', 1), display('a', 1))).toBe(0);
    expect(
      compareDisplayNodes(display('a', 1, [display('x', 1)]), display('a', 1)),
    ).toBeGreaterThan(0);
    expect(
      compareDisplayNodes(display('a', 1, [display('x', 1)]), display('a', 1, [display('x', 2)])),
    ).toBeLessThan(0);
  });

  test('the JSON document renders sizes with the active output format', () => {
    const root = display('.', 4096, [display('./a', 1024)]);
    expect(toJsonValue(root, '')).toEqual({
      size: '4.0Ki',
      name: '.',
      children: [{ size: '1.0Ki', name: './a', children: [] }],
    });
    expect(toJsonValue(root, 'count')).toMatchObject({ size: '4096' });
    expect(toJsonValue(root, 'si')).toMatchObject({ size: '4.1K' });
  });
});
