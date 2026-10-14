import { css } from 'lit';
import { focusRing, kitHost, srOnly } from '../kit/kit-shared.styles';

/**
 * The Color by picker: a ghost key/value trigger, and a top-layer panel with a search field and a
 * grouped listbox (mockup workbench-light: search with an icon, uppercase group labels, a check
 * and tint on the chosen row).
 */
export const annotationSelectStyles = [
  kitHost,
  focusRing,
  srOnly,
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

    /* The view bar's key/value trigger (decision 1): ghost, 32 px, key muted, value medium. */
    .dropdown-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      min-width: 0;
      max-width: 100%;
      padding: 0 var(--ps-space-2);
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      cursor: pointer;
      overflow: hidden;
    }

    .dropdown-trigger:hover,
    .dropdown-trigger.open {
      background: var(--ps-surface-hover);
    }

    .dropdown-trigger.open {
      box-shadow: inset 0 0 0 1px var(--ps-border-strong);
    }

    /* A finger-sized target (design decision 17); the bar's 48 px row on a phone holds it. */
    @media (pointer: coarse) {
      .dropdown-trigger {
        height: var(--ps-touch-target);
      }
    }

    /* The view bar narrows Color by on a phone: the value ends in an ellipsis instead of the bar
       overflowing. The container's own minimum would otherwise stay at the text's width. */
    :host,
    .annotation-select-container {
      min-width: 0;
    }

    .dropdown-trigger .key {
      color: var(--ps-text-muted);
      white-space: nowrap;
    }

    .dropdown-trigger-text {
      flex: 1;
      min-width: 0;
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      font-weight: var(--ps-weight-medium);
    }

    .chevron-down {
      display: inline-flex;
      flex: none;
      color: var(--ps-text-faint);
      transition: transform var(--ps-duration-fast) var(--ps-ease);
    }

    .dropdown-trigger.open .chevron-down {
      transform: rotate(180deg);
    }

    /* The predicted mark beside a name (renderAnnotationName and the rows). */
    .predicted-mark {
      display: inline-flex;
      flex: none;
      color: var(--ps-text-muted);
    }

    /* ─── The panel, inside the ps-popover ───────────────────── */
    ps-popover::part(panel) {
      min-width: 16rem;
      max-width: min(28rem, calc(100vw - 16px));
    }

    .dropdown-menu {
      display: flex;
      flex-direction: column;
    }

    .annotation-search-container {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-sm);
      margin: var(--ps-space-1) var(--ps-space-1) 0;
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      color: var(--ps-text-faint);
    }

    .annotation-search-container:focus-within {
      border-color: var(--ps-focus);
      box-shadow: 0 0 0 1px var(--ps-focus);
    }

    @media (forced-colors: active) {
      .annotation-search-container:focus-within {
        outline: var(--ps-focus-width) solid Highlight;
      }
    }

    .annotation-search-input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }

    .annotation-search-input::placeholder {
      color: var(--ps-text-muted);
    }

    .annotation-list-container {
      max-height: 20rem;
      overflow-y: auto;
      overflow-x: hidden;
      padding: var(--ps-space-1);
      scrollbar-width: thin;
    }

    .annotation-section,
    .annotation-section-items {
      display: flex;
      flex-direction: column;
    }

    /* Group labels read like ps-menu-label. */
    .annotation-section-header {
      padding: var(--ps-space-2) var(--ps-space-2) var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* A row: the option, then the ⓘ and the eye beside it. */
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      min-height: var(--ps-row);
      padding: 0 var(--ps-space-1) 0 var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-text);
      cursor: pointer;
    }

    .dropdown-item:hover,
    .dropdown-item.highlighted {
      background: var(--ps-surface-hover);
    }

    .dropdown-item.selected {
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
    }

    .dropdown-item.highlighted {
      box-shadow: inset 0 0 0 1px var(--ps-border-strong);
    }

    .dropdown-option {
      display: flex;
      flex: 1;
      align-items: center;
      gap: var(--ps-space-1-5);
      min-width: 0;
    }

    .selected-check {
      display: inline-flex;
      flex: none;
      width: 14px;
    }

    .dropdown-item-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dropdown-item.selected .dropdown-item-label {
      font-weight: var(--ps-weight-medium);
    }

    /* EAT and STATS: small token chips; their meaning is the option's description. */
    .menu-badge {
      flex: none;
      padding: 0 var(--ps-space-1);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface-muted);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.03em;
      line-height: var(--ps-leading-normal);
      user-select: none;
    }

    .eat-badge {
      background: var(--ps-accent-tint);
      color: var(--ps-accent-text);
    }

    .annotation-info {
      display: inline-flex;
      flex: none;
      align-items: center;
    }

    .tooltip-toggle-slot {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
    }

    .tooltip-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-text-muted);
      cursor: pointer;
    }

    .tooltip-toggle-btn:hover {
      background: var(--ps-surface-hover);
      color: var(--ps-text);
    }

    .tooltip-toggle-btn.is-active {
      color: var(--ps-accent-text);
    }

    .no-results {
      margin: 0;
      padding: var(--ps-space-3);
      color: var(--ps-text-muted);
      text-align: center;
    }
  `,
];
