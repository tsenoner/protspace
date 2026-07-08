/**
 * Publish Compositor
 *
 * Single rendering pipeline used by both the live preview and final export.
 * Captures the scatterplot, renders the legend, draws overlays and insets,
 * and composites everything onto a single output canvas.
 */

import { SHAPE_PATH_GENERATORS, renderPathOnCanvas } from '@protspace/utils';
import type { Overlay, Inset, LegendLayout, PublishState } from './publish-state';

// ── Legend item type (mirrors export-utils LegendExportItem) ─────────

export interface LegendItem {
  value: string;
  displayValue?: string;
  color: string;
  shape: string;
  count: number;
  isVisible: boolean;
}

/**
 * Wait until webfonts are ready before canvas rendering. Canvas falls back to the next
 * font in the stack silently if the requested font hasn't loaded — this prevents that.
 */
export async function waitForFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) {
    try {
      await fonts.ready;
    } catch {
      /* ignore */
    }
  }
}

// ── Scatterplot capture ──────────────────────────────────────────────

interface CaptureOptions {
  width: number;
  height: number;
  backgroundColor: string;
  /** Render the default fit-all view, ignoring any live zoom/pan. The figure
   *  editor always captures the unzoomed view so a zoomed plot doesn't leak
   *  into the figure (and the zoom-inset mapping stays correct). */
  resetView?: boolean;
}

/**
 * Capture the scatterplot to an off-screen canvas at the requested size.
 * Delegates to the element's `captureAtResolution` if available.
 */
export function capturePlotCanvas(
  plotEl: HTMLElement & {
    captureAtResolution?: (
      w: number,
      h: number,
      opts: { dpr?: number; backgroundColor?: string; resetView?: boolean },
    ) => HTMLCanvasElement;
  },
  opts: CaptureOptions,
): HTMLCanvasElement {
  if (typeof plotEl.captureAtResolution === 'function') {
    return plotEl.captureAtResolution(opts.width, opts.height, {
      dpr: 1,
      backgroundColor: opts.backgroundColor,
      resetView: opts.resetView,
    });
  }
  // Fallback: grab whatever canvas the component has
  const existing = plotEl.querySelector('canvas') as HTMLCanvasElement | null;
  if (existing) {
    const out = document.createElement('canvas');
    out.width = opts.width;
    out.height = opts.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(0, 0, opts.width, opts.height);
    // Pass the full source pixel rect so HiDPI live canvases (where existing.width
    // > opts.width) aren't silently halved.
    ctx.drawImage(existing, 0, 0, existing.width, existing.height, 0, 0, opts.width, opts.height);
    return out;
  }
  // Last resort: blank canvas
  const blank = document.createElement('canvas');
  blank.width = opts.width;
  blank.height = opts.height;
  const ctx = blank.getContext('2d')!;
  ctx.fillStyle = opts.backgroundColor;
  ctx.fillRect(0, 0, opts.width, opts.height);
  return blank;
}

// ── Legend rendering ─────────────────────────────────────────────────

interface LegendRenderOptions {
  width: number;
  height: number;
  fontSizePx: number;
  columns: number;
  legendTitle: string;
  backgroundColor: string;
}

/** Base sizes (at fontSizePx=24) for legend layout. Multiply by scale = fontSizePx/BASE_FONT. */
const LEGEND_BASE_FONT = 24;
const LEGEND_PADDING = 24;
const LEGEND_HEADER_HEIGHT = 60;
const LEGEND_ITEM_HEIGHT = 56;
const LEGEND_SYMBOL_SIZE = 28;
const LEGEND_HEADER_FONT_SIZE = 28;
const LEGEND_ITEM_FONT_SIZE = 24;
const LEGEND_TEXT_OFFSET = 8;
const LEGEND_COL_GAP = 16;
const LEGEND_COUNT_WIDTH = 48;
const LEGEND_ITEM_PADDING = 8;

/**
 * Count how many lines text would need when wrapped to maxWidth.
 * Uses the current font set on ctx for measurement.
 */
function measureWrappedLineCount(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): number {
  if (maxWidth <= 0 || !text) return 1;
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      line = word;
      lines++;
    } else {
      line = testLine;
    }
  }
  if (line) lines++;
  return Math.max(1, lines);
}

