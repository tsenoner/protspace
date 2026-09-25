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

function cameraLines(src: string): string[] {
  return src
    .split('\n')
    .filter((line) => /vec2 (cssTransformed|physicalPos|clipSpace) =/.test(line));
}

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

  it('bakes a second, wider kernel for the contour style', () => {
    expect((DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER.match(/texture\(u_source/g) ?? []).length).toBe(
      19,
    );
    expect(DENSITY_CONTOUR_BLUR_FRAGMENT_SHADER).toContain('uniform vec2 u_direction;');
  });
});

describe('DENSITY_ACCUM_VERTEX_SHADER', () => {
  it('carries the point shader camera lines byte-identically', () => {
    const point = cameraLines(POINT_VERTEX_SHADER);
    expect(point).toHaveLength(3);
    expect(cameraLines(DENSITY_ACCUM_VERTEX_SHADER)).toEqual(point);
  });

  it('declares the camera uniforms with the point shader types', () => {
    const point = cameraUniforms(POINT_VERTEX_SHADER);
    expect(point).toHaveLength(4);
    expect(cameraUniforms(DENSITY_ACCUM_VERTEX_SHADER)).toEqual(point);
  });

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

  it('writes premultiplied linear colour', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).toContain('fragColor = vec4(mean * alpha, alpha);');
  });

  it('carries no contour branch', () => {
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).not.toContain('u_style');
    expect(DENSITY_COMPOSITE_FRAGMENT_SHADER).not.toContain('u_contourFloor');
  });
});

describe('DENSITY_CATEGORY_ACCUM_VERTEX_SHADER', () => {
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
    expect(src).toContain('step(w, 1.0)');
    expect(src).not.toContain('u_densityScaler');
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
