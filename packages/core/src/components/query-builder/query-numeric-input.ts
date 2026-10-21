import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { NA_VALUE, countNoun } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { NumericCondition } from './query-types';
import { ANY_VALUE } from './query-types';
import {
  countNumericMatches,
  isNumericConditionReady,
  numericFieldsFor,
  presenceOf,
} from './query-numeric-helpers';
import { displayFilterValue, renderValueChip } from './query-presence';
import { queryBuilderStyles } from './query-builder.styles';

/**
 * Numeric value input for a query condition: the one or two number fields its
 * comparison reads (the card's operator menu picks it), an "N/A" chip, and a
 * debounced live match count. The chip is unioned with the comparison, so
 * `>= 0.5` plus N/A reads "at least 0.5, or no value at all".
 *
 * The condition object is owned by the control bar; this component is
 * controlled. It keeps the in-progress field text locally so a half-typed
 * value (e.g. "-" or "1.") survives the round-trip of the condition prop.
 *
 * Events:
 * - `numeric-changed` — a bound or the N/A chip changed, detail: `{ condition: NumericCondition }`
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

  private _handleMinInput(e: Event) {
    this._minText = (e.target as HTMLInputElement).value;
    this._emitChanged({ ...this.condition, min: this._parseFieldValue(this._minText) });
  }

  private _handleMaxInput(e: Event) {
    this._maxText = (e.target as HTMLInputElement).value;
    this._emitChanged({ ...this.condition, max: this._parseFieldValue(this._maxText) });
  }

  private _addPresence(value: string) {
    const presence = presenceOf(this.condition);
    if (presence.includes(value)) return;
    this._emitChanged({ ...this.condition, presence: [...presence, value] });
  }

  private _removePresence(value: string) {
    this._emitChanged({
      ...this.condition,
      presence: presenceOf(this.condition).filter((p) => p !== value),
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  /**
   * The N/A chip, styled as the categorical value chips it mirrors. "Any value" is the operator
   * menu's "has any value"; a chip for it left over from an older query still shows, to remove.
   */
  private _renderPresence(presence: readonly string[]) {
    const addable = presence.includes(NA_VALUE) ? [] : [NA_VALUE];

    return html`
      ${presence.map((value) => renderValueChip(value, () => this._removePresence(value), value))}
      ${addable.map(
        (value) => html`
          <button
            class="value-chip-add"
            data-presence=${value}
            @click=${() => this._addPresence(value)}
          >
            + ${displayFilterValue(value)}
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
        ${fields.min
          ? html`<input
              class="numeric-field input-base"
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
              class="numeric-field input-base"
              type="number"
              aria-label="Maximum value"
              placeholder="max"
              ?disabled=${anyValue}
              .value=${this._maxText}
              @input=${this._handleMaxInput}
            />`
          : nothing}
        ${this._renderPresence(presence)}
        ${this._matchCount !== null
          ? html`<span class="numeric-match-count"
              >${countNoun(this._matchCount, 'protein matches', 'proteins match')}</span
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
