## Context

`add-projection-statistics` shipped two statistic families, computed per projection at prep time and
baked into the `.parquetbundle` as a single fifth part (`statistics.parquet`, a tidy 8-column
long-format table). The frontend reader was made to _tolerate_ that part but not render it —
"frontend rendering" was an explicit committed follow-up.

The `.parquetbundle` is concatenated Parquet tables separated by `---PARQUET_DELIMITER---`:

1. `protein_annotations` — `identifier` + arbitrary annotation columns (categorical or numeric);
   the frontend's **color-by** control enumerates these columns.
2. `projections_metadata` — `projection_name`, `dimensions`, `info_json` (reducer params incl. the
   distance `metric`), `source`.
3. `projections_data` — long `(projection_name, identifier, x, y, z)`.
4. `settings` (optional) — annotation **styles** / display config (palettes, pinned values).
5. `statistics` (optional, from `add-projection-statistics`) — the 8-column stats table.

In his PR #61 review, tsenoner asked us to route each statistic to the part whose **existing
frontend consumer** matches its **granularity**:

| Statistic                                                           | Granularity    | Destination part                     | Existing consumer it rides            |
| ------------------------------------------------------------------- | -------------- | ------------------------------------ | ------------------------------------- |
| KMeans cluster label @ elbow `K`                                    | per protein    | `protein_annotations` (1)            | color-by (categorical)                |
| per-sample silhouette @ `K`                                         | per protein    | `protein_annotations` (1)            | color-by (continuous)                 |
| kNN-overlap / trustworthiness / continuity                          | per projection | `projections_metadata.info_json` (2) | projection method/info surface        |
| silhouette mean / Davies–Bouldin / Calinski–Harabasz / `n_clusters` | per projection | `statistics.parquet` (5)             | (dedicated quality table — new, thin) |

The payoff: the two per-protein columns and the per-method scalars render through machinery that
already exists, shrinking "frontend rendering" to (at most) a small aggregate-validity table.

## Goals / Non-Goals

**Goals**

- Route each already-computed statistic to its consumer-aligned bundle part (the table above).
- Surface per-protein outputs through the existing color-by control (membership pre-styled), and
  faithfulness through the existing projection-info surface, with minimal new frontend code.
- Preserve every guarantee from `add-projection-statistics`: statistics are **secondary** (the core
  bundle ships even if they fail), deterministic under a seed, cost-bounded, and backward compatible.

**Non-Goals**

- Changing **which** statistics are computed, the elbow algorithm, or the cost guards — unchanged.
- A rich statistics dashboard. The aggregate-validity table is minimal and may be a thin follow-up.
- External/label-based validation (ARI/NMI), embedding-space validity, interactive recompute — still
  future work, unchanged from the prior change's non-goals.

## Decisions

### D1 — A statistic output declares a destination

Today a statistic returns `StatRow`s that all land in one table. Introduce a **destination** on each
output: `annotation` (per-protein, carries `identifier`+value), `projection_metadata` (per-method
scalar), or `statistics_part` (the long table). The carriage layer partitions outputs by destination
and fans them to the matching bundle part. This keeps the registry/driver shape and lets future
statistics pick a destination without a new mechanism.

### D2 — Per-protein outputs (cluster membership + per-sample silhouette) → annotations

`cluster_validity` already computes KMeans `labels` at the elbow `K` and discards them; surface them
as a per-protein **categorical** annotation, plus **per-sample silhouette** (`silhouette_samples`,
new but cheap, scikit-learn) as a per-protein **numeric** annotation. Both are **per projection** —
one column pair per reduction, since each reduction has its own elbow `K`.

- **Naming (default):** `cluster_<projection_name>` and `silhouette_<projection_name>` (e.g.
  `cluster_umap2`). The elbow `K` is recorded in annotation metadata / display label, not baked into
  the machine column name (keeps names stable if `K` shifts on re-run). **Open for tsenoner** — he
  wrote "Kx with x variable"; if he wants `K` in the visible name, it goes in the display label.
