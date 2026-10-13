import { isEditableEventPath } from '@protspace/utils';
import type { FilterCommit } from './filter-controller';
import type { UndoHistory } from './undo-history';

/**
 * One undoable step (design decision 13). Every array is the one its controller already owns,
 * held by reference.
 */
export type UndoEntry =
  | { kind: 'selection'; before: readonly string[]; after: readonly string[] }
  | { kind: 'isolate'; layer: readonly string[]; selectionBefore: readonly string[] }
  | {
      kind: 'reset-isolation';
      layers: ReadonlyArray<readonly string[]>;
      selectionBefore: readonly string[];
    }
  | ({ kind: 'filter' } & FilterCommit);

/** The protein ids an entry holds, for the history's id cap. */
export function undoEntrySize(entry: UndoEntry): number {
  switch (entry.kind) {
    case 'selection':
      return entry.before.length + entry.after.length;
    case 'isolate':
      return entry.layer.length + entry.selectionBefore.length;
    case 'reset-isolation':
      return (
        entry.layers.reduce((sum, layer) => sum + layer.length, 0) + entry.selectionBefore.length
      );
    case 'filter':
      return (entry.before.matchedIds?.length ?? 0) + (entry.after.matchedIds?.length ?? 0);
  }
}

interface UndoControllerOptions {
  history: UndoHistory<UndoEntry>;
  /** Where the keys are heard, in the bubble phase: the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** ⌘ on Apple platforms, Ctrl elsewhere (`isMacOrIos`). */
  isMac(): boolean;
  /** A modal is open on the page; it owns its keys. */
  isModalOpen(): boolean;
  /** Undoes or redoes one step; the controller that recorded it applies it. */
  apply(entry: UndoEntry, direction: 'undo' | 'redo'): void;
}

/** An open `<dialog>` or an `aria-modal="true"` element in the key's path. */
function modalInPath(path: readonly unknown[]): boolean {
  return path.some((node) => {
    const element = node as {
      tagName?: unknown;
      open?: unknown;
      getAttribute?: (name: string) => string | null;
    } | null;
    if (!element) return false;
    if (element.tagName === 'DIALOG' && element.open === true) return true;
    return (
      typeof element.getAttribute === 'function' && element.getAttribute('aria-modal') === 'true'
    );
  });
}

/**
 * ⌘Z / Ctrl+Z undoes and ⇧⌘Z / Ctrl+Shift+Z redoes (design decision 13). Only the keys and the
 * routing live here: the history belongs to the interaction controller, and each step is applied
 * by the controller that recorded it. A press in a text field edits the text, and a modal owns its
 * own keys, so neither reaches the history.
 */
export function createUndoController({
  history,
  root,
  isMac,
  isModalOpen,
  apply,
}: UndoControllerOptions) {
  const undo = (): boolean => {
    const entry = history.undo();
    if (!entry) return false;
    apply(entry, 'undo');
    return true;
  };

  const redo = (): boolean => {
    const entry = history.redo();
    if (!entry) return false;
    apply(entry, 'redo');
    return true;
  };

  const onKeydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.defaultPrevented || key.altKey || key.isComposing) return;
    if (key.key.toLowerCase() !== 'z' || !(isMac() ? key.metaKey : key.ctrlKey)) return;
    const path = key.composedPath();
    if (isEditableEventPath(path) || modalInPath(path) || isModalOpen()) return;
    if (key.shiftKey ? redo() : undo()) key.preventDefault();
  };

  root.addEventListener('keydown', onKeydown);

  return {
    undo,
    redo,
    /**
     * Undoes `entry` only while it is still the latest step: an Undo button never undoes a newer
     * one.
     */
    undoEntry(entry: UndoEntry): boolean {
      return history.peekUndo() === entry ? undo() : false;
    },
    dispose() {
      root.removeEventListener('keydown', onKeydown);
    },
  };
}
