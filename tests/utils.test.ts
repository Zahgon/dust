import { expect, test } from 'vitest';

import { isAParentOf, simplifyDirNames } from '../src/utils.ts';

/** `HashSet<PathBuf>` compares by components, so the assertions do too. */
function asSet(dirs: readonly string[]): Set<string> {
  return new Set(dirs);
}

test('test_simplify_dir', () => {
  const correct = asSet(['a']);
  expect(simplifyDirNames(['a'])).toEqual(correct);
});

test('test_simplify_dir_rm_subdir', () => {
  const correct = asSet(['a/b']);
  expect(simplifyDirNames(['a/b/c', 'a/b', 'a/b/d/f'])).toEqual(correct);
  expect(simplifyDirNames(['a/b', 'a/b/c', 'a/b/d/f'])).toEqual(correct);
});

test('test_simplify_dir_duplicates', () => {
  const correct = asSet(['a/b', 'c']);
  expect(
    simplifyDirNames(['a/b', 'a/b//', 'a/././b///', 'c', 'c/', 'c/.', 'c/././', 'c/././.']),
  ).toEqual(correct);
});

test('test_simplify_dir_rm_subdir_and_not_substrings', () => {
  const correct = asSet(['b', 'c/a/b', 'a/b']);
  expect(simplifyDirNames(['a/b', 'c/a/b/', 'b'])).toEqual(correct);
});

test('test_simplify_dir_dots', () => {
  const correct = asSet(['src']);
  expect(simplifyDirNames(['src/.'])).toEqual(correct);
});

test('test_simplify_dir_substring_names', () => {
  const correct = asSet(['src', 'src_v2']);
  expect(simplifyDirNames(['src/', 'src_v2'])).toEqual(correct);
});

test('test_is_a_parent_of', () => {
  expect(isAParentOf('/usr', '/usr/andy')).toBe(true);
  expect(isAParentOf('/usr', '/usr/andy/i/am/descendant')).toBe(true);
  expect(isAParentOf('/usr', '/usr/.')).toBe(false);
  expect(isAParentOf('/usr', '/usr/')).toBe(false);
  expect(isAParentOf('/usr', '/usr')).toBe(false);
  expect(isAParentOf('/usr/', '/usr')).toBe(false);
  expect(isAParentOf('/usr/andy', '/usr')).toBe(false);
  expect(isAParentOf('/usr/andy', '/usr/sibling')).toBe(false);
  expect(isAParentOf('/usr/folder', '/usr/folder_not_a_child')).toBe(false);
});

test('test_is_a_parent_of_root', () => {
  expect(isAParentOf('/', '/usr/andy')).toBe(true);
  expect(isAParentOf('/', '/usr')).toBe(true);
  expect(isAParentOf('/', '/')).toBe(false);
});
