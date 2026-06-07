## Context

`app/tests/numeric-binning.spec.ts` was written against the **old filter-menu UI** and the **old filter state model**. Both shipped out from under it:

- **Old UI** (gone): `.filter-menu` in `protspace-control-bar`, `.filter-menu-list-item` rows, `.filter-item-checkbox` toggles, per-row `Clear all`/`Done`, top-level `Apply`.
- **New UI** (shipped): `Filter` button → `.query-builder-overlay`/`.query-builder-modal` (`role="dialog"`, `aria-label="Filter Query Builder"`) → `protspace-query-builder` → one or more `protspace-query-condition-row` → `protspace-query-value-picker`. A condition = `{ id, annotation, values, logicalOp }`. Buttons: `+ Add condition`, `Reset All`, `Cancel`, `Apply & Isolate`.
- **Old state** (no longer driven by filtering): `plot.filteredProteinIds: string[]`, `plot.filtersActive: boolean`.
- **New effect**: `Apply & Isolate` → `control-bar._handleQueryApply` → `scatter-plot.isolateSelection()`. Isolation pushes the matched IDs onto `_isolationHistory`, sets `_isolationMode`, and **physically reduces** the plot data, so the result is observed via `getCurrentData().protein_ids`, not `filteredProteinIds`. `Reset All` → `_handleQueryReset` → `resetIsolation()`.

Key behavioral facts established by reading the components:

1. **Isolation stacks.** Each `Apply & Isolate` isolates _within the current subset_. Re-applying a different bin without resetting yields the intersection (often empty), not a fresh single-bin view.
2. **Value picker excludes selected values** (they become chips) and shows counts; `allValues` is derived from `data.annotations[annotation].values`.
3. **`Apply & Isolate` is disabled** when `query.length === 0` or `matchedIndices.size === 0`. Clicking a disabled button would hang a Playwright `click`.
4. **Match count is debounced 300 ms** in `query-builder._scheduleEvaluation`.
5. Cluster B (`loadDemoDataset` → `order`) is already fixed; Cluster C (keyboard-escape order restore) is possibly a flake to be triaged with a trace.

## Goals / Non-Goals

**Goals:**

- Make `pnpm test:e2e --project=numeric-binning` fully green against the shipped query-builder UI.
- Encapsulate query-builder interaction in a small set of helpers so test bodies stay readable and the old call sites change minimally.
- Reconcile test intent with isolation semantics (reset between independent applies).
- Keep the other e2e projects green.

**Non-Goals:**

- Changing production behavior. If browser verification reveals a genuine bug (e.g. the index-mapping in `_handleQueryApply` mapping `_currentData` indices through `getCurrentData().protein_ids`, or value ordering not tracking the legend), it is captured as an Open Question and split into its own fix — not bundled here.
- Re-speccing the full query-builder feature beyond what these tests exercise.

## Decisions

### Decision: Helper shapes map old semantics onto the query model

Rewrite the 7 helpers to drive the query builder while preserving their call signatures so most test bodies are untouched:

- `openFilterValueMenu(page, annotation)` — open the dialog if closed; ensure a condition row for `annotation` exists (reuse if present, else use the seeded empty row / add one), select the annotation, and open its value picker. Used by tests that then read available labels.
- `setFilterValues(page, annotation, values)` — open dialog; find-or-create the condition for `annotation`; clear its existing chips; add each value via the value picker; close the picker. Find-or-reuse (not always-add) is required so the "switch bins" test replaces rather than conjoins.
- `applyFiltersFromMenu(page)` — click `Apply & Isolate` (guard: only if enabled).
- `disableFilter(page, annotation)` — used only when `annotation` is the sole active filter; implement as `Reset All` (clears query + isolation). Clicking a disabled `Apply` is avoided.
- `countOpenFilterValues(page, annotation)` / `readOpenFilterLabels(page, annotation)` — read `.value-picker-item` rows (label text in list order) for the open picker; account for the fact that selected values are chips, not list rows.
- `readOpenFilterOptionState(page, annotation, label)` — express "checked" as "present as a chip" and "disabled" as "cannot be removed/at the last-value floor", mapped to whatever the value picker actually exposes (to be confirmed in verification).

**Alternative considered:** a single declarative `applyQuery(conditions)` helper replacing all call sites. Rejected for this change — larger diff, more test-body churn, and harder to keep the legend-order assertions close to their helpers. Can be a future cleanup.

### Decision: Reset isolation between independent "switch bin" applies

