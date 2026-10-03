## Why

The E2E suite is CPU-bound at two workers, and 57% of all test-seconds go to
`waitForExploreDataLoad` and its copies. Much of that is fixed delays the product adds to every
load:

- For more than 1000 proteins, `loadData` holds a "Ready to explore!" step for 800 ms after the
  last render step, then the overlay fades for 500 ms before it is removed. Playwright counts the
  `opacity: 0` element as visible, so every load wait pays the full 1.3 s, and most helpers poll
  every 500 ms on top of that.
- For 1000 proteins or fewer, the overlay is dismissed at the start of `loadData`, before
  rendering, so the user can interact with a plot that is still being drawn.

The overlay is also dismissed in the wrong place. `loadData` hides it before `handleDataLoaded`
applies file settings, the dataset name, the URL/tooltip view restore, and
`markLastLoadStatus('success')`. Nothing hides it when a load fails: `handleDataError` never
dismisses the overlay that `data-loading-start` showed, so importing a corrupt `.parquetbundle`
leaves a full-screen, `z-index: 9999` overlay over the app until the page is reloaded
(reproduced on `main`). The `dataset-reload` test "queued user imports win over corrupted OPFS
fallback recovery" hits this and burns a 30 s timeout on every run, hidden by a
`.catch(() => {})`.

CI context: this branch already split the E2E workflow by browser. `playwright install
--with-deps chromium firefox webkit` pulled about 180 apt packages (125 MB, almost all WebKit's
GStreamer/GTK4 stack) on every run, and when the Azure Ubuntu mirror stalled, that step alone took
19 min (run 36728112695) and 31 min (run 34576016462). With the split, the Chromium job runs no
apt step; its test step took 331 s and the workflow 376 s. The load waits are now the largest
remaining cost.

The user approved removing both fixed delays for every user.

## What Changes

- **Dismiss the overlay on failure.** `handleDataError` dismisses the overlay first, on every
  branch including `AbortError`, and `handleDataLoaded`'s catch path dismisses it too. A failed
  persisted dataset that falls back to the demo dataset keeps it up through the demo fetch, so
  nothing can be imported in that gap and then be overwritten by the demo load. A newer
  queued load shows it again through its own `data-loading-start`.
- **Dismiss the overlay once a load has settled.** `loadData` no longer touches the overlay's
  visibility after rendering starts. `handleDataLoaded` dismisses it in its `finally`, after the
  post-load work and `markLastLoadStatus`, and before `resolvePendingLoadFinalization` lets the
  next queued load start. A stale result that returns early leaves the running load's overlay
  alone.
- **No fixed hold, no fade.** The 800 ms hold and its "Ready to explore!" step are deleted.
  `update(false)` removes the overlay element synchronously, and the removal timer goes.
- **One set of E2E load helpers.** `apps/web/tests/helpers/explore.ts` provides
  `waitForExploreDataLoad(page, { timeout, proteinCount?, changedFrom? })`, and
  `waitForProteinCount(page, n)` as its exact-count form. It waits for plot data, then for
  `#progressive-loading` to be gone, without swallowing the timeout, polls every 100 ms, and
  waits one animation frame before returning so the scatterplot has rebuilt its point index.
  Local copies and `polling: 500` waits across `apps/web/tests` move to it.
- **Stable CI comments.** The hard-coded test counts in `e2e.yml` are reworded so they do not
  go stale.

## Capabilities

### New Capabilities

- `explore-loading-overlay`: when the Explore loading overlay is dismissed (after a successful
  load has settled, on failure, on cancellation), that a completed load is not held behind a
  fixed delay, and that dismissal removes the element synchronously.

### Modified Capabilities

- `e2e-validation`: "Conditional cleanup and polling are bounded" forbids discarding a required
  wait's failure. New requirements cover how Explore load waits decide that a load is complete
  and how CI provisions browsers per job.

## Impact

- `apps/web/src/explore/data-renderer.ts`: the hold, the 100% step and both overlay hides are
  removed.
- `apps/web/src/explore/dataset-controller.ts`: dismissal in `handleDataError`, in
  `handleDataLoaded`'s catch, and in its `finally` when the call owns the running load.
- `apps/web/src/explore/loading-overlay.ts`: synchronous removal; `overlayRemovalTimeout` is
  deleted.
- `apps/web/tests/`: `helpers/explore.ts` and the specs that kept their own load waits.
- `.github/workflows/e2e.yml`: comment wording only.
- `apps/web/src/perf/webgl-perf-suite.ts`: no code change. It still waits for the overlay to be
  removed, so `loadDurationMs` now includes the post-load work and no longer includes the 1.3 s
  of delays. Earlier baselines are not comparable; take a fresh one.
- The product tour still starts 800 ms after the first `data-loaded` event; that is unchanged.
- Frontend only. No change to the bundle format, the Python package, the URL state or the public
  component API.
