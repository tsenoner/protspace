# Explore Workbench, Phase 5: Phones and tablets — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give phones and tablets the same workbench (design decision 17), absorbing `feat/mobile-responsive`. Its phone tests are ported first into a Playwright `mobile` project (Pixel 7) and turned green task by task. One layout-mode source (`desktop | tablet | phone | landscape`) drives the shell. Tablets (641–950 px) get a fixed screen: the plot over a panel row where the legend (or Filter) and the structure sit side by side. Phones (≤ 640 px) get a fixed screen that never scrolls: a slim app bar (wordmark, dataset, search button), a view bar with Projection, Color by and More, a More bottom sheet holding everything else, a bottom panel with Legend and Filter tabs that folds to its header, and a structure bottom sheet that opens folded so the plot and the tooltip stay visible. A phone on its side (≤ 500 px tall) scrolls once past one combined bar to a plot-and-legend view exactly one screen tall, with the structure on the right half. Touch input taps proteins (the pinned tooltip with "View structure"), pinches the plot, taps and double-taps legend rows, long-presses to reorder or read a truncated name, and finds every control at least 40 px; dialogs and popovers fit a phone.

**Architecture:** Behaviour stays split as phases 2–4 left it. Runtime elements render once in the fixed React tree; every layout is CSS keyed on `data-layout` (now four values) and the other root data attributes. A new non-React module `apps/web/src/explore/layout-mode.ts` owns the three `matchMedia` queries and resolves the mode; the React hook `useLayoutMode()` and the runtime's controllers (structure, filter count) both read it, so JS and CSS share one source. New phone chrome (panel tabs, fold chevron, search toggle, More sheet, structure-sheet chevron and grip) is plain React that may render conditionally because it is not a runtime element; it reaches runtime elements only through the layout store, DOM events, or public methods of core elements it finds by id. The structure sheet is app-owned: `WorkbenchStatus.structureSheet` (folded | expanded, never persisted), a slotted chevron, a CSS transform; the viewer stays layout-agnostic apart from one new CSS part. The plot's touch model reuses the pinned tooltip: under a touch pointer a tap pins the tooltip (20 px hit radius, compat-mouse hover suppressed, placed inside the plot), and the structure controller decides what the pin offers. Shadow-DOM styles that must know the phone breakpoint import one small core module, `packages/core/src/utils/breakpoints.ts`, which an app unit test keeps equal to `layout-defaults.ts`.

**Tech Stack:** Lit 3 (legacy decorators), TypeScript 6, Vite 8, Vitest 4.1.9 (core: jsdom `unit` and Chromium `browser` projects; utils and app: node), Playwright 1.61 (new `mobile` project: `devices['Pixel 7']`, 412×839, `isMobile`, `hasTouch`, Chromium; CDP `Input.dispatchTouchEvent` for multi-touch), React 19, Sonner 2, the kit (`ps-*`, `kit/layers.ts`, `@floating-ui/dom`), SortableJS (legend reorder), d3-zoom, Lucide 0.462.

**Spec:** `openspec/changes/explore-workbench/design.md`: decision 17 (phones and tablets) is the core; also 1 (workbench layout), 2 (structure placements; floating is desktop-only), 4 (one redraw per layout change), 10 (layout state), 11 (layer stack), 13–15 (selection bar, status corner, filter panel, notifications), 16 (do not block dark mode: tokens only, the More sheet leaves room for 6.1's Theme row), 18 (code structure, files of about 800 lines), 20 (testing: the ported mobile suite). `proposal.md` for scope (capabilities `mobile-layout` and `e2e-validation` among them). `tasks.md` section 5, rewritten to this plan's twelve tasks in the commit that adds the plan. Research notes `.superpowers/research/phase-5/R1`–`R3` map the current code with file:line; the user adopted every recommended answer in them (see Rulings for where notes disagreed and how it was settled). Not pulled in: the theme switch and its More-sheet row (6.1), dark surfaces (6.x), the tour rewrite and the two phone tour tests (7.4), docs images and the user guide (7.x), `viewport-fit=cover` and the real-device pass (8.2), retiring the mobile branch (8.4).

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. This plan was written against `df9a4771` (phase 4 complete). The mobile branch is the local ref `feat/mobile-responsive` (tip `1a6e3405`); read its files with `git show feat/mobile-responsive:<path>`. If an anchor has moved, apply the intended change to the current code and say so in the report.

## Global Constraints

From phases 1–4, unchanged:

- Every design token is a CSS custom property named `--ps-*`, declared only in `packages/core/src/styles/theme.ts`.
- New core stylesheets hold no raw colours (`#…`, `rgb()`, `hsl()`, `white`, `black`) and no literal font sizes; they read `--ps-*` tokens. Size literals such as `360px` for widths are fine.
- New code never declares tokens on `:host`; tokens come from `:root`.
- `css` literals live only in `*.styles.ts` files or `styles/` folders (ESLint rule in `eslint.config.mjs`; `styles-integrity.test.ts` finds them by glob). Non-style modules must not live in `packages/core/src/styles/`, because the integrity test treats every export there as a stylesheet.
- Kit elements use the `ps-` tag prefix; feature elements keep `protspace-`.
- Icons come from Lucide only, at stroke width 1.75 and sizes 14, 16 or 20 px.
- Popovers use `popover="manual"`; dialogs use `<dialog>.showModal()`. Both render in the top layer.
- Fonts are self-hosted; never load a third-party font CDN.
- Target browsers: the last two versions of Chrome, Edge, Firefox and Safari.
- Light accent values: fill `#007ab5` under white text, hover `#00699c`, accent text `#0369a1`, focus ring `#0284c7`. Dark: fill `#38bdf8` under `#04121c` text, hover `#7dd3fc`, accent text `#38bdf8`, focus `#38bdf8`.
- Every new export needs a consumer in the same commit (knip runs in the pre-commit hook); the task's own test file importing it is enough. Public kit API is exported from `packages/core/src/components/kit/index.ts`, which `packages/core/src/index.ts` re-exports. Exported types with no importer fail knip: keep option and view-model types module-private unless a consumer imports them.
- Commits: Angular `type(scope): subject` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), subject under 72 characters, at most two lines, never a `Co-Authored-By` or Claude trailer. Commit when the task's tests pass. The husky hook runs `pnpm precommit` (lint-staged, type-check, knip, docs checks, docs build); never bypass it on a task's final commit. Type-coupled changes land in one commit.
- Run core tests package-scoped: `pnpm --filter @protspace/core exec vitest --run --project unit <file>` or `--project browser <file>`.
- Dev and e2e servers use ports other than 8080, 8091 (the user's) and 8479 (the user's preview of this worktree; never stop it). For e2e set `PLAYWRIGHT_PORT`, e.g. `PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec>`.
- `--ps-text-faint` is for disabled text and decorative icons only; readable secondary text, hints, placeholders, keycaps and group labels use `--ps-text-muted`.
- Runtime elements are rendered by React exactly once, unconditionally, with stable ids, never keyed or moved; a parent may re-render, but never with a `key`, a conditional or a second tree around a runtime element. Phone, tablet and landscape layouts are CSS on the same tree: never a `PhoneShell`, never a second `#myImportMenu`, `#myExportMenu`, `#myProteinSearch`, `#myLegend` or `#myStructureViewer`. The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions` and `help` are kept for the tour, the e2e and the perf suites. `#myDataLoader` stays mounted, hidden. `#myStructureViewer` never changes parent (a disconnect disposes Mol*).
- React → runtime goes through the layout store or DOM events on elements the runtime wires by id; a React component may also call a public method of a core element it finds by id (`toggleFrom`, `openFrom`, `pick`, and this phase's `focusInput`), but never reads runtime state off an element. Runtime → React goes through `workbench-status.ts` or `layout-state.ts`. One exception this phase: the shell writes the transient `structureSheet` field through `setStructureSheet()` in `workbench-status.ts` (Task 5.8), which the structure controller subscribes to. React sets kit properties through props and listens to `ps-*` events with a ref and `addEventListener`.
- The shell (`apps/web/src/workbench/`) imports `@protspace/core` only as types (ESLint guard from the phase 4 exit, `eslint.config.mjs:82-101`); values it needs come from `@protspace/utils` or the app's own modules. Kit elements are used as custom-element tags.
- At rest no ancestor of the legend, the bars or the query builder (its pickers still use `position: fixed`, `query-builder.styles.ts`) gets `transform`, `translate`, `filter`, `contain` or `container-type`, and `#wb-sidebar` gets no z-index. The structure sheet's transform sits on `.wb-structure` only, which holds none of them. Shell z-indices are literals in `workbench.css` below the loading overlay's 9999; no z-index tokens.
- No ancestor of `#myImportMenu`, `#myExportMenu`, or any element that holds a popover gets `display: none` in any layout: a `popover="manual"` inside a `display: none` subtree never renders, even in the top layer (it opens as a 0×0 box). To hide a menu's own button, hide its `trigger` part (Task 5.4) and take the actions out of the bar at 0×0 (`position: absolute; width: 0; height: 0`).
- One plot resize per layout change. Switching Legend ↔ Filter (desktop rail or phone/tablet tabs), opening the selection bar, the status chips, toasts, the empty state, the drop area, the More sheet, the search overlay, and folding or expanding the phone structure sheet never change `#myPlot`'s box. Folding the phone bottom panel, a structure appearing while the panel is folded (Task 5.8), and a mode change each change it exactly once. The plot never animates. Nothing in this phase animates a fold (no fold animations in phase 5); the sheet's transform transition is the only motion, and `prefers-reduced-motion` turns it off.
- Layout persists only under `protspace:layout:v1`, parsed per field (a missing field takes its default, so the key stays v1); layout never goes into the URL. This phase adds one field, `panelFolded` (Task 5.6). Stored legend settings, `protspace_publishState` and the OPFS `protspace-last-import` directory keep their keys and formats.
- The legend's public surface, DOM contract and persistence stay as phases 3–4 left them (`docs/developers/api/index.md`); this phase adds only the `header-start` and `header-end` slots and the `title` part (Task 5.3) and touch handling inside its rows (Task 5.11). The legend adds no window listener and registers no Escape fallback. New legend logic goes into `legend-*.ts` modules or controllers, not `legend.ts` (2,154 lines); report `wc -l legend.ts` when touched.
- E2E: desktop specs stay `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Phone, tablet and landscape specs are `apps/web/tests/mobile-*.spec.ts` (project `mobile`, from Task 5.1); tablet and landscape tests call `page.setViewportSize` inside it, so `(pointer: coarse)` holds at every size. Specs reach controls through helpers (`helpers/explore.ts`, `helpers/workbench.ts`, `helpers/legend.ts`, and `helpers/mobile.ts` from Task 5.1) that find them by role, accessible name or tag; a helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement and state, not 3D pixels.
- Docs: the developer docs (`docs/developers/`) change in the commit that changes the public API or the architecture they describe (a new slot, part, property, method or dialog size is documented there). The user guide (`docs/explore/`) and its images wait for phase 7, except a statement that would become false (the docs build must stay green either way).
- `pnpm docs:images` stays broken at runtime until phase 7; `pnpm type-check:scripts` (in the hook) must stay green.

The kit, the layer stack and the style lint as phases 1–4 left them (read `packages/core/src/components/kit/` for the exact API; these facts override older descriptions):

- Tokens live in `@layer ps-theme` in `theme.ts`. Available sizes include `--ps-control-sm` 28, `-md` 32, `--ps-row` 28, `--ps-touch-target` 40 px; spaces `--ps-space-0-5` 2, `-1` 4, `-1-5` 6, `-2` 8, `-3` 12, `-5` 20, `-6` 24 px (no 16); radii `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`; `--ps-duration-fast` 120 ms, `--ps-duration` 160 ms, `--ps-ease`; shadows `--ps-shadow-sm`, `-md`, `-lg`; `--ps-scrim`. A task that needs a token `theme.ts` lacks adds it in the commit that first uses it (the unused-token check needs a reader).
- The style lint (`packages/core/src/styles/style-lint.test.ts`) checks every core stylesheet outside its `LEGACY` set (7 modules after phase 4: `projection-metadata.styles.ts`, `scatter-plot.styles.ts`, `protein-tooltip.styles.ts`, `structure-viewer.styles.ts`, `./mixins.ts`, `./overlay-mixins.ts`, `./tokens.ts`): no raw colour, no `oklch()`/`lab()`/`color()`, no `var()` read of a variable `theme.ts` does not define except the names in `RUNTIME_VARS` (today `--available-height`; Task 5.10 adds `--available-width`). A `LEGACY` entry must still violate; a task that cleans one removes its line in the same commit. Every task states its LEGACY count (7 unless it cleans one).
- `customElement` comes from `../../utils/safe-custom-element`, never from `lit/decorators.js`. Feature elements import kit modules by file (`import '../kit/menu'`), not the kit barrel.
- `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void`, `topLayer()`, `onEscapeFallback(order, handle)`, `ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 }`. Layer Escape and outside presses are window-capture listeners; an outside press (press and release both outside) closes only the top layer, on pointerup. Fallbacks run in the window bubble phase when nothing default-prevented the press.
- `ps-dialog` (`open`, `heading`, `size` sm/md/lg/full, plus `sheet` from Task 5.5, `dismissible`; `dismiss()`; slots default, `header-actions`, `footer`; `ps-close`): pushes a layer while open; renders its own close button "Close"; returns focus to the control focused or last pressed at open; autofocus waits for the footer.
- `ps-popover` (`.anchor`, `open`, `placement`, `panel-role`, `panel-label`; `ps-open`, `ps-close`; `dismiss()`), max-width `min(360px, 100vw - 16px)` until Task 5.10. `ps-menu` (`anchor`, `open`, `placement`, `label`, `searchable`): sets `aria-haspopup`/`aria-expanded` on its anchor; `ps-close` before `ps-select`. `ps-segmented` (`.options: SegmentedOption[]`, `value`, `label`; `change` with `detail.value`). `ps-icon-button` (`icon`, `label`, `pressed`, `size`, `tooltip-placement`, `expanded`, `hasPopup`). `ps-tooltip` (`text`, `.anchor`, `placement`, `names-target`) shows on `pointerenter` after 500 ms.
- Kit coarse-pointer rules that already exist: `kit/button.styles.ts:83` (40 px min height, icon-only 40 px wide), `kit/field.styles.ts:90`, `kit/menu.styles.ts:116` (40 px items), `legend/styles/row.ts:248` (40 px rows, actions always visible), `legend/legend-other-popover.styles.ts:104`.
- Icon keys present in `kit/icon.ts`: `arrow-down-0-1`, `arrow-down-1-0`, `arrow-down-a-z`, `arrow-down-narrow-wide`, `arrow-down-wide-narrow`, `arrow-down-z-a`, `arrow-up-down`, `box`, `check`, `chevron-down`, `circle-help`, `copy`, `download`, `ellipsis`, `external-link`, `eye`, `eye-off`, `filter`, `grip-vertical`, `info`, `lasso`, `list`, `maximize`, `minus`, `mouse-pointer`, `panel-right`, `panel-right-close`, `panel-right-open`, `picture-in-picture-2`, `search`, `sliders-horizontal`, `sparkles`, `square-dashed`, `square-pen`, `target`, `undo-2`, `upload`, `x`. This phase adds `chevron-up` and `zoom-in` (Task 5.6) when first used; a later task confirms a key is there and never adds it again. The React shell uses `lucide-react` with `strokeWidth={1.75}`.
- Core's Vite build keeps `/^lit(\/|$)/`, `/^@floating-ui\//`, `d3` and `@protspace/utils` external.

Environment (from the phase 1–4 ledgers; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run need the Bash sandbox disabled (`EPERM listen ::1` inside it). `--project unit` works inside the sandbox. A browser test can size the page with `page.viewport(width, height)` from `vitest/browser` (check the import the existing browser tests use).
- `pnpm add`/`pnpm install` and `git commit` need the sandbox disabled (the hook needs network and writes outside it). Stage files by path, never `git add -A`.
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; use `pnpm --filter @protspace/app exec vitest --run <file>` and `pnpm --filter @protspace/utils exec vitest --run <file>`.
- App unit tests run in node with no DOM and cannot load Lit: an app test that needs a core value imports it from core's source by relative path (`../../../../packages/core/src/…`), as `selection-controller.test.ts` does, or `vi.mock('@protspace/core', …)`. React components are covered by e2e only. Core jsdom tests cannot open `ps-popover`, `ps-menu` or `ps-dialog`: a test that opens one, measures layout or reads computed styles is a `*.browser.test.ts` (real `localStorage`: clear it in `afterEach`).
- `matchMedia` in node tests is a fake: pass query results in, or stub `window.matchMedia` with a controllable object; `layout-mode.ts` exposes `resetLayoutModeForTests()`.
- The legend's jsdom tests mount through `mountLegendWithScatterplot(data, annotation, plotOverrides)` in `legend/test-support/legend-scatterplot-harness.ts`; jsdom misses `'[part="symbol"] .legend-symbol path'` on rows after the first.
- CDP touch emulation in this Chromium switches `(pointer: coarse)` and `(hover: none)`; `page.touchscreen.tap()` dispatches touch events plus compat mouse events and a click. Chromium does not reproduce iOS's toolbar, iOS's missing dblclick or touch timing; the G5 test swallows `dblclick` to simulate iOS. Multi-touch (pinch) needs CDP `Input.dispatchTouchEvent` (`touchGesture` in `helpers/mobile.ts`).
- `pnpm perf:counts` imports `perf/datasets/phosphatase.parquetbundle` (fetch once with `pnpm perf:fetch --only phosphatase`, network, sandbox disabled); budgets live in `apps/web/tests/perf/budgets.json`, which no task in this phase edits. Perf runs at 1280×720 desktop with a pinned layout, so phone CSS does not reach them; the plot's hover path (Task 5.7) and the legend's pointer handling (Task 5.11) do.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build scans untracked files under `docs/`: leave no scratch markdown there.
- Playwright's `ControlOrMeta` sends Meta on a macOS host but the app reads the modifier from the user agent (Control in headless Chromium); use `Control` explicitly in specs that need the modifier (phase 4 exit fix).
- The plot area holds two `role="status"` regions (status corner and selection bar): scope `getByRole('status')` to its element. The dataset button's accessible name is `{name}, {n} proteins, switch dataset` (`datasetSwitcher` helper).
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race) and the `numeric-binning` "hover point" test under full-suite load; re-run once alone before investigating. The scatterplot's Lit "scheduled an update after an update completed" dev warning predates this phase (8.1 owns it).
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.

**Execution rule (user, 2026-10-13):** per task, run only the unit/browser test files for the code you touch plus at most ONE e2e spec file (filtered with `--project mobile -g "<title>"` or `--project workbench` as needed). The full suites, the full e2e run, `pnpm perf:counts` and `pnpm perf` run once, in "Phase 5 exit". Every task lists the existing e2e specs its change could reach under "Unrun at task time" so the exit run checks them first.

Baseline: run the suites at the start of the phase and use those counts, not phase 4's: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`, `PLAYWRIGHT_PORT=8475 pnpm test:e2e` and `pnpm perf:counts`. Record them in `.superpowers/sdd/phase-5-mobile/progress.md`; every task report gives the counts of the files it ran before and after, its LEGACY count, and `wc -l` of `scatter-plot.ts`, `legend.ts` and `structure-viewer.ts` when it touches them.

Phase 5:

- **Layout modes.** `LayoutMode = 'desktop' | 'tablet' | 'phone' | 'landscape'`. Queries (exact strings, in `layout-defaults.ts` as `LAYOUT_QUERIES`): `landscape: '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)'`, `desktop: '(min-width: 951px)'`, `phone: '(max-width: 640px)'`. Resolution order: landscape, then desktop, then phone, else tablet. The `max-width: 950px` cap on landscape keeps short desktop windows (1024×420, `workbench-loading.spec.ts:227`) desktop. Constants: `DESKTOP_MIN_WIDTH = 951` (kept), `PHONE_MAX_WIDTH = 640`, `LANDSCAPE_PHONE_MAX_HEIGHT = 500`. "Sheet modes" are `phone` and `landscape` (`hasStructureSheet(mode)`): the More sheet, the search toggle and the structure sheet live there.
- **Root attributes** on `div.workbench`: `data-layout` (the mode), `data-structure` (`none|docked|floating`; floating only on desktop), `data-sidebar`, `data-panel` (`legend|filter`), `data-panel-folded` (present when `layout.panelFolded` and mode is `phone`; Task 5.6), `data-sheet` (`folded|expanded`, present when the mode is a sheet mode and `data-structure` is not `none`; Task 5.8). The app bar carries `data-search-open` while the phone search overlay is open (Task 5.4).
- **Sizes (px).** Desktop and tablet bars: app bar 48, view bar 44 (unchanged). Phone: app bar 48, view bar 48, combined ≤ 97 incl. borders; every visible bar control ≥ 40×40 under a coarse pointer (the dataset name may end in an ellipsis and must keep > 40 px of name at 320 px). Tablet: body grid rows `minmax(0, 3fr)` / `minmax(0, 2fr)`, columns `minmax(0, 1fr) minmax(0, 1fr)`. Phone bottom panel: header 44 (the legend header, and the Filter panel's `.wb-panel-header`), height `clamp(144px, 32svh, 288px)` unfolded and the header plus its 1 px top border folded, the same height for both tabs. Structure sheet (phone): `--wb-sheet-folded: 56px` (12 grip + 44 header), expanded height `min(50svh, 416px)`, radius `var(--ps-radius-lg) var(--ps-radius-lg) 0 0`, `padding-bottom: env(safe-area-inset-bottom)`, `z-index: 6`, transform transition `var(--ps-duration) var(--ps-ease)`. Landscape: one combined bar 44; body `height: 100dvh`, columns `minmax(0, 1fr) minmax(192px, 32%)`; expanded structure `position: absolute` against `.wb-body` (`grid-area: auto; top: 0; right: 0; bottom: 0; width: 50vw`, under the bar). More sheet: `ps-dialog size="sheet"`, full width, pinned to the bottom edge, `max-height: min(85dvh, calc(100dvh - 48px))`, radius `var(--ps-radius-lg) var(--ps-radius-lg) 0 0`, scrolls inside.
- **Touch.** `TOUCH_HIT_RADIUS_PX = 20` (plot taps; mouse keeps 4). Long press 500 ms with 10 px move tolerance (legend names; Sortable uses `delay: 250, delayOnTouchOnly: true, touchStartThreshold: 5`). Double tap 300 ms (`DOUBLE_TAP_MS`). Coarse-pointer targets ≥ 40 px (`var(--ps-touch-target)`); keyed on `(pointer: coarse)`, never on width.
- **Mol\*.** The structure loads on the tap that requests it, folded or not; the viewer prefetches Mol* on the plot's first touch `pointerdown` (as it does on the first `protein-hover`).

Copy (exact strings; tests and helpers key on them):

| Where | Text |
| --- | --- |
| Panel tabs (5.3) | tablist "Sidebar panels"; tabs "Legend", "Filter" |
| Panel fold (5.6) | "Fold panel" (unfolded, `aria-expanded="true"`), "Unfold panel" (folded, `aria-expanded="false"`) |
| Phone search (5.4) | toggle "Search proteins"; overlay close "Close search" |
| More button (5.4/5.5) | name "More view options" / "More view options, {n} active" (unchanged); on sheet modes `aria-haspopup="dialog"` |
| More sheet (5.5) | dialog heading "More"; rows "Contours" (segmented "Off", "Auto", "Always" from `DENSITY_MODE_LABELS`), "Filter" with value "None" or `countNoun(n,'condition','conditions')`, "Import data", "Export", "Help & shortcuts" (disclosure; sub-rows "Documentation", "Keyboard shortcuts", "Take the tour"), "Feedback" |
| Structure sheet (5.8) | chevron "Show the structure" (folded, `aria-expanded="false"`) / "Hide the structure" (expanded, `aria-expanded="true"`); close stays "Close structure"; tooltip action stays "View structure" |
| Selection bar on phones (5.6) | visible text "{formatCount(n)} selected"; buttons keep names "Show only these", "Zoom to them", "Copy IDs", "Clear" (icons `target`, `zoom-in`, `copy`, `x`; labels screen-reader-only at ≤ 640 px) |

## Review Focus

1. **A runtime element re-created or re-parented when the mode changes.** Rotating a phone (phone ↔ landscape), crossing 640 or 951 px, opening the More sheet, the search overlay or the structure sheet must keep the same `#myPlot`, `#myLegend`, `#myStructureViewer`, `#myImportMenu`, `#myExportMenu`, `#myProteinSearch` and `#myQueryBuilder` instances (a re-created viewer disposes Mol*; a re-created plot drops the selection). Pinned by Task 5.2 (`mobile-shell.spec.ts` "the same runtime elements survive 1280, 800, 390 and 740×360") and the shell spec rename; every later task keeps that test green.
2. **Ghost input after a touch tap.** Compat mouse events after a tap start a hover tooltip or a legend-row highlight that touch can never end; a tap on the plot while the sheet is expanded shows a tooltip under the sheet; a long press on a legend name both shows the name and toggles the row. Pinned by Task 5.7 (`plot-interaction-controller.test.ts` compat-mouse cases; `mobile-plot-touch.spec.ts` P2/P3), Task 5.8 (P5: no tooltip while expanded), Task 5.10 (`ps-tooltip` ignores touch `pointerenter`) and Task 5.11 (no plot highlight after a row tap; long press does not toggle).
3. **Menus anchored to hidden controls.** On a phone the app bar's Import, Export and Help triggers are hidden; a menu anchored there opens at (0, 0) or off screen, and a menu whose ancestor is `display: none` opens as a 0×0 box. Pinned by Task 5.4 (`import-menu.browser.test.ts`/`export-menu.browser.test.ts` with the `trigger` part hidden), Task 5.5 (`export-menu.browser.test.ts` `openFrom`; `mobile-bars.spec.ts` C4 and the import/help rows open on screen), Task 5.9 (C9b: the same in landscape) and Task 5.10 (popovers beside a full-width anchor stay within [8, vw − 8]).
4. **The wrong mode for the window.** A short desktop window (1024×420) taken for a landscape phone; a 950×500 or 915×412 window not taken for one; a resize across a breakpoint resizing the plot more than once; the desktop sidebar's slide animating a static tablet aside. Pinned by Task 5.2 (`layout-mode.test.ts` boundary table; `workbench-loading.spec.ts:227` stays desktop) and Task 5.3 (`useSidebarTransition` gated to desktop; tablet tab switch: no plot resize).
5. **Phone chrome that eats the plot or hides its content.** The folded structure sheet covering the panel tabs or the last legend rows; a toast behind the bottom panel or the folded sheet, or floating far above them; the selection bar wider than a 360 px plot, or the status corner over it; the plot below 30% of a 360×640 screen; the folded panel not giving the plot its room. Pinned by Task 5.6 (L1, G6, P6 with the status corner, the toast-above-panel test with an upper bound, 360×640 plot-share test) and Task 5.8 (last legend row reachable above the folded sheet; a structure opening while the panel is folded resizes the plot once and a toast stays above the folded sheet).

## Rulings

Settled open questions (R1 Q1–Q7, R2 Q1–Q8, R3 Q1–Q6; the user adopted every recommended answer, so these record the decision and where notes disagreed):

- Tap model: under a touch pointer a tap pins the existing tooltip (no second "touch tooltip" state); 20 px touch hit radius, compat-mouse hover suppressed, the pin placed inside the plot. A touch tap pins even when `tooltipActions` is empty (tablet), unless the new plot property `tapTooltips` is false (R1 Q1, R3 B): one model, and a phone user needs a way to read a protein.
- "View structure" on a phone expands the structure sheet; while the sheet is expanded the structure controller sets `tooltipActions = []` and `tapTooltips = false`, so expanding unpins and a tap pins nothing (R3 Q6, decision 17).
- The structure sheet is app-owned: `WorkbenchStatus.structureSheet: 'folded' | 'expanded'`, a slotted chevron, a CSS transform, one new core part `body`; it opens folded on every reveal from none, is not persisted, has no drag in phase 5 and is no layer (non-modal; × and the chevron close and fold it) (R3 Q1, Q3, Q5). The branch's core `collapsed` property and `_coversPlot()` are not ported.
- Mol* loads on the tap that requests it, with a prefetch on the plot's first touch `pointerdown` (R3 Q2): the header needs the protein anyway, and a deferred-load property is a second state for little gain.
- The panel's Legend/Filter tabs and its fold chevron go in two new legend slots, `header-start` and `header-end`, plus the same React pieces at the ends of the Filter panel's header (R2 Q1): one 44 px row instead of a separate strip.
- Fold state persists as `panelFolded: boolean` (default false) in `protspace:layout:v1`, independent of `sidebarOpen`; the active tab reuses `panel` (R1 Q5, R2 Q5). Name settled as `panelFolded` (R2 said `bottomPanelFolded`; the panel is called "panel" everywhere else in the store).
- Landscape uses one combined 44 px bar (R2 Q2, frame 7). Its order keeps DOM and Tab order: wordmark, dataset, search button, then Projection, Color by, More. The mockup draws search last; moving it would need `order` or `display: contents` on the banner landmark, which splits visual and Tab order.
- The More sheet is `ps-dialog size="sheet"`, not a new element (R2 §3.4): it already has the top layer, focus containment, scrim, backdrop dismiss through the layer stack and focus return. No Theme row (6.1 adds it) and no GitHub link on phone (R2 Q3, Q6).
- Rows that act elsewhere close the sheet first, then act (the sheet is a layer: acting first would open a second layer under a closing one). Contours applies in place and keeps the sheet open. Export opens `#myExportMenu` through a new `openFrom(anchor)` anchored to the More button; Import opens `#myImportMenu.openFrom(datasetButton)`; Help & shortcuts expands three sub-rows inside the sheet (no menu anchored to a hidden trigger).
- Projection details stays on the phone view bar as its icon button (R1 Q6).
- No fold animations in phase 5 (R2 Q4): the panel fold is one instant resize.
- Tablet keeps the 50/50 legend/structure row even with no protein loaded; the right half shows the 44 px empty footer at its top (R2 Q7): a first click must not resize the plot.
- Layout modes come from one `matchMedia` source shared by the hook and the runtime (R1 Q3, R2 §3.1). Names: `'landscape'`, not `'phone-landscape'` (task statement). Landscape wins and is capped at 950 px wide.
- Breakpoints for shadow-DOM styles live in `packages/core/src/utils/breakpoints.ts` (not under `styles/`, whose exports must be stylesheets), consumed with `unsafeCSS`; `apps/web/src/explore/layout-defaults.ts` stays a leaf with its own literals, pinned equal by `layout-defaults.test.ts` (R2 Q8). The stale `--breakpoint-*` tokens in `tokens.ts` go in 8.1.
- Long legend names keep the ellipsis; a 500 ms long press on the name shows the full name through the existing `TruncatedNameTooltip` and suppresses the click that follows (R3 Q4).
- `viewport-fit=cover` is not added (R1 Q4); `env(safe-area-inset-*)` paddings resolve to 0 until the 8.2 real-device pass.
- Mobile tests: 34 of the branch's 38 are ported in 5.1 into the `mobile` project (Pixel 7, anchored `testMatch` `mobile-*.spec.ts`, `helpers/mobile.ts`). Each not-yet-passing test is written in full with `test.fixme(true, 'task 5.N')` as its first line; each later task's first step deletes its own fixmes and runs them red. The 2 tour tests (C11, C12) are ported with `test.fixme(true, 'task 7.4')`; the 4 landing tests are dropped and listed in the ledger for 8.4 (R1 Q2, Q7). P7 (statistics and tips buttons) is replaced by "the tool-strip buttons are touch targets" (tips moved to Help in phase 2).
- The Filter tab keeps the same panel height as Legend on a phone (R2 suggested raising it): a taller Filter panel would resize the plot on every tab switch, which the phase 4 constraint forbids; the builder scrolls inside, with Apply/Cancel reachable.
- The phone bottom panel reserves the folded sheet's 56 px while a structure is shown (`padding-bottom` unfolded; height header + 56 folded), so the folded sheet never covers the tabs or the last rows (R3 A). A structure appearing while the panel is folded is one plot resize.
- The search toggle closes its overlay on "Close search", on an Escape nothing else handled, and when focus leaves the app bar; it pushes no layer (the shell cannot import `pushLayer` as a value).
- The view bar's stage hook stops measuring in sheet modes and reports stage 3; phone CSS decides what shows. `workbench-view-bar.spec.ts`'s stage search floors at 641 px.
- Off desktop the Filter panel's "Close filter" is hidden; the tabs switch panels (the desktop rail's job). `FilterPanel.narrowReturnTarget()` goes.
- `openPanel(panel)` also unfolds the phone panel (`panelFolded: false`), so a status chip or the More sheet's Filter row always shows what it opened.

Settled in plan review (two judges; each finding checked against the code at `df9a4771`):

- Popovers and hidden ancestors: the import and export menus get a `trigger` CSS part (Task 5.4); phone and landscape hide only those parts and keep `[data-workbench='app-bar-actions']` rendered at 0×0. Landscape (Task 5.9) does the same, and C9b pins it; a Global Constraint now forbids `display: none` on any popover's ancestor.
- Landscape shows the search button and "Close search" (Task 5.9); Task 5.4 keys them on `phone` only.
- The More sheet's rows are slotted light-DOM children of `ps-dialog`: every test finds them through `moreSheetContent` (the scope `openMoreSheet` returns), never through the role dialog.
- More's `aria-haspopup`/`aria-expanded` are attributes, so the Export menu's anchor round trip restores them; this relies on React committing the sheet's close before `ps-menu` records the anchor. C4 asserts the restored attributes.
- Task 5.8 removes Task 5.6's interim `--wb-structure-row` entirely and carries the folded sheet's 56 px in `--wb-panel-height`, so phone toasts stand above the panel and the folded sheet; the 5.6 toast test gains an upper bound and 5.8 adds a folded-panel toast check.
- Under a coarse pointer the status corner rises above a 50 px selection bar (Task 5.6; the mouse rule's 38 px stays).
- `breakpoints.ts` exports `LANDSCAPE_PHONE_MEDIA` from Task 5.6 and gets its own core unit test, so every export has a reader inside core; Task 5.12 imports it instead of rebuilding the query.
- The projection details tests (P8, P10) inject a 30-parameter projection, so they test the scroll rather than passing because the fixture's card is short.
- At 360 px C1 exempts the Projection and Color by values from the truncation check (the pickers shrink with an ellipsis) and requires 48 px of visible value instead.
- Task 5.3 runs one e2e spec file (`mobile-explore-layout.spec.ts -g "tablet"`); C10 runs at the exit.
- Task 5.8 reuses Task 5.2's `fakeLayoutMode`/`setup({ mode })`; L2 keeps its Task 5.1 body.
- A tap on a spiderfied duplicate reads its own `pointerup`'s `pointerType` (the node stops `pointerdown` from reaching the svg, so the controller's `touchInput` may be stale).
- The touch-pin rule stands; its reason is that a touch pin needs no action and the phone controller's empty actions end the pin through `tapTooltips`. The controller writes `tooltipActions` only when its offer changes.
- The score-strip touch rule is pinned by a unit test in `legend.score-strips.test.ts`, not an e2e test that would skip on a dataset without category scores. (Judge B said the `.legend-item-score-hover` class does not exist; it does, `legend.ts:2118`, but the e2e test still pinned nothing on the startup dataset.)
- Not applied: splitting `workbench.css` into a mobile file (optional; it reaches about 1,900 lines, CSS is not an element file under decision 18, and one file keeps rule order obvious; reported at the exit for 8.1). Not applied: splitting Task 5.10 (it fits one implementer; its two commits are the split point if it ever runs out of room).
- Recorded for later, not fixed here: ⌘K/Ctrl+K focuses nothing on a phone while search is closed (no hardware-keyboard target on phones; 8.1); the folded legend's EAT and score controls stay in the Tab order (8.x accessibility pass); More is icon-only on phones although the mockup shows the word (listed at the exit as a visible difference).

Plan shape:

- Twelve tasks in three review blocks of four (5.1–5.4, 5.5–5.8, 5.9–5.12). Plot touch (5.7) precedes the structure sheet (5.8), which depends on its compat-mouse gate (R3 risk). Interim layouts keep the app working: from 5.2 every non-desktop mode uses the current narrow rules; from 5.3 they use the tablet grid; 5.6 and 5.8 specialise phone, 5.9 landscape.
- `tasks.md` section 5 is rewritten to list these twelve tasks in the commit that adds the plan; the ticks land at the end of the phase.

Test → task map for the ported fixmes (the label each `test.fixme(true, 'task 5.N')` carries):

| Spec | Test | Task |
| --- | --- | --- |
| mobile-explore-layout | L1 plot first, legend below, one screen | 5.6 |
| | L2 structure as a sheet along the bottom edge | 5.8 |
| | L3 tablet shares the row under the plot | 5.3 |
| | L4 turned sideways, scrolls past the bar to a full-screen plot | 5.9 |
| mobile-bars | C1, C2 bars fit with whole labels and 40 px targets at 360 / 412 | 5.4 |
| | C3 More sheet on screen, runs an action (Contours Auto → dot) | 5.5 |
| | C4 Export from the sheet; outside tap closes the menu | 5.5 |
| | C5 Color by menu within the viewport, its ⓘ bubble on screen | 5.10 |
| | C6 Filter tab shows the builder with Apply/Cancel on screen | 5.6 |
| | C7 a selected filter value's remove button is 40×40 | 5.12 |
| | C8 landscape keeps touch-sized bar targets | 5.9 |
| | C9 landscape More sheet fits and scrolls inside | 5.9 |
| | C10 portrait tablet (800×1280) keeps the desktop bars | 5.3 |
| | C11, C12 tour on a phone | 7.4 |
| mobile-legend | G1 row controls and header buttons are 40 px targets | 5.11 (unmarked if green at 5.1) |
| | G2 swipe on a handle scrolls, no reorder | 5.11 |
| | G3 long press on a handle reorders, no `.sortable-fallback` left | 5.11 |
| | G4 a tap toggles a category | green at 5.1 |
| | G5 double tap isolates with dblclick swallowed | 5.11 |
| | G6 the fold chevron gives the plot the room | 5.6 |
| | G7 the settings popover fits, controls ≥ 40 px | 5.10 |
| | G8 the figure editor fits, upright and at 740×360 | 5.12 |
| mobile-plot-touch | P1 pinch zooms the plot, not the page | 5.7 |
| | P2 tap near the right edge: tooltip inside the plot | 5.7 |
| | P3 tap on empty space or a pan closes the tooltip | 5.7 |
| | P4 first tap opens the sheet folded beside the tooltip | 5.8 |
| | P5 expanded sheet: no tooltip, plot in view, reopens folded | 5.8 |
| | P6 selection bar "1 protein selected", fits a 360 px plot | 5.6 |
| | P7 (replaced) tool-strip buttons are 40 px targets | 5.12 |
| | P8 projection details fits a 390×600 plot and scrolls | 5.10 |
| | P9 landscape structure sheet on the right half | 5.9 |
| | P10 landscape projection details fits and scrolls | 5.9 |

## File structure

`packages/core/src`

- `utils/breakpoints.ts`, `breakpoints.test.ts` (C 5.6; 5.12 imports `LANDSCAPE_PHONE_MEDIA`): `PHONE_MAX_WIDTH`, `DESKTOP_MIN_WIDTH`, `LANDSCAPE_PHONE_MAX_HEIGHT`, `PHONE_MEDIA`, `LANDSCAPE_PHONE_MEDIA`, `COMPACT_MEDIA` for shadow-DOM `@media` rules.
- `components/kit/dialog.ts`, `dialog.styles.ts`, `dialog.browser.test.ts` (M 5.5 `size="sheet"`; M 5.10 phone sizes for `full`, `md`, `lg`).
- `components/kit/position.ts`, `popover.styles.ts`, `popover.browser.test.ts` (M 5.10): beside-placement fallbacks, cross-axis shift, `--available-width`.
- `components/kit/choice.styles.ts`, `kit/tooltip.ts`, `kit/button.browser.test.ts`, `kit/fields.browser.test.ts` (M 5.10): coarse segmented/checkbox/switch targets; tooltips ignore touch.
- `components/kit/icon.ts` (M 5.6: `chevron-up`, `zoom-in`).
- `components/legend/legend-header.ts`, `legend.header.test.ts`, `legend/styles/header*.ts` (M 5.3): `header-start`/`header-end` slots, `title` part.
- `components/legend/legend-helpers.ts`, `legend-row.ts`, `legend-list.ts`, `controllers/drag-controller.ts`, `legend/styles/row.ts`, `legend.ts` (minimal), tests (M 5.11): double tap, mouse-only hover, long-press name, touch reorder.
- `components/scatter-plot/interaction/plot-interaction-controller.ts` (+ test) (M 5.7): pointer-type tracking, compat-mouse gate, `onClick(event, touch)`.
- `components/scatter-plot/scatter-plot.ts`, `scatter-plot.styles.ts`, new `scatter-plot.touch.browser.test.ts` (M 5.7): `tapTooltips`, touch hit radius, touch pin and placement, svg `touch-action: none`.
- `components/scatter-plot/tooltips/tooltip-position.ts` (+ test) (M 5.7): `computeTouchTooltipStyle` (reuses `effectiveTooltipWidth`; centred over the point inside the plot, else against the plot edge farther from the point).
- `components/scatter-plot/duplicate-stacks/spiderfy-layer.ts` (+ new `spiderfy-layer.touch.test.ts`) (M 5.12): coarse tap disc.
- `components/scatter-plot/projection-metadata/projection-metadata.ts`, `.styles.ts` (M 5.10): card fits a short plot and scrolls; hover does not stick after a tap.
- `components/plot-tools/selection-bar.ts`, `.styles.ts`, `.browser.test.ts` (M 5.6): icons and the phone rule; `plot-tools.browser.test.ts` (M 5.12): pins the kit's 40 px tool buttons (`plot-tools.styles.ts` unchanged).
- `components/structure-viewer/structure-viewer.ts`, `.styles.ts`, tests (M 5.3 delete the ≤950/≤550 `:host` width rules; M 5.8 `part="body"`, touch prefetch; M 5.12 coarse close and protein-pick targets).
- `components/export-menu/export-menu.ts`, `export-menu.browser.test.ts` (M 5.5): `openFrom(anchor)`.
- `components/protein-search/protein-search.ts` (+ test) (M 5.4): `focusInput()`.
- `components/projection-select/*.styles.ts`, `annotation-select/*.styles.ts`, `contours-menu/*.styles.ts` (M 5.4): coarse 40 px triggers.
- `components/common/info-popover.styles.ts` (M 5.10): coarse 40 px hit area.
- `components/query-builder/query-builder.styles.ts` (M 5.12): coarse `.value-chip-remove`.
- `components/publish/publish-modal.styles.ts` (M 5.12): column layout at ≤ 640 px, short-landscape row layout.
- `styles/style-lint.test.ts` (M 5.10: `--available-width` in `RUNTIME_VARS`).

`apps/web/src`

- `explore/layout-defaults.ts` (M 5.2: `LayoutMode`, `LAYOUT_QUERIES`, `PHONE_MAX_WIDTH`, `LANDSCAPE_PHONE_MAX_HEIGHT`; M 5.6: `panelFolded`).
- `explore/layout-defaults.test.ts` (C 5.6): app and core breakpoints agree.
- `explore/layout-mode.ts` (+ test) (C 5.2): the mode source.
- `explore/layout-state.ts` (+ test) (M 5.2 focus rule; M 5.6 `panelFolded`, `openPanel` unfolds).
- `explore/workbench-status.ts` (+ test) (M 5.8: `structureSheet`, `setStructureSheet`).
- `explore/structure-controller.ts` (+ test) (M 5.2 mode source; M 5.8 sheet rule).
- `explore/runtime.ts` (M 5.2 mode source for the structure and filter-count rules; M 5.6 folded panel stops the count).
- `workbench/use-layout-mode.ts` (M 5.2), `Workbench.tsx` (M 5.3, 5.6, 5.8), `workbench.css` (M 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9; about 1,900 lines by the end, reported at the exit).
- `workbench/PanelTabs.tsx` (C 5.3), `PanelFold.tsx` (C 5.6), `SearchToggle.tsx` (C 5.4), `MoreSheet.tsx` (C 5.5), `help-actions.ts` (C 5.5).
- `workbench/Sidebar.tsx`, `FilterPanel.tsx` (M 5.3 tabs; M 5.6 fold), `StructurePanel.tsx` (M 5.8 chevron, grip), `AppBar.tsx` (M 5.4), `ViewBar.tsx`, `MoreMenu.tsx`, `use-view-bar-stage.ts` (M 5.4, 5.5), `HelpMenu.tsx` (M 5.5), `use-sidebar-transition.ts` (M 5.3). Not modified: `FilterControl.tsx` (it compares the mode with `'desktop'`), `WorkbenchToaster.tsx` (CSS on `[data-sonner-toaster]` places phone toasts, Task 5.6).
- `lib/support.ts` (M 5.5: `FEEDBACK_HREF`).
- `custom-elements.d.ts`: no change this phase (legend children, `slot` and the dialog's `size` type through existing props; nothing in React sets `tapTooltips`).

`apps/web/tests`

- `playwright.config.ts` (M 5.1: project `mobile`).
- `helpers/mobile.ts` (C 5.1; M 5.3, 5.5, 5.6, 5.8 new locators when first used).
- `mobile-explore-layout.spec.ts`, `mobile-bars.spec.ts`, `mobile-legend.spec.ts`, `mobile-plot-touch.spec.ts` (C 5.1; each later task removes its fixmes and may add tests), `mobile-shell.spec.ts` (C 5.2).
- Modified: `workbench-shell.spec.ts` (5.2 rename; 5.3 tablet no scroll), `workbench-legend.spec.ts` (5.3 rename the 800 px test), `workbench-view-bar.spec.ts` (5.4 floor at 641), `dataset-reload.spec.ts` (5.4: the compact import affordance is the dataset button), `workbench-structure.spec.ts` (5.3: the 900 px case is side by side now), `eat-visualization.spec.ts` (5.6, only if the exit run shows its 320/360 px hover failing on the phone screen).

Docs: `docs/developers/api/index.md` (M 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10, 5.11, 5.12), `docs/developers/messaging.md` (M 5.5: `ps-dialog size="sheet"`), `docs/developers/architecture.md` (M 5.2: the layout-mode source). `openspec/changes/explore-workbench/tasks.md` (M with the plan; ticks at the phase end). `.superpowers/sdd/phase-5-mobile/progress.md` (5.1: the dropped landing tests for 8.4).

---

### Task 5.1: The mobile branch's phone tests ported (Playwright `mobile` project)

Adds the `mobile` Playwright project and the shared phone helpers, then ports the branch's 34 explore tests into four spec files against the workbench's controls, found by role and name. Every test is written in full for the target layout; the ones that cannot pass yet carry `test.fixme(true, 'task 5.N')` (the map in Rulings), so CI stays green and every test is accounted for. Test-only: no product code changes.

**Files:**

- Modify: `apps/web/tests/playwright.config.ts` (project `mobile` after `workbench`)
- Create: `apps/web/tests/helpers/mobile.ts`
- Create: `apps/web/tests/mobile-legend.spec.ts`, `mobile-plot-touch.spec.ts`, `mobile-explore-layout.spec.ts`, `mobile-bars.spec.ts`
- Modify: `.superpowers/sdd/phase-5-mobile/progress.md` (one line: the 4 landing tests, by title, dropped for 8.4) — git-ignored, no commit needed
- Read only: `git show feat/mobile-responsive:apps/web/tests/{mobile-explore-layout,mobile-control-bar,mobile-legend,mobile-plot-touch}.spec.ts` and `:apps/web/tests/playwright.config.ts`

**Interfaces:**

- Consumes: `waitForExploreDataLoad`, `waitForExploreInteractionReady`, `dismissTourIfPresent`, `appBar`, `viewBar`, `plotArea`, `sidebar`, `colorByTrigger`, `projectionTrigger`, `filterPanel`, `queryBuilder`, `filterApplyButton`, `selectionBar`, `datasetSwitcher`, `getContoursMode`, `getSelectedProteinIds` (`helpers/explore.ts`); `stubStructureRequests`, `structurePanel`, `seedLayout`, `readLayout`, `watchPlotResizes` (`helpers/workbench.ts`); `legend`, `legendRow`, `openLegendSettings`, `legendSettingsDialog` (`helpers/legend.ts`); the scatterplot's public `getProteinClientPosition(id)` (`scatter-plot.ts:2219`) and `getCurrentData()`/`data` for ids; Playwright `devices['Pixel 7']`.
- Produces:
  - Project `{ name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(^|[\\/])mobile-[^\\/]*\.spec\.ts$/ }` with a comment (decision 17; anchored because the pattern is matched against the absolute path). Lands in CI's chromium shard through `forBrowsers` with no workflow edit.
  - `helpers/mobile.ts` exports (each used by a spec in this task):
    - geometry: `type Box = { x: number; y: number; width: number; height: number }`, `type Point = { x: number; y: number }`, `box(locator): Promise<Box>` (throws when not rendered), `overlaps(a: Box, b: Box): boolean`, `expectWithinViewport(page, locator, slack = 1)`, `expectNoHorizontalOverflow(page)` (document `scrollWidth <= clientWidth`), `expectNoPageScroll(page)` (`scrollHeight <= clientHeight + 1`).
    - touch: `touchGesture(page, tracks: Point[][])` (CDP `Input.dispatchTouchEvent`, one track per finger), `line(from: Point, dx, dy, steps = 10): Point[]`, `touchDrag(page, point: Point, dy: number, restMs = 0)` (single finger; a rest before moving makes a long press), `tap(page, point: Point)` (`page.touchscreen.tap`).
    - plot: `proteinNear(page, fx: number, fy: number, maxY = Infinity): Promise<Point & { id: string }>` (the protein nearest the plot fraction `fx, fy`, from `getProteinClientPosition`), `proteinNearRightEdge(page)`, `emptyPlotSpot(page): Promise<Point>`, `plotTooltip(page)` (`#myPlot protspace-protein-tooltip`).
    - page: `openExplorePhone(page)` (`stubStructureRequests`, `goto('/explore')`, `waitForExploreDataLoad`, `dismissTourIfPresent`, `waitForExploreInteractionReady`).
    - phone locators: `moreButton(page)` (role button, name /More view options/ in the view bar), `moreSheet(page)` (role dialog "More"), `bottomPanel(page)` (`[data-workbench="sidebar"]`), `panelTab(page, name: 'Legend' | 'Filter')` (the visible role tab), `panelFold(page)` (role button /^(Fold|Unfold) panel$/), `searchToggle(page)` (role button "Search proteins"), `structureSheet(page)` (`[data-workbench="structure"]`), `sheetToggle(page)` (role button /^(Show|Hide) the structure$/), `touchTargetsBelow(page, root: Locator, min = 40)` (the visible `button`, `[role=button]`, `a`, `[role=tab]` inside `root`, piercing shadow roots through Playwright locators, smaller than `min` either way, with their names; the dataset button exempt from width truncation only).
    - added by this task's writer (an interface addition, see the notes below): `moreSheetContent(page)`, the `ps-dialog` host holding the "More" dialog, the scope for the sheet's slotted rows.
  - Spec files, one `test.describe` per screen, with `test.use({ viewport })` or `page.setViewportSize` for tablet (768×1024, 800×1280) and landscape (740×360, 915×412):
    - `mobile-explore-layout.spec.ts`: L1–L4.
    - `mobile-bars.spec.ts` (renamed from control-bar): C1–C12 (C1/C2 parameterised at 360×740 and 412×839).
    - `mobile-legend.spec.ts`: G1–G8.
    - `mobile-plot-touch.spec.ts`: P1–P10 (P7 replaced).
  - Fixme label per test exactly as the Rulings map; a test that unexpectedly passes at this commit lands unmarked and the report says which.

**Tests:** (assertions for the new layout; full text written now, red ones marked)

- L1: no horizontal overflow; no page scroll; `#myPlot` height ≥ 30% of the viewport and its bottom ≤ the bottom panel's top + 1; the bottom panel inside the viewport, under the plot.
- L2: tap a protein near the plot centre → `data-sheet="folded"` with the sheet's top at the viewport height − 56 ± 1 (it folds by transform, so its box runs below the edge); expanded by `sheetToggle` → x 0, full width, bottom at the viewport bottom ± 1, height < 0.7 × viewport height.
- L3 (768×1024): the plot's height ≈ 0.6 × (viewport − bars) ± 8 px; `#myLegend` and the structure section share top and height (± 1), the structure to the right of the legend, widths equal ± 1.
- L4 (740×360): plot height ≥ 0.6 × 360; scroll to the end; the plot's top ≥ 0, bottom ≤ 361; the plot-and-legend row height = 360 ± 1; the legend's x ≥ the plot's right edge − 1.
- C1/C2: app bar 48 and view bar 48, together ≤ 97; app bar shows only home, the dataset button and the search toggle (Import, Export, Help hidden); view bar shows Projection, details, Color by, More; `touchTargetsBelow` empty for both bars; no control has `scrollWidth > clientWidth` except the dataset name (and, below 400 px wide, the Projection and Color by values, which must each keep ≥ 48 px of visible value); no horizontal overflow.
- C3: `moreButton` opens `moreSheet` within the viewport with rows Contours, Filter, Import data, Export, Help & shortcuts, Feedback (no Theme, no GitHub); pick Contours "Auto" → `getContoursMode` is `auto`, the sheet stays open, and after closing More's name ends ", 1 active" with the dot shown.
- C4: More → Export closes the sheet and opens the Export menu within the viewport; a tap outside closes it; opened again, Escape closes it, focus returns to More, and More's `aria-haspopup="dialog"` and `aria-expanded="false"` are back.
- C5: `colorByTrigger` opens the annotation picker within the viewport; its first ⓘ bubble, opened by tap, lies inside the viewport.
- C6: Filter tab (or More → Filter) shows `#wb-filter-panel` in the bottom panel; one condition row and Apply/Cancel lie inside the viewport (after `scrollIntoViewIfNeeded` within the panel).
- C7: through the Filter tab, add a value; its `.value-chip-remove` box is ≥ 40×40.
- C8 (740×360): the combined bar has no target below 40 px.
- C9 (740×360): the More sheet's header stays in view while its last row (Feedback) is scrolled into view inside the sheet.
- C10 (800×1280): `data-layout="tablet"`; search, Import and Export visible in the app bar; More opens a menu (role menu), not the sheet.
- C11, C12: the branch's tour tests rewritten to role/name (fixme 'task 7.4').
- G1: `.legend-eye`, `.drag-handle`, `.legend-more`, sort and "Legend settings" boxes ≥ 40×40; rows ≤ 44 px tall.
- G2: a `touchDrag` from a handle with no rest scrolls the list (scroller's `scrollTop` grows) and keeps the order.
- G3: a 300 ms rest then a drag reorders the row; no `.sortable-fallback` element remains.
- G4: a tap toggles `.legend-item-main` `aria-pressed`.
- G5: with a capture-phase listener swallowing `dblclick`, two taps within 300 ms isolate the category (one row pressed).
- G6: `panelFold` folds: the plot grows by > 50 px, the tabs stay visible, `readLayout` has `panelFolded: true`; again unfolds.
- G7: "Legend settings" popover inside the viewport; its Reset ≥ 40 px (the popover has no close button).
- G8: Export → Figure editor: the dialog fills the viewport (± 1) and its "Close" is visible and ≥ 40 px, upright and at 740×360.
- P1: the plot's svg has `touch-action: none`; a two-finger spread zooms the plot (`_transform.k > 2` read through the element) and `visualViewport.scale === 1`, `scrollY === 0`.
- P2: a tap on `proteinNearRightEdge` shows `plotTooltip` with class `visible`, whose box lies inside the plot area.
- P3: a tap on `emptyPlotSpot`, and separately a one-finger pan, closes the tooltip.
- P4: first tap → `data-sheet="folded"`, the sheet's top ≥ the plot's bottom − 1, tooltip and sheet do not overlap, the tooltip offers "View structure"; a tap on a second protein keeps `folded`.
- P5: `sheetToggle` expands (`data-sheet="expanded"`); sheet height ≤ vh / 2 + 1 and top > plot top + 100; no tooltip; a tap on a protein above the sheet selects it (`getSelectedProteinIds` length 1) and shows no tooltip; fold → a tap shows the tooltip; "Close structure", then a tap → folded again. The tooltip's "View structure" also expands.
- P6: a tap selects one protein; `selectionBar` reads "1 protein selected" (screen-reader text) and lies inside the plot area at 360×740.
- P7 (replaced): the tool strip's buttons are ≥ 40×40.
- P8 (390×600): with a tall projection injected (30 parameters), the projection details card, opened by tap, lies inside the viewport, overflows its box and scrolls (`scrollHeight > clientHeight` on its scroller, and `scrollTop` moves).
- P9 (740×360): folded, the sheet sits under the legend in the right column beside the tooltip; expanded, width ≥ vw / 2 − 1, height ≥ 200, its close button does not overlap the links row.
- P10 (740×360): the projection details card fits the viewport and scrolls.

Verification: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile` (the one e2e command this task runs; every non-fixme test green, every fixme skipped). `pnpm exec prettier --check` on the new files; `pnpm quality` through the hook.

**Commit:** four commits, one per spec, in this order, each green on its own (the project and helper section A land with the legend spec, because knip needs a consumer for every export):
- `test(e2e): port the phone legend tests to the workbench` (with the `mobile` project and helpers section A)
- `test(e2e): port the phone plot touch tests to the workbench` (section B)
- `test(e2e): port the phone layout tests to the workbench` (section C)
- `test(e2e): port the phone bar tests to the workbench` (section D)

Writer's notes (read before Step 1):

- **One helper added to the interface:** `moreSheetContent(page)`, the `ps-dialog` host that holds the "More" dialog. `ps-dialog`'s host is `display: contents` and its rows are slotted light-DOM children, so a locator scoped to the role dialog (`moreSheet`) cannot reach them (the same reason `openLegendSettings` returns the popover's host). `moreSheet(page)` stays the role dialog, used for boxes and visibility; `moreSheetContent(page)` finds rows. Task 5.5 keeps the sheet's rows as light-DOM children of its `ps-dialog`.
- **helpers/mobile.ts grows commit by commit.** knip runs in the hook with `ignoreExportsUsedInFile: false`, so every export must have a spec importing it in the same commit. Section A lands with the legend spec, B with the plot spec, C with the layout spec, D with the bars spec. The final file is the four sections in order.
- **No `beforeEach` loads.** Each test calls `openExplorePhone(page)` after its `test.fixme(...)` line, so a fixme test stops before it loads the dataset (a `beforeEach` would load it for every skipped test).
- **Test titles start with their label** (`G4: …`, `P5: …`) so later tasks can run one with `-g "P5:"`.
- **Deviation from the Tests list, C4:** the outside tap is asserted to close the Export menu; focus returning to More is asserted after Escape instead. A touch press on the non-focusable plot blurs the menu's item before the layer closes on `pointerup`, and `ps-popover` returns focus only when focus was inside it, so "outside tap returns focus" would need a kit change no task owns.
- **Deviation, G7:** the settings popover has no close button (it closes on Escape or an outside press); G7 checks the panel and its Reset button.
- **Deviation, L2:** the folded sheet is translated down by `calc(100% - 56px)` (Task 5.8), so its layout box runs below the viewport. L2 checks the folded strip's top at `vh − 56`, then expands the sheet and checks the full-width, bottom-edge, `< 0.7 vh` box.

- [ ] **Step 1: Add the `mobile` project**

In `apps/web/tests/playwright.config.ts`, inside `projects: forBrowsers([ … ])`, insert this object right after the `workbench` project (the one with `testMatch: /(^|[\\/])workbench-[^\\/]*\.spec\.ts$/`) and before `kit-gallery`:

```ts
    {
      // Phones and tablets with touch (design decision 17): every mobile-*.spec.ts on an emulated
      // Pixel 7 (412 × 839, touch, Chromium). Tablet and landscape tests resize the page inside
      // it, so (pointer: coarse) holds at every size. Anchored to the file name: the pattern is
      // matched against the absolute path.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /(^|[\\/])mobile-[^\\/]*\.spec\.ts$/,
    },
```

Pixel 7's `defaultBrowserType` is chromium, so `forBrowsers` puts it in CI's chromium shard; no workflow edit.

- [ ] **Step 2: Create `apps/web/tests/helpers/mobile.ts`, section A**

```ts
/**
 * Phone, tablet and landscape helpers for the `mobile` project (design decision 17): geometry
 * checks, raw touch input through CDP, plot targets and the phone layout's controls. Controls are
 * found by role, accessible name or tag; Playwright's locators pierce shadow roots, so no helper
 * reaches into one by hand.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  viewBar,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './explore';
import { stubStructureRequests } from './workbench';

// ─── Geometry ──────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** The element's box in viewport pixels; throws when it is not rendered. */
export async function box(locator: Locator): Promise<Box> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`${locator} has no layout box`);
  return bounds;
}

/** Asserts that the element lies inside the viewport (within `slack` px) and returns its box. */
export async function expectWithinViewport(page: Page, locator: Locator, slack = 1): Promise<Box> {
  const viewport = page.viewportSize()!;
  const bounds = await box(locator);
  expect(bounds.x, `${locator}: left edge`).toBeGreaterThanOrEqual(-slack);
  expect(bounds.y, `${locator}: top edge`).toBeGreaterThanOrEqual(-slack);
  expect(bounds.x + bounds.width, `${locator}: right edge`).toBeLessThanOrEqual(
    viewport.width + slack,
  );
  expect(bounds.y + bounds.height, `${locator}: bottom edge`).toBeLessThanOrEqual(
    viewport.height + slack,
  );
  return bounds;
}

// ─── Touch ─────────────────────────────────────────────────────────────────────

/**
 * One finger down at `point`, an optional rest (a long press), then a vertical move of `dy` in
 * ten steps, one frame apart, and up.
 */
export async function touchDrag(page: Page, point: Point, dy: number, restMs = 0): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (y: number) => [{ x: point.x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(point.y) });
  if (restMs) await page.waitForTimeout(restMs);
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(point.y + (dy * step) / 10),
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * Opens /explore on the emulated device with the structure requests answered offline, waits for
 * the startup dataset and closes the product tour.
 */
export async function openExplorePhone(page: Page): Promise<void> {
  await stubStructureRequests(page);
  await page.goto('/explore');
  await waitForExploreDataLoad(page);
  await dismissTourIfPresent(page);
  await waitForExploreInteractionReady(page);
}

// ─── Phone controls ────────────────────────────────────────────────────────────

/** The view bar's More button; its name reads "More view options" (", N active" with its dot). */
export const moreButton = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^More view options/ });

/** The More bottom sheet: the dialog named "More" (its box, its heading and its Close). */
export const moreSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'More', exact: true });

/**
 * The More sheet's `ps-dialog` host, the scope for its rows: they are slotted light-DOM children,
 * which a locator scoped to the dialog element does not reach.
 */
export const moreSheetContent = (page: Page): Locator =>
  page.locator('ps-dialog').filter({ has: moreSheet(page) });

/**
 * The shown Legend or Filter tab of the panel under the plot. Each panel's header holds a copy of
 * the tabs; only the shown panel's copy is visible.
 */
export const panelTab = (page: Page, name: 'Legend' | 'Filter'): Locator =>
  page.getByRole('tab', { name, exact: true }).filter({ visible: true });

/** The phone panel's fold chevron, "Fold panel" or "Unfold panel", in the shown panel's header. */
export const panelFold = (page: Page): Locator =>
  page.getByRole('button', { name: /^(Fold|Unfold) panel$/ }).filter({ visible: true });
```

- [ ] **Step 3: Write `apps/web/tests/mobile-legend.spec.ts`**

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportMenu } from './helpers/explore';
import {
  legend,
  legendRowValues,
  legendSettingsDialog,
  legendSortButton,
} from './helpers/legend';
import {
  box,
  expectWithinViewport,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelFold,
  panelTab,
  touchDrag,
  type Box,
  type Point,
} from './helpers/mobile';
import { readLayout } from './helpers/workbench';

/**
 * The legend on a phone (ported from feat/mobile-responsive, design decision 17): touch targets,
 * tap, double tap, swipe and long press on its rows, the panel's fold, and the dialogs it opens.
 */

const rows = (page: Page): Locator => legend(page).locator('.legend-item');

/** The main button of the row holding `value`, found by the row's data-value. */
const rowMain = (page: Page, value: string): Locator =>
  legend(page).locator(`.legend-item[data-value=${JSON.stringify(value)}] .legend-item-main`);

/** The value of the row at `index` in display order. */
async function rowValue(page: Page, index: number): Promise<string> {
  const value = await rows(page).nth(index).getAttribute('data-value');
  if (value === null) throw new Error(`Legend row ${index} has no data-value`);
  return value;
}

async function centre(locator: Locator): Promise<Point> {
  const bounds = await box(locator);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

const listScrollTop = (page: Page): Promise<number> =>
  legend(page)
    .locator('.legend-items')
    .evaluate((list) => list.scrollTop);

test.describe('the legend on a phone', () => {
  test('G1: each row control and header button is a 40 px touch target', async ({ page }) => {
    await openExplorePhone(page);
    const first = rows(page).first();
    const targets: Record<string, Box> = {
      eye: await box(first.locator('.legend-eye')),
      handle: await box(first.locator('.drag-handle')),
      more: await box(legend(page).locator('.legend-more').first()),
      sort: await box(legendSortButton(page)),
      settings: await box(
        legend(page).getByRole('button', { name: 'Legend settings', exact: true }),
      ),
    };
    for (const [name, target] of Object.entries(targets)) {
      expect(target.width, `${name} width`).toBeGreaterThanOrEqual(40);
      expect(target.height, `${name} height`).toBeGreaterThanOrEqual(40);
    }
    // A one-line row is no taller than its targets.
    expect((await box(first)).height).toBeLessThanOrEqual(44);
  });

  test('G2: a swipe that starts on a drag handle scrolls the rows without reordering them', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.11');
    await openExplorePhone(page);
    const before = await legendRowValues(page);

    await touchDrag(page, await centre(rows(page).nth(2).locator('.drag-handle')), -100);

    await expect.poll(() => listScrollTop(page)).toBeGreaterThan(30);
    expect(await legendRowValues(page)).toEqual(before);
  });

  test('G3: a long press on a drag handle lifts the row to reorder it', async ({ page }) => {
    test.fixme(true, 'task 5.11');
    await openExplorePhone(page);
    const [first, second] = await legendRowValues(page);

    // Past Sortable's 250 ms touch delay, then down by a little over a row.
    await touchDrag(page, await centre(rows(page).first().locator('.drag-handle')), 60, 400);

    await expect.poll(async () => (await legendRowValues(page)).slice(0, 2)).toEqual([second, first]);
    // A touch drag floats a copy of the row; the drop must not leave it behind.
    await expect(page.locator('.sortable-fallback')).toHaveCount(0);
  });

  test('G4: a tap toggles a category', async ({ page }) => {
    await openExplorePhone(page);
    const row = rowMain(page, await rowValue(page, 1));

    await row.tap();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    // Further apart than a double tap (300 ms), so the second tap shows the row again rather
    // than isolating it.
    await page.waitForTimeout(400);
    await row.tap();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('G5: a double tap isolates a category, even where the browser sends no dblclick', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.11');
    await openExplorePhone(page);
    // iOS Safari sends no dblclick for a double tap; stand in for it by swallowing Chromium's.
    await page.evaluate(() =>
      window.addEventListener('dblclick', (event) => event.stopImmediatePropagation(), true),
    );
    const row = rowMain(page, await rowValue(page, 1));

    await row.tap();
    await row.tap();

    await expect(legend(page).locator('.legend-item-main[aria-pressed="true"]')).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('G6: the fold chevron folds the rows away and gives the plot the room', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    const plotHeight = async () => (await box(page.locator('#myPlot'))).height;
    const before = await plotHeight();

    await panelFold(page).tap();

    await expect(panelFold(page)).toHaveAccessibleName('Unfold panel');
    await expect.poll(plotHeight).toBeGreaterThan(before + 50);
    await expect(panelTab(page, 'Legend')).toBeVisible();
    await expect(rows(page).first()).toBeHidden();
    expect(await readLayout(page)).toMatchObject({ panelFolded: true });

    await panelFold(page).tap();
    await expect(panelFold(page)).toHaveAccessibleName('Fold panel');
    await expect(rows(page).first()).toBeVisible();
    await expect.poll(plotHeight).toBeCloseTo(before, 0);
    expect(await readLayout(page)).toMatchObject({ panelFolded: false });
  });

  test('G7: the settings popover fits the screen with its controls in reach', async ({ page }) => {
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    await legend(page).getByRole('button', { name: 'Legend settings', exact: true }).tap();

    const panel = legendSettingsDialog(page);
    await expect(panel).toBeVisible();
    await expectWithinViewport(page, panel);
    // The popover's controls are slotted: scope them to its element, not to the panel.
    const settings = legend(page).locator('protspace-legend-settings-popover');
    const reset = await expectWithinViewport(
      page,
      settings.getByRole('button', { name: 'Reset', exact: true }),
    );
    expect(reset.height).toBeGreaterThanOrEqual(40);
  });

  test('G8: the Figure editor fits the screen with its close control, upright and sideways', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.12');
    await openExplorePhone(page);
    // On a phone, Export lives in the More sheet; the sheet closes before the menu opens.
    await moreButton(page).tap();
    await moreSheetContent(page)
      .getByRole('button', { name: /^Export/ })
      .tap();
    await expect(moreSheet(page)).toBeHidden();
    await exportMenu(page).getByRole('menuitem', { name: 'Figure editor…', exact: true }).tap();

    const editor = page.getByRole('dialog', { name: 'Figure editor', exact: true });
    await expect(editor).toBeVisible();
    for (const size of [null, { width: 740, height: 360 }]) {
      if (size) await page.setViewportSize(size);
      const viewport = page.viewportSize()!;
      await expect
        .poll(async () => {
          const bounds = await box(editor);
          return Math.max(
            Math.abs(bounds.x),
            Math.abs(bounds.y),
            Math.abs(bounds.width - viewport.width),
            Math.abs(bounds.height - viewport.height),
          );
        })
        .toBeLessThanOrEqual(1);
      const close = editor.getByRole('button', { name: 'Close', exact: true });
      await expect(close).toBeVisible();
      const bounds = await expectWithinViewport(page, close);
      expect(bounds.width).toBeGreaterThanOrEqual(40);
      expect(bounds.height).toBeGreaterThanOrEqual(40);
    }
  });
});
```

G1 carries no fixme yet: Step 4 decides.

- [ ] **Step 4: Run the legend spec; settle G1**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`
Expected: G4 passes; G2, G3, G5, G6, G7, G8 are skipped (fixme). G1 either passes (keep it unmarked and say so in the report) or fails on the row actions' size (expected on HEAD: `.legend-eye`, `.drag-handle` and `.legend-more` have no 40 px coarse rule yet). If it fails, add `test.fixme(true, 'task 5.11');` as G1's first line and run again: 1 passed, 7 skipped. G4 must pass; if it fails, report the failure (R1 classed it green on HEAD) rather than marking it.

- [ ] **Step 5: Commit the project, the helpers (section A) and the legend spec**

Run: `pnpm exec prettier --check apps/web/tests/playwright.config.ts apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-legend.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on them first if not).

```bash
git add apps/web/tests/playwright.config.ts apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-legend.spec.ts
git commit -m "test(e2e): port the phone legend tests to the workbench" -m "Adds the mobile Playwright project and the phone test helpers."
```

(The sandbox must be disabled for `git commit`: the hook needs the network. The hook's knip run is what proves every section-A export has a consumer.)

- [ ] **Step 6: Add section B to `helpers/mobile.ts`**

Append to `apps/web/tests/helpers/mobile.ts` (no import changes):

```ts
// ─── More touch ────────────────────────────────────────────────────────────────

/** `steps + 1` points from `from`, moving by (dx, dy) in equal steps. */
export function line(from: Point, dx: number, dy: number, steps = 10): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + (dx * i) / steps,
    y: from.y + (dy * i) / steps,
  }));
}

/**
 * Raw touch points through CDP, one track per finger, all tracks the same length: touchStart at
 * each track's first point, a touchMove per later point, then touchEnd. A pinch is two tracks.
 */
export async function touchGesture(page: Page, tracks: Point[][]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (step: number) =>
    tracks.map((track, id) => ({ x: track[step].x, y: track[step].y, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let step = 1; step < tracks[0].length; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** A one-finger tap: touch events, the compat mouse events and a click, as a phone sends them. */
export async function tap(page: Page, point: Point): Promise<void> {
  await page.touchscreen.tap(point.x, point.y);
}

/** Whether two boxes share any area. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// ─── Plot ──────────────────────────────────────────────────────────────────────

type PlotElement = HTMLElement & {
  data: { protein_ids: string[] };
  getProteinClientPosition(proteinId: string): Point | null;
};

/** The plot's protein tooltip (hover or pinned); it exists only while shown. */
export const plotTooltip = (page: Page): Locator =>
  page.locator('#myPlot protspace-protein-tooltip');

/** The structure section: the phone's bottom sheet, the tablet's right half, desktop's dock. */
export const structureSheet = (page: Page): Locator => page.locator('[data-workbench="structure"]');

/** The structure sheet's chevron: "Show the structure" folded, "Hide the structure" expanded. */
export const sheetToggle = (page: Page): Locator =>
  structureSheet(page).getByRole('button', { name: /^(Show|Hide) the structure$/ });

/**
 * The plotted protein nearest the spot at fractions (fx, fy) of the plot's box, in viewport
 * pixels with its id. It stays clear of the tool strip (left 64 px), the top 60 px, the status
 * corner (bottom 50 px) and the window's edge, and above `maxY` so a sheet below cannot cover it.
 */
export async function proteinNear(
  page: Page,
  fx: number,
  fy: number,
  maxY = Infinity,
): Promise<Point & { id: string }> {
  const found = await page.locator('#myPlot').evaluate(
    (element: PlotElement, { fx, fy, maxY }) => {
      const rect = element.getBoundingClientRect();
      const target = { x: rect.left + rect.width * fx, y: rect.top + rect.height * fy };
      const bottom = Math.min(rect.bottom - 50, maxY, window.innerHeight - 8);
      let best: { x: number; y: number; id: string } | null = null;
      let bestDistance = Infinity;
      for (const id of element.data.protein_ids) {
        const p = element.getProteinClientPosition(id);
        if (!p || p.x < rect.left + 64 || p.x > rect.right - 16) continue;
        if (p.y < Math.max(rect.top, 0) + 60 || p.y > bottom) continue;
        const distance = Math.hypot(p.x - target.x, p.y - target.y);
        if (distance < bestDistance) [best, bestDistance] = [{ ...p, id }, distance];
      }
      return best;
    },
    { fx, fy, maxY },
  );
  if (!found) throw new Error(`No protein near (${fx}, ${fy}) of the plot`);
  return found;
}

/**
 * The plotted protein farthest right, in the upper half of the screen (clear of a structure
 * sheet) and below the plot's top 60 px.
 */
export async function proteinNearRightEdge(page: Page): Promise<Point & { id: string }> {
  const found = await page.locator('#myPlot').evaluate((element: PlotElement) => {
    const rect = element.getBoundingClientRect();
    const bottom = Math.min(rect.bottom - 50, window.innerHeight / 2 - 30);
    let best: { x: number; y: number; id: string } | null = null;
    for (const id of element.data.protein_ids) {
      const p = element.getProteinClientPosition(id);
      if (!p || p.y < Math.max(rect.top, 0) + 60 || p.y > bottom || p.x > rect.right - 4) continue;
      if (!best || p.x > best.x) best = { ...p, id };
    }
    return best;
  });
  if (!found) throw new Error('No protein near the plot’s right edge');
  return found;
}

/**
 * A spot on the visible plot with no protein within 40 px, clear of the tool strip, the status
 * corner, the selection bar, a shown tooltip and a shown structure sheet.
 */
export async function emptyPlotSpot(page: Page): Promise<Point> {
  const avoid: Box[] = [];
  for (const overlay of [plotTooltip(page), structureSheet(page)]) {
    if (await overlay.isVisible().catch(() => false)) avoid.push(await box(overlay));
  }
  const spot = await page.locator('#myPlot').evaluate((element: PlotElement, avoid) => {
    const rect = element.getBoundingClientRect();
    const boxes = [...avoid];
    // Light-DOM siblings of the plot inside the plot area.
    for (const id of ['myPlotTools', 'myPlotStatus', 'mySelectionBar']) {
      const r = document.getElementById(id)?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) boxes.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    }
    const covered = (x: number, y: number) =>
      boxes.some(
        (b) => x >= b.x - 8 && x <= b.x + b.width + 8 && y >= b.y - 8 && y <= b.y + b.height + 8,
      );
    const points = element.data.protein_ids
      .map((id) => element.getProteinClientPosition(id))
      .filter((p): p is { x: number; y: number } => p !== null);
    const top = Math.max(rect.top, 0) + 20;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 20;
    for (let y = top; y < bottom; y += 10) {
      for (let x = rect.left + 20; x < rect.right - 20; x += 10) {
        if (covered(x, y)) continue;
        if (points.every((p) => Math.hypot(p.x - x, p.y - y) > 40)) return { x, y };
      }
    }
    return null;
  }, avoid);
  if (!spot) throw new Error('No empty spot on the plot');
  return spot;
}

// ─── Touch targets ─────────────────────────────────────────────────────────────

/**
 * The visible buttons, links and tabs inside `root` (through shadow roots) smaller than `min`
 * px either way, as "name: W×H". Empty when every target is finger-sized.
 */
export async function touchTargetsBelow(page: Page, root: Locator, min = 40): Promise<string[]> {
  return root
    .locator('button, [role="button"], a[href], [role="tab"]')
    .evaluateAll(
      (elements, limit) =>
        elements.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return [];
          if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
            return [];
          }
          if (rect.width >= limit - 0.5 && rect.height >= limit - 0.5) return [];
          const name = (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
          return [`${name || element.tagName.toLowerCase()}: ${size}`];
        }),
      min,
    );
}
```

`page` in `touchTargetsBelow` is part of the agreed signature; it is unused (allowed: `noUnusedParameters` is off and ESLint's `after-used` ignores a leading argument).

- [ ] **Step 7: Write `apps/web/tests/mobile-plot-touch.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import {
  getSelectedProteinIds,
  plotArea,
  selectionBar,
  viewBar,
} from './helpers/explore';
import {
  box,
  emptyPlotSpot,
  expectWithinViewport,
  line,
  openExplorePhone,
  overlaps,
  plotTooltip,
  proteinNear,
  proteinNearRightEdge,
  sheetToggle,
  structureSheet,
  tap,
  touchGesture,
  touchTargetsBelow,
  type Point,
} from './helpers/mobile';

/**
 * The plot under a finger (ported from feat/mobile-responsive, design decision 17): pinch, tap to
 * pin a tooltip, the structure sheet a tap opens, the selection bar, the tool strip and the
 * projection details card.
 */

const workbench = (page: Page) => page.locator('.workbench');
const selectedCount = async (page: Page) => (await getSelectedProteinIds(page)).length;

/**
 * Gives the projection details a card taller than any phone screen, opens it from its view-bar
 * button, and checks it fits the viewport and scrolls (the fixture's own card is short, so it
 * would fit without ever scrolling; workbench-escape.spec.ts injects a projection the same way).
 */
async function expectProjectionDetailsFit(page: Page): Promise<void> {
  await page.locator('#myProjectionMetadata').evaluate((details: Element) => {
    (details as Element & { projection: unknown }).projection = {
      name: 'Fixture projection',
      metadata: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`parameter_${i}`, i])),
    };
  });
  await viewBar(page).getByRole('button', { name: 'View projection metadata' }).tap();
  const card = page.locator('#myProjectionMetadata .content');
  await expect(card).toBeVisible();
  await expectWithinViewport(page, card);
  // The card is taller than the room it has, so it must scroll to what does not fit.
  expect(
    await card.evaluate((element) => element.scrollHeight > element.clientHeight),
    'the tall card overflows its box',
  ).toBe(true);
  const scrolled = await card.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0;
  });
  expect(scrolled, 'the card scrolls to what does not fit').toBe(true);
}

/** Scrolls the landscape page past its bar, at once (the page scrolls smoothly by default). */
async function scrollPastTheBar(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
}

test.describe('the plot on a touch screen', () => {
  test('P1: a pinch zooms the plot, not the page', async ({ page }) => {
    test.fixme(true, 'task 5.7');
    await openExplorePhone(page);
    // Without it, the browser would scroll or zoom the page on a pan or pinch d3-zoom also takes.
    const touchAction = await page
      .locator('#myPlot .container > svg')
      .evaluate((svg) => getComputedStyle(svg).touchAction);
    expect(touchAction).toBe('none');

    const plot = await box(page.locator('#myPlot'));
    const centre: Point = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
    await touchGesture(page, [
      line({ x: centre.x - 20, y: centre.y }, -80, 0),
      line({ x: centre.x + 20, y: centre.y }, 80, 0),
    ]);

    await expect
      .poll(() =>
        page
          .locator('#myPlot')
          .evaluate((element) => (element as unknown as { _transform: { k: number } })._transform.k),
      )
      .toBeGreaterThan(2);
    const view = await page.evaluate(() => ({
      scale: window.visualViewport?.scale,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }));
    expect(view).toEqual({ scale: 1, scrollX: 0, scrollY: 0 });
  });

  test('P2: a tap near the right edge shows the tooltip inside the plot', async ({ page }) => {
    test.fixme(true, 'task 5.7');
    await openExplorePhone(page);
    await tap(page, await proteinNearRightEdge(page));

    await expect(plotTooltip(page)).toHaveClass(/visible/);
    const plot = await box(page.locator('#myPlot'));
    const card = await box(plotTooltip(page));
    expect(card.x).toBeGreaterThanOrEqual(plot.x);
    expect(card.y).toBeGreaterThanOrEqual(plot.y);
    expect(card.x + card.width).toBeLessThanOrEqual(plot.x + plot.width);
    expect(card.y + card.height).toBeLessThanOrEqual(plot.y + plot.height);
  });

  test('P3: a tap on empty space or a pan closes the tooltip', async ({ page }) => {
    test.fixme(true, 'task 5.7');
    await openExplorePhone(page);
    const target = await proteinNearRightEdge(page);
    await tap(page, target);
    await expect(plotTooltip(page)).toHaveCount(1);

    await tap(page, await emptyPlotSpot(page));
    await expect(plotTooltip(page)).toHaveCount(0);

    await tap(page, target);
    await expect(plotTooltip(page)).toHaveCount(1);
    await touchGesture(page, [line(await emptyPlotSpot(page), 40, 30)]);
    await expect(plotTooltip(page)).toHaveCount(0);
  });

  test('P4: a first tap opens the sheet folded beside the tooltip', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    await tap(page, await proteinNearRightEdge(page));

    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
    const plot = await box(page.locator('#myPlot'));
    const sheet = await box(structureSheet(page));
    expect(sheet.y).toBeGreaterThanOrEqual(plot.y + plot.height - 1);
    expect(overlaps(await box(plotTooltip(page)), sheet)).toBe(false);

    // Another protein leaves the sheet as it was.
    await tap(page, await proteinNear(page, 0.3, 0.4));
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  });

  test('P5: an expanded sheet covers no tooltip and leaves the plot in view', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    const viewportHeight = page.viewportSize()!.height;
    await tap(page, await proteinNearRightEdge(page));
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(sheetToggle(page)).toHaveAccessibleName('Hide the structure');
    // The sheet has slid up once its bottom edge is the window's.
    await expect
      .poll(async () => {
        const sheet = await box(structureSheet(page));
        return Math.abs(sheet.y + sheet.height - viewportHeight);
      })
      .toBeLessThanOrEqual(1);
    const plot = await box(page.locator('#myPlot'));
    const sheet = await box(structureSheet(page));
    expect(sheet.height).toBeLessThanOrEqual(viewportHeight / 2 + 1);
    expect(sheet.y).toBeGreaterThan(plot.y + 100);
    await expect(plotTooltip(page)).toHaveCount(0);

    // A protein tapped above the open sheet is selected, and no tooltip opens over the plot.
    await tap(page, await proteinNear(page, 0.3, 0.3, sheet.y - 20));
    await expect.poll(() => selectedCount(page)).toBe(1);
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(plotTooltip(page)).toHaveCount(0);

    // Folded again, a tap pins the tooltip, and its View structure expands the sheet.
    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await tap(page, await proteinNear(page, 0.6, 0.3, sheet.y - 20));
    await expect(plotTooltip(page)).toHaveCount(1);
    await plotTooltip(page).getByRole('button', { name: 'View structure' }).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect(plotTooltip(page)).toHaveCount(0);

    // Closed, the sheet starts over: the next protein opens it folded.
    await structureSheet(page).getByRole('button', { name: 'Close structure', exact: true }).tap();
    await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
    await tap(page, await proteinNear(page, 0.4, 0.4));
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  });

  test('P7: the tool strip buttons are 40 px touch targets', async ({ page }) => {
    test.fixme(true, 'task 5.12');
    await openExplorePhone(page);
    const tools = page.getByRole('toolbar', { name: 'Plot tools', exact: true });
    await expect(tools).toBeVisible();
    expect(await touchTargetsBelow(page, tools)).toEqual([]);
  });
});

test.describe('the plot on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('P6: the selection bar counts one protein and fits the plot', async ({ page }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    await tap(page, await proteinNear(page, 0.5, 0.4));

    await expect.poll(() => selectedCount(page)).toBe(1);
    await expect(page.locator('#mySelectionBar').getByRole('status')).toHaveText(
      '1 protein selected',
    );
    await expect(selectionBar(page)).toBeVisible();
    const bar = await box(selectionBar(page));
    const area = await box(plotArea(page));
    expect(bar.x).toBeGreaterThanOrEqual(area.x);
    expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width);
    expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + area.height);
    // The status corner rises above the touch-sized bar (about 50 px under a coarse pointer).
    expect(overlaps(await box(page.locator('#myPlotStatus')), bar)).toBe(false);
  });
});

test.describe('the plot on a short phone screen', () => {
  test.use({ viewport: { width: 390, height: 600 } });

  test('P8: the projection details card fits the short plot and scrolls', async ({ page }) => {
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    await expectProjectionDetailsFit(page);
  });
});

test.describe('the plot on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('P9: the structure folds under the legend and expands over the right half', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await scrollPastTheBar(page);
    await tap(page, await proteinNear(page, 0.3, 0.5));

    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect(plotTooltip(page)).toHaveClass(/visible/);
    const legend = await box(page.locator('#myLegend'));
    const folded = await box(structureSheet(page));
    // In the right column, under the legend.
    expect(folded.x).toBeGreaterThanOrEqual(legend.x - 1);
    expect(folded.y).toBeGreaterThanOrEqual(legend.y + legend.height - 1);
    expect(overlaps(await box(plotTooltip(page)), folded)).toBe(false);

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    const viewport = page.viewportSize()!;
    await expect
      .poll(async () => (await box(structureSheet(page))).width)
      .toBeGreaterThanOrEqual(viewport.width / 2 - 1);
    const sheet = await expectWithinViewport(page, structureSheet(page));
    expect(sheet.height).toBeGreaterThanOrEqual(200);

    // The close button sits beside the resource links, not over them.
    const close = structureSheet(page).getByRole('button', { name: 'Close structure', exact: true });
    const closeBox = await box(close);
    for (const link of await page.locator('#myStructureViewer').getByRole('link').all()) {
      const bounds = await link.boundingBox();
      if (bounds) expect(overlaps(closeBox, bounds)).toBe(false);
    }
    await close.tap();
    await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  });

  test('P10: the projection details card fits the short screen and scrolls', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    // The card opens from the bar, which the page scrolls past: open it at the top.
    await expectProjectionDetailsFit(page);
  });
});
```

- [ ] **Step 8: Run the plot spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts`
Expected: 0 passed, 10 skipped (every test is marked). A failure here can only be a compile or import error; fix it.

- [ ] **Step 9: Commit section B and the plot spec**

Run: `pnpm exec prettier --check apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-plot-touch.spec.ts`

Expected: all files pass (run `pnpm exec prettier --write` on them first if not: several lines in these files run past 100 columns as written).

```bash
git add apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-plot-touch.spec.ts
git commit -m "test(e2e): port the phone plot touch tests to the workbench"
```

- [ ] **Step 10: Add section C to `helpers/mobile.ts`**

Append to `apps/web/tests/helpers/mobile.ts`:

```ts
// ─── Page fit ──────────────────────────────────────────────────────────────────

/** Asserts that nothing pushes the document wider than the window. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(clientWidth);
}

/** Asserts that the page does not scroll: it is one fixed screen. */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(scrollHeight, 'the page does not scroll').toBeLessThanOrEqual(clientHeight + 1);
}

/** The panel under the plot on phones and tablets: the sidebar, holding the legend or Filter. */
export const bottomPanel = (page: Page): Locator => page.locator('[data-workbench="sidebar"]');
```

- [ ] **Step 11: Write `apps/web/tests/mobile-explore-layout.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { appBar, viewBar } from './helpers/explore';
import {
  bottomPanel,
  box,
  expectNoHorizontalOverflow,
  expectNoPageScroll,
  expectWithinViewport,
  openExplorePhone,
  proteinNear,
  sheetToggle,
  structureSheet,
  tap,
} from './helpers/mobile';

/**
 * The explore page's layout on phones, tablets and a phone on its side (ported from
 * feat/mobile-responsive, design decision 17).
 */

const workbench = (page: Page) => page.locator('.workbench');

test.describe('explore layout on a phone', () => {
  test('L1: the plot comes first and the legend panel sits below it, on one screen', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    const viewport = page.viewportSize()!;

    await expectNoHorizontalOverflow(page);
    await expectNoPageScroll(page);
    const plot = await box(page.locator('#myPlot'));
    const panel = await expectWithinViewport(page, bottomPanel(page));
    expect(plot.height).toBeGreaterThanOrEqual(viewport.height * 0.3);
    expect(plot.y + plot.height).toBeLessThanOrEqual(panel.y + 1);
  });

  test('L2: the structure opens as a sheet along the bottom edge', async ({ page }) => {
    test.fixme(true, 'task 5.8');
    await openExplorePhone(page);
    const viewport = page.viewportSize()!;
    await tap(page, await proteinNear(page, 0.5, 0.5));

    // Folded, only its 56 px header strip shows above the bottom edge.
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
    await expect
      .poll(async () => Math.abs((await box(structureSheet(page))).y - (viewport.height - 56)))
      .toBeLessThanOrEqual(1);

    await sheetToggle(page).tap();
    await expect(workbench(page)).toHaveAttribute('data-sheet', 'expanded');
    await expect
      .poll(async () => {
        const sheet = await box(structureSheet(page));
        return Math.abs(sheet.y + sheet.height - viewport.height);
      })
      .toBeLessThanOrEqual(1);
    const sheet = await box(structureSheet(page));
    expect(Math.abs(sheet.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(sheet.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(sheet.height).toBeLessThan(viewport.height * 0.7);
  });
});

test.describe('explore layout on a tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('L3: on a tablet, the legend and the structure share the row under the plot', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.3');
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await tap(page, await proteinNear(page, 0.5, 0.5));
    await expect(page.locator('#myStructureViewer')).toBeVisible();

    const viewport = page.viewportSize()!;
    const bars = (await box(appBar(page))).height + (await box(viewBar(page))).height;
    const plot = await box(page.locator('#myPlot'));
    // About 3/5 of the height below the bars.
    expect(Math.abs(plot.height - 0.6 * (viewport.height - bars))).toBeLessThanOrEqual(8);
    const legend = await box(page.locator('#myLegend'));
    const structure = await box(structureSheet(page));
    expect(Math.abs(structure.y - legend.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(structure.height - legend.height)).toBeLessThanOrEqual(1);
    expect(structure.x).toBeGreaterThanOrEqual(legend.x + legend.width - 1);
    expect(Math.abs(structure.width - legend.width)).toBeLessThanOrEqual(1);
  });
});

test.describe('explore layout on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('L4: turned sideways, the page scrolls past the bar to a full-screen plot', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await expect
      .poll(async () => (await box(page.locator('#myPlot'))).height)
      .toBeGreaterThanOrEqual(360 * 0.6);
    await expectNoHorizontalOverflow(page);

    // At once: the page scrolls smoothly by default, which would leave it mid-way here.
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const plot = await box(page.locator('#myPlot'));
    const row = await box(page.locator('[data-workbench="body"]'));
    const legend = await box(page.locator('#myLegend'));
    // Scrolled to the end, the plot-and-legend row is exactly the screen.
    expect(plot.y).toBeGreaterThanOrEqual(0);
    expect(plot.y + plot.height).toBeLessThanOrEqual(361);
    expect(Math.abs(row.height - 360)).toBeLessThanOrEqual(1);
    expect(legend.x).toBeGreaterThanOrEqual(plot.x + plot.width - 1);
  });
});
```

- [ ] **Step 12: Run the layout spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts`
Expected: 0 passed, 4 skipped.

- [ ] **Step 13: Commit section C and the layout spec**

Run: `pnpm exec prettier --check apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-explore-layout.spec.ts`

Expected: all files pass (run `pnpm exec prettier --write` on them first if not: several lines in these files run past 100 columns as written).

```bash
git add apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-explore-layout.spec.ts
git commit -m "test(e2e): port the phone layout tests to the workbench"
```

- [ ] **Step 14: Add section D to `helpers/mobile.ts`**

In `apps/web/tests/helpers/mobile.ts`, add `appBar` to the import from `./explore`:

```ts
import {
  appBar,
  dismissTourIfPresent,
  viewBar,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './explore';
```

and append:

```ts
/** The phone app bar's search button; it opens search over the bar. */
export const searchToggle = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Search proteins', exact: true });
```

- [ ] **Step 15: Write `apps/web/tests/mobile-bars.spec.ts`**

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  annotationSelect,
  appBar,
  colorByTrigger,
  datasetSwitcher,
  exportMenu,
  filterApplyButton,
  filterPanel,
  getContoursMode,
  getViewState,
  importTrigger,
  projectionTrigger,
  queryBuilder,
  searchInput,
  viewBar,
  waitForExploreDataLoad,
} from './helpers/explore';
import {
  bottomPanel,
  box,
  emptyPlotSpot,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelTab,
  searchToggle,
  tap,
  touchTargetsBelow,
} from './helpers/mobile';
import { stubStructureRequests } from './helpers/workbench';

/**
 * The app bar, the view bar and the More sheet on phones, a phone on its side and a portrait
 * tablet (ported from feat/mobile-responsive's control-bar spec, design decision 17), and the
 * product tour on a phone.
 */

const PHONES = [
  { label: 'C1', viewport: { width: 360, height: 740 } },
  { label: 'C2', viewport: { width: 412, height: 839 } },
] as const;

const workbench = (page: Page) => page.locator('.workbench');
const exportTrigger = (page: Page) =>
  exportMenu(page).getByRole('button', { name: 'Export', exact: true });
const exportMenuList = (page: Page) =>
  exportMenu(page).getByRole('menu', { name: 'Export', exact: true });

/**
 * The visible controls and labels inside `root` whose text is cut off, by name. The dataset
 * name is exempt: it may end in an ellipsis. With `pickersMayShrink` (screens under 400 px) the
 * Projection and Color by pickers are exempt too: the skeleton has them shrink with an ellipsis
 * there, and the test checks separately that each keeps 48 px of its value.
 */
async function truncatedLabels(root: Locator, pickersMayShrink = false): Promise<string[]> {
  return root
    .locator('button, [role="button"], [part~="value"], .dropdown-trigger-text')
    .evaluateAll((elements, pickersExempt) =>
      elements.flatMap((element) => {
        if (element.closest('[data-workbench="dataset"]')) return [];
        // A picker's value sits in its shadow root: find the host through the root node.
        const host = (element.getRootNode() as ShadowRoot).host ?? element;
        if (pickersExempt && host.closest('#myProjectionSelect, #myAnnotationSelect')) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return [];
        if (element.scrollWidth <= element.clientWidth + 1) return [];
        return [(element.getAttribute('aria-label') ?? element.textContent ?? '').trim()];
      }),
      pickersMayShrink,
    );
}

/** Opens the More sheet from the view bar and returns the scope its rows are found in. */
async function openMoreSheet(page: Page): Promise<Locator> {
  await moreButton(page).tap();
  await expect(moreSheet(page)).toBeVisible();
  return moreSheetContent(page);
}

for (const { label, viewport } of PHONES) {
  test.describe(`the bars at ${viewport.width} px`, () => {
    test.use({ viewport });

    test(`${label}: the bars fit with whole labels and 40 px targets at ${viewport.width} px`, async ({
      page,
    }) => {
      test.fixme(true, 'task 5.4');
      await openExplorePhone(page);

      const app = await box(appBar(page));
      const view = await box(viewBar(page));
      expect(Math.round(app.height)).toBe(48);
      expect(Math.round(view.height)).toBe(48);
      expect(app.height + view.height).toBeLessThanOrEqual(97);

      // App bar: the wordmark, the dataset name and search; the rest is in the More sheet.
      await expect(appBar(page).getByRole('link', { name: 'ProtSpace home' })).toBeVisible();
      await expect(datasetSwitcher(page)).toBeVisible();
      await expect(searchToggle(page)).toBeVisible();
      await expect(importTrigger(page)).toBeHidden();
      await expect(exportTrigger(page)).toBeHidden();
      await expect(appBar(page).getByRole('button', { name: 'Help', exact: true })).toBeHidden();
      // View bar: Projection, its details, Color by and More.
      await expect(projectionTrigger(page)).toBeVisible();
      await expect(
        viewBar(page).getByRole('button', { name: 'View projection metadata' }),
      ).toBeVisible();
      await expect(colorByTrigger(page)).toBeVisible();
      await expect(moreButton(page)).toBeVisible();

      expect(await touchTargetsBelow(page, appBar(page))).toEqual([]);
      expect(await touchTargetsBelow(page, viewBar(page))).toEqual([]);
      const narrow = viewport.width < 400;
      expect(await truncatedLabels(appBar(page), narrow)).toEqual([]);
      expect(await truncatedLabels(viewBar(page), narrow)).toEqual([]);
      // The pickers may shrink, never vanish: each keeps at least 48 px of its value.
      const values = viewBar(page).locator(
        ':is(#myProjectionSelect, #myAnnotationSelect) :is([part~="value"], .dropdown-trigger-text)',
      );
      for (const value of await values.all()) {
        if (!(await value.isVisible())) continue;
        expect((await box(value)).width).toBeGreaterThanOrEqual(48);
      }
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe('the bars on a phone', () => {
  test('C3: the More sheet opens on screen and runs an action', async ({ page }) => {
    test.fixme(true, 'task 5.5');
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    await expectWithinViewport(page, moreSheet(page));

    await expect(rows.getByRole('radiogroup', { name: 'Contours' })).toBeVisible();
    for (const name of [/^Filter/, /^Import data/, /^Export/, /^Help & shortcuts/]) {
      await expect(rows.getByRole('button', { name })).toBeVisible();
    }
    await expect(rows.getByRole('link', { name: /^Feedback/ })).toBeVisible();
    // Theme arrives with the theme switch (Task 6.1); GitHub is not offered on a phone.
    await expect(rows.getByText(/Theme/)).toHaveCount(0);
    await expect(rows.getByRole('link', { name: /GitHub/ })).toHaveCount(0);

    // Contours applies in place: the sheet stays open.
    await rows.getByRole('radio', { name: 'Auto', exact: true }).tap();
    await expect.poll(() => getContoursMode(page)).toBe('auto');
    await expect(moreSheet(page)).toBeVisible();

    await moreSheet(page).getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(moreSheet(page)).toBeHidden();
    await expect(moreButton(page)).toHaveAccessibleName(/, 1 active$/);
    await expect(viewBar(page).locator('.wb-more-dot')).toBeVisible();
  });

  test('C4: Export in the sheet opens the Export menu, which an outside tap closes', async ({
    page,
  }) => {
    test.fixme(true, 'task 5.5');
    await openExplorePhone(page);
    let rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Export/ }).tap();

    // The sheet closes first, then the menu opens anchored to More.
    await expect(moreSheet(page)).toBeHidden();
    await expect(exportMenuList(page)).toBeVisible();
    await expectWithinViewport(page, exportMenuList(page));

    await tap(page, await emptyPlotSpot(page));
    await expect(exportMenuList(page)).toBeHidden();

    // Escape closes it too, and hands focus back to More.
    rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Export/ }).tap();
    await expect(exportMenuList(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(exportMenuList(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();

    // The Export menu borrowed More as its anchor and gave back More's own popup attributes
    // (Task 5.5; they sit on the ps-button host, not on the inner button moreButton finds).
    const moreHost = viewBar(page).locator('.wb-more');
    await expect(moreHost).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(moreHost).toHaveAttribute('aria-expanded', 'false');
  });

  test('C5: the Color by picker and its info bubble stay within the viewport', async ({ page }) => {
    test.fixme(true, 'task 5.10');
    await openExplorePhone(page);
    await colorByTrigger(page).tap();

    const list = annotationSelect(page).locator('.dropdown-menu');
    await expect(list).toBeVisible();
    await expectWithinViewport(page, list);

    await annotationSelect(page)
      .getByRole('button', { name: /^Information about / })
      .first()
      .tap();
    const bubble = page.getByRole('dialog', { name: / information$/ });
    await expect(bubble).toBeVisible();
    await expectWithinViewport(page, bubble);
  });

  test('C6: the Filter tab shows the builder with its actions on screen', async ({ page }) => {
    test.fixme(true, 'task 5.6');
    await openExplorePhone(page);
    await panelTab(page, 'Filter').tap();

    await expect(workbench(page)).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    const panel = await box(filterPanel(page));
    const bottom = await box(bottomPanel(page));
    expect(panel.y).toBeGreaterThanOrEqual(bottom.y - 1);

    for (const control of [
      queryBuilder(page)
        .getByRole('group', { name: /^Condition/ })
        .first(),
      filterApplyButton(page),
      queryBuilder(page).getByRole('button', { name: 'Cancel', exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expectWithinViewport(page, control);
    }
  });

  test('C7: a selected filter value has a finger-sized remove button', async ({ page }) => {
    test.fixme(true, 'task 5.12');
    await openExplorePhone(page);
    const { annotation } = await getViewState(page);
    await panelTab(page, 'Filter').tap();

    const row = queryBuilder(page).locator('protspace-query-condition-row').first();
    await row.locator('.annotation-select-trigger').tap();
    await queryBuilder(page)
      .locator(`.annotation-picker-item[data-annotation=${JSON.stringify(annotation ?? '')}]`)
      .first()
      .tap();
    await row.locator('.value-chip-add').tap();
    await queryBuilder(page).locator('.value-picker-item').first().tap();
    // Escape closes the value picker (a layer).
    await page.keyboard.press('Escape');

    const remove = row.locator('.value-chip-remove').first();
    await expect(remove).toBeVisible();
    const target = await box(remove);
    expect(target.width).toBeGreaterThanOrEqual(40);
    expect(target.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('the bars on a phone on its side', () => {
  test.use({ viewport: { width: 740, height: 360 } });

  test('C8: the landscape bar keeps touch-sized targets', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    await expect(moreButton(page)).toBeVisible();
    expect(await touchTargetsBelow(page, appBar(page))).toEqual([]);
    expect(await touchTargetsBelow(page, viewBar(page))).toEqual([]);
  });

  test('C9: the More sheet fits the short screen and scrolls inside', async ({ page }) => {
    test.fixme(true, 'task 5.9');
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    const heading = moreSheet(page).getByRole('heading', { name: 'More', exact: true });
    await expectWithinViewport(page, moreSheet(page));
    await expectWithinViewport(page, heading);

    // The last row is reachable by scrolling the sheet, with its header still in view.
    const last = rows.getByRole('link', { name: /^Feedback/ });
    await last.scrollIntoViewIfNeeded();
    await expectWithinViewport(page, last);
    await expectWithinViewport(page, heading);
  });
});

test.describe('the bars on a portrait tablet', () => {
  test.use({ viewport: { width: 800, height: 1280 } });

  test('C10: a portrait tablet (800×1280) keeps the desktop bars', async ({ page }) => {
    test.fixme(true, 'task 5.3');
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await expect(searchInput(page)).toBeVisible();
    await expect(importTrigger(page)).toBeVisible();
    await expect(exportTrigger(page)).toBeVisible();
    await expect(searchToggle(page)).toBeHidden();
    // More shows from the view bar's second stage; where it shows, it opens its menu.
    if (await moreButton(page).isVisible()) {
      await moreButton(page).tap();
      await expect(page.getByRole('menu', { name: 'More view options' })).toBeVisible();
    }
    await expect(moreSheet(page)).toHaveCount(0);
  });
});

test.describe('the product tour on a phone', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { label, viewport } of [
    { label: 'C11', viewport: { width: 390, height: 664 } },
    { label: 'C12', viewport: { width: 740, height: 360 } },
  ]) {
    test(`${label}: every tour popover stays on screen at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.fixme(true, 'task 7.4');
      await page.setViewportSize(viewport);
      await stubStructureRequests(page);
      await page.goto('/explore');
      await waitForExploreDataLoad(page);

      // driver.js draws the popover; its parts have no roles, so its own classes find them.
      const popover = page.locator('.driver-popover');
      const titles: string[] = [];
      const descriptions: string[] = [];
      for (let step = 0; step < 15; step++) {
        await expect(popover).toBeVisible({ timeout: 10_000 });
        // driver.js animates the popover into place.
        await expect(async () => {
          await expectWithinViewport(page, popover);
        }).toPass();
        titles.push(((await popover.locator('.driver-popover-title').textContent()) ?? '').trim());
        descriptions.push(
          ((await popover.locator('.driver-popover-description').textContent()) ?? '').trim(),
        );
        const close = await box(popover.locator('.driver-popover-close-btn'));
        expect(close.width).toBeGreaterThanOrEqual(40);
        expect(close.height).toBeGreaterThanOrEqual(40);

        // A step that points at a control points at one that shows.
        const highlighted = page.locator('.driver-active-element:not(#driver-dummy-element)');
        if ((await highlighted.count()) > 0) {
          const target = await box(highlighted.first());
          expect(target.width, `step "${titles.at(-1)}" highlights a shown control`).toBeGreaterThan(0);
          expect(target.height).toBeGreaterThan(0);
        }

        const next = popover.locator('.driver-popover-next-btn');
        if (/finish|done/i.test(((await next.textContent()) ?? '').trim())) break;
        await next.tap();
      }

      expect(titles.at(-1)).toBe("You're All Set!");
      // Touch wording only: the legend takes taps, double taps and a held handle.
      const legendSteps = descriptions.filter((_, i) =>
        ['Legend Panel', 'Expand Hidden Categories'].includes(titles[i]),
      );
      expect(legendSteps).toHaveLength(2);
      for (const description of legendSteps) expect(description).not.toMatch(/click/i);
      expect(legendSteps[0]).toContain('double-tap');
    });
  }
});
```

- [ ] **Step 16: Run the bars spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts`
Expected: 0 passed, 12 skipped (C1, C2, C3–C10, C11, C12).

- [ ] **Step 17: Commit section D and the bars spec**

Run: `pnpm exec prettier --check apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-bars.spec.ts`

Expected: all files pass (run `pnpm exec prettier --write` on them first if not: several lines in these files run past 100 columns as written).

```bash
git add apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-bars.spec.ts
git commit -m "test(e2e): port the phone bar tests to the workbench"
```

- [ ] **Step 18: Account for every branch test**

Run: `grep -c "test.fixme(true, 'task " apps/web/tests/mobile-*.spec.ts`
Expected (lines, not tests): `mobile-legend` 6 (7 if G1 was marked), `mobile-plot-touch` 10, `mobile-explore-layout` 4, `mobile-bars` 10. In `mobile-bars` one line sits in the C1/C2 loop and one in the C11/C12 loop, so the file holds 12 tests behind its 10 lines. Tests: 6 (7) + 10 + 4 + 12 = 32 (33) marked, plus G4 (and G1 if green) unmarked: the 34 ported explore tests (4 layout, 12 bars, 8 legend, 10 plot), 2 of them (C11, C12) for `'task 7.4'`.

Append one line to `.superpowers/sdd/phase-5-mobile/progress.md` (git-ignored, no commit):

```
Task 5.1: dropped the branch's 4 landing tests (mobile-landing.spec.ts) for the 8.4 retirement note: "does not scroll sideways at 360 px"; "showcase chips are touch-sized and a tap switches the projection"; "a tap on the hero map shows a tooltip and a tap elsewhere hides it"; "the menu has touch-sized entries and closes on an outside tap or Escape". G1 at 5.1: <green, unmarked | marked 'task 5.11'>.
```

- [ ] **Step 19: The whole mobile project**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile`
Expected: 1 passed (G4; 2 if G1 is green), the rest skipped, none failed. Report the counts and which fixme labels each file carries.

### Task 5.2: Four layout modes from one source

Replaces `'desktop' | 'narrow'` with the four modes, resolved in one non-React module that the React hook and the runtime controllers share. `narrow` styles become the interim style of every non-desktop mode, so nothing looks different yet; the runtime's "is the structure visible" and "is the Filter panel shown" rules read the mode instead of their own `matchMedia`.

**Files:**

- Modify: `apps/web/src/explore/layout-defaults.ts` (`LayoutMode`, `LAYOUT_QUERIES`, `PHONE_MAX_WIDTH`, `LANDSCAPE_PHONE_MAX_HEIGHT`)
- Create: `apps/web/src/explore/layout-mode.ts`, `layout-mode.test.ts`
- Modify: `apps/web/src/workbench/use-layout-mode.ts`, `workbench.css` (`[data-layout='narrow']` → `:not([data-layout='desktop'])`, same declarations). `Workbench.tsx`, `FilterControl.tsx` and `FilterPanel.tsx` need no edit (see the note below)
- Modify: `apps/web/src/explore/structure-controller.ts`, `structure-controller.test.ts`, `runtime.ts`, `layout-state.ts`, `layout-state.test.ts`
- Create: `apps/web/tests/mobile-shell.spec.ts`; modify `apps/web/tests/workbench-shell.spec.ts` (expects `tablet` at 900 px; the page-scroll assertion stays until 5.3)
- Modify: `docs/developers/architecture.md` (the layout-mode source, if it describes `use-layout-mode`)

**Interfaces:**

- Consumes: `DESKTOP_MIN_WIDTH`; `getLayout`, `subscribeLayout`; `createStructureController` options; `RUNTIME_ELEMENTS` pattern from `workbench-shell.spec.ts:17`.
- Produces:
  - `layout-defaults.ts` (still a leaf, no imports): `export type LayoutMode = 'desktop' | 'tablet' | 'phone' | 'landscape'`; `export const PHONE_MAX_WIDTH = 640`; `export const LANDSCAPE_PHONE_MAX_HEIGHT = 500`; `export const LAYOUT_QUERIES = { landscape: '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)', desktop: '(min-width: 951px)', phone: '(max-width: 640px)' } as const` (strings built from the constants are fine if they produce exactly these).
  - `layout-mode.ts`: `resolveLayoutMode(matches: { landscape: boolean; desktop: boolean; phone: boolean }): LayoutMode` (landscape, desktop, phone, else tablet); `getLayoutMode(): LayoutMode` (lazily creates the three `MediaQueryList`s once and keeps them; returns the same string while nothing changed); `subscribeLayoutMode(listener: () => void): () => void` (listens to all three lists' `change`, notifies only when the resolved mode changes); `hasStructureSheet(mode: LayoutMode): boolean` (`phone` or `landscape`); `resetLayoutModeForTests(): void`. Type `LayoutModeSource = { get(): LayoutMode; subscribe(listener: () => void): () => void }` exported for the structure controller's option.
  - `use-layout-mode.ts`: `useLayoutMode(): LayoutMode` via `useSyncExternalStore(subscribeLayoutMode, getLayoutMode)`.
  - `Workbench.tsx`: `data-layout={mode}`; `desktop = mode === 'desktop'` drives the same things as today.
  - `structure-controller.ts`: option `desktopQuery` is replaced by `layoutMode: LayoutModeSource`; `isStructureVisible(layout: LayoutState, mode: LayoutMode): boolean` (true off desktop; desktop rule unchanged); the controller subscribes to `layoutMode.subscribe` in place of the query's `change`. `runtime.ts` passes `{ get: getLayoutMode, subscribe: subscribeLayoutMode }`.
  - `runtime.ts`: `isFilterPanelShown()` reads `getLayoutMode()` (desktop: `panel === 'filter' && sidebarOpen`; else `panel === 'filter'`); re-evaluated on mode changes as it is on layout changes. `filterDesktopQuery` goes.
  - `layout-state.ts`: `focusTitle` uses `preventScroll` when `getLayoutMode() === 'desktop'`.
  - `FilterControl`/`FilterPanel`: `useLayoutMode() === 'desktop'` as before.

**Tests:**

- `layout-mode.test.ts`: the resolution table — 1280×720 desktop; 1024×420 desktop; 951×400 desktop; 950×1024 tablet; 641×900 tablet; 640×900 phone; 390×844 phone; 915×412 landscape; 740×360 landscape; 640×360 landscape; 950×500 landscape; 950×501 tablet (computed by evaluating the three queries against a width/height pair with a tiny matcher for the three exact query strings); `getLayoutMode` returns the same value until a list fires `change`; `subscribeLayoutMode` notifies once per resolved change and not for a change that keeps the mode; unsubscribe stops it.
- `structure-controller.test.ts`: existing cases ported from a fake `desktopQuery` to a fake `layoutMode`; "a waiting protein loads when the mode leaves desktop"; `isStructureVisible` table for the four modes.
- `layout-state.test.ts`: unchanged behaviour (green).
- `mobile-shell.spec.ts` (new, project `mobile`): "the same runtime elements survive 1280, 800, 390 and 740×360" (`#myPlot`, `#myLegend`, `#myStructureViewer`, `#myImportMenu`, `#myExportMenu`, `#myProteinSearch`, `#myQueryBuilder` identical; `data-layout` is `desktop`, `tablet`, `phone`, `landscape` in turn).
- `workbench-shell.spec.ts`: 900 px expects `data-layout="tablet"`.
- Unrun at task time (exit): `workbench-structure.spec.ts:379`, `workbench-legend.spec.ts:252`, `workbench-loading.spec.ts:227`, `eat-visualization.spec.ts`.

Verification: the two app test files; `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-shell.spec.ts`.

**Commit:** `refactor(web): resolve four layout modes from one source`

Writer's notes:

- `Workbench.tsx`, `FilterControl.tsx`, `FilterPanel.tsx` and `use-floating-card.ts` need **no edit**: they compare `useLayoutMode()` with `'desktop'`, which keeps its meaning; the wider return type flows through. `Workbench.tsx` already writes `data-layout={mode}`.
- One media-query `change` can fire on two lists in the same task (1280 → 390 crosses `desktop` and `phone`). `matches` is live, so the first event already resolves the final mode and the second finds nothing new: listeners hear one change. The test pins this.
- `layout-state.test.ts` gains one case for the focus rule (the task changes `focusTitle`), with `window` and `document` stubbed.

- [ ] **Step 1: Write the failing tests for the mode source**

Create `apps/web/src/explore/layout-mode.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LAYOUT_QUERIES,
  PHONE_MAX_WIDTH,
  type LayoutMode,
} from './layout-defaults';
import {
  getLayoutMode,
  hasStructureSheet,
  resetLayoutModeForTests,
  resolveLayoutMode,
  subscribeLayoutMode,
} from './layout-mode';

interface Size {
  width: number;
  height: number;
}

/**
 * A window of `size` whose matchMedia answers the three layout queries, and only those: a query
 * string that drifts throws. `matches` is live, and resize() fires change on every list whose
 * answer changed, as browsers do.
 */
function fakeWindow(initial: Size) {
  let size = initial;
  const evaluate = (query: string): boolean => {
    const { width, height } = size;
    if (query === '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)') {
      return width > height && height <= 500 && width <= 950;
    }
    if (query === '(min-width: 951px)') return width >= 951;
    if (query === '(max-width: 640px)') return width <= 640;
    throw new Error(`Unexpected media query: ${query}`);
  };
  const lists: Array<{ query: string; last: boolean; events: EventTarget }> = [];
  const matchMedia = vi.fn((query: string) => {
    const entry = { query, last: evaluate(query), events: new EventTarget() };
    lists.push(entry);
    return {
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: entry.events.addEventListener.bind(entry.events),
      removeEventListener: entry.events.removeEventListener.bind(entry.events),
    };
  });
  vi.stubGlobal('window', { matchMedia });
  return {
    matchMedia,
    resize(next: Size) {
      size = next;
      for (const entry of lists) {
        const now = evaluate(entry.query);
        if (now === entry.last) continue;
        entry.last = now;
        entry.events.dispatchEvent(new Event('change'));
      }
    },
  };
}

beforeEach(() => resetLayoutModeForTests());

afterEach(() => {
  resetLayoutModeForTests();
  vi.unstubAllGlobals();
});

describe('layout queries', () => {
  it('are exactly these strings, from the breakpoint constants', () => {
    expect(LAYOUT_QUERIES).toEqual({
      landscape: '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)',
      desktop: '(min-width: 951px)',
      phone: '(max-width: 640px)',
    });
    expect([DESKTOP_MIN_WIDTH, PHONE_MAX_WIDTH, LANDSCAPE_PHONE_MAX_HEIGHT]).toEqual([951, 640, 500]);
  });
});

describe('resolveLayoutMode', () => {
  it('takes landscape first, then desktop, then phone, else tablet', () => {
    expect(resolveLayoutMode({ landscape: true, desktop: true, phone: true })).toBe('landscape');
    expect(resolveLayoutMode({ landscape: false, desktop: true, phone: true })).toBe('desktop');
    expect(resolveLayoutMode({ landscape: false, desktop: false, phone: true })).toBe('phone');
    expect(resolveLayoutMode({ landscape: false, desktop: false, phone: false })).toBe('tablet');
  });
});

describe('getLayoutMode', () => {
  it.each<[number, number, LayoutMode]>([
    [1280, 720, 'desktop'],
    // A short desktop window is no phone on its side: landscape stops at 950 px wide.
    [1024, 420, 'desktop'],
    [951, 400, 'desktop'],
    [950, 1024, 'tablet'],
    [641, 900, 'tablet'],
    [640, 900, 'phone'],
    [390, 844, 'phone'],
    [915, 412, 'landscape'],
    [740, 360, 'landscape'],
    [640, 360, 'landscape'],
    [950, 500, 'landscape'],
    [950, 501, 'tablet'],
  ])('%i × %i is %s', (width, height, mode) => {
    fakeWindow({ width, height });
    expect(getLayoutMode()).toBe(mode);
  });

  it('makes the three lists once and returns the same mode until one fires change', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    expect(getLayoutMode()).toBe('desktop');
    expect(getLayoutMode()).toBe('desktop');
    expect(win.matchMedia).toHaveBeenCalledTimes(3);

    win.resize({ width: 390, height: 844 });
    expect(getLayoutMode()).toBe('phone');
    expect(win.matchMedia).toHaveBeenCalledTimes(3);
  });
});

describe('subscribeLayoutMode', () => {
  it('notifies once per resolved change, and not for a change that keeps the mode', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    const listener = vi.fn();
    subscribeLayoutMode(listener);

    win.resize({ width: 800, height: 800 }); // desktop list fires: tablet
    expect(listener).toHaveBeenCalledTimes(1);
    win.resize({ width: 700, height: 800 }); // no list fires
    expect(listener).toHaveBeenCalledTimes(1);
    win.resize({ width: 700, height: 400 }); // landscape list fires: landscape
    expect(listener).toHaveBeenCalledTimes(2);
    win.resize({ width: 600, height: 400 }); // phone list fires, landscape still wins
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLayoutMode()).toBe('landscape');
    win.resize({ width: 1280, height: 400 }); // three lists fire, one change: desktop
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLayoutMode()).toBe('desktop');
  });

  it('stops notifying once unsubscribed', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    const listener = vi.fn();
    const unsubscribe = subscribeLayoutMode(listener);
    unsubscribe();
    win.resize({ width: 390, height: 844 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('hasStructureSheet', () => {
  it('is true on a phone, upright or on its side, only', () => {
    expect(hasStructureSheet('phone')).toBe(true);
    expect(hasStructureSheet('landscape')).toBe(true);
    expect(hasStructureSheet('tablet')).toBe(false);
    expect(hasStructureSheet('desktop')).toBe(false);
  });
});
```

- [ ] **Step 2: Port the structure controller's tests to a mode source**

In `apps/web/src/explore/structure-controller.test.ts`:

Add `type LayoutMode` to the existing import from `./layout-defaults`:

```ts
import { DEFAULT_LAYOUT, type LayoutMode } from './layout-defaults';
```

Replace the whole `fakeDesktopQuery` function (from its comment `/** \`(min-width: 951px)\`, answered by the test. */` to its closing brace) with:

```ts
/** The layout-mode source, answered by the test: set() notifies only on a change of mode. */
function fakeLayoutMode(initial: LayoutMode) {
  let mode = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => mode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: LayoutMode) {
      if (next === mode) return;
      mode = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
```

Replace `setup`:

```ts
function setup({ mode = 'desktop' as LayoutMode } = {}) {
  const viewer = fakeViewer();
  const plot = fakePlot();
  const layoutMode = fakeLayoutMode(mode);
  const controller = createStructureController({
    viewer: viewer as never,
    plotElement: plot as never,
    layoutMode,
  });
  controllers.push(controller);
  return { viewer, plot, layoutMode, controller };
}
```

Replace the `describe('isStructureVisible', …)` block with:

```ts
describe('isStructureVisible', () => {
  it('isStructureVisible: always off desktop; on desktop docked follows the sidebar and floating is visible', () => {
    const collapsed = { ...DEFAULT_LAYOUT, sidebarOpen: false };
    for (const mode of ['tablet', 'phone', 'landscape'] as const) {
      expect(isStructureVisible(collapsed, mode)).toBe(true);
    }
    expect(isStructureVisible(DEFAULT_LAYOUT, 'desktop')).toBe(true);
    expect(isStructureVisible(collapsed, 'desktop')).toBe(false);
    expect(isStructureVisible({ ...collapsed, structurePlacement: 'floating' }, 'desktop')).toBe(
      true,
    );
  });
});
```

In the three tests that use the fake query, rename `desktopQuery` to `layoutMode` in the destructuring and replace `desktopQuery.set(false)` with `layoutMode.set('tablet')` and `desktopQuery.set(true)` with `layoutMode.set('desktop')`:
- "becoming visible, by layout or by crossing 951 px, loads the waiting protein once" (three `set` calls),
- "dispose stops following the layout, the breakpoint and the viewer" (one),
- "offers View structure only while docked and collapsed on desktop" (two).

Add after "becoming visible, by layout or by crossing 951 px, …":

```ts
  it('a waiting protein loads when the mode leaves desktop, for a phone as for a tablet', () => {
    const { viewer, layoutMode, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    layoutMode.set('phone');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    layoutMode.set('landscape');
    expect(viewer.loadProtein).toHaveBeenCalledOnce();
  });

  it('starts off desktop with nothing waiting: a request while collapsed loads at once', () => {
    const { viewer, controller } = setup({ mode: 'phone' });
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
  });
```

- [ ] **Step 3: Add the focus-rule case to `layout-state.test.ts`**

Add `focusFilterTitle` to the import from `./layout-state`, add `import { resetLayoutModeForTests } from './layout-mode';`, and append at the end of the file:

```ts
describe('focusFilterTitle', () => {
  afterEach(() => resetLayoutModeForTests());

  it.each([
    [1280, true],
    [800, false],
    [390, false],
  ])('at %i px wide, scrolls the heading into view only off desktop', (width, preventScroll) => {
    const title = { focus: vi.fn() };
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'wb-filter-title' ? title : null),
      activeElement: title,
    });
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches:
          query === '(min-width: 951px)'
            ? width >= 951
            : query === '(max-width: 640px)'
              ? width <= 640
              : false,
        addEventListener() {},
        removeEventListener() {},
      }),
    });

    focusFilterTitle();

    expect(title.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll });
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-mode.test.ts src/explore/structure-controller.test.ts src/explore/layout-state.test.ts`
Expected: FAIL. `layout-mode.test.ts` cannot import `./layout-mode` (and `LAYOUT_QUERIES` does not exist); `layout-state.test.ts` cannot import `./layout-mode`; `structure-controller.test.ts` throws in `createStructureController` (`desktopQuery` is undefined, so `desktopQuery.addEventListener` throws).

- [ ] **Step 5: Add the modes and queries to `layout-defaults.ts`**

In `apps/web/src/explore/layout-defaults.ts`, replace

```ts
/** The narrowest window that gets the desktop workbench; below it, a stacked fallback. */
export const DESKTOP_MIN_WIDTH = 951;
```

with

```ts
/** The narrowest window that gets the desktop workbench (design decision 17). */
export const DESKTOP_MIN_WIDTH = 951;

/** The widest window that gets the phone layout; from here to 950 px, the tablet layout. */
export const PHONE_MAX_WIDTH = 640;

/** A landscape window at most this tall (and at most 950 px wide) is a phone on its side. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/** The workbench's four layouts; layout-mode.ts resolves which one the window gets. */
export type LayoutMode = 'desktop' | 'tablet' | 'phone' | 'landscape';

/**
 * The media queries the layout mode is resolved from, in the order they win: a phone on its side
 * first (capped below desktop width, so a short desktop window stays desktop), then desktop, then
 * phone; anything else is a tablet. Core's breakpoints.ts keeps the same numbers (Task 5.6).
 */
export const LAYOUT_QUERIES = {
  landscape: `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`,
  desktop: `(min-width: ${DESKTOP_MIN_WIDTH}px)`,
  phone: `(max-width: ${PHONE_MAX_WIDTH}px)`,
} as const;
```

The module stays a leaf with no imports.

- [ ] **Step 6: Create `apps/web/src/explore/layout-mode.ts`**

```ts
import { LAYOUT_QUERIES, type LayoutMode } from './layout-defaults';

/**
 * The workbench's layout mode (design decision 17), from the three LAYOUT_QUERIES: the one source
 * the React shell (useLayoutMode, which writes data-layout) and the runtime's controllers share,
 * so CSS and JS never disagree about the layout. Not React: the runtime reads it too.
 */

type QueryName = keyof typeof LAYOUT_QUERIES;

/** The layout mode for what the three queries answer: landscape, desktop, phone, else tablet. */
export function resolveLayoutMode(matches: Record<QueryName, boolean>): LayoutMode {
  if (matches.landscape) return 'landscape';
  if (matches.desktop) return 'desktop';
  if (matches.phone) return 'phone';
  return 'tablet';
}

/** Where the structure is a bottom sheet and More opens a sheet: a phone, upright or on its side. */
export function hasStructureSheet(mode: LayoutMode): boolean {
  return mode === 'phone' || mode === 'landscape';
}

/** The mode and its changes, as the structure controller takes them (a fake in its tests). */
export type LayoutModeSource = {
  get(): LayoutMode;
  subscribe(listener: () => void): () => void;
};

let lists: Record<QueryName, MediaQueryList> | null = null;
let mode: LayoutMode = 'desktop';
const listeners = new Set<() => void>();

const read = (from: Record<QueryName, MediaQueryList>): LayoutMode =>
  resolveLayoutMode({
    landscape: from.landscape.matches,
    desktop: from.desktop.matches,
    phone: from.phone.matches,
  });

/**
 * A window crossing two breakpoints at once fires change on two lists in the same task. matches
 * is live, so the first event resolves the final mode and the second finds nothing new.
 */
const onChange = () => {
  if (!lists) return;
  const next = read(lists);
  if (next === mode) return;
  mode = next;
  for (const listener of [...listeners]) listener();
};

// Made on first use, not at import (the node tests and the shell's first render import this
// module), and kept: React reads the snapshot on every render.
function ensureLists(): void {
  if (lists) return;
  lists = {
    landscape: window.matchMedia(LAYOUT_QUERIES.landscape),
    desktop: window.matchMedia(LAYOUT_QUERIES.desktop),
    phone: window.matchMedia(LAYOUT_QUERIES.phone),
  };
  for (const list of Object.values(lists)) list.addEventListener('change', onChange);
  mode = read(lists);
}

/** The window's layout mode now; the same string until one of the queries changes it. */
export function getLayoutMode(): LayoutMode {
  ensureLists();
  return mode;
}

/** Calls `listener` after each change of the resolved mode, not for a change that keeps it. */
export function subscribeLayoutMode(listener: () => void): () => void {
  ensureLists();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetLayoutModeForTests(): void {
  if (lists) {
    for (const list of Object.values(lists)) list.removeEventListener('change', onChange);
  }
  lists = null;
  mode = 'desktop';
  listeners.clear();
}
```

- [ ] **Step 7: Read the mode in the hook**

Replace the whole of `apps/web/src/workbench/use-layout-mode.ts` with:

```ts
import { useSyncExternalStore } from 'react';
import type { LayoutMode } from '../explore/layout-defaults';
import { getLayoutMode, subscribeLayoutMode } from '../explore/layout-mode';

/**
 * The workbench's layout mode (design decision 17), following the window live: desktop from
 * 951 px, tablet from 641 px, phone below, and landscape for a phone on its side. The runtime
 * reads the same source (explore/layout-mode.ts).
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribeLayoutMode, getLayoutMode);
}
```

- [ ] **Step 8: The structure controller takes the mode source**

In `apps/web/src/explore/structure-controller.ts`:

Replace `import type { LayoutState } from './layout-defaults';` with:

```ts
import type { LayoutMode, LayoutState } from './layout-defaults';
import type { LayoutModeSource } from './layout-mode';
```

Replace `isStructureVisible` (its doc comment and body) with:

```ts
/**
 * Whether the structure can be seen with this layout. Off desktop the panel under the plot never
 * collapses, so it always can; on desktop a floating card always can, and a docked one only while
 * the sidebar is open.
 */
export function isStructureVisible(layout: LayoutState, mode: LayoutMode): boolean {
  if (mode !== 'desktop') return true;
  return layout.structurePlacement === 'floating' || layout.sidebarOpen;
}
```

In `StructureControllerOptions`, replace

```ts
  /** `matchMedia('(min-width: 951px)')` in the app; a fake in tests. */
  desktopQuery: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
```

with

```ts
  /** The workbench's layout mode (layout-mode.ts in the app; a fake in tests). */
  layoutMode: LayoutModeSource;
```

In `createStructureController`, change the destructured `desktopQuery,` to `layoutMode,`, and make these four edits:

- `const visible = () => isStructureVisible(getLayout(), desktopQuery.matches);` becomes
  `const visible = () => isStructureVisible(getLayout(), layoutMode.get());`
- in `offerViewStructure`, `desktopQuery.matches && layout.structurePlacement === 'docked' && !layout.sidebarOpen;` becomes
  `layoutMode.get() === 'desktop' && layout.structurePlacement === 'docked' && !layout.sidebarOpen;`
- `desktopQuery.addEventListener('change', onLayoutChange);` (after `const unsubscribe = subscribeLayout(onLayoutChange);`) becomes
  `const unsubscribeMode = layoutMode.subscribe(onLayoutChange);`
- in `dispose()`, `desktopQuery.removeEventListener('change', onLayoutChange);` becomes `unsubscribeMode();`

In the doc comment of `createStructureController`, "once a layout or breakpoint change" stays true; no edit.

- [ ] **Step 9: The runtime reads the mode**

In `apps/web/src/explore/runtime.ts`:

Delete `import { DESKTOP_MIN_WIDTH } from './layout-defaults';` and add, next to the `./layout-state` import:

```ts
import { getLayoutMode, subscribeLayoutMode } from './layout-mode';
```

In the `createStructureController({ … })` call, replace
`desktopQuery: window.matchMedia(\`(min-width: ${DESKTOP_MIN_WIDTH}px)\`),` with

```ts
    layoutMode: { get: getLayoutMode, subscribe: subscribeLayoutMode },
```

Replace the Filter panel block (from the comment `// The Filter panel counts only while it is on screen: …` through the closing `};` of `isFilterPanelShown`) with:

```ts
  // The Filter panel counts only while it is on screen: open on the sidebar's Filter panel, or,
  // off desktop where the panel under the plot always shows, whenever Filter is the chosen panel.
  const isFilterPanelShown = () => {
    const { panel, sidebarOpen } = getLayout();
    return panel === 'filter' && (sidebarOpen || getLayoutMode() !== 'desktop');
  };
```

and in `createFilterController({ … })` replace the `subscribePanel(listener) { … }` method with:

```ts
    subscribePanel(listener) {
      const unsubscribe = subscribeLayout(listener);
      const unsubscribeMode = subscribeLayoutMode(listener);
      return () => {
        unsubscribe();
        unsubscribeMode();
      };
    },
```

Then `grep -n "DESKTOP_MIN_WIDTH\|filterDesktopQuery\|matchMedia" apps/web/src/explore/runtime.ts` must print nothing.

- [ ] **Step 10: The focus rule reads the mode**

In `apps/web/src/explore/layout-state.ts`: remove `DESKTOP_MIN_WIDTH,` from the import list from `./layout-defaults`, add `import { getLayoutMode } from './layout-mode';`, and replace `focusTitle` with:

```ts
const focusTitle = (): boolean => {
  const title = document.getElementById('wb-filter-title');
  // Off desktop the panel sits under the plot: let focus bring it into view if it must.
  title?.focus({ preventScroll: getLayoutMode() === 'desktop' });
  return title !== null && document.activeElement === title;
};
```

- [ ] **Step 11: Rename the narrow CSS to "every mode but desktop"**

Run (from the worktree root):

```bash
sed -i '' "s/\[data-layout='narrow'\]/:not([data-layout='desktop'])/g" apps/web/src/workbench/workbench.css
```

The declarations stay as they are; `.workbench:not([data-layout='desktop'])` has the same specificity as `.workbench[data-layout='narrow']` (one class, one attribute), so no rule changes rank. Then edit two comments in `workbench.css`:

- `/* ── Narrow fallback below 951 px: the plot, then the sidebar; the page scrolls ── */` becomes
  `/* ── Below 951 px (every mode but desktop, until Task 5.3): the plot, then the sidebar ── */`
- `/* Narrow fallback (below 951 px): search gives way entirely before anything leaves the window. */` becomes
  `/* Below 951 px: search gives way entirely before anything leaves the window. */`

Check: `grep -n "narrow" apps/web/src/workbench/workbench.css` prints no selector (only prose such as "a narrow plot", if any).

- [ ] **Step 12: Run the app tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-mode.test.ts src/explore/structure-controller.test.ts src/explore/layout-state.test.ts`
Expected: PASS. `layout-mode.test.ts` 18 tests (1 query + 1 resolve + 12 sizes + 1 snapshot + 2 subscribe + 1 sheet), `structure-controller.test.ts` its previous count + 2, `layout-state.test.ts` its previous count + 3.

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors (`'narrow'` is gone everywhere: `grep -rn "'narrow'" apps/web/src` prints nothing).

- [ ] **Step 13: Write the e2e test for the four modes**

Create `apps/web/tests/mobile-shell.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { openExplorePhone } from './helpers/mobile';

/**
 * The workbench shell across its four layouts (design decision 17): crossing a breakpoint or
 * turning a phone is CSS on one tree, so the runtime elements stay the same instances.
 */

const RUNTIME_ELEMENTS = [
  'myPlot',
  'myLegend',
  'myStructureViewer',
  'myImportMenu',
  'myExportMenu',
  'myProteinSearch',
  'myQueryBuilder',
];

type Remembered = { __runtimeElements: Array<Element | null> };

async function rememberRuntimeElements(page: Page): Promise<void> {
  await page.evaluate((ids) => {
    (window as unknown as Remembered).__runtimeElements = ids.map((id) =>
      document.getElementById(id),
    );
  }, RUNTIME_ELEMENTS);
}

/** The ids whose element is missing or no longer the one remembered. */
function replacedRuntimeElements(page: Page): Promise<string[]> {
  return page.evaluate((ids) => {
    const before = (window as unknown as Remembered).__runtimeElements;
    return ids.filter(
      (id, index) => before[index] === null || document.getElementById(id) !== before[index],
    );
  }, RUNTIME_ELEMENTS);
}

test.describe('the workbench shell on every screen', () => {
  test('the same runtime elements survive 1280, 800, 390 and 740×360', async ({ page }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'desktop');
    await rememberRuntimeElements(page);

    for (const [size, mode] of [
      [{ width: 800, height: 1280 }, 'tablet'],
      [{ width: 390, height: 844 }, 'phone'],
      [{ width: 740, height: 360 }, 'landscape'],
      [{ width: 1280, height: 720 }, 'desktop'],
    ] as const) {
      await page.setViewportSize(size);
      await expect(root).toHaveAttribute('data-layout', mode);
      expect(await replacedRuntimeElements(page), `at ${size.width}×${size.height}`).toEqual([]);
    }
  });
});
```

- [ ] **Step 14: The desktop shell spec says tablet at 900 px**

In `apps/web/tests/workbench-shell.spec.ts`, in the test "crossing 951 px keeps the same runtime elements", replace `await expect(root).toHaveAttribute('data-layout', 'narrow');` with `await expect(root).toHaveAttribute('data-layout', 'tablet');`. The page-scroll assertion below it stays until Task 5.3. In the file's header comment, "the narrow fallback" becomes "the layouts below 951 px".

- [ ] **Step 15: Run the e2e test**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-shell.spec.ts`
Expected: PASS, 1 test. (Before Steps 5–11 it would fail at 800 px: `data-layout` was `narrow`.)

Unrun at task time (the exit runs them first): `workbench-shell.spec.ts` (edited), `workbench-structure.spec.ts:379`, `workbench-legend.spec.ts:252`, `workbench-loading.spec.ts:227`, `eat-visualization.spec.ts`.

- [ ] **Step 16: Document the mode source**

In `docs/developers/architecture.md`, insert before the line `## Filter panel`:

```md
## Workbench layout modes

The explore workbench has four layouts (design decision 17): `desktop` from 951 px wide, `tablet`
from 641 to 950 px, `phone` up to 640 px, and `landscape` for a phone on its side (landscape, at
most 500 px tall and 950 px wide), which wins over the others. `apps/web/src/explore/layout-mode.ts`
resolves the mode from three `matchMedia` queries (`LAYOUT_QUERIES` in `layout-defaults.ts`) and
is its one source: the shell's `useLayoutMode()` writes it to `data-layout` on the workbench,
which every layout rule in `workbench.css` keys on, and the runtime's controllers (when the
structure loads, when the Filter panel counts) read the same value. Touch affordances key on
`(pointer: coarse)`, not on the mode.

```

- [ ] **Step 17: Commit**

Run: `pnpm exec prettier --check apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-mode.ts apps/web/src/explore/layout-mode.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/explore/runtime.ts apps/web/src/explore/layout-state.ts apps/web/src/explore/layout-state.test.ts apps/web/src/workbench/use-layout-mode.ts apps/web/src/workbench/workbench.css apps/web/tests/mobile-shell.spec.ts apps/web/tests/workbench-shell.spec.ts docs/developers/architecture.md`

```bash
git add apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-mode.ts apps/web/src/explore/layout-mode.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/explore/runtime.ts apps/web/src/explore/layout-state.ts apps/web/src/explore/layout-state.test.ts apps/web/src/workbench/use-layout-mode.ts apps/web/src/workbench/workbench.css apps/web/tests/mobile-shell.spec.ts apps/web/tests/workbench-shell.spec.ts docs/developers/architecture.md
git commit -m "refactor(web): resolve four layout modes from one source"
```

(Sandbox disabled for the commit. The hook's knip run needs `hasStructureSheet`, `PHONE_MAX_WIDTH` and `LANDSCAPE_PHONE_MAX_HEIGHT` consumed: `layout-mode.test.ts` imports them.)

### Task 5.3: Tablet layout (641–950 px)

The scrolling fallback becomes a fixed screen for every non-desktop mode: the plot takes 3/5 of the height and a panel row below holds the legend (or Filter) and the structure side by side. Legend and Filter tabs replace the hidden rail, rendered into two new legend header slots and at the start of the Filter panel's header. The desktop sidebar slide never runs off desktop.

**Files:**

- Modify: `packages/core/src/components/legend/legend-header.ts` (slots `header-start` before the title, `header-end` after the settings button; `part="title"` on the `h3`), its styles module, `legend.header.test.ts`
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` (delete the `@media (max-width: 950px)` and `(max-width: 550px)` `:host` width rules; LEGACY stays 7)
- Create: `apps/web/src/workbench/PanelTabs.tsx`
- Modify: `apps/web/src/workbench/Sidebar.tsx` (PanelTabs as `slot="header-start"` child of `protspace-legend`), `FilterPanel.tsx` (PanelTabs first in `.wb-panel-header`; "Close filter" hidden off desktop; `narrowReturnTarget` goes), `use-sidebar-transition.ts` (third argument `animate: boolean`), `Workbench.tsx`, `workbench.css`, `apps/web/src/custom-elements.d.ts` (children on `protspace-legend` if its typing forbids them)
- Modify: `apps/web/tests/helpers/mobile.ts` (`panelTab` implementation confirmed), `mobile-explore-layout.spec.ts` (L3 fixme removed), `mobile-bars.spec.ts` (C10 fixme removed), `workbench-shell.spec.ts` (900 px: no page scroll), `workbench-legend.spec.ts:252` (renamed "the tablet legend scrolls its list inside its row")
- Modify: `docs/developers/api/index.md` (legend slots and `title` part)

**Interfaces:**

- Consumes: `useLayoutMode`, `LayoutMode` (5.2); `updateLayout`, `useLayout`; the `data-panel` CSS; `useSidebarTransition(open, targets)`.
- Produces:
  - Legend: `<slot name="header-start">` and `<slot name="header-end">` inside `.legend-header`; `part="title"` on `.legend-title`. Empty slots take no room (no gap from an empty slot).
  - `PanelTabs({ panel }: { panel: SidebarPanel })`: `role="tablist"` `aria-label="Sidebar panels"`, two `button role="tab"` named "Legend" and "Filter", `aria-selected`, `aria-controls` (`myLegend`, `wb-filter-panel`), roving `tabIndex`; click or Left/Right/Home/End → `updateLayout({ panel })`, then focus the same-named tab in the copy that is now shown (`[role=tab]` inside the newly shown panel). Class `wb-panel-tabs`; hidden on desktop by CSS (`.workbench[data-layout='desktop'] .wb-panel-tabs { display: none }`). The two copies render from `Sidebar` (inside the legend) and `FilterPanel`; `Sidebar` gains the `panel` prop (memo still holds: it changes only with the panel).
  - `useSidebarTransition(open, targets, animate: boolean)`: with `animate` false the phase follows `open` at once with no animation (the reduced-motion path). `Workbench` passes `desktop`.
  - CSS (tablet, applied to every `:not([data-layout='desktop'])` mode until 5.6/5.9 specialise): root `height: 100dvh; overflow: hidden`; `.wb-body` grid with areas `'plot plot' minmax(0,3fr) 'side struct' minmax(0,2fr) / minmax(0,1fr) minmax(0,1fr)`; plot `grid-area: plot`; `#wb-sidebar` `grid-area: side`, static, no width, top border; `.wb-structure` `grid-area: struct`, static, top and left borders; `#myLegend`/`#wb-filter-panel` fill the cell (`height: 100%`, list scrolls inside); with `data-structure="none"` the right cell shows the 44 px empty footer at its top; rail, edge, divider and float controls hidden; the view bar keeps its stages (no wrap at stage 3 is needed above 640; keep the wrap rule only for `phone` until 5.4). The old narrow block (`workbench.css:270-311`, `:470-476` app-bar columns, `:580-586`) is replaced, not kept beside.

**Tests:**

- `legend.header.test.ts`: "the header has header-start before the title and header-end after settings"; "slotted children render in order"; "the title has part title".
- `mobile-explore-layout.spec.ts` L3 green; `mobile-bars.spec.ts` C10 fixme removed (it runs at the exit).
- New in `mobile-explore-layout.spec.ts`: "on a tablet, the Filter tab swaps the panel without resizing the plot" (`watchPlotResizes` count 0; `data-panel="filter"`; the Filter copy's "Filter" tab focused); "with no protein the right half shows the empty footer and a first tap does not resize the plot".
- `workbench-shell.spec.ts`: 900×720 tablet, page does not scroll, plot above legend.
- Unrun at task time (exit): `mobile-bars.spec.ts` C10, `workbench-shell.spec.ts`, `workbench-legend.spec.ts:252`, `workbench-structure.spec.ts:379`, `workbench-sidebar.spec.ts`, `workbench-filter.spec.ts`, `eat-visualization.spec.ts:698` (601 px is phone after 5.4 but interim tablet CSS here), `mobile-shell.spec.ts`.

Verification: `legend.header.test.ts` (unit); `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts -g "tablet"`.

**Commit:** `feat(web): fixed tablet layout with legend and structure side by side` (core slot change may land first as `feat(core): add header slots and a title part to the legend` if it stands alone with its test).

Writer's notes:

- **Two commits:** the legend's slots and part (core, with their test and the API docs) first, then the tablet layout (app, e2e and the viewer's dead width rules).
- **`PanelTabs` takes an optional `slot` prop** besides `panel`, so the legend's copy can be the slotted element itself (no wrapper). An addition, not a change: callers that omit it are unaffected.
- **The app bar's below-951 rule stays** (`.workbench:not([data-layout='desktop']) header[data-workbench='app-bar']`, renamed in Task 5.2): at 641–950 px the desktop three-column grid does not fit Import, Export, Help, Feedback and GitHub beside search. Only the body's narrow rules are replaced.
- **`workbench-structure.spec.ts:379` changes too** (its "stacked: the structure follows the legend" assertion is now side by side); it runs at the exit, with the other `workbench` specs this task reaches.
- **One e2e run:** `mobile-explore-layout.spec.ts -g "tablet"` (L3 and the two new tablet tests, which live in that file). C10 in `mobile-bars.spec.ts` loses its fixme here but runs at the exit (one e2e spec file per task).

- [ ] **Step 1: Write the failing legend header tests**

In `packages/core/src/components/legend/legend.header.test.ts`, append inside `describe('legend header', () => { … })`, after the last `it(…)`:

```ts
  it('the header has header-start before the title and header-end after settings', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const header = legend.shadowRoot!.querySelector('.legend-header')!;
    const start = header.querySelector('slot[name="header-start"]');
    const end = header.querySelector('slot[name="header-end"]');
    expect(header.firstElementChild).toBe(start);
    expect(start!.nextElementSibling!.classList.contains('legend-title')).toBe(true);
    expect(header.lastElementChild).toBe(end);
    expect(end!.previousElementSibling!.classList.contains('settings-button')).toBe(true);
  });

  it('slotted children render in order', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const tabs = document.createElement('div');
    tabs.slot = 'header-start';
    const fold = document.createElement('button');
    fold.slot = 'header-end';
    // Light-DOM order does not matter: each child goes to its named slot.
    legend.append(fold, tabs);
    await legend.updateComplete;

    const root = legend.shadowRoot!;
    const assigned = (name: string) =>
      root.querySelector<HTMLSlotElement>(`slot[name="${name}"]`)!.assignedElements();
    expect(assigned('header-start')).toEqual([tabs]);
    expect(assigned('header-end')).toEqual([fold]);
  });

  it('the title has part title', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const title = legend.shadowRoot!.querySelector('.legend-header .legend-title')!;
    expect(title.tagName).toBe('H3');
    expect(title.getAttribute('part')).toBe('title');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.header.test.ts`
Expected: FAIL, 3 tests: the header has no `slot[name="header-start"]` (`firstElementChild` is the title), `querySelector('slot[name="header-start"]')` is null in the second, and the title has no `part`.

- [ ] **Step 3: Add the slots and the part**

In `packages/core/src/components/legend/legend-header.ts`, replace the doc comment of `renderLegendHeader` and the opening of its template, so the function reads:

```ts
/**
 * The 44 px legend header: an optional `header-start` slot, the title, predicted mark, info, then
 * sort, settings and an optional `header-end` slot. The host puts its own controls in the slots
 * (the workbench's Legend/Filter tabs and its fold chevron); an empty slot takes no room. The
 * title is one line ending in an ellipsis; the legend's shared name tooltip shows it in full.
 */
export function renderLegendHeader(
  model: LegendHeaderModel,
  handlers: LegendHeaderHandlers,
): TemplateResult {
  const sortName = `Sort: ${sortLabel(model.sortMode, model.isNumeric)}`;
  // aria-haspopup and aria-expanded are static: the sort menu exists only while open, and
  // ps-menu records these closed-state values when it mounts and restores them when it goes.
  return html`<div class="legend-header" part="header">
    <slot name="header-start"></slot>
    <h3 class="legend-title" part="title" @pointerenter=${handlers.onTitlePointerEnter}>${model.title}</h3>
```

Keep the rest of the template as it is, and add the `header-end` slot after the settings button, so the template ends:

```ts
    <ps-icon-button
      class="settings-button"
      icon="sliders-horizontal"
      label="Legend settings"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded=${model.settingsOpen ? 'true' : 'false'}
      @click=${(e: Event) => handlers.onSettings(e.currentTarget as HTMLElement)}
    ></ps-icon-button>
    <slot name="header-end"></slot>
  </div>`;
}
```

If Prettier wraps the `<h3>` so the title gains surrounding whitespace, that is fine: the existing test and the name tooltip both read `textContent` trimmed, and layout collapses it.

In `packages/core/src/components/legend/styles/header.ts`, append inside the `css` template (before the closing backtick):

```css
  /* The host's own controls (tabs, a fold chevron) keep their size; an empty slot is no flex
     item (a slot is display: contents), so it adds no gap. */
  ::slotted(*) {
    flex: none;
  }
```

- [ ] **Step 4: Run the header tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.header.test.ts`
Expected: PASS, the file's previous count + 3.

Report `wc -l packages/core/src/components/legend/legend.ts` (unchanged by this task). LEGACY stays 7.

- [ ] **Step 5: Document the slots and the part**

In `docs/developers/api/index.md`, under `## Legend`, replace the `### CSS parts` section's paragraph

```md
`container`, `header`, `items`, `item`, `symbol`, `text`, `count` and `empty`. The
`predicted-note` part is gone: a predicted annotation shows a sparkles icon in the header, with
its note in the icon's tooltip.
```

with

```md
`container`, `header`, `title`, `items`, `item`, `symbol`, `text`, `count` and `empty`. `title`
is the header's annotation name. The `predicted-note` part is gone: a predicted annotation shows
a sparkles icon in the header, with its note in the icon's tooltip.

### Slots

| Name           | Description                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| `header-start` | Controls placed at the start of the 44 px header row, before the title             |
| `header-end`   | Controls placed at the end of the header row, after the settings button             |

An empty slot takes no room. The demo app puts its Legend/Filter tabs in `header-start` below
951 px and, on phones, the panel's fold button in `header-end`.
```

- [ ] **Step 6: Commit the core change**

Run: `pnpm exec prettier --check packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/styles/header.ts packages/core/src/components/legend/legend.header.test.ts docs/developers/api/index.md`

```bash
git add packages/core/src/components/legend/legend-header.ts packages/core/src/components/legend/styles/header.ts packages/core/src/components/legend/legend.header.test.ts docs/developers/api/index.md
git commit -m "feat(core): add header slots and a title part to the legend"
```

(Sandbox disabled for the commit.)

- [ ] **Step 7: Remove the fixmes and write the new tablet tests**

In `apps/web/tests/mobile-explore-layout.spec.ts`, delete the line `test.fixme(true, 'task 5.3');` in L3. In `apps/web/tests/mobile-bars.spec.ts`, delete the line `test.fixme(true, 'task 5.3');` in C10.

In `mobile-explore-layout.spec.ts`, add `filterPanel` to the import from `./helpers/explore`, `panelTab` to the import from `./helpers/mobile`, and add `import { watchPlotResizes } from './helpers/workbench';`. Then add below `const workbench = …`:

```ts
/** Two frames on: a resize has reached its ResizeObserver by then. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
```

and append inside `test.describe('explore layout on a tablet', () => { … })`, after L3:

```ts
  test('on a tablet, the Filter tab swaps the panel without resizing the plot', async ({
    page,
  }) => {
    await openExplorePhone(page);
    const resizes = await watchPlotResizes(page);

    await panelTab(page, 'Filter').tap();

    await expect(workbench(page)).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    // The Filter panel's own copy of the tabs now holds focus.
    await expect(panelTab(page, 'Filter')).toBeFocused();
    await expect(panelTab(page, 'Filter')).toHaveAttribute('aria-selected', 'true');

    await panelTab(page, 'Legend').tap();
    await expect(workbench(page)).toHaveAttribute('data-panel', 'legend');
    await expect(panelTab(page, 'Legend')).toBeFocused();
    await settle(page);
    expect(await resizes()).toBe(0);
  });

  test('on a tablet with no protein, the right half shows the empty footer and a first tap does not resize the plot', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
    const footer = page.locator('[data-workbench="structure-empty"]');
    await expect(footer).toBeVisible();
    const legend = await box(page.locator('#myLegend'));
    const empty = await box(footer);
    // At the top of the right half, beside the legend.
    expect(empty.x).toBeGreaterThanOrEqual(legend.x + legend.width - 1);
    expect(Math.abs(empty.y - legend.y)).toBeLessThanOrEqual(1);

    const resizes = await watchPlotResizes(page);
    await tap(page, await proteinNear(page, 0.5, 0.5));
    await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
    await expect(page.locator('#myStructureViewer')).toBeVisible();
    await settle(page);
    expect(await resizes()).toBe(0);
  });
```

In `apps/web/tests/workbench-shell.spec.ts`, in "crossing 951 px keeps the same runtime elements", replace

```ts
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true);
```

with

```ts
    // A fixed screen below 951 px too: the plot over the panel row, and the page does not scroll.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(false);
```

In `apps/web/tests/workbench-legend.spec.ts`, rename the test `'the narrow legend scrolls its list instead of growing past the viewport'` to `'the tablet legend scrolls its list inside its row'` (body unchanged).

In `apps/web/tests/workbench-structure.spec.ts`, in "below 951 px there is no Pop out and a stored floating card shows docked", replace

```ts
  // Stacked: the structure follows the legend.
  const legend = (await page.locator('#myLegend').boundingBox())!;
  expect((await structurePanel(page).boundingBox())!.y).toBeGreaterThanOrEqual(
    legend.y + legend.height - 1,
  );
```

with

```ts
  // Tablet: the structure sits beside the legend, in the right half of the row under the plot.
  const legend = (await page.locator('#myLegend').boundingBox())!;
  const structure = (await structurePanel(page).boundingBox())!;
  expect(structure.x).toBeGreaterThanOrEqual(legend.x + legend.width - 1);
  expect(Math.abs(structure.y - legend.y)).toBeLessThanOrEqual(1);
```

- [ ] **Step 8: Run the tablet tests to see them fail**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts -g "tablet"`
Expected: FAIL. L3: the legend and the structure are stacked (the structure's top is below the legend's bottom). "the Filter tab swaps the panel": no `tab` named "Filter" exists. "with no protein": the empty footer sits under the legend, not beside it.

- [ ] **Step 9: Create `apps/web/src/workbench/PanelTabs.tsx`**

```tsx
import { flushSync } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';

const TABS: ReadonlyArray<{ panel: SidebarPanel; label: string; controls: string }> = [
  { panel: 'legend', label: 'Legend', controls: 'myLegend' },
  { panel: 'filter', label: 'Filter', controls: 'wb-filter-panel' },
];

/**
 * Shows `panel`, then focuses its tab in the copy of the tabs that is now on screen: the legend's
 * copy lives in its header, the Filter panel's in its own, and the one just used is now hidden.
 */
function choose(panel: SidebarPanel): void {
  flushSync(() => updateLayout({ panel }));
  const host = document.getElementById(panel === 'legend' ? 'myLegend' : 'wb-filter-panel');
  host?.querySelector<HTMLElement>(`.wb-panel-tabs [data-tab="${panel}"]`)?.focus();
}

interface PanelTabsProps {
  /** The panel shown: its tab is selected and the Tab stop. */
  panel: SidebarPanel;
  /** The legend's copy goes in its `header-start` slot. */
  slot?: string;
}

/**
 * The Legend and Filter tabs below 951 px (design decision 17), where the desktop rail is hidden.
 * Two copies render, one at the start of the legend's header and one in the Filter panel's, so
 * the tabs stay in the shown panel's header row; CSS hides both on desktop. Arrow keys, Home and
 * End switch panels at once (automatic activation).
 */
export function PanelTabs({ panel, slot }: PanelTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: SidebarPanel | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = panel === 'legend' ? 'filter' : 'legend';
    } else if (event.key === 'Home') {
      next = 'legend';
    } else if (event.key === 'End') {
      next = 'filter';
    }
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Sidebar panels"
      className="wb-panel-tabs"
      slot={slot}
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab) => (
        <button
          key={tab.panel}
          type="button"
          role="tab"
          data-tab={tab.panel}
          aria-selected={tab.panel === panel}
          aria-controls={tab.controls}
          tabIndex={tab.panel === panel ? 0 : -1}
          onClick={() => choose(tab.panel)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

(`key` here is on plain buttons in a map, not on a runtime element.)

- [ ] **Step 10: Render the tabs in both panels; hide Close filter off desktop**

In `apps/web/src/workbench/Sidebar.tsx`:

- change `import { SIDEBAR_WIDTH } from '../explore/layout-defaults';` to `import { SIDEBAR_WIDTH, type SidebarPanel } from '../explore/layout-defaults';` and add `import { PanelTabs } from './PanelTabs';`;
- add to `SidebarProps`:

```ts
  /** The panel shown (the legend or Filter): both copies of the tabs mark it. */
  panel: SidebarPanel;
```

- replace the `Sidebar` component with:

```tsx
export const Sidebar = memo(function Sidebar({ ref, inert, panel }: SidebarProps) {
  return (
    <aside ref={ref} inert={inert} id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      >
        <PanelTabs panel={panel} slot="header-start" />
      </protspace-legend>
      <FilterPanel panel={panel} />
    </aside>
  );
});
```

and in its doc comment replace "it re-renders only when the sidebar becomes inert or interactive again" with "it re-renders only when the sidebar becomes inert or interactive again or the panel changes".

Replace the whole of `apps/web/src/workbench/FilterPanel.tsx` with:

```tsx
import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { PanelTabs } from './PanelTabs';

/**
 * The sidebar's Filter panel (design decision 14): in place of the legend, above the structure.
 * It hosts the query builder, a runtime element the filter controller wires by id, so the section
 * renders once and only CSS (`data-panel` on the workbench) shows or hides it. Below 951 px its
 * header starts with the Legend/Filter tabs, which switch panels; on desktop Close returns to the
 * legend and hands focus to the rail's Filter item (CSS hides Close below 951 px).
 */
export function FilterPanel({ panel }: { panel: SidebarPanel }) {
  const close = useRef<HTMLElement>(null);

  useEffect(() => {
    const button = close.current;
    if (!button) return;
    const onClick = () => {
      updateLayout({ panel: 'legend' });
      document.getElementById('wb-rail-filter')?.focus();
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, []);

  return (
    <section
      id="wb-filter-panel"
      data-workbench="filter-panel"
      role="region"
      aria-labelledby="wb-filter-title"
    >
      <header className="wb-panel-header">
        <PanelTabs panel={panel} />
        <h2 id="wb-filter-title" className="wb-panel-title" tabIndex={-1}>
          Filter
        </h2>
        <ps-icon-button
          ref={close}
          className="wb-panel-close"
          icon="x"
          label="Close filter"
        ></ps-icon-button>
      </header>
      <div className="wb-filter-body">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </div>
    </section>
  );
}
```

(`narrowReturnTarget` and the `useLayoutMode` import go: Close only shows on desktop.)

- [ ] **Step 11: No sidebar slide off desktop**

In `apps/web/src/workbench/use-sidebar-transition.ts`, replace the signature and the render-time phase adjustment:

```ts
export function useSidebarTransition(open: boolean, targets: SlideTargets): SidebarPhase {
  const [phase, setPhase] = useState<SidebarPhase>(open ? 'open' : 'collapsed');
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    // React's "adjust state while rendering": the phase moves in the same render as `open`.
    setShownOpen(open);
    if (prefersReducedMotion()) setPhase(open ? 'open' : 'collapsed');
    else setPhase(open ? 'opening' : 'closing');
  }
```

with

```ts
export function useSidebarTransition(
  open: boolean,
  targets: SlideTargets,
  animate: boolean,
): SidebarPhase {
  const [phase, setPhase] = useState<SidebarPhase>(open ? 'open' : 'collapsed');
  const [shownOpen, setShownOpen] = useState(open);
  const settled: SidebarPhase = open ? 'open' : 'collapsed';
  if (open !== shownOpen) {
    // React's "adjust state while rendering": the phase moves in the same render as `open`.
    setShownOpen(open);
    if (!animate || prefersReducedMotion()) setPhase(settled);
    else setPhase(open ? 'opening' : 'closing');
  } else if (!animate && phase !== settled) {
    // The window left desktop in mid-slide: settle at once, with no slide off desktop.
    setPhase(settled);
  }
```

In the `useLayoutEffect` below it, change the first line to `if (!animate || (phase !== 'opening' && phase !== 'closing')) return;`, rename its local `const settled: SidebarPhase = …` to `const done: SidebarPhase = phase === 'opening' ? 'open' : 'collapsed';` (and `setPhase(settled)` in the `then` to `setPhase(done)`), and change its dependency list to `[phase, aside, structure, animate]`.

Add to the hook's doc comment, after its first paragraph: "Off desktop (`animate` false) the sidebar is the panel under the plot: it never slides, and the phase follows `open` at once."

In `apps/web/src/workbench/Workbench.tsx`:

- the `useSidebarTransition(layout.sidebarOpen, { … })` call gains a third argument: close the targets object with `},` and add `desktop,` before `);` so it reads

```ts
  const phase = useSidebarTransition(
    layout.sidebarOpen,
    {
      aside: asideRef,
      // A floating card stays over the plot: it does not slide with the sidebar.
      structure: structure === 'floating' ? NO_SLIDE_TARGET : structureRef,
    },
    // Below 951 px the sidebar is the panel under the plot: it never slides.
    desktop,
  );
```

- `<Sidebar ref={asideRef} inert={sidebarHidden} />` becomes `<Sidebar ref={asideRef} inert={sidebarHidden} panel={layout.panel} />`.

`custom-elements.d.ts` needs no change: `protspace-legend`'s props come from `React.HTMLAttributes<HTMLElement>`, which allows children, and `slot` and `className` are standard attributes.

- [ ] **Step 12: The tablet layout in `workbench.css`**

In `apps/web/src/workbench/workbench.css`, delete everything from the line `/* ── Below 951 px (every mode but desktop, until Task 5.3): the plot, then the sidebar ── */` (Task 5.2's heading) up to, but not including, the line `/* ── Keyboard shortcuts dialog (light DOM slotted into ps-dialog) ─────────── */`, and put there:

```css
/* ── Below 951 px (design decision 17): a fixed screen, the plot over a panel row ─────
   The tablet layout; the phone (Task 5.6) and landscape (Task 5.9) layouts specialise it. The
   plot takes 3/5 of the height; under it the legend (or Filter) and the structure share the row,
   half each, with or without a protein, so a first tap never resizes the plot. Fr tracks: a
   mode change moves the plot's box once. */
.workbench:not([data-layout='desktop']) {
  height: 100dvh;
  overflow: hidden;
}

.workbench:not([data-layout='desktop']) .wb-body {
  display: grid;
  grid-template:
    'plot plot' minmax(0, 3fr)
    'side struct' minmax(0, 2fr)
    / minmax(0, 1fr) minmax(0, 1fr);
}

.workbench:not([data-layout='desktop']) [data-workbench='plot'] {
  grid-area: plot;
  position: relative;
  inset: auto;
  min-height: 0;
}

/* Static and without a width: no slide, no z-index, nothing on the legend's ancestors. */
.workbench:not([data-layout='desktop']) [data-workbench='sidebar'] {
  grid-area: side;
  position: static;
  width: auto;
  min-height: 0;
  border-top: 1px solid var(--ps-border);
  border-left: 0;
}

/* The legend or the Filter panel fills its half; a long list scrolls inside it. */
.workbench:not([data-layout='desktop']) :is(#myLegend, #wb-filter-panel) {
  flex: none;
  height: 100%;
}

/* The phone's view bar still wraps at its last stage until Task 5.4 gives it its own rules. */
.workbench[data-layout='phone'] [data-workbench='view-bar'][data-stage='3'] {
  flex-wrap: wrap;
  height: auto;
  min-height: var(--wb-view-bar-height);
}

.workbench[data-layout='phone'] [data-workbench='view-bar'][data-stage='3'] .wb-view-group {
  flex-wrap: wrap;
}

/* ── Panel tabs below 951 px: Legend and Filter, where the desktop rail switches them ── */

.wb-panel-tabs {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--ps-space-0-5);
  padding: var(--ps-space-0-5);
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
  background: var(--ps-surface-muted);
}

.workbench[data-layout='desktop'] .wb-panel-tabs {
  display: none;
}

.wb-panel-tabs [role='tab'] {
  min-height: var(--ps-control-sm);
  padding: 0 var(--ps-space-3);
  border: 0;
  border-radius: var(--ps-radius);
  background: transparent;
  color: var(--ps-text-muted);
  font: inherit;
  font-size: var(--ps-text-sm);
  font-weight: var(--ps-weight-medium);
  white-space: nowrap;
  cursor: pointer;
}

.wb-panel-tabs [role='tab'][aria-selected='true'] {
  background: var(--ps-surface);
  color: var(--ps-text);
  box-shadow: var(--ps-shadow-sm);
}

.wb-panel-tabs [role='tab']:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: var(--ps-focus-offset);
}

/* Finger-sized tabs, still inside the 44 px header: the group drops its inner padding. */
@media (pointer: coarse) {
  .wb-panel-tabs {
    padding: 0;
  }

  .wb-panel-tabs [role='tab'] {
    min-height: var(--ps-touch-target);
  }
}

/* The tabs switch panels below 951 px, so the Filter panel's Close is desktop-only. */
.workbench:not([data-layout='desktop']) .wb-panel-close {
  display: none;
}

.workbench:not([data-layout='desktop']) .wb-panel-title {
  color: var(--ps-text-muted);
  font-size: var(--ps-text-sm);
}
```

Still in `workbench.css`, in the `.wb-panel-header` rule add `gap: var(--ps-space-2);` after `justify-content: space-between;`, and in the `.wb-panel-title` rule add `flex: 1 1 auto;` and `min-width: 0;` before `margin: 0;` (with the tabs first, the title takes the middle and Close stays at the end; on desktop, where the tabs are hidden, it looks as before).

Replace the two structure rules Task 5.2 renamed:

```css
.workbench:not([data-layout='desktop']) .wb-structure {
  border-top: 1px solid var(--ps-border);
}

.workbench:not([data-layout='desktop'])[data-structure='docked'] .wb-structure {
  height: 420px;
}
```

with

```css
/* The right half of the panel row: the empty footer at its top, or the docked viewer. */
.workbench:not([data-layout='desktop']) .wb-structure {
  grid-area: struct;
  min-height: 0;
  border-top: 1px solid var(--ps-border);
  border-left: 1px solid var(--ps-border);
}
```

Leave the app bar's `.workbench:not([data-layout='desktop']) header[data-workbench='app-bar']` and `.wb-dataset-name` rules as they are (see the notes).

Check: `grep -n "not(\[data-layout='desktop'\])" apps/web/src/workbench/workbench.css` lists only the rules above, the app bar's two, `.wb-divider` and nothing that sets `height: 60vh`, `min-height: 320px` or `height: 420px`.

- [ ] **Step 13: Delete the viewer's stale width rules**

In `packages/core/src/components/structure-viewer/structure-viewer.styles.ts`, replace

```css
  @media (max-width: 950px) {
    /* --breakpoint-lg */
    :host {
      width: calc(50% - 6px);
    }

    /* The stacked layout leaves the panel short and half-width; keep only the color legend */
    .interaction-tip {
      display: none;
    }
  }

  @media (max-width: 550px) {
    /* --breakpoint-xs */
    :host {
      width: 100%;
    }
  }
```

with

```css
  /* Below desktop the viewer has half a panel row: keep only the colour legend. The host's size
     is the shell's to set (the workbench fills its structure section). */
  @media (max-width: 950px) {
    .interaction-tip {
      display: none;
    }
  }
```

The file stays in the style lint's `LEGACY` set (it still has raw values elsewhere): LEGACY stays 7. Report `wc -l packages/core/src/components/structure-viewer/structure-viewer.ts` (unchanged). No unit test covers these rules; L3 checks the viewer's width beside the legend.

- [ ] **Step 14: Run the tablet tests**

Run: `pnpm --filter @protspace/core build` (the app imports core's dist; the e2e run also builds it, but the type-check below needs it).
Run: `pnpm --filter @protspace/app type-check`
Expected: no errors.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts -g "tablet"`
Expected: PASS: L3, "on a tablet, the Filter tab swaps the panel without resizing the plot" and "on a tablet with no protein, …" (3 tests; nothing skipped matches "tablet").

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.header.test.ts`
Expected: PASS (unchanged since Step 4).

Unrun at task time (the exit runs them first): `mobile-bars.spec.ts` C10 (portrait tablet bars; fixme removed here), `workbench-shell.spec.ts` (edited: 900 px does not scroll), `workbench-legend.spec.ts:252` (renamed), `workbench-structure.spec.ts:379` (edited), `workbench-sidebar.spec.ts`, `workbench-filter.spec.ts` (Close filter on desktop), `eat-visualization.spec.ts:698` (601 px is tablet CSS until Task 5.6), `mobile-shell.spec.ts`.

- [ ] **Step 15: Commit the tablet layout**

Run: `pnpm exec prettier --check apps/web/src/workbench/PanelTabs.tsx apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/FilterPanel.tsx apps/web/src/workbench/use-sidebar-transition.ts apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css packages/core/src/components/structure-viewer/structure-viewer.styles.ts apps/web/tests/mobile-explore-layout.spec.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/workbench-shell.spec.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/workbench-structure.spec.ts`

```bash
git add apps/web/src/workbench/PanelTabs.tsx apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/FilterPanel.tsx apps/web/src/workbench/use-sidebar-transition.ts apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css packages/core/src/components/structure-viewer/structure-viewer.styles.ts apps/web/tests/mobile-explore-layout.spec.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/workbench-shell.spec.ts apps/web/tests/workbench-legend.spec.ts apps/web/tests/workbench-structure.spec.ts
git commit -m "feat(web): fixed tablet layout with legend and structure side by side"
```

(Sandbox disabled for the commit.)

### Task 5.4: Phone bars (app bar, search toggle, view bar)

At ≤ 640 px the app bar shrinks to the wordmark, the dataset name and a search button that opens search over the bar, and the view bar keeps Projection, its details icon, Color by and More. Bar controls become 40 px touch targets under a coarse pointer. The view bar stops measuring stages on phones.

One finding shapes this task beyond the skeleton: a `popover="manual"` element inside a `display: none` ancestor never renders, even in the top layer (checked in Chromium: `showPopover()` leaves it `:popover-open` with a 0×0 box). Hiding `[data-workbench='app-bar-actions']` with `display: none` would therefore break the Import panel the dataset name opens and the Export menu Task 5.5 opens from More. The import and export menus get a `trigger` CSS part instead; the phone CSS hides only the two triggers and keeps their hosts rendered (see the interface note in Interfaces).

**Files:**

- Create: `apps/web/src/workbench/SearchToggle.tsx`
- Modify: `apps/web/src/workbench/AppBar.tsx` (search open state, `data-search-open`, SearchToggle at the end of the bar, close button inside `[data-workbench="app-bar-center"]`), `ViewBar.tsx` (mode into the stage hook), `MoreMenu.tsx` (class on the visible "More" label only), `use-view-bar-stage.ts` (mode argument), `workbench.css` (phone bar rules; coarse app-bar targets; landscape keeps tablet bars until 5.9)
- Modify: `packages/core/src/components/protein-search/protein-search.ts`, `protein-search.component.test.ts` (`focusInput()`)
- Modify: `packages/core/src/components/import-menu/import-menu.ts`, `import-menu.browser.test.ts`; `packages/core/src/components/export-menu/export-menu.ts`, `export-menu.browser.test.ts` (`part="trigger"` on each trigger)
- Modify: `packages/core/src/components/annotation-select/annotation-select.styles.ts`, `scatter-plot/projection-metadata/projection-metadata.styles.ts` (coarse 40 px triggers); `projection-select/projection-select.styles.ts` (the trigger may shrink; its `ps-button` is already 40 px under a coarse pointer). `contours-menu` is a `ps-button` and hidden on phones: unchanged.
- Modify: `apps/web/tests/mobile-bars.spec.ts` (C1, C2 fixmes removed; new tests), `apps/web/tests/workbench-view-bar.spec.ts` (stage search floor 641; a squeezed bar so stages 2 and 3 are reachable above 641; new phone test), `apps/web/tests/dataset-reload.spec.ts` (the compact import affordance is the dataset button)
- Modify: `docs/developers/api/index.md` (`focusInput()`, the menus' `trigger` part)

**Interfaces:**

- Consumes: `useLayoutMode` (`apps/web/src/workbench/use-layout-mode.ts`, returns `LayoutMode` from Task 5.2), `hasStructureSheet(mode)` (`apps/web/src/explore/layout-mode.ts`, Task 5.2); `LayoutMode` (`apps/web/src/explore/layout-defaults.ts`); `#myProteinSearch`; helpers `appBar`, `viewBar`, `searchInput`, `getSelectedProteinIds`, `datasetSwitcher`, `importMenu`, `importTrigger`, `projectionTrigger`, `filterButton`, `filterPanel`, `waitForExploreInteractionReady` (`helpers/explore.ts`); `openExplorePhone`, `searchToggle`, `box`, `expectWithinViewport`, `expectNoHorizontalOverflow`, `proteinNear` (`helpers/mobile.ts`, Task 5.1); the Legend/Filter tabs (`role="tab"`, Task 5.3).
- Produces:
  - `ProtspaceProteinSearch.focusInput(): void` — focuses its text input with `preventScroll`; no other effect (a focus opens the suggestion list as any focus does).
  - `protspace-import-menu` and `protspace-export-menu`: CSS part `trigger` on their own trigger (the Import `<button>`, the Export `ps-button`). **Not in the skeleton**: needed because a hidden host takes its popover with it (see intro); listed as an interface change request.
  - `SearchToggle({ ref, open, onOpen })`: `ps-icon-button icon="search" label="Search proteins"` with `expanded`; class `wb-search-toggle`; CSS shows it only at `data-layout="phone"` (Task 5.9 adds landscape). The optional `ref` reaches the button, for focus return.
  - AppBar: `searchOpen = hasStructureSheet(mode) && wanted`; header `data-search-open` while open; opening commits with `flushSync` and then calls `focusInput()` on `#myProteinSearch`; the center holds `ps-icon-button.wb-search-close icon="x" label="Close search"` (shown on phones only); closing on "Close search", on a `keydown` Escape reaching the header with `!nativeEvent.defaultPrevented` (it then calls `preventDefault()`, so the selection's Escape fallback does not also run), and on `focusout` whose `relatedTarget` is outside the header; closing returns focus to the toggle except on focusout. Leaving the sheet modes closes it. No layer is pushed.
  - `useViewBarStage(barRef, mode: LayoutMode)`: in sheet modes it returns 3, writes `data-stage="3"` and does not measure (no observer); leaving them re-measures from stage 0.
  - Phone CSS (`.workbench[data-layout='phone']`): `--wb-view-bar-height: 48px`; app bar columns `minmax(0, 1fr) auto`, padding `0 4px 0 12px`, `position: relative`; `[data-workbench='app-bar-actions']` taken out of the grid (`position: absolute`, 0×0) with every child but `.wb-data-actions` hidden and `#myImportMenu::part(trigger)`, `#myExportMenu::part(trigger)` hidden; the wordmark separator hidden, the wordmark 18 px tall; dataset name `max-width: 45vw`, `min-width: 48px`; `[data-workbench='app-bar-center']` hidden, and with `[data-search-open]` absolutely over the bar (`inset: 0`, surface background); view bar `#myContoursMenu`, `.wb-view-sep`, `#myFilterButton` hidden, `.wb-view-group` and the two pickers shrink (`flex: 0 1 auto; min-width: 0`), More pushed right and icon-only (its visible "More" label hidden; the name stays "More view options"); no wrap.
  - Coarse CSS: the wordmark link and the dataset button ≥ 40 px tall, `.wb-icon-link` 40×40 (`workbench.css`); Color by's `.dropdown-trigger` and the projection details `.trigger` 40 px (core).

**Tests:**

- `protein-search.component.test.ts`: "focusInput focuses the text input".
- `import-menu.browser.test.ts`: "with its trigger hidden through the trigger part, openFrom still shows the panel under the anchor". `export-menu.browser.test.ts`: "the trigger is exposed as the part trigger".
- `mobile-bars.spec.ts`: C1, C2 green; new "the search button opens search over the app bar; a pasted ID selects its protein; Close search returns focus to the button"; "Escape closes the search overlay when nothing else handled it"; "at 320 px the dataset name keeps more than 40 px".
- `workbench-view-bar.spec.ts`: searches start at 641 (with the bar's right padding widened to 178 px so stages 2 and 3 fall above 641: measured stage widths with the demo are 711, 523, 516 and 433 px); new "below 641 px the phone view bar shows Projection, Color by and More".
- `dataset-reload.spec.ts`: compact affordance test updated (568×527 is phone).
- Unrun at task time (exit): `workbench-view-bar.spec.ts` (all), `dataset-reload.spec.ts`, `eat-visualization.spec.ts:552,698,713`, `workbench-search.spec.ts`, `workbench-import-export.spec.ts` (the triggers' new part), `workbench-help.spec.ts`.

LEGACY count: 7 (`projection-metadata.styles.ts` gains a coarse rule and still violates).

- [ ] **Step 1: Remove the C1 and C2 fixmes and run them red**

In `apps/web/tests/mobile-bars.spec.ts` delete every line that reads exactly `test.fixme(true, 'task 5.4');` (the parameterised C1/C2 test at 360×740 and 412×839; nothing else carries this label).

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts -g "whole labels"`

(If 5.1 titled C1/C2 differently, filter with a word from their title instead; the two runs are the 360 and 412 cases.)

Expected: FAIL at both widths — the view bar is 44 px (not 48); the app bar still shows Import, Export, Help, Feedback and GitHub and the search field; the projection details trigger is 28×28 and Color by 32 px tall (`touchTargetsBelow` lists them); at 360 the view bar overflows.

- [ ] **Step 2: Write the failing core tests**

Append to `packages/core/src/components/protein-search/protein-search.component.test.ts` (after the last `describe` block):

```ts
describe('protspace-protein-search focusInput', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focusInput focuses the text input', async () => {
    const element = await setupSearch();
    expect(element.shadowRoot!.activeElement).toBeNull();

    (element as ProteinSearchElement & { focusInput(): void }).focusInput();

    expect(element.shadowRoot!.activeElement).toBe(inputOf(element));
  });
});
```

Append inside `describe('protspace-import-menu', …)` in `packages/core/src/components/import-menu/import-menu.browser.test.ts`, after the test `'openFrom another anchor while open moves the panel there and focuses its first action'`:

```ts
  it('with its trigger hidden through the trigger part, openFrom still shows the panel under the anchor', async () => {
    // The app's phone bar hides the Import button but keeps the element rendered: a popover
    // inside a display: none ancestor would never show.
    const style = document.createElement('style');
    style.textContent = 'protspace-import-menu::part(trigger) { display: none; }';
    document.head.append(style);
    try {
      expect(trigger().getClientRects().length).toBe(0);
      datasetButton().focus();
      menu.openFrom(datasetButton());
      await settle();

      expect(isOpen()).toBe(true);
      expect(panel().checkVisibility()).toBe(true);
      const anchor = datasetButton().getBoundingClientRect();
      const box = panel().getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);
      expect(Math.abs(box.left - anchor.left)).toBeLessThan(2);
    } finally {
      style.remove();
    }
  });
```

Append inside `describe('protspace-export-menu', …)` in `packages/core/src/components/export-menu/export-menu.browser.test.ts`, after the test `'with file settings, the trigger carries the custom-settings tooltip'`:

```ts
  it('the trigger is exposed as the part trigger', () => {
    expect(trigger().getAttribute('part')).toBe('trigger');
  });
```

- [ ] **Step 3: Run the core tests to verify they fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/protein-search/protein-search.component.test.ts`

Expected: FAIL — `focusInput is not a function`.

Run (Bash sandbox disabled: browser mode listens on a local port): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/import-menu/import-menu.browser.test.ts src/components/export-menu/export-menu.browser.test.ts`

Expected: FAIL — the import test sees the trigger's box (`getClientRects().length` is 1: the part does not exist, so the style matches nothing); the export test reads `null` for `part`.

- [ ] **Step 4: Implement the core pieces**

In `packages/core/src/components/protein-search/protein-search.ts`, add after `public reportNotInView(proteinId: string): void { … }` (before `public clearSelections()`):

```ts
  /**
   * Public API: focuses the text input without scrolling, as ⌘K does. The app's phone bar calls
   * it after it shows the field over the bar.
   */
  public focusInput(): void {
    this.shadowRoot
      ?.querySelector<HTMLInputElement>('#protein-search-input')
      ?.focus({ preventScroll: true });
  }
```

In `packages/core/src/components/import-menu/import-menu.ts`, in `render()`, the trigger button opens with:

```ts
    return html`<button
        class="trigger"
        type="button"
```

Replace those three lines with:

```ts
    return html`<button
        class="trigger"
        part="trigger"
        type="button"
```

In `packages/core/src/components/export-menu/export-menu.ts`, in `render()`, replace

```ts
    return html`<ps-button class="trigger" variant="secondary" @click=${this.toggle}>
```

with

```ts
    return html`<ps-button class="trigger" part="trigger" variant="secondary" @click=${this.toggle}>
```

In `packages/core/src/components/annotation-select/annotation-select.styles.ts`, after the `.dropdown-trigger.open { box-shadow: … }` rule, add:

```css
    /* A finger-sized target (design decision 17); the bar's 48 px row on a phone holds it. */
    @media (pointer: coarse) {
      .dropdown-trigger {
        height: var(--ps-touch-target);
      }
    }

    /* The view bar narrows Color by on a phone: the value ends in an ellipsis instead of the bar
       overflowing. The container's own minimum would otherwise stay at the text's width. */
    :host,
    .annotation-select-container {
      min-width: 0;
    }
```

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, after the `.trigger { … }` rule (the one that sets `width: var(--ps-control-sm)`), add:

```css
    @media (pointer: coarse) {
      .trigger {
        width: var(--ps-touch-target);
        height: var(--ps-touch-target);
      }
    }
```

In `packages/core/src/components/projection-select/projection-select.styles.ts`, after the `.value { … }` rule, add:

```css
    /* On a phone the view bar narrows the picker: the value ends in an ellipsis. Every box from
       the host down to the value may shrink. */
    .trigger,
    .trigger::part(button) {
      min-width: 0;
      max-width: 100%;
    }
    .value {
      min-width: 0;
    }
```

- [ ] **Step 5: Run the core tests to verify they pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/protein-search/protein-search.component.test.ts`

Expected: PASS (report the file's count before and after: +1).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/import-menu/import-menu.browser.test.ts src/components/export-menu/export-menu.browser.test.ts src/components/annotation-select/annotation-select.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`

Expected: PASS (+1 each in the two menu files; the select and metadata files unchanged: the coarse rules do not apply to a fine pointer and `min-width: 0` does not change a box that is not squeezed).

Then build core for the app: `pnpm --filter @protspace/core build`.

- [ ] **Step 6: The view bar's stage hook takes the mode**

In `apps/web/src/workbench/use-view-bar-stage.ts`:

Replace the import block

```ts
import { type RefObject, useEffect, useState } from 'react';
import { getWorkbenchStatus, subscribeWorkbenchStatus } from '../explore/workbench-status';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';
```

with

```ts
import { type RefObject, useEffect, useState } from 'react';
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import { getWorkbenchStatus, subscribeWorkbenchStatus } from '../explore/workbench-status';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';
```

Replace the hook's doc comment and signature, from `/**\n * The view bar's stage (view-bar-overflow.ts) for the bar in `barRef`.` through `export function useViewBarStage(barRef: RefObject<HTMLElement | null>): ViewBarStage {\n  const [stage, setStage] = useState<ViewBarStage>(0);`, with:

```ts
/**
 * The view bar's stage (view-bar-overflow.ts) for the bar in `barRef`. One ResizeObserver watches
 * the bar and its items; their callbacks only take note, and the measuring runs once in the next
 * animation frame, where showing a candidate stage (data-stage) and reading its width is safe. A
 * stage's width is measured once and cached; a change in an item's own width (a new dataset's
 * names, another contour mode, a filter count) or the web font arriving clears the cache. On a
 * phone (`mode` a sheet mode) the bar is fixed (design decision 17): stage 3, nothing measured,
 * and workbench.css decides what shows; leaving the phone layouts measures again from stage 0.
 */
export function useViewBarStage(
  barRef: RefObject<HTMLElement | null>,
  mode: LayoutMode,
): ViewBarStage {
  const [stage, setStage] = useState<ViewBarStage>(0);
  const fixed = hasStructureSheet(mode);
```

Right after `const bar = barRef.current;\n    if (!bar) return;` inside the effect, add:

```ts
    if (fixed) {
      bar.dataset.stage = '3';
      return;
    }
```

In `resolve`, replace

```ts
      if (next !== current) {
        current = next;
        setStage(next);
      }
```

with

```ts
      // Always handed to React (an equal value renders nothing): coming back from a phone layout
      // the state may still hold the stage from before it, while `current` starts at 0.
      current = next;
      setStage(next);
```

Replace the effect's dependency list `}, [barRef]);` with `}, [barRef, fixed]);`, and the hook's last line `return stage;` with `return fixed ? 3 : stage;`.

In `apps/web/src/workbench/ViewBar.tsx`, add `import { useLayoutMode } from './use-layout-mode';` after `import { MoreMenu } from './MoreMenu';`, and replace

```ts
  const bar = useRef<HTMLDivElement>(null);
  const stage = useViewBarStage(bar);
```

with

```ts
  const bar = useRef<HTMLDivElement>(null);
  const mode = useLayoutMode();
  const stage = useViewBarStage(bar, mode);
```

Add to its doc comment, after "the keys hide, then Contours and then Filter move into More.": " On a phone the bar is fixed at stage 3 and workbench.css shows Projection, its details, Color by and More."

In `apps/web/src/workbench/MoreMenu.tsx`, replace `<span aria-hidden="true">More</span>` with `<span className="wb-more-label" aria-hidden="true">More</span>` (the phone bar hides the visible word; the screen-reader name is the `sr-only` span beside it).

- [ ] **Step 7: The search toggle and the app bar**

Create `apps/web/src/workbench/SearchToggle.tsx`:

```tsx
import type { Ref } from 'react';

interface SearchToggleProps {
  /** The button itself: the bar returns focus to it when search closes. */
  ref?: Ref<HTMLElement>;
  /** Search shows over the app bar. */
  open: boolean;
  onOpen(): void;
}

/**
 * The phone app bar's search button (design decision 17): below 641 px search does not fit beside
 * the wordmark and the dataset name, so this opens it over the bar. workbench.css shows it only in
 * the phone layout.
 */
export function SearchToggle({ ref, open, onOpen }: SearchToggleProps) {
  return (
    <ps-icon-button
      ref={ref}
      className="wb-search-toggle"
      icon="search"
      label="Search proteins"
      expanded={open ? 'true' : 'false'}
      onClick={onOpen}
    ></ps-icon-button>
  );
}
```

In `apps/web/src/workbench/AppBar.tsx`:

Replace the first import line `import { memo, useRef, type MouseEvent } from 'react';` with:

```ts
import {
  memo,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
```

Replace `import type { ProtspaceImportMenu } from '@protspace/core';` with `import type { ProtspaceImportMenu, ProtspaceProteinSearch } from '@protspace/core';`, and add after `import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';`:

```ts
import { hasStructureSheet } from '../explore/layout-mode';
```

and after `import { HelpMenu } from './HelpMenu';`:

```ts
import { SearchToggle } from './SearchToggle';
```

and after `import { useAppBarSides } from './use-app-bar-sides';`:

```ts
import { useLayoutMode } from './use-layout-mode';
```

Replace the whole `export function AppBar() { … }` (from its doc comment `/**\n * The 48 px app bar (design decision 1)` to the end of the file) with:

```tsx
/**
 * The 48 px app bar (design decision 1): the wordmark and the dataset on screen, search in the
 * centre, and the actions. The site's navigation stays on the other pages. On a phone (decision
 * 17) it keeps the wordmark, the dataset and a search button that shows search over the bar; the
 * actions move into the view bar's More sheet, and their menus stay mounted here, unseen.
 */
export function AppBar() {
  const { datasetName, proteinCount } = useWorkbenchStatus();
  const compact = hasStructureSheet(useLayoutMode());
  const [searchWanted, setSearchWanted] = useState(false);
  const searchOpen = compact && searchWanted;
  const barRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLElement>(null);
  useAppBarSides(barRef);

  // Wider, search sits in the bar again; the next phone layout starts with it closed.
  useEffect(() => {
    if (!compact) setSearchWanted(false);
  }, [compact]);

  const openSearch = () => {
    // Commit first: the field is display: none until the bar shows it.
    flushSync(() => setSearchWanted(true));
    (document.getElementById('myProteinSearch') as ProtspaceProteinSearch | null)?.focusInput();
  };
  const closeSearch = (returnFocus: boolean) => {
    setSearchWanted(false);
    if (returnFocus) toggleRef.current?.focus();
  };
  // An Escape nothing else took: the suggestion list and the report are layers, which take theirs
  // first. Default-prevented here, so the selection's Escape fallback does not run as well.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!searchOpen || event.key !== 'Escape') return;
    if (event.nativeEvent.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    closeSearch(true);
  };
  // Focus leaving the bar (a tap on the plot, Tab past the field) closes search; a move inside the
  // bar (into the search's shadow root, onto Close search) does not.
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!searchOpen) return;
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    closeSearch(false);
  };

  return (
    <header
      ref={barRef}
      className="wb-app-bar"
      data-workbench="app-bar"
      data-search-open={searchOpen ? '' : undefined}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="wb-app-bar-start" data-workbench="app-bar-start">
        <Link to="/" data-workbench="home" aria-label="ProtSpace home">
          <img src="/wordmark.svg" alt="" />
        </Link>
        <span className="wb-separator" aria-hidden="true" />
        <button
          type="button"
          className="wb-dataset"
          data-workbench="dataset"
          data-dataset-name={datasetName ?? ''}
          aria-haspopup="dialog"
          aria-label={
            datasetName === null ? undefined : datasetButtonLabel(datasetName, proteinCount)
          }
          hidden={datasetName === null}
          onClick={toggleImportMenu}
        >
          <Database className="wb-dataset-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          {datasetName !== null && (
            <span className="wb-dataset-name">{shownName(datasetName)}</span>
          )}
          {proteinCount !== null && (
            <span className="wb-dataset-count">· {proteinsText(proteinCount)}</span>
          )}
          <ChevronDown
            className="wb-dataset-chevron"
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
        {/* The full label over the name, which truncates at 200 px; anchored to the button. */}
        {datasetName !== null && <ps-tooltip text={datasetName}></ps-tooltip>}
      </div>
      <div data-workbench="app-bar-center">
        <protspace-protein-search
          id="myProteinSearch"
          data-driver-id="search"
        ></protspace-protein-search>
        {/* Phones only (workbench.css): search shows over the bar until this closes it. */}
        <ps-icon-button
          className="wb-search-close"
          icon="x"
          label="Close search"
          onClick={() => closeSearch(true)}
        ></ps-icon-button>
      </div>
      <div data-workbench="app-bar-actions">
        <DataActions />
        <span className="wb-separator" aria-hidden="true" />
        <HelpMenu />
        <a className="wb-icon-link" href={FEEDBACK_HREF} aria-label="Feedback">
          <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
        </a>
        <ps-tooltip text="Feedback" namesTarget></ps-tooltip>
        <a
          className="wb-icon-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <Github size={16} strokeWidth={1.75} aria-hidden="true" />
        </a>
        <ps-tooltip text="GitHub" namesTarget></ps-tooltip>
      </div>
      <SearchToggle ref={toggleRef} open={searchOpen} onOpen={openSearch} />
    </header>
  );
}
```

(Everything inside the bar except `data-search-open`, the two handlers, the Close search button and the SearchToggle is the current markup, unchanged.)

- [ ] **Step 8: Phone and coarse CSS**

In `apps/web/src/workbench/workbench.css`, Task 5.3 kept a stage-3 wrap rule for the phone (the old narrow-fallback rule `… [data-workbench='view-bar'][data-stage='3'] { flex-wrap: wrap; height: auto; min-height: var(--wb-view-bar-height); }` and its companion `… [data-workbench='view-bar'][data-stage='3'] .wb-view-group { flex-wrap: wrap; }`, now keyed on `[data-layout='phone']` or `:not([data-layout='desktop'])`). Delete both rules: the phone bar never wraps. If 5.3 left no such rule, there is nothing to delete; the rule below states `flex-wrap: nowrap` at a specificity that wins either way.

Append at the end of `workbench.css`:

```css
/* ── Phone bars (≤ 640 px, Task 5.4, decision 17) ────────────────────────────
   The app bar keeps the wordmark, the dataset and a search button; search shows over the bar
   while it is open (data-search-open). The actions leave the bar: the More sheet reaches them.
   Their element stays rendered, only out of the grid and empty: a popover inside a display: none
   ancestor never shows, and the Import and Export menus open from the dataset name and More. The
   view bar is fixed at stage 3: Projection, its details, Color by and an icon-only More. */
.workbench[data-layout='phone'] {
  --wb-view-bar-height: 48px;
}

.workbench[data-layout='phone'] header[data-workbench='app-bar'] {
  position: relative;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--ps-space-2);
  padding: 0 var(--ps-space-1) 0 var(--ps-space-3);
}

.workbench[data-layout='phone'] [data-workbench='app-bar-actions'] {
  position: absolute;
  width: 0;
  height: 0;
}

.workbench[data-layout='phone'] [data-workbench='app-bar-actions'] > :not(.wb-data-actions),
.workbench[data-layout='phone'] #myImportMenu::part(trigger),
.workbench[data-layout='phone'] #myExportMenu::part(trigger),
.workbench[data-layout='phone'] .wb-app-bar-start > .wb-separator {
  display: none;
}

.workbench[data-layout='phone'] [data-workbench='home'] img {
  height: 18px;
}

/* The name ends in an ellipsis before anything leaves the bar, and keeps a word of itself. */
.workbench[data-layout='phone'] .wb-dataset-name {
  min-width: 48px;
  max-width: 45vw;
}

.workbench[data-layout='phone'] [data-workbench='app-bar-center'] {
  display: none;
}

.workbench[data-layout='phone'] header[data-search-open] [data-workbench='app-bar-center'] {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: var(--ps-space-1);
  padding: 0 var(--ps-space-1) 0 var(--ps-space-3);
  background: var(--ps-surface);
}

.workbench[data-layout='phone'] header[data-search-open] #myProteinSearch {
  flex: 1 1 auto;
  min-width: 0;
}

.wb-search-toggle,
.wb-search-close {
  display: none;
}

.workbench[data-layout='phone'] :is(.wb-search-toggle, .wb-search-close) {
  display: inline-flex;
}

.workbench[data-layout='phone'] [data-workbench='view-bar'][data-stage] {
  flex-wrap: nowrap;
  height: var(--wb-view-bar-height);
  min-height: 0;
  padding: 0 var(--ps-space-2);
}

.workbench[data-layout='phone'] [data-workbench='view-bar'] :is(#myContoursMenu, .wb-view-sep, #myFilterButton) {
  display: none;
}

/* Projection and Color by shrink, ending in an ellipsis, so the bar never overflows. */
.workbench[data-layout='phone'] [data-workbench='view-bar'] .wb-view-group,
.workbench[data-layout='phone'] :is(#myProjectionSelect, #myAnnotationSelect) {
  flex: 0 1 auto;
  min-width: 0;
}

.workbench[data-layout='phone'] [data-workbench='view-bar'] .wb-more {
  margin-left: auto;
}

/* Icon-only: the button keeps its name, "More view options". */
.workbench[data-layout='phone'] .wb-more-label {
  display: none;
}

/* Finger-sized app-bar targets wherever the pointer is coarse (design decision 17). */
@media (pointer: coarse) {
  [data-workbench='home'],
  .wb-dataset {
    min-height: var(--ps-touch-target);
  }

  .wb-dataset {
    align-items: center;
  }

  .wb-icon-link {
    width: var(--ps-touch-target);
    height: var(--ps-touch-target);
  }
}
```

(The pickers' values may end in an ellipsis at 360 px: with the demo's names the bar needs about 385 px, which 412 px fits whole and 360 px does not.)

- [ ] **Step 9: Run C1/C2 and write the new phone-bar tests**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts -g "whole labels"`

Expected: PASS at 412 and 360. Below 400 px C1 exempts the Projection and Color by values from the truncation check (Task 5.1's `truncatedLabels(root, pickersMayShrink)`: the skeleton's "pickers shrink with ellipsis") and instead requires each to keep at least 48 px of visible value; no other control may truncate. If a picker value falls below 48 px at 360, lower the dataset name's `max-width` before touching the pickers' rule.

Append to `apps/web/tests/mobile-bars.spec.ts` (add any of the imported names the file's existing imports lack: `appBar`, `getSelectedProteinIds`, `searchInput` from `./helpers/explore`; `box`, `expectNoHorizontalOverflow`, `expectWithinViewport`, `openExplorePhone`, `proteinNear`, `searchToggle` from `./helpers/mobile`):

```ts
test.describe('search on a phone', () => {
  test('the search button opens search over the app bar; a pasted ID selects its protein; Close search returns focus to the button', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(searchInput(page)).toBeHidden();

    await searchToggle(page).tap();
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput(page)).toBeFocused();
    await expectWithinViewport(page, searchInput(page));
    const overlay = await box(appBar(page).locator('[data-workbench="app-bar-center"]'));
    const bar = await box(appBar(page));
    expect(Math.abs(overlay.y - bar.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlay.width - bar.width)).toBeLessThanOrEqual(1);

    // A paste with a line break is a pasted list: the search selects every ID it finds.
    const { id } = await proteinNear(page, 0.5, 0.5);
    await searchInput(page).evaluate((input, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      input.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }, `${id}\n`);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await expect(searchInput(page)).toBeHidden();
    await expect(searchToggle(page)).toBeFocused();
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape closes the search overlay when nothing else handled it', async ({ page }) => {
    await openExplorePhone(page);
    const { id } = await proteinNear(page, 0.5, 0.5);
    // Select one protein through the search first: the Escape that closes search must not clear it.
    await searchToggle(page).tap();
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    // The suggestion list is a layer: an Escape while it shows closes it and leaves search open.
    const suggestions = page.locator('protspace-protein-search').getByRole('listbox');
    if (await suggestions.isVisible()) {
      await page.keyboard.press('Escape');
      await expect(suggestions).toBeHidden();
      await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    }
    await page.keyboard.press('Escape');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await expect(searchToggle(page)).toBeFocused();
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });

  test('at 320 px the dataset name keeps more than 40 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openExplorePhone(page);
    const name = appBar(page).locator('.wb-dataset-name');
    await expect(name).toBeVisible();
    expect((await box(name)).width).toBeGreaterThan(40);
    await expect(searchToggle(page)).toBeVisible();
    await expectWithinViewport(page, searchToggle(page));
    await expectNoHorizontalOverflow(page);
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts`

Expected: every non-fixme test passes, including C1/C2 and the three new ones; the remaining `task 5.5`/`5.6`/`5.9`/`5.10`/`5.12`/`7.4` fixmes are skipped. If the new tests fail, fix the code, not the expectations; a failure in "a pasted ID" with the selection empty means the paste path did not see the line break — check the text passed is `${id}\n`.

- [ ] **Step 10: The desktop view-bar spec starts its stage search at 641 px**

In `apps/web/tests/workbench-view-bar.spec.ts`:

Add `filterPanel` to the import from `./helpers/explore` (alphabetical, after `filterButton`).

In `widestAtStage`, replace `let reached = 320; // narrowing to this width reaches it` with:

```ts
  // Below 641 px the phone bar is fixed at stage 3 (decision 17): the search stays above it.
  let reached = 641; // narrowing to this width reaches it
```

After the `widestAtStage` function, add:

```ts
/**
 * Widens the bar's right padding to 178 px, so stages 2 and 3 fall between 641 and 950 px (the
 * demo's stage widths are about 711, 523, 516 and 433 px): below 641 px the phone layout fixes the
 * stage, so the stage walk needs a bar that runs out of room sooner.
 */
async function squeezeViewBar(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "[data-workbench='view-bar'] { padding-right: 178px !important; }",
  });
}
```

In each of the tests `'narrowing moves Contours, then Filter, into More, and widening brings them back'`, `'a window jittering ±4 px around a threshold keeps its stage'`, `'More shows a dot with contours on, and Auto there sets density=auto in the URL'` and `'More opens with Enter and Escape returns focus to it'`, add `await squeezeViewBar(page);` as the line right after `await openExplore(page);`. Do not add it to `'the view bar is 44 px, one row and does not overflow at 1440, 1280, 1024 and 951 px'`.

The arithmetic: stage k is reached once stage k−1's width (711, 523, 516 px) no longer fits, so with 178 px of padding stages 1–3 are reached at about 889, 701 and 694 px, all inside [641, 950]; 433 + 178 ≈ 611 px is where stage 3 itself would overflow, 30 px below the floor. The padding is test-only slack, documented here.

In `'narrowing moves Contours, then Filter, into More, and widening brings them back'`, replace the block from the comment `// Filter in More opens the same panel, with focus on its heading.` through `await expect(returnTarget).toBeFocused();` (or the block Task 5.3 left in its place, which opens Filter from More and returns from it) with:

```ts
    // Filter in More opens the same panel, with focus on its heading. On desktop Close hands focus
    // to the rail's Filter item; below 951 px the panel row's tabs switch back (Task 5.3).
    await openFilter(page);
    await expect(page.locator('#wb-filter-title')).toBeFocused();
    if (page.viewportSize()!.width >= 951) {
      await closeFilterPanel(page);
      await expect(
        page
          .getByRole('navigation', { name: 'Panels' })
          .getByRole('button', { name: 'Filter', exact: true }),
      ).toBeFocused();
    } else {
      await page.getByRole('tab', { name: 'Legend', exact: true }).filter({ visible: true }).click();
      await expect(filterPanel(page)).toBeHidden();
    }
```

Append inside `test.describe('view bar stages', …)`, after the last test:

```ts
  test('below 641 px the phone view bar shows Projection, Color by and More', async ({ page }) => {
    await openExplore(page);
    await page.setViewportSize({ width: 600, height: 720 });
    await settle(page);
    await expect(page.locator('.workbench')).toHaveAttribute('data-layout', 'phone');
    expect(await readStage(page)).toBe(3);
    await expect(projectionTrigger(page)).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Color by/ })).toBeVisible();
    await expect(moreButton(page)).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Contours/ })).toBeHidden();
    await expect(filterButton(page)).toBeHidden();
    const bar = (await viewBar(page).boundingBox())!;
    expect(bar.height).toBe(48);
    expect(await viewBar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    // Narrower still, the bar is not measured: the stage stays 3.
    await page.setViewportSize({ width: 360, height: 720 });
    await settle(page);
    expect(await readStage(page)).toBe(3);
    expect(await viewBar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
```

This spec is not run at task time (execution rule); it heads the exit's list.

- [ ] **Step 11: The compact import affordance is the dataset button**

In `apps/web/tests/dataset-reload.spec.ts`, add `datasetSwitcher`, `importMenu` and `waitForExploreInteractionReady` to the import from `./helpers/explore` (alphabetical), and replace the body of `test('compact layout still shows the import dropdown affordance', …)` with:

```ts
    await page.setViewportSize({ width: 568, height: 527 });
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await waitForExploreInteractionReady(page);

    // 568 px is the phone layout: the Import button gives way and the dataset name opens the same
    // panel (a closed disclosure until pressed), not an immediate action.
    await expect(importTrigger(page)).toBeHidden();
    await expect(datasetSwitcher(page)).toBeVisible();
    await expect(datasetSwitcher(page)).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(datasetSwitcher(page)).not.toHaveAttribute('aria-expanded', 'true');
    await datasetSwitcher(page).click();
    await expect(importMenu(page).getByRole('dialog', { name: 'Import', exact: true })).toBeVisible();
    await expect(datasetSwitcher(page)).toHaveAttribute('aria-expanded', 'true');
```

`importTrigger` stays imported (still used here). Not run at task time; listed for the exit.

- [ ] **Step 12: Docs**

In `docs/developers/api/index.md`, section `### Protein Search`, replace the methods table

```md
| Method                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `reportNotInView(proteinId)` | Say that a protein it added is selected but hidden in this view (filter, isolation) |
```

with

```md
| Method                       | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `reportNotInView(proteinId)` | Say that a protein it added is selected but hidden in this view (filter, isolation) |
| `focusInput()`               | Focus the text field without scrolling, as ⌘K does                                  |
```

In `### Import Menu`, after the paragraph that ends "`toggleFrom(anchor)` closes the panel when it is open from that anchor and opens it there otherwise.", add:

```md
CSS part: `trigger`, the Import button. A host that opens the panel only from its own control hides
it with `::part(trigger) { display: none }` and keeps the element rendered (a `display: none`
element takes its panel with it), as the app's phone layout does.
```

In `### Export Menu`, replace `Methods: \`reset()\` checks **Include legend settings** again, as for a new dataset.` with:

```md
Methods: `reset()` checks **Include legend settings** again, as for a new dataset. CSS part:
`trigger`, the Export button.
```

Run `pnpm exec prettier --check docs/developers/api/index.md` and fix the table alignment it reports with `pnpm exec prettier --write docs/developers/api/index.md`.

- [ ] **Step 13: The suites this task touches, then commit**

Run (each must pass; report counts before and after):

- `pnpm --filter @protspace/core exec vitest --run --project unit src/components/protein-search/protein-search.component.test.ts`
- (sandbox disabled) `pnpm --filter @protspace/core exec vitest --run --project browser src/components/import-menu/import-menu.browser.test.ts src/components/export-menu/export-menu.browser.test.ts`
- `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts` (LEGACY 7)
- `pnpm --filter @protspace/app exec vitest --run src/workbench/view-bar-overflow.test.ts`
- The one e2e run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts`

Then `pnpm exec prettier --check` on every file below, and commit (sandbox disabled; the hook runs `pnpm precommit`; core was built in Step 5, rebuild it if core changed since):

```bash
git add apps/web/src/workbench/SearchToggle.tsx apps/web/src/workbench/AppBar.tsx \
  apps/web/src/workbench/ViewBar.tsx apps/web/src/workbench/MoreMenu.tsx \
  apps/web/src/workbench/use-view-bar-stage.ts apps/web/src/workbench/workbench.css \
  packages/core/src/components/protein-search/protein-search.ts \
  packages/core/src/components/protein-search/protein-search.component.test.ts \
  packages/core/src/components/import-menu/import-menu.ts \
  packages/core/src/components/import-menu/import-menu.browser.test.ts \
  packages/core/src/components/export-menu/export-menu.ts \
  packages/core/src/components/export-menu/export-menu.browser.test.ts \
  packages/core/src/components/annotation-select/annotation-select.styles.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts \
  packages/core/src/components/projection-select/projection-select.styles.ts \
  apps/web/tests/mobile-bars.spec.ts apps/web/tests/workbench-view-bar.spec.ts \
  apps/web/tests/dataset-reload.spec.ts docs/developers/api/index.md
git commit -m "feat(web): phone app bar with a search button and a slim view bar"
```

Report: the counts above, LEGACY 7, the two picker values' widths at 360, and whether Task 5.3 had left a stage-3 wrap rule to delete. Add to the ledger as a known phone limitation (for 8.1): with phone search closed, ⌘K/Ctrl+K focuses nothing, because the field is `display: none`; phase 5 does not target hardware keyboards on phones.

### Task 5.5: The More sheet

In sheet modes, More opens a bottom sheet (`ps-dialog size="sheet"`) holding Contours, Filter, Import data, Export, Help & shortcuts and Feedback; a dot on More counts contours and an applied filter. Rows that act elsewhere close the sheet first. The Export menu learns to open from another anchor, since its own trigger is hidden on phones.

**Files:**

- Modify: `packages/core/src/components/kit/dialog.ts` (`DialogSize` gains `'sheet'`), `dialog.styles.ts`, `dialog.browser.test.ts`
- Modify: `packages/core/src/components/export-menu/export-menu.ts`, `export-menu.browser.test.ts`
- Create: `apps/web/src/workbench/MoreSheet.tsx`, `apps/web/src/workbench/help-actions.ts`
- Modify: `apps/web/src/workbench/MoreMenu.tsx` (mode prop; sheet modes open MoreSheet), `ViewBar.tsx` (passes the mode), `HelpMenu.tsx` (uses help-actions), `AppBar.tsx` (FEEDBACK_HREF import), `apps/web/src/lib/support.ts` (`FEEDBACK_HREF`), `workbench.css` (sheet rows). `apps/web/src/custom-elements.d.ts` needs no edit: `ps-dialog`'s `size` is typed from `PsDialog`, so `'sheet'` arrives with the core build.
- Modify: `apps/web/tests/helpers/mobile.ts` (`moreSheet` confirmed; new `applyFilterKeepingTen`), `apps/web/tests/mobile-bars.spec.ts` (C3, C4 fixmes removed; new tests)
- Modify: `docs/developers/api/index.md` (export menu `openFrom`), `docs/developers/messaging.md` (`ps-dialog size="sheet"`; the developer docs have no kit page, and this is where dialogs and closing are described)

**Interfaces:**

- Consumes: `hasStructureSheet` (`apps/web/src/explore/layout-mode.ts`), `LayoutMode` (`layout-defaults.ts`) (5.2); `useLayoutMode` and `ViewBar`'s `mode` (5.4); `useWorkbenchStatus` (`densityLayer`, `appliedFilterConditions`); `#myContoursMenu.pick(mode)`; `#myImportMenu.openFrom(anchor)`; `openPanel`, `focusFilterTitle` (`layout-state.ts`); `DENSITY_LAYER_MODES`, `DENSITY_MODE_LABELS`, `countNoun` (`@protspace/utils`); `ShortcutsDialog`; `DOCS_URL` (`@/config`); `buildMailto`; the export menu's `part="trigger"` and the phone bar that hides it (5.4); helpers `openExplorePhone`, `moreButton`, `moreSheet`, `moreSheetContent`, `searchToggle`, `box`, `expectWithinViewport`, `proteinNear` (`helpers/mobile.ts`), `appBar`, `viewBar`, `searchInput`, `getSelectedProteinIds`, `datasetSwitcher`, `importMenu`, `filterPanel` (`helpers/explore.ts`); in `mobile-bars.spec.ts` (Task 5.1) the file-level `openMoreSheet(page): Promise<Locator>`, which taps More, waits for the sheet and returns `moreSheetContent(page)`, the scope the sheet's slotted rows are found in.
- Produces:
  - `ps-dialog size="sheet"`: the dialog sits on the bottom edge (`margin: auto 0 0`), full width (`width: 100%`, `max-width: none`: the dialog's containing block is the viewport, so this is the window's width without a scrollbar), `max-height: min(85dvh, calc(100dvh - 48px))`, top corners `var(--ps-radius-lg)`, bottom corners 0, no side or bottom border, `padding-bottom: env(safe-area-inset-bottom, 0px)`; the body has no padding (its rows run edge to edge) and scrolls while the header stays; Escape, backdrop press and focus return as other sizes. `DialogSize = 'sm' | 'md' | 'lg' | 'full' | 'sheet'`.
  - `ProtspaceExportMenu.openFrom(anchor: HTMLElement): void` — opens its menu anchored to `anchor` (focus on the first item, as every `ps-menu` opening does); on close the menu's anchor reverts to its own trigger (and `anchor`'s `aria-haspopup`/`aria-expanded` go back to what they were); calling it while open from the same anchor does nothing. Its own trigger pressed while the menu is open from elsewhere closes it and takes the menu back.
  - `help-actions.ts`: `openDocumentation(): void` (`window.open(DOCS_URL, '_blank', 'noopener,noreferrer')`), `startTour(): void` (dynamic import of `../tour/product-tour`, `startProductTour({ force: true })`). HelpMenu uses both.
  - `lib/support.ts`: `export const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' })`; AppBar's local constant goes.
  - `MoreSheet({ open, onClose, moreButton })` with `moreButton: RefObject<HTMLElement | null>` (the skeleton leaves the type open; a ref, because the button exists only after the first commit), portalled to `document.body` by MoreMenu, rendered only in sheet modes: `<ps-dialog heading="More" size="sheet">` with, in order: **Contours** (a row holding `ps-segmented label="Contours"` with options from `DENSITY_LAYER_MODES` / `DENSITY_MODE_LABELS[mode].label`; `change` → `#myContoursMenu.pick(mode)`; the sheet stays open), **Filter** (a button; value "None" or `countNoun(n, 'condition', 'conditions')`; closes the sheet, then `flushSync(() => openPanel('filter'))` and `focusFilterTitle()`, as the view bar's Filter does — `openPanel` also unfolds the phone panel from Task 5.6 on), **Import data** (closes, then `#myImportMenu.openFrom(dataset button)`), **Export** (closes, then `#myExportMenu.openFrom(moreButton)`), **Help & shortcuts** (a disclosure button, `aria-expanded`, revealing "Documentation", "Keyboard shortcuts" — closes the sheet, then opens MoreSheet's own `ShortcutsDialog` — and "Take the tour"), **Feedback** (`<a href={FEEDBACK_HREF}>`). Each row is a full-width 48 px button (or link) with a 16 px Lucide icon (`Layers`, `Filter`, `Upload`, `Download`, `CircleHelp`, `MessageSquare`), its label, and a value or chevron. No Theme row: a comment marks where 6.1 adds it (between Export and Help & shortcuts, as mockup frame 4 orders them).
  - MoreMenu: `MoreMenu({ stage, mode })`; in sheet modes the button opens MoreSheet and carries `aria-haspopup="dialog"` and `aria-expanded` as **attributes** (not the `hasPopup`/`expanded` properties: a `ps-menu` that anchors to the button — the Export menu from Task 5.5's row — records the attributes it finds and restores them when it lets go, so attributes survive that round trip and properties would not), the `ps-menu` is not rendered, and `active` counts `densityLayer !== 'off'` and `appliedFilterConditions > 0` regardless of stage. On desktop and tablet it is unchanged.
  - `helpers/mobile.ts`: `applyFilterKeepingTen(page)` — applies a one-condition filter keeping the first ten proteins as the Filter panel's Apply reports it (the builder's `query-changed` then `query-apply`), and waits for the status corner's filter chip. Used by this task's spec and by Task 5.6.

**Tests:**

- `dialog.browser.test.ts`: "size sheet sits on the bottom edge at full width"; "a sheet taller than a short viewport (375×360) scrolls its body while the header stays"; "Escape and a backdrop press close a sheet and return focus" (passes before the change too: a sheet closes like any dialog; it pins that).
- `export-menu.browser.test.ts`: "openFrom positions the menu under the given anchor and focuses its first item" (with its own trigger hidden through the `trigger` part); "closing returns focus to that anchor and the trigger is the anchor again"; "openFrom while open from the same anchor keeps it open".
- `mobile-bars.spec.ts`: C3, C4 green; new "Import data opens the Import panel under the dataset name"; "Filter in the sheet shows the Filter tab's panel and focuses its heading"; "Help & shortcuts reveals three rows; Keyboard shortcuts opens the shortcuts dialog"; "the More dot shows with a filter applied"; "Escape closes the sheet, then a second Escape clears the selection".
- Unrun at task time (exit): `workbench-help.spec.ts` (HelpMenu now calls help-actions), `workbench-view-bar.spec.ts` (More menu on desktop and tablet), `workbench-import-export.spec.ts` (Export menu close path), `kit-gallery.spec.ts` (dialog sizes), `workbench-feedback.spec.ts` (Feedback link).

LEGACY count: 7.

- [ ] **Step 1: Remove the C3 and C4 fixmes and run them red**

In `apps/web/tests/mobile-bars.spec.ts` delete every line that reads exactly `test.fixme(true, 'task 5.5');` (C3 and C4).

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts -g "More"`

Expected: C3 and C4 FAIL — More opens the `ps-menu` "More view options", not a dialog named "More"; C4 finds no Export row. (Other tests whose title has "More" may run too; they must stay green.)

- [ ] **Step 2: Write the failing core tests**

In `packages/core/src/components/kit/dialog.browser.test.ts`, change the second import to `import { page, userEvent } from 'vitest/browser';`, and append at the end of the file:

```ts
describe('ps-dialog size sheet', () => {
  async function openSheet(rows: number) {
    const buttons = Array.from(
      { length: rows },
      (_, index) =>
        `<button class="row" style="display: block; width: 100%; height: 48px">Row ${index + 1}</button>`,
    ).join('');
    document.body.innerHTML = `
      <button id="opener">More</button>
      <ps-dialog heading="More" size="sheet">${buttons}</ps-dialog>`;
    const opener = document.getElementById('opener')!;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    opener.focus();
    dialog.open = true;
    await settle(dialog);
    return { opener, dialog };
  }

  it('size sheet sits on the bottom edge at full width', async () => {
    await page.viewport(375, 667);
    const { dialog } = await openSheet(3);
    const native = nativeDialog(dialog);
    const box = native.getBoundingClientRect();

    expect(native.matches(':modal')).toBe(true);
    expect(box.left).toBe(0);
    expect(Math.abs(box.width - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.bottom - window.innerHeight)).toBeLessThanOrEqual(1);
    // Three rows: a short sheet, not a centred box.
    expect(box.top).toBeGreaterThan(window.innerHeight / 2);
    const style = getComputedStyle(native);
    expect(style.borderBottomLeftRadius).toBe('0px');
    expect(style.borderTopLeftRadius).not.toBe('0px');
  });

  it('a sheet taller than a short viewport (375×360) scrolls its body while the header stays', async () => {
    await page.viewport(375, 360);
    const { dialog } = await openSheet(12);
    const native = nativeDialog(dialog);
    const box = native.getBoundingClientRect();

    expect(box.height).toBeLessThanOrEqual(Math.min(0.85 * 360, 360 - 48) + 1);
    expect(Math.abs(box.bottom - 360)).toBeLessThanOrEqual(1);
    const body = dialog.shadowRoot!.querySelector('.body') as HTMLElement;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);

    body.scrollTop = body.scrollHeight;
    const header = dialog.shadowRoot!.querySelector('header')!.getBoundingClientRect();
    expect(header.top - box.top).toBeLessThanOrEqual(1);
    expect(native.scrollTop).toBe(0);
    const last = dialog.querySelector('.row:last-of-type')!.getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(box.bottom + 1);
    expect(last.top).toBeGreaterThanOrEqual(header.bottom - 1);
  });

  it('Escape and a backdrop press close a sheet and return focus', async () => {
    await page.viewport(375, 667);
    const { opener, dialog } = await openSheet(3);
    await userEvent.keyboard('{Escape}');
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    opener.focus();
    dialog.open = true;
    await settle(dialog);
    press(nativeDialog(dialog));
    await settle(dialog);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
```

In `packages/core/src/components/export-menu/export-menu.browser.test.ts`, append inside `describe('protspace-export-menu', …)`, after the test `'the trigger is exposed as the part trigger'` (Task 5.4):

```ts
  /** A More button at the left of the window, and the menu's own trigger hidden by its part. */
  function moreAnchor(): HTMLButtonElement {
    const style = document.createElement('style');
    style.textContent = 'protspace-export-menu::part(trigger) { display: none; }';
    document.body.append(style);
    const more = document.createElement('button');
    more.id = 'more';
    more.textContent = 'More';
    more.style.cssText = 'position: fixed; left: 300px; top: 200px; width: 80px; height: 40px';
    document.body.append(more);
    return more;
  }

  it('openFrom positions the menu under the given anchor and focuses its first item', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();

    expect(isOpen()).toBe(true);
    expect(psMenu().anchor).toBe(more);
    const anchor = more.getBoundingClientRect();
    const panel = popover().shadowRoot!.querySelector('.panel')!.getBoundingClientRect();
    expect(panel.width).toBeGreaterThan(0);
    expect(panel.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(panel.top - anchor.bottom).toBeLessThan(16);
    // bottom-end: the menu's right edge lines up with the anchor's.
    expect(Math.abs(panel.right - anchor.right)).toBeLessThan(2);
    expect(root().activeElement).toBe(item('figure'));
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('closing returns focus to that anchor and the trigger is the anchor again', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(more);
    expect(psMenu().anchor).toBe(trigger());
    // The attributes the menu set on More are gone again; the trigger is the menu button.
    expect(more.hasAttribute('aria-expanded')).toBe(false);
    expect(more.hasAttribute('aria-haspopup')).toBe(false);
    expect(triggerButton().getAttribute('aria-haspopup')).toBe('menu');
  });

  it('openFrom while open from the same anchor keeps it open', async () => {
    const more = moreAnchor();
    more.focus();
    menu.openFrom(more);
    await settle();
    menu.openFrom(more);
    await settle();
    expect(isOpen()).toBe(true);
    expect(root().activeElement).toBe(item('figure'));
  });
```

- [ ] **Step 3: Run the core tests to verify they fail**

Run (Bash sandbox disabled: browser mode listens on a local port): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/dialog.browser.test.ts src/components/export-menu/export-menu.browser.test.ts`

Expected: FAIL — "size sheet sits on the bottom edge" (the sheet renders as a centred `md` box: `left` is 16, not 0) and "a sheet taller…" (its height is `100dvh - 32px`, over 312); the three export tests with `menu.openFrom is not a function`. "Escape and a backdrop press close a sheet" passes already (a sheet closes like any dialog).

- [ ] **Step 4: Implement the sheet size and `openFrom`**

In `packages/core/src/components/kit/dialog.ts`, replace `export type DialogSize = 'sm' | 'md' | 'lg' | 'full';` with:

```ts
/** `sheet`: a bottom sheet, full width on the window's bottom edge (the app's More sheet on phones). */
export type DialogSize = 'sm' | 'md' | 'lg' | 'full' | 'sheet';
```

In `packages/core/src/components/kit/dialog.styles.ts`, after the rule `:host([size='full']) dialog { … }`, add:

```css
    /* A bottom sheet: full width on the bottom edge, its top corners rounded. The body scrolls
       under a header that stays; its rows run edge to edge. */
    :host([size='sheet']) dialog {
      width: 100%;
      max-width: none;
      max-height: min(85dvh, calc(100dvh - 48px));
      margin: auto 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      border-width: 1px 0 0;
      border-radius: var(--ps-radius-lg) var(--ps-radius-lg) 0 0;
    }
    :host([size='sheet']) .frame {
      max-height: calc(min(85dvh, 100dvh - 48px) - 1px - env(safe-area-inset-bottom, 0px));
    }
    :host([size='sheet']) .body {
      padding: 0;
    }
```

In `packages/core/src/components/export-menu/export-menu.ts`:

After `@query('ps-menu') private menu!: PsMenu;`, add:

```ts
  /** The control the menu opened from through openFrom; null while it belongs to its trigger. */
  private anchorEl: HTMLElement | null = null;
```

After `reset(): void { … }`, add:

```ts
  /**
   * Opens the menu under `anchor`, focus on its first item, as its own trigger does. When it
   * closes, focus returns to `anchor` and the menu belongs to its trigger again. The app's More
   * sheet opens it this way on phones, where the Export button is hidden.
   */
  openFrom(anchor: HTMLElement): void {
    if (this.open && this.anchorEl === anchor) return;
    this.anchorEl = anchor;
    this.menu.anchor = anchor;
    this.open = true;
  }

  /** Gives the menu back to its own trigger after an openFrom. */
  private restoreAnchor(): void {
    if (!this.anchorEl) return;
    this.anchorEl = null;
    this.menu.anchor = this.trigger;
  }
```

Replace

```ts
  private toggle = () => {
    this.open = !this.open;
  };

  /** The menu closed itself (Escape, a press outside, Tab, or a chosen item) and refocused. */
  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };
```

with

```ts
  private toggle = () => {
    this.restoreAnchor();
    this.open = !this.open;
  };

  /** The menu closed itself (Escape, a press outside, Tab, or a chosen item) and refocused. */
  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
    this.restoreAnchor();
  };
```

- [ ] **Step 5: Run the core tests to verify they pass, and the docs**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/dialog.browser.test.ts src/components/export-menu/export-menu.browser.test.ts`

Expected: PASS (+3 in each file; report before and after counts).

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts` — PASS, LEGACY 7.

In `docs/developers/api/index.md`, `### Export Menu`, replace the methods paragraph (as Task 5.4 left it):

```md
Methods: `reset()` checks **Include legend settings** again, as for a new dataset. CSS part:
`trigger`, the Export button.
```

with

```md
Methods: `reset()` checks **Include legend settings** again, as for a new dataset.
`openFrom(anchor: HTMLElement)` opens the menu under `anchor` with focus on its first item, as the
Export button does; when it closes, focus returns to `anchor` and the menu belongs to the Export
button again. CSS part: `trigger`, the Export button; hide it with `::part(trigger)` and open the
menu from your own control, as the app's phone layout does from More.
```

In `docs/developers/messaging.md`, at the end of the section `### Escape and closing` (after the paragraph ending "The first that acts takes the press, so one press takes one step."), add:

```md
A `ps-dialog` with `size="sheet"` is a bottom sheet: full width on the window's bottom edge, its
body scrolling under its header. It closes as every dialog does, on Escape, its close button and a
press on the backdrop, and returns focus to the control that opened it (the app's More sheet on
phones).
```

Run `pnpm exec prettier --check docs/developers/api/index.md docs/developers/messaging.md`.

- [ ] **Step 6: Commit the core pieces**

Build and commit (sandbox disabled; the hook runs `pnpm precommit`):

```bash
pnpm --filter @protspace/core build
pnpm exec prettier --check packages/core/src/components/kit/dialog.ts \
  packages/core/src/components/kit/dialog.styles.ts \
  packages/core/src/components/kit/dialog.browser.test.ts \
  packages/core/src/components/export-menu/export-menu.ts \
  packages/core/src/components/export-menu/export-menu.browser.test.ts
git add packages/core/src/components/kit/dialog.ts \
  packages/core/src/components/kit/dialog.styles.ts \
  packages/core/src/components/kit/dialog.browser.test.ts \
  packages/core/src/components/export-menu/export-menu.ts \
  packages/core/src/components/export-menu/export-menu.browser.test.ts \
  docs/developers/api/index.md docs/developers/messaging.md
git commit -m "feat(core): sheet size for ps-dialog and openFrom on the export menu"
```

- [ ] **Step 7: Feedback and help actions shared by the bar and the sheet**

Append at the end of `apps/web/src/lib/support.ts`:

```ts
/** The app bar's and the More sheet's Feedback link: a mail to the support inbox. */
export const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });
```

In `apps/web/src/workbench/AppBar.tsx`, replace `import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';` with `import { FEEDBACK_HREF, GITHUB_REPO_URL } from '@/lib/support';` and delete the line `const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });` (and the blank line after it).

Create `apps/web/src/workbench/help-actions.ts`:

```ts
import { DOCS_URL } from '@/config';

/**
 * What the app bar's Help menu and the More sheet's Help & shortcuts both do (design decisions 1
 * and 17). Call each inside the user's click or key press: the browser allows the new tab then.
 */

/** Opens the documentation in a new tab. */
export function openDocumentation(): void {
  window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
}

/** Starts the product tour from its first step; its code loads on first use. */
export function startTour(): void {
  void import('../tour/product-tour').then(({ startProductTour }) =>
    startProductTour({ force: true }),
  );
}
```

In `apps/web/src/workbench/HelpMenu.tsx`, replace `import { DOCS_URL } from '@/config';` with `import { openDocumentation, startTour } from './help-actions';`, and in the `onSelect` handler replace

```ts
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'docs') window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
```

with

```ts
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'docs') openDocumentation();
```

and

```ts
      if (value === 'tour') {
        void import('../tour/product-tour').then(({ startProductTour }) =>
          startProductTour({ force: true }),
        );
      }
```

with

```ts
      if (value === 'tour') startTour();
```

- [ ] **Step 8: The More sheet**

Create `apps/web/src/workbench/MoreSheet.tsx`:

```tsx
import type {
  ProtspaceContoursMenu,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  PsDialog,
} from '@protspace/core';
import {
  countNoun,
  DENSITY_LAYER_MODES,
  DENSITY_MODE_LABELS,
  type DensityLayerMode,
} from '@protspace/utils';
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  Filter,
  Layers,
  MessageSquare,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { FEEDBACK_HREF } from '@/lib/support';
import { focusFilterTitle, openPanel } from '../explore/layout-state';
import { openDocumentation, startTour } from './help-actions';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useWorkbenchStatus } from './use-workbench-status';

/** The contour modes as the segmented control offers them, named as the Contours menu names them. */
const CONTOUR_OPTIONS = DENSITY_LAYER_MODES.map((mode) => ({
  value: mode,
  label: DENSITY_MODE_LABELS[mode].label,
}));

/** A row's Lucide icon: 16 px at the kit's stroke, decorative. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

interface MoreSheetProps {
  open: boolean;
  onClose(): void;
  /** The view bar's More button: the Export menu opens under it. */
  moreButton: RefObject<HTMLElement | null>;
}

/**
 * The More sheet (design decision 17): on a phone, everything the two bars leave out, in a bottom
 * sheet (ps-dialog size="sheet": top layer, scrim, focus kept inside; Escape and a backdrop press
 * close it and focus returns to More). Contours applies in place and keeps the sheet open. Every
 * other row closes the sheet first and then acts, so what it opens (a menu, a dialog, the Filter
 * panel) is never a second layer under a closing one. The Export and Import menus open from More
 * and the dataset name, since their own buttons are hidden on a phone; Help & shortcuts unfolds
 * its three entries in place rather than open a menu from a hidden button.
 */
export function MoreSheet({ open, onClose, moreButton }: MoreSheetProps) {
  const dialog = useRef<PsDialog>(null);
  const contours = useRef<HTMLElement>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const helpRowsId = useId();

  // Escape, the close button and a backdrop press close the sheet itself; follow it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.addEventListener('ps-close', onClose);
    return () => element.removeEventListener('ps-close', onClose);
  }, [onClose]);

  // Each opening starts with Help & shortcuts folded.
  useEffect(() => {
    if (!open) setHelpOpen(false);
  }, [open]);

  // A contour mode goes through the view bar's Contours menu, which stays mounted while hidden:
  // shown at once, applied after the paint.
  useEffect(() => {
    const element = contours.current;
    if (!element) return;
    const onChange = (event: Event) => {
      const mode = (event as CustomEvent<{ value: DensityLayerMode }>).detail.value;
      (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(mode);
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);

  /** A row's press: close the sheet now (its layer goes, focus returns to More), then `act`. */
  const closeThen = (act: () => void) => () => {
    dialog.current?.dismiss();
    act();
  };

  const showFilter = closeThen(() => {
    // Commit the layout now, so the heading is on screen when focus moves to it.
    flushSync(() => openPanel('filter'));
    focusFilterTitle();
  });
  const openImport = closeThen(() => {
    const dataset = document.querySelector<HTMLElement>('[data-workbench="dataset"]');
    if (!dataset) return;
    (document.getElementById('myImportMenu') as ProtspaceImportMenu | null)?.openFrom(dataset);
  });
  const openExport = closeThen(() => {
    const anchor = moreButton.current;
    if (!anchor) return;
    (document.getElementById('myExportMenu') as ProtspaceExportMenu | null)?.openFrom(anchor);
  });

  return (
    <>
      <ps-dialog ref={dialog} heading="More" size="sheet" open={open}>
        <div className="wb-sheet-rows">
          <div className="wb-sheet-row wb-sheet-row-static">
            <Layers className="wb-sheet-icon" {...ICON} />
            {/* The radio group carries the name; the word is for the eye. */}
            <span className="wb-sheet-label" aria-hidden="true">
              Contours
            </span>
            <ps-segmented
              ref={contours}
              label="Contours"
              options={CONTOUR_OPTIONS}
              value={densityLayer}
            ></ps-segmented>
          </div>
          <button type="button" className="wb-sheet-row" onClick={showFilter}>
            <Filter className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Filter</span>
            <span className="wb-sheet-value">
              {appliedFilterConditions > 0
                ? countNoun(appliedFilterConditions, 'condition', 'conditions')
                : 'None'}
            </span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          <button type="button" className="wb-sheet-row" onClick={openImport}>
            <Upload className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Import data</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          <button type="button" className="wb-sheet-row" onClick={openExport}>
            <Download className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Export</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </button>
          {/* Task 6.1 adds the Theme row here (System, Light, Dark), as mockup frame 4 shows. */}
          <button
            type="button"
            className="wb-sheet-row"
            aria-expanded={helpOpen}
            aria-controls={helpRowsId}
            onClick={() => setHelpOpen((value) => !value)}
          >
            <CircleHelp className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Help &amp; shortcuts</span>
            {helpOpen ? (
              <ChevronDown className="wb-sheet-chevron" {...ICON} />
            ) : (
              <ChevronRight className="wb-sheet-chevron" {...ICON} />
            )}
          </button>
          <div id={helpRowsId} className="wb-sheet-sub" hidden={!helpOpen}>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(openDocumentation)}
            >
              <span className="wb-sheet-label">Documentation</span>
            </button>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(() => setShortcutsOpen(true))}
            >
              <span className="wb-sheet-label">Keyboard shortcuts</span>
            </button>
            <button
              type="button"
              className="wb-sheet-row wb-sheet-subrow"
              onClick={closeThen(startTour)}
            >
              <span className="wb-sheet-label">Take the tour</span>
            </button>
          </div>
          <a className="wb-sheet-row" href={FEEDBACK_HREF}>
            <MessageSquare className="wb-sheet-icon" {...ICON} />
            <span className="wb-sheet-label">Feedback</span>
            <ChevronRight className="wb-sheet-chevron" {...ICON} />
          </a>
        </div>
      </ps-dialog>
      {/* Opened after the sheet closed, so it returns focus to More. */}
      <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
}
```

- [ ] **Step 9: More opens the sheet on phones**

Replace the whole of `apps/web/src/workbench/MoreMenu.tsx` (as Task 5.4 left it: the only 5.4 change was `className="wb-more-label"` on the visible label) with:

```tsx
import type { ProtspaceContoursMenu, PsMenu } from '@protspace/core';
import { DENSITY_LAYER_MODES, DENSITY_MODE_LABELS, type DensityLayerMode } from '@protspace/utils';
import { Ellipsis } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import { MoreSheet } from './MoreSheet';
import { useWorkbenchStatus } from './use-workbench-status';
import type { ViewBarStage } from './view-bar-overflow';

/**
 * The contour modes as the Contours menu names them. From @protspace/utils, which the shell
 * already loads at first paint; a value import of @protspace/core would load the whole core
 * before it (design decision 5).
 */
const CONTOUR_MODES: ReadonlyArray<{ mode: DensityLayerMode; label: string }> =
  DENSITY_LAYER_MODES.map((mode) => ({ mode, label: DENSITY_MODE_LABELS[mode].label }));

const CONTOURS_PREFIX = 'contours:';
const FILTER_VALUE = 'filter';

/**
 * The view bar's More (design decisions 1 and 17). On desktop and tablet a menu: from stage 2 it
 * offers the contour modes, at stage 3 Filter too. A pick goes through the inline control, which
 * stays mounted while hidden: the contours menu's pick() (shown at once, applied after the paint;
 * re-picking the mode on screen applies nothing) or a click on the Filter button, which opens the
 * sidebar's Filter panel. On a phone it opens the More sheet instead, and the menu is not rendered.
 * A dot marks an active item inside.
 */
export function MoreMenu({ stage, mode }: { stage: ViewBarStage; mode: LayoutMode }) {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  const sheet = hasStructureSheet(mode);
  const [sheetWanted, setSheetWanted] = useState(false);
  const sheetOpen = sheet && sheetWanted;
  // The sheet holds Contours and Filter at every width.
  const contoursInside = sheet || stage >= 2;
  const filterInside = sheet || stage === 3;
  const active =
    (contoursInside && densityLayer !== 'off' ? 1 : 0) +
    (filterInside && appliedFilterConditions > 0 ? 1 : 0);

  useEffect(() => {
    if (sheet) return;
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      if (value === FILTER_VALUE) {
        // The menu has closed; the Filter button opens the panel and focuses its heading.
        document.getElementById('myFilterButton')?.click();
        return;
      }
      const picked = CONTOUR_MODES.find(
        (entry) => `${CONTOURS_PREFIX}${entry.mode}` === value,
      )?.mode;
      if (picked) {
        (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(picked);
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, [sheet]);

  // Widened back below stage 2, the bar hides More: close its menu rather than leave it open on
  // a hidden anchor.
  useEffect(() => {
    if (stage < 2 && menu.current?.open) menu.current.open = false;
  }, [stage]);

  // Wider than a phone, the sheet goes; the next phone layout starts with it closed.
  useEffect(() => {
    if (!sheet) setSheetWanted(false);
  }, [sheet]);

  const closeSheet = useCallback(() => setSheetWanted(false), []);
  const toggle = () => {
    if (sheet) {
      // The open sheet is modal: More cannot be pressed again until it closes.
      setSheetWanted(true);
      return;
    }
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-button
        ref={trigger}
        className="wb-more"
        variant="ghost"
        data-view-item=""
        // Attributes, not the hasPopup/expanded properties: the Export menu, opened from this
        // button by the sheet, marks it as its menu button and restores the attributes it found.
        // This relies on order: React commits the row's setSheetWanted(false) before ps-menu's
        // `updated` records the anchor in its microtask, so it records aria-expanded="false".
        // Moving the row's act into a setTimeout would break that (C4 pins the round trip).
        aria-haspopup={sheet ? 'dialog' : undefined}
        aria-expanded={sheet ? (sheetOpen ? 'true' : 'false') : undefined}
        onClick={toggle}
      >
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Ellipsis size={16} strokeWidth={1.75} />
        </span>
        {/* One name for the whole button, as FilterControl does: names pieced together around a
            screen-reader-only span gain a stray space. */}
        <span className="wb-more-label" aria-hidden="true">
          More
        </span>
        <span className="sr-only">
          {active > 0 ? `More view options, ${active} active` : 'More view options'}
        </span>
        <span className="wb-more-dot" aria-hidden="true" hidden={active === 0}></span>
      </ps-button>
      {!sheet && (
        <ps-menu ref={menu} id="wb-more-menu" label="More view options">
          {contoursInside && (
            <ps-menu-group label="Contours">
              {CONTOUR_MODES.map(({ mode: contourMode, label }) => (
                <ps-menu-item
                  key={contourMode}
                  type="radio"
                  value={`${CONTOURS_PREFIX}${contourMode}`}
                  checked={contourMode === densityLayer}
                >
                  {label}
                </ps-menu-item>
              ))}
            </ps-menu-group>
          )}
          {/* Its own group, so Filter does not read as a fourth contour mode. */}
          {filterInside && (
            <ps-menu-group label="Filter">
              <ps-menu-item value={FILTER_VALUE}>Filter</ps-menu-item>
            </ps-menu-group>
          )}
        </ps-menu>
      )}
      {/* In body, not in the view bar's group: a modal belongs to no landmark. */}
      {sheet &&
        createPortal(
          <MoreSheet open={sheetOpen} onClose={closeSheet} moreButton={trigger} />,
          document.body,
        )}
    </>
  );
}
```

(Entering a phone layout unmounts the `ps-menu`, and React commits a deletion before its siblings' updates: the menu's `disconnectedCallback` restores the button's attributes first, then React writes `aria-haspopup="dialog"`. Leaving it, React removes those attributes and the remounted menu marks the button again in the effect.)

In `apps/web/src/workbench/ViewBar.tsx`, replace `<MoreMenu stage={stage} />` with `<MoreMenu stage={stage} mode={mode} />`.

- [ ] **Step 10: The sheet's rows in CSS**

Append to the end of `apps/web/src/workbench/workbench.css` (outside every `.workbench` scope: the sheet is portalled to `body`):

```css
/* ── The More sheet (Task 5.5, decision 17; light DOM in a ps-dialog size="sheet") ──
   Rows of 48 px, edge to edge: a 16 px icon, the label, then a value or a chevron. Help &
   shortcuts unfolds its three entries below itself, indented to the labels. */
.wb-sheet-rows {
  display: flex;
  flex-direction: column;
}

.wb-sheet-row {
  display: flex;
  align-items: center;
  gap: var(--ps-space-3);
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  /* 16 px on the left, as in the mockup: the scale has no 16 px step. */
  padding: 0 var(--ps-space-3) 0 16px;
  border: 0;
  border-top: 1px solid var(--ps-border);
  background: transparent;
  color: var(--ps-text);
  font: inherit;
  font-weight: var(--ps-weight-medium);
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.wb-sheet-rows > .wb-sheet-row:first-child {
  border-top: 0;
}

.wb-sheet-row-static {
  cursor: default;
}

:is(button, a).wb-sheet-row:hover {
  background: var(--ps-surface-hover);
}

.wb-sheet-row:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: calc(-1 * var(--ps-focus-width));
}

.wb-sheet-icon,
.wb-sheet-chevron {
  flex: none;
  color: var(--ps-text-muted);
}

.wb-sheet-label {
  flex: 1 1 auto;
  min-width: 0;
}

.wb-sheet-value {
  flex: none;
  color: var(--ps-text-muted);
  font-weight: 400;
}

.wb-sheet-row ps-segmented {
  flex: none;
}

/* The entries under Help & shortcuts line up with the labels above: 16 + 16 icon + 12 gap. */
.wb-sheet-subrow {
  padding-left: 44px;
  font-weight: 400;
}
```

- [ ] **Step 11: The filter helper and the new phone-bar tests**

Append to `apps/web/tests/helpers/mobile.ts` (add `expect` to its `@playwright/test` import if it lacks it):

```ts
/**
 * Applies a one-condition filter keeping the first ten proteins, as the Filter panel's Apply
 * reports it (the filter controller hears the builder's query-changed and query-apply), without
 * driving the builder's pickers on a small screen. Resolves once the status corner shows the chip.
 */
export async function applyFilterKeepingTen(page: Page): Promise<void> {
  await page.locator('#myQueryBuilder').evaluate((builder) => {
    const plot = document.querySelector('#myPlot') as Element & { selectedAnnotation: string };
    const query = [
      {
        id: 'e2e-filter',
        kind: 'categorical',
        annotation: plot.selectedAnnotation,
        values: ['e2e'],
      },
    ];
    builder.dispatchEvent(new CustomEvent('query-changed', { detail: { query } }));
    builder.dispatchEvent(
      new CustomEvent('query-apply', {
        detail: { matchedIndices: new Set(Array.from({ length: 10 }, (_, i) => i)) },
      }),
    );
  });
  await expect(page.locator('#myPlotStatus .status-chip[data-kind="filter"]')).toBeVisible();
}
```

Run C3 and C4: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts -g "More"`. They must pass. C3 (Task 5.1) finds Contours as a radio group named "Contours", Feedback as a link and the other rows as buttons, by the Copy table's names; the sheet's markup must give exactly those roles and names.

Append to `apps/web/tests/mobile-bars.spec.ts` (add any of these names the file's imports lack: `appBar`, `datasetSwitcher`, `filterPanel`, `getSelectedProteinIds`, `importMenu`, `searchInput`, `viewBar` from `./helpers/explore`; `applyFilterKeepingTen`, `box`, `expectWithinViewport`, `moreButton`, `moreSheet`, `openExplorePhone`, `proteinNear`, `searchToggle` from `./helpers/mobile`):

```ts
test.describe('the More sheet', () => {
  test.beforeEach(async ({ page }) => {
    await openExplorePhone(page);
  });

  test('Import data opens the Import panel under the dataset name', async ({ page }) => {
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: 'Import data', exact: true }).tap();

    await expect(moreSheet(page)).toBeHidden();
    const panel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(panel).toBeVisible();
    await expectWithinViewport(page, panel);
    const dataset = await box(datasetSwitcher(page));
    expect((await box(panel)).y).toBeGreaterThanOrEqual(dataset.y + dataset.height - 1);
    await expect(datasetSwitcher(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test("Filter in the sheet shows the Filter tab's panel and focuses its heading", async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    await rows.getByRole('button', { name: /^Filter/ }).tap();

    await expect(moreSheet(page)).toBeHidden();
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
  });

  test('Help & shortcuts reveals three rows; Keyboard shortcuts opens the shortcuts dialog', async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    const help = rows.getByRole('button', { name: 'Help & shortcuts', exact: true });
    const shortcutsRow = rows.getByRole('button', {
      name: 'Keyboard shortcuts',
      exact: true,
    });
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(shortcutsRow).toBeHidden();

    await help.tap();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Documentation', 'Keyboard shortcuts', 'Take the tour']) {
      await expect(rows.getByRole('button', { name, exact: true })).toBeVisible();
    }

    await shortcutsRow.tap();
    await expect(moreSheet(page)).toBeHidden();
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcuts).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shortcuts).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
  });

  test('the More dot shows with a filter applied', async ({ page }) => {
    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeHidden();

    await applyFilterKeepingTen(page);
    await expect(moreButton(page)).toHaveAccessibleName('More view options, 1 active');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeVisible();

    const rows = await openMoreSheet(page);
    await expect(rows.getByRole('button', { name: /^Filter/ })).toContainText(
      '1 condition',
    );
  });

  test('Escape closes the sheet, then a second Escape clears the selection', async ({ page }) => {
    // Selected through search, so no pinned tooltip takes the second Escape.
    const { id } = await proteinNear(page, 0.5, 0.5);
    await searchToggle(page).tap();
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);
    await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');

    await openMoreSheet(page);
    await page.keyboard.press('Escape');
    await expect(moreSheet(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    await page.keyboard.press('Escape');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
  });
});
```

(The sheet's rows are slotted light-DOM children of the `ps-dialog` host: always find them through the `rows` scope the file's `openMoreSheet` returns (Task 5.1, `moreSheetContent`), never through `moreSheet`, which is the role dialog inside the shadow root and is kept for `toBeVisible`/`toBeHidden` and boxes. Do not declare a second `openMoreSheet`.)

- [ ] **Step 12: Run the spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-bars.spec.ts`

Expected: every non-fixme test passes (C1–C4, Task 5.4's three, these five); the `task 5.6`/`5.9`/`5.10`/`5.12`/`7.4` fixmes are skipped. On a failure fix the code, not the expectations. If "Escape closes the sheet, then a second Escape…" finds the selection still there after the second Escape, check what took it (`topLayer()` in the console): a layer left open by the search or the sheet is the bug.

- [ ] **Step 13: The suites this task touches, then commit**

Run (each must pass; report counts before and after):

- (sandbox disabled) `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/dialog.browser.test.ts src/components/export-menu/export-menu.browser.test.ts`
- `pnpm --filter @protspace/app exec vitest --run src/lib/support.test.ts src/workbench/shortcuts.test.ts`
- The one e2e run: Step 12's.

Then (sandbox disabled; core was built in Step 6):

```bash
pnpm exec prettier --check apps/web/src/workbench/MoreSheet.tsx apps/web/src/workbench/help-actions.ts \
  apps/web/src/workbench/MoreMenu.tsx apps/web/src/workbench/ViewBar.tsx \
  apps/web/src/workbench/HelpMenu.tsx apps/web/src/workbench/AppBar.tsx \
  apps/web/src/lib/support.ts apps/web/src/workbench/workbench.css \
  apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-bars.spec.ts
git add apps/web/src/workbench/MoreSheet.tsx apps/web/src/workbench/help-actions.ts \
  apps/web/src/workbench/MoreMenu.tsx apps/web/src/workbench/ViewBar.tsx \
  apps/web/src/workbench/HelpMenu.tsx apps/web/src/workbench/AppBar.tsx \
  apps/web/src/lib/support.ts apps/web/src/workbench/workbench.css \
  apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-bars.spec.ts
git commit -m "feat(web): More sheet on phones"
```

Report: the counts and LEGACY 7.

### Task 5.6: Phone bottom panel (fixed screen, tabs, fold, selection bar, toasts)

At ≤ 640 px the page becomes a fixed full-height screen: the plot fills the space between the bars and a bottom panel that holds the Legend and Filter tabs and folds to its header. The fold persists in `protspace:layout:v1`. The selection bar fits a 360 px plot, toasts sit above the panel, and the core breakpoint module arrives with its first shadow-DOM consumer.

**Files:**

- Modify: `apps/web/src/explore/layout-defaults.ts` (`panelFolded` in `LayoutState`, default false), `layout-state.ts` (parse, compare, `openPanel` unfolds), `layout-state.test.ts`
- Create: `apps/web/src/explore/layout-defaults.test.ts`
- Create: `packages/core/src/utils/breakpoints.ts`, `breakpoints.test.ts`
- Modify: `packages/core/src/components/kit/icon.ts` (`chevron-up`, `zoom-in`), `plot-tools/selection-bar.ts`, `selection-bar.styles.ts`, `selection-bar.browser.test.ts`
- Create: `apps/web/src/workbench/PanelFold.tsx`
- Modify: `apps/web/src/workbench/Sidebar.tsx` (PanelFold `slot="header-end"`; `panelFolded` prop), `FilterPanel.tsx` (PanelFold last in the header; `panelFolded` prop), `Workbench.tsx` (`data-panel-folded`; passes `panelFolded`), `workbench.css` (phone body block; toasts above the panel), `apps/web/src/explore/runtime.ts` (a folded panel stops the filter count). `WorkbenchToaster.tsx` is not touched: CSS on `[data-sonner-toaster]` places the toasts (Sonner 2.0.7 positions its toaster `fixed`, with `bottom: var(--offset-bottom)` above 600 px and `var(--mobile-offset-bottom)` at ≤ 600 px; the rule below overrides both).
- Modify: `apps/web/tests/mobile-explore-layout.spec.ts` (L1; new tests), `mobile-bars.spec.ts` (C6), `mobile-legend.spec.ts` (G6), `mobile-plot-touch.spec.ts` (P6) — fixmes removed; `eat-visualization.spec.ts:552` (320/360 hover without `scrollIntoViewIfNeeded` reliance) only if the exit run shows it failing
- Modify: `docs/developers/api/index.md` (selection bar on phones)

**Interfaces:**

- Consumes: `LayoutMode`, `useLayoutMode`, `getLayoutMode` (5.2); `PanelTabs`, the legend's `header-start`/`header-end` slots and `title` part, `Sidebar`'s `panel` prop and `FilterPanel`'s `panel` prop (5.3); `LAYOUT_QUERIES`, `PHONE_MAX_WIDTH`, `DESKTOP_MIN_WIDTH`, `LANDSCAPE_PHONE_MAX_HEIGHT` (app, 5.2); `countNoun`, `formatCount` (`@protspace/utils`); helpers `seedLayout`, `readLayout`, `watchPlotResizes` (`helpers/workbench.ts`), `openExplorePhone`, `panelFold`, `panelTab`, `bottomPanel`, `box`, `tap`, `proteinNear`, `expectNoPageScroll`, `applyFilterKeepingTen` (`helpers/mobile.ts`, 5.1 and 5.5), `filterPanel`, `statusChip`, `selectionBarAction`, `getSelectedProteinIds`, `waitForExploreDataLoad`, `dismissTourIfPresent` (`helpers/explore.ts`).
- Produces:
  - `LayoutState.panelFolded: boolean` (default `false`; a non-boolean stored value takes the default); `sameLayout` compares it; `openPanel(panel)` writes `{ sidebarOpen: true, panel, panelFolded: false }`.
  - `packages/core/src/utils/breakpoints.ts` (plain TS, no Lit): `PHONE_MAX_WIDTH = 640`, `DESKTOP_MIN_WIDTH = 951`, `LANDSCAPE_PHONE_MAX_HEIGHT = 500`, `PHONE_MEDIA = '(max-width: 640px)'`, `LANDSCAPE_PHONE_MEDIA = '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)'`, `COMPACT_MEDIA = '(max-width: 640px), (orientation: landscape) and (max-height: 500px) and (max-width: 950px)'`, both built from the numbers. Styles use them as `@media ${unsafeCSS(PHONE_MEDIA)}`.
  - `layout-defaults.test.ts`: imports core's `breakpoints.ts` by relative path; asserts the three numbers equal and that `LAYOUT_QUERIES.phone === PHONE_MEDIA`, `LAYOUT_QUERIES.landscape === LANDSCAPE_PHONE_MEDIA` and `COMPACT_MEDIA === PHONE_MEDIA + ', ' + LAYOUT_QUERIES.landscape`.
  - `PanelFold({ folded, slot })`: `ps-icon-button` `icon={folded ? 'chevron-up' : 'chevron-down'}`, `label={folded ? 'Unfold panel' : 'Fold panel'}`, `expanded={folded ? 'false' : 'true'}`, class `wb-panel-fold`, click → `updateLayout({ panelFolded: !folded })`; shown only on `phone` (CSS). The optional `slot` (not in the skeleton's signature, additive) carries `header-end` for the legend copy. Focus stays on it across the fold.
  - Root `data-panel-folded` when `mode === 'phone' && layout.panelFolded`.
  - Phone CSS (`.workbench[data-layout='phone']`): `--wb-panel-height: clamp(144px, 32svh, 288px)` (`45px` folded: the 44 px header and the panel's top border); root `height: 100dvh; overflow: hidden`; `.wb-body` grid `'plot' minmax(0, 1fr) 'side' auto 'struct' auto / minmax(0, 1fr)`; `#wb-sidebar` static in `side`, `height: var(--wb-panel-height)`, top border; folded: `overflow: hidden`, `#myLegend::part(items)` and `.wb-filter-body` `display: none`; the legend header shows the tabs, a small muted title (`::part(title)`), sort, settings and the fold; the Filter header the tabs, its title and the fold (pushed right). The structure section keeps a placeholder placement until Task 5.8: `display: none` while `data-structure="none"`, otherwise a static 240 px row under the panel (`--wb-structure-row`), which 5.8 replaces with the sheet. Toasts on a phone: bottom at `--wb-panel-height + --wb-structure-row + 12px`, plus the selection bar's 50 px while it shows.
  - Runtime: `isFilterPanelShown()` on phone is `panel === 'filter' && !panelFolded`.
  - Selection bar: each action gets a 16 px icon (`target`, `zoom-in`, `copy`, `x`), hidden above 640 px; at `PHONE_MEDIA` the labels are screen-reader-only (each button keeps its name), each button is at least 40 px wide, the visible count is "{formatCount(n)} selected" (the live region still says "1 protein selected"), and the bar is `width: max-content; max-width: calc(100% - 24px)`; above 640 px it is unchanged.

**Tests:**

- `layout-state.test.ts`: "panelFolded parses, defaults to false and survives a round trip"; "an old stored layout without panelFolded loads unfolded"; "openPanel unfolds"; "panelFolded and sidebarOpen are independent".
- `layout-defaults.test.ts`: the equality cases above.
- `packages/core/src/utils/breakpoints.test.ts` (core unit): the queries are built from the numbers (gives every export a reader inside core).
- `selection-bar.browser.test.ts`: "at 360 px wide the bar fits inside a 336 px host and every action keeps its accessible name" (the 360 px plot leaves 336 px between its 12 px margins); "above 640 px labels are visible".
- `mobile-*`: L1, C6, G6, P6 green. New in `mobile-explore-layout.spec.ts`: "the fold survives a reload"; "the Filter tab keeps the panel height (no plot resize)"; "at 360×640 the plot keeps at least 30% of the screen"; "a toast sits above the bottom panel" (trigger Copy IDs); "a status chip's filter opens the Filter tab unfolded".
- Unrun at task time (exit): `mobile-bars.spec.ts` C6, `mobile-legend.spec.ts` G6, `mobile-plot-touch.spec.ts` P6 (their fixmes go in this task; the execution rule allows one e2e spec, `mobile-explore-layout.spec.ts`, so the exit runs these three first), `eat-visualization.spec.ts:552,713`, `workbench-selection.spec.ts` (selection bar at desktop), `workbench-feedback.spec.ts`, `workbench-filter.spec.ts`, `workbench-sidebar.spec.ts` (layout store), `workbench-legend.spec.ts`.

LEGACY count: 7.

- [ ] **Step 1: Remove the phase-5.6 fixmes and run L1 red**

Delete every line that reads exactly `test.fixme(true, 'task 5.6');` in `apps/web/tests/mobile-explore-layout.spec.ts` (L1), `mobile-bars.spec.ts` (C6), `mobile-legend.spec.ts` (G6) and `mobile-plot-touch.spec.ts` (P6).

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts -g "one screen"`

Expected: FAIL — the phone still has the tablet grid from Task 5.3: the panel row is `2fr` with the legend in its left half, so the legend is not under the plot at full width; the structure's empty footer takes the right half. (G6 would fail with no "Fold panel" button, C6 with the Filter panel in a half-width cell, P6 with the selection bar wider than the 360 px plot; they run at the exit.)

- [ ] **Step 2: Write the failing app tests**

In `apps/web/src/explore/layout-state.test.ts`:

In `'round-trips every field'`, add `panelFolded: true,` after `panel: 'filter',` in the `layout` literal.

In `'falls back per field on wrong types, NaN, Infinity and an unknown placement'`, add `panelFolded: 'yes',` after `panel: 'structure',` in the first `parseLayout({ … })` argument.

Append inside `describe('layout store', …)`, after the test `'openPanel opens the sidebar on that panel, in one write'`:

```ts
  it('panelFolded parses, defaults to false and survives a round trip', () => {
    expect(getLayout().panelFolded).toBe(false);
    expect(parseLayout({ panelFolded: true }).panelFolded).toBe(true);
    expect(parseLayout({ panelFolded: 'yes' }).panelFolded).toBe(false);
    expect(parseLayout({ panelFolded: 1 }).panelFolded).toBe(false);

    updateLayout({ panelFolded: true });
    resetLayoutForTests();
    expect(getLayout().panelFolded).toBe(true);
  });

  it('an old stored layout without panelFolded loads unfolded', () => {
    store.set(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        sidebarOpen: false,
        sidebarWidth: 320,
        legendFraction: 0.4,
        structurePlacement: 'docked',
        floatingRect: null,
        panel: 'filter',
      }),
    );
    expect(getLayout()).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarOpen: false,
      sidebarWidth: 320,
      legendFraction: 0.4,
      panel: 'filter',
      panelFolded: false,
    });
  });

  it('openPanel unfolds', () => {
    updateLayout({ panelFolded: true, panel: 'legend' });
    storage.setItem.mockClear();
    const listener = vi.fn();
    subscribeLayout(listener);

    openPanel('filter');

    expect(getLayout()).toMatchObject({ sidebarOpen: true, panel: 'filter', panelFolded: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('panelFolded and sidebarOpen are independent', () => {
    updateLayout({ panelFolded: true });
    expect(getLayout()).toMatchObject({ panelFolded: true, sidebarOpen: true });
    updateLayout({ sidebarOpen: false });
    expect(getLayout()).toMatchObject({ panelFolded: true, sidebarOpen: false });
    updateLayout({ panelFolded: false });
    expect(getLayout()).toMatchObject({ panelFolded: false, sidebarOpen: false });
  });
```

Create `apps/web/src/explore/layout-defaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPACT_MEDIA,
  DESKTOP_MIN_WIDTH as CORE_DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT as CORE_LANDSCAPE_PHONE_MAX_HEIGHT,
  LANDSCAPE_PHONE_MEDIA,
  PHONE_MAX_WIDTH as CORE_PHONE_MAX_WIDTH,
  PHONE_MEDIA,
} from '../../../../packages/core/src/utils/breakpoints';
import {
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LAYOUT_QUERIES,
  PHONE_MAX_WIDTH,
} from './layout-defaults';

/**
 * The shell's layout modes (layout-defaults.ts) and the breakpoints shadow-DOM styles read
 * (core's utils/breakpoints.ts) are two copies of one decision (design decision 17): the app's
 * module stays a leaf with its own literals, and this keeps the two equal.
 */
describe('layout breakpoints', () => {
  it('the app and core agree on the three numbers', () => {
    expect(CORE_PHONE_MAX_WIDTH).toBe(PHONE_MAX_WIDTH);
    expect(CORE_DESKTOP_MIN_WIDTH).toBe(DESKTOP_MIN_WIDTH);
    expect(CORE_LANDSCAPE_PHONE_MAX_HEIGHT).toBe(LANDSCAPE_PHONE_MAX_HEIGHT);
  });

  it("core's phone and landscape queries are the app's modes", () => {
    expect(PHONE_MEDIA).toBe(LAYOUT_QUERIES.phone);
    expect(LANDSCAPE_PHONE_MEDIA).toBe(LAYOUT_QUERIES.landscape);
  });

  it('the compact query is the phone mode or the landscape mode', () => {
    expect(COMPACT_MEDIA).toBe(`${PHONE_MEDIA}, ${LAYOUT_QUERIES.landscape}`);
  });
});
```

- [ ] **Step 3: Run the app tests to verify they fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-state.test.ts src/explore/layout-defaults.test.ts`

Expected: FAIL — `layout-defaults.test.ts` cannot resolve `../../../../packages/core/src/utils/breakpoints`; in `layout-state.test.ts` the four new tests fail (`panelFolded` is `undefined`: `parseLayout` drops it) and `'round-trips every field'` fails (the stored layout comes back without `panelFolded`).

- [ ] **Step 4: Implement the layout field and the breakpoints module**

In `apps/web/src/explore/layout-defaults.ts`, in `interface LayoutState`, after

```ts
  /** The sidebar's panel; the filter itself is never stored. */
  panel: SidebarPanel;
```

add

```ts
  /**
   * The phone's bottom panel shows only its header (design decision 17). Phones only, and
   * independent of sidebarOpen: collapsing the desktop sidebar never folds the phone panel.
   */
  panelFolded: boolean;
```

and in `DEFAULT_LAYOUT`, after `panel: 'legend',` add `panelFolded: false,`.

In `apps/web/src/explore/layout-state.ts`:

In `parseLayout`, after `panel: isPanel(value.panel) ? value.panel : DEFAULT_LAYOUT.panel,` add:

```ts
    panelFolded:
      typeof value.panelFolded === 'boolean' ? value.panelFolded : DEFAULT_LAYOUT.panelFolded,
```

In `sameLayout`, replace `    a.panel === b.panel\n  );` with:

```ts
    a.panel === b.panel &&
    a.panelFolded === b.panelFolded
  );
```

Replace

```ts
/** Opens the sidebar on `panel`: the rail's items, the view bar's Filter and the status chips. */
export function openPanel(panel: SidebarPanel): void {
  updateLayout({ sidebarOpen: true, panel });
}
```

with

```ts
/**
 * Opens the sidebar on `panel`: the rail's items, the view bar's Filter, the More sheet's Filter
 * and the status chips. On a phone it also unfolds the bottom panel, so what opened is on screen.
 */
export function openPanel(panel: SidebarPanel): void {
  updateLayout({ sidebarOpen: true, panel, panelFolded: false });
}
```

Create `packages/core/src/utils/breakpoints.ts`:

```ts
/**
 * The app's layout breakpoints (design decision 17), for shadow-DOM styles, which cannot see the
 * workbench's data-layout attribute. apps/web/src/explore/layout-defaults.ts keeps its own copy as
 * a leaf module; its layout-defaults.test.ts keeps the two equal. Use a query in a `css` block as
 * `@media ${unsafeCSS(PHONE_MEDIA)} { … }`. Not under styles/: every export there must be a
 * stylesheet.
 */

/** The widest window that gets the phone layout. */
export const PHONE_MAX_WIDTH = 640;
/** The narrowest window that gets the desktop workbench. */
export const DESKTOP_MIN_WIDTH = 951;
/** The tallest landscape window that gets the landscape phone layout. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/** A phone held upright: the app's `phone` layout. */
export const PHONE_MEDIA = `(max-width: ${PHONE_MAX_WIDTH}px)`;

/** A phone on its side: the app's `landscape` layout. */
export const LANDSCAPE_PHONE_MEDIA = `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`;

/** A phone either way up: the app's `phone` or `landscape` layout. */
export const COMPACT_MEDIA = `${PHONE_MEDIA}, ${LANDSCAPE_PHONE_MEDIA}`;
```

Create `packages/core/src/utils/breakpoints.test.ts`, so every export has a reader inside core from this commit on (`COMPACT_MEDIA` gets its first style consumer in Task 5.10 and `LANDSCAPE_PHONE_MEDIA` in Task 5.12; knip's counting of the app test's cross-workspace relative import is unproven):

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPACT_MEDIA,
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LANDSCAPE_PHONE_MEDIA,
  PHONE_MAX_WIDTH,
  PHONE_MEDIA,
} from './breakpoints';

describe('breakpoints', () => {
  it('builds the queries from the numbers', () => {
    expect(PHONE_MEDIA).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    expect(LANDSCAPE_PHONE_MEDIA).toBe(
      `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`,
    );
    expect(COMPACT_MEDIA).toBe(`${PHONE_MEDIA}, ${LANDSCAPE_PHONE_MEDIA}`);
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/utils/breakpoints.test.ts` — PASS (1 test).

- [ ] **Step 5: Run the app tests to verify they pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-state.test.ts src/explore/layout-defaults.test.ts`

Expected: PASS (`layout-state.test.ts` +4, `layout-defaults.test.ts` 3 new; report before and after counts).

- [ ] **Step 6: Write the failing selection-bar tests**

In `packages/core/src/components/plot-tools/selection-bar.browser.test.ts`:

Replace the first line `import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';` with `import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';`, and after `afterEach(() => document.body.replaceChildren());` add:

```ts
// Vitest's default page is 414 px wide, a phone; the tests below the phone block are desktop's.
beforeEach(async () => {
  await page.viewport(1024, 768);
});
```

Append at the end of the file:

```ts
describe('protspace-selection-bar on a phone', () => {
  const NAMES = ['Show only these', 'Zoom to them', 'Copy IDs', 'Clear'];

  it('at 360 px wide the bar fits inside a 336 px host and every action keeps its accessible name', async () => {
    await page.viewport(360, 740);
    // The plot area: 360 px wide, so 336 px between the bar's 12 px margins.
    const parent = document.createElement('div');
    parent.style.cssText = 'position: relative; width: 360px; height: 400px';
    document.body.append(parent);
    const el = await mount(12345, parent);
    await Promise.all(buttons(el).map((b) => b.updateComplete));

    const box = parent.getBoundingClientRect();
    const bar = el.shadowRoot!.querySelector('.bar')!.getBoundingClientRect();
    expect(bar.left).toBeGreaterThanOrEqual(box.left + 12 - 1);
    expect(bar.right).toBeLessThanOrEqual(box.right - 12 + 1);
    expect(Math.abs(bar.left + bar.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);

    const short = el.shadowRoot!.querySelector('.selection-count-short')!;
    expect(short.textContent!.trim()).toBe('12,345 selected');
    expect(getComputedStyle(el.shadowRoot!.querySelector('.selection-count')!).display).toBe(
      'none',
    );
    // The live region still says it in full.
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe(
      '12,345 proteins selected',
    );

    for (const name of NAMES) {
      await expect.element(page.getByRole('button', { name, exact: true })).toBeInTheDocument();
      const b = button(el, name);
      expect(b.querySelector('.action-icon svg')).not.toBeNull();
      expect(b.querySelector('.action-label')!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      expect(inner(b).getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
    }
  });

  it('above 640 px labels are visible', async () => {
    await page.viewport(1024, 768);
    const el = await mount(3);
    await Promise.all(buttons(el).map((b) => b.updateComplete));
    expect(countText(el)).toBe('3 proteins selected');
    expect(getComputedStyle(el.shadowRoot!.querySelector('.selection-count-short')!).display).toBe(
      'none',
    );
    for (const name of NAMES) {
      const b = button(el, name);
      expect(b.querySelector('.action-label')!.getBoundingClientRect().width).toBeGreaterThan(1);
      expect(getComputedStyle(b.querySelector('.action-icon')!).display).toBe('none');
    }
  });
});
```

Run (Bash sandbox disabled: browser mode listens on a local port): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/selection-bar.browser.test.ts`

Expected: FAIL — both new tests (`.selection-count-short` and `.action-label` do not exist: `null` reads); every existing test still passes at 1024 px.

- [ ] **Step 7: Implement the icons and the phone selection bar**

In `packages/core/src/components/kit/icon.ts`, add `ChevronUp,` after `ChevronDown,` and `ZoomIn,` after `X,` in the `lucide` import, and in `ICONS` add `'chevron-up': ChevronUp,` after `'chevron-down': ChevronDown,` and `'zoom-in': ZoomIn,` after `x: X,`.

In `packages/core/src/components/plot-tools/selection-bar.ts`:

Replace `import { countNoun } from '@protspace/utils';` with `import { countNoun, formatCount } from '@protspace/utils';`, and after `import type { PsButton } from '../kit/button';` add `import { icon, type IconName } from '../kit/icon';`.

Replace the `ACTIONS` constant with:

```ts
const ACTIONS: ReadonlyArray<{
  action: SelectionAction;
  label: string;
  event: string;
  icon: IconName;
}> = [
  { action: 'isolate', label: 'Show only these', event: 'isolate-data', icon: 'target' },
  { action: 'zoom', label: 'Zoom to them', event: 'zoom-to-selection', icon: 'zoom-in' },
  { action: 'copy', label: 'Copy IDs', event: 'copy-selection', icon: 'copy' },
  { action: 'clear', label: 'Clear', event: 'clear-selections', icon: 'x' },
];
```

Add to the class doc comment, after "It reports presses; the host's selection controller acts and sets `selectedCount`.": " On a phone (≤ 640 px) it fits a 360 px plot: icons, the labels kept as the buttons' names, and a short count."

In `render()`, replace

```ts
        <span class="selection-count" aria-hidden="true"
          >${countNoun(this.selectedCount, 'protein', 'proteins')} selected</span
        >
        ${ACTIONS.map(
          ({ action, label }) =>
            html`<ps-button
              size="sm"
              variant="ghost"
              data-action=${action}
              tabindex=${action === stop ? '0' : '-1'}
              ?disabled=${!this._isEnabled(action)}
              @click=${() => this._press(action)}
              >${label}</ps-button
            >`,
        )}
```

with

```ts
        <span class="selection-count" aria-hidden="true"
          >${countNoun(this.selectedCount, 'protein', 'proteins')} selected</span
        >
        <span class="selection-count-short" aria-hidden="true"
          >${formatCount(this.selectedCount)} selected</span
        >
        ${ACTIONS.map(
          ({ action, label, icon: name }) =>
            html`<ps-button
              size="sm"
              variant="ghost"
              data-action=${action}
              tabindex=${action === stop ? '0' : '-1'}
              ?disabled=${!this._isEnabled(action)}
              @click=${() => this._press(action)}
              ><span slot="start" class="action-icon" aria-hidden="true">${icon(name, 16)}</span
              ><span class="action-label">${label}</span></ps-button
            >`,
        )}
```

(The button's text content is still exactly its label: the icon is an SVG with no text, so `textContent.trim()` in the existing tests and the accessible name are unchanged.)

Replace the whole of `packages/core/src/components/plot-tools/selection-bar.styles.ts` with:

```ts
import { css, unsafeCSS } from 'lit';
import { PHONE_MEDIA } from '../../utils/breakpoints';
import { kitHost, srOnly } from '../kit/kit-shared.styles';

/**
 * A raised bar at the bottom-centre of the plot, like the tool strip in its corner. On a phone
 * (design decision 17) it fits a 360 px plot: 40 px icon buttons whose labels stay their names, a
 * short count, and never wider than the plot less its margins.
 */
export const selectionBarStyles = [
  kitHost,
  srOnly,
  css`
    :host {
      position: absolute;
      bottom: var(--ps-space-3);
      left: 50%;
      translate: -50% 0;
      z-index: 5;
      display: block;
    }
    /* Hidden keeps the host rendered so its live region stays in the accessibility tree. */
    :host([hidden]) .bar {
      display: none;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
      padding: var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-md);
      white-space: nowrap;
    }
    .selection-count,
    .selection-count-short {
      padding: 0 var(--ps-space-2);
      font-size: var(--ps-text-sm);
      font-weight: var(--ps-weight-medium);
      font-variant-numeric: tabular-nums;
      color: var(--ps-text);
    }
    .selection-count-short,
    .action-icon {
      display: none;
    }
    @media ${unsafeCSS(PHONE_MEDIA)} {
      /* Sized to its content, not to the half of the plot right of its left: 50% edge. */
      :host {
        width: max-content;
        max-width: calc(100% - 24px);
      }
      .selection-count {
        display: none;
      }
      .selection-count-short {
        display: inline;
      }
      .action-icon {
        display: inline-flex;
      }
      .action-label {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      ps-button::part(button) {
        min-width: var(--ps-touch-target);
        padding: 0;
      }
    }
  `,
];
```

- [ ] **Step 8: Run the core tests to verify they pass**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/selection-bar.browser.test.ts`

Expected: PASS (+2; the existing tests unchanged, including "sits bottom-centre of its positioned parent, 38 px tall" at 1024 px).

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/icon.test.ts src/styles/style-lint.test.ts` — PASS, LEGACY 7.

- [ ] **Step 9: Docs and the core commit**

In `docs/developers/api/index.md`, `### Selection Bar`, after the paragraph ending "It hides itself at 0 and reports presses; the host acts and sets `selectedCount`.", add:

```md
At 640 px wide and below it fits a phone's plot: each action shows as a 40 px icon button
(Show only these, Zoom to them, Copy IDs, Clear keep their names), the count reads "12 selected"
(the live region still says "12 proteins selected"), and the bar stays 12 px inside its parent's
edges.
```

Run `pnpm exec prettier --check docs/developers/api/index.md`.

Commit the core pieces with the app test that pins the breakpoints (knip needs `breakpoints.ts`' exports read in the same commit; sandbox disabled):

```bash
pnpm --filter @protspace/core build
pnpm exec prettier --check packages/core/src/utils/breakpoints.ts \
  packages/core/src/utils/breakpoints.test.ts \
  packages/core/src/components/kit/icon.ts \
  packages/core/src/components/plot-tools/selection-bar.ts \
  packages/core/src/components/plot-tools/selection-bar.styles.ts \
  packages/core/src/components/plot-tools/selection-bar.browser.test.ts \
  apps/web/src/explore/layout-defaults.test.ts
git add packages/core/src/utils/breakpoints.ts packages/core/src/utils/breakpoints.test.ts \
  packages/core/src/components/kit/icon.ts \
  packages/core/src/components/plot-tools/selection-bar.ts \
  packages/core/src/components/plot-tools/selection-bar.styles.ts \
  packages/core/src/components/plot-tools/selection-bar.browser.test.ts \
  apps/web/src/explore/layout-defaults.test.ts docs/developers/api/index.md
git commit -m "feat(core): breakpoints module and a phone selection bar"
```

- [ ] **Step 10: The fold button, the panel props and the runtime's count**

Create `apps/web/src/workbench/PanelFold.tsx`:

```tsx
import { updateLayout } from '../explore/layout-state';

interface PanelFoldProps {
  /** The panel shows only its header. */
  folded: boolean;
  /** `header-end` for the legend's copy, which the legend places after its settings button. */
  slot?: string;
}

/**
 * The phone's bottom-panel fold (design decision 17): folds the Legend or Filter panel to its
 * 44 px header, which gives the plot the room, and unfolds it. One copy ends the legend's header,
 * one the Filter panel's; workbench.css shows them only in the phone layout. The fold is stored
 * (protspace:layout:v1) and is one plot resize, never animated. The button stays where it is, so
 * focus stays on it across the fold.
 */
export function PanelFold({ folded, slot }: PanelFoldProps) {
  return (
    <ps-icon-button
      className="wb-panel-fold"
      slot={slot}
      icon={folded ? 'chevron-up' : 'chevron-down'}
      label={folded ? 'Unfold panel' : 'Fold panel'}
      expanded={folded ? 'false' : 'true'}
      onClick={() => updateLayout({ panelFolded: !folded })}
    ></ps-icon-button>
  );
}
```

In `apps/web/src/workbench/Sidebar.tsx` (as Task 5.3 left it: `SidebarProps` has `ref`, `inert` and `panel`; the legend has PanelTabs as its `slot="header-start"` child; `<FilterPanel panel={panel} />`):

- add `import { PanelFold } from './PanelFold';` after the `FilterPanel` import;
- in `interface SidebarProps`, after the `panel` member add:

```ts
  /** The phone's bottom panel shows only its header. */
  panelFolded: boolean;
```

- add `panelFolded` to the destructured props of `Sidebar` (after `panel`);
- inside `<protspace-legend …>`, after the PanelTabs child, add `<PanelFold slot="header-end" folded={panelFolded} />`;
- change the Filter panel element to `<FilterPanel panel={panel} panelFolded={panelFolded} />`;
- in the component's doc comment, replace "it re-renders only when the sidebar becomes inert or interactive again" (or 5.3's wording of it) with "it re-renders only when the sidebar becomes inert or interactive again, the panel changes or the phone panel folds".

In `apps/web/src/workbench/FilterPanel.tsx` (as Task 5.3 left it: it takes `{ panel }` and renders PanelTabs first in `<header className="wb-panel-header">`):

- add `import { PanelFold } from './PanelFold';` with the other local imports;
- add `panelFolded: boolean` to its props type and destructuring (beside `panel`);
- add `<PanelFold folded={panelFolded} />` as the last child of `<header className="wb-panel-header">`, after the "Close filter" `ps-icon-button`.

In `apps/web/src/workbench/Workbench.tsx`:

- after `data-panel={layout.panel}` on the root `div`, add:

```tsx
      // The phone's bottom panel shows only its header (only phones fold it).
      data-panel-folded={mode === 'phone' && layout.panelFolded ? '' : undefined}
```

- on the `<Sidebar …>` element (5.3 passes `panel={layout.panel}`), add `panelFolded={layout.panelFolded}`.

In `apps/web/src/explore/runtime.ts`, replace the whole `const isFilterPanelShown = () => { … };` arrow (as Task 5.2 left it: it reads `getLayout()` and `getLayoutMode()`; desktop `panel === 'filter' && sidebarOpen`, else `panel === 'filter'`) and the comment above it with:

```ts
  // The Filter panel counts only while it is on screen: open on the desktop sidebar's Filter
  // panel; below 951 px whenever Filter is the chosen panel, except in a folded phone panel,
  // which shows only its header.
  const isFilterPanelShown = () => {
    const { panel, sidebarOpen, panelFolded } = getLayout();
    if (panel !== 'filter') return false;
    const mode = getLayoutMode();
    if (mode === 'desktop') return sidebarOpen;
    return mode !== 'phone' || !panelFolded;
  };
```

(Its `subscribePanel` already re-checks on every layout change, which includes the fold, and on mode changes, from Task 5.2.)

- [ ] **Step 11: The phone body in CSS**

Append to the end of `apps/web/src/workbench/workbench.css`:

```css
/* ── Phone body (≤ 640 px, Task 5.6, decision 17) ────────────────────────────
   One screen that never scrolls: the plot fills what the bars and the bottom panel leave. The
   panel holds the Legend and Filter tabs, the same height for both (a tab switch never resizes
   the plot), and folds to its 44 px header (one plot resize, not animated). --wb-panel-height is
   its height and --wb-structure-row the structure's row under it, which the toasts stand on. */
.workbench[data-layout='phone'] {
  --wb-panel-height: clamp(144px, 32svh, 288px);
  --wb-structure-row: 0px;
  height: 100dvh;
  overflow: hidden;
}

/* The header and the panel's top border. */
.workbench[data-layout='phone'][data-panel-folded] {
  --wb-panel-height: 45px;
}

/* Until the structure sheet (Task 5.8): a 240 px row under the panel while a protein shows. */
.workbench[data-layout='phone']:not([data-structure='none']) {
  --wb-structure-row: 240px;
}

.workbench[data-layout='phone'] .wb-body {
  display: grid;
  grid-template: 'plot' minmax(0, 1fr) 'side' auto 'struct' auto / minmax(0, 1fr);
}

.workbench[data-layout='phone'] [data-workbench='plot'] {
  grid-area: plot;
  position: relative;
  inset: auto;
}

.workbench[data-layout='phone'] #wb-sidebar {
  grid-area: side;
  position: static;
  width: auto;
  height: var(--wb-panel-height);
  box-sizing: border-box;
  border-left: 0;
  border-top: 1px solid var(--ps-border);
}

.workbench[data-layout='phone'] :is(#myLegend, #wb-filter-panel) {
  flex: 1 1 0;
  height: auto;
  min-height: 0;
  max-height: none;
}

/* Folded: the header only. The list and the builder leave the tab order; the rest is clipped. */
.workbench[data-layout='phone'][data-panel-folded] #wb-sidebar {
  overflow: hidden;
}

.workbench[data-layout='phone'][data-panel-folded] #myLegend::part(items),
.workbench[data-layout='phone'][data-panel-folded] .wb-filter-body {
  display: none;
}

/* The tabs lead the header; the annotation's name follows them, small and muted. */
.workbench[data-layout='phone'] #myLegend::part(title) {
  color: var(--ps-text-muted);
  font-size: var(--ps-text-xs);
  font-weight: 400;
}

.wb-panel-fold {
  display: none;
}

.workbench[data-layout='phone'] .wb-panel-fold {
  display: inline-flex;
}

.workbench[data-layout='phone'] .wb-panel-header > .wb-panel-fold {
  margin-left: auto;
}

.workbench[data-layout='phone'] .wb-structure {
  grid-area: struct;
  position: static;
  height: var(--wb-structure-row);
  border-left: 0;
  border-top: 1px solid var(--ps-border);
}

.workbench[data-layout='phone'][data-structure='none'] .wb-structure {
  display: none;
}

/* Toasts stand 12 px above the panel (and the structure's row), and above the selection bar's
   38 px and gap while it shows. Sonner's toaster is position: fixed to the window. */
.workbench[data-layout='phone'] .wb-body [data-sonner-toaster][data-y-position='bottom'] {
  bottom: calc(var(--wb-panel-height) + var(--wb-structure-row) + 12px);
}

.workbench[data-layout='phone']
  .wb-body:has(#mySelectionBar:not([hidden]))
  [data-sonner-toaster][data-y-position='bottom'] {
  bottom: calc(var(--wb-panel-height) + var(--wb-structure-row) + 62px);
}

/* Under a coarse pointer the selection bar's buttons are 40 px, so the bar is about 50 px tall:
   the status corner rises above that, not the mouse bar's 38 px. */
@media (pointer: coarse) {
  [data-workbench='plot']:has(> protspace-selection-bar:not([hidden])) > protspace-plot-status {
    bottom: calc(var(--ps-space-3) + 50px + var(--ps-space-2));
  }
}
```

(The second toast rule outranks the existing selection-bar lift `.wb-body:has(#mySelectionBar:not([hidden])) [data-sonner-toaster][data-y-position='bottom']`, whose `:has(#id…)` makes it beat a selector without an id.)

- [ ] **Step 12: Run L1 and write the new layout tests**

Build core if it changed since Step 9 (it did not), then run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts -g "one screen"` — PASS.

Append to `apps/web/tests/mobile-explore-layout.spec.ts` (add any of these names its imports lack: `dismissTourIfPresent`, `filterPanel`, `getSelectedProteinIds`, `selectionBarAction`, `statusChip`, `waitForExploreDataLoad` from `./helpers/explore`; `readLayout`, `watchPlotResizes` from `./helpers/workbench`; `applyFilterKeepingTen`, `bottomPanel`, `box`, `expectNoPageScroll`, `openExplorePhone`, `panelFold`, `panelTab`, `proteinNear`, `tap` from `./helpers/mobile`; `type Page` from `@playwright/test`):

```ts
test.describe('the bottom panel on a phone', () => {
  /** Two frames: the ResizeObserver behind watchPlotResizes reports after layout. */
  async function twoFrames(page: Page): Promise<void> {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  test('the fold survives a reload', async ({ page }) => {
    await openExplorePhone(page);
    await panelFold(page).tap();
    await expect(panelFold(page)).toHaveAccessibleName('Unfold panel');
    await expect(panelFold(page)).toBeFocused();
    await expect.poll(async () => (await readLayout(page))?.panelFolded).toBe(true);

    await page.reload();
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel-folded', '');
    await expect(panelFold(page)).toHaveAccessibleName('Unfold panel');
    await expect(panelFold(page)).toHaveAttribute('aria-expanded', 'false');
    expect(Math.abs((await box(bottomPanel(page))).height - 45)).toBeLessThanOrEqual(1);
    await expect(panelTab(page, 'Legend')).toBeVisible();
  });

  test('the Filter tab keeps the panel height (no plot resize)', async ({ page }) => {
    await openExplorePhone(page);
    const before = await box(bottomPanel(page));
    const resizes = await watchPlotResizes(page);

    await panelTab(page, 'Filter').tap();
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    await twoFrames(page);

    const after = await box(bottomPanel(page));
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(await resizes()).toBe(0);
  });

  test('at 360×640 the plot keeps at least 30% of the screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openExplorePhone(page);
    for (const tab of ['Legend', 'Filter'] as const) {
      await panelTab(page, tab).tap();
      await expect(page.locator('.workbench')).toHaveAttribute('data-panel', tab.toLowerCase());
      const plot = await box(page.locator('#myPlot'));
      expect(plot.height, tab).toBeGreaterThanOrEqual(0.3 * 640);
      const panel = await box(bottomPanel(page));
      expect(plot.y + plot.height, tab).toBeLessThanOrEqual(panel.y + 1);
    }
    await expectNoPageScroll(page);
  });

  test('a toast sits above the bottom panel', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openExplorePhone(page);
    const protein = await proteinNear(page, 0.5, 0.5);
    await tap(page, protein);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([protein.id]);

    await selectionBarAction(page, 'Copy IDs').tap();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /^Copied/ });
    await expect(toast).toBeVisible();
    const panel = await box(bottomPanel(page));
    // Sonner slides the toast in; poll until it has settled above the panel.
    await expect
      .poll(async () => {
        const shown = await box(toast);
        return panel.y - (shown.y + shown.height);
      })
      // 12 px over the panel, plus the selection bar's 50 px while one protein is selected.
      .toBeGreaterThanOrEqual(12 - 1);
    const shown = await box(toast);
    // Not floating far above it either (a leftover structure row would lift it by 240 px); the
    // 16 px slack covers Sonner's own spacing inside the toaster.
    expect(panel.y - (shown.y + shown.height)).toBeLessThanOrEqual(12 + 50 + 16);
    expect(shown.y).toBeGreaterThanOrEqual(0);
  });

  test("a status chip's filter opens the Filter tab unfolded", async ({ page }) => {
    await openExplorePhone(page);
    await applyFilterKeepingTen(page);
    await panelFold(page).tap();
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel-folded', '');

    await statusChip(page, 'filter').locator('.status-chip-open').tap();

    await expect(page.locator('.workbench')).not.toHaveAttribute('data-panel-folded');
    await expect(page.locator('.workbench')).toHaveAttribute('data-panel', 'filter');
    await expect(filterPanel(page)).toBeVisible();
    await expect(page.locator('#wb-filter-title')).toBeFocused();
    expect((await readLayout(page))?.panelFolded).toBe(false);
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts`

Expected: L1, L3 and the five new tests pass (with Task 5.3's tablet tests); L2 (`task 5.8`) and L4 (`task 5.9`) skipped. If "a toast sits above the bottom panel" fails with the toast at the window's bottom, Sonner's toaster on this build is not `[data-y-position='bottom']` under `.wb-body`: read `page.locator('[data-sonner-toaster]').getAttribute('data-y-position')` and fix the selector, not the expectation.

- [ ] **Step 13: The suites this task touches, then commit**

Run (each must pass; report counts before and after):

- `pnpm --filter @protspace/app exec vitest --run src/explore/layout-state.test.ts src/explore/layout-defaults.test.ts`
- (sandbox disabled) `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/selection-bar.browser.test.ts`
- The one e2e run: Step 12's `mobile-explore-layout.spec.ts`. C6, G6 and P6 lost their fixmes here and run first at the exit.

Then (sandbox disabled; the hook type-checks the app against core's dist, built in Step 9):

```bash
pnpm exec prettier --check apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-state.ts \
  apps/web/src/explore/layout-state.test.ts apps/web/src/explore/runtime.ts \
  apps/web/src/workbench/PanelFold.tsx apps/web/src/workbench/Sidebar.tsx \
  apps/web/src/workbench/FilterPanel.tsx apps/web/src/workbench/Workbench.tsx \
  apps/web/src/workbench/workbench.css apps/web/tests/mobile-explore-layout.spec.ts \
  apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-legend.spec.ts \
  apps/web/tests/mobile-plot-touch.spec.ts
git add apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-state.ts \
  apps/web/src/explore/layout-state.test.ts apps/web/src/explore/runtime.ts \
  apps/web/src/workbench/PanelFold.tsx apps/web/src/workbench/Sidebar.tsx \
  apps/web/src/workbench/FilterPanel.tsx apps/web/src/workbench/Workbench.tsx \
  apps/web/src/workbench/workbench.css apps/web/tests/mobile-explore-layout.spec.ts \
  apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-legend.spec.ts \
  apps/web/tests/mobile-plot-touch.spec.ts
git commit -m "feat(web): phone bottom panel with tabs and a fold that persists"
```

Report: the counts, LEGACY 7, and that C6/G6/P6 are unverified until the exit run.

### Task 5.7: Tap, pinch and touch tooltips on the plot

Under a touch pointer a tap on a protein pins its tooltip (with whatever actions the host offers), using a 20 px hit radius and a placement inside the plot; compat mouse events after a tap no longer start a hover; the plot's svg takes all touch for pan and pinch. A new `tapTooltips` property lets the host suppress the tap pin.

**Files:**

- Modify: `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts`, `plot-interaction-controller.test.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (net growth ≤ about 40 lines; logic in the controller and `tooltip-position.ts`), `scatter-plot.styles.ts` (svg `touch-action: none`; LEGACY stays 7)
- Modify: `packages/core/src/components/scatter-plot/tooltips/tooltip-position.ts`, `tooltip-position.test.ts`
- Create: `packages/core/src/components/scatter-plot/scatter-plot.touch.browser.test.ts`
- Modify: `apps/web/src/custom-elements.d.ts` (`tapTooltips` if React sets it; the runtime sets it in 5.8, so only if needed) — not needed: nothing in React sets it, so this task leaves the file alone
- Modify: `apps/web/tests/mobile-plot-touch.spec.ts` (P1, P2, P3 fixmes removed)
- Modify: `docs/developers/api/index.md` (`tapTooltips`, the touch model), `docs/developers/embedding.md` if it describes the tooltip pin — it does not (`grep -n "tooltip\|pin" docs/developers/embedding.md` finds nothing), so only `api/index.md` changes
- Read: `git show 6d439ffc 99caa76b` on the branch (pointer tracking, hit radius, svg touch-action) for reference only

**Interfaces:**

- Consumes: `PlotInteractionHost` (`onHover`, `onHoverEnd`, `onClick`), `pickInteractivePointAt(x, y)`, `_handleClick`, `_pinTooltip`, `_unpinTooltip`, `_reconcilePinnedTooltip`, `computeTooltipStyle`, `TooltipStyleInput`, `effectiveTooltipWidth`, `TOOLTIP_EDGE_PADDING`; from Task 5.1's `helpers/mobile.ts` the spec already uses `openExplorePhone`, `touchGesture`, `line`, `tap`, `proteinNearRightEdge`, `emptyPlotSpot`, `plotTooltip`, `box` (this task adds no helper).
- Produces:
  - Plot interaction controller: records the `pointerType` of every `pointerdown` and `pointermove` on the svg; `get touchInput(): boolean` (true from a touch `pointerdown` until a `pointermove` with `pointerType === 'mouse'`); the `mousemove.canvas` handler skips `host.onHover` while `touchInput`; a zoom or pan that starts from touch calls `host.onHoverEnd()`; `PlotInteractionHost.onClick(event: MouseEvent, touch: boolean)` (the click's `pointerType` if the event is a `PointerEvent`, else `touchInput`).
  - Scatterplot: `@property({ attribute: false }) tapTooltips = true` — "a touch tap on a protein pins its tooltip; false: it pins nothing"; turning it false unpins a pin (in `_reconcilePinnedTooltip`). `pickInteractivePointAt(mouseX, mouseY, minRadiusPx = HIT_RADIUS_MIN_PX)`; a touch click uses `TOUCH_HIT_RADIUS_PX = 20` (module constant). `_handleClick(event, point, touch)`: `protein-click` first as today; then pin when (`tooltipActions.length > 0` or `touch && tapTooltips`) and no modifier; a touch click never pins when `tapTooltips` is false. `_pinnedTooltip` gains `touch: boolean`; a touch pin is positioned with `computeTouchTooltipStyle`. The existing desktop pin rules (hover ignored, ends on click, zoom change, Escape, outside press) are unchanged.
  - `tooltip-position.ts`: `touchTooltipWidth` is not added: a touch pin uses the hover tooltip's width, `effectiveTooltipWidth` (the skeleton allowed reusing it when the widths agree). New `computeTouchTooltipStyle(input: TooltipStyleInput): string`: the tooltip lies wholly inside the plot box with `TOOLTIP_EDGE_PADDING` margins, horizontally centred on the point and clamped, above the point when it fits (point y − height − 16), else below (point y + 16), else against the plot edge farther from the point (see the ruling below); the point itself is never covered when the plot is at least `2 × (height + 16 + 15)` tall.
  - `scatter-plot.styles.ts`: `svg { touch-action: none }` on the interaction svg (pan and pinch never scroll or zoom the page).
  - One rule this task settles (not in the skeleton): a touch pin survives `tooltipActions` becoming empty (a touch pin needs no action: it is how a finger reads a protein; the phone structure controller (Task 5.8) empties the actions when the sheet expands, and that pin ends through `tapTooltips` instead. The controller writes `tooltipActions` only when its offer changes, not on every layout change); a mouse pin still ends then. Every pin ends when `tapTooltips` turns false.
  - Ruling on the "neither above nor below fits" case: the skeleton said "clamped to the top padding"; this task uses the branch's rule (against the plot edge farther from the point), which covers the point less often. Both keep the card inside the plot.

**Tests:**

- `plot-interaction-controller.test.ts`: "a touch pointerdown then a compat mousemove does not call onHover"; "a mouse pointermove re-enables hover"; "onClick reports touch for a click after a touch pointerdown"; "a touch zoom start calls onHoverEnd".
- `tooltip-position.test.ts`: `computeTouchTooltipStyle` near each edge keeps the box inside `[15, width − 15]` × `[15, height − 15]`; above when room, below when not; the point is not inside the box.
- `scatter-plot.touch.browser.test.ts` (Chromium, `PointerEvent` with `pointerType: 'touch'` then `click`): "a touch tap within 20 px of a point pins its tooltip with no actions offered"; "a mouse click at the same 12 px distance selects nothing"; "tapTooltips false: a touch tap selects but pins nothing"; "setting tapTooltips false unpins"; "a pinned touch tooltip lies inside the plot near the right edge"; "the svg's touch-action is none". Added: "emptying tooltipActions keeps a touch pin"; "a compat mousemove after a touch press shows no hover tooltip".
- `mobile-plot-touch.spec.ts`: P1, P2, P3 green.
- Unrun at task time (exit): `workbench-structure.spec.ts` (pin and View structure on desktop), `multi-annotation-tooltip.spec.ts`, `eat-visualization.spec.ts` (hover), `numeric-binning.spec.ts` (hover point), `brush-selection.spec.ts`; `pnpm perf:counts` (hover path).

Verification: the controller and tooltip-position unit tests; `scatter-plot.touch.browser.test.ts` and `scatter-plot.tooltip-actions.browser.test.ts`; `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts`. Report `wc -l scatter-plot.ts` (2,561 before this task).

No extra path for a tap on a second protein: `_handleCanvasClick` already unpins and then pins anew through `_handleClick` (`scatter-plot.ts`, the unpin-then-pin at the top of the canvas click), and a touch click pins whenever `tapTooltips` holds. Do not add a second re-pin path.

- [ ] **Step 1: Write the failing controller tests**

In `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts`, add two helpers after `makeHostBridge` (before `describe('PlotInteractionController', …)`):

```ts
const pointer = (type: string, pointerType: string) =>
  new PointerEvent(type, { pointerType, bubbles: true });

type ZoomWithEvent = (
  selection: unknown,
  transform: d3.ZoomTransform,
  point: undefined,
  event: unknown,
) => void;

/** A zoom gesture as d3 runs it for `sourceType`: d3-zoom 3 takes the source event as a fourth
 *  argument of `transform`, which its typings leave out. */
function zoomFrom(c: PlotInteractionController, svg: SVGSVGElement, k: number, sourceType: string) {
  const zoom = (c as unknown as { _zoom: d3.ZoomBehavior<SVGSVGElement, unknown> })._zoom;
  (zoom.transform as unknown as ZoomWithEvent)(d3.select(svg), d3.zoomIdentity.scale(k), undefined, {
    type: sourceType,
  });
}
```

Then add these four tests at the end of the `describe('PlotInteractionController', …)` block (after the `syncTransform` test):

```ts
  it('a touch pointerdown then a compat mousemove does not call onHover', () => {
    const { bridge } = makeHostBridge(svg);
    const onHover = vi.fn();
    const c = new PlotInteractionController({ ...bridge, onHover });
    c.initialize();
    c.setupCanvasEventHandling();
    expect(c.touchInput).toBe(false);

    svg.dispatchEvent(pointer('pointerdown', 'touch'));
    // The mouse events a browser sends after a tap: touch has no mouseleave to end their hover.
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(c.touchInput).toBe(true);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('a mouse pointermove re-enables hover', () => {
    const { bridge } = makeHostBridge(svg);
    const onHover = vi.fn();
    const c = new PlotInteractionController({ ...bridge, onHover });
    c.initialize();
    c.setupCanvasEventHandling();
    svg.dispatchEvent(pointer('pointerdown', 'touch'));
    // A touch move keeps the gate shut.
    svg.dispatchEvent(pointer('pointermove', 'touch'));
    expect(c.touchInput).toBe(true);

    svg.dispatchEvent(pointer('pointermove', 'mouse'));
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    expect(c.touchInput).toBe(false);
    expect(onHover).toHaveBeenCalledOnce();
  });

  it('onClick reports touch for a click after a touch pointerdown', () => {
    const { bridge } = makeHostBridge(svg);
    const onClick = vi.fn();
    const c = new PlotInteractionController({ ...bridge, onClick });
    c.initialize();
    c.setupCanvasEventHandling();

    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenLastCalledWith(expect.any(MouseEvent), false);

    svg.dispatchEvent(pointer('pointerdown', 'touch'));
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenLastCalledWith(expect.any(MouseEvent), true);

    // A click that names its pointer (Chromium's clicks are PointerEvents) wins over the last press.
    svg.dispatchEvent(pointer('click', 'mouse'));
    expect(onClick).toHaveBeenLastCalledWith(expect.any(MouseEvent), false);
  });

  it('a touch zoom start calls onHoverEnd', () => {
    const { bridge } = makeHostBridge(svg);
    const onHoverEnd = vi.fn();
    const c = new PlotInteractionController({ ...bridge, onHoverEnd });
    c.initialize();

    zoomFrom(c, svg, 2, 'wheel');
    expect(onHoverEnd).not.toHaveBeenCalled();

    zoomFrom(c, svg, 3, 'touchstart');
    expect(onHoverEnd).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Write the failing placement tests**

In `packages/core/src/components/scatter-plot/tooltips/tooltip-position.test.ts`, add `computeTouchTooltipStyle` to the import list from `./tooltip-position` (keep the others), and append:

```ts
describe('computeTouchTooltipStyle', () => {
  // A phone plot, 374 × 400: the card is effectiveTooltipWidth(374) = 344 px wide.
  const phone: TooltipStyleInput = {
    x: 187,
    y: 300,
    height: 140,
    viewportWidth: 374,
    viewportHeight: 400,
  };
  const box = (style: string) => {
    const num = (name: string) => Number(new RegExp(`${name}: (-?[\\d.]+)px`).exec(style)![1]);
    return {
      left: num('left'),
      top: num('top'),
      width: num('--protspace-tooltip-effective-width'),
    };
  };
  const covers = (style: string, x: number, y: number, height: number) => {
    const b = box(style);
    return x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + height;
  };

  it('uses the hover tooltip width', () => {
    expect(box(computeTouchTooltipStyle(phone)).width).toBe(effectiveTooltipWidth(374));
  });

  it('keeps the card inside the plot for a tap near each edge', () => {
    for (const x of [2, 187, 372]) {
      for (const y of [2, 20, 200, 390, 398]) {
        const { left, top, width } = box(computeTouchTooltipStyle({ ...phone, x, y }));
        expect(left).toBeGreaterThanOrEqual(TOOLTIP_EDGE_PADDING);
        expect(left + width).toBeLessThanOrEqual(374 - TOOLTIP_EDGE_PADDING);
        expect(top).toBeGreaterThanOrEqual(TOOLTIP_EDGE_PADDING);
        expect(top + phone.height).toBeLessThanOrEqual(400 - TOOLTIP_EDGE_PADDING);
      }
    }
  });

  it('centres the card on the protein when the plot has room', () => {
    const wide = { ...phone, x: 400, viewportWidth: 800 };
    const { left, width } = box(computeTouchTooltipStyle(wide));
    expect(left + width / 2).toBe(400);
  });

  it('places the card above the protein, clear of the finger, when it fits', () => {
    expect(box(computeTouchTooltipStyle(phone)).top).toBe(300 - 16 - 140);
  });

  it('places the card below the protein when there is no room above', () => {
    expect(box(computeTouchTooltipStyle({ ...phone, y: 60 })).top).toBe(60 + 16);
  });

  it('puts the card against the plot edge farther from the protein when neither side fits', () => {
    const short = { ...phone, viewportHeight: 200 };
    expect(box(computeTouchTooltipStyle({ ...short, y: 150 })).top).toBe(TOOLTIP_EDGE_PADDING);
    expect(box(computeTouchTooltipStyle({ ...short, y: 50 })).top).toBe(
      200 - 140 - TOOLTIP_EDGE_PADDING,
    );
  });

  it('never covers the protein in a plot taller than twice the card and its gaps', () => {
    // 400 ≥ 2 × (140 + 16 + 15): above or below always fits.
    for (let y = 0; y <= 400; y += 5) {
      expect(covers(computeTouchTooltipStyle({ ...phone, y }), 187, y, 140)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Write the failing browser test**

Create `packages/core/src/components/scatter-plot/scatter-plot.touch.browser.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { ProtspaceScatterplot } from './scatter-plot';
import type { TooltipAction } from './scatter-plot.events';
import './scatter-plot';

const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };

afterEach(() => {
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Three proteins far apart, with empty plot around each. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 5, 5, 10, 10]) }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#336699'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(3) },
  } as unknown as VisualizationData;
}

const at = (plot: ProtspaceScatterplot, id: string) => plot.getProteinClientPosition(id)!;
const svgOf = (plot: ProtspaceScatterplot) => plot.shadowRoot!.querySelector('svg')!;
const right = (point: { x: number; y: number }, dx: number) => ({ x: point.x + dx, y: point.y });

async function mountPlot(actions: readonly TooltipAction[] = []) {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.tooltipActions = actions;
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  // Hit tests read the point grid, rebuilt on a frame after the data and the size.
  await vi.waitFor(() => {
    const rect = plot.getBoundingClientRect();
    const p = at(plot, 'P3');
    expect(plot.pickInteractivePointAt(p.x - rect.left, p.y - rect.top)).not.toBeNull();
  });
  return plot;
}

/** A finger's tap as Chromium reports it: a touch press and release, then a click that names it. */
function tap(plot: ProtspaceScatterplot, point: { x: number; y: number }) {
  const init: PointerEventInit = {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    composed: true,
    pointerType: 'touch',
    pointerId: 2,
    isPrimary: true,
  };
  const svg = svgOf(plot);
  svg.dispatchEvent(new PointerEvent('pointerdown', init));
  svg.dispatchEvent(new PointerEvent('pointerup', init));
  svg.dispatchEvent(new PointerEvent('click', init));
}

function mouse(plot: ProtspaceScatterplot, type: 'click' | 'mousemove', point: { x: number; y: number }) {
  svgOf(plot).dispatchEvent(
    new MouseEvent(type, { clientX: point.x, clientY: point.y, bubbles: true, composed: true }),
  );
}

type Tooltip = HTMLElement & { updateComplete: Promise<unknown> };
const tooltip = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<Tooltip>('protspace-protein-tooltip');
const pinned = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<Tooltip>('protspace-protein-tooltip.pinned');

function clicks(plot: ProtspaceScatterplot) {
  const ids: string[] = [];
  plot.addEventListener('protein-click', (event) =>
    ids.push((event as CustomEvent<{ proteinId: string }>).detail.proteinId),
  );
  return ids;
}

describe('scatterplot touch', () => {
  it('a touch tap within 20 px of a point pins its tooltip with no actions offered', async () => {
    const plot = await mountPlot();
    const ids = clicks(plot);
    tap(plot, right(at(plot, 'P2'), 12));
    await plot.updateComplete;

    expect(ids).toEqual(['P2']);
    const tip = pinned(plot)!;
    expect(tip).not.toBeNull();
    await tip.updateComplete;
    expect(tip.shadowRoot!.textContent).toContain('P2');
    expect(tip.shadowRoot!.querySelector('ps-button')).toBeNull();
  });

  it('a mouse click at the same 12 px distance selects nothing', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    const ids = clicks(plot);
    mouse(plot, 'click', right(at(plot, 'P2'), 12));
    await plot.updateComplete;
    expect(ids).toEqual([]);
    expect(pinned(plot)).toBeNull();
  });

  it('tapTooltips false: a touch tap selects but pins nothing', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    plot.tapTooltips = false;
    await plot.updateComplete;
    const ids = clicks(plot);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    expect(ids).toEqual(['P2']);
    expect(pinned(plot)).toBeNull();
  });

  it('setting tapTooltips false unpins', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    plot.tapTooltips = false;
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('emptying tooltipActions keeps a touch pin', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    await pinned(plot)!.updateComplete;
    expect(pinned(plot)!.shadowRoot!.querySelector('ps-button')).not.toBeNull();

    plot.tooltipActions = [];
    await plot.updateComplete;
    const tip = pinned(plot)!;
    expect(tip).not.toBeNull();
    await tip.updateComplete;
    expect(tip.shadowRoot!.querySelector('ps-button')).toBeNull();
  });

  it('a pinned touch tooltip lies inside the plot near the right edge', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P3'));
    // The card is placed by an estimate first, then by its measured height.
    await vi.waitFor(async () => {
      await plot.updateComplete;
      const tip = pinned(plot)!;
      expect(tip).not.toBeNull();
      const area = plot.getBoundingClientRect();
      const card = tip.getBoundingClientRect();
      expect(card.width).toBeGreaterThan(0);
      expect(card.left).toBeGreaterThanOrEqual(area.left);
      expect(card.right).toBeLessThanOrEqual(area.right);
      expect(card.top).toBeGreaterThanOrEqual(area.top);
      expect(card.bottom).toBeLessThanOrEqual(area.bottom);
    });
  });

  it('a compat mousemove after a touch press shows no hover tooltip', async () => {
    const plot = await mountPlot();
    const p = at(plot, 'P3');
    svgOf(plot).dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: p.x,
        clientY: p.y,
        bubbles: true,
        composed: true,
        pointerType: 'touch',
      }),
    );
    mouse(plot, 'mousemove', p);
    await frame();
    await plot.updateComplete;
    expect(tooltip(plot)).toBeNull();
  });

  it("the svg's touch-action is none", async () => {
    const plot = await mountPlot();
    expect(getComputedStyle(svgOf(plot)).touchAction).toBe('none');
  });
});
```

- [ ] **Step 4: Run the new tests and see them fail**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/interaction/plot-interaction-controller.test.ts src/components/scatter-plot/tooltips/tooltip-position.test.ts
pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/scatter-plot.touch.browser.test.ts
```

The browser run needs the Bash sandbox disabled (`EPERM listen ::1` inside it). Expected: the unit run fails to compile `tooltip-position.test.ts` (`computeTouchTooltipStyle` is not exported), and the four controller tests fail (`touchInput` is undefined, `onHover` is called after the touch press, `onClick` gets one argument, `onHoverEnd` is never called). In the browser file every test except "a mouse click at the same 12 px distance selects nothing" and "a pinned touch tooltip lies inside the plot near the right edge" fails ("near the right edge" offers an action and taps P3 itself, so today's click pins and `computeTooltipStyle` already clamps into the plot: it may pass now and pins the behaviour; `tooltip-position.test.ts`'s "centres the card …" is the test that fails for the placement's reason). The others fail because a tap with no actions pins nothing, the tap misses P2 at 12 px, `tapTooltips` does not exist, the compat mousemove opens a hover tooltip, and the svg's `touch-action` is `auto`. "emptying tooltipActions keeps a touch pin" fails at its last assertion (the pin ends).

- [ ] **Step 5: Remove this task's fixmes from the phone spec and run it red**

```bash
grep -n "fixme(true, 'task 5.7')" apps/web/tests/mobile-plot-touch.spec.ts
```

Expect three lines (P1, P2, P3). Delete each of those `test.fixme(true, 'task 5.7');` lines and nothing else. Run:

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts
```

Expected: P1 fails on the svg's `touchAction` (`'auto'`, not `'none'`). P2 and P3 may already pass through the compat-mouse hover tooltip this task removes (a tap there shows a hover tooltip, not a pin); write in the report which of them were red. The other P tests stay skipped (their fixmes belong to 5.8, 5.6, 5.9, 5.10 and 5.12).

- [ ] **Step 6: Track the pointer type in the interaction controller**

In `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts`:

Replace the `onClick` line of `PlotInteractionHost`

```ts
  onClick(event: MouseEvent): void;
```

with

```ts
  /** `touch`: the click came from a finger's tap, which has no hover before it. */
  onClick(event: MouseEvent, touch: boolean): void;
```

Add this function after the interface (before the class's doc comment):

```ts
/** Whether a d3 zoom gesture came from a finger: d3-zoom hears touch events, not pointer events. */
function isTouchSource(event: unknown): boolean {
  const type = (event as { type?: unknown } | null)?.type;
  return typeof type === 'string' && type.startsWith('touch');
}
```

Add a field after `private _selectionAwaitsScales = false;`:

```ts
  // From a touch press until the mouse moves again. A tap is followed by compat mouse events, which
  // must not start a hover: touch has no mouseleave to end one.
  private _touchInput = false;
```

Add a getter after `get selectionAwaitsScales() { … }`:

```ts
  /** Whether the latest press on the plot was a finger's (until a mouse moves over it again). */
  get touchInput(): boolean {
    return this._touchInput;
  }
```

In `initialize()`, replace

```ts
    this._zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(this.host.getMergedConfig().zoomExtent)
      .on('zoom', (event) => this.applyZoom(event.transform));
```

with

```ts
    this._zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(this.host.getMergedConfig().zoomExtent)
      // A finger's pan or pinch ends any hover tooltip; a pin ends with the transform change.
      .on('start', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (isTouchSource(event.sourceEvent)) this.host.onHoverEnd();
      })
      .on('zoom', (event) => this.applyZoom(event.transform));
```

Replace the body of `setupCanvasEventHandling()`:

```ts
  setupCanvasEventHandling(): void {
    if (!this._svgSelection) return;

    // Use event delegation on the SVG overlay for canvas interactions
    this._svgSelection
      .on('pointerdown.input', (event: PointerEvent) => {
        this._touchInput = event.pointerType === 'touch';
      })
      .on('pointermove.input', (event: PointerEvent) => {
        if (event.pointerType === 'mouse') this._touchInput = false;
      })
      .on('mousemove.canvas', (event: MouseEvent) => {
        if (!this._touchInput) this.host.onHover(event, null);
      })
      .on('click.canvas', (event: MouseEvent) => this.host.onClick(event, this._isTouchClick(event)))
      .on('mouseout.canvas', () => this.host.onHoverEnd());
  }

  /** A click names its pointer in Chromium and Firefox (a PointerEvent); else the last press does. */
  private _isTouchClick(event: MouseEvent): boolean {
    const type = (event as Partial<PointerEvent>).pointerType;
    return type ? type === 'touch' : this._touchInput;
  }
```

- [ ] **Step 7: Add the touch placement**

In `packages/core/src/components/scatter-plot/tooltips/tooltip-position.ts`, append after `computeTooltipStyle`:

```ts
/** Gap (px) between a tap-pinned tooltip and its protein, so the finger does not cover the card. */
const TOUCH_TOOLTIP_CLEARANCE = 16;

/**
 * Placement for a tooltip a tap pinned. A finger has no cursor to sit beside, and on a phone the
 * plot is barely wider than the card, so the card is centred on the protein and kept wholly inside
 * the plot (TOOLTIP_EDGE_PADDING from every edge): above the protein when it fits, else below it,
 * else against the plot edge farther from it. It takes the hover tooltip's width.
 */
export function computeTouchTooltipStyle(input: TooltipStyleInput): string {
  const { x, y, height, viewportWidth, viewportHeight } = input;
  const width = effectiveTooltipWidth(viewportWidth);
  const pad = TOOLTIP_EDGE_PADDING;

  const left = Math.max(pad, Math.min(x - width / 2, viewportWidth - width - pad));

  const above = y - TOUCH_TOOLTIP_CLEARANCE - height;
  const below = y + TOUCH_TOOLTIP_CLEARANCE;
  let top: number;
  if (above >= pad) top = above;
  else if (below + height <= viewportHeight - pad) top = below;
  else top = y > viewportHeight / 2 ? pad : viewportHeight - height - pad;
  top = Math.max(pad, top);

  return `left: ${left}px; top: ${top}px; --protspace-tooltip-effective-width: ${width}px;`;
}
```

Also extend the module's opening doc comment by one sentence at its end (before ` */`): ` * computeTouchTooltipStyle places a tooltip a tap pinned, wholly inside the plot.`

- [ ] **Step 8: Wire touch into the scatterplot**

In `packages/core/src/components/scatter-plot/scatter-plot.ts` (anchors are names; line numbers are from `df9a4771`):

1. The `./tooltips/tooltip-position` import (about line 52) becomes:

```ts
import {
  computeTooltipStyle,
  computeTouchTooltipStyle,
  effectiveTooltipWidth,
  TOOLTIP_FALLBACK_HEIGHT,
} from './tooltips/tooltip-position';
```

2. After `const HIT_RADIUS_MIN_PX = 4;` add:

```ts
// A fingertip is far less precise than a cursor: a tap picks the nearest protein within 20 px,
// half the 40 px touch target.
const TOUCH_HIT_RADIUS_PX = 20;
```

3. In `NO_ADDITIONAL_RENDER_KEYS`, add `'tapTooltips',` after `'tooltipActions',`.

4. Replace the `tooltipActions` doc comment and add the new property after it:

```ts
  /**
   * Buttons a plain click on a protein offers in its tooltip, which then stays (pinned) until
   * Escape, a press outside the plot, the next click, a zoom or pan, a data or projection
   * change, or until this becomes empty (a touch pin outlives that, see `tapTooltips`). Hovers over
   * other proteins leave it. A button dispatches `tooltip-action` with its id and the protein.
   * Empty (the default) keeps mouse tooltips hover-only.
   */
  @property({ attribute: false }) tooltipActions: readonly TooltipAction[] = [];
  /**
   * Whether a touch tap on a protein pins its tooltip, offering `tooltipActions` (none is fine:
   * touch has no hover to show a tooltip otherwise). False: a tap pins nothing, and turning it
   * false ends a pin. Mouse clicks follow `tooltipActions` alone.
   */
  @property({ attribute: false }) tapTooltips = true;
```

5. Replace the `_pinnedTooltip` declaration and its comment:

```ts
  // The tooltip a click pinned at its protein: a mouse click while tooltipActions offered buttons,
  // or a tap (`touch`, placed for a finger) while tapTooltips holds.
  @state() private _pinnedTooltip: { point: PlotDataPoint; view: TooltipView; touch: boolean } | null =
    null;
```

6. In the `_dupOverlay` options, replace `onPointActivate: (e, p) => this._handleClick(e, p),` with:

```ts
    // The spiderfy node stops its pointerdown from reaching the svg, so the controller's
    // touchInput can be stale here; the node's own pointerup says what pressed it.
    onPointActivate: (e, p) =>
      this._handleClick(e, p, (e as Partial<PointerEvent>).pointerType === 'touch'),
```

7. In the interaction host bridge, replace `onClick: (event) => this._handleCanvasClick(event),` with:

```ts
      onClick: (event, touch) => this._handleCanvasClick(event, touch),
```

8. `_handleClick`: change the signature to `private _handleClick(event: MouseEvent, point: PlotDataPoint, touch = false) {` and replace its closing `if (…) { this._pinTooltip(point, view); }` block with:

```ts
    // A tap pins while tapTooltips holds, with or without actions; a mouse click needs an action.
    const pins = touch ? this.tapTooltips : this.tooltipActions.length > 0;
    if (view && pins && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      this._pinTooltip(point, view, touch);
    }
```

9. `pickInteractivePointAt`: change the signature and the radius line:

```ts
  pickInteractivePointAt(
    mouseX: number,
    mouseY: number,
    minRadiusPx = HIT_RADIUS_MIN_PX,
  ): PlotDataPoint | null {
```

```ts
    const hitRadius = Math.max(this._drawnPointRadiusCss(), minRadiusPx);
```

10. `_handleCanvasClick`: change its signature to `private _handleCanvasClick(event: MouseEvent, touch = false): void {`, replace

```ts
    const nearestPoint = this.pickInteractivePointAt(mouseX, mouseY);
```

(the one inside `_handleCanvasClick`, not the hover one in `_processCanvasHover`) with

```ts
    const nearestPoint = this.pickInteractivePointAt(
      mouseX,
      mouseY,
      touch ? TOUCH_HIT_RADIUS_PX : HIT_RADIUS_MIN_PX,
    );
```

and its last line `this._handleClick(event, nearestPoint);` with `this._handleClick(event, nearestPoint, touch);`. Also extend its doc comment `Handle click events for canvas rendering` to `Handle click events for canvas rendering. A tap (\`touch\`) picks within TOUCH_HIT_RADIUS_PX.`

11. `_getTooltipStyle`: replace `return computeTooltipStyle({` with

```ts
    const place = this._pinnedTooltip?.touch ? computeTouchTooltipStyle : computeTooltipStyle;
    return place({
```

(the object literal and closing `});` stay).

12. `_pinTooltip`: change the signature and first line:

```ts
  private _pinTooltip(point: PlotDataPoint, view: TooltipView, touch: boolean): void {
    this._pinnedTooltip = { point, view, touch };
```

13. Replace `_reconcilePinnedTooltip` with:

```ts
  /**
   * A pin ends with its data, with its points' positions, when taps stop pinning, or (a mouse
   * pin) with the last action. A touch pin needs no action: it is how a finger reads a protein.
   */
  private _reconcilePinnedTooltip(changedProperties: Map<string, unknown>): void {
    const pinned = this._pinnedTooltip;
    if (!pinned) return;
    const actionsGone =
      !pinned.touch && changedProperties.has('tooltipActions') && this.tooltipActions.length === 0;
    const tapsOff = changedProperties.has('tapTooltips') && !this.tapTooltips;
    if (actionsGone || tapsOff || this._geometryInputsChanged(changedProperties)) {
      this._unpinTooltip();
    }
  }
```

- [ ] **Step 9: Give the svg all touch**

In `packages/core/src/components/scatter-plot/scatter-plot.styles.ts`, inside the existing `svg { z-index: var(--z-svg); pointer-events: all; }` rule, add after `pointer-events: all;`:

```ts
    /* d3-zoom pans and pinches the plot; the browser must not also scroll or zoom the page. */
    touch-action: none;
```

The module stays in the style lint's `LEGACY` set (it still has raw colours): LEGACY count 7.

- [ ] **Step 10: Run the core tests and see them pass**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/interaction/plot-interaction-controller.test.ts src/components/scatter-plot/tooltips/tooltip-position.test.ts src/components/scatter-plot/scatter-plot.pick.test.ts
pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/scatter-plot.touch.browser.test.ts src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts src/components/scatter-plot/scatter-plot.escape.browser.test.ts
```

(browser run with the sandbox disabled). Expected: all green. `scatter-plot.tooltip-actions.browser.test.ts` stays green unchanged: its clicks are plain `MouseEvent`s with no touch press before them, so they take the mouse path (`touch` false), and "emptying tooltipActions unpins" still holds for a mouse pin. `scatter-plot.pick.test.ts` calls `pickInteractivePointAt` with two arguments, which keeps the 4 px radius. Report the counts of these files before (from the baseline) and after.

- [ ] **Step 11: Run the phone spec green**

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts
```

Expected: P1, P2 and P3 pass; every other P test is skipped by its own fixme. If P2 fails on the tooltip's box, read the tooltip host's box (`plotTooltip(page)`), not the inner `.tooltip`, as the test was written in 5.1; the host is `position: absolute` and sized by its card.

- [ ] **Step 12: Document the touch model**

In `docs/developers/api/index.md`, Scatterplot section:

1. In the properties table, add a row after the `tooltipActions` row:

```md
| `tapTooltips`                       | `boolean`                             | `true`        | A touch tap on a protein pins its tooltip      |
```

2. In "### HTML attributes", replace `; no scatterplot property is` + `` `attribute: false`. `` (the sentence's end) with `; \`tooltipActions\` and \`tapTooltips\` have no attribute.`

3. In the `tooltipActions` paragraph, replace `Empty, the default, keeps tooltips hover-only.` with `Empty, the default, keeps mouse tooltips hover-only.`, then add this paragraph after it (before "Escape follows the kit's one layer stack"):

```md
Touch uses the same pin. A tap is a click whose pointer is a finger: it picks the protein within
20 px (a mouse click needs the point under the cursor) and, while `tapTooltips` is true (the
default), pins that protein's tooltip even when `tooltipActions` is empty, since touch has no hover
to show it. The pin offers whatever `tooltipActions` holds, outlives `tooltipActions` becoming empty,
and sits wholly inside the plot, centred over the protein and above it when it fits. Set
`tapTooltips` to false to keep taps from pinning; turning it false ends a pin. The mouse events a
browser sends after a tap never start a hover tooltip, a pan or pinch by touch ends one, and the
plot's SVG has `touch-action: none`, so pans and pinches move the plot, never the page.
```

Then `pnpm exec prettier --write docs/developers/api/index.md` (the table realigns).

- [ ] **Step 13: Checks and commit**

```bash
wc -l packages/core/src/components/scatter-plot/scatter-plot.ts
pnpm exec prettier --check packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.styles.ts packages/core/src/components/scatter-plot/tooltips/tooltip-position.ts packages/core/src/components/scatter-plot/tooltips/tooltip-position.test.ts packages/core/src/components/scatter-plot/scatter-plot.touch.browser.test.ts apps/web/tests/mobile-plot-touch.spec.ts docs/developers/api/index.md
git add packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.styles.ts packages/core/src/components/scatter-plot/tooltips/tooltip-position.ts packages/core/src/components/scatter-plot/tooltips/tooltip-position.test.ts packages/core/src/components/scatter-plot/scatter-plot.touch.browser.test.ts apps/web/tests/mobile-plot-touch.spec.ts docs/developers/api/index.md
git commit -m "feat(core): tap to pin a protein tooltip on touch screens"
```

`scatter-plot.ts` should grow by about 30 lines (≤ 40); report the number. The commit needs the sandbox disabled (the hook). Report: the counts of the files run, LEGACY 7, `wc -l scatter-plot.ts`, which of P2/P3 were red at Step 5, and under "Unrun at task time" the specs listed in Tests above plus `pnpm perf:counts` (hover path).

### Task 5.8: Structure bottom sheet on phones

On a phone a requested structure shows as a sheet along the bottom edge, folded to its header so the plot and the tooltip stay visible. Its chevron (or the grip or header) expands it; while it is expanded a tap closes the tooltip and opens none, and the tooltip's "View structure" expands it. Closing starts over: the next protein opens folded. Mol* loads on the tap and is prefetched on the first touch.

**Files:**

- Modify: `apps/web/src/explore/workbench-status.ts` (`structureSheet`, `setStructureSheet`), `workbench-status.test.ts` (every whole-status comparison gains the field)
- Modify: `apps/web/src/explore/structure-controller.ts`, `structure-controller.test.ts`, `runtime.ts` (wiring if the controller needs the status) — not needed: the controller imports `workbench-status.ts` itself, and `runtime.ts` already passes the scatterplot, whose type gains `tapTooltips` from Task 5.7
- Modify: `apps/web/src/workbench/StructurePanel.tsx` (chevron in `slot="header-actions"`, grip, header/grip click toggles), `Workbench.tsx` (`data-sheet`), `workbench.css` (phone sheet block; legend list padding)
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.ts` (`part="body"` wrapping the viewer container, color toolbar and tips; prefetch on the plot's first touch `pointerdown`), its tests (`structure-viewer.component.test.ts`, `structure-viewer.prefetch.test.ts`); `structure-viewer.styles.ts` for one `.body { display: contents }` rule (LEGACY stays 7)
- Modify: `apps/web/tests/helpers/mobile.ts` (`sheetToggle`, `structureSheet` confirmed), `mobile-explore-layout.spec.ts` (L2), `mobile-plot-touch.spec.ts` (P4, P5) — fixmes removed; three new tests in `mobile-plot-touch.spec.ts`
- Modify: `docs/developers/api/index.md` (viewer `body` part, touch prefetch)

**Interfaces:**

- Consumes: `hasStructureSheet`, `LayoutMode`, `LayoutModeSource`, `getLayoutMode`, `subscribeLayoutMode` (5.2; the controller's `layoutMode` option and `isStructureVisible(layout, mode)`); `tapTooltips`, touch pin (5.7); `panelFolded`, `data-panel-folded`, the phone panel CSS (`#wb-sidebar` height `clamp(144px, 32svh, 288px)`, folded `45px`) and `chevron-up` (5.6); `VIEW_STRUCTURE`, `request`, `offerViewStructure`, `onTooltipAction`; `subscribeWorkbenchStatus`; `watchPlotResizes`, `seedLayout` (`helpers/workbench.ts`), `legend` (`helpers/legend.ts`), `openExplorePhone`, `proteinNear`, `tap`, `plotTooltip`, `structureSheet`, `sheetToggle`, `panelTab`, `box`, `overlaps` (`helpers/mobile.ts`, 5.1).
- Produces:
  - `WorkbenchStatus.structureSheet: 'folded' | 'expanded'` (default `'folded'`); `setStructureSheet(state: 'folded' | 'expanded'): void` (the shell's one write; a thin wrapper over `setWorkbenchStatus`).
  - Structure controller: subscribes to the workbench status (sheet changes) and to the mode. Sheet reset: when `structureProteinId` goes from `null` to an id, and on `structure-close`, it sets `structureSheet: 'folded'`. Offer rule, recomputed on layout, mode and status changes: desktop as today, `tapTooltips = true`; tablet `tooltipActions = []`, `tapTooltips = true`; sheet modes: expanded with a protein shown → `tooltipActions = []`, `tapTooltips = false`; otherwise `[VIEW_STRUCTURE]`, `tapTooltips = true`. `onTooltipAction` in sheet modes: `request(proteinId)` then `setStructureSheet('expanded')` (focus the structure section a frame later when the button had focus); elsewhere unchanged. `plotElement` option type gains `'tapTooltips'`.
  - `Workbench.tsx`: `data-sheet={structureSheet}` when `hasStructureSheet(mode) && structure !== 'none'`.
  - StructurePanel (sheet modes only): a `ps-icon-button slot="header-actions" size="sm"` `icon={expanded ? 'chevron-down' : 'chevron-up'}` `label={expanded ? 'Hide the structure' : 'Show the structure'}` `expanded` toggling `setStructureSheet`; a decorative `div.wb-sheet-grip` (aria-hidden) before the viewer (always rendered, shown by CSS in sheet modes only, so nothing is inserted beside the viewer when the mode changes); a click on the grip or on the viewer's header part (event path contains the `::part(header)` element and no button or link) toggles too. Pop-out stays desktop-only. New props: `sheet: boolean`, `sheetExpanded: boolean`.
  - Viewer: `part="body"` on one wrapper (`div.body`, `display: contents`, so layout is unchanged) around `.viewer-container`, `.color-toolbar` and the tips; on its scatterplot's first `pointerdown` with `pointerType === 'touch'` it calls `prefetchMolstar()` once (both prefetch listeners removed after, whichever fires first).
  - CSS: `--wb-sheet-folded: 56px`, the grip, and the folded rule that hides `::part(body)` and `::part(links)` are keyed on both sheet modes (`:is([data-layout='phone'], [data-layout='landscape'])`), so Task 5.9 only places the landscape structure. Phone (`.workbench[data-layout='phone']`): `:not([data-structure='none']) .wb-structure` fixed at the bottom (`inset: auto 0 0`), `z-index: 6`, height `min(50svh, 416px)`, top radius `var(--ps-radius-lg)`, `box-shadow: var(--ps-shadow-lg)`, `padding-bottom: env(safe-area-inset-bottom)`, no border (the folded 56 px are exactly grip and header), `transform: translateY(calc(100% - var(--wb-sheet-folded)))`, transition on transform; `[data-sheet='expanded'] .wb-structure { transform: none }`; folded: `#myStructureViewer::part(body)` and `::part(links)` `visibility: hidden`; `[data-structure='none'] .wb-structure { display: none }`; divider, empty footer and float grip are already hidden there (`.wb-divider` off desktop, the footer once a structure shows, the float grip renders only when floating); reduced motion: `.wb-structure` is already in the `prefers-reduced-motion` block (`transition-property: none`). While a structure shows, `#wb-sidebar` gets `padding-bottom: var(--wb-sheet-folded)` unfolded and `height: calc(45px + var(--wb-sheet-folded))` folded, with `box-sizing: border-box` on the phone sidebar so the padding never changes its outer height. Landscape keeps the tablet placement until 5.9.

**Tests:**

- `workbench-status.test.ts`: the default includes `structureSheet: 'folded'`; `setStructureSheet` notifies once; equal value does not.
- `structure-controller.test.ts`: "phone, folded: the plot offers View structure and taps pin"; "phone, expanded: no actions and tapTooltips false"; "View structure on a phone requests the protein and expands the sheet, and never opens the sidebar"; "close resets the sheet to folded"; "a new protein after none opens folded"; "a second protein while folded keeps folded" (with the expanded case: "a second protein keeps the sheet as it is"); "tablet offers nothing and taps pin"; desktop cases unchanged. Added: "landscape follows the same sheet rule", "a mode change applies the new mode's rule", "desktop keeps taps pinning", "dispose stops following the sheet".
- Viewer test (jsdom): "the body part wraps the viewer and the colour toolbar"; "a touch pointerdown on the plot prefetches Mol* once"; added "a mouse pointerdown prefetches nothing".
- `mobile-*`: L2, P4, P5 green. New in `mobile-plot-touch.spec.ts`: "folding and expanding the sheet never resizes the plot" (`watchPlotResizes` 0); "the last legend row can be scrolled above the folded sheet"; "with the panel folded, a structure opening resizes the plot once and the tabs stay visible" (it also checks a toast stands above the folded panel and sheet).
- Unrun at task time (exit): `workbench-structure.spec.ts` (desktop View structure, picker), `workbench-escape.spec.ts`, and `mobile-explore-layout.spec.ts` L2 (this task's one e2e run is `mobile-plot-touch.spec.ts`).

Verification: `workbench-status.test.ts`, `structure-controller.test.ts`; the viewer's touched test files; `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts`. Report `wc -l structure-viewer.ts` (608 before this task).

#### Part A: the viewer (core)

- [ ] **Step 1: Write the failing viewer tests**

In `packages/core/src/components/structure-viewer/structure-viewer.component.test.ts`, add inside `describe('protspace-structure-viewer resource links', …)` (after "the close button is named Close structure"):

```ts
  it('the body part wraps the viewer and the colour toolbar, and nothing of the header', async () => {
    const root = await mount();
    const body = root.querySelector<HTMLElement>('[part="body"]')!;
    expect(body).not.toBeNull();
    expect(body.querySelector('.viewer-container .viewer-content')).not.toBeNull();
    expect(body.querySelector('.color-toolbar')).not.toBeNull();
    // mount() keeps showTips at its default, true.
    expect(body.querySelector('.tips')).not.toBeNull();
    expect(body.contains(root.querySelector('[part="header"]'))).toBe(false);
    expect(body.contains(root.querySelector('[part="links"]'))).toBe(false);
  });
```

In `packages/core/src/components/structure-viewer/structure-viewer.prefetch.test.ts`, add a helper after `hover`:

```ts
const press = (plot: Element, pointerType: string) =>
  plot.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true }));
```

and these tests inside the `describe` (after "prefetches once, on the first hovered point"):

```ts
  it('a touch pointerdown on the plot prefetches Mol* once', () => {
    // Touch has no hover: the first finger on the plot is the earliest sign.
    press(plot, 'touch');
    expect(prefetchMolstar).toHaveBeenCalledTimes(1);
    press(plot, 'touch');
    hover(plot, 'P12345');
    expect(prefetchMolstar).toHaveBeenCalledTimes(1);
  });

  it('a mouse pointerdown prefetches nothing', () => {
    press(plot, 'mouse');
    expect(prefetchMolstar).not.toHaveBeenCalled();
  });
```

Also extend "stops listening when the viewer is removed" by one line after its `hover(plot, 'P12345');`: `press(plot, 'touch');` (the assertion that follows stays).

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/structure-viewer.component.test.ts src/components/structure-viewer/structure-viewer.prefetch.test.ts
```

Expected: the body-part test fails (`[part="body"]` is null) and "a touch pointerdown on the plot prefetches Mol* once" fails at its first `toHaveBeenCalledTimes(1)` (no listener for `pointerdown`, 0 calls). "a mouse pointerdown prefetches nothing" and the extended removal test already pass; they guard the mouse case and the cleanup after the change.

- [ ] **Step 3: Add the body part and the touch prefetch**

In `packages/core/src/components/structure-viewer/structure-viewer.ts`:

1. Replace the `_proteinHoverHandler` field and its doc comment with:

```ts
  /**
   * The first point the pointer rests on is the earliest sign the user may open a structure, and
   * it comes seconds before the click. Prefetching then (rather than on page load) keeps the
   * ~1.3 MB download off every visit that never reaches a structure. Touch has no hover: the first
   * finger on the plot is the sign there.
   */
  private _proteinHoverHandler: (e: Event) => void = (e: Event) => {
    if ((e as CustomEvent).detail?.proteinId == null) return;
    this._prefetchOnce();
  };

  private _plotPointerDownHandler: (e: Event) => void = (e: Event) => {
    if ((e as PointerEvent).pointerType !== 'touch') return;
    this._prefetchOnce();
  };

  /** Prefetches Mol* and stops listening for either sign. */
  private _prefetchOnce(): void {
    this._scatterplotElement?.removeEventListener('protein-hover', this._proteinHoverHandler);
    this._scatterplotElement?.removeEventListener('pointerdown', this._plotPointerDownHandler);
    prefetchMolstar();
  }
```

2. In `_setupAutoSync`, after `this._scatterplotElement.addEventListener('protein-hover', this._proteinHoverHandler);` add:

```ts
        this._scatterplotElement.addEventListener('pointerdown', this._plotPointerDownHandler);
```

3. In `disconnectedCallback`, after `this._scatterplotElement.removeEventListener('protein-hover', this._proteinHoverHandler);` add:

```ts
      this._scatterplotElement.removeEventListener('pointerdown', this._plotPointerDownHandler);
```

4. In `render()`, in the branch with a protein (the second `return html\``): insert `<div class="body" part="body">` on its own line immediately before the `<div class="viewer-container">` that follows `${renderResourceLinks(proteinId)}`/the header block, and a closing `</div>` after the tips block's final `: ''}` (the last expression before the template's closing backtick), so the wrapper holds `.viewer-container`, the `${!this._error ? html\`<div class="color-toolbar">…` block and the `${this.showTips && !this._error ? …}` block. Re-indent with Prettier. Add a comment line above the wrapper:

```ts
      <!-- Everything under the links: a host may hide it (the phone's folded sheet). -->
```

The empty-state branch (`if (!proteinId)`) is unchanged.

In `packages/core/src/components/structure-viewer/structure-viewer.styles.ts`, add after the `.tips strong { font-weight: 600; }` rule:

```css
  /* The body part only groups the rows for a host; it adds no box. */
  .body {
    display: contents;
  }
```

(The module stays in the style lint's `LEGACY` set: count 7. `display: contents` keeps `.color-toolbar:last-child` and every flex rule as they were, and `visibility: hidden` on the part still reaches its children, since visibility inherits.)

- [ ] **Step 4: Run the viewer tests and see them pass**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/
pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts
```

(browser run with the sandbox disabled). Expected: all green; report counts before and after. `wc -l packages/core/src/components/structure-viewer/structure-viewer.ts` (about 625).

- [ ] **Step 5: Document the part and the prefetch**

In `docs/developers/api/index.md`, Structure Viewer, "### Slots and parts" table, add a row after `links`:

```md
| `body` (part)           | Everything under the links: the 3D view, the colour toolbar and the tips. It adds no box (`display: contents`) |
```

and after the table (before "### Example") add:

```md
With `auto-sync`, the viewer prefetches Mol\* (about 1.3 MB) once, on the plot's first hovered
point or its first touch `pointerdown`, whichever comes first.
```

`pnpm exec prettier --write docs/developers/api/index.md`.

- [ ] **Step 6: Commit the core part**

```bash
pnpm exec prettier --check packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts packages/core/src/components/structure-viewer/structure-viewer.prefetch.test.ts docs/developers/api/index.md
git add packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts packages/core/src/components/structure-viewer/structure-viewer.prefetch.test.ts docs/developers/api/index.md
git commit -m "feat(core): body part and touch prefetch on the structure viewer"
```

(sandbox disabled for the hook.) Then `pnpm --filter @protspace/core build` so the app's type-check sees Task 5.7's `tapTooltips` and this part.

#### Part B: the sheet (web)

- [ ] **Step 7: Write the failing status tests**

In `apps/web/src/explore/workbench-status.test.ts`:

1. Add `setStructureSheet,` to the import list from `./workbench-status` (alphabetical, after `setWorkbenchStatus` is fine: `resetWorkbenchStatusForTests, setStructureSheet, setWorkbenchStatus, subscribeWorkbenchStatus`).
2. Every whole-status literal ends with `      datasetPhase: 'starting',` followed by `    });` (six of them: in "starts empty", "merges a patch and notifies once", and four in `createDatasetNamePublisher`). Replace every occurrence of

```ts
      datasetPhase: 'starting',
    });
```

with

```ts
      datasetPhase: 'starting',
      structureSheet: 'folded',
    });
```

(one Edit with `replace_all`; `grep -c "structureSheet: 'folded'," apps/web/src/explore/workbench-status.test.ts` then prints 6).
3. Add to `describe('workbench status', …)`, after the `datasetPhase` test:

```ts
  it('structureSheet starts folded; setStructureSheet notifies once per change', () => {
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setStructureSheet('expanded');
    expect(getWorkbenchStatus().structureSheet).toBe('expanded');
    expect(listener).toHaveBeenCalledOnce();
    setStructureSheet('expanded');
    expect(listener).toHaveBeenCalledOnce();
    setStructureSheet('folded');
    expect(listener).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 8: Write the failing controller tests**

In `apps/web/src/explore/structure-controller.test.ts`:

1. In `fakePlot()`, add `tapTooltips: true,` after the `tooltipActions` line.
2. Imports: add `setStructureSheet` to the `./workbench-status` import (`type LayoutMode` is already imported from `./layout-defaults`, Task 5.2).
3. Append this block at the end of the file. It uses Task 5.2's `setup({ mode })` and `fakeLayoutMode` from this file (`setup` returns `{ viewer, plot, layoutMode, controller }` and registers the controller for disposal; `layoutMode.set(next)` notifies only on a change of mode, which no case below relies on either way).

```ts
const OFFER = [{ id: 'view-structure', label: 'View structure' }];

function viewStructure(plot: ReturnType<typeof fakePlot>, proteinId: string) {
  plot.dispatchEvent(
    new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId } }),
  );
}

describe('createStructureController on phones and tablets', () => {
  it('phone, folded: the plot offers View structure and taps pin', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
    controller.request('P1');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('phone, expanded: no actions and tapTooltips false', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
    setStructureSheet('folded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('View structure on a phone requests the protein and expands the sheet, and never opens the sidebar', () => {
    const { viewer, plot } = setup({ mode: 'phone' });
    updateLayout({ sidebarOpen: false });
    viewStructure(plot, 'P2');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P2');
    expect(getWorkbenchStatus()).toMatchObject({
      structureProteinId: 'P2',
      structureSheet: 'expanded',
    });
    expect(getLayout().sidebarOpen).toBe(false);
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
  });

  it('close resets the sheet to folded', () => {
    const { viewer, plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    viewer.close();
    expect(getWorkbenchStatus()).toMatchObject({ structureProteinId: null, structureSheet: 'folded' });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('a new protein after none opens folded', () => {
    const { controller } = setup({ mode: 'phone' });
    // A state left from before (the sheet cannot show with no protein) still starts over.
    setStructureSheet('expanded');
    controller.request('P1');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    controller.clear();
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
  });

  it('a second protein keeps the sheet as it is', () => {
    const { controller } = setup({ mode: 'phone' });
    controller.request('P1');
    controller.request('P2');
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    setStructureSheet('expanded');
    // A tap above the expanded sheet selects a protein, which shows in it.
    controller.select(['P3']);
    expect(getWorkbenchStatus()).toMatchObject({
      structureProteinId: 'P3',
      structureSheet: 'expanded',
    });
  });

  it('landscape follows the same sheet rule', () => {
    const { plot, controller } = setup({ mode: 'landscape' });
    expect(plot.tooltipActions).toEqual(OFFER);
    controller.request('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
  });

  it('tablet offers nothing and taps pin', () => {
    const { viewer, plot, controller } = setup({ mode: 'tablet' });
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
    controller.request('P1');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
  });

  it("a mode change applies the new mode's rule", () => {
    const { plot, controller, layoutMode } = setup({ mode: 'phone' });
    controller.request('P1');
    setStructureSheet('expanded');
    layoutMode.set('tablet');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(true);
    layoutMode.set('landscape');
    expect(plot.tooltipActions).toEqual([]);
    expect(plot.tapTooltips).toBe(false);
    layoutMode.set('desktop');
    expect(plot.tapTooltips).toBe(true);
  });

  it('desktop keeps taps pinning', () => {
    const { plot } = setup({ mode: 'desktop' });
    expect(plot.tapTooltips).toBe(true);
    updateLayout({ sidebarOpen: false });
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });

  it('dispose stops following the sheet', () => {
    const { plot, controller } = setup({ mode: 'phone' });
    controller.request('P1');
    controller.dispose();
    setStructureSheet('expanded');
    expect(plot.tooltipActions).toEqual(OFFER);
    expect(plot.tapTooltips).toBe(true);
  });
});
```

- [ ] **Step 9: Run them and see them fail**

```bash
pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts src/explore/structure-controller.test.ts
```

Expected: every whole-status comparison fails (no `structureSheet` field) and the new status test fails (`setStructureSheet` is not exported: the import is `undefined`, a TypeError on call). In the controller file the new block fails: `setStructureSheet` is not a function, the phone modes offer nothing (`tooltipActions` stays `[]`), `tapTooltips` is never written. The existing cases stay green (the `tapTooltips: true` added to `fakePlot` changes nothing they assert).

- [ ] **Step 10: Remove this task's fixmes and add the new phone tests; run red**

```bash
grep -n "fixme(true, 'task 5.8')" apps/web/tests/mobile-plot-touch.spec.ts apps/web/tests/mobile-explore-layout.spec.ts
```

Expect P4 and P5 in `mobile-plot-touch.spec.ts` and L2 in `mobile-explore-layout.spec.ts`. Delete those three `test.fixme(true, 'task 5.8');` lines.

L2: delete its fixme only; its body already measures the folded strip's top at `vh − 56` and then the expanded box on the bottom edge (Task 5.1). P4's "the sheet's top ≥ the plot's bottom − 1" and P5's height and top checks hold for the transformed box as written, so P4 and P5 keep their 5.1 bodies too.

Task 5.1's helpers are used as they are: `structureSheet(page)` is `page.locator('[data-workbench="structure"]')` and `sheetToggle(page)` is the role button `/^(Show|Hide) the structure$/` inside it (the chevron is a light-DOM child of the viewer, so it is a descendant of the section).

Append to `apps/web/tests/mobile-plot-touch.spec.ts` (add `type Page` to its `@playwright/test` import; `watchPlotResizes` and `seedLayout` from `./helpers/workbench`, `legend` from `./helpers/legend`, `selectionBarAction` from `./helpers/explore`, and `openExplorePhone`, `proteinNear`, `tap`, `structureSheet`, `sheetToggle`, `panelTab`, `box`, `overlaps` from `./helpers/mobile`, each only if not imported yet). This describe runs at the project's 412×839:

```ts
/** Two frames: a ResizeObserver has reported whatever the last change did. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

test.describe('structure sheet', () => {
  test('folding and expanding the sheet never resizes the plot', async ({ page }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    const resizes = await watchPlotResizes(page);

    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'expanded');
    await expect(sheetToggle(page)).toHaveAccessibleName('Hide the structure');
    await sheetToggle(page).tap();
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await settle(page);
    expect(await resizes()).toBe(0);
  });

  test('the last legend row can be scrolled above the folded sheet', async ({ page }) => {
    await openExplorePhone(page);
    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(page.locator('.workbench')).toHaveAttribute('data-sheet', 'folded');

    const last = legend(page).locator('.legend-item').last();
    await last.scrollIntoViewIfNeeded();
    const row = await box(last);
    const sheet = await box(structureSheet(page));
    expect(row.y + row.height).toBeLessThanOrEqual(sheet.y + 1);
  });

  test('with the panel folded, a structure opening resizes the plot once and the tabs stay visible', async ({
    page,
    context,
  }) => {
    await seedLayout(page, { panelFolded: true });
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await expect(root).toHaveAttribute('data-panel-folded');
    const resizes = await watchPlotResizes(page);

    await tap(page, await proteinNear(page, 0.5, 0.4));
    await expect(root).toHaveAttribute('data-sheet', 'folded');
    await expect.poll(resizes).toBe(1);
    await settle(page);
    expect(await resizes()).toBe(1);

    const sheet = await box(structureSheet(page));
    for (const name of ['Legend', 'Filter'] as const) {
      const tab = await box(panelTab(page, name));
      expect(overlaps(tab, sheet)).toBe(false);
      expect(tab.y + tab.height).toBeLessThanOrEqual(sheet.y + 1);
    }

    // A toast stands above the folded panel and the sheet (--wb-panel-height carries the 56 px).
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await selectionBarAction(page, 'Copy IDs').tap();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /^Copied/ });
    await expect(toast).toBeVisible();
    await expect
      .poll(async () => {
        const shown = await box(toast);
        return shown.y + shown.height;
      })
      .toBeLessThanOrEqual(sheet.y - 12 + 1);
  });
});
```

Run:

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts
```

Expected red: P4 (`data-sheet` is never set), P5 (no "Show the structure" button), and the three new tests (no `data-sheet`). P1–P3 stay green (Task 5.7).

- [ ] **Step 11: Add the sheet state to the workbench status**

In `apps/web/src/explore/workbench-status.ts`:

1. After `type DatasetPhase = …;` add:

```ts
/** The phone structure sheet: folded to its header, or expanded over the lower half. */
type StructureSheet = 'folded' | 'expanded';
```

2. In `interface WorkbenchStatus`, after `datasetPhase: DatasetPhase;` add:

```ts
  /**
   * The structure sheet on phones (design decision 17). The structure controller folds it when a
   * structure appears and when it closes; the shell expands and folds it (setStructureSheet).
   */
  structureSheet: StructureSheet;
```

3. In `EMPTY`, after `datasetPhase: 'starting',` add `structureSheet: 'folded',`.

4. After `setWorkbenchStatus`, add:

```ts
/** The shell's one write to the status: the sheet's chevron, grip and header fold and expand it. */
export function setStructureSheet(state: StructureSheet): void {
  setWorkbenchStatus({ structureSheet: state });
}
```

5. Update the interface's doc comment: replace `Transient facts the explore runtime publishes for the React shell, which never reads them off the runtime's elements. Nothing here is persisted.` with `Transient facts the explore runtime publishes for the React shell, which never reads them off the runtime's elements; the shell writes only the structure sheet. Nothing here is persisted.`

- [ ] **Step 12: Apply the sheet rule in the structure controller**

In `apps/web/src/explore/structure-controller.ts` (after Task 5.2 the controller takes `layoutMode: LayoutModeSource`; anchors are function names):

1. Imports: replace `import { setWorkbenchStatus } from './workbench-status';` with

```ts
import { hasStructureSheet } from './layout-mode';
import {
  getWorkbenchStatus,
  setStructureSheet,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';
```

(keep 5.2's `import type { LayoutModeSource } from './layout-mode';`, or merge it into this import as `import { hasStructureSheet, type LayoutModeSource } from './layout-mode';`).

2. In `StructureControllerOptions`, the `plotElement` type becomes:

```ts
  /** The plot whose pinned tooltip offers "View structure", and whose taps pin a tooltip. */
  plotElement: Pick<
    ProtspaceScatterplot,
    'tooltipActions' | 'tapTooltips' | 'addEventListener' | 'removeEventListener'
  >;
```

3. Replace the `publish` constant with:

```ts
  // A structure that appears from none opens folded on phones (decision 17), so the plot and the
  // tooltip stay in view; closing starts over, so the next one opens folded too.
  const publish = (proteinId: string | null) => {
    const appears = proteinId !== null && getWorkbenchStatus().structureProteinId === null;
    setWorkbenchStatus(
      proteinId === null || appears
        ? { structureProteinId: proteinId, structureSheet: 'folded' }
        : { structureProteinId: proteinId },
    );
  };
```

4. Replace `offerViewStructure` and its comment with:

```ts
  // What a pinned tooltip offers and whether a tap pins one (design decisions 2 and 17). Desktop:
  // "View structure" only where a click cannot show the structure, docked in a collapsed sidebar.
  // Tablet: nothing, its structure is always in view; a tap still pins, to read a protein. Phone
  // and landscape: "View structure" expands the folded sheet; while the sheet is up a tap pins
  // nothing, so no tooltip opens under it (expanding also ends a pin: tapTooltips turns false).
  const offerViewStructure = () => {
    const mode = layoutMode.get();
    const layout = getLayout();
    const { structureSheet, structureProteinId } = getWorkbenchStatus();
    const sheet = hasStructureSheet(mode);
    const sheetUp = sheet && structureSheet === 'expanded' && structureProteinId !== null;
    const offer =
      mode === 'desktop'
        ? layout.structurePlacement === 'docked' && !layout.sidebarOpen
        : sheet && !sheetUp;
    if (offer !== plotElement.tooltipActions.length > 0) {
      plotElement.tooltipActions = offer ? [VIEW_STRUCTURE] : [];
    }
    if (plotElement.tapTooltips === sheetUp) plotElement.tapTooltips = !sheetUp;
  };
```

(If 5.2 wrote the desktop test as `layoutMode.get() === 'desktop'` inline, this replaces it; the desktop branch is unchanged.)

5. Replace `onTooltipAction` with:

```ts
  const onTooltipAction = (event: Event) => {
    const { id, proteinId } = (event as CustomEvent<TooltipActionDetail>).detail;
    if (id !== VIEW_STRUCTURE.id) return;
    // The focused button goes with its tooltip; focus what it opened instead of leaving <body>.
    const focused =
      typeof document !== 'undefined' && document.activeElement === event.currentTarget;
    request(proteinId);
    // A phone expands its sheet; elsewhere the sidebar opens, which loads a waiting protein.
    if (hasStructureSheet(layoutMode.get())) setStructureSheet('expanded');
    else updateLayout({ sidebarOpen: true });
    // A frame on, the sheet or the sidebar has rendered and the section is no longer inert.
    if (focused) {
      requestAnimationFrame(() =>
        viewer.closest<HTMLElement>('[data-workbench="structure"]')?.focus(),
      );
    }
  };
```

6. After the existing `const unsubscribe = subscribeLayout(onLayoutChange);` (and 5.2's mode subscription, which stays) add:

```ts
  // The sheet's state, which the shell writes, and the shown protein change the offer.
  const unsubscribeStatus = subscribeWorkbenchStatus(offerViewStructure);
```

7. In `dispose()`, after `unsubscribe();` add `unsubscribeStatus();`.

8. Update the controller's doc comment (above `createStructureController`) by appending: `On phones the structure is a sheet: it opens folded and "View structure" expands it (decision 17).`

- [ ] **Step 13: Run the unit tests and see them pass**

```bash
pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts src/explore/structure-controller.test.ts
```

Expected: all green, including the desktop cases ("offers View structure only while docked and collapsed on desktop", "View structure opens the sidebar, …"). Report counts before and after.

- [ ] **Step 14: The chevron, the grip and the header toggle**

In `apps/web/src/workbench/StructurePanel.tsx`:

1. Imports: `import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type Ref } from 'react';` and add `import { setStructureSheet } from '../explore/workbench-status';`.

2. Add before `interface StructurePanelProps`:

```tsx
/** The viewer's controls and the resource links: a click there is theirs, never a sheet toggle. */
const SHEET_CONTROLS = 'button, a, input, [role="button"], [role^="menuitem"], ps-menu';

/**
 * Whether a click on the section toggles the sheet: one on the grip or on the viewer's header row
 * (its `header` part), not on one of the header's controls.
 */
function togglesSheet(event: MouseEvent<HTMLElement>): boolean {
  let onHandle = false;
  for (const node of event.nativeEvent.composedPath()) {
    if (node === event.currentTarget) break;
    if (!(node instanceof Element)) continue;
    if (node.matches(SHEET_CONTROLS)) return false;
    if (node.classList.contains('wb-sheet-grip') || node.getAttribute('part') === 'header') {
      onHandle = true;
    }
  }
  return onHandle;
}
```

3. In `StructurePanelProps`, add after `canFloat: boolean;`:

```tsx
  /** Phones (portrait and landscape): the section is the structure sheet (design decision 17). */
  sheet: boolean;
  /** The sheet is expanded (the workbench status's structureSheet). */
  sheetExpanded: boolean;
```

4. Add `sheet,` and `sheetExpanded,` to the destructured props of `StructurePanel`, and before `return (` add:

```tsx
  const toggleSheet = () => setStructureSheet(sheetExpanded ? 'folded' : 'expanded');
```

5. On the `<section>`, add after `aria-describedby={…}`:

```tsx
      // The grip and the header row fold and expand the sheet, as its chevron does.
      onClick={
        sheet
          ? (event) => {
              if (togglesSheet(event)) toggleSheet();
            }
          : undefined
      }
```

6. After the `.wb-structure-empty` div and before `<protspace-structure-viewer`, add:

```tsx
      {/* The sheet's handle. Always rendered, shown by CSS in sheet modes only, so nothing is
          inserted beside the viewer when the mode changes. */}
      <div className="wb-sheet-grip" aria-hidden="true" />
```

7. Inside `<protspace-structure-viewer …>`, before the `{canFloat && (…)}` block, add:

```tsx
        {sheet && (
          <ps-icon-button
            slot="header-actions"
            size="sm"
            icon={sheetExpanded ? 'chevron-down' : 'chevron-up'}
            label={sheetExpanded ? 'Hide the structure' : 'Show the structure'}
            expanded={sheetExpanded ? 'true' : 'false'}
            onClick={toggleSheet}
          ></ps-icon-button>
        )}
```

8. Extend the component's doc comment by one sentence at its end: `On phones the section is the structure sheet: its chevron, grip and header row fold and expand it (the workbench status), and CSS moves it by transform.`

- [ ] **Step 15: `data-sheet` on the workbench**

In `apps/web/src/workbench/Workbench.tsx`:

1. Add `import { hasStructureSheet } from '../explore/layout-mode';` (after the `../explore/layout-state` import).
2. Add `structureSheet` to the `useWorkbenchStatus()` destructuring (`const { structureProteinId, appliedFilterConditions, datasetPhase, structureSheet } = useWorkbenchStatus();`, keeping any field earlier tasks added).
3. After `const structure = structureProteinId === null ? 'none' : placement;` add:

```tsx
  // Phones show the structure as a sheet at the bottom edge, folded or expanded (decision 17).
  const sheet = hasStructureSheet(mode);
```

4. On the root `div.workbench`, add after the `data-panel-folded` attribute (Task 5.6; else after `data-panel={layout.panel}`):

```tsx
      data-sheet={sheet && structure !== 'none' ? structureSheet : undefined}
```

5. On `<StructurePanel …>`, add after `canFloat={desktop}`:

```tsx
          sheet={sheet}
          sheetExpanded={structureSheet === 'expanded'}
```

- [ ] **Step 16: The sheet's CSS**

In `apps/web/src/workbench/workbench.css`:

1. Find Task 5.6's interim phone structure rules: `grep -n "data-layout='phone'.*wb-structure\|--wb-structure-row" apps/web/src/workbench/workbench.css`. Task 5.6 wrote, in its "Phone body" section: the `--wb-structure-row: 0px;` declaration in the `.workbench[data-layout='phone'] { … }` root rule; the rule `.workbench[data-layout='phone']:not([data-structure='none']) { --wb-structure-row: 240px; }` with its "Until the structure sheet (Task 5.8)" comment; `.workbench[data-layout='phone'] .wb-structure { grid-area: struct; position: static; height: var(--wb-structure-row); … }`; and `.workbench[data-layout='phone'][data-structure='none'] .wb-structure { display: none; }`. Delete all four (the section below brings its own `none` rule), and drop the words about `--wb-structure-row` from the section's opening comment. Then in 5.6's two phone toast rules (`[data-sonner-toaster][data-y-position='bottom']`) remove `var(--wb-structure-row) + `, so they read `bottom: calc(var(--wb-panel-height) + 12px)` and `bottom: calc(var(--wb-panel-height) + 62px)`: the sheet is fixed over the panel now, and its folded reserve goes into `--wb-panel-height` (the last rule below), so the toasts stay above the panel and the folded sheet. `grep -n "wb-structure-row" apps/web/src/workbench/workbench.css` must then print nothing.

2. Add this section after the "Sidebar column" structure rules (after `.workbench #myStructureViewer::part(links) { … }`, before "── Rail, collapse and the sidebar edge"):

```css
/* ── Structure sheet on phones (Task 5.8, design decision 17) ───────────────
   The structure rises from the bottom edge, folded to its grip and header (56 px) so the plot and
   a pinned tooltip stay in view; expanded it takes half the screen at most. It folds by transform,
   never by height or display: the viewer keeps its box, so Mol* never draws into an empty canvas
   and a fold costs no resize, and the plot's box never changes (decision 4). The transform sits on
   .wb-structure, no ancestor of the legend or the bars. Landscape places it in Task 5.9. */
.workbench:is([data-layout='phone'], [data-layout='landscape']) {
  --wb-sheet-folded: 56px;
}

.wb-sheet-grip {
  display: none;
}

.workbench:is([data-layout='phone'], [data-layout='landscape']) .wb-sheet-grip {
  display: grid;
  flex: none;
  place-items: center;
  height: 12px;
  cursor: pointer;
}

.wb-sheet-grip::before {
  content: '';
  width: 36px;
  height: 4px;
  border-radius: var(--ps-radius-full);
  background: var(--ps-border-strong);
}

/* Folded, only the grip and the header are on screen: the rest leaves the Tab order and the
   accessibility tree, with no change to the viewer's box. */
.workbench:is([data-layout='phone'], [data-layout='landscape'])[data-sheet='folded']
  #myStructureViewer::part(body),
.workbench:is([data-layout='phone'], [data-layout='landscape'])[data-sheet='folded']
  #myStructureViewer::part(links) {
  visibility: hidden;
}

/* Over the plot and the panel, under the kit's top layer and the toasts. No border: the folded
   56 px are exactly the grip and the header. */
.workbench[data-layout='phone'] .wb-structure {
  position: fixed;
  inset: auto 0 0;
  z-index: 6;
  height: min(50svh, 416px);
  padding-bottom: env(safe-area-inset-bottom);
  border: 0;
  border-radius: var(--ps-radius-lg) var(--ps-radius-lg) 0 0;
  box-shadow: var(--ps-shadow-lg);
  transform: translateY(calc(100% - var(--wb-sheet-folded)));
  transition: transform var(--ps-duration) var(--ps-ease);
}

.workbench[data-layout='phone'][data-structure='none'] .wb-structure {
  display: none;
}

.workbench[data-layout='phone'][data-sheet='expanded'] .wb-structure {
  transform: none;
}

/* The folded sheet covers the panel's last 56 px, so the panel keeps them free: the tabs and the
   last rows stay reachable. Unfolded that is padding inside the same height (no plot resize);
   folded the panel grows by the sheet's height, one plot resize. */
.workbench[data-layout='phone'] #wb-sidebar {
  box-sizing: border-box;
}

.workbench[data-layout='phone']:not([data-structure='none']) #wb-sidebar {
  padding-bottom: var(--wb-sheet-folded);
}

/* Folded with a structure: the header and the sheet's 56 px. Through the variable, so the toasts
   (Task 5.6) stay above the folded sheet; 5.6's #wb-sidebar { height: var(--wb-panel-height) }
   applies it. */
.workbench[data-layout='phone'][data-panel-folded]:not([data-structure='none']) {
  --wb-panel-height: calc(45px + var(--wb-sheet-folded));
}
```

Task 5.6 already sets `box-sizing: border-box` on the phone `#wb-sidebar` and folds it to `45px` including its 1 px top border (Tailwind's preflight makes every element border-box anyway). The `prefers-reduced-motion` block already lists `.wb-structure` with `transition-property: none`, so the sheet does not slide under reduced motion; nothing to add there.

- [ ] **Step 17: Run the phone spec green**

```bash
pnpm --filter @protspace/core build
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-plot-touch.spec.ts
```

Expected: P1–P5 and the three new tests pass; the remaining P tests are skipped by their own fixmes (5.6, 5.9, 5.10, 5.12). If "the last legend row can be scrolled above the folded sheet" fails by a few pixels, check that the legend fills `#wb-sidebar`'s content box (Task 5.6's `#myLegend` rule must use `height: 100%` or `flex: 1 1 0` of the sidebar, not a fixed height): the padding must shorten the legend, not push it out.

- [ ] **Step 18: Checks and commit the web part**

```bash
pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts src/explore/structure-controller.test.ts
pnpm exec prettier --check apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-plot-touch.spec.ts apps/web/tests/mobile-explore-layout.spec.ts
git add apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/tests/helpers/mobile.ts apps/web/tests/mobile-plot-touch.spec.ts apps/web/tests/mobile-explore-layout.spec.ts
git commit -m "feat(web): structure bottom sheet that opens folded on phones"
```

(`helpers/mobile.ts` only if Step 10 changed it; sandbox disabled for the hook.) Report: counts of the files run before and after, LEGACY 7, `wc -l structure-viewer.ts`, and under "Unrun at task time" `workbench-structure.spec.ts`, `workbench-escape.spec.ts` and `mobile-explore-layout.spec.ts` (L2).

### Task 5.9: Landscape phone layout

A phone on its side (landscape, ≤ 500 px tall, ≤ 950 px wide) gets one combined 44 px bar, then a body exactly one screen tall with the plot on the left and the legend column on the right; the page scrolls once past the bar. The structure folds into the legend column and expands over the right half. The More sheet fits the short screen and scrolls inside.

**Files:**

- Modify: `apps/web/src/workbench/workbench.css` (landscape block: root, bars, body, sidebar, structure), `Workbench.tsx` only if a measurement is needed (prefer none) — none is needed: this task changes no TSX
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts` only if P10 needs more than 5.10's rule — not touched: P10's fixme is relabelled `'task 5.10'` (see Tests)
- Modify: `apps/web/tests/mobile-explore-layout.spec.ts` (L4; new rotation test), `mobile-bars.spec.ts` (C8, C9; new bar test; C9b), `mobile-plot-touch.spec.ts` (P9; P10 relabelled) — fixmes removed

**Interfaces:**

- Consumes: `data-layout='landscape'` (5.2); phone bar rules and search toggle (5.4: `.wb-search-toggle` and `.wb-search-close` shown at `data-layout='phone'` only, so this task adds landscape; the `trigger` CSS part on `#myImportMenu` and `#myExportMenu` and the 0×0 `[data-workbench='app-bar-actions']` pattern: never `display: none` on `#myImportMenu`, `#myExportMenu` or an ancestor of them, because a popover inside a `display: none` subtree never renders; the app bar's `data-search-open`, the "Close search" button inside `[data-workbench='app-bar-center']`, `useViewBarStage` returning stage 3 in sheet modes, the coarse 40 px bar targets); More sheet (5.5, `ps-dialog size="sheet"`, already used in landscape because it is a sheet mode); the sheet state, chevron, grip, `data-sheet`, `part(body)`, `--wb-sheet-folded` and the folded `::part(body)`/`::part(links)` rule, all keyed on both sheet modes (5.8); the tablet grid (5.3: `.wb-body` grid with areas `plot`, `side`, `struct`; `#wb-sidebar` static; `.wb-structure` static with top and left borders); helpers `openExplorePhone`, `box`, `expectNoHorizontalOverflow`, `searchToggle` (`helpers/mobile.ts`), `appBar`, `viewBar` (`helpers/explore.ts`), `watchPlotResizes` (`helpers/workbench.ts`).
- Produces (CSS only, `.workbench[data-layout='landscape']`):
  - Root: `min-height: 100dvh`, page scrolls (no `overflow: hidden`, no fixed height), `position: relative` (the search overlay's containing block), a grid of two rows: row 1 is one 44 px bar formed by the app bar and the view bar side by side (`grid-template-columns: auto minmax(0, 1fr)`; app bar shows wordmark, dataset, search toggle, with the actions kept rendered at 0×0 and only the menus' `trigger` parts hidden, as on phones; view bar shows Projection, details, Color by, More; both 44 px, no bottom border between them, one bottom border under the row — their two bottom borders line up); row 2 is `.wb-body` with `height: 100dvh` (exactly one screen), spanning both columns.
  - The search overlay (5.4's search toggle) covers the whole 44 px row in landscape, not only the narrow app bar: `[data-workbench='app-bar-center']` is `position: absolute` against the root, `inset: 0 0 auto`, `z-index: 1` (over the view bar's positioned More button).
  - Body: grid columns `minmax(0, 1fr) minmax(192px, 32%)`, rows `minmax(0, 1fr) auto`, areas `'plot side' 'plot struct'`; plot left over both rows; `#wb-sidebar` right column, left border, no top border; the legend header shows the tabs, no fold chevron (fold is phone-only, 5.6's CSS).
  - Structure: folded (`data-sheet='folded'`) sits as a 56 px row (grip 12 + header 44) at the bottom of the right column (static, under the legend; the legend's height shrinks by it) with the body part and links hidden (5.8's rule); expanded is `position: absolute` against `.wb-body` (`grid-area: auto; top: 0; right: 0; bottom: 0; width: 50vw; z-index: 6`, so it never covers the bar) with the header, links and Mol* (a Mol* resize on toggle is accepted here; the plot box never changes, because the plot spans both rows and only the right column's rows change). With no structure the right column is the legend alone.
  - The More sheet uses `size="sheet"` as on phones (its max-height rule already fits 360 px).

**Tests:**

- `mobile-explore-layout.spec.ts` L4 green; new "rotating from 412×839 to 839×412 and back keeps the same runtime elements and resizes the plot once per rotation".
- `mobile-bars.spec.ts` C8, C9 green (fixmes removed); new "the landscape bar is one 44 px row with search before Projection in Tab order" (it also opens and closes the search overlay over the whole row); new "C9b: in landscape, Export in the More sheet and the dataset name open their menus on screen" (pins the popover-in-a-hidden-ancestor trap).
- `mobile-plot-touch.spec.ts` P9 green (fixme removed). P10: the projection details card needs 5.10's max-height rule to fit a 360 px plot and scroll, so its fixme is relabelled `'task 5.10'` now rather than run (5.10's file list already takes "P10 if 5.9 relabelled it").
- Unrun at task time (exit): `workbench-loading.spec.ts:227` (1024×420 stays desktop); this task's C8, C9, C9b, the new bar test (`mobile-bars.spec.ts`) and P9 (`mobile-plot-touch.spec.ts`), since the one e2e run per task is `mobile-explore-layout.spec.ts`.

Verification: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts`. No unit or browser test file covers this CSS; the task runs none.

- [ ] **Step 1: Remove this task's fixmes and add the new tests**

```bash
grep -n "fixme(true, 'task 5.9')" apps/web/tests/mobile-*.spec.ts
```

Expect L4 (`mobile-explore-layout.spec.ts`), C8 and C9 (`mobile-bars.spec.ts`), P9 and P10 (`mobile-plot-touch.spec.ts`). Delete the `test.fixme(true, 'task 5.9');` lines of L4, C8, C9 and P9. In P10 change that line to `test.fixme(true, 'task 5.10');`.

Append to `apps/web/tests/mobile-explore-layout.spec.ts` (import `watchPlotResizes` from `./helpers/workbench` and `openExplorePhone` from `./helpers/mobile` if the file lacks them; add `type Page` to the `@playwright/test` import if the file does not have it):

```ts
/** The runtime's elements: rendered once, never re-created or moved (Review Focus 1). */
const RUNTIME_IDS = [
  'myPlot',
  'myLegend',
  'myStructureViewer',
  'myImportMenu',
  'myExportMenu',
  'myProteinSearch',
  'myQueryBuilder',
];

/** Two frames: a ResizeObserver has reported whatever the last change did. */
const settleFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

test('rotating from 412×839 to 839×412 and back keeps the same runtime elements and resizes the plot once per rotation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await openExplorePhone(page);
  const root = page.locator('.workbench');
  await expect(root).toHaveAttribute('data-layout', 'phone');
  await page.evaluate((ids) => {
    (window as unknown as { __runtimeElements: (Element | null)[] }).__runtimeElements = ids.map(
      (id) => document.getElementById(id),
    );
  }, RUNTIME_IDS);

  const turns = [
    { size: { width: 839, height: 412 }, mode: 'landscape' },
    { size: { width: 412, height: 839 }, mode: 'phone' },
  ];
  for (const { size, mode } of turns) {
    const resizes = await watchPlotResizes(page);
    await page.setViewportSize(size);
    await expect(root).toHaveAttribute('data-layout', mode);
    await expect.poll(resizes).toBe(1);
    await settleFrames(page);
    expect(await resizes()).toBe(1);
  }

  const same = await page.evaluate((ids) => {
    const before = (window as unknown as { __runtimeElements: (Element | null)[] })
      .__runtimeElements;
    return ids.map((id, index) => before[index] !== null && document.getElementById(id) === before[index]);
  }, RUNTIME_IDS);
  expect(same).toEqual(RUNTIME_IDS.map(() => true));
});
```

(If 5.2's `mobile-shell.spec.ts` exports nothing and this file already declares a `RUNTIME_IDS` or a frame helper under another name, reuse it instead of declaring a second one.)

Append to `apps/web/tests/mobile-bars.spec.ts`, next to C8 (import `appBar`, `viewBar`, `searchInput`, `datasetSwitcher`, `importMenu` from `./helpers/explore` and `openExplorePhone`, `box`, `expectNoHorizontalOverflow`, `expectWithinViewport`, `moreSheet`, `searchToggle` from `./helpers/mobile`, each only if missing; the file's own `openMoreSheet` and `exportMenuList` from Task 5.1 are reused). Each test sets its own size, so they may sit inside or outside C8's describe:

```ts
test('the landscape bar is one 44 px row with search before Projection in Tab order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await openExplorePhone(page);
  await expect(page.locator('.workbench')).toHaveAttribute('data-layout', 'landscape');

  const app = await box(appBar(page));
  const view = await box(viewBar(page));
  for (const bar of [app, view]) {
    expect(Math.abs(bar.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(bar.height - 44)).toBeLessThanOrEqual(1);
  }
  // Side by side: the app bar ends where the view bar starts, and the row fits the screen.
  expect(app.x + app.width).toBeLessThanOrEqual(view.x + 1);
  expect(view.x + view.width).toBeLessThanOrEqual(740 + 1);
  await expectNoHorizontalOverflow(page);

  // DOM order is visual order: the search button, then the view bar's first control.
  await expect(searchToggle(page)).toBeVisible();
  await searchToggle(page).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('myProjectionSelect');

  // The search overlay covers the whole row; Close search ends it and returns focus.
  await searchToggle(page).tap();
  await expect(appBar(page)).toHaveAttribute('data-search-open', '');
  await expect(searchInput(page)).toBeFocused();
  const overlay = await box(appBar(page).locator('[data-workbench="app-bar-center"]'));
  expect(Math.abs(overlay.width - 740)).toBeLessThanOrEqual(1);
  await appBar(page).getByRole('button', { name: 'Close search', exact: true }).tap();
  await expect(searchToggle(page)).toBeFocused();
});

test('C9b: in landscape, Export in the More sheet and the dataset name open their menus on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await openExplorePhone(page);
  await expect(page.locator('.workbench')).toHaveAttribute('data-layout', 'landscape');

  // A popover inside a display: none ancestor never renders: these would open as 0×0 boxes.
  const rows = await openMoreSheet(page);
  await rows.getByRole('button', { name: /^Export/ }).tap();
  await expect(moreSheet(page)).toBeHidden();
  await expect(exportMenuList(page)).toBeVisible();
  await expectWithinViewport(page, exportMenuList(page));
  await page.keyboard.press('Escape');
  await expect(exportMenuList(page)).toBeHidden();

  await datasetSwitcher(page).tap();
  const importPanel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
  await expect(importPanel).toBeVisible();
  await expectWithinViewport(page, importPanel);
});
```

(`searchInput` is `protspace-protein-search #protein-search-input`; the Import panel is the `ps-popover` with `panel-label="Import"`, `import-menu.ts:106`.)

- [ ] **Step 2: Run the layout spec and see it fail**

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts
```

Expected: L4 fails (landscape still uses the tablet's fixed screen: the bars are two rows above a plot of 3/5 of the remaining height, so the plot is under 0.6 × 360 and the legend sits under it, not beside it). The rotation test may already pass (the tablet CSS resizes the plot once per turn too); it guards this task's grid. The other tests in the file stay as they were (L1–L3 green from 5.3/5.6/5.8).

- [ ] **Step 3: The landscape block**

In `apps/web/src/workbench/workbench.css`, append a new section after the "Structure sheet on phones (Task 5.8)" section (it must come after Task 5.3's tablet rules and 5.8's sheet rules: several selectors below tie with theirs on specificity and win by order):

```css
/* ── Phone on its side (Task 5.9, design decision 17, mockup frame 7) ───────
   A landscape phone (≤ 500 px tall, ≤ 950 px wide) has one 44 px bar: the app bar and the view
   bar side by side, in DOM and Tab order. Below it the body is exactly one screen tall, so the page
   scrolls once, past the bar, to the plot beside the legend column. */
.workbench[data-layout='landscape'] {
  --wb-app-bar-height: 44px;
  --wb-view-bar-height: 44px;
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: var(--wb-app-bar-height) 100dvh;
  height: auto;
  min-height: 100dvh;
  overflow: visible;
}

/* The app bar holds the wordmark, the dataset and the search button; Import, Export, Help and
   the count are in the More sheet or the dataset's label. */
.workbench[data-layout='landscape'] header[data-workbench='app-bar'] {
  grid-column: 1;
  grid-row: 1;
  position: static;
  display: flex;
  align-items: center;
  gap: var(--ps-space-1);
  min-width: 0;
  padding: 0 var(--ps-space-1) 0 var(--ps-space-3);
}

/* As on phones (Task 5.4): the actions leave the bar but stay rendered, because a popover inside
   a display: none ancestor never shows. The dataset name opens Import, the More sheet Export. */
.workbench[data-layout='landscape'] [data-workbench='app-bar-actions'] {
  position: absolute;
  width: 0;
  height: 0;
}

.workbench[data-layout='landscape'] [data-workbench='app-bar-actions'] > :not(.wb-data-actions),
.workbench[data-layout='landscape'] #myImportMenu::part(trigger),
.workbench[data-layout='landscape'] #myExportMenu::part(trigger),
.workbench[data-layout='landscape'] .wb-dataset-count {
  display: none;
}

/* The search button opens search over the whole row; Close search ends it (Task 5.4's controls). */
.workbench[data-layout='landscape'] :is(.wb-search-toggle, .wb-search-close) {
  display: inline-flex;
}

.workbench[data-layout='landscape'] header[data-search-open] #myProteinSearch {
  flex: 1 1 auto;
  min-width: 0;
}

.workbench[data-layout='landscape'] .wb-dataset-name {
  max-width: 16vw;
}

/* Search opens over the whole row, wordmark to More; the root is its containing block. Its
   z-index lifts it over the view bar's positioned More button. */
.workbench[data-layout='landscape'] header:not([data-search-open]) [data-workbench='app-bar-center'] {
  display: none;
}

.workbench[data-layout='landscape'] header[data-search-open] [data-workbench='app-bar-center'] {
  position: absolute;
  inset: 0 0 auto;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--ps-space-2);
  height: var(--wb-app-bar-height);
  padding: 0 var(--ps-space-1) 0 var(--ps-space-3);
  border-bottom: 1px solid var(--ps-border);
  background: var(--ps-surface);
}

/* The view bar holds Projection, its details, Color by and More (stage 3: Contours and Filter are
   in More); it never wraps, and the pickers give up width first. */
.workbench[data-layout='landscape'] [data-workbench='view-bar'] {
  grid-column: 2;
  grid-row: 1;
  flex-wrap: nowrap;
  height: var(--wb-view-bar-height);
  min-width: 0;
  padding: 0 var(--ps-space-1) 0 var(--ps-space-2);
}

.workbench[data-layout='landscape'] .wb-view-group {
  flex: 0 1 auto;
  flex-wrap: nowrap;
  min-width: 0;
}

.workbench[data-layout='landscape'] .wb-view-sep {
  display: none;
}

.workbench[data-layout='landscape'] .wb-more {
  margin-left: auto;
}

/* One screen: the plot on the left over both rows, the legend column on the right with the
   folded structure as its last row. */
.workbench[data-layout='landscape'] .wb-body {
  grid-column: 1 / -1;
  grid-row: 2;
  display: grid;
  grid-template-areas:
    'plot side'
    'plot struct';
  grid-template-columns: minmax(0, 1fr) minmax(192px, 32%);
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100dvh;
  min-height: 0;
}

.workbench[data-layout='landscape'] [data-workbench='plot'] {
  grid-area: plot;
}

.workbench[data-layout='landscape'] #wb-sidebar {
  grid-area: side;
  min-height: 0;
  border-top: 0;
  border-left: 1px solid var(--ps-border);
}

.workbench[data-layout='landscape'] .wb-structure {
  grid-area: struct;
  border-top: 1px solid var(--ps-border);
  border-left: 1px solid var(--ps-border);
}

.workbench[data-layout='landscape'][data-structure='none'] .wb-structure {
  display: none;
}

/* Folded: the grip and the header (5.8 hides the rest), plus the 1 px top border (border-box). */
.workbench[data-layout='landscape'][data-sheet='folded'] .wb-structure {
  height: calc(var(--wb-sheet-folded) + 1px);
}

/* Expanded: the right half, full height, over the plot's right part. It leaves the grid, so the
   legend takes the row back; the plot's box does not change. Mol* resizes here, which is fine. */
.workbench[data-layout='landscape'][data-sheet='expanded'] .wb-structure {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  width: 50vw;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 0;
  box-shadow: var(--ps-shadow-lg);
}
```

Then, so the bar row fits a 740 px screen, give landscape the phone's picker shrink: `grep -n "myProjectionSelect\|myAnnotationSelect" apps/web/src/workbench/workbench.css` and find the phone rule Task 5.4 wrote for the pickers ("pickers shrink with ellipsis", keyed `.workbench[data-layout='phone']`). Add the same selector with `[data-layout='landscape']` to that rule's selector list (turn `.workbench[data-layout='phone'] X` into `.workbench:is([data-layout='phone'], [data-layout='landscape']) X`), so the pickers' hosts and their triggers shrink with an ellipsis here too. Do the same for 5.4's coarse dataset-button rule if it is keyed on the phone layout rather than on `(pointer: coarse)`. Do not copy 5.4's other phone bar rules: the block above replaces them for landscape.

- [ ] **Step 4: Run the layout spec and see it pass**

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-explore-layout.spec.ts
```

Expected: L4 and the rotation test pass, and L1–L3 stay green (phone and tablet rules untouched). If L4 fails on "the plot-and-legend row height = 360 ± 1", check that no earlier non-desktop rule still sets `.wb-body` to `flex: 1 1 auto` with a height cap or the root to `height: 100dvh; overflow: hidden` with a higher specificity than the landscape block (`grep -n ":not(\[data-layout='desktop'\])" apps/web/src/workbench/workbench.css`); raise this block's selector to match rather than adding `!important`. If the body is not exactly one screen, check that `#myDataLoader` (a child of the root, which is a grid here) takes no grid cell: it must be `display: none` or `hidden`. If the rotation test counts 2 resizes, the mode attribute reached the DOM a frame after the new viewport: confirm `useLayoutMode` reads `getLayoutMode` through `useSyncExternalStore` (a sync update) and that nothing in the landscape block depends on a measured value.
- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --check apps/web/src/workbench/workbench.css apps/web/tests/mobile-explore-layout.spec.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-plot-touch.spec.ts
git add apps/web/src/workbench/workbench.css apps/web/tests/mobile-explore-layout.spec.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-plot-touch.spec.ts
git commit -m "feat(web): landscape phone layout with one bar and a full-screen plot"
```

(sandbox disabled for the hook.) Report: the counts of `mobile-explore-layout.spec.ts` before and after, LEGACY 7 (no core change), `wc -l apps/web/src/workbench/workbench.css`, that P10 was relabelled `'task 5.10'`, which 5.4 rules gained the landscape selector, and under "Unrun at task time": `workbench-loading.spec.ts:227`, `mobile-bars.spec.ts` (C8, C9, the new bar test) and `mobile-plot-touch.spec.ts` (P9).

### Task 5.10: Kit and popovers on touch screens

Popovers anchored beside a full-width row (the ⓘ bubble, the colour picker, the Other popover) fall back below or above instead of leaving the screen; segmented chips, checkboxes, switches and ⓘ buttons get 40 px hit areas under a coarse pointer; kit tooltips ignore touch `pointerenter`; `ps-dialog` sizes fit a phone; the projection details card fits a short plot and scrolls.

**Files:**

- Modify: `packages/core/src/components/kit/position.ts`, `popover.styles.ts`, `popover.browser.test.ts` (`menu.browser.test.ts` unchanged: menus open below or above, and those placements do not change)
- Modify: `packages/core/src/styles/style-lint.test.ts` (`RUNTIME_VARS` gains `--available-width`)
- Modify: `packages/core/src/components/kit/choice.styles.ts`, `fields.browser.test.ts`
- Modify: `packages/core/src/components/kit/tooltip.ts`, `button.browser.test.ts` (the `ps-tooltip` block)
- Modify: `packages/core/src/components/kit/dialog.styles.ts`, `dialog.browser.test.ts` (phone sizes via `COMPACT_MEDIA`)
- Modify: `packages/core/src/components/common/info-popover.styles.ts`, `info-popover.browser.test.ts`
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`, `.styles.ts`, `projection-metadata.browser.test.ts` (card max height and scroll in a short plot, kept inside the screen; `:host(:hover)` reveal only for `(hover: hover)`)
- Modify: `apps/web/tests/mobile-bars.spec.ts` (C5), `mobile-legend.spec.ts` (G7), `mobile-plot-touch.spec.ts` (P8, and P10 if 5.9 relabelled it) — fixmes removed; new tests below
- Modify: `docs/developers/api/index.md` (positioning fallbacks, `--available-width`, phone dialog sizes, touch-safe tooltips and choice controls)

**Interfaces:**

- Consumes: `anchorTo(anchor, floating, placement, gap)` (`kit/position.ts`); `COMPACT_MEDIA` from `packages/core/src/utils/breakpoints.ts` (Task 5.6: `'(max-width: 640px), (orientation: landscape) and (max-height: 500px) and (max-width: 950px)'`); `--ps-touch-target` (40 px, `theme.ts`); info-popover `placement="side"` (→ `right-start`) and `beside-row` (anchor = the parent row, `info-popover.ts:245`); `legend-color-picker.ts:131` (`left-start`, anchored to the row element), `legend-other-popover.ts:100`; `ps-dialog size` (`sm`, `md`, `lg`, `full`, plus `sheet` from Task 5.5, whose rules this task leaves alone); e2e helpers `openExplorePhone`, `expectWithinViewport` (`helpers/mobile.ts`, Task 5.1), `legend`, `legendRowAction`, `getFirstLegendItemValue`, `openLegendOther`, `legendOtherDialog` (`helpers/legend.ts`), `selectAnnotation`, `datasetSwitcher`, `importMenu`, `dismissTourIfPresent` (`helpers/explore.ts`), `clearOpfs`, `seedOpfsState` (`helpers/opfs.ts`).
- Produces:
  - `anchorTo`: for `left*`/`right*` placements, `flip({ padding: 8, crossAxis: false, fallbackPlacements: [opposite side, bottom, top] })` (the fallbacks keep the placement's alignment, so `right-start` → `left-start`, `bottom-start`, `top-start`) and `shift({ padding: 8, crossAxis: true })`; `size` also publishes `--available-width`. Top/bottom placements unchanged. `popover.styles.ts` panel `max-width: min(360px, var(--available-width, calc(100vw - 16px)))`.
  - `choice.styles.ts` under `(pointer: coarse)`: segmented buttons `height` and `min-width` `calc(var(--ps-touch-target) - 6px)` inside a 40 px group; checkbox and switch labels form a ≥ 40×40 hit row.
  - `ps-tooltip`: `pointerenter` with `pointerType === 'touch'` schedules nothing (focus still shows it; mouse and pen hover as before).
  - `ps-dialog` at `COMPACT_MEDIA`: `size="full"` is `100vw × 100dvh` with radius 0, no border and safe-area padding; `md`/`lg` widths `min(480px | 720px, calc(100vw - 16px))`; `sm` and `sheet` unchanged.
  - `info-popover`: `.info-button` is `position: relative`; under coarse a `::before` with `inset: -11px` gives it a 40 px hit area without growing its 18 px box.
  - Projection details: the card's width is `min(20rem, calc(100vw - 16px))`; `_updateMaxHeight()` also slides the card left (inline `left`) when it would cross the viewport's right edge minus 8 px, never past the left 8 px; the card opens and closes by tap (its existing pin); the `:host(:hover)` reveal applies only under `@media (hover: hover)`.

**Tests:**

- `popover.browser.test.ts` (viewport 375×667): "a right-start panel beside a 359 px wide anchor stays within [8, 367] and falls below it"; "a left-start panel likewise"; "publishes the room it has as --available-width"; "a beside panel with room keeps its side"; at 1280×720: "a bottom-start panel still opens under its anchor at the anchor's left", "a left-start panel beside a row with room on its left stays on the left".
- `fields.browser.test.ts` (coarse via CDP `Emulation.setTouchEmulationEnabled`, as `legend.rows.browser.test.ts:267` does; the test asserts `matchMedia('(pointer: coarse)')` first so a Chromium that ignores the emulation fails loudly): "segmented options are 34 px tall inside a 40 px group and at least 34 px wide"; "a checkbox and a switch take a 40 px hit row".
- `button.browser.test.ts`: "a touch pointerenter does not show the tooltip; a mouse pointerenter does after 500 ms".
- `dialog.browser.test.ts`: "at 375×667 a full dialog fills the viewport"; "md is 359 px wide at 375"; "at 740×360 a full dialog fills the short landscape screen and md keeps 480 px".
- `info-popover.browser.test.ts`: "a side bubble from a full-width row at 375 px stays on screen"; "under a coarse pointer the ⓘ takes presses 10 px outside its 18 px box".
- `projection-metadata.browser.test.ts`: "the card stays inside a 390 × 420 screen beside the right edge and scrolls"; "under touch a hover reveals nothing and a second tap closes the card".
- `mobile-*`: C5, G7, P8 (and P10) green; new in `mobile-legend.spec.ts`: "the colour picker and the Other popover opened from a full-width row stay inside the viewport"; new in `mobile-bars.spec.ts`: "the confirm dialog and the Import panel fit a 360 px screen".
- Unrun at task time (exit): `mobile-bars.spec.ts` (C5 and the new 360 px test), `mobile-plot-touch.spec.ts` (P8, P10), `workbench-legend.spec.ts`, `workbench-import-export.spec.ts`, `multi-annotation-tooltip.spec.ts`, `kit-gallery.spec.ts`, `workbench-help.spec.ts` (every popover, menu and tooltip shares `position.ts`), `figure-editor.spec.ts` (full dialog), `dataset-recovery.spec.ts` (confirm dialog).

Verification: the kit browser test files touched plus `info-popover.browser.test.ts`, `projection-metadata.browser.test.ts`, `projection-metadata.component.test.ts` (unit) and `style-lint.test.ts` (unit); sandbox disabled for the browser project; `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts` as the one e2e run. LEGACY count stays 7.

- [ ] **Step 1: Remove this task's fixmes and add the two phone e2e tests**

List the fixmes this task owns:

Run: `grep -n "fixme(true, 'task 5.10')" apps/web/tests/mobile-*.spec.ts`
Expected: C5 in `mobile-bars.spec.ts`, G7 in `mobile-legend.spec.ts`, P8 in `mobile-plot-touch.spec.ts`, and P10 in `mobile-plot-touch.spec.ts` only if Task 5.9 relabelled it. Delete each of those `test.fixme(true, 'task 5.10');` lines and nothing else in those tests.

Append to `apps/web/tests/mobile-legend.spec.ts` (merge the imports into the file's existing import lines from the same modules; `openExplorePhone` and `expectWithinViewport` come from `./helpers/mobile`, `selectAnnotation` from `./helpers/explore`, the rest from `./helpers/legend`):

```ts
import { expectWithinViewport, openExplorePhone } from './helpers/mobile';
import { selectAnnotation } from './helpers/explore';
import {
  getFirstLegendItemValue,
  legend,
  legendOtherDialog,
  legendRowAction,
  openLegendOther,
} from './helpers/legend';

test.describe('popovers from a full-width legend row', () => {
  test('the colour picker and the Other popover opened from a full-width row stay inside the viewport', async ({
    page,
  }) => {
    await openExplorePhone(page);
    // 'order' has 18 values, so the default 10 rows leave eight under Other.
    await selectAnnotation(page, 'order');

    // The picker opens beside its row (left-start); on a phone the row spans the screen.
    const value = await getFirstLegendItemValue(page);
    await legendRowAction(page, value, 'Colour and shape');
    const picker = legend(page).getByRole('dialog', { name: /^Colour and shape/ });
    await expect(picker).toBeVisible();
    await expectWithinViewport(page, picker);
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();

    await openLegendOther(page);
    await expectWithinViewport(page, legendOtherDialog(page));
  });
});
```

Append to `apps/web/tests/mobile-bars.spec.ts` (again merging imports; `clearOpfs` and `seedOpfsState` come from `./helpers/opfs`):

```ts
import { expectWithinViewport, openExplorePhone } from './helpers/mobile';
import { datasetSwitcher, dismissTourIfPresent, importMenu } from './helpers/explore';
import { clearOpfs, seedOpfsState } from './helpers/opfs';

test.describe('dialogs on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the confirm dialog and the Import panel fit a 360 px screen', async ({ page }) => {
    await openExplorePhone(page);

    // The dataset name opens the Import panel.
    await datasetSwitcher(page).tap();
    const importPanel = importMenu(page).getByRole('dialog', { name: 'Import', exact: true });
    await expect(importPanel).toBeVisible();
    await expectWithinViewport(page, importPanel);
    await page.keyboard.press('Escape');
    await expect(importPanel).toBeHidden();

    // Clearing a stored dataset asks first in a small ps-dialog; a failed load offers it.
    await clearOpfs(page);
    await seedOpfsState(page, {
      fileName: 'broken.parquetbundle',
      status: 'pending',
      failedAttempts: 1,
    });
    await page.reload();
    await dismissTourIfPresent(page);
    const banner = page.locator('#protspace-recovery-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await banner.getByRole('button', { name: 'Clear stored data' }).tap();

    const confirm = page.getByRole('dialog', { name: 'Clear stored data?' });
    await expect(confirm).toBeVisible();
    await expectWithinViewport(page, confirm);
    // The buttons are the dialog's slotted content, found through the ps-dialog host.
    const host = page.locator('ps-dialog', { has: confirm });
    for (const name of ['Cancel', 'Clear data']) {
      await expectWithinViewport(page, host.getByRole('button', { name, exact: true }));
    }
    await host.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(confirm).toBeHidden();
  });
});
```

If the spec already imports any of these names, keep one import line per module (knip and ESLint reject duplicates).

- [ ] **Step 2: Run the legend spec to see the red tests**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`
Expected: FAIL in "the colour picker and the Other popover opened from a full-width row stay inside the viewport": the colour picker's panel lies left of x = 0 (left-start has no room beside a full-width row, flip finds no side that fits, and shift never moves the cross axis). G7 may already pass (the settings popover opens below its button); if it fails, note why in the report. The C5 and P8 specs and the new 360 px test run at the phase exit (one e2e spec per task).

- [ ] **Step 3: Write the failing core tests for the positioning, dialog and card fixes**

In `packages/core/src/components/kit/popover.browser.test.ts`, change the first line to import `afterAll` too, and import `page`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
```

Append at the end of the file:

```ts
/** A popover beside an anchor; `anchorStyle` places the anchor. */
async function beside(placement: 'right-start' | 'left-start', anchorStyle: string) {
  document.body.innerHTML = `
    <button id="row" style="position: fixed; ${anchorStyle}">Row</button>
    <ps-popover placement="${placement}">
      <p style="width: 300px; height: 120px; margin: 0">Bubble</p>
    </ps-popover>`;
  const anchor = document.getElementById('row')!;
  const pop = document.querySelector('ps-popover')!;
  pop.anchor = anchor;
  pop.open = true;
  await settle(pop);
  return { anchor, pop };
}

/** A full-width row on a 375 px phone: 8 px from each edge. */
const FULL_WIDTH_ROW = 'left: 8px; top: 120px; width: 359px; height: 40px';

describe('ps-popover beside a full-width anchor on a phone', () => {
  beforeAll(async () => {
    await page.viewport(375, 667);
  });
  afterAll(async () => {
    await page.viewport(414, 896);
  });

  it('a right-start panel beside a 359 px wide anchor stays within [8, 367] and falls below it', async () => {
    const { anchor, pop } = await beside('right-start', FULL_WIDTH_ROW);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(rect.right).toBeLessThanOrEqual(367 + 0.5);
    expect(rect.top).toBeGreaterThanOrEqual(anchor.getBoundingClientRect().bottom - 0.5);
  });

  it('a left-start panel likewise', async () => {
    const { anchor, pop } = await beside('left-start', FULL_WIDTH_ROW);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(rect.right).toBeLessThanOrEqual(367 + 0.5);
    expect(rect.top).toBeGreaterThanOrEqual(anchor.getBoundingClientRect().bottom - 0.5);
  });

  it('publishes the room it has as --available-width', async () => {
    const { pop } = await beside('right-start', FULL_WIDTH_ROW);
    const width = Number.parseFloat(panel(pop).style.getPropertyValue('--available-width'));
    expect(width).toBeCloseTo(375 - 16, 0);
  });

  it('a beside panel with room keeps its side', async () => {
    const { anchor, pop } = await beside(
      'right-start',
      'left: 8px; top: 120px; width: 40px; height: 40px',
    );
    expect(panel(pop).getBoundingClientRect().left).toBeGreaterThanOrEqual(
      anchor.getBoundingClientRect().right,
    );
  });
});

describe('ps-popover placements on a desktop screen', () => {
  beforeAll(async () => {
    await page.viewport(1280, 720);
  });
  afterAll(async () => {
    await page.viewport(414, 896);
  });

  it('a bottom-start panel still opens under its anchor at the anchor’s left', async () => {
    document.body.innerHTML = `
      <button id="row" style="position: fixed; left: 200px; top: 100px">Open</button>
      <ps-popover><p style="width: 300px; margin: 0">Panel</p></ps-popover>`;
    const anchor = document.getElementById('row')!;
    const pop = document.querySelector('ps-popover')!;
    pop.anchor = anchor;
    pop.open = true;
    await settle(pop);
    const rect = panel(pop).getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    expect(rect.left).toBeCloseTo(box.left, 0);
    expect(rect.top).toBeCloseTo(box.bottom + 6, 0);
  });

  it('a left-start panel beside a row with room on its left stays on the left', async () => {
    const { anchor, pop } = await beside(
      'left-start',
      'left: 900px; top: 300px; width: 300px; height: 28px',
    );
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(anchor.getBoundingClientRect().left + 0.5);
    expect(rect.top).toBeCloseTo(anchor.getBoundingClientRect().top, 0);
  });
});
```

In `packages/core/src/components/kit/dialog.browser.test.ts`, import `page` (if Task 5.5 has not already: change `import { userEvent } from 'vitest/browser';` to `import { page, userEvent } from 'vitest/browser';`) and append at the end of the file:

```ts
describe('ps-dialog on a phone', () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  async function openSized(size: 'md' | 'full'): Promise<HTMLDialogElement> {
    document.body.innerHTML = `<ps-dialog heading="Figure editor" size="${size}"><p>Body</p></ps-dialog>`;
    const dialog = document.querySelector('ps-dialog') as PsDialog;
    dialog.open = true;
    await settle(dialog);
    return nativeDialog(dialog);
  }

  it('at 375×667 a full dialog fills the viewport', async () => {
    await page.viewport(375, 667);
    const native = await openSized('full');
    const box = native.getBoundingClientRect();
    expect(box.left).toBeCloseTo(0, 0);
    expect(box.top).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(375, 0);
    expect(box.height).toBeCloseTo(667, 0);
    expect(getComputedStyle(native).borderTopLeftRadius).toBe('0px');
  });

  it('md is 359 px wide at 375', async () => {
    await page.viewport(375, 667);
    const box = (await openSized('md')).getBoundingClientRect();
    expect(box.width).toBeCloseTo(359, 0);
    expect(box.left).toBeCloseTo(8, 0);
  });

  it('at 740×360 a full dialog fills the short landscape screen and md keeps 480 px', async () => {
    await page.viewport(740, 360);
    const full = (await openSized('full')).getBoundingClientRect();
    expect(full.width).toBeCloseTo(740, 0);
    expect(full.height).toBeCloseTo(360, 0);
    const md = (await openSized('md')).getBoundingClientRect();
    expect(md.width).toBeCloseTo(480, 0);
  });
});
```

In `packages/core/src/components/common/info-popover.browser.test.ts`, append inside the `describe('protspace-info-popover on ps-popover', …)` block, after its last test ("Escape inside an open ps-popover closes the bubble first, then the panel"):

```ts
  it('a side bubble from a full-width row at 375 px stays on screen', async () => {
    await page.viewport(375, 667);
    try {
      const stage = document.getElementById('stage')!;
      stage.innerHTML = `<div id="row" style="position: fixed; left: 8px; top: 100px; width: 359px;
        height: 40px; display: flex; align-items: center"><span style="flex: 1">Pfam</span></div>`;
      const row = document.getElementById('row')!;
      const el = await mount(
        { placement: 'side', besideRow: true, detail: 'A second paragraph.' },
        row,
      );
      trigger(el).click();
      await settle(el);
      const box = bubble(el)!.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.right).toBeLessThanOrEqual(367 + 0.5);
      expect(box.top).toBeGreaterThanOrEqual(row.getBoundingClientRect().bottom - 0.5);
      expect(box.bottom).toBeLessThanOrEqual(667);
    } finally {
      await page.viewport(1280, 720);
    }
  });
```

Replace `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`'s first import lines

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Projection } from '@protspace/utils';
```

with

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type { Projection } from '@protspace/utils';
```

and append at the end of the file:

```ts
/** A projection with enough parameters for a card taller than a phone's plot. */
function tallProjection(): Projection {
  const metadata: Record<string, unknown> = { n_components: 2 };
  for (let i = 0; i < 40; i++) metadata[`parameter_${i}`] = i;
  return { name: 'ProtT5 — UMAP 2', metadata } as Projection;
}

async function mountAt(style: string): Promise<ProjectionMetadataElement> {
  const el = document.createElement('protspace-projection-metadata') as ProjectionMetadataElement;
  el.projection = tallProjection();
  el.style.cssText = style;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('protspace-projection-metadata on a phone', () => {
  it('the card stays inside a 390 × 420 screen beside the right edge and scrolls', async () => {
    await page.viewport(390, 420);
    try {
      // The details button sits far right on a phone's view bar.
      const el = await mountAt('position: fixed; left: 300px; top: 60px');
      (el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click();
      await el.updateComplete;
      await frame();
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      const box = card.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.right).toBeLessThanOrEqual(390 - 8 + 0.5);
      expect(box.bottom).toBeLessThanOrEqual(420 - 8 + 0.5);
      expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it('under touch a hover reveals nothing and a second tap closes the card', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(hover: none)').matches).toBe(true);
      const el = await mountAt('position: fixed; left: 40px; top: 40px');
      const trigger = el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement;
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      // A tap leaves the pointer "over" the button: :hover must not hold the card open.
      await userEvent.hover(trigger);
      expect(getComputedStyle(card).visibility).toBe('hidden');
      trigger.click();
      await el.updateComplete;
      expect(getComputedStyle(card).visibility).toBe('visible');
      trigger.click();
      await el.updateComplete;
      await expect.poll(() => getComputedStyle(card).visibility).toBe('hidden');
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run (sandbox disabled):
`pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/popover.browser.test.ts src/components/kit/dialog.browser.test.ts src/components/common/info-popover.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`
Expected: FAIL in
- the two full-width popover tests (the panel sits beside the anchor, off screen) and `--available-width` (NaN: nothing sets it);
- the three phone dialog tests (a full dialog is `calc(100vw - 32px)` wide with a 10 px radius; md is 343 px at 375 and the native `max-width` caps it);
- the info-popover full-width test (the bubble leaves the screen on the right or left);
- both projection-metadata tests (the card's right edge is at 620 px; under touch `:host(:hover)` keeps it visible).
The "keeps its side", desktop placement and every existing test pass.

- [ ] **Step 5: Implement positioning fallbacks**

Replace the body of `packages/core/src/components/kit/position.ts` from the doc comment above `export function anchorTo` to the end of the file with:

```ts
const OPPOSITE_SIDE = { left: 'right', right: 'left' } as const;

/**
 * Beside an anchor: the other side, then below, then above, each with the same alignment. A
 * full-width row on a phone leaves no room on either side, so the panel goes under it.
 */
function besideFallbacks(placement: Placement): Placement[] {
  const [side, align] = placement.split('-') as ['left' | 'right', string | undefined];
  const suffix = align ? `-${align}` : '';
  return [`${OPPOSITE_SIDE[side]}${suffix}`, `bottom${suffix}`, `top${suffix}`] as Placement[];
}

/**
 * Keeps a top-layer element next to its anchor until the returned function runs. Fixed
 * positioning is what a top-layer element needs; flip and shift keep it on screen, and size
 * publishes the room left as `--available-height` and `--available-width` so a large panel can
 * cap itself and scroll.
 * Beside an anchor (left or right), a panel too tall for the room slides along it rather than
 * flipping to grow from its far end, which would lift it over the app bar. Only when neither side
 * has room does it fall below or above the anchor; as a last resort it shifts across the anchor
 * rather than leave the screen.
 */
export function anchorTo(
  anchor: Element,
  floating: HTMLElement,
  placement: Placement,
  gap = 6,
): () => void {
  const beside = placement.startsWith('left') || placement.startsWith('right');
  const update = () =>
    computePosition(anchor, floating, {
      placement,
      strategy: 'fixed',
      middleware: [
        offset(gap),
        beside
          ? // Only the side's own axis decides: a tall panel overflowing below still fits beside.
            flip({ padding: 8, crossAxis: false, fallbackPlacements: besideFallbacks(placement) })
          : flip({ padding: 8 }),
        shift({ padding: 8, crossAxis: beside }),
        size({
          padding: 8,
          apply: ({ availableHeight, availableWidth }) => {
            floating.style.setProperty('--available-height', `${Math.max(0, availableHeight)}px`);
            floating.style.setProperty('--available-width', `${Math.max(0, availableWidth)}px`);
          },
        }),
      ],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  return autoUpdate(anchor, floating, update);
}
```

(The old beside rule `flip({ padding: 8, flipAlignment: !beside })` checked the cross axis too; with only `[opposite]` as fallback, both sides fitting their own axis kept the initial side, which `crossAxis: false` keeps; the new part is the fall below and above when neither side fits.)

In `packages/core/src/components/kit/popover.styles.ts`, replace

```css
      max-width: min(360px, calc(100vw - 16px));
```

with

```css
      max-width: min(360px, var(--available-width, calc(100vw - 16px)));
```

In `packages/core/src/styles/style-lint.test.ts`, replace

```ts
const RUNTIME_VARS = new Set(['--available-height']);
```

with

```ts
const RUNTIME_VARS = new Set(['--available-height', '--available-width']);
```

- [ ] **Step 6: Implement phone dialog sizes**

In `packages/core/src/components/kit/dialog.styles.ts`, change the imports to:

```ts
import { css, unsafeCSS } from 'lit';
import { COMPACT_MEDIA } from '../../utils/breakpoints';
import { focusRing, kitHost, reducedMotion } from './kit-shared.styles';
```

and append inside the `css` template literal, after every existing rule (after `footer[hidden] { display: none; }` and after Task 5.5's `size='sheet'` rules, so these come last):

```css
    /* Phones, upright or on their side: a full dialog is the screen, md and lg leave 8 px a side.
       The native dialog's own max-width (100% - 2em - 6px) would cap them, so it goes. sm and
       sheet keep their rules. */
    @media ${unsafeCSS(COMPACT_MEDIA)} {
      :host([size='full']) dialog {
        width: 100vw;
        height: 100dvh;
        max-width: none;
        max-height: none;
        margin: 0;
        border: 0;
        border-radius: 0;
        padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
          env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
      }
      :host([size='full']) .frame {
        max-height: none;
      }
      :host([size='md']) dialog {
        width: min(480px, calc(100vw - 16px));
        max-width: calc(100vw - 16px);
        max-height: calc(100dvh - 16px);
      }
      :host([size='lg']) dialog {
        width: min(720px, calc(100vw - 16px));
        max-width: calc(100vw - 16px);
        max-height: calc(100dvh - 16px);
      }
      :host([size='md']) .frame,
      :host([size='lg']) .frame {
        max-height: calc(100dvh - 18px);
      }
    }
```

(The existing test "sizes by the dynamic viewport" still holds: no `100vh` is added.)

- [ ] **Step 7: Implement the info bubble's and the projection card's phone fit**

The info bubble needs no code of its own: its `side` placement is `right-start` (`info-popover.ts:213`), which Step 5's fallbacks now cover.

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, inside the `.content { … }` rule, replace

```css
      width: 20rem;
```

with

```css
      width: min(20rem, calc(100vw - 16px));
```

and replace the reveal rule

```css
    :host(:hover) .content,
    .content.is-pinned,
    .trigger:focus-visible + .content {
      pointer-events: auto;
      opacity: 1;
      visibility: visible;
    }
```

with

```css
    .content.is-pinned,
    .trigger:focus-visible + .content {
      pointer-events: auto;
      opacity: 1;
      visibility: visible;
    }

    /* Hover reveals the card only for a pointer that can hover. After a tap a touch screen keeps
       :hover on the button, so a hover rule would hold the card open past a second tap. */
    @media (hover: hover) {
      :host(:hover) .content {
        pointer-events: auto;
        opacity: 1;
        visibility: visible;
      }
    }
```

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`, replace the method `_updateMaxHeight` (doc comment included) with:

```ts
  /**
   * Caps the card at the room left below it in the viewport, and keeps it inside the viewport's
   * width. The card opens from the view bar, with the whole plot height free below it, so the
   * viewport is the bound; a measured cap still beats a CSS one because the card's top depends on
   * where the bar sits.
   */
  private _updateMaxHeight(): void {
    const content = this.shadowRoot?.querySelector('.content') as HTMLElement | null;
    if (!content) return;
    const { MIN_CARD_HEIGHT, CARD_MARGIN } = ProtspaceProjectionMetadata;
    const available = window.innerHeight - content.getBoundingClientRect().top - CARD_MARGIN;
    content.style.maxHeight = `${Math.max(MIN_CARD_HEIGHT, available)}px`;
    this._keepInsideViewport(content);
  }

  /**
   * Slides the card left when it would cross the viewport's right edge (the button sits far right
   * on a phone's view bar), never past the left margin. Measured from the host, so the card's own
   * inline offset never feeds back into the next measurement.
   */
  private _keepInsideViewport(content: HTMLElement): void {
    const { CARD_MARGIN } = ProtspaceProjectionMetadata;
    const hostLeft = this.getBoundingClientRect().left;
    const overflow = hostLeft + content.offsetWidth - (window.innerWidth - CARD_MARGIN);
    if (overflow <= 0) {
      content.style.left = '';
      return;
    }
    content.style.left = `${Math.max(CARD_MARGIN, hostLeft - overflow) - hostLeft}px`;
  }
```

(The jsdom placement test in `projection-metadata.component.test.ts` mocks only the card's rect: the host's rect and `offsetWidth` are 0 there, so `left` stays empty and its two `maxHeight` assertions are unchanged.)

- [ ] **Step 8: Run the tests to verify they pass**

Run (sandbox disabled):
`pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/popover.browser.test.ts src/components/kit/dialog.browser.test.ts src/components/kit/menu.browser.test.ts src/components/common/info-popover.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`
Expected: PASS, every test (the menus' placements are unchanged).

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.component.test.ts`
Expected: PASS; LEGACY count 7 (`projection-metadata.styles.ts` still reads `--protspace-tooltip-*` and raw colours).

- [ ] **Step 9: Document positioning and phone dialog sizes**

In `docs/developers/api/index.md`, after the paragraph of "View and App Controls" that ends "Every event below bubbles and is composed.", insert:

```md
On a phone, a panel that opens beside its anchor (an ⓘ bubble, the colour picker or the Other
popover beside a full-width legend row) opens below the anchor, or above it, when neither side has
room, and stays 8 px inside the screen. Every kit popover, menu and tooltip publishes the room it
has as `--available-height` and `--available-width` on its panel. Kit dialogs fit a phone, upright
(640 px wide or less) or on its side (500 px tall or less): `size="full"` fills the screen edge to
edge, and `md` and `lg` leave 8 px on each side.
```

In the "Projection Metadata" section, after its table (the row ending "name runtime columns         |"), insert:

```md

The card stays inside the screen and scrolls when it is taller than the room below the button.
Hovering opens it only with a pointer that can hover; on a touch screen a tap on the button opens
and closes it.
```

- [ ] **Step 10: Commit the positioning and fit fixes**

Run: `pnpm exec prettier --check packages/core/src/components/kit/position.ts packages/core/src/components/kit/popover.styles.ts packages/core/src/components/kit/popover.browser.test.ts packages/core/src/components/kit/dialog.styles.ts packages/core/src/components/kit/dialog.browser.test.ts packages/core/src/components/common/info-popover.browser.test.ts packages/core/src/components/scatter-plot/projection-metadata packages/core/src/styles/style-lint.test.ts docs/developers/api/index.md`
Expected: clean (run `pnpm exec prettier --write` on any file it lists, then check again).

```bash
git add packages/core/src/components/kit/position.ts packages/core/src/components/kit/popover.styles.ts packages/core/src/components/kit/popover.browser.test.ts packages/core/src/components/kit/dialog.styles.ts packages/core/src/components/kit/dialog.browser.test.ts packages/core/src/components/common/info-popover.browser.test.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts packages/core/src/styles/style-lint.test.ts docs/developers/api/index.md
git commit -m "fix(core): keep popovers on screen and fit dialogs on phones"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

- [ ] **Step 11: Write the failing touch tests for choice controls, tooltips and the ⓘ**

In `packages/core/src/components/kit/fields.browser.test.ts`, change `import { page, userEvent } from 'vitest/browser';` to

```ts
import { cdp, page, userEvent } from 'vitest/browser';
```

and append at the end of the file:

```ts
describe('choice controls under a coarse pointer', () => {
  /** Runs `body` with touch emulation on, which switches `(pointer: coarse)`. */
  async function coarse(body: () => Promise<void>): Promise<void> {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Fail loudly if this Chromium does not flip the media feature.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      await body();
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  }

  it('segmented options are 34 px tall inside a 40 px group and at least 34 px wide', async () => {
    await coarse(async () => {
      const el = await mount<PsSegmented>('<ps-segmented label="Contours"></ps-segmented>');
      el.options = [
        { value: 'off', label: 'Off' },
        { value: 'auto', label: 'Auto' },
        { value: 'on', label: 'Always' },
      ];
      el.value = 'off';
      await el.updateComplete;
      const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
      expect(group.getBoundingClientRect().height).toBeCloseTo(40, 0);
      for (const radio of el.shadowRoot!.querySelectorAll('[role="radio"]')) {
        const box = radio.getBoundingClientRect();
        expect(box.height).toBeCloseTo(34, 0);
        expect(box.width).toBeGreaterThanOrEqual(34 - 0.5);
      }
    });
  });

  it('a checkbox and a switch take a 40 px hit row', async () => {
    await coarse(async () => {
      for (const markup of [
        '<ps-checkbox label="Select all"></ps-checkbox>',
        '<ps-switch label="Contours"></ps-switch>',
      ]) {
        const el = await mount<PsCheckbox | PsSwitch>(markup);
        const label = el.shadowRoot!.querySelector('label')!;
        const box = label.getBoundingClientRect();
        expect(box.height).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.width).toBeGreaterThanOrEqual(40 - 0.5);
        // A press near the row's corner lands inside the label, which toggles the control.
        const hit = el.shadowRoot!.elementFromPoint(box.left + 2, box.bottom - 2);
        expect(hit !== null && label.contains(hit)).toBe(true);
      }
    });
  });
});
```

In `packages/core/src/components/kit/button.browser.test.ts`, append inside `describe('ps-tooltip', …)`, after its last test ("leaves no listeners on an external anchor when removed in the task it was added"):

```ts
  it('a touch pointerenter does not show the tooltip; a mouse pointerenter does after 500 ms', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    // A tap: a label shown now would stay until the next tap elsewhere.
    inner(el).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    vi.advanceTimersByTime(1000);
    expect(tip(el).matches(':popover-open')).toBe(false);

    inner(el).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(500);
    expect(tip(el).matches(':popover-open')).toBe(true);
  });
```

In `packages/core/src/components/common/info-popover.browser.test.ts`, change `import { page, userEvent } from 'vitest/browser';` to

```ts
import { cdp, page, userEvent } from 'vitest/browser';
```

and append inside `describe('protspace-info-popover on ps-popover', …)`, after the test Step 3 added:

```ts
  it('under a coarse pointer the ⓘ takes presses 10 px outside its 18 px box', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const el = await mount();
      const box = trigger(el).getBoundingClientRect();
      expect(box.width).toBeCloseTo(18, 0);
      const midY = box.top + box.height / 2;
      for (const [x, y] of [
        [box.left - 10, midY],
        [box.right + 10, midY],
        [box.left + box.width / 2, box.top - 10],
      ]) {
        expect(el.shadowRoot!.elementFromPoint(x, y)).toBe(trigger(el));
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
```

- [ ] **Step 12: Run them to verify they fail**

Run (sandbox disabled):
`pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts src/components/kit/button.browser.test.ts src/components/common/info-popover.browser.test.ts`
Expected: FAIL in "segmented options …" (group 28 px, options 22 px), "a checkbox and a switch …" (labels 16 and 18 px), "a touch pointerenter …" (the touch enter shows the tooltip after 500 ms) and "under a coarse pointer the ⓘ …" (`elementFromPoint` returns the stage or the host, not the button). Every other test passes.

- [ ] **Step 13: Implement touch-sized choice controls, the ⓘ hit area and touch-safe tooltips**

In `packages/core/src/components/kit/choice.styles.ts`:

In `checkboxStyles`, after the rule `:host([disabled]) label { cursor: not-allowed; opacity: 0.5; }`, add (inside the same `css` literal):

```css
    /* Touch: the label is a 40 px hit row; the box keeps its size. */
    @media (pointer: coarse) {
      label {
        min-width: var(--ps-touch-target);
        min-height: var(--ps-touch-target);
      }
    }
```

In `switchStyles`, before the `@media (forced-colors: active)` block, add:

```css
    /* Touch: the label is a 40 px hit row; the track keeps its size. */
    @media (pointer: coarse) {
      label {
        min-width: var(--ps-touch-target);
        min-height: var(--ps-touch-target);
      }
    }
```

In `segmentedStyles`, before its `@media (forced-colors: active)` block, add:

```css
    /* Touch: a 40 px group (the track's 2 px padding and 1 px border around 34 px options). */
    @media (pointer: coarse) {
      button {
        height: calc(var(--ps-touch-target) - 6px);
        min-width: calc(var(--ps-touch-target) - 6px);
      }
    }
```

In `packages/core/src/components/common/info-popover.styles.ts`, inside the `.info-button { … }` rule add `position: relative;` after `display: inline-flex;`, and after the `.info-button:hover, .info-button.open { … }` rule add:

```css
    /* Touch: a 40 px hit area around the 18 px icon, without growing the row it sits in. */
    @media (pointer: coarse) {
      .info-button::before {
        content: '';
        position: absolute;
        inset: -11px;
      }
    }
```

In `packages/core/src/components/kit/tooltip.ts`, replace

```ts
  private onEnter = () => {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_DELAY_MS);
  };
```

with

```ts
  // A finger has no hover: a tap would show a label that only the next tap elsewhere hides. Mouse
  // and pen hover as before; keyboard focus still shows it (onFocus).
  private onEnter = (event: Event) => {
    if ((event as PointerEvent).pointerType === 'touch') return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.show(), HOVER_DELAY_MS);
  };
```

(Only `touch` is skipped, not every non-mouse type: a pen hovers like a mouse, and the existing tests dispatch `pointerenter` with no `pointerType`, which stays a hover.)

- [ ] **Step 14: Run the core tests to verify they pass**

Run (sandbox disabled):
`pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts src/components/kit/button.browser.test.ts src/components/common/info-popover.browser.test.ts src/components/kit/popover.browser.test.ts`
Expected: PASS, every test.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: PASS; LEGACY 7.

- [ ] **Step 15: Run the phone legend spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`
Expected: PASS for G7 and "the colour picker and the Other popover opened from a full-width row stay inside the viewport"; tests still marked for later tasks are skipped.

- [ ] **Step 16: Document the touch behaviour**

In `docs/developers/api/index.md`, append to the paragraph Step 9 inserted (after "leave 8 px on each side."):

```md
Under a coarse pointer the kit's segmented options, checkboxes, switches and ⓘ buttons take 40 px
presses, and a kit tooltip ignores a touch: a tap shows no label, while keyboard focus still does.
```

- [ ] **Step 17: Commit the touch affordances and the phone tests**

Run: `pnpm exec prettier --check packages/core/src/components/kit/choice.styles.ts packages/core/src/components/kit/tooltip.ts packages/core/src/components/kit/fields.browser.test.ts packages/core/src/components/kit/button.browser.test.ts packages/core/src/components/common/info-popover.styles.ts packages/core/src/components/common/info-popover.browser.test.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-legend.spec.ts apps/web/tests/mobile-plot-touch.spec.ts docs/developers/api/index.md`
Expected: clean.

```bash
git add packages/core/src/components/kit/choice.styles.ts packages/core/src/components/kit/tooltip.ts packages/core/src/components/kit/fields.browser.test.ts packages/core/src/components/kit/button.browser.test.ts packages/core/src/components/common/info-popover.styles.ts packages/core/src/components/common/info-popover.browser.test.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-legend.spec.ts apps/web/tests/mobile-plot-touch.spec.ts docs/developers/api/index.md
git commit -m "feat(core): touch-sized choice controls and touch-safe tooltips"
```

Report: the counts of each test file run before and after, LEGACY 7, whether G7 was already green before this task, whether P10 carried a `task 5.10` fixme, and the "Unrun at task time" list for the exit run.

### Task 5.11: Legend rows on touch

Legend rows answer touch the way the mouse rows answer clicks: a tap toggles, a double tap (300 ms) isolates even where no `dblclick` arrives, a long press on the drag handle lifts the row while a swipe scrolls the list, a long press on a truncated name shows it in full without toggling, and a tap leaves no hover highlight behind. Under a coarse pointer the row's eye, handle and "⋯" become 40 px targets.

**Files:**

- Modify: `packages/core/src/components/legend/legend-helpers.ts` (`DOUBLE_TAP_MS`, `isDoubleTap`, `clickPointerType`), `legend-helpers.test.ts`
- Modify: `packages/core/src/components/legend/legend.ts` (`_handleItemMouseClick` consults the tap helpers; a `dblclick` after touch or pen clicks is ignored; the row's `onPointerDown`; minimal lines), `legend.double-click.test.ts` (the touch case at about `:220` now isolates on the second tap)
- Modify: `packages/core/src/components/legend/legend-row.ts` (`@pointerenter`/`@pointerleave` for mouse and pen in place of `@mouseenter`/`@mouseleave`; `@pointerdown` on the main button → `onPointerDown`), `legend-row.test.ts`
- Modify: `packages/core/src/components/legend/legend.score-strips.test.ts`, `legend.score-sync.test.ts` (their row hovers dispatch `mouseenter`/`mouseleave`; they become mouse `pointerenter`/`pointerleave`; one new touch case in `legend.score-strips.test.ts`)
- Modify: `packages/core/src/components/legend/legend-list.ts` (`TruncatedNameTooltip`: mouse and pen `pointerenter` as today, touch ignored; touch or pen long press 500 ms, cancelled by 10 px of movement or `pointercancel`, hidden on lift; the click after a long press is swallowed; `contextmenu` prevented during it), `legend.rows.browser.test.ts`
- Modify: `packages/core/src/components/legend/controllers/drag-controller.ts`, `drag-controller.test.ts` (Sortable `delay: 250`, `delayOnTouchOnly: true`, `touchStartThreshold: 5`, `fallbackClass: 'sortable-fallback'`; the fallback copy is kept out of the restored rows and any left over is removed on end; a finger's `touchmove` is default-prevented while a row is lifted)
- Modify: `packages/core/src/components/legend/styles/row.ts` (`.legend-item-main { touch-action: manipulation; -webkit-touch-callout: none }`; coarse 40 px eye, handle and "⋯"; the dead `.legend-item-fallback` selector becomes `.sortable-fallback`)
- Modify: `apps/web/tests/mobile-legend.spec.ts` (G1, G2, G3, G5) — fixmes removed
- Modify: `docs/developers/api/index.md` (legend rows on touch)
- Read: branch commits `22383560` (double tap), `e609412a`, `ab90f296` (Sortable touch) for reference

**Interfaces:**

- Consumes: `isSecondClickOfDouble(first, valueKey, click)`, `isolationBase(first, valueKey, items)`, `FirstClick`, `_firstClick`, `_handleItemDoubleClick(value, items)`, `_setHoveredCategory` (`legend.ts`); `NAME_TOOLTIP_DELAY_MS = 500`, `TruncatedNameTooltip.onNamePointerEnter`, `hover()`, `leave()`, `_show()` (`legend-list.ts`); `LegendRowHandlers`, `renderLegendRow` (`legend-row.ts`); the drag controller's Sortable options; `ps-tooltip` ignoring touch `pointerenter` (Task 5.10); the ported G1–G5 in `mobile-legend.spec.ts` (Task 5.1).
- Produces:
  - `legend-helpers.ts`: `export const DOUBLE_TAP_MS = 300`; `export function isDoubleTap(previous: { valueKey: string; time: number } | null, current: { valueKey: string; time: number; pointerType: string }): boolean` (touch or pen, same row, within 300 ms); `export function clickPointerType(click: { pointerType?: string; timeStamp: number }, lastDown: { pointerType: string; time: number } | null): string` (the click's own `pointerType`, else the row `pointerdown` within 1 s before it, else `'mouse'`).
  - Legend: a touch or pen click records `{ valueKey, time }`; the second tap on the same row within 300 ms isolates from `isolationBase(first…)` (the same result as a mouse double-click: the first tap's toggle is undone); a `dblclick` whose preceding row click was touch or pen is ignored. Mouse behaviour unchanged.
  - `LegendRowHandlers.onPointerDown(e: PointerEvent): void` (new, on the main button); rows call `onHover` on `pointerenter` only for `pointerType` mouse or pen, and `onHover(null)` on every `pointerleave`.
  - `TruncatedNameTooltip.onNamePointerDown(e: PointerEvent): void` (new): the long-press name described above; no change for mouse.
  - Drag: as listed; a swipe that starts on a handle scrolls the list.

**Tests:**

- `legend-helpers.test.ts`: `isDoubleTap` table (same row 250 ms → true; 300 ms → true; 350 ms → false; other row → false; mouse → false; no previous → false); `clickPointerType` (own type wins; empty type falls back to a pointerdown 200 ms before; a pointerdown 1.5 s before or none → mouse).
- `legend.double-click.test.ts`: "two touch taps within 300 ms isolate the category even with no dblclick" (replaces "keeps toggling both taps of a touch double-tap, then isolates"); "a touch dblclick after the two taps does nothing more"; "touch taps on two rows toggle both"; "a click with no pointer type after a touch press counts as a tap"; mouse cases unchanged.
- `legend-row.test.ts`: "a touch pointerenter does not set the hovered category; a mouse one does"; "a press on the main button reaches onPointerDown".
- `legend.rows.browser.test.ts`: "a 500 ms touch hold on a truncated name shows it, and the click that ends it does not toggle"; "moving 12 px first cancels it, and the tap toggles"; "a touch pointerenter on a truncated name shows nothing"; the coarse test also checks the eye, handle and "⋯" are 40×40.
- `drag-controller.test.ts`: "delays a drag only for touch, so a swipe over a handle scrolls the list" (options); "does not put the floating row copy back when it restores the rows"; "removes a leftover .sortable-fallback on end"; "keeps a finger move from scrolling the list only while a row is lifted".
- `legend.score-strips.test.ts`, `legend.score-sync.test.ts`: unchanged assertions, mouse pointer events; new in `legend.score-strips.test.ts`: "a touch pointerenter on a row fills no strip gutter" (the startup dataset may have no category scores, so this rule is pinned at the unit level, not in e2e).
- `mobile-legend.spec.ts`: G1, G2, G3, G5 green.
- Unrun at task time (exit): `legend-double-click.spec.ts`, `numeric-binning.spec.ts` (legend drag tests), `workbench-legend.spec.ts`, `eat-visualization.spec.ts` (legend hover); `pnpm perf:counts` (legend hover).

Verification: the legend test files touched (unit and browser); `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`. Report `wc -l legend.ts` (2,154 before). LEGACY count stays 7.

- [ ] **Step 1: Remove this task's fixmes**

Run: `grep -n "fixme(true, 'task 5.11')" apps/web/tests/mobile-*.spec.ts`
Expected: G2, G3 and G5 in `mobile-legend.spec.ts`, and G1 unless Task 5.1 found it green. Delete each of those `test.fixme(true, 'task 5.11');` lines and nothing else.

- [ ] **Step 2: Run the legend spec to see the red tests**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`
Expected: FAIL in G1 (the eye, handle and "⋯" are 24×24 under a coarse pointer), G3 (with no touch delay or fallback class the drag leaves a `.sortable-fallback` copy, or the order is unchanged) and G5 (with `dblclick` swallowed, two taps only toggle the row twice: every row stays pressed). G2 may pass already (a swipe from the handle scrolls when no drag starts).

- [ ] **Step 3: Write the failing unit tests**

In `packages/core/src/components/legend/legend-helpers.test.ts`, add `isDoubleTap`, `clickPointerType` and `DOUBLE_TAP_MS` to the import list from `./legend-helpers` (after `isolationBase,`), and append inside `describe('legend-helpers', …)`, after `describe('isolationBase', …)`:

```ts
  describe('isDoubleTap', () => {
    const first = { valueKey: 'a', time: 1000 };
    const tap = (valueKey: string, after: number, pointerType = 'touch') => ({
      valueKey,
      time: 1000 + after,
      pointerType,
    });

    it('is the second touch or pen tap on the same row within DOUBLE_TAP_MS', () => {
      expect(DOUBLE_TAP_MS).toBe(300);
      expect(isDoubleTap(first, tap('a', 250))).toBe(true);
      expect(isDoubleTap(first, tap('a', 300))).toBe(true);
      expect(isDoubleTap(first, tap('a', 250, 'pen'))).toBe(true);
    });

    it('is not a slow tap, a tap on another row, a mouse click or a first tap', () => {
      expect(isDoubleTap(first, tap('a', 350))).toBe(false);
      expect(isDoubleTap(first, tap('b', 100))).toBe(false);
      expect(isDoubleTap(first, tap('a', 100, 'mouse'))).toBe(false);
      expect(isDoubleTap(null, tap('a', 100))).toBe(false);
    });
  });

  describe('clickPointerType', () => {
    it("is the click's own pointer type", () => {
      expect(clickPointerType({ pointerType: 'touch', timeStamp: 5000 }, null)).toBe('touch');
      expect(
        clickPointerType({ pointerType: 'mouse', timeStamp: 5000 }, { pointerType: 'touch', time: 4900 }),
      ).toBe('mouse');
    });

    it('falls back to the press just before a click that has none, as older Safari sends', () => {
      expect(clickPointerType({ pointerType: '', timeStamp: 5000 }, { pointerType: 'touch', time: 4800 })).toBe(
        'touch',
      );
      expect(clickPointerType({ timeStamp: 5000 }, { pointerType: 'pen', time: 4800 })).toBe('pen');
    });

    it("is a mouse for a script's or a screen reader's click", () => {
      expect(clickPointerType({ timeStamp: 5000 }, null)).toBe('mouse');
      expect(clickPointerType({ timeStamp: 5000 }, { pointerType: 'touch', time: 3500 })).toBe('mouse');
    });
  });
```

In `packages/core/src/components/legend/legend.double-click.test.ts`, replace the whole test `it('keeps toggling both taps of a touch double-tap, then isolates', …)` with:

```ts
  it('two touch taps within 300 ms isolate the category even with no dblclick', async () => {
    const { click, visible, handedToPlot, actions } = await setup();

    click('A', 1, 'touch');
    click('A', 2, 'touch');

    expect(visible()).toEqual(['A']);
    // The first tap's hide, then the isolate from the legend before it.
    expect(handedToPlot).toEqual([['A'], ['B', 'C']]);
    expect(actions).toEqual(['toggle:A', 'isolate:A']);
  });

  it('a touch dblclick after the two taps does nothing more', async () => {
    const { click, dblclick, visible, handedToPlot } = await setup();

    click('A', 1, 'touch');
    click('A', 2, 'touch');
    dblclick('A');

    expect(visible()).toEqual(['A']);
    expect(handedToPlot).toEqual([['A'], ['B', 'C']]);
  });

  it('touch taps on two rows toggle both', async () => {
    const { click, visible } = await setup();

    click('A', 1, 'touch');
    click('B', 2, 'touch');

    expect(visible()).toEqual(['C']);
  });

  it('a click with no pointer type after a touch press counts as a tap', async () => {
    const { legend, click, visible } = await setup();
    const press = () =>
      legend
        .shadowRoot!.querySelector('[data-value="A"] .legend-item-main')!
        .dispatchEvent(
          new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, composed: true }),
        );

    press();
    click('A', 1);
    press();
    click('A', 2);

    expect(visible()).toEqual(['A']);
  });
```

Replace `packages/core/src/components/legend/legend-row.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { SHAPE_PATH_GENERATORS } from './config';
import {
  renderLegendRow,
  renderLegendSymbol,
  type LegendRowHandlers,
  type LegendRowView,
} from './legend-row';
import type { LegendItem } from './types';

function draw(...args: Parameters<typeof renderLegendSymbol>): SVGPathElement {
  const host = document.createElement('div');
  render(renderLegendSymbol(...args), host);
  return host.querySelector<SVGPathElement>('svg.legend-symbol path')!;
}

/** One row for category A, every handler a spy. */
function drawRow() {
  const host = document.createElement('div');
  const item: LegendItem = {
    value: 'A',
    color: '#123456',
    shape: 'circle',
    count: 3,
    isVisible: true,
    zOrder: 0,
  };
  const view: LegendRowView = {
    classes: 'legend-item',
    symbolSize: 10,
    tabbable: true,
    draggable: true,
    picked: false,
    hasMenu: true,
  };
  const handlers: LegendRowHandlers = {
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    onKeyDown: vi.fn(),
    onHandleKeyDown: vi.fn(),
    onHover: vi.fn(),
    onFocus: vi.fn(),
    onToggle: vi.fn(),
    onMenu: vi.fn(),
    onViewOther: vi.fn(),
    onNamePointerEnter: vi.fn(),
    onPointerDown: vi.fn(),
  };
  render(renderLegendRow(item, view, handlers), host);
  return { row: host.querySelector<HTMLElement>('.legend-item')!, handlers };
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

describe('renderLegendRow pointer handling', () => {
  it('a touch pointerenter does not set the hovered category; a mouse one does', () => {
    const { row, handlers } = drawRow();

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    expect(handlers.onHover).not.toHaveBeenCalled();

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(handlers.onHover).toHaveBeenLastCalledWith('A');
    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(handlers.onHover).toHaveBeenLastCalledWith(null);
  });

  it('a press on the main button reaches onPointerDown', () => {
    const { row, handlers } = drawRow();
    row
      .querySelector('.legend-item-main')!
      .dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    expect(handlers.onPointerDown).toHaveBeenCalledOnce();
  });
});
```

In `packages/core/src/components/legend/controllers/drag-controller.test.ts`, insert before `describe('cleanup', …)`:

```ts
  describe('touch drag', () => {
    it('delays a drag only for touch, so a swipe over a handle scrolls the list', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      expect(sortable.option('handle')).toBe('.drag-handle');
      expect(sortable.option('delay')).toBe(250);
      expect(sortable.option('delayOnTouchOnly')).toBe(true);
      expect(sortable.option('touchStartThreshold')).toBe(5);
      expect(sortable.option('fallbackClass')).toBe('sortable-fallback');
    });

    it('does not put the floating row copy back when it restores the rows', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const ghost = document.createElement('div');
      ghost.className = 'legend-item sortable-fallback';
      mockContainer.appendChild(ghost);

      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      // Sortable takes the copy away on drop, before `onEnd`.
      ghost.remove();
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);

      expect(mockContainer.querySelector('.sortable-fallback')).toBeNull();
      expect(mockContainer.children).toHaveLength(mockLegendItems.length);
    });

    it('removes a leftover .sortable-fallback on end', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const ghost = document.createElement('div');
      ghost.className = 'legend-item sortable-fallback';
      mockContainer.appendChild(ghost);

      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);

      expect(mockContainer.querySelector('.sortable-fallback')).toBeNull();
      expect(mockContainer.children).toHaveLength(mockLegendItems.length);
    });

    it('keeps a finger move from scrolling the list only while a row is lifted', () => {
      controller.initialize(mockContainer);
      const sortable = controller.getInstance()!;
      const move = () => {
        const event = new Event('touchmove', { bubbles: true, cancelable: true });
        mockContainer.children[0].dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(move()).toBe(false);
      sortable.option('onStart')!({ from: mockContainer } as Sortable.SortableEvent);
      expect(move()).toBe(true);
      sortable.option('onEnd')!({
        from: mockContainer,
        item: mockContainer.children[0] as HTMLElement,
        oldIndex: 0,
        newIndex: 0,
      } as Sortable.SortableEvent);
      expect(move()).toBe(false);
    });
  });
```

- [ ] **Step 4: Run the unit tests to verify they fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-helpers.test.ts src/components/legend/legend.double-click.test.ts src/components/legend/legend-row.test.ts src/components/legend/controllers/drag-controller.test.ts`
Expected: FAIL. `legend-helpers.test.ts`: `isDoubleTap`, `clickPointerType` and `DOUBLE_TAP_MS` are not exported (the import fails, so the whole file errors). `legend.double-click.test.ts`: the two-taps test sees `['A', 'B', 'C']` (both taps toggle), the dblclick test sees `['A']` only after the dblclick re-isolates with three plot states, the no-pointer-type test sees `['A', 'B', 'C']`. `legend-row.test.ts`: Vitest does not type-check, so the unknown `onPointerDown` key does not stop the file; "a touch pointerenter …" fails (the row listens for `mouseenter`, so the mouse `pointerenter` never calls `onHover`) and "a press on the main button …" fails (no `pointerdown` listener). `drag-controller.test.ts`: the options test fails at `delay` (Sortable's default 0; `touchStartThreshold` defaults to the device pixel ratio, 1), the touchmove test fails (nothing prevents the move while lifted), and both fallback tests fail because the snapshot taken at `onStart` holds the ghost and `restoreDom` appends it again (five children).

- [ ] **Step 5: Add the tap helpers**

Append to `packages/core/src/components/legend/legend-helpers.ts`, after `isolationBase`:

```ts
/** Two taps on the same row this close together isolate it, as a double-click does. */
export const DOUBLE_TAP_MS = 300;

/** A click this soon after a pointerdown on a row came from that press. */
const CLICK_AFTER_PRESS_MS = 1000;

/**
 * True for the second of two touch or pen taps on the same row within DOUBLE_TAP_MS. Not every
 * engine sends a dblclick for a double tap (iOS Safari does not), so the legend counts the taps
 * itself; mouse double-clicks keep `isSecondClickOfDouble` and the dblclick.
 */
export function isDoubleTap(
  previous: { valueKey: string; time: number } | null,
  current: { valueKey: string; time: number; pointerType: string },
): boolean {
  if (current.pointerType !== 'touch' && current.pointerType !== 'pen') return false;
  if (!previous || previous.valueKey !== current.valueKey) return false;
  const gap = current.time - previous.time;
  return gap >= 0 && gap <= DOUBLE_TAP_MS;
}

/**
 * The pointer behind a click: its own `pointerType` (a click is a PointerEvent in current
 * engines), else the row press just before it, else a mouse (a script's or a screen reader's click).
 */
export function clickPointerType(
  click: { pointerType?: string; timeStamp: number },
  lastDown: { pointerType: string; time: number } | null,
): string {
  if (click.pointerType) return click.pointerType;
  if (lastDown && click.timeStamp - lastDown.time <= CLICK_AFTER_PRESS_MS) {
    return lastDown.pointerType;
  }
  return 'mouse';
}
```

- [ ] **Step 6: Handle taps, double taps and the row's press in the legend**

In `packages/core/src/components/legend/legend-row.ts`:

In `interface LegendRowHandlers`, after `onNamePointerEnter(e: PointerEvent): void;` add:

```ts
  /** A press on the main button: tells a tap from a click, and starts a long press on the name. */
  onPointerDown(e: PointerEvent): void;
```

In `renderLegendRow`, replace the row's two hover bindings

```ts
      @mouseenter=${() => handlers.onHover(item.value)}
      @mouseleave=${() => handlers.onHover(null)}
```

with

```ts
      @pointerenter=${(e: PointerEvent) => {
        // A finger has no hover: a tap's highlight would stay until the next tap elsewhere.
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') handlers.onHover(item.value);
      }}
      @pointerleave=${() => handlers.onHover(null)}
```

and on the `<button class="legend-item-main">`, after `@pointerenter=${handlers.onNamePointerEnter}` add:

```ts
        @pointerdown=${handlers.onPointerDown}
```

In `packages/core/src/components/legend/legend.ts`:

In the import from `./legend-helpers`, after `isolationBase,` add:

```ts
  isDoubleTap,
  clickPointerType,
```

After the field

```ts
  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;
```

add:

```ts
  // Touch: the last tap on a row (a second one soon after isolates), the pointer behind the last
  // row click (a dblclick after touch taps is ignored) and the last row press (older Safari sends
  // clicks with no pointer type).
  private _lastTap: { valueKey: string; time: number } | null = null;
  private _lastClickPointer = 'mouse';
  private _lastRowPointerDown: { pointerType: string; time: number } | null = null;
```

Replace `_handleItemMouseClick` and `_handleItemMouseDoubleClick` (with the doc comment above the first) with:

```ts
  /**
   * Toggles, except on the second click of a mouse double-click (`isSecondClickOfDouble`). The
   * second of two quick taps on one row isolates it (`isDoubleTap`), as a double-click does.
   */
  private _handleItemMouseClick(value: string, event: MouseEvent): void {
    const valueKey = valueToKey(value);
    const pointerType = clickPointerType(event, this._lastRowPointerDown);
    this._lastClickPointer = pointerType;
    if (isSecondClickOfDouble(this._firstClick, valueKey, { detail: event.detail, pointerType })) {
      return;
    }
    if (isDoubleTap(this._lastTap, { valueKey, time: event.timeStamp, pointerType })) {
      this._lastTap = null;
      this._isolateFromFirstClick(value);
      return;
    }
    const touch = pointerType === 'touch' || pointerType === 'pen';
    this._lastTap = touch ? { valueKey, time: event.timeStamp } : null;

    const itemsBefore = this._legendItems;
    this._handleItemClick(value);
    this._firstClick =
      event.detail === 1 ? { valueKey, itemsBefore, itemsAfter: this._legendItems } : null;
  }

  private _handleItemMouseDoubleClick(value: string): void {
    // Touch and pen double taps isolated on their second tap already.
    if (this._lastClickPointer === 'touch' || this._lastClickPointer === 'pen') return;
    this._isolateFromFirstClick(value);
  }

  private _isolateFromFirstClick(value: string): void {
    const first = this._firstClick;
    this._firstClick = null;
    this._handleItemDoubleClick(value, isolationBase(first, valueToKey(value), this._legendItems));
  }
```

In `_renderLegendItem`, in the `handlers` object, after `onNamePointerEnter: this._nameTooltip.onNamePointerEnter,` add:

```ts
      onPointerDown: (e: PointerEvent) => {
        this._lastRowPointerDown = { pointerType: e.pointerType, time: e.timeStamp };
        this._nameTooltip.onNamePointerDown(e);
      },
```

(`onNamePointerDown` arrives in Step 8; until then this step does not type-check, which is fine: Steps 6–9 land in one commit.)

Update the row hovers in the two score tests: in `packages/core/src/components/legend/legend.score-strips.test.ts` replace

```ts
    rowA.dispatchEvent(new Event('mouseenter'));
```

with

```ts
    rowA.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
```

and

```ts
    rowA.dispatchEvent(new Event('mouseleave'));
```

with

```ts
    rowA.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
```

In `packages/core/src/components/legend/legend.score-sync.test.ts` replace every

```ts
    row.dispatchEvent(new Event('mouseenter', { bubbles: false }));
```

(three occurrences) with

```ts
    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
```

and the one

```ts
    row.dispatchEvent(new Event('mouseleave', { bubbles: false }));
```

with

```ts
    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
```

Then, in `legend.score-strips.test.ts`, add after `'fills both strips’ value gutters when a legend row is hovered'` (it reuses that test's `setup()` and gutter reading):

```ts
  it('a touch pointerenter on a row fills no strip gutter', async () => {
    // A finger never sends the pointerleave that would clear a hover, so touch must not start one.
    const { legend } = await setup();
    const gutters = () =>
      (Array.from(legend.shadowRoot!.querySelectorAll('protspace-score-strip')) as StripElement[])
        .map((strip) => strip.shadowRoot!.querySelector('.strip-value')!.textContent!.trim())
        .join(' / ');

    const rowA = legend.shadowRoot!.querySelector('[data-value="A"]')!;
    rowA.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    await legend.updateComplete;
    expect(gutters()).toBe('— / —');
    expect(rowA.classList.contains('legend-item-score-hover')).toBe(false);
  });
```

(It passes before this step too, because rows listened to `mouseenter` until now; it guards the switch to `pointerenter`. `legend-row.test.ts`'s "a touch pointerenter does not set the hovered category; a mouse one does" is the case that fails first.)

- [ ] **Step 7: Lift rows on touch only after a rest, and clean up the floating copy**

In `packages/core/src/components/legend/controllers/drag-controller.ts`, after the imports add:

```ts
/** How long a finger rests on a drag handle before the row lifts; a swipe moves first and scrolls. */
const TOUCH_DRAG_DELAY_MS = 250;

/** Sortable's class for the copy of the row that follows a finger in a touch drag. */
const FALLBACK_CLASS = 'sortable-fallback';
```

In the class, after `private highlightedOtherEl: HTMLElement | null = null;` add:

```ts
  private dragging = false;

  /**
   * While a row is lifted, a finger's move drags it instead of scrolling the list. Sortable does
   * this itself except on Chrome for Android, and a handle's touch-action cannot change once its
   * touch has started, so the list stops the scroll here.
   */
  private onTouchMove = (event: Event): void => {
    if (this.dragging && event.cancelable) event.preventDefault();
  };
```

In `initialize`, replace

```ts
    this.containerEl = container;
```

with

```ts
    this.containerEl = container;
    container.addEventListener('touchmove', this.onTouchMove, { passive: false });
```

and in the Sortable options, after `handle: '.drag-handle',` add:

```ts
      // On touch a row lifts only after the finger rests on its handle; a swipe that starts on a
      // handle moves past the threshold first, so it scrolls the list. Mouse drags start at once.
      delay: TOUCH_DRAG_DELAY_MS,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      fallbackClass: FALLBACK_CLASS,
```

Replace `handleDragStart` with:

```ts
  private handleDragStart(evt: Sortable.SortableEvent): void {
    this.dragging = true;
    // A touch drag floats a copy of the row in the list (Sortable's fallback). Sortable removes it
    // on drop, before `restoreDom` runs, so it must not be put back with the rows.
    this.preDragChildNodes = Array.from(evt.from.childNodes).filter(
      (node) => !(node instanceof Element && node.classList.contains(FALLBACK_CLASS)),
    );
  }
```

At the start of `handleDragEnd`, before `const wasMergeTarget = this.highlightedOtherEl !== null;`, add:

```ts
    this.dragging = false;
```

In `restoreDom`, after the block that re-appends `preDragChildNodes` (the `if (this.preDragChildNodes.length > 0) { … }` block), add:

```ts
    // A copy an interrupted touch drag left behind would stay as a stray row.
    container.querySelectorAll(`:scope > .${FALLBACK_CLASS}`).forEach((node) => node.remove());
```

In `destroy`, replace

```ts
    this.containerEl = null;
```

with

```ts
    this.containerEl?.removeEventListener('touchmove', this.onTouchMove);
    this.containerEl = null;
    this.dragging = false;
```

In `packages/core/src/components/legend/styles/row.ts`:

In the `.legend-item-main { … }` rule, after `transition: none;` add:

```css
    /* A double tap isolates the row: it must not zoom the page, and a long press on the name shows
       it in full, not the system's callout. */
    touch-action: manipulation;
    -webkit-touch-callout: none;
```

Inside the `@media (pointer: coarse) { … }` block, after the `.legend-hidden-mark { display: none; }` rule, add:

```css
    .legend-action,
    .drag-handle {
      width: var(--ps-touch-target);
      height: var(--ps-touch-target);
    }
```

and replace the selector line `.legend-item-fallback {` (in the `.legend-item-drag, .legend-item-fallback` rule) with `.sortable-fallback {`.

The handle keeps the default `touch-action`, so a swipe that starts on it pans the list; the rest (Sortable's delay) keeps that swipe from lifting the row.

- [ ] **Step 8: Show a truncated name on a long press**

In `packages/core/src/components/legend/legend-list.ts`, after `export const NAME_TOOLTIP_DELAY_MS = 500;` add:

```ts
/** A finger that moves this far before its long press ends is scrolling: no name shows. */
const LONG_PRESS_SLOP_PX = 10;

/** The click a lifted long press makes arrives within this; a later click is the next tap. */
const LONG_PRESS_CLICK_MS = 600;

/** A finger or pen held on a row's name. */
interface NamePress {
  button: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
  shown: boolean;
}

const preventDefault = (event: Event) => event.preventDefault();

/** Swallows the click a lifted long press makes, so showing a name never toggles its row. */
function swallowNextClick(button: HTMLElement): void {
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  button.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(
    () => button.removeEventListener('click', swallow, { capture: true }),
    LONG_PRESS_CLICK_MS,
  );
}
```

In `class TruncatedNameTooltip`, after `private _trigger: HTMLElement | null = null;` add:

```ts
  private _press: NamePress | null = null;
```

Replace `onNamePointerEnter` (with its doc comment) with:

```ts
  /** A row's main button `pointerenter` handler: hovers the button's `.legend-text`. */
  onNamePointerEnter = (e: PointerEvent): void => {
    // A finger has no hover; on touch a long press shows the name (onNamePointerDown).
    if (e.pointerType === 'touch') return;
    const button = e.currentTarget as HTMLElement;
    const text = button.querySelector<HTMLElement>('.legend-text');
    if (text) this.hover(button, text);
  };

  /**
   * A row's main button `pointerdown` handler. A finger or pen held NAME_TOOLTIP_DELAY_MS on a name
   * that ends in an ellipsis shows it in full until it lifts, and the click that lift makes does not
   * toggle the row. Moving LONG_PRESS_SLOP_PX first (a scroll), or a cancel, shows nothing.
   */
  onNamePointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this._endPress();
    const button = e.currentTarget as HTMLElement;
    const textEl = button.querySelector<HTMLElement>('.legend-text');
    if (!textEl || textEl.scrollWidth <= textEl.clientWidth) return;
    // A pen that hovered first: its hover timer gives way to the press.
    this.leave();
    const text = textEl.textContent?.trim() ?? '';
    const press: NamePress = {
      button,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: null,
      shown: false,
    };
    press.timer = setTimeout(() => {
      press.timer = null;
      press.shown = true;
      this._trigger = button;
      void this._show(button, text);
    }, NAME_TOOLTIP_DELAY_MS);
    this._press = press;
    button.addEventListener('pointermove', this._onPressMove);
    button.addEventListener('pointerup', this._onPressEnd);
    button.addEventListener('pointercancel', this._onPressEnd);
    button.addEventListener('contextmenu', preventDefault);
  };
```

Replace `hostDisconnected` with:

```ts
  hostDisconnected(): void {
    this._endPress();
    this.leave();
  }
```

After `private _onLeave = (): void => this.leave();` add:

```ts
  private _onPressMove = (e: PointerEvent): void => {
    const press = this._press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX) this._endPress();
  };

  private _onPressEnd = (e: PointerEvent): void => {
    const press = this._press;
    if (!press || e.pointerId !== press.pointerId) return;
    if (press.shown && e.type === 'pointerup') swallowNextClick(press.button);
    this._endPress();
  };

  /** Ends a long press on a name: its timer, its listeners and the name it showed. */
  private _endPress(): void {
    const press = this._press;
    if (!press) return;
    this._press = null;
    if (press.timer !== null) clearTimeout(press.timer);
    press.button.removeEventListener('pointermove', this._onPressMove);
    press.button.removeEventListener('pointerup', this._onPressEnd);
    press.button.removeEventListener('pointercancel', this._onPressEnd);
    press.button.removeEventListener('contextmenu', preventDefault);
    if (press.shown) this.leave();
  }
```

Update the class doc comment's first sentence to: "One shared tooltip for row names that end in an ellipsis: after NAME_TOOLTIP_DELAY_MS of mouse or pen hover on a row's main button, or of a finger held on it, it shows the full name; a name that fits shows nothing."

- [ ] **Step 9: Run the unit tests to verify they pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend-helpers.test.ts src/components/legend/legend.double-click.test.ts src/components/legend/legend-row.test.ts src/components/legend/controllers/drag-controller.test.ts src/components/legend/legend.score-strips.test.ts src/components/legend/legend.score-sync.test.ts src/components/legend/legend.rows.test.ts src/components/legend/legend.keyboard-reorder.test.ts`
Expected: PASS, every test.

- [ ] **Step 10: Write the browser tests for the long press and the coarse targets**

In `packages/core/src/components/legend/legend.rows.browser.test.ts`, append inside `describe('legend rows in a browser', …)`, before the coarse test ("under a coarse pointer rows are 40 px and the actions always show"):

```ts
  /** Synthetic touch on a row's main button, at its name; `dx` moves the finger. */
  function touchOn(main: HTMLElement) {
    const box = main.getBoundingClientRect();
    const at = { x: box.left + 20, y: box.top + box.height / 2 };
    return (type: string, dx = 0) =>
      main.dispatchEvent(
        new PointerEvent(type, {
          pointerType: 'touch',
          pointerId: 7,
          isPrimary: true,
          bubbles: true,
          composed: true,
          clientX: at.x + dx,
          clientY: at.y,
          detail: type === 'click' ? 1 : 0,
        }),
      );
  }

  it('a 500 ms touch hold on a truncated name shows it, and the click that ends it does not toggle', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const main = part(legend, LONG, '.legend-item-main');
    const touch = touchOn(main);

    touch('pointerdown');
    await pause(NAME_TOOLTIP_DELAY_MS - 200);
    expect(shown()).toBe(false);
    await expect.poll(shown, { timeout: 1000 }).toBe(true);
    expect(tooltip.text).toBe(LONG);

    touch('pointerup');
    touch('click');
    await settle(legend);
    expect(shown()).toBe(false);
    expect(main.getAttribute('aria-pressed')).toBe('true');
  });

  it('moving 12 px first cancels it, and the tap toggles', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const shown = () => tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open');
    const main = part(legend, LONG, '.legend-item-main');
    const touch = touchOn(main);

    touch('pointerdown');
    touch('pointermove', 12);
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(shown()).toBe(false);
    touch('pointerup');
    touch('click');
    await settle(legend);
    expect(main.getAttribute('aria-pressed')).toBe('false');
  });

  it('a touch pointerenter on a truncated name shows nothing', async () => {
    const legend = await mount();
    const tooltip = legend.shadowRoot!.querySelector<PsTooltip>('ps-tooltip.name-tooltip')!;
    const main = part(legend, LONG, '.legend-item-main');
    touchOn(main)('pointerenter');
    await pause(NAME_TOOLTIP_DELAY_MS + 200);
    expect(tooltip.shadowRoot!.querySelector('.tip')!.matches(':popover-open')).toBe(false);
  });
```

In the coarse test ("under a coarse pointer rows are 40 px and the actions always show"), after `expect(opacity(part(legend, 'Short', '.legend-item-actions'))).toBe('1');` add:

```ts
      for (const selector of ['.legend-eye', '.drag-handle', '.legend-more']) {
        const box = part(legend, 'Short', selector).getBoundingClientRect();
        expect(box.width, selector).toBeCloseTo(40, 0);
        expect(box.height, selector).toBeCloseTo(40, 0);
      }
```

- [ ] **Step 11: Run the browser tests**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.rows.browser.test.ts src/components/legend/legend.color-picker.browser.test.ts src/components/legend/legend.escape-order.browser.test.ts`
Expected: PASS, every test (the mouse drag test "dragging it reorders the rows" still passes: the delay is touch-only). Had Steps 6–8 not run, the long-press test would fail at "shows it" and the coarse test at the 24 px eye.

- [ ] **Step 12: Run the phone legend spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts`
Expected: PASS for G1, G2, G3, G4, G5; G6 and G8 pass or stay skipped as their own tasks left them. If G3 fails because the list scrolls instead of the row lifting, check that the `touchmove` guard from Step 7 is on the list (`.legend-items`) Sortable was initialised on.

- [ ] **Step 13: Document legend rows on touch**

In `docs/developers/api/index.md`, in the "Legend" section, after the paragraph that ends "The parts `dialog-overlay` and `dialog-content` are gone.", insert:

```md
On a touch screen a tap shows or hides a row, and a second tap on the same row within 300 ms
isolates it, whether or not the browser sends a `dblclick` (one that follows touch taps is
ignored). A finger held 250 ms on a row's drag handle lifts the row to reorder it; a swipe that
starts on the handle scrolls the list. A finger held 500 ms on a name that ends in an ellipsis
shows it in full until it lifts, without toggling the row. A row marks its score-strip dot on mouse
or pen hover only.
```

- [ ] **Step 14: Commit**

Run: `wc -l packages/core/src/components/legend/legend.ts` (report it; about 2,180).
Run: `pnpm exec prettier --check packages/core/src/components/legend apps/web/tests/mobile-legend.spec.ts docs/developers/api/index.md`
Expected: clean (run `pnpm exec prettier --write` on any file it lists, then check again).

```bash
git add packages/core/src/components/legend/legend-helpers.ts packages/core/src/components/legend/legend-helpers.test.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.double-click.test.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/legend-row.test.ts packages/core/src/components/legend/legend.score-strips.test.ts packages/core/src/components/legend/legend.score-sync.test.ts packages/core/src/components/legend/legend-list.ts packages/core/src/components/legend/legend.rows.browser.test.ts packages/core/src/components/legend/controllers/drag-controller.ts packages/core/src/components/legend/controllers/drag-controller.test.ts packages/core/src/components/legend/styles/row.ts apps/web/tests/mobile-legend.spec.ts docs/developers/api/index.md
git commit -m "feat(core): tap, double tap and long press on legend rows"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

Report: the counts of each test file run before and after, LEGACY 7, `wc -l legend.ts`, whether G1 and G2 were already green, and the "Unrun at task time" list for the exit run.

### Task 5.12: Touch targets and phone fit for the remaining controls

The last coarse-pointer gaps close: the plot's tool strip is pinned at 40 px targets, the structure viewer's close and protein-pick buttons, the query builder's value-chip remove and the duplicate-stack spiderfy nodes become 40 px targets, and the figure editor stacks its preview over its settings on a phone and keeps a row layout on a short landscape screen.

**Files:**

- Modify: `packages/core/src/components/plot-tools/plot-tools.browser.test.ts` (`plot-tools.styles.ts` needs no change: the strip's buttons are `ps-icon-button`s, which the kit already makes 40×40 under a coarse pointer, `kit/button.styles.ts:83`; the test pins that)
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` (coarse `.close-button`, `.protein-pick`; LEGACY stays 7: the module still holds raw colours such as `#c53030` and `rgba(0, 0, 0, 0.04)`), `structure-viewer.browser.test.ts`
- Modify: `packages/core/src/components/query-builder/query-builder.styles.ts` (coarse `.value-chip-remove` 40×40 without growing the 22 px chip), `query-builder.browser.test.ts`
- Modify: `packages/core/src/components/scatter-plot/duplicate-stacks/spiderfy-layer.ts`; create `spiderfy-layer.touch.test.ts`
- Modify: `packages/core/src/components/publish/publish-modal.styles.ts` (at `PHONE_MEDIA`: `.publish-container` column, preview `flex: 0 0 40%`, sidebar `flex: 1 1 auto; min-width: 0; max-width: none; overflow: auto`; on a short landscape screen: row layout, sidebar `min(50vw, 340px)`; the `@media (max-width: 800px)` rule stays for tablets and is overridden by both), `publish-modal.browser.test.ts`
- Modify: `apps/web/tests/mobile-bars.spec.ts` (C7), `mobile-legend.spec.ts` (G8), `mobile-plot-touch.spec.ts` (P7) — fixmes removed
- Modify: `docs/developers/api/index.md` (the figure editor on a phone)
- Read: branch commit `b8397fc2` (spiderfy tap disc) for reference

**Interfaces:**

- Consumes: `PHONE_MEDIA` (`'(max-width: 640px)'`) and `LANDSCAPE_PHONE_MEDIA` (`'(orientation: landscape) and (max-height: 500px) and (max-width: 950px)'`) from `packages/core/src/utils/breakpoints.ts` (Task 5.6); `--ps-touch-target` (40 px); `ps-dialog size="full"` at phone sizes (Task 5.10: `100vw × 100dvh` under `COMPACT_MEDIA`); the spiderfy layer's `SpiderfyLayer.render(layer, stack, k)` and its `SpiderfyLayerDeps` (`getColor`, `onActivate`, `onHover`, `onHoverEnd`).
- Produces:
  - Coarse rules (`@media (pointer: coarse)`): the viewer's `.close-button` and `.protein-pick` ≥ 40×40; the chip remove ≥ 40×40 with negative margins, so the chip stays 22 px tall; the tool strip keeps the kit's rule.
  - Spiderfy: under a coarse pointer (`matchMedia('(pointer: coarse)')` read at render; the layer's API takes no pointer parameter and its only caller, the scatterplot, needs none) each node gets an invisible tap disc, `circle.dup-spiderfy-node-hit` with `fill="transparent"`, radius 20 px or half the gap to its neighbours if smaller (`min(20, r · sin(π / n))`, never below the 5 px dot), drawn under the dot. The press/release handlers move from the dot to the node group `g.dup-spiderfy-node`, so the disc and the dot both select; mouse rendering is unchanged (no disc).
  - Figure editor layouts as listed; its dialog's "Close" stays visible (the kit's 40 px icon button).

**Tests:**

- `plot-tools.browser.test.ts`: "under a coarse pointer the tool buttons are 40 px" (CDP touch emulation, as `legend.rows.browser.test.ts:267` does).
- `spiderfy-layer.touch.test.ts`: "with a coarse pointer each node has a 20 px tap disc that selects it"; "keeps neighbouring discs apart on a crowded ring"; "with a fine pointer there is no disc".
- `structure-viewer.browser.test.ts`: "under a coarse pointer the close button and the protein pick are 40 px targets".
- `query-builder.browser.test.ts`: "under a coarse pointer a value chip's remove is a 40 px target and the chip stays 22 px tall".
- `publish-modal.browser.test.ts`: "at 375 × 667 the preview sits over the settings and takes 40% of the height"; "at 740 × 360 the preview and the settings stay side by side, the settings 340 px wide".
- `mobile-*`: C7, G8, P7 green.
- Unrun at task time (exit): `mobile-bars.spec.ts` (C7), `mobile-plot-touch.spec.ts` (P7), `figure-editor.spec.ts`, `workbench-filter.spec.ts`, `workbench-structure.spec.ts`, `url-view-state.spec.ts` (duplicate stacks), `eat-visualization.spec.ts`.

Verification: the touched core test files (unit and browser, sandbox disabled for browser); `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts -g "[Ff]igure [Ee]ditor"` (G8) as the one e2e run. LEGACY count stays 7.

- [ ] **Step 1: Remove the fixmes for the controls (C7, P7)**

Run: `grep -n "fixme(true, 'task 5.12')" apps/web/tests/mobile-*.spec.ts`
Expected: C7 in `mobile-bars.spec.ts`, G8 in `mobile-legend.spec.ts`, and P7 in `mobile-plot-touch.spec.ts` unless Task 5.1 found it green (the kit already sizes the strip's buttons). Delete the C7 and P7 `test.fixme(true, 'task 5.12');` lines now; G8's goes in Step 11. Both run at the phase exit (one e2e spec per task, and this task's is G8).

- [ ] **Step 2: Write the failing tests for the coarse targets**

In `packages/core/src/components/plot-tools/plot-tools.browser.test.ts`, change `import { page, userEvent } from 'vitest/browser';` to

```ts
import { cdp, page, userEvent } from 'vitest/browser';
```

and append inside `describe('protspace-plot-tools', …)`, after its last test ("focusTool focuses the current tool"):

```ts
  it('under a coarse pointer the tool buttons are 40 px', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Fail loudly if this Chromium does not flip the media feature.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const el = await mount();
      const buttons = [...el.shadowRoot!.querySelectorAll<PsIconButton>('ps-icon-button')];
      expect(buttons).toHaveLength(4);
      for (const button of buttons) {
        const box = inner(button).getBoundingClientRect();
        expect(box.width, button.label).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.height, button.label).toBeGreaterThanOrEqual(40 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
```

In `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts`, change `import { userEvent } from 'vitest/browser';` to

```ts
import { cdp, userEvent } from 'vitest/browser';
```

and append at the end of the file:

```ts
describe('protspace-structure-viewer under a coarse pointer', () => {
  it('the close button and the protein pick are 40 px targets', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const viewer = await mount();
      viewer.proteinChoices = ['P11111', 'P12345', 'P22222'];
      await viewer.updateComplete;
      for (const selector of ['.close-button', 'button.protein-pick']) {
        const box = viewer.shadowRoot!.querySelector(selector)!.getBoundingClientRect();
        expect(box.width, selector).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.height, selector).toBeGreaterThanOrEqual(40 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
```

In `packages/core/src/components/query-builder/query-builder.browser.test.ts`, add after the existing imports:

```ts
import { cdp } from 'vitest/browser';
```

and append inside `describe('protspace-query-builder in a narrow panel', …)`, after its last test ("closePopups releases an open picker’s layer"):

```ts
  it('under a coarse pointer a value chip’s remove is a 40 px target and the chip stays 22 px tall', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      const builder = await mount([
        createCondition({ annotation: 'organism', values: ['Human', 'Mouse'] }),
      ]);
      const row = rows(builder)[0].shadowRoot!;
      const chip = row.querySelector('.value-chip')!.getBoundingClientRect();
      const remove = row.querySelector<HTMLElement>('.value-chip-remove')!;
      const box = remove.getBoundingClientRect();
      expect(chip.height).toBeCloseTo(22, 0);
      expect(box.width).toBeGreaterThanOrEqual(40 - 0.5);
      expect(box.height).toBeGreaterThanOrEqual(40 - 0.5);
      // A press near the target's corner, outside the chip, still reaches the button.
      expect(row.elementFromPoint(box.left + 2, box.top + 2)).toBe(remove);
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
```

Create `packages/core/src/components/scatter-plot/duplicate-stacks/spiderfy-layer.touch.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotDataPoint } from '@protspace/utils';
import { SpiderfyLayer } from './spiderfy-layer';
import type { ViewportDuplicateStack } from './duplicate-stack-types';

const pt = (id: string): PlotDataPoint => ({ id, x: 0, y: 0, originalIndex: 0 });

/** Renders a ring of `count` duplicates with the pointer coarse or fine. */
function renderRing(coarse: boolean, count: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse') }));
  const onActivate = vi.fn();
  const layer = new SpiderfyLayer({
    getColor: () => '#888888',
    onActivate,
    onHover: vi.fn(),
    onHoverEnd: vi.fn(),
  });
  const svg = d3.select(document.body).append('svg');
  const g = svg.append('g') as unknown as Parameters<SpiderfyLayer['render']>[0];
  const points = Array.from({ length: count }, (_, i) => pt(`p${i}`));
  layer.render(g, { px: 0, py: 0, points } as unknown as ViewportDuplicateStack, 1);
  return { root: svg.node()!, onActivate };
}

/** A pointer event as jsdom can build it: a MouseEvent of that type with a pointer id. */
function pointer(type: string, target: Element): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

describe('spiderfy ring on a touch screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('with a coarse pointer each node has a 20 px tap disc that selects it', () => {
    const { root, onActivate } = renderRing(true, 2);
    const discs = root.querySelectorAll('.dup-spiderfy-node-hit');
    expect(discs).toHaveLength(2);
    // Two nodes on a 22 px ring sit 44 px apart: room for the whole 20 px disc.
    expect(Number(discs[0].getAttribute('r'))).toBe(20);
    expect(discs[0].getAttribute('fill')).toBe('transparent');
    // Under the dot, so the dot still draws on top.
    expect(discs[0].nextElementSibling?.classList.contains('dup-spiderfy-node-circle')).toBe(true);

    pointer('pointerdown', discs[1]);
    pointer('pointerup', discs[1]);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0][1].id).toBe('p1');
  });

  it('keeps neighbouring discs apart on a crowded ring', () => {
    const { root } = renderRing(true, 30);
    const r = Number(root.querySelector('.dup-spiderfy-node-hit')!.getAttribute('r'));
    // Ring radius 70: neighbours sit 2 · 70 · sin(π / 30) ≈ 14.6 px apart.
    expect(r).toBeCloseTo(70 * Math.sin(Math.PI / 30), 6);
  });

  it('with a fine pointer there is no disc, and the dot still selects', () => {
    const { root, onActivate } = renderRing(false, 3);
    expect(root.querySelectorAll('.dup-spiderfy-node-hit')).toHaveLength(0);
    const dots = root.querySelectorAll('.dup-spiderfy-node-circle');
    expect(dots).toHaveLength(3);
    pointer('pointerdown', dots[2]);
    pointer('pointerup', dots[2]);
    expect(onActivate.mock.calls[0][1].id).toBe('p2');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/duplicate-stacks/spiderfy-layer.touch.test.ts src/components/scatter-plot/duplicate-stacks/spiderfy-layer.test.ts`
Expected: FAIL in the two coarse spiderfy tests (no `.dup-spiderfy-node-hit` exists); "with a fine pointer …" and `spiderfy-layer.test.ts` pass.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/plot-tools.browser.test.ts src/components/structure-viewer/structure-viewer.browser.test.ts src/components/query-builder/query-builder.browser.test.ts`
Expected: FAIL in the viewer test (close button 28×28, pick 28 px tall) and the chip test (the remove is about 7×16). "under a coarse pointer the tool buttons are 40 px" PASSES already: it pins the kit's coarse rule, which this task relies on rather than repeats.

- [ ] **Step 4: Make the viewer's and the query builder's buttons touch targets**

In `packages/core/src/components/structure-viewer/structure-viewer.styles.ts`, after the rule

```css
  .close-button:hover {
    color: var(--protspace-viewer-text);
    background: rgba(0, 0, 0, 0.04);
  }
```

add:

```css
  /* Touch: the close and protein-pick buttons are 40 px targets (the app's header is 44 px). */
  @media (pointer: coarse) {
    .close-button,
    .protein-pick {
      min-width: var(--ps-touch-target);
      min-height: var(--ps-touch-target);
    }
  }
```

In `packages/core/src/components/query-builder/query-builder.styles.ts`, after the rule

```css
    .value-chip-remove:hover {
      opacity: 1;
    }
```

add:

```css
    /* Touch: a 40 px target around the ×. The negative margins take back what it adds, so the
       chip stays 22 px tall and about as wide; the target overhangs it on every side. */
    @media (pointer: coarse) {
      .value-chip-remove {
        min-width: var(--ps-touch-target);
        min-height: var(--ps-touch-target);
        margin-block: calc((var(--ps-touch-target) - 22px) / -2);
        margin-inline: -12px calc(-12px - var(--ps-space-1));
      }
    }
```

- [ ] **Step 5: Give spiderfy nodes a fingertip tap disc**

In `packages/core/src/components/scatter-plot/duplicate-stacks/spiderfy-layer.ts`, after `const SPIDERFY_NODE_RADIUS = 5;` add:

```ts
/** Largest tap disc around a node: 40 px across, the comfortable touch target. */
const SPIDERFY_TOUCH_HIT_RADIUS = 20;

/** The tap disc around each node: as wide as the gap to its neighbours allows, up to a fingertip. */
function touchHitRadius(nodes: SpiderNode[]): number {
  const n = nodes.length;
  const halfGap = n > 1 ? nodes[0].r * Math.sin(Math.PI / n) : SPIDERFY_TOUCH_HIT_RADIUS;
  return Math.max(SPIDERFY_NODE_RADIUS, Math.min(SPIDERFY_TOUCH_HIT_RADIUS, halfGap));
}
```

In `render`, replace everything from the comment `// Create circles with explicit pointer-events and handle selection via pointer press/release.` to the end of the method (the `.on('mouseleave', …);` chain) with:

```ts
    // A fingertip is far wider than the dot: under a coarse pointer an invisible disc behind each
    // dot takes the tap. Mouse rendering is unchanged.
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
      gNodes
        .append('circle')
        .attr('class', 'dup-spiderfy-node-hit')
        .attr('r', touchHitRadius(nodes))
        .attr('fill', 'transparent')
        .style('pointer-events', 'all');
    }

    gNodes
      .append('circle')
      .attr('class', 'dup-spiderfy-node-circle')
      .attr('r', SPIDERFY_NODE_RADIUS)
      .attr('fill', (d) => this.deps.getColor(d.point))
      .style('pointer-events', 'all')
      .style('cursor', 'pointer');

    // The node selects on press and release, from its dot or its tap disc alike. Native 'click' is
    // avoided because d3.zoom's gesture handling can suppress it.
    gNodes
      .on('pointerdown', (event: PointerEvent) => {
        event.stopPropagation();
        if (typeof event.pointerId === 'number') {
          this.pressByPointerId.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            t: Date.now(),
          });
        }
        // Keep pointer events routed to this node even if the pointer moves slightly.
        const el = event.currentTarget as Element | null;
        if (
          el &&
          typeof el.setPointerCapture === 'function' &&
          typeof event.pointerId === 'number'
        ) {
          try {
            el.setPointerCapture(event.pointerId);
          } catch {
            // ignore
          }
        }
      })
      .on('pointerup', (event: PointerEvent, d: SpiderNode) => {
        event.stopPropagation();
        const rec =
          typeof event.pointerId === 'number'
            ? this.pressByPointerId.get(event.pointerId)
            : undefined;
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
        if (!rec) return;
        // Treat a short, low-movement press/release as a click.
        if (
          isClickGesture(rec, { clientX: event.clientX, clientY: event.clientY, now: Date.now() })
        ) {
          this.deps.onActivate(event as unknown as MouseEvent, d.point);
        }
      })
      .on('lostpointercapture', (event: PointerEvent) => {
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
      })
      .on('pointercancel', (event: PointerEvent) => {
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
      })
      // Show the real tooltip for the hovered protein (not the stack centroid)
      .on('mouseenter', (event: MouseEvent, d: SpiderNode) => this.deps.onHover(event, d.point))
      .on('mouseleave', () => this.deps.onHoverEnd());
  }
```

(`scatter-plot.styles.ts` already gives `.dup-spiderfy-node` `pointer-events: all` and a pointer cursor; the disc needs no stylesheet rule, so that LEGACY module is not touched.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/duplicate-stacks src/styles/style-lint.test.ts`
Expected: PASS, every test; LEGACY 7.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/plot-tools.browser.test.ts src/components/structure-viewer/structure-viewer.browser.test.ts src/components/query-builder/query-builder.browser.test.ts`
Expected: PASS, every test (the header test "slotted header actions render before the close button" still holds: the close button only grows under a coarse pointer).

- [ ] **Step 7: Commit the touch targets**

Run: `pnpm exec prettier --check packages/core/src/components/plot-tools/plot-tools.browser.test.ts packages/core/src/components/structure-viewer packages/core/src/components/query-builder/query-builder.styles.ts packages/core/src/components/query-builder/query-builder.browser.test.ts packages/core/src/components/scatter-plot/duplicate-stacks apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-plot-touch.spec.ts`
Expected: clean (run `pnpm exec prettier --write` on any file it lists, then check again).

```bash
git add packages/core/src/components/plot-tools/plot-tools.browser.test.ts packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts packages/core/src/components/query-builder/query-builder.styles.ts packages/core/src/components/query-builder/query-builder.browser.test.ts packages/core/src/components/scatter-plot/duplicate-stacks/spiderfy-layer.ts packages/core/src/components/scatter-plot/duplicate-stacks/spiderfy-layer.touch.test.ts apps/web/tests/mobile-bars.spec.ts apps/web/tests/mobile-plot-touch.spec.ts
git commit -m "feat(core): touch-sized plot, structure and filter controls"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

- [ ] **Step 8: Write the failing figure editor layout tests**

In `packages/core/src/components/publish/publish-modal.browser.test.ts`, change `import { userEvent } from 'vitest/browser';` to

```ts
import { page, userEvent } from 'vitest/browser';
```

and append at the end of the file:

```ts
describe('protspace-publish-modal on a phone', () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  const rect = (modal: HTMLElement, selector: string) =>
    modal.shadowRoot!.querySelector(selector)!.getBoundingClientRect();

  it('at 375 × 667 the preview sits over the settings and takes 40% of the height', async () => {
    await page.viewport(375, 667);
    const { modal, native } = await mount();
    // The full dialog is the screen on a phone (ps-dialog's compact rule).
    expect(native.getBoundingClientRect().width).toBeCloseTo(375, 0);
    const container = rect(modal, '.publish-container');
    const preview = rect(modal, '.publish-preview');
    const sidebar = rect(modal, '.publish-sidebar');
    expect(preview.bottom).toBeLessThanOrEqual(sidebar.top + 0.5);
    expect(Math.abs(preview.height - 0.4 * container.height)).toBeLessThan(1);
    expect(sidebar.width).toBeCloseTo(container.width, 0);
    expect(sidebar.bottom).toBeLessThanOrEqual(container.bottom + 0.5);
  });

  it('at 740 × 360 the preview and the settings stay side by side, the settings 340 px wide', async () => {
    await page.viewport(740, 360);
    const { modal } = await mount();
    const preview = rect(modal, '.publish-preview');
    const sidebar = rect(modal, '.publish-sidebar');
    expect(preview.right).toBeLessThanOrEqual(sidebar.left + 0.5);
    expect(sidebar.width).toBeCloseTo(340, 0);
    expect(preview.width).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 9: Run them to verify they fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/publish/publish-modal.browser.test.ts`
Expected: FAIL in both new tests: at 375 the `max-width: 800px` rule stacks them but the preview takes what the 45vh-capped settings leave (not 40%); at 740×360 that same rule stacks them, so the preview is above the settings, not beside them. Every existing test passes.

- [ ] **Step 10: Lay the figure editor out for phones**

In `packages/core/src/components/publish/publish-modal.styles.ts`, change the imports to:

```ts
import { css, unsafeCSS } from 'lit';
import { LANDSCAPE_PHONE_MEDIA, PHONE_MEDIA } from '../../utils/breakpoints';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';
```

Replace the closing rule

```css
    @media (max-width: 800px) {
      .publish-container {
        flex-direction: column;
      }
      .publish-sidebar {
        flex: 0 0 auto;
        max-width: none;
        max-height: 45vh;
      }
    }
```

with

```css
    /* Tablets and narrow windows: the settings under the preview. */
    @media (max-width: 800px) {
      .publish-container {
        flex-direction: column;
      }
      .publish-sidebar {
        flex: 0 0 auto;
        max-width: none;
        max-height: 45vh;
      }
    }

    /* Phones: the preview takes the top 40% and the settings the rest, scrolling inside. */
    @media ${unsafeCSS(PHONE_MEDIA)} {
      .publish-container {
        flex-direction: column;
        gap: var(--ps-space-3);
      }
      .publish-preview {
        flex: 0 0 40%;
      }
      .publish-sidebar {
        flex: 1 1 auto;
        min-width: 0;
        max-width: none;
        max-height: none;
        overflow: auto;
      }
    }

    /* A phone on its side is too short to stack: preview and settings stay side by side. Last, so
       it wins over both rules above (a 640 × 360 phone matches all three). */
    @media ${unsafeCSS(LANDSCAPE_PHONE_MEDIA)} {
      .publish-container {
        flex-direction: row;
      }
      .publish-preview {
        flex: 1 1 auto;
      }
      .publish-sidebar {
        flex: 0 0 min(50vw, 340px);
        min-width: 0;
        max-width: none;
        max-height: none;
      }
    }
```

Update the module's doc comment to: "The figure editor inside its full-screen ps-dialog: the preview (canvas, then the tool strip) beside a 340 px settings column, the settings under the preview on a phone held upright, and the footer the dialog slots in."

- [ ] **Step 11: Run the figure editor tests and the phone spec**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/publish/publish-modal.browser.test.ts`
Expected: PASS, every test.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: PASS; LEGACY 7 (`publish-modal.styles.ts` is not in LEGACY and reads only tokens).

Delete G8's `test.fixme(true, 'task 5.12');` line in `apps/web/tests/mobile-legend.spec.ts`, then:

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile mobile-legend.spec.ts -g "[Ff]igure [Ee]ditor"`
Expected: PASS: the editor's dialog fills the viewport (± 1) and its "Close" is visible and at least 40 px, upright and at 740×360. If the grep matches no test, run `grep -n "test(" apps/web/tests/mobile-legend.spec.ts` and use G8's actual title.

- [ ] **Step 12: Document the figure editor on a phone**

In `docs/developers/api/index.md`, in the "Figure Editor" section, after the paragraph that ends "New figure and Reset offer Undo in the footer until the next edit.", insert:

```md

On a phone held upright (640 px wide or less) the dialog fills the screen, the preview takes its
top 40% and the settings scroll below it; on a phone turned sideways (500 px tall or less) the
preview and a settings column up to 340 px wide stay side by side.
```

- [ ] **Step 13: Commit the figure editor layout**

Run: `pnpm exec prettier --check packages/core/src/components/publish/publish-modal.styles.ts packages/core/src/components/publish/publish-modal.browser.test.ts apps/web/tests/mobile-legend.spec.ts docs/developers/api/index.md`
Expected: clean.

```bash
git add packages/core/src/components/publish/publish-modal.styles.ts packages/core/src/components/publish/publish-modal.browser.test.ts apps/web/tests/mobile-legend.spec.ts docs/developers/api/index.md
git commit -m "feat(core): figure editor layout for phones"
```

Report: the counts of each test file run before and after, LEGACY 7, whether P7 still carried a `task 5.12` fixme at Step 1, and the "Unrun at task time" list for the exit run.

## Phase 5 exit

1. Run `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile` first: it holds every test whose fixme came off with no run at task time (C5, C6, C7, C8, C9, C9b, C10, G6, P6, P7, P8, P9, P10, L2, the landscape bar test, the 360 px dialog test).
2. No `test.fixme(true, 'task 5.` remains: `grep -rn "fixme(true, 'task 5" apps/web/tests` is empty; only the two `'task 7.4'` tour fixmes remain in `mobile-bars.spec.ts`.
3. Suites (sandbox disabled where noted): `pnpm --filter @protspace/utils exec vitest --run`; `pnpm --filter @protspace/core exec vitest --run` (both projects, sandbox disabled); `pnpm --filter @protspace/app exec vitest --run`; counts recorded against the phase-start baseline.
4. E2E: then the specs every task listed as "Unrun at task time" (start with `eat-visualization`, `workbench-view-bar`, `workbench-shell`, `workbench-legend`, `workbench-structure`, `workbench-loading`, `dataset-reload`, `numeric-binning`, `legend-double-click`), then the whole suite `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (all chromium projects, `mobile` included); then `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project mobile --repeat-each 3` for flakes. A red run is fixed, never dismissed as flaky on local passes (AGENTS.md).
5. Perf: `pnpm perf:counts` and `pnpm perf` at 573K within the phase 4 numbers (hover path from 5.7 and legend pointer handling from 5.11 are the risks); `budgets.json` unchanged.
6. Quality: `pnpm quality`, `pnpm format:check`, `pnpm docs:build`; `grep -n "app-bar-actions" apps/web/src/workbench/workbench.css` shows no rule that sets `display: none` on the actions container itself (the popover-ancestor trap); style-lint LEGACY count reported (7, or 6 if 5.12 cleaned the viewer); `wc -l` of `scatter-plot.ts`, `legend.ts`, `structure-viewer.ts`, `workbench.css` reported.
7. Screenshots for the user, saved under `.superpowers/sdd/phase-5-mobile/screenshots/` (Pixel 7 emulation, light theme, demo dataset): phone 412×839 default; panel folded; a tapped protein with the folded sheet and its tooltip; the sheet expanded; the More sheet; the Filter tab; the search overlay; 360×740 default; tablet 768×1024 with a structure; landscape 915×412 at the scrolled position, folded and expanded; desktop 1280×720 unchanged. Compare against `mockups/phone.png` and `mockups/phone-landscape-and-tablet.png` and list visible differences (known: More is icon-only on phones; landscape puts search before Projection to keep Tab order).
8. Ledger: counts, deviations, the notes recorded for later in Rulings (⌘K with phone search closed, the folded legend's Tab order, icon-only More) and the dropped landing test titles (for 8.4) in `.superpowers/sdd/phase-5-mobile/progress.md`; `tasks.md` section 5 ticked in a `docs(openspec):` commit.

<!-- prettier-ignore-end -->
