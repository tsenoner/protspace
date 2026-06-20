import type { FramebufferResources } from '../types';

/**
 * Allocate a LINEAR-filtered RGBA16F/HALF_FLOAT color target plus a
 * DEPTH_COMPONENT16 renderbuffer, attach them to a framebuffer, and validate
 * completeness. Returns the resource set, or `null` (after deleting all three
 * resources) if any allocation fails or the framebuffer is incomplete.
 *
 * Pure helper: holds no renderer state and does not log. Callers decide how to
 * react to a `null` result.
 */
export function createLinearFramebuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): FramebufferResources | null {
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  const depthBuffer = gl.createRenderbuffer();
  if (!framebuffer || !texture || !depthBuffer) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.deleteRenderbuffer(depthBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    return null;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  return { framebuffer, texture, depthBuffer, width, height };
}

/**
 * Delete the framebuffer, color texture, and depth renderbuffer held by `fb`.
 * Null-safe with respect to the resource set: pass a valid `FramebufferResources`.
 */
export function destroyFramebuffer(gl: WebGL2RenderingContext, fb: FramebufferResources): void {
  gl.deleteFramebuffer(fb.framebuffer);
  gl.deleteTexture(fb.texture);
  gl.deleteRenderbuffer(fb.depthBuffer);
}
