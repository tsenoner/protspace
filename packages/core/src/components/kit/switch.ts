import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { switchStyles } from './choice.styles';

/** An on/off switch. `label` names it when the default slot is empty. */
@customElement('ps-switch')
export class PsSwitch extends LitElement {
  static styles = switchStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property() label = '';

  // The <label> names the button with the slotted text and makes that text toggle it.
  render() {
    return html`<label>
      <button
        part="switch"
        type="button"
        role="switch"
        aria-checked=${String(this.checked)}
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        @click=${this.toggle}
      >
        <span class="thumb"></span>
      </button>
      <slot></slot>
    </label>`;
  }

  private toggle = () => {
    this.checked = !this.checked;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-switch': PsSwitch;
  }
}
