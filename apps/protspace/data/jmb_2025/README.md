# JMB 2025 figure data (archive)

Archived inputs and outputs behind the figures in the original ProtSpace
publication, kept for backwards compatibility and reproducibility:

> Senoner T, Olenyi T, Heinzinger M, Spannagl A, Bouras G, Rost B, Koludarov I.
> **ProtSpace: A Tool for Visualizing Protein Space.** *J Mol Biol* (2025).
> DOI: [10.1016/j.jmb.2025.168940](https://doi.org/10.1016/j.jmb.2025.168940)
> Submitted 30 Nov 2024 · Accepted 7 Jan 2025 · Online 10 Jan 2025

These files were added to the repo in commit `7c0442e` (2024-11-28, inside the
submission window) and later removed during the Oct 2025 data cleanup. This
directory is a frozen archive — do not regenerate it against current UniProt.

## `toxprot/` — venom-toxin dataset

- **5,181 proteins** — reviewed (Swiss-Prot) Metazoan venom/toxin entries from
  the UniProt Animal Toxin Annotation Project (ToxProt).
- **Embeddings:** ProtT5 (`Rostlab/prot_t5_xl_uniref50`, 1024-dim), computed on
  **mature sequences** — i.e. with the signal peptide cleaved.
- Features per protein: taxonomic `Order` / `Family` / `Genus`, the curated
  `protein_category`, and the raw UniProt `Protein families` string. The
  category mapping (conotoxin, three_finger_toxin, phospholipase_a2, …) is
  defined by the regex rules in the original `process_toxin.ipynb` notebook.

### Files

| File | Description |
|------|-------------|
| `toxins.json` | ProtSpace JSON — projections (PCA/UMAP/PaCMAP) + features for all 5,181 proteins |
| `toxins_style.json` | `toxins.json` with manual styling applied |
| `toxins_seq_sim.json` | Sequence-similarity variant — MDS + UMAP on a BLAST distance matrix |
| `toxins_seq_sim_style.json` | Styled sequence-similarity variant |
| `toxins_prott5.h5` | ProtT5 embeddings, keyed by UniProt accession (5,181 × 1024) |
| `toxins.csv` | Per-protein annotations: identifier, Order, Family, Genus, protein_category, Protein families |
| `toxins_all.csv` | Wider annotation table incl. protein names and clustering labels |
| `toxins_full.fasta` | **Reconstructed** full UniProt sequences (signal peptide included) |
| `toxins_mature.fasta` | **Reconstructed** mature sequences (signal peptide cleaved — the actual embedding input) |
| `rebuild_mature_fasta.py` | Script that regenerated the FASTAs from the `.h5` accessions |

### Dimensionality-reduction parameters (as used in the figures)

Recovered from the projection metadata embedded in the JSON files.

**Embedding-based** (`toxins.json`, on ProtT5 embeddings):

| Method | Parameters |
|--------|------------|
| PCA 2D / 3D | `n_components=2` / `3` |
| UMAP 2D / 3D | `n_neighbors=50`, `min_dist=0.5`, `metric=euclidean` |
| PaCMAP 2D / 3D | `n_neighbors=50`, `MN_ratio=0.5`, `FP_ratio=2.0` |

**Sequence-similarity-based** (`toxins_seq_sim.json`, on a BLAST distance matrix):

| Method | Parameters |
|--------|------------|
| MDS 2D | `n_init=4`, `max_iter=300`, `eps=0.001` |
| UMAP 2D | `n_neighbors=25`, `min_dist=0.5`, `metric=euclidean` |
| `bits_umap2` / `evalue_umap2` 2D | `n_neighbors=25`, `min_dist=0.5`, `metric=euclidean` (BLAST bit-score / e-value distances) |

### Note on the FASTAs

The original input FASTA was **never committed** — it lived only in an untracked
`raw_data/` directory (`toxins.tsv`, `noise.csv`,
`mature_seqs_prot_t5_xl_uniref50.h5`). No tracked file from 2024 contains
sequences: the `.h5` stores embedding vectors keyed by accession, and the CSVs
carry annotations only.

`toxins_full.fasta` and `toxins_mature.fasta` are therefore **reconstructions**:
`rebuild_mature_fasta.py` takes the 5,181 accessions (the `.h5` keys), re-fetches
each entry's sequence and signal-peptide annotation from UniProt, and writes both
the full sequence and the signal-peptide-stripped mature sequence (the latter is
what was embedded). Because UniProt entries can change over time, these are
faithful but not guaranteed byte-identical to the November 2024 input.

Reconstruction result: **5,179 / 5,181** sequences recovered (3,532 had a signal
peptide cleaved in the mature file). 2 accessions are now obsolete/merged and
could not be retrieved: `D5KR58`, `Q2PE51`.
