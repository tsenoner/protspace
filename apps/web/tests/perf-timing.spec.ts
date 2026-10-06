import {
  test,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  segment,
  type SegmentResult,
  type SegmentSpec,
  type TimingSample,
} from './helpers/perf/probes';
import {
  formatTimingTable,
  gitHead,
  timingMedians,
  type TimingMedians,
  type TimingRow,
} from './helpers/perf/report';
import {
  buildSegments,
  importBundle,
  newPerfContext,
  openExplore,
  readExploreState,
  repeatableSegments,
} from './helpers/perf/scenarios';

/**
 * Timing mode: headed Chromium on the real GPU, started by `pnpm perf` (perf/perf.mjs),
 * which passes its flags as PERF_* variables. Per dataset it imports the bundle into one
 * page per build, then repeats the segments PERF_RUNS times and reports medians, the
 * first run being a warm-up. With two URLs the builds run interleaved (A, B, A, B, …).
 *
 * Nothing here is gated: timings swing with the machine's power state. Counts are
 * gated by perf-counts.spec.ts.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'perf', 'results');
const BASELINES_DIR = path.join(REPO_ROOT, 'perf', 'baselines');

interface Dataset {
  name: string;
  file: string;
}

const env = process.env;
const DATASETS: Dataset[] = JSON.parse(env.PERF_DATASETS ?? '[]');
const URLS = (env.PERF_URLS ?? '').split(',').filter(Boolean);
const SCENARIOS = repeatableSegments((env.PERF_SCENARIOS ?? '').split(',').filter(Boolean));
const RUNS = Math.max(2, Number(env.PERF_RUNS ?? 5));
const CPU = Math.max(1, Number(env.PERF_CPU ?? 1));
const TRACE = env.PERF_TRACE === '1';
const SAVE_BASELINE = env.PERF_SAVE_BASELINE === '1';
/** A file to compare against, or `default` for perf/baselines/<dataset>.local.json. */
const BASELINE = env.PERF_BASELINE ?? '';
const STAMP = env.PERF_STAMP ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
/** Wall-clock work on a large dataset can keep the page busy for seconds. */
const SETTLE_CAP_MS = 60_000;

interface Target {
  label: string;
  url: string;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  segments: Array<Omit<SegmentSpec, 'timing'>>;
  /** Measured samples per segment; the warm-up run is not in here. */
  samples: Record<string, TimingSample[]>;
  restages: Record<string, number[]>;
  /** Plot pixels once each segment's action settled, from the first measured run. */
  pixels: Record<string, Buffer>;
  heapMB: number;
}

interface Baseline {
  dataset: string;
  recordedAt: string;
  cpu: number;
  segments: Record<string, TimingMedians>;
  heapMB: number;
}

const baselineFile = (dataset: string) =>
  BASELINE && BASELINE !== 'default'
    ? path.resolve(BASELINE)
    : path.join(BASELINES_DIR, `${dataset}.local.json`);

function hostPort(url: string): string {
  const u = new URL(url);
  return u.hostname === 'localhost' ? `:${u.port}` : u.host;
}

async function timed(
  browser: Browser,
  target: Target,
  spec: Omit<SegmentSpec, 'timing'>,
  traceName: string,
): Promise<SegmentResult> {
  const tracePath = path.join(RESULTS_DIR, `${STAMP}-traces`, `${traceName}.json`);
  if (TRACE) {
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    await browser.startTracing(target.page, { path: tracePath, screenshots: false });
  }
  try {
    return await segment(target.page, {
      ...spec,
      capMs: SETTLE_CAP_MS,
      timing: { cdp: target.cdp },
    });
  } finally {
    if (TRACE) await browser.stopTracing();
  }
}

async function openTarget(
  browser: Browser,
  label: string,
  url: string,
  dataset: Dataset,
): Promise<Target> {
  const context = await newPerfContext(browser, url);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await openExplore(page, url);
  const target: Target = {
    label,
    url,
    context,
    page,
    cdp,
    segments: [],
    samples: {},
    restages: {},
    pixels: {},
    heapMB: 0,
  };
  // The import is the setup, and timed once.
  const imported = await timed(
    browser,
    target,
    { name: 'import', act: () => importBundle(page, dataset.file), capture: true },
    `${dataset.name}-${label}-import`,
  );
  record(target, imported, true);
  const state = await readExploreState(page);
  target.segments = buildSegments(page, state, dataset.file).filter((def) =>
    SCENARIOS.includes(def.name),
  );
  return target;
}

