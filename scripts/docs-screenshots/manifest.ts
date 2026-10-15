import type { CaptureEntry } from './capture-plan';
import { EXAMPLE_CAPTURES } from './scenes/examples';

/** Every docs image, one entry each; the scenes are grouped by the docs page that shows them. */
export const MANIFEST: readonly CaptureEntry[] = [...EXAMPLE_CAPTURES];
