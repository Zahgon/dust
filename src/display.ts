import * as fs from 'node:fs';

import type { DisplayNode } from './displayNode.ts';
import { getChildrenFromNode, numSiblings } from './displayNode.ts';
import type { FileTime } from './node.ts';
import { panic } from './panic.ts';

import * as ansi from './deps/ansi.ts';
import { LsColors, type FileFacts } from './deps/lscolors.ts';
import { divF32, formatFixed, isNormalF32, mulF32 } from './deps/rustFloat.ts';
import { encodeU8 } from './deps/stfu8.ts';
import { separateWithCommas } from './deps/thousands.ts';
import { charWidth, strWidth } from './deps/unicodeWidth.ts';
import { parent as pathParent, stripPrefix } from './deps/rustPath.ts';

export const SI_UNITS = ['P', 'T', 'G', 'M', 'K'] as const;
export const IEC_UNITS = ['Pi', 'Ti', 'Gi', 'Mi', 'Ki'] as const;
const BLOCKS = ['█', '▓', '▒', '░', ' '] as const;
const FILETIME_SHOW_LENGTH = 19;

export interface InitialDisplayData {
  shortPaths: boolean;
  isReversed: boolean;
  colorsOn: boolean;
  dim: boolean;
  byFilecount: boolean;
  byFiletime: FileTime | null;
  isScreenReader: boolean;
  outputFormat: string;
  barsOnRight: boolean;
}

export interface DisplayData {
  initial: InitialDisplayData;
  numCharsNeededOnLeftMost: number;
  baseSize: number;
  longestStringLength: number;
  lsColors: LsColors;
}

function getTreeChars(data: DisplayData, wasILast: boolean, hasChildren: boolean): string {
  if (data.initial.isReversed) {
    if (wasILast) return hasChildren ? '┌─┴' : '┌──';
    return hasChildren ? '├─┴' : '├──';
  }
  if (wasILast) return hasChildren ? '└─┬' : '└──';
  return hasChildren ? '├─┬' : '├──';
}

function isBiggest(data: DisplayData, numSiblingsSoFar: number, maxSiblings: number): boolean {
  return data.initial.isReversed ? numSiblingsSoFar === maxSiblings - 1 : numSiblingsSoFar === 0;
}

function isLast(data: DisplayData, numSiblingsSoFar: number, maxSiblings: number): boolean {
  return data.initial.isReversed ? numSiblingsSoFar === 0 : numSiblingsSoFar === maxSiblings - 1;
}

/** `node.size / base_size` in `f32`, with anything not normal flattened to 0. */
function percentSize(data: DisplayData, node: DisplayNode): number {
  const result = divF32(node.size, data.baseSize);
  return isNormalF32(result) ? result : 0;
}

export interface DrawData {
  indent: string;
  percentBar: string;
  displayData: DisplayData;
}

function getNewIndent(draw: DrawData, hasChildren: boolean, wasILast: boolean): string {
  return draw.indent + getTreeChars(draw.displayData, wasILast, hasChildren);
}

// TODO: can we test this?
export function generateBar(draw: DrawData, node: DisplayNode, level: number): string {
  if (draw.displayData.initial.isScreenReader) return String(level);

  const chars = [...draw.percentBar];
  const charsInBar = chars.length;
  const numBars = mulF32(charsInBar, percentSize(draw.displayData, node));
  let numNotMyBar = charsInBar - Math.trunc(numBars);

  let newBar = '';
  const idx = 5 - Math.min(Math.max(level, 1), 4);
  const iter = draw.displayData.initial.barsOnRight ? chars : [...chars].reverse();

  for (const c of iter) {
    numNotMyBar -= 1;
    if (numNotMyBar <= 0) newBar += BLOCKS[0];
    else if (c === BLOCKS[0]) newBar += BLOCKS[idx];
    else newBar += c;
  }
  return draw.displayData.initial.barsOnRight ? newBar : [...newBar].reverse().join('');
}

