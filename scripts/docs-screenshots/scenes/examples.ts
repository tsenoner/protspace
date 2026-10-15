import { expect } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../../../apps/web/src/explore/example-datasets';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import type { CaptureEntry } from '../capture-plan';

/**
 * The Example datasets page's thumbnails, one per catalog example in menu order: the workbench
 * body on the example's curated view, light, at 1× (they show at thumbnail size, and 2× would
 * quadruple five files for nothing). They came from the `examples-live` e2e project before.
 */
export const EXAMPLE_CAPTURES: CaptureEntry[] = EXAMPLE_DATASETS.map((example) => ({
  name: `examples/${example.id}`,
  kind: 'png',
  viewport: 'desktop',
  scale: 1,
  themes: ['light'],
  dataset: example.id,
  ...(example.large && { timeoutMs: 240_000 }),
  steps: async (page) => {
    await expect.poll(async () => (await legendRowValues(page)).length).toBeGreaterThan(0);
  },
  target: (page) => page.locator('[data-workbench="body"]'),
  docs: ['explore/example-datasets.md'],
}));
