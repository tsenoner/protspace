import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { buttonMixin, inputMixin, dropdownMixin } from '../../styles/mixins';

/**
 * Annotation Select Component Styles
 *
 * Uses shared dropdown system from mixins with annotation-specific overrides.
 * The annotation dropdown has a search input that stays fixed, so we override
 * the dropdown menu to hide overflow and let the inner list container scroll.
 */
export const annotationSelectStyles = [
  tokens,
  buttonMixin,
  inputMixin,
  dropdownMixin,
  css`
    :host {
      display: inline-flex;
      position: relative;
      max-width: 100%;
    }

    .annotation-select-container {
      position: relative;
      display: inline-flex;
      width: 100%;
      max-width: 100%;
    }

    /* Ensure dropdown-trigger padding matches (inherited from dropdownMixin) */

    /* Override dropdown menu to match projection dropdown exactly */
    .dropdown-menu {
      overflow-y: auto;
      overflow-x: hidden;
      /* Match trigger width more closely */
      width: 100%;
      max-width: 20rem;
    }

    .annotation-search-container {
      padding: var(--spacing-sm);
      border-bottom: var(--border-width) solid var(--border);
    }

    .annotation-search-input {
      width: 100%;
      padding: var(--input-padding-y) var(--input-padding-x);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: var(--text-base);
      color: var(--muted);
      transition: var(--transition);
      box-sizing: border-box;
    }

    .annotation-search-input:focus {
      outline: none;
      box-shadow:
        0 0 0 1px var(--primary),
        0 0 0 3px var(--focus-ring-bg);
    }

    .annotation-list-container {
      max-height: 20rem;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      width: 100%;
    }

    .annotation-section {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    .annotation-section-header {
      position: sticky;
      top: 0;
      padding: var(--spacing-sm) var(--spacing-md) var(--spacing-xs);
      background: var(--surface);
      border-bottom: var(--border-width) solid var(--border);
      font-size: var(--text-sm);
      font-weight: var(--font-semibold);
      text-transform: uppercase;
      color: var(--muted);
      z-index: var(--z-base);
      box-sizing: border-box;
    }

    .annotation-section-items {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    /* Ensure dropdown items fill the full width and show the left border */
    .dropdown-item {
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    .primary-indicator {
      flex: 0 0 0.85rem;
      width: 0.85rem;
      height: 0.85rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .primary-dot {
      display: block;
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--primary);
    }

    .dropdown-item-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tooltip-toggle-slot {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
    }

    .tooltip-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      background: none;
      border: none;
      border-radius: 0.25rem;
      color: var(--muted);
      cursor: pointer;
      transition: var(--transition);
    }

    .tooltip-toggle-btn:hover {
      color: var(--primary);
      background: var(--primary-alpha-10);
    }

    .tooltip-toggle-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--focus-ring-bg);
    }

    .tooltip-toggle-btn.is-active {
      color: var(--primary);
    }

    .no-results {
      padding: var(--spacing-lg);
      text-align: center;
      font-size: var(--text-base);
      color: var(--muted);
    }

    @media (max-width: 1200px) {
      :host,
      .annotation-select-container,
      .dropdown-trigger {
        width: 100%;
      }

      .dropdown-menu {
        left: 0;
        right: 0;
        width: 100%;
        max-width: 100%;
      }
    }
  `,
];
