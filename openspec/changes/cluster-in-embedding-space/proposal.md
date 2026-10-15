## Why

Issue #324 asks for auto-clustering and its quality scores to be computed "on the original high-dimensional embeddings, not on UMAP/t-SNE projections which distort distances". What shipped clusters each projection's own coordinates instead: `protspace stats` and `prepare --stats` run the KMeans elbow sweep on a projection's 2-D coordinates and write one `cluster_elbow_<projection>` column per projection. Two consequences reached a user directly:

- **Cluster numbers do not compare across projections.** `cluster 2` in the UMAP has nothing to do with `cluster 2` in the t-SNE, so "proteins that share a cluster in both" cannot be read off the bundle. A user asking which unknowns group with which references gets a different answer per layout.
- **The clusters inherit each projection's distortions.** t-SNE and UMAP tear and merge neighbourhoods, and the clusters drawn on them describe the layout, not the proteins. Our own faithfulness metrics say a user should not rely on proximity in a projection.

The docs make it worse: `docs/explore/separation-scores.md` says the cluster columns are "an automatic K-means grouping of the embedding", which they are not.

## What Changes

- **New option `--cluster-space projection|embedding|both`** on `protspace stats` and `protspace prepare --stats`, default `both`.
  - `projection` is today's behaviour: one clustering per projection, on its coordinates.
  - `embedding` clusters once per embedding, in the embedding space, and writes a single `cluster_elbow_<embedding>` column (and `cluster_silhouette_<embedding>` under `--cluster-selection silhouette|both`) that every projection of that embedding shares, so a protein's cluster id is the same in the UMAP and in the t-SNE.
  - `both`, the default, writes both kinds. A re-run of an existing command keeps every column it wrote before and gains one per embedding, so no existing column changes name or meaning.
  - `prepare` rejects a non-default `--cluster-space` without `--stats`, as it already does for `--cluster-selection`.
- **Embedding-space clustering runs on the top 50 principal components** (PCA fitted on the same id-canonical subsample the sweep uses) with 3 KMeans restarts per K, which bounds a 5,000 × 1,280 sweep to about 20 s. The K-selection rules (elbow, silhouette) are unchanged.
- **Scores stay correct and need no frontend change.** An embedding clustering is scored like any annotation: its separation (silhouette, Davies–Bouldin, Calinski–Harabasz, aggregate and per category) on the embedding itself, which becomes the panel's "Embedding" reference, and again on each projection of that embedding, which drives the legend strips and the Separation block there. Its ARI/NMI agreement with every scored annotation fills the Recovers block. Rows keep the existing tidy schema and the existing `label_kind` values; the column name follows the existing `cluster_<selection>_<space name>` rule, so the web app's lookups find it as they are.
- **Styling.** The new column gets the same auto-generated Kelly-palette legend styles as a projection clustering.
- **Docs.** `docs/explore/separation-scores.md` describes both kinds of cluster column correctly; the `stats` section and the `prepare` option table of `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md` and the Preparation notebook's "Going further" note gain the option.

## Non-goals

- Removing projection-space clustering, or changing the default K-selection.
- Other clustering algorithms (HDBSCAN, GMM) or K-selection methods (gap statistic, BIC) from #324; #318 tracks more K-selection methods.
- Any web-app change. The one wording issue this leaves is noted in design.md.
- Any 3-D option. 3-D dimensionality reduction is not promoted, and every new example and test uses 2-D projections.

## Capabilities

### New Capabilities

- `stats-auto-clustering`: where `stats` / `prepare --stats` cluster (projection, embedding, or both), how each cluster column is named and shared, and how an embedding clustering is scored and styled.

### Modified Capabilities

None.

## Impact

- `apps/protspace/src/protspace/stats/metrics/validity.py`, `stats/cluster/kmeans_elbow.py`, `stats/driver.py`, `stats/base.py`.
- `apps/protspace/src/protspace/cli/stats.py`, `cli/prepare.py`, `cli/common_options.py` (the option), `data/processors/pipeline.py` (one config field, passed through).
- Tests: `apps/protspace/tests/test_stats.py`, `tests/test_stats_cli.py`.
- Docs: `docs/explore/separation-scores.md`, `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`, `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`.
- Bundles: one more categorical annotation column per embedding (two under `--cluster-selection both`) and its statistics rows when `--stats` runs with the default. No format change.
