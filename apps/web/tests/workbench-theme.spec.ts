import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../src/explore/theme-defaults';
import {
  appBar,
  appBarTextFits,
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  exportAction,
  openExplore,
  waitForExploreDataLoad,
} from './helpers/explore';
import { chooseTheme, DARK_SURFACE, htmlTheme, seedTheme, themeButton } from './helpers/theme';

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

test.describe('the theme switch', () => {
  /** The Theme button's `icon` property: the icon the button shows. */
  const shownIcon = (page: Page) =>
    appBar(page)
      .locator('ps-icon-button[data-driver-id="theme"]')
      .evaluate((button) => (button as HTMLElement & { icon: string }).icon);

  test('Dark from the app bar themes the page, survives a reload and is stored as JSON', async ({
    page,
  }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');

    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe(
      '"dark"',
    );

    await page.reload();
    await waitForExploreDataLoad(page);
    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
  });

  test('the menu marks the current choice and opens on it', async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');

    await themeButton(page).click();
    const item = (name: string) => page.getByRole('menuitemradio', { name, exact: true });
    await expect(item('Dark')).toHaveAttribute('aria-checked', 'true');
    await expect(item('Dark')).toBeFocused();
    await expect(item('System')).toHaveAttribute('aria-checked', 'false');
    await expect(item('Light')).toHaveAttribute('aria-checked', 'false');
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test("the button's icon shows the choice", async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'Light');
    expect(await shownIcon(page)).toBe('sun');
    await chooseTheme(page, 'Dark');
    expect(await shownIcon(page)).toBe('moon');
    await chooseTheme(page, 'System');
    expect(await shownIcon(page)).toBe('sun-moon');
  });

  test('System follows the OS live', async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'System');
    expect(await htmlTheme(page)).toBe('system');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(WHITE);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => backgroundOf(workbench(page))).toBe(WHITE);
  });

  test('Escape closes the theme menu and returns focus to the button', async ({ page }) => {
    await openExplore(page);
    await themeButton(page).focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: 'Theme', exact: true });
    await expect(menu).toBeVisible();
    // Whatever the default, the menu opens on the checked choice.
    await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(themeButton(page)).toBeFocused();
  });
});

test.describe('the theme switch on an 800 px tablet', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('the Theme button sits between Export and Help, and the dataset name and search still fit', async ({
    page,
  }) => {
    await openExplore(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    const sides = async (locator: Locator) => {
      const b = (await locator.boundingBox())!;
      return { left: b.x, right: b.x + b.width };
    };
    const exported = await sides(appBar(page).getByRole('button', { name: 'Export', exact: true }));
    const theme = await sides(themeButton(page));
    const help = await sides(appBar(page).getByRole('button', { name: 'Help', exact: true }));
    expect(exported.right).toBeLessThanOrEqual(theme.left);
    expect(theme.right).toBeLessThanOrEqual(help.left);
    expect(await appBarTextFits(page)).toEqual({ name: true, placeholder: true });
  });
});

test.describe('exports stay light in Dark', () => {
  /** Exports a quick PNG and returns the downloaded file, base64-encoded. */
  async function quickPng(page: Page): Promise<string> {
    const download = page.waitForEvent('download');
    await exportAction(page, 'Quick PNG');
    const file = await download;
    return fs.readFileSync(await file.path()).toString('base64');
  }

  test('a quick PNG exported in Dark equals the one exported in Light', async ({ page }) => {
    await openExplore(page);
    // Explicit, so the test holds whatever DEFAULT_THEME is (Task 6.13 makes it System).
    await chooseTheme(page, 'Light');
    expect(await htmlTheme(page)).toBe('light');
    const light = await quickPng(page);
    await chooseTheme(page, 'Dark');
    expect(await htmlTheme(page)).toBe('dark');
    const dark = await quickPng(page);

    // Decode both in the page and compare every pixel: the export never reads the theme.
    const result = await page.evaluate(
      async ([a, b]) => {
        const decode = async (base64: string) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [x, y] = await Promise.all([decode(a), decode(b)]);
        let differing = 0;
        if (x.data.length === y.data.length) {
          for (let i = 0; i < x.data.length; i++) if (x.data[i] !== y.data[i]) differing++;
        }
        return {
          light: [x.width, x.height],
          dark: [y.width, y.height],
          differing,
          topLeft: Array.from(y.data.slice(0, 4)),
        };
      },
      [light, dark] as const,
    );

    expect(result.dark).toEqual(result.light);
    expect(result.differing).toBe(0);
    expect(result.topLeft).toEqual([255, 255, 255, 255]);
  });

  test('the figure editor previews a transparent figure on light paper in Dark', async ({
    page,
  }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');
    await exportAction(page, 'Figure editor…');
    const modal = page.locator('protspace-publish-modal');
    const preview = modal.locator('.publish-preview-canvas');
    await expect(preview).toBeVisible();
    const cornerAlpha = () =>
      preview.evaluate(
        (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
      );
    // A white figure covers the paper; a transparent one lets it show through.
    await expect.poll(cornerAlpha).toBe(255);
    await modal
      .locator('select.publish-select')
      .filter({ has: page.locator('option[value="transparent"]') })
      .selectOption('transparent');
    await expect.poll(cornerAlpha).toBe(0);

    const backdrop = await preview.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backdrop).toContain('rgb(255, 255, 255)');
    expect(backdrop).toContain('rgb(226, 232, 240)');
    expect(backdrop).not.toContain('rgb(15, 23, 42)');
    // The rest of the editor is dark: only the paper is fixed.
    expect(await htmlTheme(page)).toBe('dark');
  });
});

