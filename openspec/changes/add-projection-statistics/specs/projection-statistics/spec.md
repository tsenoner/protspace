## ADDED Requirements

### Requirement: Per-projection statistics are computed at preparation time

The preparation pipeline SHALL compute, for each projection, both **cluster-validity** and
**projection-faithfulness** statistics during data preparation and embed them in the produced
`.parquetbundle` when statistics are enabled (the default). Cluster-validity SHALL include the
silhouette score, the Davies–Bouldin index, the Calinski–Harabasz index, and the elbow-estimated
optimal cluster count, and its rows SHALL carry `label_kind` `kmeans_elbow`. Faithfulness SHALL
include kNN-overlap and trustworthiness/continuity of the projection relative to its source
embedding.

#### Scenario: Statistics are produced by default

- **WHEN** a bundle is prepared from embeddings with statistics enabled
- **THEN** the bundle contains a statistics part with, for every projection, cluster-validity rows
  (silhouette, davies_bouldin, calinski_harabasz, n_clusters) and faithfulness rows (knn_overlap,
  trustworthiness, continuity)

#### Scenario: Statistics can be disabled

- **WHEN** preparation is run with statistics disabled (`--no-stats` / prep flag off)
- **THEN** no statistics part is produced and the bundle remains a valid three- or four-part bundle

### Requirement: The elbow estimates the optimal cluster count from the inertia knee

The unsupervised cluster source SHALL sweep KMeans across a bounded range of cluster counts on the
projection coordinates and select the optimal count using the **index** of the maximum
perpendicular deviation of the inertia curve from its first-to-last chord (not a distance value). It
SHALL report the selected count as `n_clusters` with `metric_kind` `meta`, label points accordingly
so the validity metrics score that clustering, and record a knee-confidence indicator and the
silhouette-optimal count for cross-checking.

#### Scenario: Elbow recovers a known cluster count

- **WHEN** the data forms `k` well-separated clusters
- **THEN** the elbow-estimated `n_clusters` is within one of `k` and the silhouette of the selected
  clustering is high relative to an overlapping-cluster baseline

#### Scenario: No clear knee is flagged, not faked

- **WHEN** the inertia curve is approximately linear (no distinct knee)
- **THEN** the selected count is still emitted but marked with low knee confidence in `extra_json`

### Requirement: Faithfulness compares embedding and projection neighbourhoods

Faithfulness statistics SHALL take a projection and **its source embedding** as input and measure how
well the projection preserves each point's neighbourhood. Continuity SHALL be computed as
trustworthiness with the embedding and projection arguments swapped, and the high-dimensional
distance metric SHALL be applied to whichever computation has the embedding as its primary input.
The high-dimensional metric SHALL default to the projection's own reducer metric (Euclidean by
default), falling back to cosine only when unknown, and SHALL be recorded per row. These statistics
carry `metric_kind` `faithfulness` and `label_kind` `none`, and SHALL bound their cost on large
inputs (sampling a shared subset above a threshold, skipping with a recorded marker beyond a hard
ceiling) since trustworthiness materialises a full pairwise distance matrix.

#### Scenario: A faithful projection scores high

- **WHEN** the projection preserves neighbourhoods (e.g. a near-identity reduction)
- **THEN** kNN-overlap and trustworthiness are near their maximum

#### Scenario: A distorting projection scores lower

- **WHEN** the projection scrambles neighbourhoods (e.g. a random projection)
- **THEN** kNN-overlap and trustworthiness are markedly lower, with the neighbourhood size and the
  per-row distance metric recorded in `extra_json`

#### Scenario: Each projection uses its own embedding

- **WHEN** a run produces projections from more than one embedding
- **THEN** each projection's faithfulness is computed against the embedding that produced it (matched
  by name and id-intersection join), and any projection whose embedding is unavailable is skipped
  with a recorded marker rather than scored against the wrong embedding

#### Scenario: Large inputs are bounded

- **WHEN** the number of points exceeds the sampling threshold
- **THEN** faithfulness (and silhouette) are computed on a fixed-seed shared subsample with the
  sample size recorded, and beyond a hard ceiling the statistic is skipped with a recorded marker
  rather than exhausting memory

### Requirement: Statistics are a stable tidy long-format table with joinable keys

The statistics part SHALL be a tidy long-format table with a fixed eight-column schema: `space_kind`
(string), `space_name` (string), `stat_family` (string), `label_kind` (string), `metric` (string),
`metric_kind` (string), `value` (double), and `extra_json` (string), with one statistic value per
row. `metric_kind` (`validity` | `meta` | `faithfulness`) SHALL be a column so consumers can
aggregate validity scores without folding in meta rows such as `n_clusters`. `space_name` SHALL equal
the corresponding `projections_metadata.projection_name` so the table is joinable without string-
parsing. Adding a new scalar statistic, label source, or space SHALL add **rows** and SHALL NOT
change the column schema; any per-source attribute (e.g. an annotation column name) SHALL be carried
inside `extra_json`, not as a new column.

