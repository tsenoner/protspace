import { expect, test, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  getFirstLegendItemValue,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

/**
 * A real double-click is click (detail 1), click (detail 2), dblclick, the two clicks tens of
 * milliseconds apart. Playwright's `dblclick()` sends them back to back, so these specs press
 * the button themselves with a pause between the clicks.
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

const legendRow = (page: Page, value: string) =>
  page
    .locator('protspace-legend')
    .getByRole('button', { name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`) });

async function realDoubleClick(page: Page, value: string, gapMs = 120): Promise<void> {
  const row = legendRow(page, value);
  const box = await row.boundingBox();
  if (!box) throw new Error(`No legend row for ${value}`);
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.waitForTimeout(gapMs);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
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

    await realDoubleClick(page, value);

    await expect.poll(() => visibleLegendValues(page)).toEqual([value]);
    // The first click hides the item; the second click is left to the dblclick.
    expect(await legendActions(page)).toEqual(['toggle', 'isolate']);
  });

  test('restores the full set when the isolated item is double-clicked', async ({ page }) => {
    const value = await getFirstLegendItemValue(page);
    const total = await legendItemCount(page);

    await realDoubleClick(page, value);
    await expect.poll(() => visibleLegendValues(page)).toEqual([value]);

    await realDoubleClick(page, value);
    await expect.poll(async () => (await visibleLegendValues(page)).length).toBe(total);
  });

  test('a single click still toggles at once', async ({ page }) => {
    const value = await getFirstLegendItemValue(page);

    await legendRow(page, value).click();

    await expect.poll(() => visibleLegendValues(page)).not.toContain(value);
    expect(await legendActions(page)).toEqual(['toggle']);
  });
});
