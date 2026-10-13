import { css } from 'lit';

/**
 * Segmented control: a joined row of mutually exclusive toggle buttons.
 *   <div class="segmented" role="group" aria-label="…">
 *     <button type="button" class="segmented-btn" aria-pressed="true">…</button>
 *   </div>
 * The selected segment is driven by aria-pressed alone, so what is drawn always matches what
 * assistive technology announces. Colors go through --segmented-* hooks that fall back to tokens.
 */
export const segmentedControlMixin = css`
  .segmented {
    display: inline-flex;
    align-items: stretch;
    flex: none;
    /* No overflow: hidden — it would clip the focus ring; corners are rounded per child */
    border: var(--border-width) solid var(--segmented-border, var(--border));
    border-radius: var(--radius);
    background: var(--segmented-bg, var(--surface));
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
    color: var(--segmented-text, var(--text-secondary));
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
    border-left: var(--border-width) solid var(--segmented-border, var(--border));
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
    background: var(--segmented-hover-bg, var(--hover-bg-alt));
    color: var(--segmented-hover-text, var(--text-primary));
  }

  /* The accent pair keeps the selected label at 4.5:1 (design decision 6) */
  .segmented > .segmented-btn[aria-pressed='true'] {
    background: var(--ps-accent);
    color: var(--ps-text-on-accent);
  }

  .segmented > .segmented-btn[aria-pressed='true']:hover:not(:disabled) {
    background: var(--ps-accent-hover);
  }

  /* The library-wide focus ring, lifted above neighbours; the inner ring keeps it visible on the
     primary-filled selected segment */
  .segmented > .segmented-btn:focus-visible {
    z-index: 1;
    outline: none;
    box-shadow:
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
  }

  .segmented > .segmented-btn[aria-pressed='true']:focus-visible {
    box-shadow:
      inset 0 0 0 1px var(--text-light),
      0 0 0 1px var(--primary),
      0 0 0 3px var(--focus-ring-bg);
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
