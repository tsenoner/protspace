# EAT visualization — UX refinements (PR #315 follow-through)

**Date:** 2026-07-20
**Branch:** `cleanup/pr315-simplify-review` (feeds PR #315, `agent/277-eat-overlay`)
**Status:** design approved; pending spec review → implementation plan

## Context

PR #315 adds the EAT (Embedding-based Annotation Transfer) overlay. Merging to
`main` **auto-deploys** the web app to protspace.app (`deploy.yml`, which only
path-ignores `apps/protspace/**` and `apps/prep/**` — the EAT web code is not
ignored). So these six refinements land **on the branch before merge**, so the
first thing users see is the intended UX.

Five are small polish; **#6 is a genuine pivot** (reliability emphasis → filter)
that touches many layers and the committed OpenSpec requirements.

## Goals

1. Make the provenance status text terse (silent unless something is off-view).
2. Make the green provenance halos scale with the "Shape size" control.
3. Thicken the EAT prediction rings.
4. Render EAT glyphs hollow (transparent center), trivially revertible to filled-white.
5. Drop the "No annotation" legend row (redundant with the NA label).
6. Replace reliability *dimming* with reliability *filtering*, driven by the query
   filter; remove `__eat_confidence` from the color-by dropdown but keep it filterable.

## Non-goals

- No change to the per-point tooltip (it still shows a prediction's confidence).
- No change to the provenance resolution / connector-drawing logic itself.
- No new bundle format version (persistence stays back-compatible).

---

## Item designs

### #1 — Terse provenance status text

**Where:** `packages/core/src/components/scatter-plot/scatter-plot.ts` — `_formatConnectorStatus` (~2013–2017). `getProvenanceConnectorStatus` and the `onStatusChange` dedup are **untouched** (their `{shown,total,missingEndpoints}` contract and controller tests stay valid).

**Change (revised):** the chip must not appear **at all** when every connection is
visible — so no `×` in that state either.
- Render the `.connector-status` chip (template ~2003–2016) only when
  `this._connectorStatus && this._connectorStatus.missingEndpoints > 0`; otherwise
  render nothing.
- When shown, its text is `` `${status.missingEndpoints} hidden (off-view)` `` and it
  keeps the `×` close button. `missingEndpoints` (off-view / unavailable endpoints) is
  the right count for the "(off-view)" label; the 20-pair fan-out cap is intentionally
  not reported (keeps it minimal).
- `_formatConnectorStatus` still returns the short text; the appear/disappear decision
  moves to the template guard.

**Dismiss when all-visible:** the `×` is gone, but connectors are dismissed by
**clicking away** — clicking empty space or a non-EAT point fires `handleProteinClick`
with no `proteinId` → `clearProvenance()` (`interaction-controller.ts:149`); they also
auto-clear on annotation/data/config changes (`scatter-plot.ts:563,674,1848`).

**a11y note:** with no persistent chip, the `aria-live` region only exists while some
connections are off-view. Acceptable trade-off for "no chip when all visible"; the
region still announces the "N hidden" message when it appears on a zoom/pan that pushes
endpoints off-screen.

**Tests:** `scatter-plot.provenance.test.ts` (old full string for
`{shown:0,total:1,missingEndpoints:1}` → `"1 hidden (off-view)"`; add an all-visible
case asserting the chip is absent). `apps/web/tests/eat-visualization.spec.ts` (lines
~530/546 assert "Showing 1 of 1"/"Showing 4 of 4" → now **no chip**; the "Close
provenance connections" ×-click at ~574 must move to a filtered/off-view scenario where
the chip is present, or dismiss the all-visible case via click-away instead).

### #2 — Green provenance halos scale with "Shape size"

**Where:** `packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.ts`. These are the `circle.eat-provenance-endpoint` halos (fixed `PROVENANCE_ENDPOINT_RADIUS_PX = 7`, held constant in screen space via `updateZoomScale`). They don't react to the point-size control.

**Change:**
- Add `getPointSize: () => number` to `ConnectorOverlayDeps`; wire it at the single
  construction site `scatter-plot.ts:262` as `getPointSize: () => this._mergedConfig.pointSize`.
- Replace the two `PROVENANCE_ENDPOINT_RADIUS_PX / this.zoomScale` uses (`render()` ~167,
  `updateZoomScale()` ~101) with a private helper `endpointBaseRadiusPx()` derived from
  the current point size (reuse the WebGL point-radius divisor of 3; add padding + a
  min), then `/ this.zoomScale` in both spots. Keep the `÷ zoomScale` so the halo stays
  constant through zoom (preserves the e2e invariant). Tune padding/min so the default
  `pointSize` (240) lands near today's 7px and the ring always sits just outside the point.
- No re-render wiring needed: `_reconcileConfigMerge` runs before
  `_reconcileProvenanceConnectors`, which already calls `render()` on a `config` change.

**Parity:** none — halos are a live, click-driven SVG overlay; no export/publish code
draws them.

**Tests:** `connector-overlay-controller.test.ts` (hard-coded radii 7 @zoom1 / 2.8
@zoom2.5 → recompute for the point-size formula; the 4-dep constructor needs the new
dep as optional-with-default or every call site updated). `eat-visualization.spec.ts`
constant-through-zoom assertion must still hold.

**Risk:** the point-radius divisor (3) is duplicated (`scatter-plot.ts:85`,
`stage-point.ts:12`) — cross-reference it in a comment (or share it) to avoid drift.

### #3 — Thicker EAT rings  &  #4 — Hollow glyphs

**Where:** `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts`
`POINT_FRAGMENT_SHADER` — the **single** shader source compiled by BOTH the live
renderer (`webgl-renderer.ts` `initializePointShaders`) and the export renderer
(`export-renderer.ts`). Editing it changes live + export together; **do not** create a
second copy.

**#3 (thicker):** raise the one thickness knob `float ringWidth = clamp(aa * 1.75, 0.22, 0.42);`
(~line 120). The min clamp (0.22) dominates at typical sprite sizes → bump it (≈0.30)
and the max (≈0.55); optionally the `aa` multiplier. `interiorAa` auto-derives, keep
`ringWidth` max well under 1.0 so the center hole doesn't vanish.

**#4 (hollow, single-flag revertible):** add one GLSL const near the top of the shader:
`const float PREDICTED_INTERIOR_FILL = 0.0; // 1.0 = filled knockout (old), 0.0 = hollow`,
and thread it through the two center-composite lines only:
- `float finalAlpha = mix(v_color.a, PREDICTED_INTERIOR_FILL, predictedInterior) * shapeAlpha;`
- `... mix(finalColor * v_color.a, linearKnockoutColor * PREDICTED_INTERIOR_FILL, predictedInterior) * shapeAlpha;`

`FILL=1.0` is byte-equivalent to today (opaque knockout center); `FILL=0.0` makes the
center premultiplied `(0,0,0,0)` → transparent. **Ship at 0.0 (hollow).** Reverting the
A/B test = flipping that one value; it governs live + export at once.

**Risk (expected):** hollow re-introduces the artifact the knockout suppressed — with
premultiplied-over blend and depth-mask off, dense/overlapping predicted glyphs can let
underlying points show through and read as filled again. This is the reason to A/B test,
not a bug. `u_knockoutColor` becomes inert for the center (kept plumbed).

**Tests:** `export-shaders.test.ts` (string-match asserts on the exact shader
substrings → update). `eat-visualization.spec.ts` (pixel test asserts center opaque +
white, e.g. `predicted[3]===255`, `distanceFromWhite<20`, bg-match on dark/transparent
export → **invert** those center assertions for hollow: center becomes transparent /
shows the background through; ring assertions are threshold-based and likely still hold,
verify the ring-sample offset). `export-renderer.test.ts`.

### #5 — Remove the "No annotation" legend row

**Where:** `legend.ts` (~2223–2227, the third `eat-legend-row`),
`eat-population-counts.ts`, `legend/styles/layout.ts` (~214–218 dead CSS).

**Change:**
- Delete the third row (the `.eat-swatch.missing` + "No annotation" + `${missing}`).
  Keep Observed and "Predicted by EAT".
- Remove `missing` from `EatPopulationCounts` (interface + `let missing`/`else missing += 1`).
  **Keep** the `hasObservedValue` NA-check — `observed` still needs it (a non-predicted
  protein whose only value is `__NA__` must not count as observed). `total` may stay or go.
- Remove the dead `.eat-swatch.missing` CSS rule.

**Note:** Observed + Predicted will no longer equal the represented population — intended,
since `__NA__` is already its own legend category.

**Tests:** `eat-population-counts.test.ts` (drop the `observed+predicted+missing===total`
invariant, rewrite for the two-bucket shape). `legend.eat-controls.test.ts`,
`eat-visualization.spec.ts` ("No annotation" row references removed).

### #6 — Reliability: emphasis (dim) → filter

**(a) Remove dimming.** `packages/core/src/components/scatter-plot/styling/visibility-model.ts`
— delete the `if (eatOverlayEnabled) { … EAT_BELOW_THRESHOLD_FACTOR … }` branch in
`baseOpacityOf` so predicted points fall through to `return opacities.base` (identical to
observed). Both live + export read this via `style.getOpacity`, so parity is automatic and
**no shader edit is needed** (the shader's predicted/knockout code is orthogonal — leave it).
Then remove the now-dead inputs: the hoisted `predictedCells`, the
`eatOverlayEnabled`/`eatConfidenceThreshold` `VisibilityInputs` fields + destructure/defaults,
and the `EAT_MIN_OPACITY`/`EAT_MAX_OPACITY`/`EAT_BELOW_THRESHOLD_FACTOR` imports + constants
(`eat-overlay.ts:19–21`) + their utils re-exports.

**(b) Slider → query filter (two-way mirror).** Represent the threshold as a
`NumericCondition` on the base annotation's eat-confidence key: `operator:'lt'`, `max: X`,
`logicalOp:'NOT'` — i.e. `NOT(EAT_confidence < X)`, which keeps curated + predictions ≥ X.
- **Forward (slider → query):** a public control-bar method (`setEatConfidenceThreshold(baseKey, x)`)
  **upserts** the condition when `x > 0` and **removes** it when `x <= 0`, then runs the same
  apply path as `_handleQueryApply` so `filteredProteinIds` updates. Wire the legend's existing
  threshold-change event to it via the web app (`explore/runtime.ts`).
- **Default = 0 (no filter).** Change `DEFAULT_EAT_CONFIDENCE_THRESHOLD` from `0.5` to `0`,
  so the slider starts at 0, **no eat-confidence condition is created**, and every point
  (curated + all predictions) is visible by default. The condition only exists once the user
  drags above 0, and disappears when dragged back to 0 — so the default filter box stays clean.
- **Reverse (query → slider):** in `_handleQueryChanged`, detect an eat-confidence
  `NumericCondition` (`operator==='lt' && logicalOp==='NOT'`) and set the slider. Guard both
  directions with a value-compare to avoid a feedback loop.
- Update the slider info-popover copy from "dimmed" to "hidden/filtered".

**(c) Dropdown split.** `control-bar.ts` `_updateOptionsFromData`: keep building the full
key set; derive the color-by list (`this.annotations`) by additionally filtering out
eat-confidence keys, and add a second `_filterableAnnotations` (full list) passed to the
query-builder. Keep the default-annotation guard selecting from the color-by list so an
eat key is never auto-colored.

**Identity.** Match the eat-confidence column by `annotation.runtime?.role === 'eat-confidence'`
(authoritative), not the `__eat_confidence` suffix — this also handles
`allocateEatConfidenceAnnotationKey`'s `__runtime_N` collision variant and removes the
dual-identity smell noted in the earlier review.

**Null semantics.** `NOT(conf < X)` uses the evaluator's index complement, which
**re-includes null-confidence (curated) proteins** — exactly the "keep curated" choice.
This is the untested `NOT + null + numeric` path flagged in `query-numeric-helpers.ts`;
add evaluator tests covering it.

**Persistence.** Keep `eatConfidenceThreshold` in bundle settings as the saved slider
position (no format change, back-compatible), **defaulting to 0**. On load it seeds the
slider, which derives the filter condition only when `> 0`; a bundle without the field (or
with `0`) applies no filter. The two-way mirror keeps them in sync during a session.
(Manual removal of the filter condition mid-session is the live truth; the saved value is
just the slider's last position.)

**Where (surface):** `visibility-model.ts`, `scatter-plot.ts` (drop the
`eatConfidenceThreshold` plumbing that only fed dimming), `legend.ts` (+ styles) for the
slider, `control-bar.ts`, `query-types.ts`/`query-evaluate.ts`/`query-numeric-helpers.ts`,
`apps/web/src/explore/{runtime,dataset-controller,data-renderer,export-handler}.ts`,
`@protspace/utils` settings/eat-overlay.

**Tests:** `visibility-model.test.ts` (assert predicted === `opacities.base`, drop dimming
values), `query-evaluate.test.ts` / `query-numeric-helpers.test.ts` (add NOT+null+numeric),
`control-bar.query-apply.test.ts`, `annotation-select(.component).test.ts`,
`legend.eat-controls.test.ts`, `dataset-controller.eat.test.ts`,
`interaction-controller.eat.test.ts`, `settings-validation.test.ts`,
`bundle-writer.test.ts`, `eat-visualization.spec.ts`.

---

## Cross-cutting

**OpenSpec.** `openspec/changes/add-eat-visualization/` is a committed, not-yet-archived
change. Update its deltas to match:
- `spec.md` / `design.md`: population model 3 → 2 (drop the "No annotation" class + the
  "observed + transferred + no-annotation = population" invariant).
- reliability requirement: "emphasis/dimming of sub-threshold predictions" → "filtering
  via a `NOT(EAT_confidence < X)` query condition; curated always retained".
- Re-run `openspec validate add-eat-visualization --strict`.

**Verification gate (each step).** `pnpm precommit` (lint-staged + type-check + knip +
docs) + the affected Vitest suites + the Playwright `eat-visualization.spec.ts` + fast
Python suite where relevant.

## Sequencing

Land in this order, all on the branch before merge:
1. #1 status text, #5 no-annotation row (isolated, tiny).
2. #3 thicker ring + #4 hollow (one shader file; update pixel test).
3. #2 halo scaling.
4. #6 reliability pivot (largest; visibility-model → query filter → dropdown → wiring →
   settings → OpenSpec → test rewrites).

Then full verification, update PR #315, confirm CI green, and it's ready to merge.
