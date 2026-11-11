import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { customElement } from '../../utils/safe-custom-element';
import { rangeSliderStyles } from './query-range-slider.styles';

/** Positions of the slider's thumbs, 0..steps; null for a thumb the operator does not use. */
export interface RangePositions {
  low: number | null;
  high: number | null;
}

/**
 * A one- or two-thumb range slider: native range inputs layered on one track, so arrow, Page and
 * Home/End keys, touch and screen readers come for free. Each thumb names its value through
 * `valueText`.
 *
 * Events (detail `RangePositions`):
 * - `range-input` — while a thumb moves
 * - `range-change` — on release, and on each keyboard step
 */
@customElement('protspace-query-range-slider')
class ProtspaceQueryRangeSlider extends LitElement {
  static styles = rangeSliderStyles;

  @property({ type: Number }) steps = 1000;
  @property({ type: Number }) low: number | null = null;
  @property({ type: Number }) high: number | null = null;
  /** What a thumb's position means, read out as its `aria-valuetext`. */
  @property({ attribute: false }) valueText: (position: number) => string = String;
  /** Names the thumbs: "<label> minimum" / "<label> maximum". */
  @property() label = '';

  private _read(e: Event, which: 'low' | 'high'): RangePositions {
    const input = e.target as HTMLInputElement;
    let value = Number(input.value);
    // The thumbs never cross: one pushed past the other stops at it.
    if (which === 'low' && this.high !== null && value > this.high) value = this.high;
    if (which === 'high' && this.low !== null && value < this.low) value = this.low;
    input.value = String(value);
    return { low: which === 'low' ? value : this.low, high: which === 'high' ? value : this.high };
  }

  private _emit(type: string, detail: RangePositions) {
    this.low = detail.low;
    this.high = detail.high;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private _thumb(which: 'low' | 'high', value: number) {
    return html`<input
      type="range"
      class=${which}
      min="0"
      max=${this.steps}
      step="1"
      .value=${live(String(value))}
      aria-label=${`${this.label} ${which === 'low' ? 'minimum' : 'maximum'}`}
      aria-valuetext=${this.valueText(value)}
      @input=${(e: Event) => this._emit('range-input', this._read(e, which))}
      @change=${(e: Event) => this._emit('range-change', this._read(e, which))}
    />`;
  }

  render() {
    const from = this.low ?? 0;
    const to = this.high ?? this.steps;
    const pct = (p: number) => `${(p / this.steps) * 100}%`;
    return html`<div class="slider">
      <div class="track"></div>
      <div class="fill" style="left:${pct(from)};width:${pct(Math.max(0, to - from))}"></div>
      ${this.low !== null ? this._thumb('low', this.low) : nothing}
      ${this.high !== null ? this._thumb('high', this.high) : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-range-slider': ProtspaceQueryRangeSlider;
  }
}
