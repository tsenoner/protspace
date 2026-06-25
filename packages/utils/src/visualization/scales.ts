import * as d3 from 'd3';
import type { PlotDataPoint } from '../types.js';

/**
 * Fraction of the data range added as padding on every edge when building plot
 * scales. Single source of truth shared by the live scales (here and
 * DataProcessor) and the WebGL export domain, so on-screen and exported framing
 * stay in lockstep.
 */
export const DATA_EXTENT_PADDING = 0.05;

export class ScaleManager {
  static createScales(
    data: PlotDataPoint[],
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number },
    padding: number = DATA_EXTENT_PADDING,
  ) {
    if (data.length === 0) return null;

    const xExtent = d3.extent(data, (d) => d.x) as [number, number];
    const yExtent = d3.extent(data, (d) => d.y) as [number, number];

    const xPadding = Math.abs(xExtent[1] - xExtent[0]) * padding;
    const yPadding = Math.abs(yExtent[1] - yExtent[0]) * padding;

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

  static createColorScale(
    values: (string | null)[],
    colors?: string[],
  ): d3.ScaleOrdinal<string, string> {
    const uniqueValues = Array.from(new Set(values.filter((v) => v != null))) as string[];

    return d3
      .scaleOrdinal<string, string>()
      .domain(uniqueValues)
      .range(colors || d3.schemeCategory10);
  }

  static createSizeScale(
    values: number[],
    range: [number, number] = [20, 200],
  ): d3.ScaleLinear<number, number> {
    return d3
      .scaleLinear()
      .domain(d3.extent(values) as [number, number])
      .range(range);
  }
}
