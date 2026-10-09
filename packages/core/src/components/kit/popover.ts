import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { deepActiveElement, flatContains } from './focus';
import { pushLayer } from './layers';
import { popoverStyles } from './popover.styles';
import { anchorTo, type Placement } from './position';

/**
 * An anchored panel in the top layer. The owner sets `open`; the popover closes itself on Escape
 * or an outside press and then dispatches `ps-close`.
 */
@customElement('ps-popover')
export class PsPopover extends LitElement {
  static styles = popoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property() placement: Placement = 'bottom-start';
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: 'panel-role' }) panelRole = 'dialog';
  @property({ attribute: 'panel-label' }) panelLabel = '';

  @query('.panel') private panel!: HTMLElement;
  private releaseLayer?: () => void;
  private stopPositioning?: () => void;
  private returnFocusTo: HTMLElement | null = null;
  private announcedOpen = false;

  render() {
    return html`<div
      class="panel"
      part="panel"
      popover="manual"
      role=${this.panelRole}
      aria-label=${this.panelLabel || nothing}
    >
      <slot></slot>
    </div>`;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // A keyed re-render moves the node (disconnect, then connect), and the disconnect hid the
    // panel; update so updated() shows it again.
    if (this.hasUpdated && this.open) this.requestUpdate();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (!this.open) {
      if (changed.has('open')) this.hide();
    } else if (!this.releaseLayer) {
      // Newly opened, moved while open, or the anchor arrived after `open`.
      this.show();
    } else if (changed.has('anchor') || changed.has('placement')) {
      // Re-anchored while open (a re-render replaced the trigger): follow the new anchor.
      this.stopPositioning?.();
      this.stopPositioning = this.anchor
        ? anchorTo(this.anchor, this.panel, this.placement)
        : undefined;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown();
  }

  /** Closes the popover and tells the owner. */
  dismiss(): void {
    if (!this.open) return;
    this.open = false;
    // Release the layer now, not at the next update, so the next Escape reaches the layer below.
    this.hide();
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  }

  private show(): void {
    if (!this.anchor || this.releaseLayer || !this.isConnected) return;
    const active = deepActiveElement();
    // Safari does not focus a clicked button; with nothing focused, return focus to the anchor.
    this.returnFocusTo = active && active !== document.body ? active : (this.anchor as HTMLElement);
    this.panel.showPopover();
    this.stopPositioning = anchorTo(this.anchor, this.panel, this.placement);
    // Read at each press, so a replaced anchor still counts as inside.
    const elements = (): Element[] => (this.anchor ? [this, this.anchor] : [this]);
    this.releaseLayer = pushLayer({
      close: () => this.dismiss(),
      get elements() {
        return elements();
      },
    });
    // A move while open shows the panel again but is not a new opening.
    if (this.announcedOpen) return;
    this.announcedOpen = true;
    this.dispatchEvent(new CustomEvent('ps-open', { bubbles: true, composed: true }));
  }

  private hide(): void {
    this.announcedOpen = false;
    if (!this.releaseLayer) return;
    const focusWasInside = this.containsFocus();
    this.teardown();
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (!focusWasInside) return;
    if (target?.isConnected) target.focus();
    else (deepActiveElement() ?? document.body).blur();
  }

  private teardown(): void {
    this.stopPositioning?.();
    this.stopPositioning = undefined;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (this.panel?.matches(':popover-open')) this.panel.hidePopover();
  }

  // Slotted content (a menu's items) is not a DOM child of the popover, so test the flat tree.
  private containsFocus(): boolean {
    return flatContains(this, deepActiveElement());
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-popover': PsPopover;
  }
}
