# Performance checks

Two Playwright modes drive the real Explore UI: annotation switch, projection switch (a glide,
then the same switch under reduced motion, which is instant), legend isolate, camera drag and
wheel, resize, search, import. A third tool, the cross-browser WebGL suite (`pnpm perf:webgl`),
measures render passes per dataset in Chrome, Firefox and Safari; see its section at the end.

| Command            | What it measures            | Browser                   | Gated                  | Time       |
| ------------------ | --------------------------- | ------------------------- | ---------------------- | ---------- |
| `pnpm perf:counts` | work counts per interaction | headless Chromium         | yes, by `budgets.json` | about 20 s |
| `pnpm perf`        | timings per interaction     | headed Chromium, real GPU | no                     | about 50 s |
| `pnpm perf:webgl`  | render passes per dataset   | Chrome, Firefox, Safari   | no                     | minutes    |

Counts do not depend on the machine, so they gate CI. Timings swing about 2× with the power state
(battery, Low Power Mode), so they are only reported, as medians or as ratios between two builds
measured in the same session.

## How it works

Load Explore with `?perfCounters=1`. Core then exposes `window.__protspacePerfCounters`
(`packages/core/src/utils/perf-counters.ts`). Without the flag the counters are `null` and each
call site costs one null check. They count:

| Counter                                 | What                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `restage`, `restagePos`, `restageStyle` | full GPU buffer re-stages (`populateBuffers`), with their parts |
| `restageMs`                             | time spent in those re-stages                                   |
| `render`, `drawn`                       | renderer frames, and the points drawn by the last one           |
| `processData`, `gridRebuild`            | scatter-plot data processing, point-grid rebuilds               |
| `legendUpdate`, `legendRebuild`         | legend item updates and rebuilds                                |

An init script (`apps/web/tests/helpers/perf/probes.ts`) wraps the public
`WebGL2RenderingContext.prototype`, so these need no app code and survive renames:

- `glIs`: `gl.is{Program,Buffer,Texture,VertexArray,Framebuffer}` calls, reported per render;
- `glSync`: `getError`, `getProgramParameter`, `getShaderParameter`, `readPixels`;
- `bufferBytes`: bytes passed to `bufferData` and `bufferSubData`; texture uploads are not counted.

Each segment runs settle → snapshot → act → settle → snapshot → reset → settle. Settling waits
until the counters and buffer bytes stay unchanged for two animation frames and 200 ms, and never
sleeps a fixed time. It fails at 3 s (60 s in timing mode): a page that keeps working with no input
has a render loop or leaked work. Segments that change the view reset it through the UI, and the
plot's pixels before the segment must equal the pixels after the reset.

The segments are listed once, in `apps/web/tests/helpers/perf/scenarios.ts`, with what the checks
need to know about each: whether timing mode can repeat it, which counts follow the number of
frames it spans, and its role in the checks below. Both modes and `pnpm perf --scenarios` use that
list.

## `pnpm perf:counts`

```sh
pnpm perf:counts                                             # builds, then serves this checkout on 8310
PLAYWRIGHT_PORT=8312 pnpm perf:counts                        # the same, on another port
PLAYWRIGHT_BASE_URL=http://localhost:8303 pnpm perf:counts   # against a server you started
```

`pnpm perf:counts` builds this checkout's packages and starts its own Vite server on 8310 (or
`PLAYWRIGHT_PORT`). It never reuses a server, so a dev server from another checkout cannot be
measured by mistake; if the port is taken, the run stops. `pnpm test:e2e` instead starts or reuses
`pnpm dev:app` on 8080, which may be another checkout's server, so it leaves the counts out: the
project is opt-in (`PERF_COUNTS=1`, which the script sets) and refuses a run without its own
server or `PLAYWRIGHT_BASE_URL`.

It runs `apps/web/tests/perf-counts.spec.ts` on the demo bundle
(`apps/web/public/data.parquetbundle`), then imports `apps/web/public/data/phosphatase.parquetbundle`,
which has no legend settings (`import-no-settings`). The e2e CI workflow runs it as its own step,
after the parallel suite. It prints one table, value/budget per cell, with `!` on a cell over
budget:

```
segment            restage  pos  style  render  glIs/r  sync  proc  legU  legR  grid  upload  pixels
annotation-switch  6/6      2/2  6/6    7/7     10/10   0/0   0/0   2/2   2/2   1/1   2.0MB   same
camera             0/0      0/0  0/0    28      10/10   0     0/0   0/0   0/0   0/0   0B/0B   same
```

It fails when:

