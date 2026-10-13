/**
 * `<protspace-publish-modal>` — Full-screen figure editor for publication-ready exports.
 *
 * Hosts a live preview canvas and a settings sidebar with journal presets,
 * legend positioning, highlight annotations, and zoom insets.
 */

import { LitElement, html, nothing } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { isEditableEventPath } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import { tokens } from '../../styles/tokens';
import { buttonMixin } from '../../styles/mixins';
import { publishModalStyles } from './publish-modal.styles';
import { pushLayer } from '../kit/layers';
import { getPreset, type PresetId } from './journal-presets';
import {
  createDefaultPublishState,
  type PublishState,
  type OverlayTool,
  type Overlay,
  type Inset,
} from './publish-state';
import { mmToPx, SIZE_MODE_WIDTH_MM } from './dimension-utils';
import { sanitizePublishState } from './publish-state-validator';
import {
  capturePlotCanvas,
  composeFigure,
  computeLayout,
  waitForFonts,
  type LegendItem,
} from './publish-compositor';
import { PublishOverlayController } from './publish-overlay-controller';
import {
  computeWidthPxUpdate,
  computeWidthMmUpdate,
  computeHeightPxUpdate,
  computeHeightMmUpdate,
  computeDpiUpdate,
  computePresetApplication,
  getActivePresetConstraints,
  getActivePresetMaxHeightPx,
  getActivePresetWidthPx,
  readLegendExportState,
  shouldShowFingerprintWarning,
  type LegendExportState,
} from './publish-modal-helpers';
import { InsetRenderCache, type CaptureablePlotElement } from './inset-render-cache';
import { renderAnnotations } from './sections/annotations-section';
import { renderDimensions } from './sections/dimensions-section';
import { renderLegendSection } from './sections/legend-section';
import { renderOptions, renderPresets } from './sections/presets-options-section';
import { renderToolbar } from './sections/toolbar';

// ── Component ────────────────────────────────────────────────

@customElement('protspace-publish-modal')
export class ProtspacePublishModal extends LitElement {
  static override styles = [tokens, buttonMixin, publishModalStyles];

  /** Plot element to capture from */
  @property({ attribute: false }) plotElement: HTMLElement | null = null;

  /** Legend element to read export state from. Optional — falls back to document.querySelector. */
  @property({ attribute: false })
  legendElement: (HTMLElement & { getLegendExportData?: () => unknown }) | null = null;

  /** Saved publish state from parquetbundle or localStorage, used to restore on open. */
  @property({ attribute: false }) savedPublishState: Record<string, unknown> | null = null;

  /** Current projection info for view fingerprint comparison. */
  @property({ attribute: false }) currentProjection: {
    projection: string;
    dimensionality: number;
  } | null = null;

  @state() private _state: PublishState = createDefaultPublishState();
  @state() private _tool: OverlayTool = 'select';
  /** Currently selected overlay/inset, or null. Click sets it (sidebar or
   *  canvas). Delete/Backspace removes it. Escape clears it, then closes the editor. */
  @state() private _selectedItem: { kind: 'overlay' | 'inset'; index: number } | null = null;
  @state() private _showFingerprintWarning = false;
  @state() private _showResampleNote = false;
  @state() private _legendItems: LegendItem[] = [];
  @state() private _legendTitle = 'Legend';

  @query('.publish-preview-canvas') private _previewCanvas!: HTMLCanvasElement;

  private _overlayController: PublishOverlayController | null = null;
  private _redrawHandle: number | null = null;
  private _plotCacheKey = '';
  private _cachedPlotCanvas: HTMLCanvasElement | null = null;
  /** Per-inset WebGL renders; a burst of updates reuses them, then asks for one more redraw. */
  private _insetRenders = new InsetRenderCache(() => this._scheduleRedraw());
  private _disposed = false;

