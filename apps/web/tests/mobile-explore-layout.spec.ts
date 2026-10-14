import { expect, test, type Page } from '@playwright/test';
import { appBar, viewBar } from './helpers/explore';
import {
  bottomPanel,
  box,
  expectNoHorizontalOverflow,
  expectNoPageScroll,
  expectWithinViewport,
  openExplorePhone,
  proteinNear,
  sheetToggle,
  structureSheet,
  tap,
} from './helpers/mobile';

/**
 * The explore page's layout on phones, tablets and a phone on its side (ported from
 * feat/mobile-responsive, design decision 17).
 */

const workbench = (page: Page) => page.locator('.workbench');

test.describe('explore layout on a phone', () => {
  test('L1: the plot comes first and the legend panel sits below it, on one screen', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    const viewport = page.viewportSize()!;

    await expectNoHorizontalOverflow(page);
    await expectNoPageScroll(page);
    const plot = await box(page.locator('#myPlot'));
    const panel = await expectWithinViewport(page, bottomPanel(page));
    expect(plot.height).toBeGreaterThanOrEqual(viewport.height * 0.3);
    expect(plot.y + plot.height).toBeLessThanOrEqual(panel.y + 1);
  });

  test('L2: the structure opens as a sheet along the bottom edge', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    const viewport = page.viewportSize()!;
    await tap(page, await proteinNear(page, 0.5, 0.5));

    // Folded, only its 56 px header strip shows above the bottom edge.
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect
      .poll(async () => Math.abs((await box(structureSheet(page))).y - (viewport.height - 56)))
      .toBeLessThanOrEqual(1);

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect
      .poll(async () => {
        const sheet = await box(structureSheet(page));
        return Math.abs(sheet.y + sheet.height - viewport.height);
      })
      .toBeLessThanOrEqual(1);
    const sheet = await box(structureSheet(page));
    expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(sheet.height).toBeLessThan(viewport.height * 0.7);
  });
});

test.describe('explore layout on a tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('L3: on a tablet, the legend and the structure share the row under the plot', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.3');
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await tap(page, await proteinNear(page, 0.5, 0.5));
    await expect(page.locator('#myStructureViewer')).toBeVisible();

    const viewport = page.viewportSize()!;
    const bars = (await box(appBar(page))).height + (await box(viewBar(page))).height;
    const plot = await box(page.locator('#myPlot'));
    // About 3/5 of the height below the bars.
    expect(Math.abs(plot.height - 0.6 * (viewport.height - bars))).toBeLessThanOrEqual(8);
    const legend = await box(page.locator('#myLegend'));
    const structure = await box(structureSheet(page));
    expect(Math.abs(structure.y - legend.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(structure.height - legend.height)).toBeLessThanOrEqual(1);
    expect(structure.x).toBeGreaterThanOrEqual(legend.x + legend.width - 1);
    expect(Math.abs(structure.width - legend.width)).toBeLessThanOrEqual(1);
  });
});

test.describe('explore layout on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('L4: turned sideways, the page scrolls past the bar to a full-screen plot', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await expect
      .poll(async () => (await box(page.locator('#myPlot'))).height)
      .toBeGreaterThanOrEqual(360 * 0.6);
    await expectNoHorizontalOverflow(page);

    // At once: the page scrolls smoothly by default, which would leave it mid-way here.
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const plot = await box(page.locator('#myPlot'));
    const row = await box(page.locator('[data-workbench="body"]'));
    const legend = await box(page.locator('#myLegend'));
    // Scrolled to the end, the plot-and-legend row is exactly the screen.
    expect(plot.y).toBeGreaterThanOrEqual(0);
    expect(plot.y + plot.height).toBeLessThanOrEqual(361);
    expect(Math.abs(row.height - 360)).toBeLessThanOrEqual(1);
    expect(legend.x).toBeGreaterThanOrEqual(plot.x + plot.width - 1);
  });
});
