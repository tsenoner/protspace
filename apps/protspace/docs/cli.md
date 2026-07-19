# CLI Reference

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `protspace prepare`  | Full pipeline: embed → reduce → annotate → bundle     |
| `protspace embed`    | Generate embeddings from FASTA via Biocentral API     |
| `protspace project`  | Dimensionality reduction on HDF5 embeddings           |
| `protspace annotate` | Fetch protein annotations from databases              |
| `protspace bundle`   | Combine projections + annotations into .parquetbundle |
| `protspace stats`    | Compute projection quality statistics for a project   |
| `protspace serve`    | Launch interactive Dash web frontend                  |
| `protspace style`    | Add/inspect annotation styles in existing files       |
| `protspace transfer` | Fill missing annotations from nearest reference embeddings (EAT) |

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
| `-e, --embedder` | Model shortcut (comma-separated for multi-model). | `prot_t5` |
| `-b, --backend` | Embedding engine: `biocentral` (remote API) or `local` (on-device GPU/CPU). | `biocentral` |
| `--batch-size` | Sequences per batch. Backend default when unset: 1000 (API call) or 8 (local GPU micro-batch). | — |

**Available embedders:** `prot_t5`, `prost_t5`, `esm2_8m`, `esm2_35m`, `esm2_150m`, `esm2_650m`, `esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`

> **Licensing:** `ankh_base`, `ankh_large`, `ankh3_large` (CC-BY-NC-SA-4.0), `esmc_600m` (Cambrian Non-Commercial). All others are permissively licensed.

> **Local backend (`--backend local`):** computes embeddings on a local GPU/CPU via HuggingFace `transformers` instead of the remote Biocentral API — useful when the API is unavailable, or in Colab. Requires the extra: `pip install "protspace[local]"`. ESM-C uses the Synthyra ESM++ checkpoints for consistency with the API path. `esm2_3b` may exceed a free Colab T4 (16 GB) — prefer an L4/A100 runtime for it.

#### Projection

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-m, --methods` | DR methods. Repeat the flag or use commas to combine methods (`-m pca2,umap2`); use semicolons to inline parameter overrides for one method (`-m 'umap2:n_neighbors=50;min_dist=0.1'`). See [Overridable parameters](#overridable-parameters-with--m) for the supported keys. Methods: `pca2`, `umap2`, `tsne2`, `pacmap2`, `mds2`, `localmap2`. | `pca2` |
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

##### Overridable parameters (with `-m`)

`-m` accepts inline overrides per method using `key=value` pairs (semicolon-separated). The same keys are also available as global flags above; an inline override only affects that method's projection.

| Key | Abbrev | Type | Used by |
| --- | ------ | ---- | ------- |
| `n_neighbors` | `n` | int | UMAP, PaCMAP, LocalMAP |
| `min_dist` | `d` | float | UMAP |
| `perplexity` | `p` | int | t-SNE |
| `learning_rate` | `lr` | int | t-SNE |
| `mn_ratio` | `mn` | float | PaCMAP, LocalMAP |
| `fp_ratio` | `fp` | float | PaCMAP, LocalMAP |
| `metric` | `m` | str | All (`euclidean`, `cosine`, `manhattan`) |
| `random_state` | `rs` | int | All |
| `n_init` | `ni` | int | MDS |
| `max_iter` | `mi` | int | MDS |
| `eps` | `e` | float | MDS |

The **abbreviation** is what appears in projection names when the same method and dimension count is requested with different overrides — see [Projection Naming](#projection-naming).

Example:

```bash
protspace prepare -i emb.h5 \
  -m 'umap2:n_neighbors=15' \
  -m 'umap2:n_neighbors=50;min_dist=0.05' \
  -m pca2 \
  -o output
```

This produces three projections: `ProtT5 — PCA 2`, `ProtT5 — UMAP 2 (n=15)`, and `ProtT5 — UMAP 2 (d=0.05, n=50)`.

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
| `--stats / --no-stats` | Compute projection quality statistics (annotation-based cluster-validity + faithfulness). See [Projection Statistics](#projection-statistics---stats). | off |
| `--cluster-selection` | With `--stats`, how to choose the cluster count K: `elbow`, `silhouette`, or `both`. | `elbow` |
| `--stats-annotation` | With `--stats`, which annotation column(s) to score for cluster-validity: `auto` (all suitable low-cardinality categoricals) or a comma-separated list. | `auto` |
| `--keep-tmp` | Cache intermediates for resumability. | on |
| `--no-log` | Skip writing `run.log`. | off |
| `--dump-cache` | Print cached annotations and exit. | off |

## `protspace embed`

Generate HDF5 embeddings from FASTA, via the remote Biocentral API (default) or a local GPU/CPU (`--backend local`, needs `pip install "protspace[local]"`).

```bash
# Remote Biocentral API (default)
protspace embed -i sequences.fasta -e prot_t5 -e esm2_3b -o embeddings/

