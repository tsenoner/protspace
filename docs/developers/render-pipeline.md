# Render pipeline

This page is for maintainers of the explore page's scatter plot. It describes how a frame gets
drawn, and what to keep in mind when you change the pipeline so that it stays fast. Paths are
relative to `packages/core/src/components/scatter-plot/` unless they start with the package.

## A frame, start to finish

1. A state change, such as new data, an annotation switch, a legend mapping or a selection, calls
   `RenderLoop.request()` in `render-loop.ts`. Every request made before the next animation frame
   shares one render.
2. On that frame, `_renderPlot()` in `scatter-plot.ts` passes the plot data to
   `WebGLRenderer.render(pd)` in `webgl/renderer/webgl-renderer.ts`. The host passes the same
   `PlotData` object on every frame of a dataset, so a camera move never looks like new data.
3. `render()` works out what changed from its dirty flags and from two sampled signatures,
   `computeDataSignature` and `computeStyleSignature`. It then stages positions and styles, only
   styles, or only the per-category table. When nothing changed it stages nothing.
4. It writes the selection marks into the mark texture, advances the projection glide, and draws.
5. The points draw into a linear-light float framebuffer: the unselected points, then the density
   contours, then the selected points. A gamma pass (`gamma-quad.ts`) converts the result to sRGB
   on the canvas. Without float render targets the points draw straight to the canvas, and the
   contours are not available.

## Visibility model and point style state

`styling/visibility-model.ts` decides every point's opacity, base opacity and interactivity.
`computeVisibilityModel` is the only implementation; `style-getters.ts` delegates to it. The rules
that matter for drawing:

- A hidden point has opacity exactly 0. Hiding wins over selection and highlight.
- A multi-label point is hidden only when every one of its values is hidden.
- `baseOpacityOf` ignores hiding, because it feeds the depth sort.
- A point is interactive when its opacity is above 0, so a configured `fadedOpacity` of 0 makes
  faded points impossible to hover or select.

The hidden mask is one pass over the annotation data into a `Uint8Array` indexed by
`originalIndex`. The selection and highlight are one byte per protein index, filled through a
protein id index that is built once per dataset. A model also carries `unmarked` (the same model
with nothing selected, highlighted or focused), `marks` (the marked and unmarked opacities, or
null), and `interactivityKey`, which changes only when the set of interactive points can change.

`styling/point-style-state.ts` holds `PointStyleState`, the host's `_style` field. It memoizes the
model on the identity of its inputs (data, annotation, hidden values, selection, highlight, focus,
EAT overlay flag and the three opacities) and builds from it:

- `getters()`: the style getters an export stages with;
- `stageModel()` and `stageGetters()`: what the live view stages, which is the unmarked model
  while the GPU draws the selection;
- `pointMarks(pd)`: the selection and highlight as one byte per slot, rebuilt only when the
  selection, the highlight or the plot data changes;
- `interactable(pd)`: the interactive slots, shared by the point-count label, provenance and the
  point grid;
- `selectSlots(pd, slots)`: the protein ids a brush or lasso selects;
- `scheduleIdIndex()`: builds the protein id index while the main thread is idle, so neither the
  first render nor the first selection waits for it.

