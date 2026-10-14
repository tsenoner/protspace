import { expect, test, type Page } from '@playwright/test';
import { getSelectedProteinIds, plotArea, selectionBar, viewBar } from './helpers/explore';
import {
  box,
  emptyPlotSpot,
  expectWithinViewport,
  line,
  openExplorePhone,
  overlaps,
  plotTooltip,
  proteinNear,
  proteinNearRightEdge,
  sheetToggle,
  structureSheet,
  tap,
  touchGesture,
  touchTargetsBelow,
  type Point,
} from './helpers/mobile';

/**
 * The plot under a finger (ported from feat/mobile-responsive, design decision 17): pinch, tap to
 * pin a tooltip, the structure sheet a tap opens, the selection bar, the tool strip and the
 * projection details card.
 */

const workbench = (page: Page) => page.locator('.workbench');
const selectedCount = async (page: Page) => (await getSelectedProteinIds(page)).length;

/**
 * Gives the projection details a card taller than any phone screen, opens it from its view-bar
 * button, and checks it fits the viewport and scrolls (the fixture's own card is short, so it
 * would fit without ever scrolling; workbench-escape.spec.ts injects a projection the same way).
 */
async function expectProjectionDetailsFit(page: Page): Promise<void> {
  await page.locator('#myProjectionMetadata').evaluate((details: Element) => {
    (details as Element & { projection: unknown }).projection = {
      name: 'Fixture projection',
      metadata: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`parameter_${i}`, i])),
    };
  });
  await viewBar(page).getByRole('button', { name: 'View projection metadata' }).tap();
  const card = page.locator('#myProjectionMetadata .content');
  await expect(card).toBeVisible();
  await expectWithinViewport(page, card);
  // The card is taller than the room it has, so it must scroll to what does not fit.
  expect(
    await card.evaluate((element) => element.scrollHeight > element.clientHeight),
    'the tall card overflows its box',
  ).toBe(true);
  const scrolled = await card.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0;
  });
  expect(scrolled, 'the card scrolls to what does not fit').toBe(true);
}

/** Scrolls the landscape page past its bar, at once (the page scrolls smoothly by default). */
async function scrollPastTheBar(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
}

test.describe('the plot on a touch screen', () => {
  test('P1: a pinch zooms the plot, not the page', async ({ page }) => {
    await openExplorePhone(page);
    // Without it, the browser would scroll or zoom the page on a pan or pinch d3-zoom also takes.
    const touchAction = await page
      .locator('#myPlot .container > svg')
      .evaluate((svg) => getComputedStyle(svg).touchAction);
    expect(touchAction).toBe('none');

    const plot = await box(page.locator('#myPlot'));
    const centre: Point = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
    await touchGesture(page, [
      line({ x: centre.x - 20, y: centre.y }, -80, 0),
      line({ x: centre.x + 20, y: centre.y }, 80, 0),
    ]);

    await expect
      .poll(() =>
        page
          .locator('#myPlot')
          .evaluate(
            (element) => (element as unknown as { _transform: { k: number } })._transform.k,
          ),
      )
      .toBeGreaterThan(2);
    const view = await page.evaluate(() => ({
      scale: window.visualViewport?.scale,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }));
    expect(view).toEqual({ scale: 1, scrollX: 0, scrollY: 0 });
  });

  test('P2: a tap near the right edge shows the tooltip inside the plot', async ({ page }) => {
    // Green once the tap's structure opens folded over the plot (5.8); the interim phone layout
    // shrinks the plot under the pinned card.
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    await tap(page, await proteinNearRightEdge(page));

    await expect(plotTooltip(page)).toHaveClass(/visible/);
    const plot = await box(page.locator('#myPlot'));
    const card = await box(plotTooltip(page));
    expect(card.x).toBeGreaterThanOrEqual(plot.x);
    expect(card.y).toBeGreaterThanOrEqual(plot.y);
    expect(card.x + card.width).toBeLessThanOrEqual(plot.x + plot.width);
    expect(card.y + card.height).toBeLessThanOrEqual(plot.y + plot.height);
    // Nothing inside the card is cut off.
    const clipped = await plotTooltip(page).evaluate((element) => {
      const inner = element.shadowRoot!.querySelector('.tooltip')!;
      return inner.scrollWidth > inner.clientWidth;
    });
    expect(clipped).toBe(false);
  });

  test('P3: a tap on empty space or a pan closes the tooltip', async ({ page }) => {
    // Green once the tap's structure opens folded over the plot (5.8); the interim phone layout
    // shrinks the plot under the pinned card.
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    const target = await proteinNearRightEdge(page);
    await tap(page, target);
    await expect(plotTooltip(page)).toHaveCount(1);

    await tap(page, await emptyPlotSpot(page));
    await expect(plotTooltip(page)).toHaveCount(0);

    await tap(page, target);
    await expect(plotTooltip(page)).toHaveCount(1);
    await touchGesture(page, [line(await emptyPlotSpot(page), 40, 30)]);
    await expect(plotTooltip(page)).toHaveCount(0);
  });

  test('P4: a first tap opens the sheet folded beside the tooltip', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    await tap(page, await proteinNearRightEdge(page));

    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
    const plot = await box(page.locator('#myPlot'));
    const sheet = await box(structureSheet(page));
    expect(sheet.y).toBeGreaterThanOrEqual(plot.y + plot.height - 1);
    expect(overlaps(await box(plotTooltip(page)), sheet)).toBe(false);

    // Another protein leaves the sheet as it was.
    await tap(page, await proteinNear(page, 0.3, 0.4));
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  });

  test('P5: an expanded sheet covers no tooltip and leaves the plot in view', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    const viewportHeight = page.viewportSize()!.height;
    await tap(page, await proteinNearRightEdge(page));
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(sheetToggle(page)).toHaveAccessibleName('Hide the structure');
    // The sheet has slid up once its bottom edge is the window's.
    await expect
      .poll(async () => {
        const sheet = await box(structureSheet(page));
        return Math.abs(sheet.y + sheet.height - viewportHeight);
      })
      .toBeLessThanOrEqual(1);
    const plot = await box(page.locator('#myPlot'));
    const sheet = await box(structureSheet(page));
    expect(sheet.height).toBeLessThanOrEqual(viewportHeight / 2 + 1);
    expect(sheet.y).toBeGreaterThan(plot.y + 100);
    await expect(plotTooltip(page)).toHaveCount(0);

    // A protein tapped above the open sheet is selected, and no tooltip opens over the plot.
    await tap(page, await proteinNear(page, 0.3, 0.3, sheet.y - 20));
    await expect.poll(() => selectedCount(page)).toBe(1);
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(plotTooltip(page)).toHaveCount(0);

    // Folded again, a tap pins the tooltip, and its View structure expands the sheet.
    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await tap(page, await proteinNear(page, 0.6, 0.3, sheet.y - 20));
    await expect(plotTooltip(page)).toHaveCount(1);
    await plotTooltip(page).getByRole('button', { name: 'View structure' }).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(plotTooltip(page)).toHaveCount(0);

    // Closed, the sheet starts over: the next protein opens it folded.
    await structureSheet(page).getByRole('button', { name: 'Close structure', exact: true }).tap();
    await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
    await tap(page, await proteinNear(page, 0.4, 0.4));
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  });

  test('P7: the tool strip buttons are 40 px touch targets', async ({ page }) => {
    test.fixme(true, 'task 5.12');
    await openExplorePhone(page);
    const tools = page.getByRole('toolbar', { name: 'Plot tools', exact: true });
    await expect(tools).toBeVisible();
    expect(await touchTargetsBelow(page, tools)).toEqual([]);
  });
});

