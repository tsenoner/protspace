## Why

`pnpm perf` has produced no results since `fee47903` (2026-06-21). The B8 interaction-layer
extraction moved `_zoom` and `_svgSelection` off the scatter-plot host into
`PlotInteractionController`; the perf runner reaches the host through an `as any` cast, so both
silently became `undefined`. Nothing failed at build time — the benchmark just stopped producing
data, and every run spun ~10 minutes before dying on `timed out waiting for data to fully load`.

This is the second drift of the same readiness gate (`7b7683a7` repaired `_plotData` in May), and
`pnpm perf` runs in no CI workflow, so nothing catches the next one. Measuring the point ceiling
above Swiss-Prot scale is blocked on the harness working — and on it surviving a dataset that
fails, which is the expected outcome when probing for a ceiling.

## What Changes

- Give `PlotInteractionController` the public API the benchmark needs — `isZoomReady`, `zoomBy`,
  `panBy`, `setTransform` — and route the perf runner's five `_zoom`/`_svgSelection` sites through
  a typed accessor. The issue reported only the readiness gate; the same fields are also read by
  both zoom helpers and by a guard plus a transform-restore in each of the zoomInOut and dragCanvas
  scenarios, so a gate-only fix trades a hang for an immediate throw.
- Gate readiness on `isZoomReady` rather than on the controller being non-null: the host assigns
  the controller one statement before calling `initialize()`, which is what wires zoom up.
- Suppress the product tour during benchmark runs via `storageState`, matching the e2e config.
  The tour auto-starts on the same `data-loaded` event the benchmark drives and is never
  dismissed, so driver.js composited a dimming overlay over the canvas for the whole measured
  window — inflating results (5K: clickPoint 28.35ms → 7.00ms, zoomInOut 1.75ms → 1.17ms). Apply
  the same rule to the suite's own progress overlay, which was a full-viewport translucent scrim
  with an infinite spinner over the plot for the entire measured window — a larger confound than
  the tour (5K, 10 iterations, Chrome: zoomInOut 2.7 → 0.7ms, dragCanvas 2.9 → 0.9ms).
- Capture per-dataset failures instead of discarding the whole run. The suite loops datasets with
  no per-dataset catch and downloads only after the loop completes, so one throw loses every
  already-measured dataset and yields zero output.
- Bound every wait in the dataset load path on one budget shared per dataset, capped by a run
  budget the spec derives from its own download wait, so a load that never finalizes fails with a
  diagnosable error instead of hanging until the 44-minute download timeout — and emit the results
  file at the run deadline wherever the sweep has got to.
- Fence an abandoned load off from the datasets that follow it. Bounding a wait stops the suite
  waiting but does not stop the load, and the app's load queue serializes behind it with no cancel
  path, so its late completion would otherwise satisfy the next dataset's waits and mis-attribute
  that dataset's measurements.
- Add a jsdom regression test asserting the runner's observable contract with its host, so the
  next extraction fails in CI rather than silently — including the render pass a zoom or pan
  records, not only the transform it leaves behind.
- Strengthen spec validation so a run whose scenarios recorded nothing cannot pass as green.
- Load each dataset as a demo load rather than a user import, so the app's reload-support
  persistence stays out of the measured window. `saveLastImportedFile` copies the whole bundle into
  OPFS and is awaited before render, i.e. strictly inside `loadDurationMs` — 72–145 MB per dataset at
  probe sizes, which a 1M sweep reported as eight WebKit `UnknownError` write failures. It also
  stopped a run replacing whatever dataset the developer had persisted for reload.

## Capabilities

### New Capabilities

- `webgl-perf-harness`: what the WebGL render benchmark guarantees — that it reaches a genuine
  ready state before measuring, that it measures through the real interaction path, that a
  failing dataset degrades to a recorded error rather than losing the run, and that its results
  are distinguishable from an empty run.

### Modified Capabilities

<!-- None. `e2e-validation` explicitly scopes performance tooling out of itself: "tight
     performance thresholds SHALL live in dedicated performance tooling" (spec.md:91), so its
     tour-suppression requirement binds the correctness suite, not perf/. -->

## Impact

- `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts` — four new
  public members; no behavior change for existing callers.
- `packages/core/src/components/scatter-plot/webgl-render-perf.ts` — five rewritten call sites, a
  typed controller accessor, four `no-explicit-any` disables removed, and an injectable readiness
  budget (`PerfRunOptions.readyTimeoutMs`) so the gate inherits its caller's deadline.
- `packages/core/src/components/scatter-plot/webgl-render-perf.host-contract.test.ts` — new; runs
  in the existing `pnpm test:ci` gate on every frontend PR.
- `apps/web/src/perf/webgl-perf-suite.ts` — per-dataset error capture, shared per-dataset budgets,
  a run-deadline watchdog that always emits the results file, load-identity fencing, budget expiry
  as its own error type so only an abandoned wait ends the sweep, datasets loaded as demo loads so
  no OPFS copy lands inside the measured window, and an overlay that no longer paints or animates
  over the canvas while measuring.
- `packages/core/src/components/scatter-plot/scatter-plot.ts` — the public
  `runWebGLRenderPerfMeasurements` signature now takes `PerfRunOptions` instead of a hand-copied
  option bag. Type-only.
- `packages/core/src/components/control-bar/types.ts` — drops a dead
  `runWebGLRenderPerfMeasurements` member from `ScatterplotElementLike`; it had no callers and its
  inline option bag was a second declaration of `PerfRunOptions` to keep in step.
- `apps/web/tests/helpers/tour-storage-state.ts` — new; the tour-completion `storageState` seed,
  shared by both Playwright configs so the key and the origin it is scoped to cannot drift apart.
- `apps/web/src/tour/storage-key.ts` — new; a leaf module holding `TOUR_STORAGE_KEY` so the app that
  writes the key and the harness that seeds it share one definition. `product-tour.ts` imports
  driver.js and its CSS, so a Playwright config cannot import from it directly.
- `apps/web/src/tour/product-tour.ts`, `apps/web/tests/playwright.config.ts` — import the shared key
  and the shared seed respectively. Same `'driver.overviewTour'` value as before.
- `perf/playwright.config.ts` — tour-completion `storageState`; a `webServer` block that no longer
  leaks its dev server (`gracefulShutdown` with SIGINT, since turbo spawns tasks into a process
  group Playwright's SIGKILL does not reach), starts only the app rather than the app plus the docs
  server, and pipes stdout; per-project `outputDir` so a scoped re-run stops deleting other
  browsers' results; and a project timeout that no longer contradicts the spec's own.
- `perf/webgl-perf.spec.ts` — assertions that a captured error, a skipped dataset and an empty run
  all fail; the page budget derived from the download wait; diagnostics dumped in `afterEach` so a
  run that never downloads still reports its console and page errors; and the Cloudflare Web
  Analytics beacon blocked, which both removes a request from the measured window and repairs the
  `safari` project — and with it `pnpm perf` run with no `--project`, which had been failing
  outright since the beacon was added.
- `perf/README.md` — the two new budget parameters, the beacon blocking, the per-project output
  layout, the `failures`/`skipped` arrays, the expected `ELIFECYCLE` line on a clean shutdown, and a
  note that a run neither writes bundles to OPFS nor replaces the developer's persisted dataset.
- Results-file shape gains top-level `failures` and `skipped` arrays. `results` itself is
  unchanged, so `perf/plot_perf_results.py` needs no modification.
- No product behavior changes. No PyPI release: `protspace-release.yml` is path-filtered to
  `apps/protspace/**`, which this change does not touch.
