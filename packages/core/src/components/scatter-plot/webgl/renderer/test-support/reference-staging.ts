/**
 * The reference the staging passes are checked against: every getter called per
 * point, a comparator sort, then each point staged in sorted order. Suites stage
 * through the passes and expect these exact buffers. Getter stubs with no pass
 * of their own stage through {@link referenceStylePass}, the same model as a pass.
 */
import type { PlotData, PlotDataPoint } from '@protspace/utils';
import {
  PER_POINT_STYLE,
  type PointStylePass,
  type ScalePair,
  type WebGLStyleGetters,
} from '../../types';
import { composePaintDepth } from '../point-staging';
import { stagePointStyle, type StagePointArrays } from '../stage-point';

export function stageArrays(capacity: number, maxLabels: number, atlas: boolean): StagePointArrays {
  return {
    dataPositions: new Float32Array(capacity * 2),
    sizes: new Float32Array(capacity),
    colors: new Float32Array(capacity * 4),
    depths: new Float32Array(capacity),
    labelCounts: new Float32Array(capacity),
    shapes: new Float32Array(capacity),
    predicted: new Float32Array(capacity),
    labelColorData: atlas ? new Uint8Array(capacity * maxLabels * 4) : null,
    maxLabels,
  };
}

export function referenceStage(
  style: WebGLStyleGetters,
  pd: PlotData,
  scales: ScalePair,
  count: number,
  selectionActive: boolean,
  target: StagePointArrays,
): { order: Uint32Array; cut: number } {
  const oi = pd.originalIndices;
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  const point = (slot: number) => {
    const origIdx = oi ? oi[slot] : slot;
    sp.id = pd.proteinIds[origIdx];
    sp.x = pd.xs[slot];
    sp.y = pd.ys[slot];
    sp.originalIndex = origIdx;
    return sp;
  };
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = point(i);
    depths[i] = composePaintDepth(style.getDepth(p), style.getOpacity(p), style.isPredicted(p));
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => depths[b] - depths[a] || a - b);
  let firstSelected = -1;
  for (let k = 0; k < count; k++) {
    const slot = order[k];
    const p = point(slot);
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
  const oi = pd.originalIndices;
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  for (let i = 0; i < count; i++) {
    const slot = order[i];
    sp.originalIndex = oi ? oi[slot] : slot;
    sp.id = pd.proteinIds[sp.originalIndex];
    sp.x = pd.xs[slot];
    sp.y = pd.ys[slot];
    stagePointStyle(target, i, sp, style.getOpacity(sp), style);
  }
}

/** A pass with no records: every slot staged through the getters, one at a time. */
export function referenceStylePass(style: WebGLStyleGetters): PointStylePass {
  const sp: PlotDataPoint = { id: '', x: 0, y: 0, originalIndex: 0 };
  const pointAt = (pd: PlotData, slot: number): PlotDataPoint => {
    const origIdx = pd.originalIndices ? pd.originalIndices[slot] : slot;
    sp.id = pd.proteinIds[origIdx];
    sp.x = pd.xs[slot];
    sp.y = pd.ys[slot];
    sp.originalIndex = origIdx;
    return sp;
  };
  return {
    records: { colors: [], shapes: [], pointSize: 0 },
    resolve(pd, count, out) {
      for (let i = 0; i < count; i++) {
        const point = pointAt(pd, i);
        const opacity = style.getOpacity(point);
        out.opacity[i] = opacity;
        out.depth[i] = composePaintDepth(style.getDepth(point), opacity, style.isPredicted(point));
        out.record[i] = PER_POINT_STYLE;
      }
    },
    stageSlot(target, idx, pd, slot, opacity) {
      stagePointStyle(target, idx, pointAt(pd, slot), opacity, style);
    },
  };
}
