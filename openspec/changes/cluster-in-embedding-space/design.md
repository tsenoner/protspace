## Context

`ClusterValidityStatistic` (`stats/metrics/validity.py`) runs in the driver's per-projection pass. For each projection it sweeps KMeans over K = 2..min(√n, 50) on the projection's coordinates (`kmeans_elbow`), picks K by the inertia elbow and/or the maximum silhouette, and emits:

- an `n_clusters` meta row (`stat_family=cluster_validity`);
- a per-protein `AnnotationColumn` `cluster_<selection>_<projection>` holding `cluster N`;
- that labelling's own separation scores, through `AnnotationValidityStatistic(label_kind=kmeans_<selection>)`;
- ARI/NMI against each scored annotation (`stat_family=cluster_agreement`).

The driver also has a once-per-embedding pass, used today only by `AnnotationValidityStatistic` to score curated annotations on the source embedding (the panel's "Embedding" reference column).

The web app (`packages/utils/src/visualization/annotation-statistics.ts`) finds a clustering's rows by rebuilding its column name from a row's `label_kind` and `space_name` (`cluster_elbow_${space_name}`), without looking at `space_kind`. Separation scores for a column in a projection are its `annotation_validity` rows with `space_kind=projection` and that projection's name; the "Embedding" reference is the same annotation's `space_kind=embedding` rows.

## Goals / Non-Goals

**Goals:** one cluster column per embedding, shared by every projection of it, so cluster ids compare across UMAP and t-SNE (#324); scores for it that mean what the app's labels say; bounded cost at about 5,000 × 1,280; existing columns unchanged.

**Non-goals:** other algorithms or K-selection methods; frontend changes; any 3-D option.

## Decisions

### 1. One option, three values, default `both`

`--cluster-space projection|embedding|both` on `stats` and on `prepare` (with `--stats`), carried to the statistic as `params["cluster_space"]`, beside `cluster_selection`.

The default is `both`. `projection` alone would leave #324's request opt-in and keep the misleading per-layout ids as the only thing a new user sees. `embedding` alone would silently drop the `cluster_elbow_<projection>` columns that existing bundles, the example datasets and users' scripts name. `both` keeps every column a re-run wrote before, under the same name and meaning, and adds one per embedding. The cost is one extra sweep per embedding (Decision 3), small next to the projections it shares a run with.

The raw `compute_statistics` API uses the same default, so the CLI, the pipeline config and the statistic cannot disagree; a test pins the four places the default is written. An unknown value falls back to the default, as an unknown `cluster_selection` already does.

### 2. Naming: `cluster_<selection>_<embedding name>`

The column follows the existing rule `cluster_<selection>_<space name>` with the embedding's name (`cluster_elbow_esm2_650m`, beside projections named like `ESM2-650M — UMAP 2`). The web app rebuilds a clustering's column from `label_kind` + `space_name`, so its Recovers block and its auto-cluster check find the new column with no change. Projection names always carry a ` — <METHOD> <dims>` suffix, so an embedding name cannot collide with one. The `CLUSTER_COLUMN_PREFIX` exclusion already keeps the new column out of curated-annotation scoring.

### 3. Cost: 50 principal components and 3 restarts

Measured on 4 cores, a synthetic 5,000 × 1,280 float32 embedding with 12 Gaussian groups, full elbow sweep (K = 2..50):

| Input to the sweep     | KMeans restarts per K | Time  | K found | ARI vs truth |
| ---------------------- | --------------------- | ----- | ------- | ------------ |
| 2-D projection (today) | 10                    | 10 s  | —       | —            |
| raw 1,280 dims         | 10                    | 131 s | 12      | 1.00         |
| top 50 PCs             | 10                    | 57 s  | 12      | 1.00         |
| top 50 PCs (chosen)    | 3                     | 20 s  | 12      | 1.00         |
| top 50 PCs             | 1                     | 6 s   | 13      | 0.98         |

KMeans cost is O(n · K · d) per iteration, so reducing d from 1,280 to 50 is the main lever, and the PCA subspace is where KMeans' continuous relaxation lives (Ding & He, 2004), so the top components keep the cluster structure. Three restarts match what the sweep already uses on its large-n `MiniBatchKMeans` path; one restart started to pick a different K.

The PCA is fitted on the same deterministic id-canonical subsample (≤ `max_fit_sample`, 50,000) the sweep draws, then applied to every row in chunks, so a 570k-row embedding is never copied whole to float64 and labels depend only on the id set, as the existing sampling contract requires. An embedding of 50 or fewer dimensions is clustered as is. Above `max_fit_sample` rows the sweep's existing subsample + `MiniBatchKMeans` + `predict` path applies unchanged.

Rejected: `MiniBatchKMeans` at every size (it changes the clustering at the sizes users run most, for a saving PCA already gives); clustering on L2-normalised vectors for cosine runs (the curated annotations' embedding reference is Euclidean, and the two must be read on the same scale).

### 4. Scoring: on the embedding, and again in each projection

- **On the embedding.** The labelling's own separation rows are computed on the raw embedding (`space_kind=embedding`), not on the 50 PCs, through the same `AnnotationValidityStatistic` and subsample that score a curated annotation's embedding reference. The panel's "Embedding" column then compares like with like. These are optimistic, exactly as a projection clustering's own scores are, since KMeans drew the boundaries.
- **In each projection of that embedding.** After both passes the driver scores each embedding column on the coordinates of every projection whose source is that embedding (`space_kind=projection`, `label_kind=kmeans_<selection>`). This is what drives the legend strips and the Separation block when the column is selected, and it answers the useful question: how well does this layout keep the groups the embedding has. Unlike a projection clustering, the column has strips in every projection of its embedding, not only the one it was found in.
- **Agreement.** ARI/NMI against each scored annotation is computed once, in the embedding pass (`space_kind=embedding`).
- **Ordering.** The new rows are appended after the existing ones, so a run's existing rows keep their order.

Projection-space clusterings are not compared against the embedding clustering. That comparison is meaningful, but it is a new statistic the app has no place to show.

### 5. Inputs without a vector space

A precomputed similarity matrix (`EmbeddingSet.precomputed`) is skipped by the embedding pass, as it already is for annotation validity, so it gets no embedding cluster column. `projection` clustering still runs for its projections under `both`.

## Risks / Trade-offs

- **One more column per embedding by default.** Users who never asked for it see it in the annotation dropdown. Accepted: it is the column #324 asked for, and `--cluster-space projection` restores the old set.
- **The app's caveat names the wrong space for the new column.** The legend and panel print "K-means found these clusters in this projection, so these scores are optimistic." under any auto-cluster column. For an embedding column the projection scores are not optimistic (KMeans did not draw boundaries there) and the embedding reference is. The numbers are correct; only that sentence is off. Rewording it belongs to the web app (`AUTO_CLUSTER_SCORE_CAVEAT` in `packages/utils`) and is left as a follow-up rather than done here.
- **Synthetic benchmark.** The timing table uses well-separated synthetic groups; real pLM embeddings converge more slowly, so expect somewhat more than 20 s. The cost stays bounded by the same caps (K ≤ 50, ≤ 50,000 fitted rows).
