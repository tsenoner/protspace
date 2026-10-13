/**
 * The keyboard and pointer shortcuts the explore page has today, for the help menu's dialog. One
 * list; undo and redo are under History. Keys are named as `KeyboardEvent.key` names them,
 * plus 'Mod' for the platform's command key and plain words for pointer gestures.
 *
 * Escape takes one step per press (design decision 11): the open popover, menu, dialog, figure
 * editor, pinned panel or expanded duplicate stack first, then the EAT connectors, then the
 * selection, then the selection tool (back to Move and zoom). The rows below follow that order.
 */
export interface Shortcut {
  /** The keys pressed together. 'Mod' reads ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: readonly string[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Plot',
    items: [
      { keys: ['Drag'], action: 'Pan the plot' },
      { keys: ['Scroll'], action: 'Zoom in or out' },
      { keys: ['Double-click'], action: 'Reset the zoom' },
      { keys: ['Shift'], action: 'Hold over a point to focus its category' },
      { keys: ['Escape'], action: 'Close an expanded stack of duplicate points' },
      { keys: ['Escape'], action: 'Hide the EAT connectors' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['Click'], action: 'Select a protein and show its structure' },
      { keys: ['Mod', 'Click'], action: 'Add a protein to the selection, or remove it' },
      { keys: ['Escape'], action: 'Clear the selection, then return to Move and zoom' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: ['Mod', 'Z'], action: 'Undo the last selection, show-only or filter step' },
      { keys: ['Shift', 'Mod', 'Z'], action: 'Redo' },
    ],
  },
  {
    title: 'Search',
    items: [
      { keys: ['Mod', 'K'], action: 'Focus the search box' },
      { keys: ['Mod', 'V'], action: 'Paste several IDs to select them all' },
      { keys: ['ArrowDown'], action: 'Next suggestion' },
      { keys: ['ArrowUp'], action: 'Previous suggestion' },
      { keys: ['Enter'], action: 'Select the highlighted suggestion' },
      { keys: ['Escape'], action: 'Close the suggestions and empty the box' },
    ],
  },
  {
    title: 'Legend',
    items: [
      { keys: ['Click'], action: 'Hide or show a category' },
      { keys: ['Double-click'], action: 'Show only that category' },
      { keys: ['ArrowDown'], action: 'Next category' },
      { keys: ['ArrowUp'], action: 'Previous category' },
      { keys: ['Home'], action: 'First category' },
      { keys: ['End'], action: 'Last category' },
      { keys: ['Enter'], action: 'Hide or show the focused category' },
      { keys: ['I'], action: 'Show only the focused category' },
      { keys: ['Space'], action: 'Pick up or drop a category by its drag handle' },
      { keys: ['ArrowUp'], action: 'Move a picked-up category up' },
      { keys: ['ArrowDown'], action: 'Move a picked-up category down' },
      { keys: ['Escape'], action: 'Cancel moving a category' },
    ],
  },
  {
    title: 'Structure viewer',
    items: [
      { keys: ['Drag'], action: 'Rotate the structure' },
      { keys: ['Right-drag'], action: 'Move the structure' },
      { keys: ['Scroll'], action: 'Zoom in or out' },
    ],
  },
  {
    title: 'Figure editor',
    items: [
      { keys: ['Delete'], action: 'Remove the selected overlay or inset' },
      { keys: ['Escape'], action: 'Deselect the overlay or inset, then close the editor' },
    ],
  },
];

const MAC_NAMES: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const OTHER_NAMES: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * The keys as the platform writes them. Apple platforms join modifiers to a one-character key
 * without a separator (⌘K); everything else joins with "+" (Ctrl+K, ⌘+Click).
 */
export function formatKeys(keys: readonly string[], isMac: boolean): string {
  const names = isMac ? MAC_NAMES : OTHER_NAMES;
  const shown = keys.map((key) => names[key] ?? key);
  const last = shown[shown.length - 1] ?? '';
  return isMac && last.length === 1 ? shown.join('') : shown.join('+');
}
