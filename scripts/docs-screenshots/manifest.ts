import type { CaptureEntry } from './capture-plan';
import { CONTROLS_CAPTURES } from './scenes/controls';
import { EXAMPLE_CAPTURES } from './scenes/examples';
import { LEGEND_CAPTURES } from './scenes/legend';
import { OVERVIEW_CAPTURES } from './scenes/overview';
import { SCATTERPLOT_CAPTURES } from './scenes/scatterplot';

/** Every docs image, one entry each; the scenes are grouped by the docs page that shows them. */
export const MANIFEST: readonly CaptureEntry[] = [
  ...EXAMPLE_CAPTURES,
  ...SCATTERPLOT_CAPTURES,
  ...CONTROLS_CAPTURES,
  ...OVERVIEW_CAPTURES,
  ...LEGEND_CAPTURES,
];
