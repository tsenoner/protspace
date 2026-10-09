import { css } from 'lit';
import { focusRing, kitHost } from './kit-shared.styles';

export const fieldStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .field {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      width: 100%;
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text-muted);
    }
    /* Faint reaches only decorative icons; slotted text and typed text stay readable. */
    ::slotted(svg) {
      color: var(--ps-text-faint);
    }
    /* The field draws the ring; the inner control's own focusRing outline would be a second one. */
    .field:has(:focus-visible) {
      border-color: var(--ps-focus);
      box-shadow: 0 0 0 1px var(--ps-focus);
    }
    input:focus-visible,
    select:focus-visible {
      outline: none;
    }
    @media (forced-colors: active) {
      .field:has(:focus-visible) {
        outline: var(--ps-focus-width) solid Highlight;
      }
    }
    :host([invalid]) .field {
      border-color: var(--ps-danger);
    }
    :host([disabled]) .field {
      background: var(--ps-surface-muted);
      color: var(--ps-text-faint);
    }
    :host([disabled]) input,
    :host([disabled]) input::placeholder,
    :host([disabled]) select,
    :host([disabled]) .select .ps-icon {
      color: var(--ps-text-faint);
      cursor: not-allowed;
    }
    input,
    select {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }
    input::placeholder {
      color: var(--ps-text-muted);
    }
    .select {
      padding: 0;
    }
    .select select {
      appearance: none;
      padding: 0 var(--ps-space-6) 0 var(--ps-space-2);
      cursor: pointer;
    }
    .select .ps-icon {
      position: absolute;
      right: var(--ps-space-2);
      pointer-events: none;
      color: var(--ps-text-muted);
    }
    @media (pointer: coarse) {
      .field {
        min-height: var(--ps-touch-target);
      }
    }
  `,
];
