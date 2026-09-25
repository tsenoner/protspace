/**
 * Density layer GPU resources and pass sequence.
 *
 * Three passes on a reduced grid: accumulate every visible point additively
 * into an exact-integer RGBA32F target, blur it separably into RGBA16F targets,
 * then composite the blurred result over the scene. The heatmap accumulates
 * colour sums into one field; the contour style accumulates per-category
 * counts, four categories per field, and draws one ring set per category.
 *
 * Deliberately does NOT reuse createLinearFramebuffer: that helper always
 * allocates a DEPTH_COMPONENT16 renderbuffer, which no density target ever
 * reads (about 1 MB at 1080p, 4 MB at retina).
 */

import type { DensityLayerStyle } from '@protspace/utils';
import { createProgramFromSources } from '../shader-utils';
import type { DensityFrameParams } from './density-crossfade';
import {
  DENSITY_ACCUM_VERTEX_SHADER,
  DENSITY_ACCUM_FRAGMENT_SHADER,
  DENSITY_QUAD_VERTEX_SHADER,
  DENSITY_BLUR_FRAGMENT_SHADER,
  DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
  DENSITY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CATEGORY_ACCUM_VERTEX_SHADER,
  DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CATEGORY_CAP,
  DENSITY_CONTOUR_FLOOR,
  DENSITY_CONTOUR_GRID_DIVISOR,
  DENSITY_CONTOUR_LIGHTEN,
  DENSITY_FIELD_UNITS,
} from './density-shaders';

/** Grid side = device pixels / this. */
const DENSITY_PIXEL_RATIO = 2;
/** Longest grid side, so a retina canvas degrades toward quarter resolution. */
const DENSITY_MAX_GRID_SIDE = 1024;

/** Attribute index the density quad VAO is wired for; both quad programs bind it. */
const QUAD_ATTRIB_INDEX = 0;

/** NEUTRAL_VALUE_COLOR (scatter-plot/config.ts), what Other and unmapped values stage as. */
const NEUTRAL_KEY = 0x888888;

export interface ColorTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface BlurLocations {
  source: WebGLUniformLocation | null;
  direction: WebGLUniformLocation | null;
}

interface CameraLocations {
  resolution: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
}

/**
 * Which staged colour owns which contour channel. Built from the staged colour
 * array, never from the legend, so the layer and the points cannot disagree.
 * Slot i lives in field i >> 2, channel i & 3; slots at or past `count` are 0.
 */
export interface SlotPalette {
  /** sRGB as staged, 3 per slot: what the accumulate matches a_color against. */
  readonly keys: Float32Array;
  /** Linear, lightened toward white, 3 per slot: the ring and fill colour. */
  readonly colors: Float32Array;
  /** 0 when no staged point is visible. */
  readonly count: number;
  /** Slot of every colour past the cap, or -1 when every colour has its own. */
  readonly tailSlot: number;
}

/** A contour frame always carries a palette with at least one slot. */
export type DensityPlan =
  | { readonly style: 'heatmap' }
  | { readonly style: 'contour'; readonly palette: SlotPalette };

export interface DensityResources {
  accumProgram: WebGLProgram;
  blurProgram: WebGLProgram;
  /** Same shape, the contour kernel. */
  contourBlurProgram: WebGLProgram;
  compositeProgram: WebGLProgram;
  categoryAccumProgram: WebGLProgram;
  categoryCompositeProgram: WebGLProgram;
  accumLoc: CameraLocations & { gamma: WebGLUniformLocation | null };
  blurLoc: BlurLocations;
  contourBlurLoc: BlurLocations;
  compositeLoc: {
    density: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    scaler: WebGLUniformLocation | null;
  };
  categoryAccumLoc: CameraLocations & {
    slotKeys: WebGLUniformLocation | null;
    slotCount: WebGLUniformLocation | null;
    tailSlot: WebGLUniformLocation | null;
    group: WebGLUniformLocation | null;
  };
  categoryCompositeLoc: {
    /** u_field0..3, bound to DENSITY_FIELD_UNITS in order. */
    fields: (WebGLUniformLocation | null)[];
    slotColors: WebGLUniformLocation | null;
    slotCount: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    contourFloor: WebGLUniformLocation | null;
  };
  /** a_position over the renderer's existing quad buffer, so the composite never
   *  touches attribute state while the point VAO is bound mid-draw. */
  quadVao: WebGLVertexArrayObject;
  /** Null until the first resize. On the grid of the style it was allocated for. */
  accum: ColorTarget | null;
  ping: ColorTarget | null;
  /** Blurred outputs: one for the heatmap, DENSITY_CATEGORY_CAP / 4 for the contour. */
  fields: ColorTarget[];
}

