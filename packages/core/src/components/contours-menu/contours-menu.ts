import { LitElement, html } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import {
  DENSITY_DEFAULT,
  DENSITY_LAYER_MODES,
  DENSITY_MODE_LABELS,
  type DensityLayerMode,
} from '@protspace/utils';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import '../kit/tooltip';
import { contoursMenuStyles } from './contours-menu.styles';

/** Detail of `density-layer-change`, fired when the user picks a contour mode. */
export interface DensityLayerChangeDetail {
  densityLayer: DensityLayerMode;
}

/**
 * The view bar's Contours picker (design decision 9). A pick shows at once and reaches listeners
 * as `density-layer-change` after the next paint, because drawing the contours costs a frame;
 * `applySelection` sets the mode from outside without an event. Re-picking the committed mode
 * dispatches nothing.
 *
 * @fires density-layer-change - `DensityLayerChangeDetail`, bubbling and composed.
 */
@customElement('protspace-contours-menu')
export class ProtspaceContoursMenu extends LitElement {
  static styles = contoursMenuStyles;

  @property({ attribute: 'density-layer' }) densityLayer: DensityLayerMode = DENSITY_DEFAULT;

  @state() private open = false;

  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-menu') private menu!: PsMenu;
  private readonly commit = new AfterPaintCommit();

  /** The mode committed before a pick still waiting; null when none waits. */
  private committedBeforePick: DensityLayerMode | null = null;

  /**
   * A user's pick made from code (the view bar's More menu): shows at once, dispatches after the
   * paint. Re-picking the committed mode dispatches nothing and drops a pick still waiting.
   */
  pick(mode: DensityLayerMode): void {
    const committed = this.committedBeforePick ?? this.densityLayer;
    if (mode === committed) {
      this.cancelPending();
      return;
    }
    this.committedBeforePick = committed;
    this.densityLayer = mode;
    this.commit.schedule(() => {
      this.committedBeforePick = null;
      this.dispatchEvent(
        new CustomEvent<DensityLayerChangeDetail>('density-layer-change', {
          detail: { densityLayer: mode },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  /** Sets the mode from outside (the URL) at once, without an event, dropping a pick still waiting. */
  applySelection(mode: DensityLayerMode): void {
    this.commit.cancel();
    this.committedBeforePick = null;
    this.densityLayer = mode;
  }

  /** Drops a pick still waiting, as a new dataset does, and shows the committed mode again. */
  cancelPending(): void {
    this.commit.cancel();
    if (this.committedBeforePick !== null) this.densityLayer = this.committedBeforePick;
    this.committedBeforePick = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelPending();
  }

  protected firstUpdated(): void {
    this.menu.anchor = this.trigger;
  }

  render() {
    // `density-layer` is a plain attribute: show an unknown token as-is rather than throw.
    const label = DENSITY_MODE_LABELS[this.densityLayer]?.label ?? this.densityLayer;
    return html`
      <ps-button class="trigger" variant="ghost" @click=${this.toggle}>
        <span slot="start" class="icon">${icon('target', 16)}</span>
        <span class="key" part="key">Contours</span>
        <span class="value" part="value">${label}</span>
        <span slot="end" class="chevron">${icon('chevron-down', 14)}</span>
      </ps-button>
      <ps-tooltip text="One ring set per legend colour; not included in exports."></ps-tooltip>
      <ps-menu
        label="Contours"
        .open=${this.open}
        @ps-select=${this.onSelect}
        @ps-close=${this.onClose}
      >
        ${DENSITY_LAYER_MODES.map(
          (mode) =>
            html`<ps-menu-item type="radio" value=${mode} .checked=${mode === this.densityLayer}>
              <span class="item-label">${DENSITY_MODE_LABELS[mode].label}</span>
              <span class="hint">${DENSITY_MODE_LABELS[mode].hint}</span>
            </ps-menu-item>`,
        )}
      </ps-menu>
    `;
  }

  private toggle = () => {
    this.open = !this.open;
  };

  private onSelect = (event: Event) => {
    event.stopPropagation();
    this.open = false;
    this.pick((event as CustomEvent<{ value: DensityLayerMode }>).detail.value);
  };

  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-contours-menu': ProtspaceContoursMenu;
  }
}
