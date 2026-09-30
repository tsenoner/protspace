import { expect, test, type Page, type Route } from '@playwright/test';
import {
  EXAMPLE_DATASETS,
  EXAMPLES_DOCS_URL,
  findExampleDataset,
  formatMegabytes,
  type ExampleDataset,
} from '../src/explore/example-datasets';
import {
  clickLegendItem,
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  getControlBarView,
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  isLegendItemHidden,
  openImportMenu,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
  waitForPersistedExploreDataset,
  waitForProteinCount,
  type ControlBarView,
} from './helpers/explore';
import {
  EAT_ROLE_BUNDLED_THRESHOLD,
  e2eExample,
  exampleBundleGlob,
  serveExampleFixtures,
} from './helpers/example-fixtures';
import {
  PE1_40026_FIXTURE,
  PHOSPHATASE_1587_FIXTURE,
  STARTUP_DATASET_URL,
} from './helpers/fixtures';
import { clearOpfs, seedOpfsState } from './helpers/opfs';

/**
 * Covers `openspec/specs/example-datasets`: the Import menu's "Examples"
 * section and the `?dataset=` deep link, with their history and race
 * mechanics. Every example the suite loads is served from a pinned fixture
 * (`helpers/example-fixtures.ts`), and the startup demo is pinned by the web
 * server, so nothing here depends on what the product's examples hold. The
 * scenarios name examples by role (`SMALL`, `OTHER`, `SLOW`, `EAT`); the
 * annotation names they pick belong to those roles' fixtures.
 *
 * Protein counts double as a cheap "which dataset is showing" signal without
 * depending on annotation names.
 */

/** The pinned startup demo (`demo_toxprot_7831`). */
const DEMO_COUNT = 7831;

/** The catalog examples this suite loads, each served from a fixture. */
const SMALL = e2eExample('small');
const OTHER = e2eExample('other');
const SLOW = e2eExample('slow');
const EAT = e2eExample('eat');

/** A user import, never a catalog example. */
const USER_IMPORT_PATH = PHOSPHATASE_1587_FIXTURE;
const USER_IMPORT_COUNT = 1587;

async function getSelectedAnnotation(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { selectedAnnotation?: string })
      | null;
    return controlBar?.selectedAnnotation ?? null;
  });
}

async function getDensityLayer(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { densityLayer?: string })
      | null;
    return controlBar?.densityLayer ?? null;
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

/** The catalog's curated view for `id`, in the shape `getControlBarView` reads. */
function curatedView(id: string): ControlBarView {
  const entry = findExampleDataset(id);
  if (!entry) {
    throw new Error(`Catalog is missing the "${id}" example used by this test.`);
  }
  return curatedViewOf(entry);
}

async function getSearch(page: Page): Promise<string> {
  return page.evaluate(() => window.location.search);
}

async function getUrlParam(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => new URL(window.location.href).searchParams.get(name), key);
}

/** Picks `annotation` in the control bar's annotation dropdown (a user change, so a push). */
async function pickAnnotation(page: Page, annotation: string): Promise<void> {
  const controlBar = page.locator('protspace-control-bar');
  await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
  await controlBar.locator(`.dropdown-item[data-annotation="${annotation}"]`).click();
  await expect.poll(() => getSelectedAnnotation(page)).toBe(annotation);
}

/**
 * Holds the next request matching `glob` until the returned function is
 * called. The page may abort the held request meanwhile (a cancelled or
 * superseded download), so continuing it is allowed to fail.
 */
async function holdNextRequest(page: Page, glob: string): Promise<() => void> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    glob,
    async (route) => {
      await gate;
      await route.fallback().catch(() => {});
    },
    { times: 1 },
  );
  return release;
}

/** The error toast for a failed example download, and its Retry button. */
function exampleFailureToast(page: Page, id: string) {
  const entry = findExampleDataset(id);
  if (!entry) {
    throw new Error(`Catalog is missing the "${id}" example used by this test.`);
  }
  const toast = page.locator('[data-sonner-toast]', {
    hasText: `Couldn't load "${entry.label}".`,
  });
  return { toast, retry: toast.getByRole('button', { name: 'Retry' }) };
}

const failWith500 = (route: Route) => route.fulfill({ status: 500, body: 'Internal Server Error' });

/** Whether any saved legend state in this browser hides `value`. */
async function isHiddenInSavedLegend(page: Page, value: string): Promise<boolean> {
  return page.evaluate((target) => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('protspace:legend:')) continue;
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      if ((settings.hiddenValues ?? []).includes(target)) return true;
    }
    return false;
  }, value);
}

