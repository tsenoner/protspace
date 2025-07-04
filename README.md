# ProtSpace

ProtSpace is a visualization tool for exploring **protein embeddings** or **similarity matrix** along their 3D protein structures. It allows users to interactively visualize high-dimensional protein language model data in 2D or 3D space, color-code proteins based on various features, and view protein structures when available.

## Web Interface
Try ProtSpace directly in your browser without installation:
https://protspace.rostlab.org/

## Quick Start with Google Colab

Try ProtSpace instantly using our Google Colab notebooks:

**Note**: Some Google Colab functionalities may not work properly in Safari browsers. For the best experience, we recommend using Chrome or Firefox.

1. **Explore Pre-computed Visualizations**:
[![Open Explorer In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/Explore_ProtSpace.ipynb)

2. **Generate Protein Embeddings**:
[![Open Embeddings In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/ClickThrough_GenerateEmbeddings.ipynb)

3. **Full Pipeline Demo**:
[![Open Pipeline In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/Run_ProtSpace.ipynb)

4. **Interactive Pfam & Clan Explorer**:
[![Open Pfam Explorer In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/PfamExplorer_ProtSpace.ipynb)

## Table of Contents

- [ProtSpace](#protspace)
  - [Web Interface](#web-interface)
  - [Quick Start with Google Colab](#quick-start-with-google-colab)
  - [Table of Contents](#table-of-contents)
  - [Example Outputs](#example-outputs)
    - [2D Scatter Plot (SVG)](#2d-scatter-plot-svg)
    - [3D Interactive Plot](#3d-interactive-plot)
  - [Installation](#installation)
  - [Usage](#usage)
    - [Data Preparation](#data-preparation)
    - [Running protspace](#running-protspace)
  - [Features](#features)
  - [Data Preparation](#data-preparation-1)
    - [Required Arguments](#required-arguments)
    - [Optional Arguments](#optional-arguments)
    - [Method-Specific Parameters](#method-specific-parameters)
  - [Custom Feature Styling](#custom-feature-styling)
  - [File Formats](#file-formats)
    - [Input](#input)
    - [Output](#output)
  - [Citation](#citation)

## Example Outputs

### 2D Scatter Plot (SVG)

![2D Scatter Plot Example](https://tsenoner.github.io/protspace/examples/out/toxins/protein_category_umap.svg)

### 3D Interactive Plot

[View 3D Interactive Plot](https://tsenoner.github.io/protspace/examples/out/3FTx/UMAP3_major_group.html)

## Installation

There are two installation options:

1. **Basic Installation** (dimensionality reduction only):
```bash
pip install protspace
```

2. **Full Installation** (including visualization interface):
```bash
pip install "protspace[frontend]"
```

## Usage

### UniProt Query

Search and analyze proteins directly from UniProt using exact UniProt query syntax:

```bash
# Human insulin
protspace-query -q "insulin AND organism_id:9606 AND reviewed:true" -o output_dir --methods pca3,umap2,tsne2

# All kinases from human with legacy format (non binary files)
protspace-query -q "kinase AND organism_id:9606" -o kinases_dir --methods umap2,tsne3 --non-binary

# Toxins from any organism (keeping temporary files)
protspace-query -q "toxin AND reviewed:true" -o toxins_dir --methods pca2,umap3 --keep-tmp
```

### Data Preparation

Process local embeddings or similarity matrices:

```bash
protspace-local -i embeddings.h5 -m features.csv -o output.json --methods pca3,umap2,tsne2
```

### Running protspace

```bash
protspace --json output.json [--pdb_zip pdb_files.zip] [--port 8050]
```

Access the interface at `http://localhost:8050`

## Features

- Interactive 2D/3D visualization with multiple dimensionality reduction methods:
  - Principal Component Analysis (PCA)
  - Multidimensional Scaling (MDS)
  - Uniform Manifold Approximation and Projection (UMAP)
  - t-Distributed Stochastic Neighbor Embedding (t-SNE)
  - Pairwise Controlled Manifold Approximation (PaCMAP)
- Feature-based coloring and marker styling
- Protein structure visualization (with PDB files)
- Search and highlight functionality
- High-quality plot exports (SVG for 2D, interactive HTML for 3D)
- Responsive web interface

## Data Preparation

ProtSpace supports multiple data preparation methods:

### UniProt Query Processing

The `protspace-query` command searches UniProt and processes results automatically:

#### Required Arguments

- `-q, --query`: UniProt search query with exact UniProt syntax (e.g., 'insulin AND organism_id:9606 AND reviewed:true')
- `-o, --output`: Output directory
- `--methods`: Comma-separated reduction methods (e.g., pca2,tsne3,umap2,pacmap2,mds2)

#### Optional Arguments

- `--non-binary`: Not to use binary formats (legacy mode)
- `-m, --metadata`: Features to extract (comma-separated list, e.g., 'annotation_score,genus,protein_existence') default to all the available features.
- `--keep-tmp`: keeps the temporary files
- `--verbose`: Increase output verbosity

### Local Data Processing

The `protspace-local` command supports:

#### Required Arguments

- `-i, --input`: HDF file (.h5) or similarity matrix (.csv)
- `-m, --metadata`: CSV file with features (first column must be named "identifier" and match IDs in HDF5/similarity matrix) or comma-separated features, which will be fetched automatically.
- `-o, --output`: Output directory
- `--methods`: Comma-separated reduction methods (e.g., pca2,tsne3,umap2,pacmap2,mds2)

#### Optional Arguments

- `--non-binary`: Not to use binary formats (legacy mode)
- `--delimiter`: Specify delimiter for metadata file (default: comma)
- `--custom_names`: Custom projection names (e.g., pca2=PCA_2D)
- `--verbose`: Increase output verbosity

### Method-Specific Parameters

Both `protspace-query` and `protspace-local` support the following reduction method parameters:

- UMAP:
  - `--n_neighbors`: Number of neighbors (default: 15)
  - `--min_dist`: Minimum distance (default: 0.1)
- t-SNE:
  - `--perplexity`: Perplexity value (default: 30)
  - `--learning_rate`: Learning rate (default: 200)
- PaCMAP:
  - `--mn_ratio`: MN ratio (default: 0.5)
  - `--fp_ratio`: FP ratio (default: 2.0)
- MDS:
  - `--n_init`: Number of initializations (default: 4)
  - `--max_iter`: Maximum iterations (default: 300)
  - `--eps`: Convergence tolerance (default: 1e-3)

## Custom Feature Styling

Use `protspace-feature-colors` to customize feature appearance:

```bash
protspace-feature-colors input.json output.json --feature_styles '{
  "feature_name": {
    "colors": {
      "value1": "#FF0000",
      "value2": "#00FF00"
    },
    "shapes": {
      "value1": "circle",
      "value2": "square"
    }
  }
}'
```

Available shapes: circle, circle-open, cross, diamond, diamond-open, square, square-open, x

## File Formats

### Input

1. **UniProt Query** (for `protspace-query`)
  - UniProt search query with exact syntax (e.g., 'insulin AND organism_id:9606 AND reviewed:true')
  - Automatically downloads FASTA sequences
  - Generates similarity matrix using pymmseqs
  - Fetches UniProt features automatically

2. **Local Embeddings/Similarity** (for `protspace-local`)
  - HDF5 (.h5) for embeddings
  - CSV for similarity matrix

3. **Metadata** (for `protspace-local`)
  - CSV with mandatory 'identifier' column matching IDs in embeddings/similarity data
  - Additional columns for features

4. **Structures** (optional)
  - ZIP containing PDB/CIF files
  - Filenames match identifiers (dots replaced with underscores)

### Output

#### protspace-query

- Directory of parquet files:
  - projections_data.parquet
  - projections_metadata.parquet
  - selected_features.parquet
    - These are selected features specified using `-m` option, if not using `-m` option, it is exactly the all_features.parquet file.
  - if used `--keep-tmp` flag the files below are also included:
    - all_features.parquet (fetched from UniProt)
    - sequences.fasta (fetched from UniProt)
    - similarity_matrix.csv (generated by PyMMseqs)

- With `--non-binary` flag (legacy version):
  - selected_features_projections.json (containes selected features and projections data)
  - if used `--keep-tmp` flag the files below are also included:
    - all_features.csv
    - sequences.fasta
    - similarity_matrix.csv

#### protspace-local

- Directory of parquet files:
  - projections_data.parquet
  - projections_metadata.parquet
  - selected_features.parquet
    - These are selected features specified using `-m` option, if not using `-m` option, it is exactly the all_features.parquet file.
  - if used `--keep-tmp` flag the files below are also included:
    - all_features.parquet (fetched from UniProt)

- With `--non-binary` flag (legacy version):
  - selected_features_projections.json (containes selected features and projections data)
  - if used `--keep-tmp` flag the files below are also included:
    - all_features.csv

## Citation

If you use ProtSpace in your research, please cite:

```bibtex
@article{SENONER2025168940,
title = {ProtSpace: A Tool for Visualizing Protein Space},
journal = {Journal of Molecular Biology},
pages = {168940},
year = {2025},
issn = {0022-2836},
doi = {https://doi.org/10.1016/j.jmb.2025.168940},
url = {https://www.sciencedirect.com/science/article/pii/S0022283625000063},
author = {Tobias Senoner and Tobias Olenyi and Michael Heinzinger and Anton Spannagl and George Bouras and Burkhard Rost and Ivan Koludarov}
}
```