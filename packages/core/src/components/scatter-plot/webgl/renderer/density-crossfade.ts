const DENSITY_MIN_DENSITY = 1 / 1024;

/**
 * Embedding Atlas `viewingParameters` (EmbeddingViewImpl.svelte:45-90, MIT,
 * Copyright (c) 2025 Apple Inc.) with maxDensity = visibleCount instead of
 * totalCount / 4. Returns the layer alpha.
 */
export function densityFrameAlpha(
  visibleCount: number,
  k: number,
  viewDimensionCss: number,
  forceOn: boolean,
): number {
  if (visibleCount <= 0 || k <= 0 || viewDimensionCss <= 0) return 0;
  if (forceOn) return 1;
  const threshold = Math.sqrt(visibleCount / DENSITY_MIN_DENSITY) / viewDimensionCss;
  const factor = (Math.min(Math.max((Math.log(k) - Math.log(threshold)) * 2, -1), 1) + 1) / 2;
  return 1 - factor;
}
