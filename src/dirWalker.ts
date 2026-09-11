import * as fs from 'node:fs';

import type { Node } from './node.ts';
import { buildNode, type FileTime } from './node.ts';
import { Operation, type PAtomicInfo, type RuntimeErrors } from './progress.ts';
import {
  isFilteredOutDueToFileTime,
  isFilteredOutDueToInvertRegex,
  isFilteredOutDueToRegex,
} from './utils.ts';
import { getMetadata } from './platform.ts';
import { isDirOnDisk, isFileOnDisk } from './fsPredicates.ts';
import { compareBytes, isAbsolute, join, pathKey, startsWith } from './deps/rustPath.ts';
import { ioErrorCode, ioErrorString } from './deps/rustIo.ts';
import { eprintln } from './output.ts';

export const Operator = {
  Equal: 0,
  LessThan: 1,
  GreaterThan: 2,
} as const;

export type Operator = (typeof Operator)[keyof typeof Operator];

export interface WalkData {
  ignoreDirectories: ReadonlySet<string>;
  filterRegex: readonly RegExp[];
  invertFilterRegex: readonly RegExp[];
  allowedFilesystems: ReadonlySet<bigint>;
  filterModifiedTime: readonly [Operator, number] | null;
  filterAccessedTime: readonly [Operator, number] | null;
  filterChangedTime: readonly [Operator, number] | null;
  useApparentSize: boolean;
  byFilecount: boolean;
  byFiletime: FileTime | null;
  ignoreHidden: boolean;
  followLinks: boolean;
  progressData: PAtomicInfo;
  errors: RuntimeErrors;
}

export function walkIt(dirs: ReadonlySet<string>, walkData: WalkData): Node[] {
  const inodes = new Set<string>();
  const topLevelNodes: Node[] = [];

  for (const d of dirs) {
    const progData = walkData.progressData;
    progData.clearState(d);
    const node = walk(d, walkData, 0);
    if (node === null) continue;

    progData.setState(Operation.PREPARING);

    const cleaned = cleanInodes(node, inodes, walkData);
    if (cleaned !== null) topLevelNodes.push(cleaned);
  }
  return topLevelNodes;
}

function inodeKey(inodeDevice: readonly [bigint, bigint]): string {
  return `${inodeDevice[0].toString()}:${inodeDevice[1].toString()}`;
}

/**
 * Remove files which have the same inode, we don't want to double count them.
 *
 * Exported for the tests, which live outside the module here rather than in an
 * inline `mod tests`.
 */
export function cleanInodes(x: Node, inodes: Set<string>, walkData: WalkData): Node | null {
  if (!walkData.useApparentSize && x.inodeDevice !== null) {
    const id = inodeKey(x.inodeDevice);
    if (inodes.has(id)) return null;
    inodes.add(id);
  }

  // Sort Nodes so iteration order is predictable
  const tmp = [...x.children];
  tmp.sort(sortByInode);
  const newChildren: Node[] = [];
  for (const c of tmp) {
    const cleaned = cleanInodes(c, inodes, walkData);
    if (cleaned !== null) newChildren.push(cleaned);
  }

  const actualSize =
    walkData.byFiletime !== null
      ? // If by_filetime is Some, directory 'size' is the maximum filetime among
        // child files instead of disk size
        newChildren.reduce((acc, c) => Math.max(acc, c.size), x.size)
      : // If by_filetime is None, directory 'size' is the sum of disk sizes or
        // file counts of child files
        x.size + newChildren.reduce((acc, c) => acc + c.size, 0);

  return {
    name: x.name,
    size: actualSize,
    children: newChildren,
    inodeDevice: x.inodeDevice,
    depth: x.depth,
  };
}

export function sortByInode(a: Node, b: Node): number {
  // Sorting by inode is quicker than by sorting by name/size
  if (a.inodeDevice !== null && b.inodeDevice !== null) {
    const [ai, ad] = a.inodeDevice;
    const [bi, bd] = b.inodeDevice;
    if (ai !== bi) return ai < bi ? -1 : 1;
    if (ad !== bd) return ad < bd ? -1 : 1;
    return compareBytes(a.name, b.name);
  }
  if (a.inodeDevice !== null) return 1;
  if (b.inodeDevice !== null) return -1;
  return compareBytes(a.name, b.name);
}

// Check if `path` is inside ignored directory
function isIgnoredPath(path: string, walkData: WalkData): boolean {
  if (walkData.ignoreDirectories.has(pathKey(path))) return true;

  // Entry is inside an ignored absolute path
  // Absolute paths should be canonicalized before being added to `WalkData.ignoreDirectories`
  for (const ignoredPath of walkData.ignoreDirectories) {
    if (!isAbsolute(ignoredPath)) continue;
    let absoluteEntryPath: string;
    try {
      absoluteEntryPath = fs.realpathSync(path);
    } catch {
      // `unwrap_or_default()` on a failed canonicalize gives the empty path.
      absoluteEntryPath = '';
    }
    if (startsWith(absoluteEntryPath, ignoredPath)) return true;
  }

  return false;
}

