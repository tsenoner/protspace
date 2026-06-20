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

type Internals = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  config: { enableDuplicateStackUI: boolean };
  _processData(): void;
  _buildQuadtree(): void;
  _ensureDuplicateStacksForViewport(k: string, a: number, b: number, c: number, d: number): boolean;
  _duplicateStacks: unknown[];
  _duplicateStacksCacheKey: string | null;
  _duplicateStacksComputeJobId: number;
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
  // The quadtree builds lazily on render (RAF-scheduled). Build it directly here so
  // _ensureDuplicateStacksForViewport's queryByPixels has a populated index to scan.
  // Called directly (not via _scheduleQuadtreeRebuild) so it doesn't enqueue into the
  // stubbed RAF queue installed by the test's beforeEach.
  sp._buildQuadtree();
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

  it('a superseded job (job id bumped before drain) does not commit its results', () => {
    const sp = prime();
    sp._ensureDuplicateStacksForViewport('view-1', -1000, -1000, 1000, 1000); // starts job, queues RAF
    sp._duplicateStacksComputeJobId++; // simulate a second viewport/cancel superseding it
    drain();
    expect(sp._duplicateStacksCacheKey).not.toBe('view-1'); // first job bailed → cache key not set
  });

  it('a repeat call with the same viewKey short-circuits (cache hit) without recompute', () => {
    const sp = prime();
    sp._ensureDuplicateStacksForViewport('view-1', -1000, -1000, 1000, 1000);
    drain(); // completes; cache key becomes 'view-1'
    expect(sp._duplicateStacksCacheKey).toBe('view-1');
    const before = sp._duplicateStacks;
    const hit = sp._ensureDuplicateStacksForViewport('view-1', -1000, -1000, 1000, 1000);
    expect(hit).toBe(true); // L1624 early-return
    expect(rafQueue).toHaveLength(0); // no new compute scheduled
    expect(sp._duplicateStacks).toBe(before); // results untouched
  });
});