# On-device GPU/CPU — works offline / when Biocentral is down
protspace embed -i sequences.fasta -e prot_t5 -o embeddings/ --backend local
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

Combine projection and annotation parquet files into a `.parquetbundle`. Optionally folds in a statistics parquet (from `protspace stats`) as the 5th part and a settings JSON as the 4th part.

```bash
protspace bundle -p projections/ -a annotations.parquet -o output.parquetbundle

# Include projection statistics + auto-generated cluster legend styles
protspace bundle -p projections/ -a annotations.parquet \
  -s statistics.parquet --settings cluster_styles.json -o output.parquetbundle
```

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-s, --statistics` | Projection-statistics parquet → 5th bundle part. | — |
| `--settings` | Settings JSON (e.g. cluster legend styles) → 4th bundle part. | — |

## `protspace stats`

Compute per-projection quality statistics for an existing project directory and write them as a `statistics.parquet` (the optional 5th `.parquetbundle` part). Faithfulness and the auto-cluster membership columns need no annotations; annotation-based validity (and its ARI/NMI agreement with the auto-clusters) needs `-a/--annotations`. See [Projection Statistics](#projection-statistics---stats) for what is computed.

```bash
# Statistics for a project (embeddings needed for faithfulness)
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet

# Also enrich an annotations parquet in place with per-protein cluster-membership
# columns, score annotation-based validity, and write the auto cluster-legend styles
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --settings-out cluster_styles.json

# Score only specific annotations instead of every suitable categorical (default: auto)
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --stats-annotation major_group,ec_number

# Emit both the elbow and the silhouette-optimal clustering
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --cluster-selection both
```

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-i, --input` | HDF5 embedding file(s) (for faithfulness + the once-per-embedding annotation-validity pass). Repeat for multi-embedding; `-i file.h5:name` to override the name. | — |
| `-p, --projections` | Project directory with `projections_metadata.parquet` + `projections_data.parquet`. | — |
| `-o, --output` | Output `statistics.parquet` path. | — |
| `-a, --annotations` | Annotations parquet to enrich in place with per-protein `cluster_*` membership columns (per-point silhouette attached as `value|score`), and to score for annotation-based validity + ARI/NMI agreement. | — |
| `--cluster-selection` | Cluster count K selection: `elbow`, `silhouette`, or `both`. | `elbow` |
| `--stats-annotation` | Which annotation column(s) to score for cluster-validity: `auto` (all suitable low-cardinality categoricals) or a comma-separated list. Requires `-a`. | `auto` |
| `--settings-out` | Write auto cluster-legend styles here (JSON) for `bundle --settings`. Requires `-a`. | — |
| `--metric` | High-dim distance metric for faithfulness when the projection metadata omits one (e.g. PCA/MDS). | `euclidean` |
| `--seed` | Random seed. | `42` |

## Projection Statistics (`--stats`)

`prepare --stats` (opt-in) and the standalone `protspace stats` command compute three families of per-projection quality metrics and bake them into the output:

