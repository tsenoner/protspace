## Why

At exactly 1,000,000 points the renderer stops moving the camera by uniform update and starts
culling and re-staging on every camera move. Measured on two bundles differing by a single point, a
zoom render pass goes from **1.0 ms to 888 ms** and a pan from **1.0 ms to 120 ms** (#456, MacBook
Pro M4 Pro, Chrome 151, ANGLE Metal, medians of the CPU-side render pass).

The switch buys nothing. At full extent the cull removes **zero** points at both 1M and 2M, and even
at 3x zoom it removes only 23% — embedding layouts are centrally dense, so a zoom retains far more
than its area ratio suggests. The path pays its maximum cost precisely where its yield is zero.

The gate is `scatter-plot.ts:1406`:

```ts
if (this._plotData.length < VIRTUALIZATION_THRESHOLD || !this._quadtreeIndex.hasTree()) {
  this._visiblePlotData = this._plotData;
  return this._plotData;
}
```

Below it, `_getPointsForRendering` returns the same object every frame, so the content-sampled
signatures (`webgl-renderer.ts:782-817`) are unchanged, the dirty gate at `:358-362` is false, and a
frame is a uniform write plus a draw call. At and above it, `gatherPlotData` materialises fresh
typed arrays on every camera move (`plot-data.ts:41-55`), `pd.length` changes as points enter and
leave the viewport, the signature changes, and `populateBuffers` takes the full-rebuild branch: a
depth pass over every visible point, an O(N log N) comparator sort, a `stagePoint` per point with
two d3 scale calls and ~8 style-getter calls, then seven `bufferSubData` uploads and a full atlas
upload.

**The threshold was never measured.** `git log -S` puts all three constants in one unreviewed
branch: `1fe2ca79` introduced `MAX_POINTS_DIRECT_RENDER = 200_000` alongside a density-rendering
mode; `71de9118`, five hours later, deleted that mode and raised the constant to `1_000_000` with an
empty commit body; `6f876d28` then replaced the separate `VIRTUALIZATION_THRESHOLD = 500_000` with
an alias to it, which is what makes the two collide. `git tag --contains` is byte-identical for the
first two — nothing ever shipped between them. And `6f876d28`'s own surviving comment
(`scatter-plot.ts:74-77`) argues _for_ this change: "we can render the full set once and then
pan/zoom via uniforms (no per-frame quadtree queries or buffer rebuilds), which is substantially
faster for ~500k points." The author raised the culling threshold **because** the direct path is
faster, then pegged it to a constant whose other job is a hard truncation cap.

Two further defects follow from that aliasing:

- **Above 1,000,000 the surplus is discarded silently.** `populateBuffers` computes
  `Math.min(pd.length, MAX_POINTS_DIRECT_RENDER)` (`webgl-renderer.ts:828`) and the draw follows it.
  At 2,000,000 the app loads all of them, reports 2,000,000 in `data.protein_ids`, `_plotData` _and_
  `_visiblePlotData`, and paints 1,000,000. Nothing in the UI or console says so, and the cut is by
  array position — quadtree-traversal order — so which half survives is spatially arbitrary.
  `export-renderer.ts:376` repeats the clamp.
- **The loader and the renderer disagree.** `MAX_ROWS_DEFAULT = 2_000_000`
  (`data-loader/utils/validation.ts:9`) counts proteins x projections, so a two-projection bundle
  caps at exactly 1,000,000 proteins — the first point at which the renderer degrades is the last
  point the loader admits. A single-projection 2,000,000-point bundle passes validation and displays
  half.

`eat-annotation-overlay/spec.md:214` and `:369` declare 500,000 to 1,000,000 rows the product's
target range, so 1,000,000 is inside the specified working size. This is a spec-conformance defect,
not only a performance wish.

## What Changes

