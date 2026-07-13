import type { DataErrorEventDetail, DataLoader, ProtspaceScatterplot } from '@protspace/core';

type Args = {
  plotElement: ProtspaceScatterplot;
  dataLoader: DataLoader;
};

type PerfSuiteResult = {
  createdAt: string;
  iterations: number;
  results: unknown[];
};

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error('perf: timeout');
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

function ensurePerfOverlayStyles() {
  if (document.getElementById(PERF_OVERLAY_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PERF_OVERLAY_STYLE_ID;
  style.textContent = `
    #${PERF_OVERLAY_ID} {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.86);
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

async function loadDataset(args: Args, datasetId: string, timeoutMs: number): Promise<LoadMetrics> {
  const url = `/data/${datasetId}.parquetbundle`;

  const dataChange = new Promise<void>((resolve) => {
    args.plotElement.addEventListener('data-change', () => resolve(), { once: true });
  });

  const loaderDone = new Promise<void>((resolve, reject) => {
    args.dataLoader.addEventListener('data-loaded', () => resolve(), { once: true });
    args.dataLoader.addEventListener(
      'data-error',
      (event: Event) => {
        const detail = (event as CustomEvent<DataErrorEventDetail>).detail;
        reject(new Error(String(detail?.message ?? 'unknown error')));
      },
      { once: true },
    );
  });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`perf: failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
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

  const t0 = performance.now();
  await args.dataLoader.loadFromFile(file);
  await loaderDone;
  await dataChange;

  await waitUntil(() => !!args.plotElement.data?.protein_ids?.length, timeoutMs);
  await waitUntil(() => !document.getElementById('progressive-loading'), timeoutMs);

  const loadDurationMs = performance.now() - t0;

  // Stop poller and wait for it to finish
  polling = false;
  await pollLoop;

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

  const iterations = (() => {
    const raw = params.get('webglPerfIterations');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
  })();

  let success = false;
  try {
    const datasets = await resolveDatasetList(params);
    const timeoutMs = 12 * 60_000;
    const createdAt = new Date().toISOString();
    const results: unknown[] = [];

    for (const datasetId of datasets) {
      const loadMetrics = await loadDataset(args, datasetId, timeoutMs);

      const result = await args.plotElement.runWebGLRenderPerfMeasurements(iterations, {
        download: false,
        dataset: { id: datasetId, url: `/data/${datasetId}.parquetbundle` },
      });
      if (!result) {
        throw new Error(`perf: no result for dataset ${datasetId}`);
      }
      results.push({ ...(result as Record<string, unknown>), load: loadMetrics });
    }

    const suite: PerfSuiteResult = {
      createdAt,
      iterations,
      results,
    };

    const safeCreatedAt = createdAt.split(':').join('-');
    downloadJson(`protspace-webgl-perf-suite-${safeCreatedAt}.json`, suite);
    success = true;
  } finally {
    g.__protspaceWebglPerfSuiteInFlight = false;
    if (success) g.__protspaceWebglPerfSuiteConsumed = true;
    hidePerfOverlay();
  }

  return true;
}
