import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/**
 * The trigger, the panel and the panel's buttons, shared by the Import and Export menus until
 * phase 4.8 rebuilds both on the kit. Token values only; the app bar does the layout.
 */
export const dataMenuStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      position: relative;
      display: inline-flex;
    }

    .trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-3);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
      background: var(--ps-surface-hover);
    }

    .trigger .ps-icon {
      flex: none;
      color: var(--ps-text-muted);
    }

    /* Over the plot and the sidebar it overlaps (100, as the other dropdowns), under the
       loading overlay. Not in the top layer: an example's position: fixed info bubble must not get
       a containing block. */
    .panel {
      position: absolute;
      top: calc(100% + var(--ps-space-1));
      right: 0;
      z-index: 100;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 280px;
      max-width: calc(100vw - 2 * var(--ps-space-3));
      max-height: 50vh;
      overflow-x: hidden;
      overflow-y: auto;
      padding: var(--ps-space-3);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-lg);
      text-align: left;
      scrollbar-width: thin;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ps-space-1);
      min-height: var(--ps-control-sm);
      padding: var(--ps-space-1) var(--ps-space-3);
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .btn-primary {
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }

    .btn-secondary {
      border-color: var(--ps-border-strong);
      background: var(--ps-surface);
      color: var(--ps-text);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--ps-surface-hover);
    }

    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
];

export const importMenuStyles = [
  dataMenuStyles,
  css`
    .import-menu {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 300px;
      max-width: 100%;
      text-align: left;
    }

    .import-section {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
      padding: var(--ps-space-3);
    }

    .import-section + .import-section {
      border-top: 1px solid var(--ps-border);
    }

    .import-open-file::part(button) {
      width: 100%;
    }

    .import-note,
    .import-examples-hint {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    .import-section-label {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .import-examples-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .import-examples-docs {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-0-5);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-medium);
      text-decoration: none;
      white-space: nowrap;
    }

    .import-examples-docs:hover {
      text-decoration: underline;
    }

    /* Read by assistive technology only: the link opens a new tab. */
    .import-examples-docs-hint {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .import-example-list {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-0-5);
    }

    /* An example item: its button, then its info popover as a sibling (never inside the button). */
    .import-example-row {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
    }

    .import-row {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      min-height: var(--ps-row);
      padding: var(--ps-space-1) var(--ps-space-2);
      border: 0;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .import-row:hover:not(:disabled) {
      background: var(--ps-surface-hover);
    }

    /* The example on screen: not a choice, but still readable, with its check. */
    .import-row:disabled {
      color: var(--ps-text-muted);
      cursor: default;
    }

    .import-row-check {
      display: inline-flex;
      flex: none;
      width: 14px;
      color: var(--ps-accent-text);
    }

    .import-row-label,
    .import-example-label {
      flex: 1 1 auto;
      min-width: 0;
      /* A long name wraps rather than being clipped behind the size or the badge. */
      overflow-wrap: anywhere;
    }

    .import-row-meta {
      flex: none;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
    }

    .import-example-badge {
      flex: none;
      padding: 1px var(--ps-space-1);
      border: 1px solid var(--ps-accent-text);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      line-height: 1;
      letter-spacing: 0.03em;
    }

    .import-example-info {
      flex: none;
    }
  `,
];
