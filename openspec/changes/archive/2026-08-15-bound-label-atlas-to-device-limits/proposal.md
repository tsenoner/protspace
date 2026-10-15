## Why

The pie-chart label atlas grows with the point count and nothing checks it against the device.
`expandCapacity` computes `texHeight = ceil(nextCapacity * MAX_LABELS / LABEL_TEXTURE_WIDTH)`
(`webgl-renderer.ts:1132-1134`), which is exactly `capacity / 256`, and uploads it with
`texImage2D` (`:1044-1054`). `gl.MAX_TEXTURE_SIZE` is queried nowhere in `packages/` or `apps/`,
and `gl.getError()` is called nowhere in any `src/`. So the largest drawable dataset is silently a
function of the device's texture limit:

|    device `MAX_TEXTURE_SIZE` |    atlas caps at |
| ---------------------------: | ---------------: |
| 2048 (the WebGL2 spec floor) |   524,288 points |
|                         4096 | 1,048,576 points |
|                         8192 | 2,097,152 points |

A device reporting 2048 cannot allocate the atlas for the **shipped 573,649-protein Swiss-Prot
bundle** — it needs height 2241. The failure is invisible and permanent: an over-size `texImage2D`
raises `GL_INVALID_VALUE`, which is not a JS exception, so nothing unwinds and the texture is left
unallocated — but `labelTextureInitialized = true` is set regardless of outcome (`:1057`), so every
later update takes the `texSubImage2D` branch against storage that was never allocated and raises
`GL_INVALID_OPERATION` forever after. The user sees black pie marks and a clean console.

The 4096 tier looks safe against `MAX_POINTS_DIRECT_RENDER = 1_000_000` until the 1.5x geometric
growth in `planRendererCapacity` (`capacity-planner.ts:18`) is accounted for: the constant caps
`maxPoints` (`webgl-renderer.ts:828`) but **not** `capacity`, so loading 900k then 950k gives
capacity 1,350,144 -> height 5274 -> over the limit at a point count well under a million.

Two further defects surfaced while verifying the report, neither of them in it:

- **`stage-point.ts:75` writes `labelCounts[idx] = pointColors.length` unclamped** while
  `fillLabelColorTexels` writes at most `MAX_LABELS` texels. The shader's `count` is likewise
  unclamped (`export-shaders.ts:180`), so a point with more than 8 distinct colours reads **the next
  protein's texels** for its surplus slices. `sliceIndex` has no `count - 1` clamp either, and
  `atan(+0, x<0)` is exactly `+PI`, so `normalizedAngle` reaches 1.0 on the middle pixel row of any
  odd-height sprite and the same overrun happens to well-formed points.
- **`POINT_FRAGMENT_SHADER` declares only `precision highp float`** (`export-shaders.ts:53`). ES 3.00
  defaults fragment `int` to `mediump`, whose guaranteed range is 16 bits, so `flat in int
v_pointIndex` (`:59`) and `int globalIndex` (`:184`) are undefined above 32,767 on any driver that
  honours the minimum — precisely the low-end hardware this change is about.

This blocks the sibling change for #456. Raising `MAX_POINTS_DIRECT_RENDER` to 2,000,000 on today's
code makes the atlas 7813 rows, fatal on every 4096 device — a tier that works today — and a
1.5M -> 2M sequence on an 8192 device gives capacity 2,250,240 -> height 8790, failing on mainstream
hardware. #456 first would convert a minority-device bug into a mainstream one.

## What Changes

- **Bound the atlas geometry to the device.** Probe `gl.MAX_TEXTURE_SIZE` once per context and plan
  the atlas in a new pure module, preferring full 8-slice stride over a wider texture so every
  device that works today keeps byte-identical geometry (2048 x 2241 at Swiss-Prot). Widen to
  4096/8192 only when 2048 cannot fit; drop stride to 4, then 2, only when no width fits. The floor
  is 2 because `eat-annotation-overlay/spec.md:208-210` binds a two-label cell to render both hues
  in live _and_ exported markers.
- **Clamp capacity, not just `maxPoints`.** `planRendererCapacity` gains an optional `maxCapacity`
  argument that the renderer feeds `MAX_POINTS_DIRECT_RENDER`, bounding the 1.5x overshoot. This
  alone rescues every device reporting >= 4096: 1,000,192 points is height 3907. The clamp can never
  starve a legitimately larger load, because it is floored at the snapped requirement.
- **Never render a multi-label point black.** A new `u_labelAtlasCapacity` uniform gates the pie
  branch, so a point outside the atlas — or a session with no atlas at all — falls through to
  `v_color.rgb`, its dominant colour, identical to what a single-label point of that value renders.
