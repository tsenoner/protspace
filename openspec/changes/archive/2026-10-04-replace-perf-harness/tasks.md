## 1. Counters

- [x] 1.1 Add `packages/core/src/utils/perf-counters.ts`: null without `?perfCounters`, exposed on
      `window.__protspacePerfCounters` with it.
- [x] 1.2 Count re-stages (positions, styles, ms), renders and drawn points in `webgl-renderer.ts`;
      `_processData` and grid rebuilds in `scatter-plot.ts`; legend updates and rebuilds in
      `legend.ts`.
- [x] 1.3 Unit test: null without the flag, increments with it.

## 2. Counts gate

- [x] 2.1 `apps/web/tests/helpers/perf/`: init-script GL wrappers, counter reads, `settle()`,
      `segment()`, the scenario list and the report printer.
- [x] 2.2 `perf-counts.spec.ts` and its default project; `budgets.json` recorded on main;
      `pnpm perf:counts`.
- [x] 2.3 Fold `camera-no-restage.spec.ts` into the camera segment and delete it.

## 3. Timing mode

- [x] 3.1 `perf-timing.spec.ts` (opt-in project, headed) with Event Timing, LoAF, frame gaps,
      `TaskDuration` and heap.
- [x] 3.2 `perf/perf.mjs`: flags to env, build plus `vite preview` on 8301, cleanup on exit and
      signals; repoint `pnpm perf`; gitignore results and local baselines.

## 4. Removal

- [x] 4.1 ~~Delete the old suite, its config, the Python plotter and the app's perf hook.~~
      Reverted on rebase: kept as `pnpm perf:webgl`.
- [x] 4.2 ~~Delete core's `WebglRenderPerfRunner` and `runWebGLRenderPerfMeasurements`.~~
      Reverted on rebase: ported to the refactored plot.

## 5. Docs

- [x] 5.1 Rewrite `perf/README.md`; add `perf/baselines/README.md`.
- [x] 5.2 Archive this change.
