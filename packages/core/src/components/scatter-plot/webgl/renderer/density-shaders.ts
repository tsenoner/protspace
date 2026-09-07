/**
 * Shader sources for the density layer: accumulate, separable blur, composite.
 *
 * Blur and composite adapted from Embedding Atlas (Copyright (c) 2025 Apple Inc.
 * Licensed under MIT License), packages/component/src/lib/webgl2_renderer/gaussian_blur.ts
 * and paint_density_map.ts at ccd4eee^.
 *
 * All three are static strings: the kernel is baked at module load, so no frame
 * ever recompiles a program or generates GLSL.
 */

/*
 * Colour policy: what a heatmap pixel means, and what it does not.
 *
 * Per cell the colour is the kernel-weighted MEAN of the linearised category
 * colours of the visible points in it, sum(c * w) / sum(w). The blur runs over
 * numerator and denominator alike, so the ratio after blurring is still a
 * weighted mean and the fringe has no dark rim. A pure cell matches its legend
 * swatch exactly; a mixed cell shows a colour that is NOT in the legend. The
 * control-bar tooltip says so: "mixed regions show the average colour".
 *
 * NA (NEUTRAL_VALUE_COLOR, '#888888', scatter-plot/config.ts) is just another
 * colour in the mean, and greys out the regions it mixes into. Accepted as
 * honest: the layer does not pretend NA is absent.
 *
 * Selection and highlight change only ALPHA, never colour (visibility-model.ts),
 * and the accumulation weight is binary, so clicking a point changes neither the
 * colour nor the brightness of the heatmap. Selected and hovered points are
 * lifted into the second drawPoints run and drawn on top of it instead.
 *
 * Hidden legend categories reach the GPU as a_color.a = 0 through the colour-only
 * re-stage, and that is the same buffer the point pass reads, so the layer and
 * the legend cannot disagree. Query filters cull rows before PlotData exists, so
 * filtered points are absent from both.
 *
 * A multi-label point contributes pointColors[0] only (stage-point.ts): pie
 * slices live in the label atlas, which this pass never samples. Numeric
 * annotations colour by bin, and the mean of two neighbouring bin colours along
 * a gradient is a plausible in-between colour, the one case where the mean is
 * also legible.
 *
 * If a real dataset averages to mud, the upgrade is not a category cap but
 * order-independent coverage per category, sum(log(1 - alpha)) on a second
 * attachment via gl.drawBuffers: one more target and one more draw per category,
 * with no change to the shapes here.
 */

/** Blur sigma, in density grid cells. */
export const DENSITY_SIGMA_GRID_PX = 2;
/** Kernel half-width: ceil(3 * sigma) = 6, so 2 * 6 + 1 = 13 taps per pass. */
export const DENSITY_BLUR_RADIUS = Math.ceil(3 * DENSITY_SIGMA_GRID_PX);

/** Normalised 1-D gaussian, 2 * radius + 1 taps. */
export function gaussianWeights(sigma: number, radius: number): number[] {
  const w: number[] = [];
  for (let i = -radius; i <= radius; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * One vertex per staged point, rasterised as a single grid cell.
 *
 * The three camera lines are byte-identical to POINT_VERTEX_SHADER's and are
 * fed the same u_resolution (the canvas, not the grid), because clip space is
 * normalised: the grid is selected purely by gl.viewport. A point staged with
 * alpha 0 is hidden, so it is moved off-clip and contributes nothing; every
 * other point weighs exactly 1, so the map does not flinch on selection.
 */
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

  // Linear-light colour, summed; alpha carries the count.
  v_accum = vec4(pow(max(a_color.rgb, vec3(0.0)), vec3(u_gamma)) * w, w);
}`;

export const DENSITY_ACCUM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_accum;
out vec4 fragColor;

void main() {
  fragColor = v_accum;
}`;

/** Full-screen quad, uv in [0,1]. Shared by the blur and composite passes. */
export const DENSITY_QUAD_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) * 0.5;
}`;

const TAPS = gaussianWeights(DENSITY_SIGMA_GRID_PX, DENSITY_BLUR_RADIUS)
  .map(
    (w, i) =>
      `  c += texture(u_source, v_texCoord + u_direction * ${(i - DENSITY_BLUR_RADIUS).toFixed(1)}) * ${w.toFixed(8)};`,
  )
  .join('\n');

export const DENSITY_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_direction; // one texel: (1/gridW, 0) or (0, 1/gridH)

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = vec4(0.0);
${TAPS}
  fragColor = c;
}`;

export const DENSITY_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_density;   // blurred: rgb = sum(linear colour), a = smoothed count
uniform float u_densityAlpha;
uniform float u_densityScaler;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 d = texture(u_density, v_texCoord);       // LINEAR upsample from the grid
  float n = d.a;
  vec3 mean = n > 0.0 ? d.rgb / n : vec3(0.0);   // kernel-weighted mean colour, 0/0 guarded
  float alpha = clamp(n * u_densityScaler, 0.0, 1.0) * u_densityAlpha;
  // Premultiplied linear, the same convention POINT_FRAGMENT_SHADER writes.
  fragColor = vec4(mean * alpha, alpha);
}`;
