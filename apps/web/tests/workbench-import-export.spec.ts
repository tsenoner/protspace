import { expect, test } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import {
  appBar,
  exportMenu,
  importMenu,
  importTrigger,
  openExplore,
  openExportMenu,
  openImportMenu,
} from './helpers/explore';

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

  test('Load your dataset opens the file chooser', async ({ page }) => {
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
