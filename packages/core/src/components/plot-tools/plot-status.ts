import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { countNoun } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon, type IconName } from '../kit/icon';
import { plotStatusStyles } from './plot-status.styles';

/** The ways a view is narrowed, one chip each. */
export type StatusChipKind = 'filter' | 'isolation' | 'hidden';

interface Chip {
  kind: StatusChipKind;
  icon: IconName;
  text: string;
  clearLabel: string;
}

const KIND_ORDER: readonly StatusChipKind[] = ['filter', 'isolation', 'hidden'];

/**
 * The plot's bottom-left corner (design decision 13): the visible protein count, and a chip for
 * each way the view is narrowed, each with an ✕. The filter and hidden chips open the place to
 * change them; the isolation chip has nothing to open (no panel edits an isolation). It reports
 * presses; the host acts and sets the properties.
 *
 * @fires status-open - `{ kind: StatusChipKind }`
 * @fires status-clear - `{ kind: StatusChipKind }`
 */
@customElement('protspace-plot-status')
export class ProtspacePlotStatus extends LitElement {
  static styles = plotStatusStyles;

  /** The visible proteins; null hides the count. */
  @property({ attribute: false }) count: number | null = null;
  @property({ attribute: false }) zoomedIn = false;
  /** Configured conditions of the applied filter; 0 hides the chip. */
  @property({ attribute: false }) filterConditions = 0;
  /** The isolation's steps and the proteins it keeps; null hides the chip. */
  @property({ attribute: false }) isolation: { steps: number; size: number } | null = null;
  /** Category values the legend hides; 0 hides the chip. */
  @property({ attribute: false }) hiddenCategories = 0;

  /** The chip whose ✕ held focus when pressed, until the chip is gone and focus has moved on. */
  private _focusAfterClear: StatusChipKind | null = null;

  render() {
    return html`${this.count === null
      ? nothing
      : html`<span class="status-count" role="status" aria-live="polite" tabindex="-1"
          >${countNoun(this.count, 'protein', 'proteins')}${this.zoomedIn
            ? ' · Zoomed in'
            : ''}</span
        >`}
    ${this._chips().map(
      (chip) =>
        html`<div class="status-chip" data-kind=${chip.kind}>
          ${icon(chip.icon, 14)}
          ${chip.kind === 'isolation'
            ? html`<span class="status-chip-text">${chip.text}</span>`
            : html`<button
                type="button"
                class="status-chip-open"
                @click=${() => this._emit('status-open', chip.kind)}
              >
                ${chip.text}
              </button>`}
          <ps-icon-button
            size="sm"
            icon="x"
            label=${chip.clearLabel}
            @click=${() => this._clear(chip.kind)}
          ></ps-icon-button>
        </div>`,
    )}`;
  }

  protected updated(): void {
    const kind = this._focusAfterClear;
    if (!kind || this._chips().some((chip) => chip.kind === kind)) return;
    this._focusAfterClear = null;
    // Focus was on the ✕ of a chip that has gone: the next chip, else the count.
    const later = KIND_ORDER.slice(KIND_ORDER.indexOf(kind) + 1);
    const next = this._chips().find((chip) => later.includes(chip.kind));
    if (next) this._control(next.kind)?.focus();
    else this.renderRoot.querySelector<HTMLElement>('.status-count')?.focus();
  }

  /**
   * Focuses that chip's first control (its open button, else its ✕). False when the chip does not
   * show; a chip whose property was just set is focused once its update has rendered it.
   */
  focusChip(kind: StatusChipKind): boolean {
    if (!this._chips().some((chip) => chip.kind === kind)) return false;
    void this.updateComplete.then(async () => {
      const control = this._control(kind);
      // A kit button renders its inner <button> in its own update.
      if (control && 'updateComplete' in control) {
        await (control as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      }
      control?.focus();
    });
    return true;
  }

  private _chips(): Chip[] {
    const chips: Chip[] = [];
    if (this.filterConditions > 0) {
      chips.push({
        kind: 'filter',
        icon: 'filter',
        text: `Filtered · ${countNoun(this.filterConditions, 'condition', 'conditions')}`,
        clearLabel: 'Remove filter',
      });
    }
    if (this.isolation) {
      const { size, steps } = this.isolation;
      chips.push({
        kind: 'isolation',
        icon: 'target',
        text: `Showing only ${countNoun(size, 'protein', 'proteins')} · ${countNoun(steps, 'step', 'steps')}`,
        clearLabel: 'Show all proteins',
      });
    }
    if (this.hiddenCategories > 0) {
      chips.push({
        kind: 'hidden',
        icon: 'eye-off',
        text: `${countNoun(this.hiddenCategories, 'category', 'categories')} hidden`,
        clearLabel: 'Show hidden categories',
      });
    }
    return chips;
  }

  private _control(kind: StatusChipKind): HTMLElement | null {
    const chip = `.status-chip[data-kind="${kind}"]`;
    return this.renderRoot.querySelector<HTMLElement>(
      `${chip} .status-chip-open, ${chip} ps-icon-button`,
    );
  }

  private _clear(kind: StatusChipKind): void {
    this._focusAfterClear = this.shadowRoot!.activeElement ? kind : null;
    this._emit('status-clear', kind);
  }

  private _emit(type: 'status-open' | 'status-clear', kind: StatusChipKind): void {
    this.dispatchEvent(new CustomEvent(type, { detail: { kind }, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-plot-status': ProtspacePlotStatus;
  }
}
