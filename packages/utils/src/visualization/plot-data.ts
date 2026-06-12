import type { PlotData, PlotDataPoint } from '../types.js';

export const EMPTY_PLOT_DATA: PlotData = {
  length: 0,
  xs: new Float32Array(0),
  ys: new Float32Array(0),
  zs: null,
  originalIndices: null,
  proteinIds: [],
};

/** Protein index for a slot (handles the identity-mapping fast path). */
export function plotDataOriginalIndex(pd: PlotData, slot: number): number {
  return pd.originalIndices ? pd.originalIndices[slot] : slot;
}

/** Protein id for a slot. */
export function plotDataId(pd: PlotData, slot: number): string {
  return pd.proteinIds[plotDataOriginalIndex(pd, slot)];
}

/** Materialize a boxed PlotDataPoint for a slot — use only at interaction boundaries. */
export function materializePlotDataPoint(pd: PlotData, slot: number): PlotDataPoint {
  const originalIndex = plotDataOriginalIndex(pd, slot);
  const point: PlotDataPoint = {
    id: pd.proteinIds[originalIndex],
    x: pd.xs[slot],
    y: pd.ys[slot],
    originalIndex,
  };
  if (pd.zs) point.z = pd.zs[slot];
  return point;
}

/** Shallow clone (SAME typed-array refs) — to trigger Lit @state reactivity after in-place coord mutation. */
export function clonePlotData(pd: PlotData): PlotData {
  return { ...pd };
}

/** Gather a subset PlotData for the given slots (used only by >1M viewport virtualization). */
export function gatherPlotData(pd: PlotData, slots: ArrayLike<number>): PlotData {
  const n = slots.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = pd.zs ? new Float32Array(n) : null;
  const originalIndices = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    xs[i] = pd.xs[slot];
    ys[i] = pd.ys[slot];
    if (zs && pd.zs) zs[i] = pd.zs[slot];
    originalIndices[i] = plotDataOriginalIndex(pd, slot);
  }
  return { length: n, xs, ys, zs, originalIndices, proteinIds: pd.proteinIds };
}
