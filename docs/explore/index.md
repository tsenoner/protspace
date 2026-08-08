# Interface Overview

The ProtSpace Explore page provides an interactive environment for visualizing and analyzing protein embeddings.

![Interface Overview - Full page layout showing scatterplot, legend, and control bar](./images/interface-overview.png)

## Page Layout

| Area                 | Location      | Purpose                                                    |
| -------------------- | ------------- | ---------------------------------------------------------- |
| **Control Bar**      | Top           | Switch projections, change coloring, search, import/export |
| **Scatterplot**      | Center        | Main 2D visualization of protein embeddings                |
| **Legend**           | Right sidebar | Filter categories, customize display                       |
| **Structure Viewer** | Right sidebar | View 3D protein structures (when available)                |

## Control Bar

![Control Bar - showing all buttons and dropdowns with numbered annotations](./images/control-bar-annotated.png)

The control bar contains:

1. **Projection dropdown** - Switch between PCA, UMAP, t-SNE, PaCMAP, MDS, or LocalMAP
2. **Annotation dropdown** - Color points by annotation
3. **Search box** - Find proteins by ID
4. **Select button** - Rectangle or lasso selection mode
5. **Clear button** - Clear selection
6. **Isolate button** - Hide unselected proteins
7. **Filter button** - Filter by annotation values
8. **Export button** - Save images or data
9. **Import button** - Load `.parquetbundle` file

## Scatterplot

The main visualization shows your proteins as points in 2D space. Points close together have similar embeddings.

![Scatterplot - showing protein points with selection](./images/scatterplot-example.png)

**Quick interactions:**

- **Scroll** to zoom in/out
- **Drag** to pan around
- **Click** a point to select it
- **⌘/Ctrl + click** to add to selection
- **Double-click** background to reset view
- **Escape** to clear selection / exit selection mode
- **⌘/Ctrl + K** to focus search

## Legend

![Legend panel - showing categories and controls](./images/legend-panel.png)

The legend shows the current coloring scheme:

- Click labels to hide/show categories
- Drag labels to reorder (changes drawing order in the scatterplot)
- Use the settings cog for advanced options

## Structure Viewer

When you select a protein, the 3D viewer appears and fetches its structure from AlphaFold (if available). The viewer includes direct links to the [AlphaFold Database](https://alphafold.ebi.ac.uk/), [UniProt](https://www.uniprot.org/), [InterPro](https://www.interpro.org/), and [TED](https://ted.cathdb.info/) entries for the selected protein.

<img src="./images/structure-viewer.png" alt="Structure Viewer - showing 3D protein structure" style="max-width: 50%; display: block; margin: 1em 0;" />

## Product Tour

The first time you load a dataset, ProtSpace plays a short guided tour highlighting the projection picker, search, selection tools, the Export menu, and the legend. The tour pauses on each step until you click **Next**, and you can dismiss it any time with **Skip** or by pressing <kbd>Esc</kbd>.

To replay the tour later, click the **?** icon in the top-right of the scatterplot to open the Tips popover, then click **Take a Tour**.

::: tip Keyboard Shortcuts
The same Tips popover lists all keyboard shortcuts (search, selection, navigation). Worth a glance even if you skip the tour.
:::

## Next Steps

- [Importing Data](/explore/importing-data) - Load your protein data
- [Navigating the Scatterplot](/explore/scatterplot) - Learn navigation controls
- [Using the Legend](/explore/legend) - Filter and customize display