test.describe('the plot on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('P6: the selection bar counts one protein and fits the plot', async ({ page }) => {
    await openExplorePhone(page);
    await tap(page, await proteinNear(page, 0.5, 0.4));

    await expect.poll(() => selectedCount(page)).toBe(1);
    await expect(page.locator('#mySelectionBar').getByRole('status')).toHaveText(
      '1 protein selected',
    );
    await expect(selectionBar(page)).toBeVisible();
    const bar = await box(selectionBar(page));
    const area = await box(plotArea(page));
    expect(bar.x).toBeGreaterThanOrEqual(area.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + area.height);
    // The status corner rises above the touch-sized bar (about 50 px under a coarse pointer).
    expect(overlaps(await box(page.locator('#myPlotStatus')), bar)).toBe(false);
  });
});

test.describe('the plot on a short phone screen', () => {
  test.use({ viewport: { width: 390, height: 600 } });

  test('P8: the projection details card fits the short plot and scrolls', async ({ page }) => {
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    await expectProjectionDetailsFit(page);
  });
});

test.describe('the plot on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('P9: the structure folds under the legend and expands over the right half', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await scrollPastTheBar(page);
    await tap(page, await proteinNear(page, 0.3, 0.5));

    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    const legend = await box(page.locator('#myLegend'));
    const folded = await box(structureSheet(page));
    // In the right column, under the legend.
    expect(folded.x).toBeGreaterThanOrEqual(legend.x - 1);
    expect(folded.y).toBeGreaterThanOrEqual(legend.y + legend.height - 1);
    expect(overlaps(await box(plotTooltip(page)), folded)).toBe(false);

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    const viewport = page.viewportSize()!;
    await expect
      .poll(async () => (await box(structureSheet(page))).width)
      .toBeGreaterThanOrEqual(viewport.width / 2 - 1);
    const sheet = await expectWithinViewport(page, structureSheet(page));
    expect(sheet.height).toBeGreaterThanOrEqual(200);

    // The close button sits beside the resource links, not over them.
    const close = structureSheet(page).getByRole('button', {
      name: 'Close structure',
      exact: true,
    });
    const closeBox = await box(close);
    for (const link of await page.locator('#myStructureViewer').getByRole('link').all()) {
      const bounds = await link.boundingBox();
      if (bounds) expect(overlaps(closeBox, bounds)).toBe(false);
    }
    await close.tap();
    await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  });

  test('P10: the projection details card fits the short screen and scrolls', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    // The card opens from the bar, which the page scrolls past: open it at the top.
    await expectProjectionDetailsFit(page);
  });
});
