import { expect, test, type Page } from '@playwright/test';
import {
  appBar,
  closeFilterPanel,
  expectUrlParam,
  filterButton,
  getColorByOptions,
  getContoursMode,
  getViewState,
  openExplore,
  openFilter,
  projectionTrigger,
  selectAnnotation,
  selectProjection,
  setContours,
  viewBar,
} from './helpers/explore';

test.describe('the view bar', () => {
  test('Projection, Color by and Contours sit in the view bar', async ({ page }) => {
    await openExplore(page);

    await expect(projectionTrigger(page)).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Color by/ })).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Contours/ })).toBeVisible();
    // Projection, its details and Color by form the tour's projections group.
    const group = page.locator('[data-workbench="view-bar"] [data-driver-id="projections"]');
    await expect(group.locator('protspace-projection-select')).toHaveCount(1);
    await expect(group.locator('protspace-projection-metadata')).toHaveCount(1);
    await expect(group.locator('protspace-annotation-select')).toHaveCount(1);
    // The plot's top-left corner no longer holds the projection details.
    await expect(page.locator('#myPlot protspace-projection-metadata')).toHaveCount(0);
  });

  test('picking a projection, an annotation and a contour mode updates the plot, the legend and the URL', async ({
    page,
  }) => {
    await openExplore(page);
    const projections = await page
      .locator('#myPlot')
      .evaluate(
        (plot) =>
          (
            plot as Element & { data?: { projections?: { name: string }[] } }
          ).data?.projections?.map((projection) => projection.name) ?? [],
      );
    expect(projections.length).toBeGreaterThan(1);

    await selectProjection(page, 1);
    await expect.poll(async () => (await getViewState(page)).projection).toBe(projections[1]);
    await expect(projectionTrigger(page)).toHaveAccessibleName(`Projection ${projections[1]}`);
    await expectUrlParam(page, 'projection', projections[1]);

    const current = (await getViewState(page)).annotation;
    const next = (await getColorByOptions(page)).find((name) => name !== current);
    expect(next).toBeDefined();
    await selectAnnotation(page, next!);
    await expect.poll(async () => (await getViewState(page)).annotation).toBe(next);
    await expect
      .poll(() =>
        page
          .locator('protspace-legend')
          .evaluate(
            (legend) => (legend as Element & { selectedAnnotation?: string }).selectedAnnotation,
          ),
      )
      .toBe(next);
    await expectUrlParam(page, 'annotation', next!);

    await setContours(page, 'auto');
    await expect(viewBar(page).getByRole('button', { name: /^Contours/ })).toHaveAccessibleName(
      'Contours Auto',
    );
    await expectUrlParam(page, 'density', 'auto');
  });

  test('the projection details open below the view bar, fully visible and topmost', async ({
    page,
  }) => {
    await openExplore(page);
    // Give the details something to show whatever the fixture's projection metadata holds.
    await page.locator('#myProjectionMetadata').evaluate((details: Element) => {
      (details as Element & { projection: unknown }).projection = {
        name: 'Fixture projection',
        metadata: { n_neighbors: 15, min_dist: 0.1, metric: 'cosine' },
      };
    });

    await viewBar(page).getByRole('button', { name: 'View projection metadata' }).click();
    const card = page.locator('#myProjectionMetadata .content');
    await expect(card).toBeVisible();

    const trigger = (await viewBar(page)
      .getByRole('button', { name: 'View projection metadata' })
      .boundingBox())!;
    const box = (await card.boundingBox())!;
    const viewport = page.viewportSize()!;
    // The card hangs below its trigger in the view bar, over the plot area. (The bar itself is
    // taller than 44 px until Task 2.10 removes the control bar's padding.)
    expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // Nothing covers the card: the topmost element at its centre is the details' own host.
    const topmost = await page.evaluate(
      ({ x, y }) => {
        const host = document.getElementById('myProjectionMetadata');
        const hit = document.elementFromPoint(x, y);
        return !!host && !!hit && (hit === host || host.contains(hit));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(topmost).toBe(true);
  });

  test("the tour's projections step highlights the view bar group", async ({ page }) => {
    await openExplore(page);
    await appBar(page).getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    const title = page.locator('.driver-popover .driver-popover-title');
    await expect(title).toHaveText('Welcome to ProtSpace');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import Your Data');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Projections & Annotations');

    await expect(
      page.locator('[data-workbench="view-bar"] [data-driver-id="projections"]'),
    ).toHaveClass(/driver-active-element/);
  });
});