/** Everything the three density passes need for one frame. */
export interface DensityFrame {
  res: DensityResources;
  camera: DensityCamera;
  params: DensityFrameParams;
  plan: DensityPlan;
}

/**
 * Pure. Half the device canvas, long side clamped, then for the contour style
 * DENSITY_CONTOUR_GRID_DIVISOR coarser again per side; never below 1x1.
 */
export function computeDensityGrid(
  canvasWidth: number,
  canvasHeight: number,
  style: DensityLayerStyle = 'heatmap',
): { width: number; height: number } {
  const w = canvasWidth / DENSITY_PIXEL_RATIO;
  const h = canvasHeight / DENSITY_PIXEL_RATIO;
  const s =
    Math.min(1, DENSITY_MAX_GRID_SIDE / Math.max(w, h)) /
    (style === 'contour' ? DENSITY_CONTOUR_GRID_DIVISOR : 1);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

const fieldCount = (style: DensityLayerStyle) =>
  style === 'contour' ? DENSITY_CATEGORY_CAP / 4 : 1;

/**
 * Pure. Every distinct colour among the first `count` staged points with alpha
 * > 0 gets a slot, in order of first appearance. `colors` is the renderer's
 * staged RGBA array in painter order, which runs from the legend's bottom item
 * to its top one, so later slots composite on top as their points do.
 *
 * Past DENSITY_CATEGORY_CAP colours, the CAP - 1 most populous keep a slot and
 * the rest pool into a NEUTRAL_KEY slot 0, which reads as the legend's Other
 * (and merges with it when Other is present).
 */
export function buildSlotPalette(colors: Float32Array, count: number, gamma: number): SlotPalette {
  const entries = new Map<number, { n: number; first: number }>();
  let prevKey = -1;
  let prev: { n: number; first: number } | undefined;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (!(colors[o + 3] > 0)) continue;
    const key =
      (Math.round(colors[o] * 255) << 16) |
      (Math.round(colors[o + 1] * 255) << 8) |
      Math.round(colors[o + 2] * 255);
    // Same-colour points are mostly adjacent in painter order, so this skips the
    // Map lookup for all but the first point of each run.
    if (key !== prevKey) {
      prev = entries.get(key);
      if (!prev) entries.set(key, (prev = { n: 0, first: i }));
      prevKey = key;
    }
    prev!.n++;
  }

  const byFirst = (a: [number, { first: number }], b: [number, { first: number }]) =>
    a[1].first - b[1].first;
  let slots: number[];
  let tailSlot = -1;
  if (entries.size <= DENSITY_CATEGORY_CAP) {
    slots = [...entries].sort(byFirst).map(([key]) => key);
  } else {
    const own = [...entries]
      .filter(([key]) => key !== NEUTRAL_KEY)
      .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
      .slice(0, DENSITY_CATEGORY_CAP - 1)
      .sort(byFirst);
    slots = [NEUTRAL_KEY, ...own.map(([key]) => key)];
    tailSlot = 0;
  }

  const keys = new Float32Array(3 * DENSITY_CATEGORY_CAP);
  const linear = new Float32Array(3 * DENSITY_CATEGORY_CAP);
  slots.forEach((key, s) => {
    for (let c = 0; c < 3; c++) {
      const v = ((key >> (16 - 8 * c)) & 0xff) / 255;
      keys[s * 3 + c] = v;
      linear[s * 3 + c] = v ** gamma + (1 - v ** gamma) * DENSITY_CONTOUR_LIGHTEN;
    }
  });
  return { keys, colors: linear, count: slots.length, tailSlot };
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
 * Compile the six programs, resolve every uniform location, build the quad VAO.
 * Returns null (after cleanup) if any program fails to compile or link.
 *
 * `pointAttribs` are the point program's attribute indices: both accumulation
 * passes draw the point VAO, so their two attributes must be bound to the same
 * indices before they are linked.
 */
export function createDensityResources(
  gl: WebGL2RenderingContext,
  quadBuffer: WebGLBuffer,
  pointAttribs: { dataPosition: number; color: number },
): DensityResources | null {
  const pointBindings = { a_dataPosition: pointAttribs.dataPosition, a_color: pointAttribs.color };
  const quadBindings = { a_position: QUAD_ATTRIB_INDEX };
  const accumProgram = createProgramFromSources(
    gl,
    DENSITY_ACCUM_VERTEX_SHADER,
    DENSITY_ACCUM_FRAGMENT_SHADER,
    pointBindings,
  );
  const blurProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_BLUR_FRAGMENT_SHADER,
    quadBindings,
  );
  const contourBlurProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
    quadBindings,
  );
  const compositeProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_COMPOSITE_FRAGMENT_SHADER,
    quadBindings,
  );
  const categoryAccumProgram = createProgramFromSources(
    gl,
    DENSITY_CATEGORY_ACCUM_VERTEX_SHADER,
    DENSITY_ACCUM_FRAGMENT_SHADER,
    pointBindings,
  );
  const categoryCompositeProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER,
    quadBindings,
  );
  const programs = [
    accumProgram,
    blurProgram,
    contourBlurProgram,
    compositeProgram,
    categoryAccumProgram,
    categoryCompositeProgram,
  ];
  const quadVao = programs.every(Boolean) ? gl.createVertexArray() : null;

  if (
    !accumProgram ||
    !blurProgram ||
    !contourBlurProgram ||
    !compositeProgram ||
    !categoryAccumProgram ||
    !categoryCompositeProgram ||
    !quadVao
  ) {
    for (const p of programs) if (p) gl.deleteProgram(p);
    if (quadVao) gl.deleteVertexArray(quadVao);
    return null;
  }

  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(QUAD_ATTRIB_INDEX);
  gl.vertexAttribPointer(QUAD_ATTRIB_INDEX, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const loc = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const camera = (p: WebGLProgram): CameraLocations => ({
    resolution: loc(p, 'u_resolution'),
    transform: loc(p, 'u_transform'),
    dpr: loc(p, 'u_dpr'),
  });
  return {
    accumProgram,
    blurProgram,
    contourBlurProgram,
    compositeProgram,
    categoryAccumProgram,
    categoryCompositeProgram,
    accumLoc: { ...camera(accumProgram), gamma: loc(accumProgram, 'u_gamma') },
    blurLoc: { source: loc(blurProgram, 'u_source'), direction: loc(blurProgram, 'u_direction') },
    contourBlurLoc: {
      source: loc(contourBlurProgram, 'u_source'),
      direction: loc(contourBlurProgram, 'u_direction'),
    },
    compositeLoc: {
      density: loc(compositeProgram, 'u_density'),
      alpha: loc(compositeProgram, 'u_densityAlpha'),
      scaler: loc(compositeProgram, 'u_densityScaler'),
    },
    categoryAccumLoc: {
      ...camera(categoryAccumProgram),
      slotKeys: loc(categoryAccumProgram, 'u_slotKeys'),
      slotCount: loc(categoryAccumProgram, 'u_slotCount'),
      tailSlot: loc(categoryAccumProgram, 'u_tailSlot'),
      group: loc(categoryAccumProgram, 'u_group'),
    },
    categoryCompositeLoc: {
      fields: DENSITY_FIELD_UNITS.map((_, g) => loc(categoryCompositeProgram, `u_field${g}`)),
      slotColors: loc(categoryCompositeProgram, 'u_slotColors'),
      slotCount: loc(categoryCompositeProgram, 'u_slotCount'),
      alpha: loc(categoryCompositeProgram, 'u_densityAlpha'),
      contourFloor: loc(categoryCompositeProgram, 'u_contourFloor'),
    },
    quadVao,
    accum: null,
    ping: null,
    fields: [],
  };
}

