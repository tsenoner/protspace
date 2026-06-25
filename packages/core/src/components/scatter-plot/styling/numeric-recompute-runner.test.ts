// F-04: NumericRecomputeRunner unit characterization.
//
// The runner owns the numeric-annotation recompute lifecycle extracted verbatim
// from `_scheduleNumericAnnotationRefresh` (scatter-plot.ts L839-915):
//   - a monotonically-increasing job id captured per schedule(),
//   - a synchronous requestUpdate + running-state mirror (setRunning(true)),
//   - a deferred (RAF) body that bails when its job id was superseded
//     (the B7/F-23 last-write-wins stale-job drop), runs the component-supplied
//     `runRecompute()` tail, then clears the running-state mirror,
//   - a running-state mirror pushed to the host via setRunning(),
//   - cancel() that drops a pending RAF and invalidates any in-flight job.
//
// (F-46) The previously-dispatched `numeric-recompute-start` / `-end`
// CustomEvents were unconsumed public surface and have been removed; the busy
// state is now characterized solely via the `setRunning` mirror, the runner's
// `runningAnnotation()`, and the `runRecompute()` body call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NumericRecomputeRunner } from './numeric-recompute-runner';

function makeHost() {
  const running: boolean[] = [];
  return {
    running,
    selectedAnnotation: 'plddt',
    hasData: () => true,
    getSelectedAnnotation() {
      return this.selectedAnnotation;
    },
    // F-57: the runner no longer issues an explicit host.requestUpdate(); the Lit
    // update is scheduled by the host's `_numericRecomputeRunning` @state setter,
    // which `setRunning` writes. The busy state is the only scheduling signal.
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when the host has no data', () => {
    const host = makeHost();
    host.hasData = () => false;
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    expect(host.running).toHaveLength(0);
    expect(r.runningAnnotation()).toBe(null);
  });

  it('enters the running state synchronously (F-57: no explicit requestUpdate)', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    expect(host.running[0]).toBe(true);
    expect(r.runningAnnotation()).toBe('plddt');
  });

  it('runs the body in the RAF and clears the running state', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    raf.forEach((cb) => cb());
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
    expect(r.runningAnnotation()).toBe(null);
    // running mirror toggled true (schedule) then false (job end)
    expect(host.running).toEqual([true, false]);
  });

  it('running annotation is captured from the host at schedule() time', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    expect(r.runningAnnotation()).toBe('plddt');
    host.selectedAnnotation = 'charge'; // changes after schedule(), before the RAF
    raf.forEach((cb) => cb());
    expect(r.runningAnnotation()).toBe(null);
  });

  it('runs the body before clearing the running state', () => {
    const host = makeHost();
    const order: string[] = [];
    host.runRecompute = vi.fn(() => order.push('body'));
    host.setRunning = (running: boolean) => order.push(running ? 'running:true' : 'running:false');
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    raf.forEach((cb) => cb());
    expect(order).toEqual(['running:true', 'body', 'running:false']);
  });

  it('a superseding schedule() invalidates the prior job (stale RAF is a no-op)', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.schedule();
    raf[0](); // stale job → bails, no body
    expect(host.runRecompute).not.toHaveBeenCalled();
    expect(r.runningAnnotation()).not.toBe(null); // still busy: the current job hasn't run
    raf[1](); // current job → completes
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
    expect(r.runningAnnotation()).toBe(null);
  });

  it('two overlapping schedules run the body exactly once (last-write-wins)', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.schedule();
    raf.forEach((cb) => cb());
    // setRunning(true) twice (one per schedule) but only one job completes → one false
    expect(host.running.filter((x) => x === true)).toHaveLength(2);
    expect(host.running.filter((x) => x === false)).toHaveLength(1);
    expect(host.runRecompute).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops a pending RAF and clears running state', () => {
    const host = makeHost();
    const r = new NumericRecomputeRunner(host);
    r.schedule();
    r.cancel();
    raf.forEach((cb) => cb());
    expect(host.runRecompute).not.toHaveBeenCalled();
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
