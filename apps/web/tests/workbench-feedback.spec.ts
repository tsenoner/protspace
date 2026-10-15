import { expect, test, type Page } from '@playwright/test';
import {
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  dismissTourIfPresent,
  filterButton,
  filterResetButton,
  openExplore,
  plotArea,
  searchProteins,
  selectionBar,
  statusChip,
  toast,
  waitForExploreDataLoad,
} from './helpers/explore';
import { clearOpfs, seedOpfsState } from './helpers/opfs';

/** The dataset's first protein. */
function firstProteinId(page: Page): Promise<string> {
  return page
    .locator('#myPlot')
    .evaluate(
      (plot) => (plot as unknown as { data: { protein_ids: string[] } }).data.protein_ids[0],
    );
}

test.describe('notifications', () => {
  test("a toast sits inside the plot's horizontal span, does not intersect #myLegend and has a close button named Dismiss notification", async ({
    page,
  }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);

    await clearStatusChip(page, 'filter');

    const removed = toast(page, 'Filter removed');
    await expect(removed).toBeVisible();
    await expect(removed.getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
    await expect(removed.getByRole('button', { name: 'Undo' })).toBeVisible();
    const box = (await removed.boundingBox())!;
    const plot = (await plotArea(page).boundingBox())!;
    const legend = (await page.locator('#myLegend').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(360);
    expect(box.x).toBeGreaterThanOrEqual(plot.x);
    expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width);
    expect(box.x + box.width).toBeLessThanOrEqual(legend.x);
  });

  test('with a selection the toast sits above the selection bar', async ({ page }) => {
    await openExplore(page);
    await searchProteins(page, [await firstProteinId(page)]);
    await applyFirstCategoryFilter(page);

    await filterResetButton(page).click();

    const removed = toast(page, 'Filter removed');
    await expect(removed).toBeVisible();
    const bar = (await selectionBar(page).boundingBox())!;
    // Sonner slides the toast in; read its box once it has settled.
    await expect
      .poll(async () => {
        const box = (await removed.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(bar.y);
  });

  test('Reset in the Filter panel shows Filter removed; Undo restores the chip and its count', async ({
    page,
  }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await expect(statusChip(page, 'filter')).toContainText('Filtered · 1 condition');

    await filterResetButton(page).click();

    await expect(statusChip(page, 'filter')).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName('Filter');
    const removed = toast(page, 'Filter removed');
    await removed.getByRole('button', { name: 'Undo' }).click();

    await expect(statusChip(page, 'filter')).toContainText('Filtered · 1 condition');
    await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
    await expect(removed).toHaveCount(0);
  });

  test('a newer step dismisses the stale Undo toast', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await filterResetButton(page).click();
    const removed = toast(page, 'Filter removed');
    await expect(removed).toBeVisible();

    // A selection is a newer history step: Undo would no longer take back the removal.
    await searchProteins(page, [await firstProteinId(page)]);

    await expect(removed).toHaveCount(0);
  });
});

test.describe('clearing stored data', () => {
  test('Clear stored data opens the confirmation; Cancel keeps the banner; Clear data clears it and loads the default', async ({
    page,
  }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await clearOpfs(page);
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'pending',
      failedAttempts: 1,
    });
    await page.reload();
    await dismissTourIfPresent(page);

    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const confirm = page.getByRole('dialog', { name: 'Clear stored data?' });
    // The text and the buttons are the dialog's slotted content, found through the ps-dialog host.
    const confirmContent = page.locator('ps-dialog', { has: confirm });

    await banner.getByRole('button', { name: 'Clear stored data' }).click();
    await expect(confirm).toBeVisible();
    // Cancel takes focus first, so a reflexive Enter destroys nothing.
    await expect(confirmContent.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await expect(confirmContent).toContainText(
      'This deletes the copy of "broken.parquetbundle" saved in this browser. It cannot be undone.',
    );
    await confirmContent.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Clear stored data' }).click();
    await confirmContent.getByRole('button', { name: 'Clear data', exact: true }).click();

    await expect(banner).toHaveCount(0);
    await waitForExploreDataLoad(page);
    await page.reload();
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await expect(banner).toHaveCount(0);
  });
});
