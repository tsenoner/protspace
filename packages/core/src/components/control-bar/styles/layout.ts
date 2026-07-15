import { css } from 'lit';

/**
 * Control Bar Layout Styles
 *
 * Defines the flexbox structure, spacing, and layout for the control bar
 * and its child control groups.
 */
export const layoutStyles = css`
  .control-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-sm) var(--spacing-lg);
    background: var(--surface);
    border-bottom: var(--border-width) solid var(--border);
    box-shadow: var(--shadow-sm);
    border-radius: var(--radius);
    min-width: 900px;
  }

  .left-controls,
  .right-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    min-width: 0;
  }

  .left-controls {
    gap: var(--spacing-lg);
  }

  .right-controls {
    gap: var(--spacing-md);
  }

  .selection-group,
  .data-actions-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .projection-container,
  .filter-container,
  .export-container {
    position: relative;
    display: inline-flex;
  }

  .search-group {
    flex: 1 1 auto;
    min-width: 300px;
    margin: 0 var(--spacing-sm);
  }

  .search-group > protspace-protein-search {
    width: 100%;
  }

  label {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--muted);
  }

  /* Native select styling */
  select {
    appearance: none;
    background: url('data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"%3E%3Cpath d="M6 9L12 15L18 9" stroke="%23000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E')
      no-repeat;
    background-position: right var(--spacing-sm) center;
    background-color: var(--surface);
    padding-right: calc(var(--spacing-lg) + var(--spacing-md));
  }

  /* Selection tool toggle (rectangle / lasso) */
  .tool-toggle {
    display: inline-flex;
    align-items: center;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .tool-toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 6px;
    border: none;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .tool-toggle-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
  }

  .tool-toggle-btn.active {
    background: var(--primary);
    color: var(--text-light);
  }

  .tool-toggle-btn .icon {
    width: 16px;
    height: 16px;
  }

  /* Settings indicator for files with custom legend settings */
  .settings-indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--primary);
    margin-left: 2px;
  }
`;
