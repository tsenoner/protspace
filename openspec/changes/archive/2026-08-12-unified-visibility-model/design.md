# Design: Unified point-visibility model

All file:line citations below were verified against the current working tree of branch
`refactor/control-bar-and-filtering` (not `main`) by a multi-agent code audit, including
an adversarial re-verification pass.

## Context

The scatter plot reduces points on screen through two distinct enforcement layers:

- **Cull layer** — query filter (`filteredProteinIds`/`filtersActive`) and isolation
  physically remove points in `DataProcessor.processVisualizationData`
  (`packages/utils/src/visualization/data-processor.ts:14-41`), preserving the **global**
  `originalIndex`. Culling shrinks scale domains (axes re-fit).
- **Alpha layer** — legend-hide and selection fading set per-point opacity in
  `style-getters.ts`; hidden points stay in `_plotData` and in GPU buffers with alpha=0
  (`scatter-plot.ts:529-538`, `webgl-renderer.ts:1823-1831`), so hiding never re-fits
  axes and the renderer keeps its color-only fast path.

These layers are load-bearing UX: they must stay distinct. What is broken is that the
_alpha layer plus the interactivity predicate_ is re-derived independently at many call
sites with no shared model.

## Goals / Non-Goals

**Goals**

- One pure, unit-testable module computes per-point display state; every consumer reads it.
- Bit-for-bit behavior preservation, including perf characteristics of the WebGL fast paths.
- An input shape (`VisibilityInputs`) that a future shared store (audit Step 2 /
  Approach B) can produce unchanged.

**Non-Goals**

- No change to physical culling, component communication, events, persistence, or URL state.
- No fix for export-utils' divergent hidden re-derivation (`export-utils.ts:436-479`
  lacks the all-hidden hatch, and treats zero-annotation-value points as visible unless
  `__NA__` is hidden (:457-458) where style-getters' vacuous-truth rule hides them;
  aligning it would be a behavior change — deferred, tracked in the audit).
- No SelectionStore, no boolean query tree, no legend "Other" restructuring.

## Decisions

### D1 — Pull-based, memoized model (not lifecycle-recomputed)

The model is computed lazily through a private accessor and memoized on input identity.
A push-based recompute in a Lit lifecycle hook is incorrect three ways, all verified:

1. The component has **no `willUpdate`**; all reactive logic is in `updated()`
   (`scatter-plot.ts:415`), which _self-mutates_ filter props mid-pass on dataset swap
   (`scatter-plot.ts:454-457`) so the synchronous `_processData` read sees them cleared —
   a hook-computed model would see pre-reset state while `DataProcessor` sees post-reset
   state for one cycle.
2. `isolateSelection` push-mutates `_isolationHistory` in place and calls
   `_processData`/`_buildQuadtree` synchronously **outside** the Lit cycle
   (`scatter-plot.ts:2277-2283`); `resetIsolation` (:2385-2389) and the numeric-rebin rAF
   callback (:749) do the same. `changedProperties` can never trigger these.
3. The pinned tests construct **unattached** elements where lifecycle never runs
   (`scatter-plot.filter-render.test.ts:14-16`, `scatter-plot.isolation.test.ts:5-22`);
   filter-render additionally calls `sp._processData()`/`sp._buildStyleGetters()`
   directly (:85-86). A lifecycle-initialized model would be permanently stale there.

A lazy reference-keyed memo is correct at all of these call sites with zero new
invalidation plumbing, and is immune to the 60 Hz `_transform`/`_tooltipData` reactive
churn during pan/zoom/hover (`scatter-plot.ts:937,1922`).

Memo keys: materialized-data reference, `selectedAnnotation`, `hiddenAnnotationValues`
reference (the sync controller assigns fresh arrays: `scatterplot-sync-controller.ts:115`),
selection/highlight references, and the opacities config. The expensive hidden-mask part
is additionally memoized on just (data ref, annotation, hidden ref) so selection-only
changes never redo the O(N) pass.

### D2 — Module interface

```ts
// packages/core/src/components/scatter-plot/visibility-model.ts
// Pure: importable under jsdom; no DOM, no WebGL, no Lit.
export type DisplayTier = 'hidden' | 'faded' | 'base' | 'selected';

export interface VisibilityInputs {
  data: VisualizationData | null; // MATERIALIZED, un-query-filtered display data
  selectedAnnotation: string;
  hiddenAnnotationValues: string[]; // raw values; normalized via toInternalValue inside
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  opacities: { base: number; selected: number; faded: number };
}

export function computeVisibilityModel(inputs: VisibilityInputs): VisibilityModel;

export interface VisibilityModel {
  allHidden: boolean;
  tierOf(point: PlotDataPoint): DisplayTier; // hidden beats selected
  opacityOf(point: PlotDataPoint): number; // exact 0 for hidden — load-bearing
  baseOpacityOf(point: PlotDataPoint): number; // ignores hidden — feeds getDepth
  isInteractive(point: PlotDataPoint): boolean; // ≡ opacityOf(point) > 0 (numeric)
}
```

