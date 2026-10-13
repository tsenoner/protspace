import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsIconButton } from '../kit/button';
import type { IconName } from '../kit/icon';
import { plotToolsStyles } from './plot-tools.styles';

/** What a press on the plot does: move and zoom, or select with a box or a lasso. */
export type PlotTool = 'pan' | 'rectangle' | 'lasso';

const TOOLS: ReadonlyArray<{ tool: PlotTool; icon: IconName; label: string }> = [
  { tool: 'pan', icon: 'mouse-pointer', label: 'Move and zoom' },
  { tool: 'rectangle', icon: 'square-dashed', label: 'Box select' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso select' },
];

/**
 * The plot's tool strip (design decision 1): a vertical toolbar for the plot's top-left corner,
 * and beside it, while the plot is isolated, Reset. The selection's own actions are the selection
 * bar's (`protspace-selection-bar`). It reports choices; the host's selection controller sets the
 * plot and these properties.
 *
 * @fires plot-tool-change - `{ tool: PlotTool }`
 * @fires fit-view - `{}`
 * @fires reset-isolation - `{}`
 */
@customElement('protspace-plot-tools')
export class ProtspacePlotTools extends LitElement {
  static styles = plotToolsStyles;

  @property() tool: PlotTool = 'pan';
  /** Box and Lasso are off: the view holds too few points to select from. */
  @property({ type: Boolean, attribute: 'selection-disabled' }) selectionDisabled = false;
  @property({ type: Boolean }) isolated = false;

  render() {
    return html`
      <div
        class="tools"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Plot tools"
        @keydown=${this.onToolbarKeydown}
      >
        ${TOOLS.map(({ tool, icon, label }) => {
          const unavailable = tool !== 'pan' && this.selectionDisabled;
          return html`<ps-icon-button
            tabindex=${tool === this.tabStop ? '0' : '-1'}
            size="sm"
            icon=${icon}
            label=${unavailable ? `${label} (needs at least 2 points)` : label}
            tooltip-placement="right"
            .pressed=${this.tool === tool}
            ?disabled=${unavailable}
            @click=${() => this.choose(tool)}
          ></ps-icon-button>`;
        })}
        <div class="separator" role="separator"></div>
        <ps-icon-button
          tabindex="-1"
          size="sm"
          icon="maximize"
          label="Fit to view"
          tooltip-placement="right"
          @click=${() => this.emit('fit-view')}
        ></ps-icon-button>
      </div>
      ${this.isolated
        ? html`<div class="selection" role="group" aria-label="Isolation">
            <ps-button size="sm" variant="ghost" @click=${this.resetIsolation}>Reset</ps-button>
          </div>`
        : nothing}
    `;
  }

  /** The toolbar's one Tab stop (roving tabindex): the current tool, or Move and zoom. */
  private get tabStop(): PlotTool {
    return this.tool !== 'pan' && this.selectionDisabled ? 'pan' : this.tool;
  }

  /** Set when Reset had focus: leaving isolation removes it. */
  private restoreFocus = false;

  private resetIsolation = () => {
    this.restoreFocus = this.shadowRoot!.activeElement !== null;
    this.emit('reset-isolation');
  };

  protected updated(): void {
    if (!this.restoreFocus) return;
    this.restoreFocus = false;
    // Reset is still there.
    if (this.shadowRoot!.activeElement) return;
    this.focusTool();
  }

  /** Focuses the tool strip's one Tab stop: the current tool, or Move and zoom. */
  focusTool(): void {
    const tools = this.renderRoot.querySelectorAll<PsIconButton>('.tools ps-icon-button');
    tools[TOOLS.findIndex(({ tool }) => tool === this.tabStop)]?.focus();
  }

  private choose(tool: PlotTool): void {
    // Re-picking the current tool changes nothing, so nothing is reported.
    if (tool === this.tool) return;
    this.tool = tool;
    this.emit('plot-tool-change', { tool });
  }

  private emit(type: string, detail: object = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /**
   * The vertical toolbar pattern: one Tab stop, and ArrowUp and ArrowDown move between the enabled
   * tools.
   */
  private onToolbarKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [
      ...this.renderRoot.querySelectorAll<PsIconButton>('.tools ps-icon-button'),
    ].filter((button) => !button.disabled);
    const current = buttons.indexOf(this.shadowRoot!.activeElement as PsIconButton);
    if (current === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : buttons.length - 1;
    buttons[(current + step) % buttons.length].focus();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-plot-tools': ProtspacePlotTools;
  }
}
