import { css } from 'lit';

/**
 * The colour and shape picker's content. The panel around it is the kit's ps-popover; this styles
 * what the legend slots into it. Every colour and type size reads a --ps-* token.
 */
export const pickerStyles = css`
  .color-picker-body {
    display: flex;
    flex-direction: column;
    gap: var(--ps-space-2);
    min-width: 200px;
    max-width: 280px;
    padding: var(--ps-space-3);
    box-sizing: border-box;
  }

  .color-picker-header {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text);
  }

  .color-picker-field {
    display: flex;
    align-items: center;
    gap: var(--ps-space-3);
  }

  .color-picker-caption {
    flex: none;
    width: 44px;
    font-size: var(--ps-text-sm);
    color: var(--ps-text-muted);
  }

  .color-picker-swatch {
    width: 40px;
    height: var(--ps-control-sm);
    padding: var(--ps-space-0-5);
    border: 1px solid var(--ps-border-control);
    border-radius: var(--ps-radius-sm);
    background: var(--ps-surface);
    cursor: pointer;
  }

  .shape-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ps-space-1);
  }

  .shape-picker-item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ps-control-sm);
    height: var(--ps-control-sm);
    padding: 0;
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: var(--ps-text-muted);
    cursor: pointer;
    transition:
      background-color var(--ps-duration-fast) var(--ps-ease),
      border-color var(--ps-duration-fast) var(--ps-ease),
      color var(--ps-duration-fast) var(--ps-ease);
  }

  .shape-picker-item:hover:not(:disabled) {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  .shape-picker-item[aria-checked='true'] {
    border-color: var(--ps-accent);
    background: var(--ps-accent-tint);
    color: var(--ps-accent-text);
  }

  .shape-picker-item:disabled {
    color: var(--ps-text-faint);
    cursor: not-allowed;
  }

  .color-picker-swatch:focus-visible,
  .shape-picker-item:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
    box-shadow: none;
  }

  @media (forced-colors: active) {
    .color-picker-swatch:focus-visible,
    .shape-picker-item:focus-visible {
      outline-color: Highlight;
    }
  }

  .symbol-picker-note {
    margin: 0;
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
  }
`;
