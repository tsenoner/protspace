## Context

`run_transfer` builds, per `--transfer` column, a query set and a reference set, calls
`protlabel.eat()` once, and turns the returned `Prediction`s into three overlay columns with
`add_overlay_columns`. `eat()` already has every neighbour's index and distance in hand (from
`backends.nearest`) while it accumulates the reliability index; it keeps only the winning label,
its nearest source and that source's distance. The report needs no new search, only for `eat()` to
stop discarding what it computed.

## Goals / Non-Goals

**Goals:**

- One table a user can open in a spreadsheet or pandas that answers "what is near each of my
  unknowns, and how near".
- No second kNN pass, and no change to the bundle or to `eat()`'s default output.

**Non-Goals:**

- Unknowns-per-reference (the inverse list). It is a `groupby` on the same table.
- Projection-space neighbours.

## Decisions

- **Long format, one row per query and neighbour.** The prediction fields (label, source, distance,
  reliability) repeat on each of a query's rows. The alternative, one row per query with
  `neighbor_1_id`, `neighbor_1_distance`, ... columns, changes shape with `--k` and is awkward to
  filter. With `--k 1` the long format is one row per query anyway. The columns, in order, are
  `column`, `query_id`, `label`, `source_id`, `distance`, `reliability`, `rank`, `reference_id`,
  `reference_label` and `reference_distance`; `column` is there because `-t` repeats.
- **`distance` is the distance to `source_id`, not to the rank-1 neighbour.** With `--k > 1` the
  winning label need not be the nearest neighbour's; `source_id` is the nearest reference carrying
  the winning label (as in the bundle), and `distance` belongs to it. The rank-1 row gives the
  nearest reference of any label.
- **`eat(keep_neighbors=True)`, not a second call to `nearest`.** The distances are already
  computed inside `eat()`; a second GEMM would double the cost at Swiss-Prot scale. The flag
  defaults off so `Lookup.transfer` and other callers allocate nothing new.
- **`Prediction.neighbors` defaults to an empty tuple.** Adding a defaulted field to the frozen
  dataclass keeps positional construction and equality of every existing `Prediction` working.
  Neighbours are sorted by `(distance, reference_id)`, so equidistant references come out in a
  stable order, the same rule `eat()` already uses for the source.
- **`run_transfer(report=[...])` appends to a caller's list rather than changing the return
  type.** The Preparation notebook calls `run_transfer` from the released package and uses its
  return value as the table; a new return shape would break it.
- **Labels are written decoded, as the app displays them.** A reference label is the stored v2
  cell; the report runs it through `to_display_value`, so a percent-encoded name reads as text.
  Ids are written as stored (they are not encoded in the annotation column).
- **TSV, written atomically.** Tab-separated to match the rest of the CLI's text outputs and the
  web app's table export; the report goes through `atomic_write_bytes`, so a failed run never
  leaves half a file. Numbers are written with six significant digits. It is written after the
  bundle, so a `--report` path that cannot hold a file (a directory, or a file where a parent
  directory should be) is a usage error before anything is written.

## Risks / Trade-offs

- [A large run produces a large report: Swiss-Prot-sized queries × k rows] → It is opt-in and
  one line per row; `--k` is the user's choice.
- [`Prediction` grows a field, a public API change for `protlabel`] → Defaulted and additive;
  `protlabel` and `protspace` release in lock-step.
