import { expect, test, type Page } from '@playwright/test';
import {
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  filterApplyButton,
  filterButton,
  filterPanel,
  getProteinCount,
  getViewState,
  openExplore,
  openFilter,
  queryBuilder,
  statusChip,
} from './helpers/explore';
import { expectNoAxeViolations } from './helpers/a11y';
import { rail, structurePanel, watchPlotResizes } from './helpers/workbench';

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

const railItem = (page: Page, name: 'Legend' | 'Filter') =>
  rail(page).getByRole('button', { name, exact: true });
const conditionRows = (page: Page) => queryBuilder(page).locator('protspace-query-condition-row');
const countLine = (page: Page) => queryBuilder(page).locator('.match-count');
const reason = (page: Page) => queryBuilder(page).locator('#apply-reason');

test.describe('the Filter panel', () => {
  test("the view bar's Filter opens the panel in place of the legend, the structure footer stays, and #myPlot does not resize", async ({
    page,
  }) => {
    await openExplore(page);
    const resizes = await watchPlotResizes(page);

    await filterButton(page).click();

    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#myLegend')).toBeHidden();
    await expect(structurePanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
    await expect(filterButton(page)).toHaveAttribute('aria-expanded', 'true');
    // The builder sits under the panel's own heading: no title or close button of its own.
    await expect(queryBuilder(page).getByText('Filter Query', { exact: true })).toHaveCount(0);
    expect(await resizes()).toBe(0);
  });

  test("the rail's Filter is pressed; Close returns to the legend and focus to the rail item", async ({
    page,
  }) => {
    await openExplore(page);
    await railItem(page, 'Filter').click();

    await expect(filterPanel(page)).toBeVisible();
    await expect(railItem(page, 'Filter')).toHaveAttribute('aria-pressed', 'true');
    await expect(railItem(page, 'Legend')).toHaveAttribute('aria-pressed', 'false');

    await filterPanel(page).getByRole('button', { name: 'Close filter', exact: true }).click();

    await expect(filterPanel(page)).toBeHidden();
    await expect(page.locator('#myLegend')).toBeVisible();
    await expect(railItem(page, 'Legend')).toHaveAttribute('aria-pressed', 'true');
    await expect(railItem(page, 'Filter')).toHaveAttribute('aria-pressed', 'false');
    await expect(railItem(page, 'Filter')).toBeFocused();
  });

  test('the live count updates after an edit', async ({ page }) => {
    await openExplore(page);
    const total = await getProteinCount(page);
    await openFilter(page);
    // The seeded empty row keeps every protein. A pattern meets the raw text, which the template
    // pads with whitespace.
    await expect(countLine(page)).toHaveText(
      new RegExp(`^\\s*${total.toLocaleString('en-US')} of `),
    );

    await applyFirstCategoryFilter(page);

    await expect(countLine(page)).not.toHaveText(
      new RegExp(`^\\s*${total.toLocaleString('en-US')} of `),
    );
    await expect(countLine(page)).toHaveText(/ proteins? match\s*$/);
  });

  test("an incomplete row says 'Choose a value for condition 1' and Apply is disabled", async ({
    page,
  }) => {
    await openExplore(page);
    // The colouring annotation is categorical in the default dataset (the legend lists its
    // categories), so a row on it asks for a value.
    const { annotation } = await getViewState(page);
    await openFilter(page);
    await conditionRows(page).first().locator('.annotation-select-trigger').click();
    await queryBuilder(page)
      .locator(`.annotation-picker-item[data-annotation="${annotation}"]`)
      .first()
      .click();

    await expect(reason(page)).toHaveText('Choose a value for condition 1');
    await expect(filterApplyButton(page)).toBeDisabled();
  });

  test('Apply filters and the panel stays', async ({ page }) => {
    await openExplore(page);
    const total = await getProteinCount(page);
    await expect(filterButton(page)).toHaveAccessibleName('Filter');

    await applyFirstCategoryFilter(page);

    await expect(filterPanel(page)).toBeVisible();
    await expect(reason(page)).toHaveText('No changes to apply');
    await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
    await expect(rail(page).locator('[data-workbench="filter-dot"]')).toBeVisible();
    const plot = await readPlotFilter(page);
    expect(plot.filtersActive).toBe(true);
    expect(plot.kept).toBeGreaterThan(0);
    expect(plot.kept).toBeLessThan(total);
  });

  test('Cancel restores the applied filter', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    const cancel = queryBuilder(page).getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeDisabled();

    await queryBuilder(page).getByRole('button', { name: '+ Add condition' }).click();
    await expect(conditionRows(page)).toHaveCount(2);
    await expect(cancel).toBeEnabled();

    await cancel.click();

    await expect(conditionRows(page)).toHaveCount(1);
    await expect(cancel).toBeDisabled();
    expect((await readPlotFilter(page)).filtersActive).toBe(true);
  });

  test("the filter chip's ✕ removes the filter", async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await expect(statusChip(page, 'filter')).toBeVisible();

    await clearStatusChip(page, 'filter');

    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(false);
    await expect(statusChip(page, 'filter')).toHaveCount(0);
    await expect(filterButton(page)).toHaveAccessibleName('Filter');
    // The clean draft returned to one empty row.
    await expect(conditionRows(page)).toHaveCount(1);
  });

  test('the filter chip opens the panel and moves focus to its heading', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);

    const open = statusChip(page, 'filter').getByRole('button', { name: /^Filtered/ });
    await open.focus();
    await page.keyboard.press('Enter');

    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
  });

  test('after a reload the panel is still Filter, with no filter applied', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);

    // A fresh visit: the layout is stored, the filter is not.
    await openExplore(page);

    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#myLegend')).toBeHidden();
    await expect(filterButton(page)).toHaveAccessibleName('Filter');
    expect((await readPlotFilter(page)).filtersActive).toBe(false);
    await expect(conditionRows(page)).toHaveCount(1);
  });

  test('the open panel has no axe violations', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await expectNoAxeViolations(page, { include: '#wb-filter-panel' });
  });
});
