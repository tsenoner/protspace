import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const EXPECTED_SCENARIOS = ['annotationChange', 'zoomInOut', 'dragCanvas', 'clickPoint'] as const;
const ITERATIONS = (() => {
  const raw = process.env.PERF_ITERATIONS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();
const SUITE_TIMEOUT_MS = 45 * 60_000;

test.describe('WebGL render perf benchmark (headed)', () => {
  test('downloads a single WebGL perf suite file and validates contents', async ({
    page,
  }, testInfo) => {
    test.setTimeout(SUITE_TIMEOUT_MS);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

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
      timeout: SUITE_TIMEOUT_MS - 60_000,
      predicate: (dl) => dl.suggestedFilename().includes('webgl-perf-suite'),
    });

    // Build the goto URL, optionally scoping to specific datasets
    const rawDatasets = process.env.PERF_DATASETS;
    const datasetsParam =
      rawDatasets && rawDatasets.trim().length > 0
        ? `&webglPerfDatasets=${encodeURIComponent(rawDatasets.trim())}`
        : '';

    await page.goto(`/explore?webglPerf=1&webglPerfIterations=${ITERATIONS}${datasetsParam}`);
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
        scenarios: Array<{ name: string }>;
      }>;
    };
    expect(suite).toBeTruthy();
    expect(typeof suite.createdAt).toBe('string');
    expect(suite.iterations).toBe(ITERATIONS);
    expect(Array.isArray(suite.results)).toBeTruthy();
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

      const scenarioNames = r.scenarios.map((s) => s?.name).filter(Boolean);
      for (const expected of EXPECTED_SCENARIOS) {
        expect(scenarioNames).toContain(expected);
      }
    }

    if (consoleErrors.length || pageErrors.length) {
      console.log('console errors:', consoleErrors);
      console.log('page errors:', pageErrors);
    }

    expect(pageErrors).toEqual([]);
  });
});
