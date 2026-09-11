import type { DisplayNode } from './displayNode.ts';
import { compareDisplayNodes } from './displayNode.ts';
import type { FileTime } from './node.ts';
import type { Node } from './node.ts';
import { extension } from './deps/rustPath.ts';
import { compareBytes } from './deps/rustPath.ts';
import { isFileOnDisk } from './fsPredicates.ts';

interface ExtensionNode {
  size: number;
  /** `null` stands for `None`, which sorts before every real extension. */
  extension: string | null;
}

/** `Ord` over `(size, extension)`, with `None` ordering before `Some`. */
function compareExtensionNodes(a: ExtensionNode, b: ExtensionNode): number {
  if (a.size !== b.size) return a.size < b.size ? -1 : 1;
  if (a.extension === null || b.extension === null) {
    if (a.extension === b.extension) return 0;
    return a.extension === null ? -1 : 1;
  }
  return compareBytes(a.extension, b.extension);
}

export function getAllFileTypes(
  topLevelNodes: readonly Node[],
  n: number,
  byFiletime: FileTime | null,
): DisplayNode {
  const extensionCumulativeSizes = new Map<string | null, number>();
  buildByAllFileTypes(topLevelNodes, extensionCumulativeSizes, byFiletime);

  const extNodes: ExtensionNode[] = [...extensionCumulativeSizes].map(([ext, size]) => ({
    extension: ext,
    size,
  }));
  extNodes.sort((lhs, rhs) => -compareExtensionNodes(lhs, rhs));

  // First, collect the first N - 1 nodes...
  const take = n > 1 ? n - 1 : 1;
  const displayed: DisplayNode[] = extNodes.slice(0, take).map((node) => ({
    name: node.extension === null ? '(no extension)' : `.${node.extension}`,
    size: node.size,
    children: [],
  }));

  // ...then, aggregate the remaining nodes (if any) into a single "(others)" node
  const rest = extNodes.slice(take);
  if (rest.length > 0) {
    const actualSize =
      byFiletime !== null
        ? rest.reduce((acc, node) => Math.max(acc, node.size), 0)
        : rest.reduce((acc, node) => acc + node.size, 0);
    displayed.push({ name: '(others)', size: actualSize, children: [] });
    // '(others)' is the sum of the remaining nodes so it can be bigger than
    // the nodes above it: re-sort so the tree stays in size order.
    displayed.sort((lhs, rhs) => -compareDisplayNodes(lhs, rhs));
  }

  const actualSize =
    byFiletime !== null
      ? displayed.reduce((acc, node) => Math.max(acc, node.size), 0)
      : displayed.reduce((acc, node) => acc + node.size, 0);

  return { name: '(total)', size: actualSize, children: displayed };
}

function buildByAllFileTypes(
  topLevelNodes: readonly Node[],
  counter: Map<string | null, number>,
  byFiletime: FileTime | null,
): void {
  for (const node of topLevelNodes) {
    if (isFileOnDisk(node.name)) {
      const ext = extension(node.name);
      const cumulative = counter.get(ext) ?? 0;
      if (byFiletime !== null) {
        // 'size' is a timestamp, summing them is meaningless
        counter.set(ext, Math.max(cumulative, node.size));
      } else {
        counter.set(ext, cumulative + node.size);
      }
    }
    buildByAllFileTypes(node.children, counter, byFiletime);
  }
}
