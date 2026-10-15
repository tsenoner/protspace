import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { EXAMPLE_MANIFEST } from '../src/explore/example-manifest';
import { exampleServedPath } from '../src/explore/example-served-path';
import {
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  getControlBarView,
  waitForExploreDataLoad,
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
const PUBLIC_DIR = path.join(REPO_ROOT, 'apps/web/public');
const THUMBNAIL_DIR =
  process.env.EXAMPLES_THUMBNAIL_DIR ?? path.join(REPO_ROOT, 'docs/explore/images/examples');

/** Where `pnpm examples:fetch` puts a release-hosted file, or where a repo-hosted one is committed. */
function localFile(id: string): string {
  return path.join(PUBLIC_DIR, exampleServedPath(EXAMPLE_MANIFEST.examples[id]));
}

/**
 * The Playwright web server points the startup demo at a test fixture
 * (`VITE_STARTUP_DATASET_URL`); this project photographs the product, so the
 * demo's requests get the product demo back.
 */
async function serveProductDemo(page: Page): Promise<void> {
  const demo = EXAMPLE_DATASETS[0];
  await page.route(STARTUP_URL_GLOB, (route) =>
    route.fulfill({ path: localFile(demo.id), contentType: 'application/octet-stream' }),
  );
}

/**
 * A development build fetches a missing example from protspace.app; refuse
 * that, so a missing local file fails here instead of testing the deployed copy.
 */
async function refuseProductionFallback(page: Page, fallbacks: string[]): Promise<void> {
  await page.route('https://protspace.app/**', (route) => {
    fallbacks.push(route.request().url());
    return route.abort();
  });
}

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

      const record = EXAMPLE_MANIFEST.examples[entry.id];
      expect(
        existsSync(localFile(entry.id)),
        `${path.relative(REPO_ROOT, localFile(entry.id))} is missing; run \`pnpm examples:fetch\`.`,
      ).toBe(true);

      const driftWarnings = collectDefaultViewDriftWarnings(page);
      const fallbacks: string[] = [];
      await refuseProductionFallback(page, fallbacks);
      await serveProductDemo(page);

      await page.goto(`/explore?dataset=${entry.id}`);
      await dismissTourIfPresent(page);
      // The manifest's count, so the wait cannot pass on another dataset.
      await waitForExploreDataLoad(page, { timeout: loadTimeout, proteinCount: record.proteins });
      await expect.poll(() => getControlBarView(page)).toEqual(curatedViewOf(entry));
      expect(await page.evaluate(() => window.location.search)).toBe(`?dataset=${entry.id}`);
      expect(driftWarnings).toEqual([]);
      expect(fallbacks).toEqual([]);

      await waitForLegendItems(page, loadTimeout);
      await page
        .locator('.visualization-container')
        .screenshot({ path: path.join(THUMBNAIL_DIR, `${entry.id}.png`) });
    });
  }
});
