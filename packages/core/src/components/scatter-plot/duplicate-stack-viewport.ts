import type { ZoomTransform } from 'd3';

export interface ViewportWindow {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ViewportConfigSlice {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

/**
 * The visible window in base-pixel space (pre-zoom-transform, same space the
 * quadtree indexes), inflated by `padding` on every edge. Verbatim extraction
 * of the invertX/invertY + min/max block previously duplicated at three sites.
 */
export function computeViewportWindow(
  transform: ZoomTransform,
  config: ViewportConfigSlice,
  padding: number,
): ViewportWindow {
  const leftPx = transform.invertX(config.margin.left - padding);
  const rightPx = transform.invertX(config.width - config.margin.right + padding);
  const topPx = transform.invertY(config.margin.top - padding);
  const bottomPx = transform.invertY(config.height - config.margin.bottom + padding);
  return {
    minX: Math.min(leftPx, rightPx),
    maxX: Math.max(leftPx, rightPx),
    minY: Math.min(topPx, bottomPx),
    maxY: Math.max(topPx, bottomPx),
  };
}

/**
 * Inclusive point-in-window test in base-pixel space. Single source of truth for
 * the predicate previously copy-pasted at the badge-cull and spiderfy-hide sites.
 */
export function pointInWindow(p: { px: number; py: number }, win: ViewportWindow): boolean {
  return p.px >= win.minX && p.px <= win.maxX && p.py >= win.minY && p.py <= win.maxY;
}

/** Cache key shared by virtualization, badge culling, and overlays — they must agree. */
export function buildViewKey(transform: ZoomTransform, width: number, height: number): string {
  return `${Math.round(transform.x)}|${Math.round(transform.y)}|${transform.k.toFixed(3)}|${width}|${height}`;
}
