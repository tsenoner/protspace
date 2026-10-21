import { css } from 'lit';
import { focusRing, kitHost } from '../kit/kit-shared.styles';

/**
 * The reliability handle's thumb, shared by the two vendor pseudo-elements: an engine drops a whole
 * rule on a selector it does not know, so they cannot be grouped into one selector.
 */
const handleThumb = css`
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid var(--ps-surface);
  border-radius: 50%;
  background: var(--ps-accent);
  box-shadow: 0 0 0 1px var(--ps-border-control);
  cursor: grab;
  pointer-events: auto;
`;

/**
 * The EAT panel (proposal B §4.2–4.7): Show switch, overview, reliability histogram, per-label
 * breakdown, other annotations.
 */
export const eatPanelStyles = [
  kitHost,
  focusRing,
  css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      box-sizing: border-box;
      /* No padding here: the page's reset (* { padding: 0 }) beats :host; the shell pads it. */
      font-size: var(--ps-text-sm);
    }

    .eat-empty,
    .eat-empty-view {
      margin: 0;
      color: var(--ps-text-muted);
    }

    .eat-empty-view {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 72px;
      font-size: var(--ps-text-xs);
      text-align: center;
    }

    /* Show off: everything below the switch reads as disabled. */
    [aria-disabled='true'] {
      opacity: 0.4;
    }

    .eat-overview {
      display: grid;
      gap: var(--ps-space-1);
    }

    .eat-stack {
      display: flex;
      height: 8px;
      overflow: hidden;
      border-radius: var(--ps-radius-full);
      background: var(--ps-surface-muted);
    }

    .eat-segment {
      min-width: 0;
    }

    .eat-segment[data-part='curated'] {
      background: var(--ps-text);
    }

    .eat-segment[data-part='kept'] {
      background: var(--ps-accent);
    }

    /* The same hue at 30 %, cross-hatched. */
    .eat-segment[data-part='below'] {
      background:
        repeating-linear-gradient(135deg, transparent 0 2px, var(--ps-surface) 2px 3px),
        var(--ps-accent);
      opacity: 0.3;
    }

    .eat-segment[data-part='none'] {
      background: var(--ps-border);
    }

    .eat-counts,
    .eat-in-view,
    .eat-readout {
      margin: 0;
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
    }

    .eat-in-view,
    .eat-readout {
      color: var(--ps-text-muted);
    }

    .eat-reliability {
      display: grid;
      gap: var(--ps-space-1-5);
    }

    .eat-heading {
      margin: 0;
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      color: var(--ps-text-muted);
      text-transform: uppercase;
    }

    .eat-mode-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .eat-bounds {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1);
      font-size: var(--ps-text-xs);
      color: var(--ps-text-muted);
    }

    .eat-threshold-percent {
      box-sizing: border-box;
      width: 2.8rem;
      height: var(--ps-control-sm);
      padding: var(--ps-space-0-5) var(--ps-space-1);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .eat-threshold-percent:disabled {
      background: var(--ps-surface-muted);
      color: var(--ps-text-faint);
    }

    .eat-histogram {
      display: flex;
      align-items: flex-end;
      gap: 1px;
      height: 72px;
    }

    .eat-bar {
      flex: 1 1 0;
      min-width: 0;
      min-height: 1px;
      padding: 0;
      border: none;
      border-radius: var(--ps-radius-sm) var(--ps-radius-sm) 0 0;
      background: var(--ps-text-muted);
      opacity: 0.3;
      cursor: pointer;
    }

    .eat-bar[data-kept='true'] {
      background: var(--ps-accent);
      opacity: 1;
    }

    .eat-bar.is-skeleton {
      height: 40%;
      background: var(--ps-border);
      opacity: 1;
      cursor: default;
    }

    /*
     * The handles sit on the axis under the bars: native range inputs stacked on one track,
     * transparent and inert, so only their thumbs take the pointer and two bounds drag apart.
     */
    .eat-handles {
      position: relative;
      height: 1.05rem;
    }

    .eat-handles::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 0;
      left: 0;
      height: 2px;
      transform: translateY(-50%);
      background: var(--ps-border-strong);
    }

    .eat-handles input[type='range'] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      background: transparent;
      -webkit-appearance: none;
      appearance: none;
      pointer-events: none;
    }

    .eat-handles input[type='range']::-webkit-slider-runnable-track {
      background: transparent;
      border: none;
    }

    .eat-handles input[type='range']::-moz-range-track {
      background: transparent;
      border: none;
    }

    .eat-handles input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      ${handleThumb}
    }

    .eat-handles input[type='range']::-moz-range-thumb {
      ${handleThumb}
    }

    .eat-handles input[type='range']:disabled::-webkit-slider-thumb {
      cursor: default;
    }

    .eat-handles input[type='range']:disabled::-moz-range-thumb {
      cursor: default;
    }

    /* A finger needs a 40 px target; the thumb stays the same size. */
    @media (pointer: coarse) {
      .eat-handles {
        height: 40px;
      }
    }

    .eat-axis {
      display: flex;
      justify-content: space-between;
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text-faint);
    }

    .eat-breakdown {
      display: grid;
      gap: var(--ps-space-1);
    }

    .eat-breakdown-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .eat-label-list,
    .eat-color-by-list {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* swatch · name · bar · total · share */
    .eat-label-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) 30% auto 2.6rem;
      align-items: center;
      gap: var(--ps-space-1-5);
      width: 100%;
      padding: var(--ps-space-1) var(--ps-space-1);
      border: none;
      border-radius: var(--ps-radius-sm);
      background: none;
      color: var(--ps-text);
      font: inherit;
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
      text-align: left;
      cursor: pointer;
    }

    .eat-label-row:hover,
    .eat-color-by:hover,
    .eat-show-all:hover {
      background: var(--ps-surface-hover);
    }

    .eat-swatch {
      width: 10px;
      height: 10px;
      box-sizing: border-box;
      border: 1px solid var(--ps-swatch-stroke);
      border-radius: 50%;
    }

    .eat-label-name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .eat-label-track {
      display: flex;
      height: 6px;
    }

    .eat-label-bar {
      display: flex;
      height: 100%;
      overflow: hidden;
      border-radius: var(--ps-radius-full);
    }

    .eat-label-total,
    .eat-label-share {
      text-align: right;
    }

    .eat-label-share {
      color: var(--ps-text-muted);
    }

    /* Mostly borrowed: more than 80 % of the label's members are predictions. */
    .eat-label-share.is-mostly-predicted {
      color: var(--ps-warning);
      font-weight: var(--ps-weight-semibold);
    }

    .eat-show-all,
    .eat-color-by,
    .eat-others summary {
      padding: var(--ps-space-1);
      border: none;
      border-radius: var(--ps-radius-sm);
      background: none;
      font: inherit;
      font-size: var(--ps-text-xs);
      text-align: left;
      cursor: pointer;
    }

    .eat-show-all {
      justify-self: start;
      color: var(--ps-accent-text);
    }

    .eat-others summary {
      color: var(--ps-text-muted);
      font-weight: var(--ps-weight-semibold);
    }

    .eat-color-by {
      display: flex;
      align-items: baseline;
      gap: var(--ps-space-1-5);
      width: 100%;
      color: var(--ps-text);
    }

    .eat-color-by-name {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .eat-color-by-share {
      color: var(--ps-text-muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .eat-chevron {
      margin-left: auto;
      color: var(--ps-text-muted);
    }
  `,
];
