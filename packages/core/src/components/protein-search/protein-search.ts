import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { isMacOrIos } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import { handleDropdownEscape, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import '../kit/button';
import { icon } from '../kit/icon';
import { pushLayer } from '../kit/layers';
import { searchStyles } from './protein-search.styles';
import { parsePastedIds, resolveProteinIds } from './resolve-ids';
import {
  copyAnnouncement,
  renderSearchReport,
  reportSummary,
  type CopyState,
  type SearchReport,
} from './search-report';
import { computeSearchSuggestions, type SearchSuggestion } from './search-suggestions';

const SEARCH_DEBOUNCE_MS = 120;
/** How long Copy missing IDs shows "Copied" or "Could not copy" before its label returns. */
const COPY_FEEDBACK_MS = 2000;

/**
 * `aria-activedescendant` needs a stable id per row so assistive tech can announce the
 * keyboard cursor. `aria-selected` is left to mean what it means in a multi-selectable
 * listbox — "this protein is in the selection" — rather than doubling as the cursor.
 */
const SUGGESTIONS_LIST_ID = 'protein-search-suggestions';
const REPORT_ID = 'protein-search-report';
const NO_MATCHES = 'No matching protein IDs found';
const suggestionRowId = (index: number) => `${SUGGESTIONS_LIST_ID}-${index}`;

type AddSource = 'typed' | 'suggestion';

/**
 * Protein search (design decision 15): suggestions while typing, a pasted list of IDs, and a
 * report of what happened — an unknown ID, an ID already selected, a pasted list with missing IDs,
 * or a pick hidden in the current view. It writes nothing to the plot: the host listens for its
 * events.
 */
@customElement('protspace-protein-search')
export class ProtspaceProteinSearch extends LitElement {
  static styles = searchStyles;

  @property({ type: Array }) availableProteinIds: string[] = [];
  @property({ type: Array }) selectedProteinIds: string[] = [];

  @state() private searchQuery: string = '';
  @state() private searchSuggestions: SearchSuggestion[] = [];
  @state() private highlightedSuggestionIndex: number = -1;
  @state() private isInputFocused: boolean = false;
  @state() private isSuggestionDropdownOpen: boolean = false;
  /** What the last Enter, paste or hidden pick came to; shown in the popup in place of the list. */
  @state() private _report: SearchReport | null = null;
  /** The outcome of the last Copy missing IDs, shown on the button for a moment. */
  @state() private _copyState: CopyState = 'idle';

  private _suggestionDebounceId: ReturnType<typeof setTimeout> | null = null;
  private _blurTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _copyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /** Releases the popup's layer; set while the list or the report is on screen. */
  private _releaseLayer?: () => void;
  private _layerFor: 'suggestions' | 'report' | null = null;

  /** True exactly when `render()` emits the listbox that the combobox ARIA refers to. */
  private get _isListboxRendered(): boolean {
    return !this._report && this.isSuggestionDropdownOpen && this.searchSuggestions.length > 0;
  }

  /**
   * True whenever `render()` emits a popup at all — the listbox, the no-match message or the
   * report. Without a report, `aria-expanded` tracks this: a combobox whose popup is on screen
   * must report itself expanded. The report is not a listbox, which is all a combobox may
   * control, so it describes the field instead.
   */
  private get _isPopupRendered(): boolean {
    return (
      this._report !== null ||
      this._isListboxRendered ||
      (this.isSuggestionDropdownOpen && this.searchQuery.trim().length > 0)
    );
  }

  render() {
    const expanded = !this._report && this._isPopupRendered;
    // Always rendered and holding one sentence, so a screen reader announces each report and the
    // no-match message (a live region inserted together with its text often goes unheard).
    const noMatches = !this._report && !this._isListboxRendered && this._isPopupRendered;
    const announcement = this._report
      ? copyAnnouncement(this._copyState) || reportSummary(this._report)
      : noMatches
        ? NO_MATCHES
        : '';
    return html`
      <div class="search-container">
        <div class="search-chips" @click=${this._focusSearchInput}>
          <span class="search-icon" aria-hidden="true">${icon('search', 14)}</span>
          <input
            id="protein-search-input"
            class="search-input"
            type="text"
            .value=${this.searchQuery}
            placeholder="Search proteins or paste IDs"
            aria-label="Search proteins"
            aria-keyshortcuts="Control+K Meta+K"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded=${expanded}
            aria-controls=${expanded ? SUGGESTIONS_LIST_ID : nothing}
            aria-describedby=${this._report ? REPORT_ID : nothing}
            aria-activedescendant=${!this._report && this.highlightedSuggestionIndex >= 0
              ? suggestionRowId(this.highlightedSuggestionIndex)
              : nothing}
            @input=${this._onSearchInput}
            @keydown=${this._onSearchKeydown}
            @blur=${this._onInputBlur}
            @focus=${this._onInputFocus}
            @paste=${this._onPaste}
          />

          <div class="search-keyboard-shortcut-hint" aria-hidden="true">
            <kbd>${isMacOrIos() ? html`⌘K` : html`^K`}</kbd>
          </div>
        </div>

        ${this._renderPopup()}
        <p class="search-live sr-only" role="status">${announcement}</p>
      </div>
    `;
  }

  /**
   * The report, the listbox, the no-match message, or nothing. The list is a scroll container,
   * which Chrome makes a Tab stop; `tabindex="-1"` keeps focus in the input (the combobox
   * pattern: `aria-activedescendant` moves instead).
   */
  private _renderPopup() {
    if (this._report) {
      return html`<div class="search-popup" id=${REPORT_ID} @focusout=${this._onReportFocusOut}>
        ${renderSearchReport(this._report, () => void this._copyMissing(), this._copyState)}
      </div>`;
    }
    if (this._isListboxRendered) {
      return html`
        <div
          class="search-suggestions"
          id=${SUGGESTIONS_LIST_ID}
          role="listbox"
          aria-multiselectable="true"
          tabindex="-1"
        >
          ${this.searchSuggestions.map((suggestion, i) => this._renderSuggestion(suggestion, i))}
        </div>
      `;
    }
    if (this._isPopupRendered) {
      // Same id and role as the listbox branch: `aria-controls` has to name whichever popup
      // is on screen, and a combobox's controlled popup has to *be* one — an empty listbox
      // is valid, a bare div is not. Only one of the two branches ever renders.
      return html`
        <div class="search-suggestions" id=${SUGGESTIONS_LIST_ID} role="listbox" tabindex="-1">
          <div class="no-results" aria-hidden="true">${NO_MATCHES}</div>
        </div>
      `;
    }
    return nothing;
  }

  private _renderSuggestion(suggestion: SearchSuggestion, index: number) {
    return html`
      <div
        class="search-suggestion ${index === this.highlightedSuggestionIndex
          ? 'active'
          : ''} ${suggestion.isSelected ? 'selected' : ''}"
        id=${suggestionRowId(index)}
        role="option"
        aria-selected=${suggestion.isSelected}
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
    `;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleBodyKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleBodyKeydown);
    this._clearSuggestionDebounce();
    this._clearBlurTimeout();
    this._clearCopyFeedback();
    this._releaseLayer?.();
    this._releaseLayer = undefined;
    this._layerFor = null;
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    // A new report (or none) starts with Copy's own label. `_report` is private, which
    // `PropertyValues<this>` cannot name.
    if ((changed as Map<string, unknown>).has('_report')) this._clearCopyFeedback();
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
  // field like `highlightedSuggestionIndex` needs the untyped `Map<string, unknown>` form.
  protected updated(changed: Map<string, unknown>): void {
    this._syncLayer();
    // `.search-suggestions` is a fixed-height (max-height: 20rem) scroll container fitting
    // ~8 rows, so past that arrow-key navigation would run off screen (issue #413).
    if (!changed.has('highlightedSuggestionIndex')) return;
    if (this.highlightedSuggestionIndex < 0) return;
    scrollHighlightedIntoView(this.shadowRoot, '.search-suggestion.active');
  }

  /**
   * While a popup shows it is a layer, so Escape closes it before the page clears the selection
   * (one step per press). The suggestion list closes and resets the search, and leaves outside
   * presses to the input's blur, as before; the report closes on its own, keeps the typed text,
   * and closes on a press outside too.
   */
  private _syncLayer(): void {
    const want = this._report ? 'report' : this._isPopupRendered ? 'suggestions' : null;
    if (want === this._layerFor) return;
    this._releaseLayer?.();
    this._releaseLayer = undefined;
    this._layerFor = want;
    if (want === 'report') {
      this._releaseLayer = pushLayer({
        close: () => this._dismissReport(),
        elements: [this],
      });
    } else if (want === 'suggestions') {
      this._releaseLayer = pushLayer({
        close: () => this._resetSearch(),
        elements: [this],
        dismissOnOutsidePress: false,
      });
    }
  }

  private _handleBodyKeydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this._focusSearchInput();
    }
  };

  /**
   * Bound to `.search-chips` — the input's own row — and deliberately not to
   * `.search-container`. The popup is absolutely positioned but is still a child of the
   * container, so a container-level handler would refocus the input on every suggestion click.
   * In the 200ms blur grace window the input is not focused, so that refocus fires
   * `_onInputFocus` and reopens the dropdown against the query a click-add just cleared.
   */
  private _focusSearchInput() {
    const input = this.shadowRoot?.querySelector(
      '#protein-search-input',
    ) as HTMLInputElement | null;
    input?.focus();
  }

  private _onPaste(e: ClipboardEvent) {
    const pastedText = e.clipboardData?.getData('text/plain') ?? '';
    const tokens = parsePastedIds(pastedText);

    if (tokens.length > 1 || pastedText.includes('\n')) {
      e.preventDefault();
      if (tokens.length > 0) this._addMultipleSelections(tokens);
    }
  }

  private _onSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.searchQuery = target.value;
    this._report = null;
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
        this._addSelection(this.searchQuery.trim(), 'typed');
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
    } else if (event.key === 'Escape' && (this.searchQuery || this._isPopupRendered)) {
      // The layer normally takes Escape first; this covers a typed query whose list has not
      // opened yet. With nothing to close, Escape passes on to clear the selection.
      handleDropdownEscape(event, () => this._resetSearch());
    }
  }

  private _onInputFocus() {
    this.isInputFocused = true;
    this._clearSuggestionDebounce();
    this._clearBlurTimeout();
    this._updateSuggestions();
  }

  private _onInputBlur() {
    this.isInputFocused = false;
    this._clearSuggestionDebounce();
    // Delay clearing suggestions to allow mousedown to fire on suggestions; a report keeps
    // showing while focus is on its Copy button.
    this._blurTimeoutId = setTimeout(() => {
      this._blurTimeoutId = null;
      this._closeDropdown();
      if (!this._reportHasFocus()) this._report = null;
    }, 200);
  }

  /** Focus left the report for somewhere other than this search: the report goes. */
  private _onReportFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && (this.shadowRoot?.contains(next) || this.contains(next))) return;
    this._report = null;
  };

  private _reportHasFocus(): boolean {
    const active = this.shadowRoot?.activeElement;
    return !!active?.closest('.search-popup');
  }

  /** Closing the report takes its Copy button along, so focus on it goes back to the field. */
  private _dismissReport() {
    const hadFocus = this._reportHasFocus();
    this._report = null;
    if (!hadFocus) return;
    this._focusSearchInput();
    // Focusing the field opens its list; after Escape it stays closed.
    this._closeDropdown();
  }

  /** Copies every missing ID and says so on the button; a refusal leaves the list to copy by hand. */
  private async _copyMissing() {
    const report = this._report;
    if (report?.kind !== 'bulk') return;
    let outcome: CopyState = 'failed';
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(report.missing.join('\n'));
        outcome = 'copied';
      }
    } catch {
      // The browser refused the clipboard.
    }
    if (this._report !== report) return;
    this._clearCopyFeedback();
    this._copyState = outcome;
    this._copyTimeoutId = setTimeout(() => {
      this._copyTimeoutId = null;
      this._copyState = 'idle';
    }, COPY_FEEDBACK_MS);
  }

  private _clearCopyFeedback() {
    if (this._copyTimeoutId !== null) {
      clearTimeout(this._copyTimeoutId);
      this._copyTimeoutId = null;
    }
    this._copyState = 'idle';
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
    if (preserveHighlight) {
      this.highlightedSuggestionIndex = Math.min(previousIndex, this.searchSuggestions.length - 1);
      return;
    }
    // Seed row 0 only for a typed query, where Enter plainly means "take this match".
    // On a bare focus the list is the *current selection* plus arbitrary head-of-dataset
    // entries, and row 0 is usually a marked row — seeding it there would make a reflexive
    // Enter (or a screen reader following `aria-activedescendant`) silently REMOVE a
    // protein the user never pointed at. Arrow keys still start at row 0 from -1.
    this.highlightedSuggestionIndex = this.searchQuery.trim() ? 0 : -1;
  }

  private _activateSuggestion(suggestion: SearchSuggestion) {
    if (suggestion.isSelected) {
      this._removeSelection(suggestion.id);
    } else {
      this._addSelection(suggestion.id, 'suggestion');
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

  /**
   * The dataset's own spelling of `id`, or `undefined` when it names no protein.
   *
   * Exact hit first — that is the path every suggestion activation takes, and `includes`
   * stops at the match. Only a miss (a hand-typed ID in the wrong case, or one that is not
   * in the dataset at all) pays for the case-insensitive sweep, and `id.toLowerCase()` is
   * hoisted out of the predicate: inside it, a value that never changes was recomputed once
   * per available protein — 573K throwaway strings per keystroke-committing Enter.
   */
  private _canonicalProteinId(id: string): string | undefined {
    if (this.availableProteinIds.includes(id)) return id;
    const lowerId = id.toLowerCase();
    return this.availableProteinIds.find((p) => p.toLowerCase() === lowerId);
  }

  private _addSelection(id: string, source: AddSource) {
    if (!id) return;

    const validId = this._canonicalProteinId(id);
    // Nothing to add: say why, and keep the text so it can be corrected.
    if (!validId || this.selectedProteinIds.includes(validId)) {
      this._clearSuggestionDebounce();
      this._closeDropdown();
      this._report = validId
        ? { kind: 'already-selected', id: validId }
        : { kind: 'missing-one', id };
      return;
    }

    this._resetSearch();
    this._report = null;

    this.dispatchEvent(
      new CustomEvent('add-selection', {
        detail: { proteinId: validId, source },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _addMultipleSelections(tokens: string[]) {
    const { found, alreadySelected, missing } = resolveProteinIds(
      tokens,
      this.availableProteinIds,
      this.selectedProteinIds,
    );

    this._resetSearch();

    if (found.length > 0) {
      this.dispatchEvent(
        new CustomEvent('add-selection-multiple', {
          detail: { proteinIds: found, missing },
          bubbles: true,
          composed: true,
        }),
      );
    }

    // All found and new: the selection bar carries the result, so no report.
    this._report =
      missing.length > 0 || alreadySelected.length > 0
        ? {
            kind: 'bulk',
            found: found.length + alreadySelected.length,
            total: tokens.length,
            missing,
          }
        : null;
  }

  /**
   * Public API: the host could not show `proteinId` after selecting it (the filter, an
   * isolation or a hidden category keeps it out of view), so the search says so.
   */
  public reportNotInView(proteinId: string): void {
    this._closeDropdown();
    this._report = { kind: 'not-in-view', id: proteinId };
  }

  /**
   * Public API: Clear all selections
   */
  /**
   * Public API: focuses the text input without scrolling, as ⌘K does. The app's phone bar calls
   * it after it shows the field over the bar.
   */
  public focusInput(): void {
    this.shadowRoot
      ?.querySelector<HTMLInputElement>('#protein-search-input')
      ?.focus({ preventScroll: true });
  }

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
