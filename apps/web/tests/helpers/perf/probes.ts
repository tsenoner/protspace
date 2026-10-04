import type { CDPSession, Page } from '@playwright/test';

/**
 * Probes for the perf checks. Two sources, neither tied to a private method name:
 *
 * - core's flag-gated counters (`packages/core/src/utils/perf-counters.ts`), read off
 *   `window.__protspacePerfCounters` when the page URL has `?perfCounters=1`;
 * - wrappers on the public `WebGL2RenderingContext.prototype`, installed by an init
 *   script, which count `gl.is*` calls, synchronous GL reads and uploaded bytes.
 *
 * The same init script records Event Timing, long animation frames and (while armed)
 * frame gaps, which only timing mode reports.
 */

const COUNT_KEYS = [
  'restage',
  'restagePos',
  'restageStyle',
  'render',
  'processData',
  'gridRebuild',
  'legendUpdate',
  'legendRebuild',
  'glIs',
  'glSync',
  'uploadBytes',
] as const;
type CountKey = (typeof COUNT_KEYS)[number];

export interface Snapshot extends Record<CountKey, number> {
  restageMs: number;
  drawn: number;
}

export interface TimingSample {
  /** Longest Event Timing duration of any interaction in the window (INP-like), ms. */
  inp: number;
  /** Longest long-animation-frame in the window, ms, and its longest script. */
  loaf: number;
  loafScript: string;
  /** Main-thread task time in the window, from CDP `TaskDuration`, ms. */
  busy: number;
  /** null on a build without the counters. */
  restageMs: number | null;
  /** 95th percentile gap between animation frames, ms; only for segments that arm it. */
  p95Frame: number | null;
}

export interface SegmentResult {
  name: string;
  delta: Snapshot;
  /** Points drawn by the last render once the segment settled. */
  drawn: number;
  proteinCount: number;
  /** null when the segment does not check pixels. */
  pixelsSame: boolean | null;
  /** Both screenshots when they differ, for the report to attach. */
  pixelDiff?: { before: Buffer; after: Buffer };
  /** The plot once `act` settled, when the spec asked to capture it. */
  actPixels?: Buffer;
  timing?: TimingSample;
}

interface ProbeState {
  glIs: number;
  glSync: number;
  uploadBytes: number;
  events: Array<{ start: number; duration: number }>;
  loafs: Array<{ start: number; duration: number; script: string }>;
  frames: number[] | null;
}

declare global {
  interface Window {
    __perfProbe?: ProbeState;
    __protspacePerfCounters?: Record<string, number>;
  }
}

/** Install the GL wrappers and timing observers. Must run before `page.goto`. */
export async function installProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: ProbeState = {
      glIs: 0,
      glSync: 0,
      uploadBytes: 0,
      events: [],
      loafs: [],
      frames: null,
    };
    window.__perfProbe = probe;

    const proto = (window as unknown as { WebGL2RenderingContext?: { prototype: object } })
      .WebGL2RenderingContext?.prototype as Record<string, unknown> | undefined;
    if (proto) {
      const wrap = (name: string, count: (args: unknown[]) => void) => {
        const original = proto[name];
        if (typeof original !== 'function') return;
        proto[name] = function (this: unknown, ...args: unknown[]) {
          count(args);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        };
      };
      for (const name of ['isProgram', 'isBuffer', 'isTexture', 'isVertexArray', 'isFramebuffer']) {
        wrap(name, () => probe.glIs++);
      }
      for (const name of ['getError', 'getProgramParameter', 'getShaderParameter', 'readPixels']) {
        wrap(name, () => probe.glSync++);
      }
      const byteLength = (data: unknown): number => {
        if (typeof data === 'number') return data;
        if (data && typeof (data as ArrayBufferView).byteLength === 'number') {
          return (data as ArrayBufferView).byteLength;
        }
        return 0;
      };
      wrap('bufferData', (args) => (probe.uploadBytes += byteLength(args[1])));
      wrap('bufferSubData', (args) => (probe.uploadBytes += byteLength(args[2])));
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTiming[]) {
          if (entry.interactionId) {
            probe.events.push({ start: entry.startTime, duration: entry.duration });
          }
        }
      }).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      // Event Timing is Chromium-only; timing mode runs in Chromium.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const loaf = entry as PerformanceEntry & {
            scripts?: Array<{ duration: number; invoker?: string; sourceFunctionName?: string }>;
          };
          let top = '';
          let topDuration = -1;
          for (const script of loaf.scripts ?? []) {
            if (script.duration > topDuration) {
              topDuration = script.duration;
              top = script.invoker || script.sourceFunctionName || '';
            }
          }
          probe.loafs.push({ start: entry.startTime, duration: entry.duration, script: top });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // Long Animation Frame timing is Chromium-only.
    }
  });
}

