/**
 * The `unicode-width` 0.2 crate, reimplemented over tables extracted from it.
 *
 * Every column dust prints is positioned by this function, so it is the one
 * dependency the migration cannot approximate: a character counted one column
 * too narrow shifts an entire line of the rendered tree.
 *
 * The per-character answers come straight from the crate (see
 * `unicodeWidthTable.ts`). String width is *not* simply their sum — the crate
 * folds an emoji ZWJ sequence into two columns, promotes an emoji followed by
 * VS16 to two, demotes one followed by VS15 to one, and counts a control
 * character as one column even though `width()` calls it `None`.
 */

import {
  VS15_DEMOTED,
  VS16_BASE,
  WIDTH_RANGES,
  ZWJ_JOINABLE,
} from './unicodeWidthTable.ts';

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const REGIONAL_INDICATOR_FIRST = 0x1f1e6;
const REGIONAL_INDICATOR_LAST = 0x1f1ff;

/** A flag is a pair of regional indicators, and counts as one emoji of width 2. */
function isRegionalIndicator(code: number): boolean {
  return code >= REGIONAL_INDICATOR_FIRST && code <= REGIONAL_INDICATOR_LAST;
}

/** Binary search a flat `[start, end, value, ...]` table. */
function lookupTriples(table: readonly number[], code: number): number | undefined {
  let low = 0;
  let high = table.length / 3 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = table[mid * 3] as number;
    const end = table[mid * 3 + 1] as number;
    if (code < start) high = mid - 1;
    else if (code > end) low = mid + 1;
    else return table[mid * 3 + 2];
  }
  return undefined;
}

/** Binary search a flat `[start, end, ...]` membership table. */
function inRanges(table: readonly number[], code: number): boolean {
  let low = 0;
  let high = table.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = table[mid * 2] as number;
    const end = table[mid * 2 + 1] as number;
    if (code < start) high = mid - 1;
    else if (code > end) low = mid + 1;
    else return true;
  }
  return false;
}

/**
 * `UnicodeWidthChar::width` — the number of columns a single character
 * occupies, or `null` for a control character.
 */
export function charWidth(code: number): number | null {
  const width = lookupTriples(WIDTH_RANGES, code);
  if (width === undefined) return 1;
  return width < 0 ? null : width;
}

/** Whether a character folds into its neighbour across a ZWJ. */
function zwjJoinable(code: number): boolean {
  return inRanges(ZWJ_JOINABLE, code);
}

/** Whether VS16 promotes this character from one column to two. */
function promotedByVs16(code: number): boolean {
  return inRanges(VS16_BASE, code);
}

/** Whether VS15 demotes this character from two columns to one. */
function demotedByVs15(code: number): boolean {
  return inRanges(VS15_DEMOTED, code);
}

interface Cluster {
  /** Columns this cluster occupies on its own. */
  width: number;
  /** Code units consumed. */
  length: number;
  /** Whether the cluster is an emoji, and so eligible to join through ZWJ. */
  emoji: boolean;
}

/** Read one width-bearing cluster starting at `index`. */
function readCluster(text: string, index: number): Cluster {
  const code = text.codePointAt(index) as number;
  const size = code > 0xffff ? 2 : 1;
  const next = index + size < text.length ? (text.codePointAt(index + size) as number) : -1;

  if (isRegionalIndicator(code)) {
    // Two of them make a flag, which is a single two-column emoji; one on its
    // own is an ordinary one-column letter.
    if (isRegionalIndicator(next)) return { width: 2, length: size + 2, emoji: true };
    return { width: 1, length: size, emoji: false };
  }
  if (next === VS15 && demotedByVs15(code)) {
    return { width: 1, length: size + 1, emoji: false };
  }
  if (next === VS16 && (promotedByVs16(code) || zwjJoinable(code))) {
    // The selector is part of the cluster, so it cannot break a ZWJ sequence
    // that continues after it.
    return { width: promotedByVs16(code) ? 2 : (charWidth(code) ?? 1), length: size + 1, emoji: true };
  }
  // A control character has no `width()`, but occupies one column in a string.
  return { width: charWidth(code) ?? 1, length: size, emoji: zwjJoinable(code) };
}

/** `UnicodeWidthStr::width` — the number of columns a whole string occupies. */
export function strWidth(text: string): number {
  let total = 0;
  let index = 0;
  let previousWasEmoji = false;

  while (index < text.length) {
    const code = text.codePointAt(index) as number;

    // A ZWJ between two emoji folds the pair into the width of one.
    if (code === ZWJ && previousWasEmoji && index + 1 < text.length) {
      const joined = readCluster(text, index + 1);
      if (joined.emoji) {
        index += 1 + joined.length;
        continue;
      }
    }

    const cluster = readCluster(text, index);
    total += cluster.width;
    previousWasEmoji = cluster.emoji;
    index += cluster.length;
  }
  return total;
}
