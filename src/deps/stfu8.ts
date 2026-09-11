/**
 * `stfu8::encode_u8`, the escaping every path goes through before it is
 * printed.
 *
 * The rule is: valid UTF-8 passes through untouched, printable ASCII passes
 * through, a backslash doubles, tab / line feed / carriage return become their
 * two-character escapes, and every other byte — control characters and the
 * bytes of any sequence that is not valid UTF-8 — becomes `\xNN` with an
 * upper-case hex pair.
 *
 * The scan mirrors the crate's, which in turn mirrors the standard library's
 * `run_utf8_validation`: when a multi-byte sequence fails to validate, every
 * byte from its start up to and including the one that failed is escaped
 * individually, and the scan resumes after it.
 */

const BACKSLASH = 0x5c;

/** Byte lengths keyed by leading byte, per RFC 3629. 0 marks an invalid lead. */
const UTF8_CHAR_WIDTH = new Uint8Array(256);
for (let i = 0x00; i <= 0x7f; i++) UTF8_CHAR_WIDTH[i] = 1;
for (let i = 0xc2; i <= 0xdf; i++) UTF8_CHAR_WIDTH[i] = 2;
for (let i = 0xe0; i <= 0xef; i++) UTF8_CHAR_WIDTH[i] = 3;
for (let i = 0xf0; i <= 0xf4; i++) UTF8_CHAR_WIDTH[i] = 4;

const CONT_MASK = 0b0011_1111;
const TAG_CONT = 0b1000_0000;

function isContinuation(byte: number): boolean {
  return (byte & ~CONT_MASK & 0xff) === TAG_CONT;
}

/** The four bytes STFU-8 spells with a short escape rather than `\xNN`. */
const SHORT_ESCAPES = new Map<number, string>([
  [BACKSLASH, String.raw`\\`],
  [0x09, String.raw`\t`],
  [0x0a, String.raw`\n`],
  [0x0d, String.raw`\r`],
]);

function escapeByte(byte: number): string {
  const short = SHORT_ESCAPES.get(byte);
  if (short !== undefined) return short;
  return String.raw`\x` + byte.toString(16).toUpperCase().padStart(2, '0');
}

/** One byte that may be printable ASCII, exactly as the crate's `maybe_ascii!` handles it. */
function maybeAscii(byte: number): string {
  if (byte !== BACKSLASH && byte >= 0x20 && byte <= 0x7e) return String.fromCharCode(byte);
  return escapeByte(byte);
}

const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/** `stfu8::encode_u8(bytes)`. */
export function encodeU8Bytes(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  const length = bytes.length;

  while (index < length) {
    const start = index;
    const first = bytes[index] as number;

    if (first < 0x80) {
      out += maybeAscii(first);
      index += 1;
      continue;
    }

    const width = UTF8_CHAR_WIDTH[first] as number;

    // `cursor` follows the crate's `index` as `next!()` walks the sequence, so
    // that a failure escapes exactly the bytes the crate would escape.
    let cursor = index;
    let overflowed = false;
    const next = (): number => {
      cursor += 1;
      if (cursor >= length) {
        cursor = length - 1;
        overflowed = true;
        return -1;
      }
      return bytes[cursor] as number;
    };

    let valid: boolean;
    switch (width) {
      case 2: {
        const second = next();
        valid = !overflowed && isContinuation(second);
        break;
      }
      case 3: {
        const second = next();
        valid =
          !overflowed &&
          ((first === 0xe0 && second >= 0xa0 && second <= 0xbf) ||
            (first >= 0xe1 && first <= 0xec && second >= 0x80 && second <= 0xbf) ||
            (first === 0xed && second >= 0x80 && second <= 0x9f) ||
            (first >= 0xee && first <= 0xef && second >= 0x80 && second <= 0xbf));
        if (valid) {
          const third = next();
          valid = !overflowed && isContinuation(third);
        }
        break;
      }
      case 4: {
        const second = next();
        valid =
          !overflowed &&
          ((first === 0xf0 && second >= 0x90 && second <= 0xbf) ||
            (first >= 0xf1 && first <= 0xf3 && second >= 0x80 && second <= 0xbf) ||
            (first === 0xf4 && second >= 0x80 && second <= 0x8f));
        if (valid) {
          const third = next();
          valid = !overflowed && isContinuation(third);
        }
        if (valid) {
          const fourth = next();
          valid = !overflowed && isContinuation(fourth);
        }
        break;
      }
      default:
        valid = false;
        break;
    }

    if (!valid) {
      for (let i = start; i <= cursor; i++) out += maybeAscii(bytes[i] as number);
      index = cursor + 1;
      continue;
    }

    out += decoder.decode(bytes.subarray(start, start + width));
    index = start + width;
  }
  return out;
}

/** `stfu8::encode_u8(text.as_bytes())` for text that is already a JavaScript string. */
export function encodeU8(text: string): string {
  return encodeU8Bytes(encoder.encode(text));
}
