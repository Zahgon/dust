import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';

import { COMMAND_SPEC } from '../../src/cli.ts';
import { GENERATORS } from '../../src/deps/clapComplete.ts';
import { generateManPage } from '../../src/deps/clapMangen.ts';
import { REPO_ROOT } from '../support/command.ts';

/**
 * `build.rs` rewrote these six files on every build, so the committed copies
 * are the fixture the generators are held to. They are also the tightest check
 * on the command definition itself: a flag, a value hint or a help string that
 * drifted would change one of these files.
 */
describe('generated artefacts', () => {
  test.for(Object.keys(GENERATORS))('completions/%s is current', (name) => {
    const generate = GENERATORS[name];
    expect(generate).toBeDefined();
    const expected = fs.readFileSync(path.join(REPO_ROOT, 'completions', name), 'utf8');
    expect(generate?.(COMMAND_SPEC)).toBe(expected);
  });

  test('man-page/dust.1 is current', () => {
    const expected = fs.readFileSync(path.join(REPO_ROOT, 'man-page', 'dust.1'), 'utf8');
    expect(generateManPage(COMMAND_SPEC)).toBe(expected);
  });
});
