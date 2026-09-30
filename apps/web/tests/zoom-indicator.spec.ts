import { expect, test } from '@playwright/test';
import { waitForExploreDataLoad, waitForExploreInteractionReady } from './helpers/explore';

type HitTestablePlot = HTMLElement & {
  pickInteractivePointAt(mouseX: number, mouseY: number): unknown;
};

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
    // The EAT connector chip is also a status; pin the point-count one.
    const pointCountChip = plot.getByRole('status').filter({ hasText: 'points' });
    await expect(pointCountChip).toHaveAttribute('aria-live', 'polite');
    await expect(pointCountChip).toHaveText(/^\s*\d+ points\s*$/);

    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -500);
    await expect(pointCountChip).toHaveText(/^\s*\d+ points · Zoomed in\s*$/);

    // Reset on background, as documented: clicks that land on a protein also select it,
    // and Explore then opens the structure viewer and fetches the model from AlphaFold.
    const background = await plot.evaluate((element: HitTestablePlot) => {
      // Hit testing is in interaction-SVG coordinates, which sit inside the host's border.
      const rect = element.shadowRoot!.querySelector('svg')!.getBoundingClientRect();
      for (let y = rect.height * 0.2; y < rect.height * 0.8; y += 12) {
        for (let x = rect.width * 0.2; x < rect.width * 0.8; x += 12) {
          if (!element.pickInteractivePointAt(x, y)) return { x: rect.left + x, y: rect.top + y };
        }
      }
      return null;
    });
    expect(background).not.toBeNull();

    await page.mouse.dblclick(background!.x, background!.y);
    await expect(pointCountChip).toHaveText(/^\s*\d+ points\s*$/);
  });
});
