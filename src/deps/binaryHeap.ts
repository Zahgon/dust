/**
 * `std::collections::BinaryHeap` — a max-heap ordered by an explicit
 * comparator.
 *
 * `get_biggest` pops the largest remaining node until it has filled the screen,
 * so the pop order decides which entries are displayed. Sift order among equal
 * elements is not observable because `Ord for Node` is a total order over
 * `(size, name, children)`.
 */
export class BinaryHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  get length(): number {
    return this.items.length;
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  extend(values: Iterable<T>): void {
    for (const value of values) this.push(value);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as T;
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(start: number): void {
    const items = this.items;
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index] as T, items[parent] as T) <= 0) break;
      [items[index], items[parent]] = [items[parent] as T, items[index] as T];
      index = parent;
    }
  }

  private siftDown(start: number): void {
    const items = this.items;
    const length = items.length;
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;
      if (left < length && this.compare(items[left] as T, items[largest] as T) > 0) largest = left;
      if (right < length && this.compare(items[right] as T, items[largest] as T) > 0) largest = right;
      if (largest === index) break;
      [items[index], items[largest]] = [items[largest] as T, items[index] as T];
      index = largest;
    }
  }
}
