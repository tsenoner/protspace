import type { VisualizationData, PlotDataPoint } from '../types.js';
import * as d3 from 'd3';

export class DataProcessor {
  static processVisualizationData(
    data: VisualizationData,
    projectionIndex: number,
    isolationMode: boolean = false,
    isolationHistory?: string[][],
    visibleProteinIds?: Set<string> | null,
  ): PlotDataPoint[] {
    if (!data.projections[projectionIndex]) return [];

    const processedData: PlotDataPoint[] = data.protein_ids.map((id, index) => {
      const coordinates = (data.projections[projectionIndex].data[index] ?? [0, 0]) as
        | [number, number]
        | [number, number, number];

      return { id, x: coordinates[0], y: coordinates[1], originalIndex: index };
    });

    // Apply the query filter (and then isolation) as id-membership filters AFTER
    // the map, so every kept point keeps its GLOBAL `originalIndex`. Style getters
    // and tooltips resolve annotation values against the full dataset by that
    // index, so a slice-local index would mis-resolve points under a non-prefix
    // filter. This mirrors how isolation has always preserved the global index.
    let result = processedData;

    if (visibleProteinIds) {
      result = result.filter((p) => visibleProteinIds.has(p.id));
    }

    if (isolationMode && isolationHistory && isolationHistory.length > 0) {
      result = result.filter((p) => isolationHistory[0].includes(p.id));
      for (let i = 1; i < isolationHistory.length; i++) {
        const splitIds = isolationHistory[i];
        result = result.filter((p) => splitIds.includes(p.id));
      }
    }

    return result;
  }

  static createScales(
    plotData: PlotDataPoint[],
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number },
  ) {
    if (plotData.length === 0) return null;

    const xExtent = d3.extent(plotData, (d) => d.x) as [number, number];
    const yExtent = d3.extent(plotData, (d) => d.y) as [number, number];

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
