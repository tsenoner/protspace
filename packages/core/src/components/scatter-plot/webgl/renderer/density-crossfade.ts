/**
 * The density layer's cross-fade: how strongly the layer shows, and how a
 * blurred cell count maps into [0, 1].
 *
 * Pure arithmetic, no GL, because this is where a wrong sign produces a
 * plausible but wrong picture. Phase 2 supplies the inputs (visible count, mode).
 */

/** Tunables. Calibrated in Task 5.3; defined here only, never hand-tuned elsewhere. */
/** Visible points per CSS px^2 at the fade midpoint. Embedding Atlas ships 1/16. */
const DENSITY_MIN_DENSITY = 1 / 32;
/** The ramp saturates at (1 / DENSITY_SATURATION) = 5x the mean cell count. EA value. */
const DENSITY_SATURATION = 0.2;
/**
 * The same midpoint for the CONTOUR style, which engages far earlier because it
 * answers a different question. The heatmap replaces points the eye can no
 * longer separate, so it waits for overplotting; contour lines sit over the
 * points and only annotate them, so they are useful on the ~7.8K demo dataset
 * at k = 1, where the mean density is about 1/185 points per CSS px^2 and the
 * heatmap's 1/32 gives alpha 0. 1/1024 puts the fade midpoint two zoom steps
 * above the default view, so the lines are solid at k = 1 and gone by k = 4.
 */
export const DENSITY_CONTOUR_MIN_DENSITY = 1 / 1024;

export interface DensityFrameParams {
  /** 0 = layer skipped entirely, 1 = fully shown. */
  alpha: number;
  /** Multiplies a blurred cell count into [0, 1]. */
  scaler: number;
}

/**
 * Embedding Atlas `viewingParameters` (EmbeddingViewImpl.svelte:45-90, MIT,
 * Copyright (c) 2025 Apple Inc.) with maxDensity = visibleCount instead of
 * totalCount / 4.
 *
 * `viewDimensionCss` is max(width, height) of the plot in CSS px, `cellAreaCss`
 * the area of one density grid cell in CSS px^2, `k` the zoom transform's scale.
 * The fade spans exactly a factor of e in k, centred on the k at which the mean
 * point density equals DENSITY_MIN_DENSITY: density engages when the view is
 * overplotted, scaled by N, canvas and zoom, with no hand-tuned N threshold.
 */
export function densityFrameParams(
  visibleCount: number,
  k: number,
  viewDimensionCss: number,
  cellAreaCss: number,
  forceOn: boolean,
  minDensity: number = DENSITY_MIN_DENSITY,
): DensityFrameParams {
  if (visibleCount <= 0 || k <= 0 || viewDimensionCss <= 0 || cellAreaCss <= 0) {
    return { alpha: 0, scaler: 0 };
  }
  // Points per CSS px^2 of the current view.
  const meanPointDensity = visibleCount / (k * k * viewDimensionCss * viewDimensionCss);
  const scaler = DENSITY_SATURATION / (meanPointDensity * cellAreaCss);
  if (forceOn) return { alpha: 1, scaler };
  // The k at which meanPointDensity == minDensity.
  const threshold = Math.sqrt(visibleCount / minDensity) / viewDimensionCss;
  const factor = (Math.min(Math.max((Math.log(k) - Math.log(threshold)) * 2, -1), 1) + 1) / 2;
  return { alpha: 1 - factor, scaler };
}
