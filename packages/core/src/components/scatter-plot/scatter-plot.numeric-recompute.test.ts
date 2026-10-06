// @vitest-environment jsdom
//
// Characterization lock: the numeric-recompute stale-job generation guard.
//
// `_scheduleNumericAnnotationRefresh` delegates to the NumericRecomputeRunner,
// which bumps + captures a per-schedule job id, flips the `_numericRecomputeRunning`
// @state mirror to true synchronously, and queues the heavy recompute in a
// requestAnimationFrame. The RAF body bails immediately when its captured job id
// was superseded — so a superseded (older) job runs no body and does NOT clear
// the running state; only the surviving (latest) job's RAF clears it. This locks
// "last-write-wins" for two overlapping schedules.
//
// The runner's old public `numeric-recompute-start` / `-end` CustomEvents
// were unconsumed and have been removed; the stale-job guard is now characterized
// via the kept `_numericRecomputeRunning` busy-state mirror.
//
// We queue (do NOT run inline) RAFs via a stubbed requestAnimationFrame so the
// two overlapping schedules both register before either body executes, then
// drain them to exercise the drop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlot, makeFamilyData } from './test-support/plot-fixture';

/**
 * `score` is a numeric column selected as the active annotation; it is
 * intentionally absent from `annotations` (the production code reads
 * `annotations[selectedAnnotation]` with optional chaining, so this stays valid
 * and triggers the numeric path).
 */
const scorePlot = () =>
  createPlot({ data: makeFamilyData({ score: true }), selectedAnnotation: 'score' });

describe('numeric-recompute stale-job guard (characterization lock)', () => {
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
    const sp = scorePlot();

    sp._scheduleNumericAnnotationRefresh(); // job 1 → queues RAF #1
    sp._scheduleNumericAnnotationRefresh(); // job 2 → bumps id, queues RAF #2
    expect(sp._numericRecomputeRunning).toBe(true); // running, nothing drained yet

    drain(); // RAF#1 sees jobId mismatch → bails (no clear); RAF#2 completes → clears
    expect(sp._numericRecomputeRunning).toBe(false); // surviving job cleared the state
  });

  it('the superseded job does not clear the running state before the latest job runs', () => {
    const sp = scorePlot();

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
