import type { CDPSession, Page } from '@playwright/test';

/**
 * Probes for the perf checks. Two sources, neither tied to a private method name:
 *
 * - core's flag-gated counters (`packages/core/src/utils/perf-counters.ts`), read off
 *   `window.__protspacePerfCounters` when the page URL has `?perfCounters=1`;
 * - wrappers on the public `WebGL2RenderingContext.prototype`, installed by an init
 *   script, which count `gl.is*` calls, synchronous GL reads and the bytes uploaded to
 *   buffers (texture uploads are not counted).
 *
 * The same init script records Event Timing, long animation frames and (while armed)
 * frame gaps, which only timing mode reports.
 */

/** core's work counters (`packages/core/src/utils/perf-counters.ts`), diffed per segment. */
export const CORE_COUNTERS = [
  'restage',
  'restagePos',
  'restageStyle',
  'render',
  'processData',
  'gridRebuild',
  'legendUpdate',
  'legendRebuild',
  'morphFrame',
] as const;
/** Every key of core's counters object: the counts, re-stage time, points last drawn. */
export const CORE_KEYS = [...CORE_COUNTERS, 'restageMs', 'drawn'] as const;
/** The counts of the GL wrappers below. */
export const GL_COUNTERS = ['glIs', 'glSync', 'bufferBytes'] as const;
export type CountKey = (typeof CORE_COUNTERS)[number] | (typeof GL_COUNTERS)[number];

interface Snapshot extends Record<CountKey, number> {
  /** Wall time in re-stages, ms; diffed like the counts. */
  restageMs: number;
  /** Points drawn by the last render: a value, not a count. */
  drawn: number;
}

type Delta = Omit<Snapshot, 'drawn'>;

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
  /** 95th percentile gap between animation frames, ms; only for segments that set `frames`. */
  p95Frame: number | null;
  /** Median gap between those frames, ms. */
  p50Frame: number | null;
}

export interface SegmentResult {
  name: string;
  delta: Delta;
  /** Points drawn by the last render once the segment settled. */
  drawn: number;
  proteinCount: number;
  /** null when the segment does not check pixels. */
  pixelsSame: boolean | null;
  /** Both screenshots when they differ, for the report to attach. */
  pixelDiff?: { before: Buffer; after: Buffer };
  /** The plot once `act` settled, when the spec asked to capture it. */
  actPixels?: Buffer;
  /** Renders in the idle window after `act`, and whether the plot still glides then. */
  idle?: { renders: number; morphing: boolean };
  timing?: TimingSample;
}

interface ProbeState extends Record<(typeof GL_COUNTERS)[number], number> {
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
      bufferBytes: 0,
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
      wrap('bufferData', (args) => (probe.bufferBytes += byteLength(args[1])));
      wrap('bufferSubData', (args) => (probe.bufferBytes += byteLength(args[2])));
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
  return page.evaluate(
    ({ optional, core, gl }) => {
      const c = window.__protspacePerfCounters;
      const p = window.__perfProbe;
      if ((!c && !optional) || !p) {
        throw new Error('perf counters missing: load the page with ?perfCounters=1');
      }
      const snapshot: Record<string, number> = {};
      for (const key of core) snapshot[key] = c?.[key] ?? NaN;
      for (const key of gl) snapshot[key] = p[key];
      return snapshot as unknown as Snapshot;
    },
    { optional, core: CORE_KEYS, gl: GL_COUNTERS },
  );
}

/** The keys of core's counters object, which the counts spec checks against `CORE_KEYS`. */
export async function readCounterNames(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.__protspacePerfCounters ?? {}));
}

function diff(before: Snapshot, after: Snapshot): Delta {
  const delta = {} as Delta;
  for (const key of [...CORE_COUNTERS, ...GL_COUNTERS, 'restageMs'] as const) {
    delta[key] = after[key] - before[key];
  }
  return delta;
}

const QUIET_MS = 200;

/**
 * Wait in the page until the counters and buffer bytes stay unchanged for at least
 * two animation frames and 200 ms. Throws at `capMs`: a page that keeps doing work
 * with no input is a render loop or leaked work, never something to wait out.
 */
export async function settle(page: Page, capMs = 3_000): Promise<void> {
  const result = await page.evaluate(
    ({ quietMs, capMs, gl }) =>
      new Promise<{ ok: boolean; changed: string[] }>((resolve) => {
        const read = (): Record<string, number> => {
          // A build from before the counters settles on the GL probes alone: it still
          // checks its GL handles with `gl.is*` on every render.
          const counts: Record<string, number> = { ...window.__protspacePerfCounters };
          for (const key of gl) counts[key] = window.__perfProbe?.[key] ?? 0;
          return counts;
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
    { quietMs: QUIET_MS, capMs, gl: GL_COUNTERS },
  );
  if (!result.ok) {
    throw new Error(
      `page did not settle within ${capMs} ms; still changing: ${result.changed.join(', ') || '(no frames)'}`,
    );
  }
}

/**
 * Screenshot of the plot, for before/after comparisons, less a 2 px frame: the plot sits at
 * a fractional y, so its 1 px border is anti-aliased across two rows and can differ by a
 * grey level between runs.
 */
async function plotPixels(page: Page): Promise<Buffer> {
  const box = await page.locator('#myPlot').boundingBox();
  if (!box) throw new Error('#myPlot is not visible');
  const clip = { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 };
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
}

async function proteinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { protein_ids?: string[] } })
      | null;
    return plot?.data?.protein_ids?.length ?? 0;
  });
}

