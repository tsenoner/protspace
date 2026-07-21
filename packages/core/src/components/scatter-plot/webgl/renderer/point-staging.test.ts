import { describe, it, expect } from 'vitest';
import { buildPaintOrder, composePaintDepth } from './point-staging';

describe('composePaintDepth', () => {
  it('keeps selection contiguous while painting predicted markers last within each tier', () => {
    const unselectedObserved = composePaintDepth(0.2, 0.9, false);
    const unselectedPredicted = composePaintDepth(0.8, 0.3, true);
    const selectedObserved = composePaintDepth(0.8, 1, false);
    const selectedPredicted = composePaintDepth(0.8, 1, true);

    expect(unselectedObserved).toBeGreaterThan(unselectedPredicted);
    expect(unselectedPredicted).toBeGreaterThan(selectedObserved);
    expect(selectedObserved).toBeGreaterThan(selectedPredicted);
  });

  it('preserves base-depth ordering inside a semantic tier', () => {
    expect(composePaintDepth(0.8, 0.5, true)).toBeGreaterThan(composePaintDepth(0.2, 0.5, true));
  });
});

describe('buildPaintOrder', () => {
  it('orders slots far -> near (descending depth, ascending-index tie-break) in place', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.1, 0.9, 0.1]);
    const plan = buildPaintOrder(order, depths, 4, false, () => 1);
    // 0.9 (idx2) > 0.5 (idx0) > 0.1 (idx1, idx3 — ascending tiebreak)
    expect(Array.from(plan.order)).toEqual([2, 0, 1, 3]);
    expect(plan.order).toBe(order); // sorted in place, same instance returned
  });

  it('invokes the opacity callback exactly once per slot, in sorted draw order', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.1, 0.9, 0.1]); // sorted order -> [2,0,1,3]
    const calls: Array<[number, number]> = [];
    buildPaintOrder(order, depths, 4, false, (k, src) => {
      calls.push([k, src]);
      return 1;
    });
    // (sortedIndex k, srcSlot order[k]) for the whole staged set, in draw order
    expect(calls).toEqual([
      [0, 2],
      [1, 0],
      [2, 1],
      [3, 3],
    ]);
  });

  it('selectedStartIndex = first sorted slot with opacity >= 0.99 when a selection is active', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.1, 0.9, 0.1]); // sorted -> [2,0,1,3]
    const opacityByOriginalSlot = [1.0, 1.0, 0.3, 0.3]; // slots 0,1 selected; 2,3 faded
    const plan = buildPaintOrder(order, depths, 4, true, (_k, src) => opacityByOriginalSlot[src]);
    // draw order [2,0,1,3] -> opacities [0.3, 1.0, 1.0, 0.3]; first >= 0.99 is at k=1
    expect(plan.selectedStartIndex).toBe(1);
  });

  it('threshold is inclusive at 0.99 and excludes just below', () => {
    const depths = new Float32Array([0.2, 0.1]); // sorted -> [0,1]
    expect(
      buildPaintOrder(new Uint32Array(2), depths, 2, true, () => 0.99).selectedStartIndex,
    ).toBe(0);
    expect(
      buildPaintOrder(new Uint32Array(2), depths, 2, true, () => 0.98).selectedStartIndex,
    ).toBe(2);
  });

  it('selectedStartIndex = count when selection active but no slot qualifies (single blended pass)', () => {
    const order = new Uint32Array(3);
    const depths = new Float32Array([0.5, 0.2, 0.8]);
    const plan = buildPaintOrder(order, depths, 3, true, () => 0.5);
    expect(plan.selectedStartIndex).toBe(3);
  });

  it('selectedStartIndex = count when selection inactive, even with fully opaque points', () => {
    const order = new Uint32Array(3);
    const depths = new Float32Array([0.5, 0.2, 0.8]);
    const plan = buildPaintOrder(order, depths, 3, false, () => 1.0);
    expect(plan.selectedStartIndex).toBe(3);
  });

  it('count 0: no throw, callback never called, selectedStartIndex 0', () => {
    const order = new Uint32Array(4);
    const depths = new Float32Array([0.5, 0.3, 0.1, 0.8]);
    let called = 0;
    const plan = buildPaintOrder(order, depths, 0, true, () => {
      called++;
      return 1;
    });
    expect(called).toBe(0);
    expect(plan.selectedStartIndex).toBe(0);
  });

  it('count smaller than array length stages only order[0..count)', () => {
    const order = new Uint32Array(6);
    const depths = new Float32Array([0.3, 0.8, 0.1, 0.6, 0.9, 0.2]);
    const seen: number[] = [];
    const plan = buildPaintOrder(order, depths, 3, false, (_k, src) => {
      seen.push(src);
      return 1;
    });
    // depths[0..3) = [0.3, 0.8, 0.1] -> sorted [1, 0, 2]
    expect(Array.from(plan.order.subarray(0, 3))).toEqual([1, 0, 2]);
    expect(seen).toEqual([1, 0, 2]);
  });
});
