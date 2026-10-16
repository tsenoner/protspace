import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  annotationSelect,
  appBar,
  appBarTextFits,
  colorByTrigger,
  datasetSwitcher,
  dismissTourIfPresent,
  exportMenu,
  filterApplyButton,
  filterPanel,
  getContoursMode,
  getSelectedProteinIds,
  getViewState,
  importMenu,
  importTrigger,
  projectionTrigger,
  queryBuilder,
  searchInput,
  viewBar,
  waitForExploreDataLoad,
} from './helpers/explore';
import {
  applyFilterKeepingTen,
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
  themeSegment,
  touchTargetsBelow,
} from './helpers/mobile';
import { clearOpfs, seedOpfsState } from './helpers/opfs';
import { stubStructureRequests } from './helpers/workbench';
import { DARK_SURFACE, htmlTheme, themeButton } from './helpers/theme';
import { seedLegacyTourSeen } from './helpers/tour-storage-state';

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
      await expect(themeButton(page)).toBeHidden();
      // The Theme and Help menus' popover hosts stay rendered: no display: none above a popover.
      expect(
        await appBar(page)
          .locator('[data-workbench="app-bar-actions"] > ps-menu')
          .evaluateAll((menus) => menus.map((menu) => getComputedStyle(menu).display)),
      ).toEqual(['contents', 'contents']);
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
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    await expectWithinViewport(page, moreSheet(page));

    await expect(rows.getByRole('radiogroup', { name: 'Contours' })).toBeVisible();
    for (const name of [/^Filter/, /^Import data/, /^Export/, /^Help & shortcuts/]) {
      await expect(rows.getByRole('button', { name })).toBeVisible();
    }
    await expect(rows.getByRole('link', { name: /^Feedback/ })).toBeVisible();
    await expect(rows.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    // GitHub is not offered on a phone.
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
    await openExplorePhone(page);
    await expect(moreButton(page)).toBeVisible();
    expect(await touchTargetsBelow(page, appBar(page))).toEqual([]);
    expect(await touchTargetsBelow(page, viewBar(page))).toEqual([]);
  });

  test('C9: the More sheet fits the short screen and scrolls inside', async ({ page }) => {
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

  test('the landscape bar is one 44 px row with search before Projection in Tab order', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');

    const app = await box(appBar(page));
    const view = await box(viewBar(page));
    for (const bar of [app, view]) {
      expect(Math.abs(bar.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(bar.height - 44)).toBeLessThanOrEqual(1);
    }
    // Side by side: the app bar ends where the view bar starts, and the row fits the screen.
    expect(app.x + app.width).toBeLessThanOrEqual(view.x + 1);
    expect(view.x + view.width).toBeLessThanOrEqual(740 + 1);
    await expectNoHorizontalOverflow(page);

    // DOM order is visual order: the search button, then the view bar's first control.
    await expect(searchToggle(page)).toBeVisible();
    await searchToggle(page).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('myProjectionSelect');

    // The search overlay covers the whole row; Close search ends it and returns focus.
    await searchToggle(page).tap();
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchInput(page)).toBeFocused();
    const overlay = await box(appBar(page).locator('[data-workbench="app-bar-center"]'));
    expect(Math.abs(overlay.width - 740)).toBeLessThanOrEqual(1);
    await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(searchToggle(page)).toBeFocused();
  });

  test('C9b: in landscape, Export in the More sheet and the dataset name open their menus on screen', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');

    // A popover inside a display: none ancestor never renders: these would open as 0×0 boxes.
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Export/ }).tap();
    await expect(moreSheet(page)).toBeHidden();
    await expect(exportMenuList(page)).toBeVisible();
    await expectWithinViewport(page, exportMenuList(page));
    await page.keyboard.press('Escape');
    await expect(exportMenuList(page)).toBeHidden();

    await datasetSwitcher(page).tap();
    const importPanel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(importPanel).toBeVisible();
    await expectWithinViewport(page, importPanel);
  });

  test("landscape's More sheet has the Theme row", async ({ page }) => {
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    const theme = rows.getByRole('radiogroup', { name: 'Theme' });
    await theme.scrollIntoViewIfNeeded();
    await expectWithinViewport(page, theme);

    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await expect(moreSheet(page)).toBeVisible();
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
    // At 800 px the view bar has room for every control: Filter shows and More does not.
    await expect(moreButton(page)).toBeHidden();
    await expect(viewBar(page).getByRole('button', { name: /^Filter/ })).toBeVisible();
    await expect(moreSheet(page)).toHaveCount(0);
  });

  test('the portrait tablet bar shows the Theme button and keeps the dataset name and search unclipped', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await expect(themeButton(page)).toBeVisible();

    // Decision 1's order: Export, then Theme, then Help.
    const exported = await box(exportTrigger(page));
    const theme = await box(themeButton(page));
    const help = await box(appBar(page).getByRole('button', { name: 'Help', exact: true }));
    expect(exported.x + exported.width).toBeLessThanOrEqual(theme.x);
    expect(theme.x + theme.width).toBeLessThanOrEqual(help.x);

    // As mobile-explore-layout.spec.ts measures at 800×1000: the one more button leaves both whole.
    expect(await appBarTextFits(page)).toEqual({ name: true, placeholder: true });
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
        for (const button of await popover.locator('.driver-popover-footer button:visible').all()) {
          expect((await box(button)).height).toBeGreaterThanOrEqual(40);
        }

        if (step === 0) {
          // The welcome step lifts More, where the tour lives on a phone, above the overlay.
          const more = page.locator('[data-driver-id="more"]');
          await expect(more).toHaveCSS('z-index', '100001');
          const centre = await box(more);
          // driver.js turns off pointer events on the page, and hit testing skips such elements,
          // so More takes them back for the probe.
          expect(
            await page.evaluate(
              ({ x, y }) => {
                const host = document.querySelector<HTMLElement>('[data-driver-id="more"]')!;
                host.style.setProperty('pointer-events', 'auto', 'important');
                const top = document.elementFromPoint(x, y);
                host.style.removeProperty('pointer-events');
                return top?.closest('[data-driver-id="more"]') !== null;
              },
              { x: centre.x + centre.width / 2, y: centre.y + centre.height / 2 },
            ),
            'More shows above the overlay',
          ).toBe(true);
        }

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
        // driver.js animates the change: read the next step only once its title shows.
        await expect(popover.locator('.driver-popover-title')).not.toHaveText(titles.at(-1)!);
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

  test("a returning visitor gets What's new on a phone", async ({ page }) => {
    await seedLegacyTourSeen(page);
    await stubStructureRequests(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    const popover = page.locator('.driver-popover');
    const title = popover.locator('.driver-popover-title');
    const more = viewBar(page).locator('[data-driver-id="more"]');
    const titles: string[] = [];
    for (let step = 0; step < 10; step++) {
      await expect(popover).toBeVisible({ timeout: 10_000 });
      await expect(async () => {
        await expectWithinViewport(page, popover);
      }).toPass();
      const current = ((await title.textContent()) ?? '').trim();
      titles.push(current);
      if (step === 0) {
        // The hardest fit: Skip, Full tour and Start Tour in a 300 px popover.
        for (const cls of [
          '.driver-popover-close-btn',
          '.driver-tour-skip-btn',
          '.driver-tour-full-btn',
          '.driver-popover-next-btn',
        ]) {
          const button = await box(popover.locator(cls));
          expect(button.width, cls).toBeGreaterThanOrEqual(40);
          expect(button.height, cls).toBeGreaterThanOrEqual(40);
        }
      }
      if (current === 'More Options') {
        await expect(more).toHaveClass(/(^|\s)driver-active-element(\s|$)/);
      }

      const next = popover.locator('.driver-popover-next-btn');
      if (/finish/i.test(((await next.textContent()) ?? '').trim())) {
        await next.tap();
        break;
      }
      await next.tap();
      await expect(title).not.toHaveText(current);
    }

    expect(titles).toEqual([
      "What's new in ProtSpace",
      'The View Bar',
      'More Options',
      'Legend Panel',
      'Selection Tools',
      "That's it",
    ]);
    await expect(popover).toHaveCount(0);
    // driver.js overwrote More's own popup state while it was lit; the tour put it back.
    await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test.describe('in Dark', () => {
    test.use({ colorScheme: 'dark' });

    test('the tour popover is dark in Dark', async ({ page }) => {
      await stubStructureRequests(page);
      await page.goto('/explore');
      await waitForExploreDataLoad(page);
      const popover = page.locator('.driver-popover');
      await expect(popover).toBeVisible({ timeout: 10_000 });
      // Nothing stored: the theme is System, and the OS is dark.
      expect(await htmlTheme(page)).toBe('system');

      // The token as the page resolves it, painted on a probe.
      const raised = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--ps-surface-raised)';
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      });
      expect(raised).not.toBe('rgb(255, 255, 255)');
      await expect(popover).toHaveCSS('background-color', raised);
    });
  });
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
    await searchInput(page).fill(id.slice(0, 4));
    await expect(suggestions).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(suggestions).toBeHidden();
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
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

  test('Ctrl+K opens search over the app bar with focus in the field', async ({ page }) => {
    await openExplorePhone(page);
    await expect(searchInput(page)).toBeHidden();

    // A hardware keyboard on a phone: the shortcut opens search as the search button does.
    await page.keyboard.press('Control+k');
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput(page)).toBeFocused();

    // On its side too. Close search first: focus showed the suggestion list, a layer that takes
    // the first Escape; the second closes search.
    await page.keyboard.press('Escape');
    await expect(page.locator('protspace-protein-search').getByRole('listbox')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await page.setViewportSize({ width: 740, height: 360 });
    await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');
    await expect(searchInput(page)).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchInput(page)).toBeFocused();
  });

  test('Ctrl+K under a modal dialog leaves search closed', async ({ page }) => {
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: 'Help & shortcuts', exact: true }).tap();
    await rows.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).tap();
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcuts).toBeVisible();

    // The dialog leaves the bar inert: the field can take no focus, so search must not open
    // behind the dialog, where nothing could close it.
    await page.keyboard.press('Control+k');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
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

