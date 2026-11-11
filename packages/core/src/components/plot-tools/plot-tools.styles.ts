import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

/** A raised strip over the plot. */
export const plotToolsStyles = [
  kitHost,
  css`
    :host {
      display: flex;
      align-items: flex-start;
      gap: var(--ps-space-2);
    }
    .tools {
      display: flex;
      padding: var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-sm);
      flex-direction: column;
      gap: var(--ps-space-0-5);
    }
    .separator {
      height: 1px;
      margin: var(--ps-space-0-5) var(--ps-space-1);
      background: var(--ps-border);
    }
  `,
];
