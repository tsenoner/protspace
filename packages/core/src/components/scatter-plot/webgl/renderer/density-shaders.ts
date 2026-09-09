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

/**
 * One separable-blur program source at the given sigma. The kernel is baked at
 * module load, so no frame ever recompiles a program or generates GLSL.
 */
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
uniform vec2 u_direction; // one texel: (1/gridW, 0) or (0, 1/gridH)

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 c = vec4(0.0);
${taps}
  fragColor = c;
}`;
}

export const DENSITY_BLUR_FRAGMENT_SHADER = blurSource(DENSITY_SIGMA_GRID_PX, DENSITY_BLUR_RADIUS);

/**
 * The contour style blurs three times wider than the heatmap, and needs its own
 * kernel to do it. At sigma 2 the level field still carries every 5-point clump
 * in a cluster, so the iso-lines came out as a knot of micro-loops around each
 * of them instead of the few nested rings the reference picture shows. The
 * heatmap wants the opposite: it REPLACES the points, so it has to stay sharp
 * enough to show where they actually are.
 *
 * 6, not 4 or 8: at 4 the loops were still there on the demo dataset, at 8 the
 * outermost ring floated a cluster-radius clear of its own points.
 */
export const DENSITY_CONTOUR_SIGMA_GRID_PX = 6;
/** ceil(3 * sigma) = 18, so 37 taps per pass. Contour style only. */
export const DENSITY_CONTOUR_BLUR_RADIUS = Math.ceil(3 * DENSITY_CONTOUR_SIGMA_GRID_PX);
export const DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER = blurSource(
  DENSITY_CONTOUR_SIGMA_GRID_PX,
  DENSITY_CONTOUR_BLUR_RADIUS,
);

/*
 * Contour style v2: iso-LINES, no fill.
 *
 * Points draw underneath and the selection above; the layer contributes only
 * thin lines, so the picture stays the scatter plot with its density annotated,
 * the way Embedding Atlas draws it. The heatmap style (u_style == 0) is
 * untouched by everything below.
 *
 * The level field is continuous, one step per doubling of density above the
 * support floor, and a line is drawn where it crosses an integer. fwidth turns
 * that into a fixed screen-space width at any zoom and any grid size, which is
 * what the old 4-neighbour band compare could not do: its lines were two grid
 * texels wide, i.e. 4 device px, and got fatter as the grid got coarser.
 */

/**
 * Coincident points whose blurred peak the outermost line sits at. Absolute, in
 * points, NOT relative to the frame's scaler: that is what makes an isolated
 * point ringless at every zoom, and what makes the lines dissolve as zooming in
 * spreads a cluster below 5 points per grid cell. 5, not 2 or 3: at 3 the 105K
 * fringe still grew rings around pairs of points.
 */
export const DENSITY_CONTOUR_MIN_POINTS = 5;
/**
 * Blurred peak of ONE point, in the same units as the composite's `n`. The
 * accumulation writes 1.0 into a single grid cell and the separable normalised
 * gaussian runs over it, so the peak survives as centreWeight^2; k coincident
 * points therefore peak at k * this.
 */
const DENSITY_ONE_POINT_PEAK =
  gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
    DENSITY_CONTOUR_BLUR_RADIUS
  ] ** 2;
/** The `u_contourFloor` uniform: no line below this blurred density. */
export const DENSITY_CONTOUR_FLOOR = DENSITY_CONTOUR_MIN_POINTS * DENSITY_ONE_POINT_PEAK;

/**
 * Lines above the floor, so at most LEVELS + 1 rings on a cluster of any depth.
 * Without a ceiling log2 keeps adding a ring per doubling and the 573K core
 * silts up with wormy micro-loops; with it the core simply goes clean.
 * 4 gives the 5 rings the reference picture shows on a typical cluster.
 */
const DENSITY_CONTOUR_LEVELS = 4;
/**
 * Levels per doubling of density. 1: the rings then span floor x 1.4 to
 * floor x 22.6, about the dynamic range of a real cluster's profile. Below 1
 * the rings spread past the cluster; above 1 they crowd back into worms.
 */
const DENSITY_CONTOUR_SPACING = 1.0;
/**
 * Half-width, in device px, of the smoothstep ramp on either side of a level
 * crossing, so a line is about 2 x this wide. 0.6 reads as a hairline at dpr 2
 * and still anti-aliases at dpr 1.
 */
const DENSITY_CONTOUR_LINE_PX = 0.6;
/**
 * The line is the mean colour times this. Embedding Atlas draws on black and
 * lightens; ProtSpace is on white, so the line has to darken to read. With the
 * fill gone the line is all there is, so it darkens harder than the 0.45 that
 * only had to beat its own fill.
 */
const DENSITY_CONTOUR_DARKEN = 0.35;
/**
 * Levels per device pixel past which a line cannot be resolved. Above it the
 * ramp would smear into a solid band, which is exactly what the log of a field
 * decaying to zero does on the rim of a single point.
 */
const DENSITY_CONTOUR_MAX_SLOPE = 1.0;

export const DENSITY_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_density;   // blurred: rgb = sum(linear colour), a = smoothed count
uniform float u_densityAlpha;
uniform float u_densityScaler;
uniform int u_style;           // 0 = heatmap, 1 = contour
uniform float u_contourFloor;  // blurred density of DENSITY_CONTOUR_MIN_POINTS coincident points

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 d = texture(u_density, v_texCoord);       // LINEAR upsample from the grid
  float n = d.a;
  vec3 mean = n > 0.0 ? d.rgb / n : vec3(0.0);   // kernel-weighted mean colour, 0/0 guarded

  if (u_style == 1) {
    // Continuous level from the ONE fetch above. The -0.5 puts the outermost
    // ring half a level inside the floor, so the floor cut below trims nothing
    // visible. The frame's scaler is deliberately absent: levels are absolute.
    float o = log2(max(n, 1e-8) / u_contourFloor) * ${DENSITY_CONTOUR_SPACING.toFixed(1)} - 0.5;
    float f = fract(o);
    float w = fwidth(o);
    float line =
      1.0 - smoothstep(0.0, max(w * ${DENSITY_CONTOUR_LINE_PX.toFixed(2)}, 1e-6), min(f, 1.0 - f));
    // No fill, and three cuts: below the support floor, past the top level, and
    // where the field is too steep for a line to mean anything.
    line *= step(u_contourFloor, n) * step(o, ${DENSITY_CONTOUR_LEVELS.toFixed(1)})
          * step(w, ${DENSITY_CONTOUR_MAX_SLOPE.toFixed(1)});
    float alpha = line * u_densityAlpha;
    fragColor = vec4(mean * ${DENSITY_CONTOUR_DARKEN.toFixed(2)} * alpha, alpha);
    return;
  }

  float alpha = clamp(n * u_densityScaler, 0.0, 1.0) * u_densityAlpha;
  // Premultiplied linear, the same convention POINT_FRAGMENT_SHADER writes.
  fragColor = vec4(mean * alpha, alpha);
}`;
