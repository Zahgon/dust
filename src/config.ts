import * as fs from 'node:fs';
import * as os from 'node:os';

import type { Cli } from './cli.ts';
import { Operator } from './dirWalker.ts';
import { getNumberFormat } from './display.ts';
import { fileTimeFromCli, type FileTime } from './node.ts';
import { isAbsolute, join } from './deps/rustPath.ts';
import { parseToml, TomlError, type TomlTable, type TomlValue } from './deps/toml.ts';
import { eprintln, exitWith } from './output.ts';

export const DAY_SECONDS = 24 * 60 * 60;

/**
 * `usize::MAX`, which is what an unset `--depth` means.
 *
 * The exact value is not representable as a double and rounds to 2^64 — but so
 * does the largest value `--depth` will accept, so the equality test that
 * decides whether the line count defaults to the terminal height still agrees
 * with the original.
 */
export const USIZE_MAX = Number(2n ** 64n - 1n);

/** The config file, with every key optional and spelled in kebab-case. */
export interface Config {
  displayFullPaths?: boolean | undefined;
  displayApparentSize?: boolean | undefined;
  reverse?: boolean | undefined;
  noColors?: boolean | undefined;
  forceColors?: boolean | undefined;
  dim?: boolean | undefined;
  noBars?: boolean | undefined;
  skipTotal?: boolean | undefined;
  screenReader?: boolean | undefined;
  ignoreHidden?: boolean | undefined;
  limitFilesystem?: boolean | undefined;
  outputFormat?: string | undefined;
  minSize?: string | undefined;
  onlyDir?: boolean | undefined;
  onlyFile?: boolean | undefined;
  disableProgress?: boolean | undefined;
  depth?: number | undefined;
  barsOnRight?: boolean | undefined;
  stackSize?: number | undefined;
  threads?: number | undefined;
  outputJson?: boolean | undefined;
  printErrors?: boolean | undefined;
  files0From?: string | undefined;
  numberOfLines?: number | undefined;
  filesFrom?: string | undefined;
  collapse?: string[] | undefined;
}

export function defaultConfig(): Config {
  return {};
}

export function getFiles0From(config: Config, options: Cli): string | undefined {
  return options.files0From ?? config.files0From;
}

export function getFilesFrom(config: Config, options: Cli): string | undefined {
  return options.filesFrom ?? config.filesFrom;
}

export function getNoColors(config: Config, options: Cli): boolean {
  return config.noColors === true || options.noColors;
}

export function getForceColors(config: Config, options: Cli): boolean {
  return config.forceColors === true || options.forceColors;
}

export function getDisableProgress(config: Config, options: Cli): boolean {
  return config.disableProgress === true || options.noProgress;
}

export function getApparentSize(config: Config, options: Cli): boolean {
  return config.displayApparentSize === true || options.apparentSize;
}

export function getIgnoreHidden(config: Config, options: Cli): boolean {
  return config.ignoreHidden === true || options.ignoreHidden;
}

export function getLimitFilesystem(config: Config, options: Cli): boolean {
  return config.limitFilesystem === true || options.limitFilesystem;
}

export function getFullPaths(config: Config, options: Cli): boolean {
  return config.displayFullPaths === true || options.fullPaths;
}

export function getReverse(config: Config, options: Cli): boolean {
  return config.reverse === true || options.reverse;
}

export function getNoBars(config: Config, options: Cli): boolean {
  return config.noBars === true || options.noPercentBars;
}

export function getOutputFormat(config: Config, options: Cli): string {
  return (options.outputFormat ?? config.outputFormat ?? '').toLowerCase();
}

export function getFiletime(_config: Config, options: Cli): FileTime | null {
  return options.filetime === undefined ? null : fileTimeFromCli(options.filetime);
}

export function getSkipTotal(config: Config, options: Cli): boolean {
  return config.skipTotal === true || options.skipTotal;
}

export function getScreenReader(config: Config, options: Cli): boolean {
  return config.screenReader === true || options.screenReader;
}

export function getDepth(config: Config, options: Cli): number {
  if (options.depth !== undefined) return options.depth;
  return config.depth ?? USIZE_MAX;
}

export function getMinSize(config: Config, options: Cli): number | null {
  return internalGetMinSize(config, options.minSize);
}

