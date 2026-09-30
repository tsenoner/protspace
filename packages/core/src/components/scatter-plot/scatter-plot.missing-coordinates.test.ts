// @vitest-environment jsdom
//
// A protein a projection does not cover has NaN coordinates and is not drawn. The cull
// lives in DataProcessor.processVisualizationData; this pins the one path that bypasses
// it, the in-place coordinate copy on a projection switch, which has to fall back to a
// rebuild when the new projection is missing a point. Driven through `_processData()`
// on a never-appended element (the scales-cache.test.ts pattern), so no WebGL runs.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PlotData, VisualizationData } from '@protspace/utils';
import type { ScalePair } from './webgl/types';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
import './scatter-plot';

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  selectedProjectionIndex: number;
  _plotData: PlotData;
  _processData(): void;
  _buildPointGridIndex(): void;
  _pointGridIndex: {
    queryByPixels(minX: number, minY: number, maxX: number, maxY: number): number[];
    queryByPolygon(vertices: ReadonlyArray<[number, number]>): number[];
  };
  readonly _scales: ScalePair | null;
  getProteinClientPosition(proteinId: string): { x: number; y: number } | null;
  selectedProteinIds: string[];
  isolateSelection(): void;
  getIsolationHistory(): string[][];
  getCurrentData(): VisualizationData | null;
};

// `complete` places every protein; `gappy` does not cover p1. Every coordinate is far
// from the origin, so a missing point drawn at (0, 0) would stretch the domain.
function data(): VisualizationData {
  const families = ['A', 'A', 'B'];
  return {
    protein_ids: ['p0', 'p1', 'p2'],
    projections: [
      { name: 'complete', data: new Float32Array([10, 10, 20, 20, 30, 30]), dimension: 2 },
      { name: 'gappy', data: new Float32Array([40, 40, NaN, NaN, 60, 60]), dimension: 2 },
    ],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#f00', '#0f0'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: families.map((v) => [v === 'A' ? 0 : 1]) },
  } as unknown as VisualizationData;
}

const plottedIds = (pd: PlotData) =>
  Array.from({ length: pd.length }, (_, slot) =>
    pd.originalIndices ? pd.proteinIds[pd.originalIndices[slot]] : pd.proteinIds[slot],
  );

function scatter(): Internals {
  const sp = document.createElement('protspace-scatterplot') as Internals;
  sp.data = data();
  sp.selectedAnnotation = 'fam';
  sp.selectedProjectionIndex = 0;
  sp._processData();
  return sp;
}

describe('scatter plot: missing coordinates', () => {
  it('drops the missing point on a switch to a projection that does not cover it', () => {
    const sp = scatter();
    expect(plottedIds(sp._plotData)).toEqual(['p0', 'p1', 'p2']);

    sp.selectedProjectionIndex = 1;
    sp._processData();

    expect(plottedIds(sp._plotData)).toEqual(['p0', 'p2']);
    expect(Array.from(sp._plotData.xs)).toEqual([40, 60]);
    expect(Array.from(sp._plotData.ys)).toEqual([40, 60]);
    expect(sp.getProteinClientPosition('p1')).toBeNull();
  });

  it('never indexes the missing point for hover, click, brush or lasso', () => {
    const sp = scatter();
    sp.selectedProjectionIndex = 1;
    sp._processData();
    sp._buildPointGridIndex();

    const idsOf = (slots: number[]) => slots.map((slot) => plottedIds(sp._plotData)[slot]).sort();
    const far = 1e9;
    expect(idsOf(sp._pointGridIndex.queryByPixels(-far, -far, far, far))).toEqual(['p0', 'p2']);
    expect(
      idsOf(
        sp._pointGridIndex.queryByPolygon([
          [-far, -far],
          [far, -far],
          [far, far],
          [-far, far],
        ]),
      ),
    ).toEqual(['p0', 'p2']);
  });

  it('computes the scale domains from the placed points only', () => {
    const sp = scatter();
    sp.selectedProjectionIndex = 1;
    sp._processData();

    const [xMin, xMax] = sp._scales!.x.domain();
    const [yMin, yMax] = sp._scales!.y.domain();
    expect(xMin).toBeGreaterThan(30);
    expect(yMin).toBeGreaterThan(30);
    expect(xMax).toBeLessThan(70);
    expect(yMax).toBeLessThan(70);
  });

  it('brings the point back, at its own coordinates, on the way back', () => {
    const sp = scatter();
    sp.selectedProjectionIndex = 1;
    sp._processData();
    sp.selectedProjectionIndex = 0;
    sp._processData();

    expect(plottedIds(sp._plotData)).toEqual(['p0', 'p1', 'p2']);
    expect(Array.from(sp._plotData.xs)).toEqual([10, 20, 30]);
    expect(sp._plotData.originalIndices).toBeNull();
  });

  it('still takes the in-place path between two complete projections', () => {
    const sp = scatter();
    sp.data.projections[1].data.set([40, 40, 50, 50, 60, 60]);
    const { xs } = sp._plotData;

    sp.selectedProjectionIndex = 1;
    sp._processData();

    expect(sp._plotData.xs).toBe(xs);
    expect(Array.from(xs)).toEqual([40, 50, 60]);
  });

  // Isolation is membership in the isolated set; the NaN cull only decides what is
  // drawn. The current data (the .parquetbundle export, the legend counts) and a new
  // isolation layer must not lose a protein the selected projection merely does not place.
  describe('in isolation mode', () => {
    const isolate = (sp: Internals, ids: string[]) => {
      sp.selectedProteinIds = ids;
      sp.isolateSelection();
    };
    const switchTo = (sp: Internals, index: number) => {
      sp.selectedProjectionIndex = index;
      sp._processData();
    };

    it('keeps an isolated protein the projection does not place in the current data', () => {
      const sp = scatter();
      isolate(sp, ['p0', 'p1']);
      switchTo(sp, 1);

      expect(plottedIds(sp._plotData)).toEqual(['p0']);
      const current = sp.getCurrentData()!;
      expect(current.protein_ids).toEqual(['p0', 'p1']);
      expect(current.annotation_data.fam).toEqual([[0], [0]]);
      expect(Array.from(current.projections[0].data)).toEqual([10, 10, 20, 20]);
    });

    it('keeps the isolated subset, not the whole dataset, when none of it is placed', () => {
      const sp = scatter();
      isolate(sp, ['p1']);
      switchTo(sp, 1);

      expect(sp._plotData.length).toBe(0);
      expect(sp.getCurrentData()!.protein_ids).toEqual(['p1']);
    });

    it('isolates a selected protein the current projection does not place', () => {
      const sp = scatter();
      sp.selectedProteinIds = ['p0', 'p1'];
      switchTo(sp, 1);
      sp.isolateSelection();

      expect(sp.getIsolationHistory()).toEqual([['p0', 'p1']]);
      switchTo(sp, 0);
      expect(plottedIds(sp._plotData)).toEqual(['p0', 'p1']);
    });
  });
});
