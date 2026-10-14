import {
  html,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import { pushLayer } from '../kit/layers';
import '../kit/tooltip';
import type { PsTooltip } from '../kit/tooltip';
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
 * and Down move it, and Escape, through the layer stack, puts it back. The legend holds the items;
 * this holds the picked row, the snapshot Escape restores and the reorder's layer.
 */
export class LegendKeyboardController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: LegendKeyboardOptions;
  private _picked: string | null = null;
  private _snapshot: LegendReorderSnapshot | null = null;
  /** Releases the reorder's layer; set while a row is picked up. */
  private _releaseLayer: (() => void) | null = null;
  private _focusValue: string | null = null;
  /** The row holding the Tab stop, worked out once per item list and focus value. */
  private _stop: {
    items: readonly LegendItem[];
    focus: string | null;
    value: string | null;
  } | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: LegendKeyboardOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row picked up for a keyboard reorder, or null. */
  get pickedValue(): string | null {
    return this._picked;
  }

  /**
   * The row with the list's one Tab stop, kept by value so a re-sort keeps it on the same
   * category. The legend sets it when focus enters a row; null means the first row.
   */
  get focusValue(): string | null {
    return this._focusValue;
  }

  set focusValue(value: string | null) {
    if (value === this._focusValue) return;
    this._focusValue = value;
    this.host.requestUpdate();
  }

  /** Whether a row holds the Tab stop: the focused row while it is listed, else the first row. */
  isTabbable(value: string): boolean {
    const items = this.options.getSortedItems();
    if (this._stop?.items !== items || this._stop.focus !== this._focusValue) {
      const kept =
        this._focusValue !== null && items.some((item) => item.value === this._focusValue);
      this._stop = {
        items,
        focus: this._focusValue,
        value: kept ? this._focusValue : (items[0]?.value ?? null),
      };
    }
    return this._stop.value === value;
  }

  hostDisconnected(): void {
    this._releaseLayer?.();
    this._releaseLayer = null;
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
    this._releaseLayer?.();
    this._releaseLayer = null;
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
    // Escape cancels the reorder through the page's one layer stack (decision 11), after any menu
    // or picker opened over it; a press elsewhere leaves the row picked up. cancel() puts the row
    // back, refocuses its handle and, through the legend's restore, releases the layer.
    this._releaseLayer ??= pushLayer({
      close: () => this.cancel(),
      elements: [this.host],
      dismissOnOutsidePress: false,
    });
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

/** A row name that ends in an ellipsis shows in full this long after the pointer reaches it. */
export const NAME_TOOLTIP_DELAY_MS = 500;

/** A finger that moves this far before its long press ends is scrolling: no name shows. */
const LONG_PRESS_SLOP_PX = 10;

/** The click a lifted long press makes arrives within this; a later click is the next tap. */
const LONG_PRESS_CLICK_MS = 600;

/** A finger or pen held on a row's name. */
interface NamePress {
  button: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  shown: boolean;
}

const preventDefault = (event: Event) => event.preventDefault();

/** Swallows the click a lifted long press makes, so showing a name never toggles its row. */
function swallowNextClick(button: HTMLElement): void {
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  button.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(
    () => button.removeEventListener('click', swallow, { capture: true }),
    LONG_PRESS_CLICK_MS,
  );
}

/**
 * One shared tooltip for row names that end in an ellipsis: after NAME_TOOLTIP_DELAY_MS of mouse
 * or pen hover on a row's main button, or of a finger held on it, it shows the full name; a name
 * that fits shows nothing. Keyboard and screen-reader
 * users already get the full name from the button's accessible name, so the tooltip names nothing
 * (`names-target`). The element is driven directly, never through the legend's template, so a
 * hover never re-renders the legend.
 */
export class TruncatedNameTooltip implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _trigger: HTMLElement | null = null;
  private _press: NamePress | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.host = host;
    host.addController(this);
  }

  /** A row's main button `pointerenter` handler: hovers the button's `.legend-text`. */
  onNamePointerEnter = (e: PointerEvent): void => {
    // A finger has no hover; on touch a long press shows the name (onNamePointerDown).
    if (e.pointerType === 'touch') return;
    const button = e.currentTarget as HTMLElement;
    const text = button.querySelector<HTMLElement>('.legend-text');
    if (text) this.hover(button, text);
  };

  /**
   * A row's main button `pointerdown` handler. A finger or pen held NAME_TOOLTIP_DELAY_MS on a name
   * that ends in an ellipsis shows it in full until it lifts, and the click that lift makes does not
   * toggle the row. Moving LONG_PRESS_SLOP_PX first (a scroll), or a cancel, shows nothing.
   */
  onNamePointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this._endPress();
    const button = e.currentTarget as HTMLElement;
    const textEl = button.querySelector<HTMLElement>('.legend-text');
    if (!textEl || textEl.scrollWidth <= textEl.clientWidth) return;
    // A pen that hovered first: its hover timer gives way to the press.
    this.leave();
    const text = textEl.textContent?.trim() ?? '';
    const press: NamePress = {
      button,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: null,
      shown: false,
    };
    press.timer = setTimeout(() => {
      press.timer = null;
      press.shown = true;
      this._trigger = button;
      void this._show(button, text);
    }, NAME_TOOLTIP_DELAY_MS);
    this._press = press;
    button.addEventListener('pointermove', this._onPressMove);
    button.addEventListener('pointerup', this._onPressEnd);
    button.addEventListener('pointercancel', this._onPressEnd);
    button.addEventListener('contextmenu', preventDefault);
  };

  hover(trigger: HTMLElement, textEl: HTMLElement): void {
    this.leave();
    if (textEl.scrollWidth <= textEl.clientWidth) return;
    this._trigger = trigger;
    trigger.addEventListener('pointerleave', this._onLeave);
    const text = textEl.textContent?.trim() ?? '';
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._show(trigger, text);
    }, NAME_TOOLTIP_DELAY_MS);
  }

  leave(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    this._trigger?.removeEventListener('pointerleave', this._onLeave);
    this._trigger = null;
    const tooltip = this._tooltip();
    if (!tooltip) return;
    tooltip.hide();
    // Empty text shows nothing: the tooltip stays bound to its last row, whose focus must not show it.
    tooltip.text = '';
  }

  hostDisconnected(): void {
    this._endPress();
    this.leave();
  }

  render(): TemplateResult {
    return html`<ps-tooltip class="name-tooltip" names-target placement="top"></ps-tooltip>`;
  }

  private _onLeave = (): void => this.leave();

  private _onPressMove = (e: PointerEvent): void => {
    const press = this._press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX) this._endPress();
  };

  private _onPressEnd = (e: PointerEvent): void => {
    const press = this._press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (press.shown && e.type === 'pointerup') swallowNextClick(press.button);
    this._endPress();
  };

  /** Ends a long press on a name: its timer, its listeners and the name it showed. */
  private _endPress(): void {
    const press = this._press;
    if (!press) return;
    this._press = null;
    if (press.timer !== null) clearTimeout(press.timer);
    press.button.removeEventListener('pointermove', this._onPressMove);
    press.button.removeEventListener('pointerup', this._onPressEnd);
    press.button.removeEventListener('pointercancel', this._onPressEnd);
    press.button.removeEventListener('contextmenu', preventDefault);
    if (press.shown) this.leave();
  }

  private async _show(trigger: HTMLElement, text: string): Promise<void> {
    const tooltip = this._tooltip();
    if (!tooltip || this._trigger !== trigger || !text) return;
    tooltip.anchor = trigger;
    tooltip.text = text;
    // The tooltip binds to its new anchor in its own update; show() needs that target.
    await tooltip.updateComplete;
    if (this._trigger === trigger) tooltip.show();
  }

  private _tooltip(): PsTooltip | null {
    return this.host.shadowRoot?.querySelector<PsTooltip>('ps-tooltip.name-tooltip') ?? null;
  }
}
