import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '../src/explore/theme-defaults';
import {
  appBar,
  appBarTextFits,
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  exportAction,
  figureEditorButton,
  openExplore,
  waitForExploreDataLoad,
} from './helpers/explore';
import { figureEditorContent, figurePreviewCanvas } from './helpers/figure';
import {
  chooseTheme,
  DARK_SURFACE,
  htmlTheme,
  seedTheme,
  shownTheme,
  themeButton,
} from './helpers/theme';
import { workbenchRoot } from './helpers/workbench';

/**
 * The site's theme (design decision 16): the stored choice, the first paint of a cold load, the
 * pages it reaches, and the switch.
 */

const WHITE = 'rgb(255, 255, 255)';

const backgroundOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

/** The lazy Explore chunk: its dev-server path, or a production build's asset. */
const EXPLORE_CHUNK = /\/(src\/pages\/Explore\.tsx|assets\/Explore-[^/]*\.js)(\?|$)/;

/**
 * Loads `path` with the Explore chunk held back, so no token sheet is in the page. Returns the
 * body's background on the first animation frame (`first`), the visible surface once the app has
 * asked for the chunk (`beforeChunk`: index.css is applied by then, the tokens are not), and
 * `release`, which lets the chunk through.
 *
 * `beforeChunk` reads what the user sees, not the body alone: in a build the chunk's CSS arrives
 * before its JS, and its `body { background: var(--ps-surface) }` leaves the body transparent
 * until the tokens exist. The boot style's colour on <html> then shows through.
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
  const beforeChunk = await page.evaluate(() => {
    // The body's background where it paints one, else the root's, else the browser's canvas
    // (white unless the root asks for a dark scheme).
    const transparent = 'rgba(0, 0, 0, 0)';
    const body = getComputedStyle(document.body).backgroundColor;
    if (body !== transparent) return body;
    const root = getComputedStyle(document.documentElement);
    if (root.backgroundColor !== transparent) return root.backgroundColor;
    return root.colorScheme.includes('dark') ? 'the dark canvas' : 'rgb(255, 255, 255)';
  });
  return { first, beforeChunk, release };
}

test.describe('theme choice', () => {
  test('a cold load with Dark stored paints the dark surface before the Explore chunk runs', async ({
    page,
  }) => {
    await seedTheme(page, 'dark');
    const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

    expect(first).toBe(DARK_SURFACE);
    // The landing's white body rule is in the page now, layered; the boot style's surface shows.
    expect(beforeChunk).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'dark',
    );

    release();
    await waitForExploreDataLoad(page);
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
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
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');
  });
});

test.describe('the theme switch', () => {
  /** The Theme button's `icon` property: the icon the button shows. */
  const shownIcon = (page: Page) =>
    appBar(page)
      .locator('ps-icon-button[data-driver-id="theme"]')
      .evaluate((button) => (button as HTMLElement & { icon: string }).icon);

  test('Dark from the app bar themes the page, survives a reload and is stored raw', async ({
    page,
  }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');

    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
    // VitePress's key and value, so the docs open dark too.
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');

    await page.reload();
    await waitForExploreDataLoad(page);
    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
  });

  test("a press flips the mode, and a press back to the OS's mode follows the system again", async ({
    page,
  }) => {
    await openExplore(page);
    const stored = () => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY);
    // Nothing stored on a light OS: the system's light.
    expect(await htmlTheme(page)).toBe('system');
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Light. Switch to Dark');

    await themeButton(page).click();
    expect(await htmlTheme(page)).toBe('dark');
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark. Switch to Light');
    expect(await stored()).toBe('dark');

    await themeButton(page).click();
    expect(await htmlTheme(page)).toBe('system');
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Light. Switch to Dark');
    expect(await stored()).toBeNull();

    // Following the system again: the OS turning dark turns the page and the button dark.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark. Switch to Light');
    // No menu: a press applies the other mode at once.
    await expect(page.getByRole('menu', { name: 'Theme' })).toHaveCount(0);
  });

  test("the button's icon shows the mode", async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'Light');
    expect(await shownIcon(page)).toBe('sun');
    await chooseTheme(page, 'Dark');
    expect(await shownIcon(page)).toBe('moon');
  });

  test("the explore page's old choice is moved to the shared key", async ({ page }) => {
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, '"dark"');
        sessionStorage.setItem('seeded', '1');
      }
    }, LEGACY_THEME_STORAGE_KEY);
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('dark');
    expect(
      await page.evaluate(
        ([legacy, key]) => [localStorage.getItem(legacy), localStorage.getItem(key)],
        [LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY],
      ),
    ).toEqual([null, 'dark']);
  });

  test('with no choice stored the page follows the OS live', async ({ page }) => {
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('system');
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(WHITE);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(WHITE);
  });

  test('Enter on the focused button switches the theme, keeps focus and announces it', async ({
    page,
  }) => {
    await seedTheme(page, 'system');
    await openExplore(page);
    const status = appBar(page)
      .getByRole('status')
      .filter({ hasText: /^Theme: / });
    await expect(status).toHaveCount(0);

    await themeButton(page).focus();
    await page.keyboard.press('Enter');
    expect(await htmlTheme(page)).toBe('dark');
    await expect(themeButton(page)).toBeFocused();
    await expect(themeButton(page)).toHaveAccessibleName('Theme: Dark. Switch to Light');
    await expect(status).toHaveText('Theme: Dark');
  });
});

