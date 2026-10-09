import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';

export const checkboxStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
    }
    label {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-2);
      cursor: pointer;
    }
    input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .box {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface);
      color: var(--ps-text-on-accent);
    }
    .box .ps-icon {
      visibility: hidden;
    }
    input:checked + .box,
    input:indeterminate + .box {
      border-color: var(--ps-accent);
      background: var(--ps-accent);
    }
    input:checked + .box .ps-icon,
    input:indeterminate + .box .ps-icon {
      visibility: visible;
    }
    input:focus-visible + .box {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: var(--ps-focus-offset);
    }
    :host([disabled]) label {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
];

export const switchStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: inline-flex;
    }
    label {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-2);
      cursor: pointer;
    }
    button {
      position: relative;
      width: 32px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: var(--ps-radius-full);
      background: var(--ps-border-strong);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }
    button[aria-checked='true'] {
      background: var(--ps-accent);
    }
    .thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: var(--ps-radius-full);
      background: var(--ps-surface);
      box-shadow: var(--ps-shadow-sm);
      transition: translate var(--ps-duration-fast) var(--ps-ease);
    }
    button[aria-checked='true'] .thumb {
      translate: 14px 0;
    }
    :host([disabled]) label,
    button:disabled {
      cursor: not-allowed;
    }
    :host([disabled]) label {
      opacity: 0.5;
    }
    /* Forced colours drop backgrounds, so the track gets a border and the thumb a system colour. */
    @media (forced-colors: active) {
      button {
        border: 1px solid ButtonText;
      }
      .thumb {
        forced-color-adjust: none;
        background: ButtonText;
      }
    }
  `,
];

export const segmentedStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: inline-flex;
    }
    [role='radiogroup'] {
      display: inline-flex;
      gap: var(--ps-space-0-5);
      padding: var(--ps-space-0-5);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface-muted);
    }
    button {
      height: calc(var(--ps-control-sm) - 6px);
      padding: 0 var(--ps-space-2);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-text-muted);
      font: inherit;
      cursor: pointer;
    }
    button[aria-checked='true'] {
      background: var(--ps-surface);
      color: var(--ps-text);
      box-shadow: var(--ps-shadow-sm);
    }
    @media (forced-colors: active) {
      button[aria-checked='true'] {
        forced-color-adjust: none;
        background: Highlight;
        color: HighlightText;
      }
    }
  `,
];
