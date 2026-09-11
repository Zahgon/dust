import { describe, expect, test } from 'vitest';

import { encodeU8, encodeU8Bytes } from '../../src/deps/stfu8.ts';

/** The crate's own `sanity_encode` cases, plus the invalid-UTF-8 paths. */
describe('stfu8', () => {
  test('valid text passes through unchanged', () => {
    for (const s of [
      'foo bar',
      '¡ ¢ £ ¤ ¥ ¦ § ¨ © ª « ¬ ­',
      ' ʰ ʱ ʲ ʳ ʴ ʵ ʶ ʷ ʸ ʹ ʺ ʻ',
      '܀ ܁ ܂ ܃ ܄ ܅ ܆ ܇ ܈ ܉ ܊ ܋ ܌ ܍ ܏',
      'Ꭰ Ꭱ Ꭲ Ꭳ Ꭴ Ꭵ Ꭶ Ꭷ Ꭸ Ꭹ',
      'ἀ ἁ ἂ ἃ ἄ ἅ ἆ ἇ Ἀ Ἁ',
      '‑ ‒ – — ― ‖ ‗ ‘ ’ ‚ ‛ “',
      'ラウトは難しいです！.japan',
      '👩.unicode',
    ]) {
      expect(encodeU8(s)).toBe(s);
    }
  });

  test('a backslash is doubled', () => {
    expect(encodeU8('¡ ¢ £ ¤ \\¥ ¦ § ¨ © ª « \\¬ ­')).toBe(
      '¡ ¢ £ ¤ \\\\¥ ¦ § ¨ © ª « \\\\¬ ­',
    );
  });

  test('newlines are escaped', () => {
    expect(encodeU8('Ā ā Ă \nă Ą ą Ć\n ć Ĉ ĉ\n')).toBe('Ā ā Ă \\nă Ą ą Ć\\n ć Ĉ ĉ\\n');
  });

  test('control characters and invalid bytes become hex escapes', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('¡ ¢ £'),
      0x09,
      0x0a,
      0x0d,
      0x07,
      0x7f,
      0xfe,
      ...new TextEncoder().encode('¤ ¥ ¦'),
    ]);
    expect(encodeU8Bytes(bytes)).toBe('¡ ¢ £\\t\\n\\r\\x07\\x7F\\xFE¤ ¥ ¦');
  });

  test('a truncated multi-byte sequence escapes every byte it holds', () => {
    // The two leading bytes of a three-byte sequence, with the third missing.
    expect(encodeU8Bytes(new Uint8Array([0xe3, 0x83]))).toBe('\\xE3\\x83');
    // A lone continuation byte is not a valid lead.
    expect(encodeU8Bytes(new Uint8Array([0x80, 0x41]))).toBe('\\x80A');
  });

  test('an overlong or surrogate sequence is escaped, not decoded', () => {
    expect(encodeU8Bytes(new Uint8Array([0xc0, 0xaf]))).toBe('\\xC0\\xAF');
    expect(encodeU8Bytes(new Uint8Array([0xed, 0xa0, 0x80]))).toBe('\\xED\\xA0\\x80');
  });

  test('a four-byte sequence round-trips', () => {
    expect(encodeU8Bytes(new TextEncoder().encode('👩'))).toBe('👩');
  });
});
