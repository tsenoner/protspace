import type {
  DataErrorEventDetail,
  DataLoadedEventDetail,
  DataLoader,
  ProtspaceScatterplot,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';

type Args = {
  plotElement: ProtspaceScatterplot;
  dataLoader: DataLoader;
};

type PerfDatasetFailure = {
  datasetId: string;
  error: string;
};

type PerfDatasetSkip = {
  datasetId: string;
  reason: string;
};

type PerfSuiteResult = {
  createdAt: string;
  iterations: number;
  results: unknown[];
  // Datasets that threw, kept OUT of `results` so that array stays homogeneous:
  // plot_perf_results.py yields every entry of `results` as a dataset payload,
  // so a failure record in there would plot as a phantom dataset with empty bars.
  failures: PerfDatasetFailure[];
  // Datasets never attempted. Separate from `failures` so a run that stopped for
  // one cause does not read as N independent failures: the spec reports the one
  // that actually broke, and lists these as consequences.
  skipped: PerfDatasetSkip[];
};

/**
 * Raised when a load is abandoned at its deadline rather than failing cleanly.
 *
 * The distinction is the whole point: a clean failure (bad bundle, data-error)
 * leaves the app's load queue drained and the next dataset can proceed, but a
 * load we merely stopped waiting for is still running. `load-queue.ts` serializes
 * on it with no cancel path, so every later dataset would block behind it — and
 * its late `data-loaded` would land while a *different* dataset is listening.
 */
class PerfPageStateLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerfPageStateLostError';
  }
}

type PerfSuiteGlobalState = typeof globalThis & {
  __protspaceWebglPerfSuiteInFlight?: boolean;
  __protspaceWebglPerfSuiteConsumed?: boolean;
};

type HeapSample = {
  usedBytes: number | null;
  totalBytes: number | null;
  limitBytes: number | null;
};

type LoadMetrics = {
  datasetId: string;
  loadDurationMs: number;
  heapBefore: HeapSample;
  heapAfterLoad: HeapSample;
  heapSteady: HeapSample;
  peakUsedDuringLoadBytes: number | null;
};

const PERF_OVERLAY_ID = 'webgl-perf-suite-overlay';
const PERF_OVERLAY_STYLE_ID = 'webgl-perf-suite-overlay-style';
const PERF_OVERLAY_MEASURING_CLASS = 'perf-suite-measuring';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * An absolute window, not a duration.
 *
 * Every wait in a dataset's load path shares ONE of these. Giving each wait its
 * own duration multiplies the worst case by the number of waits, which is how a
 * single stalled dataset used to outlive the whole harness's budget; sharing a
 * deadline makes a dataset cost at most what it was given.
 */
type Budget = { readonly startedAt: number; readonly endsAt: number; readonly totalMs: number };

/** A window of `totalMs`, never outliving `cap` when one is supplied. */
function budgetFrom(totalMs: number, cap?: Budget): Budget {
  const startedAt = performance.now();
  const endsAt = cap ? Math.min(startedAt + totalMs, cap.endsAt) : startedAt + totalMs;
  return { startedAt, endsAt, totalMs: endsAt - startedAt };
}

function remaining(budget: Budget): number {
  return Math.max(0, budget.endsAt - performance.now());
}

/**
 * A wait that ran out of budget, as opposed to an operation that failed.
 *
 * Its own class because the two demand opposite responses: a clean failure is
 * survivable and the sweep moves on, while a wait we abandoned leaves the app's
 * uncancellable load queue in an unknown state and ends the run. Callers that
 * conflate them lose every remaining dataset to a dataset that merely errored.
 */
class PerfBudgetExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerfBudgetExpiredError';
  }
}

function budgetError(budget: Budget, what: string): PerfBudgetExpiredError {
  const spent = Math.round(performance.now() - budget.startedAt);
  return new PerfBudgetExpiredError(
    `perf: spent ${spent}ms of a ${Math.round(budget.totalMs)}ms budget waiting for ${what}`,
  );
}

