import { expect, test, type Page } from '@playwright/test';
import { FLOATING_CARD, LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import { PHOSPHATASE_1587_FIXTURE } from './helpers/fixtures';
import {
  chooseTool,
  getSelectedProteinIds,
  importUserFile,
  openExplore,
  plotArea,
  selectionBar,
  selectionBarAction,
  waitForExploreDataLoad,
} from './helpers/explore';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  dockStructure,
  dragDivider,
  floatStructure,
  rail,
  readLayout,
  seedLayout,
  structurePanel,
  stubStructureRequests,
  watchPlotResizes,
} from './helpers/workbench';
import { chooseTheme } from './helpers/theme';

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

  // The default card: 340 × 360, 14 px in from the plot area's right edge and 76 px up from its
  // bottom, above the selection bar under either pointer.
  const area = (await plotArea(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expectNear(card.width, 340);
  expectNear(card.height, 360);
  expectNear(area.x + area.width - (card.x + card.width), 14);
  expectNear(area.y + area.height - (card.y + card.height), FLOATING_CARD.bottomInset);
  // The legend takes the whole sidebar column.
  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  expectNear((await page.locator('#myLegend').boundingBox())!.height, body.height);
  await expect(page.getByRole('button', { name: 'Dock structure' })).toBeVisible();
  // The header keeps one 44 px row; the links wrap in their own row below it.
  expectNear((await page.locator('#myStructureViewer .header').boundingBox())!.height, 44);
  expect(await plot.boundingBox()).toEqual(before);
  expect(await resizes()).toBe(0);

  // Closed, the section is the docked footer again, without the card's grip.
  await page.getByRole('button', { name: 'Close structure' }).click();
  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resize structure' })).toHaveCount(0);
});

test('the default floating card leaves Copy IDs and Clear clickable', async ({ page }) => {
  // 1280 × 720 with the sidebar open: the narrowest desktop plot the default card sits over.
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  await expect(selectionBar(page)).toBeVisible();

  // A trial click runs every actionability check, the hit test included, and clicks nothing: it
  // fails if the card intercepts the pointer.
  for (const name of ['Copy IDs', 'Clear'] as const) {
    await selectionBarAction(page, name).click({ trial: true, timeout: 5_000 });
  }
  const bar = (await selectionBar(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
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

  // A press on a header link does not drag the card.
  const link = (await page
    .locator('#myStructureViewer')
    .getByRole('link', { name: /AlphaFold/ })
    .boundingBox())!;
  await page.mouse.move(link.x + link.width / 2, link.y + link.height / 2);
  await page.mouse.down();
  await page.mouse.move(link.x - 100, link.y + link.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await card.boundingBox()).toEqual(moved);

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

  // A press on the header without a move writes nothing.
  const storedBefore = await readLayout(page);
  const t = (await page.locator('#myStructureViewer .title').boundingBox())!;
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  expect(await readLayout(page)).toEqual(storedBefore);

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
  // Polled: under load the first read can land before the move renders.
  await expect
    .poll(async () => {
      const box = (await card.boundingBox())!;
      return Math.max(Math.abs(box.x - (start.x - 16)), Math.abs(box.y - (start.y - 64)));
    })
    .toBeLessThanOrEqual(1);
  const moved = (await card.boundingBox())!;
  const movedX = Math.round(moved.x - (await plotArea(page).boundingBox())!.x);
  // The move is stored (and the card re-rendered from it) before the grip's keys start.
  await expect.poll(async () => (await readLayout(page))!.floatingRect?.x).toBe(movedX);

  // The grip resizes it from the keyboard, one step at a time, each polled.
  const grip = page.getByRole('button', { name: 'Resize structure' });
  await grip.focus();
  await expect(grip).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => Math.abs((await card.boundingBox())!.width - (start.width + 16)))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => Math.abs((await card.boundingBox())!.height - (start.height + 16)))
    .toBeLessThanOrEqual(1);

  // Collapsing the sidebar leaves the card over the plot: the rail's Structure still reads shown.
  await collapseSidebar(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  await expect(rail(page).getByRole('button', { name: /^Structure: / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  // Tablet: the structure sits beside the legend, in the right half of the row under the plot.
  const legend = (await page.locator('#myLegend').boundingBox())!;
  const structure = (await structurePanel(page).boundingBox())!;
  expect(structure.x).toBeGreaterThanOrEqual(legend.x + legend.width - 1);
  expect(Math.abs(structure.y - legend.y)).toBeLessThanOrEqual(1);
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

test('a press, a cancelled drag or a key that moves nothing leaves the default card unstored', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  const card = structurePanel(page);
  const start = (await card.boundingBox())!;
  expect((await readLayout(page))!.floatingRect).toBeNull();

  // A press and release on the title, without a move.
  const t = (await page.locator('#myStructureViewer .title').boundingBox())!;
  const [x, y] = [t.x + t.width / 2, t.y + t.height / 2];
  await page.mouse.click(x, y);
  expect((await readLayout(page))!.floatingRect).toBeNull();

  // A drag the browser cancels puts the card back and stores nothing.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y - 60, { steps: 4 });
  expectNear((await card.boundingBox())!.x, start.x - 120);
  await card.evaluate((section) =>
    section.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })),
  );
  await page.mouse.up();
  expect(await card.boundingBox()).toEqual(start);
  expect((await readLayout(page))!.floatingRect).toBeNull();

  // Still the default: collapsing the sidebar moves the card to the wider plot's corner.
  await collapseSidebar(page);
  await expect
    .poll(async () => {
      const area = (await plotArea(page).boundingBox())!;
      const box = (await card.boundingBox())!;
      return Math.round(area.x + area.width - (box.x + box.width));
    })
    .toBe(14);

  // At the corner, an arrow key that moves nothing writes nothing. The default sits 76 px above
  // the bottom, more than one 64 px step: press as many steps as the distance takes.
  await card.focus();
  const gap = async () => {
    const area = (await plotArea(page).boundingBox())!;
    const box = (await card.boundingBox())!;
    return {
      right: Math.round(area.x + area.width - (box.x + box.width)),
      bottom: Math.round(area.y + area.height - (box.y + box.height)),
    };
  };
  const toEdge = await gap();
  for (let i = 0; i < Math.ceil(toEdge.bottom / 64); i++)
    await page.keyboard.press('Shift+ArrowDown');
  for (let i = 0; i < Math.ceil(toEdge.right / 64); i++)
    await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(gap).toEqual({ right: 0, bottom: 0 });
  expect((await readLayout(page))!.floatingRect).not.toBeNull();
  await page.evaluate((key) => {
    const w = window as unknown as { __layoutWrites: number };
    w.__layoutWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) w.__layoutWrites++;
      setItem.call(this, name, value);
    };
  }, LAYOUT_STORAGE_KEY);
  const atEdge = await card.boundingBox();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  expect(await card.boundingBox()).toEqual(atEdge);
  expect(
    await page.evaluate(() => (window as unknown as { __layoutWrites: number }).__layoutWrites),
  ).toBe(0);
});

