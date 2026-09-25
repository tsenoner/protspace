/**
 * Blur and composite adapted from Embedding Atlas (Copyright (c) 2025 Apple Inc.
 * Licensed under MIT License), packages/component/src/lib/webgl2_renderer/gaussian_blur.ts
 * and paint_density_map.ts at ccd4eee^.
 */

export const DENSITY_SIGMA_GRID_PX = 2;
export const DENSITY_BLUR_RADIUS = Math.ceil(3 * DENSITY_SIGMA_GRID_PX);

export function gaussianWeights(sigma: number, radius: number): number[] {
  const w: number[] = [];
  for (let i = -radius; i <= radius; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

export const DENSITY_ACCUM_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_dataPosition;
in vec4 a_color;

uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_dpr;
uniform float u_gamma;

out vec4 v_accum;

void main() {
  float w = a_color.a > 0.0 ? 1.0 : 0.0;
  if (w == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    v_accum = vec4(0.0);
    return;
  }

  vec2 cssTransformed = a_dataPosition * u_transform.z + u_transform.xy;
  vec2 physicalPos = cssTransformed * u_dpr;
  vec2 clipSpace = (physicalPos / u_resolution) * 2.0 - 1.0;

  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  gl_PointSize = 1.0;

  v_accum = vec4(pow(max(a_color.rgb, vec3(0.0)), vec3(u_gamma)) * w, w);
}`;

export const DENSITY_ACCUM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_accum;
out vec4 fragColor;

void main() {
  fragColor = v_accum;
}`;

export const DENSITY_QUAD_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) * 0.5;
}`;

function blurSource(sigma: number, radius: number): string {
  const taps = gaussianWeights(sigma, radius)
    .map(
      (w, i) =>
        `  c += texture(u_source, v_texCoord + u_direction * ${(i - radius).toFixed(1)}) * ${w.toFixed(8)};`,
    )
    .join('\n');
  return `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_direction;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = vec4(0.0);
${taps}
  fragColor = c;
}`;
}

export const DENSITY_BLUR_FRAGMENT_SHADER = blurSource(DENSITY_SIGMA_GRID_PX, DENSITY_BLUR_RADIUS);

export const DENSITY_CATEGORY_CAP = 16;
export const DENSITY_FIELD_UNITS = [0, 2, 3, 4] as const;

export const DENSITY_CONTOUR_GRID_DIVISOR = 2;

export const DENSITY_CONTOUR_SIGMA_GRID_PX = 6 / DENSITY_CONTOUR_GRID_DIVISOR;
export const DENSITY_CONTOUR_BLUR_RADIUS = Math.ceil(3 * DENSITY_CONTOUR_SIGMA_GRID_PX);
export const DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER = blurSource(
  DENSITY_CONTOUR_SIGMA_GRID_PX,
  DENSITY_CONTOUR_BLUR_RADIUS,
);

export const DENSITY_CONTOUR_MIN_POINTS = 5;
const DENSITY_ONE_POINT_PEAK =
  gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
    DENSITY_CONTOUR_BLUR_RADIUS
  ] ** 2;
export const DENSITY_CONTOUR_FLOOR = DENSITY_CONTOUR_MIN_POINTS * DENSITY_ONE_POINT_PEAK;

const DENSITY_CONTOUR_LEVELS = 4;
const DENSITY_CONTOUR_SPACING = 1.0;
const DENSITY_CONTOUR_LINE_PX = 2;
export const DENSITY_CONTOUR_LIGHTEN = 0.15;
const DENSITY_CONTOUR_FILL_CORE = 0.8;
const DENSITY_CONTOUR_FILL_OUTER = DENSITY_CONTOUR_FILL_CORE / 4;
const DENSITY_CONTOUR_MAX_SLOPE = 1.0;

const SLOT_MATCH_TOLERANCE = '0.5 / 255.0';

export const DENSITY_CATEGORY_ACCUM_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_dataPosition;
in vec4 a_color;

uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_dpr;
uniform vec3 u_slotKeys[${DENSITY_CATEGORY_CAP}];
uniform int u_slotCount;
uniform int u_tailSlot;
uniform int u_group;

out vec4 v_accum;

int slotOf(vec3 c) {
  for (int i = 0; i < ${DENSITY_CATEGORY_CAP}; i++) {
    if (i >= u_slotCount) break;
    if (all(lessThan(abs(c - u_slotKeys[i]), vec3(${SLOT_MATCH_TOLERANCE})))) return i;
  }
  return u_tailSlot;
}

void main() {
  int slot = a_color.a > 0.0 ? slotOf(a_color.rgb) : -1;
  int local = slot - 4 * u_group;
  if (slot < 0 || local < 0 || local > 3) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    v_accum = vec4(0.0);
    return;
  }

  vec2 cssTransformed = a_dataPosition * u_transform.z + u_transform.xy;
  vec2 physicalPos = cssTransformed * u_dpr;
  vec2 clipSpace = (physicalPos / u_resolution) * 2.0 - 1.0;

  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  gl_PointSize = 1.0;

  v_accum = vec4(equal(ivec4(local), ivec4(0, 1, 2, 3)));
}`;

