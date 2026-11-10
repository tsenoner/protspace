import { expect, test, type Locator } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET } from '../src/explore/example-datasets';
import {
  appBar,
  getProteinCount,
  holdNextRequest,
  openExplore,
  plotArea,
  sidebar,
} from './helpers/explore';

/**
 * The workbench shell (Task 2.2): the app bar, the view bar, the plot beside a flush sidebar, the
 * layouts below 951 px and first paint. Regions are found through the region helpers.
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

    const viewBar = page.getByRole('group', { name: 'View' });
    expect((await viewBar.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await expect(sidebar(page)).toHaveRole('complementary');
    await expect(sidebar(page)).toHaveAccessibleName('Sidebar');
    const plotBox = await plotArea(page).boundingBox();
    const sidebarBox = await sidebar(page).boundingBox();
    expect(Math.abs(plotBox!.x + plotBox!.width - sidebarBox!.x)).toBeLessThan(0.5);
    expect(sidebarBox!.width).toBe(300);

    for (const id of [...RUNTIME_ELEMENTS, 'myDataLoader']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('the app bar names the dataset and its protein count', async ({ page }) => {
    await openExplore(page);
    const count = await getProteinCount(page);

    const dataset = appBar(page).locator('[data-workbench="dataset"]');
    await expect(dataset).toHaveAttribute('data-dataset-name', DEFAULT_EXAMPLE_DATASET.label);
    // A decorative database icon leads the name.
    await expect(dataset.locator('svg.wb-dataset-icon')).toHaveAttribute('aria-hidden', 'true');
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

    const bar = appBar(page);
    await expect(bar).toBeVisible();
    const defined = await page.evaluate(() => ({
      kit: customElements.get('ps-button') !== undefined,
      core: customElements.get('protspace-scatterplot') !== undefined,
    }));
    expect(defined).toEqual({ kit: true, core: false });
    // --ps-border, so the theme was adopted before the full core arrived.
    await expect(bar).toHaveCSS('border-bottom-color', 'rgb(226, 232, 240)');
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
    await expect(root).toHaveAttribute('data-layout', 'tablet');
    expect(await sameElements()).toBe(true);
    const plot = await page.locator('#myPlot').boundingBox();
    const legend = await page.locator('#myLegend').boundingBox();
    expect(plot!.y + plot!.height).toBeLessThanOrEqual(legend!.y + 1);
    // A fixed screen below 951 px too: the plot over the panel row, and the page does not scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(false);

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

  test("Home's header shows its wordmark as the hero's large one starts under the bar", async ({
    page,
  }) => {
    await page.goto('/');
    const barLogo = page.getByRole('banner').locator('a[href="/"]').first();
    const heroLogo = page.locator('#hero-wordmark');
    await expect(heroLogo).toBeVisible();
    // At the top the hero's wordmark is the one in view; the bar's is hidden and out of the Tab order.
    await expect(barLogo).toHaveCSS('opacity', '0');
    await expect(barLogo).toHaveAttribute('tabindex', '-1');

    // As soon as the hero's wordmark starts under the bar, while most of it is still in view.
    const top = (await heroLogo.boundingBox())!.y;
    await page.evaluate((y) => window.scrollTo(0, y), top - 40);
    await expect(barLogo).toHaveCSS('opacity', '1');
    await expect(barLogo).not.toHaveAttribute('tabindex', '-1');

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(barLogo).toHaveCSS('opacity', '0');

    // Pages without a hero wordmark show the bar's from the start.
    await page.goto('/privacy');
    await expect(page.getByRole('banner').locator('a[href="/"]').first()).toHaveCSS('opacity', '1');
  });
});

/**
 * Home's header and Explore's app bar share their anchors (config/site-bar.css, PR 555 review): the
 * bar's height, the wordmark's box, and Feedback then GitHub ending at the same right edge. The
 * docs' nav reads the same file; its dev server is not part of this suite.
 */
test.describe('the anchors Home and Explore share', () => {
  const box = async (locator: Locator) => {
    const b = (await locator.boundingBox())!;
    return { left: b.x, top: b.y, right: b.x + b.width, height: b.height };
  };
  const anchors = async (bar: Locator, wordmark: Locator) => {
    // Until the SVG has loaded, the wordmark is 0 px wide.
    await expect
      .poll(() => wordmark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    return {
      bar: (await box(bar)).height,
      wordmark: await box(wordmark),
      feedback: await box(bar.getByRole('link', { name: 'Feedback', exact: true })),
      github: await box(bar.getByRole('link', { name: 'GitHub', exact: true })),
    };
  };

  for (const width of [1280, 1440, 800]) {
    test(`at ${width} px nothing moves between Home and Explore`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const header = page.getByRole('banner');
      const home = await anchors(header, header.locator('img[src="/wordmark.svg"]'));

      await openExplore(page);
      const explore = await anchors(appBar(page), page.locator("[data-workbench='home'] img"));

      expect(home).toEqual(explore);
      expect(explore.bar).toBe(48);
      expect(explore.wordmark).toMatchObject({ left: 24, height: 24 });
      expect(explore.feedback.right).toBeLessThan(explore.github.left);
      expect(width - explore.github.right).toBe(16);
    });
  }
});
