import type { PsMenu } from '@protspace/core';
import { useEffect, useRef } from 'react';
import { notify } from '@/lib/notify';
import {
  FEEDBACK_MENU_ITEMS,
  runFeedbackAction,
  SUPPORT_EMAIL,
  type FeedbackAction,
} from '@/lib/support';

/** A copy's outcome, as a notification. */
export function notifyCopied(copied: boolean): void {
  if (copied) notify.success({ title: `Copied ${SUPPORT_EMAIL}` });
  else notify.error({ title: 'Could not copy to clipboard', description: SUPPORT_EMAIL });
}

/**
 * The app bar's Feedback menu, with the entries Home's header and the docs' nav offer too
 * (FEEDBACK_MENU_ITEMS): email, the address to copy, and a GitHub issue.
 */
export function FeedbackMenu() {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: FeedbackAction }>).detail;
      runFeedbackAction(value, notifyCopied);
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
        data-driver-id="feedback"
        icon="message-square"
        label="Feedback"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Feedback" placement="bottom-end">
        {FEEDBACK_MENU_ITEMS.map(({ value, label }) => (
          <ps-menu-item key={value} value={value}>
            {label}
          </ps-menu-item>
        ))}
      </ps-menu>
    </>
  );
}
