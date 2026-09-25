import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { findExampleDataset } from '../src/explore/example-datasets';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
  waitForPersistedExploreDataset,
} from './helpers/explore';

/**
 * Covers `openspec/changes/example-datasets`: the Import menu's "Examples"
 * section and the `?dataset=` deep link (task 5.1). Uses the real local
 * bundles under `apps/web/public/data/` — the only mocked request is the
 * induced-failure scenario, which routes a single bundle URL to a 500.
 *
 * Protein counts below are read from the bundles themselves (see the sibling
 * specs that hardcode the same numbers, e.g. `CUSTOM_5K_PROTEIN_COUNT` in
 * `dataset-reload.spec.ts`) and double as a cheap "which dataset is showing"
 * signal without depending on annotation names.
 */

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const PUBLIC_DATA_DIR = path.resolve(SPEC_DIR, '../public/data');

const DEMO_COUNT = 7831;
const FIVE_K_COUNT = 5181;
const PHOSPHATASE_COUNT = 1587;

const PHOSPHATASE_BUNDLE_PATH = path.join(PUBLIC_DATA_DIR, 'phosphatase.parquetbundle');

async function getProteinCount(page: Page): Promise<number> {
  const count = await page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as { data?: { protein_ids?: string[] } } | null;
    return plot?.data?.protein_ids?.length ?? 0;
  });
  return Number(count);
}

async function waitForProteinCount(page: Page, expected: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const plot = document.querySelector('#myPlot') as {
        data?: { protein_ids?: string[] };
      } | null;
      return plot?.data?.protein_ids?.length === target;
    },
    expected,
    { timeout, polling: 500 },
  );
  await page
    .locator('#progressive-loading')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => {});
}

async function getSelectedAnnotation(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { selectedAnnotation?: string })
      | null;
    return controlBar?.selectedAnnotation ?? null;
  });
}

async function getDatasetParam(page: Page): Promise<string | null> {
  return page.evaluate(() => new URL(window.location.href).searchParams.get('dataset'));
}

async function expectDatasetParam(page: Page, expected: string | null): Promise<void> {
  await expect.poll(() => getDatasetParam(page)).toBe(expected);
}

/** Mirrors `dataset-reload.spec.ts`'s helper: open the menu only if it's closed. */
async function openImportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const ownDataset = page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]');
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  }
  await expect(ownDataset).toBeVisible();
}

async function chooseExampleFromMenu(page: Page, id: string): Promise<void> {
  await openImportMenu(page);
  await page.locator(`protspace-control-bar [data-example-id="${id}"]`).click();
}

/** Opens the menu, reads whether `id`'s item is disabled, and leaves the menu open. */
async function isExampleDisabled(page: Page, id: string): Promise<boolean> {
  await openImportMenu(page);
  return page.locator(`protspace-control-bar [data-example-id="${id}"]`).isDisabled();
}

async function importUserFile(page: Page, filePath: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.locator('protspace-data-loader').locator('input[type="file"]').setInputFiles(filePath);
}

test.describe('Example datasets: Import menu and deep link', () => {
  test('a deep link loads the example without touching the stored user import', async ({
    page,
  }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    // Store a user import so we can tell "deep link fell back to it" apart
    // from "deep link fell back to the demo".
    await importUserFile(page, PHOSPHATASE_BUNDLE_PATH);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
    await waitForPersistedExploreDataset(page);

    // Opening a `?dataset=` deep link must load that example and must not
    // clear the stored import.
    await page.goto('/explore?dataset=5K');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, FIVE_K_COUNT);

    // Opening the app again with no `dataset` param restores the stored import.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
  });

  test('menu choices push dataset= and Back/Forward walk through them', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    const initialHistoryLength = await page.evaluate(() => history.length);

    await chooseExampleFromMenu(page, '5K');
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');
    await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
    expect(await isExampleDisabled(page, '5K')).toBe(true);

    await chooseExampleFromMenu(page, 'phosphatase');
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
    await expectDatasetParam(page, 'phosphatase');

    await page.goBack();
    await expectDatasetParam(page, '5K');
    await waitForProteinCount(page, FIVE_K_COUNT);

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
  });

  test('importing a user file removes dataset= without a new history entry', async ({ page }) => {
    await page.goto('/explore?dataset=5K');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');

    const historyLengthBeforeImport = await page.evaluate(() => history.length);

    await importUserFile(page, PHOSPHATASE_BUNDLE_PATH);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);

    await expectDatasetParam(page, null);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(historyLengthBeforeImport);
  });

  test('an unknown dataset id warns, removes the param, and falls back to the demo', async ({
    page,
  }) => {
    await page.goto('/explore?seed=baseline');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    const baselineHistoryLength = await page.evaluate(() => history.length);

    await page.goto('/explore?dataset=nope');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await expect(page.getByText('Unknown example dataset "nope".')).toBeVisible();
    await expectDatasetParam(page, null);
    // The navigation itself is one history entry; the app's own removal of
    // the unknown param must be a `replace`, adding none of its own.
    await expect.poll(() => page.evaluate(() => history.length)).toBe(baselineHistoryLength + 1);
  });

  test('a deep link with a view param selects that annotation on the example', async ({ page }) => {
    // 'phylum' is 5K's default annotation, so it would pass even if the
    // param were ignored; 'length_fixed' is not, so it actually proves the
    // param was applied.
    await page.goto('/explore?dataset=5K&annotation=length_fixed');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, FIVE_K_COUNT);

    await expect.poll(() => getSelectedAnnotation(page)).toBe('length_fixed');
  });

  test('a failed menu choice leaves the previous dataset and URL unchanged', async ({ page }) => {
    const phosphatase = findExampleDataset('phosphatase');
    if (!phosphatase) {
      throw new Error('Catalog is missing the "phosphatase" example used by this test.');
    }

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await page.route('**/data/phosphatase.parquetbundle', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await chooseExampleFromMenu(page, 'phosphatase');

    await expect(page.getByText(`Couldn't load "${phosphatase.label}".`)).toBeVisible();
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    await expectDatasetParam(page, null);
    // The failed load never reported a change, so the demo item is still the
    // one shown as loaded.
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
  });
});
