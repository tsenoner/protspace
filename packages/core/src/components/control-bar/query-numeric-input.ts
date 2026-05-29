import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { NumericCondition, NumericOperator } from './query-types';
import {
  countNumericMatches,
  isNumericConditionReady,
  numericFieldsFor,
} from './query-numeric-helpers';
import { queryBuilderStyles } from './query-builder.styles';

/**
 * Numeric value input for a query condition: an operator dropdown plus one or
 * two number fields, with a debounced live match count.
 *
 * The condition object is owned by the control bar; this component is
 * controlled. It keeps the in-progress field text locally so a half-typed
 * value (e.g. "-" or "1.") survives the round-trip of the condition prop.
 *
 * Events:
 * - `numeric-changed` — operator or a bound changed, detail: `{ condition: NumericCondition }`
 */
@customElement('protspace-query-numeric-input')
class ProtspaceQueryNumericInput extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: Object }) condition!: NumericCondition;
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;

  @state() private _matchCount: number | null = null;
  @state() private _minText: string = '';
  @state() private _maxText: string = '';

  private _countTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._countTimer) {
      clearTimeout(this._countTimer);
      this._countTimer = null;
    }
  }

  willUpdate(changed: Map<string, unknown>) {
    if (!changed.has('condition')) return;

    // Adopt prop values into local text unless they already parse to the same
    // number — this preserves an in-progress entry while still picking up
    // external resets (e.g. switching annotation clears min/max to null).
    if (this._parseFieldValue(this._minText) !== this.condition.min) {
      this._minText = this.condition.min === null ? '' : String(this.condition.min);
    }
    if (this._parseFieldValue(this._maxText) !== this.condition.max) {
      this._maxText = this.condition.max === null ? '' : String(this.condition.max);
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
      if (!this.data || !isNumericConditionReady(this.condition)) {
        this._matchCount = null;
        return;
      }
      this._matchCount = countNumericMatches(this.condition, this.data);
    }, 750);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _parseFieldValue(raw: string): number | null {
    if (raw.trim() === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _emitChanged(updated: NumericCondition) {
    this.dispatchEvent(
      new CustomEvent('numeric-changed', {
        detail: { condition: updated },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _handleOperatorChange(e: Event) {
    const operator = (e.target as HTMLSelectElement).value as NumericOperator;
    // Null out the bound the new operator doesn't use so a hidden value can't
    // silently linger and reappear (and re-constrain the filter) on switching back.
    const fields = numericFieldsFor(operator);
    this._emitChanged({
      ...this.condition,
      operator,
      min: fields.min ? this.condition.min : null,
      max: fields.max ? this.condition.max : null,
    });
  }

  private _handleMinInput(e: Event) {
    this._minText = (e.target as HTMLInputElement).value;
    this._emitChanged({ ...this.condition, min: this._parseFieldValue(this._minText) });
  }

  private _handleMaxInput(e: Event) {
    this._maxText = (e.target as HTMLInputElement).value;
    this._emitChanged({ ...this.condition, max: this._parseFieldValue(this._maxText) });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  render() {
    const fields = numericFieldsFor(this.condition.operator);

    return html`
      <div class="numeric-input">
        <select
          class="numeric-operator-select"
          aria-label="Comparison operator"
          .value=${this.condition.operator}
          @change=${this._handleOperatorChange}
        >
          <option value="gt">&gt;</option>
          <option value="lt">&lt;</option>
          <option value="between">between</option>
        </select>

        ${fields.min
          ? html`<input
              class="numeric-field"
              type="number"
              aria-label="Minimum value"
              placeholder="min"
              .value=${this._minText}
              @input=${this._handleMinInput}
            />`
          : nothing}
        ${fields.min && fields.max ? html`<span class="numeric-dash">–</span>` : nothing}
        ${fields.max
          ? html`<input
              class="numeric-field"
              type="number"
              aria-label="Maximum value"
              placeholder="max"
              .value=${this._maxText}
              @input=${this._handleMaxInput}
            />`
          : nothing}
        ${this._matchCount !== null
          ? html`<span class="numeric-match-count"
              >${this._matchCount.toLocaleString()} proteins match</span
            >`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-numeric-input': ProtspaceQueryNumericInput;
  }
}