export function drawIt(
  idd: InitialDisplayData,
  rootNode: DisplayNode,
  noPercentBars: boolean,
  terminalWidth: number,
  skipTotal: boolean,
  write: (line: string) => void,
): void {
  let numCharsNeededOnLeftMost: number;
  if (idd.byFilecount) {
    numCharsNeededOnLeftMost = [...separateWithCommas(rootNode.size)].length;
  } else if (idd.byFiletime !== null) {
    numCharsNeededOnLeftMost = FILETIME_SHOW_LENGTH;
  } else {
    numCharsNeededOnLeftMost = findBiggestSizeStr(rootNode, idd.outputFormat);
  }

  if (!(terminalWidth > numCharsNeededOnLeftMost + 2)) panic('Not enough terminal width');

  const allowedWidth = terminalWidth - numCharsNeededOnLeftMost - 2;
  const numIndentChars = 3;
  const longestStringLength = findLongestDirName(rootNode, numIndentChars, allowedWidth, idd);

  const maxBarLength =
    noPercentBars || longestStringLength + 7 >= allowedWidth
      ? 0
      : allowedWidth - longestStringLength - 7;

  const firstSizeBar = BLOCKS[0].repeat(maxBarLength);

  const displayData: DisplayData = {
    initial: idd,
    numCharsNeededOnLeftMost,
    baseSize: rootNode.size,
    longestStringLength,
    lsColors: LsColors.fromEnvOrDefault(process.env),
  };
  const drawData: DrawData = {
    indent: '',
    percentBar: firstSizeBar,
    displayData,
  };

  if (!skipTotal) {
    displayNode(rootNode, drawData, true, true, write);
  } else {
    const children = getChildrenFromNode(rootNode, drawData.displayData.initial.isReversed);
    children.forEach((c, count) => {
      const biggest = isBiggest(displayData, count, numSiblings(rootNode));
      const wasILast = isLast(displayData, count, numSiblings(rootNode));
      displayNode(c, drawData, biggest, wasILast, write);
    });
  }
}

function findBiggestSizeStr(node: DisplayNode, outputFormat: string): number {
  let mx = [...humanReadableNumber(node.size, outputFormat)].length;
  for (const n of node.children) {
    mx = Math.max(mx, findBiggestSizeStr(n, outputFormat));
  }
  return mx;
}

function findLongestDirName(
  node: DisplayNode,
  indent: number,
  terminal: number,
  idd: InitialDisplayData,
): number {
  const printableName = getPrintableName(node.name, idd.shortPaths);

  const longest = idd.isScreenReader
    ? strWidth(printableName) + 1
    : Math.min(strWidth(printableName) + 1 + indent, terminal);

  // each none root tree drawing is 2 more chars, hence we increment indent by 2
  return node.children.reduce(
    (acc, c) => Math.max(acc, findLongestDirName(c, indent + 2, terminal, idd)),
    longest,
  );
}

function displayNode(
  node: DisplayNode,
  drawData: DrawData,
  biggest: boolean,
  last: boolean,
  write: (line: string) => void,
): void {
  // hacky way of working out how deep we are in the tree
  const indent = getNewIndent(drawData, node.children.length > 0, last);
  const level = Math.floor(([...indent].length - 1) / 2) - 1;
  const barText = generateBar(drawData, node, level);

  const toPrint = formatString(node, indent, barText, biggest, drawData.displayData);

  if (!drawData.displayData.initial.isReversed) write(toPrint);

  const dd: DrawData = {
    indent: cleanIndentationString(indent),
    percentBar: barText,
    displayData: drawData.displayData,
  };

  const siblings = numSiblings(node);
  const children = getChildrenFromNode(node, drawData.displayData.initial.isReversed);
  children.forEach((c, count) => {
    const childBiggest = isBiggest(dd.displayData, count, siblings);
    const childLast = isLast(dd.displayData, count, siblings);
    displayNode(c, dd, childBiggest, childLast, write);
  });

  if (drawData.displayData.initial.isReversed) write(toPrint);
}

