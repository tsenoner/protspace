import { css } from 'lit';

/**
 * Legend Layout Styles
 *
 * Structural styles for the Legend component including:
 * - Host container layout
 * - Legend container
 * - Header and title
 * - Items list container
 */
export const layoutStyles = css`
  :host {
    display: flex;
    user-select: none;
    flex-direction: column;
    width: 100%;

    border: 1px solid var(--legend-border);
    background: var(--legend-bg);
    border-radius: var(--legend-border-radius);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    padding: 5px 2px 9px 2px;
    flex-shrink: 1;
    flex-grow: 1;
    height: calc(50% - 1rem);
  }

  .legend-container {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding-bottom: 8px;
    flex-shrink: 1;
    position: relative;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .legend-header {
    display: flex;
    justify-content: space-between;
    flex-direction: row;
    width: 100%;
    align-items: center;
    padding: 3px 6px 0px 1.2rem;
    margin-bottom: 0.25rem;
    box-sizing: border-box;
  }

  .legend-header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .legend-title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .legend-title {
    font-weight: 500;
    font-size: 1rem;
    color: var(--legend-text-color);
    margin: 0;
  }

  .legend-predicted-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    color: var(--legend-text-color);
    background: color-mix(in srgb, var(--legend-text-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--legend-text-color) 25%, transparent);
    white-space: nowrap;
  }

  .legend-predicted-note {
    margin: 0 0 0.35rem;
    padding: 0 6px 0 1.2rem;
    font-size: 0.72rem;
    color: var(--legend-text-secondary);
    box-sizing: border-box;
  }

  .legend-items {
    display: flex;
    flex-direction: column;
    gap: var(--legend-item-gap);
    width: 100%;
    max-height: calc(100vh - 10rem);
    overflow-y: scroll;
    scrollbar-width: thin;
    padding: 5px 6px 4px 9px;
    box-sizing: border-box;
    flex-grow: 1;
    flex-shrink: 1;
  }

  .legend-empty {
    text-align: center;
    color: var(--legend-text-secondary);
    font-style: italic;
    padding: 1rem 0;
  }
`;
