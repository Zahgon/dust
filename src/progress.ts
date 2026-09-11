import { once } from 'node:events';
import { Worker } from 'node:worker_threads';

import { humanReadableNumber } from './display.ts';

/* -------------------------------------------------------------------------- */

/**
 * The spinner runs on its own thread in the original, and it has to here too:
 * the walk is synchronous, so anything driven by the event loop would never
 * tick. A worker thread shares this state through a `SharedArrayBuffer` — the
 * same shape as the original's atomics plus an `RwLock<String>` — and writes
 * straight to file descriptor 2, so it does not need the main thread to be
 * idle.
 */

export const SPINNER_SLEEP_TIME = 100;
export const PROGRESS_CHARS = ['-', '\\', '|', '/'] as const;

/** Byte layout of the shared block. */
export const SHARED = {
  /** Int32: 0 while running, 1 once the main thread asks the spinner to stop. */
  STOP: 0,
  /** Int32: seqlock version; odd means a path write is in flight. */
  VERSION: 1,
  /** Int32: `Operation` state. */
  STATE: 2,
  /** Int32: byte length of the current path. */
  PATH_LEN: 3,
  /** Number of Int32 slots before the counters. */
  INT_SLOTS: 4,
  /** BigInt64 counters: files seen and their total size. */
  NUM_FILES: 0,
  TOTAL_SIZE: 1,
  BIG_SLOTS: 2,
  PATH_CAPACITY: 4096,
} as const;

export const COUNTER_OFFSET = SHARED.INT_SLOTS * 4;
export const PATH_OFFSET = COUNTER_OFFSET + SHARED.BIG_SLOTS * 8;
export const SHARED_BYTES = PATH_OFFSET + SHARED.PATH_CAPACITY;

// creating an enum this way allows to have simpler syntax compared to a Mutex or a RwLock
export const Operation = {
  INDEXING: 0,
  PREPARING: 1,
} as const;

export type Operation = (typeof Operation)[keyof typeof Operation];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The counters and the current path, shared with the spinner thread. */
export class PAtomicInfo {
  readonly buffer: SharedArrayBuffer;
  private readonly ints: Int32Array;
  private readonly bigs: BigInt64Array;
  private readonly path: Uint8Array;

  constructor(buffer?: SharedArrayBuffer) {
    this.buffer = buffer ?? new SharedArrayBuffer(SHARED_BYTES);
    this.ints = new Int32Array(this.buffer, 0, SHARED.INT_SLOTS);
    this.bigs = new BigInt64Array(this.buffer, COUNTER_OFFSET, SHARED.BIG_SLOTS);
    this.path = new Uint8Array(this.buffer, PATH_OFFSET, SHARED.PATH_CAPACITY);
  }

  clearState(dir: string): void {
    this.setState(Operation.INDEXING);
    this.setCurrentPath(dir);
    Atomics.store(this.bigs, SHARED.TOTAL_SIZE, 0n);
    Atomics.store(this.bigs, SHARED.NUM_FILES, 0n);
  }

  setState(state: Operation): void {
    Atomics.store(this.ints, SHARED.STATE, state);
  }

  addFile(): void {
    Atomics.add(this.bigs, SHARED.NUM_FILES, 1n);
  }

  addSize(size: number): void {
    Atomics.add(this.bigs, SHARED.TOTAL_SIZE, BigInt(size));
  }

  /** Publish the path under a seqlock so the reader never sees a torn write. */
  private setCurrentPath(dir: string): void {
    const bytes = encoder.encode(dir).subarray(0, SHARED.PATH_CAPACITY);
    Atomics.add(this.ints, SHARED.VERSION, 1);
    this.path.set(bytes);
    Atomics.store(this.ints, SHARED.PATH_LEN, bytes.length);
    Atomics.add(this.ints, SHARED.VERSION, 1);
  }

  requestStop(): void {
    Atomics.store(this.ints, SHARED.STOP, 1);
    Atomics.notify(this.ints, SHARED.STOP);
  }
}

