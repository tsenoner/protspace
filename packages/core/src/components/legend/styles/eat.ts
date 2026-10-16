import { css } from 'lit';

/**
 * The reliability band's drag handle. Stated once and interpolated into both vendor
 * pseudo-elements: `::-webkit-slider-thumb` and `::-moz-range-thumb` cannot be grouped
 * into one selector (an engine drops the whole rule on a selector it does not know),
 * so the declarations are what has to be shared. Two hand-kept copies meant a thumb
 * resize applied to the webkit one was invisible in Chrome dev and CI and showed up
 * only in Firefox.
 */
const bandThumb = css`
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid var(--ps-surface);
  border-radius: 50%;
  background: var(--ps-accent);
  box-shadow: 0 0 0 1px var(--ps-border-control);
  cursor: grab;
  pointer-events: auto;
`;

/** The legend's EAT block: the overlay switch, the reliability filter and the counts. */
export const eatStyles = css`
  .eat-legend {
    box-sizing: border-box;
    width: calc(100% - 2 * var(--ps-space-2));
    margin: var(--ps-space-0-5) auto var(--ps-space-1-5);
    padding: var(--ps-space-1-5) var(--ps-space-2);
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius);
    background: var(--ps-surface-muted);
  }

  .eat-legend-title {
    font-size: var(--ps-text-xs);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text-muted);
  }

  .eat-legend-header,
  .eat-threshold-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ps-space-2);
  }

  .eat-threshold-value {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-1);
  }

  /* ps-checkbox draws the box; its slotted "Show" takes this size and colour. */
  .eat-switch {
    color: var(--ps-text);
    font-size: var(--ps-text-xs);
  }

  .eat-threshold input {
    accent-color: var(--ps-accent);
  }

  .eat-threshold {
    margin: var(--ps-space-1-5) 0 var(--ps-space-2);
    padding-bottom: var(--ps-space-2);
    border-bottom: 1px solid var(--ps-border);
  }

  .eat-threshold-heading {
    margin-bottom: var(--ps-space-1);
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
  }

  /*
   * The mode select replaces what used to be a static "Hide below reliability" label, so it
   * must not grow the row: the EAT block is asserted to stay inside its group with no
   * horizontal overflow down to a 320px viewport.
   */
  .eat-threshold-mode {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    font-size: var(--ps-text-xs);
  }

  /*
   * Every mode renders ONE track. It carries one thumb per bound the mode filters on,
   * so the control keeps its shape when the mode changes. The range inputs are stacked
   * on top of each other, transparent and inert, so what the user sees is the track and
   * fill drawn below them; only the thumbs take pointer events, which is what lets two
   * bounds be dragged independently on a shared bar.
   */
  .eat-threshold-band {
    position: relative;
    height: 1.05rem;
    margin: var(--ps-space-0-5) 0 0;
  }

  .eat-threshold-track {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
    height: 0.3rem;
    transform: translateY(-50%);
    border-radius: var(--ps-radius-full);
    background: var(--ps-border-strong);
  }

  /* The kept band. Positioned from both ends, so it reads as "what survives the filter". */
  .eat-threshold-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: var(--ps-radius-full);
    background: var(--ps-accent);
  }

  .eat-threshold-band input[type='range'] {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    /* The shared track must not swallow the other thumb's drags. */
    pointer-events: none;
  }

  .eat-threshold-band input[type='range']:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
    border-radius: var(--ps-radius-full);
  }

  .eat-threshold-band input[type='range']::-webkit-slider-runnable-track {
    background: transparent;
    border: none;
  }

  .eat-threshold-band input[type='range']::-moz-range-track {
    background: transparent;
    border: none;
  }

  .eat-threshold-band input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    ${bandThumb}
  }

  .eat-threshold-band input[type='range']::-moz-range-thumb {
    ${bandThumb}
  }

  .eat-threshold-band.is-disabled {
    opacity: 0.6;
  }

  .eat-threshold-band.is-disabled input[type='range']::-webkit-slider-thumb {
    cursor: default;
  }

  .eat-threshold-band.is-disabled input[type='range']::-moz-range-thumb {
    cursor: default;
  }

  /* Separates the two percent boxes: "25 – 41 %". */
  .eat-threshold-sep {
    color: var(--ps-text-muted);
  }

  /* As tall as the small mode select in the same row. */
  .eat-threshold-percent {
    box-sizing: border-box;
    height: var(--ps-control-sm);
    width: 2.8rem;
    padding: var(--ps-space-0-5) var(--ps-space-1);
    border: 1px solid var(--ps-border-strong);
    border-radius: var(--ps-radius-sm);
    background: var(--ps-surface);
    color: var(--ps-text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .eat-threshold-percent:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: 0;
  }

  .eat-threshold-percent:disabled {
    background: var(--ps-surface-muted);
    color: var(--ps-text-faint);
  }

  .eat-threshold-info {
    flex: 0 0 auto;
  }

  .eat-legend-counts {
    display: grid;
    gap: var(--ps-space-0-5);
  }

  .eat-legend-row {
    display: grid;
    grid-template-columns: 0.8rem 1fr auto;
    align-items: center;
    gap: var(--ps-space-1-5);
    font-size: var(--ps-text-xs);
    color: var(--ps-text);
  }

  .eat-legend-row strong {
    font-weight: var(--ps-weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .eat-swatch {
    width: 0.55rem;
    height: 0.55rem;
    border: 2px solid currentColor;
    border-radius: var(--ps-radius-full);
    box-sizing: border-box;
  }

  .eat-swatch.observed {
    background: currentColor;
  }

  .eat-swatch.predicted {
    background: transparent;
  }
`;