/** Exposed under its original name so the config tests can drive it directly. */
export function internalGetMinSize(config: Config, minSize: string | undefined): number | null {
  const sizeFromParam = minSize === undefined ? null : convertMinSize(minSize);
  if (sizeFromParam === null) {
    return config.minSize === undefined ? null : convertMinSize(config.minSize);
  }
  return sizeFromParam;
}

export function getOnlyDir(config: Config, options: Cli): boolean {
  return config.onlyDir === true || options.onlyDir;
}

export function getPrintErrors(config: Config, options: Cli): boolean {
  return config.printErrors === true || options.printErrors;
}

export function getOnlyFile(config: Config, options: Cli): boolean {
  return config.onlyFile === true || options.onlyFile;
}

export function getBarsOnRight(config: Config, options: Cli): boolean {
  return config.barsOnRight === true || options.barsOnRight;
}

export function getDim(config: Config, options: Cli): boolean {
  return config.dim === true || options.dim;
}

export function getCustomStackSize(config: Config, options: Cli): number | undefined {
  return options.stackSize ?? config.stackSize;
}

export function getThreads(config: Config, options: Cli): number | undefined {
  return options.threads ?? config.threads;
}

export function getOutputJson(config: Config, options: Cli): boolean {
  return config.outputJson === true || options.outputJson;
}

export function getNumberOfLines(config: Config, options: Cli): number | undefined {
  return options.numberOfLines ?? config.numberOfLines;
}

export function getModifiedTimeOperator(
  _config: Config,
  options: Cli,
): [Operator, number] | null {
  return getFilterTimeOperator(options.mtime, getCurrentDateEpochSeconds());
}

export function getAccessedTimeOperator(
  _config: Config,
  options: Cli,
): [Operator, number] | null {
  return getFilterTimeOperator(options.atime, getCurrentDateEpochSeconds());
}

export function getChangedTimeOperator(_config: Config, options: Cli): [Operator, number] | null {
  return getFilterTimeOperator(options.ctime, getCurrentDateEpochSeconds());
}

export function getCollapse(config: Config, options: Cli): string[] | undefined {
  // command line wins, as in getThreads and getNumberOfLines
  return options.collapse ?? config.collapse;
}

/** Local midnight today, in whole epoch seconds. */
export function getCurrentDateEpochSeconds(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

/** Rust's `{:?}` for a string: quoted, with the usual escapes. */
export function debugQuote(text: string): string {
  let out = '"';
  for (const c of text) {
    switch (c) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\0': out += '\\0'; break;
      default: {
        const code = c.codePointAt(0) as number;
        if (code < 0x20 || code === 0x7f) {
          out += `\\u{${code.toString(16)}}`;
        } else {
          out += c;
        }
      }
    }
  }
  return out + '"';
}

export function getFilterTimeOperator(
  optionValue: string | undefined,
  currentDateEpochSeconds: number,
): [Operator, number] | null {
  if (optionValue === undefined) return null;

  if (!/^[+-]?[0-9]+$/.test(optionValue)) {
    eprintln(`Invalid value for time filter: ${debugQuote(optionValue)}`);
    return exitWith(1);
  }
  const parsed = BigInt(optionValue);
  if (parsed < -(2n ** 63n) || parsed > 2n ** 63n - 1n) {
    eprintln(`Invalid value for time filter: ${debugQuote(optionValue)}`);
    return exitWith(1);
  }
  const days = Number(parsed < 0n ? -parsed : parsed);
  const time = currentDateEpochSeconds - days * DAY_SECONDS;

  // the parse above rejects an empty string, so there is a first char
  switch (optionValue[0]) {
    case '+':
      return [Operator.LessThan, time - DAY_SECONDS];
    case '-':
      return [Operator.GreaterThan, time];
    default:
      return [Operator.Equal, time - DAY_SECONDS];
  }
}

/** Rust's `\w`, which is Unicode-aware and so wider than JavaScript's. */
const MIN_SIZE_RE =
  /([0-9]+)([\p{Alphabetic}\p{General_Category=Mark}\p{Nd}\p{Pc}\p{Join_Control}]*)/u;

