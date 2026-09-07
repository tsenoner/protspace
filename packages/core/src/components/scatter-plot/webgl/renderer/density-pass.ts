/**
 * Density layer GPU resources and pass sequence.
 *
 * Three passes on a half-resolution grid: accumulate every visible point
 * additively into an exact-integer RGBA32F target, blur it separably into two
 * RGBA16F targets, then composite the blurred result over the scene.
 *
 * Deliberately does NOT reuse createLinearFramebuffer: that helper always
 * allocates a DEPTH_COMPONENT16 renderbuffer, which no density target ever
 * reads (about 1 MB at 1080p, 4 MB at retina).
 */

import { createProgramFromSources } from '../shader-utils';
import type { DensityFrameParams } from './density-crossfade';
import {
  DENSITY_ACCUM_VERTEX_SHADER,
  DENSITY_ACCUM_FRAGMENT_SHADER,
  DENSITY_QUAD_VERTEX_SHADER,
  DENSITY_BLUR_FRAGMENT_SHADER,
  DENSITY_COMPOSITE_FRAGMENT_SHADER,
} from './density-shaders';

/** Grid side = device pixels / this. */
const DENSITY_PIXEL_RATIO = 2;
/** Longest grid side, so a retina canvas degrades toward quarter resolution. */
const DENSITY_MAX_GRID_SIDE = 1024;

/** Attribute index the density quad VAO is wired for; both quad programs bind it. */
const QUAD_ATTRIB_INDEX = 0;

export interface ColorTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface AccumLocations {
  resolution: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  gamma: WebGLUniformLocation | null;
}

export interface DensityResources {
  accumProgram: WebGLProgram;
  blurProgram: WebGLProgram;
  compositeProgram: WebGLProgram;
  accumLoc: AccumLocations;
  blurLoc: { source: WebGLUniformLocation | null; direction: WebGLUniformLocation | null };
  compositeLoc: {
    density: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    scaler: WebGLUniformLocation | null;
  };
  /** a_position over the renderer's existing quad buffer, so the composite never
   *  touches attribute state while the point VAO is bound mid-draw. */
  quadVao: WebGLVertexArrayObject;
  /** Null until the first resize. */
  accum: ColorTarget | null;
  ping: ColorTarget | null;
  pong: ColorTarget | null;
}

/** Pure. Half the device canvas, long side clamped, never below 1x1. */
export function computeDensityGrid(
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  const w = canvasWidth / DENSITY_PIXEL_RATIO;
  const h = canvasHeight / DENSITY_PIXEL_RATIO;
  const s = Math.min(1, DENSITY_MAX_GRID_SIDE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Depth-free colour target. Returns null (after deleting both handles) when the
 * framebuffer is incomplete. Completeness is checked HERE and nowhere else: the
 * per-frame passes never ask the driver anything.
 */
export function createColorTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  type: number,
  filter: number,
): ColorTarget | null {
  const framebuffer = gl.createFramebuffer();
  const texture = gl.createTexture();
  if (!framebuffer || !texture) {
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (texture) gl.deleteTexture(texture);
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }
  return { framebuffer, texture, width, height };
}

function destroyColorTarget(gl: WebGL2RenderingContext, t: ColorTarget): void {
  gl.deleteFramebuffer(t.framebuffer);
  gl.deleteTexture(t.texture);
}

/**
 * Compile the three programs, resolve every uniform location, build the quad VAO.
 * Returns null (after cleanup) if any program fails to compile or link.
 *
 * `pointAttribs` are the point program's attribute indices: the accumulation
 * pass draws the point VAO, so its two attributes must be bound to the same
 * indices before it is linked.
 */
export function createDensityResources(
  gl: WebGL2RenderingContext,
  quadBuffer: WebGLBuffer,
  pointAttribs: { dataPosition: number; color: number },
): DensityResources | null {
  const accumProgram = createProgramFromSources(
    gl,
    DENSITY_ACCUM_VERTEX_SHADER,
    DENSITY_ACCUM_FRAGMENT_SHADER,
    { a_dataPosition: pointAttribs.dataPosition, a_color: pointAttribs.color },
  );
  const blurProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_BLUR_FRAGMENT_SHADER,
    { a_position: QUAD_ATTRIB_INDEX },
  );
  const compositeProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_COMPOSITE_FRAGMENT_SHADER,
    { a_position: QUAD_ATTRIB_INDEX },
  );
  const quadVao = accumProgram && blurProgram && compositeProgram ? gl.createVertexArray() : null;

  if (!accumProgram || !blurProgram || !compositeProgram || !quadVao) {
    if (accumProgram) gl.deleteProgram(accumProgram);
    if (blurProgram) gl.deleteProgram(blurProgram);
    if (compositeProgram) gl.deleteProgram(compositeProgram);
    if (quadVao) gl.deleteVertexArray(quadVao);
    return null;
  }

  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(QUAD_ATTRIB_INDEX);
  gl.vertexAttribPointer(QUAD_ATTRIB_INDEX, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    accumProgram,
    blurProgram,
    compositeProgram,
    accumLoc: {
      resolution: gl.getUniformLocation(accumProgram, 'u_resolution'),
      transform: gl.getUniformLocation(accumProgram, 'u_transform'),
      dpr: gl.getUniformLocation(accumProgram, 'u_dpr'),
      gamma: gl.getUniformLocation(accumProgram, 'u_gamma'),
    },
    blurLoc: {
      source: gl.getUniformLocation(blurProgram, 'u_source'),
      direction: gl.getUniformLocation(blurProgram, 'u_direction'),
    },
    compositeLoc: {
      density: gl.getUniformLocation(compositeProgram, 'u_density'),
      alpha: gl.getUniformLocation(compositeProgram, 'u_densityAlpha'),
      scaler: gl.getUniformLocation(compositeProgram, 'u_densityScaler'),
    },
    quadVao,
    accum: null,
    ping: null,
    pong: null,
  };
}

