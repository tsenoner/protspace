# EAT UX Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the EAT overlay UX on PR #315 before merge — terser provenance status, point-size-responsive green halos, thicker + hollow prediction rings, drop the redundant "No annotation" legend row, and replace reliability *dimming* with a two-way slider↔query *filter*.

**Architecture:** All changes are on branch `cleanup/pr315-simplify-review` (feeds PR #315). Rendering changes go through the single shared WebGL point shader (live+export parity is automatic). The reliability pivot removes the visibility-model dimming branch and drives the existing query-filter (`NOT(EAT_confidence < X)`), mirrored two ways with the legend slider.

**Tech Stack:** Lit 3 web components, WebGL2 (GLSL), D3, TypeScript, Vitest, Playwright; pnpm workspaces + Turbo. Design spec: `docs/superpowers/specs/2026-07-20-eat-ux-refinements-design.md`.

## Global Constraints

- Work in the worktree `/Users/tsenoner/Documents/projects/protspace-suite/protspace/.claude/worktrees/pr315-cleanup`; commit to `cleanup/pr315-simplify-review`.
- Commit prefixes: `feat:` only for package-user-visible behavior; otherwise `fix:`/`refactor:`/`test:`/`chore:`/`docs:` (this is a user-visible feature area → `feat(eat):` for behavior changes, `test(eat):`/`refactor(eat):` for the rest).
- The WebGL point shader `POINT_FRAGMENT_SHADER` in `export-shaders.ts` is the **single** source compiled by both live (`webgl-renderer.ts`) and export (`export-renderer.ts`) — never fork it.
- Match the eat-confidence column by `annotation.runtime?.role === 'eat-confidence'`, never the `__eat_confidence` suffix.
- Reliability filter expression is `NOT(EAT_confidence < X)` (NumericCondition `operator:'lt', max:X, logicalOp:'NOT'`); default threshold **0** (no condition, all visible).
- Per-task verification: `pnpm --filter <pkg> test:ci` for the touched suite; full gate before pushing: `pnpm precommit` + `pnpm test:ci` + `pnpm --filter @protspace/app exec playwright test eat-visualization` + `uv run pytest -m "not slow"` where Python is touched (none here).
- Update the OpenSpec change `openspec/changes/add-eat-visualization/` deltas where #5/#6 change committed requirements; re-run `openspec validate add-eat-visualization --strict`.

## File structure (what each touched file owns)

| File | Responsibility | Tasks |
|------|----------------|-------|
| `packages/core/src/components/scatter-plot/scatter-plot.ts` | connector-status template guard + text; halo dep wiring; drop threshold-only plumbing | 1, 4, 8 |
| `packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.ts` | halo radius from point size | 4 |
| `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts` | ring thickness + hollow flag (shared shader) | 3 |
| `packages/core/src/components/legend/legend.ts` | drop no-annotation row; repurpose slider → filter event; slider default 0 | 2, 8 |
| `packages/core/src/components/legend/eat-population-counts.ts` | two-bucket counts (drop `missing`) | 2 |
| `packages/core/src/components/legend/styles/layout.ts` | drop dead `.eat-swatch.missing` CSS | 2 |
| `packages/core/src/components/scatter-plot/styling/visibility-model.ts` | remove EAT dimming branch | 5 |
| `packages/utils/src/visualization/eat-overlay.ts` | drop `EAT_*_OPACITY`/`BELOW_THRESHOLD` consts; default threshold 0 | 5, 8 |
| `packages/core/src/components/control-bar/control-bar.ts` | split color-by vs filterable annotation lists; `setEatConfidenceThreshold` | 6, 8 |
| `packages/core/src/components/control-bar/query-numeric-helpers.ts` | (tests only) NOT+null semantics | 7 |
| `apps/web/src/explore/{runtime,dataset-controller,data-renderer,export-handler}.ts` | slider↔filter wiring; drop threshold-only pass-through | 8 |
| `packages/utils/src/parquet/{settings-validation,bundle-writer}.ts` + `types.ts` | persistence default 0 | 8 |

---

## Task 1: #1 — Terse provenance status (silent when all visible)

**Files:**
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (`render()` connector-status block ~2003–2016; `_formatConnectorStatus` ~2021)
- Test: `packages/core/src/components/scatter-plot/scatter-plot.provenance.test.ts`
- Test (e2e): `apps/web/tests/eat-visualization.spec.ts`

**Interfaces:**
- Consumes: `this._connectorStatus: ProvenanceConnectorStatus | null` with `{shown, total, missingEndpoints}` (unchanged contract).
- Produces: `_formatConnectorStatus(status)` returns `"${missingEndpoints} hidden (off-view)"`; the chip renders only when `missingEndpoints > 0`.

- [ ] **Step 1: Update the unit test to the new terse contract**

In `scatter-plot.provenance.test.ts`, replace the assertion that expects the old full string for `{shown:0,total:1,missingEndpoints:1}` with:

```ts
expect(seam._formatConnectorStatus({ shown: 0, total: 1, missingEndpoints: 1 })).toBe(
  '1 hidden (off-view)',
);
```

Add an all-visible case asserting the chip is absent from the rendered template (query the shadow root for `.connector-status` after setting a status with `missingEndpoints: 0` and assert it is `null`). Model the render/setup on the existing provenance render tests in the same file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/scatter-plot.provenance.test.ts`
Expected: FAIL (old string vs `"1 hidden (off-view)"`; chip still present when all-visible).

- [ ] **Step 3: Gate the chip render and shorten the text**

In `scatter-plot.ts` `render()`, change the connector-status block to only render when something is off-view:

```ts
${this._connectorStatus && this._connectorStatus.missingEndpoints > 0
  ? html`
      <div class="connector-status" role="status" aria-live="polite">
        <span>${this._formatConnectorStatus(this._connectorStatus)}</span>
        <button
          type="button"
          aria-label="Close provenance connections"
          @click=${this.clearProvenanceConnectors}
        >
          ×
        </button>
      </div>
    `
  : ''}
```

Replace the body of `_formatConnectorStatus`:

```ts
private _formatConnectorStatus(status: ProvenanceConnectorStatus): string {
  return `${status.missingEndpoints} hidden (off-view)`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/scatter-plot.provenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the Playwright expectations**

In `apps/web/tests/eat-visualization.spec.ts`: the assertions that expect `role=status` to contain `"Showing 1 of 1 provenance connection"` / `"Showing 4 of 4 provenance connections"` (all-visible) must change to assert the `.connector-status` chip is **not visible** in those states. Move the `"Close provenance connections"` ×-click step to a scenario where a connection is off-view (chip present), or dismiss the all-visible case by clicking empty plot space (`clearProvenance` path). Keep the connector line-count assertions unchanged.

- [ ] **Step 6: Run Playwright + commit**

Run: `pnpm --filter @protspace/app exec playwright test eat-visualization`
Expected: PASS.

```bash
git add packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/scatter-plot.provenance.test.ts \
  apps/web/tests/eat-visualization.spec.ts
git commit -m "feat(eat): silence provenance status unless connections are off-view"
```

---

## Task 2: #5 — Remove the "No annotation" legend row

**Files:**
- Modify: `packages/core/src/components/legend/eat-population-counts.ts` (drop `missing`)
- Modify: `packages/core/src/components/legend/legend.ts` (delete third row ~2223–2227)
- Modify: `packages/core/src/components/legend/styles/layout.ts` (delete `.eat-swatch.missing` ~214–218)
- Test: `packages/core/src/components/legend/eat-population-counts.test.ts`, `legend.eat-controls.test.ts`
- Modify: `openspec/changes/add-eat-visualization/specs/eat-annotation-overlay/spec.md`, `design.md`

**Interfaces:**
- Produces: `EatPopulationCounts = { observed: number; predicted: number; total: number }` (no `missing`).

- [ ] **Step 1: Update the counts test to the two-bucket shape**

In `eat-population-counts.test.ts`, remove assertions on `.missing` and the `observed + predicted + missing === total` invariant; assert `observed` and `predicted` directly for the fixture (a non-predicted `__NA__`-only protein counts as neither observed nor predicted). Keep the existing observed/predicted expectations.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/legend/eat-population-counts.test.ts`
Expected: FAIL (`.missing` referenced / invariant gone).

- [ ] **Step 3: Drop `missing` from the counts**

In `eat-population-counts.ts`: remove `missing: number` from `EatPopulationCounts`; remove `let missing = 0` and the `else missing += 1`. **Keep** the `hasObservedValue` NA-check (still gates `observed`). Return `{ observed, predicted, total: data.protein_ids.length }`.

- [ ] **Step 4: Delete the legend row + dead CSS**

In `legend.ts`, delete the entire third `<div class="eat-legend-row">` (the `.eat-swatch.missing` span, `<span>No annotation</span>`, `<strong>${this._eatCounts.missing}</strong>`). Keep Observed and "Predicted by EAT". In `layout.ts`, delete the `.eat-swatch.missing { … }` rule.

- [ ] **Step 5: Run legend tests to verify they pass**

Update `legend.eat-controls.test.ts` to drop any "No annotation"/missing assertions, then:
Run: `pnpm --filter @protspace/core exec vitest --run src/components/legend/eat-population-counts.test.ts src/components/legend/legend.eat-controls.test.ts`
Expected: PASS.

- [ ] **Step 6: Update OpenSpec + e2e + commit**

In `spec.md`/`design.md`: change the population model from three classes to two (Observed + Predicted); drop the "No annotation" row requirement, the "observed + transferred + no-annotation = represented population" invariant, and the "No-annotation row avoids duplicate help" scenario. In `eat-visualization.spec.ts`, remove the "No annotation" row / count-0 assertions.

Run: `openspec validate add-eat-visualization --strict` → PASS.

```bash
git add packages/core/src/components/legend/eat-population-counts.ts \
  packages/core/src/components/legend/eat-population-counts.test.ts \
  packages/core/src/components/legend/legend.ts \
  packages/core/src/components/legend/legend.eat-controls.test.ts \
  packages/core/src/components/legend/styles/layout.ts \
  apps/web/tests/eat-visualization.spec.ts \
  openspec/changes/add-eat-visualization/
git commit -m "feat(eat): drop redundant No-annotation legend row (NA is its own category)"
```

---

## Task 3: #3 + #4 — Thicker + hollow prediction rings

**Files:**
- Modify: `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts` (`POINT_FRAGMENT_SHADER`)
- Test: `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.test.ts`
- Test (e2e): `apps/web/tests/eat-visualization.spec.ts`

**Interfaces:**
- Produces: shader with a top-level `const float PREDICTED_INTERIOR_FILL` (0.0 = hollow, 1.0 = filled-white knockout) and a thicker `ringWidth` clamp.

- [ ] **Step 1: Update the shader string-match test**

In `export-shaders.test.ts`, change the asserted substrings to the new values: the `ringWidth` clamp (e.g. `clamp(aa * 1.75, 0.30, 0.55)`), the presence of `PREDICTED_INTERIOR_FILL`, and the two composite lines using it (`mix(v_color.a, PREDICTED_INTERIOR_FILL, predictedInterior)` and `linearKnockoutColor * PREDICTED_INTERIOR_FILL`). Add an assertion that `PREDICTED_INTERIOR_FILL` is declared `= 0.0`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/webgl/renderer/export-shaders.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit the single shared shader**

In `export-shaders.ts` `POINT_FRAGMENT_SHADER`:
- After the existing top consts (near the `SQRT3` const), add: `const float PREDICTED_INTERIOR_FILL = 0.0; // 1.0 = filled knockout (old), 0.0 = hollow`.
- Thicken the ring: `float ringWidth = clamp(aa * 1.75, 0.30, 0.55);`.
- Rewrite the two center-composite lines:
  - `float finalAlpha = mix(v_color.a, PREDICTED_INTERIOR_FILL, predictedInterior) * shapeAlpha;`
  - `vec3 premultipliedColor = mix(finalColor * v_color.a, linearKnockoutColor * PREDICTED_INTERIOR_FILL, predictedInterior) * shapeAlpha;`

- [ ] **Step 4: Run unit + render tests**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/webgl/renderer/export-shaders.test.ts src/components/scatter-plot/webgl/renderer/export-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the Playwright pixel assertions for hollow**

In `eat-visualization.spec.ts`, the predicted-glyph center assertions currently require an opaque white center (`predicted[3]===255`, `distanceFromWhite<20`, center==bg on dark/transparent export). Invert them for hollow: the center is now **transparent** (alpha 0 / shows the layer behind), while the ring stays far from white. Keep ring-sample offsets valid for the thicker ring; adjust the ring radius sample if needed.

- [ ] **Step 6: Run Playwright + commit**

Run: `pnpm --filter @protspace/app exec playwright test eat-visualization`
Expected: PASS.

```bash
git add packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts \
  packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.test.ts \
  apps/web/tests/eat-visualization.spec.ts
git commit -m "feat(eat): thicker, hollow prediction rings (single-flag revertible to filled)"
```

---

## Task 4: #2 — Green halos scale with "Shape size"

**Files:**
- Modify: `packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (controller construction ~262)
- Test: `packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.test.ts`
- Test (e2e): `apps/web/tests/eat-visualization.spec.ts` (constant-through-zoom must still hold)

**Interfaces:**
- Consumes: `this._mergedConfig.pointSize: number`.
- Produces: `ConnectorOverlayDeps.getPointSize?: () => number`; private `endpointBaseRadiusPx(): number`.

- [ ] **Step 1: Update the controller unit test radii**

In `connector-overlay-controller.test.ts`, add `getPointSize: () => 240` (the default) to the deps in the test factory, and recompute the expected halo radii from the new formula (below) — at zoom 1 keep ≈ the current 7px, and at zoom 2.5 the same value ÷ 2.5.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/provenance/connector-overlay-controller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Derive halo radius from point size**

In `connector-overlay-controller.ts`: add `getPointSize?: () => number` to `ConnectorOverlayDeps` (optional-with-default so existing constructions keep working). Add a helper and use it in both `render()` and `updateZoomScale()`:

```ts
// On-screen point radius ≈ sqrt(pointSize)/3 (matches the WebGL/hit-test formula;
// keep in sync with POINT_SIZE_DIVISOR in stage-point.ts). Halo sits just outside.
private endpointBaseRadiusPx(): number {
  const pointSize = this.deps.getPointSize?.() ?? 240;
  const pointRadiusPx = Math.sqrt(Math.max(pointSize, 1)) / 3;
  return Math.max(4, pointRadiusPx + 2);
}
```

Replace `PROVENANCE_ENDPOINT_RADIUS_PX / this.zoomScale` in both spots with `this.endpointBaseRadiusPx() / this.zoomScale`. Keep `PROVENANCE_ENDPOINT_RADIUS_PX` only if still referenced elsewhere; otherwise remove it.

- [ ] **Step 4: Wire the point size from scatter-plot**

In `scatter-plot.ts` at the controller construction (~262), add to the deps object: `getPointSize: () => this._mergedConfig.pointSize,`.

- [ ] **Step 5: Run unit + e2e, then commit**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/provenance/connector-overlay-controller.test.ts src/components/scatter-plot/scatter-plot.provenance.test.ts`
Run: `pnpm --filter @protspace/app exec playwright test eat-visualization`
Expected: PASS (halo constant-through-zoom invariant still holds).

```bash
git add packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.ts \
  packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.test.ts
git commit -m "feat(eat): scale provenance halos with the Shape-size control"
```

---

## Task 5: #6a — Remove reliability dimming from the visibility model

**Files:**
- Modify: `packages/core/src/components/scatter-plot/styling/visibility-model.ts`
- Modify: `packages/utils/src/visualization/eat-overlay.ts` (drop 3 consts) + `packages/utils/src/index.ts` (drop re-exports)
- Test: `packages/core/src/components/scatter-plot/styling/visibility-model.test.ts`, `packages/utils/src/visualization/eat-overlay.test.ts`

**Interfaces:**
- Produces: `baseOpacityOf` returns `opacities.base` for predicted points (identical to observed). `VisibilityInputs` loses `eatOverlayEnabled`/`eatConfidenceThreshold`.

- [ ] **Step 1: Rewrite the dimming tests to expect base opacity**

In `visibility-model.test.ts`, replace the assertions that expect dimmed values (`EAT_MIN_OPACITY` `0.25`, `0.9`, `0.25*0.35`, sub-threshold non-interactive) with: a predicted point (no selection) returns `opacities.base` from `baseOpacityOf`/`opacityOf` and is interactive. Remove `eatOverlayEnabled`/`eatConfidenceThreshold` from the inputs those tests build.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/styling/visibility-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Delete the EAT branch + dead inputs**

In `visibility-model.ts`:
- In `baseOpacityOf`, delete the `if (eatOverlayEnabled) { … predictedCells … EAT_* … }` block so predicted points fall through to `return opacities.base`.
- Delete the hoisted `const predictedCells = …` line above `baseOpacityOf`.
- Remove `eatOverlayEnabled` and `eatConfidenceThreshold` from `VisibilityInputs`, from the destructure, and from defaults.
- Remove the `EAT_BELOW_THRESHOLD_FACTOR`, `EAT_MAX_OPACITY`, `EAT_MIN_OPACITY` imports (keep `isSparseMultiValueAnnotationData`).

- [ ] **Step 4: Remove the now-unused constants**

In `eat-overlay.ts`, delete `EAT_MIN_OPACITY`, `EAT_MAX_OPACITY`, `EAT_BELOW_THRESHOLD_FACTOR` (lines ~19–21) and any re-exports of them in `packages/utils/src/index.ts`. Keep `DEFAULT_EAT_CONFIDENCE_THRESHOLD` (retargeted in Task 8).

- [ ] **Step 5: Run tests + knip + commit**

Run: `pnpm --filter @protspace/core --filter @protspace/utils test:ci`
Run: `pnpm type-check && pnpm knip`
Expected: PASS (knip confirms no dangling exports).

```bash
git add packages/core/src/components/scatter-plot/styling/visibility-model.ts \
  packages/core/src/components/scatter-plot/styling/visibility-model.test.ts \
  packages/utils/src/visualization/eat-overlay.ts \
  packages/utils/src/visualization/eat-overlay.test.ts \
  packages/utils/src/index.ts
git commit -m "refactor(eat): remove reliability dimming from the visibility model"
```

---

## Task 6: #6c — Split color-by vs filterable annotation lists

**Files:**
- Modify: `packages/core/src/components/control-bar/control-bar.ts` (`_updateOptionsFromData` ~1355–1367; query-builder binding ~1017; select binding ~601)
- Test: `packages/core/src/components/control-bar/annotation-select.component.test.ts`, `control-bar` option tests

**Interfaces:**
- Produces: `this.annotations` (color-by list, eat keys excluded) and new `@state() private _filterableAnnotations: string[]` (full list, passed to the query-builder).

- [ ] **Step 1: Test that eat keys are excluded from color-by but present in filter list**

Add a test building `_updateOptionsFromData` input data that includes an annotation with `runtime.role === 'eat-confidence'`; assert `this.annotations` excludes it and `this._filterableAnnotations` includes it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/control-bar/annotation-select.component.test.ts`
Expected: FAIL.

- [ ] **Step 3: Split the two lists**

In `control-bar.ts` `_updateOptionsFromData`: build the full key list, set `this._filterableAnnotations = fullList`, and set `this.annotations = fullList.filter((key) => data.annotations[key]?.runtime?.role !== 'eat-confidence')`. Bind the query-builder to `.annotations=${this._filterableAnnotations}` (~1017) and keep the color-by select bound to `.annotations=${this.annotations}` (~601). Ensure the default-annotation guard (~1366) and `data-renderer.ts` default selection pick from `this.annotations` so an eat key is never auto-colored.

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/control-bar/`
Expected: PASS.

```bash
git add packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/annotation-select.component.test.ts
git commit -m "feat(eat): keep __eat_confidence filterable but out of the color-by dropdown"
```

---

## Task 7: #6 — Evaluator NOT+null semantics (curated retained)

**Files:**
- Test: `packages/core/src/components/control-bar/query-numeric-helpers.test.ts`, `query-evaluate.test.ts`
- Modify: `packages/core/src/components/control-bar/query-numeric-helpers.ts` (doc comment only — behavior already correct)

**Interfaces:**
- Consumes: `matchesNumericValue(null, cond) === false`; `NOT` = index complement (re-includes nulls).
- Produces: characterization tests locking `NOT(x < X)` = keep null (curated) + `x >= X`.

- [ ] **Step 1: Write the characterization tests**

In `query-evaluate.test.ts`, add: data with a numeric annotation whose values are `[0.2, 0.8, null, null]` (two predictions, two curated). A query of one `NumericCondition {annotation, kind:'numeric', operator:'lt', max:0.5, logicalOp:'NOT'}` must yield the matching set `{1, 2, 3}` (0.8 kept; both nulls kept; 0.2 excluded). Add the mirror `operator:'lt', max:0.5` (no NOT) yields `{0}` only.

```ts
it('NOT(x < 0.5) keeps values >= 0.5 AND null-valued rows (curated retained)', () => {
  const data = makeNumericData('conf', [0.2, 0.8, null, null]); // helper per existing tests
  const q = [createNumericCondition({ annotation: 'conf', operator: 'lt', max: 0.5, logicalOp: 'NOT' })];
  expect([...evaluateQuery(q, data)].sort()).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run to verify current behavior**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/control-bar/query-evaluate.test.ts`
Expected: PASS (behavior already correct; these lock it in). If it FAILS, stop — the pivot's core assumption is wrong.

- [ ] **Step 3: Update the TODO comment**

In `query-numeric-helpers.ts`, update the `matchesNumericValue` doc `TODO` to note that the nullable numeric annotation (`__eat_confidence`) now ships and the `NOT + null + numeric` combination is intentionally used and tested (`NOT(conf < X)` retains curated null rows).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/components/control-bar/query-evaluate.test.ts \
  packages/core/src/components/control-bar/query-numeric-helpers.ts
git commit -m "test(eat): lock NOT(conf<X) filter semantics (curated null rows retained)"
```

---

## Task 8: #6b — Two-way slider ↔ filter mirror, default 0, persistence

**Files:**
- Modify: `packages/core/src/components/control-bar/control-bar.ts` (`setEatConfidenceThreshold`, `_handleQueryChanged`)
- Modify: `packages/core/src/components/legend/legend.ts` (slider default 0, event emit, popover copy)
- Modify: `packages/utils/src/visualization/eat-overlay.ts` (`DEFAULT_EAT_CONFIDENCE_THRESHOLD = 0`)
- Modify: `apps/web/src/explore/{runtime,dataset-controller,data-renderer,export-handler}.ts` (wire slider↔control-bar; drop threshold-only pass-through)
- Modify: `packages/utils/src/parquet/{settings-validation.ts,bundle-writer.ts}`, `packages/utils/src/types.ts` (persist default 0)
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (drop `eatConfidenceThreshold` plumbing that only fed dimming)
- Test: `control-bar.query-apply.test.ts`, `legend.eat-controls.test.ts`, `dataset-controller.eat.test.ts`, `interaction-controller.eat.test.ts`, `settings-validation.test.ts`, `bundle-writer.test.ts`

**Interfaces:**
- Consumes: `getEatConfidenceAnnotationKey(base)` / `isEatConfidenceAnnotationKey` from `@protspace/utils`; `createNumericCondition`.
- Produces: `control-bar.setEatConfidenceThreshold(baseKey: string, x: number): void` (upsert when `x>0`, remove when `x<=0`, then apply); reverse detection in `_handleQueryChanged` emits the slider value.

- [ ] **Step 1: Test forward slider → filter (upsert / remove at 0)**

In `control-bar.query-apply.test.ts`: calling `setEatConfidenceThreshold(eatKey, 0.5)` inserts a single `NumericCondition {annotation: eatKey, operator:'lt', max:0.5, logicalOp:'NOT'}` and applies it (updates `filteredProteinIds`); calling it again with `0` removes that condition and clears the filter (no eat condition remains).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @protspace/core exec vitest --run src/components/control-bar/control-bar.query-apply.test.ts`
Expected: FAIL (`setEatConfidenceThreshold` undefined).

- [ ] **Step 3: Implement forward + reverse mirror**

In `control-bar.ts`:

```ts
setEatConfidenceThreshold(baseKey: string, x: number): void {
  const key = getEatConfidenceAnnotationKey(baseKey);
  const next = this.filterQuery.filter(
    (item) => !(item.kind === 'numeric' && isEatConfidenceAnnotationKey(item.annotation)),
  );
  if (x > 0) {
    next.push(createNumericCondition({ annotation: key, operator: 'lt', max: x, logicalOp: 'NOT' }));
  }
  if (!queriesEqual(next, this.filterQuery)) {
    this.filterQuery = next;
    this._applyQuery(); // same path as _handleQueryApply
  }
}
```

In `_handleQueryChanged`, after updating `filterQuery`, detect the eat condition and emit the slider value with a compare-guard to avoid a loop:

```ts
const eat = findEatConfidenceCondition(this.filterQuery); // operator==='lt' && logicalOp==='NOT' && isEatConfidenceAnnotationKey
const derived = eat?.max ?? 0;
if (derived !== this._lastEmittedThreshold) {
  this._lastEmittedThreshold = derived;
  this.dispatchEvent(new CustomEvent('eat-threshold-mirror', { detail: { value: derived }, bubbles: true, composed: true }));
}
```

Add the small helpers `queriesEqual`, `findEatConfidenceCondition`, and the `_lastEmittedThreshold` field.

- [ ] **Step 4: Default threshold 0 + slider emits to control-bar**

In `eat-overlay.ts` set `export const DEFAULT_EAT_CONFIDENCE_THRESHOLD = 0;`. In `legend.ts`, start the slider at 0 and change `_setEatConfidenceThreshold` to emit the existing threshold-change event (do **not** set `scatterplot.eatConfidenceThreshold` for dimming). Update the info-popover copy from "dimmed" to "hidden/filtered". In `apps/web/src/explore/runtime.ts`, add a listener on the legend threshold event that calls `controlBar.setEatConfidenceThreshold(baseKey, value)`, and a listener on `eat-threshold-mirror` that sets the legend slider (two-way).

- [ ] **Step 5: Drop dimming-only plumbing + persistence default**

Remove `eatConfidenceThreshold` wiring that only fed dimming: in `scatter-plot.ts` (the property, vis-model key/inputs, gates, signature) and web pass-through (`export-handler.ts`, `data-renderer.ts`, `dataset-controller.ts`). In `types.ts`/`settings-validation.ts`/`bundle-writer.ts` keep the `eatConfidenceThreshold` **setting** but default it to `0`; on load, seed the slider (which derives the condition only when `> 0`).

- [ ] **Step 6: Run the affected suites**

Run: `pnpm --filter @protspace/core --filter @protspace/utils --filter @protspace/app test:ci`
Update `legend.eat-controls.test.ts`, `dataset-controller.eat.test.ts`, `interaction-controller.eat.test.ts`, `settings-validation.test.ts`, `bundle-writer.test.ts` for default 0 + the filter path. Expected: PASS.

- [ ] **Step 7: e2e + OpenSpec + commit**

Update `eat-visualization.spec.ts` reliability scenarios: dragging the slider now **hides** sub-threshold predictions (fewer visible points) rather than dimming; the filter box shows the `NOT(EAT_confidence < X)` condition; default shows all points. Update the OpenSpec reliability requirement (emphasis → filter; curated always retained; default 0).

Run: `pnpm --filter @protspace/app exec playwright test eat-visualization`
Run: `openspec validate add-eat-visualization --strict`
Expected: PASS.

```bash
git add -A
git commit -m "feat(eat): filter sub-threshold predictions via two-way slider<->query mirror (default off)"
```

---

## Task 9: Full verification + update PR

**Files:** none (verification + push).

- [ ] **Step 1: Full local gate**

Run: `pnpm precommit`
Run: `pnpm test:ci`
Run: `pnpm --filter @protspace/app exec playwright test eat-visualization`
Expected: all PASS (JS ~1838+ tests; Playwright green).

- [ ] **Step 2: Confirm hollow visually**

Use the `run` skill / launch the app and click through an EAT dataset: verify hollow rings read acceptably (dense-cluster show-through is expected), halos scale with Shape size, provenance status is silent when all-visible, no "No annotation" row, reliability slider filters (default shows all). If hollow looks wrong, flip `PREDICTED_INTERIOR_FILL` to `1.0` (one-char revert) and re-run Task 3 tests.

- [ ] **Step 3: Push to update PR #315 (fast-forward)**

```bash
git push origin cleanup/pr315-simplify-review           # sync staging branch
git push origin cleanup/pr315-simplify-review:agent/277-eat-overlay   # updates PR #315 (fast-forward)
```

- [ ] **Step 4: Watch CI green**

Run: `gh pr checks 315 --watch`
Expected: all required checks pass. PR is then ready to merge.

---

## Self-review notes

- **Spec coverage:** #1→Task 1; #2→Task 4; #3+#4→Task 3; #5→Task 2; #6a→Task 5; #6c→Task 6; #6 null semantics→Task 7; #6b + default 0 + persistence→Task 8; OpenSpec deltas folded into Tasks 2 & 8; verification→Task 9.
- **Identity consistency:** every eat-column check uses `runtime?.role === 'eat-confidence'` (Tasks 6, 8) — never the suffix.
- **Filter expression consistency:** `NumericCondition {operator:'lt', max:X, logicalOp:'NOT'}` in Tasks 7 and 8 match.
- **Naming:** `setEatConfidenceThreshold` (Task 8) is the same symbol referenced by the wiring in Task 8 Step 4; `DEFAULT_EAT_CONFIDENCE_THRESHOLD = 0` set once (Task 8) and consumed by legend + persistence.
