# Using Google Colab

The easiest way to prepare your data for ProtSpace - no local installation required!

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Preparation.ipynb)

## Overview

The Colab notebook converts protein embeddings into a visualization-ready `.parquetbundle` file:

1. Reads your embeddings from an HDF5 file (.h5)
2. Applies dimensionality reduction (PCA, UMAP, t-SNE, PaCMAP, MDS, LocalMAP)
3. Retrieves annotations from UniProt, InterPro, and NCBI Taxonomy
4. Creates the `.parquetbundle` file ready for ProtSpace

## Quickest path: drop a FASTA

If your ProtSpace deployment runs the prep backend, you can skip the notebook entirely: drag a
`.fasta` / `.fa` / `.fna` file onto the Explore drop zone. The server embeds, projects, annotates,
and bundles your sequences, and the visualization opens automatically.

Limits enforced on this path:

| Limit                 | Value                    |
| --------------------- | ------------------------ |
| Sequences per file    | 20 minimum, 1500 maximum |
| Residues per sequence | 2000                     |
| Upload size           | 8 MB                     |
| Job wall-clock time   | 420 seconds (7 minutes)  |

Behind the scenes the service runs the same CLI subcommands you would run yourself: `protspace embed
-e prot_t5` and `protspace annotate -a default` in parallel, then `protspace project -m pca2,umap2`,
then `protspace bundle`. You get exactly the `PCA_2` and `UMAP_2` projections. Use the notebook or
the CLI for any non-default configuration (different embedder, additional projections, other
annotation sources).

::: tip
FASTA headers are normalized before embedding, so `sp|P12345|NAME_HUMAN` becomes `P12345`.
:::

::: warning Self-hosting
There is no feature flag or capability probe, the drop zone always posts to `/api/prepare`. To
enable this path on your own deployment you must run the
[prep service](https://github.com/tsenoner/protspace/blob/main/apps/prep/README.md) and build the
web app with `VITE_PREP_API_BASE` pointing at it. Without both, a FASTA drop fails with an upload
error.
:::

Unlike `.parquetbundle` loading, this path uploads your sequences to a server. See
[Importing Data](/explore/importing-data) for the full in-app flow, progress reporting, and error
handling.

## Step 1: Get Protein Embeddings

You need an HDF5 file (.h5) containing protein embeddings. There are three ways to obtain this:

### Option A: Download from UniProt (Recommended)

1. Go to [uniprot.org](https://www.uniprot.org/)
2. Search for proteins using [UniProt query syntax](https://www.uniprot.org/help/query-fields) (e.g., `(ft_domain:phosphatase) AND (reviewed:true)`)
3. Click **Download** → Select Format **Embeddings** → Submit job
4. Download the results - check UniProt's **Tools Dashboard** for the prepared embedding file

### Option B: Generate from FASTA

Use the dedicated embedding generation notebook:

[![Open Embedding Generator](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ClickThrough_GenerateEmbeddings.ipynb)

This notebook:

- Takes a FASTA file as input
- Generates embeddings using various protein language models (ProtT5, ESM2, etc.)
- Outputs an HDF5 file ready for ProtSpace

### Option C: Use Your Own Embeddings

For advanced users with custom embeddings, save them as an HDF5 file where each protein is stored as a dataset named by its identifier.

## Step 2: Run the Notebook

1. Click the Colab badge above to open the notebook
2. Run the first cell to install dependencies (~1 minute)
3. Upload your `.h5` embeddings file

## Step 3: Configure Options

### Annotations

Choose which annotations to include. They come from five sources, UniProt, InterPro, Taxonomy, TED,
and Biocentral (predicted).

See the [Annotations reference](/guide/annotations) for the complete per-column catalogue: what each
annotation means, where it comes from, and which ones are predicted.

::: tip
First-time taxonomy selection downloads a database (~1 minute).
:::

### Dimensionality Reduction

Choose which 2D projections to generate:

- **PCA** - Fast, initial overview
- **UMAP** - Best balance of speed and quality (recommended)
- **t-SNE** - Great for clusters, slower on large datasets
- **PaCMAP** - Alternative to t-SNE/UMAP
- **MDS** - Preserves pairwise distances
- **LocalMAP** - Local-first alternative to PaCMAP

### Parameters (Optional)

Fine-tune settings for each method:

| Method   | Parameters                      |
| -------- | ------------------------------- |
| UMAP     | N Neighbors, Min Dist           |
| t-SNE    | Perplexity, Learning Rate       |
| PaCMAP   | N Neighbors, MN Ratio, FP Ratio |
| MDS      | N Init, Max Iter                |
| LocalMAP | N Neighbors, MN Ratio, FP Ratio |

## Step 4: Generate and Download

1. Click **"Generate Bundle"**
2. Wait for processing (time depends on dataset size)
3. Download your `.parquetbundle` file

## Step 5: Visualize in ProtSpace

1. Go to [protspace.app/explore](https://protspace.app/explore)
2. Drag & drop your `.parquetbundle` file onto the scatterplot
3. Start exploring!

## Tips

- **Start small**: Test with a subset of proteins first.
- **PCA is fastest**: All methods except PCA become significantly slower with larger datasets (quadratic or worse complexity).
- **Try multiple methods**: For best results, include both PCA and UMAP.

## Alternative: Python CLI

For local processing, automation, or larger datasets, see the [Python CLI guide](/guide/python-cli).
