import { css } from 'lit';

export const infoPopoverStyles = css`
  :host {
    display: inline-flex;
    position: relative;
  }

  .info-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--legend-text-secondary, #6b7280);
    cursor: pointer;
    line-height: 1;
  }

  .info-button:hover,
  .info-button.open {
    color: var(--legend-text-color, #111827);
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .info-button:focus-visible {
    /* The repo's accent is --protspace-highlight-color (6 uses, bound to --primary in
       scatter-plot.styles.ts). --accent-color was a second, undefined token whose #3b82f6
       fallback rendered a different blue from the one every other focus/accent uses. */
    outline: 2px solid var(--protspace-highlight-color, #00a3e0);
    outline-offset: 1px;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 1000;
    width: max-content;
    box-sizing: border-box;
    max-width: min(260px, calc(100vw - 24px));
    padding: 0.55rem 0.65rem;
    border-radius: 8px;
    background: var(--surface-color, #ffffff);
    color: var(--text-color, #111827);
    border: 1px solid var(--border-color, #e5e7eb);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    font-size: 0.78rem;
    /* Pinned like the other typography here: font-weight inherits across the shadow boundary, so
       a bold ancestor (e.g. a selected dropdown row) would otherwise render this popover bold. */
    font-weight: normal;
    line-height: 1.35;
    text-align: left;
    white-space: normal;
  }

  /* Open leftward (align right edge to the icon) when there isn't room on the right,
     e.g. the info icon sits near the right edge of the annotation dropdown. */
  .popover.flip-left {
    left: auto;
    right: 0;
  }

  /* Side placement: positioned via fixed viewport coordinates (set inline) so it escapes the
     dropdown's overflow clipping and sits beside the row instead of over the list. */
  .popover.placement-side {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2000;
  }

  /* Hidden until measured, to avoid a one-frame flash at the default (0,0) position. */
  .popover.placement-side.measuring {
    visibility: hidden;
  }

  /* Caret: a rotated square sharing the popover's surface + border, half-poking out the edge. */
  .popover-arrow {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--surface-color, #ffffff);
    border: 1px solid var(--border-color, #e5e7eb);
    transform: rotate(45deg);
  }

  /* Left placement → caret on the right edge pointing toward the icon. */
  .popover.placement-side .popover-arrow {
    right: -6px;
    border-left: none;
    border-bottom: none;
  }

  /* Flipped to the right → caret on the left edge. */
  .popover.placement-side.flipped .popover-arrow {
    right: auto;
    left: -6px;
    border-left: 1px solid var(--border-color, #e5e7eb);
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    border-right: none;
    border-top: none;
  }

  .popover-description {
    margin: 0;
  }

  .popover-link {
    display: inline-block;
    margin-top: 0.45rem;
    /* Same correction as the focus ring above, which this component's own comment already
       records: --accent-color is defined nowhere, so its #3b82f6 fallback was always what
       rendered — a blue no other accent in the repo uses. Left behind when the ring was
       fixed, and now visible in four hosts rather than one. */
    color: var(--protspace-highlight-color, #00a3e0);
    text-decoration: none;
    font-weight: 500;
  }

  .popover-link:hover {
    text-decoration: underline;
  }
`;