#### Scenario: Each row is self-describing and joinable

- **WHEN** a consumer reads the statistics part
- **THEN** every row identifies its space (kind + name), family, label kind, metric, and metric kind,
  carries a numeric value, and its `space_name` matches a `projection_name` in the projections metadata

#### Scenario: Meta rows are separable from validity rows

- **WHEN** a consumer aggregates cluster-validity scores
- **THEN** it can exclude `n_clusters` by its `metric_kind` `meta` column without parsing `extra_json`

#### Scenario: New statistics do not change the schema

- **WHEN** a later expansion adds an embedding space or an annotation-feature label source
- **THEN** it appears as additional rows (e.g. `space_kind` `embedding`, or `label_kind` `annotation`
  with the source column in `extra_json`) under the same eight-column schema

### Requirement: Statistics ride in the bundle as an optional fifth part, backward compatibly

The `.parquetbundle` SHALL carry statistics as an optional fifth parquet part in the positional order
`core(3) + settings? + statistics?`. When statistics are present but settings are absent, a zero-byte
settings part SHALL occupy the fourth slot, and all readers and writers SHALL distinguish settings-
present from settings-absent by the **fourth part's emptiness**, not by raw part count. All bundle
readers and writers — including `read_bundle` (whose existing return shape is preserved so its callers
do not break), `extract_bundle_to_dir`, and `replace_settings_in_bundle` (the styling path) — SHALL
handle the fifth part; three- and four-part bundles SHALL retain their exact current meaning.

#### Scenario: Legacy bundles are unaffected

- **WHEN** a three-part (core only) or four-part (core + settings) bundle is read or rewritten
- **THEN** it behaves exactly as before, with no statistics part

#### Scenario: Five-part bundle round-trips

- **WHEN** a five-part bundle (core + settings + statistics) is read
- **THEN** projection, annotation, and settings data load normally and the statistics part is
  recovered

#### Scenario: Styling preserves statistics for both shapes

- **WHEN** an annotation-styling / settings-replacement operation rewrites a statistics-bearing
  bundle, whether it has display settings or only a zero-byte settings slot
- **THEN** the statistics part is preserved (not dropped), with a valid settings part written and the
  statistics part kept as the fifth

### Requirement: The frontend reader tolerates the statistics part

The frontend bundle reader SHALL load a five-part bundle without error in both the settings+statistics
and the zero-byte-settings (statistics-only) shapes, distinguishing them by the fourth part's
emptiness, and treating the statistics part as optional and parsed-but-unused. Its presence or absence
SHALL NOT affect rendering of projections, annotations, or settings.

#### Scenario: App loads a statistics-bearing bundle

- **WHEN** the app loads a five-part bundle produced by the prep pipeline (with or without settings)
- **THEN** the projection renders normally with no error and the statistics part is ignored for now

### Requirement: Statistics computation is non-fatal, reproducible, and guarded

Statistics are secondary to the core bundle. In the prep service the **core bundle SHALL be produced
first**, and computing statistics — under its own bounded timeout caught locally — SHALL NOT fail the
job, lose the bundle, or consume the budget the bundle needs; a stats failure or timeout SHALL leave
the already-produced stats-less bundle in place. Computation SHALL be deterministic under a recorded
seed (KMeans, silhouette sampling, and faithfulness subsampling), and SHALL guard expensive and
degenerate cases: silhouette and faithfulness SHALL use a bounded shared sample above a size
threshold and skip beyond a hard ceiling; clusters with fewer than two members SHALL be excluded from
Davies–Bouldin / Calinski–Harabasz; and inputs too small to score (fewer than three points, a single
cluster) SHALL yield no row rather than raising. Provenance (seed, neighbourhood size, distance
metric, sampling, knee confidence, source embedding) SHALL be recorded in `extra_json`.

#### Scenario: A computation failure does not fail the job or lose the bundle

- **WHEN** statistics computation fails or times out in the prep service
- **THEN** the job still succeeds and the core bundle (produced before the stats step) is delivered
  without a statistics part

#### Scenario: A stale engine degrades to skip

- **WHEN** the installed `protspace` does not provide the `stats` subcommand
- **THEN** the prep service detects this via a feature probe and skips statistics rather than failing

#### Scenario: Results are reproducible

- **WHEN** the same input is prepared twice with the same seed and projection
- **THEN** the statistics values are identical, and each row records the seed used