/**
 * Read the counters and GL probes. Throws when the page was loaded without the flag,
 * unless `optional` (timing mode also measures builds from before the counters); each
 * counter then reads NaN.
 */
export async function readSnapshot(page: Page, optional = false): Promise<Snapshot> {
  return page.evaluate((optional) => {
    const c = window.__protspacePerfCounters;
    const p = window.__perfProbe;
    if ((!c && !optional) || !p) {
      throw new Error('perf counters missing: load the page with ?perfCounters=1');
    }
    const count = (key: string) => c?.[key] ?? NaN;
    return {
      restage: count('restage'),
      restagePos: count('restagePos'),
      restageStyle: count('restageStyle'),
      restageMs: count('restageMs'),
      render: count('render'),
      drawn: count('drawn'),
      processData: count('processData'),
      gridRebuild: count('gridRebuild'),
      legendUpdate: count('legendUpdate'),
      legendRebuild: count('legendRebuild'),
      glIs: p.glIs,
      glSync: p.glSync,
      uploadBytes: p.uploadBytes,
    };
  }, optional);
}

function diff(before: Snapshot, after: Snapshot): Snapshot {
  const out = { ...after };
  for (const key of [...COUNT_KEYS, 'restageMs'] as const) out[key] = after[key] - before[key];
  return out;
}

interface SettleOptions {
  quietMs?: number;
  capMs?: number;
}

/**
 * Defaults for every `settle()`. Timing mode raises the cap: on a large dataset one
 * interaction can keep the main thread busy for seconds.
 */
export const settleDefaults: Required<SettleOptions> = { quietMs: 200, capMs: 3_000 };

/**
 * Wait in the page until the counters and uploaded bytes stay unchanged for at least
 * two animation frames and `quietMs`. Throws at `capMs`: a page that keeps doing work
 * with no input is a render loop or leaked work, never something to wait out.
 */
export async function settle(page: Page, options: SettleOptions = {}): Promise<void> {
  const { quietMs, capMs } = { ...settleDefaults, ...options };
  const result = await page.evaluate(
    ({ quietMs, capMs }) =>
      new Promise<{ ok: boolean; changed: string[] }>((resolve) => {
        const read = (): Record<string, number> => {
          // A build from before the counters settles on the GL probes alone: it still
          // checks its GL handles with `gl.is*` on every render.
          const c = window.__protspacePerfCounters ?? {};
          const p = window.__perfProbe;
          return { ...c, glIs: p?.glIs ?? 0, glSync: p?.glSync ?? 0, up: p?.uploadBytes ?? 0 };
        };
        const start = performance.now();
        let last = read();
        let lastKey = JSON.stringify(last);
        let quietSince = start;
        let quietFrames = 0;
        let changed = new Set<string>();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          resolve({ ok, changed: [...changed] });
        };
        // rAF stops in a hidden page; the timer still fails the wait at the cap.
        setTimeout(() => finish(false), capMs + 500);
        const tick = () => {
          if (done) return;
          const now = performance.now();
          const current = read();
          const key = JSON.stringify(current);
          if (key !== lastKey) {
            changed = new Set(Object.keys(current).filter((k) => current[k] !== last[k]));
            last = current;
            lastKey = key;
            quietSince = now;
            quietFrames = 0;
          } else {
            quietFrames++;
          }
          if (quietFrames >= 2 && now - quietSince >= quietMs) return finish(true);
          if (now - start > capMs) return finish(false);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { quietMs, capMs },
  );
  if (!result.ok) {
    throw new Error(
      `page did not settle within ${capMs} ms; still changing: ${result.changed.join(', ') || '(no frames)'}`,
    );
  }
}

/** Screenshot of the plot, for before/after-reset comparisons. */
async function plotPixels(page: Page): Promise<Buffer> {
  return page.locator('#myPlot').screenshot({ animations: 'disabled', caret: 'hide' });
}

async function proteinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { protein_ids?: string[] } })
      | null;
    return plot?.data?.protein_ids?.length ?? 0;
  });
}

