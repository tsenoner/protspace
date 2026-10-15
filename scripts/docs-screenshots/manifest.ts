import type { CaptureEntry } from './capture-plan';
import { CONTROLS_CAPTURES } from './scenes/controls';
import { EAT_CAPTURES } from './scenes/eat';
import { EXAMPLE_CAPTURES } from './scenes/examples';
import { FIGURE_EDITOR_CAPTURES } from './scenes/figure-editor';
import { LEGEND_CAPTURES } from './scenes/legend';
import { OVERVIEW_CAPTURES } from './scenes/overview';
import { SCATTERPLOT_CAPTURES } from './scenes/scatterplot';
import { STRUCTURE_CAPTURES } from './scenes/structures';

/** Every docs image, one entry each; the scenes are grouped by the docs page that shows them. */
export const MANIFEST: readonly CaptureEntry[] = [
  ...EXAMPLE_CAPTURES,
  ...SCATTERPLOT_CAPTURES,
  ...CONTROLS_CAPTURES,
  ...OVERVIEW_CAPTURES,
  ...LEGEND_CAPTURES,
  ...STRUCTURE_CAPTURES,
  ...FIGURE_EDITOR_CAPTURES,
  ...EAT_CAPTURES,
];
