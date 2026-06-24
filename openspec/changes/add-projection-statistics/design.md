## Context

ProtSpace prepares data with the `protspace` Python package (`embed → project → annotate → bundle`)
and renders the resulting `.parquetbundle` in the `protspace_web` frontend. The bundle is Apache
Parquet tables concatenated with a `---PARQUET_DELIMITER---` separator:

1. `selected_annotations` (in-memory Arrow key `protein_annotations`) — identifier + annotations
2. `projections_metadata` — `projection_name` (e.g. `UMAP_2`), `dimensions`, `info_json` (reducer
   params incl. the distance `metric`)
3. `projections_data` — long table of `(projection_name, identifier, x, y, z)`
4. `settings` (optional) — annotation styles / display config

The bundle **does not retain the high-dimensional embeddings** — only reduced coordinates. Bundle
I/O lives in `data/io/bundle.py`: `write_bundle(tables, path, settings=None)`,
`read_bundle → (parts[:3], settings)` (a **2-tuple**, unpacked as `_, settings = read_bundle(...)`
at two sites in `utils/add_annotation_style.py`), `extract_bundle_to_dir`, and
`replace_settings_in_bundle` (used by `protspace style`, rebuilds `parts[:3] + settings`). All hard-
fail outside 3–4 parts. The frontend reader
(`packages/core/src/components/data-loader/utils/bundle.ts`) throws unless 2 or 3 delimiters and
keys off **delimiter count** (not part contents); `cli/app.py:_register_commands()` registers
commands from a **hardcoded list** (no auto-discovery).

Issue #219 (from #216) asks for statistics to interpret a projection. Owner's metric list: elbow
(optimal cluster count), silhouette, Davies–Bouldin, Calinski–Harabasz. A prototype,
`ProtSpaceExtractor` (`~/Downloads/ProtSpaceExtractor_v1.7.4_mod 1.py`), performs proximity/
neighborhood mining; its distance-to-chord knee algorithm is reused (re-implemented, not imported).

### Decisions taken during brainstorming + two adversarial review rounds

- **Deliverable:** the MVP metric set now, expandable architecture.
- **Compute home:** the `protspace` core package (shared by CLI + web bundle).
- **Timing:** baked at prep time; interactivity deferred.
- **Scope (trimmed):** **per-projection only** — `cluster_validity` (unsupervised KMeans+elbow) +
  `faithfulness` (kNN-overlap, trustworthiness/continuity vs the embedding). Embedding-space
  cluster-validity and annotation-feature label sources are deferred (non-breaking expansions).
- **Metric set:** owner's four **plus** projection-faithfulness (#216's "competitive" framing).
- **Carriage:** a dedicated fifth parquet part.
- **Sequencing:** infra-only — baked, **not rendered** (committed follow-up).
- **Spec home:** this OpenSpec change; engine internals built in the `protspace` PR.

## Goals / Non-Goals

**Goals**

- Per projection: cluster-validity (elbow K + silhouette/DB/CH on the coords) and faithfulness
  (kNN-overlap, trustworthiness/continuity of the projection vs its source embedding), baked in.
- A registry where a new **scalar** statistic, label source, or space is a small unit plus a
  registry entry — no driver rewrite, no bundle schema migration.
- Backward-compatible carriage across **all** readers/writers, including `protspace style`.
- Statistics are **secondary**: computing them never fails a prep job and never costs the bundle.
- Trustworthy, reproducible numbers (seeded; bounded cost; degenerate cases guarded; provenance
  recorded).

**Non-Goals**

- Embedding-space cluster-validity; annotation-feature label sources; interactive recompute; the
  full `ProtSpaceExtractor` workflow; frontend rendering; other metric sets. Seams left for the
  scalar expansions; the rest are explicit future work.

## Decisions

### D1. New `protspace.stats` package, generalized `Statistic` contract, lazy registry

A scalar `(X, labels) -> float` metric is too narrow — the elbow emits a vector + chosen `K`,
faithfulness needs **two** point sets and **no** labels, and statistics take parameters. So:

