import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const buttonStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-3);
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        border-color var(--ps-duration-fast) var(--ps-ease),
        color var(--ps-duration-fast) var(--ps-ease);
    }
    :host([size='sm']) button {
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2);
    }
    :host([variant='primary']) button {
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }
    :host([variant='primary']) button:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }
    :host([variant='secondary']) button,
    :host([variant='danger']) button {
      background: var(--ps-surface);
      border-color: var(--ps-border-strong);
    }
    :host([variant='danger']) button {
      color: var(--ps-danger);
    }
    :host([variant='ghost']) button {
      color: var(--ps-text-muted);
    }
    :host([variant='secondary']) button:hover:not(:disabled),
    :host([variant='danger']) button:hover:not(:disabled),
    :host([variant='ghost']) button:hover:not(:disabled) {
      background: var(--ps-surface-hover);
    }
    /* A ghost menu button shows its menu is open: the tint plus an inset ring (the focus ring is an outline). */
    :host([variant='ghost']) button[aria-expanded='true'] {
      background: var(--ps-surface-hover);
      box-shadow: inset 0 0 0 1px var(--ps-border-strong);
    }
    /* Same specificity as the variant and hover rules above, and later, so pressed wins. */
    :host button[aria-pressed='true'],
    :host button[aria-pressed='true']:hover:not(:disabled) {
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .icon-only {
      width: var(--ps-control-md);
      padding: 0;
    }
    :host([size='sm']) .icon-only {
      width: var(--ps-control-sm);
      padding: 0;
    }
    @media (pointer: coarse) {
      button {
        min-height: var(--ps-touch-target);
      }
      .icon-only {
        min-width: var(--ps-touch-target);
      }
    }
  `,
];
