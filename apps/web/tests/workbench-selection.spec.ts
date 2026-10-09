import { expect, test, type Page } from '@playwright/test';
import {
  appBar,
  chooseTool,
  getSelectedProteinIds,
  importTrigger,
  isolateSelection,
  openExplore,
  plotArea,
  resetIsolation,
  searchInput,
  selectionAction,
} from './helpers/explore';

const toolStrip = (page: Page) => page.getByRole('toolbar', { name: 'Plot tools' });
const toolButton = (page: Page, name: string) =>
  toolStrip(page).getByRole('button', { name, exact: true });

/** The first `count` protein ids of the loaded dataset. */
function proteinIds(page: Page, count: number): Promise<string[]> {
  return page
    .locator('#myPlot')
    .evaluate(
      (plot, n) =>
        ((plot as Element & { data?: { protein_ids?: string[] } }).data?.protein_ids ?? []).slice(
          0,
          n,
        ),
      count,
    );
}

/** Selects `ids` one by one through the search box, the way a user types them. */
async function selectBySearch(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
  }
  await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids);
}

test.describe('plot tools and selection', () => {
  test("the tool strip sits in the plot's top-left with its tools named", async ({ page }) => {
    await openExplore(page);

    await expect(toolStrip(page)).toBeVisible();
    for (const name of ['Move and zoom', 'Box select', 'Lasso select', 'Fit to view']) {
      await expect(toolButton(page, name)).toBeVisible();
    }
    await expect(toolButton(page, 'Move and zoom')).toHaveAttribute('aria-pressed', 'true');

    const plot = (await page.locator('#myPlot').boundingBox())!;
    const area = (await plotArea(page).boundingBox())!;
    const strip = (await toolStrip(page).boundingBox())!;
    // 12 px from the plot's top-left, laid over it: the plot keeps the whole plot area.
    expect(Math.abs(strip.x - plot.x - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(strip.y - plot.y - 12)).toBeLessThanOrEqual(1);
    expect(plot).toEqual(area);
  });

  test('Box select selects by dragging; Escape clears, then returns to Move', async ({ page }) => {
    await openExplore(page);
    await chooseTool(page, 'Box select');
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    const plot = (await page.locator('#myPlot').boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, {
      steps: 10,
    });
    await page.mouse.up();
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBe(0);
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(toolButton(page, 'Move and zoom')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page
        .locator('#myPlot')
        .evaluate((p) => (p as Element & { selectionMode?: boolean }).selectionMode),
    ).toBe(false);
  });

  test('Escape in the search box closes open suggestions and keeps the selection; the next Escape clears it', async ({
    page,
  }) => {
    await openExplore(page);
    const [id] = await proteinIds(page, 1);
    await selectBySearch(page, [id]);

    // Typing again opens the suggestions; Escape closes them and nothing else.
    const suggestions = page.locator('protspace-protein-search').getByRole('listbox');
    await searchInput(page).fill(id.slice(0, 2));
    await expect(suggestions).toBeVisible();
    await searchInput(page).press('Escape');
    await expect(suggestions).toBeHidden();
    // A wrong clear shows at once in the tools and reaches the plot after the paint.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(selectionAction(page, 'Clear')).toBeVisible();
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    // Nothing left to close: the next Escape clears the selection.
    await searchInput(page).press('Escape');
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBe(0);
  });

  test('Clear, Isolate and Reset appear when they apply', async ({ page }) => {
    await openExplore(page);
    await expect(page.getByRole('group', { name: 'Selection' })).toHaveCount(0);

    await selectBySearch(page, await proteinIds(page, 2));
    await expect(selectionAction(page, 'Clear')).toBeVisible();
    await expect(selectionAction(page, 'Isolate')).toBeVisible();
    await expect(selectionAction(page, 'Reset')).toHaveCount(0);

    await isolateSelection(page);
    await expect(selectionAction(page, 'Reset')).toBeVisible();
    await expect(selectionAction(page, 'Clear')).toHaveCount(0);

    await resetIsolation(page);
    await expect(page.getByRole('group', { name: 'Selection' })).toHaveCount(0);
  });

  test('search sits in the app bar and Ctrl+K focuses it', async ({ page }) => {
    await openExplore(page);
    await expect(appBar(page).locator('protspace-protein-search')).toHaveCount(1);

    // Centred in the bar's content box while both sides fit (1280 px); its padding is 16 px
    // left and 8 px right.
    const bar = (await appBar(page).boundingBox())!;
    const search = (await page.locator('#myProteinSearch').boundingBox())!;
    const shift = await appBar(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return (parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 2;
    });
    expect(
      Math.abs(search.x + search.width / 2 - (bar.x + bar.width / 2 + shift)),
    ).toBeLessThanOrEqual(1);
    expect(search.height).toBeLessThanOrEqual(32);

    await page.locator('body').press('Control+k');
    await expect(searchInput(page)).toBeFocused();
    // The field shows the focus ring.
    expect(
      await page
        .locator('protspace-protein-search .search-chips')
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe('solid');
  });

  test('the app bar keeps one row without overflow at 951, 1024, 1280 and 1440 px', async ({
    page,
  }) => {
    await openExplore(page);
    for (const width of [951, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 720 });
      const bar = appBar(page);
      const box = (await bar.boundingBox())!;
      expect(box.height).toBe(48);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      const groups = await Promise.all(
        ['app-bar-start', 'app-bar-center', 'app-bar-actions'].map(
          async (name) => (await page.locator(`[data-workbench="${name}"]`).boundingBox())!,
        ),
      );
      for (const group of groups) {
        expect(group.y).toBeGreaterThanOrEqual(box.y);
        expect(group.y + group.height).toBeLessThanOrEqual(box.y + box.height);
      }
      // Left to right, never overlapping.
      expect(groups[0].x + groups[0].width).toBeLessThanOrEqual(groups[1].x + 1);
      expect(groups[1].x + groups[1].width).toBeLessThanOrEqual(groups[2].x + 1);
      // The dataset name shows in full (it truncates only past 200 px); search narrows instead.
      const name = page.locator('.wb-dataset-name');
      await expect(name).toBeVisible();
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect((await page.locator('#myProteinSearch').boundingBox())!.width).toBeGreaterThanOrEqual(
        200,
      );

      // Icon-only below 1100 px, still named.
      await expect(importTrigger(page)).toHaveAccessibleName('Import');
      await expect(appBar(page).getByRole('button', { name: 'Export' })).toBeVisible();
      if (width < 1024) await expect(page.locator('.wb-dataset-count')).toBeHidden();
      else await expect(page.locator('.wb-dataset-count')).toBeVisible();
    }
  });
});
