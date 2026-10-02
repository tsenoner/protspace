## Why

The pie-chart colour atlas is 32 of the 76 bytes per point resident on the GPU — 42% — and for a
single-label annotation every one of those bytes is dead weight. Nothing samples it: the fragment
shader's pie branch requires `v_labelCount > 1.5`, and `fillLabelColorTexels` returns immediately for
a point with one colour. At Swiss-Prot scale that is 17.51 MiB of CPU and 17.51 MiB of GPU held for a
feature the view is not using, plus a full-surface upload on every restage.

`bound-label-atlas-to-device-limits` (#457) made "no atlas" a real, tested state — it is what a
device that cannot hold one already falls back to, and the shader already refuses to sample when the
atlas capacity uniform is zero. This change adds a second reason to enter that state.

## What Changes

- **Gate allocation on the selected annotation's storage.** `createStyleGetters` exposes
  `isMultilabel()`, computed over the same `data` binding the colour getters close over, so the
  answer is exactly as fresh as the colours it gates. `syncLabelAtlas` allocates only while it is
  true, and releases when it goes false.
- **Memoize the predicate.** `isMultilabelAnnotationData` is O(N) for dense storage, and the getters
  are rebuilt on a legend hide, a selection, a projection switch. A `WeakMap` keyed on the storage
  object makes it O(1) after the first call — sound because no producer mutates an `AnnotationData`
  in place; every one builds fresh storage.
- **Re-stage on either transition.** The style signature samples four points' colours, which a change
  in multi-label-ness need not move — but it changes every point's staged slice count. The renderer
  tracks the transition itself rather than relying on a caller to invalidate; in particular
  `_refreshSelectedAnnotationValues` nulls the style-getter cache without calling
  `invalidateStyleCache`.

## Capabilities

### Modified Capabilities

- `renderer-capability-limits`: resources for a feature the view is not using are not allocated, and
  the gate is evaluated over stored values rather than rendered colours.

<!-- point-visibility already carries the storage-shaped requirement, added by
     bound-label-atlas-to-device-limits. This change implements it. -->

## Impact

- `packages/utils/src/visualization/annotation-data-access.ts` — a memoized
  `isMultilabelAnnotationDataCached` beside the existing predicate.
- `packages/core/src/components/scatter-plot/styling/style-getters.ts` — computes the gate once per
  getter rebuild and returns it.
- `packages/core/src/components/scatter-plot/webgl/types.ts` — `WebGLStyleGetters` gains
  `isMultilabel`. The renderer calls it optionally and defaults to **true**: a consumer that omits it
  over-allocates, which wastes memory, where under-reporting would silently drop pie segments. Only
  the first failure direction is acceptable.
- `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts` — the gate in
  `syncLabelAtlas`, and the transition check in `render()`.
- `packages/core/src/components/scatter-plot/scatter-plot.ts` — one line forwarding the getter.
- No user-visible change on a multi-label annotation. No bundle-format, CLI or Python change.

## Depends On

`bound-label-atlas-to-device-limits` (#457, PR #458), which built the absent-atlas state machine,
the shader gate, and the placeholder this change reuses.
