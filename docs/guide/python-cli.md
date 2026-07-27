# Using Python CLI

For local processing or automation, use the ProtSpace Python package. It turns embeddings,
sequences or a UniProt query into a `.parquetbundle` you can drag onto
[the explore page](/explore/index).

## Installation

```bash
pip install protspace

# optional: on-device embedding instead of the remote Biocentral API
pip install "protspace[local]"
```

## Commands

| Command              | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `protspace prepare`  | Full pipeline: embed → project → annotate → (stats) → bundle |
| `protspace embed`    | FASTA → per-model HDF5 embeddings                            |
| `protspace project`  | Embeddings → 2D/3D projections                               |
| `protspace annotate` | Fetch UniProt / InterPro / taxonomy annotations              |
| `protspace stats`    | Score projection quality (cluster validity + faithfulness)   |
| `protspace bundle`   | Merge projections + annotations → `.parquetbundle`           |
| `protspace transfer` | Fill missing annotations from nearest neighbours (EAT)       |
| `protspace style`    | Set colors, shapes and legend order on a bundle              |
| `protspace serve`    | Run a local viewer                                           |

Run `protspace <command> -h` for the built-in help of any command.

Most users only need `prepare`.

## Quick Start

### From a UniProt Query

```bash
protspace prepare -q "(ft_domain:kinase) AND (reviewed:true)" -e prot_t5 -m pca2,umap2 -o output
```

### From Local Embeddings

```bash
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output
```

### From a FASTA File

```bash
protspace prepare -i sequences.fasta -e prot_t5 -m pca2,umap2 -o output
```

## `protspace prepare`

Runs the whole pipeline in one step. Requires at least one of `-i/--input` or `-q/--query`.
Comma-separated arguments (`-e`, `-m`, `-a`) must not contain spaces.

```bash
# From HDF5 embeddings
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output

# From FASTA, auto-embed with two models
protspace prepare -i sequences.fasta -e prot_t5,esm2_650m -m pca2,umap2 -o output

# With sequence similarity (MMseqs2)
protspace prepare -i emb.h5 -f seq.fasta -s -m pca2,mds2 -o output

# External HDF5 without a model_name attribute, use colon syntax
protspace prepare -i external.h5:prot_t5 -m pca2 -o output

# Compare UMAP parameters in a single run
protspace prepare -i emb.h5 -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2 -o output
```

### Input

| Flag          | Description                                                                    | Default |
| ------------- | ------------------------------------------------------------------------------ | ------- |
| `-i, --input` | HDF5/FASTA file(s). Repeat for multi-embedding. Name override: `-i f.h5:name`. | -       |
| `-q, --query` | UniProt query (alternative to `-i`).                                           | -       |
| `-f, --fasta` | FASTA for `-s/--similarity` when the input is HDF5.                            | -       |

### Embedding