- **Four tiers, not three.** The live opacity domain is `{0, faded, base, selected}`;
  the renderer keys two-pass selection rendering off `opacity >= 0.99`
  (`webgl-renderer.ts:1841`) and shader borders off `alpha > 0.5` (:175). The model
  exposes exact numerics; the tier enum is a convenience view that never collapses
  `selected` into `base`.
- **`isInteractive` stays numeric.** `fadedOpacity` is configurable
  (`config.ts:12`, `packages/utils/src/types.ts:80-82`); with `fadedOpacity: 0`, faded
  points are non-interactive today. The predicate is `opacityOf(point) > 0` — same as
  every current gate — defined in exactly one place.
- **The renderer-capacity gate stays outside the model.** `isPointRendered(id)`
  (`webgl-renderer.ts:403-405`) is a renderer-mechanical constraint, not visibility
  semantics; hover/click keep composing it after `isInteractive`
  (`scatter-plot.ts:2003,2062`).

### D3 — Internal representation and the 573K perf budget

The hidden mask is computed by precomputing a per-_bin_ hidden lookup over
`annotation.values` (at most a few hundred entries), then one allocation-free pass over
`annotation_data` filling a `Uint8Array` sized to the **full** dataset and indexed by
global `originalIndex` (gaps for culled points are normal — `_plotData` is
query/isolation-culled but keeps global indices, `data-processor.ts:22-26`). Note
`annotation_data` has two storage shapes (`packages/utils/src/types.ts:43`:
`Int32Array | readonly (readonly number[])[]`): the Int32Array shape holds at most one
value per point (sentinel `< 0` = no value) and is a direct walk; the nested-array shape
is where multilabel points live, walked per-point over the row's bin ids with the same
per-bin lookup — still no string materialization either way. The pass must not call
`getProteinAnnotationValues` per point: that allocates two arrays plus a string per
call (`plot-data-accessors.ts:11-26`, `annotation-data-access.ts:15-18`) and is the hot
path being replaced. Selection/fade tiers are answered via `Set` membership per call —
no O(N) array is built for selection, so selection changes cost what they cost today
(the renderer's existing per-point style pass), not more.

### D4 — Wiring

1. `createStyleGetters` gains an **optional** `model?: VisibilityModel` parameter: when
   provided (the component path) it delegates to it; when absent it computes one from its
   existing inputs, so current direct callers — including the whole
   `style-getters.test.ts` suite — stay source-compatible and green unchanged.
   `getOpacity`/`getBaseOpacity` become delegations. `getColors`, `getPointShape`,
   `getDepth`, z-order, "Other" handling are untouched. The `WebGLStyleGetters` shape
   (`webgl/types.ts:8-16`, `getOpacity: (point) => number`) is unchanged — the renderer
   needs zero edits.
2. `scatter-plot.ts` gains `_getVisibilityModel()` (the memoized accessor) and the five
   predicate sites (quadtree build :888, lasso :1259, brush :1276, hover :1997,
   click :2057) switch to `model.isInteractive(d)`.
3. `_getOpacity` and `_getPointsForRendering` keep their names as facades:
   `webgl-render-perf.ts:555-566` and `app/tests/brush-selection.spec.ts:323-325` reach
   into them as private members.
4. The renderer invalidation contract is untouched: hidden-only change still triggers
   `invalidateStyleCache` + `setStyleSignature` only (`scatter-plot.ts:519-527`);
   annotation/"Other" changes additionally invalidate the position cache (:533-538);
   data/filter/projection/isolation/resize invalidate both (:474-475, 1012-1014,
   2287-2288, 2393-2394).
5. `DataProcessor`, `_getVisibleProteinIdsSet` (`scatter-plot.ts:279-282` — `null` when
   filters off vs `new Set(...)` when on, a semantic distinction: empty set = blank
   plot), `data-change` payloads (hidden values must keep appearing in legend counts),
   sync controllers, and persistence are all untouched.

### D5 — Semantics preserved bit-for-bit (the model's unit-test contract)

| #   | Rule                                                                                                                                                                                                                                                                                                      | Today's source                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Hidden ⇒ opacity exactly `0` — consumers gate with a mix of comparisons that agree only at exact 0: shader discard `a < 0.001` (`webgl-renderer.ts:147`), export cull `=== 0` (:1249), tracking `> 0` (:1853-1855), quadtree `> 0` (`scatter-plot.ts:888`), hover/click `=== 0` rejections (:1997, :2057) | `style-getters.ts:191-193`                          |
| 2   | Hidden beats selected/highlighted — the hidden check precedes base opacity                                                                                                                                                                                                                                | `style-getters.ts:191-195`                          |
| 3   | Multilabel: hidden only if **every** value is hidden (`.every`)                                                                                                                                                                                                                                           | `style-getters.ts:192`                              |
| 4   | Vacuous truth: a point with **zero** annotation values is hidden whenever an annotation is selected and `!allHidden` — even with an empty hidden set (`[].every()` is `true`; reachable via Int32Array sentinel < 0, `annotation-data-access.ts:15-18`)                                                   | `style-getters.ts:191-192`                          |
| 5   | All-hidden escape hatch: when every value of the selected annotation is hidden, the hidden filter is ignored for **opacity** but **not** for colors — `getColors` drops all values and the renderer falls back to `#888888` (`webgl-renderer.ts:1862`)                                                    | `style-getters.ts:92-102,151-157,191`               |
| 6   | Values compare as internal keys: `toInternalValue` on both sides; `__NA__` passes through unchanged                                                                                                                                                                                                       | `style-getters.ts:47-49`, `missing-values.ts:72-75` |
| 7   | Fading: only a non-empty `selectedProteinIds` fades non-selected points; `highlightedProteinIds` grants selected opacity but never fades others                                                                                                                                                           | `style-getters.ts:169-179`                          |
| 8   | `getDepth` reads **base** opacity only — hidden toggles never change depth, which keeps the color-only GPU path alive (fast path tolerates ≤ 1e-6 depth drift, `webgl-renderer.ts:1806`)                                                                                                                  | `style-getters.ts:206-219`                          |
| 9   | "Other" bucket affects colors/shape/depth-key but **never** opacity; the legend pre-expands "Other" to concrete values before syncing hidden (`scatterplot-sync-controller.ts:110-116`)                                                                                                                   | `style-getters.ts`                                  |
| 10  | No data or no selected annotation ⇒ no hidden filter; base/fade tiers still apply                                                                                                                                                                                                                         | `style-getters.ts:184-186`                          |
| 11  | Faded points are interactive under default config; interactivity is `opacity > 0` evaluated at event time (survives the one-rAF quadtree staleness window, `scatter-plot.ts:906-914`)                                                                                                                     | `scatter-plot.ts:888,1259,1276,1997,2057`           |

## Risks / Trade-offs

- **[Perf regression invisible to tests]** If the model accidentally couples hidden
  state into depth, hidden toggles silently fall off the color-only fast path into full
  O(N log N) re-sorts. → Mitigation: keep `getDepth` reading `baseOpacityOf` only;
  existing depth-stability tests (`style-getters.test.ts:201-245`) pin it.
- **[Eager-pass cost on getter rebuild]** The hidden mask is an O(N) pass; getter
  rebuilds happen on selection change too (`scatter-plot.ts:547-558`). → Mitigation: the
  mask memo keys exclude selection, so selection-only rebuilds reuse the mask.
- **[knip CI gate]** Unused exports of the new module fail `pnpm quality:ci`
  (root `package.json` "quality"). → Mitigation: export only what the component and
  tests consume.
- **[Stale-memo bug class]** Reference-keyed memos silently miss in-place mutations.
  All chosen keys are assign-replaced (verified writers), and isolation is deliberately
  **not** a model input — it lives in the cull layer.

## Migration Plan

Mechanical order (details in tasks.md): pin missing behavior with tests against current
code → land the pure module + unit tests → delegate style-getters → memoized accessor +
hit-test migration → full `pnpm precommit` + manual fast-path sanity check. Single PR,
each step independently green. Rollback is trivial before the delegation step; after it,
revert the wiring commit.

## Open Questions

None blocking. One observation recorded for a future change: `export-utils.ts:436-479`
re-implements the hidden rule without the all-hidden hatch (so in the all-hidden state
the plot shows everything while protein-ID export returns zero ids) and with different
zero-value semantics (export keeps such points unless `__NA__` is hidden; the plot hides
them). Intentionally not fixed here (behavior change).
