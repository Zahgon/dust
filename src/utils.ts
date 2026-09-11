import * as fs from 'node:fs';

import { DAY_SECONDS } from './config.ts';
import { Operator } from './dirWalker.ts';
import { getMetadata } from './platform.ts';
import { components, fromComponents, pathKey, startsWith } from './deps/rustPath.ts';

/**
 * Reduce the requested paths to the set that actually needs walking: each is
 * normalised, and any path already covered by an ancestor in the set is
 * dropped (as is any descendant already in the set when an ancestor arrives).
 */
export function simplifyDirNames(dirs: readonly string[]): Set<string> {
  const topLevelNames = new Set<string>();

  for (const t of dirs) {
    const topLevelName = normalizePath(t);
    let canAdd = true;
    const toRemove: string[] = [];

    for (const tt of topLevelNames) {
      if (isAParentOf(topLevelName, tt)) {
        toRemove.push(tt);
      } else if (isAParentOf(tt, topLevelName)) {
        canAdd = false;
      }
    }
    for (const r of toRemove) topLevelNames.delete(r);
    if (canAdd) topLevelNames.add(topLevelName);
  }

  return topLevelNames;
}

/** The device ids of the filesystems the argument paths live on. */
export function getFilesystemDevices(paths: readonly string[], followLinks: boolean): Set<bigint> {
  const devices = new Set<bigint>();
  for (const p of paths) {
    let follow = false;
    if (followLinks) {
      // slow path: If dereference-links is set, then we check if the file is a symbolic link
      const stat = fs.lstatSync(p, { throwIfNoEntry: false });
      follow = stat !== undefined && stat.isSymbolicLink();
    }
    const metadata = getMetadata(p, false, follow);
    if (metadata?.inodeDevice != null) devices.add(metadata.inodeDevice[1]);
  }
  return devices;
}

/**
 * normalize path ...
 * 1. removing repeated separators
 * 2. removing interior '.' ("current directory") path segments
 * 3. removing trailing extra separators and '.' ("current directory") path segments
 *
 * `Path::components()` does all of the above.
 */
export function normalizePath(path: string): string {
  return fromComponents(components(path));
}

/** Canonicalize the path only if it is an absolute path. */
export function canonicalizeAbsolutePath(path: string): string {
  if (!path.startsWith('/')) return path;
  try {
    return fs.realpathSync(path);
  } catch {
    return path;
  }
}

export function isFilteredOutDueToRegex(filterRegex: readonly RegExp[], dir: string): boolean {
  if (filterRegex.length === 0) return false;
  return filterRegex.every((f) => !f.test(dir));
}

export function isFilteredOutDueToFileTime(
  filterTime: readonly [Operator, number] | null,
  actualTime: number,
): boolean {
  if (filterTime === null) return false;
  const [operator, boundTime] = filterTime;
  switch (operator) {
    case Operator.Equal:
      return !(actualTime >= boundTime && actualTime < boundTime + DAY_SECONDS);
    case Operator.GreaterThan:
      return actualTime < boundTime;
    case Operator.LessThan:
      return actualTime > boundTime;
  }
}

export function isFilteredOutDueToInvertRegex(
  filterRegex: readonly RegExp[],
  dir: string,
): boolean {
  return filterRegex.some((f) => f.test(dir));
}

/**
 * Strictly an ancestor: `/usr` is a parent of `/usr/andy` but not of `/usr/.`,
 * `/usr/` or `/usr`, because `Path` compares components rather than strings.
 */
export function isAParentOf(parent: string, child: string): boolean {
  return startsWith(child, parent) && !startsWith(parent, child);
}

/** The key a `HashSet<PathBuf>` would use — normalised, not the raw string. */
export { pathKey };
