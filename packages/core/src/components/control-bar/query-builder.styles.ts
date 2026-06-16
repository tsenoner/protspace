import { css } from 'lit';

/**
 * Query Builder Styles
 *
 * Shared styles for query-builder, query-condition-row, and query-value-picker components.
 */
export const queryBuilderStyles = css`
  /* ==========================================
     QUERY BUILDER CONTAINER
     ========================================== */

  :host {
    display: block;
  }

  .query-builder {
    width: 100%;
    height: 100%;
    padding: var(--spacing-lg);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .query-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
  }

  .query-conditions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    flex: 1;
    overflow-y: auto;
    overflow-x: visible;
    scrollbar-width: thin;
    margin-bottom: var(--spacing-sm);
  }

  .query-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .query-footer {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding-top: var(--spacing-sm);
    border-top: var(--border-width) solid var(--border);
    box-sizing: border-box;
  }

  .query-footer button {
    flex: none;
  }

  .query-footer-reset {
    margin-inline-end: auto;
  }

  /* ==========================================
     MATCH COUNT
     ========================================== */

  .match-count {
    font-size: var(--text-sm);
    color: var(--primary);
    text-align: right;
  }

  /* ==========================================
     CONDITION ROW
     ========================================== */

  .condition-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    padding: var(--spacing-sm);
    flex-wrap: wrap;
    box-sizing: border-box;
  }

  .logical-op-select {
    width: 64px;
    min-width: 64px;
    padding: var(--input-padding-y) 18px var(--input-padding-y) var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background-color: var(--surface);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b6b7a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 4px center;
    background-size: 12px;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-align: center;
    cursor: pointer;
    box-sizing: border-box;
    transition: var(--transition-fast);
    appearance: none;
    -webkit-appearance: none;
  }

  .logical-op-select.op-blank {
    opacity: 0.5;
  }

  .logical-op-placeholder {
    width: 64px;
    min-width: 64px;
    flex-shrink: 0;
  }

  .annotation-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-xs);
    min-width: 120px;
    padding: var(--input-padding-y) var(--input-padding-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--text-primary);
    cursor: pointer;
    transition: var(--transition-fast);
    box-sizing: border-box;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .annotation-select-trigger:hover {
    background: var(--hover-bg);
    border-color: var(--border-hover);
  }

  .annotation-select-trigger:focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .condition-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    opacity: 0.6;
    padding: var(--spacing-xs);
    border-radius: var(--radius);
    font-size: var(--text-base);
    line-height: 1;
    transition: var(--transition-fast);
    flex-shrink: 0;
  }

  .condition-remove:hover {
    color: var(--danger);
    opacity: 1;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  /* ==========================================
     VALUE CHIPS
     ========================================== */

  .value-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-xs);
    flex: 1;
    min-width: 0;
  }

  .value-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--primary) 15%, transparent);
    color: var(--primary);
    border-radius: var(--radius-pill);
    padding: var(--spacing-2xs) var(--spacing-sm);
    font-size: var(--text-sm);
    max-width: 160px;
  }

  .value-chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .value-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.6;
    font-size: var(--text-sm);
    line-height: 1;
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    flex-shrink: 0;
    transition: var(--transition-fast);
  }

  .value-chip-remove:hover {
    opacity: 1;
  }

  .value-chip-add {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-2xs);
    border: var(--border-width) dashed var(--primary);
    color: var(--primary);
    background: none;
    border-radius: var(--radius-pill);
    padding: var(--spacing-2xs) var(--spacing-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-fast);
  }

  .value-chip-add:hover {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }

  /* ==========================================
     GROUP
     ========================================== */

  .group-container {
    border-left: 3px solid var(--border);
    padding-left: var(--spacing-md);
    margin-left: 4px;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .group-conditions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  /* ==========================================
     VALUE PICKER (DROPDOWN)
     ========================================== */

  .value-picker {
    position: fixed;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-above-modal);
    max-width: 280px;
    min-width: 200px;
    padding: var(--spacing-sm);
    box-sizing: border-box;
  }

  .value-picker-input {
    width: 100%;
    padding: var(--input-padding-y) var(--input-padding-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--text-primary);
    margin-bottom: var(--spacing-xs);
    box-sizing: border-box;
    transition: var(--transition-fast);
  }

  .value-picker-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .value-picker-list {
    display: flex;
    flex-direction: column;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .value-picker-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--text-primary);
    transition: var(--transition-fast);
  }

  .value-picker-item:hover {
    background: var(--primary-light);
    color: var(--primary);
  }

  .value-picker-item mark,
  .value-picker-highlight {
    color: var(--primary);
    font-weight: var(--font-medium);
    background: none;
  }

  .value-picker-count {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .value-picker-footer {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    padding-top: var(--spacing-xs);
    border-top: var(--border-width) solid var(--border);
    margin-top: var(--spacing-xs);
    text-align: center;
  }

  /* ==========================================
     ANNOTATION PICKER (INSIDE CONDITION ROW)
     ========================================== */

  .annotation-picker {
    position: fixed;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-above-modal);
    min-width: 200px;
    max-width: 280px;
    padding: var(--spacing-sm);
    box-sizing: border-box;
  }

  .annotation-picker-input {
    width: 100%;
    padding: var(--input-padding-y) var(--input-padding-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--text-primary);
    margin-bottom: var(--spacing-xs);
    box-sizing: border-box;
    transition: var(--transition-fast);
  }

  .annotation-picker-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .annotation-picker-category {
    padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-xs);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: var(--border-width) solid var(--border);
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .annotation-picker-item {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--text-primary);
    transition: var(--transition-fast);
  }

  .annotation-picker-item:hover {
    background: var(--primary-light);
    color: var(--primary);
  }

  /* ==========================================
     BUTTONS
     ========================================== */

  /* Reset and Apply buttons use btn-danger / btn-primary from buttonMixin */

  /* ==========================================
     FILTER BADGE (CONTROL-BAR)
     ========================================== */

  .filter-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    border-radius: var(--radius-pill);
    background: var(--primary);
    color: white;
    font-size: var(--text-sm);
    padding: 0 4px;
    box-sizing: border-box;
    font-weight: var(--font-medium);
    line-height: 1;
  }

  .filter-active {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-light);
  }

  /* ==========================================
     MODAL OVERLAY
     ========================================== */

  .query-builder-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    overscroll-behavior: contain;
  }

  .query-builder-modal {
    width: 70%;
    min-width: 600px;
    max-width: 900px;
    height: 70vh;
    max-height: 80vh;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    overflow: visible;
  }

  /* ==========================================
     NUMERIC INPUT
     ========================================== */

  .numeric-input {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    flex-wrap: wrap;
  }

  .numeric-operator-select {
    padding: var(--input-padding-y) 18px var(--input-padding-y) var(--spacing-xs);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background-color: var(--surface);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b6b7a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 4px center;
    background-size: 12px;
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .numeric-field {
    width: 90px;
    padding: var(--input-padding-y) var(--input-padding-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--text-primary);
    box-sizing: border-box;
  }

  .numeric-field:focus-visible {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .numeric-dash {
    color: var(--text-secondary);
  }

  .numeric-match-count {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* ==========================================
     RESPONSIVE
     ========================================== */

  @media (max-width: 768px) {
    .query-builder-modal {
      width: 95%;
      min-width: unset;
      height: 85vh;
    }
  }

  @media (max-width: 550px) {
    .condition-row {
      flex-wrap: wrap;
    }

    .annotation-select-trigger {
      min-width: 0;
      flex: 1;
    }
  }
`;
