/**
 * The keyboard of a menu button's open menu, framework-neutral so Home's Feedback menu (React) and
 * the docs' (Vue) share it: the arrows move with wrap, Home and End jump, Escape closes and returns
 * focus to the button, Tab closes and lets focus move on.
 */

/** What a key does: focus entry `index`, close the menu (`refocus`: back to its button), or nothing. */
type MenuKeyAction = { focus: number } | { close: true; refocus: boolean } | null;

/** The action for `key` in a menu of `count` entries with entry `active` focused (-1: none). */
export function menuKeyAction(key: string, count: number, active: number): MenuKeyAction {
  const wrap = (index: number) => ({ focus: (index + count) % count });
  switch (key) {
    case 'ArrowDown':
      return wrap(active + 1);
    case 'ArrowUp':
      return wrap(active - 1);
    case 'Home':
      return wrap(0);
    case 'End':
      return wrap(count - 1);
    case 'Escape':
      return { close: true, refocus: true };
    case 'Tab':
      return { close: true, refocus: false };
    default:
      return null;
  }
}

/**
 * Applies menuKeyAction to a keydown in the menu: focuses an entry, or calls `close` (and focuses
 * `trigger` on Escape). Every key it handles but Tab has its default prevented.
 */
export function handleMenuKey(
  event: { key: string; preventDefault(): void },
  entries: readonly HTMLElement[],
  close: () => void,
  trigger: HTMLElement | null | undefined,
): void {
  const action = menuKeyAction(
    event.key,
    entries.length,
    entries.indexOf(document.activeElement as HTMLElement),
  );
  if (!action) return;
  if ('focus' in action) entries[action.focus]?.focus();
  else {
    close();
    if (action.refocus) trigger?.focus();
  }
  if (event.key !== 'Tab') event.preventDefault();
}

/** Whether a press landed outside every one of `elements` (a menu and its button). */
export function isOutsidePress(
  event: Event,
  ...elements: readonly (Element | null | undefined)[]
): boolean {
  const target = event.target as Node;
  return !elements.some((element) => element?.contains(target));
}
