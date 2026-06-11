import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { handleDropdownEscape } from '../../utils/dropdown-helpers';

/** Computed viewport coordinates for a `placement="side"` popover (escapes overflow clipping). */
interface SideCoords {
  left: number;
  top: number;
  /** Vertical offset of the arrow within the popover, so it points at the icon. */
  arrowTop: number;
  /** True when there was no room on the preferred side and the popover flipped to the other side. */
  flipped: boolean;
}

/**
 * Small reusable "ⓘ" information control that opens a popover with an annotation description and an
 * optional "Learn more" link.
 *
 * Interaction model:
 * - Opens on **hover** (pointer over the icon) and on **keyboard focus**, so the brief summary is
 *   one hover away while scanning the annotation dropdown.
 * - The popover is **hoverable**: it stays open while the pointer is over the icon *or* the popover
 *   itself (a short grace period bridges the small gap between them), so you can move into it to
 *   click "Learn more ↗" without it disappearing.
 * - **Click** still toggles a pinned state. Escape or an outside click closes it.
 *
 * Placement:
 * - `"bottom"` (default) drops the popover below the icon — used by the legend header.
 * - `"side"` floats it beside the dropdown *panel* (left by default, flipping right near the
 *   viewport edge), level with the hovered row and with an arrow pointing at it, rendered
 *   `position: fixed` so it escapes the dropdown's `overflow` clipping. Anchoring to the panel
 *   edge keeps the bubble out of the list entirely, so every row's label stays visible while you
 *   move the pointer up and down the column of ⓘ icons.
 *
 * Renders nothing when there is neither a description nor a docs URL.
 */
