import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from 'vitest';

import { dust } from './support/command.ts';

/** `#[cfg(target_family = "unix")]`, which two of these tests carry. */
const UNIX_ONLY = { skip: process.platform === 'win32' };

/**
 * This file contains tests that test a substring of the output using
 * `.includes`.
 *
 * These tests should be the same cross platform.
 */

async function buildCommand(commandArgs: readonly string[]): Promise<string> {
  // Hide progress bar
  const finished = await dust(['-P', ...commandArgs]);
  expect(finished.stderr).toBe('');
  return finished.stdout;
}

function tempdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dust-test-'));
}

/** `Local::now().date_naive().pred_opt()` at noon, as an epoch-millisecond value. */
function yesterdayNoon(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0, 0).getTime();
}

test('test_filetime_output_uses_unix_timestamp', async () => {
  const tempDir = tempdir();
  fs.writeFileSync(path.join(tempDir, 'recent.txt'), 'recent');

  const output = await dust(['-P', '-c', '--filetime', 'modified', tempDir]);

  expect(output.status, output.stderr).toBe(0);
});

test('test_mtime_filter_uses_unix_timestamp', async () => {
  const tempDir = tempdir();
  const filePath = path.join(tempDir, 'yesterday.txt');
  fs.writeFileSync(filePath, 'yesterday');

  const when = new Date(yesterdayNoon());
  fs.utimesSync(filePath, when, when);

  const output = await dust(['-P', '-c', '--mtime', '0', tempDir]);

  expect(output.status).toBe(0);
  expect(output.stdout).toContain('yesterday.txt');
});

// We can at least test the file names are there
test('test_basic_output', async () => {
  const output = await buildCommand(['tests/test_dir/']);

  expect(output).toContain(' ┌─┴ ');
  expect(output).toContain('test_dir ');
  expect(output).toContain('  ┌─┴ ');
  expect(output).toContain('many ');
  expect(output).toContain('    ├── ');
  expect(output).toContain('hello_file');
  expect(output).toContain('     ┌── ');
  expect(output).toContain('a_file ');
});

test('test_output_no_bars_means_no_excess_spaces', async () => {
  const output = await buildCommand(['-b', 'tests/test_dir/']);
  // If bars are not being shown we don't need to pad the output with spaces
  expect(output).toContain('many');
  expect(output).not.toContain('many    ');
});

test('test_reverse_flag', async () => {
  const output = await buildCommand(['-r', '-c', 'tests/test_dir/']);
  expect(output).toContain(' └─┬ test_dir ');
  expect(output).toContain('  └─┬ many ');
  expect(output).toContain('    ├── hello_file');
  expect(output).toContain('    └── a_file ');
});

test('test_d_flag_works', async () => {
  // We should see the top level directory but not the sub dirs / files:
  const output = await buildCommand(['-d', '1', 'tests/test_dir/']);
  expect(output).not.toContain('hello_file');
});

test('test_d0_works_on_multiple', async () => {
  // We should see the top level directory but not the sub dirs / files:
  const output = await buildCommand(['-d', '0', 'tests/test_dir/', 'tests/test_dir2']);
  expect(output).toContain('test_dir ');
  expect(output).toContain('test_dir2');
});

test('test_threads_flag_works', async () => {
  const output = await buildCommand(['-T', '1', 'tests/test_dir/']);
  expect(output).toContain('hello_file');
});

test('test_d_flag_works_and_still_recurses_down', async () => {
  // We had a bug where running with '-d 1' would stop at the first directory and the code
  // would fail to recurse down
  const output = await buildCommand(['-d', '1', '-f', '-c', 'tests/test_dir2/']);
  expect(output).toContain('1   ┌── dir');
  expect(output).toContain('4 ┌─┴ test_dir2');
});

// Check against directories and files whose names are substrings of each other
test('test_ignore_dir', async () => {
  const output = await buildCommand(['-c', '-X', 'dir_substring', 'tests/test_dir2/']);
  expect(output).not.toContain('dir_substring');
});

test('test_ignore_all_in_file', async () => {
  const output = await buildCommand([
    '-c',
    '-I',
    'tests/test_dir_hidden_entries/.hidden_file',
    'tests/test_dir_hidden_entries/',
  ]);
  expect(output).toContain(' test_dir_hidden_entries');
  expect(output).not.toContain('.secret');
});