/** Hides the first legend category and waits until the change is saved. */
async function hideFirstLegendCategory(page: Page): Promise<string> {
  const value = await getFirstLegendItemValue(page);
  await clickLegendItem(page, value);
  await expect.poll(() => isLegendItemHidden(page, value)).toBe(true);
  await expect.poll(() => isHiddenInSavedLegend(page, value)).toBe(true);
  return value;
}

async function importUserFile(page: Page, filePath: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.locator('protspace-data-loader').locator('input[type="file"]').setInputFiles(filePath);
}

// Every example is served from its fixture, and none may open with a
// `defaultView` name its fixture lacks.
let driftWarnings: string[] = [];
test.beforeEach(async ({ page }) => {
  await serveExampleFixtures(page);
  driftWarnings = collectDefaultViewDriftWarnings(page);
});
test.afterEach(() => {
  expect(driftWarnings, 'an example opened with defaultView names its fixture lacks').toEqual([]);
});

test.describe('Example datasets: the suite runs on its pinned startup demo', () => {
  test('the startup load comes from the fixture, not the product demo', async ({ page }) => {
    // Every count, column and legend assertion on the demo in this suite is
    // about the fixture. If this fails, the dev server was started without
    // VITE_STARTUP_DATASET_URL (see playwright.config.ts): stop a dev server
    // left running before the suite.
    const startupRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.parquetbundle')) startupRequests.push(request.url());
    });
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await waitForProteinCount(page, DEMO_COUNT);

    expect(startupRequests.map((url) => new URL(url).pathname)).toEqual([STARTUP_DATASET_URL]);
  });
});

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
    await importUserFile(page, USER_IMPORT_PATH);
    await waitForProteinCount(page, USER_IMPORT_COUNT);
    await waitForPersistedExploreDataset(page);

    // Opening a `?dataset=` deep link must load that example and must not
    // clear the stored import.
    await page.goto(`/explore?dataset=${SMALL.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);

    // Opening the app again with no `dataset` param restores the stored import.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, USER_IMPORT_COUNT);
  });

  test('a deep link fetches its bundle from the app base under a trailing-slash /explore/', async ({
    page,
  }) => {
    // The app boots on the route. This says nothing about relative catalog
    // URLs: the web server pins the startup demo to an absolute `/@fs/…` URL,
    // which `resolveExampleUrl` passes through unchanged. The demo's own
    // `./data.parquetbundle` is covered by `example-fetch.test.ts` and
    // `example-url.test.ts`.
    await page.goto('/explore/');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    // Catalog URLs are relative (`./data/…` or `./examples/…`); resolved
    // against this route they would hit /explore/…, which the SPA fallback
    // answers with HTML. The fixture route's `**/` glob matches either path,
    // so the request itself must show the bundle was asked for at the app
    // base.
    const request = page.waitForRequest(SMALL.glob);
    await page.goto(`/explore/?dataset=${SMALL.id}`);
    expect(new URL((await request).url()).pathname).toBe(
      `/${SMALL.entry.url.replace(/^\.\//, '')}`,
    );
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);
  });

  test('menu choices push dataset= and Back/Forward walk through them', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    const initialHistoryLength = await page.evaluate(() => history.length);

    await chooseExampleFromMenu(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
    expect(await isExampleDisabled(page, SMALL.id)).toBe(true);

    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);
    await expectDatasetParam(page, OTHER.id);

    await page.goBack();
    await expectDatasetParam(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
  });

  test('an annotation and contours set before a menu choice survive Back (1a repro)', async ({
    page,
  }) => {
    // Demo has an 'ec' annotation and SMALL does not. The menu choice pushes a
    // bare `dataset=SMALL` entry (SMALL opens on its curated view, contours
    // Off); the entry still holding demo+ec+contours must stay untouched, so
    // Back restores both.
    await page.goto('/explore?annotation=ec&density=on');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
    await expect.poll(() => getDensityLayer(page)).toBe('on');

    await chooseExampleFromMenu(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);
    await expect.poll(() => getDensityLayer(page)).toBe('off');
    expect(await getUrlParam(page, 'density')).toBeNull();

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
    await expect.poll(() => getDensityLayer(page)).toBe('on');
  });

  test('Back/Forward through a menu choice and a view pick keeps the target entry intact (1b repro)', async ({
    page,
  }) => {
    // Repro from the review: ?dataset=SMALL -> choose demo from the menu ->
    // pick annotation 'ec' (push) -> Back x2 -> history.go(2) should land
    // back on the demo+ec entry unchanged; SMALL's data must never be used to
    // normalize it.
    await page.goto(`/explore?dataset=${SMALL.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);

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
    await expectDatasetParam(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);

    await page.evaluate(() => history.go(2));
    await expectDatasetParam(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('ec');
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe('ec');
  });

  test('importing a user file removes dataset= without a new history entry', async ({ page }) => {
    await page.goto(`/explore?dataset=${SMALL.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);

    const historyLengthBeforeImport = await page.evaluate(() => history.length);

    await importUserFile(page, USER_IMPORT_PATH);
    await waitForProteinCount(page, USER_IMPORT_COUNT);

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
    // 'length_fixed' is not SMALL's curated annotation, so selecting it
    // proves the param was applied rather than the curated view.
    await page.goto(`/explore?dataset=${SMALL.id}&annotation=length_fixed`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);

    await expect.poll(() => getSelectedAnnotation(page)).toBe('length_fixed');
  });

  test('a failed menu choice leaves the previous dataset and URL unchanged', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await page.route(OTHER.glob, (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await chooseExampleFromMenu(page, OTHER.id);

    await expect(page.getByText(`Couldn't load "${OTHER.entry.label}".`)).toBeVisible();
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    await expectDatasetParam(page, null);
    // The failed load never reported a change, so the demo item is still the
    // one shown as loaded.
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
  });

  test('rapid Back past a still-loading entry lands on the newer example, not a stale fallback (1c repro)', async ({
    page,
  }) => {
    // Regression: history null -> SMALL -> OTHER -> demo. Back once (to
    // OTHER) starts a fresh fetch for it; before that fetch settles,
    // Back again (to SMALL) starts and finishes loading SMALL. The stale
    // OTHER request must then resolve as "superseded" and do nothing —
    // previously it resolved `false`, which `loadRequestedDatasetOrFallback`
    // treated as a real failure and used to run the persisted-or-default
    // fallback (the demo), stomping the correctly-loaded SMALL and deleting
    // `dataset=` from the URL.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    await chooseExampleFromMenu(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);

    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);
    await expectDatasetParam(page, OTHER.id);

    await chooseExampleFromMenu(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');

    // Hold the *next* fetch of the OTHER bundle — the one Back is
    // about to trigger — open until explicitly released.
    let releaseOther: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseOther = resolve;
    });
    await page.route(OTHER.glob, async (route) => {
      await gate;
      await route.fallback();
    });

    await page.goBack(); // -> dataset=OTHER, fetch held by the route above
    await expectDatasetParam(page, OTHER.id);

    await page.goBack(); // -> dataset=SMALL, fetch not held, loads normally
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);

    // Now let the stale OTHER fetch through. A correct implementation
    // must abandon it silently.
    releaseOther();
    // Give any (incorrect) fallback a moment to happen, then assert nothing
    // moved off the SMALL entry a Back landed on.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(SMALL.count);
    await expectDatasetParam(page, SMALL.id);
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

    await page.route(OTHER.glob, (route) =>
      route.fulfill({ status: 200, body: 'not-a-valid-bundle' }),
    );

    const datasetNameBefore = await getCurrentDatasetName(page);

    await chooseExampleFromMenu(page, OTHER.id);

    await expect(page.getByText('Dataset import failed.')).toBeVisible();
    await expectDatasetParam(page, null);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getCurrentDatasetName(page)).toBe(datasetNameBefore);
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
    expect(await isExampleDisabled(page, OTHER.id)).toBe(false);
  });

  test('rapid Back past a decoding example keeps the target entry intact (2 repro)', async ({
    page,
  }) => {
    // Regression: start at ?dataset=SMALL&annotation=phylum. Choose SLOW from
    // the menu, then the demo — history is now [SMALL+phylum, bare SLOW, bare
    // demo]. Back once (-> the SLOW entry) starts loading SLOW again; before
    // that finishes decoding, Back again (-> the SMALL entry) starts loading
    // SMALL. SLOW's load must not be allowed to resolve the still-pending view
    // request (now 'phylum', recorded for SMALL) against ITS OWN data and write
    // the result onto the URL: previously that raced and could replace-write
    // SLOW's fallback annotation onto the SMALL entry, and briefly show SLOW's
    // plot under `dataset=SMALL`.
    await page.goto(`/explore?dataset=${SMALL.id}&annotation=phylum`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('phylum');

    await chooseExampleFromMenu(page, SLOW.id);
    await waitForProteinCount(page, SLOW.count);
    await expectDatasetParam(page, SLOW.id);

    await chooseExampleFromMenu(page, 'demo');
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');

    // Hold the *next* fetch of the SLOW bundle open until released, so its
    // decode is still in flight when the second Back fires just after.
    let releaseSlow: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    await page.route(SLOW.glob, async (route) => {
      await gate;
      await route.fallback();
    });

    await page.goBack(); // -> dataset=SLOW, fetch held by the route above
    await expectDatasetParam(page, SLOW.id);

    releaseSlow();
    // Give the (now-unblocked) fetch a moment to land before Back again, so
    // the race is against SLOW's decode specifically, not its network fetch.
    await page.waitForTimeout(150);
    await page.goBack(); // -> dataset=SMALL, while SLOW may still be decoding
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);

    // A correct implementation never lets the superseded SLOW load touch the
    // view or the URL once it finishes decoding.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(SMALL.count);
    await expectDatasetParam(page, SMALL.id);
    expect(await getSelectedAnnotation(page)).toBe('phylum');
    expect(
      await page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')),
    ).toBe('phylum');
  });
});

