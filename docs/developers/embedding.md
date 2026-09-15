# Embedding Components

ProtSpace ships its UI as Lit custom elements that work in any HTML page or JavaScript framework.

::: warning
`@protspace/core` is **not published to npm** yet. The examples below assume you are working inside
the monorepo (or have added the workspace package as a local dependency). There is no CDN build.
:::

## Components Overview

| Component        | Tag                            | Purpose                          |
| ---------------- | ------------------------------ | -------------------------------- |
| Scatterplot      | `<protspace-scatterplot>`      | Main projection visualization    |
| Legend           | `<protspace-legend>`           | Category filtering               |
| Control Bar      | `<protspace-control-bar>`      | Projection/annotation selection  |
| Structure Viewer | `<protspace-structure-viewer>` | 3D protein structures            |
| Data Loader      | `<protspace-data-loader>`      | `.parquetbundle` / FASTA loading |

Importing `@protspace/core` once registers every element.

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
<protspace-control-bar auto-sync scatterplot-selector="#plot"></protspace-control-bar>
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
  import {
    readFileOptimized,
    extractRowsFromParquetBundle,
    convertParquetToVisualizationDataOptimized,
  } from '@protspace/core';

  const fileInput = document.getElementById('fileInput');
  const plot = document.getElementById('plot');

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await readFileOptimized(file);
    const bundle = await extractRowsFromParquetBundle(arrayBuffer);
    const data = await convertParquetToVisualizationDataOptimized(bundle);

    plot.data = data;
    plot.selectedProjectionIndex = 0;
    plot.selectedAnnotation = Object.keys(data.annotations)[0];
  });
</script>
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

## Auto-Sync Feature

Components with the `auto-sync` attribute find the scatterplot named by `scatterplot-selector` and
push their changes into it directly, so you do not have to wire the events yourself:

```html
<protspace-scatterplot id="plot"></protspace-scatterplot>

<protspace-legend auto-sync scatterplot-selector="#plot"></protspace-legend>
<protspace-control-bar auto-sync scatterplot-selector="#plot"></protspace-control-bar>
<protspace-structure-viewer auto-sync scatterplot-selector="#plot"></protspace-structure-viewer>
```

## Configuring the plot

Sizing, opacity and zoom limits live in the `config` object property:

```javascript
plot.config = {
  pointSize: 240,
  baseOpacity: 0.9,
  selectedOpacity: 1.0,
  fadedOpacity: 0.15,
  zoomExtent: [0.1, 1000],
};
```

Omitted keys keep their defaults.

## Host Messaging Pattern

ProtSpace components emit semantic warning and error events, but the host application owns transient
notifications.

```javascript
function notify({ level, title, description }) {
  // Replace this with your app's toast system.
  console[level === 'error' ? 'error' : 'log'](title, description ?? '');
}

const controlBar = document.querySelector('protspace-control-bar');
const dataLoader = document.querySelector('protspace-data-loader');
const legend = document.querySelector('protspace-legend');
const viewer = document.querySelector('protspace-structure-viewer');

controlBar.addEventListener('selection-disabled-notification', (event) => {
  notify({
    level: 'warning',
    title: 'Selection mode disabled.',
    description: event.detail.message,
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
import {
  readFileOptimized,
  extractRowsFromParquetBundle,
  convertParquetToVisualizationDataOptimized,
} from '@protspace/core';

export default function ProtSpaceViewer() {
  const plotRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const arrayBuffer = await readFileOptimized(file);
      const bundle = await extractRowsFromParquetBundle(arrayBuffer);
      const data = await convertParquetToVisualizationDataOptimized(bundle);

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

      <protspace-control-bar auto-sync scatterplot-selector="#plot" />
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

    <protspace-control-bar auto-sync scatterplot-selector="#plot" />
    <protspace-scatterplot ref="plot" id="plot" />
    <protspace-legend auto-sync scatterplot-selector="#plot" />
    <protspace-structure-viewer auto-sync scatterplot-selector="#plot" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import '@protspace/core';
import {
  readFileOptimized,
  extractRowsFromParquetBundle,
  convertParquetToVisualizationDataOptimized,
} from '@protspace/core';

const plot = ref(null);

const handleFileChange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await readFileOptimized(file);
    const bundle = await extractRowsFromParquetBundle(arrayBuffer);
    const data = await convertParquetToVisualizationDataOptimized(bundle);

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

// Legend item interactions
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

Image export is driven by the control bar, which emits an `export` event with the requested format
and options for the host to act on. See [Exporting](/explore/exporting).

## Drag and Drop Pattern

The scatterplot re-emits dropped files as a bubbling `file-dropped` event, so you can handle drops
without wiring DOM drag listeners yourself:

```javascript
const plot = document.getElementById('plot');

plot.addEventListener('file-dropped', async (e) => {
  const file = e.detail.file;
  if (!file.name.endsWith('.parquetbundle')) return;

  const arrayBuffer = await readFileOptimized(file);
  const bundle = await extractRowsFromParquetBundle(arrayBuffer);
  plot.data = await convertParquetToVisualizationDataOptimized(bundle);
});
```

## Loading from URL

```javascript
async function loadFromUrl(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  const bundle = await extractRowsFromParquetBundle(arrayBuffer);
  const data = await convertParquetToVisualizationDataOptimized(bundle);

  document.getElementById('plot').data = data;
}
```

## Next Steps

- [API Reference](/developers/api/) - Full component surface
- [Messaging Conventions](/developers/messaging) - Host ownership model
- [Contributing](/developers/contributing) - Development guide
