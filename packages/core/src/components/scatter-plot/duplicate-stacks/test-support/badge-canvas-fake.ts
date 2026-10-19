/**
 * Shared fakes for the DuplicateBadgesCanvasRenderer suites (live render and
 * renderExport), so both record the canvas the same way.
 */
import type { RenderDuplicateStack } from '../duplicate-stack-types';

/**
 * Fake canvas recording method calls and property sets. `fill()` is recorded
 * with the fillStyle current at the call, so a test can tell which colour each
 * badge arc used (`props.fillStyle` only keeps the last value, the label's
 * `#ffffff`).
 */
export function fakeCanvas(width: number, height: number) {
  const calls: Array<[string, unknown[]]> = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, p) =>
      typeof p === 'string' &&
      ['setTransform', 'clearRect', 'beginPath', 'arc', 'fill', 'stroke', 'fillText'].includes(p)
        ? (...a: unknown[]) => calls.push([p, p === 'fill' ? [props.fillStyle] : a])
        : undefined,
    set: (_t, p, v) => {
      if (typeof p === 'string') props[p] = v;
      return true;
    },
  });
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls, props };
}

/** A render stack of `n` members drawn at (px, py). */
export const stk = (key: string, px: number, py: number, n: number): RenderDuplicateStack => ({
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
