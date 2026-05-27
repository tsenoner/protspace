import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

/**
 * Regression test for issue #222: the Reset chip in the control bar must clear
 * when the dataset is swapped while isolation is active. The bug was that
 * scatter-plot.clearIsolationState() silently flipped its internal flag without
 * dispatching `data-isolation-reset`, leaving the control bar's mirror stuck
 * on `isolationMode = true` and the Reset button rendered after the dataset
 * actually reset.
 */

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const CUSTOM_5K_BUNDLE_PATH = path.resolve(SPEC_DIR, '../public/data/5K.parquetbundle');

/**
 * Drive the dataset-load pipelines directly instead of through the Import menu UI.
 *
 * Both menu buttons just delegate: "Load your dataset" clicks the hidden file input
 * inside <protspace-data-loader>, and "Load demo dataset" dispatches the
 * `load-demo-dataset` event upward from the control-bar. Driving those entry points
 * directly avoids click-on-shadow-DOM flakiness in headless mode while still hitting
 * exactly the same production code path (data-renderer.applyPlotState → scatterplot
 * .clearIsolationState()), which is what this regression test cares about.
 */
async function loadCustomDataset(page: Page, datasetPath: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page
    .locator('protspace-data-loader')
    .locator('input[type="file"]')
    .setInputFiles(datasetPath);
}

async function loadDemoDataset(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    cb?.dispatchEvent(new CustomEvent('load-demo-dataset', { bubbles: true, composed: true }));
  });
}

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

/** Engage isolation deterministically: take the first N plot points as the selection
 * and call the same public method the Isolate button calls. Avoids fragile drag
 * gestures over a WebGL canvas while still exercising the real isolation pipeline. */
async function engageIsolation(page: Page, sampleSize = 100): Promise<void> {
  await page.evaluate((n) => {
    const sp = document.querySelector('protspace-scatterplot') as
      | (HTMLElement & {
          _plotData?: Array<{ id: string }>;
          selectedProteinIds: string[];
          isolateSelection(): void;
        })
      | null;
    if (!sp) throw new Error('scatterplot element not found');
    const ids = (sp._plotData ?? []).slice(0, n).map((p) => p.id);
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
    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
  });

  test('Reset clears when swapping demo → custom while isolated', async ({ page }) => {
    const demoCount = await getProteinCount(page);

    await engageIsolation(page);
    await expect(resetButton(page)).toBeVisible();
    expect(await readControlBarIsolationMode(page)).toBe(true);

    await loadCustomDataset(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as {
          data?: { protein_ids?: string[] };
        } | null;
        const len = plot?.data?.protein_ids?.length ?? 0;
        return len > 0 && len !== originalCount;
      },
      demoCount,
      { polling: 500, timeout: 30_000 },
    );

    await expect(resetButton(page)).toHaveCount(0);
    expect(await readControlBarIsolationMode(page)).toBe(false);
  });

  test('Reset clears when swapping custom → demo while isolated', async ({ page }) => {
    const demoCount = await getProteinCount(page);

    await loadCustomDataset(page, CUSTOM_5K_BUNDLE_PATH);
    await page.waitForFunction(
      (originalCount) => {
        const plot = document.querySelector('#myPlot') as {
          data?: { protein_ids?: string[] };
        } | null;
        const len = plot?.data?.protein_ids?.length ?? 0;
        return len > 0 && len !== originalCount;
      },
      demoCount,
      { polling: 500, timeout: 30_000 },
    );

    await engageIsolation(page);
    await expect(resetButton(page)).toBeVisible();
    expect(await readControlBarIsolationMode(page)).toBe(true);

    await loadDemoDataset(page);
    await waitForProteinCount(page, demoCount);

    await expect(resetButton(page)).toHaveCount(0);
    expect(await readControlBarIsolationMode(page)).toBe(false);
  });
});
