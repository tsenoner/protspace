import { LitElement, html, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import './button';
import { dialogStyles } from './dialog.styles';
import { deepActiveElement } from './focus';
import { pushLayer } from './layers';

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex]';

// Safari does not focus a clicked button, so a dialog opened from a click finds focus on the body.
// It then returns focus to the control the last press landed on.
let lastPressed: HTMLElement | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      lastPressed =
        event
          .composedPath()
          .find(
            (node): node is HTMLElement => node instanceof HTMLElement && node.matches(FOCUSABLE),
          ) ?? null;
    },
    true,
  );
}

/**
 * Every kit overlay (dialog, popover) stops `ps-close` at the element around its slot: one from
 * its content is a nested menu or dialog closing, not this overlay. The overlay dispatches its
 * own `ps-close` on the host, outside that element, so its owner still hears it.
 */
const stopNestedClose = (event: Event) => event.stopPropagation();

function focusOrigin(): HTMLElement | null {
  const active = deepActiveElement();
  if (active && active !== document.body) return active;
  return lastPressed?.isConnected ? lastPressed : null;
}

/**
 * A modal window on the native <dialog>: top layer, inert background, focus kept inside. Escape and
 * backdrop presses go through the layer stack, so a menu open inside the dialog closes first.
 */
@customElement('ps-dialog')
export class PsDialog extends LitElement {
  static styles = dialogStyles;

  @property({ type: Boolean, reflect: true }) open = false;
  @property() heading = '';
  @property({ reflect: true }) size: DialogSize = 'md';
  /**
   * A press and release on the backdrop closes the dialog. Defaults to true; `dismissible="false"`
   * in markup, or the property set to false, turns it off.
   */
  @property({ converter: { fromAttribute: (value: string | null) => value !== 'false' } })
  dismissible = true;

  @state() private hasFooter = false;
  @query('dialog') private dialog!: HTMLDialogElement;
  @query('.frame') private frame!: HTMLElement;
  private releaseLayer?: () => void;
  private returnFocusTo: HTMLElement | null = null;
  /** Open from the owner's view: survives a move, which hides and shows the native dialog again. */
  private shown = false;

  render() {
    return html`<dialog
      part="dialog"
      aria-labelledby="heading"
      @cancel=${this.onCancel}
      @close=${this.onNativeClose}
    >
      <div class="frame" tabindex="-1" @ps-close=${stopNestedClose}>
        <header>
          <h2 id="heading">${this.heading}</h2>
          <slot name="header-actions"></slot>
          <ps-icon-button icon="x" label="Close" @click=${this.dismiss}></ps-icon-button>
        </header>
        <div class="body"><slot></slot></div>
        <footer ?hidden=${!this.hasFooter}>
          <slot name="footer" @slotchange=${this.onFooterChange}></slot>
        </footer>
      </div>
    </dialog>`;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // A keyed re-render moves the node (disconnect, then connect), and the disconnect closed the
    // native dialog; update so updated() shows it again.
    if (this.hasUpdated && this.open) this.requestUpdate();
  }

  // Read the footer before rendering, not on the later slotchange: show() focuses an [autofocus]
  // footer button, which a still-hidden footer cannot give focus to.
  protected willUpdate(): void {
    if (this.open) this.hasFooter = this.querySelector(':scope > [slot="footer"]') !== null;
  }

  protected updated(changed: PropertyValues<this>): void {
    if (this.open) this.show();
    else if (changed.has('open')) this.hide();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (!this.releaseLayer) return;
    this.teardown();
    // A move reconnects at once. A removal while open returns focus as a close does.
    queueMicrotask(() => {
      if (this.isConnected || !this.shown) return;
      const active = deepActiveElement();
      if (!active || active === document.body) this.hide();
      this.shown = false;
    });
  }

  /** Closes the dialog and tells the owner. */
  dismiss = (): void => {
    if (!this.open) return;
    this.open = false;
    // Release the layer now, not at the next update, so the next Escape reaches the layer below.
    this.hide();
    this.dispatchEvent(new CustomEvent('ps-close', { bubbles: true, composed: true }));
  };

  private show(): void {
    if (this.releaseLayer || !this.isConnected) return;
    // A move while open shows the dialog again but is not a new opening.
    if (!this.shown) {
      this.shown = true;
      this.returnFocusTo = focusOrigin();
    }
    this.dialog.showModal();
    const dialog = this;
    this.releaseLayer = pushLayer({
      close: this.dismiss,
      elements: [this.frame],
      get dismissOnOutsidePress() {
        return dialog.dismissible;
      },
    });
    this.frame.focus();
    const target = this.querySelector<HTMLElement>('[autofocus]');
    target?.focus();
    // A kit button built with the dialog renders after it, with nothing to delegate focus to yet.
    if (target && !target.matches(':focus') && 'updateComplete' in target) {
      void (target.updateComplete as Promise<unknown>).then(() => {
        if (this.shown && this.shadowRoot!.activeElement === this.frame) target.focus();
      });
    }
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.teardown();
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    if (target?.isConnected) target.focus();
  }

  private teardown(): void {
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (this.dialog?.open) this.dialog.close();
  }

  private onCancel = (event: Event) => {
    event.preventDefault();
    this.dismiss();
  };

  // The browser can close the dialog without asking (a close request it does not let us cancel);
  // follow it, so `open` never stays true while the dialog is hidden.
  private onNativeClose = () => {
    if (this.releaseLayer && !this.dialog.open) this.dismiss();
  };

  private onFooterChange = (event: Event) => {
    this.hasFooter = (event.target as HTMLSlotElement).assignedElements().length > 0;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-dialog': PsDialog;
  }
}
