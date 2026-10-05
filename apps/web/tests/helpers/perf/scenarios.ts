import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dismissTourIfPresent,
  selectAnnotation,
  selectProjection,
  waitForExploreDataLoad,
} from '../explore';
import {
  installProbes,
  readSnapshot,
  settle,
  type SegmentResult,
  type SegmentSpec,
} from './probes';
import type { BudgetKey } from './report';

/**
 * The perf segments, shared by `perf-counts.spec.ts` (headless, budgets) and
 * `perf-timing.spec.ts` (headed, timings). Each segment drives the real UI with
 * Playwright input and, where it changes view state, resets it through the UI.
 */

interface SegmentTraits {
  /** Leaves the page as it found it, so timing mode can repeat it. */
  repeatable?: true;
  /**
   * Counts that follow how many frames the segment spans, not our code: report only.
   * Seen varying between runs on one machine (load render 57-59, grid 2-3).
   */
  frameBound?: BudgetKey[];
  /** Bumps every core counter, so a counter that reads 0 here is disconnected. */
  bumpsAllCounters?: true;
  /** Draws every point of the dataset. */
  drawsAll?: true;
  /** The one segment that glides; the glide stops by itself. */
  glides?: true;
  /** The glide's switch without the glide: the frame the glide must end on. */
  glideTwin?: true;
}

const LOAD_FRAME_BOUND: BudgetKey[] = ['render', 'glSync', 'gridRebuild', 'glIsPerRender'];

/** Every segment in run order, with what the checks need to know about it. */
const SEGMENTS = {
  load: { frameBound: LOAD_FRAME_BOUND, bumpsAllCounters: true },
  idle: {},
  'annotation-switch': { repeatable: true },
  // A glide draws one render per frame.
  'projection-switch': { repeatable: true, frameBound: ['render'], glides: true },
  'projection-switch-instant': { repeatable: true, glideTwin: true },
  'legend-isolate': { repeatable: true },
  camera: { repeatable: true, frameBound: ['render', 'glSync'], drawsAll: true },
  resize: { repeatable: true },
  'search-select': { repeatable: true },
  import: { frameBound: LOAD_FRAME_BOUND },
  'import-no-settings': { frameBound: LOAD_FRAME_BOUND },
} satisfies Record<string, SegmentTraits>;

type SegmentName = keyof typeof SEGMENTS;

export function segmentTraits(name: string): SegmentTraits {
  return (SEGMENTS as Record<string, SegmentTraits>)[name] ?? {};
}

/**
 * The segments timing mode repeats: all of them, or those that a prefix names. A prefix
 * names every segment it starts, so `projection` also runs `projection-switch-instant`.
 */
export function repeatableSegments(prefixes: string[]): string[] {
  const repeatable = Object.keys(SEGMENTS).filter((name) => segmentTraits(name).repeatable);
  if (prefixes.length === 0) return repeatable;
  return prefixes.flatMap((prefix) => {
    const matches = repeatable.filter((name) => name === prefix || name.startsWith(`${prefix}-`));
    if (!matches.length) {
      throw new Error(`unknown scenario ${prefix}; one of ${repeatable.join(', ')}`);
    }
    return matches;
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE = path.resolve(HERE, '../../../public/data.parquetbundle');
/**
 * A bundle without legend settings. Imported after the demo bundle it keeps `protein_families`,
 * which has an "Other" bucket, and the legend's sync at the end of the load lists that bucket in
 * another order than its first count did. A reordering alone must not re-stage the plot.
 */
const NO_SETTINGS_BUNDLE = path.resolve(HERE, '../../../public/data/phosphatase.parquetbundle');

/** The annotation the switch segment goes to, when the dataset has it. */
const PREFERRED_SWITCH_ANNOTATION = 'phylum';

const VIEWPORT = { width: 1280, height: 720 };
const RESIZED = { width: 1100, height: 700 };

type PlotHost = Element & {
  data?: {
    protein_ids?: string[];
    annotations?: Record<string, unknown>;
    projections?: Array<{ name: string }>;
  };
  selectedAnnotation?: string;
  pickInteractivePointAt?: (x: number, y: number) => unknown;
};

interface ExploreState {
  annotation: string;
  switchTo: string;
  projectionCount: number;
  legendValue: string;
  accession: string;
}

/** Abort every request that leaves the dev server, so no segment waits on the network. */
async function blockExternalRequests(page: Page, baseUrl: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
}

/** Open Explore with the counters on and wait until the first dataset has rendered. */
export async function openExplore(page: Page, baseUrl: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await installProbes(page);
  await blockExternalRequests(page, baseUrl);
  await page.goto(new URL('/explore?perfCounters=1', baseUrl).toString());
  await waitForExploreDataLoad(page, { timeout: 60_000 });
  await dismissTourIfPresent(page);
}

export async function readExploreState(page: Page): Promise<ExploreState> {
  const state = await page.evaluate((preferred) => {
    const plot = document.querySelector('#myPlot') as PlotHost | null;
    const legend = document.querySelector('protspace-legend');
    const annotation = plot?.selectedAnnotation ?? '';
    const names = Object.keys(plot?.data?.annotations ?? {});
    const switchTo =
      preferred !== annotation && names.includes(preferred)
        ? preferred
        : (names.find((n) => n !== annotation) ?? '');
    const item = legend?.shadowRoot?.querySelector(
      '.legend-item:not([data-value="Other"]):not([data-value="__NA__"])',
    );
    return {
      annotation,
      switchTo,
      projectionCount: plot?.data?.projections?.length ?? 0,
      legendValue: item?.getAttribute('data-value') ?? '',
      accession: plot?.data?.protein_ids?.[0] ?? '',
    };
  }, PREFERRED_SWITCH_ANNOTATION);
  expect(state.annotation, 'no selected annotation').not.toBe('');
  expect(state.switchTo, 'dataset has a single annotation').not.toBe('');
  expect(state.legendValue, 'no legend item to isolate').not.toBe('');
  return state;
}

/** A point on the plot with no protein under it, in page coordinates. */
async function plotBackground(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.locator('#myPlot').evaluate((element: PlotHost) => {
    const rect = element.shadowRoot!.querySelector('svg')!.getBoundingClientRect();
    for (let y = rect.height * 0.15; y < rect.height * 0.85; y += 10) {
      for (let x = rect.width * 0.15; x < rect.width * 0.85; x += 10) {
        if (!element.pickInteractivePointAt?.(x, y)) return { x: rect.left + x, y: rect.top + y };
      }
    }
    return null;
  });
  if (!point) throw new Error('no empty plot background to reset the camera on');
  return point;
}

async function plotCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#myPlot').boundingBox();
  if (!box) throw new Error('#myPlot has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function importBundle(page: Page, file: string): Promise<void> {
  const ownDataset = page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]');
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  }
  const loaded = page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        document
          .getElementById('myDataLoader')
          ?.addEventListener('data-loaded', () => resolve(), { once: true }),
      ),
  );
  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(file);
  await loaded;
  await waitForExploreDataLoad(page, { timeout: 120_000 });
  // Importing leaves the menu open; close it so it cannot cover the plot.
  if (await ownDataset.isVisible().catch(() => false)) await page.keyboard.press('Escape');
}

