import { css } from 'lit';
import { focusRing, kitHost } from './kit-shared.styles';

export const menuStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: contents;
    }
    ps-popover::part(panel) {
      min-width: 200px;
    }
    .items {
      display: flex;
      flex-direction: column;
      padding: var(--ps-space-1);
    }
    .search {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      margin: var(--ps-space-1) var(--ps-space-1) 0;
      padding: 0 var(--ps-space-2);
      height: var(--ps-control-sm);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      color: var(--ps-text-faint);
    }
    .search:focus-within {
      border-color: var(--ps-focus);
      box-shadow: 0 0 0 1px var(--ps-focus);
    }
    .search input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }
    .search input::placeholder {
      color: var(--ps-text-muted);
    }
    .empty {
      margin: 0;
      padding: var(--ps-space-2) var(--ps-space-3);
      color: var(--ps-text-muted);
    }
  `,
];

export const menuItemStyles = [
  kitHost,
  css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      min-height: var(--ps-row);
      padding: 0 var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      outline: none;
      cursor: default;
      user-select: none;
    }
    :host([hidden]) {
      display: none;
    }
    :host(:hover),
    :host(:focus) {
      background: var(--ps-surface-hover);
    }
    :host([aria-checked='true']) {
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-medium);
    }
    :host([disabled]) {
      color: var(--ps-text-faint);
      background: transparent;
    }
    .mark {
      display: inline-flex;
      width: 14px;
      color: var(--ps-accent-text);
    }
    .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (pointer: coarse) {
      :host {
        min-height: var(--ps-touch-target);
      }
    }
  `,
];

export const menuLabelStyles = [
  kitHost,
  css`
    :host {
      display: block;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    :host([hidden]) {
      display: none;
    }
  `,
];