test.describe('the More sheet', () => {
  test.beforeEach(async ({ page }) => {
    await openExplorePhone(page);
  });

  test('Import data opens the Import panel under the dataset name', async ({ page }) => {
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: 'Import data', exact: true }).tap();

    await expect(moreSheet(page)).toBeHidden();
    const panel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(panel).toBeVisible();
    await expectWithinViewport(page, panel);
    const dataset = await box(datasetSwitcher(page));
    expect((await box(panel)).y).toBeGreaterThanOrEqual(dataset.y + dataset.height - 1);
    await expect(datasetSwitcher(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test("Filter in the sheet shows the Filter tab's panel and focuses its heading", async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Filter/ }).tap();

    await expect(moreSheet(page)).toBeHidden();
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
  });

  test('Help & shortcuts reveals three rows; Keyboard shortcuts opens the shortcuts dialog', async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    const help = rows.getByRole('button', { name: 'Help & shortcuts', exact: true });
    const shortcutsRow = rows.getByRole('button', {
      name: 'Keyboard shortcuts',
      exact: true,
    });
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(shortcutsRow).toBeHidden();

    await help.tap();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Documentation', 'Keyboard shortcuts', 'Take the tour']) {
      await expect(rows.getByRole('button', { name, exact: true })).toBeVisible();
    }

    await shortcutsRow.tap();
    await expect(moreSheet(page)).toBeHidden();
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcuts).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
  });

  test('Feedback closes the sheet as it opens the mail client', async ({ page }) => {
    const rows = await openMoreSheet(page);
    // Keep the mailto: navigation from leaving the page; the app's own click handler still runs.
    await page.evaluate(() =>
      window.addEventListener(
        'click',
        (e) => {
          if ((e.target as Element).closest('a[href^="mailto:"]')) e.preventDefault();
        },
        { capture: true },
      ),
    );
    await rows.getByRole('link', { name: /^Feedback/ }).tap();
    await expect(moreSheet(page)).toBeHidden();
  });

  test('the More dot shows with a filter applied', async ({ page }) => {
    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeHidden();

    await applyFilterKeepingTen(page);
    await expect(moreButton(page)).toHaveAccessibleName('More view options, 1 active');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeVisible();

    const rows = await openMoreSheet(page);
    await expect(rows.getByRole('button', { name: /^Filter/ })).toContainText('1 condition');
  });

  test("the More sheet's Theme row switches the theme and the sheet stays open", async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    // Between Export and Help & shortcuts, as mockup frame 4 has it.
    const exported = await box(rows.getByRole('button', { name: /^Export/ }));
    const theme = await box(rows.getByRole('radiogroup', { name: 'Theme' }));
    const help = await box(rows.getByRole('button', { name: 'Help & shortcuts', exact: true }));
    expect(exported.y).toBeLessThan(theme.y);
    expect(theme.y).toBeLessThan(help.y);

    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await expect(themeSegment(page, 'Dark')).toHaveAttribute('aria-checked', 'true');
    await expect(moreSheet(page)).toBeVisible();
    await expect
      .poll(() => workbench(page).evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(DARK_SURFACE);
  });

  test('the theme never lights the More dot', async ({ page }) => {
    await openMoreSheet(page);
    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await moreSheet(page).getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(moreSheet(page)).toBeHidden();

    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeHidden();
  });

  test('Escape closes the sheet, then a second Escape clears the selection', async ({ page }) => {
    // Selected through search, so no pinned tooltip takes the second Escape.
    const { id } = await proteinNear(page, 0.5, 0.5);
    await searchToggle(page).tap();
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);
    await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');

    await openMoreSheet(page);
    await page.keyboard.press('Escape');
    await expect(moreSheet(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    await page.keyboard.press('Escape');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
  });
});

test.describe('dialogs on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the confirm dialog and the Import panel fit a 360 px screen', async ({ page }) => {
    await openExplorePhone(page);

    // The dataset name opens the Import panel.
    await datasetSwitcher(page).tap();
    const importPanel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(importPanel).toBeVisible();
    await expectWithinViewport(page, importPanel);
    await page.keyboard.press('Escape');
    await expect(importPanel).toBeHidden();

    // Clearing a stored dataset asks first in a small ps-dialog; a failed load offers it.
    await clearOpfs(page);
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'pending',
      failedAttempts: 1,
    });
    await page.reload();
    await dismissTourIfPresent(page);
    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await banner.getByRole('button', { name: 'Clear stored data' }).tap();

    const confirm = page.getByRole('dialog', { name: 'Clear stored data?' });
    await expect(confirm).toBeVisible();
    await expectWithinViewport(page, confirm);
    // The buttons are the dialog's slotted content, found through the ps-dialog host.
    const host = page.locator('ps-dialog', { has: confirm });
    for (const name of ['Cancel', 'Clear data']) {
      await expectWithinViewport(page, host.getByRole('button', { name, exact: true }));
    }
    await host.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(confirm).toBeHidden();
  });
});
