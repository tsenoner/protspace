# Embedding Components

ProtSpace ships its UI as Lit custom elements that work in any HTML page or JavaScript framework.

::: warning
`@protspace/core` is **not published to npm** yet. The examples below assume you are working inside
the monorepo (or have added the workspace package as a local dependency). There is no CDN build.
:::

## Components Overview

| Component        | Tag                                                                                              | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Scatterplot      | `<protspace-scatterplot>`                                                                        | Main projection visualization                                       |
| Legend           | `<protspace-legend>`                                                                             | Category filtering                                                  |
| View controls    | `<protspace-projection-select>`, `<protspace-annotation-select>`, `<protspace-contours-menu>`    | Projection, Color by and contours                                   |
| Plot tools       | `<protspace-plot-tools>`                                                                         | Move, box and lasso selection                                       |
| Search           | `<protspace-protein-search>`                                                                     | Find and select proteins by ID; reports missing IDs                 |
| Import, Export   | `<protspace-import-menu>`, `<protspace-export-menu>`                                             | Load data, export figures                                           |
| Structure Viewer | `<protspace-structure-viewer>`                                                                   | 3D protein structures                                               |
| Data Loader      | `<protspace-data-loader>`                                                                        | `.parquetbundle` / FASTA loading                                    |
| Selection bar    | `<protspace-selection-bar>`                                                                      | The selected count; Show only these, Zoom to them, Copy IDs, Clear  |
| Status corner    | `<protspace-plot-status>`                                                                        | Protein count and a chip per filter, Show only or hidden categories |
| Filter           | `<protspace-query-builder>`                                                                      | Build and apply an annotation filter                                |
| Figure editor    | `<protspace-publish-modal>`                                                                      | Publication figures; registered by `@protspace/core/publish`        |
| Kit              | `<ps-button>`, `<ps-icon-button>`, `<ps-menu>`, `<ps-popover>`, `<ps-dialog>`, `<ps-tooltip>`, … | The design-system elements the others are built from                |

Importing `@protspace/core` once registers every element.

`<protspace-publish-modal>` is the exception: it lives in the `@protspace/core/publish` entry, so a
host loads it only when a figure is wanted. The [API Reference](/developers/api/) lists every
control, including the projection details card.

## Getting the package

Inside the monorepo, add the workspace dependency:

```json
{
  "dependencies": {
    "@protspace/core": "workspace:*",
    "@protspace/utils": "workspace:*"
  }
}
```

Then `pnpm install` and import it from your entry module.

## Basic HTML Setup

```html
<protspace-projection-select></protspace-projection-select>
<protspace-annotation-select></protspace-annotation-select>
<protspace-scatterplot id="plot"></protspace-scatterplot>
<protspace-legend auto-sync scatterplot-selector="#plot"></protspace-legend>
<protspace-structure-viewer
  auto-sync
  auto-show
  scatterplot-selector="#plot"
></protspace-structure-viewer>

<input type="file" id="fileInput" accept=".parquetbundle" />

<script type="module">
  import '@protspace/core';
  import { readFileOptimized, decodeParquetBundle } from '@protspace/core';

  const fileInput = document.getElementById('fileInput');
  const plot = document.getElementById('plot');
  const projection = document.querySelector('protspace-projection-select');
  const colorBy = document.querySelector('protspace-annotation-select');

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await readFileOptimized(file);
    const { data } = await decodeParquetBundle(arrayBuffer);

    plot.data = data;
    plot.selectedProjectionIndex = 0;
    plot.selectedAnnotation = Object.keys(data.annotations)[0];

    projection.projections = data.projections.map((p) => p.name);
    projection.selectedProjection = data.projections[0].name;
    colorBy.annotations = Object.keys(data.annotations);
    colorBy.annotationDefinitions = data.annotations;
    colorBy.statisticsRows = data.statisticsRows ?? [];
    colorBy.selectedProjection = data.projections[0].name;
    colorBy.selectedAnnotation = plot.selectedAnnotation;
  });

  // The controls report picks; the page applies them to the plot.
  projection.addEventListener('projection-change', (e) => {
    plot.selectedProjectionIndex = plot.data.projections.findIndex(
      (p) => p.name === e.detail.projection,
    );
    colorBy.selectedProjection = e.detail.projection;
  });
  colorBy.addEventListener('annotation-change', (e) => {
    plot.selectedAnnotation = e.detail.annotation;
  });
</script>
```

