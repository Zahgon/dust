import { expect, test } from 'vitest';

import type { Cli } from '../src/cli.ts';
import { parseCliFrom } from '../src/cli.ts';
import type { Config } from '../src/config.ts';
import {
  convertMinSize,
  defaultConfig,
  getConfigLocations,
  getCurrentDateEpochSeconds,
  getDepth,
  getFiletime,
  getNumberOfLines,
  getOutputJson,
  internalGetMinSize,
  USIZE_MAX,
} from '../src/config.ts';
import { FileTime } from '../src/node.ts';
import { join } from '../src/deps/rustPath.ts';

function getArgs(args: string[]): Cli {
  return parseCliFrom(args);
}

function getFiletimeArgs(args: string[]): Cli {
  return parseCliFrom(args);
}

test('config_locations_use_xdg_config_home', () => {
  const home = '/home/test';
  const configHome = '/tmp/config';

  expect(getConfigLocations(home, configHome)).toEqual([
    join(home, '.dust.toml'),
    '/tmp/config/dust/config.toml',
  ]);
  expect(getConfigLocations(home, undefined)).toEqual([
    join(home, '.dust.toml'),
    join(home, '.config/dust/config.toml'),
  ]);
});

test('test_get_current_date_epoch_seconds', () => {
  const epochSeconds = getCurrentDateEpochSeconds();
  const dt = new Date(epochSeconds * 1000);
  const now = new Date();

  expect(dt.getHours()).toBe(0);
  expect(dt.getMinutes()).toBe(0);
  expect(dt.getSeconds()).toBe(0);
  expect(dt.getDate()).toBe(now.getDate());
  expect(dt.getMonth()).toBe(now.getMonth());
  expect(dt.getFullYear()).toBe(now.getFullYear());
});

test('test_conversion', () => {
  expect(convertMinSize('55')).toBe(55);
  expect(convertMinSize('12344321')).toBe(12344321);
  expect(convertMinSize('95RUBBISH')).toBe(null);
  expect(convertMinSize('10Ki')).toBe(10 * 1024);
  expect(convertMinSize('10MiB')).toBe(10 * 1024 ** 2);
  expect(convertMinSize('10M')).toBe(10 * 1024 ** 2);
  expect(convertMinSize('10Mb')).toBe(10 * 1000 ** 2);
  expect(convertMinSize('2Gi')).toBe(2 * 1024 ** 3);
});

test('test_min_size_from_config_applied_or_overridden', () => {
  const c: Config = { minSize: '1KiB' };
  expect(internalGetMinSize(c, undefined)).toBe(1024);
  expect(internalGetMinSize(c, '2KiB')).toBe(2048);

  expect(internalGetMinSize(c, '1kb')).toBe(1000);
  expect(internalGetMinSize(c, '2KB')).toBe(2000);
});

test('test_get_depth', () => {
  // No config and no flag.
  let c = defaultConfig();
  let args = getArgs([]);
  expect(getDepth(c, args)).toBe(USIZE_MAX);

  // Config is not defined and flag is defined.
  c = defaultConfig();
  args = getArgs(['dust', '--depth', '5']);
  expect(getDepth(c, args)).toBe(5);

  // Config is defined and flag is not defined.
  c = { depth: 3 };
  args = getArgs([]);
  expect(getDepth(c, args)).toBe(3);

  // Both config and flag are defined.
  c = { depth: 3 };
  args = getArgs(['dust', '--depth', '5']);
  expect(getDepth(c, args)).toBe(5);
});

test('test_get_filetime', () => {
  // No config and no flag.
  let c = defaultConfig();
  let args = getFiletimeArgs(['dust']);
  expect(getFiletime(c, args)).toBe(null);

  // Config is not defined and flag is defined as access time
  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'a']);
  expect(getFiletime(c, args)).toBe(FileTime.Accessed);

  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'accessed']);
  expect(getFiletime(c, args)).toBe(FileTime.Accessed);

  // Config is not defined and flag is defined as modified time
  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'm']);
  expect(getFiletime(c, args)).toBe(FileTime.Modified);

  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'modified']);
  expect(getFiletime(c, args)).toBe(FileTime.Modified);

  // Config is not defined and flag is defined as changed time
  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'c']);
  expect(getFiletime(c, args)).toBe(FileTime.Changed);

  c = defaultConfig();
  args = getFiletimeArgs(['dust', '--filetime', 'changed']);
  expect(getFiletime(c, args)).toBe(FileTime.Changed);
});

test('test_get_number_of_lines', () => {
  // No config and no flag.
  let c = defaultConfig();
  let args = getArgs([]);
  expect(getNumberOfLines(c, args)).toBe(undefined);

  // Config is not defined and flag is defined.
  c = defaultConfig();
  args = getArgs(['dust', '--number-of-lines', '5']);
  expect(getNumberOfLines(c, args)).toBe(5);

  // Config is defined and flag is not defined.
  c = { numberOfLines: 3 };
  args = getArgs([]);
  expect(getNumberOfLines(c, args)).toBe(3);

  // Both config and flag are defined.
  c = { numberOfLines: 3 };
  args = getArgs(['dust', '--number-of-lines', '5']);
  expect(getNumberOfLines(c, args)).toBe(5);
});

test('test_get_number_of_lines_with_output_json', () => {
  // Json output and no number-of-lines: main defaults this to usize::MAX.
  let c = defaultConfig();
  let args = getArgs(['dust', '--output-json']);
  expect(getOutputJson(c, args)).toBe(true);
  expect(getNumberOfLines(c, args)).toBe(undefined);

  // Json output from config and no number-of-lines.
  c = { outputJson: true };
  args = getArgs([]);
  expect(getOutputJson(c, args)).toBe(true);
  expect(getNumberOfLines(c, args)).toBe(undefined);

  // An explicit number-of-lines still wins over the json default.
  c = defaultConfig();
  args = getArgs(['dust', '--output-json', '--number-of-lines', '5']);
  expect(getOutputJson(c, args)).toBe(true);
  expect(getNumberOfLines(c, args)).toBe(5);

  // A number-of-lines from the config file also wins.
  c = { numberOfLines: 3 };
  args = getArgs(['dust', '--output-json']);
  expect(getOutputJson(c, args)).toBe(true);
  expect(getNumberOfLines(c, args)).toBe(3);
});
