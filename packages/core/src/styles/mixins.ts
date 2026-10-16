import { css } from 'lit';

/**
 * Segmented control: a joined row of mutually exclusive toggle buttons.
 *   <div class="segmented" role="group" aria-label="…">
 *     <button type="button" class="segmented-btn" aria-pressed="true">…</button>
 *   </div>
 * The selected segment is driven by aria-pressed alone, so what is drawn always matches what
 * assistive technology announces. Colours read the --ps-* tokens.
 */
export const segmentedControlMixin = css`
  .segmented {
    display: inline-flex;
    align-items: stretch;
    flex: none;
    /* No overflow: hidden — it would clip the focus ring; corners are rounded per child */
    border: var(--border-width) solid var(--ps-border-strong);
    border-radius: var(--radius);
    background: var(--ps-surface);
  }

  .segmented > .segmented-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    margin: 0;
    padding: var(--spacing-xs) var(--segmented-padding-x, var(--spacing-sm));
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ps-text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    line-height: 1.25;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .segmented > .segmented-btn + .segmented-btn {
    border-left: var(--border-width) solid var(--ps-border-strong);
  }

  .segmented > .segmented-btn:first-child {
    border-top-left-radius: calc(var(--radius) - var(--border-width));
    border-bottom-left-radius: calc(var(--radius) - var(--border-width));
  }

  .segmented > .segmented-btn:last-child {
    border-top-right-radius: calc(var(--radius) - var(--border-width));
    border-bottom-right-radius: calc(var(--radius) - var(--border-width));
  }

  .segmented > .segmented-btn:hover:not(:disabled):not([aria-pressed='true']) {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  /* The accent pair keeps the selected label at 4.5:1 (design decision 6) */
  .segmented > .segmented-btn[aria-pressed='true'] {
    background: var(--ps-accent);
    color: var(--ps-text-on-accent);
  }

  .segmented > .segmented-btn[aria-pressed='true']:hover:not(:disabled) {
    background: var(--ps-accent-hover);
  }

  /* The library-wide focus ring, lifted above neighbours; its offset leaves a gap that keeps it
     visible on the accent-filled selected segment, whose fill is the ring's colour in dark */
  .segmented > .segmented-btn:focus-visible {
    z-index: 1;
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }

  /* Keep pointer events on a disabled segment so an explanatory title still shows */
  .segmented > .segmented-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: auto;
  }

  .segmented--icon {
    --segmented-padding-x: 0.375rem;
  }

  .segmented > .segmented-btn > .icon {
    display: block;
    flex: none;
    width: 1rem;
    height: 1rem;
  }

  @media (forced-colors: active) {
    .segmented > .segmented-btn:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }

    .segmented > .segmented-btn[aria-pressed='true'] {
      forced-color-adjust: none;
      background: SelectedItem;
      color: SelectedItemText;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .segmented > .segmented-btn {
      transition: none;
    }
  }
`;