/**
 * Predicate first, deadline second — deliberately, not stylistically. With a
 * shared budget the remaining slice is routinely at or near zero by the time a
 * late wait is reached, and a `while (remaining > 0)` head would report a
 * timeout for a condition it never once evaluated.
 */
async function waitUntil(
  predicate: () => boolean,
  budget: Budget,
  what: string,
  intervalMs = 250,
): Promise<void> {
  for (;;) {
    if (predicate()) return;
    const left = remaining(budget);
    if (left <= 0) throw budgetError(budget, what);
    await sleep(Math.min(intervalMs, left));
  }
}

/** Reject when `budget` runs out, if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, budget: Budget, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(budgetError(budget, what)), remaining(budget));
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function readHeap(): HeapSample {
  const mem = (
    performance as unknown as {
      memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
    }
  ).memory;
  return {
    usedBytes: typeof mem?.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null,
    totalBytes: typeof mem?.totalJSHeapSize === 'number' ? mem.totalJSHeapSize : null,
    limitBytes: typeof mem?.jsHeapSizeLimit === 'number' ? mem.jsHeapSizeLimit : null,
  };
}

async function readDatasetList(): Promise<string[]> {
  const fallback = [
    '5K',
    '40K',
    '7K_toxprot',
    '35K_ec_brenda',
    '105K_homoSapiens_drosophilaMelanogaster',
    '127K_beta_lactamase',
    '573K_swissprot',
    'beta_lactamase_ec',
    'beta_lactamase_pn',
    'phosphatase',
  ];

  try {
    const res = await fetch('/data/datasets.json', { cache: 'no-store' });
    if (!res.ok) return fallback;
    const payload = (await res.json()) as unknown;
    if (!Array.isArray(payload)) return fallback;
    const ids = payload.filter((v) => typeof v === 'string' && v.length > 0) as string[];
    return ids.length ? ids : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Fallbacks only. A run driven by the Playwright spec is handed a run budget
 * derived from that spec's own download wait, so the two cannot drift; these
 * apply to a hand-typed `?webglPerf=1` in a browser, where nothing else is
 * imposing a deadline.
 */
const DEFAULT_RUN_BUDGET_MS = 40 * 60_000;
const DEFAULT_DATASET_BUDGET_MS = 6 * 60_000;

function readPositiveIntParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function resolveDatasetList(params: URLSearchParams): Promise<string[]> {
  const raw = params.get('webglPerfDatasets');
  if (raw && raw.length > 0) {
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length > 0) return ids;
  }
  return readDatasetList();
}

