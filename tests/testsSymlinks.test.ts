import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from 'vitest';

import { dustSpawn } from './support/command.ts';

/**
 * `#[cfg_attr(target_os = "windows", ignore)]`, which the original carries on
 * every test in this file.
 */
const IGNORE_ON_WINDOWS = { skip: process.platform === 'win32' };

// File sizes differ on both platform and on the format of the disk.
// Windows: `ln` is not usually an available command; creation of symbolic links
// requires special enhanced permissions

function tempdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dust-symlink-'));
}

function buildTempFile(dir: string): string {
  const filePath = path.join(dir, 'notes.txt');
  fs.writeFileSync(filePath, 'I am a temp file\n');
  return filePath;
}

function linkIt(linkPath: string, filePathS: string, isSoft: boolean): string {
  const args = isSoft ? ['-s', filePathS, linkPath] : [filePathS, linkPath];
  const result = spawnSync('ln', args);
  expect(result.error).toBeUndefined();
  return linkPath;
}

test('test_soft_sym_link', IGNORE_ON_WINDOWS, () => {
  const dir = tempdir();
  const file = buildTempFile(dir);

  const linkName = path.join(dir, 'the_link');
  const linkNameS = linkIt(linkName, file, true);

  const c = ` ├── ${linkNameS}`;
  const b = ` ┌── ${file}`;
  const a = `─┴ ${dir}`;

  // Mac test runners create long filenames in tmp directories
  const output = dustSpawn(['-p', '-c', '-s', '-w', '999', dir]).stdout;

  expect(output).toContain(a);
  expect(output).toContain(b);
  expect(output).toContain(c);
});

test('test_hard_sym_link', IGNORE_ON_WINDOWS, () => {
  const dir = tempdir();
  const file = buildTempFile(dir);

  const linkName = path.join(dir, 'the_link');
  linkIt(linkName, file, false);

  const fileOutput = ` ┌── ${file}`;
  const dirsOutput = `─┴ ${dir}`;

  // Mac test runners create long filenames in tmp directories
  const output = dustSpawn(['-p', '-c', '-w', '999', dir]).stdout;

  // The link should not appear in the output because multiple inodes are now ordered
  // then filtered.
  expect(output).toContain(dirsOutput);
  expect(output).toContain(fileOutput);
});

test('test_hard_sym_link_no_dup_multi_arg', IGNORE_ON_WINDOWS, () => {
  const dir = tempdir();
  const dirLink = tempdir();
  const file = buildTempFile(dir);

  const linkName = path.join(dirLink, 'the_link');
  const linkNameS = linkIt(linkName, file, false);

  // Mac test runners create long filenames in tmp directories
  const output = dustSpawn(['-p', '-c', '-w', '999', '-b', dirLink, dir]).stdout;

  // The link or the file should appear but not both
  const hasFileOnly = output.includes(file) && !output.includes(linkNameS);
  const hasLinkOnly = !output.includes(file) && output.includes(linkNameS);
  expect(hasFileOnly || hasLinkOnly).toBe(true);
});

test('test_recursive_sym_link', IGNORE_ON_WINDOWS, () => {
  const dir = tempdir();

  const linkName = path.join(dir, 'the_link');
  const linkNameS = linkIt(linkName, dir, true);

  const a = `─┬ ${dir}`;
  const b = ` └── ${linkNameS}`;

  const output = dustSpawn(['-p', '-c', '-r', '-s', '-w', '999', dir]).stdout;

  expect(output).toContain(a);
  expect(output).toContain(b);
});
