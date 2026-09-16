import { describe, it, expect } from 'vitest';
import {
  gaussianWeights,
  DENSITY_SIGMA_GRID_PX,
  DENSITY_BLUR_RADIUS,
  DENSITY_ACCUM_VERTEX_SHADER,
  DENSITY_BLUR_FRAGMENT_SHADER,
  DENSITY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CONTOUR_MIN_POINTS,
  DENSITY_CONTOUR_FLOOR,
  DENSITY_CONTOUR_SIGMA_GRID_PX,
  DENSITY_CONTOUR_BLUR_RADIUS,
  DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
} from './density-shaders';
import { POINT_VERTEX_SHADER } from './export-shaders';

/** The three camera lines, verbatim, in source order. */
function cameraLines(src: string): string[] {
  return src
    .split('\n')
    .filter((line) => /vec2 (cssTransformed|physicalPos|clipSpace) =/.test(line));
}

/** The declarations those lines read, verbatim: same names AND same types. */
function cameraUniforms(src: string): string[] {
  return src
    .split('\n')
    .filter((line) => /^uniform .*\b(u_resolution|u_transform|u_dpr|u_gamma);$/.test(line));
}

/**
 * Every statement in the contour branch that writes `line`, `coats`, `fill`,
 * `alpha` or `fragColor`, in source order, whitespace collapsed and numeric
 * literals replaced by `N`. Any extra term anywhere in the alpha derivation
 * changes it.
 */
function contourAlphaChain(src: string): string[] {
  const branch = src.slice(src.indexOf('if (u_style == 1)'), src.indexOf('float alpha = clamp('));
  return branch
    .replace(/\/\/[^\n]*/g, '')
    .split(';')
    .map((stmt) =>
      stmt
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/(?<![\w.])\d+(?:\.\d+)?(?:e-?\d+)?/g, 'N'),
    )
    .filter((stmt) => /^(?:float )?(?:line|coats|fill|alpha|fragColor)\s*[*+\-/]?=/.test(stmt));
}

describe('gaussianWeights', () => {
  it('is a normalised symmetric 13-tap kernel at sigma 2, radius 6', () => {
    const w = gaussianWeights(DENSITY_SIGMA_GRID_PX, DENSITY_BLUR_RADIUS);
    expect(w).toHaveLength(13);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (let i = 0; i < w.length; i++) expect(w[i]).toBeCloseTo(w[w.length - 1 - i]!, 12);
    expect(w[DENSITY_BLUR_RADIUS]).toBeCloseTo(0.1997, 3);
  });
});

