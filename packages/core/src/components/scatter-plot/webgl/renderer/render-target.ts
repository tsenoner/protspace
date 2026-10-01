/**
 * Pure WebGL render-target helpers.
 *
 * These capture the uniform bind/clear, blend-state, and point-draw decision
 * subsets shared across the renderer's draw paths. They are intentionally free
 * of any `WebGLRenderer` dependency so they can be unit-tested against a
 * recording mock GL.
 */

import type { PointUniformLocations } from '../types';
import { IDENTITY_RESCALE, type Rescale } from '../../rescale';
import { MAX_LABELS, type LabelAtlasPlan } from './label-atlas-plan';

export const LABEL_ATLAS_TEXTURE_UNIT = 1;
/** The per-record style table's unit, clear of the atlas and the density fields (0, 2-4). */
export const RECORD_STYLE_TEXTURE_UNIT = 7;

/**
 * Binds the given framebuffer (or the default framebuffer when `null`), sets the
 * viewport to the full target, and clears it to transparent black + depth.
 */
export function bindAndClearTarget(
  gl: WebGL2RenderingContext,
  framebufferOrNull: WebGLFramebuffer | null,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebufferOrNull);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

/** Premultiplied-over blend with depth test/mask disabled (painter's-algorithm draw). */
export function setPointBlendState(gl: WebGL2RenderingContext): void {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
}

/** The camera inputs of `CAMERA_TO_CLIP_GLSL`, shared by the point and density draws. */
export interface CameraParams {
  /** Physical target dimensions in device pixels (u_resolution). */
  width: number;
  height: number;
  /** Current zoom transform. */
  transform: { x: number; y: number; k: number };
  /** Device pixel ratio (u_dpr). */
  dpr: number;
  /**
   * Carries the staged positions to the pixels the current scales lay them out
   * at, when the two differ (the plot was resized since they were staged).
   * Omitted, the positions are taken as they are.
   */
  rescale?: Rescale;
}

export type CameraUniformLocations = Pick<
  PointUniformLocations,
  'resolution' | 'transform' | 'dpr'
>;

export function setCameraUniforms(
  gl: WebGL2RenderingContext,
  loc: CameraUniformLocations,
  cam: CameraParams,
): void {
  gl.uniform2f(loc.resolution, cam.width, cam.height);
  // u_transform = (tx, ty, kx, ky): the rescale composed with the zoom here in
  // doubles, so the shader still does one multiply-add per axis. The identity
  // rescale pushes exactly (x, y, k, k).
  const { x, y, k } = cam.transform;
  const r = cam.rescale ?? IDENTITY_RESCALE;
  gl.uniform4f(loc.transform, r.x.offset * k + x, r.y.offset * k + y, r.x.scale * k, r.y.scale * k);
  gl.uniform1f(loc.dpr, cam.dpr);
}

/** Per-draw inputs for {@link bindPointDrawState}. */
interface PointDrawStateParams extends CameraParams {
  pointScale: number;
  /** Effective gamma (u_gamma); 1.0 when the gamma pipeline is unavailable. */
  gamma: number;
  /** Resolved plot-surface color in sRGB, used to mask overlapping marker interiors. */
  knockoutColor: readonly [number, number, number];
  /**
   * Geometry of the allocated label atlas, or null when none is allocated.
   *
   * Passed whole rather than flattened by the caller: the atlas uniforms are
   * only coherent as a set (a stride is meaningless against the wrong texture
   * size), and `null` is the one state that has to disable sampling. Deriving
   * all four here is what stops the two draw paths choosing different fallbacks.
   */
  labelAtlas: LabelAtlasPlan | null;
  /**
   * The per-record style table to draw through, or null (the export, or a stage
   * that kept none): every point then draws with its own staged style.
   */
  recordStyle?: WebGLTexture | null;
}

