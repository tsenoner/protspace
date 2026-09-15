import { LitElement, html, nothing } from 'lit';
import { property, state, query as litQuery } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import type { LogicalOp } from './query-types';
import { ANY_VALUE } from './query-types';
import { toInternalValue } from '../legend/config';
import { resolveAnnotationInternalValues } from './query-evaluate';
import { isNAValue } from '@protspace/utils';
import { displayFilterValue } from './query-presence';
import { queryBuilderStyles } from './query-builder.styles';
import { handleListboxKeydown, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';

/**
 * One dataset walk's worth of tallies: the per-value counts plus the two
 * per-protein aggregates the NOT preview needs (see `_buildCountMap`).
 */
interface CountMapResult {
  counts: Map<string, number>;
  anyCount: number;
  mixedNaCount: number;
}

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
  /** Index into the *currently filtered* list, or -1 for "nothing highlighted". */
  @state() private _highlightIndex: number = -1;

  @litQuery('.value-picker-input') private _inputEl?: HTMLInputElement;

  /**
   * Memoized count maps. `_buildCountMap` walks the entire dataset (twice under
   * OR), and `_computeValues` runs on every render — including every keystroke
   * in the search box, which only re-filters an already-counted list. Without
   * this, typing re-scans ~570K proteins per character. Invalidated in
   * `willUpdate` from the inputs the counts actually depend on; `matchedIndices`
   * is compared by reference, which holds because the query builder hands down a
   * freshly built Set on every evaluation rather than mutating one in place.
   */
  private _countCache: {
    excluded: CountMapResult;
    full: Map<string, number> | undefined;
  } | null = null;

  willUpdate(changed: Map<string, unknown>) {
    if (
      changed.has('data') ||
      changed.has('annotation') ||
      changed.has('matchedIndices') ||
      changed.has('logicalOp')
    ) {
      this._countCache = null;
    }
    // Opening and closing both start the next visit from a clean slate: a stale
    // highlight indexes into the previous list, and a stale search silently
    // hides most of the values the reopened picker is supposed to offer.
    // Reset here rather than in `updated()` — setting reactive state after an
    // update has completed schedules a second render and trips Lit's
    // `change-in-update` dev warning.
    if (changed.has('open')) {
      this._highlightIndex = -1;
      this._searchQuery = '';
    }
  }

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

  /**
   * Build a map from internal value → count of proteins that have this value.
   * When `indices` is provided, only count within that set; otherwise count all proteins.
   * Multi-label proteins count once toward EACH distinct value they carry, so
   * counts agree with the any-label matching semantics in query-evaluate.
   *
   * `ANY_VALUE` is tallied alongside the real values as a per-protein predicate:
   * one increment for each protein carrying at least one non-N/A label, matching
   * how evaluateCondition() resolves the sentinel.
   *
   * `anyCount` and `mixedNaCount` fall out of the same walk and are what the NOT
   * preview needs, so it does not have to re-scan the dataset (see `_computeValues`):
   * `anyCount` is the size of NOT's "carries a value" scope, and `mixedNaCount`
   * counts the proteins inside that scope which ALSO carry an N/A label.
   */
  private _buildCountMap(indices?: Set<number>): CountMapResult {
    const counts = new Map<string, number>();
    let anyCount = 0;
    let mixedNaCount = 0;
    if (!this.data || !this.annotation) return { counts, anyCount, mixedNaCount };

    const countProtein = (idx: number) => {
      const resolved = resolveAnnotationInternalValues(idx, this.annotation, this.data!);
      let hasReal = false;
      let hasNa = false;
      for (const internal of resolved) {
        counts.set(internal, (counts.get(internal) ?? 0) + 1);
        if (isNAValue(internal)) hasNa = true;
        else hasReal = true;
      }
      if (hasReal) {
        anyCount++;
        if (hasNa) mixedNaCount++;
      }
    };

    if (indices) {
      for (const idx of indices) countProtein(idx);
    } else {
      const numProteins = this.data.protein_ids?.length ?? 0;
      for (let i = 0; i < numProteins; i++) countProtein(i);
    }

    counts.set(ANY_VALUE, anyCount);
    return { counts, anyCount, mixedNaCount };
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

    const isOR = this.logicalOp === 'OR';
    const isNOT = this.logicalOp === 'NOT';

    const selectedSet = new Set(this.selectedValues);
    this._countCache ??= {
      excluded: this._buildCountMap(this.matchedIndices),
      // Full-dataset counts only needed for OR
      full: isOR ? this._buildCountMap().counts : undefined,
    };
    const {
      counts: excludedCountMap,
      anyCount: notScopeSize,
      mixedNaCount,
    } = this._countCache.excluded;
    const fullCountMap = this._countCache.full;

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
        return displayFilterValue(v).toLowerCase().includes(queryLower);
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
          //
          // Every term comes from the single count-map walk above, since carriers
          // of a REAL value all have a value by definition (so their tally inside
          // the scope equals their tally in the matched set); only N/A differs,
          // and that is exactly `mixedNaCount`. ANY_VALUE needs no special case:
          // its tally IS `notScopeSize`, so it cancels to 0 on its own.
          const inScope = isNAValue(v) ? mixedNaCount : rawCount;
          count = notScopeSize - inScope;
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
    this._highlightIndex = -1; // The old highlight indexes into the old list.
  }

  /**
   * True while `ANY_VALUE` is selected: every entry is then locked out (see
   * render) and neither the pointer nor the keyboard may select one.
   */
  private get _lockedByAnyValue(): boolean {
    return this.selectedValues.includes(ANY_VALUE);
  }

  private _handleKeydown(e: KeyboardEvent) {
    handleListboxKeydown(e, {
      // Lazy: only the arrow and Enter keys pay for the walk over the values.
      getValues: () => this._computeValues().filteredValues.map(({ value }) => value),
      highlightIndex: this._highlightIndex,
      setHighlightIndex: (index) => {
        this._highlightIndex = index;
        this._scrollToHighlighted();
      },
      // Escape goes through the shared helper so the enclosing modal does not
      // also close.
      onEscape: () =>
        this.dispatchEvent(new CustomEvent('picker-close', { bubbles: true, composed: true })),
      onSelect: (value) => this._selectValue(value),
      root: this.shadowRoot,
      itemSelector: '.value-picker-item',
      valueAttribute: 'data-value',
      // Nothing is selectable while the lock is on, so the highlight stays put
      // and Enter refuses — exactly as the click handler does.
      disabled: this._lockedByAnyValue,
    });
  }

  private _scrollToHighlighted() {
    this.updateComplete.then(() =>
      scrollHighlightedIntoView(this.shadowRoot, '.value-picker-item.highlighted'),
    );
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
    const lockedByAnyValue = this._lockedByAnyValue;
    // Clamped: selecting a value drops it from the list, so a highlight parked
    // on the last entry would otherwise point past the end and leave
    // `aria-activedescendant` referencing an id that is no longer rendered.
    const activeIndex = this._highlightIndex < filteredValues.length ? this._highlightIndex : -1;

    return html`
      <div class="value-picker" style="top:${this.triggerTop}px;left:${this.triggerLeft}px">
        <input
          class="value-picker-input"
          type="text"
          placeholder="Search values..."
          aria-label="Search values"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-controls="value-picker-list"
          aria-activedescendant=${activeIndex >= 0 ? `value-picker-option-${activeIndex}` : nothing}
          .value=${this._searchQuery}
          @input=${this._handleSearch}
          @keydown=${this._handleKeydown}
        />
        <div class="value-picker-list" id="value-picker-list" role="listbox" aria-label="Values">
          ${filteredValues.map(({ value, count }, index) => {
            const isHighlighted = index === activeIndex;
            return html`
              <div
                id="value-picker-option-${index}"
                class="dropdown-item value-picker-item ${lockedByAnyValue
                  ? 'is-disabled'
                  : ''} ${isHighlighted ? 'highlighted' : ''}"
                role="option"
                data-value=${value}
                aria-disabled=${lockedByAnyValue ? 'true' : 'false'}
                aria-selected=${isHighlighted ? 'true' : 'false'}
                @click=${() => {
                  if (!lockedByAnyValue) this._selectValue(value);
                }}
              >
                <span>${this._highlightMatch(displayFilterValue(value))}</span>
                <span class="value-picker-count">${count}</span>
              </div>
            `;
          })}
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
