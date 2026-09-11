// For single thread mode set this variable on your command line:
// export RAYON_NUM_THREADS=1

import { Command, type CommandSpec, type ParsedArgs } from './deps/clap.ts';

/** `-o/--output-format`; the names are also what `Display for OutputFormat` prints. */
export const OutputFormat = {
  SI: 'si',
  B: 'b',
  KiB: 'k',
  MiB: 'm',
  GiB: 'g',
  TiB: 't',
  KB: 'kb',
  MB: 'mb',
  GB: 'gb',
  TB: 'tb',
} as const;

export type OutputFormat = (typeof OutputFormat)[keyof typeof OutputFormat];

/** `-m/--filetime`. */
export const CliFileTime = {
  Accessed: 'a',
  Changed: 'c',
  Modified: 'm',
} as const;

export type CliFileTime = (typeof CliFileTime)[keyof typeof CliFileTime];

/** The parsed command line, one field per `Cli` struct member. */
export interface Cli {
  /** Depth to show */
  depth?: number | undefined;
  /** Number of threads to use */
  threads?: number | undefined;
  /** Specify a config file to use */
  config?: string | undefined;
  /** Display the 'n' largest entries. (Default is terminal_height) */
  numberOfLines?: number | undefined;
  /** Subdirectories will not have their path shortened */
  fullPaths: boolean;
  /** Exclude any file or directory with this path */
  ignoreDirectory?: string[] | undefined;
  /** Exclude any file or directory with a regex matching that listed in this file */
  ignoreAllInFile?: string | undefined;
  /** dereference sym links - Treat sym links as directories and go into them */
  dereferenceLinks: boolean;
  /** Only count the files and directories on the same filesystem */
  limitFilesystem: boolean;
  /** Use file length instead of blocks */
  apparentSize: boolean;
  /** Print tree upside down (biggest highest) */
  reverse: boolean;
  /** No colors will be printed */
  noColors: boolean;
  /** Force colors print */
  forceColors: boolean;
  /** Dim the percent bars (grey) */
  dim: boolean;
  /** No percent bars or percentages will be displayed */
  noPercentBars: boolean;
  /** percent bars moved to right side of screen */
  barsOnRight: boolean;
  /** Minimum size file to include in output */
  minSize?: string | undefined;
  /** For screen readers */
  screenReader: boolean;
  /** No total row will be displayed */
  skipTotal: boolean;
  /** Directory 'size' is number of child files instead of disk size */
  filecount: boolean;
  /** Do not display hidden files */
  ignoreHidden: boolean;
  /** Exclude filepaths matching this regex */
  invertFilter?: string[] | undefined;
  /** Only include filepaths matching this regex */
  filter?: string[] | undefined;
  /** show only these file types */
  fileTypes: boolean;
  /** Specify width of output overriding the auto detection of terminal width */
  terminalWidth?: number | undefined;
  /** Disable the progress indication */
  noProgress: boolean;
  /** Print path with errors */
  printErrors: boolean;
  /** Only directories will be displayed */
  onlyDir: boolean;
  /** Only files will be displayed */
  onlyFile: boolean;
  /** Changes output display size */
  outputFormat?: OutputFormat | undefined;
  /** Specify memory to use as stack size */
  stackSize?: number | undefined;
  /** Input files or directories */
  params?: string[] | undefined;
  /** Output the directory tree as json to the current directory */
  outputJson: boolean;
  /** Files modified more/less than n days ago */
  mtime?: string | undefined;
  /** Like mtime, but based on file access time */
  atime?: string | undefined;
  /** Like mtime, but based on file change time */
  ctime?: string | undefined;
  /** Read NUL-terminated paths from FILE */
  files0From?: string | undefined;
  /** Read newline-terminated paths from FILE */
  filesFrom?: string | undefined;
  /** Keep these directories collapsed */
  collapse?: string[] | undefined;
  /** Directory 'size' is max filetime of child files instead of disk size */
  filetime?: CliFileTime | undefined;
}

/**
 * The command definition, transcribed from the `Cli` derive. Order matters: it
 * is the order the two help layouts list the options in.
 */
