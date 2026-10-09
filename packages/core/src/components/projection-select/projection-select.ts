import { LitElement, html } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import { projectionSelectStyles } from './projection-select.styles';

/**
 * The view bar's Projection picker (design decision 9): a ghost key/value trigger over a menu of
 * radio items. A pick shows at once and reaches listeners as `projection-change` after the next
 * paint, because a switch moves every point; `applySelection` applies at once. Re-picking the
 * committed projection dispatches nothing.
 *
 * @fires projection-change - `{ projection: string }`, bubbling and composed.
 */
@customElement('protspace-projection-select')
export class ProtspaceProjectionSelect extends LitElement {
  static styles = projectionSelectStyles;

  /** The projections to offer, by name, in menu order. */
  @property({ attribute: false }) projections: readonly string[] = [];
  /** The projection the plot shows. */
  @property({ attribute: 'selected-projection' }) selectedProjection = '';

  @state() private open = false;
  /** A menu pick waiting for its commit; the trigger shows it until then. */
  @state() private pending: string | null = null;

  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-menu') private menu!: PsMenu;
  private readonly commit = new AfterPaintCommit();

  /** Makes `projection` current now, drops a pick still waiting, and dispatches the change. */
  applySelection(projection: string): void {
    this.commit.cancel();
    this.pending = null;
    this.selectedProjection = projection;
    this.dispatchEvent(
      new CustomEvent('projection-change', {
        detail: { projection },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Drops a pick still waiting, as a new dataset does. */
  cancelPending(): void {
    this.commit.cancel();
    this.pending = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelPending();
  }

  protected firstUpdated(): void {
    // Set once, so the menu marks the trigger with aria-haspopup before the first opening.
    this.menu.anchor = this.trigger;
  }

  render() {
    const shown = this.pending ?? this.selectedProjection;
    return html`
      <ps-button
        class="trigger"
        variant="ghost"
        ?disabled=${this.projections.length === 0}
        @click=${this.toggle}
      >
        <span class="key" part="key">Projection</span>
        <span class="value" part="value">${shown || 'None'}</span>
        <span slot="end" class="chevron">${icon('chevron-down', 14)}</span>
      </ps-button>
      <ps-menu
        label="Projection"
        .open=${this.open}
        @ps-select=${this.onSelect}
        @ps-close=${this.onClose}
      >
        ${this.projections.map(
          (projection) =>
            html`<ps-menu-item type="radio" value=${projection} .checked=${projection === shown}
              >${projection}</ps-menu-item
            >`,
        )}
      </ps-menu>
    `;
  }

  private toggle = () => {
    this.open = !this.open;
  };

  private onSelect = (event: Event) => {
    // The picker's own event is projection-change; the menu's events stay inside.
    event.stopPropagation();
    const { value } = (event as CustomEvent<{ value: string }>).detail;
    this.open = false;
    // Re-picking the committed value changes nothing, and drops a pick still waiting.
    if (value === this.selectedProjection) {
      this.cancelPending();
      return;
    }
    this.pending = value;
    this.commit.schedule(() => this.applySelection(value));
  };

  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-projection-select': ProtspaceProjectionSelect;
  }
}
