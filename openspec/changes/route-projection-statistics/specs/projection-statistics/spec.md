## ADDED Requirements

### Requirement: Statistics are routed to consumer-aligned bundle parts

Each computed statistic SHALL be carried in the bundle part that matches its **granularity and
consumer**, not in a single catch-all part. Specifically: **per-protein** outputs (cluster
membership, per-point silhouette) SHALL be carried as columns in `protein_annotations`; **per-method
faithfulness** scalars SHALL be carried in `projections_metadata` (within each projection's
`info_json`); and **per-method aggregate cluster-validity** scalars SHALL be carried in the
`statistics.parquet` part. The routing SHALL be additive and backward compatible: bundles without
statistics, and pre-routing bundles, SHALL still read; the annotation columns and `info_json`
additions SHALL be ignorable by existing readers.

#### Scenario: A statistics-bearing bundle routes outputs to three parts

- **WHEN** a bundle is prepared from embeddings with statistics enabled
- **THEN** for each projection the cluster membership and per-point silhouette appear as
  `protein_annotations` columns, the faithfulness scalars appear in that projection's
  `projections_metadata.info_json`, and the aggregate cluster-validity scalars appear in
  `statistics.parquet`

#### Scenario: A statistic declares its destination

- **WHEN** a statistic produces an output
- **THEN** the output carries a destination of `annotation`, `projection_metadata`, or
  `statistics_part`, and the carriage layer fans it to the matching bundle part without the statistic
  knowing the bundle layout

#### Scenario: Existing readers tolerate the additions

- **WHEN** a reader that predates this change loads a routed bundle
- **THEN** the extra annotation columns and the `info_json.quality` key are ignored without error,
  and projections/annotations/settings load normally

#### Scenario: Statistics disabled produces an un-routed bundle

- **WHEN** preparation is run with statistics disabled (`--no-stats` / prep flag off)
- **THEN** no `cluster_*`/`silhouette_*` annotation columns are added, no `info_json.quality` key is
  written, no auto-style is generated, and no `statistics.parquet` part is emitted — the bundle is
  the same shape as a pre-routing core bundle

### Requirement: Cluster membership is delivered as a per-projection annotation

For each projection, the KMeans labelling at the elbow-estimated `K` SHALL be delivered as a
**categorical per-protein annotation column**, joined to proteins by `identifier`. Membership values
SHALL be written as **non-numeric category labels** (e.g. `cluster 0`, not `0`) so the frontend's
content-based type inference (`conversion.ts:inferAnnotationType`) classifies the column as
categorical rather than as a continuous numeric ramp; the all-string annotation serialization in
`base_processor._create_protein_annotations_table` (which `.astype(str)`s every column) MUST NOT
cause membership to be mis-typed. There SHALL be one membership column per projection (each projection
has its own elbow `K`). The column SHALL be marked as a **computed** annotation (distinct from
retrieved biological annotations), and its source projection, elbow `K`, and seed SHALL be recorded
in the column's metadata. A protein absent from a projection SHALL have no membership value for that
projection rather than a wrong one.

#### Scenario: Membership appears in the color-by control

- **WHEN** the app loads a routed bundle
- **THEN** each projection's cluster-membership column is selectable in the color-by control and
  colors points by cluster

#### Scenario: Membership is per projection

- **WHEN** a run produces more than one projection
- **THEN** each projection contributes its own membership column at its own elbow `K`, and selecting
  one does not mislabel points of another

### Requirement: Per-point silhouette is delivered as a per-projection annotation

For each projection, the per-sample silhouette values at the elbow `K` (`silhouette_samples`,
computed over the **full** labelled point set — not the cost-bounded subsample the aggregate mean
silhouette uses) SHALL be delivered as a **numeric per-protein annotation column**, joined by
`identifier`, one column per projection, marked computed with source projection / `K` / seed in its
metadata. The column MUST round-trip as clean numeric strings (no `;`/`|` separators, empty for
missing) so the frontend infers it as a continuous field. Because `silhouette_samples` has no
sampling escape hatch and is O(n²)-class, its own cost guard (skip beyond the hard ceiling, recording
a marker) SHALL apply. Points excluded from silhouette scoring (degenerate `K`, beyond the ceiling,
or absent from the projection) SHALL carry no value rather than a fabricated one.

#### Scenario: Per-point silhouette is colorable as a continuous field

- **WHEN** the app loads a routed bundle
- **THEN** the per-point silhouette column is selectable in color-by and renders as a continuous
  ramp, letting a user see which points fit their cluster well

#### Scenario: Aggregate and per-point silhouette are distinct

- **WHEN** both the per-point silhouette annotation and the aggregate silhouette statistic exist
- **THEN** the annotation carries one value per protein and the aggregate carries one value per
  projection in `statistics.parquet`; neither is derived by the consumer from the other

