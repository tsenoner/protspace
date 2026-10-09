import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { buttonStyles } from './button.styles';
import { icon, type IconName } from './icon';
import './tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/** A text button. Put an icon in the `start` slot. */
@customElement('ps-button')
export class PsButton extends LitElement {
  static styles = buttonStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ reflect: true }) variant: ButtonVariant = 'secondary';
  @property({ reflect: true }) size: ButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html`<button part="button" type="button" ?disabled=${this.disabled}>
      <slot name="start"></slot><slot></slot><slot name="end"></slot>
    </button>`;
  }
}

/** An icon-only button. `label` is required: it is the accessible name and the tooltip. */
@customElement('ps-icon-button')
export class PsIconButton extends LitElement {
  static styles = buttonStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() icon: IconName = 'x';
  @property() label = '';
  @property({ reflect: true }) variant: ButtonVariant = 'ghost';
  @property({ reflect: true }) size: ButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Set for toggles such as the plot's tools; leave unset for plain actions. */
  @property({ type: Boolean }) pressed?: boolean;

  render() {
    if (!this.label) console.warn(`<ps-icon-button icon="${this.icon}"> needs a label`);
    return html`<button
        part="button"
        class="icon-only"
        type="button"
        aria-label=${this.label}
        aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
        ?disabled=${this.disabled}
      >
        ${icon(this.icon, this.size === 'sm' ? 14 : 16)}
      </button>
      <ps-tooltip text=${this.label}></ps-tooltip>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-button': PsButton;
    'ps-icon-button': PsIconButton;
  }
}
