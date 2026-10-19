import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import '../kit/tooltip';
import { EXPORT_DEFAULTS } from './export-defaults';
import { exportMenuStyles } from './export-menu.styles';

/** What an `export` event asks the host to produce. */
export interface ExportEventDetail {
  type: 'png' | 'pdf' | 'ids' | 'tsv' | 'parquet';
  imageWidth: number;
  imageHeight: number;
  legendWidthPercent: number;
  legendFontSizePx: number;
  includeLegend: boolean;
  includeLegendSettings: boolean;
}

/** The exports that run at once, with fixed sizes, in menu order. */
const QUICK_EXPORTS: ReadonlyArray<{ value: ExportEventDetail['type']; label: string }> = [
  { value: 'png', label: 'Quick PNG' },
  { value: 'pdf', label: 'Quick PDF' },
  { value: 'ids', label: 'Protein IDs (.txt)' },
  { value: 'tsv', label: 'Table (.tsv)' },
  { value: 'parquet', label: 'Data bundle (.parquetbundle)' },
];

/**
 * The note under the items. A `ps-menu-label` is presentation, which assistive tech skips, so the
 * two quick image exports it is about name it as their description.
 */
const CONTOURS_NOTE_ID = 'export-contours-note';

const FIGURE_EDITOR = 'figure';
const INCLUDE_SETTINGS = 'include-settings';

/**
 * The Export menu (design decisions 1 and 15): the figure editor, the five quick exports and
 * whether a data bundle carries the legend settings, as one ps-menu. It only asks: `export` and
 * `open-publish-editor` are the host's to act on, and the host confirms every export.
 */
@customElement('protspace-export-menu')
export class ProtspaceExportMenu extends LitElement {
  static styles = exportMenuStyles;

  /** The loaded file carries saved settings, which a data bundle export can carry on. */
  @property({ type: Boolean, attribute: 'has-file-settings' }) hasFileSettings = false;

  @state() private open = false;
  @state() private includeLegendSettings = true;
  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-menu') private menu!: PsMenu;
  /** The control the menu opened from through openFrom; null while it belongs to its trigger. */
  private anchorEl: HTMLElement | null = null;

  /** Checks "Include legend settings" again, as for a new dataset. */
  reset(): void {
    this.includeLegendSettings = true;
  }

  /**
   * Opens the menu under `anchor`, focus on its first item, as its own trigger does. When it
   * closes, focus returns to `anchor` and the menu belongs to its trigger again. The app's More
   * sheet opens it this way on phones, where the Export button is hidden.
   */
  openFrom(anchor: HTMLElement): void {
    if (this.open && this.anchorEl === anchor) return;
    this.anchorEl = anchor;
    this.menu.anchor = anchor;
    this.open = true;
  }

  /** Gives the menu back to its own trigger after an openFrom. */
  private restoreAnchor(): void {
    if (!this.anchorEl) return;
    this.anchorEl = null;
    this.menu.anchor = this.trigger;
  }

  protected firstUpdated(): void {
    // Set once the trigger exists, so the menu marks it as its menu button before any opening.
    this.menu.anchor = this.trigger;
  }

  render() {
    return html`<ps-button class="trigger" part="trigger" variant="secondary" @click=${this.toggle}>
        <span slot="start" class="trigger-icon">${icon('download', 16)}</span>
        <span part="trigger-label">Export</span>
        <span slot="end" class="trigger-icon">${icon('chevron-down', 14)}</span>
      </ps-button>
      ${this.hasFileSettings
        ? html`<ps-tooltip text="File contains custom settings"></ps-tooltip>`
        : nothing}
      <ps-menu
        label="Export"
        placement="bottom-end"
        .open=${this.open}
        @ps-close=${this.onClose}
        @ps-select=${this.onSelect}
      >
        <ps-menu-item value=${FIGURE_EDITOR}>Figure editor…</ps-menu-item>
        ${QUICK_EXPORTS.map(
          ({ value, label }) =>
            html`<ps-menu-item
              value=${value}
              aria-describedby=${value === 'png' || value === 'pdf' ? CONTOURS_NOTE_ID : nothing}
              >${label}</ps-menu-item
            >`,
        )}
        <ps-menu-item
          type="checkbox"
          value=${INCLUDE_SETTINGS}
          .checked=${this.includeLegendSettings}
          >Include legend settings</ps-menu-item
        >
        <ps-menu-label id=${CONTOURS_NOTE_ID} class="export-note"
          >Quick exports leave out contours.</ps-menu-label
        >
      </ps-menu>`;
  }

  private toggle = () => {
    this.restoreAnchor();
    this.open = !this.open;
  };

  /** The menu closed itself (Escape, a press outside, Tab, or a chosen item) and refocused. */
  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
    this.restoreAnchor();
  };

  private onSelect = (event: Event) => {
    event.stopPropagation();
    const { value, checked } = (event as CustomEvent<{ value: string; checked: boolean }>).detail;
    if (value === INCLUDE_SETTINGS) {
      // A checkbox item keeps the menu open.
      this.includeLegendSettings = checked;
      return;
    }
    if (value === FIGURE_EDITOR) {
      this.dispatchEvent(
        new CustomEvent('open-publish-editor', { detail: {}, bubbles: true, composed: true }),
      );
      return;
    }
    const quick = QUICK_EXPORTS.find((entry) => entry.value === value);
    if (!quick) return;
    const detail: ExportEventDetail = {
      type: quick.value,
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
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-export-menu': ProtspaceExportMenu;
  }
}