export function convertMinSize(input: string): number | null {
  const cap = MIN_SIZE_RE.exec(input);
  if (cap === null) return null;

  const digits = cap[1] as string;
  const letters = cap[2] as string;

  // Failure to parse should be impossible due to regex match
  const digitsAsUsize = Number(digits);
  if (!Number.isFinite(digitsAsUsize)) return null;

  const numberFormat = getNumberFormat(letters.toLowerCase());
  if (numberFormat !== null) return digitsAsUsize * numberFormat[0];
  if (letters === '') return digitsAsUsize;

  eprintln(`Ignoring invalid min-size: ${input}`);
  return null;
}

export function getConfigLocations(base: string, configHome: string | undefined): string[] {
  const home = configHome ?? join(base, '.config');
  return [join(base, '.dust.toml'), join(join(home, 'dust'), 'config.toml')];
}

/** The `ConfigFileError` variants, whose `Display` text reaches the user. */
class ConfigFileError extends Error {}

function readConfigFile(path: string): Config {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const extension = dot > slash + 1 && dot > 0 ? path.slice(dot + 1).toLowerCase() : null;

  // Only the `toml` feature of `config-file` is enabled.
  if (extension !== 'toml') throw new ConfigFileError("don't know how to parse file");

  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch {
    throw new ConfigFileError("couldn't read config file");
  }

  let table: TomlTable;
  try {
    table = parseToml(text);
  } catch (error) {
    if (error instanceof TomlError) throw new ConfigFileError("couldn't parse TOML file");
    throw error;
  }
  return deserializeConfig(table);
}

function expect(value: TomlValue | undefined, kind: TomlValue['kind']): TomlValue | undefined {
  if (value === undefined) return undefined;
  // serde reports a type mismatch as a `toml::de::Error` like any other.
  if (value.kind !== kind) throw new ConfigFileError("couldn't parse TOML file");
  return value;
}

/** `#[serde(rename_all = "kebab-case")]` over the `Config` struct. */
function deserializeConfig(table: TomlTable): Config {
  const bool = (key: string): boolean | undefined =>
    expect(table.get(key), 'boolean')?.value as boolean | undefined;
  const text = (key: string): string | undefined =>
    expect(table.get(key), 'string')?.value as string | undefined;
  const int = (key: string): number | undefined =>
    expect(table.get(key), 'integer')?.value as number | undefined;
  const strings = (key: string): string[] | undefined => {
    const value = expect(table.get(key), 'array');
    if (value === undefined) return undefined;
    return (value.value as TomlValue[]).map((item) => {
      if (item.kind !== 'string') throw new ConfigFileError("couldn't parse TOML file");
      return item.value;
    });
  };

  return {
    displayFullPaths: bool('display-full-paths'),
    displayApparentSize: bool('display-apparent-size'),
    reverse: bool('reverse'),
    noColors: bool('no-colors'),
    forceColors: bool('force-colors'),
    dim: bool('dim'),
    noBars: bool('no-bars'),
    skipTotal: bool('skip-total'),
    screenReader: bool('screen-reader'),
    ignoreHidden: bool('ignore-hidden'),
    limitFilesystem: bool('limit-filesystem'),
    outputFormat: text('output-format'),
    minSize: text('min-size'),
    onlyDir: bool('only-dir'),
    onlyFile: bool('only-file'),
    disableProgress: bool('disable-progress'),
    depth: int('depth'),
    barsOnRight: bool('bars-on-right'),
    stackSize: int('stack-size'),
    threads: int('threads'),
    outputJson: bool('output-json'),
    printErrors: bool('print-errors'),
    files0From: text('files0-from'),
    numberOfLines: int('number-of-lines'),
    filesFrom: text('files-from'),
    collapse: strings('collapse'),
  };
}

export function getConfig(confPath: string | undefined): Config {
  if (confPath !== undefined) {
    if (fs.existsSync(confPath)) {
      try {
        return readConfigFile(confPath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        eprintln(`Ignoring invalid config file '${confPath}': ${reason}`);
      }
    } else {
      eprintln(`Config file ${debugQuote(confPath)} doesn't exists`);
    }
    return defaultConfig();
  }

  const home = os.homedir();
  if (home !== '') {
    const raw = process.env['XDG_CONFIG_HOME'];
    const configHome = raw !== undefined && raw !== '' && isAbsolute(raw) ? raw : undefined;

    for (const path of getConfigLocations(home, configHome)) {
      if (!fs.existsSync(path)) continue;
      try {
        return readConfigFile(path);
      } catch {
        // Auto-discovery is silent: a bad file simply does not apply.
      }
    }
  }
  return defaultConfig();
}
