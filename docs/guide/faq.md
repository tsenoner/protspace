# FAQ

Frequently asked questions about ProtSpace.

## General

### Do I need machine learning knowledge?

No. ProtSpace is designed for biologists and researchers - you only need protein embeddings.

### Is my data uploaded to a server?

It depends on what you import.

- **`.parquetbundle` files stay local.** Loading, exploring, filtering and exporting a bundle all
  run in your browser, the file never leaves your computer.
- **FASTA files are uploaded.** Dropping a `.fasta` / `.fa` / `.fna` file sends your sequences to
  the ProtSpace prep backend, which computes embeddings and projections and returns a
  `.parquetbundle`. If you need your sequences to stay on your machine, prepare the bundle
  yourself with the [Colab notebook](/guide/data-preparation) or the
  [Python CLI](/guide/python-cli), then import the resulting bundle.

Either way, ProtSpace stores your last imported dataset locally in your browser's OPFS storage, and
it stores per-dataset settings locally in browser storage. See
[Data & Settings Persistence](/explore/importing-data#data-settings-persistence) for details.

### Which file formats are supported?

Two:

- **`.parquetbundle`**, the standard ProtSpace format, loaded entirely in your browser. See
  [Data Preparation](/guide/data-preparation) for how to generate one.
- **FASTA (`.fasta`, `.fa`, `.fna`)**, on deployments that run the prep backend, dropping a FASTA
  file uploads it, builds a bundle, and opens it automatically. Sequence counts must be between 20
  and 1500, and the file must be 8 MB or smaller.

See [Importing Data](/explore/importing-data) for the full FASTA workflow.

### Can I use it offline?

Yes, after initial page load. Note: 3D structure loading requires internet.

### Is it free?

Yes. ProtSpace is open source under the MIT license.

## Data

### How do I generate a .parquetbundle?

- [Google Colab notebook](/guide/data-preparation) - No installation (recommended)
- [Python CLI](/guide/python-cli) - For local processing or automation

### What is the recommended dataset size?

Any size up to the limits in the last two rows works; larger datasets load and respond more
slowly. Measured on an Apple M4 laptop in Chromium:

| Proteins                                                       | What to expect                                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Up to 573K ([Swiss-Prot](/explore/example-datasets#swissprot)) | Loads in about 1.5 s, not counting the download. Switching the annotation or the projection, isolating legend values and selecting points each take tens of milliseconds. Pan and zoom run at 60 fps. |
| 2.5M                                                           | Loads in about 2.5 s. Pan, zoom and the projection glide stay at 60 fps. Switching the annotation holds the plot for about 0.5 s, and switching projections for about 0.3 s.                          |
| 5M                                                             | Loads in about 4 s. Pan and zoom drop to about 30 fps. Switching the annotation holds the plot for about 0.9 s, switching projections or exporting an image for about 0.5 s.                          |
| More than 67,108,864 (2^26)                                    | Not drawn. A "Too many points to draw" notice says so.                                                                                                                                                |
| v1 or v2 bundle over 2,000,000 rows                            | Refused, with a message to run [`protspace convert`](/guide/python-cli#protspace-convert) on the file. Rows are counted as proteins x projections.                                                    |

The 2.5M and 5M rows come from synthetic bundles with two annotations and short IDs, so a real
dataset of that size takes longer. A slower device or GPU takes longer too.

[Performance](/guide/performance) has measurements up to 21 million proteins, with real annotations,
plus memory needs and how to run the benchmark on your own computer.

### Can I add custom annotations?

Yes. Add columns when generating the bundle. See [Data Format](/guide/data-format).

### How do I include 3D structures?

Structures load automatically from AlphaFold if your protein IDs are UniProt accessions.

### Why can't ProtSpace save my dataset for automatic reloads?

ProtSpace uses the Origin Private File System (OPFS) to remember the last dataset you imported across page reloads. If automatic reload is unavailable, the most common reasons are:

- You are using private/incognito browsing mode
- Browser storage is restricted by browser settings or extensions
- Your browser does not support OPFS

Your dataset still loads and works normally for the current session. You only need to import it again after reloading the page. For the best experience, use a recent browser in a normal non-private window.

## Visualization

### Can I customize colors?

Yes! Click the **cog icon** (⚙️) in the legend panel to access settings. You can select from multiple **color palettes** (including colorblind-safe options), and your color choices persist per category across sessions.

### What are multi-label annotations?

Annotations with multiple values per protein (e.g., multiple EC numbers). Displayed as pie charts.

## Performance

### The browser is slow or freezing

1. Use Chrome for best performance
2. Reduce dataset size

### Which browser works best?

| Browser | Performance |
| ------- | ----------- |
| Chrome  | Best        |
| Brave   | Best        |
| Edge    | Excellent   |
| Safari  | Good        |
| Firefox | Slower      |

### How many proteins can I visualize?

Every point is drawn, up to 67,108,864 (2^26) per projection. That bound comes from the size of
the GPU buffers, not from the file format. A dataset past it is not drawn at all, and a "Too many
points to draw" notice says so; nothing is dropped silently. Files up to 2 GB are accepted. On
GPUs with a small texture limit, multi-value points in a very large dataset may be drawn with
fewer colour slices, and a notice says so.

For load and interaction times at 573K, 2.5M and 5M proteins, see
[What is the recommended dataset size?](#what-is-the-recommended-dataset-size).
[Performance](/guide/performance) goes up to 21 million proteins and covers memory.

::: tip Older bundles
Bundles from before format v3 are decoded row by row, at about 1.3 GB of browser memory per
million rows. They are refused above 2,000,000 rows, counted as proteins x projections, with a
message that says so. Run [`protspace convert`](/guide/python-cli#protspace-convert) to upgrade
the file; the current format has no row limit.
:::

## Technical

### What are the system requirements?

**Browser**: Modern browser with WebGL 2.0 support

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

**Hardware**: Any modern computer. Better GPU = better performance.

### What's inside a .parquetbundle?

Three to five Parquet tables bundled together:

1. Annotation data (protein metadata)
2. Projection metadata (methods, parameters)
3. Projection coordinates (x, y, z)
4. Settings (optional, legend colors, shapes, export options)
5. Statistics (optional, from `protspace stats`, [separation scores](/explore/separation-scores)
   and cluster-agreement metrics)

The optional settings table is included when you export with "Include legend/export settings" enabled. See [Data Format](/guide/data-format) for details.

## Contributing

### How can I contribute?

See [CONTRIBUTING.md](https://github.com/tsenoner/protspace/blob/main/CONTRIBUTING.md) on GitHub.

### Where do I report bugs?

[GitHub Issues](https://github.com/tsenoner/protspace/issues)

### Can I request features?

Yes! Open an issue or start a discussion on GitHub.

## Citation

### How do I cite ProtSpace?

If you use ProtSpace, please cite the web application preprint (latest):

```
Senoner, T., Vahidi, P., Olenyi, T., Senoner, F., Sisman, G., Kahl, E., Rost, B., & Koludarov, I. (2026).
ProtSpace: Protein Universe in Your Browser. bioRxiv. https://doi.org/10.64898/2026.05.04.722720
```

The original, peer-reviewed ProtSpace publication:

```
Senoner, T., Olenyi, T., Heinzinger, M., Spannagl, A., Bouras, G., Rost, B., & Koludarov, I. (2025).
ProtSpace: A Tool for Visualizing Protein Space. Journal of Molecular Biology, 437(15), 168940.
https://doi.org/10.1016/j.jmb.2025.168940
```

BibTeX:

```bibtex
@article{senoner2026protspaceweb,
  title     = {ProtSpace: Protein Universe in Your Browser},
  author    = {Senoner, Tobias and Vahidi, Peyman and Olenyi, Tobias and Senoner, Florin and Sisman, G{\"o}khan and Kahl, Elias and Rost, Burkhard and Koludarov, Ivan},
  journal   = {bioRxiv},
  year      = {2026},
  doi       = {10.64898/2026.05.04.722720},
  url       = {https://www.biorxiv.org/content/10.64898/2026.05.04.722720v1},
  publisher = {openRxiv}
}

@article{senoner2025protspace,
  title     = {ProtSpace: A Tool for Visualizing Protein Space},
  author    = {Senoner, Tobias and Olenyi, Tobias and Heinzinger, Michael and Spannagl, Anton and Bouras, George and Rost, Burkhard and Koludarov, Ivan},
  journal   = {Journal of Molecular Biology},
  volume    = {437},
  number    = {15},
  pages     = {168940},
  year      = {2025},
  doi       = {10.1016/j.jmb.2025.168940},
  publisher = {Elsevier}
}
```

## Still Have Questions?

- **GitHub Discussions**: [Ask the community](https://github.com/tsenoner/protspace/discussions)
- **Issues**: [Report bugs](https://github.com/tsenoner/protspace/issues)
