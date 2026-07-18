# FAQ

Frequently asked questions about ProtSpace.

## General

### Do I need machine learning knowledge?

No. ProtSpace is designed for biologists and researchers - you only need protein embeddings.

### Is my data uploaded to a server?

No. Everything runs in your browser — your data never leaves your computer. ProtSpace stores your last imported dataset locally in your browser's OPFS storage, and it stores per-dataset settings locally in browser storage. See [Data & Settings Persistence](/explore/importing-data#data-settings-persistence) for details.

### Which file formats are supported?

Only `.parquetbundle` files. See [Using Google Colab](/guide/data-preparation) for how to generate them.

### Can I use it offline?

Yes, after initial page load. Note: 3D structure loading requires internet.

### Is it free?

Yes. ProtSpace is open source under the MIT license.

## Data

### How do I generate a .parquetbundle?

- [Google Colab notebook](/guide/data-preparation) - No installation (recommended)
- [Python CLI](/guide/python-cli) - For local processing or automation

### What is the recommended dataset size?

| Size           | Performance                       |
| -------------- | --------------------------------- |
| < 10K proteins | Optimal - smooth experience       |
| 10K - 500K     | Good - may slow on older devices  |
| > 500K         | Challenging - consider subsetting |

Browser performance varies by device and GPU capabilities.

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

### Can I visualize 1 million proteins?

Not recommended. Performance degrades above 500K proteins - consider subsetting.

## Technical

### What are the system requirements?

**Browser**: Modern browser with WebGL 2.0 support

- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

**Hardware**: Any modern computer. Better GPU = better performance.

### What's inside a .parquetbundle?

Three or four Parquet files bundled together:

1. Annotation data (protein metadata)
2. Projection metadata (methods, parameters)
3. Projection coordinates (x, y, z)
4. Settings (optional — legend colors, shapes, export options)

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
