## Why

PR #478 shipped density contours and a new dot-size model without an OpenSpec change, so nothing in
`openspec/specs/` describes either. Two existing specs became false in the process:

- `eat-provenance-connectors` promises endpoint halos and connector strokes of constant screen size.
  They now track the drawn dot radius, which grows with zoom ("fix(scatter): hit-test and EAT halo
  use the drawn dot radius").
- `eat-annotation-overlay` promises a visible hollow interior at the minimum supported shape size.
  The minimum dropped from 6 to 1, where a dot is about 1 CSS px across. The same scenario promises
  identical live and exported rendering, but the Figure Editor now renders dots at their zoom-1 size
  while the live view grows them with zoom ("feat(export): exported dots use the live point scale at the
  export zoom").

This change records what the PR ships, including five fixes that landed in it during review, and
corrects the two specs.

## What Changes

- **Contours.** A Contours menu in the control bar offers Off, Auto and Always (default Off), and
  the trigger names the active mode. It is mirrored in the URL as `?density=auto|on`, where `on` is
  Always. Each visible legend colour gets its own density field and ring set, drawn above the
  unselected points and below the selected ones. Auto sets the layer's strength from the visible
  point count, the plot size and the zoom: it fades out as the user zooms in and is faint or absent
  when few points are visible. Always pins it at full strength.
- **Contours look the same on every screen.** The density grid spans the plot, 512 cells on its
  long side, so ring shape depends only on the data and the view, not on the device pixel ratio,
  the window size or browser zoom. Line width is fixed in CSS px. The blur output is clamped to
  the half-float range, so a very dense cell cannot turn into NaN on backends that write overflow
  that way.
- **Contours say when they cannot run.** When contours are requested but the context lacks float
  render targets or float blending (iPhone and iPad WebKit do not expose `EXT_float_blend`), or a
  density shader or target fails, the renderer reports a `density-unavailable` degradation once,
  and the app shows it as a notice. The URL keeps `?density=`, so a shared link still works on a
  device that can draw contours.
- **Dots grow with zoom and plot size.** A dot's radius is `√pointSize / 3` CSS px, times
  `clamp(k, 1, 256)^¼` for zoom and `clamp((w·h / 1000·700)^¼, 0.8, 1.5)` for the plot area. The
  scale is one shader uniform, so camera frames still upload no vertex data. Hover hit-testing and
  the EAT endpoint halo use the drawn radius.
- **Shape size.** The legend default is 10 (point size 80), and the settings dialog accepts sizes
  from 1 to 64. A larger size from a bundle or from browser storage is capped at 64 too. A size the
  user picks holds for every annotation of the dataset and is written to
  exported bundles as a top-level `shapeSize`, which on import overrides the per-annotation sizes.
  A per-annotation `30`, the filler earlier writers emitted, reads as the default.
- **Exported dots follow the live scale.** Quick Export PNG/PDF renders dots at the live zoom's
  scale. The Figure Editor renders the full view and its insets use the same zoom-1 scale, so their
  dots are at the zoom-1 size (an inset's times its own Dot size).

### Non-goals

- **Contours in exported images.** No image export draws the layer yet (Quick Export PNG/PDF, the
  Figure Editor, zoom insets). Line width, Auto's strength and the insets' fields all have to be
  tied to the live view first, or the figure's rings would quietly differ from the screen, which is
  worse in a publication figure than no rings. Tracked in #498.
- **The heatmap style.** An earlier revision of the PR had a colour-mixing heatmap alongside the
  contours. It was removed ("feat(density): drop the heatmap style"); the layer always draws
  contours.

### Decisions recorded

- **Always stays.** The PR body asked whether Auto and Off would be enough. Auto draws nothing below
  about 360 visible points on a 1000 px plot at zoom 1 and reaches full strength only from about
  2,700, so small datasets, including most FASTA uploads, need Always to show contours at all.
- **On reads Always.** Auto and On drew the same rings and differed only in strength, and Auto
  never tested overlap, so the menu was relabelled Off, Auto, Always with hints that say what each
  does. The `densityLayer` values and the URL tokens stay `off`, `auto` and `on`.
- **64 stays the shape-size cap.** It is the original spinner's bound, a UX limit rather than a GPU
  one, now applied on every path that sets the size.

## Capabilities

### New Capabilities

- `density-contours`: the Contours control and URL parameter, per-colour rings, Auto and Always
  strength, draw order, resolution independence, resource lifetime, the unavailable-device notice,
  the export exclusion and the perf scenarios.
- `scatterplot-point-size`: the dot radius formula and its zoom and plot-area scale, hit radius, the
  legend shape size range and default, dataset-level persistence and the bundle `shapeSize`, and the
  export point-scale policy.

### Modified Capabilities

- `eat-provenance-connectors`: endpoint halos and connector strokes track the drawn dot radius, so
  they grow with zoom, still without rebuilding the connector join.
- `eat-annotation-overlay`: the hollow-interior guarantee is restated for the 1 to 64 range, and
  live and exported markers are identical at the same point scale rather than unconditionally.

## Impact

- Code (already in #478): `packages/core/src/components/scatter-plot/webgl/renderer/`
  (`density-pass.ts`, `density-shaders.ts`, `density-crossfade.ts`, `point-scale.ts`,
  `webgl-renderer.ts`, `export-renderer.ts`), `scatter-plot.ts` (hit radius), the provenance
  `connector-overlay-controller.ts`, `scatter-plot.events.ts` (`density-unavailable`), the control
  bar's Contours menu, the legend's shape-size persistence, `@protspace/utils` (`densityLayer`,
  `DENSITY_LAYER_MODES`, the bundle `shapeSize`), and the web app's `url-state.ts`,
  `view-controller.ts`, `dataset-controller.ts` and `export-handler.ts`.
- Python: the per-annotation `shapeSize` filler the writers emit is now 10.
- Bundles: a shape size above 64, which the old dialog let users type, now draws at 64.
- Public API additions: `ScatterplotConfig.densityLayer`; the control bar's `densityLayer` property,
  `density-layer` attribute and `density-layer-change` event; the legend's `applyShapeSize()` and
  `pickedShapeSize`; the `density-unavailable` renderer-degraded reason.
- Docs: control bar, explore index, scatterplot, legend, EAT, exporting, Figure Editor,
  importing-data (URL parameter), styling and data-format guides, and the developer API page.
- The docs screenshots still show the old dot size and no Contours button until `pnpm docs:images`
  is re-run.