test('test_files_from_flag_file', async () => {
  const output = await buildCommand(['--files-from', 'tests/test_dir_files_from/files_from.txt']);
  expect(output).toContain('a_file');
  expect(output).toContain('hello_file');
});

test('test_files0_from_flag_file', async () => {
  const output = await buildCommand(['--files0-from', 'tests/test_dir_files_from/files0_from.txt']);
  expect(output).toContain('a_file');
  expect(output).toContain('hello_file');
});

test('test_files_from_flag_stdin', async () => {
  const input =
    'tests/test_dir_files_from/a_file\ntests/test_dir_files_from/hello_file\n';
  const finished = await dust(['-P', '--files-from', '-'], input);
  expect(finished.stderr).toBe('');
  expect(finished.stdout).toContain('a_file');
  expect(finished.stdout).toContain('hello_file');
});

test('test_files_from_ignores_empty_lines', async () => {
  const input =
    'tests/test_dir_files_from/a_file\n\ntests/test_dir_files_from/hello_file\n';
  const finished = await dust(['-P', '--files-from', '-'], input);
  expect(finished.stderr).toBe('');
  expect(finished.stdout).toContain('a_file');
  expect(finished.stdout).toContain('hello_file');
});

test('test_cli_paths_ignore_empty_arguments', async () => {
  const output = await buildCommand([
    '-b',
    '-c',
    '-d',
    '0',
    'tests/test_dir_files_from/a_file',
    '',
    'tests/test_dir_files_from/hello_file',
  ]);
  expect(output).toContain('a_file');
  expect(output).toContain('hello_file');
});

test('test_files0_from_flag_stdin', async () => {
  const input =
    'tests/test_dir_files_from/a_file\0tests/test_dir_files_from/hello_file\0';
  const finished = await dust(['-P', '--files0-from', '-'], input);
  expect(finished.stderr).toBe('');
  expect(finished.stdout).toContain('a_file');
  expect(finished.stdout).toContain('hello_file');
});

test('test_with_bad_param', async () => {
  const result = await dust(['-P', 'bad_place']);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('No such file or directory');
});

test('test_hidden_flag', async () => {
  // Check we can see the hidden file normally
  let output = await buildCommand(['-c', 'tests/test_dir_hidden_entries/']);
  expect(output).toContain('.hidden_file');
  expect(output).toContain('┌─┴ test_dir_hidden_entries');

  // Check that adding the '-i' flag causes us to not see hidden files
  output = await buildCommand(['-c', '-i', 'tests/test_dir_hidden_entries/']);
  expect(output).not.toContain('.hidden_file');
  expect(output).toContain('┌── test_dir_hidden_entries');
});

test('test_number_of_files', async () => {
  // Check we can see the hidden file normally
  const output = await buildCommand(['-c', '-f', 'tests/test_dir']);
  expect(output).toContain('1     ┌── a_file ');
  expect(output).toContain('1     ├── hello_file');
  expect(output).toContain('2   ┌─┴ many');
  expect(output).toContain('2 ┌─┴ test_dir');
});

test('test_show_files_by_type', async () => {
  // Check we can list files by type
  const output = await buildCommand(['-c', '-t', 'tests']);
  expect(output).toContain(' .unicode');
  expect(output).toContain(' .japan');
  expect(output).toContain(' .ts');
  expect(output).toContain(' (no extension)');
  expect(output).toContain('┌─┴ (total)');
});

test('test_show_files_only', UNIX_ONLY, async () => {
  const output = await buildCommand(['-c', '-F', 'tests/test_dir']);
  expect(output).toContain('a_file');
  expect(output).toContain('hello_file');
  expect(output).not.toContain('many');
});

test('test_output_skip_total', async () => {
  const output = await buildCommand([
    '--skip-total',
    'tests/test_dir/many/hello_file',
    'tests/test_dir/many/a_file',
  ]);
  expect(output).toContain('hello_file');
  expect(output).not.toContain('(total)');
});

test('test_output_screen_reader', async () => {
  const output = await buildCommand(['--screen-reader', '-c', 'tests/test_dir/']);
  console.log(output);
  expect(output).toContain('test_dir   0');
  expect(output).toContain('many       1');
  expect(output).toContain('hello_file 2');
  expect(output).toContain('a_file     2');

  // Verify no 'symbols' reported by screen reader
  expect(output).not.toContain('│');

  for (const block of ['█', '▓', '▒', '░']) {
    expect(output).not.toContain(block);
  }
});

