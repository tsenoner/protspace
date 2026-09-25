const REFERENCE_PLOT_AREA = 1000 * 700;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function pointRadiusCss(pointSize: number): number {
  return Math.sqrt(Math.max(pointSize, 0)) / 3;
}

export function computePointScale(k: number, plotWidth: number, plotHeight: number): number {
  const zoom = clamp(k, 1, 256) ** 0.25;
  const screen = clamp(((plotWidth * plotHeight) / REFERENCE_PLOT_AREA) ** 0.25, 0.8, 1.5);
  return zoom * screen;
}
