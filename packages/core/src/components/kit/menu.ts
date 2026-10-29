import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { deepActiveElement } from './focus';
import { icon } from './icon';
import { menuGroupStyles, menuItemStyles, menuLabelStyles, menuStyles } from './menu.styles';
import './popover';
import type { PsPopover } from './popover';
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

  constructor() {
    super();
    // Arrow keys skip a disabled item, so a press must not focus it either.
    this.addEventListener('mousedown', (event) => {
      if (this.disabled) event.preventDefault();
    });
  }

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
    return html`<span class="row"
      ><span class="mark"
        >${this.type !== 'item' && this.checked ? icon('check', 14) : nothing}</span
      >
      <span class="label"><slot></slot><slot name="description"></slot></span>
      <slot name="end"></slot
    ></span>`;
  }
}

/** A caption above items that are not in a ps-menu-group. Assistive technology skips it. */
@customElement('ps-menu-label')
export class PsMenuLabel extends LitElement {
  static styles = menuLabelStyles;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'presentation');
  }

  render() {
    return html`<span class="caption"><slot></slot></span>`;
  }
}

/**
 * Related items under a caption. Assistive technology gets a group named by the caption. Radio
 * items stay exclusive across the whole menu, not per group.
 */
@customElement('ps-menu-group')
export class PsMenuGroup extends LitElement {
  static styles = menuGroupStyles;

  @property() label = '';

  protected willUpdate(): void {
    this.setAttribute('role', 'group');
    if (this.label) this.setAttribute('aria-label', this.label);
    else this.removeAttribute('aria-label');
  }

  render() {
    // The host's aria-label names the group; the caption is for the eye only.
    return html`${this.label
        ? html`<div class="caption" aria-hidden="true">${this.label}</div>`
        : nothing}<slot></slot>`;
  }
}

/**
 * A menu in a ps-popover: arrow keys, Home and End, type-ahead, optional search. It sets
 * `aria-haspopup` and `aria-expanded` on its anchor. Choosing an item closes the menu first
 * (`ps-close`, focus back on the anchor), then dispatches `ps-select`; a checkbox item keeps it open.
 */
@customElement('ps-menu')
export class PsMenu extends LitElement {
  static styles = menuStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() placement: Placement = 'bottom-start';
  @property() label = '';
  @property({ type: Boolean }) searchable = false;
  @property({ attribute: 'search-placeholder' }) searchPlaceholder = 'Search';
  /** On a phone, open as a bottom sheet titled with `label` (ps-popover's `sheet`). */
  @property({ type: Boolean }) sheet = false;

