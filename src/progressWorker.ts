import * as fs from 'node:fs';
import { workerData } from 'node:worker_threads';

import {
  clearLine,
  PAtomicView,
  PROGRESS_CHARS,
  SPINNER_SLEEP_TIME,
} from './progress.ts';

/**
 * The spinner thread. It sleeps on `Atomics.wait`, which is exactly the
 * `recv_timeout` the original loops on: a timeout means draw another frame, a
 * wake-up means the walk is finished and the line should be cleared.
 *
 * It writes to file descriptor 2 directly rather than through
 * `process.stderr`, because a worker's `process.stderr` is proxied through the
 * main thread's event loop, which the synchronous walk is blocking.
 */

interface WorkerInput {
  buffer: SharedArrayBuffer;
  outputDisplay: string;
}

const input = workerData as WorkerInput;
const view = new PAtomicView(input.buffer);

function write(text: string): void {
  try {
    fs.writeSync(2, text);
  } catch {
    // stderr closed underneath us; nothing useful to do.
  }
}

let progressCharIndex = 0;
let msg = '';

// While the timeout triggers we go round the loop.
// If the main thread stores the stop flag we exit the loop.
while (!view.waitForStop(SPINNER_SLEEP_TIME)) {
  // Clear the text written by the previous frame & return to the start of line
  write(clearLine(msg.length));

  msg = view.frame(PROGRESS_CHARS[progressCharIndex] as string, input.outputDisplay);
  write(`\r${msg}`);

  progressCharIndex += 1;
  progressCharIndex %= PROGRESS_CHARS.length;
}

write(clearLine(msg.length));
write('\r');
