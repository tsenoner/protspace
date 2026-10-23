# Architecture

## Messaging Model

ProtSpace uses a layered messaging model instead of a single catch-all UI primitive.

- Host-owned transient notifications: The host application decides how to surface recoverable warnings and errors. In the demo app, `apps/web/src/lib/notify.ts` is the only transient notification transport and it is backed by Sonner. On `/explore` every toast goes to the workbench's own toaster (`apps/web/src/workbench/WorkbenchToaster.tsx`), centred at the plot's bottom edge with a close button and up to two actions; `notify.undoable` offers Undo for a step the undo history can take back, and an irreversible action asks first (`apps/web/src/explore/confirm-dialog.ts`).
- Blocking and progress UI: Long-running operations use dedicated progress UI instead of toasts. The `/explore` app uses a full-screen loading overlay for dataset imports.
- Component-owned workflow UI: Components keep their own popovers and focused workflow controls. The legend settings and "Other" popovers stay inside the legend component.
- Component-owned inline states: Components keep inline empty/loading/error states when the message belongs to the component surface itself. The structure viewer keeps its own empty, loading, and error UI.
- Accessibility-only announcements: Components may expose `aria-live` status updates for assistive technologies without mirroring them as global toasts.
- Host-consumed semantic events: Components emit normalized warning and error events such as `data-error`, `legend-error`, and `structure-error`. Hosts decide whether to surface those as toasts, inline UI, or silent recovery.

The shared event contract uses these minimum fields:

- `message`
- `severity`
- `source`
- optional `context`
- optional `originalError`

See [Messaging Conventions](./messaging.md) for the full ownership model and host integration guidance.

## Scatter plot rendering

The scatter plot draws its points with WebGL2. [Render pipeline](./render-pipeline.md) describes how
a frame is drawn: staging, the per-category style table, the selection marks, the projection glide,
the render loop and the device limits. It also lists the checks that keep the pipeline fast.

## Plot status

The plot's bottom-left corner is `protspace-plot-status`: the visible protein count and a chip
for each way the view is narrowed (filtered, isolated, categories hidden). In the app,
`apps/web/src/explore/status-controller.ts` feeds it from the scatterplot's `view-status-change`,
`hidden-values-change`, `data-isolation` and `data-isolation-reset` events and from the status
store's `appliedFilterConditions`, and runs its chip actions: open the filter or the legend,
remove the filter (`FilterController.clear()`), leave isolation
(`SelectionController.resetIsolation()`) or show every category (`legend.showAllCategories()`).
Neither the scatterplot nor the React shell re-renders for it.

## Undo

⌘Z / Ctrl+Z undoes and ⇧⌘Z / Ctrl+Shift+Z redoes (design decision 13) selection changes, Show only
these steps and leaving isolation, and filter Apply, Reset and the filter chip's ✕. The history
(`apps/web/src/explore/undo-history.ts`) is linear and holds each step's protein-id arrays by
reference, never copies; it keeps at most 100 steps and 2,000,000 ids, dropping the oldest. The
interaction controller owns it (`interactionController.history`). The selection controller records
and applies selection and isolation steps (`applyHistory`); the filter controller reports applied
filters (`onFilterCommitted`) and restores a snapshot's id set without evaluating the query again
(`restore`). `undo-controller.ts` owns only the keys: a press in a text field (an `INPUT`,
`TEXTAREA`, `SELECT` or contentEditable anywhere in the composed path), in an open modal or with Alt
is left alone. A new dataset clears the history. The EAT panel's reliability range, legend hiding and zoom
are not recorded.

## Legend Component

The legend is one element, `protspace-legend`, with one shadow root: its rows must be direct
children of one list for drag-and-drop, and the e2e, perf and tour code reach rows through
`legend.shadowRoot`. The element holds the state and the wiring; the rest lives beside it in
`packages/core/src/components/legend/`:

| Module                                   | Holds                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legend.ts`                              | Properties, state, controller wiring, lifecycle, render and public API                                                                                                                                                                                                                                            |
| `controllers/data-controller.ts`         | `LegendDataController`: the data pipeline (data and annotation changes, counts, the item pass and its rebuild, stored settings, shape size, numeric order). Takes the element as its host                                                                                                                         |
| `controllers/item-actions-controller.ts` | `ItemActionsController`: row clicks and double-clicks (touch taps included), extract from and merge into Other, the drop highlight, the sort mode and the order direction. Takes the element as its host                                                                                                          |
| `controllers/reorder-controller.ts`      | `ReorderController`: the keyboard reorder's snapshot, move, restore and clear, and what a drag commits. Takes the element as its host                                                                                                                                                                             |
| `controllers/settings-controller.ts`     | `SettingsController`: the settings popover (open, close, render), each edit applied live (`apply`), Reset, and the colour and shape commits from the picker. Takes the element as its host                                                                                                                        |
| `legend-header.ts`                       | The header template, the sort button's label and icon, and the sort menu                                                                                                                                                                                                                                          |
| `legend-row.ts`                          | The legend symbol and the row template                                                                                                                                                                                                                                                                            |
| `legend-row-menu.ts`                     | `LegendRowMenu`: the one "⋯" menu every row shares                                                                                                                                                                                                                                                                |
| `legend-other-popover.ts`                | `protspace-legend-other-popover`, the searchable list of the categories under Other                                                                                                                                                                                                                               |
| `legend-settings-popover.ts`             | `protspace-legend-settings-popover`, the settings popover, with its palette swatches in `palette-swatches.ts`. Each edit is a `settings-change` the legend applies at once (`SettingsController.apply`) and stores under the same `protspace:legend:{datasetHash}:{annotation}` key; Reset is a `settings-reset`. |
| `legend-other-control.ts`                | `OtherPopoverControl`: the legend's side of the Other popover (its anchor, opening and closing, focus when Other empties)                                                                                                                                                                                         |
| `legend-list.ts`                         | The list template, `LegendKeyboardController` (row keys, the list's one Tab stop, keyboard reorder as a layer) and `TruncatedNameTooltip`                                                                                                                                                                         |
| `legend-score-strips.ts`                 | Score-strip points and the strips section                                                                                                                                                                                                                                                                         |
| `eat-population-counts.ts`               | `countEatPredictions`: the count behind the one-line EAT note under the title                                                                                                                                                                                                                                     |
| `legend-color-picker.ts`                 | `ColorPickerController`: the colour and shape picker, a `ps-popover` on the layer stack                                                                                                                                                                                                                           |
| `legend-items-state.ts`                  | Pure functions: sort, palette and numeric helpers, and the reading of a stored record                                                                                                                                                                                                                             |

Templates take explicit view models and handlers. Two kinds of controller hold the logic:

- Lit reactive controllers keep their own transient state and timers and reach the element through
  callbacks: those beside the templates (`LegendKeyboardController`, `ColorPickerController`, …) and `PersistenceController`, `DragController` and
  `ScatterplotSyncController` in `controllers/`.
- Plain classes in `controllers/` (`LegendDataController`, `ItemActionsController`,
  `ReorderController`) hold the legend's own logic and read and write the element's state
  directly (below).

The pure functions in `legend-items-state.ts` return new values rather than changing their input.
Whoever calls them, `legend.ts` or one of the plain controllers, assigns the result and syncs the
plot.

### Controllers

**PersistenceController**

- Manages localStorage operations for legend settings
- Scopes settings by dataset hash and annotation name
- Dataset hash is computed from sorted protein IDs using djb2 algorithm

**DragController**

- Handles drag-and-drop reordering
- Supports merging items into "Other" group
- Automatically switches to manual sort mode on reorder

**ScatterplotSyncController**

- Observes scatterplot data and annotation changes
- Dispatches z-order and color mapping events
- Maintains component synchronization

### Data Processing

**LegendDataProcessor**

- Converts annotation values into legend items
- Applies persisted colors and shapes when available
- Handles category grouping and "Other" bucket
- Supports multiple sorting modes

### Storage Layer

Located in `@protspace/utils/storage`:

- Generic localStorage wrapper with type safety
- Key format: `protspace:{component}:{datasetHash}:{context}`
- Graceful error handling for quota exceeded scenarios
- `generateDatasetHash` (FNV-1a 64) identifies a dataset by its protein ids, annotations, numeric
  values and EAT predictions

### Reactive Controllers Pattern

The callback-based controllers implement Lit's `ReactiveController` interface:

```typescript
interface ReactiveController {
  hostConnected(): void;
  hostDisconnected(): void;
}
```

`PersistenceController`, `DragController`, `ScatterplotSyncController` and the controllers beside
the templates talk to the element through callback interfaces, enabling:

- Testability (controllers can be tested in isolation)
- Reusability (controllers can be used by other components)
- Maintainability (concerns are clearly separated)

The controllers that hold the legend's own logic, moved out of `legend.ts` (the table's rows that
take the element as host), are plain classes instead. Each is built with the element
(`constructor(private readonly host: ProtspaceLegend)`, a type-only import) and reads and writes the
members `legend.ts` lists under "Read and written by the legend's controllers": a callbacks object
would repeat each of those members as a getter and a setter. They reach each other only through the
element's fields (`host._data`, `host._reorder`, `host._settings`, …), never by import, and every
item pass goes through `ProtspaceLegend._updateLegendItems()`, the one call
`perfCounters.legendUpdate` counts.

## Workbench layout modes

The explore workbench has four layouts (design decision 17): `desktop` from 951 px wide, `tablet`
from 641 to 950 px, `phone` up to 640 px, and `landscape` for a phone on its side (landscape, at
most 500 px tall and 950 px wide), which wins over the others. `apps/web/src/explore/layout-mode.ts`
resolves the mode from three `matchMedia` queries (`LAYOUT_QUERIES` in `layout-defaults.ts`) and
is its one source: the shell's `useLayoutMode()` writes it to `data-layout` on the workbench,
which every layout rule in `workbench.css` keys on, and the runtime's controllers (when the
structure loads, when the Filter panel counts) read the same value. Touch affordances key on
`(pointer: coarse)`, not on the mode.

## Theme

The explore page's theme (design decision 16) is System, Light or Dark, kept under
`protspace:theme` by its own store, `apps/web/src/explore/theme-state.ts` (its key, choices and
default in the leaf `theme-defaults.ts`), beside the layout store. The choice goes as is onto
`data-theme` on `<html>`, and only while `/explore` is mounted: `Explore.tsx` applies it in a
layout effect and removes it on unmount, so the landing and privacy pages keep their look.
`data-theme="system"` stays `system`; the token sheet's media query follows the OS. On a cold load
of `/explore`, a classic script in `index.html`, after the GitHub Pages redirect, sets the
attribute from storage before first paint, and an unlayered `<style>` paints the dark surface
until the lazy chunk adopts the tokens; `theme-boot.test.ts` pins the script's key, choices and
default and the style's colour to `theme-defaults.ts` and `theme.ts`.

## Tour

The product tour (`apps/web/src/tour/`) is data first. `tour-steps.ts` lists the steps of the full
tour and of the shorter What's new tour for a layout mode, a coarse or fine pointer and a Mac or
other keyboard, with no driver.js import, so every list is unit-tested. `product-tour.ts` builds
the list for the window when a tour starts, drops a step whose target is not on screen, and drives
the rest with driver.js. While it runs it holds a layer from `pushLayer`, so Escape closes the tour
and nothing else, and a change of layout mode ends it. `localStorage` keeps the kind shown under
`protspace:tour:v2` (`TOUR_STORAGE_KEY` in the leaf `storage-key.ts`); `chooseTour` gives a first
visit the full tour and a visitor holding the pre-workbench key `driver.overviewTour` What's new
once. That old key is read and never written or removed, so a rollback does not replay the old
tour. The runtime and the Help menu import `product-tour.ts` lazily, which keeps driver.js out of
the explore chunk. Tests, the perf harness and the docs captures seed the key through
`apps/web/tests/helpers/tour-storage-state.ts`, never as a literal.

## EAT panel

`protspace-eat-panel` (`packages/core/src/components/eat-panel/`) holds every EAT control. It owns
the reliability state (`EatReliabilityController` in `eat-reliability-controller.ts`) and reports
it in events; it never writes to the plot or the filter. `eat-summary.ts` builds the per-annotation
index and the counts, chart bins and label rows; `eat-panel-histogram.ts`,
`eat-panel-breakdown.ts` and `eat-panel-card.ts` hold the reliability section, the label rows and
the Selected protein strip. The app's `apps/web/src/explore/eat-panel-controller.ts` feeds it and
applies its events: in Hide, a filter condition through the filter controller; in Fade, the plot's
`eatDim`; and the legend's `eatReliability` and `eatFade` for its one-line note. The shell's
`apps/web/src/workbench/EatPanel.tsx` draws the header (`EAT · <annotation>`, info, Reset, close).

## Filter panel

The app's filter controller (`apps/web/src/explore/filter-controller.ts`) keeps two queries: the
applied filter, written to the scatterplot's `filteredProteinIds` and `filtersActive`, and the
draft the Filter panel's query builder edits. Apply makes the draft the applied filter and keeps
the panel open; Cancel returns the draft to it; Reset and the status chip's ✕ remove it. The
builder gets data and recounts only while the panel is on screen (`panel` in the layout store;
the filter itself is never stored). The EAT panel's reliability range, in Hide, writes the
applied filter at once and changes only its own column's condition in a dirty draft; the Filter
panel shows that condition as a locked row. Each Apply, Reset and
removal is reported as a `FilterCommit` holding the applied query and its matched ids by
reference, which the undo history records.
