import { expect, test } from 'vitest';

import type { DisplayData, DrawData, InitialDisplayData } from '../src/display.ts';
import {
  formatString,
  generateBar,
  getPrettyFileModifiedTime,
  humanReadableNumber,
} from '../src/display.ts';
import type { DisplayNode } from '../src/displayNode.ts';
import { LsColors } from '../src/deps/lscolors.ts';
import { strWidth } from '../src/deps/unicodeWidth.ts';

function getFakeDisplayData(longestStringLength: number): DisplayData {
  const initial: InitialDisplayData = {
    shortPaths: true,
    isReversed: false,
    colorsOn: false,
    dim: false,
    byFilecount: false,
    byFiletime: null,
    isScreenReader: false,
    outputFormat: '',
    barsOnRight: false,
  };
  return {
    initial,
    numCharsNeededOnLeftMost: 5,
    baseSize: 2 ** 12, // 4.0K
    longestStringLength,
    lsColors: LsColors.fromEnvOrDefault(process.env),
  };
}

function buildDrawData(disp: DisplayData, size: number): [DrawData, DisplayNode] {
  const n: DisplayNode = { name: '/short', size: 2 ** size, children: [] };
  const firstSizeBar = '█'.repeat(13);
  const dd: DrawData = { indent: '', percentBar: firstSizeBar, displayData: disp };
  return [dd, n];
}

/** `Local.with_ymd_and_hms(..).timestamp()`. */
function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute, second, 0).getTime() / 1000);
}

test('test_format_str', () => {
  const n: DisplayNode = {
    name: '/short',
    size: 2 ** 12, // This is 4.0K
    children: [],
  };
  const indent = '┌─┴';
  const percentBar = '';
  const isBiggest = false;
  const data = getFakeDisplayData(20);

  const s = formatString(n, indent, percentBar, isBiggest, data);
  expect(s).toBe('4.0Ki ┌─┴ short');
});

test('test_format_str_long_name', () => {
  const name =
    'very_long_name_longer_than_the_eighty_character_limit_very_long_name_this_bit_will_truncate';
  const n: DisplayNode = { name, size: 2 ** 12, children: [] };
  const indent = '┌─┴';
  const percentBar = '';
  const isBiggest = false;

  const data = getFakeDisplayData(64);
  const s = formatString(n, indent, percentBar, isBiggest, data);
  expect(s).toBe(
    '4.0Ki ┌─┴ very_long_name_longer_than_the_eighty_character_limit_very_..',
  );
});

test('test_format_str_long_name_wide_chars', () => {
  // Wide (2 column) characters must be truncated by display width, not by
  // char count, otherwise the line overflows the terminal.
  const name = 'ラウトは難しいですラウトは難しいですラウトは難しいです';
  const n: DisplayNode = { name, size: 2 ** 12, children: [] };
  const indent = '┌─┴';
  const percentBar = '';
  const isBiggest = false;

  // longest_string_length of 20 leaves 20 - 3 = 17 columns for the name,
  // of which 2 are the '..' marker: 7 wide chars (14 cols) then '..'
  const data = getFakeDisplayData(20);
  const s = formatString(n, indent, percentBar, isBiggest, data);
  expect(s).toBe('4.0Ki ┌─┴ ラウトは難しい..');
  expect(strWidth(s)).toBe(26);
});

test('test_format_str_screen_reader', () => {
  const n: DisplayNode = {
    name: '/short',
    size: 2 ** 12, // This is 4.0K
    children: [],
  };
  const indent = '';
  const percentBar = '3';
  const isBiggest = false;
  const data = getFakeDisplayData(20);
  data.initial.isScreenReader = true;

  const s = formatString(n, indent, percentBar, isBiggest, data);
  expect(s).toBe('short               3 4.0Ki 100%');
});

test('test_machine_readable_filecount', () => {
  expect(humanReadableNumber(1, 'count')).toBe('1');
  expect(humanReadableNumber(1000, 'count')).toBe('1000');
  expect(humanReadableNumber(1024, 'count')).toBe('1024');
});

test('test_human_readable_number', () => {
  expect(humanReadableNumber(1, '')).toBe('1B');
  expect(humanReadableNumber(956, '')).toBe('956B');
  expect(humanReadableNumber(1004, '')).toBe('1004B');
  expect(humanReadableNumber(1024, '')).toBe('1.0Ki');
  expect(humanReadableNumber(1536, '')).toBe('1.5Ki');
  expect(humanReadableNumber(1024 * 512, '')).toBe('512Ki');
  expect(humanReadableNumber(1024 * 1024, '')).toBe('1.0Mi');
  expect(humanReadableNumber(1024 * 1024 * 1024 - 1, '')).toBe('1023Mi');
  expect(humanReadableNumber(1024 * 1024 * 1024 * 20, '')).toBe('20Gi');
  expect(humanReadableNumber(1024 * 1024 * 1024 * 1024, '')).toBe('1.0Ti');
  expect(humanReadableNumber(1024 * 1024 * 1024 * 1024 * 234, '')).toBe('234Ti');
  expect(humanReadableNumber(1024 * 1024 * 1024 * 1024 * 1024, '')).toBe('1.0Pi');
});

test('test_human_readable_number_si', () => {
  expect(humanReadableNumber(1024 * 100, '')).toBe('100Ki');
  expect(humanReadableNumber(1024 * 100, 'si')).toBe('102K');
});

