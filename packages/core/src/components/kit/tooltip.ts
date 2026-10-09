import { LitElement, html, type PropertyValues } from 'lit';
import { property, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { anchorTo, type Placement } from './position';
import { tooltipStyles } from './tooltip.styles';

const HOVER_DELAY_MS = 500;

/**
 * A short label for a control. It replaces native `title` tooltips (design decision 8). It is not a
 * layer: Escape hides it without being consumed.
 *
 * The host is the `role="tooltip"` node and carries the text as its `aria-label`, so the text is
 * readable while the panel is hidden. The target references the host through
 * `ariaDescribedByElements`: an id cannot cross a shadow boundary, while an element reference may
 * point out of a shadow root, so a kit button's inner `<button>` can reference a tooltip beside it.
 */
@customElement('ps-tooltip')
export class PsTooltip extends LitElement {
  static styles = tooltipStyles;

  @property() text = '';
  @property() placement: Placement = 'top';
  /** The described element; defaults to the previous element sibling. */
  @property({ attribute: false }) anchor: Element | null = null;
  /** The text is already the target's accessible name (ps-icon-button), so do not describe it. */
  @property({ type: Boolean, attribute: 'names-target' }) namesTarget = false;

  @query('.tip') private tip!: HTMLElement;
  private target: Element | null = null;
  private timer = 0;
  private stopPositioning?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tooltip');
    // Removed in the same task it was added: bind nothing, or the listeners would leak.
    queueMicrotask(() => {
      if (this.isConnected) this.bind();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.hide();
    this.unbind();
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('text')) {
      if (this.text) this.setAttribute('aria-label', this.text);
      else this.removeAttribute('aria-label');
    }
    if (changed.has('namesTarget') && this.target) this.describe(this.target, !this.namesTarget);
    if (changed.has('anchor') && this.isConnected) this.bind();
  }

  render() {
    return html`<div class="tip" part="tip" popover="manual">${this.text}</div>`;
  }

  show(): void {
    if (!this.text || !this.target?.isConnected || !this.isConnected) return;
    document.addEventListener('keydown', this.onKeydown, true);
    if (!this.tip.matches(':popover-open')) this.tip.showPopover();
    this.stopPositioning ??= anchorTo(this.target, this.tip, this.placement);
  }

  hide(): void {
    clearTimeout(this.timer);
    document.removeEventListener('keydown', this.onKeydown, true);
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
    if (next && !this.namesTarget) this.describe(next, true);
  }

  private unbind(): void {
    this.target?.removeEventListener('pointerenter', this.onEnter);
    this.target?.removeEventListener('pointerleave', this.onLeave);
    this.target?.removeEventListener('focusin', this.onFocus);
    this.target?.removeEventListener('focusout', this.onLeave);
    if (this.target) this.describe(this.target, false);
    this.target = null;
  }

  /** Adds or removes this tooltip in the target's described-by elements. */
  private describe(target: Element, on: boolean): void {
    // A kit button forwards describedBy to its inner <button>, the element that takes focus.
    const kit = 'describedBy' in target ? (target as { describedBy: readonly Element[] }) : null;
    const current = (kit ? kit.describedBy : target.ariaDescribedByElements) ?? [];
    const rest = current.filter((el) => el !== this);
    const next = on ? [...rest, this] : rest;
    if (next.length === current.length) return;
    if (kit) kit.describedBy = next;
    else target.ariaDescribedByElements = next.length ? next : null;
  }

  private onEnter = () => {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_DELAY_MS);
  };

  private onLeave = () => this.hide();

  private onFocus = (event: Event) => {
    // Through a shadow host (ps-button), event.target is the host, which never matches
    // :focus-visible; the inner element that took focus does.
    if ((event.composedPath()[0] as Element).matches(':focus-visible')) this.show();
  };

  // On the document while shown, so Escape hides a hover-shown tooltip too (WCAG 1.4.13).
  private onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape') this.hide();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-tooltip': PsTooltip;
  }
}
