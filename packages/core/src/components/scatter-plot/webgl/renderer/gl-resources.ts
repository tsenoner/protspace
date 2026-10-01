import type { FramebufferResources } from '../types';
import { destroyFramebuffer } from './framebuffer';
import { destroyDensityResources, type DensityResources } from './density-pass';

/**
 * Holder for the GPU handles a WebGLRenderer owns. Centralizes the resource
 * inventory that was previously enumerated independently in ensureGL (create*),
 * dispose (delete*), and resetRendererState (null).
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
  predictedBuffer: WebGLBuffer | null = null;
  recordBuffer: WebGLBuffer | null = null;
  quadBuffer: WebGLBuffer | null = null;

  labelColorTexture: WebGLTexture | null = null;
  recordStyleTexture: WebGLTexture | null = null;
  linearFramebuffer: FramebufferResources | null = null;
  density: DensityResources | null = null;

  /** The 6 attribute buffers + quad buffer, in VAO-binding order. */
  private get vertexBuffers(): WebGLBuffer[] {
    return [
      this.dataPositionBuffer,
      this.sizeBuffer,
      this.colorBuffer,
      this.depthBuffer,
      this.labelCountBuffer,
      this.shapeBuffer,
      this.predictedBuffer,
      this.recordBuffer,
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
    this.predictedBuffer = gl.createBuffer();
    this.recordBuffer = gl.createBuffer();
    this.quadBuffer = gl.createBuffer();
    this.labelColorTexture = gl.createTexture();
    this.recordStyleTexture = gl.createTexture();
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
    if (this.recordStyleTexture) gl.deleteTexture(this.recordStyleTexture);
    if (this.pointProgram) gl.deleteProgram(this.pointProgram);
    if (this.gammaCorrectionProgram) gl.deleteProgram(this.gammaCorrectionProgram);
    if (this.linearFramebuffer) {
      destroyFramebuffer(gl, this.linearFramebuffer);
      this.linearFramebuffer = null;
    }
    this.destroyDensity(gl);
  }

  /** Delete the density programs, VAO and targets, if any, and null the field. */
  destroyDensity(gl: WebGL2RenderingContext): void {
    if (this.density) {
      destroyDensityResources(gl, this.density);
      this.density = null;
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
    this.predictedBuffer = null;
    this.recordBuffer = null;
    this.quadBuffer = null;
    this.labelColorTexture = null;
    this.recordStyleTexture = null;
    this.linearFramebuffer = null;
    this.density = null;
  }
}
