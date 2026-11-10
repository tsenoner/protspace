/**
 * `<protspace-publish-modal>` — Full-screen figure editor for publication-ready exports.
 *
 * Hosts a live preview canvas and a settings sidebar with journal presets,
 * legend positioning, highlight annotations, and zoom insets.
 */

import { LitElement, html, nothing } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { annotationLabel, type Annotation } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import { publishModalStyles } from './publish-modal.styles';
import '../kit/button';
import '../kit/dialog';
import type { PsDialog } from '../kit/dialog';
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
  isFormControlEventPath,
  shouldShowFingerprintWarning,
  type LegendExportState,
} from './publish-modal-helpers';
import { InsetRenderCache, type CaptureablePlotElement } from './inset-render-cache';
import { renderAnnotations } from './sections/annotations-section';
import { renderDimensions } from './sections/dimensions-section';
import { renderLegendSection } from './sections/legend-section';
import { renderOptions, renderPresets } from './sections/presets-options-section';
import { renderToolbar } from './sections/toolbar';
import { renderFooter } from './sections/footer';
import { PublishUndoOffer } from './publish-undo-offer';

// ── Component ────────────────────────────────────────────────

@customElement('protspace-publish-modal')
export class ProtspacePublishModal extends LitElement {
  static override styles = publishModalStyles;

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
  /** Why the last export failed, said inside the dialog: a toast would sit under the modal. */
  @state() private _exportError: string | null = null;

  @query('ps-dialog') private _dialog?: PsDialog;

  @query('.publish-preview-canvas') private _previewCanvas!: HTMLCanvasElement;

