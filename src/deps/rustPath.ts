/**
 * `std::path::Path` / `PathBuf` semantics, reproduced for unix targets.
 *
 * Paths are plain strings here, but string operations are *not* how Rust
 * compares them: `Path` equality, hashing and ordering all run over
 * `components()`, which folds repeated separators, drops interior and trailing
 * `.`, and compares each component as bytes. `"a/b"` and `"a//b/."` are the
 * same path to Rust and different strings to JavaScript, so anything that keys
 * a Set or Map by a path has to key it by {@link pathKey}, and anything that
 * sorts paths has to use {@link comparePaths}.
 */

/** The kinds of component `Path::components()` yields on unix. */
export const ComponentKind = {
  RootDir: 0,
  CurDir: 1,
  ParentDir: 2,
  Normal: 3,
} as const;

export type ComponentKind = (typeof ComponentKind)[keyof typeof ComponentKind];

export interface PathComponent {
  readonly kind: ComponentKind;
  /** The component's text. `/` for RootDir, `.` for CurDir, `..` for ParentDir. */
  readonly text: string;
}

const SEP = '/';

/**
 * `Path::components()`.
 *
 * Repeated separators collapse, `.` is normalised away *except* when it leads a
 * relative path, and a trailing separator is dropped.
 */
export function components(path: string): PathComponent[] {
  const out: PathComponent[] = [];
  let rest = path;

  if (rest.startsWith(SEP)) {
    out.push({ kind: ComponentKind.RootDir, text: SEP });
    rest = rest.replace(/^\/+/, '');
  }

  let first = out.length === 0;
  for (const raw of rest.split(SEP)) {
    if (raw === '') continue;
    if (raw === '.') {
      // A leading `.` on a relative path survives; every other one is dropped.
      if (first) {
        out.push({ kind: ComponentKind.CurDir, text: '.' });
        first = false;
      }
      continue;
    }
    first = false;
    out.push(
      raw === '..'
        ? { kind: ComponentKind.ParentDir, text: '..' }
        : { kind: ComponentKind.Normal, text: raw },
    );
  }
  return out;
}

/** Rebuild a path from components, the way `components().collect::<PathBuf>()` does. */
export function fromComponents(parts: readonly PathComponent[]): string {
  let out = '';
  for (const part of parts) {
    if (part.kind === ComponentKind.RootDir) {
      out += SEP;
    } else {
      if (out !== '' && !out.endsWith(SEP)) out += SEP;
      out += part.text;
    }
  }
  return out;
}

/**
 * The canonical form Rust compares and hashes by. Two paths are `==` in Rust
 * exactly when their keys are `===` here.
 */
export function pathKey(path: string): string {
  return fromComponents(components(path));
}

const encoder = new TextEncoder();

/** Compare two components the way `Ord for Component` does. */
function compareComponent(a: PathComponent, b: PathComponent): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.kind !== ComponentKind.Normal) return 0;
  return compareBytes(a.text, b.text);
}

/**
 * Compare two strings as UTF-8 byte sequences, which is how Rust orders
 * `OsStr`. JavaScript's `<` compares UTF-16 code units instead, and the two
 * disagree for astral characters: `"ラ" < "👩"` in UTF-8 but the comparison
 * flips for a name starting U+FF01.
 */
export function compareBytes(a: string, b: string): number {
  if (a === b) return 0;
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const x = left[i] as number;
    const y = right[i] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/** `Ord for Path`: component-wise, not string-wise. */
export function comparePaths(a: string, b: string): number {
  const left = components(a);
  const right = components(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const ordering = compareComponent(left[i] as PathComponent, right[i] as PathComponent);
    if (ordering !== 0) return ordering;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/** `Path::starts_with`: a component-prefix test, so `/usr` does not prefix `/usrx`. */
export function startsWith(path: string, base: string): boolean {
  const parts = components(path);
  const prefix = components(base);
  if (prefix.length > parts.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (compareComponent(parts[i] as PathComponent, prefix[i] as PathComponent) !== 0) return false;
  }
  return true;
}

/** `Path::parent()`: the path without its final component, or null at the root. */
export function parent(path: string): string | null {
  const parts = components(path);
  const last = parts[parts.length - 1];
  if (last === undefined || last.kind === ComponentKind.RootDir) return null;
  return fromComponents(parts.slice(0, -1));
}

/** `Path::strip_prefix()`: the remainder after `base`, or null when it is not a prefix. */
export function stripPrefix(path: string, base: string): string | null {
  if (!startsWith(path, base)) return null;
  const parts = components(path);
  const prefix = components(base);
  return fromComponents(parts.slice(prefix.length));
}

/** `Path::join()`: an absolute argument replaces the receiver outright. */
export function join(path: string, other: string): string {
  if (other.startsWith(SEP)) return other;
  if (path === '') return other;
  if (other === '') return path;
  return path.endsWith(SEP) ? path + other : path + SEP + other;
}

/**
 * `Path::file_name()`: the final component when it is `Normal`, else null.
 * A path ending in `/`, `.` or `..`, and the root itself, have no file name.
 */
export function fileName(path: string): string | null {
  const parts = components(path);
  const last = parts[parts.length - 1];
  return last !== undefined && last.kind === ComponentKind.Normal ? last.text : null;
}

/**
 * `Path::extension()`.
 *
 * There is no extension when there is no file name, when the file name holds no
 * `.`, or when it begins with `.` and holds no other `.` — so `.hidden_file`
 * has none but `.a.b` has `b`.
 */
export function extension(path: string): string | null {
  const name = fileName(path);
  if (name === null) return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return name.slice(dot + 1);
}

/** `Path::is_absolute()`. */
export function isAbsolute(path: string): boolean {
  return path.startsWith(SEP);
}