/**
 * Start (with the frames to keep) and stop the frame-gap recorder. 'glide' keeps a gap
 * only when the frame that ends it starts with the plot gliding (`data-morphing`).
 */
async function armFrameGaps(page: Page, frames: FrameGaps | null): Promise<number[] | null> {
  return page.evaluate((keep) => {
    const probe = window.__perfProbe!;
    if (!keep) {
      const gaps = probe.frames;
      probe.frames = null;
      return gaps;
    }
    const gaps: number[] = [];
    probe.frames = gaps;
    const plot = document.querySelector('#myPlot');
    let last = performance.now();
    const tick = (now: number) => {
      if (probe.frames !== gaps) return;
      if (keep === 'all' || plot?.hasAttribute('data-morphing')) gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return null;
  }, frames);
}

type FrameGaps = 'all' | 'glide';

interface TimingContext {
  cdp: CDPSession;
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

/**
 * Start recording main-thread time, interactions, long animation frames and, with
 * `frames`, frame gaps. The returned function stops and reads them; `restageMs` comes
 * from the counters.
 */
async function openTimingWindow(
  page: Page,
  { cdp }: TimingContext,
  frames: FrameGaps | undefined,
): Promise<() => Promise<Omit<TimingSample, 'restageMs'>>> {
  const busyBefore = await taskDuration(cdp);
  const windowStart = await page.evaluate(() => performance.now());
  if (frames) await armFrameGaps(page, frames);
  return async () => {
    const busy = (await taskDuration(cdp)) - busyBefore;
    const gaps = frames ? await armFrameGaps(page, null) : null;
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
    return {
      ...observed,
      busy,
      p95Frame: gaps && gaps.length > 1 ? percentile(gaps.slice(1), 95) : null,
      p50Frame: gaps && gaps.length > 1 ? percentile(gaps.slice(1), 50) : null,
    };
  };
}

export interface SegmentSpec {
  name: string;
  /** Real Playwright input; `settle` waits with the segment's cap. */
  act: (settle: () => Promise<void>) => Promise<void>;
  reset?: () => Promise<void>;
  /** Compare plot pixels before the segment with pixels after its reset. */
  pixels?: boolean;
  /** Keep a screenshot of the plot once `act` settled (timing mode compares builds). */
  capture?: boolean;
  /** Then wait this long and count renders: a glide must stop by itself. */
  idleAfterMs?: number;
  /** Timing mode: the frames whose gaps give `p95Frame`. */
  frames?: FrameGaps;
  /**
   * The cap of every settle in the segment, ms. Timing mode raises it: on a large dataset
   * one interaction can keep the main thread busy for seconds.
   */
  capMs?: number;
  timing?: TimingContext;
}

/**
 * settle → snapshot → act → settle → snapshot → reset → settle, with a pixel
 * round-trip check when asked. Real Playwright input happens inside `act`.
 */
export async function segment(page: Page, spec: SegmentSpec): Promise<SegmentResult> {
  const settleSegment = () => settle(page, spec.capMs);
  await settleSegment();
  const pixelsBefore = spec.pixels ? await plotPixels(page) : null;
  const before = await readSnapshot(page, !!spec.timing);
  const closeTiming = spec.timing ? await openTimingWindow(page, spec.timing, spec.frames) : null;

  await spec.act(settleSegment);
  await settleSegment();

  const timed = closeTiming ? await closeTiming() : null;
  const after = await readSnapshot(page, !!spec.timing);
  const delta = diff(before, after);
  let actPixels: Buffer | undefined;
  if (spec.capture) {
    // A gesture can end with the pointer over a protein; its tooltip is not part of the plot.
    await page.mouse.move(0, 0);
    await settleSegment();
    actPixels = await plotPixels(page);
  }
  let idle: SegmentResult['idle'];
  if (spec.idleAfterMs) {
    const start = await readSnapshot(page, !!spec.timing);
    await page.waitForTimeout(spec.idleAfterMs);
    idle = {
      renders: (await readSnapshot(page, !!spec.timing)).render - start.render,
      morphing: await page
        .locator('#myPlot')
        .evaluate((plot) => plot.hasAttribute('data-morphing')),
    };
  }

  if (spec.reset) {
    await spec.reset();
    await settleSegment();
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
    ...(idle ? { idle } : {}),
    timing: timed
      ? { ...timed, restageMs: Number.isNaN(delta.restageMs) ? null : delta.restageMs }
      : undefined,
  };
}
