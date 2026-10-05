/**
 * Every texture unit the renderer binds. The point draws sample the label atlas,
 * the marks and the record table; the density composite samples the fields.
 * Unit 0 is scratch: the gamma quad and the blur sample there, uploads leave it
 * active, and the first field takes it.
 */

import { DENSITY_CATEGORY_CAP } from './density-shaders';

export const SCRATCH_TEXTURE_UNIT = 0;
export const LABEL_ATLAS_TEXTURE_UNIT = 1;
export const MARK_TEXTURE_UNIT = 6;
export const RECORD_STYLE_TEXTURE_UNIT = 7;

/**
 * One field per four categories. The composite runs between the point passes and
 * only the atlas is bound again after it, so the fields skip the atlas unit and
 * must stay below the mark and table units.
 */
export const DENSITY_FIELD_UNITS = Array.from({ length: DENSITY_CATEGORY_CAP / 4 }, (_, g) =>
  g < LABEL_ATLAS_TEXTURE_UNIT ? g : g + 1,
);
