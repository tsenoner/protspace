Two PRs: **A — upstream `protspace` engine** (sections 1–7), then **B — this repo `protspace_web`**
(sections 8–10). TDD; every statistic ships a **known-answer numeric fixture**, not a "rows exist"
check. All sklearn imports under `stats/` are **function-local** (preserve ~50 ms CLI startup).

## 1. Engine — `protspace.stats` scaffolding & contract

- [ ] 1.1 `src/protspace/stats/base.py`: `StatContext` (space_kind, space_name, coords, embedding,
      embedding_name, high_dim_metric, ids, rng_seed, params); `Statistic` Protocol (`family`,
      `requires_embedding`, `compute(ctx) -> list[StatRow]`); `StatRow` (space_kind, space_name,
      stat_family, label_kind, metric, **metric_kind**, value, extra: dict); `StatsReport.to_arrow()`
      → the **8-column** tidy table (`extra` → `extra_json`).
- [ ] 1.2 `stats/__init__.py`: lazy `STATISTICS` registry (mirroring `REDUCERS`) +
      `compute_statistics(embedding_sets, reductions, config)` iterating registered statistics per
      projection, isolating per-statistic failures (catch → omit row). No compute-module imports at
      module load.
- [ ] 1.3 Tests: registry lookup; `to_arrow()` 8-column schema; empty-report round-trip; partial
      report when one statistic raises.

## 2. Engine — cluster_validity (elbow + silhouette/DB/CH)

- [ ] 2.1 `stats/cluster/kmeans_elbow.py`: KMeans sweep `K ∈ [2, min(round(sqrt(n)), 50)]`
      (`random_state=ctx.rng_seed`, `n_init>=10`); record inertia; select `K` via the **argmax index**
      of perpendicular deviation from the inertia curve's first→last chord (implement directly;
      algorithm from `ProtSpaceExtractor._knee_distance_to_chord` but reuse the index, **not** its
      y-value return; do **not** port `_knee_median_jump`). Return labels at `K` + diagnostics
      (inertia curve, `knee_confidence`, silhouette-optimal K) in `extra`. Emit `n_clusters` with
      `metric_kind="meta"`. Cluster rows carry `label_kind="kmeans_elbow"`.
- [ ] 2.2 `stats/metrics/validity.py`: silhouette (fixed-seed sample above threshold; record
      `sampled`/`sample_size`), davies_bouldin, calinski_harabasz on the clusterer's labels;
      `metric_kind="validity"`. Guard `2 ≤ K ≤ n−1`; drop singleton clusters for DB/CH.
- [ ] 2.3 Register `cluster_validity` in `STATISTICS`.
- [ ] 2.4 Known-answer tests: `k`-blob → elbow `K ∈ {k−1,k,k+1}`; silhouette `>0.6` (separated) vs
      `<0.2` (overlapping); n<3 / single cluster → no row; near-linear inertia → `knee_confidence:"low"`.

## 3. Engine — faithfulness (kNN-overlap, trustworthiness/continuity)

- [ ] 3.1 `stats/metrics/faithfulness.py`: kNN-overlap@k (default `k=15`); **trustworthiness =
      `trustworthiness(embedding, coords, metric=ctx.high_dim_metric)`** and **continuity =
      `trustworthiness(coords, embedding, metric=<projection euclidean>)`** (no `continuity` in
      sklearn; args swapped, metric attaches to the embedding-first call). `metric_kind="faithfulness"`,
      `label_kind="none"`, `requires_embedding=True`. Record the metric **per row** in `extra`.
- [ ] 3.2 **Cost guard:** above `sample_threshold` (default 5000) subsample a **shared** id subset
      derived from `(rng_seed, sorted ids)` for all projections of an embedding (record
      `sampled`/`sample_size`); beyond a hard ceiling emit a `skipped:"n_too_large"` row. (Trustworthiness
      densifies an `n×n` matrix — no ANN path.)
- [ ] 3.3 Register in `STATISTICS`.
- [ ] 3.4 Known-answer tests: near-identity projection → faithfulness ≈ 1.0; random projection →
      markedly lower; `k`/metric recorded; large-n path samples (and the very-large path skips).

## 4. Engine — driver: mapping, alignment, determinism

- [ ] 4.1 `stats/driver.py`: per projection, build a `StatContext` — select **its source embedding**
      by `emb_set.name`; set `high_dim_metric` from the reduction's `info_json` (reducer metric;
      cosine fallback); **id-intersection join** embedding↔coords (not positional zip; `load_h5` drops
      NaN rows and `cli/project.py` writes coords against `embedding_sets[0].headers`); record id-set
      mismatches; skip `requires_embedding` statistics when no matching embedding.
- [ ] 4.2 Tests: label/id-permutation yields identical scores; an H5 with an extra and a dropped id
      vs `projections_data` is handled by intersection (not mis-paired); multi-embedding run maps each
      projection to the correct embedding.

## 5. Engine — bundle format (fifth part, ALL readers/writers, no arity break)

- [ ] 5.1 `data/io/bundle.py`: `STATISTICS_FILENAME`; `write_bundle(tables, path, settings=None,
statistics=None)` emitting `core(3) + settings? + statistics?` with a **zero-byte** settings slot
      when statistics is given without settings.
