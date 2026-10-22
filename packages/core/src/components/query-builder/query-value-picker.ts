import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, state, query as litQuery } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import type { ProtspaceData } from './types';
import { ANY_VALUE } from './query-types';
import { toInternalValue } from '../legend/config';
import { resolveAnnotationInternalValues } from './query-evaluate';
import { annotationLabel, formatCount, isNAValue } from '@protspace/utils';
import { displayFilterValue } from './query-presence';
import { queryBuilderStyles } from './query-builder.styles';
import { icon } from '../kit/icon';
import type { PsPopover } from '../kit/popover';
import '../kit/popover';
import '../kit/button';
import '../kit/segmented';

/** One walk over the proteins a condition's values are counted among (see `_buildCountMap`). */
interface CountMapResult {
  counts: Map<string, number>;
  /** How many proteins were walked: the base every count is a share of. */
  size: number;
  /** Some protein carries more than one value, so per-value counts overlap. */
  multiLabel: boolean;
}

interface Entry {
  value: string;
  label: string;
  lower: string;
  count: number;
}

type Sort = 'count' | 'az';

/** A row or a section heading; every line of the list has the same height. */
type Line = { head: string } | { entry: Entry; index: number };

/**
 * A line's height: 36 px, or 44 px under a coarse pointer so each row is a finger-sized target.
 * Keep in step with `.value-picker-item` / `.value-picker-section` in the styles.
 */
const lineHeight = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 44 : 36;
/** Lines drawn above and below the visible window. */
const OVERSCAN = 8;
/** More than the list's tallest box, so the drawn window always covers it. */
const VIEWPORT = 480;

const isSentinel = (value: string) => value === ANY_VALUE || isNAValue(value);
const isSentinelLine = (line: Line | undefined) =>
  !!line && 'entry' in line && isSentinel(line.entry.value);
const isValueLine = (line: Line | undefined) =>
  !!line && 'entry' in line && !isSentinel(line.entry.value);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The checkbox value list for a categorical condition, in a popover anchored to the card's
 * "+ value" button: search, Count / A–Z sort, Select all / Clear for the search, the selected
 * values first, each value's count with a bar for its share of the proteins counted (see
 * `_buildCountMap`). Rows are virtualised.
 *
 * Events:
 * - `value-selected` — a value was ticked, detail: `{ value: string }`
 * - `values-change`  — an untick, Select all or Clear, detail: `{ values: string[] }` (the new list)
 * - `picker-close`   — Done, Escape or a press outside
 */
@customElement('protspace-query-value-picker')
class ProtspaceQueryValuePicker extends LitElement {
  static styles = queryBuilderStyles;

  @property({ type: String }) annotation: string = '';
  @property({ type: Object }) data: ProtspaceData | undefined = undefined;
  /**
   * The proteins the values are counted among; null is the whole dataset, undefined not known yet
   * (the builder's count is pending): the rows then show a placeholder for their counts, no bars,
   * and sort A–Z until the counts land. The query builder works it out from where the card sits
   * (see its `countBases`).
   */
  @property({ attribute: false }) matchedIndices: Set<number> | null | undefined = undefined;
  @property({ type: Array }) selectedValues: string[] = [];
  @property({ type: Boolean }) open: boolean = false;
  /** The "+ value" button the popover hangs from. */
  @property({ attribute: false }) anchor: Element | null = null;

  @state() private _searchQuery: string = '';
  /** Index into the navigable rows (selected section, then the rest), or -1. */
  @state() private _highlightIndex: number = -1;
  @state() private _sort: Sort = 'count';
  @state() private _scrollTop = 0;
  /**
   * The values shown in the Selected section: the selection when the list opened or the search
   * last changed. A tick or untick leaves rows where they are instead of moving them under the
   * pointer.
   */
  @state() private _pinned: ReadonlySet<string> = new Set();

  @litQuery('.value-picker-input') private _inputEl?: HTMLInputElement;
  @litQuery('.value-picker-list') private _listEl?: HTMLElement;
  @litQuery('ps-popover') private _popoverEl?: PsPopover;

