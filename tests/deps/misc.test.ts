import { describe, expect, test } from 'vitest';

import * as ansi from '../../src/deps/ansi.ts';
import { BinaryHeap } from '../../src/deps/binaryHeap.ts';
import { ioErrorDebug, ioErrorString, utf8ErrorMessage } from '../../src/deps/rustIo.ts';
import { separateWithCommas } from '../../src/deps/thousands.ts';

describe('nu-ansi-term', () => {
  test('a plain style emits nothing at all', () => {
    expect(ansi.paint(ansi.PLAIN, 'x')).toBe('x');
    expect(ansi.prefix(ansi.PLAIN)).toBe('');
    expect(ansi.suffix(ansi.PLAIN)).toBe('');
  });

  test('the colours dust paints with', () => {
    expect(ansi.paintColor(ansi.Red, '4.0Ki')).toBe('\x1b[31m4.0Ki\x1b[0m');
    expect(ansi.paintColor(ansi.DarkGray, '█')).toBe('\x1b[90m█\x1b[0m');
  });

  test('the background is written before the foreground', () => {
    // LS_COLORS spells `tw` as 30;42 — black on green — and this prints 42;30.
    expect(ansi.paint({ foreground: ansi.Black, background: ansi.Green }, 'x')).toBe(
      '\x1b[42;30mx\x1b[0m',
    );
    expect(ansi.paint({ bold: true, foreground: ansi.Blue }, 'x')).toBe('\x1b[1;34mx\x1b[0m');
  });

  test('font attributes come first and in a fixed order', () => {
    expect(
      ansi.prefix({ bold: true, dimmed: true, italic: true, underline: true, blink: true }),
    ).toBe('\x1b[1;2;3;4;5m');
    expect(ansi.prefix({ reverse: true, hidden: true, strikethrough: true })).toBe('\x1b[7;8;9m');
  });

  test('extended colours', () => {
    expect(ansi.prefix({ foreground: ansi.fixed(27) })).toBe('\x1b[38;5;27m');
    expect(ansi.prefix({ background: ansi.fixed(27) })).toBe('\x1b[48;5;27m');
    expect(ansi.prefix({ foreground: ansi.rgb(1, 2, 3) })).toBe('\x1b[38;2;1;2;3m');
  });
});

describe('thousands', () => {
  test('separate_with_commas', () => {
    expect(separateWithCommas(0)).toBe('0');
    expect(separateWithCommas(1)).toBe('1');
    expect(separateWithCommas(999)).toBe('999');
    expect(separateWithCommas(1000)).toBe('1,000');
    expect(separateWithCommas(1234567)).toBe('1,234,567');
  });
});

describe('BinaryHeap', () => {
  test('pops the largest element first', () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    heap.extend([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(heap.length).toBe(8);
    const popped: number[] = [];
    for (;;) {
      const next = heap.pop();
      if (next === undefined) break;
      popped.push(next);
    }
    expect(popped).toEqual([9, 6, 5, 4, 3, 2, 1, 1]);
  });

  test('an empty heap pops undefined', () => {
    expect(new BinaryHeap<number>((a, b) => a - b).pop()).toBe(undefined);
  });
});

describe('rustIo', () => {
  test('io::Error renders as strerror plus the errno', () => {
    expect(ioErrorString({ code: 'ENOENT' })).toBe('No such file or directory (os error 2)');
    expect(ioErrorString({ code: 'EACCES' })).toBe('Permission denied (os error 13)');
    expect(ioErrorString(new Error('boom'))).toBe('boom');
  });

  test('the Debug form is what an unwrap panic prints', () => {
    expect(ioErrorDebug({ code: 'ENOENT' })).toBe(
      'Os { code: 2, kind: NotFound, message: "No such file or directory" }',
    );
    expect(ioErrorDebug({ code: 'EACCES' })).toBe(
      'Os { code: 13, kind: PermissionDenied, message: "Permission denied" }',
    );
  });

  test('Utf8Error names the offset it gave up at', () => {
    const encoder = new TextEncoder();
    expect(utf8ErrorMessage(encoder.encode('ok'))).toBe(null);
    expect(utf8ErrorMessage(encoder.encode('ラ'))).toBe(null);
    expect(utf8ErrorMessage(new Uint8Array([0x6f, 0x6b, 0xff]))).toBe(
      'invalid utf-8 sequence of 1 bytes from index 2',
    );
    expect(utf8ErrorMessage(new Uint8Array([0xe3, 0x83]))).toBe(
      'incomplete utf-8 byte sequence from index 0',
    );
    expect(utf8ErrorMessage(new Uint8Array([0xe3, 0x83, 0x41]))).toBe(
      'invalid utf-8 sequence of 2 bytes from index 0',
    );
  });
});