- **Auto-style (default yes):** generate a categorical palette for each membership column into the
  `settings` part so clusters are colored on load; the numeric silhouette column uses the default
  continuous ramp. This is the concrete "frontend for free" win.
- **Provenance:** membership/silhouette columns are marked computed (not retrieved biological
  annotation) so the UI/consumers can distinguish them; the source projection + `K` + seed live in
  the column metadata.

### D3 — Faithfulness → `projections_metadata.info_json.quality`

kNN-overlap, trustworthiness, continuity are single scalars per projection. Fold them into the
projection's existing `info_json` under a `quality` object (e.g.
`info_json.quality = {knn_overlap, trustworthiness, continuity, k, metric, sampled, ...}`). Additive
(no new metadata column); existing `info_json` consumers ignore unknown keys. This is also the
**natural compute site**: faithfulness needs the embedding _and_ the projection together, which the
`prepare`/`project` stage has in hand — so it is written into metadata there, and the standalone
`stats` command recomputes + merges into `projections_metadata.parquet` for existing projects.

### D4 — Aggregate cluster-validity stays in `statistics.parquet`

silhouette mean, Davies–Bouldin, Calinski–Harabasz, and the `n_clusters` meta row remain the
8-column tidy table — now the **only** thing in the fifth part. Its schema and the "new scalar = new
row" property are unchanged; it simply no longer carries per-protein or faithfulness data.

### D5 — Robustness & decoupling preserved via core-first re-enrichment

`add-projection-statistics` guarantees the prep job never fails for statistics and never loses the
bundle. Under routing, per-protein outputs live in `protein_annotations` (a **core** part), so
enrichment now rewrites parts 1/2/4/5, not just appends part 5. Preserve the guarantee by keeping the
**existing shape**: build the core (un-enriched) bundle first within the parent timeout; then a
best-effort step computes statistics and **re-bundles to a temp file with the routed parts merged
in**, atomically `os.replace`-ing it over the core bundle on success. On any stats failure/timeout
the un-enriched core bundle stands. No regression in the safety property; the diff is _which_ parts
the enrichment rewrites.

### D6 — Backward compatibility

- Annotations: extra computed columns; readers already accept arbitrary annotation columns.
- `info_json`: an extra `quality` key; readers parse JSON and ignore unknown keys.
- `statistics.parquet`: same 8-column schema, fewer row families (aggregate only). Readers that
  tolerate the fifth part are unaffected; consumers that previously expected faithfulness/labels in
  the part must now read them from metadata/annotations — but the only such consumer is our own
  not-yet-shipped frontend, so there is no external break. Bundles produced before this change still
  read; bundles without statistics are unchanged.

## Risks / trade-offs

- **Annotation-table growth.** One membership + one silhouette column **per projection** (6 DR
  methods → 12 computed columns). Mitigate with the `cluster_*`/`silhouette_*` prefix + computed-
  provenance flag so the UI can group/collapse them; consider a default of styling only the membership
  columns. Reviewers should sanity-check color-by UX with ~12 extra columns.
- **Loss of single-format generality.** The prior design's "all statistics are rows in one tidy
  table" is deliberately broken up. Accepted: consumer-fit beats storage uniformity here, and it is
  the maintainer's call.
- **Tighter coupling of stats into the core bundle.** Mitigated by D5 (core-first re-enrichment);
  must be covered by a test asserting a stats failure still yields the core bundle.
- **Frontend assumptions unverified.** This design assumes (a) color-by enumerates all annotation
  columns including computed ones, (b) there is a projection info/method surface that can show
  `info_json.quality`, and (c) styles in the `settings` part drive initial coloring. These are
  **assumptions to verify against the actual frontend** (a review lens below targets exactly this);
  if (b) does not exist, faithfulness display becomes a small new surface (still cheaper than a full
  stats panel).

## Migration / sequencing