  // What each sidebar section may change. Built once: a render hands the same objects down.
  private readonly _toolbarHandlers = { setTool: (tool: OverlayTool) => this._setTool(tool) };
  private readonly _presetHandlers = { applyPreset: (id: PresetId) => this._applyPreset(id) };
  private readonly _optionHandlers = {
    update: (partial: Partial<PublishState>) => this._updateState(partial),
  };
  private readonly _dimensionHandlers = {
    widthPx: (px: number) => this._updateWidthPx(px),
    widthMm: (mm: number) => this._updateWidthMm(mm),
    heightPx: (px: number) => this._updateHeightPx(px),
    heightMm: (mm: number) => this._updateHeightMm(mm),
    dpi: (dpi: number) => this._updateDpi(dpi),
    unit: (unit: PublishState['unit']) => this._setUnit(unit),
    toggleResample: () => this._toggleResample(),
    toggleAspectLock: () => this._toggleAspectLock(),
  };
  private readonly _legendHandlers = {
    updateLegend: (partial: Partial<PublishState['legend']>) => this._updateLegend(partial),
  };
  private readonly _annotationHandlers = {
    select: (selected: { kind: 'overlay' | 'inset'; index: number }) =>
      this._setSelection(selected),
    removeOverlay: (index: number) => this._removeOverlay(index),
    updateOverlay: (index: number, partial: Partial<Overlay>) =>
      this._updateOverlay(index, partial),
    removeInset: (index: number) => this._removeInset(index),
    updateInset: (index: number, partial: Partial<Inset>) => this._updateInset(index, partial),
  };
  /** The editor's Escape layer while it is in the page (until it moves onto ps-dialog). */
  private _releaseEscapeLayer: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._disposed = false;
    this._state = this.savedPublishState
      ? sanitizePublishState(this.savedPublishState)
      : createDefaultPublishState();
    // Set fingerprint on first use (no saved state)
    if (!this._state.viewFingerprint && this.currentProjection) {
      this._state = { ...this._state, viewFingerprint: this.currentProjection };
    }
    // Check for fingerprint mismatch
    this._showFingerprintWarning = shouldShowFingerprintWarning(
      this._state.viewFingerprint,
      this.currentProjection,
    );
    this._readLegend();
    window.addEventListener('keydown', this._onKeyDown);
    // A layer: Escape deselects, then closes the editor, and never reaches the page's own Escape
    // (the plot's selection) underneath. A press outside is the backdrop's own click.
    this._releaseEscapeLayer ??= pushLayer({
      close: () => this._onEscapeLayer(),
      elements: [this],
      dismissOnOutsidePress: false,
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposed = true;
    window.removeEventListener('keydown', this._onKeyDown);
    this._releaseEscapeLayer?.();
    this._releaseEscapeLayer = null;
    this._overlayController?.destroy();
    this._overlayController = null;
    if (this._redrawHandle !== null) cancelAnimationFrame(this._redrawHandle);
    this._insetRenders.clear();
  }

  /**
   * Delete/Backspace removes the selected overlay or inset. Skipped while focus is in an editable
   * element so typing Backspace inside the label-text input still erases characters instead of
   * deleting the overlay. Escape is the layer's (`_onEscapeLayer`).
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isEditableEventPath(e.composedPath())) return;
    const sel = this._selectedItem;
    if (!sel) return;
    if (sel.kind === 'overlay') this._removeOverlay(sel.index);
    else this._removeInset(sel.index);
    e.preventDefault();
  };

  /** Escape: the first press deselects an overlay or inset, the next closes the editor. */
  private _onEscapeLayer(): void {
    if (this._selectedItem) {
      this._setSelection(null);
      return;
    }
    this._handleClose();
  }

  override firstUpdated() {
    this._setupOverlay();
    this._scheduleRedraw();
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('legendElement')) {
      this._readLegend();
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('_state') || changed.has('_tool') || changed.has('_selectedItem')) {
      this._scheduleRedraw();
    }
  }

  // ── Legend data ────────────────────────────────────

  private _readLegend() {
    const el =
      (this.legendElement as
        | (Element & { getLegendExportData?: () => LegendExportState })
        | null) ??
      (document.querySelector('protspace-legend') as
        | (Element & { getLegendExportData?: () => LegendExportState })
        | null);
    const legendState = readLegendExportState(el);
    if (legendState) {
      this._legendTitle = legendState.annotation;
      this._legendItems = legendState.items.map((it) => ({
        value: it.value,
        displayValue: it.displayValue,
        color: it.color,
        shape: it.shape,
        count: it.count,
        isVisible: it.isVisible,
      }));
    }
  }

