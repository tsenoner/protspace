import { describe, it, expect, vi, afterEach } from 'vitest';
import { IDENTITY_RESCALE } from './rescale';
import { MAX_FRAME_STEP_MS, MORPH_MS } from './position-morph';
import { PositionGlide } from './position-glide';

// Three slots painted in the order 2, 0, 1, at these paint-order positions.
const order = Uint32Array.from([2, 0, 1]);
const staged = Float32Array.from([20, 21, 0, 1, 10, 11]);

afterEach(() => vi.unstubAllGlobals());

describe('PositionGlide', () => {
  const at = (time: number) => vi.stubGlobal('document', { timeline: { currentTime: time } });
  const reorder = Uint32Array.from([0, 1, 2]);

  it('captures nothing without a request or a glide in flight', () => {
    const glide = new PositionGlide();
    expect(glide.capture(false, staged, IDENTITY_RESCALE, order, 3)).toBeNull();
    expect(glide.afterResort(null, false, order, 3)).toBe(false);
    expect(glide.active).toBe(false);
  });

  it('starts where the points are drawn, by slot across the re-sort, and ends at MORPH_MS', () => {
    at(0);
    const glide = new PositionGlide();
    glide.request();
    expect(glide.takeRequest()).toBe(true);
    expect(glide.takeRequest()).toBe(false);
    const start = glide.capture(true, staged, IDENTITY_RESCALE, order, 3);
    expect(glide.afterResort(start, true, reorder, 3)).toBe(true);
    expect(Array.from(glide.from!)).toEqual([0, 1, 10, 11, 20, 21]);
    expect(glide.advance()).toBe(false);
    expect(glide.weight).toBe(1);
    let ended = false;
    for (let t = MAX_FRAME_STEP_MS; !ended; t += MAX_FRAME_STEP_MS) {
      at(t);
      ended = glide.advance();
      if (!ended) expect(glide.weight).toBeGreaterThan(0);
      else expect(t).toBeGreaterThanOrEqual(MORPH_MS);
    }
    expect(glide.active).toBe(false);
    expect(glide.weight).toBe(0);
  });

  it('keeps its start and clock across a re-sort it was not asked for', () => {
    at(0);
    const glide = new PositionGlide();
    glide.afterResort(glide.capture(true, staged, IDENTITY_RESCALE, order, 3), true, order, 3);
    at(MAX_FRAME_STEP_MS);
    glide.advance();
    const weight = glide.weight;
    const from = Array.from(glide.from!);
    const carried = glide.capture(
      false,
      Float32Array.from([9, 9, 9, 9, 9, 9]),
      IDENTITY_RESCALE,
      order,
      3,
    );
    glide.afterResort(carried, false, order, 3);
    expect(Array.from(glide.from!)).toEqual(from);
    at(MAX_FRAME_STEP_MS);
    glide.advance();
    expect(glide.weight).toBe(weight);
  });

  it('restarts the clock on a new request, and ends without a start', () => {
    at(0);
    const glide = new PositionGlide();
    glide.afterResort(glide.capture(true, staged, IDENTITY_RESCALE, order, 3), true, order, 3);
    at(5 * MAX_FRAME_STEP_MS);
    for (let i = 0; i < 5; i++) glide.advance();
    glide.afterResort(glide.capture(true, staged, IDENTITY_RESCALE, order, 3), true, order, 3);
    glide.advance();
    expect(glide.weight).toBe(1);
    expect(glide.afterResort(null, true, order, 3)).toBe(true);
    expect(glide.active).toBe(false);
  });

  it('cancels the request and the glide', () => {
    at(0);
    const glide = new PositionGlide();
    expect(glide.cancel()).toBe(false);
    glide.request();
    glide.afterResort(glide.capture(true, staged, IDENTITY_RESCALE, order, 3), true, order, 3);
    expect(glide.cancel()).toBe(true);
    expect(glide.takeRequest()).toBe(false);
    expect(glide.active).toBe(false);
  });
});