test('the floating card tells how its keys work and its grip is a 24 px target', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  await expect(structurePanel(page)).toHaveAccessibleDescription(/Arrow keys move the card/);
  const grip = page.getByRole('button', { name: 'Resize structure' });
  await expect(grip).toHaveAccessibleDescription(/Arrow keys resize the card/);
  const box = (await grip.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
});

test('the Dock structure tooltip stays hidden after Pop out', async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  const tip = page.locator(
    '#myStructureViewer ps-icon-button[slot="header-actions"] ps-tooltip .tip',
  );

  await floatStructure(page);
  // Past the 500 ms hover delay that the press cancelled, with the pointer left where it was.
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  await page.mouse.move(5, 300);
  await expect(tip).toBeHidden();

  // The tooltip still shows on a hover of the button.
  await page.getByRole('button', { name: 'Dock structure' }).hover();
  await expect(tip).toBeVisible();
});

test('docking from a collapsed sidebar opens it and keeps focus on the button', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  await collapseSidebar(page);
  await page.getByRole('button', { name: 'Dock structure' }).focus();
  await page.keyboard.press('Enter');
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out structure' })).toBeFocused();
});

test('View structure from the keyboard moves focus to the structure', async ({ page }) => {
  await openExplore(page);
  await collapseSidebar(page);
  await clickProteinNearPlotCentre(page);
  const action = page.locator('#myPlot').getByRole('button', { name: 'View structure' });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(structurePanel(page)).toBeFocused();
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('the divider, the sidebar edge and the float grip are 40 px targets', async ({ page }) => {
    await openExplore(page);
    await clickProteinNearPlotCentre(page);
    const line = (await divider(page).boundingBox())!;
    // The divider keeps its 9 px of layout and takes presses 15 px above and below it.
    expect(Math.round(line.height)).toBe(9);
    const midX = line.x + line.width / 2;
    const midY = line.y + line.height / 2;
    for (const dy of [-15, 15]) {
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.classList.contains('wb-divider') ?? false,
        [midX, midY + dy],
      );
      expect(hit, `${dy} px from the divider`).toBe(true);
    }
    const edge = (await page.locator('[data-workbench="sidebar-edge"]').boundingBox())!;
    expect(edge.width).toBeGreaterThanOrEqual(40);

    await floatStructure(page);
    const grip = (await page.getByRole('button', { name: 'Resize structure' }).boundingBox())!;
    expect(grip.width).toBeGreaterThanOrEqual(40);
    expect(grip.height).toBeGreaterThanOrEqual(40);
  });

  test('the card drags by its header', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP touch input is Chromium only');
    await openExplore(page);
    await clickProteinNearPlotCentre(page);
    await floatStructure(page);
    const card = structurePanel(page);
    const start = (await card.boundingBox())!;

    const cdp = await page.context().newCDPSession(page);
    const t = (await page.locator('#myStructureViewer .title').boundingBox())!;
    const [x, y] = [t.x + t.width / 2, t.y + t.height / 2];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 15 * i, y: y - 8 * i }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const moved = (await card.boundingBox())!;
    expectNear(moved.x, start.x - 150);
    expectNear(moved.y, start.y - 80);
    expect((await readLayout(page))!.floatingRect).not.toBeNull();
  });
});

