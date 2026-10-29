/**
 * The plot's image export, after the WebGL render: the duplicate-stack badges composited over the
 * points and the figure's background filled under both. Pure: the plot (captureAtResolution)
 * passes the canvases and sizes in.
 */
import { computeSizeScaleFactor } from './webgl';

/**
 * `badgesCanvas` drawn over `webglCanvas`, stretched to its size, then the points and badges on a
 * new canvas over `backgroundColor`. An empty or `'transparent'` background returns `webglCanvas`
 * itself.
 */
export function compositeExportCanvas(
  webglCanvas: HTMLCanvasElement,
  badgesCanvas: HTMLCanvasElement | null,
  backgroundColor: string | undefined,
): HTMLCanvasElement {
  if (badgesCanvas && badgesCanvas.width > 0 && badgesCanvas.height > 0) {
    const ctx = webglCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(
        badgesCanvas,
        0,
        0,
        badgesCanvas.width,
        badgesCanvas.height,
        0,
        0,
        webglCanvas.width,
        webglCanvas.height,
      );
    }
  }

  // Apply background color if the canvas has transparency
  if (backgroundColor && backgroundColor !== 'transparent') {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = webglCanvas.width;
    outputCanvas.height = webglCanvas.height;
    const ctx = outputCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      ctx.drawImage(webglCanvas, 0, 0);
      return outputCanvas;
    }
  }

  return webglCanvas;
}

/**
 * The badge scale of an export: dpr × the size factor the exported dots use (#302), so a badge
 * keeps its size relative to the dots at any output size.
 */
export function exportBadgeScale(
  output: { width: number; height: number },
  dpr: number,
  reference: { width: number; height: number } | undefined,
  live: { width: number; height: number },
): number {
  // output.width/height are PHYSICAL (logical × dpr); reference
  // and the live config dims are LOGICAL. Use logical reference dims so
  // sizeScaleFactor matches the dots' factor exactly and the dpr applied below
  // is not squared (mirrors ExportRenderer.initializeOffscreenContext). No-op
  // at dpr = 1.
  const logicalWidth = output.width / dpr;
  const logicalHeight = output.height / dpr;
  const sizeScaleFactor = computeSizeScaleFactor(
    reference?.width ?? logicalWidth,
    reference?.height ?? logicalHeight,
    live.width,
    live.height,
  );
  return dpr * sizeScaleFactor;
}
