# CLI Reference

ProtSpace provides a unified CLI with subcommands:

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `protspace prepare`  | Full pipeline: embed → reduce → annotate → bundle     |
| `protspace embed`    | Generate embeddings from FASTA via Biocentral API     |
| `protspace project`  | Dimensionality reduction on HDF5 embeddings           |
| `protspace annotate` | Fetch protein annotations from databases              |
| `protspace bundle`   | Combine projections + annotations into .parquetbundle |
| `protspace serve`    | Launch interactive Dash web frontend                  |
| `protspace style`    | Add/inspect annotation styles in existing files       |

Run `protspace <command> -h` for detailed help on any command.

## `protspace prepare`

Full pipeline: load embeddings or FASTA, perform dimensionality reduction,
fetch annotations, and create a `.parquetbundle` for [protspace.app](https://protspace.app).

```bash
# From HDF5 embeddings
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output

# From FASTA (embed + reduce)
protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output

# Multi-model from FASTA
protspace prepare -i sequences.fasta -e prot_t5,esm2_3b -m pca2,umap2 -o output

# Multi-embedding from HDF5
protspace prepare -i esm2.h5 -i prott5.h5 -m pca2 -o output

# UniProt query
protspace prepare -q "organism_name:\"Homo sapiens\" AND reviewed:true" -m pca2 -o output

# With sequence similarity
protspace prepare -i embeddings.h5 -f sequences.fasta -s -m pca2,mds2 -o output
```

### Options

#### Input

| Flag          | Description                                                                                                    | Default |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `-i, --input` | HDF5 or FASTA file(s). Repeat for multi-embedding. Use colon syntax for name override: `-i file.h5:model_name` | —       |
| `-q, --query` | UniProt search query (alternative to -i).                                                                      | —       |
| `-f, --fasta` | FASTA for similarity computation (required with -s when input is HDF5).                                        | —       |

#### Embedding

| Flag                | Description                                             | Default   |
| ------------------- | ------------------------------------------------------- | --------- |
| `-e, --embedder`    | Biocentral model shortcut (repeatable for multi-model). | `prot_t5` |
| `--batch-size`      | Sequences per API call.                                 | `1000`    |
| `--embedding-cache` | Override HDF5 cache path.                               | —         |
| `--probe`           | Test embedder with 2 sequences, then exit.              | off       |
| `--dry-run`         | Parse input and print stats, then exit.                 | off       |

**Available embedders:** `prot_t5`, `prost_t5`, `esm2_8m`, `esm2_35m`, `esm2_150m`, `esm2_650m`, `esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`

> **Licensing:** `ankh_base`, `ankh_large`, `ankh3_large` are CC-BY-NC-SA-4.0 (non-commercial). `esmc_600m` is under the Cambrian Non-Commercial License. `esmc_300m` is under the Cambrian Open License (commercial OK). All ESM2 and ProtT5/ProstT5 models are permissively licensed.

#### Projection

| Flag               | Description                                                                             | Default     |
| ------------------ | --------------------------------------------------------------------------------------- | ----------- |
| `-m, --methods`    | DR methods (comma-separated): `pca2`, `umap2`, `tsne2`, `pacmap2`, `mds2`, `localmap2`. | `pca2`      |
| `-s, --similarity` | Also compute sequence similarity DR from FASTA.                                         | off         |
| `--metric`         | Distance metric (`euclidean`, `cosine`, `manhattan`, ...).                              | `euclidean` |
| `--random-state`   | Random seed for reproducibility.                                                        | `42`        |
| `--n-neighbors`    | Neighbors for UMAP/PaCMAP/LocalMAP (5-50).                                              | `15`        |
| `--min-dist`       | UMAP min distance (0.0-0.99).                                                           | `0.1`       |
| `--perplexity`     | t-SNE perplexity (5-50).                                                                | `30`        |
| `--learning-rate`  | t-SNE learning rate (10-1000).                                                          | `200`       |
| `--mn-ratio`       | PaCMAP mid-near pairs ratio (0.1-1.0).                                                  | `0.5`       |
| `--fp-ratio`       | PaCMAP further pairs ratio (1.0-3.0).                                                   | `2.0`       |
| `--n-init`         | MDS initialization count (1-10).                                                        | `4`         |
| `--max-iter`       | MDS max iterations (100-1000).                                                          | `300`       |
| `--eps`            | MDS convergence tolerance.                                                              | `1e-3`      |

#### Annotations

| Flag                     | Description                                                  | Default   |
| ------------------------ | ------------------------------------------------------------ | --------- |
| `-a, --annotations`      | Annotation sources (repeatable): groups or individual names. | `default` |
| `--scores / --no-scores` | Include annotation confidence scores.                        | on        |
| `--force-refetch`        | Force re-download even if cached.                            | off       |

#### Output

| Flag                       | Description                                        | Default            |
| -------------------------- | -------------------------------------------------- | ------------------ |
| `-o, --output`             | Output file or directory path.                     | derived from input |
| `--bundled / --no-bundled` | Bundle into single `.parquetbundle`.               | bundled            |
| `--keep-tmp`               | Cache intermediate files for reuse.                | off                |
| `--custom-names`           | Rename projections: `"pca2=My PCA,umap2=My UMAP"`. | —                  |
| `--dump-cache`             | Print cached annotations and exit.                 | off                |

## `protspace embed`

Generate protein embeddings from a FASTA file via the Biocentral API.

```bash
protspace embed -i sequences.fasta -e prot_t5 -e esm2_3b -o embeddings/
```

Creates one HDF5 file per model with `model_name` written to root attributes.

## `protspace project`

Run dimensionality reduction on HDF5 embeddings.

```bash
protspace project -i embeddings/prot_t5.h5 -i embeddings/esm2_3b.h5 -m pca2,umap2 -o projections/
```

Outputs `projections_metadata.parquet` and `projections_data.parquet`.

## `protspace annotate`

Fetch protein annotations from UniProt, InterPro, and taxonomy databases.

```bash
protspace annotate -i embeddings/prot_t5.h5 -a default -o annotations.parquet
```

## `protspace bundle`

Combine projection and annotation parquet files into a `.parquetbundle`.

```bash
protspace bundle -p projections/ -a annotations.parquet -o output.parquetbundle
```

## `protspace serve`

Launch the Dash web frontend for interactive visualization.

```bash
protspace serve output.parquetbundle
```

## `protspace style`

Add custom colors, shapes, legend ordering, and display settings. See [Annotation Styling](styling.md).

```bash
protspace style data.parquetbundle --generate-template > styles.json
protspace style input.parquetbundle output.parquetbundle --annotation-styles styles.json
protspace style data.parquetbundle --dump-settings
```

## Projection Naming

All projection names are prefixed with the embedding source:

- PLM embeddings: `esm2_3b — PCA_2`, `prot_t5 — UMAP_2`
- Sequence similarity: `MMseqs2 — MDS_2`

## Model Name Resolution

The PLM name for projection prefixes is resolved in order:

1. **HDF5 root attribute** `model_name` (set automatically when embedding via ProtSpace)
2. **CLI colon syntax**: `-i file.h5:model_name`
3. Error if neither is found

## Annotation Caching (`--keep-tmp`)

When `--keep-tmp` is enabled, annotations are cached as `all_annotations.parquet` in a per-dataset directory.

- **Fixed format**: Cache is always parquet with scores, regardless of `--no-scores`.
- **Incremental**: Only missing annotation sources are fetched on subsequent runs.
- **Reusable**: Switching `--no-scores` between runs reuses the same cache.

See also: [Annotation Reference](annotations.md) | [Annotation Styling](styling.md)
