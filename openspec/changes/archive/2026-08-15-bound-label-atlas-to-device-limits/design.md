## Context

The label atlas is a `LABEL_TEXTURE_WIDTH`(2048)-wide RGBA8 texture holding `MAX_LABELS`(8) texels
per point — the per-slice colours of a multi-label pie mark. It is allocated in `expandCapacity`
(`webgl-renderer.ts:1111-1141`) at the renderer's full point capacity, unconditionally, and uploaded
whole (`:1041-1071`). Width is fixed and height does all the growing, which is the least favourable
arrangement against a square device limit.

Three facts settled the design; each contradicted at least one proposal on the table.

**The capacity clamp alone rescues every device reporting >= 4096.** `MAX_POINTS_DIRECT_RENDER`
caps `maxPoints` at `:828` but not `capacity` — `expandCapacity` receives `maxPoints` and then
applies 1.5x growth on top (`capacity-planner.ts:18`). Clamping the planner's output gives capacity
1,000,192 and height 3907, inside 4096. The width and stride ladders below therefore exist for the
2048 tier and for the sibling #456 change, not for the general population.

**Adaptive width must not perturb devices that already work.** Iterating stride outer and width
inner, smallest width first, yields byte-identical geometry (2048 x 2241 at Swiss-Prot) on every
device at 4096 or above, and widens only when 2048 genuinely cannot fit. This is why the loop is
ordered the way it is; the reverse order would re-lay-out the 97% to help the 3%.

**Context loss already resets capacity.** `_handleWebglContextLost` (`scatter-plot.ts:470-479`)
calls `destroy()` and nulls the renderer; `_createWebglRenderer` (`:487`) constructs a fresh one
with `capacity = 0` (`webgl-renderer.ts:89`). An overshoot-induced loss therefore self-corrects, so
this change adds no consecutive-loss counter — one would silently kill pie charts on healthy
machines after two unrelated losses, which this codebase manufactures on resize.

## Goals / Non-Goals

**Goals.** Make the device limit measured rather than assumed. Make a failed GPU allocation
detectable and non-permanent. Never render a point in a colour that is not its own. Give the export
path the same guarantees as the live path. Leave the geometry of a healthy device bit-identical.

**Non-Goals.** Deferring allocation for single-label annotations (the 42% residency win) — that is
the follow-on change, and it is deliberately sequenced second because it only adds a second reason
to enter the "no atlas" state this change builds and tests on the error path. Changing the pie
encoding. Reducing per-point channel count. Anything in the culling path.

## Decisions

### Plan geometry in one pure module

`label-atlas-plan.ts` owns `MAX_LABELS`, the width ladder `[2048, 4096, 8192]` and the stride ladder
`[8, 4, 2]`, and returns `{ width, height, stride, pointCapacity, byteLength, reducedDetail }` or
`null` when even stride 2 cannot fit. It is pure and GL-free, so the whole geometry contract is unit
testable without a context, and both renderers compute geometry the same way by construction rather
than by two parallel edits.

The shader needs no arithmetic change for a variable width. The CPU writes at linear texel index
`idx * stride + j` (`label-texture-utils.ts:24`) and the shader recovers `tx = globalIndex % texW`,
`ty = globalIndex / texW` from `u_labelTextureSize.x` (`export-shaders.ts:185-187`). A row-major
upload makes texel `globalIndex` the same texel at any width. `UNPACK_ALIGNMENT` does not bite
because an RGBA8 row is always a multiple of 4 bytes.

`STRIDE_LADDER`'s floor is 2 rather than 1 because `eat-annotation-overlay/spec.md:208-210`
normatively requires a two-label transferred cell to render both hues in live _and_ exported
markers. Stride 1 would satisfy no scenario that stride 0 does not.

`planLabelAtlas` takes an optional `maxStride`, which the export renderer feeds the live view's
stride. Implementation note: the export inherits fidelity by _planning at that stride_, not by
planning at full stride and capping afterwards — capping after the fact would size the texture for
slices it then refuses to draw.

### Stride is planned against capacity, not against the drawn count

The atlas is planned from `this.capacity`, like every other array, so it stays valid across the
colour-only fast path without re-planning. The accepted consequence is that fidelity is pinned to
the session's high-water capacity. With the clamp in place capacity never exceeds 1,000,192, so on
the 2048 tier the answer is stride 4 for any dataset large enough to matter — one deterministic
rung, not a drifting one.

### The absent-atlas state is a first-class state, gated in the shader

`labelColorData` becomes nullable. `u_labelAtlasCapacity` is a new `int` uniform and the pie branch
becomes `if (v_labelCount > 1.5 && v_pointIndex < u_labelAtlasCapacity)`. When the branch is
skipped, `finalColor` remains `v_color.rgb` — the point's dominant colour, pixel-identical to a
single-label point carrying that value. Never black.

`v_pointIndex` is `gl_VertexID` (`export-shaders.ts:49`) and the two-pass selection draw passes
`first` to `drawArrays` (`render-target.ts:119-127`), so `gl_VertexID = first + i` keeps the staging
slot correct across both passes. Nothing here changes that coupling.

When no atlas is allocated, a 1x1 opaque placeholder keeps the sampler texture-complete. It is never
sampled, because the capacity uniform is 0; it exists so a constrained device does not emit
incomplete-texture warnings into a console that `load-large-bundle.spec.ts:67` asserts is empty.

### One `getError` per capacity change, in two places, ordered

