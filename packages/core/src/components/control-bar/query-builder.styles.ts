import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { buttonMixin, inputMixin, dropdownMixin } from '../../styles/mixins';

/**
 * Query Builder Styles
 *
 * Shared styles for query-builder, query-condition-row, query-numeric-input and
 * query-value-picker.
 *
 * Composes the design system explicitly — tokens plus the button/input/dropdown
 * mixins — exactly like annotation-select.styles.ts. Previously this sheet was a
 * bare `css` block that only worked inside the control bar's shadow root, where
 * the parent happened to pull the mixins in; the row/picker components (which
 * have their own shadow roots) inherited the custom properties but none of the
 * component classes, so they drifted away from the rest of the UI.
 */
export const queryBuilderStyles = [
  tokens,
  buttonMixin,
  inputMixin,
  dropdownMixin,
  css`
    /* ==========================================
       QUERY BUILDER CONTAINER
       ========================================== */

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

    /* ==========================================
       NATIVE SELECTS (logical operator + numeric operator)
       ========================================== */

    /* Deliberately native <select>s: keyboard, mobile and screen-reader support
       for free. inputMixin already supplies border, radius, surface, typography,
       shadow and the focus ring, so all that is left here is the chevron (written
       once for both) and the room it needs. */
    .logical-op-select,
    .numeric-operator-select {
      padding-right: 1.375rem;
      padding-left: var(--spacing-sm);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b6b7a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right var(--spacing-xs) center;
      background-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
      box-sizing: border-box;
      flex: none;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
    }

    .logical-op-select:hover,
    .numeric-operator-select:hover {
      background-color: var(--hover-bg);
      border-color: var(--border-hover);
    }

    /* Sized by its widest option (AND / OR / NOT) with a floor so the blank and
       NOT-only variants still line up with the rows below — no fixed width to
       clip against. */
    .logical-op-select {
      width: auto;
      min-width: 4.5rem;
      font-weight: var(--font-medium);
      text-align: center;
    }

    .logical-op-select.op-blank {
      opacity: 0.5;
    }

    .logical-op-placeholder {
      width: 4.5rem;
      flex: none;
    }

    .annotation-select-trigger {
      justify-content: space-between;
      min-width: 120px;
      padding: var(--input-padding-y) var(--input-padding-x);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--muted);
      box-shadow: var(--shadow-sm);
    }

    .annotation-select-trigger:hover {
      background: var(--hover-bg);
      border-color: var(--border-hover);
    }

    .condition-remove {
      color: var(--text-secondary);
      opacity: 0.6;
      padding: var(--spacing-xs);
      border-radius: var(--radius);
      line-height: 1;
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
      opacity: 0.6;
      font-size: var(--text-sm);
      line-height: 1;
      color: inherit;
      padding: 0;
      flex-shrink: 0;
    }

    .value-chip-remove:hover {
      opacity: 1;
    }

    .value-chip-add {
      display: inline-flex;
      gap: var(--spacing-2xs);
      border: var(--border-width) dashed var(--primary);
      color: var(--primary);
      border-radius: var(--radius-pill);
      padding: var(--spacing-2xs) var(--spacing-sm);
      font-size: var(--text-sm);
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
       PICKER POPOVERS (annotation + value)
       ========================================== */

    /* Same surface as dropdownMixin's .dropdown-menu, but position: fixed against
       a measured trigger so the menu can escape the modal's clipping context —
       the markup therefore cannot reuse the .dropdown-menu class. */
    .annotation-picker,
    .value-picker {
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

    /* The search fields carry no type attribute, so inputMixin's
       input[type='text'] selector never reaches them; this mirrors it. */
    .annotation-picker-input,
    .value-picker-input {
      width: 100%;
      padding: var(--input-padding-y) var(--input-padding-x);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-family: inherit;
      font-size: var(--text-base);
      color: var(--muted);
      box-shadow: var(--shadow-sm);
      transition: var(--transition);
      margin-bottom: var(--spacing-xs);
      box-sizing: border-box;
    }

    .annotation-picker-input:focus,
    .value-picker-input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow:
        0 0 0 1px var(--primary),
        0 0 0 3px var(--focus-ring-bg);
    }

    /* Shared by both pickers (the annotation picker reuses this list wrapper). */
    .value-picker-list {
      display: flex;
      flex-direction: column;
      max-height: 15rem;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    /* Mirrors .dropdown-item from dropdownMixin. .highlighted is the keyboard
       cursor and must render identically to hover. */
    .annotation-picker-item,
    .value-picker-item {
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: var(--text-base);
      color: var(--muted);
      cursor: pointer;
      transition: var(--transition-fast);
      border-left: var(--border-width) solid transparent;
    }

    .value-picker-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-sm);
    }

    .annotation-picker-item:hover,
    .annotation-picker-item.highlighted,
    .value-picker-item:hover,
    .value-picker-item.highlighted {
      background: var(--primary-light);
      border-left-color: var(--primary);
    }

    .annotation-picker-item:focus-visible,
    .value-picker-item:focus-visible {
      outline: none;
      background: var(--primary-light);
      border-left-color: var(--primary);
      box-shadow:
        0 0 0 1px var(--primary),
        0 0 0 3px var(--focus-ring-bg);
    }

    /* Locked out while the "Any value" sentinel is selected (it subsumes them). */
    .value-picker-item.is-disabled,
    .value-picker-item.is-disabled:hover,
    .value-picker-item.is-disabled.highlighted {
      opacity: 0.5;
      cursor: not-allowed;
      background: none;
      border-left-color: transparent;
      color: var(--muted);
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

    /* Matches .annotation-section-header in annotation-select.styles.ts. */
    .annotation-picker-category {
      padding: var(--spacing-sm) var(--spacing-md) var(--spacing-xs);
      font-size: var(--text-sm);
      font-weight: var(--font-semibold);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: var(--border-width) solid var(--border);
      position: sticky;
      top: 0;
      z-index: var(--z-base);
      background: var(--surface);
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

    /* type="number" is outside inputMixin's reach, so this mirrors it. */
    .numeric-field {
      width: 90px;
      padding: var(--input-padding-y) var(--input-padding-x);
      border: var(--border-width) solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-family: inherit;
      font-size: var(--text-base);
      color: var(--muted);
      box-shadow: var(--shadow-sm);
      transition: var(--transition);
      box-sizing: border-box;
    }

    .numeric-field:focus {
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
  `,
];
