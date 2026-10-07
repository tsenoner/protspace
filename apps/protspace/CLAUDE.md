# protspace — Python CLI Package

Python package for dimensionality reduction of protein language model (pLM) embeddings, with annotation retrieval and data export for interactive visualization at [protspace.app](https://protspace.app).

- **Python:** >=3.12
- **License:** MIT
- **PyPI:** `pip install protspace`
- **GitHub:** https://github.com/tsenoner/protspace

## Running Commands

**Always use `uv run` to execute Python commands in this project.** Do not use bare `python` or `python3`.

```bash
# Install with dev deps (once per clone)
uv sync --group dev

# Git hooks come from husky, installed by `pnpm install` AT THE REPO ROOT — a
# Python-only setup leaves you with no pre-commit gate. Never set core.hooksPath
# by hand; husky owns it.
pnpm install

# Run tests (skip slow) — testpaths covers both protspace + protlabel
uv run pytest -m "not slow"

# Run all tests
uv run pytest

# Lint
uv run ruff check src/ packages/ tests/

# Run CLI
uv run protspace prepare -i data/sizes/phosphatase.h5:prot_t5 -m pca2 -o output --no-scores

# Run all 6 DR methods on sample data
uv run protspace prepare -i data/sizes/phosphatase.h5:prot_t5 -m "pca2,tsne2,umap2,pacmap2,mds2,localmap2" -o output --no-scores -v

# Compare UMAP with different parameters in a single run
uv run protspace prepare -i data/sizes/phosphatase.h5:prot_t5 -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2 -o output --no-scores
```

## CLI Commands

Single entry point: `protspace = protspace.cli.app:app`

| Command | Purpose |
|---------|---------|
| `protspace prepare` | Full pipeline: embed → reduce → annotate → bundle |
| `protspace embed` | FASTA → HDF5 embeddings (Biocentral API or local GPU/CPU via `--backend local`). Exits non-zero on an incomplete embedding; capability-limited sequences (`--max-length`, GPU OOM) are skipped and named instead |
| `protspace project` | HDF5 → dimensionality reduction |
| `protspace annotate` | Fetch protein annotations |
| `protspace bundle` | Combine projections + annotations → .parquetbundle |
| `protspace stats` | Compute projection quality statistics (annotation-based cluster-validity + faithfulness) |
| `protspace serve` | Launch Dash web frontend |
| `protspace style` | Add annotation colors/styles |
| `protspace transfer` | Fill missing annotations from nearest reference embeddings (EAT) |
| `protspace convert` | Rewrite a v1/v2 .parquetbundle as v3 (`INPUT OUTPUT` or `INPUT --in-place`); a v3 input is left untouched |

### protspace prepare Usage

```bash
protspace prepare -i <input> -m <methods> -o <output> [options]

# From HDF5: protspace prepare -i embeddings.h5 -m pca2,umap2 -o output
# From FASTA: protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output
# Local GPU/CPU embedding (offline, needs protspace[local]): protspace prepare -i seq.fasta -e prot_t5 --backend local -m pca2 -o output
# Multi-model: protspace prepare -i seq.fasta -e prot_t5,esm2_3b -m pca2 -o output
# All 12 pLMs: protspace prepare -i seq.fasta -e prot_t5,prost_t5,esm2_8m,esm2_35m,esm2_150m,esm2_650m,esm2_3b,ankh_base,ankh_large,ankh3_large,esmc_300m,esmc_600m -m pca2 -o output
# Combine datasets (same name → union): protspace prepare -i species_a.h5:prot_t5 -i species_b.h5:prot_t5 -m umap2 -o output
# Multi-embedding (different names → intersection): protspace prepare -i esm2.h5 -i prott5.h5 -m pca2 -o output
# With similarity: protspace prepare -i emb.h5 -f seq.fasta -s -m pca2,mds2 -o output
# Name override: protspace prepare -i emb.h5:custom_name -m pca2 -o output
# Parameter sweep: protspace prepare -i emb.h5 -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2 -o output
# Inline params: protspace prepare -i emb.h5 -m "pca2,umap2:n_neighbors=50;min_dist=0.3" -o output
# Quality stats (opt-in): protspace prepare -i emb.h5 -m pca2,umap2 --stats -o output
# Quality stats scoped to specific annotations: protspace prepare -i emb.h5 -m pca2 --stats --stats-annotation major_group,ec_number -o output
```

### protspace stats Usage

Compute per-projection quality statistics for an existing project directory (also available inline via `prepare --stats`). Validity is **annotation-based**: silhouette/DBI/CH are scored on a user-selected annotation's own category labels (not auto-clustering), computed once for the source embedding and again for each projection — `statistics.parquet` (bundle 5th part) gains an `annotation` column and `space_kind ∈ {embedding, projection}`. `--stats-annotation auto|name1,name2` (default `auto`) picks which annotation column(s) to score (all "suitable" low-cardinality categoricals, or an explicit list); requires `-a/--annotations`. Auto-clustering (KMeans elbow/silhouette) produces the per-protein `cluster_elbow_*` / `cluster_silhouette_*` membership columns (each value a bare `cluster N` label) + auto legend styles. Each labelling is scored on its own categories through `AnnotationValidityStatistic` (`label_kind=kmeans_elbow|kmeans_silhouette`, filed under the membership column's name), so a cluster column carries the same validity rows as any annotation — optimistic by construction, which the frontend caveats. Its **ARI**/**NMI** agreement against each scored annotation is recorded separately (`stat_family=cluster_agreement`). Faithfulness (local kNN + global metrics, tagged `scope`) → each projection's `info_json.quality`. `--cluster-selection elbow|silhouette|both` picks the K-selection method(s).

```bash
# Standalone (embeddings needed for faithfulness + the once-per-embedding annotation-validity pass)
protspace stats -i emb.h5 -p project_dir -o statistics.parquet
# Enrich annotations in place, score annotation-based validity, + emit cluster legend styles for `bundle --settings`
protspace stats -i emb.h5 -p project_dir -o statistics.parquet -a annotations.parquet --settings-out styles.json
# Score only specific annotations instead of every suitable categorical (default: auto)
protspace stats -i emb.h5 -p project_dir -o statistics.parquet -a annotations.parquet --stats-annotation major_group,ec_number
# Elbow + silhouette-optimal clusterings side by side
protspace stats -i emb.h5 -p project_dir -o statistics.parquet -a annotations.parquet --cluster-selection both
# Fold a stats parquet + settings into a bundle
protspace bundle -p project_dir -a annotations.parquet -s statistics.parquet --settings styles.json -o out.parquetbundle
```

### Supported Embedders (via Biocentral API)

| Shortcut | Model | Dim | License |
|----------|-------|-----|---------|
| `prot_t5` | Rostlab/prot_t5_xl_uniref50 | 1024 | MIT |
| `prost_t5` | Rostlab/ProstT5 | 1024 | MIT |
| `esm2_8m` | facebook/esm2_t6_8M_UR50D | 320 | MIT |
| `esm2_35m` | facebook/esm2_t12_35M_UR50D | 480 | MIT |
| `esm2_150m` | facebook/esm2_t30_150M_UR50D | 640 | MIT |
| `esm2_650m` | facebook/esm2_t33_650M_UR50D | 1280 | MIT |
| `esm2_3b` | facebook/esm2_t36_3B_UR50D | 2560 | MIT |
| `ankh_base` | ElnaggarLab/ankh-base | 768 | CC-BY-NC-SA-4.0 |
| `ankh_large` | ElnaggarLab/ankh-large | 1536 | CC-BY-NC-SA-4.0 |
| `ankh3_large` | ElnaggarLab/ankh3-large | 1536 | CC-BY-NC-SA-4.0 |
| `esmc_300m` | Synthyra/ESMplusplus_small | 960 | MIT |
| `esmc_600m` | Synthyra/ESMplusplus_large | 1152 | MIT |

Only the Ankh models (`ankh_base`, `ankh_large`, `ankh3_large`) are non-commercial. ESM-C was relicensed under MIT on 2026-05-27, retroactively covering the Dec-2024 checkpoints, when it moved to the Chan Zuckerberg Biohub, and Synthyra's derivatives passed that grant through on 2026-06-02 — `esmc_600m` is no longer Cambrian Non-Commercial, so do not re-add that warning.

ESM-C still goes through Synthyra's HuggingFace-compatible reimplementation of EvolutionaryScale's ESM-C (near-identical embeddings, MSE ~7.74e-10) for a purely technical reason, not a licensing one: `transformers` has no `esmc` model type (the port, huggingface/transformers#46419, is still open) and the `biohub/ESMC-*` repos ship no remote code, so loading the official weights would require the `esm` SDK, which pins `transformers<4.48.2` and Python `<3.13`. Revisit if #46419 merges; dims already match exactly (960 / 1152).

The user-facing copy of this licensing note lives in `docs/guide/python-cli.md` and the `prepare`/`embed` CLI help; keep the three in step.

Model shortcuts are defined in `MODEL_SHORT_KEYS` (the models the client lists in `CommonEmbedder`) and `EXTRA_SHORT_KEYS` (additional HuggingFace models) in `src/protspace/data/embedding/biocentral.py`. Both map a shortcut to the model id the server is sent; neither reads the client's enum member names, which change between client releases (2.0 renamed `ESM_8M`), so a renamed member cannot break the import (the offline backend imports the same package). A test pins `MODEL_SHORT_KEYS` to the ids the client lists. Display names are in `src/protspace/data/loaders/embedding_set.py`.

## Package Structure

```
src/protspace/
├── cli/
│   ├── app.py                  # Typer app root, shared utilities, setup_logging()
│   ├── common_options.py       # Shared Typer options
│   ├── prepare.py              # Full pipeline command
│   ├── embed.py                # FASTA → HDF5 embedding
│   ├── project.py              # HDF5 → DR projections
│   ├── annotate.py             # Annotation fetching
│   ├── bundle.py               # Combine into .parquetbundle
│   ├── stats.py                # Projection quality statistics command
│   ├── serve.py                # Dash web frontend
│   ├── transfer.py             # Embedding Annotation Transfer (EAT) command
│   ├── style.py                # Annotation styling
│   └── convert.py              # v1/v2 → v3 bundle conversion
├── data/
│   ├── biocentral_connection.py # Biocentral server address + wait_for_server(): one wait for embedding and annotation, and a failure that says why
│   ├── loaders/
│   │   ├── embedding_set.py    # EmbeddingSet dataclass
│   │   ├── h5.py               # HDF5 loading with model_name resolution
│   │   ├── fasta.py            # FASTA → Biocentral → HDF5
│   │   ├── query.py            # UniProt query → FASTA download
│   │   └── similarity.py       # FASTA → MMseqs2 → similarity matrix
│   ├── annotations/
│   │   ├── cache.py            # all_annotations.parquet reuse: fill-in, legacy refresh, --refetch (prepare + annotate --cache-dir)
│   │   ├── configuration.py    # Annotation category definitions
│   │   ├── encoding.py         # Bundle format v2 wire contract (percent-encoding) + cache semantics versions
│   │   ├── manager.py          # ProteinAnnotationManager orchestrator
│   │   ├── merging.py          # Merge UniProt + InterPro annotations
│   │   ├── scores.py           # Annotation score computation
│   │   ├── retrievers/         # UniProt, InterPro, taxonomy fetchers
│   │   └── transformers/       # Post-processing (field normalization, etc.)
│   ├── io/
│   │   ├── bundle.py           # .parquetbundle read/write
│   │   ├── fasta.py            # FASTA detection + parsing (is_fasta_file, parse_fasta)
│   │   ├── formatters.py       # ProteinAnnotations → DataFrame/Arrow
│   │   ├── predictions.py      # Per-cell prediction overlay columns
│   │   ├── settings_converter.py # Settings table conversion
│   │   └── writers.py          # Annotation output writers
│   ├── embedding/
│   │   ├── store.py            # Shared HDF5 layer + completeness contract (owned by neither backend)
│   │   ├── biocentral.py       # Biocentral API client, model shortcut mappings
│   │   └── local.py            # Local GPU/CPU backend (HF transformers, [local] extra)
│   ├── parsers/
│   │   └── uniprot_parser.py   # UniProt XML/TSV parsing
│   └── processors/
│       ├── base_processor.py   # BaseProcessor — DR + output creation core
│       └── pipeline.py         # ReductionPipeline — unified orchestrator
├── stats/                      # Projection quality statistics (opt-in, --stats)
│   ├── __init__.py             # Lazy STATISTICS registry + compute_statistics entry
│   ├── base.py                 # StatContext / StatRow / AnnotationColumn / StatsReport
│   ├── driver.py               # Per-projection contexts + once-per-embedding pass, embedding id-join, run stats
│   ├── carriage.py             # Route rows to bundle parts (metadata / annotations / legend)
│   ├── annotation_select.py    # Pick "suitable" annotations (auto/list) + build id→category labels
│   ├── _sampling.py            # id-canonical deterministic subsampling (id_seed + sorted_subsample)
│   ├── cluster/kmeans_elbow.py # KMeans + distance-to-chord elbow (subsampled at scale)
│   └── metrics/
│       ├── validity.py             # Auto-cluster (KMeans) + ARI/NMI agreement vs annotations
│       ├── annotation_validity.py  # silhouette / Davies-Bouldin / Calinski-Harabasz per annotation
│       └── faithfulness.py         # kNN-overlap / trustworthiness / continuity
├── utils/
│   ├── __init__.py             # Lazy exports: REDUCERS dict, reducer constants
│   ├── constants.py            # DimensionReductionConfig, method name constants
│   ├── reducers.py             # All DR method implementations
│   ├── add_annotation_style.py # Annotation color/style utilities
│   └── arrow_reader.py         # Parquet/Arrow reading helpers
├── analysis/                   # Query/reference classification
├── core/                       # Core data models
├── ui/                         # Dash UI components
├── visualization/              # Plotly visualization builders
├── app.py                      # Dash app factory
└── main.py                     # Main entry point (launches Dash)
```

### uv workspace: `protlabel` (EAT engine)

This repo is a **uv workspace**. `protlabel` (PyPI, numpy-only) is the Embedding
Annotation Transfer engine — a separate distribution in `packages/protlabel/`, **not**
part of `protspace`. It imports nothing from `protspace` (enforced by
`test_protlabel_boundary.py`); `protspace` depends on it as a workspace member and the two
release in lock-step. Modules: `backends.py` (brute-force kNN), `reliability.py`
(distance→confidence), `transfer.py` (`eat()`), `lookup.py` (`.npz` sidecar). The only
protspace-side glue is `cli/transfer.py` and `data/io/predictions.py`. Build the whole
workspace with `uv build --all-packages`.

## Dimensionality Reduction

Six methods supported, all in `src/protspace/utils/reducers.py`:

| Method | Class | Library | Key Parameters |
|--------|-------|---------|---------------|
| PCA | `PCAReducer` | scikit-learn | `n_components` |
| t-SNE | `TSNEReducer` | scikit-learn | `n_components`, `perplexity`, `learning_rate`, `metric` |
| UMAP | `UMAPReducer` | umap-learn | `n_components`, `n_neighbors`, `min_dist`, `metric` |
| PaCMAP | `PaCMAPReducer` | pacmap | `n_components`, `n_neighbors`, `mn_ratio`, `fp_ratio` |
| MDS | `MDSReducer` | scikit-learn | `n_components`, `n_init`, `max_iter`, `eps` |
| LocalMAP | `LocalMAPReducer` | pacmap | `n_components`, `n_neighbors`, `mn_ratio`, `fp_ratio` |

### Key Implementation Details

- **Float16 upcast:** HDF5 embeddings (often float16 from pLMs) are upcast to float32 in `data/loaders/h5.py:load_h5()` to prevent matrix overflow. A safety-net upcast also exists in `base_processor.py`.
- **HDF5 loading:** `load_h5()` in `data/loaders/h5.py` handles both flat and grouped HDF5 layouts, validates embedding dimensions are consistent, and rejects per-residue embeddings with a clear error message.
- **Multi-input merging:** `merge_same_name_sets()` in `data/loaders/embedding_set.py` unions proteins when multiple `-i` inputs share the same embedding name (e.g., two species with ProtT5). Inputs with different names are intersected for multi-embedding comparison. Duplicate proteins with identical embeddings are deduplicated; conflicting embeddings raise an error.
- **UniProt ID validation:** `uniprot_retriever.py` pre-filters identifiers with a UniProt accession regex — non-matching IDs (e.g., `NCBI|...`, `sp|P12345|NAME`) are skipped with a summary warning. Identifiers must be bare accessions (e.g., `P12345`, `A0A2P1BSS8`). Inactive entries are resolved via `fetch_one()` (returns merged target or inactive reason + UniParc ID). Deleted entries recover their sequence from UniParc.
- **Annotation cache (`all_annotations.parquet`):** `data/annotations/cache.py:fetch_annotations` decides what to reuse and fetch, for both `prepare` (via `ReductionPipeline._fetch_annotations`) and `annotate --cache-dir`. `ProteinAnnotationManager.to_pd` writes a checkpoint after each source fetched over the network (except the last, which the final write covers) under the final write's rules: a pending source keeps its cached columns, and new fill-in rows wait until every pending source the cache holds has filled them in. An incomplete source (plus its dependents) never reaches the cache; where the cache already holds current values for it, those are read back from the file and kept beside the sources that finished (`_kept_cached_values`, stale columns excluded), and the write is skipped only when no other fetched source finished. InterPro/Biocentral count as incomplete when UniProt lost a batch and a requested protein has no sequence. A cache holds values per identifier, not per sequence. `encoding.CACHE_SEMANTICS_CHANGES` versions stored meaning (v1 `xref_pdb`; v2 `protein_families` + every InterPro column, whose refresh also drops InterPro-N matches; v3 `root`, now the lineage's top node, and `predicted_transmembrane`, whose negative is `non-transmembrane` instead of `none`): a requested stale column refetches its source once (plus UniProt when the cache lacks the source's lookup key, via `determine_sources_to_fetch`; Biocentral needs `sequence` like InterPro, unless a FASTA covers the run), an unrequested one is dropped. A refresh widens its fetch to every cached column of each refreshed source the run queries anyway, then cuts the frame back to the request (`_requested_columns`), so it drops no current column. The cache also carries `protspace_uniprot_release` (from the `X-UniProt-Release` header, collected on `UniProtRetriever.releases`), which `prepare` writes to `run.log` as `uniprot_release:`; an empty stamp means no identifier was a UniProt accession (`UniProtRetriever.queried_accessions == 0`) and reads as `none`.
- **Biocentral connection:** `data/biocentral_connection.py` holds the server address (`BIOCENTRAL_URL`) and `wait_for_server(api)`, which every Biocentral call site goes through (embedding, the embedder probe, the annotation retriever). `biocentral-api`'s major version tracks the server's and each release hard-codes the window it accepts (1.x: v1 only; 2.x: v2 only), so a mismatch is not an outage, though the client reports it as one: a bare `TimeoutError` after 30 s. On that timeout the helper makes one `/health` request and raises `BiocentralUnavailableError`, a `ValueError` so `embed`/`prepare` print `ERROR:` and exit 1, saying whether the server did not answer or ran a major outside the client's window, with both versions; it reads that window off the client it was handed, because reading it from the client module at import broke the retriever tests whenever they ran on their own. Every message starts `No healthy Biocentral service became available in time`, the words the prep service matches to route a failure to Colab, and `prep-ci.yml` runs on `apps/protspace/**` so the test that pins this runs on edits to either side. `embed` stops at the first such failure instead of waiting out 30 s per model. The helper sits outside `data/embedding/` and imports nothing from the client, so annotation can use it without the embedder shortcut tables. The dependency is capped `<3` on purpose: `pip` users get whatever resolves, so an uncapped client could change its API under them with no CI run; moving the cap means running the suite against the new client. `biocentral-api` 2.x declares `Python <3.14` but runs there: `uv` ignores the bound (the lock and the CI 3.14 leg are fine) while stock `pip` refuses it and falls back to an older protspace, which `docs/guide/python-cli.md` explains. Known cost: 2.x depends on `biotrainer-core`, which imports torch when it is installed, so importing the client takes about 0.65 s there instead of 0.2 s; `prepare` and `embed` pay it through `data/embedding`'s eager imports.
- **Retrieval robustness:** InterPro is queried once per sequence MD5 and fans the matches out to every identifier sharing it, and its POST goes through `http_utils.post_with_retry` (same loop as `get_with_retry`). It skips InterPro-N matches (`source == "InterPro-N"`, AI predictions under a member library's name, unscored), so each column holds member-database matches only. Biocentral predicts in batches of `_BATCH_SIZE` (1,000); a failed batch sets `prediction_failed` and one stderr warning that stays clear of `_BIOCENTRAL_DOWN_PATTERNS`. Sequences outside the server's 7–5,000-residue limits (`_MIN/_MAX_SEQUENCE_LENGTH`) are never sent, because one of them makes the server refuse the whole request (422); they stay empty without failing the source, and a 422 that names a sequence resends the batch without it. Batches are also bounded at `_MAX_BATCH_RESIDUES` (200,000; the models fail on ~500K-residue requests), and a batch that fails otherwise is split in half and resent `_MAX_SPLIT_DEPTH` (2) levels deep. TED retries first-pass failures once more after the pass with the full budget, stopping after 10 consecutive failures. **Throughput:** TED (8) and InterPro (4) run a bounded number of requests at once (`MAX_CONCURRENT_REQUESTS` per module, `max_concurrent_requests=` per retriever, no CLI flag) on one `http_utils.PooledSession`. TED's first pass takes results as they finish (`http_utils.map_as_completed`, filed by position, failures sorted afterwards), so a lookup that times out holds up only its worker; TED's final pass and InterPro take them in input order (`http_utils.map_in_order`, 64 calls per worker submitted ahead), so values, failure counts and the 10-in-a-row breakers match one request at a time. Ending a pass early (a breaker, Ctrl-C) sets `PooledSession.stop`: queued calls are cancelled, running ones give up after their current attempt, and nothing more is sent (`FetchStopped`). A `Retry-After` on a `PooledSession` pauses every request on it, re-checked after each sleep; UniProt's single-attempt inactive-entry lookups go through `get_with_retry(attempts=1)` so they honour it too. UniProt reuses one session, sequentially. Tests take the backoff out by patching `http_utils._sleep` (plus `http_utils.time` for a fake clock), not the global `time.sleep`. Tests that fake these servers must patch `requests.Session.get/post`, not `requests.get/post`, or the real API is called. Each source's manager-facing failure signal (`failed_batch_count` / `prediction_failed` / `failed_lookup_count`) keeps an incomplete source out of the cache.
- **Family names:** `UniProtEntry.protein_families` keeps the first sentence of every SIMILARITY text, never splitting inside parentheses (`(TC 3.A.3)` survives), drops `In the … section;` qualifiers, and `;`-joins distinct families with their evidence; `transform_protein_families` passes values through unchanged.
- **Bundle columns:** `data/io/bundle.py` drops `INTERNAL_ANNOTATIONS` (`organism_id`, `sequence`) in `write_bundle`, `replace_annotations_in_bundle` and `_legacy_core_as_v3` (the v1/v2 upgrade of `convert_bundle` and `replace_settings_in_bundle`), so `bundle`/`transfer`/`convert`/`style` never carry them; `annotate -a sequence` still writes `sequence` to its own parquet.
- **EC name resolution:** `uniprot_transforms.py` appends enzyme names to EC numbers using the ExPASy ENZYME database (`enzyme.dat` for fully specified ECs, `enzclass.txt` for partial ECs like `3.4.-.-`). Both files are downloaded and cached together in `~/.cache/protspace/enzyme/` with a 7-day TTL.
- **Warning suppression:** `base_processor.py` suppresses harmless sklearn RuntimeWarnings (randomized SVD overflow) and umap/pacmap UserWarnings during `fit_transform`.
- **Config validation:** `DimensionReductionConfig` (frozen dataclass in `utils/constants.py`) validates all parameters on init.
- **Reducer registry:** `REDUCERS` dict in `utils/__init__.py` maps method names to reducer classes (lazy-loaded).
- **Logging:** `setup_logging()` in `cli/app.py` uses a tqdm-aware handler to avoid garbling progress bars. Third-party loggers (`urllib3`, `requests`) are capped at WARNING even with `-vv`.

### Data Pipeline Flow

```
HDF5 file (float16 embeddings)
  → h5.load_h5()                         # upcast to float32, validate dims, handle groups
  → merge_same_name_sets()               # union same-name inputs, keep others for intersection
  → AnnotationManager.process()          # fetch UniProt/InterPro/taxonomy
    → UniProtRetriever                   # batch fetch + resolve inactive entries via UniParc
    → InterProRetriever                  # MD5-based batch API + name resolution
  → BaseProcessor.process_reduction()    # DR via reducer classes
  → BaseProcessor.create_output()        # Arrow tables
  → BaseProcessor.save_output()          # .parquetbundle or separate parquet files
```

## Output Format

`.parquetbundle` = concatenated Apache Parquet tables separated by `---PARQUET_DELIMITER---`:
1. `protein_annotations` — identifier + annotation columns (incl. per-protein `cluster_elbow_*` / `cluster_silhouette_*` membership, a bare `cluster N` label, when `--stats`)
2. `projections_metadata` — projection names, dimensions, parameters (faithfulness rides in `info_json.quality` when `--stats`)
3. `projections_data` — reduced coordinates per protein per projection
4. `settings` (optional) — annotation styles, pinned values, display config
5. `statistics` (optional) — tidy table of annotation-based validity (silhouette/DBI/CH per annotation, `space_kind ∈ {embedding, projection}`, `annotation` column) + auto-cluster ARI/NMI agreement (`stat_family=cluster_agreement`) (`protspace stats` / `prepare --stats`)
6. `payloads` (format v3 only, required): label dictionaries and CSR code/score/evidence buffers for part 1 (`data/io/bundle_v3.py`)

Every write from here emits **six** parts (format v3): `core(3) + settings + statistics + payloads`, with zero bytes in the settings or statistics slot when absent, because the browser reads the payloads positionally from `parts[5]`. `replace_settings_in_bundle` (`protspace style`) keeps a v3 input's other parts byte for byte and writes a legacy (v1/v2) input as v3, encoded exactly as `convert_bundle` would, with one warning naming the input's version.

Legacy (v1/v2) containers still read, but that is **deprecated and removed in protspace 5.0.0**: every public read (`read_tables`, `read_bundle`, `extract_bundle_to_dir`, `read_settings_from_bundle`, `read_statistics_from_bundle`) logs one warning naming `protspace convert`, emitted in `_parse_bundle`. The writers read their input with `warn_legacy=False`, so a command that reads then rewrites a bundle (`transfer`, `style`) warns once; `convert_bundle()` (`protspace convert`) never warns. Positional layout `core(3) + settings? + statistics?`, 3 to 5 parts. When statistics are present but settings are absent, the settings slot is written as **zero bytes** so statistics stay at position five (readers branch on emptiness, not part count). Both bundled and separate-file (`--no-bundled`) output persist `settings.parquet` and `statistics.parquet` when present.

`read_tables()` / `read_bundle()` / `extract_bundle_to_dir()` decode v3 back to the v2-shaped tables (all-string cells, long projections, stamped `protspace_format_version=2`), so every consumer above `data/io/` is unchanged. Two footer keys: `protspace_container_version=3` marks a v3 part 1 (and only that), `protspace_format_version` (`BUNDLE_FORMAT_VERSION = 2`) is the annotation cell grammar of legacy parts and v2-shaped tables, absent = v1. `encode_v3`/`write_bundle`/`replace_annotations_in_bundle` refuse a table not stamped v2; callers holding v1 cells migrate explicitly (`migrate_legacy_annotation_table`, or `upgrade_cell_grammar(table, version)` when a `rename_columns` dropped the stamp). See `docs/guide/data-format.md`.

## Testing

```bash
uv run pytest -m "not slow"                  # Fast tests (recommended during development)
uv run pytest                                # All tests (protspace + protlabel)
uv run pytest tests/test_reducers.py -v      # Specific test file
uv run pytest --cov=src/protspace --cov=packages/protlabel/src/protlabel  # With coverage
```

### Test Files

Scoped to `tests/`; `protlabel` has its own suite under `packages/protlabel/tests/`.
Counts are deliberately omitted — nothing validates them, so they only ever drift.
For a live count run `uv run pytest tests/ --collect-only -q`.

| File | What it covers |
|------|---------------|
| `test_annotation_manager.py` | Annotation fetch, merge, cache, configuration, evidence parsing; per-identifier reuse (a source is fetched only for the identifiers the cache lacks, taxonomy only for unseen organisms, rows outside the run are kept, a failed fill-in caches nothing) |
| `test_transformer.py` | Annotation transformers (field normalization, EC names) |
| `test_reducers.py` | All 6 DR methods: shapes, finite output, float16, config validation |
| `test_interpro_annotation_retriever.py` | InterPro API mocking, parsing, identical sequences all receiving the matches, POST retry before a batch counts as lost, InterPro-N matches dropped (captured real responses), parallel batches equal to one at a time, breaker bound under concurrency, a tripped breaker stopping batches still retrying, a slow batch not holding up the others |
| `test_http_retry.py` | `get_with_retry` / `post_with_retry`: transient status + network errors retried, `Retry-After` honoured and capped, 4xx not retried, bounded attempts; `paginated_get`'s `on_response` sees every page; sending through a `PooledSession`, whose `Retry-After` pauses every request (re-checked when another extends it) and whose `stop` ends waits and sends nothing more; `map_in_order` order, concurrency bound, submit-ahead bound, a slow call not idling the pool, early close setting `stop`; `map_as_completed` (completion order, bounded queue, slow call holding only its worker) |
| `test_annotation_checkpoints.py` | Per-source cache checkpoints: an interrupt during TED keeps UniProt + InterPro cached, a later incomplete source, pending sources keep their cached columns, fill-in rows wait for pending sources, nothing written on a cache hit or without a cache |
| `test_annotate_cache_dir.py` | `annotate --cache-dir` / `--refetch`: resume after an interrupt, reusing a `prepare` cache, `--refetch` without a cache is a usage error, no cache without the flag, internal columns only when requested |
| `test_run_log.py` | UniProt release stamp on the cache (full fetch, fill-in, refetch, unstamped → `unknown`, `Mock`/missing `releases`, no UniProt accession → `none`) and the `run.log` `uniprot_release:` line |
| `test_failed_source_cache.py` | A failed source whose values the cache holds keeps them while finished sources (e.g. TED) are saved; uncovered proteins left out; kept UniProt values keep their release; no rewrite when nothing else finished; InterPro/Biocentral incomplete when a lost UniProt batch left them without sequences |
| `test_legacy_cache_refresh.py` | Cache versions 2 and 3: `protein_families` refetches UniProt once, an InterPro column refetches InterPro once (and fetches sequences the cache lacks), `root` refetches taxonomy once (and fetches `organism_id` the cache lacks), `predicted_transmembrane` refetches Biocentral once (and fetches sequences the cache lacks), a refresh keeps every cached column of its source, a default run pays no taxonomy/Biocentral refresh, no other source is fetched, unrequested stale columns are dropped, a failed refresh stamps nothing stale as current; the literal InterPro list in `encoding.py` pinned to `INTERPRO_ANNOTATIONS` |
| `test_annotation_retrieval_e2e.py` | One offline `prepare` through the real UniProt + InterPro retrievers: the release header reaches `run.log`, shared-sequence proteins both get Pfam in the bundle, no internal columns |
| `test_protein_families_parser.py` | Family parsing on real UniProt text shapes: `(TC …)` kept whole, section qualifiers dropped, multi-section entries `;`-joined with evidence, repeats once; transformer + `--no-scores` on multi-family cells |
| `test_bundle_internal_columns.py` | `write_bundle`, `bundle -a`, `replace_annotations_in_bundle` and `transfer` drop `organism_id`/`sequence` and keep the v2 stamp, and `write_bundle` still refuses an unstamped table; `annotate -a sequence` still writes `sequence` |
| `test_settings_converter.py` | Settings table ↔ visualization state conversion |
| `test_uniprot_annotation_retriever.py` | UniProt API mocking, inactive entry resolution, `X-UniProt-Release` collected from every response on `releases`, every request through one session, a `Retry-After` on an inactive-entry or UniParc lookup holding the next request |
| `test_pipeline_utils.py` | ReductionPipeline, projection cache identity (a changed, reordered or grown matrix under one embedding name misses; an unchanged rerun hits; `--refetch projections` always recomputes), annotation cache fill-in wiring, EmbeddingSet, method parsing, multi-input merging, inline param overrides |
| `test_stats.py` | Projection statistics: elbow, annotation-based validity (silhouette/DBI/CH per annotation), auto-cluster ARI/NMI agreement, auto-cluster self-validity (filed under the membership column, gated on it, and equal to driving `AnnotationValidityStatistic` directly so an out-of-band re-score cannot drift), faithfulness (dual continuity + global metrics), cluster-selection (elbow/silhouette/both), subsample determinism/order-invariance, silhouette consistency, `_align` no-id guard, silhouette→elbow fallback |
| `test_stats_cli.py` | `protspace stats` CLI + `prepare` stats wiring, `--stats-annotation` (auto/list) wiring, `--settings-out` guard, `--cluster-selection` validation |
| `test_stats_carriage.py` | Routing rows to bundle parts (metadata quality, annotation columns, cluster legend) |
| `test_stats_bundle.py` | Optional 5th (statistics) bundle part round-trip |
| `test_annotation_select.py` | Annotation selection: suitability filter (cardinality/numeric/id-like exclusion), `auto` vs explicit-list label building (explicit names bypass the heuristic), missing-value dropping |
| `test_annotation_validity.py` | `AnnotationValidityStatistic`: silhouette/DBI/CH scored per annotation on `ctx.coords`, embedding vs. projection `space_kind`, missing-value exclusion, single-category no-op, id-canonical subsample determinism |
| `test_biocentral_embedder.py` | Biocentral API client, embedding flow, completeness gate (reads the .h5, not a counter), `/`-in-header rejection, producer stamping, and a local-written cache refused before any API call; shortcut resolution that survives a renamed client enum member, and the shortcut ids pinned to the ids the client lists |
| `test_embed_completeness.py` | Shared embed contract (`data/embedding/store.py`): `expected = requested - skipped`, skip-vs-fail, skip reporting, resume-covered runs, FASTA coverage direction + identifier normalisation; producer ownership (another backend or model is refused with the remedies and the file left byte-identical, an unstamped file is adopted then owned) and residue identity (a changed sequence is outstanding again and replaces its vector + digest, an unchanged one resumes, a digest-less protein is trusted, digests read in one file open) |
| `test_backend_switch.py` | Embedding backend switch: `embed_fasta` refuses another backend's cache and resumes its own, and returns only the requested FASTA's proteins; `resolve_default_backend` (Colab+GPU→local), `embed_fasta` local/biocentral dispatch (short key vs resolved name), `protspace embed --backend` CLI wiring + enum validation + non-positive batch_size rejection |
| `test_local_embedder.py` | Local embedding backend: producer/digest stamping, refusing a Biocentral cache before a checkpoint loads, re-embedding a changed sequence; checkpoint resolution (12 short keys, Synthyra ESM-C), the notebook-gating sets pinned to the registry each constrains (`COLAB_OVERSIZED`→`LOCAL_CHECKPOINTS`, `BIOCENTRAL_INVALID`→`ALL_SHORT_KEYS`), per-family preprocessing/residue pooling, `/`-in-header guard, LocalEmbedConfig validation, over-length + OOM skips reported not failed, non-skip shortfall fails, a resumed run adding a new protein, esm2_8m end-to-end (slow) |
| `test_fasta.py` | FASTA parsing, edge cases, CSV annotation loading |
| `test_query.py` | UniProt query FASTA download: a truncated download is never published, atomic cache publication, umask-derived permissions, and a retained FASTA owned by its query text (`prepare -q A` then `-q B` in one output directory) |
| `test_biocentral_connection.py` | `wait_for_server`: a healthy server costs no extra request; on a failed wait one `/health` request names the reason (unreachable, an HTTP error status, server newer/older than the client's window with both versions, in-window but unhealthy, unreadable version), read off the client it was handed, majors compared as numbers; the module imports nothing from the client; every message starts with the words the prep service routes on; `BiocentralUnavailableError` is a `ValueError`, so `protspace embed` prints `ERROR:` and exits 1 with no traceback and a multi-model run waits for the server once; embedding and the embedder probe fail the same way |
| `test_biocentral_retriever.py` | Biocentral prediction retriever (TMbed parsing, per-sequence), batches of at most `_BATCH_SIZE`, a failed batch keeps the others and warns clear of `_BIOCENTRAL_DOWN_PATTERNS`, long sequences still sent, no usable server fails the source and the warning says why |
| `test_taxonomy_annotation_retriever.py` | Taxonomy via UniProt Taxonomy API (mocked + integration) |
| `test_config_validation.py` | DimensionReductionConfig parameter validation |
| `test_style_warnings.py` | `protspace style` warnings: numeric-column detection (tsenoner/protspace-legacy#67) + `selectedPaletteId` validation (categorical vs gradient palette, per column type) + pinned palette-catalog contract |
| `test_h5_parse_identifier.py` | HDF5 key parsing, identifier extraction |
| `test_base_data_processor.py` | BaseProcessor: reduction, output creation, save (incl. settings in unbundled output) |
| `test_ted_retriever.py` | TED domain retriever (mocked AlphaFold API, CATH names), final retry pass for failed lookups (10-in-a-row cut-off, 404 never retried), parallel lookups equal to one at a time under jitter, one session, CATH names loaded once, a slow first-pass lookup not holding up the others, a tripped final-pass breaker stopping lookups still retrying |
| `test_pfam_clan.py` | Pfam CLAN transformer (mapping, dedup, edge cases) |
| `test_formatters.py` | ProteinAnnotations → DataFrame formatting |
| `test_bundle_settings.py` | Parquetbundle settings read/write |
| `test_annotation_encoding.py` | Percent-encoding round-trip, reserved-char-only encoding, schema-metadata stamping through parquet, `upgrade_cell_grammar` taking the version from the caller |
| `test_transfer_cli.py` | Transfer orchestration core and CLI registration |
| `test_predictions_overlay.py` | Building the per-cell prediction overlay columns |
| `test_display_decode.py` | Display-side decoding of encoded values, multi-hit rendering, gated-off passthrough |
| `test_toxprot_demo.py` | Signal-peptide bound parsing, mature-FASTA stripping, bundle post-processing (column filter/reorder) |
| `test_build_showcase.py` | `scripts/generate_examples/build_showcase.py`, the showcase bundle build: bundle reading and rebuilding (legacy and v3), projection selection, column order from the web catalog's `defaultView`, styles filtering, mature chains and the three-finger-toxins hold-out and EAT gates, provenance stamping read back by `write_manifest.py`, step markers and reruns, fetch release checks, `stage-release` never giving a published name new bytes; one offline end-to-end EAT build (three-finger toxins), run in CI |
| `test_write_manifest.py` | `scripts/generate_examples/write_manifest.py`: every record value read from the file (legacy and v3 containers), provenance and the build command's machine paths redacted, a bundle stamped for another example refused, retained files kept one release and never under a current file's name, the Zenodo DOI kept while the bytes are unchanged, `--check` |
| `test_stage_perf.py` | `scripts/generate_examples/stage_perf.py`: the perf-datasets release keeps the original ids and default sweep, staged files match their checksums and the manifest, a mismatched workspace file is refused, the publish commands |
| `test_bundle_overlay.py` | Round-trip replacement of the annotations part of a bundle |
| `test_atomic_publication.py` | `data/io/atomic.py`: staged rename keeps the previous content on failure, and a published file (bundle, statistics parquet, retained FASTA) carries the process umask rather than `mkstemp`'s owner-only mode |
| `test_classification.py` | Query/reference rules: id-prefix and case-insensitive `where` substring, query-over-reference precedence, empty-match and missing-column errors |
| `test_bundle_version.py` | `format_version=2` stamped on the table the `prepare` factory hands to `write_bundle`; a `prepare` bundle reads back its proteins, annotation cells and coordinates; `bundle -a` passes stamped annotate output and the `prepare` annotation cache through (an unstamped cache is recognised by its cache-version attribute), reads an unstamped table as v1 plain text (a pandas `category` column too), stores a list column as hits and reports an unstorable column as a usage error; `ArrowReader.save_data` keeps the stamp it read |
| `test_bundle_v3_encode.py` | v3 encoder: the physical contract behind the browser's zero-copy read (non-nullable PLAIN columns, one row group, little-endian payloads) and v2-reader-parity classification and code order (part 1 rows and projections in the v2 browser's order, numeric inference over the placed proteins with the `placedNumeric` mark, a v1 hit split at its last pipe); NaN for uncovered projections, added unannotated rows, dimension from the data, `true`/`false` booleans, list columns as one hit per element, unstamped and v1 tables refused |
| `test_bundle_v3_decode.py` | v3 decoder: `decode_v3(encode_v3(T)) == T` on pipeline-shaped tables, plus the deliberate canonicalisations; `sourceType` restoration (64-bit integers past 2^53 exactly), finite-only projection rows, manifest dimensions, payload tiling checks |
| `test_bundle_v3_container.py` | Six-part container boundary: every write emits v3 with part 6 pinned, every read hands back v2-shaped tables, legacy bundles read as written, the delimiter guard covers part 6; detection by `protspace_container_version`, `style` writing a legacy input as v3, `replace_annotations` keeping label columns labels and the `placedNumeric` mark, a corrupt part 1 as a bundle error |
| `test_bundle_v3_fixture.py` | The golden v3 fixture both languages read: committed bytes match the generator part for part, and the cells vitest asserts on |
| `test_convert.py` | `protspace convert` (v1 grammar migration, settings + statistics kept byte for byte, v3 no-op, `--in-place` / same-path, usage errors, atomic failure, the legacy id column keyed as the v2 browser keyed it and never migrated as a label) and the legacy-read deprecation warning (once per read, none for v3, silent writers, one per `style` run); `style` usage errors for a legacy input v3 cannot hold or a corrupt bundle; `convert` and `style` dropping a legacy bundle's internal lookup columns |
| `test_uniprot_parser_encoding.py` | UniProtEntry free-text emit points percent-encode reserved chars |
| `test_cath_names.py` | CATH names file parsing |
| `test_cli_no_frontend.py` | CLI imports without the optional `frontend` extra (plotly, dash) |
| `test_cli_no_similarity.py` | `-s/--similarity` without the optional `similarity` extra: up-front CLI guard (before any load/embed), loader `ImportError` backstop, `EMBEDDER_MODELS` pinned to the embedder registry |
| `test_docs_extras_sync.py` | `README.md` (PyPI) and `docs/guide/python-cli.md` (protspace.app) hold the same extras section; the guide's embedder shortcut list matches `EMBEDDER_MODELS` |
| `test_notebooks.py` | Colab notebooks: cell magics only on line 1, every code cell compiles after IPython transformation, cell ids present for `nbformat >= 4.5`, no notebook imports a private `protspace` name (cell 1 installs the *released* package, so a private name added this release breaks setup until the next one), each Generate action names its bundle distinctly, `except ImportError` fallback sets equal the package constants they stand in for — read structurally off the guarded import, so a fallback that is missing, emptied or written in an unrecognised shape fails instead of matching nothing |
| `test_scores_ted.py` | `--no-scores` strips TED domains |

**Markers:** `@pytest.mark.slow` (database downloads), `@pytest.mark.integration` (external APIs)

## Notebooks

Located in `notebooks/`:

| Notebook | Purpose |
|----------|---------|
| `ProtSpace_Preparation.ipynb` | Google Colab — upload embeddings, configure DR methods, generate .parquetbundle |
| `ClickThrough_GenerateEmbeddings.ipynb` | Google Colab — generate embeddings from FASTA using ESM models |
| `ProtSpace_Transfer.ipynb` | Google Colab — Embedding Annotation Transfer (EAT): fill missing annotations from nearest reference proteins |

## Dependencies

**Core:** h5py, scikit-learn, umap-learn, pacmap, numpy, pandas, pyarrow, tqdm, requests, biocentral-api (`>=2.0.0,<3`), typer, rich, protlabel (workspace member)

**Frontend (optional):** dash, plotly, dash-bootstrap-components, dash-molstar

**Similarity (optional, `[similarity]` extra):** pymmseqs, only reached via `-s/--similarity`. Install with `pip install "protspace[similarity]"`.

The two reasons it was moved out of core are **fixed upstream as of pymmseqs 1.2.0** (2026-08-11): every release through 1.1.0 shipped cp310-only wheels, so on this package's `requires-python = ">=3.12"` it always compiled from sdist, and its `ipython<9` pin upgraded Colab's pinned ipython. 1.2.0 ships `py3-none-*` wheels for macOS/manylinux/musllinux and depends only on numpy/pandas/pyyaml — all already core. **The floor is `>=1.2.0` so that is guaranteed, not incidental.** It stays an extra anyway: it is reachable through one flag, and a smaller base install is worth keeping on its own. Revisit only if `-s` stops being niche.

**Local embedding (optional, `[local]` extra):** torch, transformers, sentencepiece, protobuf, einops, enabling on-device embedding via `protspace.data.embedding.local` (issue #320; alternative to the Biocentral API). Install with `pip install "protspace[local]"`.

**Local↔Biocentral parity (verified 2026-07-16):** local embeddings match the Biocentral API at **cosine ≥ 0.9999** for ProtT5, ProstT5, ESM2, Ankh, and Ankh3 (25-seq Pla2g2 cross-check; small rel-L2 is half-vs-full precision drift). **Exception — ESM-C:** local ESM-C (Synthyra ESM++) is bit-identical to native EvolutionaryScale ESM-C but **orthogonal to Biocentral's ESM-C** (cosine ~0.02). Root cause is on Biocentral's side: its engine (`biotrainer`) has no dedicated ESM-C embedder and its generic loader substring-matches `"esm"` in `ESMplusplus`, loading the ESM-C checkpoint as a vanilla ESM-2 model (wrong architecture/tokenizer) — so it never runs the real ESM-C. Do **not** mix local and Biocentral `esmc_*` embeddings in one dataset until Biocentral is fixed.

**Dev:** pytest, pytest-cov, ruff

## Conventions

- **Logging:** Configure once via `setup_logging()` in `cli/app.py`. Library modules use `logger = logging.getLogger(__name__)` only — no `logging.basicConfig()`.
- **Imports:** src-layout (`src/protspace/`; `protlabel` at `packages/protlabel/src/`). Tests import from `protspace.*` / `src.protspace.*` and `protlabel.*`.
- **Linting:** ruff with py312 target, 88 char line length. Run `ruff check src/ packages/ tests/`.
- **Versioning:** python-semantic-release via `pyproject.toml`, lock-step across `protspace` + `protlabel`. Versions in `pyproject.toml`, `packages/protlabel/pyproject.toml`, and `src/protspace/__init__.py`.
- **Build:** hatchling backend; uv workspace (`uv build --all-packages`).
- **Git workflow:** Always create a feature branch and open a PR — never push directly to `main`.