test('test_show_files_by_regex_match_lots', async () => {
  // Check we can see '.ts' files in the tests directory
  const output = await buildCommand(['-c', '-e', '\\.ts$', 'tests']);
  expect(output).toContain(' ┌─┴ tests');
  expect(output).not.toContain('0B ┌── tests');
  expect(output).not.toContain('0B ┌─┴ tests');
});

test('test_show_files_by_regex_match_nothing', async () => {
  // Check there are no files named: '.match_nothing' in the tests directory
  const output = await buildCommand(['-c', '-e', 'match_nothing$', 'tests']);
  expect(output).toContain('0B ┌── tests');
});

test('test_show_files_by_regex_match_multiple', async () => {
  const output = await buildCommand([
    '-c',
    '-e',
    'test_dir_hidden',
    '-e',
    'test_dir2',
    '-n',
    '100',
    'tests',
  ]);
  expect(output).toContain('test_dir2');
  expect(output).toContain('test_dir_hidden');
  expect(output).not.toContain('many'); // We do not find the 'many' folder in the 'test_dir' folder
});

test('test_show_files_by_invert_regex', async () => {
  let output = await buildCommand(['-c', '-f', '-v', 'e', 'tests/test_dir2']);
  // There are 0 files without 'e' in the name
  expect(output).toContain('0 ┌── test_dir2');

  output = await buildCommand(['-c', '-f', '-v', 'a', 'tests/test_dir2']);
  // There are 2 files without 'a' in the name
  expect(output).toContain('2 ┌─┴ test_dir2');

  // There are 4 files in the test_dir2 hierarchy
  output = await buildCommand(['-c', '-f', '-v', 'match_nothing$', 'tests/test_dir2']);
  expect(output).toContain('4 ┌─┴ test_dir2');
});

test('test_show_files_by_invert_regex_match_multiple', async () => {
  // We ignore test_dir2 & test_dir_unicode, leaving the test_dir folder
  // which has the 'many' folder inside
  const output = await buildCommand([
    '-c',
    '-v',
    'test_dir2',
    '-v',
    'test_dir_unicode',
    '-n',
    '100',
    'tests',
  ]);
  expect(output).not.toContain('test_dir2');
  expect(output).not.toContain('test_dir_unicode');
  expect(output).toContain('many');
});

test('test_no_color', async () => {
  const output = await buildCommand(['-c']);
  // Red is 31
  expect(output).not.toContain('\x1B[31m');
  expect(output).not.toContain('\x1B[0m');
});

test('test_force_color', async () => {
  const output = await buildCommand(['-C']);
  // Red is 31
  expect(output).toContain('\x1B[31m');
  expect(output).toContain('\x1B[0m');
});

test('test_collapse', async () => {
  const output = await buildCommand(['--collapse', 'many', 'tests/test_dir/']);
  expect(output).toContain('many');
  expect(output).not.toContain('hello_file');
});

// Unix only: on windows the metadata time is a FILETIME (100ns ticks since
// 1601), not a unix epoch, so `-m` panics in getPrettyFileModifiedTime.
// That is pre-existing and unrelated to this fix.
test('test_show_files_by_type_with_filetime', UNIX_ONLY, async () => {
  // When grouping by file type and showing file times, the 'size' of a group is
  // a timestamp: it must be the newest file's time, not the sum of the times.
  const dir = tempdir();

  // Midday UTC, so the year is the same in every timezone
  for (const epochSeconds of [1593604800, 1625140800, 1656676800]) {
    const file = path.join(dir, `${String(epochSeconds)}.log`);
    fs.writeFileSync(file, '');
    fs.utimesSync(file, new Date(epochSeconds * 1000), new Date(epochSeconds * 1000));
  }

  const output = await buildCommand(['-c', '-t', '-m', 'm', dir]);

  // 1656676800 is 2022-07-01, the newest of the three
  expect(output, output).toContain('2022-07-0');
  expect(output, output).not.toContain('2020-07-0');
  expect(output, output).not.toContain('2021-07-0');
});

test('test_handle_duplicate_names', async () => {
  // Check that even if we run on a multiple directories with the same name
  // we still show the distinct parent dir in the output
  const output = await buildCommand([
    'tests/test_dir_matching/dave/dup_name',
    'tests/test_dir_matching/andy/dup_name',
    'config',
  ]);
  expect(output).toContain('andy');
  expect(output).toContain('dave');
  expect(output).toContain('config');
  expect(output).toContain('dup_name');
  expect(output).not.toContain('test_dir_matching');
});
