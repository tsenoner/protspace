## Why

The explore page works and, after PR #526, is fast at 573K proteins, but it does not look or feel
like a mature tool. Its toolbar wraps into two or three rows on common laptop screens, the legend is
fixed at a quarter of the width with rows so tall that long names break mid-word, and the page
mixes about 35 button styles, 18 font sizes, four blues and three unrelated styles of feedback.
Everyday tasks hide their state: search drops IDs it cannot match without saying so, nothing on the
plot says the view is filtered, and Escape clears a selection with no way back.

This change redesigns the page as a workbench with one visual language, a collapsible sidebar, a
dark theme, and a phone layout that absorbs the unmerged `feat/mobile-responsive` branch. It also
splits the largest elements and replaces copied code with one set of shared parts.

## What Changes

- **Workbench layout.** An app bar (dataset, search, Import, Export, theme, help, Feedback), a view
  bar (Projection, Color by, Contours, Filter) that never wraps, tools and status on the plot, and a
  right sidebar with the legend above the structure viewer, a draggable divider, an icon rail that
  stays when the sidebar is collapsed, a resizable width, and a structure viewer that can float over
  the plot. Layout state is remembered in the browser and never put in shared links. The site's
  marketing navigation leaves the explore page.
- **Foundation.** One token file (`--ps-*` CSS variables on the document root) read by every
  component and by the React shell; Inter, self-hosted; a fixed type scale replacing the
  viewport-scaled root font size; a kit of shared controls (`ps-button`, `ps-menu`, `ps-popover`,
  `ps-dialog`, `ps-tooltip` and others) built on the browser's `popover` attribute and `<dialog>`;
  Lucide icons only; one focus ring; one order for Escape.
- **Plot proportions.** The plot uses one scale for both axes, live and in exports, so clusters keep
  their shape on every screen. A layout change redraws the plot once and keeps the viewed centre.
- **Legend.** 28 px rows with truncated names, hover actions (hide, reorder, "Show only this",
  colour and shape), the display name in the header, a visible sort order, a searchable "Other"
  popover instead of the extract dialog, and settings that apply as they change.
- **Workflows.** A selection bar on the plot, status chips for filtered or isolated views, undo and
  redo, Filter as a sidebar panel with a draft that only applies on Apply, search that reports
  found and missing IDs, one notification style with close buttons, an honest loading screen, a
  drop target, an empty state, one Export menu, and a figure editor that behaves like a dialog.
- **Dark mode.** System, Light and Dark, applied before first paint; exports stay light.
- **Phones and tablets.** The mobile branch's layouts and tests, rebuilt on the workbench.
- **Docs.** The docs image pipeline is restructured and every screenshot and GIF regenerated, with
  dark variants of the main screenshots.
- **BREAKING** (for embedders only): `protspace-control-bar` is replaced by separate elements.
  `@protspace/core` is not published; the developer docs change in the same PR.

### Non-goals

The landing page, the VitePress docs theme, the bundle format, the Python CLI, the Colab notebooks,
new analysis features, a native app or PWA, and translations.

## Capabilities

The implementation plan is written from `design.md`. The spec files below are written at the end of
the PR, from the final code, as the step before the archive commit, so `openspec/specs/` matches the
shipped behaviour (AGENTS.md: archive before the merge). Until then this list records which
capabilities the change adds and which existing specs it will update.

### New Capabilities

- `explore-workbench-layout`: the app bar, the view bar that never wraps, tools and status on the
  plot, the sidebar with its icon rail, divider, resizing and persistence, the docked or floating
  structure viewer, the shared Import/dataset menu, the drop target and the empty state.
- `explore-theming`: the `--ps-*` token file and its rules, the type scale and font, the light, dark
  and system themes, first-paint theme application, what follows the theme (plot, structure viewer,
  overlays) and what does not (exports).
- `explore-ui-kit`: the shared controls and their behaviour: top-layer popovers and dialogs that
  nothing clips, one Escape order, outside-click closing, accessible names and tooltips for
  icon-only buttons, one focus ring, reduced motion, Lucide icons, plural-aware counts.
- `plot-proportions`: one scale for both axes in the live plot and in exports, one redraw per layout
  change, and the viewed centre kept across resizes.
- `legend-panel`: the legend's rows, hover actions, hidden state, header, sort indicator, "Other"
  popover, live settings and their persistence.
- `selection-workflow`: the selection bar, status chips, undo and redo, the Undo or confirmation on
  destructive actions, and choosing which selected protein the structure viewer shows.
- `explore-import-export`: the Import menu and dataset switcher, the Export menu and its
  confirmations, and the figure editor's dialog behaviour.