```python
# stats/base.py
@dataclass
class StatContext:
    space_kind: str            # "projection" (MVP); "embedding" later
    space_name: str            # == projections_metadata.projection_name (joinable)
    coords: np.ndarray         # (n, d) projection coordinates
    embedding: np.ndarray | None       # (n, D) source embedding, id-joined to coords
    embedding_name: str | None         # which embedding set produced this projection
    high_dim_metric: str               # reducer's own metric (from info_json); cosine fallback
    ids: list[str]
    rng_seed: int
    params: dict               # k, kmax, sample_size, sample_threshold, ...

class Statistic(Protocol):
    family: str                # "cluster_validity" | "faithfulness"
    requires_embedding: bool
    def compute(self, ctx: StatContext) -> list[StatRow]: ...
```

`stats/__init__.py` holds a lazy `STATISTICS` registry (mirroring `REDUCERS`) and
`compute_statistics(...)`. **All sklearn imports inside `stats/` are function-local** to preserve the
package's ~50 ms CLI startup (the registry and `cli/stats.py` registration must not import compute
modules at module load).

**Honest scope of the registry:** it is the seam for **scalar** statistics, label sources, and
spaces (new rows, no schema change). The `ProtSpaceExtractor`'s pair/edge/set/graph outputs do
**not** fit this row model and are **not** claimed to; they get their own future typed bundle parts.

`cluster_validity` is split internally into a `Clusterer` (KMeans+elbow → labels + diagnostics) and
the sklearn validity scorers that consume those labels, so a future `annotation_feature` grouping or
`hdbscan` clusterer slots in without touching the scorers.

### D2. Output is one tidy long-format table with split, joinable keys

`statistics.parquet` — **eight** columns, one statistic value per row:

| column        | type   | example                                                                                                           |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `space_kind`  | string | `projection`                                                                                                      |
| `space_name`  | string | `UMAP_2` (== `projections_metadata.projection_name`)                                                              |
| `stat_family` | string | `cluster_validity`, `faithfulness`                                                                                |
| `label_kind`  | string | `kmeans_elbow`, `none`                                                                                            |
| `metric`      | string | `silhouette`, `davies_bouldin`, `calinski_harabasz`, `n_clusters`, `knn_overlap`, `trustworthiness`, `continuity` |
| `metric_kind` | string | `validity`, `meta`, `faithfulness`                                                                                |
| `value`       | double | `0.42`                                                                                                            |
| `extra_json`  | string | `{"k":15,"metric":"cosine","seed":42,"sampled":false,"knee_confidence":"high","embedding":"prot_t5"}`             |

`metric_kind` is a **column** (not buried in JSON) so consumers can aggregate validity scores without
folding in `n_clusters` (`metric_kind="meta"`). New scalar statistics add **rows**; a future
annotation label source carries its column name **inside `extra_json`** (`{"label_name":"family"}`),
not as a new column — the eight columns stay frozen. `space_name` equals
`projections_metadata.projection_name` so the table is joinable without string-parsing. Cluster rows
carry `label_kind="kmeans_elbow"`; faithfulness rows carry `label_kind="none"`.

### D3. Scope = projections only; both statistic families per projection

For each **projection** space:

- **cluster_validity** — `coords` only: KMeans sweep → elbow `K` → silhouette/DB/CH at `K`.
- **faithfulness** — `coords` + its **source** `embedding`: neighbourhood preservation.

`ReductionPipeline.run` holds `embedding_sets` (high-dim) and `all_reductions` (coords, each knowing
its `emb_set.name`) together before `save_output`; the driver runs there. **Annotations are not
needed**, removing the `identifier`/`protein_id`/`sp|…` join hazards. Deferred expansions stay
non-breaking: `space_kind:"embedding"` and `label_kind:"annotation"` are new **rows**.

### D4. Elbow — distance-to-chord knee, argmax **index** → K, confidence-guarded

Sweep `K ∈ [2, K_max]` (`K_max = min(round(sqrt(n)), 50)`), record inertia, compute the perpendicular
deviation of each point from the first→last chord of the (normalised) inertia curve, take
`k_idx = argmax(deviation)`, select `K = k_range[k_idx]`. **Implement the deviation directly** — the
algorithm originates in `ProtSpaceExtractor._knee_distance_to_chord`, but that function returns the
curve _y-value_ (a distance cutoff), so we reuse only the argmax-index logic, not its return. The
prototype's `_knee_median_jump` ensemble half is intentionally **not** used (tuned for sorted-
distance distributions, not inertia). KMeans runs on **2-D/3-D coords** where the knee is reliable.
Guards: if normalised max deviation is small (≈ linear), record `knee_confidence:"low"`; also report
the silhouette-optimal K over the sweep so consumers can cross-check. KMeans uses
`random_state=rng_seed`, `n_init ≥ 10`. Emit `n_clusters` with `metric_kind="meta"`.

