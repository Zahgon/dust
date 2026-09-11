/**
 * The slice of `clap` 4.5 that dust's command-line surface is made of: the
 * parser, the two help layouts, the error texts and the exit codes.
 *
 * This is a reimplementation rather than a mapping onto an existing argument
 * parser, because clap's *output* is the contract. `dust --nope` has to print
 * the same three-part error with the same did-you-mean tip and the same
 * context-aware `Usage:` line, and no general-purpose parser produces that.
 *
 * The behaviours reproduced here, each verified against the original binary:
 *
 *  - A detached value may not begin with `-` unless it is exactly `-`. Which
 *    error you get then depends on the token: a *known* flag yields
 *    `a value is required for …`, an unknown one yields `unexpected argument`.
 *  - `--flag=value` on a flag is `unexpected value … no more were expected`,
 *    but a short flag swallows the rest of its token, so `-h=x` prints help.
 *  - The did-you-mean metric is `strsim::jaro` above 0.7 — plain Jaro, not
 *    Jaro-Winkler — and only the single best candidate is offered.
 *  - Errors carry one of three usage lines: the full one, a "smart" one built
 *    from the arguments already parsed, or none at all.
 */

export interface PossibleValue {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly help: string;
}

export interface ArgSpec {
  /** The field name on the parsed result. */
  readonly id: string;
  readonly short?: string;
  readonly long: string;
  /** Present when the argument takes a value; absent makes it a flag. */
  readonly valueName?: string;
  readonly help: string;
  /** `Option<Vec<T>>` in the original: may be repeated. */
  readonly multiple?: boolean;
  /** `allow_hyphen_values(true)`. */
  readonly allowHyphenValues?: boolean;
  readonly possibleValues?: readonly PossibleValue[];
  /** `ignore_case(true)` on a value enum. */
  readonly ignoreCase?: boolean;
  /** Parsed with `usize::from_str`, whose failures have their own wording. */
  readonly numeric?: boolean;
  readonly conflictsWith?: readonly string[];
  /** `value_hint(..)`, which only the completion generators consult. */
  readonly valueHint?: 'FilePath' | 'AnyPath';
  readonly builtin?: 'help' | 'version';
}

export interface PositionalSpec {
  readonly id: string;
  readonly valueName: string;
  readonly help: string;
  readonly valueHint?: 'FilePath' | 'AnyPath';
}

export interface CommandSpec {
  /** `#[command(name(..))]` — what `--version` prints, not what usage shows. */
  readonly displayName: string;
  /** The binary name, which is what every `Usage:` line shows. */
  readonly binName: string;
  readonly version: string;
  readonly about: string;
  readonly args: readonly ArgSpec[];
  readonly positional: PositionalSpec;
}

/** A finished run: clap has produced output and the process should exit. */
export class ClapExit extends Error {
  readonly code: number;
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;

  constructor(code: number, stream: 'stdout' | 'stderr', text: string) {
    super(text);
    this.name = 'ClapExit';
    this.code = code;
    this.stream = stream;
    this.text = text;
  }
}

