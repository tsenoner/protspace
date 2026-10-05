/**
 * Every GLSL source the point draws compile, shared by the live renderer and the
 * export: the point and gamma programs, and the camera, glide and record-table
 * snippets the density shaders reuse.
 */

/**
 * Where a projection switch drew each point, for a vertex shader with
 * `CAMERA_TO_CLIP_GLSL`. `u_morph` runs 1 -> 0 while the points glide and is 0
 * otherwise; outside a glide `a_prevPosition` is disabled and reads (0, 0).
 */
export const MORPH_GLSL = `in vec2 a_prevPosition;
uniform float u_morph;`;

// u_transform is (tx, ty, kx, ky): the zoom transform with the staged-to-current
// rescale folded in per axis (see setCameraUniforms). Without one, kx = ky = k.
// At u_morph 0 the mix is exactly a_dataPosition.
export const CAMERA_TO_CLIP_GLSL = `  vec2 position = mix(a_dataPosition, a_prevPosition, u_morph);
  vec2 cssTransformed = position * u_transform.zw + u_transform.xy;
  vec2 physicalPos = cssTransformed * u_dpr;
  vec2 clipSpace = (physicalPos / u_resolution) * 2.0 - 1.0;`;

/** Texels per row of the per-record style table (record-table.ts). */
export const RECORD_STYLE_WIDTH = 1024;

/**
 * The per-record style table, for a vertex shader with `a_color`: texel 2r is
 * record r's colour and whether it is shown (0 or 1), texel 2r + 1 its size,
 * shape and label count. Off (the export, or a stage without a table), every
 * point keeps its own attributes.
 */
export const RECORD_STYLE_GLSL = `in float a_record;
uniform highp sampler2D u_recordStyle;
uniform bool u_recordStyleOn;

bool hasRecordStyle() {
  return u_recordStyleOn && a_record >= 0.0;
}

vec4 recordStyle(int texel) {
  int t = int(a_record) * 2 + texel;
  return texelFetch(u_recordStyle, ivec2(t % ${RECORD_STYLE_WIDTH}, t / ${RECORD_STYLE_WIDTH}), 0);
}

// a_color, or the record's colour at the point's own opacity, or 0 if hidden.
vec4 pointColor() {
  if (!hasRecordStyle()) return a_color;
  vec4 style = recordStyle(0);
  return vec4(style.rgb, a_color.a * style.a);
}`;

/**
 * Marks drawn on the GPU (`PointMarks`): an R8 texture holding a non-zero byte
 * for each marked point, by draw index, in rows as wide as the renderer
 * allocated them. While marks are on, a point that is not hidden takes the
 * marked or unmarked opacity, and `u_markPass` draws only the unmarked points
 * (0), only the marked ones (1) or all of them (-1). Off (the export, or
 * nothing marked), every point keeps its staged opacity.
 */
const MARK_GLSL = `uniform highp sampler2D u_marks;
uniform bool u_marksOn;
uniform int u_markPass;
uniform float u_markedOpacity;
uniform float u_unmarkedOpacity;

bool isMarked() {
  int width = textureSize(u_marks, 0).x;
  return texelFetch(u_marks, ivec2(gl_VertexID % width, gl_VertexID / width), 0).r > 0.0;
}`;

// a_dataPosition is always enabled, so it takes location 0: a disabled attribute
// there (a_prevPosition) makes desktop-GL backends emulate it on every draw.
export const POINT_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_dataPosition;
in float a_pointSize;
in vec4 a_color;
in float a_depth;
in float a_labelCount;
in float a_shape;
in float a_predicted;

uniform vec2 u_resolution;
uniform vec4 u_transform;
uniform float u_dpr;
uniform float u_pointScale;
uniform float u_gamma;
${MORPH_GLSL}
${RECORD_STYLE_GLSL}
${MARK_GLSL}

out vec4 v_color;
out float v_labelCount;
flat out float v_shape;
flat out float v_predicted;
flat out int v_pointIndex;

