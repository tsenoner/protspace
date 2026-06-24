Phased per the fan-out review (see `proposal.md` "Sequencing"). **Stack on #61/#295, don't amend.**
Routing fans out at **bundle-assembly time** (`prepare`/pipeline + prep re-bundle); `protspace stats`
stays a pure aggregate-only producer. TDD; every routed output ships a known-answer fixture, not a
"column exists" check. Engine PRs land before the matching web PRs.

## Phase 0 — land the prior change (no work here)

- [ ] 0.1 Merge engine #61 + web #295 as-is (opaque fifth part). They are green and reversible; this
      change removes the per-protein/faithfulness rows from that part non-breakingly. Confirm with
      tsenoner: stack (recommended) vs amend.

## Phase 1 — low-risk routing (engine then web)

Faithfulness → `info_json.quality`; narrow the fifth part to aggregate validity only. **No core
(annotations) rewrite** — the prep robustness story is barely touched.

### 1A. Engine — destination on outputs + faithfulness to metadata

- [ ] 1A.1 `stats/base.py`: add `destination: str = "statistics_part"` to `StatRow` (default keeps
      every existing construction valid; `STATS_SCHEMA`/`to_record` unchanged — `destination` is not a
      column). Add `StatsReport.partition() -> dict[str, list[StatRow]]`; `to_arrow()` serializes only
      the `statistics_part` bucket.
- [ ] 1A.2 `stats/metrics/faithfulness.py`: mark its rows `destination="projection_metadata"`.
- [ ] 1A.3 Carriage: a router (in `data/processors/base_processor.py` / `pipeline.py`) that, **before**
      `create_output` builds `projections_metadata`, indexes faithfulness rows by `space_name` and
      injects a `quality` object into the matching `reduction["info"]` dict (so it serializes into
      `info_json`). Keep `info_json` valid JSON; unknown keys ignorable.
- [ ] 1A.4 `cli/stats.py` stays aggregate-only (writes `statistics.parquet` with only
      `validity`/`meta` rows). Confirm the prep `protspace stats … -o statistics.parquet` +
      `protspace bundle -s` path still works (faithfulness now absent from the part).
- [ ] 1A.5 Tests: faithfulness lands in `info_json.quality` with `k`/metric/sampling provenance;
      multi-embedding routes to the correct projection; statistics part has no faithfulness rows;
      `--no-stats` writes none of it; determinism incl. stable elbow `K`.
- [ ] 1A.6 Version bump; record the release for the web floor; open engine PR (or fold into #61 if
      amending).

### 1B. Web — surface faithfulness + prep

- [ ] 1B.1 `packages/core/.../scatter-plot/projection-metadata.ts`: expand `info_json.quality` into
      discrete per-metric rows (it currently flattens one level → raw JSON blob). Add a test.
- [ ] 1B.2 `services/protspace-prep`: bump `protspace` floor; the existing core-first + atomic
      re-bundle step is unchanged in shape (faithfulness rides in metadata via the engine). Verify the
      SSE stage + non-fatal behavior still hold.
- [ ] 1B.3 Tests: a bundle with `info_json.quality` renders faithfulness; a stats-less bundle is
      unchanged; existing readers tolerate the new key.

## Phase 2 — per-protein annotations (flagged)

Cluster membership + per-point silhouette as annotation columns, auto-styled. This is the
core-bundle-coupling, typing, and color-by-UX work. Gate behind a flag until the open questions land.

### 2A. Engine — per-point outputs

- [ ] 2A.1 `stats/metrics/validity.py`: emit per-protein **cluster membership** (existing elbow-`K`
      `labels`, already computed) as `destination="annotation"`, keyed by `ctx.ids`, values as
      **non-numeric strings** (`cluster 0`) so content-based inference is categorical. Emit per-point
      **`silhouette_samples`** over the **full** labelled set (not the aggregate's subsample) as a
      numeric `annotation` output with its own hard-ceiling skip guard.
- [ ] 2A.2 Carriage router: merge `annotation`-destined outputs into the `protein_annotations` Arrow
      table **without** going through `ArrowReader.save_data` (it writes `protein_annotations.parquet`
      while readers expect `selected_annotations.parquet` — silent-loss bug) and **outside** the
      `.astype(str)` path for the numeric silhouette column (preserve float round-trip). One
      membership + one silhouette column per projection; absent proteins → empty, not fabricated.
- [ ] 2A.3 Auto-style: generate a **full `LegendPersistedSettings` envelope** per membership column
      (categories keyed by exact label strings, each with `color`/`shape`/`zOrder`, plus
      `maxVisibleValues`/`shapeSize`/`sortMode`/`hiddenValues`/`enableDuplicateStackUI`/
      `selectedPaletteId`), merged into `settings` without clobbering existing styles. Style **only
      membership** (not silhouette).
- [ ] 2A.4 `replace_settings_in_bundle` / `protspace style`: preserve the statistics part **and** the
      generated cluster styles across a settings rewrite (restore + extend the prior "styling preserves
      statistics" round-trip).
- [ ] 2A.5 Flag: `--stats-annotations/--no-stats-annotations` (or equivalent) gating Phase-2 output;
      default per tsenoner.
- [ ] 2A.6 Known-answer tests: membership joins by identifier across a bundle where annotation
      id-set ≠ projection id-set ≠ embedding id-set; membership infers **categorical**, silhouette
      **numeric**, in the actual frontend type-inference rules; incomplete style envelope is rejected
      by the sanitizer (negative test); style round-trip; flag off → no columns.

### 2B. Web — color-by surfacing + provenance UX

- [ ] 2B.1 Confirm `cluster_*`/`silhouette_*` columns appear in color-by (no allowlist hides them) and
      silhouette renders as a continuous ramp.
- [ ] 2B.2 Provenance/grouping: register a "Computed/Statistics" annotation category (does not exist
      today — `annotation-categories.ts` / `annotation-metadata.ts`) so ~12–60 computed columns don't
      flood the flat "Other" group. Decide a default/initial selection (initial-view) if "colored on
      load" is wanted.
- [ ] 2B.3 Prep re-bundle now rewrites parts 1/2/4/5: add a test that a successful enrichment equals
      the core annotations **plus exactly** the computed columns (no row drops / reorder / retype), and
      that a stats failure still ships the un-enriched core bundle. Note the ~2× bundle I/O cost.
- [ ] 2B.4 Tests: 5-part routed bundle (with computed annotations + styles) loads, colors clusters
      when selected, ignores nothing erroneously; large-N / sweep bundle doesn't break color-by.

## Verification (each PR)

- [ ] V.1 Engine: `uv run pytest -m "not slow"` + `ruff check` + **`ruff format --check`** green
      (the CI step that bit #61); CLI startup not regressed (lazy imports).
- [ ] V.2 Web: `pnpm quality:ci` (`format:check && lint && quality`) green — run `format:check`, not
      just `quality`; prep `uv run pytest -q` green.
- [ ] V.3 Load a real engine-produced routed bundle in the app: faithfulness shows per-metric;
      (Phase 2) clusters color when selected; no console errors.

## Open decisions to resolve before Phase 2 (carry to tsenoner)

- [ ] Column naming + whether `K` shows in the visible label; elbow-`K`-only vs a small sweep.
- [ ] Initial-selection: should a membership column be the default color-by, or colored-when-selected.
- [ ] Aggregate fifth-part UI now vs deferred.
- [ ] Amend #61/#295 vs stack (recommended: stack).
