# Tasks

Each phase has its own detailed plan in `plans/`, written when the phase starts, from the code the
previous phase left. A phase ends with the app working and every test green.

## 1. Foundation (plan: `plans/phase-1-foundation.md`)

- [x] 1.1 Real-browser test project for core (Vitest browser mode) and Chromium in the CI unit jobs
- [x] 1.2 Theme tokens in `styles/theme.ts`, adopted into the document by core
- [x] 1.3 Web app: Inter self-hosted, fixed root font size, Tailwind bridge to the `--ps-*` tokens
- [x] 1.4 Icon helper on Lucide
- [x] 1.5 Layer stack: one Escape order and outside-press dismissal
- [x] 1.6 Kit: positioning helper, `ps-button`, `ps-icon-button`, `ps-tooltip`
- [x] 1.7 Kit: `ps-popover`
- [x] 1.8 Kit: `ps-menu`, `ps-menu-item`, `ps-menu-label`
- [x] 1.9 Kit: `ps-dialog`
- [x] 1.10 Kit: `ps-input`, `ps-select`, `ps-checkbox`, `ps-switch`, `ps-segmented`
- [x] 1.11 Style lint test with a shrinking allowlist of legacy style modules; unused tokens trimmed
- [x] 1.12 Kit gallery page (development builds only) and its e2e smoke test

## 2. Shell and layout (plan: `plans/phase-2-shell.md`)

- [x] 2.1 One scale for both axes, shared by the live plot and the export renderer; the viewed
      centre survives a resize
- [x] 2.2 Workbench shell in React (app bar, view bar, plot area, sidebar) and the layout store
      `apps/web/src/explore/layout-state.ts`; the site header leaves `/explore`
- [x] 2.3 E2E helpers that reach the controls by role and name, whatever the layout
- [x] 2.4 Help menu with keyboard shortcuts and the tour, replacing the plot's tips
- [x] 2.5 Import and Export menus in the app bar
- [x] 2.6 Filter in a dialog with its own controller
- [x] 2.7 Projection and Contours pickers
- [x] 2.8 Pickers in the view bar with their controller; Color by and the projection details move
- [x] 2.9 Plot tools, the selection controller and search in the app bar
- [x] 2.10 Control bar removed; the view bar never wraps (shorter labels, then a More menu)
- [x] 2.11 Structure viewer docked under the legend, with a divider
- [x] 2.12 Sidebar rail, collapse and edge resize, one plot resize per change, persistence;
      panel-toggle perf scenario and budget; perf runs pin layout and theme
- [x] 2.13 Floating structure; "View structure" in the tooltip

## 3. Legend (plan: `plans/phase-3-legend.md`)

- [x] 3.1 Legend behaviour pinned before the split: DOM contract, API, header, keyboard reorder,
      colour picker, Escape order and stored settings
- [x] 3.2 Header, row, list and score-strip templates split out of `legend.ts`
- [x] 3.3 EAT controls split into a controller
- [x] 3.4 Colour picker and keyboard model split into controllers
- [x] 3.5 Item and settings computations moved to pure functions
- [x] 3.6 Rows: 28 px, truncated names, hover actions, hidden state, "⋯" menu
- [x] 3.7 Rows: one Tab stop, the full name on hover; e2e legend helpers
- [x] 3.8 Colour and shape picker on the kit; keyboard reorder on the layer stack
- [x] 3.9 Header: display name, predicted icon, sort button showing the active order, settings
- [x] 3.10 "Other" popover with search and "Add to legend", replacing the extract dialog
- [x] 3.11 Settings popover element: palette swatches, debounced fields, Reset
- [x] 3.12 Settings apply live from the popover; the dialogs and focus trap go; persisted settings
      stay compatible
- [x] 3.13 Legend e2e on the settings popover
- [x] 3.14 EAT controls and score strips on the kit and tokens
- [x] 3.15 Legend styles on `--ps-*` tokens, legend modules leave the lint allowlist

