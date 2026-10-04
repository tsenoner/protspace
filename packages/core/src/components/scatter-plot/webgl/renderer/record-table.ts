/**
 * The per-record style table, which lets a legend hide, show or recolour change
 * one texel pair per category instead of re-staging every point.
 *
 * Points staged against it carry their record id and their opacity as if the
 * legend hid nothing (see `StagePointArrays.recordIds`). The vertex shader reads
 * the rest from the table (`RECORD_STYLE_GLSL`): texel `2r` holds record `r`'s
 * colour and whether it is shown, texel `2r + 1` its size, shape and label count.
 * The values are the floats staging packs for a point, so a point drawn through
 * the table is drawn exactly as one staged with them.
 *
 * Pure: no GL.
 */

import type { PointStyleRecords } from '../types';
import { RECORD_STYLE_WIDTH } from './export-shaders';
import type { PackedRecords } from './pass-staging';
import { SELECTED_OPACITY_THRESHOLD } from './point-staging';

const SELECTED_TIER_MIN_ALPHA = SELECTED_OPACITY_THRESHOLD - 1e-6;

type RecordCodes = NonNullable<PointStyleRecords['codes']>;

/** What the staged slots say about each record, and the table drawn over them. */
export interface StagedRecords {
  readonly codes: RecordCodes;
  /** Slots drawn unless the record is hidden: alpha above 0. */
  readonly drawn: Uint32Array;
  /** Draw index of the first such slot, or -1. */
  readonly firstDrawn: Int32Array;
  /**
   * Slots that may be in the selected paint tier, whose paint depth a hide
   * would change. Counted generously: a restyle it wrongly refuses re-stages.
   */
  readonly selectedTier: Uint32Array;
  /** The hiding the table applies. */
  hidden: readonly boolean[];
  /** RGBA32F texels, `RECORD_STYLE_WIDTH` per row. */
  readonly texels: Float32Array;
}

export function recordTableRows(recordCount: number): number {
  return Math.max(1, Math.ceil((recordCount * 2) / RECORD_STYLE_WIDTH));
}

/**
 * The table over `count` slots staged with record ids (`recordIds[k]` for the
 * slot drawn k-th) and their unhidden alpha (`colors[4k + 3]`), or null when a
 * slot's record is not one of `codes`: a restyle could not name it, so staging
 * keeps no table. Reads both in draw order, so it is one sequential pass.
 */
export function collectStagedRecords(
  codes: RecordCodes,
  recordIds: Float32Array,
  colors: Float32Array,
  count: number,
  hidden: readonly boolean[],
): StagedRecords | null {
  const n = codes.count;
  const drawn = new Uint32Array(n);
  const firstDrawn = new Int32Array(n).fill(-1);
  const selectedTier = new Uint32Array(n);
  for (let k = 0; k < count; k++) {
    const r = recordIds[k];
    if (!(r >= 0 && r < n)) return null;
    const alpha = colors[k * 4 + 3];
    if (alpha > 0) {
      drawn[r]++;
      if (firstDrawn[r] < 0) firstDrawn[r] = k;
    }
    // Alpha is the opacity rounded to float32: count near the threshold too.
    if (alpha >= SELECTED_TIER_MIN_ALPHA) selectedTier[r]++;
  }
  return {
    codes,
    drawn,
    firstDrawn,
    selectedTier,
    hidden: hidden.slice(0, n),
    texels: new Float32Array(recordTableRows(n) * RECORD_STYLE_WIDTH * 4),
  };
}

/**
 * Whether a pass with these records and hiding can restyle the staged slots
 * through the table alone. The ids must name the same categories, and a hide
 * must not move a slot between paint tiers: hidden opacity is 0, so a point in
 * the selected tier sorts and cuts differently once hidden.
 */
export function canRestyle(
  staged: StagedRecords,
  codes: PointStyleRecords['codes'],
  hidden: readonly boolean[],
): boolean {
  const was = staged.codes;
  if (!codes || codes.values !== was.values || codes.rows !== was.rows) return false;
  if (codes.count !== was.count || hidden.length < was.count) return false;
  for (let r = 0; r < was.count; r++) {
    if (hidden[r] !== staged.hidden[r] && staged.selectedTier[r] > 0) return false;
  }
  return true;
}

/** Fill the table from packed records and their hiding. */
export function writeRecordTexels(
  staged: StagedRecords,
  packed: PackedRecords,
  hidden: readonly boolean[],
): void {
  const { colors, sizes, shapes, labelCounts } = packed.channels;
  const t = staged.texels;
  for (let r = 0; r < staged.codes.count; r++) {
    const o = r * 8;
    t[o] = colors[r * 4];
    t[o + 1] = colors[r * 4 + 1];
    t[o + 2] = colors[r * 4 + 2];
    t[o + 3] = hidden[r] ? 0 : 1;
    t[o + 4] = sizes[r];
    t[o + 5] = shapes[r];
    t[o + 6] = labelCounts[r];
  }
  staged.hidden = hidden.slice(0, staged.codes.count);
}

/**
 * `firstDrawn` when the marked slots (`marked`, by draw index) draw after every
 * other slot: a rank in that order rather than a draw index, which orders the
 * records the same way.
 */
export function markedFirstDrawn(
  staged: StagedRecords,
  recordIds: Float32Array,
  colors: Float32Array,
  marked: Uint8Array,
  count: number,
): Int32Array {
  const first = new Int32Array(staged.codes.count).fill(-1);
  for (let k = 0; k < count; k++) {
    if (!(colors[k * 4 + 3] > 0)) continue;
    const r = recordIds[k];
    const rank = marked[k] ? count + k : k;
    if (first[r] < 0 || rank < first[r]) first[r] = rank;
  }
  return first;
}

/** Staged slots drawn under the table's hiding: opacity above 0. */
export function shownSlotCount(staged: StagedRecords): number {
  let n = 0;
  for (let r = 0; r < staged.codes.count; r++) if (!staged.hidden[r]) n += staged.drawn[r];
  return n;
}
