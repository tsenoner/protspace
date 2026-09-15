import { css } from 'lit';

/**
 * Base Input/Select Styling
 * Provides consistent styling for all input and select elements
 */
export const inputMixin = css`
  /* Base input/select styling - shared across all inputs */
  select,
  input[type='text'],
  input[type='search'],
  .input-base {
    padding: var(--input-padding-y) var(--input-padding-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--muted);
    box-shadow: var(--shadow-sm);
    transition: var(--transition);
  }

  select:focus,
  input[type='text']:focus,
  input[type='search']:focus,
  .input-base:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  select {
    max-width: 100%;
  }
`;

/**
 * Comprehensive Button Variant System
 * Provides consistent styling for all button types across the application
 * Based on the legend component's excellent button designs
 */
export const buttonMixin = css`
  /* Base button styles - applies to all variants */
  .btn,
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: var(--text-base);
    line-height: 1.5;
    border: none;
    background: none;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    box-sizing: border-box;
  }

  /* Unified focus styling for all buttons - matches input focus */
  .btn:focus-visible,
  button:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  /* Primary variant - legend extract-button style */
  .btn-primary,
  button.btn-primary {
    background: var(--primary);
    border: 1px solid var(--primary);
    color: var(--text-light);
    padding: var(--button-padding-y) var(--button-padding-x);
    border-radius: var(--radius);
    font-weight: 500;
  }

  .btn-primary:hover,
  button.btn-primary:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
    box-shadow: 0 2px 6px var(--primary-alpha-30);
  }

  .btn-primary:focus-visible:hover,
  button.btn-primary:focus-visible:hover {
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg),
      0 2px 6px var(--primary-alpha-30);
  }

  /* Secondary variant - legend modal-close-button style */
  .btn-secondary,
  button.btn-secondary {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: var(--button-padding-y) var(--button-padding-x);
    border-radius: var(--radius);
    font-weight: 500;
  }

  .btn-secondary:hover,
  button.btn-secondary:hover {
    background: var(--hover-bg-alt);
    border-color: var(--border-hover);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }

  .btn-secondary:focus-visible:hover,
  button.btn-secondary:focus-visible:hover {
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg),
      0 2px 4px rgba(0, 0, 0, 0.08);
  }

  /* Danger variant - legend modal-reset-button style */
  .btn-danger,
  button.btn-danger {
    background: transparent;
    border: 1px solid var(--danger-border);
    color: var(--danger);
    padding: var(--button-padding-y) var(--button-padding-x);
    border-radius: var(--radius);
    font-weight: 500;
  }

  .btn-danger:hover,
  button.btn-danger:hover {
    background: var(--danger-hover);
    border-color: var(--danger-hover);
    color: var(--text-light);
    box-shadow: 0 2px 4px rgba(220, 38, 38, 0.2);
  }

  /* Text-link variant - legend view-button style */
  .btn-link,
  button.btn-link {
    background: none;
    border: none;
    color: var(--primary);
    font-weight: 500;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
  }

  .btn-link:hover,
  button.btn-link:hover {
    color: var(--primary-hover);
  }

  /* Icon-only variant - legend customize-button style */
  .btn-icon,
  button.btn-icon {
    background: none;
    border: none;
    color: var(--text-secondary);
    padding: 0.3rem 0.5rem;
    border-radius: 0.25rem;
  }

  .btn-icon:hover,
  button.btn-icon:hover {
    color: var(--primary);
    background: var(--primary-alpha-10);
  }

  /* Icon-only close button - legend/structure-viewer close-button style */
  .btn-close,
  button.btn-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    padding: 0.5rem 0.7rem;
    border-radius: 0.25rem;
  }

  .btn-close:hover,
  button.btn-close:hover {
    color: var(--primary);
    background: var(--primary-alpha-10);
  }

  /* Compact variant - smaller padding for dense UIs */
  .btn-compact,
  button.btn-compact {
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: var(--text-sm);
  }

  /* Disabled state - applies to all variants */
  .btn:disabled,
  button:disabled,
  .btn[disabled],
  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Legacy support - active/selected state maps to primary variant */
  .btn.active,
  .btn.selected,
  button.active,
  button.selected {
    background: var(--primary);
    color: var(--text-light);
    border-color: var(--primary);
    fill: var(--text-light);
  }

  .btn.active:hover:not(:disabled),
  .btn.selected:hover:not(:disabled),
  button.active:hover:not(:disabled),
  button.selected:hover:not(:disabled) {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
  }
`;

