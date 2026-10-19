## Context

After `add-transfer-neighbour-report`, `eat(keep_neighbors=True)` hands back each query's
neighbours with their raw distances, nearest first. A cutoff needs only the rank-1 distance per
query and, for `auto`, the same quantity for each reference against the other references.

## Goals / Non-Goals

**Goals:**

- A near/distant split written into the bundle, so it can be coloured, filtered and exported in
  the web app like any annotation.
- A default cutoff that adapts to the embedding model and the reference set, and says what it
  chose.

**Non-Goals:**

- Calibrated probabilities (#363 is the benchmark work for that).
- Per-label cutoffs (a family-specific radius).

## Decisions

- **Distance to the nearest reference of any label, not to the prediction's source.** "Near" is a
  statement about the query's neighbourhood, not about the label vote. With `--k 1` the two are
  the same reference; with `--k > 1` the source can be farther than the rank-1 neighbour, and a
  query sitting right next to a reference should not be called distant because the vote went to
  another label.
- **`auto` = 95th percentile of reference-to-nearest-other-reference distances, per column.** It
  asks "is this query at least as close to the references as the references typically are to
  each other". Per column, because each column has its own reference set. Computed with one
  `nearest(refs, refs, k=2)` call, taking each row's nearest neighbour that is not itself by
  index (not by distance: duplicate embeddings make a zero distance ambiguous, and cosine
  self-distance is not exactly 0). A column with fewer than two references cannot be calibrated
  and is a usage error. Alternatives considered: an elbow on the sorted query distances (the
  extractor's rule) depends on the queries containing both populations; a fixed confidence
  threshold does not travel between models.
- **`<COL>__neighbor`, not a `__pred_` companion.** The `__pred_` namespace is reserved for the
  value/confidence/source trio and the loader rejects partial trios; a fourth reserved suffix
  would need loader, writer and spec changes for something that is an ordinary category. As a
  plain string column the web app shows it in the colour-by list and the filter builder, and the
  v3 encoder stores it as categorical with no format change. Values are `near` / `distant`;
  non-queries are null, so references read as N/A.
- **`--skip-distant` is opt-in.** Labelling every query stays the default, so existing runs and
  the reliability filter's workflow are unchanged. With the flag, a distant query is dropped from
  the predictions before the overlay columns are built, so it has no `__pred_*` cells at all
  rather than a low-confidence one. Its report rows keep the would-be label and source (marked
  `distant`), so the report still says what the nearest reference was. A cutoff that leaves every
  query of a column distant is almost always a `D` taken from another model, and the command is
  otherwise silent on success, so that case warns at default verbosity.
- **The chosen cutoff is logged at INFO and written to the report.** The command logs nothing at
  default verbosity on success, so `-v` shows it; the report's `max_distance` column carries it
  per row, next to the class.
- **A stale `<COL>__neighbor` is dropped on every re-transfer of `COL`.** Otherwise a run without
  a cutoff would leave a class computed against predictions that no longer exist.
- **The web label is a suffix fallback in `getAnnotationMeta`.** Like the EAT-confidence label, it
  reuses the base column's label and source: "<base> — EAT neighbourhood". It changes only the
  label and description; the column is not marked predicted.

## Risks / Trade-offs

- [`auto` costs a reference-by-reference search] → One extra `nearest` call over the references,
  bounded in memory like the query search; only paid when `auto` is asked for.
- [A user column that happens to end in `__neighbor` gets the EAT label] → Only the label and
  description change; the data is untouched.
- [Distances are model- and metric-specific] → `auto` is the documented choice; a fixed `D` is
  for users who have calibrated one.
