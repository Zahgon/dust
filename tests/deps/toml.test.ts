import { describe, expect, test } from 'vitest';

import { parseToml, TomlError } from '../../src/deps/toml.ts';

function value(text: string, key: string): unknown {
  return parseToml(text).get(key)?.value;
}

/**
 * The config reader stands in for `config-file` + `toml` + `serde`. What
 * matters observably is that a malformed file *fails*, because that is what
 * makes dust print `Ignoring invalid config file` instead of applying half of
 * it.
 */
describe('toml', () => {
  test('reads the shipped sample config', () => {
    const table = parseToml(`
# Sample Config file, works with toml and yaml
reverse=true
display-full-paths=true
output-format="si"
number-of-lines=5
collapse=[".git"]
`);
    expect(table.get('reverse')).toEqual({ kind: 'boolean', value: true });
    expect(table.get('output-format')).toEqual({ kind: 'string', value: 'si' });
    expect(table.get('number-of-lines')).toEqual({ kind: 'integer', value: 5 });
    expect(table.get('collapse')).toEqual({
      kind: 'array',
      value: [{ kind: 'string', value: '.git' }],
    });
  });

  test('scalars', () => {
    expect(value('a = 1', 'a')).toBe(1);
    expect(value('a = -1', 'a')).toBe(-1);
    expect(value('a = 1_000', 'a')).toBe(1000);
    expect(value('a = 0x10', 'a')).toBe(16);
    expect(value('a = 0o17', 'a')).toBe(15);
    expect(value('a = 0b101', 'a')).toBe(5);
    expect(value('a = 1.5', 'a')).toBe(1.5);
    expect(value('a = 1e3', 'a')).toBe(1000);
    expect(value('a = true', 'a')).toBe(true);
    expect(value('a = false', 'a')).toBe(false);
  });

  test('strings', () => {
    expect(value('a = "x\\ty"', 'a')).toBe('x\ty');
    expect(value("a = 'x\\ty'", 'a')).toBe('x\\ty');
    expect(value('a = "\\u0041"', 'a')).toBe('A');
    expect(value('a = """\nline\n"""', 'a')).toBe('line\n');
    expect(value("a = '''\nline\n'''", 'a')).toBe('line\n');
  });

  test('tables and dotted keys', () => {
    const table = parseToml('[section]\nkey = 1\n');
    const section = table.get('section');
    expect(section?.kind).toBe('table');
    expect((section?.value as Map<string, unknown>).get('key')).toEqual({
      kind: 'integer',
      value: 1,
    });

    const dotted = parseToml('a.b = 2');
    const a = dotted.get('a');
    expect((a?.value as Map<string, unknown>).get('b')).toEqual({ kind: 'integer', value: 2 });
  });

  test('inline tables and arrays of tables', () => {
    expect(parseToml('a = { b = 1 }').get('a')?.kind).toBe('table');
    const arrays = parseToml('[[a]]\nb = 1\n[[a]]\nb = 2\n').get('a');
    expect(arrays?.kind).toBe('array');
    expect((arrays?.value as unknown[]).length).toBe(2);
  });

  test('comments and blank lines are ignored', () => {
    expect(value('# note\n\na = 1 # trailing\n', 'a')).toBe(1);
  });

  test('a datetime is kept as text', () => {
    expect(value('a = 1979-05-27', 'a')).toBe('1979-05-27');
  });

  test('malformed input throws', () => {
    for (const bad of [
      'a',
      'a =',
      'a = "unterminated',
      'a = [1, 2',
      'a = 1\na = 2',
      '[section',
      'a = @',
      'a = 1 b = 2',
      'a = "\\q"',
      // Inline tables have their own key/value loop, and it must reject too.
      'a = { b 1 }',
      'a = { b = }',
      'a = { b = 1',
      'a = { b = 1, }',
      'a = { b\n',
      '[[a]\nb = 1',
    ]) {
      expect(() => parseToml(bad), bad).toThrow(TomlError);
    }
  });
});
