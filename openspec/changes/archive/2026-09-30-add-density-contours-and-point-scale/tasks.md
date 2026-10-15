# Tasks

## 1. Density contours

- [x] 1.1 `densityLayer` config field (`off`/`auto`/`on`, default `off`) and one `DENSITY_LAYER_MODES`
      list shared by the URL and the control bar
- [x] 1.2 Accumulate, blur and composite pipeline inside the linear-light pass, drawn between the
      unselected and the selected points
- [x] 1.3 One field and ring set per staged colour, 16-colour cap with a shared grey tail slot, and
      the 5-point floor
- [x] 1.4 Auto crossfade driven by the visible point count; Always (`on`) pins full strength
- [x] 1.5 Lazy resource allocation, grid reallocation only on a size change, and field reuse when the
      inputs are unchanged
- [x] 1.6 Contours menu (Off/Auto/Always) in the control bar, keyboard operable, with the
      `density-layer` attribute and the `density-layer-change` event
- [x] 1.7 `?density=` in the URL: Off omitted, invalid or repeated values normalized
- [x] 1.8 Remove the heatmap style; the layer always draws contours

## 2. Review fixes

- [x] 2.1 Size the density grid to the plot (512 cells on the long side) and fix the line width in
      CSS px, so contours do not depend on the pixel density, window size or browser zoom
- [x] 2.2 Clamp the blur output to the half-float range
- [x] 2.3 Report `density-unavailable` once when contours are requested but cannot draw, and show it
      as a notice; keep `?density=` in the URL
- [x] 2.4 Relabel On as Always and rewrite the three menu hints, so Auto no longer claims to
      react to overlap; name the mode on the trigger and in its accessible name, move the per-colour
      note to its tooltip, and keep the `off`/`auto`/`on` tokens
- [x] 2.5 Cap bundle and stored shape sizes at 64 through one `LEGEND_DEFAULTS.maxSymbolSize`, as the
      dialog already did

## 3. Dot size

- [x] 3.1 One `point-scale.ts` module: radius `√pointSize / 3`, zoom and plot-area scale through the
      `u_pointScale` uniform, dpr applied in the shader
- [x] 3.2 Hover hit-test and EAT halo/stroke from the drawn radius, with a 4 px hover floor
- [x] 3.3 Quick Export uses the live scale at the export zoom; the Figure Editor and insets stay at
      k = 1
- [x] 3.4 Legend shape size default 10 (point size 80), dialog range 1 to 64, legacy per-annotation
      30 read as the default
- [x] 3.5 Picked shape size stored per dataset; top-level `shapeSize` in exported bundles only once
      picked; it overrides per-annotation sizes on import
- [x] 3.6 Python writers emit 10 as the per-annotation filler

## 4. Perf harness

- [x] 4.1 `dragContinuous`, `zoomFarOut` and `gpuSyncedMs`
- [x] 4.2 `densityZoom` and `contourDrag`, forcing `on` and restoring the previous mode, counted as
      camera scenarios with zero uploaded bytes

## 5. Specs and docs

- [x] 5.1 Correct `eat-provenance-connectors` (halo and stroke track the drawn radius) and
      `eat-annotation-overlay` (hollow interior at the default and maximum sizes; live and export
      identical at the same point scale)
- [x] 5.2 User docs: Contours section in the control bar page (appended as section 10, so existing
      anchors stay put), explore index, `density=` in the URL persistence notes, dot growth on the
      scatterplot page, legend shape size, the export limitation with #498, the Figure Editor's
      zoom-1 dots, and the EAT page's hollow-marker claim at the smallest sizes
- [x] 5.3 Guide docs: the top-level bundle `shapeSize` in the styling and data-format pages
- [x] 5.4 Developer API docs: `densityLayer` config, the control bar property, attribute and event,
      the legend's `applyShapeSize()` and `pickedShapeSize`, and per-dataset shape size persistence
- [x] 5.5 Screenshot script: stable selectors for the Select/Clear/Isolate callouts and a callout
      for the Contours trigger

## 6. Verification

- [x] 6.1 Unit tests for the density pass, shaders, crossfade, point scale, legend persistence,
      URL state and notifications
- [x] 6.2 `density-layer` e2e project registered in the Playwright config
- [x] 6.3 `openspec validate --all --strict` and `pnpm docs:build`

## 7. Archive

- [x] 7.1 Tick this list, reread proposal and design against the final diff, then archive as the
      last commit on the branch
- [x] 7.2 Replace the `TBD` Purpose the archive writes for `density-contours` and
      `scatterplot-point-size`

## Follow-ups

- Regenerate the docs screenshots with `pnpm docs:images` on an idle machine: the control bar
  callouts need the Contours trigger, and every plot image still shows dots at the old point size 240.
- Draw contours in image exports, matching the screen (#498).
