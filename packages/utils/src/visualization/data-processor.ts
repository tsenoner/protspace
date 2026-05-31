import type { VisualizationData, PlotDataPoint } from '../types.js';
import * as d3 from 'd3';

export class DataProcessor {
  static processVisualizationData(
    data: VisualizationData,
    projectionIndex: number,
    isolationMode: boolean = false,
    isolationHistory?: string[][],
    projectionPlane: 'xy' | 'xz' | 'yz' = 'xy',
  ): PlotDataPoint[] {
    if (!data.projections[projectionIndex]) return [];

    const processedData: PlotDataPoint[] = data.protein_ids.map((id, index) => {
      const coordinates = (data.projections[projectionIndex].data[index] ?? [0, 0]) as
        | [number, number]
        | [number, number, number];

      let xVal = coordinates[0];
      let yVal = coordinates[1];
      if (coordinates.length === 3) {
        if (projectionPlane === 'xz') {
          yVal = coordinates[2];
        } else if (projectionPlane === 'yz') {
          xVal = coordinates[1];
          yVal = coordinates[2];
        }
        return { id, x: xVal, y: yVal, z: coordinates[2], originalIndex: index };
      }
      return { id, x: xVal, y: yVal, originalIndex: index };
    });

    if (isolationMode && isolationHistory && isolationHistory.length > 0) {
      let filteredData = processedData;
      for (let i = 0; i < isolationHistory.length; i++) {
        const layerSet = new Set(isolationHistory[i]);
        filteredData = filteredData.filter((p) => layerSet.has(p.id));
      }
      return filteredData;
    }

    return processedData;
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
