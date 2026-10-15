import type { PsMenu } from '@protspace/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openDocumentation, takeTheTour } from './help-actions';
import { ShortcutsDialog } from './ShortcutsDialog';

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
      if (value === 'docs') openDocumentation();
      // ps-menu has closed and refocused Help before it dispatches the pick, so the dialog
      // records Help as the element to return focus to.
      if (value === 'shortcuts') setShortcutsOpen(true);
      if (value === 'tour') takeTheTour();
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
      {/* In body, not in the app bar's banner landmark: a modal belongs to no landmark. */}
      {createPortal(
        <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />,
        document.body,
      )}
    </>
  );
}
