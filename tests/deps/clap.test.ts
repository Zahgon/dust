import { describe, expect, test } from 'vitest';

import { COMMAND, parseCli } from '../../src/cli.ts';
import { ClapExit, jaro } from '../../src/deps/clap.ts';

/** Run the parser and return the `ClapExit` it threw, or null on success. */
function exitOf(argv: string[]): ClapExit | null {
  try {
    parseCli(argv);
    return null;
  } catch (error) {
    if (error instanceof ClapExit) return error;
    throw error;
  }
}

function stderrOf(argv: string[]): string {
  const exit = exitOf(argv);
  expect(exit, argv.join(' ')).not.toBe(null);
  expect(exit?.stream).toBe('stderr');
  expect(exit?.code).toBe(2);
  return exit?.text ?? '';
}

/**
 * The CLI surface is the strictest requirement in the migration: the original's
 * `--help`, its errors and its exit codes are what a user and a script see.
 * These cases were captured from the clap 4.5 binary.
 */
describe('clap', () => {
  test('strsim::jaro, which is the metric clap suggests with', () => {
    expect(jaro('file', 'file')).toBe(1);
    expect(jaro('', 'x')).toBe(0);
    expect(jaro('abc', 'xyz')).toBe(0);
    expect(jaro('file', 'filter')).toBeCloseTo(0.8889, 4);
    expect(jaro('nope', 'no-percent-bars')).toBeCloseTo(0.7556, 4);
    // Below the 0.7 threshold, so it produces no tip.
    expect(jaro('nope', 'no-progress')).toBeLessThan(0.7);
  });

  test('--version prints the display name, not the binary name', () => {
    const exit = exitOf(['--version']);
    expect(exit?.code).toBe(0);
    expect(exit?.stream).toBe('stdout');
    expect(exit?.text).toBe('Dust 1.2.5\n');
  });

  test('the two help layouts differ in their own footer', () => {
    expect(COMMAND.longHelp()).toContain(
      "  -h, --help\n          Print help (see a summary with '-h')",
    );
    expect(COMMAND.shortHelp()).toContain(
      "  -h, --help                       Print help (see more with '--help')",
    );
    expect(COMMAND.longHelp()).toContain('Usage: dust [OPTIONS] [PATH]...');
  });

  test('long help spells out the possible values, short help inlines them', () => {
    expect(COMMAND.longHelp()).toContain(
      '          Possible values:\n          - si: SI prefix (powers of 1000)\n          - b:  byte (B)',
    );
    expect(COMMAND.shortHelp()).toContain('[possible values: si, b, k, m, g, t, kb, mb, gb, tb]');
  });

  test('an unknown long flag offers the closest match and a smart usage line', () => {
    expect(stderrOf(['--nope'])).toBe(
      "error: unexpected argument '--nope' found\n" +
        "\n  tip: a similar argument exists: '--no-percent-bars'\n" +
        '\nUsage: dust --no-percent-bars [PATH]...\n' +
        "\nFor more information, try '--help'.\n",
    );
  });

  test('an unknown short flag offers the -- escape and the plain usage line', () => {
    expect(stderrOf(['-Q'])).toBe(
      "error: unexpected argument '-Q' found\n" +
        "\n  tip: to pass '-Q' as a value, use '-- -Q'\n" +
        '\nUsage: dust [OPTIONS] [PATH]...\n' +
        "\nFor more information, try '--help'.\n",
    );
    // Even when other arguments were parsed first.
    expect(stderrOf(['-c=x'])).toContain('Usage: dust [OPTIONS] [PATH]...');
  });

  test('a missing value names the option and carries no usage line', () => {
    expect(stderrOf(['--depth'])).toBe(
      "error: a value is required for '--depth <DEPTH>' but none was supplied\n" +
        "\nFor more information, try '--help'.\n",
    );
    // A known flag in the value position blames the option...
    expect(stderrOf(['-d', '-c', '.'])).toContain("a value is required for '--depth <DEPTH>'");
    // ...an unknown token is reported as the unexpected argument it is.
    expect(stderrOf(['-d', '-1', '.'])).toContain("unexpected argument '-1' found");
  });

  test('a missing enum value still lists the possible values', () => {
    expect(stderrOf(['-o'])).toBe(
      "error: a value is required for '--output-format <FORMAT>' but none was supplied\n" +
        '  [possible values: si, b, k, m, g, t, kb, mb, gb, tb]\n' +
        "\nFor more information, try '--help'.\n",
    );
  });

  test('an invalid enum value lists the values and may suggest one', () => {
    expect(stderrOf(['-o', 'zzz', '.'])).toBe(
      "error: invalid value 'zzz' for '--output-format <FORMAT>'\n" +
        '  [possible values: si, b, k, m, g, t, kb, mb, gb, tb]\n' +
        "\nFor more information, try '--help'.\n",
    );
    expect(stderrOf(['-o', 'si=x', '.'])).toContain("tip: a similar value exists: 'si'");
  });

  test('usize parse failures keep their Rust wording', () => {
    expect(stderrOf(['-d', 'abc', '.'])).toContain(
      "invalid value 'abc' for '--depth <DEPTH>': invalid digit found in string",
    );
    expect(stderrOf(['-d', '99999999999999999999', '.'])).toContain(
      'number too large to fit in target type',
    );
  });

  test('conflicts name the argument given first', () => {
    expect(stderrOf(['-t', '-D', '.'])).toBe(
      "error: the argument '--file-types' cannot be used with '--only-dir'\n" +
        '\nUsage: dust --file-types <PATH>...\n' +
        "\nFor more information, try '--help'.\n",
    );
    expect(stderrOf(['-D', '-F', '.'])).toContain(
      "the argument '--only-dir' cannot be used with '--only-file'",
    );
    // The conflict graph is symmetric even though only one side declares it.
    expect(stderrOf(['-e', 'x', '-v', 'y', '.'])).toContain(
      "the argument '--filter <REGEX>' cannot be used with '--invert-filter <REGEX>'",
    );
  });

  test('several conflicts are listed in command-line order', () => {
    expect(stderrOf(['-t', '-D', '-d', '1', '.'])).toContain(
      "error: the argument '--file-types' cannot be used with:\n  --only-dir\n  --depth <DEPTH>",
    );
  });

  test('the positional becomes required in usage once it has been supplied', () => {
    expect(stderrOf(['-t', '-D', '.'])).toContain('Usage: dust --file-types <PATH>...');
    expect(stderrOf(['--files0-from', 'a', '--files-from', 'b'])).toContain(
      'Usage: dust --files0-from <FILES0_FROM> [PATH]...',
    );
  });

  test('repeating a single-use option is an error, repeating a Vec option is not', () => {
    expect(stderrOf(['-d', '1', '-d', '2', '.'])).toBe(
      "error: the argument '--depth <DEPTH>' cannot be used multiple times\n" +
        '\nUsage: dust [OPTIONS] [PATH]...\n' +
        "\nFor more information, try '--help'.\n",
    );
    expect(parseCli(['-e', 'a', '-e', 'b']).filter).toEqual(['a', 'b']);
    expect(parseCli(['-X', 'a', '-X', 'b']).ignoreDirectory).toEqual(['a', 'b']);
  });

  test('a long flag rejects an attached value; a short one swallows the token', () => {
    expect(stderrOf(['--no-colors=1'])).toContain(
      "error: unexpected value '1' for '--no-colors' found; no more were expected",
    );
    expect(stderrOf(['--help=x'])).toContain(
      "error: unexpected value 'x' for '--help' found; no more were expected",
    );
    expect(exitOf(['-h=x'])?.code).toBe(0);
    expect(exitOf(['-V=1'])?.text).toBe('Dust 1.2.5\n');
  });

  test('values may be attached with or without an equals sign', () => {
    expect(parseCli(['--depth=3']).depth).toBe(3);
    expect(parseCli(['-d3']).depth).toBe(3);
    expect(parseCli(['-o=si']).outputFormat).toBe('si');
    expect(parseCli(['-osi']).outputFormat).toBe('si');
  });

  test('short flags cluster, and the first built-in in a cluster wins', () => {
    const parsed = parseCli(['-Pb', '.']);
    expect(parsed.noProgress).toBe(true);
    expect(parsed.noPercentBars).toBe(true);
    expect(exitOf(['-hV'])?.text).toContain('Like du but more intuitive');
    expect(exitOf(['-Vh'])?.text).toBe('Dust 1.2.5\n');
  });

  test('enum matching follows ignore_case per argument', () => {
    expect(parseCli(['-o', 'SI']).outputFormat).toBe('si');
    expect(parseCli(['-o', 'KIB']).outputFormat).toBe('k');
    // --filetime is case sensitive, but does accept its aliases.
    expect(parseCli(['-m', 'accessed']).filetime).toBe('a');
    expect(stderrOf(['-m', 'A', '.'])).toContain("invalid value 'A' for '--filetime <FILETIME>'");
  });

  test('allow_hyphen_values lets the time filters take a negative day count', () => {
    expect(parseCli(['-M', '-1']).mtime).toBe('-1');
    expect(parseCli(['-Mx']).mtime).toBe('x');
    // Without it, a hyphen value is an unknown argument.
    expect(stderrOf(['-w', '-5', '.'])).toContain("unexpected argument '-5' found");
  });

  test('everything after -- is positional', () => {
    expect(parseCli(['-P', '-b', '--', '-c']).params).toEqual(['-c']);
    expect(parseCli(['-']).params).toEqual(['-']);
    expect(parseCli(['--']).params).toBe(undefined);
  });
});
