import { describe, expect, it } from 'vitest';
import { POINT_FRAGMENT_SHADER, POINT_VERTEX_SHADER } from './export-shaders';

describe('point shaders', () => {
  it('passes the transferred-annotation flag through as a flat varying', () => {
    expect(POINT_VERTEX_SHADER).toContain('in float a_predicted;');
    expect(POINT_VERTEX_SHADER).toContain('flat out float v_predicted;');
    expect(POINT_VERTEX_SHADER).toContain('v_predicted = a_predicted;');
    expect(POINT_FRAGMENT_SHADER).toContain('flat in float v_predicted;');
  });

  it('cuts out glyph interiors only for transferred annotations', () => {
    expect(POINT_FRAGMENT_SHADER).toContain('if (v_predicted > 0.5)');
    expect(POINT_FRAGMENT_SHADER).toContain('shapeAlpha *= 1.0 - interior;');
    expect(POINT_FRAGMENT_SHADER).toContain('v_predicted < 0.5');
    expect(POINT_FRAGMENT_SHADER).toContain('clamp(aa * 1.75, 0.22, 0.42)');
    expect(POINT_FRAGMENT_SHADER).toContain('min(aa, (1.0 - ringWidth) * 0.5)');
  });
});
