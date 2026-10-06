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
 * {@link RecordStyleTable} owns the table, the record ids and the texture. The
 * functions before it are pure: no GL.
 */

import type { PointStylePass, PointStyleRecords } from '../types';
import { RECORD_FLOATS, RECORD_STYLE_WIDTH } from './point-shaders';
import { packRecords, type PackedRecords } from './pass-staging';
import type { StagePointStyleArrays } from './stage-point';
import { drainGlErrors } from './device-limits';
import { RECORD_STYLE_TEXTURE_UNIT, bindTextureAt } from './texture-units';
import { SELECTED_OPACITY_THRESHOLD } from '../../paint-depth';

const SELECTED_TIER_MIN_ALPHA = SELECTED_OPACITY_THRESHOLD - 1e-6;
/** Floats per row of the texture: `RECORD_STYLE_WIDTH` RGBA texels. */
const ROW_FLOATS = RECORD_STYLE_WIDTH * 4;

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
  /** RGBA32F texels, `RECORD_FLOATS` per record, in rows of `ROW_FLOATS`. */
  readonly texels: Float32Array;
}

function recordTableRows(recordCount: number): number {
  return Math.max(1, Math.ceil((recordCount * RECORD_FLOATS) / ROW_FLOATS));
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
    texels: new Float32Array(recordTableRows(n) * ROW_FLOATS),
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
    const o = r * RECORD_FLOATS;
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

/**
 * The table the staged points draw through. A stage asks {@link prepare}
 * whether it keeps one, staging writes the record ids, and {@link keep} fills
 * the table from the staged slots. With it, a legend change that only restyles
 * categories rewrites the table ({@link restyle}) instead of re-staging.
 */
export class RecordStyleTable {
  /** The record id of each staged slot, by draw index. Capacity-sized. */
  ids = new Float32Array(0);
  /** The table the staged points draw through, or null when the last stage kept none. */
  staged: StagedRecords | null = null;
  private tex: WebGLTexture | null = null;
  /** Rows the texture is allocated with; 0 before its first upload. */
  private rows = 0;

  create(gl: WebGL2RenderingContext): void {
    this.tex = gl.createTexture();
  }

  delete(gl: WebGL2RenderingContext): void {
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = null;
  }

  /** The context is gone, and the texture with it. */
  reset(): void {
    this.tex = null;
    this.staged = null;
    this.rows = 0;
  }

  resize(capacity: number): void {
    this.ids = new Float32Array(capacity);
  }

  /** The texture the points draw through, or null when the last stage kept no table. */
  get texture(): WebGLTexture | null {
    return this.staged ? this.tex : null;
  }

  /** Bind {@link texture} where the vertex shaders read it. */
  bind(gl: WebGL2RenderingContext): void {
    bindTextureAt(gl, RECORD_STYLE_TEXTURE_UNIT, this.texture);
  }

  /**
   * Whether this stage keeps a table, and if so point staging (`target`) at the
   * record ids it writes. It needs a pass that hides per record and keys every
   * record by category code: a single-valued annotation, so no pie markers.
   */
  prepare(
    pass: PointStylePass,
    target: StagePointStyleArrays,
    pies: boolean,
    maxTextureSize: number,
  ): boolean {
    const codes = pass.records.codes;
    const table =
      !pies &&
      !!codes &&
      !!this.tex &&
      recordTableRows(codes.count) <= maxTextureSize &&
      !!pass.hiddenRecords;
    target.recordIds = table ? this.ids : null;
    return table;
  }

  /**
   * After staging `count` slots into `colors` with `packed` records: keep the
   * table they were staged for, if any.
   */
  keep(
    pass: PointStylePass,
    table: boolean,
    packed: PackedRecords,
    colors: Float32Array,
    count: number,
  ): void {
    this.staged = null;
    if (!table) return;
    const hidden = pass.hiddenRecords!;
    const staged = collectStagedRecords(pass.records.codes!, this.ids, colors, count, hidden);
    if (!staged) {
      this.drop(colors, count, hidden);
      return;
    }
    writeRecordTexels(staged, packed, hidden);
    this.staged = staged;
  }

  /**
   * Upload the table before the staged colours. A table the device refuses is
   * dropped, so the first `count` colours take its hiding back. Returns the
   * bytes uploaded.
   */
  upload(gl: WebGL2RenderingContext, colors: Float32Array, count: number): number {
    if (!this.staged) return 0;
    const bytes = this.uploadTexels(gl);
    if (!bytes) this.drop(colors, count);
    return bytes;
  }

  /**
   * Rewrite the table for `pass`'s category styles and upload it, leaving every
   * staged buffer as it is. Returns the bytes uploaded: 0 when the staged points
   * cannot be restyled that way (see `canRestyle`), and the caller re-stages them.
   */
  restyle(gl: WebGL2RenderingContext, pass: PointStylePass, target: StagePointStyleArrays): number {
    const staged = this.staged;
    const hidden = pass.hiddenRecords;
    if (!staged || !hidden || !canRestyle(staged, pass.records.codes, hidden)) return 0;
    writeRecordTexels(staged, packRecords(pass.records, target), hidden);
    return this.uploadTexels(gl);
  }

  /**
   * Draw the first `count` staged slots without a table: a slot of a hidden
   * record was staged unhidden, so it takes opacity 0, as staging gives it.
   */
  private drop(colors: Float32Array, count: number, hidden = this.staged?.hidden ?? []): void {
    this.staged = null;
    for (let k = 0; k < count; k++) {
      if (hidden[this.ids[k]]) colors[k * 4 + 3] = 0;
    }
  }

  /**
   * Upload the texels, allocating the texture when its size changed. Returns the
   * bytes uploaded: 0 when the device refused the allocation.
   */
  private uploadTexels(gl: WebGL2RenderingContext): number {
    const staged = this.staged;
    const texture = this.tex;
    if (!staged || !texture) return 0;
    const rows = staged.texels.length / ROW_FLOATS;
    let ok = true;
    bindTextureAt(gl, RECORD_STYLE_TEXTURE_UNIT, texture, () => {
      if (rows === this.rows) {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          RECORD_STYLE_WIDTH,
          rows,
          gl.RGBA,
          gl.FLOAT,
          staged.texels,
        );
      } else {
        drainGlErrors(gl);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          RECORD_STYLE_WIDTH,
          rows,
          0,
          gl.RGBA,
          gl.FLOAT,
          staged.texels,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        ok = gl.getError() === gl.NO_ERROR;
        this.rows = ok ? rows : 0;
      }
    });
    return ok ? staged.texels.byteLength : 0;
  }
}
