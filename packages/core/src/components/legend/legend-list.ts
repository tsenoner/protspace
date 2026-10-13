import {
  html,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import { toDisplayValue } from './config';
import type { LegendItem, LegendSortMode, OtherItem } from './types';

/**
 * The rows in display order, or the empty state when there are none. The rows are the list's
 * direct children: Sortable moves them, and `role="listitem"` needs the list as parent.
 */
export function renderLegendList(
  items: readonly LegendItem[],
  renderRow: (item: LegendItem, index: number) => TemplateResult,
): TemplateResult {
  if (items.length === 0) {
    return html`<div class="legend-empty" part="empty">No data available</div>`;
  }

  return html`
    <div class="legend-items" part="items" role="list" aria-label="Legend items">
      ${items.map((item, index) => renderRow(item, index))}
    </div>
  `;
}

/** The legend as a keyboard reorder found it; Escape puts it back. */
export interface LegendReorderSnapshot {
  annotation: string;
  sortMode: LegendSortMode;
  legendItems: LegendItem[];
  otherItems: OtherItem[];
  numericManualOrderIds?: string[];
}

/** What the keyboard model reads from the legend and asks it to do. */
interface LegendKeyboardOptions {
  getSortedItems(): readonly LegendItem[];
  canDrag(item: LegendItem): boolean;
  toggle(value: string): void;
  isolate(value: string): void;
  snapshot(): LegendReorderSnapshot;
  restore(snapshot: LegendReorderSnapshot): void;
  /** Moves a row one place; null when it cannot move. `promoted`: the sort became manual. */
  move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null;
  announce(message: string): void;
  /** The annotation's name as announcements say it. */
  annotationName(): string;
}

/**
 * The legend's keyboard model. On a row: the arrows, Home and End move between rows, Enter and
 * Space toggle, `i` isolates. On a row's handle: Enter or Space picks the row up or drops it, Up
 * and Down move it, Escape puts it back. The legend holds the items; this holds the picked row and
 * the snapshot Escape restores.
 */
export class LegendKeyboardController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: LegendKeyboardOptions;
  private _picked: string | null = null;
  private _snapshot: LegendReorderSnapshot | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: LegendKeyboardOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row picked up for a keyboard reorder, or null. */
  get pickedValue(): string | null {
    return this._picked;
  }

  hostDisconnected(): void {
    this._picked = null;
    this._snapshot = null;
  }

  onItemKeyDown(e: KeyboardEvent, item: LegendItem, index: number): void {
    const last = this.options.getSortedItems().length - 1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        this.focusItem(Math.min(index + 1, last));
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        this.focusItem(Math.max(index - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        this.focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        this.focusItem(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.options.toggle(item.value);
        break;
      case 'i':
      case 'I':
        e.preventDefault();
        this.options.isolate(item.value);
        break;
    }
  }

  onHandleKeyDown(e: KeyboardEvent, item: LegendItem): void {
    if (!this.options.canDrag(item)) return;
    const label = item.displayValue ?? toDisplayValue(item.value);
    switch (e.key) {
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const dropping = this._picked === item.value;
        if (dropping) this.clear();
        else this._pickUp(item.value);
        this.options.announce(dropping ? `Dropped ${label}` : `Picked up ${label} for reordering`);
        break;
      }
      case 'Escape':
        if (this._picked === item.value) {
          e.preventDefault();
          this.cancel();
        }
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (this._picked === item.value) {
          e.preventDefault();
          this._move(item.value, e.key === 'ArrowUp' ? -1 : 1);
        }
        break;
    }
  }

  /** Puts a picked-up row back where it started. False when no row is picked up. */
  cancel(): boolean {
    const picked = this._picked;
    if (picked === null) return false;
    const snapshot = this._snapshot;
    if (snapshot) this.options.restore(snapshot);
    this.clear();
    this.options.announce('Reordering canceled.');
    // The restore re-renders the rows by index, so the focused handle now belongs to another row.
    requestAnimationFrame(() => this.focusHandle(picked));
    return true;
  }

  /** Forgets the picked row and its snapshot, leaving the order as it is. */
  clear(): void {
    this._snapshot = null;
    if (this._picked === null) return;
    this._picked = null;
    this.host.requestUpdate();
  }

  focusItem(index: number): void {
    this.host.shadowRoot?.querySelectorAll<HTMLElement>('.legend-item-main')[index]?.focus();
  }

  focusHandle(value: string): void {
    this.host.shadowRoot
      ?.querySelector<HTMLElement>(`.legend-item[data-value="${CSS.escape(value)}"] .drag-handle`)
      ?.focus();
  }

  private _pickUp(value: string): void {
    this._picked = value;
    this._snapshot = this.options.snapshot();
    this.host.requestUpdate();
  }

  private _move(value: string, direction: -1 | 1): void {
    const result = this.options.move(value, direction);
    if (!result) return;
    const label = result.moved.displayValue ?? toDisplayValue(result.moved.value);
    this.options.announce(
      result.promoted
        ? `Moved ${label}. Switched ${this.options.annotationName()} to Manual order.`
        : `Moved ${label}.`,
    );
    // Lit re-renders the moved row in another slot; focus follows it after the paint.
    requestAnimationFrame(() => this.focusHandle(value));
  }
}
