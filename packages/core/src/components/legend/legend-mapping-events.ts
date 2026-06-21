/**
 * Canonical typed details for the legend → scatter-plot mapping transport (INV-06/07).
 * color/shape + z-order travel as events; the scatter-plot consumes them here, the
 * legend's scatterplot-sync-controller produces them. One shape, two ends.
 */

/** INV-07: legend-colormapping-change.detail */
export interface LegendColorMappingDetail {
  colorMapping: Record<string, string>;
  shapeMapping: Record<string, string>;
  /** INV-08 contract: true skips depth re-sort + virtualization invalidation. */
  colorOnly: boolean;
}

/** INV-07: legend-zorder-change.detail (keyed by annotation value). */
export interface LegendZOrderDetail {
  zOrderMapping: Record<string, number>;
}

export type LegendColorMappingChangeEvent = CustomEvent<LegendColorMappingDetail>;
export type LegendZOrderChangeEvent = CustomEvent<LegendZOrderDetail>;

/** Runtime guard: a well-formed color-mapping detail carries both maps. */
export function isLegendColorMappingDetail(d: unknown): d is LegendColorMappingDetail {
  if (typeof d !== 'object' || d === null) return false;
  const detail = d as Record<string, unknown>;
  return (
    typeof detail.colorMapping === 'object' &&
    detail.colorMapping !== null &&
    typeof detail.shapeMapping === 'object' &&
    detail.shapeMapping !== null
  );
}

/** Runtime guard: a well-formed z-order detail carries the zOrderMapping. */
export function isLegendZOrderDetail(d: unknown): d is LegendZOrderDetail {
  if (typeof d !== 'object' || d === null) return false;
  return (
    typeof (d as Record<string, unknown>).zOrderMapping === 'object' &&
    (d as Record<string, unknown>).zOrderMapping !== null
  );
}