/** Lets the view bar's ResizeObserver and the frame it schedules run after a resize. */
async function settle(page: Page): Promise<void> {
  // The window takes the new width first; then the observer, the hook's frame and its write.
  const width = page.viewportSize()!.width;
  await page.waitForFunction((w) => window.innerWidth === w, width);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

async function readStage(page: Page): Promise<number> {
  return Number(await viewBar(page).getAttribute('data-stage'));
}

/**
 * The stage after the window narrows from 1280 px to `width` px. Narrowing from a wide window
 * gives the first stage that fits, whatever the stage was before, so it only grows as `width`
 * shrinks.
 */
async function stageWhenNarrowedTo(page: Page, width: number): Promise<number> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle(page);
  await page.setViewportSize({ width, height: 720 });
  await settle(page);
  return readStage(page);
}

/** The widest window, to the pixel, at which narrowing reaches `stage` or a later one. */
async function widestAtStage(page: Page, stage: number): Promise<number> {
  let below = 1280; // narrowing to this width stays under `stage`
  let reached = 320; // narrowing to this width reaches it
  expect(await stageWhenNarrowedTo(page, below)).toBeLessThan(stage);
  expect(await stageWhenNarrowedTo(page, reached)).toBeGreaterThanOrEqual(stage);
  while (below - reached > 1) {
    const middle = Math.floor((below + reached) / 2);
    if ((await stageWhenNarrowedTo(page, middle)) >= stage) reached = middle;
    else below = middle;
  }
  return reached;
}

const moreButton = (page: Page) =>
  viewBar(page).getByRole('button', { name: /^More view options/ });
const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More view options' });
/** The More menu's host: its items are its light-DOM children. */
const moreItems = (page: Page) => page.locator('#wb-more-menu');

