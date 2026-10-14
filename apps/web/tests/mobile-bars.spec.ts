import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  annotationSelect,
  appBar,
  colorByTrigger,
  datasetSwitcher,
  exportMenu,
  filterApplyButton,
  filterPanel,
  getContoursMode,
  getSelectedProteinIds,
  getViewState,
  importTrigger,
  projectionTrigger,
  queryBuilder,
  searchInput,
  viewBar,
  waitForExploreDataLoad,
} from './helpers/explore';
import {
  bottomPanel,
  box,
  emptyPlotSpot,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelTab,
  proteinNear,
  searchToggle,
  tap,
  touchTargetsBelow,
} from './helpers/mobile';
import { stubStructureRequests } from './helpers/workbench';

/**
 * The app bar, the view bar and the More sheet on phones, a phone on its side and a portrait
 * tablet (ported from feat/mobile-responsive's control-bar spec, design decision 17), and the
 * product tour on a phone.
 */

const PHONES = [
  { label: 'C1', viewport: { width: 360, height: 740 } },
  { label: 'C2', viewport: { width: 412, height: 839 } },
] as const;

const workbench = (page: Page) => page.locator('.workbench');
const exportTrigger = (page: Page) =>
  exportMenu(page).getByRole('button', { name: 'Export', exact: true });
const exportMenuList = (page: Page) =>
  exportMenu(page).getByRole('menu', { name: 'Export', exact: true });

/**
 * The visible controls and labels inside `root` whose text is cut off, by name. The dataset
 * name is exempt: it may end in an ellipsis. With `pickersMayShrink` (screens under 400 px) the
 * Projection and Color by pickers are exempt too: the skeleton has them shrink with an ellipsis
 * there, and the test checks separately that each keeps 48 px of its value.
 */
async function truncatedLabels(root: Locator, pickersMayShrink = false): Promise<string[]> {
  return root
    .locator('button, [role="button"], [part~="value"], .dropdown-trigger-text')
    .evaluateAll(
      (elements, pickersExempt) =>
        elements.flatMap((element) => {
          if (element.closest('[data-workbench="dataset"]')) return [];
          // A picker's value sits in its shadow root: find the host through the root node.
          const host = (element.getRootNode() as ShadowRoot).host ?? element;
          if (pickersExempt && host.closest('#myProjectionSelect, #myAnnotationSelect')) return [];
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return [];
          if (element.scrollWidth <= element.clientWidth + 1) return [];
          return [(element.getAttribute('aria-label') ?? element.textContent ?? '').trim()];
        }),
      pickersMayShrink,
    );
}

/** Opens the More sheet from the view bar and returns the scope its rows are found in. */
async function openMoreSheet(page: Page): Promise<Locator> {
  await moreButton(page).tap();
  await expect(moreSheet(page)).toBeVisible();
  return moreSheetContent(page);
}

