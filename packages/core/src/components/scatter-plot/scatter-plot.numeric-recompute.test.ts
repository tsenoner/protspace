// @vitest-environment jsdom
//
// F-23 characterization lock: the numeric-recompute stale-job generation guard.
//
// `_scheduleNumericAnnotationRefresh` (scatter-plot.ts L830-906) bumps
// `++this._numericRecomputeJobId`, captures it as `jobId`, dispatches a
// synchronous `numeric-recompute-start`, and queues the heavy recompute in a
// requestAnimationFrame. The RAF body bails immediately (L849) when
// `jobId !== this._numericRecomputeJobId` — so a superseded (older) job writes
// no values and dispatches no `numeric-recompute-end`. This locks "last-write-
// wins" for two overlapping schedules.
//
// We queue (do NOT run inline) RAFs via a stubbed requestAnimationFrame so the
// two overlapping schedules both register before either body executes, then
// drain them to exercise the drop.
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
  _scheduleNumericAnnotationRefresh(): void;
};

/**
 * Real VisualizationData fixture, mirroring makeFamilyData from
 * scatter-plot.materialize-cache.test.ts (the plan sketch's `features` /
 * `feature_data` / `metadata.dimensions` shape is not a real VisualizationData
 * and would make `_getMaterializedData` throw on the missing `annotations` map,
 * causing the RAF body to bail before reaching the end event). `score` is a
 * numeric column selected as the active annotation; it is intentionally absent
 * from `annotations` (the production code reads `annotations[selectedAnnotation]`
 * with optional chaining, so this stays valid and triggers the numeric path).
 */
function numericData(): VisualizationData {
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const colorFor = (v: string) => (v === 'A' ? '#ff0000' : '#00ff00');
  const coords = new Float32Array(families.length * 2);
  families.forEach((_, i) => {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  });
  return {
    protein_ids: families.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map(colorFor),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
    numeric_annotation_data: {
      score: families.map((_, i) => i),
    },
  } as unknown as VisualizationData;
}

describe('numeric-recompute stale-job guard (F-23 characterization lock)', () => {
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

  it('only the latest of two overlapping schedules dispatches numeric-recompute-end', () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = numericData();
    sp.selectedAnnotation = 'score';
    const ends: string[] = [];
    sp.addEventListener('numeric-recompute-end', () => ends.push('end'));

    sp._scheduleNumericAnnotationRefresh(); // job 1 → queues RAF #1
    sp._scheduleNumericAnnotationRefresh(); // job 2 → bumps id, queues RAF #2
    expect(ends).toHaveLength(0); // nothing ran yet (RAFs queued)

    drain(); // RAF#1 sees jobId mismatch → bails; RAF#2 completes
    expect(ends).toHaveLength(1); // exactly ONE end event from the surviving job
  });

  it('two starts emit two starts but the superseded job writes no end (last-write-wins)', () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = numericData();
    sp.selectedAnnotation = 'score';
    const starts: string[] = [];
    const ends: string[] = [];
    sp.addEventListener('numeric-recompute-start', () => starts.push('s'));
    sp.addEventListener('numeric-recompute-end', () => ends.push('e'));
    sp._scheduleNumericAnnotationRefresh();
    sp._scheduleNumericAnnotationRefresh();
    drain();
    expect(starts).toHaveLength(2); // each schedule emits a start synchronously
    expect(ends).toHaveLength(1); // only the latest job reaches the end
  });
});