test.describe('view bar stages', () => {
  test('the view bar is 44 px, one row and does not overflow at 1440, 1280, 1024 and 951 px', async ({
    page,
  }) => {
    await openExplore(page);
    for (const width of [1440, 1280, 1024, 951]) {
      await page.setViewportSize({ width, height: 720 });
      await settle(page);
      const bar = await viewBar(page).evaluate((element) => {
        const box = element.getBoundingClientRect();
        const items = Array.from(element.children)
          .filter((child) => child.getClientRects().length > 0)
          .map((child) => child.getBoundingClientRect());
        const centres = items.map((item) => item.top + item.height / 2);
        return {
          height: box.height,
          right: box.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          itemsRight: Math.max(...items.map((item) => item.right)),
          centreSpread: Math.max(...centres) - Math.min(...centres),
        };
      });
      expect(bar.height, `${width} px`).toBe(44);
      expect(bar.centreSpread, `${width} px: one row`).toBeLessThanOrEqual(1);
      expect(bar.scrollWidth, `${width} px`).toBeLessThanOrEqual(bar.clientWidth);
      expect(bar.itemsRight, `${width} px`).toBeLessThanOrEqual(bar.right);
      // Projection and Color by never leave the bar.
      await expect(projectionTrigger(page)).toBeVisible();
      await expect(viewBar(page).getByRole('button', { name: /^Color by/ })).toBeVisible();
      // The plot starts under the 48 px app bar and the 44 px view bar at every stage.
      expect((await page.locator('#myPlot').boundingBox())!.y, `${width} px`).toBe(92);
    }
  });

  test('narrowing moves Contours, then Filter, into More, and widening brings them back', async ({
    page,
  }) => {
    await openExplore(page);
    // "Always" is the widest contour value, so moving Contours into More frees the most room.
    await setContours(page, 'on');
    const contours = viewBar(page).getByRole('button', { name: /^Contours/ });

    const contoursOut = await widestAtStage(page, 2);
    expect(await stageWhenNarrowedTo(page, contoursOut)).toBe(2);
    await expect(contours).toBeHidden();
    await expect(filterButton(page)).toBeVisible();
    await moreButton(page).click();
    await expect(moreMenu(page)).toBeVisible();
    await expect(moreItems(page).getByRole('group', { name: 'Contours' })).toBeVisible();
    await expect(moreItems(page).getByRole('menuitemradio')).toHaveText(['Off', 'Auto', 'Always']);
    await expect(
      moreItems(page).getByRole('menuitemradio', { name: 'Always', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      moreItems(page).getByRole('menuitem', { name: 'Filter', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).toBeHidden();

    const filterOut = await widestAtStage(page, 3);
    expect(filterOut).toBeLessThan(contoursOut);
    expect(await stageWhenNarrowedTo(page, filterOut)).toBe(3);
    await expect(filterButton(page)).toBeHidden();
    // Filter sits in its own group, not under the contour modes.
    await moreButton(page).click();
    await expect(
      moreItems(page)
        .getByRole('group', { name: 'Filter' })
        .getByRole('menuitem', { name: 'Filter', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).toBeHidden();
    // Filter in More opens the same panel, with focus on its heading. Close hands focus to the
    // rail's Filter item on desktop; below 951 px, where there is no rail, to More, since the
    // Filter button is hidden at this stage.
    await openFilter(page);
    await expect(page.locator('#wb-filter-title')).toBeFocused();
    await closeFilterPanel(page);
    const returnTarget =
      page.viewportSize()!.width >= 951
        ? page.getByRole('navigation', { name: 'Panels' }).getByRole('button', {
            name: 'Filter',
            exact: true,
          })
        : moreButton(page);
    await expect(returnTarget).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 720 });
    await settle(page);
    expect(await readStage(page)).toBe(0);
    await expect(contours).toBeVisible();
    await expect(filterButton(page)).toBeVisible();
    await expect(moreButton(page)).toBeHidden();
  });

  test('a window jittering ±4 px around a threshold keeps its stage', async ({ page }) => {
    await openExplore(page);
    const threshold = await widestAtStage(page, 1);
    // A threshold indeed: narrowing to four pixels wider keeps every label.
    expect(await stageWhenNarrowedTo(page, threshold + 4)).toBe(0);

    expect(await stageWhenNarrowedTo(page, threshold)).toBe(1);
    for (const width of [
      threshold + 4,
      threshold - 4,
      threshold + 4,
      threshold - 4,
      threshold + 4,
    ]) {
      await page.setViewportSize({ width, height: 720 });
      await settle(page);
      expect(await readStage(page), `${width} px`).toBe(1);
    }
  });

  test('More shows a dot with contours on, and Auto there sets density=auto in the URL', async ({
    page,
  }) => {
    await openExplore(page);
    expect(await stageWhenNarrowedTo(page, await widestAtStage(page, 2))).toBeGreaterThanOrEqual(2);
    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(page.locator('.wb-more-dot')).toBeHidden();

    // Contours is not in the bar at this width, so the helper picks Auto in More.
    await setContours(page, 'auto');
    await expectUrlParam(page, 'density', 'auto');
    await expect.poll(() => getContoursMode(page)).toBe('auto');
    await expect(moreButton(page)).toHaveAccessibleName('More view options, 1 active');
    await expect(page.locator('.wb-more-dot')).toBeVisible();
  });

  test('More opens with Enter and Escape returns focus to it', async ({ page }) => {
    await openExplore(page);
    expect(await stageWhenNarrowedTo(page, await widestAtStage(page, 2))).toBeGreaterThanOrEqual(2);

    await moreButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(moreMenu(page)).toBeVisible();
    // The menu opens on the checked contour mode.
    await expect(
      moreItems(page).getByRole('menuitemradio', { name: 'Off', exact: true }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
  });
});
