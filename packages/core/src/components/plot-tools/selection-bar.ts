import { LitElement, html, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { countNoun } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsButton } from '../kit/button';
import { selectionBarStyles } from './selection-bar.styles';

type SelectionAction = 'isolate' | 'zoom' | 'copy' | 'clear';

const ACTIONS: ReadonlyArray<{ action: SelectionAction; label: string; event: string }> = [
  { action: 'isolate', label: 'Show only these', event: 'isolate-data' },
  { action: 'zoom', label: 'Zoom to them', event: 'zoom-to-selection' },
  { action: 'copy', label: 'Copy IDs', event: 'copy-selection' },
  { action: 'clear', label: 'Clear', event: 'clear-selections' },
];

/**
 * The selection's actions at the bottom of the plot, shown while proteins are selected (design
 * decision 13): the count, then Show only these, Zoom to them, Copy IDs and Clear. A toolbar with
 * one Tab stop; the arrow keys move between its buttons. It reports presses; the host's selection
 * controller acts and sets `selectedCount`.
 *
 * @fires isolate-data - `{}`
 * @fires zoom-to-selection - `{}`
 * @fires copy-selection - `{}`
 * @fires clear-selections - `{}`
 */
@customElement('protspace-selection-bar')
export class ProtspaceSelectionBar extends LitElement {
  static styles = selectionBarStyles;

  @property({ type: Number, attribute: 'selected-count' }) selectedCount = 0;
  /** Show only these is off: the view holds too few points to isolate from. */
  @property({ type: Boolean, attribute: 'can-isolate' }) canIsolate = true;
  /**
   * Called after Clear or Show only these hid the bar while it held focus, so focus lands on
   * something useful instead of the page body.
   */
  @property({ attribute: false }) returnFocus: ((action: 'clear' | 'isolate') => void) | null =
    null;

  /** The toolbar's one Tab stop: the button focused last. */
  @state() private _tabStop: SelectionAction = 'isolate';

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('selectedCount')) this.hidden = this.selectedCount === 0;
  }

  render() {
    const enabled = ACTIONS.filter(({ action }) => this._isEnabled(action));
    const stop = enabled.some(({ action }) => action === this._tabStop)
      ? this._tabStop
      : enabled[0]?.action;
    return html`<div
      class="bar"
      role="toolbar"
      aria-label="Selection"
      @keydown=${this._onKeydown}
      @focusin=${this._onFocusIn}
    >
      <span class="selection-count" aria-live="polite"
        >${countNoun(this.selectedCount, 'protein', 'proteins')} selected</span
      >
      ${ACTIONS.map(
        ({ action, label }) =>
          html`<ps-button
            size="sm"
            variant="ghost"
            data-action=${action}
            tabindex=${action === stop ? '0' : '-1'}
            ?disabled=${!this._isEnabled(action)}
            @click=${() => this._press(action)}
            >${label}</ps-button
          >`,
      )}
    </div>`;
  }

  private _isEnabled(action: SelectionAction): boolean {
    return action !== 'isolate' || this.canIsolate;
  }

  private async _press(action: SelectionAction): Promise<void> {
    const hadFocus = this.shadowRoot!.activeElement !== null;
    const { event } = ACTIONS.find((entry) => entry.action === action)!;
    this.dispatchEvent(new CustomEvent(event, { detail: {}, bubbles: true, composed: true }));
    if (!hadFocus || (action !== 'clear' && action !== 'isolate')) return;
    // The host empties the selection while the event runs; the bar hides in the next update.
    await this.updateComplete;
    if (this.hidden) this.returnFocus?.(action);
  }

  private _onFocusIn = (event: FocusEvent) => {
    const action = (event.target as HTMLElement).dataset?.action as SelectionAction | undefined;
    if (action) this._tabStop = action;
  };

  /** The toolbar pattern: ArrowLeft and ArrowRight (and Home, End) move between enabled buttons. */
  private _onKeydown = (event: KeyboardEvent) => {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    const enabled = [...this.renderRoot.querySelectorAll<PsButton>('ps-button')].filter(
      (b) => !b.disabled,
    );
    const current = enabled.indexOf(this.shadowRoot!.activeElement as PsButton);
    if (current === -1) return;
    event.preventDefault();
    const last = enabled.length - 1;
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? last
          : key === 'ArrowRight'
            ? (current + 1) % enabled.length
            : (current + last) % enabled.length;
    enabled[next].focus();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-selection-bar': ProtspaceSelectionBar;
  }
}
