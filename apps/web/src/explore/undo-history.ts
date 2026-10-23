/** A linear undo history (design decision 13). */
export interface UndoHistory<E> {
  /** Adds a step on top and drops every step undone before it. */
  record(entry: E): void;
  /** Takes the top step off, to undo; null when there is none. */
  undo(): E | null;
  /** Puts the last undone step back, to redo; null when there is none. */
  redo(): E | null;
  /** The step `undo()` would return, left in place. */
  peekUndo(): E | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  /** Heard on every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

interface Sized<E> {
  entry: E;
  size: number;
}

/**
 * Entries are kept by reference, never copied: a lasso of 573K ids costs one pointer. Past `limit`
 * steps or `maxIds` ids in all (each entry's `size`), the oldest steps drop. The newest step is
 * always kept, so a single huge step can still be undone.
 */
export function createUndoHistory<E>({
  size,
  limit = 100,
  maxIds = 2_000_000,
}: {
  size(entry: E): number;
  limit?: number;
  maxIds?: number;
}): UndoHistory<E> {
  const past: Sized<E>[] = [];
  let future: Sized<E>[] = [];
  /** Ids held by both stacks. */
  let total = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    record(entry) {
      for (const undone of future) total -= undone.size;
      future = [];
      const sized = { entry, size: size(entry) };
      past.push(sized);
      total += sized.size;
      while (past.length > 1 && (past.length > limit || total > maxIds)) {
        total -= past.shift()!.size;
      }
      changed();
    },
    undo() {
      const top = past.pop();
      if (!top) return null;
      future.push(top);
      changed();
      return top.entry;
    },
    redo() {
      const next = future.pop();
      if (!next) return null;
      past.push(next);
      changed();
      return next.entry;
    },
    peekUndo() {
      return past.length > 0 ? past[past.length - 1].entry : null;
    },
    canUndo() {
      return past.length > 0;
    },
    canRedo() {
      return future.length > 0;
    },
    clear() {
      past.length = 0;
      future = [];
      total = 0;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
