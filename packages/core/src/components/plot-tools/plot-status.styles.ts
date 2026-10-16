import { css } from 'lit';
import { focusRing, kitHost } from '../kit/kit-shared.styles';

/** The plot's bottom-left corner: a muted count, then a chip per narrowing (mockup palette.html). */
export const plotStatusStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      position: absolute;
      left: var(--ps-space-3);
      bottom: var(--ps-space-3);
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-1-5);
      max-width: calc(100% - 2 * var(--ps-space-3));
      pointer-events: none;
    }
    .status-count {
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text-muted);
      white-space: nowrap;
    }
    .status-chip {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      height: 24px;
      padding: 0 var(--ps-space-1-5) 0 var(--ps-space-2);
      border-radius: var(--ps-radius-full);
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
    }
    .status-chip-open {
      all: unset;
      cursor: pointer;
      border-radius: var(--ps-radius-sm);
    }
    .status-chip-open:hover {
      text-decoration: underline;
    }
    .status-chip-open:focus-visible {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: var(--ps-focus-offset);
    }
  `,
];
