import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import '../kit/checkbox';
import type { PsCheckbox } from '../kit/checkbox';
import { icon } from '../kit/icon';
import '../kit/popover';
import type { PsPopover } from '../kit/popover';
import type { Placement } from '../kit/position';
import '../kit/segmented';
import type { PsSegmented, SegmentedOption } from '../kit/segmented';
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

/** The panel's first choice: what to export. An image then takes a format. */
type ExportKind = 'image' | 'ids' | 'tsv' | 'parquet';
type ImageFormat = 'png' | 'pdf';

const KINDS: SegmentedOption[] = [
  { value: 'image', label: 'Image' },
  { value: 'ids', label: 'Protein IDs' },
  { value: 'tsv', label: 'Table' },
  { value: 'parquet', label: 'Data bundle' },
];

const FORMATS: SegmentedOption[] = [
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
];

/** The primary button names the file it downloads. */
const DOWNLOAD_LABELS: Record<ExportEventDetail['type'], string> = {
  png: 'Download PNG',
  pdf: 'Download PDF',
  ids: 'Download .txt',
  tsv: 'Download .tsv',
  parquet: 'Download .parquetbundle',
};

const IMAGE_NOTE =
  `The current view and its legend at ${EXPORT_DEFAULTS.IMAGE_WIDTH} × ` +
  `${EXPORT_DEFAULTS.IMAGE_HEIGHT} px, without contours. For another size or layout, use the ` +
  'Figure editor.';

const NOTES: Record<Exclude<ExportKind, 'parquet'>, string> = {
  image: IMAGE_NOTE,
  ids: "The visible proteins' IDs, one per line.",
  tsv: 'The visible proteins, one row each, with their coordinates and annotations.',
};

/**
 * The Export panel (design decisions 1 and 15, reworked after review): pick what to export, then
 * how, then one Download. It is a `ps-popover` with role dialog, a layer of the kit's layer stack,
 * and a bottom sheet on a phone: Escape, a press outside or Tab out of it close it, and focus
 * returns to the control that opened it. It only asks: `export` and `open-publish-editor` are the
 * host's to act on, and the host confirms every export. The figure editor has its own button in
 * the host; `openFigureEditor` sends its request through this element, where the host listens for
 * every export.
 */
@customElement('protspace-export-menu')
export class ProtspaceExportMenu extends LitElement {
  static styles = exportMenuStyles;

  /** The loaded file carries saved settings, which a data bundle export can carry on. */
  @property({ type: Boolean, attribute: 'has-file-settings' }) hasFileSettings = false;

  @state() private open = false;
  @state() private kind: ExportKind = 'image';
  @state() private format: ImageFormat = 'png';
  @state() private includeLegendSettings = true;
  /** Where the panel opens: leftward under its own trigger, as an openFrom asks otherwise. */
  @state() private placement: Placement = 'bottom-end';
  /** The control the panel opened from through openFrom; null while it belongs to its trigger. */
  @state() private anchorEl: HTMLElement | null = null;
  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-popover') private panelPopover!: PsPopover;
  @query('.export-kind') private kindPicker!: PsSegmented;
  /** The anchor this panel marked as its disclosure button, with the attribute values it had. */
  private marked?: { el: Element; hasPopup: string | null; expanded: string | null };

  /** Checks "Include legend settings" again, as for a new dataset. */
  reset(): void {
    this.includeLegendSettings = true;
  }

  /**
   * Opens the panel under `anchor`, focus on its first choice, as its own trigger does. When it
   * closes, focus returns to `anchor` and the panel belongs to its trigger again. The app's More
   * sheet opens it this way on phones; the dataset name's Import panel, from that name's left
   * edge (`bottom-start`).
   */
  openFrom(anchor: HTMLElement, placement: Placement = 'bottom-end'): void {
    if (this.open && this.anchorEl === anchor) return;
    this.anchorEl = anchor;
    this.placement = placement;
    this.open = true;
  }

