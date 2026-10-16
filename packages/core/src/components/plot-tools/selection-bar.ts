import { LitElement, html, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { countNoun, formatCount } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsButton } from '../kit/button';
import { icon, type IconName } from '../kit/icon';
import { selectionBarStyles } from './selection-bar.styles';

type SelectionAction = 'isolate' | 'zoom' | 'copy' | 'clear';

const ACTIONS: ReadonlyArray<{
  action: SelectionAction;
  label: string;
  event: string;
  icon: IconName;
}> = [
  { action: 'isolate', label: 'Show only these', event: 'isolate-data', icon: 'target' },
  { action: 'zoom', label: 'Zoom to them', event: 'zoom-to-selection', icon: 'zoom-in' },
  { action: 'copy', label: 'Copy IDs', event: 'copy-selection', icon: 'copy' },
  { action: 'clear', label: 'Clear', event: 'clear-selections', icon: 'x' },
];

/**
 * The selection's actions at the bottom of the plot, shown while proteins are selected (design
 * decision 13): the count, then Show only these, Zoom to them, Copy IDs and Clear. A toolbar with
 * one Tab stop; the arrow keys move between its buttons. It reports presses; the host's selection
 * controller acts and sets `selectedCount`. On a phone (≤ 640 px) it fits a 360 px plot: icons, the
 * labels kept as the buttons' names, and a short count.
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
   * Called when the bar hides while it holds focus, so focus lands on something useful instead of
   * the page body: with the pressed action for Clear or Show only these, else with 'clear' (Escape,
   * a brush or a search emptied the selection).
   */
  @property({ attribute: false }) returnFocus: ((action: 'clear' | 'isolate') => void) | null =
    null;

  /** The toolbar's one Tab stop: the button focused last. */
  @state() private _tabStop: SelectionAction = 'isolate';

  /** The pressed action, until the update the press scheduled has read it. */
  private _pressed: 'clear' | 'isolate' | null = null;
  /** Set by the update that hides the bar while it holds focus. */
  private _refocus: 'clear' | 'isolate' | null = null;

  protected willUpdate(changed: PropertyValues<this>): void {
    const pressed = this._pressed;
    this._pressed = null;
    if (!changed.has('selectedCount')) return;
    const hide = this.selectedCount === 0;
    if (hide && !this.hidden && this.shadowRoot?.activeElement) this._refocus = pressed ?? 'clear';
    this.hidden = hide;
  }

  protected updated(): void {
    const action = this._refocus;
    this._refocus = null;
    if (action) this.returnFocus?.(action);
  }

  render() {
    const enabled = ACTIONS.filter(({ action }) => this._isEnabled(action));
    const stop = enabled.some(({ action }) => action === this._tabStop)
      ? this._tabStop
      : enabled[0]?.action;
    // The live region stays rendered while the bar is hidden, so the first count is announced.
    return html`<span class="sr-only" role="status"
        >${this.selectedCount
          ? `${countNoun(this.selectedCount, 'protein', 'proteins')} selected`
          : ''}</span
      >
      <div
        class="bar"
        role="toolbar"
        aria-label="Selection"
        @keydown=${this._onKeydown}
        @focusin=${this._onFocusIn}
      >
        <span class="selection-count" aria-hidden="true"
          >${countNoun(this.selectedCount, 'protein', 'proteins')} selected</span
        >
        <span class="selection-count-short" aria-hidden="true"
          >${formatCount(this.selectedCount)} selected</span
        >
        ${ACTIONS.map(
          ({ action, label, icon: name }) =>
            html`<ps-button
              size="sm"
              variant="ghost"
              data-action=${action}
              tabindex=${action === stop ? '0' : '-1'}
              ?disabled=${!this._isEnabled(action)}
              @click=${() => this._press(action)}
              ><span slot="start" class="action-icon" aria-hidden="true">${icon(name, 16)}</span
              ><span class="action-label">${label}</span></ps-button
            >`,
        )}
      </div>`;
  }

  private _isEnabled(action: SelectionAction): boolean {
    return action !== 'isolate' || this.canIsolate;
  }

  private _press(action: SelectionAction): void {
    const { event } = ACTIONS.find((entry) => entry.action === action)!;
    this._pressed = action === 'clear' || action === 'isolate' ? action : null;
    this.dispatchEvent(new CustomEvent(event, { detail: {}, bubbles: true, composed: true }));
    // The host sets selectedCount inside the event; the update it schedules reads the press.
    if (!this.isUpdatePending) this._pressed = null;
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
