import type { PublishState } from './publish-state';

/** The plot surface the figure editor renders from: the scatterplot's export hooks. */
export interface CaptureablePlotElement extends HTMLElement {
  captureAtResolution?: (
    w: number,
    h: number,
    opts: {
      dpr?: number;
      backgroundColor?: string;
      dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number };
      pointSizeReference?: { width: number; height: number };
      resetView?: boolean;
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

/** Updates closer together than this reuse the last render instead of a fresh WebGL pass. */
const FAST_PATH_MS = 80;
/** After a reused render, one fresh render follows once updates stop for this long. */
const SETTLE_MS = 120;

/**
 * The figure editor's zoom-inset renders. Each inset is its own scoped WebGL pass, so points stay
 * native pixel size in the inset (instead of the giant blobs raster crop+upscale produces).
 *
 * Renders are cached by sourceRect + plot dims, so resizing the target rect (drag-to-grow the
 * inset) doesn't trigger a re-render — the compositor scales the cached canvas to the new
 * target. The WebGL pass only fires when the user actually changes the source region or the plot
 * resizes.
 */
export class InsetRenderCache {
  /** Renders by source rect, render size, plot size, dot scale and background. */
  readonly renders = new Map<string, HTMLCanvasElement>();
  /** The last canvas per inset: the compositor stretches it while a drag outruns fresh renders. */
  lastCanvases: Array<HTMLCanvasElement | null> = [];
  lastRenderAt = 0;
  settleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onSettle: () => void;

  /** `onSettle` asks the editor for one more redraw once a burst of updates has stopped. */
  constructor(onSettle: () => void) {
    this.onSettle = onSettle;
  }

  /**
   * One entry per `state.insets`; null when the plot element doesn't expose `getDataExtent`
   * (older builds) or has no points yet — the compositor falls back to the legacy raster path in
   * that case.
   */
  capture(
    plotEl: CaptureablePlotElement,
    state: Pick<PublishState, 'insets'>,
    plotRect: { w: number; h: number },
    bgColor: string,
    opts: { forExport?: boolean } = {},
  ): Array<HTMLCanvasElement | null> {
    if (state.insets.length === 0) {
      this.renders.clear();
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
    const fastPath = !opts.forExport && now - this.lastRenderAt < FAST_PATH_MS;
    const livingKeys = new Set<string>();
    if (this.lastCanvases.length !== state.insets.length) {
      this.lastCanvases.length = state.insets.length;
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
      const cached = this.renders.get(key);
      if (cached) {
        this.lastCanvases[i] = cached;
        return cached;
      }
      // No exact match. During high-frequency updates, return the previous
      // render (any size) and let the compositor stretch it — saves the
      // ~15–30 ms WebGL setup cost per frame.
      if (fastPath && this.lastCanvases[i]) {
        return this.lastCanvases[i];
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
          // dataDomain is derived from the full (default-view) extent, so the
          // live zoom must not be re-applied on top of it (#294).
          resetView: true,
        });
        this.renders.set(key, canvas);
        this.lastCanvases[i] = canvas;
        didFreshRender = true;
        return canvas;
      } catch {
        return this.lastCanvases[i] ?? null;
      }
    });
    if (didFreshRender) {
      this.lastRenderAt = now;
      // Activity settled enough to render fresh — drop any pending follow-up.
      if (this.settleTimer !== null) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
    } else if (fastPath) {
      // fastPath was taken: queue one more redraw so the cached canvas gets
      // replaced with a crisp render once the user stops dragging.
      if (this.settleTimer !== null) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.onSettle();
      }, SETTLE_MS);
    }
    // Evict cache entries no longer referenced (inset removed, sourceRect changed).
    for (const k of this.renders.keys()) {
      if (!livingKeys.has(k)) this.renders.delete(k);
    }
    return renders;
  }

  /** Drops every render and cancels a pending settle redraw. */
  clear(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.renders.clear();
    this.lastCanvases = [];
    this.lastRenderAt = 0;
  }
}
