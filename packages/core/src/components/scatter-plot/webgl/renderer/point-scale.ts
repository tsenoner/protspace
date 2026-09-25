const REFERENCE_PLOT_AREA = 1000 * 700;
const ZOOM_EXPONENT = 0.25;
const ZOOM_K_MIN = 1;
const ZOOM_K_MAX = 256;
const SCREEN_EXPONENT = 0.25;
const SCREEN_SCALE_MIN = 0.8;
const SCREEN_SCALE_MAX = 1.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function pointRadiusCss(pointSize: number): number {
  return Math.sqrt(Math.max(pointSize, 0)) / 3;
}

export function computePointScale(k: number, plotWidth: number, plotHeight: number): number {
  const zoom = clamp(k, ZOOM_K_MIN, ZOOM_K_MAX) ** ZOOM_EXPONENT;
  const screen = clamp(
    ((plotWidth * plotHeight) / REFERENCE_PLOT_AREA) ** SCREEN_EXPONENT,
    SCREEN_SCALE_MIN,
    SCREEN_SCALE_MAX,
  );
  return zoom * screen;
}
