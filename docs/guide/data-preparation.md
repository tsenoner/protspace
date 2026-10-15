# Using Google Colab

The easiest way to prepare your data for ProtSpace - no local installation required!

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Preparation.ipynb)

## Overview

The Colab notebook converts protein embeddings into a visualization-ready `.parquetbundle` file:

1. Reads your input: an example dataset, embeddings from an HDF5 file (.h5), sequences from a FASTA
   file (embedded for you), or a UniProt query
2. Applies 2-D dimensionality reduction (PCA, UMAP, t-SNE, PaCMAP, MDS, LocalMAP)
3. Retrieves annotations from UniProt, InterPro, Taxonomy, TED, and Biocentral
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

You do not need to name the model behind any of these files. The notebook's **Embedder** choice
defaults to **Auto-detect**, which reads the file's `model_name` attribute (the Embeddings notebook
writes it), else a model key at the end of the file name (`toxins_esm2_650m.h5` is `esm2_650m`),
else the file name itself. The name labels the projections; pick the embedder by hand if the
label comes out wrong. The same rules apply in the [CLI](/guide/python-cli#model-name-resolution-i-file-h5-name).

## Step 2: Run the Notebook

1. Click the Colab badge at the top of this page to open the notebook
2. Choose **Runtime → Run all**. Setup takes about 30 seconds, then the control panel appears.
   Run all never stops to ask for a file, and building the panel downloads nothing: the
   example dataset is fetched when you click **Generate**
3. Get your file into the Colab runtime, if you use one, in any of three ways:
   - **Upload cell**: tick the box in **Optional: upload a file from your computer**, run that
     cell and pick the file. It lands in a new `upload-…` folder, so a corrected file uploaded
     under the same name is the one the panel loads, and its path fills the matching field in
     the panel. Untick it afterwards, or the next Run all asks for a file again
   - **Files pane**: drag the file into the folder icon in Colab's left sidebar; it lands in
     `/content/`
   - **Google Drive**: mount it from the Files pane and use the `/content/drive/MyDrive/...` path

   Large files are fine on all three routes. The panel itself never uploads an `.h5` or FASTA
   through a widget, because widget uploads of about 10 MB and up fail without an error.

4. In the panel's **1 · Input data** section, open the tab you want:
   - **Example Dataset**: one of the pre-computed ProtT5 datasets
   - **Upload H5**: enter the file's path, click **Load**, and check the **Ready** line, which
     shows the protein count, the dimensions and the embedding name
   - **Upload FASTA**: enter the path and click **Load**, then select the embedder(s) and the
     embedding backend below the tabs
   - **UniProt Query**: type a query and click **Set Query**, then select the embedder(s)

## Step 3: Configure Options

### Annotations

Choose which annotations to include. They come from five sources: UniProt, InterPro, Taxonomy, TED,
and Biocentral (predicted).

See the [Annotations reference](/guide/annotations) for the complete per-column catalogue: what each
annotation means, where it comes from, and which ones are predicted.

To add your own columns, give a CSV or TSV (gzipped is fine) with the protein IDs in its first
column, whatever that column is called (the full rules are under
[Custom annotation files](/guide/python-cli#custom-annotation-files)): enter its path, or choose it
with **Choose CSV/TSV**. Pick **CSV only (no UniProt fetch)** to use just those columns, for example
when your IDs are not UniProt accessions.

### Dimensionality Reduction

Choose which 2-D projections to generate:

- **PCA** - Fast, initial overview
- **UMAP** - Best balance of speed and quality (recommended)
- **t-SNE** - Great for clusters, slower on large datasets
- **PaCMAP** - Alternative to t-SNE/UMAP
- **MDS** - Preserves pairwise distances
- **LocalMAP** - Local-first alternative to PaCMAP

### Parameters (Optional)

Fine-tune settings for each method. The defaults are the CLI's:

| Method   | Parameters                                                              |
| -------- | ----------------------------------------------------------------------- |
| UMAP     | N Neighbors, Min Dist, Metric                                           |
| t-SNE    | Perplexity, Learning Rate, Metric                                       |
| PaCMAP   | N Neighbors, MN Ratio, FP Ratio                                         |
| MDS      | None in the notebook; `--n-init`, `--max-iter` and `--eps` are CLI-only |
| LocalMAP | N Neighbors, MN Ratio, FP Ratio                                         |

### Quality statistics (Optional)

Tick **Compute quality statistics** to score how well your annotations separate, and how faithfully
each projection preserves the original embedding. This is the notebook's equivalent of the CLI's
`--stats` flag. It is off by default, and the cost grows with dataset size.

ProtSpace renders these scores in the legend and the projection metadata panel. See
[Separation Scores](/explore/separation-scores).

## Step 4: Generate and Download

1. Click **Generate**. It runs on the input tab that is open; if that tab has nothing loaded it
   says so and runs nothing. It first prints the input it runs on, with the protein count
2. Wait for processing (time depends on dataset size). The button is disabled until the run
   ends, and progress lines appear below it
3. The `.parquetbundle` downloads to your computer. If the browser blocks it, take it from the
   Colab Files pane under `output/`

## Optional: fill missing annotations (EAT)

The Preparation notebook has an **Embedding Annotation Transfer** panel below the Generate button.
It fills blank annotation values on your query proteins from their nearest annotated neighbour in
embedding space, with a reliability score attached. The
[Transfer notebook](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Transfer.ipynb)
runs the same transfer on its own, using the `protspace transfer` CLI.

Transferred values get their own legend section and their own marker style in the plot, so you can
always tell them apart from curated ones. See [Transferred Annotations (EAT)](/explore/eat).

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
