/**
 * @vitest-environment jsdom
 *
 * The numeric recompute body re-stages the whole plot (a style-cache invalidation and a render
 * request, ~500 ms at 573K). It must only do that when the materialized data it works from is not
 * the object the plot was last built from. Import hit the other case: the app publishes numeric
 * settings for annotations that are not selected, which re-staged an unchanged plot.
 *
 * The element is never appended, so Lit's lifecycle never runs; the renderer is a stub that
 * records the calls that would cost a re-stage.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NumericAnnotationDisplaySettings, VisualizationData } from '@protspace/utils';

import { createPlot, fakeFrames, type PlotInternals } from './test-support/plot-fixture';

const settings = (binCount: number): NumericAnnotationDisplaySettings => ({
  binCount,
  strategy: 'linear',
  paletteId: 'viridis',
  reverseGradient: false,
});

function makeData(): VisualizationData {
  const n = 6;
  const coords = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  }
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const scores = [0, 1, 2, 3, 4, 5];
  return {
    protein_ids: Array.from({ length: n }, (_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: ['A', 'B'],
        colors: ['#ff0000', '#00ff00'],
        shapes: ['circle', 'circle'],
      },
      score: {
        kind: 'numeric',
        values: [],
        colors: [],
        shapes: [],
        numericType: 'float',
        numericMetadata: {
          strategy: 'linear',
          binCount: 3,
          numericType: 'float',
          signature: 'sig',
          topologySignature: 'topo',
          logSupported: false,
          bins: [
            { id: 'b0', label: '0-2', lowerBound: 0, upperBound: 2, count: 2 },
            { id: 'b1', label: '2-4', lowerBound: 2, upperBound: 4, count: 2 },
            { id: 'b2', label: '4-6', lowerBound: 4, upperBound: 6, count: 2 },
          ],
        },
      },
    },
    annotation_data: {
      fam: families.map((v) => [v === 'A' ? 0 : 1]),
      score: scores.map(() => [0]),
    },
    numeric_annotation_data: { score: Float64Array.from(scores) },
  } as unknown as VisualizationData;
}

describe('numeric recompute: re-stage only when the materialized data changed', () => {
  let sp: PlotInternals;
  let renderer: { invalidateStyleCache: ReturnType<typeof vi.fn>; setStyleSignature: () => void };
  let requestRender: ReturnType<typeof vi.fn>;
  let dataChanges: number;

  const build = (selected: string, initial: Record<string, NumericAnnotationDisplaySettings>) => {
    sp = createPlot({
      data: makeData(),
      selectedAnnotation: selected,
      numericAnnotationSettings: initial,
    });
    sp._processData(); // the plot as the first render left it
    renderer = { invalidateStyleCache: vi.fn(), setStyleSignature: () => {} };
    sp._webglRenderer = renderer as never;
    requestRender = vi.fn();
    sp._requestRender = requestRender;
    dataChanges = 0;
    sp.addEventListener('data-change', () => dataChanges++);
  };

  beforeEach(() => {
    // The point index rebuild is deferred to a frame; it is not under test.
    fakeFrames();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("skips the re-stage when only another annotation's settings changed", () => {
    build('fam', {});
    const plotData = sp._plotData;

    sp.numericAnnotationSettings = { score: settings(5) };
    sp._runNumericRecomputeBody();

    expect(renderer.invalidateStyleCache).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
    expect(sp._plotData).toBe(plotData);
  });

  it('skips the re-stage for an equal rebin of the selected annotation', () => {
    build('score', { score: settings(3) });

    sp.numericAnnotationSettings = { score: settings(3) }; // new objects, same content
    sp._runNumericRecomputeBody();

    expect(renderer.invalidateStyleCache).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('skips the re-stage when the first settings are the defaults the plot already used', () => {
    build('score', {});

    // What the legend publishes for a numeric annotation nobody has customised.
    sp.numericAnnotationSettings = {
      score: { binCount: 10, strategy: 'quantile', paletteId: 'batlow', reverseGradient: false },
    };
    sp._runNumericRecomputeBody();

    expect(renderer.invalidateStyleCache).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('re-stages when the selected annotation is rebinned', () => {
    build('score', { score: settings(3) });
    const plotData = sp._plotData;

    sp.numericAnnotationSettings = { score: settings(5) };
    sp._runNumericRecomputeBody();

    expect(renderer.invalidateStyleCache).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(sp._plotData).not.toBe(plotData);
  });

  it('re-stages when the first settings for the selected annotation change its bins', () => {
    build('score', {});

    sp.numericAnnotationSettings = { score: settings(5) };
    sp._runNumericRecomputeBody();

    expect(renderer.invalidateStyleCache).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('still announces data-change either way', () => {
    build('fam', {});
    sp.numericAnnotationSettings = { score: settings(5) };
    sp._runNumericRecomputeBody();
    expect(dataChanges).toBe(1);

    build('score', { score: settings(3) });
    sp.numericAnnotationSettings = { score: settings(5) };
    sp._runNumericRecomputeBody();
    expect(dataChanges).toBe(1);
  });

  describe('object identity of the materialized data', () => {
    // What the legend publishes for a numeric annotation nobody has customised.
    const defaults = (): NumericAnnotationDisplaySettings => ({
      binCount: 10,
      strategy: 'quantile',
      paletteId: 'batlow',
      reverseGradient: false,
    });

    it('stays the same object when settings that differ in content land on the same bins', () => {
      build('score', {});
      const before = sp._getMaterializedData();

      sp.numericAnnotationSettings = { score: defaults() };
      expect(sp._getMaterializedData()).toBe(before);
    });

    it('keeps the visibility model, so an equal copy does not redo its O(N) mask', () => {
      build('score', {});
      const model = sp._getVisibilityModel();

      sp.numericAnnotationSettings = { score: defaults() };
      sp._getMaterializedData();
      expect(sp._getVisibilityModel()).toBe(model);
    });

    it('becomes a new object when the bins change', () => {
      build('score', { score: settings(3) });
      const before = sp._getMaterializedData();

      sp.numericAnnotationSettings = { score: settings(5) };
      expect(sp._getMaterializedData()).not.toBe(before);
    });

    it('becomes a new object when the annotation changes, even if its definition would match', () => {
      build('fam', {});
      const before = sp._getMaterializedData();

      sp.selectedAnnotation = 'score';
      expect(sp._getMaterializedData()).not.toBe(before);
    });
  });
});