`_createWebglRenderer()` in `scatter-plot.ts` hands the renderer two sets of getters: `style` for
the live view, built on `stageModel()`, and `exportStyle`, which stages the selection with every
other style. `PointStyleState.marksOnGpu()` decides whether the GPU draws the selection. It needs
no Shift-hover focus, `canMarkOnGpu()` on the getters, and `canDrawMarks` on the renderer.
`canMarkOnGpu()` needs a selected opacity of at least 0.99, base and faded opacities above 0 and
below 0.99, and float32 paint depths that keep every z-order offset in order at each opacity. The
defaults qualify. Otherwise the selection is staged on the CPU, as described under
[CPU fallback](#cpu-fallback).

## Staging

`populateBuffers(pd, scales, request)` stages a dataset in four steps.

1. Past `MAX_DRAWABLE_POINTS` it draws nothing and reports `point-limit-exceeded` (see
   [Device limits](#device-limits)).
2. `planStage(pd, positions)` fits the capacity and the label atlas to the data, then returns
   `'resort'` or `'restyle'`. It re-sorts when positions changed, the capacity changed, the depth
   order was invalidated (`invalidateDepthOrder()`), or a sample of the first 100 slots shows a
   paint depth that moved. Otherwise it restyles.
3. `resortPoints` calls `stageInPaintOrder` (`webgl/renderer/pass-staging.ts`). It resolves a
   `PointStylePass` (`styling/style-pass.ts`), which holds one style record per category code, sorts
   the slots far to near, and writes each slot at its sorted index through `stageSlotStyle`.
   `restylePoints` calls `restageStyles`, which rewrites only the style channels in the staged
   order and leaves positions and depths alone.
4. `uploadStaged(gl, plan, glideMoved)` uploads positions after a re-sort only, then the record
   table, then every style array. The first upload of a capacity allocates the buffers with
   `bufferData`, checks `gl.getError()` once, and allocates the mark texture. Later uploads use
   `bufferSubData` and check nothing.

Hidden slots are staged too, at opacity 0. That keeps the sort order across visibility toggles, so
a legend toggle can take the restyle path. Every writer of the staged buffers calls
`drawnStateChanged()`, which bumps `bufferGeneration` (the key of the density fields), drops the
contour palette and marks the mark texture stale.

The export (`webgl/renderer/export-renderer.ts`) stages through the same `stageInPaintOrder` into
its own arrays and its own throwaway context. It uses neither the mark texture nor the glide.

### Paint order and the depth sort

There is no depth test. Points draw far to near (the painter's algorithm), so the staged buffers are
in paint order. `composePaintDepth` in `paint-depth.ts` puts each point in one of four tiers, far to
near:

1. unselected, observed;
2. unselected, predicted;
3. selected, observed;
4. selected, predicted.

A point counts as selected when its opacity is at least `SELECTED_OPACITY_THRESHOLD` (0.99). Inside a
tier, the legend's z-order and the base opacity order the points. `buildPaintOrder`
(`point-staging.ts`) sorts with `sortIndicesByDepthDescending` (`depth-sort.ts`), a stable radix sort
on the float bits that breaks ties by slot. With a selection active, `selectedStartIndex` is the
first slot at 0.99 or above. That index is the cut between the two draw passes.

### Resize

Positions are staged in pixels through the scales. A resize changes only the scales' ranges, so
`rescaleBetween` (`webgl/renderer/rescale.ts`) maps the staged positions to the new layout in the
camera uniform, and nothing is re-staged. A new domain, such as new data, returns null and the
points are staged again.

## Per-category record style table

`webgl/renderer/record-style-table.ts` holds `RecordStyleTable`. It lets a legend hide, show,
recolour or reshape change one texel pair per category instead of re-staging every point.

A stage keeps a table when `RecordStyleTable.prepare` allows it: a single-valued annotation (no pie
markers), a pass that keys every record by category code and lists the records the legend hides
(`hiddenRecords`), and a table no taller than `MAX_TEXTURE_SIZE` rows. Staging then writes each
point's record id and its opacity as if nothing were hidden. The vertex shader reads the rest from
an RGBA32F texture: 8 floats per record (`RECORD_FLOATS`), with texel `2r` holding record `r`'s
colour and whether it is shown, and texel `2r + 1` its size, shape and label count. Rows are 1024
texels wide (`RECORD_STYLE_WIDTH`). The shader reads it through `u_recordStyle` and
`u_recordStyleOn`; the density pass reads the same table.

A legend change calls `invalidateCategoryStyles()`. The next `render()` then tries `restyleRecords`,
which rewrites and uploads the table and touches no staged buffer. It falls back to a full stage
when `canRestyle` refuses (the categories changed, or a hide would move a point between paint
tiers), when an earlier restyle left the order out of date (`stagedOrderStale`), or when
`stagedDepthsMoved` finds a changed depth. If the device refuses the texture, `drop()` writes the
hiding back into the staged colours.

## Selection marks and the two-pass draw

`webgl/renderer/mark-texture.ts` holds `MarkTexture`, an R8 texture with one byte per staged point,
by draw index, in rows `MAX_TEXTURE_SIZE` texels wide. The vertex shader reads it by `gl_VertexID`.

A selection change goes through these steps:

1. `PointStyleState.pointMarks(pd)` returns one byte per slot (`markedSlots`).
2. The renderer's `applyMarks` calls `MarkTexture.apply`, which permutes the bytes into draw order,
   uploads only the rows that changed, and records `range`, the draw indices around every drawn
   marked point.
3. In the shader, a drawn point takes `u_markedOpacity` or `u_unmarkedOpacity`, and `u_markPass`
   culls the class the current pass does not draw. The record table's hiding applies first, so a
   hidden point stays at 0.

A selection change therefore re-stages nothing.

`webgl/renderer/render-target.ts` has the two draw functions. `drawPoints` cuts at
`selectedStartIndex` for a selection staged on the CPU. `drawMarkedPoints` cuts with the mark
texture's `range`. Both use the same helpers:

- `drawTwoPasses`: the base points with blending off, so faded points do not add up; then the
  density composite (`runBetweenPasses`, which binds the point program, VAO and label atlas back);
  then the selected or marked points with blending on.
- `drawOnePass`: every point blended, then the density composite. It is used when no selected or
  marked point is drawn.

A global fade uniform and a second draw of the selected points would not give the same frame. With
blending off, a selected point drawn faded in the first pass would cover the points after it, so the
first pass has to skip the marked points, which is what `u_markPass` does.

### CPU fallback

The mark texture holds at most `MAX_TEXTURE_SIZE`² points (`maxMarkedPoints`). Past that, or when
the device refuses the allocation (`MarkTexture.refused`), `canDrawMarks` is false. The live view
then stages the selection with every other style, as the export does, and every point is still
drawn. When `refused` changes during a render, `render()` stages the styles once more, with
`glide: false` in its `StageRequest` so that the second stage does not capture new glide start
positions.

## Projection glide

`webgl/renderer/position-glide.ts` holds `PositionGlide`; the math is in `position-morph.ts`. On a
projection switch the points move from where they are drawn to their new positions over
`MORPH_MS` (800 ms), eased in and out. The clock reads `document.timeline.currentTime` and advances
at most `MAX_FRAME_STEP_MS` (1000 / 30 ms) per frame, so a stall pauses the glide instead of
skipping part of it.

The shader mixes the staged position with `a_prevPosition` by the `u_morph` weight. That attribute
is enabled, and its buffer filled, only during a glide (`syncMorphAttribute`). When the glide ends
the attribute is disabled and the buffer emptied. The export never sets `u_morph`, so it draws the
final positions.

How a glide starts and runs:

- After a geometry rebuild the host calls `RenderLoop.noteGeometry(slotsKept)`. Every point keeps
  its slot when the data, the filter and the slot order are unchanged, which is the case for a
  projection or plane switch, also inside an isolated view. Then `_startGlide()` calls
  `morphNextPositionChange()`, ends hover and sets the host's `data-morphing` attribute. That
  attribute hides the duplicate badges, spiderfied stacks and EAT connectors, which already sit at
  the new positions. Hover returns early while `isMorphing` is true.
- With `prefers-reduced-motion: reduce`, or without `requestAnimationFrame`, `_startGlide()` cancels
  instead and the points jump.
- The staged buffers are in paint order, and every position stage re-sorts them. Before the
  re-sort, `capture()` reads the drawn positions in the old order, and `afterResort()` writes them
  back in the new order. A new switch during a glide starts from the drawn blend; a re-sort without
  a new switch keeps the start and the clock. A changed point count means no glide.
- While `isMorphing` is true, `RenderLoop` requests the next frame after each full render. Each
  render calls `glide.advance()`, and `glideEnded()` switches the attribute off at weight 0.

## Texture units

`webgl/renderer/texture-units.ts` names every unit the renderer binds:

| Unit       | Constant                    | Holds                                                                         |
| ---------- | --------------------------- | ----------------------------------------------------------------------------- |
| 0          | `SCRATCH_TEXTURE_UNIT`      | Scratch: the gamma quad and the blur sample here, and uploads leave it active |
| 1          | `LABEL_ATLAS_TEXTURE_UNIT`  | The label atlas, for multi-label pie markers                                  |
| 0, 2, 3, 4 | `DENSITY_FIELD_UNITS`       | The density fields, one per four categories (16 at most)                      |
| 6          | `MARK_TEXTURE_UNIT`         | The selection mark texture                                                    |
| 7          | `RECORD_STYLE_TEXTURE_UNIT` | The per-category record style table                                           |

The density composite runs between the two point passes, and only the atlas is bound again after
it. So the fields skip unit 1 and must stay below units 6 and 7. Bind through
`bindTextureAt(gl, unit, texture, use)`, which leaves unit 0 active again. A new texture needs a
unit that nothing between the passes uses, a constant in this file, and a check in
`texture-units.test.ts`.

## Device limits

`webgl/renderer/device-limits.ts` keeps what the device allows in one place.

- `MAX_DRAWABLE_POINTS` is 2^26 (67,108,864) points. The widest vertex buffer, `a_color` at 16 bytes
  a point, fills 1 GiB at that count. WebGL2 has no query for the largest buffer, and Chrome on
  macOS refuses one just under 2 GiB, so the limit keeps a 2× margin. Past it, `populateBuffers`
  draws nothing and reports `point-limit-exceeded` through `onDegraded`. The host turns that into a
  `renderer-degraded` event, and the app shows "Too many points to draw." The renderer has no other
  point cap.
- `maxMarkedPoints(maxTextureSize)` is `MAX_TEXTURE_SIZE`². It limits only the GPU marks; past it
  the selection is staged on the CPU.
- `readMaxTextureSize` costs a synchronous round trip, so the renderer reads it once per context. It
  falls back to `MIN_MAX_TEXTURE_SIZE` (2048), the WebGL2 minimum.
- `drainGlErrors` clears the sticky GL error flag before an allocating call, so the check after it
  answers for that call alone. Errors are checked once per capacity change, never per frame. A
  failed buffer allocation reports `point-buffer-allocation-failed`, gives the label atlas back and
  retries on the next stage.

`planCapacity` (`planRendererCapacity` in `capacity-planner.ts`) grows the capacity by 1.5× across
loads, releases it when it is more than 4× what the data needs, and bounds it by the smaller of
`MAX_DRAWABLE_POINTS` and `maxMarkedPoints`, though never below what the data needs.

The 2,000,000-row limit for legacy v1/v2 bundles is a loader check
(`packages/core/src/components/data-loader/legacy/validation.ts`), not a renderer limit.

## Render loop

`render-loop.ts` holds `RenderLoop`:

- `request()` asks for a full render on the next animation frame. The renderer ORs every
  `invalidate*()` call into its dirty flags, so that one render stages everything the requests
  needed.
- `flush()` runs a waiting request now. Code that reads what the renderer last drew, such as the
  export and the data extent, calls it first.
- `now()` renders at once and drops the waiting request.

Two draws bypass the coalescing:

- A resize renders with `now()`. `resize()` has just cleared the canvas, and a `ResizeObserver`
  callback runs after the frame's animation-frame callbacks, so a deferred render would show one
  blank frame.
- A zoom or pan draws on `PlotInteractionController`'s own animation frame through the host's
  `_renderWebGL()`, without the rest of the full render. That frame counts as drawn
  (`noteDrawn()`), but only a full render carries a glide on to its next frame.

`scatter-plot.render-coalescing.test.ts` checks that the requests made before a frame queue one
frame and re-stage once on it.

## Point grid for hit-testing

`interaction/point-grid-controller.ts` holds `PointGridController`, which owns a `PointGridIndex`
(`interaction/point-grid-index.ts`), a uniform grid over flat typed arrays. Hover, click, brush,
lasso and the duplicate stacks query it. The canvas never reads it, so it is not on the render
path.

- The grid indexes every slot, hidden ones included, and answers only for the interactive slots,
  which `PointStyleState.interactable(pd)` marks.
- `scheduleRebuild()` rebuilds on the next frame when the plot data or its scales change.
  `scheduleRemark()` only re-marks when the set of visible points changes. A pending rebuild
  absorbs a re-mark.
- When fewer than a quarter of the slots are visible (`SPARSE_INDEX_SHARE`), the controller builds
  a second grid of just those slots, so queries do not walk the hidden ones.
- `detach()` and `adopt()` let an isolation reset reuse the grid of the full plot data. The next
  build only re-marks it when the scales still match.
- The lasso classifies grid cells, and only the points in cells that a polygon edge crosses are
  tested one by one.

## Context loss and reconnect

`webgl/renderer/context-loss-controller.ts` listens for `webglcontextlost`, calls
`preventDefault()`, and fires its callback once. The renderer does not try to restore the context
in place. Its callback runs `resetRendererState()`, which drops the GL handles, the label atlas,
the staged data reference, the glide, the record table and the mark texture, and then calls the
host's `onContextLost`. `render()` also checks `gl.isContextLost()`.

In `scatter-plot.ts`, `_handleWebglContextLost` destroys the renderer and increments `_canvasKey`,
which switches the template to the other of two canvas elements. After the update,
`_updateSizeAndRender()` builds a new renderer through `_createWebglRenderer()`, which syncs the
selection flag and starts compiling the shaders (`prewarm()`).

`disconnectedCallback()` cancels the render loop, the grid frame, the hover frame and the glide, and
destroys the renderer. On a reconnect, `connectedCallback()` (guarded by `hasUpdated`) sets up the
selection mode, the numeric recompute and the idle id index again, and the next
`_updateSizeAndRender()` builds a fresh renderer.

## Keeping it fast

The pipeline is fast because most interactions skip most of the work. Keep these properties when
you change it:

- A camera move stages nothing and uploads nothing.
- A selection change re-stages nothing while the GPU draws the marks.
- A legend hide, show, colour or shape change rewrites only the record table when one is kept.
- A resize re-stages nothing; the camera uniform absorbs it.
- One full render per animation frame.
- No synchronous GL queries (`gl.get*`, `gl.is*`) per frame. Error checks belong on the allocating
  path only.

### Perf counters

`packages/core/src/utils/perf-counters.ts` exports `perfCounters`. It is null unless the page URL
has `?perfCounters`, so a call site costs one null check: `if (perfCounters) perfCounters.render++`.
With the flag the page exposes the object as `window.__protspacePerfCounters`. It counts re-stages
(`restage`, `restagePos`, `restageStyle`, and `restageMs` for their time), renders, the points
drawn (`drawn`), glide frames (`morphFrame`), `processData` calls, grid rebuilds and legend
updates. The renderer's `uploadedBytesTotal` counts every byte sent to the GPU. A new counter must
also be listed in `apps/web/tests/helpers/perf/probes.ts`; the gate fails when the two lists
differ.

### The counts gate

`pnpm perf:counts` builds this checkout, serves it on its own port and drives the real UI with
Playwright on the demo dataset. It compares each count with `apps/web/tests/perf/budgets.json` and
fails on a count over its budget. It also fails when the pixels after a reset differ, when a
projection switch draws no glide frame or ends on other pixels than the instant switch, and when
the camera segment draws fewer points than the dataset has.

The script serves on port 8310 unless `PLAYWRIGHT_PORT` is set, and it never reuses a running
server. It stops if the port is taken, and the counts project refuses to run without its own
server. So when another checkout or a dev server is running, give it a free port:

```sh
PLAYWRIGHT_PORT=8312 pnpm perf:counts
```

A change that lowers a count, or raises one on purpose, updates the budgets in the same commit:

```sh
PERF_UPDATE_BUDGETS=1 pnpm perf:counts
git diff apps/web/tests/perf/budgets.json
```

### Timing two builds

`pnpm perf` measures timings in headed Chromium on the real GPU. To compare a change with its
base, serve production builds of both on their own ports and run:

```sh
pnpm perf --url http://localhost:8302 --compare http://localhost:8301 --datasets default,573K_swissprot
```

The runs alternate between the two builds in one browser session, and cells show both values and
their ratio. Timings depend on the power state, so measure on AC power with Low Power Mode off and
compare builds only within one session.

### Pixel identity

A performance change should not change a pixel. Check it in three places:

- the `pixels` column of `pnpm perf:counts`;
- `pixels A=B` in `pnpm perf --compare`, which compares the plot after each segment between the two
  builds and saves both images on a difference;
- unit tests on the mock GL, such as the `selection drawn as GPU marks` suite in
  `webgl/renderer/webgl-renderer.marks.test.ts`, which compares the GPU marks with a staged
  selection.

`perf/README.md` at the repository root has the full reference for both tools.
