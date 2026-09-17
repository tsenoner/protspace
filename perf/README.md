## Performance benchmarking & plotting

### 1. Run benchmarks

From the **repo root**, run the Playwright-based WebGL performance suite:

```sh
pnpm perf                        # 10 iterations per scenario (default)
PERF_ITERATIONS=5 pnpm perf      # override iteration count
```

This launches headed browsers (Chrome, Firefox, Safari), loads every dataset
listed in `apps/web/public/data/datasets.json`, and runs four scenarios per dataset.

The run blocks the Cloudflare Web Analytics beacon that `apps/web/index.html`
loads. It has no place inside a measured window, and its cross-origin POST was
reported by WebKit as an uncaught page error, which made the `safari` project
fail every run. `performance.memory` is Chrome-only, so the heap fields in the
`load` block are `null` on Firefox and Safari.

#### Scoping to specific datasets

Use `PERF_DATASETS` (comma-separated dataset IDs) to benchmark only the
datasets you care about. This is especially useful for the large `573K_swissprot`
dataset, which is too slow to include in every full suite run:

```sh
# Benchmark only the 573K SwissProt dataset, Chrome only
PERF_DATASETS=573K_swissprot pnpm perf -- --project=chrome

# Multiple datasets
PERF_DATASETS=573K_swissprot,127K_beta_lactamase pnpm perf -- --project=chrome
```

The spec passes the IDs to the in-page suite via the `webglPerfDatasets` URL
parameter, which overrides the default `datasets.json` list.

#### Budgets

The in-page suite runs against two deadlines, so a stalled run produces a
results file naming what broke instead of an opaque Playwright timeout:

| URL parameter              | Default | Meaning                                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `webglPerfBudgetMs`        | 40 min  | Whole run. The results file is emitted when this expires, wherever the sweep has got to; datasets not reached are recorded under `skipped`. |
| `webglPerfDatasetBudgetMs` | 6 min   | One dataset's load path and readiness gate, shared by every wait in it and capped by the run budget.                                        |

`pnpm perf` derives `webglPerfBudgetMs` from the spec's own download wait, so
the two cannot drift; the defaults above apply only to a hand-typed
`?webglPerf=1` in a browser. Raise both, and `SUITE_TIMEOUT_MS` in
`perf/webgl-perf.spec.ts`, if a legitimately slow sweep needs longer.

| Scenario           | What it measures                      |
| ------------------ | ------------------------------------- |
| `annotationChange` | Re-render after switching annotations |
| `zoomInOut`        | Zoom-in / zoom-out cycle              |
| `dragCanvas`       | Pan / drag across the canvas          |
| `clickPoint`       | Select a point by clicking            |

Each browser produces a JSON file under its own directory in
`perf/test-results/` (Playwright names the inner directory after the test, so
the exact name tracks the test title):

```
perf/test-results/
  chrome/
    webgl-perf-…-chrome/
      webgl-perf-suite-chrome.json
      webgl-perf-suite-chrome-cdp.json
  firefox/
    webgl-perf-…-firefox/
      webgl-perf-suite-firefox.json
  safari/
    webgl-perf-…-safari/
      webgl-perf-suite-safari.json
```

The per-browser split matters: Playwright deletes the output directory of every
_selected_ project when a run starts, so with one shared directory
`pnpm perf -- --project=chrome` used to delete the Firefox and Safari results
from the previous full run, and the plotter would then quietly draw
single-browser charts. The plotter searches recursively, so it needs no change.

A completed run prints `[WebServer] @protspace/app:dev: ELIFECYCLE Command
failed.` just before its result line. That is the dev server reacting to the
`SIGINT` Playwright sends to shut it down, not a test failure — read the
`N passed` line below it. The signal is what stops the server leaking the port
into the next run; see the `gracefulShutdown` comment in `playwright.config.ts`.

Each JSON contains per-dataset, per-scenario render-pass timings, dataset
metadata (point count), and browser/hardware metadata collected at runtime, in a
top-level `results` array.

Datasets that did not produce measurements are recorded beside `results`, never
inside it, under two further top-level arrays:

| Key        | Holds                                                    |
| ---------- | -------------------------------------------------------- |
| `failures` | `{ datasetId, error }` for each dataset that threw       |
| `skipped`  | `{ datasetId, reason }` for each dataset never attempted |

They sit outside `results` because `plot_perf_results.py` yields every member of
`results` as a dataset payload — a failure record in there would plot as a
phantom dataset with empty bars. The spec fails the run on either array being
non-empty and prints its contents, so a partial sweep still names what broke.

The run loads every dataset as a _demo_ load, so it neither writes the bundle to
OPFS nor replaces whatever dataset you had persisted for reload. That also keeps
the persist — a full copy of a bundle, awaited before render — out of
`loadDurationMs`; before this, load timings included it and WebKit failed the
write outright on large bundles.

#### Per-dataset `load` metrics and CDP heap sidecar

Each per-dataset result now includes a `load` block:

```json
{
  "dataset": { "id": "573K_swissprot", ... },
  "scenarios": [...],
  "load": {
    "datasetId": "573K_swissprot",
    "loadDurationMs": 4321.5,
    "heapBefore":    { "usedBytes": 45000000, "totalBytes": 60000000, "limitBytes": 4294705152 },
    "heapAfterLoad": { "usedBytes": 312000000, "totalBytes": 380000000, "limitBytes": 4294705152 },
    "heapSteady":    { "usedBytes": 290000000, "totalBytes": 360000000, "limitBytes": 4294705152 },
    "peakUsedDuringLoadBytes": 325000000
  }
}
```

- `heapBefore` / `heapAfterLoad` / `heapSteady` — in-page `performance.memory`
  samples (bytes). Chrome is launched with `--enable-precise-memory-info` so
  these are byte-accurate rather than bucketed.
- `peakUsedDuringLoadBytes` — best-effort in-page poll max during the load
  window (50 ms intervals; may miss synchronous-decode peaks).
- A `*-cdp.json` sidecar file is written alongside the main JSON for Chrome
  runs. It contains the out-of-process `JSHeapUsedSize` peak sampled via the
  Chrome DevTools Protocol every ~200 ms:

```
perf/test-results/webgl-perf-suite-chrome/
  webgl-perf-suite-chrome.json
  webgl-perf-suite-chrome-cdp.json   <-- { peakJSHeapUsedBytes, samples: [{t, bytes}] }
```

The CDP sidecar is best-effort and is silently skipped on Firefox and Safari.

### 2. Generate plots

#### Setup (kept entirely in `perf/`)

From the repo root:

1. Create/sync a venv under `perf/.venv` (managed by uv):

```sh
cd perf
uv sync
```

#### Plot generation

From `perf/`:

```sh
uv run python plot_perf_results.py                          # auto-detect machine info for subtitle
uv run python plot_perf_results.py --subtitle "My Machine"  # manual subtitle override
uv run python plot_perf_results.py --input test-results --output plots
```

| Flag         | Default        | Description                                            |
| ------------ | -------------- | ------------------------------------------------------ |
| `--input`    | `test-results` | Directory containing the perf JSON files               |
| `--output`   | `plots`        | Directory to write generated plot images               |
| `--subtitle` | _(auto)_       | Plot subtitle; auto-detects CPU, GPU, and RAM if unset |

The subtitle auto-detection works cross-platform (macOS, Linux, Windows) and
produces a string like `Apple M1 Max | 64 GB`. On machines where CPU and GPU
share the same chip name (e.g. Apple Silicon), the GPU is deduplicated.

#### What gets generated

The script reads all JSON files from `--input` and writes to `--output`:

**Grouped bar charts** (one per scenario):

- x-axis: datasets (sorted by point count)
- one bar per browser
- error bars: 95% CI of the mean (normal approx; CI = 1.96 \* SEM)

**Scatter plots** (one per scenario):

- x-axis: dataset size (number of points / proteins)
- y-axis: mean render time per pass (ms)
- points colored by browser, with 95% CI error bars
- per-browser linear regression line

Each chart is saved as both `.png` (200 dpi) and `.svg`.
