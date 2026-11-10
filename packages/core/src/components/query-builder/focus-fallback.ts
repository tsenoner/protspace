import type { ReactiveElement } from 'lit';
import { deepActiveElement } from '../kit/focus';

/**
 * After `host`'s pending update, puts the focus on `target` if it fell to the page because the
 * element holding it went or was hidden in that update (a card's ✕, a value list's "+ value", a
 * menu item); a focus the user moved elsewhere stays there.
 */
export function catchFallenFocus(
  host: ReactiveElement,
  target: () => HTMLElement | null | undefined,
): void {
  void host.updateComplete.then(() => {
    const active = deepActiveElement();
    if (!active || active === document.body) target()?.focus();
  });
}