/**
 * Draw text with word wrapping. Returns the number of lines drawn.
 */
function fillTextWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  if (maxWidth <= 0) return 0;
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines++;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + lines * lineHeight);
    lines++;
  }
  return lines;
}

/**
 * Render legend items to an off-screen canvas.
 * Supports multi-column layout, truncation, and legacy Y-scale mode.
 */
function renderLegendCanvas(items: LegendItem[], opts: LegendRenderOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(100, Math.floor(opts.width));
  canvas.height = Math.max(100, Math.floor(opts.height));
  const ctx = canvas.getContext('2d')!;

  const scale = opts.fontSizePx / LEGEND_BASE_FONT;
  const padding = LEGEND_PADDING * scale;
  const headerHeight = LEGEND_HEADER_HEIGHT * scale;
  const itemHeight = LEGEND_ITEM_HEIGHT * scale;
  const symbolSize = LEGEND_SYMBOL_SIZE * scale;
  const headerFontSize = LEGEND_HEADER_FONT_SIZE * scale;
  const itemFontSize = LEGEND_ITEM_FONT_SIZE * scale;

  // Background
  ctx.fillStyle = opts.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const visibleItems = items.filter((it) => it.isVisible);
  const renderItems = visibleItems;
  const columns = Math.max(1, opts.columns);

  ctx.save();

  // Header
  ctx.fillStyle = '#1f2937';
  ctx.font = `600 ${headerFontSize}px Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const headerText = (opts.legendTitle || 'Legend').replace(/_/g, ' ');
  ctx.fillText(headerText, padding, padding + headerHeight / 2);

  // Items — distribute across columns with variable row heights
  const colWidth = (canvas.width - padding * 2) / columns;
  const itemsPerCol = Math.ceil(renderItems.length / columns);
  const textOffset = LEGEND_TEXT_OFFSET * scale;
  const colGap = LEGEND_COL_GAP * scale;
  const countWidth = LEGEND_COUNT_WIDTH * scale;
  const lineHeight = itemFontSize * 1.2;
  const itemPadding = LEGEND_ITEM_PADDING * scale; // vertical padding around each item

  // Pre-measure line counts for label wrapping
  ctx.font = `500 ${itemFontSize}px Arial, sans-serif`;
  const labelTexts = renderItems.map((it) => (it.displayValue ?? it.value).replace(/_/g, ' '));
  const lineCounts: number[] = [];
  for (let i = 0; i < renderItems.length; i++) {
    const col = Math.floor(i / itemsPerCol);
    const xBase = padding + col * colWidth;
    const colRight = xBase + colWidth - (col < columns - 1 ? colGap : padding);
    const maxTextWidth = colRight - countWidth - (xBase + symbolSize + textOffset);
    lineCounts.push(
      measureWrappedLineCount(ctx, labelTexts[i], maxTextWidth > 0 ? maxTextWidth : colWidth * 0.5),
    );
  }

  // Compute cumulative Y offsets per column from each item's actual height.
  const colYOffsets: number[][] = Array.from({ length: columns }, () => []);
  for (let col = 0; col < columns; col++) {
    let y = 0;
    for (let row = 0; row < itemsPerCol; row++) {
      const i = col * itemsPerCol + row;
      if (i >= renderItems.length) break;
      colYOffsets[col][row] = y;
      const lines = lineCounts[i];
      const thisItemH = Math.max(itemHeight, lines * lineHeight + itemPadding * 2);
      y += thisItemH;
    }
  }

  // Draw items
  for (let i = 0; i < renderItems.length; i++) {
    const col = Math.floor(i / itemsPerCol);
    const row = i % itemsPerCol;
    const it = renderItems[i];
    const lines = lineCounts[i];

    const xBase = padding + col * colWidth;
    const yOffset = colYOffsets[col][row];
    const y = padding + headerHeight + yOffset;
    const thisItemH = Math.max(itemHeight, lines * lineHeight + itemPadding * 2);
    const cy = y + thisItemH / 2;

    // Symbol — render the item's shape (custom shapes from legend settings, default is circle)
    const shapeKey = (it.shape || 'circle').toLowerCase();
    const gen = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;
    const pathString = gen(symbolSize);
    renderPathOnCanvas(
      ctx,
      pathString,
      xBase + symbolSize / 2,
      cy,
      it.color || '#888',
      '#394150',
      1,
    );

    // Label — centered vertically in the item
    ctx.fillStyle = '#1f2937';
    ctx.font = `500 ${itemFontSize}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const colRight = xBase + colWidth - (col < columns - 1 ? colGap : padding);
    const maxTextWidth = colRight - countWidth - (xBase + symbolSize + textOffset);
    const textBlockH = lines * lineHeight;
    const labelY = y + (thisItemH - textBlockH) / 2;
    fillTextWrapped(
      ctx,
      labelTexts[i],
      xBase + symbolSize + textOffset,
      labelY,
      maxTextWidth > 0 ? maxTextWidth : colWidth * 0.5,
      lineHeight,
    );

    // Count — right-aligned, vertically centered
    ctx.font = `500 ${itemFontSize}px Arial, sans-serif`;
    ctx.fillStyle = '#4b5563';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(it.count), colRight, cy);
  }

  ctx.restore();
  return canvas;
}

