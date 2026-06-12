import type { VisualizationData, PlotData } from '../types.js';
import { EMPTY_PLOT_DATA } from './plot-data.js';
import * as d3 from 'd3';

// Memoize x/y extents per PlotData object reference. Resizes pass the same PlotData
// (extents unchanged) and reuse the cached scan; any data/projection/plane change builds
// a NEW PlotData via clonePlotData, correctly missing the cache.
const extentCache = new WeakMap<PlotData, { x: [number, number]; y: [number, number] }>();

export class DataProcessor {
  static processVisualizationData(
    data: VisualizationData,
    projectionIndex: number,
    isolationMode: boolean = false,
    isolationHistory?: string[][],
    projectionPlane: 'xy' | 'xz' | 'yz' = 'xy',
    visibleProteinIds?: Set<string> | null,
  ): PlotData {
    if (!data.projections[projectionIndex]) {
      return { ...EMPTY_PLOT_DATA, proteinIds: data.protein_ids };
    }

    const proj = data.projections[projectionIndex];
    const src = proj.data;
    const dim = proj.dimension;
    const is3D = dim === 3;
    const proteinIds = data.protein_ids;
    const n = proteinIds.length;

    const isolating = isolationMode && !!isolationHistory && isolationHistory.length > 0;

    if (visibleProteinIds || isolating) {
      // Two-pass cull: find surviving protein indices. A survivor must pass the
      // query filter (visibleProteinIds, when present) AND appear in EVERY
      // isolation layer set. Both are id-membership intersections, so each kept
      // slot records its GLOBAL index into protein_ids (originalIndices) — style
      // getters and tooltips resolve annotation values by that index, and a
      // slice-local index would mis-resolve points under a non-prefix filter.
      const layerSets = isolating ? isolationHistory.map((layer) => new Set(layer)) : null;
      const survivors: number[] = [];
      for (let i = 0; i < n; i++) {
        const id = proteinIds[i];
        if (visibleProteinIds && !visibleProteinIds.has(id)) continue;
        if (layerSets && !layerSets.every((s) => s.has(id))) continue;
        survivors.push(i);
      }

      const count = survivors.length;
      const xs = new Float32Array(count);
      const ys = new Float32Array(count);
      const zs = is3D ? new Float32Array(count) : null;
      const originalIndices = new Int32Array(count);

      for (let k = 0; k < count; k++) {
        const origIdx = survivors[k];
        const base = origIdx * dim;
        const c0 = src[base];
        const c1 = src[base + 1];
        const c2 = is3D ? src[base + 2] : undefined;

        let xVal = c0;
        let yVal = c1;

        if (is3D && c2 !== undefined) {
          if (zs) zs[k] = c2;
          if (projectionPlane === 'xz') {
            yVal = c2;
          } else if (projectionPlane === 'yz') {
            xVal = c1;
            yVal = c2;
          }
        }

        xs[k] = xVal;
        ys[k] = yVal;
        originalIndices[k] = origIdx;
      }

      return { length: count, xs, ys, zs, originalIndices, proteinIds };
    }

    // No query filter, no isolation: identity mapping (originalIndices = null).
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const zs = is3D ? new Float32Array(n) : null;

    for (let i = 0; i < n; i++) {
      const base = i * dim;
      const c0 = src[base];
      const c1 = src[base + 1];
      const c2 = is3D ? src[base + 2] : undefined;

      let xVal = c0;
      let yVal = c1;

      if (is3D && c2 !== undefined) {
        if (zs) zs[i] = c2;
        if (projectionPlane === 'xz') {
          yVal = c2;
        } else if (projectionPlane === 'yz') {
          xVal = c1;
          yVal = c2;
        }
      }

      xs[i] = xVal;
      ys[i] = yVal;
    }

    return { length: n, xs, ys, zs, originalIndices: null, proteinIds };
  }

  static createScales(
    plotData: PlotData,
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number },
  ) {
    if (plotData.length === 0) return null;

    let extents = extentCache.get(plotData);
    if (!extents) {
      let xMin = Infinity,
        xMax = -Infinity,
        yMin = Infinity,
        yMax = -Infinity;
      const { xs, ys, length } = plotData;
      for (let i = 0; i < length; i++) {
        const x = xs[i];
        const y = ys[i];
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      extents = {
        x: [xMin, xMax],
        y: [yMin, yMax],
      };
      extentCache.set(plotData, extents);
    }
    const xExtent = extents.x;
    const yExtent = extents.y;

    const xPadding = Math.abs(xExtent[1] - xExtent[0]) * 0.05;
    const yPadding = Math.abs(yExtent[1] - yExtent[0]) * 0.05;

    return {
      x: d3
        .scaleLinear()
        .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
        .range([margin.left, width - margin.right]),
      y: d3
        .scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .range([height - margin.bottom, margin.top]),
    };
  }
}
