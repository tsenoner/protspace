import { expect, test } from '@playwright/test';
import { waitForExploreDataLoad, waitForExploreInteractionReady } from './helpers/explore';

test.describe('scatterplot zoom indicator (#343)', () => {
  test('shows after wheel zoom and disappears after double-click reset', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    const plot = page.locator('#myPlot');
    const bounds = await plot.boundingBox();
    expect(bounds).not.toBeNull();

    const center = {
      x: bounds!.x + bounds!.width / 2,
      y: bounds!.y + bounds!.height / 2,
    };
    const pointCountChip = plot.getByRole('status');
    await expect(pointCountChip).toHaveAttribute('aria-live', 'polite');
    await expect(pointCountChip).toHaveText(/^\s*\d+ points\s*$/);

    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -500);
    await expect
      .poll(() => plot.evaluate((element: any) => element._transform.k))
      .toBeGreaterThan(1);
    await expect(pointCountChip).toHaveText(/^\s*\d+ points · Zoomed in\s*$/);

    await page.mouse.dblclick(center.x, center.y);
    await expect.poll(() => plot.evaluate((element: any) => element._transform.k)).toBe(1);
    await expect(pointCountChip).toHaveText(/^\s*\d+ points\s*$/);
  });
});
