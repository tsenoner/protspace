/**
 * The product's example bundles, as the dev server serves them from `apps/web/public` once
 * `pnpm examples:fetch` has run: where each file is, routing the product demo and the production
 * fallback, and opening an example by its `?dataset=` link. Shared by the opt-in `examples-live`
 * e2e project and the docs captures, so it never uses `import.meta` (the root Playwright config
 * loads it as CommonJS) and resolves files from the working directory, which is the repository
 * root under both Playwright configs.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET, findExampleDataset } from '../../src/explore/example-datasets';
import { EXAMPLE_MANIFEST } from '../../src/explore/example-manifest';
import { exampleServedPath } from '../../src/explore/example-served-path';
import { waitForExploreDataLoad } from './explore';

function publicDir(): string {
  const dir = path.join(process.cwd(), 'apps/web/public');
  if (!existsSync(dir)) {
    throw new Error(
      `No apps/web/public under ${process.cwd()}: run Playwright from the repository root`,
    );
  }
  return dir;
}

/** Absolute path of an example's bundle as the app serves it (fetched, or committed). */
export function exampleFile(id: string): string {
  const record = EXAMPLE_MANIFEST.examples[id];
  if (!record) throw new Error(`The example manifest has no "${id}"`);
  return path.join(publicDir(), exampleServedPath(record));
}

/** Whether the example's bundle is on disk; a release-hosted one needs `pnpm examples:fetch`. */
export function exampleFetched(id: string): boolean {
  return existsSync(exampleFile(id));
}

/**
 * Aborts every request to protspace.app, where a development build fetches an example it has no
 * local file for, so a missing file fails instead of loading the deployed copy. Returns the list of
 * refused URLs, which grows as requests are refused.
 */
export async function refuseProductionFallback(page: Page): Promise<string[]> {
  const refused: string[] = [];
  await page.route('https://protspace.app/**', (route) => {
    refused.push(route.request().url());
    return route.abort();
  });
  return refused;
}

/**
 * Answers the startup demo's request (matched by `startupGlob`) with the product demo, for a
 * server that pins the startup load to a test fixture (`VITE_STARTUP_DATASET_URL`).
 */
export async function serveProductDemo(page: Page, startupGlob: string): Promise<void> {
  const demo = exampleFile(DEFAULT_EXAMPLE_DATASET.id);
  await page.route(startupGlob, (route) =>
    route.fulfill({ path: demo, contentType: 'application/octet-stream' }),
  );
}

/**
 * Throws when the page loaded the e2e startup fixture (a `/@fs/…parquetbundle`) instead of the
 * product demo: the sign of a server started for the e2e suite.
 */
export async function expectProductDemo(page: Page): Promise<void> {
  const pinned = await page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/@fs/') && name.endsWith('.parquetbundle')) ?? null,
  );
  if (pinned) {
    throw new Error(
      `The app at ${new URL(page.url()).origin} loaded the E2E startup fixture (${pinned}), ` +
        'not the product demo: use a server started without VITE_STARTUP_DATASET_URL.',
    );
  }
}

/**
 * Opens `/explore?dataset=<id>` (plus `options.search`, which starts with `&`) and waits until the
 * plot holds the example: the manifest's protein count, or `options.proteinCount` for a fixture
 * served in its place. The wait defaults to 180 s for a large example, else 60 s.
 */
export async function openExample(
  page: Page,
  id: string,
  options: { search?: string; timeout?: number; proteinCount?: number } = {},
): Promise<void> {
  const entry = findExampleDataset(id);
  if (!entry) throw new Error(`The example catalog has no "${id}"`);
  const timeout = options.timeout ?? (entry.large ? 180_000 : 60_000);
  const proteinCount = options.proteinCount ?? EXAMPLE_MANIFEST.examples[id].proteins;
  await page.goto(`/explore?dataset=${encodeURIComponent(id)}${options.search ?? ''}`);
  await waitForExploreDataLoad(page, { timeout, proteinCount });
}