  private _overlayController: PublishOverlayController | null = null;
  private _redrawHandle: number | null = null;
  private _plotCacheKey = '';
  private _cachedPlotCanvas: HTMLCanvasElement | null = null;
  /** Per-inset WebGL renders; a burst of updates reuses them, then asks for one more redraw. */
  private _insetRenders = new InsetRenderCache(() => this._scheduleRedraw());
  private _disposed = false;
  private readonly _undo = new PublishUndoOffer(this);

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
  private readonly _footerHandlers = {
    newFigure: () => this._handleNewFigure(),
    reset: () => this._handleReset(),
    undo: () => this._undoLast(),
    holdUndo: () => this._undo.hold(),
    releaseUndo: () => this._undo.release(),
    close: () => this._dialog?.dismiss(),
    exportFigure: () => void this._handleExport(),
  };
  /** Escape deselects a selected overlay or inset before it closes the dialog. */
  private _releaseSelectionLayer: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._disposed = false;
    this._state = this.savedPublishState
      ? sanitizePublishState(this.savedPublishState)
      : createDefaultPublishState();
    // Only overlays and insets can sit wrong on another view; with none placed, adopt this one.
    if (this.currentProjection && (!this._state.viewFingerprint || !hasPlaced(this._state))) {
      this._state = { ...this._state, viewFingerprint: this.currentProjection };
    }
    this._showFingerprintWarning = this._isMisplaced(this._state);
    this._readLegend();
    window.addEventListener('keydown', this._onKeyDown);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._disposed = true;
    window.removeEventListener('keydown', this._onKeyDown);
    this._overlayController?.destroy();
    this._overlayController = null;
    if (this._redrawHandle !== null) cancelAnimationFrame(this._redrawHandle);
    this._insetRenders.clear();
    this._releaseSelectionLayer?.();
    this._releaseSelectionLayer = null;
  }

  /**
   * Delete/Backspace removes the selected overlay or inset. Skipped while focus is on any form
   * control, so Backspace in a text or number field edits it and a focused slider or checkbox
   * never removes the overlay. Escape is the selection layer's (`_syncSelectionLayer`).
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isFormControlEventPath(e.composedPath())) return;
    const sel = this._selectedItem;
    if (!sel) return;
    if (sel.kind === 'overlay') this._removeOverlay(sel.index);
    else this._removeInset(sel.index);
    e.preventDefault();
  };

  override firstUpdated() {
    this._setupOverlay();
    this._scheduleRedraw();
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('legendElement')) {
      this._readLegend();
    }
    if (changed.has('_state')) this._undo.dropIfEdited(this._state);
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('_state') || changed.has('_tool') || changed.has('_selectedItem')) {
      this._scheduleRedraw();
    }
    if (changed.has('_selectedItem')) this._syncSelectionLayer();
  }

  /** While an overlay or inset is selected, Escape deselects it; the next Escape closes. */
  private _syncSelectionLayer() {
    if (this._selectedItem && !this._releaseSelectionLayer && this.isConnected) {
      this._releaseSelectionLayer = pushLayer({
        close: () => {
          this._releaseSelectionLayer?.();
          this._releaseSelectionLayer = null;
          this._setSelection(null);
        },
        elements: [this],
        dismissOnOutsidePress: false,
      });
    } else if (!this._selectedItem && this._releaseSelectionLayer) {
      this._releaseSelectionLayer();
      this._releaseSelectionLayer = null;
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
      // The figure names the annotation as the app does; the legend's data defines runtime ones.
      const definitions = (el as { data?: { annotations?: Record<string, Annotation> } } | null)
        ?.data?.annotations;
      this._legendTitle = annotationLabel(
        legendState.annotation,
        definitions?.[legendState.annotation],
      );
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

  /** The figure's plot and legend rects at `width` × `height`. */
  private _layout(width: number, height: number) {
    const visibleCount = this._legendItems.filter((it) => it.isVisible).length;
    return computeLayout(width, height, this._state.legend, visibleCount);
  }

  private _setupOverlay() {
    if (!this._previewCanvas) return;
    const previewLayout = () => this._layout(this._previewCanvas.width, this._previewCanvas.height);
    this._overlayController = new PublishOverlayController(this._previewCanvas, {
      getPlotRect: () => previewLayout().plotRect,
      getOverlays: () => this._state.overlays,
      getInsets: () => this._state.insets,
      getLegendRect: () =>
        this._state.legend.position === 'free' ? previewLayout().legendRect : null,
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
        // Placing an inset hands the canvas back to Select; the toolbar says so too.
        this._tool = 'select';
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
    const previewW = s.widthPx;
    this._previewCanvas.width = previewW;
    this._previewCanvas.height = s.heightPx;

    const { plotRect } = this._layout(previewW, s.heightPx);
    const plotEl = this.plotElement as CaptureablePlotElement;
    const bgColor = backgroundColor(s);

    // Geometric per-inset captures: each inset is a fresh WebGL render
    // scoped to its source data domain at the inset's target pixel size.
    // Points stay native size (no raster crop+upscale), so quality keeps
    // improving with the inset's pixel budget instead of plateauing at 4×.
    const insetRenders = this._insetRenders.capture(plotEl, s, plotRect, bgColor);

    composeFigure(this._previewCanvas, {
      state: s,
      plotCanvas: this._capturePlot(plotEl, plotRect, bgColor),
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

  /**
   * The unzoomed, fit-all plot (#294) at the plot rect's size. The preview draws at the figure's
   * full size, so its capture is the export's too: cached by the only inputs it depends on.
   */
  private _capturePlot(
    plotEl: CaptureablePlotElement,
    plotRect: { w: number; h: number },
    bgColor: string,
  ): HTMLCanvasElement {
    const cacheKey = `${plotRect.w}x${plotRect.h}|${bgColor}`;
    if (cacheKey !== this._plotCacheKey || !this._cachedPlotCanvas) {
      this._cachedPlotCanvas = capturePlotCanvas(plotEl, {
        width: plotRect.w,
        height: plotRect.h,
        backgroundColor: bgColor,
        resetView: true,
      });
      this._plotCacheKey = cacheKey;
    }
    return this._cachedPlotCanvas;
  }

  // ── State mutations ────────────────────────────────

  /**
   * Applies a sidebar edit. The plot capture needs no invalidating: its cache key (the plot
   * rect's size and the background) changes exactly when the capture would.
   */
  private _edit(partial: Partial<PublishState>) {
    this._state = { ...this._state, ...partial };
    this._showResampleNote = false;
  }

  private _updateState(partial: Partial<PublishState>) {
    // A width or height set here leaves the preset.
    const custom = 'widthPx' in partial || 'heightPx' in partial;
    this._edit(custom ? { ...partial, preset: 'custom' } : partial);
  }

  private _updateLegend(partial: Partial<PublishState['legend']>) {
    this._edit({ legend: { ...this._state.legend, ...partial } });
  }

  private _updateWidthPx(widthPx: number) {
    this._edit(computeWidthPxUpdate(this._state, widthPx));
  }

  private _updateWidthMm(widthMm: number) {
    this._edit(computeWidthMmUpdate(this._state, widthMm));
  }

  private _updateHeightPx(heightPx: number) {
    this._edit(
      this._constrainedHeightPatch(heightPx) ?? computeHeightPxUpdate(this._state, heightPx),
    );
  }

  private _updateHeightMm(heightMm: number) {
    const constrained = getActivePresetConstraints(this._state)
      ? this._constrainedHeightPatch(mmToPx(heightMm, this._state.dpi))
      : null;
    this._edit(constrained ?? computeHeightMmUpdate(this._state, heightMm));
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
    this._edit(computeDpiUpdate(this._state, dpi));
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
    this._edit({ ...patch, heightPx, sizeMode });
    this._showResampleNote = wasResampleOff;
  }

  private _toggleResample() {
    this._edit({ resample: !this._state.resample });
  }

  private _toggleAspectLock() {
    this._edit({ aspectLocked: !this._state.aspectLocked });
  }

  private _setUnit(unit: PublishState['unit']) {
    this._edit({ unit });
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
    this._keepSelectionAfterRemoval('overlay', index);
  }

  /**
   * After the `kind` item at `index` goes: its selection goes with it, and a selection further
   * down the list moves up one, so it stays on the item it was on.
   */
  private _keepSelectionAfterRemoval(kind: 'overlay' | 'inset', index: number) {
    const selected = this._selectedItem;
    if (selected?.kind !== kind || selected.index < index) return;
    this._setSelection(selected.index === index ? null : { kind, index: selected.index - 1 });
  }

  private _updateOverlay(index: number, partial: Partial<Overlay>) {
    const anns = [...this._state.overlays];
    anns[index] = { ...anns[index], ...partial } as Overlay;
    this._state = { ...this._state, overlays: anns };
  }

  private _removeInset(index: number) {
    const ins = this._state.insets.filter((_, i) => i !== index);
    this._state = { ...this._state, insets: ins };
    this._keepSelectionAfterRemoval('inset', index);
  }

  private _updateInset(index: number, partial: Partial<Inset>) {
    const insets = [...this._state.insets];
    insets[index] = { ...insets[index], ...partial };
    this._state = { ...this._state, insets };
  }

  // ── Export ─────────────────────────────────────────

  private async _handleExport() {
    this._exportError = null;
    // Re-render at full resolution for export
    if (!this.plotElement) return;
    await waitForFonts();
    let figure: HTMLCanvasElement;
    try {
      figure = this._renderFigure(this.plotElement as CaptureablePlotElement);
    } catch (err) {
      // A figure too large for a canvas, or a lost WebGL context: say so here, not in the console.
      console.error('Figure export failed:', err);
      this._exportError = `Export failed. ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    this.dispatchEvent(
      new CustomEvent('publish-export', {
        detail: { canvas: figure, state: this._state },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** The figure at its full size, for export. */
  private _renderFigure(plotEl: CaptureablePlotElement): HTMLCanvasElement {
    const s = this._state;
    const { plotRect } = this._layout(s.widthPx, s.heightPx);
    const bgColor = backgroundColor(s);
    const plotCanvas = this._capturePlot(plotEl, plotRect, bgColor);

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
    return outCanvas;
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
    const before = this._state;
    const state = createDefaultPublishState();
    this._applyStateAndRebuild({
      ...state,
      viewFingerprint: this.currentProjection ?? undefined,
    });
    this._undo.start('Settings reset', before, this._state);
  }

  private _handleNewFigure() {
    const before = this._state;
    this._applyStateAndRebuild({
      ...this._state,
      overlays: [],
      insets: [],
      viewFingerprint: this.currentProjection ?? undefined,
    });
    if (hasPlaced(before)) this._undo.start('Overlays and insets cleared', before, this._state);
  }

  private _undoLast() {
    const before = this._undo.take();
    if (!before) return;
    this._applyStateAndRebuild(before);
    // The restored overlays may sit on another projection, like on open.
    this._showFingerprintWarning = this._isMisplaced(before);
  }

  /** Whether `state` has overlays or insets placed on a view other than the current one. */
  private _isMisplaced(state: PublishState): boolean {
    return (
      hasPlaced(state) &&
      shouldShowFingerprintWarning(state.viewFingerprint, this.currentProjection)
    );
  }

  /** Says inside the dialog why an export failed; the next export attempt clears it. */
  showExportError(message: string): void {
    this._exportError = message;
  }

  private _applyStateAndRebuild(newState: PublishState) {
    this._state = newState;
    this._tool = 'select';
    this._setSelection(null);
    this._showFingerprintWarning = false;
    this._showResampleNote = false;
    this._overlayController?.destroy();
    this._overlayController = null;
    this.updateComplete.then(() => {
      if (this._disposed) return;
      this._setupOverlay();
    });
  }

  // ── Render ─────────────────────────────────────────

  override render() {
    const s = this._state;
    return html`
      <ps-dialog
        size="full"
        heading="Figure editor"
        open
        dismissible="false"
        @ps-close=${this._handleClose}
      >
        <div class="publish-container">
          <div class="publish-preview">
            <div class="publish-preview-canvas-container">
              <canvas class="publish-preview-canvas"></canvas>
            </div>
            ${renderToolbar({ tool: this._tool }, this._toolbarHandlers)}
          </div>

          <div class="publish-sidebar">
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
                          this._handleNewFigure();
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
          </div>
        </div>
        ${renderFooter(
          {
            undo: this._undo.message,
            exportError: this._exportError,
            format: s.format,
          },
          this._footerHandlers,
        )}
      </ps-dialog>
    `;
  }
}

function backgroundColor(state: PublishState): string {
  return state.background === 'white' ? '#ffffff' : 'rgba(0,0,0,0)';
}

function hasPlaced(state: PublishState): boolean {
  return state.overlays.length > 0 || state.insets.length > 0;
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-publish-modal': ProtspacePublishModal;
  }
}