// ── Layout helpers ───────────────────────────────────────────────────

interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the tight height the legend needs for its content.
 * Uses the same scale factors as renderLegendCanvas.
 */
function computeLegendContentHeight(
  fontSizePx: number,
  itemCount: number,
  columns: number,
): number {
  const scale = fontSizePx / 24;
  const padding = 24 * scale;
  const headerHeight = 60 * scale;
  const itemHeight = 56 * scale;
  const cols = Math.max(1, columns);
  const itemsPerCol = Math.ceil(itemCount / cols);
  return padding + headerHeight + itemsPerCol * itemHeight + padding;
}

/**
 * Compute where the plot and legend go on the output canvas given a legend position.
 *
 * Side positions (left/right/top/bottom) split the canvas.
 * Corner positions (tl/tr/bl/br) overlay the legend on the plot.
 * 'none' gives the full canvas to the plot.
 *
 * @param visibleItemCount — number of visible legend items; used to compute
 *   tight height for overlay positions (corners + free). Falls back to 50%
 *   canvas height when omitted.
 */
export function computeLayout(
  totalW: number,
  totalH: number,
  legend: LegendLayout,
  visibleItemCount?: number,
): { plotRect: LayoutRect; legendRect: LayoutRect | null } {
  if (!legend.visible || legend.position === 'none') {
    return { plotRect: { x: 0, y: 0, w: totalW, h: totalH }, legendRect: null };
  }

  const pos = legend.position;
  const pct = legend.widthPercent / 100;

  // Side positions split the canvas
  if (pos === 'right') {
    const lw = Math.round(totalW * pct);
    return {
      plotRect: { x: 0, y: 0, w: totalW - lw, h: totalH },
      legendRect: { x: totalW - lw, y: 0, w: lw, h: totalH },
    };
  }
  if (pos === 'left') {
    const lw = Math.round(totalW * pct);
    return {
      plotRect: { x: lw, y: 0, w: totalW - lw, h: totalH },
      legendRect: { x: 0, y: 0, w: lw, h: totalH },
    };
  }
  if (pos === 'top') {
    const lh = Math.round(totalH * pct);
    return {
      plotRect: { x: 0, y: lh, w: totalW, h: totalH - lh },
      legendRect: { x: 0, y: 0, w: totalW, h: lh },
    };
  }
  if (pos === 'bottom') {
    const lh = Math.round(totalH * pct);
    return {
      plotRect: { x: 0, y: 0, w: totalW, h: totalH - lh },
      legendRect: { x: 0, y: totalH - lh, w: totalW, h: lh },
    };
  }

  // Corner positions overlay on the plot — use tight content height when item count known
  const cornerW = Math.round(totalW * pct);
  const cornerH =
    visibleItemCount !== undefined
      ? Math.min(
          Math.round(
            computeLegendContentHeight(legend.fontSizePx, visibleItemCount, legend.columns),
          ),
          totalH,
        )
      : Math.round(totalH * 0.5);
  const plotRect: LayoutRect = { x: 0, y: 0, w: totalW, h: totalH };

  const cornerRects: Record<string, LayoutRect> = {
    tl: { x: 0, y: 0, w: cornerW, h: cornerH },
    tr: { x: totalW - cornerW, y: 0, w: cornerW, h: cornerH },
    bl: { x: 0, y: totalH - cornerH, w: cornerW, h: cornerH },
    br: { x: totalW - cornerW, y: totalH - cornerH, w: cornerW, h: cornerH },
  };

  // Free-floating position
  if (pos === 'free') {
    const legendW = Math.round(totalW * pct);
    const legendH =
      visibleItemCount !== undefined
        ? Math.min(
            Math.round(
              computeLegendContentHeight(legend.fontSizePx, visibleItemCount, legend.columns),
            ),
            totalH,
          )
        : Math.round(totalH * 0.5);
    const plotRect: LayoutRect = { x: 0, y: 0, w: totalW, h: totalH };
    const freePos = legend.freePos;
    const lx = freePos ? Math.round(totalW * freePos.nx) : Math.round((totalW - legendW) / 2);
    const ly = freePos ? Math.round(totalH * freePos.ny) : Math.round((totalH - legendH) / 2);
    return { plotRect, legendRect: { x: lx, y: ly, w: legendW, h: legendH } };
  }

  return { plotRect, legendRect: cornerRects[pos] ?? null };
}

