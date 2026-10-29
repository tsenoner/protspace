# Using Python CLI

For local processing or automation, use the ProtSpace Python package. It turns embeddings,
sequences or a UniProt query into a `.parquetbundle` you can drag onto
[the explore page](/explore/index).

## Installation

```bash
pip install protspace
```

**Optional extras**

| Extra        | Install                               | Needed for                                                            |
| ------------ | ------------------------------------- | --------------------------------------------------------------------- |
| `local`      | `pip install "protspace[local]"`      | on-device embedding (`--backend local`) instead of the Biocentral API |
| `similarity` | `pip install "protspace[similarity]"` | MMseqs2 sequence-similarity projections (`-s/--similarity`)           |
| `frontend`   | `pip install "protspace[frontend]"`   | the local Dash viewer (`protspace serve`, deprecated)                 |

> **Upgrading an existing install:** `-s/--similarity` used to work out of the box because
> MMseqs2 shipped in the base install. It now lives in the `similarity` extra, so add
> `pip install "protspace[similarity]"` if you use that flag. Nothing else changes: the base
> install got smaller, and on macOS and Linux the extra installs from a prebuilt wheel
> rather than compiling from source.

## Commands

| Command              | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `protspace prepare`  | Full pipeline: embed → project → annotate → (stats) → bundle |
| `protspace embed`    | FASTA → per-model HDF5 embeddings                            |
| `protspace project`  | Embeddings → 2D projections (3D deprecated)                  |
| `protspace annotate` | Fetch UniProt / InterPro / taxonomy annotations              |
| `protspace stats`    | Score projection quality (cluster validity + faithfulness)   |
| `protspace bundle`   | Merge projections + annotations → `.parquetbundle`           |
| `protspace transfer` | Fill missing annotations from nearest neighbours (EAT)       |
| `protspace style`    | Set colors, shapes and legend order on a bundle              |
| `protspace convert`  | Upgrade a v1/v2 bundle to the current v3 format              |
| `protspace export`   | Write a bundle as a TSV table, one row per protein           |
| `protspace serve`    | Run a local viewer (deprecated, removed in 5.0.0)            |

Run `protspace <command> -h` for the built-in help of any command.

### Which command do I need?

Most users only need `prepare`. The other commands are its stages, for running, rerunning or
inspecting one of them on its own.

| You have                                    | You want                                         | Run                                       |
| ------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| A FASTA, an `.h5` or a UniProt query        | A bundle, with annotations and statistics        | `prepare` (`-a` annotations, `--stats`)   |
| Embeddings (`.h5`)                          | Projections only                                 | `project`                                 |
| An `.h5` or a FASTA                         | An annotations table: fetched, your own, or both | `annotate`                                |
| Embeddings and projections                  | Quality statistics and cluster columns           | `stats`                                   |
| Projections and an annotations table or CSV | A bundle                                         | `bundle`                                  |
| A bundle                                    | Its gaps filled from nearest neighbours          | `transfer` (`--report` for the distances) |
| A bundle                                    | One table of every protein, for pandas or Excel  | `export`                                  |