- `explore-help`: the help menu, the complete keyboard shortcut list, the full tour for new visitors
  and the "What's new" tour for returning ones, and info buttons for Contours, Filter and Export.
- `explore-mobile-layout`: tablet, phone and landscape-phone layouts, the More sheet, the bottom
  panel, the structure sheet, touch affordances, and dialogs that fit a phone (ported from the
  unmerged mobile branch, without its "desktop unchanged" requirement).
- `docs-media-generation`: the scripted docs image pipeline: shared page helpers with the e2e tests,
  role-based locators, signal-based waits, one entry per image, light and dark variants, GIF size
  budgets, and the example thumbnails.

### Modified Capabilities

- `query-builder-filtering`: the query builder moves from a control-bar modal to the sidebar's
  Filter panel; edits are a draft until Apply, Cancel discards, a disabled Apply says why, the
  active filter shows as a chip, Reset offers Undo, and `filterActive` gets a new owner.
- `query-builder-controls`: controls take the kit's tokens and focus ring; Escape inside a picker
  follows the one Escape order instead of protecting a surrounding modal; the shared-stylesheet
  requirement refers to the kit instead of the control bar.
- `protein-search-feedback`: unknown IDs get a specific message; pasted lists report found and
  missing IDs; a single hit zooms to the protein.
- `annotation-presentation`: the annotation picker groups by source and marks predicted annotations
  with an icon (matching the code, which no longer has a "Predicted" group); display names are used
  at every text site; the legend's predicted marker uses the icon set.
- `category-focus`: the Shift + Hover entry moves from the plot's Tips popover to the help menu's
  keyboard shortcut list.
- `density-contours`: the Contours control is a view-bar element (the More sheet on phones) instead
  of a control-bar menu.
- `scatterplot-point-size`: the shape size is set in the legend's settings popover, which applies
  changes live and resets with Reset instead of Save.
- `eat-annotation-overlay`: transferred markers in exports use the export surface colour; the
  reliability slider and the filter draft follow the draft rules; the threshold wording matches the
  below / above / band semantics already specified elsewhere.
- `eat-reliability-filter`: the reliability control writes the applied filter and mirrors into an
  open draft.
- `eat-provenance-connectors`: connectors take their place in the one Escape order.
- `example-datasets`: examples are chosen from the Import menu in the app bar (and the More sheet on
  phones) and from the dataset switcher; wording that names the control bar changes.
- `support-contact`: Feedback moves to the app bar and the More sheet; every notification has a close
  button.
- `prep-failure-routing`: notification actions can be callbacks, up to two per notification, next
  to the close button.
- `e2e-validation`: the documentation thumbnails move to the docs image pipeline; file-drop wiring
  moves from the scatterplot to the workbench shell.
- `webgl-perf-harness`: measured runs pin the sidebar layout and the light theme.
- `perf-checks`: a panel-toggle scenario budgeted at one render and one grid rebuild; the
  pixel-reset check pins the colour scheme.
- `protein-resource-links`: the structure header's link row stays usable in the narrow sidebar, the
  floating card and the folded phone sheet.

## Impact

- **Core (`packages/core`)**: a new `components/kit/` (controls, layer stack); `styles/theme.ts`
  replaces `styles/tokens.ts` and most of `mixins.ts` / `overlay-mixins.ts`; the legend split into
  focused files; `control-bar.ts` replaced by separate elements; the figure editor moved onto
  `ps-dialog` and split; the scatterplot reads its background and neutral colours from tokens,
  resizes once per layout change and keeps the viewed centre; the structure viewer gains docked and
  floating modes and themed backgrounds; the export renderer uses the shared scale function.
- **Utils (`packages/utils`)**: `visualization/data-processor.ts` (one scale for both axes).
- **Web (`apps/web`)**: a React shell for the workbench (app bar, view bar, sidebar, rail, splitter,
  floating card, theme switch, help menu, More sheet), `explore/layout-state.ts`, runtime and
  controller wiring for the split control bar, undo history, notifications, the loading overlay,
  the tour, `index.html` (first-paint theme script) and `index.css` (no viewport-scaled root font).
- **Docs and tooling**: `scripts/docs-screenshots/` restructured; every image under
  `docs/explore/images/` regenerated; the user guide and developer docs updated.
- **Tests**: e2e specs that pin the old layout updated; new specs for the sidebar, themes,
  selection, filter panel, search and Escape; the phone suite ported from the mobile branch;
  accessibility checks; a panel-toggle perf scenario.
- **Dependencies**: `@floating-ui/dom`, `lucide`, `@fontsource-variable/inter`; dev:
  `@axe-core/playwright`.
- **Branches**: built on `perf/improvements` (PR #526); `feat/mobile-responsive` is retired once its
  tests pass on the new layout.
