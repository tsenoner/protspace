## 1. Restore the broken interaction coupling

- [x] 1.1 Add `isZoomReady` getter to `PlotInteractionController`, beside the existing
      `mainGroup`/`overlayGroup`/`isBrushing` getters
- [x] 1.2 Add `zoomBy`, `panBy`, `setTransform` to the controller, driving d3's zoom behaviour so
      the node's `__zoom` datum stays authoritative
- [x] 1.3 Add a typed `_interaction()` accessor to `WebglRenderPerfRunner`, plus a
      `_requireInteraction()` that throws rather than letting the zoom sites degrade to `?.`
      no-ops; the controller is `import type`-only because nothing needs the class at runtime
- [x] 1.4 Repoint all five `_zoom`/`_svgSelection` sites: the readiness gate, `_applyZoomScale`,
      `_applyZoomTranslate`, and the guard plus transform-restore in each of `_runZoomInOutScenario`
      and `_runDragCanvasScenario`
- [x] 1.5 Remove the four `@typescript-eslint/no-explicit-any` disables the rewrite makes redundant
- [x] 1.6 Confirm zero remaining `_zoom`/`_svgSelection` references in `webgl-render-perf.ts`

## 2. Lock the coupling with a test

- [x] 2.1 Add `webgl-render-perf.host-contract.test.ts` (jsdom), driving the runner instance the
      host owns rather than a freshly constructed one
- [x] 2.2 Assert the gate resolves against a loaded host
- [x] 2.3 Assert the gate still rejects on a host that never loads
- [x] 2.3a Assert the gate rejects on a fully-loaded host whose interaction layer was never
      initialized — this is the case that makes deleting the drifted condition a non-fix; 2.3
      alone does not, because that host fails the gate on `data` before zoom is ever consulted
- [x] 2.4 Assert the zoom helpers actually move the plot, read back through the controller's public
      `mainGroup` rather than any private field
- [x] 2.5 Verify the test is red on the parent commit and green with the fix

## 3. Remove the tour from the measured window

- [x] 3.1 Seed the tour-completion `storageState` in `perf/playwright.config.ts`, matching the e2e
      config
- [x] 3.2 Verify with a DOM probe that no driver.js element appears during a full run
- [x] 3.3 Verify a normal `/explore` visit still auto-starts the tour
- [x] 3.4 Load each dataset with `source: 'auto'` so the app records it as a demo load rather than a
      user import, keeping `saveLastImportedFile` — a full copy of a 72-145 MB bundle into OPFS,
      awaited before render — out of `loadDurationMs`. Reported from a 1M sweep as eight WebKit
      `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory)`.
      Also stops a run replacing the developer's own persisted dataset

## 4. Make a failing dataset cost only itself

- [x] 4.1 Wrap the per-dataset body of the suite loop in a catch that records
      `{ datasetId, error }` and continues to the next dataset
- [x] 4.2 Emit the results file whenever at least one dataset produced measurements, carrying the
      recorded failures in a top-level `failures` array — kept out of `results` so the plotter does
      not treat a failure as a phantom dataset
- [x] 4.3 Fail loudly when no dataset produced measurements, rather than emitting a file that reads
      as a successful run
- [x] 4.4 Bound every unbounded await in `loadDataset` — the three loader waits plus the bundle
      `fetch` and `arrayBuffer` — so a load that never finalizes fails at its own timeout, naming
      the dataset and the unmet condition
- [x] 4.5 Stop the heap poller on the failure path so it does not outlive its dataset, with the
      `try` opening immediately after the poller so nothing can throw past the stop
- [x] 4.6 Mark the `loaderDone` rejection handled at creation: `data-error` fires an await earlier
      than it is consumed, so its rejection reached a microtask checkpoint unhandled and surfaced as
      a page error, failing the run the per-dataset catch was meant to survive
- [x] 4.7 Confirm `perf/plot_perf_results.py` needs no change: ran it on a mixed success/failure
      file, all plots emitted, no phantom dataset registered

## 5. Stop an empty run passing as green

- [x] 5.1 Assert in `perf/webgl-perf.spec.ts` that no dataset recorded an error, surfacing the
      error text on failure
- [x] 5.2 Assert every expected scenario recorded at least one pass, closing the pre-existing gap
      where an all-timeouts run passed and became NaN bars in the plotter

## 6. Close the review findings

- [x] 6.1 Fence the abandoned load: gate `data-loaded` on `detail.file` object identity and wait on
      `plotElement.data === ourData`, so a load the suite stopped waiting for cannot satisfy the
      next dataset's waits, and stop the sweep on abandonment because the app's load queue
      serializes behind it with no cancel path
- [x] 6.2 Give each dataset one shared `Budget` instead of a fresh timeout per wait, cap it by a
      run budget the spec derives from its own download wait, and emit the results file from a
      watchdog at the run deadline so a stalled sweep is diagnosable rather than an opaque timeout
