import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportMenu, selectAnnotation } from './helpers/explore';
import {
  getFirstLegendItemValue,
  legend,
  legendOtherDialog,
  legendRowAction,
  legendRowValues,
  legendSettingsDialog,
  legendSortButton,
  openLegendOther,
} from './helpers/legend';
import {
  box,
  expectWithinViewport,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelFold,
  panelTab,
  touchDrag,
  touchTargetsBelow,
  type Box,
  type Point,
} from './helpers/mobile';
import { readLayout } from './helpers/workbench';

/**
 * The legend on a phone (ported from feat/mobile-responsive, design decision 17): touch targets,
 * tap, double tap, swipe and long press on its rows, the panel's fold, and the dialogs it opens.
 */

const rows = (page: Page): Locator => legend(page).locator('.legend-item');

/** The main button of the row holding `value`, found by the row's data-value. */
const rowMain = (page: Page, value: string): Locator =>
  legend(page).locator(`.legend-item[data-value=${JSON.stringify(value)}] .legend-item-main`);

/** The value of the row at `index` in display order. */
async function rowValue(page: Page, index: number): Promise<string> {
  const value = await rows(page).nth(index).getAttribute('data-value');
  if (value === null) throw new Error(`Legend row ${index} has no data-value`);
  return value;
}

