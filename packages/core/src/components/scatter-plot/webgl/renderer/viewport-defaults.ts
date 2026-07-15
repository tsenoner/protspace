/** Fallback CSS-pixel viewport used when ScatterplotConfig omits width/height. */
export const DEFAULT_VIEWPORT_WIDTH = 800;
export const DEFAULT_VIEWPORT_HEIGHT = 600;

/**
 * Uniform export size-scale factor: the sqrt of the area ratio between the
 * reference dimensions (the export render's physical pixel dims, or the
 * caller-supplied pointSizeReference) and the live display dimensions.
 *
 * Extracted verbatim from ExportRenderer.initializeOffscreenContext so the
 * exported dots and the export badge overlay share ONE formula and can never
 * drift apart (#302). Callers must pass the same inputs the dot path uses:
 * refWidth/refHeight = pointSizeReference ?? physical output dims;
 * displayWidth/displayHeight = config.width/height (undefined falls back to
 * the default viewport).
 */
export function computeSizeScaleFactor(
  refWidth: number,
  refHeight: number,
  displayWidth: number | undefined,
  displayHeight: number | undefined,
): number {
  const dw = displayWidth ?? DEFAULT_VIEWPORT_WIDTH;
  const dh = displayHeight ?? DEFAULT_VIEWPORT_HEIGHT;
  return Math.sqrt((refWidth * refHeight) / (dw * dh));
}
