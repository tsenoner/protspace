import { LitElement, html, type PropertyValues } from 'lit';
import { property, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { anchorTo, type Placement } from './position';
import { tooltipStyles } from './tooltip.styles';

const HOVER_DELAY_MS = 500;

/**
 * A short label for a control. It replaces native `title` tooltips (design decision 8). It is not a
 * layer: Escape hides it without being consumed.
 */
@customElement('ps-tooltip')
export class PsTooltip extends LitElement {
  static styles = tooltipStyles;

  @property() text = '';
  @property() placement: Placement = 'top';
  /** The described element; defaults to the previous element sibling. */
  @property({ attribute: false }) anchor: Element | null = null;

  @query('.tip') private tip!: HTMLElement;
  private target: Element | null = null;
  private timer = 0;
  private stopPositioning?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this.bind());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.hide();
    this.unbind();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('anchor')) this.bind();
  }

  render() {
    return html`<div class="tip" part="tip" popover="manual" role="tooltip">${this.text}</div>`;
  }

  show(): void {
    if (!this.text || !this.target || !this.isConnected) return;
    if (!this.tip.matches(':popover-open')) this.tip.showPopover();
    this.stopPositioning ??= anchorTo(this.target, this.tip, this.placement);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.stopPositioning?.();
    this.stopPositioning = undefined;
    if (this.tip?.matches(':popover-open')) this.tip.hidePopover();
  }

  private bind(): void {
    const next = this.anchor ?? this.previousElementSibling;
    if (next === this.target) return;
    this.unbind();
    this.target = next;
    next?.addEventListener('pointerenter', this.onEnter);
    next?.addEventListener('pointerleave', this.onLeave);
    next?.addEventListener('focusin', this.onFocus);
    next?.addEventListener('focusout', this.onLeave);
    next?.addEventListener('keydown', this.onKeydown);
  }

  private unbind(): void {
    this.target?.removeEventListener('pointerenter', this.onEnter);
    this.target?.removeEventListener('pointerleave', this.onLeave);
    this.target?.removeEventListener('focusin', this.onFocus);
    this.target?.removeEventListener('focusout', this.onLeave);
    this.target?.removeEventListener('keydown', this.onKeydown);
    this.target = null;
  }

  private onEnter = () => {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_DELAY_MS);
  };

  private onLeave = () => this.hide();

  private onFocus = (event: Event) => {
    if ((event.target as Element).matches(':focus-visible')) this.show();
  };

  private onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') this.hide();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-tooltip': PsTooltip;
  }
}