// Refer to https://en.wikipedia.org/wiki/Byte#Multiple-byte_units
test('test_human_readable_number_kb', () => {
  const hrn = humanReadableNumber;
  expect(hrn(1023, 'b')).toBe('1023B');
  expect(hrn(1000 * 1000, 'bytes')).toBe('1000000B');
  expect(hrn(1023, 'kb')).toBe('1K');
  expect(hrn(1023, 'k')).toBe('0Ki');
  expect(hrn(1023, 'kib')).toBe('0Ki');
  expect(hrn(1024, 'kib')).toBe('1Ki');
  expect(hrn(1024 * 512, 'kib')).toBe('512Ki');
  expect(hrn(1024 * 1024, 'kib')).toBe('1024Ki');
  expect(hrn(1024 * 1000 * 1000 * 20, 'kib')).toBe('20000000Ki');
  expect(hrn(1024 * 1024 * 1000 * 20, 'mib')).toBe('20000Mi');
  expect(hrn(1024 * 1024 * 1024 * 20, 'gib')).toBe('20Gi');
});

test('test_draw_data', () => {
  const disp = getFakeDisplayData(20);
  const [dd, n] = buildDrawData(disp, 12);
  const bar = generateBar(dd, n, 1);
  expect(bar).toBe('█████████████');
});

test('test_draw_data2', () => {
  const disp = getFakeDisplayData(20);
  const [dd, n] = buildDrawData(disp, 11);
  const bar = generateBar(dd, n, 2);
  expect(bar).toBe('███████░░░░░░');
});

test('test_draw_data3', () => {
  const disp = getFakeDisplayData(20);
  let [dd, n] = buildDrawData(disp, 11);
  let bar = generateBar(dd, n, 3);
  expect(bar).toBe('███████▒▒▒▒▒▒');

  disp.initial.barsOnRight = true;
  [dd, n] = buildDrawData(disp, 11);
  bar = generateBar(dd, n, 3);
  expect(bar).toBe('▒▒▒▒▒▒███████');
});

test('test_draw_data4', () => {
  const disp = getFakeDisplayData(20);
  const [dd, n] = buildDrawData(disp, 10);
  // After 4 we have no more levels of shading so 4+ is the same
  let bar = generateBar(dd, n, 4);
  expect(bar).toBe('████▓▓▓▓▓▓▓▓▓');
  bar = generateBar(dd, n, 5);
  expect(bar).toBe('████▓▓▓▓▓▓▓▓▓');
});

test('test_get_pretty_file_modified_time', () => {
  // Create a timestamp for 2023-07-12 00:00:00 in local time
  let timestamp = localTimestamp(2023, 7, 12, 0, 0, 0);
  expect(getPrettyFileModifiedTime(timestamp)).toBe('2023-07-12T00:00:00');

  // Test another timestamp
  timestamp = localTimestamp(2020, 1, 1, 12, 0, 0);
  expect(getPrettyFileModifiedTime(timestamp)).toBe('2020-01-01T12:00:00');

  // Test timestamp for epoch start (1970-01-01T00:00:00)
  timestamp = localTimestamp(1970, 1, 1, 0, 0, 0);
  expect(getPrettyFileModifiedTime(timestamp)).toBe('1970-01-01T00:00:00');

  // Test a future timestamp
  timestamp = localTimestamp(2030, 12, 25, 6, 30, 0);
  expect(getPrettyFileModifiedTime(timestamp)).toBe('2030-12-25T06:30:00');
});

/**
 * The percent column beside a bar, which the ported suite never asserted: the
 * exact-output fixtures that carry a fraction other than 0% or 100% are the
 * ubuntu ones, and they do not match on every filesystem. Mutation testing
 * found the gap — replacing the `{:.0}` rounding with `Math.ceil` left the
 * whole suite green.
 *
 * A ratio of n/8 lands exactly on .5, where Rust rounds to **even**: the
 * original prints 12%, 38%, 62% and 88%, not 13%, 38%, 63% and 88%.
 */
test('percent_column_rounds_half_to_even', () => {
  const percentOf = (size: number, base: number): string => {
    const data = getFakeDisplayData(20);
    data.baseSize = base;
    const n: DisplayNode = { name: '/short', size, children: [] };
    return formatString(n, '┌─┴', '████████', false, data);
  };

  expect(percentOf(1, 8)).toBe('   1B ┌─┴ short           │████████ │  12%');
  expect(percentOf(3, 8)).toBe('   3B ┌─┴ short           │████████ │  38%');
  expect(percentOf(5, 8)).toBe('   5B ┌─┴ short           │████████ │  62%');
  expect(percentOf(7, 8)).toBe('   7B ┌─┴ short           │████████ │  88%');
  expect(percentOf(1, 3)).toBe('   1B ┌─┴ short           │████████ │  33%');
  expect(percentOf(2, 3)).toBe('   2B ┌─┴ short           │████████ │  67%');
  expect(percentOf(8, 8)).toBe('   8B ┌─┴ short           │████████ │ 100%');
});

/** A size of zero over a base of zero is `0.0`, not NaN — `f32::is_normal`. */
test('percent_column_of_an_empty_tree', () => {
  const data = getFakeDisplayData(20);
  data.baseSize = 0;
  const n: DisplayNode = { name: '/short', size: 0, children: [] };
  expect(formatString(n, '┌─┴', '████████', false, data)).toBe(
    '   0B ┌─┴ short           │████████ │   0%',
  );
});
