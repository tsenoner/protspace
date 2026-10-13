import { css } from 'lit';
import { focusRing } from '../kit/kit-shared.styles';

/**
 * The query builder's sheet, shared by the builder, its condition rows, the value picker and the
 * numeric input (each has its own shadow root). Every colour and type size reads a --ps-* token.
 *
 * The rows stack: number, operator, annotation and ✕ on the first line, the values below, which is
 * what a 240–480 px sidebar panel needs. The two pickers stay `position: fixed` against a measured
 * trigger, so no ancestor of the Filter panel may get a transform, filter, contain or
 * container-type.
 */
export const queryBuilderStyles = [
  focusRing,
  css`
    :host {
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      line-height: var(--ps-leading-tight);
      color: var(--ps-text);
    }

    button,
    select,
    input {
      font: inherit;
      color: inherit;
    }

    /* ── The builder ─────────────────────────────────────────────────────── */

    .query-builder {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: var(--ps-space-3);
    }

    .query-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .query-title {
      font-size: var(--ps-text-md);
      font-weight: var(--ps-weight-semibold);
    }

    .query-conditions {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: var(--ps-space-2);
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .query-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-3);
    }

    .btn-link {
      padding: var(--ps-space-0-5) var(--ps-space-1);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: none;
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-medium);
      cursor: pointer;
    }

    .btn-link:hover {
      text-decoration: underline;
    }

    .query-footer {
      display: flex;
      flex: none;
      flex-direction: column;
      gap: var(--ps-space-1-5);
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }

    .match-count,
    .apply-reason {
      margin: 0;
      font-size: var(--ps-text-sm);
      line-height: var(--ps-leading-normal);
      font-variant-numeric: tabular-nums;
    }

    .match-count {
      color: var(--ps-text);
    }

    /* Room for one line even while empty, so the buttons do not jump when a reason appears. */
    .apply-reason {
      min-height: calc(var(--ps-text-sm) * var(--ps-leading-normal));
      color: var(--ps-text-muted);
    }

    .query-footer-buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .query-footer-reset {
      margin-inline-end: auto;
    }

    /* ── Groups ──────────────────────────────────────────────────────────── */

    .group-container {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
      padding-left: var(--ps-space-2);
      border-left: 3px solid var(--ps-border);
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .group-label {
      flex: 1;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-semibold);
    }

    .group-conditions {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
    }

    /* ── A condition row ─────────────────────────────────────────────────── */

    .condition-row {
      display: grid;
      grid-template-areas:
        'number op annotation remove'
        'values values values values';
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      padding: var(--ps-space-2);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
    }

    .condition-number {
      grid-area: number;
      min-width: 1.25em;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .condition-row > .logical-op-select {
      grid-area: op;
    }

    .condition-row > .condition-remove {
      grid-area: remove;
    }

    .condition-values {
      grid-area: values;
      min-width: 0;
    }

    /* Native selects: keyboard, mobile and screen-reader support for free. */
    .logical-op-select,
    .numeric-operator-select {
      box-sizing: border-box;
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-1);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      cursor: pointer;
    }

    .logical-op-select {
      min-width: 4.5rem;
      font-weight: var(--ps-weight-medium);
    }

    .logical-op-select.op-blank {
      color: var(--ps-text-muted);
    }

    .logical-op-placeholder {
      flex: none;
      width: 4.5rem;
    }

    .annotation-select-trigger {
      grid-area: annotation;
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      box-sizing: border-box;
      min-width: 0;
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      text-align: left;
      cursor: pointer;
    }

    .logical-op-select:hover,
    .numeric-operator-select:hover:not(:disabled),
    .annotation-select-trigger:hover {
      border-color: var(--ps-border-strong);
      background: var(--ps-surface-hover);
    }

    .dropdown-trigger-text,
    .dropdown-item-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .predicted-mark {
      display: inline-flex;
      flex: none;
      color: var(--ps-text-muted);
    }

    /* ── Value chips ─────────────────────────────────────────────────────── */

    .value-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-1);
      min-width: 0;
    }

    .value-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1);
      box-sizing: border-box;
      max-width: 160px;
      height: 22px;
      padding: 0 var(--ps-space-1) 0 var(--ps-space-2);
      border-radius: var(--ps-radius-full);
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-sm);
    }

    .value-chip-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .value-chip-remove {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font-size: var(--ps-text-sm);
      line-height: 1;
      opacity: 0.7;
      cursor: pointer;
    }

    .value-chip-remove:hover {
      opacity: 1;
    }

    .value-chip-add {
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      height: 22px;
      padding: 0 var(--ps-space-2);
      border: 1px dashed var(--ps-accent);
      border-radius: var(--ps-radius-full);
      background: none;
      color: var(--ps-accent-text);
      font-size: var(--ps-text-sm);
      cursor: pointer;
    }

    .value-chip-add:hover {
      background: var(--ps-accent-tint);
    }

    /* ── The annotation and value pickers ────────────────────────────────── */

    /* position: fixed against a measured trigger, so a scrolling panel cannot clip them. */
    .annotation-picker,
    .value-picker {
      position: fixed;
      z-index: 1001;
      box-sizing: border-box;
      min-width: 200px;
      max-width: 280px;
      padding: var(--ps-space-2);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-lg);
    }

    .annotation-picker-input,
    .value-picker-input,
    .numeric-field {
      box-sizing: border-box;
      height: var(--ps-control-sm);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
    }

    .annotation-picker-input,
    .value-picker-input {
      width: 100%;
      margin-bottom: var(--ps-space-1);
    }

    .annotation-picker-input::placeholder,
    .value-picker-input::placeholder,
    .numeric-field::placeholder {
      color: var(--ps-text-muted);
    }

    /* Inside a tight box the ring sits on the border rather than 2 px outside it. */
    .annotation-picker-input:focus-visible,
    .value-picker-input:focus-visible,
    .numeric-field:focus-visible {
      outline-offset: -1px;
    }

    .value-picker-list {
      display: flex;
      flex-direction: column;
      max-height: 15rem;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    /* The options carry no tabindex: focus stays in the search input and .highlighted is the
       keyboard cursor (aria-activedescendant). */
    .dropdown-item {
      padding: var(--ps-space-1-5) var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-text);
      cursor: pointer;
    }

    .dropdown-item:hover,
    .dropdown-item.highlighted {
      background: var(--ps-accent-tint);
    }

    .value-picker-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .annotation-picker-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    .annotation-picker-item[aria-selected='true'] {
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-medium);
    }

    /* Locked out while the "Any value" sentinel is selected (it subsumes them). */
    .value-picker-item.is-disabled,
    .value-picker-item.is-disabled:hover,
    .value-picker-item.is-disabled.highlighted {
      background: none;
      color: var(--ps-text-faint);
      cursor: not-allowed;
    }

    .value-picker-highlight {
      background: none;
      color: var(--ps-accent-text);
      font-weight: var(--ps-weight-semibold);
    }

    .value-picker-count {
      flex: none;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .value-picker-footer {
      margin-top: var(--ps-space-1);
      padding-top: var(--ps-space-1);
      border-top: 1px solid var(--ps-border);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      text-align: center;
    }

    .annotation-picker-category {
      position: sticky;
      top: 0;
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1);
      background: var(--ps-surface-raised);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    @media (forced-colors: active) {
      .dropdown-item.highlighted {
        outline: 1px solid Highlight;
      }
    }

    /* ── The numeric input ───────────────────────────────────────────────── */

    .numeric-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ps-space-1);
    }

    .numeric-field {
      width: 84px;
    }

    .numeric-field:disabled,
    .numeric-operator-select:disabled {
      background: var(--ps-surface-muted);
      color: var(--ps-text-faint);
      cursor: not-allowed;
    }

    .numeric-dash {
      color: var(--ps-text-muted);
    }

    .numeric-match-count {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
];

/** The builder's own host fills the panel that holds it; the rows and pickers sharing the sheet above do not. */
export const queryBuilderHostStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Embedded in the app's Filter panel, whose body already pads its content. */
  :host([embedded]) .query-builder {
    padding: 0;
  }
`;
