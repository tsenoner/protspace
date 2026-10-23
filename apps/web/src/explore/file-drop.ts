/**
 * Whether a drag carries files: the operating system's file drag. Text drags and the legend's row
 * reordering (native drag and drop) carry none, so they never light the drop area.
 */
export function isFileDrag(types: readonly string[] | DOMStringList): boolean {
  return Array.from(types as ArrayLike<string>).includes('Files');
}

/**
 * Counts nested `dragenter`/`dragleave` pairs: a drag fires both on every child it crosses, so
 * only the depth says when it has really left. `enter` and `leave` report the moments the drag
 * arrives and goes.
 */
export function createDragDepth(): {
  enter(): boolean;
  leave(): boolean;
  reset(): void;
  readonly active: boolean;
} {
  let depth = 0;
  return {
    enter() {
      depth += 1;
      return depth === 1;
    },
    leave() {
      if (depth === 0) return false;
      depth -= 1;
      return depth === 0;
    },
    reset() {
      depth = 0;
    },
    get active() {
      return depth > 0;
    },
  };
}