describe('DENSITY_BLUR_FRAGMENT_SHADER', () => {
  it('bakes exactly one texture tap per kernel weight', () => {
    expect((DENSITY_BLUR_FRAGMENT_SHADER.match(/texture\(u_source/g) ?? []).length).toBe(13);
  });

  // The contour style needs a field smooth enough for a handful of nested rings
  // rather than one loop per clump, and the heatmap needs the opposite, so the
  // two sigmas cannot be the same constant. This is the guard on that split:
  // a contour kernel that quietly narrows back to 13 taps brings the worms back.
  it('bakes a second, three times wider kernel for the contour style', () => {
    expect(DENSITY_CONTOUR_SIGMA_GRID_PX).toBe(3 * DENSITY_SIGMA_GRID_PX);
    expect((DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER.match(/texture\(u_source/g) ?? []).length).toBe(
      37,
    );
    // Same uniforms, so one pass sequence drives either program.
    expect(DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER).toContain('uniform vec2 u_direction;');
  });
});

describe('DENSITY_ACCUM_VERTEX_SHADER', () => {
  // The M1 lock: the accumulation pass must land points where the point pass
  // lands them. The grid is selected by gl.viewport alone, so any drift in these
  // three lines is a silent shear between the layer and the points.
  it('carries the point shader camera lines byte-identically', () => {
    const point = cameraLines(POINT_VERTEX_SHADER);
    expect(point).toHaveLength(3);
    expect(cameraLines(DENSITY_ACCUM_VERTEX_SHADER)).toEqual(point);
  });

  // Identical lines over a differently typed uniform is the same shear by another
  // route: a vec2 u_dpr reads as a per-axis scale the point pass never applies.
  it('declares the camera uniforms with the point shader types', () => {
    const point = cameraUniforms(POINT_VERTEX_SHADER);
    expect(point).toHaveLength(4);
    expect(cameraUniforms(DENSITY_ACCUM_VERTEX_SHADER)).toEqual(point);
  });

  // The camera lines end in NDC with y still pointing down; the flip belongs to
  // gl_Position. Dropping the minus mirrors the whole layer about the horizon,
  // and the three lines above stay byte-identical while it happens.
  it('flips y into clip space', () => {
    expect(DENSITY_ACCUM_VERTEX_SHADER).toContain(
      'gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);',
    );
  });
});

describe('DENSITY_COMPOSITE_FRAGMENT_SHADER', () => {
  it('guards the mean-colour divide against empty cells', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('n > 0.0 ?');
  });

  // The composite blends with ONE, ONE_MINUS_SRC_ALPHA, so the source has to be
  // premultiplied. An un-premultiplied vec4(mean, alpha) is only wrong where
  // alpha < 1, which is every fringe pixel and every `auto` cross-fade frame.
  it('writes premultiplied linear colour', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('fragColor = vec4(mean * alpha, alpha);');
  });

  // The heatmap branch is the shipped look; the contour branch is a second
  // reading of the same texture behind u_style, so the heatmap line above and
  // the guard above it must survive unchanged when the branch changes.
  it('derives a continuous level field from the single bilinear fetch', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('uniform int u_style;');
    // One step per doubling above the floor, offset by half a step so the
    // outermost ring sits inside the support and the floor cut trims nothing.
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain(
      'float o = log2(max(n, 1e-8) / u_contourFloor) * 1.0 - 0.5;',
    );
    // Absolute levels: the frame's scaler moves with zoom and would drag the
    // rings with it, which is the opposite of the fade-on-zoom-in the floor buys.
    const contour = DENSITY_COMPOSITE_FRAGMENT_SHADER.slice(
      DENSITY_COMPOSITE_FRAGMENT_SHADER.indexOf('if (u_style == 1)'),
      DENSITY_COMPOSITE_FRAGMENT_SHADER.indexOf('float alpha = clamp('),
    );
    expect(contour).not.toContain('u_densityScaler');
  });

  // Screen-space width, not grid-space: fwidth is what keeps a line ~1 px at any
  // zoom and any grid size. The 4-neighbour compare it replaces drew a strip two
  // grid texels wide, so it fattened whenever the grid got coarser.
  it('draws anti-aliased lines from fwidth and takes no neighbour taps', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('float w = fwidth(o);');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('min(f, 1.0 - f)');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).not.toContain('u_texel');
    // One fetch for the whole shader.
    expect((DENSITY_COMPOSITE_FRAGMENT_SHADER.match(/texture\(u_density/g) ?? []).length).toBe(1);
  });

  // Lines over a stacked fill: one translucent coat per enclosing ring, so the
  // core is darker than the fringe and nothing is painted outside the outermost
  // ring. This asserts the SHAPE of the alpha derivation rather than one of its
  // lines: every statement in the branch that writes `line`, `coats`, `fill`,
  // `alpha` or `fragColor`, in order, with the numeric literals blanked so
  // tuning a constant does not fail it. A containment check on the alpha line
  // alone stays green when an extra term is smuggled in one line above it.
  it('derives the fragment from the line term over one fill coat per ring', () => {
    expect(contourAlphaChain(DENSITY_COMPOSITE_FRAGMENT_SHADER)).toEqual([
      'float line = N - smoothstep(N, max(w * N, N), min(f, N - f))',
      'line *= step(u_contourFloor, n) * step(o, N) * step(w, N)',
      'float coats = clamp(floor(o) + N, N, N)',
      'float fill = step(N, coats) * mix(N, N, (coats - N) / N)',
      'float alpha = (line + fill * (N - line)) * u_densityAlpha',
      'fragColor = vec4(mix(mean, vec3(N), N) * alpha, alpha)',
    ]);
  });

  // Three cuts, all needed: the floor keeps rings off isolated points, the
  // ceiling stops a deep core silting up with micro-loops, the slope cut stops
  // the log's unbounded gradient at the support rim smearing into a solid band.
  it('cuts the line below the floor, past the top level, and where it cannot resolve', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('uniform float u_contourFloor;');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('step(u_contourFloor, n)');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('step(o, 4.5)');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('step(w, 1.0)');
  });
});

describe('DENSITY_CONTOUR_FLOOR', () => {
  // The whole point of the floor: it is a point COUNT, not a fraction of the
  // frame's scaler, so the shader can compare it against the blurred `n`.
  // One point deposits 1.0 in one grid cell and the separable normalised kernel
  // runs over it twice, so its peak is centreWeight^2.
  it('is the blurred peak of DENSITY_CONTOUR_MIN_POINTS coincident points', () => {
    const w0 = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
      DENSITY_CONTOUR_BLUR_RADIUS
    ]!;
    expect(DENSITY_CONTOUR_FLOOR).toBeCloseTo(DENSITY_CONTOUR_MIN_POINTS * w0 * w0, 12);
    expect(DENSITY_CONTOUR_MIN_POINTS).toBe(5);
  });

  // The mapping, evaluated in JS the way the shader evaluates it: a single point
  // is below the floor at every zoom (that is what "no ring on a singleton"
  // means), and a cluster deep enough to saturate still draws only 5 rings.
  it('maps one point below the first ring and caps a deep core at 5 rings', () => {
    const w0 = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
      DENSITY_CONTOUR_BLUR_RADIUS
    ]!;
    // The shader's own arithmetic: level, then the cuts, then the integer
    // crossings at or below it.
    const rings = (points: number) => {
      const n = points * w0 * w0;
      if (n < DENSITY_CONTOUR_FLOOR) return 0;
      const o = Math.log2(n / DENSITY_CONTOUR_FLOOR) * 1.0 - 0.5;
      return o < 0 ? 0 : Math.min(Math.floor(o), 4) + 1;
    };
    // No ring on a singleton, or on a pair, at any zoom: the floor is absolute.
    expect(rings(1)).toBe(0);
    expect(rings(4)).toBe(0);
    // The first ring sits half a level above the floor, at sqrt(2) x 5 points.
    expect(rings(7)).toBe(0);
    expect(rings(8)).toBe(1);
    expect(rings(40)).toBe(3);
    // 160 points is the deepest core that adds a ring; past it the ceiling holds.
    expect(rings(160)).toBe(5);
    expect(rings(1e6)).toBe(5);
  });
});
