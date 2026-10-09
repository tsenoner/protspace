import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { segmentedStyles } from './choice.styles';

export interface SegmentedOption {
  value: string;
  label: string;
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
            tabindex=${index === (selected < 0 ? 0 : selected) ? 0 : -1}
            data-value=${option.value}
            @click=${() => this.select(option.value)}
          >
            ${option.label}
          </button>`,
      )}
    </div>`;
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
    const next = current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count;
    this.select(this.options[next].value, true);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-segmented': PsSegmented;
  }
}
