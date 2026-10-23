import { describe, expect, it, vi } from 'vitest';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';

/** A measure with a fixed width per stage, as a bar whose items do not change. */
function measureOf(widths: readonly [number, number, number, number]) {
  return vi.fn((stage: ViewBarStage) => widths[stage]);
}

describe('resolveStage', () => {
  it('steps down until the bar fits', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>();

    expect(resolveStage(0, 750, measure, cache)).toBe(2);
    expect(measure.mock.calls.map(([stage]) => stage)).toEqual([0, 1, 2]);
    expect([...cache]).toEqual([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);
  });

  it('does not step up within the hysteresis', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);

    // Stage 1 needs 800 px: 810 px would hold it, but by less than the 24 px margin.
    expect(resolveStage(2, 810, measure, cache)).toBe(2);
    expect(measure).not.toHaveBeenCalled();
  });

  it('steps up once the next stage fits with margin', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);

    expect(resolveStage(2, 830, measure, cache)).toBe(1);
    expect(resolveStage(1, 924, measure, cache)).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });

  it('re-measures after the cache is cleared', () => {
    // Long labels: what the cache remembers keeps stage 2 at 1000 px.
    const cache = new Map<ViewBarStage, number>([
      [0, 1100],
      [1, 1050],
      [2, 700],
    ]);
    const measure = measureOf([800, 750, 700, 650]);
    expect(resolveStage(2, 1000, measure, cache)).toBe(2);
    expect(measure).not.toHaveBeenCalled();

    // The labels got shorter (a new dataset): the hook clears the cache, the stages are measured
    // again, and the bar steps back up.
    cache.clear();
    expect(resolveStage(2, 1000, measure, cache)).toBe(0);
    expect(measure.mock.calls.map(([stage]) => stage)).toEqual([2, 1, 0]);
  });

  it('never loops more than four times', () => {
    // A measure that contradicts itself (stage 0 overflows, then fits, then overflows) with a
    // cache that keeps nothing would flip between stages 0 and 1 for ever without the cap.
    let calls = 0;
    const measure = vi.fn(() => (calls++ % 3 === 0 ? 2000 : 0));
    const forgetful = new Map<ViewBarStage, number>();
    forgetful.set = () => forgetful;

    expect(resolveStage(0, 1000, measure, forgetful, 0)).toBe(0);
    // Four steps (down, up, down, up): a step down measures once, a step up twice.
    expect(measure).toHaveBeenCalledTimes(6);
  });
});
