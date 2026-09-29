import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { findExampleDataset } from '../src/explore/example-datasets';
import {
  dismissTourIfPresent,
  getCurrentDatasetName,
  getProteinCount,
  openImportMenu,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';

/**
 * Covers `openspec/specs/example-datasets`: the Import menu's "Examples"
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

async function chooseExampleFromMenu(page: Page, id: string): Promise<void> {
  await openImportMenu(page);
  await page.locator(`protspace-control-bar [data-example-id="${id}"]`).click();
}

/** Opens the menu, reads whether `id`'s item is disabled, and leaves the menu open. */
async function isExampleDisabled(page: Page, id: string): Promise<boolean> {
  await openImportMenu(page);
  return page.locator(`protspace-control-bar [data-example-id="${id}"]`).isDisabled();
}

interface ControlBarView {
  annotation: string | null;
  projection: string | null;
  tooltip: string[];
}

async function getControlBarView(page: Page): Promise<ControlBarView> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjection?: string;
          tooltipAnnotations?: string[];
        })
      | null;
    return {
      annotation: controlBar?.selectedAnnotation ?? null,
      projection: controlBar?.selectedProjection ?? null,
      tooltip: [...(controlBar?.tooltipAnnotations ?? [])],
    };
  });
}

/** The catalog's curated view for `id`, in the shape `getControlBarView` reads. */
function curatedView(id: string): ControlBarView {
  const entry = findExampleDataset(id);
  if (!entry) {
    throw new Error(`Catalog is missing the "${id}" example used by this test.`);
  }
  return {
    annotation: entry.defaultView.annotation,
    projection: entry.defaultView.projection,
    tooltip: [...(entry.defaultView.tooltip ?? [])],
  };
}

async function getSearch(page: Page): Promise<string> {
  return page.evaluate(() => window.location.search);
}

/**
 * Collects the development-mode warnings `dataset-controller.ts` logs when a
 * loaded example's bundle lacks one of its `defaultView` names.
 */
function collectDefaultViewDriftWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('defaultView names missing')) {
      warnings.push(message.text());
    }
  });
  return warnings;
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
    // Demo has an 'ec' annotation and 5K does not. The menu choice pushes a
    // bare `dataset=5K` entry (5K opens on its curated view); the entry
    // still holding demo+ec must stay untouched, so Back restores 'ec'.
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
    // 'phylum' is 5K's curated annotation, so it would pass even if the
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

    const datasetNameBefore = await getCurrentDatasetName(page);

    await chooseExampleFromMenu(page, 'phosphatase');

    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    await expectDatasetParam(page, null);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getCurrentDatasetName(page)).toBe(datasetNameBefore);
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
    expect(await isExampleDisabled(page, 'phosphatase')).toBe(false);
  });

  test('rapid Back past a decoding example keeps the target entry intact (2 repro)', async ({
    page,
  }) => {
    // Regression: start at ?dataset=5K&annotation=phylum. Choose 40K from
    // the menu, then the demo — history is now [5K+phylum, bare 40K, bare
    // demo]. Back once (-> the 40K entry) starts loading 40K again; before
    // that finishes decoding, Back again (-> the 5K entry) starts loading
    // 5K. 40K's load must not be allowed to resolve the still-pending view
    // request (now 'phylum', recorded for 5K) against ITS OWN data and write
    // the result onto the URL: previously that raced and could replace-write
    // 40K's fallback annotation onto the 5K entry, and briefly show 40K's
    // plot under `dataset=5K`.
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

test.describe('Example datasets: curated default view', () => {
  test('a menu choice opens the curated view on a bare entry, and Back restores the previous view', async ({
    page,
  }) => {
    const driftWarnings = collectDefaultViewDriftWarnings(page);
    // The demo and the phosphatase bundle both have 'ec' and 'pfam', so any
    // carry-over of the previous view into the new example would show here.
    await page.goto('/explore?annotation=ec&tooltip=pfam');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect
      .poll(() => getControlBarView(page))
      .toMatchObject({ annotation: 'ec', tooltip: ['pfam'] });

    await chooseExampleFromMenu(page, 'phosphatase');
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
    await expect.poll(() => getSearch(page)).toBe('?dataset=phosphatase');
    await expect.poll(() => getControlBarView(page)).toEqual(curatedView('phosphatase'));

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect
      .poll(() => getControlBarView(page))
      .toMatchObject({ annotation: 'ec', tooltip: ['pfam'] });
    expect(await getSearch(page)).toBe('?annotation=ec&tooltip=pfam');
    expect(driftWarnings).toEqual([]);
  });

  test('a bare deep link opens the curated view and writes nothing to the URL', async ({
    page,
  }) => {
    const driftWarnings = collectDefaultViewDriftWarnings(page);

    await page.goto('/explore?dataset=phosphatase');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);

    await expect.poll(() => getControlBarView(page)).toEqual(curatedView('phosphatase'));
    expect(await getSearch(page)).toBe('?dataset=phosphatase');
    expect(driftWarnings).toEqual([]);
  });

  test('Back to a bare entry of the same example lands on its curated view again', async ({
    page,
  }) => {
    const curated = curatedView('phosphatase');
    await page.goto('/explore?dataset=phosphatase');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);
    await expect.poll(() => getControlBarView(page)).toEqual(curated);

    const controlBar = page.locator('protspace-control-bar');
    await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
    await controlBar.locator('.dropdown-item[data-annotation="pfam"]').click();
    await expect.poll(() => getControlBarView(page)).toMatchObject({ annotation: 'pfam' });
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe('pfam');

    await page.goBack();
    await expect.poll(() => getSearch(page)).toBe('?dataset=phosphatase');
    await expect.poll(() => getControlBarView(page)).toEqual(curated);
  });

  test('explicit deep-link view params win over the curated view', async ({ page }) => {
    const curated = curatedView('phosphatase');

    await page.goto('/explore?dataset=phosphatase&annotation=pfam');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);

    // Any view param makes the request the user's: the missing projection
    // comes from the curated view, and an absent tooltip means none.
    await expect
      .poll(() => getControlBarView(page))
      .toEqual({ annotation: 'pfam', projection: curated.projection, tooltip: [] });
    expect(await getSearch(page)).toBe('?dataset=phosphatase&annotation=pfam');
  });

  test('an invalid annotation falls back to the curated one and is normalized in the URL', async ({
    page,
  }) => {
    const curated = curatedView('phosphatase');

    await page.goto('/explore?dataset=phosphatase&annotation=not_a_column');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, PHOSPHATASE_COUNT);

    await expect
      .poll(() => getControlBarView(page))
      .toEqual({ annotation: curated.annotation, projection: curated.projection, tooltip: [] });
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe(curated.annotation);
  });
});
