/**
 * Full-extent duplicate-stack compute for figure export (#301).
 *
 * The live overlay computes stacks only for the current viewport
 * (DuplicateStackOverlayController.ensureForViewport — chunked, quadtree-
 * scoped) as a deliberate perf optimization; a figure-export capture renders
 * the fit-all view and therefore needs stacks for the WHOLE extent. This
 * module is that capture-time compute: a synchronous two-pass sweep over the
 * raw PlotData arrays for the host-provided visible (legend/filter) slots.
 *
 * Perf contract (measured: .flow/research/2026-07-15-issue-301-export-badges/
 * 04-sync-compute-perf.md — 570k points, Apple M4, 5-run medians):
 * - Pass 1 iterates the visible-slot list against pd.xs/pd.ys directly. NEVER
 *   enumerate via the quadtree (queryByPixels(±Infinity) measured 280ms vs
 *   3ms, ~93× slower) and NEVER materialize PlotDataPoints per slot.
 * - Pass 1 keys on a collision-free BigInt packed from the two Float32 bit
 *   patterns — NEVER per-slot `${x}|${y}` strings (measured ~940–1170ms
 *   total, 5–6× over the ~200ms freeze budget; this BigInt variant measured
 *   ~181–248ms total).
 * - The canonical string key (getDuplicateStackKey format) is computed only
 *   for the small count>1 subset in pass 2, so stack.key stays wire-
 *   compatible with the live path (expandedKey identity).
 *
 * Grouping parity with the live path's `${x}|${y}` keying: both paths read
 * the same Float32Array slots, Float32→double conversion is injective, and
 * String(double) is injective on distinct non-NaN doubles — so bit-pattern
 * equality ⇔ value equality ⇔ string-key equality, except −0 vs +0
 * (different bits, same string since String(-0) === '0'), which pass 1
 * normalizes explicitly. Non-finite coords are skipped by the same finite
 * check buildDuplicateStacks uses.
 */

import type { PlotData } from '@protspace/utils';
import { materializePlotDataPoint } from '@protspace/utils';
import { getDuplicateStackKey } from './duplicate-stack-helpers';
import type { ViewportDuplicateStack } from './duplicate-stack-types';

/**
 * A duplicate stack in data space only. px/py are deliberately absent: the
 * capture path projects per capture through the EXPORT scales (see
 * BadgeCaptureProjection), never the live display scales.
 */
export type FullExtentDuplicateStack = Omit<ViewportDuplicateStack, 'px' | 'py'>;

// Scratch views for extracting the raw Float32 bit pattern of a coordinate.
const coordBits = new Float32Array(1);
const coordBitsU32 = new Uint32Array(coordBits.buffer);

/**
 * Float32 bit pattern of `v`, with −0 normalized to +0 so both zeros share a
 * key (String(-0) === '0', so the live `${x}|${y}` grouping merges them).
 */
function float32Bits(v: number): number {
  coordBits[0] = v === 0 ? 0 : v;
  return coordBitsU32[0];
}

/**
 * Group every visible slot into exact-coordinate duplicate stacks (count > 1)
 * across the full data extent. Synchronous by design — captureAtResolution is
 * a synchronous public API. Solos are skipped entirely (never materialized);
 * an idToKey map is deliberately NOT built (the badge cull/draw path reads
 * only key/px/py/points.length — research doc 02).
 */
export function computeFullExtentDuplicateStacks(
  pd: PlotData,
  visibleSlots: ArrayLike<number>,
): FullExtentDuplicateStack[] {
  const n = visibleSlots.length;
  const xs = pd.xs;
  const ys = pd.ys;

  // Pass 1: count occurrences per exact coord pair. Raw typed-array reads +
  // one BigInt key per slot; no strings, no object materialization.
  const counts = new Map<bigint, number>();
  for (let i = 0; i < n; i++) {
    const slot = visibleSlots[i];
    const x = xs[slot];
    const y = ys[slot];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = (BigInt(float32Bits(x)) << 32n) | BigInt(float32Bits(y));
    const c = counts.get(key);
    counts.set(key, c === undefined ? 1 : c + 1);
  }

  // Pass 2: build stacks only for keys with count > 1; materialize member
  // points only there (duplicate members are a small fraction of the data).
  const byBitKey = new Map<bigint, FullExtentDuplicateStack>();
  const stacks: FullExtentDuplicateStack[] = [];
  for (let i = 0; i < n; i++) {
    const slot = visibleSlots[i];
    const x = xs[slot];
    const y = ys[slot];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = (BigInt(float32Bits(x)) << 32n) | BigInt(float32Bits(y));
    const count = counts.get(key);
    if (count === undefined || count <= 1) continue;
    let stack = byBitKey.get(key);
    if (!stack) {
      stack = { key: getDuplicateStackKey({ x, y }), x, y, points: [] };
      byBitKey.set(key, stack);
      stacks.push(stack);
    }
    stack.points.push(materializePlotDataPoint(pd, slot));
  }
  return stacks;
}
