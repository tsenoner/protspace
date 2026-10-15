/**
 * Turns the manifest into Playwright tests: one `test.describe` per output file, with its own
 * viewport, device, colour scheme, motion setting and stored layout, holding one test titled with
 * the file name (so `-g "<file>"` captures one image). Each test opens Explore, waits for the data
 * and for the plot to stop drawing, and runs the entry's setup and steps through a `CaptureApi`.
 * A screenshot then parks the pointer and shoots. A GIF is recorded at 1× in a context of its own
 * (Playwright sets `video` per worker, not per test) and saved, with a sidecar giving where the
 * scene starts, for `gif.ts` to convert.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  devices,
  expect,
  test,
  type Browser,
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
  DEFAULT_GIF_BUDGET,
  DESKTOP_VIEWPORT,
  GIF_START,
  TABLET_VIEWPORT,
  validateManifest,
  type CaptureApi,
  type CaptureEntry,
  type CaptureKind,
  type CaptureVariant,
  type Clip,
  type GifSidecar,
  type Theme,
  type ViewportName,
} from './capture-plan';
import { installIndicators, showClick, showCursor, showKey, showLabel } from './indicators';
import { MANIFEST } from './manifest';
import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';

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

/** A target's centre on screen: the point itself, or the middle of the element's box. */
async function pointOf(target: Locator | Point): Promise<Point> {
  if (!isLocator(target)) return target;
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Nothing to point at: ${target.toString()}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Control: 'Ctrl',
  Meta: '⌘',
  Shift: '⇧',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A key as the key cap shows it: "Control+z" → "Ctrl + Z". */
function keyLabel(key: string): string {
  return key
    .split('+')
    .map((part) => KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ');
}

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
 * The pointer and keys of a GIF scene: the pointer glides to each target, every click and key
 * press shows its overlay, and `hold` paces the recording. `hold` is the only timer in the
 * capture code; everything else waits for a signal.
 */
function recordingApi(page: Page, theme: Theme): CaptureApi {
  const glideTo = async (at: Point, steps = 12) => {
    await page.mouse.move(at.x, at.y, { steps });
    await showCursor(page, at);
  };
  return {
    kind: 'gif',
    theme,
    hold: async (ms) => {
      await page.waitForTimeout(ms);
    },
    click: async (target, options) => {
      const at = await pointOf(target);
      await glideTo(at);
      if (options?.label) await showLabel(page, options.label);
      await showClick(page, at);
      await page.mouse.click(at.x, at.y);
    },
    press: async (key, options) => {
      await showKey(page, options?.label ?? keyLabel(key));
      await page.keyboard.press(key);
    },
    moveTo: async (target, options) => {
      await glideTo(await pointOf(target), options?.steps ?? 15);
    },
    drag: async (from, to, options) => {
      await glideTo(from);
      await showClick(page, from);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: options?.steps ?? 20 });
      await page.mouse.up();
    },
    label: async (text) => {
      await showLabel(page, text);
    },
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

const recording = (name: string, extension: 'webm' | 'json') =>
  path.join(TEMP_VIDEOS_DIR, `${name}.${extension}`);

/**
 * Records a GIF scene in a context of its own, sized to the viewport at 1×. Saves the video and
 * its sidecar only when the scene passes; a failed one also removes an older recording of the
 * same name, so `gif.ts` never converts a stale one.
 */
async function recordGif(
  browser: Browser,
  baseURL: string | undefined,
  variant: CaptureVariant,
  outputDir: string,
): Promise<void> {
  const { entry, theme } = variant;
  const options = contextOptions(variant);
  if (!options.viewport) throw new Error(`${variant.file}: no viewport`);
  const context = await browser.newContext({
    ...options,
    baseURL,
    storageState: storedState(entry, baseURL),
    recordVideo: { dir: outputDir, size: options.viewport },
  });
  const page = await context.newPage();
  // The video starts with the page: the scene starts this long into it.
  const started = Date.now();
  let trimStartMs = 0;
  try {
    await installIndicators(page);
    const cap = recordingApi(page, theme);
    await openEntry(page, entry);
    await entry.setup?.(page, cap);
    trimStartMs = Date.now() - started;
    await entry.steps?.(page, cap);
  } catch (error) {
    await context.close();
    fs.rmSync(recording(entry.name, 'webm'), { force: true });
    fs.rmSync(recording(entry.name, 'json'), { force: true });
    throw error;
  }
  await context.close();
  const video = page.video();
  if (!video) throw new Error(`${variant.file}: the context recorded no video`);
  fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });
  await video.saveAs(recording(entry.name, 'webm'));
  const sidecar: GifSidecar = {
    name: entry.name,
    trimStartMs,
    budgetBytes: entry.budgetBytes ?? DEFAULT_GIF_BUDGET,
    start: { ...GIF_START, ...entry.gif },
  };
  fs.writeFileSync(recording(entry.name, 'json'), `${JSON.stringify(sidecar, null, 2)}\n`);
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
      if (kind === 'gif') {
        test(file, async ({ browser, baseURL }, testInfo) => {
          test.setTimeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS);
          await recordGif(browser, baseURL, variant, testInfo.outputPath('video'));
        });
        return;
      }

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
