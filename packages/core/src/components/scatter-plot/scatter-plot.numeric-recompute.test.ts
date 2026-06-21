// @vitest-environment jsdom
//
// F-23 characterization lock: the numeric-recompute stale-job generation guard.
//
// `_scheduleNumericAnnotationRefresh` delegates to the NumericRecomputeRunner,
// which bumps + captures a per-schedule job id, flips the `_numericRecomputeRunning`
// @state mirror to true synchronously, and queues the heavy recompute in a
// requestAnimationFrame. The RAF body bails immediately when its captured job id
// was superseded — so a superseded (older) job runs no body and does NOT clear
// the running state; only the surviving (latest) job's RAF clears it. This locks
// "last-write-wins" for two overlapping schedules.
//
// (F-46) The runner's old public `numeric-recompute-start` / `-end` CustomEvents
// were unconsumed and have been removed; the stale-job guard is now characterized
// via the kept `_numericRecomputeRunning` busy-state mirror.
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
  _numericRecomputeRunning: boolean;
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

  it('only the latest of two overlapping schedules clears the running state', () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = numericData();
    sp.selectedAnnotation = 'score';

    sp._scheduleNumericAnnotationRefresh(); // job 1 → queues RAF #1
    sp._scheduleNumericAnnotationRefresh(); // job 2 → bumps id, queues RAF #2
    expect(sp._numericRecomputeRunning).toBe(true); // running, nothing drained yet

    drain(); // RAF#1 sees jobId mismatch → bails (no clear); RAF#2 completes → clears
    expect(sp._numericRecomputeRunning).toBe(false); // surviving job cleared the state
  });

  it('the superseded job does not clear the running state before the latest job runs', () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp.data = numericData();
    sp.selectedAnnotation = 'score';

    sp._scheduleNumericAnnotationRefresh(); // job 1 → queues RAF #1
    sp._scheduleNumericAnnotationRefresh(); // job 2 → bumps id, queues RAF #2
    expect(sp._numericRecomputeRunning).toBe(true); // each schedule enters running

    // Drain ONLY the superseded RAF #1: it must bail and leave running untouched.
    const stale = rafQueue.shift()!;
    stale(0);
    expect(sp._numericRecomputeRunning).toBe(true); // superseded job did not clear

    drain(); // latest job completes → clears
    expect(sp._numericRecomputeRunning).toBe(false);
  });
});