export const COMMAND_SPEC: CommandSpec = {
  displayName: 'Dust',
  binName: 'dust',
  version: '1.2.5',
  about: 'Like du but more intuitive',
  positional: {
    id: 'params',
    valueName: 'PATH',
    help: 'Input files or directories',
    valueHint: 'AnyPath',
  },
  args: [
    { id: 'depth', short: 'd', long: 'depth', valueName: 'DEPTH', numeric: true, help: 'Depth to show' },
    { id: 'threads', short: 'T', long: 'threads', valueName: 'THREADS', numeric: true, help: 'Number of threads to use' },
    { id: 'config', long: 'config', valueName: 'FILE', valueHint: 'FilePath', help: 'Specify a config file to use' },
    { id: 'number_of_lines', short: 'n', long: 'number-of-lines', valueName: 'NUMBER', numeric: true, help: "Display the 'n' largest entries. (Default is terminal_height)" },
    { id: 'full_paths', short: 'p', long: 'full-paths', help: 'Subdirectories will not have their path shortened' },
    { id: 'ignore_directory', short: 'X', long: 'ignore-directory', valueName: 'PATH', valueHint: 'AnyPath', multiple: true, help: 'Exclude any file or directory with this path' },
    { id: 'ignore_all_in_file', short: 'I', long: 'ignore-all-in-file', valueName: 'FILE', valueHint: 'FilePath', help: 'Exclude any file or directory with a regex matching that listed in this file, the file entries will be added to the ignore regexs provided by --invert_filter' },
    { id: 'dereference_links', short: 'L', long: 'dereference-links', help: 'dereference sym links - Treat sym links as directories and go into them' },
    { id: 'limit_filesystem', short: 'x', long: 'limit-filesystem', help: 'Only count the files and directories on the same filesystem as the supplied directory' },
    { id: 'apparent_size', short: 's', long: 'apparent-size', help: 'Use file length instead of blocks' },
    { id: 'reverse', short: 'r', long: 'reverse', help: 'Print tree upside down (biggest highest)' },
    { id: 'no_colors', short: 'c', long: 'no-colors', help: 'No colors will be printed (Useful for commands like: watch)' },
    { id: 'force_colors', short: 'C', long: 'force-colors', help: 'Force colors print' },
    { id: 'dim', long: 'dim', help: 'Dim the percent bars (grey) to reduce brightness on dark terminals' },
    { id: 'no_percent_bars', short: 'b', long: 'no-percent-bars', help: 'No percent bars or percentages will be displayed' },
    { id: 'bars_on_right', short: 'B', long: 'bars-on-right', help: 'percent bars moved to right side of screen' },
    { id: 'min_size', short: 'z', long: 'min-size', valueName: 'MIN_SIZE', help: 'Minimum size file to include in output' },
    { id: 'screen_reader', short: 'R', long: 'screen-reader', help: 'For screen readers. Removes bars. Adds new column: depth level (May want to use -p too for full path)' },
    { id: 'skip_total', long: 'skip-total', help: 'No total row will be displayed' },
    { id: 'filecount', short: 'f', long: 'filecount', help: "Directory 'size' is number of child files instead of disk size" },
    { id: 'ignore_hidden', short: 'i', long: 'ignore-hidden', help: 'Do not display hidden files' },
    { id: 'invert_filter', short: 'v', long: 'invert-filter', valueName: 'REGEX', multiple: true, conflictsWith: ['filter', 'file_types'], help: 'Exclude filepaths matching this regex. To ignore png files type: -v "\\.png$"' },
    { id: 'filter', short: 'e', long: 'filter', valueName: 'REGEX', multiple: true, conflictsWith: ['file_types'], help: 'Only include filepaths matching this regex. For png files type: -e "\\.png$"' },
    { id: 'file_types', short: 't', long: 'file-types', conflictsWith: ['depth', 'only_dir'], help: 'show only these file types' },
    { id: 'terminal_width', short: 'w', long: 'terminal-width', valueName: 'WIDTH', numeric: true, help: 'Specify width of output overriding the auto detection of terminal width' },
    { id: 'no_progress', short: 'P', long: 'no-progress', help: 'Disable the progress indication' },
    { id: 'print_errors', long: 'print-errors', help: 'Print path with errors' },
    { id: 'only_dir', short: 'D', long: 'only-dir', conflictsWith: ['only_file', 'file_types'], help: 'Only directories will be displayed' },
    { id: 'only_file', short: 'F', long: 'only-file', conflictsWith: ['only_dir'], help: 'Only files will be displayed. (Finds your largest files)' },
    {
      id: 'output_format',
      short: 'o',
      long: 'output-format',
      valueName: 'FORMAT',
      ignoreCase: true,
      help: 'Changes output display size. si will print sizes in powers of 1000. b k m g t kb mb gb tb will print the whole tree in that size',
      possibleValues: [
        { name: 'si', help: 'SI prefix (powers of 1000)' },
        { name: 'b', help: 'byte (B)' },
        { name: 'k', aliases: ['kib'], help: 'kibibyte (KiB)' },
        { name: 'm', aliases: ['mib'], help: 'mebibyte (MiB)' },
        { name: 'g', aliases: ['gib'], help: 'gibibyte (GiB)' },
        { name: 't', aliases: ['tib'], help: 'tebibyte (TiB)' },
        { name: 'kb', help: 'kilobyte (kB)' },
        { name: 'mb', help: 'megabyte (MB)' },
        { name: 'gb', help: 'gigabyte (GB)' },
        { name: 'tb', help: 'terabyte (TB)' },
      ],
    },
    { id: 'stack_size', short: 'S', long: 'stack-size', valueName: 'STACK_SIZE', numeric: true, help: "Specify memory to use as stack size - use if you see: 'fatal runtime error: stack overflow' (default low memory=1048576, high memory=1073741824)" },
    { id: 'output_json', short: 'j', long: 'output-json', help: 'Output the directory tree as json to the current directory' },
    { id: 'mtime', short: 'M', long: 'mtime', valueName: 'MTIME', allowHyphenValues: true, help: '+/-n matches files modified more/less than n days ago , and n matches files modified exactly n days ago, days are rounded down.That is +n => (−∞, curr−(n+1)), n => [curr−(n+1), curr−n), and -n => (𝑐𝑢𝑟𝑟−𝑛, +∞)' },
    { id: 'atime', short: 'A', long: 'atime', valueName: 'ATIME', allowHyphenValues: true, help: 'just like -mtime, but based on file access time' },
    { id: 'ctime', short: 'y', long: 'ctime', valueName: 'CTIME', allowHyphenValues: true, help: 'just like -mtime, but based on file change time' },
    { id: 'files0_from', long: 'files0-from', valueName: 'FILES0_FROM', valueHint: 'AnyPath', conflictsWith: ['files_from'], help: 'Read NUL-terminated paths from FILE (use `-` for stdin)' },
    { id: 'files_from', long: 'files-from', valueName: 'FILES_FROM', valueHint: 'AnyPath', conflictsWith: ['files0_from'], help: 'Read newline-terminated paths from FILE (use `-` for stdin)' },
    { id: 'collapse', long: 'collapse', valueName: 'COLLAPSE', valueHint: 'AnyPath', multiple: true, help: 'Keep these directories collapsed' },
    {
      id: 'filetime',
      short: 'm',
      long: 'filetime',
      valueName: 'FILETIME',
      help: "Directory 'size' is max filetime of child files instead of disk size. while a/c/m for last accessed/changed/modified time",
      possibleValues: [
        { name: 'a', aliases: ['accessed'], help: 'last accessed time' },
        { name: 'c', aliases: ['changed'], help: 'last changed time' },
        { name: 'm', aliases: ['modified'], help: 'last modified time' },
      ],
    },
  ],
};

