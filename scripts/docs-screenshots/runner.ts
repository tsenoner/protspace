/**
 * Turns the manifest into Playwright tests: one `test.describe` per output file, with its own
 * viewport, device, colour scheme, motion setting and stored layout, holding one test titled with
 * the file name (so `-g "<file>"` captures one image). Each test opens Explore, waits for the data
 * and for the plot to stop drawing, runs the entry's setup and steps through a `CaptureApi`, parks
 * the pointer, and shoots.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEFAULT_LAYOUT } from '../../apps/web/src/explore/layout-defaults';
import {
  exampleFetched,
  expectProductDemo,
  openExample,
} from '../../apps/web/tests/helpers/examples';
import { waitForExploreDataLoad } from '../../apps/web/tests/helpers/explore';
import { plotSettled } from '../../apps/web/tests/helpers/plot';
import { exploreStorageState } from '../../apps/web/tests/helpers/tour-storage-state';
import {
  captureVariants,
  DESKTOP_VIEWPORT,
  TABLET_VIEWPORT,
  validateManifest,
  type CaptureApi,
  type CaptureEntry,
  type CaptureKind,
  type CaptureVariant,
  type Clip,
  type Theme,
  type ViewportName,
} from './capture-plan';
import { MANIFEST } from './manifest';
import { IMAGES_DIR } from './paths';

const DEFAULT_TIMEOUT_MS = 90_000;
/** How long the plot may keep drawing after a load before the capture fails. */
const SETTLE_CAP_MS = 10_000;

type Point = { x: number; y: number };
type Device = Pick<
  BrowserContextOptions,
  'viewport' | 'userAgent' | 'deviceScaleFactor' | 'isMobile' | 'hasTouch'
>;

/**
 * A device descriptor without `defaultBrowserType`, which a describe group cannot set (it would
 * need a worker of its own); every capture runs in the project's Chromium.
 */
function descriptor(name: 'Desktop Chrome' | 'Pixel 7'): Device {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name];
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

/** Desktop Chrome at 1280×720; a Pixel 7 (412×839, touch); the same phone at 800×1280. */
const DEVICES: Record<ViewportName, Device> = {
  desktop: { ...descriptor('Desktop Chrome'), viewport: DESKTOP_VIEWPORT },
  phone: descriptor('Pixel 7'),
  tablet: { ...descriptor('Pixel 7'), viewport: TABLET_VIEWPORT },
};

/** The context a variant is captured in, except its stored state, which needs the base URL. */
function contextOptions({ entry, theme }: CaptureVariant): BrowserContextOptions {
  const { viewport } = entry;
  const base = typeof viewport === 'object' ? { ...DEVICES.desktop, viewport } : DEVICES[viewport];
  const desktopLike = typeof viewport === 'object' || viewport === 'desktop';
  return {
    ...base,
    // Phones and tablets at 2, not Pixel 7's 2.625: touch comes from isMobile/hasTouch, and the
    // docs show these 240-320 px wide.
    deviceScaleFactor: entry.kind === 'gif' ? 1 : desktopLike ? (entry.scale ?? 2) : 2,
    colorScheme: theme,
    reducedMotion: entry.kind === 'png' ? 'reduce' : 'no-preference',
  };
}

/**
 * The tour marked seen, the theme left on System (so `colorScheme` picks it), and the entry's
 * layout over the default one.
 */
function storedState(entry: CaptureEntry, baseURL: string | undefined) {
  if (!baseURL) throw new Error('The capture config sets no baseURL');
  return exploreStorageState(baseURL, {
    layout: { ...DEFAULT_LAYOUT, ...entry.layout },
    theme: 'system',
  });
}

/**
 * Opens the entry's dataset (the startup demo, or an example by its `?dataset=` link) with the
 * perf counters on, refuses an e2e fixture, and waits until the plot has stopped drawing.
 */
async function openEntry(page: Page, entry: CaptureEntry): Promise<void> {
  if (entry.dataset) {
    if (!exampleFetched(entry.dataset)) {
      throw new Error(`The "${entry.dataset}" example is not on disk: run \`pnpm examples:fetch\``);
    }
    await openExample(page, entry.dataset, { search: '&perfCounters=1' });
  } else {
    await page.goto('/explore?perfCounters=1');
    await waitForExploreDataLoad(page);
  }
  await expectProductDemo(page);
  await plotSettled(page, SETTLE_CAP_MS);
}

const isLocator = (target: Locator | Point): target is Locator =>
  typeof (target as Locator).boundingBox === 'function';

/** The pointer and keys of a screenshot scene: actions without overlays, no pacing. */
function screenshotApi(page: Page, theme: Theme): CaptureApi {
  return {
    kind: 'png',
    theme,
    hold: async () => {},
    click: async (target) => {
      if (isLocator(target)) await target.click();
      else await page.mouse.click(target.x, target.y);
    },
    press: async (key) => {
      await page.keyboard.press(key);
    },
    moveTo: async (target, options) => {
      if (isLocator(target)) {
        await target.hover();
        return;
      }
      await page.mouse.move(target.x, target.y, { steps: options?.steps });
    },
    drag: async (from, to, options) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: options?.steps ?? 20 });
      await page.mouse.up();
    },
    label: async () => {},
  };
}

/**
 * Moves the pointer off every control and checks that no kit tooltip is left open, so neither a
 * hover state nor a tooltip ends up in the picture.
 */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator('ps-tooltip .tip').filter({ visible: true })).toHaveCount(0);
}

const isClip = (target: Locator | Clip): target is Clip =>
  typeof (target as Clip).width === 'number';

async function shoot(page: Page, entry: CaptureEntry, file: string): Promise<void> {
  const out = path.join(IMAGES_DIR, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const options = { path: out, animations: 'disabled', caret: 'hide' } as const;
  const target = entry.target ? await entry.target(page) : null;
  if (!target) await page.screenshot(options);
  else if (isClip(target)) await page.screenshot({ ...options, clip: target });
  else await target.screenshot(options);
}

/** Registers one test per output file of `kind`; throws when the manifest is invalid. */
export function registerCaptures(kind: CaptureKind): void {
  const problems = validateManifest(MANIFEST);
  if (problems.length > 0) {
    throw new Error(`The docs capture manifest is invalid:\n${problems.join('\n')}`);
  }
  for (const variant of captureVariants(MANIFEST, kind)) {
    const { entry, theme, file } = variant;
    test.describe(file, () => {
      test.use({
        ...contextOptions(variant),
        storageState: async ({ baseURL }, use) => {
          await use(storedState(entry, baseURL));
        },
      });

      test(file, async ({ page }) => {
        test.setTimeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const cap = screenshotApi(page, theme);
        await openEntry(page, entry);
        await entry.setup?.(page, cap);
        await entry.steps?.(page, cap);
        if (!entry.keepPointer) await parkPointer(page);
        await shoot(page, entry, file);
      });
    });
  }
}
