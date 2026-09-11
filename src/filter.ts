import { getPrintableName } from './display.ts';
import type { DisplayNode } from './displayNode.ts';
import { compareDisplayNodes } from './displayNode.ts';
import type { FileTime, Node } from './node.ts';
import { compareNodes } from './node.ts';
import { isDirOnDisk, isFileOnDisk } from './fsPredicates.ts';
import { BinaryHeap } from './deps/binaryHeap.ts';
import { components, pathKey } from './deps/rustPath.ts';
import { encodeU8 } from './deps/stfu8.ts';

export interface AggregateData {
  minSize: number | null;
  onlyDir: boolean;
  onlyFile: boolean;
  numberOfLines: number;
  depth: number;
  usingAFilter: boolean;
  shortPaths: boolean;
}

export function getBiggest(
  topLevelNodes: Node[],
  displayData: AggregateData,
  byFiletime: FileTime | null,
  keepCollapsed: ReadonlySet<string>,
): DisplayNode {
  let heap = new BinaryHeap<Node>(compareNodes);
  const numberTopLevelNodes = topLevelNodes.length;
  let root: Node;

  if (numberTopLevelNodes === 0) {
    root = totalNodeBuilder(0, []);
  } else if (numberTopLevelNodes > 1) {
    const size =
      byFiletime !== null
        ? topLevelNodes.reduce((acc, node) => Math.max(acc, node.size), 0)
        : topLevelNodes.reduce((acc, node) => acc + node.size, 0);

    const nodes = handleDuplicateTopLevelNames(topLevelNodes, displayData.shortPaths);
    root = totalNodeBuilder(size, nodes);
    heap = alwaysAddChildren(displayData, root, heap);
  } else {
    root = topLevelNodes[0] as Node;
    heap = addChildren(displayData, root, heap);
  }

  return fillRemainingLines(heap, root, displayData, keepCollapsed);
}

function totalNodeBuilder(size: number, children: Node[]): Node {
  return { name: '(total)', size, children, inodeDevice: null, depth: 0 };
}

export function fillRemainingLines(
  heap: BinaryHeap<Node>,
  root: Node,
  displayData: AggregateData,
  keepCollapsed: ReadonlySet<string>,
): DisplayNode {
  const allowedNodes = new Map<string, Node>();

  while (allowedNodes.size < displayData.numberOfLines) {
    const line = heap.pop();
    if (line === undefined) break;

    // If we are not doing only_file OR if we are doing
    // only_file and it has no children (ie is a file not a dir)
    if (!displayData.onlyFile || line.children.length === 0) {
      allowedNodes.set(pathKey(line.name), line);
    }
    if (!keepCollapsed.has(pathKey(line.name))) {
      heap = addChildren(displayData, line, heap);
    }
  }

  return displayData.onlyFile
    ? flatRebuilder(allowedNodes, root)
    : recursiveRebuilder(allowedNodes, root);
}

function addChildren(
  displayData: AggregateData,
  fileOrFolder: Node,
  heap: BinaryHeap<Node>,
): BinaryHeap<Node> {
  return displayData.depth > fileOrFolder.depth
    ? alwaysAddChildren(displayData, fileOrFolder, heap)
    : heap;
}

function alwaysAddChildren(
  displayData: AggregateData,
  fileOrFolder: Node,
  heap: BinaryHeap<Node>,
): BinaryHeap<Node> {
  heap.extend(
    fileOrFolder.children
      .filter((c) =>
        displayData.minSize !== null
          ? c.size > displayData.minSize
          : !displayData.usingAFilter || isFileOnDisk(c.name) || c.size > 0,
      )
      .filter((c) => (displayData.onlyDir ? isDirOnDisk(c.name) : true)),
  );
  return heap;
}

// Finds children of current, if in allowed_nodes adds them as children to new DisplayNode
function recursiveRebuilder(allowedNodes: ReadonlyMap<string, Node>, current: Node): DisplayNode {
  const newChildren = current.children
    .filter((c) => allowedNodes.has(pathKey(c.name)))
    .map((c) => recursiveRebuilder(allowedNodes, c));

  return buildDisplayNode(newChildren, current);
}

// Applies all allowed nodes as children to current node
function flatRebuilder(allowedNodes: ReadonlyMap<string, Node>, current: Node): DisplayNode {
  const newChildren: DisplayNode[] = [...allowedNodes.values()].map((v) => ({
    name: v.name,
    size: v.size,
    children: [],
  }));
  return buildDisplayNode(newChildren, current);
}

function buildDisplayNode(newChildren: DisplayNode[], current: Node): DisplayNode {
  newChildren.sort((lhs, rhs) => -compareDisplayNodes(lhs, rhs));
  return { name: current.name, size: current.size, children: newChildren };
}

function namesHaveDup(topLevelNodes: readonly Node[]): boolean {
  const stored = new Set<string>();
  for (const node of topLevelNodes) {
    const name = getPrintableName(node.name, true);
    if (stored.has(name)) return true;
    stored.add(name);
  }
  return false;
}

function handleDuplicateTopLevelNames(topLevelNodes: Node[], shortPaths: boolean): Node[] {
  // If we have top level names that are the same - we need to tweak them:
  if (!shortPaths || !namesHaveDup(topLevelNodes)) return topLevelNodes;

  let newTopNodes = [...topLevelNodes];
  let dirWalkUpCount = 0;

  while (namesHaveDup(newTopNodes) && dirWalkUpCount < 10) {
    dirWalkUpCount += 1;
    const newer: Node[] = [];

    for (const node of newTopNodes) {
      // `Path::iter()` in reverse: get the parent folder, or on a later round
      // the grandparent, and so on.
      const folders = components(node.name)
        .map((component) => component.text)
        .reverse();
      const data = folders[dirWalkUpCount];
      if (data !== undefined) {
        // Add (parent_name) to path of Node
        const parentName = encodeU8(data);
        newer.push({
          name: `${node.name}(${parentName})`,
          size: node.size,
          children: node.children,
          inodeDevice: node.inodeDevice,
          depth: node.depth,
        });
      } else {
        // Node does not have a parent
        newer.push(node);
      }
    }
    newTopNodes = newer;
  }
  return newTopNodes;
}