test.describe('the theme switch on an 800 px tablet', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('the Theme button sits between the Figure editor and Help, and the dataset name and search still fit', async ({
    page,
  }) => {
    await openExplore(page);
    await expect(workbenchRoot(page)).toHaveAttribute('data-layout', 'tablet');
    const sides = async (locator: Locator) => {
      const b = (await locator.boundingBox())!;
      return { left: b.x, right: b.x + b.width };
    };
    const editor = await sides(figureEditorButton(page));
    const theme = await sides(themeButton(page));
    const help = await sides(appBar(page).getByRole('button', { name: 'Help', exact: true }));
    expect(editor.right).toBeLessThanOrEqual(theme.left);
    expect(theme.right).toBeLessThanOrEqual(help.left);
    expect(await appBarTextFits(page)).toEqual({ name: true, placeholder: true });
  });
});

test.describe('exports stay light in Dark', () => {
  /** Exports a quick PNG and returns the downloaded file, base64-encoded. */
  async function quickPng(page: Page): Promise<string> {
    const download = page.waitForEvent('download');
    await exportAction(page, 'PNG');
    const file = await download;
    return fs.readFileSync(await file.path()).toString('base64');
  }

  test('a quick PNG exported in Dark equals the one exported in Light', async ({ page }) => {
    await openExplore(page);
    // Explicit, so the test holds whatever DEFAULT_THEME is (Task 6.13 makes it System).
    await chooseTheme(page, 'Light');
    expect(await shownTheme(page)).toBe('light');
    const light = await quickPng(page);
    await chooseTheme(page, 'Dark');
    expect(await shownTheme(page)).toBe('dark');
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
    await figureEditorButton(page).click();
    const modal = figureEditorContent(page);
    const preview = figurePreviewCanvas(page);
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
  // Dark role values from tokens.css, as computed colours (block-scoped: other describes in this
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

    // The welcome step is centred with no arrow; step 2 points at the dataset name, so its arrow
    // shows. The arrow is a border triangle: only the side named in its class is painted.
    await popover.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Your Data');
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

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`nothing stored on a ${colorScheme} OS`, () => {
    test.use({ colorScheme });

    test('with nothing stored the page follows the OS', async ({ page }) => {
      const surface = colorScheme === 'dark' ? DARK_SURFACE : WHITE;
      const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

      expect(await htmlTheme(page)).toBe('system');
      if (colorScheme === 'dark') {
        expect(first).toBe(DARK_SURFACE);
      } else {
        // A light OS paints no boot colour: the body is transparent until index.css whitens it.
        expect(first).not.toBe(DARK_SURFACE);
      }
      expect(beforeChunk).toBe(surface);

      release();
      await waitForExploreDataLoad(page);
      expect(await htmlTheme(page)).toBe('system');
      await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(surface);
    });
  });
}

// The deleted Light test also checked that an explicit Light ignores a dark OS; keep that check.
test.describe('Light stored on a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  test('an explicit Light ignores the OS', async ({ page }) => {
    await seedTheme(page, 'light');
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('light');
    await expect.poll(() => backgroundOf(workbenchRoot(page))).toBe(WHITE);
  });
});