  /**
   * Asks the host for the figure editor. The editor is not in this panel: the host gives it a
   * button of its own, which calls this so the request reaches the host where every export does.
   */
  openFigureEditor(): void {
    this.dispatchEvent(
      new CustomEvent('open-publish-editor', { detail: {}, bubbles: true, composed: true }),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unmarkAnchor();
  }

  // A plain Map: `open` and `anchorEl` are private, so not keys PropertyValues<this> accepts.
  protected updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('open') || changed.has('anchorEl')) this.markAnchor();
  }

  /** Marks the control the panel opens from as its disclosure button, as ps-menu marks its own. */
  private markAnchor(): void {
    const anchor = this.anchorEl ?? this.trigger;
    if (!anchor) return;
    if (this.marked?.el !== anchor) {
      this.unmarkAnchor();
      this.marked = {
        el: anchor,
        hasPopup: anchor.getAttribute('aria-haspopup'),
        expanded: anchor.getAttribute('aria-expanded'),
      };
    }
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', String(this.open));
  }

  /** Puts back what the marked anchor had: More and the dataset name keep their own state. */
  private unmarkAnchor(): void {
    if (!this.marked) return;
    const { el, hasPopup, expanded } = this.marked;
    this.marked = undefined;
    const restore = (name: string, value: string | null) =>
      value === null ? el.removeAttribute(name) : el.setAttribute(name, value);
    restore('aria-haspopup', hasPopup);
    restore('aria-expanded', expanded);
  }

  render() {
    return html`<ps-button class="trigger" part="trigger" variant="secondary" @click=${this.toggle}>
        <span slot="start" class="trigger-icon">${icon('download', 16)}</span>
        <span part="trigger-label">Export</span>
        <span slot="end" class="trigger-icon">${icon('chevron-down', 14)}</span>
      </ps-button>
      <ps-popover
        .anchor=${this.anchorEl ?? this.trigger ?? null}
        .open=${this.open}
        placement=${this.placement}
        panel-role="dialog"
        panel-label="Export"
        sheet
        close-on-tab-out
        @ps-open=${this.onOpen}
        @ps-close=${this.onClose}
      >
        ${this.renderPanel()}
      </ps-popover>`;
  }

  /**
   * Always rendered, hidden with the popover while closed: a download closes the panel, and its
   * focused button must still be there when the popover hands focus back to the anchor.
   */
  private renderPanel() {
    const type = this.exportType();
    return html`<div class="export-panel">
      <div class="export-head">
        <h2 class="export-title">Export</h2>
        <ps-icon-button
          class="export-close"
          icon="x"
          label="Close"
          size="sm"
          @click=${this.dismiss}
        ></ps-icon-button>
      </div>
      <ps-segmented
        class="export-kind"
        label="What to export"
        .options=${KINDS}
        .value=${this.kind}
        @change=${this.onKindChange}
      ></ps-segmented>
      <div class="export-options">
        ${this.kind === 'image' ? this.renderFormat() : nothing}
        ${this.kind === 'parquet'
          ? this.renderBundleOptions()
          : html`<p class="export-note">${NOTES[this.kind]}</p>`}
      </div>
      <ps-button class="export-download" variant="primary" @click=${this.download}
        ><span slot="start">${icon('download', 16)}</span>${DOWNLOAD_LABELS[type]}</ps-button
      >
    </div>`;
  }

  private renderFormat() {
    return html`<div class="export-field">
      <!-- The radio group carries the name; the word is for the eye. -->
      <span class="export-field-label" aria-hidden="true">Format</span>
      <ps-segmented
        class="export-format"
        label="Format"
        .options=${FORMATS}
        .value=${this.format}
        @change=${this.onFormatChange}
      ></ps-segmented>
    </div>`;
  }

  private renderBundleOptions() {
    return html`<ps-checkbox
        class="export-settings"
        .checked=${this.includeLegendSettings}
        @change=${this.onSettingsChange}
        >Include legend settings</ps-checkbox
      >
      <p class="export-note export-settings-help">
        Opening the file restores your colours, shapes and order.
      </p>
      ${this.hasFileSettings
        ? html`<p class="export-note export-file-settings">
            ${icon('info', 14)}<span>The loaded file contains custom settings.</span>
          </p>`
        : nothing}`;
  }

  private exportType(): ExportEventDetail['type'] {
    return this.kind === 'image' ? this.format : this.kind;
  }

  private toggle = () => {
    this.restoreAnchor();
    this.open = !this.open;
  };

  /** Gives the panel back to its own trigger after an openFrom. */
  private restoreAnchor(): void {
    if (!this.anchorEl) return;
    this.anchorEl = null;
    this.placement = 'bottom-end';
  }

  /** Keyboard users land on the first choice, the kind on screen, as in the other panels. */
  private onOpen = (event: Event) => {
    event.stopPropagation();
    void this.kindPicker.updateComplete.then(() => {
      if (!this.open) return;
      this.kindPicker.shadowRoot
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus();
    });
  };

  /** The popover closed itself (Escape, a press outside, Tab out or a download) and refocused. */
  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
    this.restoreAnchor();
  };

  private dismiss = () => {
    this.panelPopover.dismiss();
  };

  private onKindChange = (event: Event) => {
    this.kind = (event as CustomEvent<{ value: ExportKind }>).detail.value;
  };

  private onFormatChange = (event: Event) => {
    this.format = (event as CustomEvent<{ value: ImageFormat }>).detail.value;
  };

  private onSettingsChange = (event: Event) => {
    this.includeLegendSettings = (event.target as PsCheckbox).checked;
  };

  /** Closes the panel first (focus back on the anchor), then asks for the file. */
  private download = () => {
    const detail: ExportEventDetail = {
      type: this.exportType(),
      imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
      imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
      legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
      legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
      includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
      includeLegendSettings: this.includeLegendSettings,
    };
    this.panelPopover.dismiss();
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
