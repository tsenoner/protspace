// A median laptop plot: the explore grid gives a (W - 36) x 3/4 plot, so the
// requested size draws unscaled there.
const REFERENCE_PLOT_AREA = 1000 * 700;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nominal radius in CSS px. `pointSize` is area-like (d3.symbol lineage). */
export function pointRadiusCss(pointSize: number): number {
  return Math.sqrt(Math.max(pointSize, 0)) / 3;
}

/**
 * CSS-px multiplier on every dot's nominal radius, for a plot of the given CSS
 * size at zoom `k`. Dot area doubles for every 4x of zoom-in and never shrinks
 * below the requested size; bigger plots get bigger dots, bounded so thumbnails
 * stay visible and 4K fill cost stays bounded.
 */
export function computePointScale(k: number, plotWidth: number, plotHeight: number): number {
  const zoom = clamp(k, 1, 256) ** 0.25;
  const screen = clamp(((plotWidth * plotHeight) / REFERENCE_PLOT_AREA) ** 0.25, 0.8, 1.5);
  return zoom * screen;
}