  /**
   * Memoized count map. `_buildCountMap` walks up to the entire dataset, and render runs on every keystroke and scroll. Invalidated in
   * `willUpdate` from the inputs the counts actually depend on; `matchedIndices`
   * is compared by reference, which holds because the query builder hands down a
   * freshly built Set on every evaluation rather than mutating one in place.
   */
  private _countCache: CountMapResult | null = null;
  /** Every value with its count, sorted; rebuilt with the counts or the sort. */
  private _entryCache: { entries: Entry[]; real: number } | null = null;
  /** The search applied to `_entryCache`, split by `_pinned`. */
  private _viewCache: {
    key: string;
    pinned: ReadonlySet<string>;
    from: Entry[];
    pinnedRows: Entry[];
    rest: Entry[];
  } | null = null;
  /**
   * The rows' order at the first tick since the list opened or its search or sort changed. Counts
   * that arrive after a tick (the builder re-evaluates) update in place instead of re-sorting the
   * rows under the pointer.
   */
  private _frozenOrder: Map<string, number> | null = null;
  /** The selection's union count, for multi-label annotations only (see `_selectionCount`). */
  private _unionCache: { key: string; count: number } | null = null;

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('data') || changed.has('annotation') || changed.has('matchedIndices')) {
      this._countCache = null;
      this._entryCache = null;
      this._unionCache = null;
    }
    // Opening and closing both start the next visit from a clean slate. Reset here rather than
    // in `updated()`, so the reset does not schedule a second render.
    if (changed.has('open')) {
      this._highlightIndex = -1;
      this._searchQuery = '';
      this._scrollTop = 0;
      this._pinned = new Set(this.selectedValues);
      this._frozenOrder = null;
    }
  }

  updated(changed: PropertyValues<this>) {
    if (changed.has('open') && this.open) {
      // The popover shows itself in its own update; focus the search once it is in the top layer.
      // A phone's sheet focuses its title instead, so the keyboard does not cover the list.
      void (this._popoverEl?.updateComplete ?? Promise.resolve()).then(() =>
        this._popoverEl?.hasAttribute('docked')
          ? this.renderRoot.querySelector<HTMLElement>('.value-picker-title')?.focus()
          : this._inputEl?.focus(),
      );
    }
    const list = this._listEl;
    if (list && Math.abs(list.scrollTop - this._scrollTop) > 1) list.scrollTop = this._scrollTop;
  }

  // ─── Counts ───────────────────────────────────────────────────────────────

  /**
   * Each value's count is the proteins carrying it among the ones this condition picks from
   * (`matchedIndices`, or the whole dataset when null). A multi-label protein counts once toward each distinct value
   * it carries, as query-evaluate matches. `ANY_VALUE` counts the proteins with at least one
   * non-N/A label, as evaluateCondition() resolves it. `size` is how many proteins were walked,
   * so a count over `size` is the value's share and every row's bar has the same base.
   */
  private _buildCountMap(): CountMapResult {
    const counts = new Map<string, number>();
    let anyCount = 0;
    let size = 0;
    let multiLabel = false;
    if (!this.data || !this.annotation) return { counts, size, multiLabel };
    const total = this.data.protein_ids?.length ?? 0;

    const countProtein = (idx: number) => {
      if (!(idx >= 0 && idx < total)) return;
      size++;
      const resolved = resolveAnnotationInternalValues(idx, this.annotation, this.data!);
      if (resolved.length > 1) multiLabel = true;
      let hasReal = false;
      for (const internal of resolved) {
        counts.set(internal, (counts.get(internal) ?? 0) + 1);
        if (!isNAValue(internal)) hasReal = true;
      }
      if (hasReal) anyCount++;
    };

    const base = this.matchedIndices;
    if (base === null) {
      for (let i = 0; i < total; i++) countProtein(i);
    } else if (base) {
      for (const idx of base) countProtein(idx);
    }

    counts.set(ANY_VALUE, anyCount);
    return { counts, size, multiLabel };
  }

  private _counts() {
    return (this._countCache ??= this._buildCountMap());
  }

  /** The count base is not known yet (see `matchedIndices`). */
  private get _pending(): boolean {
    return this.matchedIndices === undefined;
  }

  /** The proteins carrying any of the selected values, among the same proteins as the rows. */
  private _selectionCount(selected: readonly string[]): number {
    if (selected.length === 0) return 0;
    const { counts, multiLabel } = this._counts();
    if (selected.includes(ANY_VALUE)) return counts.get(ANY_VALUE) ?? 0;
    if (!multiLabel) return selected.reduce((sum, v) => sum + (counts.get(v) ?? 0), 0);
    const key = [...selected].sort().join('\u0000');
    if (this._unionCache?.key !== key) {
      this._unionCache = { key, count: this._walkSelection(selected) };
    }
    return this._unionCache.count;
  }

  /** The union for a multi-label annotation, where per-value counts overlap. */
  private _walkSelection(selected: readonly string[]): number {
    const data = this.data;
    if (!data) return 0;
    const total = data.protein_ids?.length ?? 0;
    const set = new Set(selected);
    const hit = (idx: number) =>
      idx >= 0 &&
      idx < total &&
      resolveAnnotationInternalValues(idx, this.annotation, data).some((v) => set.has(v));
    let n = 0;
    const base = this.matchedIndices;
    if (base === null) {
      for (let i = 0; i < total; i++) if (hit(i)) n++;
    } else if (base) {
      for (const idx of base) if (hit(idx)) n++;
    }
    return n;
  }

  // ─── The list ─────────────────────────────────────────────────────────────

  /**
   * Every value once, `toInternalValue`-normalised, sorted. "Any value" and N/A lead: they are
   * presence sentinels rather than declared values.
   */
  private _entries() {
    if (this._entryCache) return this._entryCache;
    const meta = this.data?.annotations?.[this.annotation];
    const seen = new Set<string>();
    const sentinels: Entry[] = [];
    const real: Entry[] = [];
    const add = (value: string) => {
      if (seen.has(value)) return;
      seen.add(value);
      const label = displayFilterValue(value);
      const entry = {
        value,
        label,
        lower: label.toLowerCase(),
        count: this._counts().counts.get(value) ?? 0,
      };
      (isSentinel(value) ? sentinels : real).push(entry);
    };
    if (meta) {
      add(ANY_VALUE);
      for (const raw of meta.values) add(toInternalValue(raw));
    }
    const frozen = this._frozenOrder;
    if (frozen) {
      const rank = (e: Entry) => frozen.get(e.value) ?? Number.MAX_SAFE_INTEGER;
      real.sort((a, b) => rank(a) - rank(b));
    } else if (this._sort === 'count' && !this._pending) {
      real.sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
    } else {
      real.sort((a, b) => collator.compare(a.label, b.label));
    }
    this._entryCache = { entries: [...sentinels, ...real], real: real.length };
    this._viewCache = null;
    return this._entryCache;
  }

  /** The entries matching the search, the pinned ones first. */
  private _view() {
    const { entries } = this._entries();
    const key = this._searchQuery.trim().toLowerCase();
    const cached = this._viewCache;
    if (cached && cached.key === key && cached.pinned === this._pinned && cached.from === entries) {
      return cached;
    }
    const pinnedRows: Entry[] = [];
    const rest: Entry[] = [];
    for (const e of entries) {
      if (key && !e.lower.includes(key)) continue;
      (this._pinned.has(e.value) ? pinnedRows : rest).push(e);
    }
    this._viewCache = { key, pinned: this._pinned, from: entries, pinnedRows, rest };
    return this._viewCache;
  }

  private _rows(): Entry[] {
    const { pinnedRows, rest } = this._view();
    return pinnedRows.length ? [...pinnedRows, ...rest] : rest;
  }

  private _lines(): Line[] {
    const { pinnedRows, rest } = this._view();
    if (!pinnedRows.length) return rest.map((entry, index) => ({ entry, index }));
    const lines: Line[] = [{ head: `Selected · ${pinnedRows.length}` }];
    pinnedRows.forEach((entry, index) => lines.push({ entry, index }));
    if (rest.length) lines.push({ head: 'All values' });
    rest.forEach((entry, i) => lines.push({ entry, index: pinnedRows.length + i }));
    return lines;
  }

  /**
   * True while `ANY_VALUE` is selected: every other entry is then locked out
   * (it subsumes them) and neither the pointer nor the keyboard may tick one.
   */
  private get _lockedByAnyValue(): boolean {
    return this.selectedValues.includes(ANY_VALUE);
  }

  private _isLocked(value: string): boolean {
    return this._lockedByAnyValue && value !== ANY_VALUE;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private _close() {
    this.dispatchEvent(new CustomEvent('picker-close', { bubbles: true, composed: true }));
  }

  /** Keeps the rows where they are from now on (see `_frozenOrder`). */
  private _freezeOrder() {
    if (this._frozenOrder) return;
    this._frozenOrder = new Map(this._entries().entries.map((e, i) => [e.value, i]));
  }

  private _handleSearch(e: Event) {
    if (this._frozenOrder) {
      // Re-sort by the current counts; without a freeze the cached order already is that.
      this._frozenOrder = null;
      this._entryCache = null;
    }
    this._searchQuery = (e.target as HTMLInputElement).value;
    this._highlightIndex = -1; // The old highlight indexes into the old list.
    this._scrollTop = 0;
    this._pinned = new Set(this.selectedValues);
  }

  private _handleScroll(e: Event) {
    this._scrollTop = (e.target as HTMLElement).scrollTop;
  }

  private _handleKeydown(e: KeyboardEvent) {
    const rows = this._rows();
    /** The nearest row from `to` in direction `step` that is not locked out. */
    const move = (to: number, step: 1 | -1) => {
      e.preventDefault();
      let i = Math.max(0, Math.min(rows.length - 1, to));
      while (i >= 0 && i < rows.length && this._isLocked(rows[i].value)) i += step;
      if (i < 0 || i >= rows.length) {
        // Nothing unlocked that way: look back the other way from the edge.
        for (i = to - step; i >= 0 && i < rows.length && this._isLocked(rows[i].value); i -= step);
      }
      if (i >= 0 && i < rows.length && !this._isLocked(rows[i].value)) this._highlight(i);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(this._highlightIndex + 1, 1);
      case 'ArrowUp':
        return move(this._highlightIndex < 0 ? 0 : this._highlightIndex - 1, -1);
      case 'PageDown':
        return move(this._highlightIndex + 8, 1);
      case 'PageUp':
        return move(this._highlightIndex - 8, -1);
      case 'Enter': {
        e.preventDefault();
        const row = rows[this._highlightIndex];
        if (row) this._toggle(row.value);
        return;
      }
      case ' ': {
        // Space types into the search until the arrows move into the list.
        const row = rows[this._highlightIndex];
        if (!row) return;
        e.preventDefault();
        this._toggle(row.value);
        return;
      }
      case 'Escape':
        // Reached only without the popover's layer (it takes Escape first); stop the enclosing
        // dialog closing too.
        e.preventDefault();
        e.stopPropagation();
        this._close();
        return;
    }
  }

  /** Moves the keyboard cursor and scrolls its line into the drawn window. */
  private _highlight(index: number) {
    this._highlightIndex = index;
    const { pinnedRows } = this._view();
    // Lines before the row: a heading above the pinned rows, one more above the rest.
    const heads = pinnedRows.length ? (index < pinnedRows.length ? 1 : 2) : 0;
    const line = lineHeight();
    const top = (index + heads) * line;
    const height = this._listEl?.clientHeight || VIEWPORT;
    if (top < this._scrollTop) this._scrollTop = index === 0 ? 0 : top;
    else if (top + line > this._scrollTop + height) this._scrollTop = top + line - height;
  }

  private _toggle(value: string) {
    if (this._isLocked(value)) return;
    this._freezeOrder();
    if (this.selectedValues.includes(value)) {
      this._emitValues(this.selectedValues.filter((v) => v !== value));
    } else {
      this.dispatchEvent(
        new CustomEvent('value-selected', { detail: { value }, bubbles: true, composed: true }),
      );
    }
    // Do NOT close — the list stays open for several picks.
  }

  private _emitValues(values: string[]) {
    this.dispatchEvent(
      new CustomEvent('values-change', { detail: { values }, bubbles: true, composed: true }),
    );
  }

  /** Ticks every real value the search shows. One event, however many values. */
  private _selectAll() {
    if (this._lockedByAnyValue) return;
    this._freezeOrder();
    const selected = new Set(this.selectedValues);
    const added = this._rows()
      .map((e) => e.value)
      .filter((v) => !selected.has(v) && !isNAValue(v) && v !== ANY_VALUE);
    if (added.length) this._emitValues([...this.selectedValues, ...added]);
  }

  /** Unticks every value the search shows. */
  private _clear() {
    this._freezeOrder();
    const shown = new Set(this._rows().map((e) => e.value));
    const values = this.selectedValues.filter((v) => !shown.has(v));
    if (values.length !== this.selectedValues.length) this._emitValues(values);
  }

  private _handleSort(e: CustomEvent<{ value: string }>) {
    e.stopPropagation();
    this._sort = e.detail.value as Sort;
    this._frozenOrder = null;
    this._entryCache = null;
    this._highlightIndex = -1;
    this._scrollTop = 0;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  /**
   * Return a Lit template that wraps matched characters in `<strong class="value-picker-highlight">`.
   */
  private _highlightMatch(text: string) {
    const queryLower = this._searchQuery.trim().toLowerCase();
    const idx = queryLower ? text.toLowerCase().indexOf(queryLower) : -1;
    if (idx === -1) return html`${text}`;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + queryLower.length);
    const after = text.slice(idx + queryLower.length);
    return html`${before}<strong class="value-picker-highlight">${match}</strong>${after}`;
  }

  /**
   * `base` is how many proteins the counts are taken among, so a bar is its value's share of
   * them. "Any value" has none: it always covers every protein with a value, so its bar would be
   * full by definition and only compete with the real ones. It and N/A sit above a rule, apart
   * from the values themselves; `divider` draws it under the last of them.
   */
  private _renderLine(
    line: Line,
    top: number,
    selected: Set<string>,
    base: number,
    divider: boolean,
  ) {
    const style = `top:${top}px`;
    if ('head' in line) {
      return html`<div class="value-picker-section" role="presentation" style=${style}>
        ${line.head}
      </div>`;
    }
    const { entry, index } = line;
    const checked = selected.has(entry.value);
    const locked = this._isLocked(entry.value);
    const any = entry.value === ANY_VALUE;
    const share = base > 0 ? Math.min(100, (entry.count / base) * 100) : 0;
    const pending = this._pending;
    return html`
      <div
        id="value-picker-option-${index}"
        class="value-picker-item ${locked ? 'is-disabled' : ''} ${index === this._highlightIndex
          ? 'highlighted'
          : ''} ${checked ? 'is-checked' : ''} ${divider ? 'has-divider' : ''}"
        role="option"
        style=${style}
        title=${entry.label}
        data-value=${entry.value}
        aria-checked=${checked ? 'true' : 'false'}
        aria-disabled=${locked ? 'true' : 'false'}
        @click=${() => this._toggle(entry.value)}
      >
        <i class="value-picker-check" aria-hidden="true"
          >${checked ? icon('check', 14) : nothing}</i
        >
        <span class="value-picker-label">${this._highlightMatch(entry.label)}</span>
        ${pending
          ? html`<span class="value-picker-count is-pending" aria-hidden="true"></span>`
          : html`<span class="value-picker-count">${formatCount(entry.count)}</span>`}
        <i class="value-picker-bar ${any || pending ? 'is-blank' : ''}" aria-hidden="true"
          >${any || pending || entry.count === 0
            ? nothing
            : html`<b style="width:${share.toFixed(2)}%"></b>`}</i
        >
      </div>
    `;
  }

  render() {
    const name = this.annotation
      ? `${annotationLabel(this.annotation, this.data?.annotations?.[this.annotation])} values`
      : 'Values';
    return html`<ps-popover
      .anchor=${this.anchor}
      placement="bottom-start"
      .open=${this.open}
      sheet
      panel-label=${name}
      @ps-close=${(e: Event) => {
        e.stopPropagation();
        this._close();
      }}
      >${this.open ? this._renderBody(name) : nothing}</ps-popover
    >`;
  }

  /** `name` titles the list when it opens as a phone's bottom sheet. */
  private _renderBody(name: string) {
    const { real } = this._entries();
    const base = this._counts().size;
    const rows = this._rows();
    const lines = this._lines();
    const selected = new Set(this.selectedValues);
    const active = this._highlightIndex < rows.length ? this._highlightIndex : -1;
    const line = lineHeight();
    // A phone's sheet can give the list more than VIEWPORT; draw at least what it shows.
    const shown = Math.max(VIEWPORT, this._listEl?.clientHeight ?? 0);
    const first = Math.max(0, Math.floor(this._scrollTop / line) - OVERSCAN);
    const last = Math.min(lines.length, Math.ceil((this._scrollTop + shown) / line) + OVERSCAN);
    const query = this._searchQuery.trim();
    const n = this.selectedValues.length;

    return html`
      <div class="value-picker">
        <p class="value-picker-title" tabindex="-1">${name}</p>
        <div class="value-picker-search">
          ${icon('search', 14)}
          <input
            class="value-picker-input"
            type="text"
            placeholder="Search ${formatCount(real)} values"
            aria-label="Search values"
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls="value-picker-list"
            aria-activedescendant=${active >= 0 ? `value-picker-option-${active}` : nothing}
            .value=${this._searchQuery}
            @input=${this._handleSearch}
            @keydown=${this._handleKeydown}
          />
        </div>
        <div class="value-picker-tools">
          <ps-segmented
            label="Sort values"
            .options=${[
              { value: 'count', label: 'Count' },
              { value: 'az', label: 'A–Z' },
            ]}
            value=${this._sort}
            @change=${this._handleSort}
          ></ps-segmented>
          <span class="value-picker-tools-gap"></span>
          <ps-button
            variant="ghost"
            size="sm"
            ?disabled=${this._lockedByAnyValue || rows.length === 0}
            @click=${this._selectAll}
            >Select all</ps-button
          >
          <ps-button
            variant="ghost"
            size="sm"
            ?disabled=${n === 0 || rows.length === 0}
            @click=${this._clear}
            >Clear</ps-button
          >
        </div>
        <div
          class="value-picker-list"
          id="value-picker-list"
          role="listbox"
          aria-label=${query ? `Values matching ${query}` : 'Values'}
          aria-multiselectable="true"
          aria-busy=${this._pending ? 'true' : 'false'}
          @scroll=${this._handleScroll}
        >
          <div class="value-picker-spacer" style="height:${lines.length * line}px">
            ${lines
              .slice(first, last)
              .map((entry, i) =>
                this._renderLine(
                  entry,
                  (first + i) * line,
                  selected,
                  base,
                  isSentinelLine(entry) && isValueLine(lines[first + i + 1]),
                ),
              )}
          </div>
          ${rows.length === 0
            ? html`<p class="value-picker-empty">
                ${query ? `No values match “${query}”` : 'No values'}
              </p>`
            : nothing}
        </div>
        <div class="value-picker-footer">
          <span class="value-picker-summary" aria-live="polite"
            >${formatCount(n)}
            selected${n && !this._pending
              ? html` · ${formatCount(this._selectionCount(this.selectedValues))} proteins`
              : nothing}</span
          >
          <ps-button variant="primary" size="sm" @click=${this._close}>Done</ps-button>
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