### D5. Faithfulness — neighbourhood preservation, embedding vs projection (corrected)

- **kNN-overlap@k**: mean neighbour-set overlap (embedding vs projection) per point; default
  `k = 15` (recorded). Built with a neighbour query, `O(n·k)` after the index.
- **trustworthiness** and **continuity**: `sklearn.manifold.trustworthiness` computes
  trustworthiness; **continuity is the same function with arguments swapped** (there is no
  `continuity` in sklearn). `trustworthiness(A, B, metric=m)` applies `m` to `A`. So the high-dim
  metric must attach to whichever call has the **embedding** as the first arg:
  - trustworthiness = `trustworthiness(embedding, coords, metric=high_dim_metric)`
  - continuity = `trustworthiness(coords, embedding, metric=projection_metric)` (Euclidean)
    The metric is recorded **per row** (trustworthiness and continuity may differ).

**High-dim metric default = the reducer's own metric**, read from
`projections_metadata.info_json` / `ReducerParams.metric` (Euclidean by default; PCA/MDS are
Euclidean), falling back to cosine only when unknown — so faithfulness scores the same neighbourhood
graph the reducer optimised, and cross-method comparison stays valid. Recorded in `extra_json`.

**Cost guard (critical).** `sklearn.manifold.trustworthiness` densifies a full `n×n` distance matrix
over the high-dim vectors — there is **no** ANN path. Above a threshold (default 5000, shared with
silhouette), trustworthiness/continuity/kNN-overlap run on a **fixed-seed subsample** derived from
`(rng_seed, sorted ids)` so **all projections of the same embedding use the identical subset**
(apples-to-apples); record `sampled`/`sample_size`. Beyond a hard ceiling, skip with a recorded
`skipped:"n_too_large"` row. This applies on the uncapped CLI `prepare --stats` path, not just the
1500-capped web path.

**Projection→embedding mapping.** Multi-embedding runs put projections from several embeddings into
one `projections_data.parquet`, named per embedding (`ProtT5 — UMAP 2`). Each projection's
faithfulness must use **its own** source embedding. In-process this comes from the reduction's
`emb_set.name`; the discrete path records the source embedding in provenance and the standalone
`stats` command accepts multiple `-i` and matches by embedding name, **skipping** projections whose
embedding isn't supplied (recorded). Embedding rows are aligned to coords by an **id intersection
join** (not a positional zip — `load_h5` drops NaN rows and `cli/project.py` writes all coords
against `embedding_sets[0].headers`), asserting/ recording any id-set mismatch.

### D6. Bundle carriage — dedicated fifth part, ALL readers/writers, no arity breaks

Layout `core(3) + settings? + statistics?`. "Empty settings slot" = **zero bytes** (matches the
existing `if len(parts)==4 and parts[3]` truthiness check). Readers/writers branch on the **fourth
part's emptiness**, not raw count.

- `data/io/bundle.py`: `write_bundle(tables, path, settings=None, statistics=None)`. **Keep
  `read_bundle`'s 2-tuple signature** (two `add_annotation_style.py` callers unpack it) and add a
  separate `read_statistics_from_bundle(path) -> bytes | None`; `extract_bundle_to_dir` writes
  `STATISTICS_FILENAME` when present. Accept 3–5 parts.
- **`replace_settings_in_bundle`** (the `protspace style` path) — rewrite with explicit part-count
  cases so it never drops stats: `len==3 → core+settings`; `len==4 → settings at [3], no stats,
replace [3]`; `len==5 → stats at [4], emit core + new_settings + parts[4]`, using a zero-byte
  settings slot when inserting settings ahead of stats. Verify `protspace style` round-trips both a
  settings+stats and a stats-only (empty-settings) 5-part bundle.
- `base_processor.save_output` / `create_output`: thread an optional statistics table.
- `cli/bundle.py`: optional `-s/--statistics`.
- Frontend `bundle.ts`: accept **4 delimiters** (5 parts); **branch on part-4 byte length** — empty
  ⇒ settings absent, part 5 = stats; non-empty ⇒ part 4 = settings, part 5 = stats. Guard
  `extractSettings` to return `null` on a zero-byte buffer **before** `assertValidParquetMagic`.
  Skip part 5. **Invert** `bundle.test.ts`'s "should reject bundle with 4 delimiters (5 parts)"
  test; widen the `"Expected 2 or 3 delimiters"` guard; update the layout comment in
  `packages/utils/src/parquet/bundle-writer.ts`. The frontend _writer_ (`createParquetBundle`) is
  unchanged and drops stats on re-export — a documented MVP limitation.

