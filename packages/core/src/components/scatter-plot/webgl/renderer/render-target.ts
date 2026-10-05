/**
 * Pure WebGL render-target helpers.
 *
 * These capture the uniform bind/clear, blend-state, and point-draw decision
 * subsets shared across the renderer's draw paths. They are intentionally free
 * of any `WebGLRenderer` dependency so they can be unit-tested against a
 * recording mock GL.
 */

import type { PointUniformLocations } from '../types';
import { IDENTITY_RESCALE, type Rescale } from './rescale';
import { MAX_LABELS, type LabelAtlasPlan } from './label-atlas-plan';
import {
  LABEL_ATLAS_TEXTURE_UNIT,
  MARK_TEXTURE_UNIT,
  RECORD_STYLE_TEXTURE_UNIT,
} from './texture-units';

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
  /**
   * How far the points still are from their staged positions towards the ones a
   * projection switch drew (u_morph, see MORPH_GLSL). Omitted, it is 0: the
   * staged positions, which is all the export ever draws.
   */
  morph?: number;
}

export type CameraUniformLocations = Pick<
  PointUniformLocations,
  'resolution' | 'transform' | 'dpr' | 'morph'
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
  gl.uniform1f(loc.morph, cam.morph ?? 0);
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
  /**
   * The mark texture and the opacities of marked and unmarked points, or null
   * (the export, or nothing marked): every point then keeps its staged opacity.
   * Drawn by {@link drawMarkedPoints}.
   */
  marks?: { texture: WebGLTexture | null; marked: number; unmarked: number } | null;
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

  // Clamped as staging clamps an opacity, so a marked point draws the alpha staging would give it.
  const marks = params.marks ?? null;
  gl.activeTexture(gl.TEXTURE0 + MARK_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, marks?.texture ?? null);
  gl.uniform1i(uniforms.marks, MARK_TEXTURE_UNIT);
  gl.uniform1i(uniforms.marksOn, marks ? 1 : 0);
  if (marks) {
    gl.uniform1f(uniforms.markedOpacity, Math.min(1, Math.max(0, marks.marked)));
    gl.uniform1f(uniforms.unmarkedOpacity, Math.min(1, Math.max(0, marks.unmarked)));
  }

  gl.activeTexture(gl.TEXTURE0 + LABEL_ATLAS_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, labelTexture);
  gl.uniform1i(uniforms.labelColors, LABEL_ATLAS_TEXTURE_UNIT);

  gl.bindVertexArray(vao);
}

/** A draw (the density composite) that goes between the base and the selected points. */
interface AfterBasePass {
  run: () => void;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject | null;
  labelTexture: WebGLTexture | null;
}

/** Run the pass between the base and selected draws, then bind the point draw back. */
function runBetweenPasses(gl: WebGL2RenderingContext, afterBasePass: AfterBasePass): void {
  afterBasePass.run();
  gl.useProgram(afterBasePass.program);
  gl.bindVertexArray(afterBasePass.vao);
  gl.activeTexture(gl.TEXTURE0 + LABEL_ATLAS_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, afterBasePass.labelTexture);
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
  afterBasePass?: AfterBasePass,
): void {
  if (selectionActive && selectedStartIndex < pointCount) {
    gl.disable(gl.BLEND);
    if (selectedStartIndex > 0) gl.drawArrays(gl.POINTS, 0, selectedStartIndex);
    if (afterBasePass) runBetweenPasses(gl, afterBasePass);
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

/**
 * {@link drawPoints} for points whose marks the vertex shader applies (see
 * `bindPointDrawState`'s `marks`). With a marked point drawn, `marked` holds the
 * draw indices `[first, end)` around every one: the unmarked points draw first
 * with blend OFF, then the marked ones with blend ON, as staging orders a
 * selection after the rest. Without one, every point draws in one blended pass.
 */
export function drawMarkedPoints(
  gl: WebGL2RenderingContext,
  markPass: WebGLUniformLocation | null,
  pointCount: number,
  marked: { first: number; end: number } | null,
  afterBasePass?: AfterBasePass,
): void {
  if (marked) {
    gl.uniform1i(markPass, 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.POINTS, 0, pointCount);
    if (afterBasePass) runBetweenPasses(gl, afterBasePass);
    gl.uniform1i(markPass, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, marked.first, marked.end - marked.first);
  } else {
    gl.uniform1i(markPass, -1);
    drawPoints(gl, pointCount, false, pointCount, afterBasePass);
  }
}