test.describe('Example datasets: Import menu info', () => {
  test('the menu links the examples page, marks large examples, and explains an item without loading it', async ({
    page,
  }) => {
    const large = EXAMPLE_DATASETS.find((entry) => entry.large);
    const other = EXAMPLE_DATASETS.find((entry) => entry.id !== 'demo' && !entry.large);
    if (!large || !other) {
      throw new Error('The catalog needs a large example and another non-demo example.');
    }

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await openImportMenu(page);

    const controlBar = page.locator('protspace-control-bar');
    await expect(controlBar.locator('.import-examples-docs')).toHaveAttribute(
      'href',
      EXAMPLES_DOCS_URL,
    );
    await expect(
      controlBar.locator(`[data-example-id="${large.id}"] .import-example-badge`),
    ).toHaveText('Large');
    await expect(controlBar.locator('.import-example-badge')).toHaveCount(
      EXAMPLE_DATASETS.filter((entry) => entry.large).length,
    );

    const info = controlBar.locator(`.import-examples [data-example-info="${other.id}"]`);
    await info.locator('.info-button').click();
    const popover = info.locator('.popover');
    await expect(popover.locator('.popover-description')).toHaveText(other.description);
    await expect(popover.locator('.popover-detail')).toHaveText(other.insight);
    await expect(popover.locator('.popover-link')).toHaveAttribute('href', other.docsUrl);

    // Opening the info loads nothing: the demo stays, with no `dataset=`.
    await page.waitForTimeout(500);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getDatasetParam(page)).toBeNull();

    // The loaded example's info sits next to the current dataset name.
    await expect(
      controlBar.locator('.import-current-dataset-row [data-example-info="demo"]'),
    ).toHaveCount(1);
  });
});