/** Compare-then-reallocate, like resizeLinearFramebuffer. False leaves no targets behind. */
export function resizeDensityTargets(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const { width, height } = computeDensityGrid(canvasWidth, canvasHeight);
  if (
    res.accum &&
    res.ping &&
    res.pong &&
    res.accum.width === width &&
    res.accum.height === height
  ) {
    return true;
  }
  destroyDensityTargets(gl, res);

  // RGBA32F because the accumulation is exact to 2^24, well past the 2M point cap;
  // RGBA16F would stall on dense cells and drift the colour of the core.
  const accum = createColorTarget(gl, width, height, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
  // Write-not-accumulate, so 16F is safe; LINEAR is what the composite upsamples with.
  const ping = createColorTarget(gl, width, height, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);
  const pong = createColorTarget(gl, width, height, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);
  if (!accum || !ping || !pong) {
    for (const t of [accum, ping, pong]) if (t) destroyColorTarget(gl, t);
    return false;
  }
  res.accum = accum;
  res.ping = ping;
  res.pong = pong;
  return true;
}

function destroyDensityTargets(gl: WebGL2RenderingContext, res: DensityResources): void {
  for (const t of [res.accum, res.ping, res.pong]) if (t) destroyColorTarget(gl, t);
  res.accum = null;
  res.ping = null;
  res.pong = null;
}

export function destroyDensityResources(gl: WebGL2RenderingContext, res: DensityResources): void {
  destroyDensityTargets(gl, res);
  gl.deleteVertexArray(res.quadVao);
  gl.deleteProgram(res.accumProgram);
  gl.deleteProgram(res.blurProgram);
  gl.deleteProgram(res.compositeProgram);
}

export interface DensityCamera {
  /** Device pixels of the CANVAS, not of the grid. */
  width: number;
  height: number;
  transform: { x: number; y: number; k: number };
  dpr: number;
  gamma: number;
}

/**
 * Passes 1 and 2. Leaves the caller's framebuffer UNBOUND: the caller re-binds
 * its own target and viewport before drawing points.
 */
export function accumulateAndBlurDensity(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  pointVao: WebGLVertexArrayObject | null,
  pointCount: number,
  camera: DensityCamera,
): void {
  const { accum, ping, pong } = res;
  if (!accum || !ping || !pong) return;

  // Pass 1: one additive fragment per visible point, on the grid.
  gl.bindFramebuffer(gl.FRAMEBUFFER, accum.framebuffer);
  gl.viewport(0, 0, accum.width, accum.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(res.accumProgram);
  // The CANVAS resolution: clip space is normalised, so the grid is selected by
  // the viewport alone and the camera stays identical to the point pass.
  gl.uniform2f(res.accumLoc.resolution, camera.width, camera.height);
  gl.uniform3f(res.accumLoc.transform, camera.transform.x, camera.transform.y, camera.transform.k);
  gl.uniform1f(res.accumLoc.dpr, camera.dpr);
  gl.uniform1f(res.accumLoc.gamma, camera.gamma);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(pointVao);
  gl.drawArrays(gl.POINTS, 0, pointCount);
  gl.bindVertexArray(null);

  // Pass 2: separable gaussian, accum -> ping (x) -> pong (y).
  gl.disable(gl.BLEND);
  gl.useProgram(res.blurProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(res.blurLoc.source, 0);
  gl.bindVertexArray(res.quadVao);

  gl.bindFramebuffer(gl.FRAMEBUFFER, ping.framebuffer);
  gl.viewport(0, 0, ping.width, ping.height);
  gl.bindTexture(gl.TEXTURE_2D, accum.texture);
  gl.uniform2f(res.blurLoc.direction, 1 / accum.width, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, pong.framebuffer);
  gl.viewport(0, 0, pong.width, pong.height);
  gl.bindTexture(gl.TEXTURE_2D, ping.texture);
  gl.uniform2f(res.blurLoc.direction, 0, 1 / accum.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * Pass 3. Draws into whatever framebuffer and viewport are bound (the linear
 * FBO). The caller re-binds the point program and VAO afterwards.
 */
export function compositeDensity(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  params: DensityFrameParams,
): void {
  const { pong } = res;
  if (!pong) return;

  gl.useProgram(res.compositeProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pong.texture);
  gl.uniform1i(res.compositeLoc.density, 0);
  gl.uniform1f(res.compositeLoc.alpha, params.alpha);
  gl.uniform1f(res.compositeLoc.scaler, params.scaler);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(res.quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
