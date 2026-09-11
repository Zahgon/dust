/**
 * A TOML 0.5 reader, standing in for `config-file` + `toml` + `serde`.
 *
 * dust's config file is a flat table of scalars and one string array, but the
 * parser has to be a real one: a syntax error anywhere in the file is what
 * makes `get_config` print `Ignoring invalid config file` and fall back to
 * defaults, and silently accepting malformed input would change that.
 */

export type TomlValue =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'integer'; readonly value: number }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'datetime'; readonly value: string }
  | { readonly kind: 'array'; readonly value: TomlValue[] }
  | { readonly kind: 'table'; readonly value: TomlTable };

export type TomlTable = Map<string, TomlValue>;

/** The `toml::de::Error` case of `ConfigFileError`. */
export class TomlError extends Error {}

const BARE_KEY = /[A-Za-z0-9_-]/;

class Parser {
  private index = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  private get atEnd(): boolean {
    return this.index >= this.text.length;
  }

  private peek(offset = 0): string {
    return this.text[this.index + offset] ?? '';
  }

  private fail(message: string): never {
    // Report a line number the way `toml` does, so a bad file is debuggable.
    const line = this.text.slice(0, this.index).split('\n').length;
    throw new TomlError(`${message} at line ${String(line)}`);
  }

  /** Horizontal whitespace and comments, but not newlines. */
  private skipInline(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t') {
        this.index++;
      } else if (c === '#') {
        while (!this.atEnd && this.peek() !== '\n') this.index++;
      } else {
        return;
      }
    }
  }

  /** Whitespace, comments and newlines. */
  private skipAll(): void {
    for (;;) {
      this.skipInline();
      const c = this.peek();
      if (c === '\n' || c === '\r') this.index++;
      else return;
    }
  }

  private expectLineEnd(): void {
    this.skipInline();
    if (this.atEnd) return;
    const c = this.peek();
    if (c === '\n') {
      this.index++;
      return;
    }
    if (c === '\r' && this.peek(1) === '\n') {
      this.index += 2;
      return;
    }
    this.fail('expected newline');
  }

  parse(): TomlTable {
    const root: TomlTable = new Map();
    let current = root;

    for (;;) {
      this.skipAll();
      if (this.atEnd) break;

      if (this.peek() === '[') {
        current = this.parseTableHeader(root);
        continue;
      }

      const path = this.parseKeyPath();
      this.skipInline();
      if (this.peek() !== '=') this.fail('expected `=`');
      this.index++;
      this.skipInline();
      const value = this.parseValue();
      this.insert(current, path, value);
      this.expectLineEnd();
    }
    return root;
  }

  /** `[table]` and `[[array of tables]]`; returns the table subsequent keys land in. */
  private parseTableHeader(root: TomlTable): TomlTable {
    this.index++;
    const isArray = this.peek() === '[';
    if (isArray) this.index++;
    this.skipInline();
    const path = this.parseKeyPath();
    this.skipInline();
    if (this.peek() !== ']') this.fail('expected `]`');
    this.index++;
    if (isArray) {
      if (this.peek() !== ']') this.fail('expected `]]`');
      this.index++;
    }
    this.expectLineEnd();

    let table = root;
    for (let i = 0; i < path.length; i++) {
      const key = path[i] as string;
      const last = i === path.length - 1;
      const existing = table.get(key);
      if (last && isArray) {
        let entries: TomlValue[];
        if (existing === undefined) {
          entries = [];
          table.set(key, { kind: 'array', value: entries });
        } else if (existing.kind === 'array') {
          entries = existing.value;
        } else {
          this.fail(`cannot redefine \`${key}\``);
        }
        const fresh: TomlTable = new Map();
        entries.push({ kind: 'table', value: fresh });
        table = fresh;
      } else if (existing === undefined) {
        const fresh: TomlTable = new Map();
        table.set(key, { kind: 'table', value: fresh });
        table = fresh;
      } else if (existing.kind === 'table') {
        table = existing.value;
      } else if (existing.kind === 'array') {
        const tail = existing.value[existing.value.length - 1];
        if (tail === undefined || tail.kind !== 'table') this.fail(`cannot extend \`${key}\``);
        table = tail.value;
      } else {
        this.fail(`cannot redefine \`${key}\``);
      }
    }
    return table;
  }

  private insert(table: TomlTable, path: readonly string[], value: TomlValue): void {
    let target = table;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i] as string;
      const existing = target.get(key);
      if (existing === undefined) {
        const fresh: TomlTable = new Map();
        target.set(key, { kind: 'table', value: fresh });
        target = fresh;
      } else if (existing.kind === 'table') {
        target = existing.value;
      } else {
        this.fail(`cannot extend \`${key}\``);
      }
    }
    const key = path[path.length - 1] as string;
    if (target.has(key)) this.fail(`duplicate key \`${key}\``);
    target.set(key, value);
  }

  private parseKeyPath(): string[] {
    const path: string[] = [this.parseKey()];
    for (;;) {
      this.skipInline();
      if (this.peek() !== '.') return path;
      this.index++;
      this.skipInline();
      path.push(this.parseKey());
    }
  }

  private parseKey(): string {
    const c = this.peek();
    if (c === '"') return this.parseBasicString();
    if (c === "'") return this.parseLiteralString();
    let key = '';
    while (!this.atEnd && BARE_KEY.test(this.peek())) {
      key += this.peek();
      this.index++;
    }
    if (key === '') this.fail('expected a key');
    return key;
  }

  private parseValue(): TomlValue {
    const c = this.peek();
    if (c === '"' || c === "'") {
      const multiline = this.peek(1) === c && this.peek(2) === c;
      if (multiline) return { kind: 'string', value: this.parseMultilineString(c) };
      return {
        kind: 'string',
        value: c === '"' ? this.parseBasicString() : this.parseLiteralString(),
      };
    }
    if (c === '[') return this.parseArray();
    if (c === '{') return this.parseInlineTable();
    if (this.text.startsWith('true', this.index)) {
      this.index += 4;
      return { kind: 'boolean', value: true };
    }
    if (this.text.startsWith('false', this.index)) {
      this.index += 5;
      return { kind: 'boolean', value: false };
    }
    return this.parseNumberOrDate();
  }

  private parseBasicString(): string {
    this.index++;
    let out = '';
    for (;;) {
      if (this.atEnd) this.fail('unterminated string');
      const c = this.peek();
      if (c === '"') {
        this.index++;
        return out;
      }
      if (c === '\n') this.fail('unterminated string');
      if (c === '\\') {
        this.index++;
        out += this.parseEscape();
        continue;
      }
      out += c;
      this.index++;
    }
  }

  private parseEscape(): string {
    const c = this.peek();
    this.index++;
    switch (c) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'u':
      case 'U': {
        const length = c === 'u' ? 4 : 8;
        const hex = this.text.slice(this.index, this.index + length);
        if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex)) this.fail('bad unicode escape');
        this.index += length;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      default:
        this.fail('unknown escape sequence');
    }
  }

  private parseLiteralString(): string {
    this.index++;
    const end = this.text.indexOf("'", this.index);
    const newline = this.text.indexOf('\n', this.index);
    if (end === -1 || (newline !== -1 && newline < end)) this.fail('unterminated string');
    const out = this.text.slice(this.index, end);
    this.index = end + 1;
    return out;
  }

  private parseMultilineString(quote: string): string {
    const fence = quote.repeat(3);
    this.index += 3;
    // A newline immediately after the opening fence is trimmed.
    if (this.peek() === '\n') this.index++;
    else if (this.peek() === '\r' && this.peek(1) === '\n') this.index += 2;

    let out = '';
    for (;;) {
      if (this.atEnd) this.fail('unterminated string');
      if (this.text.startsWith(fence, this.index)) {
        this.index += 3;
        return out;
      }
      const c = this.peek();
      if (quote === '"' && c === '\\') {
        this.index++;
        // A backslash before a newline swallows the following whitespace.
        if (this.peek() === '\n' || (this.peek() === '\r' && this.peek(1) === '\n')) {
          while (' \t\r\n'.includes(this.peek()) && !this.atEnd) this.index++;
          continue;
        }
        out += this.parseEscape();
        continue;
      }
      out += c;
      this.index++;
    }
  }

  private parseArray(): TomlValue {
    this.index++;
    const items: TomlValue[] = [];
    for (;;) {
      this.skipAll();
      if (this.atEnd) this.fail('unterminated array');
      if (this.peek() === ']') {
        this.index++;
        return { kind: 'array', value: items };
      }
      items.push(this.parseValue());
      this.skipAll();
      if (this.peek() === ',') {
        this.index++;
        continue;
      }
      if (this.peek() === ']') {
        this.index++;
        return { kind: 'array', value: items };
      }
      this.fail('expected `,` or `]`');
    }
  }

  private parseInlineTable(): TomlValue {
    this.index++;
    const table: TomlTable = new Map();
    this.skipInline();
    if (this.peek() === '}') {
      this.index++;
      return { kind: 'table', value: table };
    }
    for (;;) {
      this.skipInline();
      const path = this.parseKeyPath();
      this.skipInline();
      if (this.peek() !== '=') this.fail('expected `=`');
      this.index++;
      this.skipInline();
      this.insert(table, path, this.parseValue());
      this.skipInline();
      if (this.peek() === ',') {
        this.index++;
        continue;
      }
      if (this.peek() === '}') {
        this.index++;
        return { kind: 'table', value: table };
      }
      this.fail('expected `,` or `}`');
    }
  }

  private parseNumberOrDate(): TomlValue {
    const start = this.index;
    while (!this.atEnd && /[0-9A-Za-z_+\-.:]/.test(this.peek())) this.index++;
    const raw = this.text.slice(start, this.index);
    if (raw === '') this.fail('expected a value');

    // Offset date-times carry a space between date and time in TOML 0.5.
    if (/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}.*)?$/.test(raw)) {
      if (raw.length === 10 || !raw.includes(' ')) return { kind: 'datetime', value: raw };
    }
    if (/^\d{2}:\d{2}:\d{2}/.test(raw)) return { kind: 'datetime', value: raw };

    const cleaned = raw.replace(/_/g, '');
    if (/^[+-]?0x[0-9A-Fa-f]+$/.test(cleaned)) {
      return { kind: 'integer', value: parseInt(cleaned.replace('0x', ''), 16) };
    }
    if (/^[+-]?0o[0-7]+$/.test(cleaned)) {
      return { kind: 'integer', value: parseInt(cleaned.replace('0o', ''), 8) };
    }
    if (/^[+-]?0b[01]+$/.test(cleaned)) {
      return { kind: 'integer', value: parseInt(cleaned.replace('0b', ''), 2) };
    }
    if (/^[+-]?\d+$/.test(cleaned)) return { kind: 'integer', value: Number(cleaned) };
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|inf|nan)$/.test(cleaned)) {
      const value =
        cleaned.endsWith('inf') ? (cleaned.startsWith('-') ? -Infinity : Infinity)
        : cleaned.endsWith('nan') ? NaN
        : Number(cleaned);
      return { kind: 'float', value };
    }
    this.fail(`invalid value \`${raw}\``);
  }
}

/** Parse a whole TOML document. Throws {@link TomlError} on any syntax error. */
export function parseToml(text: string): TomlTable {
  return new Parser(text).parse();
}
