# Annotation-based cluster-validity — design

**Date:** 2026-07-02
**Branch:** `feat/annotation-cluster-validity` (stacked on `feat/projection-statistics`)
**Refs:** #31 (parent feature request), #63 (extras, merged), #64 (deferred gap/BIC k-selection), protspace_web#296 (frontend spec)

## Motivation

The shipped cluster-validity metric diverges from what #31 asked for. Today `ClusterValidityStatistic` runs KMeans on each projection's 2D coordinates and computes `silhouette / davies_bouldin / calinski_harabasz` **on those auto-KMeans labels**. That answers "does this projection form clean KMeans blobs?" — and it is partly circular, since KMeans optimises the very compactness silhouette/CH reward.

#31 instead asked to *"compute standard clustering quality scores for **any selected feature/annotation**"* and noted *"metrics should be computed on the **original high-dimensional embeddings**, not on UMAP/t-SNE projections which distort distances."* i.e. the scores should measure how well a **biological annotation** (e.g. `major_group`) separates — the answer users actually want.

This rework makes cluster-validity **annotation-based**, while keeping the automated group-detection columns intact.

## Terminology

Use **annotation** throughout (never "feature"). An *annotation* is a per-protein categorical column such as `major_group`. (The only "feature" strings in the repo are legacy Dash help copy — out of scope.)

## What changes / stays

