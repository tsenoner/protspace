## Why

The `numeric-binning` Playwright project (`pnpm test:e2e --project=numeric-binning`) has 14 failing tests (issue #237). Their helpers and assertions still drive the **old filter-menu UI** (`.filter-menu`, per-row checkboxes, `Clear all`/`Done`/`Apply`) and inspect the **old filter state** (`plot.filteredProteinIds` / `plot.filtersActive`). Both were replaced by the shipped **query-builder** UI, whose `Apply & Isolate` action drives **isolation** (`scatter-plot.isolateSelection()` + `getCurrentData()` subset), not the old filter state. This is test-debt from a prior shipped refactor, not a product regression — the app filters correctly at `localhost:8080`.

## What Changes

- Rewrite the 7 filter helpers in `app/tests/numeric-binning.spec.ts` to drive the query builder (`protspace-query-builder` → `query-condition-row` → `query-value-picker`) instead of the removed `.filter-menu` DOM: `openFilterValueMenu`, `setFilterValues`, `disableFilter`, `applyFiltersFromMenu`, `countOpenFilterValues`, `readOpenFilterLabels`, `readOpenFilterOptionState`.
- Update the ~9 test bodies that assert on removed DOM (`.filter-menu-list-item`, `.filter-item-badge`, `Select values`/`Done` buttons) or removed state (`filteredProteinIds`/`filtersActive`) to assert on the isolation model (`getCurrentData()` subset, isolation history) instead.
- Reconcile "switch bins by re-applying" tests with **isolation stacking** (each apply isolates within the current subset) by resetting isolation between applies where the test intent is to compare independent single-bin results.
- Keep the already-correct Cluster B fix (`loadDemoDataset` uses `order`, not `ec`); investigate and de-flake Cluster C (keyboard-escape order restore).
- Document the shipped query-builder filtering/isolation behavior and its required e2e coverage as an OpenSpec capability so the tests have a spec to anchor to.

## Capabilities

### New Capabilities

- `query-builder-filtering`: The control-bar query-builder filter UI (condition rows, value picker, AND/OR/NOT, `Apply & Isolate`, `Reset All`) and its isolation-based effect on the scatter-plot, plus the e2e coverage that must pass against it.

### Modified Capabilities

<!-- No existing spec in openspec/specs/ covers control-bar filtering; nothing to modify. -->

## Impact

- **Tests:** `app/tests/numeric-binning.spec.ts` (helpers + ~9 test bodies). No production code changes expected unless browser verification reveals a real regression (e.g. value ordering or index mapping in `_handleQueryApply`), which would be split into a separate fix.
- **Components referenced (read-only):** `packages/core/src/components/control-bar/{control-bar,query-builder,query-condition-row,query-value-picker,query-evaluate}.ts`, `packages/core/src/components/scatter-plot/scatter-plot.ts` (`isolateSelection`/`resetIsolation`).
- **Other e2e projects** (`product-tour`, `dataset-reload`, `url-view-state`, etc.) must remain green.
