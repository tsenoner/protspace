import { NEUTRAL_VALUE_COLOR } from '../../config';
import { createProgramFromSources } from '../shader-utils';
import {
  DENSITY_ACCUM_FRAGMENT_SHADER,
  DENSITY_QUAD_VERTEX_SHADER,
  DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
  DENSITY_CATEGORY_ACCUM_VERTEX_SHADER,
  DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CATEGORY_CAP,
  DENSITY_CONTOUR_FLOOR,
  DENSITY_CONTOUR_GRID_DIVISOR,
  DENSITY_CONTOUR_LIGHTEN,
  DENSITY_FIELD_UNITS,
} from './density-shaders';

const DENSITY_PIXEL_RATIO = 2;
const DENSITY_MAX_GRID_SIDE = 1024;

const QUAD_ATTRIB_INDEX = 0;

const NEUTRAL_KEY = parseInt(NEUTRAL_VALUE_COLOR.slice(1), 16);

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

export interface SlotPalette {
  readonly keys: Float32Array;
  readonly colors: Float32Array;
  readonly count: number;
  readonly tailSlot: number;
}

export interface DensityResources {
  contourBlurProgram: WebGLProgram;
  categoryAccumProgram: WebGLProgram;
  categoryCompositeProgram: WebGLProgram;
  contourBlurLoc: BlurLocations;
  categoryAccumLoc: CameraLocations & {
    slotKeys: WebGLUniformLocation | null;
    slotCount: WebGLUniformLocation | null;
    tailSlot: WebGLUniformLocation | null;
    group: WebGLUniformLocation | null;
  };
  categoryCompositeLoc: {
    fields: (WebGLUniformLocation | null)[];
    slotColors: WebGLUniformLocation | null;
    slotCount: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
    contourFloor: WebGLUniformLocation | null;
  };
  quadVao: WebGLVertexArrayObject;
  accum: ColorTarget | null;
  ping: ColorTarget | null;
  fields: ColorTarget[];
}

export interface DensityFrame {
  res: DensityResources;
  camera: DensityCamera;
  alpha: number;
  palette: SlotPalette;
}

export function computeDensityGrid(
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  const w = canvasWidth / DENSITY_PIXEL_RATIO;
  const h = canvasHeight / DENSITY_PIXEL_RATIO;
  const s = Math.min(1, DENSITY_MAX_GRID_SIDE / Math.max(w, h)) / DENSITY_CONTOUR_GRID_DIVISOR;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

const FIELD_COUNT = DENSITY_CATEGORY_CAP / 4;

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

  const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
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

export function createDensityResources(
  gl: WebGL2RenderingContext,
  quadBuffer: WebGLBuffer,
  pointAttribs: { dataPosition: number; color: number },
): DensityResources | null {
  const pointBindings = { a_dataPosition: pointAttribs.dataPosition, a_color: pointAttribs.color };
  const quadBindings = { a_position: QUAD_ATTRIB_INDEX };
  const contourBlurProgram = createProgramFromSources(
    gl,
    DENSITY_QUAD_VERTEX_SHADER,
    DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
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
  const programs = [contourBlurProgram, categoryAccumProgram, categoryCompositeProgram];
  const quadVao = programs.every(Boolean) ? gl.createVertexArray() : null;

  if (!contourBlurProgram || !categoryAccumProgram || !categoryCompositeProgram || !quadVao) {
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
    contourBlurProgram,
    categoryAccumProgram,
    categoryCompositeProgram,
    contourBlurLoc: {
      source: loc(contourBlurProgram, 'u_source'),
      direction: loc(contourBlurProgram, 'u_direction'),
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

export function resizeDensityTargets(
  gl: WebGL2RenderingContext,
  res: DensityResources,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const { width, height } = computeDensityGrid(canvasWidth, canvasHeight);
  const want = FIELD_COUNT;
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
  gl.deleteProgram(res.contourBlurProgram);
  gl.deleteProgram(res.categoryAccumProgram);
  gl.deleteProgram(res.categoryCompositeProgram);
}

export interface DensityCamera {
  width: number;
  height: number;
  transform: { x: number; y: number; k: number };
  dpr: number;
}

function setCamera(gl: WebGL2RenderingContext, loc: CameraLocations, camera: DensityCamera) {
  gl.uniform2f(loc.resolution, camera.width, camera.height);
  gl.uniform3f(loc.transform, camera.transform.x, camera.transform.y, camera.transform.k);
  gl.uniform1f(loc.dpr, camera.dpr);
}

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

export function accumulateAndBlurDensity(
  gl: WebGL2RenderingContext,
  frame: DensityFrame,
  pointVao: WebGLVertexArrayObject | null,
  pointCount: number,
): void {
  const { res, camera, palette } = frame;
  const { accum, ping, fields } = res;
  if (!accum || !ping) return;

  const loc = res.categoryAccumLoc;
  const groups = Math.ceil(palette.count / 4);
  for (let g = 0; g < groups && fields[g]; g++) {
    accumulate(gl, accum, res.categoryAccumProgram, pointVao, pointCount, () => {
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

export function compositeDensity(gl: WebGL2RenderingContext, frame: DensityFrame): void {
  const { res, alpha, palette } = frame;
  const units = DENSITY_FIELD_UNITS;
  if (res.fields.length < units.length) return;

  const loc = res.categoryCompositeLoc;
  gl.useProgram(res.categoryCompositeProgram);
  units.forEach((unit, g) => gl.uniform1i(loc.fields[g], unit));
  gl.uniform3fv(loc.slotColors, palette.colors);
  gl.uniform1i(loc.slotCount, palette.count);
  gl.uniform1f(loc.alpha, alpha);
  gl.uniform1f(loc.contourFloor, DENSITY_CONTOUR_FLOOR);
  units.forEach((unit, g) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, res.fields[g].texture);
  });
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(res.quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
  for (let g = units.length - 1; g >= 0; g--) {
    if (g < units.length - 1) gl.activeTexture(gl.TEXTURE0 + units[g]);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}
