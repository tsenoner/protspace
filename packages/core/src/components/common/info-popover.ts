import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { icon } from '../kit/icon';
import '../kit/popover';
import type { Placement } from '../kit/position';
import { infoPopoverStyles } from './info-popover.styles';

let infoPopoverSequence = 0;

/** How long the bubble stays after the pointer leaves: enough to cross the gap to it. */
const CLOSE_GRACE_MS = 140;

/**
 * Small reusable "ⓘ" information control that opens a bubble with an annotation description, an
 * optional second paragraph and an optional "Learn more" link.
 *
 * Interaction model:
 * - Opens on **hover** (pointer over the icon) and on **keyboard focus**, so the brief summary is
 *   one hover away while scanning the annotation dropdown.
 * - The bubble is **hoverable**: it stays open while the pointer is over the icon *or* the bubble
 *   (a short grace period bridges the gap between them), so you can move into it to click
 *   "Learn more" without it disappearing.
 * - **Click** toggles a pinned state.
 *
 * The bubble is a `ps-popover` (design decisions 8 and 11): it renders in the top layer, so no
 * panel's `translate`, `overflow` or stacking context clips it, and it is a layer of the kit's
 * layer stack, so Escape and a press outside close it before anything beneath it.
 *
 * The button carries no `title`. A native tooltip would repeat the `aria-label` it was set from,
 * and the browser renders it on its own schedule and in its own place, on top of this bubble.
 *
 * Placement:
 * - `"bottom"` (default) drops the bubble below the icon, used by the legend header; `align="right"`
 *   aligns its right edge to the icon.
 * - `"side"` puts it beside the icon (right, flipping left near the viewport edge), used by the
 *   rows of a list. The whole row (this element's parent) keeps it open, so the pointer can cross
 *   the row towards the bubble. With `beside-row` the bubble sits beside the row itself.
 *
 * Renders nothing when there is neither a description, a detail nor a docs URL.
 */
@customElement('protspace-info-popover')
class ProtspaceInfoPopover extends LitElement {
  static styles = infoPopoverStyles;

  /** Short description text shown in the bubble. */
  @property({ type: String }) description = '';
  /**
   * Optional second paragraph, below the description: the Import menu puts an example's
   * one-line insight here.
   */
  @property({ type: String }) detail = '';
  /** Optional site-relative or absolute documentation URL. */
  @property({ type: String, attribute: 'docs-url' }) docsUrl = '';
  /** Human-readable annotation label, used for accessible button labelling. */
  @property({ type: String }) label = '';
  /** For `placement="bottom"`: `'left'` opens rightward from the icon, `'right'` leftward. */
  @property({ type: String }) align: 'left' | 'right' = 'left';
  /** `'bottom'` drops the bubble below the icon; `'side'` puts it beside the icon. */
  @property({ type: String }) placement: 'bottom' | 'side' = 'bottom';
  /**
   * For `placement="side"`: the bubble sits beside the whole row rather than the icon, so a flip
   * near the viewport edge lands beside the list (the Import panel) instead of over its rows.
   */
  @property({ type: Boolean, attribute: 'beside-row' }) besideRow = false;

  /** Pointer is over the icon or the bubble. */
  @state() private hovering = false;
  /** Click-pinned open (survives pointer leave; primary path on touch). */
  @state() private pinned = false;
  /** Opened via keyboard focus (not a pointer click). */
  @state() private kbFocused = false;

  @query('.info-button') private infoButton!: HTMLButtonElement | null;

  private readonly popoverId = `protspace-info-popover-${++infoPopoverSequence}`;

  /**
   * `aria-describedby` targets. They are the description and detail paragraphs, never the dialog
   * itself: the dialog carries an `aria-label`, and accname step 2C returns that label rather
   * than descending into the contents, which would silently empty the description.
   */
  private readonly descriptionId = `${this.popoverId}-description`;
  private readonly detailId = `${this.popoverId}-detail`;