test('a box selection of several proteins lets the header pick which one shows', async ({
  page,
}) => {
  await openExplore(page);
  await chooseTool(page, 'Box select');
  const box = (await page.locator('#myPlot').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBeGreaterThan(1);

  const viewer = page.locator('#myStructureViewer');
  const pick = viewer.getByRole('button', { name: /^Structure protein: / });
  await expect(pick).toBeVisible();
  const shown = await viewer.evaluate(
    (element) => (element as unknown as { proteinId: string | null }).proteinId,
  );
  expect(shown).not.toBeNull();

  await pick.click();
  await expect(viewer.getByRole('menuitemradio', { name: shown!, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const other = viewer.getByRole('menuitemradio', { checked: false }).first();
  const otherId = (await other.textContent())!.trim();
  const selected = await getSelectedProteinIds(page);
  await other.click();

  await expect(viewer).toHaveJSProperty('proteinId', otherId);
  await expect(pick).toContainText(otherId);
  // Picking which one to show leaves the selection as it was.
  expect(await getSelectedProteinIds(page)).toEqual(selected);
  expect(selected).toContain(otherId);
});

test('the TED link is clickable docked at 240 px and floating at 280 px', async ({ page }) => {
  await seedLayout(page, { sidebarWidth: 240 });
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  const ted = page.locator('#myStructureViewer').getByRole('link', { name: /^TED/ });
  await expect(ted).toBeVisible();
  // Actionable: visible, stable and the topmost element at its centre.
  await ted.click({ trial: true });

  await seedLayout(page, {
    structurePlacement: 'floating',
    floatingRect: { x: 40, y: 40, width: 280, height: 320 },
  });
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  expectNear((await structurePanel(page).boundingBox())!.width, 280);
  await expect(ted).toBeVisible();
  await ted.click({ trial: true });
});

test('the pinned View structure tooltip offers the links', async ({ page }) => {
  await openExplore(page);
  await collapseSidebar(page);
  await clickProteinNearPlotCentre(page);

  const tooltip = page.locator('#myPlot protspace-protein-tooltip');
  await expect(tooltip.getByRole('button', { name: 'View structure' })).toBeVisible();
  const links = tooltip.getByRole('link');
  await expect(links).toHaveText([/AlphaFold/, /UniProt/, /InterPro/, /TED/]);
  await links.last().click({ trial: true });
});

test("Mol*'s background follows the theme", async ({ page }) => {
  await openExplore(page);
  await chooseTheme(page, 'Light');
  await clickProteinNearPlotCentre(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  const background = () =>
    page.evaluate(
      () => (window as unknown as { __molstarBackground?: number }).__molstarBackground ?? null,
    );

  // The light --ps-surface, applied when the viewer was created.
  await expect.poll(background).toBe(0xffffff);
  await chooseTheme(page, 'Dark');
  await expect.poll(background).toBe(0x0f172a);
  await chooseTheme(page, 'Light');
  await expect.poll(background).toBe(0xffffff);
});

test("the rail's Structure button hides and shows the structure, docked and floating, across a reload", async ({
  page,
}) => {
  await openExplore(page);
  const id = await clickProteinNearPlotCentre(page);
  const toggle = rail(page).getByRole('button', { name: `Structure: ${id}` });
  const viewer = page.locator('#myStructureViewer');
  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer).toBeVisible();

  // Docked: hiding gives the legend the whole column; the protein stays loaded.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(viewer).toBeHidden();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect
    .poll(async () => (await page.locator('#myLegend').boundingBox())!.height)
    .toBeCloseTo(body.height, 0);
  expect(await readLayout(page)).toMatchObject({ structureHidden: true });

  // A reload keeps it hidden; the click shows it docked again.
  await page.reload();
  await waitForExploreDataLoad(page);
  const reloadedId = await clickProteinNearPlotCentre(page);
  const reloaded = rail(page).getByRole('button', { name: `Structure: ${reloadedId}` });
  await expect(reloaded).toHaveAttribute('aria-pressed', 'false');
  await expect(viewer).toBeHidden();
  // A plain click respects the choice: the protein waits behind the dot.
  await expect(viewer).toHaveJSProperty('proteinId', null);
  await reloaded.click();
  await expect(reloaded).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveJSProperty('proteinId', reloadedId);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');

  // Floating: hiding hides the card, showing brings back the card, not a docked section.
  await floatStructure(page);
  await reloaded.click();
  await expect(reloaded).toHaveAttribute('aria-pressed', 'false');
  await expect(structurePanel(page)).toBeHidden();
  await reloaded.click();
  await expect(reloaded).toHaveAttribute('aria-pressed', 'true');
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  await expect(structurePanel(page)).toBeVisible();
  await expectCardInsidePlotArea(page);

  // Collapsed and docked: the button opens the sidebar with the structure shown.
  await dockStructure(page);
  await collapseSidebar(page);
  await expect(reloaded).toHaveAttribute('aria-pressed', 'false');
  await reloaded.click();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(reloaded).toHaveAttribute('aria-pressed', 'true');
  await expect(viewer).toBeVisible();
});