@customElement('protspace-info-popover')
class ProtspaceInfoPopover extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      position: relative;
    }

    .info-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--legend-text-secondary, #6b7280);
      cursor: pointer;
      line-height: 1;
    }

    .info-button:hover,
    .info-button.open {
      color: var(--legend-text-color, #111827);
      background: color-mix(in srgb, currentColor 12%, transparent);
    }

    .info-button:focus-visible {
      outline: 2px solid var(--accent-color, #3b82f6);
      outline-offset: 1px;
    }

    .popover {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 1000;
      width: max-content;
      max-width: min(260px, calc(100vw - 24px));
      padding: 0.55rem 0.65rem;
      border-radius: 8px;
      background: var(--surface-color, #ffffff);
      color: var(--text-color, #111827);
      border: 1px solid var(--border-color, #e5e7eb);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      font-size: 0.78rem;
      line-height: 1.35;
      text-align: left;
      white-space: normal;
    }

    /* Open leftward (align right edge to the icon) when there isn't room on the right,
       e.g. the info icon sits near the right edge of the annotation dropdown. */
    .popover.flip-left {
      left: auto;
      right: 0;
    }

    /* Side placement: positioned via fixed viewport coordinates (set inline) so it escapes the
       dropdown's overflow clipping and sits beside the row instead of over the list. */
    .popover.placement-side {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2000;
    }

    /* Hidden until measured, to avoid a one-frame flash at the default (0,0) position. */
    .popover.placement-side.measuring {
      visibility: hidden;
    }

    /* Caret: a rotated square sharing the popover's surface + border, half-poking out the edge. */
    .popover-arrow {
      position: absolute;
      width: 10px;
      height: 10px;
      background: var(--surface-color, #ffffff);
      border: 1px solid var(--border-color, #e5e7eb);
      transform: rotate(45deg);
    }

    /* Left placement → caret on the right edge pointing toward the icon. */
    .popover.placement-side .popover-arrow {
      right: -6px;
      border-left: none;
      border-bottom: none;
    }

    /* Flipped to the right → caret on the left edge. */
    .popover.placement-side.flipped .popover-arrow {
      right: auto;
      left: -6px;
      border-left: 1px solid var(--border-color, #e5e7eb);
      border-bottom: 1px solid var(--border-color, #e5e7eb);
      border-right: none;
      border-top: none;
    }

    .popover-description {
      margin: 0;
    }

    .popover-link {
      display: inline-block;
      margin-top: 0.45rem;
      color: var(--accent-color, #3b82f6);
      text-decoration: none;
      font-weight: 500;
    }

    .popover-link:hover {
      text-decoration: underline;
    }
  `;

  /** Short description text shown in the popover. */
  @property({ type: String }) description = '';
  /** Optional site-relative or absolute documentation URL. */
  @property({ type: String, attribute: 'docs-url' }) docsUrl = '';
  /** Human-readable annotation label, used for accessible button labelling. */
  @property({ type: String }) label = '';
  /**
   * Preferred horizontal open direction for `placement="bottom"`. `'left'` (default) opens the
   * popover rightward from the icon; `'right'` opens it leftward (align its right edge to the icon).
   * A viewport overflow check still flips it as a safety net. Ignored for `placement="side"`.
   */
  @property({ type: String }) align: 'left' | 'right' = 'left';
  /**
   * Where the popover opens. `'bottom'` drops it below the icon (legend); `'side'` floats it beside
   * the icon with an arrow (annotation dropdown), so it never covers the row below.
   */
  @property({ type: String }) placement: 'bottom' | 'side' = 'bottom';

  /** Pointer is over the icon or the popover. */
  @state() private hovering = false;
  /** Click-pinned open (survives pointer leave; primary path on touch). */
  @state() private pinned = false;
  /** Opened via keyboard focus (not a pointer click). */
  @state() private kbFocused = false;
  @state() private flipLeft = false;
  /** Computed fixed coordinates for side placement (null until measured). */
  @state() private sideCoords: SideCoords | null = null;

  /** Whether the popover is currently visible (any of the three triggers). */
  private get isOpen(): boolean {
    return this.hovering || this.pinned || this.kbFocused;
  }

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** True briefly around a pointerdown so the ensuing focus is not treated as keyboard focus. */
  private pointerInitiatedFocus = false;
  private docListenerAttached = false;
  private repositionListenerAttached = false;
  /** Parent row used as the keep-open region for side placement (see `firstUpdated`). */
  private _row: HTMLElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerenter', this._onPointerEnter);
    this.addEventListener('pointerleave', this._onPointerLeave);
    this.addEventListener('focusout', this._onFocusOut);
  }

  firstUpdated() {
    // In side placement the bubble floats outside the dropdown panel, so the path from the icon to
    // the bubble crosses the row. Treat the whole row (this popover's parent) as the keep-open
    // region — the bubble is a DOM descendant of it — so the user can glide from the ⓘ into the
    // bubble to click "Learn more" without it closing, while only the tiny panel↔bubble gap relies
    // on the grace period.
    if (this.placement === 'side' && this.parentElement) {
      this._row = this.parentElement;
      this._row.addEventListener('pointerleave', this._onRowPointerLeave);
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
    this._detachDocListener();
    this._detachRepositionListener();
  }

  private _onPointerEnter = () => {
    // Fires for the icon and (since the bubble is a descendant of the host) when the pointer
    // re-enters the bubble after crossing the panel↔bubble gap.
    this._clearCloseTimer();
    this.hovering = true;
  };

  /** Start the close grace period: long enough to bridge the gap between the trigger and the bubble. */
  private _scheduleClose() {
    this._clearCloseTimer();
    this.closeTimer = setTimeout(() => {
      this.hovering = false;
      this.closeTimer = null;
    }, 140);
  }

  private _onPointerLeave = () => {
    // For side placement, closing is driven by leaving the whole row (see `_onRowPointerLeave`), so
    // leaving just the icon must not start the close timer — otherwise crossing the row toward the
    // bubble would dismiss it.
    if (this.placement === 'side') return;
    this._scheduleClose();
  };

  /** Side placement only: the pointer left the row (and the bubble), so begin closing. */
  private _onRowPointerLeave = () => {
    this._scheduleClose();
  };

  private _onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    // Only drop keyboard-open state when focus leaves the whole component (icon + popover link).
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

  private _onDocumentClick = (event: MouseEvent) => {
    if (!event.composedPath().includes(this)) {
      this._closeAll();
    }
  };

  private _attachDocListener() {
    if (this.docListenerAttached) return;
    document.addEventListener('click', this._onDocumentClick, true);
    this.docListenerAttached = true;
  }

  private _detachDocListener() {
    if (!this.docListenerAttached) return;
    document.removeEventListener('click', this._onDocumentClick, true);
    this.docListenerAttached = false;
  }

  // Reposition the side popover when the dropdown list scrolls or the window resizes (its fixed
  // coordinates are viewport-relative, so the icon can move out from under it otherwise).
  private _onScrollOrResize = () => {
    if (this.isOpen && this.placement === 'side') this._computeSidePosition();
  };

  private _attachRepositionListener() {
    if (this.repositionListenerAttached) return;
    window.addEventListener('scroll', this._onScrollOrResize, true);
    window.addEventListener('resize', this._onScrollOrResize);
    this.repositionListenerAttached = true;
  }

  private _detachRepositionListener() {
    if (!this.repositionListenerAttached) return;
    window.removeEventListener('scroll', this._onScrollOrResize, true);
    window.removeEventListener('resize', this._onScrollOrResize);
    this.repositionListenerAttached = false;
  }

  private _closeAll() {
    this._clearCloseTimer();
    this.hovering = false;
    this.pinned = false;
    this.kbFocused = false;
  }

  /**
   * Walk the composed ancestry from the icon to the nearest clipping container (the dropdown
   * panel). Its left/right edges are the anchor for the side popover, so the bubble sits beside the
   * whole list instead of over a row's label.
   */
  private _nearestClipRect(start: Element): DOMRect | null {
    let node: Node | null = start.parentNode;
    while (node) {
      if (node instanceof ShadowRoot) {
        node = node.host;
        continue;
      }
      if (node instanceof Element) {
        const s = getComputedStyle(node);
        const clips = /(auto|scroll|hidden|clip)/;
        if (clips.test(s.overflowX) || clips.test(s.overflowY)) {
          return node.getBoundingClientRect();
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  /**
   * Place the popover beside the dropdown panel (not the icon), vertically level with the hovered
   * row, flipping/clamping to fit. Anchoring to the panel's edge keeps every row's label visible
   * while you move the pointer up and down the column of ⓘ icons.
   */
  private _computeSidePosition() {
    const button = this.shadowRoot?.querySelector('.info-button') as HTMLElement | null;
    const popover = this.shadowRoot?.querySelector('.popover') as HTMLElement | null;
    if (!button || !popover) return;

    const icon = button.getBoundingClientRect();
    // Anchor to the panel's left edge (its clipping container); fall back to the icon if there
    // isn't one (e.g. when used outside a scrolling list).
    const clip = this._nearestClipRect(button);
    const boundaryLeft = clip ? clip.left : icon.left;
    const boundaryRight = clip ? clip.right : icon.right;
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    const GAP = 12; // space between the panel and the bubble (room for the arrow)
    const MARGIN = 8; // keep clear of the viewport edge
    const HALF_ARROW = 5;
    const iconCenterY = icon.top + icon.height / 2;

    // Prefer the left of the panel; flip to the right only if there's no room.
    let left = boundaryLeft - GAP - w;
    let flipped = false;
    if (left < MARGIN) {
      left = boundaryRight + GAP;
      flipped = true;
      if (left + w > window.innerWidth - MARGIN) {
        left = Math.max(MARGIN, window.innerWidth - MARGIN - w);
      }
    }

    let top = iconCenterY - h / 2;
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - h - MARGIN));

    const arrowTop = Math.min(
      Math.max(HALF_ARROW + 2, iconCenterY - top - HALF_ARROW),
      Math.max(HALF_ARROW + 2, h - 2 * HALF_ARROW - 2),
    );

    const cur = this.sideCoords;
    if (
      !cur ||
      cur.left !== left ||
      cur.top !== top ||
      cur.arrowTop !== arrowTop ||
      cur.flipped !== flipped
    ) {
      this.sideCoords = { left, top, arrowTop, flipped };
    }
  }

  updated() {
    // Keep the outside-click listener attached only while open.
    if (!this.isOpen) {
      this._detachDocListener();
      this._detachRepositionListener();
      if (this.flipLeft) this.flipLeft = false;
      if (this.sideCoords) this.sideCoords = null;
      return;
    }
    this._attachDocListener();

    if (this.placement === 'side') {
      this._attachRepositionListener();
      if (!this.sideCoords) this._computeSidePosition();
      return;
    }

    // Bottom placement: flip leftward if it would overflow the right edge of the viewport
    // (safety net on top of the `align` preference).
    if (this.flipLeft || this.align === 'right') return;
    const popover = this.shadowRoot?.querySelector('.popover') as HTMLElement | null;
    if (popover && popover.getBoundingClientRect().right > window.innerWidth - 8) {
      this.flipLeft = true;
    }
  }

  private _onPointerDown = () => {
    // A focus that immediately follows a pointerdown is a mouse/touch focus, not keyboard tabbing —
    // don't open via `kbFocused` in that case (click handles the pinned state instead).
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
    event.stopPropagation();
    event.preventDefault();
    this.pinned = !this.pinned;
    if (!this.pinned) {
      // Explicit dismiss: also drop hover so it hides even while the pointer is still over the icon.
      this.hovering = false;
      this._clearCloseTimer();
    }
  };

  private _onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.isOpen) {
      handleDropdownEscape(event, () => {
        this._closeAll();
        const button = this.shadowRoot?.querySelector('.info-button') as HTMLElement | null;
        button?.blur();
      });
    }
  }

  render() {
    const hasContent = this.description.length > 0 || this.docsUrl.length > 0;
    if (!hasContent) return nothing;

    const ariaLabel = this.label ? `Information about ${this.label}` : 'Annotation information';
    const open = this.isOpen;
    const side = this.placement === 'side';

    const popoverClass = side
      ? `popover placement-side ${this.sideCoords ? '' : 'measuring'} ${
          this.sideCoords?.flipped ? 'flipped' : ''
        }`
      : `popover ${this.align === 'right' || this.flipLeft ? 'flip-left' : ''}`;
    const popoverStyle =
      side && this.sideCoords ? `left:${this.sideCoords.left}px;top:${this.sideCoords.top}px;` : '';

    return html`
      <button
        type="button"
        class="info-button ${open ? 'open' : ''}"
        aria-label=${ariaLabel}
        aria-expanded=${open}
        title=${ariaLabel}
        @pointerdown=${this._onPointerDown}
        @focus=${this._onFocus}
        @click=${this._onClick}
        @keydown=${this._onKeydown}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      ${open
        ? html`<div
            class=${popoverClass}
            style=${popoverStyle}
            role="dialog"
            @keydown=${this._onKeydown}
          >
            ${side
              ? html`<span
                  class="popover-arrow"
                  style=${this.sideCoords ? `top:${this.sideCoords.arrowTop}px` : ''}
                ></span>`
              : nothing}
            ${this.description
              ? html`<p class="popover-description">${this.description}</p>`
              : nothing}
            ${this.docsUrl
              ? html`<a
                  class="popover-link"
                  href=${this.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  @click=${(e: Event) => e.stopPropagation()}
                  >Learn more ↗</a
                >`
              : nothing}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-info-popover': ProtspaceInfoPopover;
  }
}