## 4. Workflows (plan: `plans/phase-4-workflows.md`)

- [ ] 4.1 The Escape order wired through the app (layers, then EAT connectors, then selection,
      then the tool)
- [ ] 4.2 Selection bar on the plot: Show only these, Zoom to them, Copy IDs, Clear
- [ ] 4.3 Status corner: protein count and filter, isolation and hidden-category chips
- [ ] 4.4 Query builder in its own folder, with the reason Apply is disabled
- [ ] 4.5 Filter panel in the sidebar: draft and Apply, Cancel, live count, chip, EAT slider
      mirroring
- [ ] 4.6 Undo and redo for selection, "show only" steps and filter apply or reset
- [ ] 4.7 Search feedback: found and missing IDs, unknown ID message, zoom to a single hit
- [ ] 4.8 Notifications: one style, close button, up to two actions; Undo on a removed filter;
      confirmation before deleting stored data
- [ ] 4.9 Info popover on the kit's popover
- [ ] 4.10 Import menu shared with the dataset switcher, remembering the last file
- [ ] 4.11 Export menu with a confirmation for every export
- [ ] 4.12 Loading overlay restyled with honest copy; empty state; workbench-wide drop target
- [ ] 4.13 Figure editor split into section modules
- [ ] 4.14 Figure editor on `ps-dialog` (Escape, Close, Undo for New figure and Reset)
- [ ] 4.15 Structure: pick which selected protein to show; links reachable in every placement
- [ ] 4.16 Text: display names at every site, plural-aware counts, predicted-annotation icon;
      the annotation picker on the kit

## 5. Phones and tablets (plan: `plans/phase-5-mobile.md`)

- [ ] 5.1 The mobile branch's phone tests ported to the workbench (Playwright `mobile` project)
- [ ] 5.2 Tablet layout (641–950 px)
- [ ] 5.3 Phone layout: bars, More sheet, bottom panel with Legend and Filter tabs
- [ ] 5.4 Structure bottom sheet that opens folded; the tooltip rule while it is expanded
- [ ] 5.5 Landscape phone layout
- [ ] 5.6 Touch affordances on coarse pointers; dialogs that fit a phone

## 6. Dark mode (plan: `plans/phase-6-dark-mode.md`)

- [ ] 6.1 Theme switch (System, Light, Dark), its storage key, the first-paint script, `/explore`-only
      scope; default flips to System
- [ ] 6.2 Plot background, neutral point greys, selection ring and contour lines from tokens;
      re-render on theme change; exports forced light
- [ ] 6.3 Mol\* background follows the theme
- [ ] 6.4 Remaining surfaces in dark; palette contrast check; accessibility checks in both themes

## 7. Docs, docs media and tour (plan: `plans/phase-7-docs.md`)

- [ ] 7.1 Page helpers shared by the e2e tests and the docs captures (role-based, signal waits)
- [ ] 7.2 Capture runner: one entry per image, light and dark variants, GIF size budget, example
      thumbnails moved here
- [ ] 7.3 Every docs image regenerated; images named after removed UI deleted; dark variants shown
- [ ] 7.4 Tour rewritten for the workbench; "What's new" tour for returning visitors
- [ ] 7.5 User guide and developer docs (the split elements, theming for embedders)

## 8. Wrap-up (plan: `plans/phase-8-wrap-up.md`)

- [ ] 8.1 `tokens.ts`, replaced mixins and dead CSS deleted; lint allowlist empty; no element file
      over about 800 lines
- [ ] 8.2 Full verification: unit, browser, e2e (desktop and mobile), accessibility, perf at 573K,
      a real-device pass by the user
- [ ] 8.3 Spec files written from the final code (the capabilities in `proposal.md`);
      `openspec validate explore-workbench --strict` passes
- [ ] 8.4 `feat/mobile-responsive` retired after the user agrees; PR description
- [ ] 8.5 OpenSpec archive as the last commit