test.describe('dark surfaces', () => {
  // Dark role values from theme.ts, as computed colours (block-scoped: other describes in this
  // file may name their own).
  const DARK_RAISED = 'rgb(22, 32, 54)'; // --ps-surface-raised #162036
  const DARK_HOVER = 'rgb(30, 41, 59)'; // --ps-surface-hover #1e293b
  const DARK_TEXT = 'rgb(241, 245, 249)'; // --ps-text #f1f5f9
  const DARK_SCRIM = 'rgba(2, 6, 23, 0.65)'; // --ps-scrim

  test('the wordmark is inverted in Dark and plain in Light', async ({ page }) => {
    await openExplore(page);
    const wordmark = page.locator("[data-workbench='home'] img");
    await expect(wordmark).toHaveCSS('filter', 'none');

    await chooseTheme(page, 'Dark');
    await expect(wordmark).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');

    await chooseTheme(page, 'Light');
    await expect(wordmark).toHaveCSS('filter', 'none');
  });

  test('a toast is dark in Dark, and so is its hovered close button', async ({ page }) => {
    await seedTheme(page, 'dark');
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);
    await clearStatusChip(page, 'filter');

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Filter removed' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS('background-color', DARK_RAISED);
    await expect(toast).toHaveCSS('color', DARK_TEXT);

    // Sonner's own hover paints its light grey (--gray2) at a higher specificity than a plain rule.
    const close = toast.getByRole('button', { name: 'Dismiss notification' });
    await close.hover();
    await expect(close).toHaveCSS('background-color', DARK_HOVER);
  });

  test("the tour's popover, its arrow and its overlay are dark in Dark", async ({ page }) => {
    await seedTheme(page, 'dark');
    await openExplore(page);
    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    const popover = page.locator('.driver-popover');
    const title = popover.locator('.driver-popover-title');
    await expect(title).toHaveText('Welcome to ProtSpace');
    await expect(popover).toHaveCSS('background-color', DARK_RAISED);
    await expect(title).toHaveCSS('color', DARK_TEXT);
    await expect(page.locator('.driver-overlay path')).toHaveCSS('fill', DARK_SCRIM);

    // The welcome step is centred with no arrow; step 2 points at Import, so its arrow shows. The
    // arrow is a border triangle: only the side named in its class is painted.
    await popover.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import Your Data');
    const arrowColour = () =>
      popover.locator('.driver-popover-arrow').evaluate((arrow) => {
        const side = /driver-popover-arrow-side-(left|right|top|bottom)\b/.exec(
          arrow.className,
        )?.[1];
        return side ? getComputedStyle(arrow).getPropertyValue(`border-${side}-color`) : 'none';
      });
    await expect.poll(arrowColour).toBe(DARK_RAISED);
  });

  test('the explore body is the page surface, dark in Dark', async ({ page }) => {
    await openExplore(page);
    // An unlayered override of the token reaches <body>: it paints --ps-surface, not index.css's
    // white bg-background (which sits in a cascade layer and would ignore the override).
    const override = await page.addStyleTag({ content: ':root { --ps-surface: rgb(1, 2, 3); }' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 2, 3)');
    await override.evaluate((tag) => tag.parentNode?.removeChild(tag));

    await chooseTheme(page, 'Dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_SURFACE);
  });
});
