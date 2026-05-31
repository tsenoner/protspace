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

    if (isolationMode && isolationHistory && isolationHistory.length > 0) {
      // Two-pass isolation: find surviving protein indices (those in EVERY layer set).
      const layerSets = isolationHistory.map((layer) => new Set(layer));
      const survivors: number[] = [];
      for (let i = 0; i < n; i++) {
        const id = proteinIds[i];
        if (layerSets.every((s) => s.has(id))) {
          survivors.push(i);
        }
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

    // Non-isolated: identity mapping (originalIndices = null).
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
