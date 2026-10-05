import { test, expect, type Page } from '@playwright/test';
import {
  getProteinCount,
  importUserFile,
  openExplore,
  waitForExploreInteractionReady,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';

/**
 * Regression test for issue #222: the Reset chip in the control bar must clear
 * when the dataset is swapped while isolation is active. The bug was that
 * scatter-plot.clearIsolationState() silently flipped its internal flag without
 * dispatching `data-isolation-reset`, leaving the control bar's mirror stuck
 * on `isolationMode = true` and the Reset button rendered after the dataset
 * actually reset.
 */

const CUSTOM_5K_BUNDLE_PATH = TOXPROT_5181_FIXTURE;
const CUSTOM_5K_PROTEIN_COUNT = 5181;

/**
 * Drive the dataset-load pipelines directly instead of through the Import menu UI.
 *
 * Both menu actions just delegate: "Load your dataset" clicks the hidden file input
 * inside <protspace-data-loader> (`importUserFile` sets it), and choosing an example
 * dispatches the `load-example-dataset` event upward from the control-bar. Driving
 * those entry points directly avoids click-on-shadow-DOM flakiness in headless mode
 * while still hitting exactly the same production code path
 * (data-renderer.applyPlotState → scatterplot.clearIsolationState()), which is what
 * this regression test cares about.
 */
async function loadDemoDataset(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    cb?.dispatchEvent(
      new CustomEvent('load-example-dataset', {
        detail: { id: 'demo' },
        bubbles: true,
        composed: true,
      }),
    );
  });
}

/** Engage isolation deterministically: take the first N plot points as the selection
 * and call the same public method the Isolate button calls. Avoids fragile drag
 * gestures over a WebGL canvas while still exercising the real isolation pipeline. */
async function engageIsolation(page: Page, sampleSize = 100): Promise<void> {
  await page.evaluate((n) => {
    const sp = document.querySelector('protspace-scatterplot') as unknown as
      | (HTMLElement & {
          // _plotData is a columnar PlotData ({ length, proteinIds, originalIndices, ... }),
          // not an array of point objects.
          _plotData?: {
            length: number;
            proteinIds: string[];
            originalIndices: ArrayLike<number> | null;
          };
          selectedProteinIds: string[];
          isolateSelection(): void;
        })
      | null;
    if (!sp) throw new Error('scatterplot element not found');
    const pd = sp._plotData;
    const len = Math.min(n, pd?.length ?? 0);
    const ids: string[] = [];
    for (let slot = 0; slot < len; slot += 1) {
      const originalIndex = pd!.originalIndices ? pd!.originalIndices[slot] : slot;
      ids.push(pd!.proteinIds[originalIndex]);
    }
    if (ids.length === 0) throw new Error('no plot data points available to isolate');
    sp.selectedProteinIds = ids;
    sp.isolateSelection();
  }, sampleSize);
}

async function readControlBarIsolationMode(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar') as
      | (HTMLElement & { isolationMode?: boolean })
      | null;
    return Boolean(cb?.isolationMode);
  });
}

function resetButton(page: Page) {
  return page.locator('protspace-control-bar').getByRole('button', { name: 'Reset' });
}

test.describe('Dataset swap clears isolation state (#222)', () => {
  test.beforeEach(async ({ page }) => {
    await openExplore(page);
  });

  test('Reset clears when swapping demo → custom while isolated', async ({ page }) => {
    await engageIsolation(page);
    await expect(resetButton(page)).toBeVisible();
    expect(await readControlBarIsolationMode(page)).toBe(true);

    await importUserFile(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);

    await expect(resetButton(page)).toHaveCount(0);
    expect(await readControlBarIsolationMode(page)).toBe(false);
  });

  test('Reset clears when swapping custom → demo while isolated', async ({ page }) => {
    const demoCount = await getProteinCount(page);

    await importUserFile(page, CUSTOM_5K_BUNDLE_PATH);
    await waitForProteinCount(page, CUSTOM_5K_PROTEIN_COUNT);

    await engageIsolation(page);
    await expect(resetButton(page)).toBeVisible();
    expect(await readControlBarIsolationMode(page)).toBe(true);

    await loadDemoDataset(page);
    await waitForProteinCount(page, demoCount);

    await expect(resetButton(page)).toHaveCount(0);
    expect(await readControlBarIsolationMode(page)).toBe(false);
  });
});
