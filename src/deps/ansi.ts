/**
 * The slice of `nu-ansi-term` 0.50 dust renders through.
 *
 * Only the SGR emission matters, and its order is not the obvious one: font
 * attributes first, then the **background**, then the foreground. `LS_COLORS`
 * spells `tw` as `30;42` (black on green) and this prints it as `\x1b[42;30m`.
 * A style with nothing set emits no codes at all, which is why an ordinary file
 * is printed bare rather than wrapped in an empty escape.
 */

export const ColorKind = {
  Named: 0,
  Fixed: 1,
  Rgb: 2,
} as const;

export type ColorKind = (typeof ColorKind)[keyof typeof ColorKind];

export interface Color {
  readonly kind: ColorKind;
  /** Base SGR offset for a named colour: 0 for black through 7 for white. */
  readonly named?: number;
  readonly fixed?: number;
  readonly rgb?: readonly [number, number, number];
}

export const Black: Color = { kind: ColorKind.Named, named: 0 };
export const Red: Color = { kind: ColorKind.Named, named: 1 };
export const Green: Color = { kind: ColorKind.Named, named: 2 };
export const Yellow: Color = { kind: ColorKind.Named, named: 3 };
export const Blue: Color = { kind: ColorKind.Named, named: 4 };
export const Purple: Color = { kind: ColorKind.Named, named: 5 };
export const Cyan: Color = { kind: ColorKind.Named, named: 6 };
export const White: Color = { kind: ColorKind.Named, named: 7 };
/** `nu_ansi_term::Color::DarkGray`, which dust uses for `--dim`. */
export const DarkGray: Color = { kind: ColorKind.Fixed, fixed: -1 };

export function fixed(value: number): Color {
  return { kind: ColorKind.Fixed, fixed: value };
}

export function rgb(r: number, g: number, b: number): Color {
  return { kind: ColorKind.Rgb, rgb: [r, g, b] };
}

export interface Style {
  readonly foreground?: Color | undefined;
  readonly background?: Color | undefined;
  readonly bold?: boolean;
  readonly dimmed?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly blink?: boolean;
  readonly reverse?: boolean;
  readonly hidden?: boolean;
  readonly strikethrough?: boolean;
}

export const PLAIN: Style = {};

function isPlain(style: Style): boolean {
  return (
    style.foreground === undefined &&
    style.background === undefined &&
    !style.bold &&
    !style.dimmed &&
    !style.italic &&
    !style.underline &&
    !style.blink &&
    !style.reverse &&
    !style.hidden &&
    !style.strikethrough
  );
}

function colorCode(color: Color, background: boolean): string {
  const base = background ? 40 : 30;
  switch (color.kind) {
    case ColorKind.Named:
      return String(base + (color.named as number));
    case ColorKind.Fixed:
      // `DarkGray` is the bright-black SGR (90 / 100), not a 256-colour index.
      if (color.fixed === -1) return String(background ? 100 : 90);
      return `${base + 8};5;${String(color.fixed)}`;
    case ColorKind.Rgb: {
      const [r, g, b] = color.rgb as readonly [number, number, number];
      return `${base + 8};2;${String(r)};${String(g)};${String(b)}`;
    }
  }
}

/** The escape sequence that opens this style, or the empty string when it is plain. */
export function prefix(style: Style): string {
  if (isPlain(style)) return '';
  const codes: string[] = [];
  if (style.bold) codes.push('1');
  if (style.dimmed) codes.push('2');
  if (style.italic) codes.push('3');
  if (style.underline) codes.push('4');
  if (style.blink) codes.push('5');
  if (style.reverse) codes.push('7');
  if (style.hidden) codes.push('8');
  if (style.strikethrough) codes.push('9');
  if (style.background !== undefined) codes.push(colorCode(style.background, true));
  if (style.foreground !== undefined) codes.push(colorCode(style.foreground, false));
  return '\x1b[' + codes.join(';') + 'm';
}

/** The escape sequence that closes this style, or the empty string when it is plain. */
export function suffix(style: Style): string {
  return isPlain(style) ? '' : '\x1b[0m';
}

/** `style.paint(text)`. */
export function paint(style: Style, text: string): string {
  return prefix(style) + text + suffix(style);
}

/** `Color::paint(text)` — a foreground-only style, as `Red.paint(..)` builds. */
export function paintColor(color: Color, text: string): string {
  return paint({ foreground: color }, text);
}
