## Why

ProtSpace renders dimensionality-reduction projections but gives users **no quantitative way to
judge them**: _Is this projection meaningful? How many clusters are there? Can I trust the geometry,
or did the reduction distort it?_ Issue #216 catalogued the statistics ProtSpace needs to be
competitive; this change (issue #219) implements the MVP.

Today the preparation pipeline (`embed → project → annotate → bundle`) ships coordinates and
annotations with **zero quality metrics**, so interpretation is purely visual. This change adds a
**projection-statistics** capability computed at prep time and baked into the `.parquetbundle`,
covering two complementary questions per projection:

- **Cluster structure** — KMeans with an **elbow** estimate of the optimal cluster count, scored by
  **silhouette**, **Davies–Bouldin**, and **Calinski–Harabasz** (issue #219's metric set).
- **Projection faithfulness** — **kNN-overlap** and **trustworthiness / continuity** between the
  original embedding and the projection, i.e. how much the reduction preserved or distorted the
  neighbourhood structure. These are the metrics that most directly tell a user whether to trust the
  map (#216's "competitive" framing).

It is built as an **expandable subsystem** so further statistics can be added without rework. The
honest boundary of that claim (see `design.md`): the registry + tidy long-format table make new
**scalar** statistics, label sources, and spaces cheap to add (new rows, no schema change); the
richer pairwise/neighborhood analyses prototyped in the standalone `ProtSpaceExtractor` script
(query↔reference proximity, cross-method consensus, Top-N mining) are pair/edge/set-shaped and will
ride **their own future typed bundle parts**, reusing the same registry pattern but not this table.

## What Changes

Two PRs: the engine (`protspace`) first, then this repo (`protspace_web`) consumes it.

- **Engine — `protspace` package (separate PR):** a new `protspace.stats` module with a generalized
  `Statistic` contract (each statistic declares the inputs it needs — projection coords, embeddings,
  and/or labels — and returns one or more result rows) and a light registry. MVP statistics, all
  **per projection**:
  - `cluster_validity`: KMeans sweep + elbow (knee on the inertia curve) selecting `K`; then
    silhouette, Davies–Bouldin, Calinski–Harabasz on the projection coordinates at that `K`.
  - `faithfulness`: kNN-overlap and trustworthiness / continuity between the embedding and the
    projection.
    Wired into `ReductionPipeline.run` — the one stage holding embeddings **and** projections —
    behind a `--stats/--no-stats` flag, and exposed as `protspace stats -i emb.h5 -p project_dir
-o statistics.parquet` (no annotations needed for the MVP).
- **Bundle format:** an optional **fifth part** `statistics.parquet`. Layout
  `core(3) + settings? + statistics?`; when statistics is present without settings, a **zero-byte
  settings slot** keeps the fifth position unambiguous. **All** bundle readers/writers are updated:
  `write_bundle`, `read_bundle`, `extract_bundle_to_dir`, **and `replace_settings_in_bundle`** (the
  `protspace style` path, which today would silently drop a fifth part).
- **Prep service (`services/protspace-prep`):** the core bundle is **produced first**; a `stats` step
  then runs `protspace stats` best-effort under its **own nested timeout**, caught locally so it can
  never reach the parent handler, re-bundling with `-s` on success. On stats failure or timeout the
  already-shipped stats-less bundle stands (the job never fails for a secondary artifact). The
  `protspace` dependency floor is raised to the stats-bearing release and the step feature-probes the
  subcommand before use.
- **Frontend reader (`@protspace/utils` + core data-loader):** accept a five-part bundle **without
  error** (the existing test asserting five-part bundles are _rejected_ is inverted). The statistics
  part is parsed-but-unused; rendering is a committed follow-up, out of scope here.

**Scope (MVP):** per-projection `cluster_validity` (unsupervised/elbow) + `faithfulness`, baked at
prep time, carried in the bundle, not yet rendered.

**Non-goals (explicit, non-breaking expansions):** embedding-space cluster-validity; annotation-
feature label sources; interactive / on-demand recompute; the broader `ProtSpaceExtractor` analyses
(future typed bundle parts); frontend rendering of the statistics. The registries and long-format
table leave seams for the scalar expansions; the others are acknowledged as new parts/work.

## Capabilities

### New Capabilities

- `projection-statistics`: per-projection cluster-validity and faithfulness statistics computed at
  preparation time and carried in the `.parquetbundle` as an optional statistics part. Covers the
  bundle-boundary data contract (a stable tidy long-format table), production by the prep pipeline,
  the backward-compatible fifth-part layout (including the `protspace style` round-trip),
  reproducibility and robustness guards, and reader tolerance.

## Impact

- **Upstream (`protspace` repo, separate PR):**
  - New `src/protspace/stats/` package (generalized `Statistic` contract + registry, cluster-validity
    statistics, faithfulness statistics, driver).
  - `data/io/bundle.py`: `write_bundle` / `read_bundle` / `extract_bundle_to_dir` extended to a fifth
    statistics part (`STATISTICS_FILENAME`), **and `replace_settings_in_bundle` updated to preserve a
    trailing statistics part** so `protspace style` is non-lossy.
  - `utils/add_annotation_style.py` (the `style` command) verified/tested against five-part bundles.
  - `data/processors/base_processor.py` (`create_output`/`save_output`) and `pipeline.py`
    (`ReductionPipeline.run`) thread an optional statistics table; embeddings (already in memory) feed
    faithfulness.
  - `cli/prepare.py` gains `--stats/--no-stats`; new `cli/stats.py`; `cli/bundle.py` gains
    `-s/--statistics`.
  - Tests with **known-answer numeric fixtures** (blob separation; faithfulness on identity vs random
    projections) and a label-permutation alignment test.
  - No new dependency: scikit-learn (KMeans, silhouette/DB/CH, `manifold.trustworthiness`) is already a
    core dep; the elbow knee is ported from `ProtSpaceExtractor` (distance-to-chord, **argmax index →
    K**).
- **This repo (`protspace_web`):**
  - `services/protspace-prep/src/protspace_prep/pipeline.py` (+ `config.py`): the `stats` step with its
    own timeout, failure isolation, version probe, and an SSE `computing_statistics` stage;
    `services/protspace-prep/tests/`.
  - `packages/core/src/components/data-loader/utils/bundle.ts` (+ `packages/utils/src/parquet/*`):
    accept the optional fifth part; **invert** `bundle.test.ts`'s five-part-rejection test; document
    that frontend re-export (`createParquetBundle`) currently drops the part.
- **Data-format change:** additive, backward compatible. Existing three- and four-part bundles read
  and write unchanged.
- **API / dependencies:** no HTTP API change; no new dependencies.
