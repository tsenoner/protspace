import { css } from 'lit';
import { focusRing, kitHost, srOnly } from '../kit/kit-shared.styles';

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
 * The EAT panel (proposal B §4.2–4.7): Show switch, overview, reliability histogram, drawing
 * switches, per-label breakdown, other annotations.
 */
export const eatPanelStyles = [
  kitHost,
  focusRing,
  srOnly,
  css`
    /* A column the shell sizes: the sections scroll, the selected protein's strip sits under them. */
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      box-sizing: border-box;
      font-size: var(--ps-text-sm);
    }

    .eat-scroll {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: var(--ps-space-3);
      min-height: 0;
      overflow: auto;
      padding: var(--ps-space-2) var(--ps-space-3) var(--ps-space-3);
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

    /*
     * Show off: the bars and marks are greyed, as the map draws the predictions N/A. The text
     * stays at full contrast, since the rows, the lists and Sort still work; the range controls
     * grey as disabled controls do.
     */
    .is-off :is(.eat-stack, .eat-key-mark, .eat-histogram, .eat-handles, .eat-label-bar) {
      opacity: 0.4;
    }

    /* A reliability filter another annotation still applies, with its Clear. */
    .eat-other-filter {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
      margin: 0;
      padding: var(--ps-space-1) var(--ps-space-1) var(--ps-space-1) var(--ps-space-2);
      border-radius: var(--ps-radius-sm);
      border: 1px solid var(--ps-border);
      font-size: var(--ps-text-xs);
    }

    .eat-other-filter-clear {
      flex: none;
    }

    .eat-nowrap {
      white-space: nowrap;
    }

    .eat-off-note {
      margin-top: calc(-1 * var(--ps-space-1));
    }

    .eat-overview {
      display: grid;
      gap: var(--ps-space-1-5);
    }

    /*
     * The map's language (U21): curated is solid, a prediction in range hollow (a 2 px outline),
     * one outside the range dashed, no value the empty track. The ink is the text colour here and
     * the label's own colour in a label row. Outlines mix the ink a step toward the text colour
     * (U22), so pale inks in light mode and dark inks in dark mode keep 3:1 against the panel.
     */
    .eat-stack,
    .eat-label-bar,
    .eat-counts {
      --eat-ink: var(--ps-text);
      --eat-line: color-mix(in oklab, var(--eat-ink), var(--ps-text) 35%);
    }

    .eat-stack,
    .eat-label-bar {
      display: flex;
      gap: 2px;
      height: 10px;
    }

    /* A part that holds any protein stays at least 8 px, so a few never shrink to a blob. */
    .eat-segment {
      box-sizing: border-box;
      min-width: 8px;
      border-radius: 3px;
    }

    .eat-segment[data-part='curated'] {
      background: var(--eat-ink);
    }

    .eat-segment[data-part='kept'] {
      border: 2px solid var(--eat-line);
    }

    .eat-segment[data-part='outside'] {
      border: 2px dashed var(--eat-line);
    }

    .eat-segment[data-part='none'] {
      background: var(--ps-surface-hover);
    }

    .eat-counts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ps-space-1) var(--ps-space-3);
    }

    .eat-key-item {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1);
      white-space: nowrap;
    }

    .eat-key-mark {
      box-sizing: border-box;
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }

    .eat-key-mark[data-part='curated'] {
      background: var(--eat-ink);
    }

    .eat-key-mark[data-part='kept'] {
      border: 2px solid var(--eat-line);
    }

    /* An SVG ring of six dashes: a 9 px CSS dashed border draws two arcs that read as a spinner. */
    svg.eat-key-mark {
      flex: none;
      color: var(--eat-line);
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

    .eat-reliability,
    .eat-drawing {
      display: grid;
      gap: var(--ps-space-1-5);
    }

    .eat-help {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .eat-lines-row,
    .eat-outcome-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    /* A section's question (U21), under the shell's h2. */
    .eat-heading {
      margin: 0;
      color: var(--ps-text);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-semibold);
    }

    .eat-range-row {
      display: flex;
      justify-content: flex-end;
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
      width: 3.4rem;
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

    .eat-bar[data-empty] {
      cursor: default;
    }

    /* The bar whose list is open. */
    .eat-bar[aria-expanded='true'] {
      box-shadow: 0 0 0 1px var(--ps-text);
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

    /* A finger needs a 40 px target (44 px rows), on a tablet as on a phone; the thumb
       stays the same size. */
    @media (pointer: coarse) {
      .eat-handles {
        height: 40px;
      }

      :is(.eat-label-row, .eat-drill-row) {
        min-height: 44px;
        align-content: center;
      }

      :is(
        .eat-drill-select,
        .eat-export,
        .eat-other-filter-clear,
        .eat-show-all,
        .eat-color-by,
        .eat-others summary,
        .eat-display > summary,
        .eat-card-link
      ) {
        min-height: 40px;
      }

      /* A short bar still takes a 32 px tall tap column (20 bars share the width). */
      .eat-bar:not(.is-skeleton) {
        position: relative;
      }

      .eat-bar:not(.is-skeleton)::after {
        content: '';
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        height: max(100%, 32px);
      }
    }

    .eat-axis {
      display: flex;
      justify-content: space-between;
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text-muted);
    }

    .eat-breakdown {
      display: grid;
      gap: var(--ps-space-1);
    }

    /* Under the heading's helper line, so the question and its helper stay together. */
    .eat-sort-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--ps-space-1-5);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
    }

    .eat-label-list,
    .eat-color-by-list {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* Two lines: swatch · name · tag · total, then the label's bar and its facts in words. */
    .eat-label-row {
      display: grid;
      gap: var(--ps-space-0-5);
      width: 100%;
      padding: var(--ps-space-1);
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

    .eat-label-list > li + li {
      border-top: 1px solid var(--ps-border);
    }

    /* In view, but every member there is curated: no list to open. */
    .eat-label-row:disabled {
      cursor: default;
    }

    .eat-label-row:hover:not(:disabled),
    .eat-color-by:hover,
    .eat-show-all:hover {
      background: var(--ps-surface-hover);
    }

    .eat-label-line {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      min-width: 0;
    }

    .eat-swatch {
      flex: none;
      width: 10px;
      height: 10px;
      box-sizing: border-box;
      border: 1px solid var(--ps-swatch-stroke);
      border-radius: 50%;
    }

    /* The full name: it wraps, never cut off. */
    /* The row's tabular figures would widen the hyphens in names such as α-neurotoxin. */
    .eat-label-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
      font-variant-numeric: normal;
    }

    .eat-label-tag {
      flex: none;
      padding: 0 var(--ps-space-1);
      border-radius: var(--ps-radius-sm);
      background: color-mix(in srgb, var(--ps-warning) 14%, transparent);
      color: var(--ps-warning);
      font-size: 0.6875rem;
      font-weight: var(--ps-weight-semibold);
      white-space: nowrap;
    }

    .eat-label-total {
      flex: none;
      color: var(--ps-text-muted);
    }

    /* Under the name: the bar (the swatch's width plus the gap in) and the facts. */
    .eat-label-facts {
      align-items: flex-start;
      padding-left: calc(10px + var(--ps-space-1-5));
    }

    /* On the facts' first line when they wrap. */
    .eat-label-bar {
      flex: none;
      width: 70px;
      height: 8px;
      margin-top: 0.25em;
    }

    .eat-label-share {
      min-width: 0;
      color: var(--ps-text-muted);
    }

    /* Each fact stays whole: line two wraps only between the middle dots. */
    .eat-label-fact {
      white-space: nowrap;
    }

    .eat-show-all,
    .eat-color-by,
    .eat-others summary,
    .eat-display > summary {
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

    .eat-others summary,
    .eat-display > summary {
      color: var(--ps-text-muted);
      font-weight: var(--ps-weight-semibold);
    }

    .eat-display-title {
      color: var(--ps-text);
    }

    /* What the drawing is set to, under the closed disclosure's name. */
    .eat-display-state {
      display: block;
      padding-left: 1em;
      font-weight: normal;
    }

    .eat-display-body {
      display: grid;
      gap: var(--ps-space-3);
      padding-top: var(--ps-space-1-5);
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

    /* A drill-down list (a bar's or a label's): heading, up to 5 rows, footer. */
    .eat-drill {
      display: grid;
      gap: var(--ps-space-1);
      margin-top: var(--ps-space-1);
      padding: var(--ps-space-1-5);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-sm);
      background: var(--ps-surface-muted);
    }

    .eat-drill-heading {
      margin: 0;
      color: var(--ps-text);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
    }

    .eat-drill-list {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* ring · id · reliability · label, then "Hidden, outside the range" on its own line */
    .eat-drill-row {
      display: grid;
      grid-template-columns: 10px minmax(auto, 5.5rem) 2.6rem minmax(0, 1fr);
      align-items: center;
      column-gap: var(--ps-space-1-5);
      width: 100%;
      padding: var(--ps-space-1);
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

    .eat-drill-row:hover,
    .eat-drill-select:hover:not(:disabled),
    .eat-export:hover,
    .eat-other-filter-clear:hover {
      background: var(--ps-surface-hover);
    }

    .eat-ring {
      width: 10px;
      height: 10px;
      box-sizing: border-box;
      border: 2px solid var(--ps-text-muted);
      border-radius: 50%;
    }

    .eat-drill-reliability {
      text-align: right;
    }

    .eat-drill-label {
      min-width: 0;
      overflow: hidden;
      font-variant-numeric: normal;
      color: var(--ps-text-muted);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .eat-drill-hidden {
      grid-column: 2 / -1;
      color: var(--ps-text-muted);
    }

    .eat-drill-foot,
    .eat-readout-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
    }

    .eat-drill-select,
    .eat-export,
    .eat-other-filter-clear {
      padding: var(--ps-space-1);
      border: none;
      border-radius: var(--ps-radius-sm);
      background: none;
      color: var(--ps-accent-text);
      font: inherit;
      font-size: var(--ps-text-xs);
      cursor: pointer;
    }

    .eat-drill-select:disabled {
      color: var(--ps-text-faint);
      cursor: default;
    }

    .eat-drill-count {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-variant-numeric: tabular-nums;
    }

    /*
     * The selected protein (U21, U22): a footer under the scroll area, so nothing scrolls under it
     * or shows through its edge.
     */
    .eat-card {
      flex: none;
      display: grid;
      gap: var(--ps-space-0-5);
      padding: var(--ps-space-1-5) var(--ps-space-3);
      border-top: 2px solid var(--ps-accent);
      background: var(--ps-surface-muted);
      font-size: var(--ps-text-xs);
    }

    .eat-card-eyebrow {
      margin: 0;
      color: var(--ps-accent-text);
      font-size: 0.625rem;
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .eat-card-title {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      min-width: 0;
      margin: 0;
      color: var(--ps-text);
    }

    .eat-card-title > :is(.eat-ring, .eat-swatch) {
      flex: none;
    }

    .eat-card-id,
    .eat-card-reliability {
      flex: none;
      font-weight: var(--ps-weight-semibold);
      font-variant-numeric: tabular-nums;
    }

    .eat-card-labels {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--ps-text-muted);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* The eyebrow (compact: the one line) with Go to source at its end. */
    .eat-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ps-space-2);
      min-width: 0;
    }

    .eat-card-row > .eat-card-title {
      flex: 1 1 auto;
    }

    /* Each fact stays whole. A line whose facts do not fit side by side is marked wrapped: one
       fact a line, no dot, and the source named. */
    .eat-card-fact {
      white-space: nowrap;
    }

    .eat-card-subject,
    .eat-card-facts.is-wrapped .eat-card-sep {
      display: none;
    }

    .eat-card-facts.is-wrapped .eat-card-subject {
      display: inline;
    }

    .eat-card-facts.is-wrapped .eat-card-fact {
      display: block;
    }

    .eat-card-line,
    .eat-card-rank,
    .eat-card-outside {
      margin: 0;
      color: var(--ps-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .eat-card-source {
      color: var(--ps-text);
    }

    .eat-card-actions {
      display: flex;
      flex: none;
    }

    .eat-card-link {
      padding: 0;
      border: none;
      background: none;
      color: var(--ps-accent-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .eat-card-link:hover {
      text-decoration: underline;
    }

    /* Phone (proposal B §6): a shorter histogram. Target sizes follow the pointer, above. */
    :host([compact]) .eat-histogram {
      height: 56px;
    }

    /* The phone's strip is one row: its facts give way, with an ellipsis, to Go to source. */
    :host([compact]) .eat-card-title > .eat-card-line {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  `,
];