- a count is above its budget;
- the pixels after a reset differ (both screenshots are attached to the report);
- the camera segment draws fewer points than the dataset has;
- the projection switch draws no glide frame (`morphFrame`), renders during the second after it
  settled, or ends on other pixels than the instant switch; or another segment draws a glide frame;
- a `load` counter reads 0, which means a probe got disconnected;
- the page does not settle.

A count below its budget passes, and the report lists it under "tighten".

### Budgets

`apps/web/tests/perf/budgets.json` is the only place budgets live. `null` means report only. Counts
that follow how many frames a segment spans are `null`: renders, GL sync calls, grid rebuilds and
`gl.is*` calls per render during load and import, renders and GL sync calls during camera moves,
and the renders of the projection glide, one per frame. `scenarios.ts` lists them per segment. Any
count that differed between the three recordings is `null` too, and so is any count the previous
file set to `null`, so a hand-set `null` survives a re-record. Bytes are budgeted only at 0: any
other byte count is a property of the dataset.

To update after a change that lowers, or knowingly raises, a count:

```sh
PERF_UPDATE_BUDGETS=1 pnpm perf:counts   # runs the segments 3 times, writes the max of each count
git diff apps/web/tests/perf/budgets.json
```

Commit the new numbers with the change that caused them. A perf fix lowers its budgets in the same
commit.

## `pnpm perf` (timing mode)

```sh
pnpm perf                                  # build, `vite preview` on 8301, demo bundle, 5 runs
pnpm perf --datasets 40K,7K_toxprot
pnpm perf --datasets 573K_swissprot --runs 3
pnpm perf --datasets /abs/path/other.parquetbundle
pnpm perf --scenarios annotation,camera --cpu 4
```

| Flag                | Default    | Meaning                                                                            |
| ------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `--datasets a,b`    | `default`  | `default` (the demo bundle), a name in `apps/web/public/data/`, or a path          |
| `--scenarios a,b`   | all        | `annotation`, `projection` (both switches), `legend`, `camera`, `resize`, `search` |
| `--runs N`          | 5          | runs per segment; the first is a warm-up and is dropped                            |
| `--cpu N`           | 1          | CPU throttling; 4 makes the demo bundle cost about what a 100K one does            |
| `--url URL`         | own server | measure this server instead of building and serving the app                        |
| `--no-build`        |            | serve the existing `apps/web/dist` without rebuilding                              |
| `--compare URL`     |            | a second build, measured interleaved with the first                                |
| `--save-baseline`   |            | write the medians to `perf/baselines/<dataset>.local.json`                         |
| `--baseline [file]` |            | report against that file, or against `perf/baselines/<dataset>.local.json`         |
| `--trace`           |            | record a DevTools trace per segment under `perf/results/<stamp>-traces/`           |

Without `--url`, `perf/perf.mjs` builds the app and serves it with `vite preview --port 8301
--strictPort`, and stops that server on exit, on failure and on Ctrl-C. It never uses or stops
ports 8080 and 8091.

Per dataset, it imports the bundle through the import control (that import is timed once), then
repeats the segments. It prints one table per dataset and writes every sample to
`perf/results/<stamp>-<dataset>.json` (gitignored):

```
default  runs 4 (+1 warm-up)  cpu 1x  A=:8301  heap 9MB     median
segment            INP ms  LoAF ms  top script   busy ms  restage ms  p95 frame  pixels A=B
annotation-switch  88      58       DIV.onclick  75       46          -          -
camera             40      0        -            87       0           18         -
```

- **INP ms**: the longest Event Timing duration of any interaction in the segment.
- **LoAF ms / top script**: the longest long animation frame, and the script that took most of it.
- **busy ms**: main-thread task time (CDP `TaskDuration`).
- **restage ms**: time inside GPU re-stages, from the counters.
- **p95 frame**: 95th percentile gap between frames: every frame of the camera segment, and the
  frames of the projection glide (while the plot has `data-morphing`), the switch frame included.
- **heap**: JS heap after a forced GC, once the runs are done.

Event Timing and Long Animation Frames exist only in Chromium, so timing mode runs only there.

### 573K example

`pnpm perf --url http://localhost:8422 --datasets 573K_swissprot` takes about 3 minutes, most of
it in the 4 + 1 runs of each segment. On an M-series MacBook on power (2026-10-04):

```
573K_swissprot  runs 4 (+1 warm-up)  cpu 1x  A=:8422  heap 45MB     median
segment            INP ms  LoAF ms  top script                            busy ms  restage ms  p95 frame
import             56      3917     FrameRequestCallback                  6911     6380        -
annotation-switch  2224    2170     DIV.onclick                           2188     2110        -
projection-switch  3104    3046     DIV.onclick                           3065     3009        -
legend-isolate     3288    3230     BUTTON.ondblclick                     3244     3159        -
camera             56      0        -                                     83       0           18
resize             0       1115     ResizeObserverCallback                2237     2159        -
search-select      1152    505      INPUT#protein-search-input.onkeydown  1110     1093        -
```

