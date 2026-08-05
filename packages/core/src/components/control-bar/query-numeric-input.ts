import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { NA_VALUE, NA_DISPLAY } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { NumericCondition, NumericOperator } from './query-types';
import { ANY_VALUE } from './query-types';
import {
  countNumericMatches,
  isNumericConditionReady,
  numericFieldsFor,
  presenceOf,
} from './query-numeric-helpers';
import { queryBuilderStyles } from './query-builder.styles';

/**
 * Numeric value input for a query condition: an operator dropdown plus one or
 * two number fields, presence chips ("N/A" / "Any value"), and a debounced live
 * match count. A presence chip is unioned with the comparison, so `>= 0.5` plus
 * an N/A chip reads "at least 0.5, or no value at all".
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

  private _presenceLabel(value: string): string {
    return value === NA_VALUE ? NA_DISPLAY : 'Any value';
  }

  private _addPresence(value: string) {
    const presence = presenceOf(this.condition);
    if (presence.includes(value)) return;

    // "Any value" subsumes both the N/A chip and the comparison ("any value OR
    // >= X" is just "any value"), so it replaces them rather than joining them.
    if (value === ANY_VALUE) {
      this._emitChanged({ ...this.condition, presence: [ANY_VALUE], min: null, max: null });
      return;
    }
    this._emitChanged({
      ...this.condition,
      presence: [...presence.filter((p) => p !== ANY_VALUE), value],
    });
  }

  private _removePresence(value: string) {
    this._emitChanged({
      ...this.condition,
      presence: presenceOf(this.condition).filter((p) => p !== value),
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  /** Presence chips, styled as the categorical value chips they mirror. */
  private _renderPresence(presence: string[], anyValue: boolean) {
    // With "Any value" on, offering "N/A" too would be a contradiction.
    const addable = [NA_VALUE, ANY_VALUE].filter(
      (value) => !presence.includes(value) && !(anyValue && value === NA_VALUE),
    );

    return html`
      ${presence.map(
        (value) => html`
          <span class="value-chip" data-presence=${value}>
            <span class="value-chip-text">${this._presenceLabel(value)}</span>
            <button
              class="value-chip-remove"
              data-presence=${value}
              @click=${() => this._removePresence(value)}
              title="Remove value"
            >
              ×
            </button>
          </span>
        `,
      )}
      ${addable.map(
        (value) => html`
          <button
            class="value-chip-add"
            data-presence=${value}
            @click=${() => this._addPresence(value)}
            title="Add ${this._presenceLabel(value)}"
          >
            + ${this._presenceLabel(value)}
          </button>
        `,
      )}
    `;
  }

  render() {
    const fields = numericFieldsFor(this.condition.operator);
    const presence = presenceOf(this.condition);
    // "Any value" already matches everything with a value, so the comparison
    // it subsumes is disabled while the chip is on.
    const anyValue = presence.includes(ANY_VALUE);

    return html`
      <div class="numeric-input">
        <select
          class="numeric-operator-select"
          aria-label="Comparison operator"
          ?disabled=${anyValue}
          .value=${this.condition.operator}
          @change=${this._handleOperatorChange}
        >
          <option value="gt">&gt;</option>
          <option value="gte">&ge;</option>
          <option value="lt">&lt;</option>
          <option value="lte">&le;</option>
          <option value="between">between</option>
        </select>

        ${fields.min
          ? html`<input
              class="numeric-field"
              type="number"
              aria-label="Minimum value"
              placeholder="min"
              ?disabled=${anyValue}
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
              ?disabled=${anyValue}
              .value=${this._maxText}
              @input=${this._handleMaxInput}
            />`
          : nothing}
        ${this._renderPresence(presence, anyValue)}
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
