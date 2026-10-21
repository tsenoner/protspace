import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { annotationLabel, countNoun } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { NumericCondition } from './query-types';
import {
  countNumericMatches,
  isNumericConditionReady,
  readRange,
  writeRange,
  type NumericRangeEdit,
} from './query-numeric-helpers';
import {
  BIN_COUNT,
  fractionOf,
  histogramOf,
  positionOf,
  rangeOf,
  valueAt,
  type NumericHistogram,
  type NumericRange,
} from './query-histogram';
import type { RangePositions } from './query-range-slider';
import { queryBuilderStyles } from './query-builder.styles';
import './query-range-slider';
import type { PsCheckbox } from '../kit/checkbox';
import '../kit/checkbox';
import { COMPACT_MEDIA } from '../../utils/breakpoints';

/** Units shown after the typed bounds, by annotation column. */
const UNITS: Record<string, string> = { length: 'aa' };

/** "length" for "Sequence length": the last word of the label, lowercased unless an acronym. */
function nounOf(label: string): string {
  const word = label.trim().split(/\s+/).pop() ?? label;
  return word.slice(1) === word.slice(1).toLowerCase() ? word.toLowerCase() : word;
}

/**
 * A numeric condition card's whole editor: a histogram of the annotation with the chosen range
 * in the accent, a two-thumb slider over the range's ends, the typed ends (empty: no limit, the
 * placeholder showing the data's own end) with their unit and the card's count, and a checkbox
 * that keeps the proteins with no value. Both ends are included; a thumb at its end of the track
 * empties its box. Untouched, the card is the full range with N/A kept, so it matches every
 * protein; unticking N/A then reads "has a value" (see `readRange` / `writeRange`).
 *
 * The condition object is owned by the control bar; this component is controlled. It keeps the
 * in-progress field text locally so a half-typed value (e.g. "-" or "1.") survives the
 * round-trip of the condition prop. A slider drag writes the typed bounds as it moves and the
 * condition on release (each keyboard step is a release).
 *
 * Events:
 * - `numeric-changed` — a bound or the N/A checkbox changed, detail: `{ condition: NumericCondition }`
 */