At this size the re-stage (`restage ms`) is nearly all of each interaction.

### Comparing two builds

Serve each build on its own port, then pass one as `--url` and the other as `--compare`. For
example, `main` from a second worktree against this branch:

```sh
git worktree add ../protspace-main origin/main && (cd ../protspace-main && pnpm install)
(cd ../protspace-main && pnpm turbo run build --filter=@protspace/app \
  && pnpm --filter @protspace/app exec vite preview --port 8302 --strictPort) &
pnpm turbo run build --filter=@protspace/app \
  && (pnpm --filter @protspace/app exec vite preview --port 8301 --strictPort &)
pnpm perf --url http://localhost:8302 --compare http://localhost:8301 --datasets default,40K
```

The runs alternate A, B, A, B in one browser session, so a change in power state hits both builds.
Cells read `A→B ratio`, for example `412→118 .29`. `pixels A=B` compares the plot after each
segment between the two builds; on `DIFF`, both images go to `perf/results/<stamp>-pixels/`.
Compare two production builds (`vite build` + `vite preview`), not a dev server with a build.
A build from before the counters, such as `main` before this tooling, still gets its timings, but
its `restage ms` cells read `-` with no ratio, for example `-→4`.

### Baselines

To compare against an earlier run on the same machine:

```sh
pnpm perf --save-baseline   # on main
pnpm perf --baseline        # on your branch: cells read baseline→now
```

See `baselines/README.md`.

## Files

```
packages/core/src/utils/perf-counters.ts   the flag-gated counters
apps/web/tests/perf-counts.spec.ts         counts gate (opt-in project, PERF_COUNTS=1)
apps/web/tests/perf-timing.spec.ts         timing mode (opt-in project, PERF_TIMING=1)
apps/web/tests/helpers/perf/probes.ts      init script, settle(), segment()
apps/web/tests/helpers/perf/scenarios.ts   the segments
apps/web/tests/helpers/perf/report.ts      budgets and tables
apps/web/tests/perf/budgets.json           budgets
perf/perf.mjs                              `pnpm perf`: flags to PERF_* env, server, Playwright
perf/webgl-perf.spec.ts                    `pnpm perf:webgl`: the cross-browser WebGL suite
perf/playwright.config.ts                  its Playwright config
apps/web/src/perf/webgl-perf-suite.ts      its in-page runner, loaded on `?webglPerf=1`
perf/datasets.manifest.json                the datasets `pnpm perf:fetch` downloads
perf/plot_perf_results.py                  plots of its results
```

## `pnpm perf:webgl` (cross-browser WebGL suite)

### 1. Fetch the datasets

The benchmark does not read anything the app ships. Its bundles are assets of
the `perf-datasets` GitHub release, pinned by id, size and sha256 in
[`datasets.manifest.json`](./datasets.manifest.json). From the **repo root**:

```sh
pnpm perf:fetch                          # all of them into perf/datasets/ (gitignored)
pnpm perf:fetch --only 573K_swissprot    # just the ones you need
```

The fetch verifies every file and fails on a mismatch; a file already there
with the right bytes is kept. The release holds, under their original names,
the eleven bundles the app used to serve from `apps/web/public/data/`, plus the
manuscript's 113K β-lactamase bundle (`beta_lactamase_2026_stats`) and the
832-protein phosphatase EAT bundle (`phosphatase_eat`), so the ids below and the
manuscript's perf protocol keep working whatever the Import menu's examples
become. `apps/protspace/scripts/generate_examples/stage_perf.py`
stages the release and rewrites the manifest; publishing it is the repository
owner's step.

### 2. Run benchmarks

From the **repo root**, run the Playwright-based WebGL performance suite:

```sh
pnpm perf:webgl                        # 10 iterations per scenario (default)
PERF_ITERATIONS=5 pnpm perf:webgl      # override iteration count
```

This launches Chrome, Firefox and Safari headless, so no window takes focus
while it runs; each still renders on the hardware GPU (Chrome through its
`channel: 'chrome'` headless mode, not the SwiftShader headless shell the E2E
suite uses). Set `PERF_HEADED=1` to watch the run in headed windows. It loads every dataset
the manifest marks `"default": true` (the ten of the former
`apps/web/public/data/datasets.json`), and runs the scenarios in the
table below against each one.
The spec serves the in-page suite's `/data/datasets.json` and
`/data/<id>.parquetbundle` requests from the manifest and `perf/datasets/`; a
dataset that was never fetched is recorded under `failures`, naming
`pnpm perf:fetch`, and the rest of the sweep still runs.

