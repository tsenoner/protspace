# Explore Workbench, Phase 3: Legend — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `protspace-legend` for the workbench sidebar (decision 12). First the 3,299-line `legend.ts` is split along decision 12's seams (header, row, list, EAT controls, colour picker, item state) with its behaviour pinned and unchanged. Then each piece is redesigned on its own: 28 px rows that end long names in an ellipsis, with hover actions (eye, drag handle, "⋯" with "Show only this" and "Colour and shape") and a dimmed hidden state; a header with the display name, the predicted-annotation icon, info, a sort button that shows the active order, and settings; a searchable "Other" popover with "Add to legend"; a settings popover that applies changes as they are made, with Reset and palette swatches; the colour and shape picker, the EAT controls and the score strips on the kit. Every legend overlay joins the one layer stack, every legend stylesheet reads `--ps-*` tokens and leaves the lint allowlist, and stored legend settings keep their key and format.

**Architecture:** `protspace-legend` stays one element with one shadow root, which keeps every `legend.shadowRoot` lookup, Sortable's direct-child rows and the single stylesheet working. Its state stays on the element ("state and wiring"); templates move to render modules whose functions take explicit view models and handlers (`legend-header.ts`, `legend-row.ts`, `legend-list.ts`, `legend-score-strips.ts`); behaviour with its own transient state and timers moves to Lit reactive controllers (`EatReliabilityController`, `ColorPickerController`, `LegendKeyboardController`, `TruncatedNameTooltip`); long computations move to pure functions (`legend-items-state.ts`). The two popovers that live outside the list, Other and settings, become child feature elements (`protspace-legend-other-popover`, `protspace-legend-settings-popover`) rendered once at the end of `.legend-container`, each on `ps-popover` with its own clean stylesheet; they talk to the legend only through properties and events. Kit pieces (`ps-menu`, `ps-popover`, `ps-icon-button`, `ps-tooltip`, `ps-input`, `ps-select`, `ps-switch`, `ps-checkbox`, `ps-button`) replace the hand-made dialogs, overlays, focus trap, window Escape listener and outside-press flags.

**Tech Stack:** Lit 3 (legacy decorators: `experimentalDecorators: true`, `useDefineForClassFields: false`), TypeScript 6, Vite 8, Vitest 4.1.9 (core: jsdom `unit` and Chromium `browser` projects; utils and app: node), Playwright 1.61, the phase 1 kit (`ps-*` elements, `kit/layers.ts`, `@floating-ui/dom`), Lucide 0.462 (`lucide` in core), SortableJS (the legend's existing `DragController`), `Intl.NumberFormat` and `Intl.PluralRules`.

**Spec:** `openspec/changes/explore-workbench/design.md`: decisions 12 (legend), 5–8 (tokens, palette, type, kit), 11 (layer stack and Escape order), 15 (display names, plural-aware counts, the predicted-annotation icon replacing ⚡), 18 (code structure, files of about 800 lines) and 20 (testing); `proposal.md` for scope (capability `legend-panel`; `scatterplot-point-size` and `annotation-presentation` touch the legend); `tasks.md` section 3. Section 4 owns the Escape wiring through the app (4.1), the app-wide display-name and ⚡ sweep (4.11), the import menu and its info bubbles (4.8); none of it is pulled in here.

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. Line numbers in this plan are from `7d45ab02`; the legend files are unchanged since `42afa181`, where the research notes were taken, except three comment rewordings in phase 2's review fixes (at `639d819d` and after, the legend files differ from `7d45ab02` only in comments). Since then `ps-tooltip` also hides when its target is pressed (`df2e1bf5`).

## Global Constraints

From phases 1 and 2, unchanged:

- Every design token is a CSS custom property named `--ps-*`, declared only in `packages/core/src/styles/theme.ts`.
- New core stylesheets hold no raw colours (`#…`, `rgb()`, `hsl()`, `white`, `black`) and no literal font sizes; they read `--ps-*` tokens. Size literals such as `360px` for widths are fine.
- New code never declares tokens on `:host`; tokens come from `:root`.
- `css` literals live only in `*.styles.ts` files or `styles/` folders (ESLint rule in `eslint.config.mjs`; `styles-integrity.test.ts` finds them by glob). Non-style modules must not live in `packages/core/src/styles/`, because the integrity test treats every export there as a stylesheet.
- Kit elements use the `ps-` tag prefix; feature elements keep `protspace-`.
- Icons come from Lucide only, at stroke width 1.75 and sizes 14, 16 or 20 px.
- Popovers use `popover="manual"`; dialogs use `<dialog>.showModal()`. Both render in the top layer.
- Escape follows one order, owned by `kit/layers.ts`: the top open layer first, then registered fallbacks in ascending `order` (`ESCAPE_ORDER.connectors = 10`, `ESCAPE_ORDER.selection = 20`).
- Fonts are self-hosted; never load a third-party font CDN.
- Target browsers: the last two versions of Chrome, Edge, Firefox and Safari.
- Light accent values: fill `#007ab5` under white text, hover `#00699c`, accent text `#0369a1`, focus ring `#0284c7`. Dark: fill `#38bdf8` under `#04121c` text, hover `#7dd3fc`, accent text `#38bdf8`, focus `#38bdf8`.
- Every new export needs a consumer in the same commit (knip runs in the pre-commit hook); the task's own test file importing it is enough. Public kit API is exported from `packages/core/src/components/kit/index.ts`, which `packages/core/src/index.ts` re-exports.
- Commits: Angular `type(scope): subject`, subject under 72 characters, at most two lines, never a `Co-Authored-By` or Claude trailer. Commit when the task's tests pass. The husky hook runs `pnpm precommit` (lint-staged, type-check, knip, docs build); never bypass it on a task's final commit.
- Run core tests package-scoped: `pnpm --filter @protspace/core exec vitest --run --project unit <file>` or `--project browser <file>`.
- Dev and e2e servers use ports other than 8080 and 8091 (the user's). For e2e set `PLAYWRIGHT_PORT`, e.g. `PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec>`.
- `--ps-text-faint` is for disabled text and decorative icons only (phase 1 block review); readable secondary text, hints, placeholders, keycaps and group labels use `--ps-text-muted`.

The kit and the style lint as phases 1 and 2 left them (read `packages/core/src/components/kit/` for the exact API; these facts override any older description):

- Tokens live in `@layer ps-theme` in `theme.ts`. A task that needs a token `theme.ts` lacks re-adds it in the commit that first uses it; a JavaScript read of a token, which the lint cannot see, never relies on a fallback value. `--ps-border-control` is the boundary of unchecked checkboxes, radios and off switches. Available: surfaces `--ps-surface`, `-muted`, `-raised`, `-hover`; `--ps-border`, `-strong`, `-control`; `--ps-text`, `-muted`, `-faint`, `-on-accent`; `--ps-accent`, `-hover`, `-text`, `-tint`; `--ps-focus`, `--ps-danger`, `--ps-warning`, `--ps-success`, `--ps-tooltip-bg`, `--ps-tooltip-text`, `--ps-scrim`, `--ps-shadow-sm`, `-md`, `-lg`; `--ps-text-xs` 11, `-sm` 12, `-base` 13, `-md` 14, `-lg` 16, `-xl` 20 px; `--ps-weight-medium` 500, `-semibold` 600; `--ps-leading-tight` 1.25, `-normal` 1.45; `--ps-space-0-5` 2, `-1` 4, `-1-5` 6, `-2` 8, `-3` 12, `-5` 20, `-6` 24 px (no 16); `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`; `--ps-control-sm` 28, `-md` 32, `--ps-row` 28, `--ps-touch-target` 40 px; `--ps-focus-width`, `--ps-focus-offset` 2 px; `--ps-duration-fast` 120 ms, `--ps-duration` 160 ms, `--ps-ease`; `--ps-font-sans`.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) checks every core stylesheet outside its `LEGACY` set (18 entries at `7d45ab02`): no raw colour in any declaration, custom properties included; no `oklch()`, `lab()` or `color()`; no `var()` read of a variable `theme.ts` does not define (so new core styles read only `--ps-*` tokens, plus `--available-height`); every `theme.ts` token is read somewhere in core or `apps/web/src`. A `LEGACY` entry must still violate, so a task that deletes or cleans a legacy module removes its line in the same commit. `color-mix(…)` over tokens and `transparent` pass.
- `customElement` comes from `../../utils/safe-custom-element` (relative to a component folder), never from `lit/decorators.js`. Feature elements import kit modules by file (`import '../kit/menu'`, `import { icon } from '../kit/icon'`), as `projection-select.ts` does, not the kit barrel.
- `ps-menu`: the owner receives `ps-close` before `ps-select` (`detail: { value, checked }`); a radio or plain item closes the menu and hands focus back to its anchor first, a checkbox item keeps it open; Tab closes it; it sets `aria-haspopup` and `aria-expanded` on its anchor (do not bind them on the anchor yourself); grouped items go in `ps-menu-group` (`label`); radio exclusivity is menu-wide; checked rows are tinted.
- `ps-popover` (`.anchor`, `open`, `placement`, `panel-role`, `panel-label`; events `ps-open`, `ps-close`, both bubbling and composed; `dismiss()`): Escape and an outside press (press and release both outside; the anchor counts as inside) close it and fire `ps-close`; it returns focus to what was focused at open when focus was inside, but never moves focus in on open; it re-shows after a DOM move without firing `ps-open` again and caps its height with Floating UI's `size`. A nested overlay's `ps-close` stops at the outer overlay's slot wrapper, so an owner listens on the nested element itself. It does not set `aria-haspopup`/`aria-expanded` on its anchor: the owner does.
- `ps-button` (`variant` primary/secondary/ghost/danger, `size` sm/md) and `ps-icon-button` (`icon`, `label`, `pressed`, `size`, `tooltip-placement`) forward `hasPopup` and `expanded` (attributes `aria-haspopup`, `aria-expanded`) to their inner button and take a `describedBy` element list; `ps-button` has no accessible-name property of its own (its slotted text is its name). `ps-tooltip` (`text`, `.anchor`, `placement`, `names-target`, `show()`, `hide()`) describes its target through `ariaDescribedByElements` unless `names-target`; it hides on Escape. `ps-input` (`value`, `type` text/search/number, `label`, `placeholder`, `invalid`, `disabled`; re-dispatches `change`; native `input` events are composed) has no `min`/`max`. `ps-select` (`.options: SelectOption[]`, `value`, `label`, `disabled`; dispatches `change`) is a native `<select>`. `ps-switch` (`checked`, `label`, `disabled`; role `switch`; dispatches `change`). `ps-checkbox` (`checked`, `indeterminate`, `label`, `disabled`; role `checkbox`; dispatches `change`).
- `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void` (the release function is safe to call twice; owners call it on close and on disconnect), `topLayer()`, `onEscapeFallback(order, handle)`. Its keydown and pointer listeners are window-capture listeners installed on first use.
- Core's Vite build keeps `/^lit(\/|$)/`, `/^@floating-ui\//`, `d3` and `@protspace/utils` external.

Environment (from the phase 1 and phase 2 ledgers; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run (`pnpm --filter @protspace/core exec vitest --run`, which includes the browser project) need the Bash sandbox disabled; inside it they fail with `EPERM listen ::1`. `--project unit` works inside the sandbox.
- `pnpm add` and `pnpm install` need the sandbox disabled. `git commit` needs the sandbox disabled: the hook needs network and writes outside it. Stage files by path, never `git add -A`.
- `apps/web/tests/playwright.config.ts` runs only specs a project's `testMatch` names. Project `workbench` (Desktop Chrome, 1280×720) matches every `apps/web/tests/workbench-*.spec.ts`; `numeric-binning`, `legend-double-click`, `eat-visualization`, `density-layer`, `examples-live`, `perf-scale`, `perf-counts` and `url-view-state` (also `-firefox`, `-webkit`) have their own projects.
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `PLAYWRIGHT_PORT=… pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; always use the package-scoped forms.
- The legend's existing unit tests are jsdom (`// @vitest-environment jsdom` docblock) and mount through `mountLegendWithScatterplot(data, annotation, plotOverrides)` in `legend/test-support/legend-scatterplot-harness.ts`, with `vi.stubGlobal('localStorage', createLocalStorageMock())`. jsdom has no `showPopover`: a closed `ps-popover` or `ps-menu` renders there, but any test that opens one, measures layout or reads computed styles is a `*.browser.test.ts` (browser project, real `localStorage`: clear it in `afterEach`). The harness works in both projects.
- App unit tests run in node with no DOM. React components are covered by e2e only.
- `pnpm perf:counts` imports `perf/datasets/phosphatase.parquetbundle` (fetch once with `pnpm perf:fetch --only phosphatase`, network, sandbox disabled); budgets live in `apps/web/tests/perf/budgets.json` (`legendUpdate` and `legendRebuild`: load 7/7, idle 0/0, annotation-switch 2/2, the other segments as recorded). Never re-record them in this phase.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build in the hook scans untracked files under `docs/`: leave no scratch markdown there.
- Add a Lucide icon to core by importing its PascalCase export from `lucide` and adding a kebab-case key to `ICONS` in `packages/core/src/components/kit/icon.ts`, in the commit that first uses it; `ps-icon-button`'s `icon` and `icon(name, size)` take those keys. Verified in lucide 0.462: `Eye`, `EyeOff`, `GripVertical`, `Ellipsis`, `ArrowUpDown`, `ArrowDownWideNarrow`, `ArrowDownNarrowWide`, `ArrowDownAZ`, `ArrowDownZA`, `ArrowDown01`, `ArrowDown10`, `SlidersHorizontal`, `Sparkles`.
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.
- `pnpm docs:images` (`scripts/docs-screenshots/`, not in CI) already breaks at runtime (it keys on the removed control bar); phase 7 rewrites it. Its type-check (`pnpm type-check:scripts`, in the hook) must stay green; its legend selectors (`.view-button`, `.modal-content`, `.other-item`, `.extract-button`) are left alone.
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race, about 1 in 6) and the `numeric-binning` "hover point" test under full-suite load. Re-run once alone before investigating.
- The plan's tasks were written in parallel against `7d45ab02`; if an anchor (a line number, a neighbouring line) has drifted, apply the intended change to the current code and say so in the report.

From phase 2, still in force:

- Runtime elements are rendered by React exactly once, unconditionally, with stable ids (`#myLegend` among them), never keyed or moved. The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions` and `help` are kept for the tour, the e2e and the perf suites.
- At rest no ancestor of `#myLegend`, the import menu or the projection details gets `transform`, `translate`, `filter`, `contain` or `container-type`, and `#wb-sidebar` gets no z-index: the legend's `position: fixed` dialogs live in its shadow root until Task 3.12, and the import menu and projection details keep theirs until phase 4.
- E2E: new specs are `apps/web/tests/workbench-*.spec.ts`. Specs reach controls through helpers (`apps/web/tests/helpers/explore.ts`, `apps/web/tests/helpers/workbench.ts` for the sidebar and layout, and from Task 3.7 `apps/web/tests/helpers/legend.ts`) that find them by role, accessible name or tag (Playwright's CSS locators pierce shadow roots); a new helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip).
- Docs: the developer docs (`docs/developers/`) change in the commit that changes the public API or the architecture they describe. The user guide (`docs/explore/legend.md`) and its images wait for phase 7.

Baseline: run the suites at the start of the phase and use those counts, not phase 2's: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`, `PLAYWRIGHT_PORT=8475 pnpm test:e2e` and `pnpm perf:counts`. Record them in the phase 3 ledger; every task report gives the counts before and after, and `wc -l packages/core/src/components/legend/legend.ts`.

Phase 3:

- **One element, one shadow root.** Rows, the list, the header, the EAT controls, the score strips and the colour picker render inside `protspace-legend`'s own shadow root; the list never contains a custom element with a shadow root (Sortable needs the rows as direct children of `.legend-items`; hundreds of rows must stay cheap). The only legend child elements are `protspace-legend-other-popover` and `protspace-legend-settings-popover` (and the existing `protspace-score-strip`, `protspace-info-popover`), rendered once each as the last children of `.legend-container`, never inside `.legend-items` or a row.
- **Public surface kept** (documented in `docs/developers/api/index.md`): the tag, attributes (`scatterplot-selector`, `auto-sync`, `auto-hide`), every property, method and getter (`forceSync`, `getLegendExportData`, `downloadAsImage`, `getAllPersistedSettings`, `setFileSettings`, `clearForNewDataset`, `hasFileSettingsForAnnotation`, `applyShapeSize`, `applyEatSettings`, `setReliabilityState`; `hasFileSettings`, `reliabilityThreshold`, `pickedShapeSize`, `reliabilityState`), and events `legend-item-click` (`{ value, action: 'toggle' | 'isolate' | 'extract' }`), `legend-zorder-change`, `legend-colormapping-change`, `legend-customize` (now: the settings popover opened), `legend-download`, `legend-error`, `eat-overlay-change` (`{ enabled, confidenceThreshold, reliability }`) and the window event `protspace-legend-state-change`. Parts kept: `container`, `header`, `items`, `item`, `symbol`, `text`, `count`, `empty`. Parts removed in this phase, and said so in the docs: `predicted-note` (3.9), `dialog-overlay`, `dialog-content` (3.10, 3.12).
- **DOM contract kept** (unit, e2e, perf, tour and docs scripts read it): `.legend-item[data-value][data-display-value]` with `part="item"` and `role="listitem"` inside `.legend-items[part=items][role=list]`; classes `.hidden`, `.selected`, `.legend-item-other`, `.legend-item-score-hover`; `button.legend-item-main` with `aria-pressed` = visible and an accessible name starting `${label}:`; `.legend-text[part=text]`; `.legend-count[part=count]`; `.legend-symbol path` carrying the item colour in `fill` (or `stroke` for outline shapes); `button.drag-handle` (plus `.drag-handle-disabled` and `disabled` when it cannot move); `.legend-title`; `button.view-button` on the Other row; `data-driver-id="other-row"` on the Other row. A double-click at a row's centre and at 24 px inside `.legend-item-main` lands on `.legend-item-main`.
- **Persistence unchanged:** key `protspace:legend:{datasetHash}:{annotation}` (`buildStorageKey('legend', hash, annotation)`), the `LegendPersistedSettings` field set (`maxVisibleValues`, `shapeSize`, `sortMode`, `hiddenValues`, `categories`, `enableDuplicateStackUI`, `selectedPaletteId`, plus `numericSettings` for numeric annotations; `includeShapes` read and never written), `SHAPE_SIZE_FILLER` 10 (30 also reads as unset), `protspace:shape-size:{hash}`, the load-time normalisations and migrations. No field is added, renamed or given a new meaning.
- **Perf unchanged:** `perfCounters.legendRebuild` and `perfCounters.legendUpdate` are incremented once each, at the start of `_rebuildLegendItems` and `_updateLegendItems`, wherever those bodies end up; no task calls either more often for the same user action: a sort pick or a menu action runs one `_updateLegendItems`; a settings edit after its debounce runs what the dialog's Save ran for the same change: one `_updateLegendItems`, plus, for Max legend items or Bins, the one `_rebuildLegendItems` that `updated()` runs (one `legendRebuild` per committed edit). `apps/web/tests/perf/budgets.json` is not edited in this phase. Hover and the hover actions are CSS only: no `@state` changes on pointer movement beyond today's `_hoveredCategory` (gated on scores). Focus entering a row may re-render once, to move the list's one Tab stop (`LegendKeyboardController.focusValue`, Task 3.7), and never runs `_updateLegendItems`.
- **Sizes:** row height `var(--ps-row)` (28 px); under `@media (pointer: coarse)` `min-height: var(--ps-touch-target)` (40 px) and the row actions always visible; row padding `0 var(--ps-space-3)`, gap `var(--ps-space-2)`; legend symbol drawn at 10 px (`LEGEND_STYLES.legendDisplaySize = 10`, 3 px padding, a 16 px SVG); row action buttons 24 × 24 px with 14 px icons; header 44 px tall, padding `0 var(--ps-space-1-5) 0 var(--ps-space-3)`, its buttons `ps-icon-button size="sm"` (28 px); the Other and settings popovers 300 px wide; the Other popover renders at most `OTHER_POPOVER_ROW_LIMIT = 200` rows.
- **Type and colour:** row label `--ps-text-base`, one line, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; count `--ps-text-sm`, `--ps-text-muted`, `font-variant-numeric: tabular-nums`; title `--ps-text-base` at `--ps-weight-semibold`, ellipsis; hidden rows: symbol at opacity 0.35, label `--ps-text-muted` (never `--ps-text-faint`: hidden rows stay actionable); the Other and N/A labels `--ps-text-muted`; the symbol keeps its 1 px SVG stroke (`#394150`, literal until phase 6), and the selected stroke comes from CSS (`--ps-accent`). No new `--ps-*` tokens in this phase; mockup spacings of 14 and 10 px map to `--ps-space-3` and `--ps-space-2`.
- **Text:** every legend string uses the annotation's display name (`annotationLabel(name, annotation)` from `@protspace/utils`), never its raw key; counts go through `formatCount` and `countNoun` (`packages/core/src/utils/count-text.ts`, Task 3.6); no emoji and no native `title` attribute anywhere in the legend.
- **Timings:** a colour edit commits 150 ms after the last input (`COLOR_COMMIT_DELAY_MS`, unchanged); a settings number field commits 300 ms after its last `input` (typing or an arrow step; `SETTINGS_INPUT_DEBOUNCE_MS`) and at once on Enter or when focus leaves the field (Chrome fires `change` on every arrow step, so `change` is not a commit point); a pending edit is flushed on close, Escape and disconnect, and dropped by Reset; discrete settings controls (swatch, switch, select) and sort picks apply at once; the truncated-name tooltip shows after 500 ms (`NAME_TOOLTIP_DELAY_MS`); the EAT slider commit stays 150 ms (`EAT_THRESHOLD_COMMIT_DELAY_MS`).
- **Escape and outside press:** every legend overlay is a layer: the row menu and the sort menu (`ps-menu`), the colour picker and both popovers (`ps-popover`), and a keyboard reorder in progress (`pushLayer` with `dismissOnOutsidePress: false`, Task 3.8). After Task 3.12 the legend adds no `window` keydown, mousedown or mouseup listener and no focus trap, and it registers no Escape fallback (phase 4.1 owns those).
- **Style modules:** each task's new or rewritten stylesheet is clean under the lint the day it lands. `LEGACY` loses `legend/styles/item.ts` (3.8), `legend/styles/modal.ts` (3.12), `legend/category-score-strip.styles.ts` (3.14), `legend/legend.styles.ts`, `legend/styles/layout.ts` and `legend/styles/theme.ts` (3.15): six fewer than at the phase's start (18 at `7d45ab02`, so 12 unless something outside this phase changes the set), none under `components/legend/`. Each task states its LEGACY change relative to the count before it. `common/info-popover.styles.ts` stays (phase 4 owns that element).
- **File size:** `wc -l packages/core/src/components/legend/legend.ts` is recorded in every task report. It shrinks in each of Tasks 3.2–3.5 (about 2,150–2,350 lines after 3.5, from 3,299) and ends the phase no larger than after Task 3.5 plus 100 lines; the residue (data pipeline, settings applier, sort and row-menu glue) is recorded for Task 8.1, which owns decision 18's ~800. No forwarding methods are left behind for tests (a test that reached a moved private member reaches its new owner); no new legend module over 800 lines.
- **Accessible names this phase introduces** (helpers and specs rely on them): row actions "Hide {value}" / "Show {value}", "Reorder {value}" (unchanged), "More actions for {value}", where {value} is the display value ("Hide Other", not "Hide Other · 2 categories"); row menu "Actions for {value}" with items "Show only this" (or "Show all" when the row is the only one shown) and "Colour and shape"; picker panel "Colour and shape: {label}"; header "Sort: {sortLabel}" and "Legend settings" (unchanged); sort menu "Sort legend" with group "Sort by", radios "By count", "By name" or "By value", "By separation", "Your order", and checkbox "Reverse order"; predicted mark "Predicted annotation"; Other trigger "View items grouped under Other" (unchanged), Other panel "Other categories", search "Search Other categories", per-row "Add to legend: {label}", footer "Add all ({n})"; settings panel "Legend settings: {display name}", radiogroup "Palette", spinbuttons "Max legend items" (numeric "Bins") and "Shape size" (numeric "Point size"), switch "Show duplicate counts and spread overlaps", switch "Reverse gradient", combobox "Bin distribution", button "Reset"; EAT names unchanged ("Show EAT predictions", "EAT reliability filter mode", the slider and percentage names).

## Review Focus

1. **An "Other" bucket with thousands of categories** (Swiss-Prot families, or any annotation after a low "Max legend items"). Opening the popover must not render thousands of rows or block the page; searching must stay instant; "Add to legend" must keep the popover open on the next row; adding the last category removes the Other row and must close the popover without stranding focus on `<body>`. Pinned by Task 3.10 (5,000 items render 200 rows plus "Showing 200 of 5,000", the filter runs once per query, the last add closes and focuses the first row).
2. **Settings stored before this phase.** Users have per-dataset legend records written by today's dialog and bundles carrying them: `includeShapes`, the filler sizes 10 and 30, `manual-reverse` and `silhouette-asc` sorts, numeric `numericSettings` with signatures, and `enableDuplicateStackUI: true`. They must load into the same live state, and a live edit must rewrite the same key with the same field set, keeping every field it did not touch (today an unrelated save writes `enableDuplicateStackUI: false` over a stored `true` until the dialog is opened). Pinned by Task 3.1 (legacy record round trip on today's code) and Task 3.12 (the same fixtures after the rewrite, the field set, the duplicate-stack bug fixed).
3. **Live apply at 573K.** Typing "25" into "Max legend items" or "Bins", or holding an arrow key on the spinbutton, must not re-bin or recolour 573K points per keystroke, and a value typed and then left with Escape or an outside press must still be kept. Pinned by Task 3.11 (one `settings-change` per burst, exactly 300 ms after the last input under fake timers, flush on close) and Task 3.12 (one `legendRebuild` per committed edit, counted by spying on `_rebuildLegendItems`, where `perfCounters.legendRebuild` is incremented; Escape right after typing keeps the value in storage).
4. **Nested legend layers and Escape.** The row "⋯" menu opens "Colour and shape", which opens the picker; a keyboard reorder may be in progress; the settings popover holds a native `<select>` whose own picker is outside the shadow tree. Each Escape must close exactly one thing, top first; choosing an option in the native select must not count as an outside press; with nothing of the legend's open, Escape must pass through untouched (the selection's handler, and phase 4's fallbacks, still get it). Pinned by Task 3.8 (the row menu reopened over its picker, over a keyboard reorder: menu, then picker, then the reorder) and Task 3.12 (a press on the native select counts as inside, and Escape reaches a `document` listener once the legend is idle). The native select's own option list is drawn by the browser and its clicks never reach the page.
5. **A narrow sidebar with long names and big numbers.** At the 240 px minimum, a 70-character family name with a count of 123,456, the predicted icon, info, sort and settings must all fit: labels truncate (never wrap, never push the count or the header buttons out), hover actions never reflow the label, and the full name is still reachable by pointer (tooltip) and by assistive tech (the button's name). On a coarse pointer the rows are 40 px and the actions always visible. Pinned by Task 3.6 (rows at 240 px in the browser project, and 40 px rows under touch emulation), Task 3.7 (the name tooltip) and Task 3.9 (header at 240 px).

## Rulings

- Split by render modules and reactive controllers inside one element, not child elements, for the list, row, header and EAT controls: Sortable, the `shadowRoot` lookups across unit, e2e, perf, tour and docs scripts, and the single stylesheet all need one shadow root (R1 §3, R2 §3).
- The Other and settings popovers are child feature elements with their own shadow roots and clean stylesheets: they sit outside the list, hold their own transient state (search query, debounce), and are testable in isolation; decision 12 names them as separate pieces (R3 §3).
- The split comes first and changes no behaviour: Task 3.1 pins today's behaviour with characterization tests, Tasks 3.2–3.5 move code under them, Tasks 3.6–3.15 redesign one piece each (tasks.md 3.1 becomes 3.1–3.5; the rows take two tasks, 3.6–3.7, and the settings three, 3.11–3.13).
- `legend.ts` targets: each split task (3.2–3.5) makes it shorter, to about 2,150–2,350 lines; at phase end it is no larger than after 3.5 plus 100 lines, recorded in the ledger. Decision 18's ~800 is Task 8.1's: the rest is the data pipeline (data change, counts, item rebuild, persisted settings, about 600 lines), the settings applier and the sort and row-menu glue, which need a state-store refactor decision 12 does not ask for and which would put the perf counters at risk.
- The settings and Other dialog glue is not extracted in the split: Tasks 3.10 and 3.12 replace it, so moving it first would be thrown-away work. `legend-other-dialog.ts` and `legend-settings-dialog.ts` keep their names until they are deleted.
- Private-member references in tests are renamed to the new owner in the commit that moves the member; no forwarding methods (R1 Q3).
- `protspace-legend-state-change` stays unchanged: no listener exists, but removing an event is a separate decision; noted for 8.1 (R1 Q4).
- Every legend Escape goes through `kit/layers.ts`: menus and popovers by construction, and a keyboard reorder by pushing its own layer while a row is picked up (`dismissOnOutsidePress: false`). The legend's window capture listener, which would otherwise race phase 4's selection fallback, loses a branch per task and is deleted in 3.12 (deviates from R1 Q5 and R2, which kept a local handler; decision 11 asks for one order).
- The swatch moves inside the row's main button and toggles like the rest of the row; colour and shape move to the "⋯" menu (R2 Q1). One hit target, one fewer tab stop.
- The sort button's icon shows the active order, its name and tooltip say it ("Sort: By count, largest first"), and the menu checks it; no visible text in a 240 px header (R2 Q2).
- The predicted mark is Lucide `sparkles` at 14 px, named "Predicted annotation", with the tooltip "Predicted: computational, not experimentally curated"; the note line and its `predicted-note` part go (R2 Q3). 4.11 reuses the icon in the annotation picker.
- Hidden rows show a decorative 14 px `eye-off` before the count at all times; the actionable eye is in the hover actions (R2 Q4).
- No right-click menu in this phase (R2 Q5).
- The Other row has the eye and "View", no "⋯" and no visible handle (R2 Q6); its handle element stays, disabled and transparent, because e2e reads `.drag-handle-disabled`.
- Row actions are plain `<button>`s with `icon()` and `aria-label`, no per-row kit elements or tooltips; the header uses `ps-icon-button` (R2 Q7). The Other popover's per-row "Add to legend" is a plain button for the same reason (200 rows).
- One shared `ps-menu` for every row's "⋯" and one shared `ps-tooltip` for truncated names, rendered once in the legend root; neither is per row.
- The full name of a truncated label shows in the shared tooltip after 500 ms on pointer hover; keyboard and screen-reader users get it from the main button's accessible name, so the tooltip uses `names-target`.
- Row accessible name: "{label}: {formatCount(n)} {protein|proteins}, {shown|hidden}" (decision 15's plural rule; the `{label}:` prefix the e2e keys on is kept). The Other row's label is "Other · {n} {category|categories}"; `toDisplayValue(OTHER, n)` stays as is for the figure export.
- `formatCount` and `countNoun` live in core (`src/utils/count-text.ts`), so core tests need no utils rebuild; 4.11 may move them.
- Coarse pointers get 40 px rows and always-visible actions in this phase, keyed on `(pointer: coarse)` as decision 17 says, not `(hover: none)` (R4 Q2).
- The settings icon is `sliders-horizontal` (the mockups), keeping the name "Legend settings" (R4 Q4).
- Sort menu: radios "By count" (`size-desc`), "By name" (`alpha-asc`; numeric "By value"), "By separation" (`silhouette-desc`, shown only with scores or while it is the active order) and "Your order" (`manual`, keeping the current display order), plus a checkbox "Reverse order" that runs today's `_toggleLegendOrderDirection` (checked for `size-asc`, `alpha-desc`, `manual-reverse`, `silhouette-asc`). A pick applies at once and persists the same `sortMode` values.
- Category order leaves the settings popover (decision 12); the header's sort menu and drag own it. Until Task 3.12 the old dialog keeps its order radios, so both write the same state for three tasks (3.9–3.11).
- Numeric value sorts use `arrow-down-0-1` / `arrow-down-1-0`; name sorts `arrow-down-a-z` / `arrow-down-z-a`; count and separation `arrow-down-wide-narrow` (largest or best first) / `arrow-down-narrow-wide`; your order `arrow-up-down`.
- The "282 above 289" in the demo is a stored manual order, not a sort bug; no code change: the sort button now shows "Your order" there (R2 §5).
- The colour and shape picker becomes a `ps-popover` anchored to the row, placed `left-start` (over the plot, not over the list); its six shapes show inline as a radio group instead of a nested dropdown; its native colour input stays.
- The info button in the header stays `protspace-info-popover`: the element is shared with the EAT block, the score strips, the annotation picker, the import menu and the projection details, and phase 4 (4.8) rebuilds it once for all; phase 3 only switches its two `--legend-*` reads to `--ps-text-muted` and `--ps-text` (R4 Q1).
- The Other popover stays open after "Add to legend" and closes when Other empties; "Extract all" survives as "Add all ({n})" (R3 Q1, Q2). Rows sort by count descending, then display name; search is a case-insensitive substring of the display name.
- Settings Reset is always shown, disabled only when nothing is stored for the annotation and no size was picked; the popover stays open after Reset with the defaults shown, focus on the first swatch (R3 Q3). Reset keeps today's scope (the annotation's hidden values, colours, order, palette and item count, and the dataset-wide size), and a hint line under the button says so: "Resets this annotation's colours, order, hidden categories, palette and item count, and the dataset's point size".
- Number fields commit 300 ms after the last input, and at once on Enter or blur; discrete controls at once (R3 Q4).
- "Show duplicate counts and spread overlaps" stays in legend settings: it is stored per annotation, and moving it would change the format (R3 Q5).
- The settings panel is named "Legend settings: {display name}"; its visible heading is the display name (R3 Q6).
- `ps-input` gets no `min`/`max`: the element validates as today (`parsePositiveInt`, size capped at 64 and written back) (R3 Q7).
- A real `@state _enableDuplicateStackUI` on the legend replaces the draft field `getCurrentSettings` read, fixing the overwrite bug (R3 §1).
- EAT controls on the kit: the "Show EAT predictions" toggle becomes `ps-checkbox` (keeps role `checkbox`, which `eat-visualization.spec.ts` uses), the mode select becomes `ps-select` (keeps role `combobox` and its name); the range sliders and percent boxes stay native inputs restyled with tokens (the kit has no slider, `ps-input` no `min`/`max`/`step`), keeping their classes and names (R4 §4).
- The legend host loses its card chrome (border, radius, shadow, fixed 50 % height); the sidebar draws the edges, and the `#myLegend` overrides in `workbench.css` shrink to `flex` and `min-height`. An embedder that wants a card adds a border on its own page (developer docs, 3.15).
- `srOnly` moves to `kit/kit-shared.styles.ts` (3.15); `styles/mixins.ts` keeps `srOnlyMixin` for the projection details until 8.1.
- `legend/styles/theme.ts` and `legend/styles/responsive.ts` are deleted (the 23 `--legend-*` properties; responsive.ts unsets a `max-width` nothing sets) (R4 §1).
- The Other grey (`#888`) and the symbol stroke colours stay literal in TypeScript until phase 6 adds the neutral point tokens; the selected symbol stroke moves to CSS (`--ps-accent`) in 3.6 because the row's `.selected` class already carries it.
- E2E legend helpers live in `apps/web/tests/helpers/legend.ts` (created in 3.7); `helpers/explore.ts` re-exports the three it already had (`getFirstLegendItemValue`, `clickLegendItem`, `isLegendItemHidden`) so their callers do not change. `numeric-binning.spec.ts`'s local legend helpers move there, role-based, in the task that breaks them; helpers read `aria-pressed` rather than the `.hidden` class (R4 Q6). Phase 7.1 shares the module with the docs captures.
- The docs captures broken by 3.10 (`capture-animations.spec.ts` legend-others) are left to phase 7, which rewrites the pipeline; only `pnpm type-check:scripts` must stay green (R4 Q5, overruled: `docs:images` is already broken).
- The tour's step 8 copy changes in 3.9 (the swatch click, the reverse icon and the gear it described are gone) and its step 9 copy in 3.10 to name "View" and "Add to legend" (targets kept); 7.4 rewrites the tour.
- `tasks.md` section 3 is rewritten to list this plan's fifteen tasks in the commit that adds the plan; the ticks land at the end of the phase.

Rulings from the plan review (two judges; each finding was checked against the code):

- Two draft tasks were too big for one implementer and are split along green boundaries: rows (3.6: rows, actions, row menu, styles; 3.7: the roving Tab stop, the name tooltip, the e2e legend helpers and spec) and live settings (3.12: core; 3.13: the e2e on the popover). Until 3.7 the first row's controls hold the Tab stop, today's rule.
- Between 3.12 and 3.13 the e2e tests that drove the old dialog are `test.fixme` for one commit. Run 3.13 right after 3.12 and review the two together.
- "Colour and shape" opens the picker and never closes it: chosen for the row whose picker is open, the picker stays (3.6 guards the call; 3.8 calls `open` and deletes `ColorPickerController.toggle`).
- Re-picking the checked sort radio does nothing (phase 2 ruling M1), so it can never silently drop "Reverse order"; `_applySortMode` itself stays a plain setter.
- `isLegendItemHidden` keeps finding the row by `data-value` (so `__NA__` and bin ids work) and reads the main button's `aria-pressed`.
- `clearForNewDataset` flushes a colour still waiting for its delay onto the dataset it was picked on (3.4). It is the split's one behaviour change, recorded as a deviation; before, the commit fired against the next dataset.
- Custom colours under a non-Kelly palette do not survive a reload today (`_updateLegendItems` recolours through the palette). 3.1 pins that as is, 3.12 keeps it, and the ledger records it for a later fix. Picking a palette in the popover recolours the rows to it at once (live apply).
- N/A rows are reorderable today (only Other is fixed); 3.1 pins that.
- The settings popover's `settings` object is reused while its fields are unchanged, so a legend render does not re-render the closed popover. Caching it only while open (a judge's proposal) is not taken: tests and code read the closed popover's settings, which would go stale.
- Browser tests count item passes with spies on `_updateLegendItems` and `_rebuildLegendItems`, where the perf counters are incremented, not with a `vi.mock` of `perf-counters`.
- A demo load clears stored legend settings (`dataset-controller.ts`), so 3.9's e2e checks the stored sort and 3.13 checks the reload round trip on a TOXPROT user import.
- Exported types with no importer fail knip: `ColorPickerOptions`, `LegendKeyboardOptions` and `PaletteSwatchesView` stay module-private.
- EAT counts go through `formatCount` in tabular figures (3.14).
- Interim states, untested in between: until 3.8 the picker is the old absolute box beside the row, which a narrow sidebar may clip; until 3.10 and 3.12 the old Other and settings dialogs keep their own Escape branch beside the reorder layer.

## File structure

`packages/core/src/components/legend`

- `legend.ts` (M 3.2–3.12): the element: properties, `@state`, controller wiring, lifecycle, public API, data pipeline, item actions, `render()` composition.
- `legend-header.ts` (C 3.2; M 3.9, 3.12): the header template; from 3.9 `sortLabel`, `sortIcon` and the sort menu template; from 3.12 `settingsOpen`.
- `legend-row.ts` (+ `legend-row.test.ts`) (C 3.2; M 3.6, 3.7, 3.10): the legend symbol and the row template.
- `legend-list.ts` (C 3.2; M 3.4, 3.7, 3.8): the list template, `LegendKeyboardController` (row navigation, the roving Tab stop, keyboard reorder and its layer), `TruncatedNameTooltip`.
- `legend-score-strips.ts` (+ test) (C 3.2): strip point derivation and the strips section template.
- `legend-eat-controls.ts` (C 3.3; M 3.14): EAT constants, `EatReliabilityController`, the EAT section template.
- `legend-color-picker.ts` (C 3.4; M 3.8): `ColorPickerController` and the picker template (absolute in 3.4, `ps-popover` from 3.8).
- `legend-items-state.ts` (+ test) (C 3.5): pure item and settings functions.
- `legend-other-popover.ts`, `legend-other-popover.styles.ts` (+ browser test) (C 3.10): `protspace-legend-other-popover`.
- `legend-settings-popover.ts`, `legend-settings-popover.styles.ts`, `palette-swatches.ts` (+ browser test) (C 3.11): `protspace-legend-settings-popover` and its palette radio group.
- `legend-renderer.ts` (D 3.2); `legend-other-dialog.ts` (+ test) (D 3.10); `legend-settings-dialog.ts` (+ test), `focus-trap.ts` (+ test) (D 3.12).
- `config.ts` (M 3.6): `legendDisplaySize` 10. `types.ts` (M 3.11): `LegendDisplaySettings`. `legend-helpers.ts` (M 3.6): `getItemClasses(item, selected, picked)`; its test (M 3.6, 3.12: the `initializeAnnotationSortMode` cases go with the dialog module that held it).
- `legend.styles.ts` (M 3.6, 3.8, 3.9, 3.12, 3.14; clean in 3.15): composition.
- `styles/row.ts` (C 3.6), `styles/picker.ts` (C 3.8), `styles/header.ts` (C 3.9), `styles/eat.ts`, `styles/strips.ts` (C 3.14): clean modules. `styles/item.ts` (M 3.6; D 3.8), `styles/modal.ts` (M 3.10; D 3.12), `styles/layout.ts` (M 3.9, 3.14; clean 3.15), `styles/theme.ts`, `styles/responsive.ts` (D 3.15).
- `category-score-strip.styles.ts` (clean 3.14; M 3.15 for `srOnly`).
- Tests: `test-support/legend-fixtures.ts`, `legend.dom-contract.test.ts`, `legend.api.test.ts`, `legend.header.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.color-picker.test.ts`, `legend.escape-order.test.ts`, `legend.persistence-compat.test.ts` (C 3.1); `legend-score-strips.test.ts`, `legend-row.test.ts` (C 3.2); `legend-items-state.test.ts` (C 3.5); `test-support/popover-stub.ts`, `legend.rows.test.ts`, `legend.rows.browser.test.ts` (C 3.6; M 3.7); `legend.color-picker.browser.test.ts`, `legend.escape-order.browser.test.ts` (C 3.8, replacing the jsdom picker and Escape tests); `legend.sort-menu.browser.test.ts` (C 3.9); `legend-other-popover.browser.test.ts`, `legend.other.browser.test.ts` (C 3.10); `legend-settings-popover.browser.test.ts` (C 3.11); `legend.settings.browser.test.ts`, `legend.numeric-settings.test.ts` (C 3.12); `legend.styles.browser.test.ts` (C 3.15); `legend.score-sync.test.ts` (M 3.9, 3.12); `legend.eat-controls.test.ts` (M 3.3, 3.14); other existing tests updated where a task says.

Other core

- `src/utils/count-text.ts` (+ test) (C 3.6): `formatCount`, `countNoun`.
- `src/components/kit/icon.ts` (M 3.6, 3.9): legend icons as first used.
- `src/components/kit/select.ts`, `src/components/kit/fields.browser.test.ts` (M 3.11): `PsSelect.describedBy`.
- `src/components/kit/kit-shared.styles.ts` (M 3.15): `srOnly`.
- `src/components/control-bar/query-builder.ts` (M 3.10): its close icon from `icon('x', 20)`.
- `src/components/common/info-popover.styles.ts` (M 3.15), `src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts` (M 3.15): no `--legend-*`.
- `src/styles/style-lint.test.ts` (M 3.8, 3.12, 3.14, 3.15): LEGACY lines.

`apps/web`

- `src/tour/product-tour.ts` (M 3.9: step 8 copy; M 3.10: step 9 copy).
- `src/workbench/workbench.css` (M 3.15): `#myLegend` overrides.
- `tests/helpers/legend.ts` (C 3.7; M 3.9, 3.10, 3.13), `tests/helpers/explore.ts` (M 3.7): legend helpers.
- `tests/workbench-legend.spec.ts` (C 3.7; M 3.9, 3.10, 3.13, 3.15).
- Existing specs: `numeric-binning.spec.ts` (M 3.6, 3.9, 3.12 (parked), 3.13), `workbench-sidebar.spec.ts` (M 3.12 (parked), 3.13), `legend-double-click.spec.ts`, `eat-visualization.spec.ts`, `density-layer.spec.ts`, `examples-live.spec.ts`, `perf-scale.spec.ts` and `helpers/perf/scenarios.ts` (must pass unchanged; touched only if a task says).

Docs: `docs/developers/architecture.md` (M 3.5, 3.10, 3.12), `docs/developers/messaging.md` (M 3.10, 3.12), `docs/developers/api/index.md` (M 3.9, 3.12), `docs/developers/style-architecture.md` (M 3.15).

---

### Task 3.1: Pin the legend's behaviour before the split

Six characterization test files pin what the split must not change: the DOM contract the e2e, perf, tour and docs scripts read, the public API, the header, keyboard reorder, the colour picker, the Escape order and the persisted record. They pass on today's code; later tasks change them only where a task says so, deliberately. A small fixtures module gives every later legend test the same datasets and the legacy record.

**Files:**

- Create: `packages/core/src/components/legend/test-support/legend-fixtures.ts`
- Create (unit, jsdom): `legend.dom-contract.test.ts`, `legend.api.test.ts`, `legend.header.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.color-picker.test.ts`, `legend.escape-order.test.ts`, `legend.persistence-compat.test.ts` (all in `packages/core/src/components/legend/`)

**Interfaces:**

- Consumes: `mountLegendWithScatterplot`, `MockScatterplot` (`test-support/legend-scatterplot-harness.ts`); `createLocalStorageMock`; `LEGEND_EVENTS`, `LEGEND_VALUES`, `NA_VALUE`, `LEGEND_DEFAULTS`, `LEGEND_STYLES`, `SHAPE_PATH_GENERATORS` (`config.ts`); `defaultShapeSize`, `SHAPE_SIZE_FILLER` (`legend-helpers.ts`); `LegendDataProcessor` (`legend-data-processor.ts`); `buildStorageKey`, `generateDatasetHash`, `materializeVisualizationData`, `annotationLabel`, `COLOR_SCHEMES`, `DEFAULT_NUMERIC_PALETTE_ID` and the types `VisualizationData`, `LegendPersistedSettings` from `@protspace/utils`; `ProtspaceLegend`.
- Produces (`test-support/legend-fixtures.ts`):
  - `categoricalData(counts: Readonly<Record<string, number>>, annotation?: string): VisualizationData` — one categorical annotation (default `'family'`) whose values appear with the given counts, in the given order; protein ids `p1…pN`; one 2-D projection. A `__NA__` key gives that many proteins with no value (a code past the last value, which the legend counts as N/A).
  - `numericData(values: readonly (number | null)[], annotation?: string): VisualizationData` — one numeric annotation (default `'length'`), materialized with `materializeVisualizationData(raw, {}, LEGEND_DEFAULTS.maxVisibleValues, annotation)` the way the plot hands it to the legend; `null` becomes `NaN` (N/A). (The skeleton points at a numeric case in `legend.shape-size.test.ts`; that file has none, so this builder is new.)
  - `legacyLegendRecord(): LegendPersistedSettings & { includeShapes: boolean }` — a record as today's dialog writes it for `categoricalData(TWELVE)` after "Okabe-Ito", a reverse and three picker edits: `maxVisibleValues: 8`, `shapeSize: 30` (legacy filler), `sortMode: 'manual-reverse'`, `hiddenValues: ['C']`, `categories` for the eight shown values `A…H` (zOrder `7 - rank`, so `H` is first; colour `COLOR_SCHEMES.okabeIto[rank]`, shape `circle`), of which `B`, `D`, `F` carry a custom colour (`#123456`, `#abcdef`, `#0f0f0f`) and shape (`diamond`, `square`, `triangle-up`), `enableDuplicateStackUI: false`, `selectedPaletteId: 'okabeIto'`, `includeShapes: true`.
  - `TWELVE: Readonly<Record<string, number>>` — twelve categories `A`…`L` with distinct descending counts (12 down to 1), so the default 10 rows leave two in Other.
  - `legendStorageKey(hash: string, annotation: string): string` (wraps `buildStorageKey('legend', …)`).
- Every later legend test may import these; nothing in production code does.

**Tests:**

- `legend.dom-contract.test.ts`: on `categoricalData({ ...TWELVE, __NA__: 20 })` (N/A at 20 proteins, so it is a shown row; at the skeleton's 2 it would sit in Other):
  - each row is `.legend-item[part=item][role=listitem][data-value][data-display-value]`, a direct child of `.legend-items[part=items][role=list]`; the Other row has `.legend-item-other` and `data-driver-id="other-row"` and a `button.view-button` named "View items grouped under Other"; N/A shows "N/A".
  - `.legend-item-main` carries `aria-pressed` and the name `^{label}: \d+ items, (shown|hidden)$` (Task 3.6 changes this line on purpose); clicking it toggles `.hidden`.
  - `.legend-text[part=text]`, `.legend-count[part=count]`, `[part=symbol] .legend-symbol path[fill]`, `button.drag-handle`, `.drag-handle-disabled` on Other, `.legend-title`, parts `container`, `header`, `empty` (on an empty legend), `predicted-note` (on a predicted annotation; 3.9 removes it).
- `legend.api.test.ts`: every public method and getter listed in Global Constraints exists with today's arity; `legend-customize`, `legend-item-click`, `legend-error`, `eat-overlay-change` (and `legend-download`) are dispatched by their documented triggers (one assertion each). `eat-overlay-change` is triggered through `applyEatSettings` (the bundle restore), not the checkbox, so Task 3.14's kit checkbox does not touch this file.
- `legend.header.test.ts`: the title is the display name (`annotationLabel`), never the key; the reverse button's name for categorical ("Reverse z-order (keep Other last)"), numeric `alpha-asc` ("Show high to low"), numeric `alpha-desc` ("Show low to high") and numeric manual ("Reverse manual order"); the settings button ("Legend settings") dispatches `legend-customize` and focuses `#legend-settings-dialog`; a predicted annotation shows the badge and the note.
- `legend.keyboard-reorder.test.ts`: Space on a row's `.drag-handle` announces "Picked up {label} for reordering"; ArrowDown moves it one place, switches the sort mode to manual and fires `legend-zorder-change` once; Escape restores the order and announces "Reordering canceled."; Enter drops and announces "Dropped {label}"; Space on the Other handle does nothing. **Deviation from the skeleton:** today N/A is reorderable like any category (`_canDragLegendItem` excludes only Other), so the test pins that Space on the N/A handle picks it up.
- `legend.color-picker.test.ts`: a click on a categorical row's symbol button opens `.color-picker-popover` headed by the row's label; three colour `input` events within 150 ms (fake timers) dispatch one `legend-colormapping-change`; a shape pick persists in storage; mousedown and mouseup outside close it and flush; a mousedown inside that ends outside does not close it; numeric rows have no symbol button.
- `legend.escape-order.test.ts`: with the colour picker, the Other dialog and a keyboard reorder all active (settings opened alone, since opening it clears a reorder), each Escape closes one, in the order picker → Other → settings → reorder; with nothing open, Escape reaches a `document` keydown listener.
- `legend.persistence-compat.test.ts`:
  - "reads a record written before phase 3 unchanged": seed `legendStorageKey(hash, 'family')` with `legacyLegendRecord()`, mount, assert the live state (8 rows plus Other in the stored order, `manual-reverse`, `C` hidden, the three custom shapes and the zOrders, every row in its Okabe-Ito colour, the default size); then hide and show one row and assert the stored record equals the seed minus `includeShapes`, field by field, with today's two normalisations named: the legacy filler 30 is written as the filler 10, and the three custom colours are written as the Okabe-Ito colours the rows show (today a non-Kelly palette recolours every row on each `_updateLegendItems`, so a custom colour under Okabe-Ito does not survive a reload).
  - "a numeric record with numericSettings round-trips; a topology mismatch drops hidden values and the manual order".
  - "writes the same key and field set": after a hide, `Object.keys(stored)` equals `['maxVisibleValues','shapeSize','sortMode','hiddenValues','categories','enableDuplicateStackUI','selectedPaletteId']` (categorical) and adds `numericSettings` (numeric).

These are characterization tests: they must pass on the unchanged code. The expectations below were derived by reading `legend.ts` at `7d45ab02`; if one fails on the unchanged code, the code is the truth: correct that expectation to today's output, keep the test's intent, never edit production code in this task, and list each corrected expectation in the report. Correct a value, never delete an assertion or loosen a `toEqual` into a `toContain`; a whole test that cannot be made to pass is reported, not dropped.

- [ ] **Step 1: Write the fixtures module**

Create `packages/core/src/components/legend/test-support/legend-fixtures.ts`:

```ts
import {
  buildStorageKey,
  COLOR_SCHEMES,
  materializeVisualizationData,
  type LegendPersistedSettings,
  type VisualizationData,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, NA_VALUE } from '../config';

/**
 * Shared datasets for the legend's tests: every later legend test builds its data here, so the
 * characterization tests of phase 3 and the redesign tests that follow read the same fixtures.
 * Nothing in production code imports this module.
 */

/**
 * Twelve categories, A…L, with distinct descending counts (12 down to 1). The legend shows ten
 * rows by default, so K and L land in Other; no two counts tie, so the size order is fixed.
 */
export const TWELVE: Readonly<Record<string, number>> = Object.freeze({
  A: 12,
  B: 11,
  C: 10,
  D: 9,
  E: 8,
  F: 7,
  G: 6,
  H: 5,
  I: 4,
  J: 3,
  K: 2,
  L: 1,
});

/**
 * One categorical annotation whose values appear `counts[value]` times, in key order. A
 * `__NA__` key gives that many proteins with no value: their code points past the last value,
 * which the legend counts as N/A.
 */
export function categoricalData(
  counts: Readonly<Record<string, number>>,
  annotation = 'family',
): VisualizationData {
  const values = Object.keys(counts).filter((value) => value !== NA_VALUE);
  const codes: number[] = [];
  for (const [value, count] of Object.entries(counts)) {
    const code = value === NA_VALUE ? values.length : values.indexOf(value);
    for (let i = 0; i < count; i++) codes.push(code);
  }
  return {
    protein_ids: codes.map((_, i) => `p${i + 1}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(codes.length * 2) }],
    annotations: {
      [annotation]: {
        kind: 'categorical',
        values,
        colors: values.map(() => '#888888'),
        shapes: values.map(() => 'circle'),
      },
    },
    annotation_data: { [annotation]: Int32Array.from(codes) },
  };
}

/**
 * One numeric annotation over `values` (`null` is a missing value), binned with the default
 * settings the way the scatterplot hands numeric data to the legend.
 */
export function numericData(
  values: readonly (number | null)[],
  annotation = 'length',
): VisualizationData {
  const raw: VisualizationData = {
    protein_ids: values.map((_, i) => `p${i + 1}`),
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(values.length * 2) }],
    annotations: { [annotation]: { kind: 'numeric', values: [], colors: [], shapes: [] } },
    annotation_data: { [annotation]: new Int32Array(values.length) },
    numeric_annotation_data: {
      [annotation]: Float64Array.from(values, (value) => value ?? Number.NaN),
    },
  };
  return materializeVisualizationData(raw, {}, LEGEND_DEFAULTS.maxVisibleValues, annotation);
}

const OKABE_ITO = COLOR_SCHEMES.okabeIto;

/** The three rows the legacy record's user recoloured and reshaped in the picker. */
const LEGACY_CUSTOM: Readonly<Record<string, { color: string; shape: string }>> = {
  B: { color: '#123456', shape: 'diamond' },
  D: { color: '#abcdef', shape: 'square' },
  F: { color: '#0f0f0f', shape: 'triangle-up' },
};

/**
 * A record as the settings dialog of before phase 3 writes it for `categoricalData(TWELVE)`:
 * "Max legend items" 8 and the Okabe-Ito palette saved (each shown row coloured by its rank),
 * the order reversed with the header button (zOrder 7 - rank, so H comes first), C hidden,
 * then B, D and F given a colour and a shape in the picker. `shapeSize: 30` is the filler older
 * writers emitted, and `includeShapes` is the field today's code reads and never writes.
 */
export function legacyLegendRecord(): LegendPersistedSettings & { includeShapes: boolean } {
  const categories = Object.fromEntries(
    [...'ABCDEFGH'].map((value, rank) => [
      value,
      {
        zOrder: 7 - rank,
        color: LEGACY_CUSTOM[value]?.color ?? OKABE_ITO[rank],
        shape: LEGACY_CUSTOM[value]?.shape ?? 'circle',
      },
    ]),
  );
  return {
    maxVisibleValues: 8,
    shapeSize: 30,
    sortMode: 'manual-reverse',
    hiddenValues: ['C'],
    categories,
    enableDuplicateStackUI: false,
    selectedPaletteId: 'okabeIto',
    includeShapes: true,
  };
}

/** The key the legend stores an annotation's settings under for a dataset. */
export function legendStorageKey(hash: string, annotation: string): string {
  return buildStorageKey('legend', hash, annotation);
}
```

- [ ] **Step 2: Write the DOM contract test**

Create `packages/core/src/components/legend/legend.dom-contract.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

// Hidden values persist per dataset: an in-memory store keeps one test's clicks out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(data: VisualizationData, annotation = 'family'): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settle(legend);
  return legend;
}

const rows = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item'));
const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ten rows by count, N/A (20) first; J, K and L are grouped under Other. */
const SHOWN = ['__NA__', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'Other'];

describe('legend DOM contract', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders each row as a list item directly inside the items list', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const list = legend.shadowRoot!.querySelector<HTMLElement>('.legend-items')!;

    expect(list.getAttribute('part')).toBe('items');
    expect(list.getAttribute('role')).toBe('list');
    expect(rows(legend).map((item) => item.dataset.value)).toEqual(SHOWN);
    for (const item of rows(legend)) {
      // Sortable moves the rows as direct children of the list.
      expect(item.parentElement).toBe(list);
      expect(item.getAttribute('part')).toBe('item');
      expect(item.getAttribute('role')).toBe('listitem');
      expect(item.dataset.displayValue).toBeTruthy();
    }
  });

  it('marks the Other row for the tour and gives it a View button; N/A reads "N/A"', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const other = row(legend, 'Other');

    expect(other.classList.contains('legend-item-other')).toBe(true);
    expect(other.dataset.driverId).toBe('other-row');
    expect(
      other.querySelector<HTMLButtonElement>('button.view-button')!.getAttribute('aria-label'),
    ).toBe('View items grouped under Other');

    const na = row(legend, '__NA__');
    expect(na.dataset.displayValue).toBe('N/A');
    expect(na.querySelector('.legend-text')!.textContent!.trim()).toBe('N/A');
  });

  it('names each main button "{label}: N items, shown|hidden" and toggles .hidden on click', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    for (const item of rows(legend)) {
      const main = item.querySelector<HTMLButtonElement>('button.legend-item-main')!;
      expect(main.getAttribute('aria-pressed')).toBe('true');
      expect(main.getAttribute('aria-label')).toMatch(
        new RegExp(`^${escapeRegExp(item.dataset.displayValue!)}: \\d+ items, (shown|hidden)$`),
      );
    }

    row(legend, 'A')
      .querySelector<HTMLButtonElement>('.legend-item-main')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
    await settle(legend);

    const main = row(legend, 'A').querySelector<HTMLButtonElement>('.legend-item-main')!;
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    expect(main.getAttribute('aria-pressed')).toBe('false');
    expect(main.getAttribute('aria-label')).toBe('A: 12 items, hidden');
  });

  it('keeps the parts and classes the e2e, perf, tour and docs scripts read', async () => {
    const legend = await mount(categoricalData({ ...TWELVE, __NA__: 20 }));
    const root = legend.shadowRoot!;

    expect(root.querySelector('.legend-container')!.getAttribute('part')).toBe('container');
    expect(root.querySelector('.legend-header')!.getAttribute('part')).toBe('header');
    expect(root.querySelector('.legend-title')!.textContent!.trim()).toBe('Family');
    for (const item of rows(legend)) {
      expect(item.querySelector('.legend-text')!.getAttribute('part')).toBe('text');
      expect(item.querySelector('.legend-count')!.getAttribute('part')).toBe('count');
      expect(item.querySelector('[part="symbol"] .legend-symbol path')!.getAttribute('fill')).toBeTruthy();
      expect(item.querySelector('button.drag-handle')).not.toBeNull();
    }
    expect(row(legend, 'A').querySelector('.legend-count')!.textContent!.trim()).toBe('12');

    const otherHandle = row(legend, 'Other').querySelector<HTMLButtonElement>('.drag-handle')!;
    expect(otherHandle.classList.contains('drag-handle-disabled')).toBe(true);
    expect(otherHandle.disabled).toBe(true);
    expect(row(legend, 'A').querySelector('.drag-handle-disabled')).toBeNull();
  });

  it('shows the empty part when there is no data', async () => {
    const legend = document.createElement('protspace-legend');
    document.body.append(legend);
    await legend.updateComplete;

    const empty = legend.shadowRoot!.querySelector('.legend-empty')!;
    expect(empty.getAttribute('part')).toBe('empty');
    expect(empty.textContent!.trim()).toBe('No data available');
  });

  it('adds the predicted-note part for a predicted annotation (Task 3.9 removes it)', async () => {
    const legend = await mount(
      categoricalData({ yes: 3, no: 1 }, 'predicted_membrane'),
      'predicted_membrane',
    );
    const note = legend.shadowRoot!.querySelector('[part="predicted-note"]')!;
    expect(note.textContent!.trim()).toBe('Computationally predicted, not experimentally curated.');
  });
});
```

- [ ] **Step 3: Write the public API test**

Create `packages/core/src/components/legend/legend.api.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import { LegendDataProcessor } from './legend-data-processor';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

/** Public methods (docs/developers/api/index.md) and their arity today. */
const METHODS: Record<string, number> = {
  forceSync: 0,
  getLegendExportData: 0,
  downloadAsImage: 0,
  getAllPersistedSettings: 0,
  setFileSettings: 2,
  clearForNewDataset: 1,
  hasFileSettingsForAnnotation: 1,
  applyShapeSize: 2,
  applyEatSettings: 2,
  setReliabilityState: 1,
};
const GETTERS = ['hasFileSettings', 'reliabilityThreshold', 'pickedShapeSize', 'reliabilityState'];

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settle(legend);
  return legend;
}

describe('legend public API', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(Object.entries(METHODS))('keeps %s with arity %i', (name, arity) => {
    const method = (ProtspaceLegend.prototype as unknown as Record<string, unknown>)[name];
    expect(typeof method).toBe('function');
    expect((method as (...args: unknown[]) => unknown).length).toBe(arity);
  });

  it.each(GETTERS)('keeps the %s getter', (name) => {
    expect(typeof Object.getOwnPropertyDescriptor(ProtspaceLegend.prototype, name)?.get).toBe(
      'function',
    );
  });

  it('dispatches legend-customize from the settings button', async () => {
    const legend = await mount();
    const onCustomize = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.CUSTOMIZE, onCustomize);
    legend.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Legend settings"]')!.click();
    await settle(legend);
    expect(onCustomize).toHaveBeenCalledOnce();
  });

  it('dispatches legend-item-click with the value and the action', async () => {
    const legend = await mount();
    const onItem = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, onItem);
    legend
      .shadowRoot!.querySelector<HTMLElement>('.legend-item[data-value="A"] .legend-item-main')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
    expect(onItem.mock.calls[0][0].detail).toEqual({ value: 'A', action: 'toggle' });
  });

  it('dispatches legend-error when processing the data fails', async () => {
    const legend = await mount();
    const onError = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ERROR, onError);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(LegendDataProcessor, 'processLegendItems').mockImplementation(() => {
      throw new Error('boom');
    });

    legend.maxVisibleValues = 5;
    await settle(legend);

    expect(onError.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({ source: 'data-processing', message: 'Failed to process legend data' }),
    );
  });

  it('dispatches eat-overlay-change when EAT settings are applied', async () => {
    const legend = await mount();
    const onEat = vi.fn();
    legend.addEventListener('eat-overlay-change', onEat);
    legend.applyEatSettings(false, 0.4);
    expect(onEat.mock.calls[0][0].detail).toEqual({
      enabled: false,
      confidenceThreshold: 0.4,
      reliability: { mode: 'atLeast', min: 0.4, max: 1 },
    });
  });

  it('dispatches legend-download from downloadAsImage', async () => {
    const legend = await mount();
    const onDownload = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.DOWNLOAD, onDownload);
    await legend.downloadAsImage();
    expect(onDownload).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Write the header test**

Create `packages/core/src/components/legend/legend.header.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotationLabel,
  DEFAULT_NUMERIC_PALETTE_ID,
  generateDatasetHash,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import {
  categoricalData,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(data: VisualizationData, annotation: string): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settle(legend);
  return legend;
}

const reverseButton = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<HTMLButtonElement>('button.reverse-button')!;
const LENGTHS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('legend header', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('titles the legend with the display name, never the key', async () => {
    const legend = await mount(
      categoricalData({ X: 2, Y: 1 }, 'protein_families'),
      'protein_families',
    );
    const title = legend.shadowRoot!.querySelector('.legend-title')!.textContent!.trim();
    expect(title).toBe(annotationLabel('protein_families'));
    expect(title).toBe('Protein family');
    expect(title).not.toContain('protein_families');
  });

  it('names the reverse button for a categorical annotation', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe(
      'Reverse z-order (keep Other last)',
    );
  });

  it('names the numeric reverse button by the order it switches to', async () => {
    const legend = await mount(numericData(LENGTHS), 'length');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Show high to low');

    reverseButton(legend).click();
    await settle(legend);
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Show low to high');
  });

  it('names it "Reverse manual order" for a numeric manual order', async () => {
    const data = numericData(LENGTHS);
    localStorage.setItem(
      legendStorageKey(generateDatasetHash(data), 'length'),
      JSON.stringify({
        maxVisibleValues: 10,
        shapeSize: 10,
        sortMode: 'manual',
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
        selectedPaletteId: DEFAULT_NUMERIC_PALETTE_ID,
      }),
    );
    const legend = await mount(data, 'length');
    expect(reverseButton(legend).getAttribute('aria-label')).toBe('Reverse manual order');
  });

  it('opens settings from the settings button and focuses the dialog', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const onCustomize = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.CUSTOMIZE, onCustomize);

    legend.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Legend settings"]')!.click();
    await settle(legend);

    expect(onCustomize).toHaveBeenCalledOnce();
    expect(legend.shadowRoot!.activeElement?.id).toBe('legend-settings-dialog');
  });

  it('marks a predicted annotation with the badge and the note', async () => {
    const legend = await mount(
      categoricalData({ yes: 3, no: 1 }, 'predicted_membrane'),
      'predicted_membrane',
    );
    const root = legend.shadowRoot!;
    expect(root.querySelector('.legend-predicted-badge')!.textContent).toContain('Predicted');
    expect(root.querySelector('.legend-predicted-note')!.textContent!.trim()).toBe(
      'Computationally predicted, not experimentally curated.',
    );
    expect(root.querySelector('.legend-header protspace-info-popover')).not.toBeNull();
  });
});
```

- [ ] **Step 5: Write the keyboard reorder test**

Create `packages/core/src/components/legend/legend.keyboard-reorder.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; after a move the legend refocuses the row's handle through it in a
// frame callback, which would otherwise throw outside the test.
vi.stubGlobal('CSS', { escape: (value: string) => value });

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function setup() {
  const { legend, plot } = await mountLegendWithScatterplot(
    categoricalData({ ...TWELVE, __NA__: 20 }),
    'family',
  );
  await settle(legend);
  return { legend, plot };
}

/** A key on a row's drag handle, from the handle, as a keyboard would send it. */
function handleKey(legend: ProtspaceLegend, value: string, key: string): void {
  legend
    .shadowRoot!.querySelector<HTMLButtonElement>(`.legend-item[data-value="${value}"] .drag-handle`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
}

const order = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item')).map(
    (row) => row.dataset.value,
  );
const status = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();
const sortMode = (legend: ProtspaceLegend) => legend.getAllPersistedSettings().family.sortMode;

describe('legend keyboard reorder', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('picks a row up with Space on its handle and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    expect(status(legend)).toBe('Picked up B for reordering');
    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'B', 'C']);
  });

  it('moves the picked row one place, switches to manual and fires one legend-zorder-change', async () => {
    const { legend, plot } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    const onZOrder = vi.fn();
    plot.addEventListener('legend-zorder-change', onZOrder);

    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'C', 'B']);
    expect(sortMode(legend)).toBe('manual');
    expect(onZOrder).toHaveBeenCalledOnce();
    // Task 3.6 changes this line to the display name.
    expect(status(legend)).toBe('Moved B. Switched family to Manual order.');
  });

  it('restores the order and the sort mode on Escape and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    handleKey(legend, 'B', 'Escape');
    await settle(legend);

    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'B', 'C']);
    expect(sortMode(legend)).toBe('size-desc');
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it('drops the row where it is on Enter and announces it', async () => {
    const { legend } = await setup();
    handleKey(legend, 'B', ' ');
    await settle(legend);
    handleKey(legend, 'B', 'ArrowDown');
    await settle(legend);

    handleKey(legend, 'B', 'Enter');
    await settle(legend);

    expect(status(legend)).toBe('Dropped B');
    expect(order(legend).slice(0, 4)).toEqual(['__NA__', 'A', 'C', 'B']);
    expect(sortMode(legend)).toBe('manual');
  });

  it('ignores Space on the Other handle; N/A is picked up like any category', async () => {
    const { legend } = await setup();
    handleKey(legend, 'Other', ' ');
    await settle(legend);
    expect(status(legend)).toBe('');

    handleKey(legend, '__NA__', ' ');
    await settle(legend);
    expect(status(legend)).toBe('Picked up N/A for reordering');
  });
});
```

- [ ] **Step 6: Write the colour picker test**

Create `packages/core/src/components/legend/legend.color-picker.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDatasetHash, type LegendPersistedSettings } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { LEGEND_STYLES, SHAPE_PATH_GENERATORS } from './config';
import {
  categoricalData,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function setup() {
  const data = categoricalData(TWELVE);
  const { legend, plot } = await mountLegendWithScatterplot(data, 'family');
  await settle(legend);
  return { legend, plot, key: legendStorageKey(generateDatasetHash(data), 'family') };
}

const q = <T extends Element = HTMLElement>(legend: ProtspaceLegend, selector: string) =>
  legend.shadowRoot!.querySelector<T>(selector);

async function openPicker(legend: ProtspaceLegend, value: string): Promise<HTMLElement> {
  q<HTMLButtonElement>(legend, `.legend-item[data-value="${value}"] .legend-symbol-button`)!.click();
  await settle(legend);
  return q(legend, '.color-picker-popover')!;
}

function setColour(legend: ProtspaceLegend, color: string): void {
  const input = q<HTMLInputElement>(legend, '.color-picker-swatch')!;
  input.value = color;
  input.dispatchEvent(new Event('input'));
}

const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) ?? 'null') as LegendPersistedSettings | null;

describe('legend colour and shape picker', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it("opens from a categorical row's symbol, headed by the row's label", async () => {
    const { legend } = await setup();
    const picker = await openPicker(legend, 'B');
    expect(picker.querySelector('.color-picker-header')!.textContent!.trim()).toBe('B');
    expect(picker.querySelector('input[type="color"]')!.getAttribute('aria-label')).toBe(
      'Set color for B',
    );
  });

  it('turns three colour inputs within 150 ms into one legend-colormapping-change', async () => {
    const { legend, plot } = await setup();
    await openPicker(legend, 'B');
    vi.useFakeTimers();
    const onMapping = vi.fn();
    plot.addEventListener('legend-colormapping-change', onMapping);

    for (const color of ['#ff0000', '#00ff00', '#0000ff']) {
      setColour(legend, color);
      vi.advanceTimersByTime(40);
    }
    expect(onMapping).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(onMapping).toHaveBeenCalledOnce();
    expect(onMapping.mock.calls[0][0].detail.colorOnly).toBe(true);
  });

  it('stores a shape pick', async () => {
    const { legend, key } = await setup();
    await openPicker(legend, 'B');
    q<HTMLButtonElement>(legend, '.shape-picker-swatch')!.click();
    await settle(legend);
    q<HTMLButtonElement>(legend, '.shape-picker-item[aria-label="Use diamond shape for B"]')!.click();
    await settle(legend);

    expect(stored(key)!.categories.B.shape).toBe('diamond');
    expect(
      q(legend, '.legend-item[data-value="B"] .legend-symbol path')!.getAttribute('d'),
    ).toBe(SHAPE_PATH_GENERATORS.diamond(LEGEND_STYLES.legendDisplaySize));
  });

  it('closes on a press outside and flushes the pending colour', async () => {
    const { legend, plot } = await setup();
    await openPicker(legend, 'B');
    vi.useFakeTimers();
    const onMapping = vi.fn();
    plot.addEventListener('legend-colormapping-change', onMapping);
    setColour(legend, '#ff0000');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(onMapping).toHaveBeenCalledOnce();
    await settle(legend);
    expect(q(legend, '.color-picker-popover')).toBeNull();
  });

  it('stays open when a press starts inside and ends outside', async () => {
    const { legend } = await setup();
    const picker = await openPicker(legend, 'B');

    picker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle(legend);

    expect(q(legend, '.color-picker-popover')).not.toBeNull();
  });

  it('offers no symbol button on numeric rows', async () => {
    const { legend } = await mountLegendWithScatterplot(
      numericData(Array.from({ length: 20 }, (_, i) => i + 1)),
      'length',
    );
    await settle(legend);
    expect(legend.shadowRoot!.querySelectorAll('.legend-item').length).toBeGreaterThan(1);
    expect(legend.shadowRoot!.querySelector('.legend-symbol-button')).toBeNull();
  });
});
```

- [ ] **Step 7: Write the Escape order test**

Create `packages/core/src/components/legend/legend.escape-order.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; the reorder's frame callbacks refocus a handle through it.
vi.stubGlobal('CSS', { escape: (value: string) => value });

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settle(legend);
  return legend;
}

const q = (legend: ProtspaceLegend, selector: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(selector);
const click = (legend: ProtspaceLegend, selector: string) => q(legend, selector)!.click();
const status = (legend: ProtspaceLegend) =>
  q(legend, '[role="status"]')!.textContent!.trim();

function pickUp(legend: ProtspaceLegend, value: string): void {
  q(legend, `.legend-item[data-value="${value}"] .drag-handle`)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true }),
  );
}

/** Escape as the keyboard sends it: from the focused element, through the window. */
function escape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
  );
}

/** What the legend has open: the picker, the Other dialog, the settings dialog. */
const open = (legend: ProtspaceLegend) => ({
  picker: q(legend, '.color-picker-popover') !== null,
  other: q(legend, '#legend-other-dialog') !== null,
  settings: q(legend, '#legend-settings-dialog') !== null,
});

describe('legend Escape order', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('closes the picker, then Other, then cancels a keyboard reorder, one per Escape', async () => {
    const legend = await mount();
    pickUp(legend, 'B');
    await settle(legend);
    click(legend, 'button.view-button');
    await settle(legend);
    click(legend, '.legend-item[data-value="A"] .legend-symbol-button');
    await settle(legend);
    expect(open(legend)).toEqual({ picker: true, other: true, settings: false });
    expect(status(legend)).toBe('Picked up B for reordering');

    escape();
    await settle(legend);
    expect(open(legend)).toEqual({ picker: false, other: true, settings: false });

    escape();
    await settle(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: false });
    expect(status(legend)).toBe('Picked up B for reordering');

    escape();
    await settle(legend);
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it('closes the picker, then Other, then settings, one per Escape', async () => {
    const legend = await mount();
    // Opening settings clears a keyboard reorder, so settings is tested without one.
    click(legend, 'button[aria-label="Legend settings"]');
    await settle(legend);
    click(legend, 'button.view-button');
    await settle(legend);
    click(legend, '.legend-item[data-value="A"] .legend-symbol-button');
    await settle(legend);
    expect(open(legend)).toEqual({ picker: true, other: true, settings: true });

    escape();
    await settle(legend);
    expect(open(legend)).toEqual({ picker: false, other: true, settings: true });

    escape();
    await settle(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: true });

    escape();
    await settle(legend);
    expect(open(legend)).toEqual({ picker: false, other: false, settings: false });
  });

  it('lets Escape through to a document listener when nothing of the legend is open', async () => {
    const legend = await mount();
    const seen: boolean[] = [];
    const onKeyDown = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener('keydown', onKeyDown);
    try {
      escape();
      await settle(legend);
      expect(seen).toEqual([false]);
    } finally {
      document.removeEventListener('keydown', onKeyDown);
    }
  });
});
```

- [ ] **Step 8: Write the persistence compatibility test**

Create `packages/core/src/components/legend/legend.persistence-compat.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR_SCHEMES,
  generateDatasetHash,
  type LegendPersistedSettings,
  type VisualizationData,
} from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';
import { LEGEND_STYLES, SHAPE_PATH_GENERATORS } from './config';
import { defaultShapeSize, SHAPE_SIZE_FILLER } from './legend-helpers';
import {
  categoricalData,
  legacyLegendRecord,
  legendStorageKey,
  numericData,
  TWELVE,
} from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

vi.stubGlobal('localStorage', createLocalStorageMock());

const OKABE_ITO = COLOR_SCHEMES.okabeIto;
const CATEGORICAL_FIELDS = [
  'maxVisibleValues',
  'shapeSize',
  'sortMode',
  'hiddenValues',
  'categories',
  'enableDuplicateStackUI',
  'selectedPaletteId',
];

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(data: VisualizationData, annotation: string): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(data, annotation);
  await settle(legend);
  return legend;
}

const rows = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item'));
const rowValues = (legend: ProtspaceLegend) => rows(legend).map((row) => row.dataset.value!);
const hiddenRows = (legend: ProtspaceLegend) =>
  rows(legend)
    .filter((row) => row.classList.contains('hidden'))
    .map((row) => row.dataset.value!);
const symbolPath = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector(`.legend-item[data-value="${value}"] .legend-symbol path`)!;

/** Hide or show a row with Enter on its main button: one toggle, one save. */
function toggle(legend: ProtspaceLegend, value: string): void {
  legend
    .shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"] .legend-item-main`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) ?? 'null') as LegendPersistedSettings | null;

describe('legend settings stored before phase 3', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads a record written before phase 3 unchanged', async () => {
    const data = categoricalData(TWELVE);
    const key = legendStorageKey(generateDatasetHash(data), 'family');
    const seed = legacyLegendRecord();
    localStorage.setItem(key, JSON.stringify(seed));

    const legend = await mount(data, 'family');

    // Eight rows plus Other, in the stored zOrder (H is 0, A is 7).
    expect(rowValues(legend)).toEqual(['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'Other']);
    expect(legend.maxVisibleValues).toBe(8);
    expect(legend.getAllPersistedSettings().family.sortMode).toBe('manual-reverse');
    expect(hiddenRows(legend)).toEqual(['C']);
    for (const [rank, value] of [...'ABCDEFGH'].entries()) {
      const path = symbolPath(legend, value);
      // Okabe-Ito colours every row by its rank; B, D and F's custom colours give way to it.
      expect(path.getAttribute('fill')).toBe(OKABE_ITO[rank]);
      // Their custom shapes stay.
      expect(path.getAttribute('d')).toBe(
        SHAPE_PATH_GENERATORS[seed.categories[value].shape](LEGEND_STYLES.legendDisplaySize),
      );
    }
    // The legacy 30 reads as unset: the dataset's default applies, nothing is picked.
    const proteins = Object.values(TWELVE).reduce((sum, count) => sum + count, 0);
    expect(legend.shapeSize).toBe(defaultShapeSize(proteins));
    expect(legend.pickedShapeSize).toBeUndefined();

    toggle(legend, 'A');
    toggle(legend, 'A');
    await settle(legend);

    const written = stored(key)!;
    expect(Object.keys(written).sort()).toEqual([...CATEGORICAL_FIELDS].sort());
    expect(written.maxVisibleValues).toBe(seed.maxVisibleValues);
    // 30, the old filler, is written as today's filler: both read as unset.
    expect(written.shapeSize).toBe(SHAPE_SIZE_FILLER);
    expect(written.sortMode).toBe(seed.sortMode);
    expect(written.hiddenValues).toEqual(seed.hiddenValues);
    expect(written.enableDuplicateStackUI).toBe(seed.enableDuplicateStackUI);
    expect(written.selectedPaletteId).toBe(seed.selectedPaletteId);
    // Same zOrders and shapes; every colour is the Okabe-Ito colour the row shows.
    expect(written.categories).toEqual(
      Object.fromEntries(
        [...'ABCDEFGH'].map((value, rank) => [
          value,
          { ...seed.categories[value], color: OKABE_ITO[rank] },
        ]),
      ),
    );
  });

  it('round-trips a numeric record with numericSettings; a topology mismatch drops hidden values and the manual order', async () => {
    const data = numericData(Array.from({ length: 20 }, (_, i) => i + 1));
    const key = legendStorageKey(generateDatasetHash(data), 'length');

    let legend = await mount(data, 'length');
    const bins = rowValues(legend);
    expect(bins.length).toBeGreaterThan(1);
    toggle(legend, bins[0]);
    await settle(legend);
    const written = stored(key)!;
    expect(written.hiddenValues).toEqual([bins[0]]);
    expect(written.numericSettings?.signature).toEqual(expect.any(String));
    expect(written.numericSettings?.topologySignature).toEqual(expect.any(String));

    // A fresh legend reads the record into the same state and writes it back unchanged.
    document.body.innerHTML = '';
    legend = await mount(data, 'length');
    expect(rowValues(legend)).toEqual(bins);
    expect(hiddenRows(legend)).toEqual([bins[0]]);
    toggle(legend, bins[1]);
    toggle(legend, bins[1]);
    await settle(legend);
    expect(stored(key)).toEqual(written);

    // A record binned another way keeps its sort mode but not its hidden bins or manual order.
    document.body.innerHTML = '';
    localStorage.setItem(
      key,
      JSON.stringify({
        ...written,
        sortMode: 'manual',
        numericSettings: {
          ...written.numericSettings,
          signature: 'stale-signature',
          topologySignature: 'stale-topology',
          manualOrderIds: [...bins].reverse(),
        },
      }),
    );
    legend = await mount(data, 'length');
    expect(hiddenRows(legend)).toEqual([]);
    expect(rowValues(legend)).toEqual(bins);
  });

  it('writes the same key and field set', async () => {
    const categorical = categoricalData(TWELVE);
    const categoricalKey = legendStorageKey(generateDatasetHash(categorical), 'family');
    let legend = await mount(categorical, 'family');
    expect(localStorage.getItem(categoricalKey)).toBeNull();
    toggle(legend, 'A');
    await settle(legend);
    expect(Object.keys(stored(categoricalKey)!)).toEqual(CATEGORICAL_FIELDS);

    document.body.innerHTML = '';
    const numeric = numericData(Array.from({ length: 20 }, (_, i) => i + 1));
    const numericKey = legendStorageKey(generateDatasetHash(numeric), 'length');
    legend = await mount(numeric, 'length');
    toggle(legend, rowValues(legend)[0]);
    await settle(legend);
    expect(Object.keys(stored(numericKey)!)).toEqual([...CATEGORICAL_FIELDS, 'numericSettings']);
  });
});
```

- [ ] **Step 9: Run the new tests on today's code**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.dom-contract.test.ts src/components/legend/legend.api.test.ts src/components/legend/legend.header.test.ts src/components/legend/legend.keyboard-reorder.test.ts src/components/legend/legend.color-picker.test.ts src/components/legend/legend.escape-order.test.ts src/components/legend/legend.persistence-compat.test.ts`

Expected: PASS, 7 files, 48 tests (6 + 19 + 6 + 5 + 6 + 3 + 3). These are characterization tests, so they pass without a code change; nothing in `packages/core/src` other than the new files is edited. If an assertion fails, read the failure against the code path named in the test (for example `_applyPaletteColors` for the colours, `_canDragLegendItem` for the handles), correct the expectation to today's output, re-run, and list the correction in the report. An unhandled error from a frame callback (`CSS is not defined`) means a file that moves rows lacks the `vi.stubGlobal('CSS', …)` line.

- [ ] **Step 10: Run the full legend and style suites**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/styles`
Expected: PASS; the counts of the existing files are unchanged and the seven new files add 48 tests.

Then: `pnpm type-check && pnpm lint && pnpm exec knip`
Expected: PASS (each fixture export has a consumer among the new tests; test files are outside core's `tsconfig`, so `type-check` covers only the fixtures module).

Then: `pnpm exec prettier --check packages/core/src/components/legend/test-support/legend-fixtures.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.api.test.ts packages/core/src/components/legend/legend.header.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.escape-order.test.ts packages/core/src/components/legend/legend.persistence-compat.test.ts`
Expected: no warnings (run `pnpm exec prettier --write` on the same paths first if it reports any).

Report the core unit counts before and after and `wc -l packages/core/src/components/legend/legend.ts` (3299, unchanged).

- [ ] **Step 11: Commit**

The hook needs network and writes outside the sandbox, so commit with the sandbox disabled.

```bash
git add packages/core/src/components/legend/test-support/legend-fixtures.ts \
  packages/core/src/components/legend/legend.dom-contract.test.ts \
  packages/core/src/components/legend/legend.api.test.ts \
  packages/core/src/components/legend/legend.header.test.ts \
  packages/core/src/components/legend/legend.keyboard-reorder.test.ts \
  packages/core/src/components/legend/legend.color-picker.test.ts \
  packages/core/src/components/legend/legend.escape-order.test.ts \
  packages/core/src/components/legend/legend.persistence-compat.test.ts
git commit -m "test(core): pin the legend's DOM, API and settings before the split"
```

---

### Task 3.2: Split the header, row, list and score-strip templates out of the legend

Pure moves of templates that cannot change behaviour. `LegendRenderer`'s static methods and the template parts of `legend.ts` (`render()` 2775–2822, `_renderLegendItem` 3014–3047, the score strips 2874–3013) move to four render modules whose functions take explicit view models and handlers. `legend-renderer.ts` is deleted. Every test from 3.1 and every existing legend test passes unchanged.

**Files:**

- Create: `packages/core/src/components/legend/legend-header.ts`, `legend-row.ts`, `legend-list.ts`, `legend-score-strips.ts`, `legend-score-strips.test.ts` (unit), `legend-row.test.ts` (unit; not in the skeleton: knip runs with `ignoreExportsUsedInFile: false`, so `renderLegendSymbol`, which only 3.4/3.6 import, needs a consumer in this commit)
- Modify: `legend.ts` (imports, `render()`, `_renderLegendItem`, score-strip members 2874–3013)
- Delete: `legend-renderer.ts`

**Interfaces:**

- Consumes: `LegendItem`, `LegendSortMode`, `CategoryScore`, `ScoreStripPoint`, `LEGEND_STYLES`, `LEGEND_DEFAULTS`, `LEGEND_VALUES`, `SHAPE_PATH_GENERATORS`, `toDisplayValue`, `metricDisplay`, `AUTO_CLUSTER_SCORE_CAVEAT`.
- Produces:
  - `legend-header.ts`: `interface LegendHeaderView { title: string; predicted: boolean; info?: TemplateResult; reverseLabel: string }`; `interface LegendHeaderActions { onReverse(): void; onCustomize(): void }`; `renderLegendHeader(view: LegendHeaderView, actions: LegendHeaderActions): TemplateResult` (today's markup, badge, note and part names); `legendReverseLabel(isNumeric: boolean, sortMode: LegendSortMode): string` (the four labels of `render()` 2801–2808).
  - `legend-row.ts`: `renderLegendSymbol(shape: string | null, color: string, size?: number, selected?: boolean): TemplateResult` (was `LegendRenderer.renderSymbol`); `interface LegendRowView { classes: string; selected: boolean; symbolSize: number; otherCount?: number; index: number; draggable: boolean }`; `interface LegendRowHandlers { onClick(e: MouseEvent): void; onDoubleClick(): void; onViewOther(e: Event): void; onKeyDown(e: KeyboardEvent): void; onHandleKeyDown(e: KeyboardEvent): void; onHover(category: string | null): void; onSymbolClick?(e: MouseEvent): void }`; `renderLegendRow(item: LegendItem, view: LegendRowView, handlers: LegendRowHandlers): TemplateResult` (today's row markup byte for byte).
  - `legend-list.ts`: `renderLegendList(items: readonly LegendItem[], renderRow: (item: LegendItem, index: number) => TemplateResult): TemplateResult` (the `.legend-items` list or the `.legend-empty` "No data available").
  - `legend-score-strips.ts`: `interface StripPoints { silhouette: ScoreStripPoint[]; daviesBouldin: ScoreStripPoint[]; daviesBouldinDomain: [number, number] }`; `EMPTY_STRIP_POINTS: StripPoints`; `deriveStripPoints(items: readonly LegendItem[], scores: readonly CategoryScore[]): StripPoints`; `interface ScoreStripsView { hasScores: boolean; filtered: boolean; points: StripPoints; highlighted: string | null; clusterCaveat: boolean }`; `interface ScoreStripsHandlers { onHover(category: string | null): void; onToggle(category: string): void }`; `renderScoreStrips(view: ScoreStripsView, handlers: ScoreStripsHandlers): TemplateResult | typeof nothing`. The module imports `./category-score-strip` (it renders `protspace-score-strip`), so `legend.ts` no longer does.
  - `legend.ts` keeps `_hoveredCategory`, `_setHoveredCategory`, a `_stripPoints: StripPoints` plain field written in `willUpdate` when `_legendItems` or `_categoryScores` change (as today), and the `strip-click` guard (only a category that is a legend row toggles), now in a `_scoreStripHandlers: ScoreStripsHandlers` field; the header's handlers live in a `_headerActions: LegendHeaderActions` field, built once.

**Tests:**

- `legend-score-strips.test.ts` (unit): "derives one point per scored category in the row's colour, grey for a category in Other"; "Davies-Bouldin's domain spans its points, [0, 1] with none"; "skips null scores".
- `legend-row.test.ts` (unit): "draws the item's shape filled with its colour at the size asked for"; "falls back to a circle and grey for a missing shape and colour". It asserts only the path and its fill, which Task 3.6's 10 px redesign keeps (it passes the size explicitly).
- Every legend test passes unchanged, Task 3.1's included; `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`.
- `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=legend-double-click --project=numeric-binning` and `pnpm perf:counts` pass.

Line numbers are from `7d45ab02`; Task 3.1 adds only test files, so they still hold. Anchor each edit on the quoted text.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/legend/legend-score-strips.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CategoryScore } from '@protspace/utils';
import { deriveStripPoints, EMPTY_STRIP_POINTS } from './legend-score-strips';
import type { LegendItem } from './types';

const item = (value: string, color: string): LegendItem => ({
  value,
  color,
  shape: 'circle',
  count: 1,
  isVisible: true,
  zOrder: 0,
});

const score = (
  category: string,
  silhouette: number | null,
  daviesBouldin: number | null,
  silhouetteEmbedding: number | null = null,
): CategoryScore => ({ category, silhouette, daviesBouldin, silhouetteEmbedding });

describe('deriveStripPoints', () => {
  it("derives one point per scored category in the row's colour, grey for a category in Other", () => {
    const points = deriveStripPoints(
      [item('A', '#ff0000'), item('Other', '#888888')],
      [score('A', 0.5, 1.2, 0.4), score('Z', -0.2, 2)],
    );

    expect(points.silhouette).toEqual([
      { category: 'A', value: 0.5, color: '#ff0000', embedding: 0.4 },
      { category: 'Z', value: -0.2, color: '#888', embedding: null },
    ]);
    // Davies-Bouldin has no embedding-space counterpart.
    expect(points.daviesBouldin).toEqual([
      { category: 'A', value: 1.2, color: '#ff0000', embedding: null },
      { category: 'Z', value: 2, color: '#888', embedding: null },
    ]);
  });

  it("spans Davies-Bouldin's domain over its points, [0, 1] with none", () => {
    expect(
      deriveStripPoints([], [score('A', 0.1, 3), score('B', 0.2, 0.5)]).daviesBouldinDomain,
    ).toEqual([0.5, 3]);
    expect(deriveStripPoints([], [score('A', 0.1, null)]).daviesBouldinDomain).toEqual([0, 1]);
    expect(EMPTY_STRIP_POINTS).toEqual({
      silhouette: [],
      daviesBouldin: [],
      daviesBouldinDomain: [0, 1],
    });
  });

  it('skips null scores', () => {
    const points = deriveStripPoints(
      [item('A', '#ff0000')],
      [score('A', null, 1), score('B', 0.3, null)],
    );
    expect(points.silhouette.map((point) => point.category)).toEqual(['B']);
    expect(points.daviesBouldin.map((point) => point.category)).toEqual(['A']);
  });
});
```

Create `packages/core/src/components/legend/legend-row.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import { SHAPE_PATH_GENERATORS } from './config';
import { renderLegendSymbol } from './legend-row';

function draw(...args: Parameters<typeof renderLegendSymbol>): SVGPathElement {
  const host = document.createElement('div');
  render(renderLegendSymbol(...args), host);
  return host.querySelector<SVGPathElement>('svg.legend-symbol path')!;
}

describe('renderLegendSymbol', () => {
  it("draws the item's shape filled with its colour at the size asked for", () => {
    const path = draw('diamond', '#123456', 16);
    expect(path.getAttribute('d')).toBe(SHAPE_PATH_GENERATORS.diamond(16));
    expect(path.getAttribute('fill')).toBe('#123456');
    expect(path.closest('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a circle and grey for a missing shape and colour', () => {
    const path = draw(null, '', 12);
    expect(path.getAttribute('d')).toBe(SHAPE_PATH_GENERATORS.circle(12));
    expect(path.getAttribute('fill')).toBe('#888888');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-score-strips.test.ts src/components/legend/legend-row.test.ts`
Expected: FAIL: `Failed to resolve import "./legend-score-strips"` and `Failed to resolve import "./legend-row"` (the modules do not exist yet).

- [ ] **Step 3: Create the header module**

Create `packages/core/src/components/legend/legend-header.ts` (the markup of `LegendRenderer.renderHeader`, unchanged):

```ts
import { html, nothing, type TemplateResult } from 'lit';
import type { LegendSortMode } from './types';

/** What the header shows. */
export interface LegendHeaderView {
  /** The annotation's display name, or "Legend" with no annotation. */
  title: string;
  /** A predicted annotation: shows the badge and the note line. */
  predicted: boolean;
  /** The annotation's documentation popover, when it has any. */
  info?: TemplateResult;
  /** The reverse button's accessible name, from `legendReverseLabel`. */
  reverseLabel: string;
}

/** What the header's buttons do. */
export interface LegendHeaderActions {
  onReverse(): void;
  onCustomize(): void;
}

const PREDICTED_NOTE = 'Computationally predicted, not experimentally curated.';

/**
 * The reverse button's name. A categorical legend reverses its rows and keeps Other last; a
 * numeric one flips between low-to-high and high-to-low, or reverses a manual order.
 */
export function legendReverseLabel(isNumeric: boolean, sortMode: LegendSortMode): string {
  if (!isNumeric) return 'Reverse z-order (keep Other last)';
  if (sortMode.startsWith('manual')) return 'Reverse manual order';
  return sortMode === 'alpha-desc' ? 'Show low to high' : 'Show high to low';
}

/**
 * The legend header: title, the "⚡ Predicted" badge and the info popover, then the reverse and
 * settings buttons; a predicted annotation adds a note line beneath the header.
 */
export function renderLegendHeader(
  view: LegendHeaderView,
  actions: LegendHeaderActions,
): TemplateResult {
  return html`
    <div class="legend-header" part="header">
      <div class="legend-title-row">
        <h3 class="legend-title">${view.title}</h3>
        ${view.predicted
          ? html`<span
              class="legend-predicted-badge"
              title="Computationally predicted, not experimentally curated"
              >⚡ Predicted</span
            >`
          : nothing}
        ${view.info ?? nothing}
      </div>
      <div class="legend-header-actions">
        <button
          class="btn-icon customize-button reverse-button"
          title=${view.reverseLabel}
          aria-label=${view.reverseLabel}
          @click=${actions.onReverse}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16V4m0 0L3 8m4-4l4 4m6-2v12m0 0l4-4m-4 4l-4-4"
            />
          </svg>
        </button>
        <button
          class="btn-icon customize-button"
          title="Legend settings"
          aria-label="Legend settings"
          @click=${actions.onCustomize}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </div>
    ${view.predicted
      ? html`<p class="legend-predicted-note" part="predicted-note">${PREDICTED_NOTE}</p>`
      : nothing}
  `;
}
```

- [ ] **Step 4: Create the row module**

Create `packages/core/src/components/legend/legend-row.ts` (the rest of `LegendRenderer`, unchanged; the class's static helpers become module functions):

```ts
import { html, nothing, type TemplateResult } from 'lit';
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
import type { LegendItem } from './types';

/** What a row shows besides its item. */
export interface LegendRowView {
  /** The row's class list: `getItemClasses` plus the score-hover class. */
  classes: string;
  selected: boolean;
  /** The legend symbol's size in px. */
  symbolSize: number;
  /** How many categories the Other row groups; undefined on every other row. */
  otherCount?: number;
  /** The row's place in display order; the first row's main button is the tab stop. */
  index: number;
  /** Whether the row's handle can move it (every row but Other). */
  draggable: boolean;
}

/** What a row's controls do. */
export interface LegendRowHandlers {
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onViewOther(e: Event): void;
  onKeyDown(e: KeyboardEvent): void;
  onHandleKeyDown(e: KeyboardEvent): void;
  onHover(category: string | null): void;
  /** Opens the colour and shape picker; absent for Other and for numeric rows. */
  onSymbolClick?(e: MouseEvent): void;
}

/**
 * Render a symbol using custom SVG paths that match WebGL shader geometry.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
  selected: boolean = false,
): TemplateResult {
  // Add padding to accommodate shapes that extend beyond circles
  const padding = 6;
  const canvasSize = size + padding * 2;
  const centerOffset = canvasSize / 2;

  // Safely handle null or undefined shape
  const shapeKey = (shape || 'circle').toLowerCase();

  // Get the path generator (default to circle if not found)
  const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;

  // Generate the SVG path
  const path = pathGenerator(size);

  // Some symbol types should be rendered as outlines only (plus sign)
  const isOutlineOnly = LEGEND_STYLES.outlineShapes.has(shapeKey);

  // Determine stroke width based on selection state
  const strokeWidth = selected
    ? LEGEND_STYLES.strokeWidth.selected
    : LEGEND_STYLES.strokeWidth.default;

  // Determine stroke color based on selection state
  const strokeColor = selected
    ? LEGEND_STYLES.colors.selectedStroke
    : LEGEND_STYLES.colors.defaultStroke;

  // Ensure we have a valid color
  const validColor = color || '#888888';

  return html`
    <svg
      width="${canvasSize}"
      height="${canvasSize}"
      viewBox="0 0 ${canvasSize} ${canvasSize}"
      class="legend-symbol"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(${centerOffset}, ${centerOffset})">
        <path
          d="${path}"
          fill="${isOutlineOnly ? 'none' : validColor}"
          stroke="${isOutlineOnly ? validColor : strokeColor}"
          stroke-width="${isOutlineOnly ? LEGEND_STYLES.strokeWidth.outline : strokeWidth}"
        />
      </g>
    </svg>
  `;
}

/**
 * Render the drag handle icon
 */
function renderDragHandle(
  enabled: boolean,
  itemLabel: string,
  onKeyDown: (e: KeyboardEvent) => void,
): TemplateResult {
  const ariaLabel = enabled ? `Reorder ${itemLabel}` : `${itemLabel} cannot be reordered`;
  return html`
    <button
      type="button"
      class="drag-handle ${enabled ? '' : 'drag-handle-disabled'}"
      ?disabled=${!enabled}
      aria-label=${ariaLabel}
      @click=${(e: Event) => e.stopPropagation()}
      @mousedown=${(e: Event) => e.stopPropagation()}
      @keydown=${(e: KeyboardEvent) => {
        e.stopPropagation();
        onKeyDown(e);
      }}
    >
      <svg
        width="16"
        height="16"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" />
      </svg>
    </button>
  `;
}

/**
 * Render the item symbol (either "Other" default or annotation-specific symbol)
 */
function renderItemSymbol(
  item: LegendItem,
  isItemSelected: boolean,
  size: number,
  onSymbolClick?: (e: MouseEvent) => void,
): TemplateResult {
  // Always render the item's stored shape. Categories default to circle;
  // user-assigned shapes flow through unchanged.
  const symbolContent =
    item.value === LEGEND_VALUES.OTHER
      ? renderLegendSymbol('circle', '#888', size)
      : renderLegendSymbol(item.shape, item.color, size, isItemSelected);

  if (onSymbolClick) {
    return html`
      <button
        type="button"
        class="mr-2 legend-symbol-button legend-symbol-clickable"
        part="symbol"
        aria-label=${`Customize ${toDisplayValue(item.value)}`}
        @click=${onSymbolClick}
      >
        ${symbolContent}
      </button>
    `;
  }

  return html` <div class="mr-2" part="symbol">${symbolContent}</div> `;
}

/**
 * Render the item text label.
 * N/A items have '__NA__' as value and display as 'N/A'.
 */
function renderItemText(item: LegendItem, otherItemsCount?: number): TemplateResult {
  const displayText = item.displayValue ?? toDisplayValue(item.value, otherItemsCount);
  return html`<span class="legend-text" part="text">${displayText}</span>`;
}

/**
 * Render item actions (like "view" button for "Other" category)
 */
function renderItemActions(item: LegendItem, onViewOther: (e: Event) => void): TemplateResult {
  if (item.value === LEGEND_VALUES.OTHER) {
    return html`
      <span class="legend-item-actions">
        <button
          class="btn-link view-button"
          @click=${onViewOther}
          title="View items grouped under Other"
          aria-label="View items grouped under Other"
        >
          View
        </button>
      </span>
    `;
  }

  return html``;
}

/**
 * Render a complete legend item.
 * N/A items have '__NA__' as value and display as 'N/A'.
 */
export function renderLegendRow(
  item: LegendItem,
  view: LegendRowView,
  handlers: LegendRowHandlers,
): TemplateResult {
  const displayLabel = item.displayValue ?? toDisplayValue(item.value);

  return html`
    <div
      class="${view.classes}"
      part="item"
      role="listitem"
      data-value="${item.value}"
      data-display-value="${displayLabel}"
      data-driver-id=${item.value === LEGEND_VALUES.OTHER ? 'other-row' : nothing}
      @mouseenter=${() => handlers.onHover(item.value)}
      @mouseleave=${() => handlers.onHover(null)}
    >
      <div class="legend-item-content">
        ${renderDragHandle(view.draggable, displayLabel, handlers.onHandleKeyDown)}
        ${renderItemSymbol(item, view.selected, view.symbolSize, handlers.onSymbolClick)}
        <button
          type="button"
          class="legend-item-main"
          aria-label="${displayLabel}: ${item.count} items, ${item.isVisible ? 'shown' : 'hidden'}"
          aria-pressed="${item.isVisible ? 'true' : 'false'}"
          tabindex="${view.index === 0 ? '0' : '-1'}"
          @click=${handlers.onClick}
          @dblclick=${handlers.onDoubleClick}
          @keydown=${handlers.onKeyDown}
        >
          ${renderItemText(item, view.otherCount)}
        </button>
        ${renderItemActions(item, handlers.onViewOther)}
      </div>
      <span class="legend-count" part="count">${item.count}</span>
    </div>
  `;
}
```

- [ ] **Step 5: Create the list module**

Create `packages/core/src/components/legend/legend-list.ts`:

```ts
import { html, type TemplateResult } from 'lit';
import type { LegendItem } from './types';

/**
 * The rows in display order, or the empty state when there are none. The rows are the list's
 * direct children: Sortable moves them, and `role="listitem"` needs the list as parent.
 */
export function renderLegendList(
  items: readonly LegendItem[],
  renderRow: (item: LegendItem, index: number) => TemplateResult,
): TemplateResult {
  if (items.length === 0) {
    return html`<div class="legend-empty" part="empty">No data available</div>`;
  }

  return html`
    <div class="legend-items" part="items" role="list" aria-label="Legend items">
      ${items.map((item, index) => renderRow(item, index))}
    </div>
  `;
}
```

- [ ] **Step 6: Create the score-strips module**

Create `packages/core/src/components/legend/legend-score-strips.ts` (`_deriveStripPoints`, `_stripPoints`, `_renderScoreStrips` and `_renderScoreStrip` of `legend.ts`, unchanged in behaviour):

```ts
import { html, nothing, type TemplateResult } from 'lit';
import { AUTO_CLUSTER_SCORE_CAVEAT, metricDisplay, type CategoryScore } from '@protspace/utils';
import './category-score-strip';
import type { ScoreStripPoint } from './category-score-strip';
import type { LegendItem } from './types';

/** A scored category grouped under Other has no row colour; its dot is grey. */
const OTHER_POINT_COLOR = '#888';

/** The dots of both strips and the Davies-Bouldin axis. */
export interface StripPoints {
  silhouette: ScoreStripPoint[];
  daviesBouldin: ScoreStripPoint[];
  daviesBouldinDomain: [number, number];
}

export const EMPTY_STRIP_POINTS: StripPoints = {
  silhouette: [],
  daviesBouldin: [],
  daviesBouldinDomain: [0, 1],
};

/** What the strips show. */
export interface ScoreStripsView {
  /** The annotation was scored; without scores nothing renders. */
  hasScores: boolean;
  /** The view shows a subset (a filter or an isolation): the strips step aside with a note. */
  filtered: boolean;
  points: StripPoints;
  /** The category under the pointer, from a row or a strip. */
  highlighted: string | null;
  /** The annotation is an auto-clustering column, whose scores are optimistic. */
  clusterCaveat: boolean;
}

/** What a strip's pointer events do. */
export interface ScoreStripsHandlers {
  onHover(category: string | null): void;
  onToggle(category: string): void;
}

/**
 * Dots for one metric, in the legend's own colours so the mapping to rows is legible before any
 * hover happens. A category swept into the "Other" bucket still gets a dot, greyed: the scores
 * are computed over the whole dataset regardless of what the legend chooses to show, and dropping
 * those dots would misstate the distribution.
 */
function stripPoints(
  colorByValue: Map<string, string>,
  scores: readonly CategoryScore[],
  pick: (score: CategoryScore) => number | null,
  pickEmbedding?: (score: CategoryScore) => number | null,
): ScoreStripPoint[] {
  const points: ScoreStripPoint[] = [];
  for (const score of scores) {
    const value = pick(score);
    if (value === null) continue;
    points.push({
      category: score.category,
      value,
      color: colorByValue.get(score.category) ?? OTHER_POINT_COLOR,
      embedding: pickEmbedding?.(score) ?? null,
    });
  }
  return points;
}

/**
 * Strip geometry. The legend derives it in `willUpdate`, not in render: it depends only on the
 * legend items and the scores, while the most frequent cause of a legend re-render is a hover,
 * which changes neither.
 */
export function deriveStripPoints(
  items: readonly LegendItem[],
  scores: readonly CategoryScore[],
): StripPoints {
  // One map for both strips: it is keyed by the same legend items either way.
  const colorByValue = new Map(items.map((item) => [item.value, item.color]));
  // Davies-Bouldin has no embedding-space counterpart on CategoryScore, so only the
  // silhouette strip's tooltip carries an embedding reference.
  const silhouette = stripPoints(
    colorByValue,
    scores,
    (score) => score.silhouette,
    (score) => score.silhouetteEmbedding,
  );
  const daviesBouldin = stripPoints(colorByValue, scores, (score) => score.daviesBouldin);
  // Silhouette is bounded to [-1, 1], so its axis is fixed and comparable across datasets.
  // Davies-Bouldin is unbounded above, so it scales to the data at hand. Folded rather than
  // spread into Math.min/max: the argument list would grow with the category count, and a
  // high-cardinality annotation would blow the call-argument limit.
  let low = Infinity;
  let high = -Infinity;
  for (const point of daviesBouldin) {
    if (point.value < low) low = point.value;
    if (point.value > high) high = point.value;
  }
  return {
    silhouette,
    daviesBouldin,
    daviesBouldinDomain: daviesBouldin.length > 0 ? [low, high] : [0, 1],
  };
}

/**
 * One metric's strip. Name and optimisation direction come from `metricDisplay`, the same entry
 * the metadata panel's rows read, so the two panels cannot name a metric differently and a
 * metric added to that map arrives here already labelled.
 */
function renderScoreStrip(
  metric: string,
  points: ScoreStripPoint[],
  domain: [number, number],
  highlighted: string | null,
): TemplateResult {
  const { label, higherIsBetter, description } = metricDisplay(metric);
  return html`
    <protspace-score-strip
      label=${label}
      .description=${description}
      .higherIsBetter=${higherIsBetter}
      .points=${points}
      .domain=${domain}
      .highlighted=${highlighted}
    ></protspace-score-strip>
  `;
}

/**
 * The separation strips. Nothing when the annotation was never scored or the bundle carries no
 * statistics. While the view shows a subset the numbers, which describe the whole dataset and do
 * not recompute, would misdescribe what is on screen, so the strips step aside and say so.
 */
export function renderScoreStrips(
  view: ScoreStripsView,
  handlers: ScoreStripsHandlers,
): TemplateResult | typeof nothing {
  if (!view.hasScores) return nothing;
  if (view.filtered) {
    return html`<p class="score-strips-note">
      Separation scores are hidden while the view is filtered.
    </p>`;
  }

  const { silhouette, daviesBouldin, daviesBouldinDomain } = view.points;
  // The caveat is stated here rather than only in the projection-metadata panel: this is where
  // the per-category numbers are actually read, and a user hovering rows may never open that
  // panel.
  return html`
    <section
      class="score-strips"
      aria-label="Separation by category"
      @strip-hover=${(event: CustomEvent<{ category: string | null }>) =>
        handlers.onHover(event.detail.category)}
      @strip-click=${(event: CustomEvent<{ category: string }>) =>
        handlers.onToggle(event.detail.category)}
    >
      ${renderScoreStrip('silhouette', silhouette, [-1, 1], view.highlighted)}
      ${daviesBouldin.length > 0
        ? renderScoreStrip('davies_bouldin', daviesBouldin, daviesBouldinDomain, view.highlighted)
        : nothing}
      ${view.clusterCaveat
        ? html`<p class="score-strips-caveat">${AUTO_CLUSTER_SCORE_CAVEAT}</p>`
        : nothing}
    </section>
  `;
}
```

- [ ] **Step 7: Rewire `legend.ts`**

Apply these edits to `packages/core/src/components/legend/legend.ts`.

7a. In the `@protspace/utils` import (lines 5–36), delete the two lines

```ts
  metricDisplay,
  AUTO_CLUSTER_SCORE_CAVEAT,
```

7b. Replace

```ts
import { legendStyles } from './legend.styles';
import '../common/info-popover';
import './category-score-strip';
import type { ScoreStripPoint } from './category-score-strip';
```

with

```ts
import { legendStyles } from './legend.styles';
import '../common/info-popover';
```

7c. Replace

```ts
import { LegendRenderer } from './legend-renderer';
```

with

```ts
import {
  legendReverseLabel,
  renderLegendHeader,
  type LegendHeaderActions,
  type LegendHeaderView,
} from './legend-header';
import { renderLegendRow, type LegendRowHandlers, type LegendRowView } from './legend-row';
import { renderLegendList } from './legend-list';
import {
  deriveStripPoints,
  EMPTY_STRIP_POINTS,
  renderScoreStrips,
  type ScoreStripsHandlers,
  type ScoreStripsView,
  type StripPoints,
} from './legend-score-strips';
```

7d. In `render()`, after the line

```ts
    const hasDocs = !!meta && (meta.description.length > 0 || !!meta.docsUrl);
```

insert

```ts
    const header: LegendHeaderView = {
      title,
      predicted,
      info:
        meta && hasDocs
          ? html`<protspace-info-popover
              .description=${meta.description}
              docs-url=${meta.docsUrl ?? ''}
              label=${title}
            ></protspace-info-popover>`
          : undefined,
      reverseLabel: legendReverseLabel(this._isNumericAnnotation(), this._currentSortMode),
    };
```

7e. In `render()`, replace the whole `LegendRenderer.renderHeader(...)` call (lines 2797–2824, from `${LegendRenderer.renderHeader(` to its closing `)}`) with

```ts
        ${renderLegendHeader(header, this._headerActions)}
```

7f. In `render()`, replace

```ts
        ${LegendRenderer.renderLegendContent(this._sortedLegendItems, (item, index) =>
          this._renderLegendItem(item, index),
        )}
```

with

```ts
        ${renderLegendList(this._sortedLegendItems, (item, index) =>
          this._renderLegendItem(item, index),
        )}
```

7g. Replace everything from the comment that opens `   * Dots for one metric, in the legend's own colours so the mapping to rows is legible` (the `  /**` on line 2883, right after `_setHoveredCategory`) down to and including the closing `  }` of `_renderLegendItem` (line 3047, just before `  private _renderOtherDialog() {`) with:

```ts
  /** The header's buttons. Built once: their handlers never change. */
  private _headerActions: LegendHeaderActions = {
    onReverse: () => this._toggleLegendOrderDirection(),
    onCustomize: () => this._handleCustomize(),
  };

  /**
   * Strip geometry, derived in `willUpdate` rather than in render: it depends only on the legend
   * items and the scores, while the most frequent cause of a legend re-render is a hover, which
   * changes neither. A plain field, not `@state`: it is computed before render from properties
   * that are already reactive, so making it reactive would only add a second update cycle.
   * Written in `willUpdate` and not `updated()` for the same reason -- after render it would
   * paint one cycle stale.
   */
  private _stripPoints: StripPoints = EMPTY_STRIP_POINTS;

  /**
   * A hover on a strip lights its row; a click on a dot toggles its category, but only one that
   * is a legend row: a category grouped under Other has no row to hide.
   */
  private _scoreStripHandlers: ScoreStripsHandlers = {
    onHover: (category) => this._setHoveredCategory(category),
    onToggle: (category) => {
      if (this._legendItems.some((item) => item.value === category)) {
        this._handleItemClick(category);
      }
    },
  };

  protected willUpdate(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has('_legendItems') || changedProperties.has('_categoryScores')) {
      this._stripPoints = deriveStripPoints(this._legendItems, this._categoryScores);
    }
  }

  private _renderScoreStrips() {
    const view: ScoreStripsView = {
      hasScores: this._categoryScores.length > 0,
      // Gated on the live filter/isolation state directly, which is the actual question -- the
      // scores themselves are read from the unsliced dataset (see `_handleScatterplotDataChange`)
      // and so stay available for sorting.
      filtered:
        this.isolationMode || Boolean(this._scatterplotController.scatterplot?.filtersActive),
      points: this._stripPoints,
      highlighted: this._hoveredCategory,
      clusterCaveat: this._isClusterAnnotation,
    };
    return renderScoreStrips(view, this._scoreStripHandlers);
  }

  private _renderLegendItem(item: LegendItem, sortedIndex: number) {
    const selected = isItemSelected(item, this.selectedItems);
    const view: LegendRowView = {
      classes: `${getItemClasses(item, selected, false)}${
        this._categoryScores.length > 0 && item.value === this._hoveredCategory
          ? ' legend-item-score-hover'
          : ''
      }`,
      selected,
      symbolSize: LEGEND_STYLES.legendDisplaySize,
      otherCount: item.value === LEGEND_VALUES.OTHER ? this._otherItems.length : undefined,
      index: sortedIndex,
      draggable: this._canDragLegendItem(item),
    };
    const handlers: LegendRowHandlers = {
      onClick: (e: MouseEvent) => this._handleItemMouseClick(item.value, e),
      onDoubleClick: () => this._handleItemMouseDoubleClick(item.value),
      onViewOther: (e: Event) => {
        e.stopPropagation();
        this._showOtherDialog = true;
      },
      onKeyDown: (e: KeyboardEvent) => this._handleItemKeyDown(e, item, sortedIndex),
      onHandleKeyDown: (e: KeyboardEvent) => this._handleDragHandleKeyDown(e, item),
      onHover: (category) => this._setHoveredCategory(category),
      onSymbolClick:
        item.value !== LEGEND_VALUES.OTHER && !this._isNumericAnnotation()
          ? (e: MouseEvent) => this._handleSymbolClick(item, e)
          : undefined,
    };
    return renderLegendRow(item, view, handlers);
  }
```

Nothing else in `legend.ts` changes: `_renderScoreStrips()` is still called from `render()`, and `_setHoveredCategory` (lines 2874–2881) stays as it is. `LEGEND_STYLES`, `CategoryScore`, `getItemClasses` and `isItemSelected` are still imported and used; `SHAPE_PATH_GENERATORS` still serves `_renderColorPicker`.

- [ ] **Step 8: Delete the renderer**

Run: `rm packages/core/src/components/legend/legend-renderer.ts` (Step 11 stages the removal).

Then confirm nothing references it: `grep -rn "LegendRenderer\|legend-renderer" packages/core/src apps/web/src apps/web/tests scripts docs` prints nothing.

- [ ] **Step 9: Run the new tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-score-strips.test.ts src/components/legend/legend-row.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 10: Run the suites the move affects**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/styles`
Expected: PASS; every existing legend test and Task 3.1's 48 tests pass unchanged, plus the 5 new ones.

Then: `pnpm type-check && pnpm lint && pnpm exec knip`
Expected: PASS (no unused import in `legend.ts`; every new export has a consumer: the header, row, list and strips exports in `legend.ts`, `renderLegendSymbol` in `legend-row.test.ts`).

Then, with the sandbox disabled (the runs start servers): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=legend-double-click --project=numeric-binning` and `pnpm perf:counts`
Expected: PASS, budgets unchanged (`apps/web/tests/perf/budgets.json` is not edited).

Then: `pnpm exec prettier --check packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend-score-strips.ts packages/core/src/components/legend/legend-score-strips.test.ts packages/core/src/components/legend/legend-row.test.ts`
Expected: no warnings (run `--write` first if needed).

Report the core unit counts before and after and `wc -l packages/core/src/components/legend/legend.ts`.

- [ ] **Step 11: Commit**

With the sandbox disabled (the hook needs network):

```bash
git add packages/core/src/components/legend/legend.ts \
  packages/core/src/components/legend/legend-header.ts \
  packages/core/src/components/legend/legend-row.ts \
  packages/core/src/components/legend/legend-list.ts \
  packages/core/src/components/legend/legend-score-strips.ts \
  packages/core/src/components/legend/legend-score-strips.test.ts \
  packages/core/src/components/legend/legend-row.test.ts \
  packages/core/src/components/legend/legend-renderer.ts
git commit -m "refactor(core): move the legend's templates into render modules"
```

(`git add` of the deleted `legend-renderer.ts` stages its removal.)

---

### Task 3.3: Split the EAT controls out of the legend

The EAT reliability block (constants 105–184, the overlay switch, the reliability writer, the band, range, percent and mode templates 1307–1621, the section 2825–2863, the 150 ms commit timer) moves to `legend-eat-controls.ts` as a reactive controller plus a template. The public API keeps its names and delegates. The 28 DOM-driven tests in `legend.eat-controls.test.ts` pass unchanged; one test is added that pins the commit delay through the exported constant (its consumer, for knip).

**Files:**

- Create: `packages/core/src/components/legend/legend-eat-controls.ts`
- Modify: `legend.ts`, `legend.eat-controls.test.ts` (one added test and its import; the 28 existing tests are not touched)

**Interfaces:**

- Consumes: `EatReliabilityState`, `EatReliabilityMode`, `normalizeReliability`, `isSameReliability`, `clampReliabilityBound`, `DEFAULT_EAT_RELIABILITY`, `NEUTRAL_BOUND`, `RELIABILITY_BOUNDS`, `annotationLabel` (`@protspace/utils`); `EatPopulationCounts`; `protspace-info-popover`.
- Produces (`legend-eat-controls.ts`):
  - `EAT_THRESHOLD_COMMIT_DELAY_MS = 150`.
  - `interface EatOverlayChangeDetail { enabled: boolean; confidenceThreshold: number; reliability: EatReliabilityState }`.
  - `interface EatControlsOptions { getScatterplot(): { eatOverlayEnabled?: boolean } | null | undefined; isHostDriven(): boolean; getAnnotation(): string; emit(detail: EatOverlayChangeDetail): void }`. (`eatOverlayEnabled` is optional here, against the skeleton's required `boolean`: `IScatterplotElement.eatOverlayEnabled` is optional, so the legend's `() => this._scatterplotController.scatterplot` would not type-check against a required field.)
  - `class EatReliabilityController implements ReactiveController` — `constructor(host: ReactiveControllerHost, options: EatControlsOptions)`; getters `reliability: EatReliabilityState`, `overlayEnabled: boolean`; `applySettings(enabled: boolean, threshold: number): void` (today's `applyEatSettings` body); `setOverlayEnabled(enabled: boolean): void` (`_applyEatOverlayEnabled`); `mirrorOverlayEnabled(enabled: boolean): void` (sets the switch without writing the plot or emitting: the data-change sync from the plot and the reset for a new dataset, today's two direct `_eatOverlayEnabled =` writes; not in the skeleton); `mirror(state: EatReliabilityState): void` (`setReliabilityState`: cancel, set, no emit); `cancelCommit(): void`; `hostDisconnected(): void` (cancels). It calls `host.requestUpdate()` only when the normalised reliability or the switch actually changes (today's `hasChanged` by value). Template handlers are arrow fields or methods on the controller (`onToggle`, `onModeChange`, `onBoundInput`, `onPercentInput`, `flushCommit`) because Lit calls a listener with the host as `this`.
  - `renderEatSection(ctrl: EatReliabilityController, view: { counts: EatPopulationCounts | null }): TemplateResult` — today's `<section class="eat-legend" aria-label="Embedding Annotation Transfer">` markup, ids, classes and names unchanged.
- `legend.ts`: `_eatControls: EatReliabilityController`; `applyEatSettings`, `setReliabilityState`, `reliabilityState`, `reliabilityThreshold` delegate; `_reliability` and `_eatOverlayEnabled` leave the element (readers use `_eatControls.reliability` / `.overlayEnabled`); `eat-overlay-change` is still dispatched by the legend element (through `emit`), bubbling and composed.

**Tests:**

- `legend.eat-controls.test.ts` passes with its 28 tests unchanged, plus "commits exactly EAT_THRESHOLD_COMMIT_DELAY_MS after the last tick, not before"; `legend.api.test.ts` passes, as do the app's `filter-controller` and `dataset-controller.eat` unit tests (`pnpm --filter @protspace/core build` first).
- `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=eat-visualization` passes.

Line numbers are from `7d45ab02`. Task 3.2 has changed `render()` and the imports; anchor every edit on the quoted text, not the numbers.

- [ ] **Step 1: Write the failing test**

In `packages/core/src/components/legend/legend.eat-controls.test.ts`, add after the line `import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';`:

```ts
import { EAT_THRESHOLD_COMMIT_DELAY_MS } from './legend-eat-controls';
```

and, inside `describe('legend-owned EAT controls', () => {`, after the test `'debounces the threshold apply: display stays live, the emit defers ~150ms'` (it ends with `expect(listener).toHaveBeenCalledTimes(1);\n  });`), add:

```ts
  it('commits exactly EAT_THRESHOLD_COMMIT_DELAY_MS after the last tick, not before', async () => {
    expect(EAT_THRESHOLD_COMMIT_DELAY_MS).toBe(150);
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.5';
    range.dispatchEvent(new Event('input'));

    vi.advanceTimersByTime(EAT_THRESHOLD_COMMIT_DELAY_MS - 1);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.eat-controls.test.ts`
Expected: FAIL: `Failed to resolve import "./legend-eat-controls"` (the whole file fails to load).

- [ ] **Step 3: Create the controller and the template**

Create `packages/core/src/components/legend/legend-eat-controls.ts` (the constants, writers, handlers and templates of `legend.ts`, behaviour unchanged):

```ts
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';
import {
  annotationLabel,
  clampReliabilityBound,
  DEFAULT_EAT_RELIABILITY,
  isSameReliability,
  NEUTRAL_BOUND,
  normalizeReliability,
  RELIABILITY_BOUNDS,
  type EatReliabilityMode,
  type EatReliabilityState,
} from '@protspace/utils';
import type { EatPopulationCounts } from './eat-population-counts';
import '../common/info-popover';

/**
 * Debounce window (ms) for committing an EAT reliability slider drag. The slider's
 * visual value + percent readout update live on every tick, but the expensive
 * downstream apply (reliability query re-eval + geometry/point index rebuild at 570k
 * points) is deferred to a drag-pause/release so dragging stays smooth.
 */
export const EAT_THRESHOLD_COMMIT_DELAY_MS = 150;

/**
 * Smallest gap the two `between` thumbs may be dragged to. Doubles as the sliders'
 * `step`, so "one step apart" is literally true: the thumbs never occupy the same
 * pixel, where whichever sits on top would be the only one the pointer could reach.
 */
const EAT_BAND_MIN_GAP = 0.01;

/**
 * A 0..1 bound as a CSS percentage. Rounded because the multiplication is lossy —
 * `(1 - 0.41) * 100` is `59.00000000000001`, which would otherwise be written into the
 * style attribute verbatim. Two decimals is finer than the sliders' own 0.01 step.
 */
const bandPercent = (value: number): number => Number((value * 100).toFixed(2));

/**
 * Which end of the reliability range a control edits. Deliberately the field name on
 * `EatReliabilityState`, so a bound indexes its own value, its own neutral position
 * (`NEUTRAL_BOUND`) and its own row in `RELIABILITY_BOUNDS` with no hand-written
 * lower/upper -> min/max mapping in between.
 */
type EatBound = 'min' | 'max';

const EAT_BOUNDS: readonly EatBound[] = ['min', 'max'];

function boundsForMode(mode: EatReliabilityMode): readonly EatBound[] {
  const uses = RELIABILITY_BOUNDS[mode];
  return EAT_BOUNDS.filter((bound) => uses[bound]);
}

/**
 * Which bounds each mode renders a thumb and a percent box for — derived from the
 * shared `RELIABILITY_BOUNDS` rather than restated, so the control cannot offer a
 * widget for a bound the filter ignores. `atMost` used to render the lower bound
 * anyway, disabled and stuck at 0: a dead slider and a dead number box taking up half
 * the control. Keyed by the mode union, so a fourth mode is a compile error here.
 */
const EAT_BOUNDS_FOR_MODE: Record<EatReliabilityMode, readonly EatBound[]> = {
  atLeast: boundsForMode('atLeast'),
  atMost: boundsForMode('atMost'),
  between: boundsForMode('between'),
};

/**
 * Per-bound identity and accessible names. `soloLabel` is what the slider is called
 * when its mode renders it alone — a single thumb is the filter's threshold, not one
 * end of a band.
 */
const EAT_BOUND_UI: Record<
  EatBound,
  { id: string; sliderLabel: string; soloLabel: string; percentLabel: string }
> = {
  min: {
    id: 'eat-reliability-threshold',
    sliderLabel: 'EAT reliability filter lower bound',
    soloLabel: 'EAT reliability filter threshold',
    percentLabel: 'EAT reliability filter percentage',
  },
  max: {
    id: 'eat-reliability-upper',
    sliderLabel: 'EAT reliability filter upper bound',
    soloLabel: 'EAT reliability filter upper bound',
    percentLabel: 'EAT reliability upper bound percentage',
  },
};

/**
 * What each mode actually does to the plot. The popover sits beside the mode select,
 * so it has to describe the mode that is selected; it used to say "predictions below
 * this reliability are hidden" unconditionally, which is false in two of the three.
 */
const EAT_RELIABILITY_EFFECT: Record<EatReliabilityMode, string> = {
  atLeast: 'Predictions below this reliability are hidden (filtered out). Set to 0% to show all.',
  atMost: 'Predictions above the upper bound are hidden (filtered out). Set to 100% to show all.',
  between:
    'Only predictions between the two bounds are kept; everything outside the band is hidden. Widen the band to 0–100% to show all.',
};

/** The `eat-overlay-change` detail the legend dispatches. */
export interface EatOverlayChangeDetail {
  enabled: boolean;
  confidenceThreshold: number;
  reliability: EatReliabilityState;
}

/** What the controller reads from, and tells, the legend. */
export interface EatControlsOptions {
  /** The synced scatterplot, whose `eatOverlayEnabled` the switch drives. */
  getScatterplot(): { eatOverlayEnabled?: boolean } | null | undefined;
  /** `autoSync` is off: the host applies the switch to the plot itself. */
  isHostDriven(): boolean;
  /** The selected annotation's key, for the help text. */
  getAnnotation(): string;
  /** Dispatch `eat-overlay-change` from the legend. */
  emit(detail: EatOverlayChangeDetail): void;
}

/**
 * The EAT overlay switch and the reliability filter's position, with the 150 ms commit of a
 * slider drag.
 *
 * The position is one value rather than a mode and two loose bounds (#380): `atLeast` hides
 * low-confidence predictions (the original, default behaviour); `atMost` hides high-confidence
 * ones, which is how you inspect what you would throw away; `between` isolates a band — the
 * mid-confidence transfers worth reviewing by hand. Curated proteins stay visible in all three.
 * The three are only ever written together, by `set`, so no reader reassembles them and no
 * writer has to remember all three.
 */
export class EatReliabilityController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: EatControlsOptions;
  private _reliability: EatReliabilityState = DEFAULT_EAT_RELIABILITY;
  private _overlayEnabled = true;
  private _commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: ReactiveControllerHost, options: EatControlsOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The reliability filter as the filter builder models it: a mode plus bounds. */
  get reliability(): EatReliabilityState {
    return this._reliability;
  }

  get overlayEnabled(): boolean {
    return this._overlayEnabled;
  }

  hostDisconnected(): void {
    // A drag left in flight must not emit after teardown.
    this.cancelCommit();
  }

  /**
   * Bundle restore: the saved overlay switch plus the saved reliability position.
   *
   * A bundle stores the LOWER bound only, so restoring it means "hide below x" — the
   * mode has to come along with it. Writing the bound into whatever mode the control
   * happens to be in loses it outright in `atMost` (normalization blanks the bound that
   * mode ignores, so a saved 60% restores as no filter) and reinterprets it in `between`
   * (a band against a stale upper bound). Both contradict the documented round trip,
   * which is that a bundle reopens on "Hide below" at the saved value.
   */
  applySettings(enabled: boolean, threshold: number): void {
    // A discrete apply supersedes any pending debounced threshold commit — cancel it
    // so it can't fire a stale late emit.
    this.cancelCommit();
    this._set({ mode: 'atLeast', min: threshold, max: NEUTRAL_BOUND.max });
    this.setOverlayEnabled(enabled);
  }

  /**
   * Publish the overlay switch. The switch still coalesces predictions into the base
   * annotation on the scatter plot; the reliability position only feeds the query
   * filter, so it rides the emit rather than being pushed onto the plot as a dimming
   * input.
   *
   * Separate from `applySettings` because the switch decides visibility and nothing
   * else. Routing it through the restore path made every toggle a bundle restore too,
   * which snapped the mode back to "Hide below" and dropped the bound with it — in
   * `atMost` the lower bound it round-tripped is 0, so flipping the switch off and on
   * silently cleared a "hide above 40%" filter.
   */
  setOverlayEnabled(enabled: boolean): void {
    this.mirrorOverlayEnabled(enabled);
    const scatterplot = this.options.getScatterplot();
    if (!this.options.isHostDriven() && scatterplot) {
      scatterplot.eatOverlayEnabled = enabled;
    }
    this._emit();
  }

  /** Set the switch without writing the plot or emitting: it follows the plot, or a reset. */
  mirrorOverlayEnabled(enabled: boolean): void {
    if (this._overlayEnabled === enabled) return;
    this._overlayEnabled = enabled;
    this.host.requestUpdate();
  }

  /**
   * Reverse mirror: set the control's position from the query filter WITHOUT
   * re-emitting `eat-overlay-change`, so the filter->legend direction does not
   * loop back into the legend->filter direction (#6b).
   *
   * Cancels any pending drag commit first: a discrete update from the query side
   * supersedes an in-flight drag, and leaving the timer armed let a stale late emit
   * overwrite what the user had just typed into the Filter builder (#380).
   */
  mirror(state: EatReliabilityState): void {
    this.cancelCommit();
    this._set(state);
  }

  /** Drop a pending threshold commit without emitting (an immediate apply supersedes it). */
  cancelCommit(): void {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
  }

  /** Which bounds the selected mode filters on, and therefore which controls exist. */
  get activeBounds(): readonly EatBound[] {
    return EAT_BOUNDS_FOR_MODE[this._reliability.mode];
  }

  get helpText(): string {
    const label = annotationLabel(this.options.getAnnotation());
    const effect = EAT_RELIABILITY_EFFECT[this._reliability.mode];
    return `${effect} Curated “${label}” annotations always stay visible. This mirrors a Filter condition on “${label} — EAT confidence”.`;
  }

  readonly onToggle = (event: Event): void => {
    // A discrete decision, like a mode change: it supersedes any pending drag commit.
    this.cancelCommit();
    this.setOverlayEnabled((event.currentTarget as HTMLInputElement).checked);
  };

  readonly onModeChange = (event: Event): void => {
    const mode = (event.currentTarget as HTMLSelectElement).value as EatReliabilityMode;
    // `normalizeReliability` blanks the bound the new mode does not use, so switching
    // modes cannot leave a stale constraint applied from a side the user can no longer
    // see or edit.
    this._set({ ...this._reliability, mode });
    // A mode change is a discrete decision, not a drag — apply it immediately.
    this.cancelCommit();
    this._emit();
  };

  /** Slider release (@change): apply the pending threshold now, without waiting out the debounce. */
  readonly flushCommit = (): void => {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
      this._emit();
    }
  };

  onBoundInput(bound: EatBound, event: Event): void {
    const slider = event.currentTarget as HTMLInputElement;
    const applied = this._setBoundLive(bound, Number(slider.value));

    // Re-pin the slider when a clamp moved the value, or the thumb sails past its
    // neighbour on screen while the filter uses the clamped bound. Lit cannot do this
    // for us: a `.value` binding dirty-checks against the value Lit last committed, not
    // against the DOM, so once the clamp holds the state still the browser is free to
    // keep driving the input and Lit sees nothing to write.
    const pinned = String(applied);
    if (slider.value !== pinned) slider.value = pinned;
  }

  onPercentInput(bound: EatBound, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const raw = input.value;
    // An emptied box reads as "no constraint on this side" — but it cannot be routed
    // through `clampReliabilityBound`'s non-finite fallback to say so, because a number
    // input reports an empty (or unparseable) field as `''` and `Number('')` is 0, not
    // NaN. On the UPPER bound that 0 is `confidence <= 0`, which hides every prediction:
    // the exact opposite of clearing the field.
    const empty = raw.trim() === '';
    const requested = empty ? NEUTRAL_BOUND[bound] : Number(raw) / 100;
    if (!Number.isFinite(requested)) return;

    const applied = this._setBoundLive(bound, requested);
    // Re-pin only when a clamp actually moved the value, for the reason the slider does:
    // a clamp that holds the state still leaves Lit's `.value` dirty-check nothing to
    // write, so the box would keep displaying a bound the filter is not using. A box the
    // user is still typing a valid number into is left alone, and so is an emptied one —
    // pinning that would type the neutral bound back in under them.
    if (empty || applied === requested) return;
    const pinned = String(Math.round(applied * 100));
    if (input.value !== pinned) input.value = pinned;
  }

  /**
   * The one writer for the reliability position, so the control and the query it
   * mirrors cannot disagree about what a state means. Every rule — clamping, blanking
   * the bound the mode ignores, ordering a crossed band — lives in the shared
   * `normalizeReliability`. An update is requested only when the normalised position
   * differs by value: re-normalising an unchanged position must not re-render the legend.
   */
  private _set(state: EatReliabilityState): void {
    const next = normalizeReliability(state);
    const changed = !isSameReliability(next, this._reliability);
    this._reliability = next;
    if (changed) this.host.requestUpdate();
  }

  private _emit(): void {
    this.options.emit({
      enabled: this._overlayEnabled,
      confidenceThreshold: this._reliability.min,
      reliability: this._reliability,
    });
  }

  /**
   * Bound drag: update the slider's visual value immediately (thumb + percent
   * readout stay live), but debounce the expensive downstream apply — the
   * `eat-overlay-change` emit that re-runs the reliability query and rebuilds
   * geometry — to a drag-pause/release.
   */
  private _setBoundLive(bound: EatBound, value: number): number {
    // Each bound falls back to its own "constrains nothing" position, so a non-finite
    // value reads as no constraint on that side.
    const next = this._clampBandBound(bound, clampReliabilityBound(value, NEUTRAL_BOUND[bound]));
    // Through the one writer, so a live drag lands in the same canonical form as every
    // other path and what the thumbs settle on is the band the filter will apply.
    this._set({ ...this._reliability, [bound]: next });
    this._debounceCommit();
    // The bound the state actually settled on, so the caller pins its control onto the
    // value the filter will use. Not `next`: normalization runs after the band clamp and
    // can still move it (a band whose upper bound sits at 0 clamps the lower one to
    // -0.01, which `normalizeReliability` then pulls back to 0).
    return this._reliability[bound];
  }

  /**
   * On the shared `between` track a thumb stops at its neighbour instead of passing it.
   *
   * Two independent bars could cross, and the crossed pair was only put back in order
   * later, by `normalizeReliability` at commit time — so the bounds swapped under the
   * user's thumb, and which band they ended up with depended on whether they happened
   * to pause for the debounce mid-drag. On one track that would be visible nonsense:
   * the fill would invert. Stopping at the neighbour is what a range control does, and
   * it makes the crossed state unreachable rather than corrected after the fact.
   *
   * The bounds stop one step short of each other so the two thumbs can never land on
   * the same pixel, where the one on top would be the only one you could grab.
   */
  private _clampBandBound(bound: EatBound, value: number): number {
    const { mode, min, max } = this._reliability;
    if (mode !== 'between') return value;
    return bound === 'min'
      ? Math.min(value, max - EAT_BAND_MIN_GAP)
      : Math.max(value, min + EAT_BAND_MIN_GAP);
  }

  private _debounceCommit(): void {
    if (this._commitTimer !== null) {
      clearTimeout(this._commitTimer);
    }
    this._commitTimer = setTimeout(() => {
      this._commitTimer = null;
      this._emit();
    }, EAT_THRESHOLD_COMMIT_DELAY_MS);
  }
}

function renderReliabilityRange(
  ctrl: EatReliabilityController,
  bound: EatBound,
  disabled: boolean,
): TemplateResult {
  const ui = EAT_BOUND_UI[bound];
  return html`
    <input
      id=${ui.id}
      type="range"
      min=${NEUTRAL_BOUND.min}
      max=${NEUTRAL_BOUND.max}
      step=${EAT_BAND_MIN_GAP}
      .value=${String(ctrl.reliability[bound])}
      ?disabled=${disabled}
      aria-label=${ctrl.activeBounds.length > 1 ? ui.sliderLabel : ui.soloLabel}
      @input=${(event: Event) => ctrl.onBoundInput(bound, event)}
      @change=${ctrl.flushCommit}
    />
  `;
}

function renderReliabilityPercent(
  ctrl: EatReliabilityController,
  bound: EatBound,
  disabled: boolean,
): TemplateResult {
  return html`
    <input
      class="eat-threshold-percent"
      type="number"
      min="0"
      max="100"
      step="1"
      .value=${String(Math.round(ctrl.reliability[bound] * 100))}
      ?disabled=${disabled}
      aria-label=${EAT_BOUND_UI[bound].percentLabel}
      @input=${(event: Event) => ctrl.onPercentInput(bound, event)}
      @change=${ctrl.flushCommit}
    />
  `;
}

function renderReliabilityModeSelect(ctrl: EatReliabilityController): TemplateResult {
  return html`
    <select
      class="eat-threshold-mode"
      aria-label="EAT reliability filter mode"
      .value=${ctrl.reliability.mode}
      ?disabled=${!ctrl.overlayEnabled}
      @change=${ctrl.onModeChange}
    >
      <option value="atLeast">Hide below</option>
      <option value="atMost">Hide above</option>
      <option value="between">Keep between</option>
    </select>
  `;
}

function renderReliabilityInfo(ctrl: EatReliabilityController): TemplateResult {
  return html`
    <protspace-info-popover
      class="eat-threshold-info"
      .description=${ctrl.helpText}
      label="EAT reliability filter"
      align="right"
    ></protspace-info-popover>
  `;
}

/**
 * All three modes share ONE layout: the mode select and its bound(s) on a heading row,
 * then a single track carrying one thumb per bound the mode actually filters on.
 *
 * The modes used to look like different controls. `atMost` rendered a dead, disabled
 * lower slider above its real one plus a separate "Upper bound" label row — four rows
 * against `atLeast`'s two — so switching modes reshuffled the panel and left widgets on
 * screen that did nothing.
 *
 * The fill always marks what SURVIVES the filter, which a plain range input cannot do:
 * it fills from the left, so `atLeast` (which keeps everything ABOVE the thumb) was
 * colouring exactly the hidden half, while `atMost` happened to be right. Drawing the
 * kept region explicitly makes the bar mean one thing in every mode.
 */
function renderReliabilityBand(ctrl: EatReliabilityController): TemplateResult {
  const disabled = !ctrl.overlayEnabled;
  const bounds = ctrl.activeBounds;
  const { min, max } = ctrl.reliability;
  // An absent bound does not clip the kept region: `atLeast` keeps up to the top,
  // `atMost` from the bottom.
  const fillLeft = bounds.includes('min') ? min : NEUTRAL_BOUND.min;
  const fillRight = bounds.includes('max') ? NEUTRAL_BOUND.max - max : NEUTRAL_BOUND.min;

  return html`
    <div class="eat-threshold-heading">
      ${renderReliabilityModeSelect(ctrl)}
      <span class="eat-threshold-value">
        ${bounds.map(
          (bound, index) => html`
            ${index > 0 ? html`<span class="eat-threshold-sep" aria-hidden="true">–</span>` : null}
            ${renderReliabilityPercent(ctrl, bound, disabled)}
          `,
        )}
        <span aria-hidden="true">%</span>
        ${renderReliabilityInfo(ctrl)}
      </span>
    </div>
    <div class="eat-threshold-band ${disabled ? 'is-disabled' : ''}">
      <span class="eat-threshold-track" aria-hidden="true">
        <span
          class="eat-threshold-fill"
          style=${`left:${bandPercent(fillLeft)}%;right:${bandPercent(fillRight)}%`}
        ></span>
      </span>
      ${bounds.map((bound) => renderReliabilityRange(ctrl, bound, disabled))}
    </div>
  `;
}

/** The legend's EAT block: the overlay switch, the reliability filter and the counts. */
export function renderEatSection(
  ctrl: EatReliabilityController,
  view: { counts: EatPopulationCounts | null },
): TemplateResult {
  return html`
    <section class="eat-legend" aria-label="Embedding Annotation Transfer">
      <div class="eat-legend-header">
        <div class="eat-legend-title">Predicted (transferred)</div>
        <label class="eat-switch">
          <input
            type="checkbox"
            .checked=${ctrl.overlayEnabled}
            aria-label="Show EAT predictions"
            @change=${ctrl.onToggle}
          />
          <span>Show</span>
        </label>
      </div>
      <div class="eat-threshold">${renderReliabilityBand(ctrl)}</div>
      ${ctrl.overlayEnabled && view.counts
        ? html`
            <div class="eat-legend-counts" role="region" aria-label="Transferred annotation counts">
              <div class="eat-legend-row">
                <span class="eat-swatch observed" aria-hidden="true"></span>
                <span>Observed</span>
                <strong>${view.counts.observed}</strong>
              </div>
              <div class="eat-legend-row">
                <span class="eat-swatch predicted" aria-hidden="true"></span>
                <span>Predicted by EAT</span>
                <strong>${view.counts.predicted}</strong>
              </div>
            </div>
          `
        : ''}
    </section>
  `;
}
```

- [ ] **Step 4: Rewire `legend.ts`**

Apply these edits to `packages/core/src/components/legend/legend.ts`.

4a. In the `@protspace/utils` import, delete these six lines (keep `annotationLabel`, `DEFAULT_EAT_RELIABILITY` and `type EatReliabilityState`):

```ts
  clampReliabilityBound,
  isSameReliability,
  normalizeReliability,
  NEUTRAL_BOUND,
  RELIABILITY_BOUNDS,
```

```ts
  type EatReliabilityMode,
```

4b. Delete the whole constants block that follows the import of `createLegendErrorEventDetail`: from the comment line `/**` that opens ` * Debounce window (ms) for committing an EAT reliability slider drag.` down to and including the `};` that closes `const EAT_RELIABILITY_EFFECT` (lines 99–182 at `7d45ab02`). The `// Types` import block after it stays.

4c. Below the line `import { createLegendErrorEventDetail } from './legend.events';`, add:

```ts
import {
  EatReliabilityController,
  renderEatSection,
  type EatControlsOptions,
  type EatOverlayChangeDetail,
} from './legend-eat-controls';
```

4d. Delete the two `@state` fields of the EAT block: the line

```ts
  @state() private _eatOverlayEnabled = true;
```

and the reliability field with its doc comment, from `  /**` above ` * The reliability filter's position: which side(s) of the scale it constrains, and` down to and including

```ts
  @state({
    hasChanged: (next: EatReliabilityState, prev: EatReliabilityState | undefined) =>
      prev === undefined || !isSameReliability(next, prev),
  })
  private _reliability: EatReliabilityState = DEFAULT_EAT_RELIABILITY;
```

4e. Delete

```ts
  // Debounce timer for committing an EAT reliability slider drag (the expensive apply).
  private _eatThresholdCommitTimer: ReturnType<typeof setTimeout> | null = null;
```

4f. After the closing `});` of `private _dragController = new DragController(this, {` (just before `private _canDragLegendItem`), add:

```ts
  private _eatControls = new EatReliabilityController(this, {
    getScatterplot: () => this._scatterplotController.scatterplot,
    isHostDriven: () => this._hostDriven,
    getAnnotation: () => this.selectedAnnotation,
    emit: (detail: EatOverlayChangeDetail) =>
      this.dispatchEvent(
        new CustomEvent<EatOverlayChangeDetail>('eat-overlay-change', {
          detail,
          bubbles: true,
          composed: true,
        }),
      ),
  } satisfies EatControlsOptions);
```

4g. In `disconnectedCallback()`, delete the line `    this._cancelEatThresholdCommit();` (the controller's `hostDisconnected`, called from `super.disconnectedCallback()`, cancels instead).

4h. In `clearForNewDataset()`, replace

```ts
    this._eatCounts = null;
    this._eatOverlayEnabled = true;
    // A drag left in flight must not survive the switch: its debounced commit would
    // emit the reset position against the NEW dataset, after the seed has already run.
    this._cancelEatThresholdCommit();
    // Reset the whole reliability position, not just the lower bound. A bundle
    // restores the threshold only, so a mode left over from the previous dataset
    // would reinterpret it: "hide below 60%" saved in this bundle would load as
    // "hide above <the previous dataset's upper bound>" — the opposite filter.
    this._setReliability(DEFAULT_EAT_RELIABILITY);
```

with

```ts
    this._eatCounts = null;
    this._eatControls.mirrorOverlayEnabled(true);
    // Reset the whole reliability position, not just the lower bound, and drop a drag left
    // in flight (its debounced commit would emit the reset position against the NEW
    // dataset). A bundle restores the threshold only, so a mode left over from the previous
    // dataset would reinterpret it: "hide below 60%" saved in this bundle would load as
    // "hide above <the previous dataset's upper bound>" — the opposite filter.
    this._eatControls.mirror(DEFAULT_EAT_RELIABILITY);
```

4i. Replace the EAT members of the public API and every EAT handler and template: everything from the comment

```ts
  /**
   * Reliability slider position (0…1). The slider no longer dims points itself;
```

down to and including the closing `  }` of `private _cancelEatThresholdCommit(): void {` (lines 1260–1620 at `7d45ab02`, ending just before `  private _handleScatterplotDataChange(`), with:

```ts
  /**
   * Reliability slider position (0…1). The slider no longer dims points itself;
   * it drives the shared `EAT_confidence >= x or N/A` query filter. Exposed so bundle
   * export can persist the saved slider position (#6b).
   */
  public get reliabilityThreshold(): number {
    return this._eatControls.reliability.min;
  }

  /**
   * Apply a bundle's dataset-level shape size. `datasetHash` is for when the
   * component's own hash is not computed from the new data yet.
   */
  public applyShapeSize(shapeSize: number, datasetHash?: string): void {
    const size = Math.min(shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
    this._persistenceController.saveShapeSize(size, datasetHash);
    this.shapeSize = size;
    this._scatterplotController.updateConfig({ pointSize: calculatePointSize(size) });
  }

  /**
   * The dataset-level shape size, or undefined while none has been picked (nor
   * applied from a bundle). A bundle writes only this, so a size merely seeded
   * from one annotation's settings is never promoted to every annotation.
   */
  public get pickedShapeSize(): number | undefined {
    return this._persistenceController.loadShapeSize() ?? undefined;
  }

  /**
   * Bundle restore: the saved overlay switch plus the saved reliability position, which
   * reopens on "Hide below" at the saved value (`EatReliabilityController.applySettings`).
   */
  public applyEatSettings(enabled: boolean, threshold: number): void {
    this._eatControls.applySettings(enabled, threshold);
  }

  /** The reliability filter as the filter builder models it: a mode plus bounds. */
  public get reliabilityState(): EatReliabilityState {
    return this._eatControls.reliability;
  }

  /**
   * Reverse mirror: set the control's position from the query filter WITHOUT re-emitting
   * `eat-overlay-change`, cancelling a pending drag commit first (#6b, #380).
   */
  public setReliabilityState(state: EatReliabilityState): void {
    this._eatControls.mirror(state);
  }
```

4j. In `_handleScatterplotDataChange`, replace

```ts
    this._eatOverlayEnabled = scatterplot?.eatOverlayEnabled ?? true;
```

with

```ts
    this._eatControls.mirrorOverlayEnabled(scatterplot?.eatOverlayEnabled ?? true);
```

and, a few lines further down, replace

```ts
    this._eatCounts = computeEatPopulationCounts(data, selectedAnnotation, this._eatOverlayEnabled);
```

with

```ts
    this._eatCounts = computeEatPopulationCounts(
      data,
      selectedAnnotation,
      this._eatControls.overlayEnabled,
    );
```

4k. In `render()`, replace the inline EAT section: everything from

```ts
        ${this._hasSelectedEatAnnotation()
          ? html`
              <section class="eat-legend" aria-label="Embedding Annotation Transfer">
```

down to and including its closing

```ts
              </section>
            `
          : ''}
```

with

```ts
        ${this._hasSelectedEatAnnotation()
          ? renderEatSection(this._eatControls, { counts: this._eatCounts })
          : ''}
```

4l. Check that nothing still names the old members:

Run: `grep -n "_eatOverlayEnabled\|_reliability\b\|_setReliability\|_emitEatOverlayChange\|_handleEatOverlayToggle\|_activeBounds\|_reliabilityHelpText\|_handleEatModeChange\|_renderReliability\|_handleEatBound\|_setEatBoundLive\|_clampBandBound\|EatThresholdCommit\|EAT_BOUND\|EAT_RELIABILITY_EFFECT\|bandPercent" packages/core/src/components/legend/legend.ts`
Expected: no output.

- [ ] **Step 5: Run the EAT tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.eat-controls.test.ts src/components/legend/legend.api.test.ts`
Expected: PASS, 29 + 19 tests (the 28 existing EAT tests unchanged, the new delay test, and the API file, whose `applyEatSettings` and arity checks cover the delegating methods).

- [ ] **Step 6: Run the suites the move affects**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/styles`
Expected: PASS.

Then: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run src/explore/filter-controller.test.ts src/explore/dataset-controller.eat.test.ts`
Expected: PASS (the app reads `reliabilityState`, `setReliabilityState`, `applyEatSettings` and `eat-overlay-change` through core's `dist`).

Then: `pnpm type-check && pnpm lint && pnpm exec knip`
Expected: PASS (`EAT_THRESHOLD_COMMIT_DELAY_MS` is consumed by the EAT test; `EatControlsOptions` and `EatOverlayChangeDetail` by `legend.ts`).

Then, with the sandbox disabled: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=eat-visualization`
Expected: PASS (roles, names, ids and classes are unchanged, so the 320–800 px geometry checks hold).

Then: `pnpm exec prettier --check packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-eat-controls.ts packages/core/src/components/legend/legend.eat-controls.test.ts`
Expected: no warnings (run `--write` first if needed).

Report the core unit counts before and after and `wc -l packages/core/src/components/legend/legend.ts` (about 360 lines shorter than after Task 3.2).

- [ ] **Step 7: Commit**

With the sandbox disabled:

```bash
git add packages/core/src/components/legend/legend.ts \
  packages/core/src/components/legend/legend-eat-controls.ts \
  packages/core/src/components/legend/legend.eat-controls.test.ts
git commit -m "refactor(core): move the legend's EAT controls into a controller"
```

---

### Task 3.4: Split the colour picker and the keyboard model out of the legend

The colour and shape picker (render 3139–3290, `_handleSymbolClick`, the 150 ms colour debounce, the window mousedown/mouseup outside-press handlers) becomes `ColorPickerController`; row navigation (639–693) and keyboard reorder (480–532, 705–832) become `LegendKeyboardController` in `legend-list.ts`. The legend keeps the state they change and gives them callbacks. Behaviour, markup, announcements and the Escape order are unchanged: the picker still renders absolutely inside `.legend-container`, and the legend's window capture listener still asks the picker, Other, settings and the keyboard model in that order.

**Files:**

- Create: `packages/core/src/components/legend/legend-color-picker.ts`
- Modify: `packages/core/src/components/legend/legend-list.ts`, `packages/core/src/components/legend/legend.ts`
- Modify tests (only if they name a member that moves; see Step 5): `packages/core/src/components/legend/legend.color-picker.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.escape-order.test.ts`. `legend.color-picker.test.ts` also takes `COLOR_COMMIT_DELAY_MS` instead of its literal 150 (the export's consumer, for knip).

**Interfaces:**

- Consumes: `renderLegendSymbol`, `renderLegendRow`, `LegendRowHandlers` (3.2: `onKeyDown`, `onHandleKeyDown`, `onSymbolClick?`); `renderLegendList` (3.2, already in `legend-list.ts`); `LegendItem`, `OtherItem`, `LegendSortMode` (`./types`); `PointShape` (`@protspace/utils`); `SHAPE_PATH_GENERATORS`, `toDisplayValue`, `LEGEND_VALUES` (`./config`). On the legend: `_handleColorChange(value, color)`, `_handleShapeChange(value, shape)`, `_handleItemClick(value)`, `_handleItemDoubleClick(value)`, `_commitManualOrderFromVisibleValues(values, options)`, `_announceStatus(message)`, `_isMultilabelAnnotation()`, `_isNumericAnnotation()`, `_canDragLegendItem(item)`, `_currentSortMode`, `_setNumericManualOrderIds`, `_sortedLegendItems`, `_legendItems`, `_otherItems`.
- Produces:
  - `legend-color-picker.ts`: `export const COLOR_COMMIT_DELAY_MS = 150`; `interface ColorPickerOptions { getItem(value: string): LegendItem | undefined; preview(value: string, color: string): void; commitColor(value: string, color: string): void; commitShape(value: string, shape: PointShape): void; isMultilabel(): boolean; isNumeric(): boolean }` (module-private: nothing imports the type yet, and knip reports an unused exported type); `export class ColorPickerController implements ReactiveController` — `constructor(host: ReactiveControllerHost & HTMLElement, options: ColorPickerOptions)`; `get value(): string | null` (the open row); `toggle(value: string, trigger: HTMLElement): void` (today's `_handleSymbolClick`: the same row closes it, another row flushes then reopens); `close(): void` (flushes, then closes); `flush(): void`; `render(): TemplateResult | typeof nothing` (today's `.color-picker-popover` markup, positioned from `trigger` relative to `host.shadowRoot .legend-container`); `hostConnected(): void`, `hostDisconnected(): void`. It owns the shape dropdown flag and the window mousedown/mouseup listeners (added on open, removed on close and disconnect).
  - `legend-list.ts`: `export interface LegendReorderSnapshot { annotation: string; sortMode: LegendSortMode; legendItems: LegendItem[]; otherItems: OtherItem[]; numericManualOrderIds?: string[] }`; `interface LegendKeyboardOptions { getSortedItems(): readonly LegendItem[]; canDrag(item: LegendItem): boolean; toggle(value: string): void; isolate(value: string): void; snapshot(): LegendReorderSnapshot; restore(snapshot: LegendReorderSnapshot): void; move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null; announce(message: string): void; annotationName(): string }` (module-private, same reason); `export class LegendKeyboardController implements ReactiveController` — `constructor(host: ReactiveControllerHost & HTMLElement, options: LegendKeyboardOptions)`; `get pickedValue(): string | null`; `onItemKeyDown(e: KeyboardEvent, item: LegendItem, index: number): void`; `onHandleKeyDown(e: KeyboardEvent, item: LegendItem): void`; `cancel(): boolean` (restores, announces "Reordering canceled.", false when nothing is picked); `clear(): void` (forgets the picked row and its snapshot); `focusItem(index: number): void`; `focusHandle(value: string): void`; `hostDisconnected(): void`. A change of `pickedValue` calls `host.requestUpdate()`.
  - `legend.ts`: `_colorPicker: ColorPickerController`, `_keyboard: LegendKeyboardController`. `_colorPickerItem`, `_colorPickerPosition`, `_showShapePicker`, `_keyboardDragValue`, `_keyboardReorderSnapshot`, `_mouseDownOutsideColorPicker`, `_onWindowMouseDown`, `_onWindowMouseUp`, `_colorChangeDebounceTimer`, `_cleanupColorChangeDebounce`, `_flushColorChangeDebounce`, `_handleColorChangeDebounced`, `_handleSymbolClick`, `_renderColorPicker`, `_beginKeyboardReorder`, `_handleItemKeyDown`, `_handleDragHandleKeyDown`, `_focusItem`, `_focusDragHandleForValue` leave the element. `_handleColorChange`, `_handleShapeChange`, `_commitManualOrderFromVisibleValues`, `_restoreKeyboardReorderSnapshot(snapshot)` and `_clearKeyboardReorderState()` (now `_keyboard.clear()` plus the pointer-drop announcement flag) stay; `_moveFocusedManualItem` stays as the `move` callback and returns `{ moved, promoted } | null` instead of announcing. `DragController.onSortModeChange` and `_handleSettingsSave` call `_keyboard.clear()`. `updated()` recomputes "an overlay or reorder is open" on every update from `_colorPicker.value`, `_showOtherDialog`, `_showSettingsDialog` and `_keyboard.pickedValue` (controller state is not in `changedProperties`) and adds or removes the window capture listener through `_listenForEscape(on)`.

**Tests:**

- `legend.color-picker.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.escape-order.test.ts` (3.1) pass unchanged, with any private-member reference renamed to the new owner in this commit.
- `legend.double-click.test.ts` ("leaves the keyboard paths as they were") and `controllers/drag-controller.test.ts` pass.
- `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning --project=legend-double-click` passes (keyboard drag-handle reorder included).

Anchors below name functions, fields and comments, not only line numbers: Tasks 3.2 and 3.3 edit `legend.ts` first. Line numbers are from `7d45ab02`.

- [ ] **Step 1: Confirm the pins pass before the move**

This task moves code under Task 3.1's characterization tests, so the tests come first and must be green on the code as 3.3 left it.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS, every legend unit file including `legend.color-picker.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.escape-order.test.ts`, `legend.double-click.test.ts` and `controllers/drag-controller.test.ts`. Record the file and test counts and `wc -l packages/core/src/components/legend/legend.ts`.

Then list every private member those three 3.1 files reach, so Step 5 knows what to rename:

Run: `grep -nE "_(colorPicker|showShapePicker|keyboardDrag|keyboardReorder|handleSymbolClick|flushColorChange|handleColorChangeDebounced|handleItemKeyDown|handleDragHandleKeyDown|focusItem|focusDragHandle|beginKeyboardReorder|mouseDownOutsideColorPicker|onWindowMouse)" packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.escape-order.test.ts`
Expected: no output (3.1 drives the DOM). Any hit is renamed in Step 5.

- [ ] **Step 2: Write the colour picker controller**

Create `packages/core/src/components/legend/legend-color-picker.ts`. The render is today's `_renderColorPicker` markup byte for byte (classes, `title`s, inline position), reading the controller's own state:

```ts
import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import type { PointShape } from '@protspace/utils';
import { SHAPE_PATH_GENERATORS, toDisplayValue } from './config';
import type { LegendItem } from './types';

/** A colour edit reaches the plot this long after the last input event of a drag in the picker. */
export const COLOR_COMMIT_DELAY_MS = 150;

const SHAPES: readonly PointShape[] = [
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'triangle-down',
  'plus',
];

/** What the picker reads from the legend and hands back to it. */
interface ColorPickerOptions {
  getItem(value: string): LegendItem | undefined;
  /** Repaints the row while a colour is dragged; the plot follows when the edit commits. */
  preview(value: string, color: string): void;
  commitColor(value: string, color: string): void;
  commitShape(value: string, shape: PointShape): void;
  isMultilabel(): boolean;
  isNumeric(): boolean;
}

/**
 * The colour and shape picker of one legend row. It owns which row is open, the panel's position,
 * the shape dropdown, the colour commit delay and the outside-press listeners; the legend owns the
 * items and applies the edits it is handed.
 */
export class ColorPickerController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: ColorPickerOptions;
  private _value: string | null = null;
  private _position: { x: number; y: number } | null = null;
  private _showShapePicker = false;
  private _pending: { value: string; color: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _pressStartedOutside = false;
  private _listening = false;

  constructor(host: ReactiveControllerHost & HTMLElement, options: ColorPickerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row whose picker is open, or null. */
  get value(): string | null {
    return this._value;
  }

  hostConnected(): void {
    if (this._value !== null) this._listen(true);
  }

  hostDisconnected(): void {
    // As before the split: a pending colour is dropped, not committed, when the legend leaves.
    this._cancelTimer();
    this._listen(false);
  }

  /** Opens the picker beside `trigger`; the open row's own trigger closes it again. */
  toggle(value: string, trigger: HTMLElement): void {
    if (this._value === value) {
      this.close();
      return;
    }
    // Another row's pending colour lands before this row opens.
    this.flush();
    const container = this.host.shadowRoot?.querySelector('.legend-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    this._position = {
      x: triggerRect.left - containerRect.left + triggerRect.width + 8,
      y: triggerRect.top - containerRect.top,
    };
    this._value = value;
    this._showShapePicker = false;
    this._listen(true);
    this.host.requestUpdate();
  }

  /** Commits a pending colour, then closes. */
  close(): void {
    this.flush();
    if (this._value === null) return;
    this._value = null;
    this._showShapePicker = false;
    this._listen(false);
    this.host.requestUpdate();
  }

  /** Commits a colour still waiting for its delay, at once. */
  flush(): void {
    const pending = this._pending;
    this._cancelTimer();
    if (pending) this.options.commitColor(pending.value, pending.color);
  }

  render(): TemplateResult | typeof nothing {
    const item = this._value === null ? undefined : this.options.getItem(this._value);
    if (!item || !this._position) return nothing;

    const displayLabel = item.displayValue ?? toDisplayValue(item.value);
    const isMultilabel = this.options.isMultilabel();
    const isNumeric = this.options.isNumeric();

    // Render shape swatch SVG (outline only, no fill)
    const renderShapeSwatch = (shape: string, disabled: boolean = false) => {
      const pathGenerator =
        SHAPE_PATH_GENERATORS[shape as PointShape] || SHAPE_PATH_GENERATORS.circle;
      const size = 20;
      const canvasSize = 28;
      const centerOffset = canvasSize / 2;
      const path = pathGenerator(size);
      const strokeColor = disabled ? '#999' : '#333';

      return html`
        <svg width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">
          <g transform="translate(${centerOffset}, ${centerOffset})">
            <path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="1.5" />
          </g>
        </svg>
      `;
    };

    return html`
      <div
        class="color-picker-popover"
        style="left: ${this._position.x}px; top: ${this._position.y}px;"
        @click=${(e: Event) => e.stopPropagation()}
        @mousedown=${(e: Event) => e.stopPropagation()}
      >
        <div class="color-picker-header">${displayLabel}</div>
        <div class="symbol-picker-sections">
          <!-- Color Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Color</div>
            <input
              type="color"
              class="color-picker-swatch"
              .value=${item.color}
              aria-label=${`Set color for ${displayLabel}`}
              @input=${(e: Event) =>
                this._onColorInput(item.value, (e.target as HTMLInputElement).value)}
            />
          </div>
          <!-- Shape Section -->
          <div class="symbol-picker-section">
            <div class="symbol-picker-section-label">Shape</div>
            <div class="shape-swatch-container">
              ${isMultilabel || isNumeric
                ? html`
                    <button
                      type="button"
                      class="shape-picker-swatch disabled"
                      aria-label="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      title="${isNumeric
                        ? 'Shape selection disabled for numeric annotations'
                        : 'Shape selection disabled for multilabel annotations'}"
                      disabled
                    >
                      ${renderShapeSwatch(item.shape, true)}
                    </button>
                  `
                : html`
                    <button
                      type="button"
                      class="shape-picker-swatch ${this._showShapePicker ? 'active' : ''}"
                      aria-label=${`Change shape for ${displayLabel}`}
                      title="Click to change shape"
                      @click=${(e: Event) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._showShapePicker = !this._showShapePicker;
                        this.host.requestUpdate();
                      }}
                    >
                      ${renderShapeSwatch(item.shape)}
                    </button>
                    ${this._showShapePicker
                      ? html`
                          <div class="shape-picker-dropdown">
                            <div class="shape-picker-grid">
                              ${SHAPES.map((shape) => {
                                const isSelected = item.shape === shape;
                                const pathGenerator = SHAPE_PATH_GENERATORS[shape];
                                const size = 14;
                                const canvasSize = 20;
                                const centerOffset = canvasSize / 2;
                                const path = pathGenerator(size);
                                const isOutlineOnly = shape === 'plus';

                                return html`
                                  <button
                                    type="button"
                                    class="shape-picker-item ${isSelected ? 'selected' : ''}"
                                    aria-label=${`Use ${shape} shape for ${displayLabel}`}
                                    title="${shape}"
                                    @click=${(e: Event) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      this._showShapePicker = false;
                                      this.options.commitShape(item.value, shape);
                                      this.host.requestUpdate();
                                    }}
                                  >
                                    <svg
                                      width="${canvasSize}"
                                      height="${canvasSize}"
                                      viewBox="0 0 ${canvasSize} ${canvasSize}"
                                    >
                                      <g transform="translate(${centerOffset}, ${centerOffset})">
                                        <path
                                          d="${path}"
                                          fill="${isOutlineOnly ? 'none' : 'currentColor'}"
                                          stroke="currentColor"
                                          stroke-width="${isOutlineOnly ? 1.5 : 1}"
                                        />
                                      </g>
                                    </svg>
                                  </button>
                                `;
                              })}
                            </div>
                          </div>
                        `
                      : null}
                  `}
            </div>
          </div>
        </div>
        ${isMultilabel || isNumeric
          ? html`<div class="symbol-picker-note">
              ${isNumeric
                ? 'Shapes unavailable for numeric annotations'
                : 'Shapes unavailable for multilabel annotations'}
            </div>`
          : null}
      </div>
    `;
  }

  /** The row repaints on every tick; the plot gets the colour once the drag pauses. */
  private _onColorInput(value: string, color: string): void {
    this._cancelTimer();
    this.options.preview(value, color);
    this._pending = { value, color };
    this._timer = setTimeout(() => {
      const pending = this._pending;
      this._timer = null;
      this._pending = null;
      if (pending) this.options.commitColor(pending.value, pending.color);
    }, COLOR_COMMIT_DELAY_MS);
  }

  private _cancelTimer(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    this._pending = null;
  }

  private _listen(on: boolean): void {
    if (on === this._listening) return;
    this._listening = on;
    this._pressStartedOutside = false;
    if (on) {
      window.addEventListener('mousedown', this._onWindowMouseDown);
      window.addEventListener('mouseup', this._onWindowMouseUp);
    } else {
      window.removeEventListener('mousedown', this._onWindowMouseDown);
      window.removeEventListener('mouseup', this._onWindowMouseUp);
    }
  }

  // The panel stops its own mousedown, so one that reaches the window started outside it.
  private _onWindowMouseDown = (event: MouseEvent): void => {
    const panel = this.host.shadowRoot?.querySelector('.color-picker-popover');
    this._pressStartedOutside = !!panel && !panel.contains(event.target as Node);
  };

  // A press that started outside closes on release; a drag that started inside does not.
  private _onWindowMouseUp = (): void => {
    if (!this._pressStartedOutside) return;
    this._pressStartedOutside = false;
    this.close();
  };
}
```

- [ ] **Step 3: Write the keyboard controller in `legend-list.ts`**

In `packages/core/src/components/legend/legend-list.ts` (created by 3.2 with `renderLegendList`), replace its two imports (`import { html, type TemplateResult } from 'lit';` and `import type { LegendItem } from './types';`) with these three; keep `renderLegendList` as it is:

```ts
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';
import { toDisplayValue } from './config';
import type { LegendItem, LegendSortMode, OtherItem } from './types';
```

Append to the end of the file:

```ts
/** The legend as a keyboard reorder found it; Escape puts it back. */
export interface LegendReorderSnapshot {
  annotation: string;
  sortMode: LegendSortMode;
  legendItems: LegendItem[];
  otherItems: OtherItem[];
  numericManualOrderIds?: string[];
}

/** What the keyboard model reads from the legend and asks it to do. */
interface LegendKeyboardOptions {
  getSortedItems(): readonly LegendItem[];
  canDrag(item: LegendItem): boolean;
  toggle(value: string): void;
  isolate(value: string): void;
  snapshot(): LegendReorderSnapshot;
  restore(snapshot: LegendReorderSnapshot): void;
  /** Moves a row one place; null when it cannot move. `promoted`: the sort became manual. */
  move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null;
  announce(message: string): void;
  /** The annotation's name as announcements say it. */
  annotationName(): string;
}

/**
 * The legend's keyboard model. On a row: the arrows, Home and End move between rows, Enter and
 * Space toggle, `i` isolates. On a row's handle: Enter or Space picks the row up or drops it, Up
 * and Down move it, Escape puts it back. The legend holds the items; this holds the picked row and
 * the snapshot Escape restores.
 */
export class LegendKeyboardController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: LegendKeyboardOptions;
  private _picked: string | null = null;
  private _snapshot: LegendReorderSnapshot | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: LegendKeyboardOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row picked up for a keyboard reorder, or null. */
  get pickedValue(): string | null {
    return this._picked;
  }

  hostDisconnected(): void {
    this._picked = null;
    this._snapshot = null;
  }

  onItemKeyDown(e: KeyboardEvent, item: LegendItem, index: number): void {
    const last = this.options.getSortedItems().length - 1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        this.focusItem(Math.min(index + 1, last));
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        this.focusItem(Math.max(index - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        this.focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        this.focusItem(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.options.toggle(item.value);
        break;
      case 'i':
      case 'I':
        e.preventDefault();
        this.options.isolate(item.value);
        break;
    }
  }

  onHandleKeyDown(e: KeyboardEvent, item: LegendItem): void {
    if (!this.options.canDrag(item)) return;
    const label = item.displayValue ?? toDisplayValue(item.value);
    switch (e.key) {
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const dropping = this._picked === item.value;
        if (dropping) this.clear();
        else this._pickUp(item.value);
        this.options.announce(dropping ? `Dropped ${label}` : `Picked up ${label} for reordering`);
        break;
      }
      case 'Escape':
        if (this._picked === item.value) {
          e.preventDefault();
          this.cancel();
          requestAnimationFrame(() => this.focusHandle(item.value));
        }
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (this._picked === item.value) {
          e.preventDefault();
          this._move(item.value, e.key === 'ArrowUp' ? -1 : 1);
        }
        break;
    }
  }

  /** Puts a picked-up row back where it started. False when no row is picked up. */
  cancel(): boolean {
    if (this._picked === null) return false;
    const snapshot = this._snapshot;
    if (snapshot) this.options.restore(snapshot);
    this.clear();
    this.options.announce('Reordering canceled.');
    return true;
  }

  /** Forgets the picked row and its snapshot, leaving the order as it is. */
  clear(): void {
    this._snapshot = null;
    if (this._picked === null) return;
    this._picked = null;
    this.host.requestUpdate();
  }

  focusItem(index: number): void {
    this.host.shadowRoot?.querySelectorAll<HTMLElement>('.legend-item-main')[index]?.focus();
  }

  focusHandle(value: string): void {
    this.host.shadowRoot
      ?.querySelector<HTMLElement>(`.legend-item[data-value="${CSS.escape(value)}"] .drag-handle`)
      ?.focus();
  }

  private _pickUp(value: string): void {
    this._picked = value;
    this._snapshot = this.options.snapshot();
    this.host.requestUpdate();
  }

  private _move(value: string, direction: -1 | 1): void {
    const result = this.options.move(value, direction);
    if (!result) return;
    const label = result.moved.displayValue ?? toDisplayValue(result.moved.value);
    this.options.announce(
      result.promoted
        ? `Moved ${label}. Switched ${this.options.annotationName()} to Manual order.`
        : `Moved ${label}.`,
    );
    // Lit re-renders the moved row in another slot; focus follows it after the paint.
    requestAnimationFrame(() => this.focusHandle(value));
  }
}
```

- [ ] **Step 4: Wire both controllers into the legend**

All edits are in `packages/core/src/components/legend/legend.ts`.

(a) Imports. Add:

```ts
import { ColorPickerController } from './legend-color-picker';
```

and add `LegendKeyboardController` and `type LegendReorderSnapshot` to the existing import from `./legend-list` (3.2 added it for `renderLegendList`):

```ts
import {
  LegendKeyboardController,
  renderLegendList,
  type LegendReorderSnapshot,
} from './legend-list';
```

Remove `SHAPE_PATH_GENERATORS` from the `./config` import (its only users were the picker template). Keep `PointShape` (`_handleShapeChange` still takes it), `toDisplayValue` and `OtherItem`.

(b) `@state` fields. Delete these declarations (at `7d45ab02`: lines 262–264 and 316, 318–324):

```ts
  @state() private _colorPickerItem: string | null = null;
  @state() private _colorPickerPosition: { x: number; y: number } | null = null;
  @state() private _showShapePicker = false;
```

```ts
  @state() private _keyboardDragValue: string | null = null;
```

```ts
  private _keyboardReorderSnapshot: {
    annotation: string;
    sortMode: LegendSortMode;
    legendItems: LegendItem[];
    otherItems: OtherItem[];
    numericManualOrderIds?: string[];
  } | null = null;
```

Keep `private _announceManualPromotionOnNextReorder = false;` (the pointer drop in `_highlightDroppedItem` still reads it).

(c) Plain fields. Delete the colour debounce timer and its comment:

```ts
  // Debounce timer for color picker updates
  private _colorChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
```

and, from the "Track where mousedown occurred for click-outside detection" block, only the first line:

```ts
  private _mouseDownOutsideColorPicker = false;
```

(`_mouseDownOutsideSettings` and `_mouseDownOutsideOther` stay until 3.10 and 3.12.) Add one field next to `_mouseDownOutsideOther`:

```ts
  /** Whether `_onWindowKeydownCapture` is on the window (see `_listenForEscape`). */
  private _escapeListening = false;
```

(d) Controllers. Directly after the `_dragController = new DragController(this, { … });` field, add:

```ts
  private _colorPicker = new ColorPickerController(this, {
    getItem: (value) => this._legendItems.find((item) => item.value === value),
    preview: (value, color) => this._previewColor(value, color),
    commitColor: (value, color) => this._handleColorChange(value, color),
    commitShape: (value, shape) => this._handleShapeChange(value, shape),
    isMultilabel: () => this._isMultilabelAnnotation(),
    isNumeric: () => this._isNumericAnnotation(),
  });

  private _keyboard = new LegendKeyboardController(this, {
    getSortedItems: () => this._sortedLegendItems,
    canDrag: (item) => this._canDragLegendItem(item),
    toggle: (value) => this._handleItemClick(value),
    isolate: (value) => this._handleItemDoubleClick(value),
    snapshot: () => ({
      annotation: this.selectedAnnotation,
      sortMode: this._currentSortMode,
      legendItems: this._legendItems.map((item) => ({ ...item })),
      otherItems: this._otherItems.map((item) => ({ ...item })),
      numericManualOrderIds: this._isNumericAnnotation()
        ? [...(this._numericManualOrderIdsByAnnotation[this.selectedAnnotation] ?? [])]
        : undefined,
    }),
    restore: (snapshot) => this._restoreKeyboardReorderSnapshot(snapshot),
    move: (value, direction) => this._moveFocusedManualItem(value, direction),
    announce: (message) => this._announceStatus(message),
    annotationName: () => this.selectedAnnotation,
  });
```

(e) In the `_dragController` options, `onSortModeChange`, replace `this._keyboardDragValue = null;` with:

```ts
      this._keyboard.clear();
```

(f) Replace `_clearKeyboardReorderState` and delete `_beginKeyboardReorder` (its body is the `snapshot` option above). The new `_clearKeyboardReorderState`:

```ts
  private _clearKeyboardReorderState(): void {
    this._keyboard.clear();
    this._announceManualPromotionOnNextReorder = false;
  }
```

(g) `_restoreKeyboardReorderSnapshot` takes its snapshot from the controller. Replace its first lines

```ts
  private _restoreKeyboardReorderSnapshot(): void {
    const snapshot = this._keyboardReorderSnapshot;
    if (!snapshot || snapshot.annotation !== this.selectedAnnotation) {
```

with

```ts
  private _restoreKeyboardReorderSnapshot(snapshot: LegendReorderSnapshot): void {
    if (snapshot.annotation !== this.selectedAnnotation) {
```

The rest of the method is unchanged (it still ends with `this._clearKeyboardReorderState()` and the syncs).

(h) Replace `_onWindowKeydownCapture` and delete `_onWindowMouseDown` and `_onWindowMouseUp` (the whole "Keyboard Handler" block at 578–637):

```ts
  private _onWindowKeydownCapture = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // One thing per Escape, in this order: the colour picker, Other, settings, a keyboard reorder.
    if (this._colorPicker.value !== null) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._colorPicker.close();
      return;
    }
    if (this._showOtherDialog) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._showOtherDialog = false;
      return;
    }
    if (this._showSettingsDialog) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._handleSettingsClose();
      return;
    }
    // Caught here as well as on the handle: Lit re-renders during ArrowDown can leave focus on
    // <body> until requestAnimationFrame puts it back on the handle.
    if (this._keyboard.cancel()) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  /** Puts the Escape handler on the window while a legend overlay or a reorder is open. */
  private _listenForEscape(on: boolean): void {
    if (on === this._escapeListening) return;
    this._escapeListening = on;
    if (on) window.addEventListener('keydown', this._onWindowKeydownCapture, true);
    else window.removeEventListener('keydown', this._onWindowKeydownCapture, true);
  }
```

(i) Delete `_handleItemKeyDown`, `_focusItem` and `_focusDragHandleForValue` (639–692) and `_handleDragHandleKeyDown` (781–827).

(j) `_commitManualOrderFromVisibleValues`: replace

```ts
    if (!options.preserveKeyboardDragValue) {
      this._keyboardDragValue = null;
    }
```

with

```ts
    if (!options.preserveKeyboardDragValue) {
      this._keyboard.clear();
    }
```

(k) Replace `_moveFocusedManualItem` (748–779) with the `move` callback, which reorders and reports instead of announcing (the controller announces and moves focus):

```ts
  private _moveFocusedManualItem(
    value: string,
    direction: -1 | 1,
  ): { moved: LegendItem; promoted: boolean } | null {
    const orderedItems = this._sortedLegendItems.filter(
      (item) => item.value !== LEGEND_VALUES.OTHER,
    );
    const currentIndex = orderedItems.findIndex((item) => item.value === value);
    if (currentIndex === -1) return null;

    const nextIndex = Math.max(0, Math.min(orderedItems.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return null;

    const reordered = [...orderedItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    this._commitManualOrderFromVisibleValues(
      reordered.map((item) => item.value),
      { preserveKeyboardDragValue: true },
    );
    const promoted = this._announceManualPromotionOnNextReorder;
    this._announceManualPromotionOnNextReorder = false;
    return { moved, promoted };
  }
```

(l) `disconnectedCallback`: replace the three `window.removeEventListener(…)` lines (keydown, mousedown, mouseup) with `this._listenForEscape(false);` and delete `this._cleanupColorChangeDebounce();` (the controller cancels its own timer). Keep the focus-trap and EAT cleanups as 3.3 left them.

Delete `_cleanupColorChangeDebounce` and `_flushColorChangeDebounce` (934–954).

(m) `updated()`: replace the two blocks that start at the comments `// Handle keyboard events for dialogs, color picker, and active keyboard reorder` and `// Handle global mousedown/mouseup for color picker (close on press outside)` (973–1003, ending before `// Handle settings dialog focus trapping`) with:

```ts
    // The colour picker and a keyboard reorder live in controllers, whose state never shows in
    // `changedProperties`, so whether anything Escape closes is open is recomputed every update.
    this._listenForEscape(
      this._showSettingsDialog ||
        this._showOtherDialog ||
        this._colorPicker.value !== null ||
        this._keyboard.pickedValue !== null,
    );
```

(n) `clearForNewDataset`: make its first statement

```ts
    // A colour still waiting for its delay lands on the dataset it was picked on, not the next one.
    this._colorPicker.close();
```

and delete the later `this._colorPickerItem = null;` under `// Reset UI state`. (Before the split the picker closed without the flush, and the debounced commit fired 150 ms later against the new dataset's empty items.) This is the one behaviour change in the split: name it in the report as a deviation for the ledger (a pending colour now lands on the dataset it was picked on).

(o) Delete `_handleSymbolClick` (2492–2520) and `_handleColorChangeDebounced` (2592–2608). Add, next to `_handleColorChange`:

```ts
  /**
   * Shows a colour while it is dragged: the row repaints now, the plot when the edit commits. The
   * item is changed in place, as before the split, so a drag does not re-sort the list or
   * re-derive the score strips on every tick.
   */
  private _previewColor(value: string, color: string): void {
    const item = this._legendItems.find((i) => i.value === value);
    if (!item) return;
    item.color = color;
    this.requestUpdate();
  }
```

(p) `_handleShapeChange`: delete the lines

```ts
    // Close the shape picker dropdown
    this._showShapePicker = false;
```

(the controller closes its dropdown before it calls `commitShape`).

(q) `_handleSettingsSave`: replace

```ts
    if (!nextAnnotationSortModes[this.selectedAnnotation]?.startsWith('manual')) {
      this._keyboardDragValue = null;
    }
```

with

```ts
    if (!nextAnnotationSortModes[this.selectedAnnotation]?.startsWith('manual')) {
      this._keyboard.clear();
    }
```

(r) `render()`: the `.legend-container`'s click handler becomes

```ts
        @click=${() => this._colorPicker.close()}
```

and `${this._renderColorPicker()}` becomes `${this._colorPicker.render()}`. Delete `_renderColorPicker` (3139–3292).

(s) `_renderLegendItem` (3.2's builder around `renderLegendRow`): in the handlers object, set

```ts
        onKeyDown: (e: KeyboardEvent) => this._keyboard.onItemKeyDown(e, item, sortedIndex),
        onHandleKeyDown: (e: KeyboardEvent) => this._keyboard.onHandleKeyDown(e, item),
        onSymbolClick:
          item.value !== LEGEND_VALUES.OTHER && !this._isNumericAnnotation()
            ? (e: MouseEvent) => {
                // Keeps the container's click from closing the picker it opens.
                e.stopPropagation();
                this._colorPicker.toggle(item.value, e.currentTarget as HTMLElement);
              }
            : undefined,
```

(use the index parameter name 3.2 gave `_renderLegendItem`; at `7d45ab02` it is `sortedIndex`).

Then check that nothing still names a moved member:

Run: `grep -nE "_colorPickerItem|_colorPickerPosition|_showShapePicker|_keyboardDragValue|_keyboardReorderSnapshot|_mouseDownOutsideColorPicker|_onWindowMouse|_colorChangeDebounceTimer|ColorChangeDebounce|_handleSymbolClick|_renderColorPicker|_beginKeyboardReorder|_handleItemKeyDown|_handleDragHandleKeyDown|_focusItem|_focusDragHandleForValue" packages/core/src/components/legend/legend.ts`
Expected: no output.

- [ ] **Step 5: Point the 3.1 tests at the new owners**

If Step 1's grep printed lines, rename each reference in the same file, by this table (no forwarding members are added to `legend.ts`):

| Before | After |
| --- | --- |
| `legend._colorPickerItem` | `legend._colorPicker.value` |
| `legend._keyboardDragValue` | `legend._keyboard.pickedValue` |
| `legend._handleSymbolClick(item, event)` | `legend._colorPicker.toggle(item.value, trigger)` |
| `legend._flushColorChangeDebounce()` | `legend._colorPicker.flush()` |
| `legend._handleItemKeyDown(e, item, i)` | `legend._keyboard.onItemKeyDown(e, item, i)` |
| `legend._handleDragHandleKeyDown(e, item)` | `legend._keyboard.onHandleKeyDown(e, item)` |
| `legend._focusItem(i)` / `_focusDragHandleForValue(v)` | `legend._keyboard.focusItem(i)` / `.focusHandle(v)` |
| `legend._showShapePicker` | the `.shape-picker-dropdown` element's presence in `legend.shadowRoot` |

(The test files reach privates through a local cast type; add `_colorPicker` / `_keyboard` to that type in the shape the table uses.)

In `packages/core/src/components/legend/legend.color-picker.test.ts`, import the delay:

```ts
import { COLOR_COMMIT_DELAY_MS } from './legend-color-picker';
```

and in "turns three colour inputs within 150 ms into one legend-colormapping-change", replace `vi.advanceTimersByTime(150);` (the advance after the three inputs) with

```ts
    vi.advanceTimersByTime(COLOR_COMMIT_DELAY_MS);
```

This import is the export's consumer; without it knip fails the commit. The test title keeps "150 ms".

- [ ] **Step 6: Run the pins and the tests this task names**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.color-picker.test.ts src/components/legend/legend.keyboard-reorder.test.ts src/components/legend/legend.escape-order.test.ts src/components/legend/legend.double-click.test.ts src/components/legend/controllers/drag-controller.test.ts`
Expected: PASS with the same test counts as Step 1, including "Escape restores the order and announces 'Reordering canceled.'", the one-event colour debounce, the outside-press close and flush, "a mousedown inside that ends outside does not close it", and the picker → Other → settings → reorder Escape order.

- [ ] **Step 7: Run the suites this task affects**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS, the counts of Step 1.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS, the phase baseline counts.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core lint && pnpm knip`
Expected: clean. `COLOR_COMMIT_DELAY_MS` is used by `legend.color-picker.test.ts`; `LegendReorderSnapshot` by `legend.ts`; `ColorPickerOptions` and `LegendKeyboardOptions` are not exported.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning --project=legend-double-click`
Expected: PASS, including the numeric-binning keyboard drag-handle reorders (`firstHandle.focus()`, Space, ArrowDown, Escape) and the three double-click specs.

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-color-picker.ts packages/core/src/components/legend/legend-list.ts`
Expected: `legend.ts` about 300 lines shorter than at Step 1; the two modules under 800. Record the numbers for the report.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend-color-picker.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.escape-order.test.ts
git add packages/core/src/components/legend/legend-color-picker.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.escape-order.test.ts
git commit -m "refactor(core): move the legend's colour picker and keys into controllers"
```

(Name the `clearForNewDataset` flush of (n) in the report as a deviation. Stage only the test files Step 5 changed. The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.5: Move the legend's item and settings computations into pure functions

The computations that only read their inputs move to `legend-items-state.ts`: sort-mode and palette normalisation, the numeric label, colour and manual-order helpers, palette colouring, the display sort, reversing, the manual reorder of visible values, and the resolution of a persisted record into live values. `legend.ts` assigns their results to its `@state` and then runs the same controller syncs in the same order; `perfCounters` stay where they are. The developer architecture page lists the new modules.

**Files:**

- Create: `packages/core/src/components/legend/legend-items-state.ts`, `packages/core/src/components/legend/legend-items-state.test.ts` (unit)
- Modify: `packages/core/src/components/legend/legend.ts`, `docs/developers/architecture.md` (Legend Component section: the modules of 3.2–3.5)

**Interfaces:**

- Consumes: `LegendItem`, `LegendSortMode`, `LegendPersistedSettings`, `LegendAnnotationData` (`./types`); `CategoryScore`, `NumericAnnotationDisplaySettings`, `NumericBinningStrategy`, `COLOR_SCHEMES`, `isGradientPalette`, `getNumericBinLabelMap`, `resolveNumericAnnotationDisplaySettings` (`@protspace/utils`); `explicitShapeSize`, `valueToKey` (`./legend-helpers`); `toInternalValue`, `LEGEND_DEFAULTS`, `LEGEND_VALUES`, `NA_VALUE` (`./config`).
- Produces (`legend-items-state.ts`), each a pure function returning new arrays or objects:
  - `normalizeSortModeForType(mode: LegendSortMode | undefined, isNumeric: boolean): LegendSortMode` (numeric keeps `alpha-*` and `manual*`, else `alpha-asc`; categorical defaults `size-desc`).
  - `normalizeCategoricalPaletteId(id: string | null | undefined): string` (`kellys` for empty or gradient ids).
  - `reverseSortMode(mode: LegendSortMode): LegendSortMode` (`manual` ↔ `manual-reverse`, `-asc` ↔ `-desc`).
  - `sortItemsForDisplay(items: readonly LegendItem[], mode: LegendSortMode, scores: readonly CategoryScore[]): LegendItem[]` (today's `_sortLegendItemsForDisplay`).
  - `reverseKeepingOtherLast(items: readonly LegendItem[]): LegendItem[]` (today's categorical branch of `_reverseZOrder`, zOrders renumbered).
  - `reorderByValues(items: readonly LegendItem[], orderedValues: readonly string[]): LegendItem[]` (the categorical branch of `_commitManualOrderFromVisibleValues`, Other appended last).
  - `applyPaletteColors(items: readonly LegendItem[], paletteId: string): LegendItem[]`; `applyNumericDisplayLabels(items: readonly LegendItem[], annotation: LegendAnnotationData): LegendItem[]`; `applyDerivedNumericColors(items: readonly LegendItem[], annotation: LegendAnnotationData): LegendItem[]`; `numericOrderFromItems(items: readonly LegendItem[]): string[] | undefined` (row ids by zOrder, Other and N/A excluded; undefined when none).
  - `interface ResolvedLegendSettings { maxVisibleValues: number; annotationShapeSize: number | null; hiddenValues: string[]; paletteId: string; sortMode: LegendSortMode; enableDuplicateStackUI: boolean; numeric: (NumericAnnotationDisplaySettings & { manualOrderIds?: string[] }) | null; clearPendingCategories: boolean }`; `resolvePersistedSettings(settings: LegendPersistedSettings, context: { isNumeric: boolean; liveNumeric?: NumericAnnotationDisplaySettings; signatures(binCount: number, strategy: NumericBinningStrategy, paletteId: string, reverseGradient: boolean): { signature: string | null; topologySignature: string | null } }): ResolvedLegendSettings` (the decisions of `_applyPersistedSettings` 2012–2101: signature and topology checks, the 64 cap, normalisation). `legend.ts` imports `ResolvedLegendSettings` to type its result (the type's consumer, for knip).
- `legend.ts` keeps `_applyPersistedSettings`, `_updateLegendItems`, `_rebuildLegendItems`, `_reverseZOrder`, `_commitManualOrderFromVisibleValues` as thin assigners around these; `_normalizeSortModeForAnnotation` stays (it reads `data`). Gone from the element: `_sortLegendItemsForDisplay`, `_normalizeSortModeForEffectiveType`, `_normalizeCategoricalPaletteId`, `_applyPaletteColors`, `_applyNumericDisplayLabels`, `_applyDerivedNumericColors`, `_getNumericDisplayLabelMap`.

**Tests:**

- `legend-items-state.test.ts` (unit): one `describe` per function, including "resolvePersistedSettings caps a stored size of 640 at 64", "treats the filler sizes 10 and 30 as unset", "drops hidden values and the manual order on a topology mismatch", "clears pending categories on a signature mismatch", "normalises a gradient id on a categorical record to kellys and a categorical id on a numeric record to batlow"; "sortItemsForDisplay keeps Other last and unscored categories after scored ones in both directions"; "reverseSortMode maps all eight modes".
- Every legend test passes, 3.1's included; `pnpm perf:counts` passes with the budgets unchanged; `wc -l legend.ts` recorded, lower than after Task 3.4 (expected about 2,150–2,350).

Anchors below name methods; Tasks 3.2–3.4 edit `legend.ts` first. Line numbers are from `7d45ab02`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/legend/legend-items-state.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_SCHEMES,
  type CategoryScore,
  type LegendPersistedSettings,
  type LegendSortMode,
} from '@protspace/utils';
import { LEGEND_VALUES, NA_VALUE } from './config';
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  resolvePersistedSettings,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
} from './legend-items-state';
import type { LegendAnnotationData, LegendItem } from './types';

const OTHER = LEGEND_VALUES.OTHER;

function item(value: string, zOrder: number, patch: Partial<LegendItem> = {}): LegendItem {
  return { value, color: '#000000', shape: 'circle', count: 1, isVisible: true, zOrder, ...patch };
}

const values = (items: readonly LegendItem[]) => items.map((each) => each.value);
const zOrders = (items: readonly LegendItem[]) => items.map((each) => each.zOrder);

function score(category: string, silhouette: number | null): CategoryScore {
  return { category, silhouette, silhouetteEmbedding: null, daviesBouldin: null };
}

function record(patch: Partial<LegendPersistedSettings> = {}): LegendPersistedSettings {
  return {
    maxVisibleValues: 10,
    shapeSize: 10,
    sortMode: 'size-desc',
    hiddenValues: [],
    categories: {},
    enableDuplicateStackUI: false,
    selectedPaletteId: 'kellys',
    ...patch,
  };
}

/** A categorical context: no numeric signatures are ever asked for. */
const categorical = {
  isNumeric: false,
  signatures: () => ({ signature: null, topologySignature: null }),
};

/** A numeric context whose live binning has these signatures. */
function numeric(signature: string, topologySignature: string) {
  return {
    isNumeric: true,
    signatures: vi.fn(() => ({ signature, topologySignature })),
  };
}

const numericRecord = (patch: Partial<LegendPersistedSettings> = {}) =>
  record({
    maxVisibleValues: 7,
    sortMode: 'manual',
    hiddenValues: ['bin-0'],
    selectedPaletteId: 'viridis',
    numericSettings: {
      strategy: 'quantile',
      signature: 'sig',
      topologySignature: 'topo',
      manualOrderIds: ['bin-1', 'bin-0'],
      reverseGradient: true,
    },
    ...patch,
  });

const NUMERIC: LegendAnnotationData = {
  name: 'length',
  kind: 'numeric',
  values: ['bin-0', 'bin-1', null],
  colors: ['#111111', '#222222', '#cccccc'],
  numericMetadata: {
    strategy: 'linear',
    binCount: 2,
    signature: 's',
    topologySignature: 't',
    logSupported: true,
    bins: [
      { id: 'bin-0', label: '1–5', lowerBound: 1, upperBound: 5, count: 2 },
      { id: 'bin-1', label: '5–9', lowerBound: 5, upperBound: 9, count: 1 },
    ],
  },
};

describe('normalizeSortModeForType', () => {
  it('keeps the value and manual orders of a numeric annotation and maps the rest to by value', () => {
    expect(normalizeSortModeForType('alpha-desc', true)).toBe('alpha-desc');
    expect(normalizeSortModeForType('manual-reverse', true)).toBe('manual-reverse');
    expect(normalizeSortModeForType('size-desc', true)).toBe('alpha-asc');
    expect(normalizeSortModeForType('silhouette-desc', true)).toBe('alpha-asc');
    expect(normalizeSortModeForType(undefined, true)).toBe('alpha-asc');
  });

  it('keeps any categorical mode and defaults to by count', () => {
    expect(normalizeSortModeForType('silhouette-asc', false)).toBe('silhouette-asc');
    expect(normalizeSortModeForType(undefined, false)).toBe('size-desc');
  });
});

describe('normalizeCategoricalPaletteId', () => {
  it('maps an empty or gradient id to kellys and keeps a categorical one', () => {
    expect(normalizeCategoricalPaletteId(undefined)).toBe('kellys');
    expect(normalizeCategoricalPaletteId(null)).toBe('kellys');
    expect(normalizeCategoricalPaletteId('')).toBe('kellys');
    expect(normalizeCategoricalPaletteId('viridis')).toBe('kellys');
    expect(normalizeCategoricalPaletteId('okabeIto')).toBe('okabeIto');
  });
});

describe('reverseSortMode', () => {
  it('maps all eight modes', () => {
    const pairs: [LegendSortMode, LegendSortMode][] = [
      ['size-asc', 'size-desc'],
      ['size-desc', 'size-asc'],
      ['alpha-asc', 'alpha-desc'],
      ['alpha-desc', 'alpha-asc'],
      ['manual', 'manual-reverse'],
      ['manual-reverse', 'manual'],
      ['silhouette-desc', 'silhouette-asc'],
      ['silhouette-asc', 'silhouette-desc'],
    ];
    expect(pairs.map(([mode]) => reverseSortMode(mode))).toEqual(pairs.map(([, back]) => back));
  });
});

describe('sortItemsForDisplay', () => {
  const items = [item('A', 0), item(OTHER, 3), item('B', 1), item('C', 2)];

  it('orders by zOrder for every mode but separation, without touching its input', () => {
    const before = values(items);
    expect(values(sortItemsForDisplay(items, 'size-desc', [score('B', 0.9)]))).toEqual([
      'A',
      'B',
      'C',
      OTHER,
    ]);
    expect(values(items)).toEqual(before);
  });

  it('keeps Other last and unscored categories after scored ones in both directions', () => {
    const scores = [score('A', 0.1), score('B', 0.9)];
    expect(values(sortItemsForDisplay(items, 'silhouette-desc', scores))).toEqual([
      'B',
      'A',
      'C',
      OTHER,
    ]);
    expect(values(sortItemsForDisplay(items, 'silhouette-asc', scores))).toEqual([
      'A',
      'B',
      'C',
      OTHER,
    ]);
  });
});

describe('reverseKeepingOtherLast', () => {
  it('reverses the rows by zOrder, keeps Other last and renumbers', () => {
    const reversed = reverseKeepingOtherLast([
      item('A', 0),
      item(OTHER, 3),
      item('B', 1),
      item('C', 2),
    ]);
    expect(values(reversed)).toEqual(['C', 'B', 'A', OTHER]);
    expect(zOrders(reversed)).toEqual([0, 1, 2, 3]);
  });

  it('reverses a legend without Other', () => {
    expect(values(reverseKeepingOtherLast([item('A', 0), item('B', 1)]))).toEqual(['B', 'A']);
  });
});

describe('reorderByValues', () => {
  it('follows the given order, numbers it and appends Other last', () => {
    const reordered = reorderByValues(
      [item('A', 0), item('B', 1), item('C', 2), item(OTHER, 3, { count: 9 })],
      ['C', 'A', 'B'],
    );
    expect(values(reordered)).toEqual(['C', 'A', 'B', OTHER]);
    expect(zOrders(reordered)).toEqual([0, 1, 2, 3]);
    expect(reordered[3].count).toBe(9);
  });

  it('adds no Other when the legend has none', () => {
    expect(values(reorderByValues([item('A', 0), item('B', 1)], ['B', 'A']))).toEqual([
      'B',
      'A',
    ]);
  });
});

describe('applyPaletteColors', () => {
  it('colours rows by their position in the palette and leaves Other and N/A alone', () => {
    const palette = COLOR_SCHEMES.okabeIto;
    const coloured = applyPaletteColors(
      [
        item('A', 0),
        item(OTHER, 1, { color: '#888888' }),
        item('B', 2),
        item(NA_VALUE, 3, { color: '#cccccc' }),
      ],
      'okabeIto',
    );
    expect(coloured.map((each) => each.color)).toEqual([
      palette[0],
      '#888888',
      palette[2],
      '#cccccc',
    ]);
  });

  it('falls back to kellys for an unknown palette', () => {
    expect(applyPaletteColors([item('A', 0)], 'no-such-palette')[0].color).toBe(
      COLOR_SCHEMES.kellys[0],
    );
  });
});

describe('applyNumericDisplayLabels', () => {
  it('labels bins from the annotation and keeps Other, N/A and unknown ids as they were', () => {
    const labelled = applyNumericDisplayLabels(
      [
        item('bin-0', 0),
        item('bin-1', 1, { displayValue: 'old' }),
        item('bin-9', 2, { displayValue: 'kept' }),
        item(OTHER, 3),
        item(NA_VALUE, 4),
      ],
      NUMERIC,
    );
    expect(labelled.map((each) => each.displayValue)).toEqual([
      '1–5',
      '5–9',
      'kept',
      undefined,
      undefined,
    ]);
  });
});

describe('applyDerivedNumericColors', () => {
  it('takes each bin colour from the annotation and leaves Other and N/A alone', () => {
    const coloured = applyDerivedNumericColors(
      [
        item('bin-0', 0),
        item('bin-1', 1),
        item('bin-9', 2, { color: '#999999' }),
        item(NA_VALUE, 3, { color: '#abcdef' }),
        item(OTHER, 4, { color: '#888888' }),
      ],
      NUMERIC,
    );
    expect(coloured.map((each) => each.color)).toEqual([
      '#111111',
      '#222222',
      '#999999',
      '#abcdef',
      '#888888',
    ]);
  });
});

describe('numericOrderFromItems', () => {
  it('lists the bin ids by zOrder without Other and N/A', () => {
    expect(
      numericOrderFromItems([
        item('bin-1', 0),
        item(OTHER, 1),
        item(NA_VALUE, 2),
        item('bin-0', 3),
      ]),
    ).toEqual(['bin-1', 'bin-0']);
  });

  it('is undefined when only Other and N/A are left', () => {
    expect(numericOrderFromItems([item(OTHER, 0), item(NA_VALUE, 1)])).toBeUndefined();
  });
});

describe('resolvePersistedSettings', () => {
  it('reads a categorical record into live values', () => {
    expect(
      resolvePersistedSettings(
        record({
          maxVisibleValues: 8,
          sortMode: 'manual-reverse',
          hiddenValues: ['C'],
          enableDuplicateStackUI: true,
          selectedPaletteId: 'okabeIto',
        }),
        categorical,
      ),
    ).toEqual({
      maxVisibleValues: 8,
      annotationShapeSize: null,
      hiddenValues: ['C'],
      paletteId: 'okabeIto',
      sortMode: 'manual-reverse',
      enableDuplicateStackUI: true,
      numeric: null,
      clearPendingCategories: false,
    });
  });

  it('caps a stored size of 640 at 64', () => {
    expect(resolvePersistedSettings(record({ shapeSize: 640 }), categorical).annotationShapeSize).toBe(
      64,
    );
    expect(resolvePersistedSettings(record({ shapeSize: 24 }), categorical).annotationShapeSize).toBe(
      24,
    );
  });

  it('treats the filler sizes 10 and 30 as unset', () => {
    expect(resolvePersistedSettings(record({ shapeSize: 10 }), categorical).annotationShapeSize).toBe(
      null,
    );
    expect(resolvePersistedSettings(record({ shapeSize: 30 }), categorical).annotationShapeSize).toBe(
      null,
    );
  });

  it('reads a numeric record whose signatures match, asking for them with the resolved binning', () => {
    const context = numeric('sig', 'topo');
    const resolved = resolvePersistedSettings(numericRecord(), context);
    expect(context.signatures).toHaveBeenCalledWith(7, 'quantile', 'viridis', true);
    expect(resolved).toEqual({
      maxVisibleValues: 7,
      annotationShapeSize: null,
      hiddenValues: ['bin-0'],
      paletteId: 'viridis',
      sortMode: 'manual',
      enableDuplicateStackUI: false,
      numeric: {
        binCount: 7,
        strategy: 'quantile',
        paletteId: 'viridis',
        reverseGradient: true,
        manualOrderIds: ['bin-1', 'bin-0'],
      },
      clearPendingCategories: true,
    });
  });

  it('drops hidden values and the manual order on a topology mismatch', () => {
    const resolved = resolvePersistedSettings(numericRecord(), numeric('sig', 'other-topology'));
    expect(resolved.hiddenValues).toEqual([]);
    expect(resolved.numeric?.manualOrderIds).toBeUndefined();
  });

  it('clears pending categories on a signature mismatch', () => {
    const resolved = resolvePersistedSettings(numericRecord(), numeric('other-signature', 'topo'));
    expect(resolved.clearPendingCategories).toBe(true);
    // The topology still matches, so what the user hid and ordered survives a recolour.
    expect(resolved.hiddenValues).toEqual(['bin-0']);
    expect(resolved.numeric?.manualOrderIds).toEqual(['bin-1', 'bin-0']);
    expect(resolvePersistedSettings(record(), categorical).clearPendingCategories).toBe(false);
  });

  it('normalises a gradient id on a categorical record to kellys and a categorical id on a numeric record to batlow', () => {
    expect(
      resolvePersistedSettings(record({ selectedPaletteId: 'viridis' }), categorical).paletteId,
    ).toBe('kellys');
    const resolved = resolvePersistedSettings(
      numericRecord({ selectedPaletteId: 'kellys' }),
      numeric('sig', 'topo'),
    );
    expect(resolved.paletteId).toBe('batlow');
    expect(resolved.numeric?.paletteId).toBe('batlow');
  });

  it('normalises the stored sort mode by type', () => {
    expect(
      resolvePersistedSettings(numericRecord({ sortMode: 'size-desc' }), numeric('sig', 'topo'))
        .sortMode,
    ).toBe('alpha-asc');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-items-state.test.ts`
Expected: FAIL: `Failed to resolve import "./legend-items-state"`; the module does not exist yet.

- [ ] **Step 3: Write the pure functions**

Create `packages/core/src/components/legend/legend-items-state.ts`. Each body is the element code it replaces, with `this.*` reads turned into parameters:

```ts
import {
  COLOR_SCHEMES,
  getNumericBinLabelMap,
  isGradientPalette,
  resolveNumericAnnotationDisplaySettings,
  type CategoryScore,
  type NumericAnnotationDisplaySettings,
  type NumericBinningStrategy,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, LEGEND_VALUES, NA_VALUE, toInternalValue } from './config';
import { explicitShapeSize, valueToKey } from './legend-helpers';
import type {
  LegendAnnotationData,
  LegendItem,
  LegendPersistedSettings,
  LegendSortMode,
} from './types';

/**
 * The legend's computations that only read their inputs. `legend.ts` assigns what they return to
 * its state and runs the plot syncs itself, so none of these touches the element, the plot or
 * storage.
 */

const isSpecial = (value: string): boolean => value === LEGEND_VALUES.OTHER || value === NA_VALUE;

/** A sort mode the annotation's type supports: numeric legends sort by value or by hand. */
export function normalizeSortModeForType(
  mode: LegendSortMode | undefined,
  isNumeric: boolean,
): LegendSortMode {
  if (isNumeric) {
    return mode === 'alpha-asc' || mode === 'alpha-desc' || mode === 'manual' || mode === 'manual-reverse'
      ? mode
      : 'alpha-asc';
  }
  return mode ?? 'size-desc';
}

/** A categorical palette id: a gradient or a missing id falls back to Kelly's colours. */
export function normalizeCategoricalPaletteId(id: string | null | undefined): string {
  return !id || isGradientPalette(id) ? 'kellys' : id;
}

/** The same order the other way round: `manual` ↔ `manual-reverse`, `-asc` ↔ `-desc`. */
export function reverseSortMode(mode: LegendSortMode): LegendSortMode {
  if (mode === 'manual') return 'manual-reverse';
  if (mode === 'manual-reverse') return 'manual';
  return (
    mode.endsWith('-asc') ? mode.replace('-asc', '-desc') : mode.replace('-desc', '-asc')
  ) as LegendSortMode;
}

/**
 * Display order for the legend list. Every mode but the separation sorts has already been applied
 * upstream and is carried by `zOrder`; scores arrive too late for that path, so they are applied
 * here. Deliberately display-only: bucket membership stays size-driven, so switching sort never
 * changes which categories are visible.
 */
export function sortItemsForDisplay(
  items: readonly LegendItem[],
  mode: LegendSortMode,
  scores: readonly CategoryScore[],
): LegendItem[] {
  const sorted = [...items];
  if (mode !== 'silhouette-desc' && mode !== 'silhouette-asc') {
    return sorted.sort((a, b) => a.zOrder - b.zOrder);
  }
  // Indexed once rather than a `.find()` per comparison: the comparator runs
  // O(items · log items) times and the scan is O(categories), so a legend with a few
  // hundred categories paid hundreds of thousands of string compares per rebuild.
  const scoreByCategory = new Map(scores.map((score) => [score.category, score.silhouette]));
  const scoreOf = (value: string): number =>
    scoreByCategory.get(value) ?? Number.NEGATIVE_INFINITY;
  // Ascending is the reverse of best-first. Unscored categories keep sorting last either way:
  // they sit at -Infinity, so the ascending branch negates only the scored gap.
  const descending = mode === 'silhouette-desc';
  return sorted.sort((a, b) => {
    // "Other" is a bucket, not a category, so it has no score and stays last.
    if (a.value === LEGEND_VALUES.OTHER) return 1;
    if (b.value === LEGEND_VALUES.OTHER) return -1;
    const scoreA = scoreOf(a.value);
    const scoreB = scoreOf(b.value);
    const unscored = scoreA === Number.NEGATIVE_INFINITY || scoreB === Number.NEGATIVE_INFINITY;
    const diff = unscored || descending ? scoreB - scoreA : scoreA - scoreB;
    // `||` (not `!== 0 ? … :`) so an unscored pair, where diff is NaN, also falls
    // through to the zOrder tiebreak instead of coercing to a no-op comparator.
    return diff || a.zOrder - b.zOrder;
  });
}

/** The rows by zOrder the other way round, Other still last, zOrders renumbered from 0. */
export function reverseKeepingOtherLast(items: readonly LegendItem[]): LegendItem[] {
  const sorted = [...items].sort((a, b) => a.zOrder - b.zOrder);
  const other = sorted.find((each) => each.value === LEGEND_VALUES.OTHER);
  const reversed = sorted.filter((each) => each.value !== LEGEND_VALUES.OTHER).reverse();
  return (other ? [...reversed, other] : reversed).map((each, index) => ({
    ...each,
    zOrder: index,
  }));
}

/** The rows in `orderedValues` order, numbered by position there, with Other appended last. */
export function reorderByValues(
  items: readonly LegendItem[],
  orderedValues: readonly string[],
): LegendItem[] {
  const byValue = new Map(items.map((each) => [each.value, each]));
  const other = byValue.get(LEGEND_VALUES.OTHER);
  const reordered = orderedValues
    .map((value, index) => {
      const found = byValue.get(value);
      return found ? { ...found, zOrder: index } : null;
    })
    .filter((each): each is LegendItem => each !== null);
  if (other) reordered.push({ ...other, zOrder: reordered.length });
  return reordered;
}

/** A categorical palette over the rows by position; Other and N/A keep their fixed colours. */
export function applyPaletteColors(items: readonly LegendItem[], paletteId: string): LegendItem[] {
  const palette = COLOR_SCHEMES[paletteId as keyof typeof COLOR_SCHEMES] || COLOR_SCHEMES.kellys;
  return items.map((each, index) =>
    isSpecial(each.value) ? each : { ...each, color: palette[index % palette.length] },
  );
}

/** Each numeric bin's label from the annotation; Other, N/A and unknown ids keep theirs. */
export function applyNumericDisplayLabels(
  items: readonly LegendItem[],
  annotation: LegendAnnotationData,
): LegendItem[] {
  const labels = getNumericBinLabelMap(annotation);
  return items.map((each) =>
    isSpecial(each.value)
      ? each
      : { ...each, displayValue: labels.get(each.value) ?? each.displayValue ?? each.value },
  );
}

/** Each numeric bin's colour from the annotation's gradient; Other and N/A keep theirs. */
export function applyDerivedNumericColors(
  items: readonly LegendItem[],
  annotation: LegendAnnotationData,
): LegendItem[] {
  const derived = new Map(
    annotation.values.map((value, index) => [
      valueToKey(toInternalValue(value)),
      annotation.colors?.[index] ?? '',
    ]),
  );
  return items.map((each) => {
    if (isSpecial(each.value)) return each;
    const color = derived.get(each.value);
    return color ? { ...each, color } : each;
  });
}

/**
 * The bin ids in display order (by zOrder), for a numeric manual order. Other (synthetic) and N/A
 * (locked to the end) have no position of their own, so they are left out; undefined when no bin
 * is left.
 */
export function numericOrderFromItems(items: readonly LegendItem[]): string[] | undefined {
  const ids = items
    .filter((each) => !isSpecial(each.value))
    .sort((a, b) => a.zOrder - b.zOrder)
    .map((each) => each.value);
  return ids.length > 0 ? ids : undefined;
}

/** A persisted legend record as live values, decided but not yet applied. */
export interface ResolvedLegendSettings {
  maxVisibleValues: number;
  /** The annotation's own size, capped at the dialog's bound; null for a filler (unset). */
  annotationShapeSize: number | null;
  hiddenValues: string[];
  paletteId: string;
  sortMode: LegendSortMode;
  enableDuplicateStackUI: boolean;
  /** Numeric annotations only: the binning to keep, and the manual order if it still applies. */
  numeric: (NumericAnnotationDisplaySettings & { manualOrderIds?: string[] }) | null;
  /** Stored category colours and shapes no longer apply (numeric, or a changed binning). */
  clearPendingCategories: boolean;
}

/**
 * Decides what a stored record means for the selected annotation. A numeric record carries the
 * signatures of the binning it was saved under: a changed signature drops the stored colours, and
 * a changed topology (different bins) also drops what was hidden and the manual order, which
 * name bins that no longer exist.
 */
export function resolvePersistedSettings(
  settings: LegendPersistedSettings,
  context: {
    isNumeric: boolean;
    liveNumeric?: NumericAnnotationDisplaySettings;
    signatures(
      binCount: number,
      strategy: NumericBinningStrategy,
      paletteId: string,
      reverseGradient: boolean,
    ): { signature: string | null; topologySignature: string | null };
  },
): ResolvedLegendSettings {
  const { isNumeric } = context;
  const { settings: numericSettings } = resolveNumericAnnotationDisplaySettings({
    persistedSettings: settings,
    liveSettings: context.liveNumeric,
    defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
  });
  const paletteId = isNumeric
    ? numericSettings.paletteId
    : normalizeCategoricalPaletteId(settings.selectedPaletteId);
  const maxVisibleValues = isNumeric ? numericSettings.binCount : settings.maxVisibleValues;
  const strategy = numericSettings.strategy;
  const reverseGradient = numericSettings.reverseGradient ?? false;

  const stored = isNumeric ? settings.numericSettings : undefined;
  const live = stored
    ? context.signatures(maxVisibleValues, strategy, paletteId, reverseGradient)
    : null;
  const signatureMatches = !stored || stored.signature === live?.signature;
  const topologyMatches = !stored || stored.topologySignature === live?.topologySignature;

  // Capped here, not only when resolved: the record and the export keep this value.
  const ownShapeSize = explicitShapeSize(settings.shapeSize);
  return {
    maxVisibleValues,
    annotationShapeSize:
      ownShapeSize === null ? null : Math.min(ownShapeSize, LEGEND_DEFAULTS.maxSymbolSize),
    hiddenValues: topologyMatches ? [...settings.hiddenValues] : [],
    paletteId,
    sortMode: normalizeSortModeForType(settings.sortMode, isNumeric),
    enableDuplicateStackUI: settings.enableDuplicateStackUI,
    numeric: isNumeric
      ? {
          binCount: maxVisibleValues,
          strategy,
          paletteId,
          reverseGradient,
          manualOrderIds: topologyMatches ? settings.numericSettings?.manualOrderIds : undefined,
        }
      : null,
    clearPendingCategories: isNumeric || !signatureMatches,
  };
}
```

(`clearPendingCategories` is `isNumeric || !signatureMatches` because today the element clears on a signature mismatch and then again for every numeric record; a mismatch implies numeric, so the two collapse, but the expression keeps both reasons legible.)

- [ ] **Step 4: Run the new tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-items-state.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Make the legend assign their results**

All edits are in `packages/core/src/components/legend/legend.ts`.

(a) Imports. Add:

```ts
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  resolvePersistedSettings,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
  type ResolvedLegendSettings,
} from './legend-items-state';
```

Remove `COLOR_SCHEMES` and `isGradientPalette` from the `@protspace/utils` import and `explicitShapeSize` from the `./legend-helpers` import (their only users move). Keep `getNumericBinLabelMap`, `resolveNumericAnnotationDisplaySettings` (`_syncNumericSettingsFromPersistence` still uses it), `toInternalValue` and `valueToKey`.

(b) `_persistenceController`'s `getCurrentSettings`: replace

```ts
        sortMode: this._normalizeSortModeForEffectiveType(
          this._annotationSortModes[this.selectedAnnotation],
          isNumericAnnotation,
        ),
```

with

```ts
        sortMode: normalizeSortModeForType(
          this._annotationSortModes[this.selectedAnnotation],
          isNumericAnnotation,
        ),
```

and `: this._normalizeCategoricalPaletteId(this._selectedPaletteId),` with `: normalizeCategoricalPaletteId(this._selectedPaletteId),`.

(c) `_dragController`'s `setLegendItems`: replace the `orderedIds` block inside `if (this._isNumericAnnotation()) { … }` with (the comment stays):

```ts
      if (this._isNumericAnnotation()) {
        // Exclude Other (synthetic) and NA (locked to legend end regardless of
        // sort) from the persisted manual order — they have no observable
        // position effect and would clutter the saved state.
        this._setNumericManualOrderIds(this.selectedAnnotation, numericOrderFromItems(items));
      }
```

(`_setNumericManualOrderIds` treats undefined and `[]` alike: both delete the entry.)

(d) `_commitManualOrderFromVisibleValues`: delete

```ts
    const itemMap = new Map(this._legendItems.map((item) => [item.value, item]));
    const otherItem = itemMap.get(LEGEND_VALUES.OTHER);
```

and replace the `else` branch (from `const reorderedItems = visibleOrder` to `this._legendItems = reorderedItems;`) with

```ts
    } else {
      this._legendItems = reorderByValues(this._legendItems, visibleOrder);
    }
```

(e) Delete `_sortLegendItemsForDisplay` with its doc comment (845–880 at `7d45ab02`). In `updated()`, the line under `// Update sorted items cache when legend items or their scores change` becomes

```ts
      this._sortedLegendItems = sortItemsForDisplay(
        this._legendItems,
        this._currentSortMode,
        this._categoryScores,
      );
```

(f) Delete `_getNumericDisplayLabelMap`. In `_updateLegendItems`, `const numericDisplayLabels = this._getNumericDisplayLabelMap();` becomes

```ts
      const numericDisplayLabels = getNumericBinLabelMap(this.annotationData);
```

(g) `_buildNumericManualOrderIds`: replace its last two statements (`const visibleIds = …` through `return visibleIds.length > 0 ? visibleIds : undefined;`) with

```ts
    return numericOrderFromItems(this._legendItems);
```

(h) Delete `_applyNumericDisplayLabels` and `_applyDerivedNumericColors`. In `_updateLegendItems`, replace

```ts
      if (isNumericAnnotation) {
        this._applyNumericDisplayLabels();
        this._applyDerivedNumericColors();
      } else if (this._selectedPaletteId !== 'kellys') {
        this._applyPaletteColors(this._selectedPaletteId);
      }
```

with

```ts
      if (isNumericAnnotation) {
        // Only once the annotation itself reads as numeric: a plot-side numeric column whose
        // legend data has not caught up yet keeps the processor's labels and colours.
        if (this._isNumericAnnotation()) {
          this._legendItems = applyDerivedNumericColors(
            applyNumericDisplayLabels(this._legendItems, this.annotationData),
            this.annotationData,
          );
        }
      } else if (this._selectedPaletteId !== 'kellys') {
        this._legendItems = applyPaletteColors(this._legendItems, this._selectedPaletteId);
      }
```

(The removed methods each returned early unless `_isNumericAnnotation()`; `_applyPaletteColors` returned early when it was true, which cannot hold in the categorical branch, since `_isCurrentAnnotationNumeric()` includes it.) The `perfCounters.legendUpdate++` first line stays where it is.

(i) Replace the body of `_applyPersistedSettings` (keep the method, its name and its `catch`):

```ts
  private _applyPersistedSettings(settings: LegendPersistedSettings): void {
    try {
      const resolved: ResolvedLegendSettings = resolvePersistedSettings(settings, {
        isNumeric: this._isCurrentAnnotationNumeric(),
        liveNumeric: this._numericSettingsByAnnotation[this.selectedAnnotation],
        signatures: (binCount, strategy, paletteId, reverseGradient) =>
          this._computeNumericSettingsSignatures(binCount, strategy, paletteId, reverseGradient),
      });

      if (resolved.clearPendingCategories) {
        this._persistenceController.clearPendingCategories();
      }
      this.maxVisibleValues = resolved.maxVisibleValues;
      this._annotationShapeSize = resolved.annotationShapeSize;
      this.shapeSize = this._resolveShapeSize();
      this._hiddenValues = resolved.hiddenValues;
      this._selectedPaletteId = resolved.paletteId;

      if (resolved.numeric) {
        const { manualOrderIds, ...numericSettings } = resolved.numeric;
        this._numericSettingsByAnnotation = {
          ...this._numericSettingsByAnnotation,
          [this.selectedAnnotation]: numericSettings,
        };
        this._setNumericManualOrderIds(this.selectedAnnotation, manualOrderIds);
      }

      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: resolved.sortMode,
      };

      this._scatterplotController.updateConfig({
        pointSize: calculatePointSize(this.shapeSize),
        enableDuplicateStackUI: resolved.enableDuplicateStackUI,
      });
      this._scatterplotController.syncNumericAnnotationSettings();
    } catch (error) {
      this._dispatchError(
        'Failed to apply persisted settings',
        'persistence',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
```

(Both of today's `clearPendingCategories()` calls become the one at the top: nothing between the two old calls read the pending categories, so clearing first is the same.)

(j) Delete `_normalizeSortModeForEffectiveType` and `_normalizeCategoricalPaletteId` (2167–2191). `_normalizeSortModeForAnnotation` ends with `return normalizeSortModeForType(sortMode, isNumeric);`.

(k) `_reverseZOrder`: replace the mode switch and the categorical reverse. From `// Toggle direction: asc <-> desc, or manual <-> manual-reverse` through the end of the `if (!this._isNumericAnnotation()) { … } else { this._updateLegendItems(); }` block becomes:

```ts
    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: reverseSortMode(currentMode),
    };

    if (!this._isNumericAnnotation()) {
      // Always reverse the visible items directly, keeping "Other" at the end.
      this._legendItems = reverseKeepingOtherLast(this._legendItems);
    } else {
      this._updateLegendItems();
    }
```

The numeric manual-order seeding above it and the syncs below it stay.

(l) Delete `_applyPaletteColors` (2738–2753).

(m) The other callers of the two normalisers (`_handleCustomize`, `_handleSettingsSave`, `_handlePaletteChange`, `_renderSettingsDialog` at `7d45ab02`): replace each `this._normalizeCategoricalPaletteId(` with `normalizeCategoricalPaletteId(` and each `this._normalizeSortModeForEffectiveType(` with `normalizeSortModeForType(`.

Then:

Run: `grep -nE "_sortLegendItemsForDisplay|_normalizeSortModeForEffectiveType|_normalizeCategoricalPaletteId|_applyPaletteColors|_applyNumericDisplayLabels|_applyDerivedNumericColors|_getNumericDisplayLabelMap" packages/core/src`
Expected: no output (no test reached them, so none needs a rename).

- [ ] **Step 6: List the legend modules in the developer docs**

In `docs/developers/architecture.md`, under `## Legend Component`, replace the first paragraph ("The legend component uses a controller-based architecture for separation of concerns.") with:

```markdown
The legend is one element, `protspace-legend`, with one shadow root: its rows must be direct
children of one list for drag-and-drop, and the e2e, perf and tour code reach rows through
`legend.shadowRoot`. The element holds the state and the wiring; the rest lives beside it in
`packages/core/src/components/legend/`:

| Module | Holds |
| --- | --- |
| `legend.ts` | Properties, state, controller wiring, lifecycle, public API, the data pipeline and item actions |
| `legend-header.ts` | The header template |
| `legend-row.ts` | The legend symbol and the row template |
| `legend-list.ts` | The list template and `LegendKeyboardController` (row keys and keyboard reorder) |
| `legend-score-strips.ts` | Score-strip points and the strips section |
| `legend-eat-controls.ts` | `EatReliabilityController` and the EAT section |
| `legend-color-picker.ts` | `ColorPickerController`: the colour and shape picker |
| `legend-items-state.ts` | Pure functions: sort, palette and numeric helpers, and the reading of a stored record |

Templates take explicit view models and handlers; controllers are Lit reactive controllers that
keep their own transient state and timers; the pure functions return new arrays that `legend.ts`
assigns before it syncs the plot.
```

Keep the `### Controllers` subsection and everything after it.

- [ ] **Step 7: Run the legend tests, the size check and the counts**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS, the counts of the previous task plus 24, including all of `legend.persistence-compat.test.ts` (3.1: the legacy record's round trip and the key and field set), `legend-settings-dialog.test.ts` (it calls `_applyPersistedSettings`, which stays), `legend.shape-size.test.ts`, `legend.score-strips.test.ts` and `legend.score-sync.test.ts` (separation sort through `sortItemsForDisplay`).

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-items-state.ts`
Expected: `legend.ts` shorter than after Task 3.4 (about 2,150–2,350 lines); `legend-items-state.ts` under 800. Do not move other code to make it shorter: record the count in the report; the remaining bulk is the data pipeline (Task 8.1) and the dialog glue that 3.10 and 3.12 delete.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS, the baseline counts plus this phase's new tests.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core lint && pnpm knip`
Expected: clean. Every export of `legend-items-state.ts` is imported by `legend.ts` (`ResolvedLegendSettings` types `_applyPersistedSettings`'s result) and by the test.

Run (sandbox disabled; `pnpm perf:fetch --only phosphatase` once first if `perf/datasets/phosphatase.parquetbundle` is missing): `pnpm perf:counts`
Expected: PASS with `apps/web/tests/perf/budgets.json` unchanged: `legendUpdate` and `legendRebuild` load 7/7, idle 0/0, annotation-switch 2/2, and the other segments as recorded.

Run: `pnpm docs:build`
Expected: the docs build passes with the new table.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend-items-state.ts packages/core/src/components/legend/legend-items-state.test.ts packages/core/src/components/legend/legend.ts docs/developers/architecture.md
git add packages/core/src/components/legend/legend-items-state.ts packages/core/src/components/legend/legend-items-state.test.ts packages/core/src/components/legend/legend.ts docs/developers/architecture.md
git commit -m "refactor(core): move legend item and settings logic to pure functions"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.6: Legend rows: 28 px, truncated names, hover actions, hidden state

Rows take the mockup's shape (decision 12): the swatch and the name inside the main button, the name on one line ending in an ellipsis (the full name stays in the button's accessible name), the count right-aligned in tabular figures, and on hover or focus an eye, the drag handle and a "⋯" menu with "Show only this" and "Colour and shape". Hidden rows stay dimmed with a crossed-out eye. Keyboard reorder shows the picked row. Counts are grouped and plural-aware. Under a coarse pointer rows are 40 px with the actions always shown. The row styles leave the legacy `item.ts` for a clean `styles/row.ts`. The roving Tab stop, the name tooltip and the e2e legend helpers follow in Task 3.7; until then the first row's controls hold the list's Tab stop, as the first row's main button does today.

**Files:**

- Create: `packages/core/src/utils/count-text.ts`, `packages/core/src/utils/count-text.test.ts` (unit)
- Create: `packages/core/src/components/legend/styles/row.ts`, `packages/core/src/components/legend/legend.rows.test.ts` (unit), `packages/core/src/components/legend/legend.rows.browser.test.ts`, `packages/core/src/components/legend/test-support/popover-stub.ts` (jsdom has no popover API; three jsdom files open the row menu)
- Modify: `legend-row.ts`, `legend.ts`, `legend.styles.ts`, `styles/item.ts` (row, handle, symbol, text, count and Sortable rules leave; picker rules stay), `config.ts` (`legendDisplaySize: 10`), `legend-helpers.ts` + `legend-helpers.test.ts` (`getItemClasses`), `packages/core/src/components/kit/icon.ts` (`eye`, `eye-off`, `grip-vertical`, `ellipsis`) (all legend paths under `packages/core/src/components/legend/`)
- Modify tests: `legend.dom-contract.test.ts` (name pattern, no symbol button), `legend.color-picker.test.ts` (opens the picker by clicking a row's "⋯" and dispatching `ps-select` `{ value: 'customize' }` on the row menu, since jsdom cannot show the menu, instead of a symbol click), `legend.keyboard-reorder.test.ts` (announcement uses the display name), `legend.escape-order.test.ts` (opens the picker the same way: its symbol button is gone)
- Modify: `apps/web/tests/numeric-binning.spec.ts` (the long-label test "long categorical legend labels wrap instead of clipping")

**Interfaces:**

- Consumes: 3.2's `renderLegendList`, `renderLegendSymbol`, `renderLegendRow` (replaced here) and `_renderLegendItem(item, sortedIndex)`; 3.4's `LegendKeyboardController` (`pickedValue`, `onItemKeyDown(e, item, index)`, `onHandleKeyDown(e, item)`, and its `annotationName` option) and `ColorPickerController` (`value: string | null`, the open row; `toggle(value, anchor)`); `annotationLabel` (`@protspace/utils`); `ps-menu`, `ps-menu-item`, `PsMenu` (`../kit/menu`), `PsPopover` (`../kit/popover`, tests); `icon()` (`../kit/icon`); `reducedMotion` (`../kit/kit-shared.styles`); 3.1's `categoricalData`, `numericData`, `TWELVE` (`test-support/legend-fixtures.ts`); `cdp` (`vitest/browser`, the coarse-pointer case); `numeric-binning.spec.ts`'s own setup (`STARTUP_URL_GLOB`, `loadBundleFromBytes`, `RAW_NUMERIC_BUNDLE_PATH`, `waitForAnnotationAvailable`, `waitForLegendAnnotation`, `selectAnnotation`, `dismissTourIfPresent`).
- Produces:
  - `count-text.ts`: `formatCount(n: number): string` (cached `Intl.NumberFormat('en-US')`: "1,234"); `countNoun(n: number, one: string, other: string): string` (cached `Intl.PluralRules('en-US')`: "1 protein", "1,234 proteins").
  - `legend-helpers.ts`: `getItemClasses(item: LegendItem, isSelected: boolean, isPicked: boolean): string` (the unused `dragging` parameter becomes `picked`, adding class `picked`).
  - `legend-row.ts`: `LegendRowView` becomes `{ classes: string; selected: boolean; symbolSize: number; otherCount?: number; tabbable: boolean; draggable: boolean; picked: boolean; hasMenu: boolean }`; `LegendRowHandlers` becomes `{ onClick(e: MouseEvent): void; onDoubleClick(): void; onKeyDown(e: KeyboardEvent): void; onHandleKeyDown(e: KeyboardEvent): void; onHover(category: string | null): void; onToggle(): void; onMenu(e: MouseEvent): void; onViewOther(e: Event): void }` (Task 3.7 adds `onFocus` and `onNamePointerEnter`). Row DOM (in order): `div.legend-item[...contract]` > `button.legend-item-main[aria-label="{label}: {countNoun(n, 'protein', 'proteins')}, {shown|hidden}"][aria-pressed][tabindex]` holding `span.legend-swatch[part=symbol]` (the 16 px SVG) and `span.legend-text[part=text]`; on Other `button.view-button` "View" (`aria-label="View items grouped under Other"`); on a hidden row `span.legend-hidden-mark[aria-hidden=true]` (`eye-off`, 14 px); `span.legend-count[part=count]` (`formatCount`); `span.legend-item-actions` > `button.legend-action.legend-eye` ("Hide {display value}" / "Show {display value}", `eye` / `eye-off`), `button.drag-handle` (`grip-vertical`; "Reorder {display value}" or "{display value} cannot be reordered" as before; `aria-pressed` "true" while picked and "false" otherwise on a movable row; `.drag-handle-disabled` and `disabled` for Other), and, when `hasMenu`, `button.legend-action.legend-more` ("More actions for {display value}", `ellipsis`). The Other row's label is `Other · {countNoun(otherCount, 'category', 'categories')}`; its actions use the display value ("Hide Other"). Every action stops `click`, `dblclick` and `mousedown` from reaching the row and the container. No element of the row has a `title` (the View button's goes). `tabbable` rows get `tabindex="0"` on the main button, View and the actions; all others `-1` (in this task `tabbable` is "the first row", today's rule for the main button). `renderLegendSymbol` keeps its signature and draws with 3 px padding.
  - `legend.ts`: `@state() _rowMenu: { value: string; anchor: HTMLElement } | null`; `_rowMenuTarget: string | null` (the row the menu last opened for: `ps-menu` closes itself before it dispatches `ps-select`); one `<ps-menu class="row-menu" label="Actions for {display value}">` at the end of `.legend-container` (`_renderRowMenu()`) with `ps-menu-item value="isolate"` ("Show only this", or "Show all" when the row is the only visible one) and, unless the row is Other or the annotation numeric, `value="customize"` ("Colour and shape", which opens the colour picker on the row element unless it is already open there); `isolate` runs `_handleItemDoubleClick(value)` (dispatches `'isolate'`); the menu closes when `_sortedLegendItems` changes. Announcements use `annotationLabel` ("Moved {label}. Switched {display name} to Manual order.") through a `_annotationDisplayName` getter, which is also the keyboard controller's `annotationName`. After a pointer drop, focus goes to the dropped row's handle, as today.
  - `styles/row.ts` (`rowStyles`): row, swatch, label, count, hidden, picked (`--ps-accent-tint`), selected (symbol stroke `--ps-accent`), focus (the `focusRing` look, inset), actions revealed with `opacity` and `pointer-events` on `.legend-item:hover` and `:focus-within` and always on `@media (pointer: coarse)` (rows `min-height: var(--ps-touch-target)` there), never `display: none` or `visibility: hidden`; Sortable states `.legend-item-ghost`, `-chosen`, `-drag`, `-fallback`, `-merge-target` and the drop highlight on tokens; `--ps-duration-fast` transitions, zeroed by `reducedMotion`, which `legendStyles` gains.
  - `test-support/popover-stub.ts`: `stubPopoverApi(): void` (adds no-op `showPopover` / `hidePopover` to `HTMLElement.prototype` when missing).

**Tests:**

- `count-text.test.ts` (unit): "groups thousands" (0, 1, 2, 1234, 123456); "picks one or other by plural rules" (0, 1, 2).
- `legend.rows.test.ts` (unit, jsdom): "a row is named '{label}: 1 protein, shown'" and "'{label}: 1,234 proteins, hidden'"; "the count reads 1,234"; "the Other row reads 'Other · 1 category' / 'Other · 2 categories'"; "the eye toggles and dispatches toggle, and is named Show on a hidden row"; "a hidden row keeps .hidden, stays listed and shows the hidden mark"; "the menu offers Show only this and Colour and shape; Other has no ⋯; numeric rows offer only Show only this"; "Show only this dispatches isolate; on the only visible row it reads Show all"; "Space on the handle adds .picked and aria-pressed; Escape removes them".
- `legend.rows.browser.test.ts` (browser): "a row is 28 px tall"; "at 240 px a 70-character name stays on one line, ends in an ellipsis, and the count of 123,456 is fully visible" (Review Focus 5); "the actions are transparent at rest and opaque on hover and focus-within, and never move the label"; "the ⋯ menu opens on its button, and Show only this isolates"; "under a coarse pointer rows are 40 px and the actions always show" (Review Focus 5).
- Updated: `legend.dom-contract.test.ts`, `legend.color-picker.test.ts`, `legend.keyboard-reorder.test.ts`, `legend.escape-order.test.ts`, `legend-helpers.test.ts` (`getItemClasses`); `legend.double-click.test.ts` passes unchanged.
- `numeric-binning.spec.ts`: "long categorical legend labels wrap instead of clipping" becomes "long categorical legend labels end in an ellipsis on one line" (height equals one line, `scrollWidth > clientWidth`, full name in the button's name). Its two `.legend-count` readers need nothing: `readLegendDisplay` compares counts between its own reads, and the reader that sorts by count strips non-digits.
- `legend-double-click`, `numeric-binning`, `perf-counts` (including `legend-isolate`) pass unchanged; the legend helpers in `apps/web/tests/helpers/explore.ts` keep working (rows keep `data-value`, `.hidden` and the `{label}:` name prefix).

Anchors below name functions and test titles; 3.2–3.5 edit the legend files first.

- [ ] **Step 1: Write the failing count-text test**

Create `packages/core/src/utils/count-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countNoun, formatCount } from './count-text';

describe('formatCount', () => {
  it('groups thousands', () => {
    expect([0, 1, 2, 1234, 123456].map((n) => formatCount(n))).toEqual([
      '0',
      '1',
      '2',
      '1,234',
      '123,456',
    ]);
  });
});

describe('countNoun', () => {
  it('picks one or other by plural rules', () => {
    expect(countNoun(0, 'protein', 'proteins')).toBe('0 proteins');
    expect(countNoun(1, 'protein', 'proteins')).toBe('1 protein');
    expect(countNoun(2, 'protein', 'proteins')).toBe('2 proteins');
    expect(countNoun(1234, 'category', 'categories')).toBe('1,234 categories');
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/utils/count-text.test.ts`
Expected: FAIL: `Failed to resolve import "./count-text"`.

- [ ] **Step 2: Write `count-text.ts`**

Create `packages/core/src/utils/count-text.ts`:

```ts
/**
 * Counts as people read them (design decision 15): digits grouped ("1,234") and nouns that follow
 * the plural rules ("1 protein", "2 proteins"). en-US, as the rest of the interface. Each formatter
 * is built once: building an Intl object costs far more than using one, and the legend formats a
 * count per row on every render.
 */
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const PLURAL_RULES = new Intl.PluralRules('en-US');

/** The count with its thousands grouped: 1234 → "1,234". */
export function formatCount(n: number): string {
  return NUMBER_FORMAT.format(n);
}

/** The grouped count and the noun that agrees with it: (1, 'protein', 'proteins') → "1 protein". */
export function countNoun(n: number, one: string, other: string): string {
  return `${formatCount(n)} ${PLURAL_RULES.select(n) === 'one' ? one : other}`;
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/utils/count-text.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Write the failing unit tests for rows**

Create `packages/core/src/components/legend/test-support/popover-stub.ts`:

```ts
/**
 * jsdom has no popover API. A ps-menu or ps-popover only needs the two calls to exist to open in a
 * jsdom test (positioning runs on zero-sized boxes there); anything that checks what is shown,
 * where, or which layer is on top belongs in a *.browser.test.ts.
 */
export function stubPopoverApi(): void {
  if (typeof HTMLElement.prototype.showPopover === 'function') return;
  Object.assign(HTMLElement.prototype, {
    showPopover(): void {},
    hidePopover(): void {},
  });
}
```

Create `packages/core/src/components/legend/legend.rows.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import './legend';
import type { ProtspaceLegend } from './legend';
import type { PsMenu } from '../kit/menu';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import { TWELVE, categoricalData, numericData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import { stubPopoverApi } from './test-support/popover-stub';

// Hidden values persist per dataset: an in-memory store keeps one test's clicks out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());
// jsdom has no CSS.escape; a cancelled reorder refocuses its handle through it in a frame callback.
vi.stubGlobal('CSS', { escape: (value: string) => value });
// The row menu opens a ps-popover.
stubPopoverApi();

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const OTHER = LEGEND_VALUES.OTHER;
/** Eleven categories: the default ten rows leave one in Other. */
const ELEVEN = Object.fromEntries(Object.entries(TWELVE).slice(0, 11));

const mount = (counts: Readonly<Record<string, number>>) =>
  mountLegendWithScatterplot(categoricalData(counts), 'family');

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const main = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-item-main')!;
const eye = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-eye')!;
const more = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-more');
const handle = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.drag-handle')!;
const rowMenu = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
const menuItems = (legend: ProtspaceLegend) =>
  [...rowMenu(legend).querySelectorAll('ps-menu-item')].map((item) => item.textContent!.trim());
const rowValues = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((each) =>
    each.getAttribute('data-value'),
  );

async function openMenu(legend: ProtspaceLegend, value: string): Promise<void> {
  more(legend, value)!.click();
  await legend.updateComplete;
}

/** What the menu dispatches after it has closed itself; jsdom cannot show it to click an item. */
async function choose(legend: ProtspaceLegend, value: string): Promise<void> {
  rowMenu(legend).dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value, checked: false },
    }),
  );
  await legend.updateComplete;
}

async function press(legend: ProtspaceLegend, target: HTMLElement, key: string): Promise<void> {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
  );
  await legend.updateComplete;
}

function watchActions(legend: ProtspaceLegend): string[] {
  const actions: string[] = [];
  legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((event: CustomEvent) => {
    actions.push(`${event.detail.action}:${event.detail.value}`);
  }) as EventListener);
  return actions;
}

describe('legend rows', () => {
  it("a row is named '{label}: 1 protein, shown'", async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    expect(main(legend, 'B').getAttribute('aria-label')).toBe('B: 1 protein, shown');
    expect(main(legend, 'B').getAttribute('aria-pressed')).toBe('true');
  });

  it("and '{label}: 1,234 proteins, hidden'", async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    main(legend, 'A').click();
    await legend.updateComplete;
    expect(main(legend, 'A').getAttribute('aria-label')).toBe('A: 1,234 proteins, hidden');
    expect(main(legend, 'A').getAttribute('aria-pressed')).toBe('false');
  });

  it('the count reads 1,234', async () => {
    const { legend } = await mount({ A: 1234, B: 1 });
    expect(row(legend, 'A').querySelector('.legend-count')!.textContent!.trim()).toBe('1,234');
  });

  it("the Other row reads 'Other · 1 category' / 'Other · 2 categories'", async () => {
    const otherLabel = (legend: ProtspaceLegend) =>
      row(legend, OTHER).querySelector('.legend-text')!.textContent!.trim();

    const eleven = await mount(ELEVEN);
    expect(otherLabel(eleven.legend)).toBe('Other · 1 category');
    expect(main(eleven.legend, OTHER).getAttribute('aria-label')).toBe(
      'Other · 1 category: 2 proteins, shown',
    );
    document.body.replaceChildren();

    const twelve = await mount(TWELVE);
    expect(otherLabel(twelve.legend)).toBe('Other · 2 categories');
  });

  it('the eye toggles and dispatches toggle, and is named Show on a hidden row', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);
    expect(eye(legend, 'A').getAttribute('aria-label')).toBe('Hide A');

    eye(legend, 'A').click();
    await legend.updateComplete;

    expect(actions).toEqual(['toggle:A']);
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    expect(eye(legend, 'A').getAttribute('aria-label')).toBe('Show A');
  });

  it('a hidden row keeps .hidden, stays listed and shows the hidden mark', async () => {
    const { legend } = await mount(TWELVE);
    eye(legend, 'A').click();
    await legend.updateComplete;

    expect(rowValues(legend)).toContain('A');
    expect(row(legend, 'A').classList.contains('hidden')).toBe(true);
    const mark = row(legend, 'A').querySelector('.legend-hidden-mark');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(row(legend, 'B').querySelector('.legend-hidden-mark')).toBeNull();
  });

  it('the menu offers Show only this and Colour and shape; Other has no ⋯; numeric rows offer only Show only this', async () => {
    const categorical = await mount(TWELVE);
    expect(more(categorical.legend, OTHER)).toBeNull();
    await openMenu(categorical.legend, 'A');
    expect(rowMenu(categorical.legend).open).toBe(true);
    expect(rowMenu(categorical.legend).label).toBe('Actions for A');
    expect(menuItems(categorical.legend)).toEqual(['Show only this', 'Colour and shape']);
    document.body.replaceChildren();

    const numeric = await mountLegendWithScatterplot(
      numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      'length',
    );
    const firstBin = numeric.legend.shadowRoot!.querySelector(
      '.legend-item:not(.legend-item-other)',
    )!;
    await openMenu(numeric.legend, firstBin.getAttribute('data-value')!);
    expect(menuItems(numeric.legend)).toEqual(['Show only this']);
  });

  it('Show only this dispatches isolate; on the only visible row it reads Show all', async () => {
    const { legend } = await mount(TWELVE);
    const actions = watchActions(legend);

    await openMenu(legend, 'A');
    await choose(legend, 'isolate');

    expect(actions).toEqual(['isolate:A']);
    expect(row(legend, 'B').classList.contains('hidden')).toBe(true);
    expect(rowMenu(legend).open).toBe(false);

    await openMenu(legend, 'A');
    expect(menuItems(legend)[0]).toBe('Show all');
  });

  it('Space on the handle adds .picked and aria-pressed; Escape removes them', async () => {
    const { legend } = await mount(TWELVE);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('false');

    await press(legend, handle(legend, 'A'), ' ');
    expect(row(legend, 'A').classList.contains('picked')).toBe(true);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('true');

    await press(legend, handle(legend, 'A'), 'Escape');
    expect(row(legend, 'A').classList.contains('picked')).toBe(false);
    expect(handle(legend, 'A').getAttribute('aria-pressed')).toBe('false');
  });
});
```

In `packages/core/src/components/legend/legend-helpers.test.ts`, `describe('getItemClasses')`, replace the two tests that use `dragging`:

```ts
    it('adds dragging class when dragging', () => {
      expect(getItemClasses(baseItem, false, true)).toBe('legend-item dragging');
    });

    it('combines multiple classes', () => {
      const item = { ...baseItem, isVisible: false };
      expect(getItemClasses(item, true, true)).toBe('legend-item hidden dragging selected');
    });
```

with

```ts
    it('adds picked class while the item is picked up for a keyboard reorder', () => {
      expect(getItemClasses(baseItem, false, true)).toBe('legend-item picked');
    });

    it('combines multiple classes', () => {
      const item = { ...baseItem, isVisible: false };
      expect(getItemClasses(item, true, true)).toBe('legend-item hidden picked selected');
    });
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.rows.test.ts src/components/legend/legend-helpers.test.ts`
Expected: FAIL. The rows file fails first on names ("B: 1 items, shown" is not "B: 1 protein, shown"), counts ("1234"), the Other label ("Other (2 categories)"), and `.legend-eye`, `.legend-more` and `ps-menu.row-menu` being null; `getItemClasses` still returns `dragging`.

- [ ] **Step 4: Write the failing browser tests for rows**

Create `packages/core/src/components/legend/legend.rows.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu } from '../kit/menu';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import { categoricalData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

/** A 70-character family name, the kind Pfam and Swiss-Prot hand the legend. */
const LONG = 'Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase and dual-specificity'.slice(
  0,
  70,
);

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** The legend at the sidebar's 240 px minimum, a long name over a short one. */
async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(
    categoricalData({ [LONG]: 123456, Short: 3 }),
    'family',
  );
  legend.style.width = '240px';
  await settle(legend);
  return legend;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${CSS.escape(value)}"]`)!;
const part = (legend: ProtspaceLegend, value: string, selector: string) =>
  row(legend, value).querySelector<HTMLElement>(selector)!;
const opacity = (el: Element) => getComputedStyle(el).opacity;

describe('legend rows in a browser', () => {
  it('a row is 28 px tall', async () => {
    const legend = await mount();
    expect(row(legend, 'Short').getBoundingClientRect().height).toBeCloseTo(28, 0);
    expect(row(legend, LONG).getBoundingClientRect().height).toBeCloseTo(28, 0);
  });

  it('at 240 px a 70-character name stays on one line, ends in an ellipsis, and the count of 123,456 is fully visible', async () => {
    expect(LONG).toHaveLength(70);
    const legend = await mount();
    const rowBox = row(legend, LONG).getBoundingClientRect();
    const text = part(legend, LONG, '.legend-text');
    const count = part(legend, LONG, '.legend-count');
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);

    expect(text.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight * 1.5);
    expect(getComputedStyle(text).textOverflow).toBe('ellipsis');
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);

    expect(count.textContent!.trim()).toBe('123,456');
    expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth);
    const countBox = count.getBoundingClientRect();
    expect(countBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);
    expect(countBox.left).toBeGreaterThanOrEqual(text.getBoundingClientRect().right - 0.5);
    expect(part(legend, LONG, '.legend-item-main').getAttribute('aria-label')).toBe(
      `${LONG}: 123,456 proteins, shown`,
    );
  });

  it('the actions are transparent at rest and opaque on hover and focus-within, and never move the label', async () => {
    const legend = await mount();
    const actions = part(legend, 'Short', '.legend-item-actions');
    const label = part(legend, 'Short', '.legend-text');
    const before = label.getBoundingClientRect();
    expect(opacity(actions)).toBe('0');

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('1');
    const hovered = label.getBoundingClientRect();
    expect([hovered.left, hovered.width]).toEqual([before.left, before.width]);

    await userEvent.unhover(part(legend, 'Short', '.legend-item-main'));
    await expect.poll(() => opacity(actions)).toBe('0');

    part(legend, 'Short', '.legend-item-main').focus();
    await expect.poll(() => opacity(actions)).toBe('1');
  });

  it('the ⋯ menu opens on its button, and Show only this isolates', async () => {
    const legend = await mount();
    const actions: string[] = [];
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((event: CustomEvent) => {
      actions.push(`${event.detail.action}:${event.detail.value}`);
    }) as EventListener);
    const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    await userEvent.click(part(legend, 'Short', '.legend-more'));
    await settle(legend);
    expect(menu.open).toBe(true);
    expect(part(legend, 'Short', '.legend-more').getAttribute('aria-expanded')).toBe('true');

    const item = [...menu.querySelectorAll('ps-menu-item')].find(
      (each) => each.textContent!.trim() === 'Show only this',
    )!;
    await userEvent.click(item);
    await settle(legend);

    expect(actions).toEqual(['isolate:Short']);
    expect(row(legend, LONG).classList.contains('hidden')).toBe(true);
    expect(menu.open).toBe(false);
  });

  it('under a coarse pointer rows are 40 px and the actions always show', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Touch emulation flips the pointer media feature; fail loudly if this Chromium does not.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const legend = await mount();
      expect(row(legend, 'Short').getBoundingClientRect().height).toBeCloseTo(40, 0);
      expect(opacity(part(legend, 'Short', '.legend-item-actions'))).toBe('1');
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
```

If the `matchMedia` assertion fails because this Chromium's touch emulation does not switch `(pointer: coarse)`, replace the case's body with a check of the stylesheet text (`rowStyles.cssText` contains a `@media (pointer: coarse)` block with `min-height: var(--ps-touch-target)` and `.legend-item-actions` at `opacity: 1`, imported from `./styles/row`) and name the deviation in the report.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.rows.browser.test.ts`
Expected: FAIL: every test fails its first row assertion (rows are taller than 28 px, the label wraps, `.legend-item-actions` and `.legend-more` are missing).

- [ ] **Step 5: Retarget the long-label e2e test**

In `apps/web/tests/numeric-binning.spec.ts`, replace the whole test `test('long categorical legend labels wrap instead of clipping', async ({ page }) => { … });` with:

```ts
test('long categorical legend labels end in an ellipsis on one line', async ({ page }) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH)),
    'phosphatase_no_binning.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'ec');
  await selectAnnotation(page, 'ec');
  await waitForLegendAnnotation(page, 'ec');

  const row = page
    .locator('protspace-legend .legend-item')
    .filter({ hasText: /phosphatidylinositol|protein-serine\/threonine/ })
    .first();
  await expect(row).toBeVisible();

  const label = await row.evaluate((element) => {
    const text = element.querySelector('.legend-text') as HTMLElement;
    const count = element.querySelector('.legend-count') as HTMLElement;
    return {
      text: text.textContent?.trim() ?? '',
      textHeight: text.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight) || 0,
      truncated: text.scrollWidth > text.clientWidth,
      countText: count.textContent?.trim() ?? '',
      countFits: count.scrollWidth <= count.clientWidth + 1,
    };
  });

  expect(label.text).toContain('phosphat');
  expect(label.countText).not.toBe('');
  expect(label.countFits).toBe(true);
  expect(label.textHeight).toBeLessThanOrEqual(label.lineHeight * 1.5);
  expect(label.truncated).toBe(true);
  await expect(row.locator('.legend-item-main')).toHaveAccessibleName(
    new RegExp(`^${label.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `),
  );
});
```

(The setup lines are the old test's, unchanged.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning -g "long categorical legend labels"`
Expected: FAIL: the label still wraps onto a second line and is not truncated.

- [ ] **Step 6: Add the icons and the smaller symbol**

In `packages/core/src/components/kit/icon.ts`, add `Ellipsis`, `Eye`, `EyeOff` and `GripVertical` to the `lucide` import (keep it alphabetical), and these keys to `ICONS`, each in alphabetical position:

```ts
  ellipsis: Ellipsis,
  eye: Eye,
  'eye-off': EyeOff,
  'grip-vertical': GripVertical,
```

In `packages/core/src/components/legend/config.ts`, in `LEGEND_STYLES`, change `legendDisplaySize: 16,` to

```ts
  // The row symbol's size in px: a 10 px mark in a 16 px box (3 px padding), as the mockups draw it.
  legendDisplaySize: 10,
```

In `packages/core/src/components/legend/legend-helpers.ts`, replace `getItemClasses`:

```ts
/**
 * Determines CSS classes for a legend item.
 */
export function getItemClasses(item: LegendItem, isSelected: boolean, isPicked: boolean): string {
  const classes = ['legend-item'];

  if (!item.isVisible) classes.push('hidden');
  // Picked up with the keyboard (Space on its handle) and moving with the arrow keys.
  if (isPicked) classes.push('picked');
  if (isSelected) classes.push('selected');
  // Add class for "Other" item to prevent dragging (used by Sortable filter)
  if (item.value === LEGEND_VALUES.OTHER) classes.push('legend-item-other');

  return classes.join(' ');
}
```

- [ ] **Step 7: Rewrite the row template**

Replace the contents of `packages/core/src/components/legend/legend-row.ts` (3.2's module: `renderLegendSymbol`, `LegendRowView`, `LegendRowHandlers`, `renderLegendRow`) with:

```ts
import { html, nothing, type TemplateResult } from 'lit';
import { countNoun, formatCount } from '../../utils/count-text';
import { icon } from '../kit/icon';
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
import type { LegendItem } from './types';

/** Other's dot. A literal until phase 6 adds the neutral point tokens. */
const OTHER_SYMBOL_COLOR = '#888';

/**
 * A legend symbol drawn with the same paths as the WebGL shader's shapes. The SVG is the size plus
 * 3 px on each side, room for the selected outline. The outline colour of a selected row comes from
 * CSS (`.legend-item.selected .legend-symbol path`), which beats these attributes.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
  selected: boolean = false,
): TemplateResult {
  const padding = 3;
  const canvasSize = size + padding * 2;
  const centerOffset = canvasSize / 2;
  const shapeKey = (shape || 'circle').toLowerCase();
  const pathGenerator = SHAPE_PATH_GENERATORS[shapeKey] || SHAPE_PATH_GENERATORS.circle;
  const path = pathGenerator(size);
  // Some symbol types are drawn as outlines only.
  const isOutlineOnly = LEGEND_STYLES.outlineShapes.has(shapeKey);
  const strokeWidth = selected
    ? LEGEND_STYLES.strokeWidth.selected
    : LEGEND_STYLES.strokeWidth.default;
  const strokeColor = selected
    ? LEGEND_STYLES.colors.selectedStroke
    : LEGEND_STYLES.colors.defaultStroke;
  const validColor = color || '#888888';

  return html`
    <svg
      width="${canvasSize}"
      height="${canvasSize}"
      viewBox="0 0 ${canvasSize} ${canvasSize}"
      class="legend-symbol"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(${centerOffset}, ${centerOffset})">
        <path
          d="${path}"
          fill="${isOutlineOnly ? 'none' : validColor}"
          stroke="${isOutlineOnly ? validColor : strokeColor}"
          stroke-width="${isOutlineOnly ? LEGEND_STYLES.strokeWidth.outline : strokeWidth}"
        />
      </g>
    </svg>
  `;
}

/** What one row shows, decided by the legend. */
export interface LegendRowView {
  classes: string;
  selected: boolean;
  symbolSize: number;
  /** The number of categories in Other; only the Other row has it. */
  otherCount?: number;
  /** The list's one Tab stop is in this row. */
  tabbable: boolean;
  draggable: boolean;
  /** Picked up for a keyboard reorder. */
  picked: boolean;
  /** Shows "⋯" (every row but Other). */
  hasMenu: boolean;
}

export interface LegendRowHandlers {
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onKeyDown(e: KeyboardEvent): void;
  onHandleKeyDown(e: KeyboardEvent): void;
  onHover(category: string | null): void;
  onToggle(): void;
  onMenu(e: MouseEvent): void;
  onViewOther(e: Event): void;
}

/** A row's own controls keep their presses: the row and the container never see them. */
const stop = (e: Event) => e.stopPropagation();

/**
 * One legend row (design decision 12). The main button holds the swatch and the name and toggles
 * the category; its accessible name carries the full name, the count and the state. The eye, the
 * drag handle and "⋯" sit in an overlay the stylesheet reveals on hover and focus, so they never
 * reflow the name. Rows stay plain elements in the legend's shadow root: Sortable needs them as
 * direct children of the list, and a list can hold hundreds.
 */
export function renderLegendRow(
  item: LegendItem,
  view: LegendRowView,
  handlers: LegendRowHandlers,
): TemplateResult {
  const isOther = item.value === LEGEND_VALUES.OTHER;
  const displayValue = item.displayValue ?? toDisplayValue(item.value);
  const label = isOther
    ? `Other · ${countNoun(view.otherCount ?? 0, 'category', 'categories')}`
    : displayValue;
  const tabindex = view.tabbable ? '0' : '-1';

  return html`
    <div
      class=${view.classes}
      part="item"
      role="listitem"
      data-value=${item.value}
      data-display-value=${displayValue}
      data-driver-id=${isOther ? 'other-row' : nothing}
      @mouseenter=${() => handlers.onHover(item.value)}
      @mouseleave=${() => handlers.onHover(null)}
    >
      <button
        type="button"
        class="legend-item-main"
        aria-label=${`${label}: ${countNoun(item.count, 'protein', 'proteins')}, ${
          item.isVisible ? 'shown' : 'hidden'
        }`}
        aria-pressed=${item.isVisible ? 'true' : 'false'}
        tabindex=${tabindex}
        @click=${handlers.onClick}
        @dblclick=${handlers.onDoubleClick}
        @keydown=${handlers.onKeyDown}
      >
        <span class="legend-swatch" part="symbol"
          >${isOther
            ? renderLegendSymbol('circle', OTHER_SYMBOL_COLOR, view.symbolSize)
            : renderLegendSymbol(item.shape, item.color, view.symbolSize, view.selected)}</span
        >
        <span class="legend-text" part="text">${label}</span>
      </button>
      ${isOther
        ? html`<button
            type="button"
            class="view-button"
            aria-label="View items grouped under Other"
            tabindex=${tabindex}
            @click=${handlers.onViewOther}
            @dblclick=${stop}
            @mousedown=${stop}
          >
            View
          </button>`
        : nothing}
      ${item.isVisible
        ? nothing
        : html`<span class="legend-hidden-mark" aria-hidden="true">${icon('eye-off', 14)}</span>`}
      <span class="legend-count" part="count">${formatCount(item.count)}</span>
      <span class="legend-item-actions">
        <button
          type="button"
          class="legend-action legend-eye"
          aria-label=${`${item.isVisible ? 'Hide' : 'Show'} ${displayValue}`}
          tabindex=${tabindex}
          @click=${(e: Event) => {
            e.stopPropagation();
            handlers.onToggle();
          }}
          @dblclick=${stop}
          @mousedown=${stop}
        >
          ${icon(item.isVisible ? 'eye' : 'eye-off', 14)}
        </button>
        <button
          type="button"
          class="drag-handle${view.draggable ? '' : ' drag-handle-disabled'}"
          ?disabled=${!view.draggable}
          aria-label=${view.draggable
            ? `Reorder ${displayValue}`
            : `${displayValue} cannot be reordered`}
          aria-pressed=${view.draggable ? (view.picked ? 'true' : 'false') : nothing}
          tabindex=${tabindex}
          @click=${stop}
          @dblclick=${stop}
          @mousedown=${stop}
          @keydown=${(e: KeyboardEvent) => {
            e.stopPropagation();
            handlers.onHandleKeyDown(e);
          }}
        >
          ${icon('grip-vertical', 14)}
        </button>
        ${view.hasMenu
          ? html`<button
              type="button"
              class="legend-action legend-more"
              aria-label=${`More actions for ${displayValue}`}
              tabindex=${tabindex}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                handlers.onMenu(e);
              }}
              @dblclick=${stop}
              @mousedown=${stop}
            >
              ${icon('ellipsis', 14)}
            </button>`
          : nothing}
      </span>
    </div>
  `;
}
```

(The handle still stops `mousedown` as it did: Sortable starts a drag from `pointerdown`, which it does not stop. The menu's `aria-haspopup` and `aria-expanded` on "⋯" are set by `ps-menu`, never bound here.)

- [ ] **Step 8: Wire the rows and the row menu into the legend**

All edits are in `packages/core/src/components/legend/legend.ts`.

(a) Imports: `import { LitElement, html } from 'lit';` becomes `import { LitElement, html, nothing } from 'lit';`. Add `import '../kit/menu';` next to `import '../common/info-popover';`. Keep 3.2's `renderLegendRow`, `type LegendRowView` and `type LegendRowHandlers` import from `./legend-row` (the two types stay in use below, which is also their knip consumer). (`annotationLabel` is already imported from `@protspace/utils`.)

(b) State. Next to `@state() private _statusMessage = '';` add:

```ts
  /** The row whose "⋯" menu is open, and the button it hangs from. */
  @state() private _rowMenu: { value: string; anchor: HTMLElement } | null = null;
  /**
   * The row the menu last opened for. ps-menu closes itself (ps-close) before it dispatches
   * ps-select, so the choice is read from here, not from `_rowMenu`.
   */
  private _rowMenuTarget: string | null = null;
```

(c) In the `_keyboard = new LegendKeyboardController(this, { … });` options, change `annotationName: () => this.selectedAnnotation,` to

```ts
    annotationName: () => this._annotationDisplayName,
```

(d) Next to the `_currentSortMode` getter add:

```ts
  /** The selected annotation's display name, never its key (decision 15). */
  private get _annotationDisplayName(): string {
    const name = this.selectedAnnotation;
    return name ? annotationLabel(name, this.data?.annotations?.[name] ?? this.annotationData) : '';
  }
```

(e) `_highlightDroppedItem`: in its announcement, replace `Switched ${this.selectedAnnotation} to Manual order.` with `Switched ${this._annotationDisplayName} to Manual order.`.

(f) `willUpdate`: add, before 3.2's strip-point derivation:

```ts
    // Rows render by position, so after a re-sort the menu's anchor would be another row's "⋯".
    if (changedProperties.has('_sortedLegendItems') && this._rowMenu !== null) {
      this._rowMenu = null;
    }
```

(g) Replace `_renderLegendItem` (keep its name and its `(item, sortedIndex)` parameters; 3.4's handler lines are folded in):

```ts
  private _renderLegendItem(item: LegendItem, sortedIndex: number) {
    const selected = isItemSelected(item, this.selectedItems);
    const picked = this._keyboard.pickedValue === item.value;
    const isOther = item.value === LEGEND_VALUES.OTHER;
    const classes = `${getItemClasses(item, selected, picked)}${
      this._categoryScores.length > 0 && item.value === this._hoveredCategory
        ? ' legend-item-score-hover'
        : ''
    }`;

    const view: LegendRowView = {
      classes,
      selected,
      symbolSize: LEGEND_STYLES.legendDisplaySize,
      otherCount: isOther ? this._otherItems.length : undefined,
      // Today's rule: the first row holds the list's Tab stop (Task 3.7 makes it follow focus).
      tabbable: sortedIndex === 0,
      draggable: this._canDragLegendItem(item),
      picked,
      hasMenu: !isOther,
    };
    const handlers: LegendRowHandlers = {
      onClick: (e: MouseEvent) => this._handleItemMouseClick(item.value, e),
      onDoubleClick: () => this._handleItemMouseDoubleClick(item.value),
      onKeyDown: (e: KeyboardEvent) => this._keyboard.onItemKeyDown(e, item, sortedIndex),
      onHandleKeyDown: (e: KeyboardEvent) => this._keyboard.onHandleKeyDown(e, item),
      onHover: (category) => this._setHoveredCategory(category),
      onToggle: () => this._handleItemClick(item.value),
      onMenu: (e: MouseEvent) => this._toggleRowMenu(item.value, e.currentTarget as HTMLElement),
      onViewOther: (e: Event) => {
        e.stopPropagation();
        this._showOtherDialog = true;
      },
    };
    return renderLegendRow(item, view, handlers);
  }

  private _toggleRowMenu(value: string, anchor: HTMLElement): void {
    if (this._rowMenu?.value === value) {
      this._rowMenu = null;
      return;
    }
    this._rowMenuTarget = value;
    this._rowMenu = { value, anchor };
  }

  private _onRowMenuClose = (event: Event): void => {
    event.stopPropagation();
    this._rowMenu = null;
  };

  private _onRowMenuSelect = (event: CustomEvent<{ value: string }>): void => {
    event.stopPropagation();
    const value = this._rowMenuTarget;
    this._rowMenu = null;
    if (value === null) return;
    if (event.detail.value === 'isolate') {
      this._handleItemDoubleClick(value);
    } else if (event.detail.value === 'customize') {
      // Found by its dataset rather than a selector: a value can hold any character.
      const row = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.legend-item') ?? [])].find(
        (each) => each.dataset.value === value,
      );
      // Chosen again for the row whose picker is open, the picker stays open.
      if (row && this._colorPicker.value !== value) this._colorPicker.toggle(value, row);
    }
  };

  /** The one "⋯" menu, shared by every row; it hangs from the row that opened it. */
  private _renderRowMenu() {
    const open = this._rowMenu;
    const item = open ? this._legendItems.find((each) => each.value === open.value) : undefined;
    const label = item ? (item.displayValue ?? toDisplayValue(item.value)) : '';
    const visible = this._legendItems.filter((each) => each.isVisible);
    const onlyVisible = !!item && visible.length === 1 && visible[0].value === item.value;
    const canCustomize =
      !!item && item.value !== LEGEND_VALUES.OTHER && !this._isNumericAnnotation();
    return html`<ps-menu
      class="row-menu"
      label=${item ? `Actions for ${label}` : 'Row actions'}
      placement="bottom-end"
      .anchor=${open?.anchor ?? null}
      .open=${item !== undefined}
      @ps-select=${this._onRowMenuSelect}
      @ps-close=${this._onRowMenuClose}
      @click=${(e: Event) => e.stopPropagation()}
    >
      <ps-menu-item value="isolate">${onlyVisible ? 'Show all' : 'Show only this'}</ps-menu-item>
      ${canCustomize
        ? html`<ps-menu-item value="customize">Colour and shape</ps-menu-item>`
        : nothing}
    </ps-menu>`;
  }
```

(The menu's own `click` listener runs first, then this one stops the click, so the container's click handler does not close the picker that "Colour and shape" just opened.)

(h) `render()`: directly after `${this._colorPicker.render()}` add

```ts
        ${this._renderRowMenu()}
```

so it is rendered once, among the last children of `.legend-container`.

(i) `_highlightDroppedItem`: the main button now comes first in the row, so the focus target of a pointer drop would move from the handle to the main button. Keep today's target: replace

```ts
        const focusTarget = htmlEl.querySelector(
          '.drag-handle, .legend-item-main',
        ) as HTMLElement | null;
```

with

```ts
        // The handle, as before the main button moved ahead of it in the row; Other has no usable one.
        const focusTarget =
          htmlEl.querySelector<HTMLElement>('.drag-handle:not(:disabled)') ??
          htmlEl.querySelector<HTMLElement>('.legend-item-main');
```

Then check that the row helpers reached by name are gone:

Run: `grep -rnE "renderDragHandle|renderItemSymbol|legend-symbol-button|onSymbolClick" packages/core/src/components/legend --include='*.ts' --exclude='*.test.ts'`
Expected: no output.

- [ ] **Step 9: Move the row styles to tokens**

Create `packages/core/src/components/legend/styles/row.ts`:

```ts
import { css } from 'lit';

/**
 * Legend rows (design decision 12): 28 px (40 px under a coarse pointer), the swatch and the name in
 * the main button, the count in tabular figures, and the eye, handle and "⋯" revealed on hover or
 * focus. Hover and focus are CSS only, so the pointer never re-renders the legend. Sortable's states
 * and the drop highlight live here too. Every colour and type size reads a --ps-* token.
 */
export const rowStyles = css`
  /* Rows sit edge to edge and draw their own inset; layout.ts owns the rest of the list box. */
  .legend-items {
    gap: 0;
    padding-inline: 0;
  }

  .legend-item {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--ps-space-2);
    width: 100%;
    height: var(--ps-row);
    padding: 0 var(--ps-space-3);
    box-sizing: border-box;
    color: var(--ps-text);
    background: transparent;
    transition: background-color var(--ps-duration-fast) var(--ps-ease);
  }

  .legend-item:hover,
  .legend-item:focus-within {
    background: var(--ps-surface-hover);
  }

  /* Picked up for a keyboard reorder. */
  .legend-item.picked {
    background: var(--ps-accent-tint);
  }

  /* The category under the pointer in a score strip. */
  .legend-item-score-hover {
    box-shadow: inset 2px 0 0 var(--ps-text);
  }

  .legend-item-main {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: flex-start;
    gap: var(--ps-space-2);
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: var(--ps-leading-tight);
    text-align: left;
    cursor: pointer;
    transition: none;
  }

  .legend-swatch {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .legend-symbol {
    display: block;
    overflow: visible;
  }

  /* Selected in the plot: the outline takes the accent; the fill stays the category's. */
  .legend-item.selected .legend-symbol path {
    stroke: var(--ps-accent);
    stroke-width: 2px;
  }

  .legend-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }

  /* Hidden rows stay listed and actionable: dimmed, never in the disabled colour. */
  .legend-item.hidden .legend-swatch {
    opacity: 0.35;
  }

  .legend-item.hidden .legend-text,
  .legend-item-other .legend-text,
  .legend-item[data-value='__NA__'] .legend-text {
    color: var(--ps-text-muted);
  }

  .legend-hidden-mark {
    display: inline-flex;
    flex: none;
    color: var(--ps-text-muted);
  }

  .legend-count {
    flex: none;
    font-size: var(--ps-text-sm);
    color: var(--ps-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .view-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 24px;
    padding: 0 var(--ps-space-1);
    border: 0;
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: var(--ps-accent-text);
    font-size: var(--ps-text-sm);
    font-weight: var(--ps-weight-medium);
    cursor: pointer;
  }

  .view-button:hover {
    text-decoration: underline;
  }

  /* Over the end of the row, so showing them never reflows the name. */
  .legend-item-actions {
    position: absolute;
    top: 0;
    right: var(--ps-space-1);
    bottom: 0;
    display: flex;
    align-items: center;
    gap: var(--ps-space-0-5);
    padding-left: var(--ps-space-1);
    background: var(--ps-surface-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--ps-duration-fast) var(--ps-ease);
  }

  .legend-item:hover .legend-item-actions,
  .legend-item:focus-within .legend-item-actions,
  .legend-item.picked .legend-item-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .legend-item.picked .legend-item-actions {
    background: var(--ps-accent-tint);
  }

  .legend-action,
  .drag-handle {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: var(--ps-text-muted);
    cursor: pointer;
    transition:
      background-color var(--ps-duration-fast) var(--ps-ease),
      color var(--ps-duration-fast) var(--ps-ease);
  }

  .legend-action:hover,
  .drag-handle:hover {
    background: color-mix(in srgb, var(--ps-text) 8%, transparent);
    color: var(--ps-text);
  }

  .drag-handle {
    cursor: grab;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .drag-handle[aria-pressed='true'] {
    color: var(--ps-accent-text);
  }

  /* Other's handle stays for Sortable's filter and the e2e, out of sight and out of reach. */
  .drag-handle-disabled {
    opacity: 0;
    pointer-events: none;
  }

  /* The kit's focus ring, drawn inside: rows sit edge to edge. */
  .legend-item-main:focus-visible,
  .view-button:focus-visible,
  .legend-action:focus-visible,
  .drag-handle:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: calc(-1 * var(--ps-focus-width));
    box-shadow: none;
  }

  @media (forced-colors: active) {
    .legend-item-main:focus-visible,
    .view-button:focus-visible,
    .legend-action:focus-visible,
    .drag-handle:focus-visible {
      outline-color: Highlight;
    }
  }

  /* Touch: taller rows, and the actions always shown after the count. */
  @media (pointer: coarse) {
    .legend-item {
      height: auto;
      min-height: var(--ps-touch-target);
    }

    .legend-item-actions {
      position: static;
      padding-left: 0;
      background: transparent;
      opacity: 1;
      pointer-events: auto;
    }
  }

  /* Sortable: the gap where the row will land, the row as picked, and the row under the pointer. */
  .legend-item-ghost {
    opacity: 0.4;
    background: var(--ps-accent-tint);
    outline: 1px dashed var(--ps-accent);
    outline-offset: -1px;
  }

  .legend-item-chosen {
    background: var(--ps-surface-hover);
    cursor: grabbing;
  }

  .legend-item-drag,
  .legend-item-fallback {
    background: var(--ps-surface-raised);
    border-radius: var(--ps-radius);
    box-shadow: var(--ps-shadow-lg);
    opacity: 0.95;
    cursor: grabbing;
  }

  /* "Other" while a row is dragged over it: dropping merges the row into it. */
  .legend-item-merge-target {
    background: var(--ps-accent-tint);
    box-shadow: inset 0 0 0 1px var(--ps-accent);
  }

  .legend-item-just-dropped {
    animation: drop-highlight 600ms var(--ps-ease);
  }

  @keyframes drop-highlight {
    from {
      background: var(--ps-accent-tint);
    }
    to {
      background: transparent;
    }
  }
`;
```

Replace the contents of `packages/core/src/components/legend/styles/item.ts` with the picker rules only (the rest moved to `row.ts`; the file leaves in 3.8):

```ts
import { css } from 'lit';

/**
 * Legend colour and shape picker styles, until the picker moves to ps-popover and styles/picker.ts
 * (Task 3.8). The row rules moved to styles/row.ts.
 */
export const itemStyles = css`
  /* Color Picker Popover */
  .color-picker-popover {
    position: absolute;
    z-index: var(--z-modal);
    background: var(--legend-bg);
    border: 1px solid var(--legend-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 12px;
    min-width: 200px;
  }

  .color-picker-header {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--legend-text-color);
    margin-bottom: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .color-picker-swatch {
    width: 40px;
    height: 40px;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    cursor: pointer;
  }

  /* Symbol Picker Sections (Color + Shape side by side) */
  .symbol-picker-sections {
    display: flex;
    gap: 16px;
  }

  .symbol-picker-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .symbol-picker-section-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--legend-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Shape Swatch Container */
  .shape-swatch-container {
    position: relative;
  }

  /* Shape Picker Swatch (similar to color swatch) */
  .shape-picker-swatch {
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    background: var(--legend-bg);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background-color 0.15s ease,
      color 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .shape-picker-swatch:hover:not(:disabled) {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-20);
  }

  .shape-picker-swatch.active {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-30);
  }

  .shape-picker-swatch:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .shape-picker-swatch.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .shape-picker-swatch svg {
    display: block;
  }

  /* Shape Picker Dropdown */
  .shape-picker-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: calc(var(--z-modal) + 1);
    background: var(--legend-bg);
    border: 1px solid var(--legend-border);
    border-radius: 6px;
    padding: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* Shape Picker Grid */
  .shape-picker-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .shape-picker-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--legend-border);
    border-radius: 4px;
    background: var(--legend-bg);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;
    color: var(--legend-text-secondary);
  }

  .shape-picker-item svg {
    display: block;
  }

  .shape-picker-item:hover {
    border-color: var(--primary);
    background: var(--legend-hover-bg);
    color: var(--primary);
  }

  .shape-picker-item.selected {
    border-color: var(--primary);
    background: var(--primary-alpha-10);
    color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-alpha-20);
  }

  .shape-picker-item:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  /* Note for disabled shape picker (multilabel) */
  .symbol-picker-note {
    font-size: 0.7rem;
    color: var(--legend-text-secondary);
    margin-top: 8px;
    font-style: italic;
  }
`;
```

(These are today's picker rules verbatim; the unused `.color-picker-content`, `.color-picker-input`, `.mr-2`, `.legend-symbol-clickable`, `.legend-symbol-button` and `.legend-item-actions protspace-color-picker` rules go. The module still violates the lint, so it stays in `LEGACY` until 3.8 deletes it.)

Replace the contents of `packages/core/src/components/legend/legend.styles.ts` with:

```ts
import { tokens } from '../../styles/tokens';
import { buttonMixin } from '../../styles/mixins';
import { overlayMixins } from '../../styles/overlay-mixins';
import { reducedMotion } from '../kit/kit-shared.styles';
import { themeStyles } from './styles/theme';
import { layoutStyles } from './styles/layout';
import { rowStyles } from './styles/row';
import { itemStyles } from './styles/item';
import { modalStyles } from './styles/modal';
import { responsiveStyles } from './styles/responsive';

/**
 * Legend Styles
 *
 * Modular style composition following the unified ProtSpace style architecture.
 * Styles are imported in order: tokens → mixins → theme → features → responsive
 *
 * @see /docs/developers/style-architecture.md for organization standards
 */
export const legendStyles = [
  // 1. Foundation
  tokens,

  // 2. Shared mixins
  buttonMixin,
  overlayMixins,

  // 3. Component-specific (modular). Rows come after layout, whose list box they adjust.
  themeStyles,
  layoutStyles,
  rowStyles,
  itemStyles,
  modalStyles,

  // 4. Transitions and animations stop for people who asked for less motion.
  reducedMotion,

  // 5. Responsive (ALWAYS LAST)
  responsiveStyles,
];
```

- [ ] **Step 10: Point the 3.1 tests at the new rows**

Task 3.1's files are edited where they assume the old row; every other line stays.

`packages/core/src/components/legend/legend.dom-contract.test.ts`, test "names each main button "{label}: N items, shown|hidden" and toggles .hidden on click": rename it to `names each main button "{label}: N proteins, shown|hidden" and toggles .hidden on click`, replace its pattern

```ts
        new RegExp(`^${escapeRegExp(item.dataset.displayValue!)}: \\d+ items, (shown|hidden)$`),
```

with

```ts
        // Other's label adds " · N categories" after its display value.
        new RegExp(
          `^${escapeRegExp(item.dataset.displayValue!)}( · [^:]*)?: [\\d,]+ proteins?, (shown|hidden)$`,
        ),
```

and its last assertion `expect(main.getAttribute('aria-label')).toBe('A: 12 items, hidden');` with

```ts
    expect(main.getAttribute('aria-label')).toBe('A: 12 proteins, hidden');
```

In "keeps the parts and classes the e2e, perf, tour and docs scripts read", the symbol now sits inside the main button: replace

```ts
      expect(item.querySelector('[part="symbol"] .legend-symbol path')!.getAttribute('fill')).toBeTruthy();
```

with

```ts
      expect(
        item.querySelector('.legend-item-main [part="symbol"] .legend-symbol path')!.getAttribute('fill'),
      ).toBeTruthy();
```

and add after the loop:

```ts
    expect(root.querySelector('.legend-symbol-button')).toBeNull();
```

`packages/core/src/components/legend/legend.color-picker.test.ts`: add to the imports

```ts
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import { stubPopoverApi } from './test-support/popover-stub';
```

add after `vi.stubGlobal('localStorage', createLocalStorageMock());`

```ts
// "Colour and shape" lives in the row's "⋯" menu, which opens a ps-popover.
stubPopoverApi();
```

and replace the body of `openPicker` (keep its signature and its `return`) so it opens the picker the way the row now offers it:

```ts
async function openPicker(legend: ProtspaceLegend, value: string): Promise<HTMLElement> {
  q<HTMLButtonElement>(legend, `.legend-item[data-value="${value}"] .legend-more`)!.click();
  await settle(legend);
  // jsdom cannot show the menu to click its item, so the choice is dispatched as the menu does.
  const menu = q<PsMenu>(legend, 'ps-menu.row-menu')!;
  menu.dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value: 'customize', checked: false },
    }),
  );
  await settle(legend);
  // The closed menu releases its layer in its popover's own update.
  await menu.updateComplete;
  await menu.shadowRoot!.querySelector<PsPopover>('ps-popover')!.updateComplete;
  return q(legend, '.color-picker-popover')!;
}
```

Rename "opens from a categorical row's symbol, headed by the row's label" to `opens from a categorical row's "Colour and shape", headed by the row's label`, and replace the last test, "offers no symbol button on numeric rows", with:

```ts
  it('offers no Colour and shape on numeric rows', async () => {
    const { legend } = await mountLegendWithScatterplot(
      numericData(Array.from({ length: 20 }, (_, i) => i + 1)),
      'length',
    );
    await settle(legend);
    expect(legend.shadowRoot!.querySelectorAll('.legend-item').length).toBeGreaterThan(1);

    q<HTMLButtonElement>(legend, '.legend-item:not(.legend-item-other) .legend-more')!.click();
    await settle(legend);

    expect(q(legend, 'ps-menu.row-menu ps-menu-item[value="isolate"]')).not.toBeNull();
    expect(q(legend, 'ps-menu.row-menu ps-menu-item[value="customize"]')).toBeNull();
    expect(legend.shadowRoot!.querySelector('.legend-symbol-button')).toBeNull();
  });
```

The other four tests keep their assertions (the picker still renders `.color-picker-popover` until 3.8, debounces, stores a shape, and closes on an outside mousedown and mouseup).

`packages/core/src/components/legend/legend.escape-order.test.ts`: add the same three imports and the `stubPopoverApi();` line (after its `vi.stubGlobal('CSS', …)` line), add after `click`:

```ts
/** "⋯", then "Colour and shape", dispatched as the menu does; the menu's layer is released after. */
async function openPicker(legend: ProtspaceLegend, value: string): Promise<void> {
  click(legend, `.legend-item[data-value="${value}"] .legend-more`);
  await settle(legend);
  const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
  menu.dispatchEvent(
    new CustomEvent('ps-select', {
      bubbles: true,
      composed: true,
      detail: { value: 'customize', checked: false },
    }),
  );
  await settle(legend);
  await menu.updateComplete;
  await menu.shadowRoot!.querySelector<PsPopover>('ps-popover')!.updateComplete;
}
```

and in both tests that open the picker, replace

```ts
    click(legend, '.legend-item[data-value="A"] .legend-symbol-button');
    await settle(legend);
```

with

```ts
    await openPicker(legend, 'A');
```

`packages/core/src/components/legend/legend.keyboard-reorder.test.ts`, test "moves the picked row one place, switches to manual and fires one legend-zorder-change": replace

```ts
    // Task 3.6 changes this line to the display name.
    expect(status(legend)).toBe('Moved B. Switched family to Manual order.');
```

with

```ts
    expect(status(legend)).toBe(`Moved B. Switched ${annotationLabel('family')} to Manual order.`);
```

and add `import { annotationLabel } from '@protspace/utils';` to its imports. "Picked up B for reordering", "Dropped B" and "Reordering canceled." are unchanged.

- [ ] **Step 11: Run the unit and browser tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/utils/count-text.test.ts src/components/kit/icon.test.ts`
Expected: PASS: `legend.rows.test.ts` (9 tests), `legend-helpers.test.ts`, the four updated 3.1 files, and `legend.double-click.test.ts`, `legend-extract.test.ts` (its `.view-button` click), `legend.score-sync.test.ts` (`.legend-count` reads "2", `.legend-item-score-hover`) and `legend.score-strips.test.ts` unchanged.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.rows.browser.test.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles`
Expected: PASS: `styles/row.ts` is clean under the style lint (it is not in `LEGACY`), `styles/item.ts` still violates and keeps its line, `styles-integrity.test.ts` finds `rowStyles`.

- [ ] **Step 12: Run the e2e this task touches**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning --project=legend-double-click`
Expected: PASS, including "long categorical legend labels end in an ellipsis on one line", the keyboard handle reorders (`focus()` and `press` reach the handle at opacity 0) and the pointer drags (`dragLegendHandle` moves the mouse onto the handle, which reveals it before the press). The double-click at `box.x + 24` lands on `.legend-item-main`: the swatch is inside the button now.

- [ ] **Step 13: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS, the previous counts plus count-text (2), rows unit (9) and rows browser (5); the updated files keep their counts.

Run: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, counts unchanged.

Run: `pnpm type-check && pnpm lint && pnpm knip`
Expected: clean. `formatCount` and `countNoun` are used by `legend-row.ts`; `stubPopoverApi` by three jsdom files. `pnpm type-check:scripts` stays green: the docs scripts' legend selectors (`.view-button`, `.legend-item`, `.legend-item-main`, `.drag-handle`) are strings.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in full, including `url-view-state-firefox` and `url-view-state-webkit` (hover-revealed actions in Firefox and WebKit; `isLegendItemHidden` still reads `.hidden`), `dataset-reload`, `example-datasets`, `workbench-filter`, `load-large-bundle`, `density-layer`, `examples-live` and `product-tour` (`other-row`). Known flakes re-run once alone.

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS with `budgets.json` unchanged, including `legend-isolate` (a dblclick at the row centre, which lands on the main button, then `i`). Nothing in this task runs `_updateLegendItems` or `_rebuildLegendItems` more often.

- [ ] **Step 14: Commit**

```bash
pnpm exec prettier --write packages/core/src/utils/count-text.ts packages/core/src/utils/count-text.test.ts packages/core/src/components/kit/icon.ts packages/core/src/components/legend/config.ts packages/core/src/components/legend/legend-helpers.ts packages/core/src/components/legend/legend-helpers.test.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/row.ts packages/core/src/components/legend/styles/item.ts packages/core/src/components/legend/test-support/popover-stub.ts packages/core/src/components/legend/legend.rows.test.ts packages/core/src/components/legend/legend.rows.browser.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.escape-order.test.ts apps/web/tests/numeric-binning.spec.ts
git add packages/core/src/utils/count-text.ts packages/core/src/utils/count-text.test.ts packages/core/src/components/kit/icon.ts packages/core/src/components/legend/config.ts packages/core/src/components/legend/legend-helpers.ts packages/core/src/components/legend/legend-helpers.test.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/row.ts packages/core/src/components/legend/styles/item.ts packages/core/src/components/legend/test-support/popover-stub.ts packages/core/src/components/legend/legend.rows.test.ts packages/core/src/components/legend/legend.rows.browser.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.keyboard-reorder.test.ts packages/core/src/components/legend/legend.escape-order.test.ts apps/web/tests/numeric-binning.spec.ts
git commit -m "feat(core): redesign legend rows with hover actions and truncation"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.7: Legend rows: one Tab stop, the full name on hover, and the e2e legend helpers

The list gets one roving Tab stop that follows focus (decision 12): focus entering a row moves the stop there, and a re-sort keeps it on the same category. A name that ends in an ellipsis shows in full in one shared tooltip after 500 ms of pointer hover; keyboard and screen-reader users already get it from the main button's name. E2E gets its legend helper module (`apps/web/tests/helpers/legend.ts`, reached by role and name) and a legend spec; `helpers/explore.ts` re-exports the three legend helpers it had.

**Files:**

- Modify: `packages/core/src/components/legend/legend-list.ts` (the roving stop on `LegendKeyboardController`; `NAME_TOOLTIP_DELAY_MS`, `TruncatedNameTooltip`), `packages/core/src/components/legend/legend-row.ts` (two handlers), `packages/core/src/components/legend/legend.ts`
- Modify tests: `packages/core/src/components/legend/legend.rows.test.ts` (two cases), `packages/core/src/components/legend/legend.rows.browser.test.ts` (one case)
- Create: `apps/web/tests/helpers/legend.ts`, `apps/web/tests/workbench-legend.spec.ts`
- Modify: `apps/web/tests/helpers/explore.ts` (its three legend helpers move to `helpers/legend.ts` and are re-exported)

**Interfaces:**

- Consumes:
  - Task 3.6: `LegendRowView` (`tabbable: boolean`, set in `_renderLegendItem(item, sortedIndex)` as `sortedIndex === 0`), `LegendRowHandlers`, `renderLegendRow` (`legend-row.ts`: the row `div.legend-item` binds `@mouseenter`/`@mouseleave`; the main button `button.legend-item-main` binds `@click`, `@dblclick`, `@keydown` and holds `span.legend-text`); `_renderRowMenu()` rendered in `render()` right after `${this._colorPicker.render()}`; the row actions `.legend-eye` ("Hide {display value}" / "Show {display value}"), `.drag-handle`, `.legend-more` ("More actions for {display value}"), the row menu `ps-menu.row-menu` ("Actions for {display value}", items "Show only this" / "Show all" and "Colour and shape"), the row's accessible name `{label}: {n} protein(s), shown|hidden` (Other: `Other · N categories: …`), `.legend-item-actions` at opacity 0 until hover, `.legend-swatch` at opacity 0.35 on a hidden row; the tests' helpers in `legend.rows.test.ts` (`mount(counts)`, `row`, `main`, `rowMenu`, `TWELVE`) and `legend.rows.browser.test.ts` (`mount()` at 240 px with a 70-character `LONG` name over `Short`, `part(legend, value, selector)`, `settle`).
  - Task 3.4: `LegendKeyboardController` (`host`, `options.getSortedItems()`, `_snapshot` field; `pickedValue`).
  - `ps-tooltip`, `PsTooltip` (`../kit/tooltip`: `text`, `.anchor`, `placement`, `names-target`, `show()`, `hide()`; it binds to its anchor's pointer and focus events, and hides on a press of it).
  - E2E: `openExplore`, `selectAnnotation`, `waitForExploreInteractionReady` (`apps/web/tests/helpers/explore.ts`); `seedLayout` (`apps/web/tests/helpers/workbench.ts`); `SIDEBAR_WIDTH` (`apps/web/src/explore/layout-defaults.ts`).
- Produces:
  - `legend-list.ts`: `LegendKeyboardController` gains `focusValue: string | null` (get/set; the roving stop: set on `focusin` of a row, kept by value across re-sorts, defaulting to the first row; a change re-renders) and `isTabbable(value: string): boolean`; `export const NAME_TOOLTIP_DELAY_MS = 500`; `export class TruncatedNameTooltip implements ReactiveController` — `constructor(host: ReactiveControllerHost & HTMLElement)`; `hover(trigger: HTMLElement, textEl: HTMLElement): void` (shows after the delay only when `textEl.scrollWidth > textEl.clientWidth`; a `pointerleave` of the trigger cancels it); `leave(): void`; `render(): TemplateResult` (one `<ps-tooltip class="name-tooltip" names-target>`, driven directly so a hover never re-renders the legend); `hostDisconnected(): void`.
  - `legend-row.ts`: `LegendRowHandlers` gains `onFocus(): void` (bound to the row's `focusin`) and `onNamePointerEnter(e: PointerEvent): void` (bound to the main button's `pointerenter`).
  - `legend.ts`: `private _nameTooltip = new TruncatedNameTooltip(this)`, rendered once right after the row menu; rows are tabbable by `this._keyboard.isTabbable(item.value)`. Task 3.9 reuses `_nameTooltip` for the header title.
  - `apps/web/tests/helpers/legend.ts`: `legend(page): Locator` (`protspace-legend`); `legendRow(page, value: string): Locator` (the main button by name `^{escaped value}( · …)?:`, so `Other` finds "Other · N categories: …"); `legendRowValues(page, options?: { visible?: boolean }): Promise<string[]>`; `legendRowAction(page, value: string, action: 'Hide' | 'Show' | 'Show only this' | 'Show all' | 'Colour and shape'): Promise<void>` (hovers the row, then clicks the eye or opens "⋯" and picks the item); and, moved from `explore.ts`, `getFirstLegendItemValue(page)`, `clickLegendItem(page, value)`, `isLegendItemHidden(page, value)` (still keyed on the row's `data-value`, now reading the main button's `aria-pressed`, so its meaning is unchanged). `explore.ts` re-exports these three. `helpers/legend.ts` imports `waitForExploreInteractionReady` from `explore.ts`, which re-exports from `legend.ts`: a cycle that is safe because both sides only call each other inside function bodies.

**Tests:**

- `legend.rows.test.ts` (unit, jsdom), added: "only one row is tabbable, and focusing row 3 moves the stop there"; "renders one ps-menu and one ps-tooltip whatever the row count (500 rows)".
- `legend.rows.browser.test.ts`, added: "hovering a truncated name shows its full text after 500 ms; a name that fits shows nothing".
- `apps/web/tests/workbench-legend.spec.ts` (e2e): "legend rows are 28 px with their actions hidden until hover"; "the eye hides a category and the row stays, dimmed"; "Show only this from the ⋯ menu isolates the category"; "a long name ends in an ellipsis and its full name is in the row's accessible name".
- Full e2e: `url-view-state-firefox` and `url-view-state-webkit` (`isLegendItemHidden` through `explore.ts`), `dataset-reload`, `example-datasets`, `workbench-filter`, `load-large-bundle` pass unchanged; `pnpm perf:counts` passes with the budgets unchanged.

Anchors below name functions and test titles.

- [ ] **Step 1: Write the failing unit tests**

In `packages/core/src/components/legend/legend.rows.test.ts` (Task 3.6), add after the `rowValues` helper:

```ts
const tabbable = (legend: ProtspaceLegend, selector: string) =>
  [...legend.shadowRoot!.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => el.getAttribute('tabindex') === '0')
    .map((el) => el.closest('.legend-item')!.getAttribute('data-value'));
```

and inside `describe('legend rows', …)`, before "Space on the handle adds .picked and aria-pressed; Escape removes them":

```ts
  it('only one row is tabbable, and focusing row 3 moves the stop there', async () => {
    const { legend } = await mount(TWELVE);
    expect(tabbable(legend, '.legend-item-main')).toEqual(['A']);

    main(legend, 'C').focus();
    await legend.updateComplete;

    expect(tabbable(legend, '.legend-item-main')).toEqual(['C']);
    expect(tabbable(legend, '.legend-eye')).toEqual(['C']);
    expect(tabbable(legend, '.drag-handle')).toEqual(['C']);
    expect(tabbable(legend, '.legend-more')).toEqual(['C']);
  });
```

and after that case, as the last in the `describe`:

```ts
  it('renders one ps-menu and one ps-tooltip whatever the row count (500 rows)', async () => {
    const counts = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`C${index}`, 500 - index]),
    );
    const { legend } = await mount(counts);
    legend.maxVisibleValues = 500;
    await vi.waitFor(() =>
      expect(legend.shadowRoot!.querySelectorAll('.legend-item')).toHaveLength(500),
    );

    const root = legend.shadowRoot!;
    expect(root.querySelectorAll('ps-menu.row-menu')).toHaveLength(1);
    expect(root.querySelectorAll('ps-tooltip.name-tooltip')).toHaveLength(1);
    expect(root.querySelectorAll('.legend-items ps-menu, .legend-items ps-tooltip')).toHaveLength(0);
  });
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.rows.test.ts`
Expected: FAIL: focusing row C leaves the stop on A (`['A']`), and `ps-tooltip.name-tooltip` is missing (0, not 1).

- [ ] **Step 2: Write the failing tooltip browser test**

In `packages/core/src/components/legend/legend.rows.browser.test.ts` (Task 3.6), add to the imports

```ts
import type { PsTooltip } from '../kit/tooltip';
import { NAME_TOOLTIP_DELAY_MS } from './legend-list';
```

add after the `frame` helper

```ts
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
```

and inside the `describe`, before "the ⋯ menu opens on its button, and Show only this isolates":

```ts
  it('hovering a truncated name shows its full text after 500 ms; a name that fits shows nothing', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');

    await userEvent.hover(part(legend, LONG, '.legend-item-main'));
    expect(shown()).toBe(false);
    await expect.poll(shown, { timeout: NAME_TOOLTIP_DELAY_MS + 1000 }).toBe(true);
    expect(tooltip.text).toBe(LONG);

    await userEvent.hover(part(legend, 'Short', '.legend-item-main'));
    expect(shown()).toBe(false);
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(shown()).toBe(false);
  });
```

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.rows.browser.test.ts`
Expected: FAIL: the file does not load (`legend-list` provides no export named `NAME_TOOLTIP_DELAY_MS`); in the browser project a missing named export is a module link error, not `undefined`.

- [ ] **Step 3: Write the e2e legend helpers and spec**

Create `apps/web/tests/helpers/legend.ts`:

```ts
/**
 * Legend helpers. Each finds the legend's controls by role, accessible name or tag; Playwright's
 * locators pierce the legend's shadow root, so none reaches into it by hand.
 */
import { expect, type Locator, type Page } from '@playwright/test';
// helpers/explore.ts re-exports three helpers from here; the two only call each other at run time.
import { waitForExploreInteractionReady } from './explore';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The start of a row's name, "{label}: …"; Other's label is "Other · N categories". */
function rowName(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value)}( · [^:]*)?:`);
}

export const legend = (page: Page): Locator => page.locator('protspace-legend');

/** A row's main button, which toggles the category, found by the start of its accessible name. */
export const legendRow = (page: Page, value: string): Locator =>
  legend(page).getByRole('button', { name: rowName(value) });

/** The row around a row's main button. */
const legendItem = (page: Page, value: string): Locator =>
  legend(page)
    .locator('.legend-item')
    .filter({ has: page.getByRole('button', { name: rowName(value) }) });

/** Every row's value in display order; `visible` keeps only the shown or only the hidden rows. */
export async function legendRowValues(
  page: Page,
  options: { visible?: boolean } = {},
): Promise<string[]> {
  return legend(page)
    .locator('.legend-item')
    .evaluateAll(
      (rows, visible) =>
        rows
          .filter(
            (row) =>
              visible === null ||
              (row.querySelector('.legend-item-main')?.getAttribute('aria-pressed') === 'true') ===
                visible,
          )
          .map((row) => row.getAttribute('data-value') ?? ''),
      options.visible ?? null,
    );
}

/** Hovers a row so its actions show, then clicks its eye or picks an item from its "⋯" menu. */
export async function legendRowAction(
  page: Page,
  value: string,
  action: 'Hide' | 'Show' | 'Show only this' | 'Show all' | 'Colour and shape',
): Promise<void> {
  const item = legendItem(page, value);
  await legendRow(page, value).hover();
  if (action === 'Hide' || action === 'Show') {
    await item.getByRole('button', { name: new RegExp(`^${action} `) }).click();
    return;
  }
  await item.getByRole('button', { name: /^More actions for / }).click();
  await legend(page).getByRole('menuitem', { name: action, exact: true }).click();
  await expect(legend(page).getByRole('menu', { name: /^Actions for / })).toBeHidden();
}

export async function getFirstLegendItemValue(page: Page): Promise<string> {
  const value = await legend(page)
    .locator('.legend-item:not([data-value="Other"]):not([data-value="__NA__"])')
    .first()
    .getAttribute('data-value', { timeout: 5_000 })
    .catch(() => null);
  if (!value) {
    throw new Error('No legend item found');
  }
  return value;
}

export async function clickLegendItem(page: Page, value: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await legendRow(page, value).click();
}

/**
 * Whether a row is hidden, read from its main button's `aria-pressed`; false when no such row. The
 * row is found by its raw value (`data-value`), so `__NA__` and numeric bin ids work as before.
 */
export async function isLegendItemHidden(page: Page, value: string): Promise<boolean> {
  const main = legend(page).locator(
    `.legend-item[data-value="${value.replace(/["\\]/g, '\\$&')}"] .legend-item-main`,
  );
  if ((await main.count()) === 0) return false;
  return (await main.first().getAttribute('aria-pressed')) === 'false';
}
```

In `apps/web/tests/helpers/explore.ts`, delete the three functions `getFirstLegendItemValue`, `clickLegendItem` and `isLegendItemHidden` (`export async function getFirstLegendItemValue(page: Page)` through the end of `isLegendItemHidden`), delete `function escapeRegex` at the top of the file (its only user was `clickLegendItem`; check with `grep -n escapeRegex apps/web/tests/helpers/explore.ts`), and add after the imports:

```ts
// The legend helpers live in helpers/legend.ts; these three are re-exported for their old callers.
export { clickLegendItem, getFirstLegendItemValue, isLegendItemHidden } from './legend';
```

Create `apps/web/tests/workbench-legend.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { SIDEBAR_WIDTH } from '../src/explore/layout-defaults';
import { getFirstLegendItemValue, openExplore, selectAnnotation } from './helpers/explore';
import {
  isLegendItemHidden,
  legend,
  legendRow,
  legendRowAction,
  legendRowValues,
} from './helpers/legend';
import { seedLayout } from './helpers/workbench';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('workbench legend', () => {
  test('legend rows are 28 px with their actions hidden until hover', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);
    const row = legend(page).locator(`.legend-item[data-value="${value}"]`);

    expect((await row.boundingBox())?.height).toBeCloseTo(28, 0);
    const actions = row.locator('.legend-item-actions');
    await expect(actions).toHaveCSS('opacity', '0');
    await legendRow(page, value).hover();
    await expect(actions).toHaveCSS('opacity', '1');
  });

  test('the eye hides a category and the row stays, dimmed', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    // The demo's stored settings may already hide some rows: compare against them.
    const hiddenBefore = await legendRowValues(page, { visible: false });
    await legendRowAction(page, value, 'Hide');

    await expect.poll(() => isLegendItemHidden(page, value)).toBe(true);
    expect(await legendRowValues(page)).toContain(value);
    expect((await legendRowValues(page, { visible: false })).sort()).toEqual(
      [...hiddenBefore, value].sort(),
    );
    await expect(legendRow(page, value)).toHaveAccessibleName(/, hidden$/);
    await expect(
      legend(page).locator(`.legend-item[data-value="${value}"] .legend-swatch`),
    ).toHaveCSS('opacity', '0.35');
  });

  test('Show only this from the ⋯ menu isolates the category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    await legendRowAction(page, value, 'Show only this');

    await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([value]);
  });

  test("a long name ends in an ellipsis and its full name is in the row's accessible name", async ({
    page,
  }) => {
    await seedLayout(page, { sidebarWidth: SIDEBAR_WIDTH.min });
    await openExplore(page);
    await selectAnnotation(page, 'protein_families');
    const rows = legend(page).locator('.legend-item');
    await expect(rows.first()).toBeVisible();

    const truncated = await rows.evaluateAll((items) =>
      items
        .map((item) => {
          const text = item.querySelector('.legend-text') as HTMLElement;
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
          return {
            value: item.getAttribute('data-value') ?? '',
            label: text.textContent?.trim() ?? '',
            truncated: text.scrollWidth > text.clientWidth,
            oneLine: text.getBoundingClientRect().height <= lineHeight * 1.5,
          };
        })
        .filter((each) => each.truncated),
    );

    expect(truncated.length).toBeGreaterThan(0);
    const [longest] = truncated;
    expect(longest.oneLine).toBe(true);
    await expect(legendRow(page, longest.value)).toHaveAccessibleName(
      new RegExp(`^${escapeRegex(longest.label)}: `),
    );
  });
});
```

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-legend.spec.ts`
Expected: the four tests pass already (Task 3.6 built the rows they read); they pin the rows for the e2e from here on. If one fails, fix the helper, not the rows.

- [ ] **Step 4: Add the roving stop and the name tooltip to `legend-list.ts`**

In `packages/core/src/components/legend/legend-list.ts`, merge into the imports:

```ts
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';
import '../kit/tooltip';
import type { PsTooltip } from '../kit/tooltip';
```

In `class LegendKeyboardController`, add after `private _snapshot: LegendReorderSnapshot | null = null;`:

```ts
  private _focusValue: string | null = null;
  /** The row holding the Tab stop, worked out once per item list and focus value. */
  private _stop: { items: readonly LegendItem[]; focus: string | null; value: string | null } | null =
    null;
```

and after the `pickedValue` getter:

```ts
  /**
   * The row with the list's one Tab stop, kept by value so a re-sort keeps it on the same
   * category. The legend sets it when focus enters a row; null means the first row.
   */
  get focusValue(): string | null {
    return this._focusValue;
  }

  set focusValue(value: string | null) {
    if (value === this._focusValue) return;
    this._focusValue = value;
    this.host.requestUpdate();
  }

  /** Whether a row holds the Tab stop: the focused row while it is listed, else the first row. */
  isTabbable(value: string): boolean {
    const items = this.options.getSortedItems();
    if (this._stop?.items !== items || this._stop.focus !== this._focusValue) {
      const kept =
        this._focusValue !== null && items.some((item) => item.value === this._focusValue);
      this._stop = {
        items,
        focus: this._focusValue,
        value: kept ? this._focusValue : (items[0]?.value ?? null),
      };
    }
    return this._stop.value === value;
  }
```

Append to the end of the file:

```ts
/** A row name that ends in an ellipsis shows in full this long after the pointer reaches it. */
export const NAME_TOOLTIP_DELAY_MS = 500;

/**
 * One shared tooltip for row names that end in an ellipsis: after NAME_TOOLTIP_DELAY_MS on a row's
 * main button it shows the full name; a name that fits shows nothing. Keyboard and screen-reader
 * users already get the full name from the button's accessible name, so the tooltip names nothing
 * (`names-target`). The element is driven directly, never through the legend's template, so a
 * hover never re-renders the legend.
 */
export class TruncatedNameTooltip implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _trigger: HTMLElement | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.host = host;
    host.addController(this);
  }

  hover(trigger: HTMLElement, textEl: HTMLElement): void {
    this.leave();
    if (textEl.scrollWidth <= textEl.clientWidth) return;
    this._trigger = trigger;
    trigger.addEventListener('pointerleave', this._onLeave);
    const text = textEl.textContent?.trim() ?? '';
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._show(trigger, text);
    }, NAME_TOOLTIP_DELAY_MS);
  }

  leave(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    this._trigger?.removeEventListener('pointerleave', this._onLeave);
    this._trigger = null;
    const tooltip = this._tooltip();
    if (!tooltip) return;
    tooltip.hide();
    // Empty text shows nothing: the tooltip stays bound to its last row, whose focus must not show it.
    tooltip.text = '';
  }

  hostDisconnected(): void {
    this.leave();
  }

  render(): TemplateResult {
    return html`<ps-tooltip class="name-tooltip" names-target placement="top"></ps-tooltip>`;
  }

  private _onLeave = (): void => this.leave();

  private async _show(trigger: HTMLElement, text: string): Promise<void> {
    const tooltip = this._tooltip();
    if (!tooltip || this._trigger !== trigger || !text) return;
    tooltip.anchor = trigger;
    tooltip.text = text;
    // The tooltip binds to its new anchor in its own update; show() needs that target.
    await tooltip.updateComplete;
    if (this._trigger === trigger) tooltip.show();
  }

  private _tooltip(): PsTooltip | null {
    return this.host.shadowRoot?.querySelector<PsTooltip>('ps-tooltip.name-tooltip') ?? null;
  }
}
```

- [ ] **Step 5: Bind the two new row handlers**

In `packages/core/src/components/legend/legend-row.ts`:

(a) In `interface LegendRowHandlers`, add after `onHover(category: string | null): void;`:

```ts
  /** Focus entered the row: it takes the list's Tab stop. */
  onFocus(): void;
```

and after `onViewOther(e: Event): void;`:

```ts
  /** The pointer reached the main button: a truncated name may show in full. */
  onNamePointerEnter(e: PointerEvent): void;
```

(b) In `renderLegendRow`, on the row `div.legend-item`, add after `@mouseleave=${() => handlers.onHover(null)}`:

```ts
      @focusin=${() => handlers.onFocus()}
```

and on `button.legend-item-main`, add after `@keydown=${handlers.onKeyDown}`:

```ts
        @pointerenter=${handlers.onNamePointerEnter}
```

In the `LegendRowView` doc comment for `tabbable`, keep "The list's one Tab stop is in this row."

- [ ] **Step 6: Wire the stop and the tooltip into the legend**

All edits are in `packages/core/src/components/legend/legend.ts`.

(a) Add `TruncatedNameTooltip` to the `./legend-list` import.

(b) After the `_keyboard = new LegendKeyboardController(this, { … });` field add:

```ts
  private _nameTooltip = new TruncatedNameTooltip(this);
```

(c) In `_renderLegendItem`, replace

```ts
      // Today's rule: the first row holds the list's Tab stop (Task 3.7 makes it follow focus).
      tabbable: sortedIndex === 0,
```

with

```ts
      tabbable: this._keyboard.isTabbable(item.value),
```

and add to the `handlers` object, after `onHover`:

```ts
      onFocus: () => {
        this._keyboard.focusValue = item.value;
      },
```

and after `onViewOther`:

```ts
      onNamePointerEnter: (e: PointerEvent) => {
        const button = e.currentTarget as HTMLElement;
        const text = button.querySelector<HTMLElement>('.legend-text');
        if (text) this._nameTooltip.hover(button, text);
      },
```

If `sortedIndex` is now unused in `_renderLegendItem`, keep the parameter (the keyboard handler `onKeyDown` still passes it).

(d) `render()`: replace `${this._renderRowMenu()}` with

```ts
        ${this._renderRowMenu()} ${this._nameTooltip.render()}
```

so both are rendered once, among the last children of `.legend-container`.

- [ ] **Step 7: Run the unit and browser tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS: `legend.rows.test.ts` (11 tests) and every other legend file unchanged (`legend.keyboard-reorder.test.ts`'s row navigation still focuses main buttons by index).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.rows.browser.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS, the previous counts plus 2 unit and 1 browser case.

Run: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, counts unchanged.

Run: `pnpm type-check && pnpm lint && pnpm knip`
Expected: clean. `NAME_TOOLTIP_DELAY_MS` is used by the rows browser test, `TruncatedNameTooltip` by `legend.ts`; every export of `apps/web/tests/helpers/legend.ts` is used by `workbench-legend.spec.ts` or through `explore.ts`'s re-export.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in full, including `workbench-legend.spec.ts` (4 tests), `url-view-state-firefox` and `url-view-state-webkit` (they call `isLegendItemHidden`, which now reads `aria-pressed`), `dataset-reload`, `example-datasets`, `workbench-filter`, `load-large-bundle` (the moved helpers through `explore.ts`), `numeric-binning`, `legend-double-click` and `product-tour`. Known flakes re-run once alone.

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS with `budgets.json` unchanged. Focus moving between rows re-renders the legend once per move but never runs `_updateLegendItems`, so `legendUpdate` and `legendRebuild` stay at their budgets; a hover drives the tooltip directly and re-renders nothing.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.rows.test.ts packages/core/src/components/legend/legend.rows.browser.test.ts apps/web/tests/helpers/legend.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-legend.spec.ts
git add packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.rows.test.ts packages/core/src/components/legend/legend.rows.browser.test.ts apps/web/tests/helpers/legend.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-legend.spec.ts
git commit -m "feat(core): one Tab stop and a name tooltip for legend rows"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.8: Colour and shape picker on the kit; keyboard reorder joins the layer stack

The picker becomes a `ps-popover` anchored to its row, placed to the left over the plot, so nothing in the sidebar clips it; its shapes show inline as a radio group; Escape and an outside press come from the layer stack, and the legend's own mousedown/mouseup listeners and its picker branch of the window Escape handler go. A keyboard reorder pushes its own layer while a row is picked up, so Escape cancels it through the one order; the handler keeps only the Other and settings branches. The picker's styles move to a clean `styles/picker.ts` and `styles/item.ts` is deleted.

**Files:**

- Create: `packages/core/src/components/legend/styles/picker.ts`, `packages/core/src/components/legend/legend.color-picker.browser.test.ts`, `packages/core/src/components/legend/legend.escape-order.browser.test.ts`
- Modify: `packages/core/src/components/legend/legend-color-picker.ts`, `legend-list.ts`, `legend.ts`, `legend.styles.ts`, `packages/core/src/styles/style-lint.test.ts` (drop `legend/styles/item.ts`)
- Delete: `packages/core/src/components/legend/styles/item.ts`, `legend.color-picker.test.ts`, `legend.escape-order.test.ts` (replaced by the browser tests)

**Interfaces:**

- Consumes: `ColorPickerController` (3.4), the row menu's `customize` (3.6: `_onRowMenuSelect` finds the row element by `dataset.value` and runs `if (row && this._colorPicker.value !== value) this._colorPicker.toggle(value, row);`), `LegendKeyboardController` (3.4, with 3.7's roving stop: `pickedValue`, `cancel()`, `clear()`, `focusHandle(value)`, `hostDisconnected()`, `_pickUp`, and `onHandleKeyDown` with its `case 'Escape'`), `_listenForEscape(on)` (3.4), `ps-popover` (`../kit/popover`), `pushLayer` (`../kit/layers`), `deepActiveElement` (`../kit/focus`, tests), 3.1's `categoricalData`, `TWELVE`, `mountLegendWithScatterplot`, `MockScatterplot`.
- Produces:
  - `ColorPickerController`: `open(value: string, anchor: HTMLElement): void` anchors the picker to the row element (`.legend-item[data-value]`); `render(): TemplateResult` returns `<ps-popover class="color-picker" .anchor .open placement="left-start" panel-label="Colour and shape: {label}">` (always rendered, so closing hands focus back) with `.color-picker-header` (the label), `input[type=color].color-picker-swatch` ("Set color for {label}"), and `div[role=radiogroup][aria-label="Shape"]` of six `button.shape-picker-item[role=radio][aria-checked]` named "Use {shape} shape for {label}" (roving tabindex on the checked one; arrow keys, Home and End move and pick; disabled with the note "Shapes unavailable for multilabel annotations" for multilabel); `ps-open` puts focus on the colour input; `ps-close` flushes the pending colour and closes. No window listeners, no shape dropdown flag, no position maths, no `title` attributes. `hostConnected` goes; `hostDisconnected` still drops a pending colour. `toggle` goes: its only caller, the row menu's "Colour and shape", now calls `open`, so choosing it for the row whose picker is open keeps the picker open.
  - `LegendKeyboardController`: while `pickedValue` is set it holds `pushLayer({ close: () => …cancel and refocus the handle…, elements: [host], dismissOnOutsidePress: false })`, released on drop, cancel, `clear()` and `hostDisconnected()`; the handle's own Escape case goes.
  - `legend.ts`: the window capture handler keeps only the Other and settings branches and is attached only while one of them is open; the container's click-to-close-picker handler and the row menu's click stopper (3.6) go; "Colour and shape" runs `this._colorPicker.open(value, row)`.
  - `styles/picker.ts` (`pickerStyles`): panel content on tokens (shape items `--ps-accent-tint` / `--ps-accent-text` when checked).

**Tests:**

- `legend.color-picker.browser.test.ts`: "Colour and shape opens the picker in the top layer beside its row, unclipped by a 240 px sidebar"; "three colour inputs within 150 ms dispatch one legend-colormapping-change"; "a shape pick persists and checks its radio" (and the arrow keys move the pick); "Colour and shape on the row whose picker is open keeps it open"; "an outside press closes it and flushes the pending colour; a drag that ends outside does not"; "Escape closes it, flushes, and returns focus to the row's ⋯ button"; "multilabel annotations show the shapes disabled with the note".
- `legend.escape-order.browser.test.ts` (Review Focus 4): "with a reorder in progress, the picker opened from the row menu and the menu open again over it, each Escape closes one: menu, then picker, then the reorder (restored, 'Reordering canceled.')"; "a press outside during a reorder does not cancel it"; "with nothing of the legend's open, Escape reaches a document keydown listener"; "the Other dialog and the settings dialog still close on Escape" (until 3.10 and 3.12). The skeleton named the first "picker, then menu, then the reorder"; a plain `ps-menu` item closes its menu before `ps-select`, so "Colour and shape" leaves the picker alone over the reorder, and the only way to stack all three is to open the row's menu again over its own picker: the menu is then on top.
- `legend.keyboard-reorder.test.ts` passes (its Escape, dispatched from the handle with `bubbles` and `composed`, now reaches the layer stack's window listener first); `legend.rows.test.ts` passes ("Space on the handle adds .picked and aria-pressed; Escape removes them" now cancels through the layer).
- `numeric-binning` keyboard reorder tests and `pnpm perf:counts` pass.

Anchors below name methods; 3.6 and 3.7 left `legend-color-picker.ts` as 3.4 wrote it.

- [ ] **Step 1: Write the failing picker tests**

Create `packages/core/src/components/legend/legend.color-picker.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { LegendPersistedSettings, VisualizationData } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS } from './config';
import { COLOR_COMMIT_DELAY_MS } from './legend-color-picker';
import { TWELVE, categoricalData } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** Two categories, one protein carrying both: a multilabel annotation. */
function multilabelData(): VisualizationData {
  return {
    protein_ids: ['p1', 'p2', 'p3'],
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(6) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#e41a1c', '#377eb8'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { family: [[0], [0, 1], [1]] },
  };
}

/** The legend as a 240 px sidebar at the window's right edge, which clips what overflows it. */
async function mount(data: VisualizationData = categoricalData(TWELVE)) {
  const mounted = await mountLegendWithScatterplot(data, 'family');
  mounted.legend.style.cssText =
    'position: fixed; top: 0; right: 0; width: 240px; height: 480px; overflow: hidden;';
  await settle(mounted.legend);
  return mounted;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const more = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-more')!;
const picker = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsPopover>('ps-popover.color-picker')!;
const panel = (legend: ProtspaceLegend) =>
  picker(legend).shadowRoot!.querySelector<HTMLElement>('.panel')!;
const swatch = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<HTMLInputElement>('.color-picker-swatch')!;
const shape = (legend: ProtspaceLegend, name: string) =>
  legend.shadowRoot!.querySelector<HTMLButtonElement>(
    `.shape-picker-item[aria-label^="Use ${name} shape"]`,
  )!;

/** "⋯", then "Colour and shape", with the pointer, as a user opens it. */
async function openPicker(legend: ProtspaceLegend, value: string): Promise<void> {
  await userEvent.hover(row(legend, value).querySelector<HTMLElement>('.legend-item-main')!);
  await userEvent.click(more(legend, value));
  await settle(legend);
  const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
  const item = [...menu.querySelectorAll('ps-menu-item')].find(
    (each) => each.textContent!.trim() === 'Colour and shape',
  )!;
  await userEvent.click(item);
  await settle(legend);
}

/** Counts the colour-only mapping changes the legend sends the plot (a colour edit's commit). */
function colourCommits(plot: MockScatterplot): () => number {
  let count = 0;
  plot.addEventListener(LEGEND_EVENTS.COLORMAPPING_CHANGE, (event) => {
    if ((event as CustomEvent<{ colorOnly: boolean }>).detail.colorOnly) count += 1;
  });
  return () => count;
}

function inputColour(legend: ProtspaceLegend, color: string): void {
  const input = swatch(legend);
  input.value = color;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

function storedFamilyRecord(): LegendPersistedSettings {
  const key = Object.keys(localStorage).find(
    (each) => each.startsWith('protspace:legend:') && each.endsWith(':family'),
  );
  return JSON.parse(localStorage.getItem(key!)!) as LegendPersistedSettings;
}

describe('legend colour and shape picker', () => {
  it('Colour and shape opens the picker in the top layer beside its row, unclipped by a 240 px sidebar', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');

    expect(picker(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(panel(legend).getAttribute('role')).toBe('dialog');
    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: A');

    const rowBox = row(legend, 'A').getBoundingClientRect();
    const box = panel(legend).getBoundingClientRect();
    // left-start: beside the row, over the plot, its top level with the row's.
    expect(box.right).toBeLessThanOrEqual(rowBox.left + 1);
    expect(Math.abs(box.top - rowBox.top)).toBeLessThanOrEqual(3);
    // Outside the legend's clipping box, and still what a press there reaches.
    expect(box.left).toBeLessThan(legend.getBoundingClientRect().left);
    const hit = legend.shadowRoot!.elementFromPoint(box.left + 12, box.top + 12);
    expect(hit?.closest('ps-popover.color-picker')).toBe(picker(legend));
  });

  it('three colour inputs within 150 ms dispatch one legend-colormapping-change', async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);

    for (const color of ['#112233', '#223344', '#334455']) inputColour(legend, color);
    await legend.updateComplete;

    // The row repaints at once; the plot waits until the drag pauses.
    expect(row(legend, 'A').querySelector('.legend-symbol path')!.getAttribute('fill')).toBe(
      '#334455',
    );
    expect(commits()).toBe(0);
    await expect.poll(commits, { timeout: COLOR_COMMIT_DELAY_MS + 1000 }).toBe(1);
    // and no second commit trails it
    await pause(COLOR_COMMIT_DELAY_MS);
    expect(commits()).toBe(1);
  });

  it('a shape pick persists and checks its radio', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');
    expect(legend.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe(
      'Shape',
    );
    expect(shape(legend, 'circle').getAttribute('aria-checked')).toBe('true');

    await userEvent.click(shape(legend, 'square'));
    await settle(legend);

    expect(shape(legend, 'square').getAttribute('aria-checked')).toBe('true');
    expect(shape(legend, 'circle').getAttribute('aria-checked')).toBe('false');
    expect(storedFamilyRecord().categories.A.shape).toBe('square');

    // The arrow keys move the pick, and focus goes with the checked radio.
    shape(legend, 'square').focus();
    await userEvent.keyboard('{ArrowRight}');
    await settle(legend);
    expect(shape(legend, 'diamond').getAttribute('aria-checked')).toBe('true');
    expect(deepActiveElement()).toBe(shape(legend, 'diamond'));
    expect(storedFamilyRecord().categories.A.shape).toBe('diamond');
  });

  it('Colour and shape on the row whose picker is open keeps it open', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');
    expect(picker(legend).open).toBe(true);

    await openPicker(legend, 'A');

    expect(picker(legend).open).toBe(true);
    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: A');
  });

  it('an outside press closes it and flushes the pending colour; a drag that ends outside does not', async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);

    press(swatch(legend), document.body);
    await settle(legend);
    expect(picker(legend).open).toBe(true);

    inputColour(legend, '#123456');
    press(document.body);
    await settle(legend);

    expect(picker(legend).open).toBe(false);
    // At once, well inside the commit delay.
    expect(commits()).toBe(1);
  });

  it("Escape closes it, flushes, and returns focus to the row's ⋯ button", async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    expect(deepActiveElement()).toBe(swatch(legend));
    const commits = colourCommits(plot);
    inputColour(legend, '#654321');

    await userEvent.keyboard('{Escape}');
    await settle(legend);

    expect(picker(legend).open).toBe(false);
    expect(commits()).toBe(1);
    expect(deepActiveElement()).toBe(more(legend, 'A'));
  });

  it('multilabel annotations show the shapes disabled with the note', async () => {
    const { legend } = await mount(multilabelData());
    await openPicker(legend, 'A');

    const shapes = [...legend.shadowRoot!.querySelectorAll<HTMLButtonElement>('.shape-picker-item')];
    expect(shapes).toHaveLength(6);
    expect(shapes.every((button) => button.disabled)).toBe(true);
    expect(legend.shadowRoot!.querySelector('.symbol-picker-note')!.textContent!.trim()).toBe(
      'Shapes unavailable for multilabel annotations',
    );
  });
});
```

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.color-picker.browser.test.ts`
Expected: FAIL: `ps-popover.color-picker` does not exist (the picker is still the absolute `.color-picker-popover`), so the first assertion of every test throws.

- [ ] **Step 2: Write the failing Escape-order tests**

Create `packages/core/src/components/legend/legend.escape-order.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import type { ProtspaceLegend } from './legend';
import { TWELVE, categoricalData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

const cleanups: Array<() => void> = [];
beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** At the window's right edge, so the picker opens over empty space left of the legend. */
async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  legend.style.cssText = 'position: fixed; top: 0; right: 0; width: 240px; height: 480px;';
  await settle(legend);
  return legend;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const handle = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.drag-handle')!;
const rowMenu = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
const picker = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsPopover>('ps-popover.color-picker')!;
const order = (legend: ProtspaceLegend) =>
  [...legend.shadowRoot!.querySelectorAll('.legend-item')].map((each) =>
    each.getAttribute('data-value'),
  );
const picked = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('.legend-item.picked')?.getAttribute('data-value') ?? null;
const status = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim();

async function key(legend: ProtspaceLegend, target: HTMLElement, name: string): Promise<void> {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }),
  );
  await settle(legend);
}

async function openRowMenu(legend: ProtspaceLegend, value: string): Promise<void> {
  await userEvent.hover(row(legend, value).querySelector<HTMLElement>('.legend-item-main')!);
  await userEvent.click(row(legend, value).querySelector<HTMLElement>('.legend-more')!);
  await settle(legend);
}

async function choose(legend: ProtspaceLegend, label: string): Promise<void> {
  const item = [...rowMenu(legend).querySelectorAll('ps-menu-item')].find(
    (each) => each.textContent!.trim() === label,
  )!;
  await userEvent.click(item);
  await settle(legend);
}

function press(target: Element): void {
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

describe('legend Escape order', () => {
  it("with a reorder in progress, the picker opened from the row menu and the menu open again over it, each Escape closes one: menu, then picker, then the reorder (restored, 'Reordering canceled.')", async () => {
    const legend = await mount();
    await key(legend, handle(legend, 'A'), ' ');
    await key(legend, handle(legend, 'A'), 'ArrowDown');
    expect(order(legend).slice(0, 2)).toEqual(['B', 'A']);
    expect(picked(legend)).toBe('A');

    await openRowMenu(legend, 'A');
    await choose(legend, 'Colour and shape');
    expect(rowMenu(legend).open).toBe(false);
    expect(picker(legend).open).toBe(true);
    // The row is the picker's anchor, so its own "⋯" opens the menu over the picker.
    await openRowMenu(legend, 'A');
    expect(rowMenu(legend).open).toBe(true);
    expect(picker(legend).open).toBe(true);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([rowMenu(legend).open, picker(legend).open, picked(legend)]).toEqual([
      false,
      true,
      'A',
    ]);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect([rowMenu(legend).open, picker(legend).open, picked(legend)]).toEqual([
      false,
      false,
      'A',
    ]);

    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picked(legend)).toBeNull();
    expect(order(legend).slice(0, 2)).toEqual(['A', 'B']);
    expect(status(legend)).toBe('Reordering canceled.');
  });

  it('a press outside during a reorder does not cancel it', async () => {
    const legend = await mount();
    await key(legend, handle(legend, 'A'), ' ');

    press(document.body);
    await settle(legend);

    expect(picked(legend)).toBe('A');
  });

  it("with nothing of the legend's open, Escape reaches a document keydown listener", async () => {
    const legend = await mount();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    cleanups.push(() => document.removeEventListener('keydown', seen));

    row(legend, 'A').querySelector<HTMLElement>('.legend-item-main')!.focus();
    await userEvent.keyboard('{Escape}');

    expect(seen).toHaveBeenCalledOnce();
    expect((seen.mock.calls[0][0] as KeyboardEvent).key).toBe('Escape');
  });

  it('the Other dialog and the settings dialog still close on Escape', async () => {
    const legend = await mount();
    const root = legend.shadowRoot!;

    root.querySelector<HTMLButtonElement>('.legend-item-other .view-button')!.click();
    await settle(legend);
    expect(root.querySelector('#legend-other-dialog')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(root.querySelector('#legend-other-dialog')).toBeNull();

    // Today's header button, or 3.9's ps-icon-button: both are named "Legend settings".
    root.querySelector<HTMLElement>('.settings-button, button[aria-label="Legend settings"]')!.click();
    await settle(legend);
    expect(root.querySelector('#legend-settings-dialog')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(root.querySelector('#legend-settings-dialog')).toBeNull();
  });
});
```

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.escape-order.browser.test.ts`
Expected: FAIL: the first test fails at `picker(legend).open` (no `ps-popover.color-picker` yet). "a press outside during a reorder", "Escape reaches a document listener" and the dialog test pass already: they pin behaviour this task must keep.

- [ ] **Step 3: Put the picker on `ps-popover`**

Replace the contents of `packages/core/src/components/legend/legend-color-picker.ts` with:

```ts
import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from 'lit';
import type { PointShape } from '@protspace/utils';
import '../kit/popover';
import { SHAPE_PATH_GENERATORS, toDisplayValue } from './config';
import type { LegendItem } from './types';

/** A colour edit reaches the plot this long after the last input event of a drag in the picker. */
export const COLOR_COMMIT_DELAY_MS = 150;

const SHAPES: readonly PointShape[] = [
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'triangle-down',
  'plus',
];

/** What the picker reads from the legend and hands back to it. */
interface ColorPickerOptions {
  getItem(value: string): LegendItem | undefined;
  /** Repaints the row while a colour is dragged; the plot follows when the edit commits. */
  preview(value: string, color: string): void;
  commitColor(value: string, color: string): void;
  commitShape(value: string, shape: PointShape): void;
  isMultilabel(): boolean;
  isNumeric(): boolean;
}

/** One shape as its radio draws it: filled in the text colour, the plus as an outline. */
function shapeIcon(shape: PointShape): TemplateResult {
  const size = 14;
  const canvas = 20;
  const centre = canvas / 2;
  const outline = shape === 'plus';
  return html`<svg
    width=${canvas}
    height=${canvas}
    viewBox="0 0 ${canvas} ${canvas}"
    aria-hidden="true"
    focusable="false"
  >
    <g transform="translate(${centre}, ${centre})">
      <path
        d=${SHAPE_PATH_GENERATORS[shape](size)}
        fill=${outline ? 'none' : 'currentColor'}
        stroke="currentColor"
        stroke-width=${outline ? 1.5 : 1}
      ></path>
    </g>
  </svg>`;
}

/**
 * The colour and shape picker of one legend row, a ps-popover anchored to the row and placed to its
 * left, over the plot. The layer stack closes it on Escape or a press outside (design decision 11);
 * either way a colour still waiting for its commit delay lands first. The legend owns the items and
 * applies the edits it is handed.
 */
export class ColorPickerController implements ReactiveController {
  private host: ReactiveControllerHost & HTMLElement;
  private options: ColorPickerOptions;
  private _value: string | null = null;
  private _anchor: HTMLElement | null = null;
  private _pending: { value: string; color: string } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: ReactiveControllerHost & HTMLElement, options: ColorPickerOptions) {
    this.host = host;
    this.options = options;
    host.addController(this);
  }

  /** The row whose picker is open, or null. */
  get value(): string | null {
    return this._value;
  }

  hostDisconnected(): void {
    // As before: a pending colour is dropped, not committed, when the legend leaves the page.
    this._cancelTimer();
  }

  /** Opens the picker beside `anchor`, the row element; another row's pending colour lands first. */
  open(value: string, anchor: HTMLElement): void {
    this.flush();
    this._value = value;
    this._anchor = anchor;
    this.host.requestUpdate();
  }

  /** Commits a pending colour, then closes. */
  close(): void {
    this.flush();
    if (this._value === null) return;
    this._value = null;
    this._anchor = null;
    this.host.requestUpdate();
  }

  /** Commits a colour still waiting for its delay, at once. */
  flush(): void {
    const pending = this._pending;
    this._cancelTimer();
    if (pending) this.options.commitColor(pending.value, pending.color);
  }

  /** The popover is always rendered: closing it, not removing it, hands focus back. */
  render(): TemplateResult {
    const item = this._value === null ? undefined : this.options.getItem(this._value);
    const open = item !== undefined && this._anchor !== null;
    const label = item ? (item.displayValue ?? toDisplayValue(item.value)) : '';
    return html`<ps-popover
      class="color-picker"
      .anchor=${this._anchor}
      .open=${open}
      placement="left-start"
      panel-label=${open ? `Colour and shape: ${label}` : 'Colour and shape'}
      @ps-open=${this._onOpen}
      @ps-close=${this._onClose}
      >${item && open ? this._renderBody(item, label) : nothing}</ps-popover
    >`;
  }

  private _renderBody(item: LegendItem, label: string): TemplateResult {
    const numeric = this.options.isNumeric();
    const shapesDisabled = numeric || this.options.isMultilabel();
    const current: PointShape = SHAPES.includes(item.shape as PointShape)
      ? (item.shape as PointShape)
      : 'circle';
    return html`<div class="color-picker-body">
      <div class="color-picker-header">${label}</div>
      <div class="color-picker-field">
        <span class="color-picker-caption" aria-hidden="true">Colour</span>
        <input
          type="color"
          class="color-picker-swatch"
          .value=${item.color}
          aria-label=${`Set color for ${label}`}
          @input=${(e: Event) =>
            this._onColorInput(item.value, (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="color-picker-field">
        <span class="color-picker-caption" aria-hidden="true">Shape</span>
        <div
          class="shape-picker"
          role="radiogroup"
          aria-label="Shape"
          @keydown=${(e: KeyboardEvent) =>
            this._onShapeKeyDown(e, item.value, current, shapesDisabled)}
        >
          ${SHAPES.map(
            (shape) =>
              html`<button
                type="button"
                class="shape-picker-item"
                role="radio"
                aria-checked=${shape === current ? 'true' : 'false'}
                aria-label=${`Use ${shape} shape for ${label}`}
                tabindex=${shape === current ? '0' : '-1'}
                ?disabled=${shapesDisabled}
                @click=${() => this.options.commitShape(item.value, shape)}
              >
                ${shapeIcon(shape)}
              </button>`,
          )}
        </div>
      </div>
      ${shapesDisabled
        ? html`<p class="symbol-picker-note">
            ${numeric
              ? 'Shapes unavailable for numeric annotations'
              : 'Shapes unavailable for multilabel annotations'}
          </p>`
        : nothing}
    </div>`;
  }

  // Keyboard users land in the picker; on close the popover hands focus back to where it was.
  private _onOpen = (event: Event): void => {
    event.stopPropagation();
    this.host.shadowRoot?.querySelector<HTMLInputElement>('.color-picker-swatch')?.focus();
  };

  // Escape or a press outside closed the popover; the pending colour lands, then the state follows.
  private _onClose = (event: Event): void => {
    event.stopPropagation();
    this.close();
  };

  /** Radio-group keys: the arrows, Home and End pick a shape, and focus stays on the checked one. */
  private _onShapeKeyDown(
    e: KeyboardEvent,
    value: string,
    current: PointShape,
    disabled: boolean,
  ): void {
    if (disabled) return;
    const index = SHAPES.indexOf(current);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? SHAPES[(index + 1) % SHAPES.length]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? SHAPES[(index - 1 + SHAPES.length) % SHAPES.length]
          : e.key === 'Home'
            ? SHAPES[0]
            : e.key === 'End'
              ? SHAPES[SHAPES.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    this.options.commitShape(value, next);
    void this.host.updateComplete.then(() =>
      this.host.shadowRoot
        ?.querySelector<HTMLElement>('.shape-picker-item[aria-checked="true"]')
        ?.focus(),
    );
  }

  /** The row repaints on every tick; the plot gets the colour once the drag pauses. */
  private _onColorInput(value: string, color: string): void {
    this._cancelTimer();
    this.options.preview(value, color);
    this._pending = { value, color };
    this._timer = setTimeout(() => {
      const pending = this._pending;
      this._timer = null;
      this._pending = null;
      if (pending) this.options.commitColor(pending.value, pending.color);
    }, COLOR_COMMIT_DELAY_MS);
  }

  private _cancelTimer(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
    this._pending = null;
  }
}
```

- [ ] **Step 4: Put the keyboard reorder on the layer stack**

In `packages/core/src/components/legend/legend-list.ts`:

(a) Add to the imports:

```ts
import { pushLayer } from '../kit/layers';
```

(b) In `class LegendKeyboardController`, add after `private _snapshot: LegendReorderSnapshot | null = null;`:

```ts
  /** Releases the reorder's layer; set while a row is picked up. */
  private _releaseLayer: (() => void) | null = null;
```

(c) Replace `hostDisconnected`:

```ts
  hostDisconnected(): void {
    this._releaseLayer?.();
    this._releaseLayer = null;
    this._picked = null;
    this._snapshot = null;
  }
```

(d) In `onHandleKeyDown`, delete the whole `case 'Escape': { … }` block: Escape now reaches the reorder through the layer stack, whose window listener runs before the handle sees the key.

(e) Replace `clear` and `_pickUp`:

```ts
  /** Forgets the picked row and its snapshot, leaving the order as it is. */
  clear(): void {
    this._releaseLayer?.();
    this._releaseLayer = null;
    this._snapshot = null;
    if (this._picked === null) return;
    this._picked = null;
    this.host.requestUpdate();
  }
```

```ts
  private _pickUp(value: string): void {
    this._picked = value;
    this._snapshot = this.options.snapshot();
    // Escape cancels the reorder through the page's one layer stack (decision 11), after any menu
    // or picker opened over it; a press elsewhere leaves the row picked up.
    if (!this._releaseLayer) {
      this._releaseLayer = pushLayer({
        close: () => this._cancelFromEscape(),
        elements: [this.host],
        dismissOnOutsidePress: false,
      });
    }
    this.host.requestUpdate();
  }

  /** The layer's close: put the row back, then keep focus on its handle after the re-render. */
  private _cancelFromEscape(): void {
    const value = this._picked;
    if (this.cancel() && value !== null) requestAnimationFrame(() => this.focusHandle(value));
  }
```

(`cancel()` restores through the legend, whose restore calls `_keyboard.clear()`, which releases the layer.)

Update the class's doc comment sentence "and Escape (here or through the legend's window handler) puts it back" or "Escape puts it back" to: "and Escape, through the layer stack, puts it back".

- [ ] **Step 5: Shrink the legend's Escape handler and drop the picker's container click**

In `packages/core/src/components/legend/legend.ts`:

(a) Replace `_onWindowKeydownCapture` (3.4's version) with:

```ts
  // The Other and settings dialogs are not on the layer stack yet (3.10 and 3.12 move them).
  private _onWindowKeydownCapture = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (this._showOtherDialog) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._showOtherDialog = false;
      return;
    }
    if (this._showSettingsDialog) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this._handleSettingsClose();
    }
  };
```

(b) In `updated()`, replace the `_listenForEscape(…)` call and its comment with:

```ts
    // The colour picker, the row menu and a keyboard reorder are layers; only the two old dialogs
    // still need the legend's own Escape handler.
    this._listenForEscape(this._showSettingsDialog || this._showOtherDialog);
```

(c) In `render()`, delete the `.legend-container`'s `@click=${() => this._colorPicker.close()}` binding (the picker's outside press is the layer stack's now).

(d) In `_renderRowMenu`, delete the binding `@click=${(e: Event) => e.stopPropagation()}` on `<ps-menu class="row-menu">`: nothing listens for clicks on the container any more.

(e) In `_onRowMenuSelect`, replace

```ts
      // Chosen again for the row whose picker is open, the picker stays open.
      if (row && this._colorPicker.value !== value) this._colorPicker.toggle(value, row);
```

with

```ts
      // Opening is idempotent: chosen again for the row whose picker is open, it stays open.
      if (row) this._colorPicker.open(value, row);
```

(`toggle` is gone from `ColorPickerController`; this was its only caller.)

Then:

Run: `grep -nE "_colorPicker\.close\(\)|mousedown|mouseup|_keyboard\.cancel\(\)" packages/core/src/components/legend/legend.ts`
Expected: only `this._colorPicker.close();` at the top of `clearForNewDataset` (and the Other and settings dialogs' own overlay `mousedown`/`mouseup` handler names, which 3.10 and 3.12 delete).

- [ ] **Step 6: Move the picker styles to tokens and delete `item.ts`**

Create `packages/core/src/components/legend/styles/picker.ts`:

```ts
import { css } from 'lit';

/**
 * The colour and shape picker's content. The panel around it is the kit's ps-popover; this styles
 * what the legend slots into it. Every colour and type size reads a --ps-* token.
 */
export const pickerStyles = css`
  .color-picker-body {
    display: flex;
    flex-direction: column;
    gap: var(--ps-space-2);
    min-width: 200px;
    max-width: 280px;
    padding: var(--ps-space-3);
    box-sizing: border-box;
  }

  .color-picker-header {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text);
  }

  .color-picker-field {
    display: flex;
    align-items: center;
    gap: var(--ps-space-3);
  }

  .color-picker-caption {
    flex: none;
    width: 44px;
    font-size: var(--ps-text-sm);
    color: var(--ps-text-muted);
  }

  .color-picker-swatch {
    width: 40px;
    height: var(--ps-control-sm);
    padding: var(--ps-space-0-5);
    border: 1px solid var(--ps-border-control);
    border-radius: var(--ps-radius-sm);
    background: var(--ps-surface);
    cursor: pointer;
  }

  .shape-picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ps-space-1);
  }

  .shape-picker-item {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ps-control-sm);
    height: var(--ps-control-sm);
    padding: 0;
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius-sm);
    background: transparent;
    color: var(--ps-text-muted);
    cursor: pointer;
    transition:
      background-color var(--ps-duration-fast) var(--ps-ease),
      border-color var(--ps-duration-fast) var(--ps-ease),
      color var(--ps-duration-fast) var(--ps-ease);
  }

  .shape-picker-item:hover:not(:disabled) {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  .shape-picker-item[aria-checked='true'] {
    border-color: var(--ps-accent);
    background: var(--ps-accent-tint);
    color: var(--ps-accent-text);
  }

  .shape-picker-item:disabled {
    color: var(--ps-text-faint);
    cursor: not-allowed;
  }

  .color-picker-swatch:focus-visible,
  .shape-picker-item:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
    box-shadow: none;
  }

  @media (forced-colors: active) {
    .color-picker-swatch:focus-visible,
    .shape-picker-item:focus-visible {
      outline-color: Highlight;
    }
  }

  .symbol-picker-note {
    margin: 0;
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
  }
`;
```

In `packages/core/src/components/legend/legend.styles.ts`, replace the import `import { itemStyles } from './styles/item';` with

```ts
import { pickerStyles } from './styles/picker';
```

and the array entry `itemStyles,` with `pickerStyles,`.

Delete the file and the two jsdom tests the browser tests replace:

```bash
git rm packages/core/src/components/legend/styles/item.ts packages/core/src/components/legend/legend.color-picker.test.ts packages/core/src/components/legend/legend.escape-order.test.ts
```

In `packages/core/src/styles/style-lint.test.ts`, delete this line from `LEGACY`:

```ts
  '../components/legend/styles/item.ts',
```

- [ ] **Step 7: Run the new tests and the ones this task changes**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.color-picker.browser.test.ts src/components/legend/legend.escape-order.browser.test.ts src/components/legend/legend.rows.browser.test.ts`
Expected: PASS, 7 + 4 + 6 tests.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/styles`
Expected: PASS, including `legend.keyboard-reorder.test.ts` (Escape from the handle cancels through the layer stack's window listener and announces "Reordering canceled."), `legend.rows.test.ts` ("Space on the handle adds .picked and aria-pressed; Escape removes them"), `legend.double-click.test.ts` and `legend-extract.test.ts`; `style-lint.test.ts` checks `styles/picker.ts` as clean and no longer lists `styles/item.ts`; `styles-integrity.test.ts` finds `pickerStyles`.

- [ ] **Step 8: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS: the previous counts, minus the two deleted jsdom files, plus the two browser files.

Run: `pnpm type-check && pnpm lint && pnpm knip`
Expected: clean. `COLOR_COMMIT_DELAY_MS` is now used by `legend.color-picker.browser.test.ts`; `stubPopoverApi` is still used by `legend.rows.test.ts`.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning --project=legend-double-click --project=workbench`
Expected: PASS, including the numeric-binning keyboard reorders (Space, ArrowDown, then Escape, which the layer stack now routes to the reorder) and `workbench-legend.spec.ts`.

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS with `budgets.json` unchanged.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend-color-picker.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/picker.ts packages/core/src/components/legend/legend.color-picker.browser.test.ts packages/core/src/components/legend/legend.escape-order.browser.test.ts packages/core/src/styles/style-lint.test.ts
git add packages/core/src/components/legend/legend-color-picker.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/picker.ts packages/core/src/components/legend/legend.color-picker.browser.test.ts packages/core/src/components/legend/legend.escape-order.browser.test.ts packages/core/src/styles/style-lint.test.ts
git commit -m "feat(core): put the legend colour picker and reorder on the layer stack"
```

(The three deletions are already staged by `git rm` in Step 6. The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.9: Legend header: display name, predicted icon, sort button and settings

The header becomes the mockup's 44 px bar (decision 12): the display name (ellipsis, full name in the shared tooltip), the predicted-annotation icon replacing "⚡ Predicted" and its note line (decisions 8, 15), the info button, then a sort button whose icon and name show the active order and open a sort menu, and the settings button on the kit. A sort pick applies and persists at once. The reverse button goes; "Reverse order" lives in the sort menu.

**Files:**

- Create: `packages/core/src/components/legend/styles/header.ts`, `legend.sort-menu.browser.test.ts`
- Modify: `legend-header.ts`, `legend.ts`, `legend.styles.ts`, `styles/layout.ts` (header, title, badge and note rules leave), `packages/core/src/components/kit/icon.ts` (`arrow-up-down`, `arrow-down-wide-narrow`, `arrow-down-narrow-wide`, `arrow-down-a-z`, `arrow-down-z-a`, `arrow-down-0-1`, `arrow-down-1-0`, `sliders-horizontal`, `sparkles`)
- Modify tests: `legend.header.test.ts` (rewritten for the new header), `legend.dom-contract.test.ts` (no `predicted-note`), `legend.score-sync.test.ts` (:218–260) and `legend.score-strips.test.ts` (:204–212) set the sort through `_applySortMode`; `legend.api.test.ts` (its `legend-customize` case finds the settings button inside `ps-icon-button`, Step 9)
- Modify: `apps/web/tests/helpers/legend.ts`, `apps/web/tests/workbench-legend.spec.ts`, `apps/web/tests/numeric-binning.spec.ts` (`readLegendDisplay` :385, `clickLegendReverseButton` :414, `setSortMode` :849 and the tests at :391, :1044, :1398, :1666, :1673, :1893, :1911, :1926, :2157 that read or click the reverse button or the sort radios)
- Modify: `docs/developers/api/index.md` (the legend's parts: `predicted-note` removed)
- Modify: `apps/web/src/tour/product-tour.ts` (step 8 copy: the swatch click, the reverse icon and the gear it describes are gone)

All paths below without a folder are in `packages/core/src/components/legend/`.

**Interfaces:**

- Consumes:
  - 3.7: the legend's `TruncatedNameTooltip` instance `this._nameTooltip`, whose `hover(trigger: HTMLElement, textEl: HTMLElement): void` shows a truncated text's full name after 500 ms and hides on leave; `legendRowValues(page)`, `legend(page)` (`apps/web/tests/helpers/legend.ts`). 3.6: the row menu (`_rowMenu`, `ps-menu.row-menu`), counted by 3.7's "renders one ps-menu and one ps-tooltip whatever the row count".
  - 3.5: `normalizeSortModeForType(mode, isNumeric)`, `reorderByValues(items, orderedValues)` (`legend-items-state.ts`).
  - 3.4/3.8: `this._keyboard: LegendKeyboardController` (`clear()`).
  - 3.1: `categoricalData`, `numericData`, `TWELVE` (`test-support/legend-fixtures.ts`), `mountLegendWithScatterplot`, `createLocalStorageMock`.
  - Existing: `_toggleLegendOrderDirection`, `_handleCustomize`, `_currentSortMode`, `_isNumericAnnotation`, `_isCurrentAnnotationNumeric`, `_setNumericManualOrderIds`, `_updateLegendItems`, `_categoryScores`, `_legendItems`, `_sortedLegendItems`, `protspace-info-popover`, `ps-icon-button`, `ps-menu`, `ps-menu-group`, `ps-menu-item`, `ps-tooltip`, `icon()`.
- Produces:
  - `legend-header.ts`: `interface LegendHeaderModel { title: string; predicted: boolean; info?: TemplateResult; sortMode: LegendSortMode; isNumeric: boolean; hasScores: boolean; canSort: boolean }`; `interface LegendHeaderHandlers { onSortMenu(anchor: HTMLElement): void; onSettings(anchor: HTMLElement): void; onTitlePointerEnter(e: PointerEvent): void }`; `renderLegendHeader(model: LegendHeaderModel, handlers: LegendHeaderHandlers): TemplateResult`; `sortLabel(mode: LegendSortMode, isNumeric: boolean): string` (categorical: `size-desc` "By count, largest first", `size-asc` "By count, smallest first", `alpha-asc` "By name, A to Z", `alpha-desc` "By name, Z to A", `manual` "Your order", `manual-reverse` "Your order, reversed", `silhouette-desc` "By separation, best first", `silhouette-asc` "By separation, worst first"; numeric `alpha-asc` "By value, low to high", `alpha-desc` "By value, high to low", manual as above); `sortIcon(mode: LegendSortMode, isNumeric: boolean): IconName` (the Rulings' mapping); `interface SortMenuModel { open: boolean; anchor: HTMLElement | null; sortMode: LegendSortMode; isNumeric: boolean; hasScores: boolean }`; `renderSortMenu(model: SortMenuModel, handlers: { onPick(mode: LegendSortMode): void; onReverse(): void; onClose(): void }): TemplateResult`. `legendReverseLabel` is deleted.
  - Header DOM: `div.legend-header[part=header]` > `h3.legend-title`, `span.legend-predicted[role=img][aria-label="Predicted annotation"]` (`sparkles` 14 px, with `ps-tooltip` "Predicted: computational, not experimentally curated"), the info popover, a spacer, `ps-icon-button.sort-button` (`icon=sortIcon(…)`, `label="Sort: {sortLabel}"`, `size="sm"`, hidden when `!canSort`), `ps-icon-button.settings-button` (`icon="sliders-horizontal"`, `label="Legend settings"`, `size="sm"`).
  - Sort menu: `<ps-menu class="sort-menu" label="Sort legend">` > `ps-menu-group label="Sort by"` with radios `value="size-desc"` "By count" (categorical), `value="alpha-asc"` "By name" / "By value", `value="silhouette-desc"` "By separation" (when `hasScores` or the active mode is `silhouette-*`), `value="manual"` "Your order"; then `ps-menu-item type="checkbox" value="reverse"` "Reverse order". The checked radio is the active mode's base; "Reverse order" is checked for `size-asc`, `alpha-desc`, `manual-reverse`, `silhouette-asc`. The menu is rendered only while open (an empty template otherwise), so the legend root holds no closed menu.
  - `legend.ts`: `@state() _sortMenu: HTMLElement | null` (its anchor while open); `_applySortMode(mode: LegendSortMode): void` — clears a keyboard reorder, sets `_annotationSortModes[selectedAnnotation]` (normalised by type; picking "Your order" keeps today's display order as `_handleSettingsSave` does), runs `_updateLegendItems()` once, then `syncNumericAnnotationSettings()`, `dispatchZOrderChange()`, `saveSettings()`, `_dispatchLegendStateChange()`; "Reverse order" runs `_toggleLegendOrderDirection()`; the header's settings button still opens the old dialog through `_handleCustomize()`.
  - `styles/header.ts` (`headerStyles`): 44 px bar, title ellipsis, predicted icon `--ps-text-muted`, spacer.
  - Helpers (`helpers/legend.ts`): `legendSortButton(page): Locator`; `setLegendSort(page, choice: 'By count' | 'By name' | 'By value' | 'By separation' | 'Your order'): Promise<void>`; `toggleLegendReverse(page): Promise<void>`; `legendSortLabel(page): Promise<string>` (the button's name without "Sort: ").

**Tests:**

- `legend.header.test.ts` (unit, rewritten): "the title is the display name, never the key"; "a predicted annotation shows the sparkles icon named Predicted annotation, and no ⚡ or note"; "sortLabel names all eight modes, and the numeric ones by value" (table); "sortIcon maps every mode"; "the sort button is named Sort: {label}"; "the settings button is named Legend settings and dispatches legend-customize"; "with one row the sort button is hidden".
- `legend.sort-menu.browser.test.ts`: "picking By name applies without Save, persists sortMode alpha-asc and runs one legendUpdate"; "Your order keeps the current display order and persists manual"; "Reverse order maps each mode as the old reverse button did and keeps Other last"; "By separation appears only with scores or while active"; "the checked radio and the Reverse checkbox follow the active mode"; "picking the checked radio again keeps the reversed order"; "Escape closes the menu and returns focus to the sort button"; "at 240 px the title truncates and the sort and settings buttons stay fully visible" (Review Focus 5).
- `legend.score-sync.test.ts`, `legend.score-strips.test.ts`: the separation sort set through `_applySortMode` keeps their assertions.
- `workbench-legend.spec.ts`: "the header shows the display name and the active sort; picking By name reorders the list and stores it" (the reload round trip is Task 3.13's: a demo reload clears stored settings).
- `numeric-binning.spec.ts`: the reverse-button tests drive "Reverse order" through `toggleLegendReverse` and read the order from `legendSortLabel`; the full project passes.

Before you start, record `wc -l packages/core/src/components/legend/legend.ts` and the legend unit test count (`pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`) for the report.

- [ ] **Step 1: Write the failing header unit tests**

Replace the whole of `packages/core/src/components/legend/legend.header.test.ts` (Task 3.1's version pinned the old header; this task changes it on purpose) with:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotationLabel } from '@protspace/utils';
import type { PsIconButton } from '../kit/button';
import { LEGEND_EVENTS } from './config';
import type { ProtspaceLegend } from './legend';
import { sortIcon, sortLabel } from './legend-header';
import type { LegendSortMode } from './types';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';

// Settings persist per dataset: an in-memory store keeps one test's sort out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

async function mount(
  ...args: Parameters<typeof mountLegendWithScatterplot>
): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settle(legend);
  return legend;
}

async function headerButton(
  legend: ProtspaceLegend,
  name: 'sort-button' | 'settings-button',
): Promise<PsIconButton> {
  const button = legend.shadowRoot!.querySelector<PsIconButton>(
    `.legend-header ps-icon-button.${name}`,
  )!;
  await button.updateComplete;
  return button;
}

const inner = (button: PsIconButton) => button.shadowRoot!.querySelector('button')!;

const CATEGORICAL_LABELS: Array<[LegendSortMode, string]> = [
  ['size-desc', 'By count, largest first'],
  ['size-asc', 'By count, smallest first'],
  ['alpha-asc', 'By name, A to Z'],
  ['alpha-desc', 'By name, Z to A'],
  ['manual', 'Your order'],
  ['manual-reverse', 'Your order, reversed'],
  ['silhouette-desc', 'By separation, best first'],
  ['silhouette-asc', 'By separation, worst first'],
];

const NUMERIC_LABELS: Array<[LegendSortMode, string]> = [
  ['alpha-asc', 'By value, low to high'],
  ['alpha-desc', 'By value, high to low'],
  ['manual', 'Your order'],
  ['manual-reverse', 'Your order, reversed'],
];

describe('legend header', () => {
  it('the title is the display name, never the key', async () => {
    const legend = await mount(categoricalData(TWELVE, 'order'), 'order');
    const title = legend.shadowRoot!.querySelector('.legend-header .legend-title')!;
    expect(title.textContent!.trim()).toBe(annotationLabel('order'));
    expect(title.textContent!.trim()).not.toBe('order');
  });

  it('a predicted annotation shows the sparkles icon named Predicted annotation, and no ⚡ or note', async () => {
    const legend = await mount(categoricalData(TWELVE, 'predicted_membrane'), 'predicted_membrane');
    const root = legend.shadowRoot!;
    const mark = root.querySelector('.legend-header .legend-predicted')!;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('Predicted annotation');
    expect(mark.querySelector('svg')).not.toBeNull();
    const tooltip = mark.nextElementSibling!;
    expect(tooltip.tagName).toBe('PS-TOOLTIP');
    expect(tooltip.getAttribute('text')).toBe(
      'Predicted: computational, not experimentally curated',
    );
    expect(root.textContent).not.toContain('⚡');
    expect(root.querySelector('[part="predicted-note"]')).toBeNull();
    expect(root.querySelector('.legend-header [title]')).toBeNull();

    document.body.innerHTML = '';
    const plain = await mount(categoricalData(TWELVE), 'family');
    expect(plain.shadowRoot!.querySelector('.legend-predicted')).toBeNull();
  });

  it('sortLabel names all eight modes, and the numeric ones by value', () => {
    for (const [mode, label] of CATEGORICAL_LABELS) expect(sortLabel(mode, false)).toBe(label);
    for (const [mode, label] of NUMERIC_LABELS) expect(sortLabel(mode, true)).toBe(label);
  });

  it('sortIcon maps every mode', () => {
    const categorical: Array<[LegendSortMode, string]> = [
      ['size-desc', 'arrow-down-wide-narrow'],
      ['size-asc', 'arrow-down-narrow-wide'],
      ['alpha-asc', 'arrow-down-a-z'],
      ['alpha-desc', 'arrow-down-z-a'],
      ['manual', 'arrow-up-down'],
      ['manual-reverse', 'arrow-up-down'],
      ['silhouette-desc', 'arrow-down-wide-narrow'],
      ['silhouette-asc', 'arrow-down-narrow-wide'],
    ];
    for (const [mode, name] of categorical) expect(sortIcon(mode, false)).toBe(name);
    expect(sortIcon('alpha-asc', true)).toBe('arrow-down-0-1');
    expect(sortIcon('alpha-desc', true)).toBe('arrow-down-1-0');
    expect(sortIcon('manual', true)).toBe('arrow-up-down');
    expect(sortIcon('manual-reverse', true)).toBe('arrow-up-down');
  });

  it('the sort button is named Sort: {label}', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const sort = await headerButton(legend, 'sort-button');
    expect(sort.label).toBe('Sort: By count, largest first');
    expect(sort.icon).toBe('arrow-down-wide-narrow');
    expect(inner(sort).getAttribute('aria-label')).toBe('Sort: By count, largest first');
    expect(sort.hasAttribute('hidden')).toBe(false);

    document.body.innerHTML = '';
    const numeric = await mount(numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'length');
    const numericSort = await headerButton(numeric, 'sort-button');
    expect(numericSort.label).toBe('Sort: By value, low to high');
    expect(numericSort.icon).toBe('arrow-down-0-1');
  });

  it('the settings button is named Legend settings and dispatches legend-customize', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const settings = await headerButton(legend, 'settings-button');
    expect(settings.icon).toBe('sliders-horizontal');
    expect(inner(settings).getAttribute('aria-label')).toBe('Legend settings');
    const onCustomize = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.CUSTOMIZE, onCustomize);
    inner(settings).click();
    expect(onCustomize).toHaveBeenCalledOnce();
  });

  it('with one row the sort button is hidden', async () => {
    const legend = await mount(categoricalData({ A: 3 }), 'family');
    const sort = await headerButton(legend, 'sort-button');
    expect(sort.hasAttribute('hidden')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the header tests to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.header.test.ts`
Expected: FAIL. The two pure tests fail with `sortLabel is not a function` / `sortIcon is not a function` (Task 3.2's `legend-header.ts` exports `legendReverseLabel` only), and the mounted ones fail on `.legend-predicted`, `ps-icon-button.sort-button` and `ps-icon-button.settings-button`, which the old header does not render (`Cannot read properties of null`).

- [ ] **Step 3: Write the failing sort-menu browser tests**

Create `packages/core/src/components/legend/legend.sort-menu.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CategoryScore } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsIconButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import { LEGEND_VALUES } from './config';
import type { ProtspaceLegend } from './legend';
import type { LegendSortMode } from './types';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

interface Internals {
  _applySortMode(mode: LegendSortMode): void;
  _updateLegendItems(): void;
  _categoryScores: CategoryScore[];
}
const internals = (legend: ProtspaceLegend) => legend as unknown as Internals;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Wait until the legend and its menu stop re-rendering, then let the top layer paint. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
  await menu(legend)?.updateComplete;
  await frame();
  await frame();
}

async function mount(
  ...args: Parameters<typeof mountLegendWithScatterplot>
): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settle(legend);
  return legend;
}

const root = (legend: ProtspaceLegend) => legend.shadowRoot!;
const sortButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<PsIconButton>('.legend-header ps-icon-button.sort-button')!;
const settingsButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<PsIconButton>('.legend-header ps-icon-button.settings-button')!;
const innerButton = (host: PsIconButton) => host.shadowRoot!.querySelector('button')!;
const menu = (legend: ProtspaceLegend) => root(legend).querySelector<PsMenu>('ps-menu.sort-menu');
const menuItems = (legend: ProtspaceLegend) => [
  ...root(legend).querySelectorAll<PsMenuItem>('ps-menu.sort-menu ps-menu-item'),
];
const menuItem = (legend: ProtspaceLegend, value: string) =>
  menuItems(legend).find((item) => item.value === value);
const checkedRadios = (legend: ProtspaceLegend) =>
  menuItems(legend)
    .filter((item) => item.type === 'radio' && item.checked)
    .map((item) => item.value);
const rowValues = (legend: ProtspaceLegend) =>
  [...root(legend).querySelectorAll<HTMLElement>('.legend-item')].map((row) => row.dataset.value!);

/** The stored record for `annotation`, whatever the dataset hash. */
function storedRecord(annotation: string): Record<string, unknown> | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith('protspace:legend:') && key.endsWith(`:${annotation}`)) {
      return JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    }
  }
  return null;
}

async function openSortMenu(legend: ProtspaceLegend): Promise<PsMenu> {
  const button = innerButton(sortButton(legend));
  button.focus();
  button.click();
  await settle(legend);
  const open = menu(legend)!;
  expect(open.open).toBe(true);
  return open;
}

async function pick(legend: ProtspaceLegend, value: string): Promise<void> {
  menuItem(legend, value)!.click();
  await settle(legend);
}

async function escape(legend: ProtspaceLegend): Promise<void> {
  (deepActiveElement() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
  );
  await settle(legend);
}

const THREE = { beta: 3, alpha: 2, gamma: 1 } as const;

describe('legend sort menu', () => {
  it('picking By name applies without Save, persists sortMode alpha-asc and runs one legendUpdate', async () => {
    const legend = await mount(categoricalData(THREE), 'family');
    expect(rowValues(legend)).toEqual(['beta', 'alpha', 'gamma']);
    await openSortMenu(legend);
    expect(menuItems(legend).map((item) => item.textContent!.trim())).toEqual([
      'By count',
      'By name',
      'Your order',
      'Reverse order',
    ]);
    // perfCounters.legendUpdate counts exactly the calls of _updateLegendItems.
    const update = vi.spyOn(internals(legend), '_updateLegendItems');

    await pick(legend, 'alpha-asc');

    expect(update).toHaveBeenCalledOnce();
    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);
    expect(storedRecord('family')?.sortMode).toBe('alpha-asc');
    expect(menu(legend)).toBeNull();
    expect(sortButton(legend).label).toBe('Sort: By name, A to Z');
    expect(sortButton(legend).icon).toBe('arrow-down-a-z');
  });

  it('Your order keeps the current display order and persists manual', async () => {
    const legend = await mount(categoricalData(THREE), 'family');
    await openSortMenu(legend);
    await pick(legend, 'alpha-asc');
    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);

    await openSortMenu(legend);
    await pick(legend, 'manual');

    expect(rowValues(legend)).toEqual(['alpha', 'beta', 'gamma']);
    expect(storedRecord('family')?.sortMode).toBe('manual');
    expect(sortButton(legend).label).toBe('Sort: Your order');
    expect(sortButton(legend).icon).toBe('arrow-up-down');
  });

  it('Reverse order maps each mode as the old reverse button did and keeps Other last', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(rowValues(legend).at(-1)).toBe(LEGEND_VALUES.OTHER);
    const cases: Array<[LegendSortMode, LegendSortMode]> = [
      ['size-desc', 'size-asc'],
      ['alpha-asc', 'alpha-desc'],
      ['manual', 'manual-reverse'],
    ];
    for (const [base, reversed] of cases) {
      internals(legend)._applySortMode(base);
      await settle(legend);
      const before = rowValues(legend);

      await openSortMenu(legend);
      await pick(legend, 'reverse');

      expect(storedRecord('family')?.sortMode).toBe(reversed);
      const after = rowValues(legend);
      expect(after.at(-1)).toBe(LEGEND_VALUES.OTHER);
      expect(after.slice(0, -1)).toEqual(before.slice(0, -1).reverse());
      // A checkbox item keeps the menu open, now showing the new direction.
      expect(menu(legend)?.open).toBe(true);
      expect(menuItem(legend, 'reverse')!.checked).toBe(true);
      await escape(legend);
    }

    document.body.replaceChildren();
    const numeric = await mount(numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'length');
    const lowToHigh = rowValues(numeric);
    await openSortMenu(numeric);
    expect(menuItems(numeric).map((item) => item.textContent!.trim())).toEqual([
      'By value',
      'Your order',
      'Reverse order',
    ]);
    await pick(numeric, 'reverse');
    expect(storedRecord('length')?.sortMode).toBe('alpha-desc');
    expect(sortButton(numeric).label).toBe('Sort: By value, high to low');
    expect(rowValues(numeric)).toEqual([...lowToHigh].reverse());
  });

  it('By separation appears only with scores or while active', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')).toBeUndefined();
    await escape(legend);

    internals(legend)._applySortMode('silhouette-desc');
    await settle(legend);
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')?.checked).toBe(true);
    expect(menuItem(legend, 'silhouette-desc')?.textContent!.trim()).toBe('By separation');
    await escape(legend);

    internals(legend)._applySortMode('size-desc');
    internals(legend)._categoryScores = [
      { category: 'A', silhouette: 0.5, silhouetteEmbedding: null, daviesBouldin: 1 },
    ];
    await settle(legend);
    await openSortMenu(legend);
    expect(menuItem(legend, 'silhouette-desc')).toBeDefined();
    expect(menuItem(legend, 'silhouette-desc')?.checked).toBe(false);
  });

  it('the checked radio and the Reverse checkbox follow the active mode', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    await openSortMenu(legend);
    expect(root(legend).querySelector('ps-menu.sort-menu ps-menu-group')!.getAttribute('aria-label')).toBe(
      'Sort by',
    );
    expect(checkedRadios(legend)).toEqual(['size-desc']);
    expect(menuItem(legend, 'reverse')!.getAttribute('role')).toBe('menuitemcheckbox');
    expect(menuItem(legend, 'reverse')!.checked).toBe(false);
    await escape(legend);

    const cases: Array<[LegendSortMode, string, boolean]> = [
      ['size-asc', 'size-desc', true],
      ['alpha-desc', 'alpha-asc', true],
      ['alpha-asc', 'alpha-asc', false],
      ['manual-reverse', 'manual', true],
      ['manual', 'manual', false],
    ];
    for (const [mode, radio, reversed] of cases) {
      internals(legend)._applySortMode(mode);
      await settle(legend);
      await openSortMenu(legend);
      expect(checkedRadios(legend)).toEqual([radio]);
      expect(menuItem(legend, 'reverse')!.checked).toBe(reversed);
      await escape(legend);
    }
  });

  it('picking the checked radio again keeps the reversed order', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    internals(legend)._applySortMode('size-asc');
    await settle(legend);
    await openSortMenu(legend);
    expect(checkedRadios(legend)).toEqual(['size-desc']);
    const update = vi.spyOn(internals(legend), '_updateLegendItems');

    await pick(legend, 'size-desc');

    expect(update).not.toHaveBeenCalled();
    expect(storedRecord('family')?.sortMode).toBe('size-asc');
    expect(sortButton(legend).label).toBe('Sort: By count, smallest first');
  });

  it('Escape closes the menu and returns focus to the sort button', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const button = sortButton(legend);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await openSortMenu(legend);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(deepActiveElement()?.closest('ps-menu-item')?.value).toBe('size-desc');

    await escape(legend);

    expect(menu(legend)).toBeNull();
    expect(deepActiveElement()).toBe(innerButton(button));
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('at 240 px the title truncates and the sort and settings buttons stay fully visible', async () => {
    const name = `predicted_${'very_long_annotation_name_for_a_narrow_sidebar_'.repeat(2)}check`;
    const legend = await mount(categoricalData({ A: 3, B: 2, C: 1 }, name), name);
    legend.style.width = '240px';
    await settle(legend);

    const header = root(legend).querySelector<HTMLElement>('.legend-header')!;
    const title = root(legend).querySelector<HTMLElement>('.legend-title')!;
    const legendRect = legend.getBoundingClientRect();
    expect(header.getBoundingClientRect().height).toBeCloseTo(44, 0);
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(title.getBoundingClientRect().height).toBeLessThan(24);
    expect(root(legend).querySelector('.legend-predicted')!.getBoundingClientRect().width).toBe(14);

    const titleRight = title.getBoundingClientRect().right;
    for (const button of [sortButton(legend), settingsButton(legend)]) {
      const rect = button.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(28, 0);
      expect(rect.height).toBeCloseTo(28, 0);
      expect(rect.left).toBeGreaterThanOrEqual(titleRight);
      expect(rect.right).toBeLessThanOrEqual(legendRect.right);
    }
  });
});
```

- [ ] **Step 4: Run the browser tests to see them fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.sort-menu.browser.test.ts`
Expected: FAIL in every test: `ps-icon-button.sort-button` does not exist yet (`Cannot read properties of null`), and `_applySortMode` is not a function.

- [ ] **Step 5: Add the icons**

In `packages/core/src/components/kit/icon.ts`, add to the `lucide` import (keep it alphabetical; `ArrowDown01` sorts before `ArrowDown10`, which sorts before `ArrowDownAZ`):

```ts
  ArrowDown01,
  ArrowDown10,
  ArrowDownAZ,
  ArrowDownNarrowWide,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUpDown,
```

and, after the existing names, `SlidersHorizontal` and `Sparkles`. Add to `ICONS` (keep the keys alphabetical):

```ts
  'arrow-down-0-1': ArrowDown01,
  'arrow-down-1-0': ArrowDown10,
  'arrow-down-a-z': ArrowDownAZ,
  'arrow-down-narrow-wide': ArrowDownNarrowWide,
  'arrow-down-wide-narrow': ArrowDownWideNarrow,
  'arrow-down-z-a': ArrowDownZA,
  'arrow-up-down': ArrowUpDown,
```

and `'sliders-horizontal': SlidersHorizontal,` and `sparkles: Sparkles,`. Every key is used by `legend-header.ts` in Step 6 (`sortIcon` reaches all seven arrows), so knip and the icon map stay clean.

- [ ] **Step 6: Rewrite the header render module**

Replace the whole of `packages/core/src/components/legend/legend-header.ts` (Task 3.2's `LegendHeaderView`, `LegendHeaderActions`, `renderLegendHeader` and `legendReverseLabel` all go) with:

```ts
import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import '../kit/button';
import '../kit/menu';
import '../kit/tooltip';
import { icon, type IconName } from '../kit/icon';
import type { LegendSortMode } from './types';

/** What the legend header shows (design decision 12). */
export interface LegendHeaderModel {
  /** The annotation's display name, never its key. */
  title: string;
  predicted: boolean;
  /** The annotation's info popover, when it has docs. */
  info?: TemplateResult;
  sortMode: LegendSortMode;
  isNumeric: boolean;
  hasScores: boolean;
  /** More than one row. With one there is nothing to order, and the sort button hides. */
  canSort: boolean;
}

export interface LegendHeaderHandlers {
  onSortMenu(anchor: HTMLElement): void;
  onSettings(anchor: HTMLElement): void;
  onTitlePointerEnter(e: PointerEvent): void;
}

export interface SortMenuModel {
  open: boolean;
  anchor: HTMLElement | null;
  sortMode: LegendSortMode;
  isNumeric: boolean;
  hasScores: boolean;
}

const SORT_LABELS: Record<LegendSortMode, string> = {
  'size-desc': 'By count, largest first',
  'size-asc': 'By count, smallest first',
  'alpha-asc': 'By name, A to Z',
  'alpha-desc': 'By name, Z to A',
  manual: 'Your order',
  'manual-reverse': 'Your order, reversed',
  'silhouette-desc': 'By separation, best first',
  'silhouette-asc': 'By separation, worst first',
};

const SORT_ICONS: Record<LegendSortMode, IconName> = {
  'size-desc': 'arrow-down-wide-narrow',
  'size-asc': 'arrow-down-narrow-wide',
  'alpha-asc': 'arrow-down-a-z',
  'alpha-desc': 'arrow-down-z-a',
  manual: 'arrow-up-down',
  'manual-reverse': 'arrow-up-down',
  'silhouette-desc': 'arrow-down-wide-narrow',
  'silhouette-asc': 'arrow-down-narrow-wide',
};

const PREDICTED_NOTE = 'Predicted: computational, not experimentally curated';

/** The active order in words: the sort button's name and tooltip ("Sort: By count, largest first"). */
export function sortLabel(mode: LegendSortMode, isNumeric: boolean): string {
  if (isNumeric && mode === 'alpha-asc') return 'By value, low to high';
  if (isNumeric && mode === 'alpha-desc') return 'By value, high to low';
  return SORT_LABELS[mode];
}

/** The sort button's icon: it shows the active order, largest or best first pointing down-wide. */
export function sortIcon(mode: LegendSortMode, isNumeric: boolean): IconName {
  if (isNumeric && mode === 'alpha-asc') return 'arrow-down-0-1';
  if (isNumeric && mode === 'alpha-desc') return 'arrow-down-1-0';
  return SORT_ICONS[mode];
}

/** The radio a mode checks: the mode with its direction dropped. */
function sortBase(mode: LegendSortMode): LegendSortMode {
  if (mode.startsWith('size')) return 'size-desc';
  if (mode.startsWith('alpha')) return 'alpha-asc';
  if (mode.startsWith('silhouette')) return 'silhouette-desc';
  return 'manual';
}

/** "Reverse order" is checked when the mode runs against its base's direction. */
function isReversed(mode: LegendSortMode): boolean {
  return (
    mode === 'size-asc' ||
    mode === 'alpha-desc' ||
    mode === 'manual-reverse' ||
    mode === 'silhouette-asc'
  );
}

/**
 * The 44 px legend header: title, predicted mark, info, then sort and settings. The title is
 * one line ending in an ellipsis; the legend's shared name tooltip shows it in full.
 */
export function renderLegendHeader(
  model: LegendHeaderModel,
  handlers: LegendHeaderHandlers,
): TemplateResult {
  const sortName = `Sort: ${sortLabel(model.sortMode, model.isNumeric)}`;
  // aria-haspopup and aria-expanded are static: the sort menu exists only while open, and
  // ps-menu records these closed-state values when it mounts and restores them when it goes.
  return html`<div class="legend-header" part="header">
    <h3 class="legend-title" @pointerenter=${handlers.onTitlePointerEnter}>${model.title}</h3>
    ${model.predicted
      ? html`<span class="legend-predicted" role="img" aria-label="Predicted annotation"
            >${icon('sparkles', 14)}</span
          ><ps-tooltip text=${PREDICTED_NOTE}></ps-tooltip>`
      : nothing}
    ${model.info ?? nothing}
    <span class="legend-header-spacer"></span>
    <ps-icon-button
      class="sort-button"
      icon=${sortIcon(model.sortMode, model.isNumeric)}
      label=${sortName}
      size="sm"
      aria-haspopup="menu"
      aria-expanded="false"
      ?hidden=${!model.canSort}
      @click=${(e: Event) => handlers.onSortMenu(e.currentTarget as HTMLElement)}
    ></ps-icon-button>
    <ps-icon-button
      class="settings-button"
      icon="sliders-horizontal"
      label="Legend settings"
      size="sm"
      @click=${(e: Event) => handlers.onSettings(e.currentTarget as HTMLElement)}
    ></ps-icon-button>
  </div>`;
}

/**
 * The sort menu, rendered only while open. A radio pick applies its order; "Reverse order" is a
 * checkbox, so the menu stays open and shows the new direction.
 */
export function renderSortMenu(
  model: SortMenuModel,
  handlers: { onPick(mode: LegendSortMode): void; onReverse(): void; onClose(): void },
): TemplateResult {
  if (!model.open || !model.anchor) return html``;
  const base = sortBase(model.sortMode);
  const showSeparation = !model.isNumeric && (model.hasScores || base === 'silhouette-desc');
  const radio = (value: LegendSortMode, label: string) =>
    html`<ps-menu-item type="radio" value=${value} .checked=${live(base === value)}
      >${label}</ps-menu-item
    >`;
  const onSelect = (e: Event) => {
    const { value } = (e as CustomEvent<{ value: string }>).detail;
    if (value === 'reverse') handlers.onReverse();
    // A re-pick of the checked radio keeps the order, direction included (phase 2 ruling M1).
    else if (value !== base) handlers.onPick(value as LegendSortMode);
  };
  return html`<ps-menu
    class="sort-menu"
    label="Sort legend"
    placement="bottom-end"
    .anchor=${model.anchor}
    .open=${true}
    @ps-select=${onSelect}
    @ps-close=${handlers.onClose}
  >
    <ps-menu-group label="Sort by">
      ${model.isNumeric ? nothing : radio('size-desc', 'By count')}
      ${radio('alpha-asc', model.isNumeric ? 'By value' : 'By name')}
      ${showSeparation ? radio('silhouette-desc', 'By separation') : nothing}
      ${radio('manual', 'Your order')}
    </ps-menu-group>
    <ps-menu-item type="checkbox" value="reverse" .checked=${live(isReversed(model.sortMode))}
      >Reverse order</ps-menu-item
    >
  </ps-menu>`;
}
```

`live()` compares against each item's own `checked`, which `ps-menu` flips on a pick, so the menu always shows the legend's mode, not a stale one.

- [ ] **Step 7: Write the header styles and drop the old header rules**

Create `packages/core/src/components/legend/styles/header.ts`:

```ts
import { css } from 'lit';

/**
 * The legend header (design decision 12): a 44 px bar holding the title, the predicted mark, the
 * info button, a spacer and two 28 px icon buttons. The title gives way first: it ends in an
 * ellipsis while the buttons keep their size.
 */
export const headerStyles = css`
  .legend-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--ps-space-0-5);
    box-sizing: border-box;
    width: 100%;
    height: 44px;
    padding: 0 var(--ps-space-1-5) 0 var(--ps-space-3);
  }

  .legend-title {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text);
  }

  .legend-predicted {
    display: inline-flex;
    flex: none;
    margin-inline-start: var(--ps-space-1);
    color: var(--ps-text-muted);
  }

  .legend-header protspace-info-popover {
    flex: none;
    margin-inline-start: var(--ps-space-1);
  }

  .legend-header-spacer {
    flex: 1 1 0;
    min-width: 0;
  }

  .legend-header ps-icon-button {
    flex: none;
  }

  .sort-button[hidden] {
    display: none;
  }
`;
```

In `packages/core/src/components/legend/styles/layout.ts`, inside `layoutStyles`, delete these rules whole (at `7d45ab02` lines 64–116, between `${srOnlyMixin}` and `.eat-legend`): `.legend-header`, `.legend-header-actions`, `.legend-title-row`, `.legend-title`, `.legend-predicted-badge` and `.legend-predicted-note`. Leave everything else in the file as it is (the module stays LEGACY until 3.15).

In `packages/core/src/components/legend/legend.styles.ts`, add the import `import { headerStyles } from './styles/header';` beside the `./styles/layout` import, and put `headerStyles,` in the `legendStyles` array directly after `layoutStyles,`.

- [ ] **Step 8: Wire the header and the sort menu into the legend**

All edits in `packages/core/src/components/legend/legend.ts`.

1. Imports. Replace the `./legend-header` import (Task 3.2's `renderLegendHeader` and `legendReverseLabel`) with:

```ts
import {
  renderLegendHeader,
  renderSortMenu,
  type LegendHeaderHandlers,
  type LegendHeaderModel,
  type SortMenuModel,
} from './legend-header';
```

and make sure the `./legend-items-state` import (Task 3.5) includes `normalizeSortModeForType` and `reorderByValues`; add either name if it is missing.

2. State. Next to the other `@state()` fields (after `@state() private _annotationSortModes`), add:

```ts
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() private _sortMenu: HTMLElement | null = null;
```

3. Handlers. After the `_dragController` field (which closes with `onDropComplete: … });`), add:

```ts
  private _headerHandlers: LegendHeaderHandlers = {
    onSortMenu: (anchor) => {
      this._sortMenu = this._sortMenu ? null : anchor;
    },
    // 3.12 anchors the settings popover on the button; until then it opens the dialog.
    onSettings: () => void this._handleCustomize(),
    onTitlePointerEnter: (e) => {
      const title = e.currentTarget as HTMLElement;
      this._nameTooltip.hover(title, title);
    },
  };

  private _sortMenuHandlers: Parameters<typeof renderSortMenu>[1] = {
    onPick: (mode) => this._applySortMode(mode),
    onReverse: () => this._toggleLegendOrderDirection(),
    onClose: () => {
      this._sortMenu = null;
    },
  };
```

(`_nameTooltip` is the legend's `TruncatedNameTooltip` from Task 3.7.)

4. `_applySortMode`. Directly above `private _toggleLegendOrderDirection(): void {`, add:

```ts
  /**
   * Applies a sort-menu pick at once and stores it, as the settings dialog's Save applied an
   * order. "Your order" starts from the order on screen, whatever sorted it.
   */
  private _applySortMode(mode: LegendSortMode): void {
    const isNumeric = this._isCurrentAnnotationNumeric();
    const next = normalizeSortModeForType(mode, isNumeric);
    this._keyboard.clear();
    if (next === 'manual' && !this._currentSortMode.startsWith('manual')) {
      const shown = this._sortedLegendItems
        .map((item) => item.value)
        .filter((value) => value !== LEGEND_VALUES.OTHER);
      if (isNumeric) {
        this._setNumericManualOrderIds(
          this.selectedAnnotation,
          shown.filter((value) => value !== NA_VALUE),
        );
      } else {
        this._legendItems = reorderByValues(this._legendItems, shown);
      }
    }
    this._annotationSortModes = {
      ...this._annotationSortModes,
      [this.selectedAnnotation]: next,
    };
    this._updateLegendItems();
    this._scatterplotController.syncNumericAnnotationSettings();
    this._scatterplotController.dispatchZOrderChange();
    this._persistenceController.saveSettings();
    this._dispatchLegendStateChange();
  }
```

5. `willUpdate`. At the top of `protected willUpdate(changedProperties: Map<string, unknown>): void {` (Task 3.2 keeps the strip-points derivation there; leave it), add:

```ts
    // One row has nothing to order: the sort button hides, so its menu closes too.
    if (this._sortMenu && this._legendItems.length <= 1) this._sortMenu = null;
```

6. `render()`. Replace the whole `renderLegendHeader(…)` call (Task 3.2's form passes `{ title, predicted, info, reverseLabel: legendReverseLabel(…) }` and `{ onReverse, onCustomize }`) with:

```ts
        ${renderLegendHeader(this._headerModel(title, predicted, info), this._headerHandlers)}
```

where `info` is the `protspace-info-popover` template `render()` already builds (at `7d45ab02` it is inline: `meta && hasDocs ? html\`<protspace-info-popover …>\` : undefined`; hoist it into `const info = …` above the `return html` if Task 3.2 left it inline). Delete the `predictedNote` text ('Computationally predicted, not experimentally curated.') wherever Task 3.2 left it. Then, in the same `render()`, inside `.legend-container` and after the colour picker and the row menu (and before Task 3.10's Other popover, which comes last), add:

```ts
        ${this._renderSortMenu()}
```

and add these two methods directly after `render()`:

```ts
  private _headerModel(
    title: string,
    predicted: boolean,
    info: TemplateResult | undefined,
  ): LegendHeaderModel {
    return {
      title,
      predicted,
      info,
      sortMode: this._currentSortMode,
      isNumeric: this._isNumericAnnotation(),
      hasScores: this._categoryScores.length > 0,
      canSort: this._legendItems.length > 1,
    };
  }

  private _renderSortMenu() {
    const model: SortMenuModel = {
      open: this._sortMenu !== null,
      anchor: this._sortMenu,
      sortMode: this._currentSortMode,
      isNumeric: this._isNumericAnnotation(),
      hasScores: this._categoryScores.length > 0,
    };
    return renderSortMenu(model, this._sortMenuHandlers);
  }
```

Add `type TemplateResult` to the `lit` import (`import { LitElement, html, type TemplateResult } from 'lit';`) if it is not there.

7. `clearForNewDataset`. In its "Reset UI state" block, add `this._sortMenu = null;` (Task 3.4 moved the picker's reset to the method's first statement, `this._colorPicker.close();`).

8. Check: `grep -n "legendReverseLabel\|reverseLabel\|predictedNote\|predicted-note\|⚡" packages/core/src/components/legend/*.ts` prints nothing (tests aside).

- [ ] **Step 9: Point the existing tests at the new header**

1. `legend.dom-contract.test.ts`: replace Task 3.1's case "adds the predicted-note part for a predicted annotation (Task 3.9 removes it)" whole with:

```ts
  it('marks a predicted annotation with the predicted mark, not the predicted-note part', async () => {
    const legend = await mount(
      categoricalData({ yes: 3, no: 1 }, 'predicted_membrane'),
      'predicted_membrane',
    );
    const root = legend.shadowRoot!;
    expect(root.querySelector('[part="predicted-note"]')).toBeNull();
    expect(root.querySelector('.legend-predicted')?.getAttribute('aria-label')).toBe(
      'Predicted annotation',
    );
  });
```

2. `legend.score-sync.test.ts`, in the test that sorts by separation (at `7d45ab02` :218–236): replace

```ts
    const internals = el as unknown as {
      _dialogSettings: { annotationSortModes: Record<string, string> } & Record<string, unknown>;
      _handleSettingsSave: () => void;
    };
    internals._dialogSettings = {
      ...internals._dialogSettings,
      annotationSortModes: { major_group: 'silhouette-desc' },
    };
    internals._handleSettingsSave();
    // Same two-cycle wait as the click-toggle test above: _handleSettingsSave sets
    // _legendItems; _sortedLegendItems only re-derives from it in the next updated().
```

with

```ts
    (el as unknown as { _applySortMode(mode: string): void })._applySortMode('silhouette-desc');
    // Same two-cycle wait as the click-toggle test above: _applySortMode sets _legendItems;
    // _sortedLegendItems only re-derives from it in the next updated().
```

Leave the `legend settings dialog: sort by separation` describe block alone (the dialog keeps its order radios until 3.12).

3. `legend.score-strips.test.ts`, in "re-sorts by separation after a projection switch, not just a data resync" (at `7d45ab02` :204–216): replace

```ts
    const internals = legend as unknown as {
      _dialogSettings: { annotationSortModes: Record<string, string> } & Record<string, unknown>;
      _handleSettingsSave: () => void;
    };
    internals._dialogSettings = {
      ...internals._dialogSettings,
      annotationSortModes: { family: 'silhouette-desc' },
    };
    internals._handleSettingsSave();
    // Same two-cycle wait legend.score-sync.test.ts documents: _handleSettingsSave
    // sets _legendItems; _sortedLegendItems only re-derives from it in the next
    // updated().
```

with

```ts
    (legend as unknown as { _applySortMode(mode: string): void })._applySortMode(
      'silhouette-desc',
    );
    // Same two-cycle wait legend.score-sync.test.ts documents: _applySortMode sets
    // _legendItems; _sortedLegendItems only re-derives from it in the next updated().
```

4. `legend.api.test.ts`, case "dispatches legend-customize from the settings button": the settings button's `<button>` now lives in `ps-icon-button`'s shadow root. Replace its line

```ts
    legend.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Legend settings"]')!.click();
```

with

```ts
    const settings = legend.shadowRoot!.querySelector<LitElement>('ps-icon-button.settings-button')!;
    await settings.updateComplete;
    settings.shadowRoot!.querySelector('button')!.click();
```

and import `type LitElement` from `lit`. Change nothing else there; 3.12 rewrites that case.

5. `legend.rows.test.ts` (Task 3.7's case) counts the legend root's `ps-menu` and `ps-tooltip` elements in "renders one ps-menu and one ps-tooltip whatever the row count". The sort menu renders only while open and a non-predicted header adds no `ps-tooltip`, so that test passes unchanged; if it fails, narrow its selectors to `ps-menu.row-menu` and `ps-tooltip[names-target]` rather than changing the header.

- [ ] **Step 10: Run the task's core tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/components/kit/icon.test.ts src/styles`
Expected: PASS, including the seven `legend.header.test.ts` cases, `legend.dom-contract.test.ts`, the score-sync and score-strips separation sorts, and `style-lint.test.ts` (`styles/header.ts` is checked as a clean module; LEGACY unchanged).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.sort-menu.browser.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 11: Add the e2e helpers and the header spec**

In `apps/web/tests/helpers/legend.ts` (Task 3.7), make sure `expect` and `type Locator` are in the `@playwright/test` import, then append:

```ts
type LegendSortChoice = 'By count' | 'By name' | 'By value' | 'By separation' | 'Your order';

/** The header's sort button; its name reads "Sort: {active order}". */
export function legendSortButton(page: Page): Locator {
  return legend(page).getByRole('button', { name: /^Sort: / });
}

/** The active order as the sort button names it, e.g. "By count, largest first". */
export async function legendSortLabel(page: Page): Promise<string> {
  const name = (await legendSortButton(page).getAttribute('aria-label')) ?? '';
  return name.replace(/^Sort: /, '');
}

/** Picks an order from the header's sort menu and waits until the button shows it. */
export async function setLegendSort(page: Page, choice: LegendSortChoice): Promise<void> {
  await legendSortButton(page).click();
  await legend(page).getByRole('menuitemradio', { name: choice, exact: true }).click();
  await expect(legendSortButton(page)).toHaveAccessibleName(new RegExp(`^Sort: ${choice}`));
}

/** Runs "Reverse order" from the sort menu, closes the menu and waits for the order to flip. */
export async function toggleLegendReverse(page: Page): Promise<void> {
  const before = await legendSortLabel(page);
  await legendSortButton(page).click();
  await legend(page).getByRole('menuitemcheckbox', { name: 'Reverse order' }).click();
  // A checkbox item keeps the menu open.
  await page.keyboard.press('Escape');
  await expect(legend(page).getByRole('menu', { name: 'Sort legend' })).toHaveCount(0);
  await expect.poll(() => legendSortLabel(page)).not.toBe(before);
}
```

In `apps/web/tests/workbench-legend.spec.ts` (Task 3.7), add `legendSortButton` and `setLegendSort` to the `./helpers/legend` import (add `selectAnnotation` to the `./helpers/explore` import if it is missing; `openExplore`, `legend` and `legendRowValues` are there from 3.7), then append:

```ts
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

test('the header shows the display name and the active sort; picking By name reorders the list and stores it', async ({
  page,
}) => {
  await openExplore(page);
  // 'order' is a plain Taxonomy annotation with no stored order in the demo bundle.
  await selectAnnotation(page, 'order');
  await expect(legend(page).locator('.legend-title')).toHaveText('Order');
  await expect(legendSortButton(page)).toHaveAccessibleName('Sort: By count, largest first');

  await setLegendSort(page, 'By name');
  const named = (await legendRowValues(page)).filter(
    (value) => value !== 'Other' && value !== '__NA__',
  );
  expect(named.length).toBeGreaterThan(1);
  expect(named).toEqual([...named].sort(byName));
  // Stored at once under the same key. (A reload of the demo would clear it: a default load
  // resets stored settings in dataset-controller.ts. Task 3.13 checks the reload on a user import.)
  const stored = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => /^protspace:legend:[^:]+:order$/.test(key))
      .map((key) => (JSON.parse(localStorage.getItem(key) ?? 'null') as { sortMode?: string })?.sortMode),
  );
  expect(stored).toEqual(['alpha-asc']);
});
```

- [ ] **Step 12: Move numeric-binning's reverse and sort steps to the sort menu**

All edits in `apps/web/tests/numeric-binning.spec.ts`; anchor on the function and test names, since Tasks 3.6–3.8 move lines.

1. Import `legendSortButton`, `legendSortLabel`, `setLegendSort` and `toggleLegendReverse` from `./helpers/legend` (extend an existing `./helpers/legend` import, or add `import { legendSortButton, legendSortLabel, setLegendSort, toggleLegendReverse } from './helpers/legend';` below the `./helpers/explore` import).

2. In `readLegendSettingsDialog`, delete the statement `const reverseButton = root?.querySelector('button.reverse-button') as HTMLButtonElement | null;` and the two returned fields `hasReverseButton: Boolean(reverseButton),` and `reverseButtonLabel: reverseButton?.getAttribute('aria-label') ?? '',`.

3. In `readLegendDisplay`, delete the statement that starts `const reverseButton = legend?.shadowRoot?.querySelector(` (through `'button.reverse-button',\n    ) as HTMLButtonElement | null;`) and the returned field `reverseButtonLabel: reverseButton?.getAttribute('aria-label') ?? '',`. It now returns `{ items }`.

4. Delete the functions `clickLegendReverseButton` and `setSortMode` whole.

5. Test "numeric settings are staged, saved, and restored on re-import": directly before its first `await openLegendSettings(page);` insert `expect(await legendSortLabel(page)).toBe('By value, low to high');`, and delete `expect(initialDialog.hasReverseButton).toBe(true);` and `expect(initialDialog.reverseButtonLabel).toBe('Show high to low');`.

6. Test "categorical annotations do not expose gradient palettes or gradient previews": directly before `await openLegendSettings(page);` insert

```ts
  await expect(legendSortButton(page)).toBeVisible();
  expect(await legendSortLabel(page)).not.toMatch(/^By value/);
```

and delete `expect(dialog.hasReverseButton).toBe(true);` and `expect(dialog.reverseButtonLabel).toBe('Reverse z-order (keep Other last)');`. (The old label was the same for every categorical mode; the new one names the mode, which a bundle may store, so the test pins only that the button is there and categorical.)

7. Test "numeric header toggle reverses rendered bin order without changing color assignments": replace `expect(initialLegend.reverseButtonLabel).toBe('Show high to low');` with `expect(await legendSortLabel(page)).toBe('By value, low to high');`, `await clickLegendReverseButton(page);` with `await toggleLegendReverse(page);`, and `expect(reversedLegend.reverseButtonLabel).toBe('Show low to high');` with `expect(await legendSortLabel(page)).toBe('By value, high to low');`.

8. Test "categorical pointer drag from size-asc keeps Other fixed and promotes to manual": replace `await clickLegendReverseButton(page);` with `await toggleLegendReverse(page);`.

9. Test "categorical pointer drag from alphabetical reverse promotes to manual order": replace the five lines

```ts
  await openLegendSettings(page);
  await setSortMode(page, 'order', 'alpha');
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);
  await clickLegendReverseButton(page);
```

with

```ts
  await setLegendSort(page, 'By name');
  await toggleLegendReverse(page);
```

10. Test "numeric pointer drag promotes value order to manual and reverse does not recolor bins": directly after `const initialLegend = await readLegendDisplay(page);` insert `expect(await legendSortLabel(page)).toBe('By value, low to high');`; delete `expect(initialLegend.reverseButtonLabel).toBe('Show high to low');`; replace `await clickLegendReverseButton(page);` with `await toggleLegendReverse(page);` and `expect(reversedLegend.reverseButtonLabel).toBe('Reverse manual order');` with `expect(await legendSortLabel(page)).toBe('Your order, reversed');`.

11. Test "numeric pointer drag from high-to-low value order promotes to manual": replace `await clickLegendReverseButton(page);` with `await toggleLegendReverse(page);` and `expect(reversedLegend.reverseButtonLabel).toBe('Show low to high');` with `expect(await legendSortLabel(page)).toBe('By value, high to low');`.

12. Test "topology-changing numeric rebins drop stale manual order on reload": replace its second

```ts
  await openLegendSettings(page);
  await setSortMode(page, 'length', 'alpha');
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);
```

with `await setLegendSort(page, 'By value');`.

13. Test "categorical manual reorder and reverse continue to work": replace `await clickLegendReverseButton(page);` with `await toggleLegendReverse(page);`.

14. Check: `grep -n "reverse-button\|reverseButtonLabel\|hasReverseButton\|clickLegendReverseButton\|setSortMode" apps/web/tests/numeric-binning.spec.ts` prints nothing. The dialog helpers (`openLegendSettings`, `clickDialogButton`, `waitForDialogClosed`, `selectedSortingLabel`) stay: the dialog keeps its order radios until 3.12.

- [ ] **Step 13: Run the e2e specs**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=workbench --project=numeric-binning --project=legend-double-click --project=product-tour`
Expected: PASS, including the new "the header shows the display name and the active sort…" and every reverse test of `numeric-binning`. The `workbench-sidebar.spec.ts` cases that click `getByRole('button', { name: 'Legend settings' })` pass unchanged (the kit button's inner `<button>` carries that name).

- [ ] **Step 14: Document the parts and update the tour's legend step**

In `docs/developers/api/index.md`, in the `## Legend` section, insert after the `### HTML attributes` paragraph (`` `scatterplot-selector`, `auto-sync`, `auto-hide`. ``):

```md
### CSS parts

`container`, `header`, `items`, `item`, `symbol`, `text`, `count` and `empty`. The
`predicted-note` part is gone: a predicted annotation shows a sparkles icon in the header, with
its note in the icon's tooltip.
```

If an earlier phase 3 task already added a `### CSS parts` subsection, edit its list and add the `predicted-note` sentence there instead of adding a second one.

In `apps/web/src/tour/product-tour.ts`, step 8 (`// ── Step 8 – Legend`, title 'Legend Panel'): its copy describes the swatch click (gone in Task 3.6), the reverse icon and the gear (gone in this task). Replace its `description` string whole with:

```ts
      description:
        '<strong>Click</strong> a row to hide or show it, <strong>double-click</strong> to isolate it. Hover a row for its eye, its drag handle (higher rows are drawn on top) and <strong>⋯</strong> (<em>Show only this</em>, <em>Colour and shape</em>). Drag a category onto <strong>Other</strong> to merge it. The sort button in the header shows the order; the sliders button opens the legend settings.',
```

The title, the target and the buttons stay (`product-tour.spec.ts` keys on titles and `data-driver-id`); Task 7.4 rewrites the tour.

- [ ] **Step 15: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS; the phase 3 baseline plus the new cases (7 in `legend.header.test.ts`, which replaces 3.1's header cases, and 8 in `legend.sort-menu.browser.test.ts`).

Run: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, count unchanged.

Run: `pnpm type-check && pnpm knip`
Expected: clean. (`LegendHeaderModel`, `LegendHeaderHandlers` and `SortMenuModel` are typed in `legend.ts`; `sortLabel` and `sortIcon` are imported by the header test; the four e2e helpers are used by `workbench-legend.spec.ts` and `numeric-binning.spec.ts`; the nine icons are reached by `legend-header.ts`.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS (known flakes: re-run once alone before investigating).

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS with `apps/web/tests/perf/budgets.json` unchanged (no scenario touches the header; `legendUpdate` and `legendRebuild` keep their counts).

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-header.ts`
Expected: record `legend.ts` (this task adds about 90 lines: the sort menu wiring and `_applySortMode`); `legend-header.ts` far under 800.

- [ ] **Step 16: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/kit/icon.ts packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/header.ts packages/core/src/components/legend/styles/layout.ts packages/core/src/components/legend/legend.header.test.ts packages/core/src/components/legend/legend.sort-menu.browser.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.score-sync.test.ts packages/core/src/components/legend/legend.score-strips.test.ts packages/core/src/components/legend/legend.api.test.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/numeric-binning.spec.ts docs/developers/api/index.md apps/web/src/tour/product-tour.ts
git add packages/core/src/components/kit/icon.ts packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/header.ts packages/core/src/components/legend/styles/layout.ts packages/core/src/components/legend/legend.header.test.ts packages/core/src/components/legend/legend.sort-menu.browser.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.score-sync.test.ts packages/core/src/components/legend/legend.score-strips.test.ts packages/core/src/components/legend/legend.api.test.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/numeric-binning.spec.ts docs/developers/api/index.md apps/web/src/tour/product-tour.ts
git commit -m "feat(core): rebuild the legend header with a sort menu and kit buttons"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.10: "Other" popover with search and "Add to legend"

The Other row's "View" opens a searchable popover anchored to it, listing the categories grouped under Other with their counts and an "Add to legend" button each, plus "Add all" (decision 12). It replaces the extract dialog, its overlay, its focus trap and its press flags. The popover stays open while categories are added and closes when Other empties. The tour's step 9 copy and the developer docs follow.

**Files:**

- Create: `packages/core/src/components/legend/legend-other-popover.ts`, `legend-other-popover.styles.ts`, `legend-other-popover.browser.test.ts`, `legend.other.browser.test.ts`
- Modify: `legend.ts`, `legend-row.ts` (the View button's `aria-haspopup="dialog"` and `aria-expanded`), `styles/modal.ts` (the Other dialog's rules leave; the module stays LEGACY until 3.12), `legend-settings-dialog.ts` and `packages/core/src/components/control-bar/query-builder.ts` (close icons from `icon('x', 20)`)
- Delete: `legend-other-dialog.ts`, `legend-other-dialog.test.ts`
- Modify tests: `legend-extract.test.ts` (the mounted cases :241–292 move to `legend.other.browser.test.ts`; the extract logic cases stay), `legend.dom-contract.test.ts`, `legend.escape-order.browser.test.ts` (the Other case)
- Modify: `apps/web/src/tour/product-tour.ts` (step 9 copy: "…grouped into Other. Click View to list them and add any back to the legend."), `apps/web/tests/helpers/legend.ts`, `apps/web/tests/workbench-legend.spec.ts`
- Modify: `docs/developers/architecture.md` (component-owned workflow UI line), `docs/developers/messaging.md` (:33)

All paths below without a folder are in `packages/core/src/components/legend/`. `legend.styles.ts` needs no edit: the popover is its own element with its own stylesheet, and its host is `display: contents`; leave the file as it is.

**Interfaces:**

- Consumes:
  - 3.6: `formatCount(n)`, `countNoun(n, one, other)` (`packages/core/src/utils/count-text.ts`); `LegendRowView`, `LegendRowHandlers.onViewOther(e: Event)` and `renderLegendRow` (`legend-row.ts`). 3.7: `legend(page)`, `legendRow(page, value)`, `legendRowValues(page)` (`apps/web/tests/helpers/legend.ts`).
  - 3.4: `this._keyboard.focusItem(index: number)` (focuses a row's `.legend-item-main` by display index).
  - 3.1: `categoricalData`, `TWELVE` (`test-support/legend-fixtures.ts`), `mountLegendWithScatterplot`.
  - Existing: `OtherItem`, `toDisplayValue`, `NA_VALUE`, `LEGEND_VALUES`, `LEGEND_EVENTS`; `ps-popover`, `ps-input`, `ps-button`; `kitHost`, `focusRing`, `reducedMotion` (`kit/kit-shared.styles.ts`); `deepActiveElement` (`kit/focus.ts`); `_handleExtractFromOther`, `_handleExtractAllFromOther`, `_otherItems`.
- Produces:
  - `legend-other-popover.ts`: `OTHER_POPOVER_ROW_LIMIT = 200`; `@customElement('protspace-legend-other-popover') class ProtspaceLegendOtherPopover` with properties `anchor: Element | null`, `open: boolean`, `items: readonly OtherItem[]`; method `focusSearch(): void`. Renders `<ps-popover .anchor .open placement="bottom-end" panel-role="dialog" panel-label="Other categories">` > heading "Other · {countNoun(n,'category','categories')}", `ps-input type="search" label="Search Other categories" placeholder="Search"`, `ul[role=list].other-list` of `li.other-item` > `span.other-item-name` (ellipsis), `span.other-item-count` (`formatCount`, tabular), `button.other-add` "Add to legend" (`aria-label="Add to legend: {name}"`); then "Showing 200 of {n}. Refine the search." past the cap, "No categories match “{query}”." when empty (both in one `p.other-status[role=status]`); footer `ps-button.other-add-all size="sm" variant="secondary"` "Add all ({n})". Rows sort by count descending, then display name (`localeCompare`); the query filters a lower-cased display name by substring, memoised on `(items, query)`. The body renders only while `open`. Events on the host, not bubbling: `other-add` (`CustomEvent<{ value: string }>`, the raw value, `__NA__` included) and `other-add-all` (`Event`); `ps-close` arrives from the inner popover (bubbling, composed), and the element sets its own `open` to false first. On `ps-open` it clears the query and focuses the search field; after an add it focuses the next row's button, or the search field when none is left. When the popover closes on Escape and focus had nowhere to return (the row re-render replaced the View button it opened from), it focuses the current `anchor`.
  - `legend-row.ts`: `LegendRowView` gains `otherExpanded?: boolean` (the Other popover is open); the Other row's `button.view-button` gets `aria-haspopup="dialog"` and `aria-expanded="true|false"` from it.
  - `legend.ts`: `@state() _otherAnchor: HTMLElement | null` (open while set); the View button toggles it; `other-add` → `_handleExtractFromOther(value)` keeping the popover open; `other-add-all` → `_handleExtractAllFromOther()` then close; when `_otherItems` becomes empty it closes and focuses the first row's main button; `ps-close` clears it; after a re-render replaces the View button, the anchor follows the new one. `_showOtherDialog`, `_closeOtherDialog`, `_handleOtherOverlayMouseDown/Up`, `_mouseDownOutsideOther`, `_renderOtherDialog`, the Other focus-trap branch and the Other branch of the window Escape handler go. Announcements stay ("Extracted {label} from Other category"); events stay `legend-item-click` `'extract'`.
  - Helpers: `legendOtherDialog(page): Locator` (the popover's panel, role `dialog` named "Other categories", for visibility and boxes); `openLegendOther(page): Promise<Locator>` (clicks "View items grouped under Other", waits for the panel, and returns the `protspace-legend-other-popover` element, the scope for its controls: the panel's content is slotted, and Playwright's scoped locators do not follow slots); `addFromOther(page, name: string): Promise<void>`.

**Tests:**

- `legend-other-popover.browser.test.ts`: "lists items by count, largest first, then by name"; "search filters case-insensitively on display names, N/A included"; "Add to legend fires other-add with the raw value, __NA__ for N/A"; "Add all fires once"; "with 5,000 items it renders 200 rows and 'Showing 200 of 5,000'" (Review Focus 1); "the filter runs once per query, not per render"; "Escape and an outside press close it and return focus to View"; "the panel is a dialog named Other categories and the search field has focus on open"; "each Add button's name includes its category"; plus "after an add, focus moves to the next row's button, then to the search field".
- `legend.other.browser.test.ts` (mounted legend): "View opens the popover and sets aria-expanded"; "adding a category shows its row, keeps the popover open and focuses the next Add button"; "adding the last category removes Other, closes the popover and focuses the first row" (Review Focus 1); "Add all closes it"; "the popover is topmost over a docked-structure stand-in"; plus "after an add, Escape closes it and focuses the View button".
- `legend-extract.test.ts` logic cases pass; `legend-other-dialog.test.ts` is deleted with its module.
- `workbench-legend.spec.ts`: "View opens Other; a search and Add to legend bring a category back".
- `product-tour` e2e passes (step 9 still targets `other-row`).

Before you start, record `wc -l packages/core/src/components/legend/legend.ts` and the legend unit test count for the report.

- [ ] **Step 1: Write the failing element tests**

Create `packages/core/src/components/legend/legend-other-popover.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsPopover } from '../kit/popover';
import { NA_VALUE } from './config';
import { OTHER_POPOVER_ROW_LIMIT, type ProtspaceLegendOtherPopover } from './legend-other-popover';
import type { OtherItem } from './types';
import './legend-other-popover';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle(el: ProtspaceLegendOtherPopover): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}

const innerPopover = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector<PsPopover>('ps-popover')!;
const panel = (el: ProtspaceLegendOtherPopover) =>
  innerPopover(el).shadowRoot!.querySelector<HTMLElement>('.panel')!;
const searchInput = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector('ps-input')!.shadowRoot!.querySelector('input')!;
const rowNames = (el: ProtspaceLegendOtherPopover) =>
  [...el.shadowRoot!.querySelectorAll('.other-item-name')].map((n) => n.textContent!.trim());
const rowCounts = (el: ProtspaceLegendOtherPopover) =>
  [...el.shadowRoot!.querySelectorAll('.other-item-count')].map((n) => n.textContent!.trim());
const addButtons = (el: ProtspaceLegendOtherPopover) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button.other-add'),
];
const addButton = (el: ProtspaceLegendOtherPopover, name: string) =>
  addButtons(el).find((b) => b.getAttribute('aria-label') === `Add to legend: ${name}`)!;
const status = (el: ProtspaceLegendOtherPopover) =>
  el.shadowRoot!.querySelector('.other-status')!.textContent!.trim();

function escape(): void {
  (deepActiveElement() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
  );
}
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function mount(items: readonly OtherItem[]) {
  document.body.innerHTML = `<button id="view">View</button><button id="outside">Outside</button>`;
  const anchor = document.getElementById('view')!;
  const el = document.createElement('protspace-legend-other-popover');
  el.items = items;
  el.anchor = anchor;
  document.body.append(el);
  await el.updateComplete;
  return { el, anchor };
}

async function open(el: ProtspaceLegendOtherPopover, anchor: HTMLElement): Promise<void> {
  anchor.focus();
  el.open = true;
  await settle(el);
}

async function search(el: ProtspaceLegendOtherPopover, text: string): Promise<void> {
  const input = searchInput(el);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(el);
}

const MIXED: OtherItem[] = [
  { value: 'beta', count: 2 },
  { value: 'alpha', count: 2 },
  { value: 'gamma', count: 1234 },
  { value: NA_VALUE, count: 1 },
];

describe('protspace-legend-other-popover', () => {
  it('lists items by count, largest first, then by name', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    expect(rowNames(el)).toEqual(['gamma', 'alpha', 'beta', 'N/A']);
    expect(rowCounts(el)).toEqual(['1,234', '2', '2', '1']);
    expect(el.shadowRoot!.querySelector('.other-heading')!.textContent!.trim()).toBe(
      'Other · 4 categories',
    );
    expect(el.shadowRoot!.querySelector('.other-list')!.getAttribute('role')).toBe('list');
    expect(el.shadowRoot!.querySelector('ps-button.other-add-all')!.textContent!.trim()).toBe(
      'Add all (4)',
    );
  });

  it('search filters case-insensitively on display names, N/A included', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    await search(el, 'n/a');
    expect(rowNames(el)).toEqual(['N/A']);
    await search(el, 'ALP');
    expect(rowNames(el)).toEqual(['alpha']);
    await search(el, 'zzz');
    expect(rowNames(el)).toEqual([]);
    expect(status(el)).toBe('No categories match “zzz”.');
    await search(el, '');
    expect(rowNames(el)).toHaveLength(4);
    expect(status(el)).toBe('');
  });

  it('Add to legend fires other-add with the raw value, __NA__ for N/A', async () => {
    const { el, anchor } = await mount(MIXED);
    const added: CustomEvent<{ value: string }>[] = [];
    el.addEventListener('other-add', (e) => added.push(e as CustomEvent<{ value: string }>));
    await open(el, anchor);
    addButton(el, 'N/A').click();
    addButton(el, 'gamma').click();
    expect(added.map((e) => e.detail.value)).toEqual([NA_VALUE, 'gamma']);
    expect(added[0].bubbles).toBe(false);
  });

  it('Add all fires once', async () => {
    const { el, anchor } = await mount(MIXED);
    const onAddAll = vi.fn();
    el.addEventListener('other-add-all', onAddAll);
    await open(el, anchor);
    (el.shadowRoot!.querySelector('ps-button.other-add-all') as HTMLElement).click();
    expect(onAddAll).toHaveBeenCalledOnce();
  });

  it("with 5,000 items it renders 200 rows and 'Showing 200 of 5,000'", async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ value: `family ${i}`, count: 5000 - i }));
    const { el, anchor } = await mount(many);
    await open(el, anchor);
    expect(OTHER_POPOVER_ROW_LIMIT).toBe(200);
    expect(el.shadowRoot!.querySelectorAll('.other-item')).toHaveLength(200);
    expect(status(el)).toBe('Showing 200 of 5,000. Refine the search.');
    expect(el.shadowRoot!.querySelector('.other-heading')!.textContent!.trim()).toBe(
      'Other · 5,000 categories',
    );
    await search(el, 'family 4999');
    expect(rowNames(el)).toEqual(['family 4999']);
    expect(status(el)).toBe('');
  });

  it('the filter runs once per query, not per render', async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    const matches = () => (el as unknown as { _matches: readonly unknown[] })._matches;
    const all = matches();
    el.requestUpdate();
    await el.updateComplete;
    expect(matches()).toBe(all);

    await search(el, 'a');
    const filtered = matches();
    expect(filtered).not.toBe(all);
    el.requestUpdate();
    await el.updateComplete;
    expect(matches()).toBe(filtered);
  });

  it('Escape and an outside press close it and return focus to View', async () => {
    const { el, anchor } = await mount(MIXED);
    const onClose = vi.fn();
    el.addEventListener('ps-close', onClose);
    await open(el, anchor);

    escape();
    await settle(el);
    expect(onClose).toHaveBeenCalledOnce();
    expect(el.open).toBe(false);
    expect(panel(el).matches(':popover-open')).toBe(false);
    expect(document.activeElement).toBe(anchor);

    await open(el, anchor);
    expect(panel(el).matches(':popover-open')).toBe(true);
    press(document.getElementById('outside')!);
    await settle(el);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(el.open).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('the panel is a dialog named Other categories and the search field has focus on open', async () => {
    const { el, anchor } = await mount(MIXED);
    expect(el.shadowRoot!.querySelector('.other-popover')).toBeNull();
    await open(el, anchor);
    expect(panel(el).getAttribute('role')).toBe('dialog');
    expect(panel(el).getAttribute('aria-label')).toBe('Other categories');
    expect(panel(el).matches(':popover-open')).toBe(true);
    const focused = deepActiveElement()!;
    expect(focused).toBe(searchInput(el));
    expect(focused.getAttribute('aria-label')).toBe('Search Other categories');
    expect(focused.getAttribute('placeholder')).toBe('Search');
  });

  it("each Add button's name includes its category", async () => {
    const { el, anchor } = await mount(MIXED);
    await open(el, anchor);
    expect(addButtons(el).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Add to legend: gamma',
      'Add to legend: alpha',
      'Add to legend: beta',
      'Add to legend: N/A',
    ]);
    expect(addButtons(el).every((b) => b.textContent!.trim() === 'Add to legend')).toBe(true);
    expect(el.shadowRoot!.querySelector('[title]')).toBeNull();
  });

  it('after an add, focus moves to the next row’s button, then to the search field', async () => {
    const { el, anchor } = await mount([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
      { value: 'c', count: 1 },
    ]);
    // The owner removes an added category from the list, as the legend does.
    el.addEventListener('other-add', (e) => {
      const { value } = (e as CustomEvent<{ value: string }>).detail;
      el.items = el.items.filter((item) => item.value !== value);
    });
    await open(el, anchor);

    addButton(el, 'b').click();
    await settle(el);
    expect(deepActiveElement()).toBe(addButton(el, 'c'));

    addButton(el, 'c').click();
    await settle(el);
    expect(deepActiveElement()).toBe(addButton(el, 'a'));

    addButton(el, 'a').click();
    await settle(el);
    expect(addButtons(el)).toHaveLength(0);
    expect(deepActiveElement()).toBe(searchInput(el));
  });
});
```

- [ ] **Step 2: Write the failing mounted-legend tests**

Create `packages/core/src/components/legend/legend.other.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsPopover } from '../kit/popover';
import { LEGEND_EVENTS, LEGEND_VALUES } from './config';
import type { ProtspaceLegend } from './legend';
import type { ProtspaceLegendOtherPopover } from './legend-other-popover';
import { categoricalData } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

// Six categories by count: a (6) down to f (1).
const SIX = { a: 6, b: 5, c: 4, d: 3, e: 2, f: 1 } as const;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const root = (legend: ProtspaceLegend) => legend.shadowRoot!;
const otherPopover = (legend: ProtspaceLegend) =>
  root(legend).querySelector<ProtspaceLegendOtherPopover>('protspace-legend-other-popover')!;
const panel = (legend: ProtspaceLegend) =>
  otherPopover(legend)
    .shadowRoot!.querySelector<PsPopover>('ps-popover')!
    .shadowRoot!.querySelector<HTMLElement>('.panel')!;
const viewButton = (legend: ProtspaceLegend) =>
  root(legend).querySelector<HTMLButtonElement>('.legend-item-other .view-button');
const addButton = (legend: ProtspaceLegend, name: string) =>
  [...otherPopover(legend).shadowRoot!.querySelectorAll<HTMLButtonElement>('button.other-add')].find(
    (b) => b.getAttribute('aria-label') === `Add to legend: ${name}`,
  )!;
const rowValues = (legend: ProtspaceLegend) =>
  [...root(legend).querySelectorAll<HTMLElement>('.legend-item')].map((row) => row.dataset.value!);
const firstRowMain = (legend: ProtspaceLegend) =>
  root(legend).querySelector<HTMLElement>('.legend-item .legend-item-main')!;

/** Wait until the legend and the popover stop re-rendering; the legend needs several passes. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    await otherPopover(legend).updateComplete;
    await frame();
  }
}

async function mountWithOther(maxVisible: number): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(SIX), 'family');
  legend.maxVisibleValues = maxVisible;
  await settle(legend);
  return legend;
}

async function openOther(legend: ProtspaceLegend): Promise<void> {
  const view = viewButton(legend)!;
  view.focus();
  view.click();
  await settle(legend);
}

function escape(): void {
  (deepActiveElement() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
  );
}

describe('the legend’s Other popover', () => {
  it('View opens the popover and sets aria-expanded', async () => {
    const legend = await mountWithOther(3);
    expect(rowValues(legend)).toEqual(['a', 'b', 'c', LEGEND_VALUES.OTHER]);
    const view = viewButton(legend)!;
    expect(view.getAttribute('aria-haspopup')).toBe('dialog');
    expect(view.getAttribute('aria-expanded')).toBe('false');

    await openOther(legend);

    expect(otherPopover(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(panel(legend).getAttribute('aria-label')).toBe('Other categories');
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('true');

    viewButton(legend)!.click();
    await settle(legend);
    expect(otherPopover(legend).open).toBe(false);
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('adding a category shows its row, keeps the popover open and focuses the next Add button', async () => {
    const legend = await mountWithOther(3);
    const actions: string[] = [];
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, ((e: CustomEvent) =>
      actions.push(`${e.detail.action}:${e.detail.value}`)) as EventListener);
    await openOther(legend);

    addButton(legend, 'e').click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'e', LEGEND_VALUES.OTHER]);
    expect(actions).toEqual(['extract:e']);
    expect(otherPopover(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(deepActiveElement()?.getAttribute('aria-label')).toBe('Add to legend: f');
    // The row re-render replaced the View button; the popover follows the new one.
    expect(otherPopover(legend).anchor).toBe(viewButton(legend));
    expect(viewButton(legend)!.getAttribute('aria-expanded')).toBe('true');
  });

  it('adding the last category removes Other, closes the popover and focuses the first row', async () => {
    const legend = await mountWithOther(5);
    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', LEGEND_VALUES.OTHER]);
    await openOther(legend);

    addButton(legend, 'f').click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(viewButton(legend)).toBeNull();
    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
    expect(deepActiveElement()).toBe(firstRowMain(legend));
  });

  it('Add all closes it', async () => {
    const legend = await mountWithOther(3);
    const onItemClick = vi.fn();
    legend.addEventListener(LEGEND_EVENTS.ITEM_CLICK, onItemClick);
    await openOther(legend);

    (otherPopover(legend).shadowRoot!.querySelector('ps-button.other-add-all') as HTMLElement).click();
    await settle(legend);

    expect(rowValues(legend)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(onItemClick).toHaveBeenCalledTimes(3);
    expect(otherPopover(legend).open).toBe(false);
    expect(panel(legend).matches(':popover-open')).toBe(false);
    expect(deepActiveElement()).toBe(firstRowMain(legend));
  });

  it('after an add, Escape closes it and focuses the View button', async () => {
    const legend = await mountWithOther(3);
    await openOther(legend);
    addButton(legend, 'd').click();
    await settle(legend);
    expect(otherPopover(legend).open).toBe(true);

    escape();
    await settle(legend);

    expect(otherPopover(legend).open).toBe(false);
    expect(deepActiveElement()).toBe(viewButton(legend));
  });

  it('the popover is topmost over a docked-structure stand-in', async () => {
    const legend = await mountWithOther(3);
    const standIn = document.createElement('div');
    standIn.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: grey';
    document.body.append(standIn);
    await openOther(legend);

    const rect = panel(legend).getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Inside two shadow roots, the hit retargets to the legend host.
    expect(hit).toBe(legend);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend-other-popover.browser.test.ts src/components/legend/legend.other.browser.test.ts`
Expected: FAIL. The element suite fails at import: `Failed to resolve import "./legend-other-popover"`. The mounted suite fails for the same reason (its type import resolves the module too); once the module exists it fails on `protspace-legend-other-popover` not being in the legend's root.

- [ ] **Step 4: Write the popover's styles**

Create `packages/core/src/components/legend/legend-other-popover.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The Other popover's content: a 300 px panel with a search field, a scrolling list and a footer. */
export const otherPopoverStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }

    .other-popover {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-2);
      box-sizing: border-box;
      width: min(300px, calc(100vw - 16px));
      padding: var(--ps-space-3);
    }

    .other-heading {
      margin: 0;
      font-size: var(--ps-text-base);
      font-weight: var(--ps-weight-semibold);
      line-height: var(--ps-leading-tight);
      color: var(--ps-text);
    }

    .other-list {
      display: flex;
      flex-direction: column;
      max-height: min(320px, 50vh);
      margin: 0 calc(-1 * var(--ps-space-3));
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .other-item {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      min-height: var(--ps-row);
      padding: 0 var(--ps-space-3);
    }

    .other-item:hover {
      background: var(--ps-surface-hover);
    }

    .other-item-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .other-item-count {
      flex: none;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
      font-variant-numeric: tabular-nums;
    }

    .other-add {
      flex: none;
      height: 24px;
      padding: 0 var(--ps-space-1-5);
      border: 0;
      border-radius: var(--ps-radius-sm);
      background: transparent;
      color: var(--ps-accent-text);
      font: inherit;
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .other-add:hover {
      background: var(--ps-accent-tint);
    }

    .other-status {
      margin: 0;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
    }

    .other-status:empty {
      display: none;
    }

    .other-footer {
      display: flex;
      justify-content: flex-end;
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }

    @media (pointer: coarse) {
      .other-item {
        min-height: var(--ps-touch-target);
      }
      .other-add {
        height: var(--ps-touch-target);
      }
    }
  `,
];
```

- [ ] **Step 5: Write the popover element**

Create `packages/core/src/components/legend/legend-other-popover.ts`:

```ts
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { countNoun, formatCount } from '../../utils/count-text';
import '../kit/button';
import '../kit/input';
import '../kit/popover';
import type { PsInput } from '../kit/input';
import type { PsPopover } from '../kit/popover';
import { toDisplayValue } from './config';
import { otherPopoverStyles } from './legend-other-popover.styles';
import type { OtherItem } from './types';

/** The most rows the popover renders; a search narrows the rest (Review Focus 1). */
export const OTHER_POPOVER_ROW_LIMIT = 200;

interface OtherRow {
  readonly value: string;
  readonly name: string;
  /** The lower-cased display name the search matches. */
  readonly key: string;
  readonly count: number;
}

const byCountThenName = (a: OtherRow, b: OtherRow) =>
  b.count - a.count || a.name.localeCompare(b.name);

/**
 * The categories grouped under the legend's Other row, searchable, each with "Add to legend"
 * (design decision 12). The owner sets `anchor`, `open` and `items`, and adds what the events
 * name; the popover stays open across adds.
 *
 * @fires other-add - `{ value }`, the raw value of the category to add (`__NA__` for N/A)
 * @fires other-add-all - every category under Other
 * @fires ps-close - from the inner popover, after Escape or an outside press closed it
 */
@customElement('protspace-legend-other-popover')
export class ProtspaceLegendOtherPopover extends LitElement {
  static styles = otherPopoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) items: readonly OtherItem[] = [];

  @state() private _query = '';
  @query('ps-popover') private _popover?: PsPopover;
  @query('ps-input') private _search?: PsInput;

  private _rowsCache: { items: readonly OtherItem[]; rows: readonly OtherRow[] } | null = null;
  private _matchesCache: {
    rows: readonly OtherRow[];
    query: string;
    matches: readonly OtherRow[];
  } | null = null;
  /** Where the row just added sat, so focus lands on the row that takes its place. */
  private _focusIndexAfterAdd: number | null = null;
  /** A blur from inside the panel left focus nowhere, in this task (see `_onFocusOut`). */
  private _focusDropped = false;

  constructor() {
    super();
    this.addEventListener('focusout', this._onFocusOut);
  }

  /** Moves focus to the search field (once it has rendered). */
  focusSearch(): void {
    const search = this._search;
    if (!search) return;
    void search.updateComplete.then(() => search.focus());
  }

  // The panel opens and closes in the inner popover's update: include it, so an owner that awaits
  // this element's updateComplete sees the panel as it now is.
  protected override async getUpdateComplete(): Promise<boolean> {
    const result = await super.getUpdateComplete();
    await this._popover?.updateComplete;
    return result;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('items') && this._focusIndexAfterAdd !== null) {
      const index = this._focusIndexAfterAdd;
      this._focusIndexAfterAdd = null;
      if (this.open) this._focusRowOrSearch(index);
    }
  }

  render() {
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement="bottom-end"
      panel-role="dialog"
      panel-label="Other categories"
      @ps-open=${this._onOpen}
      @ps-close=${this._onClose}
    >
      ${this.open ? this._renderBody() : nothing}
    </ps-popover>`;
  }

  private _renderBody() {
    const total = this.items.length;
    const matches = this._matches;
    const shown =
      matches.length > OTHER_POPOVER_ROW_LIMIT
        ? matches.slice(0, OTHER_POPOVER_ROW_LIMIT)
        : matches;
    const query = this._query.trim();
    const statusText =
      matches.length > OTHER_POPOVER_ROW_LIMIT
        ? `Showing ${formatCount(OTHER_POPOVER_ROW_LIMIT)} of ${formatCount(matches.length)}. Refine the search.`
        : query && matches.length === 0
          ? `No categories match “${query}”.`
          : '';
    return html`<div class="other-popover">
      <h3 class="other-heading">Other · ${countNoun(total, 'category', 'categories')}</h3>
      <ps-input
        class="other-search"
        type="search"
        label="Search Other categories"
        placeholder="Search"
        .value=${this._query}
        @input=${this._onSearch}
      ></ps-input>
      ${shown.length > 0
        ? html`<ul class="other-list" role="list">
            ${shown.map(
              (row) =>
                html`<li class="other-item">
                  <span class="other-item-name">${row.name}</span>
                  <span class="other-item-count">${formatCount(row.count)}</span>
                  <button
                    type="button"
                    class="other-add"
                    data-value=${row.value}
                    aria-label=${`Add to legend: ${row.name}`}
                    @click=${this._onAddClick}
                  >
                    Add to legend
                  </button>
                </li>`,
            )}
          </ul>`
        : nothing}
      <p class="other-status" role="status">${statusText}</p>
      <div class="other-footer">
        <ps-button
          class="other-add-all"
          size="sm"
          variant="secondary"
          ?disabled=${total === 0}
          @click=${this._onAddAll}
          >Add all (${formatCount(total)})</ps-button
        >
      </div>
    </div>`;
  }

  /** Rows sorted by count, largest first, then by name; rebuilt only when `items` changes. */
  private _rows(): readonly OtherRow[] {
    let cache = this._rowsCache;
    if (!cache || cache.items !== this.items) {
      const rows = this.items.map((item) => {
        const name = toDisplayValue(item.value);
        return { value: item.value, name, key: name.toLowerCase(), count: item.count };
      });
      rows.sort(byCountThenName);
      cache = { items: this.items, rows };
      this._rowsCache = cache;
    }
    return cache.rows;
  }

  /** The rows matching the search, memoised on the items and the query: one filter per query. */
  private get _matches(): readonly OtherRow[] {
    const rows = this._rows();
    const query = this._query.trim().toLowerCase();
    const cached = this._matchesCache;
    if (cached && cached.rows === rows && cached.query === query) return cached.matches;
    const matches = query ? rows.filter((row) => row.key.includes(query)) : rows;
    this._matchesCache = { rows, query, matches };
    return matches;
  }

  private _focusRowOrSearch(index: number): void {
    const buttons = this.renderRoot.querySelectorAll<HTMLButtonElement>('button.other-add');
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else this.focusSearch();
  }

  private _onOpen = () => {
    this._query = '';
    this.focusSearch();
  };

  private _onClose = () => {
    this.open = false;
    // ps-popover returns focus to what had it at open. When an add re-rendered the legend's rows,
    // that View button is gone and focus fell to the page: hand it to the current anchor instead.
    if (this._focusDropped && this.anchor instanceof HTMLElement && this.anchor.isConnected) {
      this.anchor.focus();
    }
  };

  // ps-popover blurs, then dispatches ps-close in the same task; an outside press moves focus in
  // an earlier one. So a drop seen within this task means the close itself lost focus.
  private _onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget !== null) return;
    this._focusDropped = true;
    queueMicrotask(() => {
      this._focusDropped = false;
    });
  };

  private _onSearch = (event: Event) => {
    this._query = (event.currentTarget as PsInput).value;
  };

  private _onAddClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const value = button.dataset.value;
    if (value === undefined) return;
    const buttons = [...this.renderRoot.querySelectorAll('button.other-add')];
    this._focusIndexAfterAdd = buttons.indexOf(button);
    this.dispatchEvent(new CustomEvent('other-add', { detail: { value } }));
  };

  private _onAddAll = () => {
    if (this.items.length === 0) return;
    this.dispatchEvent(new Event('other-add-all'));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend-other-popover': ProtspaceLegendOtherPopover;
  }
}
```

- [ ] **Step 6: Run the element tests**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend-other-popover.browser.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 7: Mark the View button**

In `packages/core/src/components/legend/legend-row.ts`:

1. In `interface LegendRowView` (Task 3.6's shape), add after `hasMenu: boolean;`:

```ts
  /** The Other popover is open: the View button's `aria-expanded`. */
  otherExpanded?: boolean;
```

2. In `renderLegendRow`, on the Other row's `button.view-button` (the element with `aria-label="View items grouped under Other"`), add two attributes after `aria-label`:

```ts
          aria-haspopup="dialog"
          aria-expanded=${view.otherExpanded ? 'true' : 'false'}
```

Keep its class, label, text, `tabindex` and `@click` binding as Task 3.6 left them; the popover's own panel is the dialog the attributes announce.

- [ ] **Step 8: Mount the popover in the legend and remove the Other dialog**

All edits in `packages/core/src/components/legend/legend.ts`.

1. Imports. Delete `import { renderOtherDialog } from './legend-other-dialog';` and add, next to the other side-effect imports (`import '../common/info-popover';`):

```ts
import './legend-other-popover';
```

2. State. Replace `@state() private _showOtherDialog = false;` with:

```ts
  /** The Other row's View button while the Other popover is open under it; null when closed. */
  @state() private _otherAnchor: HTMLElement | null = null;
```

and delete the field `private _mouseDownOutsideOther = false;`.

3. The window Escape handler. In `_onWindowKeydownCapture`, delete the whole Other branch:

```ts
      if (this._showOtherDialog) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this._showOtherDialog = false;
        return;
      }
```

(and its comment line, if there is one). In `updated()`, change Task 3.8's `this._listenForEscape(this._showSettingsDialog || this._showOtherDialog);` to `this._listenForEscape(this._showSettingsDialog);` (and drop "Other" from the comment above it).

4. Focus trap. In `updated()`, delete the whole block

```ts
    // Handle other dialog focus trapping
    if (changedProperties.has('_showOtherDialog')) {
      if (this._showOtherDialog) {
        this._setupFocusTrap('legend-other-dialog');
      } else if (!this._showSettingsDialog) {
        this._cleanupFocusTrap();
      }
    }
```

and in the settings block above it change `} else if (!this._showOtherDialog) {` to `} else {`.

5. Follow a replaced View button. At the end of `updated()` (after the Sortable `initialize` call), add:

```ts
    // Rows render by position, so an add re-creates the Other row and its View button. Keep the
    // open popover anchored to the button on screen; with Other gone this closes it.
    if (this._otherAnchor && !this._otherAnchor.isConnected) {
      this._otherAnchor = this.renderRoot.querySelector<HTMLElement>(
        '.legend-item-other .view-button',
      );
    }
```

6. Close when Other empties. In `protected willUpdate(changedProperties: Map<string, unknown>): void {`, add at the top:

```ts
    // The last category left Other: the popover has nothing to list, and its View button goes
    // with the row. Close it and give focus to the list, not the page.
    if (changedProperties.has('_otherItems') && this._otherAnchor && this._otherItems.length === 0) {
      this._otherAnchor = null;
      void this._focusFirstRowWhenSettled();
    }
```

7. Extract handlers. In `_handleExtractFromOther`, delete the line `this._closeOtherDialog();` (the popover stays open; the comment block above it stays). In `_handleExtractAllFromOther`, replace `this._closeOtherDialog();` with `this._otherAnchor = null;`. Delete the method `_closeOtherDialog()` and the methods `_handleOtherOverlayMouseDown(e: MouseEvent)` and `_handleOtherOverlayMouseUp()` whole.

8. New handlers. Directly after `_handleExtractAllFromOther`, add:

```ts
  /** The Other row's View button opens the Other popover under it, and closes it again. */
  private _toggleOther(event: Event): void {
    event.stopPropagation();
    const trigger =
      (event.currentTarget as HTMLElement | null) ??
      this.renderRoot.querySelector<HTMLElement>('.legend-item-other .view-button');
    this._otherAnchor = this._otherAnchor ? null : trigger;
  }

  private _onOtherAdd = (event: Event): void => {
    this._handleExtractFromOther((event as CustomEvent<{ value: string }>).detail.value);
  };

  private _onOtherAddAll = (): void => {
    this._handleExtractAllFromOther();
    void this._focusFirstRowWhenSettled();
  };

  private _onOtherClose = (): void => {
    this._otherAnchor = null;
  };

  /** Focuses the first row once the rows have re-rendered (an add takes several passes). */
  private async _focusFirstRowWhenSettled(): Promise<void> {
    for (let i = 0; i < 10 && !(await this.updateComplete); i++);
    this._keyboard.focusItem(0);
  }
```

9. Rows. In `_renderLegendItem`, change the `onViewOther` handler (at `7d45ab02` `onViewOther: (e: Event) => { e.stopPropagation(); this._showOtherDialog = true; },`) to

```ts
        onViewOther: (e: Event) => this._toggleOther(e),
```

and add to the `LegendRowView` object it passes:

```ts
        otherExpanded: item.value === LEGEND_VALUES.OTHER && this._otherAnchor !== null,
```

10. Render. Delete `_renderOtherDialog()` whole and remove its `${this._renderOtherDialog()}` interpolation from `render()`. As the last child of `.legend-container` (after the sort menu of Task 3.9), add:

```ts
        <protspace-legend-other-popover
          .anchor=${this._otherAnchor}
          .open=${this._otherAnchor !== null}
          .items=${this._otherItems}
          @other-add=${this._onOtherAdd}
          @other-add-all=${this._onOtherAddAll}
          @ps-close=${this._onOtherClose}
        ></protspace-legend-other-popover>
```

11. `clearForNewDataset`: replace `this._showOtherDialog = false;` with `this._otherAnchor = null;`.

12. Check: `grep -rn "_showOtherDialog\|_mouseDownOutsideOther\|_closeOtherDialog\|_handleOtherOverlay\|renderOtherDialog\|_renderOtherDialog\|legend-other-dialog" packages/core/src` prints only the lines Step 10 changes in `legend-extract.test.ts`, `legend-settings-dialog.ts` and `query-builder.ts`, and Step 11's deletions; nothing in `legend.ts`.

- [ ] **Step 9: Move the close icons and the tests off the old dialog**

1. `packages/core/src/components/legend/legend-settings-dialog.ts`: replace `import { renderCloseIcon } from './legend-other-dialog';` with `import { icon } from '../kit/icon';`, and in `renderDialogHeader` replace `${renderCloseIcon()}` with `${icon('x', 20)}`.

2. `packages/core/src/components/control-bar/query-builder.ts`: replace `import { renderCloseIcon } from '../legend/legend-other-dialog';` with `import { icon } from '../kit/icon';`, and in the `.btn-close` button replace `${renderCloseIcon()}` with `${icon('x', 20)}`.

3. `packages/core/src/components/legend/legend-extract.test.ts`:
   - In both `beforeEach` blocks (under `describe('_handleExtractFromOther'` and `describe('_handleExtractAllFromOther'`), replace the two lines `el._showOtherDialog = true;` and `el._mouseDownOutsideOther = true;` with `el._otherAnchor = document.createElement('button');`.
   - In `describe('_handleExtractFromOther'`, add after "increments maxVisibleValues by 1":

```ts
    it('keeps the Other popover open', () => {
      (el as AnyLegend)._handleExtractFromOther('cat1');
      expect(el._otherAnchor).not.toBeNull();
    });
```

   - In `describe('_handleExtractAllFromOther'`, add after "sets maxVisibleValues to nonOtherCount + otherItems.length":

```ts
    it('closes the Other popover', () => {
      (el as AnyLegend)._handleExtractAllFromOther();
      expect(el._otherAnchor).toBeNull();
    });
```

   - Delete the whole `describe('extracting from Other in a mounted legend', …)` block, the `makeExtractData()` function with its comment, and the `settle()` helper with its comment (their cases now live in `legend.other.browser.test.ts`). Then remove the imports nothing uses any more: `afterEach` from `vitest`, `import type { VisualizationData } from '@protspace/utils';`, `import type { ProtspaceLegend } from './legend';` and `import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';`.

4. `packages/core/src/components/legend/legend.dom-contract.test.ts` (Task 3.1): add this case inside its main `describe` (add `mountLegendWithScatterplot`, `categoricalData` and `TWELVE` to its imports if any is missing; jsdom cannot open the popover, so the case checks the closed state only):

```ts
  it('the View button announces the Other popover it opens', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    const root = legend.shadowRoot!;
    const view = root.querySelector('.legend-item-other button.view-button')!;
    expect(view.getAttribute('aria-haspopup')).toBe('dialog');
    expect(view.getAttribute('aria-expanded')).toBe('false');
    const popover = root.querySelector('.legend-container > protspace-legend-other-popover');
    expect(popover).not.toBeNull();
    expect(root.querySelector('.legend-items protspace-legend-other-popover')).toBeNull();
    expect(root.querySelector('[part="dialog-overlay"]')).toBeNull();
  });
```

5. `packages/core/src/components/legend/legend.escape-order.browser.test.ts` (Task 3.8): in the case "the Other dialog and the settings dialog still close on Escape", delete the Other-dialog half (the lines that set or read `_showOtherDialog` or query `#legend-other-dialog`) and rename it "the settings dialog still closes on Escape". Then add this case to the same `describe` (add `vi`, `mountLegendWithScatterplot`, `categoricalData`, `TWELVE` and `deepActiveElement` from `../kit/focus` to its imports if missing):

```ts
  it('the Other popover closes on the first Escape; the next reaches the document', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    const view = legend.shadowRoot!.querySelector<HTMLButtonElement>(
      '.legend-item-other .view-button',
    )!;
    view.focus();
    view.click();
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    const other = legend.shadowRoot!.querySelector('protspace-legend-other-popover')!;
    await other.updateComplete;
    expect(other.open).toBe(true);

    const onDocumentKey = vi.fn();
    document.addEventListener('keydown', onDocumentKey);
    const pressEscape = () =>
      (deepActiveElement() ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    try {
      pressEscape();
      await other.updateComplete;
      expect(other.open).toBe(false);
      expect(onDocumentKey).not.toHaveBeenCalled();
      expect(deepActiveElement()).toBe(view);

      pressEscape();
      expect(onDocumentKey).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('keydown', onDocumentKey);
    }
  });
```

- [ ] **Step 10: Drop the Other dialog's styles and module**

In `packages/core/src/components/legend/styles/modal.ts`, delete these rules whole: `.other-item`, `.other-item:last-child`, `.other-item:hover`, `.other-item-info`, `.other-item-name` and `.other-item-count` (at `7d45ab02` lines 282–312, between `.modal-description` and `.modal-footer`). Keep `.other-items-list*`: the settings dialog uses them until 3.12. The module stays in LEGACY.

Delete the old dialog and its test:

```bash
git rm packages/core/src/components/legend/legend-other-dialog.ts packages/core/src/components/legend/legend-other-dialog.test.ts
```

- [ ] **Step 11: Run the task's core tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/components/control-bar src/styles`
Expected: PASS: the extract logic cases (with the two new ones), `legend.dom-contract.test.ts` with its new case, the query builder suite, `style-lint.test.ts` (`legend-other-popover.styles.ts` is checked as a clean module; LEGACY unchanged) and `styles-integrity.test.ts` (it finds `otherPopoverStyles`).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend`
Expected: PASS, including the 10 element cases, the 6 mounted cases and the escape-order suite.

- [ ] **Step 12: Tour copy, e2e helpers and the spec**

1. `apps/web/src/tour/product-tour.ts`, step 9 (`shadowStep(LEGEND, 'other-row', {`): replace its `description` string with

```ts
      'When there are many annotation values, the least frequent are grouped into <strong>Other</strong>. Click <strong>View</strong> to list them and add any back to the legend.',
```

The title and the `other-row` target stay.

2. `apps/web/tests/helpers/legend.ts`: append (keep `expect` and `type Locator` in the `@playwright/test` import):

```ts
/** The Other popover's panel (role dialog), for visibility and boxes; its content is slotted. */
export const legendOtherDialog = (page: Page): Locator =>
  legend(page).getByRole('dialog', { name: 'Other categories' });

/**
 * Opens the Other popover from the Other row's View button; returns the popover element, the scope
 * for its controls (the panel's content is slotted, so a locator scoped to the panel finds nothing).
 */
export async function openLegendOther(page: Page): Promise<Locator> {
  await legend(page).getByRole('button', { name: 'View items grouped under Other' }).click();
  await expect(legendOtherDialog(page)).toBeVisible();
  return legend(page).locator('protspace-legend-other-popover');
}

/** Adds one category from the open Other popover and waits for its legend row. */
export async function addFromOther(page: Page, name: string): Promise<void> {
  await legend(page).getByRole('button', { name: `Add to legend: ${name}`, exact: true }).click();
  await expect(legendRow(page, name)).toBeVisible();
}
```

3. `apps/web/tests/workbench-legend.spec.ts`: add `addFromOther`, `legendOtherDialog` and `openLegendOther` to the `./helpers/legend` import (`legend` and `legendRowValues` are there from 3.7; add `selectAnnotation` to the `./helpers/explore` import if missing), then append:

```ts
test('View opens Other; a search and Add to legend bring a category back', async ({ page }) => {
  await openExplore(page);
  // 'order' has 18 values, so the default 10 rows leave eight under Other.
  await selectAnnotation(page, 'order');
  await openLegendOther(page);
  await expect(
    legend(page).getByRole('searchbox', { name: 'Search Other categories' }),
  ).toBeFocused();

  const names = await legend(page).locator('.other-item-name').allTextContents();
  expect(names.length).toBeGreaterThan(1);
  const target = names.at(-1)!.trim();
  await legend(page)
    .getByRole('searchbox', { name: 'Search Other categories' })
    .fill(target.slice(0, 4));
  await expect(
    legend(page).getByRole('button', { name: `Add to legend: ${target}`, exact: true }),
  ).toBeVisible();

  await addFromOther(page, target);

  // Still open: an add keeps the popover open on the next row.
  await expect(legendOtherDialog(page)).toBeVisible();
  expect(await legendRowValues(page)).toContain(target);
});
```

- [ ] **Step 13: Run the e2e specs**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=workbench --project=product-tour --project=legend-double-click --project=numeric-binning`
Expected: PASS, including "View opens Other; a search and Add to legend bring a category back" and the tour's step 9 (`other-row`).

- [ ] **Step 14: Update the developer docs**

1. `docs/developers/architecture.md`, the line starting `- Component-owned workflow UI:` — replace it with:

```md
- Component-owned workflow UI: Components keep their own dialogs, popovers and focused workflow controls. The legend settings dialog and the "Other" popover (`protspace-legend-other-popover`: search, "Add to legend", "Add all") stay inside the legend component.
```

   In the Legend Component section's module list (Task 3.5), replace a `legend-other-dialog.ts` entry, if there is one, with ``- `legend-other-popover.ts`: `protspace-legend-other-popover`, the searchable list of the categories under Other`` (add that line to the list when there is no entry to replace).

2. `docs/developers/messaging.md`, under `### Component-owned workflow UI`: replace `- Example: legend "Other" extraction dialog` with `- Example: legend "Other" popover (search and "Add to legend")`.

- [ ] **Step 15: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS; the baseline minus `legend-other-dialog.test.ts` (11 tests) and the two mounted extract cases, plus 10 element, 6 mounted, 2 extract-logic, 1 dom-contract and 1 escape-order case.

Run: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, count unchanged.

Run: `pnpm type-check && pnpm knip`
Expected: clean. (`OTHER_POPOVER_ROW_LIMIT` and `ProtspaceLegendOtherPopover` are imported by the element test; `openLegendOther` and `addFromOther` by `workbench-legend.spec.ts`; `renderCloseIcon` is gone with its module. `pnpm type-check:scripts` stays green: the docs captures read `.extract-button` as strings only, and phase 7 rewrites them.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS (known flakes: re-run once alone before investigating).

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS with `apps/web/tests/perf/budgets.json` unchanged. The closed popover renders no rows (its body renders only while open), so `legendUpdate` and `legendRebuild` keep their counts.

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-other-popover.ts`
Expected: record `legend.ts` (this task removes about as much as it adds); the popover far under 800.

- [ ] **Step 16: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend-other-popover.ts packages/core/src/components/legend/legend-other-popover.styles.ts packages/core/src/components/legend/legend-other-popover.browser.test.ts packages/core/src/components/legend/legend.other.browser.test.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/styles/modal.ts packages/core/src/components/legend/legend-settings-dialog.ts packages/core/src/components/control-bar/query-builder.ts packages/core/src/components/legend/legend-extract.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.escape-order.browser.test.ts apps/web/src/tour/product-tour.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts docs/developers/architecture.md docs/developers/messaging.md
git add packages/core/src/components/legend/legend-other-popover.ts packages/core/src/components/legend/legend-other-popover.styles.ts packages/core/src/components/legend/legend-other-popover.browser.test.ts packages/core/src/components/legend/legend.other.browser.test.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/styles/modal.ts packages/core/src/components/legend/legend-settings-dialog.ts packages/core/src/components/control-bar/query-builder.ts packages/core/src/components/legend/legend-extract.test.ts packages/core/src/components/legend/legend.dom-contract.test.ts packages/core/src/components/legend/legend.escape-order.browser.test.ts apps/web/src/tour/product-tour.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts docs/developers/architecture.md docs/developers/messaging.md
git commit -m "feat(core): replace the legend's Other dialog with a searchable popover"
```

(The `git rm` of Step 10 is already staged. The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.11: Legend settings popover element

A new feature element holds the legend settings as a popover (decision 12): palette swatches instead of a native select, the max-items or bins field, the shape or point size, the duplicate-counts switch, and for numeric annotations the reverse-gradient switch and the bin distribution; Reset at the foot; no Save or Cancel. Each edit is an event the legend applies; number fields are debounced. This task is additive: nothing mounts the element until 3.12.

**Files:**

- Create: `packages/core/src/components/legend/legend-settings-popover.ts`, `legend-settings-popover.styles.ts`, `palette-swatches.ts`, `legend-settings-popover.browser.test.ts`
- Modify: `packages/core/src/components/legend/types.ts` (`LegendDisplaySettings`)
- Modify: `packages/core/src/components/kit/select.ts` (a `describedBy` property, as `ps-button` has), `packages/core/src/components/kit/fields.browser.test.ts` (one case for it). The Bin distribution select must be described by the "Logarithmic … positive values" note, and an id reference cannot reach the native `<select>` inside `ps-select`'s shadow root.

**Interfaces:**

- Consumes: `COLOR_SCHEMES`, `COLOR_SCHEME_INFO`, `GRADIENT_COLOR_SCHEME_IDS`, `createColorSchemeLinearGradient`, `DEFAULT_NUMERIC_STRATEGY`, `NumericBinningStrategy` (`@protspace/utils`); `LEGEND_DEFAULTS.maxSymbolSize` (64), `LEGEND_DEFAULTS.maxVisibleValues` (10), `LEGEND_DEFAULTS.symbolSize` (`./config`); `ps-popover`, `ps-input`, `ps-select` (`SelectOption`), `ps-switch`, `ps-button`; `kitHost`, `focusRing`, `reducedMotion` (`../kit/kit-shared.styles`); the roving pattern of `kit/segmented.ts` (`onKeydown`, `select(value, focus)`).
- Produces:
  - `types.ts`: `interface LegendDisplaySettings { maxVisibleValues: number; shapeSize: number | null; enableDuplicateStackUI: boolean; paletteId: string; numericStrategy: NumericBinningStrategy; reverseGradient: boolean }`.
  - `palette-swatches.ts`: `CATEGORICAL_PALETTE_IDS: readonly string[]` and `GRADIENT_PALETTE_IDS: readonly string[]` (from `COLOR_SCHEME_INFO`, sorted by label, as the dialog lists them today: 6 and 5); `renderPaletteSwatches(view: { ids: readonly string[]; selected: string; gradient: boolean; reverse: boolean }, onPick: (id: string) => void): TemplateResult` (the view's type, `PaletteSwatchesView`, is module-private: knip reports an exported type nothing imports) — `div.swatches[role=radiogroup][aria-label="Palette"]` of `button.swatch[role=radio][aria-checked][data-palette]` named by the palette's label (the visible `span.swatch-name`), roving tabindex (the checked one is the tab stop), Arrow keys move and pick (wrapping), Home and End pick the first and last; a categorical swatch shows its first 8 colours (`span.swatch-chips > span.chip`), a gradient swatch `span.swatch-gradient` with `createColorSchemeLinearGradient(id, reverse ? '270deg' : '90deg')`.
  - `legend-settings-popover.ts`: `SETTINGS_INPUT_DEBOUNCE_MS = 300`; `@customElement('protspace-legend-settings-popover') class ProtspaceLegendSettingsPopover` with properties `anchor: Element | null`, `open: boolean`, `settings: LegendDisplaySettings`, `numeric: boolean`, `defaultShapeSize: number`, `logBinningAvailable: boolean`, `canReset: boolean`, `annotationLabel: string`; methods `flush(): void` (dispatches a pending number edit at once), `focusFirst(): void` (the checked swatch). Renders `<ps-popover .anchor .open placement="bottom-end" panel-role="dialog" panel-label="Legend settings: {annotationLabel}">` > `h3.title` `{annotationLabel}`; "Palette" swatches; numeric only: `ps-switch#reverse-gradient-toggle` "Reverse gradient" and `ps-select#numeric-distribution-select` "Bin distribution" (Linear, Quantile, Logarithmic; Logarithmic disabled when `!logBinningAvailable`, with today's note "Logarithmic distribution is only available for positive values." in `p#numeric-log-disabled-note[data-driver-id="numeric-log-disabled-note"]`, which describes the select through `describedBy`); `ps-input#max-visible-input type="number"` "Max legend items" (numeric "Bins"); `ps-input#shape-size-input type="number"` "Shape size" (numeric "Point size"; placeholder the default; hint "Default for this dataset: {n}; clear the field to use it."); `ps-switch` "Show duplicate counts and spread overlaps"; footer `ps-button variant="ghost" size="sm"` "Reset" (`disabled` when `!canReset`) with the hint "Resets this annotation's colours, order, hidden categories, palette and item count, and the dataset's point size". No `title` attribute anywhere.
  - Events on the host, not bubbling: `settings-change` (`CustomEvent<Partial<LegendDisplaySettings>>`, one field per edit: swatch, switches and select at once; a number field 300 ms after its last `input` (typing or an arrow-key step), and at once on Enter or when focus leaves the field; an emptied size gives `shapeSize: null`; a size over 64 gives 64 and writes 64 back into the field; a value that is not a positive whole number is ignored and the field shown `invalid`; an edit equal to the current setting fires nothing); `settings-reset` (`Event`; a pending number edit is dropped first). Closing (`ps-close`), the owner setting `open` to false, or disconnecting flushes a pending edit first. `ps-close` reaches the owner from the inner popover (bubbling, composed) after the flush.
  - `kit/select.ts`: `PsSelect.describedBy: readonly Element[]` (attribute-less property, default `[]`), bound to the native select's `ariaDescribedByElements`, as `KitButtonBase.describedBy` is.

**Tests:**

- `legend-settings-popover.browser.test.ts`: "the panel is a dialog named Legend settings: {label}, headed by the display name"; "the swatches are a radio group named Palette with 6 categorical and 5 gradient palettes"; "picking a palette fires settings-change {paletteId}; the checked one fires nothing and nothing bubbles"; "arrow keys move the checked swatch and fire one settings-change each"; "typing 2 then 5 fires one settings-change {maxVisibleValues: 25} after 300 ms" (Review Focus 3); "commits exactly SETTINGS_INPUT_DEBOUNCE_MS after the last input" (fake timers); "holding ArrowUp on the field fires one settings-change after the burst" (Review Focus 3); "Enter or leaving the field fires at once"; "an emptied size fires shapeSize: null and shows the default as placeholder"; "640 becomes 64 in the field and in the event"; "0, -5, an empty field and a bad entry fire nothing and mark the field invalid"; "logarithmic is disabled with its note when unavailable"; "numeric shows Bins, Point size, Reverse gradient and Bin distribution; categorical shows neither switch nor select"; "Reset fires settings-reset, keeps the panel open, and is disabled when canReset is false"; "there is no Save or Cancel and no title attribute"; "closing with a pending edit fires it before ps-close reaches the owner; so does removal".
- `fields.browser.test.ts`: "ps-select forwards describedBy to the native select".
- `style-lint.test.ts` and `styles-integrity.test.ts` pass with the new stylesheet outside LEGACY.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/components/legend/legend-settings-popover.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsInput } from '../kit/input';
import type { PsSelect } from '../kit/select';
import {
  SETTINGS_INPUT_DEBOUNCE_MS,
  type ProtspaceLegendSettingsPopover,
} from './legend-settings-popover';
import { CATEGORICAL_PALETTE_IDS, GRADIENT_PALETTE_IDS } from './palette-swatches';
import type { LegendDisplaySettings } from './types';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Past the number fields' debounce, with room for a slow frame. */
const afterDebounce = () => wait(SETTINGS_INPUT_DEBOUNCE_MS + 150);

async function settle(el: ProtspaceLegendSettingsPopover): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}

const CATEGORICAL: LegendDisplaySettings = {
  maxVisibleValues: 10,
  shapeSize: 12,
  enableDuplicateStackUI: false,
  paletteId: 'kellys',
  numericStrategy: 'quantile',
  reverseGradient: false,
};

interface MountOptions {
  numeric?: boolean;
  logBinningAvailable?: boolean;
  canReset?: boolean;
  settings?: Partial<LegendDisplaySettings>;
}

/**
 * The popover open under an anchor, as the legend renders it. A listener stands in for the legend:
 * it records each settings-change and applies it, so the popover shows the new value.
 */
async function mount(options: MountOptions = {}) {
  document.body.innerHTML =
    '<button id="anchor">Legend settings</button><button id="outside">Outside</button>';
  const anchor = document.getElementById('anchor') as HTMLButtonElement;
  const el = document.createElement('protspace-legend-settings-popover');
  el.anchor = anchor;
  el.annotationLabel = options.numeric ? 'Sequence length' : 'Family';
  el.numeric = options.numeric ?? false;
  el.defaultShapeSize = 4;
  el.logBinningAvailable = options.logBinningAvailable ?? true;
  el.canReset = options.canReset ?? true;
  el.settings = {
    ...CATEGORICAL,
    ...(options.numeric ? { paletteId: 'batlow' } : {}),
    ...options.settings,
  };
  const changes: Partial<LegendDisplaySettings>[] = [];
  el.addEventListener('settings-change', (event) => {
    const detail = (event as CustomEvent<Partial<LegendDisplaySettings>>).detail;
    changes.push(detail);
    el.settings = { ...el.settings, ...detail };
  });
  document.body.append(el);
  anchor.focus();
  el.open = true;
  await settle(el);
  return { el, anchor, changes };
}

const root = (el: ProtspaceLegendSettingsPopover) => el.shadowRoot!;
const field = (el: ProtspaceLegendSettingsPopover, id: 'max-visible-input' | 'shape-size-input') =>
  root(el).querySelector<PsInput>(`#${id}`)!;
const inner = (host: PsInput) => host.shadowRoot!.querySelector('input')!;
const radios = (el: ProtspaceLegendSettingsPopover) => [
  ...root(el).querySelectorAll<HTMLElement>('[role="radio"]'),
];
const radioNames = (el: ProtspaceLegendSettingsPopover) =>
  radios(el).map((radio) => radio.textContent!.trim());

describe('protspace-legend-settings-popover', () => {
  it('the panel is a dialog named Legend settings: {label}, headed by the display name', async () => {
    const { el } = await mount();
    await expect
      .element(page.getByRole('dialog', { name: 'Legend settings: Family' }))
      .toBeVisible();
    expect(root(el).querySelector('.title')!.textContent!.trim()).toBe('Family');
    // Non-modal: the plot stays usable beside it.
    const panel = root(el).querySelector('ps-popover')!.shadowRoot!.querySelector('.panel')!;
    expect(panel.hasAttribute('aria-modal')).toBe(false);
  });

  it('the swatches are a radio group named Palette with 6 categorical and 5 gradient palettes', async () => {
    expect(CATEGORICAL_PALETTE_IDS).toEqual([
      'dark2',
      'kellys',
      'okabeIto',
      'set2',
      'tableau10',
      'tolBright',
    ]);
    expect(GRADIENT_PALETTE_IDS).toEqual(['batlow', 'cividis', 'inferno', 'plasma', 'viridis']);

    const { el } = await mount();
    await expect.element(page.getByRole('radiogroup', { name: 'Palette' })).toBeVisible();
    expect(radioNames(el)).toEqual([
      'Dark2',
      "Kelly's Colors",
      'Okabe-Ito',
      'Set2',
      'Tableau 10',
      'Tol Bright',
    ]);
    expect(radios(el).map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(radios(el).map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    expect(radios(el)[1].querySelectorAll('.chip')).toHaveLength(8);
    el.focusFirst();
    expect(deepActiveElement()).toBe(radios(el)[1]);

    document.body.replaceChildren();
    const numeric = await mount({ numeric: true });
    expect(radioNames(numeric.el)).toEqual(['Batlow', 'Cividis', 'Inferno', 'Plasma', 'Viridis']);
    const strip = radios(numeric.el)[0].querySelector<HTMLElement>('.swatch-gradient')!;
    expect(strip.style.backgroundImage).toContain('linear-gradient(90deg');
  });

  it('picking a palette fires settings-change {paletteId}; the checked one fires nothing and nothing bubbles', async () => {
    const { el, changes } = await mount();
    const onDocument = vi.fn();
    document.addEventListener('settings-change', onDocument);
    try {
      await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
      await settle(el);
      await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    } finally {
      document.removeEventListener('settings-change', onDocument);
    }
    expect(changes).toEqual([{ paletteId: 'okabeIto' }]);
    await settle(el);
    expect(radios(el)[2].getAttribute('aria-checked')).toBe('true');
    expect(onDocument).not.toHaveBeenCalled();
    expect(el.open).toBe(true);
  });

  it('arrow keys move the checked swatch and fire one settings-change each', async () => {
    const { el, changes } = await mount();
    radios(el)[1].focus();
    for (const key of ['{ArrowRight}', '{ArrowDown}', '{ArrowLeft}', '{End}', '{Home}']) {
      await userEvent.keyboard(key);
      await settle(el);
    }
    expect(changes.map((change) => change.paletteId)).toEqual([
      'okabeIto',
      'set2',
      'okabeIto',
      'tolBright',
      'dark2',
    ]);
    expect(deepActiveElement()).toBe(radios(el)[0]);
    expect(radios(el).map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it('typing 2 then 5 fires one settings-change {maxVisibleValues: 25} after 300 ms', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    await userEvent.fill(input, '');
    await userEvent.keyboard('25');
    expect(input.value).toBe('25');
    expect(changes).toEqual([]);
    await afterDebounce();
    expect(changes).toEqual([{ maxVisibleValues: 25 }]);
  });

  it('commits exactly SETTINGS_INPUT_DEBOUNCE_MS after the last input', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    // Synthetic input under fake timers: userEvent talks to the runner over real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (const value of ['2', '25']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        vi.advanceTimersByTime(SETTINGS_INPUT_DEBOUNCE_MS - 1);
      }
      expect(changes).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(changes).toEqual([{ maxVisibleValues: 25 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holding ArrowUp on the field fires one settings-change after the burst', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    input.focus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(input.value).toBe('13');
    expect(changes).toEqual([]);
    await afterDebounce();
    expect(changes).toEqual([{ maxVisibleValues: 13 }]);
  });

  it('Enter or leaving the field fires at once', async () => {
    const { el, changes } = await mount();
    await userEvent.fill(inner(field(el, 'max-visible-input')), '30');
    await userEvent.keyboard('{Enter}');
    expect(changes).toEqual([{ maxVisibleValues: 30 }]);
    await userEvent.fill(inner(field(el, 'shape-size-input')), '20');
    await userEvent.keyboard('{Tab}');
    expect(changes).toEqual([{ maxVisibleValues: 30 }, { shapeSize: 20 }]);
    await afterDebounce();
    expect(changes).toHaveLength(2);
    expect(el.open).toBe(true);
  });

  it('an emptied size fires shapeSize: null and shows the default as placeholder', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'shape-size-input'));
    expect(input.value).toBe('12');
    expect(input.placeholder).toBe('4');
    expect(root(el).textContent).toContain('Default for this dataset: 4');
    await userEvent.fill(input, '');
    await afterDebounce();
    expect(changes).toEqual([{ shapeSize: null }]);
    await settle(el);
    expect(input.value).toBe('');
  });

  it('640 becomes 64 in the field and in the event', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'shape-size-input'));
    await userEvent.fill(input, '640');
    expect(input.value).toBe('64');
    await afterDebounce();
    expect(changes).toEqual([{ shapeSize: 64 }]);
  });

  it('0, -5, an empty field and a bad entry fire nothing and mark the field invalid', async () => {
    const { el, changes } = await mount();
    const host = field(el, 'max-visible-input');
    const input = inner(host);
    for (const value of ['0', '-5', '']) {
      await userEvent.fill(input, value);
      await settle(el);
      expect(host.invalid, value).toBe(true);
      expect(input.getAttribute('aria-invalid'), value).toBe('true');
    }
    // 'e' is the one letter a number field takes; alone it parses as nothing.
    await userEvent.keyboard('e');
    await settle(el);
    expect(host.invalid).toBe(true);
    await afterDebounce();
    expect(changes).toEqual([]);

    await userEvent.fill(input, '12');
    await settle(el);
    expect(host.invalid).toBe(false);
    await afterDebounce();
    expect(changes).toEqual([{ maxVisibleValues: 12 }]);

    const size = field(el, 'shape-size-input');
    await userEvent.fill(inner(size), '0');
    await settle(el);
    expect(size.invalid).toBe(true);
    await afterDebounce();
    expect(changes).toHaveLength(1);
  });

  it('logarithmic is disabled with its note when unavailable', async () => {
    const { el } = await mount({ numeric: true, logBinningAvailable: false });
    const select = root(el).querySelector<PsSelect>('#numeric-distribution-select')!;
    const native = select.shadowRoot!.querySelector('select')!;
    expect([...native.options].map((option) => [option.value, option.disabled])).toEqual([
      ['linear', false],
      ['quantile', false],
      ['logarithmic', true],
    ]);
    const note = root(el).querySelector<HTMLElement>('#numeric-log-disabled-note')!;
    expect(note.textContent!.trim()).toBe(
      'Logarithmic distribution is only available for positive values.',
    );
    expect(note.dataset.driverId).toBe('numeric-log-disabled-note');
    expect(native.ariaDescribedByElements?.[0]).toBe(note);

    el.logBinningAvailable = true;
    await settle(el);
    expect(root(el).querySelector('#numeric-log-disabled-note')).toBeNull();
    expect(native.options[2].disabled).toBe(false);
    expect(native.ariaDescribedByElements ?? []).toHaveLength(0);
  });

  it('numeric shows Bins, Point size, Reverse gradient and Bin distribution; categorical shows neither switch nor select', async () => {
    const { el, changes } = await mount({ numeric: true });
    await expect.element(page.getByRole('spinbutton', { name: 'Bins' })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Point size' })).toBeVisible();
    await userEvent.click(page.getByRole('switch', { name: 'Reverse gradient' }));
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'Bin distribution' }), 'linear');
    await userEvent.click(
      page.getByRole('switch', { name: 'Show duplicate counts and spread overlaps' }),
    );
    expect(changes).toEqual([
      { reverseGradient: true },
      { numericStrategy: 'linear' },
      { enableDuplicateStackUI: true },
    ]);
    await settle(el);
    const strip = radios(el)[0].querySelector<HTMLElement>('.swatch-gradient')!;
    expect(strip.style.backgroundImage).toContain('270deg');

    document.body.replaceChildren();
    const categorical = await mount();
    await expect.element(page.getByRole('spinbutton', { name: 'Max legend items' })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Shape size' })).toBeVisible();
    expect(root(categorical.el).querySelector('#reverse-gradient-toggle')).toBeNull();
    expect(root(categorical.el).querySelector('#numeric-distribution-select')).toBeNull();
  });

  it('Reset fires settings-reset, keeps the panel open, and is disabled when canReset is false', async () => {
    const { el } = await mount();
    const onReset = vi.fn();
    el.addEventListener('settings-reset', onReset);
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    await userEvent.click(reset);
    expect(onReset).toHaveBeenCalledOnce();
    expect(el.open).toBe(true);
    await expect
      .element(page.getByText('Resets this annotation's colours, order, hidden categories, palette and item count, and the dataset's point size'))
      .toBeVisible();

    el.canReset = false;
    await settle(el);
    await expect.element(reset).toBeDisabled();
  });

  it('there is no Save or Cancel and no title attribute', async () => {
    const { el } = await mount({ numeric: true });
    expect(page.getByRole('button', { name: /^(Save|Cancel)$/ }).elements()).toHaveLength(0);
    expect(root(el).querySelectorAll('[title]')).toHaveLength(0);
  });

  it('closing with a pending edit fires it before ps-close reaches the owner; so does removal', async () => {
    const { el, anchor } = await mount();
    const log: string[] = [];
    el.addEventListener('settings-change', (event) =>
      log.push(`change ${JSON.stringify((event as CustomEvent).detail)}`),
    );
    el.addEventListener('ps-close', () => {
      log.push('close');
      // The owner's part: it closes the popover it opened.
      el.open = false;
    });
    await userEvent.fill(inner(field(el, 'max-visible-input')), '25');
    await userEvent.keyboard('{Escape}');
    await settle(el);
    expect(log).toEqual(['change {"maxVisibleValues":25}', 'close']);
    expect(document.activeElement).toBe(anchor);

    el.open = true;
    await settle(el);
    await userEvent.fill(inner(field(el, 'max-visible-input')), '7');
    el.remove();
    expect(log.at(-1)).toBe('change {"maxVisibleValues":7}');
  });
});
```

In `packages/core/src/components/kit/fields.browser.test.ts`, inside `describe('ps-select', …)`, after the case `'shows the old option when the owner rejects a pick'`, add:

```ts
  it('forwards describedBy to the native select', async () => {
    document.body.innerHTML =
      '<p id="note">Only positive values.</p><ps-select label="Bin distribution"></ps-select>';
    const el = document.querySelector('ps-select')!;
    const note = document.getElementById('note')!;
    el.describedBy = [note];
    await el.updateComplete;
    const native = el.shadowRoot!.querySelector('select')!;
    expect(native.ariaDescribedByElements?.[0]).toBe(note);
    el.describedBy = [];
    await el.updateComplete;
    expect(native.ariaDescribedByElements ?? []).toHaveLength(0);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run (sandbox disabled: browser mode starts a local server):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend-settings-popover.browser.test.ts src/components/kit/fields.browser.test.ts
```

Expected: FAIL. The popover file fails to load with `Failed to resolve import "./legend-settings-popover"`; in `fields.browser.test.ts` only "forwards describedBy to the native select" fails (`expected null to be <p id="note">`: `ps-select` has no `describedBy` yet).

- [ ] **Step 3: Add `LegendDisplaySettings` to the legend types**

In `packages/core/src/components/legend/types.ts`, add `NumericBinningStrategy` to the existing type import from `@protspace/utils`:

```ts
import type {
  AnnotationData,
  AnnotationPredictedData,
  NumericBinningStrategy,
  ProjectionStatisticRow,
} from '@protspace/utils';
```

and append, after `interface OtherItem`:

```ts
/**
 * The settings the legend settings popover edits, one control each. Live state, not a draft: the
 * legend applies each edit as it arrives and stores it in its usual record.
 */
export interface LegendDisplaySettings {
  /** Max legend items; for a numeric annotation, the number of bins. */
  maxVisibleValues: number;
  /** The size field: a size, or null for the dataset's default. */
  shapeSize: number | null;
  enableDuplicateStackUI: boolean;
  paletteId: string;
  numericStrategy: NumericBinningStrategy;
  reverseGradient: boolean;
}
```

- [ ] **Step 4: Give `ps-select` a `describedBy`**

In `packages/core/src/components/kit/select.ts`, after `@property({ type: Boolean, reflect: true }) disabled = false;` add:

```ts
  /** Elements that describe the select; an id reference cannot reach into the shadow root. */
  @property({ attribute: false }) describedBy: readonly Element[] = [];
```

and in `render()`, add one binding to the `<select>` after `aria-label=${this.label || nothing}`:

```ts
        .ariaDescribedByElements=${this.describedBy.length ? this.describedBy : null}
```

- [ ] **Step 5: Write the palette swatches**

Create `packages/core/src/components/legend/palette-swatches.ts`:

```ts
import { html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  COLOR_SCHEME_INFO,
  COLOR_SCHEMES,
  GRADIENT_COLOR_SCHEME_IDS,
  createColorSchemeLinearGradient,
} from '@protspace/utils';

type PaletteId = keyof typeof COLOR_SCHEME_INFO;

/** How many of a categorical palette's colours its swatch shows. */
const SWATCH_CHIPS = 8;

function paletteIds(gradient: boolean): readonly string[] {
  return (Object.keys(COLOR_SCHEME_INFO) as PaletteId[])
    .filter((id) => GRADIENT_COLOR_SCHEME_IDS.has(id) === gradient)
    .sort((a, b) => COLOR_SCHEME_INFO[a].label.localeCompare(COLOR_SCHEME_INFO[b].label));
}

/** The palettes a categorical legend offers, by label, as the settings dialog listed them. */
export const CATEGORICAL_PALETTE_IDS: readonly string[] = paletteIds(false);

/** The gradients a numeric legend offers, by label. */
export const GRADIENT_PALETTE_IDS: readonly string[] = paletteIds(true);

interface PaletteSwatchesView {
  ids: readonly string[];
  selected: string;
  /** Gradient swatches (a numeric legend) instead of colour chips. */
  gradient: boolean;
  /** Draw gradients high to low, as "Reverse gradient" does. */
  reverse: boolean;
}

const STEP = new Map([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1],
]);

const paletteLabel = (id: string): string => COLOR_SCHEME_INFO[id as PaletteId]?.label ?? id;

function swatchPreview(id: string, view: PaletteSwatchesView): TemplateResult {
  if (view.gradient) {
    const backgroundImage = createColorSchemeLinearGradient(id, view.reverse ? '270deg' : '90deg');
    return html`<span
      class="swatch-gradient"
      aria-hidden="true"
      style=${styleMap({ backgroundImage })}
    ></span>`;
  }
  const colors = (COLOR_SCHEMES[id as PaletteId] ?? COLOR_SCHEMES.kellys).slice(0, SWATCH_CHIPS);
  return html`<span class="swatch-chips" aria-hidden="true"
    >${colors.map(
      (color) => html`<span class="chip" style=${styleMap({ background: color })}></span>`,
    )}</span
  >`;
}

/**
 * The palette picker: a radio group of swatches, each named by its palette. Arrow keys move and
 * pick, as `ps-segmented` does; the checked swatch is the one tab stop.
 */
export function renderPaletteSwatches(
  view: PaletteSwatchesView,
  onPick: (id: string) => void,
): TemplateResult {
  const checked = view.ids.indexOf(view.selected);
  const tabStop = checked < 0 ? 0 : checked;
  const onKeydown = (event: KeyboardEvent) => {
    const count = view.ids.length;
    const from = (event.target as Element).closest<HTMLElement>('[data-palette]');
    const index = from ? view.ids.indexOf(from.dataset.palette ?? '') : tabStop;
    const step = STEP.get(event.key);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (step !== undefined) next = (index + step + count) % count;
    else return;
    if (count === 0) return;
    event.preventDefault();
    const id = view.ids[next];
    onPick(id);
    (event.currentTarget as HTMLElement)
      .querySelector<HTMLElement>(`[data-palette="${CSS.escape(id)}"]`)
      ?.focus();
  };
  return html`<div class="swatches" role="radiogroup" aria-label="Palette" @keydown=${onKeydown}>
    ${view.ids.map(
      (id, index) =>
        html`<button
          type="button"
          class="swatch"
          role="radio"
          aria-checked=${String(id === view.selected)}
          tabindex=${index === tabStop ? 0 : -1}
          data-palette=${id}
          @click=${() => onPick(id)}
        >
          ${swatchPreview(id, view)}<span class="swatch-name">${paletteLabel(id)}</span>
        </button>`,
    )}
  </div>`;
}
```

- [ ] **Step 6: Write the stylesheet**

Create `packages/core/src/components/legend/legend-settings-popover.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/** The legend settings popover's content (decision 12); ps-popover draws the panel. */
export const legendSettingsPopoverStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      display: contents;
    }
    .settings {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-3);
      width: 300px;
      max-width: 100%;
      padding: var(--ps-space-3);
    }
    .title {
      margin: 0;
      overflow: hidden;
      color: var(--ps-text);
      font-size: var(--ps-text-base);
      font-weight: var(--ps-weight-semibold);
      line-height: var(--ps-leading-tight);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .group,
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1-5);
    }
    .label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
    }
    .hint {
      margin: 0;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }
    ps-input,
    ps-select {
      width: 100%;
    }
    ps-switch {
      align-self: flex-start;
    }
    .swatches {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--ps-space-1-5);
    }
    .swatch {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
      min-width: 0;
      padding: var(--ps-space-1-5);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
      font-size: var(--ps-text-xs);
      text-align: start;
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        border-color var(--ps-duration-fast) var(--ps-ease);
    }
    .swatch:hover {
      background: var(--ps-surface-hover);
    }
    .swatch[aria-checked='true'] {
      border-color: var(--ps-accent);
      background: var(--ps-accent-tint);
      box-shadow: 0 0 0 1px var(--ps-accent);
    }
    .swatch-chips,
    .swatch-gradient {
      display: flex;
      height: 14px;
      overflow: hidden;
      border-radius: var(--ps-radius-sm);
      /* Over the chips, so light colours keep an edge on a light surface. */
      outline: 1px solid color-mix(in srgb, var(--ps-text) 12%, transparent);
      outline-offset: -1px;
    }
    .chip {
      flex: 1;
    }
    .swatch-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ps-space-1);
      padding-top: var(--ps-space-2);
      border-top: 1px solid var(--ps-border);
    }
    @media (forced-colors: active) {
      .swatch[aria-checked='true'] {
        outline: 2px solid Highlight;
      }
    }
  `,
];
```

- [ ] **Step 7: Write the element**

Create `packages/core/src/components/legend/legend-settings-popover.ts`:

```ts
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { DEFAULT_NUMERIC_STRATEGY, type NumericBinningStrategy } from '@protspace/utils';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import '../kit/input';
import type { PsInput } from '../kit/input';
import '../kit/popover';
import '../kit/select';
import type { PsSelect, SelectOption } from '../kit/select';
import '../kit/switch';
import type { PsSwitch } from '../kit/switch';
import { LEGEND_DEFAULTS } from './config';
import { legendSettingsPopoverStyles } from './legend-settings-popover.styles';
import {
  CATEGORICAL_PALETTE_IDS,
  GRADIENT_PALETTE_IDS,
  renderPaletteSwatches,
} from './palette-swatches';
import type { LegendDisplaySettings } from './types';

/**
 * A typed number commits this long after the last keystroke or arrow step, so "25" or a held arrow
 * re-bins the plot once, not once per key (design decision 12, Review Focus 3).
 */
export const SETTINGS_INPUT_DEBOUNCE_MS = 300;

type NumberField = 'maxVisibleValues' | 'shapeSize';

const NUMBER_FIELDS: readonly NumberField[] = ['maxVisibleValues', 'shapeSize'];

const FIELD_IDS: Record<NumberField, string> = {
  maxVisibleValues: 'max-visible-input',
  shapeSize: 'shape-size-input',
};

const DEFAULT_SETTINGS: LegendDisplaySettings = {
  maxVisibleValues: LEGEND_DEFAULTS.maxVisibleValues,
  shapeSize: null,
  enableDuplicateStackUI: LEGEND_DEFAULTS.enableDuplicateStackUI,
  paletteId: 'kellys',
  numericStrategy: DEFAULT_NUMERIC_STRATEGY,
  reverseGradient: false,
};

const SETTINGS_KEYS: readonly (keyof LegendDisplaySettings)[] = [
  'maxVisibleValues',
  'shapeSize',
  'enableDuplicateStackUI',
  'paletteId',
  'numericStrategy',
  'reverseGradient',
];

/** The legend derives `settings` afresh at every render; only a changed value re-renders this. */
function sameSettings(next: LegendDisplaySettings, prev?: LegendDisplaySettings): boolean {
  return !!prev && SETTINGS_KEYS.every((key) => next[key] === prev[key]);
}

const DISTRIBUTIONS: Record<'withLog' | 'withoutLog', SelectOption[]> = {
  withLog: [
    { value: 'linear', label: 'Linear' },
    { value: 'quantile', label: 'Quantile' },
    { value: 'logarithmic', label: 'Logarithmic' },
  ],
  withoutLog: [
    { value: 'linear', label: 'Linear' },
    { value: 'quantile', label: 'Quantile' },
    { value: 'logarithmic', label: 'Logarithmic', disabled: true },
  ],
};

function parsePositiveInt(value: string): number | null {
  const parsed = parseInt(value, 10);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
}

function fieldText(field: NumberField, settings: LegendDisplaySettings): string {
  const value = settings[field];
  return value === null ? '' : String(value);
}

/**
 * The legend's settings as a popover under its settings button (design decision 12). Every edit is
 * a `settings-change` the legend applies at once; there is no Save or Cancel. Reset is a
 * `settings-reset`. The legend owns `open`: it sets it, and clears it on `ps-close`.
 */
@customElement('protspace-legend-settings-popover')
export class ProtspaceLegendSettingsPopover extends LitElement {
  static styles = legendSettingsPopoverStyles;

  @property({ attribute: false }) anchor: Element | null = null;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({
    attribute: false,
    hasChanged: (next: LegendDisplaySettings, prev: LegendDisplaySettings | undefined) =>
      !sameSettings(next, prev),
  })
  settings: LegendDisplaySettings = DEFAULT_SETTINGS;
  @property({ type: Boolean }) numeric = false;
  @property({ attribute: false }) defaultShapeSize: number = LEGEND_DEFAULTS.symbolSize;
  @property({ attribute: false }) logBinningAvailable = true;
  @property({ attribute: false }) canReset = false;
  @property({ attribute: false }) annotationLabel = '';

  @state() private _invalid: ReadonlySet<NumberField> = new Set();
  @query('#numeric-distribution-select') private _strategySelect?: PsSelect;
  @query('#numeric-log-disabled-note') private _logNote?: HTMLElement;

  private _pending: { field: NumberField; value: number | null } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  render() {
    const settings = this.settings;
    return html`<ps-popover
      .anchor=${this.anchor}
      .open=${this.open}
      placement="bottom-end"
      panel-role="dialog"
      panel-label=${`Legend settings: ${this.annotationLabel}`}
      @ps-close=${this._onClose}
    >
      <div class="settings">
        <h3 class="title">${this.annotationLabel}</h3>
        <div class="group">
          <span class="label" aria-hidden="true">Palette</span>
          ${renderPaletteSwatches(
            {
              ids: this.numeric ? GRADIENT_PALETTE_IDS : CATEGORICAL_PALETTE_IDS,
              selected: settings.paletteId,
              gradient: this.numeric,
              reverse: settings.reverseGradient,
            },
            this._onPalette,
          )}
          ${this.numeric ? this._renderNumericControls(settings) : nothing}
        </div>
        ${this._renderNumberField(
          'maxVisibleValues',
          this.numeric ? 'Bins' : 'Max legend items',
          String(LEGEND_DEFAULTS.maxVisibleValues),
          this.numeric
            ? 'An upper limit: sparse ranges may show fewer bins.'
            : 'Categories past this are grouped into Other.',
        )}
        ${this._renderNumberField(
          'shapeSize',
          this.numeric ? 'Point size' : 'Shape size',
          String(this.defaultShapeSize),
          `Default for this dataset: ${this.defaultShapeSize}; clear the field to use it.`,
        )}
        <ps-switch
          label="Show duplicate counts and spread overlaps"
          .checked=${settings.enableDuplicateStackUI}
          @change=${this._onDuplicates}
          >Show duplicate counts and spread overlaps</ps-switch
        >
        <div class="footer">
          <ps-button variant="ghost" size="sm" ?disabled=${!this.canReset} @click=${this._onReset}
            >Reset</ps-button
          >
          <p class="hint">Resets this annotation's colours, order, hidden categories, palette and item count, and the dataset's point size</p>
        </div>
      </div>
    </ps-popover>`;
  }

  protected updated(changed: PropertyValues<this>): void {
    // The owner closed it (its settings button): keep what was typed.
    if (changed.has('open') && !this.open && changed.get('open') === true) {
      this.flush();
      this._syncFields();
    }
    const select = this._strategySelect;
    if (select) {
      const note = this._logNote;
      const next: readonly Element[] = note ? [note] : [];
      if (select.describedBy.length !== next.length || select.describedBy[0] !== next[0]) {
        select.describedBy = next;
      }
    }
  }

  disconnectedCallback(): void {
    this.flush();
    super.disconnectedCallback();
  }

  /** Dispatches a number edit still waiting on its debounce, at once. */
  flush(): void {
    this._clearTimer();
    const pending = this._pending;
    this._pending = null;
    if (!pending || this.settings[pending.field] === pending.value) return;
    // Only the size field reads null (emptied); Max legend items is always a number here.
    this._emit(
      pending.field === 'shapeSize'
        ? { shapeSize: pending.value }
        : { maxVisibleValues: pending.value as number },
    );
  }

  /** Focuses the checked palette swatch, the panel's first stop. */
  focusFirst(): void {
    const swatches = [...this.renderRoot.querySelectorAll<HTMLElement>('[role="radio"]')];
    (swatches.find((swatch) => swatch.getAttribute('aria-checked') === 'true') ?? swatches[0])?.focus();
  }

  private _renderNumericControls(settings: LegendDisplaySettings): TemplateResult {
    return html`<ps-switch
        id="reverse-gradient-toggle"
        label="Reverse gradient"
        .checked=${settings.reverseGradient}
        @change=${this._onReverse}
        >Reverse gradient</ps-switch
      >
      <div class="field">
        <span class="label" aria-hidden="true">Bin distribution</span>
        <ps-select
          id="numeric-distribution-select"
          label="Bin distribution"
          .options=${this.logBinningAvailable ? DISTRIBUTIONS.withLog : DISTRIBUTIONS.withoutLog}
          .value=${settings.numericStrategy}
          @change=${this._onStrategy}
        ></ps-select>
        ${this.logBinningAvailable
          ? nothing
          : html`<p
              class="hint"
              id="numeric-log-disabled-note"
              data-driver-id="numeric-log-disabled-note"
            >
              Logarithmic distribution is only available for positive values.
            </p>`}
      </div>`;
  }

  private _renderNumberField(
    field: NumberField,
    label: string,
    placeholder: string,
    hint: string,
  ): TemplateResult {
    return html`<div class="field">
      <span class="label" aria-hidden="true">${label}</span>
      <ps-input
        id=${FIELD_IDS[field]}
        type="number"
        label=${label}
        placeholder=${placeholder}
        .value=${fieldText(field, this.settings)}
        ?invalid=${this._invalid.has(field)}
        @input=${(event: Event) => this._onNumberInput(field, event)}
        @keydown=${this._onNumberKeydown}
        @focusout=${this._onNumberFocusOut}
      ></ps-input>
      <p class="hint">${hint}</p>
    </div>`;
  }

  private _onNumberInput(field: NumberField, event: Event): void {
    const input = event.composedPath()[0] as HTMLInputElement;
    const value = this._readNumber(field, input, event.currentTarget as PsInput);
    this._setInvalid(field, value === undefined);
    if (value === undefined) {
      if (this._pending?.field === field) this._cancel();
      return;
    }
    if (this._pending && this._pending.field !== field) this.flush();
    this._pending = { field, value };
    this._clearTimer();
    this._timer = setTimeout(() => this.flush(), SETTINGS_INPUT_DEBOUNCE_MS);
  }

  /** A positive whole number, null for an emptied size, undefined for anything else. */
  private _readNumber(
    field: NumberField,
    input: HTMLInputElement,
    host: PsInput,
  ): number | null | undefined {
    // A number field also reads '' while it holds text it cannot parse; only an empty one asks
    // for the default.
    if (field === 'shapeSize' && input.value === '' && !input.validity.badInput) return null;
    const value = parsePositiveInt(input.value);
    if (value === null) return undefined;
    if (field === 'shapeSize' && value > LEGEND_DEFAULTS.maxSymbolSize) {
      // Written back, so the field never shows a size that is not the one applied.
      input.value = String(LEGEND_DEFAULTS.maxSymbolSize);
      host.value = input.value;
      return LEGEND_DEFAULTS.maxSymbolSize;
    }
    return value;
  }

  private _onNumberKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') this.flush();
  };

  private _onNumberFocusOut = () => this.flush();

  private _onPalette = (paletteId: string) => {
    if (paletteId !== this.settings.paletteId) this._change({ paletteId });
  };

  private _onReverse = (event: Event) =>
    this._change({ reverseGradient: (event.currentTarget as PsSwitch).checked });

  private _onDuplicates = (event: Event) =>
    this._change({ enableDuplicateStackUI: (event.currentTarget as PsSwitch).checked });

  private _onStrategy = (event: Event) =>
    this._change({
      numericStrategy: (event.currentTarget as PsSelect).value as NumericBinningStrategy,
    });

  private _onReset = () => {
    if (!this.canReset) return;
    this._cancel();
    this._syncFields();
    this.dispatchEvent(new Event('settings-reset'));
  };

  // Runs on the inner popover, before ps-close bubbles on to the owner.
  private _onClose = () => {
    this.flush();
    this._syncFields();
  };

  /** A discrete edit: anything typed before it goes first. */
  private _change(patch: Partial<LegendDisplaySettings>): void {
    this.flush();
    this._emit(patch);
  }

  private _emit(patch: Partial<LegendDisplaySettings>): void {
    this.dispatchEvent(
      new CustomEvent<Partial<LegendDisplaySettings>>('settings-change', { detail: patch }),
    );
  }

  private _setInvalid(field: NumberField, invalid: boolean): void {
    if (this._invalid.has(field) === invalid) return;
    const next = new Set(this._invalid);
    if (invalid) next.add(field);
    else next.delete(field);
    this._invalid = next;
  }

  /** Puts the settings back into both fields, dropping text that was never applied. */
  private _syncFields(): void {
    for (const field of NUMBER_FIELDS) {
      const input = this.renderRoot.querySelector<PsInput>(`#${FIELD_IDS[field]}`);
      if (input) input.value = fieldText(field, this.settings);
    }
    if (this._invalid.size > 0) this._invalid = new Set();
  }

  private _cancel(): void {
    this._clearTimer();
    this._pending = null;
  }

  private _clearTimer(): void {
    if (this._timer === null) return;
    clearTimeout(this._timer);
    this._timer = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-legend-settings-popover': ProtspaceLegendSettingsPopover;
  }
}
```

Notes for the implementer:

- `hasChanged` takes typed parameters, as the legend's reliability state declared its own before Task 3.3 (`hasChanged: (next: EatReliabilityState, prev: EatReliabilityState | undefined) => …`); Lit declares `hasChanged` as a method, so the narrower parameter types are accepted.
- Number fields deliberately have no `change` listener: Chrome fires `change` on each arrow-key step, which would commit every step of a held arrow. Enter and `focusout` commit at once; `input` (typing, arrows, the spinner) is debounced. Leaving the field fires `change` and `focusout` together, so the result is the same as committing on `change`.
- The size field's empty state means "the dataset's default" and shows it as the placeholder; the legend (Task 3.12) passes `shapeSize: null` while the default is in use, so emptying the field and pausing never fills in a number under the user's cursor.

- [ ] **Step 8: Run the tests**

Run (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend-settings-popover.browser.test.ts src/components/kit/fields.browser.test.ts
```

Expected: PASS: 16 tests in `legend-settings-popover.browser.test.ts`, and every `fields.browser.test.ts` case including the new one. If "a bad entry" fails because this Chromium does not insert `e` into an empty number field, the field is still invalid from the empty fill before it, so the assertion holds; any other failure is real.

- [ ] **Step 9: Run the suites this task touches**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/styles src/components/legend
pnpm --filter @protspace/core exec vitest --run
pnpm --filter @protspace/core type-check
pnpm --filter @protspace/core lint
pnpm exec knip
pnpm exec prettier --check packages/core/src/components/legend/types.ts packages/core/src/components/legend/palette-swatches.ts packages/core/src/components/legend/legend-settings-popover.ts packages/core/src/components/legend/legend-settings-popover.styles.ts packages/core/src/components/legend/legend-settings-popover.browser.test.ts packages/core/src/components/kit/select.ts packages/core/src/components/kit/fields.browser.test.ts
```

The second line runs both projects and needs the sandbox disabled. Expected: `style-lint.test.ts` lists `../components/legend/legend-settings-popover.styles.ts reads colours and font sizes from tokens` and passes (the module is not in LEGACY, which stays as Task 3.10 left it); `styles-integrity.test.ts` passes; the core total is the count before this task plus 17; type-check, lint and knip are clean (each new export has a consumer: the element and `SETTINGS_INPUT_DEBOUNCE_MS` in the browser test, the palette ids and `renderPaletteSwatches` in the element, `LegendDisplaySettings` in both). Nothing outside core changes, so the app and e2e suites are not affected; `wc -l packages/core/src/components/legend/legend.ts` is unchanged.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/types.ts packages/core/src/components/legend/palette-swatches.ts packages/core/src/components/legend/legend-settings-popover.ts packages/core/src/components/legend/legend-settings-popover.styles.ts packages/core/src/components/legend/legend-settings-popover.browser.test.ts packages/core/src/components/kit/select.ts packages/core/src/components/kit/fields.browser.test.ts
git add packages/core/src/components/legend/types.ts \
  packages/core/src/components/legend/palette-swatches.ts \
  packages/core/src/components/legend/legend-settings-popover.ts \
  packages/core/src/components/legend/legend-settings-popover.styles.ts \
  packages/core/src/components/legend/legend-settings-popover.browser.test.ts \
  packages/core/src/components/kit/select.ts \
  packages/core/src/components/kit/fields.browser.test.ts
git commit -m "feat(core): add the legend settings popover element"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.12: Legend settings apply live from a popover; the dialogs and focus trap go

The legend mounts the settings popover under its header's settings button and applies each edit as it arrives (decision 12), through one applier per field that ends in today's save tail. Reset keeps its scope and leaves the popover open with the defaults. Category order leaves settings. The settings dialog, `focus-trap.ts`, the modal styles, `overlayMixins` and the legend's window Escape handler are deleted; a real `_enableDuplicateStackUI` fixes the stored-flag overwrite. Persistence keeps its key and format, pinned by Task 3.1's fixtures. This task changes core and its tests only: the e2e tests that drove the old dialog are parked with `test.fixme` for one commit, and Task 3.13 moves them to the popover.

**Files:**

- Create: `packages/core/src/components/legend/legend.settings.browser.test.ts`
- Create: `packages/core/src/components/legend/legend.numeric-settings.test.ts` (unit, jsdom: the ten numeric-inference and hashing cases of `legend-settings-dialog.test.ts` that do not test the dialog, moved so they are not lost with it)
- Modify: `legend.ts`, `legend-header.ts` (`settingsOpen` on the settings button), `legend.styles.ts` (drops `overlayMixins` and `modalStyles`), `legend-helpers.test.ts` (the `initializeAnnotationSortMode` tests go; `legend-helpers.ts` itself is untouched: the function lived in the dialog module), `packages/core/src/styles/style-lint.test.ts` (drop `legend/styles/modal.ts`)
- Delete: `legend-settings-dialog.ts`, `legend-settings-dialog.test.ts`, `focus-trap.ts`, `focus-trap.test.ts`, `styles/modal.ts`
- Modify tests: `legend.shape-size.test.ts` (the `pick` helper and the cases "caps a host-set size when the settings dialog is saved" and "names the default in the settings dialog and returns to it from an emptied field" go through `_applyDisplaySettings` and `settings-change` instead of `_handleCustomize`, `_dialogSettings`, `_handleSettingsSave`, `#shape-size-input` and `.settings-note`), `legend-extract.test.ts` (the two `_dialogSettings` cases go), `legend.persistence-compat.test.ts` (adds the cases below), `legend.api.test.ts` and `legend.header.test.ts` (the settings-button case opens the popover, see Step 3), `legend.score-sync.test.ts` (its settings-dialog `describe` goes), `legend.escape-order.browser.test.ts` (the settings case)
- Modify: `apps/web/tests/numeric-binning.spec.ts` and `apps/web/tests/workbench-sidebar.spec.ts` (each test that opens the old dialog becomes `test.fixme` until Task 3.13)
- Modify: `docs/developers/api/index.md`, `docs/developers/architecture.md`, `docs/developers/messaging.md`

All paths below without a folder are in `packages/core/src/components/legend/`.

**Interfaces:**

- Consumes: `protspace-legend-settings-popover` (`ProtspaceLegendSettingsPopover`: `anchor`, `open`, `settings`, `numeric`, `defaultShapeSize`, `logBinningAvailable`, `canReset`, `annotationLabel`, `flush()`, `focusFirst()`, events `settings-change` / `settings-reset`, `ps-open` / `ps-close` from its inner popover; the hosts `#max-visible-input`, `#shape-size-input`), `LegendDisplaySettings` (`types.ts`) (3.11); `normalizeCategoricalPaletteId`, `applyPaletteColors` (`legend-items-state.ts`, 3.5); `renderLegendHeader`, `LegendHeaderModel`, `LegendHeaderHandlers.onSettings(anchor)` (`legend-header.ts`, 3.9; the settings button is `ps-icon-button.settings-button`, label "Legend settings"); `_keyboard.clear()` (3.4), `_colorPicker.close()` (3.4), `_listenForEscape(on)` and `_escapeListening` (3.4; after Task 3.10 the call in `updated()` reads `this._listenForEscape(this._showSettingsDialog);`), `_rowMenu` (3.6), `_sortMenu` (3.9), `_otherAnchor` (3.10); `stubPopoverApi()` (`test-support/popover-stub.ts`, 3.6); `_handleSettingsReset` semantics; `defaultShapeSize`, `calculatePointSize`, `LEGEND_DEFAULTS`; test support `mountLegendWithScatterplot`, `MockScatterplot`, `categoricalData`, `numericData`, `TWELVE`, `legacyLegendRecord`, `legendStorageKey` (3.1).
- Produces:
  - `legend-header.ts`: `LegendHeaderModel` gains `settingsOpen?: boolean`; the settings button carries `aria-haspopup="dialog"` and `aria-expanded` from it (`ps-popover` does not set them; the owner does).
  - `legend.ts`: `@state() _settingsAnchor: HTMLElement | null` (open while set; the header's settings button toggles it through `_openSettings(anchor: HTMLElement)`, which clears a keyboard reorder, closes the colour picker, the row and sort menus and the Other popover, dispatches `legend-customize`, then the legend focuses the checked swatch on `ps-open`); `_closeSettings()` (flushes, then closes); `@state() _enableDuplicateStackUI = false` (set in `_applyPersistedSettings`, `_applyDisplaySettings`, Reset and `clearForNewDataset`; read by `getCurrentSettings`); `_applyDisplaySettings(patch: Partial<LegendDisplaySettings>): void` — per field: `maxVisibleValues` (numeric also `binCount`), `shapeSize` (`null` → `_clearShapeSize()`, else capped at 64, `saveShapeSize` and `shapeSize` when it differs), `paletteId` (normalised by type; categorical recolours through `applyPaletteColors`), `numericStrategy`, `reverseGradient`, `enableDuplicateStackUI`; then the dialog Save's tail once: `_updateLegendItems()`, `_syncLegendColorsToPersistence()`, `syncHiddenValues()`, `syncNumericAnnotationSettings()`, `updateConfig({ pointSize, enableDuplicateStackUI })`, `saveSettings()`, `_dispatchLegendStateChange()`; `settings-reset` → `_resetSettingsKeepingOpen()` (`_handleSettingsReset()` without closing, then focus to the checked swatch); `_renderSettingsPopover(label: string)`, rendered once as the last child of `.legend-container`, whose `settings` comes from live state at render (no draft; `shapeSize` is null while the dataset's default is in use; the same object is passed again while nothing in it changed, so a legend render does not re-render the closed popover) and whose `canReset` is "a record is stored for the annotation or a size was picked". Gone: `_dialogSettings`, `_showSettingsDialog`, `_handleCustomize`, `_handleSettingsSave`, `_handleSettingsClose`, `_handlePaletteChange`, `_handleDialogKeydown`, `_handleSettingsOverlayMouseDown/Up`, `_mouseDownOutsideSettings`, `_setupFocusTrap`, `_cleanupFocusTrap`, `_focusTrapCleanup`, `_onWindowKeydownCapture`, `_listenForEscape`, `_escapeListening`, `_renderSettingsDialog`, `@query('#legend-settings-dialog')`.
  - For Task 3.13: the popover's panel is a `dialog` named "Legend settings: {display name}" holding a radio group "Palette" (radios named by palette label, e.g. "Okabe-Ito", "Viridis"; the checked one `aria-checked="true"`), spinbuttons "Max legend items" / "Bins" and "Shape size" / "Point size", switches "Show duplicate counts and spread overlaps" and (numeric) "Reverse gradient", a combobox "Bin distribution" (numeric; option labels Linear, Quantile, Logarithmic), and a "Reset" button; it closes on Escape, an outside press, or a second press of the settings button, and keeps every applied edit.

**Tests:**

- `legend.settings.browser.test.ts`: "the settings button opens the popover under it, named Legend settings: Family, focus on the checked swatch, and closes it again"; "a palette pick recolours the rows, is stored at once and runs one legendUpdate"; "Max legend items 25 typed then Escape keeps 25 in storage" (Review Focus 3); "a burst of input runs one legendRebuild" (Review Focus 3); "Reset keeps the popover open with the defaults and focuses the checked swatch"; "a press on the Bin distribution select is inside the popover, and choosing an option keeps it open" (Review Focus 4); "the popover is topmost over a docked-structure stand-in"; "after closing, Escape reaches a document keydown listener and the legend adds no window keydown listener" (Review Focus 4). `_updateLegendItems` and `_rebuildLegendItems`, where `perfCounters.legendUpdate` and `legendRebuild` are incremented, are counted with spies.
- `legend.persistence-compat.test.ts` (Review Focus 2): Task 3.1's cases unchanged; plus "keeps a stored enableDuplicateStackUI: true across an unrelated save"; "a live palette change writes the same key and field set"; "a live numeric edit writes the same field set with numericSettings"; "a live edit keeps every field it did not touch".
- `legend.shape-size.test.ts`: the settings cases keep their assertions through `_applyDisplaySettings` (a detached legend) and `settings-change` (a mounted one); the migration cases pass untouched; `legend.dataset-hash.test.ts` passes untouched.
- `legend.numeric-settings.test.ts`: the moved cases, three of them restated for the popover (inferred numeric annotations render the popover as numeric; a palette edit is normalised to a gradient; numeric edits apply live).
- `legend.api.test.ts` and `legend.header.test.ts`: the settings button dispatches `legend-customize` once, opens the popover and closes it again.
- E2E: every project passes; the `numeric-binning` and `workbench-sidebar` tests that drove the old dialog are reported as fixme (skipped), and nothing else is skipped.

- [ ] **Step 1: Write the legend's settings browser test**

Create `packages/core/src/components/legend/legend.settings.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { COLOR_SCHEMES } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement, flatContains } from '../kit/focus';
import { pushLayer } from '../kit/layers';
import type { ProtspaceLegend } from './legend';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => {
  adoptTheme();
  // The layer stack installs its window listeners on first use: install them now, so the spy in
  // the last case sees only listeners the legend adds.
  pushLayer({ close() {}, elements: [] })();
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Counts the item passes: `perfCounters.legendUpdate` and `legendRebuild` are incremented once
 * each, at the start of these two methods, so the spies count what the perf budgets count.
 */
function spies(legend: ProtspaceLegend) {
  const internals = legend as unknown as {
    _updateLegendItems(): void;
    _rebuildLegendItems(): void;
  };
  return {
    update: vi.spyOn(internals, '_updateLegendItems'),
    rebuild: vi.spyOn(internals, '_rebuildLegendItems'),
  };
}

/** Until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
  await frame();
  await frame();
}

async function mount(data = categoricalData(TWELVE), annotation = 'family') {
  const mounted = await mountLegendWithScatterplot(data, annotation);
  await settle(mounted.legend);
  return mounted;
}

const popover = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;
const settingsButton = () => page.getByRole('button', { name: 'Legend settings', exact: true });
const dialog = (name: string | RegExp = /^Legend settings/) => page.getByRole('dialog', { name });

/** The stored legend record for `annotation`, found by its key's suffix. */
function stored(annotation = 'family'): Record<string, unknown> | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (key.startsWith('protspace:legend:') && key.endsWith(`:${annotation}`)) {
      return JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    }
  }
  return null;
}

async function openSettings(legend: ProtspaceLegend): Promise<void> {
  await userEvent.click(settingsButton());
  await settle(legend);
  await expect.element(dialog()).toBeVisible();
}

/** The element painted at a point, looking through every open shadow root. */
function deepElementFromPoint(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

describe('legend settings popover, mounted', () => {
  it('the settings button opens the popover under it, named Legend settings: Family, focus on the checked swatch, and closes it again', async () => {
    const { legend } = await mount();
    const customize = vi.fn();
    legend.addEventListener('legend-customize', customize);
    await openSettings(legend);

    await expect.element(dialog('Legend settings: Family')).toBeVisible();
    expect(customize).toHaveBeenCalledOnce();
    const button = settingsButton().element() as HTMLElement;
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = dialog().element() as HTMLElement;
    expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      button.getBoundingClientRect().bottom,
    );
    const focused = deepActiveElement();
    expect(focused?.getAttribute('role')).toBe('radio');
    expect(focused?.getAttribute('aria-checked')).toBe('true');
    expect(focused?.textContent?.trim()).toBe("Kelly's Colors");

    await userEvent.click(settingsButton());
    await settle(legend);
    expect(popover(legend).open).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(customize).toHaveBeenCalledOnce();
  });

  it('a palette pick recolours the rows, is stored at once and runs one legendUpdate', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    const { update, rebuild } = spies(legend);

    await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    await settle(legend);

    expect(update).toHaveBeenCalledOnce();
    expect(rebuild).not.toHaveBeenCalled();
    const okabe = COLOR_SCHEMES.okabeIto.map((color) => color.toLowerCase());
    const fills = [
      ...legend.shadowRoot!.querySelectorAll(
        '.legend-item:not(.legend-item-other) .legend-symbol path',
      ),
    ].map((path) => (path.getAttribute('fill') ?? '').toLowerCase());
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(okabe).toContain(fill);
    expect(stored()?.selectedPaletteId).toBe('okabeIto');
    expect(popover(legend).open).toBe(true);
    await expect
      .element(page.getByRole('radio', { name: 'Okabe-Ito' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('Max legend items 25 typed then Escape keeps 25 in storage', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('25');
    // Escape before the debounce ends: the pending value is applied, not dropped.
    await userEvent.keyboard('{Escape}');
    await settle(legend);

    expect(popover(legend).open).toBe(false);
    expect(legend.maxVisibleValues).toBe(25);
    expect(stored()?.maxVisibleValues).toBe(25);
    expect(legend.shadowRoot!.querySelector('.legend-item-other')).toBeNull();
    expect(legend.shadowRoot!.querySelectorAll('.legend-item')).toHaveLength(12);
  });

  it('a burst of input runs one legendRebuild', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    const { rebuild } = spies(legend);

    await userEvent.fill(page.getByRole('spinbutton', { name: 'Max legend items' }), '');
    await userEvent.keyboard('25');
    await expect.poll(() => stored()?.maxVisibleValues).toBe(25);
    await settle(legend);

    // One committed edit: one rebuild (`updated()` rebuilds once because maxVisibleValues changed).
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('Reset keeps the popover open with the defaults and focuses the checked swatch', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    await settle(legend);
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    await expect.element(reset).toBeEnabled();

    await userEvent.click(reset);
    await settle(legend);

    expect(popover(legend).open).toBe(true);
    await expect
      .element(page.getByRole('radio', { name: "Kelly's Colors" }))
      .toHaveAttribute('aria-checked', 'true');
    expect(stored()).toBeNull();
    await expect.element(reset).toBeDisabled();
    expect(deepActiveElement()?.textContent?.trim()).toBe("Kelly's Colors");
  });

  it('a press on the Bin distribution select is inside the popover, and choosing an option keeps it open', async () => {
    const { legend } = await mount(
      numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      'length',
    );
    expect(popover(legend).numeric).toBe(true);
    await openSettings(legend);
    const select = page.getByRole('combobox', { name: 'Bin distribution' });
    const native = select.element() as HTMLSelectElement;
    // The press a click on the select makes, which opens its picker: inside the panel.
    native.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    native.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await userEvent.selectOptions(select, 'linear');
    await settle(legend);

    expect(popover(legend).open).toBe(true);
    const numericSettings = stored('length')?.numericSettings as { strategy?: string } | undefined;
    expect(numericSettings?.strategy).toBe('linear');
  });

  it('the popover is topmost over a docked-structure stand-in', async () => {
    const { legend } = await mount();
    await openSettings(legend);
    // The docked structure's section sits at z-index 3 beside the sidebar (phase 2).
    const standIn = document.createElement('div');
    standIn.style.cssText = 'position: fixed; inset: 0; z-index: 3;';
    document.body.append(standIn);
    const panel = dialog().element() as HTMLElement;
    const box = panel.getBoundingClientRect();
    for (const [x, y] of [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + 12, box.top + 12],
      [box.right - 12, box.bottom - 12],
    ]) {
      expect(flatContains(panel, deepElementFromPoint(x, y)), `${x},${y}`).toBe(true);
    }
  });

  it('after closing, Escape reaches a document keydown listener and the legend adds no window keydown listener', async () => {
    const { legend } = await mount();
    const added = vi.spyOn(window, 'addEventListener');
    await openSettings(legend);
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(popover(legend).open).toBe(false);

    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    try {
      await userEvent.keyboard('{Escape}');
      expect(onKey).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
    const types = added.mock.calls.map(([type]) => type);
    expect(types).not.toContain('keydown');
    expect(types).not.toContain('mousedown');
    expect(types).not.toContain('mouseup');
  });
});
```

- [ ] **Step 2: Add the persistence cases**

In `packages/core/src/components/legend/legend.persistence-compat.test.ts`, add one import after `import type { ProtspaceLegend } from './legend';` (Task 3.1's file already imports `afterEach`, `generateDatasetHash`, the harness, `categoricalData`, `legacyLegendRecord`, `legendStorageKey`, `numericData`, `TWELVE`, and stubs `localStorage`):

```ts
import type { LegendDisplaySettings } from './types';
```

and append at the end of the file:

```ts
describe('legend settings applied live keep the stored format (Task 3.12)', () => {
  const FIELDS = [
    'maxVisibleValues',
    'shapeSize',
    'sortMode',
    'hiddenValues',
    'categories',
    'enableDuplicateStackUI',
    'selectedPaletteId',
  ];

  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
  });

  async function settleLegend(legend: ProtspaceLegend): Promise<void> {
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
  }

  function record(hash: string, annotation: string): Record<string, unknown> {
    return JSON.parse(localStorage.getItem(legendStorageKey(hash, annotation)) ?? 'null');
  }

  function legendKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith('protspace:legend:')) keys.push(key);
    }
    return keys;
  }

  /** What the settings popover dispatches for one edit; jsdom cannot open it, nor needs to. */
  function edit(legend: ProtspaceLegend, detail: Partial<LegendDisplaySettings>): void {
    legend
      .shadowRoot!.querySelector('protspace-legend-settings-popover')!
      .dispatchEvent(new CustomEvent('settings-change', { detail }));
  }

  function firstShownRow(legend: ProtspaceLegend): string {
    return legend
      .shadowRoot!.querySelector('.legend-item:not(.legend-item-other):not(.hidden)')!
      .getAttribute('data-value')!;
  }

  function clickRow(legend: ProtspaceLegend, value: string): void {
    legend
      .shadowRoot!.querySelector(`.legend-item[data-value="${value}"] .legend-item-main`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
  }

  async function mountWith(seed: Record<string, unknown> | null) {
    const data = categoricalData(TWELVE);
    const hash = generateDatasetHash(data);
    if (seed) localStorage.setItem(legendStorageKey(hash, 'family'), JSON.stringify(seed));
    const mounted = await mountLegendWithScatterplot(data, 'family');
    await settleLegend(mounted.legend);
    return { ...mounted, hash };
  }

  it('keeps a stored enableDuplicateStackUI: true across an unrelated save', async () => {
    const { legend, plot, hash } = await mountWith({
      ...legacyLegendRecord(),
      enableDuplicateStackUI: true,
    });
    expect((plot.config as Record<string, unknown>).enableDuplicateStackUI).toBe(true);

    const value = firstShownRow(legend);
    clickRow(legend, value);
    await settleLegend(legend);

    const saved = record(hash, 'family');
    expect(saved.hiddenValues).toContain(value);
    expect(saved.enableDuplicateStackUI).toBe(true);
    expect(
      legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!.settings
        .enableDuplicateStackUI,
    ).toBe(true);
  });

  it('a live palette change writes the same key and field set', async () => {
    const { legend, hash } = await mountWith(null);
    edit(legend, { paletteId: 'okabeIto' });
    await settleLegend(legend);

    expect(legendKeys()).toEqual([legendStorageKey(hash, 'family')]);
    const saved = record(hash, 'family');
    expect(Object.keys(saved)).toEqual(FIELDS);
    expect(saved.selectedPaletteId).toBe('okabeIto');
  });

  it('a live numeric edit writes the same field set with numericSettings', async () => {
    const data = numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const hash = generateDatasetHash(data);
    const { legend } = await mountLegendWithScatterplot(data, 'length');
    await settleLegend(legend);
    edit(legend, { numericStrategy: 'linear' });
    await settleLegend(legend);

    const saved = record(hash, 'length');
    expect(Object.keys(saved)).toEqual([...FIELDS, 'numericSettings']);
    expect((saved.numericSettings as { strategy: string }).strategy).toBe('linear');
  });

  it('a live edit keeps every field it did not touch', async () => {
    const { legend, hash } = await mountWith(legacyLegendRecord());
    // An unrelated save first, so the baseline is the record as this code writes it.
    const value = firstShownRow(legend);
    clickRow(legend, value);
    await settleLegend(legend);
    clickRow(legend, value);
    await settleLegend(legend);
    const baseline = record(hash, 'family');

    edit(legend, { enableDuplicateStackUI: true });
    await settleLegend(legend);

    expect(record(hash, 'family')).toEqual({ ...baseline, enableDuplicateStackUI: true });
  });
});
```

The helpers are local to the new `describe` and named apart from Task 3.1's module-level ones (`settle`, `mount`, `rows`, `toggle`, `stored`, `CATEGORICAL_FIELDS`); Task 3.1's cases are not touched.

- [ ] **Step 3: Move the other legend tests off the dialog**

1. `packages/core/src/components/legend/legend.shape-size.test.ts`:

   - In `type ShapeSizeLegend`, replace the three lines

     ```ts
       _dialogSettings: Record<string, unknown> & { shapeSize: number | null };
       _handleCustomize: () => Promise<void>;
       _handleSettingsSave: () => void;
     ```

     with

     ```ts
       _applyDisplaySettings: (patch: { shapeSize?: number | null }) => void;
     ```

   - Replace the `pick` helper inside `makeLegend` with:

     ```ts
       /** Commit a size from the settings popover's size field, null for an emptied one. */
       const pick = (shapeSize: number | null) => el._applyDisplaySettings({ shapeSize });
     ```

   - Replace the case `it('caps a host-set size when the settings dialog is saved', …)` with:

     ```ts
       it('caps a host-set size in the settings popover and when it is committed', async () => {
         const { el, pointSizes, switchTo } = makeLegend();
         switchTo('a');
         el.shapeSize = 200;
         // The popover renders only inside a connected legend.
         document.body.appendChild(el);
         try {
           await el.updateComplete;
           const popover = el.shadowRoot!.querySelector('protspace-legend-settings-popover')!;
           expect(popover.settings.shapeSize).toBe(64);
           popover.dispatchEvent(new CustomEvent('settings-change', { detail: { shapeSize: 640 } }));
           expect(el.shapeSize).toBe(64);
           expect(pointSizes.at(-1)).toBe(512);
         } finally {
           el.remove();
         }
       });
     ```

   - In `type ResettableLegend`, delete the line `_handleCustomize: () => Promise<void>;`.
   - Replace the case `it('names the default in the settings dialog and returns to it from an emptied field', …)` with:

     ```ts
       it('names the default in the settings popover and returns to it from an emptied field', async () => {
         const { legend, plot } = await mount(40_000);
         legend.applyShapeSize(10);
         await settle(legend);
         expect(pointSize(plot)).toBe(80);

         const popover = legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;
         await popover.updateComplete;
         expect(popover.settings.shapeSize).toBe(10);
         expect(popover.defaultShapeSize).toBe(4);
         const field = popover.shadowRoot!.querySelector<HTMLElement & { value: string; placeholder: string }>(
           '#shape-size-input',
         )!;
         expect(field.value).toBe('10');
         expect(field.placeholder).toBe('4');
         expect(popover.shadowRoot!.textContent).toContain('Default for this dataset: 4');

         popover.dispatchEvent(new CustomEvent('settings-change', { detail: { shapeSize: null } }));
         await settle(legend);

         expect(legend.shapeSize).toBe(4);
         expect(pointSize(plot)).toBe(32);
         expect(legend.pickedShapeSize).toBeUndefined();
         // The default is in use: the field is empty and its placeholder names it.
         expect(popover.settings.shapeSize).toBeNull();
       });
     ```

   The other cases (`pick(12)`, `pick(null)`, `_handleSettingsReset()`, the migrations) stay as they are.

2. Create `packages/core/src/components/legend/legend.numeric-settings.test.ts` with the dialog test's non-dialog cases (unchanged bodies except the three restated ones):

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  type NumericBinningStrategy,
} from '@protspace/utils';
import type { ProtspaceLegendSettingsPopover } from './legend-settings-popover';
import type { LegendDisplaySettings, LegendPersistedSettings, LegendSortMode } from './types';

// Import the component to register the custom element for integration coverage.
import './legend';

type LegendTestElement = HTMLElement & {
  selectedAnnotation: string;
  data?: {
    annotations?: Record<string, { kind?: 'categorical' | 'numeric'; values: string[] }>;
    protein_ids?: string[];
    numeric_annotation_data?: Record<string, Float64Array>;
  };
  proteinIds: string[];
  annotationData: { name: string; values: string[]; kind?: 'categorical' | 'numeric' };
  maxVisibleValues: number;
  updated: (changedProperties: Map<string, unknown>) => void;
  _renderSettingsPopover: (label: string) => unknown;
  _applyDisplaySettings: (patch: Partial<LegendDisplaySettings>) => void;
  _handleSettingsReset: () => void;
  _applyPersistedSettings: (settings: LegendPersistedSettings) => void;
  _syncNumericSettingsFromPersistence: () => void;
  _updateLegendItems: () => void;
  _dispatchLegendStateChange: () => void;
  _scatterplotController: {
    scatterplot: {
      data?: {
        protein_ids?: string[];
        annotations?: Record<string, { kind?: 'categorical' | 'numeric'; values: string[] }>;
        numeric_annotation_data?: Record<string, Float64Array>;
      };
      dispatchEvent?: (event: Event) => boolean;
    } | null;
    syncNumericAnnotationSettings: () => void;
  };
  _selectedPaletteId: string;
  _annotationSortModes: Record<string, LegendSortMode>;
  _numericSettingsByAnnotation: Record<
    string,
    {
      binCount: number;
      strategy: NumericBinningStrategy;
      paletteId: string;
      reverseGradient: boolean;
    }
  >;
  _persistenceController: {
    updateDatasetHash: (data: unknown) => boolean;
    callbacks: {
      getCurrentSettings: () => {
        sortMode: LegendSortMode;
        numericSettings?: {
          strategy: NumericBinningStrategy;
          reverseGradient?: boolean;
          manualOrderIds?: string[];
        };
      };
    };
  };
  getAllPersistedSettings: () => Record<string, LegendPersistedSettings>;
};

describe('ProtspaceLegend numeric settings inference', () => {
  function createLegend(): LegendTestElement {
    return document.createElement('protspace-legend') as LegendTestElement;
  }

  /** A detached legend on the inferred numeric annotation `score`, with its redraws stubbed. */
  function configureNumeric(el: LegendTestElement): void {
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._updateLegendItems = vi.fn();
    el._dispatchLegendStateChange = vi.fn();
  }

  function setSourceAnnotationKind(el: LegendTestElement, kind: 'categorical' | 'numeric'): void {
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          annotations: {
            score: { kind, values: [] },
          },
        },
      },
    });
  }

  it('renders the settings popover as numeric for inferred numeric annotations', () => {
    const el = createLegend();
    configureNumeric(el);
    const container = document.createElement('div');

    render(el._renderSettingsPopover('Score'), container);

    const popover = container.querySelector(
      'protspace-legend-settings-popover',
    ) as ProtspaceLegendSettingsPopover;
    expect(popover.numeric).toBe(true);
    expect(popover.settings.paletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(popover.annotationLabel).toBe('Score');
  });

  it('normalizes palette edits using the inferred numeric annotation type', () => {
    const el = createLegend();
    configureNumeric(el);

    el._applyDisplaySettings({ paletteId: 'kellys' });

    expect(el._selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(el._numericSettingsByAnnotation.score.paletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
  });

  it('applies numeric edits live for inferred numeric annotations', () => {
    const el = createLegend();
    configureNumeric(el);

    el._applyDisplaySettings({ maxVisibleValues: 5 });
    el._applyDisplaySettings({ numericStrategy: 'linear' });

    expect(el.maxVisibleValues).toBe(5);
    expect(el._numericSettingsByAnnotation.score).toMatchObject({
      binCount: 5,
      strategy: 'linear',
      paletteId: DEFAULT_NUMERIC_PALETTE_ID,
      reverseGradient: false,
    });
    expect(el._updateLegendItems).toHaveBeenCalledTimes(2);
  });

  it('resets to numeric defaults when the source annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._selectedPaletteId = 'kellys';
    el._updateLegendItems = vi.fn();
    setSourceAnnotationKind(el, 'numeric');

    el._handleSettingsReset();

    expect(el._annotationSortModes.score).toBe('alpha-asc');
    expect(el._selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(el._numericSettingsByAnnotation.score).toMatchObject({
      binCount: 10,
      strategy: DEFAULT_NUMERIC_STRATEGY,
      paletteId: DEFAULT_NUMERIC_PALETTE_ID,
      reverseGradient: false,
    });
  });

  it('emits numeric settings when the selected annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el.maxVisibleValues = 7;
    el._numericSettingsByAnnotation = {
      score: {
        binCount: 7,
        strategy: 'quantile',
        paletteId: DEFAULT_NUMERIC_PALETTE_ID,
        reverseGradient: true,
      },
    };

    const settings = el._persistenceController.callbacks.getCurrentSettings();

    expect(settings.numericSettings).toMatchObject({
      strategy: 'quantile',
      reverseGradient: true,
      manualOrderIds: undefined,
    });
  });

  it('normalizes persisted sort mode when the selected annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._annotationSortModes = { score: 'size-desc' };

    const settings = el._persistenceController.callbacks.getCurrentSettings();

    expect(settings.sortMode).toBe('alpha-asc');
  });

  it('ignores legacy persisted annotation type overrides and uses inferred numeric type', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };

    el._applyPersistedSettings({
      maxVisibleValues: 5,
      shapeSize: 12,
      sortMode: 'size-desc',
      hiddenValues: [],
      categories: {},
      enableDuplicateStackUI: false,
      selectedPaletteId: DEFAULT_NUMERIC_PALETTE_ID,
      annotationTypeOverride: 'string',
    } as LegendPersistedSettings & { annotationTypeOverride: string });

    expect(el._annotationSortModes.score).toBe('alpha-asc');
  });

  it('hashes source scatterplot data instead of the materialized override view', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.proteinIds = ['p1', 'p2'];
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
    };
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          protein_ids: ['p1', 'p2'],
          annotations: {
            score: { kind: 'numeric', values: [] },
          },
          numeric_annotation_data: {
            score: new Float64Array([1, 2]),
          },
        },
      },
    });
    const updateDatasetHash = vi
      .spyOn(el._persistenceController, 'updateDatasetHash')
      .mockReturnValue(false);

    el.updated(new Map([['data', null]]));

    expect(updateDatasetHash).toHaveBeenCalledWith({
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'numeric', values: [] },
      },
      numeric_annotation_data: {
        score: new Float64Array([1, 2]),
      },
    });
  });

  it('falls back to legend data when scatterplot source data is stale', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.proteinIds = ['p1', 'p2'];
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
    };
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          protein_ids: ['old-p1', 'old-p2'],
          annotations: {
            score: { kind: 'numeric', values: [] },
          },
          numeric_annotation_data: {
            score: new Float64Array([1, 2]),
          },
        },
      },
    });
    const updateDatasetHash = vi
      .spyOn(el._persistenceController, 'updateDatasetHash')
      .mockReturnValue(false);

    el.updated(new Map([['data', null]]));

    expect(updateDatasetHash).toHaveBeenCalledWith({
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
      numeric_annotation_data: undefined,
    });
  });

  it('does not manually redispatch data-change while syncing numeric settings', () => {
    const el = createLegend();
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'numeric', values: [] },
      },
      numeric_annotation_data: {
        score: new Float64Array([1, 2]),
      },
    };
    el._numericSettingsByAnnotation = {};
    el.getAllPersistedSettings = vi.fn().mockReturnValue({});
    const dispatchEvent = vi.fn().mockReturnValue(true);
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: el.data,
        dispatchEvent,
      },
    });
    const syncNumericAnnotationSettings = vi.spyOn(
      el._scatterplotController,
      'syncNumericAnnotationSettings',
    );

    el._syncNumericSettingsFromPersistence();

    expect(syncNumericAnnotationSettings).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
```

The dialog test's other cases are dropped with the dialog: "keeps By separation checked on reload" is Task 3.9's sort-menu case ("By separation appears only with scores or while active"); the six `shape size input` cases are covered by Task 3.11's popover cases (accepts 1 and up, caps at 64 and writes it back, an emptied field gives `null`, ignores 0, the default as placeholder and hint).

3. `packages/core/src/components/legend/legend-extract.test.ts`: delete the two cases `it('syncs settings dialog when it is open', …)` and `it('does not modify _dialogSettings when settings dialog is closed', …)` in `describe('_handleExtractAllFromOther', …)`.

4. `packages/core/src/components/legend/legend-helpers.test.ts`: delete the line `import { initializeAnnotationSortMode } from './legend-settings-dialog';` and the whole `describe('initializeAnnotationSortMode', …)` block.

5. `packages/core/src/components/legend/legend.api.test.ts` and `legend.header.test.ts`: each has one case that clicks the header's settings button and expects `legend-customize` (Task 3.1's API case "dispatches legend-customize from the settings button", whose button lookup Task 3.9 updated; the header case "the settings button is named Legend settings and dispatches legend-customize" of Task 3.9). jsdom has no popover API: call 3.6's `stubPopoverApi()` at module level in each file (import it from `./test-support/popover-stub`), then replace the body of each case with the following, keeping each case's title (add `vi` to the vitest import, and `categoricalData`, `TWELVE` and `mountLegendWithScatterplot` to the imports, where a file lacks them):

```ts
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    await legend.updateComplete;
    const customize = vi.fn();
    legend.addEventListener('legend-customize', customize);
    const button = legend.shadowRoot!.querySelector<HTMLElement & { label: string }>(
      '.settings-button',
    )!;
    expect(button.label).toBe('Legend settings');
    const popover = () => legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;

    button.click();
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    expect(customize).toHaveBeenCalledOnce();
    expect(popover().open).toBe(true);

    button.click();
    await legend.updateComplete;
    expect(popover().open).toBe(false);
    expect(customize).toHaveBeenCalledOnce();
```

The opened popover's layout, focus and layering are covered in the browser project by Step 1.

6. `packages/core/src/components/legend/legend.escape-order.browser.test.ts`: replace the case "the settings dialog still closes on Escape" (Task 3.8's "the Other dialog and the settings dialog still close on Escape", which Task 3.10 narrowed and renamed; if it still covers Other as well, keep that part and replace only the settings part) with this case (add `vi`, `userEvent`, `categoricalData`, `TWELVE` and `mountLegendWithScatterplot` to the imports where missing):

```ts
  it('the settings popover closes on Escape, and the next Escape passes through', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    await legend.updateComplete;
    const button = legend
      .shadowRoot!.querySelector('.settings-button')!
      .shadowRoot!.querySelector('button')!;
    button.focus();
    button.click();
    const popover = legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    await popover.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(popover.open).toBe(true);

    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    try {
      await userEvent.keyboard('{Escape}');
      await legend.updateComplete;
      expect(popover.open).toBe(false);
      expect(onKey).not.toHaveBeenCalled();
      await userEvent.keyboard('{Escape}');
      expect(onKey).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('keydown', onKey);
    }
  });
```

7. `packages/core/src/components/legend/legend.score-sync.test.ts`: delete the whole `describe('legend settings dialog: sort by separation', …)` block (it sets `_showSettingsDialog` and calls `_renderSettingsDialog()`, both gone after Step 6) and the `import { render } from 'lit';` line if nothing else in the file uses `render`. "By separation" lives in the sort menu now, pinned by Task 3.9's "By separation appears only with scores or while active".

- [ ] **Step 4: Run them to see them fail**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.persistence-compat.test.ts src/components/legend/legend.shape-size.test.ts src/components/legend/legend.numeric-settings.test.ts src/components/legend/legend.api.test.ts src/components/legend/legend.header.test.ts
pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.settings.browser.test.ts src/components/legend/legend.escape-order.browser.test.ts
```

The second line needs the sandbox disabled. Expected: FAIL. The new persistence cases, the two rewritten shape-size cases, the settings-button cases and every browser case fail with `Cannot read properties of null` (no `protspace-legend-settings-popover` in the legend's shadow root yet); the other shape-size cases fail with `el._applyDisplaySettings is not a function`; `legend.numeric-settings.test.ts` fails on `_renderSettingsPopover` and `_applyDisplaySettings` (not functions); Task 3.1's persistence cases still pass. `legend-settings-dialog.test.ts` still exists at this point and still passes; it is deleted in Step 7.

- [ ] **Step 5: Let the header's settings button report the popover**

In `packages/core/src/components/legend/legend-header.ts`, add to `interface LegendHeaderModel`:

```ts
  /** The settings popover is open: the settings button reports it (ps-popover does not). */
  settingsOpen?: boolean;
```

and on the settings button in `renderLegendHeader` (the `<ps-icon-button class="settings-button" icon="sliders-horizontal" label="Legend settings" size="sm" …>`), add two attributes:

```ts
          aria-haspopup="dialog"
          aria-expanded=${model.settingsOpen ? 'true' : 'false'}
```

`ps-icon-button` forwards both to its inner button (`hasPopup`, `expanded`).

- [ ] **Step 6: Apply settings live in the legend**

All edits are in `packages/core/src/components/legend/legend.ts`. Anchors are names; line numbers have moved since `7d45ab02`.

1. Imports. Delete the `// Dialogs` import of `renderSettingsDialog`, `initializeAnnotationSortMode`, `SettingsDialogState`, `SettingsDialogCallbacks` from `'./legend-settings-dialog'`, and `import { createFocusTrap } from './focus-trap';`. Add, beside the other child-element imports (`'../common/info-popover'`, `'./category-score-strip'`, Task 3.10's Other popover):

   ```ts
   import './legend-settings-popover';
   import type { ProtspaceLegendSettingsPopover } from './legend-settings-popover';
   ```

   Add `LegendDisplaySettings` to the `import type { … } from './types';` list, and `applyPaletteColors` and `normalizeCategoricalPaletteId` to the import from `'./legend-items-state'` (Task 3.5; add whichever is not imported yet). The code below also uses `DEFAULT_NUMERIC_STRATEGY`, `DEFAULT_NUMERIC_PALETTE_ID` and `normalizeNumericPaletteId` from `@protspace/utils` and `LEGEND_DEFAULTS`, `defaultShapeSize`, `calculatePointSize`, `LEGEND_EVENTS` from the legend's own modules; all are imported at `7d45ab02`, and if Task 3.5 dropped one from `legend.ts`, add it back.

2. State. Replace `@state() private _showSettingsDialog = false;` with:

   ```ts
     /** The settings button while the settings popover is open under it (design decision 12). */
     @state() private _settingsAnchor: HTMLElement | null = null;
     /**
      * "Show duplicate counts and spread overlaps" for the selected annotation. Live state: the
      * stored record reads it, so an unrelated save never writes false over a stored true.
      */
     @state() private _enableDuplicateStackUI = false;
   ```

   Delete the `// Settings dialog temporary state` block (`@state() private _dialogSettings: {…} = {…};`), the `@query('#legend-settings-dialog') private _settingsDialogEl?: HTMLDivElement;` pair, the `// Focus trap cleanup function` field `_focusTrapCleanup`, and `private _mouseDownOutsideSettings = false;` (and its comment line if it is now alone). Add, next to `@query('.legend-items')`:

   ```ts
     @query('protspace-legend-settings-popover')
     private _settingsPopover?: ProtspaceLegendSettingsPopover;
   ```

3. `getCurrentSettings` (in the `PersistenceController` options): replace `enableDuplicateStackUI: this._dialogSettings.enableDuplicateStackUI,` with `enableDuplicateStackUI: this._enableDuplicateStackUI,`.

4. `_applyPersistedSettings`: just before its `this._scatterplotController.updateConfig({ pointSize: calculatePointSize(this.shapeSize), enableDuplicateStackUI: … })` call, set the state from the same value the call passes today (`settings.enableDuplicateStackUI`, or the resolved record's field if Task 3.5 renamed it), and pass the state:

   ```ts
         this._enableDuplicateStackUI = settings.enableDuplicateStackUI === true;
         this._scatterplotController.updateConfig({
           pointSize: calculatePointSize(this.shapeSize),
           enableDuplicateStackUI: this._enableDuplicateStackUI,
         });
   ```

5. `clearForNewDataset`: as its first statement add

   ```ts
       // A value typed into the settings popover belongs to the dataset it was typed for.
       this._settingsPopover?.flush();
   ```

   and replace `this._showSettingsDialog = false;` with

   ```ts
       this._settingsAnchor = null;
       this._enableDuplicateStackUI = false;
   ```

6. `disconnectedCallback`: delete `this._listenForEscape(false);` (Task 3.4's replacement for the window `removeEventListener` call) and `this._cleanupFocusTrap();`. (The settings popover flushes itself when it disconnects with the legend; its `settings-change` listener is on the element, so the legend still receives it.)

7. Delete `_onWindowKeydownCapture` (after Tasks 3.8 and 3.10 it holds only the settings branch), Task 3.4's `_listenForEscape` method and `_escapeListening` field, `_cleanupFocusTrap`, `_setupFocusTrap`, and in `updated()` the `this._listenForEscape(this._showSettingsDialog);` call with its comment and the `// Handle settings dialog focus trapping` block (`if (changedProperties.has('_showSettingsDialog')) { … }`). After this step `grep -n "window.addEventListener\|window.removeEventListener" packages/core/src/components/legend/legend.ts` prints nothing.

8. `_handleExtractAllFromOther`: delete the `// Keep settings dialog in sync if it's open.` block (`if (this._showSettingsDialog) { this._dialogSettings = … }`), if Task 3.10 left it. The popover reads `maxVisibleValues` live.

9. Replace the `// Settings Dialog` section's methods `_handleCustomize`, `_handleSettingsSave`, `_handlePaletteChange`, `_handleSettingsClose`, `_handleSettingsOverlayMouseDown`, `_handleSettingsOverlayMouseUp` and `_handleDialogKeydown` (wherever they now sit; `_handleSymbolClick` and the colour handlers are not part of it), and `_renderSettingsDialog` in the rendering section, with:

   ```ts
     // ─────────────────────────────────────────────────────────────────
     // Settings Popover
     // ─────────────────────────────────────────────────────────────────

     /** The header's settings button: opens the settings popover under it, or closes it. */
     private _openSettings(anchor: HTMLElement): void {
       if (this._settingsAnchor) {
         this._closeSettings();
         return;
       }
       // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
       this._keyboard.clear();
       this._colorPicker.close();
       this._rowMenu = null;
       this._sortMenu = null;
       this._otherAnchor = null;
       this._settingsAnchor = anchor;
       this.dispatchEvent(new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }));
     }

     private _closeSettings(): void {
       // A value typed but not yet committed is kept, not lost with the popover.
       this._settingsPopover?.flush();
       this._settingsAnchor = null;
     }

     /**
      * Applies one edit from the settings popover at once (design decision 12), then runs the tail
      * the dialog's Save ran, once: the items, the plot and the stored record follow.
      */
     private _applyDisplaySettings(patch: Partial<LegendDisplaySettings>): void {
       const annotation = this.selectedAnnotation;
       const current = this._numericSettingsByAnnotation[annotation];
       const numeric = this._isCurrentAnnotationNumeric()
         ? {
             binCount: current?.binCount ?? this.maxVisibleValues,
             strategy: current?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
             paletteId: normalizeNumericPaletteId(current?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID),
             reverseGradient: current?.reverseGradient ?? false,
           }
         : null;

       if (patch.maxVisibleValues !== undefined) {
         this.maxVisibleValues = patch.maxVisibleValues;
         if (numeric) numeric.binCount = patch.maxVisibleValues;
       }
       if (patch.shapeSize !== undefined) {
         if (patch.shapeSize === null) {
           // An emptied size field returns the dataset to its default, as Reset does for the size.
           this._clearShapeSize();
         } else {
           const size = Math.min(patch.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
           if (size !== this.shapeSize) {
             this._persistenceController.saveShapeSize(size);
             this.shapeSize = size;
           }
         }
       }
       if (patch.paletteId !== undefined) {
         if (numeric) {
           numeric.paletteId = normalizeNumericPaletteId(patch.paletteId);
           this._selectedPaletteId = numeric.paletteId;
         } else {
           this._selectedPaletteId = normalizeCategoricalPaletteId(patch.paletteId);
           this._legendItems = applyPaletteColors(this._legendItems, this._selectedPaletteId);
           // Ahead of the update below, which keeps stored colours over palette ones.
           this._syncLegendColorsToPersistence();
         }
       }
       if (numeric && patch.numericStrategy !== undefined) numeric.strategy = patch.numericStrategy;
       if (numeric && patch.reverseGradient !== undefined) {
         numeric.reverseGradient = patch.reverseGradient;
       }
       if (patch.enableDuplicateStackUI !== undefined) {
         this._enableDuplicateStackUI = patch.enableDuplicateStackUI;
       }
       if (numeric) {
         this._numericSettingsByAnnotation = {
           ...this._numericSettingsByAnnotation,
           [annotation]: numeric,
         };
       }

       this._updateLegendItems();
       this._syncLegendColorsToPersistence();
       this._scatterplotController.syncHiddenValues();
       this._scatterplotController.syncNumericAnnotationSettings();
       this._scatterplotController.updateConfig({
         pointSize: calculatePointSize(this.shapeSize),
         enableDuplicateStackUI: this._enableDuplicateStackUI,
       });
       this._persistenceController.saveSettings();
       this._dispatchLegendStateChange();
       this.requestUpdate();
     }

     /** Reset from the popover: today's scope, and the popover stays open on the defaults. */
     private async _resetSettingsKeepingOpen(): Promise<void> {
       this._handleSettingsReset();
       await this.updateComplete;
       const popover = this._settingsPopover;
       if (!popover || this._settingsAnchor === null) return;
       await popover.updateComplete;
       // Reset disables itself once nothing is stored; focus moves to the palette, not the body.
       popover.focusFirst();
     }

     /** Something to reset: a record stored for the annotation, or a size picked for the dataset. */
     private _canResetSettings(): boolean {
       return (
         this._persistenceController.hasPersistedSettings() ||
         this._persistenceController.loadShapeSize() !== null
       );
     }

     /**
      * The size the size field shows: the live one, capped at the field's bound, or null while it
      * is the dataset's default, which the empty field stands for (its placeholder names it).
      */
     private _fieldShapeSize(): number | null {
       const isDefault =
         this._persistenceController.loadShapeSize() === null &&
         this._annotationShapeSize === null &&
         this.shapeSize === defaultShapeSize(this._datasetProteinCount);
       return isDefault ? null : Math.min(this.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
     }

     /** The settings last handed to the popover; passed again while nothing in them changed. */
     private _settingsView: LegendDisplaySettings | null = null;

     /**
      * The popover's settings, the same object while every field is unchanged: a new object on each
      * legend render would re-render the closed popover too (and a row focus move renders the legend).
      */
     private _settingsViewFor(isNumeric: boolean): LegendDisplaySettings {
       const next = this._displaySettings(isNumeric);
       const last = this._settingsView;
       const same =
         last !== null &&
         (Object.keys(next) as (keyof LegendDisplaySettings)[]).every((key) => last[key] === next[key]);
       if (same) return last;
       this._settingsView = next;
       return next;
     }

     /** The popover's view of the live state; there is no draft. */
     private _displaySettings(isNumeric: boolean): LegendDisplaySettings {
       const numeric = this._numericSettingsByAnnotation[this.selectedAnnotation];
       return {
         maxVisibleValues: this.maxVisibleValues,
         shapeSize: this._fieldShapeSize(),
         enableDuplicateStackUI: this._enableDuplicateStackUI,
         paletteId: isNumeric
           ? normalizeNumericPaletteId(numeric?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID)
           : normalizeCategoricalPaletteId(this._selectedPaletteId),
         numericStrategy: numeric?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
         reverseGradient: numeric?.reverseGradient ?? false,
       };
     }

     /** The settings popover, rendered once as the last child of `.legend-container`. */
     private _renderSettingsPopover(label: string) {
       const open = this._settingsAnchor !== null;
       const isNumeric = this._isCurrentAnnotationNumeric();
       return html`<protspace-legend-settings-popover
         .anchor=${this._settingsAnchor}
         .open=${open}
         .settings=${this._settingsViewFor(isNumeric)}
         .numeric=${isNumeric}
         .defaultShapeSize=${defaultShapeSize(this._datasetProteinCount)}
         .logBinningAvailable=${this.annotationData.numericMetadata?.logSupported ?? true}
         .canReset=${open && this._canResetSettings()}
         .annotationLabel=${label}
         @settings-change=${(event: CustomEvent<Partial<LegendDisplaySettings>>) =>
           this._applyDisplaySettings(event.detail)}
         @settings-reset=${() => void this._resetSettingsKeepingOpen()}
         @ps-open=${() => this._settingsPopover?.focusFirst()}
         @ps-close=${() => {
           this._settingsAnchor = null;
         }}
       ></protspace-legend-settings-popover>`;
     }
   ```

   If `legend.ts` still has a private `_normalizeCategoricalPaletteId` (Task 3.5 moves it to `normalizeCategoricalPaletteId`), use the imported function here and leave the rest as Task 3.5 left it.

10. `_handleSettingsReset`: delete `this._showSettingsDialog = false;`, and replace `enableDuplicateStackUI: false,` in its `updateConfig` call with `enableDuplicateStackUI: this._enableDuplicateStackUI,`, after adding, next to `this._hiddenValues = [];`:

    ```ts
        this._enableDuplicateStackUI = false;
    ```

    Nothing else in it changes: Reset still removes the record, clears pending categories, the dataset-wide size, the palette, the numeric settings, the manual order, the sort mode and the hidden values, and does not save.

11. `render()`: in the model passed to `renderLegendHeader`, add `settingsOpen: this._settingsAnchor !== null,`, and change the handler `onSettings` to `onSettings: (anchor) => this._openSettings(anchor),` (Task 3.9 wired it to `_handleCustomize()`). Delete `${this._renderSettingsDialog()}` (it sits after the closing `</div>` of `.legend-container`, next to where the Other dialog was), and add `${this._renderSettingsPopover(title)}` as the last child of `.legend-container`, right after Task 3.10's `<protspace-legend-other-popover …>`. `title` is the display name `render()` already computes for the header (`annotationLabel(activeName, activeAnnotation)`, or 'Legend').

After this step:

```bash
grep -n "_listenForEscape\|_escapeListening\|_dialogSettings\|_showSettingsDialog\|_handleCustomize\|_handleSettingsSave\|_handleSettingsClose\|_handlePaletteChange\|_handleDialogKeydown\|_handleSettingsOverlayMouse\|_mouseDownOutsideSettings\|FocusTrap\|focus-trap\|_onWindowKeydownCapture\|legend-settings-dialog\|_settingsDialogEl\|_renderSettingsDialog" packages/core/src
```

prints nothing.

- [ ] **Step 7: Delete the dialog, the focus trap and the modal styles**

```bash
git rm packages/core/src/components/legend/legend-settings-dialog.ts \
  packages/core/src/components/legend/legend-settings-dialog.test.ts \
  packages/core/src/components/legend/focus-trap.ts \
  packages/core/src/components/legend/focus-trap.test.ts \
  packages/core/src/components/legend/styles/modal.ts
```

In `packages/core/src/components/legend/legend.styles.ts`, delete `import { overlayMixins } from '../../styles/overlay-mixins';` and `import { modalStyles } from './styles/modal';`, and the entries `overlayMixins,` and `modalStyles,` in `legendStyles`. (`overlayMixins` stays in use by the scatterplot and the structure viewer, so `styles/overlay-mixins.ts` stays, and stays in LEGACY.)

In `packages/core/src/styles/style-lint.test.ts`, delete the LEGACY line `'../components/legend/styles/modal.ts',`.

- [ ] **Step 8: Run the legend tests**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend src/styles
pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend
```

The second line needs the sandbox disabled. Expected: PASS. New: 8 cases in `legend.settings.browser.test.ts`, 4 in the appended persistence `describe`, 10 in `legend.numeric-settings.test.ts`; gone: `legend-settings-dialog.test.ts` (17 cases, 10 of them moved), `focus-trap.test.ts`, the two extract cases, the four `initializeAnnotationSortMode` cases and the two score-sync dialog cases. `style-lint.test.ts` passes with LEGACY one shorter (the "still needs its exemption" test no longer looks for `modal.ts`).

- [ ] **Step 9: Park the e2e tests that drove the old dialog**

The dialog is gone, so the e2e tests that open it cannot pass until Task 3.13 moves them to the popover (the next commit). Park them for this one commit so the suite stays green. Find them:

```bash
grep -n "openLegendSettings(page)\|readLegendSettingsDialog\|updateLegendSettings\|clickDialogButton\|name: 'Legend settings'" apps/web/tests/numeric-binning.spec.ts apps/web/tests/workbench-sidebar.spec.ts
```

For each test whose body has a hit (calls inside the local helper functions themselves do not count), change its `test(` to `test.fixme(` and put this comment on the line above it:

```ts
// Task 3.13 moves this test to the settings popover.
```

Change nothing else in either file: the local helpers stay (the parked bodies still use them), and the e2e helper module is not touched in this task. Record the parked titles in the report.

- [ ] **Step 10: Update the developer docs**

1. `docs/developers/api/index.md`, Legend:
   - In the Events table, the `legend-customize` row's description becomes `Settings popover opened`.
   - Right after the Events table add:

     ```md
     Settings and the "Other" categories open as popovers (`protspace-legend-settings-popover`,
     `protspace-legend-other-popover`) in the top layer, inside the legend's shadow root. Settings
     apply as they are edited: a typed number commits 300 ms after the last keystroke, or at once on
     Enter or when the field loses focus. The parts `dialog-overlay` and `dialog-content` are gone.
     ```

     If Task 3.9 or 3.10 already wrote a note on the legend's parts or the Other popover there, merge this into it as one paragraph.
   - In Persistence, replace the sentence that starts "Reset in the settings dialog clears it" with: "Reset in the settings popover clears it, and every annotation's own size, so the default applies again; emptying the size field does the same for the size alone, at once."
2. `docs/developers/architecture.md`:
   - Replace the "Component-owned workflow UI" bullet in the Messaging Model with: "- Component-owned workflow UI: Components keep their own popovers and focused workflow controls. The legend settings and "Other" popovers stay inside the legend component."
   - In the Legend Component section, add to the list of legend modules (Task 3.5's list, after Task 3.10's Other popover entry if present): "- `legend-settings-popover.ts`: `protspace-legend-settings-popover`, the settings popover, with its palette swatches in `palette-swatches.ts`. Each edit is a `settings-change` the legend applies at once (`_applyDisplaySettings`) and stores under the same `protspace:legend:{datasetHash}:{annotation}` key; Reset is a `settings-reset`."
3. `docs/developers/messaging.md`: replace `- Example: legend settings dialog` with `- Example: legend settings popover` (the Other line is Task 3.10's).

- [ ] **Step 11: Run the suites this task touches**

```bash
pnpm --filter @protspace/core exec vitest --run
pnpm --filter @protspace/core build
pnpm --filter @protspace/app exec vitest --run
PLAYWRIGHT_PORT=8475 pnpm test:e2e
pnpm perf:counts
pnpm type-check
pnpm lint
pnpm exec knip
wc -l packages/core/src/components/legend/legend.ts
grep -n "window.addEventListener" packages/core/src/components/legend/legend.ts
```

The vitest, e2e and perf runs need the sandbox disabled. Expected: every suite passes; core's total changes by the counts in Step 8; the app unit count is unchanged; the e2e run reports the tests parked in Step 9 as fixme (skipped) and nothing else skipped beyond the suites' own conditional skips; `perf:counts` passes with `apps/web/tests/perf/budgets.json` unchanged (settings are not in its scenarios, and no rebuild or update was added to load, idle or annotation switch); `legend.ts` is smaller than before this task (record the count); the grep prints nothing. Known flake: the `numeric-binning` "hover point" test under full-suite load; re-run it alone once before investigating.

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/legend.settings.browser.test.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.persistence-compat.test.ts packages/core/src/components/legend/legend.shape-size.test.ts packages/core/src/components/legend/legend-extract.test.ts packages/core/src/components/legend/legend-helpers.test.ts packages/core/src/components/legend/legend.api.test.ts packages/core/src/components/legend/legend.header.test.ts packages/core/src/components/legend/legend.score-sync.test.ts packages/core/src/components/legend/legend.escape-order.browser.test.ts packages/core/src/styles/style-lint.test.ts apps/web/tests/workbench-sidebar.spec.ts apps/web/tests/numeric-binning.spec.ts docs/developers/api/index.md docs/developers/architecture.md docs/developers/messaging.md
git add packages/core/src/components/legend/legend.ts \
  packages/core/src/components/legend/legend-header.ts \
  packages/core/src/components/legend/legend.styles.ts \
  packages/core/src/components/legend/legend.settings.browser.test.ts \
  packages/core/src/components/legend/legend.numeric-settings.test.ts \
  packages/core/src/components/legend/legend.persistence-compat.test.ts \
  packages/core/src/components/legend/legend.shape-size.test.ts \
  packages/core/src/components/legend/legend-extract.test.ts \
  packages/core/src/components/legend/legend-helpers.test.ts \
  packages/core/src/components/legend/legend.api.test.ts \
  packages/core/src/components/legend/legend.header.test.ts \
  packages/core/src/components/legend/legend.score-sync.test.ts \
  packages/core/src/components/legend/legend.escape-order.browser.test.ts \
  packages/core/src/styles/style-lint.test.ts \
  apps/web/tests/workbench-sidebar.spec.ts apps/web/tests/numeric-binning.spec.ts \
  docs/developers/api/index.md docs/developers/architecture.md docs/developers/messaging.md
git status --short packages/core/src/components/legend
git commit -m "feat(core): apply legend settings live from a popover"
```

The five deletions are already staged by Step 7's `git rm`; `git status --short` shows them as `D` before the commit. (The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.13: Legend e2e on the settings popover

The e2e suites drive legend settings through the popover Task 3.12 mounted: new role-based helpers in `apps/web/tests/helpers/legend.ts`, a workbench test that settings and the sort apply live and survive a reload under the same `protspace:legend:` key, the sidebar's two settings tests against the popover panel, and `numeric-binning.spec.ts` rewritten from "staged, then saved" to "applied live; closing and Escape keep changes". Every test Task 3.12 parked with `test.fixme` runs again. No production code changes.

**Files:**

- Modify: `apps/web/tests/helpers/legend.ts`, `apps/web/tests/workbench-legend.spec.ts`, `apps/web/tests/workbench-sidebar.spec.ts` (the two legend-settings tests and `isTopmost`), `apps/web/tests/numeric-binning.spec.ts` (its local settings helpers go; every test that opened the dialog moves to live edits)

**Interfaces:**

- Consumes:
  - Task 3.12's settings popover: the header's settings button (role `button`, name "Legend settings", exact) toggles it; its panel is a `dialog` named "Legend settings: {display name}" (e.g. "Legend settings: Family", "Legend settings: Sequence length"); inside, a radio group "Palette" whose radios are named by palette label (categorical: Dark2, Kelly's Colors, Okabe-Ito, Set2, Tableau 10, Tol Bright; gradient: Batlow, Cividis, Inferno, Plasma, Viridis) with `aria-checked`, a categorical radio holding eight `.chip` spans and a gradient one a `.swatch-gradient`, spinbuttons "Max legend items" (numeric "Bins") and "Shape size" (numeric "Point size"), switches "Show duplicate counts and spread overlaps" and (numeric) "Reverse gradient" (`aria-checked`), a combobox "Bin distribution" (numeric; options Linear, Quantile, Logarithmic), and a "Reset" button, disabled when nothing is stored. Edits apply at once; a number commits 300 ms after the last keystroke, or at once on Enter or blur, and Escape right after typing keeps it. The panel's content is slotted into `protspace-legend-settings-popover`'s inner `ps-popover`, so controls are found from the element, not the panel. Escape, an outside press or the settings button closes it. Playwright's CSS and role locators pierce the legend's shadow roots.
  - Task 3.7: `legend(page)`, `legendRowValues(page)` (`apps/web/tests/helpers/legend.ts`). Task 3.9: `legendSortButton(page)`, `legendSortLabel(page)`, `setLegendSort(page, choice)`, `toggleLegendReverse(page)`.
  - `apps/web/tests/helpers/explore.ts`: `dismissTourIfPresent`, `importUserFile`, `openExplore`, `openImportMenu`, `selectAnnotation`, `waitForExploreDataLoad`, `waitForPersistedExploreDataset`, `waitForProteinCount`; `apps/web/tests/helpers/fixtures.ts`: `TOXPROT_5181_FIXTURE`; `apps/web/tests/helpers/workbench.ts`: `collapseSidebar`, `expandSidebar` (the sidebar spec's own imports).
- Produces (`apps/web/tests/helpers/legend.ts`): `legendSettingsDialog(page): Locator` (the panel: role `dialog`, name `/^Legend settings/`; for visibility and boxes); `openLegendSettings(page): Promise<Locator>` (opens it if closed and returns the `protspace-legend-settings-popover` element, the scope for its controls); `setLegendSetting(page, field: 'Max legend items' | 'Bins' | 'Shape size' | 'Point size', value: string): Promise<void>` (fills and blurs, then waits for the stored state to change; the value must differ from the field's); `pickLegendPalette(page, label: string): Promise<void>`; `setBinDistribution(page, label: 'Linear' | 'Quantile' | 'Logarithmic'): Promise<void>`; `toggleLegendSetting(page, name: 'Show duplicate counts and spread overlaps' | 'Reverse gradient'): Promise<void>`; `resetLegendSettings(page): Promise<void>`; `closeLegendSettings(page): Promise<void>` (Escape); `readLegendSettings(page): Promise<{ palette: string; maxItems: string; size: string; distribution?: string; reverseGradient?: boolean }>` (opens it if needed; `palette` is the checked swatch's label, `distribution` the option's label).

**Tests:**

- `workbench-legend.spec.ts`: "settings and the sort apply live and survive a reload under the same protspace:legend: key" (a user import of TOXPROT, which a reload restores with its local settings; the demo is cleared on every load).
- `workbench-sidebar.spec.ts`: "the legend settings popover is fully visible after collapse and expand" and "with the sidebar open, the legend settings popover and the Import and Export panels sit over the shell" pass against the popover panel.
- `numeric-binning.spec.ts` full project passes with the rewritten tests: staged-then-saved becomes applied live; closing and Escape keep changes; no `test.fixme` is left.

Anchors below are function and test names; Tasks 3.6–3.12 moved lines in these specs.

- [ ] **Step 1: Add the settings helpers**

Append to `apps/web/tests/helpers/legend.ts` (add `expect` to its `@playwright/test` import if it lacks it; `legend(page)` is Task 3.7's):

```ts
/** The settings popover's panel, a dialog named "Legend settings: {display name}". */
export function legendSettingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Legend settings/ });
}

/**
 * Opens the legend settings popover unless it is open, and returns its element: the scope for its
 * controls. The panel's content is slotted, so a locator scoped to the panel would not find it.
 */
export async function openLegendSettings(page: Page): Promise<Locator> {
  if (!(await legendSettingsDialog(page).isVisible())) {
    await legend(page).getByRole('button', { name: 'Legend settings', exact: true }).click();
  }
  await expect(legendSettingsDialog(page)).toBeVisible();
  return legend(page).locator('protspace-legend-settings-popover');
}

/** Every `protspace:` entry in localStorage, to wait for an edit to be stored. */
function storedState(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('protspace:'))
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  );
}

/**
 * Types `value` into a number field and leaves it, then waits until the edit is stored. The value
 * must differ from the field's, or nothing is stored to wait for.
 */
export async function setLegendSetting(
  page: Page,
  field: 'Max legend items' | 'Bins' | 'Shape size' | 'Point size',
  value: string,
): Promise<void> {
  const settings = await openLegendSettings(page);
  const before = await storedState(page);
  const input = settings.getByRole('spinbutton', { name: field, exact: true });
  await input.fill(value);
  await input.blur();
  await expect.poll(() => storedState(page)).not.toBe(before);
}

/** Picks a palette swatch by its label, e.g. "Okabe-Ito" or "Viridis". */
export async function pickLegendPalette(page: Page, label: string): Promise<void> {
  const settings = await openLegendSettings(page);
  const swatch = settings.getByRole('radio', { name: label, exact: true });
  await swatch.click();
  await expect(swatch).toBeChecked();
}

export async function setBinDistribution(
  page: Page,
  label: 'Linear' | 'Quantile' | 'Logarithmic',
): Promise<void> {
  const settings = await openLegendSettings(page);
  await settings.getByRole('combobox', { name: 'Bin distribution' }).selectOption({ label });
}

export async function toggleLegendSetting(
  page: Page,
  name: 'Show duplicate counts and spread overlaps' | 'Reverse gradient',
): Promise<void> {
  const settings = await openLegendSettings(page);
  const control = settings.getByRole('switch', { name, exact: true });
  const checked = await control.getAttribute('aria-checked');
  await control.click();
  await expect(control).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
}

/** Reset; the popover stays open, and Reset disables itself once nothing is stored. */
export async function resetLegendSettings(page: Page): Promise<void> {
  const settings = await openLegendSettings(page);
  const reset = settings.getByRole('button', { name: 'Reset', exact: true });
  await reset.click();
  await expect(reset).toBeDisabled();
}

export async function closeLegendSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(legendSettingsDialog(page)).toBeHidden();
}

/** What the popover shows: the checked palette's label, the two fields and the numeric controls. */
export async function readLegendSettings(page: Page): Promise<{
  palette: string;
  maxItems: string;
  size: string;
  distribution?: string;
  reverseGradient?: boolean;
}> {
  const settings = await openLegendSettings(page);
  const fields = settings.getByRole('spinbutton');
  const result: {
    palette: string;
    maxItems: string;
    size: string;
    distribution?: string;
    reverseGradient?: boolean;
  } = {
    palette: ((await settings.getByRole('radio', { checked: true }).textContent()) ?? '').trim(),
    maxItems: await fields.nth(0).inputValue(),
    size: await fields.nth(1).inputValue(),
  };
  const distribution = settings.getByRole('combobox', { name: 'Bin distribution' });
  if ((await distribution.count()) > 0) {
    result.distribution = await distribution.evaluate(
      (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent?.trim() ?? '',
    );
  }
  const reverse = settings.getByRole('switch', { name: 'Reverse gradient', exact: true });
  if ((await reverse.count()) > 0) {
    result.reverseGradient = (await reverse.getAttribute('aria-checked')) === 'true';
  }
  return result;
}
```

- [ ] **Step 2: Rewrite the specs that used the dialog**

Task 3.12 parked every test that drove the old dialog in `numeric-binning.spec.ts` and `workbench-sidebar.spec.ts`: turn each `test.fixme(` back into `test(` and delete its `// Task 3.13 moves this test to the settings popover.` comment, then apply the edits below (a test replaced whole loses its `fixme` with it).

1. `apps/web/tests/workbench-legend.spec.ts`: add this test (merge the imports into the file's existing ones):

```ts
import {
  dismissTourIfPresent,
  importUserFile,
  openExplore,
  openImportMenu,
  selectAnnotation,
  waitForExploreDataLoad,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';
import {
  closeLegendSettings,
  legendRowValues,
  legendSettingsDialog,
  openLegendSettings,
  pickLegendPalette,
  legendSortLabel,
  readLegendSettings,
  setLegendSetting,
  setLegendSort,
} from './helpers/legend';

test('settings and the sort apply live and survive a reload under the same protspace:legend: key', async ({
  page,
}) => {
  // A user import without bundle settings: a reload restores it from OPFS and keeps local
  // settings (the demo would clear them on every load).
  await openExplore(page);
  await openImportMenu(page);
  await importUserFile(page, TOXPROT_5181_FIXTURE);
  await waitForProteinCount(page, 5181);
  await waitForPersistedExploreDataset(page);
  await selectAnnotation(page, 'phylum');

  await openLegendSettings(page);
  await pickLegendPalette(page, 'Okabe-Ito');
  await setLegendSetting(page, 'Max legend items', '5');
  // Applied while the popover is still open: there is no Save.
  await expect(legendSettingsDialog(page)).toBeVisible();
  expect((await legendRowValues(page)).filter((value) => value !== 'Other').length).toBeLessThanOrEqual(5);
  await closeLegendSettings(page);
  // The sort is stored in the same record (a demo reload would clear it: the user import keeps it).
  await setLegendSort(page, 'By name');

  const records = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => /^protspace:legend:[^:]+:phylum$/.test(key))
          .map((key) => [key, JSON.parse(localStorage.getItem(key) ?? 'null')]),
      ),
    );
  const before = await records();
  const keys = Object.keys(before);
  expect(keys).toHaveLength(1);
  expect(Object.keys(before[keys[0]])).toEqual([
    'maxVisibleValues',
    'shapeSize',
    'sortMode',
    'hiddenValues',
    'categories',
    'enableDuplicateStackUI',
    'selectedPaletteId',
  ]);
  expect(before[keys[0]]).toMatchObject({ maxVisibleValues: 5, selectedPaletteId: 'okabeIto' });

  await page.reload();
  await waitForExploreDataLoad(page, { proteinCount: 5181 });
  await dismissTourIfPresent(page);
  await selectAnnotation(page, 'phylum');

  expect(Object.keys(await records())).toEqual(keys);
  expect(await legendSortLabel(page)).toBe('By name, A to Z');
  expect(await readLegendSettings(page)).toMatchObject({ palette: 'Okabe-Ito', maxItems: '5' });
  await closeLegendSettings(page);
});
```

2. `apps/web/tests/workbench-sidebar.spec.ts`:

   - Add `import { closeLegendSettings, legendSettingsDialog, openLegendSettings } from './helpers/legend';`.
   - Replace `function isTopmost` (with its doc comment) by this version, which follows slots on the way back up (a popover's content is slotted into its panel; for the Import and Export panels it returns what it returned before):

     ```ts
     /**
      * Whether `locator`'s element is the topmost thing painted at its centre and across its box (a 3×3
      * grid 8 px inside its edges), looking through every shadow root on the way down. A popover's
      * content is slotted into its panel, so the walk back up follows slots.
      */
     function isTopmost(locator: Locator): Promise<boolean> {
       return locator.evaluate((element) => {
         const box = element.getBoundingClientRect();
         const xs = [box.left + 8, box.left + box.width / 2, box.right - 8];
         const ys = [box.top + 8, box.top + box.height / 2, box.bottom - 8];
         const within = (start: Node | null): boolean => {
           for (let node = start; node; ) {
             if (node === element) return true;
             node = (node as Element).assignedSlot ?? node.parentNode ?? (node as ShadowRoot).host ?? null;
           }
           return false;
         };
         return xs.every((x) =>
           ys.every((y) => {
             let hit: Element | null = document.elementFromPoint(x, y);
             while (hit?.shadowRoot) {
               const inner = hit.shadowRoot.elementFromPoint(x, y);
               if (!inner || inner === hit) break;
               hit = inner;
             }
             return within(hit);
           }),
         );
       });
     }
     ```

   - Replace the test `'the legend settings dialog is fully visible after collapse and expand'` with:

     ```ts
     test('the legend settings popover is fully visible after collapse and expand', async ({
       page,
     }) => {
       await openExplore(page);
       await collapseSidebar(page);
       await expandSidebar(page);

       await openLegendSettings(page);
       const dialog = legendSettingsDialog(page);
       const box = (await dialog.boundingBox())!;
       const viewport = page.viewportSize()!;
       // In the top layer: inside the viewport, and nothing of the shell paints over it.
       expect(box.x).toBeGreaterThanOrEqual(0);
       expect(box.y).toBeGreaterThanOrEqual(0);
       expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
       expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
       expect(await isTopmost(dialog)).toBe(true);
       await closeLegendSettings(page);
     });
     ```

   - Rename the test `'with the sidebar open, a legend dialog and the Import and Export panels sit over the shell'` to `'with the sidebar open, the legend settings popover and the Import and Export panels sit over the shell'`, and replace its legend part, from `await page.locator('protspace-legend').getByRole('button', { name: 'Legend settings' }).click();` through `await expect(overlay).toBeHidden();`, with:

     ```ts
       await openLegendSettings(page);
       const dialog = legendSettingsDialog(page);
       const viewport = page.viewportSize()!;
       const dialogBox = (await dialog.boundingBox())!;
       expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
       expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
       // Topmost over the shell: the rail, the edge and the docked structure stay beneath it.
       expect(await isTopmost(dialog)).toBe(true);
       await closeLegendSettings(page);
     ```

     The Import and Export loop after it is unchanged (it reads `viewport`).

3. `apps/web/tests/numeric-binning.spec.ts`:

   - Imports: add to the import from `'./helpers/legend'` (create the line if the file has none) the names this file now uses: `closeLegendSettings`, `legendSettingsDialog`, `openLegendSettings`, `pickLegendPalette`, `readLegendSettings`, `resetLegendSettings`, `setBinDistribution`, `setLegendSetting`, `toggleLegendSetting`, and keep Task 3.9's `legendSortButton`, `legendSortLabel`, `setLegendSort` and `toggleLegendReverse` (the replacements below use `legendSortButton` and `legendSortLabel`; drop `setLegendSort` only if no call to it remains).
   - Delete the local helpers `readNumericPreview`, `readNumericPreviewChrome`, `readPalettePreviewChrome`, `openLegendSettings`, `readLegendSettingsDialog`, `readCategoricalPreviewRows`, `updateLegendSettings`, `clickDialogButton`, `waitForDialogClosed`, and `setSortMode` if Task 3.9 left it.
   - Add, after `getNumericState`:

     ```ts
     /** Viridis, linear bins and `bins` of them, applied live; then the popover closes. */
     async function rebinLength(page: Page, bins: string): Promise<void> {
       await pickLegendPalette(page, 'Viridis');
       await setBinDistribution(page, 'Linear');
       await setLegendSetting(page, 'Bins', bins);
       await closeLegendSettings(page);
     }
     ```

   - Every remaining read of the sort order through the dialog (the block `await openLegendSettings(page); const dialog = await readLegendSettingsDialog(page); expect(dialog.selectedSortingLabel).toBe(X); await clickDialogButton(page, 'Cancel'); await waitForDialogClosed(page);`, also with the names `reorderedDialog`) becomes one line, by `X`: `'By category size'` → `expect(await legendSortLabel(page)).toMatch(/^By count/);`, `'Manual order'` → `expect(await legendSortLabel(page)).toMatch(/^Your order/);`, `'By numeric value'` → `expect(await legendSortLabel(page)).toMatch(/^By value/);`. Every remaining `await openLegendSettings(page); await setSortMode(page, A, 'alpha'); await clickDialogButton(page, 'Save'); await waitForDialogClosed(page);` becomes `await setLegendSort(page, 'By name');` for `A = 'order'` and `await setLegendSort(page, 'By value');` for `A = 'length'`. (Task 3.9 may already have converted some; leave converted ones as they are.)
   - Every remaining `await openLegendSettings(page); await updateLegendSettings(page, { maxVisibleValues: N, paletteId: 'viridis', strategy: 'linear' }); await clickDialogButton(page, 'Save'); await waitForDialogClosed(page);` becomes `await rebinLength(page, 'N');` (in "linear numeric bins can realize fewer values than requested" N is 20, elsewhere 5). In "topology-changing numeric rebins drop stale manual order on reload", the read right after it becomes `await expect.poll(async () => (await readLegendDisplay(page)).items.length).toBeLessThan(manualLegend.items.length);`; in "linear numeric bins can realize fewer values than requested", `const realizedState = await getNumericState(page); expect(realizedState.binCount).toBeLessThan(20);` becomes `await expect.poll(async () => (await getNumericState(page)).binCount).toBeLessThan(20);`.
   - In "real phosphatase bundle rebins length to five bins without leaving the UI stuck", replace the block from `await openLegendSettings(page);` through `await waitForDialogClosed(page);` (the edit and Save, with `const startedAt = Date.now();` between them) with

     ```ts
       const startedAt = Date.now();
       await rebinLength(page, '5');
     ```

     and its last block (reopen, `reopenedDialog.distribution`, Cancel, wait) with

     ```ts
       expect((await readLegendSettings(page)).distribution).toBe('Linear');
       await closeLegendSettings(page);
     ```

   - Replace these tests, each found by its title, with the code below: "numeric settings are staged, saved, and restored on re-import", "reset restores numeric settings defaults and clears saved state on re-import", "closing the settings dialog discards staged numeric changes like cancel", "pressing escape closes the settings dialog and discards staged numeric changes", "changing only max legend items recalculates numeric colors for the same gradient palette", "reversing the numeric gradient swaps the low and high bin colors", "numeric palette preview stays compact even for large max legend item counts", "numeric gradient preview uses the same rendered chrome as categorical swatches", "categorical annotations do not expose gradient palettes or gradient previews", and the pair "categorical palette preview keeps eleven swatches on the first row at desktop width" / "categorical palette preview wraps cleanly at a narrower desktop width" (one test replaces both). Delete "numeric palette preview remains bounded when hovered": swatches have no hover growth.

```ts
test('numeric settings apply live and are restored on re-import', async ({ page }) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });
  const bundleBytes = Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH));
  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');
  await expect
    .poll(async () => {
      const state = await getNumericState(page);
      return { rawKind: state.rawKind ?? null, hasBins: (state.binCount ?? 0) > 0 };
    })
    .toEqual({ rawKind: 'numeric', hasBins: true });

  // Task 3.9's check: the order is the header's, not a settings section.
  expect(await legendSortLabel(page)).toBe('By value, low to high');
  const settings = await openLegendSettings(page);
  await expect(
    page.getByRole('dialog', { name: 'Legend settings: Sequence length' }),
  ).toBeVisible();
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await expect(settings.getByRole('spinbutton', { name: 'Bins', exact: true })).toBeVisible();
  await expect(settings.getByRole('spinbutton', { name: 'Point size', exact: true })).toBeVisible();
  expect(
    await settings
      .getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.textContent?.trim() ?? '')),
  ).toEqual(['Batlow', 'Cividis', 'Inferno', 'Plasma', 'Viridis']);
  expect(
    await settings
      .getByRole('combobox', { name: 'Bin distribution' })
      .evaluate((select: HTMLSelectElement) => select.querySelector<HTMLOptionElement>('option[value="logarithmic"]')?.disabled),
  ).toBe(false);
  // No Save, no Cancel, and the order lives in the header's sort menu now.
  await expect(settings.getByRole('button', { name: /^(Save|Cancel)$/ })).toHaveCount(0);
  await expect(settings.getByText('Bin order')).toHaveCount(0);
  await expect(settings.getByText('Include shapes')).toHaveCount(0);

  await pickLegendPalette(page, 'Plasma');
  await setLegendSetting(page, 'Bins', '5');
  // Applied with the popover still open.
  await expect(legendSettingsDialog(page)).toBeVisible();
  await expect
    .poll(() => getNumericState(page))
    .toMatchObject({ strategy: 'quantile', binCount: 5 });
  const state = await getNumericState(page);
  expect(state.colors[0]).toBe('#0D0887');
  expect(state.colors.at(-1)).toBe('#F0F921');
  await closeLegendSettings(page);

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await expect
    .poll(() => getNumericState(page))
    .toMatchObject({ strategy: 'quantile', binCount: 5 });
});

test('reset restores numeric settings defaults and clears saved state on re-import', async ({
  page,
}) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });
  const bundleBytes = Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH));
  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');

  await pickLegendPalette(page, 'Plasma');
  await toggleLegendSetting(page, 'Reverse gradient');
  await setLegendSetting(page, 'Bins', '5');
  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#F0F921');
  let state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#0D0887');

  await resetLegendSettings(page);
  // Reset keeps the popover open, showing the defaults.
  await expect(legendSettingsDialog(page)).toBeVisible();
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#011959');
  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#FACCFA');
  await closeLegendSettings(page);

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');

  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await closeLegendSettings(page);
});

test('closing the settings popover keeps the numeric changes it applied', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.colors[0]).toBe('#011959');

  await pickLegendPalette(page, 'Plasma');
  await toggleLegendSetting(page, 'Reverse gradient');
  await setLegendSetting(page, 'Bins', '5');
  // The settings button closes the popover it opened.
  await page
    .locator('protspace-legend')
    .getByRole('button', { name: 'Legend settings', exact: true })
    .click();
  await expect(legendSettingsDialog(page)).toBeHidden();

  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#F0F921');
  const state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#0D0887');
});

test('Escape closes the settings popover and keeps a value typed just before it', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const settings = await openLegendSettings(page);
  // No blur: Escape right after typing must still apply the pending value.
  await settings.getByRole('spinbutton', { name: 'Bins', exact: true }).fill('5');
  await page.keyboard.press('Escape');
  await expect(legendSettingsDialog(page)).toBeHidden();

  await expect.poll(async () => (await getNumericState(page)).binCount).toBe(5);
  expect((await readLegendSettings(page)).maxItems).toBe('5');
  await closeLegendSettings(page);
});

test('changing only max legend items recalculates numeric colors for the same gradient palette', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.binCount).toBeGreaterThan(0);
  expect(initialState.binCount).toBeLessThanOrEqual(10);
  expect(initialState.colors[0]).toBe('#011959');
  expect(initialState.colors.at(-1)).toBe('#FACCFA');

  await pickLegendPalette(page, 'Cividis');
  await setBinDistribution(page, 'Linear');
  await setLegendSetting(page, 'Bins', '5');
  await closeLegendSettings(page);

  await expect.poll(async () => (await getNumericState(page)).binCount).toBe(5);
  const savedState = await getNumericState(page);
  expect(savedState.colors).not.toEqual(initialState.colors);
  expect(savedState.colors[0]).toBe('#00224E');
  expect(savedState.colors.at(-1)).toBe('#FEE838');
});

test('reversing the numeric gradient swaps the low and high bin colors', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.colors.length).toBeGreaterThan(1);
  expect(initialState.colors[0]).toBe('#011959');
  expect(initialState.colors.at(-1)).toBe('#FACCFA');
  expect((await readLegendSettings(page)).reverseGradient).toBe(false);

  await pickLegendPalette(page, 'Cividis');
  await setBinDistribution(page, 'Linear');
  await toggleLegendSetting(page, 'Reverse gradient');
  await closeLegendSettings(page);

  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#FEE838');
  expect((await getNumericState(page)).colors.at(-1)).toBe('#00224E');
  expect((await readLegendSettings(page)).reverseGradient).toBe(true);
  await closeLegendSettings(page);
});

test('numeric palette swatches stay inside the settings popover with 100 bins', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await setLegendSetting(page, 'Bins', '100');
  await setBinDistribution(page, 'Logarithmic');

  const settings = await openLegendSettings(page);
  const panel = (await legendSettingsDialog(page).boundingBox())!;
  const swatches = settings.getByRole('radio');
  await expect(swatches).toHaveCount(5);
  for (const swatch of await swatches.all()) {
    const box = (await swatch.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    await expect(swatch.locator('.swatch-gradient')).toHaveCount(1);
  }
  expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await closeLegendSettings(page);
});

test('numeric and categorical palette swatches share the same chrome', async ({ page }) => {
  await loadDataset(page);
  const chrome = async () => {
    const settings = await openLegendSettings(page);
    const result = await settings
      .getByRole('radio')
      .first()
      .evaluate((radio) => {
        const strip = radio.querySelector('.swatch-chips, .swatch-gradient') as HTMLElement;
        return {
          swatchRadius: getComputedStyle(radio).borderRadius,
          stripRadius: getComputedStyle(strip).borderRadius,
          stripHeight: strip.getBoundingClientRect().height,
        };
      });
    await closeLegendSettings(page);
    return result;
  };

  await selectAnnotation(page, 'family');
  const categorical = await chrome();
  await selectAnnotation(page, 'length');
  const numeric = await chrome();
  expect(numeric).toEqual(categorical);
});

test('categorical annotations do not expose gradient palettes or gradient controls', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  // Task 3.9's check: the sort button is there, and the order is categorical.
  await expect(legendSortButton(page)).toBeVisible();
  expect(await legendSortLabel(page)).not.toMatch(/^By value/);
  const settings = await openLegendSettings(page);

  await expect(page.getByRole('dialog', { name: 'Legend settings: Family' })).toBeVisible();
  expect(
    await settings
      .getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.textContent?.trim() ?? '')),
  ).toEqual(['Dark2', "Kelly's Colors", 'Okabe-Ito', 'Set2', 'Tableau 10', 'Tol Bright']);
  await expect(settings.locator('.swatch-gradient')).toHaveCount(0);
  await expect(settings.getByRole('combobox', { name: 'Bin distribution' })).toHaveCount(0);
  await expect(settings.getByRole('switch', { name: 'Reverse gradient' })).toHaveCount(0);
  await expect(
    settings.getByRole('spinbutton', { name: 'Max legend items', exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole('spinbutton', { name: 'Shape size', exact: true })).toBeVisible();
  await closeLegendSettings(page);
});

test('categorical palette swatches fit the settings popover at 1280 and 1100 px wide', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  for (const width of [1280, 1100]) {
    await page.setViewportSize({ width, height: 720 });
    const settings = await openLegendSettings(page);
    const panel = (await legendSettingsDialog(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    const swatches = settings.getByRole('radio');
    await expect(swatches).toHaveCount(6);
    for (const swatch of await swatches.all()) {
      const box = (await swatch.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      await expect(swatch.locator('.chip')).toHaveCount(8);
    }
    await closeLegendSettings(page);
  }
});
```

After the edits:

```bash
grep -n "test.fixme\|Task 3.13 moves\|readLegendSettingsDialog\|clickDialogButton\|waitForDialogClosed\|updateLegendSettings\|readNumericPreview\|readPalettePreviewChrome\|readCategoricalPreviewRows\|setSortMode\|legend-settings-dialog\|modal-overlay" apps/web/tests/numeric-binning.spec.ts apps/web/tests/workbench-sidebar.spec.ts
```

prints nothing.

- [ ] **Step 3: Run the e2e specs**

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=numeric-binning --project=workbench
PLAYWRIGHT_PORT=8475 pnpm test:e2e
pnpm type-check
pnpm lint
pnpm exec knip
grep -rn "test.fixme" apps/web/tests/numeric-binning.spec.ts apps/web/tests/workbench-sidebar.spec.ts
```

The e2e runs need the sandbox disabled. Expected: every suite passes; `numeric-binning` passes in full with the rewritten tests (two fewer than before Task 3.12: the hover test goes, and the two categorical-palette tests become one) and nothing reported as fixme; `workbench` includes `workbench-legend.spec.ts` (one more test) and `workbench-sidebar.spec.ts`; every exported helper is used by a spec (knip); the grep prints nothing. Known flake: the `numeric-binning` "hover point" test under full-suite load; re-run it alone once before investigating.

- [ ] **Step 4: Commit**

```bash
pnpm exec prettier --write apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/workbench-sidebar.spec.ts apps/web/tests/numeric-binning.spec.ts
git add apps/web/tests/helpers/legend.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/workbench-sidebar.spec.ts apps/web/tests/numeric-binning.spec.ts
git commit -m "test(web): drive legend settings through the popover"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 3.14: EAT controls and score strips on the kit and tokens

The EAT block and the score strips keep their behaviour and take the kit's controls and tokens (decision 12): the "Show EAT predictions" toggle becomes a `ps-checkbox`, the reliability mode a `ps-select`, and the sliders and percent boxes keep their native inputs restyled with tokens. Their rules leave the legacy `layout.ts` for clean `styles/eat.ts` and `styles/strips.ts`, and `category-score-strip.styles.ts` reads `--ps-*` tokens and leaves the allowlist.

**Files:**

- Create: `packages/core/src/components/legend/styles/eat.ts`, `styles/strips.ts`
- Modify: `legend-eat-controls.ts`, `legend.styles.ts`, `styles/layout.ts` (EAT, band and score-strip rules leave), `category-score-strip.styles.ts`, `packages/core/src/styles/style-lint.test.ts` (drop `legend/category-score-strip.styles.ts`)
- Not modified: `legend-score-strips.ts` (the skeleton lists it for "classes only"; the strips keep `.score-strips`, `.score-strips-note` and `.score-strips-caveat`, which `styles/strips.ts` styles as they are)
- Modify tests: `legend.eat-controls.test.ts` (the toggle through `ps-checkbox`'s `checked` and `change`; the mode through `ps-select`'s `value` and `change`; the options read from `ps-select.options`; one added test for the kit controls' names; other selectors unchanged). `category-score-strip.component.test.ts` reads no style variable, so it is untouched.

**Interfaces:**

- Consumes: `EatReliabilityController`, `renderEatSection` (3.3); `renderScoreStrips` (3.2); `ps-checkbox` (`PsCheckbox`: `checked`, `label`, `change`), `ps-select` (`PsSelect`: `.options`, `value`, `label`, `disabled`, `change`), `SelectOption`.
- Produces:
  - EAT DOM: `ps-checkbox.eat-switch label="Show EAT predictions"` with the slotted text "Show" (role `checkbox`, name "Show EAT predictions"), `ps-select.eat-threshold-mode label="EAT reliability filter mode"` with options "Hide below" (`atLeast`), "Hide above" (`atMost`), "Keep between" (`between`), disabled while the switch is off; the region, slider, percent and info names, ids `eat-reliability-threshold` / `eat-reliability-upper` and classes `.eat-legend`, `.eat-legend-counts`, `.eat-threshold`, `.eat-threshold-band`, `.eat-threshold-percent`, `.eat-threshold-info` unchanged.
  - `styles/eat.ts` (`eatStyles`): the block, band track (`--ps-border-strong`), fill (`--ps-accent`), thumbs (`--ps-surface` with `0 0 0 1px var(--ps-border-control)`), percent boxes (`--ps-radius-sm`), swatches, counts; sizes from `--ps-text-xs`/`-sm`.
  - `styles/strips.ts` (`stripStyles`): `.score-strips`, `.score-strips-note`, `.score-strips-caveat` on tokens.
  - `category-score-strip.styles.ts`: `--text-sm` → `--ps-text-sm`, `--text-caption` → `--ps-text-xs`, `--legend-text-color` → `--ps-text`, `--legend-text-secondary` → `--ps-text-muted`, `--legend-border` → `--ps-border`, `--legend-bg` → `--ps-surface`; `srOnlyMixin` kept until 3.15.

**Tests:**

- `legend.eat-controls.test.ts` (29 tests after Task 3.3) passes with the updated toggle and mode selectors, plus "puts the switch and the mode on the kit, keeping their names" (30); `category-score-strip.component.test.ts` and `legend.score-strips.test.ts` pass.
- `style-lint.test.ts` passes with the shorter LEGACY list (the "still needs its exemption" test proves the module is clean), and `styles/eat.ts` and `styles/strips.ts` pass the "reads colours and font sizes from tokens" case it runs for every non-legacy module; `styles-integrity.test.ts` passes.
- `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=eat-visualization` passes, including the widths 320, 390, 601 and 800 checks of `.eat-threshold*` geometry.

Earlier tasks (3.6–3.13) have changed `legend.styles.ts` and `styles/layout.ts`; anchor each edit on the quoted selectors and names. The EAT block and the score-strip rules are untouched by them.

- [ ] **Step 1: Update the EAT tests to drive the kit controls**

In `packages/core/src/components/legend/legend.eat-controls.test.ts`:

1a. After the line `import { EAT_THRESHOLD_COMMIT_DELAY_MS } from './legend-eat-controls';` (added in Task 3.3), add:

```ts
import type { PsCheckbox } from '../kit/checkbox';
import type { PsSelect } from '../kit/select';
```

1b. Replace every occurrence (four: the tests "syncs the overlay switch…", "applies the overlay toggle immediately…", "cancels a pending threshold commit when the overlay toggle supersedes it" and "keeps the mode and bounds when the overlay switch is toggled") of

```ts
legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-switch input')!
```

with

```ts
legend.shadowRoot!.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!
```

(The tests set `toggle.checked` and dispatch `change` on it, which `ps-checkbox` supports as the native input did.)

1c. Replace every occurrence (two: `selectMode` and "clears the bound a mode no longer uses…") of

```ts
legend.shadowRoot!.querySelector<HTMLSelectElement>('.eat-threshold-mode')!
```

with

```ts
legend.shadowRoot!.querySelector<PsSelect>('ps-select.eat-threshold-mode')!
```

1d. Replace the body of `it('offers all three directions', async () => {` —

```ts
    const { legend } = await setup();
    const options = Array.from(
      legend.shadowRoot!.querySelectorAll<HTMLOptionElement>('.eat-threshold-mode option'),
    ).map((o) => o.value);
    expect(options).toEqual(['atLeast', 'atMost', 'between']);
```

— with

```ts
    const { legend } = await setup();
    const select = legend.shadowRoot!.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    expect(select.options.map((o) => o.value)).toEqual(['atLeast', 'atMost', 'between']);
    expect(select.options.map((o) => o.label)).toEqual(['Hide below', 'Hide above', 'Keep between']);
```

1e. Inside `describe('legend-owned EAT controls', () => {`, after the test `'renders the controls with counts'`, add:

```ts
  it('puts the switch and the mode on the kit, keeping their names', async () => {
    const { legend } = await setup();
    const root = legend.shadowRoot!;

    const toggle = root.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    expect(toggle.label).toBe('Show EAT predictions');
    expect(toggle.checked).toBe(true);
    expect(toggle.textContent!.trim()).toBe('Show');
    // The native checkbox inside carries the name, so the role stays `checkbox`.
    await toggle.updateComplete;
    expect(
      toggle.shadowRoot!.querySelector('input[type="checkbox"]')!.getAttribute('aria-label'),
    ).toBe('Show EAT predictions');

    const mode = root.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    expect(mode.label).toBe('EAT reliability filter mode');
    expect(mode.value).toBe('atLeast');
    expect(mode.disabled).toBe(false);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await legend.updateComplete;
    expect(mode.disabled).toBe(true);
  });
```

- [ ] **Step 2: Drop the score strip's legacy exemption**

In `packages/core/src/styles/style-lint.test.ts`, delete from `LEGACY` the line

```ts
  '../components/legend/category-score-strip.styles.ts',
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.eat-controls.test.ts src/styles/style-lint.test.ts`
Expected: FAIL. In `legend.eat-controls.test.ts`, every test that looks up `ps-checkbox.eat-switch` or `ps-select.eat-threshold-mode` fails with `Cannot read properties of null` (the block still renders a native checkbox and select); in `style-lint.test.ts`, `../components/legend/category-score-strip.styles.ts reads colours and font sizes from tokens` fails, listing `font-size: var(--text-sm)`, `color: var(--legend-text-secondary)` and the other legacy reads.

- [ ] **Step 4: Put the switch and the mode on the kit**

In `packages/core/src/components/legend/legend-eat-controls.ts`:

4a. After the line `import '../common/info-popover';`, add:

```ts
import '../kit/checkbox';
import '../kit/select';
import type { PsCheckbox } from '../kit/checkbox';
import type { PsSelect, SelectOption } from '../kit/select';
```

4b. After the `EAT_RELIABILITY_EFFECT` constant (it ends with the `between:` entry and `};`), add:

```ts
/** The filter's three directions, in the order the mode select lists them. */
const EAT_MODE_OPTIONS: SelectOption[] = [
  { value: 'atLeast', label: 'Hide below' },
  { value: 'atMost', label: 'Hide above' },
  { value: 'between', label: 'Keep between' },
];
```

4c. In `readonly onToggle = (event: Event): void => {`, replace

```ts
    this.setOverlayEnabled((event.currentTarget as HTMLInputElement).checked);
```

with

```ts
    this.setOverlayEnabled((event.currentTarget as PsCheckbox).checked);
```

4d. In `readonly onModeChange = (event: Event): void => {`, replace

```ts
    const mode = (event.currentTarget as HTMLSelectElement).value as EatReliabilityMode;
```

with

```ts
    const mode = (event.currentTarget as PsSelect).value as EatReliabilityMode;
```

4e. Replace the whole `renderReliabilityModeSelect` function with:

```ts
function renderReliabilityModeSelect(ctrl: EatReliabilityController): TemplateResult {
  return html`
    <ps-select
      class="eat-threshold-mode"
      label="EAT reliability filter mode"
      .options=${EAT_MODE_OPTIONS}
      .value=${ctrl.reliability.mode}
      .disabled=${!ctrl.overlayEnabled}
      @change=${ctrl.onModeChange}
    ></ps-select>
  `;
}
```

4f. In `renderEatSection`, replace

```ts
        <label class="eat-switch">
          <input
            type="checkbox"
            .checked=${ctrl.overlayEnabled}
            aria-label="Show EAT predictions"
            @change=${ctrl.onToggle}
          />
          <span>Show</span>
        </label>
```

with

```ts
        <ps-checkbox
          class="eat-switch"
          label="Show EAT predictions"
          .checked=${ctrl.overlayEnabled}
          @change=${ctrl.onToggle}
          >Show</ps-checkbox
        >
```

The range inputs and the percent boxes stay native: the kit has no slider, and `ps-input` has no `min`, `max` or `step`.

4g. The two counts go through the legend's count format (decision 15). Add to the imports

```ts
import { formatCount } from '../../utils/count-text';
```

and in `renderEatSection` replace `<strong>${view.counts.observed}</strong>` with `<strong>${formatCount(view.counts.observed)}</strong>` and `<strong>${view.counts.predicted}</strong>` with `<strong>${formatCount(view.counts.predicted)}</strong>`. (`eat-visualization.spec.ts` matches `/Observed\s*535/`, which a grouped count under 1,000 keeps.)

- [ ] **Step 5: Create the EAT and strip style modules**

Create `packages/core/src/components/legend/styles/eat.ts`:

```ts
import { css } from 'lit';

/**
 * The reliability band's drag handle. Stated once and interpolated into both vendor
 * pseudo-elements: `::-webkit-slider-thumb` and `::-moz-range-thumb` cannot be grouped
 * into one selector (an engine drops the whole rule on a selector it does not know),
 * so the declarations are what has to be shared. Two hand-kept copies meant a thumb
 * resize applied to the webkit one was invisible in Chrome dev and CI and showed up
 * only in Firefox.
 */
const bandThumb = css`
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid var(--ps-surface);
  border-radius: 50%;
  background: var(--ps-accent);
  box-shadow: 0 0 0 1px var(--ps-border-control);
  cursor: grab;
  pointer-events: auto;
`;

/** The legend's EAT block: the overlay switch, the reliability filter and the counts. */
export const eatStyles = css`
  .eat-legend {
    box-sizing: border-box;
    width: calc(100% - 2 * var(--ps-space-2));
    margin: var(--ps-space-0-5) auto var(--ps-space-1-5);
    padding: var(--ps-space-1-5) var(--ps-space-2);
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius);
    background: var(--ps-surface-muted);
  }

  .eat-legend-title {
    font-size: var(--ps-text-xs);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text-muted);
  }

  .eat-legend-header,
  .eat-threshold-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ps-space-2);
  }

  .eat-threshold-value {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-1);
  }

  /* ps-checkbox draws the box; its slotted "Show" takes this size and colour. */
  .eat-switch {
    color: var(--ps-text);
    font-size: var(--ps-text-xs);
  }

  .eat-threshold input {
    accent-color: var(--ps-accent);
  }

  .eat-threshold {
    margin: var(--ps-space-1-5) 0 var(--ps-space-2);
    padding-bottom: var(--ps-space-2);
    border-bottom: 1px solid var(--ps-border);
  }

  .eat-threshold-heading {
    margin-bottom: var(--ps-space-1);
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
  }

  /*
   * The mode select replaces what used to be a static "Hide below reliability" label, so it
   * must not grow the row: the EAT block is asserted to stay inside its group with no
   * horizontal overflow down to a 320px viewport.
   */
  .eat-threshold-mode {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    font-size: var(--ps-text-xs);
  }

  /*
   * Every mode renders ONE track. It carries one thumb per bound the mode filters on,
   * so the control keeps its shape when the mode changes. The range inputs are stacked
   * on top of each other, transparent and inert, so what the user sees is the track and
   * fill drawn below them; only the thumbs take pointer events, which is what lets two
   * bounds be dragged independently on a shared bar.
   */
  .eat-threshold-band {
    position: relative;
    height: 1.05rem;
    margin: var(--ps-space-0-5) 0 0;
  }

  .eat-threshold-track {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
    height: 0.3rem;
    transform: translateY(-50%);
    border-radius: var(--ps-radius-full);
    background: var(--ps-border-strong);
  }

  /* The kept band. Positioned from both ends, so it reads as "what survives the filter". */
  .eat-threshold-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: var(--ps-radius-full);
    background: var(--ps-accent);
  }

  .eat-threshold-band input[type='range'] {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    /* The shared track must not swallow the other thumb's drags. */
    pointer-events: none;
  }

  .eat-threshold-band input[type='range']:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
    border-radius: var(--ps-radius-full);
  }

  .eat-threshold-band input[type='range']::-webkit-slider-runnable-track {
    background: transparent;
    border: none;
  }

  .eat-threshold-band input[type='range']::-moz-range-track {
    background: transparent;
    border: none;
  }

  .eat-threshold-band input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    ${bandThumb}
  }

  .eat-threshold-band input[type='range']::-moz-range-thumb {
    ${bandThumb}
  }

  .eat-threshold-band.is-disabled {
    opacity: 0.6;
  }

  .eat-threshold-band.is-disabled input[type='range']::-webkit-slider-thumb {
    cursor: default;
  }

  .eat-threshold-band.is-disabled input[type='range']::-moz-range-thumb {
    cursor: default;
  }

  /* Separates the two percent boxes: "25 – 41 %". */
  .eat-threshold-sep {
    color: var(--ps-text-muted);
  }

  .eat-threshold-percent {
    box-sizing: border-box;
    width: 2.8rem;
    padding: var(--ps-space-0-5) var(--ps-space-1);
    border: 1px solid var(--ps-border-strong);
    border-radius: var(--ps-radius-sm);
    background: var(--ps-surface);
    color: var(--ps-text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .eat-threshold-percent:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: 0;
  }

  .eat-threshold-percent:disabled {
    background: var(--ps-surface-muted);
    color: var(--ps-text-faint);
  }

  .eat-threshold-info {
    flex: 0 0 auto;
  }

  .eat-legend-counts {
    display: grid;
    gap: var(--ps-space-0-5);
  }

  .eat-legend-row {
    display: grid;
    grid-template-columns: 0.8rem 1fr auto;
    align-items: center;
    gap: var(--ps-space-1-5);
    font-size: var(--ps-text-xs);
    color: var(--ps-text);
  }

  .eat-legend-row strong {
    font-weight: var(--ps-weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .eat-swatch {
    width: 0.55rem;
    height: 0.55rem;
    border: 2px solid currentColor;
    border-radius: var(--ps-radius-full);
    box-sizing: border-box;
  }

  .eat-swatch.observed {
    background: currentColor;
  }

  .eat-swatch.predicted {
    background: transparent;
  }
`;
```

Create `packages/core/src/components/legend/styles/strips.ts`:

```ts
import { css } from 'lit';

/** The separation strips above the list, the note that replaces them while the view is filtered. */
export const stripStyles = css`
  .score-strips {
    display: flex;
    flex-direction: column;
    gap: var(--ps-space-2);
    padding: var(--ps-space-2) var(--ps-space-3);
    border-bottom: 1px solid var(--ps-border);
  }

  .score-strips-note {
    margin: 0;
    padding: var(--ps-space-2) var(--ps-space-3);
    /* The same size as .score-strips-caveat below: the two say the same kind of thing about
       the strips. */
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
    border-bottom: 1px solid var(--ps-border);
  }

  /* Sits inside .score-strips, which already owns the padding and bottom border. */
  .score-strips-caveat {
    margin: 0;
    font-size: var(--ps-text-xs);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text-muted);
  }
`;
```

- [ ] **Step 6: Remove the moved rules from `layout.ts` and compose the new modules**

In `packages/core/src/components/legend/styles/layout.ts`:

6a. Delete the `bandThumb` constant with its doc comment: from the `/**` above ` * The reliability band's drag handle. Stated once and interpolated into both vendor` down to and including its closing `` `; `` (lines 4–21 at `7d45ab02`).

6b. Inside `layoutStyles`, delete every rule from `  .eat-legend {` down to and including the closing `  }` of `  .eat-swatch.predicted {` (lines 118–329 at `7d45ab02`: `.eat-legend`, `.eat-legend-title`, `.eat-legend-header, .eat-threshold-heading`, `.eat-switch, .eat-threshold-value`, `.eat-switch`, `.eat-switch input, .eat-threshold input`, `.eat-threshold`, `.eat-threshold-heading`, the band comment and every `.eat-threshold-band…` rule, `.eat-threshold-sep`, `.eat-threshold-percent`, `.eat-threshold-info`, the mode-select comment and `.eat-threshold-mode`, `.eat-threshold-mode:disabled`, `.eat-legend-counts`, `.eat-legend-row`, `.eat-swatch`, `.eat-swatch.observed`, `.eat-swatch.predicted`).

6c. Inside `layoutStyles`, delete the three score-strip rules: `  .score-strips {` … `}`, `  .score-strips-note {` … `}` (with its comment) and the comment `/* Sits inside .score-strips, which already owns the padding and bottom border. */` with `  .score-strips-caveat {` … `}` (lines 352–376 at `7d45ab02`).

Check: `grep -n "eat-\|score-strips\|bandThumb" packages/core/src/components/legend/styles/layout.ts` prints nothing. The module keeps its other rules (and stays LEGACY until 3.15).

In `packages/core/src/components/legend/legend.styles.ts`:

6d. After the line `import { layoutStyles } from './styles/layout';`, add:

```ts
import { eatStyles } from './styles/eat';
import { stripStyles } from './styles/strips';
```

6e. In the `legendStyles` array, add `eatStyles` and `stripStyles` right after `layoutStyles`:

```ts
  layoutStyles,
  eatStyles,
  stripStyles,
```

- [ ] **Step 7: Put the score strip's stylesheet on tokens**

Replace the contents of `packages/core/src/components/legend/category-score-strip.styles.ts` with:

```ts
import { css } from 'lit';
import { srOnlyMixin } from '../../styles/mixins';

export const categoryScoreStripStyles = [
  srOnlyMixin,
  css`
    :host {
      display: block;
    }

    .strip-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-size: var(--ps-text-sm);
      color: var(--ps-text-muted);
      padding: 0 var(--ps-space-1);
    }

    .strip-label {
      font-weight: var(--ps-weight-semibold);
      color: var(--ps-text);
      /* Keeps the ⓘ on the label's baseline rather than letting the 18px button
         stretch the header row. */
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-0-5);
    }

    /* Centring lands the readout on the axis line: the svg's layout box is
     STRIP_HEIGHT tall and the axis sits at its midpoint. */
    .strip-body {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
    }

    svg {
      display: block;
      width: 100%;
      overflow: visible;
      /* Without a zero min-width the intrinsic svg width would keep the flex item
       from shrinking, and the gutter would push the axis out of the panel. */
      flex: 1;
      min-width: 0;
    }

    /* Fixed width and tabular figures: the gutter must not resize as the hover
     moves between categories, or every dot would shift with it. */
    .strip-value {
      flex: none;
      min-width: 3rem;
      text-align: right;
      font-size: var(--ps-text-sm);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text);
    }

    .strip-value.is-empty {
      color: var(--ps-text-muted);
    }

    .axis {
      stroke: var(--ps-border);
      stroke-width: 1;
    }

    circle {
      stroke: var(--ps-surface);
      stroke-width: 1;
      cursor: pointer;
    }

    circle.is-highlighted {
      stroke: var(--ps-text);
      stroke-width: 2;
    }

    .bound {
      font-size: var(--ps-text-xs);
      fill: var(--ps-text-muted);
    }
  `,
];
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.eat-controls.test.ts src/components/legend/category-score-strip.component.test.ts src/components/legend/legend.score-strips.test.ts src/styles`
Expected: PASS: 30 EAT tests; the score-strip component and legend strip tests unchanged; the style lint with one LEGACY entry fewer than before this task (15 if nothing outside this phase changed the set: 18 at `7d45ab02`, less `item.ts` (3.8), `modal.ts` (3.12) and `category-score-strip.styles.ts`), `styles/eat.ts` and `styles/strips.ts` clean; `styles-integrity.test.ts` finds both new modules and they produce real CSS.

- [ ] **Step 9: Run the suites the change affects**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS (`legend.api.test.ts` drives EAT through `applyEatSettings`, so it is unaffected).

Then: `pnpm type-check && pnpm lint && pnpm exec knip`
Expected: PASS (`eatStyles` and `stripStyles` are consumed by `legend.styles.ts`; `SelectOption`, `PsCheckbox`, `PsSelect` are type imports from the kit's own files).

Then, with the sandbox disabled: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=eat-visualization`
Expected: PASS, including the 320/390/601/800 px geometry of `.eat-threshold`, `.eat-threshold-percent` and `.eat-threshold-info` inside the group, the checkbox "Show EAT predictions" (`ps-checkbox` keeps role `checkbox` on its inner input) and the slider and percentage names. If the 320 px check reports `thresholdScrollWidth > thresholdClientWidth`, the mode select is too wide: lower `.eat-threshold-mode`'s `max-width` to `50%` in `styles/eat.ts` rather than changing the spec.

Then: `pnpm exec prettier --check packages/core/src/components/legend/legend-eat-controls.ts packages/core/src/components/legend/styles/eat.ts packages/core/src/components/legend/styles/strips.ts packages/core/src/components/legend/styles/layout.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/category-score-strip.styles.ts packages/core/src/components/legend/legend.eat-controls.test.ts packages/core/src/styles/style-lint.test.ts`
Expected: no warnings (run `--write` first if needed).

Report the core unit counts before and after and `wc -l packages/core/src/components/legend/legend.ts` (unchanged by this task).

- [ ] **Step 10: Commit**

With the sandbox disabled:

```bash
git add packages/core/src/components/legend/legend-eat-controls.ts \
  packages/core/src/components/legend/styles/eat.ts \
  packages/core/src/components/legend/styles/strips.ts \
  packages/core/src/components/legend/styles/layout.ts \
  packages/core/src/components/legend/legend.styles.ts \
  packages/core/src/components/legend/category-score-strip.styles.ts \
  packages/core/src/components/legend/legend.eat-controls.test.ts \
  packages/core/src/styles/style-lint.test.ts
git commit -m "refactor(core): put the legend's EAT block and score strips on the kit"
```

---

### Task 3.15: Legend styles on tokens; the legend leaves the lint allowlist

The last legacy legend styles go: the host loses its card chrome and fixed height (the sidebar draws the edges), the list scrolls in the space left, `styles/theme.ts` (the `--legend-*` properties) and `styles/responsive.ts` are deleted, and `legend.styles.ts` stops flattening the old `tokens` and `buttonMixin`. The info popover and the projection details stop reading `--legend-*`. The shell's `#myLegend` overrides shrink, and the developer style docs describe the `--ps-*` tokens instead of `--legend-*`.

**Files:**

- Create: `packages/core/src/components/legend/legend.styles.browser.test.ts`
- Modify: `legend.styles.ts`, `styles/layout.ts`, `packages/core/src/components/kit/kit-shared.styles.ts` (`srOnly`), `category-score-strip.styles.ts` (`srOnly`), `packages/core/src/components/common/info-popover.styles.ts` (:19, :26), `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts` (:14–19), `packages/core/src/styles/style-lint.test.ts` (drop `legend/legend.styles.ts`, `legend/styles/layout.ts`, `legend/styles/theme.ts`; its own sample `--legend-bg` becomes `--card-bg`, so the phase-exit grep for `--legend-` finds nothing)
- Delete: `styles/theme.ts`, `styles/responsive.ts`
- Modify: `apps/web/src/workbench/workbench.css` (:176–184: `#myLegend` keeps `flex` and `min-height` only; the narrow `min-height` rule stays), `apps/web/tests/workbench-legend.spec.ts`
- Modify: `docs/developers/style-architecture.md` (:82–111 and the two `legendStyles` examples: the legend reads `--ps-*` tokens; `--legend-*` is gone; embedders add their own border for a card)

**Interfaces:**

- Consumes: every legend style module of 3.6–3.14 (`rowStyles` from `styles/row.ts`, `pickerStyles` from `styles/picker.ts`, `headerStyles` from `styles/header.ts`, `eatStyles` from `styles/eat.ts`, `stripStyles` from `styles/strips.ts`); `kitHost`, `focusRing`, `reducedMotion`; `adoptTheme` (`kit/adopt-theme.ts`); `categoricalData`, `TWELVE` (3.1); `legend(page)` (`apps/web/tests/helpers/legend.ts`, 3.7); `openExplore`, `sidebar` (`apps/web/tests/helpers/explore.ts`).
- Produces:
  - `kit/kit-shared.styles.ts`: `srOnly` (the visually-hidden rule for `.sr-only`).
  - `legend.styles.ts`: `legendStyles = [kitHost, focusRing, reducedMotion, srOnly, layoutStyles, headerStyles, rowStyles, pickerStyles, eatStyles, stripStyles]` (no `tokens`, `buttonMixin`, `overlayMixins`, `themeStyles`, `responsiveStyles`).
  - `styles/layout.ts` (`layoutStyles`): `:host { display: flex; flex-direction: column; min-height: 0; background: var(--ps-surface); color: var(--ps-text); user-select: none }`; `.legend-container` a column filling the host; `.legend-items { flex: 1; min-height: 0; overflow-y: auto }`; `.legend-empty` on `--ps-text-muted`; and a base `button` rule (no border, no background, `font` and `color` inherited, pointer cursor), the neutral part of what the dropped `buttonMixin` gave every button in the legend's root, so no row, action or picker button falls back to the browser's grey button when the mixin goes.
  - `info-popover.styles.ts` reads `--ps-text-muted` and `--ps-text` (still LEGACY for its other values).

**Tests:**

- `legend.styles.browser.test.ts`: "the host has no border, radius or shadow"; "the list scrolls inside a 200 px tall legend"; "under data-theme=dark a row's label resolves to the dark --ps-text and its count to the dark --ps-text-muted"; "focus on a row's main button shows the one focus ring"; "under reduced motion the row transitions are 0 ms".
- `style-lint.test.ts` passes with LEGACY three entries shorter than before this task (12 if nothing outside this phase changed the set) and none under `components/legend/`; `styles-integrity.test.ts` passes.
- `workbench-legend.spec.ts`: "the legend fills the sidebar column flush, with no card border"; `workbench-structure.spec.ts`, `workbench-sidebar.spec.ts` and `workbench-shell.spec.ts` pass (the legend's box is unchanged).
- Full e2e (`PLAYWRIGHT_PORT=8475 pnpm test:e2e`) and `pnpm perf:counts` pass.

Every earlier phase-3 task has touched `legend.styles.ts` and `styles/layout.ts`; this task replaces both files whole, so it does not depend on their exact state. Anchor the other edits on the quoted text.

- [ ] **Step 1: Write the failing browser test**

Create `packages/core/src/components/legend/legend.styles.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceLegend } from './legend';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import { mountLegendWithScatterplot } from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settle(legend);
  await frame();
  return legend;
}

/** What a token resolves to on the page right now, as a computed colour. */
function tokenColour(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** An outline or a box shadow in the focus colour. */
function drawsRing(element: Element, focus: string): boolean {
  const style = getComputedStyle(element);
  const outline = style.outlineStyle !== 'none' && style.outlineColor === focus;
  return outline || style.boxShadow.includes(focus);
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;

describe('legend styles', () => {
  it('has no border, radius or shadow on the host', async () => {
    const legend = await mount();
    const style = getComputedStyle(legend);
    expect([
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ]).toEqual(['0px', '0px', '0px', '0px']);
    expect(style.borderTopLeftRadius).toBe('0px');
    expect(style.boxShadow).toBe('none');
  });

  it('scrolls the list inside a 200 px tall legend', async () => {
    const legend = await mount();
    legend.style.height = '200px';
    await frame();

    const list = legend.shadowRoot!.querySelector<HTMLElement>('.legend-items')!;
    const host = legend.getBoundingClientRect();
    expect(host.height).toBe(200);
    expect(getComputedStyle(list).overflowY).toBe('auto');
    // Ten rows and Other at 28 px do not fit under the header.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.bottom + 0.5);
  });

  it("resolves a row's label to the dark --ps-text and its count to the dark --ps-text-muted", async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const legend = await mount();
    // slate-100, the dark --ps-text.
    expect(tokenColour('--ps-text')).toBe('rgb(241, 245, 249)');

    const a = row(legend, 'A');
    expect(getComputedStyle(a.querySelector('.legend-text')!).color).toBe(tokenColour('--ps-text'));
    expect(getComputedStyle(a.querySelector('.legend-count')!).color).toBe(
      tokenColour('--ps-text-muted'),
    );
  });

  it("shows one focus ring for a row's main button", async () => {
    const legend = await mount();
    const mains = () =>
      legend.shadowRoot!.querySelectorAll<HTMLButtonElement>('.legend-item-main');
    mains()[0].focus();
    await userEvent.keyboard('{ArrowDown}');
    await settle(legend);

    const focused = legend.shadowRoot!.activeElement as HTMLElement;
    expect(focused).toBe(mains()[1]);
    const focus = tokenColour('--ps-focus');
    const rings = [focused, focused.closest('.legend-item')!].filter((element) =>
      drawsRing(element, focus),
    );
    // The focus ring (--ps-focus), once: not the old button mixin's two-ring box shadow.
    expect(rings).toHaveLength(1);
  });

  it('turns the row transitions off under reduced motion', async () => {
    const legend = await mount();
    const a = row(legend, 'A');
    const moving = (element: Element) =>
      getComputedStyle(element)
        .transitionDuration.split(',')
        .some((duration) => parseFloat(duration) > 0);
    const animated = [a, ...a.querySelectorAll('*')].filter(moving);
    expect(animated.length).toBeGreaterThan(0);

    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    try {
      expect(animated.filter(moving)).toEqual([]);
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });
});
```

- [ ] **Step 2: Drop the legend's last legacy exemptions**

In `packages/core/src/styles/style-lint.test.ts`:

2a. Delete from `LEGACY` the three lines

```ts
  '../components/legend/legend.styles.ts',
  '../components/legend/styles/layout.ts',
  '../components/legend/styles/theme.ts',
```

(`legend/styles/item.ts`, `modal.ts` and `category-score-strip.styles.ts` left in 3.8, 3.12 and 3.14; LEGACY is now three entries shorter than before this task, 12 if nothing outside this phase changed it, and none is under `components/legend/`.)

2b. In the first test, `'flags raw colours, literal font sizes, stray tokens and unknown variables'`, replace both occurrences of `--legend-bg: #1e3a8a` (in the sample CSS and in the expected list) with `--card-bg: #1e3a8a`. The case still checks a raw colour in a non-`--ps` custom property; the legend's old name leaves the source.

- [ ] **Step 3: Run the tests to see them fail**

Run (sandbox disabled: browser mode starts a local server): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.styles.browser.test.ts`
Expected: FAIL: "has no border, radius or shadow on the host" (the 1px border, the radius and the card shadow from `layout.ts`) and "scrolls the list…" (`overflowY` is `scroll`, and the `calc(50% - 1rem)` height rules). The focus-ring, dark-theme and reduced-motion cases already pass (Task 3.6's `styles/row.ts` draws `.legend-item-main:focus-visible` with `--ps-focus` and beats `buttonMixin`'s `button:focus-visible`, the row label and count read `--ps-text`/`--ps-text-muted`, and `rowStyles` carries `reducedMotion`); they pin what this rewrite must keep.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: FAIL: `../components/legend/legend.styles.ts`, `../components/legend/styles/layout.ts` and `../components/legend/styles/theme.ts reads colours and font sizes from tokens` list `--legend-*` reads, the legacy `var(--primary)`/`var(--spacing-*)` reads that `tokens` and `buttonMixin` bring in, and theme.ts's raw colours.

- [ ] **Step 4: Move `srOnly` into the kit's shared sheets**

Append to `packages/core/src/components/kit/kit-shared.styles.ts`:

```ts
/** Hidden from view, still read by assistive technology: live regions and off-screen labels. */
export const srOnly = css`
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
```

In `packages/core/src/components/legend/category-score-strip.styles.ts`, replace

```ts
import { srOnlyMixin } from '../../styles/mixins';

export const categoryScoreStripStyles = [
  srOnlyMixin,
```

with

```ts
import { srOnly } from '../kit/kit-shared.styles';

export const categoryScoreStripStyles = [
  srOnly,
```

(`styles/mixins.ts` keeps `srOnlyMixin` for the projection details until Task 8.1.)

- [ ] **Step 5: Rewrite the layout module and the composition**

Replace the contents of `packages/core/src/components/legend/styles/layout.ts` with the following. After Tasks 3.9 and 3.14 the file holds only the host, the container, the `srOnlyMixin` interpolation, the list and the empty state; if any other rule is still there, it belongs to an earlier task's module (header, row, picker, EAT, strips): move it into that module on tokens rather than dropping it.

```ts
import { css } from 'lit';

/**
 * The legend's frame. The host has no card of its own: it fills the height its container gives
 * it (the workbench sidebar draws the edges), and the list scrolls in what the header, the EAT
 * block and the score strips leave.
 */
export const layoutStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    background: var(--ps-surface);
    color: var(--ps-text);
    user-select: none;
  }

  .legend-container {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    min-height: 0;
  }

  .legend-items {
    display: flex;
    flex: 1;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    padding: var(--ps-space-1) 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .legend-empty {
    padding: var(--ps-space-5) var(--ps-space-3);
    color: var(--ps-text-muted);
    text-align: center;
  }

  /*
   * The base every button in the legend's root starts from; the row, its actions and the
   * picker style their own on top. It keeps the neutral part of what the old button mixin set
   * on every button here (no border or background, a centred flex box that ends long text in an
   * ellipsis), on tokens, so none falls back to the browser's grey button.
   */
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--ps-space-1);
    box-sizing: border-box;
    max-width: 100%;
    overflow: hidden;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
`;
```

Replace the contents of `packages/core/src/components/legend/legend.styles.ts` with:

```ts
import { focusRing, kitHost, reducedMotion, srOnly } from '../kit/kit-shared.styles';
import { layoutStyles } from './styles/layout';
import { headerStyles } from './styles/header';
import { rowStyles } from './styles/row';
import { pickerStyles } from './styles/picker';
import { eatStyles } from './styles/eat';
import { stripStyles } from './styles/strips';

/**
 * The legend's one stylesheet, on `--ps-*` tokens only: the kit's shared sheets (host font and
 * colour, the focus ring, reduced motion, the visually-hidden class), then one module per piece
 * of the element. The Other and settings popovers are child elements with their own sheets.
 *
 * @see /docs/developers/style-architecture.md
 */
export const legendStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  srOnly,
  layoutStyles,
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];
```

If an export name differs from the one Tasks 3.6–3.14 created (check with `grep -n "^export const" packages/core/src/components/legend/styles/*.ts`), use the name the module exports.

- [ ] **Step 6: Delete the theme and responsive modules**

Run: `rm packages/core/src/components/legend/styles/theme.ts packages/core/src/components/legend/styles/responsive.ts`

Then: `grep -rn "styles/theme'\|styles/responsive'\|themeStyles\|responsiveStyles" packages/core/src/components/legend`
Expected: no output.

- [ ] **Step 7: Stop the info popover and the projection details reading `--legend-*`**

In `packages/core/src/components/common/info-popover.styles.ts`, replace

```css
    color: var(--legend-text-secondary, #6b7280);
```

with

```css
    color: var(--ps-text-muted);
```

and

```css
    color: var(--legend-text-color, #111827);
```

with

```css
    color: var(--ps-text);
```

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, delete these lines from the `:host` rule (the blank line after them goes too):

```css
      /* protspace-info-popover is shared with the legend and themes itself from these two
         hooks, defaulting to a neutral grey. Set them from the tokens so its info icon and
         text match the label beside it; the component already exposes the seam, and the
         legend keeps its own values. */
      --legend-text-secondary: var(--ps-text-muted);
      --legend-text-color: var(--ps-text);
```

Both files keep other legacy values, so they stay in LEGACY (the "still needs its legacy exemption" test confirms it).

- [ ] **Step 8: Run the core tests**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.styles.browser.test.ts`
Expected: PASS, 5 tests. If "shows one focus ring" fails because no element draws a ring, check that `.legend-item-main` does not set `outline: none` in `styles/row.ts`; if it finds two, the row draws its own focus ring in `styles/row.ts` as well: keep the one on the main button (the `focusRing` sheet) and remove the row's.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles src/components/legend src/components/common src/components/scatter-plot/projection-metadata`
Expected: PASS; `style-lint.test.ts` with LEGACY three entries shorter than before this task, each still violating; `styles-integrity.test.ts` finds `srOnly` in `kit-shared.styles.ts` and every legend module producing real CSS.

Then the whole core suite (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS (the browser tests of 3.6–3.14 run against the new host and list layout).

Check the phase's grep: `grep -rn -- '--legend-' packages/core/src apps/web/src docs/developers`
Expected: no output after Step 10.

- [ ] **Step 9: Shrink the shell's legend overrides and add the e2e check**

In `apps/web/src/workbench/workbench.css`, replace

```css
/* The legend fills the column; the sidebar draws the edges, so the host's own card goes. */
#myLegend {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
```

with

```css
/* The legend fills the column; the sidebar draws the edges (the legend has no card of its own). */
#myLegend {
  flex: 1 1 0;
  min-height: 0;
}
```

The narrow rule (`.workbench[data-layout='narrow'] #myLegend { flex: none; min-height: 320px; }`) and the desktop height rules stay.

In `apps/web/tests/workbench-legend.spec.ts`, make sure `openExplore` and `sidebar` are imported from `./helpers/explore` and `legend` from `./helpers/legend` (add the names to the existing import lines; do not add a second import from the same module), then append at the end of the file:

```ts
test('the legend fills the sidebar column flush, with no card border', async ({ page }) => {
  await openExplore(page);
  const host = legend(page);

  const chrome = await host.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
    };
  });
  expect(chrome).toEqual({ border: ['0px', '0px', '0px', '0px'], radius: '0px', shadow: 'none' });

  // The sidebar's 1 px left border is its edge; the legend spans the rest of the column.
  const column = (await sidebar(page).boundingBox())!;
  const box = (await host.boundingBox())!;
  expect(Math.abs(box.x - (column.x + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width - (column.x + column.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - column.y)).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 10: Update the developer style docs**

In `docs/developers/style-architecture.md`, replace the whole `## Custom Properties` section — from the line `## Custom Properties` down to the end of the "Component Prefixes" table (the row `| Kit and new elements | \`--ps-*\` tokens only   |`), just before `## Examples` — with:

````md
## Custom Properties

### Design tokens

Colours, font sizes, spacing, radii, shadows and durations are `--ps-*` tokens, declared only in
`packages/core/src/styles/theme.ts` (light values on `:root`, dark values under
`[data-theme='dark']`). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.

### Component properties

Older components still expose custom properties of their own:

```
--[component-prefix]-[category]-[property]-[modifier?]
```

**Examples:**

```css
--protspace-bg-color            /* component background */
--protspace-viewer-height       /* element sizing */
```

Rules for these:

1. **Always reference tokens**: `--protspace-bg-color: var(--ps-surface)`
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Group with comments**: `/* Layout */`, `/* Colors */`, `/* Sizing */`

### Component Prefixes

| Component            | Prefix                 |
| -------------------- | ---------------------- |
| Legend               | `--ps-*` tokens only   |
| Scatter-plot         | `--protspace-*`        |
| Structure-viewer     | `--protspace-viewer-*` |
| Kit and new elements | `--ps-*` tokens only   |

### Theming the legend

The legend reads `--ps-*` tokens only; its former `--legend-*` properties are gone. To restyle
it, set the `--ps-*` tokens on `:root`. The legend draws no card of its own (no border, radius
or shadow) and fills the height its container gives it, as the workbench sidebar does. An
embedder that wants a card adds one on the host:

```css
protspace-legend {
  height: 480px;
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
}
```
````

In the same file, under `### Complex Component`, replace the code block that starts `// legend.styles.ts` and imports `tokens`, `buttonMixin`, `themeStyles`, `layoutStyles`, `itemStyles` and `responsiveStyles` with:

````md
```typescript
// legend.styles.ts
import { focusRing, kitHost, reducedMotion, srOnly } from '../kit/kit-shared.styles';
import { layoutStyles } from './styles/layout';
import { headerStyles } from './styles/header';
import { rowStyles } from './styles/row';
import { pickerStyles } from './styles/picker';
import { eatStyles } from './styles/eat';
import { stripStyles } from './styles/strips';

export const legendStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  srOnly,
  layoutStyles,
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];
```
````

and under `## Reference Implementation`, replace the code block after "Study **legend** as the modular pattern:" (the one listing `tokens`, `buttonMixin`, `overlayMixins`, `themeStyles`, `layoutStyles`, `itemStyles`, `modalStyles`, `responsiveStyles`) with:

````md
```typescript
// legend.styles.ts
export const legendStyles = [
  kitHost, // shared kit sheets first: host font and colour,
  focusRing, // the one focus ring,
  reducedMotion, // no motion when the user asked for less,
  srOnly, // the visually hidden class
  layoutStyles, // then one module per piece of the element
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];
```

The Other and settings popovers are child elements (`legend-other-popover.ts`,
`legend-settings-popover.ts`), each with its own `*.styles.ts`.
````

Then: `pnpm docs:build`
Expected: PASS.

- [ ] **Step 11: Run the affected suites**

Run: `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS.

Then: `pnpm type-check && pnpm lint && pnpm exec knip`
Expected: PASS (`srOnly` is consumed by `legend.styles.ts` and `category-score-strip.styles.ts`; `themeStyles` and `responsiveStyles` are gone with their files; `tokens` and `buttonMixin` keep their other importers).

Then, with the sandbox disabled: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (the full suite, including `workbench-legend`, `workbench-structure`, `workbench-sidebar`, `workbench-shell`, `eat-visualization`, `numeric-binning`, `legend-double-click` and `url-view-state-firefox`/`-webkit`) and `pnpm perf:counts`
Expected: PASS, budgets unchanged. Re-run a known flake (`example-datasets.spec.ts:828`, the `numeric-binning` "hover point" test) once alone before investigating it.

Then: `pnpm exec prettier --check packages/core/src/components/legend/legend.styles.browser.test.ts packages/core/src/components/legend/legend.styles.ts packages/core/src/components/legend/styles/layout.ts packages/core/src/components/kit/kit-shared.styles.ts packages/core/src/components/legend/category-score-strip.styles.ts packages/core/src/components/common/info-popover.styles.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts packages/core/src/styles/style-lint.test.ts apps/web/src/workbench/workbench.css apps/web/tests/workbench-legend.spec.ts docs/developers/style-architecture.md`
Expected: no warnings (run `--write` first if needed).

Report the core, app and e2e counts before and after, `wc -l packages/core/src/components/legend/legend.ts`, and the LEGACY count before and after (three fewer).

- [ ] **Step 12: Commit**

With the sandbox disabled:

```bash
git add packages/core/src/components/legend/legend.styles.browser.test.ts \
  packages/core/src/components/legend/legend.styles.ts \
  packages/core/src/components/legend/styles/layout.ts \
  packages/core/src/components/legend/styles/theme.ts \
  packages/core/src/components/legend/styles/responsive.ts \
  packages/core/src/components/kit/kit-shared.styles.ts \
  packages/core/src/components/legend/category-score-strip.styles.ts \
  packages/core/src/components/common/info-popover.styles.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts \
  packages/core/src/styles/style-lint.test.ts \
  apps/web/src/workbench/workbench.css \
  apps/web/tests/workbench-legend.spec.ts \
  docs/developers/style-architecture.md
git commit -m "refactor(core): put every legend style on --ps-* tokens"
```

(`git add` of the deleted `theme.ts` and `responsive.ts` stages their removal.)

---

## Phase 3 exit

- `pnpm --filter @protspace/core exec vitest --run` (both projects, sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run` and `pnpm --filter @protspace/app exec vitest --run` pass; counts recorded against the baseline.
- `PLAYWRIGHT_PORT=8475 pnpm test:e2e` passes in full, including `url-view-state-firefox` and `url-view-state-webkit` (hover-revealed actions and top-layer popovers in Firefox and WebKit); known flakes re-run once alone.
- `pnpm perf:counts` passes with `apps/web/tests/perf/budgets.json` unchanged since the phase began; `pnpm perf` at 573K (datasets via `pnpm perf:fetch`, sandbox disabled) stays within the PR #526 budgets (design, Risks: the legend phase runs `pnpm perf`).
- `pnpm type-check`, `pnpm lint`, `pnpm exec knip`, `pnpm format:check` and `pnpm docs:build` pass.
- `style-lint.test.ts` LEGACY has none under `components/legend/` and six entries fewer than at the phase's start (12 unless something outside this phase changed the set), recorded against the baseline; `grep -rn -- '--legend-' packages/core/src apps/web/src docs/developers` finds nothing; `grep -rn '⚡\|title=' packages/core/src/components/legend --include='*.ts' --exclude='*.test.ts'` finds nothing (no emoji and no native title in legend templates).
- `wc -l packages/core/src/components/legend/legend.ts` is no larger than after Task 3.5 plus 100 lines, recorded in the ledger with the residue for Task 8.1 (the data pipeline, the settings applier, the sort and row-menu glue); no other legend module over 800 lines.
- No `test.fixme` left in `apps/web/tests` from this phase (`grep -rn "Task 3.13 moves" apps/web/tests` finds nothing).
- `openspec/changes/explore-workbench/tasks.md` section 3 ticked.
- Screenshots for the user (light theme, 1440×900, in the scratchpad, sent with `SendUserFile`): the sidebar with rows at rest and one row hovered; a hidden row; the "⋯" menu; the colour and shape picker; the sort menu; the Other popover with a search; the settings popover for a categorical and a numeric annotation; the legend at a 240 px sidebar with long names; and, for a first look, the same sidebar under `data-theme="dark"` (phase 6 polishes dark mode).

<!-- prettier-ignore-end -->
