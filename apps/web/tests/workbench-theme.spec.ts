import { expect, test, type Locator, type Page } from '@playwright/test';
import { appBar, openExplore, waitForExploreDataLoad } from './helpers/explore';
import { DARK_SURFACE, htmlTheme, seedTheme } from './helpers/theme';

/**
 * The explore page's theme (design decision 16): the stored choice, the first paint of a cold
 * load, the scope to /explore, and (Task 6.2 on) the switch.
 */

const WHITE = 'rgb(255, 255, 255)';

const workbench = (page: Page) => page.locator('.workbench');
const backgroundOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

/** The lazy Explore chunk: its dev-server path, or a production build's asset. */
const EXPLORE_CHUNK = /\/(src\/pages\/Explore\.tsx|assets\/Explore-[^/]*\.js)(\?|$)/;

/**
 * Loads `path` with the Explore chunk held back, so no token sheet is in the page. Returns the
 * body's background on the first animation frame (`first`) and again once the app has asked for
 * the chunk (`beforeChunk`: index.css is applied by then, the tokens are not), and `release`,
 * which lets the chunk through.
 */
async function loadWithExploreChunkHeld(
  page: Page,
  path = '/explore',
): Promise<{ first: string; beforeChunk: string; release: () => void }> {
  await page.addInitScript(() => {
    const sample = () => {
      if (!document.body) {
        requestAnimationFrame(sample);
        return;
      }
      (window as unknown as { __firstPaint?: string }).__firstPaint = getComputedStyle(
        document.body,
      ).backgroundColor;
    };
    requestAnimationFrame(sample);
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    EXPLORE_CHUNK,
    async (route) => {
      await gate;
      await route.fallback().catch(() => {});
    },
    { times: 1 },
  );
  const requested = page.waitForRequest(EXPLORE_CHUNK);
  await page.goto(path, { waitUntil: 'commit' });
  await requested;
  const first = (await (
    await page.waitForFunction(
      () => (window as unknown as { __firstPaint?: string }).__firstPaint ?? null,
    )
  ).jsonValue()) as string;
  const beforeChunk = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  return { first, beforeChunk, release };
}

test.describe('theme choice', () => {
  test('a cold load with Dark stored paints the dark surface before the Explore chunk runs', async ({
    page,
  }) => {
    await seedTheme(page, 'dark');
    const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

    expect(first).toBe(DARK_SURFACE);
    // The landing's white body rule is in the page now, layered; the boot style still wins.
    expect(beforeChunk).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'dark',
    );

    release();
    await waitForExploreDataLoad(page);
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
  });

  test('the GitHub Pages deep link /?/explore is themed', async ({ page }) => {
    await seedTheme(page, 'dark');
    const { first, release } = await loadWithExploreChunkHeld(page, '/?/explore');

    // The redirect ran first: the path the boot script checked was already /explore.
    expect(new URL(page.url()).pathname).toBe('/explore');
    expect(first).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('dark');
    release();
    await waitForExploreDataLoad(page);
  });

  test('only /explore is themed', async ({ page }) => {
    await seedTheme(page, 'dark');
    for (const path of ['/', '/privacy']) {
      await page.goto(path);
      expect(await htmlTheme(page)).toBeNull();
      await expect.poll(() => backgroundOf(page.locator('body'))).toBe(WHITE);
    }

    await openExplore(page);
    expect(await htmlTheme(page)).toBe('dark');

    // Leaving through the wordmark's SPA link: Explore unmounts and takes the attribute with it.
    await appBar(page).getByRole('link', { name: 'ProtSpace home' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect.poll(() => htmlTheme(page)).toBeNull();
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    ).not.toBe('dark');
    await expect.poll(() => backgroundOf(page.locator('body'))).toBe(WHITE);
  });

  test('with nothing stored the page is Light', async ({ page }) => {
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('light');
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
    // An explicit Light ignores the OS.
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
  });
});

test.describe('theme choice on a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  test('System stored follows a dark OS before the chunk runs', async ({ page }) => {
    await seedTheme(page, 'system');
    const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

    expect(first).toBe(DARK_SURFACE);
    expect(beforeChunk).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');

    release();
    await waitForExploreDataLoad(page);
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');
  });
});
