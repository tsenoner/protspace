/**
 * The reference the staging passes are checked against: every getter called per
 * point, a comparator sort, then each point staged in sorted order. Suites stage
 * through the passes and expect these exact buffers. Getter stubs with no pass
 * of their own stage through {@link referenceStylePass}, a pass over the getters.
 */
import type { PlotData, PlotDataPoint } from '@protspace/utils';
import type { PointStylePass, ScalePair, WebGLStyleGetters } from '../../types';
import { composePaintDepth } from '../../../paint-depth';
import { packPointStyle, type StagePointArrays, type StagePointStyleArrays } from '../stage-point';

/** Slot `slot` of `pd` as the getters see it, written into `sp`. */
function pointAt(sp: PlotDataPoint, pd: PlotData, slot: number): PlotDataPoint {
  const origIdx = pd.originalIndices ? pd.originalIndices[slot] : slot;
  sp.id = pd.proteinIds[origIdx];
  sp.x = pd.xs[slot];
  sp.y = pd.ys[slot];
  sp.originalIndex = origIdx;
  return sp;
}

/** Write a point's style channels at slot `idx`, from the getters. */
function stagePointStyle(
  target: StagePointStyleArrays,
  idx: number,
  sp: PlotDataPoint,
  opacity: number,
  style: WebGLStyleGetters,
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

export function referenceStage(
  style: WebGLStyleGetters,
  pd: PlotData,
  scales: ScalePair,
  count: number,
  selectionActive: boolean,
  target: StagePointArrays,
): { order: Uint32Array; cut: number } {
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = pointAt(sp, pd, i);
    depths[i] = composePaintDepth(style.getDepth(p), style.getOpacity(p), style.isPredicted(p));
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => depths[b] - depths[a] || a - b);
  let firstSelected = -1;
  for (let k = 0; k < count; k++) {
    const slot = order[k];
    const p = pointAt(sp, pd, slot);
    const opacity = style.getOpacity(p);
    target.dataPositions[k * 2] = scales.x(pd.xs[slot]);
    target.dataPositions[k * 2 + 1] = scales.y(pd.ys[slot]);
    stagePointStyle(target, k, p, opacity, style);
    target.depths[k] = depths[slot];
    if (selectionActive && firstSelected === -1 && opacity >= 0.99) firstSelected = k;
  }
  return { order, cut: selectionActive && firstSelected !== -1 ? firstSelected : count };
}

/** The colour-only re-stage: style channels in the staged order. */
export function referenceRestage(
  style: WebGLStyleGetters,
  pd: PlotData,
  order: Uint32Array,
  count: number,
  target: StagePointArrays,
): void {
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  for (let i = 0; i < count; i++) {
    const p = pointAt(sp, pd, order[i]);
    stagePointStyle(target, i, p, style.getOpacity(p), style);
  }
}

/**
 * A pass over the getters, keyed as the scatter plot's pass is: a record per
 * distinct colours and shape, and one point size for the pass, the first point's.
 */
export function referenceStylePass(style: WebGLStyleGetters): PointStylePass {
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  const records = { colors: [] as string[][], shapes: [] as string[], pointSize: 0 };
  const recordOf = new Map<string, number>();
  return {
    records,
    resolve(pd, count, out) {
      for (let i = 0; i < count; i++) {
        const point = pointAt(sp, pd, i);
        const opacity = style.getOpacity(point);
        const predicted = style.isPredicted(point);
        out.opacity[i] = opacity;
        out.depth[i] = composePaintDepth(style.getDepth(point), opacity, predicted);
        out.predicted[i] = predicted ? 1 : 0;
        if (i === 0) records.pointSize = style.getPointSize(point);
        const colors = style.getColors(point);
        const shape = style.getShape(point);
        const key = `${shape}\n${colors.join('\n')}`;
        let r = recordOf.get(key);
        if (r === undefined) {
          r = records.colors.push(colors) - 1;
          records.shapes.push(shape);
          recordOf.set(key, r);
        }
        out.record[i] = r;
      }
    },
  };
}