/** Start and stop the frame-gap recorder; only the camera segment arms it. */
async function armFrameGaps(page: Page, on: boolean): Promise<number[] | null> {
  return page.evaluate((arm) => {
    const probe = window.__perfProbe!;
    if (!arm) {
      const frames = probe.frames;
      probe.frames = null;
      return frames;
    }
    const frames: number[] = [];
    probe.frames = frames;
    let last = performance.now();
    const tick = (now: number) => {
      if (probe.frames !== frames) return;
      frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return null;
  }, on);
}

interface TimingContext {
  cdp: CDPSession;
  frameGaps: boolean;
}

async function taskDuration(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export interface SegmentSpec {
  name: string;
  act: () => Promise<void>;
  reset?: () => Promise<void>;
  /** Compare plot pixels before the segment with pixels after its reset. */
  pixels?: boolean;
  /** Keep a screenshot of the plot once `act` settled (timing mode compares builds). */
  capture?: boolean;
  timing?: TimingContext;
}

/**
 * settle → snapshot → act → settle → snapshot → reset → settle, with a pixel
 * round-trip check when asked. Real Playwright input happens inside `act`.
 */
export async function segment(page: Page, spec: SegmentSpec): Promise<SegmentResult> {
  await settle(page);
  const pixelsBefore = spec.pixels ? await plotPixels(page) : null;
  const before = await readSnapshot(page, !!spec.timing);

  let windowStart = 0;
  let busyBefore = 0;
  if (spec.timing) {
    busyBefore = await taskDuration(spec.timing.cdp);
    windowStart = await page.evaluate(() => performance.now());
    if (spec.timing.frameGaps) await armFrameGaps(page, true);
  }

  await spec.act();
  await settle(page);

  let timing: TimingSample | undefined;
  if (spec.timing) {
    const busy = (await taskDuration(spec.timing.cdp)) - busyBefore;
    const frames = spec.timing.frameGaps ? await armFrameGaps(page, false) : null;
    const observed = await page.evaluate((from) => {
      const probe = window.__perfProbe!;
      const events = probe.events.filter((e) => e.start >= from);
      const loafs = probe.loafs.filter((l) => l.start >= from);
      const top = loafs.reduce<{ duration: number; script: string } | null>(
        (best, l) => (!best || l.duration > best.duration ? l : best),
        null,
      );
      return {
        inp: events.reduce((max, e) => Math.max(max, e.duration), 0),
        loaf: top?.duration ?? 0,
        loafScript: top?.script ?? '',
      };
    }, windowStart);
    timing = {
      ...observed,
      busy,
      restageMs: 0,
      p95Frame: frames && frames.length > 1 ? percentile(frames.slice(1), 95) : null,
    };
  }

  const after = await readSnapshot(page, !!spec.timing);
  const delta = diff(before, after);
  let actPixels: Buffer | undefined;
  if (spec.capture) {
    // A gesture can end with the pointer over a protein; its tooltip is not part of the plot.
    await page.mouse.move(0, 0);
    await settle(page);
    actPixels = await plotPixels(page);
  }
  if (timing) timing.restageMs = Number.isNaN(delta.restageMs) ? null : delta.restageMs;

  if (spec.reset) {
    await spec.reset();
    await settle(page);
  }
  const pixelsAfter = pixelsBefore ? await plotPixels(page) : null;
  const pixelsSame = pixelsBefore && pixelsAfter ? pixelsBefore.equals(pixelsAfter) : null;

  return {
    name: spec.name,
    delta,
    drawn: after.drawn,
    proteinCount: await proteinCount(page),
    pixelsSame,
    ...(pixelsSame === false ? { pixelDiff: { before: pixelsBefore!, after: pixelsAfter! } } : {}),
    ...(actPixels ? { actPixels } : {}),
    timing,
  };
}
