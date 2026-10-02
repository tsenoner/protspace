import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { dropdownMixin, buttonMixin } from '../../styles/mixins';

/**
 * Protein Search Component Styles
 *
 * Simplified search with consistent spacing throughout.
 */
export const searchStyles = [
  tokens,
  dropdownMixin,
  buttonMixin,
  css`
    :host {
      display: block;
      width: 100%;
    }

    .search-container {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
    }

    .search-chips {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-xs);
      background: var(--surface);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      overflow-x: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar) transparent;
    }

    .search-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-xs) var(--spacing-sm);
      background: var(--primary-light);
      color: var(--text-dark);
      border: var(--border-width) solid var(--border-light);
      border-radius: 999px;
      font-size: var(--text-sm);
      white-space: nowrap;
    }

    .search-input {
      flex: 1;
      min-width: 0;
      padding: var(--spacing-xs);
      border: none;
      outline: none;
      background: transparent;
      font-size: var(--text-base);
      color: var(--muted);
    }

    .search-keyboard-shortcut-hint {
      position: absolute;
      right: var(--spacing-sm);
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-xs) var(--spacing-xs);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      font-size: var(--text-sm);
      color: var(--hint);
      pointer-events: none;
    }

    .search-keyboard-shortcut-hint kbd {
      padding: 0;
      margin: 0;
      border: none;
      background: none;
      font-family: inherit;
      font-size: inherit;
      line-height: 1;
    }

    .search-suggestions {
      position: absolute;
      top: calc(100% + var(--dropdown-offset));
      left: 0;
      right: 0;
      max-height: 20rem;
      background: var(--surface);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      overflow-y: auto;
      z-index: var(--z-dropdown);
    }

    .search-suggestion {
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: var(--text-base);
      color: var(--muted);
      border-left: var(--border-width) solid transparent;
      cursor: pointer;
      transition: var(--transition-fast);
    }

    .search-suggestion:hover,
    .search-suggestion.active,
    .search-suggestion:focus {
      background: var(--primary-light);
      border-left-color: var(--primary);
    }

    .search-suggestion.selected {
      opacity: 0.7;
    }

    .search-suggestion.selected::before {
      content: '✓';
      margin-right: var(--spacing-sm);
      color: var(--primary);
    }

    .search-suggestion.selected::after {
      content: '✕';
      float: right;
      opacity: 0;
      transition: var(--transition-fast);
    }

    .search-suggestion.selected:hover::after,
    .search-suggestion.selected.active::after {
      opacity: 1;
    }

    .no-results {
      padding: var(--spacing-md);
      text-align: center;
      font-size: var(--text-base);
      color: var(--muted);
    }
  `,
];
