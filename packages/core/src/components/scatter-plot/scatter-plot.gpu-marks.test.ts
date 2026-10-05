/**
 * @vitest-environment jsdom
 *
 * The selection and highlight are drawn as GPU marks: a change of either
 * re-stages nothing, the live view stages every point unmarked, and an export
 * still stages the selection. Focus, and opacities the marks cannot draw as
 * staging does, keep the selection staged.
 *
 * The element is never appended (no Lit lifecycle, no WebGL): `updated()` is
 * driven with an explicit changed-properties map, and the renderer is a stub.
 */
import { vi, describe, it, expect } from 'vitest';
import type { PlotData, PlotDataPoint, VisualizationData } from '@protspace/utils';
import type { WebGLStyleGetters } from './webgl/types';
import { createPassScratch } from './webgl/renderer/pass-staging';

const constructed = vi.hoisted(() => [] as unknown[][]);

vi.mock('./webgl/color-utils', () => ({
  resolveColor: (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
}));

vi.mock('./webgl', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  WebGLRenderer: class {
    constructor(...args: unknown[]) {
      constructed.push(args);
    }
    setStyleSignature() {}
    setSelectionActive() {}
    prewarm() {}
  },
}));

import { createPlot, type PlotInternals } from './test-support/plot-fixture';

/** The plot, with the stub renderer `makeEl` gives it. */
type Plot = Omit<PlotInternals, '_webglRenderer'> & {
  _webglRenderer: Record<string, ReturnType<typeof vi.fn>> | null;
};

const IDS = ['p0', 'p1', 'p2', 'p3', 'p4'];

function makeData(): VisualizationData {
  const fams = ['A', 'B', 'A', 'B', 'A'];
  return {
    protein_ids: IDS,
    projections: [
      { name: 'umap', data: Float32Array.from(IDS.flatMap((_, i) => [i, i])), dimension: 2 },
    ],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#ff0000', '#00ff00'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: Int32Array.from(fams, (f) => (f === 'A' ? 0 : 1)) },
  } as unknown as VisualizationData;
}

function changed(...keys: string[]): Map<string, unknown> {
  return new Map(keys.map((k) => [k, undefined]));
}

function makeEl(): Plot {
  const el = createPlot({ data: makeData(), selectedAnnotation: 'fam' }) as unknown as Plot;
  el._processData();
  el._webglRenderer = {
    invalidateStyleCache: vi.fn(),
    setSelectionActive: vi.fn(),
    setStyleSignature: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    releaseDataReferences: vi.fn(),
  };
  return el;
}

/** `el` with the marks of a selection built, and the getters staged under them. */
function makeMarkedEl(): Plot {
  const el = makeEl();
  select(el, ['p1']);
  el._getPointMarks(el._plotData);
  el._getStageGetters();
  expect(el._pointMarks).not.toBeNull();
  expect(el._unmarkedGetters).not.toBeNull();
  return el;
}

/** Select `ids` as the control bar does, and run the update it triggers. */
function select(el: Plot, ids: string[]) {
  el.selectedProteinIds = ids;
  el.updated(changed('selectedProteinIds'));
}

/** The live and export style getters `el` would hand a renderer it built now. */
function rendererStyles(el: Plot) {
  const stub = el._webglRenderer;
  Object.defineProperty(el, '_canvas', { value: document.createElement('canvas') });
  el._createWebglRenderer();
  el._webglRenderer = stub;
  const args = constructed.at(-1)!;
  return { live: args[4] as WebGLStyleGetters, exported: args[8] as WebGLStyleGetters };
}

const point = (i: number): PlotDataPoint => ({ id: IDS[i], x: i, y: i, originalIndex: i });

/** The opacity a staging pass through `style` resolves for every slot of `pd`. */
function stagedOpacities(style: WebGLStyleGetters, pd: PlotData): number[] {
  const scratch = createPassScratch(pd.length);
  style.createStylePass!().resolve(pd, pd.length, scratch);
  return Array.from(scratch.opacity);
}