interface Entry {
  path: string;
  fileName: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

function ignoreFile(entry: Entry, walkData: WalkData): boolean {
  if (isIgnoredPath(entry.path, walkData)) return true;

  const isDotFile = entry.fileName.startsWith('.');
  const followLinks = walkData.followLinks && entry.isSymlink;

  if (walkData.allowedFilesystems.size > 0) {
    const sizeInodeDevice = getMetadata(entry.path, false, followLinks);
    if (
      sizeInodeDevice?.inodeDevice != null &&
      !walkData.allowedFilesystems.has(sizeInodeDevice.inodeDevice[1])
    ) {
      return true;
    }
  }
  if (
    walkData.filterAccessedTime !== null ||
    walkData.filterModifiedTime !== null ||
    walkData.filterChangedTime !== null
  ) {
    const sizeInodeDevice = getMetadata(entry.path, false, followLinks);
    if (sizeInodeDevice !== null && isFileOnDisk(entry.path)) {
      const [modifiedTime, accessedTime, changedTime] = sizeInodeDevice.times;
      if (
        isFilteredOutDueToFileTime(walkData.filterModifiedTime, modifiedTime) ||
        isFilteredOutDueToFileTime(walkData.filterAccessedTime, accessedTime) ||
        isFilteredOutDueToFileTime(walkData.filterChangedTime, changedTime)
      ) {
        return true;
      }
    }
  }

  // Keeping `walkData.filterRegex.length === 0` is important for performance
  // reasons, it stops unnecessary work
  if (
    walkData.filterRegex.length > 0 &&
    isFileOnDisk(entry.path) &&
    isFilteredOutDueToRegex(walkData.filterRegex, entry.path)
  ) {
    return true;
  }

  if (
    walkData.invertFilterRegex.length > 0 &&
    isFileOnDisk(entry.path) &&
    isFilteredOutDueToInvertRegex(walkData.invertFilterRegex, entry.path)
  ) {
    return true;
  }

  return isDotFile && walkData.ignoreHidden;
}

function walk(dir: string, walkData: WalkData, depth: number): Node | null {
  const progData = walkData.progressData;
  const errors = walkData.errors;

  let children: Node[] = [];

  if (isDirOnDisk(dir)) {
    let entries: fs.Dirent[] | null = null;
    for (;;) {
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
        break;
      } catch (failed) {
        // `read_dir` and its iterator report the same errors; Node surfaces
        // both through this one call, so one handler covers both branches.
        if (handleErrorAndRetry(failed, dir, walkData)) continue;
        entries = null;
        break;
      }
    }

    if (entries !== null) {
      for (const dirent of entries) {
        const entry: Entry = {
          path: join(dir, dirent.name),
          fileName: dirent.name,
          isDir: dirent.isDirectory(),
          isFile: dirent.isFile(),
          isSymlink: dirent.isSymbolicLink(),
        };
        if (ignoreFile(entry, walkData)) continue;

        if (entry.isDir || (walkData.followLinks && entry.isSymlink)) {
          const child = walk(entry.path, walkData, depth + 1);
          if (child !== null) children.push(child);
          continue;
        }

        const node = buildNode(entry.path, [], entry.isSymlink, entry.isFile, depth, walkData);

        progData.addFile();
        if (node !== null) {
          progData.addSize(node.size);
          children.push(node);
        }
      }
    }
  } else {
    children = [];
    if (!isFileOnDisk(dir)) {
      errors.fileNotFound.add(dir);
    }
  }

  let isSymlink = false;
  if (walkData.followLinks) {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    isSymlink = stat !== undefined && stat.isSymbolicLink();
  }
  return buildNode(dir, children, isSymlink, false, depth, walkData);
}

function handleErrorAndRetry(failed: unknown, dir: string, walkData: WalkData): boolean {
  const editableError = walkData.errors;
  switch (ioErrorCode(failed)) {
    case 'EACCES':
    case 'EPERM':
      editableError.noPermissions.add(dir);
      return false;
    case 'EINVAL':
      editableError.noPermissions.add(dir);
      return false;
    case 'ENOENT':
      editableError.fileNotFound.add(ioErrorString(failed));
      return false;
    case 'EINTR':
      editableError.interruptedError += 1;
      // This does happen on some systems. It was set to 3 but sometimes dust runs would exceed this
      // However, if there is no limit this results in infinite retrys and dust never finishes
      if (editableError.interruptedError > 999) {
        eprintln(`Too many Interrupted Errors occurred while scanning filesystem, skipping: ${dir}`);
        return false;
      }
      return true;
    default:
      editableError.unknownError.add(ioErrorString(failed));
      return false;
  }
}