| Flag             | Description                                                                               | Default      |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------ |
| `-e, --embedder` | pLM model(s), comma-separated. See [Embedder models](#embedder-models).                   | `prot_t5`    |
| `-b, --backend`  | Embedding engine: `biocentral` (remote API) or `local` (on-device GPU/CPU).               | `biocentral` |
| `--batch-size`   | Sequences per batch. Backend default when unset: 1000 (Biocentral call) or 8 (local GPU). | -            |

`-e` requires FASTA input or `-q/--query`; it is rejected with HDF5-only input. When a FASTA is
given without `-e`, `prot_t5` is used.

### Projection

| Flag               | Description                                                                             | Default     |
| ------------------ | --------------------------------------------------------------------------------------- | ----------- |
| `-m, --methods`    | DR methods, comma-separated or repeated. See [Projection methods](#projection-methods). | `pca2`      |
| `-s, --similarity` | Also compute a sequence-similarity projection via MMseqs2.                              | off         |
| `--metric`         | Distance metric: `euclidean`, `cosine`, `manhattan`.                                    | `euclidean` |
| `--random-state`   | Random seed.                                                                            | `42`        |
| `--n-neighbors`    | UMAP/PaCMAP/LocalMAP neighbors (≥ 2). Larger = more global structure.                   | `25`        |
| `--min-dist`       | UMAP minimum distance (0.0–0.99).                                                       | `0.1`       |
| `--perplexity`     | t-SNE perplexity (≥ 5). Should be below `n_samples / 3`.                                | `30.0`      |
| `--learning-rate`  | t-SNE learning rate (≥ 1).                                                              | `200.0`     |
| `--mn-ratio`       | PaCMAP/LocalMAP mid-near ratio (0.0–1.0).                                               | `0.5`       |
| `--fp-ratio`       | PaCMAP/LocalMAP further ratio.                                                          | `2.0`       |
| `--n-init`         | MDS initializations.                                                                    | `4`         |
| `--max-iter`       | MDS maximum iterations.                                                                 | `300`       |
| `--eps`            | MDS convergence tolerance.                                                              | `0.001`     |

### Annotations

| Flag                     | Description                                                         | Default   |
| ------------------------ | ------------------------------------------------------------------- | --------- |
| `-a, --annotations`      | Annotation groups, individual names, or a CSV/TSV path. Repeatable. | `default` |
| `--scores / --no-scores` | Include annotation confidence scores.                               | on        |

### Output

| Flag                         | Description                                                                                                                                                                  | Default |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `-o, --output`               | Output directory.                                                                                                                                                            | `.`     |
| `--bundled / --no-bundled`   | Bundle into a single `.parquetbundle`.                                                                                                                                       | bundled |
| `--stats / --no-stats`       | Compute projection quality statistics. See [Projection statistics](#projection-statistics).                                                                                  | off     |
| `--cluster-selection`        | With `--stats`, how to choose the cluster count K: `elbow`, `silhouette`, or `both`.                                                                                         | `elbow` |
| `--stats-annotation`         | With `--stats`, which annotation column(s) to score: `auto` or a comma-separated list.                                                                                       | `auto`  |
| `--refetch`                  | Recompute stages (comma-separated): `query`, `embed`, `similarity`, `projections`, `uniprot`, `taxonomy`, `interpro`, `ted`, `biocentral`. Shorthands: `all`, `annotations`. | off     |
| `--keep-tmp / --no-keep-tmp` | Cache intermediates in `{output}/tmp/` for resumability.                                                                                                                     | on      |
| `--dump-cache`               | Print cached annotations and exit.                                                                                                                                           | off     |
| `--no-log`                   | Skip writing `run.log` to the output directory.                                                                                                                              | off     |
| `-v, --verbose`              | Verbosity: `-v` = INFO, `-vv` = DEBUG.                                                                                                                                       | -       |

::: info Statistics table is not yet shown in the web app
A `--stats` bundle has five parts and **opens** in the web app: the loader reads the core data and
settings and ignores the trailing statistics table. Rendering that table in-app is a separate
follow-up.

The faithfulness metrics show regardless: they travel in the projection metadata
(`info_json.quality`) and render in the Projection Metadata panel. See
[Data Format Reference](/guide/data-format#statistics-optional-5th-part) for the bundle-parts
details.
:::

## Projection Methods

Methods require a dimension suffix: `2` for 2D, `3` for 3D.

::: warning Dimension Suffix Required
Specify `pca2` or `pca3`, not `pca` alone, the dimension suffix is mandatory.
:::

| Method   | 2D          | 3D          | Description                            |
| -------- | ----------- | ----------- | -------------------------------------- |
| PCA      | `pca2`      | `pca3`      | Principal Component Analysis           |
| UMAP     | `umap2`     | `umap3`     | Uniform Manifold Approximation         |
| t-SNE    | `tsne2`     | `tsne3`     | t-distributed Stochastic Neighbor Emb. |
| PaCMAP   | `pacmap2`   | `pacmap3`   | Pairwise Controlled Manifold Approx.   |
| MDS      | `mds2`      | `mds3`      | Multidimensional Scaling               |
| LocalMAP | `localmap2` | `localmap3` | Local-first alternative to PaCMAP      |

::: tip
The web app renders 2D projections, prefer `*2` methods. 3D projections are viewable with
`protspace serve`.
:::

### Inline parameter overrides

`-m` accepts per-method overrides as semicolon-separated `key=value` pairs. The same keys exist as
global flags; an inline override only affects that one method.

```bash
-m "umap2:n_neighbors=50;min_dist=0.1" -m "tsne2:perplexity=50"
```

| Key             | Abbrev | Type  | Used by                                  |
| --------------- | ------ | ----- | ---------------------------------------- |
| `n_neighbors`   | `n`    | int   | UMAP, PaCMAP, LocalMAP                   |
| `min_dist`      | `d`    | float | UMAP                                     |
| `perplexity`    | `p`    | float | t-SNE                                    |
| `learning_rate` | `lr`   | float | t-SNE                                    |
| `mn_ratio`      | `mn`   | float | PaCMAP, LocalMAP                         |
| `fp_ratio`      | `fp`   | float | PaCMAP, LocalMAP                         |
| `metric`        | `m`    | str   | All (`euclidean`, `cosine`, `manhattan`) |
| `random_state`  | `rs`   | int   | All                                      |
| `n_init`        | `ni`   | int   | MDS                                      |
| `max_iter`      | `mi`   | int   | MDS                                      |
| `eps`           | `e`    | float | MDS                                      |

### Projection naming

Projections are prefixed with their embedding source: `ESM2-650M — PCA 2`, `ProtT5 — UMAP 2`,
`MMseqs2 — MDS 2`.

When the same method and dimension count appears more than once in a run with different inline
overrides, the differing parameters are appended in parentheses using the abbreviations above. So

```bash
protspace prepare -i emb.h5 \
  -m "umap2:n_neighbors=15" \
  -m "umap2:n_neighbors=50;min_dist=0.05" \
  -m pca2 \
  -o output
```

produces `ProtT5 — PCA 2`, `ProtT5 — UMAP 2 (n=15)` and `ProtT5 — UMAP 2 (d=0.05, n=50)`. A plain
`umap2` with no overrides keeps the unsuffixed name.

## Embedder Models

When the input is a FASTA file or a UniProt query, `-e` selects the protein language model used to
embed the sequences.

```bash
protspace prepare -i sequences.fasta -e prot_t5 -m pca2,umap2 -o output
```

Available shortcuts: `prot_t5`, `prost_t5`, `esm2_8m`, `esm2_35m`, `esm2_150m`, `esm2_650m`,
`esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`

::: warning Licensing
`ankh_base`, `ankh_large` and `ankh3_large` are CC-BY-NC-SA-4.0; `esmc_600m` is Cambrian
Non-Commercial. All other models are permissively licensed.
:::

### Local backend

`--backend local` computes embeddings on a local GPU/CPU via HuggingFace `transformers` instead of
the remote [Biocentral](https://biocentral.rostlab.org) API, useful when the API is unavailable or
when you are working offline. It needs the extra: `pip install "protspace[local]"`.

```bash
protspace prepare -i sequences.fasta -e prot_t5 --backend local -m pca2 -o output
```

## Annotations

Specify annotation sources with `-a`. The flag is repeatable and each value may be a group name, an
individual annotation name, or a path to a CSV/TSV file.

```bash
# Use a predefined group
-a default        # EC, keyword, length, protein_families, reviewed
-a all            # Everything from all sources

# Pick individual sources
-a uniprot -a interpro -a taxonomy -a ted -a biocentral

# Or pick individual annotation names
-a protein_families,reviewed,pfam,genus,species

# Or provide a CSV/TSV file
-a annotations.csv
```

| Group        | Source annotations                                                      |
| ------------ | ----------------------------------------------------------------------- |
| `default`    | EC, keyword, length, protein_families, reviewed                         |
| `uniprot`    | Gene name, EC, GO terms, subcellular location, length, and more         |
| `interpro`   | Pfam, CATH, SMART, CDD, Panther, Superfamily, and more                  |
| `taxonomy`   | Kingdom, phylum, class, order, family, genus, species                   |
| `ted`        | AlphaFold TED domain annotations                                        |
| `biocentral` | Predicted membrane, signal peptide, transmembrane, subcellular location |
| `all`        | All of the above                                                        |

See the [Annotation Reference](/guide/annotations) for what each individual column contains.

`gene_name`, `protein_name` and `uniprot_kb_id` are **always included**, they are fetched
regardless of what you pass to `-a`.

### Input requirements

Annotation sources differ in what they need to identify a protein:

| Requirement           | Sources                          | Works with `-f` FASTA? |
| --------------------- | -------------------------------- | ---------------------- |
| **UniProt accession** | UniProt, taxonomy, TED           | No, accession needed   |
| **Protein sequence**  | InterPro, Biocentral, Pfam clans | Yes, provide `-f`      |

If your H5 keys are not valid UniProt accessions (for example `NCBI|...` or custom IDs), the
accession-dependent annotations come back empty. Sequence-dependent annotations still work if you
pass the original FASTA with `-f`.

### Custom CSV annotations

```csv
identifier,taxonomy,family,function
P12345,Bacteria,Kinase,ATP binding
P67890,Archaea,Phosphatase,Hydrolase
Q54321,Eukaryota,Kinase,Transferase
```

The `identifier` column must match the protein IDs in your embeddings file.

On column name collisions, CSV values take precedence over the fetched ones. With `--keep-tmp`,
only API-fetched annotations are cached, the CSV is always re-read fresh.

## Combining Multiple Inputs

When several `-i` inputs are given, the behaviour depends on whether they share an embedding name:

- **Same embedding name** → proteins are **unioned**. Use this to combine datasets (for example two
  species both embedded with ProtT5).
- **Different embedding names** → proteins are **intersected**. Use this to compare embeddings on the
  same proteins.

```bash
# Union: combine two species into one visualization
protspace prepare -i human.h5:prot_t5 -i drosophila.h5:prot_t5 -m umap2 -o output

# Intersection: compare embeddings on shared proteins
protspace prepare -i prot_t5.h5 -i esm2_650m.h5 -m pca2 -o output
```

Duplicate proteins across same-name inputs are deduplicated when their embeddings match within
tolerance; conflicting embeddings for the same protein ID raise an error.

## Model Name Resolution (`-i file.h5:name`)

HDF5 files need a model name for projection labels. It is resolved in this order:

1. **Colon syntax**, `-i file.h5:prot_t5` (highest priority)
2. **HDF5 attribute**, `model_name` in the root attributes, set automatically by
   `protspace embed`/`prepare`
3. **Error**, the command exits with a copy-pasteable fix

Use the colon syntax for HDF5 files created outside ProtSpace (bio_embeddings, custom scripts,
Colab). Files produced by `protspace embed`/`prepare` already carry the attribute.

```bash
# External files, need colon syntax
protspace prepare -i my_embeddings.h5:prot_t5 -m pca2 -o output

# ProtSpace-generated files, just work
protspace prepare -i embeddings/prot_t5.h5 -m pca2 -o output
```

Check whether a file has the attribute:

```bash
python -c "import h5py; print(dict(h5py.File('file.h5','r').attrs))"
```

## Intermediate Caching

With `--keep-tmp` (the default), intermediate results are cached in `{output}/tmp/` and reused on
subsequent runs:

| Cached item       | File                                    | Reuse behavior                  |
| ----------------- | --------------------------------------- | ------------------------------- |
| FASTA sequences   | `sequences.fasta`                       | Skip the UniProt query download |
| Embeddings        | `{embedder}.h5`                         | Skip already-embedded proteins  |
| Annotations       | `all_annotations.parquet`               | Fetch only missing sources      |
| Similarity matrix | `similarity_matrix.npy`                 | Skip MMseqs2 recomputation      |
| DR projections    | `proj_{name}_{method}{dims}_{hash}.npz` | Skip dimensionality reduction   |

Projection caches are keyed by embedding name, method, dimensions and every parameter, so changing
any parameter creates a new entry. Use `--refetch all` to bypass all caches, or `--refetch <stages>`
selectively (for example `--refetch ted,biocentral`).

### Annotation name caches

Separate from `{output}/tmp/`, the reference name lookups used to make annotation IDs
human-readable are cached under your home directory and shared across all runs:

| Cache          | Location                         | Max age | Purpose                                              |
| -------------- | -------------------------------- | ------- | ---------------------------------------------------- |
| CATH names     | `~/.cache/protspace/cath/`       | 30 days | CATH hierarchy names, used by `cath` and TED domains |
| InterPro names | `~/.cache/protspace/interpro/`   | 7 days  | Entry names for `superfamily` and `panther`          |
| EC names       | `~/.cache/protspace/enzyme/`     | 7 days  | Enzyme descriptions from ExPASy                      |
| Pfam clans     | `~/.cache/protspace/pfam_clans/` | 30 days | Pfam family → clan mapping                           |

These are refreshed automatically once they expire; delete a directory to force a re-download. The
`default` annotation group only needs the UniProt REST API plus ExPASy for EC names.

## `protspace embed`

FASTA → one HDF5 file per model, with `model_name` written to the H5 root attributes.

```bash
# Remote Biocentral API (default)
protspace embed -i sequences.fasta -e prot_t5 -e esm2_3b -o embeddings/

# On-device GPU/CPU, works offline
protspace embed -i sequences.fasta -e prot_t5 -o embeddings/ --backend local
```

`-i`, `-e` and `-o` are required. `--backend` and `--batch-size` behave as in `prepare`.

## `protspace project`

Run dimensionality reduction on existing HDF5 embeddings. Writes
`projections_metadata.parquet` and `projections_data.parquet` to the output directory.

```bash
protspace project -i embeddings/prot_t5.h5 -i embeddings/esm2_3b.h5 -m pca2,umap2 -o projections/
```

Accepts the same projection flags as `prepare`, plus `-f/--fasta` for `-s/--similarity`.

## `protspace annotate`

Extract protein identifiers from an HDF5 or FASTA file and fetch their annotations.

```bash
protspace annotate -i embeddings/prot_t5.h5 -a default -o annotations.parquet
```

| Flag                     | Description                           | Default               |
| ------------------------ | ------------------------------------- | --------------------- |
| `-i, --input`            | HDF5 or FASTA file (required).        | -                     |
| `-a, --annotations`      | Annotation sources (repeatable).      | `default`             |
| `-o, --output`           | Output parquet path.                  | `annotations.parquet` |
| `--scores / --no-scores` | Include annotation confidence scores. | on                    |

## `protspace stats`

Score the quality of the projections in an existing project directory and write them as a
`statistics.parquet`, the optional fifth part of a
[`.parquetbundle`](/guide/data-format).

Folding it in with `bundle -s` produces a five-part bundle that **opens** in the web app: the loader
ignores the statistics table, which is not rendered in-app yet. The faithfulness metrics ride in the
projection metadata (`info_json.quality`) and render in the Projection Metadata panel either way. See
[Data Format Reference](/guide/data-format#statistics-optional-5th-part).

```bash
# Faithfulness only (no annotations needed)
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet

# Also score annotation-based validity and emit cluster legend styles
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --settings-out cluster_styles.json

# Score only specific annotations
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --stats-annotation major_group,ec_number
```

| Flag                  | Description                                                                                         | Default     |
| --------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| `-i, --input`         | HDF5 embedding file(s), required. Repeatable; `-i file.h5:name` to override the name.               | -           |
| `-p, --projections`   | Directory with `projections_metadata.parquet` and `projections_data.parquet`, required.             | -           |
| `-o, --output`        | Output `statistics.parquet` path, required.                                                         | -           |
| `-a, --annotations`   | Annotations parquet to enrich in place with per-protein cluster-membership columns and to score.    | -           |
| `--settings-out`      | Write auto-generated cluster legend styles here (JSON) for `bundle --settings`. Requires `-a`.      | -           |
| `--cluster-selection` | How to choose the cluster count K: `elbow`, `silhouette`, or `both`.                                | `elbow`     |
| `--stats-annotation`  | Which annotation column(s) to score: `auto` or a comma-separated list. Requires `-a`.               | `auto`      |
| `--metric`            | High-dimensional distance metric for faithfulness when the projection metadata omits one (PCA/MDS). | `euclidean` |
| `--seed`              | Random seed.                                                                                        | `42`        |

### Projection statistics

`protspace stats` and `prepare --stats` compute three families of metrics:

- **Annotation-based validity**, silhouette, Davies–Bouldin and Calinski–Harabasz scored on an
  annotation's own category labels, computed once for the source embedding (a separability ceiling)
  and again for each projection. Rows land in `statistics.parquet` with
  `space_kind ∈ {embedding, projection}` and an `annotation` column. Requires `-a`.
- **Auto-cluster agreement**, KMeans labels the projection, with K chosen by the inertia elbow
  and/or maximum silhouette. Each selection becomes a per-protein membership column
  (`cluster_elbow_<projection>`, `cluster_silhouette_<projection>`) whose value carries the
  per-point silhouette as `cluster N|<silhouette>`, and its ARI/NMI agreement with each scored
  annotation is recorded as `stat_family=cluster_agreement`.
- **Faithfulness**, how well the projection preserves the embedding's structure: kNN-overlap,
  trustworthiness and continuity (local), plus random-triplet accuracy and Spearman distance
  correlation (global). These ride in each projection's `info_json.quality`, not in
  `statistics.parquet`.

Statistics are opt-in because the extra compute can be slow on large runs. A failure for one metric
or projection is logged and skipped rather than failing the run, and the heavier metrics are
subsampled with a deterministic seed at scale.

## `protspace bundle`

Merge projections and annotations into a single `.parquetbundle`, optionally folding in a statistics
parquet as the fifth part and a settings JSON as the fourth.

```bash
protspace bundle -p projections/ -a annotations.parquet -o output.parquetbundle

# With projection statistics and auto-generated cluster legend styles
protspace bundle -p projections/ -a annotations.parquet \
  -s statistics.parquet --settings cluster_styles.json -o output.parquetbundle
```

| Flag                | Description                                                      | Default |
| ------------------- | ---------------------------------------------------------------- | ------- |
| `-p, --projections` | Directory with the projection parquet files, required.           | -       |
| `-a, --annotations` | Annotations parquet file, required.                              | -       |
| `-o, --output`      | Output `.parquetbundle` path, required.                          | -       |
| `-s, --statistics`  | Projection-statistics parquet → fifth bundle part.               | -       |
| `--settings`        | Settings JSON (for example cluster legend styles) → fourth part. | -       |

::: info `-s` adds a statistics table not yet shown in the web app
A bundle written with statistics has five parts and **opens** in the web app: the loader ignores the
statistics table, which is not rendered in-app yet. The projection faithfulness metrics computed by
`protspace stats` ride in the projection metadata (`info_json.quality`) and render in the
Projection Metadata panel either way. See
[Data Format Reference](/guide/data-format#statistics-optional-5th-part).
:::

## `protspace transfer`

Embedding Annotation Transfer (EAT): fill missing annotation values for query proteins by
transferring the annotation of the nearest annotated reference protein in embedding space. For every
query protein with no value in the requested column, the command finds the closest reference by
distance in the original high-dimensional embedding space, not in the 2D/3D projection, and copies
that label along with a reliability index in [0, 1].

The curated source column (`COL`) is left untouched; three new columns are written:
`COL__pred_value` (string), `COL__pred_confidence` (float) and `COL__pred_source` (string, the
reference protein the label came from, for provenance).

```bash
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin'
```

| Flag                    | Description                                                            | Default  |
| ----------------------- | ---------------------------------------------------------------------- | -------- |
| `-b, --bundle`          | Input `.parquetbundle`, required.                                      | -        |
| `-e, --embeddings`      | HDF5 embeddings; `:name` suffix for external files. Required.          | -        |
| `-t, --transfer`        | Annotation column to transfer (repeatable), required.                  | -        |
| `-o, --output`          | Output `.parquetbundle` (may overwrite the input), required.           | -        |
| `--k`                   | Number of nearest neighbours considered.                               | `1`      |
| `--metric`              | Distance metric: `cosine` or `euclidean`.                              | `cosine` |
| `--query-id-prefix`     | Only transfer to query IDs with this prefix (repeatable).              | -        |
| `--query-where`         | Restrict queries to rows where `col` contains `substr` (`col~substr`). | -        |
| `--reference-id-prefix` | Only use references whose ID has this prefix (repeatable).             | -        |
| `--reference-where`     | Restrict references the same way (`col~substr`).                       | -        |

### Reliability index

The exact form of `COL__pred_confidence` depends on `--metric` and `--k`:

- **`--metric cosine` (default), `--k 1`**: `confidence = clamp(1 - cosine_distance, 0, 1)`, where
  the cosine distance lies in [0, 2]. Cosine is the default because this value is bounded and
  directly interpretable as a cosine similarity.
- **`--metric euclidean`, `--k 1`**: `confidence = 0.5 / (0.5 + distance)` (1 at distance 0, 0.5 at
  distance 0.5, → 0 as distance grows). This is the published goPredSim transform, calibrated for
  ProtT5, so on embedding spaces with much larger raw distances treat it as a ranking rather than a
  calibrated probability.
- **`--k > 1`**, the mean reliability: the per-neighbour similarity above summed over the `k`
  nearest neighbours carrying the chosen label, divided by `min(k, number of references)`. Because
  of this normalization, confidences are **not** comparable across different `--k` values.

A non-finite distance maps to a confidence of 0, so an invalid neighbour never scores highly.

The method follows Littmann et al., Sci Rep 2021
([DOI 10.1038/s41598-020-80786-0](https://doi.org/10.1038/s41598-020-80786-0)) and Heinzinger et
al., NAR Genom Bioinform 2022 ([DOI 10.1093/nargab/lqac043](https://doi.org/10.1093/nargab/lqac043)).

## `protspace style`

Set colors, shapes and legend order on an existing bundle. See
[Annotation Styling](/guide/styling) for the styles-JSON format.

```bash
protspace style data.parquetbundle --generate-template > styles.json
protspace style input.parquetbundle output.parquetbundle --annotation-styles styles.json
protspace style data.parquetbundle --dump-settings
```

| Flag                  | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `--annotation-styles` | Styles as an inline JSON string or a path to a JSON file.         |
| `--generate-template` | Print a pre-filled template (values in frequency order) and exit. |
| `--dump-settings`     | Print the stored settings and exit.                               |

The output path is only required when you are writing styles, not for `--dump-settings` or
`--generate-template`.

## `protspace serve`

Run a local Dash viewer. Most users should explore bundles in the hosted viewer at
[protspace.app/explore](https://protspace.app/explore), nothing to install, and drag & drop works.
Use `serve` for offline viewing; it also renders 3D projections.

```bash
protspace serve output.parquetbundle --port 8050 --pdb-zip structures.zip
```

| Flag        | Description                         | Default |
| ----------- | ----------------------------------- | ------- |
| `--port`    | Port to run the server on.          | `8050`  |
| `--pdb-zip` | ZIP file containing PDB structures. | -       |

## See Also

- [Data Format Reference](/guide/data-format), what is inside a `.parquetbundle`
- [Annotation Reference](/guide/annotations), every annotation column ProtSpace can fetch
- [Annotation Styling](/guide/styling), colors, shapes, palettes and legend order
