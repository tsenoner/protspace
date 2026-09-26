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
const FORTY_K_COUNT = 40026;

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

async function getDatasetName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { currentDatasetName?: string })
      | null;
    return controlBar?.currentDatasetName ?? null;
  });
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

  test('an annotation set before a menu choice survives Back (1a repro)', async ({ page }) => {
    // Demo has an 'ec' annotation; 5K's default annotation is 'phylum' (see
    // the deep-link-with-view-param test below), so switching demo -> 5K
    // forces a normalization write. That write must land on the NEW history
    // entry (dataset=5K), not the one still holding demo+ec.
    await page.goto('/explore?annotation=ec');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');

    await chooseExampleFromMenu(page, '5K');
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
  });

  test('Back/Forward through a menu choice and a view pick keeps the target entry intact (1b repro)', async ({
    page,
  }) => {
    // Repro from the review: ?dataset=5K -> choose demo from the menu ->
    // pick annotation 'ec' (push) -> Back x2 -> history.go(2) should land
    // back on the demo+ec entry unchanged; 5K's data must never be used to
    // normalize it.
    await page.goto('/explore?dataset=5K');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, FIVE_K_COUNT);

    await chooseExampleFromMenu(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');

    const controlBar = page.locator('protspace-control-bar');
    await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
    await controlBar.locator('.dropdown-item[data-annotation="ec"]').click();
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe('ec');

    await page.goBack();
    await expectDatasetParam(page, 'demo');
    await page.goBack();
    await expectDatasetParam(page, '5K');
    await waitForProteinCount(page, FIVE_K_COUNT);

    await page.evaluate(() => history.go(2));
    await expectDatasetParam(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe('ec');
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

  test('rapid Back past a still-loading entry lands on the newer example, not a stale fallback (1c repro)', async ({
    page,
  }) => {
    // Regression: history null -> 5K -> phosphatase -> demo. Back once (to
    // phosphatase) starts a fresh fetch for it; before that fetch settles,
    // Back again (to 5K) starts and finishes loading 5K. The stale
    // phosphatase request must then resolve as "superseded" and do nothing —
    // previously it resolved `false`, which `loadRequestedDatasetOrFallback`
    // treated as a real failure and used to run the persisted-or-default
    // fallback (the demo), stomping the correctly-loaded 5K and deleting
    // `dataset=` from the URL.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await chooseExampleFromMenu(page, '5K');
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');

    await chooseExampleFromMenu(page, 'phosphatase');
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
    await expectDatasetParam(page, 'phosphatase');

    await chooseExampleFromMenu(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');

    // Hold the *next* fetch of the phosphatase bundle — the one Back is
    // about to trigger — open until explicitly released.
    let releasePhosphatase: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releasePhosphatase = resolve;
    });
    await page.route('**/data/phosphatase.parquetbundle', async (route) => {
      await gate;
      await route.continue();
    });

    await page.goBack(); // -> dataset=phosphatase, fetch held by the route above
    await expectDatasetParam(page, 'phosphatase');

    await page.goBack(); // -> dataset=5K, fetch not held, loads normally
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');

    // Now let the stale phosphatase fetch through. A correct implementation
    // must abandon it silently.
    releasePhosphatase();
    // Give any (incorrect) fallback a moment to happen, then assert nothing
    // moved off the 5K entry a Back landed on.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');
  });

  test('a corrupt bundle changes nothing and leaves the item retryable', async ({ page }) => {
    // Distinct from the 500 case above: the fetch itself succeeds (200), so
    // this exercises the parse-failure ('data-error') path in
    // dataset-controller.ts's handleDataError, not the fetch-catch path in
    // persisted-dataset.ts's loadExampleDataset.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await page.route('**/data/phosphatase.parquetbundle', (route) =>
      route.fulfill({ status: 200, body: 'not-a-valid-bundle' }),
    );

    const datasetNameBefore = await getDatasetName(page);

    await chooseExampleFromMenu(page, 'phosphatase');

    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    await expectDatasetParam(page, null);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getDatasetName(page)).toBe(datasetNameBefore);
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
    expect(await isExampleDisabled(page, 'phosphatase')).toBe(false);
  });

  test('rapid Back past a decoding example keeps the target entry intact (2 repro)', async ({
    page,
  }) => {
    // Regression: start at ?dataset=5K&annotation=phylum. Choose 40K from
    // the menu, then the demo — history is now [5K+phylum, 40K+<its
    // default>, demo+<its default>]. Back once (-> the 40K entry) starts
    // loading 40K again; before that finishes decoding, Back again (-> the
    // 5K entry) starts loading 5K. 40K's load must not be allowed to resolve
    // the still-pending view request (now 'phylum', recorded for 5K) against
    // ITS OWN data and write the result onto the URL: previously that raced
    // and could replace-write 40K's default annotation
    // (`protein_existence`) onto the 5K entry, and briefly show 40K's plot
    // under `dataset=5K`.
    await page.goto('/explore?dataset=5K&annotation=phylum');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('phylum');

    await chooseExampleFromMenu(page, '40K');
    await waitForProteinCount(page, FORTY_K_COUNT);
    await expectDatasetParam(page, '40K');

    await chooseExampleFromMenu(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');

    // Hold the *next* fetch of the 40K bundle open until released, so its
    // decode is still in flight when the second Back fires just after.
    let release40K: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release40K = resolve;
    });
    await page.route('**/data/40K.parquetbundle', async (route) => {
      await gate;
      await route.continue();
    });

    await page.goBack(); // -> dataset=40K, fetch held by the route above
    await expectDatasetParam(page, '40K');

    release40K();
    // Give the (now-unblocked) fetch a moment to land before Back again, so
    // the race is against 40K's decode specifically, not its network fetch.
    await page.waitForTimeout(150);
    await page.goBack(); // -> dataset=5K, while 40K may still be decoding
    await waitForProteinCount(page, FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');

    // A correct implementation never lets the superseded 40K load touch the
    // view or the URL once it finishes decoding.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(FIVE_K_COUNT);
    await expectDatasetParam(page, '5K');
    expect(await getSelectedAnnotation(page)).toBe('phylum');
    expect(
      await page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')),
    ).toBe('phylum');
  });
});
