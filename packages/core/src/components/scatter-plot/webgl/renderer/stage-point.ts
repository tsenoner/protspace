import type { PlotDataPoint } from '@protspace/utils';
import { getShapeIndex } from '@protspace/utils';
import type { WebGLStyleGetters } from '../types';
import { resolveColor } from '../color-utils';
import { fillLabelColorTexels } from './label-texture-utils';

// ============================================================================
// Per-point staging constants (owned here; re-imported by the renderer)
// ============================================================================

export const POINT_SIZE_DIVISOR = 3;
export const MIN_POINT_SIZE = 1;
export const DIAMOND_SIZE_SCALE = 1.25;
export const MAX_LABELS = 8;

/**
 * The parallel target arrays a staged point is written into. The renderer holds
 * the same Float32Array/Uint8Array instances as class fields; this struct is a
 * zero-copy view re-pointed whenever capacity is reallocated.
 */
export interface StagePointArrays {
  dataPositions: Float32Array;
  sizes: Float32Array;
  colors: Float32Array;
  depths: Float32Array;
  labelCounts: Float32Array;
  shapes: Float32Array;
  labelColorData: Uint8Array;
}

/** The subset of style getters a single staged-point write depends on. */
export type StagePointStyle = Pick<WebGLStyleGetters, 'getColors' | 'getPointSize' | 'getShape'>;

/**
 * Write one staged point into the parallel target arrays at slot `idx`.
 *
 * `screenX`/`screenY` are already in device-independent screen space (the caller
 * applied `scales.x`/`scales.y`). `opacity`/`depth` were computed by the caller's
 * painter's-algorithm sort. `sizeScaleFactor` defaults to 1 for the live path;
 * the offscreen export passes the export/display area ratio.
 *
 * Pure helper: no GL, no WebGLRenderer import.
 */
export function stagePoint(
  target: StagePointArrays,
  idx: number,
  sp: PlotDataPoint,
  screenX: number,
  screenY: number,
  opacity: number,
  depth: number,
  style: StagePointStyle,
  dpr: number,
  sizeScaleFactor = 1,
): void {
  target.dataPositions[idx * 2] = screenX;
  target.dataPositions[idx * 2 + 1] = screenY;

  const pointColors = style.getColors(sp);
  const [r, g, b] = resolveColor(pointColors[0] ?? '#888888');
  const size = Math.sqrt(style.getPointSize(sp)) / POINT_SIZE_DIVISOR;
  const shapeIndex = getShapeIndex(style.getShape(sp));

  target.colors[idx * 4] = r;
  target.colors[idx * 4 + 1] = g;
  target.colors[idx * 4 + 2] = b;
  target.colors[idx * 4 + 3] = Math.min(1, Math.max(0, opacity));

  const basePointSize = Math.max(MIN_POINT_SIZE, size * 2 * dpr * sizeScaleFactor);
  target.sizes[idx] = shapeIndex === 2 ? basePointSize * DIAMOND_SIZE_SCALE : basePointSize;
  target.depths[idx] = depth;
  target.labelCounts[idx] = pointColors.length;
  target.shapes[idx] = shapeIndex;

  fillLabelColorTexels(target.labelColorData, idx, pointColors, MAX_LABELS);
}