The buffer check runs _before_ any texture call, so a failed `bufferData` is neither masked by nor
misattributed to the atlas upload. It is guarded on the allocating path (`buffersInitialized` false,
i.e. the `bufferData` branch at `:1088`), never on `bufferSubData`, and therefore never per frame.
On a buffer failure the renderer returns early leaving `buffersInitialized` false, because retrying
`bufferData` reallocates whereas `bufferSubData` against a zero-sized store is `INVALID_VALUE`
forever.

`gl.isBuffer` and `gl.isTexture` (`gl-resources.ts:73-81`) cannot substitute: both report on handle
validity, not on whether storage was successfully allocated. That blind spot is why the current code
believes an over-size allocation succeeded.

### Hoist the style upload out of `updateStyles`

`populateBuffers` sets `needsReorder = updatePositions` (`:844`), and the reorder branch
(`:892-957`) rewrites all six style arrays _and_ the atlas in the new slot order — but the upload is
gated on `updateStyles` alone (`:1031`). A positions-only populate therefore restages styles in
memory and uploads none, leaving the GPU holding the previous permutation. This is masked today
because an unchanged depth vector re-sorts to an identical permutation, so the rewritten arrays are
byte-identical to what is resident. It is a latent correctness bug, it is in the blast radius of
this change's staging edits, and the fix is to gate on `updateStyles || needsReorder`.

### Diagnostics reuse the host-message channel

`renderer-degraded` follows `selection-disabled-notification` exactly — a `HostMessageEventDetail`
with `severity: 'warning'`, dispatched `bubbles: true, composed: true`, mapped to copy in
`apps/web/src/explore/notifications.ts` with a `dedupeKey` and a report action carrying the measured
limit and the unmasked renderer string. Reasons latch in a `Set`, once per renderer instance.

`handleGammaFallback` (`webgl-renderer.ts:283-292`) is routed through the same channel. A silent
linear-to-sRGB blending switch is a _larger_ visible change than a stride reduction, it already has
a one-shot latch, and it fires on the same constrained devices; building the pipeline and leaving
that one console-only would be incoherent.

## Risks / Trade-offs

**A texture-limit stub alone cannot reproduce the failure.** `gl.getParameter` only changes what the
application believes; the driver under the test still accepts whatever it is handed, so the pre-fix
renderer passes a stub-only test. And the reported failure is silent — nothing called
`gl.getError()` — so a console-error assertion passes on broken code too. The Playwright layer
therefore simulates the _driver_ as well (`helpers/gl-simulation.ts`): `texImage2D` past the
simulated limit does not call through and arms `getError`, and a later `texSubImage2D` against that
texture reports `INVALID_OPERATION`. The assertion is then that the renderer never _issues_ an
allocation the device would refuse, which is red on the parent commit
(`[[2048, 31]]`) and green after. A companion case runs the same simulation at an ample limit, so
the simulation itself cannot be what fails the others.

Corollary on dataset size: the shipped demo is ~7.8K proteins, whose atlas is 2048x31 — no realistic
limit refuses it, and no limit forces a stride reduction. The default suite therefore covers the
"no atlas fits" path at a simulated limit of 1024, and the reduced-stride path lives in the opt-in
573K spec, which is the case the issue actually reported.

**The mock GL context is a blocker, not a nicety.** `test-support/mock-webgl2.ts` has no
`getParameter` and no `getError`, and `texImage2D`/`texSubImage2D` are bare no-ops — and
`bufferSubData` is absent outright, so no test had ever reached the already-initialised upload path.
Adding either call throws `TypeError` in every existing renderer suite. Mitigation: extend the mock as the first
commit, so a mock regression bisects separately from a renderer regression.

**Reduced fidelity is a visible change on the affected tier.** A user on a 2048 device sees
four-segment pies where a colleague sees eight. Mitigation: it is announced, and it replaces
solid-black marks that were announced to no one. Most multi-label proteins carry two or three
distinct values, so the common case is pixel-identical.

**Clamping >8-colour points to 8 segments changes rendered output on every device.** Today those
points draw slices 9..N from an unrelated protein's texels — wrong colours presented as data.
Mitigation: this is the bug fix, and it is called out in the change log rather than slipped in.

**`precision highp int` could change output on drivers that were already 32-bit.** It cannot: it
raises a guaranteed minimum, it does not lower one. The risk is the reverse — that it exposes a
shader-compile failure on a driver that does not support `highp int` in fragment shaders. ES 3.00
requires it, and the renderer is WebGL2-only.

## Migration Plan

Land in the order the tasks list: mock first, then the pure planner and the clamp with no renderer
changes at all (red/green in isolation), then the staging shape, then the shader and its plumbing,
then the live renderer, then the export renderer, then notifications, then Playwright. Each step
leaves the tree green.

No data migration, no bundle-format change, no persisted state. A revert restores the previous
behaviour exactly, including the defects.

## Open Questions

None blocking. Two recorded for the follow-on work:

- Whether the 2048 tier is worth carrying long-term. This change adds `maxTextureSize` to the perf
  metadata (`webgl-render-perf.ts:383-388`) precisely so the next release has evidence instead of a
  third-party survey figure that cannot be verified from this repo.
- Whether a dirty-row `texSubImage2D` is needed. It is not today — the full-surface upload runs per
  capacity change and per restage, not per frame — but #456 should re-examine it if its work makes
  restages more frequent.
