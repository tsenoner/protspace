import { test, type Browser, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import { readSnapshot, segment, settle, type SegmentSpec } from './helpers/perf/probes';
import {
  buildSegments,
  importBundle,
  openExplore,
  plotBackground,
  readExploreState,
} from './helpers/perf/scenarios';
import { tourCompletedStorageState } from './helpers/tour-storage-state';

/**
 * Scaling benchmark for one dataset, started by `pnpm perf:scale` (perf/scale.mjs), which
 * samples process memory, guards free memory, and aggregates the runs. Here: PERF_SCALE_COLD
 * imports, each in a fresh context, then the interactions on the last of those pages, each
 * with 2 warm-ups and PERF_SCALE_REPS measured reps. Everything goes to PERF_SCALE_OUT as it
 * is measured, so a run that crashes or is killed keeps what it got. See perf/README.md.
 */

const env = process.env;
const DATASET: { name: string; file: string } = JSON.parse(env.PERF_SCALE_DATASET ?? '{}');
const OUT = env.PERF_SCALE_OUT ?? '';
const COLD = Math.max(1, Number(env.PERF_SCALE_COLD ?? 10));
const REPS = Math.max(1, Number(env.PERF_SCALE_REPS ?? 20));
const WARMUPS = 2;
const BASE_URL = env.PLAYWRIGHT_BASE_URL ?? '';
const VIEWPORT = { width: 1600, height: 1000 };
const DPR = 2;
/** Settle caps: an import or one interaction at several million points can take seconds. */
const LOAD_CAP_MS = 300_000;
const ACT_CAP_MS = 120_000;
const PAN_ZOOM_MS = 5_000;
const LASSO_FRACTION = 0.15;
const EXPORT_SIZE = { width: 2000, height: 1500 };
const TOAST = /Too many points to draw|Rendering quality reduced/;

type PlotHost = Element & {
  data?: { protein_ids?: string[] };
  selectedProteinIds?: string[];
  selectionTool?: string;
  pickInteractivePointAt?: (x: number, y: number) => unknown;
  captureAtResolution?: (width: number, height: number) => HTMLCanvasElement;
  /** Private fields of the production build, which esbuild keeps: the lasso is sized with them. */
  _interaction?: {
    host: {
      queryByPolygon: (polygon: number[][]) => unknown[];
      getTransform: () => { k: number; x: number; y: number };
    };
  };
};

interface LoadWatch {
  loaded: number | null;
  renderAtLoaded: number;
  firstFrame: number | null;
  firstDrawn: number;
  lastChange: number;
  done: boolean;
}

declare global {
  interface Window {
    __scaleDegraded?: Array<{ message: string; reason: string | null }>;
    __scaleLoad?: LoadWatch;
    __scaleLassoMs?: number;
  }
}

type Sample = Record<string, number | null>;

const result: {
  dataset: typeof DATASET;
  fileBytes: number;
  browser: string;
  viewport: typeof VIEWPORT & { dpr: number };
  cold: number;
  reps: number;
  warmups: number;
  gpu?: { renderer: string; maxTextureSize: number };
  n?: number;
  marks: Array<{ name: string; t: number }>;
  loads: Sample[];
  interactions: Record<string, Sample[]>;
  skipped: string[];
  degraded: Array<{ message: string; reason: string | null }>;
  toasts: number;
  drawnAtEnd?: number;
  heapAfterInteractionsMB?: number | null;
  crashed: boolean;
  failure?: string;
} = {
  dataset: DATASET,
  fileBytes: DATASET.file ? fs.statSync(DATASET.file).size : 0,
  browser: env.PERF_SCALE_BROWSER ?? 'chrome',
  viewport: { ...VIEWPORT, dpr: DPR },
  cold: COLD,
  reps: REPS,
  warmups: WARMUPS,
  marks: [],
  loads: [],
  interactions: {},
  skipped: [],
  degraded: [],
  toasts: 0,
  crashed: false,
};

const save = () => fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
/** Wall-clock marks, which perf/scale.mjs lines up with its memory samples. */
const mark = (name: string) => result.marks.push({ name, t: Date.now() });

async function heapMB(cdp: CDPSession | null): Promise<number | null> {
  if (!cdp) return null;
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 2 ** 20;
}

/** A fresh context and page on Explore with the demo dataset, its CDP session in Chromium. */
async function openPage(browser: Browser): Promise<{ page: Page; cdp: CDPSession | null }> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    storageState: tourCompletedStorageState(BASE_URL),
  });
  const page = await context.newPage();
  page.on('crash', () => {
    result.crashed = true;
    save();
  });
  await page.addInitScript(() => {
    const events: NonNullable<Window['__scaleDegraded']> = (window.__scaleDegraded = []);
    document.addEventListener(
      'renderer-degraded',
      (e) => {
        const detail = (e as CustomEvent).detail;
        events.push({ message: detail?.message ?? '', reason: detail?.context?.reason ?? null });
      },
      true,
    );
  });
  await openExplore(page, BASE_URL);
  const cdp =
    browser.browserType().name() === 'chromium' ? await context.newCDPSession(page) : null;
  await cdp?.send('Performance.enable');
  return { page, cdp };
}