// ── Inset helpers ────────────────────────────────────────────────────

/**
 * Browsers cap canvas total area at roughly 16384² ≈ 268M pixels. Beyond that,
 * `getContext('2d')` may return null or draw to a zero-sized canvas silently.
 * We pick a slightly conservative cap below the lowest known limit so the
 * boosted capture stays well inside the safe envelope.
 */
export const MAX_CANVAS_PIXELS = 256_000_000;

/**
 * Compute how much to boost the plot capture resolution so inset source
 * regions have enough pixels to fill their target rects without upscaling.
 * Returns 1 when there are no insets.
 *
 * If `plotPixelArea` is provided, the returned boost is also capped so that
 * `plotPixelArea * boost²` stays under {@link MAX_CANVAS_PIXELS}.
 */
export function computeInsetBoost(
  insets: readonly Inset[],
  maxBoost = 4,
  plotPixelArea?: number,
): number {
  if (insets.length === 0) return 1;
  let maxZoom = 1;
  for (const inset of insets) {
    const zx = inset.targetRect.w / inset.sourceRect.w;
    const zy = inset.targetRect.h / inset.sourceRect.h;
    maxZoom = Math.max(maxZoom, zx, zy);
  }
  let boost = Math.min(Math.ceil(maxZoom), maxBoost);
  if (plotPixelArea && plotPixelArea > 0) {
    const maxBoostByArea = Math.sqrt(MAX_CANVAS_PIXELS / plotPixelArea);
    if (boost > maxBoostByArea) boost = Math.max(1, Math.floor(maxBoostByArea));
  }
  return boost;
}

// ── Inset rendering ──────────────────────────────────────────────────

/**
 * Render a zoom inset.
 *
 * Two source modes:
 *   - `srcIsPreRendered = true` — `srcCanvas` is a geometric (re-rendered)
 *     inset already sized for `targetRect`. Drawn whole into the target,
 *     no cropping. Used by the publish modal for crisp inset zoom where
 *     points stay native pixel size.
 *   - `srcIsPreRendered = false` (default) — legacy raster path. `srcCanvas`
 *     is the full plot canvas (possibly boosted); we crop `sourceRect` and
 *     upscale into `targetRect`.
 */
