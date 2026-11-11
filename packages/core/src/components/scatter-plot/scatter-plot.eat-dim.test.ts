/**
 * @vitest-environment jsdom
 *
 * EAT Dim (`eatDim`): the predictions the reliability filter would drop draw faded, through the
 * same style getters the live view and the export stage. A dim change is one style re-stage: no
 * data processing, no point-grid rebuild.
 *
 * The element is never appended, so Lit's lifecycle never runs: `updated()` is driven with an
 * explicit changed-properties map, on a real WebGLRenderer over the mock WebGL2 canvas.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EatReliabilityState, PlotDataPoint, VisualizationData } from '@protspace/utils';
import type * as PerfCounters from '../../utils/perf-counters';

vi.mock('../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { createPerfCounters, perfCounters } from '../../utils/perf-counters';
import { fakeFrames, mountPlot } from './test-support/plot-fixture';

const counters = perfCounters!;
const resetCounters = () => Object.assign(counters, createPerfCounters());

const AT_LEAST_HALF: EatReliabilityState = { min: 0.5, max: 1 };

function makeData(): VisualizationData {
  return {
    protein_ids: ['p0', 'p1', 'p2', 'p3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]) }],
    annotations: {
      fam: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#f00', '#0f0'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { fam: new Int32Array([0, 1, -1, -1]) },
    annotation_predicted: {
      fam: [
        null,
        null,
        { value: 'A', confidence: 0.2, source: 'p0', sourceIndex: 0 },
        { value: 'B', confidence: 0.9, source: 'p1', sourceIndex: 1 },
      ],
    },
  } as unknown as VisualizationData;
}

const changed = (...keys: string[]) => new Map<string, unknown>(keys.map((k) => [k, undefined]));
const at = (id: string, originalIndex: number): PlotDataPoint => ({
  id,
  x: 0,
  y: 0,
  originalIndex,
});

let frames: ReturnType<typeof fakeFrames>;

beforeEach(() => {
  frames = fakeFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EAT Dim', () => {
  it('a weak prediction draws at 25 % and stays interactive; a kept one is untouched', () => {
    const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
    el.eatDim = AT_LEAST_HALF;
    el.updated(changed('eatDim'));
    const model = el._style.model();
    expect(model.opacityOf(at('p2', 2))).toBe(0.25);
    expect(model.isInteractive(at('p2', 2))).toBe(true);
    expect(model.opacityOf(at('p3', 3))).toBe(0.9);
    expect(model.opacityOf(at('p0', 0))).toBe(0.9);
    // The export stages the same getters' opacity.
    expect(el._style.exportGetters().getOpacity(at('p2', 2))).toBe(0.25);
  });

  it('one dim change costs one style re-stage, no processing and no grid rebuild', () => {
    const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
    resetCounters();
    el.eatDim = AT_LEAST_HALF;
    el.updated(changed('eatDim'));
    frames.run();
    expect(counters.restageStyle).toBe(1);
    expect(counters.restagePos).toBe(0);
    expect(counters.processData).toBe(0);
    expect(counters.gridRebuild).toBe(0);
  });

  it('null dims nothing and builds no mask; Show off dims nothing', () => {
    const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
    expect(el._style.model().opacityOf(at('p2', 2))).toBe(0.9);
    el.eatOverlayEnabled = false;
    el.eatDim = AT_LEAST_HALF;
    el.updated(changed('eatDim', 'eatOverlayEnabled'));
    // No predictions on screen: no dim mask, so the selection marks stay on the GPU.
    expect(el._style.marksOnGpu()).toBe(true);
  });

  it('a selection under Dim is staged, not drawn as GPU marks', () => {
    const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
    expect(el._style.marksOnGpu()).toBe(true);
    el.eatDim = AT_LEAST_HALF;
    el.updated(changed('eatDim'));
    el.selectedProteinIds = ['p2'];
    el.updated(changed('selectedProteinIds'));
    expect(el._style.marksOnGpu()).toBe(false);
    expect(el._style.pointMarks(el._plotData)).toBeNull();
    expect(el._style.stageModel().opacityOf(at('p2', 2))).toBe(0.25);
  });
});