@customElement('protspace-query-numeric-input')
class ProtspaceQueryNumericInput extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: Object }) condition!: NumericCondition;
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;

  @state() private _matchCount: number | null = null;
  /** The shown count no longer matches the inputs; it reads "…" until the recount. */
  @state() private _countStale = false;
  @state() private _minText: string = '';
  @state() private _maxText: string = '';
  /** The thumbs while a drag is under way, so rounding the shown value cannot nudge them. */
  @state() private _dragging: RangePositions | null = null;
  /** A phone (upright or on its side): no histogram, the slider sits between the typed bounds. */
  @state() private _compact = false;

  private _countTimer: ReturnType<typeof setTimeout> | null = null;

  private _compactQuery: MediaQueryList | null = null;
  private readonly _onCompactChange = () => (this._compact = !!this._compactQuery?.matches);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    if (typeof matchMedia !== 'function') return;
    this._compactQuery = matchMedia(COMPACT_MEDIA);
    this._compactQuery.addEventListener('change', this._onCompactChange);
    this._onCompactChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._compactQuery?.removeEventListener('change', this._onCompactChange);
    this._compactQuery = null;
    if (this._countTimer) {
      clearTimeout(this._countTimer);
      this._countTimer = null;
    }
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('condition') || changed.has('data')) this._countStale = true;
    if (!changed.has('condition')) return;
    this._dragging = null;
    const { min, max } = readRange(this.condition);

    // Adopt prop values into local text unless they already parse to the same
    // number — this preserves an in-progress entry while still picking up
    // external resets (e.g. switching annotation clears min/max to null).
    if (this._parseFieldValue(this._minText) !== min) {
      this._minText = min === null ? '' : String(min);
    }
    if (this._parseFieldValue(this._maxText) !== max) {
      this._maxText = max === null ? '' : String(max);
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('condition') || changed.has('data')) {
      this._scheduleCount();
    }
  }

  // ─── Debounced live match count ───────────────────────────────────────────

  private _scheduleCount() {
    if (this._countTimer) clearTimeout(this._countTimer);
    this._countTimer = setTimeout(() => {
      this._countStale = false;
      if (!this.data) {
        this._matchCount = null;
        return;
      }
      // Untouched (the full range with N/A kept), the card keeps every protein.
      this._matchCount = isNumericConditionReady(this.condition)
        ? countNumericMatches(this.condition, this.data)
        : (this.data.protein_ids?.length ?? 0);
    }, 750);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _parseFieldValue(raw: string): number | null {
    if (raw.trim() === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Emits the condition with `fields` of the card's edit changed, in its one stored form. */
  private _emitChanged(fields: Partial<NumericRangeEdit>) {
    const condition = writeRange(this.condition, { ...readRange(this.condition), ...fields });
    this.dispatchEvent(
      new CustomEvent('numeric-changed', {
        detail: { condition },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _handleMinInput(e: Event) {
    this._minText = (e.target as HTMLInputElement).value;
    this._emitChanged({ min: this._parseFieldValue(this._minText) });
  }

  private _handleMaxInput(e: Event) {
    this._maxText = (e.target as HTMLInputElement).value;
    this._emitChanged({ max: this._parseFieldValue(this._maxText) });
  }

  /** The thumbs as the typed ends show them; a thumb at its end of the track is no limit. */
  private _positions(h: NumericRange): RangePositions {
    const min = this._parseFieldValue(this._minText);
    const max = this._parseFieldValue(this._maxText);
    return {
      low: min === null ? 0 : positionOf(h, min),
      high: max === null ? h.steps : positionOf(h, max),
    };
  }

  /**
   * The ends the thumbs now give, against `before`: only a moved thumb changes its end, so a drag
   * of one never fills the other's empty box; a thumb moved to its end of the track empties it.
   */
  private _endsAt(h: NumericRange, before: RangePositions, positions: RangePositions) {
    const low = positions.low ?? 0;
    const high = positions.high ?? h.steps;
    return {
      min: low === before.low ? undefined : low <= 0 ? null : valueAt(h, low),
      max: high === before.high ? undefined : high >= h.steps ? null : valueAt(h, high),
    };
  }

  private _setTexts(ends: { min?: number | null; max?: number | null }) {
    if (ends.min !== undefined) this._minText = ends.min === null ? '' : String(ends.min);
    if (ends.max !== undefined) this._maxText = ends.max === null ? '' : String(ends.max);
  }

  private _handleRangeInput(h: NumericRange, e: CustomEvent<RangePositions>) {
    e.stopPropagation();
    this._setTexts(this._endsAt(h, this._dragging ?? this._positions(h), e.detail));
    this._dragging = e.detail;
    this._countStale = true;
  }

  private _handleRangeChange(h: NumericRange, e: CustomEvent<RangePositions>) {
    e.stopPropagation();
    // The texts follow the drag, so the ends are read against the condition, not the texts.
    const { min: from, max: to } = readRange(this.condition);
    const before = {
      low: from === null ? 0 : positionOf(h, from),
      high: to === null ? h.steps : positionOf(h, to),
    };
    const ends = this._endsAt(h, before, e.detail);
    const min = ends.min === undefined ? from : ends.min;
    const max = ends.max === undefined ? to : ends.max;
    this._setTexts({ min, max });
    if (min === from && max === to) {
      this._dragging = null;
      return;
    }
    this._emitChanged({ min, max });
  }

  private _handleNaToggle(e: Event) {
    this._emitChanged({ na: (e.target as PsCheckbox).checked });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  private _renderHistogram(h: NumericHistogram, from: number | null, to: number | null) {
    const lo = from === null ? 0 : fractionOf(h, from);
    const hi = to === null ? 1 : fractionOf(h, to);
    const bars = Array.from(h.counts, (count, i) => {
      // A bin [i, i + 1) is in the range when the range overlaps it, as the slider's thumbs show.
      const inRange = (i + 1) / BIN_COUNT > lo && i / BIN_COUNT <= hi;
      // Square-root heights keep the thin tail visible next to the peak.
      const height = count === 0 ? 0 : Math.max(6, Math.sqrt(count / h.peak) * 100);
      return html`<i class=${inRange ? 'in' : ''} style="height:${height}%"></i>`;
    });
    return html`<div class="numeric-histogram" aria-hidden="true">${bars}</div>`;
  }

  /** The two-thumb slider over the range's ends. */
  private _renderSlider(h: NumericRange, label: string, unit: string) {
    const positions = this._dragging ?? this._positions(h);
    return html`<protspace-query-range-slider
      .steps=${h.steps}
      .low=${positions.low}
      .high=${positions.high}
      .valueText=${(p: number) => withUnit(valueAt(h, p), unit)}
      label=${label}
      @range-input=${(e: CustomEvent<RangePositions>) => this._handleRangeInput(h, e)}
      @range-change=${(e: CustomEvent<RangePositions>) => this._handleRangeChange(h, e)}
    ></protspace-query-range-slider>`;
  }

  /**
   * Above the typed bounds on a wider screen: the histogram and the slider. The data's own ends
   * show as the empty boxes' placeholders, so no extent line repeats them.
   */
  private _renderDistribution(h: NumericHistogram, label: string, unit: string) {
    const min = this._parseFieldValue(this._minText);
    const max = this._parseFieldValue(this._maxText);
    return html`${this._renderHistogram(h, min, max)} ${this._renderSlider(h, label, unit)}`;
  }

  private _renderCount() {
    if (this._countStale && this._matchCount !== null)
      return html`<span class="numeric-match-count" aria-busy="true">…</span>`;
    if (this._matchCount === null) return nothing;
    // Named, so it is not read as the data's maximum next to the typed bounds.
    return html`<span class="numeric-match-count" title="Proteins this condition keeps"
      >${countNoun(this._matchCount, 'protein', 'proteins')}<span class="sr-only">
        ${this._matchCount === 1 ? 'matches' : 'match'}</span
      ></span
    >`;
  }

  /** A typed end: empty is no limit, so the placeholder is the data's own end. */
  private _renderField(end: 'min' | 'max', range: NumericRange | null) {
    const min = end === 'min';
    const extent = range ? formatValue(min ? range.min : range.max) : min ? 'min' : 'max';
    return html`<input
      class="numeric-field input-base"
      type="number"
      inputmode="decimal"
      aria-label=${min ? 'Minimum value' : 'Maximum value'}
      placeholder=${extent}
      .value=${min ? this._minText : this._maxText}
      @input=${min ? this._handleMinInput : this._handleMaxInput}
    />`;
  }

  render() {
    const annotation = this.condition.annotation;
    const label = annotationLabel(annotation, this.data?.annotations?.[annotation]);
    const unit = UNITS[annotation] ?? '';
    const values = this.data?.numeric_annotation_data?.[annotation];
    const compact = this._compact;
    // Bins only where the histogram shows; a phone's slider needs just the range and scale.
    const histogram = values && !compact ? histogramOf(values) : null;
    const range = histogram ?? (values ? rangeOf(values) : null);
    const na = html`<ps-checkbox
      class="numeric-na"
      .checked=${readRange(this.condition).na}
      @change=${this._handleNaToggle}
      >Include proteins with no ${nounOf(label)} (N/A)</ps-checkbox
    >`;

    return html`
      <div class="numeric-input ${compact ? 'compact' : ''}">
        ${histogram ? this._renderDistribution(histogram, label, unit) : nothing}
        <div class="numeric-bounds">
          ${this._renderField('min', range)}
          ${compact && range ? this._renderSlider(range, label, unit) : nothing}
          <span class="numeric-dash">to</span>
          ${this._renderField('max', range)}
          ${unit ? html`<span class="numeric-unit">${unit}</span>` : nothing}
          ${compact ? nothing : this._renderCount()}
        </div>
        ${compact ? html`<div class="numeric-na-line">${na} ${this._renderCount()}</div>` : na}
      </div>
    `;
  }
}

/** A bound as a placeholder or the slider shows it: grouped digits, at most 3 decimals. */
function formatValue(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function withUnit(v: number, unit: string): string {
  return unit ? `${formatValue(v)} ${unit}` : formatValue(v);
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-numeric-input': ProtspaceQueryNumericInput;
  }
}
