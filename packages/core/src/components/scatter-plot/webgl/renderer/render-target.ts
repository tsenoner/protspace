/**
 * Pure WebGL render-target helpers.
 *
 * These capture the uniform bind/clear, blend-state, and point-draw decision
 * subsets shared across the renderer's draw paths. They are intentionally free
 * of any `WebGLRenderer` dependency so they can be unit-tested against a
 * recording mock GL.
 */

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
