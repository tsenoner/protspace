import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { buttonStyles } from './button.styles';
import { icon, type IconName } from './icon';
import type { Placement } from './position';
import './tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * State an owner sets on a kit button's host that must reach the inner `<button>`, the element that
 * takes focus: `aria-haspopup` and `aria-expanded` for a menu button (ps-menu sets them on its
 * anchor), and `describedBy`, which a ps-tooltip sets on the control it describes.
 */
class KitButtonBase extends LitElement {
  static styles = buttonStyles;
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property({ reflect: true }) variant: ButtonVariant = 'secondary';
  @property({ reflect: true }) size: ButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ attribute: 'aria-haspopup' }) hasPopup: string | null = null;
  @property({ attribute: 'aria-expanded' }) expanded: string | null = null;
  /** Elements that describe this control; an id reference cannot reach into the shadow root. */
  @property({ attribute: false }) describedBy: readonly Element[] = [];

  protected button(content: unknown, label?: string, pressed?: boolean) {
    return html`<button
      part="button"
      class=${label === undefined ? nothing : 'icon-only'}
      type="button"
      aria-label=${label ?? nothing}
      aria-pressed=${pressed === undefined ? nothing : String(pressed)}
      aria-haspopup=${this.hasPopup ?? nothing}
      aria-expanded=${this.expanded ?? nothing}
      .ariaDescribedByElements=${this.describedBy.length ? this.describedBy : null}
      ?disabled=${this.disabled}
    >
      ${content}
    </button>`;
  }
}

/** A text button. Put an icon in the `start` slot. */
@customElement('ps-button')
export class PsButton extends KitButtonBase {
  render() {
    return this.button(html`<slot name="start"></slot><slot></slot><slot name="end"></slot>`);
  }
}

/** An icon-only button. `label` is required: it is the accessible name and the tooltip. */
@customElement('ps-icon-button')
export class PsIconButton extends KitButtonBase {
  @property() icon: IconName = 'x';
  @property() label = '';
  @property({ reflect: true }) override variant: ButtonVariant = 'ghost';
  /** Set for toggles such as the plot's tools; leave unset for plain actions. */
  @property({ type: Boolean }) pressed?: boolean;
  /** Where the label tooltip opens: right of the plot's tool strip, left of the sidebar rail. */
  @property({ attribute: 'tooltip-placement' }) tooltipPlacement: Placement = 'top';

  render() {
    if (!this.label) console.warn(`<ps-icon-button icon="${this.icon}"> needs a label`);
    // The label is already the button's name, so the tooltip does not describe it again.
    return html`${this.button(
        icon(this.icon, this.size === 'sm' ? 14 : 16),
        this.label,
        this.pressed,
      )}
      <ps-tooltip text=${this.label} placement=${this.tooltipPlacement} names-target></ps-tooltip>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-button': PsButton;
    'ps-icon-button': PsIconButton;
  }
}
