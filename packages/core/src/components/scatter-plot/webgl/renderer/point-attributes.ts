import type { PointAttribLocations } from '../types';

// The record id and the glide's previous positions are wired by the live
// renderer alone; the export never reads them.
type LiveAttribKey = 'record' | 'prevPosition';
type PointAttribKey = Exclude<keyof PointAttribLocations, LiveAttribKey>;

interface PointAttributeSpec<K> {
  key: K;
  size: number; // components per vertex
}

/** Single source of truth for the seven point attributes both draws wire (order + component count). */
export const POINT_ATTRIBUTE_LAYOUT: readonly PointAttributeSpec<PointAttribKey>[] = [
  { key: 'dataPosition', size: 2 },
  { key: 'size', size: 1 },
  { key: 'color', size: 4 },
  { key: 'depth', size: 1 },
  { key: 'labelCount', size: 1 },
  { key: 'shape', size: 1 },
  { key: 'predicted', size: 1 },
] as const;

/**
 * The live renderer's two, wired after those. `prevPosition` is left disabled,
 * so the shader reads (0, 0), which u_morph 0 leaves out; a projection glide
 * enables it while the points move.
 */
const LIVE_ATTRIBUTE_LAYOUT: readonly (PointAttributeSpec<LiveAttribKey> & {
  enabled: boolean;
})[] = [
  { key: 'record', size: 1, enabled: true },
  { key: 'prevPosition', size: 2, enabled: false },
];

/**
 * Wire the point attributes into the currently-bound VAO, then, given `live`
 * buffers, the live renderer's two. Caller must have bound the target VAO first.
 */
export function setupAttributes(
  gl: WebGL2RenderingContext,
  buffers: Record<PointAttribKey, WebGLBuffer | null>,
  locations: PointAttribLocations,
  live?: Record<LiveAttribKey, WebGLBuffer | null>,
): void {
  for (const { key, size } of POINT_ATTRIBUTE_LAYOUT) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[key]);
    gl.enableVertexAttribArray(locations[key]);
    gl.vertexAttribPointer(locations[key], size, gl.FLOAT, false, 0, 0);
  }
  if (!live) return;
  for (const { key, size, enabled } of LIVE_ATTRIBUTE_LAYOUT) {
    gl.bindBuffer(gl.ARRAY_BUFFER, live[key]);
    if (enabled) gl.enableVertexAttribArray(locations[key]);
    gl.vertexAttribPointer(locations[key], size, gl.FLOAT, false, 0, 0);
  }
}
