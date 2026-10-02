import { css } from 'lit';
import { srOnlyMixin } from '../../../styles/mixins';

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
  border: 2px solid var(--legend-bg, #fff);
  border-radius: 50%;
  background: var(--legend-accent-color, var(--primary, #2563eb));
  box-shadow: 0 0 0 1px rgb(0 0 0 / 20%);
  cursor: grab;
  pointer-events: auto;
`;

/**
 * Legend Layout Styles
 *
 * Structural styles for the Legend component including:
 * - Host container layout
 * - Legend container
 * - Header and title
 * - Items list container
 */
export const layoutStyles = css`
  :host {
    display: flex;
    user-select: none;
    flex-direction: column;
    width: 100%;

    border: 1px solid var(--legend-border);
    background: var(--legend-bg);
    border-radius: var(--legend-border-radius);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
    padding: 5px 2px 9px 2px;
    flex-shrink: 1;
    flex-grow: 1;
    height: calc(50% - 1rem);
  }

  .legend-container {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding-bottom: 8px;
    flex-shrink: 1;
    position: relative;
  }

  ${srOnlyMixin}

  .legend-header {
    display: flex;
    justify-content: space-between;
    flex-direction: row;
    width: 100%;
    align-items: center;
    padding: 3px 6px 0px 1.2rem;
    margin-bottom: 0.25rem;
    box-sizing: border-box;
  }

  .legend-header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .legend-title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .legend-title {
    font-weight: 500;
    font-size: 1rem;
    color: var(--legend-text-color);
    margin: 0;
  }

  .legend-predicted-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    color: var(--legend-text-color);
    background: color-mix(in srgb, var(--legend-text-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--legend-text-color) 25%, transparent);
    white-space: nowrap;
  }

  .legend-predicted-note {
    margin: 0 0 0.35rem;
    padding: 0 6px 0 1.2rem;
    font-size: 0.72rem;
    color: var(--legend-text-secondary);
    box-sizing: border-box;
  }

  .eat-legend {
    width: calc(100% - 1rem);
    box-sizing: border-box;
    margin: 0.125rem 0 0.375rem;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--legend-border);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--legend-text-color) 3%, transparent);
  }

  .eat-legend-title {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--legend-text-secondary);
  }

  .eat-legend-header,
  .eat-threshold-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .eat-switch,
  .eat-threshold-value {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .eat-switch {
    color: var(--legend-text-color);
    font-size: 0.7rem;
    cursor: pointer;
  }

  .eat-switch input,
  .eat-threshold input {
    accent-color: var(--legend-accent-color, var(--primary, #2563eb));
  }

  .eat-threshold {
    margin: 0.4rem 0 0.45rem;
    padding-bottom: 0.45rem;
    border-bottom: 1px solid var(--legend-border);
  }

  .eat-threshold-heading {
    margin-bottom: 0.2rem;
    font-size: 0.68rem;
    color: var(--legend-text-secondary);
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
    margin: 0.15rem 0 0;
  }

  .eat-threshold-track {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
    height: 0.3rem;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--legend-track-color, #3f4652);
  }

  /* The kept band. Positioned from both ends, so it reads as "what survives the filter". */
  .eat-threshold-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    background: var(--legend-accent-color, var(--primary, #2563eb));
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
    outline: 2px solid var(--legend-accent-color, var(--primary, #2563eb));
    outline-offset: 2px;
    border-radius: 999px;
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
    color: var(--legend-text-secondary);
  }

  .eat-threshold-percent {
    box-sizing: border-box;
    width: 2.8rem;
    padding: 0.1rem 0.2rem;
    border: 1px solid var(--legend-border);
    border-radius: 0.25rem;
    background: var(--legend-bg);
    color: var(--legend-text-color);
    font: inherit;
    text-align: right;
  }

  .eat-threshold-info {
    flex: 0 0 auto;
  }

  /*
   * The mode select replaces what used to be a static "Hide below reliability"
   * label, so it must not grow the row: the EAT legend is asserted to stay inside
   * its group with no horizontal overflow down to a 320px viewport.
   */
  .eat-threshold-mode {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    padding: 0.1rem 0.2rem;
    border: 1px solid var(--legend-border);
    border-radius: 0.25rem;
    background: var(--legend-bg);
    color: var(--legend-text-color);
    font: inherit;
    cursor: pointer;
  }

  .eat-threshold-mode:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .eat-legend-counts {
    display: grid;
    gap: 0.1rem;
  }

  .eat-legend-row {
    display: grid;
    grid-template-columns: 0.8rem 1fr auto;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--legend-text-color);
  }

  .eat-swatch {
    width: 0.55rem;
    height: 0.55rem;
    border: 2px solid currentColor;
    border-radius: 50%;
    box-sizing: border-box;
  }

  .eat-swatch.observed {
    background: currentColor;
  }

  .eat-swatch.predicted {
    background: transparent;
  }

  .legend-items {
    display: flex;
    flex-direction: column;
    gap: var(--legend-item-gap);
    width: 100%;
    max-height: calc(100vh - 10rem);
    overflow-y: scroll;
    scrollbar-width: thin;
    padding: 5px 6px 4px 9px;
    box-sizing: border-box;
    flex-grow: 1;
    flex-shrink: 1;
  }

  .legend-empty {
    text-align: center;
    color: var(--legend-text-secondary);
    font-style: italic;
    padding: 1rem 0;
  }

  .score-strips {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--legend-border);
  }

  .score-strips-note {
    margin: 0;
    padding: 0.5rem 0.75rem;
    /* 0.72rem, the size every other secondary line in this stylesheet uses, and the same as
       .score-strips-caveat below — the two say the same kind of thing about the strips. */
    font-size: 0.72rem;
    color: var(--legend-text-secondary);
    border-bottom: 1px solid var(--legend-border);
  }

  /* Sits inside .score-strips, which already owns the padding and bottom border. */
  .score-strips-caveat {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.3;
    color: var(--legend-text-secondary);
  }
`;
