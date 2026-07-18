# ProtSpace

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark/wordmark-black.svg">
    <img src="docs/assets/wordmark/wordmark.svg" alt="ProtSpace" width="360">
  </picture>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PyPI](https://img.shields.io/pypi/v/protspace)](https://pypi.org/project/protspace/)
[![Downloads](https://static.pepy.tech/badge/protspace)](https://pepy.tech/project/protspace)
[![Website](https://img.shields.io/badge/website-protspace.app-2ea44f)](https://protspace.app)
[![DOI (preprint)](https://img.shields.io/badge/bioRxiv-10.64898%2F2026.05.04.722720-b31b1b)](https://doi.org/10.64898/2026.05.04.722720)
[![DOI (JMB)](https://img.shields.io/badge/DOI-10.1016%2Fj.jmb.2025.168940-blue)](https://doi.org/10.1016/j.jmb.2025.168940)

ProtSpace is a free, in-browser tool for exploring protein language model (pLM) embeddings. Project embeddings into an interactive map to surface relationships that sequence similarity misses, overlay biological annotations, transfer labels to unannotated proteins with a confidence score (EAT), inspect 3D structures, and export publication-ready figures — at Swiss-Prot scale, with nothing uploaded.

## 🌐 Try it online

**[protspace.app](https://protspace.app/)** — drag & drop a `.parquetbundle` file to start exploring (or a `.fasta` for instant preparation on supported deployments). Everything runs client-side; your data never leaves your machine.

## 🚀 Prepare your data

**Option 1: Google Colab** _(no local installation)_

Generate `.parquetbundle` files directly in your browser:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/tsenoner/protspace/blob/main/apps/protspace/notebooks/ProtSpace_Preparation.ipynb)

**Option 2: ProtSpace Python package** _(local installation)_

```bash
pip install protspace

# Build a visualization bundle from your embeddings (HDF5)
protspace prepare -i embeddings.h5 -m pca2,umap2 -o output

# ...or from a FASTA file (auto-embeds via the Biocentral API)
protspace prepare -i sequences.fasta -e prot_t5 -m pca2 -o output
```

See the [ProtSpace Python package](https://github.com/tsenoner/protspace/tree/main/apps/protspace) for the full CLI (annotation transfer, quality metrics, 12+ pLMs, and more).

## 📚 Documentation

**[Full documentation](https://protspace.app/docs/)** — user guides, data preparation, and feature explanations.

## 📖 How to cite

If you use **ProtSpace**, please cite the web application preprint (latest):

> Senoner, T., Vahidi, P., Olenyi, T., Senoner, F., Sisman, G., Kahl, E., Rost, B., & Koludarov, I. (2026). ProtSpace: Protein Universe in Your Browser. _bioRxiv_. https://doi.org/10.64898/2026.05.04.722720

The original, peer-reviewed ProtSpace publication:

> Senoner, T., Olenyi, T., Heinzinger, M., Spannagl, A., Bouras, G., Rost, B., & Koludarov, I. (2025). ProtSpace: A Tool for Visualizing Protein Space. _Journal of Molecular Biology_, 437(15), 168940. https://doi.org/10.1016/j.jmb.2025.168940

A machine-readable [`CITATION.cff`](CITATION.cff) is included — use GitHub's **"Cite this repository"** button to export BibTeX or APA.
