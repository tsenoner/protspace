import { css } from 'lit';

/** The one-line EAT note under the legend title, and its `EAT ›` link to the EAT panel. */
export const eatStyles = css`
  .legend-eat-note {
    display: flex;
    align-items: baseline;
    gap: var(--ps-space-2);
    margin: calc(-1 * var(--ps-space-1)) 0 var(--ps-space-1);
    padding: 0 var(--ps-space-1-5) 0 var(--ps-space-3);
    color: var(--ps-text-muted);
    font-size: var(--ps-text-sm);
    line-height: 1.4;
  }

  .legend-eat-text {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .legend-eat-link {
    flex: none;
    margin-inline-start: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ps-accent-text);
    font: inherit;
    cursor: pointer;
  }

  .legend-eat-link:hover {
    text-decoration: underline;
  }

  .legend-eat-link:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
    border-radius: var(--ps-radius-sm);
  }
`;