  // ── Overlay ────────────────────────────────────────

  private _setupOverlay() {
    if (!this._previewCanvas) return;
    this._overlayController = new PublishOverlayController(this._previewCanvas, {
      getPlotRect: () => {
        const { plotRect } = computeLayout(
          this._previewCanvas.width,
          this._previewCanvas.height,
          this._state.legend,
          this._legendItems.filter((it) => it.isVisible).length,
        );
        return plotRect;
      },
      getOverlays: () => this._state.overlays,
      getInsets: () => this._state.insets,
      getLegendRect: () => {
        if (this._state.legend.position !== 'free') return null;
        const { legendRect } = computeLayout(
          this._previewCanvas.width,
          this._previewCanvas.height,
          this._state.legend,
          this._legendItems.filter((it) => it.isVisible).length,
        );
        return legendRect;
      },
      onOverlayAdded: (a) => {
        this._state = {
          ...this._state,
          overlays: [...this._state.overlays, a],
          referenceWidth: this._state.widthPx,
        };
      },
      onOverlayUpdated: (i, a) => {
        const anns = [...this._state.overlays];
        anns[i] = a;
        this._state = { ...this._state, overlays: anns };
      },
      onInsetAdded: (inset) => {
        this._state = {
          ...this._state,
          insets: [...this._state.insets, inset],
          referenceWidth: this._state.widthPx,
        };
      },
      onInsetUpdated: (i, inset) => {
        const ins = [...this._state.insets];
        ins[i] = inset;
        this._state = { ...this._state, insets: ins };
      },
      onSelectionChanged: (kind, index) => {
        // Mirror canvas selection into modal state so sidebar items
        // highlight in lockstep with the canvas.
        this._selectedItem = kind === null ? null : { kind, index };
      },
      onLegendMoved: (nx: number, ny: number) => {
        this._updateLegend({ freePos: { nx, ny } });
      },
      requestRedraw: () => this._redraw(),
    });
  }

  // ── Redraw pipeline ────────────────────────────────

  /**
   * Coalesce redraws to a single rAF tick. The previous 120 ms debounce only
   * fired *after* drag activity stopped — during a continuous resize the
   * inset content stayed frozen and snapped at the end. With rAF, redraws
   * happen at most once per frame, giving live feedback during drag while
   * still avoiding redundant work when many state updates arrive in the
   * same tick.
   */
  private _scheduleRedraw() {
    // A redraw that finishes after disconnect can still arm the settle timer;
    // a disposed modal must not queue a frame from it.
    if (this._disposed || this._redrawHandle !== null) return;
    this._redrawHandle = requestAnimationFrame(() => {
      this._redrawHandle = null;
      this._redraw();
    });
  }

