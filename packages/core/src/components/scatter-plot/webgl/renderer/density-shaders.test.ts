import { describe, it, expect } from 'vitest';
import {
  gaussianWeights,
  DENSITY_SIGMA_GRID_PX,
  DENSITY_BLUR_RADIUS,
  DENSITY_ACCUM_VERTEX_SHADER,
  DENSITY_BLUR_FRAGMENT_SHADER,
  DENSITY_COMPOSITE_FRAGMENT_SHADER,
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
});
