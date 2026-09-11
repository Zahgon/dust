import { describe, expect, test } from 'vitest';

import {
  compareBytes,
  comparePaths,
  components,
  extension,
  fileName,
  fromComponents,
  isAbsolute,
  join,
  parent,
  pathKey,
  startsWith,
  stripPrefix,
} from '../../src/deps/rustPath.ts';

/**
 * `std::path` was a dependency of the original in everything but name: its
 * component-wise equality and ordering decide which nodes are deduplicated and
 * which order equal-sized entries print in. None of it is JavaScript's default
 * string behaviour, so it all needs its own tests.
 */
describe('rustPath', () => {
  test('components folds separators and interior dots', () => {
    expect(fromComponents(components('a//b/./c/'))).toBe('a/b/c');
    expect(fromComponents(components('/tmp//test_dir/'))).toBe('/tmp/test_dir');
    expect(fromComponents(components('c/././.'))).toBe('c');
    expect(fromComponents(components('src/.'))).toBe('src');
  });

  test('a leading dot survives but every other one does not', () => {
    expect(fromComponents(components('./a/b'))).toBe('./a/b');
    expect(fromComponents(components('a/./b'))).toBe('a/b');
    expect(fromComponents(components('.'))).toBe('.');
  });

  test('parent directory components are kept', () => {
    expect(fromComponents(components('a/../b'))).toBe('a/../b');
  });

  test('pathKey is the equality Rust uses for a HashSet<PathBuf>', () => {
    expect(pathKey('a/b')).toBe(pathKey('a//b/.'));
    expect(pathKey('./a')).not.toBe(pathKey('a'));
  });

  test('startsWith compares components, not characters', () => {
    expect(startsWith('/usr/andy', '/usr')).toBe(true);
    expect(startsWith('/usr/folder_not_a_child', '/usr/folder')).toBe(false);
    expect(startsWith('/usr', '/usr/')).toBe(true);
  });

  test('parent and stripPrefix produce the short display name', () => {
    expect(parent('/short')).toBe('/');
    expect(parent('a')).toBe('');
    expect(parent('/')).toBe(null);
    expect(stripPrefix('/tmp/test_dir', '/tmp')).toBe('test_dir');
    expect(stripPrefix('/short', '/')).toBe('short');
    expect(stripPrefix('short', '')).toBe('short');
  });

  test('fileName is null unless the last component is a normal one', () => {
    expect(fileName('a/b.txt')).toBe('b.txt');
    expect(fileName('a/b/')).toBe('b');
    expect(fileName('a/..')).toBe(null);
    expect(fileName('/')).toBe(null);
  });

  test('extension skips a leading dot with no other dot', () => {
    expect(extension('files_from.txt')).toBe('txt');
    expect(extension('.hidden_file')).toBe(null);
    expect(extension('a_file')).toBe(null);
    expect(extension('.a.b')).toBe('b');
    expect(extension('👩.unicode')).toBe('unicode');
  });

  test('join lets an absolute argument win', () => {
    expect(join('a', 'b')).toBe('a/b');
    expect(join('a/', 'b')).toBe('a/b');
    expect(join('a', '/b')).toBe('/b');
    expect(join('', 'b')).toBe('b');
  });

  test('isAbsolute', () => {
    expect(isAbsolute('/a')).toBe(true);
    expect(isAbsolute('a')).toBe(false);
  });

  test('paths order by component, which is not string order', () => {
    // As strings, "a.txt" < "a/b" because '.' < '/'; as paths it is the reverse,
    // because the first component "a" is compared against "a.txt".
    expect(comparePaths('a/b', 'a.txt')).toBeLessThan(0);
    expect('a/b' < 'a.txt').toBe(false);
    expect(comparePaths('a', 'a/b')).toBeLessThan(0);
    expect(comparePaths('src', 'src_v2')).toBeLessThan(0);
    expect(comparePaths('/a', 'a')).toBeLessThan(0);
  });

  test('names order by UTF-8 bytes, which is not UTF-16 order', () => {
    // U+FF01 is three UTF-8 bytes starting ef; U+1F469 is four starting f0.
    expect(compareBytes('！', '👩')).toBeLessThan(0);
    // JavaScript's own comparison disagrees, because a high surrogate is 0xD83D.
    expect('！' < '👩').toBe(false);
    expect(compareBytes('ラウトは難しいです！.japan', '👩.unicode')).toBeLessThan(0);
    expect(compareBytes('a', 'a')).toBe(0);
    expect(compareBytes('a', 'ab')).toBeLessThan(0);
  });
});
