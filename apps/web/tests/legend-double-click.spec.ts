import { expect, test, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  getFirstLegendItemValue,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';
import { doubleClickLegendRow, legendRow } from './helpers/legend';

/**
 * A real double-click is click (detail 1), click (detail 2), dblclick, the two clicks tens of
 * milliseconds apart. Playwright's `dblclick()` sends them back to back, so these specs use
 * `doubleClickLegendRow`, which pauses between the clicks.
 */

interface LegendWindow extends Window {
  __legendActions?: string[];
}

async function watchLegendActions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as LegendWindow;
    win.__legendActions = [];
    document.querySelector('protspace-legend')?.addEventListener('legend-item-click', (event) => {
      const { action } = (event as CustomEvent<{ action: string }>).detail;
      win.__legendActions?.push(action);
    });
  });
}

const legendActions = (page: Page) =>
  page.evaluate(() => (window as LegendWindow).__legendActions ?? []);

const visibleLegendValues = (page: Page) =>
  page.evaluate(() => {
    const legend = document.querySelector('protspace-legend');
    return Array.from(legend?.shadowRoot?.querySelectorAll('.legend-item[data-value]') ?? [])
      .filter((item) => !item.classList.contains('hidden'))
      .map((item) => item.getAttribute('data-value'));
  });

async function legendItemCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.querySelector('protspace-legend')?.shadowRoot?.querySelectorAll('.legend-item')
        .length ?? 0,
  );
}

test.describe('Legend double-click', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForExploreInteractionReady(page);
    await watchLegendActions(page);
  });

  test('isolates the item without toggling it a second time', async ({ page }) => {
    const value = await getFirstLegendItemValue(page);

    await doubleClickLegendRow(page, value);

    await expect.poll(() => visibleLegendValues(page)).toEqual([value]);
    // The first click hides the item; the second click is left to the dblclick.
    expect(await legendActions(page)).toEqual(['toggle', 'isolate']);
  });

  test('restores the full set when the isolated item is double-clicked', async ({ page }) => {
    const value = await getFirstLegendItemValue(page);
    const total = await legendItemCount(page);

    await doubleClickLegendRow(page, value);
    await expect.poll(() => visibleLegendValues(page)).toEqual([value]);

    await doubleClickLegendRow(page, value);
    await expect.poll(async () => (await visibleLegendValues(page)).length).toBe(total);
  });

  test('a single click still toggles at once', async ({ page }) => {
    const value = await getFirstLegendItemValue(page);

    await legendRow(page, value).click();

    await expect.poll(() => visibleLegendValues(page)).not.toContain(value);
    expect(await legendActions(page)).toEqual(['toggle']);
  });
});