/**
 * Bind the per-frame point-draw GL state shared by the live and export draw
 * paths, immediately before {@link drawPoints}:
 *  1. select the point program,
 *  2. (re)assert the painter's-algorithm blend/depth precondition
 *     ({@link setPointBlendState} — idempotent, so calling it per-draw is
 *     behavior-preserving and removes the live path's dependence on a single
 *     once-at-init call),
 *  3. push the point uniforms (resolution, transform, dpr, pointScale, gamma, maxLabels,
 *     labelTextureSize) in the exact order both paths used,
 *  4. bind the label-color texture to TEXTURE1 and point the sampler at unit 1,
 *  5. bind the point VAO.
 *
 * The caller issues `drawPoints(...)` next, then unbinds the VAO.
 */
export function bindPointDrawState(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniforms: PointUniformLocations,
  vao: WebGLVertexArrayObject | null,
  labelTexture: WebGLTexture | null,
  params: PointDrawStateParams,
): void {
  gl.useProgram(program);

  // Painter's-algorithm precondition local to the point draw: premultiplied-over
  // blend, depth test/mask off. Idempotent GL-state setup.
  setPointBlendState(gl);

  setCameraUniforms(gl, uniforms, params);
  gl.uniform1f(uniforms.pointScale, params.pointScale);
  gl.uniform1f(uniforms.gamma, params.gamma);
  gl.uniform3f(uniforms.knockoutColor, ...params.knockoutColor);
  // No atlas: capacity 0 makes the shader's pie branch unreachable, so the
  // remaining three describe the 1x1 placeholder that is bound in its place.
  const atlas = params.labelAtlas;
  gl.uniform1i(uniforms.maxLabels, atlas?.stride ?? MAX_LABELS);
  gl.uniform1i(uniforms.labelAtlasCapacity, atlas?.pointCapacity ?? 0);
  gl.uniform2f(uniforms.labelTextureSize, atlas?.width ?? 1, atlas?.height ?? 1);

  // Bound or not, the sampler names its own unit: one left at unit 0 would read
  // the linear framebuffer's texture while drawing into it, which WebGL rejects.
  const recordStyle = params.recordStyle ?? null;
  gl.activeTexture(gl.TEXTURE0 + RECORD_STYLE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, recordStyle);
  gl.uniform1i(uniforms.recordStyle, RECORD_STYLE_TEXTURE_UNIT);
  gl.uniform1i(uniforms.recordStyleOn, recordStyle ? 1 : 0);

  gl.activeTexture(gl.TEXTURE0 + LABEL_ATLAS_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, labelTexture);
  gl.uniform1i(uniforms.labelColors, LABEL_ATLAS_TEXTURE_UNIT);

  gl.bindVertexArray(vao);
}

/**
 * Draws the staged points, choosing the two-pass (selection-active) or
 * single-pass (no selection) strategy.
 *
 * Two-pass: unselected points are drawn with blend OFF (flat fading, no density
 * accumulation) followed by selected points with blend ON (correct MSAA on
 * opaque points). Single-pass: all points with blend ON (density visible).
 */
export function drawPoints(
  gl: WebGL2RenderingContext,
  pointCount: number,
  selectionActive: boolean,
  selectedStartIndex: number,
  afterBasePass?: {
    run: () => void;
    program: WebGLProgram;
    vao: WebGLVertexArrayObject | null;
    labelTexture: WebGLTexture | null;
  },
): void {
  if (selectionActive && selectedStartIndex < pointCount) {
    gl.disable(gl.BLEND);
    if (selectedStartIndex > 0) gl.drawArrays(gl.POINTS, 0, selectedStartIndex);
    if (afterBasePass) {
      afterBasePass.run();
      gl.useProgram(afterBasePass.program);
      gl.bindVertexArray(afterBasePass.vao);
      gl.activeTexture(gl.TEXTURE0 + LABEL_ATLAS_TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, afterBasePass.labelTexture);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, selectedStartIndex, pointCount - selectedStartIndex);
  } else {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, pointCount);
    afterBasePass?.run();
  }
}
