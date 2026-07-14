// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotData, ScalePair } from '@protspace/utils';
import {
  ConnectorOverlayController,
  type ProvenanceConnectorStatus,
} from './connector-overlay-controller';

const plotData: PlotData = {
  length: 3,
  xs: new Float32Array([1, 2, 3]),
  ys: new Float32Array([4, 5, 6]),
  zs: null,
  originalIndices: new Int32Array([2, 0, 1]),
  proteinIds: ['target', 'outside', 'source'],
};

describe('ConnectorOverlayController', () => {
  let svg: SVGSVGElement;
  let overlay: d3.Selection<SVGGElement, unknown, null, undefined>;
  let status: ProvenanceConnectorStatus | null;
  let scales: ScalePair;
  let controller: ConnectorOverlayController;

  beforeEach(() => {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay = d3.select(svg).append('g').attr('class', 'overlay-container');
    status = null;
    scales = {
      x: d3.scaleLinear().domain([0, 10]).range([0, 100]),
      y: d3.scaleLinear().domain([0, 10]).range([100, 0]),
    };
    controller = new ConnectorOverlayController({
      getOverlayGroup: () => overlay,
      getPlotData: () => plotData,
      getScales: () => scales,
      onStatusChange: (next) => {
        status = next;
      },
    });
  });

  it('resolves ids through the current plot slots and draws non-semantic SVG geometry', () => {
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });

    const line = svg.querySelector('line.eat-provenance-connector');
    expect(line?.getAttribute('x1')).toBe('10');
    expect(line?.getAttribute('y1')).toBe('60');
    expect(line?.getAttribute('x2')).toBe('20');
    expect(line?.getAttribute('y2')).toBe('50');
    expect(svg.querySelectorAll('circle.eat-provenance-endpoint')).toHaveLength(2);
    expect(status).toEqual({ shown: 1, total: 1, missingEndpoints: 0 });
  });

  it('omits pairs with off-view endpoints and reports them accessibly to the host', () => {
    controller.set({
      pairs: [
        { sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.9 },
        { sourceProteinId: 'source', targetProteinId: 'missing', confidence: 0.7 },
      ],
      totalCandidates: 8,
    });

    expect(svg.querySelectorAll('line.eat-provenance-connector')).toHaveLength(1);
    expect(status).toEqual({ shown: 1, total: 8, missingEndpoints: 1 });
  });

  it('recomputes geometry on render without rebuilding for parent transforms', () => {
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });
    const line = svg.querySelector('line.eat-provenance-connector');
    overlay.attr('transform', 'translate(10,20) scale(2)');
    expect(line?.getAttribute('x1')).toBe('10');

    scales = {
      x: d3.scaleLinear().domain([0, 10]).range([0, 200]),
      y: d3.scaleLinear().domain([0, 10]).range([200, 0]),
    };
    controller.render();

    expect(svg.querySelector('line')?.getAttribute('x1')).toBe('20');
    expect(overlay.attr('transform')).toBe('translate(10,20) scale(2)');
  });

  it('clears geometry and status', () => {
    const statusSpy = vi.fn();
    controller = new ConnectorOverlayController({
      getOverlayGroup: () => overlay,
      getPlotData: () => plotData,
      getScales: () => scales,
      onStatusChange: statusSpy,
    });
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });

    controller.clear();

    expect(svg.querySelector('.connector-lines-layer')).toBeNull();
    expect(statusSpy).toHaveBeenLastCalledWith(null);
    expect(controller.hasActiveRequest()).toBe(false);
  });
});
