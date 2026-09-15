import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const EXPECTED_SCENARIOS = ['annotationChange', 'zoomInOut', 'dragCanvas', 'clickPoint'] as const;
const ITERATIONS = (() => {
  const raw = process.env.PERF_ITERATIONS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();
const SUITE_TIMEOUT_MS = 45 * 60_000;
const DOWNLOAD_TIMEOUT_MS = SUITE_TIMEOUT_MS - 60_000;

/**
 * The budget handed to the in-page suite, derived here so the two layers cannot
 * drift apart. The page emits its results file when this expires no matter where
 * its sweep has got to, which is what keeps a stalled run diagnosable: the file
 * names the dataset and the unmet condition, where a download timeout names
 * nothing. The 2-minute margin covers serializing a large results file, the
 * download itself, and page teardown — the page has to WIN this race, not tie it.
 */
const PAGE_RUN_BUDGET_MS = DOWNLOAD_TIMEOUT_MS - 120_000;

test.describe('WebGL render perf benchmark (headed)', () => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // In afterEach, not at the end of the test: these are the only diagnosis a
  // stalled run produces, and every way this test fails — a download that never
  // arrives most of all — used to skip the dump that lived after the download.
  test.afterEach(() => {
    if (consoleErrors.length || pageErrors.length) {
      console.log('console errors:', consoleErrors);
      console.log('page errors:', pageErrors);
    }
    consoleErrors.length = 0;
    pageErrors.length = 0;
  });

  test('downloads a single WebGL perf suite file and validates contents', async ({
    page,
  }, testInfo) => {
    test.setTimeout(SUITE_TIMEOUT_MS);

    // Third-party analytics has no place in a benchmark: `index.html` loads the
    // Cloudflare Web Analytics beacon, which fetches a script and POSTs to
    // /cdn-cgi/rum from inside the window this suite measures. Blocking it is
    // the same call as suppressing the product tour — keep the harness's own
    // noise out of the measurement rather than subtracting it afterwards.
    //
    // It is also the entire reason the `safari` project failed every run: the
    // POST is cross-origin, and WebKit surfaces the rejection as an uncaught
    // page error, which the fail-fast below treats as fatal. Chrome and Firefox
    // report the same failure as a console error only, so only Safari died —
    // after 1.3s, with the reported error pointing at the download wait.
    //
    // A RegExp, not a `(url) => boolean`: Playwright can only push a string or
    // RegExp matcher down into the browser as an interception pattern. A function
    // matcher has to be evaluated in Node, so it registers `**/*` and round-trips
    // EVERY request through the client to be matched — hundreds of them, against
    // an unbundled Vite dev server. The pattern below covers both the script host
    // (`static.cloudflareinsights.com`) and the hyphenated spelling the e2e
    // suite's ignore list also carries.
    await page.route(/cloudflare-?insights\.com/, (route) => route.abort());

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    const firstPageError = new Promise<Error>((resolve) => {
      page.once('pageerror', (err) => resolve(err as Error));
    });

    const downloadPromise = page.waitForEvent('download', {
      timeout: DOWNLOAD_TIMEOUT_MS,
      predicate: (dl) => dl.suggestedFilename().includes('webgl-perf-suite'),
    });

    // Build the goto URL, optionally scoping to specific datasets
    const rawDatasets = process.env.PERF_DATASETS;
    const datasetsParam =
      rawDatasets && rawDatasets.trim().length > 0
        ? `&webglPerfDatasets=${encodeURIComponent(rawDatasets.trim())}`
        : '';

    await page.goto(
      `/explore?webglPerf=1&webglPerfIterations=${ITERATIONS}` +
        `&webglPerfBudgetMs=${PAGE_RUN_BUDGET_MS}${datasetsParam}`,
    );
    await page.bringToFront();

    await Promise.race([
      page.waitForSelector('#myPlot', { timeout: 60_000 }),
      firstPageError.then((err) => {
        throw err;
      }),
    ]);
    await Promise.race([
      page.waitForSelector('#myDataLoader', { timeout: 60_000, state: 'attached' }),
      firstPageError.then((err) => {
        throw err;
      }),
    ]);

    // Best-effort CDP peak-heap poller (Chrome only)
    let polling = true;
    let maxBytes: number | null = null;
    const samples: Array<{ t: number; bytes: number }> = [];
    let cdpPollLoop: Promise<void> = Promise.resolve();

    if (testInfo.project.name === 'chrome') {
      try {
        const client = await page.context().newCDPSession(page);
        await client.send('Performance.enable');

        cdpPollLoop = (async () => {
          while (polling) {
            try {
              const { metrics } = await client.send('Performance.getMetrics');
              const heapUsed = (metrics as Array<{ name: string; value: number }>).find(
                (m) => m.name === 'JSHeapUsedSize',
              )?.value;
              if (typeof heapUsed === 'number') {
                if (maxBytes === null || heapUsed > maxBytes) maxBytes = heapUsed;
                samples.push({ t: Date.now(), bytes: heapUsed });
              }
            } catch {
              // ignore individual poll errors
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          }
        })();
      } catch {
        // CDP not available — skip silently
      }
    }

    const dl = await Promise.race([
      downloadPromise,
      firstPageError.then((err) => {
        throw err;
      }),
    ]);
    const savedTo = testInfo.outputPath(`webgl-perf-suite-${testInfo.project.name}.json`);
    await dl.saveAs(savedTo);

    // Stop CDP poller and write sidecar
    polling = false;
    try {
      await cdpPollLoop;
    } catch {
      // ignore
    }
    if (testInfo.project.name === 'chrome' && maxBytes !== null) {
      try {
        const cdpPath = testInfo.outputPath(`webgl-perf-suite-${testInfo.project.name}-cdp.json`);
        fs.writeFileSync(
          cdpPath,
          JSON.stringify({ peakJSHeapUsedBytes: maxBytes, samples }, null, 2),
        );
        console.log('CDP peak JSHeapUsedSize bytes:', maxBytes);
      } catch {
        // best-effort — never fail the test
      }
    }

    const suite = JSON.parse(fs.readFileSync(savedTo, 'utf-8')) as {
      createdAt: string;
      iterations: number;
      results: Array<{
        dataset: { id: string };
        scenarios: Array<{ name: string; passes: unknown[] }>;
      }>;
      failures?: Array<{ datasetId: string; error: string }>;
      skipped?: Array<{ datasetId: string; reason: string }>;
    };
    expect(suite).toBeTruthy();
    expect(typeof suite.createdAt).toBe('string');
    expect(suite.iterations).toBe(ITERATIONS);
    expect(Array.isArray(suite.results)).toBeTruthy();

    // Before the emptiness check, deliberately. The suite records a failing
    // dataset and carries on, and emits its file even when nothing measured, so
    // the download arriving no longer implies anything succeeded — and when a
    // run stops early, `results` being empty is the SYMPTOM while these two name
    // the cause. Asserting emptiness first would report "expected 0 to be
    // greater than 0" and say nothing about which dataset broke or why.
    const failures = suite.failures ?? [];
    expect(
      failures,
      `datasets failed: ${failures.map((f) => `${f.datasetId}: ${f.error}`).join('; ')}`,
    ).toEqual([]);

    const skipped = suite.skipped ?? [];
    expect(
      skipped,
      `datasets never ran: ${skipped.map((s) => `${s.datasetId} (${s.reason})`).join('; ')}`,
    ).toEqual([]);

    expect((suite.results as unknown[]).length).toBeGreaterThan(0);

    const results = suite.results;
    const datasetIds = results.map((r) => r?.dataset?.id);
    for (const id of datasetIds) {
      expect(typeof id).toBe('string');
      expect((id as string).length).toBeGreaterThan(0);
    }
    expect(new Set(datasetIds).size).toBe(datasetIds.length);

    for (const r of results) {
      expect(r).toBeTruthy();
      expect(Array.isArray(r.scenarios)).toBeTruthy();

      // A scenario whose every `_waitForNextRender` timed out is still emitted,
      // just with no passes at all. Checking names alone would accept that, and
      // the plotter turns it into a NaN mean — a silently missing bar rather
      // than a failure — so require each expected scenario to be present AND to
      // have recorded at least one pass.
      for (const expected of EXPECTED_SCENARIOS) {
        const scenario = r.scenarios.find((s) => s?.name === expected);
        expect(scenario, `${r.dataset?.id} is missing scenario ${expected}`).toBeTruthy();
        expect(
          scenario?.passes?.length ?? 0,
          `${r.dataset?.id} / ${expected} recorded no render passes`,
        ).toBeGreaterThan(0);
      }
    }

    expect(pageErrors).toEqual([]);
  });
});
