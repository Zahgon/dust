/**
 * The parts of Rust's numeric behaviour that are observable in dust's output.
 *
 * Two things differ from JavaScript and both change printed characters:
 *
 *  - Rust computes the bar fill and the size mantissa in `f32`. Rounding a
 *    `f64` and rounding a `f32` disagree often enough to move a digit, so every
 *    such expression is narrowed with {@link f32}.
 *  - Rust's `{:.N}` rounds half to **even** on the value's exact decimal
 *    expansion. `Number.prototype.toFixed` rounds half away from zero. The
 *    difference is visible at `{:.0}` for a percentage of exactly 2.5.
 */

/** `x as f32` — round a double to the nearest single-precision value. */
export const f32 = Math.fround;

/** `a as f32 / b as f32`, evaluated in single precision throughout. */
export function divF32(a: number, b: number): number {
  return f32(f32(a) / f32(b));
}

/** `a as f32 * b as f32`, evaluated in single precision throughout. */
export function mulF32(a: number, b: number): number {
  return f32(f32(a) * f32(b));
}

const SMALLEST_NORMAL_F32 = 2 ** -126;

/**
 * `f32::is_normal()` — finite, non-zero and not subnormal. dust uses it to turn
 * a `0 / 0` percentage into a plain `0.0` instead of a NaN.
 */
export function isNormalF32(x: number): boolean {
  return Number.isFinite(x) && x !== 0 && Math.abs(x) >= SMALLEST_NORMAL_F32;
}

const scratch = new DataView(new ArrayBuffer(8));

/** Decompose a finite double into an exact `sign * mantissa * 2 ** exponent`. */
function decompose(value: number): { negative: boolean; mantissa: bigint; exponent: number } {
  scratch.setFloat64(0, value);
  const hi = scratch.getUint32(0);
  const lo = scratch.getUint32(4);
  const negative = (hi & 0x8000_0000) !== 0;
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0x000f_ffff) << 32n) | BigInt(lo);

  if (biased === 0) {
    // Subnormal: no implicit leading bit.
    return { negative, mantissa: fraction, exponent: -1074 };
  }
  return { negative, mantissa: fraction | (1n << 52n), exponent: biased - 1075 };
}

/**
 * `format!("{:.precision$}", value)` for a finite value: the exact decimal
 * expansion rounded to `precision` places, ties to even.
 */
export function formatFixed(value: number, precision: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';

  const { negative, mantissa, exponent } = decompose(value);
  const scale = 10n ** BigInt(precision);

  let scaled: bigint;
  if (exponent >= 0) {
    scaled = mantissa * scale * (1n << BigInt(exponent));
  } else {
    const denominator = 1n << BigInt(-exponent);
    const numerator = mantissa * scale;
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const twice = remainder * 2n;
    if (twice > denominator || (twice === denominator && (quotient & 1n) === 1n)) {
      scaled = quotient + 1n;
    } else {
      scaled = quotient;
    }
  }

  let digits = scaled.toString();
  if (precision === 0) {
    return (negative && scaled !== 0n ? '-' : '') + digits;
  }
  if (digits.length <= precision) digits = digits.padStart(precision + 1, '0');
  const whole = digits.slice(0, digits.length - precision);
  const fraction = digits.slice(digits.length - precision);
  return (negative && scaled !== 0n ? '-' : '') + whole + '.' + fraction;
}
