import * as fs from 'node:fs';

/**
 * `Path::is_file()` and `Path::is_dir()`.
 *
 * Both follow symlinks and answer `false` for a path that cannot be stat'ed,
 * which is what makes them safe to call on a tree that is changing underneath.
 */

export function isFileOnDisk(path: string): boolean {
  const stat = fs.statSync(path, { throwIfNoEntry: false });
  return stat !== undefined && stat.isFile();
}

export function isDirOnDisk(path: string): boolean {
  const stat = fs.statSync(path, { throwIfNoEntry: false });
  return stat !== undefined && stat.isDirectory();
}
