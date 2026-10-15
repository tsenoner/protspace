Before every commit: `pnpm precommit` (changes staged), `pnpm format:check`, and the stats suites
(`uv run --directory apps/protspace pytest tests/test_stats.py tests/test_stats_cli.py tests/test_stats_carriage.py tests/test_stats_bundle.py`).

## 1. Spec

- [x] 1.1 Proposal, design and the `stats-auto-clustering` spec; `openspec validate cluster-in-embedding-space --strict` passes.

## 2. Statistics

- [x] 2.1 `kmeans_elbow.py`: `pca_reduce` (top 50 PCs, fitted on the id-canonical subsample, applied in chunks; identity at ≤ 50 dims).
- [x] 2.2 `validity.py`: `ClusterValidityStatistic` honours `params["cluster_space"]` (default `both`, unknown values fall back), opts into the embedding pass, clusters an embedding on its PCs with 3 restarts, and scores the labelling on the raw embedding.
- [x] 2.3 `driver.py`: run the embedding pass whenever an opted-in statistic exists, then score each embedding cluster column on every projection of that embedding.
- [x] 2.4 Tests: default emits both columns; `projection` / `embedding` emit one kind; the embedding column is scored in every projection of its embedding and in the embedding; ARI/NMI rows; two embeddings; row-order invariance; PCA path above 50 dims; precomputed input; unknown value falls back; legend settings style the new column.

## 3. CLI

- [x] 3.1 `ClusterSpace` enum and `Opt_ClusterSpace` in `common_options.py`; `--cluster-space` on `stats`; `--cluster-space` on `prepare`, rejected without `--stats`; `PipelineConfig.cluster_space` passed through.
- [x] 3.2 Tests: `stats --cluster-space` wiring (columns in the annotations parquet, settings), `prepare` rejects it without `--stats`, invalid value rejected, and one test pinning the default in the CLI options, the pipeline config and the statistics API.

## 4. Docs

- [x] 4.1 `docs/explore/separation-scores.md`: the cluster columns are of each projection or of the embedding (fixes "of the embedding"), what each kind is scored on, which projections show strips.
- [x] 4.2 `docs/guide/python-cli.md`: `--cluster-space` in the `prepare` option table and the `stats` table, an example, and the auto-clustering paragraph of "Projection statistics".
- [x] 4.3 `apps/protspace/CLAUDE.md` stats usage and test rows; the Preparation notebook's "Going further" note.
