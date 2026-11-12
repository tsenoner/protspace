import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

export const contoursMenuStyles = [
  kitHost,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .icon,
    .chevron {
      display: inline-flex;
    }
    .chevron {
      color: var(--ps-text-faint);
    }
    .key {
      color: var(--ps-text-muted);
      font-weight: 400;
    }
    .value {
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
    }
    /* Label over a one-line hint, as the old contours menu had it. */
    ps-menu-item {
      box-sizing: border-box;
      width: 17rem;
      padding-block: var(--ps-space-1);
    }
    .item-label {
      display: block;
    }
    .hint {
      display: block;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: 400;
      white-space: normal;
    }
  `,
];
