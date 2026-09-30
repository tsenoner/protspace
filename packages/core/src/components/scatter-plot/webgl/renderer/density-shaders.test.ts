import { describe, it, expect } from 'vitest';
import {
  gaussianWeights,
  DENSITY_CATEGORY_ACCUM_VERTEX_SHADER,
  DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER,
  DENSITY_CONTOUR_MIN_POINTS,
  DENSITY_CONTOUR_FLOOR,
  DENSITY_CONTOUR_SIGMA_GRID_PX,
  DENSITY_CONTOUR_BLUR_RADIUS,
  DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER,
} from './density-shaders';
import { CAMERA_TO_CLIP_GLSL, POINT_VERTEX_SHADER } from './export-shaders';

describe('gaussianWeights', () => {
  it('is a normalised symmetric kernel', () => {
    const w = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS);
    expect(w).toHaveLength(2 * DENSITY_CONTOUR_BLUR_RADIUS + 1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (let i = 0; i < w.length; i++) expect(w[i]).toBeCloseTo(w[w.length - 1 - i]!, 12);
  });
});

describe('DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER', () => {
  it('bakes exactly one texture tap per kernel weight', () => {
    expect((DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER.match(/texture\(u_source/g) ?? []).length).toBe(
      19,
    );
    expect(DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER).toContain('uniform vec2 u_direction;');
  });

  it('clamps to the half-float range, which saturates only past the last ring', () => {
    expect(DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER).toContain('fragColor = min(c, vec4(65504.0));');
    const w = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS);
    // A clamped ping texel still gives every field it reaches at least 65504 x the edge
    // weight (~96.9), far above the top ring (floor x 2^5, ~2.84).
    expect(65504 * w[0]!).toBeGreaterThan(DENSITY_CONTOUR_FLOOR * 2 ** 5);
  });
});

describe('DENSITY_CATEGORY_ACCUM_VERTEX_SHADER camera', () => {
  it('shares the camera snippet with the point shader', () => {
    for (const src of [POINT_VERTEX_SHADER, DENSITY_CATEGORY_ACCUM_VERTEX_SHADER]) {
      expect(src).toContain(CAMERA_TO_CLIP_GLSL);
    }
  });
});

describe('DENSITY_CATEGORY_ACCUM_VERTEX_SHADER', () => {
  it('flips y into clip space', () => {
    expect(DENSITY_CATEGORY_ACCUM_VERTEX_SHADER).toContain(
      'gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);',
    );
  });
});

describe('DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER', () => {
  it('fetches each field once and draws one guarded ring set per slot', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect((src.match(/texture\(/g) ?? []).length).toBe(4);
    expect(src).not.toContain('u_texel');
    expect(src).toContain('float w = fwidth(o);');
    const rings = src.split('\n').filter((l) => l.includes('acc = over(ring('));
    expect(rings).toHaveLength(16);
    expect(rings.every((l) => /^ {2}if \(u_slotCount > \d+\) /.test(l))).toBe(true);
    expect(rings[15]).toContain('ring(d3.w), u_slotColors[15]');
  });

  it('cuts the line below the floor, past the top level, and where it cannot resolve', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect(src).toContain('step(u_contourFloor, n)');
    expect(src).toContain('step(o, 4.5)');
    expect(src).toContain('step(w * u_lineRamp, 2.0)');
    expect(src).not.toContain('u_densityScaler');
  });

  it('ramps the line over u_lineRamp device px, set per frame from the dpr', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect(src).toContain('uniform float u_lineRamp;');
    expect(src).toContain('smoothstep(0.0, max(w * u_lineRamp, 1e-6), min(f, 1.0 - f))');
  });

  it('fills 20 % to 80 % in the dominant slot colour only', () => {
    const src = DENSITY_CATEGORY_COMPOSITE_FRAGMENT_SHADER;
    expect(src).toContain('mix(0.20, 0.80,');
    expect(src).toContain('vec4 acc = vec4(bestColor * fill, fill);');
  });
});

describe('DENSITY_CONTOUR_FLOOR', () => {
  it('is the blurred peak of DENSITY_CONTOUR_MIN_POINTS coincident points', () => {
    const w0 = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
      DENSITY_CONTOUR_BLUR_RADIUS
    ]!;
    expect(DENSITY_CONTOUR_FLOOR).toBeCloseTo(DENSITY_CONTOUR_MIN_POINTS * w0 * w0, 12);
    expect(DENSITY_CONTOUR_FLOOR).toBeCloseTo(0.0886792, 7);
    expect(DENSITY_CONTOUR_MIN_POINTS).toBe(5);
  });

  it('maps one point below the first ring and caps a deep core at 5 rings', () => {
    const w0 = gaussianWeights(DENSITY_CONTOUR_SIGMA_GRID_PX, DENSITY_CONTOUR_BLUR_RADIUS)[
      DENSITY_CONTOUR_BLUR_RADIUS
    ]!;
    const rings = (points: number) => {
      const n = points * w0 * w0;
      if (n < DENSITY_CONTOUR_FLOOR) return 0;
      const o = Math.log2(n / DENSITY_CONTOUR_FLOOR) * 1.0 - 0.5;
      return o < 0 ? 0 : Math.min(Math.floor(o), 4) + 1;
    };
    expect(rings(1)).toBe(0);
    expect(rings(4)).toBe(0);
    expect(rings(7)).toBe(0);
    expect(rings(8)).toBe(1);
    expect(rings(40)).toBe(3);
    expect(rings(160)).toBe(5);
    expect(rings(1e6)).toBe(5);
  });
});
