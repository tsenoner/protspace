import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import {
  exampleFetched,
  exampleFile,
  openExample,
  refuseProductionFallback,
  serveProductDemo,
} from './helpers/examples';
import {
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  getViewState,
} from './helpers/explore';
import { STARTUP_URL_GLOB } from './helpers/fixtures';

/**
 * The product's examples, opened for real (opt-in `examples-live` project,
 * `RUN_EXAMPLES_E2E=1`, after `pnpm examples:fetch`).
 *
 * Every other scenario runs on pinned fixtures; this one opens each catalog
 * example from the file the product serves and checks what no fixture can:
 * that the bundle holds as many proteins as its manifest record says, and that
 * `?dataset=<id>` lands on the entry's curated `defaultView` without writing to
 * the URL or logging a drift warning. Each view is then captured as the Example
 * datasets page's thumbnail, `docs/explore/images/examples/<id>.png`
 * (`EXAMPLES_THUMBNAIL_DIR` redirects them, e.g. to review a candidate view
 * without touching the docs).
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const THUMBNAIL_DIR =
  process.env.EXAMPLES_THUMBNAIL_DIR ?? path.join(REPO_ROOT, 'docs/explore/images/examples');

async function waitForLegendItems(page: Page, timeout: number): Promise<void> {
  await page.waitForFunction(
    () =>
      (document.querySelector('#myLegend')?.shadowRoot?.querySelectorAll('.legend-item').length ??
        0) > 0,
    undefined,
    { timeout, polling: 250 },
  );
  // Two frames, so the scatterplot has drawn what the legend now shows.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test.describe('every example opens on its curated view', () => {
  test.beforeAll(() => {
    mkdirSync(THUMBNAIL_DIR, { recursive: true });
  });

  for (const entry of EXAMPLE_DATASETS) {
    test(`${entry.id}`, async ({ page }) => {
      const loadTimeout = entry.large ? 180_000 : 60_000;
      test.setTimeout(loadTimeout + 60_000);

      expect(
        exampleFetched(entry.id),
        `${path.relative(REPO_ROOT, exampleFile(entry.id))} is missing; run \`pnpm examples:fetch\`.`,
      ).toBe(true);

      const driftWarnings = collectDefaultViewDriftWarnings(page);
      const fallbacks = await refuseProductionFallback(page);
      await serveProductDemo(page, STARTUP_URL_GLOB);

      // Waits for the manifest's count, so the wait cannot pass on another dataset.
      await openExample(page, entry.id, { timeout: loadTimeout });
      await dismissTourIfPresent(page);
      await expect.poll(() => getViewState(page)).toEqual(curatedViewOf(entry));
      expect(await page.evaluate(() => window.location.search)).toBe(`?dataset=${entry.id}`);
      expect(driftWarnings).toEqual([]);
      expect(fallbacks).toEqual([]);

      await waitForLegendItems(page, loadTimeout);
      await page
        .locator('[data-workbench="body"]')
        .screenshot({ path: path.join(THUMBNAIL_DIR, `${entry.id}.png`) });
    });
  }
});
