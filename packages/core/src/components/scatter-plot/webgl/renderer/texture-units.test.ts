import { describe, it, expect } from 'vitest';
import {
  DENSITY_FIELD_UNITS,
  LABEL_ATLAS_TEXTURE_UNIT,
  MARK_TEXTURE_UNIT,
  RECORD_STYLE_TEXTURE_UNIT,
  SCRATCH_TEXTURE_UNIT,
} from './texture-units';

const POINT_DRAW_UNITS = [LABEL_ATLAS_TEXTURE_UNIT, MARK_TEXTURE_UNIT, RECORD_STYLE_TEXTURE_UNIT];

describe('texture units', () => {
  // The composite unbinds its fields, and only the atlas is bound again before
  // the second point pass. A category cap of 24 would put a field on the marks.
  it('keeps every density field off the atlas, mark and table units', () => {
    for (const unit of DENSITY_FIELD_UNITS) expect(POINT_DRAW_UNITS).not.toContain(unit);
  });

  it('gives each point-draw sampler its own unit, clear of scratch', () => {
    expect(new Set([SCRATCH_TEXTURE_UNIT, ...POINT_DRAW_UNITS]).size).toBe(4);
  });

  it('stays within the 16 units WebGL2 guarantees a shader stage', () => {
    for (const unit of [SCRATCH_TEXTURE_UNIT, ...POINT_DRAW_UNITS, ...DENSITY_FIELD_UNITS]) {
      expect(unit).toBeLessThan(16);
    }
  });
});
