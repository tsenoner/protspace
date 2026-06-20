// F-04: NumericRecomputeRunner unit characterization.
//
// The runner owns the numeric-annotation recompute lifecycle extracted verbatim
// from `_scheduleNumericAnnotationRefresh` (scatter-plot.ts L839-915):
//   - a monotonically-increasing job id captured per schedule(),
//   - a synchronous `numeric-recompute-start` dispatch + requestUpdate,
//   - a deferred (RAF) body that bails when its job id was superseded
//     (the B7/F-23 last-write-wins stale-job drop), runs the component-supplied
//     `runRecompute()` tail, then dispatches `numeric-recompute-end` with a
//     durationMs measured from the captured start time,
//   - a running-state mirror pushed to the host via setRunning(),
//   - cancel() that drops a pending RAF and invalidates any in-flight job.
//
// The `numeric-recompute-end` annotation is re-read from the host at end time
// (matching production, which reads `this.selectedAnnotation` in the RAF body —
// not the value captured at schedule()).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumericRecomputeRunner } from './numeric-recompute-runner';

function makeHost() {
  const events: Array<{ type: string; detail: unknown }> = [];
  const running: boolean[] = [];
  return {
    events,
    running,
    selectedAnnotation: 'plddt',
    hasData: () => true,
    getSelectedAnnotation() {
      return this.selectedAnnotation;
    },
    dispatch: (type: string, detail: unknown) => events.push({ type, detail }),
    requestUpdate: vi.fn(),
    setRunning: (r: boolean) => running.push(r),
    runRecompute: vi.fn(),
  };
}

describe('NumericRecomputeRunner', () => {
  let raf: Array<() => void>;
  beforeEach(() => {
    raf = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      raf.push(cb);
      return raf.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      raf[id - 1] = () => {};
    });
    vi.stubGlobal('performance', { now: () => 1000 });
  });

  it('does nothing when the host has no data', () => {
    const host = makeHost();
    host.hasData = () => false;
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    expect(host.events).toHaveLength(0);
    expect(host.requestUpdate).not.toHaveBeenCalled();
    expect(r.isRunning()).toBe(false);
  });

  it('emits numeric-recompute-start synchronously and requests an update', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    expect(host.events[0].type).toBe('numeric-recompute-start');
    expect(host.events[0].detail).toEqual({ annotation: 'plddt' });
    expect(host.requestUpdate).toHaveBeenCalled();
    expect(host.running[0]).toBe(true);
    expect(r.isRunning()).toBe(true);
    expect(r.runningAnnotation()).toBe('plddt');
  });

  it('runs the body in the RAF and emits numeric-recompute-end with durationMs', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    raf.forEach((cb) => cb());
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
    const end = host.events.find((e) => e.type === 'numeric-recompute-end')!;
    expect(end).toBeDefined();
    expect((end.detail as { annotation: string }).annotation).toBe('plddt');
    expect(typeof (end.detail as { durationMs: number }).durationMs).toBe('number');
    expect(r.isRunning()).toBe(false);
    // running mirror toggled true (schedule) then false (job end)
    expect(host.running).toEqual([true, false]);
  });

  it('end-event annotation is re-read from the host at end time, not captured at schedule()', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    host.selectedAnnotation = 'charge'; // changes after schedule(), before the RAF
    raf.forEach((cb) => cb());
    const start = host.events.find((e) => e.type === 'numeric-recompute-start')!;
    const end = host.events.find((e) => e.type === 'numeric-recompute-end')!;
    expect((start.detail as { annotation: string }).annotation).toBe('plddt');
    expect((end.detail as { annotation: string }).annotation).toBe('charge');
  });

  it('runs the body before dispatching numeric-recompute-end', () => {
    const host = makeHost();
    const order: string[] = [];
    host.runRecompute = vi.fn(() => order.push('body'));
    host.dispatch = (type: string) => order.push(type);
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    raf.forEach((cb) => cb());
    expect(order).toEqual(['numeric-recompute-start', 'body', 'numeric-recompute-end']);
  });

  it('a superseding schedule() invalidates the prior job (stale RAF is a no-op)', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.schedule();
    raf[0](); // stale job → bails, no body, no end
    expect(host.runRecompute).not.toHaveBeenCalled();
    expect(host.events.filter((e) => e.type === 'numeric-recompute-end')).toHaveLength(0);
    raf[1](); // current job → completes
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
    expect(host.events.filter((e) => e.type === 'numeric-recompute-end')).toHaveLength(1);
  });

  it('two overlapping schedules emit two starts but exactly one end (last-write-wins)', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.schedule();
    raf.forEach((cb) => cb());
    expect(host.events.filter((e) => e.type === 'numeric-recompute-start')).toHaveLength(2);
    expect(host.events.filter((e) => e.type === 'numeric-recompute-end')).toHaveLength(1);
  });

  it('cancel() stops a pending RAF and clears running state', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.cancel();
    raf.forEach((cb) => cb());
    expect(host.runRecompute).not.toHaveBeenCalled();
    expect(r.isRunning()).toBe(false);
    expect(r.runningAnnotation()).toBe(null);
    expect(host.running).toEqual([true, false]); // schedule set true, cancel set false
  });

  it('cancel() invalidates an in-flight job whose RAF already fired its handle clear', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.cancel();
    r.schedule(); // a fresh job after cancel still works
    raf[1](); // first job's RAF was cancelled; run the second
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
  });
});
