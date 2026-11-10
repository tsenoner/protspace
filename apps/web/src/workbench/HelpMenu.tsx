import type { PsMenu } from '@protspace/core';
import { useEffect, useRef } from 'react';
import { openDocumentation, takeTheTour } from './help-actions';

/**
 * The app bar's help menu (design decisions 1 and 15): the documentation and the product tour,
 * which the plot's tips popover and tour button offered before. The keyboard shortcuts have their
 * own button in the plot's corner (PlotShortcutsButton).
 */
export function HelpMenu() {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'docs') openDocumentation();
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
        <ps-menu-item value="tour">Take the tour</ps-menu-item>
      </ps-menu>
    </>
  );
}