export const COMMAND = new Command(COMMAND_SPEC);

function toCli(parsed: ParsedArgs): Cli {
  const flag = (id: string): boolean => parsed.values.has(id);
  const one = (id: string): string | undefined => parsed.values.get(id)?.[0];
  const many = (id: string): string[] | undefined => parsed.values.get(id);
  const num = (id: string): number | undefined => {
    const raw = one(id);
    return raw === undefined ? undefined : Number(raw);
  };

  return {
    depth: num('depth'),
    threads: num('threads'),
    config: one('config'),
    numberOfLines: num('number_of_lines'),
    fullPaths: flag('full_paths'),
    ignoreDirectory: many('ignore_directory'),
    ignoreAllInFile: one('ignore_all_in_file'),
    dereferenceLinks: flag('dereference_links'),
    limitFilesystem: flag('limit_filesystem'),
    apparentSize: flag('apparent_size'),
    reverse: flag('reverse'),
    noColors: flag('no_colors'),
    forceColors: flag('force_colors'),
    dim: flag('dim'),
    noPercentBars: flag('no_percent_bars'),
    barsOnRight: flag('bars_on_right'),
    minSize: one('min_size'),
    screenReader: flag('screen_reader'),
    skipTotal: flag('skip_total'),
    filecount: flag('filecount'),
    ignoreHidden: flag('ignore_hidden'),
    invertFilter: many('invert_filter'),
    filter: many('filter'),
    fileTypes: flag('file_types'),
    terminalWidth: num('terminal_width'),
    noProgress: flag('no_progress'),
    printErrors: flag('print_errors'),
    onlyDir: flag('only_dir'),
    onlyFile: flag('only_file'),
    outputFormat: one('output_format') as OutputFormat | undefined,
    stackSize: num('stack_size'),
    params: parsed.positional.length > 0 ? [...parsed.positional] : undefined,
    outputJson: flag('output_json'),
    mtime: one('mtime'),
    atime: one('atime'),
    ctime: one('ctime'),
    files0From: one('files0_from'),
    filesFrom: one('files_from'),
    collapse: many('collapse'),
    filetime: one('filetime') as CliFileTime | undefined,
  };
}

/** `Cli::parse()`. */
export function parseCli(argv: readonly string[]): Cli {
  return toCli(COMMAND.parse(argv));
}

/** `Cli::parse_from(args)` — the tests' entry point, so it skips the program name. */
export function parseCliFrom(args: readonly string[]): Cli {
  return toCli(COMMAND.parse(args.slice(1)));
}
