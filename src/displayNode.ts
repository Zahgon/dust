import { humanReadableNumber } from './display.ts';
import { comparePaths } from './deps/rustPath.ts';

export interface DisplayNode {
  // Note: the order of fields is important here, for PartialEq and PartialOrd
  size: number;
  name: string;
  children: DisplayNode[];
}

export function numSiblings(node: DisplayNode): number {
  return node.children.length;
}

export function getChildrenFromNode(node: DisplayNode, isReversed: boolean): DisplayNode[] {
  return isReversed ? [...node.children].reverse() : node.children;
}

/** `Ord for DisplayNode`, derived over `(size, name, children)` in that order. */
export function compareDisplayNodes(a: DisplayNode, b: DisplayNode): number {
  if (a.size !== b.size) return a.size < b.size ? -1 : 1;
  const byName = comparePaths(a.name, b.name);
  if (byName !== 0) return byName;
  const shared = Math.min(a.children.length, b.children.length);
  for (let i = 0; i < shared; i++) {
    const ordering = compareDisplayNodes(a.children[i] as DisplayNode, b.children[i] as DisplayNode);
    if (ordering !== 0) return ordering;
  }
  return a.children.length === b.children.length
    ? 0
    : a.children.length < b.children.length
      ? -1
      : 1;
}

/*
We need the custom serializer in case someone uses the -o flag to pass a custom
output type in (show size in Mb / Gb etc). In the original this needed a thread
local, because serde gives the `Serialize` impl nowhere to receive the flag; here
it is simply a parameter.
*/

/** The JSON document `-j/--output-json` prints, with sizes already rendered. */
export function toJsonValue(node: DisplayNode, outputType: string): unknown {
  return {
    size: humanReadableNumber(node.size, outputType),
    name: node.name,
    children: node.children.map((child) => toJsonValue(child, outputType)),
  };
}
