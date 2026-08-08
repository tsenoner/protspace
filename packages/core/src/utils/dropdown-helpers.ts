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
