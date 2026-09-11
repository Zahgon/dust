#!/usr/bin/env node
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import type { Cli } from './cli.ts';
import { parseCli } from './cli.ts';
import type { Config } from './config.ts';
import * as config from './config.ts';
import { getConfig, USIZE_MAX } from './config.ts';
import type { DisplayNode } from './displayNode.ts';
import { toJsonValue } from './displayNode.ts';
import type { WalkData } from './dirWalker.ts';
import { walkIt } from './dirWalker.ts';
import type { InitialDisplayData } from './display.ts';
import { drawIt } from './display.ts';
import type { AggregateData } from './filter.ts';
import { getBiggest } from './filter.ts';
import { getAllFileTypes } from './filterType.ts';
import { newRuntimeErrors, PIndicator, type RuntimeErrors } from './progress.ts';
import { canonicalizeAbsolutePath, getFilesystemDevices, simplifyDirNames } from './utils.ts';
import { ClapExit } from './deps/clap.ts';
import { join, pathKey } from './deps/rustPath.ts';
import { ioErrorDebug, ioErrorString, utf8ErrorMessage } from './deps/rustIo.ts';
import { PANIC_EXIT_CODE, Panic, renderPanic } from './panic.ts';
import {
  eprintln,
  ExitCode,
  exitWith,
  flushStdout,
  printStdout,
  println,
  readStdin,
} from './output.ts';

const DEFAULT_NUMBER_OF_LINES = 30;
const DEFAULT_TERMINAL_WIDTH = 80;

/** `--stack-size` is applied by re-launching under a V8 stack of that size. */
const STACK_SIZE_GUARD = 'DUST_STACK_SIZE_APPLIED';

export interface RunOptions {
  /**
   * Whether `--stack-size` may relaunch the process. Off for a run driven
   * in-process, which has no process of its own to replace.
   */
  allowRelaunch?: boolean;
}

function shouldInitColor(noColor: boolean, forceColor: boolean): boolean {
  if (forceColor) return true;
  if (noColor) return false;
  // check if NO_COLOR is set
  // https://no-color.org/
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (terminalSize() === null) {
    // we are not in a terminal, color may not be needed
    return false;
  }
  // we are in a terminal
  return true;
}

/** `terminal_size::terminal_size()`, which reports the size of stdout. */
function terminalSize(): { width: number; height: number } | null {
  if (process.stdout.isTTY !== true) return null;
  return { width: process.stdout.columns, height: process.stdout.rows };
}

function getHeightOfTerminal(): number {
  const size = terminalSize();
  // Windows CI runners detect a terminal height of 0
  const height =
    size === null ? DEFAULT_NUMBER_OF_LINES : Math.max(size.height, DEFAULT_NUMBER_OF_LINES);
  return height - 10;
}

function getWidthOfTerminal(): number {
  const size = terminalSize();
  return size === null ? DEFAULT_TERMINAL_WIDTH : size.width;
}

/**
 * `regex::Regex::new` for each pattern.
 *
 * `u` mode is the closer match to Rust's Unicode-by-default engine, but it
 * rejects escapes Rust accepts, so a pattern that will not compile under it
 * falls back to the looser mode rather than being rejected outright.
 */
function compileRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    try {
      return new RegExp(pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      eprintln(`Ignoring bad value for regex ${JSON.stringify(reason)}`);
      return exitWith(1);
    }
  }
}

function getRegexValue(maybeValue: readonly string[] | undefined): RegExp[] {
  return (maybeValue ?? []).map(compileRegex);
}

