## Why

The `add-projection-statistics` change (issue #219, engine PR tsenoner/protspace#61 + web #295)
computes the right numbers but delivers **all** of them into a single opaque fifth part
(`statistics.parquet`) that the frontend parses-but-ignores — so nothing is visible to a user, and
"render the statistics" was left as an open follow-up.

In his review of PR #61, the maintainer (tsenoner) asked us to **place each statistic where the
frontend already knows how to consume that shape of data**, rather than in one catch-all part:

> - Cluster Elbow Kx → save as an annotation
> - Cluster Silhouette Kx → save as annotation (x variable)
> - kNN-overlap + trustworthiness + continuity → metadata per dimensionality-reduction method
> - silhouette, Davies–Bouldin, Calinski–Harabasz → separate parquet file (as currently)

The insight: the statistics differ in **granularity and consumer**. Per-protein quantities (which
cluster a point lands in; how well it fits that cluster) are _annotations_ — the color-by machinery
already renders them. Per-method scalars (how faithful a projection is) are _reducer metadata_ —
they belong with the projection's other info. Only the per-method **aggregate** validity scalars
need a dedicated part. Routing this way makes most of the statistics render through existing UI
surfaces with little or no new frontend code — turning the deferred "frontend rendering" follow-up
into mostly-free reuse.

This change does **not** alter which statistics are computed (that shipped in
`add-projection-statistics`); it changes **where they are carried in the bundle and how they reach
the screen**.

## What Changes

The work spans the engine (`protspace`) and this repo (`protspace_web`), engine first.

- **Engine — `cluster_validity` gains per-point outputs.** The KMeans labels at the elbow `K` are
  already computed and currently discarded; surface them as a **per-protein cluster-membership**
  output. Add **per-sample silhouette** (`sklearn.metrics.silhouette_samples`) at that `K` as a
  second per-protein output. Both are produced **per projection** (each reduction has its own elbow
  `K`).
- **Engine — routing at carriage time.** A statistic now declares a **destination** for each output:
  `annotation` (per-protein, joined on identifier), `projection_metadata` (per-method scalar), or
  `statistics_part` (the long-format table). The bundle writer fans each output to the matching part:
  - cluster membership + per-point silhouette → **`protein_annotations`** columns (one pair per
    projection), with an auto-generated categorical color **style** for the membership column so it
    is colorable on load;
  - faithfulness (kNN-overlap, trustworthiness, continuity) → **`projections_metadata`**, folded into
    each projection's `info_json` under a `quality` key;
  - aggregate cluster-validity (silhouette mean, Davies–Bouldin, Calinski–Harabasz, `n_clusters`) →
    **`statistics.parquet`** (the existing fifth part, now carrying only these).
- **Fan-out happens at bundle-assembly time, not in `protspace stats`.** The standalone `stats`
  command today reads only projections and writes a single `statistics.parquet` (its docstring: "No
  annotations are needed") — it has **no annotations handle**, so it stays a pure aggregate-only
  producer. Routing is done where annotations + metadata + coordinates are already in hand: the
  `prepare`/pipeline path writes the routed outputs inline, and the prep service's re-bundle step
  merges them. (Review finding — see `design.md` D-route.)
- **Prep service (`services/protspace-prep`):** the same **core-bundle-first** shape, but the
  best-effort enrichment step now rewrites parts **1/2/4/5** (annotations, metadata, settings,
  statistics), not just appends part 5 — so it re-bundles the full set to a temp file and atomically
  swaps it in on success. This is a **larger correctness surface** than the prior append-only step
  (it touches user-visible color-by data), so it is not "free": it needs an explicit test that a
  successful enrichment equals the core bundle plus exactly the computed columns (no row drops /
  reordering / retyping). A stats failure still leaves the already-shipped, un-enriched core bundle
  in place.
- **Frontend (`@protspace/core` + `@protspace/utils`):** the routed statistics surface through
  existing consumers — cluster-membership and per-point-silhouette appear in the **color-by**
  control automatically (membership pre-styled); faithfulness is shown in the projection's
  **method/info** surface. The aggregate `statistics.parquet` part may render as a small per-
  projection quality table (the only genuinely new UI; may itself be a thin follow-up).

## Capabilities

### Modified Capabilities

- `projection-statistics`: change the **carriage and delivery** of the already-computed statistics
  from "one opaque fifth part, parsed-but-unused" to "routed to consumer-aligned bundle parts and
  surfaced through existing frontend controls". The fifth-part contract narrows to aggregate
  validity only; per-protein and per-method outputs move to the annotations and projection-metadata
  parts; the prep robustness/decoupling guarantees are preserved under the new re-enrichment shape.

## Impact

- **Upstream (`protspace` repo, separate PR):**
  - `stats/base.py`: each `StatRow`/output declares a **destination** (`annotation` |
    `projection_metadata` | `statistics_part`); `StatsReport` can partition outputs by destination.
  - `stats/metrics/validity.py`: emit per-protein **cluster membership** (the existing labels) and
    **per-sample silhouette** (`silhouette_samples`) as `annotation`-destined outputs keyed by
    identifier; keep the aggregate silhouette/DB/CH + `n_clusters` as `statistics_part` outputs.
  - `stats/metrics/faithfulness.py`: mark its scalars `projection_metadata`-destined.
  - `data/io/bundle.py` + `data/processors/base_processor.py`: a **router** that merges
    annotation-destined outputs into `protein_annotations`, faithfulness into
    `projections_metadata.info_json.quality`, and aggregate rows into `statistics.parquet`; generate
    a categorical style for each cluster-membership column (`utils/add_annotation_style.py`).
  - `cli/stats.py` / `cli/prepare.py`: write the routed outputs (annotations + metadata + statistics)
    instead of a single statistics parquet.
  - Tests: per-protein outputs join correctly on identifiers; faithfulness lands in `info_json`;
    aggregate-only statistics part; styling round-trip.
- **This repo (`protspace_web`):**
  - `services/protspace-prep/src/protspace_prep/pipeline.py`: re-enrichment step rewrites parts
    1/2/4/5 atomically, still core-bundle-first and non-fatal; SSE stage retained.
  - `packages/core` data-loader + `packages/utils`: read faithfulness from `info_json.quality` and
    surface it; ensure computed cluster/silhouette annotation columns flow into the color-by control;
    optional aggregate-validity table.
- **Data-format change:** additive and backward compatible. Bundles without statistics are
  unchanged; the annotations and `info_json` additions are extra columns/keys existing readers
  tolerate; the statistics part keeps its eight-column schema (now aggregate rows only).
- **API / dependencies:** no HTTP API change; no new dependency (`silhouette_samples` is in the
  already-present scikit-learn).

## Sequencing & phasing (revised after fan-out review)

The four-lens review converged on **stack, don't amend**: the open engine/web PRs (#61/#295) ship a
self-contained, green, backward-compatible opaque fifth part with **zero user-visible surface**.
Folding this correctness-heavy routing refactor into them holds the green infra hostage and makes any
routing bug block the whole feature. Because the fifth part is unconsumed, landing it and then
**removing** the per-protein/faithfulness rows in this follow-up is non-breaking.

- **Phase 0 — land #61/#295 as-is** (opaque fifth part; reversible; no migration cost).
- **Phase 1 — low-risk routing:** faithfulness → `info_json.quality`; narrow the fifth part to
  aggregate validity only. No core-part (annotations) rewrite, so the prep robustness story is barely
  touched. Satisfies three of tsenoner's four bullets.
- **Phase 2 — per-protein annotations** (cluster membership + per-point silhouette + auto-styling +
  the color-by/provenance UX): the part that pulls statistics into the **core** annotations table,
  forces categorical/numeric typing through `base_processor`'s `.astype(str)` writer, generates full
  legend-settings envelopes, and floods the color-by dropdown (one membership + one silhouette column
  per projection; parameter sweeps / multi-embedding push this to 30–60 columns). Gate it behind a
  flag and land it once the typing, provenance-grouping, and initial-selection questions are answered.

## Open questions (defaulted now; confirm with tsenoner, do not block)

1. **Annotation column naming / which K.** Default: one membership column `cluster_<projection>` and
   one silhouette column `silhouette_<projection>` per projection, at the **elbow K only** (not a
   sweep); the chosen `K` is recorded in annotation metadata and the display label. ("x variable" is
   read as "the elbow K, which differs per projection".)
2. **Auto-styling.** Default: **yes** — generate a categorical palette for each membership column so
   clusters are colored on load.
3. **Faithfulness placement.** Default: inside `projections_metadata.info_json` under a `quality`
   sub-object (additive), not a new top-level metadata column.
