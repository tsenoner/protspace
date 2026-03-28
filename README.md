# ProtSpace

[![PyPI version](https://badge.fury.io/py/protspace.svg)](https://badge.fury.io/py/protspace)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Downloads](https://pepy.tech/badge/protspace)](https://pepy.tech/project/protspace)
[![DOI](https://img.shields.io/badge/DOI-10.1016%2Fj.jmb.2025.168940-blue)](https://doi.org/10.1016/j.jmb.2025.168940)

ProtSpace is a visualization tool for exploring **protein embeddings** or **similarity matrices**. It projects high-dimensional protein language model data into 2D space, color-codes proteins by biological annotations, and exports publication-ready figures.

- **Multiple projections**: PCA, UMAP, t-SNE, MDS, PaCMAP, LocalMAP
- **Automatic annotations**: UniProt, InterPro, and Taxonomy
- **Structure viewer**: Integrated protein structure visualization
- **Export**: PNG, PDF, SVG, HTML

## 🌐 Try Online

**[ProtSpace Web](https://protspace.app/explore)** _(recommended)_: Fast 2D explorer optimized for large datasets — drag & drop `.parquetbundle` files ([source](https://github.com/tsenoner/protspace_web))

**[Legacy Dash frontend](https://protspace.rostlab.org/)**: Original interface with 3D support (slow with large datasets)

## 🚀 Google Colab Notebooks

**Note**: Use Chrome or Firefox for best experience.

1. **Generate Protein Embeddings**: [![Open Embeddings In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/notebooks/ClickThrough_GenerateEmbeddings.ipynb)

2. **Prepare ProtSpace Bundle**: [![Open Preparation In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/notebooks/ProtSpace_Preparation.ipynb)


## 📦 Installation

```bash
pip install protspace
```

## 🎯 Quick Start

### 1. Prepare data

```bash
# From HDF5 embeddings
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output

# From FASTA (auto-embeds via Biocentral API)
protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output

# Multi-model comparison (12 pLMs supported)
protspace prepare -i sequences.fasta -e prot_t5,esm2_650m,ankh_base -m pca2,umap2 -o output
```

### 2. Explore results

Upload the generated `.parquetbundle` file at [protspace.app/explore](https://protspace.app/explore).

### 3. Power-user workflow (individual steps)

```bash
protspace embed -i sequences.fasta -e prot_t5 -e esm2_3b -o embeddings/
protspace project -i embeddings/prot_t5.h5 -i embeddings/esm2_3b.h5 -m pca2,umap2 -o projections/
protspace annotate -i embeddings/prot_t5.h5 -a default -o annotations.parquet
protspace bundle -p projections/ -a annotations.parquet -o output.parquetbundle
```

## 📊 Example Output

![2D Example](docs/protspace_example.png)

## ✨ Annotations

Use `-a` to color-code proteins by UniProt, InterPro, or Taxonomy annotations. Groups (`default`, `all`, `uniprot`, `interpro`, `taxonomy`) and individual names can be mixed freely. If `-a` is omitted, the `default` group is used.

```bash
protspace prepare -i data.h5 -m pca2                              # default annotations
protspace prepare -i data.h5 -a default,interpro,kingdom -m pca2  # mix groups + individual
```

## 📖 Documentation

- [Annotation Reference](docs/annotations.md) — full list of annotations, groups, data sources, output formats
- [Annotation Styling](docs/styling.md) — custom colors, shapes, sort modes, and the `--generate-template` workflow
- [CLI Reference](docs/cli.md) — command options, method parameters, file formats

## 📝 Citation

Senoner T, Olenyi T, Heinzinger M, Spannagl A, Bouras G, Rost B, Koludarov I. ProtSpace: A Tool for Visualizing Protein Space. *Journal of Molecular Biology*, 168940, 2025. [doi:10.1016/j.jmb.2025.168940](https://doi.org/10.1016/j.jmb.2025.168940)
