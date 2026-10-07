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

  it('records the key byKey uses for every point id, so a click finds its stack', () => {
    // The overlay controller spiderfies a clicked point via
    // byKey.get(idToKey.get(point.id)), so the two maps must agree on the key.
    const result = buildDuplicateStacks([point('a', 1, 2), point('b', 1, 2), point('c', 9, 8)]);
    expect(result.idToKey.get('a')).toBe(getDuplicateStackKey({ x: 1, y: 2 }));
    expect(result.idToKey.get('b')).toBe(getDuplicateStackKey({ x: 1, y: 2 }));
    expect(result.idToKey.get('c')).toBe(getDuplicateStackKey({ x: 9, y: 8 }));
    expect(result.byKey.get(result.idToKey.get('a')!)).toBe(result.stacks[0]);
    expect(result.byKey.get(result.idToKey.get('c')!)).toBeUndefined();
  });

  it('exposes the data-space x/y of the stack so callers can re-project to pixels', () => {
    // Contract for the production viewport path: it re-projects stack.x/stack.y
    // through scales.x/scales.y to get px/py, so the helper must surface them.
    const result = buildDuplicateStacks([point('a', 1.5, 2.5), point('b', 1.5, 2.5)]);
    expect(result.stacks[0].x).toBe(1.5);
    expect(result.stacks[0].y).toBe(2.5);
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

  // #121 regression: the duplicate-stack pass runs on the visible points of the
  // current projection, so a hidden member or a projection switch must change
  // the grouping. Rebuilding after those events is the component's job (see the
  // overlay controller's capture-badges tests); here we pin the two inputs that
  // differ from the plain grouping cases above.
  describe('#121 regression', () => {
    it('shrinks a 3-point stack to a 2-point stack when one member is hidden', () => {
      const all = [point('a', 1, 1), point('b', 1, 1), point('c', 1, 1)];
      const visible = all.filter((p) => p.id !== 'c');
      const result = buildDuplicateStacks(visible);
      const stack = result.byKey.get(getDuplicateStackKey({ x: 1, y: 1 }));
      expect(stack?.points).toHaveLength(2);
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
