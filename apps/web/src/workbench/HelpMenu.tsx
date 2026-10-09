import type { PsMenu } from '@protspace/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCS_URL } from '@/config';
import { ShortcutsDialog } from './ShortcutsDialog';

/**
 * Runs `action` once the menu that dispatched the pick has closed and handed focus back to Help:
 * the shortcuts dialog then returns focus to Help when it closes, and the tour starts over a
 * closed menu.
 */
function afterMenuCloses(action: () => void): void {
  window.setTimeout(action, 0);
}

/**
 * The app bar's help menu (design decisions 1 and 15): the documentation, the keyboard shortcuts
 * and the product tour, which the plot's tips popover and tour button offered before.
 */
export function HelpMenu() {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'docs') window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
      if (value === 'shortcuts') afterMenuCloses(() => setShortcutsOpen(true));
      if (value === 'tour') {
        afterMenuCloses(() => {
          void import('../tour/product-tour').then(({ startProductTour }) =>
            startProductTour({ force: true }),
          );
        });
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  const toggle = () => {
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-icon-button
        ref={trigger}
        data-driver-id="help"
        icon="circle-help"
        label="Help"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Help" placement="bottom-end">
        <ps-menu-item value="docs">Documentation</ps-menu-item>
        <ps-menu-item value="shortcuts">Keyboard shortcuts</ps-menu-item>
        <ps-menu-item value="tour">Take the tour</ps-menu-item>
      </ps-menu>
      <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
}