function renderInset(
  ctx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  inset: Inset,
  plotRect: LayoutRect,
  scale: number,
  options: { srcIsPreRendered?: boolean } = {},
) {
  const sr = inset.sourceRect;
  const tr = inset.targetRect;

  // Output-canvas coordinates (for borders, connectors — in output space)
  const sx = plotRect.x + sr.x * plotRect.w;
  const sy = plotRect.y + sr.y * plotRect.h;
  const sw = sr.w * plotRect.w;
  const sh = sr.h * plotRect.h;

  const tx = plotRect.x + tr.x * plotRect.w;
  const ty = plotRect.y + tr.y * plotRect.h;
  const tw = tr.w * plotRect.w;
  const th = tr.h * plotRect.h;

  if (options.srcIsPreRendered) {
    // Geometric render: srcCanvas IS the inset content, draw whole into target.
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, tx, ty, tw, th);
  } else {
    // Raster path: crop the source region from the full plot canvas and stretch.
    const cropX = sr.x * srcCanvas.width;
    const cropY = sr.y * srcCanvas.height;
    const cropW = sr.w * srcCanvas.width;
    const cropH = sr.h * srcCanvas.height;
    ctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, tx, ty, tw, th);
  }

  // Border
  if (inset.border > 0) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = inset.border * scale;
    ctx.strokeRect(tx, ty, tw, th);

    // Also outline source rect
    ctx.setLineDash([4 * scale, 4 * scale]);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);
  }

  // Connector lines — auto-detect best pair from all 4 corners
  if (inset.connector === 'lines') {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 * scale;

    // Source corners
    const srcCorners = [
      { x: sx, y: sy }, // top-left
      { x: sx + sw, y: sy }, // top-right
      { x: sx, y: sy + sh }, // bottom-left
      { x: sx + sw, y: sy + sh }, // bottom-right
    ];
    // Target corners
    const tgtCorners = [
      { x: tx, y: ty }, // top-left
      { x: tx + tw, y: ty }, // top-right
      { x: tx, y: ty + th }, // bottom-left
      { x: tx + tw, y: ty + th }, // bottom-right
    ];

    // Determine relative position of target vs source center
    const srcCx = sx + sw / 2;
    const srcCy = sy + sh / 2;
    const tgtCx = tx + tw / 2;
    const tgtCy = ty + th / 2;

    // Pick 2 pairs of corners to connect based on relative position
    let pairs: [number, number][];
    if (Math.abs(tgtCx - srcCx) > Math.abs(tgtCy - srcCy)) {
      if (tgtCx > srcCx) {
        // Target is right of source
        pairs = [
          [1, 0],
          [3, 2],
        ]; // src-TR→tgt-TL, src-BR→tgt-BL
      } else {
        // Target is left of source
        pairs = [
          [0, 1],
          [2, 3],
        ]; // src-TL→tgt-TR, src-BL→tgt-BR
      }
    } else {
      if (tgtCy > srcCy) {
        // Target is below source
        pairs = [
          [2, 0],
          [3, 1],
        ]; // src-BL→tgt-TL, src-BR→tgt-TR
      } else {
        // Target is above source
        pairs = [
          [0, 2],
          [1, 3],
        ]; // src-TL→tgt-BL, src-TR→tgt-BR
      }
    }

    ctx.beginPath();
    for (const [si, ti] of pairs) {
      ctx.moveTo(srcCorners[si].x, srcCorners[si].y);
      ctx.lineTo(tgtCorners[ti].x, tgtCorners[ti].y);
    }
    ctx.stroke();
  }
}

// ── Overlay rendering ────────────────────────────────────────────────

/**
 * Draw a single overlay onto the canvas context.
 * Coordinates are normalised 0–1 within the plot area.
 */
function renderOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: Overlay,
  plotRect: LayoutRect,
  scale: number,
) {
  switch (overlay.type) {
    case 'circle':
      drawCircleOverlay(ctx, overlay, plotRect, scale);
      break;
    case 'arrow':
      drawArrowOverlay(ctx, overlay, plotRect, scale);
      break;
    case 'label':
      drawLabelOverlay(ctx, overlay, plotRect, scale);
      break;
  }
}

