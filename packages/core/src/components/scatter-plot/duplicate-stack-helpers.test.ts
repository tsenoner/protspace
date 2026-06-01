import { describe, it, expect } from 'vitest';
import {
  buildDuplicateStacks,
  getDuplicateStackKey,
  type DuplicateStackPoint,
} from './duplicate-stack-helpers';

const point = (id: string, x: number, y: number): DuplicateStackPoint => ({ id, x, y });

describe('getDuplicateStackKey', () => {
  it('produces the same key for identical coords', () => {
    expect(getDuplicateStackKey({ x: 1.5, y: 2.5 })).toBe(getDuplicateStackKey({ x: 1.5, y: 2.5 }));
  });

  it('produces different keys when either coord differs', () => {
    const base = getDuplicateStackKey({ x: 1, y: 1 });
    expect(getDuplicateStackKey({ x: 1, y: 2 })).not.toBe(base);
    expect(getDuplicateStackKey({ x: 2, y: 1 })).not.toBe(base);
  });

  it('treats integer vs float representations as equal when numerically equal', () => {
    expect(getDuplicateStackKey({ x: 1, y: 2 })).toBe(getDuplicateStackKey({ x: 1.0, y: 2.0 }));
  });
});

describe('buildDuplicateStacks', () => {
  it('returns empty result for empty input', () => {
    const result = buildDuplicateStacks([]);
    expect(result.stacks).toEqual([]);
    expect(result.byKey.size).toBe(0);
    expect(result.idToKey.size).toBe(0);
  });

  it('drops solo groups (single-point keys)', () => {
    const result = buildDuplicateStacks([point('a', 0, 0), point('b', 1, 1), point('c', 2, 2)]);
    expect(result.stacks).toEqual([]);
    expect(result.byKey.size).toBe(0);
    // idToKey still records every point's key so callers can detect "I'm a solo".
    expect(result.idToKey.size).toBe(3);
  });

  it('groups two points sharing exact coords into a single stack', () => {
    const result = buildDuplicateStacks([point('a', 1, 1), point('b', 1, 1), point('c', 9, 9)]);
    expect(result.stacks).toHaveLength(1);
    expect(result.stacks[0].points.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(result.byKey.get(getDuplicateStackKey({ x: 1, y: 1 }))?.points).toHaveLength(2);
  });

  it('handles multiple independent groups', () => {
    const result = buildDuplicateStacks([
      point('a', 0, 0),
      point('b', 0, 0),
      point('c', 0, 0),
      point('d', 5, 5),
      point('e', 5, 5),
      point('f', 9, 9),
    ]);
    expect(result.stacks).toHaveLength(2);
    const sizes = result.stacks.map((s) => s.points.length).sort();
    expect(sizes).toEqual([2, 3]);
  });

  it('ignores points with non-finite coords', () => {
    const result = buildDuplicateStacks([
      point('a', 1, 1),
      point('b', 1, 1),
      point('nan', Number.NaN, 1),
      point('inf', Number.POSITIVE_INFINITY, 1),
    ]);
    expect(result.stacks).toHaveLength(1);
    expect(result.idToKey.has('nan')).toBe(false);
    expect(result.idToKey.has('inf')).toBe(false);
  });

  // #121 regression: hiding a legend value removes the corresponding points
  // from the visible set, so the duplicate-stack pass must reflect that.
  describe('legend-hide regression (#121)', () => {
    const all = [
      point('a', 1, 1),
      point('b', 1, 1),
      point('c', 1, 1),
      point('d', 5, 5),
      point('e', 5, 5),
    ];

    it('shrinks a 3-point stack to a 2-point stack when one member is hidden', () => {
      const visible = all.filter((p) => p.id !== 'c');
      const result = buildDuplicateStacks(visible);
      const stack = result.byKey.get(getDuplicateStackKey({ x: 1, y: 1 }));
      expect(stack?.points).toHaveLength(2);
    });

    it('drops a stack entirely when hiding leaves only one member', () => {
      const visible = all.filter((p) => p.id !== 'd' && p.id !== 'e');
      const result = buildDuplicateStacks(visible);
      // Only one (1,1) stack remains. The (5,5) stack must be gone.
      expect(result.stacks).toHaveLength(1);
      expect(result.byKey.has(getDuplicateStackKey({ x: 5, y: 5 }))).toBe(false);
    });

    it('produces no stacks at all when hiding leaves every point alone', () => {
      const visible = [all[0], all[3]]; // one from each group
      const result = buildDuplicateStacks(visible);
      expect(result.stacks).toEqual([]);
    });
  });

  // #121 regression: switching projections gives the same proteins different
  // coordinates. The duplicate-stack pass must rebuild against the new coords,
  // not carry stale groupings from the previous projection.
  describe('projection-switch regression (#121)', () => {
    // Same three proteins, different projection coords.
    const projectionA = [point('a', 1, 1), point('b', 1, 1), point('c', 9, 9)];
    const projectionB = [point('a', 2, 2), point('b', 7, 7), point('c', 9, 9)];

    it('finds the duplicate pair in projection A', () => {
      const result = buildDuplicateStacks(projectionA);
      expect(result.stacks).toHaveLength(1);
      expect(result.stacks[0].points.map((p) => p.id).sort()).toEqual(['a', 'b']);
    });

    it('finds no duplicates in projection B where the same proteins separate', () => {
      const result = buildDuplicateStacks(projectionB);
      expect(result.stacks).toEqual([]);
    });

    it('rebuilds independently — projection A stacks do not leak into projection B', () => {
      const a = buildDuplicateStacks(projectionA);
      const b = buildDuplicateStacks(projectionB);
      expect(a.stacks.length).toBe(1);
      expect(b.stacks.length).toBe(0);
      expect(a.byKey).not.toBe(b.byKey);
    });

    it('treats UMAP-style jitter (identical embedding, distinct projected coords) as separate points', () => {
      // The exact failure mode from PR 223 review: identical embeddings produce
      // identical PCA but slightly different UMAP coords. Under per-projection
      // grouping, these should NOT form a stack in UMAP.
      const umap = [point('a', 0.123, 0.456), point('b', 0.124, 0.456)];
      const result = buildDuplicateStacks(umap);
      expect(result.stacks).toEqual([]);
    });
  });
});
