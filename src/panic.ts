/**
 * Rust's `assert!` failures are part of dust's observable surface: an
 * over-narrow terminal aborts with `Not enough terminal width` on stderr and
 * exit status 101, not with a tidy error message.
 *
 * The panic *text* cannot be reproduced byte for byte — Rust prints a thread
 * name, a thread id and a source location — so the message and the exit status
 * are reproduced and the surrounding frame is written in the same shape.
 */

export class Panic extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Panic';
  }
}

/** Abort the way a failed `assert!` does. */
export function panic(message: string): never {
  throw new Panic(message);
}

/** The exit status a Rust process leaves behind after an unwinding panic. */
export const PANIC_EXIT_CODE = 101;

export function renderPanic(message: string): string {
  return `thread 'main' panicked:\n${message}\n`;
}
