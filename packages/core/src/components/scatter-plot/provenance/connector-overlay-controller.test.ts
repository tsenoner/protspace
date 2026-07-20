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

// Mirrors ConnectorOverlayController#endpointBaseRadiusPx for pointSize 240 (the
// default), so expectations track the formula instead of a hand-computed constant.
const EXPECTED_BASE_RADIUS_PX = Math.max(4, Math.sqrt(240) / 3 + 2);

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
      getPointSize: () => 240,
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

  it('materializes a retained pair when an off-view endpoint re-enters the view', () => {
    let currentPlotData: PlotData = {
      length: 1,
      xs: new Float32Array([1]),
      ys: new Float32Array([4]),
      zs: null,
      originalIndices: null,
      proteinIds: ['source'],
    };
    controller = new ConnectorOverlayController({
      getOverlayGroup: () => overlay,
      getPlotData: () => currentPlotData,
      getScales: () => scales,
      onStatusChange: (next) => {
        status = next;
      },
    });
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.9 }],
      totalCandidates: 1,
    });
    expect(svg.querySelectorAll('line.eat-provenance-connector')).toHaveLength(0);
    expect(status).toEqual({ shown: 0, total: 1, missingEndpoints: 1 });

    currentPlotData = plotData;
    controller.render();

    expect(svg.querySelectorAll('line.eat-provenance-connector')).toHaveLength(1);
    expect(status).toEqual({ shown: 1, total: 1, missingEndpoints: 0 });
  });

  it('adds resolver-known filtered or isolated candidates to unavailable status', () => {
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.9 }],
      totalCandidates: 3,
      unavailableCandidates: 2,
    });

    expect(status).toEqual({ shown: 1, total: 3, missingEndpoints: 2 });
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

  it('inverse-scales endpoint radii without rebuilding connector geometry', () => {
    controller.set({
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    });
    const line = svg.querySelector('line.eat-provenance-connector');
    const endpointsBefore = [...svg.querySelectorAll('circle.eat-provenance-endpoint')];
    expect(endpointsBefore.map((endpoint) => Number(endpoint.getAttribute('r')))).toEqual([
      EXPECTED_BASE_RADIUS_PX,
      EXPECTED_BASE_RADIUS_PX,
    ]);

    controller.updateZoomScale(2.5);

    const endpointsAfter = [...svg.querySelectorAll('circle.eat-provenance-endpoint')];
    expect(endpointsAfter).toEqual(endpointsBefore);
    expect(endpointsAfter.map((endpoint) => Number(endpoint.getAttribute('r')))).toEqual([
      EXPECTED_BASE_RADIUS_PX / 2.5,
      EXPECTED_BASE_RADIUS_PX / 2.5,
    ]);
    expect(svg.querySelector('line.eat-provenance-connector')).toBe(line);
    expect(line?.getAttribute('x1')).toBe('10');

    controller.updateZoomScale(Number.NaN);
    expect(endpointsAfter.map((endpoint) => Number(endpoint.getAttribute('r')))).toEqual([
      EXPECTED_BASE_RADIUS_PX,
      EXPECTED_BASE_RADIUS_PX,
    ]);
  });

  it('retains stable-view reuse across clear but releases dataset-owned lookup state explicitly', () => {
    let currentPlotData = plotData;
    let proteinIdReads = 0;
    const observedProteinIds = new Proxy(plotData.proteinIds, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) proteinIdReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    currentPlotData = { ...plotData, proteinIds: observedProteinIds };
    controller = new ConnectorOverlayController({
      getOverlayGroup: () => overlay,
      getPlotData: () => currentPlotData,
      getScales: () => scales,
      onStatusChange: (next) => {
        status = next;
      },
    });
    const request = {
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    };

    controller.set(request);
    expect(proteinIdReads).toBe(plotData.length);
    const cache = controller as unknown as {
      indexedPlotData: PlotData | null;
      idToSlot: Map<string, number>;
    };
    expect(cache.indexedPlotData).toBe(currentPlotData);
    expect([...cache.idToSlot.keys()].sort()).toEqual(['outside', 'source', 'target']);

    controller.clear();
    controller.set(request);
    expect(proteinIdReads).toBe(plotData.length);
    expect(cache.indexedPlotData).toBe(currentPlotData);

    controller.invalidateDataCache();
    expect(cache.indexedPlotData).toBeNull();
    expect(cache.idToSlot.size).toBe(0);

    controller.set(request);
    expect(proteinIdReads).toBe(plotData.length * 2);

    currentPlotData = { ...currentPlotData };
    controller.render();
    expect(proteinIdReads).toBe(plotData.length * 3);
  });

  it('releases a cleared view on inactive replacement without building the next index', () => {
    let proteinIdReads = 0;
    const observeReads = (ids: readonly string[]) =>
      new Proxy(ids, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) proteinIdReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
    let currentPlotData: PlotData = {
      ...plotData,
      proteinIds: observeReads(plotData.proteinIds),
    };
    controller = new ConnectorOverlayController({
      getOverlayGroup: () => overlay,
      getPlotData: () => currentPlotData,
      getScales: () => scales,
      onStatusChange: (next) => {
        status = next;
      },
    });
    const request = {
      pairs: [{ sourceProteinId: 'source', targetProteinId: 'target', confidence: 0.8 }],
      totalCandidates: 1,
    };
    const cache = controller as unknown as {
      indexedPlotData: PlotData | null;
      idToSlot: Map<string, number>;
    };

    controller.set(request);
    expect(proteinIdReads).toBe(3);
    controller.clear();
    controller.render();
    expect(cache.indexedPlotData).toBe(currentPlotData);
    expect(cache.idToSlot.size).toBe(3);
    expect(proteinIdReads).toBe(3);

    currentPlotData = {
      length: 1,
      xs: new Float32Array([3]),
      ys: new Float32Array([6]),
      zs: null,
      originalIndices: null,
      proteinIds: observeReads(['source']),
    };
    controller.render();
    expect(cache.indexedPlotData).toBeNull();
    expect(cache.idToSlot.size).toBe(0);
    expect(proteinIdReads).toBe(3);

    controller.set(request);
    expect(cache.indexedPlotData).toBe(currentPlotData);
    expect([...cache.idToSlot.keys()]).toEqual(['source']);
    expect(proteinIdReads).toBe(4);
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