  private _redraw() {
    if (!this._previewCanvas || !this.plotElement) return;

    const s = this._state;
    const aspect = s.heightPx / s.widthPx;
    const previewW = s.widthPx;
    const previewH = Math.round(previewW * aspect);

    this._previewCanvas.width = previewW;
    this._previewCanvas.height = previewH;

    // Capture plot (cache when dimensions and key state haven't changed)
    const visibleCount = this._legendItems.filter((it) => it.isVisible).length;
    const { plotRect } = computeLayout(previewW, previewH, s.legend, visibleCount);
    const plotEl = this.plotElement as CaptureablePlotElement;
    const bgColor = s.background === 'white' ? '#ffffff' : 'rgba(0,0,0,0)';

    const cacheKey = `${plotRect.w}x${plotRect.h}|${bgColor}`;
    if (cacheKey !== this._plotCacheKey || !this._cachedPlotCanvas) {
      this._cachedPlotCanvas = capturePlotCanvas(plotEl, {
        width: plotRect.w,
        height: plotRect.h,
        backgroundColor: bgColor,
        // Always render the unzoomed, fit-all view in the editor (#294).
        resetView: true,
      });
      this._plotCacheKey = cacheKey;
    }

    // Geometric per-inset captures: each inset is a fresh WebGL render
    // scoped to its source data domain at the inset's target pixel size.
    // Points stay native size (no raster crop+upscale), so quality keeps
    // improving with the inset's pixel budget instead of plateauing at 4×.
    const insetRenders = this._insetRenders.capture(plotEl, s, plotRect, bgColor);

    composeFigure(this._previewCanvas, {
      state: s,
      plotCanvas: this._cachedPlotCanvas,
      legendItems: this._legendItems,
      legendTitle: this._legendTitle,
      highlightedItem: this._selectedItem,
      displayScale:
        this._previewCanvas.width /
        (this._previewCanvas.getBoundingClientRect().width || this._previewCanvas.width),
      insetRenders,
    });

    // Draw overlay indicators and selection handles
    const overlayCtx = this._previewCanvas.getContext('2d')!;
    this._overlayController?.drawDragIndicator(overlayCtx);
    const annotScale = previewW / (s.referenceWidth || previewW);
    this._overlayController?.drawSelectionHandles(overlayCtx, annotScale);
  }

  // ── State mutations ────────────────────────────────

