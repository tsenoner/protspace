import { expect, test, type Page } from '@playwright/test';
import {
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  draftFilterCondition,
  filterApplyButton,
  filterButton,
  filterPanel,
  getProteinCount,
  getViewState,
  importUserFile,
  openExplore,
  openFilter,
  queryBuilder,
  redo,
  selectAnnotation,
  statusChip,
  undo,
  waitForExploreDataLoad,
} from './helpers/explore';
import { expectNoAxeViolations } from './helpers/a11y';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';
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

/** Each legend row's colour by category, Other left out. */
function legendColors(page: Page): Promise<Record<string, string>> {
  return page.locator('protspace-legend').evaluate((legend) => {
    const items =
      (legend as Element & { _legendItems?: Array<{ value: string; color: string }> })
        ._legendItems ?? [];
    return Object.fromEntries(
      items.filter((item) => item.value !== 'Other').map((item) => [item.value, item.color]),
    );
  });
}

const railItem = (page: Page, name: 'Legend' | 'Filter') =>
  rail(page).getByRole('button', { name, exact: true });
const conditionRows = (page: Page) => queryBuilder(page).locator('protspace-query-condition-row');
const countLine = (page: Page) => queryBuilder(page).locator('.match-count');
const reason = (page: Page) => queryBuilder(page).locator('#apply-reason');

test.describe('the Filter panel', () => {
  test('the Filter button opens the panel in place of the legend, the structure footer stays, and #myPlot does not resize', async ({
    page,
  }) => {
    await openExplore(page);
    const resizes = await watchPlotResizes(page);

    await filterButton(page).click();

    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#myLegend')).toBeHidden();
    await expect(structurePanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
    await expect(filterButton(page)).toHaveAttribute('aria-pressed', 'true');
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

    // An empty condition is not a change, so Cancel stays off.
    await queryBuilder(page).getByRole('button', { name: 'Add condition', exact: true }).click();
    await expect(conditionRows(page)).toHaveCount(2);
    await expect(cancel).toBeDisabled();

    // Removing the applied condition is.
    await conditionRows(page)
      .first()
      .getByRole('button', { name: /^Remove condition/ })
      .click();
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

  test('the footer follows the last card, and stays at the bottom once the cards overflow', async ({
    page,
  }) => {
    await openExplore(page);
    await openFilter(page);
    const add = queryBuilder(page).getByRole('button', { name: 'Add condition', exact: true });
    const footer = queryBuilder(page).locator('.query-footer');
    const below = async () => {
      const button = (await add.boundingBox())!;
      return (await footer.boundingBox())!.y - (button.y + button.height);
    };
    // One gap of the builder's column under "Add condition".
    expect(await below()).toBeGreaterThanOrEqual(0);
    expect(await below()).toBeLessThan(24);

    for (let n = 2; n <= 10; n++) await add.click();
    await expect(conditionRows(page)).toHaveCount(10);
    const panel = (await filterPanel(page).boundingBox())!;
    const box = (await footer.boundingBox())!;
    // At the panel's bottom edge, inside the body's padding.
    expect(panel.y + panel.height - (box.y + box.height)).toBeLessThan(20);
    await expect(filterApplyButton(page)).toBeInViewport();
  });

  test('"and not" keeps the first card’s proteins without the second’s; undo and redo keep it', async ({
    page,
  }) => {
    await openExplore(page);
    const total = (await getProteinCount(page)).toLocaleString('en-US');
    /** A length card for `min`–`max` alone, without the N/A proteins; returns how many it keeps. */
    const lengthCard = async (row: number, min: string, max: string) => {
      const card = await draftFilterCondition(page, row, 'length');
      await card.getByRole('checkbox', { name: /^Include proteins with no/ }).uncheck();
      await card.getByLabel('Minimum value').fill(min);
      await card.getByLabel('Maximum value').fill(max);
      await card.getByLabel('Maximum value').blur();
      const count = card.locator('.numeric-match-count');
      await expect(count).toHaveText(/^[1-9][\d,]* proteins?/);
      await expect(count).not.toHaveText(new RegExp(`^${total} `));
      return Number((await count.innerText()).replace(/\D/g, ''));
    };
    const outer = await lengthCard(0, '60', '120');
    const inner = await lengthCard(1, '80', '100');
    const joiner = queryBuilder(page).getByRole('button', { name: /^Joiner for condition 2/ });

    await joiner.click();
    await page.getByRole('menuitemradio', { name: /^and not/ }).click();

    await expect(joiner).toHaveAccessibleName('Joiner for condition 2: and not');
    const kept = outer - inner;
    await expect(countLine(page)).toHaveText(
      new RegExp(`^\\s*${kept.toLocaleString('en-US')} of `),
    );
    await filterApplyButton(page).click();
    await expect(filterButton(page)).toHaveAccessibleName('Filter, 2 conditions applied');
    expect((await readPlotFilter(page)).kept).toBe(kept);

    await undo(page);
    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(false);
    await redo(page);
    await expect.poll(async () => (await readPlotFilter(page)).kept).toBe(kept);
    await expect(joiner).toHaveAccessibleName('Joiner for condition 2: and not');
  });

  test('"is 1", then "is none of", then Remove filter: every category ends in its own colour', async ({
    page,
  }) => {
    await openExplore(page);
    await importUserFile(page, TOXPROT_5181_FIXTURE);
    await waitForExploreDataLoad(page, { proteinCount: 5181 });
    await selectAnnotation(page, 'protein_existence');
    const original = await legendColors(page);
    const levels = Object.keys(original);
    expect(levels.length).toBeGreaterThan(2);
    // Level 1 of UniProt's protein existence.
    const first = levels.find((level) => level.includes('protein level'))!;

    const card = await draftFilterCondition(page, 0, 'protein_existence', [first]);
    await filterApplyButton(page).click();
    await expect.poll(() => legendColors(page)).toEqual({ [first]: original[first] });

    await card.locator('.operator-pill').click();
    await page.getByRole('menuitemradio', { name: /^is none of/ }).click();
    await filterApplyButton(page).click();
    const { [first]: _first, ...rest } = original;
    await expect.poll(() => legendColors(page)).toEqual(rest);

    await clearStatusChip(page, 'filter');
    await expect.poll(() => legendColors(page)).toEqual(original);
  });
});