function record(target: Target, result: SegmentResult, keepPixels: boolean): void {
  (target.samples[result.name] ??= []).push(result.timing!);
  (target.restages[result.name] ??= []).push(result.delta.restage);
  if (keepPixels && result.actPixels) target.pixels[result.name] = result.actPixels;
}

async function heapMB(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const bytes = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
  return Math.round(bytes / 1024 / 1024);
}

const mediansOf = (target: Target) =>
  Object.fromEntries(
    Object.entries(target.samples).map(([name, samples]) => [name, timingMedians(samples)]),
  );

test.describe.configure({ mode: 'serial' });

for (const dataset of DATASETS) {
  test(`timing ${dataset.name}`, async ({ browser }, testInfo) => {
    test.setTimeout(60 * 60_000);
    const labels = ['A', 'B'];
    const targets: Target[] = [];
    try {
      for (const [i, url] of URLS.entries()) {
        targets.push(await openTarget(browser, labels[i], url, dataset));
      }
      for (let run = 0; run < RUNS; run++) {
        for (const target of targets) {
          await target.page.bringToFront();
          for (const def of target.segments) {
            const result = await timed(
              browser,
              target,
              { ...def, capture: run === 1 && targets.length > 1 },
              `${dataset.name}-${target.label}-${def.name}-${run}`,
            );
            if (run > 0) record(target, result, run === 1);
          }
        }
      }
      for (const target of targets) target.heapMB = await heapMB(target.cdp);
    } finally {
      for (const target of targets) await target.context.close();
    }

    const [a, b] = targets;
    const aMedians = mediansOf(a);
    const bMedians = b ? mediansOf(b) : null;
    let baseline: Baseline | null = null;
    if (!b && BASELINE) {
      const file = baselineFile(dataset.name);
      if (fs.existsSync(file)) baseline = JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline;
      else console.warn(`no baseline at ${file}; record one with --save-baseline`);
    }

    const order = ['import', ...a.segments.map((s) => s.name)];
    const rows: TimingRow[] = order.map((name) => {
      if (b) {
        const pa = a.pixels[name];
        const pb = b.pixels[name];
        const same = pa && pb ? pa.equals(pb) : null;
        if (same === false) {
          const dir = path.join(RESULTS_DIR, `${STAMP}-pixels`);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${dataset.name}-${name}-A.png`), pa!);
          fs.writeFileSync(path.join(dir, `${dataset.name}-${name}-B.png`), pb!);
        }
        return { segment: name, a: aMedians[name], b: bMedians![name], pixelsAB: same };
      }
      if (baseline?.segments[name]) {
        return { segment: name, a: baseline.segments[name], b: aMedians[name] };
      }
      return { segment: name, a: aMedians[name] };
    });
    const heap = b ? `heap A ${a.heapMB}MB B ${b.heapMB}MB` : `heap ${a.heapMB}MB`;
    const reference = b ? 'median (B/A)' : baseline ? 'median (now/baseline)' : 'median';
    const title = [
      dataset.name,
      `runs ${RUNS - 1} (+1 warm-up)`,
      `cpu ${CPU}x`,
      ...targets.map((t) => `${t.label}=${hostPort(t.url)}`),
      ...(baseline ? [`baseline ${baseline.recordedAt}`] : []),
      heap,
      '   ' + reference,
    ].join('  ');
    const table = formatTimingTable(title, rows);
    console.log(`\n${table}\n`);

    const head = gitHead();
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const resultsFile = path.join(RESULTS_DIR, `${STAMP}-${dataset.name}.json`);
    const body = {
      dataset,
      head,
      runs: RUNS,
      cpu: CPU,
      targets: targets.map((t) => ({
        label: t.label,
        url: t.url,
        heapMB: t.heapMB,
        medians: mediansOf(t),
        restages: t.restages,
        samples: t.samples,
      })),
      baseline: baseline ? baselineFile(dataset.name) : null,
      table,
    };
    fs.writeFileSync(resultsFile, `${JSON.stringify(body, null, 2)}\n`);
    await testInfo.attach(`perf-timing-${dataset.name}.json`, {
      path: resultsFile,
      contentType: 'application/json',
    });
    console.log(`results: ${path.relative(REPO_ROOT, resultsFile)}`);

    if (SAVE_BASELINE) {
      const file = baselineFile(dataset.name);
      const saved: Baseline = {
        dataset: dataset.name,
        recordedAt: head,
        cpu: CPU,
        segments: aMedians,
        heapMB: a.heapMB,
      };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
      console.log(`baseline: ${path.relative(REPO_ROOT, file)}`);
    }
  });
}
