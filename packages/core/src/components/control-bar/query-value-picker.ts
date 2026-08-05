import { LitElement, html, nothing } from 'lit';
import { property, state, query as litQuery } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { LogicalOp } from './query-types';
import { ANY_VALUE } from './query-types';
import { toInternalValue } from '../legend/config';
import { resolveAnnotationInternalValues } from './query-evaluate';
import { NA_VALUE, NA_DISPLAY } from '@protspace/utils';
import { queryBuilderStyles } from './query-builder.styles';

/**
 * Display label for the `ANY_VALUE` sentinel, the companion of `NA_DISPLAY`.
 * Lives here (next to the picker that offers it) rather than in query-types.ts,
 * which stays presentation-free; the chip renderer in query-condition-row
 * imports it so a selected sentinel reads the same in both places.
 */
export const ANY_DISPLAY = 'Any value';

/**
 * Searchable dropdown for selecting annotation values.
 *
 * Events:
 * - `value-selected` — user clicked a value, detail: `{ value: string }`
 * - `picker-close`   — Escape pressed or click outside
 */
@customElement('protspace-query-value-picker')
class ProtspaceQueryValuePicker extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: String }) annotation: string = '';
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  @property({ type: Object }) matchedIndices: Set<number> = new Set();
  @property({ type: String }) logicalOp: LogicalOp | undefined = undefined;
  @property({ type: Array }) selectedValues: string[] = [];
  @property({ type: Boolean }) open: boolean = false;
  @property({ type: Number }) triggerTop: number = 0;
  @property({ type: Number }) triggerLeft: number = 0;

  @state() private _searchQuery: string = '';

  @litQuery('.value-picker-input') private _inputEl?: HTMLInputElement;

  // ─── Click-outside detection ──────────────────────────────────────────────

  private _handleDocumentClick = (e: MouseEvent) => {
    if (this.open && !e.composedPath().includes(this)) {
      this.dispatchEvent(new CustomEvent('picker-close', { bubbles: true, composed: true }));
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._handleDocumentClick, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleDocumentClick, true);
  }

  // ─── Auto-focus on open ───────────────────────────────────────────────────

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('open') && this.open) {
      this.updateComplete.then(() => {
        this._inputEl?.focus();
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _displayValue(value: string): string {
    if (value === NA_VALUE) return NA_DISPLAY;
    if (value === ANY_VALUE) return ANY_DISPLAY;
    return value;
  }

  /**
   * Build a map from internal value → count of proteins that have this value.
   * When `indices` is provided, only count within that set; otherwise count all proteins.
   * Multi-label proteins count once toward EACH distinct value they carry, so
   * counts agree with the any-label matching semantics in query-evaluate.
   *
   * `ANY_VALUE` is tallied alongside the real values as a per-protein predicate:
   * one increment for each protein carrying at least one non-N/A label, matching
   * how evaluateCondition() resolves the sentinel.
   */
  private _buildCountMap(indices?: Set<number>): Map<string, number> {
    const counts = new Map<string, number>();
    if (!this.data || !this.annotation) return counts;

    const countProtein = (idx: number) => {
      const resolved = resolveAnnotationInternalValues(idx, this.annotation, this.data!);
      for (const internal of resolved) {
        counts.set(internal, (counts.get(internal) ?? 0) + 1);
      }
      if (resolved.some((internal) => internal !== NA_VALUE)) {
        counts.set(ANY_VALUE, (counts.get(ANY_VALUE) ?? 0) + 1);
      }
    };

    if (indices) {
      for (const idx of indices) countProtein(idx);
    } else {
      const numProteins = this.data.protein_ids?.length ?? 0;
      for (let i = 0; i < numProteins; i++) countProtein(i);
    }

    return counts;
  }

  /**
   * The subset of `indices` whose proteins carry at least one real (non-N/A)
   * label for this annotation — the same predicate `proteinsWithAnyValue()` in
   * query-evaluate applies, restricted to the already-matched set.
   */
  private _proteinsWithValue(indices: Set<number>): Set<number> {
    const withValue = new Set<number>();
    if (!this.data || !this.annotation) return withValue;

    for (const idx of indices) {
      const resolved = resolveAnnotationInternalValues(idx, this.annotation, this.data);
      if (resolved.some((internal) => internal !== NA_VALUE)) withValue.add(idx);
    }
    return withValue;
  }

  /**
   * Compute the full list of internal values for this annotation (excluding
   * already-selected ones) and the filtered subset based on the current search.
   */
  private _computeValues(): {
    allValues: string[];
    filteredValues: Array<{ value: string; count: number }>;
  } {
    const annotationMeta = this.data?.annotations?.[this.annotation];
    if (!annotationMeta) {
      return { allValues: [], filteredValues: [] };
    }

    const selectedSet = new Set(this.selectedValues);
    const excludedCountMap = this._buildCountMap(this.matchedIndices);
    // Full-dataset counts only needed for OR
    const fullCountMap = this.logicalOp === 'OR' ? this._buildCountMap() : undefined;

    const isOR = this.logicalOp === 'OR';
    const isNOT = this.logicalOp === 'NOT';

    // NOT is scoped to proteins that carry a value (see evaluateItems), so its
    // preview arithmetic runs over `matched ∩ has-a-value` instead of `matched`.
    const notScope = isNOT ? this._proteinsWithValue(this.matchedIndices) : undefined;
    const notCountMap = isNOT ? this._buildCountMap(notScope) : undefined;

    // Deduplicate while preserving order, applying toInternalValue normalisation.
    // ANY_VALUE leads the list: it is a presence sentinel rather than a declared
    // value, and it is the entry that answers "which proteins are annotated at all?".
    const seen = new Set<string>();
    const allValues: string[] = [];
    if (!selectedSet.has(ANY_VALUE)) {
      seen.add(ANY_VALUE);
      allValues.push(ANY_VALUE);
    }
    for (const raw of annotationMeta.values) {
      const internal = toInternalValue(raw);
      if (!seen.has(internal) && !selectedSet.has(internal)) {
        seen.add(internal);
        allValues.push(internal);
      }
    }

    const excludedSize = this.matchedIndices.size;

    const queryLower = this._searchQuery.trim().toLowerCase();
    const filteredValues = allValues
      .filter((v) => {
        if (!queryLower) return true;
        return this._displayValue(v).toLowerCase().includes(queryLower);
      })
      .map((v) => {
        const rawCount = excludedCountMap.get(v) ?? 0;
        let count: number;
        if (isOR) {
          const fullCount = fullCountMap!.get(v) ?? 0;
          // OR unions: excludedSet ∪ conditionResult
          count = excludedSize + fullCount - rawCount;
        } else if (isNOT) {
          // NOT is "carries a value AND does not match", not a bare complement:
          //   matched ∩ has-a-value ∩ ¬carriers(v)
          // so the preview is the has-a-value slice of the matched set minus the
          // proteins in that slice carrying v. Subtracting inside the slice (rather
          // than `|matched| − carriers`) is what fixes the two old errors: proteins
          // that are N/A on this annotation are no longer swept in, and a
          // multi-label protein is removed exactly once no matter how many of its
          // labels miss v. Equals evaluateQuery() for the same single NOT
          // condition — see the cross-check in query-value-picker.test.ts.
          count = (notScope?.size ?? 0) - (notCountMap!.get(v) ?? 0);
        } else {
          // AND: proteins in excluded set that have this value
          count = rawCount;
        }
        return { value: v, count };
      });

    return { allValues, filteredValues };
  }

  /**
   * Return a Lit template that wraps matched characters in `<strong class="value-picker-highlight">`.
   */
  private _highlightMatch(text: string) {
    const queryLower = this._searchQuery.trim().toLowerCase();
    if (!queryLower) {
      return html`${text}`;
    }

    const idx = text.toLowerCase().indexOf(queryLower);
    if (idx === -1) {
      return html`${text}`;
    }

    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + queryLower.length);
    const after = text.slice(idx + queryLower.length);

    return html`${before}<strong class="value-picker-highlight">${match}</strong>${after}`;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _handleSearch(e: Event) {
    this._searchQuery = (e.target as HTMLInputElement).value;
  }

  private _handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent('picker-close', { bubbles: true, composed: true }));
    }
  }

  private _selectValue(value: string) {
    this.dispatchEvent(
      new CustomEvent('value-selected', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
    // Do NOT close — dropdown stays open for multi-add
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  render() {
    if (!this.open) {
      return nothing;
    }

    const { allValues, filteredValues } = this._computeValues();
    // "Any value" subsumes every other entry — OR-ing it with a real value is
    // just "any value", and OR-ing it with N/A is everything — so while it is
    // selected the rest of the list is locked out rather than silently ignored.
    const lockedByAnyValue = this.selectedValues.includes(ANY_VALUE);

    return html`
      <div class="value-picker" style="top:${this.triggerTop}px;left:${this.triggerLeft}px">
        <input
          class="value-picker-input"
          placeholder="Search values..."
          .value=${this._searchQuery}
          @input=${this._handleSearch}
          @keydown=${this._handleKeydown}
        />
        <div class="value-picker-list">
          ${filteredValues.map(
            ({ value, count }) => html`
              <div
                class="value-picker-item ${lockedByAnyValue ? 'is-disabled' : ''}"
                aria-disabled=${lockedByAnyValue ? 'true' : 'false'}
                @click=${() => {
                  if (!lockedByAnyValue) this._selectValue(value);
                }}
              >
                <span>${this._highlightMatch(this._displayValue(value))}</span>
                <span class="value-picker-count">${count}</span>
              </div>
            `,
          )}
        </div>
        <div class="value-picker-footer">
          ${filteredValues.length} of ${allValues.length} values shown
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-query-value-picker': ProtspaceQueryValuePicker;
  }
}