- [x] 6.3 Keep the suite's own overlay off the canvas for the measured window: no scrim, no
      animation while measuring, card moved out of the plot's centre, input blocking retained
- [x] 6.4 Assert the recorded render pass — by trigger, not by count — in the zoom and pan
      host-contract tests, since a `plot` pass lands in the same frame and would mask a dead
      zoom render path
- [x] 6.5 Make the readiness gate's budget injectable so it inherits the dataset's remaining time
      rather than holding its own ten minutes
- [x] 6.6 Block the Cloudflare Web Analytics beacon during the run. It executes and POSTs inside the
      measured window, and WebKit raises its cross-origin rejection as an uncaught page error, which
      the spec's fail-fast treats as fatal — the sole reason the `safari` project failed every run,
      and therefore why `pnpm perf` with no `--project` always failed
- [x] 6.7 Stop the run leaking its dev server: `gracefulShutdown` with SIGINT, because Playwright
      SIGKILLs its own process group but turbo spawns each task into a new one, so Vite escapes it.
      Also switch to `pnpm dev:app` (the root `dev` script additionally boots the docs server, which
      competes for CPU inside the measured window), pin `cwd`, use `url` over `port`, and pipe stdout
- [x] 6.8 Give each browser its own `outputDir`; the shared one meant a scoped re-run deleted the
      other browsers' results from the previous sweep, before the server had even started
- [x] 6.9 Rewrite the readiness gate predicate-first, like `waitUntil`. Once its budget became the
      dataset's remaining time (6.5) rather than a fixed ten minutes, a `while (elapsed < timeoutMs)`
      head could report "timed out waiting for data to fully load" for a host it never evaluated —
      recording a dataset that had in fact loaded as a failure, which 5.1 then fails the run on
- [x] 6.10 Classify budget expiry as its own error so only an abandoned wait — never a load that
      rejected cleanly — is treated as page-state loss. A drained queue is the survivable
      per-dataset failure section 4 exists for, and must not take the rest of the sweep with it

## 7. Verify

- [x] 7.1 `pnpm test` green across the workspace — 6/6 tasks, core 118 files / 1633 tests
- [x] 7.2 `pnpm precommit` green — the concurrent session's untracked scratch file that used to
      abort the hook is gone and the tree is clean. Every step verified on the final branch:
      `format:check` clean, `quality` (type-check 5/5, knip, knip:dependencies) clean,
      `docs:annotations:check` "up to date", `docs:build` complete
- [x] 7.3 `PERF_DATASETS=5K PERF_ITERATIONS=2 pnpm perf --project=chrome` completes and records real
      passes for all four scenarios — 10.3s, 5181 points
- [x] 7.3a `pnpm perf` with no `--project` passes all three browsers (36-40s), which it had not done
      since the analytics beacon was added
- [x] 7.4 Fault-inject a bad dataset id and confirm the run still emits results for the good
      dataset, records the failure, and fails the spec — 5K survives, spec fails in 10.8s naming it
- [x] 7.4a Fault-inject an exhausted run budget: the file is emitted in 5.3s with the datasets never
      reached recorded as skipped, instead of a 44-minute download timeout naming nothing
- [x] 7.4b Mutation-test both new guarantees: deleting the `isZoomReady` gate condition fails only
      the new readiness control; breaking the deferred render fails only the new render-pass
      assertions (`expected [ 'plot' ] to include 'zoom'`)
- [x] 7.5 CI green on PR #454 — all four checks pass on `ee831e52`: Code Quality Checks 2m10s,
      E2E Tests (Playwright) 9m8s, Build Documentation 36s, Bundle format contract 36s. E2E matters
      here beyond the usual: it is what covers the app still persisting a real user import to OPFS
      after 7.6 changed the benchmark's load kind
- [x] 7.6 Re-verify the benchmark end to end after the demo-load change —
      `PERF_DATASETS=5K PERF_ITERATIONS=2 pnpm perf --project=chrome` passes in 10.4s with 0
      failures and 0 skips, real passes for all four scenarios (annotationChange 4, zoomInOut 4,
      dragCanvas 24, clickPoint 2) at 5181 points, no OPFS error on the console, and port 8080 free
      afterwards. `loadDurationMs` for 5K is 1511ms

## 8. Close out

- [x] 8.1 Reread `proposal.md` and `design.md` against the final diff — corrected: design.md said
      "Two harness defects" while Non-Goals said three and the promised OPFS decision was missing
      entirely; the comparability goal was unqualified though the same document quantifies two
      deliberate breaks; the abandoned-load decision predated `PerfBudgetExpiredError`; the
      inherited-budget/predicate-first lesson was recorded nowhere; the Risk said "a new top-level
      key" when there are two. proposal.md gained the demo-load bullet and the six changed files its
      Impact list had omitted
- [x] 8.2 `openspec archive restore-webgl-perf-harness` as the last commit on the branch, before
      the merge, and confirm the new capability's `## Purpose` is not left as a TBD placeholder
