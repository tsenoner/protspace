import { describe, it, expect } from 'vitest';
import {
  gaussianWeights,
  DENSITY_SIGMA_GRID_PX,
  DENSITY_BLUR_RADIUS,
  DENSITY_ACCUM_VERTEX_SHADER,
  DENSITY_BLUR_FRAGMENT_SHADER,
  DENSITY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CATEGORY_ACCUM_VERTEX_SHADER,
  DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER,
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
  // rather than one loop per clump: sigma 3 on its half-resolution grid, the
  // same 12 device px the tuned sigma 6 spanned on the density grid.
  it('bakes a second, wider kernel for the contour style', () => {
    expect((DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER.match(/texture\(u_source/g) ?? []).length).toBe(
      19,
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

  it('carries no contour branch', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).not.toContain('u_style');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).not.toContain('u_contourFloor');
  });
});

describe('DENSITY_CATEGORY_ACCUM_VERTEX_SHADER', () => {
  // The same shear lock as the heatmap accumulate: the contour fields must land
  // points where the point pass lands them.
  it('carries the point shader camera lines byte-identically, and flips y', () => {
    expect(cameraLines(DENSITY_CATEGORY_ACCUM_VERTEX_SHADER)).toEqual(
      cameraLines(POINT_VERTEX_SHADER),
    );
    expect(DENSITY_CATEGORY_ACCUM_VERTEX_SHADER).toContain(
      'gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);',
    );
  });
});

describe('DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER', () => {
  // One fetch per field, never a neighbour tap: fwidth gives the screen-space
  // width, so the lines stay the same weight at any zoom and grid size.
  it('fetches each field once and draws one guarded ring set per slot', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect((src.match(/texture\(/g) ?? []).length).toBe(4);
    expect(src).not.toContain('u_texel');
    expect(src).toContain('float w = fwidth(o);');
    const rings = src.split('\n').filter((l) => l.includes('acc = over(ring('));
    expect(rings).toHaveLength(16);
    // A uniform guard on every block keeps control flow uniform around fwidth.
    expect(rings.every((l) => /^ {2}if \(u_slotCount > \d+\) /.test(l))).toBe(true);
    expect(rings[15]).toContain('ring(d3.w), u_slotColors[15]');
  });

  // Three cuts, all needed: the floor keeps rings off isolated points, the
  // ceiling stops a deep core silting up with micro-loops, the slope cut stops
  // the log's unbounded gradient at the support rim smearing into a solid band.
  it('cuts the line below the floor, past the top level, and where it cannot resolve', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect(src).toContain('step(u_contourFloor, n)');
    expect(src).toContain('step(o, 4.5)');
    expect(src).toContain('step(w, 1.0)');
    // Absolute levels: the frame's scaler would drag the rings with the zoom.
    expect(src).not.toContain('u_densityScaler');
  });

  it('fills 20 % to 80 % in the dominant slot colour only', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect(src).toContain('mix(0.20, 0.80,');
    expect(src).toContain('vec4 acc = vec4(bestColor * fill, fill);');
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
    expect(DENSITY_CONTOUR_FLOOR).toBeCloseTo(0.0886792, 7);
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
