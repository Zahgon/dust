import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { beforeAll, expect, test } from 'vitest';

import { dust, type Output } from './support/command.ts';

/**
 * `#[cfg_attr(target_os = "windows", ignore)]`, which the original carries on
 * every test in this file.
 */
const IGNORE_ON_WINDOWS = { skip: process.platform === 'win32' };

const UNREADABLE_DIR_PATH = '/tmp/unreadable_dir';

/**
 * This file contains tests that verify the exact output of the command.
 * This output differs on Linux / Mac so the tests are harder to write and debug
 * Windows is ignored here because the results vary by host making exact testing impractical
 *
 * Despite the above problems, these tests are good as they are the closest to 'the real thing'.
 */

//  Warning: File sizes differ on both platform and on the format of the disk.
/** Copy to /tmp dir - we assume that the formatting of the /tmp partition
 * is consistent. If the tests fail your /tmp filesystem probably differs
 */
function copyTestData(dir: string): void {
  // First remove the existing directory - just in case it is there and has incorrect data
  const lastSlash = dir.lastIndexOf('/');
  const lastPartOfDir = dir.slice(lastSlash);
  spawnSync('rm', ['-rf', '/tmp/' + lastPartOfDir]);

  const result = spawnSync('cp', ['-r', dir, '/tmp/']);
  if (result.status !== 0) {
    process.stderr.write(`Error copying directory for test setup\n${String(result.stderr)}\n`);
  }
}

function createUnreadableDirectory(): void {
  fs.mkdirSync(UNREADABLE_DIR_PATH, { recursive: true });
  fs.chmodSync(UNREADABLE_DIR_PATH, 0o0);
}

beforeAll(() => {
  copyTestData('tests/test_dir');
  copyTestData('tests/test_dir2');
  copyTestData('tests/test_dir_unicode');

  try {
    createUnreadableDirectory();
  } catch (error) {
    throw new Error(`Failed to create unreadable directory: ${String(error)}`);
  }
});

async function runCmd(commandArgs: readonly string[]): Promise<Output> {
  // Hide progress bar
  return dust(['-P', ...commandArgs]);
}

async function exactStdoutTest(
  commandArgs: readonly string[],
  validStdout: readonly string[],
): Promise<void> {
  const toRun = await runCmd(commandArgs);

  const stdoutOutput = toRun.stdout;
  const willFail = validStdout.some((i) => stdoutOutput.includes(i));
  if (!willFail) {
    process.stderr.write(
      `output(stdout):\n${stdoutOutput}\ndoes not contain any of:\n${validStdout.join('\n\n')}\n`,
    );
  }
  expect(willFail).toBe(true);
}

async function exactStderrTest(commandArgs: readonly string[], validStderr: string): Promise<void> {
  const toRun = await runCmd(commandArgs);
  expect(toRun.stderr.trim()).toBe(validStderr);
}

function mainOutput(): string[] {
  // Some linux currently thought to be Manjaro, Arch
  // Although probably depends on how drive is formatted
  const macAndSomeLinux = `
  0B     ┌── a_file    │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░█ │   0%
4.0Ki     ├── hello_file│████████████████████████████████████████████████ │ 100%
4.0Ki   ┌─┴ many        │████████████████████████████████████████████████ │ 100%
4.0Ki ┌─┴ test_dir      │████████████████████████████████████████████████ │ 100%
`.trim();

  const ubuntu = `
   0B     ┌── a_file    │               ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░█ │   0%
4.0Ki     ├── hello_file│               ░░░░░░░░░░░░░░░░█████████████████ │  33%
8.0Ki   ┌─┴ many        │               █████████████████████████████████ │  67%
 12Ki ┌─┴ test_dir      │████████████████████████████████████████████████ │ 100%
`.trim();

  // 64K block size (e.g. ppc64, some aarch64)
  const largeBlock = `
 0B     ┌── a_file    │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░█ │   0%
64K     ├── hello_file│██████████████████████████████████████████████████ │ 100%
64K   ┌─┴ many        │██████████████████████████████████████████████████ │ 100%
64K ┌─┴ test_dir      │██████████████████████████████████████████████████ │ 100%
`.trim();

  return [macAndSomeLinux, ubuntu, largeBlock];
}

function mainOutputLongPaths(): string[] {
  const macAndSomeLinux = `
   0B     ┌── /tmp/test_dir/many/a_file    │░░░░░░░░░░░░░░░░░░░░░░░░░░░░█ │   0%
4.0Ki     ├── /tmp/test_dir/many/hello_file│█████████████████████████████ │ 100%
4.0Ki   ┌─┴ /tmp/test_dir/many             │█████████████████████████████ │ 100%
4.0Ki ┌─┴ /tmp/test_dir                    │█████████████████████████████ │ 100%
`.trim();
  const ubuntu = `
   0B     ┌── /tmp/test_dir/many/a_file    │         ░░░░░░░░░░░░░░░░░░░█ │   0%
4.0Ki     ├── /tmp/test_dir/many/hello_file│         ░░░░░░░░░░██████████ │  33%
8.0Ki   ┌─┴ /tmp/test_dir/many             │         ████████████████████ │  67%
 12Ki ┌─┴ /tmp/test_dir                    │█████████████████████████████ │ 100%
`.trim();
  const largeBlock = `
 0B     ┌── /tmp/test_dir/many/a_file    │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░█ │   0%
64K     ├── /tmp/test_dir/many/hello_file│███████████████████████████████ │ 100%
64K   ┌─┴ /tmp/test_dir/many             │███████████████████████████████ │ 100%
64K ┌─┴ /tmp/test_dir                    │███████████████████████████████ │ 100%
`.trim();

  return [macAndSomeLinux, ubuntu, largeBlock];
}

