import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The Other popover's content: a 300 px panel with a search field, a scrolling list and a footer. */
export const otherPopoverStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }

    .other-popover {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
      box-sizing: border-box;
      width: min(300px, calc(100vw - 16px));
      padding: var(--ps-space-3);
    }

    .other-heading {
      margin: 0;
      font-size: var(--ps-text-base);
      font-weight: var(--ps-weight-semibold);
      line-height: var(--ps-leading-tight);
      color: var(--ps-text);
    }

    .other-list {
      display: flex;
      flex-direction: column;
      max-height: min(320px, 50vh);
      margin: 0 calc(-1 * var(--ps-space-3));
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .other-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      min-height: var(--ps-row);
      padding: 0 var(--ps-space-3);
    }

    .other-item:hover {
      background: var(--ps-surface-hover);
    }

    .other-item-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .other-item-count {
      flex: none;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .other-add {
      flex: none;
      height: 24px;
      padding: 0 var(--ps-space-1-5);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-accent-text);
      font: inherit;
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .other-add:hover {
      background: var(--ps-accent-tint);
    }

    .other-status {
      margin: 0;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
    }

    .other-status:empty {
      display: none;
    }

    .other-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }

    @media (pointer: coarse) {
      .other-item {
        min-height: var(--ps-touch-target);
      }
      .other-add {
        height: var(--ps-touch-target);
      }
    }
  `,
];
