import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { customElement } from '../../utils/safe-custom-element';
import { fieldStyles } from './field.styles';

/** A text field. `label` names it when no visible label is associated. */
@customElement('ps-input')
export class PsInput extends LitElement {
  static styles = fieldStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() value = '';
  @property() type: 'text' | 'search' | 'number' = 'text';
  @property() placeholder = '';
  @property() label = '';
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<div class="field">
      <slot name="start"></slot>
      <input
        part="input"
        .value=${live(this.value)}
        type=${this.type}
        placeholder=${this.placeholder || nothing}
        aria-label=${this.label || nothing}
        aria-invalid=${this.invalid ? 'true' : nothing}
        ?disabled=${this.disabled}
        @input=${this.onInput}
        @change=${this.onChange}
      />
      <slot name="end"></slot>
    </div>`;
  }

  private onInput = (event: Event) => {
    this.value = (event.target as HTMLInputElement).value;
  };

  // `change` does not cross the shadow boundary, so the host dispatches its own.
  private onChange = () => this.dispatchEvent(new Event('change', { bubbles: true }));
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-input': PsInput;
  }
}