function cleanIndentationString(s: string): string {
  let is = s;
  // For reversed:
  is = is.replaceAll('┌─┴', '  ');
  is = is.replaceAll('┌──', '  ');
  is = is.replaceAll('├─┴', '│ ');
  is = is.replaceAll('─┴', ' ');
  // For normal
  is = is.replaceAll('└─┬', '  ');
  is = is.replaceAll('└──', '  ');
  is = is.replaceAll('├─┬', '│ ');
  is = is.replaceAll('─┬', ' ');
  // For both
  is = is.replaceAll('├──', '│ ');
  return is;
}

export function getPrintableName(dirName: string, shortPaths: boolean): string {
  let printableName = dirName;
  if (shortPaths) {
    const prefix = pathParent(dirName);
    if (prefix !== null) {
      const base = stripPrefix(dirName, prefix);
      if (base !== null) printableName = base;
    }
  }
  return encodeU8(printableName);
}

function padOrTrimFilename(node: DisplayNode, indent: string, displayData: DisplayData): string {
  const name = getPrintableName(node.name, displayData.initial.shortPaths);
  const indentAndName = `${indent} ${name}`;
  const width = strWidth(indentAndName);

  if (!(displayData.longestStringLength >= width)) {
    panic('Terminal width not wide enough to draw directory tree');
  }

  // Add spaces after the filename so we can draw the % used bar chart.
  return name + ' '.repeat(displayData.longestStringLength - width);
}

function maybeTrimFilename(nameIn: string, indent: string, displayData: DisplayData): string {
  const indentLength = strWidth(indent);
  if (!(displayData.longestStringLength >= indentLength + 2)) {
    panic('Terminal width not wide enough to draw directory tree');
  }

  const maxSize = displayData.longestStringLength - indentLength;
  if (strWidth(nameIn) > maxSize) {
    // Truncate by display width, not by char count: wide characters (CJK,
    // emoji) take 2 columns each, so taking 'n' chars can overflow the line.
    let widthLeft = maxSize - 2;
    let name = '';
    for (const c of nameIn) {
      const width = charWidth(c.codePointAt(0) as number) ?? 0;
      if (width > widthLeft) break;
      widthLeft -= width;
      name += c;
    }
    return name + '..';
  }
  return nameIn;
}

export function formatString(
  node: DisplayNode,
  indent: string,
  bars: string,
  biggest: boolean,
  displayData: DisplayData,
): string {
  const [percent, nameAndPadding] = getNamePercent(node, indent, bars, displayData);
  const prettySize = getPrettySize(node, biggest, displayData);
  const prettyName = getPrettyName(node, nameAndPadding, displayData);
  // we can clean this and the method below somehow, not sure yet
  if (displayData.initial.isScreenReader) {
    // if screen_reader then bars is 'depth'
    return `${prettyName} ${bars} ${prettySize}${percent}`;
  }
  if (displayData.initial.byFiletime !== null) {
    return `${prettySize} ${indent}${prettyName}`;
  }
  return `${prettySize} ${indent} ${prettyName}${percent}`;
}

function getNamePercent(
  node: DisplayNode,
  indent: string,
  barChart: string,
  displayData: DisplayData,
): [string, string] {
  if (displayData.initial.isScreenReader) {
    const percent = mulF32(percentSize(displayData, node), 100);
    const percentSizeStr = `${formatFixed(percent, 0)}%`;
    const percents = ` ${percentSizeStr.padStart(4)}`;
    const name = padOrTrimFilename(node, '', displayData);
    return [percents, name];
  }
  // Bar chart being empty may come from either config or the screen not being wide enough
  if (barChart !== '') {
    const percent = mulF32(percentSize(displayData, node), 100);
    const percentSizeStr = `${formatFixed(percent, 0)}%`;
    const coloredBar = displayData.initial.dim
      ? ansi.paintColor(ansi.DarkGray, barChart)
      : barChart;
    const percents = `│${coloredBar} │ ${percentSizeStr.padStart(4)}`;
    const nameAndPadding = padOrTrimFilename(node, indent, displayData);
    return [percents, nameAndPadding];
  }
  const n = getPrintableName(node.name, displayData.initial.shortPaths);
  const name = maybeTrimFilename(n, indent, displayData);
  return ['', name];
}