`project` only computes projections: it takes no `-a` and no `--stats`. For annotations and
statistics in the same bundle, use `prepare`, or the [step-by-step route](#step-by-step).

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

# From HDF5 embeddings, with your own annotations and projection statistics
protspace prepare -i emb.h5 -a annotations.csv -m umap2,tsne2 --stats -o out

# From FASTA, auto-embed with two models
protspace prepare -i sequences.fasta -e prot_t5,esm2_650m -m pca2,umap2 -o output

# With sequence similarity (MMseqs2)
protspace prepare -i emb.h5 -f seq.fasta -s -m pca2,mds2 -o output

# Name the embedding yourself (otherwise it comes from the file, see below)
protspace prepare -i external.h5:prot_t5 -m pca2 -o output

# Compare UMAP parameters in a single run
protspace prepare -i emb.h5 -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2 -o output
```

### Input

| Flag          | Description                                                                     | Default |
| ------------- | ------------------------------------------------------------------------------- | ------- |
| `-i, --input` | HDF5/FASTA file(s). Repeat for multi-embedding. Embedding name: `-i f.h5:name`. | -       |
| `-q, --query` | UniProt query (alternative to `-i`).                                            | -       |
| `-f, --fasta` | FASTA for `-s/--similarity` when the input is HDF5.                             | -       |

### Embedding

| Flag             | Description                                                                                               | Default      |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| `-e, --embedder` | pLM model(s), comma-separated. See [Embedder models](#embedder-models).                                   | `prot_t5`    |
| `-b, --backend`  | Embedding engine: `biocentral` (remote API) or `local` (GPU/CPU). Ignored for `.h5` input.                | `biocentral` |
| `--batch-size`   | Sequences per batch. Backend default when unset: 1000 (Biocentral call) or 8 (local GPU).                 | -            |
| `--max-length`   | Skip sequences longer than this (`--backend local` only). Skipped sequences are named in the run summary. | `2000`       |

`-e` requires FASTA input or `-q/--query`; it is rejected with HDF5-only input. When a FASTA is
given without `-e`, `prot_t5` is used.

`-b`, `--batch-size` and `--max-length` apply only when ProtSpace embeds sequences, from FASTA input
or `-q`. With `.h5` input nothing is embedded and nothing is sent to Biocentral, so `-b local` is
never needed there; given anyway, these flags make `prepare` warn that they have no effect.

### Projection

| Flag               | Description                                                                                    | Default     |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------- |
| `-m, --methods`    | DR methods, comma-separated or repeated. See [Projection methods](#projection-methods).        | `pca2`      |
| `-s, --similarity` | Also compute a sequence-similarity projection via MMseqs2. Needs `protspace[similarity]`.      | off         |
| `--metric`         | Distance metric: `euclidean`, `cosine`, `manhattan`.                                           | `euclidean` |
| `--random-state`   | Random seed.                                                                                   | `42`        |
| `--n-neighbors`    | UMAP/PaCMAP/LocalMAP neighbors (≥ 2). Larger = more global structure.                          | `25`        |
| `--min-dist`       | UMAP minimum distance (0.0–0.99).                                                              | `0.1`       |
| `--perplexity`     | t-SNE perplexity (≥ 5; must be below the number of proteins, ideally at most `n_samples / 3`). | `30.0`      |
| `--learning-rate`  | t-SNE learning rate (≥ 1).                                                                     | `200.0`     |
| `--mn-ratio`       | PaCMAP/LocalMAP mid-near ratio (0.0–1.0).                                                      | `0.5`       |
| `--fp-ratio`       | PaCMAP/LocalMAP further ratio.                                                                 | `2.0`       |
| `--n-init`         | MDS initializations.                                                                           | `4`         |
| `--max-iter`       | MDS maximum iterations.                                                                        | `300`       |
| `--eps`            | MDS convergence tolerance.                                                                     | `0.001`     |

### Annotations

| Flag                     | Description                                                        | Default   |
| ------------------------ | ------------------------------------------------------------------ | --------- |
| `-a, --annotations`      | Annotation groups, individual names, or CSV/TSV paths. Repeatable. | `default` |
| `--scores / --no-scores` | Include annotation confidence scores.                              | on        |

### Output

| Flag                         | Description                                                                                                                                                                  | Default |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `-o, --output`               | Output directory.                                                                                                                                                            | `.`     |
| `--bundled / --no-bundled`   | Bundle into a single `.parquetbundle`.                                                                                                                                       | bundled |
| `--stats / --no-stats`       | Compute projection quality statistics. See [Projection statistics](#projection-statistics).                                                                                  | off     |
| `--cluster-selection`        | With `--stats`, how to choose the cluster count K: `elbow`, `silhouette`, or `both`.                                                                                         | `elbow` |
| `--cluster-space`            | With `--stats`, where to cluster: `projection`, `embedding` (one column per embedding, shared by its projections), or `both`.                                                | `both`  |
| `--stats-annotation`         | With `--stats`, which annotation column(s) to score: `auto` or a comma-separated list.                                                                                       | `auto`  |
| `--refetch`                  | Recompute stages (comma-separated): `query`, `embed`, `similarity`, `projections`, `uniprot`, `taxonomy`, `interpro`, `ted`, `biocentral`. Shorthands: `all`, `annotations`. | off     |
| `--keep-tmp / --no-keep-tmp` | Cache intermediates in `{output}/tmp/` for resumability.                                                                                                                     | on      |
| `--dump-cache`               | Print cached annotations and exit.                                                                                                                                           | off     |
| `--no-log`                   | Skip writing `run.log` to the output directory.                                                                                                                              | off     |
| `-v, --verbose`              | Verbosity: `-v` = INFO, `-vv` = DEBUG.                                                                                                                                       | -       |

Each run appends its command, version, settings and timing to `run.log` in the output directory.
The `uniprot_release:` line under `## Annotations` names the UniProtKB release the annotations came
from (for example `2026_03`), whether they were fetched in that run or read from the annotation
cache. It lists every release when cached and newly fetched values differ, says `unknown` for values
from a cache written before releases were recorded, and says `none` when no UniProt data was used:
the annotations came only from a CSV file, or no identifier is a UniProt accession.

## Projection Methods

Methods require a dimension suffix: `2` for 2D (`3` for 3D is deprecated, see below).

::: warning Dimension Suffix Required
Specify `pca2`, not `pca` alone.
:::

| Method   | 2D          | 3D (deprecated) | Description                            |
| -------- | ----------- | --------------- | -------------------------------------- |
| PCA      | `pca2`      | `pca3`          | Principal Component Analysis           |
| UMAP     | `umap2`     | `umap3`         | Uniform Manifold Approximation         |
| t-SNE    | `tsne2`     | `tsne3`         | t-distributed Stochastic Neighbor Emb. |
| PaCMAP   | `pacmap2`   | `pacmap3`       | Pairwise Controlled Manifold Approx.   |
| MDS      | `mds2`      | `mds3`          | Multidimensional Scaling               |
| LocalMAP | `localmap2` | `localmap3`     | Local-first alternative to PaCMAP      |

::: warning 3D projections are deprecated
3D projections (any `*3` method) are deprecated and will be removed in protspace 5.0.0. They
still run, with a warning; use the `*2` variant instead. The web app shows a 3D projection only
as its X/Y view, which is the same as the 2D projection only for PCA. Reading them is deprecated too: every command that reads a bundle's projections
warns when it holds a 3D one, and from 5.0.0 only `protspace convert` reads them, to turn them
into 2D (see [`--flatten-3d`](#protspace-convert)).
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
`esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`, `esmc_6b`

`esmc_6b` runs only with `--backend local` (see below); Biocentral cannot compute it yet.

::: warning Licensing
`ankh_base`, `ankh_large` and `ankh3_large` are CC-BY-NC-SA-4.0. All other models are permissively
licensed, including the ESM-C models: `esmc_300m`, `esmc_600m` and `esmc_6b` were relicensed under
MIT in May 2026, retroactively, when ESM-C moved to the Chan Zuckerberg Biohub, which publishes the
weights (`biohub/ESMC-300M`, `biohub/ESMC-600M`, `biohub/ESMC-6B`).
:::

No GPU or local install? The
[Embeddings notebook](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ClickThrough_GenerateEmbeddings.ipynb)
embeds a FASTA with the same models on a free Colab GPU (`esmc_6b` included)
and writes an `.h5` that `prepare -i` reads, per protein or per residue.

### Local backend

`--backend local` computes embeddings on a local GPU/CPU via HuggingFace `transformers` instead of
the remote [Biocentral](https://biocentral.rostlab.org) API, useful when the API is unavailable or
when you are working offline. It needs the extra: `pip install "protspace[local]"`.

```bash
protspace prepare -i sequences.fasta -e prot_t5 --backend local -m pca2 -o output
```

For `esmc_300m` and `esmc_600m` both backends use the official `biohub/ESMC-300M` and
`biohub/ESMC-600M` weights, so their vectors agree to float32 precision. Locally they load through
the ESM-C model built into `transformers` (5.16 or later, which the extra installs), with no extra
login or remote code. ESM-C embeddings from Biocentral made with protspace 4.17.1 or earlier came
from a different model; a run that finds one of those files refuses to resume from it, and
`--refetch embed` replaces it.

`esmc_6b` (ESM-C 6B, 2560-dimensional vectors) is available only on this backend: Biocentral accepts
the model but fails to compute it, so `--backend biocentral -e esmc_6b` stops with a usage error. Its
weights are 25.4 GB in float32. On a GPU they load in half precision (bfloat16 where the GPU
supports it, float16 otherwise), about 12 GB of GPU memory, so a 16 GB card such as the T4 on free
Colab is enough: there it peaks at 12.5 GB with sequences up to 2,000 residues, and takes about
5.5 minutes per 1,000 proteins of typical length (plus about 4 minutes to download the weights and
2 to load them). On the CPU they stay float32 and need over 26 GB of RAM.

On a GPU the local backend loads every model straight into GPU memory, so a model larger than the
machine's RAM still loads: on free Colab (12.7 GB of RAM) both `esmc_6b` and `esm2_3b` peak below
1 GB of RAM while loading. This uses the `accelerate` package, which the `[local]` extra installs;
without it the model is first built in RAM. In the Colab Preparation notebook, `esm2_3b` and
`esmc_6b` are disabled only where the model would be built in RAM first (no GPU, or no
`accelerate`) and the runtime has under 16 GB of RAM.

## Annotations

Specify annotation sources with `-a`. The flag is repeatable and each value may be a group name, an
individual annotation name, or a path to one of your own tables (see
[Custom annotation files](#custom-annotation-files)).

```bash
# Use a predefined group
-a default        # EC, keyword, length, protein_families, reviewed
-a all            # Everything from all sources

# Pick individual sources
-a uniprot -a interpro -a taxonomy -a ted -a biocentral

# Or pick individual annotation names
-a protein_families,reviewed,pfam,genus,species

# Or provide your own tables; several files are merged
-a annotations.csv -a neighbors.tsv
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
pass the original FASTA with `-f`. A UniProt batch that fails outright leaves its proteins'
UniProt annotations empty too, and the run warns how many batches and proteins are affected.

### Custom annotation files

Bring your own columns as a table with one row per protein:

```csv
protein_id,taxonomy,family,function
P12345,Bacteria,Kinase,ATP binding
P67890,Archaea,Phosphatase,Hydrolase
Q54321,Eukaryota,Kinase,Transferase
```

`prepare`, `annotate`, `stats` and `bundle` read such a file through `-a`, all by the same rules:

- **File type.** A value ending in `.csv`, `.tsv` or `.txt`, in any case, is a file; any other
  value is a source name. Other formats, such as `.xlsx`, are refused: export them to CSV first.
- **Delimiter.** Comma, tab or semicolon, read from the header line whatever the extension. A file
  whose header holds none of them parses to a single column, and ProtSpace warns about it.
- **Id column.** The first column holds the protein ids, whatever its header. No column name takes
  precedence over it, so put the ids first.
- **Reserved names.** A later column named `identifier`, `protein_id`, `id`, `uniprot`, `entry`,
  `projection_name`, `x`, `y` or `z` (exactly, in lower case) is kept as an annotation but renamed
  `<name>_annotation`, for example `protein_id_annotation`, and ProtSpace warns about the rename.
  ProtSpace uses those names for its own id and projection columns, and the web app would hide them.
- **Ids match exactly.** They are compared verbatim with your input's identifiers (the `.h5` keys,
  or the FASTA identifiers). When some of a file's ids match no input protein, ProtSpace warns and
  shows examples of both, so `P12345` against `sp|P12345|KIN_HUMAN` is reported instead of leaving
  empty columns. A file may cover only some proteins; the others get empty values.
- **Cells are text.** Every cell is kept as written, and an empty cell stays empty. A cell spelled
  like a missing value, such as `NA`, `N/A` or `None` in any case, is missing to the web app (which
  shows it as N/A), `stats` and `transfer`, as in any bundle (see
  [Missing Values](./data-format.md#missing-values)). Separate several values in one cell with `;`
  outside parentheses: `Membrane (single-pass; type I)` stays one value.
- **Several files are merged** on the id column, so `-a metadata.csv -a neighbors.csv` keeps both
  files' columns. A column that two files both define is an error; rename it in one of them.
- **Encoding and line endings.** UTF-8, with or without the byte-order mark Excel writes, and
  Windows (CRLF), classic Mac (CR) or mixed line endings.

A column from your file overrides a fetched annotation of the same name. With `--keep-tmp`, only
fetched annotations are cached and your files are read fresh on every run, so rerunning `prepare`
after editing a CSV reuses the cached projections and takes seconds.

| Command    | What it does with `-a annotations.csv`                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `prepare`  | Merges it with any sources named beside it into the bundle. A file alone fetches nothing.                          |
| `annotate` | Writes it to the output parquet, merged with any sources named beside it. A file alone fetches nothing.            |
| `stats`    | Scores it, leaving the file as is; its columns and the cluster columns go to `<name>.annotations.parquet` in `-p`. |
| `bundle`   | Bundles it in place of an annotations parquet.                                                                     |
| `project`  | Refuses it, naming these commands: `project` only computes projections.                                            |

### Step by step

`prepare` runs the whole route in one command. The same bundle, one stage at a time, so you can
rerun only the step you changed:

```bash
protspace project  -i emb.h5 -m umap2,tsne2 -o proj/
protspace annotate -i emb.h5 -a annotations.csv -o proj/annotations.parquet  # add -a default to fetch too
protspace stats    -i emb.h5 -p proj/ -a proj/annotations.parquet -o proj/statistics.parquet \
  --settings-out proj/cluster_styles.json
protspace bundle   -p proj/ -a proj/annotations.parquet -s proj/statistics.parquet \
  --settings proj/cluster_styles.json -o out.parquetbundle
```

`stats` adds the `cluster_*` columns to `proj/annotations.parquet` in place. Given the CSV itself,
it leaves the CSV alone and writes `proj/annotations.annotations.parquet` instead (named after the
CSV), which is then the file for `bundle -a`. Without statistics,
`protspace bundle -p proj/ -a annotations.csv -o out.parquetbundle` bundles the CSV directly.

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

The second example needs no `:name` because each file name ends in a model key. With several
inputs, a file whose name cannot be resolved is an error rather than a guess, since the name
decides between union and intersection.

Duplicate proteins across same-name inputs are deduplicated when their embeddings match within
tolerance; conflicting embeddings for the same protein ID raise an error.

## Model Name Resolution (`-i file.h5:name`)

Every HDF5 input has an embedding name. It labels the projections (`esm2_650m` shows as
`ESM2-650M — UMAP 2`) and decides how several `-i` inputs combine (see above). It is resolved in
this order:

1. **Colon syntax**, `-i file.h5:esm2_650m` (highest priority)
2. **HDF5 attribute**, `model_name` in the root attributes, set automatically by
   `protspace embed`/`prepare` and by the
   [Embeddings notebook](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ClickThrough_GenerateEmbeddings.ipynb)
3. **File name**, a model key the file name ends in: `seqs_esm2_650m.h5`, `Ss_mSCR_esm2_650m.h5`
   and `esm2_650m.h5` are all `esm2_650m`. The keys are the [embedder models](#embedder-models)
   (plus `esm3_open`, which older Embeddings-notebook files carry); the longest match wins, and
   only the end of the name counts. A directory
   input takes the key its files share; files from different models in one directory are an
   error, so give each model's files their own `-i`
4. **File stem**, only when the file is the command's only input: `results.h5` is named `results`
5. **Error**, when several inputs are given and one of them is still unnamed. The message says
   what the name decides for that command and shows the corrected command line with your paths

Rules 3 and 4 log the name they picked at `-v`. Use the colon syntax whenever the file name does
not say which model made it and you combine files, or when you want a different label.

```bash
# One file: no name needed (named by its file name, or by its stem)
protspace prepare -i seqs_esm2_650m.h5 -m pca2 -o output

# Several files without a usable name: name each one
protspace prepare -i human.h5:esm2_650m -i fly.h5:esm2_650m -m umap2 -o output
```

`protspace stats` matches each projection to its embedding by this name. When you pass one file
whose name came from rule 3 or 4 and the projections were all built from one embedding, it takes
that embedding's name; when they come from several and none matches, it stops and asks you to
name the input. `protspace transfer -e` reads only the vectors, so it never needs a name.

Check whether a file has the attribute:

```bash
python -c "import h5py; print(dict(h5py.File('file.h5','r').attrs))"
```

## Intermediate Caching

With `--keep-tmp` (the default), intermediate results are cached in `{output}/tmp/` and reused on
subsequent runs:

| Cached item       | File                                    | Reuse behavior                                        |
| ----------------- | --------------------------------------- | ----------------------------------------------------- |
| FASTA sequences   | `queries/{query hash}.fasta`            | Skip the download for that query                      |
| Embeddings        | `{embedder}.h5`                         | Skip proteins already embedded from the same residues |
| Annotations       | `all_annotations.parquet`               | Fetch missing or stale columns, and missing proteins  |
| Similarity matrix | `similarity_matrix.npy`                 | Skip MMseqs2 recomputation                            |
| DR projections    | `proj_{name}_{method}{dims}_{hash}.npz` | Skip dimensionality reduction                         |

The annotation cache always stores scores; `--no-scores` strips them from the output afterwards.

The annotation cache is read per column and per protein: a source is queried only for the proteins
whose values the cache cannot supply, and a cache covering more proteins than the current run keeps
those extra rows. It is also written after each source finishes, not only at the end of the run, so
a crash or failure in a late source (TED can run for hours) does not cost the sources that
already finished. An embedding HDF5 records the backend and model that wrote it, and a run that
points at another producer's file stops rather than mixing two embedding spaces.

If a source could not be fully retrieved, its columns are **left out of the cache**: a partly empty
column is indistinguishable from one where those proteins genuinely have no entry, so caching it
would make every later run reuse the gaps instead of refetching. Sources that did complete are
still cached, so one flaky API does not cost an expensive UniProt fetch or a long TED pass. Values
the cache already held for the failed source are kept as they were, and the cache is left untouched
only when nothing else completed. Either way the run still returns everything it did retrieve, and
the next run fetches the rest. Transient HTTP failures are retried with backoff first, so this is
reserved for a source that is genuinely unavailable. Use `--refetch annotations` to rewrite the
cache regardless — that is the repair path for a cache already holding empty values. See
[Fetching & Caching](/guide/fetching-and-caching) for the full picture.

Legacy annotation caches are migrated when they are read:

- A cache that spelled an unassigned [TED domain](/guide/annotations#ted_domains) `unclassified` is
  rewritten in place to TED's `-`, so no refetch is needed.
- A cache written before [`xref_pdb`](/guide/annotations#xref_pdb) told "no PDB structure" apart
  from "no UniProt entry" cannot be corrected in place. A run that surfaces the column re-fetches
  the whole UniProt source once and warns which columns it is refreshing; cached columns from other
  sources are reused. A run that does not request `xref_pdb` drops it from the cache instead, so a
  later run that asks for it still migrates.
- A cache written before [`protein_families`](/guide/annotations#protein_families) kept family
  names whole, or before InterPro columns reached every protein sharing a sequence, is refreshed
  the same way: a run that requests `protein_families` re-fetches UniProt once, a run that requests
  an InterPro column re-fetches InterPro once, and a run that requests neither drops those columns.
  At Swiss-Prot scale this one-time refresh takes hours. An older ProtSpace (4.13 or earlier)
  corrupts the new multi-family values if it resumes from such a cache, so after a downgrade delete
  the cache or run once with `--refetch uniprot`.
- A cache written before [`root`](/guide/annotations#root) became the top of the lineage, or before
  a negative [`predicted_transmembrane`](/guide/annotations#predicted_transmembrane) prediction was
  spelled `non-transmembrane` instead of `none`, is refreshed the same way: a run that requests
  `root` re-fetches the taxonomy once, a run that requests `predicted_transmembrane` re-fetches
  Biocentral once, and a run that requests neither drops those columns.

A refresh re-fetches every column of that source the cache holds, not only the requested ones, so
the cache keeps them all; the run still returns only what it asked for.

Projection caches are keyed by embedding name, method, dimensions and every parameter, so changing
any parameter creates a new entry. Use `--refetch all` to bypass all caches, or `--refetch <stages>`
selectively (for example `--refetch ted,biocentral`). A run that reused any cached result ends with
a hint naming the `--refetch` stages that would recompute it; a first run into a new output
directory reuses nothing and prints none.

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

# Raise the local length cap for a dataset with long sequences
protspace embed -i sequences.fasta -e prot_t5 -o embeddings/ --backend local --max-length 4000
```

`-i`, `-e` and `-o` are required. `--backend`, `--batch-size` and `--max-length` behave as in
`prepare`.

### When embedding fails

An incomplete embedding exits **non-zero**, on either backend. A truncated `.h5` projects, bundles
and scores completely normally, so a run that embedded 90% of your proteins would otherwise hand you
plausible numbers computed on a silently truncated dataset.

Two outcomes are distinguished:

- **Skipped** — a sequence a documented capability limit puts out of reach: longer than
  `--max-length`, or exhausting GPU memory at batch size 1 (local backend only). These are named in
  the run summary and do **not** fail the run.
- **Failed** — anything else missing from the `.h5`. The run exits 1 and the partial output is kept,
  so a rerun embeds only what is missing.

Multiple `-e` models are independent: one failing model no longer abandons the rest, and the command
exits 1 once at the end naming every model that failed.

Identifiers containing `/` are rejected up front on both backends — HDF5 treats `/` as a group
separator, so such an identifier can never become the dataset you asked for.

> **`-f/--fasta` coverage:** when a FASTA is supplied alongside HDF5 input, the embeddings are
> checked against it. Proteins in the `.h5` that the FASTA does not cover are reported, and with
> `-s/--similarity` they are an error: an uncovered protein leaves its self-similarity at 0, which
> suppresses the similarity-to-distance conversion for the whole matrix and inverts the MDS
> projection. A FASTA covering _more_ than the embeddings is normal and is not reported. The same
> FASTA supplies the sequences carried into the bundle, and it applies to every HDF5 input — a
> directory of them as much as a single file. A `-f` path that does not exist is rejected outright
> rather than ignored.

### No healthy Biocentral service became available

With the default `biocentral` backend, ProtSpace waits 30 seconds for the Biocentral server and then
stops with `ERROR: No healthy Biocentral service became available in time`, followed by the reason:

- **The server did not answer** (a connection error or a `503`). Biocentral is down or unreachable.
  Retry later, or embed on your own hardware with `--backend local`.
- **The server runs a version this release does not support.** The message names both versions and
  the range your installed client accepts, for example
  `runs Biocentral v3.0.0, but the installed biocentral-api 2.0.0 only supports servers v2.0.0 up to (not including) v3.0.0`.
  The Biocentral client and server change major version together, and a ProtSpace release works with
  one of them. Upgrade with `pip install -U protspace`, which needs Python 3.12 or newer.

Annotation fails softly: with `-a biocentral`, the Biocentral columns are left empty with the same
message as a warning, and are not cached, so a later run asks again.

::: warning Python 3.14 and `pip`
The Biocentral client declares `Python <3.14`, and `pip` honours that: on 3.14 it cannot install the
current client, so `pip install protspace` settles on an older ProtSpace release without failing. The
client itself runs on 3.14. Install with `uv pip install protspace`, which ignores that upper bound, or
use Python 3.12 or 3.13. Check what you got with `pip show protspace`.
:::

### `KeyError: 'ESM_8M'`

`protspace prepare` (and `embed`) stopping at startup with `KeyError: 'ESM_8M'`, whatever the input
or `--backend`, is a bug in protspace 4.16.0 and older, fixed in 4.16.1: version 2.0 of the
Biocentral client, released on 2026-10-01, renamed that model, and those releases looked it up on
import. Upgrade with `pip install -U protspace` (see the Python 3.14 note above) and drop any local
edit to `biocentral.py`. `-b local` does not avoid the error, and `.h5` input does not need it.

## `protspace project`

Run dimensionality reduction on existing HDF5 embeddings. Writes
`projections_metadata.parquet` and `projections_data.parquet` to the output directory.

```bash
protspace project -i embeddings/prot_t5.h5 -i embeddings/esm2_3b.h5 -m pca2,umap2 -o projections/
```

Accepts the same projection flags as `prepare`, plus `-f/--fasta` for `-s/--similarity`.
Unlike `prepare`, `project` does not merge inputs that share an embedding name, so it refuses two
inputs of the same name; combine files from one model with `prepare` instead.

`project` writes projections only. It takes no `-a` and no `--stats`, and says so when given them:
add annotations with `annotate` or `bundle -a`, and statistics with `stats`, as in the
[step-by-step route](#step-by-step), or use `prepare` for everything at once.

## `protspace annotate`

Extract protein identifiers from an HDF5 or FASTA file and fetch their annotations.

```bash
protspace annotate -i embeddings/prot_t5.h5 -a default -o annotations.parquet
```

| Flag                     | Description                                                                                                                                        | Default               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `-i, --input`            | HDF5 or FASTA file (required).                                                                                                                     | -                     |
| `-a, --annotations`      | Annotation sources (repeatable), or [custom annotation files](#custom-annotation-files). Files alone fetch nothing.                                | `default`             |
| `-o, --output`           | Output parquet path.                                                                                                                               | `annotations.parquet` |
| `--scores / --no-scores` | Include annotation confidence scores.                                                                                                              | on                    |
| `--cache-dir`            | Keep the annotation cache in this directory (created if missing), so a rerun resumes.                                                              | off                   |
| `--refetch`              | With `--cache-dir`, fetch these sources again (comma-separated): `uniprot`, `taxonomy`, `interpro`, `ted`, `biocentral`. Shorthand: `annotations`. | off                   |

Without `--cache-dir`, `annotate` fetches every requested source and writes only its output file.
With it, the command reads and writes `all_annotations.parquet` in that directory under the same
rules as `prepare`'s [intermediate cache](#intermediate-caching): each source is saved as soon as it
finishes, and a rerun with the same arguments fetches only the sources and proteins the cache is
missing. Pointing it at a `prepare` run's `{output}/tmp/` reuses that run's annotations.

```bash
# Interrupted during TED? Run the same command again: UniProt and InterPro come from the cache.
protspace annotate -i sequences.fasta -a default,interpro,ted -o annotations.parquet \
  --cache-dir annotations_cache/
```

## `protspace stats`

Score the quality of the projections in an existing project directory and write them as a
`statistics.parquet`, the optional fifth part of a
[`.parquetbundle`](/guide/data-format).

Folding it in with `bundle -s` fills the bundle's statistics slot, and the web app reads that table: it
draws separation-score strips in the legend, adds a `By separation` legend sort mode and fills the
Separation section of the projection metadata panel. See
[Separation Scores](/explore/separation-scores) for how the scores read in the app, and
[Data Format Reference](/guide/data-format#statistics-optional-5th-part) for the bundle parts. The
faithfulness metrics ride in the projection metadata (`info_json.quality`), so they show even in a
bundle written without statistics.

```bash
# Faithfulness only (no annotations needed)
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet

# Also score annotation-based validity and emit cluster legend styles
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --settings-out cluster_styles.json

# Score only specific annotations
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --stats-annotation major_group,ec_number

# Cluster only in the embedding: one cluster column shared by every projection
protspace stats -i embeddings/prot_t5.h5 -p projections/ -o statistics.parquet \
  -a annotations.parquet --cluster-space embedding
```

| Flag                  | Description                                                                                                                                                     | Default     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `-i, --input`         | HDF5 embedding file(s), required. Repeatable; `-i file.h5:name` names the embedding (see [Model Name Resolution](#model-name-resolution-i-file-h5-name)).       | -           |
| `-p, --projections`   | Directory with `projections_metadata.parquet` and `projections_data.parquet`, required.                                                                         | -           |
| `-o, --output`        | Output `statistics.parquet` path, required.                                                                                                                     | -           |
| `-a, --annotations`   | Annotations parquet, enriched in place with `cluster_*` columns, or a [CSV/TSV](#custom-annotation-files); scored for validity plus ARI/NMI agreement.          | -           |
| `--settings-out`      | Write auto-generated cluster legend styles here (JSON) for `bundle --settings`. Requires `-a`.                                                                  | -           |
| `--cluster-selection` | How to choose the cluster count K: `elbow`, `silhouette`, or `both`.                                                                                            | `elbow`     |
| `--cluster-space`     | Where to cluster: `projection` (each projection's coordinates), `embedding` (once per embedding, shared by its projections), or `both`.                         | `both`      |
| `--stats-annotation`  | Which curated annotation column(s) to score: `auto` or a comma-separated list. Requires `-a`. The `cluster_*` membership columns are scored regardless of this. | `auto`      |
| `--metric`            | High-dimensional distance metric for faithfulness when the projection metadata omits one (PCA/MDS).                                                             | `euclidean` |
| `--seed`              | Random seed.                                                                                                                                                    | `42`        |

### Projection statistics

`protspace stats` and `prepare --stats` compute three families of metrics:

- **Annotation-based validity**, silhouette, Davies–Bouldin and Calinski–Harabasz scored on an
  annotation's own category labels, computed once for the source embedding (the reference a
  projection is read against) and again for each projection. Rows land in `statistics.parquet` with
  `space_kind ∈ {embedding, projection}` and an `annotation` column. Silhouette and Davies–Bouldin
  are additionally emitted per category, on rows carrying a `category` value (aggregate rows leave
  it null); Calinski–Harabasz stays aggregate-only. A one-member category gets no per-category row
  and is excluded from the Davies–Bouldin and Calinski–Harabasz input, so an annotation with a few
  singleton categories still scores on the rest. Requires `-a`.
- **Auto-clustering and its agreement with annotations**, KMeans labels each projection on its own
  coordinates, each embedding once in the embedding space, or both (`--cluster-space`, default
  `both`), with K chosen by the inertia elbow and/or maximum silhouette. Each selection becomes a
  per-protein membership column holding a bare `cluster N` label, the same shape as a curated
  categorical annotation: `cluster_elbow_<projection>` / `cluster_silhouette_<projection>` for a
  projection, whose cluster numbers are independent of every other projection's, and
  `cluster_elbow_<embedding>` / `cluster_silhouette_<embedding>` for an embedding, one column that
  every projection of that embedding shares, so a protein's cluster number is the same in its UMAP
  and its t-SNE. An embedding is clustered on its top 50 principal components with three KMeans
  restarts per K, which keeps a 5,000 × 1,280 embedding to about 20 seconds. Each clustering is
  then scored on its own categories exactly as an annotation is, aggregate and per-category, filed
  under the membership column's name and tagged `label_kind=kmeans_elbow|kmeans_silhouette`,
  whether or not `--stats-annotation` named anything: a projection clustering in its projection,
  an embedding clustering on the embedding and again in each of its projections. Read those
  scores as descriptive rather than as a verdict: KMeans drew the boundaries being graded, and a
  `silhouette`-selected K was chosen by maximising the very number reported. Separately, each
  clustering's ARI/NMI agreement with every scored annotation is recorded as
  `stat_family=cluster_agreement`. `--no-scores` does not touch
  these columns, they carry no score to strip; bundles written by older versions, whose values were
  `cluster N|0.41`, still load because the app drops the suffix by column name.
- **Faithfulness**, how well the projection preserves the embedding's structure: kNN-overlap,
  trustworthiness and continuity (local), plus random-triplet accuracy and Spearman distance
  correlation (global). These ride in each projection's `info_json.quality`, not in
  `statistics.parquet`.

Statistics are opt-in because the extra compute can be slow on large runs. A failure for one metric
or projection is logged and skipped rather than failing the run, and above 5000 points the heavier
metrics run on a deterministic, id-seeded subsample.

Cluster rows share the `annotation` column with curated ones, so filter on
`label_kind == 'annotation'` to isolate the columns you named.

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
| `-a, --annotations` | Annotations parquet or CSV/TSV file, required.                   | -       |
| `-o, --output`      | Output `.parquetbundle` path, required.                          | -       |
| `-s, --statistics`  | Projection-statistics parquet → fifth bundle part.               | -       |
| `--settings`        | Settings JSON (for example cluster legend styles) → fourth part. | -       |

Every bundle is written with six parts (format v3); `-s` fills the fifth, the statistics slot, and
the web app renders that table, see
[Separation Scores](/explore/separation-scores).

The annotations parquet can be the output of `protspace annotate`, the annotation cache `prepare`
keeps (`tmp/all_annotations.parquet`), or a table of your own. Its id column is the column named
`protein_id`, the name every table ProtSpace writes uses, else `identifier`, the name releases
before 4.17 wrote, or else its first column; beside `protein_id`, an `identifier` column is an
annotation. Reading `identifier` as the id column warns that it is deprecated: it ends in protspace
5.0.0, so rename such a column to `protein_id`. A projections directory keyed on `identifier`
warns the same way. `stats -a` follows the same rule, so a table `stats` enriched is one `bundle`
accepts. `annotate` and the cache hold
percent-encoded v2 cells, stamped `protspace_format_version` = `2`, and those pass through
unchanged; a cache written before the cache carried that stamp is recognised as one and read the
same way. Any other table without the stamp, for example one you built with pandas, is read as
plain text (the legacy v1 cell grammar): a literal `%` stays a percent sign, and a `;` inside
parentheses, as in `Membrane (single-pass; type I)`, stays part of one label. Separate several
values in one cell with `;` outside parentheses.

A bundle never carries the internal `organism_id` and `sequence` columns, which ProtSpace fetches
only to look up taxonomy and sequence-based annotations. `bundle` drops them even when the
annotations parquet has them (for example from `annotate -a sequence`, whose own parquet keeps
them), and `transfer`, `convert` and `style` drop them from an older bundle that still carries
them.

## `protspace transfer`

Embedding Annotation Transfer (EAT): fill missing annotation values from the nearest annotated
reference protein. For every query protein with no value in the requested column, the command finds
the closest reference by distance in the original high-dimensional embedding space, not in the 2D/3D
projection, and copies that label along with a reliability index in [0, 1].

The curated source column (`COL`) is left untouched; three new columns are written:
`COL__pred_value` (string), `COL__pred_confidence` (float) and `COL__pred_source` (string, the
reference protein the label came from, for provenance). With `--max-distance`, a fourth,
`COL__neighbor`, says whether the query sits [near or distant](#near-or-distant) from the
references.

**The filters are optional.** With no `--query-*` and no `--reference-*` filter, transfer runs
within the bundle: every protein missing a value in a `--transfer` column is a query, and every
protein holding one is a reference. A value is missing exactly when the web app shows it as N/A
(see [Missing Values](./data-format.md#missing-values)), so a cell spelled `N/A` or `None` is filled,
never copied. Those two sets are complements of the same missing-value test, so
a protein can never be its own source, and no marker column is needed to describe "the rows that are
empty". Reach for the filters only to narrow that down, for example to label one species from
another or to hold out a labelled subset as a benchmark. Passing only one side is fine too: the other
side stays unrestricted rather than coming back empty.

A filter you do pass has to match something. An explicit rule that selects nobody fails with an
error naming that side's flags, rather than writing the bundle back unchanged. That includes a query
rule broad enough to swallow every protein the reference rule matched, since a protein matching both
explicit rules counts as a query.

```bash
# Fill every gap in the bundle from the bundle's own annotated proteins
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle

# Or narrow both sides: label the TRINITY_ assembly from curated neurotoxins only
protspace transfer \
  -b results.parquetbundle \
  -e embeddings.h5:prot_t5 \
  -t protein_category \
  -o results.parquetbundle \
  --query-id-prefix TRINITY_ \
  --reference-where 'protein_category~neurotoxin'
```

| Flag                    | Description                                                             | Default                      |
| ----------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| `-b, --bundle`          | Input `.parquetbundle`, required.                                       | -                            |
| `-e, --embeddings`      | HDF5 embeddings, required. A `:name` suffix is accepted but not needed. | -                            |
| `-t, --transfer`        | Annotation column to transfer (repeatable), required.                   | -                            |
| `-o, --output`          | Output `.parquetbundle` (may overwrite the input), required.            | -                            |
| `--k`                   | Number of nearest neighbours considered.                                | `1`                          |
| `--metric`              | Distance metric: `cosine` or `euclidean`.                               | `cosine`                     |
| `--query-id-prefix`     | Only transfer to query IDs with this prefix (repeatable).               | any protein missing a value  |
| `--query-where`         | Restrict queries to rows where `col` contains `substr` (`col~substr`).  | any protein missing a value  |
| `--reference-id-prefix` | Only use references whose ID has this prefix (repeatable).              | any protein that has a value |
| `--reference-where`     | Restrict references the same way (`col~substr`).                        | any protein that has a value |
| `--max-distance`        | Mark each query near or distant: a distance, or `auto`. See below.      | -                            |
| `--skip-distant`        | Leave distant queries unpredicted (needs `--max-distance`).             | label every query            |
| `--report`              | Also write a TSV of each query's neighbours, see below.                 | -                            |

A bundle carrying these columns renders the transferred proteins as ringed markers with their own
legend section, see [Transferred Annotations (EAT)](/explore/eat).

The output is always a format v3 bundle. A v1 or v2 input is read the way
[`protspace convert`](#protspace-convert) reads it, protein IDs included, so the transfer runs
over the proteins the web app showed: a row with no ID, or an earlier row whose ID a later row
repeats, is neither a query nor a reference. A legacy input that `convert` refuses is refused
here too, with the same reason, and nothing is written.

### Neighbour report

The bundle keeps one label, one reliability index and one source per query. `--report
predictions.tsv` also writes the neighbours they came from, as a tab-separated table with one row
per query and neighbour (with `--k 1`, one row per query). The bundle is the same with or without
it.

| Column               | Holds                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `column`             | The `--transfer` column the row belongs to.                                    |
| `query_id`           | The query protein.                                                             |
| `label`              | The transferred label (`COL__pred_value`).                                     |
| `source_id`          | The reference it came from (`COL__pred_source`).                               |
| `distance`           | The raw embedding distance from the query to `source_id`, in `--metric` units. |
| `reliability`        | The reliability index (`COL__pred_confidence`).                                |
| `rank`               | 1 for the nearest reference, up to `--k`.                                      |
| `reference_id`       | The reference at that rank; equidistant references are ordered by ID.          |
| `reference_label`    | Its value in the transferred column.                                           |
| `reference_distance` | Its distance from the query.                                                   |

Labels are written as the web app shows them, without score suffixes. With `--k > 1` the
prediction's source is the nearest reference carrying the winning label, so it need not be the
rank-1 row. To list the unknowns closest to a reference, sort the report by `distance`:

```python
import pandas as pd

report = pd.read_csv("predictions.tsv", sep="\t")
report[report["rank"] == 1].sort_values("distance")
```

### Near or distant

Transfer labels every query, however far its nearest reference is. `--max-distance` adds the
split a reference database is usually first asked for: which queries sit near a reference at all.
A query is `near` when the embedding distance to its nearest reference (of any label) is at most the
cutoff, and `distant` otherwise. The class is written to a fourth column, `COL__neighbor`, which is
empty for every protein that was not a query. It is an ordinary annotation: colour, filter and
export by it in the web app like any other.

```bash
protspace transfer -b space.parquetbundle -e emb.h5:esm2_650m -t toxin_family \
  --max-distance auto --report predictions.tsv -o space_eat.parquetbundle
```

- **`--max-distance auto`** picks the cutoff for each column from the references themselves: the
  95th percentile of every reference's distance to its nearest other reference. A query farther
  from every reference than that sits outside the reference set's own spacing. Above 10,000
  references the percentile is estimated from a fixed sample of 10,000 of them, so the same
  references always give the same cutoff. The column needs at least two references. `-v` logs the
  value chosen, and the report's `max_distance` column records it.
- **`--max-distance D`** uses a fixed distance, in `--metric` units. Distances are model-specific
  (ESM2 cosine distances are small even between unrelated proteins), so a number from one model or
  paper does not carry over to another.
- **`--skip-distant`** leaves the distant queries unpredicted: they get `COL__neighbor = distant`
  and no `__pred_*` values. Without it they keep the nearest label, as without a cutoff. When the
  cutoff leaves every query of a column distant, transfer warns: try `auto` or a larger `D`.

With `--report`, every row also carries `neighbor` (the query's class) and `max_distance` (the
cutoff used). With `--skip-distant`, a `distant` row still shows the `label` and `source_id` the
query would have been given; the bundle holds no prediction for it. Transferring a column again replaces its `COL__neighbor`, and a run without
`--max-distance` removes it, so the class never describes predictions that are gone.

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

The output is always a format v3 bundle. A v3 input keeps its data parts byte for byte and only
its settings change. A v1 or v2 input is upgraded on the way, exactly as
[`protspace convert`](#protspace-convert) would write it, and `style` logs a warning saying so,
because builds from before format v3 cannot open the result. A legacy input that `convert`
refuses is refused here too, with the same reason, and nothing is written.

## `protspace convert`

Rewrite a bundle written in format v1 or v2 as format v3. Reading v1/v2 bundles is deprecated:
they still open everywhere, with a warning, until protspace 5.0.0. `convert` itself keeps
reading them after that, so an old file can always be upgraded.

```bash
protspace convert old.parquetbundle new.parquetbundle
protspace convert old.parquetbundle --in-place
protspace convert data.parquetbundle --in-place --flatten-3d
```

| Flag            | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `--in-place`    | Overwrite the input with its v3 conversion.                                    |
| `--flatten-3d`  | Write each 3D projection as 2D, keeping its X/Y view; works on v3 bundles too. |
| `-v, --verbose` | Verbosity: `-v` = INFO, `-vv` = DEBUG.                                         |

**3D projections.** Reading them is deprecated and ends in protspace 5.0.0. `--flatten-3d` rewrites
each one as a 2D projection holding its X and Y coordinates, the view the web app shows today. For
PCA that view is the same as the 2D projection (`pca2`, up to the sign of each axis). For UMAP,
t-SNE, PaCMAP, LocalMAP and MDS it is not: each optimises the layout for the number of dimensions it
is given, so the X/Y view is the 3D layout seen from one side, where points that are far apart along
`z` can overlap. If you have the embeddings, recompute those projections with the 2D method (e.g.
`umap2`) instead. A flattened projection is renamed `<name> (X/Y)` and marked `flattened_from_3d` in
its metadata so it is not mistaken for a 2D fit, and the quality figures computed on the 3D layout
(its faithfulness and its statistics rows) are dropped. Without the flag, `convert` keeps 3D
projections and warns; from 5.0.0 it flattens them automatically.

Give either an output path or `--in-place`; the input is never overwritten otherwise. Settings
(legend colors, shapes, order) and projection statistics are kept as they are, and the file is
written atomically, so a failed run leaves the destination unchanged. A bundle that is already v3
is reported as current and nothing is written, unless `--flatten-3d` finds 3D projections in it. The internal `organism_id` and `sequence`
columns an older bundle may carry are dropped, as from every bundle ProtSpace writes.

The converted bundle holds the proteins the web app showed for the old file. Older web builds
were lenient about the protein ID column, and `convert` reads it the way they did, with a
warning each time: without a `protein_id` or `identifier` column, the first column whose name
contains `id`, `uniprot` or `entry` (else the first column) is the ID; a row with no ID is
dropped; and when two rows share an ID, the later one is kept. A bundle whose projection metadata
and projection rows name different projections, or that has two rows for one protein in one
projection, is refused with a message saying so.

Without a Python install, load the bundle at [protspace.app/explore](https://protspace.app/explore)
and export it again: the web app always exports v3. That export leaves out any protein no
projection places (an annotations row without coordinates), which `convert` keeps. See
[Legacy formats](/guide/data-format#legacy-formats-v1-and-v2).

## `protspace export`

Write a bundle as one tab-separated table, one row per protein, for a spreadsheet, R or pandas.

```bash
protspace export data.parquetbundle data.tsv
protspace export data.parquetbundle data.tsv -p "ProtT5 — UMAP 2"
```

| Flag               | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `-p, --projection` | Also write this projection's coordinates (repeatable). Default: none. |
| `-v, --verbose`    | Verbosity: `-v` = INFO, `-vv` = DEBUG.                                |

The columns are `protein_id`, then `<projection>_x` and `<projection>_y` for each `--projection`
(a 3D projection writes only this X/Y view, the one the web app shows, which is the same as the 2D
projection only for PCA; its `z` is not exported, and
reading it prints the [3D deprecation warning](#projection-methods)), then every annotation in the
order the bundle stores them. That includes the `cluster_*` membership columns
[`stats`](#protspace-stats) writes
and the `__pred_*` and `__neighbor` columns of [`transfer`](#protspace-transfer). A cell holds what
the web app shows: score and evidence suffixes are dropped, encoded characters are decoded, and the
values of a multi-valued cell are joined with `;`. Numbers and booleans are written as the web
app's Table export writes them: `true`/`false`, and `2` rather than `2.0`. Missing values, including a value spelled
`N/A`, `None` and the like (see [Missing Values](./data-format.md#missing-values)), and the
coordinates of a protein a projection does not place, are empty. Projection names are the ones the
[web app lists](#projection-naming); a name the bundle does not hold is an error that lists the
ones it does.

To export only some proteins, filter the table in pandas, or use the web app's
[Table export](/explore/exporting#table-export), which writes the proteins currently visible. The
same table is available in Python, see
[Read a bundle in Python](/guide/data-format#read-a-bundle-in-python).

## `protspace serve`

::: warning Deprecated
`protspace serve` and the `frontend` extra are deprecated and will be removed in protspace 5.0.0.
Running it prints a warning. Explore bundles at
[protspace.app/explore](https://protspace.app/explore) instead: nothing to install, drag & drop
works, and the file is read in your browser, never uploaded.
:::

Run a local Dash viewer, for offline viewing. It still renders 3D projections in 3D, the one
viewer that does; both are deprecated and go in protspace 5.0.0, so do not build on either.

```bash
protspace serve output.parquetbundle --port 8050 --pdb-zip structures.zip
```

| Flag        | Description                         | Default |
| ----------- | ----------------------------------- | ------- |
| `--port`    | Port to run the server on.          | `8050`  |
| `--pdb-zip` | ZIP file containing PDB structures. | -       |

## Upgrading from v4.4

Coming from ProtSpace 4.4, or from the v3 `protspace-local` command:

- **Custom annotations go through `prepare -a`, not `project`.** No 4.x `project` or `annotate`
  took a CSV; the route was always `prepare -a annotations.csv`. `annotate`, `stats` and `bundle`
  now take one too (see [Custom annotation files](#custom-annotation-files)), and `project -a` says
  where to go.
- **`--delimiter` is gone.** The delimiter is read from the file's header line.
- **Statistics arrived in 4.5**, as `prepare --stats` (off by default) and the `stats` step. They
  were never part of `project`.
- **`transfer` arrived in 4.6.** [Embedding Annotation Transfer](#protspace-transfer) fills an
  annotation for unlabelled proteins from their nearest labelled neighbour in embedding space.
- **The id column is still the first column**, as in 4.4 and `protspace-local`, whatever its
  header. A later column named `identifier` or `protein_id`, which used to fail the run with a
  duplicate-column error, is now kept as `identifier_annotation` or `protein_id_annotation`.
- **Every table names its id column `protein_id`.** Since 4.17, `annotate` output, the
  `.annotations.parquet` `stats -a` writes, both files of a `project` or `prepare --no-bundled`
  directory and the tables `read_tables` returns hold the protein ids in `protein_id`, where
  older releases wrote `identifier`. Files written before are still read, with a deprecation
  warning, until protspace 5.0.0. A script that reads `identifier` from such a table should read
  `protein_id`.
- **3D projections and `protspace serve` are deprecated.** Both still work, with a warning, and
  are removed in protspace 5.0.0 (tracked in
  [#544](https://github.com/tsenoner/protspace/issues/544)). If you used `umap3`, `tsne3` or any
  other `*3` method, switch to its `*2` variant; recompute the 3D projections of existing bundles
  with it when you have the embeddings, or keep their X/Y view as 2D with
  [`protspace convert --flatten-3d`](#protspace-convert) (the same as the 2D projection only for
  PCA); and explore bundles at
  [protspace.app/explore](https://protspace.app/explore) instead of with `serve`.

## See Also

- [Data Format Reference](/guide/data-format), what is inside a `.parquetbundle`
- [Annotation Reference](/guide/annotations), every annotation column ProtSpace can fetch
- [Annotation Styling](/guide/styling), colors, shapes, palettes and legend order
