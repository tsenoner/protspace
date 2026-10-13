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
import { renderFooter, type UndoMessage } from './sections/footer';

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
  /** New figure or Reset, undoable from the footer until the next edit or for 8 s. */
  @state() private _undo: { message: UndoMessage; state: PublishState } | null = null;
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
    close: () => this._dialog?.dismiss(),
    exportFigure: () => void this._handleExport(),
  };
  /** The state New figure or Reset produced; any other state ends the Undo offer. */
  private _undoAfter: PublishState | null = null;
  private _undoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Escape deselects a selected overlay or inset before it closes the dialog. */
  private _releaseSelectionLayer: (() => void) | null = null;

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
    if (this._undoTimer !== null) clearTimeout(this._undoTimer);
    this._undoTimer = null;
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
    // Any state but the one New figure or Reset produced is an edit after it: Undo would lose it.
    if (changed.has('_state') && this._undo && this._state !== this._undoAfter) {
      this._dropUndo();
    }
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
    this._exportError = null;
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
    const before = this._state;
    const state = createDefaultPublishState();
    this._applyStateAndRebuild({
      ...state,
      viewFingerprint: this.currentProjection ?? undefined,
    });
    this._offerUndo('Settings reset', before);
  }

  private _handleNewFigure() {
    const before = this._state;
    this._applyStateAndRebuild({
      ...this._state,
      overlays: [],
      insets: [],
      viewFingerprint: this.currentProjection ?? undefined,
    });
    this._offerUndo('Overlays and insets cleared', before);
  }

  /** Shows what New figure or Reset did, with Undo, until the next edit or for 8 s. */
  private _offerUndo(message: UndoMessage, before: PublishState) {
    if (this._undoTimer !== null) clearTimeout(this._undoTimer);
    this._undo = { message, state: before };
    this._undoAfter = this._state;
    this._undoTimer = setTimeout(() => this._dropUndo(), 8_000);
  }

  private _dropUndo() {
    if (this._undoTimer !== null) clearTimeout(this._undoTimer);
    this._undoTimer = null;
    this._undo = null;
    this._undoAfter = null;
  }

  private _undoLast() {
    const undo = this._undo;
    if (!undo) return;
    this._dropUndo();
    this._applyStateAndRebuild(undo.state);
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
          </div>
        </div>
        ${renderFooter(
          {
            undo: this._undo?.message ?? null,
            exportError: this._exportError,
            format: s.format,
          },
          this._footerHandlers,
        )}
      </ps-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-publish-modal': ProtspacePublishModal;
  }
}