- **Delete the cull.** `_getPointsForRendering` collapses to its existing guard and always returns
  `this._plotData`. With object identity stable the signatures are constant across camera moves _by
  construction_, so `populateBuffers` is never reached by a pan or a zoom at any dataset size. The
  quadtree stays — hover, click and lasso need it — it just leaves the render path.
- **One shared cap.** A new `MAX_POINTS_PER_PROJECTION = 2_000_000` is the single source for both the
  loader's row cap and the renderer's clamp. Because `projections_data` is long-format, rows =
  proteins x projections >= proteins, so proteins-per-projection can never exceed the renderer's cap
  through the loader — **truncation becomes structurally unreachable**, with no distinct-protein
  scan. The relationship is pinned by a test, not a comment.
- **Report what was drawn.** The renderer exposes the count it actually drew and a monotonic count of
  bytes uploaded to the GPU. The perf runner records both per pass, which makes any future
  truncation self-reporting and gives the regression gate something deterministic to assert.
- **Say what the limit is.** `Too many rows: 2400000 exceeds limit` becomes a message naming the
  limit, what it counts, and what to do about it.
- **Shrink capacity when a large dataset is replaced by a small one.** Today the 1M clamp bounds the
  worst case; once the cap is 2M, loading 2M and then a 5K demo would retain the larger footprint and
  re-upload a capacity-sized atlas on every restage. Hysteresis at 4x avoids thrashing.

## Capabilities

### Modified Capabilities

- `renderer-capability-limits`: camera motion never rebuilds GPU buffers at any dataset size; the
  loader's row cap and the renderer's clamp derive from one constant so a dataset the loader admits
  is always fully drawn; and the drawn count is observable rather than assumed.

<!-- point-visibility needs no amendment. `isPointRendered` survives as the spec-sanctioned
     renderer-capacity gate (spec.md:123-129) and simply becomes vacuous; and this change DELETES a
     third enforcement layer rather than adding one, leaving "Two enforcement layers stay distinct"
     (spec.md:23-28) cleaner than it found it. -->

## Impact

- `packages/core/src/utils/limits.ts` — new; the shared cap, with the measured heap figures that
  justify its value in the doc comment.
- `packages/core/src/components/scatter-plot/scatter-plot.ts` — the cull, `_visiblePlotData`,
  `_virtualizationCacheKey`, `_quadtreeGeneration`, `_invalidateVirtualizationCache` and its six call
  sites all deleted (~62 lines removed). `_visiblePlotData` is written at five sites and read at
  exactly one, so the deletion surface is closed.
- `packages/core/src/components/scatter-plot/webgl/types.ts` — `MAX_POINTS_DIRECT_RENDER` becomes
  `MAX_RENDERABLE_POINTS`, re-exported from the shared constant.
- `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts` — `drawnPointCount`
  and `uploadedBytesTotal` accessors, upload accounting, and capacity shrink with hysteresis.
- `packages/core/src/components/scatter-plot/webgl-render-perf.ts` — records the drawn count and the
  bytes uploaded per pass. `renderedPoints` keeps its current meaning (`pd.length`): in jsdom
  `render()` early-returns before the drawn count is assigned, so substituting it would report 0 and
  break the host-contract test the perf spec mandates.
- `packages/core/src/components/data-loader/utils/validation.ts` — the row cap derives from the
  shared constant; the error message names the limit.
- `docs/guide/faq.md` — "Not recommended. Performance degrades above 500K proteins" is now wrong in
  both directions and must move in this PR (`AGENTS.md:54-67`).
- No bundle-format, CLI or Python change. No PyPI release: `protspace-release.yml` is path-filtered
  to `apps/protspace/**`, untouched here.

## Depends On

`bound-label-atlas-to-device-limits` (#457, PR #458). Raising the renderer's cap to 2,000,000 without
it makes the label atlas 7813 rows — fatal on every 4096 device, a tier that works today — and a
1.5M -> 2M sequence on an 8192 device plans capacity 2,250,240 -> height 8790, failing on mainstream
hardware. That change also supplies the capacity clamp this one raises the bound of.
