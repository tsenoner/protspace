/**
 * Pure WebGL render-target helpers.
 *
 * These capture the uniform bind/clear, blend-state, and point-draw decision
 * subsets shared across the renderer's draw paths. They are intentionally free
 * of any `WebGLRenderer` dependency so they can be unit-tested against a
 * recording mock GL.
 */

import type { PointUniformLocations } from '../types';

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

/** Per-draw inputs for {@link bindPointDrawState}. */
interface PointDrawStateParams {
  /** Physical target dimensions in device pixels (u_resolution). */
  width: number;
  height: number;
  /** Current zoom transform (u_transform = x, y, k). */
  transform: { x: number; y: number; k: number };
  /** Device pixel ratio (u_dpr). */
  dpr: number;
  /** Effective gamma (u_gamma); 1.0 when the gamma pipeline is unavailable. */
  gamma: number;
  /** Resolved plot-surface color in sRGB, used to mask overlapping marker interiors. */
  knockoutColor: readonly [number, number, number];
  /** Max labels per point (u_maxLabels). */
  maxLabels: number;
  /** Label color texture atlas width in texels. */
  labelTextureWidth: number;
  /** Total length of the label-color texel array (RGBA u8); used to derive atlas height. */
  labelColorDataLength: number;
}

/**
 * Bind the per-frame point-draw GL state shared by the live and export draw
 * paths, immediately before {@link drawPoints}:
 *  1. select the point program,
 *  2. (re)assert the painter's-algorithm blend/depth precondition
 *     ({@link setPointBlendState} — idempotent, so calling it per-draw is
 *     behavior-preserving and removes the live path's dependence on a single
 *     once-at-init call),
 *  3. push the point uniforms (resolution, transform, dpr, gamma, maxLabels,
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

  gl.uniform2f(uniforms.resolution, params.width, params.height);
  gl.uniform3f(uniforms.transform, params.transform.x, params.transform.y, params.transform.k);
  gl.uniform1f(uniforms.dpr, params.dpr);
  gl.uniform1f(uniforms.gamma, params.gamma);
  gl.uniform3f(uniforms.knockoutColor, ...params.knockoutColor);
  gl.uniform1i(uniforms.maxLabels, params.maxLabels);
  gl.uniform2f(
    uniforms.labelTextureSize,
    params.labelTextureWidth,
    params.labelColorDataLength / 4 / params.labelTextureWidth,
  );

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, labelTexture);
  gl.uniform1i(uniforms.labelColors, 1);

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
): void {
  if (selectionActive && selectedStartIndex < pointCount) {
    gl.disable(gl.BLEND);
    if (selectedStartIndex > 0) gl.drawArrays(gl.POINTS, 0, selectedStartIndex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, selectedStartIndex, pointCount - selectedStartIndex);
  } else {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, pointCount);
  }
}
