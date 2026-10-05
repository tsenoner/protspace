/**
 * The point vertex shader (`POINT_VERTEX_SHADER`) replayed on staged arrays.
 * Suites compare what it hands the rasteriser instead of pixels: equal vertices
 * rasterise to equal frames.
 */
import { RECORD_FLOATS } from '../point-shaders';
import type { StagePointArrays } from '../stage-point';

/** The uniforms the replay honours, each off when null. */
interface VertexUniforms {
  /** The record style table's texels, while `u_recordStyleOn`. */
  recordStyle: Float32Array | null;
  /** While `u_marksOn`: the mark texture by draw index, `u_markPass` and the two opacities. */
  marks: {
    marked: Uint8Array;
    pass: number;
    markedOpacity: number;
    unmarkedOpacity: number;
  } | null;
}

/**
 * Draw index `k`'s colour and form (size, shape, label count), or null when the
 * other mark pass draws it.
 */
export function replayVertex(
  slots: Pick<StagePointArrays, 'colors' | 'sizes' | 'shapes' | 'labelCounts' | 'recordIds'>,
  k: number,
  { recordStyle, marks }: VertexUniforms,
): { rgb: number[]; alpha: number; form: number[] } | null {
  let rgb = Array.from(slots.colors.subarray(k * 4, k * 4 + 3));
  let alpha = slots.colors[k * 4 + 3];
  let form = [slots.sizes[k], slots.shapes[k], slots.labelCounts[k]];
  const record = recordStyle ? slots.recordIds![k] : -1;
  if (recordStyle && record >= 0) {
    const t = recordStyle.subarray(record * RECORD_FLOATS, (record + 1) * RECORD_FLOATS);
    rgb = Array.from(t.subarray(0, 3));
    alpha *= t[3];
    form = Array.from(t.subarray(4, 7));
  }
  if (marks) {
    const marked = marks.marked[k] > 0;
    if (marks.pass >= 0 && marked !== (marks.pass === 1)) return null;
    if (alpha > 0) alpha = Math.fround(marked ? marks.markedOpacity : marks.unmarkedOpacity);
  }
  return { rgb, alpha, form };
}
