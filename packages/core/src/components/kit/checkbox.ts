import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { customElement } from '../../utils/safe-custom-element';
import { checkboxStyles } from './choice.styles';
import { icon } from './icon';

/** A checkbox with its label in the default slot, or named by `label` when it shows no text. */
@customElement('ps-checkbox')
export class PsCheckbox extends LitElement {
  static styles = checkboxStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) indeterminate = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** The accessible name when no text is slotted. */
  @property() label = '';

  render() {
    return html`<label>
      <input
        part="input"
        type="checkbox"
        .checked=${live(this.checked)}
        aria-label=${this.label || nothing}
        .indeterminate=${live(this.indeterminate)}
        ?disabled=${this.disabled}
        @change=${this.onChange}
      />
      <span class="box">${icon(this.indeterminate ? 'minus' : 'check', 14)}</span>
      <slot></slot>
    </label>`;
  }

  private onChange = (event: Event) => {
    this.checked = (event.target as HTMLInputElement).checked;
    this.indeterminate = false;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-checkbox': PsCheckbox;
  }
}
