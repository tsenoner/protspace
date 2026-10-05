// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { makeRenderer, plotData, styleGetters } from './test-support/renderer-fixture';
import { internalsOf } from './test-support/renderer-internals';
import { restageStyles, stageInPaintOrder } from './pass-staging';
import type * as PassStaging from './pass-staging';
import { createPerfCounters, perfCounters } from '../../../../utils/perf-counters';
import type * as PerfCounters from '../../../../utils/perf-counters';

vi.mock('./pass-staging', async (importOriginal) => {
  const actual = await importOriginal<typeof PassStaging>();
  return {
    ...actual,
    stageInPaintOrder: vi.fn(actual.stageInPaintOrder),
    restageStyles: vi.fn(actual.restageStyles),
  };
});
vi.mock('../../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

const counters = perfCounters!;

/** What `populateBuffers` picks its branch from, each set the way the scatter plot sets it. */
const FLAGS = ['positions', 'styles', 'depthOrder', 'capacity', 'depths'] as const;
type Flag = (typeof FLAGS)[number];

/** A staging render re-sorts, or restyles in the staged order; there is no third branch. */
function expectedBranch(on: ReadonlySet<Flag>): 'resort' | 'restyle' | 'none' {
  if (on.has('positions') || on.has('depthOrder') || on.has('capacity') || on.has('depths')) {
    return 'resort';
  }
  return on.has('styles') ? 'restyle' : 'none';
}

const combinations = Array.from({ length: 1 << FLAGS.length }, (_, mask) => {
  const on = new Set(FLAGS.filter((_, i) => mask & (1 << i)));
  return [[...on].join('+') || 'nothing', on] as const;
});

describe('WebGLRenderer staging branch per flag combination', () => {
  it.each(combinations)('%s', (_name, on) => {
    let depth = 0;
    const { renderer } = makeRenderer({ style: { ...styleGetters(), getDepth: () => depth } });
    vi.spyOn(internalsOf(renderer), 'renderWithGammaCorrection').mockImplementation(() => {});
    renderer.render(plotData(4));

    if (on.has('positions')) renderer.invalidatePositionCache();
    if (on.has('styles')) renderer.invalidateStyleCache();
    if (on.has('depthOrder')) renderer.invalidateDepthOrder();
    // Moves every sampled depth, and with them the style signature.
    if (on.has('depths')) depth = 0.5;
    vi.mocked(stageInPaintOrder).mockClear();
    vi.mocked(restageStyles).mockClear();
    Object.assign(counters, createPerfCounters());
    // Past MIN_CAPACITY, so the capacity is planned afresh; the length moves the data signature.
    renderer.render(plotData(on.has('capacity') ? 2000 : 4));

    const branch = expectedBranch(on);
    expect(stageInPaintOrder).toHaveBeenCalledTimes(branch === 'resort' ? 1 : 0);
    expect(restageStyles).toHaveBeenCalledTimes(branch === 'restyle' ? 1 : 0);
    expect(counters.restage).toBe(branch === 'none' ? 0 : 1);
  });
});
