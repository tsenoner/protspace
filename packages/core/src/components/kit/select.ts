import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { customElement } from '../../utils/safe-custom-element';
import { fieldStyles } from './field.styles';
import { icon } from './icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * A styled native <select>, so phones keep their own picker. Each option's `selected` is bound
 * live: after a user pick, the attribute no longer moves the selection, and the owner may reject a
 * pick by setting `value` back.
 */
@customElement('ps-select')
export class PsSelect extends LitElement {
  static styles = fieldStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ attribute: false }) options: SelectOption[] = [];
  @property() value = '';
  @property() label = '';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<div class="field select">
      <select
        part="select"
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        @change=${this.onChange}
      >
        ${this.options.map(
          (option) =>
            html`<option
              value=${option.value}
              ?disabled=${option.disabled}
              .selected=${live(option.value === this.value)}
            >
              ${option.label}
            </option>`,
        )}
      </select>
      ${icon('chevron-down', 14)}
    </div>`;
  }

  private onChange = (event: Event) => {
    this.value = (event.target as HTMLSelectElement).value;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-select': PsSelect;
  }
}