/**
 * Unrolled at module load, and every slot block is guarded by a UNIFORM
 * condition, so control flow stays uniform and fwidth stays defined.
 */
function categoryCompositeSource(cap: number): string {
  const fields = cap / 4;
  const channel = (i: number) => `d${i >> 2}.${'xyzw'[i & 3]}`;
  const samplers = Array.from({ length: fields }, (_, g) => `uniform sampler2D u_field${g};`);
  const fetches = Array.from(
    { length: fields },
    (_, g) => `  vec4 d${g} = texture(u_field${g}, v_texCoord);`,
  );
  const dominant = Array.from(
    { length: cap },
    (_, i) =>
      `  if (u_slotCount > ${i} && ${channel(i)} > best) { best = ${channel(i)}; bestColor = u_slotColors[${i}]; }`,
  );
  const lines = Array.from(
    { length: cap },
    (_, i) => `  if (u_slotCount > ${i}) acc = over(ring(${channel(i)}), u_slotColors[${i}], acc);`,
  );
  return `#version 300 es
precision highp float;

${samplers.join('\n')}
uniform vec3 u_slotColors[${cap}];
uniform int u_slotCount;
uniform float u_densityAlpha;
uniform float u_contourFloor;

in vec2 v_texCoord;
out vec4 fragColor;

float level(float n) {
  return log2(max(n, 1e-8) / u_contourFloor) * ${DENSITY_CONTOUR_SPACING.toFixed(1)} - 0.5;
}

float ring(float n) {
  float o = level(n);
  float f = fract(o);
  float w = fwidth(o);
  float line = 1.0 - smoothstep(0.0, max(w * ${DENSITY_CONTOUR_LINE_PX.toFixed(2)}, 1e-6), min(f, 1.0 - f));
  return line * step(u_contourFloor, n) * step(o, ${(DENSITY_CONTOUR_LEVELS + 0.5).toFixed(1)})
       * step(w, ${DENSITY_CONTOUR_MAX_SLOPE.toFixed(1)});
}

vec4 over(float a, vec3 c, vec4 acc) {
  return vec4(c * a, a) + acc * (1.0 - a);
}

void main() {
${fetches.join('\n')}
  float best = 0.0;
  vec3 bestColor = vec3(0.0);
${dominant.join('\n')}
  float coats = clamp(floor(level(best)) + 1.0, 0.0, ${(DENSITY_CONTOUR_LEVELS + 1).toFixed(1)});
  float fill = step(0.5, coats)
    * mix(${DENSITY_CONTOUR_FILL_OUTER.toFixed(2)}, ${DENSITY_CONTOUR_FILL_CORE.toFixed(2)},
          (coats - 1.0) / ${DENSITY_CONTOUR_LEVELS.toFixed(1)});
  vec4 acc = vec4(bestColor * fill, fill);
${lines.join('\n')}
  fragColor = acc * u_densityAlpha;
}`;
}

export const DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER =
  categoryCompositeSource(DENSITY_CATEGORY_CAP);

export const DENSITY_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_density;
uniform float u_densityAlpha;
uniform float u_densityScaler;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 d = texture(u_density, v_texCoord);
  float n = d.a;
  vec3 mean = n > 0.0 ? d.rgb / n : vec3(0.0);
  float alpha = clamp(n * u_densityScaler, 0.0, 1.0) * u_densityAlpha;
  fragColor = vec4(mean * alpha, alpha);
}`;
