import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { segmentedStyles } from './choice.styles';
import type { PsTooltip } from './tooltip';
import './tooltip';

export interface SegmentedOption {
  value: string;
  label: string;
  /**
   * Shown but not choosable. The option is aria-disabled, not native disabled: pointer hover, a
   * click or a tap shows its tooltip, and assistive technology reads that as its description. A
   * click, a tap or an arrow key never selects it, and arrow keys skip it.
   */
  disabled?: boolean;
  /** A ps-tooltip for the option, typically why it is disabled. */
  tooltip?: string;
}

/** A small set of mutually exclusive choices: a radio group with arrow-key movement. */
@customElement('ps-segmented')
export class PsSegmented extends LitElement {
  static styles = segmentedStyles;

  @property({ attribute: false }) options: SegmentedOption[] = [];
  @property() value = '';
  @property() label = '';

  render() {
    const selected = this.options.findIndex((option) => option.value === this.value);
    // The checked option is the tab stop even when disabled, so its reason stays reachable;
    // otherwise the first enabled one, or the first one when none is.
    const stop =
      selected >= 0
        ? selected
        : Math.max(
            0,
            this.options.findIndex((option) => !option.disabled),
          );
    return html`<div
      part="group"
      role="radiogroup"
      aria-label=${this.label || nothing}
      @keydown=${this.onKeydown}
    >
      ${this.options.map(
        (option, index) =>
          html`<button
              type="button"
              role="radio"
              aria-checked=${String(index === selected)}
              aria-disabled=${option.disabled ? 'true' : nothing}
              tabindex=${index === stop ? 0 : -1}
              data-value=${option.value}
              @click=${(event: Event) => {
                if (!option.disabled) return this.select(option.value);
                this.explain(event.currentTarget as HTMLElement);
              }}
            >
              ${option.label}
            </button>
            ${option.tooltip ? html`<ps-tooltip text=${option.tooltip}></ps-tooltip>` : nothing}`,
      )}
    </div>`;
  }

  /**
   * A finger has no hover, so a press on a disabled option shows its reason. Focusing it first
   * (Safari does not focus a pressed button) lets the next press elsewhere hide it via focusout.
   */
  private explain(button: HTMLElement): void {
    const tip = button.nextElementSibling;
    if (tip?.localName !== 'ps-tooltip') return;
    button.focus();
    (tip as PsTooltip).show();
  }

  private select(value: string, focus = false): void {
    if (value !== this.value) {
      this.value = value;
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
    }
    if (focus) {
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)?.focus(),
      );
    }
  }

  private onKeydown = (event: KeyboardEvent) => {
    const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    const count = this.options.length;
    if (step === 0 || count === 0) return;
    event.preventDefault();
    const current = this.options.findIndex((option) => option.value === this.value);
    // From the checked option (or from just outside either end), the next enabled one, wrapping.
    const start = current < 0 ? (step > 0 ? -1 : count) : current;
    for (let offset = 1; offset <= count; offset++) {
      const index = (((start + step * offset) % count) + count) % count;
      if (index === current) return;
      if (!this.options[index].disabled) {
        this.select(this.options[index].value, true);
        return;
      }
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-segmented': PsSegmented;
  }
}
