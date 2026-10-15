# Exporting Results

ProtSpace allows you to export publication-ready figures, raw data, protein IDs and tables.

## Export Button

Click **Export** in the control bar to see available formats:

| Format          | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| **PNG**         | Raster image of the current view with legend                      |
| **PDF**         | PDF document of the current view with legend                      |
| **Protein IDs** | Text file with newline-separated identifiers                      |
| **Table**       | Tab-separated table of the visible proteins and their annotations |
| **Parquet**     | `.parquetbundle` file with all data and optional settings         |

## Image Export (PNG / PDF)

When PNG or PDF is selected, you have two export paths:

### Figure Editor (Recommended)

Click **Figure Editor** to open a full-screen editor with live preview. This is the primary workflow for creating publication-quality figures. See the [Figure Editor guide](./figure-editor) for full documentation.

Key features:

- **Journal presets** for Nature, Science, Cell, PNAS, PLOS, and presentations
- **Photoshop-style Dimensions panel**, Width/Height/DPI, unit toggle (px/mm/in/cm), Resample on/off, aspect-lock chain
- **Overlays**, circles, arrows, and text labels to annotate your figure
- **Zoom insets**, true geometric magnification with a per-inset Dot size slider
- **Legend customization**, position, font size in pt or px, columns, free-floating placement
- **Click-to-select + Delete/Backspace**, click an overlay or inset (canvas or sidebar) and press Delete to remove it
- **Persistent settings**, your layout is saved to localStorage and optionally embedded in `.parquetbundle` files
- **Print-correct output**, PNG includes pHYs DPI metadata; PDF page size is mm-accurate

### Quick Export

Click **Quick Export** to download an image immediately, with no preview. It always uses fixed
defaults, a 2048 × 1024 px image with the legend on the right, and keeps your current zoom and pan;
it does not use Figure Editor settings. For another size or layout, or for the full plot, use the
Figure Editor.

### Dot size in images

Dots [grow as you zoom in](/explore/scatterplot#navigation). Quick Export keeps your current zoom,
so its dots match the size you see on screen. The Figure Editor always renders the full view, so its
dots are drawn at their unzoomed size.

::: warning Contours are not exported yet
[Contours](/explore/control-bar#_10-contours) are not drawn in exported images: Quick Export PNG and
PDF, the Figure Editor and its zoom insets show the points only. The Figure Editor preview shows
exactly what will be exported. Tracked in [#498](https://github.com/tsenoner/protspace/issues/498).
:::

## Parquet Export

Export a `.parquetbundle` file that can be loaded back into ProtSpace or shared.

- **Include legend settings**: Saves your current legend customizations (colors, shapes, ordering, visibility, palette, and the shape size if you picked one) inside the file. Anyone who loads it will see the same visual configuration. The Contours mode is not saved in the file; it lives in the page URL.
- **Figure editor settings**: When legend settings are included, the Figure Editor state (dimensions, DPI, legend layout, overlays, insets) is also saved. This lets you reopen the Figure Editor exactly where you left off.

If the bundle you loaded carried statistics (prepared with `protspace ... --stats`), the export
re-emits them byte for byte, even with **Include legend settings** off. See
[Separation Scores](/explore/separation-scores) for what those scores drive.

::: warning Export fails on a reserved value
Export stops with an error, rather than writing a corrupt file, if any annotation value or category
name contains the literal text `---PARQUET_DELIMITER---`. That string separates the bundle's parts,
so it cannot appear inside one.
:::

## Protein IDs Export

Exports a plain text file, `protein_ids.txt`, with one protein ID per line: the proteins visible
in the plot (see [What Gets Exported](#what-gets-exported)). Useful for downstream analysis, or to
paste back into the search box later.

## Table Export

Exports the same proteins as a tab-separated `.tsv` table that opens in a spreadsheet, R or pandas,
one row per protein:

- `protein_id`
- the coordinates of the projection on screen, as `<projection>_x` and `<projection>_y`
- one column per annotation, `cluster_*` columns included. A cell holds the labels you see in the
  legend, joined with `;` when a protein has several; a numeric annotation holds its value, not its
  bin. Missing values are empty.
- for an annotation with [transferred values](/explore/eat), the curated column holds only the
  curated values, followed by `<annotation>__pred_value`, `__pred_confidence` and `__pred_source`
  with the transfers.

The columns and values are the ones [`protspace export`](/guide/python-cli#protspace-export) writes
from the command line, which exports every protein of a bundle instead of the visible ones.

To list the members of one cluster, colour by its `cluster_*` annotation, double-click the cluster
in the legend to show it alone, and export.

## What Gets Exported

The **Protein IDs** and **Table** exports hold exactly the proteins visible in the plot. A protein
is left out when:

- the [filter query](/explore/control-bar#_7-filter-button) excludes it, the EAT reliability filter
  included;
- [isolation](/explore/control-bar#_6-isolate-button) is on and it is not in the isolated set;
- every value it has in the annotation you colour by is hidden in the legend.

The **Parquet** export holds the proteins left by the filter query and isolation, whatever the
legend hides. Images show what is drawn.

A subset export drops the statistics: the scores were computed over the whole dataset, so keeping
them in a slice would make them read as describing that slice.

## Next Steps

- [Figure Editor](./figure-editor) - Full guide to the publication figure editor
- [FAQ](/guide/faq) - Common questions
- [Data Format Reference](/guide/data-format) - Understanding the file format
