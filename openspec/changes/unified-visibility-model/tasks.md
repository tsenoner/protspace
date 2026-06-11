# Tasks: unified-visibility-model

Each task lands independently green (`pnpm precommit` passes). Order matters: behavior
is pinned before any production code moves.

## 1. Pin currently-untested behavior (against CURRENT code — all tests green pre-refactor)

- [x] 1.1 `style-getters.test.ts`: hidden beats selected (selected id whose only value is
      hidden → opacity exactly 0)
- [x] 1.2 `style-getters.test.ts`: selection fading × hidden composition (non-empty
      `selectedProteinIds`; non-selected visible point → `opacities.faded`; non-selected
      hidden point → 0; selected visible point → `opacities.selected`)
- [x] 1.3 `style-getters.test.ts`: vacuous-truth edge — point with zero annotation values
      (Int32Array sentinel `-1`) is hidden even with an empty hidden set
- [x] 1.4 `style-getters.test.ts`: all-hidden escape hatch — opacity rescued to base tier;
      `getColors` returns `[]` (colors NOT rescued)
- [x] 1.5 `style-getters.test.ts`: highlight-only state — highlighted point gets selected
      opacity, others keep base (no fading)
- [x] 1.6 `data-processor.test.ts`: `visibleProteinIds` (5th param) × isolation-history
      intersection — both applied, global `originalIndex` preserved
- [x] 1.7 `scatter-plot.filter-render.test.ts` (unattached-element pattern): apply query
      then hide a category — `_plotData` culled by query only; hidden point opacity 0;
      then hide-first/query-second yields the identical end state
- [x] 1.8 `scatter-plot.filter-render.test.ts`: dataset swap clears
      `filteredProteinIds`/`filtersActive` before `_processData` consumes them (new data
      renders un-culled)

## 2. Pure module

- [x] 2.1 Add `packages/core/src/components/scatter-plot/visibility-model.ts`:
      `computeVisibilityModel(inputs)` per design D2/D3 — per-bin hidden lookup over
      `annotation.values`, one allocation-free `Uint8Array` pass over `annotation_data`
      indexed by global `originalIndex`; no `getProteinAnnotationValues` in the loop; no
      DOM/WebGL/Lit imports
- [x] 2.2 Add `visibility-model.test.ts` covering every row of the design D5 semantics
      table (11 rules), including exact-0 assertions and `tierOf` never collapsing
      selected into base
- [x] 2.3 Verify knip passes (`pnpm quality`): every export consumed

## 3. Delegate style getters

- [x] 3.1 `createStyleGetters` gains an optional `model?: VisibilityModel` param —
      delegates when provided, computes internally when absent (existing direct callers
      stay source-compatible); `getOpacity`/`getBaseOpacity` become delegations;
      `getColors`/`getPointShape`/`getDepth`/z-order untouched; `WebGLStyleGetters`
      shape unchanged
- [x] 3.2 Entire existing `style-getters.test.ts` suite green unchanged — especially
      depth-stability (`:201-245`) and `__NA__` normalization tests

## 4. Wire the component

- [x] 4.1 Add memoized `_getVisibilityModel()` to `scatter-plot.ts`: keys =
      materialized-data ref, `selectedAnnotation`, `hiddenAnnotationValues` ref,
      selection/highlight refs, opacities config; hidden-mask sub-memo excludes selection
      keys
- [x] 4.2 Migrate the five predicate sites to `model.isInteractive(d)`: quadtree build
      (`:888`), lasso (`:1259`), brush (`:1276`), hover (`:1997`), click (`:2057`);
      keep the separate `isPointRendered` composition at hover/click (`:2003`, `:2062`)
- [x] 4.3 Keep `_getOpacity` as a facade delegating to the model (external consumers:
      `webgl-render-perf.ts:555-566`, `app/tests/brush-selection.spec.ts:323-325`)
- [x] 4.4 Confirm renderer invalidation call sites untouched (hidden-only →
      style-cache-only; annotation/Other → + position cache); no new invalidation added
- [x] 4.5 All Section-1 pinned tests and existing suites green

## 5. Verification

- [x] 5.1 `pnpm precommit` (format, lint, typecheck, vitest) green at repo root
- [ ] 5.2 Manual fast-path check in the dev app: toggle a legend value on a large dataset
      and confirm no full re-sort (no `invalidatePositionCache` in the toggle path; frame
      time comparable to before)
- [ ] 5.3 Manual UX parity sweep: hide → axes don't re-fit; query apply → axes re-fit;
      faded points clickable; hidden points not clickable; isolate-within-query;
      reset paths; export PNG excludes hidden points
- [x] 5.4 Grep confirms no remaining ad-hoc visibility derivation:
      `_getOpacity(` appears only in the facade and its external consumers;
      no `.every(...hiddenKeysSet` outside `visibility-model.ts`