/** One complete run, from argv to exit status. */
async function dust(argv: readonly string[], runOptions: RunOptions): Promise<number> {
  const options = parseCli(argv);
  const conf = getConfig(options.config);

  const errors = newRuntimeErrors();

  applyStackSize(conf, options, runOptions);

  const files0From = config.getFiles0From(conf, options);
  const filesFrom = config.getFilesFrom(conf, options);
  let rawDirs: string[];
  if (files0From !== undefined) {
    rawDirs = readPathsFromSource(files0From, true);
  } else if (filesFrom !== undefined) {
    rawDirs = readPathsFromSource(filesFrom, false);
  } else {
    rawDirs = options.params ?? ['.'];
  }
  const targetDirs = rawDirs.filter((path) => path !== '');

  const summarizeFileTypes = options.fileTypes;

  const filterRegexs = getRegexValue(options.filter);
  const invertFilterRegexsFromCli = getRegexValue(options.invertFilter);

  const terminalWidth = options.terminalWidth ?? getWidthOfTerminal();

  const depth = config.getDepth(conf, options);

  // If depth is set, or the output is json (which is not rendered to a
  // terminal), then we set the default number_of_lines to be max
  // instead of screen height
  const configuredLines = config.getNumberOfLines(conf, options);
  const numberOfLines =
    configuredLines ??
    (depth !== USIZE_MAX || config.getOutputJson(conf, options)
      ? USIZE_MAX
      : getHeightOfTerminal());

  const isColors = shouldInitColor(
    config.getNoColors(conf, options),
    config.getForceColors(conf, options),
  );

  const ignoreDirectories = (options.ignoreDirectory ?? []).map(canonicalizeAbsolutePath);

  const ignoreFromFile: RegExp[] = [];
  if (options.ignoreAllInFile !== undefined) {
    // `read_to_string(..).unwrap()` in the original: an unreadable file aborts.
    const text = readToStringOrPanic(options.ignoreAllInFile);
    for (const line of splitLines(text)) {
      try {
        ignoreFromFile.push(new RegExp(line, 'u'));
      } catch {
        try {
          ignoreFromFile.push(new RegExp(line));
        } catch {
          // `filter_map(|x| x.ok())`: an unparsable line is simply dropped.
        }
      }
    }
  }

  const invertFilterRegexs = [...invertFilterRegexsFromCli, ...ignoreFromFile];

  const byFilecount = options.filecount;
  const byFiletime = config.getFiletime(conf, options);
  const limitFilesystem = config.getLimitFilesystem(conf, options);
  const followLinks = options.dereferenceLinks;

  const allowedFilesystems = limitFilesystem
    ? getFilesystemDevices(targetDirs, followLinks)
    : new Set<bigint>();

  const simplifiedDirs = simplifyDirNames(targetDirs);

  const ignoredFullPath = new Set<string>();
  for (const x of ignoreDirectories) {
    for (const d of simplifiedDirs) ignoredFullPath.add(pathKey(join(d, x)));
  }

  const outputFormat = config.getOutputFormat(conf, options);

  const ignoreHidden = config.getIgnoreHidden(conf, options);

  const indicator = PIndicator.buildMe();
  if (!config.getDisableProgress(conf, options)) indicator.spawn(outputFormat);

  const keepCollapsed = new Set<string>();
  for (const collapseDir of config.getCollapse(conf, options) ?? []) {
    for (const targetDir of targetDirs) keepCollapsed.add(pathKey(join(targetDir, collapseDir)));
  }

  const filterModifiedTime = config.getModifiedTimeOperator(conf, options);
  const filterAccessedTime = config.getAccessedTimeOperator(conf, options);
  const filterChangedTime = config.getChangedTimeOperator(conf, options);

  const walkData: WalkData = {
    ignoreDirectories: ignoredFullPath,
    filterRegex: filterRegexs,
    invertFilterRegex: invertFilterRegexs,
    allowedFilesystems,
    filterModifiedTime,
    filterAccessedTime,
    filterChangedTime,
    useApparentSize: config.getApparentSize(conf, options),
    byFilecount,
    byFiletime,
    ignoreHidden,
    followLinks,
    progressData: indicator.data,
    errors,
  };

  let tree: DisplayNode;
  try {
    const topLevelNodes = walkIt(simplifiedDirs, walkData);

    if (summarizeFileTypes) {
      tree = getAllFileTypes(topLevelNodes, numberOfLines, walkData.byFiletime);
    } else {
      const aggData: AggregateData = {
        minSize: config.getMinSize(conf, options),
        onlyDir: config.getOnlyDir(conf, options),
        onlyFile: config.getOnlyFile(conf, options),
        numberOfLines,
        depth,
        usingAFilter: filterRegexs.length > 0 || invertFilterRegexs.length > 0,
        shortPaths: !config.getFullPaths(conf, options),
      };
      tree = getBiggest(topLevelNodes, aggData, walkData.byFiletime, keepCollapsed);
    }
  } finally {
    // Must have stopped indicator before we print to stderr
    await indicator.stop();
  }

  const printErrors = config.getPrintErrors(conf, options);
  printAnyErrors(printErrors, walkData.errors);

  if (tree.children.length === 0 && walkData.errors.fileNotFound.size > 0) {
    return 1;
  }

  printOutput(conf, options, tree, walkData.byFilecount, isColors, terminalWidth);
  return 0;
}

/**
 * Run dust and report the status it would exit with, printing through the
 * sinks in `output.ts`.
 */