  @state() private query = '';
  @query('input') private searchInput?: HTMLInputElement;
  @query('ps-popover') private popoverEl?: PsPopover;
  /** The anchor this menu marked, with the attribute values it had before. */
  private marked?: { el: Element; hasPopup: string | null; expanded: string | null };
  /** What the search filter hid, so clearing it never unhides what the owner hid. */
  private filteredOut = new WeakSet<HTMLElement>();
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
    // closest() also catches an item inside a hidden ps-menu-group.
    return this.items.filter((item) => !item.disabled && !item.closest('[hidden]'));
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.markAnchor();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unmarkAnchor();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('anchor') || changed.has('open') || changed.has('searchable'))
      this.markAnchor();
  }

  private markAnchor(): void {
    const anchor = this.anchor;
    if (this.marked?.el !== anchor) {
      this.unmarkAnchor();
      if (anchor)
        this.marked = {
          el: anchor,
          hasPopup: anchor.getAttribute('aria-haspopup'),
          expanded: anchor.getAttribute('aria-expanded'),
        };
    }
    // A searchable menu's panel is a dialog holding the search field and the menu.
    anchor?.setAttribute('aria-haspopup', this.searchable ? 'dialog' : 'menu');
    anchor?.setAttribute('aria-expanded', String(this.open));
  }

  private unmarkAnchor(): void {
    if (!this.marked) return;
    const { el, hasPopup, expanded } = this.marked;
    this.marked = undefined;
    const restore = (name: string, value: string | null) =>
      value === null ? el.removeAttribute(name) : el.setAttribute(name, value);
    restore('aria-haspopup', hasPopup);
    restore('aria-expanded', expanded);
  }

  render() {
    const noMatches = this.searchable && this.query.trim() !== '' && this.navigable.length === 0;
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement=${this.placement}
      panel-role=${this.searchable ? 'dialog' : 'none'}
      panel-label=${this.searchable ? this.label : ''}
      ?sheet=${this.sheet}
      @ps-open=${this.onOpen}
      @ps-close=${this.onPopoverClose}
    >
      ${this.sheet && this.label
        ? html`<p class="sheet-title" aria-hidden="true">${this.label}</p>`
        : nothing}
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
      <div class="items" role="menu" aria-label=${this.label || nothing}><slot></slot></div>
      ${this.searchable
        ? html`<p class="empty" role="status">${noMatches ? 'No matches' : ''}</p>`
        : nothing}
    </ps-popover>`;
  }

  private onOpen = (event: Event) => {
    event.stopPropagation();
    this.query = '';
    this.applyFilter();
    queueMicrotask(() => {
      if (this.searchable) this.searchInput?.focus();
      // The checked radio is where the user is; a checked checkbox is a setting, not a position.
      else
        this.focusItem(
          this.navigable.find((i) => i.type === 'radio' && i.checked) ?? this.navigable[0],
        );
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
    const filter = (el: HTMLElement, out: boolean) => {
      if (out && !el.hidden) {
        el.hidden = true;
        this.filteredOut.add(el);
      } else if (!out && this.filteredOut.delete(el)) {
        el.hidden = false;
      }
    };
    for (const item of this.items)
      filter(item, q !== '' && !(item.textContent ?? '').toLowerCase().includes(q));
    for (const label of this.querySelectorAll('ps-menu-label')) filter(label, q !== '');
    // After the items: a group hides when the search left none of its items visible.
    for (const group of this.querySelectorAll('ps-menu-group'))
      filter(
        group,
        q !== '' && ![...group.querySelectorAll('ps-menu-item')].some((item) => !item.hidden),
      );
    this.requestUpdate();
  }

  private focusItem(item: PsMenuItem | undefined): void {
    for (const each of this.items) each.tabIndex = each === item ? 0 : -1;
    item?.focus();
  }

  private onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      // The ARIA menu pattern closes on Tab. dismiss() puts focus back on the anchor, so the
      // browser's Tab moves on from there. Shift+Tab from an item back to the search field stays.
      const backToSearch =
        event.shiftKey && this.searchable && deepActiveElement() !== this.searchInput;
      if (!backToSearch) this.popoverEl?.dismiss();
      return;
    }
    const items = this.navigable;
    if (items.length === 0) return;
    // Items live in the menu's own tree, which is a shadow root when a feature element renders
    // the menu (the view bar's pickers); document.activeElement would name that element instead.
    const focused = (this.getRootNode() as Document | ShadowRoot).activeElement;
    const current = items.indexOf(focused as PsMenuItem);
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
    if (item.type !== 'checkbox') {
      // Close first: dismiss() refocuses the anchor now and ends in close() through ps-close. A
      // dialog the owner opens from ps-select then returns focus to the anchor, not a hidden item.
      this.popoverEl?.dismiss();
      if (this.open) this.close();
    }
    this.dispatchEvent(
      new CustomEvent('ps-select', {
        bubbles: true,
        composed: true,
        detail: { value: item.value, checked: item.checked },
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-menu': PsMenu;
    'ps-menu-item': PsMenuItem;
    'ps-menu-label': PsMenuLabel;
    'ps-menu-group': PsMenuGroup;
  }
}
