import { html, type ReactiveControllerHost, type TemplateResult } from 'lit';
import './legend-other-popover';
import type { OtherItem } from './types';

const VIEW_BUTTON = '.legend-item-other .view-button';

/** What the Other popover reads from the legend and asks it to do. */
interface OtherControlOptions {
  getItems(): readonly OtherItem[];
  /** Moves one category out of Other; the popover stays open. */
  add(value: string): void;
  /** Moves every category out of Other and closes the popover. */
  addAll(): void;
  /** Focuses the first row's main button. */
  focusFirstRow(): void;
}

/**
 * The legend's half of the Other popover (`protspace-legend-other-popover`): which View button it
 * hangs from, opening and closing, and where focus goes when Other empties. Not a registered
 * controller, like `LegendRowMenu`: the legend calls `willUpdate` and `updated` from its own.
 */
export class OtherPopoverControl {
  private host: ReactiveControllerHost & HTMLElement;
  private options: OtherControlOptions;
  /** The Other row's View button while the popover is open under it; null when closed. */
  private _anchor: HTMLElement | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: OtherControlOptions) {
    this.host = host;
    this.options = options;
  }

  get anchor(): HTMLElement | null {
    return this._anchor;
  }

  get isOpen(): boolean {
    return this._anchor !== null;
  }

  /** Opens the popover under `anchor`. */
  show(anchor: HTMLElement): void {
    if (this._anchor === anchor) return;
    this._anchor = anchor;
    this.host.requestUpdate();
  }

  close(): void {
    if (this._anchor === null) return;
    this._anchor = null;
    this.host.requestUpdate();
  }

  /** The View button opens the popover under it, and closes it again. */
  toggle(event: Event): void {
    event.stopPropagation();
    if (this.isOpen) {
      this.close();
      return;
    }
    const trigger =
      (event.currentTarget as HTMLElement | null) ??
      this.host.shadowRoot?.querySelector<HTMLElement>(VIEW_BUTTON);
    if (trigger) this.show(trigger);
  }

  /**
   * From the legend's `willUpdate`. The last category left Other: the popover has nothing to list
   * and its View button goes with the row, so it closes and focus moves to the list, not the page.
   * A new annotation lists other categories, so the popover closes then too.
   */
  willUpdate(otherItemsChanged: boolean, annotationChanged: boolean): void {
    if (!this.isOpen) return;
    if (annotationChanged) {
      this.close();
    } else if (otherItemsChanged && this.options.getItems().length === 0) {
      this.close();
      void this._focusFirstRowWhenSettled();
    }
  }

  /**
   * From the legend's `updated`. Rows render by position, so an add re-creates the Other row and
   * its View button: keep the open popover anchored to the button on screen.
   */
  updated(): void {
    // A detached legend's own buttons are detached too: following them would update forever.
    if (!this._anchor || this._anchor.isConnected || !this.host.isConnected) return;
    const next = this.host.shadowRoot?.querySelector<HTMLElement>(VIEW_BUTTON) ?? null;
    if (next === this._anchor) return;
    this._anchor = next;
    this.host.requestUpdate();
  }

  render(): TemplateResult {
    return html`<protspace-legend-other-popover
      .anchor=${this._anchor}
      .open=${this.isOpen}
      .items=${this.options.getItems()}
      @other-add=${this._onAdd}
      @other-add-all=${this._onAddAll}
      @ps-close=${this._onClose}
    ></protspace-legend-other-popover>`;
  }

  private _onAdd = (event: Event): void => {
    this.options.add((event as CustomEvent<{ value: string }>).detail.value);
  };

  private _onAddAll = (): void => {
    this.options.addAll();
    void this._focusFirstRowWhenSettled();
  };

  private _onClose = (event: Event): void => {
    event.stopPropagation();
    this.close();
  };

  /** Focuses the first row once the rows have re-rendered (an add takes several passes). */
  private async _focusFirstRowWhenSettled(): Promise<void> {
    for (let i = 0; i < 10 && !(await this.host.updateComplete); i++);
    this.options.focusFirstRow();
  }
}