/**
 * The spinner thread's read-only view of the same block, plus the two lines it
 * renders. They live here rather than in the worker so they can be tested
 * directly, as they were in the original's `progress.rs`.
 */
export class PAtomicView {
  private readonly ints: Int32Array;
  private readonly bigs: BigInt64Array;
  private readonly path: Uint8Array;

  constructor(buffer: SharedArrayBuffer) {
    this.ints = new Int32Array(buffer, 0, SHARED.INT_SLOTS);
    this.bigs = new BigInt64Array(buffer, COUNTER_OFFSET, SHARED.BIG_SLOTS);
    this.path = new Uint8Array(buffer, PATH_OFFSET, SHARED.PATH_CAPACITY);
  }

  get state(): number {
    return Atomics.load(this.ints, SHARED.STATE);
  }

  get numFiles(): bigint {
    return Atomics.load(this.bigs, SHARED.NUM_FILES);
  }

  get totalFileSize(): number {
    return Number(Atomics.load(this.bigs, SHARED.TOTAL_SIZE));
  }

  /** Read the shared path, retrying while the writer is mid-update. */
  get currentPath(): string {
    for (;;) {
      const before = Atomics.load(this.ints, SHARED.VERSION);
      if (before % 2 !== 0) continue;
      const length = Atomics.load(this.ints, SHARED.PATH_LEN);
      const text = decoder.decode(this.path.subarray(0, length));
      if (Atomics.load(this.ints, SHARED.VERSION) === before) return text;
    }
  }

  /** Block until the main thread asks the spinner to stop, or the tick elapses. */
  waitForStop(timeoutMs: number): boolean {
    return Atomics.wait(this.ints, SHARED.STOP, 0, timeoutMs) !== 'timed-out';
  }

  formatPreparingStr(progChar: string, outputDisplay: string): string {
    const pathIn = this.currentPath;
    const size = humanReadableNumber(this.totalFileSize, outputDisplay);
    return `Preparing: ${pathIn} ${size} ... ${progChar}`;
  }

  formatIndexingStr(progChar: string, outputDisplay: string): string {
    const pathIn = this.currentPath;
    const fileCount = this.numFiles;
    const size = humanReadableNumber(this.totalFileSize, outputDisplay);
    const fileStr = `${fileCount.toString()} files, ${size}`;
    return `Indexing: ${pathIn} ${fileStr} ... ${progChar}`;
  }

  /** The frame to draw for the current state. */
  frame(progChar: string, outputDisplay: string): string {
    return this.state === Operation.INDEXING
      ? this.formatIndexingStr(progChar, outputDisplay)
      : this.formatPreparingStr(progChar, outputDisplay);
  }
}

/** `format!("\r{:width$}", " ", width = msg.len())` — never fewer than one space. */
export function clearLine(width: number): string {
  return '\r' + ' '.repeat(Math.max(width, 1));
}

/** `RuntimeErrors` — the three sets of paths dust reports once the walk is done. */
export interface RuntimeErrors {
  noPermissions: Set<string>;
  fileNotFound: Set<string>;
  unknownError: Set<string>;
  interruptedError: number;
}

export function newRuntimeErrors(): RuntimeErrors {
  return {
    noPermissions: new Set(),
    fileNotFound: new Set(),
    unknownError: new Set(),
    interruptedError: 0,
  };
}

/* -------------------------------------------------------------------------- */

export class PIndicator {
  readonly data: PAtomicInfo;
  private worker: Worker | null = null;

  private constructor() {
    this.data = new PAtomicInfo();
  }

  static buildMe(): PIndicator {
    return new PIndicator();
  }

  spawn(outputDisplay: string): void {
    this.worker = new Worker(new URL('./progressWorker.ts', import.meta.url), {
      workerData: { buffer: this.data.buffer, outputDisplay },
      stdout: false,
      stderr: false,
    });
    // The spinner must never be the reason the process stays alive.
    this.worker.unref();
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    if (worker === null) return;
    this.worker = null;
    worker.ref();
    this.data.requestStop();
    await once(worker, 'exit');
  }
}
