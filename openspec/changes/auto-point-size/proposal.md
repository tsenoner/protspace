## Why

Every dataset opens at legend shape size 10 (point size 80), whether it has 5,000 proteins or
573,000. Every bundle the CLI writes carries `"shapeSize": 10` per annotation (older ones `30`),
and neither is a choice anyone made: it is a filler. On a large dataset that size is not only
crowded, it is misleading. Dots overlap so much that the category drawn on top covers most of the
others:

- Human and fly (105,562 proteins): at 10 one species covers most of the other; at 2 both show,
  and where they mix becomes visible.
- Swiss-Prot (573,649 proteins): the cluster structure first appears at 1 to 2.
- Beta-lactamase (127K): fine at 2 to 3.

Users who never open the legend settings never find this out. Nothing in the app sizes dots by
the number of points. The renderer only grows dots with zoom and plot area (#478).

## What Changes

- **The default shape size follows the dataset's protein count.** With `N` the number of proteins
  in the whole dataset, the default is `clamp(round(10 · (10000 / N)^⅔), 1, 10)`. That is 10 up to
  10,000 proteins, 6 at 20,000, 4 at 40,000, 2 at 105,562 and 1 at 573,649. `N` counts every
  protein, not just the visible ones, so the default does not change when the user hides
  categories, filters or isolates.
- **The default applies only when no size is set.** In order of precedence: a size the user picked,
  or a bundle's top-level `shapeSize` (both are stored in the same per-dataset slot), then an
  annotation's own `shapeSize` other than the fillers 10 and 30, then the default from `N`.
- **The default is never stored or exported.** When no size is set, the legend stores and exports
  the filler 10 per annotation, which reads back as unset. The default is computed again on every
  load, so a subset exported as its own bundle gets its own default.
- **Reset returns the dataset to its default.** Reset in the legend settings dialog used to store 10
  as if the user had picked it. It now clears the dataset's stored size and every annotation's own
  size, so the computed default applies again and is never exported.
- **The dialog shows the default.** The size field keeps showing the size in use. Its placeholder
  and a hint under it give the dataset's default.

### Non-goals

- Changing the radius formula or the zoom and plot-area scale (`scatterplot-point-size`, #478).
- Writing a computed size into bundles: the CLI keeps writing the filler 10.
- Sizing by the visible point count.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scatterplot-point-size`: the default shape size comes from the dataset's protein count instead
  of being a fixed 10; the fillers 10 and 30 read as unset; the precedence between a picked size, a
  bundle's sizes and the default; Reset clears the stored size instead of storing 10.
- `eat-annotation-overlay`: the hollow-interior guarantee names shape sizes 10 and 64 instead of
  "the default", which is now smaller on large datasets.

## Impact

- Code: `packages/core/src/components/legend/` (`legend-helpers.ts`, `legend.ts`,
  `legend-settings-dialog.ts`, `controllers/persistence-controller.ts`) and their unit tests.
- Bundles: no format change. Bundles keep the per-annotation filler 10; a top-level `shapeSize` is
  still written only for a picked size.
- Datasets above 10,000 proteins open with smaller dots. A user who preferred the old look picks
  10 once; it is then stored for the dataset like any other pick.
- EAT: on large datasets the default dot is small enough that a transferred marker's hollow
  interior may close, a limit the overlay already had at the smallest sizes.
- Perf: the 40K and larger perf datasets draw smaller sprites, so their fill cost drops; perf
  numbers are not comparable across this change.
- Docs: legend, scatterplot, EAT, styling, data-format and developer API pages. The docs
  screenshots use the demo (7,831 proteins) and the venom EAT dataset (811), so they do not change.
- E2E: every fixture the default suite loads has at most 7,831 proteins and keeps size 10; the
  opt-in Swiss-Prot spec asserts nothing about dot size. The 40K dataset is used only by the perf
  suite.
