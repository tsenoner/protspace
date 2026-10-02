/**
 * Dropdown utility functions
 * Shared helpers for consistent dropdown behavior across components
 */

/**
 * Handles escape key press for dropdown menus
 * - Stops event propagation to prevent conflicts with other handlers
 * - Provides consistent behavior across all dropdowns
 *
 * @param event - The keyboard event
 * @param onClose - Callback to close the dropdown
 */
export function handleDropdownEscape(event: KeyboardEvent, onClose: () => void): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  onClose();
}

/**
 * Checks if any dropdown is currently open
 * Used by document-level handlers to avoid interfering with dropdown Escape handling
 *
 * @param dropdownStates - Object containing boolean states of all dropdowns
 * @returns true if any dropdown is open
 */
export function isAnyDropdownOpen(dropdownStates: Record<string, boolean>): boolean {
  return Object.values(dropdownStates).some((isOpen) => isOpen);
}

/**
 * Everything `handleListboxKeydown` needs to drive one dropdown's option list.
 *
 * Module-private: callers pass an object literal to `handleListboxKeydown` and
 * infer the type from it, so nothing imports the name — and knip fails on an
 * exported type with no importer.
 */
interface ListboxKeyboardOptions {
  /**
   * The values the highlight walks, in render order — a thunk rather than an
   * array so a keystroke that is neither an arrow nor Enter costs nothing.
   */
  getValues: () => readonly string[];
  /** The current highlight, or -1 for "nothing highlighted". */
  highlightIndex: number;
  /** Store a new highlight index. */
  setHighlightIndex: (index: number) => void;
  /** Close the dropdown (Escape). */
  onEscape: () => void;
  /** Commit a value (Enter). */
  onSelect: (value: string) => void;
  /** Shadow root holding the option rows. */
  root: ShadowRoot | null | undefined;
  /** Row selector, e.g. `.value-picker-item`. */
  itemSelector: string;
  /** Attribute on a row carrying its value, e.g. `data-value`. */
  valueAttribute: string;
  /** When true every row is locked out, so arrows and Enter are inert. */
  disabled?: boolean;
}

/**
 * The keyboard contract shared by every searchable dropdown in the app: arrows
 * walk the *filtered* list (clamped, never wrapping), Enter commits, Escape
 * closes without also closing whatever surrounds the dropdown.
 *
 * Stated once because three components implement the same listbox — the
 * annotation select, the query builder's annotation picker and its value picker
 * — and a divergence between them is a bug the user feels as "the keyboard
 * works differently over here".
 *
 * The stored index is clamped against the list on every use: it indexes into a
 * list that the search box, a new selection or a data change can shrink under
 * it, and an index past the end would otherwise leave `.highlighted` on nothing
 * while `aria-activedescendant` pointed at an id that no longer exists.
 *
 * Hover does not move the highlight (mirroring it re-rendered every row the
 * pointer crossed), so the row under the pointer and the keyboard cursor can
 * differ and both render the same. The browser's `:hover` is the source of
 * truth for the pointer and wins, including when no arrow key was ever pressed.
 */
export function handleListboxKeydown(event: KeyboardEvent, options: ListboxKeyboardOptions): void {
  const { key } = event;
  if (key === 'Escape') {
    handleDropdownEscape(event, options.onEscape);
    return;
  }
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter') return;
  event.preventDefault();
  if (options.disabled) return;

  const values = options.getValues();
  // Clamp before use — see the note above.
  const current = options.highlightIndex < values.length ? options.highlightIndex : -1;

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (values.length === 0) return;
    options.setHighlightIndex(
      key === 'ArrowDown' ? Math.min(current + 1, values.length - 1) : Math.max(current - 1, 0),
    );
    return;
  }

  const hovered = options.root
    ?.querySelector(`${options.itemSelector}:hover`)
    ?.getAttribute(options.valueAttribute);
  if (hovered !== null && hovered !== undefined) {
    options.onSelect(hovered);
  } else if (current >= 0) {
    options.onSelect(values[current]);
  }
}

/**
 * Scrolls the currently highlighted row of a scrolling dropdown into view.
 *
 * Keyboard navigation moves the highlight without scrolling anything, so past the height
 * of the list container the user would otherwise navigate blind. `block: 'nearest'` only
 * scrolls when the row is actually outside the visible area, so it never jumps a list
 * whose highlighted row is already on screen.
 *
 * @param root - The component's shadow root
 * @param selectors - Candidate selectors for the highlighted row, tried in order
 */
export function scrollHighlightedIntoView(
  root: ShadowRoot | null | undefined,
  ...selectors: string[]
): void {
  for (const selector of selectors) {
    const highlighted = root?.querySelector(selector);
    if (highlighted) {
      // Optional call: jsdom does not implement scrollIntoView.
      highlighted.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return;
    }
  }
}
