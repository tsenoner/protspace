import { html, nothing, type ReactiveControllerHost, type TemplateResult } from 'lit';
import '../kit/menu';
import { LEGEND_VALUES, toDisplayValue } from './config';
import type { LegendItem } from './types';

/** What the row menu reads from the legend and asks it to do. */
interface RowMenuOptions {
  getItems(): readonly LegendItem[];
  isNumeric(): boolean;
  /** "Show only this", or "Show all" when the row is the only one shown. */
  isolate(value: string): void;
  /** "Colour and shape": opens the picker on the row. */
  customize(value: string): void;
}

/**
 * The one "⋯" menu, shared by every row; it hangs from the row that opened it. Not a registered
 * controller: it has no lifecycle of its own, and an open menu survives a DOM move as ps-menu does.
 */
export class LegendRowMenu {
  private host: ReactiveControllerHost;
  private options: RowMenuOptions;
  /** The row whose menu is open, and the button it hangs from. */
  private _open: { value: string; anchor: HTMLElement } | null = null;
  /**
   * The row the menu last opened for. ps-menu closes itself (ps-close) before it dispatches
   * ps-select, so the choice is read from here, not from `_open`.
   */
  private _target: string | null = null;

  constructor(host: ReactiveControllerHost, options: RowMenuOptions) {
    this.host = host;
    this.options = options;
  }

  toggle(value: string, anchor: HTMLElement): void {
    if (this._open?.value === value) {
      this.close();
      return;
    }
    this._target = value;
    this._open = { value, anchor };
    this.host.requestUpdate();
  }

  close(): void {
    if (this._open === null) return;
    this._open = null;
    this.host.requestUpdate();
  }

  render(): TemplateResult {
    const open = this._open;
    const items = this.options.getItems();
    const item = open ? items.find((each) => each.value === open.value) : undefined;
    const label = item ? (item.displayValue ?? toDisplayValue(item.value)) : '';
    const onlyVisible =
      !!item &&
      item.isVisible &&
      items.every((each) => each.isVisible === (each.value === item.value));
    const canCustomize = !!item && item.value !== LEGEND_VALUES.OTHER && !this.options.isNumeric();
    return html`<ps-menu
      class="row-menu"
      label=${item ? `Actions for ${label}` : 'Row actions'}
      placement="bottom-end"
      .anchor=${open?.anchor ?? null}
      .open=${item !== undefined}
      @ps-select=${this._onSelect}
      @ps-close=${this._onClose}
    >
      <ps-menu-item value="isolate">${onlyVisible ? 'Show all' : 'Show only this'}</ps-menu-item>
      ${canCustomize
        ? html`<ps-menu-item value="customize">Colour and shape</ps-menu-item>`
        : nothing}
    </ps-menu>`;
  }

  private _onClose = (event: Event): void => {
    event.stopPropagation();
    this.close();
  };

  private _onSelect = (event: CustomEvent<{ value: string }>): void => {
    event.stopPropagation();
    const value = this._target;
    this.close();
    if (value === null) return;
    if (event.detail.value === 'isolate') this.options.isolate(value);
    else if (event.detail.value === 'customize') this.options.customize(value);
  };
}