The run blocks the Cloudflare Web Analytics beacon that `apps/web/index.html`
loads. It has no place inside a measured window, and its cross-origin POST was
reported by WebKit as an uncaught page error, which made the `safari` project
fail every run. `performance.memory` is Chrome-only, so the heap fields in the
`load` block are `null` on Firefox and Safari.

#### Scoping to specific datasets

Use `PERF_DATASETS` (comma-separated dataset IDs) to benchmark only the
datasets you care about, including the ones outside the default sweep
(`573K_swissprot`, `beta_lactamase_2026_stats`, `phosphatase_eat`). This is
especially useful for the large `573K_swissprot` dataset, which is too slow to
include in every full suite run:

```sh
# Benchmark only the 573K SwissProt dataset, Chrome only
PERF_DATASETS=573K_swissprot pnpm perf:webgl --project=chrome

# Multiple datasets
PERF_DATASETS=573K_swissprot,127K_beta_lactamase pnpm perf:webgl --project=chrome
```

Pass `--project=chrome` directly, with no `--` in front of it. pnpm 10 forwards a
`--` to the script verbatim, so `pnpm perf:webgl -- --project=chrome` reaches Playwright
as a positional test filter instead of a project filter and every browser project
runs.

A dataset ID is a **file name**: the in-page suite loads
`/data/${datasetId}.parquetbundle` (`apps/web/src/perf/webgl-perf-suite.ts`), and
the spec answers it with the manifest entry of that `file`. So
`PERF_DATASETS=573K_swissprot` measures `perf/datasets/573K_swissprot.parquetbundle`;
an id the manifest does not list, such as the ParquetBundle v3 `573K_swissprot_v3`,
answers 404 and is recorded under `failures`.

The spec passes the IDs to the in-page suite via the `webglPerfDatasets` URL
parameter, which overrides the default list.

Dated copies of runs worth comparing against live in `perf/baselines/`; see the
README there.

#### Budgets

The in-page suite runs against two deadlines, so a stalled run produces a
results file naming what broke instead of an opaque Playwright timeout:

| URL parameter              | Default | Meaning                                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `webglPerfBudgetMs`        | 40 min  | Whole run. The results file is emitted when this expires, wherever the sweep has got to; datasets not reached are recorded under `skipped`. |
| `webglPerfDatasetBudgetMs` | 6 min   | One dataset's load path and readiness gate, shared by every wait in it and capped by the run budget.                                        |

`pnpm perf:webgl` derives `webglPerfBudgetMs` from the spec's own download wait, so
the two cannot drift; the defaults above apply only to a hand-typed
`?webglPerf=1` in a browser. Raise both, and `SUITE_TIMEOUT_MS` in
`perf/webgl-perf.spec.ts`, if a legitimately slow sweep needs longer.

| Scenario           | What it measures                                                      |
| ------------------ | --------------------------------------------------------------------- |
| `annotationChange` | Re-render after switching annotations                                 |
| `zoomInOut`        | Zoom-in / zoom-out cycle                                              |
| `zoomFarOut`       | Zoom to the low end of the zoom extent (k = 0.1) and back             |
| `dragCanvas`       | Pan / drag across the canvas, settling after every step               |
| `dragContinuous`   | Sustained drag: one pan per animation frame, never waiting for settle |
| `densityZoom`      | The `zoomInOut` cycle with `densityLayer: 'on'` forced on the plot    |
| `contourDrag`      | `dragContinuous` with `densityLayer: 'on'`                            |
| `clickPoint`       | Select a point by clicking                                            |

Every pass records `durationMs` (CPU submission time: the window around
`render()`, which returns as soon as the commands are queued) and `gpuSyncedMs`
(the same window extended until the GPU has finished, via a one-pixel
`readPixels`). A shader that costs the GPU tens of milliseconds is invisible in
the first and visible in the second. The sync is perf-only: it sits behind the
recording token, so production frames never make the call.

The camera scenarios (`zoomInOut`, `zoomFarOut`, `dragCanvas`, `dragContinuous`,
`densityZoom`, `contourDrag`)
are asserted to upload zero bytes per pass and to draw every point handed to the
renderer. That is the #456 regression gate, and it is machine-independent: the
camera is a shader uniform, so moving it cannot require an upload.

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
`pnpm perf:webgl -- --project=chrome` used to delete the Firefox and Safari results
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

### 3. Generate plots

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
