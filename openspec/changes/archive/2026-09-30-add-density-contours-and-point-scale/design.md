## Context

The scatter plot draws every protein as one WebGL point sprite, through a linear-light pipeline
(an `RGBA16F` framebuffer and a gamma pass) when the context has `EXT_color_buffer_float` and
`EXT_float_blend`, and through a direct sRGB path otherwise. Camera motion (pan, zoom) changes only
uniforms, which `renderer-capability-limits` requires.

PR #478 adds a density layer inside the linear-light pass and replaces the fixed dot size with one
that follows zoom and plot size. This document records the decisions the code embodies, written
after the fact from the final diff, the commit messages and the review.

## Goals / Non-Goals

**Goals:**

- Show where each category concentrates without hiding the points.
- Keep contours identical across screens, so a screenshot means the same on every machine.
- Keep camera frames free of vertex uploads, with contours on or off.
- Make dots readable at every zoom, and keep hover, EAT halos and exports consistent with the dot
  that is actually drawn.

**Non-Goals:**

- Contours in exported images (#498).
- A heatmap or colour-mixing density style.

## Decisions

### Rings are keyed by colour, capped at 16

The layer never sees categories, only the staged point colours. `buildSlotPalette` groups points by
their RGB colour, skipping points with zero alpha (hidden categories). Up to 16 colours
(`DENSITY_CATEGORY_CAP`) get a slot each. Past 16, the 15 most populous colours other than the
neutral grey `#888888` (the Other group's colour) keep their own slots, and every other colour
shares slot 0, drawn in that grey.

Keying by colour means legend entries that share a colour share rings. The default palette keeps
colours unique; the short palettes repeat after 7 or 8 entries. That is accepted: the rings then
agree with what the points show.

Each group of four slots accumulates into one `RGBA32F` target (`RGBA32F` because the counts are
exact to 2^24) and is blurred into one `RGBA16F` field, so there are at most four fields. The
composite shader takes, per pixel, the fill of the densest slot and draws every slot's rings over
it in that slot's colour, lightened 15% toward white.

### Ring levels are octaves above a 5-point floor

A ring marks a doubling of density. The lowest level is the blurred peak of 5 points in one cell
(`DENSITY_CONTOUR_MIN_POINTS`), so a lone point or a pair never draws a ring. There are at most
five rings per slot. The fill starts at the outermost ring at 20% and deepens to 80% in the core.
Where rings would be closer than about half a CSS px apart they are dropped, because they would
only smear into a solid band.

### The grid spans the plot, not the canvas

The first revision sized the grid from the physical canvas, so a dpr-1 screen got coarser cells
than a retina one: rings moved by one to two levels and the blur widened, with the same data and
view. The grid is now 512 cells on the plot's long side (never finer than the canvas itself, so a
tiny canvas does not allocate a full grid), with a blur sigma of 3 cells, about 6.4 CSS px on an
1100 px plot. Ring shape is then a function of the data and the view only. The line ramp is
`1 CSS px × dpr` device px, so a line is equally thick on every pixel density.

### The blur is clamped to the half-float range

The blurred fields are `RGBA16F`. More than about 492K same-slot points in one cell overflow the
horizontal pass, and SwiftShader writes that overflow as NaN, which blanks the densest core. The
blur shader clamps its output to 65504. The top ring sits far below that, so the clamp cannot move
a ring.

### Auto follows Embedding Atlas, with the visible count

Auto uses Embedding Atlas's `viewingParameters` crossfade with `maxDensity = N_visible`, the number
of points drawn with non-zero opacity, instead of a quarter of the total. With
`T = √(1024 · N_visible) / D`, where `D` is the plot's longer side in CSS px, the layer is at full
strength while `k ≤ T·e^−½` and gone once `k ≥ T·e^½`. At `k = 1` on a 1000 px plot that is
nothing below about 360 visible points and full strength from about 2,700; Swiss-Prot's 573K
proteins fade out between about 15× and 40× zoom. Always (`on`) forces full strength at any zoom.

Auto never measures overlap. The heatmap it was first written for waited for real overplotting; the
contours use a 32× lower density midpoint, 1 point per 32 × 32 CSS px, well before default dots
start to overlap. On a 1000 px plot at zoom 1, a tight clump of 300 fully overlapping points gets no
contours in Auto, while 3,000 well-spread points put the layer at full strength.

### The menu reads Off, Auto, Always

Auto and On drew identical rings and fill and differed only in strength, but the menu said "Shows
when points overlap" for Auto and put "one ring set per legend colour", true of both, under On. The
labels are now Off "No contours", Auto "Fades out as you zoom in; faint or hidden when few points
are shown" and Always "Full strength at every zoom level". The per-colour sentence moved to the
trigger's tooltip, with the note that contours are not in exports, and the trigger names the active
mode ("Contours: Auto", "Contours: Always"), as the projection selector shows its value.

The `densityLayer` values and the URL tokens stay `off`, `auto` and `on`. Renaming them would touch
the utils types, the URL state, the perf harness and their tests for a mismatch a user only sees in
a shared link. Off stays the default: exports never draw the layer, and up to 16 ring sets are a
heavy first impression.

### Fields are reused while their inputs hold

The fields depend on the buffer generation, the point count, the canvas size, the dpr and the
camera transform. A re-render that changes none of them (hover, tooltip) only composites the
cached fields. The palette is rebuilt only when the staged colours change.

### Resources are lazy, failures are local

Nothing is compiled or allocated while the mode is Off, or while Auto's alpha is 0. Once
allocated, the programs and targets live until the renderer is disposed, the context is lost, or
the layer is disabled; the targets are reallocated only when the grid size changes. A shader or
target failure disables the layer for that context and leaves the points on the linear-light
pipeline. Context loss clears the latch so the next context tries again.

### An unavailable layer is reported once

When contours are requested (Auto or Always, including from `?density=`) but cannot draw, the
renderer emits `renderer-degraded` with reason `density-unavailable` and the cause (the missing
extension, or the density failure). It does so only once points are loaded, so a shared link does
not raise it over the loading screen, and at most once per context. The app surfaces it as a notice and leaves
the URL alone: the parameter describes what the viewer asked for, and the same link draws contours
on a capable device.

iPhone and iPad WebKit do not expose `EXT_float_blend`, so this is the common case there, not a
driver edge case. The gate that requires `EXT_float_blend` for the whole linear-light pipeline is
older than this PR; only the `RGBA32F` accumulator strictly needs it.

### One point-scale module owns the dot radius

`point-scale.ts` is the single definition: radius `√pointSize / 3` CSS px, times
`clamp(k, 1, 256)^¼` and `clamp((w·h / 700 000)^¼, 0.8, 1.5)`. Dot area doubles per 4× of zoom
(radius ×1.41 at 4×, ×2 at 16×, at most ×4) and never shrinks below the picked size on zoom-out.
The plot-area term is measured in CSS px against a 1000 × 700 reference; the device pixel ratio is
applied in the shader, not in the staged data. The scale reaches the GPU as the `u_pointScale`
uniform, so a zoom frame uploads no vertex data.

Hover hit-testing uses the drawn radius with a 4 px floor, so small dots stay easy to hover. The
EAT endpoint halo is `max(4, r + 2)` px and the connector stroke `max(1, 0.3 r)` px, with `r` the
drawn radius, so both grow with the dots.

### A picked shape size belongs to the dataset

The legend used to store a shape size per annotation, so switching annotations changed the dot
size. A size the user picks is now stored once per dataset and applies to every annotation. An
exported bundle carries it as a top-level `shapeSize` only once it was picked (or applied from a
bundle), and stamps it into each annotation's entry for older readers. A size merely seeded from
one annotation's settings is not promoted, because on import the top-level value overrides every
per-annotation one.

Bundles written before this change store `"shapeSize": 30` per annotation unless the user picked a
size: the Python writers' filler and the web app's old default, the shipped demo included. Reading
30 as the new default lets those files show the new default with no regeneration. A user who really
wants 30 picks it once; it is then stored as the dataset's size.

### Shape size is capped at 64 on every path

64 is the bound the original shape-size spinner had, a UX limit rather than a GPU one. With the
zoom (at most ×4) and plot-area (at most ×1.5) growth, the largest live sprite at 64, a diamond at
dpr 3, is about 340 device px, inside the 511 px `gl_PointSize` limit of current ANGLE/Metal. The dialog, a bundle's
top-level `shapeSize`, per-annotation sizes and stored sizes are all capped by the same
`LEGEND_DEFAULTS.maxSymbolSize`, so the plot never draws a larger size. A capped top-level size is
stored as 64; a larger per-annotation size stays as it was written and is capped again on each load.

### Export policy for dots

Quick Export PNG/PDF keeps the live camera, so it renders dots at the live scale for that zoom, and
the figure matches the screen. The Figure Editor always renders the full view at `k = 1`, and its
insets render their region with the same `k = 1` scale (times their own Dot size), so their dots are
at the zoom-1 size. The plot-area term uses the live plot's CSS size in both cases.

### Why image exports skip the layer

The export renderer has no density pass, and calling the live one from it is not enough to match
the screen. The line width is in CSS px, so a large figure would get hairlines. Auto's strength
depends on the view's size, so passing the export's pixel size would fade the layer out of a large
figure that shows it on screen. An inset would re-derive its own field from the few points it
covers instead of magnifying the panel's rings. A publication figure whose rings quietly differ from
the screen is worse than one without rings. The Figure Editor preview is rendered by the same
export renderer, so it already shows exactly what will be exported. #498 tracks an export that
matches the screen, using the plot-sized grid as its reference.

## Risks / Trade-offs

- **Colour-keyed rings.** Two categories with the same colour share rings, and categories past the
  16-colour cap merge into one grey set.
- **Faint N/A rings.** The N/A colour is a light grey, so its rings are faint on a light background.
- **Auto hides contours on small datasets.** Documented, and Always is kept for that reason.
- **Older bundles shrink.** The old dialog accepted typed shape sizes above 64, so some bundles
  carry them; they now draw at 64.
- **Sprites are not clamped to the device limit.** The 64 cap keeps live sprites under 511 px at
  dpr up to 3, but a high browser zoom or a Figure Editor inset's Dot size can still pass it, and
  the driver then draws a smaller dot.
- **No contours on iPhone and iPad.** Reported to the user rather than silent. Splitting the
  float-blend gate, or a half-float accumulator, is follow-up work.
- **Stale screenshots.** The docs images still show the old dot size and no Contours button until
  `pnpm docs:images` is re-run.
