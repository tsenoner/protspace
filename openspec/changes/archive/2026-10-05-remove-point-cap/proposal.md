## Why

The renderer drew at most 2,000,000 points per projection, and the loader refused any bundle over
2,000,000 rows so that the clamp could never be reached. The loader limit came from the heap of
the v1/v2 reader, which decodes every row to an object. Format v3 bundles are read column by
column, and a stress run on an Apple M4 loaded and drew 2.5M and 5M points with every interaction
working. The cap now only refuses datasets the app can show.

## What Changes

- The renderer draws every point it is handed, up to its drawable limit of 2^26 (67,108,864)
  points, set by its widest vertex buffer (`a_color`: 16 bytes a point, 1 GiB).
- Past that limit nothing is drawn or allocated, and a "Too many points to draw" warning names the
  point count and the limit.
- Planned capacity is bounded by the device: the drawable limit, and one mark texel per point
  (`MAX_TEXTURE_SIZE²`).
- The rendered-id tracking, which only a clamped draw needed, is removed with its hover and click
  guard (`isPointRendered`), as are `MAX_RENDERABLE_POINTS`, `MAX_POINTS_PER_PROJECTION` and their
  invariant test.
- Format v3 bundles have no row limit; their reader bounds each part's allocation by its byte
  size. Legacy v1/v2 bundles keep a 2,000,000-row guard whose error points at `protspace convert`.
  The 2 GB file limit is unchanged.

### Non-goals

- Faster re-staging at 5M, where an annotation switch holds one frame for about 0.9 s.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `renderer-capability-limits`: capacity is bounded by the device instead of a point cap; a
  dataset past the drawable limit is refused with a warning; the shared loader and renderer cap
  is removed.
- `point-visibility`: drops the references to the removed renderer-capacity gate
  (`isPointRendered`) and its rendered-id tracking.

## Impact

- Code: `scatter-plot/webgl/renderer/` (`webgl-renderer.ts`, `capacity-planner.ts`,
  `export-renderer.ts`, `density-pass.ts`), `scatter-plot.ts`, `scatter-plot.events.ts`,
  `utils/limits.ts` (deleted), the data-loader validation (`validation.ts`, `bundle.ts`,
  `bundle-v3.ts`) and `apps/web/src/explore/notifications.ts`.
- Docs: the FAQ entry on how many proteins can be visualized.
- Datasets above 2,000,000 proteins, previously refused, now load. At 5M on an M4, pan and zoom run
  at about 30 fps and an annotation switch holds the plot for about a second.
