import * as fs from 'node:fs';

/**
 * `println!`, `eprintln!`, `io::stdin()` and `process::exit` — the four
 * process-wide effects the original reaches for from anywhere in the program.
 *
 * Routing them through one redirectable place is what lets the integration
 * tests drive a whole run in this process and still assert on its exact bytes
 * and exit status, the way `assert_cmd` asserted on a child process.
 */

interface Capture {
  readonly out: string[];
  readonly err: string[];
  readonly stdin: string;
}

/** Non-null while a test is capturing; null in a real run. */
let capture: Capture | null = null;

/** The one place the process's own descriptors are written. */
function emit(fd: 1 | 2, text: string): void {
  if (capture === null) {
    fs.writeSync(fd, text);
    return;
  }
  (fd === 1 ? capture.out : capture.err).push(text);
}

/** stdout is buffered and flushed in one write, as Rust's `LineWriter` is. */
let chunks: string[] = [];
let buffered = 0;

/** `println!(..)`. */
export function println(line: string): void {
  printStdout(line + '\n');
}

/** Write to stdout without a trailing newline. */
export function printStdout(text: string): void {
  chunks.push(text);
  buffered += text.length;
  if (buffered >= 1 << 16) flushStdout();
}

export function flushStdout(): void {
  if (chunks.length === 0) return;
  const text = chunks.join('');
  chunks = [];
  buffered = 0;
  emit(1, text);
}

/** `eprintln!(..)` — unbuffered, and ordered after any pending stdout. */
export function eprintln(line: string): void {
  emit(2, line + '\n');
}

/** Read all of stdin, as `io::stdin().lock().read_to_end(..)` does. */
export function readStdin(): Buffer {
  return capture === null ? fs.readFileSync(0) : Buffer.from(capture.stdin, 'utf8');
}

/** Redirect the three streams; returns a function that puts them back. */
export function captureStreams(stdin = ''): {
  stdout: () => string;
  stderr: () => string;
  restore: () => void;
} {
  const active: Capture = { out: [], err: [], stdin };
  capture = active;

  return {
    stdout: () => active.out.join(''),
    stderr: () => active.err.join(''),
    restore: () => {
      capture = null;
    },
  };
}

/**
 * `std::process::exit(code)`.
 *
 * Thrown rather than executed so that a run driven in-process ends where the
 * original's would, instead of taking the test runner down with it.
 */
export class ExitCode extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`exit ${String(code)}`);
    this.name = 'ExitCode';
    this.code = code;
  }
}

export function exitWith(code: number): never {
  throw new ExitCode(code);
}
