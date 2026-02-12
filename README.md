# ProtSpace

[![PyPI version](https://badge.fury.io/py/protspace.svg)](https://badge.fury.io/py/protspace)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Downloads](https://pepy.tech/badge/protspace)](https://pepy.tech/project/protspace)
[![DOI](https://img.shields.io/badge/DOI-10.1016%2Fj.jmb.2025.168940-blue)](https://doi.org/10.1016/j.jmb.2025.168940)

ProtSpace is a visualization tool for exploring **protein embeddings** or **similarity matrices** along their 3D protein structures. It allows users to interactively visualize high-dimensional protein language model data in 2D or 3D space, color-code proteins based on various annotations, and view protein structures when available.

## 🌐 Try Online

**Web Interface**: https://protspace.rostlab.org/

**New JavaScript Frontend** _(in development)_: https://tsenoner.github.io/protspace_web -> Drag & drop `.parquetbundle` files

## 🚀 Quick Start with Google Colab

**Note**: Use Chrome or Firefox for best experience.

1. **Explore Pre-computed Visualizations**: [![Open Explorer In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/Explore_ProtSpace.ipynb)

2. **Generate Protein Embeddings**: [![Open Embeddings In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/ClickThrough_GenerateEmbeddings.ipynb)

3. **Full Pipeline Demo**: [![Open Pipeline In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/Run_ProtSpace.ipynb)

4. **Pfam & Clan Explorer**: [![Open Pfam Explorer In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/examples/notebook/PfamExplorer_ProtSpace.ipynb)

## 📦 Installation

```bash
# Basic installation (backend - dimensionality reduction only)
pip install protspace

# Full installation (backend + frontend - including visualization interface)
pip install "protspace[frontend]"
```

## 🎯 Quick Start

### 1. Query UniProt directly

```bash
# Retrieve and analyze proteins from UniProt using sequence similarity (mmmseqs2)
protspace-query -q "(ft_domain:phosphatase) AND (reviewed:true)" -o output_dir -m pca2,pca3,umap2 --annotations "protein_families,fragment,kingdom,superfamily,panther,cath" --n_neighbors 30 --min_dist 0.4
```

### 2. Process local data

```bash
# Analyse and vizualise your locally stored embeddings
protspace-local -i embeddings.h5 -o output_dir -m pca2,umap2
```

### 3. Launch visualization

```bash
protspace output_dir
```

Access at `http://localhost:8050`

## 📊 Example Outputs

### 2D Scatter Plot

![2D Example](https://tsenoner.github.io/protspace/examples/out/toxins/protein_category_umap.svg)

### 3D Interactive Plot

[View 3D Example](https://tsenoner.github.io/protspace/examples/out/3FTx/UMAP3_major_group.html)

## ✨ Annotations

- **Multiple projections**: PCA, UMAP, t-SNE, MDS, PaCMAP in 2D/3D
- **Automatic annotation extraction**: Use `-a` to color-code proteins by UniProt, InterPro, or Taxonomy annotations
- **3D structure viewer**: Integrated protein structure visualization
- **Export**: SVG (2D) and HTML (3D) formats

### Available Annotations (use with `-a`)

If `-a` is not specified, all available annotations are retrieved.

**UniProt**: `annotation_score`, `cc_subcellular_location`, `ec`, `fragment`, `gene_name`, `go_c`, `go_f`, `go_p`, `keyword`, `length_fixed`, `length_quantile`, `protein_existence`, `protein_families`, `reviewed`, `xref_pdb`

**InterPro**: `cath`, `cdd`, `panther`, `pfam`, `prints`, `prosite`, `signal_peptide`, `smart`, `superfamily` (includes signature names and confidence scores in pipe-separated format: `accession (name)|score1,score2;accession2 (name2)|score1`)

**Taxonomy**: `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`

Examples:

```bash
# Extract Pfam, CATH, PANTHER domains and subcellular location
protspace-local -i data.h5 --annotations pfam,cath,panther,cc_subcellular_location

# Extract reviewed status, length, and taxonomy
protspace-query -q "..." --annotations reviewed,length_quantile,kingdom
```

## 🔧 Advanced Usage

### Command Options

**protspace-local** (Local data):

- `-i, --input`: HDF5 file(s)/directory or CSV similarity matrix (required, supports multiple inputs)
- `-o, --output`: Output file or directory (optional, default: derived from input filename)
- `-a, --annotations`: Annotations to extract (comma-separated) or CSV metadata file path
- `-m, --methods`: Reduction methods (e.g., `pca2,umap3,tsne2`)
- `--non-binary`: Use legacy JSON format
- `--keep-tmp`: Cache intermediate files for reuse
- `--bundled`: Bundle output files (true/false, default: true)

**protspace-query** (UniProt search):

- `-q, --query`: UniProt search query (required)
- `-o, --output`: Output file or directory (optional, default: `protspace.parquetbundle`)
- `-a, --annotations`: Annotations to extract (comma-separated)
- `-m, --methods`: Reduction methods (e.g., `pca2,umap3,tsne2`)
- `--non-binary`: Use legacy JSON format
- `--keep-tmp`: Cache intermediate files for reuse
- `--bundled`: Bundle output files (true/false, default: true)

### Method Default Parameters

Following the default parameters for each method. Override these to fine-tune dimensionality reduction:

- **UMAP**: `--n_neighbors 15 --min_dist 0.1`
- **t-SNE**: `--perplexity 30 --learning_rate 200`
- **PaCMAP**: `--mn_ratio 0.5 --fp_ratio 2.0`
- **MDS**: `--n_init 4 --max_iter 300 --eps 1e-3`

### Custom Styling

```bash
protspace-annotation-colors input.json output.json --annotation_styles '{
  "annotation_name": {
    "colors": {"value1": "#FF0000", "value2": "#00FF00"},
    "shapes": {"value1": "circle", "value2": "square"}
  }
}'
```

Available shapes: `circle`, `circle-open`, `cross`, `diamond`, `diamond-open`, `square`, `square-open`, `x`

## 📁 File Formats

### Input

- **UniProt queries**: Text queries using UniProt syntax
- **Embeddings**: HDF5 files (.h5, .hdf5, .hdf) - supports single/multiple files and directories
- **Similarity matrices**: CSV files with symmetric matrices
- **Metadata**: CSV with protein identifiers in the first column + annotation columns
- **Structures**: ZIP files containing PDB/CIF files

### Output

- **Default**: Parquet files (projections_data.parquet, projections_metadata.parquet, selected_annotations.parquet)
- **Legacy**: JSON format with `--non-binary` flag
- **Temporary files**: FASTA sequences, similarity matrices, all annotations (with `--keep-tmp`)

## 📝 Citation

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