/**
 * The catalog's large example. Its download is always held and cancelled
 * below, never completed, so what the bundle holds does not matter.
 */
function largeExample(): ExampleDataset {
  const large = EXAMPLE_DATASETS.find((entry) => entry.large);
  if (!large) {
    throw new Error('The catalog needs a large example.');
  }
  return large;
}

test.describe('Example datasets: download progress and Cancel', () => {
  test('Cancel during a menu download leaves the previous dataset and the URL, with no toast (e)', async ({
    page,
  }) => {
    const large = largeExample();
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await pickAnnotation(page, 'ec');
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('ec');
    const searchBefore = await getSearch(page);
    const historyLengthBefore = await page.evaluate(() => history.length);

    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    const release = await holdNextRequest(page, exampleBundleGlob(large));
    await chooseExampleFromMenu(page, large.id);

    const overlay = page.locator('#progressive-loading');
    await expect(overlay).toBeVisible();
    // Progress is measured against the decoded size the catalog records.
    await expect(overlay.locator('#processing-text')).toHaveText(
      `0.0 / ${formatMegabytes(large.sizeBytes)}`,
    );
    const cancel = overlay.getByRole('button', { name: 'Cancel download' });
    await cancel.click();

    await expect(overlay).toHaveCount(0);
    await expect
      .poll(() => failedRequests.some((url) => url.endsWith(large.url.replace(/^\./, ''))))
      .toBe(true);
    release();

    // Nothing lands later: the demo, its view and the URL are as they were.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getSelectedAnnotation(page)).toBe('ec');
    expect(await getSearch(page)).toBe(searchBefore);
    expect(await page.evaluate(() => history.length)).toBe(historyLengthBefore);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
    expect(await isExampleDisabled(page, large.id)).toBe(false);
  });

  test('Cancel of a startup deep link runs the startup load and removes dataset= in place (e)', async ({
    page,
  }) => {
    const large = largeExample();
    const release = await holdNextRequest(page, exampleBundleGlob(large));
    await page.goto(`/explore?dataset=${large.id}`);

    const cancel = page.locator('#progressive-loading').getByRole('button', {
      name: 'Cancel download',
    });
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    const historyLengthBefore = await page.evaluate(() => history.length);
    await cancel.click();

    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, null);
    expect(await page.evaluate(() => history.length)).toBe(historyLengthBefore);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    release();
  });
});

