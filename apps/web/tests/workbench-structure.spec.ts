import { expect, test, type Page } from '@playwright/test';
import { LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import { PHOSPHATASE_1587_FIXTURE } from './helpers/fixtures';
import {
  clickProteinNearPlotCentre,
  dragDivider,
  importUserFile,
  openExplore,
  structurePanel,
  stubStructureRequests,
  waitForExploreDataLoad,
  watchPlotResizes,
} from './helpers/explore';

const workbench = (page: Page) => page.locator('.workbench');
const footer = (page: Page) => structurePanel(page).locator('[data-workbench="structure-empty"]');
const divider = (page: Page) =>
  page.getByRole('separator', { name: 'Resize legend and structure' });

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** The legend fraction protspace:layout:v1 holds, if any. */
async function storedLegendFraction(page: Page): Promise<number | undefined> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null
      ? undefined
      : (JSON.parse(raw) as { legendFraction?: number }).legendFraction;
  }, LAYOUT_STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await stubStructureRequests(page);
});

test('before any click the sidebar shows the Structure footer under a full-height legend', async ({
  page,
}) => {
  await openExplore(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(footer(page)).toContainText('Structure');
  await expect(footer(page)).toContainText('Click a protein to view it');
  await expect(page.locator('#myStructureViewer')).toBeHidden();
  await expect(divider(page)).toBeHidden();

  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  const legend = (await page.locator('#myLegend').boundingBox())!;
  const bar = (await footer(page).boundingBox())!;
  expectNear(bar.height, 44);
  expectNear(bar.y + bar.height, body.y + body.height);
  // The legend runs from the top of the column down to the footer.
  expectNear(legend.y, body.y);
  expectNear(legend.y + legend.height, bar.y);
});

test('clicking a protein shows the structure under a divider and the plot keeps its size', async ({
  page,
}) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const before = await plot.boundingBox();
  const resizes = await watchPlotResizes(page);

  const id = await clickProteinNearPlotCentre(page);

  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  const viewer = page.locator('#myStructureViewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveJSProperty('proteinId', id);
  await expect(footer(page)).toBeHidden();
  await expect(divider(page)).toBeVisible();
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '50');

  const legend = (await page.locator('#myLegend').boundingBox())!;
  const line = (await divider(page).boundingBox())!;
  const shown = (await viewer.boundingBox())!;
  expectNear(line.y, legend.y + legend.height);
  expectNear(shown.y, line.y + line.height);
  expect(await plot.boundingBox()).toEqual(before);
  expect(await resizes()).toBe(0);
});

test('the divider moves by drag and by keyboard, survives a reload and never resizes the plot', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '50');
  const resizes = await watchPlotResizes(page);
  const legend = page.locator('#myLegend');
  const start = (await legend.boundingBox())!.height;

  await dragDivider(page, -60);
  await expect
    .poll(async () => Math.abs((await legend.boundingBox())!.height - (start - 60)))
    .toBeLessThanOrEqual(2);
  const dragged = Number(await divider(page).getAttribute('aria-valuenow'));
  expect(dragged).toBeLessThan(50);
  expect(await storedLegendFraction(page)).toBeCloseTo(dragged / 100, 1);

  await divider(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged + 5));
  await page.keyboard.press('Shift+ArrowUp');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged - 15));
  expect(Math.round((await storedLegendFraction(page))! * 100)).toBe(dragged - 15);
  expect(await resizes()).toBe(0);

  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged - 15));

  // Home and End go to the ends of the range; End's 80 % is trimmed by the structure's 220 px.
  await divider(page).focus();
  await page.keyboard.press('Home');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '20');
  await page.keyboard.press('End');
  await expect
    .poll(async () => Number(await divider(page).getAttribute('aria-valuenow')))
    .toBeGreaterThan(50);
  expect(Number(await divider(page).getAttribute('aria-valuenow'))).toBeLessThanOrEqual(80);
  // The CSS clamp reads the same constants: the structure keeps 220 px under the 9 px divider.
  await expect.poll(async () => Math.round((await divider(page).boundingBox())!.height)).toBe(9);
  await expect
    .poll(async () =>
      Math.round((await page.locator('[data-workbench="structure"]').boundingBox())!.height),
    )
    .toBe(229);
});

test('Close structure brings the footer back', async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();

  await page.getByRole('button', { name: 'Close structure' }).click();

  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.locator('#myStructureViewer')).toBeHidden();
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);
});

test('loading another dataset clears the structure', async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');

  await importUserFile(page, PHOSPHATASE_1587_FIXTURE);
  await waitForExploreDataLoad(page, { proteinCount: 1587 });

  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);
});