type SegmentDef = Omit<SegmentSpec, 'timing'> & { name: SegmentName };

/** Segments 2–11 in run order; `load` is measured by `measureLoad`. */
export function buildSegments(page: Page, state: ExploreState, importFile: string): SegmentDef[] {
  const segments: SegmentDef[] = [
    {
      name: 'idle',
      act: () => page.waitForTimeout(2_000),
    },
    {
      name: 'annotation-switch',
      act: () => selectAnnotation(page, state.switchTo),
      reset: () => selectAnnotation(page, state.annotation),
      pixels: true,
    },
  ];
  if (state.projectionCount > 1) {
    segments.push(
      {
        name: 'projection-switch',
        act: () => selectProjection(page, 1),
        reset: () => selectProjection(page, 0),
        pixels: true,
        capture: true,
        idleAfterMs: 1_000,
        frames: 'glide',
      },
      // The same switch without the glide: one render, and the frame the glide must end on.
      {
        name: 'projection-switch-instant',
        act: async () => {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await selectProjection(page, 1);
        },
        reset: async () => {
          await selectProjection(page, 0);
          await page.emulateMedia({ reducedMotion: null });
        },
        capture: true,
      },
    );
  }
  const legendItem = page.locator(
    `protspace-legend .legend-item[data-value="${state.legendValue.replace(/"/g, '\\"')}"]`,
  );
  segments.push(
    {
      name: 'legend-isolate',
      act: () => legendItem.dblclick(),
      // Not a second dblclick: its leading click, click lands on the isolated item,
      // and hiding the last visible item shows all, so the dblclick isolates again.
      // `i` is the legend's keyboard isolate toggle, without the clicks.
      reset: () => legendItem.press('i'),
      pixels: true,
    },
    {
      name: 'camera',
      act: async () => {
        const center = await plotCenter(page);
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await page.mouse.move(center.x + 160, center.y + 96, { steps: 20 });
        await page.mouse.up();
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
      },
      frames: 'all',
      reset: async () => {
        const background = await plotBackground(page);
        await page.mouse.dblclick(background.x, background.y);
      },
      pixels: true,
    },
    {
      name: 'resize',
      act: async () => {
        await page.setViewportSize(RESIZED);
        await settle(page);
        await page.setViewportSize(VIEWPORT);
      },
      pixels: true,
    },
    {
      name: 'search-select',
      act: async () => {
        const input = page.locator(
          'protspace-control-bar protspace-protein-search #protein-search-input',
        );
        await input.fill(state.accession);
        await input.press('Enter');
      },
      reset: async () => {
        const input = page.locator(
          'protspace-control-bar protspace-protein-search #protein-search-input',
        );
        await input.press('Escape');
        await input.blur();
        await page.keyboard.press('Escape');
        // Selecting a protein opens its structure viewer, and clearing the selection
        // leaves it open; close it so later segments start from the same layout.
        const viewer = page.locator('#myStructureViewer');
        if (await viewer.isVisible()) await viewer.locator('.close-button').click();
        await expect(viewer, 'structure viewer still open after reset').toBeHidden({
          timeout: 5_000,
        });
      },
      pixels: true,
    },
    {
      name: 'import',
      act: () => importBundle(page, importFile),
    },
    {
      name: 'import-no-settings',
      act: () => importBundle(page, NO_SETTINGS_BUNDLE),
    },
  );
  return segments;
}

/** Counts from navigation to a settled first render; counters start at zero. */
export async function measureLoad(page: Page): Promise<SegmentResult> {
  await settle(page);
  const { drawn, ...delta } = await readSnapshot(page);
  return { name: 'load', delta, drawn, proteinCount: 0, pixelsSame: null };
}