void main() {
${CAMERA_TO_CLIP_GLSL}

  vec4 color = pointColor();
  if (u_marksOn) {
    bool marked = isMarked();
    if (u_markPass >= 0 && marked != (u_markPass == 1)) {
      // The other pass draws this point.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 1.0;
      return;
    }
    if (color.a > 0.0) color.a = marked ? u_markedOpacity : u_unmarkedOpacity;
  }
  float pointSize = a_pointSize;
  float labelCount = a_labelCount;
  float shape = a_shape;
  if (hasRecordStyle()) {
    vec4 form = recordStyle(1);
    pointSize = form.x;
    shape = form.y;
    labelCount = form.z;
  }

  // Depth is computed per-point on the CPU (opacity + legend z-order tie-break)
  gl_Position = vec4(clipSpace.x, -clipSpace.y, a_depth, 1.0);
  gl_PointSize = max(1.0, pointSize * u_pointScale * u_dpr);

  // Convert sRGB input to linear RGB for proper blending
  vec3 linearColor = pow(max(color.rgb, vec3(0.0)), vec3(u_gamma));
  v_color = vec4(linearColor, color.a);
  v_labelCount = labelCount;
  v_shape = shape;
  v_predicted = a_predicted;
  v_pointIndex = gl_VertexID;
}`;

export const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
// ES 3.00 defaults fragment int to mediump, whose guaranteed range is 16 bits.
// v_pointIndex and the atlas index derived from it exceed 32767 at any dataset
// past ~32K points, so on a driver that honours the minimum they are undefined
// — exactly the low-end hardware the atlas limits are about.
precision highp int;

in vec4 v_color;
in float v_labelCount;
flat in float v_shape;
flat in float v_predicted;
flat in int v_pointIndex;

uniform sampler2D u_labelColors;
uniform vec2 u_labelTextureSize;
uniform int u_maxLabels;
// Points the atlas covers. Zero when none is allocated, which makes every marker
// fall through to its dominant color rather than sampling unallocated storage.
uniform int u_labelAtlasCapacity;
uniform float u_gamma;
uniform vec3 u_knockoutColor;

out vec4 fragColor;

const float PI = 3.14159265359;
const float SQRT3 = 1.73205080757;
const float PREDICTED_INTERIOR_FILL = 0.0; // 1.0 = filled knockout (old), 0.0 = hollow

// Outline width. Two terms, and it needs both:
//
//   * a FRACTION of the sprite radius, so the rim grows with the glyph. This is what makes the
//     outline read as a border while exploring — at gl_PointSize 240 a fixed 1px rim on a 120px
//     radius is invisible, which is exactly how it looked when this was device-pixels-only.
//   * a floor in DEVICE PIXELS, so it never thins to nothing on small sprites or at export
//     scale. A pure fraction goes sub-pixel on tiny points and disappears in print.
//
// max() of the two: the fraction dominates on screen, the floor takes over when the glyph is
// small enough that the fraction would fall below a pixel.
const float OUTLINE_RADIUS_FRACTION = 0.15;
const float OUTLINE_DEVICE_PX = 1.0;
// Share of the ring an outline may consume. The ring IS the predicted glyph's border, and its
// outer edge is already where shapeAlpha fades to zero, so an unbudgeted outer darken would
// eat 27-50% of the annulus at every size and smear the hollow cue the encoding depends on.
const float OUTLINE_RING_BUDGET = 0.35;
// Share of a FILLED dot's radius the outline may consume. The device-pixel floor is unbounded
// by construction (it is 2/gl_PointSize in field units), so on a small sprite it would otherwise
// cover the whole glyph: at gl_PointSize 4 the floor is 0.5 of the radius, at 2 it is the entire
// radius, and the dot then reads up to 50% darker than the hue its legend swatch shows. Cap it
// so a majority of every dot always keeps the pure category color.
const float OUTLINE_DOT_BUDGET = 0.35;

void main() {
  vec2 coord = gl_PointCoord * 2.0 - 1.0;

  // Compute signed edge distance for each shape.
  // Positive = inside, zero = on boundary, negative = outside.
  // This single computation drives both anti-aliasing and the outline effect.
  float edgeDist;

  if (v_shape < 0.5) { // Circle
    edgeDist = 1.0 - length(coord);
  } else if (v_shape < 1.5) { // Square
    edgeDist = 1.0 - max(abs(coord.x), abs(coord.y));
  } else if (v_shape < 2.5) { // Diamond
    // Match d3.symbolDiamond proportions (same mapping as D3's "tan30" constant, i.e. sqrt(1/3))
    edgeDist = 1.0 - (abs(coord.x) * SQRT3 + abs(coord.y));
  } else if (v_shape < 3.5) { // Triangle Up
    // Inside region: abs(x)*SQRT3 <= 1 + y, clipped to point quad [-1,1]^2.
    float eSides = (1.0 + coord.y - abs(coord.x) * SQRT3) / 2.0;
    float eBottom = 1.0 - coord.y;
    float eLR = 1.0 - abs(coord.x);
    edgeDist = min(eSides, min(eBottom, eLR));
  } else if (v_shape < 4.5) { // Triangle Down
    // Inside region: abs(x)*SQRT3 <= 1 - y, clipped to point quad [-1,1]^2.
    float eSides = (1.0 - coord.y - abs(coord.x) * SQRT3) / 2.0;
    float eTop = 1.0 + coord.y;
    float eLR = 1.0 - abs(coord.x);
    edgeDist = min(eSides, min(eTop, eLR));
  } else { // Plus — SDF as union of vertical and horizontal arms
    float thickness = 0.35;
    // SDF for vertical arm (half-extents: thickness x 1.0)
    vec2 dV = abs(coord) - vec2(thickness, 1.0);
    float sdfV = length(max(dV, 0.0)) + min(max(dV.x, dV.y), 0.0);
    // SDF for horizontal arm (half-extents: 1.0 x thickness)
    vec2 dH = abs(coord) - vec2(1.0, thickness);
    float sdfH = length(max(dH, 0.0)) + min(max(dH.x, dH.y), 0.0);
    // Union of both arms; negate so positive = inside
    edgeDist = -min(sdfV, sdfH);
  }

  // Anti-aliased shape edge: smooth alpha over ~1 screen pixel using
  // screen-space derivatives of the distance field.
  float aa = fwidth(edgeDist);
  float shapeAlpha = smoothstep(0.0, aa, edgeDist);
  // Isotropic field-units-per-pixel. Hoisted out of the predicted branch so the ring and the
  // outline share one definition: dFdx/dFdy of coord are 2/gl_PointSize in every direction,
  // whereas fwidth is the L1 norm of the partials and reads ~41% larger along the diagonals.
  float pixelScale = max(length(dFdx(coord)), length(dFdy(coord)));
  // One device pixel expressed in edgeDist units. pixelScale is the pixel size in *sprite* units,
  // but edgeDist is not a unit-gradient field for every shape — the diamond's
  // 1 - (|x|*SQRT3 + |y|) has |grad| = 2, so a band of pixelScale there is only half a pixel
  // wide. Converting through the field's own gradient is what makes OUTLINE_DEVICE_PX an actual
  // device pixel on every glyph. length() of the partials, not fwidth() — same reason as
  // pixelScale above. Clamped to [1, 2] x pixelScale, the true gradient range across all six
  // shapes, so a derivative spike at a triangle's interior ridge cannot widen the band.
  float fieldPerPixel = clamp(
    length(vec2(dFdx(edgeDist), dFdy(edgeDist))), pixelScale, pixelScale * 2.0);
  float predictedInterior = 0.0;
  // Resolved here, in the one place the glyph class is already interpreted, so the outline code
  // below stays class-free.
  float outlineBudget = OUTLINE_DOT_BUDGET;
  if (v_predicted > 0.5) {
    // Keep the ring legible at every sprite size without allowing derivative scaling to consume
    // the interior. With PREDICTED_INTERIOR_FILL = 1.0 the opaque surface-color knockout would
    // prevent earlier overlapping points from showing through the hole; at 0.0 (hollow) that
    // show-through is allowed for densely overlapping markers — an accepted trade-off.
    float ringWidth = clamp(pixelScale * 1.75, 0.30, 0.55);
    outlineBudget = ringWidth * OUTLINE_RING_BUDGET;
    float interiorAa = min(pixelScale, (1.0 - ringWidth) * 0.5);
    predictedInterior = smoothstep(ringWidth, ringWidth + interiorAa, edgeDist);
  }
  if (shapeAlpha < 0.001) discard;

  // Early-out for hidden points (alpha=0). These remain in GPU arrays to
  // preserve sort order across visibility toggles, avoiding costly re-sorts.
  if (v_color.a < 0.001) discard;

  vec3 finalColor = v_color.rgb;

  // Pie Chart Logic (only for multi-label points, which always use circle shape).
  // The capacity test is what keeps a point outside the atlas — or a session with
  // no atlas at all — painting its dominant color instead of sampling storage that
  // belongs to another protein, or to nothing.
  if (v_labelCount > 1.5 && v_pointIndex < u_labelAtlasCapacity) {
    float angle = atan(coord.y, coord.x); // -PI to PI
    // Map to 0..1
    float normalizedAngle = (angle + PI) / (2.0 * PI);

    // Clamped to what the atlas actually reserves per point: a point with more
    // colors than u_maxLabels would otherwise index into the NEXT point's texels.
    float count = min(floor(v_labelCount + 0.5), float(u_maxLabels));
    // atan(+0, x < 0) is exactly +PI, so normalizedAngle reaches 1.0 on the middle
    // pixel row of any odd-height sprite, so sliceIndex would otherwise reach count.
    float sliceIndex = min(floor(normalizedAngle * count), count - 1.0);

    // Calculate texture lookup index
    int globalIndex = v_pointIndex * u_maxLabels + int(sliceIndex);
    int texW = int(u_labelTextureSize.x);
    int tx = globalIndex % texW;
    int ty = globalIndex / texW;

    vec4 texColor = texelFetch(u_labelColors, ivec2(tx, ty), 0);

    // Linearize texture color
    finalColor = pow(max(texColor.rgb, vec3(0.0)), vec3(u_gamma));
  }

  // Darken near the edge to mimic a border/outline. Applied to BOTH filled dots and predicted
  // rings so the two glyph classes share one outline treatment (#369) — filled-vs-hollow stays
  // the encoding that tells them apart, which is a pre-attentive categorical difference and far
  // stronger than a difference in outline weight.
  // Still skipped for faded points (low alpha), where the darkening is disproportionately visible.
  float outlineWidth =
    min(max(OUTLINE_RADIUS_FRACTION, OUTLINE_DEVICE_PX * fieldPerPixel), outlineBudget);
  if (v_color.a > 0.5) {
    // Smooth the inner edge. The outer edge is already anti-aliased by shapeAlpha, so a hard
    // threshold here left the outline smooth outside and stepped inside. edgeDist is positive
    // here: the shapeAlpha discard above already dropped everything outside the glyph.
    //
    // The feather spans pixelScale, NOT fieldPerPixel, even though the width above uses
    // fieldPerPixel. On a ring, outlineBudget caps the band below one device pixel
    // (ringWidth * 0.35 <= 0.19), so feathering over fieldPerPixel would make the ramp wider
    // than the band it is supposed to soften and wash the outline out instead — on a diamond,
    // whose gradient is 2, that cost a predicted glyph ~3x of its darkening at default point
    // sizes. Widening the band is safe; widening the feather past the band is not.
    float outlineMix = 1.0 - smoothstep(outlineWidth - pixelScale, outlineWidth, edgeDist);
    finalColor = mix(finalColor, finalColor * 0.5, outlineMix);
  }

  // Predicted interiors mix toward PREDICTED_INTERIOR_FILL (hollow=0.0, filled-knockout=1.0).
  // Mix premultiplied components explicitly so the ring/interior transition remains correct
  // for reliability-faded points.
  float finalAlpha = mix(v_color.a, PREDICTED_INTERIOR_FILL, predictedInterior) * shapeAlpha;
  vec3 linearKnockoutColor = pow(max(u_knockoutColor, vec3(0.0)), vec3(u_gamma));
  vec3 premultipliedColor =
    mix(finalColor * v_color.a, linearKnockoutColor * PREDICTED_INTERIOR_FILL, predictedInterior) *
    shapeAlpha;
  fragColor = vec4(premultipliedColor, finalAlpha);
}`;

export const GAMMA_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) * 0.5;
}`;

export const GAMMA_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_linearTexture;
uniform float u_gamma;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 linear = texture(u_linearTexture, v_texCoord);

  vec3 straight = linear.a > 0.0 ? linear.rgb / linear.a : vec3(0.0);

  // Apply gamma correction to RGB, preserve alpha
  vec3 corrected = pow(max(straight, vec3(0.0)), vec3(1.0 / u_gamma));

  fragColor = vec4(corrected, linear.a);
}`;