The test `numeric filters reuse the shared unfiltered bin view when switching bins` compares bin0 vs bin1 vs cleared, each expected against the **full** dataset counts. Under stacking isolation this only holds if each apply starts from the full view. Insert a `Reset All` (or reload) between applies so each measured count reflects a single bin over the full data. Assert counts via `getCurrentData().protein_ids.length`, not `filteredProteinIds.length`.

### Decision: Translate old state assertions to the isolation model

Replace `filteredProteinIds.length` / `filtersActive` assertions with `getCurrentData().protein_ids.length` and isolation indicators (`data-isolation` / control-bar `filterActive`). Where a test asserted a per-annotation badge or `Select values`/`Done` affordance that no longer exists, re-express the intent against the condition-row/value-picker DOM or drop the now-meaningless sub-assertion.

### Decision: Verify real behavior in the browser before finalizing helpers

Per the project norm (verify protspace_web fixes in the browser, not just tests), the first apply task drives the actual query builder with the numeric fixture (via Playwright MCP or a scratch run) to confirm: value-picker ordering vs legend, counts, the apply/close/disabled flow, and whether isolation mapping is correct. Helpers are written to the observed behavior.

## Risks / Trade-offs

- **Isolation index mapping may be a real bug** (`_handleQueryApply` evaluates over `_currentData` = materialized full data but maps indices through `getCurrentData().protein_ids` = possibly-isolated data). → Verify in browser; if broken, file/scope a separate production fix and keep tests asserting correct intended behavior (test may be `fixme` pending that fix rather than asserting wrong behavior).
- **Debounced match count (300 ms)** can race `Apply` enabling. → Use condition-based waits (`expect(applyButton).toBeEnabled()` / poll match-count text), never fixed sleeps.
- **Shadow DOM depth** (control-bar → query-builder → condition-row → value-picker, each its own shadow root). → Rely on Playwright's open-shadow piercing with `getByRole`/CSS; verify locators actually resolve.
- **Cluster C may be a real regression, not a flake.** → Triage with `--trace=on`; fix root cause or quarantine with a tracked reason, not a blind retry.
- **Over-fitting helpers to fixture specifics.** → Keep helpers data-driven (read labels/counts from the live picker) rather than hard-coding bin labels.

## Migration Plan

Test-only change (barring a verified production bug). No runtime migration. Rollback = revert the test-file commit. Validation gates: `pnpm test:e2e --project=numeric-binning` green, other e2e projects green, `pnpm precommit` clean.

## Resolved by browser verification

Confirmed against the shipped build (fixture `raw_numeric_test.parquetbundle`):

- **Single apply from full view isolates correctly.** Applying bin `10 - 20` → `getCurrentData().protein_ids.length === 2` (= bin count). `Reset All` restores 12. Stacked applies map indices wrongly, so tests reset between independent applies (design decision above stands).
- **Numeric picker shows internal ids** (`num:quantile:10:20.5…`), not friendly labels; categorical shows friendly values (`A`, `B`). Helpers map friendly label ↔ internal id via `numericMetadata.bins`.
- **Picker does NOT mirror legend reverse/manual order** — it lists `annotations[ann].values` in stable order. The builder also filters non-selected annotations that have no legend at all. Therefore the old "filter order mirrors legend order" assertions are obsolete and are dropped/loosened to set-equality (filter lists the current bins), not order.

Two further capability differences surfaced during implementation (both are query-builder behaviours, not test bugs — flagged for the `refactor/control-bar-and-filtering` branch):

- **Non-selected numeric annotations cannot be filtered.** `_getMaterializedData` only bins the _selected_ numeric annotation, so a non-selected numeric annotation (e.g. `weight`) has empty `values` and the value picker shows "0 of 0". Categorical annotations keep their values regardless of selection. The test was repurposed to a non-selected _categorical_ annotation (`family`).
- **Zero-match queries can't be applied; numeric tooltip shows only the raw value.** `Apply & Isolate` is disabled at zero matches (so the zero-match test asserts the disabled state, not an empty isolate). The numeric protein tooltip renders only `.tooltip-annotation-raw-value` (the raw value) with no bin display label, so that test asserts the raw value falls within a current bin.

## Scope decision (test-only)

The control-bar/query-builder refactor and any UX polish (friendly numeric labels, legend-order parity) live on a separate branch (`refactor/control-bar-and-filtering`, head `318148f`). **This change is test-only**: no production edits. Tests are rewritten to drive and assert against the shipped query-builder + isolation behavior as-is.

## Open Questions

- Is Cluster C (`keyboard escape after moving restores numeric order`) a flake or a real escape-handling regression? (Triage with a trace during apply.)
