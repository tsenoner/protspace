## Context

`WebglRenderPerfRunner` lives in `packages/core` and drives the scatter-plot it benchmarks through
an `as any` cast on its host (`_hostAny()`), reaching ~16 private members. That coupling is
invisible to TypeScript, ESLint and Knip, so any refactor that relocates a member breaks the
benchmark silently. It has now happened twice: `f75bcd86` reshaped `_plotData` (repaired same-day by
`7b7683a7`, because someone was running the benchmark), and `fee47903` moved `_zoom` and
`_svgSelection` into `PlotInteractionController` (not repaired, because nobody ran it — `pnpm perf`
is in no CI workflow).

The failure mode is the problem as much as the break. The gate is a conjunction of reach-ins whose
only failure signal is silent falsiness, so it spins to a 10-minute timeout and reports "timed out
waiting for data to fully load" — a message that names none of the seven things it was waiting on.

The suite around it compounds this: `apps/web/src/perf/webgl-perf-suite.ts` loops datasets with no
per-dataset catch and downloads only after the loop, so any single throw discards the whole run.
That matters most in exactly the scenario the harness is wanted for — probing the point ceiling with
progressively larger synthetic bundles, where the largest dataset is expected to fail.

## Goals / Non-Goals

**Goals:**

- Restore the benchmark to producing results, at every site the extraction broke — not only the one
  the issue reported.
- Make readiness mean what it says: gate on a predicate the interaction layer vouches for.
- Keep the zoom/pan scenarios measuring the same _operation_ as before the F-07 extraction. (Not the
  same absolute numbers: removing the overlay scrim and the OPFS write deliberately lowers both
  interaction timings and `loadDurationMs`. See Risks.)
- Let a failing dataset cost its own results and nothing else.
- Fail loudly and specifically where the harness previously hung or silently degraded.
- Leave a test that fails in CI on the next occurrence of this class of break.

**Non-Goals:**

- Eliminating the reach-in coupling wholesale. A fully typed `WebglRenderPerfHost` bridge for all
  ~16 members is the durable fix for _name_ drift, but it is a larger refactor than restoring the
  benchmark warrants, and it cannot catch _semantic_ drift (a bridge method that keeps type-checking
  while returning null). Deferred; the regression test covers values in the meantime.
