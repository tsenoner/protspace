import { expect, test, type Page } from '@playwright/test';
import {
  getSelectedProteinIds,
  plotArea,
  selectionBar,
  selectionBarAction,
  viewBar,
} from './helpers/explore';
import { legend } from './helpers/legend';
import {
  box,
  emptyPlotSpot,
  expectWithinViewport,
  line,
  openExplorePhone,
  overlaps,
  panelFold,
  panelTab,
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
import { seedLayout, watchPlotResizes } from './helpers/workbench';

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
    await openExplorePhone(page);
    await tap(page, await proteinNearRightEdge(page));

    await expect(plotTooltip(page)).toHaveClass(/visible/);
    const plot = await box(page.locator('#myPlot'));
    const card = await box(plotTooltip(page));
    expect(card.x).toBeGreaterThanOrEqual(plot.x);
    expect(card.y).toBeGreaterThanOrEqual(plot.y);
    expect(card.x + card.width).toBeLessThanOrEqual(plot.x + plot.width);
    expect(card.y + card.height).toBeLessThanOrEqual(plot.y + plot.height);
    // The tool strip and the status corner, which stack above the plot, cover none of it; the
    // status corner has risen over the selection bar the tap shows.
    await expect(selectionBar(page)).toBeVisible();
    const tools = await box(page.getByRole('toolbar', { name: 'Plot tools', exact: true }));
    const status = await box(page.locator('#myPlotStatus'));
    await expect
      .poll(async () => {
        const shown = await box(plotTooltip(page));
        return [overlaps(shown, tools), overlaps(shown, status)];
      })
      .toEqual([false, false]);
    // Nothing inside the card is cut off.
    const clipped = await plotTooltip(page).evaluate((element) => {
      const inner = element.shadowRoot!.querySelector('.tooltip')!;
      return inner.scrollWidth > inner.clientWidth;
    });
    expect(clipped).toBe(false);
  });

  test('P3: a tap on empty space or a pan closes the tooltip', async ({ page }) => {
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
    // Folded, the viewer's body stays out of sight (Task 5.8's rule holds in landscape too).
    const body = page.locator('#myStructureViewer [part~="body"]');
    await expect(body).toBeHidden();

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    // Expanded, Mol*'s body shows: the folded rule no longer hides it.
    await expect(body).toBeVisible();
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
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    // The card opens from the bar, which the page scrolls past: open it at the top.
    await expectProjectionDetailsFit(page);
  });
});

/** Two frames: a ResizeObserver has reported whatever the last change did. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

test.describe('structure sheet', () => {
  test('folding and expanding the sheet never resizes the plot', async ({ page }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    const resizes = await watchPlotResizes(page);

    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'expanded');
    await expect(sheetToggle(page)).toHaveAccessibleName('Hide the structure');
    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await settle(page);
    expect(await resizes()).toBe(0);
  });

  test('the grip and the header row toggle the sheet; the close button does not', async ({
    page,
  }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');

    const grip = await box(structureSheet(page).locator('.wb-sheet-grip'));
    await tap(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 });
    await expect(root).toHaveAttribute('data-sheet', 'expanded');
    // The title inside the viewer's header part: no control on the path.
    await structureSheet(page).locator('#myStructureViewer .header .title').tap();
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await structureSheet(page).getByRole('button', { name: 'Close structure', exact: true }).tap();
    await expect(root).toHaveAttribute('data-structure', 'none');
    await expect(root).not.toHaveAttribute('data-sheet');
  });

  test('the expanded sheet takes the panel it covers out of the Tab order', async ({ page }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    const resizes = await watchPlotResizes(page);

    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'expanded');
    await expect(panelTab(page, 'Legend')).toBeHidden();
    await expect(panelFold(page)).toBeHidden();

    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await expect(panelTab(page, 'Legend')).toBeVisible();
    await expect(panelFold(page)).toBeVisible();
    await settle(page);
    expect(await resizes()).toBe(0);
  });

  test('under reduced motion the sheet moves without a transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openExplorePhone(page);
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(page.locator('.workbench')).toHaveAttribute('data-sheet', 'folded');
    expect(await structureSheet(page).evaluate((e) => getComputedStyle(e).transitionProperty)).toBe(
      'none',
    );
  });

  test('the last legend row can be scrolled above the folded sheet', async ({ page }) => {
    await openExplorePhone(page);
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(page.locator('.workbench')).toHaveAttribute('data-sheet', 'folded');

    const last = legend(page).locator('.legend-item').last();
    await last.scrollIntoViewIfNeeded();
    const row = await box(last);
    const sheet = await box(structureSheet(page));
    expect(row.y + row.height).toBeLessThanOrEqual(sheet.y + 1);
  });

  test('with the panel folded, a structure opening resizes the plot once and the tabs stay visible', async ({
    page,
    context,
  }) => {
    await seedLayout(page, { panelFolded: true });
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await expect(root).toHaveAttribute('data-panel-folded');
    const resizes = await watchPlotResizes(page);

    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await expect.poll(resizes).toBe(1);
    await settle(page);
    expect(await resizes()).toBe(1);

    const sheet = await box(structureSheet(page));
    for (const name of ['Legend', 'Filter'] as const) {
      const tab = await box(panelTab(page, name));
      expect(overlaps(tab, sheet)).toBe(false);
      expect(tab.y + tab.height).toBeLessThanOrEqual(sheet.y + 1);
    }

    // A toast stands above the folded panel and the sheet (--wb-panel-height carries the 56 px).
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await selectionBarAction(page, 'Copy IDs').tap();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /^Copied/ });
    await expect(toast).toBeVisible();
    await expect
      .poll(async () => {
        const shown = await box(toast);
        return shown.y + shown.height;
      })
      .toBeLessThanOrEqual(sheet.y - 12 + 1);
  });
});
