# protspace — Python CLI Package

Python package for dimensionality reduction of protein language model (pLM) embeddings, with annotation retrieval and data export for interactive visualization at [protspace.app](https://protspace.app).

- **Version:** 3.3.1
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

# Run tests (skip slow)
uv run pytest tests/ -m "not slow"

# Run all tests
uv run pytest tests/

# Lint
uv run ruff check src/ tests/

# Run CLI
uv run protspace prepare -i data/sizes/phosphatase.h5:prot_t5 -m pca2 -o output --no-scores

# Run all 6 DR methods on sample data
uv run protspace prepare -i data/sizes/phosphatase.h5:prot_t5 -m "pca2,tsne2,umap2,pacmap2,mds2,localmap2" -o output --no-scores -v
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
| `protspace serve` | Launch Dash web frontend |
| `protspace style` | Add annotation colors/styles |

### protspace prepare Usage

```bash
protspace prepare -i <input> -m <methods> -o <output> [options]

# From HDF5: protspace prepare -i embeddings.h5 -m pca2,umap2 -o output
# From FASTA: protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output
# Multi-model: protspace prepare -i seq.fasta -e prot_t5,esm2_3b -m pca2 -o output
# All 12 pLMs: protspace prepare -i seq.fasta -e prot_t5,prost_t5,esm2_8m,esm2_35m,esm2_150m,esm2_650m,esm2_3b,ankh_base,ankh_large,ankh3_large,esmc_300m,esmc_600m -m pca2 -o output
# Multi-embedding: protspace prepare -i esm2.h5 -i prott5.h5 -m pca2 -o output
# With similarity: protspace prepare -i emb.h5 -f seq.fasta -s -m pca2,mds2 -o output
# Name override: protspace prepare -i emb.h5:custom_name -m pca2 -o output
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
- **Inactive entry resolution:** `uniprot_retriever.py` resolves inactive UniProt entries via `fetch_one()` (returns merged target or inactive reason + UniParc ID). Deleted entries recover their sequence from UniParc. Falls back to `sec_acc:` search if `fetch_one()` fails. Summary logged at WARNING; per-entry details at DEBUG.
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
  → AnnotationManager.process()          # fetch UniProt/InterPro/taxonomy
    → UniProtRetriever                   # batch fetch + resolve inactive entries via UniParc
    → InterProRetriever                  # MD5-based batch API + name resolution
  → BaseProcessor.process_reduction()    # DR via reducer classes
  → BaseProcessor.create_output()        # Arrow tables
  → BaseProcessor.save_output()          # .parquetbundle or separate parquet files
```

## Output Format

`.parquetbundle` = concatenated Apache Parquet tables separated by `---PARQUET_DELIMITER---`:
1. `protein_annotations` — identifier + annotation columns
2. `projections_metadata` — projection names, dimensions, parameters
3. `projections_data` — reduced coordinates per protein per projection
4. `settings` (optional) — annotation styles, pinned values, display config

## Testing

```bash
uv run pytest tests/ -m "not slow"          # Fast tests (recommended during development)
uv run pytest tests/                         # All tests
uv run pytest tests/test_reducers.py -v      # Specific test file
uv run pytest tests/ --cov=src/protspace     # With coverage
```

### Test Files

| File | Tests | What it covers |
|------|-------|---------------|
| `test_annotation_manager.py` | 79 | Annotation fetch, merge, cache, configuration, evidence parsing |
| `test_transformer.py` | 56 | Annotation transformers (field normalization, EC names) |
| `test_reducers.py` | 51 | All 6 DR methods: shapes, finite output, float16, config validation |
| `test_interpro_annotation_retriever.py` | 46 | InterPro API mocking, parsing |
| `test_settings_converter.py` | 31 | Settings table ↔ visualization state conversion |
| `test_uniprot_annotation_retriever.py` | 29 | UniProt API mocking, inactive entry resolution |
| `test_pipeline_utils.py` | 28 | ReductionPipeline, EmbeddingSet, method parsing |
| `test_biocentral_embedder.py` | 23 | Biocentral API client, embedding flow |
| `test_fasta.py` | 17 | FASTA parsing, edge cases, CSV annotation loading |
| `test_config_validation.py` | 12 | DimensionReductionConfig parameter validation |
| `test_taxonomy_annotation_retriever.py` | 15 | Taxonomy via UniProt Taxonomy API (mocked + integration) |
| `test_h5_parse_identifier.py` | 9 | HDF5 key parsing, identifier extraction |
| `test_base_data_processor.py` | 8 | BaseProcessor: reduction, output creation, save |
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

## Dependencies

**Core:** h5py, scikit-learn, umap-learn, pacmap (includes annoy), numpy, pandas, pyarrow, tqdm, requests, pymmseqs, biocentral-api, typer, rich

**Frontend (optional):** dash, plotly, dash-bootstrap-components, dash-molstar, gunicorn

**Dev:** pytest, pytest-cov, ruff

## Conventions

- **Logging:** Configure once via `setup_logging()` in `cli/common_args.py`. Library modules use `logger = logging.getLogger(__name__)` only — no `logging.basicConfig()`.
- **Imports:** src-layout (`src/protspace/`). Tests import from `protspace.*` or `src.protspace.*`.
- **Linting:** ruff with py310 target, 88 char line length. Run `ruff check src/ tests/`.
- **Versioning:** python-semantic-release via `pyproject.toml`. Version in `pyproject.toml` + `__init__.py`.
- **Build:** hatchling backend.
