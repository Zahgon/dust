import { describe, expect, test } from 'vitest';

import * as ansi from '../../src/deps/ansi.ts';
import { Indicator, LsColors, styleFromAnsiSequence, type FileFacts } from '../../src/deps/lscolors.ts';

function facts(overrides: Partial<FileFacts>): FileFacts {
  return {
    isFile: false,
    isDirectory: false,
    isSymbolicLink: false,
    isFIFO: false,
    isSocket: false,
    isBlockDevice: false,
    isCharacterDevice: false,
    mode: 0o644,
    nlink: 1,
    ...overrides,
  };
}

function paint(colors: LsColors, path: string, f: FileFacts | null): string {
  return ansi.paint(colors.styleForPathWithMetadata(path, f) ?? ansi.PLAIN, 'x');
}

/**
 * The expected escape sequences were read off the original binary running with
 * `-C` over a directory of one file of each type, so they pin the crate's
 * built-in defaults — which are *not* GNU's: `pi` is `33`, and `bd`/`cd` are
 * `01;33`.
 */
describe('lscolors', () => {
  test('the built-in defaults colour each file type', () => {
    const colors = LsColors.default();
    expect(paint(colors, 'sub', facts({ isDirectory: true, mode: 0o755 }))).toBe('\x1b[1;34mx\x1b[0m');
    expect(paint(colors, 'exe', facts({ isFile: true, mode: 0o755 }))).toBe('\x1b[1;32mx\x1b[0m');
    expect(paint(colors, 'fifo', facts({ isFIFO: true }))).toBe('\x1b[33mx\x1b[0m');
    expect(paint(colors, 'sock', facts({ isSocket: true }))).toBe('\x1b[1;35mx\x1b[0m');
    expect(paint(colors, 'null', facts({ isCharacterDevice: true }))).toBe('\x1b[1;33mx\x1b[0m');
  });

  test('a plain file gets no escape at all', () => {
    const colors = LsColors.default();
    expect(paint(colors, 'plain.txt', facts({ isFile: true, mode: 0o644 }))).toBe('x');
  });

  test('setuid, sticky and other-writable beat the plain type', () => {
    const colors = LsColors.default();
    expect(paint(colors, 'suid', facts({ isFile: true, mode: 0o4755 }))).toBe('\x1b[41;37mx\x1b[0m');
    expect(paint(colors, 'sgid', facts({ isFile: true, mode: 0o2755 }))).toBe('\x1b[43;30mx\x1b[0m');
    expect(paint(colors, 'sticky', facts({ isDirectory: true, mode: 0o1755 }))).toBe(
      '\x1b[44;37mx\x1b[0m',
    );
    expect(paint(colors, 'ow', facts({ isDirectory: true, mode: 0o757 }))).toBe(
      '\x1b[42;34mx\x1b[0m',
    );
    expect(paint(colors, 'tw', facts({ isDirectory: true, mode: 0o1777 }))).toBe(
      '\x1b[42;30mx\x1b[0m',
    );
  });

  test('LS_COLORS overrides one indicator and leaves the rest', () => {
    const colors = LsColors.fromString('di=38;5;27');
    expect(paint(colors, 'sub', facts({ isDirectory: true, mode: 0o755 }))).toBe(
      '\x1b[38;5;27mx\x1b[0m',
    );
    expect(paint(colors, 'exe', facts({ isFile: true, mode: 0o755 }))).toBe('\x1b[1;32mx\x1b[0m');
  });

  test('suffix matching is ASCII case-insensitive', () => {
    const colors = LsColors.fromString('*.txt=01;31');
    expect(paint(colors, 'lower.txt', facts({ isFile: true }))).toBe('\x1b[1;31mx\x1b[0m');
    expect(paint(colors, 'UPPER.TXT', facts({ isFile: true }))).toBe('\x1b[1;31mx\x1b[0m');

    const upper = LsColors.fromString('*.TXT=01;31');
    expect(paint(upper, 'lower.txt', facts({ isFile: true }))).toBe('\x1b[1;31mx\x1b[0m');
  });

  test('two spellings with different styles turn matching case-sensitive', () => {
    const colors = LsColors.fromString('*README=01;31:*readme=01;32');
    expect(paint(colors, 'README', facts({ isFile: true }))).toBe('\x1b[1;31mx\x1b[0m');
    expect(paint(colors, 'readme', facts({ isFile: true }))).toBe('\x1b[1;32mx\x1b[0m');
  });

  test('the last matching suffix wins, not the longest', () => {
    const gzLast = LsColors.fromString('*.tar.gz=01;33:*.gz=01;31');
    expect(paint(gzLast, 'bar.tar.gz', facts({ isFile: true }))).toBe('\x1b[1;31mx\x1b[0m');

    const tarGzLast = LsColors.fromString('*.gz=01;31:*.tar.gz=01;33');
    expect(paint(tarGzLast, 'bar.tar.gz', facts({ isFile: true }))).toBe('\x1b[1;33mx\x1b[0m');
  });

  test('no metadata falls back to the suffix map alone', () => {
    const colors = LsColors.fromString('*.txt=01;31');
    expect(paint(colors, 'orphan.txt', null)).toBe('\x1b[1;31mx\x1b[0m');
    expect(paint(colors, 'orphan', null)).toBe('x');
  });

  test('styleFromAnsiSequence parses the forms LS_COLORS uses', () => {
    expect(styleFromAnsiSequence('')).toBe(null);
    expect(styleFromAnsiSequence('0')).toBe(null);
    expect(styleFromAnsiSequence('00')).toBe(null);
    expect(styleFromAnsiSequence('01;34')).toMatchObject({ bold: true, foreground: ansi.Blue });
    expect(styleFromAnsiSequence('30;42')).toMatchObject({
      foreground: ansi.Black,
      background: ansi.Green,
    });
    expect(styleFromAnsiSequence('38;5;27')).toMatchObject({ foreground: ansi.fixed(27) });
    expect(styleFromAnsiSequence('38;2;1;2;3')).toMatchObject({ foreground: ansi.rgb(1, 2, 3) });
    expect(styleFromAnsiSequence('90')).toMatchObject({ foreground: ansi.fixed(8) });
    expect(styleFromAnsiSequence('nonsense')).toBe(null);
  });

  test('an explicit reset removes an indicator', () => {
    const colors = LsColors.fromString('di=');
    expect(colors.hasExplicitStyleFor(Indicator.Directory)).toBe(false);
    expect(paint(colors, 'sub', facts({ isDirectory: true, mode: 0o755 }))).toBe('x');
  });
});
