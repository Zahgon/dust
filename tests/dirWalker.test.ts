import { expect, test } from 'vitest';

import type { WalkData } from '../src/dirWalker.ts';
import { cleanInodes, Operator, sortByInode } from '../src/dirWalker.ts';
import type { Node } from '../src/node.ts';
import { PIndicator, newRuntimeErrors } from '../src/progress.ts';

function createNode(): Node {
  return {
    name: '',
    size: 10,
    children: [],
    inodeDevice: [5n, 6n],
    depth: 0,
  };
}

function createWalker(useApparentSize: boolean): WalkData {
  const indicator = PIndicator.buildMe();
  return {
    ignoreDirectories: new Set(),
    filterRegex: [],
    invertFilterRegex: [],
    allowedFilesystems: new Set(),
    filterModifiedTime: [Operator.GreaterThan, 0],
    filterAccessedTime: [Operator.GreaterThan, 0],
    filterChangedTime: [Operator.GreaterThan, 0],
    useApparentSize,
    byFilecount: false,
    byFiletime: null,
    ignoreHidden: false,
    followLinks: false,
    progressData: indicator.data,
    errors: newRuntimeErrors(),
  };
}

test('test_should_ignore_file', () => {
  const inodes = new Set<string>();
  const n = createNode();
  const walkdata = createWalker(false);

  // First time we insert the node
  expect(cleanInodes(structuredClone(n), inodes, walkdata)).toEqual(n);

  // Second time is a duplicate - we ignore it
  expect(cleanInodes(structuredClone(n), inodes, walkdata)).toBe(null);
});

test('test_should_not_ignore_files_if_using_apparent_size', () => {
  const inodes = new Set<string>();
  const n = createNode();
  const walkdata = createWalker(true);

  // If using apparent size we include Nodes, even if duplicate inodes
  expect(cleanInodes(structuredClone(n), inodes, walkdata)).toEqual(n);
  expect(cleanInodes(structuredClone(n), inodes, walkdata)).toEqual(n);
});

test('test_total_ordering_of_sort_by_inode', () => {
  const a: Node = { name: 'a', size: 0, children: [], inodeDevice: [3n, 66310n], depth: 0 };
  const b: Node = { name: 'b', size: 0, children: [], inodeDevice: null, depth: 0 };
  const c: Node = { name: 'c', size: 0, children: [], inodeDevice: [1n, 66310n], depth: 0 };

  expect(Math.sign(sortByInode(a, b))).toBe(1);
  expect(Math.sign(sortByInode(a, c))).toBe(1);
  expect(Math.sign(sortByInode(c, b))).toBe(1);

  expect(Math.sign(sortByInode(b, a))).toBe(-1);
  expect(Math.sign(sortByInode(c, a))).toBe(-1);
  expect(Math.sign(sortByInode(b, c))).toBe(-1);
});
