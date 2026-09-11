import { describe, expect, test } from 'vitest';

import { divF32, f32, formatFixed, isNormalF32, mulF32 } from '../../src/deps/rustFloat.ts';

/**
 * Rust computes the size mantissa and the bar fill in `f32` and formats with
 * round-half-to-**even**. JavaScript would use doubles and round half away from
 * zero, and both differences move printed characters.
 */
describe('rustFloat', () => {
  test('f32 narrows to single precision', () => {
    expect(f32(0.1)).not.toBe(0.1);
    expect(f32(1024)).toBe(1024);
  });

  test('division is evaluated in single precision', () => {
    // 1536 / 1024 is exact, but the general case is not: narrowing first is
    // what makes `{:.1}` agree with the original.
    expect(divF32(1536, 1024)).toBe(1.5);
    expect(divF32(1024 * 1024 * 1024 - 1, 1024 * 1024)).toBe(f32((1024 * 1024 * 1024 - 1) / (1024 * 1024)));
  });

  test('multiplication is evaluated in single precision', () => {
    expect(mulF32(13, divF32(2048, 4096))).toBe(6.5);
  });

  test('isNormalF32 rejects zero, subnormals and non-finite values', () => {
    expect(isNormalF32(1)).toBe(true);
    expect(isNormalF32(0)).toBe(false);
    expect(isNormalF32(NaN)).toBe(false);
    expect(isNormalF32(Infinity)).toBe(false);
    expect(isNormalF32(2 ** -140)).toBe(false);
  });

  test('formatFixed rounds half to even, unlike toFixed', () => {
    expect(formatFixed(2.5, 0)).toBe('2');
    expect(formatFixed(3.5, 0)).toBe('4');
    expect(formatFixed(0.5, 0)).toBe('0');
    expect(formatFixed(1.5, 0)).toBe('2');
    // JavaScript's own formatter disagrees on every tie.
    expect((2.5).toFixed(0)).toBe('3');
  });

  test('formatFixed matches the size column the renderer prints', () => {
    expect(formatFixed(divF32(1024, 1024), 1)).toBe('1.0');
    expect(formatFixed(divF32(1536, 1024), 1)).toBe('1.5');
    expect(formatFixed(divF32(1024 ** 5, 1024 ** 5), 1)).toBe('1.0');
    expect(formatFixed(0, 0)).toBe('0');
    expect(formatFixed(100, 0)).toBe('100');
  });

  test('formatFixed handles negative values and non-finite input', () => {
    expect(formatFixed(-1.25, 1)).toBe('-1.2');
    expect(formatFixed(-0.4, 0)).toBe('0');
    expect(formatFixed(NaN, 1)).toBe('NaN');
    expect(formatFixed(Infinity, 1)).toBe('inf');
    expect(formatFixed(-Infinity, 1)).toBe('-inf');
  });
});