- **Check `gl.getError()` once per capacity change**, never per frame: once after the first
  `bufferData` of a capacity change and once after the atlas `texImage2D`. Set
  `labelTextureInitialized` only on `NO_ERROR`. On failure, fall back to a 1x1 placeholder that keeps
  the sampler texture-complete, and report it.
- **Surface degradation to the user** through the existing host-message channel, following
  `selection-disabled-notification`, latched once per reason. Route the equally silent gamma-pipeline
  fallback (`webgl-renderer.ts:283-292`) through the same channel rather than leaving it
  console-only.
- **Fix the three shader/staging defects above** — clamp the staged label count to the effective
  stride, clamp `count` and `sliceIndex` in the shader, and add `precision highp int`.
- **Repair the export path**, which duplicates the allocation per export call
  (`export-renderer.ts:588-598`) with no probe, no error check and no shared stride. Export probes
  its own context's limit and inherits the live renderer's stride, so a figure matches the screen.
  `MAX_DIMENSION = 8192` (`:73`), whose error message calls it "the browser limit", becomes
  `min(8192, exportMaxTextureSize)` — today that constant is a lie on any device below 8192.

Deferring allocation until a multi-label annotation is actually selected — the 42% residency win —
is a separate change that lands on top of this one. This change ships the "atlas absent" state
machine that deferral needs, on the error path, so deferral only adds a second reason to enter a
state that is already tested.

## Capabilities

### New Capabilities

- `renderer-capability-limits`: what the WebGL renderer guarantees about device limits — that it
  measures them rather than assuming them, that it degrades marker fidelity rather than point
  coverage, that a point is never rendered in a colour that is not its own, and that a capability
  reduction reaches the user instead of the console.

### Modified Capabilities

- `point-visibility`: records that a point's rendered slice count is bounded by the effective atlas
  stride, so the four-tier opacity model and the multi-label hidden rule are unchanged by a
  fidelity reduction.

## Impact

- `packages/core/src/components/scatter-plot/webgl/renderer/label-atlas-plan.ts` — new; the single
  place atlas geometry is computed, pure and GL-free. Owns `MAX_LABELS`, which `stage-point.ts`
  re-exports so existing importers are unaffected.
- `packages/core/src/components/scatter-plot/webgl/renderer/capacity-planner.ts` — optional fifth
  argument; the existing seven-case suite passes unchanged as a regression guard. The fourth
  argument is renamed `capacityGranularity`: with a variable atlas width it is allocation
  granularity, not a texture-row constraint.
- `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts` — the probe, an
  `syncLabelAtlas`/`uploadLabelAtlas` pair replacing the inline allocation and upload, both
  `getError` checks, a nullable `labelColorData`, and the style-buffer upload hoisted from
  `updateStyles` to `updateStyles || needsReorder`.
- `packages/core/src/components/scatter-plot/webgl/renderer/stage-point.ts` — `StagePointArrays`
  gains `maxLabels` and a nullable `labelColorData`; the staged label count is clamped.
- `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts` — `precision highp
int`, the `u_labelAtlasCapacity` uniform and its guard, and the two slice clamps.
- `packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.ts` — its own probe,
  stride inherited from the live renderer, a `getError` check, a truthful `MAX_DIMENSION`, and the
  removal of a comment claiming it reuses the main renderer's arrays when `:589-598` allocates seven
  fresh ones.
- `packages/core/src/components/scatter-plot/webgl/renderer/render-target.ts`,
  `webgl/types.ts`, `webgl/renderer/point-locations.ts` — the new uniform, and an explicit atlas
  height replacing the `labelColorDataLength / 4 / width` derivation.
- `packages/core/src/components/scatter-plot/scatter-plot.events.ts` — new; a
  `renderer-degraded` host message mirroring `control-bar.events.ts:14-30`.
- `apps/web/src/explore/runtime.ts`, `apps/web/src/explore/notifications.ts` — register and map the
  new message to warning copy naming the limit.
- `packages/core/src/components/scatter-plot/webgl-render-perf.ts` — `maxTextureSize` added to the
  collected metadata, so the next perf sweep measures the real device distribution instead of
  citing a third-party survey.
- `packages/core/src/test-support/mock-webgl2.ts` — gains `getParameter`, `getError`, the four error
  constants, and recording `texImage2D`/`texSubImage2D`/`uniform1i`. Lands as its own commit: every
  renderer suite depends on it.
- No bundle-format, CLI or Python change. No PyPI release: `protspace-release.yml` is path-filtered
  to `apps/protspace/**`, untouched here.
