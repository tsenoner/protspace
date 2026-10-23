import { html, nothing, type TemplateResult } from 'lit';
import { countNoun, formatCount, type EatReliabilityState } from '@protspace/utils';
import { formatPercent } from '../query-builder/eat-reliability';
import {
  EAT_BOUNDS,
  renderReliabilityPercent,
  renderReliabilityRange,
  type EatReliabilityController,
} from './eat-reliability-controller';
import { EAT_BIN_COUNT, isKept, type EatSummary } from './eat-summary';

const BIN_WIDTH = 100 / EAT_BIN_COUNT;
const RELIABILITY_HEADING = 'How reliable are the predictions?';
const SKELETON_BARS = Array.from({ length: EAT_BIN_COUNT }, (_, bin) => bin);

/** `55–60 %`, a bar's range. */
export function binRange(bin: number): string {
  const from = bin * BIN_WIDTH;
  return `${from}–${formatPercent((from + BIN_WIDTH) / 100)}`;
}

/** `55–60 %: 41 predictions`, the bar's accessible name and tooltip. */
function barLabel(bin: number, count: number): string {
  return `${binRange(bin)}: ${countNoun(count, 'prediction', 'predictions')}`;
}

/** The bars' drill-down: which bar's list is open, and the one tab stop of the bar group. */
interface EatBarsView {
  openBin: number | null;
  /** The bar that holds the group's tab stop. */
  focusBin: number;
  /** The open bar's list, rendered under the axis. */
  list: TemplateResult | typeof nothing;
  onBar(bin: number): void;
  /** Arrow keys, Home or End moved the tab stop to `bin`. */
  onFocusBin(bin: number): void;
}

/** The bars that hold predictions, in order: the only ones the tab stop and the arrow keys reach. */
type StepKey = (filled: readonly number[], at: number) => number;

const STEP_KEYS: Record<string, StepKey> = {
  ArrowRight: (filled, at) => filled[Math.min(filled.length - 1, at + 1)],
  ArrowLeft: (filled, at) => filled[Math.max(0, at - 1)],
  Home: (filled) => filled[0],
  End: (filled) => filled[filled.length - 1],
};

/**
 * The 20 bars, one tab stop with the arrow keys between them (a roving tabindex) that skips the
 * empty bars. A click, Enter or Space opens the bar's drill-down list; an empty bar has none. A bar is shaded kept when its
 * midpoint passes the filter, so the shading follows the handles live while the emit waits out
 * the debounce.
 */
function renderHistogram(
  state: EatReliabilityState,
  summary: EatSummary | null,
  bars: EatBarsView,
): TemplateResult {
  if (!summary) {
    return html`<div class="eat-histogram" aria-hidden="true">
      ${SKELETON_BARS.map(
        () => html`<button type="button" class="eat-bar is-skeleton" disabled></button>`,
      )}
    </div>`;
  }
  if (summary.predicted === 0) {
    return html`<p class="eat-empty-view">No predictions in the current view</p>`;
  }
  const tallest = Math.max(...summary.bins);
  const filled = Array.from(summary.bins.keys()).filter((bin) => summary.bins[bin] > 0);
  // The tab stop stays on its bar while it holds predictions, else on the first that does.
  const focusBin = summary.bins[bars.focusBin] > 0 ? bars.focusBin : filled[0];
  const onKeydown = (event: KeyboardEvent) => {
    const step = STEP_KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    bars.onFocusBin(step(filled, filled.indexOf(focusBin)));
  };
  return html`<div
    class="eat-histogram"
    role="group"
    aria-label="Predictions by reliability"
    @keydown=${onKeydown}
  >
    ${Array.from(summary.bins, (count, bin) => {
      const label = barLabel(bin, count);
      return html`<button
        type="button"
        class="eat-bar"
        data-bin=${bin}
        tabindex=${bin === focusBin ? '0' : '-1'}
        ?data-empty=${count === 0}
        aria-expanded=${count === 0 ? nothing : String(bars.openBin === bin)}
        aria-controls=${bars.openBin === bin ? 'eat-drill' : nothing}
        data-kept=${String(isKept(state, (bin + 0.5) / EAT_BIN_COUNT))}
        aria-label=${label}
        title=${label}
        style=${`height:${Number(((count / tallest) * 100).toFixed(2))}%`}
        @click=${() => {
          if (count > 0) bars.onBar(bin);
        }}
      ></button>`;
    })}
  </div>`;
}

/**
 * The reliability section (proposal B §4.4): its question heading and helper line, the range's
 * low and high % boxes, the histogram,
 * the two handles on the axis under it, the outcome row for predictions outside the range, and the readout with
 * its Export IDs trigger. `summary` null is the loading skeleton, inert. With Show off the % boxes
 * and handles stay in the accessibility tree, disabled;
 * the bars and their lists keep working, so the section is only greyed, not aria-disabled.
 */
export function renderReliability(
  ctrl: EatReliabilityController,
  summary: EatSummary | null,
  exportButton: TemplateResult,
  outcome: TemplateResult,
  bars: EatBarsView,
): TemplateResult {
  const off = !ctrl.overlayEnabled;
  const disabled = off || !summary;
  const { predicted, kept } = summary ?? { predicted: 0, kept: 0 };
  return html`<section
    class=${off ? 'eat-reliability is-off' : 'eat-reliability'}
    aria-label=${RELIABILITY_HEADING}
    ?inert=${!summary}
  >
    <h3 class="eat-heading">${RELIABILITY_HEADING}</h3>
    <p class="eat-help">
      Higher means the label came from a closer protein. Use it to compare predictions here, not as
      a chance of being right.
    </p>
    <div class="eat-range-row">
      <span class="eat-bounds">
        ${EAT_BOUNDS.map(
          (bound, index) =>
            html`${index > 0 ? html`<span aria-hidden="true">–</span>` : nothing}
            ${renderReliabilityPercent(ctrl, bound, disabled)}`,
        )}
        <span aria-hidden="true">%</span>
      </span>
    </div>
    ${renderHistogram(ctrl.reliability, summary, bars)}
    <div class="eat-handles">
      ${EAT_BOUNDS.map((bound) => renderReliabilityRange(ctrl, bound, disabled))}
    </div>
    <div class="eat-axis" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
    ${bars.openBin !== null && summary && summary.predicted > 0 ? bars.list : nothing} ${outcome}
    ${predicted > 0
      ? html`<div class="eat-readout-row">
          <p class="eat-readout">
            ${formatCount(kept)} of ${formatCount(predicted)} predictions in range
          </p>
          ${exportButton}
        </div>`
      : nothing}
  </section>`;
}