describe('selection drawn as GPU marks', () => {
  it('re-stages nothing for a selection or highlight change', () => {
    const el = makeEl();
    select(el, ['p1']);
    el.highlightedProteinIds = ['p3'];
    el.updated(changed('highlightedProteinIds'));
    select(el, []);
    expect(el._webglRenderer!.invalidateStyleCache).not.toHaveBeenCalled();
    expect(el._webglRenderer!.setSelectionActive).toHaveBeenLastCalledWith(true);
  });

  it('marks the selected and highlighted slots, at the selected and faded opacities', () => {
    const el = makeEl();
    select(el, ['p1', 'p4']);
    el.highlightedProteinIds = ['p2'];
    const marks = el._getPointMarks(el._plotData)!;
    expect(Array.from(marks.slots)).toEqual([0, 1, 1, 0, 1]);
    expect(marks).toMatchObject({ marked: 1, unmarked: 0.15 });
    // A highlight alone leaves the rest at base opacity.
    select(el, []);
    expect(el._getPointMarks(el._plotData)).toMatchObject({ marked: 1, unmarked: 0.9 });
    el.highlightedProteinIds = [];
    expect(el._getPointMarks(el._plotData)).toBeNull();
  });

  it('builds the marks once per selection', () => {
    const el = makeEl();
    select(el, ['p1']);
    const marks = el._getPointMarks(el._plotData);
    expect(el._getPointMarks(el._plotData)).toBe(marks);
    select(el, ['p1']);
    expect(el._getPointMarks(el._plotData)).not.toBe(marks);
  });

  it('stages the live view unmarked, and an export with the selection', () => {
    const el = makeEl();
    select(el, ['p1']);
    const { live, exported } = rendererStyles(el);
    expect(live.getOpacity(point(0))).toBe(0.9);
    expect(live.getOpacity(point(1))).toBe(0.9);
    expect(exported.getOpacity(point(0))).toBe(0.15);
    expect(exported.getOpacity(point(1))).toBe(1);
    expect(live.getDepth(point(1))).toBe(live.getDepth(point(3)));
    expect(exported.getDepth(point(1))).toBeLessThan(exported.getDepth(point(3)));
    expect(stagedOpacities(live, el._plotData)).toEqual([0.9, 0.9, 0.9, 0.9, 0.9]);
    expect(stagedOpacities(exported, el._plotData)).toEqual([0.15, 1, 0.15, 0.15, 0.15]);
    expect(live.getPointMarks!(el._plotData)!.slots).toEqual(Uint8Array.of(0, 1, 0, 0, 0));
    expect(exported.getPointMarks).toBeUndefined();
  });

  it('lets go of the marks and their getters with the dataset', () => {
    for (const next of [makeData(), null]) {
      const el = makeMarkedEl();
      el.data = next;
      el._processData();
      expect(el._pointMarks).toBeNull();
      expect(el._unmarkedGetters).toBeNull();
    }
  });

  it('lets go of them once nothing is marked, or the marks are staged', () => {
    const el = makeMarkedEl();
    select(el, []);
    expect(el._getPointMarks(el._plotData)).toBeNull();
    expect(el._pointMarks).toBeNull();
    el._focusedValues = ['A'];
    el._getStageGetters();
    expect(el._unmarkedGetters).toBeNull();
  });
});

describe('selection staged on the CPU', () => {
  it('while focus fades by category, and when focus comes or goes', () => {
    const el = makeEl();
    el._focusedValues = ['A'];
    el.updated(changed('_focusedValues'));
    expect(el._webglRenderer!.invalidateStyleCache).toHaveBeenCalledTimes(1);
    el.highlightedProteinIds = ['p1'];
    el.updated(changed('highlightedProteinIds'));
    expect(el._webglRenderer!.invalidateStyleCache).toHaveBeenCalledTimes(2);
    expect(el._getPointMarks(el._plotData)).toBeNull();
    const { live } = rendererStyles(el);
    expect(live.getOpacity(point(1))).toBe(1);
    expect(live.getOpacity(point(3))).toBe(0.15);
    el._focusedValues = null;
    el.updated(changed('_focusedValues'));
    expect(el._webglRenderer!.invalidateStyleCache).toHaveBeenCalledTimes(3);
  });

  it('while the renderer cannot draw marks for the dataset', () => {
    const el = makeEl();
    Object.assign(el._webglRenderer!, { canDrawMarks: false });
    select(el, ['p1']);
    expect(el._webglRenderer!.invalidateStyleCache).toHaveBeenCalledTimes(1);
    expect(el._getPointMarks(el._plotData)).toBeNull();
    const { live } = rendererStyles(el);
    expect(stagedOpacities(live, el._plotData)).toEqual([0.15, 1, 0.15, 0.15, 0.15]);
  });

  it('with opacities the marks cannot draw as staging does', () => {
    for (const opacities of [{ fadedOpacity: 0 }, { selectedOpacity: 0.95 }, { baseOpacity: 1 }]) {
      const el = makeEl();
      el.config = opacities;
      el.updated(changed('config'));
      el._webglRenderer!.invalidateStyleCache.mockClear();
      select(el, ['p1']);
      expect(el._webglRenderer!.invalidateStyleCache).toHaveBeenCalledTimes(1);
      expect(el._getPointMarks(el._plotData)).toBeNull();
      const { live, exported } = rendererStyles(el);
      expect(live.getOpacity(point(0))).toBe(exported.getOpacity(point(0)));
    }
  });
});
