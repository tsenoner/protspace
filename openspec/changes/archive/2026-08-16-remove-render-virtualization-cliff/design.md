## Context

Two independent mechanisms are tangled through one constant.

`VIRTUALIZATION_THRESHOLD` decides whether to cull to the viewport. `MAX_POINTS_DIRECT_RENDER`
decides how many points to stage. `6f876d28` aliased the first to the second, so the size at which
culling begins is also the size at which truncation begins — and both land at exactly the largest
two-projection dataset the loader accepts.

The measured cost is not the quadtree walk (120 ms on a pan) but the re-stage it provokes (~757 ms).
Culling and staging are independent concerns; the cliff exists because the code couples them through
`gatherPlotData`, which materialises a _new_ `PlotData` on every camera move. The dirty check samples
content, not object identity, so a new array with identical contents would be free — but `pd.length`
changes as points enter and leave the viewport, so the signature changes and the full-rebuild branch
runs.

## Goals / Non-Goals

**Goals.** Make camera motion cost the same at 2,000,000 points as at 2,000. Make the loader and the
renderer agree on one number. Make the drawn count observable. Leave every non-camera path exactly as
it is.

**Non-Goals.** Making the re-stage itself faster — it is ~757 ms per million and it is what makes
recolouring and selection slow at any size, but it is a separate change with a separate design.
Order-independent transparency, GPU-side culling, density/LOD rendering, and a downsampling control
are all rejected below. Anything in the label atlas: `bound-label-atlas-to-device-limits` owns it.

## Decisions

### Delete the cull rather than repair it

The reporter's own alternative — keep culling but return a stable view (an index range, a draw-range
pair) over the same buffers — would work, but it buys nothing here. The GPU already discards
off-screen points at the clip stage; a CPU cull only saves vertex-shader invocations, which the
reporter measured at 1.0 ms for a million points. There is nothing left to win, and the machinery
that would remain has a maintenance cost and a correctness surface.

The deletion is closed. `_visiblePlotData` is written at `scatter-plot.ts:975`, `:1401`, `:1407`,
`:1424` and `:1433`, and read at exactly one place, `:1428`. Every other consumer — the scales, the
quadtree build, hover and click, brush and lasso, the point-count indicator, duplicate stacks,
connectors, isolation — already reads `_plotData`.

`_quadtreeGeneration` has exactly one consumer, the virtualization cache key. The one alternative use
worth checking — whether the duplicate-stack memo needs it — does not exist: `_buildQuadtree` calls
`this._dupOverlay.resetState()` in both branches, and `resetState()` nulls that memo's own key.

### Keep the content signatures

Once `pd` identity is stable the signatures are O(1) per frame — six `toFixed` calls and twelve
style-getter calls — so replacing them with explicit dirty flags buys nothing measurable while
importing the single largest risk available: a missed `invalidate*Cache()` among the ~15 call sites
produces a **stale frame**, which is worse than a slow one and which a dev-mode shadow check by
definition cannot catch.

### One constant, and why truncation becomes unreachable rather than merely unlikely

`projections_data` is long-format: one row per (protein x projection), which is why
`validateProjectionRows` requires a `projection_name` column at all. So `rows = proteins x
projections >= proteins` for any projection count >= 1, and capping rows at the per-projection point
cap guarantees proteins-per-projection <= that cap without a distinct-protein scan — which matters,
because the validation runs before grouping.

The clamp in `populateBuffers` stays. It is not dead: a `@protspace/core` embedder can assign `.data`
directly, bypassing the loader entirely. It simply becomes unreachable through any file a user can
load.

The value stays 2,000,000 — only its derivation changes. At the reporter's measured ~1.3 GB per
million, 3M is ~4.0 GB against a 4.40 GB heap limit, and 5M does not fit at all; raising it would
convert today's clean `Too many rows` throw into an unrecoverable OOM after a 100-second wait.

### Capacity must be able to shrink

`expandCapacity` is grow-only. Today the 1M clamp bounds the worst case, so nothing notices. Once the
cap is 2M, "load 2M, then open the 5K demo" would retain the larger footprint for the session **and
re-upload a capacity-sized atlas on every restage**, because the atlas upload is sized by capacity
rather than by the drawn count. Hysteresis at 4x avoids reallocating on ordinary dataset switches
while still releasing an outlier.

### What is fixed for free

`lastRenderedData` now always holds the full set, so `renderToCanvas`, `createExportScales` and
`getDataExtent` stop receiving a viewport-culled subset at >= 1M. Today a zoomed-in export at 1M
contains only the culled points **and re-derives its data domain from that subset**, while badge
capture projects full-extent badges through those wrong scales.

Hidden points also go back to being staged at alpha 0 above 1M instead of being physically removed by
the `isInteractive`-only quadtree, which re-enables the colour-only fast path.

## Risks / Trade-offs

**Selection and recolouring get slower above 1M, because they now do the full job.** The first click
changes every unselected point's base opacity, which changes its composed depth, which trips the
100-slot depth probe and forces a full O(N log N) rebuild. At 2M that goes from clamped-1M (~757 ms)
to true-2M (~1.5 s). **Accepted:** correct-and-slower beats today's wrong-and-faster, where half the
dataset is invisible and unhoverable. The fix is to take selection out of the sort key, which is a
real design change to the EAT knockout contract and does not belong here.

**Peak memory rises for datasets that were previously truncated.** A 2M-point dataset now stages 2M
points rather than 1M. The reporter measured 2.61 GB peak of a 4.40 GB limit at that size, so the
headroom is real but not generous, and it is why the cap does not move.

**Load time is untouched and still dominates**: 25.2 s at 1M, 42.0 s at 2M.

## Migration Plan

No data migration, no persisted state, no bundle-format change. The FAQ moves in the same PR because
its current claim ("Not recommended. Performance degrades above 500K proteins") is wrong in both
directions after this change.

## Verification, and what it does not show

The regression gate is a **byte count**, not a wall-clock threshold: a pan or a zoom must upload zero
bytes to the GPU. That is machine-independent, needs no GPU (it runs under SwiftShader) and needs no
new fixture — and it cannot be satisfied by a cache in front of the cull, which would still
re-materialise on a miss, and every gesture misses.

Implementation note: perf passes are only recorded while a benchmark scenario is active, so the E2E
spec reads `uploadedBytesTotal` off the renderer directly around a real gesture rather than driving
the benchmark.

Two limits worth stating plainly:

- On the shipped demo dataset (~7.8K proteins) the byte assertion also passes on `main`, because the
  cull never engaged below 1,000,000 points. It is a guardrail against reintroduction. The proof at
  the affected size is the unit test, which is red on the parent commit at 1M, 1.5M and 2M.
- **No wall-clock number in this change was reproduced here.** The 888 ms / 1.0 ms figures are the
  reporter's, on their machine and session. This branch demonstrates the mechanism, not the timing.

## Open Questions

- Whether to advertise 2,000,000 in the docs on the strength of one machine's measurements. The FAQ
  quotes only numbers the issue actually measured, and names the machine class rather than implying
  universality.
- Whether `pnpm perf` should gate CI. It runs in no workflow today, needs a GPU runner, and the
  fixtures are large; the deterministic gate above needs neither.
