import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../../utils/safe-custom-element';
import { isMacOrIos } from '@protspace/utils';
import { protspaceTipsStyles } from './protspace-tips.styles';

@customElement('protspace-tips')
class ProtspaceTips extends LitElement {
  static styles = protspaceTipsStyles;

  /** When true, a "Take a Tour" button is rendered inside the popover. */
  @property({ type: Boolean, attribute: 'show-tour-button' }) showTourButton = false;

  @state() private _isTooltipVisible = false;

  private _handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this._toggleTooltip();
    } else if (event.key === 'Escape') {
      this._hideTooltip();
    }
  }

  private _toggleTooltip() {
    this._isTooltipVisible = !this._isTooltipVisible;
  }

  private _showTooltip() {
    this._isTooltipVisible = true;
  }

  private _hideTooltip() {
    this._isTooltipVisible = false;
  }

  private _handleFocusOut(event: FocusEvent) {
    // Hide tooltip when focus moves outside the component
    const relatedTarget = event.relatedTarget as Element;
    if (!this.contains(relatedTarget)) {
      this._hideTooltip();
    }
  }

  private _startTour() {
    this._hideTooltip();
    this.dispatchEvent(new CustomEvent('tour-start', { bubbles: true, composed: true }));
  }

  private _modKey() {
    return isMacOrIos() ? html`<span class="mod-key">⌘</span>` : 'Ctrl+';
  }

  render() {
    return html`
      <button
        class="trigger ${this._isTooltipVisible ? 'active' : ''}"
        type="button"
        tabindex="0"
        aria-label="Tips & shortcuts"
        aria-describedby="protspace-tips-content"
        aria-expanded="${this._isTooltipVisible}"
        @keydown=${this._handleKeyDown}
        @focus=${this._showTooltip}
        @blur=${this._handleFocusOut}
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke-width="1.5" />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M9.09 9a3 3 0 015.83 1c0 2-3.01 2-3.01 4"
          />
          <circle cx="12" cy="17.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <div
        class="content ${this._isTooltipVisible ? 'visible' : ''}"
        id="protspace-tips-content"
        role="tooltip"
        aria-hidden="${!this._isTooltipVisible}"
      >
        <div class="header">Tips & Shortcuts</div>
        <table class="shortcuts-table">
          <tbody>
            <tr class="section-label">
              <td colspan="2">Navigation</td>
            </tr>
            <tr>
              <td><kbd>Drag</kbd></td>
              <td>Pan around the plot</td>
            </tr>
            <tr>
              <td><kbd>Scroll</kbd></td>
              <td>Zoom in / out</td>
            </tr>
            <tr>
              <td><kbd>Double-click</kbd></td>
              <td>Reset zoom</td>
            </tr>
            <tr class="section-label">
              <td colspan="2">Interaction</td>
            </tr>
            <tr>
              <td><kbd>Hover</kbd></td>
              <td>See protein details</td>
            </tr>
            <tr>
              <td><kbd>Click</kbd> point</td>
              <td>View 3D structure</td>
            </tr>
            <tr>
              <td><kbd>${this._modKey()}K</kbd></td>
              <td>Search proteins</td>
            </tr>
            <tr>
              <td><kbd>Paste</kbd> IDs</td>
              <td>Select multiple at once</td>
            </tr>
            <tr class="section-label">
              <td colspan="2">Selection</td>
            </tr>
            <tr>
              <td><kbd>${this._modKey()}Click</kbd></td>
              <td>Toggle individual point</td>
            </tr>
            <tr>
              <td><kbd>Esc</kbd></td>
              <td>Exit selection mode</td>
            </tr>
            <tr class="section-label">
              <td colspan="2">Legend</td>
            </tr>
            <tr>
              <td><kbd>Click</kbd> entry</td>
              <td>Hide / show category</td>
            </tr>
            <tr>
              <td><kbd>Double-click</kbd></td>
              <td>Isolate category</td>
            </tr>
          </tbody>
        </table>

        ${this.showTourButton
          ? html`
              <div class="tour-section">
                <button class="tour-button" type="button" @click=${this._startTour}>
                  Take a Tour
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-tips': ProtspaceTips;
  }
}
