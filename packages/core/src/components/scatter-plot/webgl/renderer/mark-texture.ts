/**
 * The texture the GPU draws `PointMarks` from: a byte per staged point, by draw
 * index, in rows as wide as the device allows. `staged` is its copy, so a new
 * selection uploads only the rows it changed.
 */
import type { PointMarks } from '../types';
import { maxMarkedPoints } from './device-limits';
import { MARK_TEXTURE_UNIT, bindTextureAt } from './texture-units';

/** The staged points the marks are written over, by draw index. */
interface StagedPoints {
  /** The slot drawn at each draw index. */
  order: Uint32Array;
  count: number;
  /** Staged RGBA; a point staged at alpha 0 is hidden. */
  colors: Float32Array;
  /** The record each draw index reads, and the records the table hides, if points draw through one. */
  recordIds: Float32Array;
  hidden: readonly boolean[] | undefined;
}

export class MarkTexture {
  texture: WebGLTexture | null = null;
  staged = new Uint8Array(0);
  /** Draw indices `[first, end)` around every drawn marked point; null with none drawn. */
  range: { first: number; end: number } | null = null;
  /** Set when staging or a restyle moved or hid points since the marks were applied. */
  stale = false;
  /** Whether the device refused the texture of the current capacity. */
  refused = false;
  /** The row width the texture was allocated with. */
  private width = 0;

  create(gl: WebGL2RenderingContext): void {
    this.texture = gl.createTexture();
  }

  delete(gl: WebGL2RenderingContext): void {
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = null;
  }

  /** The context is gone, and the texture with it. */
  reset(): void {
    this.texture = null;
    this.range = null;
  }

  /** Whether `capacity` points draw their marks from it: a texel each, and the device took it. */
  fits(capacity: number, maxTextureSize: number): boolean {
    return capacity <= maxMarkedPoints(maxTextureSize) && !this.refused;
  }

  /**
   * Allocate it for `capacity` points, with nothing marked, in rows `width`
   * texels wide. Empty when the points do not fit, which frees what a smaller
   * capacity held. Expects the error flag clear, so the check answers for this
   * allocation alone.
   */
  allocate(gl: WebGL2RenderingContext, capacity: number, width: number): void {
    const rows = Math.ceil(capacity / width);
    const fits = capacity <= maxMarkedPoints(width);
    this.width = width;
    this.staged = new Uint8Array(fits ? rows * width : 0);
    bindTextureAt(gl, MARK_TEXTURE_UNIT, this.texture, () => {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        width,
        fits ? rows : 0,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.refused = gl.getError() !== gl.NO_ERROR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    });
  }

  /**
   * Write `marks` over `points` in draw order, upload the rows that changed, and
   * find the draw range of the drawn marked points. Returns the bytes uploaded.
   */
  apply(gl: WebGL2RenderingContext | null, marks: PointMarks | null, points: StagedPoints): number {
    this.stale = false;
    this.range = null;
    if (!marks || !gl) return 0;
    const staged = this.staged;
    const { slots } = marks;
    const { order, colors, recordIds, hidden } = points;
    let firstChanged = -1;
    let lastChanged = -1;
    let first = -1;
    let end = -1;
    const count = Math.min(points.count, staged.length);
    for (let k = 0; k < count; k++) {
      const mark = slots[order[k]] ? 1 : 0;
      if (mark !== staged[k]) {
        staged[k] = mark;
        if (firstChanged < 0) firstChanged = k;
        lastChanged = k;
      }
      // Drawn: staged unhidden, and not hidden through the table.
      if (mark && colors[k * 4 + 3] > 0 && !hidden?.[recordIds[k]]) {
        if (first < 0) first = k;
        end = k + 1;
      }
    }
    if (first >= 0) this.range = { first, end };
    if (firstChanged < 0) return 0;
    const width = this.width;
    const fromRow = Math.floor(firstChanged / width);
    const rows = Math.floor(lastChanged / width) + 1 - fromRow;
    bindTextureAt(gl, MARK_TEXTURE_UNIT, this.texture, () =>
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        fromRow,
        width,
        rows,
        gl.RED,
        gl.UNSIGNED_BYTE,
        staged,
        fromRow * width,
      ),
    );
    return rows * width;
  }
}
