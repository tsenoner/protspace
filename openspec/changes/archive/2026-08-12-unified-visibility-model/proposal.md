# Proposal: Unified point-visibility model

## Why

"Is this protein visible / clickable?" is currently answered by five independent code
paths that share no logic: the `getOpacity`/`getBaseOpacity` closures in
`packages/core/src/components/scatter-plot/style-getters.ts`, the per-point opacity
gates (`> 0` / `=== 0` checks on `_getOpacity`) at five sites in `scatter-plot.ts`
(quadtree build :888, lasso :1259, brush :1276, hover :1997, click :2057), and the
physical cull mask in
`packages/utils/src/visualization/data-processor.ts`. Because legend visibility doubles
as the hit-test mask, a fix at any one site routinely regresses another (see
`FILTERING_AUDIT.md` §5.1 — "no unified visibility predicate"). The filtering subsystem
audit estimates the majority of its 18 findings trace back to this missing single source
of truth.

## What Changes

- Add a new pure module `packages/core/src/components/scatter-plot/visibility-model.ts`
  that becomes the **only** place per-point display state is computed
  (tier: `hidden | faded | base | selected`, exact numeric opacities, base opacity for
  depth, and the interactivity predicate).
- `createStyleGetters` delegates `getOpacity`/`getBaseOpacity` to the model;
  `getColors`/`getDepth`/shape logic are untouched.
- The five predicate sites (the quadtree build filter plus the four hit-test gates)
  switch from ad-hoc `_getOpacity` comparisons to the model's `isInteractive(d)` —
  numerically identical.
- `_getOpacity` remains as a facade under its current name (external code reaches into
  it: `webgl-render-perf.ts` and a Playwright spec).
- The model is **pull-based**: computed lazily, memoized on input identity. It is never
  recomputed in a Lit lifecycle hook (see design.md for why push-based is incorrect here).
- New tests pin currently-untested behavior **before** the refactor: query × legend-hide
  composition, selection fading × hidden, the all-hidden escape hatch, the vacuous-truth
  edge, and query × isolation intersection in `DataProcessor`.

**Explicitly out of scope:** physical culling (query filter + isolation in
`DataProcessor` — unchanged), component-to-component communication (props, events,
sync controllers — unchanged), cross-component state duplication (audit Step 2),
boolean query trees (audit Step 4), and export-utils' independently divergent hidden
logic (fixing its divergence would be a behavior change).

## Impact

- Affected specs: `point-visibility` (new capability — pins existing behavior as
  requirements).
- Affected code:
  - `packages/core/src/components/scatter-plot/visibility-model.ts` (new)
  - `packages/core/src/components/scatter-plot/style-getters.ts` (delegation)
  - `packages/core/src/components/scatter-plot/scatter-plot.ts` (memoized accessor,
    hit-test call sites, `_getOpacity` facade)
  - test files alongside each of the above, plus
    `packages/utils/src/visualization/data-processor.test.ts` (new composition cases)
- Behavior: **none** — this is a behavior-preserving refactor. Rendering fast paths,
  event payloads, axes extents, legend counts, and export output must be bit-for-bit
  identical.
- Risk: the WebGL color-only fast path depends on depth values being numerically stable
  across hidden toggles; the design pins this with existing depth-stability tests.
