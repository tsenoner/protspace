import * as d3 from 'd3';

/**
 * Fraction of the data range added as padding on every edge when building plot
 * scales. Single source of truth shared by the live scales (here and
 * DataProcessor) and the WebGL export domain, so on-screen and exported framing
 * stay in lockstep.
 */
export const DATA_EXTENT_PADDING = 0.02;

/** A data-coordinate rectangle: what a plot shows, or the padded extent of its points. */
export interface DataDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** `domain` grown by {@link DATA_EXTENT_PADDING} of its span on every side. */
export function padDomain(domain: DataDomain): DataDomain {
  const xPad = Math.abs(domain.xMax - domain.xMin) * DATA_EXTENT_PADDING;
  const yPad = Math.abs(domain.yMax - domain.yMin) * DATA_EXTENT_PADDING;
  return {
    xMin: domain.xMin - xPad,
    xMax: domain.xMax + xPad,
    yMin: domain.yMin - yPad,
    yMax: domain.yMax + yPad,
  };
}

/** Space kept between a plot's edges and its data, in pixels. */
export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where a domain lands inside a plot, in pixels from the plot's top-left corner. */
export interface FitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The d3 linear scale pair the live plot and the export map points with. Declared in utils (not in
// @protspace/core's webgl/types.ts) because utils cannot import core; core re-exports it.
export type ScalePair = {
  x: d3.ScaleLinear<number, number>;
  y: d3.ScaleLinear<number, number>;
};

const hasSpan = (span: number) => Number.isFinite(span) && span > 0;

/**
 * The rectangle `domain` fills in a `width` × `height` plot with one pixels-per-unit for both axes
 * (design decision 3): the largest that fits inside the margins, centred there. An axis without a
 * span (one point, or equal values) cannot set the scale, so the other axis does and the zero-span
 * axis keeps its whole inner extent; with neither, the rectangle is the whole inner area. The inner
 * size never drops below 1 px, so no range collapses.
 */
export function fitRect(
  domain: DataDomain,
  width: number,
  height: number,
  margin: PlotMargin,
): FitRect {
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const dx = Math.abs(domain.xMax - domain.xMin);
  const dy = Math.abs(domain.yMax - domain.yMin);
  if (!hasSpan(dx) || !hasSpan(dy)) {
    return { left: margin.left, top: margin.top, width: innerWidth, height: innerHeight };
  }
  // innerWidth / dx against innerHeight / dy, compared without dividing; the one division comes
  // last, so a fit that lands on whole pixels stays exact.
  const widthLimited = innerWidth * dy <= innerHeight * dx;
  const fitWidth = widthLimited ? innerWidth : (dx * innerHeight) / dy;
  const fitHeight = widthLimited ? (dy * innerWidth) / dx : innerHeight;
  return {
    left: margin.left + (innerWidth - fitWidth) / 2,
    top: margin.top + (innerHeight - fitHeight) / 2,
    width: fitWidth,
    height: fitHeight,
  };
}

/**
 * x and y scales with one pixels-per-unit (see {@link fitRect}). The domains are exactly `domain`
 * at every size: the fit lives in the ranges, so a resize changes only the ranges and the renderer
 * carries its staged points over with a rescale instead of a re-stage.
 */
export function fitScales(
  domain: DataDomain,
  width: number,
  height: number,
  margin: PlotMargin,
): ScalePair {
  const rect = fitRect(domain, width, height, margin);
  return {
    x: d3
      .scaleLinear()
      .domain([domain.xMin, domain.xMax])
      .range([rect.left, rect.left + rect.width]),
    y: d3
      .scaleLinear()
      .domain([domain.yMin, domain.yMax])
      .range([rect.top + rect.height, rect.top]),
  };
}

export class ScaleManager {
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
