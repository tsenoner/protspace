## Why

`pnpm perf` takes up to 45 minutes and still cannot answer "did this branch make Explore slower".
It runs eight scenarios that call into the page instead of going through the UI, in three headed
browsers, over every dataset in `datasets.json`, ten times each. About 92% of that time is spent
waiting: the runner's `start()` returns null outside a recording, so every wait burns its full
2 s. It has no budgets, no committed baselines, runs in no CI workflow, cannot run next to a dev
server (its config hardcodes port 8080 with `reuseExistingServer: false`), and has broken silently
twice (`restore-webgl-perf-harness`).

The three-day Explore perf effort (2026-09-30) used an ad-hoc lab instead. What decided things
there were deterministic counts per interaction: full GPU re-stages (an annotation switch did 4
when 1 is needed) and synchronous `gl.is*` calls per frame. Timings swung 2x with the machine's
power state; counts did not. The lab's weak points were probes tied to private method names,
which vanish silently after a rename, and one large import per scenario.

## What Changes

- **`pnpm perf:counts`**: a headless Playwright project, `perf-counts`, in the app's e2e config.
  It loads the demo dataset once with `?perfCounters=1`, drives nine segments through the real
  UI (load, idle, annotation switch, projection switch, legend isolate, camera, resize, search,
  import) and diffs counters before and after each. Counts above `apps/web/tests/perf/budgets.json`
  fail. It runs inside `pnpm test:e2e`, so CI picks it up with no workflow change.
- **`pnpm perf`**: timing mode. `perf/perf.mjs` builds the app, serves it with `vite preview` on
  port 8301, and runs the same segments headed in Chromium on the real GPU, reporting INP, the
  longest long-animation-frame, main-thread busy time, re-stage time and frame gaps. It can sweep
  datasets, compare two builds interleaved in one session, and save per-machine baselines.
- **Flag-gated counters in core** (`utils/perf-counters.ts`): null unless the URL has
  `perfCounters`, so production pays one null check per call site. GL-level counts (`gl.is*`,
  synchronous GL reads, uploaded bytes) come from wrapping the public `WebGL2RenderingContext`
  prototype in an init script, so no rename in our code can hide them.
- **`camera-no-restage.spec.ts` folds into `perf-counts`**: its camera segment gates zero uploaded
  bytes and zero re-stages on drag and wheel, and drawn points equal to the protein count.
- **BREAKING (dev tooling)**: the old suite is removed: `perf/webgl-perf.spec.ts`, its config,
  the Python plotter, `apps/web/src/perf/webgl-perf-suite.ts` and its startup hook, core's
  `WebglRenderPerfRunner` and `runWebGLRenderPerfMeasurements`. Firefox and Safari timing goes:
  long-animation-frame timing is Chromium-only, and these checks measure our code, not engines.

### Non-goals

- Gating on timings. SwiftShader timings in CI are meaningless and laptop timings are noisy, so
  timing mode reports and compares; only counts gate.
- A GPU CI runner. Timing mode stays manual; a weekly job can come later.
- Fixing the regressions the counts reveal. Budgets record current main; perf branches lower them
  in the same commit as the fix.

## Capabilities

### New Capabilities

- `perf-checks`: what the counts gate guarantees (UI-driven segments, settle rule, budgets, pixel
  round trips) and what timing mode guarantees (interleaved compare, warm-up, server cleanup).

### Modified Capabilities

- `webgl-perf-harness`: removed. Every requirement described the deleted suite.

## Impact

- `packages/core`: new internal `utils/perf-counters.ts`; one-line probes in `webgl-renderer.ts`,
  `scatter-plot.ts` and `legend.ts`; `webgl-render-perf.ts` and its host-contract test deleted.
- `apps/web`: new `tests/perf-*.spec.ts`, `tests/helpers/perf/`, `tests/perf/budgets.json`;
  `src/perf/` deleted; `camera-no-restage.spec.ts` deleted.
- Root: `perf` script repointed, `perf:counts` added; `perf/` holds only `perf.mjs` and docs;
  `perf/results/` and `perf/baselines/*.local.json` gitignored.