function drawCircleOverlay(
  ctx: CanvasRenderingContext2D,
  a: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rotation: number;
    color: string;
    strokeWidth: number;
  },
  pr: LayoutRect,
  scale: number,
) {
  const cx = pr.x + a.cx * pr.w;
  const cy = pr.y + a.cy * pr.h;
  const rx = a.rx * pr.w;
  const ry = a.ry * pr.h;
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.strokeWidth * scale;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, a.rotation || 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawArrowOverlay(
  ctx: CanvasRenderingContext2D,
  a: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    width: number;
  },
  pr: LayoutRect,
  scale: number,
) {
  const x1 = pr.x + a.x1 * pr.w;
  const y1 = pr.y + a.y1 * pr.h;
  const x2 = pr.x + a.x2 * pr.w;
  const y2 = pr.y + a.y2 * pr.h;

  const sw = a.width * scale;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  // Arrowhead sized proportionally to stroke width
  const headLen = sw * 4;
  const headHalfW = sw * 2;
  const headAngle = Math.atan2(headHalfW, headLen);

  // Shaft ends slightly inside the arrowhead (overlap by half headLen) to avoid a gap
  const shaftStop = headLen * 0.5;
  const shaftEndX = x2 - shaftStop * Math.cos(angle);
  const shaftEndY = y2 - shaftStop * Math.sin(angle);

  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'butt';

  // Shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  // Arrowhead — filled polygon, no stroke
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - headAngle),
    y2 - headLen * Math.sin(angle - headAngle),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + headAngle),
    y2 - headLen * Math.sin(angle + headAngle),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLabelOverlay(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number; text: string; fontSize: number; rotation: number; color: string },
  pr: LayoutRect,
  scale: number,
) {
  const x = pr.x + a.x * pr.w;
  const y = pr.y + a.y * pr.h;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a.rotation || 0);
  ctx.fillStyle = a.color;
  ctx.font = `600 ${a.fontSize * scale}px Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(a.text, 0, 0);
  ctx.restore();
}

/** Draw a highlight outline around an overlay. Uses current ctx stroke style. */
function drawOverlayHighlight(
  ctx: CanvasRenderingContext2D,
  a: Overlay,
  pr: LayoutRect,
  displayScale: number,
) {
  const pad = 4 * displayScale;
  switch (a.type) {
    case 'circle': {
      const cx = pr.x + a.cx * pr.w;
      const cy = pr.y + a.cy * pr.h;
      const rx = a.rx * pr.w + pad;
      const ry = a.ry * pr.h + pad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, a.rotation || 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const x1 = pr.x + a.x1 * pr.w;
      const y1 = pr.y + a.y1 * pr.h;
      const x2 = pr.x + a.x2 * pr.w;
      const y2 = pr.y + a.y2 * pr.h;
      const minX = Math.min(x1, x2) - pad;
      const minY = Math.min(y1, y2) - pad;
      const w = Math.abs(x2 - x1) + pad * 2;
      const h = Math.abs(y2 - y1) + pad * 2;
      ctx.strokeRect(minX, minY, w, h);
      break;
    }
    case 'label': {
      const x = pr.x + a.x * pr.w;
      const y = pr.y + a.y * pr.h;
      ctx.font = `600 ${a.fontSize}px Arial, sans-serif`;
      const tw = ctx.measureText(a.text).width;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a.rotation || 0);
      ctx.strokeRect(-tw / 2 - pad, -a.fontSize / 2 - pad, tw + pad * 2, a.fontSize + pad * 2);
      ctx.restore();
      break;
    }
  }
}

// ── Main compositor ──────────────────────────────────────────────────

interface CompositeOptions {
  state: PublishState;
  plotCanvas: HTMLCanvasElement;
  legendItems: LegendItem[];
  legendTitle: string;
  /** When set, draw a highlight outline around this item on the preview. */
  highlightedItem?: { kind: 'overlay' | 'inset'; index: number } | null;
  /** Ratio of canvas pixels to display pixels — used to keep highlights at constant screen size. */
  displayScale?: number;
  /** Higher-resolution plot canvas for crisp inset rendering. Falls back to plotCanvas. */
  insetPlotCanvas?: HTMLCanvasElement;
  /** Per-inset geometric renders, one entry per `state.insets`. When the entry
   *  for inset i is non-null, it's drawn directly into the inset's target rect
   *  (no crop/upscale). Indices that are null fall back to the raster path. */
  insetRenders?: ReadonlyArray<HTMLCanvasElement | null>;
}

/**
 * Compose a publication figure onto the provided output canvas.
 * This is the **single renderer** used by both the live preview and final export.
 */
export function composeFigure(outCanvas: HTMLCanvasElement, opts: CompositeOptions): void {
  const { state, plotCanvas, legendItems, legendTitle } = opts;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) {
    console.warn('composeFigure: 2D context unavailable; skipping render');
    return;
  }
  const W = outCanvas.width;
  const H = outCanvas.height;

  const bg = state.background === 'white' ? '#ffffff' : 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, W, H);
  if (state.background === 'white') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  const visibleCount = legendItems.filter((it) => it.isVisible).length;
  const { plotRect, legendRect } = computeLayout(W, H, state.legend, visibleCount);

  // Scale overlay pixel properties proportionally to the reference width
  const overlayScale = W / (state.referenceWidth || W);

  // Draw scatterplot into its area
  ctx.drawImage(plotCanvas, plotRect.x, plotRect.y, plotRect.w, plotRect.h);

  // Legend
  if (legendRect && state.legend.visible && state.legend.position !== 'none') {
    const isCorner = ['tl', 'tr', 'bl', 'br', 'free'].includes(state.legend.position);
    const legendCanvas = renderLegendCanvas(legendItems, {
      width: legendRect.w,
      height: legendRect.h,
      fontSizePx: state.legend.fontSizePx,
      columns: state.legend.columns,
      legendTitle,
      backgroundColor: isCorner
        ? 'rgba(255,255,255,0.85)'
        : state.background === 'white'
          ? '#ffffff'
          : 'rgba(0,0,0,0)',
    });

    if (isCorner) {
      // Draw semi-transparent backdrop for corner overlays
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(legendRect.x, legendRect.y, legendRect.w, legendRect.h);
      ctx.globalAlpha = 1;
      ctx.drawImage(legendCanvas, legendRect.x, legendRect.y, legendRect.w, legendRect.h);
      ctx.restore();
    } else {
      ctx.drawImage(legendCanvas, legendRect.x, legendRect.y, legendRect.w, legendRect.h);
    }
  }

  // Insets — prefer per-inset geometric renders (sharp, native point sizes);
  // fall back to the raster path with the boosted canvas when none provided.
  const insetSrc = opts.insetPlotCanvas ?? plotCanvas;
  for (let i = 0; i < state.insets.length; i++) {
    const inset = state.insets[i];
    const preRender = opts.insetRenders?.[i] ?? null;
    if (preRender) {
      renderInset(ctx, preRender, inset, plotRect, overlayScale, { srcIsPreRendered: true });
    } else {
      renderInset(ctx, insetSrc, inset, plotRect, overlayScale);
    }
  }

  // Overlays
  for (const overlay of state.overlays) {
    renderOverlay(ctx, overlay, plotRect, overlayScale);
  }

  // Highlight outline for hovered item (preview only)
  const hi = opts.highlightedItem;
  if (hi) {
    const ds = opts.displayScale ?? 1;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 163, 224, 0.9)';
    ctx.lineWidth = 3 * ds;
    ctx.setLineDash([6 * ds, 4 * ds]);

    if (hi.kind === 'overlay') {
      const a = state.overlays[hi.index];
      if (a) {
        drawOverlayHighlight(ctx, a, plotRect, ds);
      }
    } else {
      const inset = state.insets[hi.index];
      if (inset) {
        // Highlight both source and target rects
        const sr = inset.sourceRect;
        const tr = inset.targetRect;
        const sx = plotRect.x + sr.x * plotRect.w;
        const sy = plotRect.y + sr.y * plotRect.h;
        const sw = sr.w * plotRect.w;
        const sh = sr.h * plotRect.h;
        const tx = plotRect.x + tr.x * plotRect.w;
        const ty = plotRect.y + tr.y * plotRect.h;
        const tw = tr.w * plotRect.w;
        const th = tr.h * plotRect.h;
        const hp = 2 * ds;
        ctx.strokeRect(sx - hp, sy - hp, sw + hp * 2, sh + hp * 2);
        ctx.strokeRect(tx - hp, ty - hp, tw + hp * 2, th + hp * 2);
      }
    }

    ctx.restore();
  }
}
