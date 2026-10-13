import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { countNoun, formatCount } from '../../utils/count-text';
import '../kit/button';
import '../kit/input';
import '../kit/popover';
import type { PsInput } from '../kit/input';
import type { PsPopover } from '../kit/popover';
import { toDisplayValue } from './config';
import { otherPopoverStyles } from './legend-other-popover.styles';
import type { OtherItem } from './types';

/** The most rows the popover renders; a search narrows the rest (Review Focus 1). */
export const OTHER_POPOVER_ROW_LIMIT = 200;

interface OtherRow {
  readonly value: string;
  readonly name: string;
  /** The lower-cased display name the search matches. */
  readonly key: string;
  readonly count: number;
}

const byCountThenName = (a: OtherRow, b: OtherRow) =>
  b.count - a.count || a.name.localeCompare(b.name);

/**
 * The categories grouped under the legend's Other row, searchable, each with "Add to legend"
 * (design decision 12). The owner sets `anchor`, `open` and `items`, and adds what the events
 * name; the popover stays open across adds.
 *
 * @fires other-add - `{ value }`, the raw value of the category to add (`__NA__` for N/A)
 * @fires other-add-all - every category under Other
 * @fires ps-close - from the inner popover, after Escape or an outside press closed it
 */
@customElement('protspace-legend-other-popover')
export class ProtspaceLegendOtherPopover extends LitElement {
  static styles = otherPopoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) items: readonly OtherItem[] = [];

  @state() private _query = '';
  @query('ps-popover') private _popover?: PsPopover;
  @query('ps-input') private _search?: PsInput;

  private _rowsCache: { items: readonly OtherItem[]; rows: readonly OtherRow[] } | null = null;
  private _matchesCache: {
    rows: readonly OtherRow[];
    query: string;
    matches: readonly OtherRow[];
  } | null = null;
  /** Where the row just added sat, so focus lands on the row that takes its place. */
  private _focusIndexAfterAdd: number | null = null;
  /** A blur from inside the panel left focus nowhere, in this task (see `_onFocusOut`). */
  private _focusDropped = false;

  constructor() {
    super();
    this.addEventListener('focusout', this._onFocusOut);
  }

  /** Moves focus to the search field (once it has rendered). */
  focusSearch(): void {
    const search = this._search;
    if (!search) return;
    void search.updateComplete.then(() => search.focus());
  }

  // The panel opens and closes in the inner popover's update: include it, so an owner that awaits
  // this element's updateComplete sees the panel as it now is.
  protected override async getUpdateComplete(): Promise<boolean> {
    const result = await super.getUpdateComplete();
    await this._popover?.updateComplete;
    return result;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('items') && this._focusIndexAfterAdd !== null) {
      const index = this._focusIndexAfterAdd;
      this._focusIndexAfterAdd = null;
      if (this.open) this._focusRowOrSearch(index);
    }
  }

  render() {
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement="bottom-end"
      panel-role="dialog"
      panel-label="Other categories"
      @ps-open=${this._onOpen}
      @ps-close=${this._onClose}
    >
      ${this.open ? this._renderBody() : nothing}
    </ps-popover>`;
  }

  private _renderBody() {
    const total = this.items.length;
    const matches = this._matches;
    const shown =
      matches.length > OTHER_POPOVER_ROW_LIMIT
        ? matches.slice(0, OTHER_POPOVER_ROW_LIMIT)
        : matches;
    const query = this._query.trim();
    const statusText =
      matches.length > OTHER_POPOVER_ROW_LIMIT
        ? `Showing ${formatCount(OTHER_POPOVER_ROW_LIMIT)} of ${formatCount(matches.length)}. Refine the search.`
        : query && matches.length === 0
          ? `No categories match “${query}”.`
          : '';
    return html`<div class="other-popover">
      <h3 class="other-heading">Other · ${countNoun(total, 'category', 'categories')}</h3>
      <ps-input
        class="other-search"
        type="search"
        label="Search Other categories"
        placeholder="Search"
        .value=${this._query}
        @input=${this._onSearch}
      ></ps-input>
      ${shown.length > 0
        ? html`<ul class="other-list" role="list">
            ${shown.map(
              (row) =>
                html`<li class="other-item">
                  <span class="other-item-name">${row.name}</span>
                  <span class="other-item-count">${formatCount(row.count)}</span>
                  <button
                    type="button"
                    class="other-add"
                    data-value=${row.value}
                    aria-label=${`Add to legend: ${row.name}`}
                    @click=${this._onAddClick}
                  >
                    Add to legend
                  </button>
                </li>`,
            )}
          </ul>`
        : nothing}
      <p class="other-status" role="status">${statusText}</p>
      <div class="other-footer">
        <ps-button
          class="other-add-all"
          size="sm"
          variant="secondary"
          ?disabled=${total === 0}
          @click=${this._onAddAll}
          >Add all (${formatCount(total)})</ps-button
        >
      </div>
    </div>`;
  }

  /** Rows sorted by count, largest first, then by name; rebuilt only when `items` changes. */
  private _rows(): readonly OtherRow[] {
    let cache = this._rowsCache;
    if (!cache || cache.items !== this.items) {
      const rows = this.items.map((item) => {
        const name = toDisplayValue(item.value);
        return { value: item.value, name, key: name.toLowerCase(), count: item.count };
      });
      rows.sort(byCountThenName);
      cache = { items: this.items, rows };
      this._rowsCache = cache;
    }
    return cache.rows;
  }

  /** The rows matching the search, memoised on the items and the query: one filter per query. */
  private get _matches(): readonly OtherRow[] {
    const rows = this._rows();
    const query = this._query.trim().toLowerCase();
    const cached = this._matchesCache;
    if (cached && cached.rows === rows && cached.query === query) return cached.matches;
    const matches = query ? rows.filter((row) => row.key.includes(query)) : rows;
    this._matchesCache = { rows, query, matches };
    return matches;
  }

  private _focusRowOrSearch(index: number): void {
    const buttons = this.renderRoot.querySelectorAll<HTMLButtonElement>('button.other-add');
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else this.focusSearch();
  }

  private _onOpen = () => {
    this._query = '';
    this.focusSearch();
  };

  private _onClose = () => {
    this.open = false;
    // ps-popover returns focus to what had it at open. When an add re-rendered the legend's rows,
    // that View button is gone and focus fell to the page: hand it to the current anchor instead.
    if (this._focusDropped && this.anchor instanceof HTMLElement && this.anchor.isConnected) {
      this.anchor.focus();
    }
  };

  // ps-popover blurs, then dispatches ps-close in the same task; an outside press moves focus in
  // an earlier one. So a drop seen within this task means the close itself lost focus.
  private _onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget !== null) return;
    this._focusDropped = true;
    queueMicrotask(() => {
      this._focusDropped = false;
    });
  };

  private _onSearch = (event: Event) => {
    this._query = (event.currentTarget as PsInput).value;
  };

  private _onAddClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const value = button.dataset.value;
    if (value === undefined) return;
    const buttons = [...this.renderRoot.querySelectorAll('button.other-add')];
    this._focusIndexAfterAdd = buttons.indexOf(button);
    this.dispatchEvent(new CustomEvent('other-add', { detail: { value } }));
  };

  private _onAddAll = () => {
    if (this.items.length === 0) return;
    this.dispatchEvent(new Event('other-add-all'));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend-other-popover': ProtspaceLegendOtherPopover;
  }
}
