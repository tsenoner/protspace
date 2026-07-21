import type { PointAttribLocations } from '../types';

type PointAttribKey = keyof PointAttribLocations;

interface PointAttributeSpec {
  key: PointAttribKey;
  size: number; // components per vertex (matches createPointVAO sizes)
}

/** Single source of truth for the six point attributes (order + component count). */
export const POINT_ATTRIBUTE_LAYOUT: readonly PointAttributeSpec[] = [
  { key: 'dataPosition', size: 2 },
  { key: 'size', size: 1 },
  { key: 'color', size: 4 },
  { key: 'depth', size: 1 },
  { key: 'labelCount', size: 1 },
  { key: 'shape', size: 1 },
  { key: 'predicted', size: 1 },
] as const;

type PointBuffers = Record<PointAttribKey, WebGLBuffer | null>;

/**
 * Wire the six point attributes into the currently-bound VAO. Caller must have
 * bound the target VAO first; this mirrors the live createPointVAO sequence.
 */
export function setupAttributes(
  gl: WebGL2RenderingContext,
  buffers: PointBuffers,
  locations: PointAttribLocations,
): void {
  for (const { key, size } of POINT_ATTRIBUTE_LAYOUT) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[key]);
    gl.enableVertexAttribArray(locations[key]);
    gl.vertexAttribPointer(locations[key], size, gl.FLOAT, false, 0, 0);
  }
}
