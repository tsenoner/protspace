import type { PlotDataPoint } from '@protspace/utils';
import { getShapeIndex } from '@protspace/utils';
import type { WebGLStyleGetters } from '../types';
import { resolveColor } from '../color-utils';
import { fillLabelColorTexels } from './label-texture-utils';
import { pointRadiusCss } from './point-scale';

const DIAMOND_SIZE_SCALE = 1.25;

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
  predicted: Float32Array;
  /**
   * Null when no label atlas is allocated — either because the device could not
   * hold one, or because nothing multi-label is on screen. Staging still runs;
   * it just writes no texels, and the shader paints dominant colours.
   */
  labelColorData: Uint8Array | null;
  /**
   * Texels reserved per point in `labelColorData`, i.e. the most slices a marker
   * can show. Comes from the atlas plan, so a device-forced fidelity reduction
   * reaches the staged label count instead of being applied only at upload.
   */
  maxLabels: number;
}

/** The subset of style getters a single staged-point write depends on. */
export type StagePointStyle = Pick<
  WebGLStyleGetters,
  'getColors' | 'getPointSize' | 'getShape' | 'isPredicted'
>;

/**
 * What `stagePointStyle` touches: the style channels it writes (everything except
 * position and depth), plus `maxLabels`, which is an INPUT — the atlas stride it
 * clamps against, not a channel it fills.
 */
export type StagePointStyleArrays = Pick<
  StagePointArrays,
  'colors' | 'sizes' | 'labelCounts' | 'shapes' | 'predicted' | 'labelColorData' | 'maxLabels'
>;

/**
 * Write a point's *style* channels (color, alpha, size, shape, label texels) into
 * `target` at slot `idx`, from the per-point getters. The staging passes in
 * `pass-staging.ts` stage through it when the host has no style records.
 *
 * Pure helper: no GL, no WebGLRenderer import.
 */
export function stagePointStyle(
  target: StagePointStyleArrays,
  idx: number,
  sp: PlotDataPoint,
  opacity: number,
  style: StagePointStyle,
): void {
  packPointStyle(
    target,
    idx,
    style.getColors(sp),
    style.getShape(sp),
    style.getPointSize(sp),
    opacity,
    style.isPredicted(sp),
  );
}

/**
 * Write style channels from style values that are already resolved: the single
 * source of truth for the per-point style packing. {@link stagePointStyle} feeds
 * it the per-point getters; a style pass feeds it one category at a time.
 */
export function packPointStyle(
  target: StagePointStyleArrays,
  idx: number,
  pointColors: readonly string[],
  shape: string,
  pointSize: number,
  opacity: number,
  predicted: boolean,
): void {
  const [r, g, b] = resolveColor(pointColors[0] ?? '#888888');
  const shapeIndex = getShapeIndex(shape);

  target.colors[idx * 4] = r;
  target.colors[idx * 4 + 1] = g;
  target.colors[idx * 4 + 2] = b;
  target.colors[idx * 4 + 3] = Math.min(1, Math.max(0, opacity));

  const diameter = 2 * pointRadiusCss(pointSize);
  target.sizes[idx] = shapeIndex === 2 ? diameter * DIAMOND_SIZE_SCALE : diameter;
  // Clamped to what the atlas actually reserves for this point. Unclamped, a point
  // with more colours than `maxLabels` told the shader to draw slices that were
  // never written — so it sampled the NEXT point's texels and painted an unrelated
  // protein's colours.
  //
  // This is the layer that OWNS the invariant: it is the only writer of both
  // `labelCounts` and the texels they index. The shader re-applies the same clamp
  // (`min(count, u_maxLabels)` in POINT_FRAGMENT_SHADER) purely as belt-and-braces
  // against a stale uniform — do not relax this one on the strength of that one.
  target.labelCounts[idx] = Math.min(pointColors.length, target.maxLabels);
  target.shapes[idx] = shapeIndex;
  target.predicted[idx] = predicted ? 1 : 0;

  if (target.labelColorData) {
    fillLabelColorTexels(target.labelColorData, idx, pointColors, target.maxLabels);
  }
}
