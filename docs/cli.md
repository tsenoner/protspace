# CLI Reference

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `protspace prepare`  | Full pipeline: embed → reduce → annotate → bundle     |
| `protspace embed`    | Generate embeddings from FASTA via Biocentral API     |
| `protspace project`  | Dimensionality reduction on HDF5 embeddings           |
| `protspace annotate` | Fetch protein annotations from databases              |
| `protspace bundle`   | Combine projections + annotations into .parquetbundle |
| `protspace serve`    | Launch interactive Dash web frontend                  |
| `protspace style`    | Add/inspect annotation styles in existing files       |

Run `protspace <command> -h` for detailed help.

## `protspace prepare`

Full pipeline: load protein embeddings (from HDF5, FASTA, or UniProt query), run dimensionality reduction, fetch biological annotations, and create a `.parquetbundle` for visualization at [protspace.app](https://protspace.app).

Accepts three input types:
- **HDF5 files** (`-i`) — pre-computed embeddings from any pLM
- **FASTA files** (`-i` + `-e`) — sequences are embedded on-the-fly via the Biocentral API
- **UniProt queries** (`-q` + `-e`) — sequences are fetched from UniProt, then embedded

```bash
# From HDF5 embeddings
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output

# From FASTA — auto-embed with two models
protspace prepare -i sequences.fasta -e prot_t5,esm2_650m -m pca2,umap2 -o output

# From UniProt query
protspace prepare -q "(family:phosphatase) AND (reviewed:true)" -e prot_t5 -m pca2 -o output

# With sequence similarity (MMseqs2)
protspace prepare -i emb.h5 -f seq.fasta -s -m pca2,mds2 -o output

# External HDF5 without model_name attribute — use colon syntax
protspace prepare -i external.h5:prot_t5 -m pca2 -o output

# Compare UMAP with different parameters in a single run
protspace prepare -i emb.h5 -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2 -o output

# Inline params with semicolons, comma-separated methods
protspace prepare -i emb.h5 -m "pca2,umap2:n_neighbors=50;min_dist=0.3,tsne2" -o output
```

### Options

#### Input

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-i, --input` | HDF5 or FASTA file(s). Repeat for multi-embedding or to combine datasets. Use `-i file.h5:name` for external HDF5 files (see [Model Name Resolution](#model-name-resolution--i-fileh5name)). | — |
| `-q, --query` | UniProt search query (alternative to -i). | — |
| `-f, --fasta` | FASTA for similarity computation (with -s when input is HDF5). | — |

#### Embedding

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-e, --embedder` | Biocentral model shortcut (comma-separated for multi-model). | `prot_t5` |
| `--batch-size` | Sequences per API call. | `1000` |

**Available embedders:** `prot_t5`, `prost_t5`, `esm2_8m`, `esm2_35m`, `esm2_150m`, `esm2_650m`, `esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`

> **Licensing:** `ankh_base`, `ankh_large`, `ankh3_large` (CC-BY-NC-SA-4.0), `esmc_600m` (Cambrian Non-Commercial). All others are permissively licensed.

#### Projection

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-m, --methods` | DR methods (comma-sep or repeat). Inline params: `-m 'umap2:n_neighbors=50;min_dist=0.1'`. Methods: `pca2`, `umap2`, `tsne2`, `pacmap2`, `mds2`, `localmap2` | `pca2` |
| `-s, --similarity` | Also compute sequence similarity DR from FASTA. | off |
| `--metric` | Distance metric (`euclidean`, `cosine`, `manhattan`). | `euclidean` |
| `--random-state` | Random seed. | `42` |
| `--n-neighbors` | UMAP/PaCMAP/LocalMAP neighbors. | `25` |
| `--min-dist` | UMAP min distance (0.0–0.99). | `0.1` |
| `--perplexity` | t-SNE perplexity. | `30` |
| `--learning-rate` | t-SNE learning rate. | `200` |
| `--mn-ratio` | PaCMAP/LocalMAP mid-near ratio. | `0.5` |
| `--fp-ratio` | PaCMAP/LocalMAP further ratio. | `2.0` |
| `--n-init` | MDS initializations. | `4` |
| `--max-iter` | MDS max iterations. | `300` |
| `--eps` | MDS convergence tolerance. | `1e-3` |

#### Annotations

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-a, --annotations` | Annotation sources: groups, individual names, or a CSV/TSV file path. See [Annotation Reference](annotations.md). | `default` |
| `--scores / --no-scores` | Include annotation confidence scores. | on |
| `--refetch STAGES` | Recompute specific stages (comma-separated): query, embed, similarity, projections, uniprot, taxonomy, interpro, ted, biocentral. Shorthands: `all`, `annotations`. | off |

#### Output

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-o, --output` | Output directory. | `.` |
| `--bundled / --no-bundled` | Bundle into single `.parquetbundle`. | bundled |
| `--keep-tmp` | Cache intermediates for resumability. | on |
| `--no-log` | Skip writing `run.log`. | off |
| `--dump-cache` | Print cached annotations and exit. | off |

## `protspace embed`

Generate HDF5 embeddings from FASTA via the Biocentral API.

```bash
protspace embed -i sequences.fasta -e prot_t5 -e esm2_3b -o embeddings/
```

## `protspace project`

Run dimensionality reduction on HDF5 embeddings.

```bash
protspace project -i embeddings/prot_t5.h5 -i embeddings/esm2_3b.h5 -m pca2,umap2 -o projections/
```

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

Add custom colors, shapes, and display settings. See [Annotation Styling](styling.md).

```bash
protspace style data.parquetbundle --generate-template > styles.json
protspace style input.parquetbundle output.parquetbundle --annotation-styles styles.json
protspace style data.parquetbundle --dump-settings
```

## Combining Multiple Inputs (`-i`)

When multiple `-i` inputs are provided, behavior depends on whether they share the same embedding name:

- **Same embedding name** → proteins are **unioned** (concatenated). Use this to combine datasets (e.g., two species both embedded with ProtT5).
- **Different embedding names** → proteins are **intersected**. Use this for multi-embedding comparison (e.g., ProtT5 vs ESM2 on the same proteins).

```bash
# Union: combine two species into one visualization
protspace prepare -i human.h5:prot_t5 -i drosophila.h5:prot_t5 -m umap2 -o output

# Intersection: compare embeddings on shared proteins
protspace prepare -i prot_t5.h5 -i esm2_650m.h5 -m pca2 -o output
```

Duplicate proteins across same-name inputs are deduplicated if their embeddings match (within tolerance). Conflicting embeddings for the same protein ID raise an error.

## Projection Naming

Projections are prefixed with the embedding source: `ESM2-650M — PCA 2`, `ProtT5 — UMAP 2`, `MMseqs2 — MDS 2`.

## Model Name Resolution (`-i file.h5:name`)

HDF5 files need a model name for projection labels. Resolved in order:

1. **Colon syntax** — `-i file.h5:prot_t5` (highest priority)
2. **HDF5 attribute** — `model_name` in root attrs (auto-set by `protspace embed`/`prepare`)
3. **Error** — exits with a copy-pasteable fix command

Use the colon syntax for HDF5 files created outside protspace (bio_embeddings, custom scripts, Colab). Files from `protspace embed`/`prepare` already have the attribute.

```bash
# External files — need colon syntax
protspace prepare -i my_embeddings.h5:prot_t5 -m pca2 -o output
protspace prepare -i esm2.h5:esm2_650m -i prott5.h5:prot_t5 -m pca2 -o output

# Combine datasets — same name → union proteins
protspace prepare -i species_a.h5:prot_t5 -i species_b.h5:prot_t5 -m umap2 -o output

# Protspace-generated files — just work
protspace prepare -i embeddings/prot_t5.h5 -m pca2 -o output
```

Check if an HDF5 file has the attribute: `python -c "import h5py; print(dict(h5py.File('file.h5','r').attrs))"`

## Intermediate Caching (`--keep-tmp`)

With `--keep-tmp` (default), all intermediate results are cached in `{output}/tmp/` and reused on subsequent runs:

| Cached item | File | Reuse behavior |
| ----------- | ---- | -------------- |
| FASTA sequences | `sequences.fasta` | Skip UniProt query download |
| Embeddings | `{embedder}.h5` | Skip already-embedded proteins |
| Annotations | `all_annotations.parquet` | Fetch only missing annotation sources |
| Similarity matrix | `similarity_matrix.npy` | Skip MMseqs2 recomputation |
| DR projections | `proj_{name}_{method}_{hash}.npz` | Skip dimensionality reduction |

- Annotation cache always includes scores regardless of `--no-scores`
- DR projection caches are keyed by embedding name, method, dimensions, and all parameters — changing any parameter creates a new cache entry
- Use `--refetch all` to bypass all caches, or `--refetch <stages>` selectively (e.g., `--refetch ted,biocentral`)

See also: [Annotation Reference](annotations.md) | [Annotation Styling](styling.md)