- **Annotation-based validity** — silhouette, Davies–Bouldin, and Calinski–Harabasz scored using an annotation's own category labels (not auto-clustering) — how well proteins already grouped by an annotation (e.g. `major_group`, `ec_number`) separate in a given space. Computed once for the source embedding (a separability "ceiling") and again for each projection, written to the tidy `statistics.parquet` (the bundle's 5th part) with `space_kind ∈ {embedding, projection}` and an `annotation` column naming which one was scored. `--stats-annotation auto|name1,name2` (default `auto`) picks which annotation column(s) to score — `auto` scores every "suitable" low-cardinality categorical (≥2 and ≤min(50, max(2, n/2)) distinct non-empty values, not numeric, and not a generated `cluster_*` column); requires `-a/--annotations`.
- **Auto-cluster agreement** — KMeans labels the projection; the cluster count K is chosen by the inertia **elbow** and/or by **max silhouette** — `--cluster-selection elbow|silhouette|both`. This auto-clustering is no longer scored against itself (that was circular); instead, when annotations are supplied, each labelling's **ARI** (adjusted Rand index) and **NMI** (normalized mutual information) agreement with every scored annotation is recorded (`stat_family=cluster_agreement`). Each selection also becomes a per-protein membership column — `cluster_elbow_<projection>` and/or `cluster_silhouette_<projection>` — with the point's **silhouette attached to its value** as `cluster N|<silhouette>` (the same `value|score` convention as UniProt evidence codes / InterPro bit scores; suppressed by `--no-scores`). Membership columns get an auto Kelly-palette legend (the bundle's 4th settings part); in `statistics.parquet` the two selections are distinguished by `label_kind` (`kmeans_elbow` / `kmeans_silhouette`).
- **Faithfulness** — how well the projection preserves the source embedding's structure; each row is tagged `scope`:
  - **local** (kNN-neighbourhood): **kNN-overlap**, **trustworthiness**, **continuity**.
  - **global** (whole-layout): **random_triplet** (relative-ordering accuracy over random triplets, ∈[0,1]) and **spearman_distance** (rank correlation of all pairwise distances, ∈[−1,1]).

  These per-projection scalars ride in each projection's `info_json.quality` — they never land in `statistics.parquet`.

Notes:
- Off by default — the compute (annotation-validity + a KMeans sweep + faithfulness) and the extra bundle columns/styles are opt-in.
- Annotation-based validity and cluster agreement need `-a/--annotations`; faithfulness and the membership columns do not.
- Uses the projection's own high-dim metric (e.g. `cosine`) for faithfulness; falls back to `--metric` / `euclidean` when the reducer doesn't record one.
- Best-effort: a failure for one statistic or projection is logged and skipped, never failing the run. At large scale the heavier metrics are subsampled (silhouette/faithfulness) or fit on a bounded subsample (KMeans elbow) with a deterministic seed.

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

## `protspace transfer`

Embedding Annotation Transfer (EAT): fills missing annotation values for query proteins by transferring the annotation of the nearest annotated reference protein in pLM embedding space. For each query protein that lacks a value in the requested annotation column, the command finds the closest reference (by distance in the original high-dimensional embedding space — cosine by default, or Euclidean via `--metric`, and not in the 2-D/3-D projection) and assigns that reference's label along with a reliability index adapted from goPredSim, yielding a score in [0, 1] where 1 means identical embeddings. The curated source column (`COL`) is left untouched; results are written as three new columns: `COL__pred_value` (string), `COL__pred_confidence` (float), and `COL__pred_source` (string — the reference protein the label was transferred from, for provenance). The method is a direct application of the approach introduced by Littmann et al., Sci Rep 2021 ([DOI 10.1038/s41598-020-80786-0](https://doi.org/10.1038/s41598-020-80786-0)) and extended by Heinzinger et al., NAR Genom Bioinform 2022 ([DOI 10.1093/nargab/lqac043](https://doi.org/10.1093/nargab/lqac043)).

**Reliability index (`COL__pred_confidence`).** The exact form depends on `--metric` and `--k`:

- **Default (`--metric cosine`, `--k 1`):** `confidence = clamp(1 - cosine_distance, 0, 1)`, where `cosine_distance` is in [0, 2] (1 = identical direction, 0 = orthogonal/opposite). Cosine is the default because the confidence is naturally bounded and directly interpretable.
- **`--metric euclidean` (`--k 1`):** `confidence = 0.5 / (0.5 + distance)` (1 at distance 0, 0.5 at distance 0.5, → 0 as distance → ∞); this is the published goPredSim transform, calibrated for ProtT5, so on embedding spaces with larger raw distances treat it as a ranking rather than a calibrated probability.
- **`--k > 1`:** the value is the goPredSim mean reliability — `(1/m) · Σ s(d)`, the sum of the per-neighbour similarity `s(d)` (the euclidean or cosine form above) over the `k` nearest neighbours that carry the chosen label, divided by `m = min(k, number of references)`. Because of this normalization, confidence values are **not** comparable across different `--k` settings.

```bash
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin'
```

**Key options:**

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `-b, --bundle` | Input `.parquetbundle` file | — |
| `-e, --embeddings` | HDF5 embeddings file (use `:name` suffix for external files) | — |
| `-t, --transfer` | Annotation column to transfer (repeatable) | — |
| `-o, --output` | Output `.parquetbundle` (may overwrite input) | — |
| `--query-id-prefix` | Restrict query proteins to IDs starting with this prefix | — |
| `--query-where` | Filter query proteins by annotation value (`col~substr`) | — |
| `--reference-id-prefix` | Restrict reference proteins to IDs starting with this prefix | — |
| `--reference-where` | Filter reference proteins by annotation value (`col~substr`) | — |
| `--k` | Number of nearest neighbours | `1` |
| `--metric` | Distance metric (`cosine`, `euclidean`); see the reliability-index forms above | `cosine` |

Distances are computed in the original embedding space (HDF5), not in the 2-D/3-D projection. The `--metric` choice also changes how `COL__pred_confidence` is computed: cosine uses `clamp(1 - cosine_distance, 0, 1)`, while euclidean uses `0.5 / (0.5 + distance)` (see the reliability-index note above).

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

When the same method and dimension count is requested with different inline parameter overrides (a parameter sweep), the differing parameters are appended in parentheses using their abbreviated names — for example, `ProtT5 — UMAP 2 (n=50)` for `umap2:n_neighbors=50` running alongside another `umap2` variant. A plain `umap2` (no overrides) keeps the unsuffixed name. See [Overridable parameters](#overridable-parameters-with--m) for the abbreviation table.

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
