/**
 * `<protspace-publish-modal>` — Full-screen figure editor for publication-ready exports.
 *
 * Hosts a live preview canvas and a settings sidebar with journal presets,
 * legend positioning, highlight annotations, and zoom insets.
 */

import { LitElement, html, nothing } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { tokens } from '../../styles/tokens';
import { buttonMixin } from '../../styles/mixins';
import { publishModalStyles } from './publish-modal.styles';
import { JOURNAL_PRESETS, type PresetId } from './journal-presets';
import {
  createDefaultPublishState,
  type PublishState,
  type LegendPosition,
  type OverlayTool,
  type Overlay,
  type Inset,
} from './publish-state';
import {
  pxToMm,
  mmToIn,
  mmToCm,
  inToMm,
  cmToMm,
  mmToPx,
  SIZE_MODE_WIDTH_MM,
} from './dimension-utils';
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
  shouldShowFingerprintWarning,
} from './publish-modal-helpers';
import { getPreset } from './journal-presets';

// ── Constants ─────────────────────────────────────────────────

const RESAMPLE_TOOLTIP =
  'When on, changing the resolution re-renders the figure at a new pixel count. ' +
  'When off, only print-size metadata changes — pixels stay the same.';

/**
 * True when the keyboard event originated inside an editable element
 * (input, textarea, select, contenteditable). Walk the composed path so
 * elements inside the modal's shadow DOM are detected — `event.target` is
 * retargeted to the host on a window-level listener.
 */
function isEditableTarget(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (node.isContentEditable) return true;
  }
  return false;
}

// ── Types ─────────────────────────────────────────────────────

interface CaptureablePlotElement extends HTMLElement {
  captureAtResolution?: (
    w: number,
    h: number,
    opts: {
      dpr?: number;
      backgroundColor?: string;
      dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number };
      pointSizeReference?: { width: number; height: number };
    },
  ) => HTMLCanvasElement;
  getDataExtent?: (options?: {
    padded?: boolean;
  }) => { xMin: number; xMax: number; yMin: number; yMax: number } | null;
  getRenderInfo?: (
    exportWidth: number,
    exportHeight: number,
  ) => {
    marginLeft: number;
    marginRight: number;
    marginTop: number;
    marginBottom: number;
  } | null;
}

// ── Legend data reader (mirrors export-utils pattern) ─────────

interface LegendExportState {
  annotation: string;
  otherItemsCount: number;
  items: Array<{
    value: string;
    displayValue?: string;
    color: string;
    shape: string;
    count: number;
    isVisible: boolean;
    zOrder: number;
  }>;
}