test.describe('Example datasets: curated default view', () => {
  test('a menu choice opens the curated view on a bare entry, and Back restores the previous view', async ({
    page,
  }) => {
    // The demo and the OTHER bundle both have 'ec' and 'pfam', so any
    // carry-over of the previous view into the new example would show here.
    await page.goto('/explore?annotation=ec&tooltip=pfam');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect
      .poll(() => getControlBarView(page))
      .toMatchObject({ annotation: 'ec', tooltip: ['pfam'] });

    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);
    await expect.poll(() => getSearch(page)).toBe(`?dataset=${OTHER.id}`);
    await expect.poll(() => getControlBarView(page)).toEqual(curatedView(OTHER.id));

    await page.goBack();
    await expectDatasetParam(page, null);
    await waitForProteinCount(page, DEMO_COUNT);
    await expect
      .poll(() => getControlBarView(page))
      .toMatchObject({ annotation: 'ec', tooltip: ['pfam'] });
    expect(await getSearch(page)).toBe('?annotation=ec&tooltip=pfam');
  });

  test('a bare deep link opens the curated view and writes nothing to the URL', async ({
    page,
  }) => {
    await page.goto(`/explore?dataset=${OTHER.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, OTHER.count);

    await expect.poll(() => getControlBarView(page)).toEqual(curatedView(OTHER.id));
    expect(await getSearch(page)).toBe(`?dataset=${OTHER.id}`);
  });

  test('Back to a bare entry of the same example lands on its curated view again', async ({
    page,
  }) => {
    const curated = curatedView(OTHER.id);
    await page.goto(`/explore?dataset=${OTHER.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, OTHER.count);
    await expect.poll(() => getControlBarView(page)).toEqual(curated);

    const controlBar = page.locator('protspace-control-bar');
    await controlBar.locator('protspace-annotation-select .dropdown-trigger').click();
    await controlBar.locator('.dropdown-item[data-annotation="pfam"]').click();
    await expect.poll(() => getControlBarView(page)).toMatchObject({ annotation: 'pfam' });
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe('pfam');

    await page.goBack();
    await expect.poll(() => getSearch(page)).toBe(`?dataset=${OTHER.id}`);
    await expect.poll(() => getControlBarView(page)).toEqual(curated);
  });

  test('explicit deep-link view params win over the curated view', async ({ page }) => {
    const curated = curatedView(OTHER.id);

    await page.goto(`/explore?dataset=${OTHER.id}&annotation=pfam`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, OTHER.count);

    // Any view param makes the request the user's: the missing projection
    // comes from the curated view, and an absent tooltip means none.
    await expect
      .poll(() => getControlBarView(page))
      .toEqual({ annotation: 'pfam', projection: curated.projection, tooltip: [] });
    expect(await getSearch(page)).toBe(`?dataset=${OTHER.id}&annotation=pfam`);
  });

  test('an invalid annotation falls back to the curated one and is normalized in the URL', async ({
    page,
  }) => {
    const curated = curatedView(OTHER.id);

    await page.goto(`/explore?dataset=${OTHER.id}&annotation=not_a_column`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, OTHER.count);

    await expect
      .poll(() => getControlBarView(page))
      .toEqual({ annotation: curated.annotation, projection: curated.projection, tooltip: [] });
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get('annotation')))
      .toBe(curated.annotation);
  });
});