### Requirement: Faithfulness is delivered as per-projection reducer metadata

The faithfulness scalars (kNN-overlap, trustworthiness, continuity) SHALL be carried **per
projection** inside `projections_metadata.info_json`, under a `quality` object, alongside the
reducer's other info. Each value SHALL record its neighbourhood size `k`, the high-dimensional
distance metric used, and any sampling/skip provenance. `info_json` SHALL remain valid JSON whose
unknown keys are ignorable by existing consumers.

#### Scenario: Faithfulness rides with the projection's other metadata

- **WHEN** a consumer reads a projection's metadata
- **THEN** `info_json.quality` exposes that projection's kNN-overlap, trustworthiness, and continuity
  with their `k`, metric, and sampling provenance

#### Scenario: Faithfulness is computed where the embedding is in hand

- **WHEN** statistics are produced during `prepare`/`project` (embedding and projection both present)
- **THEN** faithfulness is computed there and written into `projections_metadata`; the standalone
  `stats` path recomputes and merges it into an existing project's `projections_metadata`

#### Scenario: A projection without an available embedding omits faithfulness

- **WHEN** a projection's source embedding is unavailable
- **THEN** its `info_json.quality` omits faithfulness (no key) rather than recording a wrong value

#### Scenario: Multi-embedding runs route to the correct projection's metadata

- **WHEN** a run produces projections from more than one source embedding
- **THEN** each projection's `info_json.quality` is computed against the embedding that produced it
  (matched by name + id-intersection join), never a neighbour's

### Requirement: Cluster-membership annotations are auto-styled

When statistics are enabled, the carriage layer SHALL generate a complete legend-settings entry for
each cluster-membership column and write it into the bundle's `settings` part so the membership is
colored **when selected**, without a manual styling step. The generated entry SHALL be a full
`LegendPersistedSettings` envelope as the frontend loader requires — `maxVisibleValues`, `shapeSize`,
`sortMode`, `hiddenValues`, `enableDuplicateStackUI`, `selectedPaletteId`, and `categories` keyed by
the exact membership label strings, each category carrying `color`, `shape`, and `zOrder` — because
the loader's `sanitizeLegendSettingsEntry` rejects (drops) any entry missing these fields. Because the
frontend's initial color-by selection is the first annotation column (not necessarily a membership
column) and file settings apply only to the _selected_ annotation, "colored when selected" is the
guarantee; making a membership column the **initial** selection is a separate frontend concern (see
the frontend requirement). Generating styles SHALL NOT remove or overwrite existing user/annotation
styles, and SHALL be skipped cleanly when statistics are disabled.

#### Scenario: A selected membership column is colored without manual styling

- **WHEN** the app loads a routed bundle with statistics enabled and the user selects a
  cluster-membership column
- **THEN** that column already has a complete legend-settings entry (categories colored per label),
  so clusters are colored with no manual styling step

#### Scenario: Incomplete style envelopes are not emitted

- **WHEN** the carriage layer writes a generated membership style
- **THEN** it writes the full `LegendPersistedSettings` envelope (not a bare color map), so the
  loader's sanitizer does not discard the entry

#### Scenario: Auto-styling preserves existing styles

- **WHEN** the bundle already carries annotation styles in its settings part
- **THEN** the generated cluster styles are added without dropping or altering the pre-existing styles

### Requirement: Settings rewrites preserve routed statistics and generated styles

