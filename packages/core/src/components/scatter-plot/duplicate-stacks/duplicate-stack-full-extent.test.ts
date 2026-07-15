import { describe, it, expect } from 'vitest';
import { computeFullExtentDuplicateStacks } from './duplicate-stack-full-extent';
import type { FullExtentDuplicateStack } from './duplicate-stack-full-extent';
import { buildDuplicateStacks, getDuplicateStackKey } from './duplicate-stack-helpers';
import { materializePlotDataPoint } from '@protspace/utils';
import type { PlotData } from '@protspace/utils';

function makePD(xs: number[], ys: number[], ids?: string[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: ids ?? xs.map((_, i) => `p${i}`),
  };
}

const allSlots = (pd: PlotData) => Array.from({ length: pd.length }, (_, i) => i);

// Stack A = slots 0-1 at (0,0); B = slots 2-4 at (50,50); C = slots 5-6 at
// (90,90); slots 7-9 are solos.
function tenPointPD(): PlotData {
  return makePD([0, 0, 50, 50, 50, 90, 90, 20, 30, 40], [0, 0, 50, 50, 50, 90, 90, 70, 80, 85]);
}

describe('computeFullExtentDuplicateStacks (#301)', () => {
  it('groups duplicate coords into stacks across the full extent and drops solos', () => {
    const pd = tenPointPD();
    const stacks: FullExtentDuplicateStack[] = computeFullExtentDuplicateStacks(pd, allSlots(pd));
    const byKey = new Map(stacks.map((s) => [s.key, s]));
    expect(stacks).toHaveLength(3);
    expect(byKey.get('0|0')!.points).toHaveLength(2);
    expect(byKey.get('50|50')!.points).toHaveLength(3);
    expect(byKey.get('90|90')!.points).toHaveLength(2);
    // Data-space coords are carried; px/py deliberately absent (projection
    // happens per-capture through the EXPORT scales, Part B).
    expect(byKey.get('50|50')!.x).toBe(50);
    expect(byKey.get('50|50')!.y).toBe(50);
    expect('px' in byKey.get('50|50')!).toBe(false);
  });

  it('members carry real materialized points (id/x/y/originalIndex)', () => {
    const pd = tenPointPD();
    const stacks = computeFullExtentDuplicateStacks(pd, allSlots(pd));
    const a = stacks.find((s) => s.key === '0|0')!;
    expect(a.points.map((p) => p.id).sort()).toEqual(['p0', 'p1']);
    expect(a.points[0]).toEqual(materializePlotDataPoint(pd, 0));
  });

  it('respects the visible-slot list (legend/filter hiding)', () => {
    const pd = tenPointPD();
    // Hide one member of B (slot 4) and all of C (slots 5-6): B shrinks to 2,
    // C disappears, A unaffected.
    const stacks = computeFullExtentDuplicateStacks(pd, [0, 1, 2, 3, 7, 8, 9]);
    expect(stacks.map((s) => s.key).sort()).toEqual(['0|0', '50|50']);
    expect(stacks.find((s) => s.key === '50|50')!.points).toHaveLength(2);
  });

  it('a stack reduced to one visible member becomes a solo and is dropped', () => {
    const pd = tenPointPD();
    const stacks = computeFullExtentDuplicateStacks(pd, [0, 2, 5, 6]); // A→1, B→1, C intact
    expect(stacks.map((s) => s.key)).toEqual(['90|90']);
  });

  it('skips non-finite coords (same rule as buildDuplicateStacks)', () => {
    const pd = makePD([1, 1, NaN, Infinity], [2, 2, 3, 3]);
    const stacks = computeFullExtentDuplicateStacks(pd, allSlots(pd));
    expect(stacks).toHaveLength(1);
    expect(stacks[0].key).toBe('1|2');
  });

  it('returns [] for empty data or an empty slot list', () => {
    expect(computeFullExtentDuplicateStacks(makePD([], []), [])).toEqual([]);
    expect(computeFullExtentDuplicateStacks(tenPointPD(), [])).toEqual([]);
  });

  it('never materializes solo slots — perf guard (no per-point id reads in pass 1)', () => {
    const pd = tenPointPD();
    let idReads = 0;
    const guardedIds = new Proxy(pd.proteinIds as string[], {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) idReads++;
        return Reflect.get(target, prop, receiver);
      },
    });
    const guardedPD: PlotData = { ...pd, proteinIds: guardedIds };
    computeFullExtentDuplicateStacks(guardedPD, allSlots(guardedPD));
    // Exactly one id read per DUPLICATE member (2+3+2), zero for the 3 solos —
    // materializePlotDataPoint is the only proteinIds reader in this module.
    expect(idReads).toBe(7);
  });
});

describe('grouping parity with the live `${x}|${y}` path', () => {
  it('groups a coord set identically to buildDuplicateStacks over materialized points (incl. −0/+0 and denormal Float32s)', () => {
    // −0 and +0 must share a stack (String(-0) === '0'); denormal and
    // Float32-rounded values must split/merge exactly as the string key does.
    const denormal = 1.401298464324817e-45; // smallest positive Float32 denormal
    const xs = [-0, 0, 1e-40, 1e-40, 0.1, 0.1, 0.3, 0.30000001192092896, denormal, denormal];
    const ys = [5, 5, 7, 7, 9, 9, 11, 11, 13, 13];
    const pd = makePD(xs, ys);

    const full = computeFullExtentDuplicateStacks(pd, allSlots(pd));

    const materialized = Array.from({ length: pd.length }, (_, i) =>
      materializePlotDataPoint(pd, i),
    );
    const { stacks: liveStacks } = buildDuplicateStacks(materialized);

    const summarize = (s: { key: string; points: { id: string }[] }) =>
      `${s.key}::${s.points
        .map((p) => p.id)
        .sort()
        .join(',')}`;
    expect(full.map(summarize).sort()).toEqual(liveStacks.map(summarize).sort());
    // −0/+0 grouped: the (±0, 5) pair formed ONE stack of 2.
    expect(full.find((s) => s.key === '0|5')!.points).toHaveLength(2);
    // Every full-extent key equals the canonical helper key for its coords.
    for (const s of full) {
      expect(s.key).toBe(getDuplicateStackKey({ x: s.x, y: s.y }));
    }
  });
});