- [ ] 5.2 **Keep `read_bundle`'s 2-tuple** (two `add_annotation_style.py` callers unpack it); add
      `read_statistics_from_bundle(path) -> bytes | None`; `extract_bundle_to_dir` writes
      `STATISTICS_FILENAME` when present; accept 3–5 parts (branch on part-4 emptiness). Update the
      "Expected 3 or 4 parts" message.
- [ ] 5.3 **Rewrite `replace_settings_in_bundle`** by part-count case (`len==3/4/5`) to preserve a
      trailing statistics part (zero-byte settings slot when inserting settings ahead of stats); verify
      `utils/add_annotation_style.py` / `protspace style`.
- [ ] 5.4 Round-trip tests: 3-, 4-, 5- (settings+stats), 5-empty-settings (stats-only) read back
      correctly; **`protspace style` preserves stats on BOTH settings+stats and stats-only inputs**;
      legacy bundles unchanged.

## 6. Engine — pipeline & CLI wiring

- [ ] 6.1 `data/processors/base_processor.py`: `create_output` accepts an optional statistics table;
      `save_output` passes it to `write_bundle`.
- [ ] 6.2 `data/processors/pipeline.py`: `stats` flag on `PipelineConfig`; in `ReductionPipeline.run`,
      call `compute_statistics(embedding_sets, all_reductions, ...)` before `create_output` when
      enabled; thread the table through.
- [ ] 6.3 `cli/prepare.py`: add `--stats/--no-stats` (default on, same on/off convention as the
      existing `--scores`); log it.
- [ ] 6.4 `cli/stats.py`: `protspace stats -i emb.h5 [-i ...] -p project_dir -o statistics.parquet`
      (no `-a`). Build a **projections-parquet loader** (`projections_data.parquet` →
      `{projection_name: (coords ndarray, ids)}`) and id-join each projection to its source embedding.
      **Add `stats` to `cli/app.py:_register_commands()`** (hardcoded list).
- [ ] 6.5 `cli/bundle.py`: optional `-s/--statistics`; pass to `write_bundle`. (Hatchling src-layout
      auto-includes `src/protspace/stats/`; no `[tool.hatch]` change needed.)

## 7. Engine — verification (PR A)

- [ ] 7.1 `uv run pytest tests/ -m "not slow"` green; `uv run ruff check src/ tests/` clean; confirm
      CLI startup not regressed (lazy imports).
- [ ] 7.2 End-to-end on a **real, committed fixture** (`data/sizes/phosphatase.h5` does **not** exist;
      use an existing test H5 or add a small generated fixture): `prepare ... --stats` → 5-part bundle
      with cluster_validity + faithfulness rows per projection; `protspace stats` standalone matches;
      `--no-stats` → 3-part bundle; `protspace style` on the 5-part bundle keeps stats.
- [ ] 7.3 CHANGELOG/version bump (semantic-release); record the released version for the web floor;
      open the draft PR.

## 8. This repo — prep service stats step (bundle-first, non-fatal, probed)

- [ ] 8.1 `services/protspace-prep/.../config.py`: add `PREP_STATS` (default on) and
      `PREP_STATS_TIMEOUT_SECONDS` (default 120); raise the `protspace` floor (pyproject + lock) to the
      release from task 7.3.
- [ ] 8.2 `services/protspace-prep/.../pipeline.py`: **produce the core bundle first** (within the
      parent `pipeline_timeout_seconds`), then run `protspace stats -i <resolved h5_files[0]> -p
<project_dir> -o statistics.parquet` under a **nested** `asyncio.timeout(PREP_STATS_TIMEOUT_
SECONDS)`, catching failure/timeout **locally** so it never reaches the outer handler; on success
      re-run `bundle` with `-s`. A one-time `protspace stats --help` probe → skip if absent. Emit an
      SSE `computing_statistics` stage.
- [ ] 8.3 Tests (`tests/test_pipeline.py`): stats invoked with the resolved H5 + project dir and folded
      via `-s`; **a stats failure/timeout still yields the core bundle and a successful job** (and does
      not consume the parent budget such that bundle is lost); missing-subcommand probe skips; SSE event
      emitted.

## 9. This repo — frontend reader tolerance

- [ ] 9.1 `packages/core/.../data-loader/utils/bundle.ts`: accept **4 delimiters** (5 parts); branch on
      **part-4 byte length** (empty ⇒ settings absent, part 5 = stats; non-empty ⇒ part 4 = settings,
      part 5 = stats); guard `extractSettings` to return null on a zero-byte buffer **before**
      `assertValidParquetMagic`; skip part 5. Keep 2/3-delimiter behaviour identical.
- [ ] 9.2 **Invert** `bundle.test.ts`'s "should reject bundle with 4 delimiters (5 parts)" test; update
      the layout comment in `packages/utils/src/parquet/bundle-writer.ts`; add a `FastaPrepStage` union
      entry `'computing_statistics'` (and any exhaustive consumer); note `createParquetBundle` re-export
      drops the stats part (documented limitation).
- [ ] 9.3 Tests: 5-part (settings+stats) AND 5-part (empty-settings, stats-only) load projections +
      annotations + settings with no error and ignore statistics; 3/4-part bundles unchanged.

## 10. This repo — verification (PR B)

- [ ] 10.1 `pnpm precommit` green; prep-service `uv run pytest -q` green.
- [ ] 10.2 Load a real engine-produced 5-part bundle (both settings+stats and stats-only) in the app —
      renders normally, no console errors, statistics ignored.
- [ ] 10.3 Open the draft PR; reference issue #219 and the upstream engine PR.
