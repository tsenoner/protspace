# Exporting Results

ProtSpace allows you to export publication-ready figures, raw data, and protein IDs.

## Export Button

Click **Export** in the control bar to see available formats:

| Format          | Description                                               |
| --------------- | --------------------------------------------------------- |
| **PNG**         | Raster image of the current view with legend              |
| **PDF**         | PDF document of the current view with legend              |
| **Protein IDs** | Text file with newline-separated identifiers              |
| **Parquet**     | `.parquetbundle` file with all data and optional settings |

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

Click **Quick Export** to download an image immediately using default or previously saved settings. No preview, useful when you've already configured the Figure Editor and want the same output again.

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

Exports a plain text file with one protein ID per line. Useful for downstream analysis.

## What Gets Exported

| State             | Exported Data          |
| ----------------- | ---------------------- |
| Proteins isolated | Only isolated proteins |
| No isolation      | All proteins           |

Use isolation to export specific subsets.

A subset export drops the statistics: the scores were computed over the whole dataset, so keeping
them in a slice would make them read as describing that slice.

## Next Steps

- [Figure Editor](./figure-editor) - Full guide to the publication figure editor
- [FAQ](/guide/faq) - Common questions
- [Data Format Reference](/guide/data-format) - Understanding the file format