export interface ParsedArgs {
  /** Values per argument id; a flag present with no value maps to an empty array. */
  readonly values: ReadonlyMap<string, string[]>;
  /** Argument ids in the order they were first seen, as clap's matcher records them. */
  readonly order: readonly string[];
  readonly positional: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Similarity                                                                  */

/** `strsim::jaro`. clap deliberately avoids Jaro-Winkler here. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const left = [...a];
  const right = [...b];
  if (left.length === 0 || right.length === 0) return 0;

  const window = Math.max(Math.floor(Math.max(left.length, right.length) / 2) - 1, 0);
  const rightMatched = new Array<boolean>(right.length).fill(false);
  const leftMatched = new Array<boolean>(left.length).fill(false);
  let matches = 0;

  for (let i = 0; i < left.length; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(right.length - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (rightMatched[j] === true || left[i] !== right[j]) continue;
      rightMatched[j] = true;
      leftMatched[i] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < left.length; i++) {
    if (leftMatched[i] !== true) continue;
    while (rightMatched[k] !== true) k++;
    if (left[i] !== right[k]) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);

  return (matches / left.length + matches / right.length + (matches - transpositions) / matches) / 3;
}

/**
 * `suggestions::did_you_mean(..).pop()` — the best candidate above 0.7, with
 * later declarations winning ties, or null when nothing is close enough.
 */
function bestSuggestion(input: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = 0.7;
  for (const candidate of candidates) {
    const score = jaro(input, candidate);
    // `>=` so that a later equal-scoring candidate wins, matching clap's
    // insert-after-equals ordering followed by `pop()`.
    if (score > 0.7 && score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Rendering helpers                                                           */

/** `Arg::to_string()` — how an argument names itself in errors and usage. */
function display(arg: ArgSpec): string {
  return arg.valueName === undefined ? `--${arg.long}` : `--${arg.long} <${arg.valueName}>`;
}

/** The left-hand column of the help table. */
function invocation(arg: ArgSpec): string {
  const head = arg.short === undefined ? '    ' : `-${arg.short}, `;
  return head + display(arg).slice(0);
}

function possibleValueList(arg: ArgSpec): string {
  return (arg.possibleValues ?? []).map((value) => value.name).join(', ');
}

export class Command {
  private readonly byLong = new Map<string, ArgSpec>();
  private readonly byShort = new Map<string, ArgSpec>();
  /** Conflicts made symmetric, the way clap's conflict graph is. */
  private readonly conflicts = new Map<string, Set<string>>();
  private readonly all: ArgSpec[];
  private readonly spec: CommandSpec;

  constructor(spec: CommandSpec) {
    this.spec = spec;
    const help: ArgSpec = {
      id: 'help',
      short: 'h',
      long: 'help',
      help: '',
      builtin: 'help',
    };
    const version: ArgSpec = {
      id: 'version',
      short: 'V',
      long: 'version',
      help: 'Print version',
      builtin: 'version',
    };
    this.all = [...spec.args, help, version];

    for (const arg of this.all) {
      this.byLong.set(arg.long, arg);
      if (arg.short !== undefined) this.byShort.set(arg.short, arg);
      this.conflicts.set(arg.id, new Set());
    }
    for (const arg of spec.args) {
      for (const other of arg.conflictsWith ?? []) {
        this.conflicts.get(arg.id)?.add(other);
        this.conflicts.get(other)?.add(arg.id);
      }
    }
  }

  private find(id: string): ArgSpec {
    const arg = this.all.find((candidate) => candidate.id === id);
    if (arg === undefined) throw new Error(`unknown argument id ${id}`);
    return arg;
  }

  /* ---------------------------------------------------------------------- */
  /* Usage                                                                   */

  /** `Usage::write_help_usage` — the one the help screens show. */
  private fullUsage(): string {
    return `${this.spec.binName} [OPTIONS] [${this.spec.positional.valueName}]...`;
  }

  /**
   * `Usage::write_smart_usage` — the binary, the flags already seen (rendered as
   * if required), then the positional, which is `<PATH>...` when it too was
   * seen and `[PATH]...` when it was not.
   */
  private smartUsage(used: readonly string[]): string {
    if (used.length === 0) return this.fullUsage();
    const parts: string[] = [this.spec.binName];
    let positionalUsed = false;
    for (const id of used) {
      if (id === this.spec.positional.id) {
        positionalUsed = true;
        continue;
      }
      const rendered = display(this.find(id));
      if (!parts.includes(rendered)) parts.push(rendered);
    }
    const name = this.spec.positional.valueName;
    parts.push(positionalUsed ? `<${name}>...` : `[${name}]...`);
    return parts.join(' ');
  }

  /* ---------------------------------------------------------------------- */
  /* Errors                                                                  */

  private error(message: string, usage: string | null): ClapExit {
    let text = `error: ${message}\n`;
    if (usage !== null) text += `\nUsage: ${usage}\n`;
    text += `\nFor more information, try '--help'.\n`;
    return new ClapExit(2, 'stderr', text);
  }

  private unknownArgument(token: string, used: readonly string[]): ClapExit {
    const bare = token.startsWith('--') ? token.slice(2) : null;
    const suggestion =
      bare === null
        ? null
        : bestSuggestion(
            bare,
            this.all.map((arg) => arg.long),
          );

    let message = `unexpected argument '${token}' found\n`;
    if (suggestion !== null) {
      message += `\n  tip: a similar argument exists: '--${suggestion}'\n`;
      const suggested = this.byLong.get(suggestion) as ArgSpec;
      // clap adds the suggestion to the matcher before building the usage.
      return this.error(message.trimEnd(), this.smartUsage([...used, suggested.id]));
    }
    message += `\n  tip: to pass '${token}' as a value, use '-- ${token}'\n`;
    // Only the long-flag path builds a context-aware usage; an unrecognised
    // short flag reports the plain one, even when other arguments were parsed.
    return this.error(message.trimEnd(), bare === null ? this.fullUsage() : this.smartUsage(used));
  }

  /* ---------------------------------------------------------------------- */
  /* Help and version                                                        */

  /** `-h` — the two-column layout, each section padded to its own widest entry. */
  shortHelp(): string {
    const positional = `[${this.spec.positional.valueName}]...`;
    let out = `${this.spec.about}\n\nUsage: ${this.fullUsage()}\n\n`;

    out += 'Arguments:\n';
    out += `  ${positional}  ${this.spec.positional.help}\n`;

    out += '\nOptions:\n';
    const rows = this.all.map((arg) => {
      let help = arg.builtin === 'help' ? "Print help (see more with '--help')" : arg.help;
      if (arg.possibleValues !== undefined) {
        help += ` [possible values: ${possibleValueList(arg)}]`;
      }
      return { left: invocation(arg), help };
    });
    const width = Math.max(...rows.map((row) => row.left.length));
    for (const row of rows) out += `  ${row.left.padEnd(width)}  ${row.help}\n`;
    return out;
  }

  /** `--help` — help on its own line, indented ten columns, values spelled out. */
  longHelp(): string {
    const blocks: string[] = [];
    blocks.push(
      `  [${this.spec.positional.valueName}]...\n          ${this.spec.positional.help}`,
    );

    const options: string[] = [];
    for (const arg of this.all) {
      const help = arg.builtin === 'help' ? "Print help (see a summary with '-h')" : arg.help;
      let block = `  ${invocation(arg)}\n          ${help}`;
      if (arg.possibleValues !== undefined) {
        const width = Math.max(...arg.possibleValues.map((value) => value.name.length));
        block += '\n\n          Possible values:';
        for (const value of arg.possibleValues) {
          block += `\n          ${`- ${value.name}:`.padEnd(width + 3)} ${value.help}`;
        }
      }
      options.push(block);
    }

    return (
      `${this.spec.about}\n\nUsage: ${this.fullUsage()}\n\n` +
      `Arguments:\n${blocks.join('\n\n')}\n\n` +
      `Options:\n${options.join('\n\n')}\n`
    );
  }

  versionText(): string {
    return `${this.spec.displayName} ${this.spec.version}\n`;
  }

  /* ---------------------------------------------------------------------- */
  /* Parsing                                                                 */

  private parseValue(arg: ArgSpec, raw: string): string {
    if (arg.possibleValues !== undefined) {
      const match = arg.possibleValues.find((value) => {
        const names = [value.name, ...(value.aliases ?? [])];
        return names.some((name) =>
          arg.ignoreCase === true ? name.toLowerCase() === raw.toLowerCase() : name === raw,
        );
      });
      if (match === undefined) {
        let message =
          `invalid value '${raw}' for '${display(arg)}'\n` +
          `  [possible values: ${possibleValueList(arg)}]`;
        const suggestion = bestSuggestion(
          raw,
          arg.possibleValues.map((value) => value.name),
        );
        if (suggestion !== null) message += `\n\n  tip: a similar value exists: '${suggestion}'`;
        throw this.error(message, null);
      }
      return match.name;
    }
    if (arg.numeric === true) {
      // `usize::from_str`, whose two failure messages are user-visible.
      if (!/^\+?[0-9]+$/.test(raw)) {
        const reason =
          raw === '' ? 'cannot parse integer from empty string' : 'invalid digit found in string';
        throw this.error(`invalid value '${raw}' for '${display(arg)}': ${reason}`, null);
      }
      if (BigInt(raw) > 18446744073709551615n) {
        throw this.error(
          `invalid value '${raw}' for '${display(arg)}': number too large to fit in target type`,
          null,
        );
      }
    }
    return raw;
  }

  private missingValue(arg: ArgSpec): ClapExit {
    let message = `a value is required for '${display(arg)}' but none was supplied`;
    if (arg.possibleValues !== undefined) {
      message += `\n  [possible values: ${possibleValueList(arg)}]`;
    }
    return this.error(message, null);
  }

  /** Parse an argv slice (without the program name). Throws {@link ClapExit}. */
  parse(argv: readonly string[]): ParsedArgs {
    const values = new Map<string, string[]>();
    const order: string[] = [];
    const positional: string[] = [];
    const multipleUse: string[] = [];

    const record = (arg: ArgSpec, value?: string): void => {
      const existing = values.get(arg.id);
      if (existing === undefined) {
        values.set(arg.id, value === undefined ? [] : [value]);
        order.push(arg.id);
      } else {
        if (arg.multiple !== true && !multipleUse.includes(arg.id)) multipleUse.push(arg.id);
        if (value !== undefined) existing.push(value);
      }
    };

    let index = 0;
    let trailing = false;

    /** Take the next token as `arg`'s value, applying clap's dash rules. */
    const takeDetachedValue = (arg: ArgSpec): string => {
      const next = argv[index];
      if (next === undefined) throw this.missingValue(arg);
      if (arg.allowHyphenValues !== true && next.startsWith('-') && next !== '-') {
        // The option gets no value either way, but which error clap reports
        // depends on the token: a flag it knows blames the option, anything
        // else is reported as the unexpected argument it is.
        if (next.startsWith('--')) {
          const name = next.slice(2).split('=')[0] as string;
          if (this.byLong.has(name)) throw this.missingValue(arg);
          throw this.unknownArgument(`--${name}`, order);
        }
        for (const letter of next.slice(1)) {
          if (!this.byShort.has(letter)) throw this.unknownArgument(`-${letter}`, order);
        }
        throw this.missingValue(arg);
      }
      index += 1;
      return next;
    };

    while (index < argv.length) {
      const token = argv[index] as string;
      index += 1;

      if (trailing) {
        positional.push(token);
        if (!order.includes(this.spec.positional.id)) order.push(this.spec.positional.id);
        continue;
      }
      if (token === '--') {
        trailing = true;
        continue;
      }

      if (token.startsWith('--')) {
        const body = token.slice(2);
        const equals = body.indexOf('=');
        const name = equals === -1 ? body : body.slice(0, equals);
        const attached = equals === -1 ? undefined : body.slice(equals + 1);
        const arg = this.byLong.get(name);
        if (arg === undefined) throw this.unknownArgument(`--${name}`, order);

        if (arg.builtin !== undefined) {
          if (attached !== undefined) {
            throw this.error(
              `unexpected value '${attached}' for '--${arg.long}' found; no more were expected`,
              this.smartUsage([...order, arg.id]),
            );
          }
          throw arg.builtin === 'help'
            ? new ClapExit(0, 'stdout', this.longHelp())
            : new ClapExit(0, 'stdout', this.versionText());
        }
        if (arg.valueName === undefined) {
          if (attached !== undefined) {
            throw this.error(
              `unexpected value '${attached}' for '--${arg.long}' found; no more were expected`,
              this.smartUsage([...order, arg.id]),
            );
          }
          record(arg);
          continue;
        }
        record(arg, this.parseValue(arg, attached ?? takeDetachedValue(arg)));
        continue;
      }

      if (token.startsWith('-') && token !== '-') {
        let cursor = 1;
        while (cursor < token.length) {
          const letter = token[cursor] as string;
          const arg = this.byShort.get(letter);
          if (arg === undefined) throw this.unknownArgument(`-${letter}`, order);
          cursor += 1;

          if (arg.builtin !== undefined) {
            // A short built-in swallows whatever follows it in the token.
            throw arg.builtin === 'help'
              ? new ClapExit(0, 'stdout', this.longHelpForShort())
              : new ClapExit(0, 'stdout', this.versionText());
          }
          if (arg.valueName === undefined) {
            record(arg);
            continue;
          }
          // The rest of the token is the value, minus a leading `=`.
          let rest = token.slice(cursor);
          if (rest.startsWith('=')) rest = rest.slice(1);
          record(arg, this.parseValue(arg, rest === '' ? takeDetachedValue(arg) : rest));
          cursor = token.length;
        }
        continue;
      }

      positional.push(token);
      if (!order.includes(this.spec.positional.id)) order.push(this.spec.positional.id);
    }

    this.validate(order, multipleUse);
    return { values, order, positional };
  }

  /** `-h` prints the short layout; this exists so the short path reads clearly. */
  private longHelpForShort(): string {
    return this.shortHelp();
  }

  private validate(order: readonly string[], multipleUse: readonly string[]): void {
    const first = multipleUse[0];
    if (first !== undefined) {
      throw this.error(
        `the argument '${display(this.find(first))}' cannot be used multiple times`,
        this.fullUsage(),
      );
    }

    for (const id of order) {
      if (id === this.spec.positional.id) continue;
      // Partners are listed in the order the matcher saw them, which is the
      // order they appeared on the command line.
      const conflictsWith = this.conflicts.get(id) ?? new Set<string>();
      const clashes = order.filter((other) => conflictsWith.has(other));
      if (clashes.length === 0) continue;

      const own = display(this.find(id));
      const message =
        clashes.length === 1
          ? `the argument '${own}' cannot be used with '${display(this.find(clashes[0] as string))}'`
          : `the argument '${own}' cannot be used with:\n` +
            clashes.map((other) => `  ${display(this.find(other))}`).join('\n');

      // `used_filtered` is matcher order with the conflicting partners removed,
      // so the blamed argument keeps the position it was given on the line.
      const used = order.filter((other) => !clashes.includes(other));
      throw this.error(message, this.smartUsage(used));
    }
  }
}
