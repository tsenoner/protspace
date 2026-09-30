# API Reference

ProtSpace ships its UI as Lit custom elements in `@protspace/core`. This page documents the API as
it exists on `main`.

::: warning
`@protspace/core` is **not published to npm** yet. Consume it from the monorepo workspace, see
[Embedding Components](/developers/embedding).
:::

## Components

| Component                             | Tag                            | Purpose                          |
| ------------------------------------- | ------------------------------ | -------------------------------- |
| [Scatterplot](#scatterplot)           | `<protspace-scatterplot>`      | Main projection visualization    |
| [Legend](#legend)                     | `<protspace-legend>`           | Category filtering and colors    |
| [Control Bar](#control-bar)           | `<protspace-control-bar>`      | Projection/annotation selection  |
| [Structure Viewer](#structure-viewer) | `<protspace-structure-viewer>` | 3D protein structures via Mol\*  |
| [Data Loader](#data-loader)           | `<protspace-data-loader>`      | `.parquetbundle` / FASTA loading |

Importing `@protspace/core` registers all of them as side effects.

## Reading this page

Every component is a Lit element, so **every public property is settable from JavaScript**. Lit also
derives an HTML attribute for each reactive property: properties declared with an explicit
`attribute` name get that kebab-case attribute, and the rest get an implicit all-lowercase one, for
example `selectedAnnotation` is settable as `selectedannotation="family"`. Only properties declared
`attribute: false` are JavaScript-only, such as the data loader's `loadFromFileHandler`. Object and
array properties are parsed from JSON strings in markup, so set those from JavaScript.

## Host-Consumed Message Events

Several components emit semantic warning/error events that the host application is expected to
surface. They share these detail fields:

- `message`
- `severity`
- `source`
- optional `context`
- optional `originalError`

See [Messaging Conventions](/developers/messaging) for the ownership model.

## Scatterplot

The main visualization component. Rendering is hand-written WebGL2 with an SVG overlay for
interactions.

### Properties

| Property                            | Type                                  | Default       | Description                                    |
| ----------------------------------- | ------------------------------------- | ------------- | ---------------------------------------------- |
| `data`                              | `VisualizationData \| null`           | `null`        | The loaded dataset                             |
| `selectedProjectionIndex`           | `number`                              | `0`           | Index of the active projection                 |
| `projectionPlane`                   | `'xy' \| 'xz' \| 'yz'`                | `'xy'`        | Plane shown for 3D projections                 |
| `selectedAnnotation`                | `string`                              | `'family'`    | Annotation used for coloring                   |
| `tooltipAnnotations`                | `string[]`                            | `[]`          | Extra annotations shown in the tooltip         |
| `highlightedProteinIds`             | `string[]`                            | `[]`          | Proteins to highlight                          |
| `selectedProteinIds`                | `string[]`                            | `[]`          | Currently selected protein IDs                 |
| `selectionMode`                     | `boolean`                             | `false`       | Enable brush/lasso selection                   |
| `selectionTool`                     | `'rectangle' \| 'lasso'`              | `'rectangle'` | Active selection tool                          |
| `hiddenAnnotationValues`            | `string[]`                            | `[]`          | Annotation values hidden from the plot         |
| `otherAnnotationValues`             | `string[]`                            | `[]`          | Values folded into the "Other" group           |
| `numericAnnotationSettings`         | `NumericAnnotationDisplaySettingsMap` | `{}`          | Per-annotation binning/gradient settings       |
| `annotationSortModes`               | `Record<string, LegendSortMode>`      | `{}`          | Per-annotation legend sort mode                |
| `numericManualOrderIdsByAnnotation` | `Record<string, string[]>`            | `{}`          | Manual bin ordering per numeric annotation     |
| `filteredProteinIds`                | `string[]`                            | `[]`          | Result of an active filter query               |
| `filtersActive`                     | `boolean`                             | `false`       | Whether `filteredProteinIds` should be applied |
| `config`                            | `Partial<ScatterplotConfig>`          | `{}`          | Sizing, opacity and zoom configuration         |
| `showTourButton`                    | `boolean`                             | `false`       | Show the guided-tour button                    |

### HTML attributes

Three properties have explicit kebab-case attributes: `selection-tool`, `filters-active` and
`show-tour-button`. The rest are reachable from markup under their implicit all-lowercase names (for
example `selectedannotation`, `projectionplane`); no scatterplot property is `attribute: false`. Set
the object and array properties from JavaScript.

### Configuration

Point size, opacity, zoom limits and density contours live inside the `config` object, not as
attributes:

```javascript
plot.config = {
  pointSize: 80,
  baseOpacity: 0.9,
  selectedOpacity: 1.0,
  fadedOpacity: 0.15,
  zoomExtent: [0.1, 1000],
  densityLayer: 'off',
};
```

Any key you omit keeps its default. `densityLayer` sets the density contours: `'off'` (default)
draws points only, `'auto'` sets their strength from the visible-point count, the plot size and the
zoom (not from actual overlap), so they fade out as the user zooms in and start faint or hidden when
few points are visible, and `'on'` draws them at full strength at every zoom. The control bar labels
`'on'` as Always. When the context cannot draw them, the plot emits `renderer-degraded` once, with
`context.reason` set to `density-unavailable`, and keeps drawing the points.

### Methods

| Method                          | Returns                     | Description                                                      |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `resetZoom()`                   | `void`                      | Snap back to the full view                                       |
| `isolateSelection()`            | `void`                      | Isolate the currently selected proteins                          |
| `resetIsolation()`              | `void`                      | Exit isolation and restore the full dataset                      |
| `clearIsolationState(options?)` | `void`                      | Clear isolation state; pass `{ silent: true }` to skip the event |
| `isIsolationMode()`             | `boolean`                   | Whether the plot is currently isolated                           |
| `getIsolationHistory()`         | `string[][]`                | Stack of isolation steps                                         |
| `getCurrentData(options?)`      | `VisualizationData \| null` | The dataset as currently displayed (filtered/isolated)           |
| `getMaterializedData()`         | `VisualizationData \| null` | Dataset with numeric annotations materialized into bins          |
| `pickInteractivePointAt(x, y)`  | `PlotDataPoint \| null`     | Hit-test at client-relative pixel coordinates                    |
| `hasExpandedDuplicateStack()`   | `boolean`                   | Whether a duplicate stack is expanded                            |
| `closeExpandedDuplicateStack()` | `void`                      | Collapse the expanded duplicate stack                            |

### Events

All scatterplot events bubble.

| Event                    | Detail                                           | Description                         |
| ------------------------ | ------------------------------------------------ | ----------------------------------- |
| `protein-click`          | `{ proteinId, point, view, modifierKeys }`       | A point was clicked                 |
| `protein-hover`          | `{ proteinId, point, view }`                     | The pointer entered a point         |
| `brush-selection`        | `{ proteinIds, isMultiple }`                     | Rectangle/lasso selection committed |
| `data-change`            | `{ data }`                                       | The displayed dataset changed       |
| `data-isolation`         | `{ isolationHistory, isolationMode, dataSize }`  | Isolation applied                   |
| `data-isolation-reset`   | `{ isolationHistory, isolationMode, dataSize? }` | Isolation cleared                   |
| `auto-disable-selection` | `{ reason, dataSize }`                           | Selection mode turned itself off    |
| `file-dropped`           | `{ file }`                                       | A file was dropped on the plot      |
| `renderer-degraded`      | `{ message, severity, source, context }`         | A rendering capability was reduced  |
| `tour-start`             | none                                             | The guided-tour button was pressed  |

`modifierKeys` on `protein-click` is `{ ctrl, meta, shift, alt }`. `view` is the tooltip-friendly
projection of the protein's annotations; `point` is the bare plot point.

### Example

```html
<protspace-scatterplot id="plot" selection-tool="lasso"></protspace-scatterplot>
```

```javascript
const plot = document.getElementById('plot');
plot.data = data;
plot.selectedAnnotation = 'family';
plot.selectionMode = true;

plot.addEventListener('protein-click', (e) => {
  console.log('Clicked:', e.detail.proteinId);
});
```

## Legend

Category filtering and color mapping with automatic settings persistence.

### Properties

| Property             | Type                      | Default | Description                             |
| -------------------- | ------------------------- | ------- | --------------------------------------- |
| `data`               | `LegendDataInput \| null` | `null`  | Dataset the legend describes            |
| `selectedAnnotation` | `string`                  | `''`    | Annotation being shown                  |
| `annotationName`     | `string`                  | `''`    | Display name of the annotation          |
| `annotationValues`   | `(string \| null)[]`      | `[]`    | Values in the annotation column         |
| `proteinIds`         | `string[]`                | `[]`    | Protein IDs backing the counts          |
| `selectedItems`      | `string[]`                | `[]`    | Selected legend entries                 |
| `maxVisibleValues`   | `number`                  | -       | Max categories (or target numeric bins) |
| `shapeSize`          | `number`                  | -       | Size of legend symbols                  |
| `isolationMode`      | `boolean`                 | `false` | Reflects the plot's isolation state     |
| `isolationHistory`   | `string[][]`              | `[]`    | Isolation stack from the plot           |

### HTML attributes

`scatterplot-selector`, `auto-sync`, `auto-hide`.

### Events

| Event                        | Detail                                                    | Description                           |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `legend-item-click`          | `{ value, action }`                                       | Item clicked (toggle/isolate/extract) |
| `legend-zorder-change`       | `{ zOrderMapping }`                                       | Drawing order changed                 |
| `legend-colormapping-change` | `{ colorMapping, shapeMapping }`                          | Color/shape assignments changed       |
| `legend-customize`           | none                                                      | Settings dialog opened                |
| `legend-download`            | none                                                      | Download requested                    |
| `legend-error`               | `{ message, severity, source, context?, originalError? }` | Host-consumed error event             |

### Methods

| Member                               | Returns               | Description                                                                          |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `applyShapeSize(size, datasetHash?)` | `void`                | Apply a dataset-wide shape size, e.g. a bundle's top-level `shapeSize`, and store it |
| `pickedShapeSize` (getter)           | `number \| undefined` | The dataset-wide shape size, or `undefined` while none was picked or applied         |

Pass `datasetHash` to `applyShapeSize` when the legend has not computed the new dataset's hash yet.
A size above 64 is applied and stored as 64. Write `pickedShapeSize`, not `shapeSize`, into a bundle's top-level `shapeSize`: the live
`shapeSize` may only be seeded from the current annotation.

### Persistence

User customizations (visibility, colors, ordering, settings) are saved to `localStorage` per dataset
and annotation. Per-category state is not persisted for numeric annotations, whose legend entries
are generated bin IDs. The shape size is stored per dataset instead: once picked, it applies to
every annotation.

### Example

```html
<protspace-legend auto-sync scatterplot-selector="#plot"></protspace-legend>
```

```javascript
const legend = document.querySelector('protspace-legend');
legend.addEventListener('legend-zorder-change', (e) => {
  console.log('Z-order:', e.detail.zOrderMapping);
});
```

## Control Bar

Projection, annotation, contours, selection, filter and export controls.

### Properties

| Property                | Type                      | Description                              |
| ----------------------- | ------------------------- | ---------------------------------------- |
| `projections`           | `string[]`                | Projection names to offer                |
| `annotations`           | `string[]`                | Annotation names to offer                |
| `selectedProjection`    | `string`                  | Active projection                        |
| `selectedAnnotation`    | `string`                  | Active annotation                        |
| `tooltipAnnotations`    | `string[]`                | Annotations pinned into the plot tooltip |
| `selectionMode`         | `boolean`                 | Selection mode toggle state              |
| `selectionTool`         | `'rectangle' \| 'lasso'`  | Active selection tool                    |
| `densityLayer`          | `'off' \| 'auto' \| 'on'` | Contours mode, default `'off'`           |
| `selectedProteinsCount` | `number`                  | Count shown in the selection controls    |
| `isolationMode`         | `boolean`                 | Isolation state mirrored from the plot   |
| `isolationHistory`      | `string[][]`              | Isolation stack mirrored from the plot   |

### HTML attributes

`selected-projection`, `selected-annotation`, `selection-mode`, `selection-tool`, `density-layer`,
`selected-proteins-count`, `isolation-mode`, `isolation-history`, `has-file-settings`,
`current-dataset-name`, `current-dataset-is-demo`, `scatterplot-selector`, `auto-sync`.

### Events

| Event                             | Detail                                   | Description                                |
| --------------------------------- | ---------------------------------------- | ------------------------------------------ |
| `projection-change`               | `{ projection }`                         | Projection changed                         |
| `annotation-change`               | `{ annotation }`                         | Coloring annotation changed                |
| `tooltip-annotations-change`      | `{ tooltipAnnotations }`                 | Tooltip annotation set changed             |
| `protein-selection-change`        | `{ proteinIds }`                         | Selection changed (search, chips, clear)   |
| `toggle-selection-mode`           | `{ selectionMode }`                      | Selection mode toggled                     |
| `selection-tool-change`           | `{ selectionTool }`                      | Selection tool changed                     |
| `density-layer-change`            | `{ densityLayer }`                       | Contours mode changed                      |
| `clear-selections`                | `{}`                                     | Clear button pressed                       |
| `isolate-data`                    | `{}`                                     | Isolate button pressed                     |
| `reset-isolation`                 | `{}`                                     | Reset-isolation button pressed             |
| `export`                          | `{ type, ...export options }`            | Export requested                           |
| `open-publish-editor`             | `{}`                                     | Figure editor requested                    |
| `load-demo-dataset`               | none                                     | Demo dataset requested                     |
| `selection-disabled-notification` | `{ message, severity, source, context }` | Host-consumed warning (selection auto-off) |

With `auto-sync`, the control bar also applies these changes directly to the target scatterplot, so
hosts only need to listen for the events they want to mirror elsewhere.

### Example

```html
<protspace-control-bar auto-sync scatterplot-selector="#plot"></protspace-control-bar>
```

## Structure Viewer

3D protein structure display using Mol\*.

### Properties

| Property          | Type             | Default               | Description           |
| ----------------- | ---------------- | --------------------- | --------------------- |
| `proteinId`       | `string \| null` | `null`                | Structure to display  |
| `title`           | `string`         | `'Protein Structure'` | Panel title           |
| `height`          | `string`         | `'400px'`             | Viewer height         |
| `showHeader`      | `boolean`        | `true`                | Show the panel header |
| `showCloseButton` | `boolean`        | `true`                | Show the close button |
| `showTips`        | `boolean`        | `true`                | Show interaction tips |

### HTML attributes

`scatterplot-selector`, `auto-sync`, `auto-show`.

### Events

| Event             | Detail                                                   | Description                           |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| `structure-load`  | `{ proteinId, status, data? }`                           | Lifecycle event for loading or loaded |
| `structure-error` | `{ message, severity, source, context, originalError? }` | Host-consumed error event             |
| `structure-close` | `{ proteinId }`                                          | Viewer closed                         |

### Example

```html
<protspace-structure-viewer
  auto-sync
  auto-show
  scatterplot-selector="#plot"
  height="400px"
></protspace-structure-viewer>
```

## Data Loader

File-picker and drag/drop loading component used by the Explore app.

### Properties

| Property              | Type      | Default | Description                                          |
| --------------------- | --------- | ------- | ---------------------------------------------------- |
| `src`                 | `string`  | `''`    | URL to load from                                     |
| `autoLoad`            | `boolean` | `false` | Load automatically when `src` is set                 |
| `allowDrop`           | `boolean` | `true`  | Accept drag and drop                                 |
| `columnMappings`      | `object`  | `{}`    | Override protein-id / coordinate column names        |
| `loadFromFileHandler` | function  | -       | Host hook that can intercept or replace file loading |

The file input accepts `.parquetbundle`, `.fasta`, `.fa` and `.fna`. FASTA files are only usable if
the host installs a `loadFromFileHandler` that prepares them, see
[Importing Data](/explore/importing-data).

### HTML attributes

`src`, `auto-load`, `allow-drop`, `column-mappings`. `loadFromFileHandler` is JavaScript-only.

### Events

| Event                   | Detail                                                    | Description                 |
| ----------------------- | --------------------------------------------------------- | --------------------------- |
| `data-loading-start`    | none                                                      | Load started                |
| `data-loading-progress` | `{ current, total, percentage }`                          | Incremental progress update |
| `data-loaded`           | `{ data, settings, source, file?, bundleFormatVersion? }` | Dataset loaded successfully |
| `data-error`            | `{ message, severity, source, context, originalError? }`  | Host-consumed error event   |

For a `.parquetbundle`, `bundleFormatVersion` is the container format version it was read as: `3`,
or `1`/`2` for a legacy bundle whose support ends in protspace 5.0.0. It is absent for plain parquet.

## Data Loading Utilities

Exported from `@protspace/core` unless noted.

### readFileOptimized

Read a file into an `ArrayBuffer`, chunking large files.

```typescript
function readFileOptimized(file: File): Promise<ArrayBuffer>;
```

### isParquetBundle

Check whether an `ArrayBuffer` looks like a parquet bundle. Exported from `@protspace/utils`.

```typescript
function isParquetBundle(arrayBuffer: ArrayBuffer): boolean;
```

### decodeParquetBundle

Read a bundle of any format version into the shape the scatterplot consumes, along with its
optional settings and the container format version it was read as (`3`, or `1`/`2` for a legacy
bundle, whose support ends in protspace 5.0.0).

```typescript
function decodeParquetBundle(arrayBuffer: ArrayBuffer): Promise<DecodedParquetBundle>;

interface DecodedParquetBundle {
  data: VisualizationData;
  settings: BundleSettings | null;
  formatVersion: number;
}
```

### convertParquetToVisualizationDataOptimized

Convert the rows of a plain `.parquet` table into the shape the scatterplot consumes.

```typescript
function convertParquetToVisualizationDataOptimized(
  input: Rows | BundleExtractionResult,
): Promise<VisualizationData>;
```

### extractRowsFromParquetBundle (deprecated)

::: warning Deprecated
Reads only v1 and v2 bundles and throws on a v3 bundle. It is removed in protspace 5.0.0. Use
`decodeParquetBundle` instead.
:::

Split a v1/v2 bundle into its projection rows, annotation rows and optional settings, for
`convertParquetToVisualizationDataOptimized`.

```typescript
function extractRowsFromParquetBundle(arrayBuffer: ArrayBuffer): Promise<BundleExtractionResult>;
```

### Usage Example

```javascript
import { readFileOptimized, decodeParquetBundle } from '@protspace/core';
import { isParquetBundle } from '@protspace/utils';

const arrayBuffer = await readFileOptimized(file);

if (isParquetBundle(arrayBuffer)) {
  const { data } = await decodeParquetBundle(arrayBuffer);
  document.getElementById('plot').data = data;
}
```

## TypeScript Support

Type definitions ship with the package:

```typescript
import type {
  ProtspaceScatterplot,
  ProtspaceLegend,
  ProtspaceStructureViewer,
} from '@protspace/core';
import { ProtspaceControlBar } from '@protspace/core';

import type { VisualizationData } from '@protspace/utils';

const plot = document.getElementById('plot') as ProtspaceScatterplot;
```

## Browser Compatibility

| Requirement        | Details                            |
| ------------------ | ---------------------------------- |
| Custom Elements v1 | All modern browsers                |
| Shadow DOM v1      | All modern browsers                |
| WebGL 2.0          | Required for scatterplot rendering |

## Next Steps

- [Embedding Components](/developers/embedding) - Integration patterns
- [Messaging Conventions](/developers/messaging) - Host ownership model
- [Contributing](/developers/contributing) - Development guide
