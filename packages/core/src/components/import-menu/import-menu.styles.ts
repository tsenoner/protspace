import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/**
 * The trigger, the panel and the panel's buttons, shared by the Import and Export menus until
 * phase 4.8 rebuilds both on the kit. Token values only; the layout is the control bar's.
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

    /* Over the plot and the sidebar it overlaps (100, as the control bar's dropdowns), under the
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
    .import-current-dataset {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-0-5);
      padding-bottom: var(--ps-space-3);
      margin-bottom: var(--ps-space-3);
      border-bottom: 1px solid var(--ps-border);
    }

    .import-current-dataset-label,
    .import-examples-label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .import-current-dataset-name {
      font-weight: var(--ps-weight-medium);
      line-height: var(--ps-leading-normal);
      word-break: break-word;
    }

    .import-actions {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
    }

    .import-actions > .btn {
      width: 100%;
    }

    .import-examples {
      margin-top: var(--ps-space-3);
      padding-top: var(--ps-space-3);
      border-top: 1px solid var(--ps-border);
    }

    .import-examples-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ps-space-2);
      margin-bottom: var(--ps-space-1);
    }

    .import-examples-docs {
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

    .import-examples-hint {
      margin: 0 0 var(--ps-space-2);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    /* An example item: its button, then its info popover as a sibling (never inside the button). */
    .import-example-row,
    .import-current-dataset-row {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
    }

    .import-example-button {
      flex: 1 1 auto;
      min-width: 0;
      /* A long label wraps rather than being clipped behind the badge. */
      white-space: normal;
    }

    .import-example-label {
      min-width: 0;
      text-align: center;
      overflow-wrap: anywhere;
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
