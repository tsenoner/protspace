import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { handleDropdownEscape, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import { searchStyles } from './search.styles';
import { isMacOrIos } from '@protspace/utils';
import { computeSearchSuggestions, type SearchSuggestion } from './search-suggestions';

const SEARCH_DEBOUNCE_MS = 120;

/**
 * `aria-activedescendant` needs a stable id per row so assistive tech can announce the
 * keyboard cursor. `aria-selected` is left to mean what it means in a multi-selectable
 * listbox — "this protein is in the selection" — rather than doubling as the cursor.
 */
const SUGGESTIONS_LIST_ID = 'protein-search-suggestions';
const suggestionRowId = (index: number) => `${SUGGESTIONS_LIST_ID}-${index}`;

/**
 * Protein search component with autocomplete suggestions and multi-select state (no chips UI)
 */
@customElement('protspace-protein-search')
class ProtspaceProteinSearch extends LitElement {
  static styles = searchStyles;

  @property({ type: Array }) availableProteinIds: string[] = [];
  @property({ type: Array }) selectedProteinIds: string[] = [];

  @state() private searchQuery: string = '';
  @state() private searchSuggestions: SearchSuggestion[] = [];
  @state() private highlightedSuggestionIndex: number = -1;
  @state() private isInputFocused: boolean = false;
  @state() private isSuggestionDropdownOpen: boolean = false;

  private _suggestionDebounceId: ReturnType<typeof setTimeout> | null = null;
  private _blurTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** True exactly when `render()` emits the listbox that the combobox ARIA refers to. */
  private get _isListboxRendered(): boolean {
    return this.isSuggestionDropdownOpen && this.searchSuggestions.length > 0;
  }

  render() {
    return html`
      <div class="search-container">
        <div class="search-chips" @click=${this._focusSearchInput}>
          <input
            id="protein-search-input"
            class="search-input"
            type="text"
            .value=${this.searchQuery}
            placeholder="Search or paste protein IDs"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded=${this._isListboxRendered}
            aria-controls=${this._isListboxRendered ? SUGGESTIONS_LIST_ID : nothing}
            aria-activedescendant=${this.highlightedSuggestionIndex >= 0
              ? suggestionRowId(this.highlightedSuggestionIndex)
              : nothing}
            @input=${this._onSearchInput}
            @keydown=${this._onSearchKeydown}
            @blur=${this._onInputBlur}
            @focus=${this._onInputFocus}
            @paste=${this._onPaste}
          />

          <div class="search-keyboard-shortcut-hint">
            <kbd>${isMacOrIos() ? html`⌘K` : html`^K`}</kbd>
          </div>
        </div>

        ${this.isSuggestionDropdownOpen
          ? this.searchSuggestions.length > 0
            ? html`
                <div
                  class="search-suggestions"
                  id=${SUGGESTIONS_LIST_ID}
                  role="listbox"
                  aria-multiselectable="true"
                >
                  ${this.searchSuggestions.map(
                    (suggestion, i) => html`
                      <div
                        class="search-suggestion ${i === this.highlightedSuggestionIndex
                          ? 'active'
                          : ''} ${suggestion.isSelected ? 'selected' : ''}"
                        id=${suggestionRowId(i)}
                        role="option"
                        aria-selected=${suggestion.isSelected}
                        title=${suggestion.isSelected ? 'Remove from selection' : nothing}
                        aria-label=${suggestion.isSelected
                          ? `${suggestion.id}, remove from selection`
                          : suggestion.id}
                        @mousedown=${(e: Event) => {
                          // Use mousedown to avoid blur before click
                          e.preventDefault();
                          this._activateSuggestion(suggestion);
                        }}
                      >
                        ${suggestion.id}
                      </div>
                    `,
                  )}
                </div>
              `
            : this.searchQuery.trim()
              ? html`
                  <div class="search-suggestions">
                    <div class="no-results">No matching protein IDs found</div>
                  </div>
                `
              : ''
          : ''}
      </div>
    `;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleBodyKeydown);
    // Listen for parent-initiated close. Bound field, not an inline closure: an inline
    // one cannot be removed, so every re-attach of this element would stack another
    // handler and run the close N times.
    this.addEventListener('close-search', this._handleCloseSearch);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleBodyKeydown);
    this.removeEventListener('close-search', this._handleCloseSearch);
    this._clearSuggestionDebounce();
    this._clearBlurTimeout();
  }

  private _handleCloseSearch = () => {
    this._resetSearch();
    this.isInputFocused = false;
    // Blur the input element to sync state
    const input = this.shadowRoot?.querySelector(
      '#protein-search-input',
    ) as HTMLInputElement | null;
    input?.blur();
  };

  protected willUpdate(changed: PropertyValues<this>): void {
    // `searchSuggestions` is computed on a debounce, so a selection change made elsewhere
    // (including this component's own remove, which keeps the query) would otherwise leave
    // the open dropdown stale. Recomputing here cannot loop: it only writes
    // `searchSuggestions`, never `selectedProteinIds`.
    if (!changed.has('selectedProteinIds') && !changed.has('availableProteinIds')) return;
    if (!this.searchQuery.trim() && !this.isInputFocused) return;
    // Result count cannot identify whether the dropdown is closed: an open no-match
    // state also has zero suggestions. Track open state explicitly so dataset changes
    // refresh empty results without reopening after add, Escape, or blur.
    if (!this.isSuggestionDropdownOpen) return;
    this._updateSuggestions(true);
  }

  // `PropertyValues<this>` (as used by `willUpdate` above) types `.has()` against
  // `keyof this`, which TypeScript excludes private members from — so a private @state
  // field like `highlightedSuggestionIndex` needs the untyped `Map<string, unknown>` form
  // instead, matching the convention elsewhere in this package (e.g. scatter-plot.ts,
  // legend.ts, query-numeric-input.ts).
  protected updated(changed: Map<string, unknown>): void {
    // `.search-suggestions` is a fixed-height (max-height: 20rem) scroll container fitting
    // ~8 rows, so past that arrow-key navigation would run off screen (issue #413).
    if (!changed.has('highlightedSuggestionIndex')) return;
    if (this.highlightedSuggestionIndex < 0) return;
    scrollHighlightedIntoView(this.shadowRoot, '.search-suggestion.active');
  }

  private _handleBodyKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this._focusSearchInput();
    }
  };

  /**
   * Bound to `.search-chips` — the input's own row — and deliberately not to
   * `.search-container`. The suggestion list is absolutely positioned but is still a
   * child of the container, so a container-level handler would refocus the input on
   * every suggestion click. In the 200ms blur grace window the input is not focused, so
   * that refocus fires `_onInputFocus` and reopens the dropdown against the query a
   * click-add just cleared — the ~50 unrelated rows this component exists to suppress.
   */
  private _focusSearchInput() {
    const input = this.shadowRoot?.querySelector(
      '#protein-search-input',
    ) as HTMLInputElement | null;
    input?.focus();
  }

  private _onPaste(e: ClipboardEvent) {
    const pastedText = e.clipboardData?.getData('text/plain') ?? '';
    const ids = pastedText.trim().split(/\s+/);

    if (ids.length > 1 || pastedText.includes('\n')) {
      e.preventDefault();
      this._addMultipleSelections(ids.filter(Boolean));
    }
  }

  private _onSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery = target.value;
    // Opening is deliberately left to `_updateSuggestions` on the debounce. Opening here
    // would render the previous close's empty `searchSuggestions` against a non-empty
    // query, i.e. flash `No matching protein IDs found` for SEARCH_DEBOUNCE_MS on the
    // first keystroke after every add, Escape, or blur. While the dropdown is already
    // open it stays open, so continuous typing is unaffected.
    this._clearSuggestionDebounce();
    this._suggestionDebounceId = setTimeout(() => {
      this._suggestionDebounceId = null;
      this._updateSuggestions();
    }, SEARCH_DEBOUNCE_MS);
  }

  private _onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this._flushSuggestions();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (
        this.highlightedSuggestionIndex >= 0 &&
        this.highlightedSuggestionIndex < this.searchSuggestions.length
      ) {
        this._activateSuggestion(this.searchSuggestions[this.highlightedSuggestionIndex]);
      } else if (this.searchQuery.trim()) {
        this._addSelection(this.searchQuery.trim());
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.searchSuggestions.length > 0) {
        const next = Math.min(
          this.highlightedSuggestionIndex + 1,
          this.searchSuggestions.length - 1,
        );
        this.highlightedSuggestionIndex = next;
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.searchSuggestions.length > 0) {
        const prev = Math.max(this.highlightedSuggestionIndex - 1, 0);
        this.highlightedSuggestionIndex = prev;
      }
    } else if (event.key === 'Escape') {
      handleDropdownEscape(event, () => this._resetSearch());
    }
  }

  private _onInputFocus() {
    this.isInputFocused = true;
    this._clearSuggestionDebounce();
    this._clearBlurTimeout();
    this._updateSuggestions();
    // Notify parent to close other dropdowns
    this.dispatchEvent(
      new CustomEvent('search-opened', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onInputBlur() {
    this.isInputFocused = false;
    this._clearSuggestionDebounce();
    // Delay clearing suggestions to allow mousedown to fire on suggestions
    this._blurTimeoutId = setTimeout(() => {
      this._blurTimeoutId = null;
      this._closeDropdown();
    }, 200);
  }

  private _clearSuggestionDebounce() {
    if (this._suggestionDebounceId !== null) {
      clearTimeout(this._suggestionDebounceId);
      this._suggestionDebounceId = null;
    }
  }

  /** Collapse the dropdown, leaving the query intact. */
  private _closeDropdown() {
    this.searchSuggestions = [];
    this.highlightedSuggestionIndex = -1;
    this.isSuggestionDropdownOpen = false;
  }

  /** Close the dropdown and clear the query — the reset every activation path shares. */
  private _resetSearch() {
    this._clearSuggestionDebounce();
    this.searchQuery = '';
    this._closeDropdown();
  }

  private _clearBlurTimeout() {
    if (this._blurTimeoutId !== null) {
      clearTimeout(this._blurTimeoutId);
      this._blurTimeoutId = null;
    }
  }

  private _flushSuggestions() {
    // Only settle a pending debounce. Recomputing when the list is already current
    // resets the highlight to 0, which would make arrow navigation impossible and
    // send Enter to the wrong row.
    if (this._suggestionDebounceId === null) return;
    this._clearSuggestionDebounce();
    this._updateSuggestions();
  }

  private _updateSuggestions(preserveHighlight = false) {
    const previousIndex = this.highlightedSuggestionIndex;
    this.searchSuggestions = computeSearchSuggestions(
      this.availableProteinIds,
      this.selectedProteinIds,
      this.searchQuery,
      this.isInputFocused,
    );
    // Every caller (focus, debounce, flush, and the open-guarded `willUpdate`) is a
    // reason for the list to be showing, and settling the open state here rather than
    // at the keystroke keeps the dropdown and its contents in the same commit.
    this.isSuggestionDropdownOpen = true;

    if (this.searchSuggestions.length === 0) {
      this.highlightedSuggestionIndex = -1;
      return;
    }

    // `Math.min` alone, so a preserved -1 stays -1: an input-driven refresh must not
    // invent a keyboard cursor the user never moved, or Enter would activate a row
    // they never highlighted.
    this.highlightedSuggestionIndex = preserveHighlight
      ? Math.min(previousIndex, this.searchSuggestions.length - 1)
      : 0;
  }

  private _activateSuggestion(suggestion: SearchSuggestion) {
    if (suggestion.isSelected) {
      this._removeSelection(suggestion.id);
    } else {
      this._addSelection(suggestion.id);
    }
  }

  private _removeSelection(id: string) {
    if (!this.selectedProteinIds.includes(id)) return;

    // Deliberately keeps `searchQuery` and the open dropdown so several proteins can be
    // pruned from one result set without retyping. `willUpdate` refreshes the list when
    // the parent echoes the new selection back down.
    this._clearSuggestionDebounce();

    this.dispatchEvent(
      new CustomEvent('remove-selection', {
        detail: { proteinId: id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _addSelection(id: string) {
    if (!id) return;

    // Validate and normalize the ID
    let validId = id;
    if (!this.availableProteinIds.includes(id)) {
      // Try case-insensitive exact match
      const exact = this.availableProteinIds.find((p) => p.toLowerCase() === id.toLowerCase());
      if (exact) {
        validId = exact;
      } else {
        // ID not found in available proteins - ignore
        this._resetSearch();
        return;
      }
    }

    // Check if already selected
    if (this.selectedProteinIds.includes(validId)) {
      this._resetSearch();
      return;
    }

    this._resetSearch();

    // Dispatch selection change event
    this.dispatchEvent(
      new CustomEvent('add-selection', {
        detail: { proteinId: validId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _addMultipleSelections(ids: string[]) {
    const availableIdsSet = new Set(this.availableProteinIds);
    const lowerCaseAvailableMap = new Map<string, string>();
    this.availableProteinIds.forEach((id) => lowerCaseAvailableMap.set(id.toLowerCase(), id));

    const newValidIds = new Set<string>();

    for (const id of ids) {
      if (!id) continue;

      if (availableIdsSet.has(id)) {
        newValidIds.add(id);
      } else {
        const lowerId = id.toLowerCase();
        if (lowerCaseAvailableMap.has(lowerId)) {
          newValidIds.add(lowerCaseAvailableMap.get(lowerId)!);
        }
      }
    }

    const currentSelectedSet = new Set(this.selectedProteinIds);
    const uniqueNewIds = [...newValidIds].filter((id) => !currentSelectedSet.has(id));

    if (uniqueNewIds.length > 0) {
      this.dispatchEvent(
        new CustomEvent('add-selection-multiple', {
          detail: { proteinIds: uniqueNewIds },
          bubbles: true,
          composed: true,
        }),
      );
    }

    this._resetSearch();
  }

  /**
   * Public API: Clear all selections
   */
  public clearSelections() {
    if (this.selectedProteinIds.length > 0) {
      this.selectedProteinIds = [];

      this.dispatchEvent(
        new CustomEvent('selection-change', {
          detail: { proteinIds: [] },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /**
   * Public API: Set selections programmatically
   */
  public setSelections(proteinIds: string[]) {
    const validIds = proteinIds.filter((id) => this.availableProteinIds.includes(id));
    if (JSON.stringify(validIds) !== JSON.stringify(this.selectedProteinIds)) {
      this.selectedProteinIds = validIds;

      this.dispatchEvent(
        new CustomEvent('selection-change', {
          detail: { proteinIds: validIds },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-protein-search': ProtspaceProteinSearch;
  }
}