function noSubstringOfNamesOutput(): string[] {
  const ubuntu = `
   0B   ┌── long_dir_name_what_a_very_long_dir_name_what_happens_when_this_goe..
4.0Ki   ├── dir_name_clash
4.0Ki   │ ┌── hello
8.0Ki   ├─┴ dir
4.0Ki   │ ┌── hello
8.0Ki   ├─┴ dir_substring
 24Ki ┌─┴ test_dir2
`.trim();

  const macAndSomeLinux = `
   0B   ┌── long_dir_name_what_a_very_long_dir_name_what_happens_when_this_goe..
4.0Ki   │ ┌── hello
4.0Ki   ├─┴ dir
4.0Ki   ├── dir_name_clash
4.0Ki   │ ┌── hello
4.0Ki   ├─┴ dir_substring
 12Ki ┌─┴ test_dir2
`.trim();

  const largeBlock = `
  0B   ┌── long_dir_name_what_a_very_long_dir_name_what_happens_when_this_goes..
 64K   │ ┌── hello
 64K   ├─┴ dir
 64K   ├── dir_name_clash
 64K   │ ┌── hello
 64K   ├─┴ dir_substring
192K ┌─┴ test_dir2
`.trim();

  const largeBlockAlt = `
  0B   ┌── long_dir_name_what_a_very_long_dir_name_what_happens_when_this_goes..
 64K   ├── dir_name_clash
 64K   │ ┌── hello
 64K   ├─┴ dir
 64K   │ ┌── hello
 64K   ├─┴ dir_substring
192K ┌─┴ test_dir2
`.trim();

  return [macAndSomeLinux, ubuntu, largeBlock, largeBlockAlt];
}

function unicodeDir(): string[] {
  // The way unicode & asian characters are rendered on the terminal should make this line up
  const ubuntu = `
   0B   ┌── ラウトは難しいです！.japan│                                 █ │   0%
   0B   ├── 👩.unicode                │                                 █ │   0%
4.0Ki ┌─┴ test_dir_unicode            │██████████████████████████████████ │ 100%
`.trim();

  const macAndSomeLinux = `
0B   ┌── ラウトは難しいです！.japan│                                    █ │   0%
0B   ├── 👩.unicode                │                                    █ │   0%
0B ┌─┴ test_dir_unicode            │                                    █ │   0%
`.trim();
  const largeBlock = `
  0B   ┌── ラウトは難しいです！.japan│                                  █ │   0%
  0B   ├── 👩.unicode                │                                  █ │   0%
 64K ┌─┴ test_dir_unicode            │███████████████████████████████████ │ 100%
`.trim();

  return [macAndSomeLinux, ubuntu, largeBlock];
}

function apparentSizeOutput(): string[] {
  // The apparent directory sizes are too unpredictable and system dependent to try and match
  const twoSpaceBefore = `
  0B     ┌── a_file
  6B     ├── hello_file
`.trim();

  const threeSpaceBefore = `
   0B     ┌── a_file
   6B     ├── hello_file
`.trim();

  return [twoSpaceBefore, threeSpaceBefore];
}

// "windows" result data can vary by host (size seems to be variable by one byte); fix code vs test and re-enable
test('test_main_basic', IGNORE_ON_WINDOWS, async () => {
  // -c is no color mode - This makes testing much simpler
  await exactStdoutTest(['-c', '-B', '/tmp/test_dir/'], mainOutput());
});

test('test_main_multi_arg', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = ['-c', '-B', '/tmp/test_dir/many/', '/tmp/test_dir', '/tmp/test_dir'];
  await exactStdoutTest(commandArgs, mainOutput());
});

test('test_main_long_paths', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = ['-c', '-p', '-B', '/tmp/test_dir/'];
  await exactStdoutTest(commandArgs, mainOutputLongPaths());
});

// Check against directories and files whose names are substrings of each other
test('test_substring_of_names_and_long_names', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = ['-c', '-B', '/tmp/test_dir2'];
  await exactStdoutTest(commandArgs, noSubstringOfNamesOutput());
});

test('test_unicode_directories', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = ['-c', '-B', '/tmp/test_dir_unicode'];
  await exactStdoutTest(commandArgs, unicodeDir());
});

test('test_apparent_size', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = ['-c', '-s', '-b', '/tmp/test_dir'];
  await exactStdoutTest(commandArgs, apparentSizeOutput());
});

test('test_permission_normal', IGNORE_ON_WINDOWS, async () => {
  const commandArgs = [UNREADABLE_DIR_PATH];
  const permissionMsg =
    'Did not have permissions for all directories (add --print-errors to see errors)';
  await exactStderrTest(commandArgs, permissionMsg);
});

test('test_permission_flag', IGNORE_ON_WINDOWS, async () => {
  // add the flag to CLI
  const commandArgs = ['--print-errors', UNREADABLE_DIR_PATH];
  const permissionMsg = `Did not have permissions for directories: ${UNREADABLE_DIR_PATH}`;
  await exactStderrTest(commandArgs, permissionMsg);
});