**Why a dedicated part, not `settings` JSON:** statistics are results, not display state; `settings`
is rewritten by `style`/publish and would stale or drop them.

### D7. Wiring

- **`prepare` path (engine, CLI users):** `ReductionPipeline.run` calls `compute_statistics(
embedding_sets, all_reductions, config)` when enabled; the table is threaded through
  `create_output`/`save_output` into `write_bundle` in one pass. `cli/prepare.py` adds
  `--stats/--no-stats` (default on); the faithfulness cost guard (D5) bounds the work.
- **Discrete path (engine):** `protspace stats -i emb.h5 [-i emb2.h5 ...] -p project_dir
-o statistics.parquet` — loads the H5 embeddings + a **new projections-parquet loader** that turns
  `projections_data.parquet` into `{projection_name: (coords ndarray, ids)}`, id-joins each
  projection to its source embedding (by name + id intersection), runs the driver. **No `-a`.**
  Register `stats` in `cli/app.py:_register_commands()` (hardcoded list — explicit edit).
- **Prep service (web):** to make stats truly non-fatal against the single shared
  `pipeline_timeout_seconds`, **produce the core bundle first** (within the parent budget), then run
  `protspace stats` as a best-effort step under its **own** `asyncio.timeout(PREP_STATS_TIMEOUT_
SECONDS)`, catching every failure/timeout **locally** (never reaching the parent handler) and, on
  success, re-running `bundle` with `-s` to fold in the fifth part. A stats failure/timeout leaves
  the already-shipped stats-less bundle. Gated by `PREP_STATS` (default on) **and** a one-time
  `protspace stats --help` feature probe (stale install ⇒ skip). Emits an SSE `computing_statistics`
  stage and adds it to the frontend `FastaPrepStage` union. The `protspace` floor is raised to the
  release that introduces `protspace stats` (filled in once the engine PR cuts the version).

### D8. Robustness, determinism, guards

- **Failure isolation:** the driver catches per-statistic exceptions and omits that row; total
  failure returns an empty report and never raises.
- **Determinism:** one `rng_seed` (default 42) threads into KMeans (`random_state`, `n_init ≥ 10`)
  and all subsampling; recorded per row. Faithfulness subsamples a shared id subset across a
  projection group (D5). Projection-space stats are only as reproducible as the (already-seeded)
  reducer.
- **Cost:** silhouette and trustworthiness/continuity are `O(n²)`; both honour the sampling
  threshold/ceiling (D5). The 1500 web cap keeps the web path cheap; the CLI path relies on the
  guard.
- **Degenerate guards:** silhouette needs `2 ≤ K ≤ n−1`; DB/CH require ≥ 2 members per cluster (else
  omit); `n < 3` → no rows.

## Risks / Trade-offs

- **Faithfulness cost.** The densified `n×n` is the dominant risk; mitigated by the sampling
  threshold + hard ceiling + skip row, the web cap, and the prep step's own timeout. `--stats`
  default-on is safe only because of the guard.
- **Cross-repo coordination.** Engine releases before web consumes it; the frontend reader is
  backward compatible and independent, and the prep step is version-floored + feature-probed.
- **Bundle positional fragility.** The zero-byte-settings convention is encoded in `write_bundle`,
  enforced across all writers (incl. `replace_settings_in_bundle` by part-count case), with both
  readers branching on part-4 emptiness; covered by round-trip tests in both repos.
- **No user-visible value yet.** Infra-only; rendering is a committed follow-up; re-export drops the
  part until then (documented).
- **Faithfulness metric choices.** `k` and the high-dim metric drive the numbers; both are recorded,
  and the metric defaults to the reducer's own for validity of cross-method comparison.

## Open Questions

- Default `k` (15), `K_max` (`min(round(sqrt(n)), 50)`), sampling threshold (5000) and hard ceiling —
  confirm against representative datasets.
- Engine release version for the `protspace` floor — filled once the engine PR's semantic-release
  version is cut.
- Whether to expose parsed statistics on the frontend `BundleExtractionResult` now (forward-compat)
  or skip part 5 entirely — default skip-but-tolerate.
