import { expect, test, type Browser } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segment, type SegmentResult } from './helpers/perf/probes';
import {
  checkBudgets,
  formatCountsTable,
  readBudgets,
  recordBudgets,
  type BudgetsFile,
} from './helpers/perf/report';
import {
  DEFAULT_BUNDLE,
  buildSegments,
  measureLoad,
  openExplore,
  readExploreState,
} from './helpers/perf/scenarios';
import { tourCompletedStorageState } from './helpers/tour-storage-state';

/**
 * Deterministic work counts per interaction, gated by `perf/budgets.json`.
 *
 * Counts, not timings: how many times an interaction re-stages the GPU buffers,
 * renders, rebuilds the legend or calls `gl.is*` does not depend on the machine or
 * on SwiftShader, so it can gate CI. Timings live in `perf-timing.spec.ts`.
 *
 * `PERF_UPDATE_BUDGETS=1` records three runs and writes the max of each count.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUDGETS_FILE = path.join(HERE, 'perf', 'budgets.json');
const UPDATE = process.env.PERF_UPDATE_BUDGETS === '1';
const RUNS = UPDATE ? 3 : 1;

async function runOnce(browser: Browser, baseUrl: string): Promise<SegmentResult[]> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    storageState: tourCompletedStorageState(baseUrl),
  });
  try {
    const page = await context.newPage();
    await openExplore(page, baseUrl);
    const load = await measureLoad(page);
    const results: SegmentResult[] = [
      {
        name: 'load',
        delta: load,
        drawn: load.drawn,
        proteinCount: 0,
        pixelsSame: null,
      },
    ];
    const state = await readExploreState(page);
    for (const def of buildSegments(page, state, DEFAULT_BUNDLE)) {
      results.push(await segment(page, def));
    }
    return results;
  } finally {
    await context.close();
  }
}

/** Checks that hold whatever the budgets say. */
function invariants(results: SegmentResult[]): string[] {
  const failures: string[] = [];
  const load = results.find((r) => r.name === 'load')!;
  // A probe a refactor disconnected reads zero, which would pass every budget.
  const live = [
    'restage',
    'restagePos',
    'restageStyle',
    'render',
    'processData',
    'gridRebuild',
    'legendUpdate',
    'legendRebuild',
  ] as const;
  for (const key of live) {
    if (load.delta[key] <= 0) failures.push(`load.${key} is 0: the counter is disconnected`);
  }
  if (load.delta.uploadBytes <= 0) failures.push('load.uploadBytes is 0: the GL probe is off');
  for (const result of results) {
    if (result.pixelsSame === false) failures.push(`${result.name}: pixels differ after reset`);
  }
  const camera = results.find((r) => r.name === 'camera');
  if (camera && camera.drawn !== camera.proteinCount) {
    failures.push(`camera: drew ${camera.drawn} of ${camera.proteinCount} points`);
  }
  return failures;
}

test('perf counts per interaction stay within budget', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(RUNS * 120_000);
  const runs: SegmentResult[][] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runOnce(browser, baseURL!));

  const previous = fs.existsSync(BUDGETS_FILE) ? readBudgets(BUDGETS_FILE) : null;
  let budgets: BudgetsFile | null = previous;
  if (UPDATE) {
    const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    budgets = recordBudgets(runs, previous, head);
    fs.writeFileSync(BUDGETS_FILE, `${JSON.stringify(budgets, null, 2)}\n`);
  }

  const results = runs[runs.length - 1];
  const check = budgets ? checkBudgets(results, budgets) : { failures: [], tighten: [] };
  const report = [
    formatCountsTable(results, budgets),
    ...(check.tighten.length ? ['', `below budget (tighten): ${check.tighten.join('; ')}`] : []),
  ].join('\n');
  console.log(`\n${report}\n`);
  await testInfo.attach('perf-counts.json', {
    body: JSON.stringify(
      { budgets, runs },
      (key, value) => (key === 'pixelDiff' ? undefined : value),
      2,
    ),
    contentType: 'application/json',
  });
  for (const result of results) {
    if (!result.pixelDiff) continue;
    for (const [when, body] of Object.entries(result.pixelDiff)) {
      const file = testInfo.outputPath(`${result.name}-${when}.png`);
      fs.writeFileSync(file, body);
      await testInfo.attach(`${result.name}-${when}.png`, { path: file, contentType: 'image/png' });
    }
  }

  expect(invariants(results), report).toEqual([]);
  if (!UPDATE) {
    expect(budgets, `no ${BUDGETS_FILE}; record it with PERF_UPDATE_BUDGETS=1`).not.toBeNull();
    expect(check.failures, report).toEqual([]);
  }
});
