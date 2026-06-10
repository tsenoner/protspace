import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { handleDropdownEscape } from '../../utils/dropdown-helpers';

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
 * - **Click** still toggles a pinned state (keeps it open after the pointer leaves; primary path on
 *   touch where there is no hover). Escape or an outside click closes it.
 * - Renders nothing when there is neither a description nor a docs URL.
 *
 * Used by the annotation dropdown (per item) and the legend header (active annotation).
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
   * Preferred horizontal open direction. `'left'` (default) opens the popover rightward from the
   * icon; `'right'` opens it leftward (align its right edge to the icon) — use this when the icon
   * sits near the right edge of a container, e.g. the annotation dropdown's action column. A
   * viewport overflow check still flips it as a safety net regardless of this setting.
   */
  @property({ type: String }) align: 'left' | 'right' = 'left';

  /** Pointer is over the icon or the popover. */
  @state() private hovering = false;
  /** Click-pinned open (survives pointer leave; primary path on touch). */
  @state() private pinned = false;
  /** Opened via keyboard focus (not a pointer click). */
  @state() private kbFocused = false;
  @state() private flipLeft = false;

  /** Whether the popover is currently visible (any of the three triggers). */
  private get isOpen(): boolean {
    return this.hovering || this.pinned || this.kbFocused;
  }

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** True briefly around a pointerdown so the ensuing focus is not treated as keyboard focus. */
  private pointerInitiatedFocus = false;
  private docListenerAttached = false;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerenter', this._onPointerEnter);
    this.addEventListener('pointerleave', this._onPointerLeave);
    this.addEventListener('focusout', this._onFocusOut);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this._onPointerEnter);
    this.removeEventListener('pointerleave', this._onPointerLeave);
    this.removeEventListener('focusout', this._onFocusOut);
    this._clearCloseTimer();
    this._detachDocListener();
  }

  private _onPointerEnter = () => {
    this._clearCloseTimer();
    this.hovering = true;
  };

  private _onPointerLeave = () => {
    this._clearCloseTimer();
    // Grace period so the pointer can cross the small gap between the icon and the popover without
    // the popover closing out from under it.
    this.closeTimer = setTimeout(() => {
      this.hovering = false;
      this.closeTimer = null;
    }, 140);
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

  private _closeAll() {
    this._clearCloseTimer();
    this.hovering = false;
    this.pinned = false;
    this.kbFocused = false;
  }

  updated() {
    // Keep the outside-click listener attached only while open.
    if (this.isOpen) {
      this._attachDocListener();
    } else {
      this._detachDocListener();
      if (this.flipLeft) this.flipLeft = false;
      return;
    }

    // After the popover renders, flip it leftward if it would overflow the right edge of the
    // viewport (safety net on top of the `align` preference).
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
            class="popover ${this.align === 'right' || this.flipLeft ? 'flip-left' : ''}"
            role="dialog"
            @keydown=${this._onKeydown}
          >
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
