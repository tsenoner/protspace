import { expect, test } from '@playwright/test';
import {
  appBar,
  expectUrlParam,
  getColorByOptions,
  getViewState,
  openExplore,
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