  private _updateState(partial: Partial<PublishState>) {
    this._state = { ...this._state, ...partial };
    // If user changes width/height, mark preset as custom
    if ('widthPx' in partial || 'heightPx' in partial) {
      this._state = { ...this._state, preset: 'custom' };
    }
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _updateLegend(partial: Partial<PublishState['legend']>) {
    this._state = { ...this._state, legend: { ...this._state.legend, ...partial } };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _updateWidthPx(widthPx: number) {
    this._state = { ...this._state, ...computeWidthPxUpdate(this._state, widthPx) };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _updateWidthMm(widthMm: number) {
    this._state = { ...this._state, ...computeWidthMmUpdate(this._state, widthMm) };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _updateHeightPx(heightPx: number) {
    const constrained = this._constrainedHeightPatch(heightPx);
    if (constrained) {
      this._state = { ...this._state, ...constrained };
    } else {
      this._state = { ...this._state, ...computeHeightPxUpdate(this._state, heightPx) };
    }
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _updateHeightMm(heightMm: number) {
    const constraints = getActivePresetConstraints(this._state);
    if (constraints) {
      const heightPx = mmToPx(heightMm, this._state.dpi);
      const constrained = this._constrainedHeightPatch(heightPx);
      if (constrained) {
        this._state = { ...this._state, ...constrained };
        this._plotCacheKey = '';
        this._showResampleNote = false;
        return;
      }
    }
    this._state = { ...this._state, ...computeHeightMmUpdate(this._state, heightMm) };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  /**
   * When a journal preset is active, height edits clamp at maxHeightPx and
   * preserve the preset's pinned width — instead of dropping into custom mode.
   * Returns null when no constraint applies (caller falls back to free edits).
   */
  private _constrainedHeightPatch(heightPx: number): Partial<PublishState> | null {
    const widthPx = getActivePresetWidthPx(this._state);
    if (widthPx === null) return null;
    const maxPx = getActivePresetMaxHeightPx(this._state) ?? Infinity;
    const clamped = Math.min(Math.max(1, Math.round(heightPx)), maxPx);
    return { heightPx: clamped, widthPx };
  }

  private _updateDpi(dpi: number) {
    this._state = { ...this._state, ...computeDpiUpdate(this._state, dpi) };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _applyPreset(presetId: PresetId) {
    const patch = computePresetApplication(presetId);
    if (!patch) return;
    const wasResampleOff = !this._state.resample;
    // Apply the preset's width + dpi but derive height from the current
    // aspect ratio so the user's existing layout fits the new column width
    // instead of being stretched to the journal's max page height. The
    // result is then clamped to the preset's maxHeightMm cap (if any).
    const aspect = this._state.widthPx > 0 ? this._state.heightPx / this._state.widthPx : 1;
    let heightPx = Math.max(1, Math.round(patch.widthPx * aspect));
    const preset = getPreset(presetId);
    if (preset?.maxHeightMm !== undefined) {
      const maxPx = mmToPx(preset.maxHeightMm, preset.dpi);
      heightPx = Math.min(heightPx, maxPx);
    }
    // Match the preset's mm width to the corresponding sizeMode so the UI's
    // width-locked logic stays consistent with the dimensions being applied.
    let sizeMode = this._state.sizeMode;
    if (preset?.widthMm === SIZE_MODE_WIDTH_MM['1-column']) sizeMode = '1-column';
    else if (preset?.widthMm === SIZE_MODE_WIDTH_MM['2-column']) sizeMode = '2-column';
    else if (preset?.widthMm === undefined) sizeMode = 'flexible';
    this._state = {
      ...this._state,
      ...patch,
      heightPx,
      sizeMode,
    };
    this._plotCacheKey = '';
    this._showResampleNote = wasResampleOff;
  }

  private _toggleResample() {
    this._state = { ...this._state, resample: !this._state.resample };
    this._plotCacheKey = '';
    this._showResampleNote = false;
  }

  private _toggleAspectLock() {
    this._state = { ...this._state, aspectLocked: !this._state.aspectLocked };
    this._showResampleNote = false;
  }

  private _setUnit(unit: 'px' | 'mm' | 'in' | 'cm') {
    this._state = { ...this._state, unit };
    this._showResampleNote = false;
  }

  private _setTool(tool: OverlayTool) {
    this._tool = tool;
    if (this._overlayController) {
      this._overlayController.tool = tool;
    }
  }

  /** Single source of truth for selection. Mirrors to the controller so
   *  drag handles redraw to match the sidebar/canvas state. */
  private _setSelection(sel: { kind: 'overlay' | 'inset'; index: number } | null) {
    this._selectedItem = sel;
    this._overlayController?.setSelection(sel);
  }

  private _removeOverlay(index: number) {
    const anns = this._state.overlays.filter((_, i) => i !== index);
    this._state = { ...this._state, overlays: anns };
    if (this._selectedItem?.kind === 'overlay' && this._selectedItem.index === index) {
      this._setSelection(null);
    }
  }

  private _updateOverlay(index: number, partial: Partial<Overlay>) {
    const anns = [...this._state.overlays];
    anns[index] = { ...anns[index], ...partial } as Overlay;
    this._state = { ...this._state, overlays: anns };
  }

  private _removeInset(index: number) {
    const ins = this._state.insets.filter((_, i) => i !== index);
    this._state = { ...this._state, insets: ins };
    if (this._selectedItem?.kind === 'inset' && this._selectedItem.index === index) {
      this._setSelection(null);
    }
  }

  private _updateInset(index: number, partial: Partial<Inset>) {
    const insets = [...this._state.insets];
    insets[index] = { ...insets[index], ...partial };
    this._state = { ...this._state, insets };
  }

  // ── Export ─────────────────────────────────────────

  private async _handleExport() {
    // Re-render at full resolution for export
    if (!this.plotElement) return;
    await waitForFonts();
    const s = this._state;
    const visibleCount = this._legendItems.filter((it) => it.isVisible).length;
    const { plotRect } = computeLayout(s.widthPx, s.heightPx, s.legend, visibleCount);
    const plotEl = this.plotElement as CaptureablePlotElement;
    const bgColor = s.background === 'white' ? '#ffffff' : 'rgba(0,0,0,0)';

    const plotCanvas = capturePlotCanvas(plotEl, {
      width: plotRect.w,
      height: plotRect.h,
      backgroundColor: bgColor,
      // Export the unzoomed, fit-all view, matching the live preview (#294).
      resetView: true,
    });

    // Per-inset geometric renders for the export.
    const insetRenders = this._insetRenders.capture(plotEl, s, plotRect, bgColor, {
      forExport: true,
    });

    const outCanvas = document.createElement('canvas');
    outCanvas.width = s.widthPx;
    outCanvas.height = s.heightPx;

    composeFigure(outCanvas, {
      state: s,
      plotCanvas,
      legendItems: this._legendItems,
      legendTitle: this._legendTitle,
      insetRenders,
    });

    this.dispatchEvent(
      new CustomEvent('publish-export', {
        detail: { canvas: outCanvas, state: s },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleClose() {
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: { state: this._state },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleReset() {
    const state = createDefaultPublishState();
    this._applyStateAndRebuild({
      ...state,
      viewFingerprint: this.currentProjection ?? undefined,
    });
  }

  private _handleNewFigure() {
    this._applyStateAndRebuild({
      ...this._state,
      overlays: [],
      insets: [],
      viewFingerprint: this.currentProjection ?? undefined,
    });
  }

  private _applyStateAndRebuild(newState: PublishState) {
    this._state = newState;
    this._tool = 'select';
    this._setSelection(null);
    this._showFingerprintWarning = false;
    this._showResampleNote = false;
    this._plotCacheKey = '';
    this._overlayController?.destroy();
    this._overlayController = null;
    this.updateComplete.then(() => {
      if (this._disposed) return;
      this._setupOverlay();
    });
  }

  private _clearOverlays() {
    this._state = {
      ...this._state,
      overlays: [],
      insets: [],
      viewFingerprint: this.currentProjection ?? undefined,
    };
    this._showFingerprintWarning = false;
    this._showResampleNote = false;
  }

  // ── Render ─────────────────────────────────────────

  override render() {
    const s = this._state;
    return html`
      <div class="publish-overlay" @mousedown=${this._onOverlayClick}>
        <div class="publish-container" @mousedown=${(e: Event) => e.stopPropagation()}>
          <!-- Preview area -->
          <div class="publish-preview">
            <div class="publish-preview-header">
              <h2>Figure Editor</h2>
            </div>

            <div class="publish-preview-canvas-container">
              <canvas class="publish-preview-canvas"></canvas>
            </div>

            ${renderToolbar({ tool: this._tool }, this._toolbarHandlers)}
          </div>

          <!-- Sidebar -->
          <div class="publish-sidebar">
            <div class="publish-sidebar-header">
              <h3>Settings</h3>
              <button class="publish-close-btn" @click=${this._handleClose} title="Close">
                <svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div class="publish-sidebar-content">
              ${this._showFingerprintWarning
                ? html`
                    <div class="publish-warning">
                      Overlays were placed on ${this._state.viewFingerprint?.projection ?? '?'}
                      ${this._state.viewFingerprint?.dimensionality ?? '?'}D. Current view:
                      ${this.currentProjection?.projection ?? '?'}
                      ${this.currentProjection?.dimensionality ?? '?'}D.
                      <a
                        href="#"
                        @click=${(e: Event) => {
                          e.preventDefault();
                          this._clearOverlays();
                        }}
                        >Clear overlays</a
                      >
                    </div>
                  `
                : nothing}
              ${renderPresets({ preset: s.preset }, this._presetHandlers)}
              ${renderDimensions(
                { state: s, showResampleNote: this._showResampleNote },
                this._dimensionHandlers,
              )}
              ${renderLegendSection({ legend: s.legend, dpi: s.dpi }, this._legendHandlers)}
              ${renderAnnotations(
                { overlays: s.overlays, insets: s.insets, selected: this._selectedItem },
                this._annotationHandlers,
              )}
              ${renderOptions({ format: s.format, background: s.background }, this._optionHandlers)}
            </div>

            <div class="publish-sidebar-footer">
              <button
                class="btn-danger"
                @click=${this._handleNewFigure}
                title="Clear overlays and insets, keep layout"
              >
                New Figure
              </button>
              <button
                class="btn-danger"
                @click=${this._handleReset}
                title="Reset all settings to defaults"
              >
                Reset
              </button>
              <button class="btn-secondary" @click=${this._handleClose}>Cancel</button>
              <button
                class="btn-primary"
                @click=${this._handleExport}
                title=${`Export ${s.format.toUpperCase()}`}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _onOverlayClick = () => {
    this._handleClose();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-publish-modal': ProtspacePublishModal;
  }
}
