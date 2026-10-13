import { expect, test } from '@playwright/test';
import { SIDEBAR_WIDTH } from '../src/explore/layout-defaults';
import { getFirstLegendItemValue, openExplore, selectAnnotation } from './helpers/explore';
import {
  escapeRegex,
  isLegendItemHidden,
  legend,
  legendRow,
  legendRowAction,
  legendRowValues,
} from './helpers/legend';
import { seedLayout } from './helpers/workbench';

test.describe('workbench legend', () => {
  test('legend rows are 28 px with their actions hidden until hover', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);
    const row = legend(page).locator(`.legend-item[data-value="${value}"]`);

    expect((await row.boundingBox())?.height).toBeCloseTo(28, 0);
    const actions = row.locator('.legend-item-actions');
    await expect(actions).toHaveCSS('opacity', '0');
    await legendRow(page, value).hover();
    await expect(actions).toHaveCSS('opacity', '1');
  });

  test('the eye hides a category and the row stays, dimmed', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    // The demo's stored settings may already hide some rows: compare against them.
    const hiddenBefore = await legendRowValues(page, { visible: false });
    await legendRowAction(page, value, 'Hide');

    await expect.poll(() => isLegendItemHidden(page, value)).toBe(true);
    expect(await legendRowValues(page)).toContain(value);
    expect((await legendRowValues(page, { visible: false })).sort()).toEqual(
      [...hiddenBefore, value].sort(),
    );
    await expect(legendRow(page, value)).toHaveAccessibleName(/, hidden$/);
    await expect(
      legend(page).locator(`.legend-item[data-value="${value}"] .legend-swatch`),
    ).toHaveCSS('opacity', '0.35');
  });

  test('Show only this from the ⋯ menu isolates the category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    await legendRowAction(page, value, 'Show only this');

    await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([value]);
  });

  test("a long name ends in an ellipsis and its full name is in the row's accessible name", async ({
    page,
  }) => {
    await seedLayout(page, { sidebarWidth: SIDEBAR_WIDTH.min });
    await openExplore(page);
    await selectAnnotation(page, 'protein_families');
    const rows = legend(page).locator('.legend-item');
    await expect(rows.first()).toBeVisible();

    const truncated = await rows.evaluateAll((items) =>
      items
        .map((item) => {
          const text = item.querySelector('.legend-text') as HTMLElement;
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
          return {
            value: item.getAttribute('data-value') ?? '',
            label: text.textContent?.trim() ?? '',
            truncated: text.scrollWidth > text.clientWidth,
            oneLine: text.getBoundingClientRect().height <= lineHeight * 1.5,
          };
        })
        .filter((each) => each.truncated),
    );

    expect(truncated.length).toBeGreaterThan(0);
    const [longest] = truncated;
    expect(longest.oneLine).toBe(true);
    await expect(legendRow(page, longest.value)).toHaveAccessibleName(
      new RegExp(`^${escapeRegex(longest.label)}: `),
    );
  });
});
