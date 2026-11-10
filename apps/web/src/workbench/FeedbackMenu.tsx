import type { PsMenu } from '@protspace/core';
import { useEffect, useRef } from 'react';
import { notify } from '@/lib/notify';
import { FEEDBACK_HREF, GITHUB_REPO_URL, SUPPORT_EMAIL } from '@/lib/support';

/**
 * The app bar's Feedback menu. A bare mailto: link does nothing in a browser with no mail app set
 * up, so the menu also offers the address to copy and a GitHub issue, one of which always works.
 */
export function FeedbackMenu() {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'email') window.location.href = FEEDBACK_HREF;
      if (value === 'issue') {
        window.open(`${GITHUB_REPO_URL}/issues/new`, '_blank', 'noopener,noreferrer');
      }
      if (value === 'copy') {
        navigator.clipboard.writeText(SUPPORT_EMAIL).then(
          () => notify.success({ title: `Copied ${SUPPORT_EMAIL}` }),
          () => notify.error({ title: 'Could not copy to clipboard', description: SUPPORT_EMAIL }),
        );
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
        data-driver-id="feedback"
        icon="message-square"
        label="Feedback"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Feedback" placement="bottom-end">
        <ps-menu-item value="email">Email {SUPPORT_EMAIL}</ps-menu-item>
        <ps-menu-item value="copy">Copy email address</ps-menu-item>
        <ps-menu-item value="issue">Open a GitHub issue</ps-menu-item>
      </ps-menu>
    </>
  );
}
