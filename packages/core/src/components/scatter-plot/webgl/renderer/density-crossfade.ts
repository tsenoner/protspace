const DENSITY_MIN_DENSITY = 1 / 32;
const DENSITY_SATURATION = 0.2;
export const DENSITY_CONTOUR_MIN_DENSITY = 1 / 1024;

export interface DensityFrameParams {
  alpha: number;
  scaler: number;
}

/**
 * Embedding Atlas `viewingParameters` (EmbeddingViewImpl.svelte:45-90, MIT,
 * Copyright (c) 2025 Apple Inc.) with maxDensity = visibleCount instead of
 * totalCount / 4.
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
  const meanPointDensity = visibleCount / (k * k * viewDimensionCss * viewDimensionCss);
  const scaler = DENSITY_SATURATION / (meanPointDensity * cellAreaCss);
  if (forceOn) return { alpha: 1, scaler };
  const threshold = Math.sqrt(visibleCount / minDensity) / viewDimensionCss;
  const factor = (Math.min(Math.max((Math.log(k) - Math.log(threshold)) * 2, -1), 1) + 1) / 2;
  return { alpha: 1 - factor, scaler };
}
