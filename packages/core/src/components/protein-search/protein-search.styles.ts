import { css } from 'lit';
import { srOnly } from '../kit/kit-shared.styles';

/**
 * The app bar's protein search (mockup: a 32 px field with a leading search icon): the field, its
 * suggestion list and its report. Every colour and type size reads a --ps-* token.
 */
export const searchStyles = [
  srOnly,
  css`
    :host {
      display: block;
      width: 100%;
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
      line-height: var(--ps-leading-tight);
      color: var(--ps-text);
    }

    .search-container {
      position: relative;
    }

    .search-chips {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      box-sizing: border-box;
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-2);
      border: 1px solid var(--ps-border-control);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      cursor: text;
    }

    .search-chips:hover {
      border-color: var(--ps-border-strong);
    }

    /* The input draws no outline; the field draws the kit focus ring around it. */
    .search-chips:has(.search-input:focus-visible) {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: -1px;
    }

    .search-icon {
      display: inline-flex;
      flex: none;
      color: var(--ps-text-muted);
    }

    .search-input {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ps-text);
      font: inherit;
    }

    .search-input::placeholder {
      color: var(--ps-text-muted);
    }

    .search-keyboard-shortcut-hint {
      display: flex;
      flex: none;
      align-items: center;
      padding: 0 var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: 1.5;
      pointer-events: none;
    }

    .search-keyboard-shortcut-hint kbd {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
    }

    .search-suggestions,
    .search-popup {
      position: absolute;
      top: calc(100% + var(--ps-space-1));
      left: 0;
      right: 0;
      z-index: 100;
      box-sizing: border-box;
      max-height: 20rem;
      overflow-y: auto;
      padding: var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-lg);
    }

    .search-suggestion {
      padding: var(--ps-space-1-5) var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-text);
      cursor: pointer;
    }

    .search-suggestion:hover,
    .search-suggestion.active {
      background: var(--ps-accent-tint);
    }

    .search-suggestion.selected {
      color: var(--ps-text-muted);
    }

    .search-suggestion.selected::before {
      content: '✓';
      margin-right: var(--ps-space-2);
      color: var(--ps-accent-text);
    }

    .search-suggestion.selected::after {
      content: '✕';
      float: right;
      opacity: 0;
      transition: opacity var(--ps-duration-fast) var(--ps-ease);
    }

    .search-suggestion.selected:hover::after,
    .search-suggestion.selected.active::after {
      opacity: 1;
    }

    .no-results {
      padding: var(--ps-space-3);
      color: var(--ps-text-muted);
      text-align: center;
    }

    .search-report {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1-5);
      padding: var(--ps-space-2);
    }

    .search-report-line {
      margin: 0;
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
    }

    .search-report-heading {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .search-report-missing {
      max-height: 10rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
    }

    .search-report-missing li {
      padding: var(--ps-space-0-5) 0;
      overflow-wrap: anywhere;
    }

    .search-report-more {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
    }

    .search-report-copy {
      align-self: flex-start;
    }

    @media (prefers-reduced-motion: reduce) {
      .search-suggestion.selected::after {
        transition: none;
      }
    }
  `,
];
