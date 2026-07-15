/**
 * Point + gamma-correction shader sources for the off-screen export pipeline.
 *
 * These are byte-identical copies of the live shader sources that previously
 * lived as module-level constants in `webgl-renderer.ts`. They are factored out
 * here so the extracted `ExportRenderer` can build its throwaway programs
 * without depending on the live renderer module. The Wire phase re-points the
 * live renderer to consume these same constants, keeping a single source of
 * truth for the shader text.
 */

export const POINT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_dataPosition;
in float a_pointSize;
in vec4 a_color;
in float a_depth;
in float a_labelCount;
in float a_shape;
in float a_predicted;

uniform vec2 u_resolution;
uniform vec3 u_transform;
uniform float u_dpr;
uniform float u_gamma;

out vec4 v_color;
out float v_labelCount;
flat out float v_shape;
flat out float v_predicted;
flat out int v_pointIndex;

void main() {
  vec2 cssTransformed = a_dataPosition * u_transform.z + u_transform.xy;
  vec2 physicalPos = cssTransformed * u_dpr;
  vec2 clipSpace = (physicalPos / u_resolution) * 2.0 - 1.0;

  // Depth is computed per-point on the CPU (opacity + legend z-order tie-break)
  gl_Position = vec4(clipSpace.x, -clipSpace.y, a_depth, 1.0);
  gl_PointSize = max(1.0, a_pointSize);

  // Convert sRGB input to linear RGB for proper blending
  vec3 linearColor = pow(max(a_color.rgb, vec3(0.0)), vec3(u_gamma));
  v_color = vec4(linearColor, a_color.a);
  v_labelCount = a_labelCount;
  v_shape = a_shape;
  v_predicted = a_predicted;
  v_pointIndex = gl_VertexID;
}`;

export const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_labelCount;
flat in float v_shape;
flat in float v_predicted;
flat in int v_pointIndex;

uniform sampler2D u_labelColors;
uniform vec2 u_labelTextureSize;
uniform int u_maxLabels;
uniform float u_gamma;
uniform vec3 u_knockoutColor;

out vec4 fragColor;

const float PI = 3.14159265359;
const float SQRT3 = 1.73205080757;

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
  float predictedInterior = 0.0;
  if (v_predicted > 0.5) {
    // Keep the ring legible at every sprite size without allowing derivative scaling to consume
    // the interior. The opaque surface-color knockout prevents earlier overlapping points from showing
    // through the hole and visually turning a transferred ring back into a filled marker.
    float ringWidth = clamp(aa * 1.75, 0.22, 0.42);
    float interiorAa = min(aa, (1.0 - ringWidth) * 0.5);
    predictedInterior = smoothstep(ringWidth, ringWidth + interiorAa, edgeDist);
  }
  if (shapeAlpha < 0.001) discard;

  // Early-out for hidden points (alpha=0). These remain in GPU arrays to
  // preserve sort order across visibility toggles, avoiding costly re-sorts.
  if (v_color.a < 0.001) discard;

  vec3 finalColor = v_color.rgb;

  // Pie Chart Logic (only for multi-label points, which always use circle shape)
  if (v_labelCount > 1.5) {
    float angle = atan(coord.y, coord.x); // -PI to PI
    // Map to 0..1
    float normalizedAngle = (angle + PI) / (2.0 * PI);

    float count = floor(v_labelCount + 0.5);
    float sliceIndex = floor(normalizedAngle * count);

    // Calculate texture lookup index
    int globalIndex = v_pointIndex * u_maxLabels + int(sliceIndex);
    int texW = int(u_labelTextureSize.x);
    int tx = globalIndex % texW;
    int ty = globalIndex / texW;

    vec4 texColor = texelFetch(u_labelColors, ivec2(tx, ty), 0);

    // Linearize texture color
    finalColor = pow(max(texColor.rgb, vec3(0.0)), vec3(u_gamma));
  }

  // Darken near the edge to mimic a border/outline.
  // Skip for faded points (low alpha) where the darkening is disproportionately visible.
  float strokeWidth = 0.15;
  if (v_predicted < 0.5 && v_color.a > 0.5 && max(edgeDist, 0.0) < strokeWidth) {
    finalColor = finalColor * 0.5;
  }

  // Predicted interiors use an opaque plot-surface knockout. Mix premultiplied components
  // explicitly so the ring/interior transition remains correct for reliability-faded points.
  float finalAlpha = mix(v_color.a, 1.0, predictedInterior) * shapeAlpha;
  vec3 linearKnockoutColor = pow(max(u_knockoutColor, vec3(0.0)), vec3(u_gamma));
  vec3 premultipliedColor =
    mix(finalColor * v_color.a, linearKnockoutColor, predictedInterior) * shapeAlpha;
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

  // Apply gamma correction to RGB, preserve alpha
  vec3 corrected = pow(max(linear.rgb, vec3(0.0)), vec3(1.0 / u_gamma));

  fragColor = vec4(corrected, linear.a);
}`;
