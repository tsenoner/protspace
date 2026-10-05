import { css } from 'lit';

/**
 * Export Menu Styles
 *
 * Simplified export menu with consistent spacing throughout.
 * Matches minimalistic design from filter menu refactoring.
 */
export const exportStyles = css`
  .export-menu {
    width: 280px;
    padding: var(--spacing-md);
    font-family: var(--font-family);
    font-size: var(--text-base);
    box-sizing: border-box;
    max-height: 50vh;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  .export-menu-header {
    padding-bottom: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
    border-bottom: var(--border-width) solid var(--border);
  }

  .export-menu-header span {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--muted);
  }

  .export-option-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
    box-sizing: border-box;
  }

  .export-option-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
  }

  .export-option-value-wrapper {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .export-option-value-input {
    width: 4rem;
    padding: 2px 4px;
    font-weight: var(--font-medium);
    color: var(--text-dark);
    background: transparent;
    border: 1px solid transparent;
    border-radius: calc(var(--radius) / 2);
    text-align: right;
    font-size: var(--text-base);
    transition: var(--transition-fast);
    box-sizing: border-box;
  }

  /* Hide number input spinner buttons */
  .export-option-value-input::-webkit-inner-spin-button,
  .export-option-value-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .export-option-value-input[type='number'] {
    -moz-appearance: textfield;
  }

  .export-option-value-input:hover {
    background: var(--hover-bg);
    border-color: var(--border);
  }

  .export-option-value-input:focus {
    outline: none;
    background: var(--surface);
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .export-option-value-unit {
    font-weight: var(--font-medium);
    color: var(--text-dark);
    font-size: var(--text-base);
    user-select: none;
  }

  .export-format-options {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--spacing-xs);
    box-sizing: border-box;
  }

  .export-slider {
    width: 100%;
    height: 3px;
    background: var(--border);
    border-radius: calc(var(--radius) / 2);
    outline: none;
    cursor: pointer;
    appearance: none;
    box-sizing: border-box;
  }

  .export-slider::-webkit-slider-thumb,
  .export-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--primary);
    border: 2px solid var(--surface);
    border-radius: 50%;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    appearance: none;
  }

  .export-slider::-webkit-slider-thumb:hover,
  .export-slider::-moz-range-thumb:hover {
    background: var(--primary-hover);
  }

  .export-slider-labels {
    display: flex;
    justify-content: space-between;
    margin-top: var(--spacing-xs);
    font-size: var(--text-xs);
    color: var(--muted);
    opacity: 0.7;
  }

  .export-image-actions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .export-image-actions button {
    width: 100%;
    justify-content: center;
    gap: var(--spacing-xs);
  }

  .export-image-hint {
    font-size: var(--text-xs);
    color: var(--muted);
    line-height: 1.4;
    margin-top: var(--spacing-xs);
    opacity: 0.8;
  }

  /* Simplified checkbox styling to match filter menu */
  .export-checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-xs);
    color: var(--text-primary);
    cursor: pointer;
    user-select: none;
  }

  .export-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--primary);
    flex-shrink: 0;
  }

  .export-parquet-help {
    font-size: var(--text-xs);
    color: var(--muted);
    line-height: 1.4;
    margin-top: var(--spacing-xs);
    opacity: 0.8;
  }

  .import-menu {
    /* Wide enough for an example's label, its "Large" badge and its info icon on one line. */
    width: 280px;
    max-width: calc(100vw - 2 * var(--spacing-md));
    padding: var(--spacing-md);
    box-sizing: border-box;
  }

  .import-current-dataset {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2xs, 0.25rem);
    padding: 0 0 var(--spacing-md);
    margin-bottom: var(--spacing-md);
    border-bottom: var(--border-width) solid var(--border);
  }

  .import-current-dataset-label,
  .import-examples-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .import-current-dataset-name {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text-primary);
    line-height: 1.4;
    word-break: break-word;
  }

  .import-actions {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .import-actions button {
    width: 100%;
  }

  .import-examples {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: var(--border-width) solid var(--border);
  }

  .import-examples-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-xs);
  }

  .import-examples-docs {
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    color: var(--primary);
    text-decoration: none;
    white-space: nowrap;
  }

  .import-examples-docs:hover {
    text-decoration: underline;
  }

  .import-examples-docs:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .import-examples-hint {
    margin: 0 0 var(--spacing-sm);
    font-size: var(--text-caption);
    color: var(--muted);
    line-height: 1.4;
  }

  /* An example item: its button, then its info popover as a sibling (never inside the button). */
  .import-example-row,
  .import-current-dataset-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .import-actions .import-example-button {
    flex: 1 1 auto;
    min-width: 0;
    gap: var(--spacing-xs);
    /* A long label wraps rather than being clipped behind the badge. */
    white-space: normal;
  }

  .import-example-label {
    min-width: 0;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .import-example-info {
    flex: 0 0 auto;
  }
`;