| Piece | Before | After |
|---|---|---|
| Validity scores (silhouette/DBI/CH) | on auto-KMeans labels of the 2D projection | on each **annotation's** category labels, on **both** the embedding and each projection |
| Auto-clustering: `cluster_elbow_*` / `cluster_silhouette_*` membership columns (+ per-point silhouette confidence + auto legend) | present | **kept unchanged** (group detection; frontend #296 already consumes them) |
| Agreement (ARI/NMI) | none | **new** — auto-clusters vs each annotation |
| Auto-cluster **self**-silhouette/DBI/CH aggregate rows | in `statistics.parquet` | **removed** (the circular metric). `n_clusters` meta row kept (documents detected K + inertia/knee for an elbow chart) |
| Gap statistic / BIC-AIC k-selection | — | **out of scope** → #64 |

## What gets computed

For each selected annotation `a` (per-protein category labels), dropping proteins whose value for `a` is missing/`<NaN>`:

1. **Embedding-space validity** — `silhouette / davies_bouldin / calinski_harabasz` of `a` on the source embedding. One set per `(embedding × a)`. The true-separability "ceiling" (#31's Key note). Computed **once per embedding** (not repeated per projection).
2. **Projection-space validity** — the same three on each projection's 2D coords. One set per `(projection × a)`. How well each layout displays that separation.
3. **Agreement** — `adjusted_rand` + `normalized_mutual_info` between each auto-cluster labelling (`kmeans_elbow`, `kmeans_silhouette`) and `a`, per projection. "Did automated KMeans recover `a`?" (label-only; coordinate-independent.)

All silhouette computations reuse the existing subsample (`sample_threshold`, default 5000) and hard-ceiling guards, so cost stays bounded at 570k scale. DBI/CH are `O(n·k)`. ARI/NMI are `O(n)`.

**Input dependencies (best-effort — a missing input skips only what needs it):**
- Annotation-validity + agreement need **annotation data**: the metadata frame in `prepare`, `-a/--annotations` in the standalone `stats` command. Absent → skipped.
- **Embedding-space** validity needs the **embedding**: always present in `prepare`; `-i/--input` in `stats` (already required there for faithfulness). Absent → only projection-space validity is emitted.
- Projection-space validity + agreement need only projection coords + annotations.

## Annotation selection (CLI)

New option on **both** `prepare` and the standalone `stats` command:

- `--stats-annotation major_group,sub_group` — score exactly those columns.
- `--stats-annotation auto` — score every **suitable** categorical annotation.
- **Default when `--stats` is active and the flag is omitted: `auto`.** Only ever evaluated inside a stats run; bounded by the silhouette guards. Users narrow to explicit names to cut compute.

(Chosen over `--score-annotation`; `-a/--annotations` remains the annotation *source*, `--stats-annotation` selects *which columns to score*. Revisit at review if the overlap bothers.)

**Suitable** annotation = categorical AND `2 ≤ n_distinct ≤ min(50, n/2)` AND not all-unique (excludes `identifier`) AND not numeric-valued (excludes `seq_start`, `number_cysteines`) AND not a generated `cluster_*` column. Unsuitable names passed explicitly are skipped with a logged warning (best-effort, never fail the run).

## `statistics.parquet` schema change

Additive — **one new column `annotation`**, and `space_kind` gains the value `embedding` (was always `projection`):

| stat_family | space_kind | space_name | annotation | label_kind | metric | metric_kind |
|---|---|---|---|---|---|---|
| `annotation_validity` | `embedding` | `prot_t5` | `major_group` | `annotation` | `silhouette`/`davies_bouldin`/`calinski_harabasz` | `validity` |
| `annotation_validity` | `projection` | `ProtT5 — UMAP 2` | `major_group` | `annotation` | (same three) | `validity` |
| `cluster_agreement` | `projection` | `ProtT5 — UMAP 2` | `major_group` | `kmeans_elbow`/`kmeans_silhouette` | `adjusted_rand`/`normalized_mutual_info` | `agreement` |
| `cluster_validity` | `projection` | `ProtT5 — UMAP 2` | *(empty)* | `kmeans_elbow`/`kmeans_silhouette` | `n_clusters` | `meta` |

`annotation` is empty for non-annotation rows. `extra_json` keeps per-metric provenance (`sampled`, `sample_size`, `seed`, `n_labels`, and for agreement the two label kinds compared). Readers branch on the `annotation` column / `space_kind`, not on column count.

## Architecture

- **`StatContext`** (`stats/base.py`): add `annotations: dict[str, dict[str, str]] | None` (annotation name → {protein id → category}, id-aligned). Cluster-validity path now also uses `embedding`/`embedding_coords` (today `requires_embedding=False`).
- **Driver** (`stats/driver.py`): accept `annotations` (a frame/dict) and thread it into each `StatContext`. Add a **once-per-embedding pass** that emits embedding-space annotation-validity (so it isn't recomputed for every projection sharing an embedding). Per-projection pass emits projection-space validity + agreement.
- **Statistics classes** (`stats/metrics/`):
  - `ClusterValidityStatistic` — keep only the **auto-clustering + membership columns + `n_clusters` meta** (drop the self-validity aggregate rows).
  - **new `AnnotationValidityStatistic`** — silhouette/DBI/CH of each annotation on the context's space (embedding or projection).
  - **new `ClusterAgreementStatistic`** — ARI/NMI of each auto-cluster labelling vs each annotation (projection contexts only).
  - All keep the best-effort/guard conventions (function-local sklearn imports, per-row try/except, singleton guards for DBI/CH).
- **Carriage** (`stats/carriage.py`): annotation-validity + agreement rows route to `statistics.parquet` (5th part) like existing validity rows. Membership columns + legend unchanged.
- **CLI** (`cli/prepare.py`, `cli/stats.py`): add `--stats-annotation`; validate (`auto` or known column names); pass selection + the annotation frame into the pipeline/driver.

## Frontend (#296) + docs impact

The schema gains `annotation` + `space_kind == embedding` + `cluster_agreement` rows, and drops the auto-cluster self-silhouette. After this lands:
- Regenerate the 3FTx sample bundle.
- Update the #296 spec (currently the concise draft is **not yet posted** — it stays parked).
- Update `CLAUDE.md` / `docs/cli.md` / README / notebook stats sections.

**Merge of `feat/projection-statistics` → main and the #296 cleanup remain paused until this ships.**

## Testing

New/updated `tests/test_stats*.py` cases:
- Annotation validity computed on embedding vs projection (values differ; embedding is the ceiling on a synthetic separable annotation).
- `auto` suitability filter: skips numeric / all-unique / high-cardinality / `cluster_*`; keeps a valid categorical.
- ARI/NMI high when auto-clusters match a planted annotation, low when random.
- Missing-value handling: proteins with `<NaN>` for an annotation are excluded from that annotation's scoring only.
- `--stats-annotation` CLI: `auto`, explicit names, unknown-name warning, on both `prepare` and `stats`.
- Removed: assertions on the old auto-cluster self-silhouette aggregate row.

## Out of scope
- Gap statistic + BIC/AIC k-selection → #64.
- HDBSCAN/GMM auto-clustering models → future (KMeans only).
- Frontend rendering of the new rows → protspace_web#296.

## Migration / compatibility
Bundle stays 5-part (`core(3) + settings? + statistics?`). The `statistics.parquet` gains a column and a `space_kind` value; both are additive and readers branch on content. No change to parts 1–4 beyond the already-shipped membership columns.
