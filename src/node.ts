import type { WalkData } from './dirWalker.ts';
import type { InodeAndDevice } from './platform.ts';
import { getMetadata } from './platform.ts';
import {
  isFilteredOutDueToFileTime,
  isFilteredOutDueToInvertRegex,
  isFilteredOutDueToRegex,
} from './utils.ts';
import { comparePaths } from './deps/rustPath.ts';

export interface Node {
  name: string;
  size: number;
  children: Node[];
  inodeDevice: InodeAndDevice | null;
  depth: number;
}

/** Which timestamp `--filetime` reports. */
export const FileTime = {
  Modified: 'Modified',
  Accessed: 'Accessed',
  Changed: 'Changed',
} as const;

export type FileTime = (typeof FileTime)[keyof typeof FileTime];

/** `impl From<cli::FileTime> for node::FileTime`. */
export function fileTimeFromCli(time: 'a' | 'c' | 'm'): FileTime {
  switch (time) {
    case 'm':
      return FileTime.Modified;
    case 'a':
      return FileTime.Accessed;
    case 'c':
      return FileTime.Changed;
  }
}

export function buildNode(
  dir: string,
  children: Node[],
  isSymlink: boolean,
  isFile: boolean,
  depth: number,
  walkData: WalkData,
): Node | null {
  const useApparentSize = walkData.useApparentSize;
  const byFilecount = walkData.byFilecount;
  const byFiletime = walkData.byFiletime;

  const data = getMetadata(dir, useApparentSize, walkData.followLinks && isSymlink);
  if (data === null) return null;

  const inodeDevice = data.inodeDevice;
  const [modified, accessed, changed] = data.times;

  let size: number;
  if (
    isFilteredOutDueToRegex(walkData.filterRegex, dir) ||
    isFilteredOutDueToInvertRegex(walkData.invertFilterRegex, dir) ||
    (byFilecount && !isFile) ||
    isFilteredOutDueToFileTime(walkData.filterModifiedTime, modified) ||
    isFilteredOutDueToFileTime(walkData.filterAccessedTime, accessed) ||
    isFilteredOutDueToFileTime(walkData.filterChangedTime, changed)
  ) {
    size = 0;
  } else if (byFilecount) {
    size = 1;
  } else if (byFiletime !== null) {
    // `unsigned_abs`: a pre-epoch timestamp becomes its magnitude.
    switch (byFiletime) {
      case FileTime.Modified:
        size = Math.abs(modified);
        break;
      case FileTime.Accessed:
        size = Math.abs(accessed);
        break;
      case FileTime.Changed:
        size = Math.abs(changed);
        break;
    }
  } else {
    size = data.size;
  }

  return { name: dir, size, children, inodeDevice, depth };
}

/** `PartialEq for Node` — name, size and children, but deliberately not inode. */
export function nodeEquals(a: Node, b: Node): boolean {
  return (
    comparePaths(a.name, b.name) === 0 &&
    a.size === b.size &&
    a.children.length === b.children.length &&
    a.children.every((child, index) => nodeEquals(child, b.children[index] as Node))
  );
}

/** `Ord for Node`: size, then name, then children. */
export function compareNodes(a: Node, b: Node): number {
  if (a.size !== b.size) return a.size < b.size ? -1 : 1;
  const byName = comparePaths(a.name, b.name);
  if (byName !== 0) return byName;
  return compareNodeLists(a.children, b.children);
}

/** `Ord for Vec<Node>`: element-wise, then by length. */
function compareNodeLists(a: readonly Node[], b: readonly Node[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const ordering = compareNodes(a[i] as Node, b[i] as Node);
    if (ordering !== 0) return ordering;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
