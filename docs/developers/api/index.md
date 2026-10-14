# API Reference

ProtSpace ships its UI as Lit custom elements in `@protspace/core`. This page documents the API as
it exists on `main`.

::: warning
`@protspace/core` is **not published to npm** yet. Consume it from the monorepo workspace, see
[Embedding Components](/developers/embedding).
:::

## Components

| Component                                   | Tag                               | Purpose                                       |
| ------------------------------------------- | --------------------------------- | --------------------------------------------- |
| [Scatterplot](#scatterplot)                 | `<protspace-scatterplot>`         | Main projection visualization                 |
| [Legend](#legend)                           | `<protspace-legend>`              | Category filtering and colors                 |
| [Projection Select](#projection-select)     | `<protspace-projection-select>`   | Projection picker                             |
| [Annotation Select](#annotation-select)     | `<protspace-annotation-select>`   | Color by and tooltip annotations              |
| [Contours Menu](#contours-menu)             | `<protspace-contours-menu>`       | Density contour mode                          |
| [Projection Metadata](#projection-metadata) | `<protspace-projection-metadata>` | Details of the projection on screen           |
| [Protein Search](#protein-search)           | `<protspace-protein-search>`      | Find and select proteins by ID                |
| [Query Builder](#query-builder)             | `<protspace-query-builder>`       | Filter conditions                             |
| [Import Menu](#import-menu)                 | `<protspace-import-menu>`         | Load a file or an example dataset             |
| [Export Menu](#export-menu)                 | `<protspace-export-menu>`         | Image, ID and Parquet export                  |
| [Plot Tools](#plot-tools)                   | `<protspace-plot-tools>`          | Move, box and lasso tools                     |
| [Selection Bar](#selection-bar)             | `<protspace-selection-bar>`       | The selection's count and actions             |
| [Plot Status](#plot-status)                 | `<protspace-plot-status>`         | The plot's count and how the view is narrowed |
| [Structure Viewer](#structure-viewer)       | `<protspace-structure-viewer>`    | 3D protein structures via Mol\*               |
| [Data Loader](#data-loader)                 | `<protspace-data-loader>`         | `.parquetbundle` / FASTA loading              |

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

| Property                            | Type                                  | Default       | Description                                     |
| ----------------------------------- | ------------------------------------- | ------------- | ----------------------------------------------- |
| `data`                              | `VisualizationData \| null`           | `null`        | The loaded dataset                              |
| `selectedProjectionIndex`           | `number`                              | `0`           | Index of the active projection                  |
| `projectionPlane`                   | `'xy' \| 'xz' \| 'yz'`                | `'xy'`        | Plane shown for 3D projections                  |
| `selectedAnnotation`                | `string`                              | `'family'`    | Annotation used for coloring                    |
| `tooltipAnnotations`                | `string[]`                            | `[]`          | Extra annotations shown in the tooltip          |
| `highlightedProteinIds`             | `string[]`                            | `[]`          | Proteins to highlight                           |
| `selectedProteinIds`                | `string[]`                            | `[]`          | Currently selected protein IDs                  |
| `selectionMode`                     | `boolean`                             | `false`       | Enable brush/lasso selection                    |
| `selectionTool`                     | `'rectangle' \| 'lasso'`              | `'rectangle'` | Active selection tool                           |
| `hiddenAnnotationValues`            | `string[]`                            | `[]`          | Annotation values hidden from the plot          |
| `otherAnnotationValues`             | `string[]`                            | `[]`          | Values folded into the "Other" group            |
| `numericAnnotationSettings`         | `NumericAnnotationDisplaySettingsMap` | `{}`          | Per-annotation binning/gradient settings        |
| `annotationSortModes`               | `Record<string, LegendSortMode>`      | `{}`          | Per-annotation legend sort mode                 |
| `numericManualOrderIdsByAnnotation` | `Record<string, string[]>`            | `{}`          | Manual bin ordering per numeric annotation      |
| `filteredProteinIds`                | `string[]`                            | `[]`          | Result of an active filter query                |
| `filtersActive`                     | `boolean`                             | `false`       | Whether `filteredProteinIds` should be applied  |
| `config`                            | `Partial<ScatterplotConfig>`          | `{}`          | Sizing, opacity and zoom configuration          |
| `tooltipActions`                    | `readonly TooltipAction[]`            | `[]`          | Buttons a pinned tooltip offers (see below)     |
| `tapTooltips`                       | `boolean`                             | `true`        | A touch tap on a protein pins its tooltip       |
| `touchTooltipInsets`                | `TouchTooltipInsets`                  | all `0`       | Edge strips a tap-pinned tooltip keeps clear of |
| `hideStatus`                        | `boolean`                             | `false`       | Leave out the plot's own count; `hide-status`   |

### HTML attributes

Four properties have explicit kebab-case attributes: `selection-tool`, `filters-active`,
`eat-overlay-enabled` and `hide-status`. The rest are reachable from markup under their implicit all-lowercase names
(for example `selectedannotation`, `projectionplane`); `tooltipActions`, `tapTooltips` and `touchTooltipInsets` have no attribute. Set the object and array properties from JavaScript.

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
few points are visible, and `'on'` draws them at full strength at every zoom. The Contours menu
labels `'on'` as Always (`DENSITY_MODE_LABELS`, from `@protspace/utils`). When the context cannot draw them, the plot emits
`renderer-degraded` once, with `context.reason` set to `density-unavailable`, and keeps drawing the
points.

### Methods

| Method                          | Returns                     | Description                                                                                                                                                             |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resetZoom()`                   | `void`                      | Snap back to the full view                                                                                                                                              |
| `zoomToProteins(ids)`           | `boolean`                   | Pan and zoom, untweened, to frame the plotted, visible proteins among `ids`: one at the centre at 8× or more, several inside a 40 px margin; false when none is plotted |
| `isolateSelection()`            | `void`                      | Isolate the currently selected proteins                                                                                                                                 |
| `resetIsolation()`              | `void`                      | Exit isolation and restore the full dataset                                                                                                                             |
| `popIsolation()`                | `void`                      | Undo one isolation step: back to the step before it, or out of isolation after the first                                                                                |
| `clearIsolationState(options?)` | `void`                      | Clear isolation state; pass `{ silent: true }` to skip the event                                                                                                        |
| `isIsolationMode()`             | `boolean`                   | Whether the plot is currently isolated                                                                                                                                  |
| `getIsolationHistory()`         | `string[][]`                | Stack of isolation steps                                                                                                                                                |
| `getCurrentData(options?)`      | `VisualizationData \| null` | The dataset as currently displayed (filtered/isolated)                                                                                                                  |
| `getMaterializedData()`         | `VisualizationData \| null` | Dataset with numeric annotations materialized into bins                                                                                                                 |
| `pickInteractivePointAt(x, y)`  | `PlotDataPoint \| null`     | Hit-test at client-relative pixel coordinates                                                                                                                           |
| `hasExpandedDuplicateStack()`   | `boolean`                   | Whether a duplicate stack is expanded                                                                                                                                   |
| `closeExpandedDuplicateStack()` | `void`                      | Collapse the expanded duplicate stack                                                                                                                                   |

### Events

All scatterplot events bubble.

| Event                    | Detail                                           | Description                                     |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `protein-click`          | `{ proteinId, point, view, modifierKeys }`       | A point was clicked                             |
| `protein-hover`          | `{ proteinId, point, view }`                     | The pointer entered a point                     |
| `tooltip-action`         | `{ id, proteinId }`                              | A pinned tooltip's action pressed               |
| `brush-selection`        | `{ proteinIds, isMultiple, idsUnique }`          | Rectangle/lasso selection committed             |
| `data-change`            | `{ data }`                                       | The displayed dataset changed                   |
| `data-isolation`         | `{ isolationHistory, isolationMode, dataSize }`  | Isolation applied                               |
| `data-isolation-reset`   | `{ isolationHistory, isolationMode, dataSize? }` | Isolation cleared                               |
| `auto-disable-selection` | `{ reason, dataSize }`                           | Selection mode turned itself off                |
| `renderer-degraded`      | `{ message, severity, source, context }`         | A rendering capability was reduced              |
| `view-status-change`     | `{ count, zoomedIn }`                            | The visible count or the zoomed-in flag changed |
| `hidden-values-change`   | `{ count }`                                      | The number of hidden category values changed    |

::: warning BREAKING
`file-dropped` is removed: the scatterplot no longer handles drops. Drops belong to the host page,
which knows its own layout; see [Drag and Drop Pattern](/developers/embedding#drag-and-drop-pattern).
:::

`modifierKeys` on `protein-click` is `{ ctrl, meta, shift, alt }`. `view` is the tooltip-friendly
projection of the protein's annotations; `point` is the bare plot point.

`tooltipActions` takes `{ id, label }` objects (`TooltipAction`) and is a property only. While it
holds any, a plain click on a protein pins its tooltip at the protein with one button per action.
The pin ends on Escape, a press outside the plot, the next click, a zoom or pan, a data or
projection change, or when `tooltipActions` becomes empty. Hovers over other proteins leave it. A button dispatches
`tooltip-action` (bubbles, composed) with the action's `id` and the pinned `proteinId`
(`TooltipActionDetail`). Empty, the default, keeps mouse tooltips hover-only. A pinned tooltip also lists the protein's AlphaFold, UniProt, InterPro and TED links above its buttons.

Touch uses the same pin. A tap is a click whose pointer is a finger: it picks the protein within
20 px (a mouse click needs the point under the cursor) and, while `tapTooltips` is true (the
default), pins that protein's tooltip even when `tooltipActions` is empty, since touch has no hover
to show it. The pin offers whatever `tooltipActions` holds, outlives `tooltipActions` becoming empty,
and sits wholly inside the plot, centred over the protein and above it when it fits.
`touchTooltipInsets` (`{ top, right, bottom, left }` in px, exported type `TouchTooltipInsets`)
names the strips along the plot's edges that the host's own controls cover, such as a tool strip
or a `<protspace-selection-bar>`; the pin stays clear of them. They are all 0 by default, so a host
that lays controls over the plot sets them. Set
`tapTooltips` to false to keep taps from pinning; turning it false ends a pin. The mouse events a
browser sends after a tap never start a hover tooltip, a pan or pinch by touch ends one, and the
plot's SVG has `touch-action: none`, so pans and pinches move the plot, never the page.

Escape follows the kit's one layer stack (`ESCAPE_ORDER`, `onEscapeFallback` and `pushLayer`,
exported from `@protspace/core`). An expanded duplicate stack and a pinned tooltip are layers: the
next Escape closes them before anything else. With no layer open, the plot's own Escape fallback,
registered at `ESCAPE_ORDER.connectors` while it is connected, hides the EAT provenance connectors.
A host registers its own steps at higher orders (the app clears the selection at
`ESCAPE_ORDER.selection` and returns to Move at `ESCAPE_ORDER.tool`), and each press takes only one
step.

The plot no longer draws its own "Selection Mode" and "N proteins selected" badge; a host shows
the selection with `<protspace-selection-bar>`. A brush or lasso that starts ends a pinned tooltip.
The EAT connector status chip sits at the top-centre of the plot.

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
| `shapeSize`          | `number`                  | -       | Dot size in use (see below)             |
| `isolationMode`      | `boolean`                 | `false` | Reflects the plot's isolation state     |
| `isolationHistory`   | `string[][]`              | `[]`    | Isolation stack from the plot           |

### HTML attributes

`scatterplot-selector`, `auto-sync`, `auto-hide`.

### CSS parts

`container`, `header`, `title`, `items`, `item`, `symbol`, `text`, `count` and `empty`. `title`
is the header's annotation name. The `predicted-note` part is gone: a predicted annotation shows
a sparkles icon in the header, with its note in the icon's tooltip.

### Slots

| Name           | Description                                                             |
| -------------- | ----------------------------------------------------------------------- |
| `header-start` | Controls placed at the start of the 44 px header row, before the title  |
| `header-end`   | Controls placed at the end of the header row, after the settings button |

An empty slot takes no room. The demo app puts its Legend/Filter tabs in `header-start` below
951 px and, on phones, the panel's fold button in `header-end`.

### Events

| Event                        | Detail                                                    | Description                           |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `legend-item-click`          | `{ value, action }`                                       | Item clicked (toggle/isolate/extract) |
| `legend-zorder-change`       | `{ zOrderMapping }`                                       | Drawing order changed                 |
| `legend-colormapping-change` | `{ colorMapping, shapeMapping }`                          | Color/shape assignments changed       |
| `legend-customize`           | none                                                      | Settings popover opened               |
| `legend-download`            | none                                                      | Download requested                    |
| `legend-error`               | `{ message, severity, source, context?, originalError? }` | Host-consumed error event             |

Settings and the "Other" categories open as popovers (`protspace-legend-settings-popover`,
`protspace-legend-other-popover`) in the top layer, inside the legend's shadow root. Settings
apply as they are edited: a typed number commits 300 ms after the last keystroke, or at once on
Enter or when the field loses focus. The parts `dialog-overlay` and `dialog-content` are gone.

### Methods

| Member                               | Returns               | Description                                                                          |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `applyShapeSize(size, datasetHash?)` | `void`                | Apply a dataset-wide shape size, e.g. a bundle's top-level `shapeSize`, and store it |
| `pickedShapeSize` (getter)           | `number \| undefined` | The dataset-wide shape size, or `undefined` while none was picked or applied         |
| `showAllCategories()`                | `void`                | Show every hidden category, sync the plot and store the settings                     |

Pass `datasetHash` to `applyShapeSize` when the legend has not computed the new dataset's hash yet.
A size above 64 is applied and stored as 64. Write `pickedShapeSize`, not `shapeSize`, into a bundle's top-level `shapeSize`: the live
`shapeSize` may only be seeded from the current annotation, or be the default computed from the
dataset's protein count, `clamp(round(10 · (10000 / N)^⅔), 1, 10)`, which is never stored or
exported. The legend resolves `shapeSize` from the picked or applied size, then the annotation's own
`shapeSize` (10 and 30 read as unset), then that default.

### Persistence

User customizations (visibility, colors, ordering, settings) are saved to `localStorage` per dataset
and annotation. Per-category state is not persisted for numeric annotations, whose legend entries
are generated bin IDs. The shape size is stored per dataset instead: once picked, it applies to
every annotation. Reset in the settings popover clears it, and every annotation's own size, so
the default applies again; emptying the size field does the same for the size alone, at once.

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

## View and App Controls

::: warning BREAKING
`<protspace-control-bar>` is removed. Its controls are separate elements now, each with one job:
`protspace-projection-select`, `protspace-annotation-select`, `protspace-contours-menu`,
`protspace-projection-metadata`, `protspace-protein-search`, `protspace-query-builder`,
`protspace-import-menu`, `protspace-export-menu` and `protspace-plot-tools`. They do not write to
the scatterplot (`auto-sync` and `scatterplot-selector` are gone): listen for their events and set
`selectedProjectionIndex`, `selectedAnnotation`, `tooltipAnnotations`, `config.densityLayer`,
`selectedProteinIds`, `selectionMode` and `selectionTool` yourself, as the app's controllers in
`apps/web/src/explore/*-controller.ts` do. `selection-disabled-notification` is replaced by the
scatterplot's `auto-disable-selection`, and `eat-threshold-mirror` by the host's own filter, which
calls the legend's `setReliabilityState()`. The legend hears `annotation-change` and
`projection-change` from anywhere in its document.
:::

A pick from the Projection, Color by or Contours menu shows at once and reaches listeners, with
its event, one frame later, after the browser has painted the closed menu; the newest pick wins.
A picker's `applySelection()` applies at once, fires its event and drops a pick still waiting (the
contours menu's fires none); `cancelPending()` drops the waiting pick without applying anything, as
a new dataset does. Every event below bubbles and is composed.

### Projection Select

The projection picker: radio items behind a "Projection" trigger that shows the current value.

| Property             | Type                | Description                                            |
| -------------------- | ------------------- | ------------------------------------------------------ |
| `projections`        | `readonly string[]` | Projection names to offer; JavaScript-only             |
| `selectedProjection` | `string`            | Projection shown in the trigger; `selected-projection` |

Methods: `applySelection(projection)`, `cancelPending()`.

| Event               | Detail           | Description        |
| ------------------- | ---------------- | ------------------ |
| `projection-change` | `{ projection }` | Projection changed |

### Annotation Select

"Color by": the annotation that colours the plot, in a searchable list that also pins extra
annotations into the plot tooltip.

| Property                | Type                                          | Description                                                     |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `annotations`           | `string[]`                                    | Annotations offered for colouring                               |
| `annotationDefinitions` | `Record<string, Pick<Annotation, 'runtime'>>` | The dataset's annotation definitions                            |
| `eatAnnotations`        | `string[]`                                    | Annotations that carry EAT predictions                          |
| `selectedAnnotation`    | `string`                                      | Colouring annotation; `selected-annotation`                     |
| `tooltipAnnotations`    | `string[]`                                    | Annotations pinned into the plot tooltip                        |
| `statisticsRows`        | `readonly ProjectionStatisticRow[]`           | The bundle's optional statistics, read for `selectedProjection` |
| `selectedProjection`    | `string`                                      | Projection the statistics are read for; `selected-projection`   |
| `label`                 | `string`                                      | Key shown before the value, default `'Color by'`                |
| `placeholder`           | `string`                                      | Shown while nothing is selected                                 |

Only `annotations` is required; the rest decide what each row says. `annotationDefinitions` (the
dataset's `annotations` record) names runtime columns, such as an EAT confidence column ("EC
number — EAT confidence"), and keeps a column of your own that merely ends like one from being
renamed. `eatAnnotations` adds the EAT badge to annotations that carry transferred predictions.
`statisticsRows` with `selectedProjection` adds the STATS badge to annotations the bundle scored in
that projection. A predicted annotation (the registry's flag, else a `predicted_` prefix) carries a
sparkles mark named "Predicted annotation". The rows are options of a listbox the search field
controls; Shift+Enter on the highlighted row shows or hides it in the hover tooltip.

Methods: `applySelection(annotation)`, `applyTooltipSelection(names)`, `cancelPending()`.

| Event                        | Detail                   | Description                    |
| ---------------------------- | ------------------------ | ------------------------------ |
| `annotation-change`          | `{ annotation }`         | Colouring annotation changed   |
| `tooltip-annotations-change` | `{ tooltipAnnotations }` | Tooltip annotation set changed |

Picking a tooltip extra as the colouring annotation fires `annotation-change`, then
`tooltip-annotations-change` without it.

### Contours Menu

| Property       | Type                      | Description                                    |
| -------------- | ------------------------- | ---------------------------------------------- |
| `densityLayer` | `'off' \| 'auto' \| 'on'` | Contour mode, default `'off'`; `density-layer` |

Methods: `pick(mode)` (a user's pick made from code: shows at once, fires after the paint),
`applySelection(mode)` (no event), `cancelPending()`.

| Event                  | Detail             | Description          |
| ---------------------- | ------------------ | -------------------- |
| `density-layer-change` | `{ densityLayer }` | Contour mode changed |

The detail type is `DensityLayerChangeDetail`. `DENSITY_MODE_LABELS` maps each mode to the menu's
label and hint, for hosts that offer the modes elsewhere; `'on'` reads "Always".

### Projection Metadata

An info button whose card describes the projection on screen. The host places it; the app puts it
beside the Projection picker.

| Property                | Type                                          | Description                                                        |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `projection`            | `Projection \| null`                          | The projection on screen                                           |
| `statisticsRows`        | `readonly ProjectionStatisticRow[]`           | The bundle's optional statistics                                   |
| `selectedAnnotation`    | `string`                                      | Annotation the quality section is scored on; `selected-annotation` |
| `viewIsSubset`          | `boolean`                                     | The plot shows a filtered or isolated subset                       |
| `annotationDefinitions` | `Record<string, Pick<Annotation, 'runtime'>>` | The dataset's annotation definitions; name runtime columns         |

### Protein Search

| Property              | Type       | Description                   |
| --------------------- | ---------- | ----------------------------- |
| `availableProteinIds` | `string[]` | IDs it suggests               |
| `selectedProteinIds`  | `string[]` | The selection, shown as chips |

⌘K (Ctrl+K elsewhere) focuses it, and pasting several IDs (separated by spaces, commas, semicolons
or new lines) selects every one it finds. It writes nothing to the plot: set
`plot.selectedProteinIds` and `search.selectedProteinIds` from its events.

It says what happened in its popup: "No protein P12345 in this dataset" for an unknown ID (the text
stays), "P12345 is already selected", and for a pasted list "12 of 15 found" with the missing IDs
(the first 50, then "and N more") and a Copy missing IDs button.

| Event                    | Detail                    | Description                                              |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `selection-change`       | `{ proteinIds }`          | Replace the selection                                    |
| `add-selection`          | `{ proteinId, source }`   | Add one protein; `source` is `'typed'` or `'suggestion'` |
| `add-selection-multiple` | `{ proteinIds, missing }` | Add the pasted proteins it found; `missing` as pasted    |
| `remove-selection`       | `{ proteinId }`           | Remove one protein                                       |

| Method                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `reportNotInView(proteinId)` | Say that a protein it added is selected but hidden in this view (filter, isolation) |
| `focusInput()`               | Focus the text field without scrolling, as ⌘K does                                  |

The app zooms to a single added protein with the scatterplot's `zoomToProteins([id])` and calls
`reportNotInView` when that returns false; a pasted list never zooms.

### Query Builder

| Property      | Type                         | Description                                                                                                                                                                           |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `annotations` | `string[]`                   | Columns a condition can test                                                                                                                                                          |
| `data`        | `ProtspaceData \| undefined` | Dataset the match count is computed on                                                                                                                                                |
| `query`       | `FilterQuery`                | Conditions and groups being edited                                                                                                                                                    |
| `dirty`       | `boolean \| null`            | Optional, set by a host that keeps a draft: the query differs from the filter last applied. `false` disables Cancel and Apply ("No changes to apply"); unset (`null`), they ignore it |
| `embedded`    | `boolean`                    | Inside a host panel or dialog that brings its own heading (the app's Filter panel): no title or close button, and Escape is left to the host; `embedded`                              |

| Event           | Detail               | Description                                          |
| --------------- | -------------------- | ---------------------------------------------------- |
| `query-changed` | `{ query }`          | The query was edited: set `query` and `dirty` back   |
| `query-apply`   | `{ matchedIndices }` | Apply: a `Set` of indices into `data.protein_ids`    |
| `query-reset`   | none                 | Reset                                                |
| `query-cancel`  | none                 | Cancel: return `query` to the filter last applied    |
| `query-close`   | none                 | The close button or Escape; only when not `embedded` |

`closePopups()` closes any open annotation or value picker; call it when the host hides the builder.

The footer shows the live count ("12 of 573,230 proteins match") and, while Apply is disabled, why:
a condition without an annotation, value or number (numbered as the rows are), no condition at all,
a query that keeps no protein or every protein, or no change since the last Apply.

::: warning BREAKING
Cancel now dispatches `query-cancel`, not `query-close`. The buttons read Reset, Cancel and Apply.
:::

Apply a match through the scatterplot's `filteredProteinIds` and `filtersActive`. The query
helpers `createCondition`, `evaluateQuery`, `hasConfiguredCondition`, `sameQuery`,
`findConditionsForAnnotation`, `replaceConditionsForAnnotation`, `conditionsForReliability`,
`reliabilityFromConditions` and `sameConditions` and the `FilterQuery` type are exported too.

### Import Menu

The Import button and any control the host passes to `openFrom` or `toggleFrom` open the same
panel, a dialog named "Import": "Open a file…" with the formats it accepts and where each goes,
the last imported file, and the example catalog.

| Property           | Type                                          | Description                                                                                          |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `exampleDatasets`  | `readonly ExampleDatasetSummary[]`            | Example catalog, listed in the "Examples" section; JavaScript-only                                   |
| `examplesDocsUrl`  | `string`                                      | Page linked as "About these examples"; `examples-docs-url`                                           |
| `currentExampleId` | `string \| null`                              | Example on screen, `null` for a user import; its item is disabled with a check; `current-example-id` |
| `lastFile`         | `{ name: string; sizeLabel: string } \| null` | The stored import, offered as "Last file"; `null` hides the row; JavaScript-only                     |

::: warning BREAKING
`currentDatasetName` (`current-dataset-name`) and the panel's "Current dataset" block are removed.
Name the dataset in your own control and open this panel from it with `toggleFrom`, as the app
bar's dataset name does.
:::

`ExampleDatasetSummary` is exported from `@protspace/core`:

| Field         | Type      | Shown as                                                    |
| ------------- | --------- | ----------------------------------------------------------- |
| `id`          | `string`  | The `load-example-dataset` event's `detail.id`              |
| `label`       | `string`  | The item's text                                             |
| `description` | `string`  | The first paragraph of the item's info popover              |
| `insight?`    | `string`  | The popover's second paragraph: what the curated view shows |
| `docsUrl?`    | `string`  | The popover's "Learn more" link                             |
| `large?`      | `boolean` | A "Large" badge on the item                                 |

Methods: `openFrom(anchor: HTMLElement)` opens the panel under `anchor` and sets
`aria-haspopup="dialog"` and `aria-expanded` on it; focus returns to it when the panel closes.
`toggleFrom(anchor)` closes the panel when it is open from that anchor and opens it there
otherwise.

CSS part: `trigger`, the Import button. A host that opens the panel only from its own control hides
it with `::part(trigger) { display: none }` and keeps the element rendered (a `display: none`
element takes its panel with it), as the app's phone layout does.

| Event                  | Detail           | Description                   |
| ---------------------- | ---------------- | ----------------------------- |
| `load-example-dataset` | `{ id: string }` | An example dataset was chosen |
| `open-file-dialog`     | `{}`             | "Open a file…" was chosen     |
| `open-last-file`       | `{}`             | "Last file" was chosen        |

Each fires inside the user's click, after the panel has closed: call the data loader's
`openFilePicker()` from the `open-file-dialog` listener and the browser lets the file chooser open.

### Export Menu

A menu named "Export": **Figure editor…**, **Quick PNG**, **Quick PDF**, **Protein IDs (.txt)** and
**Data bundle (.parquetbundle)**, then an **Include legend settings** checkbox (checked by default;
toggling it keeps the menu open) and the note "Quick exports leave out contours."

| Property          | Type      | Description                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------- |
| `hasFileSettings` | `boolean` | The loaded file carries settings a Parquet export can keep; `has-file-settings` |

Methods: `reset()` checks **Include legend settings** again, as for a new dataset.
`openFrom(anchor: HTMLElement)` opens the menu under `anchor` with focus on its first item, as the
Export button does; when it closes, focus returns to `anchor` and the menu belongs to the Export
button again. CSS part: `trigger`, the Export button; hide it with `::part(trigger)` and open the
menu from your own control, as the app's phone layout does from More.

| Event                 | Detail              | Description                 |
| --------------------- | ------------------- | --------------------------- |
| `export`              | `ExportEventDetail` | A quick export was chosen   |
| `open-publish-editor` | `{}`                | "Figure editor…" was chosen |

`ExportEventDetail` is `{ type: 'png' | 'pdf' | 'ids' | 'parquet', imageWidth, imageHeight,
legendWidthPercent, legendFontSizePx, includeLegend, includeLegendSettings }`; `EXPORT_DEFAULTS`
holds the default sizes. The quick exports always send `EXPORT_DEFAULTS`' sizes; `includeLegendSettings` is the checkbox.

### Figure Editor

`<protspace-publish-modal>`, loaded on demand from `@protspace/core/publish`, is the figure editor.
It opens as a full-screen modal dialog named "Figure editor" as soon as it is connected, so the host
appends it to open it and removes it on `close`. Escape first deselects a selected overlay or inset,
then closes the dialog; a press on the backdrop never closes it. Close, the dialog's ✕ and Escape keep
the editor's state. New figure and Reset offer Undo in the footer until the next edit.

| Property            | Type                                                     | Description                                                          |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `plotElement`       | `HTMLElement \| null`                                    | The plot it renders from                                             |
| `legendElement`     | `HTMLElement \| null`                                    | The legend it reads; its annotation's display name titles the legend |
| `savedPublishState` | `Record<string, unknown> \| null`                        | A stored state to start from                                         |
| `currentProjection` | `{ projection: string; dimensionality: number } \| null` | Set before connecting; warns when overlays were placed on another    |

Method: `showExportError(message)` shows why an export failed inside the dialog (a toast would sit
under it); the next export attempt clears it.

| Event            | Detail              | Description                                  |
| ---------------- | ------------------- | -------------------------------------------- |
| `publish-export` | `{ canvas, state }` | Export pressed; the host writes the file     |
| `close`          | `{ state }`         | Closed by Close, ✕ or Escape; save the state |

### Plot Tools

The plot's tool strip.

| Property            | Type                              | Description                                 |
| ------------------- | --------------------------------- | ------------------------------------------- |
| `tool`              | `'pan' \| 'rectangle' \| 'lasso'` | Pressed tool (`PlotTool`)                   |
| `selectionDisabled` | `boolean`                         | Box and Lasso are off; `selection-disabled` |

| Event              | Detail     | Description             |
| ------------------ | ---------- | ----------------------- |
| `plot-tool-change` | `{ tool }` | A tool was chosen       |
| `fit-view`         | `{}`       | Fit to view was pressed |

`focusTool()` focuses the strip's one Tab stop (the current tool). On the scatterplot, `pan` is
`selectionMode = false`; `rectangle` and `lasso` are `selectionMode = true` with that
`selectionTool`. `fit-view` maps to `resetZoom()`.

**BREAKING:** `selectedCount` (`selected-count`), Clear and Isolate, and their `clear-selections`
and `isolate-data` events moved to the selection bar; `isolated`, Reset and `reset-isolation`
moved to the status corner (the isolation chip's ✕).

### Selection Bar

`<protspace-selection-bar>` shows at the bottom-centre of its positioned parent while proteins are
selected: the count, then Show only these, Zoom to them, Copy IDs and Clear, in a toolbar named
"Selection" with one Tab stop (the arrow keys move between the buttons). It hides itself at 0 and
reports presses; the host acts and sets `selectedCount`.

At 640 px wide and below it fits a phone's plot: each action shows as a 40 px icon button
(Show only these, Zoom to them, Copy IDs, Clear keep their names), the count reads "12 selected"
(the live region still says "12 proteins selected"), and the bar stays 12 px inside its parent's
edges.

| Property        | Type                                               | Description                                                                           |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `selectedCount` | `number`                                           | How many proteins are selected; `selected-count`                                      |
| `canIsolate`    | `boolean`                                          | Show only these is enabled (default `true`); `can-isolate`                            |
| `returnFocus`   | `((action: 'clear' \| 'isolate') => void) \| null` | Called when Clear or Show only these hid the bar while it held focus; JavaScript only |

| Event               | Detail | Description                 |
| ------------------- | ------ | --------------------------- |
| `isolate-data`      | `{}`   | Show only these was pressed |
| `zoom-to-selection` | `{}`   | Zoom to them was pressed    |
| `copy-selection`    | `{}`   | Copy IDs was pressed        |
| `clear-selections`  | `{}`   | Clear was pressed           |

### Plot Status

`<protspace-plot-status>` sits in the bottom-left corner of its positioned parent: the visible
protein count ("7,831 proteins · Zoomed in", a polite status) and a chip for each way the view is
narrowed, in this order: "Filtered · 2 conditions", "Showing only 1,204 proteins · 2 steps" and
"4 categories hidden". Each chip has an ✕ ("Remove filter", "Show all proteins", "Show hidden
categories"); the filter and hidden chips' text opens the place to change them. It reports
presses; the host acts and sets the properties (all JavaScript only).

| Property           | Type                                      | Description                     |
| ------------------ | ----------------------------------------- | ------------------------------- |
| `count`            | `number \| null`                          | Visible proteins; null hides it |
| `zoomedIn`         | `boolean`                                 | Appends " · Zoomed in"          |
| `filterConditions` | `number`                                  | The filter chip shows above 0   |
| `isolation`        | `{ steps: number; size: number } \| null` | The isolation chip              |
| `hiddenCategories` | `number`                                  | The hidden chip shows above 0   |

| Event          | Detail                                          | Description           |
| -------------- | ----------------------------------------------- | --------------------- |
| `status-open`  | `{ kind: 'filter' \| 'hidden' }`                | A chip's text pressed |
| `status-clear` | `{ kind: 'filter' \| 'isolation' \| 'hidden' }` | A chip's ✕ pressed    |

`focusChip(kind)` focuses a chip's first control and returns false when that chip does not show.
When an ✕ removes its chip while focused, focus moves to the next chip, else to the count. Feed it
from the scatterplot's `view-status-change`, `hidden-values-change`, `data-isolation` and
`data-isolation-reset`, and give the plot `hide-status` so the count is not drawn twice.

### Example

```html
<protspace-projection-select></protspace-projection-select>
<protspace-annotation-select></protspace-annotation-select>
<protspace-scatterplot id="plot"></protspace-scatterplot>
```

```javascript
const plot = document.getElementById('plot');
const projection = document.querySelector('protspace-projection-select');
const colorBy = document.querySelector('protspace-annotation-select');

plot.addEventListener('data-change', (e) => {
  const data = e.detail.data;
  projection.projections = data.projections.map((p) => p.name);
  colorBy.annotations = Object.keys(data.annotations);
  // Labels for runtime columns, and the EAT and STATS badges.
  colorBy.annotationDefinitions = data.annotations;
  colorBy.statisticsRows = data.statisticsRows ?? [];
  colorBy.selectedProjection = data.projections[0]?.name ?? '';
});
projection.addEventListener('projection-change', (e) => {
  plot.selectedProjectionIndex = plot.data.projections.findIndex(
    (p) => p.name === e.detail.projection,
  );
  colorBy.selectedProjection = e.detail.projection;
});
colorBy.addEventListener('annotation-change', (e) => {
  plot.selectedAnnotation = e.detail.annotation;
});
```

## Structure Viewer

3D protein structure display using Mol\*.

### Properties

| Property          | Type                | Default               | Description                                                                                  |
| ----------------- | ------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `proteinId`       | `string \| null`    | `null`                | Structure to display                                                                         |
| `title`           | `string`            | `'Protein Structure'` | Panel title                                                                                  |
| `height`          | `string`            | `'400px'`             | Viewer height                                                                                |
| `showHeader`      | `boolean`           | `true`                | Show the panel header                                                                        |
| `showCloseButton` | `boolean`           | `true`                | Show the close button                                                                        |
| `showTips`        | `boolean`           | `true`                | Show interaction tips                                                                        |
| `proteinChoices`  | `readonly string[]` | `[]`                  | Selected proteins the header offers; with more than one, the id opens a menu of the first 50 |

### HTML attributes

`scatterplot-selector`, `auto-sync`, `auto-show`.

### Events

| Event                      | Detail                                                   | Description                                                               |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `structure-load`           | `{ proteinId, status, data? }`                           | Lifecycle event for loading or loaded                                     |
| `structure-error`          | `{ message, severity, source, context, originalError? }` | Host-consumed error event                                                 |
| `structure-close`          | `{ proteinId }`                                          | Viewer closed                                                             |
| `structure-protein-change` | `{ proteinId }`                                          | The user picked another selected protein (`StructureProteinChangeDetail`) |

### Slots and parts

| Name                    | Description                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `header-actions` (slot) | Buttons placed in the header, before the close button                                                          |
| `header` (part)         | The header row: title, protein id (a picker with several choices) and the buttons                              |
| `links` (part)          | The resource links (AlphaFold, UniProt, InterPro, TED) in their own wrapping row under the header              |
| `body` (part)           | Everything under the links: the 3D view, the colour toolbar and the tips. It adds no box (`display: contents`) |

With `auto-sync`, the viewer prefetches Mol\* (about 1.3 MB) once, on the plot's first hovered
point or its first touch `pointerdown`, whichever comes first.

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
| `columnMappings`      | `object`  | `{}`    | Override protein-id / coordinate column names        |
| `loadFromFileHandler` | function  | -       | Host hook that can intercept or replace file loading |

The file input accepts `.parquetbundle`, `.fasta`, `.fa` and `.fna`. FASTA files are only usable if
the host installs a `loadFromFileHandler` that prepares them, see
[Importing Data](/explore/importing-data).

### HTML attributes

`src`, `auto-load`, `column-mappings`. `loadFromFileHandler` is JavaScript-only. `allow-drop` (`allowDrop`) is removed — **BREAKING**: it never did anything; drops are the host page's.

### Methods

| Method             | Returns | Description                                                                |
| ------------------ | ------- | -------------------------------------------------------------------------- |
| `openFilePicker()` | `void`  | Opens the file chooser; call it inside a user gesture (`open-file-dialog`) |

### Events

| Event                   | Detail                                                                           | Description                 |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `data-loading-start`    | none                                                                             | Load started                |
| `data-loading-progress` | `{ current, total, percentage }`                                                 | Incremental progress update |
| `data-loaded`           | `{ data, settings, source, file?, bundleFormatVersion?, unplacedProteinCount? }` | Dataset loaded successfully |
| `data-error`            | `{ message, severity, source, context, originalError? }`                         | Host-consumed error event   |

For a `.parquetbundle`, `bundleFormatVersion` is the format version it was read as: `3` for a
columnar bundle (part 1 declares `protspace_container_version`), or `1`/`2` for a legacy bundle
(its `protspace_format_version` cell grammar), whose support ends in protspace 5.0.0.
`unplacedProteinCount` is the number of proteins the bundle holds that no projection places;
`data` leaves them out, so an export of it does too. Both are absent for plain parquet.

## Data Loading Utilities

Exported from `@protspace/core` unless noted.

### readFileOptimized

Read a file into an `ArrayBuffer` (`File.arrayBuffer()`, which reads off the main thread).

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
optional settings and the format version it was read as (`3`, or `1`/`2` for a legacy bundle,
whose support ends in protspace 5.0.0). A six-part file without `protspace_container_version`
in part 1, or with a container version other than `3`, is rejected rather than guessed at.
`unplacedProteinCount` counts the proteins the file holds without a coordinate in any projection,
which `data` leaves out (0 when every protein is placed).

```typescript
function decodeParquetBundle(arrayBuffer: ArrayBuffer): Promise<DecodedParquetBundle>;

interface DecodedParquetBundle {
  data: VisualizationData;
  settings: BundleSettings | null;
  formatVersion: number;
  unplacedProteinCount: number;
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
import { DENSITY_MODE_LABELS } from '@protspace/core';

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
