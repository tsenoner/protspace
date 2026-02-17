# CLI Reference

ProtSpace provides three CLI commands:

| Command                        | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `protspace-local`              | Process local embeddings or similarity matrices  |
| `protspace-query`              | Search UniProt, compute embeddings, and process  |
| `protspace-annotation-colors`  | Add/inspect annotation styles in existing files  |

## `protspace-local`

Process local protein data with dimensionality reduction.

```bash
protspace-local -i embeddings.h5 -a metadata.csv -m pca2,umap2 -o output.parquetbundle
```

### Options

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-i, --input` | HDF5 file(s), directory of HDF5 files, or CSV similarity matrix. Multiple files are merged automatically. | required |
| `-o, --output` | Output path (file or directory). | `protspace_<input>.parquetbundle` |
| `-a, --annotations` | Annotations as comma-separated names/groups, or path to a CSV metadata file. Repeatable (`-a csv -a pfam,kingdom`). | `default` |
| `-m, --methods` | Reduction methods: `pca`, `umap`, `tsne`, `pacmap`, `mds`, `localmap` + dimensions (e.g. `umap2,pca3`). | `pca2` |
| `--custom_names` | Custom display names for projections (e.g. `pca2=PCA_2D,umap2=UMAP`). | — |
| `--delimiter` | CSV delimiter for metadata files. | `,` |
| `--bundled` | Bundle parquet files into a single `.parquetbundle` (`true`/`false`). | `true` |
| `--non-binary` | Output in legacy JSON + CSV format instead of Parquet. | `false` |
| `--keep-tmp` | Cache intermediate files (annotations, FASTA) for reuse. | `false` |
| `--dump-cache` | Print cached annotations as CSV and exit. Requires prior `--keep-tmp` run. | `false` |
| `--force-refetch` | Discard cached annotations and re-download from APIs. | `false` |
| `--no-scores` | Omit evidence codes and bit scores from output. | `false` |
| `-v, --verbose` | Increase verbosity (`-v` = INFO, `-vv` = DEBUG). | warnings only |

## `protspace-query`

Search UniProt, download sequences, compute ESM2 embeddings, and process.

```bash
protspace-query -q 'organism_name:"Homo sapiens" AND reviewed:true' -m pca2,umap2
```

### Options

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-q, --query` | UniProt search query ([syntax](https://www.uniprot.org/help/query-fields)). | required |
| `-o, --output` | Output path. | `protspace.parquetbundle` |
| `-a, --annotations` | Annotations as comma-separated names/groups. | `default` |
| `-m, --methods` | Reduction methods (same as `protspace-local`). | `pca2` |
| `--bundled` | Bundle into `.parquetbundle` (`true`/`false`). | `true` |
| `--non-binary` | Legacy JSON + CSV output. | `false` |
| `--keep-tmp` | Cache intermediate files. | `false` |
| `--dump-cache` | Print cached annotations and exit. | `false` |
| `--no-scores` | Omit evidence codes and bit scores. | `false` |
| `-v, --verbose` | Increase verbosity. | warnings only |

## `protspace-annotation-colors`

Add custom colors, shapes, legend ordering, and display settings to existing ProtSpace files. See [Annotation Styling](styling.md) for the full styles JSON format, including legend ordering with `pinnedValues`.

```bash
# Generate a styles template (values in frequency order, empty color placeholders)
protspace-annotation-colors data.parquetbundle --generate-template > styles.json

# Apply styles from a JSON file
protspace-annotation-colors input.parquetbundle output.parquetbundle --annotation_styles styles.json

# Apply styles from an inline JSON string
protspace-annotation-colors input.parquetbundle output.parquetbundle --annotation_styles '{"ann": {"colors": {"val": "#FF0000"}}}'

# Pin specific legend entries with N/A at the end
protspace-annotation-colors input.parquetbundle output.parquetbundle --annotation_styles \
  '{"ann": {"sortMode": "manual", "zOrderSort": "size-desc", "pinnedValues": ["val1", "val2", ""]}}'

# Auto-fill top values by frequency, N/A at end
protspace-annotation-colors input.parquetbundle output.parquetbundle --annotation_styles \
  '{"ann": {"sortMode": "manual", "zOrderSort": "size-desc", "pinnedValues": ["__REST__", ""]}}'

# Inspect stored settings
protspace-annotation-colors data.parquetbundle --dump-settings
```

### Options

| Flag | Description |
| ---- | ----------- |
| `input_file` | Input `.parquetbundle`, `.json`, or parquet directory. |
| `output_file` | Output path (not required for `--dump-settings` or `--generate-template`). |
| `--annotation_styles` | Path to styles JSON file or inline JSON string. |
| `--generate-template` | Print a pre-filled styles template and exit. |
| `--dump-settings` | Print stored settings and exit. |

## Reduction Method Parameters

Parameters shared by both `protspace-local` and `protspace-query`.

### General

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `--metric` | Distance metric (`euclidean`, `cosine`, `manhattan`, `correlation`). Applies to UMAP, t-SNE, MDS. | `euclidean` |
| `--random_state` | Random seed for reproducibility. | `42` |

### UMAP / PaCMAP / LocalMAP

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `--n_neighbors` | Number of neighbors for manifold approximation (5-50). | `15` |
| `--min_dist` | Minimum distance between points (0.0-0.99). | `0.1` |
| `--mn_ratio` | Mid-near pairs ratio (PaCMAP/LocalMAP only, 0.1-1.0). | `0.5` |
| `--fp_ratio` | Further pairs ratio (PaCMAP/LocalMAP only, 1.0-3.0). | `2.0` |

### t-SNE

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `--perplexity` | Balance between local/global structure (5-50). | `30` |
| `--learning_rate` | Gradient descent step size (10-1000). | `200` |

### MDS

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `--n_init` | Number of initializations (1-10). | `4` |
| `--max_iter` | Max optimization iterations (100-1000). | `300` |
| `--eps` | Convergence tolerance (1e-6 to 1e-2). | `1e-3` |

## File Formats

### Input

| Format | Extension | Description |
| ------ | --------- | ----------- |
| Embeddings | `.h5`, `.hdf5`, `.hdf` | HDF5 files with protein IDs as keys. Supports multiple files and directories. |
| Similarity matrix | `.csv` | Symmetric CSV matrix. |
| Metadata | `.csv` | First column = protein identifiers, remaining columns = annotations. |
| UniProt query | text | Query string using [UniProt syntax](https://www.uniprot.org/help/query-fields). |

### Output

| Format | Description |
| ------ | ----------- |
| `.parquetbundle` | Single file bundling all parquet tables + optional settings (default). |
| Parquet directory | Separate `.parquet` files (`--bundled false`). |
| JSON + CSV | Legacy format (`--non-binary`). |

## Annotation Caching (`--keep-tmp`)

When `--keep-tmp` is enabled, annotations are stored as `all_annotations.parquet` in a per-dataset directory (keyed by a hash of the protein identifiers).

- **Fixed format**: The cache is always parquet with scores, regardless of `--non-binary` or `--no-scores`.
- **Incremental**: Only missing annotation sources are fetched on subsequent runs.
- **Reusable**: Switching `--no-scores` or `--non-binary` between runs reuses the same cache.

```bash
protspace-local -i data.h5 -a default --keep-tmp        # first run: fetches + caches
protspace-local -i data.h5 -a all --keep-tmp             # fetches only the delta
protspace-local -i data.h5 --dump-cache --keep-tmp       # inspect cache contents
```

See also: [Annotation Reference](annotations.md) | [Annotation Styling](styling.md)
