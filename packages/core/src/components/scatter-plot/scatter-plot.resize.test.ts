/**
 * @vitest-environment jsdom
 *
 * A resize used to re-stage every point (style getters plus depth sort, ~500 ms
 * at 573K) on every ResizeObserver step. Now the renderer re-maps the staged
 * positions through a uniform, so a step redraws what is already on the GPU. The
 * point grid is still rebuilt on the next frame (~30 ms at 573K).
 *
 * As in scatter-plot.render-coalescing.test.ts, the element stays unattached, a
 * real WebGLRenderer on the mock WebGL2 canvas is attached by hand, and the perf
 * counters count the re-stages; the last test attaches one to run Lit's update cycle.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type * as PerfCounters from '../../utils/perf-counters';

vi.mock('../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { createPerfCounters, perfCounters } from '../../utils/perf-counters';
import { createPlot, fakeFrames, mountPlot } from './test-support/plot-fixture';

const counters = perfCounters!;

const XS = [1, 4, 6, 9];
const YS = [2, 8, 3, 7];

function makeData(xs = XS): VisualizationData {
  const coords = new Float32Array(xs.flatMap((x, i) => [x, YS[i]]));
  return {
    protein_ids: xs.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', dimension: 2, data: coords }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#f00'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(xs.length) },
  } as unknown as VisualizationData;
}

let frames: ReturnType<typeof fakeFrames>;

function sizeTo(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
}

/** An unattached 800x600 plot with data, a staged render and a built point index. */
function makePlot() {
  const el = mountPlot({ data: makeData(), selectedAnnotation: 'fam' });
  sizeTo(el, 800, 600);
  el._updateSizeAndRender();
  el._pointGrid.rebuildNow();
  frames.run();
  Object.assign(counters, createPerfCounters());
  const rebuild = vi.spyOn(el._pointGrid, 'rebuildNow');
  return { el, rebuild };
}

beforeEach(() => {
  frames = fakeFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scatter-plot resize', () => {
  it('redraws on the spot without re-staging', () => {
    const { el, rebuild } = makePlot();
    const render = vi.spyOn(el, '_renderPlot');

    for (const [w, h] of [
      [1200, 700],
      [640, 900],
      [1440, 900],
    ]) {
      sizeTo(el, w, h);
      el._updateSizeAndRender();
      frames.run();
    }

    expect(render).toHaveBeenCalledTimes(3);
    expect(counters.restage).toBe(0);
    expect(rebuild).toHaveBeenCalledTimes(3);
  });

  it('picks each point at its new position once the index is rebuilt', () => {
    const { el } = makePlot();
    const before = el._scales!;
    sizeTo(el, 1440, 500);
    el._updateSizeAndRender();
    frames.run();
    const after = el._scales!;

    XS.forEach((x, i) => {
      expect(el.pickInteractivePointAt(after.x(x), after.y(YS[i]))?.id).toBe(`p${i}`);
    });
    // The old positions are empty now: p1 moved from (290, 136) to (542, 100).
    expect(el.pickInteractivePointAt(before.x(XS[1]), before.y(YS[1]))).toBeNull();
  });

  it('resets the duplicate overlay on the next frame', () => {
    const { el } = makePlot();
    const reset = vi.spyOn(el._dupOverlay, 'resetState');
    sizeTo(el, 1000, 700);
    el._updateSizeAndRender();
    expect(reset).not.toHaveBeenCalled();
    frames.run();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a rebuild that new data already asked for', () => {
    const { el, rebuild } = makePlot();
    el.data = makeData([0, 3, 5, 20]);
    el._processData();
    // What updated() schedules for a geometry change.
    el._pointGrid.scheduleRebuild();
    sizeTo(el, 1000, 700);
    el._updateSizeAndRender();
    frames.run();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(el.pickInteractivePointAt(el._scales!.x(20), el._scales!.y(YS[3]))?.id).toBe('p3');
  });

  it('draws once per step: the update the new size triggers does not draw again', async () => {
    const el = createPlot();
    document.body.appendChild(el);
    el.data = makeData();
    el.selectedAnnotation = 'fam';
    await el.updateComplete;
    frames.run();
    await el.updateComplete;
    frames.run();

    const render = vi.spyOn(el, '_renderPlot');
    sizeTo(el, 1000, 700);
    el._updateSizeAndRender();
    await el.updateComplete;
    frames.run();
    expect(render).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