  /** Whether the bubble is open (any of the three triggers). */
  private get isOpen(): boolean {
    return this.hovering || this.pinned || this.kbFocused;
  }

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** True briefly around a pointerdown so the ensuing focus is not treated as keyboard focus. */
  private pointerInitiatedFocus = false;
  /** Parent row used as the keep-open region for side placement (see `firstUpdated`). */
  private _row: HTMLElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerenter', this._onPointerEnter);
    this.addEventListener('pointerleave', this._onPointerLeave);
    this.addEventListener('focusout', this._onFocusOut);
  }

  firstUpdated() {
    // In side placement the path from the icon to the bubble crosses the row. The whole row (this
    // element's parent) is the keep-open region: the bubble is a DOM descendant of it, so gliding
    // from the ⓘ into the bubble never leaves it.
    if (this.placement === 'side' && this.parentElement) {
      this._row = this.parentElement;
      this._row.addEventListener('pointerleave', this._onRowPointerLeave);
      // The bubble's anchor reads `_row`, which the first render had not set yet.
      if (this.besideRow) this.requestUpdate();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this._onPointerEnter);
    this.removeEventListener('pointerleave', this._onPointerLeave);
    this.removeEventListener('focusout', this._onFocusOut);
    this._row?.removeEventListener('pointerleave', this._onRowPointerLeave);
    this._row = null;
    this._clearCloseTimer();
  }

  private _onPointerEnter = () => {
    // Fires for the icon and, since the bubble is a descendant of the host, when the pointer
    // re-enters the bubble after crossing the gap.
    this._clearCloseTimer();
    this.hovering = true;
  };

  /** Start the close grace period: long enough to bridge the gap between the icon and the bubble. */
  private _scheduleClose() {
    this._clearCloseTimer();
    this.closeTimer = setTimeout(() => {
      this.hovering = false;
      this.closeTimer = null;
    }, CLOSE_GRACE_MS);
  }

  private _onPointerLeave = () => {
    // For side placement leaving the row closes it (`_onRowPointerLeave`); leaving just the icon
    // must not, or crossing the row towards the bubble would dismiss it.
    if (this.placement === 'side') return;
    this._scheduleClose();
  };

  /** Side placement only: the pointer left the row (and the bubble), so begin closing. */
  private _onRowPointerLeave = () => {
    this._scheduleClose();
  };

  private _onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    // Only drop keyboard-open state when focus leaves the whole component (icon + bubble link).
    if (!next || !this.contains(next)) {
      this.kbFocused = false;
    }
  };

  private _clearCloseTimer() {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private _closeAll() {
    this._clearCloseTimer();
    this.hovering = false;
    this.pinned = false;
    this.kbFocused = false;
  }

  /**
   * The layer closed the bubble (Escape or a press outside). The event stops here: a host that
   * listens for its own overlays' `ps-close` must not take this one for theirs.
   */
  private _onLayerClose = (event: Event) => {
    event.stopPropagation();
    this._closeAll();
  };

  private _onPointerDown = () => {
    // A focus that immediately follows a pointerdown is a mouse/touch focus, not keyboard tabbing,
    // so don't open via `kbFocused` in that case (click handles the pinned state instead).
    this.pointerInitiatedFocus = true;
    setTimeout(() => {
      this.pointerInitiatedFocus = false;
    }, 0);
  };

  private _onFocus = () => {
    if (!this.pointerInitiatedFocus) {
      this.kbFocused = true;
    }
  };

  private _onClick = (event: Event) => {
    // A row around the icon (an annotation or an example) must not act on this click.
    event.stopPropagation();
    event.preventDefault();
    this.pinned = !this.pinned;
    if (!this.pinned) {
      // Explicit dismiss: also drop hover so it hides even while the pointer is still over the icon.
      this.hovering = false;
      this._clearCloseTimer();
    }
  };

  private get bubblePlacement(): Placement {
    if (this.placement === 'side') return 'right-start';
    return this.align === 'right' ? 'bottom-end' : 'bottom-start';
  }

  render() {
    const hasContent =
      this.description.length > 0 || this.detail.length > 0 || this.docsUrl.length > 0;
    if (!hasContent) return nothing;
    const describedBy = [
      ...(this.description ? [this.descriptionId] : []),
      ...(this.detail ? [this.detailId] : []),
    ].join(' ');
    const ariaLabel = this.label ? `Information about ${this.label}` : 'Annotation information';
    const dialogLabel = this.label ? `${this.label} information` : 'Annotation information';
    const open = this.isOpen;

    return html`
      <button
        type="button"
        class="info-button ${open ? 'open' : ''}"
        aria-label=${ariaLabel}
        aria-expanded=${open}
        aria-controls=${open ? this.popoverId : nothing}
        aria-describedby=${open && describedBy ? describedBy : nothing}
        @pointerdown=${this._onPointerDown}
        @focus=${this._onFocus}
        @click=${this._onClick}
      >
        ${icon('info', 14)}
      </button>
      <ps-popover
        id=${this.popoverId}
        .anchor=${this.besideRow && this._row ? this._row : this.infoButton}
        .open=${open}
        placement=${this.bubblePlacement}
        panel-role="dialog"
        panel-label=${dialogLabel}
        @ps-close=${this._onLayerClose}
      >
        ${open
          ? html`<div class="popover">
              ${this.description
                ? html`<p id=${this.descriptionId} class="popover-description">
                    ${this.description}
                  </p>`
                : nothing}
              ${this.detail
                ? html`<p id=${this.detailId} class="popover-detail">${this.detail}</p>`
                : nothing}
              ${this.docsUrl
                ? html`<a
                    class="popover-link"
                    href=${this.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    @click=${(e: Event) => e.stopPropagation()}
                    >Learn more${icon('external-link', 14)}<span class="popover-link-hint">
                      (opens in a new tab)</span
                    ></a
                  >`
                : nothing}
            </div>`
          : nothing}
      </ps-popover>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-info-popover': ProtspaceInfoPopover;
  }
}
