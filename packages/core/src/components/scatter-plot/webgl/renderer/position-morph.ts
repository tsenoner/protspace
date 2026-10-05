/**
 * Projection glide: on a projection switch every point moves from where it is
 * drawn to its new position instead of jumping there.
 *
 * The staged buffers are in paint order (far to near), and a position stage
 * re-sorts it. The start positions therefore cross the re-sort by slot: read
 * out in the old order, written back in the new one.
 */
import type { Rescale } from './rescale';

/** Length of the glide, the same as the landing page's projection switch. */
export const MORPH_MS = 800;

/**
 * Most the glide advances in one frame. A stall, such as the quadtree rebuild
 * right after a switch (about 70 ms at 573K points), then pauses the glide
 * instead of skipping part of it.
 */
export const MAX_FRAME_STEP_MS = 1000 / 30;

/**
 * The current frame's timestamp, falling back to `performance.now()` where there
 * is no document timeline. Unlike `performance.now()` it does not depend on when
 * in the frame the render runs, which drifts while the GPU is busy and would make
 * the glide advance in uneven steps.
 */
export function frameTime(): number {
  const time = document.timeline?.currentTime;
  return typeof time === 'number' ? time : performance.now();
}

/**
 * Weight of the start positions `elapsed` ms into a glide: 1 at the start, 0
 * once it is over, eased in and out (cubic).
 */
export function morphWeight(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / MORPH_MS));
  const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  return 1 - eased;
}

/**
 * Where the first `count` staged points are drawn, in their paint order:
 * `positions` blended with `from`, the glide in flight if any, at `weight`, as
 * the shader mixes them, then carried by `rescale` to the pixels they are drawn at.
 */
export function drawnPositions(
  positions: Float32Array,
  from: Float32Array | null,
  weight: number,
  rescale: Rescale,
  count: number,
): Float32Array {
  const { x, y } = rescale;
  const drawn = new Float32Array(count * 2);
  for (let i = 0; i < count * 2; i += 2) {
    const px = from ? positions[i] * (1 - weight) + from[i] * weight : positions[i];
    const py = from ? positions[i + 1] * (1 - weight) + from[i + 1] * weight : positions[i + 1];
    drawn[i] = px * x.scale + x.offset;
    drawn[i + 1] = py * y.scale + y.offset;
  }
  return drawn;
}

/**
 * Whether two paint orders draw the same slots in the same order. Depth has no
 * position term, so a plain projection switch keeps the order.
 */
export function samePaintOrder(a: Uint32Array, b: Uint32Array, count: number): boolean {
  for (let k = 0; k < count; k++) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Move `drawn` from the paint order `before` to the paint order `after`, in place,
 * so every slot keeps its own position.
 */
export function repaintOrder(
  drawn: Float32Array,
  before: Uint32Array,
  after: Uint32Array,
  count: number,
): void {
  const bySlot = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    const s = before[k] * 2;
    bySlot[s] = drawn[k * 2];
    bySlot[s + 1] = drawn[k * 2 + 1];
  }
  for (let k = 0; k < count; k++) {
    const s = after[k] * 2;
    drawn[k * 2] = bySlot[s];
    drawn[k * 2 + 1] = bySlot[s + 1];
  }
}
