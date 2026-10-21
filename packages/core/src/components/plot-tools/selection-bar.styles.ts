import { css, unsafeCSS } from 'lit';
import { PHONE_MEDIA } from '../../utils/breakpoints';
import { kitHost, srOnly } from '../kit/kit-shared.styles';

/**
 * A raised bar at the bottom-centre of the plot, like the tool strip in its corner. On a phone
 * (design decision 17) it fits a 360 px plot: 40 px icon buttons whose labels stay their names, a
 * short count, and never wider than the plot less its margins.
 */
export const selectionBarStyles = [
  kitHost,
  srOnly,
  css`
    :host {
      position: absolute;
      bottom: var(--ps-space-3);
      left: 50%;
      translate: -50% 0;
      z-index: 5;
      display: block;
    }
    /* Hidden keeps the host rendered so its live region stays in the accessibility tree. */
    :host([hidden]) .bar {
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
    .selection-count,
    .selection-count-short {
      padding: 0 var(--ps-space-2);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text);
    }
    .selection-count-short,
    .action-icon {
      display: none;
    }
    @media ${unsafeCSS(PHONE_MEDIA)} {
      /* Sized to its content, not to the half of the plot right of its left: 50% edge. */
      :host {
        width: max-content;
        max-width: calc(100% - 24px);
      }
      .selection-count {
        display: none;
      }
      .selection-count-short {
        display: inline;
      }
      .action-icon {
        display: inline-flex;
      }
      .action-label {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      ps-button::part(button) {
        min-width: var(--ps-touch-target);
        padding: 0;
      }
    }
    /* The same compact bar, set by the page on a plot too narrow for its labels. */
    :host([compact]) {
      width: max-content;
      max-width: calc(100% - 24px);
    }
    :host([compact]) .selection-count {
      display: none;
    }
    :host([compact]) .selection-count-short {
      display: inline;
    }
    :host([compact]) .action-icon {
      display: inline-flex;
    }
    :host([compact]) .action-label {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    :host([compact]) ps-button::part(button) {
      min-width: var(--ps-touch-target);
      padding: 0;
    }
  `,
];
