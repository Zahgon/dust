import { describe, expect, test } from 'vitest';

import {
  clearLine,
  Operation,
  PAtomicInfo,
  PAtomicView,
  PIndicator,
  PROGRESS_CHARS,
  SPINNER_SLEEP_TIME,
} from '../src/progress.ts';

describe('progress', () => {
  test('the spinner cycles four characters at a tenth of a second', () => {
    expect(PROGRESS_CHARS).toEqual(['-', '\\', '|', '/']);
    expect(SPINNER_SLEEP_TIME).toBe(100);
  });

  test('clearLine writes at least one space, as the width formatter does', () => {
    expect(clearLine(0)).toBe('\r ');
    expect(clearLine(1)).toBe('\r ');
    expect(clearLine(4)).toBe('\r    ');
  });

  test('clearState resets the counters and publishes the path', () => {
    const info = new PAtomicInfo();
    const view = new PAtomicView(info.buffer);

    info.addFile();
    info.addSize(4096);
    info.clearState('/tmp/test_dir');

    expect(view.state).toBe(Operation.INDEXING);
    expect(view.currentPath).toBe('/tmp/test_dir');
    expect(view.numFiles).toBe(0n);
    expect(view.totalFileSize).toBe(0);
  });

  test('the two frames are the lines the original prints', () => {
    const info = new PAtomicInfo();
    const view = new PAtomicView(info.buffer);
    info.clearState('/tmp/test_dir');
    info.addFile();
    info.addFile();
    info.addSize(4096);

    expect(view.frame('-', '')).toBe('Indexing: /tmp/test_dir 2 files, 4.0Ki ... -');
    expect(view.formatIndexingStr('\\', 'si')).toBe(
      'Indexing: /tmp/test_dir 2 files, 4.1K ... \\',
    );

    info.setState(Operation.PREPARING);
    expect(view.frame('|', '')).toBe('Preparing: /tmp/test_dir 4.0Ki ... |');
    expect(view.formatPreparingStr('/', 'b')).toBe('Preparing: /tmp/test_dir 4096B ... /');
  });

  test('a path longer than the shared block is truncated, not overrun', () => {
    const info = new PAtomicInfo();
    const view = new PAtomicView(info.buffer);
    info.clearState('a'.repeat(9000));
    expect(view.currentPath.length).toBe(4096);
  });

  test('waitForStop reports the stop request', () => {
    const info = new PAtomicInfo();
    const view = new PAtomicView(info.buffer);
    expect(view.waitForStop(1)).toBe(false);
    info.requestStop();
    expect(view.waitForStop(1)).toBe(true);
  });

  test('stopping an indicator that never span is a no-op', async () => {
    await expect(PIndicator.buildMe().stop()).resolves.toBeUndefined();
  });

  test('a spawned spinner draws frames and is joined on stop', async () => {
    const indicator = PIndicator.buildMe();
    indicator.data.clearState('/tmp/test_dir');
    indicator.spawn('');
    // Long enough for a few ticks of the 100ms spinner.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await indicator.stop();
    // Stopping twice is harmless.
    await indicator.stop();
  });
});
