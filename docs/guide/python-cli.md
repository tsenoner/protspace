# Using Python CLI

For local processing or automation, use the ProtSpace Python package.

## Installation

```bash
pip install protspace
```

## Quick Start

### From a UniProt Query

```bash
protspace prepare -q "(ft_domain:kinase) AND (reviewed:true)" -m pca2,umap2
```

### From Local Embeddings

```bash
protspace prepare -i embeddings.h5 -m pca2,umap2
```

### From a FASTA File

```bash
protspace prepare -i sequences.fasta -e prot_t5 -m pca2,umap2
```

## Parameters

| Parameter | Description                                                              |
| --------- | ------------------------------------------------------------------------ |
| `-q`      | UniProt query string                                                     |
| `-i`      | Input file(s): HDF5 or FASTA (use `-i f.h5:name` to override model name) |
| `-o`      | Output directory (default: `.`)                                          |
| `-m`      | Projection methods (comma-separated or repeatable)                       |
| `-a`      | Annotations: group names, individual names, or CSV path                  |
| `-e`      | Embedder model shortcut (for FASTA input)                                |
| `-s`      | Compute sequence similarity via MMseqs2                                  |
| `-v`      | Verbosity (`-v` = INFO, `-vv` = DEBUG)                                   |

## Annotations

Specify annotations with `-a`:

```bash
# Use a predefined group
-a default        # EC, keyword, length, protein_families, reviewed
-a all            # Everything from all sources

# Pick individual sources
-a uniprot -a interpro -a taxonomy -a ted -a biocentral

# Or pick individual annotation names
-a protein_families,reviewed,pfam,genus,species

# Or provide a CSV/TSV file
-a annotations.csv
```

**Available annotation groups:**

| Group        | Source annotations                                                      |
| ------------ | ----------------------------------------------------------------------- |
| `default`    | EC, keyword, length, protein_families, reviewed                         |
| `uniprot`    | Gene name, EC, GO terms, subcellular location, length, and more         |
| `interpro`   | Pfam, CATH, SMART, CDD, Panther, Superfamily, and more                  |
| `taxonomy`   | Kingdom, phylum, class, order, family, genus, species                   |
| `ted`        | AlphaFold TED domain annotations                                        |
| `biocentral` | Predicted membrane, signal peptide, transmembrane, subcellular location |
| `all`        | All of the above                                                        |

**CSV format:**

```csv
identifier,taxonomy,family,function
P12345,Bacteria,Kinase,ATP binding
P67890,Archaea,Phosphatase,Hydrolase
Q54321,Eukaryota,Kinase,Transferase
```

The `identifier` column must match protein IDs in your embeddings file.

## Projection Methods

Methods require a dimension suffix: `2` for 2D, `3` for 3D.

::: warning Dimension Suffix Required
Specify `pca2` or `pca3`, not `pca` alone — the dimension suffix is mandatory.
:::

| Method   | 2D          | 3D          | Description                            |
| -------- | ----------- | ----------- | -------------------------------------- |
| PCA      | `pca2`      | `pca3`      | Principal Component Analysis           |
| UMAP     | `umap2`     | `umap3`     | Uniform Manifold Approximation         |
| t-SNE    | `tsne2`     | `tsne3`     | t-distributed Stochastic Neighbor Emb. |
| PaCMAP   | `pacmap2`   | `pacmap3`   | Pairwise Controlled Manifold Approx.   |
| MDS      | `mds2`      | `mds3`      | Multidimensional Scaling               |
| LocalMAP | `localmap2` | `localmap3` | Local-first alternative to PaCMAP      |

You can customize parameters inline:

```bash
-m "umap2:n_neighbors=50;min_dist=0.1" -m "tsne2:perplexity=50"
```

::: tip
ProtSpace is optimized for 2D visualization — prefer `*2` methods over `*3`.
:::

## Embedder Models

When using a FASTA file as input, specify an embedder with `-e` to generate embeddings via the [Biocentral](https://biocentral.rostlab.org) API:

```bash
protspace prepare -i sequences.fasta -e prot_t5 -m pca2,umap2
```

Available models: `prot_t5`, `prost_t5`, `esm2_8m`, `esm2_35m`, `esm2_150m`, `esm2_650m`, `esm2_3b`, `ankh_base`, `ankh_large`, `ankh3_large`, `esmc_300m`, `esmc_600m`

## More Info

The `protspace prepare` command is the recommended all-in-one pipeline. For advanced workflows, the CLI also provides individual subcommands: `embed`, `project`, `annotate`, `bundle`, `stats`, `transfer`, `serve`, and `style`.

Full CLI reference and advanced usage: [ProtSpace on GitHub](https://github.com/tsenoner/protspace/tree/main/apps/protspace)
