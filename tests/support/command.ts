import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { run } from '../../src/main.ts';
import { captureStreams } from '../../src/output.ts';

/**
 * The stand-in for `assert_cmd`.
 *
 * `dust()` drives a complete run in this process and reports what it wrote and
 * the status it would have exited with — the same three things `assert_cmd`
 * hands back, and the same three things the assertions look at.
 *
 * `dustSpawn()` runs the real executable instead, for the cases that need a
 * genuine process: the entry point's own wiring, and the runs the original made
 * without `-P`, where the progress thread writes to the terminal.
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ENTRY = path.join(REPO_ROOT, 'src', 'main.ts');

export interface Output {
  status: number;
  stdout: string;
  stderr: string;
}

export async function dust(args: readonly string[], stdin?: string): Promise<Output> {
  const cwd = process.cwd();
  process.chdir(REPO_ROOT);
  const captured = captureStreams(stdin ?? '');
  try {
    const status = await run(args);
    return { status, stdout: captured.stdout(), stderr: captured.stderr() };
  } finally {
    captured.restore();
    process.chdir(cwd);
  }
}

export function dustSpawn(args: readonly string[], stdin?: string): Output {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: REPO_ROOT,
    input: stdin ?? '',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
