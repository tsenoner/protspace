# Tasks

Each phase has its own detailed plan in `plans/`, written when the phase starts, from the code the
previous phase left. A phase ends with the app working and every test green.

## 1. Foundation (plan: `plans/phase-1-foundation.md`)

- [x] 1.1 Real-browser test project for core (Vitest browser mode) and Chromium in the CI unit jobs
- [x] 1.2 Theme tokens in `styles/theme.ts`, adopted into the document by core
- [x] 1.3 Web app: Inter self-hosted, fixed root font size, Tailwind bridge to the `--ps-*` tokens
- [x] 1.4 Icon helper on Lucide
- [ ] 1.5 Layer stack: one Escape order and outside-press dismissal
- [ ] 1.6 Kit: positioning helper, `ps-button`, `ps-icon-button`, `ps-tooltip`
- [ ] 1.7 Kit: `ps-popover`
- [ ] 1.8 Kit: `ps-menu`, `ps-menu-item`, `ps-menu-label`
- [ ] 1.9 Kit: `ps-dialog`
- [ ] 1.10 Kit: `ps-input`, `ps-select`, `ps-checkbox`, `ps-switch`, `ps-segmented`
- [ ] 1.11 Style lint test with a shrinking allowlist of legacy style modules; unused tokens trimmed
- [ ] 1.12 Kit gallery page (development builds only) and its e2e smoke test

## 2. Shell and layout (plan: `plans/phase-2-shell.md`)

- [ ] 2.1 Layout store `apps/web/src/explore/layout-state.ts` with localStorage persistence
- [ ] 2.2 Workbench shell in React: app bar, view bar, plot area, sidebar, icon rail; the site header
      leaves `/explore`
- [ ] 2.3 Control bar split into separate elements (projection, annotation, contours, search, export,
      import, plot selection tools); its coordination moves to controllers in `apps/web/src/explore/`
- [ ] 2.4 Sidebar: collapse, rail, edge resize, divider, persistence
- [ ] 2.5 Structure viewer docked and floating, rail dot, "View structure" in the tooltip
- [ ] 2.6 One scale for both axes, shared by the live plot and the export renderer
- [ ] 2.7 One resize per layout change, viewed centre kept; panel-toggle perf scenario and budget;
      perf runs pin layout and theme
- [ ] 2.8 View bar never wraps (shorter labels, then a More menu); help menu with shortcuts and tour
- [ ] 2.9 E2E: layout-pinned specs and shared helpers updated; sidebar and persistence specs added

## 3. Legend (plan: `plans/phase-3-legend.md`)

- [ ] 3.1 `legend.ts` split into legend, list, row, header, Other popover, settings popover and EAT
      controls, behaviour unchanged
- [ ] 3.2 Rows: 28 px, truncation with the full name on hover, hover actions, hidden state
- [ ] 3.3 Header: display name, info, sort button showing the active order, settings
- [ ] 3.4 "Other" popover with search and "Add to legend", replacing the extract dialog
- [ ] 3.5 Settings popover: live apply, Reset, palette swatches, order in the list; persisted settings
      stay compatible
- [ ] 3.6 Legend styles on `--ps-*` tokens, legend modules leave the lint allowlist; e2e updated

## 4. Workflows (plan: `plans/phase-4-workflows.md`)

- [ ] 4.1 The Escape order wired through the app (layers, then EAT connectors, then selection)
- [ ] 4.2 Selection bar and status chips
- [ ] 4.3 Undo and redo for selection, "show only" steps and filter apply or reset
- [ ] 4.4 Filter panel in the sidebar: draft and Apply, live count, disabled reason, chip, EAT slider
      mirroring
- [ ] 4.5 Search feedback: found and missing IDs, unknown ID message, zoom to a single hit
- [ ] 4.6 Notifications: one style, close button, up to two actions; Undo on reset and new figure;
      confirmation before clearing stored data
- [ ] 4.7 Loading overlay restyled with honest copy; empty state; workbench-wide drop target
- [ ] 4.8 Import menu shared with the dataset switcher; Export menu with confirmations
- [ ] 4.9 Figure editor on `ps-dialog` (Escape, Close); `publish-modal.ts` split
- [ ] 4.10 Structure: pick which selected protein to show; link row reachable in every placement
- [ ] 4.11 Text: display names at every site, plural-aware counts, predicted-annotation icon

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
