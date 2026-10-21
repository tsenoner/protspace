import { html, nothing, type TemplateResult } from 'lit';
import { countNoun, formatCount, type EatReliabilityState } from '@protspace/utils';
import type { SegmentedOption } from '../kit/segmented';
import '../kit/segmented';
import { formatPercent } from '../query-builder/eat-reliability';
import {
  renderReliabilityPercent,
  renderReliabilityRange,
  type EatReliabilityController,
} from './eat-reliability-controller';
import { EAT_BIN_COUNT, isKept, type EatSummary } from './eat-summary';

/** The modes, named by what they keep. */
const MODE_OPTIONS: SegmentedOption[] = [
  { value: 'atLeast', label: 'Keep ≥' },
  { value: 'atMost', label: 'Keep ≤' },
  { value: 'between', label: 'Keep between' },
];
/** With Show off: still announced, not choosable. */
const MODE_OPTIONS_OFF = MODE_OPTIONS.map((option) => ({ ...option, disabled: true }));

const BIN_WIDTH = 100 / EAT_BIN_COUNT;
const SKELETON_BARS = Array.from({ length: EAT_BIN_COUNT }, (_, bin) => bin);

/** `55–60 %: 41 predictions`, the bar's accessible name and tooltip. */
function barLabel(bin: number, count: number): string {
  const from = bin * BIN_WIDTH;
  return `${from}–${formatPercent((from + BIN_WIDTH) / 100)}: ${countNoun(count, 'prediction', 'predictions')}`;
}

/**
 * The 20 bars. A bar is shaded kept when its midpoint passes the filter, so the shading follows the
 * handles live while the emit waits out the debounce.
 */
function renderHistogram(state: EatReliabilityState, summary: EatSummary | null): TemplateResult {
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
  return html`<div class="eat-histogram">
    ${Array.from(summary.bins, (count, bin) => {
      const label = barLabel(bin, count);
      // Out of the tab order until a bar has an action.
      return html`<button
        type="button"
        class="eat-bar"
        tabindex="-1"
        data-kept=${String(isKept(state, (bin + 0.5) / EAT_BIN_COUNT))}
        aria-label=${label}
        title=${label}
        style=${`height:${Number(((count / tallest) * 100).toFixed(2))}%`}
      ></button>`;
    })}
  </div>`;
}

/**
 * The reliability section (proposal B §4.4): modes and a % box per active bound, the histogram,
 * the handles on the axis under it, and the readout. `summary` null is the loading skeleton,
 * inert. With Show off every control stays in the accessibility tree, disabled.
 */
export function renderReliability(
  ctrl: EatReliabilityController,
  summary: EatSummary | null,
): TemplateResult {
  const off = !ctrl.overlayEnabled;
  const disabled = off || !summary;
  const bounds = ctrl.activeBounds;
  const { predicted, kept } = summary ?? { predicted: 0, kept: 0 };
  return html`<section
    class="eat-reliability"
    aria-label="Reliability"
    aria-disabled=${off ? 'true' : nothing}
    ?inert=${!summary}
  >
    <h4 class="eat-heading">Reliability</h4>
    <div class="eat-mode-row">
      <ps-segmented
        label="Reliability filter mode"
        .options=${off ? MODE_OPTIONS_OFF : MODE_OPTIONS}
        .value=${ctrl.reliability.mode}
        @change=${ctrl.onModeChange}
      ></ps-segmented>
      <span class="eat-bounds">
        ${bounds.map(
          (bound, index) =>
            html`${index > 0 ? html`<span aria-hidden="true">–</span>` : nothing}
            ${renderReliabilityPercent(ctrl, bound, disabled)}`,
        )}
        <span aria-hidden="true">%</span>
      </span>
    </div>
    ${renderHistogram(ctrl.reliability, summary)}
    <div class="eat-handles">
      ${bounds.map((bound) => renderReliabilityRange(ctrl, bound, disabled))}
    </div>
    <div class="eat-axis" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
    ${predicted > 0
      ? html`<p class="eat-readout">
          Keeps ${formatCount(kept)} of ${formatCount(predicted)} predictions
          (${formatPercent(kept / predicted)})
        </p>`
      : nothing}
  </section>`;
}
