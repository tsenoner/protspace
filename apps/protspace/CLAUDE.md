# protspace — Python CLI Package

Python package for dimensionality reduction of protein language model (pLM) embeddings, with annotation retrieval and data export for interactive visualization at [protspace.app](https://protspace.app).

- **Version:** 4.7.0
- **Python:** >=3.10
- **License:** GPL-3.0
- **PyPI:** `pip install protspace`
- **GitHub:** https://github.com/tsenoner/protspace

## Running Commands

**Always use `uv run` to execute Python commands in this project.** Do not use bare `python` or `python3`.

```bash
# Install with dev deps + enable pre-commit hook (once per clone)
uv sync --group dev
git config core.hooksPath .githooks

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
| `protspace embed` | FASTA → HDF5 embeddings via Biocentral API |
| `protspace project` | HDF5 → dimensionality reduction |
| `protspace annotate` | Fetch protein annotations |
| `protspace bundle` | Combine projections + annotations → .parquetbundle |
| `protspace stats` | Compute projection quality statistics (annotation-based cluster-validity + faithfulness) |
| `protspace serve` | Launch Dash web frontend |
| `protspace style` | Add annotation colors/styles |
| `protspace transfer` | Fill missing annotations from nearest reference embeddings (EAT) |

### protspace prepare Usage

```bash
protspace prepare -i <input> -m <methods> -o <output> [options]

# From HDF5: protspace prepare -i embeddings.h5 -m pca2,umap2 -o output
# From FASTA: protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output
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

Compute per-projection quality statistics for an existing project directory (also available inline via `prepare --stats`). Validity is **annotation-based**: silhouette/DBI/CH are scored on a user-selected annotation's own category labels (not auto-clustering), computed once for the source embedding and again for each projection — `statistics.parquet` (bundle 5th part) gains an `annotation` column and `space_kind ∈ {embedding, projection}`. `--stats-annotation auto|name1,name2` (default `auto`) picks which annotation column(s) to score (all "suitable" low-cardinality categoricals, or an explicit list); requires `-a/--annotations`. Auto-clustering (KMeans elbow/silhouette) is retained for the per-protein `cluster_elbow_*` / `cluster_silhouette_*` membership columns (each value a `cluster N` label with the per-point silhouette attached as `|score`) + auto legend styles, but is no longer self-scored — instead its **ARI**/**NMI** agreement against each scored annotation is recorded (`stat_family=cluster_agreement`). Faithfulness (local kNN + global metrics, tagged `scope`) → each projection's `info_json.quality`. `--cluster-selection elbow|silhouette|both` picks the K-selection method(s).

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
| `esmc_300m` | Synthyra/ESMplusplus_small | 960 | Cambrian Open |
| `esmc_600m` | Synthyra/ESMplusplus_large | 1152 | Cambrian Non-Commercial |

Ankh models, ankh3_large, and esmc_600m are non-commercial only. ESMC models use Synthyra's HuggingFace-compatible reimplementation of EvolutionaryScale's ESM-C (near-identical embeddings, MSE ~7.74e-10).

Model shortcuts are defined in `MODEL_SHORT_KEYS` (CommonEmbedder models) and `EXTRA_SHORT_KEYS` (additional HuggingFace models) in `src/protspace/data/embedding/biocentral.py`. Display names are in `src/protspace/data/loaders/embedding_set.py`.

## Package Structure

```
src/protspace/
├── cli/
│   ├── app.py                  # Typer app root, shared utilities
│   ├── prepare.py              # Full pipeline command
│   ├── embed.py                # FASTA → HDF5 embedding
│   ├── project.py              # HDF5 → DR projections
│   ├── annotate.py             # Annotation fetching
│   ├── bundle.py               # Combine into .parquetbundle
│   ├── stats.py                # Projection quality statistics command
│   ├── serve.py                # Dash web frontend
│   └── style.py                # Annotation styling
├── data/
│   ├── loaders/
│   │   ├── embedding_set.py    # EmbeddingSet dataclass
│   │   ├── h5.py               # HDF5 loading with model_name resolution
│   │   ├── fasta.py            # FASTA → Biocentral → HDF5
│   │   ├── query.py            # UniProt query → FASTA download
│   │   └── similarity.py       # FASTA → MMseqs2 → similarity matrix
│   ├── annotations/
│   │   ├── configuration.py    # Annotation category definitions
│   │   ├── manager.py          # ProteinAnnotationManager orchestrator
│   │   ├── merging.py          # Merge UniProt + InterPro annotations
│   │   ├── scores.py           # Annotation score computation
│   │   ├── retrievers/         # UniProt, InterPro, taxonomy fetchers
│   │   └── transformers/       # Post-processing (field normalization, etc.)
│   ├── io/
│   │   ├── bundle.py           # .parquetbundle read/write
│   │   ├── formatters.py       # ProteinAnnotations → DataFrame/Arrow
│   │   ├── readers.py          # HDF5/CSV data readers
│   │   ├── settings_converter.py # Settings table conversion
│   │   └── writers.py          # Annotation output writers
│   ├── embedding/
│   │   └── biocentral.py       # Biocentral API client, model shortcut mappings
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
│   ├── reducers.py             # All DR method implementations + annoy fallback
│   ├── add_annotation_style.py # Annotation color/style utilities
│   └── arrow_reader.py         # Parquet/Arrow reading helpers
├── core/                       # Core data models
├── ui/                         # Dash UI components
├── visualization/              # Plotly visualization builders
├── app.py                      # Dash app factory
├── main.py                     # Main entry point (launches Dash)
└── wsgi.py                     # WSGI entry point for deployment
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
- **EC name resolution:** `uniprot_transforms.py` appends enzyme names to EC numbers using the ExPASy ENZYME database (`enzyme.dat` for fully specified ECs, `enzclass.txt` for partial ECs like `3.4.-.-`). Both files are downloaded and cached together in `~/.cache/protspace/enzyme/` with a 7-day TTL.
- **Warning suppression:** `base_processor.py` suppresses harmless sklearn RuntimeWarnings (randomized SVD overflow) and umap/pacmap UserWarnings during `fit_transform`.
- **Annoy fallback:** `reducers.py` includes a lazy annoy health check. On platforms where annoy is broken (e.g., macOS ARM64 segfaults), it monkey-patches pacmap to use sklearn `NearestNeighbors` instead. The check only runs when PaCMAP/LocalMAP are first used.
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
1. `protein_annotations` — identifier + annotation columns (incl. per-protein `cluster_elbow_*` / `cluster_silhouette_*` membership, with per-point silhouette attached as `value|score`, when `--stats`)
2. `projections_metadata` — projection names, dimensions, parameters (faithfulness rides in `info_json.quality` when `--stats`)
3. `projections_data` — reduced coordinates per protein per projection
4. `settings` (optional) — annotation styles, pinned values, display config
5. `statistics` (optional) — tidy table of annotation-based validity (silhouette/DBI/CH per annotation, `space_kind ∈ {embedding, projection}`, `annotation` column) + auto-cluster ARI/NMI agreement (`stat_family=cluster_agreement`) (`protspace stats` / `prepare --stats`)

Positional layout is `core(3) + settings? + statistics?`. When statistics are present but settings are absent, the settings slot is written as **zero bytes** so statistics stay at position five (readers branch on emptiness, not part count). Both bundled and separate-file (`--no-bundled`) output persist `settings.parquet` and `statistics.parquet` when present.

## Testing

```bash
uv run pytest -m "not slow"                  # Fast tests (recommended during development)
uv run pytest                                # All tests (protspace + protlabel)
uv run pytest tests/test_reducers.py -v      # Specific test file
uv run pytest --cov=src/protspace --cov=packages/protlabel/src/protlabel  # With coverage
```

### Test Files

| File | Tests | What it covers |
|------|-------|---------------|
| `test_annotation_manager.py` | 79 | Annotation fetch, merge, cache, configuration, evidence parsing |
| `test_transformer.py` | 56 | Annotation transformers (field normalization, EC names) |
| `test_reducers.py` | 51 | All 6 DR methods: shapes, finite output, float16, config validation |
| `test_interpro_annotation_retriever.py` | 46 | InterPro API mocking, parsing |
| `test_settings_converter.py` | 31 | Settings table ↔ visualization state conversion |
| `test_uniprot_annotation_retriever.py` | 24 | UniProt API mocking, inactive entry resolution |
| `test_pipeline_utils.py` | 70 | ReductionPipeline, EmbeddingSet, method parsing, multi-input merging, inline param overrides |
| `test_stats.py` | 50 | Projection statistics: elbow, annotation-based validity (silhouette/DBI/CH per annotation), auto-cluster ARI/NMI agreement, faithfulness (dual continuity + global metrics), cluster-selection (elbow/silhouette/both), subsample determinism/order-invariance, silhouette consistency, `_align` no-id guard, silhouette→elbow fallback |
| `test_stats_cli.py` | 16 | `protspace stats` CLI + `prepare` stats wiring, `--stats-annotation` (auto/list) wiring, `--settings-out` guard, `--cluster-selection` validation |
| `test_stats_carriage.py` | 10 | Routing rows to bundle parts (metadata quality, annotation columns, cluster legend) |
| `test_stats_bundle.py` | 7 | Optional 5th (statistics) bundle part round-trip |
| `test_annotation_select.py` | 6 | Annotation selection: suitability filter (cardinality/numeric/id-like exclusion), `auto` vs explicit-list label building (explicit names bypass the heuristic), missing-value dropping |
| `test_annotation_validity.py` | 6 | `AnnotationValidityStatistic`: silhouette/DBI/CH scored per annotation on `ctx.coords`, embedding vs. projection `space_kind`, missing-value exclusion, single-category no-op, id-canonical subsample determinism |
| `test_biocentral_embedder.py` | 23 | Biocentral API client, embedding flow |
| `test_fasta.py` | 17 | FASTA parsing, edge cases, CSV annotation loading |
| `test_biocentral_retriever.py` | 14 | Biocentral prediction retriever (TMbed parsing, per-sequence) |
| `test_taxonomy_annotation_retriever.py` | 15 | Taxonomy via UniProt Taxonomy API (mocked + integration) |
| `test_config_validation.py` | 12 | DimensionReductionConfig parameter validation |
| `test_style_warnings.py` | 15 | `protspace style` warnings: numeric-column detection (#67) + `selectedPaletteId` validation (categorical vs gradient palette) + pinned palette-catalog contract |
| `test_h5_parse_identifier.py` | 9 | HDF5 key parsing, identifier extraction |
| `test_base_data_processor.py` | 9 | BaseProcessor: reduction, output creation, save (incl. settings in unbundled output) |
| `test_ted_retriever.py` | 7 | TED domain retriever (mocked AlphaFold API, CATH names) |
| `test_pfam_clan.py` | 7 | Pfam CLAN transformer (mapping, dedup, edge cases) |
| `test_formatters.py` | 5 | ProteinAnnotations → DataFrame formatting |
| `test_output_combinations.py` | 4 | Output format flag combinations |
| `test_bundle_settings.py` | 4 | Parquetbundle settings read/write |

**Markers:** `@pytest.mark.slow` (database downloads), `@pytest.mark.integration` (external APIs)

## Notebooks

Located in `notebooks/`:

| Notebook | Purpose |
|----------|---------|
| `ProtSpace_Preparation.ipynb` | Google Colab — upload embeddings, configure DR methods, generate .parquetbundle |
| `ClickThrough_GenerateEmbeddings.ipynb` | Google Colab — generate embeddings from FASTA using ESM models |
| `ProtSpace_Transfer.ipynb` | Google Colab — Embedding Annotation Transfer (EAT): fill missing annotations from nearest reference proteins |

## Dependencies

**Core:** h5py, scikit-learn, umap-learn, pacmap (includes annoy), numpy, pandas, pyarrow, tqdm, requests, pymmseqs, biocentral-api, typer, rich

**Frontend (optional):** dash, plotly, dash-bootstrap-components, dash-molstar, gunicorn

**Dev:** pytest, pytest-cov, ruff

## Conventions

- **Logging:** Configure once via `setup_logging()` in `cli/common_args.py`. Library modules use `logger = logging.getLogger(__name__)` only — no `logging.basicConfig()`.
- **Imports:** src-layout (`src/protspace/`; `protlabel` at `packages/protlabel/src/`). Tests import from `protspace.*` / `src.protspace.*` and `protlabel.*`.
- **Linting:** ruff with py310 target, 88 char line length. Run `ruff check src/ packages/ tests/`.
- **Versioning:** python-semantic-release via `pyproject.toml`, lock-step across `protspace` + `protlabel`. Versions in `pyproject.toml`, `packages/protlabel/pyproject.toml`, and `src/protspace/__init__.py`.
- **Build:** hatchling backend; uv workspace (`uv build --all-packages`).
- **Git workflow:** Always create a feature branch and open a PR — never push directly to `main`.
