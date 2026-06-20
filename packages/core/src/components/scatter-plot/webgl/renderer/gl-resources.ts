import type { FramebufferResources } from '../types';
import { destroyFramebuffer } from './framebuffer';

/**
 * Holder for the GPU handles a WebGLRenderer owns. Centralizes the resource
 * inventory that was previously enumerated independently in ensureGL (create*),
 * isRendererStateValid (is*), dispose (delete*), and resetRendererState (null).
 *
 * Dirty-flag / signature / cache state is intentionally NOT held here — those
 * stay on WebGLRenderer (labelTextureInitialized, gammaPipelineAvailable,
 * warnedGammaFallback, buffersInitialized, currentPointCount, positionsDirty,
 * stylesDirty, lastDataSignature, lastStyleSignature, renderedPointIds,
 * sortedDataRef, and the WebGL2 context itself).
 */
export class GLResources {
  pointProgram: WebGLProgram | null = null;
  gammaCorrectionProgram: WebGLProgram | null = null;
  pointVao: WebGLVertexArrayObject | null = null;

  dataPositionBuffer: WebGLBuffer | null = null;
  sizeBuffer: WebGLBuffer | null = null;
  colorBuffer: WebGLBuffer | null = null;
  depthBuffer: WebGLBuffer | null = null;
  labelCountBuffer: WebGLBuffer | null = null;
  shapeBuffer: WebGLBuffer | null = null;
  quadBuffer: WebGLBuffer | null = null;

  labelColorTexture: WebGLTexture | null = null;
  linearFramebuffer: FramebufferResources | null = null;

  /** The 6 attribute buffers + quad buffer, in VAO-binding order. */
  private get vertexBuffers(): WebGLBuffer[] {
    return [
      this.dataPositionBuffer,
      this.sizeBuffer,
      this.colorBuffer,
      this.depthBuffer,
      this.labelCountBuffer,
      this.shapeBuffer,
      this.quadBuffer,
    ].filter((b): b is WebGLBuffer => b !== null);
  }

  /**
   * Allocate the 6 attribute buffers, the quad buffer, and the label texture.
   * (The VAO is built by the renderer's `createPointVAO` and the two programs by
   * the shader-init methods; those assign onto this holder after creation.)
   */
  createAll(gl: WebGL2RenderingContext): void {
    this.dataPositionBuffer = gl.createBuffer();
    this.sizeBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.depthBuffer = gl.createBuffer();
    this.labelCountBuffer = gl.createBuffer();
    this.shapeBuffer = gl.createBuffer();
    this.quadBuffer = gl.createBuffer();
    this.labelColorTexture = gl.createTexture();
  }

  /**
   * Byte-faithful mirror of the original `isRendererStateValid` resource checks.
   * IMPORTANT (behavior-preserving): the original deliberately did NOT validate
   * `quadBuffer` or `linearFramebuffer` — `ensureGL` reuses the context unless one
   * of these specific handles is dead. Do not add checks here: that would change
   * when `resetRendererState()` fires (an observable behavior change, out of scope
   * for the F-61 extraction).
   */
  validate(gl: WebGL2RenderingContext): boolean {
    if (!this.pointProgram || !gl.isProgram(this.pointProgram)) return false;
    if (this.pointVao && !gl.isVertexArray(this.pointVao)) return false;
    if (this.dataPositionBuffer && !gl.isBuffer(this.dataPositionBuffer)) return false;
    if (this.sizeBuffer && !gl.isBuffer(this.sizeBuffer)) return false;
    if (this.colorBuffer && !gl.isBuffer(this.colorBuffer)) return false;
    if (this.depthBuffer && !gl.isBuffer(this.depthBuffer)) return false;
    if (this.labelCountBuffer && !gl.isBuffer(this.labelCountBuffer)) return false;
    if (this.shapeBuffer && !gl.isBuffer(this.shapeBuffer)) return false;
    if (this.labelColorTexture && !gl.isTexture(this.labelColorTexture)) return false;
    return true;
  }

  /**
   * Delete every owned GPU handle, including the linear framebuffer (via
   * `destroyFramebuffer`). Null-safe: handles that were never allocated are
   * skipped. Deletion order matches the original `dispose()` byte-for-byte: VAO,
   * then the attribute + quad buffers, then the label texture, then the point and
   * gamma programs, and finally the linear framebuffer (which is also nulled).
   * The order is immaterial to GL correctness (handles are independent) but is
   * kept identical to avoid any behavioral drift from the extraction.
   */
  deleteAll(gl: WebGL2RenderingContext): void {
    if (this.pointVao) gl.deleteVertexArray(this.pointVao);
    for (const buf of this.vertexBuffers) gl.deleteBuffer(buf);
    if (this.labelColorTexture) gl.deleteTexture(this.labelColorTexture);
    if (this.pointProgram) gl.deleteProgram(this.pointProgram);
    if (this.gammaCorrectionProgram) gl.deleteProgram(this.gammaCorrectionProgram);
    if (this.linearFramebuffer) {
      destroyFramebuffer(gl, this.linearFramebuffer);
      this.linearFramebuffer = null;
    }
  }

  /** Null every handle without touching gl (context-loss path). */
  reset(): void {
    this.pointProgram = null;
    this.gammaCorrectionProgram = null;
    this.pointVao = null;
    this.dataPositionBuffer = null;
    this.sizeBuffer = null;
    this.colorBuffer = null;
    this.depthBuffer = null;
    this.labelCountBuffer = null;
    this.shapeBuffer = null;
    this.quadBuffer = null;
    this.labelColorTexture = null;
    this.linearFramebuffer = null;
  }
}
