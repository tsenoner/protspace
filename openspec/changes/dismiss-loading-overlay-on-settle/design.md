## Context

`loadData` (`apps/web/src/explore/data-renderer.ts`) has one caller, `handleDataLoaded` in
`dataset-controller.ts`. After `loadData` returns, `handleDataLoaded` applies file settings,
point size, EAT state and the dataset name, restores the URL/tooltip view, shows the legacy-bundle
toast, and awaits `markLastLoadStatus('success')`. Its `finally` calls
`loadQueue.resolvePendingLoadFinalization(seq)`, which lets the next queued load start. Today the
overlay is hidden inside `loadData`, before any of that post-load work runs, and it is never
hidden when a load fails.

## Goals / Non-Goals

**Goals:**

- Dismiss the overlay exactly once a load has settled: after the post-load work on success, and at
  once on failure or cancellation.
- Remove the fixed 1.3 s of delay from every large load.
- Give E2E tests one load wait they can trust, based on a signal the product already has.

**Non-Goals:**

- A new public "load settled" API, DOM attribute or event.
- Changing when the product tour starts (800 ms after the first `data-loaded`).
- Changing the perf harness logic.

## Decisions

### Dismiss in `handleDataLoaded`'s `finally`, owned by the running load

The dismissal sits after `markLastLoadStatus` and before `resolvePendingLoadFinalization`, so the
overlay is gone exactly when the load is settled and before a queued load can show its own. It
runs on every path through the `finally` that belongs to the current load, including a `null` or
disposed result from `loadData`. The stale-result early return, which handles a load superseded by
a newer one, does not dismiss: the overlay on screen then belongs to the newer load.

### Dismiss on every error path

`handleDataError` calls `overlayController.update(false)` before it branches, so `AbortError` and
generic failures leave the app usable. The one exception is a persisted (OPFS) dataset that fails
with no newer load queued: the app then clears it and fetches the demo dataset, and the demo load
is only queued once that fetch returns. Dismissing first would leave the page uncovered and the
queue idle for that whole gap, so a file imported in it would run first and then be replaced by
the demo load. That branch keeps the overlay up ("Loading the demo dataset...") and dismisses it
after recovery only when no load is running, which is the case when the demo fetch failed; a demo
load that did start dismisses it itself. When a newer load is already queued, the branch
dismisses before releasing the failed load, as the other branches do.

`handleDataLoaded`'s catch does the same for failures in the post-load work (for example while
"Saving imported dataset..." is shown). A newer queued load shows the overlay again through its
own `data-loading-start`, so an early dismissal cannot hide a later load's progress.

### Synchronous removal

`update(false)` removes the element at once. The fade served only the 800 ms hold's "Ready to
explore!" message; without the hold it delays interaction for nothing, and Playwright counts the
`opacity: 0` element as visible until it is gone.

### E2E waits use overlay removal plus plot data

With dismissal tied to settlement, `#progressive-loading` having count 0 together with the
expected protein count on `#myPlot` is a reliable completion signal. One animation frame after
that covers the scatterplot's point-index rebuild, which runs in a `requestAnimationFrame` after a
data or projection update. Polling every 100 ms bounds the wait's added latency.

## Alternatives rejected

- **A load-state machine** (`data-load-state`, generation counter, outcome and leak-marker
  attributes, an earlier proposal named `speed-up-explore-load-settle`). It covered races the
  queue already serializes, and cost about 1200 lines of spec and design for a fix that needs a
  few moved calls. Rejected as disproportionate.
- **Keep the hold and fade, and skip them under `prefers-reduced-motion` or in tests.** It would
  leave the delay in place for most users and make tests exercise a path users do not take.
- **Keep hiding inside `loadData` and only fix the error path.** Tests would then race the
  post-load work once the fixed delays are gone.

## Risks / Trade-offs

- **Perf baseline shift.** `webgl-perf-suite.ts` still measures until the overlay is removed, so
  `loadDurationMs` now includes post-load work and drops the 1.3 s of delays. Earlier numbers are
  not comparable; record a fresh baseline in the PR.
- **Abrupt disappearance.** The overlay vanishes without a fade. That is acceptable, since the
  plot underneath is already drawn when it does.
