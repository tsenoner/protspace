import type { ScalePair } from '@protspace/utils';

/** One axis of an affine map between two pixel layouts: `to = from * scale + offset`. */
export interface AxisRescale {
  readonly scale: number;
  readonly offset: number;
}

/** Moves a pixel position laid out by one scale pair to where another pair puts it. */
export interface Rescale {
  readonly x: AxisRescale;
  readonly y: AxisRescale;
}

export const IDENTITY_RESCALE: Rescale = {
  x: { scale: 1, offset: 0 },
  y: { scale: 1, offset: 0 },
};

interface AxisSnapshot {
  readonly domain: readonly number[];
  readonly range: readonly number[];
}

/** A scale pair's domains and ranges, copied when something was laid out with it. */
export interface ScaleSnapshot {
  readonly x: AxisSnapshot;
  readonly y: AxisSnapshot;
}

export function snapshotScales(scales: ScalePair): ScaleSnapshot {
  return {
    x: { domain: scales.x.domain(), range: scales.x.range() },
    y: { domain: scales.y.domain(), range: scales.y.range() },
  };
}

function rescaleAxis(from: AxisSnapshot, to: ScalePair['x']): AxisRescale | null {
  const [d0, d1] = to.domain();
  if (d0 !== from.domain[0] || d1 !== from.domain[1]) return null;
  const [r0, r1] = from.range;
  const [c0, c1] = to.range();
  const scale = (c1 - c0) / (r1 - r0);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const offset = c0 - r0 * scale;
  return Number.isFinite(offset) ? { scale, offset } : null;
}

/**
 * The map from pixels laid out by `from` to pixels laid out by `to`, when only
 * the ranges differ, which is all a resize changes. Null for a new domain (new
 * data) or a range that collapsed or flipped: then nothing short of laying the
 * points out again is right. Equal scales return {@link IDENTITY_RESCALE} itself.
 */
export function rescaleBetween(from: ScaleSnapshot, to: ScalePair): Rescale | null {
  const x = rescaleAxis(from.x, to.x);
  const y = x && rescaleAxis(from.y, to.y);
  if (!x || !y) return null;
  const identity = x.scale === 1 && x.offset === 0 && y.scale === 1 && y.offset === 0;
  return identity ? IDENTITY_RESCALE : { x, y };
}
