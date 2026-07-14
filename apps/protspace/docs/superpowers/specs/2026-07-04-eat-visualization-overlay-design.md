# Design: EAT visualization — provenance source overlay (backend) + frontend rendering spec

**Status:** Approved (2026-07-04) — backend change small; frontend delivered as `protspace_web` GitHub issues.
**Date:** 2026-07-04
**Trigger:** Team discussion (Wed 2026-07-01) on how to visualize Embedding Annotation
Transfer (EAT) in the web app. Builds on the backend from
[PR #55](https://github.com/tsenoner/protspace/pull/55) (spec:
`2026-06-11-eat-annotation-transfer-design.md`) and the frontend issue
[tsenoner/protspace_web#277](https://github.com/tsenoner/protspace_web/issues/277).

---

## 1. Context

`protspace transfer` (PR #55) fills missing annotation values on query proteins from
their nearest annotated reference in pLM embedding space, and writes a per-cell overlay
into the `.parquetbundle` annotations table. Today, per transferred column `COL`:

- `COL__pred_value` (string) — the transferred label
- `COL__pred_confidence` (float32) — goPredSim reliability index in `[0, 1]`

`protlabel`'s `Prediction` dataclass already computes `source_id` (the reference the
label came from), but PR #55 review **dropped** it from the overlay, judging a per-cell
source id "noise as a colour feature." Issue #277 records this and notes that any
"transferred from `<neighbour>`" affordance would need the backend to re-add it.

The Wednesday discussion settled the EAT UX and, in doing so, made the source id a
first-class need again — as **provenance** (a connector line + tooltip), explicitly
*not* as a colour feature. This document captures those decisions, the one backend
change they require, and the frontend spec that becomes the GitHub issues.

## 2. The dimensionality-reduction question (answered from the code)

> "Should EAT-annotated proteins be part of the DR computation, or only projected into
> the space? What is the current implementation?"

**Current implementation: they are part of the DR computation.** `protspace transfer`
runs on an *already-built* bundle. Every protein — query *and* reference — was projected
together in a single `prepare`/`project` run; the projection coordinates already exist
for all of them. `transfer` only fills missing annotation *values*; it never re-projects
or adds points. The kNN that drives the transfer runs in the **original embedding space**
(from the HDF5), **not** in the 2-D/3-D projection (non-linear DR is not isometric, so
"nearest in UMAP" ≠ "nearest in embedding space").

**Consequences for the UX:**

- Both endpoints of any provenance line (a query and its reference source) are real,
  co-embedded points already present in the projection — so the dashed-line feature is
  well-defined with no extra projection math.
- A query point's *position* reflects the joint embedding+DR of the whole set, while its
  *transferred label* reflects nearest-neighbour in the true embedding space. These can
  visually disagree (a query may sit far from its label's cluster in the projection yet
  still be nearest in embedding space) — the connector line makes that relationship
  legible, which is a feature, not a bug.
- An "out-of-sample" mode (project queries into a *reference-only* DR space via a
  parametric transform) is a **separate future feature**, not implied by the current
  workflow. See §8.

## 3. Decisions

- **D1 — DR:** Keep the current behaviour (queries are part of the joint DR). Document
  it (§2); no code change. Out-of-sample projection is out of scope (§8).
- **D2 — Re-add source:** `add_overlay_columns` writes `COL__pred_source` (string, the
  reference protein id, null for non-predicted cells). Source id only — no distance, no
  metric/k persisted (see D6).
- **D3 — Storage stays inline:** predictions remain inline `COL__pred_*` columns in the
  annotations table. A dedicated 5th parquet part was **rejected**: the bundle format is
  a strict positional contract (parts 0/1/2 = core, part 3 = optional settings) and both
  readers hard-reject `>4` parts (`bundle.py:119`; the web reader counts delimiters
  identically), so a new part is a breaking cross-repo format bump with no benefit this
  feature can't get for free. See §8 for the extensible-format follow-up.
- **D4 — Reserved `__pred_` namespace:** the *frontend* treats `__pred_` as a reserved
  suffix namespace — it pivots `COL__pred_value/confidence/source` into a dedicated
  per-cell `annotation_predicted` channel and **does not** register them as selectable
  color-by annotations. This is what keeps predictions out of the dropdown (the user's
  goal) without any format change. Storage location (annotations table) and dropdown
  visibility are decoupled: the latter is a frontend routing choice.
- **D5 — Confidence is not banded in the backend:** `COL__pred_confidence` stays a raw
  float. The web app already auto-detects numeric columns and colours them with a
  gradient ramp, so "confidence as a selectable annotation" works with no backend
  binning. Threshold banding (High/Med/Low) is a frontend display concern (#277 slider).
- **D6 — Metric/k not persisted per cell:** there is no natural per-column metadata
  channel in the annotations parquet, and cosine is the default. The frontend caveat
  text ("confidence is a reliability-index ranking, calibrated for cosine") can be
  generic. Persisting the metric for a calibrated caveat is a possible future addition
  (§8), not part of this change.

## 4. Backend change (this repo, `feat/eat-transfer-backend`)

Surgical, backward-compatible.

- **`src/protspace/data/io/predictions.py`** — `add_overlay_columns` appends a third
  column `COL__pred_source` (string), aligned by identifier, `null` for non-predicted
  rows, sourced from `Prediction.source_id`. It is already dropped-and-replaced on
  re-run alongside the other two (the stale-column cleanup list already includes it).
  Update the module docstring: source id is now emitted as **provenance** (connector
  line / tooltip), explicitly not as a colour feature.
- **`tests/test_predictions_overlay.py`** — flip the assertions that require
  `__pred_source` to be *absent* into asserting it is present and correctly aligned
  (value = `source_id` for predicted rows, `null` otherwise); keep the
  re-run-replaces-not-duplicates guarantee (now covering all three columns).
- **Docs** updated to describe three overlay columns:
  `docs/annotations.md` (overlay table), `docs/cli.md` (transfer section),
  `notebooks/ProtSpace_Transfer.ipynb` (intro + inspection cells),
  `docs/superpowers/specs/2026-06-11-eat-annotation-transfer-design.md` §4,
  `data/eat_demo/README.md`.
- **Regenerate `data/eat_demo/phosphatase_eat.parquetbundle`** with the new format (the
  frontend-testable deliverable). Command per its README (euclidean pinned to preserve
  the documented accuracy numbers).

No change to `protlabel`, the CLI surface, the classifier, or the bundle format.

## 5. Frontend spec (`protspace_web`) — every decision → a verified hook

Two orthogonal prediction axes must never be conflated (from #277):

- **Axis A (existing, PR #272): column-level** — "this whole column is a model output"
  (⚡ badge, driven by `isPredictedAnnotation()` / `annotation-metadata.ts`). Unchanged.
- **Axis B (this work): cell-level** — "this specific protein's value in `COL` was
  transferred from a neighbour, with confidence X, from source Y." A separate data
  channel, its own glyph, its own render sites. Never reuse the ⚡ column badge.

### 5.1 Reserved `__pred_` namespace + data model (D4)

- **`packages/core/src/components/data-loader/utils/conversion.ts`** — when building
  `VisualizationData`, detect `COL__pred_value` / `COL__pred_confidence` /
  `COL__pred_source` companion columns, pivot them onto their base `COL` into a new
  per-cell channel, and **exclude the `__pred_*` columns from `data.annotations`** (the
  dropdown source). Old bundles without them → no overlay (backward compatible).
- **`packages/utils/src/types.ts`** — add
  `annotation_predicted?: Record<string, PredictedCell[]>` (keyed by base column, indexed
  by protein), modelled on the existing per-cell `annotation_scores` / `annotation_evidence`
  side-channels. `PredictedCell = { value: string; confidence: number; source: string } | null`.
- Thread the channel through the same ~4 sites the existing side-channels use:
  `plot-data-accessors.ts`, `slice-visualization-data.ts`, `storage/data-hash.ts`,
  and the tooltip view builder.
- A cell is **predicted** for `COL` when `COL` is empty/blank and its `PredictedCell` is
  non-null.

### 5.2 EAT overlay mode toggle (Wednesday: on/off switch next to annotations)

- New ON/OFF toggle inside the annotation `.control-group`
  (`packages/core/src/components/control-bar/control-bar.ts:595-606`), directly beside
  `<protspace-annotation-select>`. Model on the existing segmented `tool-toggle` pattern
  (`control-bar.ts:656-701` + `styles/layout.ts:85-121`; add `role="switch"` — none
  exists today).
- **Enabled only when** the bundle has EAT prediction data (any base column with a
  populated `annotation_predicted` channel). Disabled + explanatory title otherwise.
- Mirror `applyAnnotationSelection` (`control-bar.ts:259-283`): set state → push to the
  scatterplot when `autoSync` → dispatch `eat-overlay-change`.

### 5.3 Dual rendering — observed filled, predicted hollow (Wednesday: single view)

- When the overlay is ON and colouring by `COL`, the **effective category** of a cell is
  `coalesce(COL, COL__pred_value)`, so predicted cells take the colour of their
  transferred label (and legend/palette are built from the union of observed + predicted
  values).
- **Predicted cells render as hollow (outline-only) markers** in the category hue;
  observed cells stay filled. Reuse the fragment shader's SDF edge-distance math
  (`scatter-plot/webgl/renderer/export-shaders.ts`); add an `a_predicted` vertex
  attribute (`point-attributes.ts`) and branch `getPointShape`/`getOpacity`
  (`styling/style-getters.ts`). Confidence → opacity ramp (`alpha = lerp(0.25, 0.9,
  confidence)`); desaturate toward grey below ~0.3. Never colour-only (accessibility).
- Grayscale/PNG export must preserve the hollow-vs-filled distinction.

### 5.4 Confidence as a selectable annotation (Wednesday: show it separately)

- Surface a synthetic selectable annotation per transferred column (e.g. label
  "`<COL>` — EAT confidence") sourced from the `PredictedCell.confidence` values. The
  numeric-annotation path already colours it with a gradient ramp (batlow, quantile-binned
  — `numeric-binning.ts`) with no further work. Non-predicted cells → the numeric "NA"
  bin.
- Do **not** expose the raw `COL__pred_confidence` column directly (D4 keeps `__pred_*`
  out of the dropdown); the synthetic entry is the deliberate, well-labelled opt-in.

### 5.5 Provenance connector lines (Wednesday: dashed line on click) — **new issue**

The novel piece. Feasibility confirmed against the codebase (low-to-moderate effort;
reuses the existing SVG overlay + line primitive).

- **Interaction:** on `protein-click` (`scatter-plot.ts:1596-1622`, detail carries id +
  coords + view):
  - clicking a **predicted** protein → draw a dashed line to its `PredictedCell.source`
    (the reference it was transferred from), for the currently-selected column;
  - clicking a **reference** protein that was used as a source → draw dashed lines to
    **all** query proteins whose `source` equals it (an inverted `source → [queries]`
    index built once from the channel).
- **Rendering:** reuse the existing SVG overlay layer (z-index 3) and the `<line>`
  primitive already used for spiderfy leader lines
  (`duplicate-stacks/spiderfy-layer.ts:76-85`). Draw into a new `g.connector-lines-layer`
  child of `overlayGroup`, in **base-pixel space** (`scales.x/y` of each endpoint's
  coords) so the group's zoom transform pans/zooms it for free; `stroke-dasharray` +
  `vector-effect: non-scaling-stroke` for a constant dashed stroke.
- **Build (new):** (1) an `id → proteinIndex` map from `data.protein_ids` (none exists
  today), then read `projections[selectedProjectionIndex].data` for coords (mirror
  `scatter-plot.ts:_updatePlotDataCoordinates:1008-1044`, honouring `projectionPlane` for
  3-D-as-slice); (2) a small `ConnectorOverlayController` peer to
  `DuplicateStackOverlayController`; (3) a public `setConnectors(pairs)` / `clearConnectors()`
  API; recompute on projection/plane/data change (alongside `_updateSelectionOverlays`),
  **not** on pan/zoom.
- Reuse the existing, under-used `highlightedProteinIds` state (`scatter-plot.ts:108`) to
  emphasize the connected points in tandem with the lines.
- **2-D only** problem: 3-D projections render as an orthographic slice, so both
  endpoints use the same plane mapping — no camera math.
- Guard the reference→many-queries case (a popular reference could connect to hundreds of
  queries): cap + "show N of M" affordance, or require the click to originate from a
  predicted point by default.

### 5.6 Legend

- New "**Predicted (transferred)**" sub-section (distinct from the Axis-A ⚡ header
  badge): filled "Observed" / hollow "Predicted by EAT" swatches + live counts. Insert in
  `legend.ts render()` between the header (`:2079`) and `renderLegendContent` (`:2080`);
  counts computed alongside `_updateLegendItems` from the `annotation_predicted` channel.

### 5.7 Tooltip

- Provenance line in `protein-tooltip.ts` (`renderAnnotationBlock:71-110`), e.g.
  `⚡ Predicted: Neurotoxin (82%), from P12345`, with an inline confidence bar. Add
  `predictionProvenance?` to `AnnotationBlock` (`plot-data-accessors.ts:83-90`), populated
  from the new channel. Reuse the ⚡ glyph but **not** the column-level badge component.

### 5.8 Settings persistence

- Persist the overlay's global display state (`eatOverlayEnabled`, confidence threshold)
  as a **global slot on `BundleSettings`** (`packages/utils/src/types.ts:183-188`),
  parallel to `publishState` — this is a global mode, not per-annotation. Required touch
  points (a new global field is silently dropped otherwise): the `BundleSettings` type;
  `isNormalizedBundleSettings` / `normalizeBundleSettings`
  (`settings-validation.ts`); the `hasBundleSettings` write-gate
  (`bundle-writer.ts:154-163`) so a bundle carrying only this field still writes part 4;
  the write path (`export-handler.ts:199-221`); and — unlike the currently-latent
  `publishState` read-back — **actually apply it on load** in `dataset-controller.ts:~145`.

## 6. Issue plan (`protspace_web`)

- **Update #277** (base value-level overlay): flip the "source dropped" caveat to
  "source re-added → provenance available"; add the DR clarification (§2); add the D4
  reserved-`__pred_`-namespace requirement (predictions never enter the color dropdown);
  fold in confidence-as-selectable-annotation (§5.4); cross-link the new provenance issue.
- **New issue — "EAT provenance connector lines"** (§5.5): the dashed-line feature.
  Depends on #277's `annotation_predicted` channel + the new `__pred_source` column.
- Add both to the **ProtSpace Development** project (`tsenoner` #2).
- Attach the regenerated `phosphatase_eat.parquetbundle` so frontend devs have real test
  data.

## 7. Deliverables

1. This design doc (committed).
2. Backend: `predictions.py` + tests + docs + notebook updated; `pytest -m "not slow"`
   and `ruff` green.
3. Regenerated `data/eat_demo/phosphatase_eat.parquetbundle` (3-column overlay).
4. #277 updated; new provenance-lines issue created; both on the project board; bundle
   attached.

## 8. Future considerations (explicitly out of scope here)

- **Extensible / versioned bundle format.** Make readers content-identify parts (settings
  = has `settings_json`; predictions = has a predictions schema) and ignore unrecognized
  parts, plus a `format_version` for graceful "please update" messages. This would make
  every *future* auxiliary part additive and non-breaking — but it is itself a
  coordinated cross-repo breaking change touching the platform's most fundamental data
  contract, so it deserves its own design and PR rather than riding in on EAT. Migration
  is cheap: predictions' in-memory `annotation_predicted` channel is identical whether
  sourced from inline columns or a dedicated part, so moving storage later is a small,
  localized change.
- **Out-of-sample projection.** Projecting query proteins into a reference-only DR space
  (parametric UMAP / PCA transform) so references define the map and queries are placed
  into it. A distinct workflow from today's joint DR (§2).
- **Richer provenance:** neighbour distance per cell; persisted metric/k for a calibrated
  confidence caveat (D6); `k > 1` multi-source lines.

## 9. Non-goals

- No change to the Axis-A column-level ⚡ badge (PR #272).
- No bundle-format change; no new parquet part (D3).
- No backend confidence banding (D5); no per-cell metric/k (D6).
- No frontend implementation in this repo — frontend ships via the `protspace_web`
  issues above.
