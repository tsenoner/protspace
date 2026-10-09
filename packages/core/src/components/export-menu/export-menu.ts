import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { deepActiveElement, flatContains } from '../kit/focus';
import { icon } from '../kit/icon';
import { pushLayer } from '../kit/layers';
import '../kit/tooltip';
import { EXPORT_DEFAULTS } from './export-defaults';
import { exportMenuStyles } from './export-menu.styles';

/** What an `export` event asks the host to produce. */
export interface ExportEventDetail {
  type: 'png' | 'pdf' | 'ids' | 'parquet';
  imageWidth: number;
  imageHeight: number;
  legendWidthPercent: number;
  legendFontSizePx: number;
  includeLegend: boolean;
  includeLegendSettings: boolean;
}

const FORMATS: ReadonlyArray<{ value: ExportEventDetail['type']; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
  { value: 'ids', label: 'IDs' },
  { value: 'parquet', label: 'Parquet' },
];

/**
 * The Export menu: a format, then the figure editor or a quick export (design decisions 1, 9 and
 * 15). Its panel is a layer of the kit's layer stack, so Escape and a press outside close it and
 * focus returns to the trigger. It only asks: `export` and `open-publish-editor` are the host's to
 * act on. Phase 4.8 rebuilds the panel on the kit.
 */
@customElement('protspace-export-menu')
export class ProtspaceExportMenu extends LitElement {
  static styles = exportMenuStyles;

  /** The loaded file carries saved settings, which a Parquet export can carry on. */
  @property({ type: Boolean, attribute: 'has-file-settings' }) hasFileSettings = false;

  @state() private open = false;
  @state() private format: ExportEventDetail['type'] = EXPORT_DEFAULTS.FORMAT;
  @state() private includeLegendSettings = true;
  @query('.trigger') private trigger!: HTMLButtonElement;
  private releaseLayer?: () => void;

  /** Back to PNG with the legend settings included, as for a new dataset. */
  reset(): void {
    this.format = EXPORT_DEFAULTS.FORMAT;
    this.includeLegendSettings = true;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('focusout', this.onFocusOut);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('focusout', this.onFocusOut);
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    this.open = false;
  }

  render() {
    return html`<button
        class="trigger"
        type="button"
        aria-label="Export"
        aria-expanded=${String(this.open)}
        @click=${this.toggle}
      >
        ${icon('download', 16)}<span part="trigger-label">Export</span>${icon('chevron-down', 14)}
      </button>
      ${this.hasFileSettings
        ? html`<ps-tooltip text="File contains custom settings"></ps-tooltip>`
        : nothing}
      ${this.open ? this.renderPanel() : nothing}`;
  }

  private renderPanel() {
    const image = this.format === 'png' || this.format === 'pdf';
    const formatName = this.format.toUpperCase();
    return html`<div class="panel export-menu">
      <div class="export-menu-header"><span>Export Options</span></div>
      <div class="export-option-group">
        <span class="export-option-label" id="export-format-label">Format</span>
        <div class="export-format-options" role="group" aria-labelledby="export-format-label">
          ${FORMATS.map(
            ({ value, label }) =>
              html`<button
                type="button"
                class="btn btn-secondary btn-compact ${value === this.format ? 'active' : ''}"
                aria-pressed=${String(value === this.format)}
                @click=${() => (this.format = value)}
              >
                ${label}
              </button>`,
          )}
        </div>
      </div>
      ${this.format === 'parquet'
        ? html`<div class="export-option-group">
            <label class="export-checkbox-label">
              <input
                type="checkbox"
                class="export-checkbox"
                .checked=${this.includeLegendSettings}
                @change=${(event: Event) =>
                  (this.includeLegendSettings = (event.target as HTMLInputElement).checked)}
              />
              <span>Include legend settings</span>
            </label>
            <div class="export-parquet-help">
              Legend customizations can be saved in the file and restored when loading.
            </div>
          </div>`
        : nothing}
      ${image
        ? html`<div class="export-image-actions">
              <button type="button" class="btn btn-primary" @click=${this.openFigureEditor}>
                ${icon('square-pen', 16)} Figure Editor
              </button>
              <button type="button" class="btn btn-secondary" @click=${this.exportNow}>
                ${icon('download', 16)} Quick Export ${formatName}
              </button>
            </div>
            <div class="export-image-hint">
              Figure Editor offers live preview, journal presets, annotations, and more.
            </div>`
        : html`<button
            type="button"
            class="btn btn-primary export-action-btn"
            @click=${this.exportNow}
          >
            ${icon('download', 16)} Export ${formatName}
          </button>`}
    </div>`;
  }

  /**
   * Tab out of the panel closes it, as ps-menu does. Focus moving inside the shadow root reaches
   * this host listener retargeted to the host itself; a null target (a press on the panel's
   * background, or the window losing focus) leaves it open.
   */
  private onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (this.open && next && !flatContains(this, next)) this.close();
  };

  private toggle = () => {
    if (this.open) this.close();
    else this.show();
  };

  private show(): void {
    this.open = true;
    this.releaseLayer = pushLayer({ close: () => this.close(), elements: [this] });
    // Keyboard users land on the first format, as in the control bar's menu.
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLButtonElement>('.export-format-options button')?.focus(),
    );
  }

  /** Closes the panel; focus that was inside the menu goes back to the trigger. */
  private close(): void {
    if (!this.open) return;
    const focusWasInside = flatContains(this, deepActiveElement());
    this.open = false;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (focusWasInside) this.trigger.focus();
  }

  private exportNow = () => {
    const detail: ExportEventDetail = {
      type: this.format,
      imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
      imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
      legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
      legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
      includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
      includeLegendSettings: this.includeLegendSettings,
    };
    this.dispatchEvent(
      new CustomEvent<ExportEventDetail>('export', { detail, bubbles: true, composed: true }),
    );
    this.close();
  };

  private openFigureEditor = () => {
    this.dispatchEvent(
      new CustomEvent('open-publish-editor', { detail: {}, bubbles: true, composed: true }),
    );
    this.close();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-export-menu': ProtspaceExportMenu;
  }
}
