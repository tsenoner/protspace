import { expect, test, type Page } from '@playwright/test';
import {
  applyFirstCategoryFilter,
  chooseTool,
  getSelectedProteinIds,
  importUserFile,
  openExplore,
  searchInput,
  selectionBarAction,
  statusChip,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';
import { stubStructureRequests } from './helpers/workbench';

test.beforeEach(async ({ page }) => {
  await stubStructureRequests(page);
});

/** The modifier the app reads as Mod, decided as its isMacOrIos() decides it. */
function modKey(page: Page): Promise<'Meta' | 'Control'> {
  return page.evaluate(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform;
    const mac = platform
      ? platform === 'macOS' || platform === 'iOS'
      : /Macintosh;.*Mac OS X/.test(navigator.userAgent) ||
        /iPhone|iPad|iPod/.test(navigator.userAgent);
    return mac ? 'Meta' : 'Control';
  });
}
const undo = async (page: Page) => page.keyboard.press(`${await modKey(page)}+KeyZ`);
const redo = async (page: Page) => page.keyboard.press(`${await modKey(page)}+Shift+KeyZ`);

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

const sorted = async (page: Page) => (await getSelectedProteinIds(page)).sort();

function isIsolated(page: Page): Promise<boolean> {
  return page
    .locator('#myPlot')
    .evaluate((plot) =>
      (plot as unknown as Element & { isIsolationMode(): boolean }).isIsolationMode(),
    );
}

/** Selects the dataset's first `count` proteins through the search box, then leaves the box. */
async function selectFirstBySearch(page: Page, count: number): Promise<string[]> {
  const ids = await page
    .locator('#myPlot')
    .evaluate(
      (plot, n) =>
        (plot as unknown as Element & { data: { protein_ids: string[] } }).data.protein_ids.slice(
          0,
          n,
        ),
      count,
    );
  for (const id of ids) {
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
  }
  await expect.poll(() => sorted(page)).toEqual([...ids].sort());
  await searchInput(page).blur();
  return ids;
}

const filtersActive = (page: Page) =>
  page
    .locator('#myPlot')
    .evaluate((plot) => (plot as unknown as Element & { filtersActive: boolean }).filtersActive);

test.describe('undo and redo', () => {
  test('box select → Ctrl+Z empties → Ctrl+Shift+Z restores', async ({ page }) => {
    await openExplore(page);
    await chooseTool(page, 'Box select');
    const plot = (await page.locator('#myPlot').boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, {
      steps: 10,
    });
    await page.mouse.up();
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBeGreaterThan(0);
    const ids = await sorted(page);

    await undo(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);

    await redo(page);
    await expect.poll(() => sorted(page)).toEqual(ids);
  });

  test('Show only these → Ctrl+Z returns the full view and the selection', async ({ page }) => {
    await openExplore(page);
    const ids = await selectFirstBySearch(page, 2);
    await selectionBarAction(page, 'Show only these').click();
    await expect.poll(() => isIsolated(page)).toBe(true);

    await undo(page);
    await expect.poll(() => isIsolated(page)).toBe(false);
    await expect(statusChip(page, 'isolation')).toHaveCount(0);
    await expect.poll(() => sorted(page)).toEqual([...ids].sort());
  });

  test('filter Apply → Ctrl+Z removes it and the chip goes; redo brings it back', async ({
    page,
  }) => {
    await openExplore(page);
    // Through the Filter panel, so the test fails if the builder stops reporting its Apply.
    await applyFirstCategoryFilter(page);
    await expect(statusChip(page, 'filter')).toContainText('Filtered · 1 condition');
    expect(await filtersActive(page)).toBe(true);

    await undo(page);
    await expect(statusChip(page, 'filter')).toHaveCount(0);
    expect(await filtersActive(page)).toBe(false);

    await redo(page);
    await expect(statusChip(page, 'filter')).toContainText('Filtered · 1 condition');
    expect(await filtersActive(page)).toBe(true);
  });

  test('Ctrl+Z in the search box is left to the browser and leaves the selection', async ({
    page,
  }) => {
    await openExplore(page);
    const [id] = await selectFirstBySearch(page, 1);
    await searchInput(page).click();
    await page.keyboard.type('abc');
    await expect(searchInput(page)).toHaveValue('abc');
    // Whether the key reached the window untouched. Headless Chromium on macOS runs no native
    // undo for a synthetic ⌘Z, so the field's text cannot show it there; an unprevented key is
    // what leaves the edit to the browser on every platform.
    await page.evaluate(() => {
      const seen = window as Window & { undoKeyPrevented?: boolean };
      window.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'z') seen.undoKeyPrevented = event.defaultPrevented;
      });
    });

    await undo(page);

    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { undoKeyPrevented?: boolean }).undoKeyPrevented),
      )
      .toBe(false);
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([id]);
    // Outside the field the same keys undo the pick, so the check above is not vacuous.
    await searchInput(page).blur();
    await undo(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
  });

  test('a new dataset clears the history', async ({ page }) => {
    await openExplore(page);
    // Two steps: undoing the second would bring back the first protein, so a history that
    // survived the new dataset would show.
    await selectFirstBySearch(page, 2);

    await importUserFile(page, TOXPROT_5181_FIXTURE);
    await waitForProteinCount(page, 5181);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
    await page.locator('#myPlot').focus();

    await undo(page);
    await twoFrames(page);
    expect(await getSelectedProteinIds(page)).toEqual([]);
    // The keys do reach the undo controller: a step taken in the new dataset undoes.
    await selectFirstBySearch(page, 1);
    await undo(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
  });
});
