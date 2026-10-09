import { expect, test, type Page } from '@playwright/test';
import {
  filterButton,
  filterDialog,
  getFirstLegendItemValue,
  getProteinCount,
  getViewState,
  openExplore,
  openFilter,
  queryBuilder,
} from './helpers/explore';

/** The plot's filter channel: whether it is on, and how many proteins it keeps. */
function readPlotFilter(page: Page): Promise<{ filtersActive: boolean; kept: number }> {
  return page.locator('#myPlot').evaluate((plot) => {
    const host = plot as Element & { filtersActive?: boolean; filteredProteinIds?: string[] };
    return {
      filtersActive: host.filtersActive === true,
      kept: host.filteredProteinIds?.length ?? 0,
    };
  });
}

const quoted = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Filters the plot to the legend's first category of the colouring annotation, through the UI. */
async function applyFirstCategoryFilter(page: Page): Promise<void> {
  const { annotation } = await getViewState(page);
  const value = await getFirstLegendItemValue(page);
  await openFilter(page);
  const row = queryBuilder(page).locator('protspace-query-condition-row').first();
  await row.locator('.annotation-select-trigger').click();
  await queryBuilder(page)
    .locator(`.annotation-picker-item[data-annotation="${quoted(annotation ?? '')}"]`)
    .first()
    .click();
  await row.locator('.value-chip-add').click();
  await queryBuilder(page)
    .locator(`.value-picker-item[data-value="${quoted(value)}"]`)
    .first()
    .click();
  // A click elsewhere in the dialog closes the value picker, as it always has.
  await queryBuilder(page).locator('.match-count').click();
  await queryBuilder(page).getByRole('button', { name: 'Apply Filter' }).click();
}

test.describe('the Filter dialog', () => {
  test('Filter opens a dialog named Filter with the query builder; Escape closes it and returns focus to Filter', async ({
    page,
  }) => {
    await openExplore(page);
    await filterButton(page).click();

    const dialog = filterDialog(page);
    await expect(dialog).toBeVisible();
    await expect(queryBuilder(page)).toBeVisible();
    // The dialog names it, so the embedded builder shows no title or close button of its own.
    await expect(queryBuilder(page).getByText('Filter Query', { exact: true })).toHaveCount(0);
    await expect(
      queryBuilder(page).getByRole('button', { name: 'Close filter query builder' }),
    ).toHaveCount(0);
    await expect(queryBuilder(page).locator('.match-count')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(filterButton(page)).toBeFocused();
  });

  test('applying a condition filters the plot and shows the count on Filter', async ({ page }) => {
    await openExplore(page);
    const total = await getProteinCount(page);
    await expect(filterButton(page)).toHaveAccessibleName('Filter');

    await applyFirstCategoryFilter(page);

    await expect(filterDialog(page)).toBeHidden();
    await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
    const plot = await readPlotFilter(page);
    expect(plot.filtersActive).toBe(true);
    expect(plot.kept).toBeGreaterThan(0);
    expect(plot.kept).toBeLessThan(total);
  });

  test('Reset clears the filter and keeps the dialog open', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(true);

    await openFilter(page);
    await queryBuilder(page).getByRole('button', { name: 'Reset All' }).click();

    await expect(filterDialog(page)).toBeVisible();
    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(false);
    await page.keyboard.press('Escape');
    await expect(filterButton(page)).toHaveAccessibleName('Filter');
  });
});