Engine PR first (routing + per-point outputs + metadata/annotation writers), then the web PR (prep
re-enrichment + frontend surfacing). Both layer on top of the still-open `add-projection-statistics`
PRs (#61 / #295); cleanest is to **fold this routing into those PRs before merge** rather than ship
the opaque fifth part and immediately refactor it — to be confirmed with tsenoner (amend #61/#295 vs
stacked follow-up PRs).

## Open questions for tsenoner (defaulted, non-blocking)

1. Column naming + whether `K` shows in the visible name; elbow-`K`-only vs a small `K` sweep.
2. Amend #61/#295 in place vs land them and stack this refactor on top.
3. Should the aggregate-validity fifth part get a minimal UI now, or stay carried-but-unrendered
   until a later dashboard change.

## Review outcomes (4-lens fan-out) — revised decisions

A parallel review (frontend-feasibility, engine-feasibility, spec-quality, adversarial) grounded in
the real code corrected several first-pass assumptions. Revised decisions:

- **D-route (NEW, supersedes part of D3/D5): fan out at bundle-assembly time, not in `protspace
stats`.** `cli/stats.py` reads only `projections_data`/`projections_metadata` and writes one
  `statistics.parquet` ("No annotations are needed"); it has no annotations handle and the prep
  service calls it directly. So `stats` stays a **pure aggregate-only producer**; all routing happens
  where annotations + metadata + coords coexist — the `prepare`/pipeline path (`pipeline.run`'s
  `metadata` frame is the join target) and the prep re-bundle. This removes the showstopper of
  "rewrite the `stats` command into a project rewriter."

- **D-phase (NEW): phase per-protein behind faithfulness+aggregate, and stack on #61/#295.** See
  proposal "Sequencing". Faithfulness→metadata + aggregate-only fifth part (Phase 1) carry almost no
  core-bundle risk; the per-protein annotations (Phase 2) are where the typing/UX/coupling cost lives.

- **D2 corrected — typing is not automatic.** `base_processor._create_protein_annotations_table`
  does `df.fillna("").astype(str)` on the whole frame, and the frontend infers type from **content**
  (`conversion.ts:inferAnnotationType`). So integer cluster labels would infer as _numeric_ (wrong);
  membership MUST be written as non-numeric strings (`cluster 0`). Per-point silhouette must survive
  as clean numeric strings (no `;`/`|`, empty for missing) to infer continuous. `silhouette_samples`
  is **not** "cheap" — unlike the aggregate mean it has no sampling path; it needs its own hard-ceiling
  skip guard.

- **D-style corrected — `settings` is a full envelope, not a palette; "colored on load" is false.**
  The settings part stores `LegendPersistedSettings` per annotation (`maxVisibleValues`, `shapeSize`,
  `sortMode`, `hiddenValues`, `enableDuplicateStackUI`, `selectedPaletteId`, `categories:{value:
{color,shape,zOrder}}`), and `sanitizeLegendSettingsEntry` **drops** any incomplete entry. The
  engine must emit the whole envelope, categories keyed by the exact label strings. Initial color-by
  is `annotations[0]` and file settings apply only to the _selected_ annotation, so the guarantee is
  "colored **when selected**"; making a membership column the initial selection is separate frontend
  work (initial-view / `publishState`).

- **D3 corrected — faithfulness display is small new code, not free.** `projection-metadata.ts`
  flattens `info_json` one level; a nested `quality` object renders as a raw `JSON.stringify` blob,
  so the component must be extended to expand `quality` into per-metric rows.

- **Carriage hazard — filename mismatch.** `ArrowReader._load_data` reads
  `selected_annotations.parquet` but `ArrowReader.save_data` writes `protein_annotations.parquet`;
  a router that reuses `save_data` would silently lose annotations. Build the augmented annotations
  table directly and re-bundle via `write_bundle` (which already accepts `statistics=`);
  `replace_settings_in_bundle` preserves core parts byte-for-byte and **cannot add columns**.

- **Determinism — elbow `K` must be stable**, else membership labels re-bucket between runs (added to
  the reproducibility scenario).

- **`metric_kind` enum — `faithfulness` value is retired from the fifth part** (now only `validity`
  / `meta` rows there); the column may still admit it but it is not produced.