/**
 * Import the dataset through the import control and time its phases in the page: file
 * chosen → `data-loaded` → first frame drawn after it → last counter change before the
 * page settled. The import menu is opened before the clock starts.
 */
async function coldLoad(
  browser: Browser,
  i: number,
): Promise<{ page: Page; cdp: CDPSession | null }> {
  const { page, cdp } = await openPage(browser);
  await settle(page, LOAD_CAP_MS);
  const heapBefore = await heapMB(cdp);
  await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  const t0 = await page.evaluate(() => {
    const c = window.__protspacePerfCounters!;
    const w: LoadWatch = (window.__scaleLoad = {
      loaded: null,
      renderAtLoaded: 0,
      firstFrame: null,
      firstDrawn: 0,
      lastChange: performance.now(),
      done: false,
    });
    document.getElementById('myDataLoader')?.addEventListener(
      'data-loaded',
      () => {
        w.loaded = performance.now();
        w.renderAtLoaded = c.render;
      },
      { once: true },
    );
    let key = '';
    const tick = () => {
      if (w.done) return;
      const now = performance.now();
      const k = `${JSON.stringify(c)} ${window.__perfProbe?.bufferBytes ?? 0}`;
      if (k !== key) {
        key = k;
        w.lastChange = now;
      }
      if (w.loaded !== null && w.firstFrame === null && c.render > w.renderAtLoaded) {
        w.firstFrame = now;
        w.firstDrawn = c.drawn;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return performance.now();
  });
  mark(`load${i}:chosen`);
  await importBundle(page, DATASET.file);
  await settle(page, LOAD_CAP_MS);
  mark(`load${i}:settled`);
  const phases = await page.evaluate((t0) => {
    const w = window.__scaleLoad!;
    w.done = true;
    const plot = document.querySelector('#myPlot') as PlotHost;
    return {
      chosenToLoadedMs: w.loaded === null ? null : w.loaded - t0,
      chosenToFirstFrameMs: w.firstFrame === null ? null : w.firstFrame - t0,
      chosenToSettledMs: w.lastChange - t0,
      firstFrameDrawn: w.firstDrawn,
      n: plot.data?.protein_ids?.length ?? 0,
      drawn: window.__protspacePerfCounters?.drawn ?? 0,
    };
  }, t0);
  const heapAfter = await heapMB(cdp);
  const degraded = await page.evaluate(() => window.__scaleDegraded ?? []);
  result.degraded.push(...degraded);
  result.n = phases.n;
  result.loads.push({
    ...phases,
    heapBeforeMB: heapBefore,
    heapAfterMB: heapAfter,
    toasts: await page.getByText(TOAST).count(),
    degradedEvents: degraded.length,
  });
  save();
  return { page, cdp };
}

/** The plot's SVG rect in page coordinates. */
async function plotRect(page: Page) {
  return page.locator('#myPlot').evaluate((plot) => {
    const r = plot.shadowRoot!.querySelector('svg')!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** An occupied pixel near the plot centre, in page coordinates. */
async function occupiedPoint(page: Page): Promise<{ x: number; y: number }> {
  const rect = await plotRect(page);
  const point = await page.locator('#myPlot').evaluate((element: PlotHost, { width, height }) => {
    for (let r = 0; r < Math.max(width, height) / 2; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = width / 2 + r * Math.cos((a * Math.PI) / 8);
        const y = height / 2 + r * Math.sin((a * Math.PI) / 8);
        if (x > 0 && y > 0 && x < width && y < height && element.pickInteractivePointAt?.(x, y)) {
          return { x, y };
        }
      }
    }
    return null;
  }, rect);
  if (!point) throw new Error('no occupied pixel to click');
  return { x: rect.left + point.x, y: rect.top + point.y };
}

/**
 * A lasso polygon, in page coordinates: the band from the plot's left edge, as wide as
 * needed to hold LASSO_FRACTION of the points by the plot's own polygon query.
 */
async function lassoPolygon(page: Page, n: number): Promise<number[][]> {
  const rect = await plotRect(page);
  const band = (f: number) => {
    const [x0, y0, x1, y1] = [4, 4, 4 + Math.max(2, (rect.width - 8) * f), rect.height - 4];
    const pts: number[][] = [];
    const side = (ax: number, ay: number, bx: number, by: number, steps: number) => {
      for (let i = 0; i < steps; i++) {
        pts.push([ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps]);
      }
    };
    side(x0, y0, x1, y0, 8);
    side(x1, y0, x1, y1, 12);
    side(x1, y1, x0, y1, 8);
    side(x0, y1, x0, y0, 12);
    return pts;
  };
  let [lo, hi, f] = [0, 1, LASSO_FRACTION];
  for (let i = 0; i < 14; i++) {
    const count = await page
      .locator('#myPlot')
      .evaluate(
        (plot: PlotHost, poly) => plot._interaction?.host.queryByPolygon(poly).length ?? -1,
        band(f),
      );
    if (count < 0 || Math.abs(count / n - LASSO_FRACTION) < 0.01) break;
    if (count / n < LASSO_FRACTION) lo = f;
    else hi = f;
    f = (lo + hi) / 2;
  }
  const t = await page
    .locator('#myPlot')
    .evaluate((plot: PlotHost) => plot._interaction?.host.getTransform() ?? { k: 1, x: 0, y: 0 });
  return band(f).map(([x, y]) => [rect.left + x * t.k + t.x, rect.top + y * t.k + t.y]);
}

async function clearSelection(page: Page): Promise<void> {
  const clear = page.locator('protspace-control-bar .right-controls-clear');
  if (await clear.isEnabled()) await clear.click();
  // Selecting a protein opens its structure viewer; clearing leaves it open.
  const viewer = page.locator('#myStructureViewer');
  if (await viewer.isVisible()) await viewer.locator('.close-button').click();
}

type Interaction = Omit<SegmentSpec, 'timing' | 'capMs'> & {
  /** Numbers read once the act settled, such as the lasso's pointerup-to-render. */
  extra?: () => Promise<Sample>;
  /** Runs before each rep, outside the measured window. */
  before?: () => Promise<void>;
};

async function interactions(page: Page, n: number): Promise<Interaction[]> {
  const state = await readExploreState(page);
  const shared = Object.fromEntries(
    buildSegments(page, state, DATASET.file).map((s) => [
      s.name,
      { ...s, pixels: false, capture: false, idleAfterMs: undefined as number | undefined },
    ]),
  );
  const legendItem = page.locator(
    `protspace-legend .legend-item[data-value="${state.legendValue.replace(/"/g, '\\"')}"]`,
  );
  const target = await occupiedPoint(page);
  const lasso = await lassoPolygon(page, n);
  const plot = page.locator('#myPlot');
  let exportResult: Sample = {};

  const list: Interaction[] = [shared['annotation-switch']];
  // Hiding or isolating the only item of a legend changes nothing.
  if ((await page.locator('protspace-legend .legend-item').count()) > 1) {
    list.push(
      { name: 'legend-hide', act: () => legendItem.click(), reset: () => legendItem.click() },
      shared['legend-isolate'],
    );
  } else {
    result.skipped.push('legend-hide', 'legend-isolate');
  }
  list.push(
    {
      name: 'click-select',
      act: async () => {
        await page.mouse.move(target.x, target.y);
        await page.mouse.click(target.x, target.y);
      },
      reset: async () => {
        await clearSelection(page);
        await page.mouse.move(0, 0);
      },
      extra: async () => ({
        selected: await plot.evaluate((p: PlotHost) => p.selectedProteinIds?.length ?? 0),
      }),
    },
    shared['search-select'],
    {
      name: 'lasso',
      before: async () => {
        await plot.evaluate((p: PlotHost) => {
          p.selectionTool = 'lasso';
        });
        await page.locator('protspace-control-bar .right-controls-select').click();
      },
      act: async () => {
        const [first, ...rest] = lasso;
        await page.mouse.move(first[0], first[1]);
        await page.mouse.down();
        for (const [x, y] of rest) await page.mouse.move(x, y);
        await page.mouse.move(first[0], first[1]);
        // From pointerup to the first frame the renderer draws after it.
        await page.evaluate(() => {
          window.__scaleLassoMs = undefined;
          window.addEventListener(
            'pointerup',
            () => {
              const c = window.__protspacePerfCounters!;
              const [r0, t0] = [c.render, performance.now()];
              const poll = () => {
                if (c.render > r0) window.__scaleLassoMs = performance.now() - t0;
                else requestAnimationFrame(poll);
              };
              requestAnimationFrame(poll);
            },
            { capture: true, once: true },
          );
        });
        await page.mouse.up();
      },
      reset: async () => {
        await clearSelection(page);
        await page.locator('protspace-control-bar .right-controls-select').click();
      },
      extra: async () =>
        page.evaluate((n) => {
          const p = document.querySelector('#myPlot') as PlotHost;
          const selected = p.selectedProteinIds?.length ?? 0;
          return { upToRenderMs: window.__scaleLassoMs ?? null, selectedPct: (100 * selected) / n };
        }, n),
    },
  );
  if (state.projectionCount > 1) {
    list.push(shared['projection-switch-instant'], shared['projection-switch']);
  } else {
    result.skipped.push('projection-switch-instant', 'projection-switch');
  }
  list.push(
    {
      name: 'export',
      act: async () => {
        exportResult = await plot.evaluate((p: PlotHost, { width, height }) => {
          const t0 = performance.now();
          const canvas = p.captureAtResolution!(width, height);
          const captureMs = performance.now() - t0;
          // Blank check on a 200 × 150 thumbnail: the share of pixels unlike the corner.
          const thumb = document.createElement('canvas');
          thumb.width = 200;
          thumb.height = 150;
          const g = thumb.getContext('2d')!;
          g.drawImage(canvas, 0, 0, 200, 150);
          const d = g.getImageData(0, 0, 200, 150).data;
          let ink = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (
              Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) >
              24
            ) {
              ink++;
            }
          }
          const inkPct = (100 * ink) / (200 * 150);
          return {
            captureMs,
            width: canvas.width,
            height: canvas.height,
            inkPct,
            blank: inkPct < 0.5 ? 1 : 0,
          };
        }, EXPORT_SIZE);
      },
      extra: async () => exportResult,
    },
    {
      name: 'pan-zoom',
      frames: 'all',
      act: async () => {
        const rect = await plotRect(page);
        const [cx, cy] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
        const end = Date.now() + PAN_ZOOM_MS;
        for (let i = 0; Date.now() < end; i++) {
          // A drag along a circle, then a few wheel steps in, then out.
          const a = (i * Math.PI) / 4;
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx + 120 * Math.cos(a), cy + 80 * Math.sin(a), { steps: 12 });
          await page.mouse.up();
          for (let k = 0; k < 3; k++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
        }
      },
      reset: async () => {
        const background = await plotBackground(page);
        await page.mouse.dblclick(background.x, background.y);
      },
    },
  );
  return list;
}

/** One rep: the shared segment, with the time from act to settled and the extra numbers. */
async function rep(page: Page, cdp: CDPSession | null, def: Interaction): Promise<Sample> {
  await def.before?.();
  let settledMs = 0;
  let extra: Sample = {};
  const r = await segment(page, {
    ...def,
    capMs: ACT_CAP_MS,
    act: async (settleSegment) => {
      const t0 = Date.now();
      await def.act(settleSegment);
      await settleSegment();
      settledMs = Date.now() - t0;
      // Before the reset, which clears what the act selected.
      if (def.extra) extra = await def.extra();
    },
    ...(cdp ? { timing: { cdp } } : {}),
  });
  const t = r.timing;
  return {
    settledMs,
    inp: t?.inp ?? null,
    loaf: t?.loaf ?? null,
    busy: t?.busy ?? null,
    restageMs: t?.restageMs ?? r.delta.restageMs,
    p50Frame: t?.p50Frame ?? null,
    p95Frame: t?.p95Frame ?? null,
    restage: r.delta.restage,
    render: r.delta.render,
    uploadedBytesTotal: r.delta.bufferBytes,
    drawn: r.drawn,
    ...extra,
  };
}

test(`scale ${DATASET.name}`, async ({ browser }) => {
  test.setTimeout(Number(env.PERF_SCALE_TIMEOUT_MS ?? 3_600_000) + 60_000);
  try {
    let current: { page: Page; cdp: CDPSession | null } | null = null;
    for (let i = 0; i < COLD; i++) {
      if (current) await current.page.context().close();
      current = await coldLoad(browser, i);
    }
    const { page, cdp } = current!;
    result.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: info
          ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      };
    });
    mark('interactions:start');
    for (const def of await interactions(page, result.n ?? 0)) {
      mark(`${def.name}:start`);
      const samples: Sample[] = (result.interactions[def.name] = []);
      for (let k = 0; k < WARMUPS + REPS; k++) {
        const sample = await rep(page, cdp, def);
        if (k >= WARMUPS) samples.push(sample);
      }
      save();
    }
    mark('interactions:end');
    result.heapAfterInteractionsMB = await heapMB(cdp);
    result.drawnAtEnd = (await readSnapshot(page)).drawn;
    result.toasts = await page.getByText(TOAST).count();
    // The last load's page: keep only what the interactions raised after its load.
    const degraded = await page.evaluate(() => window.__scaleDegraded ?? []);
    result.degraded.push(...degraded.slice(result.loads.at(-1)?.degradedEvents ?? 0));
  } catch (error) {
    result.failure = String((error as Error)?.stack ?? error)
      .split('\n')
      .slice(0, 4)
      .join(' | ');
    throw error;
  } finally {
    save();
  }
});