/**
 * Dropdown System
 * Provides consistent dropdown trigger, menu, and item styling
 */
export const dropdownMixin = css`
  /* ==========================================
      UNIFIED DROPDOWN SYSTEM
     ========================================== */

  /* Dropdown containers share common styling */
  .export-container,
  .filter-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  /* Projection container - similar to annotation-select-container */
  .projection-container {
    position: relative;
    display: inline-flex;
  }

  /* Master dropdown trigger class - used by all dropdowns */
  .dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-xs);
    padding: var(--input-padding-y) var(--input-padding-x);
    min-width: 10rem;
    max-width: 100%;
    cursor: pointer;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--text-base);
    color: var(--muted);
    box-shadow: var(--shadow-sm);
    transition: var(--transition);
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    overflow: hidden;
  }

  /* Compact dropdown triggers (for buttons with icons like Filter/Export) */
  .filter-container .dropdown-trigger,
  .export-container .dropdown-trigger {
    min-width: auto;
    padding: var(--button-padding-y) var(--spacing-sm);
  }

  .dropdown-trigger:hover {
    background: var(--hover-bg);
  }

  .dropdown-trigger:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .dropdown-trigger:focus-visible:hover {
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .dropdown-trigger.open {
    border-color: var(--primary);
  }

  /* Text wrapper for dropdown triggers */
  .dropdown-trigger-text {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Unified chevron icon for all dropdowns */
  .chevron-down {
    width: 1rem;
    height: 1rem;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
    flex-shrink: 0;
    transition: var(--transition-fast);
  }

  .dropdown-trigger.open .chevron-down {
    transform: rotate(180deg);
  }

  /* Master dropdown menu class - shared by all dropdown menus */
  .dropdown-menu,
  .filter-menu,
  .export-menu {
    position: absolute;
    top: calc(100% + var(--dropdown-offset));
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  .dropdown-menu {
    min-width: 100%; /* Match trigger width minimum */
    width: max-content; /* Expand if content is wider */
    max-width: 20rem; /* But don't get too wide */
  }

  /* Left-aligned dropdowns (projection, annotation) */
  .dropdown-menu.align-left {
    left: 0;
  }

  /* Projection dropdown - match trigger width exactly like annotation dropdown */
  .projection-container .dropdown-menu.align-left {
    min-width: 100%; /* Match trigger width */
    width: max-content; /* Allow expansion if content is wider */
  }

  /* Right-aligned dropdowns (filter, export) */
  .dropdown-menu.align-right,
  .filter-menu,
  .export-menu {
    right: 0;
  }

  /* Master dropdown item class */
  .dropdown-item {
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: var(--text-base);
    color: var(--muted);
    cursor: pointer;
    transition: var(--transition-fast);
    border-left: var(--border-width) solid transparent;
  }

  .dropdown-item:hover,
  .dropdown-item.highlighted {
    background: var(--primary-light);
    border-left-color: var(--primary);
  }

  .dropdown-item.selected {
    font-weight: var(--font-semibold);
    color: var(--primary);
  }

  .dropdown-item.selected:hover,
  .dropdown-item.selected.highlighted {
    background: var(--primary-light);
  }

  /* List wrapper for dropdown items */
  .dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
`;

/**
 * Icon Styling
 * Consistent icon sizing and appearance
 */
export const iconMixin = css`
  .icon {
    width: 1rem;
    height: 1rem;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
  }
`;

/**
 * Screen-reader-only text
 * Visually hidden but still announced by assistive technology
 */
export const srOnlyMixin = css`
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
`;
