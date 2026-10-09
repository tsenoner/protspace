import { expect, test, type Page } from '@playwright/test';
import { LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import { PHOSPHATASE_1587_FIXTURE } from './helpers/fixtures';
import { importUserFile, openExplore, waitForExploreDataLoad } from './helpers/explore';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  dockStructure,
  dragDivider,
  floatStructure,
  plotArea,
  rail,
  readLayout,
  seedLayout,
  structurePanel,
  stubStructureRequests,
  watchPlotResizes,
} from './helpers/workbench';

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

/** The floating card lies inside the plot area. */
async function expectCardInsidePlotArea(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const area = (await plotArea(page).boundingBox())!;
      const card = (await structurePanel(page).boundingBox())!;
      return (
        card.x >= area.x - 0.5 &&
        card.y >= area.y - 0.5 &&
        card.x + card.width <= area.x + area.width + 0.5 &&
        card.y + card.height <= area.y + area.height + 0.5
      );
    })
    .toBe(true);
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

test('Pop out floats the card over the plot without resizing it', async ({ page }) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const before = await plot.boundingBox();
  const resizes = await watchPlotResizes(page);
  await clickProteinNearPlotCentre(page);

  await floatStructure(page);

  // The default card: 340 × 360, 14 px in from the plot area's bottom-right corner.
  const area = (await plotArea(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expectNear(card.width, 340);
  expectNear(card.height, 360);
  expectNear(area.x + area.width - (card.x + card.width), 14);
  expectNear(area.y + area.height - (card.y + card.height), 14);
  // The legend takes the whole sidebar column.
  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  expectNear((await page.locator('#myLegend').boundingBox())!.height, body.height);
  await expect(page.getByRole('button', { name: 'Dock structure' })).toBeVisible();
  // The header keeps one 44 px row, links included, docked and floating.
  expectNear((await page.locator('#myStructureViewer .header').boundingBox())!.height, 44);
  expect(await plot.boundingBox()).toEqual(before);
  expect(await resizes()).toBe(0);

  // Closed, the section is the docked footer again, without the card's grip.
  await page.getByRole('button', { name: 'Close structure' }).click();
  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resize structure' })).toHaveCount(0);
});

test('docking and floating keep the same viewer and do not reload the structure', async ({
  page,
}) => {
  await openExplore(page);
  const viewer = page.locator('#myStructureViewer');
  await viewer.evaluate((element) => {
    const loads: string[] = [];
    (window as unknown as { __structureLoads: string[] }).__structureLoads = loads;
    element.addEventListener('structure-load', (event) =>
      loads.push((event as CustomEvent<{ status: string }>).detail.status),
    );
  });
  const loads = () =>
    page.evaluate(() => (window as unknown as { __structureLoads: string[] }).__structureLoads);
  await clickProteinNearPlotCentre(page);
  await expect.poll(loads).toEqual(['loading', 'loaded']);
  const viewerBefore = await viewer.elementHandle();
  const mountBefore = await viewer.locator('.molstar-mount').elementHandle();
  const resizes = await watchPlotResizes(page);

  await floatStructure(page);
  await dockStructure(page);
  await floatStructure(page);

  const viewerAfter = await viewer.elementHandle();
  const mountAfter = await viewer.locator('.molstar-mount').elementHandle();
  expect(await page.evaluate(([a, b]) => a !== null && a === b, [viewerBefore, viewerAfter])).toBe(
    true,
  );
  expect(
    await page.evaluate(
      ([a, b]) => a !== null && a === b && a.isConnected,
      [mountBefore, mountAfter],
    ),
  ).toBe(true);
  expect(await loads()).toEqual(['loading', 'loaded']);
  expect(await resizes()).toBe(0);
});

test('the card drags and resizes, survives a reload, and a card stored outside the plot or left outside by a shrinking window renders inside it', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  const card = structurePanel(page);
  const start = (await card.boundingBox())!;
  const resizes = await watchPlotResizes(page);

  // Drag by the header's title: the header's links and buttons do not drag.
  const title = (await page.locator('#myStructureViewer .title').boundingBox())!;
  const grabX = title.x + title.width / 2;
  const grabY = title.y + title.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX - 200, grabY - 100, { steps: 8 });
  await page.mouse.up();
  const moved = (await card.boundingBox())!;
  expectNear(moved.x, start.x - 200);
  expectNear(moved.y, start.y - 100);

  // Resize from the corner grip.
  const grip = (await page.getByRole('button', { name: 'Resize structure' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const resized = (await card.boundingBox())!;
  expectNear(resized.width, 380);
  expectNear(resized.height, 390);
  const stored = (await readLayout(page))!;
  expect(stored.structurePlacement).toBe('floating');
  expect(stored.floatingRect).toMatchObject({ width: 380, height: 390 });
  expect(await resizes()).toBe(0);

  // After a reload the card comes back where it was, once a protein shows.
  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  const reloaded = (await card.boundingBox())!;
  expectNear(reloaded.x, resized.x);
  expectNear(reloaded.y, resized.y);

  // A shrinking window keeps the card inside the plot area, and storage keeps the user's rect.
  await page.setViewportSize({ width: 1000, height: 600 });
  await expectCardInsidePlotArea(page);
  expect(await readLayout(page)).toEqual(stored);

  // A card stored outside the plot shows inside it.
  await page.setViewportSize({ width: 1280, height: 720 });
  await seedLayout(page, {
    structurePlacement: 'floating',
    floatingRect: { x: 5000, y: -300, width: 340, height: 360 },
  });
  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  await expectCardInsidePlotArea(page);
});

test('the card moves and resizes from the keyboard, and stays over the plot when the sidebar collapses', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  const card = structurePanel(page);
  const start = (await card.boundingBox())!;

  // The card is a named Tab stop; the arrow keys move it, 16 px a step or 64 px with Shift.
  await expect(card).toHaveAccessibleName('Structure');
  await card.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  const moved = (await card.boundingBox())!;
  expectNear(moved.x, start.x - 16);
  expectNear(moved.y, start.y - 64);
  expect((await readLayout(page))!.floatingRect).toMatchObject({
    x: Math.round(moved.x - (await plotArea(page).boundingBox())!.x),
  });

  // The grip resizes it from the keyboard.
  const grip = page.getByRole('button', { name: 'Resize structure' });
  await grip.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const resized = (await card.boundingBox())!;
  expectNear(resized.width, start.width + 16);
  expectNear(resized.height, start.height + 16);

  // Collapsing the sidebar leaves the card over the plot, and the rail's Structure focuses it.
  await collapseSidebar(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  await rail(page)
    .getByRole('button', { name: /^Structure: / })
    .click();
  await expect(card).toBeFocused();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'collapsed');
});

test('below 951 px there is no Pop out and a stored floating card shows docked', async ({
  page,
}) => {
  await seedLayout(page, { structurePlacement: 'floating' });
  await page.setViewportSize({ width: 900, height: 800 });
  await openExplore(page);
  await clickProteinNearPlotCentre(page);

  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out structure' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dock structure' })).toHaveCount(0);
  expect((await readLayout(page))?.structurePlacement).toBe('floating');
  // Stacked: the structure follows the legend.
  const legend = (await page.locator('#myLegend').boundingBox())!;
  expect((await structurePanel(page).boundingBox())!.y).toBeGreaterThanOrEqual(
    legend.y + legend.height - 1,
  );
});

test('while collapsed and docked, View structure in the pinned tooltip opens the sidebar', async ({
  page,
}) => {
  await openExplore(page);
  await collapseSidebar(page);
  const id = await clickProteinNearPlotCentre(page);

  const action = page.locator('#myPlot').getByRole('button', { name: 'View structure' });
  await expect(action).toBeVisible();
  // A hidden structure loads nothing until it is asked for.
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);

  await action.click();

  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
  await expect(action).toBeHidden();
});