test.describe('Example datasets: history steps while a load is pending', () => {
  test("a second quick Back onto another entry of the dataset still loading keeps that entry's view (b1)", async ({
    page,
  }) => {
    // History: [SMALL+length_quantile, SMALL+length_fixed, OTHER]. Back twice
    // while SMALL is still downloading: the second Back lands on another entry
    // of the same dataset. Its `length_quantile` must be applied by the SMALL
    // load, not resolved against OTHER (which lacks it), whose fallback
    // would otherwise be written over that entry.
    await page.goto(`/explore?dataset=${SMALL.id}&annotation=length_quantile`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('length_quantile');

    await pickAnnotation(page, 'length_fixed');
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('length_fixed');

    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);
    await expectDatasetParam(page, OTHER.id);

    const releaseSmall = await holdNextRequest(page, SMALL.glob);
    await page.goBack();
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('length_fixed');
    await page.goBack();
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('length_quantile');
    releaseSmall();

    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);
    await expect.poll(() => getSelectedAnnotation(page)).toBe('length_quantile');
    expect(await getUrlParam(page, 'annotation')).toBe('length_quantile');
  });

  test('Back while an example chosen from the menu is still loading cancels it (b1)', async ({
    page,
  }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await pickAnnotation(page, 'ec');
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('ec');

    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    const releaseOther = await holdNextRequest(page, OTHER.glob);
    await chooseExampleFromMenu(page, OTHER.id);
    await expect(page.locator('#progressive-loading')).toBeVisible();

    await page.goBack(); // -> the bare demo entry, while OTHER is still downloading
    await expect.poll(() => getSearch(page)).toBe('');
    // The download is aborted and its overlay dismissed.
    await expect
      .poll(() => failedRequests.some((url) => url.endsWith(OTHER.entry.url.slice(1))))
      .toBe(true);
    await expect(page.locator('#progressive-loading')).toHaveCount(0);
    releaseOther();

    // Nothing lands later and pushes a `dataset=OTHER` entry.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(DEMO_COUNT);
    expect(await getSearch(page)).toBe('');
    expect(await isExampleDisabled(page, 'demo')).toBe(true);
  });

  test('Back after a menu example has begun replacing the plot lets it finish on its own entry (b1)', async ({
    page,
  }) => {
    // History: [bare demo, demo+ec]. SLOW is chosen from the menu, and Back
    // lands once its data is on the plot but before its load has finished
    // (its overlay is still up). It is too late to cancel: SLOW finishes on
    // its curated view, labelled and named in a pushed entry, and the entry
    // the user went back to is left as it was.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await pickAnnotation(page, 'ec');
    await expect.poll(() => getUrlParam(page, 'annotation')).toBe('ec');

    await chooseExampleFromMenu(page, SLOW.id);
    // Back in the same task that sees SLOW's data on the plot with the
    // loading overlay still up, so the race is hit, never merely approached.
    await page.waitForFunction(
      ({ count }) => {
        const plot = document.querySelector('#myPlot') as {
          data?: { protein_ids?: string[] };
        } | null;
        const rendering =
          plot?.data?.protein_ids?.length === count &&
          document.getElementById('progressive-loading') !== null &&
          window.location.search.includes('annotation=ec');
        if (rendering) {
          history.back();
        }
        return rendering;
      },
      { count: SLOW.count },
      { polling: 'raf', timeout: 30_000 },
    );

    await waitForProteinCount(page, SLOW.count);
    await expectDatasetParam(page, SLOW.id);
    await expect.poll(() => getControlBarView(page)).toEqual(curatedView(SLOW.id));
    expect(await getCurrentDatasetName(page)).toBe(SLOW.entry.label);
    expect(await getUrlParam(page, 'annotation')).toBeNull();

    // The entry the user went back to still holds the demo, untouched.
    await page.goBack();
    await expect.poll(() => getSearch(page)).toBe('');
    await waitForProteinCount(page, DEMO_COUNT);
    expect(await getSearch(page)).toBe('');
  });

  test('Back to an entry without dataset= while an example is loading runs the startup load instead (b2)', async ({
    page,
  }) => {
    // A stored import flagged 'error' makes the startup load show the
    // recovery banner and load nothing, so only the pending example could
    // ever render: nothing else would supersede it.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await clearOpfs(page);
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'error',
      failedAttempts: 1,
      lastError: 'OOM during decode',
    });
    await page.goto('/explore');
    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // A same-document entry naming an example, reached like Forward.
    const releaseOther = await holdNextRequest(page, OTHER.glob);
    await page.evaluate((id) => {
      history.pushState(null, '', `/explore?dataset=${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, OTHER.id);
    await expect(page.locator('#progressive-loading')).toBeVisible();

    await page.goBack(); // -> the entry without `dataset=`, while OTHER is still downloading
    await expect.poll(() => getSearch(page)).toBe('');
    await expect(page.locator('#progressive-loading')).toHaveCount(0);
    await expect(banner).toBeVisible();
    releaseOther();

    // The abandoned example never renders under the banner.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(0);
    expect(await getSearch(page)).toBe('');
    await expect(banner).toBeVisible();
  });
});

test.describe('Example datasets: a Back/Forward supersedes a load already under way (b2)', () => {
  /**
   * Stores the 40,026-protein fixture as a healthy import and reopens the app,
   * so its restore decodes long enough for a Back/Forward to land meanwhile.
   * Resolves once the restore's overlay is up.
   */
  async function openWithLargeStoredImport(page: Page): Promise<void> {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await clearOpfs(page);
    await seedOpfsState(page, {
      fileName: 'mine.parquetbundle',
      status: 'success',
      failedAttempts: 0,
      fixture: PE1_40026_FIXTURE,
    });
    await page.goto('/explore');
    await expect(page.locator('#progressive-loading')).toBeVisible();
  }

  /** A same-document entry naming an example, reached like Forward. */
  async function forwardToExample(page: Page, id: string): Promise<void> {
    await page.evaluate((exampleId) => {
      history.pushState(null, '', `/explore?dataset=${exampleId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, id);
  }

  test('Forward to an example while the stored import restores shows the example on its entry', async ({
    page,
  }) => {
    await openWithLargeStoredImport(page);
    await forwardToExample(page, OTHER.id);

    await waitForProteinCount(page, OTHER.count);
    // The superseded restore must not replace-remove `dataset=` from the
    // entry the user went to.
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(OTHER.count);
    expect(await getSearch(page)).toBe(`?dataset=${OTHER.id}`);
    expect(await getCurrentDatasetName(page)).toBe(OTHER.entry.label);

    // The stored import is untouched and healthy: opening the app without
    // the parameter restores it, with no recovery banner.
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await waitForProteinCount(page, 40026);
    await expect(page.locator('#protspace-recovery-banner')).toHaveCount(0);
  });

  test('Forward to an example that fails while the stored import restores falls back to the import', async ({
    page,
  }) => {
    const { toast } = exampleFailureToast(page, OTHER.id);
    await page.route(OTHER.glob, failWith500);
    await openWithLargeStoredImport(page);
    await forwardToExample(page, OTHER.id);

    await expect(toast).toBeVisible();
    // Nothing was on screen yet, so the startup load runs: the import it had
    // begun restoring, not a recovery banner over it.
    await waitForProteinCount(page, 40026);
    await page.waitForTimeout(1_000);
    await expect(page.locator('#protspace-recovery-banner')).toHaveCount(0);
    expect(await getProteinCount(page)).toBe(40026);
    expect(await getCurrentDatasetName(page)).toBe('mine.parquetbundle');
    await expectDatasetParam(page, null);
  });

  test('Forward to an example during a FASTA preparation aborts it and shows the example', async ({
    page,
  }) => {
    const fasta = Array.from({ length: 25 }, (_, i) => `>P${10000 + i}\nMKTAYIAKQRQ`).join('\n');
    await page.route('**/api/prepare', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 202,
            contentType: 'application/json',
            body: JSON.stringify({ job_id: 'race-job' }),
          })
        : route.fallback(),
    );
    // The preparation stays in progress until something aborts it.
    await page.route('**/api/prepare/race-job/events', () => new Promise<void>(() => {}));
    let bundleRequested = false;
    await page.route('**/api/prepare/race-job/bundle', (route) => {
      bundleRequested = true;
      return route.abort();
    });

    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await page
      .locator('protspace-data-loader')
      .locator('input[type="file"]')
      .setInputFiles({ name: 'mine.fasta', mimeType: 'text/plain', buffer: Buffer.from(fasta) });
    const overlay = page.locator('#progressive-loading');
    await expect(overlay).toContainText('Preparing FASTA');

    await forwardToExample(page, OTHER.id);

    // The newer request owns the screen: the preparation neither holds the
    // load queue nor lands later and removes `dataset=` from the entry.
    await waitForProteinCount(page, OTHER.count);
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(await getProteinCount(page)).toBe(OTHER.count);
    expect(await getSearch(page)).toBe(`?dataset=${OTHER.id}`);
    expect(bundleRequested).toBe(false);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});

test.describe('Example datasets: a failed load keeps what is on screen', () => {
  test('Back to an example whose download fails keeps the plot and the entry, and Retry recovers (a)', async ({
    page,
  }) => {
    const { toast, retry } = exampleFailureToast(page, SMALL.id);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await chooseExampleFromMenu(page, SMALL.id);
    await waitForProteinCount(page, SMALL.count);
    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);
    await expectDatasetParam(page, OTHER.id);
    const historyLength = await page.evaluate(() => history.length);

    await page.route(SMALL.glob, failWith500);
    await page.goBack();

    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Report this' })).toBeVisible();
    await expect(page.locator('#progressive-loading')).toHaveCount(0);
    // No fallback: OTHER stays, and the entry still names SMALL.
    await page.waitForTimeout(500);
    expect(await getProteinCount(page)).toBe(OTHER.count);
    expect(await getSearch(page)).toBe(`?dataset=${SMALL.id}`);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    await page.unroute(SMALL.glob, failWith500);
    await retry.click();
    await waitForProteinCount(page, SMALL.count);
    await expect.poll(() => getControlBarView(page)).toEqual(curatedView(SMALL.id));
    expect(await getSearch(page)).toBe(`?dataset=${SMALL.id}`);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });

  test('after a failed Back, a view change writes an entry naming the dataset on screen (a)', async ({
    page,
  }) => {
    const { toast } = exampleFailureToast(page, SMALL.id);
    await page.goto(`/explore?dataset=${SMALL.id}&annotation=length_fixed`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, SMALL.count);
    await chooseExampleFromMenu(page, OTHER.id);
    await waitForProteinCount(page, OTHER.count);

    await page.route(SMALL.glob, failWith500);
    await page.goBack();
    await expect(toast).toBeVisible();
    expect(await getUrlParam(page, 'annotation')).toBe('length_fixed');

    await pickAnnotation(page, 'ec');
    await expectDatasetParam(page, OTHER.id);
    expect(await getUrlParam(page, 'annotation')).toBe('ec');
    // Naming the displayed dataset reloads nothing.
    await page.waitForTimeout(500);
    expect(await getProteinCount(page)).toBe(OTHER.count);
    expect(await getSelectedAnnotation(page)).toBe('ec');
  });

  test('a deep link whose download fails at startup falls back, and Retry opens it (a)', async ({
    page,
  }) => {
    const { toast, retry } = exampleFailureToast(page, SMALL.id);
    await page.goto('/explore?seed=baseline');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    const baselineHistoryLength = await page.evaluate(() => history.length);

    await page.route(SMALL.glob, failWith500);
    await page.goto(`/explore?dataset=${SMALL.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    // Nothing was on screen yet, so the startup load runs instead and the
    // parameter is removed without a history entry of its own.
    await expect(toast).toBeVisible();
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, null);
    expect(await page.evaluate(() => history.length)).toBe(baselineHistoryLength + 1);

    // Retry names the example in a new entry and loads it like a link.
    await page.unroute(SMALL.glob, failWith500);
    await retry.click();
    await waitForProteinCount(page, SMALL.count);
    await expectDatasetParam(page, SMALL.id);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(baselineHistoryLength + 2);
  });
});

test.describe('Example datasets: examples reopen in their curated state (d)', () => {
  test("a reload brings back an example's bundled legend, while a user import keeps its change", async ({
    page,
  }) => {
    await page.goto('/explore?dataset=demo');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);

    // The change is saved like any other, and discarded when the example loads again.
    const exampleValue = await hideFirstLegendCategory(page);
    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, DEMO_COUNT);
    await expectDatasetParam(page, 'demo');
    expect(await isLegendItemHidden(page, exampleValue)).toBe(false);

    // A user import keeps the same kind of change across a reload.
    await importUserFile(page, USER_IMPORT_PATH);
    await waitForProteinCount(page, USER_IMPORT_COUNT);
    await waitForPersistedExploreDataset(page);
    await expectDatasetParam(page, null);
    await pickAnnotation(page, 'ec');
    const importValue = await hideFirstLegendCategory(page);
    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, USER_IMPORT_COUNT);
    expect(await isLegendItemHidden(page, importValue)).toBe(true);
  });
});

test.describe('Example datasets: the EAT example', () => {
  test('opens on its transferred annotation with the overlay on and its bundled reliability threshold', async ({
    page,
  }) => {
    await page.goto(`/explore?dataset=${EAT.id}`);
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForProteinCount(page, EAT.count);
    await expect.poll(() => getControlBarView(page)).toEqual(curatedView(EAT.id));

    const eatGroup = page
      .locator('protspace-legend')
      .getByRole('region', { name: 'Embedding Annotation Transfer' });
    await expect(eatGroup).toBeVisible();
    await expect(eatGroup.getByRole('checkbox', { name: 'Show EAT predictions' })).toBeChecked();
    await expect(
      eatGroup.getByRole('slider', { name: 'EAT reliability filter threshold' }),
    ).toHaveValue(String(EAT_ROLE_BUNDLED_THRESHOLD));
    expect(await getSearch(page)).toBe(`?dataset=${EAT.id}`);
  });
});
