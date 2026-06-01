# API Reference

ProtSpace provides four web components for building protein embedding visualizations.

## Host-Consumed Message Events

Several components emit semantic warning/error events for the host app to interpret.

Shared fields:

- `message`
- `severity`
- `source`
- optional `context`
- optional `originalError`

## Components

| Component                             | Tag                            | Purpose                         |
| ------------------------------------- | ------------------------------ | ------------------------------- |
| [Scatterplot](#scatterplot)           | `<protspace-scatterplot>`      | Main 2D/3D visualization        |
| [Legend](#legend)                     | `<protspace-legend>`           | Category filtering and colors   |
| [Control Bar](#control-bar)           | `<protspace-control-bar>`      | Projection/annotation selection |
| [Structure Viewer](#structure-viewer) | `<protspace-structure-viewer>` | 3D protein structures           |

## Scatterplot

The main visualization component.

### Attributes

| Attribute          | Type    | Default       | Description                                |
| ------------------ | ------- | ------------- | ------------------------------------------ |
| `show-grid`        | boolean | false         | Show grid lines                            |
| `enable-zoom`      | boolean | false         | Enable scroll zoom                         |
| `enable-pan`       | boolean | false         | Enable drag panning                        |
| `enable-selection` | boolean | false         | Enable point selection                     |
| `selection-tool`   | string  | `'rectangle'` | Selection tool: `'rectangle'` or `'lasso'` |
| `point-size`       | number  | 5             | Point radius in pixels                     |
| `point-opacity`    | number  | 0.8           | Point opacity (0-1)                        |

### Properties

| Property                  | Type                       | Description                    |
| ------------------------- | -------------------------- | ------------------------------ |
| `data`                    | VisualizationData          | The loaded dataset             |
| `selectedProjectionIndex` | number                     | Current projection index       |
| `selectedAnnotation`      | string                     | Current coloring annotation    |
| `selectionTool`           | `'rectangle'` \| `'lasso'` | Current selection tool         |
| `selectedProteins`        | string[]                   | Currently selected protein IDs |

### Methods

| Method                | Parameters     | Description           |
| --------------------- | -------------- | --------------------- |
| `selectProteins(ids)` | string[]       | Select proteins by ID |
| `clearSelection()`    | -              | Clear all selections  |
| `resetView()`         | -              | Reset zoom and pan    |
| `exportImage(format)` | 'png' \| 'pdf' | Export visualization  |

### Events

| Event              | Detail                       | Description       |
| ------------------ | ---------------------------- | ----------------- |
| `selection-change` | { selected, added, removed } | Selection changed |
| `point-hover`      | { protein, x, y }            | Mouse over point  |
| `point-click`      | { protein }                  | Point clicked     |
| `view-change`      | { zoom, center }             | View changed      |

### Example

```html
<protspace-scatterplot
  id="plot"
  show-grid
  enable-zoom
  enable-pan
  enable-selection
  point-size="4"
  point-opacity="0.7"
></protspace-scatterplot>
```

## Legend

Category filtering and color mapping with automatic settings persistence.

### Attributes

| Attribute              | Type    | Default | Description                             |
| ---------------------- | ------- | ------- | --------------------------------------- |
| `auto-sync`            | boolean | false   | Auto-sync with scatterplot              |
| `scatterplot-selector` | string  | -       | CSS selector for target plot            |
| `show-counts`          | boolean | false   | Show protein counts                     |
| `auto-hide`            | boolean | true    | Hide when no data                       |
| `max-visible-values`   | number  | 10      | Max categories before "Others" grouping |
| `shape-size`           | number  | 40      | Size of legend symbols                  |

### Events

| Event                        | Detail                                                  | Description                           |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `legend-item-click`          | { value, action }                                       | Item clicked (toggle/isolate/extract) |
| `legend-zorder-change`       | { zOrderMapping }                                       | Drawing order changed                 |
| `legend-colormapping-change` | { colorMapping, shapeMapping }                          | Color/shape assignments changed       |
| `legend-customize`           | void                                                    | Settings dialog opened                |
| `legend-download`            | void                                                    | Download requested                    |
| `legend-error`               | { message, severity, source, context?, originalError? } | Host-consumed error event             |

### Persistence

User customizations (visibility, colors, ordering, settings) are automatically saved to localStorage per dataset and annotation.

### Example

```html
<protspace-legend
  auto-sync
  scatterplot-selector="#plot"
  show-counts
  max-visible-values="15"
></protspace-legend>
```

```javascript
const legend = document.querySelector('protspace-legend');

// Listen for z-order changes
legend.addEventListener('legend-zorder-change', (e) => {
  console.log('Z-order:', e.detail.zOrderMapping);
});
```

## Control Bar

Projection and annotation selection controls.

### Attributes

| Attribute                | Type    | Default | Description                  |
| ------------------------ | ------- | ------- | ---------------------------- |
| `auto-sync`              | boolean | false   | Auto-sync with scatterplot   |
| `scatterplot-selector`   | string  | -       | CSS selector for target plot |
| `show-projection-select` | boolean | true    | Show projection dropdown     |
| `show-annotation-select` | boolean | true    | Show annotation dropdown     |
| `show-search`            | boolean | true    | Show search box              |
| `show-export`            | boolean | true    | Show export button           |

### Events

| Event                             | Detail                                 | Description                                                |
| --------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `projection-change`               | { projection, index }                  | Projection changed                                         |
| `annotation-change`               | { annotation }                         | Annotation changed                                         |
| `search`                          | { query, results }                     | Search performed                                           |
| `export`                          | { type, ...options }                   | Export requested                                           |
| `selection-tool-change`           | { selectionTool }                      | Selection tool changed (rectangle/lasso)                   |
| `selection-disabled-notification` | { message, severity, source, context } | Host-consumed warning when selection mode is auto-disabled |

### Example

```html
<protspace-control-bar
  auto-sync
  scatterplot-selector="#plot"
  show-projection-select
  show-annotation-select
  show-search
  show-export
></protspace-control-bar>
```

## Structure Viewer

3D protein structure display using Mol\*.

### Attributes

| Attribute              | Type    | Default     | Description                  |
| ---------------------- | ------- | ----------- | ---------------------------- |
| `auto-sync`            | boolean | false       | Auto-sync with scatterplot   |
| `scatterplot-selector` | string  | -           | CSS selector for target plot |
| `auto-show`            | boolean | false       | Auto-show on selection       |
| `height`               | string  | '400px'     | Viewer height                |
| `title`                | string  | 'Structure' | Viewer title                 |

### Properties

| Property    | Type   | Description        |
| ----------- | ------ | ------------------ |
| `proteinId` | string | Current protein ID |

### Events

| Event             | Detail                                                 | Description                           |
| ----------------- | ------------------------------------------------------ | ------------------------------------- |
| `structure-load`  | { proteinId, status, data? }                           | Lifecycle event for loading or loaded |
| `structure-error` | { message, severity, source, context, originalError? } | Host-consumed error event             |
| `structure-close` | { proteinId }                                          | Viewer closed                         |

### Example

```html
<protspace-structure-viewer
  auto-sync
  auto-show
  scatterplot-selector="#plot"
  height="400px"
  title="Protein Structure"
></protspace-structure-viewer>
```

## Data Loader

`.parquet` and `.parquetbundle` loading component used by the `/explore` app and embedding flows.

### Events

| Event                   | Detail                                                 | Description                 |
| ----------------------- | ------------------------------------------------------ | --------------------------- |
| `data-loading-start`    | void                                                   | Load started                |
| `data-loading-progress` | { current, total, percentage }                         | Incremental progress update |
| `data-loaded`           | { data, settings, source, file? }                      | Dataset loaded successfully |
| `data-error`            | { message, severity, source, context, originalError? } | Host-consumed error event   |

## Data Loading Utilities

Functions for loading `.parquetbundle` files.

### readFileOptimized

Read a file efficiently into an ArrayBuffer.

```typescript
async function readFileOptimized(file: File): Promise<ArrayBuffer>;
```

### isParquetBundle

Check if an ArrayBuffer is a valid parquet bundle.

```typescript
function isParquetBundle(arrayBuffer: ArrayBuffer): boolean;
```

### extractRowsFromParquetBundle

Extract data from a parquet bundle.

```typescript
async function extractRowsFromParquetBundle(arrayBuffer: ArrayBuffer): Promise<ParquetRows>;
```

### convertParquetToVisualizationDataOptimized

Convert parquet data to visualization format.

```typescript
async function convertParquetToVisualizationDataOptimized(
  rows: ParquetRows,
): Promise<VisualizationData>;
```

### Usage Example

```javascript
import {
  readFileOptimized,
  extractRowsFromParquetBundle,
  convertParquetToVisualizationDataOptimized,
} from '@protspace/core';
import { isParquetBundle } from '@protspace/utils';

const file = // ... from file input or drag/drop
const arrayBuffer = await readFileOptimized(file);

if (isParquetBundle(arrayBuffer)) {
  const rows = await extractRowsFromParquetBundle(arrayBuffer);
  const data = await convertParquetToVisualizationDataOptimized(rows);
  document.getElementById('plot').data = data;
}
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import type {
  ProtspaceScatterplot,
  ProtspaceLegend,
  ProtspaceControlBar,
  ProtspaceStructureViewer,
} from '@protspace/core';

import type { VisualizationData, Protein, Projection, Annotation } from '@protspace/utils';

const plot = document.getElementById('plot') as ProtspaceScatterplot;
```

## Browser Compatibility

| Requirement        | Details                                         |
| ------------------ | ----------------------------------------------- |
| Custom Elements v1 | All modern browsers                             |
| Shadow DOM v1      | All modern browsers                             |
| ES2020+            | Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+ |
| WebGL 2.0          | For scatterplot rendering                       |

## Next Steps

- [Embedding Components](/developers/embedding) - Integration patterns
- [Messaging Conventions](/developers/messaging) - Host ownership model
- [Contributing](/developers/contributing) - Development guide
