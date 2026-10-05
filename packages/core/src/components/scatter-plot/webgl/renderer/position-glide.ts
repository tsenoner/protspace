/**
 * The projection glide's owner: what the renderer stages and draws a glide with,
 * and when it ends. The math is in position-morph.ts.
 */
import type { Rescale } from './rescale';
import {
  MAX_FRAME_STEP_MS,
  drawnPositions,
  frameTime,
  morphWeight,
  repaintOrder,
  samePaintOrder,
} from './position-morph';

/** Where a glide that crosses a re-sort starts: the drawn positions, and the paint order they are in. */
interface GlideStart {
  drawn: Float32Array;
  order: Uint32Array;
}

/**
 * One projection glide: the request for the next render, the positions the
 * points glide from (staged like the positions they glide to, and only while
 * they move), its clock and this frame's weight.
 */
export class PositionGlide {
  private requested = false;
  private state: { from: Float32Array; elapsed: number; last: number } | null = null;
  private weightNow = 0;

  /** Glide on the next render's position stage. */
  request(): void {
    this.requested = true;
  }

  /** The request, cleared: it applies to one render only. */
  takeRequest(): boolean {
    const requested = this.requested;
    this.requested = false;
    return requested;
  }

  /** Drop the request and end the glide; true when one ended. */
  cancel(): boolean {
    this.requested = false;
    return this.state !== null && this.end();
  }

  /** End the glide; true when one was in flight. */
  end(): boolean {
    const ended = this.state !== null;
    this.state = null;
    this.weightNow = 0;
    return ended;
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Weight of `from` in the frame being drawn; 0 outside a glide. */
  get weight(): number {
    return this.weightNow;
  }

  /** The positions the points glide from, or null outside a glide. */
  get from(): Float32Array | null {
    return this.state?.from ?? null;
  }

  /**
   * Before a re-sort of `count` staged points: where they are drawn, if this
   * stage starts a glide (`requested`) or one is in flight. A new glide starts
   * where the points are drawn now; one in flight keeps its start.
   */
  capture(
    requested: boolean,
    positions: Float32Array,
    rescale: Rescale,
    order: Uint32Array,
    count: number,
  ): GlideStart | null {
    if (!requested && !this.state) return null;
    return {
      drawn: drawnPositions(positions, this.from, requested ? this.weightNow : 1, rescale, count),
      order: order.slice(0, count),
    };
  }

  /**
   * After the re-sort into `order`: glide from `start` by slot, on a fresh clock
   * when `requested`, else on the clock of the glide in flight. Without a start,
   * the glide ends. True when the start positions changed.
   */
  afterResort(
    start: GlideStart | null,
    requested: boolean,
    order: Uint32Array,
    count: number,
  ): boolean {
    if (!start && !this.state) return false;
    if (start && !samePaintOrder(start.order, order, count)) {
      repaintOrder(start.drawn, start.order, order, count);
    }
    const clock = !requested && this.state ? this.state : { elapsed: 0, last: frameTime() };
    this.state = start && { from: start.drawn, elapsed: clock.elapsed, last: clock.last };
    return true;
  }

  /** Set this frame's weight; true when that ended the glide. */
  advance(): boolean {
    const state = this.state;
    if (state) {
      const now = frameTime();
      state.elapsed += Math.min(now - state.last, MAX_FRAME_STEP_MS);
      state.last = now;
    }
    this.weightNow = state ? morphWeight(state.elapsed) : 0;
    return state !== null && this.weightNow === 0 && this.end();
  }
}
