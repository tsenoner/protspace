/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import {
  DuplicateBadgesCanvasRenderer,
  BADGE_RADIUS,
  BADGE_OFFSET,
} from './duplicate-badges-canvas-renderer';
import type { RenderDuplicateStack } from './duplicate-stack-types';

/**
 * Fake canvas recording both method calls and property sets (the sibling
 * fakeCanvas in duplicate-badges-canvas-renderer.test.ts records calls only;
 * renderExport assertions also need font / lineWidth values).
 */
function fakeCanvas(width: number, height: number) {
  const calls: Array<[string, unknown[]]> = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, p) =>
      typeof p === 'string' &&
      ['setTransform', 'clearRect', 'beginPath', 'arc', 'fill', 'stroke', 'fillText'].includes(p)
        ? (...a: unknown[]) => calls.push([p, a])
        : undefined,
    set: (_t, p, v) => {
      if (typeof p === 'string') props[p] = v;
      return true;
    },
  });
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls, props };
}

const stk = (key: string, px: number, py: number, n: number): RenderDuplicateStack => ({
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

function makeRenderer(canvas: HTMLCanvasElement | undefined, expandedKey: string | null = null) {
  return new DuplicateBadgesCanvasRenderer({
    getCanvas: () => canvas,
    getTransform: () => ({ x: 0, y: 0, k: 1 }), // unused by renderExport
    getSize: () => ({ width: 0, height: 0 }), // unused by renderExport
    getExpandedKey: () => expandedKey,
  });
}

describe('DuplicateBadgesCanvasRenderer.renderExport (#302)', () => {
  it('draws in raw output pixels: identity transform, full physical clear, px/py used as-is', () => {
    const { canvas, calls } = fakeCanvas(1600, 400);
    makeRenderer(canvas).renderExport([stk('a', 100, 50, 3)], 1);
    expect(calls[0]).toEqual(['setTransform', [1, 0, 0, 1, 0, 0]]);
    expect(calls[1]).toEqual(['clearRect', [0, 0, 1600, 400]]);
    const arc = calls.find(([m]) => m === 'arc')!;
    expect(arc[1]).toEqual([
      100 + BADGE_OFFSET.x,
      50 + BADGE_OFFSET.y,
      BADGE_RADIUS,
      0,
      Math.PI * 2,
    ]);
  });

  it('scales radius, offset, font and line width uniformly by badgeScale (badges stay round)', () => {
    const { canvas, calls, props } = fakeCanvas(1600, 400);
    makeRenderer(canvas).renderExport([stk('a', 100, 50, 3)], 2);
    const arc = calls.find(([m]) => m === 'arc')!;
    // A single scalar radius — a circle by construction, no x/y stretch possible.
    expect(arc[1]).toEqual([
      100 + 2 * BADGE_OFFSET.x,
      50 + 2 * BADGE_OFFSET.y,
      2 * BADGE_RADIUS,
      0,
      Math.PI * 2,
    ]);
    expect(props.font).toBe(
      '700 20px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    );
    expect(props.lineWidth).toBe(3);
    const label = calls.find(([m]) => m === 'fillText')!;
    expect(label[1]).toEqual(['3', 100 + 2 * BADGE_OFFSET.x, 50 + 2 * BADGE_OFFSET.y]);
  });

  it('tints the expanded stack and labels every stack with its member count', () => {
    const { canvas, calls } = fakeCanvas(800, 600);
    makeRenderer(canvas, 'b').renderExport([stk('a', 10, 10, 3), stk('b', 20, 20, 5)], 1);
    expect(calls.filter(([m]) => m === 'arc')).toHaveLength(2);
    expect(calls.filter(([m]) => m === 'fillText').map(([, a]) => a[0])).toEqual(['3', '5']);
  });

  it('is a silent no-op without a canvas or 2d context', () => {
    expect(() => makeRenderer(undefined).renderExport([stk('a', 0, 0, 2)], 1)).not.toThrow();
    const noCtx = { width: 10, height: 10, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => makeRenderer(noCtx).renderExport([stk('a', 0, 0, 2)], 1)).not.toThrow();
  });
});
