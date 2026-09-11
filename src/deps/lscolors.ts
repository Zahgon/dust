/**
 * The `lscolors` 0.21 crate, reimplemented: `LS_COLORS` parsing and the
 * per-path style lookup dust uses to colour file names.
 *
 * Two details are easy to get wrong and both are observable. First, the crate's
 * built-in default is *not* GNU's — `pi` is `33` rather than `40;33`, and `bd`
 * and `cd` are `01;33`. Second, suffix matching prefers the **last** rule
 * declared, not the longest, and is ASCII case-insensitive unless two spellings
 * of the same suffix were given conflicting styles.
 */

import * as ansi from './ansi.ts';
import { fileName as pathFileName } from './rustPath.ts';

export const Indicator = {
  Normal: 'no',
  RegularFile: 'fi',
  Directory: 'di',
  SymbolicLink: 'ln',
  FIFO: 'pi',
  Socket: 'so',
  Door: 'do',
  BlockDevice: 'bd',
  CharacterDevice: 'cd',
  OrphanedSymbolicLink: 'or',
  Setuid: 'su',
  Setgid: 'sg',
  Sticky: 'st',
  OtherWritable: 'ow',
  StickyAndOtherWritable: 'tw',
  ExecutableFile: 'ex',
  MissingFile: 'mi',
  Capabilities: 'ca',
  MultipleHardLinks: 'mh',
  LeftCode: 'lc',
  RightCode: 'rc',
  EndCode: 'ec',
  Reset: 'rs',
  ClearLine: 'cl',
} as const;

export type Indicator = (typeof Indicator)[keyof typeof Indicator];

const INDICATORS = new Set<string>(Object.values(Indicator));

const LS_COLORS_DEFAULT =
  'rs=0:lc=\x1b[:rc=m:cl=\x1b[K:ex=01;32:sg=30;43:su=37;41:di=01;34:st=37;44:' +
  'ow=34;42:tw=30;42:ln=01;36:bd=01;33:cd=01;33:do=01;35:pi=33:so=01;35:';

const NAMED_FOREGROUND: Record<number, ansi.Color> = {
  30: ansi.Black,
  31: ansi.Red,
  32: ansi.Green,
  33: ansi.Yellow,
  34: ansi.Blue,
  35: ansi.Purple,
  36: ansi.Cyan,
  37: ansi.White,
};

/** `Style::from_ansi_sequence` — null when the code is empty or an explicit reset. */
export function styleFromAnsiSequence(code: string): ansi.Style | null {
  if (code === '' || code === '0' || code === '00') return null;

  const parts: number[] = [];
  for (const piece of code.split(';')) {
    const value = Number(piece);
    // The crate parses each part as a `u8`; anything else abandons the style.
    if (!/^\d+$/.test(piece) || !Number.isInteger(value) || value > 255) return null;
    parts.push(value);
  }

  let bold = false;
  let dimmed = false;
  let italic = false;
  let underline = false;
  let slowBlink = false;
  let rapidBlink = false;
  let reverse = false;
  let hidden = false;
  let strikethrough = false;
  let foreground: ansi.Color | undefined;
  let background: ansi.Color | undefined;

  const take = (): number | undefined => parts.shift();

  loop: for (;;) {
    const part = take();
    if (part === undefined) break;
    switch (part) {
      case 0:
        bold = dimmed = italic = underline = false;
        slowBlink = rapidBlink = reverse = hidden = strikethrough = false;
        break;
      case 1: bold = true; break;
      case 2: dimmed = true; break;
      case 3: italic = true; break;
      case 4: underline = true; break;
      case 5: slowBlink = true; break;
      case 6: rapidBlink = true; break;
      case 7: reverse = true; break;
      case 8: hidden = true; break;
      case 9: strikethrough = true; break;
      case 22: bold = dimmed = false; break;
      case 23: italic = false; break;
      case 24: underline = false; break;
      case 25: slowBlink = rapidBlink = false; break;
      case 27: reverse = false; break;
      case 28: hidden = false; break;
      case 29: strikethrough = false; break;
      case 39: foreground = undefined; break;
      case 49: background = undefined; break;
      case 38:
      case 48:
      case 58: {
        const mode = take();
        const first = take();
        if (mode === undefined || first === undefined) break loop;
        let color: ansi.Color;
        if (mode === 5) {
          color = ansi.fixed(first);
        } else if (mode === 2) {
          const green = take();
          const blue = take();
          if (green === undefined || blue === undefined) break loop;
          color = ansi.rgb(first, green, blue);
        } else {
          break loop;
        }
        if (part === 38) foreground = color;
        else if (part === 48) background = color;
        // 58 is the underline colour, which nu-ansi-term does not render.
        break;
      }
      default:
        if (part >= 30 && part <= 37) foreground = NAMED_FOREGROUND[part];
        else if (part >= 40 && part <= 47) background = NAMED_FOREGROUND[part - 10];
        else if (part >= 90 && part <= 97) foreground = ansi.fixed(part - 90 + 8);
        else if (part >= 100 && part <= 107) background = ansi.fixed(part - 100 + 8);
        // Anything else is skipped, as `Some(_) => continue` does.
        break;
    }
  }

  return {
    foreground,
    background,
    bold,
    dimmed,
    italic,
    underline,
    blink: slowBlink || rapidBlink,
    reverse,
    hidden,
    strikethrough,
  };
}

