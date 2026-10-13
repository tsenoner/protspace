import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

/** A raised bar at the bottom-centre of the plot, like the tool strip in its corner. */
export const selectionBarStyles = [
  kitHost,
  css`
    :host {
      position: absolute;
      bottom: var(--ps-space-3);
      left: 50%;
      translate: -50% 0;
      z-index: 5;
      display: block;
    }
    :host([hidden]) {
      display: none;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      padding: var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-md);
      white-space: nowrap;
    }
    .selection-count {
      padding: 0 var(--ps-space-2);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text);
    }
  `,
];