async function centre(locator: Locator): Promise<Point> {
  const bounds = await box(locator);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

const listScrollTop = (page: Page): Promise<number> =>
  legend(page)
    .locator('.legend-items')
    .evaluate((list) => list.scrollTop);

test.describe('the legend on a phone', () => {
  test('G1: each row control and header button is a 40 px touch target', async ({ page }) => {
    await openExplorePhone(page);
    const first = rows(page).first();
    const targets: Record<string, Box> = {
      eye: await box(first.locator('.legend-eye')),
      handle: await box(first.locator('.drag-handle')),
      more: await box(legend(page).locator('.legend-more').first()),
      sort: await box(legendSortButton(page)),
      settings: await box(
        legend(page).getByRole('button', { name: 'Legend settings', exact: true }),
      ),
    };
    for (const [name, target] of Object.entries(targets)) {
      expect(target.width, `${name} width`).toBeGreaterThanOrEqual(40);
      expect(target.height, `${name} height`).toBeGreaterThanOrEqual(40);
    }
    // A one-line row is no taller than its targets.
    expect((await box(first)).height).toBeLessThanOrEqual(44);
  });

  test('G2: a swipe that starts on a drag handle scrolls the rows without reordering them', async ({
    page,
  }) => {
    await openExplorePhone(page);
    const before = await legendRowValues(page);

    await touchDrag(page, await centre(rows(page).nth(2).locator('.drag-handle')), -100);

    await expect.poll(() => listScrollTop(page)).toBeGreaterThan(30);
    expect(await legendRowValues(page)).toEqual(before);
  });

  test('G3: a long press on a drag handle lifts the row to reorder it', async ({ page }) => {
    await openExplorePhone(page);
    const [first, second] = await legendRowValues(page);

    // Past Sortable's 250 ms touch delay, then down by a little over a row.
    await touchDrag(page, await centre(rows(page).first().locator('.drag-handle')), 60, 400);

    await expect
      .poll(async () => (await legendRowValues(page)).slice(0, 2))
      .toEqual([second, first]);
    // A touch drag floats a copy of the row; the drop must not leave it behind.
    await expect(page.locator('.sortable-fallback')).toHaveCount(0);
  });

  test('G4: a tap toggles a category', async ({ page }) => {
    await openExplorePhone(page);
    const row = rowMain(page, await rowValue(page, 1));

    await row.tap();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    // Further apart than a double tap (300 ms), so the second tap shows the row again rather
    // than isolating it.
    await page.waitForTimeout(400);
    await row.tap();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('G5: a double tap isolates a category, even where the browser sends no dblclick', async ({
    page,
  }) => {
    await openExplorePhone(page);
    // iOS Safari sends no dblclick for a double tap; stand in for it by swallowing Chromium's.
    await page.evaluate(() =>
      window.addEventListener('dblclick', (event) => event.stopImmediatePropagation(), true),
    );
    const row = rowMain(page, await rowValue(page, 1));

    await row.tap();
    await row.tap();

    await expect(legend(page).locator('.legend-item-main[aria-pressed="true"]')).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('G6: the fold chevron folds the rows away and gives the plot the room', async ({ page }) => {
    await openExplorePhone(page);
    const plotHeight = async () => (await box(page.locator('#myPlot'))).height;
    const before = await plotHeight();

    await panelFold(page).tap();

    await expect(panelFold(page)).toHaveAccessibleName('Unfold panel');
    await expect.poll(plotHeight).toBeGreaterThan(before + 50);
    await expect(panelTab(page, 'Legend')).toBeVisible();
    await expect(rows(page).first()).toBeHidden();
    expect(await readLayout(page)).toMatchObject({ panelFolded: true });

    await panelFold(page).tap();
    await expect(panelFold(page)).toHaveAccessibleName('Fold panel');
    await expect(rows(page).first()).toBeVisible();
    await expect.poll(plotHeight).toBeCloseTo(before, 0);
    expect(await readLayout(page)).toMatchObject({ panelFolded: false });
  });

  test('G7: the settings popover fits the screen with its controls in reach', async ({ page }) => {
    await openExplorePhone(page);
    await legend(page).getByRole('button', { name: 'Legend settings', exact: true }).tap();

    const panel = legendSettingsDialog(page);
    await expect(panel).toBeVisible();
    await expectWithinViewport(page, panel);
    // The popover's controls are slotted: scope them to its element, not to the panel.
    const settings = legend(page).locator('protspace-legend-settings-popover');
    const reset = await expectWithinViewport(
      page,
      settings.getByRole('button', { name: 'Reset', exact: true }),
    );
    // Half a pixel of slack, as touchTargetsBelow allows: the box reads 39.99997 on some runs.
    expect(reset.height).toBeGreaterThanOrEqual(39.5);
  });

  test('G8: the Figure editor fits the screen, stacked upright and side by side sideways, with 40 px targets', async ({
    page,
  }) => {
    await openExplorePhone(page);
    // On a phone, Export lives in the More sheet; the sheet closes before the menu opens.
    await moreButton(page).tap();
    await moreSheetContent(page)
      .getByRole('button', { name: /^Export/ })
      .tap();
    await expect(moreSheet(page)).toBeHidden();
    await exportMenu(page).getByRole('menuitem', { name: 'Figure editor…', exact: true }).tap();

    const editor = page.getByRole('dialog', { name: 'Figure editor', exact: true });
    await expect(editor).toBeVisible();
    for (const size of [null, { width: 740, height: 360 }]) {
      if (size) await page.setViewportSize(size);
      const viewport = page.viewportSize()!;
      await expect
        .poll(async () => {
          const bounds = await box(editor);
          return Math.max(
            Math.abs(bounds.x),
            Math.abs(bounds.y),
            Math.abs(bounds.width - viewport.width),
            Math.abs(bounds.height - viewport.height),
          );
        })
        .toBeLessThanOrEqual(1);
      const close = editor.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeVisible();
      const bounds = await expectWithinViewport(page, close);
      expect(bounds.width).toBeGreaterThanOrEqual(40);
      expect(bounds.height).toBeGreaterThanOrEqual(40);
      // Task 5.12: upright the preview stacks over the settings, sideways it sits beside them.
      // The editor's content is slotted into the dialog, so it is found from the modal's host.
      const modal = page.locator('protspace-publish-modal');
      const preview = await box(modal.locator('.publish-preview'));
      const settings = await box(modal.locator('.publish-sidebar'));
      if (size) expect(preview.x + preview.width).toBeLessThanOrEqual(settings.x + 1);
      else expect(preview.y + preview.height).toBeLessThanOrEqual(settings.y + 1);
      expect(await touchTargetsBelow(page, modal)).toEqual([]);
    }
  });
});

test.describe('popovers from a full-width legend row', () => {
  test('the colour picker and the Other popover opened from a full-width row stay inside the viewport', async ({
    page,
  }) => {
    await openExplorePhone(page);
    // 'order' has 18 values, so the default 10 rows leave eight under Other.
    await selectAnnotation(page, 'order');

    // The picker opens beside its row (left-start); on a phone the row spans the screen.
    const value = await getFirstLegendItemValue(page);
    await legendRowAction(page, value, 'Colour and shape');
    const picker = legend(page).getByRole('dialog', { name: /^Colour and shape/ });
    await expect(picker).toBeVisible();
    await expectWithinViewport(page, picker);
    // The shapes and the swatch are finger-sized (Task 5.12). They are slotted into the popover,
    // so they are measured from its host.
    const pickerHost = legend(page)
      .locator('ps-popover')
      .filter({ has: page.locator('.shape-picker-item') });
    await expect(pickerHost.locator('.shape-picker-item').first()).toBeVisible();
    expect(await touchTargetsBelow(page, pickerHost)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();

    await openLegendOther(page);
    await expectWithinViewport(page, legendOtherDialog(page));
  });
});
