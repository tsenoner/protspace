import { expect, test, type Browser } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_COUNTERS,
  CORE_KEYS,
  readCounterNames,
  segment,
  type SegmentResult,
} from './helpers/perf/probes';
import {
  checkBudgets,
  formatCountsTable,
  gitHead,
  readBudgets,
  recordBudgets,
  type BudgetsFile,
} from './helpers/perf/report';
import {
  DEFAULT_BUNDLE,
  buildSegments,
  measureLoad,
  newPerfContext,
  openExplore,
  readExploreState,
  segmentTraits,
} from './helpers/perf/scenarios';

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

interface Run {
  results: SegmentResult[];
  /** The keys of core's counters object in the page. */
  counterNames: string[];
}

async function runOnce(browser: Browser, baseUrl: string): Promise<Run> {
  const context = await newPerfContext(browser, baseUrl);
  try {
    const page = await context.newPage();
    await openExplore(page, baseUrl);
    const results = [await measureLoad(page)];
    const counterNames = await readCounterNames(page);
    const state = await readExploreState(page);
    for (const def of buildSegments(page, state, DEFAULT_BUNDLE)) {
      results.push(await segment(page, def));
    }
    return { results, counterNames };
  } finally {
    await context.close();
  }
}

/** Checks that hold whatever the budgets say. */
function invariants({ results, counterNames }: Run): string[] {
  const failures: string[] = [];
  // A counter missing from probes.ts is read by no check; one core lacks reads NaN,
  // which passes every check.
  const listed: readonly string[] = CORE_KEYS;
  for (const name of counterNames.filter((n) => !listed.includes(n))) {
    failures.push(`core counter ${name} is not in probes.ts CORE_COUNTERS`);
  }
  for (const name of listed.filter((n) => !counterNames.includes(n))) {
    failures.push(`probes.ts lists ${name}, which core does not count`);
  }
  const load = results.find((r) => segmentTraits(r.name).bumpsAllCounters)!;
  // A probe a refactor disconnected reads zero, which would pass every budget. The load
  // draws no glide frame; the glide checks below cover `morphFrame`.
  for (const key of CORE_COUNTERS) {
    if (key !== 'morphFrame' && load.delta[key] <= 0) {
      failures.push(`${load.name}.${key} is 0: the counter is disconnected`);
    }
  }
  if (load.delta.bufferBytes <= 0) {
    failures.push(`${load.name}.bufferBytes is 0: the GL probe is off`);
  }
  for (const result of results) {
    if (result.pixelsSame === false) failures.push(`${result.name}: pixels differ after reset`);
    if (segmentTraits(result.name).drawsAll && result.drawn !== result.proteinCount) {
      failures.push(`${result.name}: drew ${result.drawn} of ${result.proteinCount} points`);
    }
  }
  // Only a projection switch glides, and the glide stops by itself.
  const glide = results.find((r) => segmentTraits(r.name).glides);
  for (const result of results) {
    if (result !== glide && result.delta.morphFrame !== 0) {
      failures.push(`${result.name}: ${result.delta.morphFrame} glide frames`);
    }
  }
  if (glide) {
    if (!(glide.delta.morphFrame > 0)) failures.push(`${glide.name}: drew no glide frame`);
    if (glide.idle?.renders) {
      failures.push(`${glide.name}: ${glide.idle.renders} renders while idle after the glide`);
    }
    if (glide.idle?.morphing) failures.push(`${glide.name}: still data-morphing when idle`);
  }
  const twin = twinPixels(results);
  if (twin && !twin.same) {
    failures.push(`${twin.glide.name}: the glide ends on other pixels than ${twin.instant.name}`);
  }
  return failures;
}

/** The plot after the glide and after the reduced-motion instant switch to the same projection. */
function twinPixels(results: SegmentResult[]) {
  const glide = results.find((r) => segmentTraits(r.name).glides);
  const instant = results.find((r) => segmentTraits(r.name).glideTwin);
  if (!glide?.actPixels || !instant?.actPixels) return null;
  return { glide, instant, same: glide.actPixels.equals(instant.actPixels) };
}

test('perf counts per interaction stay within budget', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(RUNS * 120_000);
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runOnce(browser, baseURL!));
  const recorded = runs.map((run) => run.results);

  const previous = fs.existsSync(BUDGETS_FILE) ? readBudgets(BUDGETS_FILE) : null;
  let budgets: BudgetsFile | null = previous;
  if (UPDATE) {
    budgets = recordBudgets(recorded, previous, gitHead());
    fs.writeFileSync(BUDGETS_FILE, `${JSON.stringify(budgets, null, 2)}\n`);
  }

  const last = runs[runs.length - 1];
  const { results } = last;
  const check = budgets ? checkBudgets(results, budgets) : { failures: [], tighten: [] };
  const report = [
    formatCountsTable(results, budgets),
    ...(check.tighten.length ? ['', `below budget (tighten): ${check.tighten.join('; ')}`] : []),
  ].join('\n');
  console.log(`\n${report}\n`);
  await testInfo.attach('perf-counts.json', {
    body: JSON.stringify(
      { budgets, runs: recorded },
      (key, value) => (key === 'pixelDiff' || key === 'actPixels' ? undefined : value),
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
  const twin = twinPixels(results);
  if (twin && !twin.same) {
    for (const [name, body] of [
      [`${twin.glide.name}-glide`, twin.glide.actPixels!],
      [twin.instant.name, twin.instant.actPixels!],
    ] as const) {
      const file = testInfo.outputPath(`${name}.png`);
      fs.writeFileSync(file, body);
      await testInfo.attach(`${name}.png`, { path: file, contentType: 'image/png' });
    }
  }

  expect(invariants(last), report).toEqual([]);
  if (!UPDATE) {
    expect(budgets, `no ${BUDGETS_FILE}; record it with PERF_UPDATE_BUDGETS=1`).not.toBeNull();
    expect(check.failures, report).toEqual([]);
  }
});
