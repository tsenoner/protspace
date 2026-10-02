## Context

The legend owns the dot size. Its shape size `s` becomes the scatterplot's point size
`max(10, round(8 · s))` (`calculatePointSize`), and the renderer draws a dot of radius
`√pointSize / 3` CSS px, grown only by zoom and plot area (`computePointScale`, #478). The legend
resolves `s` whenever it loads settings for an annotation:

- a size the user picked, stored once per dataset under `point-size:<hash>`; a bundle's top-level
  `shapeSize` is written to the same key on import (`applyShapeSize`);
- otherwise the annotation's own `shapeSize`, from the bundle's legend settings or from the
  annotation's record in browser storage, with the legacy filler 30 read as 10;
- otherwise `LEGEND_DEFAULTS.symbolSize`, 10.

Every CLI-written bundle carries `"shapeSize": 10` per annotation, so in practice almost every
dataset draws at 10. Exports write a top-level `shapeSize` only for a picked size. Reset in the
settings dialog stores 10 as if it had been picked.

## Goals / Non-Goals

**Goals:**

- A large dataset opens at a size where its categories can be told apart, with no action from the
  user and no change to existing bundles.
- A size someone chose, the user or a bundle author, still wins.
- The computed default is never written anywhere, so it is recomputed for whatever data is loaded.

**Non-Goals:**

- Changing the radius formula, the zoom and plot-area scale, or the hit radius.
- A size that adapts to the visible count, the zoom or the screen.

## Decisions

### The rule

```
defaultShapeSize(N) = clamp(round(10 · (10000 / N)^⅔), 1, 10)
```

| N       | 5,000 | 10,000 | 20,000 | 40,000 | 105,562 | 127,000 | 573,649 |
| ------- | ----- | ------ | ------ | ------ | ------- | ------- | ------- |
| default | 10    | 10     | 6      | 4      | 2       | 2       | 1       |

- **10,000 is the reference.** Below it dots rarely cover each other at 10, and 10 is the size every
  small dataset has today, so nothing under 10,000 proteins changes.
- **The exponent is ⅔.** Dot area grows linearly with the shape size (`r² ∝ pointSize ∝ s`), so
  `s ∝ 1/N` would hold the total ink constant and make 573K dots invisible at 0.17. `N^−⅔` lets
  the total ink grow slowly (`∝ N^⅓`), so a larger dataset still looks denser. It matches the
  captures from the investigation: human and fly (105,562) reads best at 2, Swiss-Prot (573,649)
  at 1 to 2, beta-lactamase (127K) at 2 to 3.
- **Whole sizes from 1 to 10.** The dialog takes whole sizes from 1, so a default of 2.08 would show
  a value the user cannot type. The rule never goes above the old default of 10. Shape size 1 is
  already point size 10, the floor of `calculatePointSize`, about 2 CSS px across.
- **A count that is 0, negative or not finite gives 10**, the base default, so a legend without
  data behaves as before.

### N is the whole dataset

`N` is the number of proteins in the dataset as loaded, taken from the same unfiltered data the
legend hashes to key its storage (the scatterplot's own `data`, not the slice a filter or isolation
hands the legend). Hiding a category, filtering or isolating therefore never changes the default,
and the dots do not jump while the user explores. A subset exported as its own bundle is a new
dataset and gets the default for its own count on import.

### Precedence

1. The dataset's stored size (`point-size:<hash>`): a size picked in the settings dialog, or a
   bundle's top-level `shapeSize` applied on import. They share one slot, so the later write wins: a
   bundle's size applies when the file is opened, and a pick afterwards replaces it.
2. The annotation's own `shapeSize`, unless it is 10 or 30.
3. `defaultShapeSize(N)`.

Every source is capped at 64, as before.

### The fillers 10 and 30 read as unset

10 is what the CLI writers (`settings_converter.py`, `add_annotation_style.py`, `carriage.py`) and
the legend's own `createDefaultSettings` emit when nobody picked a size; 30 is what earlier writers
emitted. Neither says anything about the data, so both read as "no size set". A bundle author who
wants exactly 10 per annotation on a large dataset cannot say so per annotation; the top-level
`shapeSize: 10` can.

### The default is never written

The legend used to store its live size in each annotation's record, which turned a seeded or picked
size into an "own" size the next time the annotation loaded. The record now holds the annotation's
own size if it has one, and the filler 10 otherwise. A picked size lives only in the dataset key
and is still stamped into every annotation on export, for older readers. An export therefore never
carries the computed default: a bundle without a pick has no top-level `shapeSize` and the filler
per annotation, and reads back as "default" on any dataset.

### Reset clears instead of storing 10

Reset used to store 10 as the dataset's size, which with a computed default would pin 10 and export
it. It now removes the dataset key and rewrites every annotation's own size to the filler, in
browser storage and in bundle settings not yet applied, so the whole dataset returns to the default,
as the old Reset returned it to 10. Clearing only the dataset key is not enough: records written
before this change can hold a picked size, which would resurface on the next annotation switch.

### The dialog shows the default

The size field shows the size in use, as before. Its placeholder, which used to be a fixed 10, is
the dataset's default, and a hint under the field says what the default is and that larger
datasets get smaller dots. Typing the default is not a pick: the dialog stores a size only when it
differs from the one in use.

### Alternatives rejected

- **A count factor in the renderer.** Scaling every point size by `N` inside the scatterplot would
  change the meaning of every size, picked ones included: 10 would draw differently on every
  dataset, and the legend's number would no longer describe the dot. The hit radius, the EAT halo
  and the export renderer all read the point size and would each need the factor. The legend
  already resolves a size from several sources, so the default belongs there.
- **Baking the size into bundles.** The CLI could write the computed size per annotation. That
  needs every published bundle regenerated, and existing ones, the examples included, keep the
  filler. The web app's FASTA prep and its own exports would need the same rule, and a filtered or
  isolated subset export would carry the size computed for the full dataset.
- **The visible count.** Sizing by the points on screen makes dots grow when the user hides a
  category or isolates a cluster, exactly when they compare it with what they saw before.

## Risks / Trade-offs

- **Large datasets look different.** Anyone used to the old size on a large dataset sees smaller
  dots. Picking 10 restores it and is remembered for the dataset.
- **EAT hollow markers on large datasets.** At shape sizes 1 and 2 a transferred marker's hollow
  interior can close, a limit the overlay already had at its smallest sizes; it is now the default
  on large EAT datasets.
- **One rule for every screen.** The default does not account for the plot's pixel area beyond the
  existing plot-area scale; on a very small or very large window the user may still prefer another
  size.
- **A Reset since #478 looks like a pick.** Reset used to store 10 as the dataset's size, the same
  record a real pick of 10 writes, so a browser where Reset was pressed keeps 10 for that dataset
  until the next Reset. It cannot be told apart from a deliberate 10, so it is left alone.
- **Perf baselines move.** The 40K and larger perf datasets now draw at 4 or below, so their fill
  cost drops; perf numbers before and after this change are not comparable.