function readLegendExportState(
  el: (Element & { getLegendExportData?: () => LegendExportState }) | null,
): LegendExportState | null {
  if (!el || typeof el.getLegendExportData !== 'function') return null;
  try {
    const s = el.getLegendExportData();
    if (s && Array.isArray(s.items)) return s;
  } catch (e) {
    console.warn('Failed to read legend export state:', e);
  }
  return null;
}

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
   *  canvas). Delete/Backspace removes it. Escape clears it. */
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
  private _insetRenderCache = new Map<string, HTMLCanvasElement>();
  /** Stretchable fallback during drag — saves ~15–30 ms WebGL setup per frame. */
  private _lastInsetCanvases: Array<HTMLCanvasElement | null> = [];
  private _lastInsetRenderAt = 0;
  private _settleTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

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
    if (this._settleTimer !== null) clearTimeout(this._settleTimer);
  }

  /**
   * Delete/Backspace removes the selected overlay or inset; Escape clears
   * the selection. Skipped while focus is in an editable element so typing
   * Backspace inside the label-text input still erases characters instead
   * of deleting the overlay.
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace' && e.key !== 'Escape') return;
    if (isEditableTarget(e)) return;
    const sel = this._selectedItem;
    if (e.key === 'Escape') {
      if (sel) {
        this._setSelection(null);
        e.preventDefault();
      }
      return;
    }
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
    if (this._redrawHandle !== null) return;
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
      });
      this._plotCacheKey = cacheKey;
    }

    // Geometric per-inset captures: each inset is a fresh WebGL render
    // scoped to its source data domain at the inset's target pixel size.
    // Points stay native size (no raster crop+upscale), so quality keeps
    // improving with the inset's pixel budget instead of plateauing at 4×.
    const insetRenders = this._captureInsetRenders(plotEl, s, plotRect, bgColor);

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

  /**
   * Render each zoom inset as its own scoped WebGL pass so points stay native
   * pixel size in the inset (instead of the giant blobs raster crop+upscale
   * produces). Returns one entry per `state.insets`; null when the plot
   * element doesn't expose `getDataExtent` (older builds) or has no points
   * yet — the compositor falls back to the legacy raster path in that case.
   *
   * Renders are cached by sourceRect + plot dims, so resizing the target rect
   * (drag-to-grow the inset) doesn't trigger a re-render — the compositor
   * scales the cached canvas to the new target. The WebGL pass only fires
   * when the user actually changes the source region or the plot resizes.
   */
  private _captureInsetRenders(
    plotEl: CaptureablePlotElement,
    state: PublishState,
    plotRect: { w: number; h: number },
    bgColor: string,
    opts: { forExport?: boolean } = {},
  ): Array<HTMLCanvasElement | null> {
    if (state.insets.length === 0) {
      this._insetRenderCache.clear();
      return [];
    }
    if (!plotEl.captureAtResolution || !plotEl.getDataExtent) {
      return state.insets.map(() => null);
    }
    const fullExtent = plotEl.getDataExtent({ padded: true });
    if (!fullExtent) return state.insets.map(() => null);
    const xRange = fullExtent.xMax - fullExtent.xMin;
    const yRange = fullExtent.yMax - fullExtent.yMin;
    // Margin-aware inversion so the inset's data domain matches what the user
    // sees inside the source rect outline pixel-for-pixel. Without this, the
    // raw `sr.x → xMin + sr.x*xRange` mapping would be off by ~margin/canvas
    // (a couple of percent) — visible when the user compares the source rect
    // outline against the inset content.
    const margin = plotEl.getRenderInfo?.(plotRect.w, plotRect.h) ?? {
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
    };
    const dataAreaW = Math.max(1, plotRect.w - margin.marginLeft - margin.marginRight);
    const dataAreaH = Math.max(1, plotRect.h - margin.marginTop - margin.marginBottom);
    const canvasToDataX = (canvasX: number) =>
      fullExtent.xMin + ((canvasX - margin.marginLeft) / dataAreaW) * xRange;
    const canvasToDataY = (canvasY: number) =>
      fullExtent.yMax - ((canvasY - margin.marginTop) / dataAreaH) * yRange;
    // High-frequency state churn (active drag/resize) → skip the WebGL
    // pass and reuse whichever canvas we last rendered for this inset. The
    // compositor stretches it to the live target rect via drawImage. Once
    // updates settle for ~80 ms, the next redraw renders fresh.
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const fastPath = !opts.forExport && now - this._lastInsetRenderAt < 80;
    const livingKeys = new Set<string>();
    if (this._lastInsetCanvases.length !== state.insets.length) {
      this._lastInsetCanvases.length = state.insets.length;
    }
    let didFreshRender = false;
    const renders = state.insets.map((inset, i) => {
      const sr = inset.sourceRect;
      const tr = inset.targetRect;
      // Render the inset at the target rect's exact pixel dims so a fresh
      // pass produces dots at the correct main-plot scale (1:1 pixel mapping
      // between rendered and displayed). Caching at plot dims would shrink
      // dots by `target/plot` after drawImage downscale.
      const renderW = Math.max(1, Math.round(tr.w * plotRect.w));
      const renderH = Math.max(1, Math.round(tr.h * plotRect.h));
      const pointScale = inset.pointSizeScale ?? 1;
      const key = `${sr.x.toFixed(5)}:${sr.y.toFixed(5)}:${sr.w.toFixed(5)}:${sr.h.toFixed(5)}|${renderW}x${renderH}|${plotRect.w}x${plotRect.h}|${pointScale.toFixed(3)}|${bgColor}`;
      livingKeys.add(key);
      const cached = this._insetRenderCache.get(key);
      if (cached) {
        this._lastInsetCanvases[i] = cached;
        return cached;
      }
      // No exact match. During high-frequency updates, return the previous
      // render (any size) and let the compositor stretch it — saves the
      // ~15–30 ms WebGL setup cost per frame.
      if (fastPath && this._lastInsetCanvases[i]) {
        return this._lastInsetCanvases[i];
      }
      const cx0 = sr.x * plotRect.w;
      const cx1 = (sr.x + sr.w) * plotRect.w;
      const cy0 = sr.y * plotRect.h;
      const cy1 = (sr.y + sr.h) * plotRect.h;
      const dataDomain = {
        xMin: canvasToDataX(cx0),
        xMax: canvasToDataX(cx1),
        yMax: canvasToDataY(cy0),
        yMin: canvasToDataY(cy1),
      };
      // sizeScaleFactor = sqrt(refW × refH / displayArea), so scaling the
      // reference dims by `pointScale` linearly multiplies the rendered dot
      // size by exactly `pointScale`. With render dims = target dims and
      // pointScale = 1, the inset matches the main plot's pixel dot size.
      try {
        const canvas = plotEl.captureAtResolution!(renderW, renderH, {
          dpr: 1,
          backgroundColor: bgColor,
          dataDomain,
          pointSizeReference: {
            width: plotRect.w * pointScale,
            height: plotRect.h * pointScale,
          },
        });
        this._insetRenderCache.set(key, canvas);
        this._lastInsetCanvases[i] = canvas;
        didFreshRender = true;
        return canvas;
      } catch {
        return this._lastInsetCanvases[i] ?? null;
      }
    });
    if (didFreshRender) {
      this._lastInsetRenderAt = now;
      // Activity settled enough to render fresh — drop any pending follow-up.
      if (this._settleTimer !== null) {
        clearTimeout(this._settleTimer);
        this._settleTimer = null;
      }
    } else if (fastPath) {
      // fastPath was taken: queue one more redraw so the cached canvas gets
      // replaced with a crisp render once the user stops dragging.
      if (this._settleTimer !== null) clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(() => {
        this._settleTimer = null;
        this._scheduleRedraw();
      }, 120);
    }
    // Evict cache entries no longer referenced (inset removed, sourceRect changed).
    for (const k of this._insetRenderCache.keys()) {
      if (!livingKeys.has(k)) this._insetRenderCache.delete(k);
    }
    return renders;
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
    });

    // Per-inset geometric renders for the export.
    const insetRenders = this._captureInsetRenders(plotEl, s, plotRect, bgColor, {
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

            ${this._renderToolbar()}
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
              ${this._renderPresetsSection()} ${this._renderDimensionsSection()}
              ${this._renderLegendSection()} ${this._renderOverlaysSection()}
              ${this._renderInsetSection()} ${this._renderOptionsSection()}
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

  // ── Shared UI helpers ──────────────────────────────

  private _renderSliderInput(opts: {
    min: number;
    max: number;
    step?: number;
    value: number;
    unit?: string;
    onChange: (v: number) => void;
  }) {
    const { min, max, step, value, unit, onChange } = opts;
    const stepAttr = step ?? 1;
    const parse = step && step < 1 ? parseFloat : parseInt;
    return html`
      <div class="publish-input-group">
        <input
          type="range"
          class="publish-slider"
          min=${min}
          max=${max}
          step=${stepAttr}
          .value=${String(value)}
          @input=${(e: Event) => onChange(parse((e.target as HTMLInputElement).value) || value)}
        />
        <input
          type="number"
          class="publish-row-input"
          min=${min}
          max=${max}
          step=${stepAttr}
          .value=${String(value)}
          @change=${(e: Event) => onChange(parse((e.target as HTMLInputElement).value) || value)}
        />
        ${unit ? html`<span class="publish-unit">${unit}</span>` : nothing}
      </div>
    `;
  }

  // ── Toolbar ────────────────────────────────────────

  private _renderToolbar() {
    const tool = this._tool;
    return html`
      <div class="publish-preview-toolbar">
        <button
          class="publish-toggle-btn publish-tool-btn ${tool === 'select' ? 'active' : ''}"
          @click=${() => this._setTool('select')}
          title="Select / Move"
        >
          <svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>
          Select
        </button>
        <button
          class="publish-toggle-btn publish-tool-btn ${tool === 'circle' ? 'active' : ''}"
          @click=${() => this._setTool('circle')}
          title="Draw circle highlight"
        >
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>
          Circle
        </button>
        <button
          class="publish-toggle-btn publish-tool-btn ${tool === 'arrow' ? 'active' : ''}"
          @click=${() => this._setTool('arrow')}
          title="Draw arrow"
        >
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14m-4-4l4 4-4 4" />
          </svg>
          Arrow
        </button>
        <button
          class="publish-toggle-btn publish-tool-btn ${tool === 'label' ? 'active' : ''}"
          @click=${() => this._setTool('label')}
          title="Add text label"
        >
          <svg viewBox="0 0 24 24">
            <path d="M4 7V4h16v3M9 20h6M12 4v16" />
          </svg>
          Label
        </button>

        <div class="tool-separator"></div>

        <button
          class="publish-toggle-btn publish-tool-btn ${tool === 'inset-source' ? 'active' : ''}"
          @click=${() => this._setTool('inset-source')}
          title="Add zoom inset"
        >
          <svg viewBox="0 0 24 24">
            <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35" />
          </svg>
          Zoom Inset
        </button>
      </div>
    `;
  }

  // ── Presets section ────────────────────────────────

  private _renderPresetsSection() {
    return html`
      <div class="publish-section">
        <div class="publish-section-title">Presets</div>
        <div class="publish-preset-grid">
          ${JOURNAL_PRESETS.map((p) => {
            const preset = p as { widthMm?: number; widthPx?: number; heightPx?: number };
            const dims =
              preset.widthMm !== undefined
                ? `${preset.widthMm} mm`
                : `${preset.widthPx}\u00d7${preset.heightPx}`;
            return html`
              <button
                class="publish-toggle-btn publish-preset-btn ${this._state.preset === p.id
                  ? 'active'
                  : ''}"
                @click=${() => this._applyPreset(p.id)}
                title="${p.label} (${dims})"
              >
                ${p.label}<span class="publish-preset-dims">${dims}</span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  // ── Dimensions section ─────────────────────────────

  private _renderDimensionsSection() {
    const s = this._state;
    const widthMm = pxToMm(s.widthPx, s.dpi);
    const heightMm = pxToMm(s.heightPx, s.dpi);

    const widthDisplay = this._formatDimensionForUnit(s.widthPx, widthMm, s.unit);
    const heightDisplay = this._formatDimensionForUnit(s.heightPx, heightMm, s.unit);

    const dimsReadOnly = s.unit === 'px' && !s.resample;
    // Journal presets pin width and (optionally) cap height. While such a
    // preset is active, lock the width inputs and clamp the height slider.
    const widthLocked = getActivePresetWidthPx(s) !== null;
    const heightMaxPx = getActivePresetMaxHeightPx(s);

    return html`
      <div class="publish-section">
        <div class="publish-section-title">Dimensions</div>

        <div class="publish-dim-readout">
          ${dimsReadOnly ? 'Pixel Dims (locked)' : 'Pixel Dims'}:
          <strong>${s.widthPx} × ${s.heightPx} px</strong>
        </div>

        <div class="publish-dim-pair">
          <label class="publish-dim-label">Width</label>
          <div class="publish-dim-control">
            <input
              type="range"
              class="publish-slider"
              data-publish-input="width-slider"
              min="200"
              max="8000"
              step="1"
              ?disabled=${dimsReadOnly || widthLocked}
              .value=${String(s.widthPx)}
              @input=${(e: Event) => {
                const px = parseInt((e.target as HTMLInputElement).value);
                if (Number.isFinite(px) && px > 0) this._updateWidthPx(px);
              }}
            />
            <input
              type="number"
              class="publish-row-input publish-dim-value"
              data-publish-input="width"
              ?disabled=${dimsReadOnly || widthLocked}
              title=${widthLocked ? 'Width is fixed by the active journal preset.' : ''}
              .value=${String(widthDisplay)}
              step=${s.unit === 'px' ? '1' : '0.1'}
              @change=${(e: Event) => this._handleWidthChange(e)}
            />
          </div>
          ${this._renderAspectLink(s.aspectLocked, widthLocked)}
          <select
            class="publish-select publish-unit-select"
            data-publish-input="unit"
            .value=${s.unit}
            @change=${(e: Event) => {
              this._setUnit((e.target as HTMLSelectElement).value as PublishState['unit']);
            }}
          >
            <option value="px">px</option>
            <option value="mm">mm</option>
            <option value="in">in</option>
            <option value="cm">cm</option>
          </select>

          <label class="publish-dim-label">Height</label>
          <div class="publish-dim-control">
            <input
              type="range"
              class="publish-slider"
              data-publish-input="height-slider"
              min="200"
              max=${heightMaxPx !== null ? String(Math.max(200, heightMaxPx)) : '8000'}
              step="1"
              ?disabled=${dimsReadOnly}
              .value=${String(s.heightPx)}
              @input=${(e: Event) => {
                const px = parseInt((e.target as HTMLInputElement).value);
                if (Number.isFinite(px) && px > 0) this._updateHeightPx(px);
              }}
            />
            <input
              type="number"
              class="publish-row-input publish-dim-value"
              data-publish-input="height"
              ?disabled=${dimsReadOnly}
              .value=${String(heightDisplay)}
              step=${s.unit === 'px' ? '1' : '0.1'}
              @change=${(e: Event) => this._handleHeightChange(e)}
            />
          </div>
        </div>

        <div class="publish-dim-row">
          <label>Resolution</label>
          <div class="publish-input-group">
            <input
              type="number"
              class="publish-row-input"
              data-publish-input="dpi"
              min="1"
              max="2400"
              .value=${String(s.dpi)}
              @change=${(e: Event) => {
                this._updateDpi(parseInt((e.target as HTMLInputElement).value) || s.dpi);
              }}
            />
            <span class="publish-unit">Pixels/Inch</span>
          </div>
        </div>

        <label class="publish-checkbox-label">
          <input
            type="checkbox"
            class="publish-checkbox"
            data-publish-input="resample"
            .checked=${s.resample}
            @change=${() => this._toggleResample()}
          />
          Resample
          <span class="publish-info" title=${RESAMPLE_TOOLTIP}>ⓘ</span>
        </label>
        ${this._showResampleNote
          ? html`<div class="publish-resample-note">Resample turned on to apply preset.</div>`
          : nothing}
      </div>
    `;
  }

  private _renderAspectLink(locked: boolean, disabled: boolean) {
    // Bracket arms (always visible) flow from Width row → chain → Height row,
    // matching Photoshop's Image Size dialog. Chain glyph uses the Lucide
    // link / unlink paths translated to occupy the lower-right of the SVG so
    // the brackets have a clear vertical column on the left to live in.
    // While a journal preset pins width, the chain is meaningless — render it
    // as visibly broken and disabled so the UI matches the actual constraint.
    const effectiveLocked = locked && !disabled;
    return html`
      <button
        class="publish-aspect-lock ${effectiveLocked ? 'locked' : ''}"
        data-publish-input="aspect-lock"
        ?disabled=${disabled}
        @click=${() => {
          if (!disabled) this._toggleAspectLock();
        }}
        title=${disabled
          ? 'Width is fixed by the journal preset; only height is adjustable.'
          : effectiveLocked
            ? 'Linked: editing one rescales the other. Click to unlink.'
            : 'Unlinked: width and height are independent. Click to link.'}
        aria-pressed=${effectiveLocked}
      >
        <svg
          viewBox="0 0 32 60"
          width="30"
          height="56"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
        >
          <!-- Bracket arms link Width row (top) and Height row (bottom) to the chain. -->
          <path class="aspect-lock-bracket" d="M 0 8 L 8 8 L 8 17" />
          <path class="aspect-lock-bracket" d="M 8 43 L 8 52 L 0 52" />

          <!-- LOCKED: Lucide 'link' icon rotated -45° so the chain axis -->
          <!-- runs straight top-to-bottom (vertical chain). -->
          <g class="aspect-lock-state-locked" transform="translate(8 18) rotate(-45 12 12)">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
          </g>

          <!-- UNLOCKED: Lucide 'unlink' rotated -45° — same vertical chain -->
          <!-- pulled apart with four small spark lines indicating a break. -->
          <g class="aspect-lock-state-unlocked" transform="translate(8 18) rotate(-45 12 12)">
            <path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-.12-7.07 5 5 0 0 0-6.95 0l-1.72 1.71" />
            <path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 .12 7.07 5 5 0 0 0 6.95 0l1.71-1.71" />
            <line x1="8" y1="2" x2="8" y2="5" />
            <line x1="2" y1="8" x2="5" y2="8" />
            <line x1="16" y1="19" x2="16" y2="22" />
            <line x1="19" y1="16" x2="22" y2="16" />
          </g>
        </svg>
      </button>
    `;
  }

  private _handleWidthChange(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value <= 0) return;
    if (this._state.unit === 'px') {
      this._updateWidthPx(Math.round(value));
    } else {
      const mm = this._unitToMm(value, this._state.unit);
      this._updateWidthMm(mm);
    }
  }

  private _handleHeightChange(e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value <= 0) return;
    if (this._state.unit === 'px') {
      this._updateHeightPx(Math.round(value));
    } else {
      const mm = this._unitToMm(value, this._state.unit);
      this._updateHeightMm(mm);
    }
  }

  private _unitToMm(value: number, unit: 'mm' | 'in' | 'cm'): number {
    if (unit === 'in') return inToMm(value);
    if (unit === 'cm') return cmToMm(value);
    return value; // 'mm' — no conversion
  }

  private _formatDimensionForUnit(px: number, mm: number, unit: 'px' | 'mm' | 'in' | 'cm'): string {
    if (unit === 'px') return String(px);
    if (unit === 'mm') return mm.toFixed(1);
    if (unit === 'in') return mmToIn(mm).toFixed(2);
    return mmToCm(mm).toFixed(2);
  }

  private _renderLegendFontInput(fontSizePx: number, unit: 'pt' | 'px') {
    const dpi = this._state.dpi;
    const isPt = unit === 'pt';
    const value = isPt ? ((fontSizePx / dpi) * 72).toFixed(1) : String(Math.round(fontSizePx));
    const min = isPt ? 1 : 8;
    const max = isPt ? 50 : 120;
    const step = isPt ? 0.5 : 1;
    return html`
      <div class="publish-input-group">
        <input
          type="range"
          class="publish-slider"
          min=${min}
          max=${max}
          step=${step}
          .value=${value}
          @input=${(e: Event) => this._handleLegendFontChange(e)}
        />
        <input
          type="number"
          class="publish-row-input"
          data-publish-input="legend-font"
          min=${min}
          max=${max}
          step=${step}
          .value=${value}
          @change=${(e: Event) => this._handleLegendFontChange(e)}
        />
        <select
          class="publish-select publish-unit-select"
          data-publish-input="legend-font-unit"
          .value=${unit}
          @change=${(e: Event) => {
            this._updateLegend({
              fontSizeUnit: (e.target as HTMLSelectElement).value as 'pt' | 'px',
            });
          }}
        >
          <option value="pt">pt</option>
          <option value="px">px</option>
        </select>
      </div>
    `;
  }

  private _handleLegendFontChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v <= 0) return;
    // pt input: keep the float value so 8pt round-trips as 8pt (rounding to
    // integer px would clip 33.33 → 33 → 7.9pt). px input: integer-only since
    // that's what the user typed.
    const fontSizePx =
      this._state.legend.fontSizeUnit === 'pt'
        ? Math.max(0.1, (v / 72) * this._state.dpi)
        : Math.max(1, Math.round(v));
    this._updateLegend({ fontSizePx });
  }

  // ── Legend section ──────────────────────────────────

  private _renderLegendSection() {
    const leg = this._state.legend;
    return html`
      <div class="publish-section">
        <div class="publish-section-title">Legend</div>

        <label class="publish-checkbox-label">
          <input
            type="checkbox"
            class="publish-checkbox"
            .checked=${leg.visible}
            @change=${(e: Event) => {
              this._updateLegend({ visible: (e.target as HTMLInputElement).checked });
            }}
          />
          Show legend
        </label>

        ${leg.visible
          ? html`
              <div class="publish-row">
                <label>Position</label>
                <select
                  class="publish-select"
                  .value=${leg.position}
                  @change=${(e: Event) => {
                    this._updateLegend({
                      position: (e.target as HTMLSelectElement).value as LegendPosition,
                    });
                  }}
                >
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="free">Free (drag to move)</option>
                </select>
              </div>

              <div class="publish-row">
                <label>Size %</label>
                ${this._renderSliderInput({
                  min: 10,
                  max: 100,
                  value: leg.widthPercent,
                  unit: '%',
                  onChange: (v) => this._updateLegend({ widthPercent: v }),
                })}
              </div>

              <div class="publish-row">
                <label>Font size</label>
                ${this._renderLegendFontInput(leg.fontSizePx, leg.fontSizeUnit)}
              </div>

              <div class="publish-row">
                <label>Columns</label>
                ${this._renderSliderInput({
                  min: 1,
                  max: 6,
                  value: leg.columns,
                  onChange: (v) => this._updateLegend({ columns: v }),
                })}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Overlays section ───────────────────────────────

  private _renderOverlaysSection() {
    const anns = this._state.overlays;
    return html`
      <div class="publish-section">
        <div class="publish-section-title">Overlays (${anns.length})</div>
        ${anns.map((a, i) => {
          const isSel = this._selectedItem?.kind === 'overlay' && this._selectedItem.index === i;
          return html`
            <div
              class="publish-overlay-item ${isSel ? 'selected' : ''}"
              style="flex-direction: column; align-items: stretch; gap: 4px;"
              data-publish-item="overlay-${i}"
              @click=${() => this._setSelection({ kind: 'overlay', index: i })}
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${a.type}${a.type === 'label' ? `: ${a.text}` : ''}</span>
                <button
                  class="delete-btn"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._removeOverlay(i);
                  }}
                  title="Remove"
                >
                  <svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              ${this._renderOverlayProps(a, i)}
            </div>
          `;
        })}
        ${anns.length === 0
          ? html`<span style="font-size: var(--text-xs); color: var(--muted)"
              >Use toolbar to add</span
            >`
          : nothing}
      </div>
    `;
  }

  private _renderOverlayProps(a: Overlay, i: number) {
    switch (a.type) {
      case 'circle':
        return html`
          <div class="publish-row" style="margin-bottom: 0;">
            <label>Stroke</label>
            ${this._renderSliderInput({
              min: 0.5,
              max: 10,
              step: 0.5,
              value: a.strokeWidth,
              unit: 'px',
              onChange: (v) => this._updateOverlay(i, { strokeWidth: v }),
            })}
          </div>
        `;
      case 'arrow':
        return html`
          <div class="publish-row" style="margin-bottom: 0;">
            <label>Stroke</label>
            ${this._renderSliderInput({
              min: 0.5,
              max: 10,
              step: 0.5,
              value: a.width,
              unit: 'px',
              onChange: (v) => this._updateOverlay(i, { width: v }),
            })}
          </div>
        `;
      case 'label':
        return html`
          <div class="publish-row" style="margin-bottom: 2px;">
            <label>Text</label>
            <input
              type="text"
              class="publish-row-input"
              style="width: 8rem; text-align: left;"
              .value=${a.text}
              @change=${(e: Event) => {
                this._updateOverlay(i, {
                  text: (e.target as HTMLInputElement).value || 'Label',
                });
              }}
            />
          </div>
          <div class="publish-row" style="margin-bottom: 0;">
            <label>Size</label>
            ${this._renderSliderInput({
              min: 8,
              max: 72,
              value: a.fontSize,
              unit: 'px',
              onChange: (v) => this._updateOverlay(i, { fontSize: v }),
            })}
          </div>
        `;
    }
  }

  // ── Insets section ─────────────────────────────────

  private _renderInsetSection() {
    const ins = this._state.insets;
    return html`
      <div class="publish-section">
        <div class="publish-section-title">Zoom Insets (${ins.length})</div>
        ${ins.map(
          (inset, i) => html`
            <div
              class="publish-overlay-item ${this._selectedItem?.kind === 'inset' &&
              this._selectedItem.index === i
                ? 'selected'
                : ''}"
              style="flex-direction: column; align-items: stretch; gap: 4px;"
              data-publish-item="inset-${i}"
              @click=${() => this._setSelection({ kind: 'inset', index: i })}
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Inset ${i + 1}</span>
                <button
                  class="delete-btn"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._removeInset(i);
                  }}
                  title="Remove"
                >
                  <svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div class="publish-row" style="margin-bottom: 0;">
                <label title="Dot size in the zoomed view, relative to the main plot. 1× matches.">
                  Dot size
                </label>
                ${this._renderSliderInput({
                  min: 0.5,
                  max: 20,
                  step: 0.1,
                  value: Number((inset.pointSizeScale ?? 1).toFixed(1)),
                  unit: '×',
                  onChange: (v) => this._updateInset(i, { pointSizeScale: v }),
                })}
              </div>
              <div class="publish-row" style="margin-bottom: 0;">
                <label>Border</label>
                ${this._renderSliderInput({
                  min: 0.5,
                  max: 10,
                  step: 0.5,
                  value: inset.border,
                  unit: 'px',
                  onChange: (v) => this._updateInset(i, { border: v }),
                })}
              </div>
            </div>
          `,
        )}
        ${ins.length === 0
          ? html`<span style="font-size: var(--text-xs); color: var(--muted)"
              >Use toolbar to add</span
            >`
          : nothing}
      </div>
    `;
  }

  // ── Options section ────────────────────────────────

  private _renderOptionsSection() {
    const s = this._state;
    return html`
      <div class="publish-section">
        <div class="publish-section-title">Options</div>

        <div class="publish-row">
          <label>Format</label>
          <div class="publish-format-toggle">
            <button
              class="btn-secondary btn-compact ${s.format === 'png' ? 'active' : ''}"
              @click=${() => this._updateState({ format: 'png' })}
            >
              PNG
            </button>
            <button
              class="btn-secondary btn-compact ${s.format === 'pdf' ? 'active' : ''}"
              @click=${() => this._updateState({ format: 'pdf' })}
            >
              PDF
            </button>
          </div>
        </div>

        <div class="publish-row">
          <label>Background</label>
          <select
            class="publish-select"
            .value=${s.background}
            @change=${(e: Event) => {
              this._updateState({
                background: (e.target as HTMLSelectElement).value as 'white' | 'transparent',
              });
            }}
          >
            <option value="white">White</option>
            <option value="transparent">Transparent</option>
          </select>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-publish-modal': ProtspacePublishModal;
  }
}
