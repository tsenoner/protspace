// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';

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

// F-06 moved the chunked-compute state into DuplicateStackOverlayController.
// ensureForViewport, stacks and cacheKey are TS-private at compile time but
// reachable at runtime; the probes assert the SAME contracts (a cancelled job
// commits nothing, viewKey cache hit) without reading the job id itself.
type DupOverlay = {
  ensureForViewport(k: string, a: number, b: number, c: number, d: number): boolean;
  cancelCompute(): void;
  stacks: unknown[];
  cacheKey: string | null;
};

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  config: { enableDuplicateStackUI: boolean };
  _processData(): void;
  _pointGrid: { rebuildNow(): void };
  _dupOverlay: DupOverlay;
};

// Two pairs of EXACT-duplicate coordinates so a stack of >1 forms.
// Fixture shape mirrors the real VisualizationData used by the neighbour suites
// (scatter-plot.materialize-cache.test.ts): projections[].data Float32Array +
// annotations/annotation_data keyed by feature name.
function dupData(): VisualizationData {
  const families = ['A', 'A', 'B', 'B'];
  return {
    protein_ids: ['p0', 'p1', 'p2', 'p3'],
    // p0==p1 at (0,0), p2==p3 at (5,5)
    projections: [{ name: 'p', data: new Float32Array([0, 0, 0, 0, 5, 5, 5, 5]), dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map((v) => (v === 'A' ? '#f00' : '#0f0')),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
    numeric_annotation_data: {},
  } as unknown as VisualizationData;
}

function prime(): Internals {
  const sp = document.createElement('protspace-scatterplot') as Internals;
  sp.config = { enableDuplicateStackUI: true };
  sp.data = dupData();
  sp.selectedAnnotation = 'fam';
  sp._processData(); // builds _plotData
  // The point index builds lazily on render (RAF-scheduled). Build it directly here so
  // _ensureDuplicateStacksForViewport's queryByPixels has a populated index to scan.
  // Called directly (not via scheduleRebuild) so it doesn't enqueue into the
  // stubbed RAF queue installed by the test's beforeEach.
  sp._pointGrid.rebuildNow();
  return sp;
}

describe('duplicate-stack chunked compute (F-24 characterization lock)', () => {
  let rafQueue: FrameRequestCallback[];
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const drain = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb(0));
  };

  it('a job cancelled before its RAF drains commits nothing, and the next job still runs', () => {
    const sp = prime();
    sp._dupOverlay.ensureForViewport('view-1', -1000, -1000, 1000, 1000); // starts job, queues RAF
    sp._dupOverlay.cancelCompute(); // the only way production supersedes an in-flight job
    drain();
    expect(sp._dupOverlay.cacheKey).not.toBe('view-1'); // cancelled job bailed → cache key not set
    expect(sp._dupOverlay.stacks).toHaveLength(0);

    // cancelCompute also clears the in-flight flag; without that, every later
    // ensureForViewport would return early and the badges would freeze.
    sp._dupOverlay.ensureForViewport('view-2', -1000, -1000, 1000, 1000);
    drain();
    expect(sp._dupOverlay.cacheKey).toBe('view-2');
    expect(sp._dupOverlay.stacks).toHaveLength(2); // (0,0) and (5,5) pairs
  });

  it('a repeat call with the same viewKey short-circuits (cache hit) without recompute', () => {
    const sp = prime();
    sp._dupOverlay.ensureForViewport('view-1', -1000, -1000, 1000, 1000);
    drain(); // completes; cache key becomes 'view-1'
    expect(sp._dupOverlay.cacheKey).toBe('view-1');
    const before = sp._dupOverlay.stacks;
    const hit = sp._dupOverlay.ensureForViewport('view-1', -1000, -1000, 1000, 1000);
    expect(hit).toBe(true); // cache-key early-return
    expect(rafQueue).toHaveLength(0); // no new compute scheduled
    expect(sp._dupOverlay.stacks).toBe(before); // results untouched
  });
});
