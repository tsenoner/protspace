## Context

`bound-label-atlas-to-device-limits` made "no atlas" a first-class state: `labelColorData` is
nullable, the staging helper skips texels when it is null, a 1x1 placeholder keeps the sampler
complete, and the shader's `u_labelAtlasCapacity` uniform makes the pie branch unreachable. That was
built for the device-limit failure path. This change reaches the same state deliberately.

## Decisions

### The gate is pull-based, and computed where the colours are

The alternative was push-based: have every mutation that could change multi-label-ness tell the
renderer. That is the shape with the failure mode this codebase already knows — a missed
notification among many call sites, producing a stale frame rather than a slow one.

Computing it inside `createStyleGetters`, over the same `data` binding `getColors` closes over, makes
staleness structurally impossible in the direction that matters. `getColors` returns
`[...new Set(values)]` for that annotation, so `getColors(p).length >= 2` implies the stored data is
multi-valued, implies the gate is true. The gate can therefore only ever over-report — allocate when
it need not — never under-report.

That covers the transitions a push model would have had to enumerate individually: annotation switch,
projection switch, dataset swap, the EAT overlay, isolation, legend hide/show. All of them go through
a getter rebuild, and `data` is in the cache key.

### The default is "allocate"

`isMultilabel` is required on `WebGLStyleGetters`, so TypeScript consumers cannot omit it. The
renderer still calls it optionally and defaults to `true`. The asymmetry is deliberate: a consumer
that omits the getter over-allocates, which costs memory, whereas one that under-reports silently
drops pie segments — a wrong picture presented as data. Only the first is an acceptable failure.

### The transition is tracked in the renderer, not signalled by the caller

A change in multi-label-ness need not move the style signature, which samples four points' colours —
but it changes every point's staged slice count and whether the atlas exists. `render()` compares the
current gate against the last observed value and marks styles dirty on a change. This is not free
(a getter-cache miss rebuilds the getters) but it is not measurable either: `computeStyleSignature`
already calls `getColors` on four points every render.

It is also load-bearing rather than belt-and-braces: `_refreshSelectedAnnotationValues` nulls the
style-getter cache without calling `invalidateStyleCache`, so a caller-driven invalidation would have
a real hole.

### Why memoize

`isMultilabelAnnotationData` is `data.some(values => values.length > 1)` for dense storage — O(N),
573K at Swiss-Prot scale — and the getters are rebuilt on a legend hide, a selection, a projection
switch. A `WeakMap` keyed on the storage object makes every call after the first O(1), and releases
with the dataset.

Soundness rests on storage never being mutated in place: conversion, the EAT overlay, numeric binning
and the isolation path all return fresh objects. `Int32Array` storage answers in O(1) anyway, and the
sparse form scans only its overrides, which is the cost bound its own spec already imposes.

## Risks / Trade-offs

**A mid-session allocation on the transition into multi-label.** Allocating and uploading 17.5 MiB at
573K is real work — but that transition already pays a full re-stage, because the annotation changed.
The allocation is a fraction of it.

**Fidelity is still pinned to high-water capacity**, unchanged from #457: the atlas is planned against
capacity, not the drawn count, so it survives the colour-only fast path without re-planning.

**A revert cannot regress to corruption.** The absent-atlas state ships in #457 on the error path;
this change only adds a second reason to enter it.

## Open Questions

None.