function getPrettySize(node: DisplayNode, biggest: boolean, displayData: DisplayData): string {
  let output: string;
  if (displayData.initial.byFilecount) {
    output = separateWithCommas(node.size);
  } else if (displayData.initial.byFiletime !== null) {
    output = getPrettyFileModifiedTime(node.size);
  } else {
    output = humanReadableNumber(node.size, displayData.initial.outputFormat);
  }
  const spacesToAdd = displayData.numCharsNeededOnLeftMost - [...output].length;
  output = ' '.repeat(Math.max(spacesToAdd, 0)) + output;

  if (biggest && displayData.initial.colorsOn) return ansi.paintColor(ansi.Red, output);
  return output;
}

/** `%Y-%m-%dT%H:%M:%S` in local time, from a unix timestamp in seconds. */
export function getPrettyFileModifiedTime(timestamp: number): string {
  const local = new Date(timestamp * 1000);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${pad(local.getFullYear(), 4)}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}` +
    `T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`
  );
}

function getPrettyName(
  node: DisplayNode,
  nameAndPadding: string,
  displayData: DisplayData,
): string {
  if (!displayData.initial.colorsOn) return nameAndPadding;

  // `fs::metadata` follows symlinks, so a link is styled as its target.
  const facts = statFacts(node.name);
  const style = displayData.lsColors.styleForPathWithMetadata(node.name, facts);
  return ansi.paint(style ?? ansi.PLAIN, nameAndPadding);
}

function statFacts(path: string): FileFacts | null {
  const stat = fs.statSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return null;
  return {
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink(),
    isFIFO: stat.isFIFO(),
    isSocket: stat.isSocket(),
    isBlockDevice: stat.isBlockDevice(),
    isCharacterDevice: stat.isCharacterDevice(),
    mode: stat.mode,
    nlink: stat.nlink,
  };
}

export function getUnits(outputStr: string): readonly string[] {
  return getTypeOfThousand(outputStr) === IEC_BASE ? IEC_UNITS : SI_UNITS;
}

/** The two bases a size can be reckoned in: binary, and decimal for `si`. */
const IEC_BASE = 1024;
const SI_BASE = 1000;

// If we are working with SI units or not
export function getTypeOfThousand(outputStr: string): number {
  if (outputStr === '') return IEC_BASE;
  if (outputStr === 'si') return SI_BASE;
  if (outputStr.includes('i') || outputStr.length === 1) return IEC_BASE;
  return SI_BASE;
}

export function getNumberFormat(outputStr: string): [number, string] | null {
  if (outputStr.startsWith('b')) return [1, 'B'];
  const units = getUnits(outputStr);
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as string;
    if (outputStr.startsWith((u[0] as string).toLowerCase())) {
      const thousand = getTypeOfThousand(outputStr);
      const marker = thousand ** (units.length - i);
      return [marker, u];
    }
  }
  return null;
}

export function humanReadableNumber(size: number, outputStr: string): string {
  if (outputStr === 'count') return String(size);

  const format = getNumberFormat(outputStr);
  if (format !== null) {
    const [x, u] = format;
    return `${String(Math.floor(size / x))}${u}`;
  }

  const units = getUnits(outputStr);
  const thousand = getTypeOfThousand(outputStr);
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as string;
    const marker = thousand ** (units.length - i);
    if (size >= marker) {
      if (Math.floor(size / marker) < 10) {
        return `${formatFixed(divF32(size, marker), 1)}${u}`;
      }
      return `${String(Math.floor(size / marker))}${u}`;
    }
  }
  return `${String(size)}B`;
}
