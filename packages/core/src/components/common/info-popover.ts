import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { handleDropdownEscape } from '../../utils/dropdown-helpers';

/**
 * Small reusable "ⓘ" information control that opens a popover with an annotation description and an
 * optional "Learn more" link. Click to toggle; Escape or an outside click closes it. Renders
 * nothing when there is neither a description nor a docs URL.
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
      max-width: 260px;
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

  @state() private open = false;

  private _onDocumentClick = (event: MouseEvent) => {
    if (!event.composedPath().includes(this)) {
      this.open = false;
    }
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocumentClick, true);
  }

  private _toggle(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.open = !this.open;
    if (this.open) {
      document.addEventListener('click', this._onDocumentClick, true);
    } else {
      document.removeEventListener('click', this._onDocumentClick, true);
    }
  }

  private _onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.open) {
      handleDropdownEscape(event, () => {
        this.open = false;
        document.removeEventListener('click', this._onDocumentClick, true);
      });
    }
  }

  render() {
    const hasContent = this.description.length > 0 || this.docsUrl.length > 0;
    if (!hasContent) return nothing;

    const ariaLabel = this.label ? `Information about ${this.label}` : 'Annotation information';

    return html`
      <button
        type="button"
        class="info-button ${this.open ? 'open' : ''}"
        aria-label=${ariaLabel}
        aria-expanded=${this.open}
        title=${ariaLabel}
        @click=${this._toggle}
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
      ${this.open
        ? html`<div class="popover" role="dialog" @keydown=${this._onKeydown}>
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
