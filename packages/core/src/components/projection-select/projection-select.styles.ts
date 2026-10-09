import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

/** The view bar's key/value trigger: key muted, value medium and truncated, chevron faint. */
export const projectionSelectStyles = [
  kitHost,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .key {
      color: var(--ps-text-muted);
      font-weight: 400;
    }
    .value {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
    }
    .chevron {
      display: inline-flex;
      color: var(--ps-text-faint);
    }
  `,
];
