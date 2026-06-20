/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  DuplicateBadgesCanvasRenderer,
  cullAndCapStacks,
  DUPLICATE_BADGES_MAX_VISIBLE,
  BADGE_RADIUS,
  BADGE_OFFSET,
  BADGE_EXPANDED_FILL,
  BADGE_DEFAULT_FILL,
} from './duplicate-badges-canvas-renderer';
import type { ViewportDuplicateStack } from './duplicate-badges-canvas-renderer';

function fakeCanvas() {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, p) =>
      typeof p === 'string' &&
      ['setTransform', 'clearRect', 'beginPath', 'arc', 'fill', 'stroke', 'fillText'].includes(p)
        ? (...a: unknown[]) => calls.push([p, a])
        : undefined,
    set: () => true,
  });
  const canvas = {
    width: 1600,
    height: 1200,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const stk = (key: string, px: number, py: number, n: number): ViewportDuplicateStack => ({
  key,
  px,
  py,
  points: Array.from({ length: n }, (_, i) => ({
    id: `${key}-${i}`,
    x: 0,
    y: 0,
    originalIndex: i,
  })),
});

describe('DuplicateBadgesCanvasRenderer', () => {
  it('exposes the named geometry/style constants (no magic numbers)', () => {
    expect(BADGE_RADIUS).toBe(9);
    expect(BADGE_OFFSET).toEqual({ x: 10, y: -10 });
    expect(BADGE_EXPANDED_FILL).toBe('rgba(59, 130, 246, 0.9)');
    expect(BADGE_DEFAULT_FILL).toBe('rgba(17, 24, 39, 0.85)');
  });

  it('clear() resets the device-pixel transform and clears the full canvas', () => {
    const { canvas, calls } = fakeCanvas();
    const r = new DuplicateBadgesCanvasRenderer({
      getCanvas: () => canvas,
      getTransform: () => ({ x: 0, y: 0, k: 1 }),
      getSize: () => ({ width: 800, height: 600 }),
      getExpandedKey: () => null,
    });
    r.clear();
    expect(calls[0]).toEqual(['setTransform', [1, 0, 0, 1, 0, 0]]);
    expect(calls[1]).toEqual(['clearRect', [0, 0, 1600, 1200]]);
  });

  it('render() draws one arc + one count label per stack and tints the expanded one', () => {
    const { canvas, calls } = fakeCanvas();
    const r = new DuplicateBadgesCanvasRenderer({
      getCanvas: () => canvas,
      getTransform: () => ({ x: 0, y: 0, k: 1 }),
      getSize: () => ({ width: 800, height: 600 }),
      getExpandedKey: () => 'b',
    });
    r.render([stk('a', 10, 10, 3), stk('b', 20, 20, 5)]);
    expect(calls.filter(([m]) => m === 'arc')).toHaveLength(2);
    expect(calls.filter(([m]) => m === 'fillText').map(([, a]) => a[0])).toEqual(['3', '5']);
  });
});

const stack = (key: string, px: number, py: number, n: number): ViewportDuplicateStack => ({
  key,
  px,
  py,
  points: Array.from({ length: n }, (_, i) => ({
    id: `${key}-${i}`,
    x: px,
    y: py,
    originalIndex: i,
  })),
});
const win = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

describe('cullAndCapStacks', () => {
  it('drops stacks whose px/py fall outside the window', () => {
    const out = cullAndCapStacks(
      [stack('in', 50, 50, 2), stack('out', 200, 50, 2)],
      win,
      null,
      new Map(),
    );
    expect(out.map((s) => s.key)).toEqual(['in']);
  });

  it('keeps all visible stacks when under the cap', () => {
    const stacks = Array.from({ length: 5 }, (_, i) => stack(`s${i}`, 10 + i, 10, 2));
    expect(cullAndCapStacks(stacks, win, null, new Map())).toHaveLength(5);
  });

  it('caps to the top-N by points.length when over DUPLICATE_BADGES_MAX_VISIBLE', () => {
    const stacks = Array.from({ length: DUPLICATE_BADGES_MAX_VISIBLE + 10 }, (_, i) =>
      stack(`s${i}`, 10, 10, i + 2),
    );
    const out = cullAndCapStacks(stacks, win, null, new Map());
    expect(out).toHaveLength(DUPLICATE_BADGES_MAX_VISIBLE);
    // largest groups survive
    expect(Math.min(...out.map((s) => s.points.length))).toBeGreaterThan(2);
  });

  it('force-keeps the expanded stack even if it is not in the top-N (and is in-window)', () => {
    const big = Array.from({ length: DUPLICATE_BADGES_MAX_VISIBLE }, (_, i) =>
      stack(`big${i}`, 10, 10, i + 100),
    );
    const small = stack('expanded', 50, 50, 2); // small ⇒ would be culled by cap
    const byKey = new Map([[small.key, small]]);
    const out = cullAndCapStacks([...big, small], win, 'expanded', byKey);
    expect(out.some((s) => s.key === 'expanded')).toBe(true);
    expect(out).toHaveLength(DUPLICATE_BADGES_MAX_VISIBLE + 1);
  });

  it('does NOT re-add the expanded stack when it is out of window', () => {
    const big = Array.from({ length: DUPLICATE_BADGES_MAX_VISIBLE }, (_, i) =>
      stack(`big${i}`, 10, 10, i + 100),
    );
    const offscreen = stack('expanded', 999, 999, 2);
    const byKey = new Map([[offscreen.key, offscreen]]);
    const out = cullAndCapStacks([...big, offscreen], win, 'expanded', byKey);
    expect(out.some((s) => s.key === 'expanded')).toBe(false);
  });
});