function downloadJson(filename: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Two rules here are measurement decisions rather than styling, and both are in
 * the same family as suppressing the driver.js tour — keep the harness's own
 * paint off the canvas rather than subtracting it afterwards. Numbers in
 * `openspec/changes/restore-webgl-perf-harness/design.md`.
 *
 * 1. The overlay is transparent and its card sits in a corner. A full-viewport
 *    scrim makes the compositor blend over the canvas on every frame of the
 *    window this suite exists to measure. It still hit-tests — hit testing uses
 *    the border box, and only pointer-events/visibility/display opt out — so it
 *    keeps swallowing stray clicks during a long headed run.
 * 2. The spinner's animation is parked while measuring. An infinite animation
 *    keeps the compositor producing frames for the whole measured window, and
 *    the perf config runs Chrome with --disable-frame-rate-limit, so that loop
 *    is uncapped. The subtitle carries progress instead.
 *
 * The rationale lives out here, not inside the template literal below: anything
 * in there is string content, shipped in the /explore chunk and re-inserted into
 * document.head on every run.
 */
function ensurePerfOverlayStyles() {
  if (document.getElementById(PERF_OVERLAY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PERF_OVERLAY_STYLE_ID;
  style.textContent = `
    #${PERF_OVERLAY_ID} {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 1rem;
      background: transparent;
      z-index: 99999;
      font-family: system-ui, -apple-system, sans-serif;
    }

    #${PERF_OVERLAY_ID} .perf-suite-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      padding: 1.5rem 2rem;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 14px 40px rgba(15, 23, 42, 0.18);
      text-align: center;
    }

    #${PERF_OVERLAY_ID} .perf-suite-spinner {
      width: 44px;
      height: 44px;
      border: 3px solid rgba(59, 130, 246, 0.2);
      border-top-color: #3b82f6;
      border-radius: 999px;
      animation: perf-suite-spin 1s linear infinite;
    }

    #${PERF_OVERLAY_ID}.${PERF_OVERLAY_MEASURING_CLASS} .perf-suite-spinner {
      animation: none;
      opacity: 0.35;
    }

    #${PERF_OVERLAY_ID} .perf-suite-title {
      font-size: 1rem;
      font-weight: 600;
      color: #0f172a;
    }

    #${PERF_OVERLAY_ID} .perf-suite-subtitle {
      font-size: 0.875rem;
      color: #475569;
      max-width: 360px;
    }

    @keyframes perf-suite-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
  document.head.appendChild(style);
}

function showPerfOverlay() {
  if (document.getElementById(PERF_OVERLAY_ID)) return;
  ensurePerfOverlayStyles();
  const overlay = document.createElement('div');
  overlay.id = PERF_OVERLAY_ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="perf-suite-card">
      <div class="perf-suite-spinner" aria-hidden="true"></div>
      <div class="perf-suite-title">Performance metrics are being gathered</div>
      <div class="perf-suite-subtitle">This might take a couple of minutes.</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function hidePerfOverlay() {
  document.getElementById(PERF_OVERLAY_ID)?.remove();
}

/** Park the spinner animation for the duration of a measured window. */
function setPerfOverlayMeasuring(measuring: boolean) {
  document
    .getElementById(PERF_OVERLAY_ID)
    ?.classList.toggle(PERF_OVERLAY_MEASURING_CLASS, measuring);
}

/** Progress signal, since the parked spinner no longer provides one. */
function setPerfOverlayStatus(text: string) {
  const subtitle = document
    .getElementById(PERF_OVERLAY_ID)
    ?.querySelector<HTMLElement>('.perf-suite-subtitle');
  if (subtitle) subtitle.textContent = text;
}

async function loadDataset(args: Args, datasetId: string, budget: Budget): Promise<LoadMetrics> {
  const url = `/data/${datasetId}.parquetbundle`;

  // Bounded like every other wait in this path: a dev server that accepts the
  // connection and then stalls mid-body would otherwise hang here forever, which
  // is the same undiagnosable "waiting for event download" the waits below exist
  // to avoid — and the bundles are up to ~45 MB, so a stalled body is the likely
  // shape of it.
  //
  // An abort signal rather than the withTimeout race used further down: racing
  // only stops us *waiting*, and a ~45 MB body left streaming keeps buffering
  // through the NEXT dataset's measured load window. One signal covers the
  // response and the body, since arrayBuffer() inherits the request's.
  const transfer = AbortSignal.timeout(remaining(budget));
  let response: Response | undefined;
  let arrayBuffer: ArrayBuffer;
  try {
    response = await fetch(url, { signal: transfer });
    if (!response.ok) {
      throw new Error(`perf: failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    arrayBuffer = await response.arrayBuffer();
  } catch (error) {
    if (!transfer.aborted) throw error;
    throw budgetError(budget, `${datasetId} bundle ${response ? 'body' : 'response'}`);
  }
  const file = new File([arrayBuffer], `${datasetId}.parquetbundle`, {
    type: 'application/octet-stream',
  });

  // Settle briefly then capture baseline heap
  await sleep(50);
  const heapBefore = readHeap();

  // Best-effort polling loop to track peak heap during load
  let polling = true;
  let peakUsedDuringLoadBytes: number | null = null;

  const pollLoop = (async () => {
    while (polling) {
      const sample = readHeap();
      if (sample.usedBytes !== null) {
        if (peakUsedDuringLoadBytes === null || sample.usedBytes > peakUsedDuringLoadBytes) {
          peakUsedDuringLoadBytes = sample.usedBytes;
        }
      }
      await sleep(50);
    }
  })();

  // Torn down in the finally below. Declared out here because only the finally
  // can reach it; everything else lives inside the try, so nothing between the
  // poller's creation and the try can throw past the `polling = false`.
  const listeners = new AbortController();

  let loadDurationMs: number;
  try {
    // Deliberately NOT `{ once: true }`. After an earlier dataset was abandoned
    // at its deadline its load is still queued ahead of us — load-queue.ts
    // serializes with no cancel path — so a foreign `data-loaded` can land
    // first, and a once-listener would be spent on it.
    //
    // `detail.file` is the only field in any of these events that says which
    // load it belongs to, and it is the very File object we hand to
    // loadFromFile, so this compares object identity, not a name that two
    // datasets could share.
    let ourData: VisualizationData | null = null;
    args.dataLoader.addEventListener(
      'data-loaded',
      (event: Event) => {
        const detail = (event as CustomEvent<DataLoadedEventDetail>).detail;
        // `file` is absent on the loadFromUrl path. Nothing else initiates a
        // load while the perf suite owns the page, so an undefined `file` here
        // is a foreign event by definition.
        if (detail?.file !== file) return;
        ourData = detail.data;
      },
      { signal: listeners.signal },
    );

    // `data-error` carries no file, id or sequence at all, so it cannot be
    // attributed to a load. Keep the first one only as an explanation for a
    // missing `data-loaded`; never let it decide the outcome by itself.
    let firstError: Error | null = null;
    args.dataLoader.addEventListener(
      'data-error',
      (event: Event) => {
        const detail = (event as CustomEvent<DataErrorEventDetail>).detail;
        firstError ??= new Error(String(detail?.message ?? 'unknown error'));
      },
      { signal: listeners.signal },
    );

    const t0 = performance.now();
    // Bounded on the dataset's shared budget rather than left open: the loader
    // path has several ways to settle nothing at all — dataset-controller
    // swallows finalization errors, and `loadFromFile` resolves rather than
    // rejects once a load handler is installed — so an unbounded await surfaces
    // only as Playwright's terminal "waiting for event download" tens of minutes
    // later, naming neither dataset nor condition.
    //
    // With the app's queue installed this settles only after THIS file's load
    // has finalized, and data-loaded is dispatched strictly before that. So once
    // it resolves, either `ourData` is set or this dataset's load failed.
    //
    // `source: 'auto'` is what keeps the app's reload-support persistence out of
    // the window being timed. Without it load-queue.ts records the load as
    // `kind: 'user'`, and dataset-controller then awaits `saveLastImportedFile`
    // — a full copy of the bundle into OPFS — BEFORE it renders, i.e. strictly
    // inside `loadDurationMs`. For the probe bundles this sweep exists to find
    // the ceiling with (72-145 MB) that is the dominant term in the number, and
    // on WebKit the write itself fails: eight `UnknownError: The operation
    // failed for an unknown transient reason (e.g. out of memory)` in one run.
    // It also silently replaced whatever dataset the developer had persisted for
    // reload with the last one the benchmark happened to load.
    //
    // Marking the load `auto` rather than teaching the app about benchmarks
    // keeps this at the harness layer, the same call as the tour suppression.
    // The only other effects are wanted here: each dataset starts from cleared
    // legend state instead of inheriting the previous one's, and the URL's
    // stale-tooltip rewrite (a user-import concern) is skipped.
    try {
      await withTimeout(
        args.dataLoader.loadFromFile(file, { source: 'auto' }),
        budget,
        `${datasetId} to load`,
      );
    } catch (error) {
      // Only a budget expiry means the load is still running. Anything else is a
      // rejection from the load itself, which leaves the queue drained — exactly
      // the survivable failure the per-dataset catch exists for — so it must not
      // be relabelled as page-state loss and take the rest of the sweep with it.
      if (!(error instanceof PerfBudgetExpiredError)) throw error;
      throw new PerfPageStateLostError(
        `${error.message} ` +
          `(load abandoned, not cancelled: the app's load queue has no cancel path, ` +
          `so page state is indeterminate from here)`,
      );
    }

    if (!ourData) {
      throw firstError ?? new Error(`perf: ${datasetId} finalized without a data-loaded event`);
    }

    // Replaces a bare `data-change` wait. `data-change` is dispatched from five
    // sites in scatter-plot.ts with no load identity, so it cannot say WHICH
    // dataset rendered. The app assigns `plotElement.data` the very object the
    // loader emitted (data-renderer.ts) and the plot never reassigns it, so this
    // identity check is exact — and it is a positive check for OUR data rather
    // than a check that some data arrived.
    await waitUntil(
      () => args.plotElement.data === ourData,
      budget,
      `${datasetId} to become the rendered dataset`,
    );
    await waitUntil(
      () => !document.getElementById('progressive-loading'),
      budget,
      `${datasetId} progressive-loading overlay to clear`,
    );

    loadDurationMs = performance.now() - t0;
  } finally {
    listeners.abort();
    // Stop the heap poller on the failure path too, or it outlives this dataset
    // and keeps sampling through every subsequent one.
    polling = false;
    await pollLoop;
  }

  const heapAfterLoad = readHeap();
  await sleep(300);
  const heapSteady = readHeap();

  return {
    datasetId,
    loadDurationMs,
    heapBefore,
    heapAfterLoad,
    heapSteady,
    peakUsedDuringLoadBytes,
  };
}

export async function maybeRunWebglPerfSuite(args: Args): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('webglPerf') !== '1') return false;

  const g = globalThis as PerfSuiteGlobalState;
  if (g.__protspaceWebglPerfSuiteInFlight || g.__protspaceWebglPerfSuiteConsumed) return true;
  g.__protspaceWebglPerfSuiteInFlight = true;
  showPerfOverlay();

  const iterations = readPositiveIntParam(params, 'webglPerfIterations', 10);
  const runBudgetMs = readPositiveIntParam(params, 'webglPerfBudgetMs', DEFAULT_RUN_BUDGET_MS);
  const datasetBudgetMs = readPositiveIntParam(
    params,
    'webglPerfDatasetBudgetMs',
    DEFAULT_DATASET_BUDGET_MS,
  );

  let emitted = false;
  try {
    const datasets = await resolveDatasetList(params);
    const runBudget = budgetFrom(runBudgetMs);
    const createdAt = new Date().toISOString();
    const results: unknown[] = [];
    const failures: PerfDatasetFailure[] = [];
    const skipped: PerfDatasetSkip[] = [];

    const emitSuite = () => {
      if (emitted) return;
      emitted = true;
      const suite: PerfSuiteResult = { createdAt, iterations, results, failures, skipped };
      downloadJson(`protspace-webgl-perf-suite-${createdAt.split(':').join('-')}.json`, suite);
    };

    const skipFrom = (from: number, reason: string) => {
      for (const datasetId of datasets.slice(from)) skipped.push({ datasetId, reason });
    };

    // Hoisted out of the `for` head so the watchdog below reads the dataset
    // currently being attempted rather than a hand-synced copy of it — `let` in
    // the head would give each iteration its own binding.
    let index = 0;

    // The guarantee that makes a stalled run diagnosable: the file is emitted at
    // the run deadline no matter where the sweep has got to. Checking the budget
    // only between datasets would still let the LAST dataset overrun past the
    // harness's download wait, which is exactly how a broken run used to report
    // nothing but "waiting for event download".
    const watchdog = setTimeout(() => {
      skipFrom(index, `run budget of ${runBudgetMs}ms expired before this dataset completed`);
      console.error(`perf: run budget of ${runBudgetMs}ms expired; emitting partial results`);
      emitSuite();
    }, remaining(runBudget));

    try {
      for (; index < datasets.length; index++) {
        if (emitted) break;
        const datasetId = datasets[index];

        if (remaining(runBudget) <= 0) {
          skipFrom(index, `run budget of ${runBudgetMs}ms exhausted before this dataset started`);
          break;
        }

        // Per dataset, so one failure costs its own results and nothing else. The
        // run is a sweep over increasingly large bundles looking for the point at
        // which rendering gives out; the dataset that finds it is expected to
        // fail, and losing every smaller dataset's measurements with it would
        // discard exactly the data the sweep exists to collect.
        //
        // One shared window per dataset, capped by what is left of the run, so
        // the load path cannot multiply its budget by the number of waits in it.
        const datasetBudget = budgetFrom(datasetBudgetMs, runBudget);
        try {
          setPerfOverlayStatus(`Loading ${datasetId} (${index + 1}/${datasets.length})…`);
          const loadMetrics = await loadDataset(args, datasetId, datasetBudget);

          setPerfOverlayStatus(`Measuring ${datasetId} (${index + 1}/${datasets.length})…`);
          setPerfOverlayMeasuring(true);
          const result = await args.plotElement.runWebGLRenderPerfMeasurements(iterations, {
            download: false,
            dataset: { id: datasetId, url: `/data/${datasetId}.parquetbundle` },
            // The gate inherits what this dataset has left rather than its own
            // ten minutes, which would otherwise outlive the window it runs in.
            readyTimeoutMs: remaining(datasetBudget),
          });
          if (!result) {
            throw new Error(`perf: no result for dataset ${datasetId}`);
          }
          results.push({ ...(result as Record<string, unknown>), load: loadMetrics });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`perf: dataset ${datasetId} failed:`, error);
          failures.push({ datasetId, error: message });

          // A load we merely stopped waiting for is still running, and the app's
          // queue serializes every later load behind it with no cancel path. So
          // the rest of the sweep cannot load anything: it would spend each
          // dataset's full budget reaching the same deadline, and the abandoned
          // load's late events would land while another dataset is listening.
          // Stop and say so, rather than sweeping an hour into a run whose
          // numbers could no longer be trusted anyway.
          if (error instanceof PerfPageStateLostError) {
            skipFrom(
              index + 1,
              `page state indeterminate after ${datasetId} was abandoned mid-load`,
            );
            break;
          }
        } finally {
          // Also covers the paths that never reached the measured window:
          // toggling a class off an element that never had it is a no-op.
          setPerfOverlayMeasuring(false);
        }
      }
    } finally {
      clearTimeout(watchdog);
    }

    if (results.length === 0) {
      // Emitted anyway, rather than thrown. The file is the diagnosis — it names
      // every failure and every skip — and the spec fails the run on it in
      // seconds (it asserts results is non-empty). Throwing here instead skips
      // the download and leaves the harness waiting out its full download budget
      // before reporting nothing but a timeout.
      console.error(
        `perf: no dataset produced measurements (${datasets.length} attempted): ` +
          failures.map((f) => `${f.datasetId}: ${f.error}`).join('; '),
      );
    }

    emitSuite();
  } finally {
    g.__protspaceWebglPerfSuiteInFlight = false;
    // Consumed once a file has been emitted: the page has said everything it is
    // going to, success or not, and must not start the sweep over.
    if (emitted) g.__protspaceWebglPerfSuiteConsumed = true;
    hidePerfOverlay();
  }

  return true;
}
