import { describe, expect, test } from 'vitest';

import { charWidth, strWidth } from '../../src/deps/unicodeWidth.ts';

/**
 * Every value here was read out of the `unicode-width` 0.2.2 crate itself, so
 * these tests pin the reimplementation to the dependency it replaces rather
 * than to a plausible-looking guess.
 */
describe('unicodeWidth', () => {
  test('charWidth: ASCII is one column and control characters have none', () => {
    expect(charWidth(0x61)).toBe(1);
    expect(charWidth(0x20)).toBe(1);
    expect(charWidth(0x00)).toBe(null);
    expect(charWidth(0x09)).toBe(null);
    expect(charWidth(0x7f)).toBe(null);
  });

  test('charWidth: East Asian wide and fullwidth are two columns', () => {
    expect(charWidth('ラ'.codePointAt(0) as number)).toBe(2);
    expect(charWidth('難'.codePointAt(0) as number)).toBe(2);
    expect(charWidth('！'.codePointAt(0) as number)).toBe(2);
    expect(charWidth('Ａ'.codePointAt(0) as number)).toBe(2);
    expect(charWidth('가'.codePointAt(0) as number)).toBe(2);
    expect(charWidth('👩'.codePointAt(0) as number)).toBe(2);
  });

  test('charWidth: halfwidth kana and ambiguous characters are one column', () => {
    expect(charWidth('ﾊ'.codePointAt(0) as number)).toBe(1);
    expect(charWidth('①'.codePointAt(0) as number)).toBe(1);
    expect(charWidth('→'.codePointAt(0) as number)).toBe(1);
  });

  test('charWidth: combining marks and jamo tails occupy nothing', () => {
    expect(charWidth(0x0301)).toBe(0);
    expect(charWidth(0x200b)).toBe(0);
    expect(charWidth(0xfe0f)).toBe(0);
    expect(charWidth(0x1161)).toBe(0);
  });

  test('strWidth sums the columns of a plain string', () => {
    expect(strWidth('abc')).toBe(3);
    expect(strWidth('ラウトは難しいですラウトは難しいです')).toBe(36);
    expect(strWidth('ラウトは難しいです！.japan')).toBe(26);
    expect(strWidth('０１２')).toBe(6);
    expect(strWidth('ﾊﾛｰ')).toBe(3);
    expect(strWidth('')).toBe(0);
  });

  test('strWidth counts a control character as one column', () => {
    // `charWidth` reports None for these, but a string still advances the cursor.
    expect(strWidth('\t')).toBe(1);
    expect(strWidth('\n')).toBe(1);
    expect(strWidth('x\0y')).toBe(3);
  });

  test('strWidth folds an emoji ZWJ sequence into two columns', () => {
    expect(strWidth('👩')).toBe(2);
    expect(strWidth('👩‍💻')).toBe(2);
    expect(strWidth('👩‍👩‍👧‍👦')).toBe(2);
    // A ZWJ between non-emoji does not join.
    expect(strWidth('a‍b')).toBe(2);
  });

  test('strWidth honours the variation selectors', () => {
    expect(strWidth('❤')).toBe(1);
    expect(strWidth('❤️')).toBe(2);
    expect(strWidth('❤︎')).toBe(1);
    // VS16 after a character with no emoji form changes nothing.
    expect(strWidth('a️')).toBe(1);
    expect(strWidth('︎❤')).toBe(1);
  });

  test('a pair of regional indicators is one two-column flag', () => {
    expect(strWidth('🇺🇸')).toBe(2);
    expect(strWidth('🇺🇸🇬🇧')).toBe(4);
    // An odd one out stays a one-column letter.
    expect(strWidth('🇺')).toBe(1);
    expect(strWidth('🇺🇸🇬')).toBe(3);
    // ...and being a flag makes the pair joinable, which a lone one is not.
    expect(strWidth('🇺🇸‍1️⃣')).toBe(2);
  });

  test('a variation selector does not break a ZWJ sequence', () => {
    // Found by differential testing against the crate: treating VS16 as a
    // cluster of its own cleared the emoji state and stopped the fold.
    expect(strWidth('❗️‍👩')).toBe(2);
    expect(strWidth('❗️')).toBe(2);
  });

  test('strWidth handles a decomposed Hangul syllable', () => {
    expect(strWidth('각')).toBe(2);
    expect(strWidth('é')).toBe(1);
  });
});