function sameStyle(a: ansi.Style | null, b: ansi.Style | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The metadata `style_for_path_with_metadata` needs, as `fs.statSync` reports it. */
export interface FileFacts {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly isFIFO: boolean;
  readonly isSocket: boolean;
  readonly isBlockDevice: boolean;
  readonly isCharacterDevice: boolean;
  readonly mode: number;
  readonly nlink: number;
}

interface SuffixRule {
  readonly suffix: string;
  readonly lower: string;
  readonly style: ansi.Style | null;
}

export class LsColors {
  private readonly indicatorMapping = new Map<string, ansi.Style>();
  /** Whether `fi` falls back to `no`; cleared by an explicit `fi=` reset. */
  private fileNormalFallback = true;
  /** Suffix rules, newest first, so the first match wins. */
  private suffixRules: SuffixRule[] = [];
  /** Lower-cased suffixes that must be matched case-sensitively. */
  private caseSensitive = new Set<string>();

  /** `LsColors::default()` — the crate's built-in mapping. */
  static default(): LsColors {
    const colors = new LsColors();
    colors.addFromString(LS_COLORS_DEFAULT);
    colors.finish();
    return colors;
  }

  /** `LsColors::from_string()` — the defaults, then the caller's overrides. */
  static fromString(input: string): LsColors {
    const colors = new LsColors();
    colors.addFromString(LS_COLORS_DEFAULT);
    colors.addFromString(input);
    colors.finish();
    return colors;
  }

  /** `LsColors::from_env().unwrap_or_default()`. */
  static fromEnvOrDefault(env: NodeJS.ProcessEnv): LsColors {
    const raw = env['LS_COLORS'];
    return raw === undefined ? LsColors.default() : LsColors.fromString(raw);
  }

  private addFromString(input: string): void {
    for (const entry of input.split(':')) {
      const parts = entry.split('=');
      if (parts.length < 2) continue;
      const key = parts[0] as string;
      const style = styleFromAnsiSequence(parts[1] as string);
      if (key.startsWith('*')) {
        const suffix = key.slice(1);
        // Pushed in order; `finish` reverses so that later rules win.
        this.suffixRules.push({ suffix, lower: suffix.toLowerCase(), style });
      } else if (INDICATORS.has(key)) {
        if (style !== null) {
          this.indicatorMapping.set(key, style);
        } else {
          this.indicatorMapping.delete(key);
          if (key === Indicator.RegularFile) this.fileNormalFallback = false;
        }
      }
    }
  }

  /** Mirror `SuffixMapBuilder::build`: reverse, then work out case sensitivity. */
  private finish(): void {
    this.suffixRules.reverse();

    const firstExact = new Map<string, number>();
    const firstLower = new Map<string, number>();
    this.suffixRules.forEach((rule, index) => {
      if (!firstExact.has(rule.suffix)) firstExact.set(rule.suffix, index);
      if (!firstLower.has(rule.lower)) firstLower.set(rule.lower, index);
    });

    this.caseSensitive = new Set();
    for (const index of firstExact.values()) {
      const rule = this.suffixRules[index] as SuffixRule;
      const other = this.suffixRules[firstLower.get(rule.lower) as number] as SuffixRule;
      if (!sameStyle(rule.style, other.style)) this.caseSensitive.add(rule.lower);
    }
  }

  hasExplicitStyleFor(indicator: Indicator): boolean {
    return this.indicatorMapping.has(indicator);
  }

  private needsFileMetadata(): boolean {
    return (
      this.hasExplicitStyleFor(Indicator.Setuid) ||
      this.hasExplicitStyleFor(Indicator.Setgid) ||
      this.hasExplicitStyleFor(Indicator.ExecutableFile) ||
      this.hasExplicitStyleFor(Indicator.MultipleHardLinks)
    );
  }

  private needsDirMetadata(): boolean {
    return (
      this.hasExplicitStyleFor(Indicator.StickyAndOtherWritable) ||
      this.hasExplicitStyleFor(Indicator.OtherWritable) ||
      this.hasExplicitStyleFor(Indicator.Sticky)
    );
  }

  private indicatorFor(facts: FileFacts | null, pathExists: boolean): Indicator {
    // No metadata: assume a regular file so the suffix map still gets a chance.
    if (facts === null) return Indicator.RegularFile;

    if (facts.isFile) {
      if (this.needsFileMetadata()) {
        if (this.hasExplicitStyleFor(Indicator.Setuid) && (facts.mode & 0o4000) !== 0) {
          return Indicator.Setuid;
        }
        if (this.hasExplicitStyleFor(Indicator.Setgid) && (facts.mode & 0o2000) !== 0) {
          return Indicator.Setgid;
        }
        if (this.hasExplicitStyleFor(Indicator.ExecutableFile) && (facts.mode & 0o111) !== 0) {
          return Indicator.ExecutableFile;
        }
        if (this.hasExplicitStyleFor(Indicator.MultipleHardLinks) && facts.nlink > 1) {
          return Indicator.MultipleHardLinks;
        }
      }
      return Indicator.RegularFile;
    }
    if (facts.isDirectory) {
      if (this.needsDirMetadata()) {
        if (
          this.hasExplicitStyleFor(Indicator.StickyAndOtherWritable) &&
          (facts.mode & 0o1002) === 0o1002
        ) {
          return Indicator.StickyAndOtherWritable;
        }
        if (this.hasExplicitStyleFor(Indicator.OtherWritable) && (facts.mode & 0o0002) !== 0) {
          return Indicator.OtherWritable;
        }
        if (this.hasExplicitStyleFor(Indicator.Sticky) && (facts.mode & 0o1000) !== 0) {
          return Indicator.Sticky;
        }
      }
      return Indicator.Directory;
    }
    if (facts.isSymbolicLink) {
      if (this.hasExplicitStyleFor(Indicator.OrphanedSymbolicLink) && !pathExists) {
        return Indicator.OrphanedSymbolicLink;
      }
      return Indicator.SymbolicLink;
    }
    if (facts.isFIFO) return Indicator.FIFO;
    if (facts.isSocket) return Indicator.Socket;
    if (facts.isBlockDevice) return Indicator.BlockDevice;
    if (facts.isCharacterDevice) return Indicator.CharacterDevice;
    return Indicator.MissingFile;
  }

  /** `SuffixMap::get` — the last-declared matching rule, cased per the build rules. */
  styleForStr(name: string): ansi.Style | null {
    const lowerName = name.toLowerCase();
    for (const rule of this.suffixRules) {
      const exact = name.endsWith(rule.suffix);
      const insensitive = !this.caseSensitive.has(rule.lower) && lowerName.endsWith(rule.lower);
      if (exact || insensitive) return rule.style;
    }
    return null;
  }

  /** `LsColors::style_for_path_with_metadata`. */
  styleForPathWithMetadata(
    path: string,
    facts: FileFacts | null,
    pathExists = true,
  ): ansi.Style | null {
    const indicator = this.indicatorFor(facts, pathExists);
    if (indicator === Indicator.RegularFile) {
      // The crate open-codes `file_name` so that it works for every component
      // kind, falling back to the whole path when there is none.
      const name = pathFileName(path) ?? path;
      const style = this.styleForStr(name);
      if (style !== null) return style;
    }
    return this.styleForIndicator(indicator);
  }

  /** `LsColors::style_for_indicator`, including its fallback chain. */
  styleForIndicator(indicator: Indicator): ansi.Style | null {
    const direct = this.indicatorMapping.get(indicator);
    if (direct !== undefined) return direct;

    let fallback: Indicator;
    switch (indicator) {
      case Indicator.Setuid:
      case Indicator.Setgid:
      case Indicator.ExecutableFile:
      case Indicator.MultipleHardLinks:
        fallback = Indicator.RegularFile;
        break;
      case Indicator.StickyAndOtherWritable:
      case Indicator.OtherWritable:
      case Indicator.Sticky:
        fallback = Indicator.Directory;
        break;
      case Indicator.OrphanedSymbolicLink:
        fallback = Indicator.SymbolicLink;
        break;
      case Indicator.MissingFile:
        fallback = Indicator.OrphanedSymbolicLink;
        break;
      default:
        fallback = indicator;
        break;
    }
    const indirect = this.indicatorMapping.get(fallback);
    if (indirect !== undefined) return indirect;

    if (indicator === Indicator.RegularFile && !this.fileNormalFallback) return null;
    return this.indicatorMapping.get(Indicator.Normal) ?? null;
  }
}
