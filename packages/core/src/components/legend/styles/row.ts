import { css } from 'lit';

/**
 * Legend rows (design decision 12): 28 px (40 px under a coarse pointer), the swatch and the name in
 * the main button, the count in tabular figures, and the eye, handle and "⋯" revealed before the
 * count on hover or focus. Hover and focus are CSS only, so the pointer never re-renders the legend. Sortable's states
 * and the drop highlight live here too. Every colour and type size reads a --ps-* token.
 */
export const rowStyles = css`
  /* Rows sit edge to edge and draw their own inset; layout.ts owns the rest of the list box. */
  .legend-items {
    gap: 0;
    padding-inline: 0;
  }

  .legend-item {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--ps-space-2);
    width: 100%;
    height: var(--ps-row);
    padding: 0 var(--ps-space-3);
    box-sizing: border-box;
    color: var(--ps-text);
    background: transparent;
    transition: background-color var(--ps-duration-fast) var(--ps-ease);
  }

  .legend-item:hover,
  .legend-item:focus-within {
    background: var(--ps-surface-hover);
  }

  /* Picked up for a keyboard reorder. */
  .legend-item.picked {
    background: var(--ps-accent-tint);
  }

  /* The category under the pointer in a score strip. */
  .legend-item-score-hover {
    box-shadow: inset 2px 0 0 var(--ps-text);
  }

  .legend-item-main {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: flex-start;
    gap: var(--ps-space-2);
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: var(--ps-leading-tight);
    text-align: left;
    cursor: pointer;
    transition: none;
  }

  .legend-swatch {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .legend-symbol {
    display: block;
    overflow: visible;
  }

  /* Selected in the plot: the outline takes the accent; the fill stays the category's. */
  .legend-item.selected .legend-symbol path {
    stroke: var(--ps-accent);
    stroke-width: 2px;
  }

  .legend-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }

  /* Hidden rows stay listed and actionable: dimmed, never in the disabled colour. */
  .legend-item.hidden .legend-swatch {
    opacity: 0.35;
  }

  .legend-item.hidden .legend-text,
  .legend-item-other .legend-text,
  .legend-item[data-value='__NA__'] .legend-text {
    color: var(--ps-text-muted);
  }

  .legend-hidden-mark {
    display: inline-flex;
    flex: none;
    color: var(--ps-text-muted);
  }

  .legend-count {
    flex: none;
    font-size: var(--ps-text-sm);
    color: var(--ps-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .view-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 24px;
    padding: 0 var(--ps-space-1);
    border: 0;
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: var(--ps-accent-text);
    font-size: var(--ps-text-sm);
    font-weight: var(--ps-weight-medium);
    cursor: pointer;
  }

  .view-button:hover {
    text-decoration: underline;
  }

  /*
   * Between the name and the count. At rest they take no room (the negative margin takes back the
   * row's gap) yet stay focusable; shown, the name gives way and ends in an ellipsis while the
   * count stays in view.
   */
  .legend-item-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--ps-space-0-5);
    max-width: 0;
    margin-inline-start: calc(-1 * var(--ps-space-2));
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--ps-duration-fast) var(--ps-ease);
  }

  /* The buttons' own padding spaces the icons, so the strip sits half a gap from its neighbours. */
  .legend-item:hover .legend-item-actions,
  .legend-item:focus-within .legend-item-actions,
  .legend-item.picked .legend-item-actions {
    max-width: none;
    margin-inline: calc(-1 * var(--ps-space-1));
    opacity: 1;
    pointer-events: auto;
  }

  /* A shown strip has its own eye: the hidden mark would be a second one. */
  .legend-item:hover .legend-hidden-mark,
  .legend-item:focus-within .legend-hidden-mark,
  .legend-item.picked .legend-hidden-mark {
    display: none;
  }

  /* Other has no handle to show: its strip is just the eye, after View and before the count. */
  .legend-item-other .drag-handle-disabled {
    display: none;
  }

  .legend-item-other .legend-count {
    min-width: var(--ps-space-3);
    text-align: end;
  }

  .legend-action,
  .drag-handle {
    display: inline-flex;
    flex: none;
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
    transition:
      background-color var(--ps-duration-fast) var(--ps-ease),
      color var(--ps-duration-fast) var(--ps-ease);
  }

  .legend-action:hover,
  .drag-handle:hover {
    background: color-mix(in srgb, var(--ps-text) 8%, transparent);
    color: var(--ps-text);
  }

  .drag-handle {
    cursor: grab;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .drag-handle[aria-pressed='true'] {
    color: var(--ps-accent-text);
  }

  /* Other's handle stays for Sortable's filter and the e2e, out of sight and out of reach. */
  .drag-handle-disabled {
    opacity: 0;
    pointer-events: none;
  }

  /* The kit's focus ring, drawn inside: rows sit edge to edge. */
  .legend-item-main:focus-visible,
  .view-button:focus-visible,
  .legend-action:focus-visible,
  .drag-handle:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: calc(-1 * var(--ps-focus-width));
    box-shadow: none;
  }

  @media (forced-colors: active) {
    .legend-item-main:focus-visible,
    .view-button:focus-visible,
    .legend-action:focus-visible,
    .drag-handle:focus-visible {
      outline-color: Highlight;
    }
  }

  /* Touch: taller rows, and the actions always shown. */
  @media (pointer: coarse) {
    .legend-item {
      height: auto;
      min-height: var(--ps-touch-target);
    }

    .legend-item-actions {
      max-width: none;
      margin-inline: calc(-1 * var(--ps-space-1));
      opacity: 1;
      pointer-events: auto;
    }

    .legend-hidden-mark {
      display: none;
    }
  }

  /* Sortable: the gap where the row will land, the row as picked, and the row under the pointer. */
  .legend-item-ghost {
    opacity: 0.4;
    background: var(--ps-accent-tint);
    outline: 1px dashed var(--ps-accent);
    outline-offset: -1px;
  }

  .legend-item-chosen {
    background: var(--ps-surface-hover);
    cursor: grabbing;
  }

  .legend-item-drag,
  .legend-item-fallback {
    background: var(--ps-surface-raised);
    border-radius: var(--ps-radius);
    box-shadow: var(--ps-shadow-lg);
    opacity: 0.95;
    cursor: grabbing;
  }

  /* "Other" while a row is dragged over it: dropping merges the row into it. */
  .legend-item-merge-target {
    background: var(--ps-accent-tint);
    box-shadow: inset 0 0 0 1px var(--ps-accent);
  }

  .legend-item-just-dropped {
    animation: drop-highlight 600ms var(--ps-ease);
  }

  @keyframes drop-highlight {
    from {
      background: var(--ps-accent-tint);
    }
    to {
      background: transparent;
    }
  }
`;