for (const { label, viewport } of PHONES) {
  test.describe(`the bars at ${viewport.width} px`, () => {
    test.use({ viewport });

    test(`${label}: the bars fit with whole labels and 40 px targets at ${viewport.width} px`, async ({
      page,
    }) => {
      await openExplorePhone(page);

      const app = await box(appBar(page));
      const view = await box(viewBar(page));
      expect(Math.round(app.height)).toBe(48);
      expect(Math.round(view.height)).toBe(48);
      expect(app.height + view.height).toBeLessThanOrEqual(97);

      // App bar: the wordmark, the dataset name and search; the rest is in the More sheet.
      await expect(appBar(page).getByRole('link', { name: 'ProtSpace home' })).toBeVisible();
      await expect(datasetSwitcher(page)).toBeVisible();
      await expect(searchToggle(page)).toBeVisible();
      await expect(importTrigger(page)).toBeHidden();
      await expect(exportTrigger(page)).toBeHidden();
      await expect(appBar(page).getByRole('button', { name: 'Help', exact: true })).toBeHidden();
      // The Help menu's popover host stays rendered: no display: none above a popover.
      expect(
        await appBar(page)
          .locator('[data-workbench="app-bar-actions"] > ps-menu')
          .evaluate((menu) => getComputedStyle(menu).display),
      ).toBe('contents');
      // View bar: fixed at its last stage on a phone.
      await expect(viewBar(page)).toHaveAttribute('data-stage', '3');
      // View bar: Projection, its details, Color by and More.
      await expect(projectionTrigger(page)).toBeVisible();
      await expect(
        viewBar(page).getByRole('button', { name: 'View projection metadata' }),
      ).toBeVisible();
      await expect(colorByTrigger(page)).toBeVisible();
      await expect(moreButton(page)).toBeVisible();

      expect(await touchTargetsBelow(page, appBar(page))).toEqual([]);
      expect(await touchTargetsBelow(page, viewBar(page))).toEqual([]);
      const narrow = viewport.width < 400;
      expect(await truncatedLabels(appBar(page), narrow)).toEqual([]);
      expect(await truncatedLabels(viewBar(page), narrow)).toEqual([]);
      // The pickers may shrink, never vanish: each keeps at least 48 px of its value.
      const values = viewBar(page).locator(
        ':is(#myProjectionSelect, #myAnnotationSelect) :is([part~="value"], .dropdown-trigger-text)',
      );
      for (const value of await values.all()) {
        if (!(await value.isVisible())) continue;
        expect((await box(value)).width).toBeGreaterThanOrEqual(48);
      }
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe('the bars on a phone', () => {
  test('C3: the More sheet opens on screen and runs an action', async ({ page }) => {
    test.fixme(true, 'task 5.5');
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    await expectWithinViewport(page, moreSheet(page));

    await expect(rows.getByRole('radiogroup', { name: 'Contours' })).toBeVisible();
    for (const name of [/^Filter/, /^Import data/, /^Export/, /^Help & shortcuts/]) {
      await expect(rows.getByRole('button', { name })).toBeVisible();
    }
    await expect(rows.getByRole('link', { name: /^Feedback/ })).toBeVisible();
    // Theme arrives with the theme switch (Task 6.1); GitHub is not offered on a phone.
    await expect(rows.getByText(/Theme/)).toHaveCount(0);
    await expect(rows.getByRole('link', { name: /GitHub/ })).toHaveCount(0);

    // Contours applies in place: the sheet stays open.
    await rows.getByRole('radio', { name: 'Auto', exact: true }).tap();
    await expect.poll(() => getContoursMode(page)).toBe('auto');
    await expect(moreSheet(page)).toBeVisible();

    await moreSheet(page).getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(moreSheet(page)).toBeHidden();
    await expect(moreButton(page)).toHaveAccessibleName(/, 1 active$/);
    await expect(viewBar(page).locator('.wb-more-dot')).toBeVisible();
  });

  test('C4: Export in the sheet opens the Export menu, which an outside tap closes', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.5');
    await openExplorePhone(page);
    let rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Export/ }).tap();

    // The sheet closes first, then the menu opens anchored to More.
    await expect(moreSheet(page)).toBeHidden();
    await expect(exportMenuList(page)).toBeVisible();
    await expectWithinViewport(page, exportMenuList(page));

    await tap(page, await emptyPlotSpot(page));
    await expect(exportMenuList(page)).toBeHidden();

    // Escape closes it too, and hands focus back to More.
    rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Export/ }).tap();
    await expect(exportMenuList(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exportMenuList(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();

    // The Export menu borrowed More as its anchor and gave back More's own popup attributes
    // (Task 5.5; they sit on the ps-button host, not on the inner button moreButton finds).
    const moreHost = viewBar(page).locator('.wb-more');
    await expect(moreHost).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(moreHost).toHaveAttribute('aria-expanded', 'false');
  });

  test('C5: the Color by picker and its info bubble stay within the viewport', async ({ page }) => {
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    await colorByTrigger(page).tap();

    const list = annotationSelect(page).locator('.dropdown-menu');
    await expect(list).toBeVisible();
    await expectWithinViewport(page, list);

    await annotationSelect(page)
      .getByRole('button', { name: /^Information about / })
      .first()
      .tap();
    const bubble = page.getByRole('dialog', { name: / information$/ });
    await expect(bubble).toBeVisible();
    await expectWithinViewport(page, bubble);
  });

  test('C6: the Filter tab shows the builder with its actions on screen', async ({ page }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    await panelTab(page, 'Filter').tap();

    await expect(workbench(page)).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    const panel = await box(filterPanel(page));
    const bottom = await box(bottomPanel(page));
    expect(panel.y).toBeGreaterThanOrEqual(bottom.y - 1);

    for (const control of [
      queryBuilder(page)
        .getByRole('group', { name: /^Condition/ })
        .first(),
      filterApplyButton(page),
      queryBuilder(page).getByRole('button', { name: 'Cancel', exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expectWithinViewport(page, control);
    }
  });

  test('C7: a selected filter value has a finger-sized remove button', async ({ page }) => {
    test.fixme(true, 'task 5.12');
    await openExplorePhone(page);
    const { annotation } = await getViewState(page);
    await panelTab(page, 'Filter').tap();

    const row = queryBuilder(page).locator('protspace-query-condition-row').first();
    await row.locator('.annotation-select-trigger').tap();
    await queryBuilder(page)
      .locator(`.annotation-picker-item[data-annotation=${JSON.stringify(annotation ?? '')}]`)
      .first()
      .tap();
    await row.locator('.value-chip-add').tap();
    await queryBuilder(page).locator('.value-picker-item').first().tap();
    // Escape closes the value picker (a layer).
    await page.keyboard.press('Escape');

    const remove = row.locator('.value-chip-remove').first();
    await expect(remove).toBeVisible();
    const target = await box(remove);
    expect(target.width).toBeGreaterThanOrEqual(40);
    expect(target.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('the bars on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('C8: the landscape bar keeps touch-sized targets', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await expect(moreButton(page)).toBeVisible();
    expect(await touchTargetsBelow(page, appBar(page))).toEqual([]);
    expect(await touchTargetsBelow(page, viewBar(page))).toEqual([]);
  });

  test('C9: the More sheet fits the short screen and scrolls inside', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    const heading = moreSheet(page).getByRole('heading', { name: 'More', exact: true });
    await expectWithinViewport(page, moreSheet(page));
    await expectWithinViewport(page, heading);

    // The last row is reachable by scrolling the sheet, with its header still in view.
    const last = rows.getByRole('link', { name: /^Feedback/ });
    await last.scrollIntoViewIfNeeded();
    await expectWithinViewport(page, last);
    await expectWithinViewport(page, heading);
  });
});

test.describe('the bars on a portrait tablet', () => {
  test.use({ viewport: { width: 800, height: 1280 } });

  test('C10: a portrait tablet (800×1280) keeps the desktop bars', async ({ page }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await expect(searchInput(page)).toBeVisible();
    await expect(importTrigger(page)).toBeVisible();
    await expect(exportTrigger(page)).toBeVisible();
    await expect(searchToggle(page)).toBeHidden();
    // More shows from the view bar's second stage; where it shows, it opens its menu.
    if (await moreButton(page).isVisible()) {
      await moreButton(page).tap();
      await expect(page.getByRole('menu', { name: 'More view options' })).toBeVisible();
    }
    await expect(moreSheet(page)).toHaveCount(0);
  });
});

test.describe('the product tour on a phone', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { label, viewport } of [
    { label: 'C11', viewport: { width: 390, height: 664 } },
    { label: 'C12', viewport: { width: 740, height: 360 } },
  ]) {
    test(`${label}: every tour popover stays on screen at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.fixme(true, 'task 7.4');
      await page.setViewportSize(viewport);
      await stubStructureRequests(page);
      await page.goto('/explore');
      await waitForExploreDataLoad(page);

      // driver.js draws the popover; its parts have no roles, so its own classes find them.
      const popover = page.locator('.driver-popover');
      const titles: string[] = [];
      const descriptions: string[] = [];
      for (let step = 0; step < 15; step++) {
        await expect(popover).toBeVisible({ timeout: 10_000 });
        // driver.js animates the popover into place.
        await expect(async () => {
          await expectWithinViewport(page, popover);
        }).toPass();
        titles.push(((await popover.locator('.driver-popover-title').textContent()) ?? '').trim());
        descriptions.push(
          ((await popover.locator('.driver-popover-description').textContent()) ?? '').trim(),
        );
        const close = await box(popover.locator('.driver-popover-close-btn'));
        expect(close.width).toBeGreaterThanOrEqual(40);
        expect(close.height).toBeGreaterThanOrEqual(40);

        // A step that points at a control points at one that shows.
        const highlighted = page.locator('.driver-active-element:not(#driver-dummy-element)');
        if ((await highlighted.count()) > 0) {
          const target = await box(highlighted.first());
          expect(
            target.width,
            `step "${titles.at(-1)}" highlights a shown control`,
          ).toBeGreaterThan(0);
          expect(target.height).toBeGreaterThan(0);
        }

        const next = popover.locator('.driver-popover-next-btn');
        if (/finish|done/i.test(((await next.textContent()) ?? '').trim())) break;
        await next.tap();
      }

      expect(titles.at(-1)).toBe("You're All Set!");
      // Touch wording only: the legend takes taps, double taps and a held handle.
      const legendSteps = descriptions.filter((_, i) =>
        ['Legend Panel', 'Expand Hidden Categories'].includes(titles[i]),
      );
      expect(legendSteps).toHaveLength(2);
      for (const description of legendSteps) expect(description).not.toMatch(/click/i);
      expect(legendSteps[0]).toContain('double-tap');
    });
  }
});

test.describe('search on a phone', () => {
  test('the search button opens search over the app bar; a pasted ID selects its protein; Close search returns focus to the button', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(searchInput(page)).toBeHidden();

    await searchToggle(page).tap();
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput(page)).toBeFocused();
    await expectWithinViewport(page, searchInput(page));
    const overlay = await box(appBar(page).locator('[data-workbench="app-bar-center"]'));
    const bar = await box(appBar(page));
    expect(Math.abs(overlay.y - bar.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.width - bar.width)).toBeLessThanOrEqual(1);

    // A paste with a line break is a pasted list: the search selects every ID it finds.
    const { id } = await proteinNear(page, 0.5, 0.5);
    await searchInput(page).evaluate((input, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      input.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }, `${id}\n`);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await expect(searchInput(page)).toBeHidden();
    await expect(searchToggle(page)).toBeFocused();
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape closes the search overlay when nothing else handled it', async ({ page }) => {
    await openExplorePhone(page);
    const { id } = await proteinNear(page, 0.5, 0.5);
    // Select one protein through the search first: the Escape that closes search must not clear it.
    await searchToggle(page).tap();
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    // The suggestion list is a layer: an Escape while it shows closes it and leaves search open.
    const suggestions = page.locator('protspace-protein-search').getByRole('listbox');
    if (await suggestions.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(suggestions).toBeHidden();
      await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    }
    await page.keyboard.press('Escape');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await expect(searchToggle(page)).toBeFocused();
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });

  test('focus leaving the search overlay by keyboard closes it and shows the target', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await searchToggle(page).tap();
    await expect(searchInput(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await expect(datasetSwitcher(page)).toBeFocused();
    await expect(datasetSwitcher(page)).toBeInViewport();

    await searchToggle(page).tap();
    await expect(searchInput(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      appBar(page).getByRole('button', { name: 'Close search', exact: true }),
    ).toBeFocused();
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await page.keyboard.press('Tab');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
  });

  test('search stays open when the window loses focus', async ({ page }) => {
    await openExplorePhone(page);
    await searchToggle(page).tap();
    await expect(searchInput(page)).toBeFocused();
    // Switching apps: the field loses focus with no next target while the document has none.
    await searchInput(page).evaluate((input) => {
      const hasFocus = document.hasFocus;
      document.hasFocus = () => false;
      (input as HTMLElement).blur();
      document.hasFocus = hasFocus;
    });
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
  });

  test('at 320 px the dataset name keeps more than 40 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openExplorePhone(page);
    const name = appBar(page).locator('.wb-dataset-name');
    await expect(name).toBeVisible();
    expect((await box(name)).width).toBeGreaterThan(40);
    await expect(searchToggle(page)).toBeVisible();
    await expectWithinViewport(page, searchToggle(page));
    await expectNoHorizontalOverflow(page);
  });
});
