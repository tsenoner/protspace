import type { ZoomTransform } from 'd3';

interface ViewportWindow {
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

/** Cache key shared by virtualization, badge culling, and overlays — they must agree. */
export function buildViewKey(transform: ZoomTransform, width: number, height: number): string {
  return `${Math.round(transform.x)}|${Math.round(transform.y)}|${transform.k.toFixed(3)}|${width}|${height}`;
}