export async function run(argv: readonly string[], runOptions: RunOptions = {}): Promise<number> {
  try {
    const code = await dust(argv, runOptions);
    flushStdout();
    return code;
  } catch (error) {
    flushStdout();
    if (error instanceof ExitCode) return error.code;
    if (error instanceof ClapExit) {
      if (error.stream === 'stdout') printStdout(error.text);
      else eprintln(error.text.replace(/\n$/, ''));
      flushStdout();
      return error.code;
    }
    if (error instanceof Panic) {
      eprintln(renderPanic(error.message).replace(/\n$/, ''));
      return PANIC_EXIT_CODE;
    }
    throw error;
  }
}

function printOutput(
  conf: Config,
  options: Cli,
  tree: DisplayNode,
  byFilecount: boolean,
  isColors: boolean,
  terminalWidth: number,
): void {
  const outputFormat = config.getOutputFormat(conf, options);

  if (config.getOutputJson(conf, options)) {
    const outputType = byFilecount ? 'count' : outputFormat;
    println(JSON.stringify(toJsonValue(tree, outputType)));
    return;
  }

  const idd: InitialDisplayData = {
    shortPaths: !config.getFullPaths(conf, options),
    isReversed: !config.getReverse(conf, options),
    colorsOn: isColors,
    dim: config.getDim(conf, options),
    byFilecount,
    byFiletime: config.getFiletime(conf, options),
    isScreenReader: config.getScreenReader(conf, options),
    outputFormat,
    barsOnRight: config.getBarsOnRight(conf, options),
  };

  drawIt(
    idd,
    tree,
    config.getNoBars(conf, options),
    terminalWidth,
    config.getSkipTotal(conf, options),
    println,
  );
}

function printAnyErrors(printErrors: boolean, finalErrors: RuntimeErrors): void {
  if (finalErrors.fileNotFound.size > 0) {
    const err = [...finalErrors.fileNotFound].join(', ');
    eprintln(`No such file or directory: ${err}`);
  }
  if (finalErrors.noPermissions.size > 0) {
    if (printErrors) {
      const err = [...finalErrors.noPermissions].join(', ');
      eprintln(`Did not have permissions for directories: ${err}`);
    } else {
      eprintln('Did not have permissions for all directories (add --print-errors to see errors)');
    }
  }
  if (finalErrors.unknownError.size > 0) {
    const err = [...finalErrors.unknownError].join(', ');
    eprintln(`Unknown Error: ${err}`);
  }
}

/** `str::lines()`: split on `\n`, dropping one trailing `\r` and the final empty piece. */
function splitLines(text: string): string[] {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function readToStringOrPanic(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (error) {
    throw new Panic(`called \`Result::unwrap()\` on an \`Err\` value: ${ioErrorDebug(error)}`);
  }
}

function readPathsFromSource(path: string, nullTerminated: boolean): string[] {
  const fromStdin = path === '-';

  let bytes: Buffer;
  try {
    bytes = fromStdin ? readStdin() : fs.readFileSync(path);
  } catch (error) {
    if (fromStdin) {
      eprintln('No files provided, defaulting to current directory');
      return ['.'];
    }
    eprintln(`Failed to read file: ${ioErrorString(error)}`);
    return ['.'];
  }

  const utf8Error = utf8ErrorMessage(bytes);
  if (utf8Error !== null) {
    if (fromStdin) {
      eprintln('No files provided, defaulting to current directory');
    } else {
      eprintln(`Failed to read file: ${utf8Error}`);
    }
    return ['.'];
  }
  const text = bytes.toString('utf8');

  const items = nullTerminated ? text.split('\0').filter((s) => s !== '') : splitLines(text);

  if (fromStdin && items.length === 0) {
    eprintln('No files provided, defaulting to current directory');
    return ['.'];
  }
  return items;
}

/**
 * `--stack-size` in the original sizes the rayon worker threads' stacks. V8's
 * stack size can only be chosen at startup, so honouring the flag means
 * relaunching this program under it once.
 */
function applyStackSize(conf: Config, options: Cli, runOptions: RunOptions): void {
  const stackSize = config.getCustomStackSize(conf, options);
  if (stackSize === undefined) return;
  if (runOptions.allowRelaunch !== true) return;
  if (process.env[STACK_SIZE_GUARD] !== undefined) return;

  const result = spawnSync(
    process.execPath,
    [`--stack-size=${String(Math.floor(stackSize / 1024))}`, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, [STACK_SIZE_GUARD]: '1' } },
  );
  throw new ExitCode(result.status ?? 1);
}

/** The Ctrl-C handler: `println!("\nAborting")` on stdout, then exit 1. */
export function abort(): never {
  println('\nAborting');
  flushStdout();
  process.exit(1);
}

// True only when this file is the program being run, so importing it from a
// test does not start a walk.
if (import.meta.main) {
  process.on('SIGINT', abort);
  process.exit(await run(process.argv.slice(2), { allowRelaunch: true }));
}