The legend draws no card (no border, radius or shadow) and has no height of its own: it takes the
height its container gives it and scrolls its list inside that. Outside a sized flex or grid parent,
give it a height, and a border if you want a card (see
[Theming the legend](./style-architecture.md#theming-the-legend)):

```css
protspace-legend {
  height: 480px;
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
}
```

::: tip
Every component is a Lit element, so every public property is settable from JavaScript. Lit also
derives an HTML attribute for each reactive property: properties declared with an explicit
`attribute` name get that kebab-case attribute, and the rest get an implicit all-lowercase one, for
example `selectedAnnotation` is settable as `selectedannotation="family"`. Only properties declared
`attribute: false` are JavaScript-only, such as the data loader's `loadFromFileHandler`. Object and
array properties are parsed from JSON strings in markup, so set those from JavaScript, which is why
`data` is assigned in the script above. See the [API Reference](/developers/api/).
:::

## Theming

Importing `@protspace/core` (or `@protspace/core/kit`) adds the design tokens to the page once: a
stylesheet of `--ps-*` custom properties on `:root`, in the `ps-theme` cascade layer. Every
component reads its colours, type sizes, spacing and radii from these tokens, so they are the one
place to restyle them.

### Light and dark

The page is light unless `<html>` carries `data-theme="dark"` (always dark) or
`data-theme="system"` (dark while the operating system prefers dark, following a change live):

```js
document.documentElement.dataset.theme = 'system'; // or 'dark'; delete it for light
```

With no `data-theme`, or any other value, the tokens hold their light values. Set the attribute
before the components first render to avoid a light flash. The scatterplot and the structure
viewer restyle themselves when the theme changes, without reloading anything. Exports (PNG, PDF and
the figure editor's output) always use the light colours on white.

### Your own colours

The tokens sit in a cascade layer, so any unlayered rule of yours wins over them, whatever its
specificity:

```css
/* Both themes */
:root {
  --ps-accent: #7c3aed;
}

/* Dark only: under data-theme="dark", and under "system" while the OS prefers dark */
:root[data-theme='dark'] {
  --ps-accent: #a78bfa;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme='system'] {
    --ps-accent: #a78bfa;
  }
}
```

A rule inside another cascade layer (Tailwind's `@layer base`, for example) does not override a
token; keep token overrides unlayered. The tokens are listed, light and dark, in
`packages/core/src/styles/theme.ts`; the ones a host most often sets are `--ps-accent`,
`--ps-surface`, `--ps-surface-raised`, `--ps-text`, `--ps-text-muted`, `--ps-border` and
`--ps-plot-bg`.

### Components in another document

The tokens are added to the document that imports the module. Components rendered into an
`<iframe>` need `@protspace/core` imported by a script inside that iframe, which adds the tokens to
the iframe's own document.

::: warning BREAKING
The `--protspace-*` colour properties (the scatterplot's background, brush, tooltip and overlay
colours; the structure viewer's `--protspace-viewer-bg`, `-border`, `-header-bg`, `-text`,
`-text-muted`, `-error`, `-loading`) are removed. A host that set them sets the `--ps-*` token the
component now reads instead. Size properties such as the scatterplot's `--protspace-height` stay. See
[Component properties](./style-architecture.md#component-properties).
:::

## Auto-Sync Feature

Components with the `auto-sync` attribute find the scatterplot named by `scatterplot-selector` and
push their changes into it directly, so you do not have to wire the events yourself. `autoSync` is
on by default, so the attribute only spells it out:

```html
<protspace-scatterplot id="plot"></protspace-scatterplot>

<protspace-legend auto-sync scatterplot-selector="#plot"></protspace-legend>
<protspace-structure-viewer auto-sync scatterplot-selector="#plot"></protspace-structure-viewer>
```

The legend follows the scatterplot whatever `autoSync` says. Setting `legend.autoSync = false` hands
the legend to its host, as the ProtSpace app does while it loads a dataset: the legend then counts
categories in protein order, the order a per-protein `annotationValues` feed has, and leaves the EAT
overlay switch for the host to apply to the plot.

The view and app controls (Projection, Color by, Contours, search, Import, Export and the plot
tools) have no auto-sync. They report picks as events and leave the plot to the host, as the
example above does for Projection and Color by; the [API Reference](/developers/api/) lists each
control's events and the plot properties they map to.

## Configuring the plot

Sizing, opacity and zoom limits live in the `config` object property:

```javascript
plot.config = {
  pointSize: 80,
  baseOpacity: 0.9,
  selectedOpacity: 1.0,
  fadedOpacity: 0.15,
  zoomExtent: [0.1, 1000],
};
```

`pointSize` is area-like: a dot's radius is `√pointSize / 3` CSS px (3.0 px at the default 80) on a 1000×700 plot at zoom 1. Dots grow on zoom-in by `k^¼` (×1.41 at k = 4, ×2 at k = 16, at most ×4) and never shrink on zoom-out. They also scale with the plot's CSS area by `(area / 1000·700)^¼`, bounded to ×0.8…×1.5. Device pixel ratio is applied on top, so the CSS size is the same on every pixel density.

Omitted keys keep their defaults.

## Host Messaging Pattern

ProtSpace components emit semantic warning and error events, but the host application owns transient
notifications.

```javascript
function notify({ level, title, description }) {
  // Replace this with your app's toast system.
  console[level === 'error' ? 'error' : 'log'](title, description ?? '');
}

const plot = document.getElementById('plot');
const dataLoader = document.querySelector('protspace-data-loader');
const legend = document.querySelector('protspace-legend');
const viewer = document.querySelector('protspace-structure-viewer');

plot.addEventListener('auto-disable-selection', (event) => {
  const { reason, dataSize } = event.detail;
  notify({
    level: 'warning',
    title: 'Selection mode disabled.',
    description: reason === 'insufficient-data' ? `Only ${dataSize} point(s) remaining` : undefined,
  });
});

dataLoader.addEventListener('data-error', (event) => {
  notify({
    level: 'error',
    title: 'Dataset import failed.',
    description: event.detail.message,
  });
});

legend.addEventListener('legend-error', (event) => {
  notify({
    level: 'error',
    title: 'Legend update failed.',
    description: event.detail.message,
  });
});

viewer.addEventListener('structure-error', (event) => {
  console.error('Structure viewer error:', event.detail.message);
});
```

Keep structure viewer empty/loading/error messaging inline in the component itself instead of
duplicating it with a global toast.

## React Integration

```jsx
import { useRef } from 'react';
import '@protspace/core';
import { readFileOptimized, decodeParquetBundle } from '@protspace/core';

export default function ProtSpaceViewer() {
  const plotRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const arrayBuffer = await readFileOptimized(file);
      const { data } = await decodeParquetBundle(arrayBuffer);

      // Object props must be assigned imperatively, JSX would stringify them.
      plotRef.current.data = data;
      plotRef.current.selectedProjectionIndex = 0;
      plotRef.current.selectedAnnotation = Object.keys(data.annotations)[0];
    } catch (error) {
      console.error('Dataset import failed:', error);
    }
  };

  return (
    <div>
      <input type="file" accept=".parquetbundle" onChange={handleFileChange} />

      <protspace-scatterplot ref={plotRef} id="plot" />
      <protspace-legend auto-sync scatterplot-selector="#plot" />
      <protspace-structure-viewer auto-sync scatterplot-selector="#plot" />
    </div>
  );
}
```

## Vue 3 Integration

```vue
<template>
  <div>
    <input type="file" accept=".parquetbundle" @change="handleFileChange" />

    <protspace-scatterplot ref="plot" id="plot" />
    <protspace-legend auto-sync scatterplot-selector="#plot" />
    <protspace-structure-viewer auto-sync scatterplot-selector="#plot" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import '@protspace/core';
import { readFileOptimized, decodeParquetBundle } from '@protspace/core';

const plot = ref(null);

const handleFileChange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await readFileOptimized(file);
    const { data } = await decodeParquetBundle(arrayBuffer);

    plot.value.data = data;
    plot.value.selectedProjectionIndex = 0;
    plot.value.selectedAnnotation = Object.keys(data.annotations)[0];
  } catch (error) {
    console.error('Dataset import failed:', error);
  }
};
</script>
```

## Event Handling

```javascript
const plot = document.getElementById('plot');
const dataLoader = document.querySelector('protspace-data-loader');
const legend = document.querySelector('protspace-legend');
const viewer = document.querySelector('protspace-structure-viewer');

// Point click, modifierKeys is { ctrl, meta, shift, alt }
plot.addEventListener('protein-click', (e) => {
  console.log('Clicked:', e.detail.proteinId, e.detail.modifierKeys);
});

// Point hover
plot.addEventListener('protein-hover', (e) => {
  console.log('Hovering:', e.detail.proteinId);
});

// Rectangle / lasso selection committed
plot.addEventListener('brush-selection', (e) => {
  console.log('Selected:', e.detail.proteinIds);
});

// Legend item interactions. A mouse double-click fires 'toggle' for its first click,
// then 'isolate'; the second click of the pair fires nothing.
legend.addEventListener('legend-item-click', (e) => {
  console.log(`${e.detail.value}: ${e.detail.action}`);
});

dataLoader.addEventListener('data-error', (e) => {
  console.error('Dataset import failed:', e.detail.message);
});

legend.addEventListener('legend-error', (e) => {
  console.error('Legend update failed:', e.detail.message);
});

viewer.addEventListener('structure-error', (e) => {
  console.error('Structure could not be loaded:', e.detail.message);
});
```

For the ownership model behind these events, see [Messaging Conventions](/developers/messaging).

## Programmatic Control

Selection is state, not a method call: assign `selectedProteinIds` to change it.

```javascript
const plot = document.getElementById('plot');

// Select proteins
plot.selectedProteinIds = ['P12345', 'P67890'];

// Clear the selection
plot.selectedProteinIds = [];

// Isolate the current selection, then restore the full dataset
plot.isolateSelection();
plot.resetIsolation();

// Reset zoom and pan
plot.resetZoom();

// Read what is currently displayed
const visible = plot.getCurrentData();
```

Image export is driven by `<protspace-export-menu>`, which emits an `export` event with the requested format
and options for the host to act on. See [Exporting](/explore/exporting).

## Drag and Drop Pattern

::: warning BREAKING
The scatterplot no longer handles drops or emits `file-dropped`, and the data loader's `allowDrop`
(`allow-drop`) is gone. A drop belongs to the host page, which knows its own layout.
:::

Listen on the element that should accept a file, act only on drags that carry files, and load what
is dropped:

```javascript
const area = document.getElementById('app');
const plot = document.getElementById('plot');
const carriesFiles = (event) => [...event.dataTransfer.types].includes('Files');

area.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault(); // allows the drop
  event.dataTransfer.dropEffect = 'copy';
});

area.addEventListener('drop', async (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file?.name.endsWith('.parquetbundle')) return;

  const arrayBuffer = await readFileOptimized(file);
  const { data } = await decodeParquetBundle(arrayBuffer);
  plot.data = data;
});
```

Checking for `Files` leaves text drags and in-page drags (the legend's row reordering) alone. The
ProtSpace app does the same over its whole workbench and hands the file to its data loader.

## Loading from URL

```javascript
async function loadFromUrl(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  const { data } = await decodeParquetBundle(arrayBuffer);

  document.getElementById('plot').data = data;
}
```

## Next Steps

- [API Reference](/developers/api/) - Full component surface
- [Messaging Conventions](/developers/messaging) - Host ownership model
- [Contributing](/developers/contributing) - Development guide
