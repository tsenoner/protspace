# ProtSpace Web

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark/wordmark-black.svg">
    <img src="docs/assets/wordmark/wordmark.svg" alt="ProtSpace" width="360">
  </picture>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![DOI (preprint)](https://img.shields.io/badge/bioRxiv-10.64898%2F2026.05.04.722720-b31b1b)](https://doi.org/10.64898/2026.05.04.722720)
[![DOI (JMB)](https://img.shields.io/badge/DOI-10.1016%2Fj.jmb.2025.168940-blue)](https://doi.org/10.1016/j.jmb.2025.168940)

ProtSpace Web is a browser-based visualization tool for exploring protein language model (pLM) embeddings. Built with modular web components (canvas renderer, interactive legend, control bar), it enables interactive exploration through dimensionality reduction methods (PCA, UMAP, t-SNE) with zoom, pan, and selection. Color by annotations, view 3D protein structures, and export images or data files for sharing.

## 🌐 Try Online

**Demo**: https://protspace.app/ → Drag & drop `.parquetbundle` files (or a `.fasta` for instant prep on supported deployments)

## 🚀 Prepare Your Data

**Option 1: Google Colab** _(no local installation needed)_

Generate `.parquetbundle` files directly in your browser:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Preparation.ipynb)

**Option 2: Python ProtSpace** _(local installation)_

```bash
pip install protspace

# Query UniProt and generate visualization files
protspace-query -q "(ft_domain:phosphatase) AND (reviewed:true)" -o output_dir

# Or use your own embeddings
protspace-local -i embeddings.h5 -o output_dir
```

See the [Python ProtSpace repository](https://github.com/tsenoner/protspace) for details.

## 📚 Documentation

**[Full Documentation](https://protspace.app/docs/)** - User guides, data preparation, and feature explanations.

## 🔧 Development

```bash
git clone https://github.com/tsenoner/protspace.git
cd protspace
pnpm install
pnpm dev  # App: http://localhost:8080 | Docs: http://localhost:5174/docs/
```

## 🧹 Code Quality

Before committing, run:

```bash
pnpm precommit
```

This matches the installed local Git hook by running `lint-staged`, repo-wide type checks, Knip,
dependency-hygiene checks, the local unit/integration test suite, and a docs build.

For a faster static-only pass while you are iterating, run:

```bash
pnpm quality
```

## 📖 How to cite

If you use **ProtSpace**, please cite the web application preprint (latest):

> Senoner, T., Vahidi, P., Olenyi, T., Senoner, F., Sisman, G., Kahl, E., Rost, B., & Koludarov, I. (2026). ProtSpace: Protein Universe in Your Browser. _bioRxiv_. https://doi.org/10.64898/2026.05.04.722720

The original ProtSpace tool paper (peer-reviewed):

> Senoner, T., Olenyi, T., Heinzinger, M., Spannagl, A., Bouras, G., Rost, B., & Koludarov, I. (2025). ProtSpace: A Tool for Visualizing Protein Space. _Journal of Molecular Biology_, 437(15), 168940. https://doi.org/10.1016/j.jmb.2025.168940

A machine-readable [`CITATION.cff`](CITATION.cff) is included — use GitHub's **"Cite this repository"** button to export BibTeX or APA.