The `protspace style` / settings-replacement path (`replace_settings_in_bundle`) SHALL preserve a
routed bundle's statistics carriage across a settings rewrite: the `statistics.parquet` part SHALL be
retained, and the generated `cluster_*` membership styles SHALL NOT be dropped, when a user re-runs
styling on a routed bundle. (This replaces the prior change's "Styling preserves statistics for both
shapes" guarantee, extended to cover the auto-generated cluster styles.)

#### Scenario: Styling a routed bundle keeps statistics and cluster styles

- **WHEN** a settings-replacement / `protspace style` operation rewrites a routed,
  statistics-bearing bundle
- **THEN** the statistics part is preserved and the auto-generated cluster-membership styles survive
  the rewrite (merged with any user styling), rather than being clobbered

## MODIFIED Requirements

### Requirement: Statistics are a stable tidy long-format table with joinable keys

The `statistics.parquet` part SHALL be a tidy long-format table with the fixed eight-column schema
(`space_kind`, `space_name`, `stat_family`, `label_kind`, `metric`, `metric_kind`, `value`,
`extra_json`), one statistic value per row, and SHALL now carry **only per-method aggregate
cluster-validity** — the silhouette mean, Davies–Bouldin, Calinski–Harabasz (`metric_kind`
`validity`) and the `n_clusters` row (`metric_kind` `meta`). Per-protein outputs and faithfulness
SHALL NOT appear in this part (they are routed to annotations and projection metadata respectively).
`space_name` SHALL still equal the corresponding `projections_metadata.projection_name` so the table
is joinable, and adding a new **aggregate scalar** statistic SHALL add rows, not columns.

#### Scenario: The statistics part holds aggregate validity only

- **WHEN** a consumer reads `statistics.parquet`
- **THEN** it finds per-projection silhouette/davies_bouldin/calinski_harabasz validity rows and the
  `n_clusters` meta row, and finds no faithfulness rows and no per-protein rows

#### Scenario: Aggregate rows remain joinable to projections

- **WHEN** a consumer joins the statistics part to projection metadata
- **THEN** each row's `space_name` matches a `projection_name`, and `metric_kind` `meta` separates
  `n_clusters` from the `validity` scores

### Requirement: The frontend reader tolerates the statistics part

The frontend SHALL **surface** the routed statistics through existing consumers rather than only
tolerating an opaque part: cluster-membership and per-point-silhouette annotation columns SHALL be
available in the color-by control (membership colored via its generated style; silhouette as a
continuous ramp). Each projection's `info_json.quality` faithfulness SHALL be displayed in the
projection's method/info surface (`projection-metadata.ts`); because that component currently flattens
`info_json` only one level (rendering a nested object as a raw JSON blob), it SHALL be extended to
render the `quality` sub-object as discrete per-metric rows. The aggregate `statistics.parquet` part
MAY be surfaced as a small per-projection quality table; if not yet surfaced, its presence or absence
SHALL NOT affect rendering. A bundle lacking any statistics SHALL render exactly as before.

#### Scenario: Routed statistics render through existing controls

- **WHEN** the app loads a routed bundle
- **THEN** cluster and per-point-silhouette columns appear in color-by, faithfulness is available
  per projection for display, and the projection renders with no error

#### Scenario: A statistics-less bundle is unaffected

- **WHEN** the app loads a bundle prepared with statistics disabled
- **THEN** no statistics-derived columns, metadata quality, or table appear, and rendering is
  identical to pre-change behaviour

### Requirement: Statistics computation is non-fatal, reproducible, and guarded

Statistics remain **secondary** to the core bundle under the new routing. In the prep service the
**core (un-enriched) bundle SHALL be produced first**; a best-effort enrichment step — under its own
bounded timeout caught locally — SHALL then recompute the routed statistics and **rewrite the
affected parts (annotations, projection metadata, settings, and the statistics part) into a temporary
bundle swapped in atomically on success**. A stats failure or timeout SHALL leave the already-produced
un-enriched bundle in place and SHALL NOT fail the job or lose the bundle. Computation SHALL remain
deterministic under a recorded seed and SHALL keep the existing cost and degeneracy guards (bounded
sampling above a threshold, skip beyond a hard ceiling, singleton-cluster exclusion for DB/CH, no row
for inputs too small to score). Provenance (seed, neighbourhood size, distance metric, sampling, knee
confidence, source embedding, elbow `K`) SHALL be recorded with each output.

#### Scenario: Enrichment failure preserves the core bundle

- **WHEN** the enrichment step fails or times out
- **THEN** the job still succeeds and the un-enriched core bundle (produced first) is delivered, with
  no statistics columns, metadata quality, or statistics part

#### Scenario: Enrichment is atomic

- **WHEN** the enrichment step is interrupted mid-write
- **THEN** the original core bundle is never left partially overwritten — the enriched bundle is
  swapped in only when fully written

#### Scenario: Results are reproducible

- **WHEN** the same input is prepared twice with the same seed and projection
- **THEN** the selected elbow `K` per projection is identical, and the routed statistics (membership,
  per-point silhouette, faithfulness, aggregate validity) are identical, with the seed recorded — a
  stable `K` being required so membership labels do not silently re-bucket between runs

## REMOVED Requirements

### Requirement: Statistics ride in the bundle as an optional fifth part, backward compatibly

**Reason:** Replaced by "Statistics are routed to consumer-aligned bundle parts". Statistics are no
longer carried solely as a fifth part; the fifth part now holds aggregate validity only, while
per-protein and per-method outputs are routed to the annotations and projection-metadata parts. The
backward-compatibility guarantee is carried by the routing requirement; the `protspace style`
round-trip guarantee is **explicitly re-stated** in the new "Settings rewrites preserve routed
statistics and generated styles" requirement (not silently dropped). **Migration:** the only consumer
that read faithfulness/labels from the fifth part is our own not-yet-shipped frontend, so there is no
external break; landing #61/#295 (the opaque fifth part) first and removing those rows in this
follow-up is therefore non-breaking (see proposal "Sequencing").
