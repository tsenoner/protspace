import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { icon } from './icon';
import { menuItemStyles, menuLabelStyles, menuStyles } from './menu.styles';
import './popover';
import type { Placement } from './position';

export type MenuItemType = 'item' | 'checkbox' | 'radio';

const TYPEAHEAD_RESET_MS = 500;

/** One entry of a ps-menu. */
@customElement('ps-menu-item')
export class PsMenuItem extends LitElement {
  static styles = menuItemStyles;

  @property() value = '';
  @property() type: MenuItemType = 'item';
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
  }

  protected willUpdate(): void {
    const role =
      this.type === 'checkbox'
        ? 'menuitemcheckbox'
        : this.type === 'radio'
          ? 'menuitemradio'
          : 'menuitem';
    this.setAttribute('role', role);
    if (this.type === 'item') this.removeAttribute('aria-checked');
    else this.setAttribute('aria-checked', String(this.checked));
    if (this.disabled) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');
  }

  render() {
    return html`<span class="mark"
        >${this.type !== 'item' && this.checked ? icon('check', 14) : nothing}</span
      >
      <span class="label"><slot></slot></span>
      <slot name="end"></slot>`;
  }
}

/** A caption above a group of items. */
@customElement('ps-menu-label')
export class PsMenuLabel extends LitElement {
  static styles = menuLabelStyles;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'presentation');
  }

  render() {
    return html`<slot></slot>`;
  }
}

/** A menu in a ps-popover: arrow keys, Home and End, type-ahead, optional search. */
@customElement('ps-menu')
export class PsMenu extends LitElement {
  static styles = menuStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() placement: Placement = 'bottom-start';
  @property() label = '';
  @property({ type: Boolean }) searchable = false;
  @property({ attribute: 'search-placeholder' }) searchPlaceholder = 'Search';

  @state() private query = '';
  @query('input') private searchInput?: HTMLInputElement;
  private typed = '';
  private typedTimer = 0;

  constructor() {
    super();
    this.addEventListener('keydown', this.onKeydown);
    this.addEventListener('click', this.onClick);
  }

  private get items(): PsMenuItem[] {
    return [...this.querySelectorAll('ps-menu-item')];
  }

  private get navigable(): PsMenuItem[] {
    return this.items.filter((item) => !item.disabled && !item.hidden);
  }

  render() {
    const noMatches = this.searchable && this.query.trim() !== '' && this.navigable.length === 0;
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement=${this.placement}
      panel-role=${this.searchable ? 'dialog' : 'none'}
      panel-label=${this.label}
      @ps-open=${this.onOpen}
      @ps-close=${this.onPopoverClose}
    >
      ${this.searchable
        ? html`<div class="search">
            ${icon('search', 14)}
            <input
              type="search"
              .value=${this.query}
              placeholder=${this.searchPlaceholder}
              aria-label=${this.searchPlaceholder}
              @input=${this.onSearch}
            />
          </div>`
        : nothing}
      <div class="items" role="menu" aria-label=${this.label}><slot></slot></div>
      ${noMatches ? html`<p class="empty">No matches</p>` : nothing}
    </ps-popover>`;
  }

  private onOpen = (event: Event) => {
    event.stopPropagation();
    this.query = '';
    this.applyFilter();
    queueMicrotask(() => {
      if (this.searchable) this.searchInput?.focus();
      else this.focusItem(this.items.find((i) => i.checked && !i.disabled) ?? this.navigable[0]);
    });
  };

  private onPopoverClose = (event: Event) => {
    event.stopPropagation();
    this.close();
  };

  private close(): void {
    this.open = false;
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  }

  private onSearch = (event: Event) => {
    this.query = (event.target as HTMLInputElement).value;
    this.applyFilter();
  };

  private applyFilter(): void {
    const q = this.query.trim().toLowerCase();
    for (const item of this.items)
      item.hidden = q !== '' && !(item.textContent ?? '').toLowerCase().includes(q);
    for (const label of this.querySelectorAll('ps-menu-label')) label.hidden = q !== '';
    this.requestUpdate();
  }

  private focusItem(item: PsMenuItem | undefined): void {
    for (const each of this.items) each.tabIndex = each === item ? 0 : -1;
    item?.focus();
  }

  private onKeydown = (event: KeyboardEvent) => {
    const items = this.navigable;
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as PsMenuItem);
    const last = items.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(items[current < 0 || current === last ? 0 : current + 1]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(items[current <= 0 ? last : current - 1]);
        return;
      case 'Home':
      case 'End':
        if (current < 0) return;
        event.preventDefault();
        this.focusItem(items[event.key === 'Home' ? 0 : last]);
        return;
      case 'Enter':
      case ' ':
        if (current < 0) return;
        event.preventDefault();
        this.activate(items[current]);
        return;
      default:
        if (
          current >= 0 &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          this.typeAhead(event.key, items, current);
        }
    }
  };

  private typeAhead(char: string, items: PsMenuItem[], current: number): void {
    clearTimeout(this.typedTimer);
    this.typed += char.toLowerCase();
    this.typedTimer = window.setTimeout(() => (this.typed = ''), TYPEAHEAD_RESET_MS);
    const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
    const match = ordered.find((item) =>
      (item.textContent ?? '').trim().toLowerCase().startsWith(this.typed),
    );
    if (match) this.focusItem(match);
  }

  private onClick = (event: Event) => {
    const item = (event.target as Element).closest?.('ps-menu-item');
    if (item && !item.disabled && this.contains(item)) this.activate(item);
  };

  private activate(item: PsMenuItem): void {
    if (item.type === 'checkbox') item.checked = !item.checked;
    else if (item.type === 'radio')
      for (const each of this.items) if (each.type === 'radio') each.checked = each === item;
    this.dispatchEvent(
      new CustomEvent('ps-select', {
        bubbles: true,
        composed: true,
        detail: { value: item.value, checked: item.checked },
      }),
    );
    if (item.type !== 'checkbox') this.close();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-menu': PsMenu;
    'ps-menu-item': PsMenuItem;
    'ps-menu-label': PsMenuLabel;
  }
}
