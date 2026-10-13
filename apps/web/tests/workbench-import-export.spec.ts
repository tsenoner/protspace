import { expect, test } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import {
  appBar,
  datasetSwitcher,
  exportMenu,
  expectUrlParam,
  getCurrentDatasetName,
  importMenu,
  importTrigger,
  importUserFile,
  openExplore,
  openExportMenu,
  openImportMenu,
  pickExample,
  supportsExplorePersistedDataset,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
import { PHOSPHATASE_1587_FIXTURE, TOXPROT_5181_FIXTURE } from './helpers/fixtures';

/** The Import and Export menus in the app bar (Task 2.5). */

test.describe('Import and Export menus', () => {
  test('Import and Export sit in the app bar and work from the keyboard', async ({ page }) => {
    await openExplore(page);
    const actions = appBar(page).locator('[data-driver-id="data-actions"]');
    await expect(actions.locator('#myImportMenu')).toBeVisible();
    await expect(actions.locator('#myExportMenu')).toBeVisible();
    // The tour's Import step finds the menu itself, in the light DOM.
    await expect(page.locator('[data-driver-id="import"]')).toHaveAttribute('id', 'myImportMenu');

    await importTrigger(page).focus();
    await page.keyboard.press('Enter');
    const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
    await expect(ownDataset).toBeFocused();
    await expect(importTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(ownDataset).toHaveCount(0);
    await expect(importTrigger(page)).toBeFocused();

    const exportTrigger = exportMenu(page).getByRole('button', { name: 'Export', exact: true });
    await exportTrigger.focus();
    await page.keyboard.press('Enter');
    const png = exportMenu(page).getByRole('button', { name: 'PNG', exact: true });
    await expect(png).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(png).toHaveCount(0);
    await expect(exportTrigger).toBeFocused();
  });

  test('Open a file… opens the file chooser', async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);

    const chooser = page.waitForEvent('filechooser');
    await importMenu(page).locator('[data-driver-id="import-own-dataset"]').click();
    expect((await chooser).isMultiple()).toBe(false);
    await expect(importMenu(page).locator('.import-menu')).toHaveCount(0);
  });

  test("an example's info bubble is fully visible and topmost", async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);
    const info = importMenu(page).locator(
      `.import-examples [data-example-info="${EXAMPLE_DATASETS[1].id}"]`,
    );
    await info.locator('.info-button').click();
    const bubble = info.locator('.popover');
    await expect(bubble).toBeVisible();

    const placement = await bubble.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // The deepest element at the bubble's centre, looking through every shadow root on the way.
      let hit: Element | null = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      return {
        onScreen:
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight,
        topmost: hit !== null && element.contains(hit),
      };
    });
    expect(placement).toEqual({ onScreen: true, topmost: true });
  });

  test('the dataset name opens the Import panel and an example switches the dataset', async ({
    page,
  }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);

    const switcher = datasetSwitcher(page);
    await expect(switcher).toHaveAttribute('aria-haspopup', 'dialog');
    await switcher.click();
    const panel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(panel).toBeVisible();
    await expect(switcher).toHaveAttribute('aria-expanded', 'true');
    await expect(importTrigger(page)).toHaveAttribute('aria-expanded', 'false');
    const anchor = (await switcher.boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(Math.abs(box.x - anchor.x)).toBeLessThan(2);
    expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(switcher).toBeFocused();
    await expect(switcher).toHaveAttribute('aria-expanded', 'false');

    await switcher.click();
    await importMenu(page).locator(`[data-example-id="${other.id}"]`).click();
    await waitForProteinCount(page, other.count);
    await expectUrlParam(page, 'dataset', other.id);
  });

  test('after a user import then an example, Last file reopens the import', async ({ page }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);
    test.skip(!(await supportsExplorePersistedDataset(page)), 'This browser has no usable OPFS.');

    await importUserFile(page, TOXPROT_5181_FIXTURE);
    await waitForProteinCount(page, 5181);
    await waitForPersistedExploreDataset(page);
    // A second import replaces the stored copy after its render announced it, so the panel must
    // read the store again when it opens (not offer "Reopen" for the first file).
    await importUserFile(page, PHOSPHATASE_1587_FIXTURE);
    await waitForProteinCount(page, 1587);
    const importedName = await getCurrentDatasetName(page);
    expect(importedName).not.toBeNull();
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            try {
              const root = await navigator.storage.getDirectory();
              const dir = await root.getDirectoryHandle('protspace-last-import');
              const meta = await (await dir.getFileHandle('metadata.json')).getFile();
              const parsed = JSON.parse(await meta.text()) as {
                name?: string;
                lastLoadStatus?: string;
              };
              return parsed.lastLoadStatus === 'success' ? (parsed.name ?? null) : null;
            } catch {
              return null;
            }
          }),
        { timeout: 30_000 },
      )
      .toBe(importedName);

    // While the import is on screen, the panel offers no "Last file".
    await openImportMenu(page);
    await expect(importMenu(page).getByRole('button', { name: /^Reopen / })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The example has as many proteins as the second import (1587): wait on the URL, not the count.
    await pickExample(page, other.id);
    await expectUrlParam(page, 'dataset', other.id);
    await expect.poll(() => getCurrentDatasetName(page)).not.toBe(importedName);

    await datasetSwitcher(page).click();
    const reopen = importMenu(page).getByRole('button', { name: `Reopen ${importedName}` });
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect.poll(() => getCurrentDatasetName(page), { timeout: 30_000 }).toBe(importedName);
    await expectUrlParam(page, 'dataset', null);
  });

  test('Quick export PNG downloads a file', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);

    const download = page.waitForEvent('download');
    await exportMenu(page).getByRole('button', { name: 'Quick Export PNG' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    await expect(exportMenu(page).getByRole('button', { name: 'PNG', exact: true })).toHaveCount(0);
  });

  test('the figure editor opens from Export', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);

    await exportMenu(page).getByRole('button', { name: 'Figure Editor' }).click();
    await expect(page.locator('protspace-publish-modal')).toBeAttached();
  });
});