/**
 * Compare-then-reallocate on the grid and field count of `style`, so a style
 * switch frees the other style's targets. False leaves no targets behind.
 */
export function resizeDensityTargets(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  canvasWidth: number,
  canvasHeight: number,
  style: DensityLayerStyle,
): boolean {
  const { width, height } = computeDensityGrid(canvasWidth, canvasHeight, style);
  const want = fieldCount(style);
  if (
    res.accum &&
    res.ping &&
    res.fields.length === want &&
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
  const blurred = () => createColorTarget(gl, width, height, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR);
  const ping = blurred();
  const fields = Array.from({ length: want }, blurred);
  const made = [accum, ping, ...fields];
  if (made.some((t) => !t)) {
    for (const t of made) if (t) destroyColorTarget(gl, t);
    return false;
  }
  res.accum = accum;
  res.ping = ping;
  res.fields = fields as ColorTarget[];
  return true;
}

function destroyDensityTargets(gl: WebGL2RenderingContext, res: DensityResources): void {
  for (const t of [res.accum, res.ping, ...res.fields]) if (t) destroyColorTarget(gl, t);
  res.accum = null;
  res.ping = null;
  res.fields = [];
}

export function destroyDensityResources(gl: WebGL2RenderingContext, res: DensityResources): void {
  destroyDensityTargets(gl, res);
  gl.deleteVertexArray(res.quadVao);
  gl.deleteProgram(res.accumProgram);
  gl.deleteProgram(res.blurProgram);
  gl.deleteProgram(res.contourBlurProgram);
  gl.deleteProgram(res.compositeProgram);
  gl.deleteProgram(res.categoryAccumProgram);
  gl.deleteProgram(res.categoryCompositeProgram);
}

export interface DensityCamera {
  /** Device pixels of the CANVAS, not of the grid. */
  width: number;
  height: number;
  transform: { x: number; y: number; k: number };
  dpr: number;
  gamma: number;
}

/** The CANVAS resolution: clip space is normalised, so the grid is selected by
 *  the viewport alone and the camera stays identical to the point pass. */
function setCamera(gl: WebGL2RenderingContext, loc: CameraLocations, camera: DensityCamera) {
  gl.uniform2f(loc.resolution, camera.width, camera.height);
  gl.uniform3f(loc.transform, camera.transform.x, camera.transform.y, camera.transform.k);
  gl.uniform1f(loc.dpr, camera.dpr);
}

/** One additive fragment per point the bound program keeps, on the grid. */
function accumulate(
  gl: WebGL2RenderingContext,
  accum: ColorTarget,
  program: WebGLProgram,
  pointVao: WebGLVertexArrayObject | null,
  pointCount: number,
  setUniforms: () => void,
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, accum.framebuffer);
  gl.viewport(0, 0, accum.width, accum.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  setUniforms();
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.disable(gl.DEPTH_TEST);
  gl.bindVertexArray(pointVao);
  gl.drawArrays(gl.POINTS, 0, pointCount);
  gl.bindVertexArray(null);
}

/** Separable gaussian, accum -> ping (x) -> out (y). */
function blur(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  program: WebGLProgram,
  loc: BlurLocations,
  accum: ColorTarget,
  ping: ColorTarget,
  out: ColorTarget,
) {
  gl.disable(gl.BLEND);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(loc.source, 0);
  gl.bindVertexArray(res.quadVao);

  gl.bindFramebuffer(gl.FRAMEBUFFER, ping.framebuffer);
  gl.viewport(0, 0, ping.width, ping.height);
  gl.bindTexture(gl.TEXTURE_2D, accum.texture);
  gl.uniform2f(loc.direction, 1 / accum.width, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
  gl.viewport(0, 0, out.width, out.height);
  gl.bindTexture(gl.TEXTURE_2D, ping.texture);
  gl.uniform2f(loc.direction, 0, 1 / accum.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * Passes 1 and 2. Leaves the caller's framebuffer UNBOUND: the caller re-binds
 * its own target and viewport before drawing points.
 *
 * The contour style runs both once per group of four slots in use, through the
 * one accumulate and ping target; fields past the last group are left stale,
 * and the composite never reads their slots.
 */
export function accumulateAndBlurDensity(
  gl: WebGL2RenderingContext,
  frame: DensityFrame,
  pointVao: WebGLVertexArrayObject | null,
  pointCount: number,
): void {
  const { res, camera, plan } = frame;
  const { accum, ping, fields } = res;
  if (!accum || !ping) return;

  if (plan.style === 'heatmap') {
    if (!fields[0]) return;
    accumulate(gl, accum, res.accumProgram, pointVao, pointCount, () => {
      setCamera(gl, res.accumLoc, camera);
      gl.uniform1f(res.accumLoc.gamma, camera.gamma);
    });
    blur(gl, res, res.blurProgram, res.blurLoc, accum, ping, fields[0]);
    return;
  }

  const { palette } = plan;
  const loc = res.categoryAccumLoc;
  const groups = Math.ceil(palette.count / 4);
  for (let g = 0; g < groups && fields[g]; g++) {
    accumulate(gl, accum, res.categoryAccumProgram, pointVao, pointCount, () => {
      // Uniforms persist per program, so the palette and camera go up once.
      if (g === 0) {
        setCamera(gl, loc, camera);
        gl.uniform3fv(loc.slotKeys, palette.keys);
        gl.uniform1i(loc.slotCount, palette.count);
        gl.uniform1i(loc.tailSlot, palette.tailSlot);
      }
      gl.uniform1i(loc.group, g);
    });
    blur(gl, res, res.contourBlurProgram, res.contourBlurLoc, accum, ping, fields[g]);
  }
}

/**
 * Pass 3. Draws into whatever framebuffer and viewport are bound (the linear
 * FBO), between the unselected and the selected point runs. The caller re-binds
 * the point program and VAO afterwards. Never touches texture unit 1.
 */
export function compositeDensity(gl: WebGL2RenderingContext, frame: DensityFrame): void {
  const { res, params, plan } = frame;
  const units = plan.style === 'contour' ? DENSITY_FIELD_UNITS : DENSITY_FIELD_UNITS.slice(0, 1);
  if (res.fields.length < units.length) return;

  if (plan.style === 'heatmap') {
    gl.useProgram(res.compositeProgram);
    gl.uniform1i(res.compositeLoc.density, 0);
    gl.uniform1f(res.compositeLoc.alpha, params.alpha);
    gl.uniform1f(res.compositeLoc.scaler, params.scaler);
  } else {
    const loc = res.categoryCompositeLoc;
    gl.useProgram(res.categoryCompositeProgram);
    units.forEach((unit, g) => gl.uniform1i(loc.fields[g], unit));
    gl.uniform3fv(loc.slotColors, plan.palette.colors);
    gl.uniform1i(loc.slotCount, plan.palette.count);
    gl.uniform1f(loc.alpha, params.alpha);
    // Absolute, in blurred points per grid cell, so it does not move with the
    // frame's scaler: below it nothing is drawn, which keeps a ring off an
    // isolated point and dissolves the lines on zoom-in.
    gl.uniform1f(loc.contourFloor, DENSITY_CONTOUR_FLOOR);
  }
  units.forEach((unit, g) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, res.fields[g].texture);
  });
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(res.quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  // In reverse, so the unit bound last needs no switch and unit 0 ends active.
  for (let g = units.length - 1; g >= 0; g--) {
    if (g < units.length - 1) gl.activeTexture(gl.TEXTURE0 + units[g]);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