- The remaining harness defects found while auditing: `plot_perf_results.py` ingesting the CDP
  sidecar as a phantom browser, the 2s dead wait after each scenario, and clickPoint measuring
  app-level click side effects. Each is a separate follow-up; none makes the benchmark hang or
  lose data.

  Three items originally deferred here were promoted into this change once diagnosed, because they
  do lose data: the leaked dev server (which blocks the _next_ run outright), the shared
  `outputDir` (which deletes a previous sweep's results), and the OPFS write inside the measured
  load window (which corrupts `loadDurationMs` and, on WebKit at probe-bundle sizes, fails
  outright). See Decisions.

- Adding `pnpm perf` to CI. It needs a headed GPU browser and real bundles; the unit-level
  regression test is what belongs in CI.

## Decisions

**Add behaviour methods to the controller, not accessors for its d3 internals.**
Exposing `get zoom()` / `get svgSelection()` would be the same reach-in with a nicer name: it
re-exports two objects whose _pairing_ is an invariant — d3 keeps the live transform in `__zoom` on
the node the behaviour was `.call()`-installed on — and hands back exactly the coupling the F-07
extraction removed. `isZoomReady` / `zoomBy` / `panBy` / `setTransform` encode the pairing once,
keep the null guard in one place, and drop four `no-explicit-any` disables. `setTransform` is barely
new surface: `resetZoom()` is already that call wrapped in a 750ms transition.

**Drive d3's behaviour, never `applyZoom()`.**
`applyZoom()` writes the transform back to the host and re-renders, but never updates `__zoom`.
Routing the scenarios through it would look equivalent and be wrong twice over: the node's datum
would desync so the next real gesture jumps, and the measured render would come from the wrong
trigger path. Because `selection.call(f, ...args)` is defined as `f(selection, ...args)`, calling
the behaviour directly is exactly what the pre-refactor code did, so baselines stay comparable.

**Gate on `isZoomReady`, not on the controller being non-null.**
Three independent reasons the weaker check is wrong: the host assigns the controller one statement
before calling `initialize()`; `initialize()` returns early when the host has no SVG and nothing
retries it; and `disconnectedCallback` tears down without nulling the field. Deliberately _not_ a
"torn down" flag — teardown leaves zoom installed and functional, so such a flag would report
not-ready for a working controller and could reintroduce the hang on any DOM move.

**Keep every overlay off the canvas, the harness's own included.**
`storageState` seeding the tour's completion key is what the e2e config already does; the perf
config never got it. This keeps application code free of any branch on a benchmark concern and
suppresses the tour _before first paint_, rather than dismissing it after it has already painted and
animated. `openspec/specs/e2e-validation/spec.md` scopes performance tooling out of itself ("tight
performance thresholds SHALL live in dedicated performance tooling"), so this is new behavior for
the perf harness rather than a delta to that capability.

The same rule then has to apply to the suite's own progress overlay, which was a full-viewport
translucent scrim with an infinite spinner sitting over the plot for the entire measured window —
the identical confound, self-inflicted, and larger than the tour's. Measured on 5K at 10 iterations
in Chrome, two runs each: zoomInOut 2.81/2.62 → 0.68/0.70ms, dragCanvas 2.85/2.89 → 0.89/0.87ms,
annotationChange 4.22/4.32 → 2.83/2.88ms. clickPoint records only 10 passes per run and its
difference (7.36/6.18 → 5.71/6.26ms) is inside the noise.

It is not deleted, because it does two separable jobs and only one is the confound: painting a veil,
and swallowing a stray click during a long headed run. Dropping the background and parking the
animation while measuring keeps the second. Hit testing uses the border box, so a transparent
element still absorbs input; the card also moves out of the plot's centre, and the subtitle carries
progress in place of the parked spinner.

**Record dataset failures in the results file rather than aborting.**
Catch per dataset, record the dataset id and error message, continue. The results file becomes the
report of what happened, including what failed — which is the artifact wanted when hunting a
ceiling.

Failures go in a **separate top-level `failures` array**, not as an `error` field on an entry in
`results`. `plot_perf_results.py` yields every member of `results` as a dataset payload, so a
failure record placed there would plot as a phantom dataset with empty bars — reproducing the exact
bug the CDP sidecar already causes in that script. Keeping `results` homogeneous means the plotter
needs no change at all.

**Three harness defects that the Non-Goals list deferred turned out to be blocking, and are fixed here.**
`reuseExistingServer: false` was listed as a papercut; it is not the bug. Playwright kills the
process group it spawns, but turbo puts each task it runs into a _new_ group, so Vite escapes the
SIGKILL and keeps :8080 — and the port guard is then correctly refusing to benchmark a server it did
not start. That guard is worth keeping for a reason stronger than tidiness: turbo's `dev` task
`dependsOn: ["^build"]` and the app resolves `@protspace/*` through `dist`, so adopting a stale
server would silently benchmark stale package code. The fix is therefore teardown —
`gracefulShutdown` with SIGINT, which turbo does handle — not relaxing the guard. The command also
becomes `pnpm dev:app`, because the root `dev` script additionally boots the VitePress docs server,
a second process competing for CPU inside the measured window and serving nothing `/explore` uses.

The shared `outputDir` compounds it: Playwright deletes the output directory of every _selected_
project at run start, before the web server starts, so the documented
`pnpm perf -- --project=chrome` destroyed the other browsers' results from the previous sweep — and
a run that then died on the port did not replace them. One directory per project fixes it.

The third is the OPFS write, and it is the largest single distortion on the branch. The suite drove
the app through `loadFromFile(file)` with no options, so `load-queue.ts` recorded every dataset as
`kind: 'user'` — a user import — and `dataset-controller.ts` then _awaited_ `saveLastImportedFile`,
a full copy of the bundle into the Origin Private File System, **before** rendering. That copy sits
strictly inside the interval reported as `loadDurationMs`. At the sizes this harness exists to probe
it is not a detail of the measurement, it is the measurement: the probe bundles are 72–145 MB, each
written once per dataset on top of the ~100 MB `ArrayBuffer` the suite already holds. WebKit gives up
on the write — a 1M sweep reported eight `UnknownError: The operation failed for an unknown transient
reason (e.g. out of memory)` — while Chrome completes it and silently bills it to the load time. It
had a second cost unrelated to benchmarking: a run replaced whatever dataset the developer had
persisted for reload with the last one the benchmark happened to load.

Passing `source: 'auto'` makes the app record a demo load (`kind: 'default'`), which is what a
benchmark load is. Everything OPFS-related is gated on `kind === 'user' | 'opfs'`, so both the
persist and the `markLastLoadStatus` writes drop out. This stays at the harness layer — the same call
as the tour suppression — rather than teaching the app about benchmarks. The remaining differences
are wanted: each dataset starts from cleared legend state instead of inheriting the previous one's,
and the stale-tooltip URL rewrite (a user-import concern) is skipped. Load identity is unaffected,
because `detail.file` is set on the event regardless of source.

**The benchmark blocks the analytics beacon, for the same reason it suppresses the tour.**
`index.html` loads Cloudflare Web Analytics unconditionally, so the beacon script executes and POSTs
from inside the measured window. Beyond being a confound, it is why the `safari` project failed on
every run since the beacon was added: the POST is cross-origin, WebKit raises the rejection as an
uncaught page error, and the spec's fail-fast rethrows the first page error — killing the run 4ms
after it began waiting for the plot. Chrome and Firefox report the same failure as a console error
only, so only Safari died, and its reported error pointed at the download wait rather than the
cause. Blocking the request rather than filtering the error is what the tour decision already
implies, and it is also the only complete fix: the final `expect(pageErrors).toEqual([])` would
still have failed on a filtered race.

**Abandoning a load is not cancelling it.**
Bounding a wait stops the suite waiting; it does not stop the load. `load-queue.ts` serializes every
later load behind the abandoned one and has no cancel path, and the loader's completion events are
broadcast to whoever is listening — so the next dataset's listeners would consume the previous
dataset's completion and its measurements would be taken against the wrong points while carrying the
right label. Two defences, because either alone is insufficient. `DataLoadedEventDetail.file` is the
only field in any of these events that identifies a load, and it is the very `File` object the suite
passed in, so the listener compares object identity; the plot-side wait then asserts
`plotElement.data === ourData` rather than waiting on `data-change`, which is dispatched from five
sites with no load identity at all. And because the queue is now blocked regardless, a load abandoned
at its deadline ends the sweep — the remaining datasets are recorded as skipped rather than each
spending its full budget reaching the same deadline.

Only an _abandoned_ wait may do that, which is why budget expiry is its own error type
(`PerfBudgetExpiredError`) and the load catch rethrows everything else. A load that rejects cleanly
leaves the queue drained (`queuedLoad = nextLoad.catch(...)`) and is exactly the survivable
per-dataset failure this change set out to create; conflating the two would lose an entire sweep to a
dataset that merely errored. Today only the timeout reaches that catch, because the app's
`loadFromFileHandler` swallows load errors — worth stating so the guard does not read as dead code.

**Size every budget against the harness's enclosing deadlines.**
Deadlines only help if they compose. Each wait holding its own timeout multiplied the worst case by
the number of waits in the load path, so one dataset could outlive the spec's download wait
(`SUITE_TIMEOUT_MS - 60_000`) and the run would report nothing but `waiting for event download` —
the very symptom the bounding was added to remove. A dataset now gets one absolute `Budget` shared
by every wait in its load path and by the readiness gate, capped by a run budget the spec derives
from its own download wait and passes in, so the two layers cannot drift.

An inherited budget changes what a correct wait loop looks like, which is the subtlest consequence
here. Once `readyTimeoutMs` is what is _left_ of a dataset's budget rather than a fixed ten minutes,
it is routinely at or near zero right after a large bundle lands — and a deadline-first
`while (elapsed < timeoutMs)` head then reports "timed out waiting for data to fully load" for a host
it never once evaluated, failing a dataset that had in fact loaded. So any wait whose budget is
inherited rather than fixed must be **predicate-first**: evaluate the condition, then check the
deadline. `waitUntil` was written that way deliberately; `_waitForHostFullyLoaded` had to be
converted to it.

The guarantee is carried by a watchdog rather than by a check between datasets: at the run deadline
the results file is emitted wherever the sweep has got to. Checking only between datasets would
still let the last dataset overrun. That in turn makes the empty-run throw counterproductive — it
suppressed the download and left the harness waiting out its full budget to report a timeout — so an
empty run now emits a file naming every failure, and the spec's existing "results is non-empty"
assertion fails it in seconds.

**Pair that catch with stricter validation.**
Swallowing per-dataset errors would otherwise convert loud failures into a green run with quiet
gaps — trading one silent-failure mode for another. The spec assertion must therefore fail on a
captured error and on any scenario that recorded no passes, which also closes a pre-existing gap
where an all-timeouts run passed and became NaN bars in the plotter.

**Test in jsdom, asserting behavior.**
jsdom reproduces the break exactly: `WebGLRenderer`'s constructor only stores its arguments and
defers GL acquisition, so `_webglRenderer` is non-null and five of the gate's seven conditions
already hold — only the two that drifted fail. The test drives the runner instance the _host_ owns,
so a future change to the runner's constructor keeps being exercised instead of rewriting the test
that constrains it. It asserts the gate resolves, still rejects on a never-loading host, still
rejects on a fully-loaded host whose interaction layer was never initialized, and that the zoom
helpers both move the plot and record a render pass.

The third assertion is the one that makes "delete the failing condition" a non-fix, and it is not
interchangeable with the second: a host with no `data` fails the gate on `host.data` alone, so it
stays red whether or not the zoom condition is there. Only a host where every _other_ condition
holds can prove the gate consults the interaction layer at all.

Asserting the render pass, not just the transform, matters because `applyZoom` writes the transform
synchronously but defers the render into a `requestAnimationFrame` — so a break confined to the
render path leaves every transform assertion green while making every `zoomInOut` and `dragCanvas`
measurement empty. Passes are only recorded while a scenario is active (`start()` returns null
otherwise), so the test opens a recording window through the runner's `_recorder`/`_beginScenario`
rather than driving a whole measurement run. It asserts on the pass's **trigger**: an unrelated
`plot` pass lands in the same frame, so `passes.length > 0` stays green with the zoom render path
dead — verified by mutation, which reports `expected [ 'plot' ] to include 'zoom'`.

## Risks / Trade-offs

- **The reach-in coupling is reduced, not removed** → the runner still resolves `_interaction` and
  ~9 other private host members by name, so renaming any of them re-breaks it silently. Mitigated
  by the regression test for the values that matter; the typed bridge remains the durable answer.
- **Per-dataset catch could mask real failures** → mitigated by making the spec fail on any recorded
  error, so a caught failure is still a red run; it just no longer costs the other datasets.
- **Results-file shape changes** → mitigated by construction: `results` keeps its existing shape and
  failures and skips live under two new top-level keys (`failures`, `skipped`) the plotter never
  reads. Verified by running the plotter on a mixed success/failure file — it emitted every plot and
  registered no phantom dataset.
- **Absolute timings are not comparable with old baselines** → and deliberately so, in two places:
  removing the full-viewport scrim and the running spinner drops the interaction scenarios (5K,
  Chrome: zoomInOut 2.81/2.62 → 0.68/0.70ms), and removing the OPFS copy drops `loadDurationMs` by
  what was the dominant term at probe sizes. The comparability goal above is about the zoom/pan path
  measuring the same _operation_ it did before the F-07 extraction, not about matching old numbers.
- **`zoomBy` clamping** → `scaleBy` is clamped to the scaleExtent snapshotted at `initialize()`, so
  a pre-zoomed plot could make the in/out pair not round-trip and measure a near-no-op. It cannot
  hang (the transform still emits and renders), and the transform restore returns the pre-run state.
- **`panBy` names a transform-space operation** → d3 applies `tx1 = tx0 + k·dx`, so displacement
  scales with zoom level and a reader may assume pixels. Documented at the method.
- **jsdom is not a GPU** → the test proves the readiness/wiring contract, never render performance.
  Real timings still require `pnpm perf` on a headed GPU browser.
