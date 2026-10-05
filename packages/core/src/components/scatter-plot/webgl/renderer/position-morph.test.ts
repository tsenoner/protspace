import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDENTITY_RESCALE } from '../../rescale';
import {
  MORPH_MS,
  drawnPositions,
  frameTime,
  morphWeight,
  repaintOrder,
  samePaintOrder,
} from './position-morph';

// Three slots painted in the order 2, 0, 1.
const order = Uint32Array.from([2, 0, 1]);
// Paint-order positions: the k-th pair belongs to slot order[k].
const staged = Float32Array.from([20, 21, 0, 1, 10, 11]);

afterEach(() => vi.unstubAllGlobals());

describe('position morph', () => {
  it('eases the start positions out from 1 to 0', () => {
    expect(morphWeight(0)).toBe(1);
    expect(morphWeight(MORPH_MS / 2)).toBeCloseTo(0.5);
    expect(morphWeight(MORPH_MS)).toBe(0);
    expect(morphWeight(MORPH_MS * 2)).toBe(0);
  });

  it("reads the document timeline's frame time, else performance.now()", () => {
    vi.stubGlobal('document', { timeline: { currentTime: 1234 } });
    expect(frameTime()).toBe(1234);
    vi.stubGlobal('document', { timeline: { currentTime: null } });
    vi.spyOn(performance, 'now').mockReturnValue(99);
    expect(frameTime()).toBe(99);
  });

  it('carries positions across a re-sort by slot, in place', () => {
    const drawn = drawnPositions(staged, null, 1, IDENTITY_RESCALE, 3);
    expect(Array.from(drawn)).toEqual(Array.from(staged));
    // Re-sorted to the order 1, 2, 0: every slot keeps its own position.
    repaintOrder(drawn, order, Uint32Array.from([1, 2, 0]), 3);
    expect(Array.from(drawn)).toEqual([10, 11, 20, 21, 0, 1]);
  });

  it('compares paint orders over the staged count only', () => {
    expect(samePaintOrder(order, Uint32Array.from([2, 0, 1, 7]), 3)).toBe(true);
    expect(samePaintOrder(order, Uint32Array.from([2, 1, 0]), 3)).toBe(false);
  });

  it('starts a new glide from where a glide in flight draws the points', () => {
    const from = Float32Array.from([30, 31, 40, 41, 50, 51]);
    const half = drawnPositions(staged, from, 0.5, IDENTITY_RESCALE, 3);
    expect(Array.from(half)).toEqual([25, 26, 20, 21, 30, 31]);
    // Weight 1 keeps the glide's own start positions.
    expect(Array.from(drawnPositions(staged, from, 1, IDENTITY_RESCALE, 3))).toEqual(
      Array.from(from),
    );
  });

  it('carries the drawn positions to the pixels the last frame drew them at', () => {
    const rescale = { x: { scale: 2, offset: 1 }, y: { scale: 0.5, offset: -1 } };
    const drawn = drawnPositions(staged, null, 0, rescale, 3);
    expect(Array.from(drawn)).toEqual([41, 9.5, 1, -0.5, 21, 4.5]);
  });
});
