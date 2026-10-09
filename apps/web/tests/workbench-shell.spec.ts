import { expect, test } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET } from '../src/explore/example-datasets';
import { getProteinCount, holdNextRequest, openExplore } from './helpers/explore';

/**
 * The workbench shell (Task 2.2): the app bar, the view bar, the plot beside a flush sidebar, the
 * narrow fallback and first paint. Regions are found by the data-workbench hooks the shell renders.
 */

const RUNTIME_ELEMENTS = ['myPlot', 'myLegend', 'myStructureViewer'];

test.describe('workbench shell', () => {
  test('explore is a workbench without the site navigation', async ({ page }) => {
    await openExplore(page);

    const banner = page.getByRole('banner');
    await expect(banner).toHaveAttribute('data-workbench', 'app-bar');
    expect((await banner.boundingBox())?.height).toBe(48);
    for (const name of ['Home', 'Docs']) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Resources', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('link', { name: 'ProtSpace home' })).toHaveAttribute('href', '/');

    const viewBar = page.getByRole('toolbar', { name: 'View' });
    expect((await viewBar.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const plot = await page.locator('[data-workbench="plot"]').boundingBox();
    const sidebar = await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox();
    expect(Math.abs(plot!.x + plot!.width - sidebar!.x)).toBeLessThan(0.5);
    expect(sidebar!.width).toBe(300);

    for (const id of [...RUNTIME_ELEMENTS, 'myDataLoader']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('the app bar names the dataset and its protein count', async ({ page }) => {
    await openExplore(page);
    const count = await getProteinCount(page);

    const dataset = page.locator('[data-workbench="dataset"]');
    await expect(dataset).toHaveAttribute('data-dataset-name', DEFAULT_EXAMPLE_DATASET.label);
    // An example's label reads "name · proteins · size"; the bar shows the name and its own count.
    await expect(dataset.locator('.wb-dataset-name')).toHaveText(
      DEFAULT_EXAMPLE_DATASET.label.split(' · ')[0],
    );
    const countText = dataset.locator('.wb-dataset-count');
    // The bar formats in the browser's locale; read the same formatting there.
    const expected = await page.evaluate((n) => `· ${n.toLocaleString()} proteins`, count);
    await expect(countText).toHaveText(expected);
    await expect(countText).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  test('tokens and the kit are ready before the explore runtime loads', async ({ page }) => {
    const releaseRuntime = await holdNextRequest(page, '**/src/explore/runtime.ts*');
    await page.goto('/explore');

    const appBar = page.locator('header[data-workbench="app-bar"]');
    await expect(appBar).toBeVisible();
    const defined = await page.evaluate(() => ({
      kit: customElements.get('ps-button') !== undefined,
      core: customElements.get('protspace-scatterplot') !== undefined,
    }));
    expect(defined).toEqual({ kit: true, core: false });
    // --ps-border, so the theme was adopted before the full core arrived.
    await expect(appBar).toHaveCSS('border-bottom-color', 'rgb(226, 232, 240)');
    releaseRuntime();
  });

  test('crossing 951 px keeps the same runtime elements', async ({ page }) => {
    await openExplore(page);
    const root = page.locator('.workbench');
    await expect(root).toHaveAttribute('data-layout', 'desktop');

    await page.evaluate((ids) => {
      (window as unknown as { __runtimeElements: Array<Element | null> }).__runtimeElements =
        ids.map((id) => document.getElementById(id));
    }, RUNTIME_ELEMENTS);
    const sameElements = () =>
      page.evaluate((ids) => {
        const before = (window as unknown as { __runtimeElements: Array<Element | null> })
          .__runtimeElements;
        return ids.every(
          (id, index) => before[index] !== null && document.getElementById(id) === before[index],
        );
      }, RUNTIME_ELEMENTS);

    await page.setViewportSize({ width: 900, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'narrow');
    expect(await sameElements()).toBe(true);
    const plot = await page.locator('#myPlot').boundingBox();
    const legend = await page.locator('#myLegend').boundingBox();
    expect(plot!.y + plot!.height).toBeLessThanOrEqual(legend!.y + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'desktop');
    expect(await sameElements()).toBe(true);
  });

  test('loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Cloudflare's analytics beacon (index.html) fails without network; it is not the app.
      const where = `${message.text()} ${message.location()?.url ?? ''}`;
      if (/cloudflareinsights|cloudflare-insights/.test(where)) return;
      errors.push(message.text());
    });
    await openExplore(page);
    // A second definition of a tag ("has already been used with this registry") would land here.
    expect(errors).toEqual([]);
  });

  test('the landing and privacy pages keep the site header', async ({ page }) => {
    for (const path of ['/', '/privacy']) {
      await page.goto(path);
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Docs', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-workbench]')).toHaveCount(0);
    }
  });
});
