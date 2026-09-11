import * as fs from 'node:fs';
import * as path from 'node:path';

import { COMMAND_SPEC } from './src/cli.ts';
import { GENERATORS } from './src/deps/clapComplete.ts';
import { generateManPage } from './src/deps/clapMangen.ts';

/**
 * Regenerates the shell completions and the man page from the command
 * definition, as the original's `build.rs` did on every build.
 *
 * Run it with `--check` to assert the committed files are still current instead
 * of rewriting them; that is what the build script and the test suite use.
 */

const root = import.meta.dirname;
const checkOnly = process.argv.includes('--check');
const stale: string[] = [];

function emit(file: string, contents: string): void {
  const target = path.join(root, file);
  if (checkOnly) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (existing !== contents) stale.push(file);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

for (const [name, generate] of Object.entries(GENERATORS)) {
  emit(path.join('completions', name), generate(COMMAND_SPEC));
}
emit(path.join('man-page', 'dust.1'), generateManPage(COMMAND_SPEC));

if (checkOnly && stale.length > 0) {
  process.stderr.write(`generated files are out of date: ${stale.join(', ')}\n`);
  process.exit(1);
}
