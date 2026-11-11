# Explore Workbench, Phase 2: Shell and layout — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/explore` into the workbench: a 48 px app bar, a 44 px view bar that never wraps, the plot with its tool strip, and a flush right sidebar with an icon rail, the legend over a docked or floating structure viewer. `protspace-control-bar` is split into one-job elements coordinated by controllers in `apps/web/src/explore/`, and then deleted. The plot keeps the data's proportions, resizes once per layout change and keeps its viewed centre. Layout is remembered in the browser and never put in the URL. The legend's internals, the workflows (selection bar, chips, undo, filter panel, search messages), phones and dark mode are later phases; below 951 px a plain stacked fallback keeps the page usable.

**Architecture:** A React shell in `apps/web/src/workbench/` renders every runtime element (`#myPlot`, `#myLegend`, `#myStructureViewer`, `#myDataLoader` and the split controls) exactly once, in a fixed tree whose placements change only through CSS (data attributes and `--wb-*` custom properties). The plain-TS runtime in `apps/web/src/explore/` still finds them by id and wires them through small controllers (import, filter, view bar, selection, structure). Two module stores bridge the two sides: `layout-state.ts` (persisted to `protspace:layout:v1`) and `workbench-status.ts` (transient facts the runtime publishes, such as the dataset name). The lazy `/explore` route imports a new `@protspace/core/kit` subpath first, so tokens and kit elements exist at first paint while full core still loads with the runtime. Plot geometry comes from one `fitScales` function in `@protspace/utils`, shared by the live plot and the export renderer.

**Tech Stack:** Lit 3 (legacy decorators: `experimentalDecorators: true`, `useDefineForClassFields: false`), TypeScript 6, Vite 8, Vitest 4.1.9 (core: jsdom `unit` and Chromium `browser` projects; utils and app: node), Playwright 1.61, React 19 (`useSyncExternalStore`, `lazy`), React Router 7, Tailwind 4 (`*-ps-*` utilities from Task 1.3), the phase 1 kit (`ps-*` elements, `kit/layers.ts`, `@floating-ui/dom`), Lucide 0.462 (`lucide` in core, `lucide-react` in the shell), d3 7, the Web Animations API.

**Spec:** `openspec/changes/explore-workbench/design.md`: decisions 1 (workbench layout), 2 (sidebar, rail, floating structure), 3 (keep proportions), 4 (one redraw per layout change), 5 (tokens, Tailwind bridge, first paint), 8 (kit), 9 (control bar split), 10 (layout store), 11 (layer stack), 15 (help menu, kept ids, Import and Export menus), 17 (breakpoints, as a constraint only), 18 (code structure), 20 (testing) and 21 (delivery); `proposal.md` for scope; `tasks.md` section 2.

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there.

## Global Constraints

From phase 1, unchanged:

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

The kit and the style lint as phase 1 built them (read `packages/core/src/components/kit/` for the exact API; these facts override any older description):

- Tokens live in `@layer ps-theme` in `theme.ts`. Task 1.11 removed `--ps-weight-regular`, `--ps-space-4` and `--ps-duration`: a task that needs one re-adds it to `theme.ts` in the commit that first uses it (Task 2.12 re-adds `--ps-duration`), and a JavaScript read of a token, which the lint cannot see, never relies on a fallback value. `--ps-border-control` is the boundary of unchecked checkboxes, radios and off switches.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) checks every core stylesheet outside its `LEGACY` set (23 entries): no raw colour in any declaration, custom properties included; no `oklch()`, `lab()` or `color()`; no `var()` read of a variable `theme.ts` does not define (so new core styles read only `--ps-*` tokens); every `theme.ts` token is read somewhere in core or `apps/web/src`. A `LEGACY` entry must still violate, so a task that deletes or cleans a legacy module removes its line in the same commit.
- `customElement` comes from `../../utils/safe-custom-element` (relative to a component folder), never from `lit/decorators.js`.
- `ps-menu`: the owner receives `ps-close` before `ps-select` (the menu closes and hands focus back to its anchor first); Tab closes it; it sets `aria-haspopup` and `aria-expanded` on its anchor; a searchable menu's panel is `role="dialog"`; grouped items go in `ps-menu-group` (`label` attribute, `role="group"`), and every grouped menu uses it; radio exclusivity is menu-wide; checked rows are tinted.
- `ps-button` and `ps-icon-button` forward `hasPopup` and `expanded` (strings, attributes `aria-haspopup` and `aria-expanded`) to their inner button and take a `describedBy` element list; `ps-tooltip` describes its target through `ariaDescribedByElements`, and `namesTarget` (attribute `names-target`) marks a tooltip whose text is already the target's name; `ps-icon-button`'s own tooltip names its target.
- `ps-popover` re-shows after a DOM move without firing `ps-open` again and caps its height with Floating UI's `size`. `ps-dialog`: focus returns to the opener (with a Safari fallback); `dismiss()` releases its layer at once; a nested overlay's `ps-close` stops at the outer overlay's slot wrapper, so an owner listens on the nested element itself; `dismissible="false"` in markup means false; `size="full"` uses `100dvh`. `ps-checkbox` has a `label` property; `ps-select` binds its value with `live()`.
- `apps/web/src/custom-elements.d.ts` types each `ps-*` tag's properties (`KitProps`), its hyphenated attributes and its events; a property a tag's entry does not list fails `pnpm type-check`, so a task that sets a new kit property in JSX adds it there. Feature tags (`protspace-*`) have their own entries.
- Core's Vite build keeps `/^lit(\/|$)/`, `/^@floating-ui\//`, `d3` and `@protspace/utils` external.

Environment (from the phase 1 ledger and reports; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run (`pnpm --filter @protspace/core exec vitest --run`, which includes the browser project) need the Bash sandbox disabled; inside it they fail with `EPERM listen ::1`. `--project unit` works inside the sandbox.
- `pnpm add` and `pnpm install` need the sandbox disabled (store location and registry). `pkg@x.y.z` saves an exact version; match the neighbouring dependencies (`^x.y.z`) unless told to pin.
- `git commit` needs the sandbox disabled: the hook needs network and writes outside it. Stage files by path, never `git add -A`.
- `apps/web/tests/playwright.config.ts` runs only specs that a project's `testMatch` names. Task 1.3 added `foundation`; Task 2.2 adds `workbench` for every `workbench-*.spec.ts`. A spec no project matches reports "No tests found".
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `PLAYWRIGHT_PORT=… pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; always use the package-scoped forms above (`pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`).
- App unit tests run in node with no DOM and no React Testing Library. App modules that have unit tests import only types from `@protspace/core` (Lit cannot load in node), unless the test replaces the package with `vi.mock('@protspace/core', …)`. A test may import a pure core module from core's source by relative path (precedent: `apps/web/src/explore/eat-provenance.test.ts`). Controllers take their event roots (`document`) as options so tests pass fakes. React components are covered by e2e only.
- `pnpm perf:counts` (CI runs it on shard 1) imports `perf/datasets/phosphatase.parquetbundle`; fetch it once with `pnpm perf:fetch --only phosphatase` (network, sandbox disabled). It starts its own server on 8310 (or `PLAYWRIGHT_PORT`). Re-record budgets with `PERF_UPDATE_BUDGETS=1 pnpm perf:counts` and review the diff.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build in the hook scans untracked files under `docs/`: leave no scratch markdown there.
- Add a Lucide icon to core by importing its PascalCase export from `lucide` and adding a kebab-case key to `ICONS` in `packages/core/src/components/kit/icon.ts`, in the commit that first uses it; `ps-icon-button`'s `icon` takes those keys. `iconMarkup` is not in the kit barrel. The React shell uses `lucide-react` with `strokeWidth={1.75}`.
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.
- `pnpm docs:images` (`scripts/docs-screenshots/`, not in CI) keys on the control bar and breaks at runtime during this phase; phase 7 rewrites it. Its type-check (`pnpm type-check:scripts`, in the hook) must stay green.

Baseline: run the suites at the start of the phase and use those counts, not phase 1's: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run` and `PLAYWRIGHT_PORT=8475 pnpm test:e2e`. Record them in the phase 2 ledger; every task report gives the counts before and after.

Phase 2:

- Sizes: app bar 48 px; view bar at least 44 px while it still hosts the control bar, exactly 44 px from Task 2.10; rail 44 px; sidebar width default 300 px, stored between 240 and 480 px, and at render never so wide that the plot drops under 480 px (window − 44 − 480); divider: `legendFraction` default 0.5, stored between 0.2 and 0.8, at render the legend gets at least 120 px and the structure at least 220 px; floating card default 340 × 360 px at 14 px from the plot area's bottom-right corner, minimum 280 × 240 px; desktop from 951 px wide (`DESKTOP_MIN_WIDTH`), a stacked fallback below. These live in `apps/web/src/explore/layout-defaults.ts`, never as new `--ps-*` tokens.
- Storage: one key, `protspace:layout:v1`. Layout is never written to the URL. It is read once, parsed per field, and written once per committed change, never during a drag. No `storage` event listening. Clamps that depend on the window happen at render and never rewrite storage.
- Runtime elements are rendered by React exactly once, unconditionally, with stable ids, never keyed, never moved to another parent by a state change: collapsing, docking, floating and the narrow fallback are CSS only. They sit at a fixed position in the tree with static props only; a parent may re-render (status, props), but never with a `key`, a conditional or a second tree around a runtime element. React 19 runs without `StrictMode` here (do not add it). The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions` and `help` are kept for the tour, the e2e and the perf suites.
- At rest, no ancestor of `#myLegend`, the import menu or the projection details has `transform`, `translate`, `filter`, `contain` or `container-type`: they hold `position: fixed` popovers until phases 3 and 4. The sidebar's slide transform exists only while it slides (a WAAPI animation without `fill`); a collapsed sidebar is hidden with `visibility: hidden` and `inert`, not left translated. The app bar and the view bar never get `overflow: hidden` and create no stacking context; `#myPlot` and the plot area get `isolation: isolate`; shell z-indices are literals in `workbench.css` below the loading overlay's 9999, and the sidebar (`#wb-sidebar`) has none at rest: a z-index would make it a stacking context that traps the legend's fixed dialogs under the structure, the edge and the rail. No z-index tokens are added.
- One plot resize per layout change: the plot's box changes exactly once per sidebar open, close or edge-drag commit. Drags preview over the plot and commit on release. The divider, docking, floating and view-bar stage changes never change the plot's box. A commit waits for `Animation.finished` (WAAPI) or runs at once; never wait for `transitionend`. Under `prefers-reduced-motion: reduce` animations take 0 ms and keep their order. Window resizes stay as today (one resize per frame).
- Shell styling: `apps/web/src/workbench/` reads colours, type, radii and shadows only through the tokens (Tailwind `*-ps-*` utilities or `var(--ps-…)`), with no raw colours; shell-only sizes are literals or `--wb-*` custom properties on the workbench root. `apps/web/src/pages/Explore.css` is deleted in Task 2.2.
- React → runtime goes through the layout store or DOM events on elements the runtime wires by id. Runtime → React goes through `workbench-status.ts` or `layout-state.ts`; React never reads runtime state off elements. React sets kit properties through props (the kit is defined before the first render) and listens to `ps-*` events with a ref and `addEventListener` (the Task 1.12 gallery pattern).
- Panels that leave the control bar (import, export, the annotation select's list, the search suggestions) keep their absolutely positioned panel and register it with `pushLayer` while open (Escape and outside press close it, focus returns to the trigger); phase 4 rebuilds them on the kit. New pickers use `ps-menu`; new dialogs use `ps-dialog`; new labels use `ps-tooltip` or `ps-icon-button`'s `label`, never the native `title` attribute.
- Until 4.1, the selection's Escape stays a `keydown` listener on `document` in the bubble phase (moved from the control bar into `selection-controller.ts` with the same guards); phase 2 registers no Escape fallbacks.
- Accessible names that e2e helpers and the tour rely on: "ProtSpace home", "Import", "Export", "Help", "Feedback", "GitHub", "Filter", "Move and zoom", "Box select", "Lasso select", "Fit to view", "Clear", "Isolate", "Reset", "Legend", "Structure: …", "Collapse sidebar", "Expand sidebar", "Resize sidebar", "Resize legend and structure", "Pop out structure", "Dock structure", "Close structure", "More view options", "View structure", dialogs "Filter" and "Keyboard shortcuts"; picker triggers start with "Projection", "Color by" and "Contours".
- E2E: new specs are named `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Specs reach controls only through `apps/web/tests/helpers/explore.ts`, which finds them by role, accessible name or tag (Playwright's CSS locators pierce shadow roots), never through `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement and state, not 3D pixels (headless WebGL and Mol\*).
- Docs: the developer docs change in the commit that changes the public API (tips in 2.4, the control bar in 2.10, the viewer slot and tooltip actions in 2.13). The user guide and its images wait for phase 7.

## Review Focus

1. A runtime element re-created or moved by React. A conditional branch, a `key`, separate desktop and narrow trees, or moving the structure between docked and floating re-creates `#myPlot`, `#myLegend` or `#myStructureViewer`: the runtime keeps wiring the old instances (or returns `NOOP_CONTROLLER` at start), and the viewer's `disconnectedCallback` disposes Mol\*. Pinned by Task 2.2 (the same instances survive crossing 951 px) and Task 2.13 (docking and floating keep the same `.molstar-mount` node and fire no second `structure-load`).
2. A stored layout that does not fit this window. `protspace:layout:v1` written on a wider screen (a 480 px sidebar on a 1000 px window), a floating rect outside a smaller plot area, hand-edited or non-numeric fields, storage that throws in a private window. The page must render the defaults or clamp at render, without rewriting storage. Pinned by Task 2.2 (parse and storage-failure tests), Task 2.12 (a stored 480 px sidebar on a 1000 px window leaves the plot at least 480 px wide) and Task 2.13 (a card stored outside the plot renders inside it).
3. Reduced motion and the one-resize rule. Under `prefers-reduced-motion: reduce` transitions run for 0 ms and fire no `transitionend`, so a commit waiting for that event never runs and the plot keeps its old size; animating the plot's box instead resizes it every frame (about 95 ms each at 573K). Pinned by Task 2.12 (with `reducedMotion: 'reduce'`, collapse and expand each change `#myPlot` exactly once, counted with the perf counters) and its `panel-toggle` budget.
4. Escape with focus in the search box or with a panel open. Escape must close the open panel (search suggestions, a menu, the Import or Export panel, a dialog) and nothing else; it clears the selection only when no layer is open. The perf `search-select` reset relies on Escape clearing the selection from the search input. Pinned by Task 2.9.
5. Fixed-position popovers trapped by a containing block. The import menu's example ⓘ bubbles, the projection details card and the legend's own dialogs use `position: fixed`; a `transform`, `translate`, `filter`, `contain` or `container-type` on an ancestor (a container query on a bar, a `ps-popover` panel, a sidebar left translated after its slide) clips or misplaces them, and a z-index on an ancestor (the sidebar) traps them under the shell's own layers. Pinned by Task 2.5 (an example's ⓘ bubble is fully on screen and topmost at its centre), Task 2.8 (the projection details card opens below its trigger in the view bar and is topmost) and Task 2.12 (after collapse and expand the legend settings dialog covers the viewport and is topmost over the rail and the structure footer).

## Rulings

- Theme stays out of the layout store; phase 6 adds `protspace:theme`. Perf pins `colorScheme: 'light'` only, since no theme key exists yet.
- The divider is stored as `legendFraction` (default 0.5, 0.2–0.8); pixel minimums (legend 120, structure 220) apply at render. A fraction survives window-height changes.
- The plot keeps at least 480 px at desktop widths: the sidebar is clamped at render to `window − 44 − 480`; storage keeps the user's width.
- The floating rect is `{ x, y, width, height }` relative to the plot area's top-left, clamped at render and when the plot resizes; `null` means the default bottom-right spot; the resize grip is at the bottom-right.
- Whether the structure is open is not persisted; it depends on the data, and the perf pin assumes it starts closed.
- `#myDataLoader` stays mounted, hidden, in the shell; Import opens its file input through a new `openFilePicker()` instead of reaching into its shadow root.
- No `panel` field and no Filter rail item in phase 2: both arrive with the Filter panel in 4.4 (a missing field takes its default, so the v1 key stays valid). A rail item that opens a modal would not be a panel.
- No z-index tokens: the kit uses the top layer, and the shell orders by DOM and `isolation: isolate` with local literals.
- First paint: a `@protspace/core/kit` subpath (lib entry and package export, mirroring `./publish`) adopts the theme and defines the kit; the lazy `/explore` route imports it, so tokens and kit properties work at the first render while the 835 KB core still loads with the runtime. A static `import '@protspace/core'` in the route would block first paint on the whole bundle.
- React shell code lives in `apps/web/src/workbench/`, the plain-TS runtime stays in `apps/web/src/explore/`, and shell CSS is `workbench/workbench.css`.
- Desktop geometry uses absolutely placed siblings: the plot's right inset is the committed sidebar width; the aside, the structure section and the rail are siblings of the plot, so collapsing and floating never re-parent anything. Changing only an inset keeps one resize per change.
- Runtime state reaches React through two module stores (persisted layout, transient status); React reaches the runtime through the layout store or DOM events on id-wired elements. The runtime is created after React's first render, so props and context cannot carry it.
- Clear, Isolate and Reset sit in `protspace-plot-tools` as a group beside the tool strip, shown only when they apply; 4.2 moves them to the selection bar. No `protspace-selection-bar` now: at the plot's bottom edge it would collide with the EAT connector status, which a single click often shows.
- The filter opens in a `ps-dialog` headed "Filter" from the view bar's Filter button, with `protspace-query-builder` in a new `embedded` mode (no title or close of its own); 4.4 moves it into the sidebar.
- Filter, selection and the EAT reliability mirror move to app controllers (decision 9); `eat-threshold-mirror` goes because the filter controller calls `legend.setReliabilityState` directly.
- The filter moves (2.6) before the pickers (2.7, 2.8): the filter controller then listens for `annotation-change` on `document`, which the control bar and later the annotation select both dispatch, so neither task keeps a transitional property on the control bar.
- `ExploreControls` (2.5) is the one seam through which the dataset pipeline resets and fills the controls; later split tasks change only its implementation in `runtime.ts`, not `dataset-controller.ts` or `data-renderer.ts` (2.10 only drops `setRendering`, the control bar's auto-sync switch).
- Import and Export keep their current panel contents and rendering (now on token styles) because side-placed info bubbles break inside a top-layer panel whose `translate` makes a containing block; 4.8 rebuilds them.
- Projection and Contours use `ps-menu` radio items behind a ghost key/value trigger; Color by keeps the annotation select's own list (with the layer stack) until 4.11. A native `<select>` cannot hold the key/value trigger.
- The projection details move beside the Projection picker in 2.8, before the tool strip takes the plot's top-left corner in 2.9; the card caps its height against the viewport instead of `offsetParent`.
- The help menu (2.4) replaces `protspace-tips` and `show-tour-button` before the tool strip arrives, for the same corner.
- The tour keeps its ten steps; steps 2–6 move to light-DOM `data-driver-id` hosts as each control moves (import and data-actions in the app bar, projections in the view bar, search in the app bar, selection on the plot tools); step 1 spotlights Help; 7.4 rewrites the tour.
- The dataset name and protein count are display-only in phase 2; the shared Import/dataset menu is 4.8. A trigger that opens a panel anchored to another button would mislead.
- The plot's bottom-left count stays the scatterplot's own `.plot-indicator` until 4.2 builds the status corner (count, selection, chips); phase 2 only keeps that corner free.
- The theme switch is not rendered in phase 2 (phase 6); no empty slot.
- The app bar fits from 951 px with media queries (search `minmax(200px, 420px)` centred, dataset name truncated at 200 px, Import and Export icon-only below 1100 px, protein count hidden below 1024 px). Container queries are not used: `container-type` makes a containing block that traps the import menu's fixed bubbles.
- View-bar stages: full → short labels → Contours into More → Filter into More (Contours is used less); Projection, its details and Color by never move.
- No `?` shortcut, no tool keys (V, B, L) and no sidebar shortcut in phase 2; the design names none.
- The structure header is 44 px docked and floating; no minimise chevron until the phone sheet (5.4); with no protein the docked area is a 44 px footer "Structure · Click a protein to view it" without buttons.
- Structure loads are deferred while hidden (sidebar collapsed): the rail's Structure button shows a dot and opens the sidebar, which loads it; "View structure" is a pinned-tooltip action offered only while docked and collapsed, because a visible structure already loads on click.
- The app sets the viewer's `autoShow = false`, `showTips = false` and `title = 'Structure'` as properties: Lit reads `auto-show="false"` as true, and React passes attributes before core defines the element.
- Annotation select, search and the query-builder modules stay in `components/control-bar/` during phase 2; the phases that rework them (4.4 query builder, 4.5 search, 4.11 annotation select) move them, so their LEGACY lint lines are re-keyed once, with the restyle. Task 2.10 deletes only the control bar's own files.
- Window resizes stay one resize per frame; decision 4 covers panel changes.
- Insets keep their explicit data domain and per-axis full bleed (decision 3); the user's inset rectangle sets their aspect.
- A resize keeps the zoom factor `k` and re-centres the data point that was at the view centre; an identity transform stays identity so the perf pixel round trip stays exact.
- Fit margins stay 40 px on every side; the tool strip and status sit inside them.
- The perf pin seeds `DEFAULT_LAYOUT` imported from the leaf module `layout-defaults.ts`, never a literal width.
- `ps-icon-button` gains `tooltip-placement` (2.9): tool-strip tooltips sit to the right, rail tooltips to the left.
- Every e2e spec reaches controls through helpers (2.3) with a contract spec, so each split task changes helper internals and not a dozen specs.
- `openspec/changes/explore-workbench/tasks.md` section 2 lists this plan's thirteen tasks one to one (it was written as nine themes before the plan; the themes map: store and shell → 2.2; control bar split → 2.5–2.10; sidebar → 2.11 (divider) and 2.12; structure → 2.11 and 2.13; one scale → 2.1; one resize, centre and perf → 2.1 and 2.12; view bar and help → 2.10 and 2.4; e2e → 2.3 plus each task's specs).
- The pickers are two tasks: 2.7 builds `protspace-projection-select` and `protspace-contours-menu` in core alone (additive, nothing mounts them), 2.8 promotes the annotation select, moves the projection details and wires all three into the view bar. One task held too much for one implementer.
- The contour modes' menu copy (`DENSITY_MODE_LABELS`) lives in `@protspace/utils` (2.7), so the shell's More menu names the modes from it without loading core before the first paint; core re-exports it (2.10) for embedders and the docs.
- The sidebar has no z-index at rest; it is lifted (`z-index: 2`) only while it slides or its edge is dragged (2.12), so the legend's `position: fixed` dialogs stay above the rail and the structure footer.
- Task 2.8 replaces `control-bar.ts` with a full listing rather than a list of deletions: the listing does not depend on how Tasks 2.5 and 2.6 left the file.

## File structure

`packages/utils`

- `src/visualization/scales.ts` (M 2.1): the fit (`fitRect`, `fitScales`), `ScalePair`, `DataDomain`, `PlotMargin`; the dead `ScaleManager.createScales` goes.
- `src/visualization/scales.test.ts` (C 2.1): fit rules and degenerate spans.
- `src/visualization/data-processor.ts` (+ test) (M 2.1): live scales through `fitScales`.
- `src/types.ts` (M 2.7): `DENSITY_MODE_LABELS`, the contour modes' menu copy, shared by the Contours menu and the shell's More menu.

`packages/core`

- `vite.config.ts`, `package.json` (M 2.2): the `kit` lib entry and the `./kit` export.
- `src/index.ts` (M 2.2, 2.5–2.10, 2.13): public exports as elements appear and the control bar leaves.
- `src/components/kit/index.ts` (M 2.2): adopts the theme on import.
- `src/components/kit/icon.ts` (M 2.4, 2.5, 2.7, 2.8, 2.9, 2.12, 2.13): icons as first used.
- `src/components/kit/menu.ts` (+ browser test) (M 2.7): finds the focused item through its own root node.
- `src/components/kit/button.ts` (+ browser test) (M 2.9): `tooltip-placement` on `ps-icon-button`.
- `src/components/import-menu/` (C 2.5): `protspace-import-menu`, its styles, `types.ts` (`ExampleDatasetSummary`), tests.
- `src/components/export-menu/` (C 2.5): `protspace-export-menu`, its styles, `export-defaults.ts` (`EXPORT_DEFAULTS`), tests.
- `src/components/projection-select/` (C 2.7): `protspace-projection-select`, styles, browser tests.
- `src/components/contours-menu/` (C 2.7): `protspace-contours-menu`, styles, `DensityLayerChangeDetail`, browser tests.
- `src/components/plot-tools/` (C 2.9): `protspace-plot-tools`, styles, browser tests.
- `src/components/data-loader/data-loader.ts`, `data-loader.handler.test.ts` (M 2.5): `openFilePicker()`.
- `src/components/control-bar/control-bar.ts`, `control-bar.styles.ts`, `styles/*.ts`, `control-bar.events.ts`, `control-bar-helpers.ts` (+ test) and `control-bar.*.test.ts` (M 2.5, 2.6, 2.8, 2.9; D 2.10): emptied control by control, then deleted. `styles/export.ts` and `control-bar.import-menu.test.ts` go in 2.5, `control-bar.query-apply.test.ts` in 2.6, `control-bar.density-layer.test.ts` in 2.8, `control-bar.after-paint.test.ts`, `control-bar.events.test.ts` and `control-bar.auto-sync.test.ts` in 2.9; `styles/layout.ts` loses its 900 px minimum in 2.8.
- `src/components/control-bar/query-builder.ts`, `query-builder.styles.ts`, `query-value-picker.ts`, `query-condition-row.ts` (+ tests) (M 2.6): `embedded` mode; an open value picker is a layer.
- `src/components/control-bar/annotation-select.ts`, `annotation-select.styles.ts` (M 2.8), `annotation-select.component.test.ts` (M 2.6, 2.8): commits picks itself, Color by label, layer.
- `src/components/control-bar/search.ts`, `search.styles.ts` (+ tests) (M 2.9): its suggestion list is a layer; one control height.
- `src/components/control-bar/types.ts` (M 2.5, 2.9, 2.10): loses the moved and control-bar-only types.
- `src/components/scatter-plot/scatter-plot.ts` (M 2.1, 2.4, 2.8, 2.13): centre kept on resize; tips gone; projection details gone; tooltip actions. `scatter-plot.events.ts` (M 2.13).
- `src/components/scatter-plot/interaction/plot-interaction-controller.ts` (M 2.1): `syncTransform`.
- `src/components/scatter-plot/webgl/renderer/export-renderer.ts`, `webgl-renderer.ts` (M 2.1): fitted export scales, effective margins.
- `src/components/scatter-plot/tooltips/protspace-tips.ts`, `protspace-tips.styles.ts` (D 2.4).
- `src/components/scatter-plot/tooltips/protein-tooltip.ts`, `.styles.ts` (M 2.13): the pinned tooltip's actions row.
- `src/components/scatter-plot/projection-metadata/` (M 2.8): placed by its host, viewport height cap.
- `src/components/structure-viewer/structure-viewer.ts`, `structure-viewer.styles.ts` (M 2.11, 2.13): close icon and name; header slot and part.
- `src/components/legend/controllers/scatterplot-sync-controller.ts`, `legend/test-support/legend-scatterplot-harness.ts`, `legend/legend.score-strips.test.ts` (M 2.8): the legend hears picker events on its root node.
- `src/utils/dropdown-helpers.ts` (M 2.8): `isAnyDropdownOpen` goes with its last caller.
- `src/styles/theme.ts` (M 2.12): `--ps-duration` comes back for the sidebar's slide.
- `src/styles/mixins.ts` (M 2.10): `iconMixin` goes with its only consumer.
- `src/styles/style-lint.test.ts` (M 2.4, 2.5, 2.10): LEGACY lines of deleted modules.

`apps/web`

- `src/App.tsx` (M 2.2): lazy `/explore`.
- `src/pages/Explore.tsx` (M 2.2): renders `<Workbench />`, keeps the runtime effect. `src/pages/Explore.css` (D 2.2).
- `src/components/Header.tsx` (M 2.2): no `variant`, no exported height class.
- `src/custom-elements.d.ts` (M 2.4, 2.5, 2.6, 2.8–2.12): JSX typings of the feature tags; `expanded` on the kit buttons (2.12).
- `src/workbench/Workbench.tsx` (C 2.2): root, regions, data attributes.
- `src/workbench/AppBar.tsx` (C 2.2; M 2.4, 2.5, 2.9): wordmark, dataset, search, actions.
- `src/workbench/ViewBar.tsx` (C 2.2; M 2.6, 2.8, 2.10): pickers, Filter, More.
- `src/workbench/PlotArea.tsx` (C 2.2; M 2.4, 2.9): `#myPlot` and the tool strip.
- `src/workbench/Sidebar.tsx` (C 2.2; M 2.11, 2.12): the aside with `#myLegend`; the sidebar edge.
- `src/workbench/StructurePanel.tsx` (C 2.11; M 2.12, 2.13): the structure section, divider, empty footer, floating card.
- `src/workbench/Rail.tsx` (C 2.12): the icon rail.
- `src/workbench/HelpMenu.tsx`, `ShortcutsDialog.tsx`, `shortcuts.ts` (+ test) (C 2.4; `shortcuts.ts` M 2.9): help menu and the shortcut list.
- `src/workbench/FilterControl.tsx` (C 2.6; M 2.10): Filter button and dialog.
- `src/workbench/MoreMenu.tsx`, `view-bar-overflow.ts` (+ test), `use-view-bar-stage.ts` (C 2.10): the view bar's stages.
- `src/workbench/layout-geometry.ts` (+ test) (C 2.11; M 2.12, 2.13): pure clamps and key steps.
- `src/workbench/use-layout.ts`, `use-workbench-status.ts`, `use-layout-mode.ts` (C 2.2): store and breakpoint hooks.
- `src/workbench/use-sidebar-transition.ts` (C 2.12): the one-resize slide.
- `src/workbench/use-floating-card.ts` (C 2.13): drag and resize of the floating card.
- `src/workbench/workbench.css` (C 2.2; M 2.4, 2.5, 2.6, 2.8–2.13): shell geometry and states.
- `src/explore/layout-defaults.ts` (C 2.2; M 2.12): leaf module of layout constants, types and defaults.
- `src/explore/layout-state.ts` (+ test) (C 2.2): the persisted layout store.
- `src/explore/workbench-status.ts` (+ test) (C 2.2; M 2.6, 2.10, 2.11): transient runtime facts for the shell.
- `src/explore/explore-controls.ts` (C 2.5; M 2.10): the dataset pipeline's seam to the controls.
- `src/explore/import-controller.ts` (+ test) (C 2.5): Import menu events.
- `src/explore/filter-controller.ts` (+ test) (C 2.6; M 2.8): query, plot filter channel, reliability mirror.
- `src/explore/view-bar-controller.ts` (+ test) (C 2.8; M 2.10): picker options and plot writes.
- `src/explore/selection-controller.ts` (+ test) (C 2.9): the selection and its Escape.
- `src/explore/structure-controller.ts` (+ test) (C 2.11; M 2.13): what the viewer shows and when.
- `src/explore/runtime.ts`, `elements.ts` (M 2.2, 2.4, 2.5, 2.6, 2.8–2.11, 2.13): wiring.
- `src/explore/control-bar-events.ts` (+ test) (M 2.5, 2.8; D 2.9).
- `src/explore/export-handler.ts`, `dataset-controller.ts` (M 2.5); `dataset-controller.fixtures.ts`, `dataset-controller.eat.test.ts`, `data-renderer.ts` (+ test) (M 2.5, 2.10): `ExploreControls`, export menu.
- `src/explore/view-controller.ts` (+ test) (M 2.8): `ViewPickers`. `example-datasets.test.ts` (M 2.8, a comment).
- `src/explore/interaction-controller.ts` (+ tests) (M 2.9, 2.11): `handleSelectionChange(ids)`, `requestStructure`.
- `src/explore/notifications.ts` (+ test) (M 2.9): selection-disabled copy.
- `src/tour/product-tour.ts` (M 2.4, 2.5, 2.8, 2.9, 2.10): retargeted steps.
- `tests/playwright.config.ts` (M 2.2): project `workbench`.
- `tests/helpers/explore.ts` (M 2.3; internals 2.5, 2.6, 2.8–2.13): the helper API.
- `tests/helpers/tour-storage-state.ts` (M 2.12): `exploreStorageState`.
- `tests/helpers/perf/scenarios.ts` (M 2.3, 2.12), `tests/perf/budgets.json` (M 2.12): helpers, `panel-toggle`, pinned layout.
- `tests/workbench-shell.spec.ts` (C 2.2), `workbench-helpers.spec.ts` (C 2.3), `workbench-help.spec.ts` (C 2.4), `workbench-import-export.spec.ts` (C 2.5), `workbench-filter.spec.ts` (C 2.6), `workbench-view-bar.spec.ts` (C 2.8, M 2.10), `workbench-selection.spec.ts` (C 2.9), `workbench-structure.spec.ts` (C 2.11, M 2.13), `workbench-sidebar.spec.ts` (C 2.12).
- Existing specs (M 2.3): `dataset-reload`, `eat-visualization`, `example-datasets`, `examples-live`, `figure-editor`, `isolation-dataset-swap`, `load-large-bundle`, `multi-annotation-tooltip`, `numeric-binning`, `perf-scale`, `product-tour`, `url-view-state`; later also `examples-live` (2.2), `product-tour` (2.4), `dataset-reload` (2.5, 2.9), `eat-visualization` (2.6), `url-view-state` (2.10) and `perf-scale` (2.12).

Docs: `docs/developers/api/index.md` (M 2.4, 2.10, 2.13); `contributing.md` (M 2.4); `embedding.md`, `installation.md`, `messaging.md`, `style-architecture.md` (M 2.10); `perf/README.md` (M 2.12).

---

### Task 2.1: One scale for both axes; the viewed centre survives a resize

The live plot and the figure export map x and y with one pixels-per-unit: the padded data extent is fitted inside the plot's inner area and centred (decision 3). The fit lives in the scales' range, never the domain, so a resize stays a GPU rescale with no re-stage. On a resize the zoom transform is re-centred on the data point that was at the view's centre, applied without a second draw (decision 4). Utils and core only; no shell exists yet.

**Files:**

- Modify: `packages/utils/src/visualization/scales.ts`, `packages/utils/src/visualization/data-processor.ts` (`createScales` :135-182; `ScalePair` :14), `packages/utils/src/visualization/data-processor.test.ts` (:330-394)
- Create: `packages/utils/src/visualization/scales.test.ts`
- Modify: `packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.ts` (local `DataDomain` :76, `createExportScales` :126-176, `getRenderInfo` :194-210), `export-renderer.test.ts` (:56-127)
- Modify: `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts` (`getRenderInfo` :1004-1008), `rescale.test.ts`
- Modify: `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts` (:116-204, :280-296), `plot-interaction-controller.test.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (`_updateSizeAndRender` :1209-1251, `getDataExtent` :2307-2324), `scatter-plot.resize.test.ts` (:70-146; stale comment :101)

**Interfaces:**

- Consumes: `DataProcessor.createScales(plotData, width, height, margin): ScalePair | null` (signature kept); `DATA_EXTENT_PADDING`; `computePaddedExtent(xs, ys, length)` (`renderer/data-extent.ts`); `rescaleBetween(from, to): Rescale | null` (`renderer/rescale.ts:55`, null when a domain changes); `ProtspaceScatterplot._transform`, `_scales`, `_renderLoop.now()`; the figure editor's inset inversion (`publish-modal.ts:543-617`), which must stay exact without changes.
- Produces (utils, through `export * from './visualization/scales'`):
  - `interface DataDomain { xMin: number; xMax: number; yMin: number; yMax: number }`
  - `interface PlotMargin { top: number; right: number; bottom: number; left: number }`
  - `interface FitRect { left: number; top: number; width: number; height: number }`
  - `type ScalePair` (moved here; `data-processor.ts` re-exports it; core's `webgl/types.ts` re-export is unchanged)
  - `fitRect(domain: DataDomain, width: number, height: number, margin: PlotMargin): FitRect`: inner area `iw = max(1, width − left − right)`, `ih = max(1, height − top − bottom)`; `s = min(iw / dx, ih / dy)`; the rect is `dx·s × dy·s`, centred in the inner area. An axis with zero span takes its full inner extent and `s` comes from the other axis; both zero → the whole inner area.
  - `fitScales(domain, width, height, margin): ScalePair`: with `rect = fitRect(domain, width, height, margin)`, the domains are exactly `domain`, the x range is `[rect.left, rect.left + rect.width]` and the y range `[rect.top + rect.height, rect.top]`.
- Produces (core):
  - `ExportRenderer.createExportScales`: the default path is `fitScales(computePaddedExtent(…), W, H, scaledMargin)`; the `dataDomain` path (insets) is unchanged: full bleed, per axis.
  - `ExportRenderer.getRenderInfo(config: ScatterplotConfig, pd: PlotData | null, exportWidth: number, exportHeight: number): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number }`: the fitted rect's effective margins, centring slack included (with no data, the scaled margins as today). `WebGLRenderer.getRenderInfo(w, h)` passes its last rendered data; `ProtspaceScatterplot.getRenderInfo(w, h)` keeps its signature.
  - `PlotInteractionController.syncTransform(t: d3.ZoomTransform): void`: stores `t` as d3's transform on the SVG (`__zoom`) so the next gesture starts from it, calls `host.onTransform(t)`, writes the three groups' `transform`, refreshes the brush extent when the rectangle tool is active, and schedules no draw.
  - `_updateSizeAndRender`: with scales, a previous measured size that differs, a non-identity transform and no reset transition in flight, it keeps `k`, translates so the data point under the old view centre lands at the new centre, applies that with `syncTransform`, then draws once synchronously as today. It refreshes the brush extent after every resize.
  - `getDataExtent({ padded: true })` pads with `DATA_EXTENT_PADDING`.
  - Internal additions this task needs (not public API): `PlotInteractionController.isResetting: boolean` (a `resetZoom` transition is in flight) and `PlotInteractionController.refreshBrushExtent(): void` (the brush-extent sync `applyZoom` already did, factored out so `syncTransform` and a resize share it).

**Tests:**

- `packages/utils/src/visualization/scales.test.ts` (unit):
  - "a wide box narrows x and centres it; y keeps its full range"
  - "a tall box narrows y and centres it; x keeps its full range"
  - "x and y share one pixels-per-unit": `|x(1) − x(0)| === |y(1) − y(0)|`.
  - "the domain is the input at any size"
  - "asymmetric margins centre the rect within the inner area"
  - "a zero x span takes the full x range and y stays finite"
  - "both spans zero give full ranges, so no range collapses"
  - "a box smaller than its margins stays finite": the inner size floors at 1.
- `data-processor.test.ts` (unit, updated): "returns correct domain and range for a known fixture": x `[130, 690]`, y `[570, 10]`; "same PlotData on resize …": 800×600 x `[130, 690]`, 1200×900 x `[180, 1040]` and y `[870, 10]`.
- `export-renderer.test.ts` (unit): the default path gives x `[260, 540]`, y `[580, 20]` (11×22 data, 800×600, margin 20) and the 20 px fallback the same x; "getRenderInfo's effective margins with the padded extent reproduce createExportScales exactly"; "an export has the live plot's shape at the same aspect"; the `dataDomain` path is unchanged.
- `rescale.test.ts` (unit): "a resize between two fitted scales is a rescale with one factor for x and y, not a re-stage".
- `plot-interaction-controller.test.ts` (unit): "syncTransform updates d3's stored transform and the host without scheduling a draw".
- `scatter-plot.resize.test.ts` (unit): "keeps the data under the view centre across a resize" (k = 3, translated; 800×600 → 1100×600; the centre datum is equal within 1e-9; `restage` 0; one draw); "an identity transform stays identity after a resize"; "redraws on the spot without re-staging" keeps passing.
- `scatter-plot.capture-badges-geometry.test.ts`, `webgl-renderer.export-scales.test.ts` and `scatter-plot.scales-cache.test.ts` stay green.
- E2E: the full Chromium suite stays green, including the geometry readers `eat-visualization.spec.ts` (:188-210), `figure-editor.spec.ts` (:198-229), `density-layer.spec.ts`, `brush-selection.spec.ts`, `zoom-indicator.spec.ts`; `pnpm perf:counts` stays within budget.

Before you start, record the baseline counts from the phase 2 ledger (or run the four suites in its Baseline paragraph if the ledger has none yet). Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`.

- [ ] **Step 1: Write the failing utils tests**

Create `packages/utils/src/visualization/scales.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fitRect, fitScales, type DataDomain, type PlotMargin } from './scales';

const MARGIN: PlotMargin = { top: 40, right: 40, bottom: 40, left: 40 };
const SQUARE: DataDomain = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

describe('fitScales', () => {
  it('a wide box narrows x and centres it; y keeps its full range', () => {
    // Inner area 920 × 520: the 10 × 10 domain becomes a 520 px square, centred in x.
    const { x, y } = fitScales(SQUARE, 1000, 600, MARGIN);
    expect(x.range()).toEqual([240, 760]);
    expect(y.range()).toEqual([560, 40]);
  });

  it('a tall box narrows y and centres it; x keeps its full range', () => {
    // Inner area 520 × 920: a 520 px square, centred in y.
    const { x, y } = fitScales(SQUARE, 600, 1000, MARGIN);
    expect(x.range()).toEqual([40, 560]);
    expect(y.range()).toEqual([760, 240]);
  });

  it('x and y share one pixels-per-unit', () => {
    const { x, y } = fitScales({ xMin: -3, xMax: 7, yMin: 2, yMax: 4.5 }, 1280, 628, MARGIN);
    expect(Math.abs(x(1) - x(0))).toBeCloseTo(Math.abs(y(1) - y(0)), 9);
  });

  it('the domain is the input at any size', () => {
    const domain: DataDomain = { xMin: -3.5, xMax: 12.25, yMin: 100, yMax: 140 };
    for (const [width, height] of [
      [800, 600],
      [1440, 900],
      [320, 1200],
      [10, 10],
    ]) {
      const { x, y } = fitScales(domain, width, height, MARGIN);
      expect(x.domain()).toEqual([domain.xMin, domain.xMax]);
      expect(y.domain()).toEqual([domain.yMin, domain.yMax]);
    }
  });

  it('asymmetric margins centre the rect within the inner area', () => {
    // Inner area 740 × 560 from (40, 10): a 560 px square, 90 px in from each side of it.
    const margin: PlotMargin = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(fitRect(SQUARE, 800, 600, margin)).toEqual({
      left: 130,
      top: 10,
      width: 560,
      height: 560,
    });
  });

  it('a zero x span takes the full x range and y stays finite', () => {
    const { x, y } = fitScales({ xMin: 5, xMax: 5, yMin: 0, yMax: 4 }, 800, 600, MARGIN);
    expect(x.range()).toEqual([40, 760]);
    expect(y.range()).toEqual([560, 40]);
    // d3 puts a single-value domain on the middle of its range.
    expect(x(5)).toBe(400);
    expect(Number.isFinite(y(2))).toBe(true);
  });

  it('both spans zero give full ranges, so no range collapses', () => {
    const { x, y } = fitScales({ xMin: 1, xMax: 1, yMin: 2, yMax: 2 }, 800, 600, MARGIN);
    expect(x.range()).toEqual([40, 760]);
    expect(y.range()).toEqual([560, 40]);
  });

  it('a box smaller than its margins stays finite', () => {
    const rect = fitRect(SQUARE, 50, 30, MARGIN);
    expect(rect).toEqual({ left: 40, top: 40, width: 1, height: 1 });
  });
});
```

In `packages/utils/src/visualization/data-processor.test.ts`, replace the whole test `it('returns correct domain and range for a known fixture', …)` (:330-358) with:

```ts
  it('returns correct domain and range for a known fixture', () => {
    // x in [0, 10], y in [-5, 5]: padded by 0.5, an 11 × 11 domain.
    const plotData = makePlotData([0, 10], [-5, 5]);
    const scales = DataProcessor.createScales(plotData, 800, 600, margin);
    expect(scales).not.toBeNull();

    expect(scales!.x.domain()).toEqual([-0.5, 10.5]);
    expect(scales!.y.domain()).toEqual([-5.5, 5.5]);
    // Inner area 740 × 560 from (40, 10). y sets one scale for both axes (560 / 11 px per
    // unit), so the domain becomes a 560 px square, centred in x.
    expect(scales!.x.range()).toEqual([130, 690]);
    expect(scales!.y.range()).toEqual([570, 10]);
  });
```

and, in the test `it('same PlotData on resize → same domain, range follows the new dimensions', …)` (:369-394), replace its last four `expect` lines (the block after `// Range must reflect new dimensions`) with:

```ts
    // Range follows the new dimensions, fitted with one scale and centred.
    expect(scales1!.x.range()).toEqual([130, 690]);
    expect(scales1!.y.range()).toEqual([570, 10]);
    expect(scales2!.x.range()).toEqual([180, 1040]);
    expect(scales2!.y.range()).toEqual([870, 10]);
```

- [ ] **Step 2: Run the utils tests to see them fail**

Run: `pnpm --filter @protspace/utils exec vitest --run src/visualization/scales.test.ts src/visualization/data-processor.test.ts`
Expected: FAIL. Every `scales.test.ts` case fails with `fitScales is not a function` / `fitRect is not a function` (they are not exported yet), and the two updated `data-processor` cases fail with `expected [ 40, 780 ] to deeply equal [ 130, 690 ]` (today's ranges stretch each axis).

- [ ] **Step 3: Add the fit to utils**

Replace `packages/utils/src/visualization/scales.ts` with (the dead `ScaleManager.createScales`, which nothing calls, goes; `createColorScale` and `createSizeScale` stay as they are):

```ts
import * as d3 from 'd3';

/**
 * Fraction of the data range added as padding on every edge when building plot
 * scales. Single source of truth shared by the live scales (here and
 * DataProcessor) and the WebGL export domain, so on-screen and exported framing
 * stay in lockstep.
 */
export const DATA_EXTENT_PADDING = 0.05;

/** A data-coordinate rectangle: what a plot shows, or the padded extent of its points. */
export interface DataDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Space kept between a plot's edges and its data, in pixels. */
export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where a domain lands inside a plot, in pixels from the plot's top-left corner. */
export interface FitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The d3 linear scale pair the live plot and the export map points with. Declared in utils (not in
// @protspace/core's webgl/types.ts) because utils cannot import core; core re-exports it.
export type ScalePair = {
  x: d3.ScaleLinear<number, number>;
  y: d3.ScaleLinear<number, number>;
};

const hasSpan = (span: number) => Number.isFinite(span) && span > 0;

/**
 * The rectangle `domain` fills in a `width` × `height` plot with one pixels-per-unit for both axes
 * (design decision 3): the largest that fits inside the margins, centred there. An axis without a
 * span (one point, or equal values) cannot set the scale, so the other axis does and the zero-span
 * axis keeps its whole inner extent; with neither, the rectangle is the whole inner area. The inner
 * size never drops below 1 px, so no range collapses.
 */
export function fitRect(
  domain: DataDomain,
  width: number,
  height: number,
  margin: PlotMargin,
): FitRect {
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const dx = Math.abs(domain.xMax - domain.xMin);
  const dy = Math.abs(domain.yMax - domain.yMin);
  if (!hasSpan(dx) || !hasSpan(dy)) {
    return { left: margin.left, top: margin.top, width: innerWidth, height: innerHeight };
  }
  // innerWidth / dx against innerHeight / dy, compared without dividing; the one division comes
  // last, so a fit that lands on whole pixels stays exact.
  const widthLimited = innerWidth * dy <= innerHeight * dx;
  const fitWidth = widthLimited ? innerWidth : (dx * innerHeight) / dy;
  const fitHeight = widthLimited ? (dy * innerWidth) / dx : innerHeight;
  return {
    left: margin.left + (innerWidth - fitWidth) / 2,
    top: margin.top + (innerHeight - fitHeight) / 2,
    width: fitWidth,
    height: fitHeight,
  };
}

/**
 * x and y scales with one pixels-per-unit (see {@link fitRect}). The domains are exactly `domain`
 * at every size: the fit lives in the ranges, so a resize changes only the ranges and the renderer
 * carries its staged points over with a rescale instead of a re-stage.
 */
export function fitScales(
  domain: DataDomain,
  width: number,
  height: number,
  margin: PlotMargin,
): ScalePair {
  const rect = fitRect(domain, width, height, margin);
  return {
    x: d3
      .scaleLinear()
      .domain([domain.xMin, domain.xMax])
      .range([rect.left, rect.left + rect.width]),
    y: d3
      .scaleLinear()
      .domain([domain.yMin, domain.yMax])
      .range([rect.top + rect.height, rect.top]),
  };
}

export class ScaleManager {
  static createColorScale(
    values: (string | null)[],
    colors?: string[],
  ): d3.ScaleOrdinal<string, string> {
    const uniqueValues = Array.from(new Set(values.filter((v) => v != null))) as string[];

    return d3
      .scaleOrdinal<string, string>()
      .domain(uniqueValues)
      .range(colors || d3.schemeCategory10);
  }

  static createSizeScale(
    values: number[],
    range: [number, number] = [20, 200],
  ): d3.ScaleLinear<number, number> {
    return d3
      .scaleLinear()
      .domain(d3.extent(values) as [number, number])
      .range(range);
  }
}
```

In `packages/utils/src/visualization/data-processor.ts`, replace lines 1-17 (the four imports through the `ScalePair` type, keeping the `extentCache` block between them) so the top of the file reads:

```ts
import type { VisualizationData, PlotData } from '../types.js';
import { EMPTY_PLOT_DATA } from './plot-data.js';
import { DATA_EXTENT_PADDING, fitScales, type PlotMargin, type ScalePair } from './scales.js';

// Memoize x/y extents per PlotData object reference. Resizes pass the same PlotData
// (extents unchanged) and reuse the cached scan; any data/projection/plane change builds
// a NEW PlotData via clonePlotData, correctly missing the cache.
const extentCache = new WeakMap<PlotData, { x: [number, number]; y: [number, number] }>();

// The scale pair createScales returns lives with the fit in scales.ts.
export type { ScalePair } from './scales.js';
```

(`import * as d3` goes: nothing else in the file uses d3.) In `static createScales(…)`, type the parameter as `margin: PlotMargin` and replace everything from `const xPadding = …` to the end of the method's `return { … };` with:

```ts
    const xPadding = Math.abs(xExtent[1] - xExtent[0]) * DATA_EXTENT_PADDING;
    const yPadding = Math.abs(yExtent[1] - yExtent[0]) * DATA_EXTENT_PADDING;

    // One pixels-per-unit for both axes, centred (design decision 3). The domain stays the
    // padded extent at every size, so a resize is a rescale on the GPU, not a re-stage.
    return fitScales(
      {
        xMin: xExtent[0] - xPadding,
        xMax: xExtent[1] + xPadding,
        yMin: yExtent[0] - yPadding,
        yMax: yExtent[1] + yPadding,
      },
      width,
      height,
      margin,
    );
```

- [ ] **Step 4: Run the utils tests and build utils**

Run: `pnpm --filter @protspace/utils exec vitest --run src/visualization/scales.test.ts src/visualization/data-processor.test.ts`
Expected: PASS (8 tests in `scales.test.ts`; every `data-processor` case, the single-point and different-PlotData cases unchanged).

Run: `pnpm --filter @protspace/utils exec vitest --run`
Expected: PASS, the baseline file count plus one.

Run: `pnpm --filter @protspace/utils build`
Expected: the build succeeds (core's tests import the built utils).

- [ ] **Step 5: Write the failing core tests**

In `packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.test.ts`, add `DataProcessor` to the imports:

```ts
import { DataProcessor } from '@protspace/utils';
import type { PlotData, ScatterplotConfig } from '@protspace/utils';
```

and replace the two blocks `describe('ExportRenderer.createExportScales (static)', …)` and `describe('ExportRenderer.getRenderInfo (static)', …)` (:44-127) with:

```ts
describe('ExportRenderer.createExportScales (static)', () => {
  const config: ScatterplotConfig = {
    width: 1000,
    height: 800,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };

  it('returns null for empty data', () => {
    const empty = makePlotData([], []);
    expect(ExportRenderer.createExportScales(config, empty, 400, 300)).toBeNull();
  });

  it('default path: fits the padded extent inside the scaled margins with one scale, centred', () => {
    // 11 × 22 once padded. At 800 × 600 the inner area is 760 × 560, so y sets the scale
    // (560 / 22 px per unit) and the 280 px wide fit is centred in x.
    const pd = makePlotData([0, 10], [0, 20]);
    const scales = ExportRenderer.createExportScales(config, pd, 800, 600);
    expect(scales).not.toBeNull();
    const { x, y } = scales!;

    const padded = computePaddedExtent(pd.xs, pd.ys, pd.length);
    expect(x.domain()).toEqual([padded.xMin, padded.xMax]);
    expect(y.domain()).toEqual([padded.yMin, padded.yMax]);
    expect(x.range()).toEqual([260, 540]);
    expect(y.range()).toEqual([580, 20]);
  });

  it('dataDomain path: full-bleed range with no padding and no margins', () => {
    const pd = makePlotData([0, 10], [0, 20]);
    const exportWidth = 500;
    const exportHeight = 400;
    const domain = { xMin: 2, xMax: 8, yMin: 3, yMax: 7 };
    const scales = ExportRenderer.createExportScales(config, pd, exportWidth, exportHeight, domain);
    const { x, y } = scales!;

    // Domain is exactly the supplied viewport (no 5% padding).
    expect(x.domain()).toEqual([domain.xMin, domain.xMax]);
    expect(y.domain()).toEqual([domain.yMin, domain.yMax]);

    // Range fills the canvas edge-to-edge (x: 0->W, y: H->0), each axis on its own.
    expect(x.range()).toEqual([0, exportWidth]);
    expect(y.range()).toEqual([exportHeight, 0]);
  });

  it('falls back to a 20px default margin when config.margin is absent', () => {
    const noMargin: ScatterplotConfig = { width: 1000, height: 800 };
    const pd = makePlotData([0, 10], [0, 20]);
    const { x, y } = ExportRenderer.createExportScales(noMargin, pd, REF_W, REF_H)!;
    // At the reference size the scale factor is 1, so the margins are 20 px.
    expect(x.range()).toEqual([260, 540]);
    expect(y.range()).toEqual([580, 20]);
  });

  it("an export has the live plot's shape at the same aspect", () => {
    const margin = { top: 40, right: 40, bottom: 40, left: 40 };
    const pd = makePlotData([0, 10, 3], [0, 20, 7]);
    const live = DataProcessor.createScales(pd, 800, 600, margin)!;
    // Twice the reference size: the margins scale to 80 px, so the export is the live plot doubled.
    const exported = ExportRenderer.createExportScales({ margin }, pd, 1600, 1200)!;
    expect(exported.x.domain()).toEqual(live.x.domain());
    expect(exported.y.domain()).toEqual(live.y.domain());
    exported.x.range().forEach((value, i) => expect(value).toBeCloseTo(2 * live.x.range()[i], 9));
    exported.y.range().forEach((value, i) => expect(value).toBeCloseTo(2 * live.y.range()[i], 9));
  });
});

describe('ExportRenderer.getRenderInfo (static)', () => {
  it('without data, returns the margins scaled from the fixed reference', () => {
    const config: ScatterplotConfig = {
      margin: { top: 10, right: 30, bottom: 40, left: 50 },
    };
    const exportWidth = 1600; // 2x reference width
    const exportHeight = 1200; // 2x reference height
    const info = ExportRenderer.getRenderInfo(config, null, exportWidth, exportHeight);
    expect(info.marginLeft).toBeCloseTo(50 * (exportWidth / REF_W));
    expect(info.marginRight).toBeCloseTo(30 * (exportWidth / REF_W));
    expect(info.marginTop).toBeCloseTo(10 * (exportHeight / REF_H));
    expect(info.marginBottom).toBeCloseTo(40 * (exportHeight / REF_H));
  });

  it('uses the 20px default margin when config.margin is absent', () => {
    const info = ExportRenderer.getRenderInfo({}, null, REF_W, REF_H);
    expect(info.marginLeft).toBeCloseTo(20);
    expect(info.marginRight).toBeCloseTo(20);
    expect(info.marginTop).toBeCloseTo(20);
    expect(info.marginBottom).toBeCloseTo(20);
  });

  it('with data, returns the edges of the fitted area, centring slack included', () => {
    const pd = makePlotData([0, 10], [0, 20]);
    expect(ExportRenderer.getRenderInfo({}, pd, REF_W, REF_H)).toEqual({
      marginLeft: 260,
      marginRight: 260,
      marginTop: 20,
      marginBottom: 20,
    });
  });

  it("getRenderInfo's effective margins with the padded extent reproduce createExportScales exactly", () => {
    const config: ScatterplotConfig = { margin: { top: 12, right: 30, bottom: 44, left: 72 } };
    const pd = makePlotData([-3.5, 8, 2.25, 0.5], [10, -6, 4, 1.75]);
    const extent = computePaddedExtent(pd.xs, pd.ys, pd.length);
    for (const [width, height] of [
      [800, 600],
      [1920, 1080],
      [1000, 1400],
    ]) {
      const scales = ExportRenderer.createExportScales(config, pd, width, height)!;
      const info = ExportRenderer.getRenderInfo(config, pd, width, height);
      // The publish modal's inset inversion (publish-modal.ts), run forwards.
      const areaWidth = width - info.marginLeft - info.marginRight;
      const areaHeight = height - info.marginTop - info.marginBottom;
      for (let i = 0; i < pd.length; i++) {
        const tx = (pd.xs[i] - extent.xMin) / (extent.xMax - extent.xMin);
        const ty = (extent.yMax - pd.ys[i]) / (extent.yMax - extent.yMin);
        expect(info.marginLeft + tx * areaWidth).toBeCloseTo(scales.x(pd.xs[i]), 9);
        expect(info.marginTop + ty * areaHeight).toBeCloseTo(scales.y(pd.ys[i]), 9);
      }
    }
  });
});
```

In `packages/core/src/components/scatter-plot/webgl/renderer/rescale.test.ts`, add the import

```ts
import { fitScales } from '@protspace/utils';
```

and append to `describe('rescaleBetween', …)` (after the test `copies the scales, so changing them later cannot move the snapshot`):

```ts
  it('a resize between two fitted scales is a rescale with one factor for x and y, not a re-stage', () => {
    const domain = { xMin: -3, xMax: 7, yMin: -1, yMax: 4 };
    const margin = { top: 40, right: 40, bottom: 40, left: 40 };
    const from = fitScales(domain, 800, 600, margin);
    const to = fitScales(domain, 1100, 700, margin);
    const r = rescaleBetween(snapshotScales(from), to);
    expect(r).not.toBeNull();
    expect(r!.x.scale).toBeCloseTo(r!.y.scale, 12);
    for (const [x, y] of [
      [-3, -1],
      [0, 0],
      [2.5, 1.5],
      [7, 4],
    ]) {
      expect(from.x(x) * r!.x.scale + r!.x.offset).toBeCloseTo(to.x(x), 9);
      expect(from.y(y) * r!.y.scale + r!.y.offset).toBeCloseTo(to.y(y), 9);
    }
  });
```

In `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts`, append inside `describe('PlotInteractionController', …)` (after `teardown() keeps a zoom that interrupted the reset`):

```ts
  it("syncTransform updates d3's stored transform and the host without scheduling a draw", () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const { bridge, calls } = makeHostBridge(svg);
    const renderSpy = vi.fn();
    const c = new PlotInteractionController({ ...bridge, renderWebGL: renderSpy });
    c.initialize();
    const t = d3.zoomIdentity.translate(-120, 40).scale(2.5);

    c.syncTransform(t);

    expect(d3.zoomTransform(svg)).toBe(t);
    expect(calls.transforms.at(-1)).toBe(t);
    expect(svg.querySelector('g.scatter-plot-container')?.getAttribute('transform')).toBe(
      t.toString(),
    );
    expect(raf).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
    // The next gesture starts from t, not from the transform d3 last applied.
    c.zoomBy(2);
    expect(calls.transforms.at(-1)?.k).toBe(5);
  });
```

In `packages/core/src/components/scatter-plot/scatter-plot.resize.test.ts`:

1. Add to the imports:

```ts
import * as d3 from 'd3';
import { PlotInteractionController } from './interaction/plot-interaction-controller';
import { createPlot, fakeFrames, mountPlot, type PlotInternals } from './test-support/plot-fixture';
```

(the last line replaces the existing `import { createPlot, fakeFrames, mountPlot } from './test-support/plot-fixture';`).

2. Add, below `function sizeTo(…)`:

```ts
/** The data point at the centre of the plot's view, in the coordinates its scales map. */
function centreDatum(el: PlotInternals): { x: number; y: number } {
  const { width, height } = el._mergedConfig;
  const scales = el._scales!;
  const t = el._transform;
  return {
    x: scales.x.invert((width / 2 - t.x) / t.k),
    y: scales.y.invert((height / 2 - t.y) / t.k),
  };
}
```

3. In `picks each point at its new position once the index is rebuilt`, replace the comment `// The old positions are empty now: p1 moved from (290, 136) to (542, 100).` with `// The old positions are empty now: p1 moved from (321, 64) to (656, 59).`

4. Append inside `describe('scatter-plot resize', …)`:

```ts
  it('keeps the data under the view centre across a resize', () => {
    const { el } = makePlot();
    // What firstUpdated sets up. This plot is never attached, so the controller has no SVG.
    el._interaction = new PlotInteractionController(el._interactionHost());
    el._transform = d3.zoomIdentity.translate(-520, -310).scale(3);
    const before = centreDatum(el);
    const render = vi.spyOn(el, '_renderPlot');

    sizeTo(el, 1100, 600);
    el._updateSizeAndRender();
    frames.run();

    const after = centreDatum(el);
    expect(el._transform.k).toBe(3);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    expect(counters.restage).toBe(0);
    // The synchronous draw only: re-centring schedules no zoom-frame draw.
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('an identity transform stays identity after a resize', () => {
    const { el } = makePlot();
    el._interaction = new PlotInteractionController(el._interactionHost());
    sizeTo(el, 1100, 700);
    el._updateSizeAndRender();
    frames.run();
    expect(el._transform).toBe(d3.zoomIdentity);
  });
```

- [ ] **Step 6: Run the core tests to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/webgl/renderer/export-renderer.test.ts src/components/scatter-plot/webgl/renderer/rescale.test.ts src/components/scatter-plot/interaction/plot-interaction-controller.test.ts src/components/scatter-plot/scatter-plot.resize.test.ts`
Expected: FAIL:
- `export-renderer.test.ts`: the default and fallback cases get x `[20, 780]`; the shape case fails on the ranges (the live scales are fitted since Step 4, the export still stretches); every `getRenderInfo` case fails, because the old three-argument signature reads `null` or the plot data as the export width, so the margins come out `0` or `NaN`.
- `rescale.test.ts`: the new case passes already (the built utils have `fitScales`); it pins that the fit keeps the domain.
- `plot-interaction-controller.test.ts`: `c.syncTransform is not a function`.
- `scatter-plot.resize.test.ts`: "keeps the data under the view centre" fails on `after.x` (the fitted rect moved 150 px right while the translation stayed); the identity case passes already and guards the skip.

- [ ] **Step 7: Fit the export scales and report effective margins**

In `packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.ts`:

1. Replace `import type { PlotData, ScatterplotConfig } from '@protspace/utils';` with:

```ts
import { fitRect, fitScales } from '@protspace/utils';
import type { DataDomain, PlotData, PlotMargin, ScatterplotConfig } from '@protspace/utils';
```

2. Delete the local `/** A data-coordinate viewport rectangle. */ interface DataDomain { … }` (:75-81); `ExportRenderOptions.dataDomain` and `getDataExtent` now use the utils type.

3. Add, right after `const MAX_AREA = 268435456; // ~268M pixels`:

```ts
/**
 * The plot margins at an export size: `config.margin` (20 px when unset) scaled from the fixed
 * reference size, so an export does not depend on the browser window.
 */
function scaledExportMargin(
  config: ScatterplotConfig,
  exportWidth: number,
  exportHeight: number,
): PlotMargin {
  const margin = config.margin ?? { top: 20, right: 20, bottom: 20, left: 20 };
  const scaleX = exportWidth / EXPORT_MARGIN_REFERENCE_WIDTH;
  const scaleY = exportHeight / EXPORT_MARGIN_REFERENCE_HEIGHT;
  return {
    top: margin.top * scaleY,
    right: margin.right * scaleX,
    bottom: margin.bottom * scaleY,
    left: margin.left * scaleX,
  };
}
```

4. Replace `static createExportScales(…)` with its doc comment (from `/**  * Create scales appropriate for export dimensions.` to the method's closing brace) with:

```ts
  /**
   * The scales an export of `exportWidth` × `exportHeight` maps points with. By default the live
   * plot's fit (design decision 3): the 5%-padded extent with one pixels-per-unit, centred inside
   * margins scaled from a fixed reference, so a figure has the screen's shape. A `dataDomain`
   * (inset / geometric-zoom render) fills the canvas edge to edge instead, each axis on its own:
   * the caller picks a domain that already matches its source rect.
   */
  static createExportScales(
    config: ScatterplotConfig,
    pd: PlotData,
    exportWidth: number,
    exportHeight: number,
    dataDomain?: DataDomain,
  ): ScalePair | null {
    if (pd.length === 0) return null;
    if (dataDomain) {
      return {
        x: d3.scaleLinear().domain([dataDomain.xMin, dataDomain.xMax]).range([0, exportWidth]),
        y: d3.scaleLinear().domain([dataDomain.yMin, dataDomain.yMax]).range([exportHeight, 0]),
      };
    }
    return fitScales(
      computePaddedExtent(pd.xs, pd.ys, pd.length),
      exportWidth,
      exportHeight,
      scaledExportMargin(config, exportWidth, exportHeight),
    );
  }
```

5. Replace `static getRenderInfo(…)` with its doc comment (`/**  * Display configuration the renderer would apply …` to its closing brace) with:

```ts
  /**
   * Where the data area of a default export sits, as margins in export pixels: the fitted
   * rectangle's edges, centring slack included. With the padded extent,
   * `marginLeft + (x − xMin) / (xMax − xMin) × (exportWidth − marginLeft − marginRight)` is then
   * exactly the export's x scale, and likewise for y, which is how the publish modal turns inset
   * source rects into data domains. Without data there is no fit: the scaled margins.
   */
  static getRenderInfo(
    config: ScatterplotConfig,
    pd: PlotData | null,
    exportWidth: number,
    exportHeight: number,
  ): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number } {
    const margin = scaledExportMargin(config, exportWidth, exportHeight);
    if (!pd || pd.length === 0) {
      return {
        marginLeft: margin.left,
        marginRight: margin.right,
        marginTop: margin.top,
        marginBottom: margin.bottom,
      };
    }
    const rect = fitRect(
      computePaddedExtent(pd.xs, pd.ys, pd.length),
      exportWidth,
      exportHeight,
      margin,
    );
    return {
      marginLeft: rect.left,
      marginRight: exportWidth - rect.left - rect.width,
      marginTop: rect.top,
      marginBottom: exportHeight - rect.top - rect.height,
    };
  }
```

In `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts`, replace `public getRenderInfo(…)` and its doc comment (:996-1009) with:

```ts
  /**
   * Where the data area of a reset-view export of the given size sits, as margins in export
   * pixels (the fitted rectangle's edges, from the last-rendered data). The publish modal inverts
   * inset source rects (canvas-norm) into data-coord viewports with it.
   */
  public getRenderInfo(
    exportWidth: number,
    exportHeight: number,
  ): { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number } {
    return ExportRenderer.getRenderInfo(
      this.getConfig(),
      this.lastRenderedData,
      exportWidth,
      exportHeight,
    );
  }
```

- [ ] **Step 8: Add `syncTransform` to the interaction controller**

In `packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts`:

1. Add after the `isZoomReady` getter (:86-88):

```ts
  /** Whether a resetZoom transition is still gliding to the identity. */
  get isResetting(): boolean {
    return this._resetsInFlight > 0;
  }
```

2. In `applyZoom`, replace the brush block at its end (from `// Keep brush extent in sync with the viewport when scroll-zooming in selection mode.` through the closing brace of its `if`) with:

```ts
    // Keep brush extent in sync with the viewport when scroll-zooming in selection mode.
    this.refreshBrushExtent();
```

3. Add after `setTransform(…)` (:200-204):

```ts
  /**
   * Adopt `t` without drawing, for a host that draws once itself: a resize that re-centres the
   * view. Unlike the three methods above it bypasses the behaviour, so it fires no zoom event and
   * schedules no zoom-frame draw, but it writes d3's stored transform (`__zoom` on the SVG) itself,
   * so the next wheel or drag starts from `t`.
   */
  syncTransform(t: d3.ZoomTransform): void {
    this._svgSelection?.property('__zoom', t);
    this.host.onTransform(t);
    const value = t.toString();
    this._mainGroup?.attr('transform', value);
    this._brushGroup?.attr('transform', value);
    this._overlayGroup?.attr('transform', value);
    this.refreshBrushExtent();
  }

  /**
   * Fit the rectangle brush to the visible area again, after a zoom, pan or resize moved it.
   * Skipped while a brush gesture runs: re-applying the brush resets d3's drag state.
   */
  refreshBrushExtent(): void {
    if (
      this.host.getSelectionMode() &&
      this.host.getSelectionTool() === 'rectangle' &&
      this._brush &&
      !this._isBrushing
    ) {
      this.updateBrushExtent();
    }
  }
```

- [ ] **Step 9: Keep the viewed centre in `_updateSizeAndRender`**

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Add `DATA_EXTENT_PADDING` to the value import from `@protspace/utils` (:14-21), after `DataProcessor,`.

2. Add after the `_transform` field (`private _transform = d3.zoomIdentity;`, :177):

```ts
  // Whether _updateSizeAndRender has measured the element yet; until then _mergedConfig holds the
  // default size, which no view was drawn at.
  private _sizeMeasured = false;
```

3. In `_updateSizeAndRender()` (:1209-1251):
   - after `const height = this.clientHeight || 600;` insert:

```ts
    // Read with the old size and scales, before _mergedConfig takes the new size.
    const centre = this._viewCentreDatum(width, height);
```

   - replace `this._mergedConfig = { ...this._mergedConfig, width, height };` with:

```ts
    this._mergedConfig = { ...this._mergedConfig, width, height };
    this._sizeMeasured = true;
    // Same zoom, same data at the centre (design decision 4). syncTransform draws nothing: the
    // synchronous draw below shows the new transform.
    if (centre) this._recentreView(centre, width, height);
    else this._interaction?.refreshBrushExtent();
```

4. Add after `_updateSizeAndRender()`:

```ts
  /**
   * The data point at the centre of the view, read before a resize takes effect, or null when the
   * resize need not move the view: no data or no measured size yet, the same size, the identity
   * view (the fit is centred, so it keeps its centre already, and staying exactly identity keeps
   * `_isZoomedIn` false and the perf pixel round trip exact), or a reset gliding to the identity.
   */
  private _viewCentreDatum(width: number, height: number): { x: number; y: number } | null {
    const scales = this._scales;
    const t = this._transform;
    if (!this._sizeMeasured || !scales) return null;
    const { width: oldWidth, height: oldHeight } = this._mergedConfig;
    if (oldWidth === width && oldHeight === height) return null;
    if (t.k === 1 && t.x === 0 && t.y === 0) return null;
    if (this._interaction?.isResetting) return null;
    return {
      x: scales.x.invert((oldWidth / 2 - t.x) / t.k),
      y: scales.y.invert((oldHeight / 2 - t.y) / t.k),
    };
  }

  /** Keeps the zoom factor and translates so `datum` sits at the centre of the resized view. */
  private _recentreView(datum: { x: number; y: number }, width: number, height: number): void {
    const scales = this._scales;
    if (!scales) return;
    const { k } = this._transform;
    this._interaction?.syncTransform(
      d3.zoomIdentity
        .translate(width / 2 - k * scales.x(datum.x), height / 2 - k * scales.y(datum.y))
        .scale(k),
    );
  }
```

5. Replace `public getDataExtent(…)` and its doc comment (:2302-2324) with:

```ts
  /**
   * Data extent of the most recently rendered points. With `padded: true` it applies
   * DATA_EXTENT_PADDING, as the live scales do, so the returned domain is the one the main plot
   * is fitted to.
   */
  public getDataExtent(
    options: { padded?: boolean } = {},
  ): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
    if (!this._webglRenderer) return null;
    this._renderLoop.flush();
    const ext = this._webglRenderer.getDataExtent();
    if (!ext) return null;
    if (!options.padded) return ext;
    const xPad = Math.abs(ext.xMax - ext.xMin) * DATA_EXTENT_PADDING;
    const yPad = Math.abs(ext.yMax - ext.yMin) * DATA_EXTENT_PADDING;
    return {
      xMin: ext.xMin - xPad,
      xMax: ext.xMax + xPad,
      yMin: ext.yMin - yPad,
      yMax: ext.yMax + yPad,
    };
  }
```

6. Replace the doc comment of `public getRenderInfo(…)` (:2285-2290) with:

```ts
  /**
   * Margins of the data area in a reset-view export at the given size, in export pixels: the
   * edges of the fitted rectangle, centring slack included. The publish modal uses this to
   * translate inset source rects (in canvas-norm 0–1) into accurate data-coordinate viewports.
   */
```

- [ ] **Step 10: Run the task's tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/webgl/renderer/export-renderer.test.ts src/components/scatter-plot/webgl/renderer/rescale.test.ts src/components/scatter-plot/interaction/plot-interaction-controller.test.ts src/components/scatter-plot/scatter-plot.resize.test.ts src/components/scatter-plot/scatter-plot.capture-badges-geometry.test.ts src/components/scatter-plot/webgl/renderer/webgl-renderer.export-scales.test.ts src/components/scatter-plot/scatter-plot.scales-cache.test.ts`
Expected: PASS, including "redraws on the spot without re-staging" (`restage` 0, three rebuilds) and the three geometry suites.

- [ ] **Step 11: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS; the baseline file count, test count plus the new cases. A core test that hard-codes a stretched pixel position is a real regression of this task: fix its expectation from `fitScales`, not the code.

Run: `pnpm --filter @protspace/utils exec vitest --run` (PASS, as in Step 4), then `pnpm --filter @protspace/core build && pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, counts unchanged.

Run: `pnpm type-check && pnpm knip`
Expected: clean. (`fitRect`, `fitScales`, `FitRect`, `DataDomain`, `PlotMargin` are public utils exports; `syncTransform`, `refreshBrushExtent` and `isResetting` have callers in `scatter-plot.ts`.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in Chromium, including `eat-visualization.spec.ts` (the export geometry reader at :188-210 now gets effective margins), `figure-editor.spec.ts` (inset colours at :198-229), `density-layer.spec.ts`, `brush-selection.spec.ts` and `zoom-indicator.spec.ts`.

Run (sandbox disabled; `pnpm perf:fetch --only phosphatase` once first if `perf/datasets/phosphatase.parquetbundle` is missing): `pnpm perf:counts`
Expected: PASS with every budget unchanged; `resize` stays at render 2, gridRebuild 2, restage 0, and every `pixels` column reads `same` (the camera segment's reset ends on the identity, which a resize keeps exactly).

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write packages/utils/src/visualization/scales.ts packages/utils/src/visualization/scales.test.ts packages/utils/src/visualization/data-processor.ts packages/utils/src/visualization/data-processor.test.ts packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.ts packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.test.ts packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts packages/core/src/components/scatter-plot/webgl/renderer/rescale.test.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.resize.test.ts
git add packages/utils/src/visualization/scales.ts packages/utils/src/visualization/scales.test.ts packages/utils/src/visualization/data-processor.ts packages/utils/src/visualization/data-processor.test.ts packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.ts packages/core/src/components/scatter-plot/webgl/renderer/export-renderer.test.ts packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts packages/core/src/components/scatter-plot/webgl/renderer/rescale.test.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.ts packages/core/src/components/scatter-plot/interaction/plot-interaction-controller.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.resize.test.ts
git commit -m "feat(core): keep the data's proportions and the viewed centre"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.2: Workbench shell and layout store

`/explore` becomes a workbench (decision 1): a 48 px app bar with the wordmark, the dataset name and protein count, Feedback and GitHub; a view bar that hosts the control bar until Tasks 2.5–2.10 split it; the plot; and a flush right sidebar with the legend over the structure viewer. The site header leaves the page, and the explore route loads lazily behind a new `@protspace/core/kit` subpath so tokens and kit elements exist at first paint (decision 5). The layout store (decision 10) and a transient status store bridge the React shell and the plain-TS runtime. Below 951 px a stacked fallback keeps today's narrow specs working until phase 5.

**Files:**

- Create: `apps/web/src/explore/layout-defaults.ts`, `layout-state.ts`, `layout-state.test.ts`, `workbench-status.ts`, `workbench-status.test.ts`
- Create: `apps/web/src/workbench/Workbench.tsx`, `AppBar.tsx`, `ViewBar.tsx`, `PlotArea.tsx`, `Sidebar.tsx`, `use-layout.ts`, `use-workbench-status.ts`, `use-layout-mode.ts`, `workbench.css`
- Modify: `apps/web/src/pages/Explore.tsx` (:46-94), `apps/web/src/App.tsx`, `apps/web/src/components/Header.tsx` (:22-56), `apps/web/src/explore/runtime.ts` (:63-69)
- Delete: `apps/web/src/pages/Explore.css`
- Modify: `packages/core/vite.config.ts`, `packages/core/package.json`, `packages/core/src/components/kit/index.ts`, `packages/core/src/index.ts` (drops its own `adoptTheme()` call)
- Create: `apps/web/tests/workbench-shell.spec.ts`
- Modify: `apps/web/tests/playwright.config.ts` (project `workbench`), `apps/web/tests/examples-live.spec.ts` (:108-111)

**Interfaces:**

- Consumes: `adoptTheme(doc?)` (`kit/adopt-theme.ts`); the kit (`ps-tooltip`); Tailwind `bg-ps-*`, `text-ps-*`, `border-ps-*`, `font-ps`, `rounded-ps`, `shadow-ps-*`; `getStorageItem`, `setStorageItem` (`@protspace/utils`); `buildMailto`, `GITHUB_REPO_URL` (`apps/web/src/lib/support.ts`); `/wordmark.svg`; `initializeExploreRuntime` and `useExploreUrlStateSync` (unchanged); the runtime's `setCurrentDatasetName` closure (`runtime.ts:63-65`).
- Produces:
  - `@protspace/core/kit`: package export `./kit` (`types: ./dist/components/kit/index.d.ts`, `import: ./dist/kit.mjs`, `require: ./dist/kit.js`), lib entry `kit: src/components/kit/index.ts`. Importing it adopts the theme into `document` (once) and defines every `ps-*` element; `@protspace/core` re-exports it, so importing core still adopts the theme.
  - `apps/web/src/explore/layout-defaults.ts`, a leaf module with no imports (Playwright helpers import it): `LAYOUT_STORAGE_KEY = 'protspace:layout:v1'`; `SIDEBAR_WIDTH = { min: 240, max: 480, default: 300 } as const`; `LEGEND_FRACTION = { min: 0.2, max: 0.8, default: 0.5 } as const`; `FLOATING_CARD = { minWidth: 280, minHeight: 240, defaultWidth: 340, defaultHeight: 360, inset: 14 } as const`; `DESKTOP_MIN_WIDTH = 951`; `type StructurePlacement = 'docked' | 'floating'`; `interface FloatingRect { x: number; y: number; width: number; height: number }`; `interface LayoutState { sidebarOpen: boolean; sidebarWidth: number; legendFraction: number; structurePlacement: StructurePlacement; floatingRect: FloatingRect | null }`; `DEFAULT_LAYOUT: LayoutState = { sidebarOpen: true, sidebarWidth: 300, legendFraction: 0.5, structurePlacement: 'docked', floatingRect: null }`.
  - `apps/web/src/explore/layout-state.ts`: `parseLayout(raw: unknown): LayoutState` (per field: a wrong type or non-finite number takes that field's default; width rounded and clamped to 240–480; fraction clamped to 0.2–0.8; rect: a missing or non-finite number → `null`, width and height raised to 280 and 240, x and y rounded; unknown fields dropped); `getLayout(): LayoutState` (reads storage on first call; the same object until a change); `subscribeLayout(listener: () => void): () => void`; `updateLayout(patch: Partial<LayoutState>): void` (parses the merged state, does nothing when equal, else writes once with `setStorageItem` and notifies); `resetLayoutForTests(): void`.
  - `apps/web/src/explore/workbench-status.ts`: `interface WorkbenchStatus { datasetName: string | null; proteinCount: number | null }`; `getWorkbenchStatus(): WorkbenchStatus`; `subscribeWorkbenchStatus(listener: () => void): () => void`; `setWorkbenchStatus(patch: Partial<WorkbenchStatus>): void` (no-op when equal); `resetWorkbenchStatusForTests(): void`. Later tasks add fields.
  - Hooks in `apps/web/src/workbench/`: `useLayout(): LayoutState` and `useWorkbenchStatus(): WorkbenchStatus` (`useSyncExternalStore`); `useLayoutMode(): 'desktop' | 'narrow'` (`matchMedia('(min-width: 951px)')`, live).
  - Components (named exports): `Workbench` (rendered by `pages/Explore.tsx`, which keeps the runtime effect and its default export), `AppBar`, `ViewBar`, `PlotArea`, `Sidebar`.
  - DOM contract:
    - root `div.workbench[data-layout="desktop|narrow"]`, `100dvh` with no page scroll on desktop; the page scrolls in narrow.
    - `header[data-workbench="app-bar"]` (banner, 48 px): `a[data-workbench="home"][aria-label="ProtSpace home"]` linking to `/`; `[data-workbench="dataset"][data-dataset-name]` showing the name and "· N proteins" in tabular figures (empty before a load); an empty `[data-workbench="app-bar-center"]`; `[data-workbench="app-bar-actions"]` holding links named "Feedback" (`buildMailto({ subject: 'ProtSpace feedback' })`) and "GitHub" (new tab, `noopener noreferrer`), each labelled with a `ps-tooltip`.
    - `div[role="toolbar"][aria-label="View"][data-workbench="view-bar"]`, at least 44 px tall, holding `protspace-control-bar#myControlBar` with today's attributes.
    - `div.wb-body[data-workbench="body"]`, `position: relative`, with `--wb-sidebar-width: <stored width>px`: `main[data-workbench="plot"]` (absolutely inset; its right edge is the sidebar's left edge) holding `protspace-scatterplot#myPlot` with today's attributes; `aside#wb-sidebar[data-workbench="sidebar"][aria-label="Sidebar"]` (absolute, right 0, width `var(--wb-sidebar-width)`, flush, `border-left` only) holding `#myLegend` (flex 1, host chrome removed) above `#myStructureViewer` (today's attributes; it still shows and hides itself until Task 2.11).
    - `protspace-data-loader#myDataLoader`, mounted once in the root.
    - Narrow: the plot first (60vh, at least 320 px), then the sidebar's content in normal flow.
  - Runtime: wherever it sets the control bar's `currentDatasetName`, it also calls `setWorkbenchStatus({ datasetName, proteinCount })` with `proteinCount = plotElement.data?.protein_ids.length ?? null`.
  - `Header`: no `variant` prop; `HEADER_HEIGHT_CLASS` is no longer exported. `/` and `/privacy` render it as before.
  - Playwright project `workbench`: `devices['Desktop Chrome']`, viewport 1280×720, `testMatch: /(^|[\\/])workbench-[^\\/]*\.spec\.ts$/`.

**Tests:**

- `apps/web/src/explore/layout-state.test.ts` (unit, node; stub `localStorage` with `vi.stubGlobal` as `tooltip-annotations-store.test.ts:7-27` does):
  - "loads the defaults when nothing is stored"
  - "round-trips every field"
  - "falls back per field on wrong types, NaN, Infinity and an unknown placement"
  - "rounds and clamps the sidebar width to 240–480"
  - "clamps the legend fraction to 0.2–0.8"
  - "drops a floating rect with a non-finite number and raises a small one to 280 × 240"
  - "loads the defaults from garbage JSON, an array or null"
  - "loads the defaults when getItem throws, and survives a throwing setItem"
  - "returns the same object until a change"
  - "an equal patch neither notifies nor writes"
  - "unsubscribe stops notifications"
  - "writes once per update, to protspace:layout:v1 only"
- `apps/web/src/explore/workbench-status.test.ts` (unit): "starts empty"; "merges a patch and notifies once"; "an equal patch does not notify"; "keeps the snapshot until a change".
- `apps/web/tests/workbench-shell.spec.ts` (e2e, project `workbench`):
  - "explore is a workbench without the site navigation": banner 48 px; no Home, Docs or Resources links; "ProtSpace home" links to `/`; view bar at least 44 px; the plot's right edge equals the sidebar's left edge; sidebar 300 px; `#myPlot`, `#myLegend`, `#myStructureViewer`, `#myDataLoader` attached.
  - "the app bar names the dataset and its protein count"
  - "tokens and the kit are ready before the explore runtime loads": with `**/src/explore/runtime.ts*` held, `ps-button` is defined, `protspace-scatterplot` is not, and the app bar's bottom border is `rgb(226, 232, 240)`.
  - "crossing 951 px keeps the same runtime elements": the `#myPlot`, `#myLegend` and `#myStructureViewer` instances are identical before and after resizing to 900 px and back (Review Focus 1); at 900 px the plot is above the legend and the page scrolls.
  - "loads without console errors", including custom-element redefinitions.
  - "the landing and privacy pages keep the site header"
- Build check: after `pnpm --filter @protspace/app build`, the entry chunk that `/` loads contains neither `protspace-scatterplot` nor `ps-button` (core and the kit stay in the lazy explore chunks).
- The existing suite stays green, including the narrow checks in `eat-visualization.spec.ts` (:510-525, :676-724) and `legend-double-click.spec.ts`.

**Commit:** `feat(web): add the workbench shell and its layout store`

Notes for the implementer:

- Example labels read "name · N proteins · size" (`defineExample` in `example-datasets.ts`). `data-dataset-name` holds the full label (the e2e helper `getCurrentDatasetName`, Task 2.3, compares it with `entry.label`), while the bar shows only the part before the first " · " followed by its own "· N proteins", as the approved mockup shows ("Venom toxins (demo) · 7,831 proteins"). A file name has no " · " and shows whole.
- Runtime elements (`#myPlot`, `#myLegend`, `#myStructureViewer`, `#myControlBar`, `#myDataLoader`) sit at a fixed position in the tree with static props only; a parent may re-render (status, props), but never with a `key`, a conditional or a second tree around a runtime element. In this task they sit in components with no props wrapped in `memo`, or directly in `Workbench`, so a store-driven render never re-creates or moves them. Do not add a `key`, a conditional, or a second tree for the narrow layout: the narrow fallback is CSS on `[data-layout='narrow']` only.
- No ancestor of `#myLegend` or of the bars gets `transform`, `translate`, `filter`, `contain` or `container-type`, and the bars get no `overflow: hidden` and no `z-index`. `#myPlot` and the plot area get `isolation: isolate`.
- Shell CSS reads colours, type, radii and shadows only from `var(--ps-…)`; no raw colours anywhere under `apps/web/src/workbench/`.

- [ ] **Step 1: Write the failing store tests**

Create `apps/web/src/explore/layout-state.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, type LayoutState } from './layout-defaults';
import {
  getLayout,
  parseLayout,
  resetLayoutForTests,
  subscribeLayout,
  updateLayout,
} from './layout-state';

const store = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => store.clear()),
  key: vi.fn((index: number) => [...store.keys()][index] ?? null),
  get length() {
    return store.size;
  },
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', storage);
  resetLayoutForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layout store', () => {
  it('loads the defaults when nothing is stored', () => {
    expect(getLayout()).toEqual(DEFAULT_LAYOUT);
    expect(storage.getItem).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
  });

  it('round-trips every field', () => {
    const layout: LayoutState = {
      sidebarOpen: false,
      sidebarWidth: 412,
      legendFraction: 0.35,
      structurePlacement: 'floating',
      floatingRect: { x: 40, y: 24, width: 360, height: 300 },
    };
    updateLayout(layout);
    resetLayoutForTests();
    expect(getLayout()).toEqual(layout);
  });

  it('falls back per field on wrong types, NaN, Infinity and an unknown placement', () => {
    expect(
      parseLayout({
        sidebarOpen: 'yes',
        sidebarWidth: Number.NaN,
        legendFraction: Number.POSITIVE_INFINITY,
        structurePlacement: 'sideways',
        floatingRect: 'bottom-right',
      }),
    ).toEqual(DEFAULT_LAYOUT);
    // A bad field leaves the good ones alone.
    expect(parseLayout({ sidebarOpen: false, sidebarWidth: '320', extra: 1 })).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarOpen: false,
    });
  });

  it('rounds and clamps the sidebar width to 240–480', () => {
    expect(parseLayout({ sidebarWidth: 100 }).sidebarWidth).toBe(240);
    expect(parseLayout({ sidebarWidth: 999 }).sidebarWidth).toBe(480);
    expect(parseLayout({ sidebarWidth: 301.6 }).sidebarWidth).toBe(302);
  });

  it('clamps the legend fraction to 0.2–0.8', () => {
    expect(parseLayout({ legendFraction: 0 }).legendFraction).toBe(0.2);
    expect(parseLayout({ legendFraction: 1 }).legendFraction).toBe(0.8);
    expect(parseLayout({ legendFraction: 0.63 }).legendFraction).toBe(0.63);
  });

  it('drops a floating rect with a non-finite number and raises a small one to 280 × 240', () => {
    expect(
      parseLayout({ floatingRect: { x: 1, y: 2, width: Number.NaN, height: 300 } }).floatingRect,
    ).toBeNull();
    expect(parseLayout({ floatingRect: { x: 1, y: 2, width: 300 } }).floatingRect).toBeNull();
    expect(
      parseLayout({ floatingRect: { x: 10.4, y: 20.6, width: 100, height: 50 } }).floatingRect,
    ).toEqual({ x: 10, y: 21, width: 280, height: 240 });
  });

  it('loads the defaults from garbage JSON, an array or null', () => {
    for (const raw of ['{not json', '[1, 2, 3]', 'null', '"text"']) {
      store.set(LAYOUT_STORAGE_KEY, raw);
      resetLayoutForTests();
      expect(getLayout()).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('loads the defaults when getItem throws, and survives a throwing setItem', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });
    expect(getLayout()).toEqual(DEFAULT_LAYOUT);

    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    expect(() => updateLayout({ sidebarWidth: 360 })).not.toThrow();
    expect(getLayout().sidebarWidth).toBe(360);
  });

  it('returns the same object until a change', () => {
    const first = getLayout();
    expect(getLayout()).toBe(first);
    expect(storage.getItem).toHaveBeenCalledTimes(1);

    updateLayout({ sidebarOpen: false });
    const second = getLayout();
    expect(second).not.toBe(first);
    expect(getLayout()).toBe(second);
  });

  it('an equal patch neither notifies nor writes', () => {
    const listener = vi.fn();
    subscribeLayout(listener);
    const before = getLayout();

    updateLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth, floatingRect: null });

    expect(listener).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(getLayout()).toBe(before);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLayout(listener);
    updateLayout({ sidebarOpen: false });
    unsubscribe();
    updateLayout({ sidebarOpen: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('writes once per update, to protspace:layout:v1 only', () => {
    updateLayout({ sidebarWidth: 360 });
    updateLayout({ legendFraction: 0.3, structurePlacement: 'floating' });

    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([
      'protspace:layout:v1',
      'protspace:layout:v1',
    ]);
    expect(JSON.parse(store.get('protspace:layout:v1')!)).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarWidth: 360,
      legendFraction: 0.3,
      structurePlacement: 'floating',
    });
  });
});
```

Create `apps/web/src/explore/workbench-status.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWorkbenchStatus,
  resetWorkbenchStatusForTests,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('workbench status', () => {
  it('starts empty', () => {
    expect(getWorkbenchStatus()).toEqual({ datasetName: null, proteinCount: null });
  });

  it('merges a patch and notifies once', () => {
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    expect(listener).toHaveBeenCalledOnce();

    setWorkbenchStatus({ proteinCount: 12 });
    expect(getWorkbenchStatus()).toEqual({ datasetName: 'demo.parquetbundle', proteinCount: 12 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('an equal patch does not notify', () => {
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle' });
    setWorkbenchStatus({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the snapshot until a change', () => {
    const first = getWorkbenchStatus();
    setWorkbenchStatus({ datasetName: null });
    expect(getWorkbenchStatus()).toBe(first);
    setWorkbenchStatus({ datasetName: 'mine.parquetbundle' });
    expect(getWorkbenchStatus()).not.toBe(first);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-state.test.ts src/explore/workbench-status.test.ts`
Expected: FAIL, both files: the imports of `./layout-defaults`, `./layout-state` and `./workbench-status` do not resolve, because the modules do not exist yet.

- [ ] **Step 3: Write the layout constants and the two stores**

Create `apps/web/src/explore/layout-defaults.ts`:

```ts
/**
 * The workbench's layout constants, types and defaults (design decision 10). A leaf module with no
 * imports, so the Playwright helpers can import it as well. Sizes the shell clamps against live
 * here, never as --ps-* tokens.
 */

/** The one localStorage key the layout is kept under. Layout never goes into the URL. */
export const LAYOUT_STORAGE_KEY = 'protspace:layout:v1';

/** The sidebar's width in px, stored within min and max and clamped again to the window at render. */
export const SIDEBAR_WIDTH = { min: 240, max: 480, default: 300 } as const;

/** The legend's share of the sidebar's height above the divider. */
export const LEGEND_FRACTION = { min: 0.2, max: 0.8, default: 0.5 } as const;

/** The floating structure card in px; its default spot is `inset` from the plot's bottom-right. */
export const FLOATING_CARD = {
  minWidth: 280,
  minHeight: 240,
  defaultWidth: 340,
  defaultHeight: 360,
  inset: 14,
} as const;

/** The narrowest window that gets the desktop workbench; below it, a stacked fallback. */
export const DESKTOP_MIN_WIDTH = 951;

export type StructurePlacement = 'docked' | 'floating';

/** The floating card in px, relative to the plot area's top-left corner. */
export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  legendFraction: number;
  structurePlacement: StructurePlacement;
  /** null: the default spot at the plot area's bottom-right corner. */
  floatingRect: FloatingRect | null;
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH.default,
  legendFraction: LEGEND_FRACTION.default,
  structurePlacement: 'docked',
  floatingRect: null,
};
```

Create `apps/web/src/explore/layout-state.ts`:

```ts
import { getStorageItem, setStorageItem } from '@protspace/utils';
import {
  DEFAULT_LAYOUT,
  FLOATING_CARD,
  LAYOUT_STORAGE_KEY,
  LEGEND_FRACTION,
  SIDEBAR_WIDTH,
  type FloatingRect,
  type LayoutState,
  type StructurePlacement,
} from './layout-defaults';

/**
 * The persisted workbench layout (design decision 10): the React shell subscribes with
 * useSyncExternalStore and the runtime reads and writes it through the same functions. It is read
 * once, parsed field by field, and written once per committed change, never during a drag. Clamps
 * that depend on the window happen at render and never rewrite it.
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPlacement = (value: unknown): value is StructurePlacement =>
  value === 'docked' || value === 'floating';

function parseRect(raw: unknown): FloatingRect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height } = raw as Partial<Record<keyof FloatingRect, unknown>>;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(FLOATING_CARD.minWidth, Math.round(width)),
    height: Math.max(FLOATING_CARD.minHeight, Math.round(height)),
  };
}

/** A layout from anything stored: each field that is missing or invalid takes its default. */
export function parseLayout(raw: unknown): LayoutState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_LAYOUT };
  const value = raw as Partial<Record<keyof LayoutState, unknown>>;
  return {
    sidebarOpen:
      typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : DEFAULT_LAYOUT.sidebarOpen,
    sidebarWidth: isFiniteNumber(value.sidebarWidth)
      ? clamp(Math.round(value.sidebarWidth), SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
      : DEFAULT_LAYOUT.sidebarWidth,
    legendFraction: isFiniteNumber(value.legendFraction)
      ? clamp(value.legendFraction, LEGEND_FRACTION.min, LEGEND_FRACTION.max)
      : DEFAULT_LAYOUT.legendFraction,
    structurePlacement: isPlacement(value.structurePlacement)
      ? value.structurePlacement
      : DEFAULT_LAYOUT.structurePlacement,
    floatingRect: parseRect(value.floatingRect),
  };
}

function sameRect(a: FloatingRect | null, b: FloatingRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameLayout(a: LayoutState, b: LayoutState): boolean {
  return (
    a.sidebarOpen === b.sidebarOpen &&
    a.sidebarWidth === b.sidebarWidth &&
    a.legendFraction === b.legendFraction &&
    a.structurePlacement === b.structurePlacement &&
    sameRect(a.floatingRect, b.floatingRect)
  );
}

let layout: LayoutState | null = null;
const listeners = new Set<() => void>();

/** The layout: read from storage on the first call, then the same object until a change. */
export function getLayout(): LayoutState {
  layout ??= parseLayout(getStorageItem<unknown>(LAYOUT_STORAGE_KEY, null));
  return layout;
}

export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Commits a change: parsed, written once and announced; an equal layout does nothing. */
export function updateLayout(patch: Partial<LayoutState>): void {
  const current = getLayout();
  const next = parseLayout({ ...current, ...patch });
  if (sameLayout(current, next)) return;
  layout = next;
  setStorageItem(LAYOUT_STORAGE_KEY, next);
  for (const listener of [...listeners]) listener();
}

export function resetLayoutForTests(): void {
  layout = null;
  listeners.clear();
}
```

Create `apps/web/src/explore/workbench-status.ts`:

```ts
/**
 * Transient facts the explore runtime publishes for the React shell, which never reads them off the
 * runtime's elements. Nothing here is persisted. Later tasks add fields.
 */
export interface WorkbenchStatus {
  /** The dataset on screen: an example's label or a file's name; null before a load. */
  datasetName: string | null;
  /** Its protein count; null before a load. */
  proteinCount: number | null;
}

const EMPTY: WorkbenchStatus = { datasetName: null, proteinCount: null };

let status: WorkbenchStatus = EMPTY;
const listeners = new Set<() => void>();

/** The current status: the same object until a field changes, as useSyncExternalStore needs. */
export function getWorkbenchStatus(): WorkbenchStatus {
  return status;
}

export function subscribeWorkbenchStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merges `patch` and notifies, unless no field changes. */
export function setWorkbenchStatus(patch: Partial<WorkbenchStatus>): void {
  const next = { ...status, ...patch };
  const keys = Object.keys(next) as Array<keyof WorkbenchStatus>;
  if (keys.every((key) => Object.is(next[key], status[key]))) return;
  status = next;
  for (const listener of [...listeners]) listener();
}

export function resetWorkbenchStatusForTests(): void {
  status = EMPTY;
  listeners.clear();
}
```

- [ ] **Step 4: Run the store tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/layout-state.test.ts src/explore/workbench-status.test.ts`
Expected: PASS, 16 tests (12 in `layout-state.test.ts`, 4 in `workbench-status.test.ts`).

- [ ] **Step 5: Write the failing shell spec and its Playwright project**

In `apps/web/tests/playwright.config.ts`, add this project right after the `foundation` project (the object whose `testMatch` is `/foundation\.spec\.ts/`):

```ts
    {
      // The workbench shell and its controls (workbench-*.spec.ts), at the size it is designed for.
      name: 'workbench',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: /(^|[\\/])workbench-[^\\/]*\.spec\.ts$/,
    },
```

Task 1.12 already added a `kit-gallery` project; leave it.

Create `apps/web/tests/workbench-shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET } from '../src/explore/example-datasets';
import { getProteinCount, holdNextRequest, openExplore } from './helpers/explore';

/**
 * The workbench shell (Task 2.2): the app bar, the view bar, the plot beside a flush sidebar, the
 * narrow fallback and first paint. Regions are found by the data-workbench hooks the shell renders.
 */

const RUNTIME_ELEMENTS = ['myPlot', 'myLegend', 'myStructureViewer'];

test.describe('workbench shell', () => {
  test('explore is a workbench without the site navigation', async ({ page }) => {
    await openExplore(page);

    const banner = page.getByRole('banner');
    await expect(banner).toHaveAttribute('data-workbench', 'app-bar');
    expect((await banner.boundingBox())?.height).toBe(48);
    for (const name of ['Home', 'Docs']) {
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Resources', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('link', { name: 'ProtSpace home' })).toHaveAttribute('href', '/');

    const viewBar = page.getByRole('toolbar', { name: 'View' });
    expect((await viewBar.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const plot = await page.locator('[data-workbench="plot"]').boundingBox();
    const sidebar = await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox();
    expect(Math.abs(plot!.x + plot!.width - sidebar!.x)).toBeLessThan(0.5);
    expect(sidebar!.width).toBe(300);

    for (const id of [...RUNTIME_ELEMENTS, 'myDataLoader']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('the app bar names the dataset and its protein count', async ({ page }) => {
    await openExplore(page);
    const count = await getProteinCount(page);

    const dataset = page.locator('[data-workbench="dataset"]');
    await expect(dataset).toHaveAttribute('data-dataset-name', DEFAULT_EXAMPLE_DATASET.label);
    // An example's label reads "name · proteins · size"; the bar shows the name and its own count.
    await expect(dataset.locator('.wb-dataset-name')).toHaveText(
      DEFAULT_EXAMPLE_DATASET.label.split(' · ')[0],
    );
    const countText = dataset.locator('.wb-dataset-count');
    // The bar formats in the browser's locale; read the same formatting there.
    const expected = await page.evaluate((n) => `· ${n.toLocaleString()} proteins`, count);
    await expect(countText).toHaveText(expected);
    await expect(countText).toHaveCSS('font-variant-numeric', 'tabular-nums');
  });

  test('tokens and the kit are ready before the explore runtime loads', async ({ page }) => {
    const releaseRuntime = await holdNextRequest(page, '**/src/explore/runtime.ts*');
    await page.goto('/explore');

    const appBar = page.locator('header[data-workbench="app-bar"]');
    await expect(appBar).toBeVisible();
    const defined = await page.evaluate(() => ({
      kit: customElements.get('ps-button') !== undefined,
      core: customElements.get('protspace-scatterplot') !== undefined,
    }));
    expect(defined).toEqual({ kit: true, core: false });
    // --ps-border, so the theme was adopted before the full core arrived.
    await expect(appBar).toHaveCSS('border-bottom-color', 'rgb(226, 232, 240)');
    releaseRuntime();
  });

  test('crossing 951 px keeps the same runtime elements', async ({ page }) => {
    await openExplore(page);
    const root = page.locator('.workbench');
    await expect(root).toHaveAttribute('data-layout', 'desktop');

    await page.evaluate((ids) => {
      (window as unknown as { __runtimeElements: Array<Element | null> }).__runtimeElements =
        ids.map((id) => document.getElementById(id));
    }, RUNTIME_ELEMENTS);
    const sameElements = () =>
      page.evaluate((ids) => {
        const before = (window as unknown as { __runtimeElements: Array<Element | null> })
          .__runtimeElements;
        return ids.every(
          (id, index) => before[index] !== null && document.getElementById(id) === before[index],
        );
      }, RUNTIME_ELEMENTS);

    await page.setViewportSize({ width: 900, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'narrow');
    expect(await sameElements()).toBe(true);
    const plot = await page.locator('#myPlot').boundingBox();
    const legend = await page.locator('#myLegend').boundingBox();
    expect(plot!.y + plot!.height).toBeLessThanOrEqual(legend!.y + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'desktop');
    expect(await sameElements()).toBe(true);
  });

  test('loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Cloudflare's analytics beacon (index.html) fails without network; it is not the app.
      const where = `${message.text()} ${message.location()?.url ?? ''}`;
      if (/cloudflareinsights|cloudflare-insights/.test(where)) return;
      errors.push(message.text());
    });
    await openExplore(page);
    // A second definition of a tag ("has already been used with this registry") would land here.
    expect(errors).toEqual([]);
  });

  test('the landing and privacy pages keep the site header', async ({ page }) => {
    for (const path of ['/', '/privacy']) {
      await page.goto(path);
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Docs', exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-workbench]')).toHaveCount(0);
    }
  });
});
```

- [ ] **Step 6: Run the spec to see it fail**

Run (sandbox disabled: it starts a server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-shell`
Expected: FAIL. "explore is a workbench…" fails on `toHaveAttribute('data-workbench', 'app-bar')`: the banner is still the site header. "the app bar names…", "tokens and the kit…" and "crossing 951 px…" time out waiting for `[data-workbench="dataset"]`, the app bar and `.workbench`. "loads without console errors" and "the landing and privacy pages keep the site header" may already pass; that is expected.

- [ ] **Step 7: Add the `@protspace/core/kit` entry**

In `packages/core/vite.config.ts`, replace the `entry` object:

```ts
      entry: {
        core: resolve(__dirname, 'src/index.ts'),
        publish: resolve(__dirname, 'src/components/publish/index.ts'),
      },
```

with:

```ts
      entry: {
        core: resolve(__dirname, 'src/index.ts'),
        publish: resolve(__dirname, 'src/components/publish/index.ts'),
        // The kit alone (tokens and ps-* elements), for a page that paints before the full core
        // loads: the explore route imports it first. core re-exports it, so one module defines
        // the elements whichever entry a page imports.
        kit: resolve(__dirname, 'src/components/kit/index.ts'),
      },
```

In `packages/core/package.json`, add the `./kit` export after `./publish`, so `exports` reads:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/core.mjs",
      "require": "./dist/core.js"
    },
    "./publish": {
      "types": "./dist/components/publish/index.d.ts",
      "import": "./dist/publish.mjs",
      "require": "./dist/publish.js"
    },
    "./kit": {
      "types": "./dist/components/kit/index.d.ts",
      "import": "./dist/kit.mjs",
      "require": "./dist/kit.js"
    }
  },
```

In `packages/core/src/components/kit/index.ts`, replace the first line:

```ts
// Public kit API (design decision 8). Each kit task adds its exports here.
```

with:

```ts
// Public kit API (design decision 8). Each kit task adds its exports here. Importing the kit, as
// `@protspace/core` and the `@protspace/core/kit` entry both do, adopts the theme into the
// document once, so every component reads --ps-* tokens from :root (design decision 5).
import { adoptTheme } from './adopt-theme';

if (typeof document !== 'undefined') adoptTheme();

```

(leave every `export … from` line below it as it is).

In `packages/core/src/index.ts`, delete the first four lines:

```ts
import { adoptTheme } from './components/kit/adopt-theme';

// Every component reads --ps-* tokens from the document root (design decision 5).
if (typeof document !== 'undefined') adoptTheme();
```

The `export * from './components/kit';` line further down stays: it now brings the theme with it.

- [ ] **Step 8: Build core and check the new entry**

Run: `pnpm --filter @protspace/core build 2>&1 | tail -3`
Expected: the build succeeds.

Run: `ls packages/core/dist/kit.mjs packages/core/dist/kit.js packages/core/dist/components/kit/index.d.ts && grep -l -e "'ps-button'" -e '"ps-button"' packages/core/dist/*.mjs`
Expected: the three files are listed, and the `grep` prints exactly one file, `packages/core/dist/kit.mjs`: `core.mjs` imports the kit from it instead of carrying a second copy, so `ps-button` is defined by one module.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit`
Expected: PASS (the kit's jsdom tests; importing the barrel now also adopts the theme, which they tolerate).

- [ ] **Step 9: Write the shell's store hooks**

Create `apps/web/src/workbench/use-layout.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { LayoutState } from '../explore/layout-defaults';
import { getLayout, subscribeLayout } from '../explore/layout-state';

/** The persisted layout; re-renders on every committed change. */
export function useLayout(): LayoutState {
  return useSyncExternalStore(subscribeLayout, getLayout);
}
```

Create `apps/web/src/workbench/use-workbench-status.ts`:

```ts
import { useSyncExternalStore } from 'react';
import {
  getWorkbenchStatus,
  subscribeWorkbenchStatus,
  type WorkbenchStatus,
} from '../explore/workbench-status';

/** What the runtime last published about the dataset on screen. */
export function useWorkbenchStatus(): WorkbenchStatus {
  return useSyncExternalStore(subscribeWorkbenchStatus, getWorkbenchStatus);
}
```

Create `apps/web/src/workbench/use-layout-mode.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { DESKTOP_MIN_WIDTH } from '../explore/layout-defaults';

const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const getMode = (): 'desktop' | 'narrow' =>
  window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'narrow';

/** 'desktop' from 951 px wide and 'narrow' below, following the window live. */
export function useLayoutMode(): 'desktop' | 'narrow' {
  return useSyncExternalStore(subscribe, getMode);
}
```

- [ ] **Step 10: Write the shell components and their stylesheet**

Create `apps/web/src/workbench/AppBar.tsx`:

```tsx
import { Github, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';
import { useWorkbenchStatus } from './use-workbench-status';

const FEEDBACK_HREF = buildMailto({ subject: 'ProtSpace feedback' });

/** An example's label reads "name · proteins · size"; the bar shows the name and its own count. */
function shownName(datasetName: string): string {
  return datasetName.split(' · ')[0];
}

function proteinCountText(count: number): string {
  return `· ${count.toLocaleString()} ${count === 1 ? 'protein' : 'proteins'}`;
}

/**
 * The 48 px app bar (design decision 1): the wordmark, the dataset on screen, a centre that search
 * takes in Task 2.9, and the actions. The site's navigation stays on the other pages.
 */
export function AppBar() {
  const { datasetName, proteinCount } = useWorkbenchStatus();
  return (
    <header className="wb-app-bar" data-workbench="app-bar">
      <Link to="/" data-workbench="home" aria-label="ProtSpace home">
        <img src="/wordmark.svg" alt="" />
      </Link>
      <span className="wb-separator" aria-hidden="true" />
      <div data-workbench="dataset" data-dataset-name={datasetName ?? ''}>
        {datasetName !== null && <span className="wb-dataset-name">{shownName(datasetName)}</span>}
        {proteinCount !== null && (
          <span className="wb-dataset-count">{proteinCountText(proteinCount)}</span>
        )}
      </div>
      <div data-workbench="app-bar-center" />
      <div data-workbench="app-bar-actions">
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
    </header>
  );
}
```

(`namesTarget`: the link's `aria-label` already carries the tooltip's text, so the tooltip does not describe it a second time. The kit is defined before the first render, so React sets it as a property; `names-target=""` would fail the type-check, which types the attribute as a boolean.)

Create `apps/web/src/workbench/ViewBar.tsx`:

```tsx
import { memo } from 'react';

/**
 * How the plot is drawn (design decision 1). It hosts the control bar until Tasks 2.5–2.10 split it
 * into one-job pickers. Memoised and without props: a store-driven render never touches the bar.
 */
export const ViewBar = memo(function ViewBar() {
  return (
    <div role="toolbar" aria-label="View" data-workbench="view-bar">
      <protspace-control-bar
        id="myControlBar"
        data-driver-id="control-bar"
        selected-proteins-count="0"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      ></protspace-control-bar>
    </div>
  );
});
```

Create `apps/web/src/workbench/PlotArea.tsx`:

```tsx
import { memo } from 'react';

/**
 * The plot. The tool strip (Task 2.9) and the status corner (4.2) join it here. Memoised and
 * without props, so the scatterplot renders once and is never re-created.
 */
export const PlotArea = memo(function PlotArea() {
  return (
    <main className="wb-plot" data-workbench="plot">
      <protspace-scatterplot
        id="myPlot"
        data-driver-id="scatterplot"
        show-tour-button="true"
      ></protspace-scatterplot>
    </main>
  );
});
```

Create `apps/web/src/workbench/Sidebar.tsx`:

```tsx
import { memo } from 'react';

/**
 * The flush right sidebar (design decision 2): the legend over the structure viewer, which still
 * shows and hides itself until Task 2.11. Memoised and without props, so neither runtime element
 * is ever re-created or moved.
 */
export const Sidebar = memo(function Sidebar() {
  return (
    <aside id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      ></protspace-legend>
      <protspace-structure-viewer
        id="myStructureViewer"
        title="AlphaFold2 Structure"
        height="340px"
        show-header="true"
        show-close-button="true"
        show-tips="true"
        auto-sync="true"
        auto-show="true"
        scatterplot-selector="#myPlot"
        style={{ display: 'none' }}
      ></protspace-structure-viewer>
    </aside>
  );
});
```

Create `apps/web/src/workbench/Workbench.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { AppBar } from './AppBar';
import { PlotArea } from './PlotArea';
import { Sidebar } from './Sidebar';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';
import { ViewBar } from './ViewBar';
import './workbench.css';

/**
 * The explore workbench (design decision 1): the app bar, the view bar, then the plot beside a
 * flush right sidebar. The runtime finds its elements by id, so they render once in this fixed tree;
 * every layout state is a data attribute or a --wb-* property that workbench.css reads.
 */
export function Workbench() {
  const layout = useLayout();
  const mode = useLayoutMode();
  return (
    <div className="workbench" data-layout={mode}>
      <AppBar />
      <ViewBar />
      <div
        className="wb-body"
        data-workbench="body"
        style={{ '--wb-sidebar-width': `${layout.sidebarWidth}px` } as CSSProperties}
      >
        <PlotArea />
        <Sidebar />
      </div>
      <protspace-data-loader id="myDataLoader"></protspace-data-loader>
    </div>
  );
}
```

Create `apps/web/src/workbench/workbench.css`:

```css
/*
 * The explore workbench (design decision 1). The runtime's elements render once, in a fixed tree;
 * every layout state is a data attribute or a --wb-* custom property read here. Colours, type,
 * radii and shadows come from the --ps-* tokens; shell sizes are literals or --wb-* properties.
 * No transform, filter, contain or container-type sits on an ancestor of the legend or the bars:
 * their position: fixed popovers would be trapped. The bars get no overflow: hidden and no
 * z-index; the plot area isolates its own stacking.
 */

.workbench {
  --wb-app-bar-height: 48px;
  --wb-view-bar-min-height: 44px;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--ps-surface);
  color: var(--ps-text);
  font-family: var(--ps-font-sans);
  font-size: var(--ps-text-base);
  line-height: var(--ps-leading-tight);
}

/* Desktop: the window is the workbench, and the page never scrolls. */
.workbench[data-layout='desktop'] {
  height: 100dvh;
  overflow: hidden;
}

/* ── App bar ─────────────────────────────────────────────────────────────── */

[data-workbench='app-bar'] {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ps-space-2);
  height: var(--wb-app-bar-height);
  /* 16 px on the left, as in the mockup: the scale has no 16 px step. */
  padding: 0 var(--ps-space-2) 0 16px;
  border-bottom: 1px solid var(--ps-border);
  background: var(--ps-surface);
}

[data-workbench='home'] {
  display: inline-flex;
  flex: none;
  align-items: center;
  border-radius: var(--ps-radius);
}

[data-workbench='home'] img {
  display: block;
  width: auto;
  height: 22px;
}

.wb-separator {
  flex: none;
  width: 1px;
  height: 20px;
  background: var(--ps-border);
}

[data-workbench='dataset'] {
  display: flex;
  align-items: baseline;
  gap: var(--ps-space-1-5);
  min-width: 0;
  white-space: nowrap;
}

.wb-dataset-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: var(--ps-weight-semibold);
}

.wb-dataset-count {
  flex: none;
  color: var(--ps-text-muted);
  font-variant-numeric: tabular-nums;
}

[data-workbench='app-bar-center'] {
  flex: 1 1 auto;
  min-width: 0;
}

[data-workbench='app-bar-actions'] {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ps-space-1-5);
}

.wb-icon-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ps-control-md);
  height: var(--ps-control-md);
  border-radius: var(--ps-radius);
  color: var(--ps-text-muted);
}

.wb-icon-link:hover {
  background: var(--ps-surface-hover);
  color: var(--ps-text);
}

[data-workbench='home']:focus-visible,
.wb-icon-link:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: var(--ps-focus-offset);
}

/* ── View bar ────────────────────────────────────────────────────────────── */

[data-workbench='view-bar'] {
  display: flex;
  flex: none;
  align-items: center;
  min-height: var(--wb-view-bar-min-height);
  border-bottom: 1px solid var(--ps-border);
  background: var(--ps-surface);
}

/* The control bar fills the view bar until Tasks 2.5–2.10 split it. */
#myControlBar {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
}

/* ── Body: the plot beside the sidebar ───────────────────────────────────── */

.wb-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

[data-workbench='plot'] {
  position: absolute;
  inset: 0 var(--wb-sidebar-width) 0 0;
  isolation: isolate;
  background: var(--ps-surface);
}

#myPlot {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  isolation: isolate;
}

[data-workbench='sidebar'] {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: var(--wb-sidebar-width);
  border-left: 1px solid var(--ps-border);
  background: var(--ps-surface);
}

/* The legend fills the column; the sidebar draws the edges, so the host's own card goes. */
#myLegend {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

/* The viewer still shows and hides itself, at its own height, until Task 2.11. */
#myStructureViewer {
  flex: none;
  width: auto;
  border: 0;
  border-top: 1px solid var(--ps-border);
  border-radius: 0;
  box-shadow: none;
}

/* ── Narrow fallback below 951 px: the plot, then the sidebar; the page scrolls ── */

.workbench[data-layout='narrow'] .wb-body {
  display: flex;
  flex-direction: column;
}

.workbench[data-layout='narrow'] [data-workbench='plot'] {
  position: relative;
  inset: auto;
  height: 60vh;
  min-height: 320px;
}

.workbench[data-layout='narrow'] [data-workbench='sidebar'] {
  position: static;
  width: auto;
  border-top: 1px solid var(--ps-border);
  border-left: 0;
}

.workbench[data-layout='narrow'] #myLegend {
  flex: none;
  min-height: 320px;
}
```

- [ ] **Step 11: Put the shell on the page**

Replace the whole of `apps/web/src/pages/Explore.tsx` with (the effect is unchanged; the markup at :46-94 becomes `<Workbench />`):

```tsx
// Tokens and the kit before the shell's first render: React sets kit properties only on a defined
// element, and the bars paint from --ps-* tokens (design decision 5). The full core arrives later,
// with the runtime.
import '@protspace/core/kit';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useExploreUrlStateSync } from '../explore/use-url-state-sync';
import { Workbench } from '../workbench/Workbench';

const Explore = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { attachController } = useExploreUrlStateSync(searchParams, setSearchParams);

  useEffect(() => {
    let mounted = true;
    let detachController: (() => void) | null = null;

    // Initialize the Explore runtime asynchronously
    const init = async () => {
      try {
        // Import and initialize the Explore runtime
        const { initializeExploreRuntime } = await import('../explore/runtime');

        // Only proceed if component is still mounted
        if (!mounted) return;

        // Wait for custom elements to be defined and initialized
        const controller = await initializeExploreRuntime();

        if (!mounted) {
          controller.dispose();
          return;
        }

        detachController = attachController(controller);
      } catch (error) {
        console.error('Failed to initialize the Explore runtime:', error);
      }
    };

    init();

    return () => {
      mounted = false;
      detachController?.();
    };
  }, [attachController]);

  return <Workbench />;
};

export default Explore;
```

Delete `apps/web/src/pages/Explore.css`: `rm apps/web/src/pages/Explore.css`.

In `apps/web/src/App.tsx`:

1. If the file has no `import { lazy, Suspense } from 'react';` line (Task 1.12 adds it), add it after the `TooltipProvider` import.
2. Delete the line `import Explore from './pages/Explore';`.
3. Directly above the comment `// Development-only review page for the kit; production builds drop the import entirely.` that Task 1.12 put over its `KitGallery` constant (or, without it, directly above `const App = () => (`), add, followed by a blank line:

```tsx
// The explore page loads on demand: its kit, tokens, shell and runtime never reach the landing page.
const Explore = lazy(() => import('./pages/Explore'));
```

4. Replace `<Route path="/explore" element={<Explore />} />` with:

```tsx
        <Route
          path="/explore"
          element={
            <Suspense fallback={null}>
              <Explore />
            </Suspense>
          }
        />
```

In `apps/web/src/components/Header.tsx`, replace this block (lines 12-51):

```tsx
// Ghost-style Feedback CTA: transparent, on-brand blue text/icon with a faint blue
// hover — de-emphasized vs. the app-shell primary (#3c83f6). Both headers are light, so
// the canonical ProtSpace blue (#00a3e0, ~2.6:1 on white) is darkened to #006d96
// (~5.3:1) to clear WCAG AA.
const FEEDBACK_BUTTON_CLASS =
  'text-[#006d96] hover:bg-[#006d96]/10 hover:text-[#006d96] focus-visible:ring-[#006d96]';

const mode = import.meta.env.MODE === 'production' ? 'production' : 'development';
const navItems = getNavigation(mode);

export const HEADER_HEIGHT_CLASS = 'h-12';

type HeaderProps = {
  /**
   * Visual style variant for different page backgrounds.
   * - default: uses the site theme background (white)
   * - light: matches Explore's #f4f4f4 canvas
   */
  variant?: 'default' | 'light';
  className?: string;
};

const Header = ({ variant = 'default', className }: HeaderProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const textClass = variant === 'light' ? 'text-slate-900' : 'text-foreground';
  const hoverTextClass = variant === 'light' ? 'hover:text-slate-700' : 'hover:text-primary';
  const mutedTextClass = variant === 'light' ? 'text-slate-700' : 'text-foreground/80';

  const headerClasses = cn(
    'fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-lg',
    variant === 'light' ? 'bg-[#f4f4f4]/95 border-black/5' : 'bg-background/85 border-border',
    className,
  );

  const dropdownClasses = cn(
    'absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 border',
    variant === 'light' ? 'bg-white border-black/5' : 'bg-background border-border/40',
  );
```

with:

```tsx
// Ghost-style Feedback CTA: transparent, on-brand blue text/icon with a faint blue
// hover — de-emphasized vs. the app-shell primary (#3c83f6). The header is light, so
// the canonical ProtSpace blue (#00a3e0, ~2.6:1 on white) is darkened to #006d96
// (~5.3:1) to clear WCAG AA.
const FEEDBACK_BUTTON_CLASS =
  'text-[#006d96] hover:bg-[#006d96]/10 hover:text-[#006d96] focus-visible:ring-[#006d96]';

const mode = import.meta.env.MODE === 'production' ? 'production' : 'development';
const navItems = getNavigation(mode);

const HEADER_HEIGHT_CLASS = 'h-12';
const textClass = 'text-foreground';
const hoverTextClass = 'hover:text-primary';
const mutedTextClass = 'text-foreground/80';
const dropdownClasses =
  'absolute top-full right-0 mt-2 w-48 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 border bg-background border-border/40';

type HeaderProps = {
  className?: string;
};

/** The site header of the landing and privacy pages; the explore page has its own app bar. */
const Header = ({ className }: HeaderProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const headerClasses = cn(
    'fixed top-0 left-0 right-0 z-50 border-b backdrop-blur-lg bg-background/85 border-border',
    className,
  );
```

and, in the desktop dropdown's sub-item links, replace the line

```tsx
                            variant === 'light' ? 'hover:bg-black/5' : 'hover:bg-muted/50',
```

with:

```tsx
                            'hover:bg-muted/50',
```

Run `grep -n "variant ===\|variant?\|variant =\|HEADER_HEIGHT_CLASS" apps/web/src/components/Header.tsx`. Expected: two lines, `const HEADER_HEIGHT_CLASS = 'h-12';` and its use in the header row (`` `flex ${HEADER_HEIGHT_CLASS} items-center justify-between` ``). (The two `<Button … variant="ghost">` lines stay; the pattern skips them.)

In `apps/web/src/explore/runtime.ts`, add to the imports (beside `import { createViewController } from './view-controller';`):

```ts
import { setWorkbenchStatus } from './workbench-status';
```

and replace (lines 63-69):

```ts
  const setCurrentDatasetName = (name: string) => {
    controlBar.currentDatasetName = name;
  };

  const setCurrentExampleId = (id: string | null) => {
    controlBar.currentExampleId = id;
  };
```

with:

```ts
  const setCurrentDatasetName = (name: string) => {
    controlBar.currentDatasetName = name;
    // The app bar names the dataset on screen and its size.
    setWorkbenchStatus({
      datasetName: name,
      proteinCount: plotElement.data?.protein_ids.length ?? null,
    });
  };

  const setCurrentExampleId = (id: string | null) => {
    controlBar.currentExampleId = id;
  };

  // A remounted page starts from an empty app bar until its own first load names a dataset.
  lifecycle.addCleanup(() => setWorkbenchStatus({ datasetName: null, proteinCount: null }));
```

`apps/web/src/custom-elements.d.ts` needs no change: Task 1.12 typed `ps-tooltip`, with `namesTarget` as a property and `names-target` as a boolean attribute.

In `apps/web/tests/examples-live.spec.ts`, replace (:108-111):

```ts
      await page
        .locator('.visualization-container')
        .screenshot({ path: path.join(THUMBNAIL_DIR, `${entry.id}.png`) });
```

with (the plot and the legend beside it, as the old container held them):

```ts
      await page
        .locator('[data-workbench="body"]')
        .screenshot({ path: path.join(THUMBNAIL_DIR, `${entry.id}.png`) });
```

- [ ] **Step 12: Run the shell spec and the build check**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-shell`
Expected: PASS, 6 tests.

Run: `pnpm --filter @protspace/app build 2>&1 | tail -3`
Expected: the type-check and the Vite build succeed, and the output lists a separate `Explore-*.js` chunk.

Run: `for f in $(grep -oE '/assets/[^"]+\.js' apps/web/dist/index.html); do printf '%s %s\n' "$f" "$(grep -c -e 'protspace-scatterplot' -e 'ps-button' "apps/web/dist$f")"; done`
Expected: every line ends in ` 0`: the scripts `/` loads (the entry and its modulepreloads) carry neither the explore shell's runtime tags nor the kit; both sit in the lazy explore chunks.

- [ ] **Step 13: Run the full suites this task affects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: every unit and browser file passes; the counts equal the phase-2 baseline (Task 2.1's report), as this task adds no core test.

Run: `pnpm --filter @protspace/utils exec vitest --run 2>&1 | tail -4`
Expected: PASS, unchanged counts.

Run: `pnpm --filter @protspace/app exec vitest --run 2>&1 | tail -4`
Expected: PASS, the baseline plus 2 files (16 tests).

Run: `pnpm type-check 2>&1 | tail -3 && pnpm knip`
Expected: no type errors; knip reports nothing (`HEADER_HEIGHT_CLASS` is no longer exported, and every new export has a consumer: the hooks in the components, the store functions in the hooks, the runtime and the tests).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e 2>&1 | tail -6`
Expected: the full suite passes, including the `workbench`, `foundation` and `kit-gallery` projects, the narrow checks in `eat-visualization.spec.ts` (320–800 px) and `legend-double-click.spec.ts`. If a spec fails, stop and report it with its error output; do not edit other specs in this task.

Run (sandbox disabled; once, if missing: `pnpm perf:fetch --only phosphatase`): `pnpm perf:counts 2>&1 | tail -6`
Expected: every segment within budget: the shell changes the plot's size, not the work an interaction does. If a budget is exceeded, report the segment and its counts instead of re-recording (Task 2.12 pins the layout and records `panel-toggle`).

Run: `pnpm exec prettier --check apps/web/src/workbench apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-state.ts apps/web/src/explore/layout-state.test.ts apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts apps/web/src/explore/runtime.ts apps/web/src/pages/Explore.tsx apps/web/src/App.tsx apps/web/src/components/Header.tsx packages/core/vite.config.ts packages/core/package.json packages/core/src/components/kit/index.ts packages/core/src/index.ts apps/web/tests/workbench-shell.spec.ts apps/web/tests/playwright.config.ts apps/web/tests/examples-live.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not).

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/explore/layout-defaults.ts apps/web/src/explore/layout-state.ts \
  apps/web/src/explore/layout-state.test.ts apps/web/src/explore/workbench-status.ts \
  apps/web/src/explore/workbench-status.test.ts apps/web/src/explore/runtime.ts \
  apps/web/src/workbench apps/web/src/pages/Explore.tsx apps/web/src/pages/Explore.css \
  apps/web/src/App.tsx apps/web/src/components/Header.tsx \
  packages/core/vite.config.ts packages/core/package.json \
  packages/core/src/components/kit/index.ts packages/core/src/index.ts \
  apps/web/tests/workbench-shell.spec.ts apps/web/tests/playwright.config.ts \
  apps/web/tests/examples-live.spec.ts
git commit -m "feat(web): add the workbench shell and its layout store"
```

(`git add` of the deleted `Explore.css` stages its removal.)

---

### Task 2.3: E2E helpers that do not depend on the layout

Twelve specs and the perf scenarios reach into `protspace-control-bar`'s shadow root. This task routes every such access through named helpers in `apps/web/tests/helpers/explore.ts` that find controls by role, accessible name or tag (Playwright's CSS pierces shadow roots), still pointing at the control bar. Tasks 2.5–2.9 then change only helper internals when a control moves, and a contract spec proves each helper still works after every move.

**Files:**

- Modify: `apps/web/tests/helpers/explore.ts` (:170-343), `apps/web/tests/helpers/perf/scenarios.ts` (`importBundle` :205-228, `search-select` :313-336)
- Modify: `apps/web/tests/dataset-reload.spec.ts` (:195-216), `eat-visualization.spec.ts` (:35-37, :302-313, :373, :416-452, :628-674, :776-778), `example-datasets.spec.ts` (:67-110, :474-502), `examples-live.spec.ts` (:12, :103), `figure-editor.spec.ts` (:30), `isolation-dataset-swap.spec.ts` (:37, :80-90), `load-large-bundle.spec.ts` (:59-61, :218), `multi-annotation-tooltip.spec.ts` (:10-86), `numeric-binning.spec.ts` (:150-159, :414-772, :1213, :2396-2413, :2485, :2507), `perf-scale.spec.ts` (:190, :346, :408, :438), `product-tour.spec.ts` (:27-115), `url-view-state.spec.ts` (:37-110, :340-445, :654-660)
- Create: `apps/web/tests/workbench-helpers.spec.ts`

**Interfaces:**

- Consumes: the control bar's current DOM (`#projection-trigger`, `.projection-container .dropdown-item`, `protspace-annotation-select`, `#density-layer-trigger`, `.density-item[data-mode]`, `.right-controls-select`, the "Rectangle selection" and "Lasso selection" buttons, Clear, Isolate and Reset, `.filter-container .dropdown-trigger`, the "Filter Query Builder" dialog, the Export and Import triggers, `.export-menu`, `.import-menu`); `#myPlot` (`selectedAnnotation`, `selectedProjectionIndex`, `data.projections`, `tooltipAnnotations`, `selectedProteinIds`, `config.densityLayer`, `selectionMode`, `selectionTool`); `[data-workbench]` hooks (Task 2.2).
- Produces, exported from `helpers/explore.ts` (later tasks change internals only, never names or meaning):
  - Regions: `appBar(page)`, `viewBar(page)`, `plotArea(page)`, `sidebar(page)`: `Locator`.
  - State: `interface ViewState { annotation: string | null; projection: string | null; tooltip: string[] }`; `getViewState(page): Promise<ViewState>` (reads `#myPlot`; `getControlBarView` is removed); `curatedViewOf(entry): ViewState`; `getColorByOptions(page): Promise<string[]>`; `getContoursMode(page): Promise<'off' | 'auto' | 'on'>`; `getSelectedProteinIds(page): Promise<string[]>`; `getCurrentDatasetName(page): Promise<string | null>` (now `[data-workbench="dataset"]`'s `data-dataset-name`).
  - Locators: `projectionTrigger(page)`, `colorByTrigger(page)`, `importTrigger(page)`, `importMenu(page)` (the element holding the Import panel), `exportMenu(page)`, `filterButton(page)`, `filterDialog(page)`, `queryBuilder(page)` (`page.locator('protspace-query-builder')`), `annotationSelect(page)` (`page.locator('protspace-annotation-select')`), `searchInput(page)` (`page.locator('protspace-protein-search #protein-search-input')`), `selectionAction(page, name: 'Clear' | 'Isolate' | 'Reset')`.
  - Actions: `selectAnnotation(page, annotation)` and `selectProjection(page, projection: number | string)` (kept; the internal `pickFromMenu` listens on `document`; `waitForViewState` no longer waits on the control bar); `setContours(page, mode: 'off' | 'auto' | 'on')`; `openImportMenu(page)` (kept); `pickExample(page, id: string)`; `openExportMenu(page)`; `openFilter(page)` (resolves once `filterDialog` is visible); `chooseTool(page, tool: 'Move and zoom' | 'Box select' | 'Lasso select')`; `clearSelection(page)`, `isolateSelection(page)`, `resetIsolation(page)`.
  - `product-tour.spec.ts`: `type StepTarget = null | { driverId: string }`; the highlight check finds `[data-driver-id="…"]` through shadow roots, so steps 2–6 and 9 are `{ driverId }` and pass before and after each control moves.
  - `url-view-state.spec.ts`'s deep-link test records `selectedAnnotation` and `selectedProjection` assignments on whichever of `protspace-annotation-select`, `protspace-projection-select` and (until 2.10) `protspace-control-bar` defines them.
  - `dataset-reload.spec.ts`'s compact-layout test checks that the Import trigger stays visible with `aria-haspopup` at 568 px.
  - Afterwards no spec outside `helpers/` names `protspace-control-bar`, `#myControlBar` or `.right-controls-*`, except the event dispatches at `dataset-reload.spec.ts:595, :630, :659` (retargeted in Tasks 2.9 and 2.5) and the deep-link test's setter-trap entry in `url-view-state.spec.ts` (removed in Task 2.10).

**Tests:**

- `apps/web/tests/workbench-helpers.spec.ts` (e2e, project `workbench`; a contract spec every split task re-runs):
  - "getViewState reads the plot's view"
  - "selectProjection and selectAnnotation change the plot"
  - "setContours changes the plot's contour mode and the URL"
  - "openImportMenu shows the examples and pickExample loads one"
  - "openExportMenu shows the export formats"
  - "openFilter opens the filter dialog with its query builder"
  - "chooseTool switches between move, box and lasso"
  - "clearSelection, isolateSelection and resetIsolation act on the selection"
  - "getCurrentDatasetName names the loaded dataset"
- Every migrated spec keeps its meaning and passes in a full Chromium run; `pnpm perf:counts` passes (import and search-select now use the helpers).

**Commit:** `test(web): reach explore controls through layout-free helpers`

Notes for the implementer:

- Two helper internals rely on the annotation select keeping its shape through Task 2.8 (which changes only `projectionTrigger`, `selectProjection`, `setContours` and `getColorByOptions`): `colorByTrigger` is the select's first `button[aria-haspopup]` (its trigger), and `selectAnnotation` clicks its `.dropdown-item[data-annotation="…"]` rows. Both say so in their doc comments.
- Where a spec read control-bar state that the plot also holds, it now reads the plot: the control bar's `filterActive` becomes the plot's `filtersActive` (both are set together in `_applyMatchedIndices` and cleared together in `_clearFilterChannel`), its `densityLayer` becomes `getContoursMode`, its `selectedAnnotation` and `tooltipAnnotations` become `getViewState`, and its `annotations` become `getColorByOptions`. Its `isolationMode` mirror stays observable through the Reset button, which it renders.
- The numeric-binning query-builder helpers keep reading the builder's own shadow DOM (its rows and value pickers are its internals, not layout), but reach the builder through `queryBuilder(page)` instead of the control bar's shadow root.

- [ ] **Step 1: Write the failing contract spec**

Create `apps/web/tests/workbench-helpers.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET, EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import {
  appBar,
  chooseTool,
  clearSelection,
  expectUrlParam,
  exportMenu,
  filterButton,
  filterDialog,
  getColorByOptions,
  getContoursMode,
  getCurrentDatasetName,
  getSelectedProteinIds,
  getViewState,
  importMenu,
  isolateSelection,
  openExplore,
  openExportMenu,
  openFilter,
  openImportMenu,
  pickExample,
  plotArea,
  queryBuilder,
  resetIsolation,
  searchInput,
  selectAnnotation,
  selectionAction,
  selectProjection,
  setContours,
  sidebar,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';

/**
 * The contract of the layout-free helpers in helpers/explore.ts. A task that moves a control
 * changes helper internals and re-runs this spec, which must keep passing unchanged.
 */

async function plotProjections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { data?: { projections?: Array<{ name: string }> } | null })
      | null;
    return plot?.data?.projections?.map((projection) => projection.name) ?? [];
  });
}

async function plotTool(page: Page): Promise<{ selectionMode: boolean; selectionTool?: string }> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { selectionMode?: boolean; selectionTool?: string })
      | null;
    return { selectionMode: plot?.selectionMode ?? false, selectionTool: plot?.selectionTool };
  });
}

test.describe('explore helpers', () => {
  test("getViewState reads the plot's view", async ({ page }) => {
    await openExplore(page);
    const projections = await plotProjections(page);
    expect(projections.length).toBeGreaterThanOrEqual(2);

    await openExplore(
      page,
      `?annotation=ec&projection=${encodeURIComponent(projections[1])}&tooltip=pfam`,
    );
    await expect(plotArea(page).locator('#myPlot')).toBeVisible();
    const expected: ViewState = { annotation: 'ec', projection: projections[1], tooltip: ['pfam'] };
    await expect.poll(() => getViewState(page)).toEqual(expected);
  });

  test('selectProjection and selectAnnotation change the plot', async ({ page }) => {
    await openExplore(page);
    const before = await getViewState(page);
    const nextAnnotation = (await getColorByOptions(page)).find(
      (annotation) => annotation !== before.annotation,
    );
    expect(nextAnnotation).toBeTruthy();

    await selectAnnotation(page, nextAnnotation!);
    expect((await getViewState(page)).annotation).toBe(nextAnnotation);
    await expect
      .poll(() =>
        sidebar(page)
          .locator('#myLegend')
          .evaluate((legend) => (legend as Element & { selectedAnnotation?: string }).selectedAnnotation),
      )
      .toBe(nextAnnotation);

    const projections = await plotProjections(page);
    const nextIndex = projections.findIndex((projection) => projection !== before.projection);
    await selectProjection(page, nextIndex);
    expect((await getViewState(page)).projection).toBe(projections[nextIndex]);
    await selectProjection(page, before.projection!);
    expect((await getViewState(page)).projection).toBe(before.projection);
  });

  test("setContours changes the plot's contour mode and the URL", async ({ page }) => {
    await openExplore(page);
    expect(await getContoursMode(page)).toBe('off');

    await setContours(page, 'auto');
    expect(await getContoursMode(page)).toBe('auto');
    await expectUrlParam(page, 'density', 'auto');

    await setContours(page, 'on');
    await expectUrlParam(page, 'density', 'on');

    await setContours(page, 'off');
    expect(await getContoursMode(page)).toBe('off');
    await expectUrlParam(page, 'density', null);
  });

  test('openImportMenu shows the examples and pickExample loads one', async ({ page }) => {
    await serveExampleFixtures(page);
    const other = e2eExample('other');
    await openExplore(page);

    await openImportMenu(page);
    await expect(importMenu(page).locator('[data-example-id]')).toHaveCount(
      EXAMPLE_DATASETS.length,
    );
    await pickExample(page, other.id);
    await waitForProteinCount(page, other.count);
    await expectUrlParam(page, 'dataset', other.id);
  });

  test('openExportMenu shows the export formats', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);
    for (const format of ['PNG', 'PDF', 'IDs', 'Parquet']) {
      await expect(exportMenu(page).getByRole('button', { name: format, exact: true })).toBeVisible();
    }
    // An open menu stays open.
    await openExportMenu(page);
    await expect(exportMenu(page).getByRole('button', { name: 'PNG', exact: true })).toBeVisible();
  });

  test('openFilter opens the filter dialog with its query builder', async ({ page }) => {
    await openExplore(page);
    await expect(filterButton(page)).toBeVisible();
    await openFilter(page);
    await expect(filterDialog(page)).toBeVisible();
    await expect(queryBuilder(page)).toBeVisible();
    // An open dialog stays open.
    await openFilter(page);
    await expect(filterDialog(page)).toBeVisible();
  });

  test('chooseTool switches between move, box and lasso', async ({ page }) => {
    await openExplore(page);
    await chooseTool(page, 'Box select');
    expect(await plotTool(page)).toEqual({ selectionMode: true, selectionTool: 'rectangle' });
    await chooseTool(page, 'Lasso select');
    expect(await plotTool(page)).toEqual({ selectionMode: true, selectionTool: 'lasso' });
    await chooseTool(page, 'Move and zoom');
    expect((await plotTool(page)).selectionMode).toBe(false);
  });

  test('clearSelection, isolateSelection and resetIsolation act on the selection', async ({
    page,
  }) => {
    await openExplore(page);
    const ids = await page.evaluate(() =>
      (
        document.querySelector('#myPlot') as Element & { data: { protein_ids: string[] } }
      ).data.protein_ids.slice(0, 2),
    );
    // Two proteins: isolating one would leave too few points to select from.
    const selectBoth = async () => {
      for (const id of ids) {
        await searchInput(page).fill(id);
        await searchInput(page).press('Enter');
      }
      await expect.poll(async () => (await getSelectedProteinIds(page)).sort()).toEqual(
        [...ids].sort(),
      );
    };

    await selectBoth();
    await isolateSelection(page);
    await expect(selectionAction(page, 'Reset')).toBeVisible();
    await resetIsolation(page);
    await expect(selectionAction(page, 'Reset')).toHaveCount(0);

    await selectBoth();
    await clearSelection(page);
    expect(await getSelectedProteinIds(page)).toEqual([]);
  });

  test('getCurrentDatasetName names the loaded dataset', async ({ page }) => {
    await openExplore(page);
    expect(await getCurrentDatasetName(page)).toBe(DEFAULT_EXAMPLE_DATASET.label);
    await expect(appBar(page)).toContainText(DEFAULT_EXAMPLE_DATASET.label.split(' · ')[0]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run (sandbox disabled: it starts a server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers`
Expected: FAIL before any test runs: the spec does not load, because `./helpers/explore` does not export `appBar` (and the other new names) yet.

- [ ] **Step 3: Write the helpers**

In `apps/web/tests/helpers/explore.ts`, replace everything from the line

```ts
/** The view the control bar shows: colour-by annotation, projection and tooltip annotations. */
```

through the closing `}` of `selectProjection` (the line before `export async function getFirstLegendItemValue`) with:

```ts
// ─── Regions ───────────────────────────────────────────────────────────────────
// The workbench's regions, by the data-workbench hooks the shell renders. Specs reach controls
// through the helpers below, which find them by role, accessible name or tag (Playwright's CSS
// pierces shadow roots). When a control moves, a helper's internals change and no spec does.

export const appBar = (page: Page): Locator => page.locator('[data-workbench="app-bar"]');
export const viewBar = (page: Page): Locator => page.locator('[data-workbench="view-bar"]');
export const plotArea = (page: Page): Locator => page.locator('[data-workbench="plot"]');
export const sidebar = (page: Page): Locator => page.locator('[data-workbench="sidebar"]');

// ─── View state ────────────────────────────────────────────────────────────────

/** The view the plot shows: colour-by annotation, projection and tooltip annotations. */
export interface ViewState {
  annotation: string | null;
  projection: string | null;
  tooltip: string[];
}

/** The view, read from #myPlot whichever controls show it. */
export async function getViewState(page: Page): Promise<ViewState> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjectionIndex?: number;
          tooltipAnnotations?: string[];
          data?: { projections?: Array<{ name: string }> } | null;
        })
      | null;
    const index = plot?.selectedProjectionIndex ?? -1;
    return {
      annotation: plot?.selectedAnnotation ?? null,
      projection: plot?.data?.projections?.[index]?.name ?? null,
      tooltip: [...(plot?.tooltipAnnotations ?? [])],
    };
  });
}

/** A catalog entry's curated view, in the shape `getViewState` reads. */
export function curatedViewOf(entry: {
  defaultView: { projection: string; annotation: string; tooltip?: readonly string[] };
}): ViewState {
  return {
    annotation: entry.defaultView.annotation,
    projection: entry.defaultView.projection,
    tooltip: [...(entry.defaultView.tooltip ?? [])],
  };
}

/** The annotations Color by offers, in its order (tooltip-only and EAT-confidence columns left out). */
export async function getColorByOptions(page: Page): Promise<string[]> {
  return annotationSelect(page).evaluate(
    (select) => [...((select as Element & { annotations?: string[] }).annotations ?? [])],
    undefined,
    { timeout: 10_000 },
  );
}

/** The plot's contour mode. */
export async function getContoursMode(page: Page): Promise<'off' | 'auto' | 'on'> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { config?: { densityLayer?: 'off' | 'auto' | 'on' } })
      | null;
    return plot?.config?.densityLayer ?? 'off';
  });
}

/** The proteins the plot has selected. */
export async function getSelectedProteinIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { selectedProteinIds?: string[] })
      | null;
    return [...(plot?.selectedProteinIds ?? [])];
  });
}

/**
 * Collects the development-mode warnings `dataset-controller.ts` logs when a
 * loaded example's bundle lacks one of its `defaultView` names.
 */
export function collectDefaultViewDriftWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('defaultView names missing')) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

/** The dataset the app bar names: an example's label or a file's name; null before a load. */
export async function getCurrentDatasetName(page: Page): Promise<string | null> {
  const name = await appBar(page)
    .locator('[data-workbench="dataset"]')
    .getAttribute('data-dataset-name');
  return name || null;
}

// ─── Controls ──────────────────────────────────────────────────────────────────

/** The Projection picker's trigger; its accessible name starts with "Projection". */
export const projectionTrigger = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^Projection/ });

/**
 * The Color by picker's trigger: the annotation select's first popup button. The select keeps its
 * trigger first when it moves to the view bar (Task 2.8).
 */
export const colorByTrigger = (page: Page): Locator =>
  annotationSelect(page).locator('button[aria-haspopup]').first();

/** The Import menu's trigger. */
export const importTrigger = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: 'Import', exact: true });

/** The element that holds the Import panel: today the control bar. */
export const importMenu = (page: Page): Locator => page.locator('protspace-control-bar');

/** The element that holds the Export panel: today the control bar. */
export const exportMenu = (page: Page): Locator => page.locator('protspace-control-bar');

/** The Filter button; its accessible name starts with "Filter" (and shows the condition count). */
export const filterButton = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^Filter/ });

/** The open filter dialog. */
export const filterDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Filter Query Builder' });

export const queryBuilder = (page: Page): Locator => page.locator('protspace-query-builder');

export const annotationSelect = (page: Page): Locator => page.locator('protspace-annotation-select');

export const searchInput = (page: Page): Locator =>
  page.locator('protspace-protein-search #protein-search-input');

/** Clear, Isolate or Reset. Clear and Isolate need a selection; Reset shows only while isolated. */
export const selectionAction = (page: Page, name: 'Clear' | 'Isolate' | 'Reset'): Locator =>
  viewBar(page).getByRole('button', { name, exact: true });

// ─── Actions ───────────────────────────────────────────────────────────────────

/**
 * Opens the Import menu unless it is open. Importing a custom dataset leaves the menu open
 * (nothing closes it), so only click the trigger when the menu is closed: re-clicking toggles it.
 */
export async function openImportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await importTrigger(page).click();
  }
  await expect(ownDataset).toBeVisible();
}

/** Chooses an example from the Import menu by its catalog id. */
export async function pickExample(page: Page, id: string): Promise<void> {
  await openImportMenu(page);
  await importMenu(page).locator(`[data-example-id="${id}"]`).click();
}

/** Opens the Export menu unless it is open; resolves once its formats show. */
export async function openExportMenu(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const png = exportMenu(page).getByRole('button', { name: 'PNG', exact: true });
  if (!(await png.isVisible().catch(() => false))) {
    await exportMenu(page).getByRole('button', { name: 'Export', exact: true }).click();
  }
  await expect(png).toBeVisible();
}

/** Opens the filter dialog unless it is open; resolves once it shows. */
export async function openFilter(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  if (await filterDialog(page).isVisible().catch(() => false)) return;
  await filterButton(page).click();
  await expect(filterDialog(page)).toBeVisible();
}

/**
 * Imports `file` (a path, or a payload built in the test) through the data
 * loader's file input, the input the Import menu's "Load your dataset" opens.
 */
export async function importUserFile(
  page: Page,
  file: Parameters<Locator['setInputFiles']>[0],
): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.locator('protspace-data-loader').locator('input[type="file"]').setInputFiles(file);
}

type ViewHost = Element & { selectedAnnotation?: string; selectedProjectionIndex?: number };

/** Wait until every element in `selectors` reports `value` for `key`. */
async function waitForViewState(
  page: Page,
  key: 'selectedAnnotation' | 'selectedProjectionIndex',
  value: string | number,
  selectors: string[],
): Promise<void> {
  try {
    await page.waitForFunction(
      ({ key, value, selectors }) =>
        selectors.every(
          (selector) => (document.querySelector(selector) as ViewHost | null)?.[key] === value,
        ),
      { key, value, selectors },
      { timeout: 10_000 },
    );
  } catch (error) {
    const actual = await page
      .evaluate(
        ({ key, selectors }) =>
          selectors
            .map((s) => `${s} ${String((document.querySelector(s) as ViewHost | null)?.[key])}`)
            .join(', '),
        { key, selectors },
      )
      .catch(() => 'unreadable');
    throw new Error(`${key} never became ${JSON.stringify(value)} (still ${actual})`, {
      cause: error,
    });
  }
}

/**
 * Click a picker's menu item and wait until the pick is applied. A picker applies a pick after the
 * next paint and then dispatches `event`, which bubbles out of every shadow root to the document,
 * also when the pick re-selects the current value and so changes no state a test could wait for.
 */
async function pickFromMenu(
  page: Page,
  item: Locator,
  event: 'annotation-change' | 'projection-change' | 'density-layer-change',
): Promise<void> {
  const applied = await page.evaluateHandle((type) => {
    const state = { done: false };
    document.addEventListener(
      type,
      () => {
        state.done = true;
      },
      { once: true },
    );
    return state;
  }, event);
  await item.click();
  await page.waitForFunction((state) => state.done, applied, { timeout: 10_000 });
  await applied.dispose();
}

/**
 * Picks `annotation` from Color by. Its rows show the display label and carry the raw key on
 * `data-annotation`; the annotation select keeps those rows when it moves (Task 2.8).
 */
export async function selectAnnotation(page: Page, annotation: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  const item = annotationSelect(page)
    .locator(`.dropdown-item[data-annotation="${annotation}"]`)
    .first();
  // The trigger toggles, so only click it when the menu is closed.
  if (!(await item.isVisible())) await colorByTrigger(page).click();
  await expect(item, `annotation menu item "${annotation}" not shown`).toBeVisible({
    timeout: 5_000,
  });
  await pickFromMenu(page, item, 'annotation-change');
  await waitForViewState(page, 'selectedAnnotation', annotation, ['#myPlot', 'protspace-legend']);
}

/** Pick a projection by its position in the menu, or by its label. */
export async function selectProjection(page: Page, projection: number | string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await projectionTrigger(page).click();
  const item =
    typeof projection === 'number'
      ? viewBar(page).getByRole('option').nth(projection)
      : viewBar(page).getByRole('option', { name: projection, exact: true });
  await pickFromMenu(page, item, 'projection-change');
  if (typeof projection === 'number') {
    await waitForViewState(page, 'selectedProjectionIndex', projection, ['#myPlot']);
  }
}

/** Sets the contour mode from the Contours menu and waits until the plot uses it. */
export async function setContours(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await waitForExploreInteractionReady(page);
  await viewBar(page).getByRole('button', { name: /^Contours/ }).click();
  await pickFromMenu(
    page,
    viewBar(page).locator(`[role="menuitemradio"][data-mode="${mode}"]`),
    'density-layer-change',
  );
  await expect.poll(() => getContoursMode(page)).toBe(mode);
}

const TOOL_STATES = {
  'Move and zoom': { selectionMode: false },
  'Box select': { selectionMode: true, selectionTool: 'rectangle' },
  'Lasso select': { selectionMode: true, selectionTool: 'lasso' },
} as const;

/** Chooses a plot tool and waits until the plot uses it. */
export async function chooseTool(
  page: Page,
  tool: 'Move and zoom' | 'Box select' | 'Lasso select',
): Promise<void> {
  await waitForExploreInteractionReady(page);
  const readTool = () =>
    page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { selectionMode?: boolean; selectionTool?: string })
        | null;
      return {
        selectionMode: plot?.selectionMode ?? false,
        selectionTool: plot?.selectionTool ?? 'rectangle',
      };
    });
  const wanted = TOOL_STATES[tool];
  // Until the plot has its tool strip (Task 2.9), the control bar's Select toggle turns
  // selection on and off, and its segmented control picks the shape.
  if ((await readTool()).selectionMode !== wanted.selectionMode) {
    await viewBar(page).getByRole('button', { name: 'Select', exact: true }).click();
  }
  if (wanted.selectionMode) {
    const shape = tool === 'Box select' ? 'Rectangle selection' : 'Lasso selection';
    await viewBar(page).getByRole('button', { name: shape, exact: true }).click();
  }
  await expect
    .poll(async () => {
      const state = await readTool();
      return wanted.selectionMode ? state : { selectionMode: state.selectionMode };
    })
    .toEqual(wanted);
}

async function isIsolated(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (Element & { isIsolationMode?: () => boolean })
      | null;
    return plot?.isIsolationMode?.() ?? false;
  });
}

/** Clears the selection with Clear and waits until the plot holds none; a no-op with none. */
export async function clearSelection(page: Page): Promise<void> {
  if ((await getSelectedProteinIds(page)).length === 0) return;
  await selectionAction(page, 'Clear').click();
  await expect.poll(() => getSelectedProteinIds(page)).toEqual([]);
}

/** Isolates the selected proteins with Isolate and waits until the plot is isolated. */
export async function isolateSelection(page: Page): Promise<void> {
  await selectionAction(page, 'Isolate').click();
  await expect.poll(() => isIsolated(page)).toBe(true);
}

/** Leaves isolation with Reset and waits until the plot shows the full dataset again. */
export async function resetIsolation(page: Page): Promise<void> {
  await selectionAction(page, 'Reset').click();
  await expect.poll(() => isIsolated(page)).toBe(false);
}
```

- [ ] **Step 4: Run the contract spec**

Run (sandbox disabled): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers`
Expected: PASS, 9 tests.

- [ ] **Step 5: Move the perf scenarios and the opt-in specs onto the helpers**

In `apps/web/tests/helpers/perf/scenarios.ts`, replace the import of `'../explore'`:

```ts
import {
  dismissTourIfPresent,
  selectAnnotation,
  selectProjection,
  waitForExploreDataLoad,
} from '../explore';
```

with:

```ts
import {
  dismissTourIfPresent,
  importMenu,
  openImportMenu,
  searchInput,
  selectAnnotation,
  selectProjection,
  waitForExploreDataLoad,
} from '../explore';
```

replace the first lines of `importBundle`:

```ts
export async function importBundle(page: Page, file: string): Promise<void> {
  const ownDataset = page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]');
  if (!(await ownDataset.isVisible().catch(() => false))) {
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
  }
```

with:

```ts
export async function importBundle(page: Page, file: string): Promise<void> {
  await openImportMenu(page);
  const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
```

(the rest of `importBundle`, including its last line that presses Escape while `ownDataset` is visible, stays), and in the `search-select` segment replace both

```ts
        const input = page.locator(
          'protspace-control-bar protspace-protein-search #protein-search-input',
        );
```

with:

```ts
        const input = searchInput(page);
```

In `apps/web/tests/perf-scale.spec.ts`, add after the `import { tourCompletedStorageState } …` line:

```ts
import { chooseTool, clearSelection, openImportMenu } from './helpers/explore';
```

In `coldLoad`, replace

```ts
  await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
```

with:

```ts
  await openImportMenu(page);
```

Replace the local helper

```ts
async function clearSelection(page: Page): Promise<void> {
  const clear = page.locator('protspace-control-bar .right-controls-clear');
  if (await clear.isEnabled()) await clear.click();
  // Selecting a protein opens its structure viewer; clearing leaves it open.
  const viewer = page.locator('#myStructureViewer');
  if (await viewer.isVisible()) await viewer.locator('.close-button').click();
}
```

with:

```ts
async function clearSelectionAndViewer(page: Page): Promise<void> {
  await clearSelection(page);
  // Selecting a protein opens its structure viewer; clearing leaves it open.
  const viewer = page.locator('#myStructureViewer');
  if (await viewer.isVisible()) await viewer.locator('.close-button').click();
}
```

and its two callers `await clearSelection(page);` (in the `click-select` and `lasso` resets) with `await clearSelectionAndViewer(page);`. In the `lasso` interaction, replace

```ts
      before: async () => {
        await plot.evaluate((p: PlotHost) => {
          p.selectionTool = 'lasso';
        });
        await page.locator('protspace-control-bar .right-controls-select').click();
      },
```

with:

```ts
      before: async () => {
        await chooseTool(page, 'Lasso select');
      },
```

and in its `reset`, replace

```ts
        await clearSelectionAndViewer(page);
        await page.locator('protspace-control-bar .right-controls-select').click();
```

with:

```ts
        await clearSelectionAndViewer(page);
        await chooseTool(page, 'Move and zoom');
```

In `apps/web/tests/load-large-bundle.spec.ts`, add `openImportMenu` to the import from `'./helpers/explore'`, replace

```ts
    // Open the import menu and set the file via the file input inside the data loader.
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
    await expect(
      page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]'),
    ).toBeVisible();
```

with:

```ts
    // Open the import menu and set the file via the file input inside the data loader.
    await openImportMenu(page);
```

and, in the label-atlas test, replace

```ts
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
```

with:

```ts
    await openImportMenu(page);
```

In `apps/web/tests/examples-live.spec.ts`, replace `getControlBarView,` in the import from `'./helpers/explore'` with `getViewState,`, and the line `await expect.poll(() => getControlBarView(page)).toEqual(curatedViewOf(entry));` with:

```ts
      await expect.poll(() => getViewState(page)).toEqual(curatedViewOf(entry));
```

In `apps/web/tests/figure-editor.spec.ts`, replace the import line `import { waitForExploreDataLoad, dismissTourIfPresent } from './helpers/explore';` with:

```ts
import { dismissTourIfPresent, exportMenu, waitForExploreDataLoad } from './helpers/explore';
```

and the start of `openFigureEditor`:

```ts
  // Trigger the open-publish-editor event directly — the same handler the
  // Export → Figure Editor button click goes through. Skips the dropdown
  // animation and possible viewport-clipping headaches.
  await page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    cb?.dispatchEvent(new CustomEvent('open-publish-editor', { bubbles: true, composed: true }));
  });
```

with:

```ts
  // Dispatch open-publish-editor from the Export menu directly — the same handler the
  // Export → Figure Editor button click goes through. Skips the dropdown
  // animation and possible viewport-clipping headaches.
  await exportMenu(page).evaluate((menu) =>
    menu.dispatchEvent(new CustomEvent('open-publish-editor', { bubbles: true, composed: true })),
  );
```

- [ ] **Step 6: Move the import, isolation and tooltip specs onto the helpers**

In `apps/web/tests/dataset-reload.spec.ts`, replace the import from `'./helpers/explore'` with:

```ts
import {
  clickLegendItem,
  dismissTourIfPresent,
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  importTrigger,
  importUserFile,
  isLegendItemHidden,
  openExplore,
  openImportMenu,
  pickExample,
  waitForExploreDataLoad,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
```

delete the two local helpers `loadDemoDatasetFromImportMenu` and `isImportChevronVisible` (from `async function loadDemoDatasetFromImportMenu(page: Page): Promise<void> {` through the closing `}` of `isImportChevronVisible`, the line before `async function dispatchCustomEvent(`), replace `await loadDemoDatasetFromImportMenu(page);` (in "reset to demo clears the persisted custom dataset") with:

```ts
    await pickExample(page, 'demo');
```

and replace the body of "compact layout still shows the import dropdown affordance":

```ts
    await page.setViewportSize({ width: 568, height: 527 });
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    expect(await isImportChevronVisible(page)).toBe(true);
```

with:

```ts
    await page.setViewportSize({ width: 568, height: 527 });
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);

    // Import still reads as a menu at this width, not as an immediate action.
    await expect(importTrigger(page)).toBeVisible();
    await expect(importTrigger(page)).toHaveAttribute('aria-haspopup', 'menu');
```

The three `dispatchCustomEvent(page, '#myControlBar', …)` calls stay until Tasks 2.5 and 2.9 retarget them.

In `apps/web/tests/isolation-dataset-swap.spec.ts`, replace everything from the first line through the closing `}` of `resetButton` (the line before `test.describe('Dataset swap clears isolation state (#222)'`) with:

```ts
import { test, expect, type Page } from '@playwright/test';
import {
  getProteinCount,
  importMenu,
  importUserFile,
  openExplore,
  selectionAction,
  waitForExploreInteractionReady,
  waitForProteinCount,
} from './helpers/explore';
import { TOXPROT_5181_FIXTURE } from './helpers/fixtures';

/**
 * Regression test for issue #222: the Reset button must clear when the dataset is swapped while
 * isolation is active. The bug was that scatter-plot.clearIsolationState() silently flipped its
 * internal flag without dispatching `data-isolation-reset`, leaving the selection controls' mirror
 * stuck on isolated and the Reset button rendered after the dataset actually reset.
 */

const CUSTOM_5K_BUNDLE_PATH = TOXPROT_5181_FIXTURE;
const CUSTOM_5K_PROTEIN_COUNT = 5181;

/**
 * Drive the dataset-load pipelines directly instead of through the Import menu UI.
 *
 * Both menu actions just delegate: "Load your dataset" opens the hidden file input
 * inside <protspace-data-loader> (`importUserFile` sets it), and choosing an example
 * dispatches the `load-example-dataset` event upward from the Import menu. Driving
 * those entry points directly avoids click-on-shadow-DOM flakiness in headless mode
 * while still hitting exactly the same production code path
 * (data-renderer.applyPlotState → scatterplot.clearIsolationState()), which is what
 * this regression test cares about.
 */
async function loadDemoDataset(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  await importMenu(page).evaluate((menu) => {
    menu.dispatchEvent(
      new CustomEvent('load-example-dataset', {
        detail: { id: 'demo' },
        bubbles: true,
        composed: true,
      }),
    );
  });
}

/** Engage isolation deterministically: take the first N plot points as the selection
 * and call the same public method the Isolate button calls. Avoids fragile drag
 * gestures over a WebGL canvas while still exercising the real isolation pipeline. */
async function engageIsolation(page: Page, sampleSize = 100): Promise<void> {
  await page.evaluate((n) => {
    const sp = document.querySelector('protspace-scatterplot') as unknown as
      | (HTMLElement & {
          // _plotData is a columnar PlotData ({ length, proteinIds, originalIndices, ... }),
          // not an array of point objects.
          _plotData?: {
            length: number;
            proteinIds: string[];
            originalIndices: ArrayLike<number> | null;
          };
          selectedProteinIds: string[];
          isolateSelection(): void;
        })
      | null;
    if (!sp) throw new Error('scatterplot element not found');
    const pd = sp._plotData;
    const len = Math.min(n, pd?.length ?? 0);
    const ids: string[] = [];
    for (let slot = 0; slot < len; slot += 1) {
      const originalIndex = pd!.originalIndices ? pd!.originalIndices[slot] : slot;
      ids.push(pd!.proteinIds[originalIndex]);
    }
    if (ids.length === 0) throw new Error('no plot data points available to isolate');
    sp.selectedProteinIds = ids;
    sp.isolateSelection();
  }, sampleSize);
}

/** The plot's own isolation flag; the Reset button shows the controls' mirror of it. */
async function readIsolationMode(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const plot = document.querySelector('#myPlot') as
      | (HTMLElement & { isIsolationMode?: () => boolean })
      | null;
    return Boolean(plot?.isIsolationMode?.());
  });
}

function resetButton(page: Page) {
  return selectionAction(page, 'Reset');
}
```

Then rename the four calls: `perl -pi -e 's/\breadControlBarIsolationMode\(/readIsolationMode(/g' apps/web/tests/isolation-dataset-swap.spec.ts`.

Replace the whole of `apps/web/tests/multi-annotation-tooltip.spec.ts` with:

```ts
import { expect, test, type Page } from '@playwright/test';
import {
  annotationSelect,
  colorByTrigger,
  dismissTourIfPresent,
  getColorByOptions,
  getViewState,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
} from './helpers/explore';

async function openAnnotationDropdown(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  await colorByTrigger(page).click();
}

async function getRowForAnnotation(page: Page, annotation: string) {
  // Dropdown items show the friendly display label (e.g. "EC number") but carry
  // the raw annotation key on data-annotation; match by key so this stays
  // label-agnostic.
  return annotationSelect(page).locator(`.dropdown-item[data-annotation="${annotation}"]`);
}

test.describe('Multi-annotation hover tooltip', () => {
  test('marks the primary annotation with a dot and hides its (i) toggle', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    const primaryRow = await getRowForAnnotation(page, 'ec');
    await expect(primaryRow.locator('.primary-dot')).toHaveCount(1);
    await expect(primaryRow.locator('.tooltip-toggle-btn')).toHaveCount(0);
  });

  test('toggling the (i) icon adds the annotation to the URL tooltip param', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);

    const annotations = await getColorByOptions(page);
    const otherAnnotation = annotations.find((name) => name !== 'ec');
    if (!otherAnnotation) {
      test.skip(true, 'demo dataset has only a single annotation');
      return;
    }

    const otherRow = await getRowForAnnotation(page, otherAnnotation);
    await otherRow.locator('.tooltip-toggle-btn').click();

    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));

    // The picker lists the extra, and the plot draws it into the tooltip.
    const tooltipState = {
      picker: await annotationSelect(page).evaluate((select) => [
        ...((select as Element & { tooltipAnnotations?: string[] }).tooltipAnnotations ?? []),
      ]),
      plot: (await getViewState(page)).tooltip,
    };

    expect(tooltipState.picker).toEqual([otherAnnotation]);
    expect(tooltipState.plot).toEqual([otherAnnotation]);
  });

  test('toggling an extra back off removes the tooltip URL param', async ({ page }) => {
    await page.goto('/explore?annotation=ec');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await openAnnotationDropdown(page);
    const available = await getColorByOptions(page);
    const otherAnnotation = available.find((name) => name !== 'ec');
    if (!otherAnnotation) {
      test.skip(true, 'demo dataset has only a single annotation');
      return;
    }

    const row = await getRowForAnnotation(page, otherAnnotation);
    await row.locator('.tooltip-toggle-btn').click();
    await expect(page).toHaveURL(new RegExp(`tooltip=${otherAnnotation}`));
    await row.locator('.tooltip-toggle-btn').click();

    await expect(page).not.toHaveURL(/tooltip=/);
  });
});
```

- [ ] **Step 7: Move the example-dataset spec onto the helpers**

In `apps/web/tests/example-datasets.spec.ts`, replace the import from `'./helpers/explore'` (the block from `clickLegendItem,` through `waitForProteinCount,`) with:

```ts
import {
  clickLegendItem,
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  expectUrlParam,
  getContoursMode,
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  getUrlParam,
  getViewState,
  holdNextRequest,
  importMenu,
  importUserFile,
  isLegendItemHidden,
  openExplore,
  openImportMenu,
  pickExample,
  selectAnnotation,
  waitForExploreDataLoad,
  waitForPersistedExploreDataset,
  waitForProteinCount,
} from './helpers/explore';
```

Replace the local helpers from `async function getSelectedAnnotation(page: Page): Promise<string | null> {` through the closing `}` of `pickAnnotation` (the line before `/** The error toast for a failed download of \`entry\`, and its Retry button. */`) with:

```ts
async function getSelectedAnnotation(page: Page): Promise<string | null> {
  return (await getViewState(page)).annotation;
}

/** Opens the menu, reads whether `id`'s item is disabled, and leaves the menu open. */
async function isExampleDisabled(page: Page, id: string): Promise<boolean> {
  await openImportMenu(page);
  return importMenu(page).locator(`[data-example-id="${id}"]`).isDisabled();
}

async function getSearch(page: Page): Promise<string> {
  return page.evaluate(() => window.location.search);
}
```

Then point the remaining calls at the helpers (`getDensityLayer`, `chooseExampleFromMenu` and `pickAnnotation` had the same arguments and meaning; `pickAnnotation`'s wait on the control bar becomes `selectAnnotation`'s wait on the plot and the legend):

```bash
perl -pi -e 's/\bgetControlBarView\(/getViewState(/g; s/\bchooseExampleFromMenu\(/pickExample(/g; s/\bpickAnnotation\(/selectAnnotation(/g; s/\bgetDensityLayer\(/getContoursMode(/g' apps/web/tests/example-datasets.spec.ts
```

In the test that checks the Examples section's docs link, badge and info controls, replace:

```ts
    const controlBar = page.locator('protspace-control-bar');
    await expect(controlBar.locator('.import-examples-docs')).toHaveAttribute(
      'href',
      EXAMPLES_DOCS_URL,
    );
    await expect(
      controlBar.locator(`[data-example-id="${large.id}"] .import-example-badge`),
    ).toHaveText('Large');
    await expect(controlBar.locator('.import-example-badge')).toHaveCount(
      EXAMPLE_DATASETS.filter((entry) => entry.large).length,
    );

    const info = controlBar.locator(`.import-examples [data-example-info="${other.id}"]`);
```

with:

```ts
    const menu = importMenu(page);
    await expect(menu.locator('.import-examples-docs')).toHaveAttribute('href', EXAMPLES_DOCS_URL);
    await expect(menu.locator(`[data-example-id="${large.id}"] .import-example-badge`)).toHaveText(
      'Large',
    );
    await expect(menu.locator('.import-example-badge')).toHaveCount(
      EXAMPLE_DATASETS.filter((entry) => entry.large).length,
    );

    const info = menu.locator(`.import-examples [data-example-info="${other.id}"]`);
```

and, at the end of the same test:

```ts
    await expect(
      controlBar.locator('.import-current-dataset-row [data-example-info="demo"]'),
    ).toHaveCount(1);
```

with:

```ts
    await expect(menu.locator('.import-current-dataset-row [data-example-info="demo"]')).toHaveCount(
      1,
    );
```

Run: `grep -n "protspace-control-bar\|controlBar\|getControlBarView\|chooseExampleFromMenu\|pickAnnotation\|getDensityLayer" apps/web/tests/example-datasets.spec.ts`
Expected: no output.

- [ ] **Step 8: Move the EAT, numeric-binning, URL and tour specs onto the helpers**

`apps/web/tests/eat-visualization.spec.ts`:

1. Replace `import { dismissTourIfPresent, waitForProteinCount } from './helpers/explore';` with:

```ts
import {
  annotationSelect,
  clearSelection,
  colorByTrigger,
  dismissTourIfPresent,
  exportMenu,
  isolateSelection,
  openExportMenu,
  projectionTrigger,
  resetIsolation,
  searchInput,
  selectAnnotation,
  selectProjection,
  viewBar,
  waitForProteinCount,
} from './helpers/explore';
```

2. Delete the local `selectEcAnnotation` (from `async function selectEcAnnotation(page: Page): Promise<void> {` through its closing `}`), and replace both of its calls `await selectEcAnnotation(page);` with `await selectAnnotation(page, 'ec');`.

3. In "renders and explores EAT transfers…", delete the line `const controlBar = page.locator('protspace-control-bar');`, and replace

```ts
  const filterButton = controlBar.locator('.filter-container .dropdown-trigger');
```

with:

```ts
  // The plot's filter channel, which the Filter button's badge reflects.
  const plotFiltersActive = () =>
    page.evaluate(
      () =>
        (document.querySelector('#myPlot') as (Element & { filtersActive?: boolean }) | null)
          ?.filtersActive ?? false,
    );
```

Then replace both lines `await expect(filterButton).not.toHaveClass(/filter-active/);` with `await expect.poll(plotFiltersActive).toBe(false);`, and the line `await expect(filterButton).toHaveClass(/filter-active/);` with `await expect.poll(plotFiltersActive).toBe(true);`.

4. Replace

```ts
  const annotationSelect = controlBar.locator('protspace-annotation-select');
  await annotationSelect.locator('.dropdown-trigger').click();
  const ecRow = annotationSelect.locator('.dropdown-item[data-annotation="ec"]');
  await expect(ecRow.locator('.eat-badge')).toHaveText('EAT');
  const ordinaryRow = annotationSelect
    .locator('.dropdown-item:not(:has(.eat-badge))')
    .filter({ hasNot: annotationSelect.locator('.annotation-section-header') })
    .first();
  await ordinaryRow.click();
  await expect(eatGroup).toBeHidden();
  await annotationSelect.locator('.dropdown-trigger').click();
  await annotationSelect.locator('.dropdown-item[data-annotation="ec"]').click();
```

with:

```ts
  const colorBy = annotationSelect(page);
  await colorByTrigger(page).click();
  const ecRow = colorBy.locator('.dropdown-item[data-annotation="ec"]');
  await expect(ecRow.locator('.eat-badge')).toHaveText('EAT');
  const ordinaryRow = colorBy
    .locator('.dropdown-item:not(:has(.eat-badge))')
    .filter({ hasNot: colorBy.locator('.annotation-section-header') })
    .first();
  await ordinaryRow.click();
  await expect(eatGroup).toBeHidden();
  await colorByTrigger(page).click();
  await colorBy.locator('.dropdown-item[data-annotation="ec"]').click();
```

5. Replace

```ts
  const proteinSearch = controlBar.locator('protspace-protein-search');
  await proteinSearch.locator('#protein-search-input').fill('A0JMF6');
  await proteinSearch.locator('#protein-search-input').press('Enter');
  await controlBar.getByRole('button', { name: 'Isolate' }).click();
```

with:

```ts
  await searchInput(page).fill('A0JMF6');
  await searchInput(page).press('Enter');
  await isolateSelection(page);
```

and `await controlBar.getByRole('button', { name: 'Reset' }).click();` with `await resetIsolation(page);`.

6. Replace

```ts
  await controlBar.getByRole('button', { name: 'Projection:' }).click();
  await controlBar.locator('.projection-container .dropdown-item').nth(1).click();
```

with:

```ts
  await selectProjection(page, 1);
```

7. Replace

```ts
  await controlBar.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(controlBar.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
```

with:

```ts
  await clearSelection(page);
```

8. Replace the 601 px block, from `await page.setViewportSize({ width: 601, height: 844 });` through `expect(compactControlBar.eatControlCount).toBe(0);`, with:

```ts
  // At 601 px the Projection and Color by pickers still sit side by side on screen, and the EAT
  // reliability controls stay in the legend, not in the view bar.
  await page.setViewportSize({ width: 601, height: 844 });
  const projectionBox = await projectionTrigger(page).boundingBox();
  const colorByBox = await colorByTrigger(page).boundingBox();
  expect(projectionBox).not.toBeNull();
  expect(colorByBox).not.toBeNull();
  expect(projectionBox!.x + projectionBox!.width).toBeLessThanOrEqual(colorByBox!.x);
  expect(projectionBox!.x).toBeGreaterThanOrEqual(0);
  expect(colorByBox!.x + colorByBox!.width).toBeLessThanOrEqual(601);
  await expect(
    viewBar(page).getByRole('slider', { name: 'EAT reliability filter threshold' }),
  ).toHaveCount(0);
```

9. Replace

```ts
  await controlBar.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await controlBar.getByRole('button', { name: 'Quick Export PNG' }).click();
```

with:

```ts
  await openExportMenu(page);
  const downloadPromise = page.waitForEvent('download');
  await exportMenu(page).getByRole('button', { name: 'Quick Export PNG' }).click();
```

Run: `grep -n "controlBar\|protspace-control-bar" apps/web/tests/eat-visualization.spec.ts`
Expected: no output.

`apps/web/tests/numeric-binning.spec.ts`:

1. Replace `import { dismissTourIfPresent, selectAnnotation, waitForExploreDataLoad } from './helpers/explore';` with:

```ts
import {
  dismissTourIfPresent,
  filterDialog,
  getColorByOptions,
  openFilter,
  queryBuilder,
  selectAnnotation,
  waitForExploreDataLoad,
} from './helpers/explore';
```

2. Replace `waitForAnnotationAvailable` with:

```ts
async function waitForAnnotationAvailable(page: Page, annotation: string): Promise<void> {
  await page.waitForFunction((nextAnnotation) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: { annotations?: Record<string, unknown> };
          getCurrentData?: () => { annotations?: Record<string, unknown> };
        })
      | null;

    return (
      Boolean(plot?.data?.annotations?.[nextAnnotation]) ||
      Boolean(plot?.getCurrentData?.()?.annotations?.[nextAnnotation])
    );
  }, annotation);
  // And Color by offers it.
  await expect.poll(() => getColorByOptions(page)).toContain(annotation);
}
```

3. Replace the comment block and `openQueryBuilder`, from `// The control-bar Filter button opens the query builder (role="dialog"` through the closing `}` of `openQueryBuilder`, with:

```ts
// The Filter button opens the query builder in the filter dialog. A condition row picks an
// annotation and one or more of its values; "Apply & Isolate" isolates the scatter-plot to the
// matched proteins (observed via getCurrentData()), and "Reset All" clears isolation.
// Numeric bins are listed in the value picker by their internal id
// (e.g. "num:quantile:10:20.5"); these helpers map friendly bin labels (as the
// legend shows them) to those internal ids via numericMetadata.bins.
```

and replace every `await openQueryBuilder(page);` (three lines) with `await openFilter(page);`.

4. Replace `topRowAnnotations` with:

```ts
async function topRowAnnotations(page: Page): Promise<string[]> {
  return queryBuilder(page).evaluate((qb) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    return rows.map(
      (r) =>
        (r as HTMLElement & { condition?: { annotation: string } }).condition?.annotation ?? '',
    );
  });
}
```

5. In `ensureCondition`, replace

```ts
    await page
      .locator('protspace-query-builder')
      .getByRole('button', { name: '+ Add condition' })
      .click();
```

with:

```ts
    await queryBuilder(page).getByRole('button', { name: '+ Add condition' }).click();
```

6. Replace `isValuePickerOpen`, `openValuePicker`, `pickerItemValues`, `chipValues`, `clickPickerValue` and `clearChips` (from `async function isValuePickerOpen(` through the closing `}` of `clearChips`) with:

```ts
async function isValuePickerOpen(page: Page, rowIndex: number): Promise<boolean> {
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | undefined;
    return Boolean(picker?.shadowRoot?.querySelector('.value-picker'));
  }, rowIndex);
}

async function openValuePicker(page: Page, rowIndex: number): Promise<void> {
  if (await isValuePickerOpen(page, rowIndex)) {
    return;
  }
  await conditionRow(page, rowIndex).locator('.value-chip-add').click();
  await expect.poll(async () => isValuePickerOpen(page, rowIndex)).toBe(true);
  // The value list renders synchronously, but wait until at least one item or an
  // existing chip is present so callers can read/select reliably.
  await expect
    .poll(() =>
      queryBuilder(page).evaluate((qb, idx) => {
        const conds = qb.shadowRoot?.querySelector('.query-conditions');
        const rows = Array.from(conds?.children ?? []).filter(
          (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
        );
        const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
        const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
          | (HTMLElement & { shadowRoot: ShadowRoot })
          | undefined;
        const items = picker?.shadowRoot?.querySelectorAll('.value-picker-item').length ?? 0;
        const chips = row?.shadowRoot?.querySelectorAll('.value-chip-text').length ?? 0;
        return items + chips > 0;
      }, rowIndex),
    )
    .toBe(true);
}

/** Read the internal value labels currently listed in the open value picker. */
async function pickerItemValues(page: Page, rowIndex: number): Promise<string[]> {
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | undefined;
    return Array.from(picker?.shadowRoot?.querySelectorAll('.value-picker-item') ?? []).map(
      (it) =>
        (
          it.querySelector('span:not(.value-picker-count)') as HTMLElement | null
        )?.textContent?.trim() ?? '',
    );
  }, rowIndex);
}

/** Read the internal value labels currently selected as chips on the row. */
async function chipValues(page: Page, rowIndex: number): Promise<string[]> {
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    return Array.from(row?.shadowRoot?.querySelectorAll('.value-chip-text') ?? []).map(
      (c) => (c as HTMLElement).textContent?.trim() ?? '',
    );
  }, rowIndex);
}

/** Click a value (by internal id) in the open value picker. Returns false if absent. */
async function clickPickerValue(
  page: Page,
  rowIndex: number,
  internalValue: string,
): Promise<boolean> {
  return queryBuilder(page).evaluate(
    (qb, { idx, val }) => {
      const conds = qb.shadowRoot?.querySelector('.query-conditions');
      const rows = Array.from(conds?.children ?? []).filter(
        (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
      );
      const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
      const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | undefined;
      const items = Array.from(picker?.shadowRoot?.querySelectorAll('.value-picker-item') ?? []);
      const target = items.find(
        (it) =>
          (
            it.querySelector('span:not(.value-picker-count)') as HTMLElement | null
          )?.textContent?.trim() === val,
      ) as HTMLElement | undefined;
      if (!target) return false;
      target.click();
      return true;
    },
    { idx: rowIndex, val: internalValue },
  );
}

/** Remove every selected value chip from a condition row. */
async function clearChips(page: Page, rowIndex: number): Promise<void> {
  // Removing a chip dispatches condition-changed up through the query builder and
  // back down, so the chip DOM only updates after an async Lit re-render. Wait
  // for the chip count to actually drop before the next click so we never
  // re-click a stale/detached button, and cap the loop so a removal regression
  // fails fast (a clear poll timeout) instead of spinning until the test timeout.
  let remaining = (await chipValues(page, rowIndex)).length;
  for (let guard = remaining + 5; guard > 0 && remaining > 0; guard -= 1) {
    const removed = await queryBuilder(page).evaluate((qb, idx) => {
      const conds = qb.shadowRoot?.querySelector('.query-conditions');
      const rows = Array.from(conds?.children ?? []).filter(
        (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
      );
      const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
      const btn = row?.shadowRoot?.querySelector('.value-chip-remove') as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    }, rowIndex);
    if (!removed) break;
    const before = remaining;
    await expect.poll(async () => (await chipValues(page, rowIndex)).length).toBeLessThan(before);
    remaining = (await chipValues(page, rowIndex)).length;
  }
  await expect.poll(async () => (await chipValues(page, rowIndex)).length).toBe(0);
}
```

7. Replace `const matchCount = page.locator('protspace-query-builder .match-count');` (in `closeOpenPickers`) with `const matchCount = queryBuilder(page).locator('.match-count');`, `await page.locator('protspace-query-builder .query-footer-reset').click();` (in `disableFilter`) with `await queryBuilder(page).locator('.query-footer-reset').click();`, and in `applyFiltersFromMenu` replace

```ts
  const apply = page.locator('protspace-query-builder .btn-primary');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole('dialog', FILTER_DIALOG)).toBeHidden();
```

with:

```ts
  const apply = queryBuilder(page).locator('.btn-primary');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(filterDialog(page)).toBeHidden();
```

8. In the zero-match test, replace from `await expect` (the poll right after the first `await openFilter(page);` of that test) through

```ts
  await page
    .getByRole('dialog', { name: 'Filter Query Builder' })
    .getByRole('button', { name: 'Cancel' })
    .click();
```

with:

```ts
  await expect
    .poll(async () => ((await queryBuilder(page).locator('.match-count').textContent()) ?? '').trim())
    // Anchor to the start: the count renders as "<n> of <total> proteins
    // matched", so a bare .toContain('0 of') would also match "10 of", "20 of",
    // etc. Require the matched count itself to be exactly 0.
    .toMatch(/^0 of /);
  await expect(queryBuilder(page).locator('.btn-primary')).toBeDisabled();
  expect(await isolatedCount(page)).toBe(fullCount);

  // Cancel is the builder's own button, so it is found inside the builder wherever the dialog is.
  await queryBuilder(page).getByRole('button', { name: 'Cancel' }).click();
```

9. In "loading a new dataset clears active filters…", replace

```ts
  expect(
    await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as unknown as
        | (Element & { filterActive?: boolean })
        | null;
      return cb?.filterActive ?? false;
    }),
  ).toBe(true);
```

with:

```ts
  expect(
    await page.evaluate(() => {
      const plot = document.querySelector('protspace-scatterplot') as unknown as
        | (Element & { filtersActive?: boolean })
        | null;
      return plot?.filtersActive ?? false;
    }),
  ).toBe(true);
```

and in its `replacementState` evaluate, replace

```ts
    const cb = document.querySelector('protspace-control-bar') as unknown as
      | (Element & { filterActive?: boolean })
      | null;
    return {
      filterActive: cb?.filterActive ?? false,
```

with:

```ts
    return {
      filterActive: (plot as (Element & { filtersActive?: boolean }) | null)?.filtersActive ?? false,
```

Run: `grep -n "protspace-control-bar\|FILTER_DIALOG\|openQueryBuilder\|Filter Query Builder\|cb?" apps/web/tests/numeric-binning.spec.ts`
Expected: no output.

`apps/web/tests/url-view-state.spec.ts`:

1. Add `getColorByOptions`, `getContoursMode`, `getViewState`, `projectionTrigger` and `setContours` to the import from `'./helpers/explore'` (keeping its alphabetical order).

2. Replace `getCurrentView` and `waitForView` (from `async function getCurrentView(page: Page) {` through the closing `}` of `waitForView`) with:

```ts
/** The plot's view, the annotations Color by offers and the projections the data holds. */
async function getCurrentView(page: Page) {
  const [view, annotations, projections] = await Promise.all([
    getViewState(page),
    getColorByOptions(page),
    page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { data?: { projections?: Array<{ name: string }> } | null })
        | null;
      return plot?.data?.projections?.map((projection) => projection.name) ?? [];
    }),
  ]);
  return { annotation: view.annotation, projection: view.projection, annotations, projections };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function waitForView(
  page: Page,
  expected: { annotation?: string; projection?: string },
  timeout = 30_000,
): Promise<void> {
  if (expected.annotation) {
    await expect
      .poll(async () => (await getCurrentView(page)).annotation, { timeout })
      .toBe(expected.annotation);
  }

  if (expected.projection) {
    await expect
      .poll(async () => (await getCurrentView(page)).projection, { timeout })
      .toBe(expected.projection);
  }

  // Note: we don't assert the annotation trigger's rendered text. It shows the
  // friendly display label (e.g. "EC number"), not the raw key the URL and the
  // selectedAnnotation property use; the property poll above already verifies the
  // selected annotation by key, and deriving the label here would couple the test
  // to @protspace/utils' annotation-metadata map (which doesn't import cleanly
  // under Playwright's ESM loader).
  if (expected.projection) {
    // The Projection picker shows the projection's name last.
    await expect(projectionTrigger(page)).toHaveText(
      new RegExp(`${escapeRegExp(expected.projection)}$`),
      { timeout },
    );
  }
}
```

3. In `test.beforeAll`, replace the comment

```ts
    // getCurrentView reads the control-bar's annotations/projections, which the
    // app wires separately from the scatter-plot data and can lag the
    // plot-data-ready signal under parallel load. Poll until both expose at
```

with:

```ts
    // getCurrentView reads Color by's options, which the app wires separately
    // from the scatter-plot data and can lag the plot-data-ready signal under
    // parallel load. Poll until both it and the projections expose at
```

4. In "deep links render the requested view directly without an initial default swap", replace the whole `await page.addInitScript(() => { … });` call (from `await page.addInitScript(() => {` through its closing `});`, the line before `await openExplore(`) with:

```ts
    await page.addInitScript(() => {
      const win = window as Window & {
        __pickerAnnotationAssignments?: string[];
        __pickerProjectionAssignments?: string[];
      };
      // The elements that show the view, and the view property each one shows. The control bar
      // shows both until the view bar's pickers replace it (Tasks 2.8 and 2.10); a tag that is
      // not defined is simply never patched.
      const recorded: Record<string, Array<'selectedAnnotation' | 'selectedProjection'>> = {
        'protspace-control-bar': ['selectedAnnotation', 'selectedProjection'],
        'protspace-annotation-select': ['selectedAnnotation'],
        'protspace-projection-select': ['selectedProjection'],
      };
      const patched = new WeakSet<object>();
      const originalDefine = customElements.define.bind(customElements);

      customElements.define = (name, constructor, options) => {
        const proto = constructor.prototype as object;

        if (name === 'protspace-scatterplot' && !patched.has(proto)) {
          patched.add(proto);
          const dataDescriptor = Object.getOwnPropertyDescriptor(proto, 'data');
          if (dataDescriptor?.get && dataDescriptor?.set) {
            Object.defineProperty(proto, 'data', {
              configurable: true,
              enumerable: dataDescriptor.enumerable ?? true,
              get: dataDescriptor.get,
              set(value) {
                win.__pickerAnnotationAssignments = [];
                win.__pickerProjectionAssignments = [];
                return dataDescriptor.set.call(this, value);
              },
            });
          }
        }

        const keys = recorded[name] ?? [];
        if (keys.length > 0 && !patched.has(proto)) {
          patched.add(proto);
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, key);
            if (!descriptor?.get || !descriptor?.set) continue;
            const list =
              key === 'selectedAnnotation'
                ? '__pickerAnnotationAssignments'
                : '__pickerProjectionAssignments';
            Object.defineProperty(proto, key, {
              configurable: true,
              enumerable: descriptor.enumerable ?? true,
              get: descriptor.get,
              set(value) {
                if (typeof value === 'string') (win[list] ??= []).push(value);
                return descriptor.set.call(this, value);
              },
            });
          }
        }

        return originalDefine(name, constructor, options);
      };
    });
```

and in the same test replace

```ts
    const assignments = await page.evaluate(() => {
      const win = window as Window & {
        __controlBarAnnotationAssignments?: string[];
        __controlBarProjectionAssignments?: string[];
      };

      return {
        annotations: win.__controlBarAnnotationAssignments ?? [],
        projections: win.__controlBarProjectionAssignments ?? [],
      };
    });
```

with:

```ts
    const assignments = await page.evaluate(() => {
      const win = window as Window & {
        __pickerAnnotationAssignments?: string[];
        __pickerProjectionAssignments?: string[];
      };

      return {
        annotations: win.__pickerAnnotationAssignments ?? [],
        projections: win.__pickerProjectionAssignments ?? [],
      };
    });
```

5. In "applies ?density= and keeps it across an annotation change", replace

```ts
    const bar = page.locator('protspace-control-bar');
    const densityTrigger = bar.locator('#density-layer-trigger');
    await expect(densityTrigger).toHaveAttribute('aria-label', 'Contours: Always');

    await densityTrigger.click();
    await bar.locator('.density-item[data-mode="auto"]').click();
    await expectUrlParam(page, 'density', 'auto');
```

with:

```ts
    await expect.poll(() => getContoursMode(page)).toBe('on');

    await setContours(page, 'auto');
    await expectUrlParam(page, 'density', 'auto');
```

and its last line `await expect(densityTrigger).toHaveAttribute('aria-label', 'Contours: Auto');` with:

```ts
    await expect.poll(() => getContoursMode(page)).toBe('auto');
```

Run: `grep -n "protspace-control-bar\|controlBar\|density-layer-trigger\|__controlBar" apps/web/tests/url-view-state.spec.ts`
Expected: one line, the trap entry `'protspace-control-bar': ['selectedAnnotation', 'selectedProjection'],` (keep it: the deep-link test records nothing without it until Task 2.8; Task 2.10 removes it).

`apps/web/tests/product-tour.spec.ts`: replace the block from

```ts
/**
 * Describes where the highlighted element lives for each step.
```

through the closing `];` of `STEP_TARGETS` with:

```ts
/**
 * Where the highlighted element lives for each step: `null` for a centred popover with no element
 * highlighted, otherwise the element's `data-driver-id`. The check finds it through shadow roots,
 * so a step passes before and after its control moves out of the control bar.
 */
type StepTarget = null | { driverId: string };

const STEP_TARGETS: StepTarget[] = [
  null, // Welcome
  { driverId: 'import' }, // Import
  { driverId: 'projections' }, // Projections & Annotations
  { driverId: 'search' }, // Search
  { driverId: 'selection' }, // Select & Isolate
  { driverId: 'data-actions' }, // Filter & Export
  { driverId: 'scatterplot' }, // Scatterplot
  { driverId: 'legend' }, // Legend
  { driverId: 'other-row' }, // Expand Hidden Categories
  null, // You're All Set!
];
```

and replace `assertHighlightedElement` (from its doc comment `/**` line `* Assert that the correct element is highlighted for the given step target.` through its closing `}`) with:

```ts
/**
 * Assert that the correct element is highlighted for the given step target. Playwright's CSS
 * locators pierce shadow roots, so one locator finds the target in a bar's light DOM or inside a
 * host's shadow root.
 */
async function assertHighlightedElement(page: Page, target: StepTarget): Promise<void> {
  if (target === null) {
    // Centred popover – no real element should be highlighted.
    // driver.js creates an invisible `#driver-dummy-element` for centred steps,
    // so we exclude it and verify no other element is active.
    const count = await page.locator('.driver-active-element:not(#driver-dummy-element)').count();
    expect(count).toBe(0);
    return;
  }

  await expect(page.locator(`[data-driver-id="${target.driverId}"]`)).toHaveClass(
    /(^|\s)driver-active-element(\s|$)/,
  );
}
```

- [ ] **Step 9: Check that no spec names the control bar any more**

Run: `grep -rn "protspace-control-bar\|myControlBar\|right-controls" apps/web/tests --include="*.spec.ts"`
Expected: exactly four lines: the three `dispatchCustomEvent(page, '#myControlBar', …)` calls in `apps/web/tests/dataset-reload.spec.ts` (for `selection-disabled-notification` and the two `export` events) and the trap entry `'protspace-control-bar': ['selectedAnnotation', 'selectedProjection'],` in `apps/web/tests/url-view-state.spec.ts`.

Run: `pnpm --filter @protspace/app type-check 2>&1 | tail -3 && pnpm knip`
Expected: no type errors (the specs, the helpers and the perf scenarios type-check through `tsconfig.e2e.json`); knip reports nothing: every helper exported from `helpers/explore.ts` is imported by a spec (`appBar`, `plotArea`, `sidebar`, `ViewState`, `filterButton`, `getSelectedProteinIds` by `workbench-helpers.spec.ts`).

- [ ] **Step 10: Run the migrated specs, the full suite and the perf counts**

Run (sandbox disabled): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers dataset-reload eat-visualization example-datasets figure-editor isolation-dataset-swap multi-annotation-tooltip numeric-binning url-view-state product-tour`
Expected: PASS, every test (the counts each spec had before this task, plus the 9 contract tests). `examples-live`, `load-large-bundle` and `perf-scale` are opt-in and only type-checked here.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e 2>&1 | tail -6`
Expected: the full suite passes.

Run (sandbox disabled): `pnpm perf:counts 2>&1 | tail -6`
Expected: every segment within budget; `import` and `search-select` now reach the Import menu and the search box through the helpers and count the same work.

Run: `pnpm exec prettier --check apps/web/tests`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not).

- [ ] **Step 11: Commit**

```bash
git add apps/web/tests/helpers/explore.ts apps/web/tests/helpers/perf/scenarios.ts \
  apps/web/tests/workbench-helpers.spec.ts apps/web/tests/dataset-reload.spec.ts \
  apps/web/tests/eat-visualization.spec.ts apps/web/tests/example-datasets.spec.ts \
  apps/web/tests/examples-live.spec.ts apps/web/tests/figure-editor.spec.ts \
  apps/web/tests/isolation-dataset-swap.spec.ts apps/web/tests/load-large-bundle.spec.ts \
  apps/web/tests/multi-annotation-tooltip.spec.ts apps/web/tests/numeric-binning.spec.ts \
  apps/web/tests/perf-scale.spec.ts apps/web/tests/product-tour.spec.ts \
  apps/web/tests/url-view-state.spec.ts
git commit -m "test(web): reach explore controls through layout-free helpers"
```

---

### Task 2.4: Help menu replaces the plot's tips

The app bar gets a help menu (decisions 1 and 15): Documentation, Keyboard shortcuts and Take the tour. It replaces `protspace-tips` and the scatterplot's `show-tour-button`, which clears the plot's top-left corner for the tool strip (Task 2.9). The shortcuts dialog lists what the page does today from one data module that phase 4 extends.

**Files:**

- Create: `apps/web/src/workbench/HelpMenu.tsx`, `ShortcutsDialog.tsx`, `shortcuts.ts`, `shortcuts.test.ts`
- Modify: `apps/web/src/workbench/AppBar.tsx`, `PlotArea.tsx` (drop `show-tour-button`), `apps/web/src/custom-elements.d.ts`, `apps/web/src/explore/runtime.ts` (`tour-start` listener :439-441), `apps/web/src/tour/product-tour.ts` (`spotlightTipsIcon` :79-96)
- Delete: `packages/core/src/components/scatter-plot/tooltips/protspace-tips.ts`, `protspace-tips.styles.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (:32, :160, :1730-1733), `scatter-plot.styles.ts` (comment :142), `packages/core/src/styles/style-lint.test.ts` (LEGACY line), `packages/core/src/components/kit/icon.ts` (`circle-help`)
- Modify: `docs/developers/api/index.md` (:71, :76)
- Modify: `apps/web/tests/product-tour.spec.ts` (:244-281)
- Create: `apps/web/tests/workbench-help.spec.ts`
- Also modify (same removed API, named here so the docs never describe a removed event): `docs/developers/api/index.md` (:134, the `tour-start` row of the scatterplot's events), `docs/developers/contributing.md` (:83-85, the scatter plot's event list); `apps/web/src/workbench/workbench.css` (the shortcuts list's styles)

**Interfaces:**

- Consumes: the app bar's actions region (Task 2.2); `ps-icon-button`, `ps-menu`, `ps-menu-item` (`ps-select` `{ value, checked }`, `ps-close`), `ps-dialog` (`open`, `heading`, `ps-close`); `startProductTour({ force: true })` (`apps/web/src/tour/product-tour.ts`); `getUrls(mode).docs` (`config/urls.ts`, mode from `import.meta.env.MODE` as `Header.tsx` does); `isMacOrIos` (`@protspace/utils`).
- Produces:
  - `HelpMenu` in the app bar's actions, before Feedback: `ps-icon-button[data-driver-id="help"]`, icon `circle-help`, label "Help", opening a `ps-menu` labelled "Help" with items `value="docs"` "Documentation" (opens the docs URL in a new tab, `noopener,noreferrer`), `value="shortcuts"` "Keyboard shortcuts" (opens the dialog) and `value="tour"` "Take the tour" (starts the tour after the menu closes; the tour module is imported on demand).
  - `ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void })`: a `ps-dialog` headed "Keyboard shortcuts", one titled section per group.
  - `shortcuts.ts`: `interface Shortcut { keys: readonly string[]; action: string }`; `interface ShortcutGroup { title: string; items: readonly Shortcut[] }`; `SHORTCUT_GROUPS: readonly ShortcutGroup[]` with groups Plot, Selection, Search, Legend, Structure viewer and Figure editor, from the shortcuts implemented today (research note R5 §1), the Escape copy corrected ("clear the selection, then leave selection mode") and `I` listed under Legend; `formatKeys(keys: readonly string[], isMac: boolean): string` (`'Mod'` reads ⌘ on Mac and Ctrl elsewhere).
  - Gone: `protspace-tips`, `ProtspaceScatterplot.showTourButton`, the `show-tour-button` attribute, the plot's `tour-start` event and its listener.
  - Tour step 1 spotlights `[data-driver-id="help"]`; the step titles stay.

**Tests:**

- `apps/web/src/workbench/shortcuts.test.ts` (unit): "formats Mod as ⌘ on Mac and Ctrl elsewhere"; "every group has a title and at least one shortcut"; "the legend group lists I"; "Escape reads clear the selection, then leave selection mode".
- `apps/web/tests/workbench-help.spec.ts` (e2e):
  - "Help opens a keyboard-navigable menu and Escape returns focus to Help"
  - "Documentation opens the docs in a new tab"
  - "Keyboard shortcuts opens a dialog listing the search shortcut; Escape closes it and returns focus to Help"
  - "Take the tour starts the tour"
  - "the plot has no tips button"
- `product-tour.spec.ts`: "can be re-triggered from the help menu" replaces "can be re-triggered from tips popover"; the welcome step spotlights Help.

**Commit:** `feat(web): add a help menu with shortcuts and the tour`

Notes for the implementer:

- The docs URL is `DOCS_URL` from `apps/web/src/config.ts`, which is exactly `getUrls(mode).docs` with the mode read as `Header.tsx` reads it. In development and e2e it is the relative `/docs/`, which the Vite proxy forwards to the docs server.
- "Documentation" calls `window.open` synchronously inside the `ps-select` handler, which runs inside the user's click or key press, so the browser allows the new tab. The dialog and the tour wait one task (`setTimeout(…, 0)`) so they start only after the menu has closed and handed focus back to Help: the dialog then records Help as the element to return focus to, whichever order the kit closes the menu and dispatches `ps-select` in.
- The tour module is imported with `import('../tour/product-tour')` when chosen. `runtime.ts` imports the same module statically, so both share its one `driver.js` instance.
- The welcome step lifts the Help host with an inline `z-index`. That works only because the app bar and its ancestors create no stacking context (Task 2.2's rule): do not add one.

- [ ] **Step 1: Write the failing shortcut-list test**

Create `apps/web/src/workbench/shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatKeys, SHORTCUT_GROUPS, type Shortcut, type ShortcutGroup } from './shortcuts';

describe('shortcuts', () => {
  it('formats Mod as ⌘ on Mac and Ctrl elsewhere', () => {
    expect(formatKeys(['Mod', 'K'], true)).toBe('⌘K');
    expect(formatKeys(['Mod', 'K'], false)).toBe('Ctrl+K');
    expect(formatKeys(['Mod', 'Click'], true)).toBe('⌘+Click');
    expect(formatKeys(['Mod', 'Click'], false)).toBe('Ctrl+Click');
    expect(formatKeys(['Escape'], true)).toBe('Esc');
    expect(formatKeys(['ArrowDown'], false)).toBe('↓');
  });

  it('every group has a title and at least one shortcut', () => {
    const groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS;
    expect(groups.map((group) => group.title)).toEqual([
      'Plot',
      'Selection',
      'Search',
      'Legend',
      'Structure viewer',
      'Figure editor',
    ]);
    for (const group of groups) {
      const shortcuts: readonly Shortcut[] = group.items;
      expect(shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of shortcuts) {
        expect(shortcut.keys.length).toBeGreaterThan(0);
        expect(shortcut.action.trim()).not.toBe('');
      }
    }
  });

  it('the legend group lists I', () => {
    const legend = SHORTCUT_GROUPS.find((group) => group.title === 'Legend');
    expect(
      legend?.items.some((shortcut) => shortcut.keys.length === 1 && shortcut.keys[0] === 'I'),
    ).toBe(true);
  });

  it('Escape reads clear the selection, then leave selection mode', () => {
    const selection = SHORTCUT_GROUPS.find((group) => group.title === 'Selection');
    const escape = selection?.items.find((shortcut) => shortcut.keys.join('+') === 'Escape');
    expect(escape?.action).toBe('Clear the selection, then leave selection mode');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/shortcuts.test.ts`
Expected: FAIL: the import of `./shortcuts` does not resolve (the module does not exist yet).

- [ ] **Step 3: Write the shortcut list**

Create `apps/web/src/workbench/shortcuts.ts`:

```ts
/**
 * The keyboard and pointer shortcuts the explore page has today, for the help menu's dialog. One
 * list, which phase 4 extends (undo and redo). Keys are named as `KeyboardEvent.key` names them,
 * plus 'Mod' for the platform's command key and plain words for pointer gestures.
 */
export interface Shortcut {
  /** The keys pressed together. 'Mod' reads ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: readonly string[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Plot',
    items: [
      { keys: ['Drag'], action: 'Pan the plot' },
      { keys: ['Scroll'], action: 'Zoom in or out' },
      { keys: ['Double-click'], action: 'Reset the zoom' },
      { keys: ['Shift'], action: 'Hold over a point to focus its category' },
      { keys: ['Escape'], action: 'Hide the EAT connectors' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['Click'], action: 'Select a protein and show its structure' },
      { keys: ['Mod', 'Click'], action: 'Add a protein to the selection, or remove it' },
      { keys: ['Escape'], action: 'Clear the selection, then leave selection mode' },
    ],
  },
  {
    title: 'Search',
    items: [
      { keys: ['Mod', 'K'], action: 'Focus the search box' },
      { keys: ['Mod', 'V'], action: 'Paste several IDs to select them all' },
      { keys: ['ArrowDown'], action: 'Next suggestion' },
      { keys: ['ArrowUp'], action: 'Previous suggestion' },
      { keys: ['Enter'], action: 'Select the highlighted suggestion' },
      { keys: ['Escape'], action: 'Close the suggestions and empty the box' },
    ],
  },
  {
    title: 'Legend',
    items: [
      { keys: ['Click'], action: 'Hide or show a category' },
      { keys: ['Double-click'], action: 'Show only that category' },
      { keys: ['ArrowDown'], action: 'Next category' },
      { keys: ['ArrowUp'], action: 'Previous category' },
      { keys: ['Home'], action: 'First category' },
      { keys: ['End'], action: 'Last category' },
      { keys: ['Enter'], action: 'Hide or show the focused category' },
      { keys: ['I'], action: 'Show only the focused category' },
      { keys: ['Space'], action: 'Pick up or drop a category by its drag handle' },
      { keys: ['Escape'], action: 'Cancel moving a category' },
    ],
  },
  {
    title: 'Structure viewer',
    items: [
      { keys: ['Drag'], action: 'Rotate the structure' },
      { keys: ['Right-drag'], action: 'Move the structure' },
      { keys: ['Scroll'], action: 'Zoom in or out' },
    ],
  },
  {
    title: 'Figure editor',
    items: [
      { keys: ['Delete'], action: 'Remove the selected overlay or inset' },
      { keys: ['Escape'], action: 'Deselect the overlay or inset' },
    ],
  },
];

const MAC_NAMES: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const OTHER_NAMES: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * The keys as the platform writes them. Apple platforms join modifiers to a one-character key
 * without a separator (⌘K); everything else joins with "+" (Ctrl+K, ⌘+Click).
 */
export function formatKeys(keys: readonly string[], isMac: boolean): string {
  const names = isMac ? MAC_NAMES : OTHER_NAMES;
  const shown = keys.map((key) => names[key] ?? key);
  const last = shown[shown.length - 1] ?? '';
  return isMac && last.length === 1 ? shown.join('') : shown.join('+');
}
```

(The pointer rows for the structure viewer are Mol\*'s default controls: drag rotates, right-drag pans, scroll zooms.)

- [ ] **Step 4: Run the shortcut-list test**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/shortcuts.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing e2e tests**

Create `apps/web/tests/workbench-help.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { appBar, openExplore, plotArea } from './helpers/explore';

/** The app bar's help menu (Task 2.4): documentation, keyboard shortcuts and the tour. */

const help = (page: Page) => appBar(page).getByRole('button', { name: 'Help', exact: true });

test.describe('help menu', () => {
  test('Help opens a keyboard-navigable menu and Escape returns focus to Help', async ({
    page,
  }) => {
    await openExplore(page);
    await help(page).focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: 'Help' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Documentation' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Take the tour' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(help(page)).toBeFocused();
  });

  test('Documentation opens the docs in a new tab', async ({ page, context }) => {
    // No docs server runs during e2e: answer the docs URL here.
    await context.route(/\/docs\/$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>ProtSpace docs</title>',
      }),
    );
    await openExplore(page);
    await help(page).click();

    const newPage = context.waitForEvent('page');
    await page.getByRole('menuitem', { name: 'Documentation' }).click();
    const docs = await newPage;
    await docs.waitForLoadState();
    expect(new URL(docs.url()).pathname).toBe('/docs/');
    // noopener: the docs tab cannot reach back into the explore page.
    expect(await docs.evaluate(() => window.opener)).toBeNull();
    await docs.close();
  });

  test('Keyboard shortcuts opens a dialog listing the search shortcut; Escape closes it and returns focus to Help', async ({
    page,
  }) => {
    await openExplore(page);
    await help(page).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    // The list is the dialog's slotted content, so it is found through the ps-dialog host.
    const shortcuts = page.locator('ps-dialog', { has: dialog });
    await expect(shortcuts.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(shortcuts.getByText('Focus the search box')).toBeVisible();
    await expect(shortcuts.getByText(/^(⌘K|Ctrl\+K)$/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(help(page)).toBeFocused();
  });

  test('Take the tour starts the tour', async ({ page }) => {
    await openExplore(page);
    await help(page).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    await expect(page.locator('.driver-popover')).toBeVisible();
    await expect(page.locator('.driver-popover .driver-popover-title')).toHaveText(
      'Welcome to ProtSpace',
    );
    await expect(page.getByRole('menu', { name: 'Help' })).toBeHidden();
  });

  test('the plot has no tips button', async ({ page }) => {
    await openExplore(page);
    await expect(page.locator('protspace-tips')).toHaveCount(0);
    await expect(plotArea(page).getByRole('button', { name: 'Tips & shortcuts' })).toHaveCount(0);
  });
});
```

In `apps/web/tests/product-tour.spec.ts`, add `appBar` to the helper import, so it reads:

```ts
import { appBar, waitForExploreDataLoad } from './helpers/explore';
```

and replace the test "can be re-triggered from tips popover" (from the comment `// ── Re-trigger from tips popover ────────────────────────────` through that test's closing `});`) with:

```ts
  // ── Re-trigger from the help menu ───────────────────────────

  test('can be re-triggered from the help menu', async ({ page }) => {
    // Dismiss the auto-started tour first
    await page.locator('.driver-tour-skip-btn').click();
    await waitForTourDismissed(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    // The tour should restart
    await waitForTourPopover(page);
    const title = await getPopoverTitle(page);
    expect(title).toBe(STEP_TITLES[0]);
  });

  test('the welcome step spotlights Help', async ({ page }) => {
    // Lifted above the tour's overlay while the welcome step shows, and put back after it.
    const helpHost = page.locator('[data-driver-id="help"]');
    await expect(helpHost).toHaveCSS('z-index', '100001');
    await clickNext(page);
    await expect(helpHost).not.toHaveCSS('z-index', '100001');
  });
```

- [ ] **Step 6: Run them to see them fail**

Run (sandbox disabled: it starts a server): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-help product-tour`
Expected: FAIL, all five `workbench-help` tests: the first four wait for a button named "Help" in the app bar; "the plot has no tips button" finds `protspace-tips` still in the scatterplot's shadow root; in `product-tour.spec.ts`, "can be re-triggered from the help menu" and "the welcome step spotlights Help" fail the same way, and the other tour tests pass.

- [ ] **Step 7: Remove the tips from core and add the Help icon**

Delete the two modules: `rm packages/core/src/components/scatter-plot/tooltips/protspace-tips.ts packages/core/src/components/scatter-plot/tooltips/protspace-tips.styles.ts`.

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Delete the line `import './tooltips/protspace-tips';` (:32).
2. Delete the line `  @property({ type: Boolean, attribute: 'show-tour-button' }) showTourButton = false;` (:160).
3. In `render()`, delete these lines and the blank line after them (:1730-1733):

```ts
        <protspace-tips
          data-driver-id="tips"
          .showTourButton=${this.showTourButton}
        ></protspace-tips>
```

In `packages/core/src/components/scatter-plot/scatter-plot.styles.ts`, replace the comment (:140-142)

```css
  /* Small status chips overlaid on the plot (visible point count bottom-left,
     numeric recompute notice bottom-right). Same card look as the top-left
     hover buttons (projection-metadata / protspace-tips triggers). */
```

with:

```css
  /* Small status chips overlaid on the plot (visible point count bottom-left,
     numeric recompute notice bottom-right). Same card look as the top-left
     projection-metadata trigger. */
```

In `packages/core/src/styles/style-lint.test.ts`, delete the `LEGACY` line:

```ts
  '../components/scatter-plot/tooltips/protspace-tips.styles.ts',
```

In `packages/core/src/components/kit/icon.ts`, add `CircleHelp` to the `lucide` import (keeping the names in alphabetical order) and add the key to `ICONS` after `'chevron-down'`:

```ts
  'circle-help': CircleHelp,
```

Run: `grep -rn "protspace-tips\|showTourButton\|show-tour-button\|tour-start" packages/core/src`
Expected: no output.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot src/styles src/components/kit 2>&1 | tail -4`
Expected: PASS; the style lint's "still needs its legacy exemption" cases no longer list the deleted module.

Run: `pnpm --filter @protspace/core build 2>&1 | tail -3`
Expected: the build succeeds (the app imports core's `dist`).

- [ ] **Step 8: Write the help menu and the shortcuts dialog**

Create `apps/web/src/workbench/ShortcutsDialog.tsx`:

```tsx
import type { PsDialog } from '@protspace/core';
import { isMacOrIos } from '@protspace/utils';
import { useEffect, useRef } from 'react';
import { formatKeys, SHORTCUT_GROUPS } from './shortcuts';

/** The keyboard and pointer shortcuts, one titled section per group, in a modal dialog. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const dialog = useRef<PsDialog>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Escape, the close button and a backdrop press close the dialog itself; follow it.
    element.addEventListener('ps-close', onClose);
    return () => element.removeEventListener('ps-close', onClose);
  }, [onClose]);

  const mac = isMacOrIos();
  return (
    <ps-dialog ref={dialog} heading="Keyboard shortcuts" size="lg" open={open}>
      <div className="wb-shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.items.map((shortcut) => (
                <div className="wb-shortcut" key={`${shortcut.keys.join('+')} ${shortcut.action}`}>
                  <dt>{shortcut.action}</dt>
                  <dd>
                    <kbd>{formatKeys(shortcut.keys, mac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </ps-dialog>
  );
}
```

Create `apps/web/src/workbench/HelpMenu.tsx`:

```tsx
import type { PsMenu } from '@protspace/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCS_URL } from '@/config';
import { ShortcutsDialog } from './ShortcutsDialog';

/**
 * Runs `action` once the menu that dispatched the pick has closed and handed focus back to Help:
 * the shortcuts dialog then returns focus to Help when it closes, and the tour starts over a
 * closed menu.
 */
function afterMenuCloses(action: () => void): void {
  window.setTimeout(action, 0);
}

/**
 * The app bar's help menu (design decisions 1 and 15): the documentation, the keyboard shortcuts
 * and the product tour, which the plot's tips popover and tour button offered before.
 */
export function HelpMenu() {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      // Synchronous, inside the user's click or key press, so the browser allows the new tab.
      if (value === 'docs') window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
      if (value === 'shortcuts') afterMenuCloses(() => setShortcutsOpen(true));
      if (value === 'tour') {
        afterMenuCloses(() => {
          void import('../tour/product-tour').then(({ startProductTour }) =>
            startProductTour({ force: true }),
          );
        });
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  const toggle = () => {
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-icon-button
        ref={trigger}
        data-driver-id="help"
        icon="circle-help"
        label="Help"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Help" placement="bottom-end">
        <ps-menu-item value="docs">Documentation</ps-menu-item>
        <ps-menu-item value="shortcuts">Keyboard shortcuts</ps-menu-item>
        <ps-menu-item value="tour">Take the tour</ps-menu-item>
      </ps-menu>
      <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
}
```

In `apps/web/src/workbench/AppBar.tsx`, add the import

```tsx
import { HelpMenu } from './HelpMenu';
```

after `import { buildMailto, GITHUB_REPO_URL } from '@/lib/support';`, and make `<HelpMenu />` the first child of the actions, so the block reads:

```tsx
      <div data-workbench="app-bar-actions">
        <HelpMenu />
        <a className="wb-icon-link" href={FEEDBACK_HREF} aria-label="Feedback">
```

In `apps/web/src/workbench/PlotArea.tsx`, replace

```tsx
      <protspace-scatterplot
        id="myPlot"
        data-driver-id="scatterplot"
        show-tour-button="true"
      ></protspace-scatterplot>
```

with:

```tsx
      <protspace-scatterplot id="myPlot" data-driver-id="scatterplot"></protspace-scatterplot>
```

In `apps/web/src/custom-elements.d.ts`, delete the line `          'show-tour-button'?: string;` from the `'protspace-scatterplot'` entry.

Append to `apps/web/src/workbench/workbench.css`:

```css
/* ── Keyboard shortcuts dialog (light DOM slotted into ps-dialog) ─────────── */

.wb-shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--ps-space-5) var(--ps-space-6);
}

.wb-shortcuts h3 {
  margin: 0 0 var(--ps-space-2);
  color: var(--ps-text-muted);
  font-size: var(--ps-text-xs);
  font-weight: var(--ps-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.wb-shortcuts dl {
  display: grid;
  gap: var(--ps-space-1-5);
  margin: 0;
}

.wb-shortcut {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ps-space-3);
}

.wb-shortcut dd {
  flex: none;
  margin: 0;
}

.wb-shortcut kbd {
  padding: 0 5px;
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-sm);
  background: var(--ps-surface-muted);
  color: var(--ps-text-muted);
  font: inherit;
  font-size: var(--ps-text-xs);
  line-height: 18px;
  white-space: nowrap;
}
```

- [ ] **Step 9: Point the runtime and the tour at Help**

In `apps/web/src/explore/runtime.ts`, delete the plot's `tour-start` listener (the tips button is gone; the help menu starts the tour itself) and the blank line after it:

```ts
  addTrackedEventListener(lifecycle, plotElement, 'tour-start', () => {
    startProductTour({ force: true });
  });
```

(`startProductTour` stays imported: the first `data-loaded` still starts the tour.)

In `apps/web/src/tour/product-tour.ts`:

1. Delete the constant that only the tips spotlight used, and the blank line before it:

```ts
/** Host selector for the scatterplot custom element. */
const SCATTERPLOT = '[data-driver-id="scatterplot"]';
```

2. Replace the spotlight section, from

```ts
// ---------------------------------------------------------------------------
// Tips icon spotlight (step 1)
// ---------------------------------------------------------------------------
```

through the closing `}` of `spotlightTipsIcon`, with:

```ts
// ---------------------------------------------------------------------------
// Help spotlight (step 1)
// ---------------------------------------------------------------------------

/** The app bar's Help button, where the tour and the shortcuts live. */
const HELP = '[data-driver-id="help"]';

/**
 * Add or remove a visual spotlight on the Help button. Used during the centred welcome step so
 * the user can see where to find the tour later, even though the popover is not attached to it.
 *
 * The glow goes on the `<button>` inside `<ps-icon-button>`'s shadow DOM (not the host), so it
 * follows the button's rounded shape. Lifting the host above the overlay works because the app
 * bar creates no stacking context.
 */
function spotlightHelp(on: boolean) {
  const host = document.querySelector(HELP);
  if (!(host instanceof HTMLElement)) return;
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLElement)) return;

  if (on) {
    // Lift the host above the driver.js overlay (z-index ~100000)
    host.style.zIndex = '100001';
    // Glow on the rounded button so there are no corner artifacts
    button.style.boxShadow = '0 0 0 3px #00a3e0, 0 0 12px rgba(0, 163, 224, 0.5)';
    button.style.transition = 'box-shadow 0.3s ease';
  } else {
    host.style.removeProperty('z-index');
    button.style.removeProperty('box-shadow');
    button.style.removeProperty('transition');
  }
}
```

3. In step 1, replace `spotlightTipsIcon(true);` with `spotlightHelp(true);` and `onDeselected: () => spotlightTipsIcon(false),` with `onDeselected: () => spotlightHelp(false),`.

Run: `grep -rn "protspace-tips\|show-tour-button\|showTourButton\|tour-start\|spotlightTipsIcon" apps/web/src`
Expected: no output.

- [ ] **Step 10: Run the task's tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/shortcuts.test.ts`
Expected: PASS, 4 tests.

Run (sandbox disabled): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-help product-tour`
Expected: PASS: 5 `workbench-help` tests, and every `product-tour` test, including "can be re-triggered from the help menu", "the welcome step spotlights Help" and "each step highlights the correct element".

- [ ] **Step 11: Update the developer docs**

In `docs/developers/api/index.md`:

1. Delete the scatterplot property row (:71):

```md
| `showTourButton`                    | `boolean`                             | `false`       | Show the guided-tour button                    |
```

2. Replace the paragraph under "### HTML attributes" (:75-78)

```md
Three properties have explicit kebab-case attributes: `selection-tool`, `filters-active` and
`show-tour-button`. The rest are reachable from markup under their implicit all-lowercase names (for
example `selectedannotation`, `projectionplane`); no scatterplot property is `attribute: false`. Set
the object and array properties from JavaScript.
```

with:

```md
Three properties have explicit kebab-case attributes: `selection-tool`, `filters-active` and
`eat-overlay-enabled`. The rest are reachable from markup under their implicit all-lowercase names
(for example `selectedannotation`, `projectionplane`); no scatterplot property is
`attribute: false`. Set the object and array properties from JavaScript.
```

3. Delete the scatterplot event row (:134):

```md
| `tour-start`             | none                                             | The guided-tour button was pressed  |
```

In `docs/developers/contributing.md`, replace (:83-85)

```md
The scatter plot's public events are `protein-click`, `protein-hover`, `brush-selection`,
`data-change`, `data-isolation`, `data-isolation-reset`, `auto-disable-selection`, `file-dropped`
and `tour-start`.
```

with:

```md
The scatter plot's public events are `protein-click`, `protein-hover`, `brush-selection`,
`data-change`, `data-isolation`, `data-isolation-reset`, `auto-disable-selection` and
`file-dropped`.
```

Run: `grep -rn "show-tour-button\|showTourButton\|tour-start\|protspace-tips" docs/developers`
Expected: no output. (The user guide's mention of the Tips popover, `docs/explore/index.md`, waits for phase 7.)

- [ ] **Step 12: Run the full suites this task affects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: every unit and browser file passes (no core test covered `protspace-tips`).

Run: `pnpm --filter @protspace/app exec vitest --run 2>&1 | tail -4`
Expected: PASS, one more file and 4 more tests than after Task 2.3.

Run: `pnpm type-check 2>&1 | tail -3 && pnpm knip`
Expected: no type errors; knip reports nothing (`SHORTCUT_GROUPS`, `formatKeys`, `Shortcut` and `ShortcutGroup` have their consumers in the dialog and the test; `HelpMenu` and `ShortcutsDialog` in the app bar and the menu).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e 2>&1 | tail -6`
Expected: the full suite passes, including `workbench-shell`, `workbench-helpers`, `workbench-help` and `product-tour`.

Run (sandbox disabled): `pnpm docs:build 2>&1 | tail -3`
Expected: the docs build passes.

Run: `pnpm exec prettier --check apps/web/src/workbench apps/web/src/explore/runtime.ts apps/web/src/tour/product-tour.ts apps/web/src/custom-elements.d.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.styles.ts packages/core/src/styles/style-lint.test.ts packages/core/src/components/kit/icon.ts docs/developers/api/index.md docs/developers/contributing.md apps/web/tests/workbench-help.spec.ts apps/web/tests/product-tour.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/workbench/HelpMenu.tsx apps/web/src/workbench/ShortcutsDialog.tsx \
  apps/web/src/workbench/shortcuts.ts apps/web/src/workbench/shortcuts.test.ts \
  apps/web/src/workbench/AppBar.tsx apps/web/src/workbench/PlotArea.tsx \
  apps/web/src/workbench/workbench.css apps/web/src/custom-elements.d.ts \
  apps/web/src/explore/runtime.ts apps/web/src/tour/product-tour.ts \
  packages/core/src/components/scatter-plot/tooltips/protspace-tips.ts \
  packages/core/src/components/scatter-plot/tooltips/protspace-tips.styles.ts \
  packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/scatter-plot.styles.ts \
  packages/core/src/styles/style-lint.test.ts packages/core/src/components/kit/icon.ts \
  docs/developers/api/index.md docs/developers/contributing.md \
  apps/web/tests/workbench-help.spec.ts apps/web/tests/product-tour.spec.ts
git commit -m "feat(web): add a help menu with shortcuts and the tour"
```

(`git add` of the two deleted tips modules stages their removal.)

---

### Task 2.5: Import and Export menus in the app bar

The control bar's Import and Export menus become `protspace-import-menu` and `protspace-export-menu` (decision 9) in the app bar's actions (decision 1). They keep today's panel contents and rendering, now on token styles, and register the open panel with the layer stack for Escape and outside presses; phase 4.8 rebuilds them on the kit. The data loader opens its own file picker. This task also adds `ExploreControls`, the one seam through which the dataset pipeline resets and fills the controls, so later split tasks change only the runtime's composition.

**Files:**

- Create: `packages/core/src/components/import-menu/import-menu.ts`, `import-menu.styles.ts`, `types.ts`, `import-menu.test.ts`
- Create: `packages/core/src/components/export-menu/export-menu.ts`, `export-menu.styles.ts`, `export-defaults.ts`, `export-menu.test.ts`
- Modify: `packages/core/src/components/data-loader/data-loader.ts` (+ a test for `openFilePicker`)
- Modify: `packages/core/src/components/control-bar/control-bar.ts` (Import and Export properties :101-113, menu state :126-127 and :145-146, handlers :590-678 and :691-727, the export-format line of `clearForNewDataset` :680-689, markup :1053-1310; the `data-driver-id` on `.data-actions-group`), `control-bar.styles.ts` and `styles/export.ts` (moved rules), `control-bar-helpers.ts` (+ test; `EXPORT_DEFAULTS` out), `types.ts` (`ExampleDatasetSummary` out)
- Delete: `packages/core/src/components/control-bar/control-bar.import-menu.test.ts` (ported)
- Modify: `packages/core/src/index.ts`, `packages/core/src/components/kit/icon.ts` (icons the menus render)
- Create: `apps/web/src/explore/explore-controls.ts`, `import-controller.ts`, `import-controller.test.ts`
- Modify: `apps/web/src/explore/runtime.ts`, `elements.ts`, `control-bar-events.ts` and `control-bar-events.test.ts` (import part out), `export-handler.ts` (:24-68), `dataset-controller.ts` (:44-62, :164-210, :413, :455), `dataset-controller.fixtures.ts` (:53), `data-renderer.ts` (:13-22, :107-114, :173-211), `data-renderer.test.ts`
- Modify: `apps/web/src/workbench/AppBar.tsx`, `apps/web/src/custom-elements.d.ts`, `apps/web/src/tour/product-tour.ts` (steps 2 and 6)
- Modify: `apps/web/tests/helpers/explore.ts` (`importTrigger`, `importMenu`, `exportMenu`, `openImportMenu`, `openExportMenu`, `pickExample`), `apps/web/tests/dataset-reload.spec.ts` (:630, :659 dispatch on `#myExportMenu`)
- Create: `apps/web/tests/workbench-import-export.spec.ts`
- Also: `styles/export.ts` holds only the two menus' rules, so moving them empties it and it is deleted here, with its `LEGACY` line in `packages/core/src/styles/style-lint.test.ts` (an empty style module fails `styles-integrity.test.ts`); the `test` for `openFilePicker` goes into `packages/core/src/components/data-loader/data-loader.handler.test.ts`; `apps/web/src/explore/dataset-controller.eat.test.ts` (its control-bar mocks become `controls`); `apps/web/src/workbench/workbench.css` (the actions group)

**Interfaces:**

- Consumes: the control bar's Import and Export code and `renderExampleInfo` (control-bar.ts :590-728, :1053-1310); `pushLayer(layer: Layer): () => void` (`kit/layers.ts`); `ps-button`, `icon`; `protspace-info-popover`; `EXPORT_DEFAULTS`; `findExampleDataset(id)`; `DatasetController.loadExampleDatasetAndClearPersistedFile(entry, 'menu')`; `createExportHandler`; the Task 2.3 helpers.
- Produces (core):
  - `<protspace-import-menu id="myImportMenu" data-driver-id="import">`, class `ProtspaceImportMenu`: `exampleDatasets: readonly ExampleDatasetSummary[]` (property only), `examplesDocsUrl` (`examples-docs-url`), `currentDatasetName` (`current-dataset-name`), `currentExampleId: string | null` (`current-example-id`). Its trigger is a button named "Import" (`aria-haspopup="menu"`, `aria-expanded`) whose text sits in `part="trigger-label"`. The panel keeps `[data-driver-id="import-own-dataset"]`, `.import-current-dataset-row`, `.import-examples`, `.import-examples-docs`, `[data-example-id]` (disabled for the current example), `.import-example-badge` and `[data-example-info]`. Events (bubbles, composed): `load-example-dataset` `{ id: string }` and `open-file-dialog` `{}`, both dispatched synchronously inside the click so the file picker keeps user activation. Escape and an outside press close the panel and return focus to the trigger.
  - `ExampleDatasetSummary` lives in `components/import-menu/types.ts`; the core index re-exports it.
  - `<protspace-export-menu id="myExportMenu">`, class `ProtspaceExportMenu`: `hasFileSettings` (`has-file-settings`); `reset(): void` (back to PNG, legend settings included); trigger named "Export" with `part="trigger-label"`; today's panel content; events `export` with `detail: ExportEventDetail` and `open-publish-editor` `{}`; `export interface ExportEventDetail { type: 'png' | 'pdf' | 'ids' | 'parquet'; imageWidth: number; imageHeight: number; legendWidthPercent: number; legendFontSizePx: number; includeLegend: boolean; includeLegendSettings: boolean }`.
  - `EXPORT_DEFAULTS` lives in `components/export-menu/export-defaults.ts`; the core index re-exports it.
  - `DataLoader.openFilePicker(): void` clicks its hidden file input.
- Produces (app):
  - `apps/web/src/explore/explore-controls.ts`: `interface InitialView { projection: string; annotation: string; tooltip: readonly string[] }`; `interface ExploreControls { resetForNewDataset(): void; setHasFileSettings(value: boolean): void; showInitialView(view: InitialView): void; setRendering(rendering: boolean): void; clearStructure(): void }`. `createDatasetController({ controls, … })` takes `controls: ExploreControls` in place of `controlBar` and `structureViewer`; `createDataRenderer({ controls, … })` takes `controls: Pick<ExploreControls, 'showInitialView' | 'setRendering' | 'clearStructure'>` in their place. `runtime.ts` builds the single `ExploreControls` object; here: the control bar's `clearForNewDataset` plus `exportMenu.reset()`, `exportMenu.hasFileSettings = value`, today's `applyControlBarState`, `controlBar.autoSync = !rendering`, today's viewer hide.
  - `apps/web/src/explore/import-controller.ts`: `bindImportMenu(options: { listen(type: string, listener: EventListener): void; dataLoader: Pick<ProtspaceDataLoader, 'openFilePicker'>; datasetController: Pick<DatasetController, 'loadExampleDatasetAndClearPersistedFile'> }): void`; `load-example-dataset` loads the example as a menu choice (an unknown id warns and does nothing); `open-file-dialog` calls `openFilePicker()`.
  - `createExportHandler({ exportMenu, … })` listens for `open-publish-editor` on the export menu; the runtime routes `export` from `#myExportMenu` to it.
  - `elements.ts`: `importMenu` (`#myImportMenu`, tag `protspace-import-menu`) and `exportMenu` (`#myExportMenu`, tag `protspace-export-menu`) in `REQUIRED_TAGS` and `getElements`.
  - App bar actions, before Help: `div[data-driver-id="data-actions"]` holding `#myImportMenu` then `#myExportMenu`. The control bar no longer carries `data-driver-id="import"` or `"data-actions"`.
  - Tour steps 2 and 6 target the light-DOM `[data-driver-id="import"]` and `[data-driver-id="data-actions"]`.
  - The runtime sets `exampleDatasets`, `examplesDocsUrl`, `currentDatasetName` and `currentExampleId` on the import menu where it set them on the control bar (runtime.ts :60-69).
  - Helpers `importTrigger`, `importMenu`, `exportMenu`, `openImportMenu`, `openExportMenu` and `pickExample` target the new elements.

**Tests:**

- `import-menu.test.ts` (unit, jsdom; ported from `control-bar.import-menu.test.ts` :70-300): "lists the examples with the Large badge and disables the current one"; "a click on an example dispatches load-example-dataset with its id and closes"; "Load your dataset dispatches open-file-dialog"; "shows the current dataset name with its info"; "Escape and a press outside close the panel and return focus to Import"; "the examples docs link opens in a new tab".
- `export-menu.test.ts` (unit, jsdom): "PNG and PDF offer the figure editor and a quick export"; "IDs and Parquet export directly"; "Include legend settings shows only for Parquet and travels in the detail"; "export carries the EXPORT_DEFAULTS sizes"; "Figure Editor dispatches open-publish-editor"; "reset returns to PNG"; "Escape closes the panel".
- Data loader: "openFilePicker clicks the file input".
- `import-controller.test.ts` (unit, node): "loads the example the event names, as a menu choice"; "warns on an unknown id and does nothing"; "open-file-dialog opens the data loader's file picker".
- `dataset-controller.*.test.ts`, `data-renderer.test.ts` (updated fixtures): "a new dataset resets the controls and shows its initial view"; "bundle settings report hasFileSettings".
- `apps/web/tests/workbench-import-export.spec.ts` (e2e): "Import and Export sit in the app bar and work from the keyboard"; "Load your dataset opens the file chooser" (`filechooser`); "an example's info bubble is fully visible and topmost" (Review Focus 5); "Quick export PNG downloads a file"; "the figure editor opens from Export".
- `workbench-helpers.spec.ts`, `example-datasets.spec.ts`, `dataset-reload.spec.ts` and the tour's step highlights stay green.

**Commit:** `feat(core): move Import and Export into app-bar menus`

Notes for the implementer:

- Both panels stay `position: absolute` inside their element's shadow root, at `z-index: 100` (the control bar's dropdown level; the app bar has no z-index of its own, so this competes with the sidebar's content and stays under the 9999 loading overlay), not in a `ps-popover`: an example's ⓘ bubble (`protspace-info-popover placement="side"`) is `position: fixed`, and a top-layer panel's `translate` would make it a containing block. Nothing between the panel and the root may get a `transform`, `filter` or `contain` (Review Focus 5).
- A panel is a layer while it is open: `pushLayer({ close, elements: [this] })`, released on close and on disconnect. Escape is consumed by `kit/layers.ts` in the capture phase on `window`, so the control bar's document `keydown` handler (selection clearing) never sees an Escape that closed a panel. Closing returns focus to the trigger when focus was inside the menu, as `ps-popover` does.
- Trigger names come from `aria-label` ("Import", "Export"), so Task 2.9 can hide `::part(trigger-label)` below 1100 px without losing them. The export trigger's former native `title` becomes a `ps-tooltip` that shows only when the file carries saved settings; the panel's per-button `title` hints are dropped (new code uses no native `title`).
- The control bar keeps its Filter button in `.data-actions-group` until Task 2.6; the group only loses its `data-driver-id`.
- `ExploreControls` is the seam later tasks change. This task's implementation lives in `runtime.ts`; `dataset-controller.ts` and `data-renderer.ts` call only the interface.

- [ ] **Step 1: Write the failing core tests**

Create `packages/core/src/components/import-menu/import-menu.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './import-menu';
import type { ProtspaceImportMenu } from './import-menu';
import type { ExampleDatasetSummary } from './types';

const EXAMPLE_DATASETS: ExampleDatasetSummary[] = [
  {
    id: 'demo',
    label: 'Demo',
    description: 'The startup demo dataset.',
    insight: 'Toxin families form their own clusters.',
    docsUrl: '/docs/explore/example-datasets#demo',
  },
  { id: '5K', label: 'Swiss-Prot 5K', description: 'A small Swiss-Prot subset.' },
  {
    id: 'swissprot',
    label: 'Swiss-Prot',
    description: 'All of Swiss-Prot. Large: a 45 MB download.',
    docsUrl: '/docs/explore/example-datasets#swissprot',
    large: true,
  },
];

type InfoPopoverElement = HTMLElement & {
  description: string;
  detail: string;
  docsUrl: string;
  label: string;
  updateComplete: Promise<unknown>;
};

let menu: ProtspaceImportMenu;

beforeEach(async () => {
  document.body.innerHTML = '';
  menu = document.createElement('protspace-import-menu');
  menu.exampleDatasets = EXAMPLE_DATASETS;
  document.body.append(menu);
  await menu.updateComplete;
});

afterEach(() => {
  // Removing an open menu releases its layer, so the next test starts with none.
  menu.remove();
});

const root = () => menu.shadowRoot!;
const panel = () => root().querySelector('.import-menu');
const trigger = () => root().querySelector<HTMLButtonElement>('.trigger')!;
const example = (id: string) =>
  root().querySelector<HTMLButtonElement>(`[data-example-id="${id}"]`)!;
const exampleInfo = (id: string) =>
  root().querySelector(`.import-examples [data-example-info="${id}"]`) as InfoPopoverElement | null;

async function open(): Promise<void> {
  if (!panel()) trigger().click();
  await menu.updateComplete;
}

function press(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
}

describe('protspace-import-menu', () => {
  it('lists the examples with the Large badge and disables the current one', async () => {
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    await open();

    const buttons = root().querySelectorAll('[data-driver-id="import-example-dataset"]');
    expect(buttons).toHaveLength(EXAMPLE_DATASETS.length);
    expect(buttons[0].querySelector('.import-example-label')?.textContent?.trim()).toBe('Demo');
    // The info popover carries the description; a native tooltip would duplicate it.
    expect(buttons[0].hasAttribute('title')).toBe(false);
    expect(
      root().querySelector('.import-examples-hint')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe("Examples open in a curated view; your changes aren't kept.");

    expect(root().querySelectorAll('.import-example-badge')).toHaveLength(1);
    expect(example('swissprot').querySelector('.import-example-badge')?.textContent?.trim()).toBe(
      'Large',
    );
    expect(example('5K').querySelector('.import-example-badge')).toBeNull();

    expect(example('demo').disabled).toBe(true);
    expect(example('5K').disabled).toBe(false);

    // Every example has one info control beside its button, never inside it.
    const rows = root().querySelectorAll('.import-examples .import-example-row');
    expect(rows).toHaveLength(EXAMPLE_DATASETS.length);
    rows.forEach((row, index) => {
      const infos = row.querySelectorAll('protspace-info-popover');
      expect(infos).toHaveLength(1);
      expect(infos[0]?.getAttribute('data-example-info')).toBe(EXAMPLE_DATASETS[index].id);
      expect(row.querySelector('button protspace-info-popover')).toBeNull();
    });
    expect(exampleInfo('demo')?.description).toBe('The startup demo dataset.');
    expect(exampleInfo('demo')?.detail).toBe('Toxin families form their own clusters.');
    expect(exampleInfo('5K')?.detail).toBe('');
    expect(exampleInfo('5K')?.docsUrl).toBe('');
  });

  it('omits the Examples section when the host sets no catalog', async () => {
    menu.exampleDatasets = [];
    await menu.updateComplete;
    await open();

    expect(panel()).not.toBeNull();
    expect(root().querySelector('.import-examples')).toBeNull();
    expect(root().querySelector('.import-examples-hint')).toBeNull();
  });

  it('a click on an example dispatches load-example-dataset with its id and closes', async () => {
    const onLoad = vi.fn();
    document.addEventListener('load-example-dataset', onLoad);
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    await open();

    // The current example is disabled and loads nothing.
    example('demo').click();
    expect(onLoad).not.toHaveBeenCalled();

    example('5K').click();
    document.removeEventListener('load-example-dataset', onLoad);
    expect(onLoad).toHaveBeenCalledOnce();
    expect((onLoad.mock.calls[0][0] as CustomEvent<{ id: string }>).detail).toEqual({ id: '5K' });
    await menu.updateComplete;
    expect(panel()).toBeNull();
  });

  it('Load your dataset dispatches open-file-dialog', async () => {
    const onOpen = vi.fn();
    document.addEventListener('open-file-dialog', onOpen);
    await open();

    root().querySelector<HTMLButtonElement>('[data-driver-id="import-own-dataset"]')!.click();
    // Synchronously, inside the click, so the host's file picker keeps the user's activation.
    expect(onOpen).toHaveBeenCalledOnce();
    document.removeEventListener('open-file-dialog', onOpen);
    await menu.updateComplete;
    expect(panel()).toBeNull();
  });

  it('shows the current dataset name with its info', async () => {
    await open();
    const name = () => root().querySelector('.import-current-dataset-name')?.textContent?.trim();
    const currentInfo = () =>
      root().querySelector(
        '.import-current-dataset-row protspace-info-popover',
      ) as InfoPopoverElement | null;
    expect(name()).toBe('No dataset loaded');

    menu.currentDatasetName = 'Demo';
    menu.currentExampleId = 'demo';
    await menu.updateComplete;
    expect(name()).toBe('Demo');
    expect(currentInfo()?.getAttribute('data-example-info')).toBe('demo');
    expect(currentInfo()?.description).toBe('The startup demo dataset.');
    expect(currentInfo()?.docsUrl).toBe('/docs/explore/example-datasets#demo');

    // A user import has no info control.
    menu.currentDatasetName = 'mine.parquetbundle';
    menu.currentExampleId = null;
    await menu.updateComplete;
    expect(name()).toBe('mine.parquetbundle');
    expect(currentInfo()).toBeNull();
  });

  it("an example's info control explains it without loading it", async () => {
    const onLoad = vi.fn();
    menu.addEventListener('load-example-dataset', onLoad);
    await open();

    const info = exampleInfo('demo')!;
    (info.shadowRoot!.querySelector('.info-button') as HTMLButtonElement).click();
    await info.updateComplete;
    const popover = info.shadowRoot!.querySelector('.popover');
    expect(popover?.querySelector('.popover-description')?.textContent?.trim()).toBe(
      'The startup demo dataset.',
    );
    expect(popover?.querySelector('.popover-link')?.getAttribute('href')).toBe(
      '/docs/explore/example-datasets#demo',
    );
    expect(onLoad).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('Escape and a press outside close the panel and return focus to Import', async () => {
    await open();
    expect(root().activeElement).toBe(
      root().querySelector('[data-driver-id="import-own-dataset"]'),
    );
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    await open();
    // A press inside the panel keeps it open; one outside closes it.
    press(panel()!);
    await menu.updateComplete;
    expect(panel()).not.toBeNull();
    press(document.body.appendChild(document.createElement('div')));
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
  });

  it('the examples docs link opens in a new tab', async () => {
    await open();
    expect(root().querySelector('.import-examples-docs')).toBeNull();

    menu.setAttribute('examples-docs-url', '/docs/explore/example-datasets');
    await menu.updateComplete;
    const link = root().querySelector<HTMLAnchorElement>(
      '.import-examples-header .import-examples-docs',
    )!;
    expect(link.textContent?.trim()).toBe('About these examples ↗');
    expect(link.getAttribute('href')).toBe('/docs/explore/example-datasets');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
```

Create `packages/core/src/components/export-menu/export-menu.test.ts` (the `EXPORT_DEFAULTS` cases move here from `control-bar-helpers.test.ts` unchanged):

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_DEFAULTS } from './export-defaults';
import './export-menu';
import type { ExportEventDetail, ProtspaceExportMenu } from './export-menu';

let menu: ProtspaceExportMenu;

beforeEach(async () => {
  document.body.innerHTML = '';
  menu = document.createElement('protspace-export-menu');
  document.body.append(menu);
  await menu.updateComplete;
});

afterEach(() => {
  // Removing an open menu releases its layer, so the next test starts with none.
  menu.remove();
});

const root = () => menu.shadowRoot!;
const panel = () => root().querySelector('.export-menu');
const trigger = () => root().querySelector<HTMLButtonElement>('.trigger')!;
/** A button of the menu by its visible text. */
const button = (text: string) =>
  [...root().querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === text,
  );

async function open(): Promise<void> {
  if (!panel()) trigger().click();
  await menu.updateComplete;
}

async function choose(format: string): Promise<void> {
  button(format)!.click();
  await menu.updateComplete;
}

describe('protspace-export-menu', () => {
  it('PNG and PDF offer the figure editor and a quick export', async () => {
    await open();
    expect(button('PNG')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Figure Editor')).toBeDefined();
    expect(button('Quick Export PNG')).toBeDefined();

    await choose('PDF');
    expect(button('PDF')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Figure Editor')).toBeDefined();
    expect(button('Quick Export PDF')).toBeDefined();
  });

  it('IDs and Parquet export directly', async () => {
    await open();
    await choose('IDs');
    expect(button('Figure Editor')).toBeUndefined();
    expect(button('Export IDS')).toBeDefined();

    await choose('Parquet');
    expect(button('Figure Editor')).toBeUndefined();
    expect(button('Export PARQUET')).toBeDefined();
  });

  it('Include legend settings shows only for Parquet and travels in the detail', async () => {
    const onExport = vi.fn();
    document.addEventListener('export', onExport);
    await open();
    expect(root().querySelector('.export-checkbox')).toBeNull();

    await choose('Parquet');
    const checkbox = root().querySelector<HTMLInputElement>('.export-checkbox')!;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    await menu.updateComplete;
    button('Export PARQUET')!.click();
    document.removeEventListener('export', onExport);

    expect(onExport).toHaveBeenCalledOnce();
    expect((onExport.mock.calls[0][0] as CustomEvent<ExportEventDetail>).detail).toMatchObject({
      type: 'parquet',
      includeLegendSettings: false,
    });
  });

  it('export carries the EXPORT_DEFAULTS sizes', async () => {
    const onExport = vi.fn();
    menu.addEventListener('export', onExport);
    await open();
    button('Quick Export PNG')!.click();
    await menu.updateComplete;

    expect((onExport.mock.calls[0][0] as CustomEvent<ExportEventDetail>).detail).toEqual({
      type: 'png',
      imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
      imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
      legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
      legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
      includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
      includeLegendSettings: true,
    });
    expect(panel()).toBeNull();
  });

  it('Figure Editor dispatches open-publish-editor', async () => {
    const onOpen = vi.fn();
    menu.addEventListener('open-publish-editor', onOpen);
    await open();
    button('Figure Editor')!.click();
    await menu.updateComplete;

    expect(onOpen).toHaveBeenCalledOnce();
    expect(panel()).toBeNull();
  });

  it('reset returns to PNG', async () => {
    await open();
    await choose('Parquet');
    root().querySelector<HTMLInputElement>('.export-checkbox')!.click();
    await menu.updateComplete;

    menu.reset();
    await menu.updateComplete;
    expect(button('PNG')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Quick Export PNG')).toBeDefined();
    // The legend settings come back included too.
    await choose('Parquet');
    expect(root().querySelector<HTMLInputElement>('.export-checkbox')!.checked).toBe(true);
  });

  it('Escape closes the panel', async () => {
    await open();
    expect(root().activeElement).toBe(button('PNG'));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await menu.updateComplete;
    expect(panel()).toBeNull();
    expect(root().activeElement).toBe(trigger());
  });
});

describe('EXPORT_DEFAULTS', () => {
  it('has correct default values', () => {
    expect(EXPORT_DEFAULTS.FORMAT).toBe('png');
    expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBe(2048);
    expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBe(1024);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBe(20);
    expect(EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX).toBe(15);
    expect(EXPORT_DEFAULTS.BASE_FONT_SIZE).toBe(24);
    expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBe(8);
    expect(EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX).toBe(120);
    expect(EXPORT_DEFAULTS.LOCK_ASPECT_RATIO).toBe(true);
  });

  it('is defined and not undefined', () => {
    expect(EXPORT_DEFAULTS).toBeDefined();
    expect(typeof EXPORT_DEFAULTS).toBe('object');
  });

  it('has all required keys', () => {
    const requiredKeys = [
      'FORMAT',
      'IMAGE_WIDTH',
      'IMAGE_HEIGHT',
      'LEGEND_WIDTH_PERCENT',
      'LEGEND_FONT_SIZE_PX',
      'BASE_FONT_SIZE',
      'MIN_LEGEND_FONT_SIZE_PX',
      'MAX_LEGEND_FONT_SIZE_PX',
      'LOCK_ASPECT_RATIO',
      'INCLUDE_LEGEND',
    ];

    requiredKeys.forEach((key) => {
      expect(EXPORT_DEFAULTS).toHaveProperty(key);
    });
  });

  it('defaults INCLUDE_LEGEND to true', () => {
    expect(EXPORT_DEFAULTS.INCLUDE_LEGEND).toBe(true);
  });

  it('has valid numeric ranges', () => {
    expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeGreaterThan(0);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBeLessThanOrEqual(100);
    expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBeLessThan(
      EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX,
    );
  });

  describe('export dimension calculations', () => {
    it('calculates correct legend percentage', () => {
      const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
      expect(legendPercent).toBe(0.2);
    });

    it('calculates correct target width for scatterplot', () => {
      const legendPercent = EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT / 100;
      const targetWidth = Math.round(EXPORT_DEFAULTS.IMAGE_WIDTH * (1 - legendPercent));
      expect(targetWidth).toBe(1638); // 2048 * 0.80 = 1638
    });

    it('calculates correct legend scale factor', () => {
      const scaleFactor = EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBe(0.625); // 15 / 24 = 0.625
    });

    it('calculates scale factor for minimum font size', () => {
      const scaleFactor = EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBeCloseTo(0.333, 2); // 8 / 24 ≈ 0.333
    });

    it('calculates scale factor for maximum font size', () => {
      const scaleFactor = EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX / EXPORT_DEFAULTS.BASE_FONT_SIZE;
      expect(scaleFactor).toBe(5.0); // 120 / 24 = 5.0
    });
  });
});
```

In `packages/core/src/components/data-loader/data-loader.handler.test.ts`, change the first import to `import { describe, expect, it, beforeEach, vi } from 'vitest';` and append:

```ts
describe('data-loader openFilePicker', () => {
  it('openFilePicker clicks the file input', async () => {
    document.body.innerHTML = '';
    const dataLoader = document.createElement('protspace-data-loader') as HTMLElement & {
      openFilePicker(): void;
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(dataLoader);
    await dataLoader.updateComplete;

    const input = dataLoader.shadowRoot!.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    dataLoader.openFilePicker();
    expect(click).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/import-menu src/components/export-menu src/components/data-loader/data-loader.handler.test.ts`
Expected: FAIL: the imports of `./import-menu`, `./export-menu` and `./export-defaults` do not resolve, and "openFilePicker clicks the file input" fails with `dataLoader.openFilePicker is not a function`.

- [ ] **Step 3: Write the two menus and the loader's file picker**

In `packages/core/src/components/kit/icon.ts`, add `Download`, `SquarePen` and `Upload` to the `lucide` import (keeping the names in alphabetical order) and these keys to `ICONS`, keeping its keys in alphabetical order:

```ts
  download: Download,
  'square-pen': SquarePen,
  upload: Upload,
```

Create `packages/core/src/components/import-menu/types.ts` (moved unchanged from `control-bar/types.ts`):

```ts
/** One entry of the host app's example-dataset catalog, as shown in the Import menu. */
export interface ExampleDatasetSummary {
  id: string;
  label: string;
  /** What the dataset is; the first paragraph of the entry's info popover. */
  description: string;
  /** One line naming what the example's curated view shows; the popover's second paragraph. */
  insight?: string;
  /** The entry's documentation, linked as "Learn more ↗" from its info popover. */
  docsUrl?: string;
  /** Slow to download and decode: the item shows a "Large" badge. */
  large?: boolean;
}
```

Create `packages/core/src/components/import-menu/import-menu.styles.ts`:

```ts
import { css } from 'lit';
import { focusRing, kitHost, reducedMotion } from '../kit/kit-shared.styles';

/**
 * The trigger, the panel and the panel's buttons, shared by the Import and Export menus until
 * phase 4.8 rebuilds both on the kit. Token values only; the layout is the control bar's.
 */
export const dataMenuStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  css`
    :host {
      position: relative;
      display: inline-flex;
    }

    .trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      padding: 0 var(--ps-space-3);
      border: 1px solid var(--ps-border-strong);
      border-radius: var(--ps-radius);
      background: var(--ps-surface);
      color: var(--ps-text);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
      background: var(--ps-surface-hover);
    }

    .trigger .ps-icon {
      flex: none;
      color: var(--ps-text-muted);
    }

    /* Over the plot and the sidebar it overlaps (100, as the control bar's dropdowns), under the
       loading overlay. Not in the top layer: an example's position: fixed info bubble must not get
       a containing block. */
    .panel {
      position: absolute;
      top: calc(100% + var(--ps-space-1));
      right: 0;
      z-index: 100;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 280px;
      max-width: calc(100vw - 2 * var(--ps-space-3));
      max-height: 50vh;
      overflow-x: hidden;
      overflow-y: auto;
      padding: var(--ps-space-3);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-lg);
      text-align: left;
      scrollbar-width: thin;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ps-space-1);
      min-height: var(--ps-control-sm);
      padding: var(--ps-space-1) var(--ps-space-3);
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      font: inherit;
      font-weight: var(--ps-weight-medium);
      cursor: pointer;
      transition: background-color var(--ps-duration-fast) var(--ps-ease);
    }

    .btn-primary {
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }

    .btn-secondary {
      border-color: var(--ps-border-strong);
      background: var(--ps-surface);
      color: var(--ps-text);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--ps-surface-hover);
    }

    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
];

export const importMenuStyles = [
  dataMenuStyles,
  css`
    .import-current-dataset {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-0-5);
      padding-bottom: var(--ps-space-3);
      margin-bottom: var(--ps-space-3);
      border-bottom: 1px solid var(--ps-border);
    }

    .import-current-dataset-label,
    .import-examples-label {
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .import-current-dataset-name {
      font-weight: var(--ps-weight-medium);
      line-height: var(--ps-leading-normal);
      word-break: break-word;
    }

    .import-actions {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
    }

    .import-actions > .btn {
      width: 100%;
    }

    .import-examples {
      margin-top: var(--ps-space-3);
      padding-top: var(--ps-space-3);
      border-top: 1px solid var(--ps-border);
    }

    .import-examples-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ps-space-2);
      margin-bottom: var(--ps-space-1);
    }

    .import-examples-docs {
      border-radius: var(--ps-radius-sm);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-medium);
      text-decoration: none;
      white-space: nowrap;
    }

    .import-examples-docs:hover {
      text-decoration: underline;
    }

    .import-examples-hint {
      margin: 0 0 var(--ps-space-2);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    /* An example item: its button, then its info popover as a sibling (never inside the button). */
    .import-example-row,
    .import-current-dataset-row {
      display: flex;
      align-items: center;
      gap: var(--ps-space-1);
    }

    .import-example-button {
      flex: 1 1 auto;
      min-width: 0;
      /* A long label wraps rather than being clipped behind the badge. */
      white-space: normal;
    }

    .import-example-label {
      min-width: 0;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .import-example-badge {
      flex: none;
      padding: 1px var(--ps-space-1);
      border: 1px solid var(--ps-accent-text);
      border-radius: var(--ps-radius-sm);
      color: var(--ps-accent-text);
      font-size: var(--ps-text-xs);
      font-weight: var(--ps-weight-semibold);
      line-height: 1;
      letter-spacing: 0.03em;
    }

    .import-example-info {
      flex: none;
    }
  `,
];
```

Create `packages/core/src/components/import-menu/import-menu.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../common/info-popover';
import { deepActiveElement, flatContains } from '../kit/focus';
import { icon } from '../kit/icon';
import { pushLayer } from '../kit/layers';
import { importMenuStyles } from './import-menu.styles';
import type { ExampleDatasetSummary } from './types';

/**
 * The Import menu: the dataset on screen, "Load your dataset" and the host's example catalog
 * (design decisions 1 and 9). Its panel is a layer of the kit's layer stack, so Escape and a press
 * outside close it and focus returns to the trigger. It only asks: `load-example-dataset` and
 * `open-file-dialog` are the host's to act on. Phase 4.8 rebuilds the panel on the kit.
 */
@customElement('protspace-import-menu')
export class ProtspaceImportMenu extends LitElement {
  static styles = importMenuStyles;

  /** The host's example catalog, listed under "Examples". */
  @property({ attribute: false }) exampleDatasets: readonly ExampleDatasetSummary[] = [];
  /** The host's page about its examples, linked from the "Examples" heading; no link when empty. */
  @property({ attribute: 'examples-docs-url' }) examplesDocsUrl = '';
  /** The dataset on screen, named at the top of the panel. */
  @property({ attribute: 'current-dataset-name' }) currentDatasetName = '';
  /** The example on screen, or null for a user import; its item is disabled. */
  @property({ attribute: 'current-example-id' }) currentExampleId: string | null = null;

  @state() private open = false;
  @query('.trigger') private trigger!: HTMLButtonElement;
  private releaseLayer?: () => void;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    this.open = false;
  }

  render() {
    return html`<button
        class="trigger"
        type="button"
        aria-label="Import"
        aria-haspopup="menu"
        aria-expanded=${String(this.open)}
        @click=${this.toggle}
      >
        ${icon('upload', 16)}<span part="trigger-label">Import</span>
      </button>
      ${this.open ? this.renderPanel() : nothing}`;
  }

  private renderPanel() {
    const current =
      this.currentExampleId === null
        ? undefined
        : this.exampleDatasets.find((example) => example.id === this.currentExampleId);
    return html`<div class="panel import-menu" role="menu" aria-label="Import">
      <div class="import-current-dataset">
        <span class="import-current-dataset-label">Current dataset</span>
        <div class="import-current-dataset-row">
          <span class="import-current-dataset-name">
            ${this.currentDatasetName || 'No dataset loaded'}
          </span>
          ${this.renderExampleInfo(current)}
        </div>
      </div>
      <div class="import-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-driver-id="import-own-dataset"
          @click=${this.openFileDialog}
        >
          Load your dataset
        </button>
      </div>
      ${this.exampleDatasets.length > 0 ? this.renderExamples() : nothing}
    </div>`;
  }

  private renderExamples() {
    return html`<div class="import-examples">
      <div class="import-examples-header">
        <span class="import-examples-label">Examples</span>
        ${this.examplesDocsUrl
          ? html`<a
              class="import-examples-docs"
              href=${this.examplesDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              >About these examples ↗</a
            >`
          : nothing}
      </div>
      <p class="import-examples-hint">Examples open in a curated view; your changes aren't kept.</p>
      <div class="import-actions">
        ${this.exampleDatasets.map(
          (example) =>
            html`<div class="import-example-row">
              <button
                type="button"
                class="btn btn-secondary import-example-button"
                data-driver-id="import-example-dataset"
                data-example-id=${example.id}
                ?disabled=${example.id === this.currentExampleId}
                @click=${() => this.loadExample(example.id)}
              >
                <span class="import-example-label">${example.label}</span>
                ${example.large ? html`<span class="import-example-badge">Large</span>` : nothing}
              </button>
              ${this.renderExampleInfo(example)}
            </div>`,
        )}
      </div>
    </div>`;
  }

  /**
   * An example's "ⓘ": its description, insight and docs link. A sibling of the item's button,
   * never inside it: interactive content inside a `<button>` is invalid, and a click on it would
   * load the example.
   */
  private renderExampleInfo(example: ExampleDatasetSummary | undefined) {
    if (!example) return nothing;
    return html`<protspace-info-popover
      class="import-example-info"
      placement="side"
      data-example-info=${example.id}
      .description=${example.description}
      .detail=${example.insight ?? ''}
      docs-url=${example.docsUrl ?? ''}
      label=${example.label}
    ></protspace-info-popover>`;
  }

  private toggle = () => {
    if (this.open) this.close();
    else this.show();
  };

  private show(): void {
    this.open = true;
    this.releaseLayer = pushLayer({ close: () => this.close(), elements: [this] });
    // Keyboard users land on the panel's first action, as in the control bar's menu.
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<HTMLButtonElement>('.import-menu button:not([disabled])')
        ?.focus(),
    );
  }

  /** Closes the panel; focus that was inside the menu goes back to the trigger. */
  private close(): void {
    if (!this.open) return;
    const focusWasInside = flatContains(this, deepActiveElement());
    this.open = false;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (focusWasInside) this.trigger.focus();
  }

  private openFileDialog = () => {
    // Dispatched inside the click, so the host's file picker keeps the user's activation.
    this.dispatchEvent(
      new CustomEvent('open-file-dialog', { detail: {}, bubbles: true, composed: true }),
    );
    this.close();
  };

  private loadExample(id: string): void {
    this.dispatchEvent(
      new CustomEvent('load-example-dataset', { detail: { id }, bubbles: true, composed: true }),
    );
    this.close();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-import-menu': ProtspaceImportMenu;
  }
}
```

Create `packages/core/src/components/export-menu/export-defaults.ts` (moved unchanged from `control-bar-helpers.ts`):

```ts
/**
 * Export default settings
 */
export const EXPORT_DEFAULTS = {
  FORMAT: 'png' as const,
  IMAGE_WIDTH: 2048,
  IMAGE_HEIGHT: 1024,
  LEGEND_WIDTH_PERCENT: 20,
  LEGEND_FONT_SIZE_PX: 15,
  BASE_FONT_SIZE: 24,
  MIN_LEGEND_FONT_SIZE_PX: 8,
  MAX_LEGEND_FONT_SIZE_PX: 120,
  LOCK_ASPECT_RATIO: true,
  INCLUDE_LEGEND: true,
};
```

Create `packages/core/src/components/export-menu/export-menu.styles.ts`:

```ts
import { css } from 'lit';
import { dataMenuStyles } from '../import-menu/import-menu.styles';

export const exportMenuStyles = [
  dataMenuStyles,
  css`
    .export-menu-header {
      padding-bottom: var(--ps-space-2);
      margin-bottom: var(--ps-space-3);
      border-bottom: 1px solid var(--ps-border);
      color: var(--ps-text-muted);
      font-weight: var(--ps-weight-medium);
    }

    .export-option-group {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
      margin-bottom: var(--ps-space-3);
    }

    .export-option-label {
      color: var(--ps-text-muted);
    }

    .export-format-options {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--ps-space-1);
    }

    .btn-compact {
      padding: var(--ps-space-1) var(--ps-space-2);
      font-size: var(--ps-text-sm);
    }

    .btn-secondary.active {
      border-color: var(--ps-accent);
      background: var(--ps-accent);
      color: var(--ps-text-on-accent);
    }

    .btn-secondary.active:hover:not(:disabled) {
      background: var(--ps-accent-hover);
    }

    .export-checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--ps-space-2);
      cursor: pointer;
      user-select: none;
    }

    .export-checkbox {
      flex: none;
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--ps-accent);
      cursor: pointer;
    }

    .export-parquet-help,
    .export-image-hint {
      margin-top: var(--ps-space-1);
      color: var(--ps-text-muted);
      font-size: var(--ps-text-xs);
      line-height: var(--ps-leading-normal);
    }

    .export-image-actions {
      display: flex;
      flex-direction: column;
      gap: var(--ps-space-1);
    }

    .export-image-actions > .btn,
    .export-action-btn {
      width: 100%;
    }
  `,
];
```

Create `packages/core/src/components/export-menu/export-menu.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { deepActiveElement, flatContains } from '../kit/focus';
import { icon } from '../kit/icon';
import { pushLayer } from '../kit/layers';
import '../kit/tooltip';
import { EXPORT_DEFAULTS } from './export-defaults';
import { exportMenuStyles } from './export-menu.styles';

/** What an `export` event asks the host to produce. */
export interface ExportEventDetail {
  type: 'png' | 'pdf' | 'ids' | 'parquet';
  imageWidth: number;
  imageHeight: number;
  legendWidthPercent: number;
  legendFontSizePx: number;
  includeLegend: boolean;
  includeLegendSettings: boolean;
}

const FORMATS: ReadonlyArray<{ value: ExportEventDetail['type']; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
  { value: 'ids', label: 'IDs' },
  { value: 'parquet', label: 'Parquet' },
];

/**
 * The Export menu: a format, then the figure editor or a quick export (design decisions 1, 9 and
 * 15). Its panel is a layer of the kit's layer stack, so Escape and a press outside close it and
 * focus returns to the trigger. It only asks: `export` and `open-publish-editor` are the host's to
 * act on. Phase 4.8 rebuilds the panel on the kit.
 */
@customElement('protspace-export-menu')
export class ProtspaceExportMenu extends LitElement {
  static styles = exportMenuStyles;

  /** The loaded file carries saved settings, which a Parquet export can carry on. */
  @property({ type: Boolean, attribute: 'has-file-settings' }) hasFileSettings = false;

  @state() private open = false;
  @state() private format: ExportEventDetail['type'] = EXPORT_DEFAULTS.FORMAT;
  @state() private includeLegendSettings = true;
  @query('.trigger') private trigger!: HTMLButtonElement;
  private releaseLayer?: () => void;

  /** Back to PNG with the legend settings included, as for a new dataset. */
  reset(): void {
    this.format = EXPORT_DEFAULTS.FORMAT;
    this.includeLegendSettings = true;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    this.open = false;
  }

  render() {
    return html`<button
        class="trigger"
        type="button"
        aria-label="Export"
        aria-expanded=${String(this.open)}
        @click=${this.toggle}
      >
        ${icon('download', 16)}<span part="trigger-label">Export</span>${icon('chevron-down', 14)}
      </button>
      ${this.hasFileSettings
        ? html`<ps-tooltip text="File contains custom settings"></ps-tooltip>`
        : nothing}
      ${this.open ? this.renderPanel() : nothing}`;
  }

  private renderPanel() {
    const image = this.format === 'png' || this.format === 'pdf';
    const formatName = this.format.toUpperCase();
    return html`<div class="panel export-menu">
      <div class="export-menu-header"><span>Export Options</span></div>
      <div class="export-option-group">
        <span class="export-option-label" id="export-format-label">Format</span>
        <div class="export-format-options" role="group" aria-labelledby="export-format-label">
          ${FORMATS.map(
            ({ value, label }) =>
              html`<button
                type="button"
                class="btn btn-secondary btn-compact ${value === this.format ? 'active' : ''}"
                aria-pressed=${String(value === this.format)}
                @click=${() => (this.format = value)}
              >
                ${label}
              </button>`,
          )}
        </div>
      </div>
      ${this.format === 'parquet'
        ? html`<div class="export-option-group">
            <label class="export-checkbox-label">
              <input
                type="checkbox"
                class="export-checkbox"
                .checked=${this.includeLegendSettings}
                @change=${(event: Event) =>
                  (this.includeLegendSettings = (event.target as HTMLInputElement).checked)}
              />
              <span>Include legend settings</span>
            </label>
            <div class="export-parquet-help">
              Legend customizations can be saved in the file and restored when loading.
            </div>
          </div>`
        : nothing}
      ${image
        ? html`<div class="export-image-actions">
              <button type="button" class="btn btn-primary" @click=${this.openFigureEditor}>
                ${icon('square-pen', 16)} Figure Editor
              </button>
              <button type="button" class="btn btn-secondary" @click=${this.exportNow}>
                ${icon('download', 16)} Quick Export ${formatName}
              </button>
            </div>
            <div class="export-image-hint">
              Figure Editor offers live preview, journal presets, annotations, and more.
            </div>`
        : html`<button
            type="button"
            class="btn btn-primary export-action-btn"
            @click=${this.exportNow}
          >
            ${icon('download', 16)} Export ${formatName}
          </button>`}
    </div>`;
  }

  private toggle = () => {
    if (this.open) this.close();
    else this.show();
  };

  private show(): void {
    this.open = true;
    this.releaseLayer = pushLayer({ close: () => this.close(), elements: [this] });
    // Keyboard users land on the first format, as in the control bar's menu.
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLButtonElement>('.export-format-options button')?.focus(),
    );
  }

  /** Closes the panel; focus that was inside the menu goes back to the trigger. */
  private close(): void {
    if (!this.open) return;
    const focusWasInside = flatContains(this, deepActiveElement());
    this.open = false;
    this.releaseLayer?.();
    this.releaseLayer = undefined;
    if (focusWasInside) this.trigger.focus();
  }

  private exportNow = () => {
    const detail: ExportEventDetail = {
      type: this.format,
      imageWidth: EXPORT_DEFAULTS.IMAGE_WIDTH,
      imageHeight: EXPORT_DEFAULTS.IMAGE_HEIGHT,
      legendWidthPercent: EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT,
      legendFontSizePx: EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX,
      includeLegend: EXPORT_DEFAULTS.INCLUDE_LEGEND,
      includeLegendSettings: this.includeLegendSettings,
    };
    this.dispatchEvent(
      new CustomEvent<ExportEventDetail>('export', { detail, bubbles: true, composed: true }),
    );
    this.close();
  };

  private openFigureEditor = () => {
    this.dispatchEvent(
      new CustomEvent('open-publish-editor', { detail: {}, bubbles: true, composed: true }),
    );
    this.close();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-export-menu': ProtspaceExportMenu;
  }
}
```

In `packages/core/src/components/data-loader/data-loader.ts`, add this method between `render()` and `handleFileSelect`:

```ts
  /**
   * Opens the browser's file picker on the loader's own file input. Browsers open it only inside a
   * user gesture, so call it from the click or key press that asked for it.
   */
  openFilePicker(): void {
    this.renderRoot.querySelector<HTMLInputElement>('input[type="file"]')?.click();
  }
```

- [ ] **Step 4: Run the new core tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/import-menu src/components/export-menu src/components/data-loader/data-loader.handler.test.ts`
Expected: PASS: 8 import-menu tests, 7 export-menu tests plus the 10 `EXPORT_DEFAULTS` cases, and 3 data-loader handler tests.

- [ ] **Step 5: Take Import and Export out of the control bar**

In `packages/core/src/components/control-bar/control-bar.ts`:

1. In the `import type { … } from './types';` block, delete the lines `  ExampleDatasetSummary,` and `  DataLoaderElement,`.
2. Replace

```ts
import {
  EXPORT_DEFAULTS,
  toggleProteinSelection,
  mergeProteinSelections,
} from './control-bar-helpers';
```

with `import { toggleProteinSelection, mergeProteinSelections } from './control-bar-helpers';`, and delete the line `import '../common/info-popover';` (`annotation-select.ts` imports it for itself).
3. Delete the properties from `  @property({ type: Boolean, attribute: 'has-file-settings' })` through `  @property({ type: String, attribute: 'examples-docs-url' }) examplesDocsUrl = '';` (:100-113: `hasFileSettings`, `currentDatasetName`, `currentExampleId`, `exampleDatasets`, `examplesDocsUrl` and their comments).
4. Delete the lines `  @state() private showExportMenu: boolean = false;` and `  @state() private showImportMenu: boolean = false;`, and the three lines

```ts
  // Export configuration state
  @state() private exportFormat: 'png' | 'pdf' | 'ids' | 'parquet' = EXPORT_DEFAULTS.FORMAT;
  @state() private exportIncludeLegendSettings: boolean = true;
```

5. In `_onAnnotationOpened` and `_onSearchOpened`, delete the lines `    this.showExportMenu = false;` and `    this.showImportMenu = false;` (two of each).
6. Replace the signature `  private closeOtherDropdowns(except: 'projection' | 'filter' | 'export' | 'import' | 'density') {` with `  private closeOtherDropdowns(except: 'projection' | 'filter' | 'density') {`, and delete its lines `    if (except !== 'export') this.showExportMenu = false;` and `    if (except !== 'import') this.showImportMenu = false;`.
7. Delete the methods `handleExport`, `handleOpenPublishEditor`, `toggleExportMenu`, `toggleImportMenu`, `handleExportKeydown` and `handleImportKeydown` (from `  private handleExport() {` through the closing `}` of `handleImportKeydown`, :590-678).
8. Replace `clearForNewDataset` (:680-689) with:

```ts
  public clearForNewDataset(): void {
    this._cancelPendingCommits();
    // A new dataset has different protein ids, so any active filter is stale. Clear
    // the badge/query here (the canonical per-dataset reset hook); the scatter plot's
    // filter channel is reset in parallel by applyPlotState.
    this.filterQuery = [];
    this.filterActive = false;
    this._lastMirroredState.clear();
  }
```

9. Delete `openFileDialog`, `handleLoadExampleDataset` and `renderExampleInfo` with its doc comment (from `  private openFileDialog() {` through the closing `}` of `renderExampleInfo`, :691-727).
10. At the top of `render()`, delete the four lines from `    const currentExample =` through `        : this.exampleDatasets.find((example) => example.id === this.currentExampleId);`.
11. In the markup, replace `          <div class="data-actions-group" data-driver-id="data-actions">` with `          <div class="data-actions-group">` (the tour's "data actions" are the app bar's now). Keep the comment `<!-- Filter / Export / Import group -->` above it as it is: Task 2.6 deletes the group by it. Then delete everything from the blank line before `            <!-- Export dropdown -->` through the `            </div>` that closes `<div class="export-container right-controls-data" data-driver-id="import">` (the line before the `          </div>` that closes `.data-actions-group`). The group then holds only the filter container:

```ts
          <!-- Filter / Export / Import group -->
          <div class="data-actions-group">
            <div class="filter-container right-controls-filter">
              …unchanged filter button…
            </div>
          </div>
        </div>
      </div>
```

12. In `handleDocumentKeydown`, replace

```ts
        isAnyDropdownOpen({
          projection: this.showProjectionMenu,
          export: this.showExportMenu,
          import: this.showImportMenu,
          density: this.showDensityMenu,
        })
```

with:

```ts
        isAnyDropdownOpen({
          projection: this.showProjectionMenu,
          density: this.showDensityMenu,
        })
```

(an Escape that closes the Import or Export panel never reaches this listener: the layer stack consumes it).
13. In `handleDocumentClick`, delete the lines `      this.shadowRoot?.querySelector('.export-menu'), // Export` and `      this.shadowRoot?.querySelector('.import-menu'), // Import`, and the lines `      this.showExportMenu = false;` and `      this.showImportMenu = false;` under `// Close control-bar dropdowns`.

Run: `grep -n "Export\b\|Import\b\|exportFormat\|showExportMenu\|showImportMenu\|exampleDatasets\|currentDatasetName\|currentExampleId\|hasFileSettings\|EXPORT_DEFAULTS\|data-actions\|data-driver-id=\"import\"" packages/core/src/components/control-bar/control-bar.ts`
Expected: one line, the `<!-- Filter / Export / Import group -->` comment.

In `packages/core/src/components/control-bar/control-bar.styles.ts`, delete the line `import { exportStyles } from './styles/export';` and the entry `  exportStyles,` from `controlBarStyles`. Delete the now-empty module: `rm packages/core/src/components/control-bar/styles/export.ts` (its rules live in the two menus' styles), and delete its line from `LEGACY` in `packages/core/src/styles/style-lint.test.ts`:

```ts
  '../components/control-bar/styles/export.ts',
```

In `packages/core/src/components/control-bar/control-bar-helpers.ts`, delete the `EXPORT_DEFAULTS` block (from `/**` ` * Export default settings` through the closing `};` and the blank line after it). In `control-bar-helpers.test.ts`, remove `  EXPORT_DEFAULTS,` from the import and delete the whole `  describe('EXPORT_DEFAULTS', () => {` block (:11-91, through its closing `  });` and the blank line after it, so `  describe('shouldDisableSelection', () => {` follows `describe('control-bar-helpers', () => {`); its cases now run in `export-menu.test.ts`.

In `packages/core/src/components/control-bar/types.ts`, delete `ExampleDatasetSummary` (its doc comment and interface) and the now-unused

```ts
export interface DataLoaderElement extends Element {
  requestLoad?: () => void;
}
```

Delete the ported test: `rm packages/core/src/components/control-bar/control-bar.import-menu.test.ts`.

In `packages/core/src/index.ts`, replace

```ts
export { EXPORT_DEFAULTS } from './components/control-bar/control-bar-helpers';
```

with:

```ts
export { ProtspaceImportMenu } from './components/import-menu/import-menu';
export { ProtspaceExportMenu, type ExportEventDetail } from './components/export-menu/export-menu';
export { EXPORT_DEFAULTS } from './components/export-menu/export-defaults';
```

and `export type { ExampleDatasetSummary } from './components/control-bar/types';` with `export type { ExampleDatasetSummary } from './components/import-menu/types';`.

- [ ] **Step 6: Run the core tests and build core**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar src/components/import-menu src/components/export-menu src/components/data-loader src/styles src/components/legend`
Expected: PASS. The style lint covers the two new style modules as clean (they are not in `LEGACY`), no longer lists `styles/export.ts`, and `styles-integrity.test.ts` finds real CSS in both new modules; the legend's scatterplot harness, which mounts a bare control bar, is unaffected.

Run: `pnpm --filter @protspace/core build 2>&1 | tail -3`
Expected: the build succeeds (the app's unit tests and type-check read core's `dist`).

- [ ] **Step 7: Write the failing app tests**

Create `apps/web/src/explore/import-controller.test.ts` (ported from `control-bar-events.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';
import { bindImportMenu } from './import-controller';

/** Binds the Import menu's listeners to a plain event target, with a spied loader and controller. */
function bind() {
  const importMenu = new EventTarget();
  const dataLoader = { openFilePicker: vi.fn() };
  const datasetController = {
    loadExampleDatasetAndClearPersistedFile: vi.fn().mockResolvedValue('loaded'),
  };
  bindImportMenu({
    listen: (type, listener) => importMenu.addEventListener(type, listener),
    dataLoader,
    datasetController,
  });
  return { importMenu, dataLoader, datasetController };
}

describe('the Import menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the example the event names, as a menu choice', () => {
    const { importMenu, datasetController } = bind();
    const entry = EXAMPLE_DATASETS[1];

    importMenu.dispatchEvent(new CustomEvent('load-example-dataset', { detail: { id: entry.id } }));

    expect(datasetController.loadExampleDatasetAndClearPersistedFile).toHaveBeenCalledWith(
      entry,
      'menu',
    );
  });

  it('warns on an unknown id and does nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { importMenu, datasetController } = bind();

    importMenu.dispatchEvent(
      new CustomEvent('load-example-dataset', { detail: { id: 'not-a-real-id' } }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-id'));

    // An event that names no example warns as well, rather than throwing.
    expect(() => importMenu.dispatchEvent(new CustomEvent('load-example-dataset'))).not.toThrow();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Unknown example dataset id'));
    expect(datasetController.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
  });

  it("open-file-dialog opens the data loader's file picker", () => {
    const { importMenu, dataLoader } = bind();

    importMenu.dispatchEvent(new CustomEvent('open-file-dialog', { detail: {} }));

    expect(dataLoader.openFilePicker).toHaveBeenCalledOnce();
  });
});
```

Replace the whole of `apps/web/src/explore/control-bar-events.test.ts` with (the example choice moved to the Import menu's tests; what the control bar still sends stays covered):

```ts
import { describe, expect, it, vi } from 'vitest';
import { bindControlBarEvents } from './control-bar-events';

/** Binds the control-bar listeners to a plain event target, with spied controllers. */
function bind() {
  const controlBar = new EventTarget();
  const interactionController = { handleAnnotationChange: vi.fn() };
  const viewController = {
    handleUserAnnotationChange: vi.fn(),
    handleUserProjectionChange: vi.fn(),
    handleUserTooltipAnnotationsChange: vi.fn(),
    handleUserDensityLayerChange: vi.fn(),
  };
  bindControlBarEvents({
    addControlBarListener: (type, listener, options) =>
      controlBar.addEventListener(type, listener, options),
    interactionController: interactionController as never,
    viewController: viewController as never,
  });
  return { controlBar, interactionController, viewController };
}

describe('the control bar events', () => {
  it('an annotation change reaches the interaction and view controllers', () => {
    const { controlBar, interactionController, viewController } = bind();

    controlBar.dispatchEvent(new CustomEvent('annotation-change', { detail: { annotation: 'ec' } }));

    expect(interactionController.handleAnnotationChange).toHaveBeenCalledOnce();
    expect(viewController.handleUserAnnotationChange).toHaveBeenCalledOnce();
  });
});
```

In `apps/web/src/explore/data-renderer.test.ts`:

1. Add `import type { InitialView } from './explore-controls';` after `import { createDataRenderer, resolveRenderableView } from './data-renderer';`.
2. Replace `buildRenderer` with:

```ts
  function buildRenderer(
    controls: Parameters<typeof createDataRenderer>[0]['controls'] = {
      showInitialView: vi.fn(),
      setRendering: vi.fn(),
      clearStructure: vi.fn(),
    },
  ) {
    const overlayUpdate = vi.fn();
    const loadData = createDataRenderer({
      controls,
      getIsDisposed: () => false,
      interactionController: { updateLegend: vi.fn() },
      legendElement: {},
      overlayController: { update: overlayUpdate },
      plotElement: { clearIsolationState: vi.fn(), requestUpdate: vi.fn(), config: {} },
      resolveInitialView: (): null => null,
    } as unknown as Parameters<typeof createDataRenderer>[0]);
    return { loadData, overlayUpdate };
  }
```

3. Append inside the `describe('loadData overlay handling', …)` block, after its last test:

```ts
  it('a new dataset resets the controls and shows its initial view', async () => {
    const calls: string[] = [];
    const { loadData } = buildRenderer({
      showInitialView: vi.fn((view: InitialView) =>
        calls.push(['view', view.projection, view.annotation, ...view.tooltip].join(' ')),
      ),
      setRendering: vi.fn((rendering: boolean) => calls.push(`rendering ${rendering}`)),
      clearStructure: vi.fn(() => calls.push('clear structure')),
    });

    const pending = loadData(datasetOf(10));
    await vi.runAllTimersAsync();
    await pending;

    // The controls stop syncing while the plot swaps data, show the new view without events,
    // sync again, and the previous dataset's structure goes.
    expect(calls).toEqual(['rendering true', 'view umap ec', 'rendering false', 'clear structure']);
  });
```

In `apps/web/src/explore/dataset-controller.fixtures.ts`, replace the option line (:53)

```ts
    controlBar: { clearForNewDataset: vi.fn(), hasFileSettings: false },
```

with:

```ts
    controls: {
      resetForNewDataset: vi.fn(),
      setHasFileSettings: vi.fn(),
      showInitialView: vi.fn(),
      setRendering: vi.fn(),
      clearStructure: vi.fn(),
    },
```

and delete the line `    structureViewer: {},` (:75).

In `apps/web/src/explore/dataset-controller.eat.test.ts`:

1. Add, after the `import { createDatasetController } from './dataset-controller';` line:

```ts
/** The controls a new dataset resets and fills, spied. */
function createControls() {
  return {
    resetForNewDataset: vi.fn(),
    setHasFileSettings: vi.fn(),
    showInitialView: vi.fn(),
    setRendering: vi.fn(),
    clearStructure: vi.fn(),
  };
}
```

2. In "applies embedded EAT settings after an OPFS reload…", replace

```ts
    const controlBar = {
      clearForNewDataset: vi.fn(),
      hasFileSettings: false,
    };
```

with `const controls = createControls();`, the option `controlBar,` with `controls,`, `expect(controlBar.clearForNewDataset).toHaveBeenCalledOnce();` with `expect(controls.resetForNewDataset).toHaveBeenCalledOnce();`, and `expect(controlBar.hasFileSettings).toBe(true);` with `expect(controls.setHasFileSettings).toHaveBeenLastCalledWith(true);`.
3. In "applies a bundle shape size after the legend settings of a user import", replace `const controlBar = { clearForNewDataset: vi.fn(), hasFileSettings: false };` with `const controls = createControls();`, the option `controlBar,` with `controls,`, and `expect(controlBar.hasFileSettings).toBe(true);` with `expect(controls.setHasFileSettings).toHaveBeenLastCalledWith(true);`.
4. Append inside the `describe` block:

```ts
  it('bundle settings report hasFileSettings', async () => {
    const controls = createControls();
    const controller = createDatasetController(
      buildControllerOptions({
        controls,
        plotElement: { eatOverlayEnabled: true },
        loadQueue: {
          getRunningLoadMeta: () => ({ sequence: 4, kind: 'user' }),
          getLatestSequence: () => 4,
        },
      }),
    );

    await controller.handleDataLoaded(
      dataLoadedEvent({
        settings: { legendSettings: { ec: { categories: {} } }, exportOptions: {} },
        source: 'user',
      }),
    );
    expect(controls.resetForNewDataset).toHaveBeenCalledOnce();
    expect(controls.setHasFileSettings).toHaveBeenLastCalledWith(true);

    // Settings that hold nothing, and no settings at all, are no file settings.
    await controller.handleDataLoaded(
      dataLoadedEvent({ settings: { legendSettings: {}, exportOptions: {} }, source: 'user' }),
    );
    expect(controls.setHasFileSettings).toHaveBeenLastCalledWith(false);
    await controller.handleDataLoaded(dataLoadedEvent({ source: 'user' }));
    expect(controls.setHasFileSettings).toHaveBeenLastCalledWith(false);
  });
```

- [ ] **Step 8: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/import-controller.test.ts src/explore/control-bar-events.test.ts src/explore/data-renderer.test.ts src/explore/dataset-controller.eat.test.ts`
Expected: FAIL: `./import-controller` and `./explore-controls` do not resolve; the data-renderer cases throw on the missing `controlBar` (`Cannot set properties of undefined (setting 'autoSync')`); the dataset-controller cases fail on `controlBar.clearForNewDataset` (undefined); `control-bar-events.test.ts` passes already (its listener is unchanged).

- [ ] **Step 9: Write the seam and rewire the runtime**

Create `apps/web/src/explore/explore-controls.ts`:

```ts
/** The view a new dataset opens on, as the data renderer resolved it. */
export interface InitialView {
  projection: string;
  annotation: string;
  tooltip: readonly string[];
}

/**
 * The dataset pipeline's one seam to the controls (design decision 9). `dataset-controller.ts` and
 * `data-renderer.ts` reset and fill the controls only through this, and `runtime.ts` builds the one
 * implementation, which changes as the control bar is split while the pipeline does not.
 */
export interface ExploreControls {
  /** A new dataset is on its way: drop per-dataset control state (waiting picks, export format). */
  resetForNewDataset(): void;
  /** The loaded file carries settings that a Parquet export can keep. */
  setHasFileSettings(value: boolean): void;
  /** Show the new dataset's view in the controls, without change events. */
  showInitialView(view: InitialView): void;
  /** True while the renderer swaps the plot's data, when the controls must not sync from it. */
  setRendering(rendering: boolean): void;
  /** Close the previous dataset's structure. */
  clearStructure(): void;
}
```

Create `apps/web/src/explore/import-controller.ts`:

```ts
import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import type { DatasetController } from './dataset-controller';
import { findExampleDataset } from './example-datasets';

interface ImportMenuOptions {
  /** Adds a listener on the Import menu for as long as the runtime lives. */
  listen(type: string, listener: EventListener): void;
  dataLoader: Pick<ProtspaceDataLoader, 'openFilePicker'>;
  datasetController: Pick<DatasetController, 'loadExampleDatasetAndClearPersistedFile'>;
}

/**
 * The Import menu's two choices: an example loads in place of the stored import, as a menu
 * choice, and "Load your dataset" opens the data loader's file picker.
 */
export function bindImportMenu({ listen, dataLoader, datasetController }: ImportMenuOptions): void {
  // This event name is part of the import menu's contract in @protspace/core.
  listen('load-example-dataset', (event) => {
    // A dispatch without a detail names no example: warn rather than throw.
    const id = (event as CustomEvent<{ id?: string } | null>).detail?.id;
    const entry = id === undefined ? undefined : findExampleDataset(id);
    if (!entry) {
      console.warn(`Unknown example dataset id: ${id}`);
      return;
    }
    void datasetController.loadExampleDatasetAndClearPersistedFile(entry, 'menu');
  });
  // Runs inside the menu's click, so the browser lets the picker open.
  listen('open-file-dialog', () => dataLoader.openFilePicker());
}
```

In `apps/web/src/explore/control-bar-events.ts`, delete the imports `import { findExampleDataset } from './example-datasets';` and `import type { DatasetController } from './dataset-controller';`, delete the options `  datasetController: DatasetController;` and `  handleExport(event: Event): Promise<void>;` from `ControlBarEventsOptions` and from the destructured parameters of `bindControlBarEvents`, and delete the two listeners at its end (from `  // This event name is part of the control-bar custom element contract in @protspace/core.` through the closing `});` of the `'export'` listener).

In `apps/web/src/explore/export-handler.ts`, replace `import type { ProtspaceControlBar, ProtspaceLegend, ProtspaceScatterplot } from '@protspace/core';` with `import type { ProtspaceExportMenu, ProtspaceLegend, ProtspaceScatterplot } from '@protspace/core';`; in `ExportHandlerOptions` replace `  controlBar: ProtspaceControlBar;` with:

```ts
  /** The Export menu, whose Figure Editor item asks for the publish modal. */
  exportMenu: ProtspaceExportMenu;
```

in `createExportHandler`'s parameters replace `  controlBar,` with `  exportMenu,`, and in `setupPublishEditorHandler` replace `    controlBar.addEventListener('open-publish-editor', async () => {` with `    exportMenu.addEventListener('open-publish-editor', async () => {`.

In `apps/web/src/explore/data-renderer.ts`:

1. Replace the core type import

```ts
import type {
  ProtspaceControlBar,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
} from '@protspace/core';
```

with:

```ts
import type { ProtspaceLegend, ProtspaceScatterplot } from '@protspace/core';
```

and add `import type { ExploreControls } from './explore-controls';` before `import type { InteractionController } from './interaction-controller';`.
2. In `DataRendererOptions`, replace `  controlBar: ProtspaceControlBar;` with

```ts
  /** The controls the renderer pauses and fills while it swaps the plot's data. */
  controls: Pick<ExploreControls, 'showInitialView' | 'setRendering' | 'clearStructure'>;
```

and delete `  structureViewer: ProtspaceStructureViewer;`.
3. Delete `applyControlBarState` (from `function applyControlBarState(controlBar: ProtspaceControlBar, initialView: ResolvedInitialView) {` through its closing `}`).
4. In `createDataRenderer`'s parameters replace `  controlBar,` with `  controls,` and delete `  structureViewer,`.
5. In `loadData`, replace `    controlBar.autoSync = false;` with `    controls.setRendering(true);`, replace `    applyControlBarState(controlBar, resolvedInitialView);` with

```ts
    controls.showInitialView({
      projection: resolvedInitialView.projectionName,
      annotation: resolvedInitialView.annotation,
      tooltip: resolvedInitialView.tooltip,
    });
```

replace `    controlBar.autoSync = true;` with `    controls.setRendering(false);`, and replace

```ts
    if (structureViewer.style.display !== 'none') {
      structureViewer.style.display = 'none';
    }
```

with `    controls.clearStructure();`.

In `apps/web/src/explore/dataset-controller.ts`:

1. In the `@protspace/core` type import, delete the lines `  ProtspaceControlBar,` and `  ProtspaceStructureViewer,`, and add `import type { ExploreControls } from './explore-controls';` after `import { DEFAULT_EXAMPLE_DATASET, type ExampleDataset } from './example-datasets';`.
2. In `DatasetControllerOptions`, replace `  controlBar: ProtspaceControlBar;` with

```ts
  /** The controls a new dataset resets and fills; `runtime.ts` builds them. */
  controls: ExploreControls;
```

and delete `  structureViewer: ProtspaceStructureViewer;`.
3. In `createDatasetController`'s parameters replace `  controlBar,` with `  controls,` and delete `  structureViewer,`; in its `createDataRenderer({ … })` call replace `    controlBar,` with `    controls,` and delete `    structureViewer,`.
4. Replace `      controlBar.clearForNewDataset(datasetHash, shouldClearPersistedState);` with `      controls.resetForNewDataset();`.
5. Replace

```ts
      controlBar.hasFileSettings =
        settings != null &&
        (Object.keys(settings.legendSettings).length > 0 ||
          settings.eatOverlayEnabled !== undefined ||
          settings.eatConfidenceThreshold !== undefined ||
          settings.shapeSize !== undefined);
```

with:

```ts
      controls.setHasFileSettings(
        settings != null &&
          (Object.keys(settings.legendSettings).length > 0 ||
            settings.eatOverlayEnabled !== undefined ||
            settings.eatConfidenceThreshold !== undefined ||
            settings.shapeSize !== undefined),
      );
```

In `apps/web/src/explore/elements.ts`, replace the whole file with:

```ts
import type {
  ProtspaceControlBar,
  ProtspaceExportMenu,
  ProtspaceImportMenu,
  ProtspaceLegend,
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  DataLoader as ProtspaceDataLoader,
} from '@protspace/core';

interface ExploreElements {
  controlBar: ProtspaceControlBar;
  dataLoader: ProtspaceDataLoader;
  exportMenu: ProtspaceExportMenu;
  importMenu: ProtspaceImportMenu;
  legendElement: ProtspaceLegend;
  plotElement: ProtspaceScatterplot;
  structureViewer: ProtspaceStructureViewer;
}

const REQUIRED_TAGS = [
  'protspace-scatterplot',
  'protspace-legend',
  'protspace-structure-viewer',
  'protspace-control-bar',
  'protspace-data-loader',
  'protspace-import-menu',
  'protspace-export-menu',
] as const;

export async function waitForElements(): Promise<void> {
  await Promise.all(REQUIRED_TAGS.map((tagName) => customElements.whenDefined(tagName)));
}

export function getElements(doc: Document = document): ExploreElements | null {
  const plotElement = doc.getElementById('myPlot') as ProtspaceScatterplot | null;
  const legendElement = doc.getElementById('myLegend') as ProtspaceLegend | null;
  const structureViewer = doc.getElementById(
    'myStructureViewer',
  ) as ProtspaceStructureViewer | null;
  const controlBar = doc.getElementById('myControlBar') as ProtspaceControlBar | null;
  const dataLoader = doc.getElementById('myDataLoader') as ProtspaceDataLoader | null;
  const importMenu = doc.getElementById('myImportMenu') as ProtspaceImportMenu | null;
  const exportMenu = doc.getElementById('myExportMenu') as ProtspaceExportMenu | null;

  if (
    !plotElement ||
    !legendElement ||
    !structureViewer ||
    !controlBar ||
    !dataLoader ||
    !importMenu ||
    !exportMenu
  ) {
    console.error('Could not find one or more required explore elements.', {
      plotElement,
      legendElement,
      structureViewer,
      controlBar,
      dataLoader,
      importMenu,
      exportMenu,
    });
    return null;
  }

  return {
    controlBar,
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    plotElement,
    structureViewer,
  };
}
```

In `apps/web/src/explore/runtime.ts`:

1. Add `import type { ExploreControls } from './explore-controls';` and `import { bindImportMenu } from './import-controller';` after `import { createExportHandler } from './export-handler';`.
2. Replace `  const { controlBar, dataLoader, legendElement, plotElement, structureViewer } = elements;` with

```ts
  const {
    controlBar,
    dataLoader,
    exportMenu,
    importMenu,
    legendElement,
    plotElement,
    structureViewer,
  } = elements;
```

3. Replace `  controlBar.exampleDatasets = EXAMPLE_DATASETS.map(toExampleDatasetSummary);` and `  controlBar.examplesDocsUrl = EXAMPLES_DOCS_URL;` with `  importMenu.exampleDatasets = EXAMPLE_DATASETS.map(toExampleDatasetSummary);` and `  importMenu.examplesDocsUrl = EXAMPLES_DOCS_URL;`; in `setCurrentDatasetName` replace `    controlBar.currentDatasetName = name;` with `    importMenu.currentDatasetName = name;`; in `setCurrentExampleId` replace `    controlBar.currentExampleId = id;` with `    importMenu.currentExampleId = id;`.
4. Directly above `  const datasetController = createDatasetController({`, add:

```ts
  // The dataset pipeline's one seam to the controls (explore-controls.ts). Until the control bar
  // is split up, most of it is still the control bar.
  const controls: ExploreControls = {
    resetForNewDataset() {
      controlBar.clearForNewDataset();
      exportMenu.reset();
    },
    setHasFileSettings(value) {
      exportMenu.hasFileSettings = value;
    },
    showInitialView(view) {
      controlBar.selectedProjection = view.projection;
      controlBar.selectedAnnotation = view.annotation;
      controlBar.tooltipAnnotations = [...view.tooltip];
      controlBar.selectionMode = false;
      controlBar.selectedProteinsCount = 0;
      controlBar.requestUpdate();
    },
    setRendering(rendering) {
      controlBar.autoSync = !rendering;
    },
    clearStructure() {
      if (structureViewer.style.display !== 'none') {
        structureViewer.style.display = 'none';
      }
    },
  };

```

5. In the `createDatasetController({ … })` options, replace `    controlBar,` with `    controls,` and delete `    structureViewer,`.
6. In the `createExportHandler({ … })` options, replace `    controlBar,` with `    exportMenu,`.
7. Replace the `bindControlBarEvents({ … });` call with:

```ts
  addTrackedEventListener(lifecycle, exportMenu, 'export', (event: Event) => {
    void handleExport(event);
  });
  bindImportMenu({
    listen(type, listener) {
      addTrackedEventListener(lifecycle, importMenu, type, listener);
    },
    dataLoader,
    datasetController,
  });
  bindControlBarEvents({
    addControlBarListener(type, listener, options) {
      addTrackedEventListener(lifecycle, controlBar, type, listener, options);
    },
    interactionController,
    viewController,
  });
```

- [ ] **Step 10: Run the app's unit tests**

Run: `pnpm --filter @protspace/app exec vitest --run 2>&1 | tail -4`
Expected: PASS, every file: `import-controller.test.ts` (3), `control-bar-events.test.ts` (1), `data-renderer.test.ts` (one test more), `dataset-controller.eat.test.ts` (3), and the other dataset-controller files through the updated fixtures.

Run: `pnpm --filter @protspace/app type-check 2>&1 | tail -3`
Expected: no errors (core's rebuilt `dist` declares `ProtspaceImportMenu`, `ProtspaceExportMenu` and `DataLoader.openFilePicker`).

- [ ] **Step 11: Write the failing e2e spec and point the helpers at the menus**

Create `apps/web/tests/workbench-import-export.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import {
  appBar,
  exportMenu,
  importMenu,
  importTrigger,
  openExplore,
  openExportMenu,
  openImportMenu,
} from './helpers/explore';

/** The Import and Export menus in the app bar (Task 2.5). */

test.describe('Import and Export menus', () => {
  test('Import and Export sit in the app bar and work from the keyboard', async ({ page }) => {
    await openExplore(page);
    const actions = appBar(page).locator('[data-driver-id="data-actions"]');
    await expect(actions.locator('#myImportMenu')).toBeVisible();
    await expect(actions.locator('#myExportMenu')).toBeVisible();
    // The tour's Import step finds the menu itself, in the light DOM.
    await expect(page.locator('[data-driver-id="import"]')).toHaveAttribute('id', 'myImportMenu');

    await importTrigger(page).focus();
    await page.keyboard.press('Enter');
    const ownDataset = importMenu(page).locator('[data-driver-id="import-own-dataset"]');
    await expect(ownDataset).toBeFocused();
    await expect(importTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(ownDataset).toHaveCount(0);
    await expect(importTrigger(page)).toBeFocused();

    const exportTrigger = exportMenu(page).getByRole('button', { name: 'Export', exact: true });
    await exportTrigger.focus();
    await page.keyboard.press('Enter');
    const png = exportMenu(page).getByRole('button', { name: 'PNG', exact: true });
    await expect(png).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(png).toHaveCount(0);
    await expect(exportTrigger).toBeFocused();
  });

  test('Load your dataset opens the file chooser', async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);

    const chooser = page.waitForEvent('filechooser');
    await importMenu(page).locator('[data-driver-id="import-own-dataset"]').click();
    expect((await chooser).isMultiple()).toBe(false);
    await expect(importMenu(page).locator('.import-menu')).toHaveCount(0);
  });

  test("an example's info bubble is fully visible and topmost", async ({ page }) => {
    await openExplore(page);
    await openImportMenu(page);
    const info = importMenu(page).locator(
      `.import-examples [data-example-info="${EXAMPLE_DATASETS[1].id}"]`,
    );
    await info.locator('.info-button').click();
    const bubble = info.locator('.popover');
    await expect(bubble).toBeVisible();

    const placement = await bubble.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // The deepest element at the bubble's centre, looking through every shadow root on the way.
      let hit: Element | null = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      return {
        onScreen:
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= window.innerWidth &&
          box.bottom <= window.innerHeight,
        topmost: hit !== null && element.contains(hit),
      };
    });
    expect(placement).toEqual({ onScreen: true, topmost: true });
  });

  test('Quick export PNG downloads a file', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);

    const download = page.waitForEvent('download');
    await exportMenu(page).getByRole('button', { name: 'Quick Export PNG' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    await expect(exportMenu(page).getByRole('button', { name: 'PNG', exact: true })).toHaveCount(0);
  });

  test('the figure editor opens from Export', async ({ page }) => {
    await openExplore(page);
    await openExportMenu(page);

    await exportMenu(page).getByRole('button', { name: 'Figure Editor' }).click();
    await expect(page.locator('protspace-publish-modal')).toBeAttached();
  });
});
```

In `apps/web/tests/helpers/explore.ts`, replace the three locators

```ts
/** The Import menu's trigger. */
export const importTrigger = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: 'Import', exact: true });

/** The element that holds the Import panel: today the control bar. */
export const importMenu = (page: Page): Locator => page.locator('protspace-control-bar');

/** The element that holds the Export panel: today the control bar. */
export const exportMenu = (page: Page): Locator => page.locator('protspace-control-bar');
```

with:

```ts
/** The Import menu's trigger, in the app bar. */
export const importTrigger = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Import', exact: true });

/** The element that holds the Import panel. */
export const importMenu = (page: Page): Locator => page.locator('#myImportMenu');

/** The element that holds the Export panel. */
export const exportMenu = (page: Page): Locator => page.locator('#myExportMenu');
```

`openImportMenu`, `openExportMenu` and `pickExample` are written against these three locators and need no other change: the Import panel still holds `[data-driver-id="import-own-dataset"]` and `[data-example-id]`, and the Export menu's trigger is still a button named "Export" next to format buttons named "PNG" and so on.

In `apps/web/tests/dataset-reload.spec.ts`, retarget the two export dispatches: in "successful parquet exports show the unified success toast" and "failed exports show the unified error toast", replace `await dispatchCustomEvent(page, '#myControlBar', 'export', {` with `await dispatchCustomEvent(page, '#myExportMenu', 'export', {` (the `selection-disabled-notification` dispatch on `#myControlBar` stays until Task 2.9).

- [ ] **Step 12: Run them to see them fail**

Run (sandbox disabled: it starts a server): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-import-export`
Expected: FAIL: every test times out waiting for `#myImportMenu` or `#myExportMenu`, which the app bar does not render yet. (The runtime would also return its no-op controller, as `getElements` now requires both menus.)

- [ ] **Step 13: Put the menus in the app bar and retarget the tour**

In `apps/web/src/workbench/AppBar.tsx`, add `import { memo } from 'react';` as the first import, add this component above the doc comment of `AppBar` (the `/**` block that starts ` * The 48 px app bar (design decision 1)`):

```tsx
/**
 * The runtime's Import and Export menus. Memoised and without props, so a status change never
 * re-renders them; the runtime finds them by id.
 */
const DataActions = memo(function DataActions() {
  return (
    <div className="wb-data-actions" data-driver-id="data-actions">
      <protspace-import-menu id="myImportMenu" data-driver-id="import"></protspace-import-menu>
      <protspace-export-menu id="myExportMenu"></protspace-export-menu>
    </div>
  );
});
```

and put it, with a separator, before the help menu, so the actions read:

```tsx
      <div data-workbench="app-bar-actions">
        <DataActions />
        <span className="wb-separator" aria-hidden="true" />
        <HelpMenu />
```

Append to `apps/web/src/workbench/workbench.css`:

```css
/* Import and Export, the tour's "data actions". */
.wb-data-actions {
  display: flex;
  align-items: center;
  gap: var(--ps-space-1-5);
}
```

In `apps/web/src/custom-elements.d.ts`, add inside `interface IntrinsicElements`, after the `'protspace-data-loader'` entry:

```ts
      'protspace-import-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
      'protspace-export-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
        },
        HTMLElement
      >;
```

In `apps/web/src/tour/product-tour.ts`, make steps 2 and 6 light-DOM steps:

1. Replace `  // ── Step 2 – Import button (Shadow DOM) ─────────────────────` and the line `  shadowStep(CONTROL_BAR, 'import', {` below it with:

```ts
  // ── Step 2 – Import menu (app bar) ──────────────────────────
  {
    element: '[data-driver-id="import"]',
    popover: {
```

keep the step's `title` and `description` lines as they are, and replace the step's closing `  }),` with:

```ts
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },
```

2. Do the same for step 6: replace `  // ── Step 6 – Filter, Export & Import (Shadow DOM) ──────────` and `  shadowStep(CONTROL_BAR, 'data-actions', {` with

```ts
  // ── Step 6 – Export & Import (app bar) ──────────────────────
  {
    element: '[data-driver-id="data-actions"]',
    popover: {
```

keep its `title` ('Filter, Export & Import') and `description`, and replace its closing `  }),` with the same `onPrevClick` / `onNextClick` lines and `    },` / `  },`.

Run: `grep -n "shadowStep(CONTROL_BAR" apps/web/src/tour/product-tour.ts`
Expected: three lines, the steps for `projections`, `search` and `selection` (Tasks 2.8 and 2.9 move them).

- [ ] **Step 14: Run the task's e2e specs**

Run (sandbox disabled): `E2E_BROWSERS=chromium PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-import-export workbench-helpers workbench-shell example-datasets dataset-reload product-tour figure-editor isolation-dataset-swap`
Expected: PASS: the 5 new tests; the helper contract (its import and export cases now drive the app-bar menus); `example-datasets` and `dataset-reload` through the retargeted helpers and dispatches; and the tour, whose "each step highlights the correct element" finds `import` and `data-actions` on the app bar.

- [ ] **Step 15: Run the full suites this task affects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: every unit and browser file passes: 2 files more than after Task 2.4 (`import-menu.test.ts`, `export-menu.test.ts`) and 1 fewer (`control-bar.import-menu.test.ts`).

Run: `pnpm --filter @protspace/utils exec vitest --run 2>&1 | tail -3 && pnpm --filter @protspace/app exec vitest --run 2>&1 | tail -3`
Expected: PASS, utils unchanged; app one file more than after Task 2.4.

Run: `pnpm type-check 2>&1 | tail -3 && pnpm knip`
Expected: no type errors; knip reports nothing (`ProtspaceImportMenu`, `ProtspaceExportMenu`, `ExportEventDetail`, `EXPORT_DEFAULTS` and `ExampleDatasetSummary` are public through the core index; `dataMenuStyles` has its consumer in the export menu's styles; `InitialView` and `ExploreControls` in the pipeline, the runtime and the tests; `DataLoaderElement` is gone with its last user).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e 2>&1 | tail -6`
Expected: the full suite passes.

Run (sandbox disabled): `pnpm perf:counts 2>&1 | tail -6`
Expected: every segment within budget; `import` now opens the app-bar menu and closes it with Escape at the end.

Run: `pnpm exec prettier --check packages/core/src/components/import-menu packages/core/src/components/export-menu packages/core/src/components/data-loader packages/core/src/components/control-bar packages/core/src/index.ts packages/core/src/components/kit/icon.ts packages/core/src/styles/style-lint.test.ts apps/web/src/explore apps/web/src/workbench apps/web/src/custom-elements.d.ts apps/web/src/tour/product-tour.ts apps/web/tests/helpers/explore.ts apps/web/tests/dataset-reload.spec.ts apps/web/tests/workbench-import-export.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not).

- [ ] **Step 16: Commit**

```bash
git add packages/core/src/components/import-menu packages/core/src/components/export-menu \
  packages/core/src/components/data-loader/data-loader.ts \
  packages/core/src/components/data-loader/data-loader.handler.test.ts \
  packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar.styles.ts \
  packages/core/src/components/control-bar/styles/export.ts \
  packages/core/src/components/control-bar/control-bar-helpers.ts \
  packages/core/src/components/control-bar/control-bar-helpers.test.ts \
  packages/core/src/components/control-bar/types.ts \
  packages/core/src/components/control-bar/control-bar.import-menu.test.ts \
  packages/core/src/index.ts packages/core/src/components/kit/icon.ts \
  packages/core/src/styles/style-lint.test.ts \
  apps/web/src/explore/explore-controls.ts apps/web/src/explore/import-controller.ts \
  apps/web/src/explore/import-controller.test.ts apps/web/src/explore/runtime.ts \
  apps/web/src/explore/elements.ts apps/web/src/explore/control-bar-events.ts \
  apps/web/src/explore/control-bar-events.test.ts apps/web/src/explore/export-handler.ts \
  apps/web/src/explore/dataset-controller.ts apps/web/src/explore/dataset-controller.fixtures.ts \
  apps/web/src/explore/dataset-controller.eat.test.ts apps/web/src/explore/data-renderer.ts \
  apps/web/src/explore/data-renderer.test.ts apps/web/src/workbench/AppBar.tsx \
  apps/web/src/workbench/workbench.css apps/web/src/custom-elements.d.ts \
  apps/web/src/tour/product-tour.ts apps/web/tests/helpers/explore.ts \
  apps/web/tests/dataset-reload.spec.ts apps/web/tests/workbench-import-export.spec.ts
git commit -m "feat(core): move Import and Export into app-bar menus"
```

(`git add` of the deleted `styles/export.ts` and `control-bar.import-menu.test.ts` stages their removal.)

---

### Task 2.6: Filter in a dialog with its own controller

The filter leaves the control bar. The view bar gets a Filter button showing the applied-condition count, which opens `protspace-query-builder` in a `ps-dialog` headed "Filter" until the sidebar panel arrives in 4.4. The query, its application through the plot's filter channel and the two-way EAT reliability mirror move from `control-bar.ts` (:1851-2077) into `apps/web/src/explore/filter-controller.ts`, which updates the legend directly instead of through `eat-threshold-mirror`. Behaviour is otherwise unchanged: Apply closes, Reset keeps the dialog open, closing keeps the edits (4.4 adds the draft).

**Files:**

- Create: `apps/web/src/explore/filter-controller.ts`, `filter-controller.test.ts` (ported from `packages/core/src/components/control-bar/control-bar.query-apply.test.ts` :98-653)
- Create: `apps/web/src/workbench/FilterControl.tsx`
- Modify: `apps/web/src/workbench/ViewBar.tsx`, `apps/web/src/explore/workbench-status.ts` (+ test), `runtime.ts` (:342-361 and the `ExploreControls` object), `elements.ts`, `apps/web/src/custom-elements.d.ts`
- Modify: `packages/core/src/components/control-bar/query-builder.ts` (header :274-290), `query-builder.test.ts`, `control-bar.ts` (state `_filterableAnnotations`, `showFilterMenu`, `filterQuery`, `filterActive`, `_lastMirroredState`; the Filter button :1028-1050; the modal :1312-1334; `updated` :1391-1398; the filter branch of `handleDocumentKeydown` :1400-1411; logic :1851-2077; the filter lines of `clearForNewDataset` :680-689), `packages/core/src/index.ts`
- Delete: `packages/core/src/components/control-bar/control-bar.query-apply.test.ts` (ported)
- Modify: `apps/web/tests/helpers/explore.ts` (`filterButton`, `filterDialog`, `openFilter`)
- Create: `apps/web/tests/workbench-filter.spec.ts`
- Also modified (needed by this task; see the notes in Steps 5, 10 and 16):
  - `packages/core/src/components/control-bar/query-builder.styles.ts` (`queryBuilderHostStyles`): no padding of its own when embedded.
  - `packages/core/src/components/control-bar/query-value-picker.ts`, `query-value-picker.test.ts`, `query-condition-row.ts`, `query-condition-row.test.ts`: an open picker registers with the layer stack, so Escape inside the Filter dialog closes the picker and not the whole dialog.
  - `packages/core/src/components/control-bar/annotation-select.component.test.ts` (:352-405): the list-splitting test stops reading the control bar's `_filterableAnnotations`, which this task removes.
  - `apps/web/src/workbench/workbench.css`: the count badge on Filter.
  - `apps/web/tests/eat-visualization.spec.ts` (:339, :346, :353): Filter's state read from its accessible name instead of the control bar's `filter-active` class.

**Interfaces:**

- Consumes: `ExploreControls` (Task 2.5); `ProtspaceLegend.setReliabilityState(state: EatReliabilityState)` and the legend's `eat-overlay-change` `{ reliability }`; plot `filteredProteinIds`, `filtersActive`, `getMaterializedData()`, `getCurrentData()`; query builder `annotations`, `data`, `query` and events `query-changed` `{ query }`, `query-apply` `{ matchedIndices }`, `query-reset` (and `query-close`, which the builder's own Cancel button dispatches); `ps-button`, `ps-dialog` (`open`, `heading`, `size`, `ps-close`); `pushLayer` (`kit/layers.ts`); `isEatConfidenceAnnotation`, `isSameReliability`, `DEFAULT_EAT_RELIABILITY`, `NEUTRAL_BOUND` (`@protspace/utils`); `setWorkbenchStatus`, `getWorkbenchStatus`, `resetWorkbenchStatusForTests` (Task 2.2); `useWorkbenchStatus()` (Task 2.2); the Task 2.3 helpers `viewBar(page)`, `queryBuilder(page)`, `getViewState(page)`, `openExplore`, `getFirstLegendItemValue`, `getProteinCount`, `waitForExploreInteractionReady`.
- Produces (core):
  - `ProtspaceQueryBuilder.embedded: boolean` (attribute `embedded`, reflected): hides its own title and close button, keeps the match count, and leaves Escape to the dialog that hosts it.
  - `ProtspaceQueryBuilder` is now an exported class. The core index exports `ProtspaceQueryBuilder`, `createCondition`, `evaluateQuery`, `hasConfiguredCondition`, `findConditionsForAnnotation`, `replaceConditionsForAnnotation`, `conditionsForReliability`, `reliabilityFromConditions`, `sameConditions` and `type FilterQuery`.
  - `protspace-query-value-picker` (while `open`) and `protspace-query-condition-row`'s annotation picker (while shown) each push a layer (`dismissOnOutsidePress: false`; their own outside-click closing is unchanged), so Escape closes them before the dialog around them.
  - The control bar keeps no filter state, no `setEatReliability` or `setEatConfidenceThreshold`, and dispatches no `eat-threshold-mirror`.
- Produces (app):
  - `filter-controller.ts`: `createFilterController(options: { plotElement: ProtspaceScatterplot; legendElement: ProtspaceLegend; queryBuilder: ProtspaceQueryBuilder; dialog: PsDialog; root: Pick<Document, 'addEventListener' | 'removeEventListener'> }): FilterController`; `interface FilterController { open(): void; setSelectedAnnotation(annotation: string): void; setEatReliability(baseKey: string, state: EatReliabilityState): void; resetForNewDataset(): void; dispose(): void }`. `open()` refreshes the builder's data from `getMaterializedData()`, seeds one empty condition when the query is empty and sets `dialog.open = true`. `query-apply` applies through the filter channel and closes the dialog; a query matching nothing leaves the plot unfiltered (#380); `query-reset` clears only the filter channel and keeps the dialog open; `query-close` (the builder's Cancel) closes the dialog and keeps the edits. `setSelectedAnnotation` re-mirrors the reliability state to the legend when the annotation changes; the controller calls it on every `annotation-change` heard on `root`, and `ExploreControls.showInitialView` calls it for a new dataset. It writes `appliedFilterConditions` to the workbench status. It listens to the plot's `data-change` to keep its materialized snapshot current (as the control bar's `_handleDataChange` did) and hands the builder new data or a new query only while the dialog is open, so a closed dialog never makes the builder re-count the dataset.
  - `workbench-status.ts`: `appliedFilterConditions: number` (0 = no filter applied; otherwise the applied query's top-level item count, which is what the control bar's badge showed).
  - `FilterControl` in the view bar, after the control bar: `ps-button#myFilterButton` (ghost; filter icon; "Filter"; the count when applied; accessible name "Filter" or "Filter, N condition(s) applied") and `ps-dialog#myFilterDialog[heading="Filter"][size="lg"]` holding `protspace-query-builder#myQueryBuilder[embedded]`. The two are siblings, so a later task can hide the button without hiding the dialog. The runtime wires `click` on `#myFilterButton` to `open()`.
  - `elements.ts`: `queryBuilder` (`#myQueryBuilder`), `filterDialog` (`#myFilterDialog`), `filterButton` (`#myFilterButton`).
  - The runtime routes the legend's `eat-overlay-change` to `filterController.setEatReliability(legendElement.selectedAnnotation, reliability)`; its `eat-threshold-mirror` listener is gone. `ExploreControls.resetForNewDataset` also calls `filterController.resetForNewDataset()`; `ExploreControls.showInitialView` also calls `filterController.setSelectedAnnotation(view.annotation)` (the control bar's `updated()` mirror, which it replaces, is gone).
  - Helpers: `filterButton` → the view bar's button named `/^Filter/`; `filterDialog` → `page.getByRole('dialog', { name: 'Filter', exact: true })`; `openFilter` resolves once `filterDialog` is visible.

**Tests:**

- `filter-controller.test.ts` (unit, node; fake plot, legend, builder and dialog; core's pure query helpers supplied through `vi.mock('@protspace/core', …)` from core's source by relative path): the ported query-apply cases (indices map through the materialized snapshot; re-applying is idempotent; an empty match clears the channel; reset leaves isolation alone; `setEatReliability` replaces the condition at any depth; the reverse mirror reaches the legend; no ping-pong; an annotation change forces the mirror; a dataset reset clears query and mirror state), plus "open seeds one empty condition and opens the dialog", "apply closes the dialog and reports the condition count", "reset keeps the dialog open", "Cancel in the builder closes the dialog and keeps the edits", "the builder lists every annotation except the tooltip-only ones", "a closed dialog's builder gets no new data".
- `query-builder.test.ts`: "embedded hides the title and close button and keeps the match count"; "embedded leaves Escape to the dialog that hosts it".
- `query-value-picker.test.ts`: "an open picker is a layer, so Escape closes it before the dialog around it". `query-condition-row.test.ts`: "the open annotation picker is a layer, so Escape closes it before the dialog around it".
- `workbench-status.test.ts`: `appliedFilterConditions` defaults to 0.
- `apps/web/tests/workbench-filter.spec.ts` (e2e): "Filter opens a dialog named Filter with the query builder; Escape closes it and returns focus to Filter"; "applying a condition filters the plot and shows the count on Filter"; "Reset clears the filter and keeps the dialog open".
- `numeric-binning.spec.ts`, `eat-visualization.spec.ts` and `workbench-helpers.spec.ts` stay green.

Before you start, record the baseline counts from the phase 2 ledger. Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Task 2.5 has replaced the control bar's Import and Export code, so line numbers in `control-bar.ts` below are today's; find each block by the code quoted, not by its number.

- [ ] **Step 1: Write the failing query-builder tests**

Append to `packages/core/src/components/control-bar/query-builder.test.ts` (after the last `describe` block; `makeData`, `createCondition` and `QueryBuilderInternals` are already in the file):

```ts
describe('query-builder embedded in a dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mountEmbedded(): Promise<QueryBuilderInternals & { embedded: boolean }> {
    const builder = document.createElement('protspace-query-builder') as QueryBuilderInternals & {
      embedded: boolean;
    };
    builder.embedded = true;
    builder.annotations = ['organism'];
    builder.data = makeData();
    builder.query = [createCondition()];
    document.body.appendChild(builder);
    await builder.updateComplete;
    return builder;
  }

  it('embedded hides the title and close button and keeps the match count', async () => {
    const builder = await mountEmbedded();
    const root = builder.shadowRoot!;

    expect(builder.hasAttribute('embedded')).toBe(true);
    expect(root.querySelector('.query-header')!.textContent).not.toContain('Filter Query');
    expect(root.querySelector('.btn-close')).toBeNull();
    expect(root.querySelector('.match-count')).not.toBeNull();
    // The footer stays: Reset All, Cancel and Apply Filter.
    expect(root.querySelector('.query-footer-reset')).not.toBeNull();
  });

  it('embedded leaves Escape to the dialog that hosts it', async () => {
    const builder = await mountEmbedded();
    const onClose = vi.fn();
    builder.addEventListener('query-close', onClose);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/query-builder.test.ts`
Expected: FAIL, 2 tests: the builder has no `embedded` property, so the header still contains "Filter Query" and the document Escape dispatches `query-close`.

- [ ] **Step 3: Add the embedded mode**

In `packages/core/src/components/control-bar/query-builder.ts`:

Change the Lit import (line 1) to:

```ts
import { LitElement, html, nothing } from 'lit';
```

Replace the class line `class ProtspaceQueryBuilder extends LitElement {` (line 21) with:

```ts
export class ProtspaceQueryBuilder extends LitElement {
```

After `@property({ type: Array }) query: FilterQuery = [];` (line 26) add:

```ts
  /**
   * Hosted by a dialog that brings its own heading, close button and Escape (the app's Filter
   * dialog): the builder then shows neither its title nor its close button, and ignores Escape.
   */
  @property({ type: Boolean, reflect: true }) embedded = false;
```

Replace `_onKeydown` (lines 36-40):

```ts
  private _onKeydown = (e: KeyboardEvent) => {
    // Embedded, the dialog owns Escape (through the layer stack); a document listener here would
    // dispatch query-close for every Escape on the page.
    if (e.key === 'Escape' && !this.embedded) {
      this._handleClose();
    }
  };
```

Replace the header block in `render()` (lines 277-290):

```ts
        <div class="query-header">
          ${this.embedded ? nothing : html`<span>Filter Query</span>`}
          <span class="match-count">
            ${this._matchedIndices.size} of ${this._totalCount} proteins matched
          </span>
          ${this.embedded
            ? nothing
            : html`<button
                class="btn-close"
                title="Close"
                aria-label="Close filter query builder"
                @click=${this._handleClose}
              >
                ${renderCloseIcon()}
              </button>`}
        </div>
```

In `packages/core/src/components/control-bar/query-builder.styles.ts`, replace `queryBuilderHostStyles` (lines 498-504) with:

```ts
/** The builder's own host fills its modal; the rows and pickers sharing the sheet above do not. */
export const queryBuilderHostStyles = css`
  :host {
    width: 100%;
    height: 100%;
  }

  /* Embedded in the app's Filter dialog, whose body already pads its content. */
  :host([embedded]) .query-builder {
    padding: 0;
  }
`;
```

- [ ] **Step 4: Run the query-builder tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/query-builder.test.ts`
Expected: PASS, every test in the file (the 9 existing ones and the 2 new ones).

- [ ] **Step 5: Write the failing picker-layer tests**

Inside the dialog, Escape reaches the layer stack (a window capture listener) before any picker sees it, so without these layers Escape in an open value or annotation picker would close the whole Filter dialog. The pickers keep their own outside-click closing; the layer only takes Escape (`dismissOnOutsidePress: false`).

Append to `packages/core/src/components/control-bar/query-value-picker.test.ts`:

```ts
describe('query-value-picker inside a dialog', () => {
  it('an open picker is a layer, so Escape closes it before the dialog around it', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await mount({ open: false });
    const onClose = vi.fn();
    el.addEventListener('picker-close', onClose);

    el.open = true;
    await el.updateComplete;
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(dialogClose).not.toHaveBeenCalled();

    // The owner closes it on picker-close; the dialog is the top layer again.
    el.open = false;
    await el.updateComplete;
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });
});
```

and add these imports at the top of the same file (keep the existing ones; `vi` joins the `vitest` import):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, topLayer } from '../kit/layers';
```

Append to `packages/core/src/components/control-bar/query-condition-row.test.ts`:

```ts
describe('query-condition-row inside a dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('the open annotation picker is a layer, so Escape closes it before the dialog around it', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await mount();

    (el.shadowRoot!.querySelector('.annotation-select-trigger') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.annotation-picker')).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.annotation-picker')).toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });
});
```

and add to its imports:

```ts
import { pushLayer, topLayer } from '../kit/layers';
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/query-value-picker.test.ts src/components/control-bar/query-condition-row.test.ts`
Expected: FAIL, 2 tests: with no picker layer on the stack, the window listener closes the fake dialog layer (`dialogClose` is called) and the pickers stay open.

- [ ] **Step 7: Make the open pickers layers**

In `packages/core/src/components/control-bar/query-value-picker.ts`, add the import after the `dropdown-helpers` import (line 12):

```ts
import { pushLayer } from '../kit/layers';
```

Add a field after `private _countCache …` (the block ending at line 62):

```ts
  /** Releases this picker's layer; set while it is open. */
  private _releaseLayer?: () => void;
```

Replace `disconnectedCallback` (lines 98-101):

```ts
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleDocumentClick, true);
    this._releaseLayer?.();
    this._releaseLayer = undefined;
  }
```

Replace `updated` (lines 105-111):

```ts
  updated(changedProperties: Map<string, unknown>) {
    if (!changedProperties.has('open')) return;
    if (this.open) {
      // A layer while open, so Escape closes this picker before the dialog it sits in. Outside
      // clicks keep closing it through _handleDocumentClick.
      this._releaseLayer ??= pushLayer({
        close: () =>
          this.dispatchEvent(new CustomEvent('picker-close', { bubbles: true, composed: true })),
        elements: [this],
        dismissOnOutsidePress: false,
      });
      this.updateComplete.then(() => {
        this._inputEl?.focus();
      });
    } else {
      this._releaseLayer?.();
      this._releaseLayer = undefined;
    }
  }
```

In `packages/core/src/components/control-bar/query-condition-row.ts`, add the import after the `dropdown-helpers` import (line 9):

```ts
import { pushLayer } from '../kit/layers';
```

Add a field after `@litQuery('.annotation-picker-input') private _annotationInputEl?: HTMLInputElement;` (line 41):

```ts
  /** Releases the annotation picker's layer; set while the picker is shown. */
  private _releasePickerLayer?: () => void;
```

Replace `disconnectedCallback` (lines 56-59):

```ts
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._handleDocumentClick, true);
    this._releasePickerLayer?.();
    this._releasePickerLayer = undefined;
  }
```

Replace `updated` (lines 63-69):

```ts
  updated(changedProperties: Map<string, unknown>) {
    if (!changedProperties.has('_showAnnotationPicker')) return;
    if (this._showAnnotationPicker) {
      // A layer while shown, so Escape closes the picker before the dialog it sits in.
      this._releasePickerLayer ??= pushLayer({
        close: () => this._closeAnnotationPicker(),
        elements: [this],
        dismissOnOutsidePress: false,
      });
      this.updateComplete.then(() => {
        this._annotationInputEl?.focus();
      });
    } else {
      this._releasePickerLayer?.();
      this._releasePickerLayer = undefined;
    }
  }
```

- [ ] **Step 8: Run the picker tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/query-value-picker.test.ts src/components/control-bar/query-condition-row.test.ts`
Expected: PASS, every test in both files, including the 2 new ones and "closes on Escape and clears the search box" (its composed Escape now reaches the picker through its layer, with the same result).

- [ ] **Step 9: Export the query API from core**

In `packages/core/src/index.ts`, directly below the line `export { ProtspaceControlBar } from './components/control-bar/control-bar'; // Explicit export for value access`, add:

```ts
// The filter's query builder and its pure query helpers; the app's filter controller drives them.
export { ProtspaceQueryBuilder } from './components/control-bar/query-builder';
export { createCondition } from './components/control-bar/query-types';
export type { FilterQuery } from './components/control-bar/query-types';
export { evaluateQuery, hasConfiguredCondition } from './components/control-bar/query-evaluate';
export {
  findConditionsForAnnotation,
  replaceConditionsForAnnotation,
} from './components/control-bar/query-annotation-conditions';
export {
  conditionsForReliability,
  reliabilityFromConditions,
  sameConditions,
} from './components/control-bar/eat-reliability';
```

- [ ] **Step 10: Remove the filter from the control bar**

In `packages/core/src/components/control-bar/control-bar.ts`:

1. Replace the `@protspace/utils` import (lines 19-29) with:

```ts
import {
  DENSITY_DEFAULT,
  DENSITY_LAYER_MODES,
  isEatConfidenceAnnotation,
  type DensityLayerMode,
  type ProjectionStatisticRow,
} from '@protspace/utils';
```

2. Delete `import './query-builder';` (line 43) and the query imports (lines 45-56):

```ts
import type { FilterQuery } from './query-types';
import { createCondition } from './query-types';
import { evaluateQuery, hasConfiguredCondition } from './query-evaluate';
import {
  findConditionsForAnnotation,
  replaceConditionsForAnnotation,
} from './query-annotation-conditions';
import {
  conditionsForReliability,
  reliabilityFromConditions,
  sameConditions,
} from './eat-reliability';
```

3. Delete the state: `_filterableAnnotations` with its comment (lines 115-116), `@state() private showFilterMenu: boolean = false;` (line 128), `@state() private filterQuery: FilterQuery = [];`, `@state() private filterActive = false;` and `_lastMirroredState` with its comment block (lines 132-140).

4. In `_onAnnotationOpened` and `_onSearchOpened`, delete the line `this.showFilterMenu = false;`. In `closeOtherDropdowns`, delete `'filter'` from the `except` union and the line `if (except !== 'filter') this.showFilterMenu = false;`.

5. Replace `clearForNewDataset` with (Task 2.5 already removed its export-format line):

```ts
  public clearForNewDataset(_datasetHash: string, _clearPersistedState: boolean = true): void {
    this._cancelPendingCommits();
  }
```

If Task 2.5 changed the signature, keep that signature and make `this._cancelPendingCommits();` the only statement.

6. In `render()`, delete the whole `<!-- Filter / Export / Import group -->` `div` (the `data-actions-group` that Task 2.5 left holding only the `.filter-container` Filter button, today :1027-1308), and delete the query builder modal after the `.control-bar` div:

```ts
      ${this.showFilterMenu
        ? html`
            <div class="query-builder-overlay" @click=${this._handleOverlayClick}>
              …
            </div>
          `
        : ''}
```

(today :1312-1334, the whole conditional, so the template ends with the `.control-bar` div's closing tag). Then delete the `_handleOverlayClick` method (:1338-1340) and the whole `updated()` method (:1391-1398).

7. In `handleDocumentKeydown`, replace

```ts
    if (inAriaModal) {
      // ESC inside the filter modal closes the modal
      if (event.key === 'Escape' && this.showFilterMenu) {
        this.showFilterMenu = false;
      }
      return;
    }
```

with

```ts
    // A modal (the legend's dialogs, the figure editor) owns its own Escape.
    if (inAriaModal) return;
```

8. In `handleDocumentClick`, delete the array entry `this.shadowRoot?.querySelector('.filter-menu'), // Filter` and the line `this.showFilterMenu = false;`.

9. In `_handleDataChange`, keep the `_currentData` refresh (the annotation select still reads its definitions and statistics from it until Task 2.8) and change its comment to:

```ts
    // The annotation select's definitions and statistics read the materialized (full) data, so
    // its badges describe the dataset, not the isolated subset.
```

10. In `_updateOptionsFromData`, delete

```ts
    // The query-filter column picker can filter on the synthesized `__eat_confidence`
    // columns (e.g. `EAT_confidence >= X or N/A`), but they're not meaningful to color by.
    this._filterableAnnotations = fullAnnotationKeys;
```

11. Delete the methods `toggleFilterMenu`, `_handleQueryClose`, `_handleQueryChanged`, `_handleQueryApply`, `_applyMatchedIndices`, `_applyQuery`, `_clearFilterChannel`, `setEatConfidenceThreshold`, `setEatReliability`, `_emitEatThresholdMirror`, `_findEatConfidenceAnnotationKey` and `_handleQueryReset` (today :1851-2077), so the class ends after `_handleBrushSelection`.

In `packages/core/src/components/control-bar/annotation-select.component.test.ts`, the list-splitting test stops reading `_filterableAnnotations` (the filter controller's own test covers the filterable list now): delete the line `_filterableAnnotations: string[];` from `ControlBarInternals` (:354), rename the test to `'excludes eat-confidence annotations from the color-by list'`, and delete its assertion

```ts
    expect(controlBar._filterableAnnotations).toEqual([
      'pfam',
      'pfam__eat_confidence',
      'pfam__eat_confidence__runtime_2',
    ]);
```

Delete `packages/core/src/components/control-bar/control-bar.query-apply.test.ts` (Step 15 ports it).

- [ ] **Step 11: Run the core unit suite**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit`
Expected: PASS. One file fewer than the baseline (`control-bar.query-apply.test.ts`, 24 tests), plus the 4 new tests from Steps 1 and 5.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core build`
Expected: no type errors; the build writes `dist/` (the app reads it from here on).

- [ ] **Step 12: Write the failing workbench-status test**

Append inside the `describe` block of `apps/web/src/explore/workbench-status.test.ts` (Task 2.2's file; it resets the store before each test):

```ts
  it('starts with no filter applied', () => {
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    setWorkbenchStatus({ appliedFilterConditions: 2 });
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(2);
  });
```

Task 2.2's file compares the whole snapshot with `toEqual` in two tests: add `appliedFilterConditions: 0` to the expected object of "starts empty" (`{ datasetName: null, proteinCount: null, appliedFilterConditions: 0 }`) and of "merges a patch and notifies once" (`{ datasetName: 'demo.parquetbundle', proteinCount: 12, appliedFilterConditions: 0 }`); without the second, Step 13's run fails there.

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts`
Expected: FAIL, 3 tests: `expected undefined to be +0`, and the two `toEqual` tests miss `appliedFilterConditions` (and a type error on the unknown field when the IDE checks it).

- [ ] **Step 13: Add the field**

In `apps/web/src/explore/workbench-status.ts`, add to `interface WorkbenchStatus`:

```ts
  /** Top-level conditions of the applied filter; 0 while no filter is applied. */
  appliedFilterConditions: number;
```

and `appliedFilterConditions: 0,` to the initial status object (the one `resetWorkbenchStatusForTests()` restores; if the initial state is written out twice, add it to both).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts`
Expected: PASS.

- [ ] **Step 14: Write the failing filter-controller test**

Create `apps/web/src/explore/filter-controller.test.ts`:

```ts
/**
 * The filter, moved from the control bar (`control-bar.query-apply.test.ts`), driven by fakes.
 *
 * A query is applied through the plot's dedicated, idempotent filter channel
 * (`filteredProteinIds` / `filtersActive`): a filter is neither a selection nor an isolation.
 * Matched indices are positions in the materialized snapshot the builder evaluated; translating
 * them through the isolated subset shrank the result on every re-apply (#257).
 *
 * The legend's EAT reliability control and the query mirror each other per eat-confidence column
 * (#6b, #380). The column is found by its runtime role, not its `__eat_confidence` suffix, so the
 * collision-renamed `__runtime_N` variant works too.
 */
import type {
  ProtspaceLegend,
  ProtspaceQueryBuilder,
  ProtspaceScatterplot,
  PsDialog,
} from '@protspace/core';
import { NA_VALUE, NEUTRAL_BOUND, type VisualizationData } from '@protspace/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findConditionsForAnnotation } from '../../../../packages/core/src/components/control-bar/query-annotation-conditions';
import type {
  FilterQuery,
  NumericCondition,
} from '../../../../packages/core/src/components/control-bar/query-types';
import { createFilterController, type FilterController } from './filter-controller';
import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';

// Lit cannot load in node: stand in for @protspace/core with its pure query helpers, read from
// core's source.
vi.mock('@protspace/core', async () => {
  const types = await import('../../../../packages/core/src/components/control-bar/query-types');
  const evaluate = await import(
    '../../../../packages/core/src/components/control-bar/query-evaluate'
  );
  const conditions = await import(
    '../../../../packages/core/src/components/control-bar/query-annotation-conditions'
  );
  const reliability = await import(
    '../../../../packages/core/src/components/control-bar/eat-reliability'
  );
  return {
    createCondition: types.createCondition,
    evaluateQuery: evaluate.evaluateQuery,
    hasConfiguredCondition: evaluate.hasConfiguredCondition,
    findConditionsForAnnotation: conditions.findConditionsForAnnotation,
    replaceConditionsForAnnotation: conditions.replaceConditionsForAnnotation,
    conditionsForReliability: reliability.conditionsForReliability,
    reliabilityFromConditions: reliability.reliabilityFromConditions,
    sameConditions: reliability.sameConditions,
  };
});

/** Fixtures carry only what the filter reads, so they go through `unknown`. */
const asData = (data: unknown) => data as VisualizationData;
const range = (count: number) => Array.from({ length: count }, (_, i) => i);
const ids = (count: number) => range(count).map((i) => `p${i}`);

/** A full dataset of `count` proteins: p0, p1, … p{count-1}. */
const makeFullData = (count: number) => asData({ protein_ids: ids(count), annotations: {} });

const EAT_KEY = 'family__eat_confidence__runtime_2';

/**
 * 20 proteins: p0–p4 curated (null confidence), p5–p19 predicted with confidence i/20
 * (0.25 … 0.95). The eat-confidence column carries an explicit runtime role and base.
 */
function makeEatData(): VisualizationData {
  return asData({
    protein_ids: ids(20),
    annotations: {
      family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      gene_name: { kind: 'categorical', values: ['g'], colors: ['#000'], shapes: ['circle'] },
      [EAT_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
      },
    },
    numeric_annotation_data: {
      [EAT_KEY]: Float64Array.from({ length: 20 }, (_, i) => (i < 5 ? NaN : i / 20)),
    },
  });
}

const EC_KEY = 'ec__eat_confidence__runtime_1';
const GO_KEY = 'go__eat_confidence__runtime_2';

/** Two EAT bases, each with its own eat-confidence column. */
function makeMultiEatData(): VisualizationData {
  const confidence = () => Float64Array.from({ length: 20 }, (_, i) => (i < 5 ? NaN : i / 20));
  return asData({
    protein_ids: ids(20),
    annotations: {
      ec: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      go: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      [EC_KEY]: { kind: 'numeric', values: [], runtime: { role: 'eat-confidence', baseAnnotation: 'ec' } },
      [GO_KEY]: { kind: 'numeric', values: [], runtime: { role: 'eat-confidence', baseAnnotation: 'go' } },
    },
    numeric_annotation_data: { [EC_KEY]: confidence(), [GO_KEY]: confidence() },
  });
}

/**
 * The controller with fakes for everything it touches. `getCurrentData` returns an isolated
 * subset on purpose: matched indices must never be translated through it (#257).
 */
function mount(makeData: () => VisualizationData, selectedAnnotation?: string) {
  const plot = Object.assign(new EventTarget(), {
    filteredProteinIds: [] as string[],
    filtersActive: false,
    // A sentinel selection: a filter must leave it untouched.
    selectedProteinIds: ['sentinel'],
    isolateSelection: vi.fn(),
    getCurrentData: vi.fn(() => asData({ protein_ids: ['p0', 'p1'], annotations: {} })),
    getMaterializedData: vi.fn((): VisualizationData | null => makeData()),
  });
  const legend = { setReliabilityState: vi.fn() };
  const queryBuilder = Object.assign(new EventTarget(), {
    annotations: [] as string[],
    data: undefined as VisualizationData | undefined,
    query: [] as FilterQuery,
  });
  const dialog = { open: false };
  const root = new EventTarget();
  const controller = createFilterController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    legendElement: legend as unknown as ProtspaceLegend,
    queryBuilder: queryBuilder as unknown as ProtspaceQueryBuilder,
    dialog: dialog as unknown as PsDialog,
    root: root as unknown as Document,
  });
  if (selectedAnnotation !== undefined) controller.setSelectedAnnotation(selectedAnnotation);
  // Mounting with an annotation mirrors once; the tests count only what they cause.
  legend.setReliabilityState.mockClear();
  return { controller, plot, legend, queryBuilder, dialog, root };
}

const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));
const apply = (queryBuilder: EventTarget, indices: Iterable<number>) =>
  fire(queryBuilder, 'query-apply', { matchedIndices: new Set(indices) });
const editQuery = (queryBuilder: EventTarget, query: FilterQuery) =>
  fire(queryBuilder, 'query-changed', { query });
/** The legend slider's scalar form: "hide below `x`". */
const threshold = (controller: FilterController, base: string, x: number) =>
  controller.setEatReliability(base, { mode: 'atLeast', min: x, max: NEUTRAL_BOUND.max });
const numericCount = (query: FilterQuery) =>
  query.filter((item) => 'kind' in item && item.kind === 'numeric').length;
/** The column's live reliability condition, which is always the first (and only) one. */
const eatCondition = (query: FilterQuery, key: string = EAT_KEY): NumericCondition | undefined =>
  findConditionsForAnnotation(query, key)[0];

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('filter controller: the Filter dialog', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(() => makeFullData(100));
    m.controller.open();
  });

  it('open seeds one empty condition, hands the builder the materialized snapshot and opens the dialog', () => {
    expect(m.dialog.open).toBe(true);
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(100);
    expect(m.plot.getMaterializedData).toHaveBeenCalled();
  });

  it('the builder lists every annotation except the tooltip-only ones', () => {
    const eat = mount(makeEatData);
    eat.controller.open();
    expect(eat.queryBuilder.annotations).toEqual(['family', EAT_KEY]);
  });

  it('applies a query via the filter channel without selecting or isolating', () => {
    apply(m.queryBuilder, range(30));

    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.plot.selectedProteinIds).toEqual(['sentinel']);
  });

  it('apply closes the dialog and reports the condition count', () => {
    apply(m.queryBuilder, range(30));

    expect(m.dialog.open).toBe(false);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);
  });

  it('is idempotent: re-applying the same query yields the same matches', () => {
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));

    // Was 30 → 19 → a fade before #257.
    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
  });

  it('replaces (does not stack) when a narrower query is applied next', () => {
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(12));

    expect(m.plot.filteredProteinIds).toEqual(ids(12));
  });

  it('does not blank the plot when the query matches nothing', () => {
    apply(m.queryBuilder, [5, 6, 7]);
    expect(m.plot.filtersActive).toBe(true);

    // An active-but-empty channel reads as "hide everything", with no way back (#380).
    apply(m.queryBuilder, []);

    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toHaveLength(0);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('reset clears only the filter channel, re-seeds an empty condition and keeps the dialog open', () => {
    apply(m.queryBuilder, [0, 1, 2]);
    m.controller.open();

    fire(m.queryBuilder, 'query-reset');

    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.dialog.open).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('Cancel in the builder closes the dialog and keeps the edits', () => {
    const edited: FilterQuery = [
      { id: 'a', kind: 'categorical', annotation: 'family', values: ['A'] },
    ];
    editQuery(m.queryBuilder, edited);

    fire(m.queryBuilder, 'query-close');
    expect(m.dialog.open).toBe(false);

    m.controller.open();
    expect(m.queryBuilder.query).toEqual(edited);
  });

  it('a closed dialog’s builder gets no new data', () => {
    fire(m.queryBuilder, 'query-close');
    const before = m.queryBuilder.data;
    m.plot.getMaterializedData.mockImplementation(() => makeFullData(50));

    fire(m.plot, 'data-change', { data: makeFullData(50) });
    expect(m.queryBuilder.data).toBe(before);

    m.controller.open();
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(50);
  });

  it('a dataset reset clears the query and the applied count', () => {
    editQuery(m.queryBuilder, [{ id: 'a', kind: 'categorical', annotation: 'x', values: ['y'] }]);
    apply(m.queryBuilder, range(3));
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    m.controller.resetForNewDataset();

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    m.controller.open();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).not.toMatchObject({ annotation: 'x' });
  });

  it('dispose stops listening', () => {
    m.controller.dispose();
    apply(m.queryBuilder, range(3));
    expect(m.plot.filtersActive).toBe(false);
  });
});

describe('filter controller: EAT reliability slider <-> query mirror', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, 'family');
    // An open dialog mirrors the controller's query onto the builder, which is how these tests
    // read it.
    m.dialog.open = true;
  });

  it('forward: upserts a single "EAT_confidence >= x or N/A" condition and applies it', () => {
    threshold(m.controller, 'family', 0.5);

    expect(eatCondition(m.queryBuilder.query)).toMatchObject({
      kind: 'numeric',
      annotation: EAT_KEY,
      operator: 'gte',
      min: 0.5,
      presence: [NA_VALUE],
    });
    // Un-negated: the N/A chip is what retains curated points now, not NOT.
    expect(eatCondition(m.queryBuilder.query)?.logicalOp).not.toBe('NOT');
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.plot.filtersActive).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    // Kept = curated (p0–p4) + predictions >= 0.5 (p10–p19); hidden = p5–p9.
    const kept = m.plot.filteredProteinIds;
    expect(kept).toContain('p0');
    expect(kept).toContain('p4');
    expect(kept).not.toContain('p5');
    expect(kept).not.toContain('p9');
    expect(kept).toContain('p10');
    expect(kept).toContain('p19');
    expect(kept).toHaveLength(15);
    expect(m.plot.selectedProteinIds).toEqual(['sentinel']);
  });

  it('forward: re-applying with a new threshold replaces (does not stack) the condition', () => {
    threshold(m.controller, 'family', 0.5);
    threshold(m.controller, 'family', 0.8);

    expect(numericCount(m.queryBuilder.query)).toBe(1);
    expect(eatCondition(m.queryBuilder.query)).toMatchObject({ min: 0.8 });
    // Kept = curated (5) + predictions >= 0.8 (p16–p19 = 4) = 9.
    expect(m.plot.filteredProteinIds).toHaveLength(9);
  });

  it('forward: seeds against the current dataset, not a stale snapshot (dataset switch)', () => {
    // The snapshot from the last data-change is the PREVIOUS dataset (all curated), while the
    // plot already materializes the new one: the seed must read the plot.
    const staleData = asData({
      protein_ids: range(20).map((i) => `old${i}`),
      annotations: {
        family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
        [EAT_KEY]: {
          kind: 'numeric',
          values: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
        },
      },
      numeric_annotation_data: { [EAT_KEY]: new Float64Array(20).fill(NaN) },
    });
    let current = staleData;
    m.plot.getMaterializedData.mockImplementation(() => current);
    fire(m.plot, 'data-change', { data: staleData });
    current = makeEatData();

    threshold(m.controller, 'family', 0.5);

    const kept = m.plot.filteredProteinIds;
    expect(kept.every((id) => id.startsWith('p'))).toBe(true);
    expect(kept).toHaveLength(15);
  });

  it('forward: dragging to 0 removes the eat condition and clears the filter channel', () => {
    threshold(m.controller, 'family', 0.5);
    expect(m.plot.filtersActive).toBe(true);

    threshold(m.controller, 'family', 0);

    expect(eatCondition(m.queryBuilder.query)).toBeUndefined();
    expect(m.queryBuilder.query).toHaveLength(0);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('reverse: a query change that adds or drops the condition moves the legend control', () => {
    editQuery(m.queryBuilder, [
      {
        id: 'x',
        kind: 'numeric',
        annotation: EAT_KEY,
        operator: 'gte',
        min: 0.6,
        max: null,
        presence: [NA_VALUE],
      },
    ]);
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.6 }),
    );

    editQuery(m.queryBuilder, []);
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0 }),
    );
  });

  it('guards the loop: a query change echoing the forward value does not move the legend again', () => {
    threshold(m.controller, 'family', 0.5);
    m.legend.setReliabilityState.mockClear();

    // The builder re-broadcasts the current query (same 0.5): no new value.
    editQuery(m.queryBuilder, m.queryBuilder.query);

    expect(m.legend.setReliabilityState).not.toHaveBeenCalled();
  });

  it('keeps a mode that constrains nothing, across an unrelated query edit', () => {
    // A freshly loaded dataset: the reset empties the per-column record, and the colour-by
    // annotation is unchanged, so nothing repopulates it.
    m.controller.resetForNewDataset();

    // "Hide above" picked before its bound moves constrains nothing, so the forward mirror
    // emits no condition and returns early. It must still record the position, or the next
    // unrelated edit pushes the `atLeast` default back onto the legend's mode select.
    m.controller.setEatReliability('family', { mode: 'atMost', min: 0, max: 1 });
    m.legend.setReliabilityState.mockClear();

    editQuery(m.queryBuilder, [
      { id: 'other', kind: 'numeric', annotation: 'length', operator: 'gt', min: 10 },
    ] as FilterQuery);

    expect(m.legend.setReliabilityState).not.toHaveBeenCalled();
  });

  it('guards the loop for a condition that is not first in the query', () => {
    // Every row after the first carries an `AND`, and the reliability condition is emitted
    // bare, so comparing the raw logicalOp made the guard miss.
    editQuery(m.queryBuilder, [
      { id: 'a', kind: 'categorical', annotation: 'family', values: ['A'] },
      {
        id: 'x',
        kind: 'numeric',
        annotation: EAT_KEY,
        operator: 'gte',
        min: 0.5,
        max: null,
        presence: [NA_VALUE],
        logicalOp: 'AND',
      },
    ]);

    const before = m.queryBuilder.query;
    m.controller.setEatReliability('family', { mode: 'atLeast', min: 0.5, max: 1 });

    // Identity, not equality: the guard must skip the rewrite entirely.
    expect(m.queryBuilder.query).toBe(before);
  });
});

describe('filter controller: per-base EAT reliability (multi-EAT)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeMultiEatData);
    m.dialog.open = true;
  });

  it('scopes the condition to the base: setting GO does not clobber EC', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    expect(numericCount(m.queryBuilder.query)).toBe(2);
    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.5,
    });
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.8,
    });
  });

  it('retuning one base rewrites only its own condition, preserving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0.3);

    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toMatchObject({ min: 0.3 });
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({ min: 0.8 });
    expect(numericCount(m.queryBuilder.query)).toBe(2);
  });

  it('dragging one base to 0 removes only its condition, leaving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0);

    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toBeUndefined();
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({ min: 0.8 });
  });

  it('an annotation change forces the mirror to the newly selected base', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    m.controller.setSelectedAnnotation('ec');
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.5 }),
    );

    // The pickers' annotation-change, heard on the root (the document in the app).
    fire(m.root, 'annotation-change', { annotation: 'go' });
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.8 }),
    );
  });
});

describe('filter controller: every reliability mode (#380)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, 'family');
    m.dialog.open = true;
  });

  // A hand-built condition on the eat-confidence column IS the reliability filter, whatever its
  // operator, so the slider must replace it rather than AND a contradictory one beside it.
  it.each([
    ['greater than', { operator: 'gt' as const, min: 0.5, max: null }],
    ['between', { operator: 'between' as const, min: 0.4, max: 0.9 }],
    ['non-negated less than', { operator: 'lt' as const, min: null, max: 0.5 }],
  ])('replaces a hand-built "%s" rather than appending beside it', (_name, seed) => {
    editQuery(m.queryBuilder, [{ id: 'x', kind: 'numeric', annotation: EAT_KEY, ...seed }]);

    threshold(m.controller, 'family', 0.5);

    expect(findConditionsForAnnotation(m.queryBuilder.query, EAT_KEY)).toHaveLength(1);
    // One coherent condition, not an unsatisfiable pair: the plot keeps points.
    expect(m.plot.filteredProteinIds.length).toBeGreaterThan(0);
  });

  it('never hides the curated points, in any mode', () => {
    const curated = ['p0', 'p1', 'p2', 'p3', 'p4'];
    for (const state of [
      { mode: 'atLeast' as const, min: 0.5, max: 1 },
      { mode: 'atMost' as const, min: 0, max: 0.5 },
      { mode: 'between' as const, min: 0.4, max: 0.8 },
    ]) {
      m.controller.setEatReliability('family', state);
      for (const id of curated) expect(m.plot.filteredProteinIds).toContain(id);
    }
  });

  it('applies an upper bound that actually removes the high-confidence points', () => {
    m.controller.setEatReliability('family', { mode: 'atMost', min: 0, max: 0.5 });
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95
    expect(m.plot.filteredProteinIds).toContain('p5'); // 0.25
  });

  it('applies a band from both sides', () => {
    m.controller.setEatReliability('family', { mode: 'between', min: 0.4, max: 0.6 });
    expect(m.plot.filteredProteinIds).not.toContain('p5'); // 0.25, below the band
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95, above the band
    expect(m.plot.filteredProteinIds).toContain('p10'); // 0.50, inside
  });

  it('finds and replaces a reliability condition nested in a group', () => {
    editQuery(m.queryBuilder, [
      {
        id: 'g',
        conditions: [
          {
            id: 'x',
            kind: 'numeric',
            annotation: EAT_KEY,
            operator: 'lt',
            min: null,
            max: 0.2,
            logicalOp: 'NOT',
          },
        ],
      },
    ] as FilterQuery);

    threshold(m.controller, 'family', 0.7);

    const conditions = findConditionsForAnnotation(m.queryBuilder.query, EAT_KEY);
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({ operator: 'gte', min: 0.7 });
  });
});
```

- [ ] **Step 15: Run it to see it fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/filter-controller.test.ts`
Expected: FAIL: `Failed to resolve import "./filter-controller"`.

- [ ] **Step 16: Write the controller**

Create `apps/web/src/explore/filter-controller.ts`:

```ts
import {
  conditionsForReliability,
  createCondition,
  evaluateQuery,
  findConditionsForAnnotation,
  hasConfiguredCondition,
  reliabilityFromConditions,
  replaceConditionsForAnnotation,
  sameConditions,
  type FilterQuery,
  type ProtspaceLegend,
  type ProtspaceQueryBuilder,
  type ProtspaceScatterplot,
  type PsDialog,
} from '@protspace/core';
import {
  DEFAULT_EAT_RELIABILITY,
  isEatConfidenceAnnotation,
  isSameReliability,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { setWorkbenchStatus } from './workbench-status';

/** Annotations shown only in the hover tooltip; the filter's column picker does not offer them. */
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);

interface FilterControllerOptions {
  plotElement: ProtspaceScatterplot;
  legendElement: ProtspaceLegend;
  queryBuilder: ProtspaceQueryBuilder;
  dialog: PsDialog;
  /** Where `annotation-change` is heard; the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export interface FilterController {
  /** Opens the Filter dialog on the current data, with one empty condition when there is none. */
  open(): void;
  /** The colouring annotation changed: move the reliability control to its column's state. */
  setSelectedAnnotation(annotation: string): void;
  /** The legend's reliability control: replaces its base's condition and applies the query. */
  setEatReliability(baseKey: string, state: EatReliabilityState): void;
  /** A new dataset has other proteins, so the query and the mirror record go. */
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * The filter the Filter dialog builds (design decision 9, moved from the control bar).
 *
 * A query applies through the plot's filter channel (`filteredProteinIds`, `filtersActive`),
 * which is idempotent: a filter is neither a selection nor an isolation (#257). Matched indices
 * are positions in the materialized snapshot the builder evaluated, never in the isolated
 * subset `getCurrentData()` returns.
 *
 * The legend's EAT reliability control and the query mirror each other, per eat-confidence
 * column (#6b, #380). Both directions compare against the last state recorded for that column, so
 * they cannot ping-pong, and a change on one base is never measured against another's.
 */
export function createFilterController({
  plotElement,
  legendElement,
  queryBuilder,
  dialog,
  root,
}: FilterControllerOptions): FilterController {
  let query: FilterQuery = [];
  let filterActive = false;
  let selectedAnnotation = '';
  /** The materialized snapshot the builder evaluates; refreshed on every plot data-change. */
  let snapshot: VisualizationData | undefined;
  const lastMirrored = new Map<string, EatReliabilityState>();

  const readSnapshot = (): VisualizationData | undefined =>
    plotElement.getMaterializedData() ?? plotElement.getCurrentData() ?? snapshot;

  const filterableAnnotations = (data: VisualizationData | undefined): string[] =>
    Object.keys(data?.annotations ?? {}).filter((key) => !TOOLTIP_ONLY_ANNOTATIONS.has(key));

  const publish = () =>
    setWorkbenchStatus({ appliedFilterConditions: filterActive ? query.length : 0 });

  /**
   * The builder re-counts the whole dataset whenever its data or query changes, so it gets them
   * only while the dialog shows it; open() hands it the latest.
   */
  const syncBuilder = () => {
    if (!dialog.open) return;
    queryBuilder.data = snapshot;
    queryBuilder.query = query;
  };

  const setQuery = (next: FilterQuery) => {
    query = next;
    syncBuilder();
    publish();
  };

  /**
   * Releases the filter channel so every protein returns, leaving isolation alone. Writes only
   * when something is set: a fresh `[]` over an empty one still rebuilds the plot's geometry.
   */
  const clearFilterChannel = () => {
    if (plotElement.filtersActive || (plotElement.filteredProteinIds?.length ?? 0) > 0) {
      plotElement.filteredProteinIds = [];
      plotElement.filtersActive = false;
    }
    filterActive = false;
    publish();
  };

  const applyMatchedIndices = (matchedIndices: Set<number>) => {
    const proteinIds = snapshot?.protein_ids;
    if (!proteinIds) return;
    // One pass, no intermediates: this runs on every slider commit at Swiss-Prot scale.
    const matchedIds: string[] = [];
    for (const index of matchedIndices) {
      const id = proteinIds[index];
      if (id !== undefined) matchedIds.push(id);
    }
    // An empty active channel reads as "nothing is visible", with no way back: leave the plot
    // unfiltered instead; the builder still reports the 0 count (#380).
    if (matchedIds.length === 0) {
      clearFilterChannel();
      return;
    }
    plotElement.filteredProteinIds = matchedIds;
    plotElement.filtersActive = true;
    filterActive = true;
    publish();
  };

  /** Evaluates the query on the snapshot and applies it, or clears the channel when it is empty. */
  const applyQuery = () => {
    if (!snapshot) return;
    if (!hasConfiguredCondition(query)) {
      clearFilterChannel();
      return;
    }
    applyMatchedIndices(evaluateQuery(query, snapshot));
  };

  /** The eat-confidence column whose runtime base is `baseKey`, if any. */
  const findEatKey = (baseKey: string): string | undefined => {
    for (const [key, annotation] of Object.entries(snapshot?.annotations ?? {})) {
      if (isEatConfidenceAnnotation(annotation) && annotation.runtime?.baseAnnotation === baseKey) {
        return key;
      }
    }
    return undefined;
  };

  /**
   * Reverse mirror: tells the legend what the query says for the selected base. `force` repositions
   * the control after an annotation change even when this base's state is unchanged.
   */
  const mirrorToLegend = (force = false) => {
    const key = findEatKey(selectedAnnotation);
    if (!key) return;
    const derived = reliabilityFromConditions(findConditionsForAnnotation(query, key));
    // No record yet: nothing moved this column off its resting position, which the legend shows.
    const last = lastMirrored.get(key) ?? DEFAULT_EAT_RELIABILITY;
    if (!force && isSameReliability(last, derived)) return;
    lastMirrored.set(key, derived);
    legendElement.setReliabilityState(derived);
  };

  const setSelectedAnnotation = (annotation: string) => {
    if (annotation === selectedAnnotation) return;
    selectedAnnotation = annotation;
    snapshot = readSnapshot();
    mirrorToLegend(true);
  };

  const onQueryChanged = (event: Event) => {
    setQuery((event as CustomEvent<{ query: FilterQuery }>).detail.query);
    // A direct edit of the query moves the legend's reliability control (#6b).
    mirrorToLegend();
  };

  const onQueryApply = (event: Event) => {
    applyMatchedIndices((event as CustomEvent<{ matchedIndices: Set<number> }>).detail.matchedIndices);
    dialog.open = false;
  };

  const onQueryReset = () => {
    clearFilterChannel();
    // A fresh row to start the next query; the dialog stays open.
    setQuery([createCondition()]);
    // A full reset drops any reliability condition too: pull the legend control back.
    mirrorToLegend();
  };

  /** The builder's Cancel: close, keeping the edits for the next opening. */
  const onQueryClose = () => {
    dialog.open = false;
  };

  const onAnnotationChange = (event: Event) => {
    const annotation = (event as CustomEvent<{ annotation?: unknown }>).detail?.annotation;
    if (typeof annotation === 'string') setSelectedAnnotation(annotation);
  };

  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: VisualizationData | null }>).detail?.data;
    if (!data) return;
    snapshot = plotElement.getMaterializedData() ?? plotElement.getCurrentData() ?? undefined;
    if (!dialog.open) return;
    queryBuilder.annotations = filterableAnnotations(snapshot);
    queryBuilder.data = snapshot;
  };

  queryBuilder.addEventListener('query-changed', onQueryChanged);
  queryBuilder.addEventListener('query-apply', onQueryApply);
  queryBuilder.addEventListener('query-reset', onQueryReset);
  queryBuilder.addEventListener('query-close', onQueryClose);
  root.addEventListener('annotation-change', onAnnotationChange);
  plotElement.addEventListener('data-change', onDataChange);

  return {
    open() {
      snapshot = readSnapshot();
      // Seed one empty condition so the user sees a row at once.
      if (query.length === 0) query = [createCondition()];
      queryBuilder.annotations = filterableAnnotations(snapshot);
      queryBuilder.data = snapshot;
      queryBuilder.query = query;
      dialog.open = true;
    },
    setSelectedAnnotation,
    setEatReliability(baseKey, state) {
      // Resync first: on a dataset switch the slider can fire before data-change refreshes the
      // snapshot, and stale indices would map onto the previous dataset.
      snapshot = readSnapshot();
      const key = findEatKey(baseKey);
      if (!key) return;
      const existing = findConditionsForAnnotation(query, key);
      // A reliability state is one un-negated condition, or none at all.
      const nextConditions = conditionsForReliability(key, state, existing[0]?.id);
      const [replacement = null] = nextConditions;
      // Record what the query will READ BACK as, before the guard below: state -> conditions is
      // not injective, and a mode that constrains nothing still has a position to keep.
      lastMirrored.set(key, reliabilityFromConditions(nextConditions));
      // The query already expresses this state for THIS base: re-applying could ping-pong.
      if (sameConditions(existing, nextConditions)) return;
      setQuery(replaceConditionsForAnnotation(query, key, replacement));
      applyQuery();
    },
    resetForNewDataset() {
      // The plot's own filter channel is reset with its data (data-renderer applyPlotState).
      query = [];
      filterActive = false;
      lastMirrored.clear();
      syncBuilder();
      publish();
    },
    dispose() {
      queryBuilder.removeEventListener('query-changed', onQueryChanged);
      queryBuilder.removeEventListener('query-apply', onQueryApply);
      queryBuilder.removeEventListener('query-reset', onQueryReset);
      queryBuilder.removeEventListener('query-close', onQueryClose);
      root.removeEventListener('annotation-change', onAnnotationChange);
      plotElement.removeEventListener('data-change', onDataChange);
    },
  };
}
```

- [ ] **Step 17: Run the controller tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/filter-controller.test.ts src/explore/workbench-status.test.ts`
Expected: PASS, 31 tests in `filter-controller.test.ts` (12 + 8 + 4 + 7, the `it.each` counting three) and the workbench-status file.

- [ ] **Step 18: Write the failing e2e spec**

Create `apps/web/tests/workbench-filter.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import {
  filterButton,
  filterDialog,
  getFirstLegendItemValue,
  getProteinCount,
  getViewState,
  openExplore,
  openFilter,
  queryBuilder,
} from './helpers/explore';

/** The plot's filter channel: whether it is on, and how many proteins it keeps. */
function readPlotFilter(page: Page): Promise<{ filtersActive: boolean; kept: number }> {
  return page.locator('#myPlot').evaluate((plot) => {
    const host = plot as Element & { filtersActive?: boolean; filteredProteinIds?: string[] };
    return { filtersActive: host.filtersActive === true, kept: host.filteredProteinIds?.length ?? 0 };
  });
}

const quoted = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Filters the plot to the legend's first category of the colouring annotation, through the UI. */
async function applyFirstCategoryFilter(page: Page): Promise<void> {
  const { annotation } = await getViewState(page);
  const value = await getFirstLegendItemValue(page);
  await openFilter(page);
  const row = queryBuilder(page).locator('protspace-query-condition-row').first();
  await row.locator('.annotation-select-trigger').click();
  await queryBuilder(page)
    .locator(`.annotation-picker-item[data-annotation="${quoted(annotation ?? '')}"]`)
    .first()
    .click();
  await row.locator('.value-chip-add').click();
  await queryBuilder(page)
    .locator(`.value-picker-item[data-value="${quoted(value)}"]`)
    .first()
    .click();
  // A click elsewhere in the dialog closes the value picker, as it always has.
  await queryBuilder(page).locator('.match-count').click();
  await queryBuilder(page).getByRole('button', { name: 'Apply Filter' }).click();
}

test.describe('the Filter dialog', () => {
  test('Filter opens a dialog named Filter with the query builder; Escape closes it and returns focus to Filter', async ({
    page,
  }) => {
    await openExplore(page);
    await filterButton(page).click();

    const dialog = filterDialog(page);
    await expect(dialog).toBeVisible();
    await expect(queryBuilder(page)).toBeVisible();
    // The dialog names it, so the embedded builder shows no title or close button of its own.
    await expect(queryBuilder(page).getByText('Filter Query', { exact: true })).toHaveCount(0);
    await expect(
      queryBuilder(page).getByRole('button', { name: 'Close filter query builder' }),
    ).toHaveCount(0);
    await expect(queryBuilder(page).locator('.match-count')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(filterButton(page)).toBeFocused();
  });

  test('applying a condition filters the plot and shows the count on Filter', async ({ page }) => {
    await openExplore(page);
    const total = await getProteinCount(page);
    await expect(filterButton(page)).toHaveAccessibleName('Filter');

    await applyFirstCategoryFilter(page);

    await expect(filterDialog(page)).toBeHidden();
    await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
    const plot = await readPlotFilter(page);
    expect(plot.filtersActive).toBe(true);
    expect(plot.kept).toBeGreaterThan(0);
    expect(plot.kept).toBeLessThan(total);
  });

  test('Reset clears the filter and keeps the dialog open', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(true);

    await openFilter(page);
    await queryBuilder(page).getByRole('button', { name: 'Reset All' }).click();

    await expect(filterDialog(page)).toBeVisible();
    await expect.poll(async () => (await readPlotFilter(page)).filtersActive).toBe(false);
    await page.keyboard.press('Escape');
    await expect(filterButton(page)).toHaveAccessibleName('Filter');
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-filter.spec.ts` (sandbox disabled: the web server binds a port)
Expected: FAIL, 3 tests: Step 10 removed the control bar's Filter button and the view bar has no `#myFilterButton` yet, so `filterButton(page)` (still Task 2.3's helper) times out.

- [ ] **Step 19: Mount the Filter button and dialog in the view bar**

Create `apps/web/src/workbench/FilterControl.tsx`:

```tsx
import { Filter } from 'lucide-react';
import { useWorkbenchStatus } from './use-workbench-status';

/**
 * The view bar's Filter button and the dialog it opens (decision 14 moves the filter into the
 * sidebar in 4.4). Both are runtime elements: the runtime wires the button's click to the filter
 * controller, which opens and closes the dialog. They are siblings, so the view bar can hide the
 * button without hiding the dialog.
 */
export function FilterControl() {
  const { appliedFilterConditions: count } = useWorkbenchStatus();
  return (
    <>
      <ps-button id="myFilterButton" variant="ghost">
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Filter size={16} strokeWidth={1.75} />
        </span>
        Filter
        {count > 0 && (
          <>
            <span className="wb-filter-count" aria-hidden="true">
              {count}
            </span>
            <span className="sr-only">
              , {count} {count === 1 ? 'condition' : 'conditions'} applied
            </span>
          </>
        )}
      </ps-button>
      <ps-dialog id="myFilterDialog" heading="Filter" size="lg">
        <protspace-query-builder id="myQueryBuilder" embedded></protspace-query-builder>
      </ps-dialog>
    </>
  );
}
```

In `apps/web/src/workbench/ViewBar.tsx`, add `import { FilterControl } from './FilterControl';` and render `<FilterControl />` immediately after the `<protspace-control-bar id="myControlBar" …></protspace-control-bar>` element, inside the same `div[role="toolbar"]`.

In `apps/web/src/custom-elements.d.ts`, add inside `interface IntrinsicElements` (next to the other `protspace-*` entries):

```ts
      'protspace-query-builder': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          embedded?: boolean;
        },
        HTMLElement
      >;
```

Append to `apps/web/src/workbench/workbench.css`:

```css
/* Filter (Task 2.6): the count of applied conditions beside the label. */
.wb-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: var(--ps-radius-full);
  background: var(--ps-accent-tint);
  color: var(--ps-accent-text);
  font-size: var(--ps-text-xs);
  font-weight: var(--ps-weight-medium);
  font-variant-numeric: tabular-nums;
}
```

If Task 2.2's `workbench.css` has no `.wb-icon` rule, append one too, so slotted Lucide icons sit on the text's centre line:

```css
.wb-icon {
  display: inline-flex;
}
```

- [ ] **Step 20: Wire the runtime**

In `apps/web/src/explore/elements.ts`:

- add `ProtspaceQueryBuilder`, `PsButton` and `PsDialog` to the `import type { … } from '@protspace/core'` list;
- add to `interface ExploreElements`:

```ts
  queryBuilder: ProtspaceQueryBuilder;
  filterDialog: PsDialog;
  filterButton: PsButton;
```

- add `'protspace-query-builder'` and `'ps-dialog'` to `REQUIRED_TAGS`;
- in `getElements`, look the three up beside the others:

```ts
  const queryBuilder = doc.getElementById('myQueryBuilder') as ProtspaceQueryBuilder | null;
  const filterDialog = doc.getElementById('myFilterDialog') as PsDialog | null;
  const filterButton = doc.getElementById('myFilterButton') as PsButton | null;
```

and add `!queryBuilder || !filterDialog || !filterButton` to the missing-element condition, the three names to the `console.error` object and to the returned object.

In `apps/web/src/explore/runtime.ts`:

1. Add `import { createFilterController } from './filter-controller';` beside the other `./` imports.
2. Add `queryBuilder, filterDialog, filterButton` to the destructuring `const { … } = elements;`.
3. Directly after `const interactionController = createInteractionController({ … });`, add:

```ts
  const filterController = createFilterController({
    plotElement,
    legendElement,
    queryBuilder,
    dialog: filterDialog,
    root: document,
  });
  lifecycle.addCleanup(() => filterController.dispose());
  addTrackedEventListener(lifecycle, filterButton, 'click', () => filterController.open());
```

The `ExploreControls` object (Task 2.5's `const controls`) calls `filterController` below, so it must be declared after this block; if it is above it, move it down (it only needs to stay above `createDatasetController(…)`, which takes it).

4. In the `ExploreControls` object, add `filterController.resetForNewDataset();` as the last statement of `resetForNewDataset()`, and `filterController.setSelectedAnnotation(view.annotation);` as the last statement of `showInitialView(view)`.
5. Replace the reliability mirror (today :342-361, from the comment `// Two-way reliability mirror (#6b)` to the end of the `eat-threshold-mirror` listener) with:

```ts
  // The legend's reliability control drives the shared `EAT_confidence >= x or N/A` filter
  // condition; the filter controller moves the control back when the query changes (#6b).
  addTrackedEventListener(lifecycle, legendElement, 'eat-overlay-change', (event: Event) => {
    // The full state (mode + both bounds) reaches the query: the scalar threshold alone cannot
    // express "hide above" or "keep between".
    const { reliability } = (
      event as CustomEvent<{
        enabled: boolean;
        confidenceThreshold: number;
        reliability: EatReliabilityState;
      }>
    ).detail;
    filterController.setEatReliability(legendElement.selectedAnnotation, reliability);
  });
```

In `apps/web/tests/helpers/explore.ts`, replace the bodies of the three filter helpers (keep their exported names and signatures):

```ts
/** The view bar's Filter button; its name reads "Filter" or "Filter, N conditions applied". */
export function filterButton(page: Page): Locator {
  return viewBar(page).getByRole('button', { name: /^Filter/ });
}

/** The Filter dialog (`ps-dialog` headed "Filter"). */
export function filterDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Filter', exact: true });
}

/** Opens the Filter dialog, unless it is open already. */
export async function openFilter(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const dialog = filterDialog(page);
  if (await dialog.isVisible().catch(() => false)) return;
  await filterButton(page).click();
  await expect(dialog).toBeVisible();
}
```

In `apps/web/tests/eat-visualization.spec.ts`, test 'renders and explores EAT transfers from the real phosphatase bundle': if its three Filter assertions (today :339, :346, :353) still read the control bar's `filter-active` class, replace them, in order, with

```ts
  await expect(filterButton(page)).toHaveAccessibleName('Filter');
```

```ts
  await expect(filterButton(page)).toHaveAccessibleName('Filter, 1 condition applied');
```

```ts
  await expect(filterButton(page)).toHaveAccessibleName('Filter');
```

(the slider's reliability condition is the one applied condition), importing `filterButton` from `./helpers/explore` and deleting the now-unused `filterButton` local if Task 2.3 left one. If Task 2.3 already rewrote them to read the plot's `filtersActive`, leave them.

- [ ] **Step 21: Run the e2e spec**

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-filter.spec.ts` (sandbox disabled)
Expected: PASS, 3 tests.

- [ ] **Step 22: Run the suites this task touches**

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS; unit and browser counts as in Step 11.

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; the baseline plus `filter-controller.test.ts` and the new workbench-status test.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-filter.spec.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/numeric-binning.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/workbench-shell.spec.ts` (sandbox disabled)
Expected: PASS. In `numeric-binning.spec.ts`, Cancel now closes the dialog through `query-close`, and Reset All keeps it open, as before.

Run: `pnpm perf:counts` (sandbox disabled; needs `perf/datasets/phosphatase.parquetbundle`)
Expected: PASS within budget. The filter controller's `data-change` listener reads the plot's memoized materialized data, which counts no work.

Run: `pnpm --filter @protspace/app build`
Expected: the build succeeds.

- [ ] **Step 23: Commit**

Run: `pnpm exec prettier --check packages/core/src/components/control-bar packages/core/src/index.ts apps/web/src/explore apps/web/src/workbench apps/web/src/custom-elements.d.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-filter.spec.ts apps/web/tests/eat-visualization.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not, then re-check).

```bash
git add packages/core/src/components/control-bar/query-builder.ts \
  packages/core/src/components/control-bar/query-builder.styles.ts \
  packages/core/src/components/control-bar/query-builder.test.ts \
  packages/core/src/components/control-bar/query-value-picker.ts \
  packages/core/src/components/control-bar/query-value-picker.test.ts \
  packages/core/src/components/control-bar/query-condition-row.ts \
  packages/core/src/components/control-bar/query-condition-row.test.ts \
  packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar.query-apply.test.ts \
  packages/core/src/components/control-bar/annotation-select.component.test.ts \
  packages/core/src/index.ts \
  apps/web/src/explore/filter-controller.ts apps/web/src/explore/filter-controller.test.ts \
  apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts \
  apps/web/src/explore/runtime.ts apps/web/src/explore/elements.ts \
  apps/web/src/workbench/FilterControl.tsx apps/web/src/workbench/ViewBar.tsx \
  apps/web/src/workbench/workbench.css apps/web/src/custom-elements.d.ts \
  apps/web/tests/helpers/explore.ts apps/web/tests/workbench-filter.spec.ts \
  apps/web/tests/eat-visualization.spec.ts
git commit -m "feat(web): open the filter in a dialog with its own controller"
```

(`git commit` needs the sandbox disabled; the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.7: Projection and Contours pickers

The view bar's two new pickers are built as one-job elements (decision 9): `protspace-projection-select` and `protspace-contours-menu`, each a `ps-menu` of radio items behind a ghost key/value trigger. A pick shows at once and reaches listeners after the next paint. `ps-menu` learns to find its focused item when it lives in another element's shadow root, and the contour modes' menu copy moves to `@protspace/utils` so the shell can name them too. This task is core and utils only and purely additive: Task 2.8 mounts the pickers in the view bar and wires them, so the app and the e2e suite do not change here.

**Files:**

- Create: `packages/core/src/components/projection-select/projection-select.ts`, `projection-select.styles.ts`, `projection-select.browser.test.ts`
- Create: `packages/core/src/components/contours-menu/contours-menu.ts`, `contours-menu.styles.ts`, `contours-menu.browser.test.ts`
- Modify: `packages/core/src/components/kit/menu.ts` (`onKeydown` :275) and `menu.browser.test.ts`: `ps-menu` reads the focused item from `document.activeElement`, which names the outer host when the menu lives in a shadow root, so arrows and Enter did nothing in the pickers. Skip the code change if a phase 1 fix already reads the menu's root node.
- Modify: `packages/core/src/components/kit/icon.ts` (`target`), `packages/utils/src/types.ts` (`DENSITY_MODE_LABELS`), `packages/core/src/index.ts` (the pickers' exports)

**Interfaces:**

- Consumes: `AfterPaintCommit` (`packages/core/src/utils/after-paint-commit.ts`); `ps-button` (forwards `aria-haspopup` and `aria-expanded` from its host), `ps-menu` (sets `aria-haspopup`/`aria-expanded` on its anchor; closes itself, then dispatches `ps-select` `{ value, checked }`; `ps-close`), `ps-menu-item`, `ps-tooltip`, `icon`; `DensityLayerMode`, `DENSITY_LAYER_MODES`, `DENSITY_DEFAULT` (`@protspace/utils`).
- Produces (utils): `DENSITY_MODE_LABELS: Readonly<Record<DensityLayerMode, { readonly label: string; readonly hint: string }>>` in `packages/utils/src/types.ts` (exported through `export * from './types'`): `off` "Off" / "No contours", `auto` "Auto" / "Fades out as you zoom in; faint or hidden when few points are shown", `on` "Always" / "Full strength at every zoom level". The tokens stay `off`, `auto` and `on` (URL, config).
- Produces (core):
  - `<protspace-projection-select id="myProjectionSelect">`, class `ProtspaceProjectionSelect`: `projections: readonly string[]` (property), `selectedProjection` (`selected-projection`); `applySelection(projection: string): void` (sets the value, drops a waiting pick, dispatches at once); `cancelPending(): void`; event `projection-change` `{ projection: string }` (bubbles, composed); a user pick shows at once and dispatches after the next paint; the trigger's name starts with "Projection" and includes the value. The key and value are `part="key"` and `part="value"`.
  - `<protspace-contours-menu id="myContoursMenu">`, class `ProtspaceContoursMenu`: `densityLayer: DensityLayerMode` (`density-layer`); `pick(mode: DensityLayerMode): void` (a user pick from code: shows at once, dispatches after the paint; the More menu uses it in Task 2.10); `applySelection(mode): void` (no event); `cancelPending(): void`; event `density-layer-change` with `detail: DensityLayerChangeDetail` (`export interface DensityLayerChangeDetail { densityLayer: DensityLayerMode }`, declared here; `control-bar.events.ts` keeps its own copy until Task 2.8 deletes it, and the core index never exported that one, so nothing clashes); radio items Off, Auto and Always with their hints from `DENSITY_MODE_LABELS`; the trigger's name starts with "Contours" ("Contours Off", "Contours Auto", "Contours Always"); the key is `part="key"`; a `ps-tooltip` on the trigger keeps today's note "One ring set per legend colour; not included in exports."
  - `ps-menu`'s keyboard handling finds the focused item through its own root node.
  - The core index exports `ProtspaceProjectionSelect`, `ProtspaceContoursMenu` and `type DensityLayerChangeDetail`.

**Tests:**

- `projection-select.browser.test.ts`: "lists the projections as radio items and checks the selected one"; "a pick shows at once and dispatches projection-change after the next paint"; "applySelection dispatches at once and drops a waiting pick"; "Enter opens, arrows move, Escape closes and focus returns to the trigger"; "the trigger's name starts with Projection and holds the value".
- `contours-menu.browser.test.ts`: "offers Off, Auto and Always with their hints"; "a menu pick dispatches density-layer-change after the paint"; "pick from code behaves like a menu pick"; "applySelection changes the value without an event"; "the trigger's name starts with Contours".
- `menu.browser.test.ts`: "moves with the arrow keys and selects with Enter inside another element's shadow root".
- The core and utils suites stay green; the app and e2e suites are untouched (nothing mounts the pickers yet).

Before you start, record the baseline counts from the phase 2 ledger. Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`.

- [ ] **Step 1: Write the failing ps-menu test**

The pickers render `ps-menu` inside their own shadow root. Keyboard focus is then on a `ps-menu-item` in that shadow root, and `document.activeElement` names the picker's host instead, so `ps-menu`'s arrow keys always jump to the first item and Enter selects nothing.

Append to `packages/core/src/components/kit/menu.browser.test.ts` (the file already imports `vi`, `PsMenu`, `PsMenuItem` and defines `frame`):

```ts
describe('ps-menu inside another element’s shadow root', () => {
  it('moves with the arrow keys and selects with Enter inside another element’s shadow root', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <button id="anchor">Projection</button>
      <ps-menu label="Projection">
        <ps-menu-item value="umap" type="radio" checked>UMAP</ps-menu-item>
        <ps-menu-item value="pca" type="radio">PCA</ps-menu-item>
      </ps-menu>`;
    const menu = root.querySelector('ps-menu') as PsMenu;
    menu.anchor = root.getElementById('anchor');
    menu.open = true;
    await menu.updateComplete;
    await frame();
    await frame();
    const deepKey = (name: string) =>
      (root.activeElement ?? host).dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }),
      );
    const focusedValue = () => (root.activeElement as PsMenuItem | null)?.value;

    expect(focusedValue()).toBe('umap');
    deepKey('ArrowDown');
    expect(focusedValue()).toBe('pca');

    const onSelect = vi.fn();
    menu.addEventListener('ps-select', onSelect);
    deepKey('Enter');
    expect(onSelect).toHaveBeenCalledOnce();
    expect((onSelect.mock.calls[0][0] as CustomEvent).detail).toEqual({ value: 'pca', checked: true });
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/menu.browser.test.ts` (sandbox disabled)
Expected: FAIL on `expect(focusedValue()).toBe('pca')` (received `"umap"`). If it passes, a phase 1 fix already reads the menu's root node: skip Step 2 and keep the test.

- [ ] **Step 2: Read the focused item from the menu's own tree**

In `packages/core/src/components/kit/menu.ts`, `onKeydown`, replace

```ts
    const current = items.indexOf(document.activeElement as PsMenuItem);
```

with

```ts
    // Items live in the menu's own tree, which is a shadow root when a feature element renders
    // the menu (the view bar's pickers); document.activeElement would name that element instead.
    const focused = (this.getRootNode() as Document | ShadowRoot).activeElement;
    const current = items.indexOf(focused as PsMenuItem);
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/menu.browser.test.ts` (sandbox disabled)
Expected: PASS, every menu test including the new one.

- [ ] **Step 3: Add the Contours icon**

In `packages/core/src/components/kit/icon.ts`, add `Target` to the `lucide` import and this key to `ICONS` (alphabetical with the rest):

```ts
  target: Target,
```

(The projection details' `info` icon arrives with its first use in Task 2.8.)

- [ ] **Step 4: Write the failing projection-select tests**

Create `packages/core/src/components/projection-select/projection-select.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import type { ProtspaceProjectionSelect } from './projection-select';
import './projection-select';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Resolves in the task after the next frame: a pick made now has been committed by then. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function mount(): Promise<ProtspaceProjectionSelect> {
  const el = document.createElement('protspace-projection-select');
  el.projections = ['UMAP', 'PCA', 't-SNE'];
  el.selectedProjection = 'UMAP';
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const innerButton = (el: ProtspaceProjectionSelect) =>
  el.shadowRoot!.querySelector('.trigger')!.shadowRoot!.querySelector('button')!;
const menu = (el: ProtspaceProjectionSelect) => el.shadowRoot!.querySelector('ps-menu') as PsMenu;
const items = (el: ProtspaceProjectionSelect) => [
  ...el.shadowRoot!.querySelectorAll<PsMenuItem>('ps-menu-item'),
];
const shownValue = (el: ProtspaceProjectionSelect) =>
  el.shadowRoot!.querySelector('.value')!.textContent!.trim();
async function settle(el: ProtspaceProjectionSelect): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}
async function openMenu(el: ProtspaceProjectionSelect): Promise<void> {
  innerButton(el).click();
  await settle(el);
}

describe('protspace-projection-select', () => {
  it('lists the projections as radio items and checks the selected one', async () => {
    const el = await mount();
    await openMenu(el);
    expect(menu(el).open).toBe(true);
    expect(
      items(el).map((item) => [item.textContent!.trim(), item.getAttribute('role'), item.checked]),
    ).toEqual([
      ['UMAP', 'menuitemradio', true],
      ['PCA', 'menuitemradio', false],
      ['t-SNE', 'menuitemradio', false],
    ]);
  });

  it('a pick shows at once and dispatches projection-change after the next paint', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('projection-change', onChange);
    await openMenu(el);

    items(el)[1].click();
    await el.updateComplete;

    expect(shownValue(el)).toBe('PCA');
    expect(menu(el).open).toBe(false);
    expect(el.selectedProjection).toBe('UMAP');
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();

    expect(el.selectedProjection).toBe('PCA');
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ projection: 'PCA' });
  });

  it('applySelection dispatches at once and drops a waiting pick', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('projection-change', onChange);
    await openMenu(el);
    items(el)[1].click();

    el.applySelection('t-SNE');

    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ projection: 't-SNE' });
    await afterNextPaint();
    await el.updateComplete;
    expect(onChange).toHaveBeenCalledOnce();
    expect(el.selectedProjection).toBe('t-SNE');
    expect(shownValue(el)).toBe('t-SNE');
  });

  it('Enter opens, arrows move, Escape closes and focus returns to the trigger', async () => {
    const el = await mount();
    innerButton(el).focus();

    await userEvent.keyboard('{Enter}');
    await settle(el);
    expect(menu(el).open).toBe(true);
    expect(deepActiveElement()).toBe(items(el)[0]);

    await userEvent.keyboard('{ArrowDown}');
    expect(deepActiveElement()).toBe(items(el)[1]);

    await userEvent.keyboard('{Escape}');
    await settle(el);
    expect(menu(el).open).toBe(false);
    expect(deepActiveElement()).toBe(innerButton(el));
  });

  it("the trigger's name starts with Projection and holds the value", async () => {
    const el = await mount();
    await expect
      .element(page.getByRole('button', { name: 'Projection UMAP', exact: true }))
      .toBeInTheDocument();
    // ps-menu marks its anchor, and ps-button forwards the state to its inner button.
    expect(innerButton(el).getAttribute('aria-haspopup')).toBe('menu');
    expect(innerButton(el).getAttribute('aria-expanded')).toBe('false');
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/projection-select/projection-select.browser.test.ts` (sandbox disabled)
Expected: FAIL: `Failed to resolve import "./projection-select"`.

- [ ] **Step 5: Write the projection picker**

Create `packages/core/src/components/projection-select/projection-select.styles.ts`:

```ts
import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

/** The view bar's key/value trigger: key muted, value medium and truncated, chevron faint. */
export const projectionSelectStyles = [
  kitHost,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .key {
      color: var(--ps-text-muted);
      font-weight: 400;
    }
    .value {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
    }
    .chevron {
      display: inline-flex;
      color: var(--ps-text-faint);
    }
  `,
];
```

Create `packages/core/src/components/projection-select/projection-select.ts`:

```ts
import { LitElement, html } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import { projectionSelectStyles } from './projection-select.styles';

/**
 * The view bar's Projection picker (design decision 9): a ghost key/value trigger over a menu of
 * radio items. A pick shows at once and reaches listeners as `projection-change` after the next
 * paint, because a switch moves every point; `applySelection` applies at once.
 *
 * @fires projection-change - `{ projection: string }`, bubbling and composed.
 */
@customElement('protspace-projection-select')
export class ProtspaceProjectionSelect extends LitElement {
  static styles = projectionSelectStyles;

  /** The projections to offer, by name, in menu order. */
  @property({ attribute: false }) projections: readonly string[] = [];
  /** The projection the plot shows. */
  @property({ attribute: 'selected-projection' }) selectedProjection = '';

  @state() private open = false;
  /** A menu pick waiting for its commit; the trigger shows it until then. */
  @state() private pending: string | null = null;

  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-menu') private menu!: PsMenu;
  private readonly commit = new AfterPaintCommit();

  /** Makes `projection` current now, drops a pick still waiting, and dispatches the change. */
  applySelection(projection: string): void {
    this.commit.cancel();
    this.pending = null;
    this.selectedProjection = projection;
    this.dispatchEvent(
      new CustomEvent('projection-change', {
        detail: { projection },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Drops a pick still waiting, as a new dataset does. */
  cancelPending(): void {
    this.commit.cancel();
    this.pending = null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelPending();
  }

  protected firstUpdated(): void {
    // Set once, so the menu marks the trigger with aria-haspopup before the first opening.
    this.menu.anchor = this.trigger;
  }

  render() {
    const shown = this.pending ?? this.selectedProjection;
    return html`
      <ps-button
        class="trigger"
        variant="ghost"
        ?disabled=${this.projections.length === 0}
        @click=${this.toggle}
      >
        <span class="key" part="key">Projection</span>
        <span class="value" part="value">${shown || 'None'}</span>
        <span slot="end" class="chevron">${icon('chevron-down', 14)}</span>
      </ps-button>
      <ps-menu
        label="Projection"
        .open=${this.open}
        @ps-select=${this.onSelect}
        @ps-close=${this.onClose}
      >
        ${this.projections.map(
          (projection) =>
            html`<ps-menu-item type="radio" value=${projection} .checked=${projection === shown}
              >${projection}</ps-menu-item
            >`,
        )}
      </ps-menu>
    `;
  }

  private toggle = () => {
    this.open = !this.open;
  };

  private onSelect = (event: Event) => {
    // The picker's own event is projection-change; the menu's events stay inside.
    event.stopPropagation();
    const { value } = (event as CustomEvent<{ value: string }>).detail;
    this.open = false;
    this.pending = value;
    this.commit.schedule(() => this.applySelection(value));
  };

  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-projection-select': ProtspaceProjectionSelect;
  }
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/projection-select/projection-select.browser.test.ts` (sandbox disabled)
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing contours-menu tests**

Create `packages/core/src/components/contours-menu/contours-menu.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsMenu, PsMenuItem } from '../kit/menu';
import type { ProtspaceContoursMenu } from './contours-menu';
import './contours-menu';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function mount(): Promise<ProtspaceContoursMenu> {
  const el = document.createElement('protspace-contours-menu');
  document.body.append(el);
  await el.updateComplete;
  return el;
}
const innerButton = (el: ProtspaceContoursMenu) =>
  el.shadowRoot!.querySelector('.trigger')!.shadowRoot!.querySelector('button')!;
const menu = (el: ProtspaceContoursMenu) => el.shadowRoot!.querySelector('ps-menu') as PsMenu;
const items = (el: ProtspaceContoursMenu) => [
  ...el.shadowRoot!.querySelectorAll<PsMenuItem>('ps-menu-item'),
];
const shownValue = (el: ProtspaceContoursMenu) =>
  el.shadowRoot!.querySelector('.value')!.textContent!.trim();
async function openMenu(el: ProtspaceContoursMenu): Promise<void> {
  innerButton(el).click();
  await el.updateComplete;
  await frame();
  await frame();
}

describe('protspace-contours-menu', () => {
  it('offers Off, Auto and Always with their hints', async () => {
    const el = await mount();
    await openMenu(el);
    expect(
      items(el).map((item) => [
        item.value,
        item.querySelector('.item-label')!.textContent!.trim(),
        item.querySelector('.hint')!.textContent!.trim(),
        item.checked,
      ]),
    ).toEqual([
      ['off', 'Off', 'No contours', true],
      ['auto', 'Auto', 'Fades out as you zoom in; faint or hidden when few points are shown', false],
      ['on', 'Always', 'Full strength at every zoom level', false],
    ]);
  });

  it('a menu pick dispatches density-layer-change after the paint', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);
    await openMenu(el);

    items(el)[1].click();
    await el.updateComplete;

    expect(el.densityLayer).toBe('auto');
    expect(shownValue(el)).toBe('Auto');
    expect(menu(el).open).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();
    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'auto' });
  });

  it('pick from code behaves like a menu pick', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);

    el.pick('on');
    await el.updateComplete;
    expect(shownValue(el)).toBe('Always');
    expect(onChange).not.toHaveBeenCalled();

    await afterNextPaint();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'on' });
  });

  it('applySelection changes the value without an event', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('density-layer-change', onChange);

    el.pick('on');
    el.applySelection('auto');
    await el.updateComplete;
    await afterNextPaint();

    expect(el.densityLayer).toBe('auto');
    expect(shownValue(el)).toBe('Auto');
    // The waiting pick was dropped, and an apply from outside dispatches nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the trigger's name starts with Contours", async () => {
    const el = await mount();
    await expect
      .element(page.getByRole('button', { name: 'Contours Off', exact: true }))
      .toBeInTheDocument();
    el.applySelection('on');
    await el.updateComplete;
    await expect
      .element(page.getByRole('button', { name: 'Contours Always', exact: true }))
      .toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/contours-menu/contours-menu.browser.test.ts` (sandbox disabled)
Expected: FAIL: `Failed to resolve import "./contours-menu"`.

- [ ] **Step 7: Write the contours menu**

The menu copy lives in `@protspace/utils`, so the shell's More menu (Task 2.10) can name the modes the same way without loading core before the first paint. In `packages/utils/src/types.ts`, directly after `export const DENSITY_DEFAULT: DensityLayerMode = 'off';`, add:

```ts
/** Menu copy per contour mode; the tokens stay off/auto/on (URL, config), only 'on' reads as 'Always'. */
export const DENSITY_MODE_LABELS: Readonly<
  Record<DensityLayerMode, { readonly label: string; readonly hint: string }>
> = {
  off: { label: 'Off', hint: 'No contours' },
  auto: {
    label: 'Auto',
    hint: 'Fades out as you zoom in; faint or hidden when few points are shown',
  },
  on: { label: 'Always', hint: 'Full strength at every zoom level' },
};
```

Run: `pnpm --filter @protspace/utils build` (core imports the built utils).

Create `packages/core/src/components/contours-menu/contours-menu.styles.ts`:

```ts
import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

export const contoursMenuStyles = [
  kitHost,
  css`
    :host {
      display: inline-flex;
      min-width: 0;
    }
    .icon,
    .chevron {
      display: inline-flex;
    }
    .chevron {
      color: var(--ps-text-faint);
    }
    .key {
      color: var(--ps-text-muted);
      font-weight: 400;
    }
    .value {
      color: var(--ps-text);
      font-weight: var(--ps-weight-medium);
      white-space: nowrap;
    }
    /* Label over a one-line hint, as the old contours menu had it. */
    ps-menu-item {
      box-sizing: border-box;
      width: 17rem;
      padding-block: var(--ps-space-1);
    }
    .item-label {
      display: block;
    }
    .hint {
      display: block;
      color: var(--ps-text-muted);
      font-size: var(--ps-text-sm);
      font-weight: 400;
      white-space: normal;
    }
  `,
];
```

Create `packages/core/src/components/contours-menu/contours-menu.ts`:

```ts
import { LitElement, html } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import {
  DENSITY_DEFAULT,
  DENSITY_LAYER_MODES,
  DENSITY_MODE_LABELS,
  type DensityLayerMode,
} from '@protspace/utils';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import { icon } from '../kit/icon';
import '../kit/menu';
import type { PsMenu } from '../kit/menu';
import '../kit/tooltip';
import { contoursMenuStyles } from './contours-menu.styles';

/** Detail of `density-layer-change`, fired when the user picks a contour mode. */
export interface DensityLayerChangeDetail {
  densityLayer: DensityLayerMode;
}

/**
 * The view bar's Contours picker (design decision 9). A pick shows at once and reaches listeners
 * as `density-layer-change` after the next paint, because drawing the contours costs a frame;
 * `applySelection` sets the mode from outside without an event.
 *
 * @fires density-layer-change - `DensityLayerChangeDetail`, bubbling and composed.
 */
@customElement('protspace-contours-menu')
export class ProtspaceContoursMenu extends LitElement {
  static styles = contoursMenuStyles;

  @property({ attribute: 'density-layer' }) densityLayer: DensityLayerMode = DENSITY_DEFAULT;

  @state() private open = false;

  @query('.trigger') private trigger!: HTMLElement;
  @query('ps-menu') private menu!: PsMenu;
  private readonly commit = new AfterPaintCommit();

  /** A user's pick made from code (the view bar's More menu): shows at once, dispatches after the paint. */
  pick(mode: DensityLayerMode): void {
    this.densityLayer = mode;
    this.commit.schedule(() =>
      this.dispatchEvent(
        new CustomEvent<DensityLayerChangeDetail>('density-layer-change', {
          detail: { densityLayer: mode },
          bubbles: true,
          composed: true,
        }),
      ),
    );
  }

  /** Sets the mode from outside (the URL) at once, without an event, dropping a pick still waiting. */
  applySelection(mode: DensityLayerMode): void {
    this.commit.cancel();
    this.densityLayer = mode;
  }

  /** Drops a pick still waiting, as a new dataset does. */
  cancelPending(): void {
    this.commit.cancel();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cancelPending();
  }

  protected firstUpdated(): void {
    this.menu.anchor = this.trigger;
  }

  render() {
    // `density-layer` is a plain attribute: show an unknown token as-is rather than throw.
    const label = DENSITY_MODE_LABELS[this.densityLayer]?.label ?? this.densityLayer;
    return html`
      <ps-button class="trigger" variant="ghost" @click=${this.toggle}>
        <span slot="start" class="icon">${icon('target', 16)}</span>
        <span class="key" part="key">Contours</span>
        <span class="value" part="value">${label}</span>
        <span slot="end" class="chevron">${icon('chevron-down', 14)}</span>
      </ps-button>
      <ps-tooltip text="One ring set per legend colour; not included in exports."></ps-tooltip>
      <ps-menu
        label="Contours"
        .open=${this.open}
        @ps-select=${this.onSelect}
        @ps-close=${this.onClose}
      >
        ${DENSITY_LAYER_MODES.map(
          (mode) =>
            html`<ps-menu-item type="radio" value=${mode} .checked=${mode === this.densityLayer}>
              <span class="item-label">${DENSITY_MODE_LABELS[mode].label}</span>
              <span class="hint">${DENSITY_MODE_LABELS[mode].hint}</span>
            </ps-menu-item>`,
        )}
      </ps-menu>
    `;
  }

  private toggle = () => {
    this.open = !this.open;
  };

  private onSelect = (event: Event) => {
    event.stopPropagation();
    this.open = false;
    this.pick((event as CustomEvent<{ value: DensityLayerMode }>).detail.value);
  };

  private onClose = (event: Event) => {
    event.stopPropagation();
    this.open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-contours-menu': ProtspaceContoursMenu;
  }
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/contours-menu/contours-menu.browser.test.ts` (sandbox disabled)
Expected: PASS, 5 tests.

- [ ] **Step 8: Export the pickers from core and run the suites**

In `packages/core/src/index.ts`, directly below the line `export { ProtspaceControlBar } from './components/control-bar/control-bar'; // Explicit export for value access`, add:

```ts
// The view bar's pickers (design decision 9).
export { ProtspaceProjectionSelect } from './components/projection-select/projection-select';
export { ProtspaceContoursMenu } from './components/contours-menu/contours-menu';
export type { DensityLayerChangeDetail } from './components/contours-menu/contours-menu';
```

Run: `pnpm --filter @protspace/utils exec vitest --run 2>&1 | tail -4`
Expected: PASS, unchanged counts.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run 2>&1 | tail -4`
Expected: PASS. Against the Task 2.6 counts: unit files unchanged; browser files +2 (`projection-select`, `contours-menu`, 10 tests) and `menu.browser.test.ts` +1 test.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core build`
Expected: no errors; `dist/` rebuilt.

Run: `pnpm type-check 2>&1 | tail -3 && pnpm knip`
Expected: no type errors; knip reports nothing (`DENSITY_MODE_LABELS` is used by the contours menu; the new elements are exported from the core index).

Run: `pnpm exec prettier --check packages/core/src/components/projection-select packages/core/src/components/contours-menu packages/core/src/components/kit/menu.ts packages/core/src/components/kit/menu.browser.test.ts packages/core/src/components/kit/icon.ts packages/core/src/index.ts packages/utils/src/types.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not, then re-check).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/components/projection-select packages/core/src/components/contours-menu \
  packages/core/src/components/kit/menu.ts packages/core/src/components/kit/menu.browser.test.ts \
  packages/core/src/components/kit/icon.ts packages/core/src/index.ts packages/utils/src/types.ts
git commit -m "feat(core): add the projection and contours pickers"
```

(`git commit` needs the sandbox disabled; the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.8: Pickers in the view bar, with their controller

The view bar gets its pickers (decision 9): Task 2.7's `protspace-projection-select` and `protspace-contours-menu` are mounted, and `protspace-annotation-select` is promoted to commit picks after the paint and dispatch the change events itself. The projection's details (`protspace-projection-metadata`) leave the plot's top-left corner for a place beside the Projection picker. `apps/web/src/explore/view-bar-controller.ts` derives the options, writes the plot and feeds the view controller, and the legend hears the change events from anywhere in its document.

**Files:**

- Modify: `packages/core/src/components/control-bar/annotation-select.ts`, `annotation-select.styles.ts`, `annotation-select.component.test.ts` (:352-405 → `deriveViewOptions`), `annotation-select.test.ts` (unchanged: it covers the pure grouping helpers, which this task does not touch)
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts` (:122-260), `projection-metadata.styles.ts` (`:host` :7-27), `projection-metadata.component.test.ts`; `scatter-plot.ts` (:31, :1723-1728)
- Modify: `packages/core/src/components/control-bar/control-bar.ts` (projection, annotation and contours state, handlers, commits and markup; `_updateOptionsFromData`; the projection and annotation parts of `_syncWithScatterplot` and `_handleDataChange`, whose selection parts stay until 2.9), `control-bar.events.ts` (`DensityLayerChangeDetail` out)
- Delete: `packages/core/src/components/control-bar/control-bar.density-layer.test.ts` (ported); the annotation and projection cases of `control-bar.after-paint.test.ts` (:100-240, ported)
- Modify: `packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts` (:302-331, :455-463), `scatterplot-sync-controller.test.ts` (:95-115, :619-632), `packages/core/src/components/legend/test-support/legend-scatterplot-harness.ts` (:68-71)
- Modify: `packages/core/src/index.ts`, `packages/core/src/components/kit/icon.ts` (`info`, for the projection details)
- Create: `apps/web/src/explore/view-bar-controller.ts`, `view-bar-controller.test.ts`
- Modify: `apps/web/src/explore/view-controller.ts` (:18-21, :67-148), `view-controller.test.ts`, `runtime.ts`, `elements.ts`, `control-bar-events.ts` (+ test), `example-datasets.test.ts` (comment :230)
- Modify: `apps/web/src/workbench/ViewBar.tsx`, `workbench.css`, `apps/web/src/custom-elements.d.ts`, `apps/web/src/tour/product-tour.ts` (step 3)
- Modify: `apps/web/tests/helpers/explore.ts` (`projectionTrigger`, `selectProjection`, `setContours`, `getColorByOptions`)
- Create: `apps/web/tests/workbench-view-bar.spec.ts`
- Also modified (see the notes in Steps 6, 7 and 13):
  - `packages/core/src/components/legend/legend.score-strips.test.ts` (:144-153, :201-232): the harness's control bar becomes a plain `picker` element.
  - `packages/core/src/utils/dropdown-helpers.ts`: `isAnyDropdownOpen` loses its last caller and goes (knip).
  - `packages/core/src/components/control-bar/styles/layout.ts`: the transitional control bar (search and selection only) drops its 900 px minimum width, so the view bar still fits one row at 1280 px until Task 2.10 removes it.
  - `apps/web/src/explore/filter-controller.ts`: imports `TOOLTIP_ONLY_ANNOTATIONS` from the view-bar controller instead of keeping its own copy.

**Interfaces:**

- Consumes: `ProtspaceProjectionSelect` and `ProtspaceContoursMenu` (Task 2.7: `applySelection`, `cancelPending`, `projection-change`, `density-layer-change`; the core index already exports them and `DensityLayerChangeDetail`); `AfterPaintCommit` (`packages/core/src/utils/after-paint-commit.ts`); `ps-button` (forwards `aria-haspopup` and `aria-expanded` from its host), `ps-menu` (sets `aria-haspopup`/`aria-expanded` on its anchor; closes itself, then dispatches `ps-select` `{ value, checked }`; `ps-close`), `ps-menu-item`, `ps-tooltip`, `icon`; `pushLayer`; `ExploreControls`, `InitialView` (2.5); `FilterController.setSelectedAnnotation` (2.6; it already hears `annotation-change` on `document`); `InteractionController.handleAnnotationChange()`; `ViewController.handleUserProjectionChange()` and the other `handleUser*Change()`; plot `selectedProjectionIndex`, `selectedAnnotation`, `tooltipAnnotations`, `config.densityLayer`, `data`, `getMaterializedData()`, `getCurrentData()`, `filtersActive`, `isIsolationMode()`; `isEatConfidenceAnnotation`, `DensityLayerMode`, `DENSITY_LAYER_MODES`, `DENSITY_DEFAULT` (`@protspace/utils`); the Task 2.3 helpers `viewBar`, `appBar`, `annotationSelect`, `pickFromMenu` (internal), `waitForViewState` (internal), `getViewState`, `selectAnnotation`, `openExplore`, `expectUrlParam`.
- Produces (core):
  - `ProtspaceAnnotationSelect` (same tag and file, now an exported class): `label` property (default "Color by"), shown before the value in `part="key"` and part of the trigger's name; `applySelection(annotation: string): void` and `applyTooltipSelection(names: readonly string[]): void` (both dispatch at once); `cancelPending(): void`; a primary change dispatches `annotation-change` `{ annotation }` and then, if the new primary was a tooltip extra, `tooltip-annotations-change` `{ tooltipAnnotations }` without it; a tooltip toggle dispatches only `tooltip-annotations-change`; user picks dispatch after the paint; the open list is a layer (Escape, outside press; focus returns to the trigger when it was in the list). `annotation-opened`, `close-dropdown` and its old `annotation-select` and `tooltip-annotation-toggle` events are gone. The trigger is the view bar's ghost key/value look (32 px), the value truncates at `16rem`.
  - `ProtspaceProjectionMetadata` is exported and placed by its host: its `:host` is no longer absolutely positioned (`position: relative; display: inline-flex; z-index: 10`, so the card stacks over the plot area), its card caps its height against `window.innerHeight` instead of `offsetParent` (re-measured on window `resize`), its trigger takes the ghost icon-button look (28 px, `icon('info')`) and keeps the name "View projection metadata". The scatterplot no longer renders it.
  - `ScatterplotSyncController` listens for `annotation-change` and `projection-change` on its host's root node instead of a control bar.
  - The core index also exports `ProtspaceAnnotationSelect` and `ProtspaceProjectionMetadata`.
  - The control bar keeps only search and selection.
- Produces (app):
  - `view-controller.ts`: `export interface ViewPickers { readonly selectedProjection: string; readonly selectedAnnotation: string; readonly tooltipAnnotations: readonly string[]; applyProjectionSelection(projection: string): void; applyAnnotationSelection(annotation: string): void; applyTooltipAnnotationsSelection(names: string[]): void; applyDensityLayerSelection(mode: DensityLayerMode): void }`; `createViewController({ plotElement, pickers: ViewPickers })`.
  - `view-bar-controller.ts`: `TOOLTIP_ONLY_ANNOTATIONS: ReadonlySet<string>`; `deriveViewOptions(data: VisualizationData, capabilityData?: VisualizationData): { projections: string[]; annotations: string[]; eatAnnotations: string[] }` (pure; Color by hides `gene_name`, `protein_name`, `uniprot_kb_id` and EAT-confidence columns); `createViewBarController(options: { plotElement; projectionSelect; annotationSelect; contoursMenu; projectionMetadata; interactionController: Pick<InteractionController, 'handleAnnotationChange'>; root: Pick<Document, 'addEventListener' | 'removeEventListener'>; onUserChange(kind: 'projection' | 'annotation' | 'tooltip' | 'density'): void }): ViewBarController`; `interface ViewBarController extends ViewPickers { showInitialView(view: InitialView): void; resetForNewDataset(): void; dispose(): void }`. On plot `data-change` it sets the pickers' options and the projection details; it listens to each picker on the element itself and writes the plot there (so the plot changes before the legend's document listener runs), then calls `onUserChange`. For `annotation-change` the provenance clearing (`interactionController.handleAnnotationChange()`) and `onUserChange('annotation')` run from a listener on `root`, registered after the legend's, which keeps today's order (the legend re-syncs first, then the app clears the plot's hidden values and re-syncs it). `showInitialView` sets values without events; `resetForNewDataset` cancels waiting picks.
  - `ExploreControls.showInitialView` calls `viewBarController.showInitialView(view)` and `filterController.setSelectedAnnotation(view.annotation)` (the control bar's selection lines stay until 2.9); `resetForNewDataset` also calls `viewBarController.resetForNewDataset()`.
  - `elements.ts`: `projectionSelect`, `annotationSelect`, `contoursMenu`, `projectionMetadata` (`#myProjectionSelect`, `#myAnnotationSelect`, `#myContoursMenu`, `#myProjectionMetadata`).
  - View bar, left to right: `div[data-driver-id="projections"]` holding Projection, its details and Color by; Contours; a 1 × 20 px separator; the control bar (search and selection until 2.9); Filter.
  - Tour step 3 targets the light-DOM `[data-driver-id="projections"]`.
  - `control-bar-events.ts` keeps only `selection-disabled-notification` (`bindControlBarEvents({ addControlBarListener })`).
  - Helpers `projectionTrigger`, `selectProjection`, `setContours` and `getColorByOptions` target the new elements.

**Tests:**

- Annotation select (unit): "a pick shows at once, closes the list and dispatches annotation-change after the paint"; "takes a keyboard pick down the same path"; "applies only the last of several picks made before the paint"; "picking a tooltip extra as the primary then removes it from the tooltip annotations"; "applySelection dispatches at once and drops a pick still waiting"; "drops the shown pick when a programmatic apply keeps the current annotation"; "Escape closes the list before anything else"; "the trigger reads Color by and the annotation"; the tooltip-toggle cases updated for `tooltip-annotations-change`.
- `projection-metadata.component.test.ts`: "caps the card at the viewport height below it".
- `scatterplot-sync-controller.test.ts`: "re-syncs on annotation-change and projection-change dispatched anywhere in the document"; "removes the root listeners, including projection-change, on disconnect".
- `view-bar-controller.test.ts` (unit, node, fakes): "deriveViewOptions hides tooltip-only and EAT-confidence columns and lists predicted annotations"; "deriveViewOptions reads the predicted annotations from the capability data"; "a projection pick sets the plot's index before onUserChange"; "an annotation pick writes the plot and clears provenance before onUserChange"; "tooltip changes reach the plot"; "a contours pick writes the plot's config"; "showInitialView sets the pickers without events"; "resetForNewDataset cancels waiting picks"; "data-change refreshes the options and the projection details"; "the view pickers read and write through the pickers"; "dispose stops listening".
- `view-controller.test.ts`: pickers mocked as `ViewPickers`; the echo suppression (:242) and density cases (:374-420) keep their meaning.
- `control-bar-events.test.ts`: "shows the selection-disabled warning as a toast".
- `apps/web/tests/workbench-view-bar.spec.ts` (e2e): "Projection, Color by and Contours sit in the view bar"; "picking a projection, an annotation and a contour mode updates the plot, the legend and the URL"; "the projection details open below the view bar, fully visible and topmost" (Review Focus 5); "the tour's projections step highlights the view bar group".
- `workbench-helpers.spec.ts`, `url-view-state.spec.ts`, `multi-annotation-tooltip.spec.ts` stay green; `pnpm perf:counts` within budget (annotation and projection switches unchanged).

Before you start, record the baseline counts from the phase 2 ledger. Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Tasks 2.5 and 2.6 have already removed the control bar's Import, Export and Filter code; Step 7 replaces the control bar's whole file, so their exact edits do not matter here.

- [ ] **Step 1: Write the failing annotation-select tests**

In `packages/core/src/components/control-bar/annotation-select.component.test.ts`:

1. Delete `import './control-bar';` (line 6) and `import type { ProtspaceData } from './types';` (line 8), the `ControlBarInternals` interface and the whole `describe('protspace-control-bar annotation list splitting', …)` block (:352-405; `view-bar-controller.test.ts` ports it in Step 10).
2. Add `pushLayer` and `topLayer` to the imports:

```ts
import { pushLayer, topLayer } from '../kit/layers';
```

3. Replace the three tooltip-extras tests that listen for the old events:

```ts
  it('dispatches tooltip-annotations-change when the toggle is clicked, without selecting', async () => {
    const el = await setup();
    await openDropdown(el);

    const toggleEvents: CustomEvent[] = [];
    const selectEvents: CustomEvent[] = [];
    el.addEventListener('tooltip-annotations-change', (e) => toggleEvents.push(e as CustomEvent));
    el.addEventListener('annotation-change', (e) => selectEvents.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;
    await afterNextPaint();

    expect(toggleEvents).toHaveLength(1);
    expect(toggleEvents[0].detail).toEqual({ tooltipAnnotations: ['gene_name'] });
    expect(selectEvents).toHaveLength(0);
    expect(el.tooltipAnnotations).toEqual(['gene_name']);
  });

  it('removes an annotation from tooltipAnnotations on a second toggle click', async () => {
    const el = await setup({ tooltipAnnotations: ['gene_name'] });
    await openDropdown(el);

    const events: CustomEvent[] = [];
    el.addEventListener('tooltip-annotations-change', (e) => events.push(e as CustomEvent));

    const btn = getRowFor(el, 'gene_name').querySelector(
      '.tooltip-toggle-btn',
    ) as HTMLButtonElement;
    btn.click();
    await el.updateComplete;

    expect(events[0].detail).toEqual({ tooltipAnnotations: [] });
    expect(el.tooltipAnnotations).toEqual([]);
  });

  it('clicking the row label selects the annotation as primary', async () => {
    const el = await setup();
    await openDropdown(el);

    const selectSpy = vi.fn();
    el.addEventListener('annotation-change', selectSpy);

    (getRowFor(el, 'gene_name').querySelector('.dropdown-item-label') as HTMLElement).click();
    await el.updateComplete;
    await afterNextPaint();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect((selectSpy.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
  });
```

4. Below the `getRowFor` helper, add:

```ts
/** Resolves in the task after the next frame, i.e. once a pick made now has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

type PickerElement = AnnotationSelectElement & {
  applySelection(annotation: string): void;
  label: string;
};
```

5. Append this block (it ports the annotation cases of `control-bar.after-paint.test.ts` :100-180):

```ts
describe('protspace-annotation-select picks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const shown = (el: AnnotationSelectElement) =>
    el.shadowRoot!.querySelector('.dropdown-trigger .dropdown-trigger-text')!.textContent!.trim();
  const rowLabel = (el: AnnotationSelectElement, annotation: string) =>
    getRowFor(el, annotation).querySelector('.dropdown-item-label')!.textContent!.trim();

  async function pick(el: AnnotationSelectElement, annotation: string): Promise<string> {
    await openDropdown(el);
    const label = rowLabel(el, annotation);
    (getRowFor(el, annotation).querySelector('.dropdown-item-label') as HTMLElement).click();
    await el.updateComplete;
    return label;
  }

  it('a pick shows at once, closes the list and dispatches annotation-change after the paint', async () => {
    const el = await setup();
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);

    const label = await pick(el, 'species');

    expect(shown(el)).toBe(label);
    expect(el.shadowRoot!.querySelector('.dropdown-menu')).toBeNull();
    expect(el.selectedAnnotation).toBe('pfam');
    expect(changed).not.toHaveBeenCalled();

    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('species');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'species' });
  });

  it('takes a keyboard pick down the same path', async () => {
    const el = await setup();
    const trigger = el.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector('#annotation-search-input') as HTMLElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await el.updateComplete;

    expect(el.selectedAnnotation).toBe('pfam');
    await afterNextPaint();
    expect(el.selectedAnnotation).not.toBe('pfam');
  });

  it('applies only the last of several picks made before the paint', async () => {
    const el = await setup();
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);

    await pick(el, 'species');
    const label = await pick(el, 'gene_name');
    expect(shown(el)).toBe(label);

    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('gene_name');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
  });

  it('picking a tooltip extra as the primary then removes it from the tooltip annotations', async () => {
    const el = await setup({ tooltipAnnotations: ['species', 'gene_name'] });
    const events: Array<[string, unknown]> = [];
    el.addEventListener('annotation-change', (e) =>
      events.push(['annotation-change', (e as CustomEvent).detail]),
    );
    el.addEventListener('tooltip-annotations-change', (e) =>
      events.push(['tooltip-annotations-change', (e as CustomEvent).detail]),
    );

    await pick(el, 'species');
    await afterNextPaint();

    expect(events).toEqual([
      ['annotation-change', { annotation: 'species' }],
      ['tooltip-annotations-change', { tooltipAnnotations: ['gene_name'] }],
    ]);
    expect(el.tooltipAnnotations).toEqual(['gene_name']);
  });

  it('applySelection dispatches at once and drops a pick still waiting', async () => {
    const el = (await setup()) as PickerElement;
    const changed = vi.fn();
    el.addEventListener('annotation-change', changed);
    await pick(el, 'species');

    el.applySelection('gene_name');

    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'gene_name' });
    await afterNextPaint();
    await el.updateComplete;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(el.selectedAnnotation).toBe('gene_name');
    const label = await rowLabelAfterOpen(el, 'gene_name');
    expect(shown(el)).toBe(label);
  });

  it('drops the shown pick when a programmatic apply keeps the current annotation', async () => {
    const el = (await setup()) as PickerElement;
    await pick(el, 'species');

    el.applySelection('pfam');
    await el.updateComplete;
    await afterNextPaint();

    expect(el.selectedAnnotation).toBe('pfam');
    const label = await rowLabelAfterOpen(el, 'pfam');
    expect(shown(el)).toBe(label);
  });

  it('Escape closes the list before anything else', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await setup();
    await openDropdown(el);
    expect(el.shadowRoot!.querySelector('.dropdown-menu')).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.dropdown-menu')).toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });

  it('the trigger reads Color by and the annotation', async () => {
    const el = (await setup()) as PickerElement;
    const trigger = el.shadowRoot!.querySelector('.dropdown-trigger')!;
    const key = trigger.querySelector('[part="key"]')!;

    expect(key.textContent!.trim()).toBe('Color by');
    expect(trigger.textContent!.replace(/\s+/g, ' ').trim()).toMatch(/^Color by \S/);

    el.label = 'Colour';
    await el.updateComplete;
    expect(key.textContent!.trim()).toBe('Colour');
  });
});

/** The label a row shows for `annotation`, read from the opened list, which closes again. */
async function rowLabelAfterOpen(el: AnnotationSelectElement, annotation: string): Promise<string> {
  await openDropdown(el);
  const label = getRowFor(el, annotation)
    .querySelector('.dropdown-item-label')!
    .textContent!.trim();
  (el.shadowRoot!.querySelector('.dropdown-trigger') as HTMLButtonElement).click();
  await el.updateComplete;
  return label;
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/annotation-select.component.test.ts`
Expected: FAIL: no `annotation-change` reaches the listeners (the element still dispatches `annotation-select` and sets the value at once), `applySelection` is not a function, the open list is no layer (Escape closes the fake dialog), and the trigger has no `[part="key"]`.

- [ ] **Step 2: Promote the annotation select**

Replace `packages/core/src/components/control-bar/annotation-select.ts` with:

```ts
import { LitElement, html, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { customElement } from '../../utils/safe-custom-element';
import { pushLayer } from '../kit/layers';
import { annotationSelectStyles } from './annotation-select.styles';
import { handleListboxKeydown, scrollHighlightedIntoView } from '../../utils/dropdown-helpers';
import {
  filterGroupedAnnotations,
  flattenGroupedAnnotations,
  type GroupedAnnotation,
} from './annotation-categories';
import { predictedBadge, renderAnnotationName } from './annotation-name';
import {
  annotationLabel,
  annotationStatSummary,
  clusterAgreement,
  getAnnotationMeta,
  hasAnnotationStats,
  type Annotation,
  type ProjectionStatisticRow,
} from '@protspace/utils';
import '../common/info-popover';

/**
 * The view bar's Color by picker (design decision 9): a searchable, grouped list of annotations,
 * each row with its hover-tooltip toggle. A pick shows at once and reaches listeners as
 * `annotation-change` after the next paint, because recolouring re-stages every point;
 * `applySelection` applies at once. The open list is a layer: Escape and a press outside close
 * it before anything else.
 *
 * @fires annotation-change - `{ annotation }`: the colouring annotation changed.
 * @fires tooltip-annotations-change - `{ tooltipAnnotations }`: the tooltip's extras changed.
 */
@customElement('protspace-annotation-select')
export class ProtspaceAnnotationSelect extends LitElement {
  static styles = annotationSelectStyles;

  @property({ type: Array }) annotations: string[] = [];
  @property({ type: Object }) annotationDefinitions: Record<string, Pick<Annotation, 'runtime'>> =
    {};
  @property({ type: Array }) eatAnnotations: string[] = [];
  @property({ type: String, attribute: 'selected-annotation' }) selectedAnnotation: string = '';
  @property({ type: Array }) tooltipAnnotations: string[] = [];
  @property({ type: String }) placeholder: string = 'Select annotation';
  /** The key shown before the value; part of the trigger's accessible name. */
  @property({ type: String }) label: string = 'Color by';
  /** Rows of the bundle's optional statistics part; empty when it was prepared without `--stats`. */
  @property({ type: Array }) statisticsRows: readonly ProjectionStatisticRow[] = [];
  /** Projection the statistics are reported for; statistics are scored per projection. */
  @property({ type: String, attribute: 'selected-projection' }) selectedProjection: string = '';

  @state() private open: boolean = false;
  @state() private query: string = '';
  @state() private highlightIndex: number = -1;
  /** A pick waiting for its commit after the next paint; the trigger shows it until then. */
  @state() private pending: string | null = null;

  private readonly commit = new AfterPaintCommit();
  /** Releases the open list's layer; set while the list is open. */
  private releaseLayer?: () => void;

  /**
   * Makes `annotation` the colouring now, drops a pick still waiting, and tells listeners. The
   * new primary is implicitly in the tooltip, so it then leaves the extras.
   */
  applySelection(annotation: string): void {
    this.commit.cancel();
    this.pending = null;
    this.selectedAnnotation = annotation;
    this.dispatchEvent(
      new CustomEvent('annotation-change', {
        detail: { annotation },
        bubbles: true,
        composed: true,
      }),
    );
    if (this.tooltipAnnotations.includes(annotation)) {
      this.applyTooltipSelection(this.tooltipAnnotations.filter((name) => name !== annotation));
    }
  }

  /** Sets the tooltip's extra annotations now, without the primary or repeats, and tells listeners. */
  applyTooltipSelection(names: readonly string[]): void {
    const next = Array.from(new Set(names.filter((name) => name !== this.selectedAnnotation)));
    this.tooltipAnnotations = next;
    this.dispatchEvent(
      new CustomEvent('tooltip-annotations-change', {
        detail: { tooltipAnnotations: [...next] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Drops a pick still waiting, as a new dataset does. */
  cancelPending(): void {
    this.commit.cancel();
    this.pending = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cancelPending();
    this.releaseLayer?.();
    this.releaseLayer = undefined;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('open')) return;
    if (this.open) {
      this.releaseLayer ??= pushLayer({ close: () => this.closeFromLayer(), elements: [this] });
    } else {
      this.releaseLayer?.();
      this.releaseLayer = undefined;
    }
  }

  /** Escape or a press outside: close, and give focus back to the trigger when it was in the list. */
  private closeFromLayer(): void {
    const hadFocus = this.shadowRoot?.activeElement != null;
    this.closeList();
    if (hadFocus) {
      (this.shadowRoot?.querySelector('.dropdown-trigger') as HTMLElement | null)?.focus();
    }
  }

  private openList() {
    this.open = true;
    this.updateComplete.then(() => {
      const searchInput = this.shadowRoot?.querySelector(
        '#annotation-search-input',
      ) as HTMLInputElement | null;
      searchInput?.focus();
    });
  }

  private closeList() {
    this.open = false;
    this.query = '';
    this.highlightIndex = -1;
  }

  private toggleDropdown(event?: Event) {
    event?.stopPropagation();
    if (this.open) this.closeList();
    else this.openList();
  }

  private handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.query = target.value;
    this.highlightIndex = -1; // Reset highlight when query changes
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.open) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleDropdown(event);
      }
      return;
    }

    handleListboxKeydown(event, {
      // Lazy: only the arrow and Enter keys pay for re-filtering the list.
      getValues: () => flattenGroupedAnnotations(this.getFilteredGroupedAnnotations()),
      highlightIndex: this.highlightIndex,
      setHighlightIndex: (index) => {
        this.highlightIndex = index;
        this.scrollToHighlighted();
      },
      // The layer normally takes Escape first; this covers an event that never reached the window.
      onEscape: () => this.closeList(),
      onSelect: (annotation) => this.selectAnnotation(annotation, event),
      root: this.shadowRoot,
      itemSelector: '.dropdown-item',
      valueAttribute: 'data-annotation',
    });
  }

  private scrollToHighlighted() {
    this.updateComplete.then(() =>
      scrollHighlightedIntoView(this.shadowRoot, '.dropdown-item.highlighted'),
    );
  }

  /** A user's pick: shown at once, committed after the next paint (the newest pick wins). */
  private selectAnnotation(annotation: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.closeList();
    this.pending = annotation;
    this.commit.schedule(() => this.applySelection(annotation));
  }

  private toggleTooltipAnnotation(annotation: string, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (annotation === (this.pending ?? this.selectedAnnotation)) {
      return;
    }
    const isActive = this.tooltipAnnotations.includes(annotation);
    this.applyTooltipSelection(
      isActive
        ? this.tooltipAnnotations.filter((name) => name !== annotation)
        : [...this.tooltipAnnotations, annotation],
    );
  }

  private getFilteredGroupedAnnotations(): GroupedAnnotation[] {
    return filterGroupedAnnotations(this.annotations, this.query, this.annotationDefinitions);
  }

  /**
   * Which annotations the panel would show at least one metric row for in this projection,
   * rebuilt only when those inputs change: render() re-runs on every search keystroke and arrow
   * press while the dropdown is open, and deriving each row's answer there re-scans the whole
   * statistics table per row. The scores themselves live in the projection-metadata panel; the
   * badge only says they exist.
   */
  private hasStats = new Map<string, boolean>();

  willUpdate(changed: PropertyValues<this>) {
    if (changed.has('statisticsRows') || changed.has('selectedProjection')) {
      this.hasStats.clear();
    }
  }

  /**
   * Shares `hasAnnotationStats` with the projection-metadata panel's render gate rather than
   * re-deriving "has stats" from `annotationStatSummary` alone: that would go stale for an
   * ordinary annotation with agreement rows but no validity rows (badges something the panel
   * renders empty) and for a `cluster_*` column, which never has a `summary` of its own but does
   * have agreement rows naming it (would badge nothing for something the panel does render).
   */
  private hasStatistics(annotation: string): boolean {
    let scored = this.hasStats.get(annotation);
    if (scored === undefined) {
      const summary = annotationStatSummary(
        this.statisticsRows,
        annotation,
        this.selectedProjection,
      );
      const agreement = clusterAgreement(this.statisticsRows, annotation);
      scored = hasAnnotationStats(summary, agreement);
      this.hasStats.set(annotation, scored);
    }
    return scored;
  }

  render() {
    const filtered = this.getFilteredGroupedAnnotations();
    const shown = this.pending ?? this.selectedAnnotation;

    return html`
      <div class="annotation-select-container">
        <button
          class="dropdown-trigger ${this.open ? 'open' : ''}"
          part="trigger"
          @click=${this.toggleDropdown}
          @keydown=${this.handleKeydown}
          aria-expanded=${this.open}
          aria-haspopup="listbox"
        >
          <span class="key" part="key">${this.label}</span>
          ${shown
            ? renderAnnotationName(
                shown,
                this.annotationDefinitions[shown],
                'dropdown-trigger-text',
              )
            : html`<span class="dropdown-trigger-text">${this.placeholder}</span>`}
          <svg class="chevron-down" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        ${this.open
          ? html`
              <div class="dropdown-menu align-left" @click=${(e: Event) => e.stopPropagation()}>
                <div class="annotation-search-container">
                  <input
                    id="annotation-search-input"
                    class="annotation-search-input"
                    type="text"
                    .value=${this.query}
                    placeholder="Search annotations..."
                    @input=${this.handleSearchInput}
                    @keydown=${this.handleKeydown}
                  />
                </div>

                <div class="annotation-list-container">
                  ${filtered.length === 0
                    ? html` <div class="no-results">No matching annotations</div> `
                    : filtered.map((group) => {
                        let currentIndex = 0;
                        // Find starting index for this group
                        for (const g of filtered) {
                          if (g === group) break;
                          currentIndex += g.annotations.length;
                        }

                        return html`
                          <div class="annotation-section">
                            <div class="annotation-section-header">${group.category}</div>
                            <div class="annotation-section-items">
                              ${group.annotations.map((annotation) => {
                                // Hover styling comes from `dropdownMixin`'s `.dropdown-item:hover`.
                                // Mirroring it into `highlightIndex` re-rendered every row per row
                                // the pointer crossed. The index is for keyboard navigation only.
                                const itemIndex = currentIndex++;
                                const isHighlighted = itemIndex === this.highlightIndex;
                                const isSelected = annotation === shown;
                                const isInTooltip = this.tooltipAnnotations.includes(annotation);
                                const hasEatPredictions = this.eatAnnotations.includes(annotation);
                                const definition = this.annotationDefinitions[annotation];
                                const meta = getAnnotationMeta(annotation, definition);
                                const hasDocs = meta.description.length > 0 || !!meta.docsUrl;
                                const stats = this.hasStatistics(annotation);
                                return html`
                                  <div
                                    class="dropdown-item ${isHighlighted
                                      ? 'highlighted'
                                      : ''} ${isSelected ? 'selected' : ''}"
                                    data-annotation=${annotation}
                                    @click=${(e: Event) => this.selectAnnotation(annotation, e)}
                                  >
                                    <span
                                      class="primary-indicator"
                                      aria-hidden="true"
                                      data-active=${isSelected ? 'true' : 'false'}
                                    >
                                      ${isSelected ? html`<span class="primary-dot"></span>` : ''}
                                    </span>
                                    ${hasDocs
                                      ? html`<protspace-info-popover
                                          class="annotation-info"
                                          placement="side"
                                          .description=${meta.description}
                                          docs-url=${meta.docsUrl ?? ''}
                                          label=${annotationLabel(annotation, definition)}
                                          @click=${(e: Event) => e.stopPropagation()}
                                        ></protspace-info-popover>`
                                      : ''}
                                    <span class="dropdown-item-label"
                                      >${annotationLabel(annotation, definition)}</span
                                    >
                                    ${hasEatPredictions
                                      ? html`<span
                                          class="menu-badge eat-badge"
                                          title="Embedding Annotation Transfer predictions available"
                                          aria-label="EAT predictions available"
                                          >EAT</span
                                        >`
                                      : ''}
                                    ${stats
                                      ? html`<span
                                          class="menu-badge stats-badge"
                                          title="Quality statistics available: select this annotation and open the projection metadata panel"
                                          aria-label="Quality statistics available"
                                          >STATS</span
                                        >`
                                      : ''}
                                    ${predictedBadge(annotation)}
                                    <span class="tooltip-toggle-slot">
                                      ${isSelected
                                        ? ''
                                        : html`<button
                                            type="button"
                                            class="tooltip-toggle-btn ${isInTooltip
                                              ? 'is-active'
                                              : ''}"
                                            title=${isInTooltip
                                              ? 'Hide from hover tooltip'
                                              : 'Show in hover tooltip'}
                                            aria-label=${isInTooltip
                                              ? `Hide ${annotation} from hover tooltip`
                                              : `Show ${annotation} in hover tooltip`}
                                            aria-pressed=${isInTooltip ? 'true' : 'false'}
                                            @click=${(e: Event) =>
                                              this.toggleTooltipAnnotation(annotation, e)}
                                            @mousedown=${(e: Event) => e.stopPropagation()}
                                          >
                                            ${isInTooltip
                                              ? html`<svg
                                                  viewBox="0 0 24 24"
                                                  width="16"
                                                  height="16"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  aria-hidden="true"
                                                >
                                                  <path
                                                    d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"
                                                  />
                                                  <circle cx="12" cy="12" r="3" />
                                                </svg>`
                                              : html`<svg
                                                  viewBox="0 0 24 24"
                                                  width="16"
                                                  height="16"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  aria-hidden="true"
                                                >
                                                  <path d="M3 3l18 18" />
                                                  <path d="M10.585 10.587a2 2 0 0 0 2.83 2.828" />
                                                  <path
                                                    d="M16.681 16.673A8.717 8.717 0 0 1 12 18C6 18 2 12 2 12a13.16 13.16 0 0 1 3.176-3.836"
                                                  />
                                                  <path
                                                    d="M9.88 5.18A8.717 8.717 0 0 1 12 5c6 0 10 7 10 7a13.198 13.198 0 0 1-1.668 2.06"
                                                  />
                                                </svg>`}
                                          </button>`}
                                    </span>
                                  </div>
                                `;
                              })}
                            </div>
                          </div>
                        `;
                      })}
                </div>
              </div>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-annotation-select': ProtspaceAnnotationSelect;
  }
}
```

(The list markup is today's, unchanged except `isSelected`, which now compares with the shown value.)

In `packages/core/src/components/control-bar/annotation-select.styles.ts`:

- delete the whole `@media (max-width: 1200px) { … }` block at the end (it stretched the picker to the control bar's width; in the view bar it would push every other item out);
- add these rules after the `.dropdown-menu.align-left` rule:

```css
    /* The view bar's key/value trigger (decision 1): ghost, 32 px, key muted, value medium. */
    .dropdown-trigger {
      gap: var(--ps-space-1-5);
      height: var(--ps-control-md);
      min-width: 0;
      padding: 0 var(--ps-space-2);
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      color: var(--ps-text);
      font-family: var(--ps-font-sans);
      font-size: var(--ps-text-base);
    }

    .dropdown-trigger:hover,
    .dropdown-trigger.open {
      border-color: transparent;
      background: var(--ps-surface-hover);
    }

    .dropdown-trigger.open {
      box-shadow: inset 0 0 0 1px var(--ps-border-strong);
    }

    .dropdown-trigger .key {
      color: var(--ps-text-muted);
      white-space: nowrap;
    }

    .dropdown-trigger .dropdown-trigger-text {
      max-width: 16rem;
      font-weight: var(--ps-weight-medium);
    }

    .dropdown-trigger .chevron-down {
      color: var(--ps-text-faint);
    }
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/annotation-select.component.test.ts src/components/control-bar/annotation-select.test.ts`
Expected: PASS, every test in both files.

- [ ] **Step 3: Write the failing projection-details test**

Append to `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.component.test.ts`:

```ts
describe('protspace-projection-metadata placement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('caps the card at the viewport height below it', async () => {
    const el = await setup({ n_components: 2 });
    const content = el.shadowRoot!.querySelector('.content') as HTMLElement;
    const top = vi.spyOn(content, 'getBoundingClientRect');

    top.mockReturnValue({ top: 100 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(content.style.maxHeight).toBe(`${window.innerHeight - 100 - 8}px`);

    // Never below the 200 px a scrolling card needs to be usable.
    top.mockReturnValue({ top: window.innerHeight - 50 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(content.style.maxHeight).toBe('200px');
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/projection-metadata/projection-metadata.component.test.ts`
Expected: FAIL: the card is capped only against `offsetParent` (absent in this test), so a window `resize` sets no `maxHeight` (`expected '' to be '660px'`).

- [ ] **Step 4: Place the projection details beside Projection**

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`:

First, in `packages/core/src/components/kit/icon.ts`, add `Info` to the `lucide` import and `info: Info,` to `ICONS` (alphabetical with the rest).

1. Add `import { icon } from '../../kit/icon';` after the `info-popover` import (line 27).
2. Replace `class ProtspaceProjectionMetadata extends LitElement {` (line 122) with `export class ProtspaceProjectionMetadata extends LitElement {`.
3. Delete the `_resize` field with its comment (:158-163) and the whole `firstUpdated()` method (:165-172).
4. Replace the doc comment and body of `_updateMaxHeight` (:191-214) with:

```ts
  /**
   * Caps the card at the room left below it in the viewport. The card opens from the view bar
   * now, with the whole plot height free below it, so the viewport is the bound; a measured cap
   * still beats a CSS one because the card's top depends on where the bar sits.
   */
  private _updateMaxHeight(): void {
    const content = this.shadowRoot?.querySelector('.content') as HTMLElement | null;
    if (!content) return;
    const { MIN_CARD_HEIGHT, CARD_MARGIN } = ProtspaceProjectionMetadata;
    const available = window.innerHeight - content.getBoundingClientRect().top - CARD_MARGIN;
    content.style.maxHeight = `${Math.max(MIN_CARD_HEIGHT, available)}px`;
  }

  private _onWindowResize = () => this._updateMaxHeight();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this._onWindowResize);
  }
```

5. In `disconnectedCallback` (:216-221), replace `this._resize?.disconnect();` and `this._resize = null;` with `window.removeEventListener('resize', this._onWindowResize);`.
6. In `render()`, replace the trigger's `<svg class="icon" …>…</svg>` (:291-297) with `${icon('info', 16)}`.
7. Change the comment on `CARD_MARGIN` (:156) to `/** Breathing room kept between the bottom of the card and the viewport's edge. */`.

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, replace everything from `:host {` (line 7) up to the line before `.content {` (the `:host` block and every `.trigger` rule) with:

```css
    :host {
      /* Placed by its host (the view bar). Relative, so the card hangs below the trigger; the
         z-index lifts the card over the plot area, which follows in the document. */
      position: relative;
      display: inline-flex;
      z-index: 10;

      /* protspace-info-popover is shared with the legend and themes itself from these two
         hooks, defaulting to a neutral grey. Set them from the tokens so its info icon and
         text match the label beside it; the component already exposes the seam, and the
         legend keeps its own values. */
      --legend-text-secondary: var(--ps-text-muted);
      --legend-text-color: var(--ps-text);

      /* Gap between the trigger and the card. Read by the card's top offset and by the
         invisible hover bridge that spans it. */
      --card-gap: 0.5rem;
    }

    /* The kit's ghost icon-button look (ps-icon-button size sm). */
    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--ps-control-sm);
      height: var(--ps-control-sm);
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--ps-radius);
      background: transparent;
      color: var(--ps-text-muted);
      cursor: pointer;
      transition:
        background-color var(--ps-duration-fast) var(--ps-ease),
        color var(--ps-duration-fast) var(--ps-ease);
    }

    .trigger:hover,
    .trigger[aria-expanded='true'] {
      background: var(--ps-surface-hover);
      color: var(--ps-text);
    }

    .trigger:focus-visible {
      outline: var(--ps-focus-width) solid var(--ps-focus);
      outline-offset: var(--ps-focus-offset);
    }
```

and in the `.content` rule replace the comment that begins `/* Fallback only. The real cap is measured …` with:

```css
      /* Fallback only: _updateMaxHeight() measures the room left below the card in the
         viewport and sets the real cap inline. */
```

In `packages/core/src/components/scatter-plot/scatter-plot.ts`, delete `import './projection-metadata/projection-metadata';` (line 31) and the element in `render()` (:1723-1728):

```ts
        <protspace-projection-metadata
          .projection=${this.data?.projections[this.selectedProjectionIndex] ?? null}
          .statisticsRows=${this.data?.statisticsRows}
          selected-annotation=${this.selectedAnnotation}
          .viewIsSubset=${this.filtersActive || this.isIsolationMode()}
        ></protspace-projection-metadata>
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/projection-metadata/projection-metadata.component.test.ts`
Expected: PASS, every test including the new one.

- [ ] **Step 5: Write the failing legend-sync tests**

In `packages/core/src/components/legend/controllers/scatterplot-sync-controller.test.ts`:

Replace the test `'removes the control bar listeners, including projection-change, on disconnect'` (:95-115) with:

```ts
    it('removes the root listeners, including projection-change, on disconnect', () => {
      // The view pickers' events reach the legend on its root node. Never removing
      // PROJECTION_CHANGE there would leak a listener on every disconnect/reconnect cycle.
      document.body.appendChild(mockScatterplot as unknown as Node);
      controller = new ScatterplotSyncController(mockHost, mockCallbacks);
      controller.hostConnected();

      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      controller.hostDisconnected();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        LEGEND_EVENTS.ANNOTATION_CHANGE,
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        LEGEND_EVENTS.PROJECTION_CHANGE,
        expect.any(Function),
      );
      removeEventListenerSpy.mockRestore();
    });
```

Replace the test `'handles annotation-change events from control bar'` (:619-632) with:

```ts
    it('re-syncs on annotation-change and projection-change dispatched anywhere in the document', () => {
      const picker = document.createElement('div');
      document.body.appendChild(picker);

      picker.dispatchEvent(
        new CustomEvent(LEGEND_EVENTS.ANNOTATION_CHANGE, {
          detail: { annotation: 'new-annotation' },
          bubbles: true,
          composed: true,
        }),
      );
      expect(mockCallbacks.onAnnotationChange).toHaveBeenCalledWith('new-annotation');

      vi.mocked(mockCallbacks.onDataChange).mockClear();
      picker.dispatchEvent(
        new CustomEvent(LEGEND_EVENTS.PROJECTION_CHANGE, {
          detail: { projection: 'PCA' },
          bubbles: true,
          composed: true,
        }),
      );
      expect(mockCallbacks.onDataChange).toHaveBeenCalled();
    });
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/controllers/scatterplot-sync-controller.test.ts`
Expected: FAIL, 2 tests: the controller listens only on a `protspace-control-bar` element, so neither `document.removeEventListener` nor `onAnnotationChange` is called.

- [ ] **Step 6: Make the legend listen on its root node**

In `packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts`:

1. Replace the field `private _controlBarElement: Element | null = null;` (line 81) with:

```ts
  /** The legend's root node, where the view pickers' bubbling, composed events arrive. */
  private _eventRoot: Document | ShadowRoot | null = null;
```

2. In `_onScatterplotDiscovered` (:302-331), replace everything from `const escapedSelector =` to the closing `}` of `if (this._controlBarElement) { … }` with:

```ts
    // The view bar's pickers dispatch annotation-change and projection-change, bubbling and
    // composed, wherever they sit: listen on the legend's own root (the document in the app).
    const root = this.host.getRootNode();
    this._eventRoot = root instanceof ShadowRoot || root instanceof Document ? root : document;
    this._eventRoot.addEventListener(
      LEGEND_EVENTS.ANNOTATION_CHANGE,
      this._boundHandleAnnotationChange,
    );
    this._eventRoot.addEventListener(
      LEGEND_EVENTS.PROJECTION_CHANGE,
      this._boundHandleProjectionChange,
    );
```

3. In `_cleanup` (:455-463), replace the `if (this._controlBarElement) { … }` block with:

```ts
    if (this._eventRoot) {
      this._eventRoot.removeEventListener(
        LEGEND_EVENTS.ANNOTATION_CHANGE,
        this._boundHandleAnnotationChange,
      );
      this._eventRoot.removeEventListener(
        LEGEND_EVENTS.PROJECTION_CHANGE,
        this._boundHandleProjectionChange,
      );
      this._eventRoot = null;
    }
```

In `packages/core/src/components/legend/test-support/legend-scatterplot-harness.ts`, replace the control bar (:68-71) and the returned names:

```ts
  // Any element in the document stands in for a view-bar picker: the legend hears
  // annotation-change and projection-change on its root node.
  const picker = document.createElement('div');
  document.body.append(picker);
```

change `controlBar: HTMLElement;` in the return type to `picker: HTMLElement;` and the returned `controlBar` to `picker`.

In `packages/core/src/components/legend/legend.score-strips.test.ts`, the two projection tests destructure `picker` instead of `controlBar` (:144, :201), dispatch with `picker.dispatchEvent(` (:152, :226), and the comment at :149-150 reads:

```ts
    // As the view bar's projection picker does in production: the app sets the scatterplot's
    // index on the picker's own event, then the event bubbles to the legend's document.
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend`
Expected: PASS, every legend test file.

- [ ] **Step 7: Empty the control bar of the view controls**

Replace `packages/core/src/components/control-bar/control-bar.ts` with (search and selection only; Task 2.9 moves them, Task 2.10 deletes the file):

```ts
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';
import type { DataChangeDetail, ScatterplotElementLike, StructureViewerElement } from './types';
import { AfterPaintCommit } from '../../utils/after-paint-commit';
import { toggleProteinSelection, mergeProteinSelections } from './control-bar-helpers';
import {
  createSelectionDisabledNotificationDetail,
  type SelectionDisabledNotificationDetail,
} from './control-bar.events';
import type { BrushSelectionDetail, ProteinClickDetail } from '../scatter-plot/scatter-plot.events';
import './search';

/**
 * What is left of the control bar while design decision 9 splits it: the protein search and the
 * selection tools. Projection, Color by and contours live in the view bar, Import and Export in
 * the app bar, Filter in its own dialog. Task 2.9 moves the rest and Task 2.10 deletes the element.
 */
@customElement('protspace-control-bar')
export class ProtspaceControlBar extends LitElement {
  @property({ type: Boolean, attribute: 'selection-mode' })
  selectionMode: boolean = false;
  @property({ type: String, attribute: 'selection-tool' })
  selectionTool: 'rectangle' | 'lasso' = 'rectangle';
  @property({ type: Number, attribute: 'selected-proteins-count' })
  selectedProteinsCount: number = 0;
  @property({ type: Boolean, attribute: 'isolation-mode' })
  isolationMode: boolean = false;
  @property({ type: Array, attribute: 'isolation-history' })
  isolationHistory: string[][] = [];

  @state() private _selectionDisabled: boolean = false;

  // Auto-sync properties (optional, can be derived from events)
  @property({ type: String, attribute: 'scatterplot-selector' })
  scatterplotSelector: string = 'protspace-scatterplot';
  @property({ type: Boolean, attribute: 'auto-sync' })
  autoSync: boolean = true;

  private _scatterplotElement: ScatterplotElementLike | null = null;
  /**
   * The one pending auto-sync timer — a scatter plot lookup retry or the initial
   * sync. Cleared on disconnect so a removed control bar stops polling (and never
   * fires after a test environment's `document` is gone).
   */
  private _autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

  // Search state
  @state() private allProteinIds: string[] = [];
  @state() private selectedIdsChips: string[] = [];

  // A pick from the search box or the Clear button re-stages every point. The chips show it in
  // the frame of the input; the change itself runs after that frame is painted, so a newer pick
  // replaces one still waiting, and a selection committed at once drops it.
  private readonly _selectionCommit = new AfterPaintCommit();

  // Stable listeners for proper add/remove
  private _onDocumentClick = (event: Event) => this.handleDocumentClick(event);
  private _onDocumentKeydown = (event: KeyboardEvent) => this.handleDocumentKeydown(event);
  private _onDataChange = (event: Event) => this._handleDataChange(event);
  private _onProteinClick = (event: Event) => this._handleProteinSelection(event);
  private _onDataIsolation = (event: Event) => this._handleDataIsolation(event);
  private _onDataIsolationReset = (event: Event) => this._handleDataIsolationReset(event);
  private _onAutoDisableSelection = (event: Event) => this._handleAutoDisableSelection(event);
  private _onBrushSelection = (event: Event) => this._handleBrushSelection(event);

  static styles = controlBarStyles;

  private handleToggleSelectionMode() {
    // Compute and set the new selection mode locally first
    const newSelectionMode = !this.selectionMode;
    this.selectionMode = newSelectionMode;

    // If auto-sync is enabled, update the scatterplot BEFORE notifying listeners
    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      if (scatterplot.selectionMode !== undefined) {
        scatterplot.selectionMode = newSelectionMode;
      }
    }

    // Now dispatch the event with the updated state so listeners read the correct value
    const customEvent = new CustomEvent('toggle-selection-mode', {
      detail: { selectionMode: newSelectionMode },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private handleSelectionToolChange(tool: 'rectangle' | 'lasso') {
    this.selectionTool = tool;
    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      if (scatterplot.selectionTool !== undefined) {
        scatterplot.selectionTool = tool;
      }
    }
    this.dispatchEvent(
      new CustomEvent('selection-tool-change', {
        detail: { selectionTool: tool },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleClearSelections() {
    const customEvent = new CustomEvent('clear-selections', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    // Previously this reset `selectedProteinsCount` inside the auto-sync branch, so
    // clearing while `autoSync` was false (as `data-renderer.ts` sets it during a data
    // swap) emptied the chips but left the count stale — keeping the Clear button live
    // and Escape firing against an empty selection.
    this._commitSelection([], { afterPaint: true });
  }

  private handleSplitData() {
    // Isolation reads the scatterplot's selection: land a search pick still waiting first.
    this._selectionCommit.flush();
    const customEvent = new CustomEvent('isolate-data', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      scatterplot.isolateSelection?.();
    }
  }

  private handleResetSplit() {
    const customEvent = new CustomEvent('reset-isolation', {
      detail: {},
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);

    if (this.autoSync && this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      scatterplot.resetIsolation?.();
      this.isolationMode = false;
      this.isolationHistory = [];
    }
  }

  public clearForNewDataset(_datasetHash?: string, _clearPersistedState?: boolean): void {
    this._cancelPendingCommits();
  }

  render() {
    return html`
      <div class="control-bar">
        <!-- Search selection -->
        <div class="control-group search-group" data-driver-id="search">
          <protspace-protein-search
            .availableProteinIds=${this.allProteinIds}
            .selectedProteinIds=${this.selectedIdsChips}
            @selection-change=${this._handleSearchSelectionChange}
            @add-selection=${this._handleSearchSelectionAdd}
            @add-selection-multiple=${this._handleSearchSelectionAddMultiple}
            @remove-selection=${this._handleSearchSelectionRemove}
          ></protspace-protein-search>
        </div>

        <!-- Right side controls -->
        <div class="right-controls">
          <!-- Selection actions group -->
          <div class="selection-group" data-driver-id="selection">
            <!-- Selection mode toggle -->
            <button
              class=${this.selectionMode
                ? 'btn-primary right-controls-button right-controls-select'
                : 'btn-secondary right-controls-select right-controls-button'}
              ?disabled=${this._selectionDisabled}
              @click=${this.handleToggleSelectionMode}
              title=${this._selectionDisabled
                ? 'Selection disabled: Insufficient data points'
                : 'Select proteins by clicking or dragging to enclose multiple points'}
            >
              <svg class="icon" viewBox="0 0 24 24">
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="1"
                  stroke="currentColor"
                  stroke-dasharray="2 1"
                  fill="none"
                />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                <circle cx="12" cy="14" r="1.5" fill="currentColor" />
                <circle cx="16" cy="10" r="1.5" fill="currentColor" />
                <circle cx="7" cy="16" r="1.5" fill="currentColor" />
                <circle cx="17" cy="17" r="1.5" fill="currentColor" />
              </svg>
              Select
            </button>

            <!-- Selection tool picker (visible only in selection mode) -->
            ${this.selectionMode
              ? html`
                  <div class="segmented segmented--icon" role="group" aria-label="Selection tool">
                    <button
                      type="button"
                      class="segmented-btn"
                      @click=${() => this.handleSelectionToolChange('rectangle')}
                      title="Rectangle selection"
                      aria-label="Rectangle selection"
                      aria-pressed=${this.selectionTool === 'rectangle'}
                    >
                      <svg class="icon" viewBox="0 0 24 24">
                        <rect
                          x="4"
                          y="4"
                          width="16"
                          height="16"
                          rx="1"
                          stroke="currentColor"
                          stroke-dasharray="3 2"
                          fill="none"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="segmented-btn"
                      @click=${() => this.handleSelectionToolChange('lasso')}
                      title="Lasso selection"
                      aria-label="Lasso selection"
                      aria-pressed=${this.selectionTool === 'lasso'}
                    >
                      <svg class="icon" viewBox="0 0 24 24">
                        <path
                          d="M12 3C7 3 3 7 3 11c0 3 2 5.5 5 7l1.5 2.5c.3.5.8.5 1 0L12 18c5 0 9-3.5 9-7.5S17 3 12 3z"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          fill="none"
                        />
                      </svg>
                    </button>
                  </div>
                `
              : ''}

            <!-- Clear selections button -->
            <button
              class="btn-secondary right-controls-button right-controls-clear"
              ?disabled=${this.selectedProteinsCount === 0}
              @click=${this.handleClearSelections}
              title="Clear all selected proteins"
            >
              <svg class="icon" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>

            <!-- Isolate data button -->
            <button
              class="btn-secondary right-controls-button right-controls-split"
              ?disabled=${this.selectedProteinsCount === 0}
              @click=${this.handleSplitData}
              title="Isolate selected proteins to focus on them"
            >
              <svg class="icon" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M12 1v5m0 12v5M3.93 3.93l3.54 3.54m9.06 9.06l3.54 3.54M1 12h5m12 0h5M3.93 20.07l3.54-3.54m9.06-9.06l3.54-3.54"
                  opacity="0.6"
                />
              </svg>
              Isolate
            </button>

            <!-- Reset split button -->
            ${this.isolationMode
              ? html`
                  <button
                    @click=${this.handleResetSplit}
                    title="Reset to original dataset"
                    class="btn-secondary"
                  >
                    <svg class="icon" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0V9a8.002 8.002 0 0115.356 2m-15.356-2L4 4m15.356 6l2.5-2.5"
                      />
                    </svg>
                    Reset
                  </button>
                `
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this._onDocumentClick);
    document.addEventListener('keydown', this._onDocumentKeydown);

    if (this.autoSync) {
      this._setupAutoSync();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cancelPendingCommits();
    document.removeEventListener('click', this._onDocumentClick);
    document.removeEventListener('keydown', this._onDocumentKeydown);
    this._clearAutoSyncTimer();

    if (this._scatterplotElement) {
      this._scatterplotElement.removeEventListener('data-change', this._onDataChange);
      this._scatterplotElement.removeEventListener('protein-click', this._onProteinClick);
      this._scatterplotElement.removeEventListener('brush-selection', this._onBrushSelection);
      this._scatterplotElement.removeEventListener('data-isolation', this._onDataIsolation);
      this._scatterplotElement.removeEventListener(
        'data-isolation-reset',
        this._onDataIsolationReset,
      );
      this._scatterplotElement.removeEventListener(
        'auto-disable-selection',
        this._onAutoDisableSelection,
      );
    }
  }

  /** A pick made on a dataset or element that is going away must not land later. */
  private _cancelPendingCommits() {
    this._selectionCommit.cancel();
  }

  private handleDocumentKeydown(event: KeyboardEvent) {
    const path = event.composedPath?.() ?? [];
    const inAriaModal = path.some(
      (n) => n instanceof HTMLElement && n.getAttribute('aria-modal') === 'true',
    );
    // A modal (the legend's dialogs, the figure editor) owns its own Escape.
    if (inAriaModal) return;

    if (event.key === 'Escape') {
      // Top priority: close any open duplicate-badge spider on the scatter plot before falling
      // through to selection-clearing. Open menus are layers, which take Escape before this.
      if (this._scatterplotElement?.hasExpandedDuplicateStack?.()) {
        event.preventDefault();
        event.stopPropagation();
        this._scatterplotElement.closeExpandedDuplicateStack?.();
        return;
      }

      // First priority: Clear selections if any exist
      if (this.selectedProteinsCount > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.handleClearSelections();
      }
      // Second priority: Turn off selection mode
      else if (this.selectionMode) {
        event.preventDefault();
        event.stopPropagation();
        this.handleToggleSelectionMode();
      }
    }
  }

  /** A click outside the search box closes its suggestions (its blur also does, 200 ms later). */
  private handleDocumentClick(event: Event) {
    const path = (event as Event & { composedPath?: () => EventTarget[] }).composedPath?.() || [];
    const searchElement = this.shadowRoot?.querySelector('protspace-protein-search');
    if (
      searchElement &&
      !path.includes(searchElement) &&
      !searchElement.contains(event.target as Node)
    ) {
      searchElement.dispatchEvent(new CustomEvent('close-search', { bubbles: false }));
    }
  }

  private _clearAutoSyncTimer() {
    if (this._autoSyncTimer !== null) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
  }

  private _scheduleAutoSync(callback: () => void, delayMs: number) {
    this._autoSyncTimer = setTimeout(() => {
      this._autoSyncTimer = null;
      if (this.isConnected) callback();
    }, delayMs);
  }

  private _setupAutoSync() {
    this._clearAutoSyncTimer();
    // Find scatterplot element with retries
    const trySetup = (attempts: number = 0) => {
      this._scatterplotElement = document.querySelector(
        this.scatterplotSelector,
      ) as ScatterplotElementLike | null;

      if (this._scatterplotElement) {
        this._scatterplotElement.addEventListener('data-change', this._onDataChange);
        this._scatterplotElement.addEventListener('protein-click', this._onProteinClick);
        this._scatterplotElement.addEventListener('brush-selection', this._onBrushSelection);
        this._scatterplotElement.addEventListener('data-isolation', this._onDataIsolation);
        this._scatterplotElement.addEventListener(
          'data-isolation-reset',
          this._onDataIsolationReset,
        );
        this._scatterplotElement.addEventListener(
          'auto-disable-selection',
          this._onAutoDisableSelection,
        );

        // Initial sync after a short delay to ensure scatterplot is ready
        this._scheduleAutoSync(() => this._syncWithScatterplot(), 50);
      } else if (attempts < 10) {
        // Retry up to 10 times with increasing delay
        this._scheduleAutoSync(() => trySetup(attempts + 1), 100 + attempts * 50);
      }
    };

    trySetup();
  }

  /** The search box's protein ids, and the chips from the plot's selection. */
  private _handleDataChange(event: Event) {
    const { data } = (event as CustomEvent<DataChangeDetail>).detail || {};
    if (!data) return;

    try {
      const ids = data.protein_ids;
      this.allProteinIds = Array.isArray(ids) ? ids : [];
      // Keep chips in sync with scatterplot's selection if available
      if (this._scatterplotElement && 'selectedProteinIds' in this._scatterplotElement) {
        const current = (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds;
        this.selectedIdsChips = Array.isArray(current) ? current : [];
        this.selectedProteinsCount = this.selectedIdsChips.length;
      }
    } catch (e) {
      console.error(e);
    }

    this.requestUpdate();
  }

  /**
   * Single commit point for every selection change: mirror the new selection into local
   * state, into the scatterplot when auto-syncing, and out on `protein-selection-change`.
   * Each caller only derives `newSelection`; keeping the commit here stops the four steps
   * from drifting apart across the handlers that share them.
   *
   * `afterPaint` (search box picks, Clear) also sets the chips and count now, so the next
   * pick builds on this one, and runs the commit after the cleared box is painted.
   * `showProteinId` then loads into the structure viewers with that commit.
   */
  private _commitSelection(
    newSelection: string[],
    { afterPaint = false, showProteinId }: { afterPaint?: boolean; showProteinId?: string } = {},
  ) {
    const commit = () => {
      this.selectedIdsChips = newSelection;
      this.selectedProteinsCount = newSelection.length;
      if (
        this.autoSync &&
        this._scatterplotElement &&
        'selectedProteinIds' in this._scatterplotElement
      ) {
        (this._scatterplotElement as ScatterplotElementLike).selectedProteinIds = [...newSelection];
      }
      this.dispatchEvent(
        new CustomEvent('protein-selection-change', {
          detail: { proteinIds: newSelection.slice() },
          bubbles: true,
          composed: true,
        }),
      );
      if (showProteinId) this._loadIntoStructureViewers(showProteinId);
    };
    if (afterPaint) {
      this.selectedIdsChips = newSelection;
      this.selectedProteinsCount = newSelection.length;
      this._selectionCommit.schedule(commit);
    } else {
      this._selectionCommit.cancel();
      commit();
    }
  }

  /** Load a protein into every mounted structure viewer. */
  private _loadIntoStructureViewers(proteinId: string) {
    const viewers = Array.from(
      document.querySelectorAll('protspace-structure-viewer'),
    ) as StructureViewerElement[];
    viewers.forEach((v) => v?.loadProtein?.(proteinId));
  }

  private _handleProteinSelection(event: Event) {
    const { proteinId, modifierKeys } = (event as CustomEvent<ProteinClickDetail>).detail;
    if (!proteinId) return;

    let newSelection: string[];

    // Toggle mode: When selectionMode is active OR modifier keys are pressed
    if (this.selectionMode || modifierKeys?.ctrl || modifierKeys?.meta) {
      newSelection = toggleProteinSelection(proteinId, this.selectedIdsChips);
    }
    // Replace mode: No modifier keys and selectionMode inactive
    else {
      const isOnlySelected =
        this.selectedIdsChips.length === 1 && this.selectedIdsChips[0] === proteinId;
      newSelection = isOnlySelected ? [] : [proteinId];
    }
    this._commitSelection(newSelection);
    this.requestUpdate();
  }

  private _handleDataIsolation(event: Event) {
    const customEvent = event as CustomEvent;
    const { isolationHistory, isolationMode } = customEvent.detail;
    this.isolationHistory = isolationHistory;
    this.isolationMode = isolationMode;
    this.selectedProteinsCount = 0;
    this.selectedIdsChips = [];
    this.requestUpdate();
  }

  private _handleDataIsolationReset(event: Event) {
    const customEvent = event as CustomEvent;
    const { isolationHistory, isolationMode } = customEvent.detail;
    this.isolationHistory = isolationHistory;
    this.isolationMode = isolationMode;
    this.selectedProteinsCount = 0;
    this.selectedIdsChips = [];

    // Re-enable selection when isolation is reset (back to full data)
    this._selectionDisabled = false;

    this.requestUpdate();
  }

  private _handleAutoDisableSelection(event: Event) {
    const customEvent = event as CustomEvent;
    const { reason, dataSize } = customEvent.detail;

    // Handle the business logic
    this.selectionMode = false;

    // Disable the selection mode toggle when insufficient data
    if (reason === 'insufficient-data' && dataSize <= 1) {
      this._selectionDisabled = true;
    }

    this.requestUpdate();

    // Dispatch a separate notification event for the UI layer to handle
    // This separates business logic from presentation concerns
    const detail: SelectionDisabledNotificationDetail = createSelectionDisabledNotificationDetail(
      reason,
      dataSize,
    );

    this.dispatchEvent(
      new CustomEvent<SelectionDisabledNotificationDetail>('selection-disabled-notification', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _syncWithScatterplot() {
    if (this._scatterplotElement && 'getCurrentData' in this._scatterplotElement) {
      const scatterplot = this._scatterplotElement as ScatterplotElementLike;
      const data = scatterplot.getCurrentData?.();

      if (data) {
        if ('selectionMode' in scatterplot) {
          this.selectionMode = Boolean(scatterplot.selectionMode);
        }

        if ('selectedProteinIds' in scatterplot) {
          this.selectedProteinsCount = ((scatterplot.selectedProteinIds as unknown[]) || []).length;
          this.selectedIdsChips = Array.isArray(scatterplot.selectedProteinIds)
            ? (scatterplot.selectedProteinIds as string[])
            : [];
        }

        this.isolationMode = scatterplot.isIsolationMode?.() ?? false;
        this.isolationHistory = scatterplot.getIsolationHistory?.() ?? [];

        this.requestUpdate();
      }
    }
  }

  // Search selection handler
  private _handleSearchSelectionChange(event: CustomEvent<{ proteinIds: string[] }>) {
    // This handles programmatic changes and clearing from within the search component
    this._commitSelection(event.detail.proteinIds);
  }

  private _handleSearchSelectionAdd(event: CustomEvent<{ proteinId: string }>) {
    const { proteinId } = event.detail;
    if (!proteinId || this.selectedIdsChips.includes(proteinId)) return;

    this._commitSelection([...this.selectedIdsChips, proteinId], {
      afterPaint: true,
      showProteinId: proteinId,
    });
  }

  private _handleSearchSelectionRemove(event: CustomEvent<{ proteinId: string }>) {
    const { proteinId } = event.detail;
    if (!proteinId || !this.selectedIdsChips.includes(proteinId)) return;

    // No structure-viewer call here: removal has no "the protein you just picked" to show.
    // The app-level `protein-selection-change` listener still re-points the viewer at the
    // new last-remaining protein (or leaves it alone once the selection empties).
    this._commitSelection(
      this.selectedIdsChips.filter((id) => id !== proteinId),
      { afterPaint: true },
    );
  }

  private _handleSearchSelectionAddMultiple(event: CustomEvent<{ proteinIds: string[] }>) {
    const { proteinIds } = event.detail;
    if (!proteinIds || proteinIds.length === 0) return;

    const currentSelectedSet = new Set(this.selectedIdsChips);
    const newUniqueIds = proteinIds.filter((id) => !currentSelectedSet.has(id));

    if (newUniqueIds.length === 0) return;

    this._commitSelection([...this.selectedIdsChips, ...newUniqueIds], {
      afterPaint: true,
      showProteinId: newUniqueIds[newUniqueIds.length - 1],
    });
  }

  private _handleBrushSelection(event: Event) {
    const customEvent = event as CustomEvent<BrushSelectionDetail>;
    const ids = Array.isArray(customEvent.detail?.proteinIds) ? customEvent.detail.proteinIds : [];
    const distinct = customEvent.detail?.idsUnique === true;

    // When selectionMode is active, merge with existing; otherwise replace
    this._commitSelection(
      this.selectionMode
        ? mergeProteinSelections(this.selectedIdsChips, ids, distinct)
        : ids.slice(),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-control-bar': ProtspaceControlBar;
  }
}
```

In `packages/core/src/components/control-bar/control-bar.events.ts`, delete `import type { DensityLayerMode } from '@protspace/utils';` and the `DensityLayerChangeDetail` interface with its comment (it lives in `contours-menu.ts` now).

In `packages/core/src/utils/dropdown-helpers.ts`, delete `isAnyDropdownOpen` with its doc comment (lines 20-30): its only caller was the control bar's Escape handler.

In `packages/core/src/components/control-bar/styles/layout.ts`, delete `min-width: 900px;` from the `.control-bar` rule: what is left of the bar (search and selection) shares the view bar with the pickers and Filter until Task 2.10.

Delete `packages/core/src/components/control-bar/control-bar.density-layer.test.ts` (ported to `contours-menu.browser.test.ts` in Task 2.7).

Replace `packages/core/src/components/control-bar/control-bar.after-paint.test.ts` with its search, Clear and new-dataset cases (the annotation and projection cases moved to the pickers' tests):

```ts
/**
 * @vitest-environment jsdom
 *
 * A pick from the search box or the Clear button updates the chips in the frame of the input,
 * and only after that frame is painted does it reach the scatter plot (which re-stages every
 * point for it) and the selection event. These tests pin that split, the last-pick-wins rule,
 * and that a selection committed at once drops a pick still waiting. The view pickers carry the
 * same rules in their own tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';

interface StubScatterplot {
  selectedProteinIds: string[];
  isolateSelection: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface ControlBarInternals extends HTMLElement {
  autoSync: boolean;
  selectedProteinsCount: number;
  allProteinIds: string[];
  selectedIdsChips: string[];
  _scatterplotElement: StubScatterplot | null;
  clearForNewDataset(datasetHash: string): void;
  updateComplete: Promise<unknown>;
}

/** Resolves in the task after the next frame, i.e. once a pick made now has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('control-bar commits search picks after the paint', () => {
  let controlBar: ControlBarInternals;
  let plot: StubScatterplot;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    controlBar.autoSync = false;
    controlBar.allProteinIds = ['P1', 'P2', 'P3'];
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    plot = {
      selectedProteinIds: [],
      isolateSelection: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    controlBar._scatterplotElement = plot;
    controlBar.autoSync = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const shadow = () => controlBar.shadowRoot!;
  const search = () => shadow().querySelector('protspace-protein-search') as HTMLElement;
  const fromSearch = (type: string, detail: unknown) =>
    search().dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

  describe('search box', () => {
    it('updates the chips now and pushes the selection after the paint', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('protein-selection-change', changed);
      const viewer = document.createElement('protspace-structure-viewer') as HTMLElement & {
        loadProtein: ReturnType<typeof vi.fn>;
      };
      viewer.loadProtein = vi.fn();
      document.body.appendChild(viewer);

      fromSearch('add-selection', { proteinId: 'P2' });

      expect(controlBar.selectedIdsChips).toEqual(['P2']);
      expect(controlBar.selectedProteinsCount).toBe(1);
      expect(plot.selectedProteinIds).toEqual([]);
      expect(changed).not.toHaveBeenCalled();
      expect(viewer.loadProtein).not.toHaveBeenCalled();

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P2']);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(viewer.loadProtein).toHaveBeenCalledWith('P2');
    });

    it('builds each pick on the last and pushes them once', async () => {
      const changed = vi.fn();
      controlBar.addEventListener('protein-selection-change', changed);

      fromSearch('add-selection', { proteinId: 'P1' });
      fromSearch('add-selection-multiple', { proteinIds: ['P2', 'P3'] });
      fromSearch('remove-selection', { proteinId: 'P2' });
      expect(controlBar.selectedIdsChips).toEqual(['P1', 'P3']);

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P1', 'P3']);
      expect(changed).toHaveBeenCalledTimes(1);
      expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({
        proteinIds: ['P1', 'P3'],
      });
    });

    it('lands a waiting pick before isolating', async () => {
      plot.isolateSelection.mockImplementation(() => {
        expect(plot.selectedProteinIds).toEqual(['P1']);
      });
      fromSearch('add-selection', { proteinId: 'P1' });
      await controlBar.updateComplete;

      (shadow().querySelector('.right-controls-split') as HTMLButtonElement).click();

      expect(plot.isolateSelection).toHaveBeenCalledTimes(1);
      expect(plot.selectedProteinIds).toEqual(['P1']);
    });

    it('is dropped by a selection committed at once elsewhere', async () => {
      fromSearch('add-selection', { proteinId: 'P1' });
      fromSearch('selection-change', { proteinIds: ['P3'] });
      expect(plot.selectedProteinIds).toEqual(['P3']);

      await afterNextPaint();

      expect(plot.selectedProteinIds).toEqual(['P3']);
      expect(controlBar.selectedIdsChips).toEqual(['P3']);
    });
  });

  it('Clear empties the chips now and the plot selection after the paint', async () => {
    fromSearch('add-selection', { proteinId: 'P1' });
    await afterNextPaint();
    await controlBar.updateComplete;
    const cleared = vi.fn();
    controlBar.addEventListener('clear-selections', cleared);

    (shadow().querySelector('.right-controls-clear') as HTMLButtonElement).click();

    expect(cleared).toHaveBeenCalledTimes(1);
    expect(controlBar.selectedProteinsCount).toBe(0);
    expect(plot.selectedProteinIds).toEqual(['P1']);

    await afterNextPaint();

    expect(plot.selectedProteinIds).toEqual([]);
  });

  it('a new dataset drops a search pick still waiting', async () => {
    fromSearch('add-selection', { proteinId: 'P1' });

    controlBar.clearForNewDataset('hash');
    await afterNextPaint();

    expect(plot.selectedProteinIds).toEqual([]);
  });
});
```

- [ ] **Step 8: Export the promoted elements from core and run the core suite**

In `packages/core/src/index.ts`, at the end of Task 2.7's block that starts `// The view bar's pickers (design decision 9).` (below its `DensityLayerChangeDetail` line), add:

```ts
export { ProtspaceAnnotationSelect } from './components/control-bar/annotation-select';
export { ProtspaceProjectionMetadata } from './components/scatter-plot/projection-metadata/projection-metadata';
```

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS. Against the Task 2.7 counts: unit files −1 (`control-bar.density-layer.test.ts`, 4 tests), `control-bar.after-paint.test.ts` −8 tests, `annotation-select.component.test.ts` −1 +8, `projection-metadata.component.test.ts` +1, `scatterplot-sync-controller.test.ts` ±0; browser files unchanged.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core build`
Expected: no errors; `dist/` rebuilt.

- [ ] **Step 9: Point the view controller at the pickers**

In `apps/web/src/explore/view-controller.ts`:

1. Replace the core import (line 1) with `import type { ProtspaceScatterplot } from '@protspace/core';`.
2. Replace `interface ViewControllerOptions` (:18-21) with:

```ts
/**
 * The view bar's pickers as the view controller drives them (the view-bar controller). Each
 * `apply*Selection` changes the plot at once and dispatches its change event synchronously,
 * which the app routes back here as a user change; `applyDensityLayerSelection` dispatches nothing.
 */
export interface ViewPickers {
  readonly selectedProjection: string;
  readonly selectedAnnotation: string;
  readonly tooltipAnnotations: readonly string[];
  applyProjectionSelection(projection: string): void;
  applyAnnotationSelection(annotation: string): void;
  applyTooltipAnnotationsSelection(names: string[]): void;
  applyDensityLayerSelection(mode: DensityLayerMode): void;
}

interface ViewControllerOptions {
  plotElement: ProtspaceScatterplot;
  pickers: ViewPickers;
}
```

3. In `createViewController`, rename the destructured option `controlBar` to `pickers` and every `controlBar.` in the function to `pickers.`; in `getCurrentEffectiveView` rename `validControlBarProjection` to `validPickerProjection`; `selectTooltipAnnotations` calls `pickers.applyTooltipAnnotationsSelection(tooltipAnnotations);` (no optional call); `selectDensityLayer` stays:

```ts
  const selectDensityLayer = (density: DensityLayerMode) => {
    pickers.applyDensityLayerSelection(density);
    plotElement.config = { ...(plotElement.config ?? {}), densityLayer: density };
  };
```

4. Change the comment above `const wasApplyingView = isApplyingView;` to begin `// The pickers dispatch their change events synchronously from these apply* calls,`.

In `apps/web/src/explore/view-controller.test.ts`: rename the mock object `controlBar` to `pickers` everywhere (its declaration in `createMockElements`, the `return { plotElement, pickers }`, every `controlBar.` access and every destructuring), pass it as `pickers: pickers as never` in both `createViewController` calls, rename the test `'suppresses the control-bar echo of an applied view'` to `'suppresses the pickers’ echo of an applied view'` and `'applies a requested density mode to the plot config and the control bar'` to `'applies a requested density mode to the plot config and the contours picker'`, and change the comment `// The real control bar dispatches annotation-change synchronously, which the` to `// The real annotation picker dispatches annotation-change synchronously, which the`. The mocks' behaviour is unchanged: `applyProjectionSelection` still sets the plot's index the way the view-bar controller does.

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/view-controller.test.ts`
Expected: PASS, every test (same count as before).

- [ ] **Step 10: Write the failing view-bar-controller test**

Create `apps/web/src/explore/view-bar-controller.test.ts`:

```ts
import type {
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceScatterplot,
} from '@protspace/core';
import type { VisualizationData } from '@protspace/utils';
import { describe, expect, it, vi } from 'vitest';
import { createViewBarController, deriveViewOptions } from './view-bar-controller';

/** Fixtures carry only what the controller reads, so they go through `unknown`. */
const asData = (data: unknown) => data as VisualizationData;

function makeData(): VisualizationData {
  return asData({
    protein_ids: ['p0', 'p1'],
    projections: [{ name: 'UMAP' }, { name: 'PCA' }],
    annotations: {
      family: { kind: 'categorical', values: ['A'] },
      species: { kind: 'categorical', values: ['H'] },
      gene_name: { kind: 'categorical', values: ['g'] },
      family__eat_confidence: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
      },
    },
    annotation_predicted: {
      family: [null, { value: 'A', confidence: 0.9, source: 'p0' }],
      species: [null, null],
    },
    statisticsRows: [],
  });
}

function setup(data = makeData()) {
  const plot = Object.assign(new EventTarget(), {
    data,
    selectedProjectionIndex: 0,
    selectedAnnotation: 'family',
    tooltipAnnotations: [] as string[],
    config: { pointSize: 80 } as Record<string, unknown>,
    filtersActive: false,
    isIsolationMode: () => false,
    getMaterializedData: vi.fn(() => data),
    getCurrentData: vi.fn(() => data),
  });
  // Each fake applySelection behaves like its element: set the value, dispatch at once.
  const projectionSelect = Object.assign(new EventTarget(), {
    projections: [] as readonly string[],
    selectedProjection: '',
    applySelection: vi.fn((projection: string) => {
      projectionSelect.selectedProjection = projection;
      projectionSelect.dispatchEvent(
        new CustomEvent('projection-change', { detail: { projection } }),
      );
    }),
    cancelPending: vi.fn(),
  });
  const annotationSelect = Object.assign(new EventTarget(), {
    annotations: [] as string[],
    eatAnnotations: [] as string[],
    annotationDefinitions: {} as Record<string, unknown>,
    statisticsRows: [] as readonly unknown[],
    selectedAnnotation: '',
    selectedProjection: '',
    tooltipAnnotations: [] as string[],
    applySelection: vi.fn(),
    applyTooltipSelection: vi.fn(),
    cancelPending: vi.fn(),
  });
  const contoursMenu = Object.assign(new EventTarget(), {
    densityLayer: 'off',
    // Like the element: an applied mode is the menu's mode from then on.
    applySelection: vi.fn((mode: string) => {
      contoursMenu.densityLayer = mode;
    }),
    cancelPending: vi.fn(),
  });
  const projectionMetadata = {
    projection: null as unknown,
    statisticsRows: undefined as unknown,
    selectedAnnotation: '',
    viewIsSubset: false,
  };
  const root = new EventTarget();
  const interactionController = { handleAnnotationChange: vi.fn() };
  const onUserChange = vi.fn();
  const controller = createViewBarController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    projectionSelect: projectionSelect as unknown as ProtspaceProjectionSelect,
    annotationSelect: annotationSelect as unknown as ProtspaceAnnotationSelect,
    contoursMenu: contoursMenu as unknown as ProtspaceContoursMenu,
    projectionMetadata: projectionMetadata as unknown as ProtspaceProjectionMetadata,
    interactionController,
    root: root as unknown as Document,
    onUserChange,
  });
  return {
    controller,
    plot,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    root,
    interactionController,
    onUserChange,
    data,
  };
}

/** As the DOM delivers a bubbling, composed event: on the picker, then on the document. */
function bubble(target: EventTarget, root: EventTarget, type: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
  root.dispatchEvent(new CustomEvent(type, { detail }));
}

describe('deriveViewOptions', () => {
  it('deriveViewOptions hides tooltip-only and EAT-confidence columns and lists predicted annotations', () => {
    const data = asData({
      projections: [{ name: 'umap' }],
      annotations: {
        pfam: { kind: 'categorical', values: ['a', 'b'] },
        gene_name: { kind: 'categorical', values: ['x'] },
        pfam__eat_confidence: {
          kind: 'numeric',
          values: ['0.9', '0.4'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
        // Collision-renamed (`<base>__eat_confidence__runtime_N`): identity keys off
        // runtime.role, not the suffix.
        pfam__eat_confidence__runtime_2: {
          kind: 'numeric',
          values: ['0.1', '0.7'],
          runtime: { role: 'eat-confidence', baseAnnotation: 'pfam' },
        },
      },
      annotation_predicted: {
        pfam: [null, { value: 'a', confidence: 0.8, source: 'P1' }],
        ec: [null, null],
      },
    });

    expect(deriveViewOptions(data)).toEqual({
      projections: ['umap'],
      annotations: ['pfam'],
      eatAnnotations: ['pfam'],
    });
  });

  it('deriveViewOptions reads the predicted annotations from the capability data', () => {
    const shown = asData({ projections: [], annotations: { ec: { kind: 'categorical' } } });
    const capability = asData({
      projections: [],
      annotations: {},
      annotation_predicted: { ec: [{ value: 'x', confidence: 1, source: 'p' }] },
    });

    expect(deriveViewOptions(shown, capability).eatAnnotations).toEqual(['ec']);
    expect(deriveViewOptions(shown).eatAnnotations).toEqual([]);
  });
});

describe('createViewBarController', () => {
  it("a projection pick sets the plot's index before onUserChange", () => {
    const m = setup();
    let indexAtChange = -1;
    m.onUserChange.mockImplementation(() => {
      indexAtChange = m.plot.selectedProjectionIndex;
    });

    m.projectionSelect.dispatchEvent(
      new CustomEvent('projection-change', { detail: { projection: 'PCA' } }),
    );

    expect(m.onUserChange).toHaveBeenCalledWith('projection');
    expect(indexAtChange).toBe(1);
    expect(m.annotationSelect.selectedProjection).toBe('PCA');
    expect(m.projectionMetadata.projection).toBe(m.data.projections[1]);
  });

  it('an annotation pick writes the plot and clears provenance before onUserChange', () => {
    const m = setup();
    const order: string[] = [];
    m.annotationSelect.addEventListener('annotation-change', () =>
      order.push(`plot:${m.plot.selectedAnnotation}`),
    );
    m.interactionController.handleAnnotationChange.mockImplementation(() =>
      order.push('clear provenance'),
    );
    m.onUserChange.mockImplementation((kind: string) => order.push(kind));

    bubble(m.annotationSelect, m.root, 'annotation-change', { annotation: 'species' });

    // The plot was written in the picker's own listener, before the document heard the event.
    expect(order).toEqual(['plot:species', 'clear provenance', 'annotation']);
    expect(m.plot.selectedAnnotation).toBe('species');
    expect(m.projectionMetadata.selectedAnnotation).toBe('species');
  });

  it('tooltip changes reach the plot', () => {
    const m = setup();

    m.annotationSelect.dispatchEvent(
      new CustomEvent('tooltip-annotations-change', {
        detail: { tooltipAnnotations: ['species'] },
      }),
    );

    expect(m.plot.tooltipAnnotations).toEqual(['species']);
    expect(m.onUserChange).toHaveBeenCalledWith('tooltip');
  });

  it("a contours pick writes the plot's config", () => {
    const m = setup();

    m.contoursMenu.dispatchEvent(
      new CustomEvent('density-layer-change', { detail: { densityLayer: 'auto' } }),
    );

    expect(m.plot.config).toEqual({ pointSize: 80, densityLayer: 'auto' });
    expect(m.onUserChange).toHaveBeenCalledWith('density');
  });

  it('showInitialView sets the pickers without events', () => {
    const m = setup();
    const projectionChange = vi.fn();
    m.projectionSelect.addEventListener('projection-change', projectionChange);

    m.controller.showInitialView({ projection: 'PCA', annotation: 'species', tooltip: ['family'] });

    expect(m.projectionSelect.selectedProjection).toBe('PCA');
    expect(m.annotationSelect.selectedAnnotation).toBe('species');
    expect(m.annotationSelect.tooltipAnnotations).toEqual(['family']);
    expect(m.annotationSelect.selectedProjection).toBe('PCA');
    expect(m.projectionSelect.applySelection).not.toHaveBeenCalled();
    expect(m.annotationSelect.applySelection).not.toHaveBeenCalled();
    expect(projectionChange).not.toHaveBeenCalled();
    expect(m.onUserChange).not.toHaveBeenCalled();
  });

  it('resetForNewDataset cancels waiting picks', () => {
    const m = setup();

    m.controller.resetForNewDataset();

    expect(m.projectionSelect.cancelPending).toHaveBeenCalledOnce();
    expect(m.annotationSelect.cancelPending).toHaveBeenCalledOnce();
    expect(m.contoursMenu.cancelPending).toHaveBeenCalledOnce();
  });

  it('data-change refreshes the options and the projection details', () => {
    const m = setup();

    m.plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: m.data } }));

    expect(m.projectionSelect.projections).toEqual(['UMAP', 'PCA']);
    expect(m.annotationSelect.annotations).toEqual(['family', 'species']);
    expect(m.annotationSelect.eatAnnotations).toEqual(['family']);
    expect(m.annotationSelect.annotationDefinitions).toBe(m.data.annotations);
    // With nothing valid selected yet, the first projection and annotation, as before.
    expect(m.projectionSelect.selectedProjection).toBe('UMAP');
    expect(m.annotationSelect.selectedAnnotation).toBe('family');
    expect(m.annotationSelect.selectedProjection).toBe('UMAP');
    expect(m.projectionMetadata.projection).toBe(m.data.projections[0]);
    expect(m.projectionMetadata.selectedAnnotation).toBe('family');
    expect(m.projectionMetadata.viewIsSubset).toBe(false);
  });

  it('the view pickers read and write through the pickers', () => {
    const m = setup();
    m.projectionSelect.selectedProjection = 'UMAP';
    m.annotationSelect.selectedAnnotation = 'family';
    m.annotationSelect.tooltipAnnotations = ['species'];

    expect(m.controller.selectedProjection).toBe('UMAP');
    expect(m.controller.selectedAnnotation).toBe('family');
    expect(m.controller.tooltipAnnotations).toEqual(['species']);

    m.controller.applyProjectionSelection('PCA');
    expect(m.projectionSelect.applySelection).toHaveBeenCalledWith('PCA');
    expect(m.plot.selectedProjectionIndex).toBe(1);
    m.controller.applyAnnotationSelection('species');
    expect(m.annotationSelect.applySelection).toHaveBeenCalledWith('species');
    m.controller.applyTooltipAnnotationsSelection(['family']);
    expect(m.annotationSelect.applyTooltipSelection).toHaveBeenCalledWith(['family']);
    m.controller.applyDensityLayerSelection('on');
    expect(m.contoursMenu.applySelection).toHaveBeenCalledWith('on');
  });

  it('dispose stops listening', () => {
    const m = setup();
    m.controller.dispose();

    m.projectionSelect.dispatchEvent(
      new CustomEvent('projection-change', { detail: { projection: 'PCA' } }),
    );
    bubble(m.annotationSelect, m.root, 'annotation-change', { annotation: 'species' });

    expect(m.onUserChange).not.toHaveBeenCalled();
    expect(m.plot.selectedProjectionIndex).toBe(0);
  });
});
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/view-bar-controller.test.ts`
Expected: FAIL: `Failed to resolve import "./view-bar-controller"`.

- [ ] **Step 11: Write the view-bar controller**

Create `apps/web/src/explore/view-bar-controller.ts`:

```ts
import type {
  DensityLayerChangeDetail,
  ProtspaceAnnotationSelect,
  ProtspaceContoursMenu,
  ProtspaceProjectionMetadata,
  ProtspaceProjectionSelect,
  ProtspaceScatterplot,
} from '@protspace/core';
import {
  isEatConfidenceAnnotation,
  type ProjectionStatisticRow,
  type VisualizationData,
} from '@protspace/utils';
import type { InitialView } from './explore-controls';
import type { InteractionController } from './interaction-controller';
import type { ViewPickers } from './view-controller';

/** Annotations shown only in the hover tooltip; Color by and the filter do not offer them. */
export const TOOLTIP_ONLY_ANNOTATIONS: ReadonlySet<string> = new Set([
  'gene_name',
  'protein_name',
  'uniprot_kb_id',
]);

/** Stable empty statistics: a fresh [] per data-change would re-render the annotation picker. */
const NO_STATISTICS: readonly ProjectionStatisticRow[] = [];

interface ViewBarControllerOptions {
  plotElement: ProtspaceScatterplot;
  projectionSelect: ProtspaceProjectionSelect;
  annotationSelect: ProtspaceAnnotationSelect;
  contoursMenu: ProtspaceContoursMenu;
  projectionMetadata: ProtspaceProjectionMetadata;
  interactionController: Pick<InteractionController, 'handleAnnotationChange'>;
  /**
   * Where the bubbling `annotation-change` is heard after the legend's own listener: the
   * document in the app. The legend registers there when it connects, before the runtime starts.
   */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** A pick changed the view (or an apply did; the view controller tells the two apart). */
  onUserChange(kind: 'projection' | 'annotation' | 'tooltip' | 'density'): void;
}

export interface ViewBarController extends ViewPickers {
  /** A new dataset's first view: sets the pickers without dispatching anything. */
  showInitialView(view: InitialView): void;
  /** Drops picks still waiting for their commit. */
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * What the view bar offers for `data`: every projection, and Color by's annotations without the
 * tooltip-only and EAT-confidence columns. `capabilityData` (the plot's full data) says which
 * annotations carry EAT predictions; the shown data can be a subset without them.
 */
export function deriveViewOptions(
  data: VisualizationData,
  capabilityData: VisualizationData = data,
): { projections: string[]; annotations: string[]; eatAnnotations: string[] } {
  const projections = (data.projections ?? []).map((projection) => projection.name);
  const annotations = Object.keys(data.annotations ?? {}).filter(
    (key) => !TOOLTIP_ONLY_ANNOTATIONS.has(key) && !isEatConfidenceAnnotation(data.annotations[key]),
  );
  const eatAnnotations = Object.entries(capabilityData.annotation_predicted ?? {})
    .filter(([, cells]) => cells.some(Boolean))
    .map(([annotation]) => annotation);
  return { projections, annotations, eatAnnotations };
}

/**
 * The view bar (design decision 9): keeps the pickers' options and the projection details in
 * step with the plot, and writes each pick to the plot. Every picker is heard on the element
 * itself, so the plot changes before the legend's document listener re-syncs from it.
 */
export function createViewBarController({
  plotElement,
  projectionSelect,
  annotationSelect,
  contoursMenu,
  projectionMetadata,
  interactionController,
  root,
  onUserChange,
}: ViewBarControllerOptions): ViewBarController {
  /** The projection details show what the plot shows; the plot no longer renders them. */
  const syncProjectionDetails = () => {
    const data = plotElement.data;
    projectionMetadata.projection = data?.projections[plotElement.selectedProjectionIndex] ?? null;
    projectionMetadata.statisticsRows = data?.statisticsRows;
    projectionMetadata.selectedAnnotation = plotElement.selectedAnnotation;
    projectionMetadata.viewIsSubset = plotElement.filtersActive || plotElement.isIsolationMode();
  };

  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: VisualizationData | null }>).detail?.data;
    if (!data) return;
    const options = deriveViewOptions(data, plotElement.data ?? data);
    projectionSelect.projections = options.projections;
    annotationSelect.annotations = options.annotations;
    annotationSelect.eatAnnotations = options.eatAnnotations;
    // The materialized (full) data, so the badges describe the dataset, not an isolated subset.
    const materialized = plotElement.getMaterializedData() ?? plotElement.getCurrentData();
    annotationSelect.annotationDefinitions = materialized?.annotations ?? {};
    annotationSelect.statisticsRows = materialized?.statisticsRows ?? NO_STATISTICS;
    // A dataset without the current choice falls back to its first projection and annotation.
    if (!options.projections.includes(projectionSelect.selectedProjection)) {
      projectionSelect.selectedProjection = options.projections[0] ?? '';
    }
    if (!options.annotations.includes(annotationSelect.selectedAnnotation)) {
      annotationSelect.selectedAnnotation = options.annotations[0] ?? '';
    }
    annotationSelect.selectedProjection = projectionSelect.selectedProjection;
    syncProjectionDetails();
  };

  const onProjectionChange = (event: Event) => {
    const { projection } = (event as CustomEvent<{ projection: string }>).detail;
    const index = (plotElement.data?.projections ?? []).findIndex((p) => p.name === projection);
    if (index !== -1) plotElement.selectedProjectionIndex = index;
    // Statistics are scored per projection.
    annotationSelect.selectedProjection = projection;
    syncProjectionDetails();
    onUserChange('projection');
  };

  /** On the picker: the plot changes before the legend's document listener re-syncs from it. */
  const onAnnotationPicked = (event: Event) => {
    plotElement.selectedAnnotation = (event as CustomEvent<{ annotation: string }>).detail.annotation;
    syncProjectionDetails();
  };

  /**
   * On the document, after the legend's listener, as the control bar's app listener ran: clear
   * the provenance connectors and the plot's hidden values, re-sync the legend, then report.
   */
  const onAnnotationChanged = () => {
    interactionController.handleAnnotationChange();
    onUserChange('annotation');
  };

  const onTooltipChange = (event: Event) => {
    const { tooltipAnnotations } = (event as CustomEvent<{ tooltipAnnotations: string[] }>).detail;
    plotElement.tooltipAnnotations = [...tooltipAnnotations];
    onUserChange('tooltip');
  };

  const onDensityChange = (event: Event) => {
    const { densityLayer } = (event as CustomEvent<DensityLayerChangeDetail>).detail;
    plotElement.config = { ...(plotElement.config ?? {}), densityLayer };
    onUserChange('density');
  };

  plotElement.addEventListener('data-change', onDataChange);
  projectionSelect.addEventListener('projection-change', onProjectionChange);
  annotationSelect.addEventListener('annotation-change', onAnnotationPicked);
  annotationSelect.addEventListener('tooltip-annotations-change', onTooltipChange);
  contoursMenu.addEventListener('density-layer-change', onDensityChange);
  root.addEventListener('annotation-change', onAnnotationChanged);

  return {
    get selectedProjection() {
      return projectionSelect.selectedProjection;
    },
    get selectedAnnotation() {
      return annotationSelect.selectedAnnotation;
    },
    get tooltipAnnotations() {
      return annotationSelect.tooltipAnnotations;
    },
    applyProjectionSelection(projection) {
      projectionSelect.applySelection(projection);
    },
    applyAnnotationSelection(annotation) {
      annotationSelect.applySelection(annotation);
    },
    applyTooltipAnnotationsSelection(names) {
      annotationSelect.applyTooltipSelection(names);
    },
    applyDensityLayerSelection(mode) {
      contoursMenu.applySelection(mode);
    },
    showInitialView(view) {
      projectionSelect.selectedProjection = view.projection;
      annotationSelect.selectedProjection = view.projection;
      annotationSelect.selectedAnnotation = view.annotation;
      annotationSelect.tooltipAnnotations = [...view.tooltip];
      syncProjectionDetails();
    },
    resetForNewDataset() {
      projectionSelect.cancelPending();
      annotationSelect.cancelPending();
      contoursMenu.cancelPending();
    },
    dispose() {
      plotElement.removeEventListener('data-change', onDataChange);
      projectionSelect.removeEventListener('projection-change', onProjectionChange);
      annotationSelect.removeEventListener('annotation-change', onAnnotationPicked);
      annotationSelect.removeEventListener('tooltip-annotations-change', onTooltipChange);
      contoursMenu.removeEventListener('density-layer-change', onDensityChange);
      root.removeEventListener('annotation-change', onAnnotationChanged);
    },
  };
}
```

In `apps/web/src/explore/filter-controller.ts`, replace its private constant

```ts
/** Annotations shown only in the hover tooltip; the filter's column picker does not offer them. */
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);
```

with `import { TOOLTIP_ONLY_ANNOTATIONS } from './view-bar-controller';` among its imports.

In `apps/web/src/explore/example-datasets.test.ts`, replace the duplicated constant and its comment (:230-232)

```ts
// Mirrors `TOOLTIP_ONLY_ANNOTATIONS` in packages/core/src/components/control-bar/control-bar.ts,
// which the colour-by dropdown never offers.
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);
```

with an import at the top of the file:

```ts
// The annotations Color by never offers.
import { TOOLTIP_ONLY_ANNOTATIONS } from './view-bar-controller';
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/view-bar-controller.test.ts src/explore/filter-controller.test.ts src/explore/example-datasets.test.ts`
Expected: PASS: 11 tests in `view-bar-controller.test.ts`; the other two files unchanged.

- [ ] **Step 12: Shrink the control-bar events to the selection warning**

Replace `apps/web/src/explore/control-bar-events.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../lib/notify';
import { bindControlBarEvents } from './control-bar-events';

vi.mock('../lib/notify', () => ({ notify: { warning: vi.fn() } }));

describe('control bar events', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selection-disabled warning as a toast', () => {
    const controlBar = new EventTarget();
    bindControlBarEvents({
      addControlBarListener: (type, listener, options) =>
        controlBar.addEventListener(type, listener, options),
    });

    controlBar.dispatchEvent(
      new CustomEvent('selection-disabled-notification', {
        detail: {
          message: 'Selection mode disabled: Only 1 point remaining',
          severity: 'warning',
          source: 'control-bar',
          context: { reason: 'insufficient-data', dataSize: 1 },
        },
      }),
    );

    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Selection mode disabled.',
        description: 'Selection mode disabled: Only 1 point remaining',
      }),
    );
  });
});
```

Replace `apps/web/src/explore/control-bar-events.ts` with:

```ts
import type { SelectionDisabledNotificationDetail } from '@protspace/core';
import { notify } from '../lib/notify';
import { getSelectionDisabledNotification } from './notifications';

interface ControlBarEventsOptions {
  addControlBarListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

/**
 * The control bar's last host-facing event. The view pickers, Import, Export and Filter have
 * their own controllers; Task 2.9 moves this warning into the selection controller.
 */
export function bindControlBarEvents({ addControlBarListener }: ControlBarEventsOptions): void {
  addControlBarListener('selection-disabled-notification', (event: Event) => {
    const customEvent = event as CustomEvent<SelectionDisabledNotificationDetail>;
    notify.warning(getSelectionDisabledNotification(customEvent.detail));
  });
}
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/control-bar-events.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 13: Mount the pickers and wire the runtime**

In `apps/web/src/workbench/ViewBar.tsx`, insert as the first children of the `div[role="toolbar"]`, before `<protspace-control-bar id="myControlBar" …>`:

```tsx
      <div className="wb-view-group" data-driver-id="projections">
        <protspace-projection-select id="myProjectionSelect"></protspace-projection-select>
        <protspace-projection-metadata id="myProjectionMetadata"></protspace-projection-metadata>
        <protspace-annotation-select id="myAnnotationSelect"></protspace-annotation-select>
      </div>
      <protspace-contours-menu id="myContoursMenu"></protspace-contours-menu>
      <span className="wb-view-sep" aria-hidden="true"></span>
```

(`<FilterControl />` from Task 2.6 stays after the control bar.)

In `apps/web/src/custom-elements.d.ts`, add inside `interface IntrinsicElements`:

```ts
      'protspace-projection-select': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-projection-metadata': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-annotation-select': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
      'protspace-contours-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string },
        HTMLElement
      >;
```

Append to `apps/web/src/workbench/workbench.css`:

```css
/* View bar pickers (Task 2.8): Projection, its details and Color by stay together. */
.wb-view-group {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ps-space-1);
}

.wb-view-sep {
  flex: none;
  width: 1px;
  height: 20px;
  margin: 0 var(--ps-space-1);
  background: var(--ps-border);
}
```

In `apps/web/src/explore/elements.ts`: add `ProtspaceAnnotationSelect`, `ProtspaceContoursMenu`, `ProtspaceProjectionMetadata` and `ProtspaceProjectionSelect` to the `import type { … } from '@protspace/core'` list; add to `interface ExploreElements`

```ts
  projectionSelect: ProtspaceProjectionSelect;
  annotationSelect: ProtspaceAnnotationSelect;
  contoursMenu: ProtspaceContoursMenu;
  projectionMetadata: ProtspaceProjectionMetadata;
```

add `'protspace-projection-select'`, `'protspace-annotation-select'`, `'protspace-contours-menu'` and `'protspace-projection-metadata'` to `REQUIRED_TAGS`; in `getElements` look them up beside the others

```ts
  const projectionSelect = doc.getElementById(
    'myProjectionSelect',
  ) as ProtspaceProjectionSelect | null;
  const annotationSelect = doc.getElementById(
    'myAnnotationSelect',
  ) as ProtspaceAnnotationSelect | null;
  const contoursMenu = doc.getElementById('myContoursMenu') as ProtspaceContoursMenu | null;
  const projectionMetadata = doc.getElementById(
    'myProjectionMetadata',
  ) as ProtspaceProjectionMetadata | null;
```

and add the four to the missing-element condition, the `console.error` object and the returned object.

In `apps/web/src/explore/runtime.ts`:

1. Add `import { createViewBarController } from './view-bar-controller';` beside the other `./` imports.
2. Add `projectionSelect, annotationSelect, contoursMenu, projectionMetadata` to the destructuring `const { … } = elements;`.
3. Delete the block

```ts
  const viewController = createViewController({
    plotElement,
    controlBar,
  });
  lifecycle.addCleanup(() => viewController.dispose());
```

and insert, directly after `const interactionController = createInteractionController({ … });` and before Task 2.6's `const filterController = createFilterController({ … });`:

```ts
  // Before the filter controller: both hear annotation-change on the document, and the filter's
  // reliability mirror runs last, as the control bar's did.
  const viewBarController = createViewBarController({
    plotElement,
    projectionSelect,
    annotationSelect,
    contoursMenu,
    projectionMetadata,
    interactionController,
    root: document,
    onUserChange(kind) {
      if (kind === 'projection') viewController.handleUserProjectionChange();
      else if (kind === 'annotation') viewController.handleUserAnnotationChange();
      else if (kind === 'tooltip') viewController.handleUserTooltipAnnotationsChange();
      else viewController.handleUserDensityLayerChange();
    },
  });
  lifecycle.addCleanup(() => viewBarController.dispose());

  const viewController = createViewController({
    plotElement,
    pickers: viewBarController,
  });
  lifecycle.addCleanup(() => viewController.dispose());
```

(`onUserChange` refers to `viewController` only when a pick happens, after this setup has run.)

4. In the `ExploreControls` object, replace the body of `showInitialView(view)` with

```ts
      viewBarController.showInitialView(view);
      filterController.setSelectedAnnotation(view.annotation);
      // The selection still lives in the control bar until Task 2.9.
      controlBar.selectionMode = false;
      controlBar.selectedProteinsCount = 0;
      controlBar.requestUpdate();
```

and add `viewBarController.resetForNewDataset();` to `resetForNewDataset()`.

5. Replace the `bindControlBarEvents({ … });` call with:

```ts
  bindControlBarEvents({
    addControlBarListener(type, listener, options) {
      addTrackedEventListener(lifecycle, controlBar, type, listener, options);
    },
  });
```

In `apps/web/src/tour/product-tour.ts`, replace step 3, `shadowStep(CONTROL_BAR, 'projections', { … }),`, with:

```ts
  // ── Step 3 – Projections & Annotations (view bar) ────────────
  {
    element: '[data-driver-id="projections"]',
    popover: {
      title: 'Projections & Annotations',
      description:
        'Switch between <strong>projections</strong> (UMAP, PCA, etc.) and choose which <strong>annotation</strong> to color the points by.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },
```

Run: `pnpm --filter @protspace/app type-check && pnpm --filter @protspace/app exec vitest --run`
Expected: no type errors; every app test passes.

- [ ] **Step 14: Retarget the helpers and write the e2e spec**

In `apps/web/tests/helpers/explore.ts`, replace the bodies of these four helpers (keep their exported names and signatures; delete any module-level label map Task 2.3 kept for the control bar's contours menu):

```ts
/** The view bar's Projection trigger; its name is "Projection <current projection>". */
export function projectionTrigger(page: Page): Locator {
  return viewBar(page).getByRole('button', { name: /^Projection/ });
}

/** Pick a projection by its position in the menu, or by its label. */
export async function selectProjection(page: Page, projection: number | string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await projectionTrigger(page).click();
  const items = page.locator('protspace-projection-select').getByRole('menuitemradio');
  const item =
    typeof projection === 'number'
      ? items.nth(projection)
      : page
          .locator('protspace-projection-select')
          .getByRole('menuitemradio', { name: projection, exact: true });
  await pickFromMenu(page, item, 'projection-change');
  if (typeof projection === 'number') {
    await waitForViewState(page, 'selectedProjectionIndex', projection, ['#myPlot']);
  }
}

/** How each contour mode reads in the Contours menu. */
const CONTOUR_MENU_LABELS = { off: 'Off', auto: 'Auto', on: 'Always' } as const;

/** Sets the contour mode through the view bar's Contours menu and waits until the plot shows it. */
export async function setContours(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await waitForExploreInteractionReady(page);
  await viewBar(page).getByRole('button', { name: /^Contours/ }).click();
  await page
    .locator('protspace-contours-menu')
    .getByRole('menuitemradio', { name: new RegExp(`^${CONTOUR_MENU_LABELS[mode]}`) })
    .click();
  await page.waitForFunction(
    (expected) =>
      (
        document.querySelector('#myPlot') as
          | (Element & { config?: { densityLayer?: string } })
          | null
      )?.config?.densityLayer === expected,
    mode,
    { timeout: 10_000 },
  );
}

/** The annotations Color by offers, by column name. */
export async function getColorByOptions(page: Page): Promise<string[]> {
  return annotationSelect(page).evaluate((select) => [
    ...((select as Element & { annotations?: string[] }).annotations ?? []),
  ]);
}
```

Create `apps/web/tests/workbench-view-bar.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  appBar,
  expectUrlParam,
  getColorByOptions,
  getViewState,
  openExplore,
  projectionTrigger,
  selectAnnotation,
  selectProjection,
  setContours,
  viewBar,
} from './helpers/explore';

test.describe('the view bar', () => {
  test('Projection, Color by and Contours sit in the view bar', async ({ page }) => {
    await openExplore(page);

    await expect(projectionTrigger(page)).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Color by/ })).toBeVisible();
    await expect(viewBar(page).getByRole('button', { name: /^Contours/ })).toBeVisible();
    // Projection, its details and Color by form the tour's projections group.
    const group = page.locator('[data-workbench="view-bar"] [data-driver-id="projections"]');
    await expect(group.locator('protspace-projection-select')).toHaveCount(1);
    await expect(group.locator('protspace-projection-metadata')).toHaveCount(1);
    await expect(group.locator('protspace-annotation-select')).toHaveCount(1);
    // The plot's top-left corner no longer holds the projection details.
    await expect(page.locator('#myPlot protspace-projection-metadata')).toHaveCount(0);
  });

  test('picking a projection, an annotation and a contour mode updates the plot, the legend and the URL', async ({
    page,
  }) => {
    await openExplore(page);
    const projections = await page
      .locator('#myPlot')
      .evaluate(
        (plot) =>
          (plot as Element & { data?: { projections?: { name: string }[] } }).data?.projections?.map(
            (projection) => projection.name,
          ) ?? [],
      );
    expect(projections.length).toBeGreaterThan(1);

    await selectProjection(page, 1);
    await expect.poll(async () => (await getViewState(page)).projection).toBe(projections[1]);
    await expect(projectionTrigger(page)).toHaveAccessibleName(`Projection ${projections[1]}`);
    await expectUrlParam(page, 'projection', projections[1]);

    const current = (await getViewState(page)).annotation;
    const next = (await getColorByOptions(page)).find((name) => name !== current);
    expect(next).toBeDefined();
    await selectAnnotation(page, next!);
    await expect.poll(async () => (await getViewState(page)).annotation).toBe(next);
    await expect
      .poll(() =>
        page
          .locator('protspace-legend')
          .evaluate((legend) => (legend as Element & { selectedAnnotation?: string }).selectedAnnotation),
      )
      .toBe(next);
    await expectUrlParam(page, 'annotation', next!);

    await setContours(page, 'auto');
    await expect(viewBar(page).getByRole('button', { name: /^Contours/ })).toHaveAccessibleName(
      'Contours Auto',
    );
    await expectUrlParam(page, 'density', 'auto');
  });

  test('the projection details open below the view bar, fully visible and topmost', async ({
    page,
  }) => {
    await openExplore(page);
    // Give the details something to show whatever the fixture's projection metadata holds.
    await page.locator('#myProjectionMetadata').evaluate((details) => {
      (details as Element & { projection: unknown }).projection = {
        name: 'Fixture projection',
        metadata: { n_neighbors: 15, min_dist: 0.1, metric: 'cosine' },
      };
    });

    await viewBar(page).getByRole('button', { name: 'View projection metadata' }).click();
    const card = page.locator('#myProjectionMetadata .content');
    await expect(card).toBeVisible();

    const trigger = (await viewBar(page)
      .getByRole('button', { name: 'View projection metadata' })
      .boundingBox())!;
    const box = (await card.boundingBox())!;
    const viewport = page.viewportSize()!;
    // The card hangs below its trigger in the view bar, over the plot area. (The bar itself is
    // taller than 44 px until Task 2.10 removes the control bar's padding.)
    expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // Nothing covers the card: the topmost element at its centre is the details' own host.
    const topmost = await page.evaluate(
      ({ x, y }) => {
        const host = document.getElementById('myProjectionMetadata');
        const hit = document.elementFromPoint(x, y);
        return !!host && !!hit && (hit === host || host.contains(hit));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(topmost).toBe(true);
  });

  test("the tour's projections step highlights the view bar group", async ({ page }) => {
    await openExplore(page);
    await appBar(page).getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    const title = page.locator('.driver-popover .driver-popover-title');
    await expect(title).toHaveText('Welcome to ProtSpace');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import Your Data');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Projections & Annotations');

    await expect(
      page.locator('[data-workbench="view-bar"] [data-driver-id="projections"]'),
    ).toHaveClass(/driver-active-element/);
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-view-bar.spec.ts` (sandbox disabled)
Expected: PASS, 4 tests. (Before Steps 13 and 14 the first test fails: there is no projection select in the view bar.)

- [ ] **Step 15: Run the suites this task touches**

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS, as in Step 8.

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; `view-bar-controller.test.ts` (11) added, `control-bar-events.test.ts` now 1 test.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-view-bar.spec.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/workbench-filter.spec.ts apps/web/tests/url-view-state.spec.ts apps/web/tests/multi-annotation-tooltip.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/density-layer.spec.ts apps/web/tests/product-tour.spec.ts apps/web/tests/numeric-binning.spec.ts apps/web/tests/legend-double-click.spec.ts` (sandbox disabled)
Expected: PASS. `url-view-state.spec.ts`'s deep-link test sees the requested annotation and projection as the first values assigned to the pickers (`showInitialView` sets them right after the plot takes the data; `data-change` keeps a valid choice).

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (sandbox disabled)
Expected: PASS, the whole Chromium suite.

Run: `pnpm perf:counts` (sandbox disabled)
Expected: PASS within budget; `annotation-switch` and `projection-switch` keep their counts: the plot is written before the legend re-syncs, and the app's provenance clearing still runs after the legend's listener.

Run: `pnpm --filter @protspace/app build`
Expected: the build succeeds.

- [ ] **Step 16: Commit**

Run: `pnpm exec prettier --check packages/core/src/components/control-bar packages/core/src/components/kit/icon.ts packages/core/src/components/scatter-plot packages/core/src/components/legend packages/core/src/utils/dropdown-helpers.ts packages/core/src/index.ts apps/web/src apps/web/tests/helpers/explore.ts apps/web/tests/workbench-view-bar.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not, then re-check).

```bash
git add packages/core/src/components/control-bar/annotation-select.ts \
  packages/core/src/components/control-bar/annotation-select.styles.ts \
  packages/core/src/components/control-bar/annotation-select.component.test.ts \
  packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar.events.ts \
  packages/core/src/components/control-bar/control-bar.after-paint.test.ts \
  packages/core/src/components/control-bar/control-bar.density-layer.test.ts \
  packages/core/src/components/control-bar/styles/layout.ts \
  packages/core/src/components/kit/icon.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.component.test.ts \
  packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts \
  packages/core/src/components/legend/controllers/scatterplot-sync-controller.test.ts \
  packages/core/src/components/legend/test-support/legend-scatterplot-harness.ts \
  packages/core/src/components/legend/legend.score-strips.test.ts \
  packages/core/src/utils/dropdown-helpers.ts packages/core/src/index.ts \
  apps/web/src/explore/view-bar-controller.ts apps/web/src/explore/view-bar-controller.test.ts \
  apps/web/src/explore/view-controller.ts apps/web/src/explore/view-controller.test.ts \
  apps/web/src/explore/filter-controller.ts apps/web/src/explore/example-datasets.test.ts \
  apps/web/src/explore/control-bar-events.ts apps/web/src/explore/control-bar-events.test.ts \
  apps/web/src/explore/runtime.ts apps/web/src/explore/elements.ts \
  apps/web/src/workbench/ViewBar.tsx apps/web/src/workbench/workbench.css \
  apps/web/src/custom-elements.d.ts apps/web/src/tour/product-tour.ts \
  apps/web/tests/helpers/explore.ts apps/web/tests/workbench-view-bar.spec.ts
git commit -m "feat(web): put the view-bar pickers in the view bar"
```

(`git commit` needs the sandbox disabled; the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.9: Plot tools, the selection controller and search in the app bar

The plot gets its tool strip (decision 1): `protspace-plot-tools` in the plot's top-left corner with Move and zoom, Box select, Lasso select and Fit to view, and, until 4.2's selection bar, Clear, Isolate and Reset beside it when they apply. Search moves to the centre of the app bar. The selection logic the control bar coordinated (clicks, brushes, search picks, isolation, the selection-disabled warning and the Escape order) moves unchanged into `apps/web/src/explore/selection-controller.ts`, leaving the control bar empty. The app bar now fits from 951 px.

**Files:**

- Create: `packages/core/src/components/plot-tools/plot-tools.ts`, `plot-tools.styles.ts`, `plot-tools.browser.test.ts`
- Modify: `packages/core/src/components/kit/button.ts`, `button.browser.test.ts`, `icon.ts` (`mouse-pointer`, `square-dashed`, `lasso`, `maximize`)
- Modify: `packages/core/src/components/control-bar/search.ts` (the `close-search` listener :146 and :152, the `search-opened` dispatch near :282, the suggestion list's open and close; the ⌘K listener stays), `search.component.test.ts`, `search.test.ts` (unchanged: it covers the pure id helpers)
- Modify: `packages/core/src/components/control-bar/control-bar.ts` (all remaining selection, search, auto-sync and document listeners; it renders nothing), `control-bar-helpers.ts` (+ test; selection helpers out), `packages/core/src/index.ts`
- Delete: `packages/core/src/components/control-bar/control-bar.after-paint.test.ts` (its remaining cases :243-338 ported) and `control-bar.events.test.ts` (ported)
- Create: `apps/web/src/explore/selection-controller.ts`, `selection-controller.test.ts`
- Modify: `apps/web/src/explore/runtime.ts` (:312-317 and the `ExploreControls` object), `elements.ts`, `interaction-controller.ts` (:86-95), `interaction-controller.test.ts`, `interaction-controller.eat.test.ts` (unchanged: it never calls `handleSelectionChange`), `notifications.ts` (:233-245), `notifications.test.ts`
- Delete: `apps/web/src/explore/control-bar-events.ts`, `control-bar-events.test.ts`
- Modify: `apps/web/src/workbench/PlotArea.tsx`, `AppBar.tsx`, `workbench.css`, `shortcuts.ts` (+ test), `apps/web/src/custom-elements.d.ts`, `apps/web/src/tour/product-tour.ts` (steps 4 and 5)
- Modify: `apps/web/tests/helpers/explore.ts` (`chooseTool`, `selectionAction`, `clearSelection`, `isolateSelection`, `resetIsolation`), `apps/web/tests/dataset-reload.spec.ts` (:595)
- Create: `apps/web/tests/workbench-selection.spec.ts`
- Also modified (needed by this task; see Steps 12 and 13):
  - `packages/core/src/components/control-bar/search.styles.ts`: the search's row takes one control height (32 px) to sit in the 48 px app bar; 4.5 restyles the rest on the kit.
  - `packages/core/src/components/control-bar/control-bar.events.ts`: `createSelectionDisabledNotificationDetail` loses its last caller and goes (knip); the two exported types stay until 2.10.
  - `packages/core/src/components/control-bar/types.ts`: `DataChangeDetail`, `ScatterplotElementLike` and `StructureViewerElement` lose their last consumer (the control bar) and go now (knip), so 2.10's `types.ts` edit has nothing left to do.
  - Delete `packages/core/src/components/control-bar/control-bar.auto-sync.test.ts` here rather than in 2.10: the polling it pins leaves the control bar in this task.

**Interfaces:**

- Consumes: plot events `protein-click` (`ProteinClickDetail`), `brush-selection` (`BrushSelectionDetail`), `data-change`, `data-isolation`, `data-isolation-reset`, `auto-disable-selection` `{ reason, dataSize }`; plot `selectedProteinIds`, `selectionMode`, `selectionTool`, `isolateSelection()`, `resetIsolation()`, `resetZoom()`, `hasExpandedDuplicateStack()`, `closeExpandedDuplicateStack()`; search events `selection-change` `{ proteinIds }`, `add-selection` `{ proteinId }`, `add-selection-multiple` `{ proteinIds }`, `remove-selection` `{ proteinId }`; `AfterPaintCommit`; `pushLayer`, `topLayer`; `ps-icon-button` (`label`, `pressed`, `size`, `disabled`), `ps-button`, `ps-tooltip` (`placement`, `show()`), `type Placement` (`kit/position.ts`); `ExploreControls` (2.5); `notify` (`apps/web/src/lib/notify.ts`, `NotifyOptions`); the Task 2.3 helpers `appBar`, `plotArea`, `searchInput`, `getSelectedProteinIds`, `importTrigger`, `openExplore`, `waitForExploreInteractionReady`; Task 2.4's `shortcuts.ts` Escape entry.
- Produces (core):
  - `PsIconButton.tooltipPlacement: Placement` (attribute `tooltip-placement`, default `'top'`), passed to its tooltip.
  - `<protspace-plot-tools id="myPlotTools" data-driver-id="selection">`, class `ProtspacePlotTools`, `export type PlotTool = 'pan' | 'rectangle' | 'lasso'`: `tool: PlotTool`; `selectionDisabled` (`selection-disabled`); `selectedCount` (`selected-count`); `isolated`. A vertical `role="toolbar"` named "Plot tools" with `ps-icon-button`s "Move and zoom", "Box select" and "Lasso select" (`pressed` marks the current tool; tooltips to the right; ArrowUp and ArrowDown move between them) and, after a separator, "Fit to view"; a `role="group"` named "Selection" with `ps-button`s "Clear" and "Isolate" (only while `selectedCount > 0`) and "Reset" (only while `isolated`). Events (bubbles, composed): `plot-tool-change` `{ tool: PlotTool }`, `fit-view` `{}`, `clear-selections` `{}`, `isolate-data` `{}`, `reset-isolation` `{}`. With `selectionDisabled`, Box and Lasso are disabled and their label (the tooltip) says why: "Box select (needs at least 2 points)".
  - `protspace-protein-search`: now an exported class; its open suggestion list is a layer (Escape resets the search as before; a press outside blurs the input, which closes the list after 200 ms and keeps the query, as before); with nothing open and no query, Escape passes on to the page; `search-opened` and `close-search` are gone; its API is otherwise unchanged.
  - The core index exports `ProtspacePlotTools`, `type PlotTool`, `ProtspaceProteinSearch`, `AfterPaintCommit`, `type ProteinClickDetail`, `type BrushSelectionDetail`.
  - The control bar renders nothing and keeps no state; it stays mounted until 2.10.
- Produces (app):
  - `selection-controller.ts`: `toggleProteinSelection` and `mergeProteinSelections` (moved from core with their tests); `createSelectionController(options: { plotElement: ProtspaceScatterplot; plotTools: ProtspacePlotTools; proteinSearch: ProtspaceProteinSearch; interactionController: Pick<InteractionController, 'handleSelectionChange'>; root: Pick<Document, 'addEventListener' | 'removeEventListener'>; warn(options: NotifyOptions): void }): SelectionController`; `interface SelectionController { resetForNewDataset(): void; dispose(): void }`. One commit point sets `plotElement.selectedProteinIds`, `proteinSearch.selectedProteinIds` and `plotTools.selectedCount`, then calls `interactionController.handleSelectionChange(ids)`; search picks commit after the paint; Isolate flushes a waiting commit first; `fit-view` calls `plotElement.resetZoom()`; `plot-tool-change` sets `selectionMode` and `selectionTool`; `auto-disable-selection` returns the tool to `pan`, sets `selectionDisabled` for insufficient data and warns with `getSelectionDisabledNotification({ reason, dataSize })`; `data-isolation-reset` re-enables the tools. Escape (a `keydown` listener on `root`, bubble phase): ignored when the composed path holds an `aria-modal="true"` element; otherwise it closes an expanded duplicate stack, else clears a non-empty selection (after the paint, as Clear), else returns the tool to `pan`; a handled press calls `preventDefault` and `stopPropagation`. `resetForNewDataset` drops a waiting pick, empties the shown selection and returns the tool strip to Move (the plot's own mode is reset with its data).
  - `InteractionController.handleSelectionChange(proteinIds: readonly string[]): void` (it was an event handler); it still loads the last protein into the viewer.
  - `notifications.ts`: `getSelectionDisabledNotification(context: { reason: string; dataSize: number }): NotifyOptions`, with the message text moved from core.
  - `ExploreControls.resetForNewDataset` also calls `selectionController.resetForNewDataset()` (and no longer calls the control bar); `showInitialView` no longer touches the control bar; `setRendering` does nothing until 2.10 removes it.
  - `elements.ts`: `plotTools` (`#myPlotTools`) and `proteinSearch` (`#myProteinSearch`).
  - App bar: three groups in a `1fr minmax(200px, 420px) 1fr` grid: `[data-workbench="app-bar-start"]` (the home link and the dataset), `[data-workbench="app-bar-center"]` holding `protspace-protein-search#myProteinSearch[data-driver-id="search"]` (centred, `minmax(200px, 420px)` wide, 32 px tall; ⌘K and Ctrl+K focus it as today), and `[data-workbench="app-bar-actions"]`.
  - Plot area: `#myPlotTools` at 12 px from the top and left over `#myPlot`; it never changes the plot's box.
  - The app bar fits from 951 px with media queries only: the dataset name truncates at 200 px (full name in a `ps-tooltip`); below 1100 px Import and Export hide `::part(trigger-label)` and keep their names; below 1024 px the protein count hides.
  - Tour steps 4 and 5 target the light-DOM `[data-driver-id="search"]` and `[data-driver-id="selection"]`; the `CONTROL_BAR` selector goes with its last step.
  - `shortcuts.ts`: Escape reads "clear the selection, then return to Move and zoom".
  - Helpers `chooseTool`, `selectionAction`, `clearSelection`, `isolateSelection` and `resetIsolation` target the plot tools.

**Tests:**

- `plot-tools.browser.test.ts`: "names Move and zoom, Box select, Lasso select and Fit to view, and presses the current tool"; "choosing a tool dispatches plot-tool-change"; "Fit to view dispatches fit-view"; "Clear and Isolate show only with a selection, Reset only when isolated"; "with selection disabled, Box and Lasso are disabled"; "tooltips open to the right"; "arrow keys move between the tools".
- `button.browser.test.ts`: "tooltip-placement sets the tooltip's side".
- Search: "the open suggestion list closes on Escape before anything else and on a press outside"; "Escape with nothing to close passes on to the page"; "no search-opened event is dispatched".
- `selection-controller.test.ts` (unit, node, fakes; the ported after-paint and events cases and the two helpers' tests), plus: "a plain click selects one protein and a second click on the only one deselects it"; "a ⌘- or Ctrl-click, or any selection tool, toggles"; "a protein-click without modifierKeys reads as a plain click"; "a brush merges under a selection tool and replaces otherwise"; "search adds and removes commit after the paint"; "a selection committed at once drops a waiting search pick"; "Clear empties the selection"; "Isolate lands a waiting search pick first"; "Reset resets isolation"; "data-isolation clears the selection"; "auto-disable-selection returns to Move, disables the tools with one point left and warns"; "Escape closes the duplicate stack, then clears, then returns to Move, and ignores presses inside a modal"; "Fit to view resets the zoom"; "a tool change sets the plot's mode and tool"; "data-change hands the search the dataset's ids and the plot's selection"; "a new dataset drops waiting picks and returns to Move"; "dispose stops listening".
- `interaction-controller.test.ts`: "a selection loads its last protein".
- `notifications.test.ts`: the new signature and message.
- `apps/web/tests/workbench-selection.spec.ts` (e2e): "the tool strip sits in the plot's top-left with its tools named"; "Box select selects by dragging; Escape clears, then returns to Move"; "Escape in the search box closes open suggestions and keeps the selection; the next Escape clears it" (Review Focus 4); "Clear, Isolate and Reset appear when they apply"; "search sits in the app bar and Ctrl+K focuses it"; "the app bar keeps one row without overflow at 951, 1024 and 1280 px".
- `dataset-reload.spec.ts` :595 dispatches `auto-disable-selection` on `#myPlot`; `workbench-helpers.spec.ts`, `eat-visualization.spec.ts`, `brush-selection.spec.ts` and `pnpm perf:counts` (search-select reset) stay green.

Before you start, record the baseline counts from the phase 2 ledger. Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. After Task 2.8 the control bar holds only search and selection; Step 13 replaces its file.

- [ ] **Step 1: Write the failing tooltip-placement test**

Append to `packages/core/src/components/kit/button.browser.test.ts` (it already imports `PsIconButton` and `PsTooltip` as types and `./button`):

```ts
describe('ps-icon-button tooltip placement', () => {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  it("tooltip-placement sets the tooltip's side", async () => {
    document.body.innerHTML =
      '<ps-icon-button icon="x" label="Close" tooltip-placement="right" style="position: fixed; left: 40px; top: 40px"></ps-icon-button>';
    const el = document.body.firstElementChild as PsIconButton;
    await el.updateComplete;
    const tooltip = el.shadowRoot!.querySelector('ps-tooltip') as PsTooltip;
    await tooltip.updateComplete;
    expect(tooltip.placement).toBe('right');

    tooltip.show();
    await nextFrame();
    await nextFrame();

    const tip = tooltip.shadowRoot!.querySelector('.tip')!.getBoundingClientRect();
    const button = el.shadowRoot!.querySelector('button')!.getBoundingClientRect();
    expect(tip.left).toBeGreaterThanOrEqual(button.right);
    tooltip.hide();
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/button.browser.test.ts` (sandbox disabled)
Expected: FAIL: `expected 'top' to be 'right'`.

- [ ] **Step 2: Add `tooltip-placement` to ps-icon-button**

In `packages/core/src/components/kit/button.ts`, add `import type { Placement } from './position';` to the imports, and in `PsIconButton`, after `@property({ type: Boolean }) pressed?: boolean;`, add:

```ts
  /** Where the label tooltip opens: right of the plot's tool strip, left of the sidebar rail. */
  @property({ attribute: 'tooltip-placement' }) tooltipPlacement: Placement = 'top';
```

and in its `render()`, give the tooltip the placement:

```ts
      )} <ps-tooltip
        text=${this.label}
        placement=${this.tooltipPlacement}
        names-target
      ></ps-tooltip>`;
```

(keeping every attribute the tooltip already has).

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/button.browser.test.ts` (sandbox disabled)
Expected: PASS, every button test.

- [ ] **Step 3: Add the tool icons**

In `packages/core/src/components/kit/icon.ts`, add `Lasso`, `Maximize`, `MousePointer` and `SquareDashed` to the `lucide` import and these keys to `ICONS`:

```ts
  lasso: Lasso,
  maximize: Maximize,
  'mouse-pointer': MousePointer,
  'square-dashed': SquareDashed,
```

- [ ] **Step 4: Write the failing plot-tools tests**

Create `packages/core/src/components/plot-tools/plot-tools.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsIconButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { PsTooltip } from '../kit/tooltip';
import type { ProtspacePlotTools } from './plot-tools';
import './plot-tools';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(): Promise<ProtspacePlotTools> {
  const el = document.createElement('protspace-plot-tools');
  el.style.cssText = 'position: fixed; left: 12px; top: 12px';
  document.body.append(el);
  await el.updateComplete;
  return el;
}
/** The kit button whose label starts with `label`. */
const tool = (el: ProtspacePlotTools, label: string) =>
  [...el.shadowRoot!.querySelectorAll<PsIconButton>('ps-icon-button')].find((button) =>
    button.label.startsWith(label),
  )!;
const inner = (button: Element) => button.shadowRoot!.querySelector('button')!;
const textButtons = (el: ProtspacePlotTools) =>
  [...el.shadowRoot!.querySelectorAll('.selection ps-button')].map((b) => b.textContent!.trim());

describe('protspace-plot-tools', () => {
  it('names Move and zoom, Box select, Lasso select and Fit to view, and presses the current tool', async () => {
    const el = await mount();
    await expect.element(page.getByRole('toolbar', { name: 'Plot tools' })).toBeInTheDocument();
    for (const name of ['Move and zoom', 'Box select', 'Lasso select', 'Fit to view']) {
      await expect
        .element(page.getByRole('button', { name, exact: true }))
        .toBeInTheDocument();
    }
    expect(inner(tool(el, 'Move and zoom')).getAttribute('aria-pressed')).toBe('true');
    expect(inner(tool(el, 'Box select')).getAttribute('aria-pressed')).toBe('false');
    // Fit to view is an action, not a toggle.
    expect(inner(tool(el, 'Fit to view')).hasAttribute('aria-pressed')).toBe(false);

    el.tool = 'lasso';
    await el.updateComplete;
    await tool(el, 'Lasso select').updateComplete;
    expect(inner(tool(el, 'Lasso select')).getAttribute('aria-pressed')).toBe('true');
    expect(inner(tool(el, 'Move and zoom')).getAttribute('aria-pressed')).toBe('false');
  });

  it('choosing a tool dispatches plot-tool-change', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('plot-tool-change', onChange);

    inner(tool(el, 'Box select')).click();

    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ tool: 'rectangle' });
    expect(el.tool).toBe('rectangle');
  });

  it('Fit to view dispatches fit-view', async () => {
    const el = await mount();
    const onFit = vi.fn();
    el.addEventListener('fit-view', onFit);

    inner(tool(el, 'Fit to view')).click();

    expect(onFit).toHaveBeenCalledOnce();
  });

  it('Clear and Isolate show only with a selection, Reset only when isolated', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('[role="group"]')).toBeNull();

    el.selectedCount = 2;
    await el.updateComplete;
    await expect.element(page.getByRole('group', { name: 'Selection' })).toBeInTheDocument();
    expect(textButtons(el)).toEqual(['Clear', 'Isolate']);

    const onClear = vi.fn();
    const onIsolate = vi.fn();
    el.addEventListener('clear-selections', onClear);
    el.addEventListener('isolate-data', onIsolate);
    inner(el.shadowRoot!.querySelectorAll('.selection ps-button')[0]).click();
    inner(el.shadowRoot!.querySelectorAll('.selection ps-button')[1]).click();
    expect(onClear).toHaveBeenCalledOnce();
    expect(onIsolate).toHaveBeenCalledOnce();

    el.selectedCount = 0;
    el.isolated = true;
    await el.updateComplete;
    expect(textButtons(el)).toEqual(['Reset']);
    const onReset = vi.fn();
    el.addEventListener('reset-isolation', onReset);
    inner(el.shadowRoot!.querySelector('.selection ps-button')!).click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('with selection disabled, Box and Lasso are disabled', async () => {
    const el = await mount();
    el.selectionDisabled = true;
    await el.updateComplete;

    expect(tool(el, 'Box select').disabled).toBe(true);
    expect(tool(el, 'Lasso select').disabled).toBe(true);
    expect(tool(el, 'Move and zoom').disabled).toBe(false);
    // The label is the tooltip: it says why.
    expect(tool(el, 'Box select').label).toBe('Box select (needs at least 2 points)');
  });

  it('tooltips open to the right', async () => {
    const el = await mount();
    const move = tool(el, 'Move and zoom');
    const tooltip = move.shadowRoot!.querySelector('ps-tooltip') as PsTooltip;
    await tooltip.updateComplete;

    tooltip.show();
    await frame();
    await frame();

    const tip = tooltip.shadowRoot!.querySelector('.tip')!.getBoundingClientRect();
    expect(tip.left).toBeGreaterThanOrEqual(inner(move).getBoundingClientRect().right);
    tooltip.hide();
  });

  it('arrow keys move between the tools', async () => {
    const el = await mount();
    inner(tool(el, 'Move and zoom')).focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(deepActiveElement()).toBe(inner(tool(el, 'Box select')));
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    expect(deepActiveElement()).toBe(inner(tool(el, 'Fit to view')));
  });
});
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/plot-tools.browser.test.ts` (sandbox disabled)
Expected: FAIL: `Failed to resolve import "./plot-tools"`.

- [ ] **Step 5: Write the plot tools**

Create `packages/core/src/components/plot-tools/plot-tools.styles.ts`:

```ts
import { css } from 'lit';
import { kitHost } from '../kit/kit-shared.styles';

/** A raised strip over the plot, and the selection's actions beside it. */
export const plotToolsStyles = [
  kitHost,
  css`
    :host {
      display: flex;
      align-items: flex-start;
      gap: var(--ps-space-2);
    }
    .tools,
    .selection {
      display: flex;
      padding: var(--ps-space-1);
      border: 1px solid var(--ps-border);
      border-radius: var(--ps-radius-lg);
      background: var(--ps-surface-raised);
      box-shadow: var(--ps-shadow-sm);
    }
    .tools {
      flex-direction: column;
      gap: var(--ps-space-0-5);
    }
    .selection {
      align-items: center;
      gap: var(--ps-space-1);
    }
    .separator {
      height: 1px;
      margin: var(--ps-space-0-5) var(--ps-space-1);
      background: var(--ps-border);
    }
  `,
];
```

Create `packages/core/src/components/plot-tools/plot-tools.ts`:

```ts
import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import '../kit/button';
import type { PsIconButton } from '../kit/button';
import type { IconName } from '../kit/icon';
import { plotToolsStyles } from './plot-tools.styles';

/** What a press on the plot does: move and zoom, or select with a box or a lasso. */
export type PlotTool = 'pan' | 'rectangle' | 'lasso';

const TOOLS: ReadonlyArray<{ tool: PlotTool; icon: IconName; label: string }> = [
  { tool: 'pan', icon: 'mouse-pointer', label: 'Move and zoom' },
  { tool: 'rectangle', icon: 'square-dashed', label: 'Box select' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso select' },
];

/**
 * The plot's tool strip (design decision 1): a vertical toolbar for the plot's top-left corner,
 * and beside it, while they apply, Clear and Isolate (with a selection) and Reset (while
 * isolated). It reports choices; the host's selection controller sets the plot and these
 * properties.
 *
 * @fires plot-tool-change - `{ tool: PlotTool }`
 * @fires fit-view - `{}`
 * @fires clear-selections - `{}`
 * @fires isolate-data - `{}`
 * @fires reset-isolation - `{}`
 */
@customElement('protspace-plot-tools')
export class ProtspacePlotTools extends LitElement {
  static styles = plotToolsStyles;

  @property() tool: PlotTool = 'pan';
  /** Box and Lasso are off: the view holds too few points to select from. */
  @property({ type: Boolean, attribute: 'selection-disabled' }) selectionDisabled = false;
  @property({ type: Number, attribute: 'selected-count' }) selectedCount = 0;
  @property({ type: Boolean }) isolated = false;

  render() {
    return html`
      <div
        class="tools"
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Plot tools"
        @keydown=${this.onToolbarKeydown}
      >
        ${TOOLS.map(({ tool, icon, label }) => {
          const unavailable = tool !== 'pan' && this.selectionDisabled;
          return html`<ps-icon-button
            size="sm"
            icon=${icon}
            label=${unavailable ? `${label} (needs at least 2 points)` : label}
            tooltip-placement="right"
            .pressed=${this.tool === tool}
            ?disabled=${unavailable}
            @click=${() => this.choose(tool)}
          ></ps-icon-button>`;
        })}
        <div class="separator" role="separator"></div>
        <ps-icon-button
          size="sm"
          icon="maximize"
          label="Fit to view"
          tooltip-placement="right"
          @click=${() => this.emit('fit-view')}
        ></ps-icon-button>
      </div>
      ${this.selectedCount > 0 || this.isolated
        ? html`<div class="selection" role="group" aria-label="Selection">
            ${this.selectedCount > 0
              ? html`<ps-button size="sm" variant="ghost" @click=${() => this.emit('clear-selections')}
                    >Clear</ps-button
                  ><ps-button size="sm" variant="ghost" @click=${() => this.emit('isolate-data')}
                    >Isolate</ps-button
                  >`
              : nothing}
            ${this.isolated
              ? html`<ps-button size="sm" variant="ghost" @click=${() => this.emit('reset-isolation')}
                  >Reset</ps-button
                >`
              : nothing}
          </div>`
        : nothing}
    `;
  }

  private choose(tool: PlotTool): void {
    this.tool = tool;
    this.emit('plot-tool-change', { tool });
  }

  private emit(type: string, detail: object = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** The vertical toolbar pattern: ArrowUp and ArrowDown move between the enabled tools. */
  private onToolbarKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [
      ...this.renderRoot.querySelectorAll<PsIconButton>('.tools ps-icon-button'),
    ].filter((button) => !button.disabled);
    const current = buttons.indexOf(this.shadowRoot!.activeElement as PsIconButton);
    if (current === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : buttons.length - 1;
    buttons[(current + step) % buttons.length].focus();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-plot-tools': ProtspacePlotTools;
  }
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project browser src/components/plot-tools/plot-tools.browser.test.ts` (sandbox disabled)
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the failing search tests**

Append to `packages/core/src/components/control-bar/search.component.test.ts` (the file's `setupSearch`, `inputOf`, `typeQuery`, `rowsOf` and `FIVE` are in scope):

```ts
describe('protspace-protein-search and the layer stack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('the open suggestion list closes on Escape before anything else and on a press outside', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const element = await setupSearch(FIVE, []);
    await typeQuery(element, 'P0059');
    expect(rowsOf(element).length).toBeGreaterThan(0);

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
    expect(inputOf(element).value).toBe('');
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);

    // A press outside blurs the input: the list closes 200 ms later and keeps the query.
    await typeQuery(element, 'P0059');
    expect(rowsOf(element).length).toBeGreaterThan(0);
    inputOf(element).dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(200);
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
    expect(inputOf(element).value).toBe('P0059');
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });

  it('Escape with nothing to close passes on to the page', async () => {
    const element = await setupSearch(FIVE, ['P00595']);
    const pageEscape = vi.fn();
    document.addEventListener('keydown', pageEscape);

    inputOf(element).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    // The page's selection controller hears it and clears the selection.
    expect(pageEscape).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', pageEscape);
  });

  it('no search-opened event is dispatched', async () => {
    const element = await setupSearch();
    const opened = vi.fn();
    element.addEventListener('search-opened', opened);

    inputOf(element).focus();
    await element.updateComplete;

    expect(opened).not.toHaveBeenCalled();
  });
});
```

and add to the file's imports:

```ts
import { pushLayer, topLayer } from '../kit/layers';
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/search.component.test.ts`
Expected: FAIL, 3 tests: the list is no layer (Escape closes the fake dialog and leaves the list), Escape always stops at the input (`handleDropdownEscape`), and focusing dispatches `search-opened`.

- [ ] **Step 7: Make the suggestion list a layer**

In `packages/core/src/components/control-bar/search.ts`:

1. Add `import { pushLayer } from '../kit/layers';` after the `dropdown-helpers` import.
2. Replace `class ProtspaceProteinSearch extends LitElement {` with `export class ProtspaceProteinSearch extends LitElement {`.
3. After `private _blurTimeoutId: ReturnType<typeof setTimeout> | null = null;`, add:

```ts
  /** Releases the suggestion list's layer; set while the list is on screen. */
  private _releaseLayer?: () => void;
```

4. Replace `connectedCallback` and `disconnectedCallback` (:140-155) and delete `_handleCloseSearch` (:157-165):

```ts
  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this._handleBodyKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._handleBodyKeydown);
    this._clearSuggestionDebounce();
    this._clearBlurTimeout();
    this._releaseLayer?.();
    this._releaseLayer = undefined;
  }
```

5. In `updated`, call the layer sync first, before the early return:

```ts
  protected updated(changed: Map<string, unknown>): void {
    this._syncLayer();
    // `.search-suggestions` is a fixed-height (max-height: 20rem) scroll container fitting
    // ~8 rows, so past that arrow-key navigation would run off screen (issue #413).
    if (!changed.has('highlightedSuggestionIndex')) return;
    if (this.highlightedSuggestionIndex < 0) return;
    scrollHighlightedIntoView(this.shadowRoot, '.search-suggestion.active');
  }

  /**
   * While the suggestions show they are a layer, so Escape resets the search before the page
   * clears the selection (Review Focus 4). A press outside blurs the input, which closes the
   * list and keeps the query, as before; the layer leaves outside presses to that.
   */
  private _syncLayer(): void {
    const open = this._isPopupRendered;
    if (open && !this._releaseLayer) {
      this._releaseLayer = pushLayer({
        close: () => this._resetSearch(),
        elements: [this],
        dismissOnOutsidePress: false,
      });
    } else if (!open && this._releaseLayer) {
      this._releaseLayer();
      this._releaseLayer = undefined;
    }
  }
```

6. In `_onSearchKeydown`, replace the Escape branch

```ts
    } else if (event.key === 'Escape') {
      handleDropdownEscape(event, () => this._resetSearch());
    }
```

with

```ts
    } else if (event.key === 'Escape' && (this.searchQuery || this._isPopupRendered)) {
      // The layer normally takes Escape first; this covers a typed query whose list has not
      // opened yet. With nothing to close, Escape passes on to clear the selection.
      handleDropdownEscape(event, () => this._resetSearch());
    }
```

7. In `_onInputFocus`, delete the `search-opened` dispatch and its comment:

```ts
    // Notify parent to close other dropdowns
    this.dispatchEvent(
      new CustomEvent('search-opened', {
        bubbles: true,
        composed: true,
      }),
    );
```

In `packages/core/src/components/control-bar/search.styles.ts`, append to the end of the `css` block (after `.no-results`):

```css
    /* One control height, so the search sits in the 48 px app bar (Task 2.9); 4.5 restyles
       the search on the kit. */
    .search-chips {
      box-sizing: border-box;
      height: var(--ps-control-md);
      padding-block: 0;
    }
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/control-bar/search.component.test.ts src/components/control-bar/search.test.ts`
Expected: PASS, every test in both files (the existing Escape cases still type a query first, so the input's own handler resets them as before).

- [ ] **Step 8: Write the failing selection-controller test**

Create `apps/web/src/explore/selection-controller.test.ts`:

```ts
/**
 * The selection the control bar coordinated, moved into the app (design decision 9). Ported
 * from `control-bar.after-paint.test.ts` (search box, Clear, Isolate, new dataset),
 * `control-bar.events.test.ts` and the helpers' tests in `control-bar-helpers.test.ts`.
 */
import type {
  ProtspacePlotTools,
  ProtspaceProteinSearch,
  ProtspaceScatterplot,
} from '@protspace/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSelectionController,
  mergeProteinSelections,
  toggleProteinSelection,
} from './selection-controller';

// Lit cannot load in node: AfterPaintCommit is plain TS, read from core's source.
vi.mock('@protspace/core', async () => {
  const { AfterPaintCommit } = await import(
    '../../../../packages/core/src/utils/after-paint-commit'
  );
  return { AfterPaintCommit };
});

/** In node there is no requestAnimationFrame: a commit "after the paint" is a 0 ms timer. */
const afterPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));
/** An Escape keydown with a given composed path, as the document would hear it. */
function escape(root: EventTarget, path: unknown[] = []): Event {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key: 'Escape',
    composedPath: () => path,
  });
  root.dispatchEvent(event);
  return event;
}
const click = (proteinId: string, modifierKeys?: { ctrl?: boolean; meta?: boolean }) => ({
  proteinId,
  modifierKeys: modifierKeys && { ctrl: false, meta: false, shift: false, alt: false, ...modifierKeys },
});

function setup() {
  const plot = Object.assign(new EventTarget(), {
    selectedProteinIds: [] as string[],
    selectionMode: false,
    selectionTool: 'rectangle' as 'rectangle' | 'lasso',
    isolateSelection: vi.fn(),
    resetIsolation: vi.fn(),
    resetZoom: vi.fn(),
    hasExpandedDuplicateStack: vi.fn(() => false),
    closeExpandedDuplicateStack: vi.fn(),
  });
  const tools = Object.assign(new EventTarget(), {
    tool: 'pan',
    selectionDisabled: false,
    selectedCount: 0,
    isolated: false,
  });
  const search = Object.assign(new EventTarget(), {
    availableProteinIds: [] as string[],
    selectedProteinIds: [] as string[],
  });
  const interaction = { handleSelectionChange: vi.fn() };
  const root = new EventTarget();
  const warn = vi.fn();
  const controller = createSelectionController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    plotTools: tools as unknown as ProtspacePlotTools,
    proteinSearch: search as unknown as ProtspaceProteinSearch,
    interactionController: interaction,
    root: root as unknown as Document,
    warn,
  });
  return { controller, plot, tools, search, interaction, root, warn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selection controller: clicks and brushes', () => {
  it('a plain click selects one protein and a second click on the only one deselects it', () => {
    const m = setup();

    fire(m.plot, 'protein-click', click('P1', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    expect(m.search.selectedProteinIds).toEqual(['P1']);
    expect(m.tools.selectedCount).toBe(1);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith(['P1']);

    fire(m.plot, 'protein-click', click('P2', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P2']);

    fire(m.plot, 'protein-click', click('P2', {}));
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('a ⌘- or Ctrl-click, or any selection tool, toggles', () => {
    const m = setup();
    fire(m.plot, 'protein-click', click('P1', {}));

    fire(m.plot, 'protein-click', click('P2', { ctrl: true }));
    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P2']);
    fire(m.plot, 'protein-click', click('P1', { meta: true }));
    expect(m.plot.selectedProteinIds).toEqual(['P2']);

    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    fire(m.plot, 'protein-click', click('P3', {}));
    expect(m.plot.selectedProteinIds).toEqual(['P2', 'P3']);
  });

  it('a protein-click without modifierKeys reads as a plain click', () => {
    const m = setup();
    fire(m.plot, 'protein-click', { proteinId: 'P00595' });
    expect(m.search.selectedProteinIds).toEqual(['P00595']);
    fire(m.plot, 'protein-click', { proteinId: 'P00596' });
    expect(m.search.selectedProteinIds).toEqual(['P00596']);
  });

  it('a brush merges under a selection tool and replaces otherwise', () => {
    const m = setup();
    fire(m.plot, 'brush-selection', { proteinIds: ['P1', 'P2'], isMultiple: true });
    fire(m.plot, 'brush-selection', { proteinIds: ['P3'], isMultiple: true });
    expect(m.plot.selectedProteinIds).toEqual(['P3']);

    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    fire(m.plot, 'brush-selection', { proteinIds: ['P4', 'P3'], isMultiple: true, idsUnique: true });
    expect(m.plot.selectedProteinIds).toEqual(['P3', 'P4']);
  });
});

describe('selection controller: the search box', () => {
  it('search adds and removes commit after the paint', async () => {
    const m = setup();

    fire(m.search, 'add-selection', { proteinId: 'P1' });
    fire(m.search, 'add-selection-multiple', { proteinIds: ['P2', 'P3'] });
    fire(m.search, 'remove-selection', { proteinId: 'P2' });

    // Shown at once, so each pick builds on the last…
    expect(m.search.selectedProteinIds).toEqual(['P1', 'P3']);
    expect(m.tools.selectedCount).toBe(2);
    // …and pushed to the plot once, after the paint.
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();

    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual(['P1', 'P3']);
    expect(m.interaction.handleSelectionChange).toHaveBeenCalledOnce();
    expect(m.interaction.handleSelectionChange).toHaveBeenCalledWith(['P1', 'P3']);
  });

  it('a selection committed at once drops a waiting search pick', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    fire(m.search, 'selection-change', { proteinIds: ['P3'] });
    expect(m.plot.selectedProteinIds).toEqual(['P3']);

    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual(['P3']);
    expect(m.search.selectedProteinIds).toEqual(['P3']);
  });

  it('ignores an add of a protein already selected and a remove of one that is not', async () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });
    m.interaction.handleSelectionChange.mockClear();

    fire(m.search, 'add-selection', { proteinId: 'P1' });
    fire(m.search, 'remove-selection', { proteinId: 'P9' });
    fire(m.search, 'add-selection-multiple', { proteinIds: ['P1'] });
    await afterPaint();

    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
  });
});

describe('selection controller: the plot tools', () => {
  it('Clear empties the selection', async () => {
    const m = setup();
    fire(m.search, 'add-selection', { proteinId: 'P1' });
    await afterPaint();

    fire(m.tools, 'clear-selections');

    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.tools.selectedCount).toBe(0);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('Isolate lands a waiting search pick first', () => {
    const m = setup();
    let selectedAtIsolate: string[] = [];
    m.plot.isolateSelection.mockImplementation(() => {
      selectedAtIsolate = [...m.plot.selectedProteinIds];
    });
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    fire(m.tools, 'isolate-data');

    expect(m.plot.isolateSelection).toHaveBeenCalledOnce();
    expect(selectedAtIsolate).toEqual(['P1']);
  });

  it('Reset resets isolation', () => {
    const m = setup();
    m.tools.isolated = true;

    fire(m.tools, 'reset-isolation');

    expect(m.plot.resetIsolation).toHaveBeenCalledOnce();
    expect(m.tools.isolated).toBe(false);
  });

  it('Fit to view resets the zoom', () => {
    const m = setup();
    fire(m.tools, 'fit-view');
    expect(m.plot.resetZoom).toHaveBeenCalledOnce();
  });

  it("a tool change sets the plot's mode and tool", () => {
    const m = setup();

    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    expect(m.plot.selectionMode).toBe(true);
    expect(m.plot.selectionTool).toBe('rectangle');
    expect(m.tools.tool).toBe('rectangle');

    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    expect(m.plot.selectionTool).toBe('lasso');

    fire(m.tools, 'plot-tool-change', { tool: 'pan' });
    expect(m.plot.selectionMode).toBe(false);
    // Move keeps the last selection tool, as turning selection mode off did.
    expect(m.plot.selectionTool).toBe('lasso');
  });
});

describe('selection controller: plot events', () => {
  it('data-isolation clears the selection', () => {
    const m = setup();
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });
    m.interaction.handleSelectionChange.mockClear();

    fire(m.plot, 'data-isolation', { isolationMode: true, isolationHistory: [['P1']] });

    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.tools.selectedCount).toBe(0);
    expect(m.tools.isolated).toBe(true);
    // The plot cleared its own selection when it isolated.
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
  });

  it('auto-disable-selection returns to Move, disables the tools with one point left and warns', () => {
    const m = setup();
    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });

    fire(m.plot, 'auto-disable-selection', { reason: 'insufficient-data', dataSize: 1 });

    expect(m.tools.tool).toBe('pan');
    expect(m.plot.selectionMode).toBe(false);
    expect(m.tools.selectionDisabled).toBe(true);
    expect(m.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Selection mode disabled.',
        description: 'Selection mode disabled: Only 1 point remaining',
      }),
    );

    // Back to the full data: the tools work again.
    fire(m.plot, 'data-isolation-reset', { isolationMode: false, isolationHistory: [] });
    expect(m.tools.selectionDisabled).toBe(false);
    expect(m.tools.isolated).toBe(false);
  });

  it("data-change hands the search the dataset's ids and the plot's selection", () => {
    const m = setup();
    m.plot.selectedProteinIds = ['P2'];

    fire(m.plot, 'data-change', { data: { protein_ids: ['P1', 'P2'] } });

    expect(m.search.availableProteinIds).toEqual(['P1', 'P2']);
    expect(m.search.selectedProteinIds).toEqual(['P2']);
    expect(m.tools.selectedCount).toBe(1);
  });
});

describe('selection controller: Escape', () => {
  it('Escape closes the duplicate stack, then clears, then returns to Move, and ignores presses inside a modal', async () => {
    const m = setup();
    fire(m.tools, 'plot-tool-change', { tool: 'rectangle' });
    fire(m.search, 'selection-change', { proteinIds: ['P1'] });

    m.plot.hasExpandedDuplicateStack.mockReturnValueOnce(true);
    let event = escape(m.root);
    expect(m.plot.closeExpandedDuplicateStack).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(m.plot.selectedProteinIds).toEqual(['P1']);

    event = escape(m.root);
    expect(event.defaultPrevented).toBe(true);
    expect(m.search.selectedProteinIds).toEqual([]);
    await afterPaint();
    expect(m.plot.selectedProteinIds).toEqual([]);

    event = escape(m.root);
    expect(event.defaultPrevented).toBe(true);
    expect(m.tools.tool).toBe('pan');
    expect(m.plot.selectionMode).toBe(false);

    // Nothing left to undo.
    event = escape(m.root);
    expect(event.defaultPrevented).toBe(false);

    // A modal (the legend's dialogs, the figure editor) owns its own Escape.
    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    event = escape(m.root, [
      { getAttribute: (name: string) => (name === 'aria-modal' ? 'true' : null) },
    ]);
    expect(event.defaultPrevented).toBe(false);
    expect(m.tools.tool).toBe('lasso');
  });
});

describe('selection controller: lifecycle', () => {
  it('a new dataset drops waiting picks and returns to Move', async () => {
    const m = setup();
    fire(m.tools, 'plot-tool-change', { tool: 'lasso' });
    fire(m.search, 'add-selection', { proteinId: 'P1' });

    m.controller.resetForNewDataset();
    await afterPaint();

    expect(m.plot.selectedProteinIds).toEqual([]);
    expect(m.interaction.handleSelectionChange).not.toHaveBeenCalled();
    expect(m.search.selectedProteinIds).toEqual([]);
    expect(m.tools.selectedCount).toBe(0);
    expect(m.tools.tool).toBe('pan');
  });

  it('dispose stops listening', () => {
    const m = setup();
    m.controller.dispose();

    fire(m.plot, 'protein-click', click('P1', {}));
    escape(m.root);

    expect(m.plot.selectedProteinIds).toEqual([]);
  });
});

describe('toggleProteinSelection', () => {
  it('adds protein when not selected', () => {
    const result = toggleProteinSelection('P1', ['P2', 'P3']);
    expect(result).toContain('P1');
    expect(result).toContain('P2');
    expect(result).toContain('P3');
    expect(result.length).toBe(3);
  });

  it('removes protein when already selected', () => {
    const result = toggleProteinSelection('P2', ['P1', 'P2', 'P3']);
    expect(result).toContain('P1');
    expect(result).toContain('P3');
    expect(result).not.toContain('P2');
    expect(result.length).toBe(2);
  });

  it('handles empty selection', () => {
    expect(toggleProteinSelection('P1', [])).toEqual(['P1']);
  });

  it('handles removing last selection', () => {
    expect(toggleProteinSelection('P1', ['P1'])).toEqual([]);
  });
});

describe('mergeProteinSelections', () => {
  it('merges two selections', () => {
    const result = mergeProteinSelections(['P1', 'P2'], ['P3', 'P4']);
    expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3', 'P4']));
    expect(result.length).toBe(4);
  });

  it('deduplicates overlapping selections', () => {
    const result = mergeProteinSelections(['P1', 'P2'], ['P2', 'P3']);
    expect(result).toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
    expect(result.length).toBe(3);
  });

  it('handles empty current selection', () => {
    expect(mergeProteinSelections([], ['P1', 'P2'])).toEqual(expect.arrayContaining(['P1', 'P2']));
  });

  it('handles empty new selections', () => {
    expect(mergeProteinSelections(['P1', 'P2'], [])).toEqual(expect.arrayContaining(['P1', 'P2']));
  });

  it('handles both empty', () => {
    expect(mergeProteinSelections([], [])).toEqual([]);
  });

  // The merge as it was before `newAreDistinct`, which every result must match in order.
  const oldMerge = (current: string[], added: string[]) => {
    const merged = new Set(current);
    added.forEach((id) => merged.add(id));
    return Array.from(merged);
  };

  it.each([
    ['empty current', [], ['P3', 'P1', 'P2']],
    ['disjoint', ['P2', 'P1'], ['P4', 'P3']],
    ['overlapping', ['P2', 'P1'], ['P3', 'P1', 'P4', 'P2']],
    ['repeats in the current selection', ['P1', 'P2', 'P1'], ['P3', 'P2']],
    ['no new ids', ['P2', 'P1'], []],
  ])('matches the old merge for distinct new ids: %s', (_, current, added) => {
    expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
    expect(mergeProteinSelections(current, added)).toEqual(oldMerge(current, added));
  });

  it('matches the old merge on random selections with distinct new ids', () => {
    let seed = 1;
    const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    for (let run = 0; run < 200; run++) {
      const current = Array.from({ length: rand(8) }, () => `P${rand(12)}`);
      const added = [...new Set(Array.from({ length: rand(8) }, () => `P${rand(12)}`))];
      expect(mergeProteinSelections(current, added, true)).toEqual(oldMerge(current, added));
    }
  });

  it('dedupes repeated new ids when they are not flagged distinct', () => {
    expect(mergeProteinSelections([], ['P1', 'P2', 'P1'])).toEqual(['P1', 'P2']);
    expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(['P3', 'P1']);
    expect(mergeProteinSelections(['P3'], ['P1', 'P3', 'P1'])).toEqual(
      oldMerge(['P3'], ['P1', 'P3', 'P1']),
    );
  });

  it('returns a copy of distinct new ids when nothing is selected', () => {
    const added = ['P1', 'P2'];
    const result = mergeProteinSelections([], added, true);
    expect(result).toEqual(added);
    expect(result).not.toBe(added);
  });
});
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/selection-controller.test.ts`
Expected: FAIL: `Failed to resolve import "./selection-controller"`.

- [ ] **Step 9: Report the warning from the app**

In `apps/web/src/explore/notifications.ts`, delete `SelectionDisabledNotificationDetail` from the `import type { … } from '@protspace/core'` list and replace `getSelectionDisabledNotification` (:233-245) with:

```ts
/** Why the plot turned selection off (its `auto-disable-selection` event). */
export function getSelectionDisabledNotification({
  reason,
  dataSize,
}: {
  reason: string;
  dataSize: number;
}): NotifyOptions {
  return {
    title: 'Selection mode disabled.',
    description:
      reason === 'insufficient-data'
        ? `Selection mode disabled: Only ${dataSize} point${dataSize !== 1 ? 's' : ''} remaining`
        : 'Selection mode disabled',
    durationMs: 5_000,
    dedupeKey: `selection-disabled:${reason}:${dataSize}`,
  };
}
```

In `apps/web/src/explore/notifications.test.ts`, delete `SelectionDisabledNotificationDetail` from its core type import and replace the test `'maps normalized selection-disabled events to a warning notification'` with:

```ts
  it('says why selection was turned off', () => {
    expect(getSelectionDisabledNotification({ reason: 'insufficient-data', dataSize: 1 })).toMatchObject({
      title: 'Selection mode disabled.',
      description: 'Selection mode disabled: Only 1 point remaining',
      dedupeKey: 'selection-disabled:insufficient-data:1',
    });
    expect(
      getSelectionDisabledNotification({ reason: 'insufficient-data', dataSize: 0 }).description,
    ).toBe('Selection mode disabled: Only 0 points remaining');
    expect(getSelectionDisabledNotification({ reason: 'other', dataSize: 5 }).description).toBe(
      'Selection mode disabled',
    );
  });
```

In `apps/web/src/explore/interaction-controller.ts`, change the interface line `handleSelectionChange(event: Event): void;` to

```ts
  /** The selection changed: remember it and show its last protein's structure. */
  handleSelectionChange(proteinIds: readonly string[]): void;
```

and replace the implementation (:86-95) with:

```ts
    handleSelectionChange(proteinIds) {
      selectedProteins = [...proteinIds];

      if (selectedProteins.length > 0) {
        structureViewer.loadProtein(selectedProteins[selectedProteins.length - 1]);
      }
    },
```

Append to `apps/web/src/explore/interaction-controller.test.ts`:

```ts
describe('interaction controller selection', () => {
  it('a selection loads its last protein', () => {
    const loadProtein = vi.fn();
    const controller = createInteractionController({
      plotElement: { selectedAnnotation: 'family', getCurrentData: () => data } as never,
      legendElement: { autoSync: false, forceSync: vi.fn() } as never,
      structureViewer: { loadProtein } as never,
    });

    controller.handleSelectionChange(['P1', 'P2']);
    expect(loadProtein).toHaveBeenCalledWith('P2');
    expect(controller.getSelectedProteins()).toEqual(['P1', 'P2']);

    controller.handleSelectionChange([]);
    expect(loadProtein).toHaveBeenCalledOnce();
    expect(controller.getSelectedProteins()).toEqual([]);
  });
});
```

(`interaction-controller.eat.test.ts` needs no change: it never calls `handleSelectionChange`.)

- [ ] **Step 10: Write the selection controller**

Create `apps/web/src/explore/selection-controller.ts`:

```ts
import {
  AfterPaintCommit,
  type BrushSelectionDetail,
  type PlotTool,
  type ProteinClickDetail,
  type ProtspacePlotTools,
  type ProtspaceProteinSearch,
  type ProtspaceScatterplot,
} from '@protspace/core';
import type { NotifyOptions } from '../lib/notify';
import type { InteractionController } from './interaction-controller';
import { getSelectionDisabledNotification } from './notifications';

/** Adds `proteinId` to the selection, or removes it when it is already there. */
export function toggleProteinSelection(
  proteinId: string,
  currentSelection: readonly string[],
): string[] {
  const currentSet = new Set(currentSelection);
  if (currentSet.has(proteinId)) {
    currentSet.delete(proteinId);
  } else {
    currentSet.add(proteinId);
  }
  return Array.from(currentSet);
}

/**
 * Merges a brush or lasso into the selection. With `newAreDistinct` (no id repeats in
 * `newSelections`) the new ids skip the set: ~0.3 s for the 782K ids of a lasso at 5M points.
 */
export function mergeProteinSelections(
  currentSelection: readonly string[],
  newSelections: readonly string[],
  newAreDistinct = false,
): string[] {
  if (!newAreDistinct) {
    const merged = new Set(currentSelection);
    newSelections.forEach((id) => merged.add(id));
    return Array.from(merged);
  }
  if (currentSelection.length === 0) return newSelections.slice();
  const current = new Set(currentSelection);
  const merged = Array.from(current);
  for (const id of newSelections) if (!current.has(id)) merged.push(id);
  return merged;
}

interface SelectionControllerOptions {
  plotElement: ProtspaceScatterplot;
  plotTools: ProtspacePlotTools;
  proteinSearch: ProtspaceProteinSearch;
  interactionController: Pick<InteractionController, 'handleSelectionChange'>;
  /** Where Escape is heard, in the bubble phase: the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** Shows a warning toast: `notify.warning` in the app. */
  warn(options: NotifyOptions): void;
}

export interface SelectionController {
  /** A new dataset: drop a search pick still waiting and return the tool strip to Move. */
  resetForNewDataset(): void;
  dispose(): void;
}

/** Whether an element in `path` is a modal (`aria-modal="true"`), which owns its own Escape. */
function insideModal(path: readonly unknown[]): boolean {
  return path.some(
    (node) =>
      typeof (node as Element | null)?.getAttribute === 'function' &&
      (node as Element).getAttribute('aria-modal') === 'true',
  );
}

/**
 * The selection (design decision 9, moved from the control bar): plot clicks and brushes, the
 * search box's picks, the plot tools, isolation and the Escape order. Every change lands through
 * one commit, which writes the plot, the search box and the tools, then tells the app.
 */
export function createSelectionController({
  plotElement,
  plotTools,
  proteinSearch,
  interactionController,
  root,
  warn,
}: SelectionControllerOptions): SelectionController {
  /** The selection the search box and the tools show, a search pick still waiting included. */
  let selected: string[] = [];
  let tool: PlotTool = 'pan';
  // A search pick or Clear re-stages every point: the box and the tools show it in the frame of
  // the input, and the plot takes it after that frame is painted. A newer pick replaces one
  // still waiting, and a selection committed at once drops it.
  const commit = new AfterPaintCommit();

  const show = (ids: string[]) => {
    selected = ids;
    proteinSearch.selectedProteinIds = ids;
    plotTools.selectedCount = ids.length;
  };

  const commitSelection = (ids: string[], { afterPaint = false } = {}) => {
    const land = () => {
      show(ids);
      plotElement.selectedProteinIds = [...ids];
      interactionController.handleSelectionChange(ids);
    };
    if (afterPaint) {
      show(ids);
      commit.schedule(land);
    } else {
      commit.cancel();
      land();
    }
  };

  const setTool = (next: PlotTool) => {
    tool = next;
    plotTools.tool = next;
    plotElement.selectionMode = next !== 'pan';
    if (next !== 'pan') plotElement.selectionTool = next;
  };

  const onProteinClick = (event: Event) => {
    const { proteinId, modifierKeys } = (event as CustomEvent<ProteinClickDetail>).detail;
    if (!proteinId) return;
    // A selection tool or ⌘/Ctrl toggles; a plain click selects just this protein, or nothing
    // when it already is the only one.
    if (tool !== 'pan' || modifierKeys?.ctrl || modifierKeys?.meta) {
      commitSelection(toggleProteinSelection(proteinId, selected));
    } else {
      const isOnlySelected = selected.length === 1 && selected[0] === proteinId;
      commitSelection(isOnlySelected ? [] : [proteinId]);
    }
  };

  const onBrushSelection = (event: Event) => {
    const detail = (event as CustomEvent<BrushSelectionDetail>).detail;
    const ids = Array.isArray(detail?.proteinIds) ? detail.proteinIds : [];
    commitSelection(
      tool !== 'pan' ? mergeProteinSelections(selected, ids, detail?.idsUnique === true) : ids.slice(),
    );
  };

  const onSearchSelectionChange = (event: Event) => {
    commitSelection([...(event as CustomEvent<{ proteinIds: string[] }>).detail.proteinIds]);
  };

  const onSearchAdd = (event: Event) => {
    const { proteinId } = (event as CustomEvent<{ proteinId: string }>).detail;
    if (!proteinId || selected.includes(proteinId)) return;
    commitSelection([...selected, proteinId], { afterPaint: true });
  };

  const onSearchRemove = (event: Event) => {
    const { proteinId } = (event as CustomEvent<{ proteinId: string }>).detail;
    if (!proteinId || !selected.includes(proteinId)) return;
    commitSelection(
      selected.filter((id) => id !== proteinId),
      { afterPaint: true },
    );
  };

  const onSearchAddMultiple = (event: Event) => {
    const { proteinIds } = (event as CustomEvent<{ proteinIds: string[] }>).detail;
    if (!proteinIds || proteinIds.length === 0) return;
    const current = new Set(selected);
    const added = proteinIds.filter((id) => !current.has(id));
    if (added.length === 0) return;
    commitSelection([...selected, ...added], { afterPaint: true });
  };

  const onToolChange = (event: Event) => {
    setTool((event as CustomEvent<{ tool: PlotTool }>).detail.tool);
  };

  const onFitView = () => plotElement.resetZoom();

  const onClear = () => commitSelection([], { afterPaint: true });

  const onIsolate = () => {
    // Isolation reads the plot's selection: land a search pick still waiting first.
    commit.flush();
    plotElement.isolateSelection();
  };

  const onResetIsolation = () => {
    plotElement.resetIsolation();
    plotTools.isolated = false;
  };

  /** The plot isolated or reset: it emptied its own selection, so only the display follows. */
  const onIsolation = (event: Event) => {
    plotTools.isolated = (event as CustomEvent<{ isolationMode: boolean }>).detail.isolationMode;
    show([]);
  };

  const onIsolationReset = (event: Event) => {
    plotTools.isolated = (event as CustomEvent<{ isolationMode: boolean }>).detail.isolationMode;
    show([]);
    // Back to the full data: selection works again.
    plotTools.selectionDisabled = false;
  };

  const onAutoDisableSelection = (event: Event) => {
    const { reason, dataSize } = (event as CustomEvent<{ reason: string; dataSize: number }>)
      .detail;
    setTool('pan');
    if (reason === 'insufficient-data' && dataSize <= 1) plotTools.selectionDisabled = true;
    warn(getSelectionDisabledNotification({ reason, dataSize }));
  };

  /** The search box offers the proteins in view; the tools show the plot's selection. */
  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: { protein_ids?: string[] } | null }>).detail?.data;
    if (!data) return;
    proteinSearch.availableProteinIds = Array.isArray(data.protein_ids) ? data.protein_ids : [];
    show(Array.isArray(plotElement.selectedProteinIds) ? plotElement.selectedProteinIds : []);
  };

  /**
   * Escape, in the bubble phase on the document. Open layers (menus, dialogs, the search's
   * suggestions) take it first in the capture phase; a modal that is not a layer yet owns its
   * own. Each press undoes one step: the duplicate-stack spider, then the selection, then the
   * selection tool. Stopping it keeps the plot's own Escape (EAT connectors) for a later press.
   */
  const onKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    if (insideModal(event.composedPath())) return;
    if (plotElement.hasExpandedDuplicateStack()) {
      event.preventDefault();
      event.stopPropagation();
      plotElement.closeExpandedDuplicateStack();
      return;
    }
    if (selected.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      commitSelection([], { afterPaint: true });
      return;
    }
    if (tool !== 'pan') {
      event.preventDefault();
      event.stopPropagation();
      setTool('pan');
    }
  };

  plotElement.addEventListener('protein-click', onProteinClick);
  plotElement.addEventListener('brush-selection', onBrushSelection);
  plotElement.addEventListener('data-change', onDataChange);
  plotElement.addEventListener('data-isolation', onIsolation);
  plotElement.addEventListener('data-isolation-reset', onIsolationReset);
  plotElement.addEventListener('auto-disable-selection', onAutoDisableSelection);
  proteinSearch.addEventListener('selection-change', onSearchSelectionChange);
  proteinSearch.addEventListener('add-selection', onSearchAdd);
  proteinSearch.addEventListener('add-selection-multiple', onSearchAddMultiple);
  proteinSearch.addEventListener('remove-selection', onSearchRemove);
  plotTools.addEventListener('plot-tool-change', onToolChange);
  plotTools.addEventListener('fit-view', onFitView);
  plotTools.addEventListener('clear-selections', onClear);
  plotTools.addEventListener('isolate-data', onIsolate);
  plotTools.addEventListener('reset-isolation', onResetIsolation);
  root.addEventListener('keydown', onKeydown);

  return {
    resetForNewDataset() {
      commit.cancel();
      show([]);
      // The tool strip only: the data renderer resets the plot's own selection mode with its data.
      tool = 'pan';
      plotTools.tool = 'pan';
    },
    dispose() {
      commit.cancel();
      plotElement.removeEventListener('protein-click', onProteinClick);
      plotElement.removeEventListener('brush-selection', onBrushSelection);
      plotElement.removeEventListener('data-change', onDataChange);
      plotElement.removeEventListener('data-isolation', onIsolation);
      plotElement.removeEventListener('data-isolation-reset', onIsolationReset);
      plotElement.removeEventListener('auto-disable-selection', onAutoDisableSelection);
      proteinSearch.removeEventListener('selection-change', onSearchSelectionChange);
      proteinSearch.removeEventListener('add-selection', onSearchAdd);
      proteinSearch.removeEventListener('add-selection-multiple', onSearchAddMultiple);
      proteinSearch.removeEventListener('remove-selection', onSearchRemove);
      plotTools.removeEventListener('plot-tool-change', onToolChange);
      plotTools.removeEventListener('fit-view', onFitView);
      plotTools.removeEventListener('clear-selections', onClear);
      plotTools.removeEventListener('isolate-data', onIsolate);
      plotTools.removeEventListener('reset-isolation', onResetIsolation);
      root.removeEventListener('keydown', onKeydown);
    },
  };
}
```

The structure viewer is no longer loaded here: `interactionController.handleSelectionChange(ids)` loads the last id, which for a search add is the protein just picked (the control bar loaded it twice).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/selection-controller.test.ts src/explore/notifications.test.ts src/explore/interaction-controller.test.ts`
Expected: PASS: 35 tests in `selection-controller.test.ts` (18 controller tests, 4 toggle tests and 13 merge tests, the `it.each` counting five), and every test in the two other files.

- [ ] **Step 11: Export the new API from core**

In `packages/core/src/index.ts`, directly below the `ProtspaceProjectionMetadata` export Task 2.8 added, add:

```ts
// The plot's tool strip and the app bar's search (design decision 9).
export { ProtspacePlotTools } from './components/plot-tools/plot-tools';
export type { PlotTool } from './components/plot-tools/plot-tools';
export { ProtspaceProteinSearch } from './components/control-bar/search';
export { AfterPaintCommit } from './utils/after-paint-commit';
```

and add `BrushSelectionDetail` and `ProteinClickDetail` to the existing `export type { RendererDegradedContext, RendererDegradedDetail, RendererDegradedReason } from './components/scatter-plot/scatter-plot.events';` list.

- [ ] **Step 12: Empty the control bar**

Replace `packages/core/src/components/control-bar/control-bar.ts` with:

```ts
import { LitElement, nothing } from 'lit';
import { customElement } from '../../utils/safe-custom-element';
import { controlBarStyles } from './control-bar.styles';

/**
 * Empty since design decision 9 split it: projection, Color by and contours live in the view
 * bar, search, Import and Export in the app bar, the selection tools on the plot, Filter in its
 * dialog, and the app's controllers coordinate them. The app still mounts it until Task 2.10
 * deletes it.
 */
@customElement('protspace-control-bar')
export class ProtspaceControlBar extends LitElement {
  static styles = controlBarStyles;

  render() {
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-control-bar': ProtspaceControlBar;
  }
}
```

In `packages/core/src/components/control-bar/types.ts`, delete `DataChangeDetail`, `ScatterplotElementLike` and `StructureViewerElement` (and `DataLoaderElement` if Task 2.5 left it), with the `NumericAnnotationDisplaySettingsMap`, `LegendSortMode` and `ScatterplotConfig` names from the `@protspace/utils` import that only `ScatterplotElementLike` used. `ProtspaceData` stays: the query builder reads it.

In `packages/core/src/components/control-bar/control-bar.events.ts`, delete `createSelectionDisabledNotificationDetail` (its message moved to the app's `notifications.ts`); the two `SelectionDisabledNotification*` types stay exported until Task 2.10.

In `packages/core/src/components/control-bar/control-bar-helpers.ts`, delete `toggleProteinSelection` and `mergeProteinSelections` (moved to `selection-controller.ts`); in `control-bar-helpers.test.ts`, delete their two `describe` blocks and their names from the import.

Delete `packages/core/src/components/control-bar/control-bar.after-paint.test.ts`, `control-bar.events.test.ts` and `control-bar.auto-sync.test.ts` (ported in Step 8; the auto-sync polling is gone).

- [ ] **Step 13: Run the core suite and build**

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS. Against the Task 2.8 counts: unit files −3 (`control-bar.after-paint.test.ts`, `control-bar.events.test.ts`, `control-bar.auto-sync.test.ts`), `control-bar-helpers.test.ts` −17 (the 4 toggle and 13 merge tests), `search.component.test.ts` +3; browser files +1 (`plot-tools`, 7 tests) and `button.browser.test.ts` +1.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core build`
Expected: no errors; `dist/` rebuilt.

- [ ] **Step 14: Wire the runtime and the shell**

In `apps/web/src/explore/elements.ts`: add `ProtspacePlotTools` and `ProtspaceProteinSearch` to the core type import; add to `interface ExploreElements`

```ts
  plotTools: ProtspacePlotTools;
  proteinSearch: ProtspaceProteinSearch;
```

add `'protspace-plot-tools'` and `'protspace-protein-search'` to `REQUIRED_TAGS`; in `getElements`

```ts
  const plotTools = doc.getElementById('myPlotTools') as ProtspacePlotTools | null;
  const proteinSearch = doc.getElementById('myProteinSearch') as ProtspaceProteinSearch | null;
```

and add both to the missing-element condition, the `console.error` object and the returned object. (`controlBar` stays in `elements.ts` until Task 2.10.)

In `apps/web/src/explore/runtime.ts`:

1. Replace `import { bindControlBarEvents } from './control-bar-events';` with `import { createSelectionController } from './selection-controller';`.
2. In the destructuring `const { … } = elements;`, remove `controlBar` and add `plotTools, proteinSearch`.
3. Directly after `const interactionController = createInteractionController({ … });` (so its `protein-click` listener runs before the provenance listener added further down, as the control bar's did), add:

```ts
  const selectionController = createSelectionController({
    plotElement,
    plotTools,
    proteinSearch,
    interactionController,
    root: document,
    warn: (options) => notify.warning(options),
  });
  lifecycle.addCleanup(() => selectionController.dispose());
```

4. Delete the selection listener (today :312-317):

```ts
  addTrackedEventListener(
    lifecycle,
    controlBar,
    'protein-selection-change',
    interactionController.handleSelectionChange,
  );
```

and the `bindControlBarEvents({ … });` call.

5. In the `ExploreControls` object: in `resetForNewDataset()`, delete the `controlBar.clearForNewDataset(…)` call and add `selectionController.resetForNewDataset();`; in `showInitialView(view)`, delete the three control-bar lines and their comment, so it reads

```ts
      viewBarController.showInitialView(view);
      filterController.setSelectedAnnotation(view.annotation);
```

and replace the body of `setRendering(rendering)` with a comment, keeping the method:

```ts
    setRendering() {
      // Nothing to hold while a dataset renders: the controllers write the plot only on picks.
      // Task 2.10 removes the method.
    },
```

The `ExploreControls` object must be declared after `selectionController`; move it down if it is above (keeping it above `createDatasetController(…)`).

6. Change `console.log('Use the control bar to change annotations and toggle selection modes!');` to `console.log('Use the view bar to change the view and the plot tools to select proteins.');`.

Delete `apps/web/src/explore/control-bar-events.ts` and `apps/web/src/explore/control-bar-events.test.ts`.

In `apps/web/src/workbench/PlotArea.tsx`, add the tool strip immediately after the `<protspace-scatterplot id="myPlot" …></protspace-scatterplot>` element, inside the same `main`:

```tsx
      <protspace-plot-tools id="myPlotTools" data-driver-id="selection"></protspace-plot-tools>
```

In `apps/web/src/workbench/AppBar.tsx`:

1. Wrap everything the header renders before `[data-workbench="app-bar-center"]` (the "ProtSpace home" link, any separator after it, and the `[data-workbench="dataset"]` block) in one element:

```tsx
      <div className="wb-app-bar-start" data-workbench="app-bar-start">
        {/* the home link, its separator and the dataset block, unchanged */}
      </div>
```

so the header has exactly three children: `app-bar-start`, `app-bar-center` and `app-bar-actions`.

2. Fill the centre:

```tsx
      <div data-workbench="app-bar-center">
        <protspace-protein-search
          id="myProteinSearch"
          data-driver-id="search"
        ></protspace-protein-search>
      </div>
```

3. In the dataset block, replace Task 2.2's name line
   `{datasetName !== null && <span className="wb-dataset-name">{shownName(datasetName)}</span>}` with:

```tsx
        {datasetName !== null && (
          <>
            <span className="wb-dataset-name">{shownName(datasetName)}</span>
            {/* The full label over the name, which truncates at 200 px. */}
            <ps-tooltip text={datasetName}></ps-tooltip>
          </>
        )}
```

(`wb-dataset-name` and `wb-dataset-count` already exist from Task 2.2. Inside the conditional, `datasetName` is a `string`, which `ps-tooltip`'s typed `text` needs, and the tooltip anchors to the name, its previous sibling.)

In `apps/web/src/custom-elements.d.ts`, add inside `interface IntrinsicElements`:

```ts
      'protspace-plot-tools': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string; 'data-driver-id'?: string },
        HTMLElement
      >;
      'protspace-protein-search': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id?: string; 'data-driver-id'?: string },
        HTMLElement
      >;
```

In `apps/web/src/workbench/workbench.css`, delete the `display`, `flex-*`, `justify-content` and `gap` declarations of Task 2.2's app bar rule (the rule for `[data-workbench='app-bar']`; keep its height, padding, border and background), and append:

```css
/* App bar (Task 2.9): three columns, so search stays centred while both sides fit. A side
   column never shrinks below its content (1fr = minmax(auto, 1fr)); search gives way first. */
.workbench header[data-workbench='app-bar'] {
  display: grid;
  grid-template-columns: 1fr minmax(200px, 420px) 1fr;
  align-items: center;
  column-gap: var(--ps-space-3);
}

.wb-app-bar-start {
  display: flex;
  align-items: center;
  gap: var(--ps-space-2);
  min-width: 0;
}

.workbench [data-workbench='app-bar-center'] {
  display: flex;
  align-items: center;
  min-width: 0;
}

.workbench [data-workbench='app-bar-actions'] {
  justify-self: end;
}

#myProteinSearch {
  display: block;
  width: 100%;
}

.wb-dataset-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Import and Export keep their names but show only their icons. */
@media (max-width: 1099.98px) {
  #myImportMenu::part(trigger-label),
  #myExportMenu::part(trigger-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@media (max-width: 1023.98px) {
  .wb-dataset-count {
    display: none;
  }
}

/* Narrow fallback (below 951 px): search gives way entirely before anything leaves the window. */
.workbench[data-layout='narrow'] header[data-workbench='app-bar'] {
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.workbench[data-layout='narrow'] .wb-dataset-name {
  max-width: 120px;
}

/* The plot's tool strip: over the plot's top-left corner, never part of the plot's box. */
#myPlotTools {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 5;
}
```

In `apps/web/src/workbench/shortcuts.ts`, change the Escape entry's action text from "clear the selection, then leave selection mode" to "clear the selection, then return to Move and zoom" (keep the capital letter Task 2.4 gave it, if any), and in `shortcuts.test.ts` change the test title and expectation the same way.

In `apps/web/src/tour/product-tour.ts`:

1. Delete `/** Host selector for the control-bar custom element. */` and `const CONTROL_BAR = '[data-driver-id="control-bar"]';` (steps 4 and 5 were its last users).
2. Replace step 4, `shadowStep(CONTROL_BAR, 'search', { … }),`, with:

```ts
  // ── Step 4 – Search (app bar) ───────────────────────────────
  {
    element: '[data-driver-id="search"]',
    popover: {
      title: 'Search Proteins',
      description: `Press <kbd><span class="mod-key">${isMacOrIos() ? '⌘' : 'Ctrl+'}</span>K</kbd> or click here to search. Type a protein ID to find it instantly, or <strong>paste</strong> multiple IDs to select them all at once.`,
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },
```

3. Replace step 5, `shadowStep(CONTROL_BAR, 'selection', { … }),`, with:

```ts
  // ── Step 5 – Selection Tools (plot tool strip) ─────────────
  {
    element: '[data-driver-id="selection"]',
    popover: {
      title: 'Selection Tools',
      description:
        '<strong>Box select</strong> and <strong>Lasso select</strong> select the points you drag around; <strong>Move and zoom</strong> pans again, and <strong>Fit to view</strong> shows every point. Press <kbd>Esc</kbd> to clear the current selection; press it again to return to Move and zoom.<br><br>With a selection, <strong>Clear</strong> deselects all and <strong>Isolate</strong> focuses on the selected proteins; <strong>Reset</strong> restores the full dataset.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },
```

In `apps/web/tests/dataset-reload.spec.ts`, replace the test `'selection-disabled-notification uses the unified warning toast path'` (:594-608) with:

```ts
  test('auto-disable-selection uses the unified warning toast path', async ({ page }) => {
    await dispatchCustomEvent(page, '#myPlot', 'auto-disable-selection', {
      reason: 'insufficient-data',
      dataSize: 1,
    });

    await expect(page.getByText('Selection mode disabled.')).toBeVisible();
    await expect(page.getByText('Selection mode disabled: Only 1 point remaining')).toBeVisible();
    expect(await hasLegacyNotificationHelperArtifacts(page)).toBe(false);
  });
```

Run: `pnpm --filter @protspace/app type-check && pnpm --filter @protspace/app exec vitest --run`
Expected: no type errors; every app test passes (`control-bar-events.test.ts` gone, `selection-controller.test.ts` added, the shortcuts and notifications tests updated).

- [ ] **Step 15: Retarget the helpers and write the e2e spec**

In `apps/web/tests/helpers/explore.ts`, replace the bodies of the five selection helpers (keep their exported names and signatures):

```ts
/** Picks a tool on the plot's tool strip and waits until the plot uses it. */
export async function chooseTool(
  page: Page,
  tool: 'Move and zoom' | 'Box select' | 'Lasso select',
): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page
    .getByRole('toolbar', { name: 'Plot tools' })
    .getByRole('button', { name: tool, exact: true })
    .click();
  const expected =
    tool === 'Move and zoom'
      ? { mode: false, kind: null }
      : { mode: true, kind: tool === 'Box select' ? 'rectangle' : 'lasso' };
  await page.waitForFunction(
    ({ mode, kind }) => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { selectionMode?: boolean; selectionTool?: string })
        | null;
      return plot?.selectionMode === mode && (kind === null || plot?.selectionTool === kind);
    },
    expected,
    { timeout: 10_000 },
  );
}

/** Clear, Isolate or Reset beside the tool strip; each shows only while it applies. */
export function selectionAction(page: Page, name: 'Clear' | 'Isolate' | 'Reset'): Locator {
  return page.getByRole('group', { name: 'Selection' }).getByRole('button', { name, exact: true });
}

/** Clears the selection, if there is one, and waits until the plot has none. */
export async function clearSelection(page: Page): Promise<void> {
  const clear = selectionAction(page, 'Clear');
  if (await clear.isVisible().catch(() => false)) await clear.click();
  await page.waitForFunction(
    () =>
      (
        (document.querySelector('#myPlot') as (Element & { selectedProteinIds?: string[] }) | null)
          ?.selectedProteinIds ?? []
      ).length === 0,
    undefined,
    { timeout: 10_000 },
  );
}

/** Isolates the selection and waits until the plot shows only it. */
export async function isolateSelection(page: Page): Promise<void> {
  await selectionAction(page, 'Isolate').click();
  await page.waitForFunction(
    () =>
      (
        document.querySelector('#myPlot') as (Element & { isIsolationMode?: () => boolean }) | null
      )?.isIsolationMode?.() === true,
    undefined,
    { timeout: 10_000 },
  );
}

/** Leaves isolation and waits until the plot shows the full dataset. */
export async function resetIsolation(page: Page): Promise<void> {
  await selectionAction(page, 'Reset').click();
  await page.waitForFunction(
    () =>
      (
        document.querySelector('#myPlot') as (Element & { isIsolationMode?: () => boolean }) | null
      )?.isIsolationMode?.() === false,
    undefined,
    { timeout: 10_000 },
  );
}
```

Create `apps/web/tests/workbench-selection.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import {
  appBar,
  chooseTool,
  getSelectedProteinIds,
  importTrigger,
  isolateSelection,
  openExplore,
  plotArea,
  resetIsolation,
  searchInput,
  selectionAction,
} from './helpers/explore';

const toolStrip = (page: Page) => page.getByRole('toolbar', { name: 'Plot tools' });
const toolButton = (page: Page, name: string) =>
  toolStrip(page).getByRole('button', { name, exact: true });

/** The first `count` protein ids of the loaded dataset. */
function proteinIds(page: Page, count: number): Promise<string[]> {
  return page
    .locator('#myPlot')
    .evaluate(
      (plot, n) =>
        ((plot as Element & { data?: { protein_ids?: string[] } }).data?.protein_ids ?? []).slice(
          0,
          n,
        ),
      count,
    );
}

/** Selects `ids` one by one through the search box, the way a user types them. */
async function selectBySearch(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await searchInput(page).fill(id);
    await searchInput(page).press('Enter');
  }
  await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids);
}

test.describe('plot tools and selection', () => {
  test("the tool strip sits in the plot's top-left with its tools named", async ({ page }) => {
    await openExplore(page);

    await expect(toolStrip(page)).toBeVisible();
    for (const name of ['Move and zoom', 'Box select', 'Lasso select', 'Fit to view']) {
      await expect(toolButton(page, name)).toBeVisible();
    }
    await expect(toolButton(page, 'Move and zoom')).toHaveAttribute('aria-pressed', 'true');

    const plot = (await page.locator('#myPlot').boundingBox())!;
    const area = (await plotArea(page).boundingBox())!;
    const strip = (await toolStrip(page).boundingBox())!;
    // 12 px from the plot's top-left, laid over it: the plot keeps the whole plot area.
    expect(Math.abs(strip.x - plot.x - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(strip.y - plot.y - 12)).toBeLessThanOrEqual(1);
    expect(plot).toEqual(area);
  });

  test('Box select selects by dragging; Escape clears, then returns to Move', async ({ page }) => {
    await openExplore(page);
    await chooseTool(page, 'Box select');
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    const plot = (await page.locator('#myPlot').boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.25, plot.y + plot.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(plot.x + plot.width * 0.75, plot.y + plot.height * 0.75, {
      steps: 10,
    });
    await page.mouse.up();
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBe(0);
    await expect(toolButton(page, 'Box select')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(toolButton(page, 'Move and zoom')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page
        .locator('#myPlot')
        .evaluate((p) => (p as Element & { selectionMode?: boolean }).selectionMode),
    ).toBe(false);
  });

  test('Escape in the search box closes open suggestions and keeps the selection; the next Escape clears it', async ({
    page,
  }) => {
    await openExplore(page);
    const [id] = await proteinIds(page, 1);
    await selectBySearch(page, [id]);

    // Typing again opens the suggestions; Escape closes them and nothing else.
    const suggestions = page.locator('protspace-protein-search').getByRole('listbox');
    await searchInput(page).fill(id.slice(0, 2));
    await expect(suggestions).toBeVisible();
    await searchInput(page).press('Escape');
    await expect(suggestions).toBeHidden();
    expect(await getSelectedProteinIds(page)).toEqual([id]);

    // Nothing left to close: the next Escape clears the selection.
    await searchInput(page).press('Escape');
    await expect.poll(async () => (await getSelectedProteinIds(page)).length).toBe(0);
  });

  test('Clear, Isolate and Reset appear when they apply', async ({ page }) => {
    await openExplore(page);
    await expect(page.getByRole('group', { name: 'Selection' })).toHaveCount(0);

    await selectBySearch(page, await proteinIds(page, 2));
    await expect(selectionAction(page, 'Clear')).toBeVisible();
    await expect(selectionAction(page, 'Isolate')).toBeVisible();
    await expect(selectionAction(page, 'Reset')).toHaveCount(0);

    await isolateSelection(page);
    await expect(selectionAction(page, 'Reset')).toBeVisible();
    await expect(selectionAction(page, 'Clear')).toHaveCount(0);

    await resetIsolation(page);
    await expect(page.getByRole('group', { name: 'Selection' })).toHaveCount(0);
  });

  test('search sits in the app bar and Ctrl+K focuses it', async ({ page }) => {
    await openExplore(page);
    await expect(appBar(page).locator('protspace-protein-search')).toHaveCount(1);

    // Centred in the bar's content box while both sides fit (1280 px); its padding is 16 px
    // left and 8 px right.
    const bar = (await appBar(page).boundingBox())!;
    const search = (await page.locator('#myProteinSearch').boundingBox())!;
    const shift = await appBar(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return (parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 2;
    });
    expect(
      Math.abs(search.x + search.width / 2 - (bar.x + bar.width / 2 + shift)),
    ).toBeLessThanOrEqual(1);
    expect(search.height).toBeLessThanOrEqual(32);

    await page.locator('body').press('Control+k');
    await expect(searchInput(page)).toBeFocused();
  });

  test('the app bar keeps one row without overflow at 951, 1024 and 1280 px', async ({ page }) => {
    await openExplore(page);
    for (const width of [951, 1024, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      const bar = appBar(page);
      const box = (await bar.boundingBox())!;
      expect(box.height).toBe(48);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      const groups = await Promise.all(
        ['app-bar-start', 'app-bar-center', 'app-bar-actions'].map(
          async (name) => (await page.locator(`[data-workbench="${name}"]`).boundingBox())!,
        ),
      );
      for (const group of groups) {
        expect(group.y).toBeGreaterThanOrEqual(box.y);
        expect(group.y + group.height).toBeLessThanOrEqual(box.y + box.height);
      }
      // Left to right, never overlapping.
      expect(groups[0].x + groups[0].width).toBeLessThanOrEqual(groups[1].x + 1);
      expect(groups[1].x + groups[1].width).toBeLessThanOrEqual(groups[2].x + 1);

      // Icon-only below 1100 px, still named.
      await expect(importTrigger(page)).toHaveAccessibleName('Import');
      await expect(appBar(page).getByRole('button', { name: 'Export' })).toBeVisible();
      if (width < 1024) await expect(page.locator('.wb-dataset-count')).toBeHidden();
      else await expect(page.locator('.wb-dataset-count')).toBeVisible();
    }
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-selection.spec.ts` (sandbox disabled)
Expected: PASS, 6 tests.

- [ ] **Step 16: Run the suites this task touches**

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS, as in Step 13.

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (sandbox disabled)
Expected: PASS, the whole Chromium suite, including `workbench-selection`, `workbench-helpers`, `workbench-view-bar`, `workbench-filter`, `brush-selection`, `eat-visualization`, `dataset-reload`, `product-tour` (steps 4 and 5 highlight the light-DOM hosts) and `isolation-dataset-swap`.

Run: `pnpm perf:counts` (sandbox disabled)
Expected: PASS within budget. `search-select`: the pick still commits after the paint and loads the structure once through the interaction controller; the reset's first Escape (focus still in the box, nothing open) clears the selection, its second finds nothing to do.

Run: `pnpm --filter @protspace/app build`
Expected: the build succeeds.

- [ ] **Step 17: Commit**

Run: `pnpm exec prettier --check packages/core/src/components/plot-tools packages/core/src/components/kit packages/core/src/components/control-bar packages/core/src/index.ts apps/web/src apps/web/tests/helpers/explore.ts apps/web/tests/workbench-selection.spec.ts apps/web/tests/dataset-reload.spec.ts`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not, then re-check).

```bash
git add packages/core/src/components/plot-tools \
  packages/core/src/components/kit/button.ts packages/core/src/components/kit/button.browser.test.ts \
  packages/core/src/components/kit/icon.ts \
  packages/core/src/components/control-bar/search.ts \
  packages/core/src/components/control-bar/search.styles.ts \
  packages/core/src/components/control-bar/search.component.test.ts \
  packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar-helpers.ts \
  packages/core/src/components/control-bar/control-bar-helpers.test.ts \
  packages/core/src/components/control-bar/control-bar.events.ts \
  packages/core/src/components/control-bar/types.ts \
  packages/core/src/components/control-bar/control-bar.after-paint.test.ts \
  packages/core/src/components/control-bar/control-bar.events.test.ts \
  packages/core/src/components/control-bar/control-bar.auto-sync.test.ts \
  packages/core/src/index.ts \
  apps/web/src/explore/selection-controller.ts apps/web/src/explore/selection-controller.test.ts \
  apps/web/src/explore/interaction-controller.ts apps/web/src/explore/interaction-controller.test.ts \
  apps/web/src/explore/notifications.ts apps/web/src/explore/notifications.test.ts \
  apps/web/src/explore/control-bar-events.ts apps/web/src/explore/control-bar-events.test.ts \
  apps/web/src/explore/runtime.ts apps/web/src/explore/elements.ts \
  apps/web/src/workbench/PlotArea.tsx apps/web/src/workbench/AppBar.tsx \
  apps/web/src/workbench/workbench.css apps/web/src/workbench/shortcuts.ts \
  apps/web/src/workbench/shortcuts.test.ts apps/web/src/custom-elements.d.ts \
  apps/web/src/tour/product-tour.ts \
  apps/web/tests/helpers/explore.ts apps/web/tests/workbench-selection.spec.ts \
  apps/web/tests/dataset-reload.spec.ts
git commit -m "feat(core): add plot tools and move selection into a controller"
```

(`git commit` needs the sandbox disabled; the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.10: The control bar goes; the view bar keeps one row

With every control moved, `protspace-control-bar` and its own files are deleted and the developer docs describe the replacement elements with a BREAKING note (decision 9). The view bar becomes exactly 44 px and never wraps (decision 1): labels shorten first, then Contours and then Filter move into a "More" menu, decided by measuring the items with hysteresis so a window near a threshold does not flicker.

**Files:**

- Delete: `packages/core/src/components/control-bar/control-bar.ts`, `control-bar.styles.ts`, `styles/layout.ts`, `styles/export.ts` (if Task 2.5 left it), `styles/responsive.ts`, `control-bar.events.ts`, `control-bar-helpers.ts`, `control-bar-helpers.test.ts`, `control-bar.auto-sync.test.ts` and any other `control-bar.*.test.ts` still present (Tasks 2.5–2.9 deleted the others)
- Modify: `packages/core/src/components/control-bar/types.ts` (control-bar-only types out; Task 2.9 already removed them, so only the header comment changes), `packages/core/src/index.ts` (`ProtspaceControlBar`, `SelectionDisabledNotification*` out; `DENSITY_MODE_LABELS` re-exported from `@protspace/utils`), `packages/core/src/styles/style-lint.test.ts` (LEGACY lines of the deleted modules)
- Modify: `apps/web/src/explore/runtime.ts`, `elements.ts` (`REQUIRED_TAGS`), `explore-controls.ts` (`setRendering` out), `data-renderer.ts`, `data-renderer.test.ts`, `dataset-controller.fixtures.ts`, `view-bar-controller.ts`, `view-bar-controller.test.ts`, `workbench-status.ts`, `workbench-status.test.ts`, `apps/web/src/custom-elements.d.ts`, `apps/web/src/tour/product-tour.ts` (control-bar shadow helpers out: the CONTROL_BAR constant went in 2.9; the header comment still names the control bar)
- Create: `apps/web/src/workbench/view-bar-overflow.ts`, `view-bar-overflow.test.ts`, `use-view-bar-stage.ts`, `MoreMenu.tsx`
- Modify: `apps/web/src/workbench/ViewBar.tsx`, `FilterControl.tsx`, `workbench.css`
- Modify: `docs/developers/api/index.md` (:17, :99, :226-300, :465), `embedding.md`, `installation.md` (:63), `messaging.md` (:64), `style-architecture.md` (:13, :113, :177-210)
- Modify: `apps/web/tests/workbench-view-bar.spec.ts`, `apps/web/tests/helpers/explore.ts` (`setContours`, `openFilter`)
- Also modified (needed by this task):
  - `packages/core/src/styles/mixins.ts`: `iconMixin` loses its only consumer (`control-bar.styles.ts`) and goes (knip).
  - `apps/web/src/explore/dataset-controller.eat.test.ts`: its `createControls()` (Task 2.5) drops `setRendering`.
  - `apps/web/tests/url-view-state.spec.ts`: the deep-link test's setter trap stops listing `protspace-control-bar` (Task 2.3 kept it "until 2.10"), so the acceptance grep finds nothing in `apps/web/tests`.

**Interfaces:**

- Consumes: every element and controller from Tasks 2.5–2.9; `ExploreControls`; `ps-button`, `ps-menu`, `ps-menu-group`, `ps-menu-item` (Task 1.8's block review: grouped menu items go in a `ps-menu-group` with a `label`, which names a `role="group"`; `ps-menu` closes and hands focus back to its anchor before it dispatches `ps-select`; it sets `aria-haspopup` and `aria-expanded` on its anchor, which `ps-button` forwards to its inner button); `ProtspaceContoursMenu.pick(mode)` (2.7); the runtime's `click` wiring on `#myFilterButton` (2.6); `appliedFilterConditions` (2.6); `useWorkbenchStatus()` (2.2); the Task 2.3 helpers `viewBar`, `filterButton`, `filterDialog`, `getContoursMode`, `expectUrlParam`, `openExplore`, `projectionTrigger`, `waitForExploreInteractionReady`.
- Produces:
  - No `protspace-control-bar` in core, the app, the e2e helpers or the developer docs. `ExploreControls` without `setRendering`.
  - `view-bar-overflow.ts`: `type ViewBarStage = 0 | 1 | 2 | 3` (0 full; 1 short: the keys "Projection", "Color by" and "Contours" are visually hidden but stay in the names; 2 Contours in More; 3 Contours and Filter in More); `resolveStage(current: ViewBarStage, available: number, measure: (stage: ViewBarStage) => number, cache: Map<ViewBarStage, number>, hysteresis = 24): ViewBarStage` (steps down while the measured width exceeds `available`, caching each width; steps up only when the cached width of the next lower stage plus `hysteresis` fits; at most four iterations). A stage the cache lacks is measured once and cached, so after the hook clears the cache a step up is still possible.
  - `use-view-bar-stage.ts`: `useViewBarStage(barRef: RefObject<HTMLElement | null>): ViewBarStage` (one ResizeObserver on the bar and the item hosts; measures once per animation frame and again after `document.fonts.ready`; clears the cache when an item's own width changes or the contour mode in the workbench status changes, since a Contours hidden in More reports no width; never mutates layout inside the observer callback).
  - View bar: exactly 44 px at every desktop width, `data-stage="0|1|2|3"`; values truncate at `16rem` (Tasks 2.7 and 2.8 already cap the pickers' values); a stage change never changes the plot's box.
  - `MoreMenu`: a `ps-button` showing "More" (accessible name "More view options", plus ", N active" when its dot shows) and a `ps-menu` labelled "More view options" with a "Contours" label and radio items Off, Auto and Always (from stage 2; a pick calls `contoursMenu.pick(mode)`) and an item "Filter…" (stage 3; it clicks `#myFilterButton`); a dot while an item inside is active (contours not Off, or a filter applied).
  - `workbench-status.ts`: `densityLayer: DensityLayerMode`, written by the view-bar controller on every contours change and dataset view.
  - Core re-exports `DENSITY_MODE_LABELS` from `@protspace/utils` (Task 2.7 moved the copy there), so embedders and the docs' TypeScript example reach it through `@protspace/core`.
  - Developer docs: the Control Bar section is replaced by `protspace-projection-select`, `protspace-annotation-select`, `protspace-contours-menu`, `protspace-projection-metadata`, `protspace-protein-search`, `protspace-query-builder`, `protspace-import-menu`, `protspace-export-menu` and `protspace-plot-tools`, with their properties and events and the BREAKING note (research note R2 §3); `selection-disabled-notification` and `eat-threshold-mirror` leave the messaging table.
  - Helpers `setContours` and `openFilter` work whether the item is inline or in More.
  - Additions this task needs (additive): the measured hosts carry `data-view-item` (the projections group, `#myContoursMenu`, `#myFilterButton` and the More button); the More button has the class `wb-more` and its dot `wb-more-dot`; the More menu is `ps-menu#wb-more-menu` and its values are `contours:off|auto|on` and `filter`. `MoreMenu` takes the contour labels from `DENSITY_MODE_LABELS` in `@protspace/utils`, never from `@protspace/core`: a value import of core in the shell would load the whole core before the first paint and break Task 2.2's "tokens and the kit are ready before the explore runtime loads" (`protspace-scatterplot` would be defined early); utils already loads at first paint through `layout-state.ts`.

**Tests:**

- `view-bar-overflow.test.ts` (unit): "steps down until the bar fits"; "does not step up within the hysteresis"; "steps up once the next stage fits with margin"; "re-measures after the cache is cleared"; "never loops more than four times".
- `workbench-status.test.ts`: `densityLayer` defaults to the plot's default mode.
- `view-bar-controller.test.ts`: "reports the contour mode to the workbench status".
- `data-renderer.test.ts`: "a new dataset resets the controls and shows its initial view" without `setRendering`.
- `apps/web/tests/workbench-view-bar.spec.ts` (e2e): "the view bar is 44 px, one row and does not overflow at 1440, 1280, 1024 and 951 px"; "narrowing moves Contours, then Filter, into More, and widening brings them back"; "a window jittering ±4 px around a threshold keeps its stage"; "More shows a dot with contours on, and Auto there sets density=auto in the URL"; "More opens with Enter and Escape returns focus to it".
- `eat-visualization.spec.ts` (the 601 px check rewritten through helpers in 2.3) and `workbench-helpers.spec.ts` stay green.
- `grep -rn "protspace-control-bar\|myControlBar" packages/core/src apps/web/src apps/web/tests docs/developers` prints nothing; `pnpm docs:build` passes in the hook.

Before you start, record the baseline counts from the phase 2 ledger. Every command below runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. After Task 2.9 the control bar renders nothing and keeps no state; the view bar holds the projections group, Contours, a separator, the empty `#myControlBar` and Task 2.6's `<FilterControl />`. Code from earlier tasks is anchored as those tasks write it (Task 2.2's `workbench.css` and `workbench-status.ts`, Task 2.5's `ExploreControls`, Task 2.6's `FilterControl.tsx`, Task 2.8's `ViewBar.tsx`, `view-bar-controller.ts` and helpers); read each file before editing it.

- [ ] **Step 1: Write the failing stage tests**

Create `apps/web/src/workbench/view-bar-overflow.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';

/** A measure with a fixed width per stage, as a bar whose items do not change. */
function measureOf(widths: readonly [number, number, number, number]) {
  return vi.fn((stage: ViewBarStage) => widths[stage]);
}

describe('resolveStage', () => {
  it('steps down until the bar fits', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>();

    expect(resolveStage(0, 750, measure, cache)).toBe(2);
    expect(measure.mock.calls.map(([stage]) => stage)).toEqual([0, 1, 2]);
    expect([...cache]).toEqual([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);
  });

  it('does not step up within the hysteresis', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);

    // Stage 1 needs 800 px: 810 px would hold it, but by less than the 24 px margin.
    expect(resolveStage(2, 810, measure, cache)).toBe(2);
    expect(measure).not.toHaveBeenCalled();
  });

  it('steps up once the next stage fits with margin', () => {
    const measure = measureOf([900, 800, 700, 600]);
    const cache = new Map<ViewBarStage, number>([
      [0, 900],
      [1, 800],
      [2, 700],
    ]);

    expect(resolveStage(2, 830, measure, cache)).toBe(1);
    expect(resolveStage(1, 924, measure, cache)).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });

  it('re-measures after the cache is cleared', () => {
    // Long labels: what the cache remembers keeps stage 2 at 1000 px.
    const cache = new Map<ViewBarStage, number>([
      [0, 1100],
      [1, 1050],
      [2, 700],
    ]);
    const measure = measureOf([800, 750, 700, 650]);
    expect(resolveStage(2, 1000, measure, cache)).toBe(2);
    expect(measure).not.toHaveBeenCalled();

    // The labels got shorter (a new dataset): the hook clears the cache, the stages are measured
    // again, and the bar steps back up.
    cache.clear();
    expect(resolveStage(2, 1000, measure, cache)).toBe(0);
    expect(measure.mock.calls.map(([stage]) => stage)).toEqual([2, 1, 0]);
  });

  it('never loops more than four times', () => {
    // A measure that contradicts itself (stage 0 overflows, then fits, then overflows) with a
    // cache that keeps nothing would flip between stages 0 and 1 for ever without the cap.
    let calls = 0;
    const measure = vi.fn(() => (calls++ % 3 === 0 ? 2000 : 0));
    const forgetful = new Map<ViewBarStage, number>();
    forgetful.set = () => forgetful;

    expect(resolveStage(0, 1000, measure, forgetful, 0)).toBe(0);
    // Four steps (down, up, down, up): a step down measures once, a step up twice.
    expect(measure).toHaveBeenCalledTimes(6);
  });
});
```

- [ ] **Step 2: Write the failing status, view-bar-controller and data-renderer tests**

In `apps/web/src/explore/workbench-status.test.ts`:

1. Add `import { DENSITY_DEFAULT } from '@protspace/utils';` after the `vitest` import.
2. Task 2.2's two `toEqual` comparisons of the whole status ("starts empty" and "merges a patch and notifies once", which Task 2.6 extended with `appliedFilterConditions: 0`) each gain `densityLayer: 'off'`, so they read:

```ts
    expect(getWorkbenchStatus()).toEqual({
      datasetName: null,
      proteinCount: null,
      appliedFilterConditions: 0,
      densityLayer: 'off',
    });
```

```ts
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'demo.parquetbundle',
      proteinCount: 12,
      appliedFilterConditions: 0,
      densityLayer: 'off',
    });
```

3. Append inside the `describe` block:

```ts
  it("densityLayer starts at the plot's default mode", () => {
    expect(getWorkbenchStatus().densityLayer).toBe(DENSITY_DEFAULT);
    setWorkbenchStatus({ densityLayer: 'auto' });
    expect(getWorkbenchStatus().densityLayer).toBe('auto');
  });
```

In `apps/web/src/explore/view-bar-controller.test.ts`:

1. Change `import { describe, expect, it, vi } from 'vitest';` to `import { beforeEach, describe, expect, it, vi } from 'vitest';`.
2. Add `import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';` after `import { createViewBarController, deriveViewOptions } from './view-bar-controller';`.
3. Append at the end of the file:

```ts
describe('view-bar controller status', () => {
  beforeEach(() => {
    resetWorkbenchStatusForTests();
  });

  it('reports the contour mode to the workbench status', () => {
    const m = setup();

    m.contoursMenu.dispatchEvent(
      new CustomEvent('density-layer-change', { detail: { densityLayer: 'auto' } }),
    );
    expect(getWorkbenchStatus().densityLayer).toBe('auto');

    // A mode applied from the URL, then a new dataset's view: the menu keeps its mode, and the
    // status reports what the menu shows. (Task 2.8's fake applySelection sets densityLayer,
    // as the element does.)
    m.controller.applyDensityLayerSelection('on');
    expect(getWorkbenchStatus().densityLayer).toBe('on');
    m.contoursMenu.densityLayer = 'auto';
    m.controller.showInitialView({ projection: 'UMAP', annotation: 'family', tooltip: [] });
    expect(getWorkbenchStatus().densityLayer).toBe('auto');
  });
});
```

In `apps/web/src/explore/data-renderer.test.ts`:

1. In `buildRenderer`, delete the line `      setRendering: vi.fn(),` from the default `controls` object, so it reads:

```ts
  function buildRenderer(
    controls: Parameters<typeof createDataRenderer>[0]['controls'] = {
      showInitialView: vi.fn(),
      clearStructure: vi.fn(),
    },
  ) {
```

2. Replace the test "a new dataset resets the controls and shows its initial view" (Task 2.5's) with:

```ts
  it('a new dataset resets the controls and shows its initial view', async () => {
    const calls: string[] = [];
    const { loadData } = buildRenderer({
      showInitialView: vi.fn((view: InitialView) =>
        calls.push(['view', view.projection, view.annotation, ...view.tooltip].join(' ')),
      ),
      clearStructure: vi.fn(() => calls.push('clear structure')),
    });

    const pending = loadData(datasetOf(10));
    await vi.runAllTimersAsync();
    await pending;

    // The controls show the new view without events, and the previous dataset's structure goes.
    expect(calls).toEqual(['view umap ec', 'clear structure']);
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/view-bar-overflow.test.ts src/explore/workbench-status.test.ts src/explore/view-bar-controller.test.ts src/explore/data-renderer.test.ts`
Expected: FAIL. `view-bar-overflow.test.ts`: `Failed to resolve import "./view-bar-overflow"`. `workbench-status.test.ts`: the two `toEqual` tests miss `densityLayer` and the new test reads `expected undefined to be 'off'`. `view-bar-controller.test.ts`: "reports the contour mode…" reads `expected undefined to be 'auto'`. `data-renderer.test.ts`: every `loadData` case throws `TypeError: controls.setRendering is not a function`.

- [ ] **Step 4: Write the stage resolver**

Create `apps/web/src/workbench/view-bar-overflow.ts`:

```ts
/**
 * The view bar's stages (design decision 1). The bar keeps one 44 px row by giving up width in
 * steps instead of wrapping: 0 shows everything; 1 hides the keys "Projection", "Color by" and
 * "Contours" (they stay in the accessible names); 2 moves Contours into the More menu; 3 moves
 * Filter there too. Projection, its details and Color by never move.
 */
export type ViewBarStage = 0 | 1 | 2 | 3;

const LAST_STAGE: ViewBarStage = 3;
/** The walk from stage 0 to 3 (or back) plus the check that ends it. */
const MAX_STEPS = 4;

/**
 * The stage for a bar `available` px wide, starting from `current`. It steps down while the
 * current stage's width exceeds `available`, and steps up only when the next lower stage's width
 * plus `hysteresis` fits, so a window resized around a threshold keeps its stage. `measure(stage)`
 * returns the width a stage needs; each width is kept in `cache` until the caller clears it (an
 * item's own width changed), so a window resize measures nothing again. A stage the cache lacks is
 * measured once, which lets the bar step up again after a clear.
 */
export function resolveStage(
  current: ViewBarStage,
  available: number,
  measure: (stage: ViewBarStage) => number,
  cache: Map<ViewBarStage, number>,
  hysteresis = 24,
): ViewBarStage {
  const widthOf = (stage: ViewBarStage): number => {
    let width = cache.get(stage);
    if (width === undefined) {
      width = measure(stage);
      cache.set(stage, width);
    }
    return width;
  };

  let stage = current;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (widthOf(stage) > available) {
      if (stage === LAST_STAGE) break;
      stage = (stage + 1) as ViewBarStage;
    } else if (stage > 0 && widthOf((stage - 1) as ViewBarStage) + hysteresis <= available) {
      stage = (stage - 1) as ViewBarStage;
    } else {
      break;
    }
  }
  return stage;
}
```

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/view-bar-overflow.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Publish the contour mode**

In `apps/web/src/explore/workbench-status.ts`:

1. Add, as the first line of the file (above its doc comment):

```ts
import { DENSITY_DEFAULT, type DensityLayerMode } from '@protspace/utils';
```

2. In `interface WorkbenchStatus`, after the `appliedFilterConditions` field Task 2.6 added, add:

```ts
  /** The plot's contour mode, which the view bar's More menu shows once Contours moves there. */
  densityLayer: DensityLayerMode;
```

3. Add `densityLayer: DENSITY_DEFAULT` to the initial status object `EMPTY` (the object `resetWorkbenchStatusForTests()` restores), so it reads:

```ts
const EMPTY: WorkbenchStatus = {
  datasetName: null,
  proteinCount: null,
  appliedFilterConditions: 0,
  densityLayer: DENSITY_DEFAULT,
};
```

In `apps/web/src/explore/view-bar-controller.ts`:

1. Add `import { setWorkbenchStatus } from './workbench-status';` after `import type { ViewPickers } from './view-controller';`.
2. In `onDensityChange`, add the status write after the plot's config, so it reads:

```ts
  const onDensityChange = (event: Event) => {
    const { densityLayer } = (event as CustomEvent<DensityLayerChangeDetail>).detail;
    plotElement.config = { ...(plotElement.config ?? {}), densityLayer };
    setWorkbenchStatus({ densityLayer });
    onUserChange('density');
  };
```

3. In the returned object, replace `applyDensityLayerSelection` and `showInitialView` with:

```ts
    applyDensityLayerSelection(mode) {
      contoursMenu.applySelection(mode);
      setWorkbenchStatus({ densityLayer: mode });
    },
    showInitialView(view) {
      projectionSelect.selectedProjection = view.projection;
      annotationSelect.selectedProjection = view.projection;
      annotationSelect.selectedAnnotation = view.annotation;
      annotationSelect.tooltipAnnotations = [...view.tooltip];
      syncProjectionDetails();
      // A dataset keeps the contour mode; the More menu reads it from the status.
      setWorkbenchStatus({ densityLayer: contoursMenu.densityLayer });
    },
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/workbench-status.test.ts src/explore/view-bar-controller.test.ts`
Expected: PASS: `workbench-status.test.ts` one test more than after Task 2.6, `view-bar-controller.test.ts` 12 tests.

- [ ] **Step 6: Drop `setRendering` from the controls seam**

In `apps/web/src/explore/explore-controls.ts`, delete the member and its comment:

```ts
  /** True while the renderer swaps the plot's data, when the controls must not sync from it. */
  setRendering(rendering: boolean): void;
```

and replace the interface's doc comment

```ts
/**
 * The dataset pipeline's one seam to the controls (design decision 9). `dataset-controller.ts` and
 * `data-renderer.ts` reset and fill the controls only through this, and `runtime.ts` builds the one
 * implementation, which changes as the control bar is split while the pipeline does not.
 */
```

with:

```ts
/**
 * The dataset pipeline's one seam to the controls (design decision 9). `dataset-controller.ts` and
 * `data-renderer.ts` reset and fill the controls only through this; `runtime.ts` builds it from
 * the view-bar, filter and selection controllers.
 */
```

In `apps/web/src/explore/data-renderer.ts`:

1. In `DataRendererOptions`, replace `  controls: Pick<ExploreControls, 'showInitialView' | 'setRendering' | 'clearStructure'>;` with:

```ts
  controls: Pick<ExploreControls, 'showInitialView' | 'clearStructure'>;
```

2. In `loadData`, delete the line `    controls.setRendering(true);` (after `console.log('Updating scatterplot with new data...');`) and the line `    controls.setRendering(false);` with the blank line after it (after the two `await yieldToBrowser();` calls, which stay: they keep today's frame timing).
3. Replace the comment

```ts
  // Synthesized `__eat_confidence` annotations are filter-only (see control-bar's
  // color-by/filterable split) — never auto-selected as the default color-by annotation.
```

with:

```ts
  // Synthesized `__eat_confidence` annotations are filter-only (Color by never offers them, see
  // `deriveViewOptions` in view-bar-controller.ts), so never the default color-by annotation.
```

In `apps/web/src/explore/dataset-controller.fixtures.ts`, delete `      setRendering: vi.fn(),` from the `controls` object of `buildControllerOptions`.

In `apps/web/src/explore/dataset-controller.eat.test.ts`, delete `    setRendering: vi.fn(),` from the object `createControls()` returns.

In `apps/web/src/explore/runtime.ts`, in the `ExploreControls` object (`const controls: ExploreControls = { … }`):

1. Delete the method Task 2.9 left empty:

```ts
    setRendering() {
      // Nothing to hold while a dataset renders: the controllers write the plot only on picks.
      // Task 2.10 removes the method.
    },
```

2. Replace its comment

```ts
  // The dataset pipeline's one seam to the controls (explore-controls.ts). Until the control bar
  // is split up, most of it is still the control bar.
```

with:

```ts
  // The dataset pipeline's one seam to the controls (explore-controls.ts).
```

- [ ] **Step 7: Run the app's unit tests**

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; against Task 2.9's counts: `view-bar-overflow.test.ts` added (5), `workbench-status.test.ts` +1, `view-bar-controller.test.ts` +1, `data-renderer.test.ts` unchanged in count.

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors (core's `dist` still has the control bar; nothing here uses it).

- [ ] **Step 8: Write the failing e2e tests and teach the helpers about More**

In `apps/web/tests/helpers/explore.ts`, add directly above `setContours` (below Task 2.8's `CONTOUR_MENU_LABELS`):

```ts
/** The view bar's More button; its name reads "More view options" (", N active" with its dot). */
function moreButton(page: Page): Locator {
  return viewBar(page).getByRole('button', { name: /^More view options/ });
}
```

and replace the bodies of `setContours` and `openFilter` (keep their exported names and signatures):

```ts
/**
 * Sets the contour mode through the view bar's Contours menu, or through More while Contours sits
 * there, and waits until the plot shows it.
 */
export async function setContours(page: Page, mode: 'off' | 'auto' | 'on'): Promise<void> {
  await waitForExploreInteractionReady(page);
  const contours = viewBar(page).getByRole('button', { name: /^Contours/ });
  if (await contours.isVisible()) {
    await contours.click();
    await page
      .locator('protspace-contours-menu')
      .getByRole('menuitemradio', { name: new RegExp(`^${CONTOUR_MENU_LABELS[mode]}`) })
      .click();
  } else {
    await moreButton(page).click();
    await page
      .locator('#wb-more-menu')
      .getByRole('menuitemradio', { name: CONTOUR_MENU_LABELS[mode], exact: true })
      .click();
  }
  await page.waitForFunction(
    (expected) =>
      (
        document.querySelector('#myPlot') as
          | (Element & { config?: { densityLayer?: string } })
          | null
      )?.config?.densityLayer === expected,
    mode,
    { timeout: 10_000 },
  );
}
```

```ts
/** Opens the Filter dialog, from the view bar or from More, unless it is open already. */
export async function openFilter(page: Page): Promise<void> {
  await waitForExploreInteractionReady(page);
  const dialog = filterDialog(page);
  if (await dialog.isVisible().catch(() => false)) return;
  if (await filterButton(page).isVisible()) {
    await filterButton(page).click();
  } else {
    await moreButton(page).click();
    await page.locator('#wb-more-menu').getByRole('menuitem', { name: 'Filter…' }).click();
  }
  await expect(dialog).toBeVisible();
}
```

In `apps/web/tests/workbench-view-bar.spec.ts`:

1. Replace the first line `import { expect, test } from '@playwright/test';` with `import { expect, test, type Page } from '@playwright/test';`, and add `filterButton`, `filterDialog`, `getContoursMode` and `openFilter` to the `./helpers/explore` import, so it reads:

```ts
import {
  appBar,
  expectUrlParam,
  filterButton,
  filterDialog,
  getColorByOptions,
  getContoursMode,
  getViewState,
  openExplore,
  openFilter,
  projectionTrigger,
  selectAnnotation,
  selectProjection,
  setContours,
  viewBar,
} from './helpers/explore';
```

2. Append at the end of the file:

```ts
/** Lets the view bar's ResizeObserver and the frame it schedules run after a resize. */
async function settle(page: Page): Promise<void> {
  // The window takes the new width first; then the observer, the hook's frame and its write.
  const width = page.viewportSize()!.width;
  await page.waitForFunction((w) => window.innerWidth === w, width);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}

async function readStage(page: Page): Promise<number> {
  return Number(await viewBar(page).getAttribute('data-stage'));
}

/**
 * The stage after the window narrows from 1280 px to `width` px. Narrowing from a wide window
 * gives the first stage that fits, whatever the stage was before, so it only grows as `width`
 * shrinks.
 */
async function stageWhenNarrowedTo(page: Page, width: number): Promise<number> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle(page);
  await page.setViewportSize({ width, height: 720 });
  await settle(page);
  return readStage(page);
}

/** The widest window, to the pixel, at which narrowing reaches `stage` or a later one. */
async function widestAtStage(page: Page, stage: number): Promise<number> {
  let below = 1280; // narrowing to this width stays under `stage`
  let reached = 320; // narrowing to this width reaches it
  expect(await stageWhenNarrowedTo(page, below)).toBeLessThan(stage);
  expect(await stageWhenNarrowedTo(page, reached)).toBeGreaterThanOrEqual(stage);
  while (below - reached > 1) {
    const middle = Math.floor((below + reached) / 2);
    if ((await stageWhenNarrowedTo(page, middle)) >= stage) reached = middle;
    else below = middle;
  }
  return reached;
}

const moreButton = (page: Page) =>
  viewBar(page).getByRole('button', { name: /^More view options/ });
const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More view options' });
/** The More menu's host: its items are its light-DOM children. */
const moreItems = (page: Page) => page.locator('#wb-more-menu');

test.describe('view bar stages', () => {
  test('the view bar is 44 px, one row and does not overflow at 1440, 1280, 1024 and 951 px', async ({
    page,
  }) => {
    await openExplore(page);
    for (const width of [1440, 1280, 1024, 951]) {
      await page.setViewportSize({ width, height: 720 });
      await settle(page);
      const bar = await viewBar(page).evaluate((element) => {
        const box = element.getBoundingClientRect();
        const items = Array.from(element.children)
          .filter((child) => child.getClientRects().length > 0)
          .map((child) => child.getBoundingClientRect());
        const centres = items.map((item) => item.top + item.height / 2);
        return {
          height: box.height,
          right: box.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          itemsRight: Math.max(...items.map((item) => item.right)),
          centreSpread: Math.max(...centres) - Math.min(...centres),
        };
      });
      expect(bar.height, `${width} px`).toBe(44);
      expect(bar.centreSpread, `${width} px: one row`).toBeLessThanOrEqual(1);
      expect(bar.scrollWidth, `${width} px`).toBeLessThanOrEqual(bar.clientWidth);
      expect(bar.itemsRight, `${width} px`).toBeLessThanOrEqual(bar.right);
      // Projection and Color by never leave the bar.
      await expect(projectionTrigger(page)).toBeVisible();
      await expect(viewBar(page).getByRole('button', { name: /^Color by/ })).toBeVisible();
      // The plot starts under the 48 px app bar and the 44 px view bar at every stage.
      expect((await page.locator('#myPlot').boundingBox())!.y, `${width} px`).toBe(92);
    }
  });

  test('narrowing moves Contours, then Filter, into More, and widening brings them back', async ({
    page,
  }) => {
    await openExplore(page);
    // "Always" is the widest contour value, so moving Contours into More frees the most room.
    await setContours(page, 'on');
    const contours = viewBar(page).getByRole('button', { name: /^Contours/ });

    const contoursOut = await widestAtStage(page, 2);
    expect(await stageWhenNarrowedTo(page, contoursOut)).toBe(2);
    await expect(contours).toBeHidden();
    await expect(filterButton(page)).toBeVisible();
    await moreButton(page).click();
    await expect(moreMenu(page)).toBeVisible();
    await expect(moreItems(page).getByRole('group', { name: 'Contours' })).toBeVisible();
    await expect(moreItems(page).getByRole('menuitemradio')).toHaveText(['Off', 'Auto', 'Always']);
    await expect(
      moreItems(page).getByRole('menuitemradio', { name: 'Always', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(moreItems(page).getByRole('menuitem', { name: 'Filter…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).toBeHidden();

    const filterOut = await widestAtStage(page, 3);
    expect(filterOut).toBeLessThan(contoursOut);
    expect(await stageWhenNarrowedTo(page, filterOut)).toBe(3);
    await expect(filterButton(page)).toBeHidden();
    // Filter… in More opens the same dialog, which hands focus back to More.
    await openFilter(page);
    await page.keyboard.press('Escape');
    await expect(filterDialog(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();

    await page.setViewportSize({ width: 1280, height: 720 });
    await settle(page);
    expect(await readStage(page)).toBe(0);
    await expect(contours).toBeVisible();
    await expect(filterButton(page)).toBeVisible();
    await expect(moreButton(page)).toBeHidden();
  });

  test('a window jittering ±4 px around a threshold keeps its stage', async ({ page }) => {
    await openExplore(page);
    const threshold = await widestAtStage(page, 1);
    // A threshold indeed: narrowing to four pixels wider keeps every label.
    expect(await stageWhenNarrowedTo(page, threshold + 4)).toBe(0);

    expect(await stageWhenNarrowedTo(page, threshold)).toBe(1);
    for (const width of [
      threshold + 4,
      threshold - 4,
      threshold + 4,
      threshold - 4,
      threshold + 4,
    ]) {
      await page.setViewportSize({ width, height: 720 });
      await settle(page);
      expect(await readStage(page), `${width} px`).toBe(1);
    }
  });

  test('More shows a dot with contours on, and Auto there sets density=auto in the URL', async ({
    page,
  }) => {
    await openExplore(page);
    expect(await stageWhenNarrowedTo(page, await widestAtStage(page, 2))).toBeGreaterThanOrEqual(2);
    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(page.locator('.wb-more-dot')).toBeHidden();

    // Contours is not in the bar at this width, so the helper picks Auto in More.
    await setContours(page, 'auto');
    await expectUrlParam(page, 'density', 'auto');
    await expect.poll(() => getContoursMode(page)).toBe('auto');
    await expect(moreButton(page)).toHaveAccessibleName('More view options, 1 active');
    await expect(page.locator('.wb-more-dot')).toBeVisible();
  });

  test('More opens with Enter and Escape returns focus to it', async ({ page }) => {
    await openExplore(page);
    expect(await stageWhenNarrowedTo(page, await widestAtStage(page, 2))).toBeGreaterThanOrEqual(2);

    await moreButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(moreMenu(page)).toBeVisible();
    // The menu opens on the checked contour mode.
    await expect(
      moreItems(page).getByRole('menuitemradio', { name: 'Off', exact: true }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
  });
});
```

- [ ] **Step 9: Run them to see them fail**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-view-bar.spec.ts` (sandbox disabled)
Expected: the four tests from Task 2.8 pass. Of the five new ones, "the view bar is 44 px…" may already pass (the bar has been 44 px tall since Task 2.9 emptied the control bar; the test pins it), and the four others FAIL in `widestAtStage`: the bar has no `data-stage`, so `readStage` reads 0 at 320 px and `expect(received).toBeGreaterThanOrEqual(1)` (or `2`) fails.

- [ ] **Step 10: Delete the control bar from core**

```bash
rm packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar.styles.ts \
  packages/core/src/components/control-bar/control-bar.events.ts \
  packages/core/src/components/control-bar/control-bar-helpers.ts \
  packages/core/src/components/control-bar/control-bar-helpers.test.ts \
  packages/core/src/components/control-bar/styles/layout.ts \
  packages/core/src/components/control-bar/styles/responsive.ts
```

If `packages/core/src/components/control-bar/styles/export.ts` still exists (Task 2.5 deletes it), delete it too. Then:

```bash
rmdir packages/core/src/components/control-bar/styles
ls packages/core/src/components/control-bar | grep '^control-bar'
```

Expected: no output. If a `control-bar.*.test.ts` is listed (Tasks 2.5–2.9 delete `control-bar.import-menu`, `.query-apply`, `.density-layer`, `.after-paint`, `.events` and `.auto-sync`), delete it as well: the element it tests is gone.

In `packages/core/src/index.ts`:

1. Delete the line

```ts
export { ProtspaceControlBar } from './components/control-bar/control-bar'; // Explicit export for value access
```

(Task 2.7's `// The view bar's pickers (design decision 9).` block below it stays).

2. Delete the block

```ts
export type {
  SelectionDisabledNotificationContext,
  SelectionDisabledNotificationDetail,
} from './components/control-bar/control-bar.events';
```

3. At the end of Task 2.7's `// The view bar's pickers (design decision 9).` block, add (core's build keeps `@protspace/utils` external, so this is a re-export, not a copy):

```ts
export { DENSITY_MODE_LABELS } from '@protspace/utils';
```

In `packages/core/src/styles/mixins.ts`, delete `iconMixin` (its only consumer was `control-bar.styles.ts`): the block from

```ts
/**
 * Icon Styling
 * Consistent icon sizing and appearance
 */
export const iconMixin = css`
```

through its closing `` `; `` and the blank line after it.

In `packages/core/src/components/control-bar/types.ts`, replace the header comment

```ts
/**
 * Control bar-related type definitions
 */
```

with:

```ts
/**
 * The dataset shape the annotation select, the search and the query builder read. The control bar
 * these types served is gone (design decision 9); 4.4, 4.5 and 4.11 move these modules out of
 * `control-bar/`.
 */
```

and check that only `ProtspaceData` is left: `grep -n "^export" packages/core/src/components/control-bar/types.ts` prints exactly `export interface ProtspaceData {` (Tasks 2.5 and 2.9 removed the rest; delete any other export that is still there if nothing in `packages/core/src` imports it).

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: FAIL, 3 tests: `../components/control-bar/control-bar.styles.ts no longer exists; delete it from LEGACY`, and the same for `styles/layout.ts` and `styles/responsive.ts`.

- [ ] **Step 11: Drop their LEGACY lines and build core**

In `packages/core/src/styles/style-lint.test.ts`, delete these lines from `LEGACY` (and `'../components/control-bar/styles/export.ts',` if Task 2.5 left it):

```ts
  '../components/control-bar/control-bar.styles.ts',
  '../components/control-bar/styles/layout.ts',
  '../components/control-bar/styles/responsive.ts',
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: PASS.

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS; against Task 2.9's counts: unit files −1 (`control-bar-helpers.test.ts`, its 8 selection-helper tests), style lint −3 cases (the three LEGACY checks); browser files unchanged.

Run: `pnpm --filter @protspace/core type-check && pnpm --filter @protspace/core build`
Expected: no errors; `dist/` rebuilt without `protspace-control-bar`.

- [ ] **Step 12: Remove the control bar from the app**

In `apps/web/src/explore/elements.ts`:

- delete `  ProtspaceControlBar,` from the `import type { … } from '@protspace/core'` list;
- delete `  controlBar: ProtspaceControlBar;` from `interface ExploreElements`;
- delete `  'protspace-control-bar',` from `REQUIRED_TAGS` (core no longer defines it, so `waitForElements` would wait for ever);
- in `getElements`, delete `  const controlBar = doc.getElementById('myControlBar') as ProtspaceControlBar | null;`, remove `!controlBar` (with its `||`) from the missing-element condition, and delete `controlBar,` from the `console.error` object and from the returned object.

In `apps/web/src/custom-elements.d.ts`, delete the whole entry

```ts
      'protspace-control-bar': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          id?: string;
          'selected-projection'?: string;
          'selected-annotation'?: string;
          'selected-proteins-count'?: string;
          'auto-sync'?: string;
          'scatterplot-selector'?: string;
          'data-driver-id'?: string;
        },
        HTMLElement
      >;
```

In `apps/web/src/tour/product-tour.ts`, replace the header comment's last paragraph

```ts
 * For elements inside Shadow DOM (e.g. inside <protspace-control-bar>) we
 * use the `() => Element` function form supported by driver.js, which
 * resolves the element lazily at step-activation time.
```

with:

```ts
 * For elements inside Shadow DOM (the legend's "Other" row) we use the
 * `() => Element` function form supported by driver.js, which resolves the
 * element lazily at step-activation time.
```

(`shadowEl`, `cleanupShadowElement` and `shadowStep` stay: step 9 uses them for the legend.)

In `apps/web/tests/url-view-state.spec.ts`, in the deep-link test's `addInitScript`, replace

```ts
      // The elements that show the view, and the view property each one shows. The control bar
      // shows both until the view bar's pickers replace it (Tasks 2.8 and 2.10); a tag that is
      // not defined is simply never patched.
      const recorded: Record<string, Array<'selectedAnnotation' | 'selectedProjection'>> = {
        'protspace-control-bar': ['selectedAnnotation', 'selectedProjection'],
        'protspace-annotation-select': ['selectedAnnotation'],
        'protspace-projection-select': ['selectedProjection'],
      };
```

with:

```ts
      // The view bar's pickers, and the view property each one shows.
      const recorded: Record<string, Array<'selectedAnnotation' | 'selectedProjection'>> = {
        'protspace-annotation-select': ['selectedAnnotation'],
        'protspace-projection-select': ['selectedProjection'],
      };
```

- [ ] **Step 13: Write the stage hook and the More menu**

Create `apps/web/src/workbench/use-view-bar-stage.ts`:

```ts
import { type RefObject, useEffect, useState } from 'react';
import { getWorkbenchStatus, subscribeWorkbenchStatus } from '../explore/workbench-status';
import { resolveStage, type ViewBarStage } from './view-bar-overflow';

/** The bar's children whose own width the stages depend on (workbench.css never shrinks them). */
const ITEM_SELECTOR = '[data-view-item]';
/** Sub-pixel layout noise is no change of width. */
const EPSILON = 0.5;

/**
 * The width the bar's content needs at the stage it shows now: from the bar's left edge to the
 * right margin edge of its last visible child, plus the right padding. The items never shrink, so
 * this is the stage's own width even while it overflows. Children without a box (display: none,
 * or display: contents such as ps-dialog and ps-menu) do not count.
 */
function contentWidth(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const left = bar.getBoundingClientRect().left;
  let end = left + (parseFloat(style.paddingLeft) || 0);
  for (const child of Array.from(bar.children)) {
    if (child.getClientRects().length === 0) continue;
    const marginRight = parseFloat(getComputedStyle(child).marginRight) || 0;
    end = Math.max(end, child.getBoundingClientRect().right + marginRight);
  }
  return Math.ceil(end - left + (parseFloat(style.paddingRight) || 0));
}

/**
 * The view bar's stage (view-bar-overflow.ts) for the bar in `barRef`. One ResizeObserver watches
 * the bar and its items; their callbacks only take note, and the measuring runs once in the next
 * animation frame, where showing a candidate stage (data-stage) and reading its width is safe. A
 * stage's width is measured once and cached; a change in an item's own width (a new dataset's
 * names, another contour mode) or the web font arriving clears the cache.
 */
export function useViewBarStage(barRef: RefObject<HTMLElement | null>): ViewBarStage {
  const [stage, setStage] = useState<ViewBarStage>(0);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const cache = new Map<ViewBarStage, number>();
    const itemWidths = new WeakMap<Element, number>();
    let current: ViewBarStage = 0;
    let frame = 0;
    let stale = false;
    let disposed = false;

    const show = (next: ViewBarStage) => {
      if (bar.dataset.stage !== String(next)) bar.dataset.stage = String(next);
    };
    const measure = (candidate: ViewBarStage) => {
      show(candidate);
      return contentWidth(bar);
    };

    const resolve = () => {
      frame = 0;
      if (disposed) return;
      if (stale) {
        cache.clear();
        stale = false;
      }
      const next = resolveStage(current, bar.clientWidth, measure, cache);
      show(next);
      // The widths at the stage on screen, which the observer compares against.
      for (const item of Array.from(bar.querySelectorAll(ITEM_SELECTOR))) {
        itemWidths.set(item, item.getBoundingClientRect().width);
      }
      if (next !== current) {
        current = next;
        setStage(next);
      }
    };
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(resolve);
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === bar) continue;
        const width = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
        const known = itemWidths.get(entry.target);
        if (known === undefined || Math.abs(width - known) > EPSILON) stale = true;
      }
      schedule();
    });
    observer.observe(bar);
    for (const item of Array.from(bar.querySelectorAll(ITEM_SELECTOR))) {
      observer.observe(item, { box: 'border-box' });
    }

    // Inter replaces the fallback font after the first measure and changes every width.
    void document.fonts.ready.then(() => {
      stale = true;
      schedule();
    });

    // Contours hidden in More reports no width; its value still changes the lower stages' widths.
    let densityLayer = getWorkbenchStatus().densityLayer;
    const unsubscribe = subscribeWorkbenchStatus(() => {
      const next = getWorkbenchStatus().densityLayer;
      if (next === densityLayer) return;
      densityLayer = next;
      stale = true;
      schedule();
    });
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
    };
  }, [barRef]);

  return stage;
}
```

Create `apps/web/src/workbench/MoreMenu.tsx`:

```tsx
import type { ProtspaceContoursMenu, PsMenu } from '@protspace/core';
import { DENSITY_LAYER_MODES, DENSITY_MODE_LABELS, type DensityLayerMode } from '@protspace/utils';
import { Ellipsis } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
 * The view bar's More menu (design decision 1): from stage 2 it offers the contour modes, at
 * stage 3 Filter too. A pick goes through the inline control, which stays mounted while hidden:
 * the contours menu's pick() (shown at once, applied after the paint) or a click on the Filter
 * button, which the runtime wires to the filter controller. A dot marks an active item inside.
 */
export function MoreMenu({ stage }: { stage: ViewBarStage }) {
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  const contoursInside = stage >= 2;
  const filterInside = stage === 3;
  const active =
    (contoursInside && densityLayer !== 'off' ? 1 : 0) +
    (filterInside && appliedFilterConditions > 0 ? 1 : 0);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      if (value === FILTER_VALUE) {
        // The menu has closed and handed focus back to More, so the dialog returns it there.
        document.getElementById('myFilterButton')?.click();
        return;
      }
      const mode = CONTOUR_MODES.find(
        (entry) => `${CONTOURS_PREFIX}${entry.mode}` === value,
      )?.mode;
      if (mode) {
        (document.getElementById('myContoursMenu') as ProtspaceContoursMenu | null)?.pick(mode);
      }
    };
    element.addEventListener('ps-select', onSelect);
    return () => element.removeEventListener('ps-select', onSelect);
  }, []);

  // Widened back below stage 2, the bar hides More: close its menu rather than leave it open on
  // a hidden anchor.
  useEffect(() => {
    if (stage < 2 && menu.current?.open) menu.current.open = false;
  }, [stage]);

  const toggle = () => {
    if (menu.current) menu.current.open = !menu.current.open;
  };

  return (
    <>
      <ps-button
        ref={trigger}
        className="wb-more"
        variant="ghost"
        data-view-item=""
        onClick={toggle}
      >
        <span slot="start" className="wb-icon" aria-hidden="true">
          <Ellipsis size={16} strokeWidth={1.75} />
        </span>
        More<span className="sr-only"> view options</span>
        {active > 0 && <span className="sr-only">, {active} active</span>}
        <span className="wb-more-dot" aria-hidden="true" hidden={active === 0}></span>
      </ps-button>
      <ps-menu ref={menu} id="wb-more-menu" label="More view options">
        {contoursInside && (
          <ps-menu-group label="Contours">
            {CONTOUR_MODES.map(({ mode, label }) => (
              <ps-menu-item
                key={mode}
                type="radio"
                value={`${CONTOURS_PREFIX}${mode}`}
                checked={mode === densityLayer}
              >
                {label}
              </ps-menu-item>
            ))}
          </ps-menu-group>
        )}
        {filterInside && <ps-menu-item value={FILTER_VALUE}>Filter…</ps-menu-item>}
      </ps-menu>
    </>
  );
}
```

- [ ] **Step 14: Rebuild the view bar**

Replace the whole of `apps/web/src/workbench/ViewBar.tsx` with:

```tsx
import { memo, useRef } from 'react';
import { FilterControl } from './FilterControl';
import { MoreMenu } from './MoreMenu';
import { useViewBarStage } from './use-view-bar-stage';

/**
 * How the plot is drawn (design decision 1): Projection with its details and Color by, Contours,
 * then Filter, in one 44 px row. Near its width limit the bar gives up room in stages
 * (view-bar-overflow.ts): the keys hide, then Contours and then Filter move into More. A stage is
 * only data-stage and CSS: every runtime element stays mounted where it is. Memoised and without
 * props: only its own stage renders it again.
 */
export const ViewBar = memo(function ViewBar() {
  const bar = useRef<HTMLDivElement>(null);
  const stage = useViewBarStage(bar);
  return (
    <div ref={bar} role="toolbar" aria-label="View" data-workbench="view-bar" data-stage={stage}>
      <div className="wb-view-group" data-driver-id="projections" data-view-item="">
        <protspace-projection-select id="myProjectionSelect"></protspace-projection-select>
        <protspace-projection-metadata id="myProjectionMetadata"></protspace-projection-metadata>
        <protspace-annotation-select id="myAnnotationSelect"></protspace-annotation-select>
      </div>
      <protspace-contours-menu id="myContoursMenu" data-view-item=""></protspace-contours-menu>
      <span className="wb-view-sep" aria-hidden="true"></span>
      <FilterControl />
      <MoreMenu stage={stage} />
    </div>
  );
});
```

In `apps/web/src/workbench/FilterControl.tsx`, give the Filter button the measuring hook: replace `      <ps-button id="myFilterButton" variant="ghost">` with:

```tsx
      <ps-button id="myFilterButton" variant="ghost" data-view-item="">
```

and in its doc comment replace `They are siblings, so the view bar can hide the button without hiding the dialog.` with `They are siblings, so the view bar can hide the button (stage 3, Filter in More) without hiding the dialog.`.

In `apps/web/src/workbench/workbench.css`:

1. In the `.workbench` rule, replace `  --wb-view-bar-min-height: 44px;` with `  --wb-view-bar-height: 44px;`.
2. Replace Task 2.2's view-bar rule and the control-bar rule after it, from

```css
[data-workbench='view-bar'] {
  display: flex;
  flex: none;
  align-items: center;
  min-height: var(--wb-view-bar-min-height);
  border-bottom: 1px solid var(--ps-border);
  background: var(--ps-surface);
}
```

through the closing `}` of `#myControlBar { … }` (with its comment `/* The control bar fills the view bar until Tasks 2.5–2.10 split it. */`), with:

```css
/* One 44 px row that never wraps (border included). Items start at the left, 4 px apart, as in
   the mockup; the scale has no 10 px step. */
[data-workbench='view-bar'] {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--ps-space-1);
  height: var(--wb-view-bar-height);
  padding: 0 var(--ps-space-2) 0 10px;
  border-bottom: 1px solid var(--ps-border);
  background: var(--ps-surface);
}
```

3. Append at the end of the file:

```css
/* ── View bar stages (Task 2.10) ──────────────────────────────────────────────
   use-view-bar-stage.ts measures the items and sets data-stage on the bar: 0 full; 1 the keys
   hide (they stay in the accessible names); 2 Contours moves into More; 3 Filter does too. Items
   never shrink, so a measured width is the width the stage needs. */
[data-workbench='view-bar'] > * {
  flex: none;
}

[data-workbench='view-bar']:not([data-stage='0']) #myProjectionSelect::part(key),
[data-workbench='view-bar']:not([data-stage='0']) #myAnnotationSelect::part(key),
[data-workbench='view-bar']:not([data-stage='0']) #myContoursMenu::part(key) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

[data-workbench='view-bar']:is([data-stage='2'], [data-stage='3']) #myContoursMenu,
[data-workbench='view-bar'][data-stage='3'] #myFilterButton,
[data-workbench='view-bar']:is([data-stage='0'], [data-stage='1']) .wb-more {
  display: none;
}

/* The dot sits over the button's corner, so showing it never changes the bar's width. */
.wb-more {
  position: relative;
}

.wb-more-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: var(--ps-radius-full);
  background: var(--ps-accent);
}
```

- [ ] **Step 15: Type-check, test and check that nothing names the control bar**

Run: `pnpm --filter @protspace/app type-check && pnpm --filter @protspace/app exec vitest --run`
Expected: no type errors; every app test passes, as in Step 7.

Run: `grep -rn "protspace-control-bar\|myControlBar" packages/core/src apps/web/src apps/web/tests docs/developers`
Expected: only lines in `docs/developers/` (Step 17 rewrites them). If a line in `packages/core/src`, `apps/web/src` or `apps/web/tests` is printed (a comment an earlier task left, such as one naming `protspace-control-bar`'s `applyProjectionSelection`), reword it to name the element that replaced it (`protspace-projection-select`, `protspace-annotation-select`, `protspace-contours-menu`) and run the grep again.

- [ ] **Step 16: Run the view-bar spec**

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e apps/web/tests/workbench-view-bar.spec.ts` (sandbox disabled)
Expected: PASS, 9 tests.

- [ ] **Step 17: Update the developer docs**

In `docs/developers/api/index.md`:

1. In the Components table, replace the row

```markdown
| [Control Bar](#control-bar)           | `<protspace-control-bar>`      | Projection/annotation selection  |
```

with:

```markdown
| [Projection Select](#projection-select)     | `<protspace-projection-select>`   | Projection picker                       |
| [Annotation Select](#annotation-select)     | `<protspace-annotation-select>`   | Color by and tooltip annotations        |
| [Contours Menu](#contours-menu)             | `<protspace-contours-menu>`       | Density contour mode                    |
| [Projection Metadata](#projection-metadata) | `<protspace-projection-metadata>` | Details of the projection on screen     |
| [Protein Search](#protein-search)           | `<protspace-protein-search>`      | Find and select proteins by ID          |
| [Query Builder](#query-builder)             | `<protspace-query-builder>`       | Filter conditions                       |
| [Import Menu](#import-menu)                 | `<protspace-import-menu>`         | Load a file or an example dataset       |
| [Export Menu](#export-menu)                 | `<protspace-export-menu>`         | Image, ID and Parquet export            |
| [Plot Tools](#plot-tools)                   | `<protspace-plot-tools>`          | Move, box and lasso tools; Clear, Isolate, Reset |
```

2. In the Scatterplot's Configuration paragraph, replace the lines

```markdown
few points are visible, and `'on'` draws them at full strength at every zoom. The control bar labels
`'on'` as Always. When the context cannot draw them, the plot emits `renderer-degraded` once, with
`context.reason` set to `density-unavailable`, and keeps drawing the points.
```

with:

```markdown
few points are visible, and `'on'` draws them at full strength at every zoom. The Contours menu
labels `'on'` as Always (`DENSITY_MODE_LABELS`, from `@protspace/utils`). When the context cannot draw them, the plot emits
`renderer-degraded` once, with `context.reason` set to `density-unavailable`, and keeps drawing the
points.
```

3. Replace everything from the line `## Control Bar` up to, not including, the line `## Structure Viewer` with:

````markdown
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

| Property             | Type                | Description                                                 |
| -------------------- | ------------------- | ----------------------------------------------------------- |
| `projections`        | `readonly string[]` | Projection names to offer; JavaScript-only                  |
| `selectedProjection` | `string`            | Projection shown in the trigger; `selected-projection`      |

Methods: `applySelection(projection)`, `cancelPending()`.

| Event               | Detail           | Description          |
| ------------------- | ---------------- | -------------------- |
| `projection-change` | `{ projection }` | Projection changed   |

### Annotation Select

"Color by": the annotation that colours the plot, in a searchable list that also pins extra
annotations into the plot tooltip.

| Property                | Type                                        | Description                                                    |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `annotations`           | `string[]`                                  | Annotations offered for colouring                              |
| `annotationDefinitions` | `Record<string, Pick<Annotation, 'runtime'>>` | The dataset's annotation definitions                         |
| `eatAnnotations`        | `string[]`                                  | Annotations that carry EAT predictions                         |
| `selectedAnnotation`    | `string`                                    | Colouring annotation; `selected-annotation`                    |
| `tooltipAnnotations`    | `string[]`                                  | Annotations pinned into the plot tooltip                       |
| `statisticsRows`        | `readonly ProjectionStatisticRow[]`         | The bundle's optional statistics, read for `selectedProjection` |
| `selectedProjection`    | `string`                                    | Projection the statistics are read for; `selected-projection`  |
| `label`                 | `string`                                    | Key shown before the value, default `'Color by'`               |
| `placeholder`           | `string`                                    | Shown while nothing is selected                                |

Methods: `applySelection(annotation)`, `applyTooltipSelection(names)`, `cancelPending()`.

| Event                        | Detail                   | Description                    |
| ---------------------------- | ------------------------ | ------------------------------ |
| `annotation-change`          | `{ annotation }`         | Colouring annotation changed   |
| `tooltip-annotations-change` | `{ tooltipAnnotations }` | Tooltip annotation set changed |

Picking a tooltip extra as the colouring annotation fires `annotation-change`, then
`tooltip-annotations-change` without it.

### Contours Menu

| Property       | Type                      | Description                                        |
| -------------- | ------------------------- | -------------------------------------------------- |
| `densityLayer` | `'off' \| 'auto' \| 'on'` | Contour mode, default `'off'`; `density-layer`     |

Methods: `pick(mode)` (a user's pick made from code: shows at once, fires after the paint),
`applySelection(mode)` (no event), `cancelPending()`.

| Event                  | Detail             | Description           |
| ---------------------- | ------------------ | --------------------- |
| `density-layer-change` | `{ densityLayer }` | Contour mode changed  |

The detail type is `DensityLayerChangeDetail`. `DENSITY_MODE_LABELS` maps each mode to the menu's
label and hint, for hosts that offer the modes elsewhere; `'on'` reads "Always".

### Projection Metadata

An info button whose card describes the projection on screen. The host places it; the app puts it
beside the Projection picker.

| Property             | Type                                | Description                                                   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `projection`         | `Projection \| null`                | The projection on screen                                      |
| `statisticsRows`     | `readonly ProjectionStatisticRow[]` | The bundle's optional statistics                              |
| `selectedAnnotation` | `string`                            | Annotation the quality section is scored on; `selected-annotation` |
| `viewIsSubset`       | `boolean`                           | The plot shows a filtered or isolated subset                  |

### Protein Search

| Property              | Type       | Description                     |
| --------------------- | ---------- | ------------------------------- |
| `availableProteinIds` | `string[]` | IDs it suggests                 |
| `selectedProteinIds`  | `string[]` | The selection, shown as chips   |

⌘K (Ctrl+K elsewhere) focuses it, and pasting several IDs selects them all. It writes nothing to
the plot: set `plot.selectedProteinIds` and `search.selectedProteinIds` from its events.

| Event                    | Detail           | Description                 |
| ------------------------ | ---------------- | --------------------------- |
| `selection-change`       | `{ proteinIds }` | Replace the selection       |
| `add-selection`          | `{ proteinId }`  | Add one protein             |
| `add-selection-multiple` | `{ proteinIds }` | Add several proteins        |
| `remove-selection`       | `{ proteinId }`  | Remove one protein          |

### Query Builder

| Property      | Type                         | Description                                                           |
| ------------- | ---------------------------- | --------------------------------------------------------------------- |
| `annotations` | `string[]`                   | Columns a condition can test                                          |
| `data`        | `ProtspaceData \| undefined` | Dataset the match count is computed on                                |
| `query`       | `FilterQuery`                | Conditions and groups being edited                                    |
| `embedded`    | `boolean`                    | Inside a host dialog: no title or close button of its own; `embedded` |

| Event           | Detail               | Description                                          |
| --------------- | -------------------- | ---------------------------------------------------- |
| `query-changed` | `{ query }`          | The query was edited                                 |
| `query-apply`   | `{ matchedIndices }` | Apply: a `Set` of indices into `data.protein_ids`    |
| `query-reset`   | none                 | Reset All                                            |
| `query-close`   | none                 | Cancel                                               |

Apply a match through the scatterplot's `filteredProteinIds` and `filtersActive`. The query
helpers `createCondition`, `evaluateQuery`, `hasConfiguredCondition`,
`findConditionsForAnnotation`, `replaceConditionsForAnnotation`, `conditionsForReliability`,
`reliabilityFromConditions` and `sameConditions` and the `FilterQuery` type are exported too.

### Import Menu

| Property             | Type                               | Description                                                     |
| -------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `exampleDatasets`    | `readonly ExampleDatasetSummary[]` | Example catalog, listed in the "Examples" section; JavaScript-only |
| `examplesDocsUrl`    | `string`                           | Page linked as "About these examples ↗"; `examples-docs-url`    |
| `currentDatasetName` | `string`                           | Dataset on screen; `current-dataset-name`                       |
| `currentExampleId`   | `string \| null`                   | Example on screen, `null` for a user import; `current-example-id` |

`ExampleDatasetSummary` is exported from `@protspace/core`:

| Field         | Type      | Shown as                                                    |
| ------------- | --------- | ----------------------------------------------------------- |
| `id`          | `string`  | The `load-example-dataset` event's `detail.id`              |
| `label`       | `string`  | The item's text                                             |
| `description` | `string`  | The first paragraph of the item's info popover              |
| `insight?`    | `string`  | The popover's second paragraph: what the curated view shows |
| `docsUrl?`    | `string`  | The popover's "Learn more ↗" link                           |
| `large?`      | `boolean` | A "Large" badge on the item                                 |

When `currentExampleId` names an entry, the same info popover sits next to the current dataset name.

| Event                  | Detail           | Description                           |
| ---------------------- | ---------------- | ------------------------------------- |
| `load-example-dataset` | `{ id: string }` | An example dataset was chosen         |
| `open-file-dialog`     | `{}`             | "Load your dataset" was chosen        |

Both fire inside the user's click: call the data loader's `openFilePicker()` from the
`open-file-dialog` listener and the browser lets the file chooser open.

### Export Menu

| Property          | Type      | Description                                                                   |
| ----------------- | --------- | ----------------------------------------------------------------------------- |
| `hasFileSettings` | `boolean` | The loaded file carries settings a Parquet export can keep; `has-file-settings` |

Methods: `reset()` returns the menu to PNG.

| Event                 | Detail               | Description             |
| --------------------- | -------------------- | ----------------------- |
| `export`              | `ExportEventDetail`  | Export requested        |
| `open-publish-editor` | `{}`                 | Figure editor requested |

`ExportEventDetail` is `{ type: 'png' | 'pdf' | 'ids' | 'parquet', imageWidth, imageHeight,
legendWidthPercent, legendFontSizePx, includeLegend, includeLegendSettings }`; `EXPORT_DEFAULTS`
holds the default sizes.

### Plot Tools

The plot's tool strip, and beside it, while they apply, Clear and Isolate (with a selection) and
Reset (while isolated).

| Property            | Type                              | Description                                           |
| ------------------- | --------------------------------- | ----------------------------------------------------- |
| `tool`              | `'pan' \| 'rectangle' \| 'lasso'` | Pressed tool (`PlotTool`)                             |
| `selectionDisabled` | `boolean`                         | Box and Lasso are off; `selection-disabled`           |
| `selectedCount`     | `number`                          | Clear and Isolate show while above 0; `selected-count` |
| `isolated`          | `boolean`                         | Reset shows while true                                |

| Event              | Detail     | Description                    |
| ------------------ | ---------- | ------------------------------ |
| `plot-tool-change` | `{ tool }` | A tool was chosen              |
| `fit-view`         | `{}`       | Fit to view was pressed        |
| `clear-selections` | `{}`       | Clear was pressed              |
| `isolate-data`     | `{}`       | Isolate was pressed            |
| `reset-isolation`  | `{}`       | Reset was pressed              |

On the scatterplot, `pan` is `selectionMode = false`; `rectangle` and `lasso` are
`selectionMode = true` with that `selectionTool`. `fit-view` maps to `resetZoom()`.

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
  projection.projections = e.detail.data.projections.map((p) => p.name);
  colorBy.annotations = Object.keys(e.detail.data.annotations);
});
projection.addEventListener('projection-change', (e) => {
  plot.selectedProjectionIndex = plot.data.projections.findIndex(
    (p) => p.name === e.detail.projection,
  );
});
colorBy.addEventListener('annotation-change', (e) => {
  plot.selectedAnnotation = e.detail.annotation;
});
```

````

4. In the Data Loader section, directly before its `### Events` heading, add:

```markdown
### Methods

| Method             | Returns | Description                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------- |
| `openFilePicker()` | `void`  | Opens the file chooser; call it inside a user gesture (`open-file-dialog`)    |

```

5. In the TypeScript Support example, replace `import { ProtspaceControlBar } from '@protspace/core';` with `import { DENSITY_MODE_LABELS } from '@protspace/core';`.

In `docs/developers/embedding.md`:

1. In the Components Overview table, replace the row

```markdown
| Control Bar      | `<protspace-control-bar>`      | Projection/annotation selection  |
```

with:

```markdown
| View controls    | `<protspace-projection-select>`, `<protspace-annotation-select>`, `<protspace-contours-menu>` | Projection, Color by and contours |
| Plot tools       | `<protspace-plot-tools>`                            | Move, box and lasso selection      |
| Search           | `<protspace-protein-search>`                        | Find and select proteins by ID     |
| Import, Export   | `<protspace-import-menu>`, `<protspace-export-menu>` | Load data, export figures          |
```

and add after the line `Importing `@protspace/core` once registers every element.`:

```markdown

The [API Reference](/developers/api/) lists every control, including the query builder and the
projection details card.
```

2. Replace the whole `html` code block under `## Basic HTML Setup` with:

````markdown
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
    colorBy.selectedAnnotation = plot.selectedAnnotation;
  });

  // The controls report picks; the page applies them to the plot.
  projection.addEventListener('projection-change', (e) => {
    plot.selectedProjectionIndex = plot.data.projections.findIndex(
      (p) => p.name === e.detail.projection,
    );
  });
  colorBy.addEventListener('annotation-change', (e) => {
    plot.selectedAnnotation = e.detail.annotation;
  });
</script>
```
````

3. Under `## Auto-Sync Feature`, delete the line `<protspace-control-bar auto-sync scatterplot-selector="#plot"></protspace-control-bar>` from its code block, and add after the paragraph that ends `…leaves the EAT overlay switch for the host to apply to the plot.`:

```markdown

The view and app controls (Projection, Color by, Contours, search, Import, Export and the plot
tools) have no auto-sync. They report picks as events and leave the plot to the host, as the
example above does for Projection and Color by; the [API Reference](/developers/api/) lists each
control's events and the plot properties they map to.
```

4. In `## Host Messaging Pattern`, replace `const controlBar = document.querySelector('protspace-control-bar');` with `const plot = document.getElementById('plot');`, and replace the listener

```javascript
controlBar.addEventListener('selection-disabled-notification', (event) => {
  notify({
    level: 'warning',
    title: 'Selection mode disabled.',
    description: event.detail.message,
  });
});
```

with:

```javascript
plot.addEventListener('auto-disable-selection', (event) => {
  const { reason, dataSize } = event.detail;
  notify({
    level: 'warning',
    title: 'Selection mode disabled.',
    description: reason === 'insufficient-data' ? `Only ${dataSize} point(s) remaining` : undefined,
  });
});
```

5. In the React and Vue examples, delete the lines `      <protspace-control-bar auto-sync scatterplot-selector="#plot" />` and `    <protspace-control-bar auto-sync scatterplot-selector="#plot" />`.
6. Replace `Image export is driven by the control bar, which emits an `export` event with the requested format` with `Image export is driven by `<protspace-export-menu>`, which emits an `export` event with the requested format`.

In `docs/developers/installation.md`, replace

```markdown
This defines `protspace-scatterplot`, `protspace-legend`, `protspace-control-bar` and
`protspace-structure-viewer`, among others. See [Embedding Components](/developers/embedding) for
how to wire them together.
```

with:

```markdown
This defines `protspace-scatterplot`, `protspace-legend`, `protspace-structure-viewer` and the view
controls such as `protspace-projection-select`, among others. See
[Embedding Components](/developers/embedding) for how to wire them together.
```

In `docs/developers/messaging.md`, delete the table row

```markdown
| `selection-disabled-notification` | `control-bar`                                                            | `warning` | `control-bar`      |
```

and add after the table:

```markdown

Selection mode turning itself off is the scatterplot's `auto-disable-selection` (`{ reason,
dataSize }`, not a `HostMessageEventDetail`); `apps/web/src/explore/notifications.ts` maps it to a
warning toast.
```

In `docs/developers/style-architecture.md`:

1. In the "When to Split Files" table, replace `| 300+    | Modular `styles/` directory       | `control-bar`, `legend`       |` with `| 300+    | Modular `styles/` directory       | `legend`                      |`.
2. In the "Component Prefixes" table, replace the row `| Control-bar      | Uses tokens only       |` with `| Kit and new elements | `--ps-*` tokens only |`.
3. Replace

````markdown
Study **control-bar** as the ideal modular pattern:

```typescript
// control-bar.styles.ts (35 lines)
export const controlBarStyles = [
  tokens,
  buttonMixin,
  inputMixin,
  dropdownMixin,
  layoutStyles,
  filterStyles,
  exportStyles,
  responsiveStyles, // Always last
];
```
````

with:

````markdown
Study **legend** as the modular pattern:

```typescript
// legend.styles.ts
export const legendStyles = [
  tokens,
  buttonMixin,
  overlayMixins,
  themeStyles,
  layoutStyles,
  itemStyles,
  modalStyles,
  responsiveStyles, // Always last
];
```
````

4. In the "Component Status" table, delete the row `| control-bar       | Modular      | ✅ Reference  |` and change the legend row's status from `✅ Refactored` to `✅ Reference`.

Run: `pnpm exec prettier --write docs/developers/api/index.md docs/developers/embedding.md docs/developers/installation.md docs/developers/messaging.md docs/developers/style-architecture.md`
Expected: the tables are realigned.

Run: `grep -rn "protspace-control-bar\|myControlBar" packages/core/src apps/web/src apps/web/tests docs/developers`
Expected: no output.

Run: `pnpm docs:build`
Expected: the build succeeds with no dead links.

- [ ] **Step 18: Run the suites this task touches**

Run: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled)
Expected: PASS, as in Step 11.

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS, as in Step 7.

Run: `pnpm knip && pnpm type-check:scripts`
Expected: no unused files, exports or dependencies (`iconMixin`, the selection helpers and the control-bar events are gone with their last consumers); the docs-screenshot scripts still type-check (they import only `control-bar/query-types`, which stays). They still look for the control bar at run time and stay broken until phase 7, as the Global Constraints say.

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (sandbox disabled)
Expected: PASS, the whole Chromium suite, including `workbench-view-bar` (9), `workbench-helpers`, `workbench-filter`, `workbench-shell` (the view bar is at least 44 px), `eat-visualization` (the 601 px pickers check), `url-view-state` (the deep-link trap without the control bar), `product-tour` and `dataset-reload`.

Run: `pnpm --filter @protspace/app build`
Expected: the build succeeds.

- [ ] **Step 19: Commit**

Run: `pnpm exec prettier --check packages/core/src/components/control-bar packages/core/src/styles packages/core/src/index.ts apps/web/src apps/web/tests/helpers/explore.ts apps/web/tests/workbench-view-bar.spec.ts apps/web/tests/url-view-state.spec.ts docs/developers`
Expected: all files pass (run `pnpm exec prettier --write` on any that do not, then re-check).

```bash
git add packages/core/src/components/control-bar/control-bar.ts \
  packages/core/src/components/control-bar/control-bar.styles.ts \
  packages/core/src/components/control-bar/control-bar.events.ts \
  packages/core/src/components/control-bar/control-bar-helpers.ts \
  packages/core/src/components/control-bar/control-bar-helpers.test.ts \
  packages/core/src/components/control-bar/styles \
  packages/core/src/components/control-bar/types.ts \
  packages/core/src/styles/mixins.ts packages/core/src/styles/style-lint.test.ts \
  packages/core/src/index.ts \
  apps/web/src/explore/runtime.ts apps/web/src/explore/elements.ts \
  apps/web/src/explore/explore-controls.ts apps/web/src/explore/data-renderer.ts \
  apps/web/src/explore/data-renderer.test.ts apps/web/src/explore/dataset-controller.fixtures.ts \
  apps/web/src/explore/dataset-controller.eat.test.ts \
  apps/web/src/explore/view-bar-controller.ts apps/web/src/explore/view-bar-controller.test.ts \
  apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts \
  apps/web/src/workbench/view-bar-overflow.ts apps/web/src/workbench/view-bar-overflow.test.ts \
  apps/web/src/workbench/use-view-bar-stage.ts apps/web/src/workbench/MoreMenu.tsx \
  apps/web/src/workbench/ViewBar.tsx apps/web/src/workbench/FilterControl.tsx \
  apps/web/src/workbench/workbench.css apps/web/src/custom-elements.d.ts \
  apps/web/src/tour/product-tour.ts \
  apps/web/tests/helpers/explore.ts apps/web/tests/workbench-view-bar.spec.ts \
  apps/web/tests/url-view-state.spec.ts \
  docs/developers/api/index.md docs/developers/embedding.md docs/developers/installation.md \
  docs/developers/messaging.md docs/developers/style-architecture.md
git commit -m "feat(web): remove the control bar; the view bar keeps one row"
```

(`git add` of the deleted files and of the removed `styles/` folder stages their removal; add any other `control-bar.*.test.ts` Step 10 deleted. `git commit` needs the sandbox disabled; the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.11: Structure docked under the legend

The structure viewer moves out of the legend's column into its own section under a draggable divider (decision 2), shown only while a protein is available; otherwise a 44 px footer says "Click a protein to view it". A new `structure-controller.ts` owns what the viewer shows: it loads the last selected protein when the structure is visible, only remembers it while hidden, publishes it to the shell (the rail dot in 2.12) and clears the viewer when a dataset loads. In the app the viewer no longer shows or hides itself. The divider never resizes the plot (decision 4).

**Files:**

- Create: `apps/web/src/explore/structure-controller.ts`, `structure-controller.test.ts`
- Create: `apps/web/src/workbench/StructurePanel.tsx`, `layout-geometry.ts`, `layout-geometry.test.ts`
- Modify: `apps/web/src/workbench/Sidebar.tsx`, `Workbench.tsx`, `workbench.css`, `apps/web/src/explore/runtime.ts` (the `ExploreControls` object; structure listeners :362-379), `interaction-controller.ts`, `interaction-controller.test.ts` (:19), `interaction-controller.eat.test.ts`, `workbench-status.ts`, `workbench-status.test.ts`, `apps/web/src/custom-elements.d.ts`
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.ts` (close button :427), `structure-viewer.component.test.ts`
- Modify: `apps/web/tests/helpers/explore.ts` (`structurePanel`, `dragDivider`)
- Create: `apps/web/tests/workbench-structure.spec.ts`

- Also modified: `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` (the close button now holds an icon, so its glyph padding and font size go). `icon.ts` needs no change: the header's close button uses `x`, which Task 1.4 added, and the footer's cube is drawn by the React shell with `lucide-react`.

**Interfaces:**

- Consumes: `getLayout`, `subscribeLayout`, `updateLayout`, `LEGEND_FRACTION`, `DESKTOP_MIN_WIDTH` (2.2); `useLayout`, `useWorkbenchStatus`, `useLayoutMode`; `ExploreControls.clearStructure` (2.5); `InteractionController.handleSelectionChange(ids)` (2.9); viewer `loadProtein(id)`, `close()`, `proteinId`, `autoShow`, `showTips`, `title`, events `structure-load` and `structure-close`.
- Produces:
  - `structure-controller.ts`: `isStructureVisible(layout: LayoutState, desktop: boolean): boolean` (pure: below 951 px always visible, because the stacked sidebar never collapses; on desktop, floating is visible and docked follows `layout.sidebarOpen`); `createStructureController(options: { viewer: ProtspaceStructureViewer; desktopQuery: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> }): StructureController` (it reads and subscribes to the layout store and listens to `desktopQuery` changes; the runtime passes `matchMedia('(min-width: 951px)')`); `interface StructureController { request(proteinId: string): void; clear(): void; dispose(): void }`. On creation it sets `viewer.autoShow = false`, `viewer.showTips = false`, `viewer.title = 'Structure'` and removes the viewer's inline `display`. `request` loads at once when visible and otherwise only remembers; when a layout or breakpoint change makes the structure visible it loads the remembered protein once; `structure-close` forgets it; `clear()` closes the viewer only if it holds a protein. It publishes `structureProteinId` to the workbench status.
  - `workbench-status.ts`: `structureProteinId: string | null` (the protein shown or waiting).
  - `createInteractionController({ legendElement, plotElement, requestStructure(proteinId: string): void })`: `handleSelectionChange(ids)` requests the last id; the `structureViewer` option is gone.
  - `ExploreControls.clearStructure` calls `structureController.clear()`.
  - `layout-geometry.ts`: `splitSidebar(height: number, fraction: number): { legend: number; structure: number }` (legend at least 120 px and structure at least 220 px; when both cannot fit, the legend gets 120); `fractionStep(key: string, shift: boolean): number` (ArrowUp −0.05, ArrowDown +0.05, four times that with Shift, 0 for other keys).
  - DOM: `section.wb-structure[data-workbench="structure"][aria-label="Structure"]`, a sibling of the aside (never inside it), absolutely placed in the sidebar column under the divider, holding `#myStructureViewer` with `height="100%"`, `auto-sync="true"`, `scatterplot-selector="#myPlot"` and `show-header`/`show-close-button`, and no inline display, `title`, `show-tips` or `auto-show` attributes; `div[role="separator"][aria-orientation="horizontal"][aria-label="Resize legend and structure"][data-workbench="divider"]` with `aria-valuenow`, `aria-valuemin="20"`, `aria-valuemax="80"` (the legend's share in percent); a drag previews with `--wb-legend-fraction` and writes `legendFraction` on pointerup, the keys write on keyup; `[data-workbench="structure-empty"]`, a 44 px footer with "Structure" and "Click a protein to view it"; root `data-structure="none"` while no protein is available (the footer shows, the legend fills the rest, the divider is hidden) and `"docked"` while one shows docked (2.13 adds `"floating"`). In narrow mode the section follows the legend in normal flow.
  - Viewer (core): the close button shows `icon('x')`, is named "Close structure" and keeps the class `close-button`.
  - Helpers: `structurePanel(page): Locator`, `dragDivider(page, dy: number): Promise<void>`.
  - Additions this task needs (additive): the divider lives inside the structure section, as its first child, so it slides and hides with the section (2.12) and needs no third slide target; `InteractionController.handleStructureClose` and its `structure-close` listener go, because the structure controller owns that event; three more e2e helpers in `helpers/explore.ts`, used by this task's spec and by 2.12 and 2.13: `stubStructureRequests(page)` (AlphaFold, TED and the Mol\* bundle answered offline, so a structure loads deterministically and a `.molstar-mount` exists), `clickProteinNearPlotCentre(page): Promise<string>` and `watchPlotResizes(page): Promise<() => Promise<number>>`.

**Tests:**

- `structure-controller.test.ts` (unit, node, fake viewer and media query): "sets autoShow, showTips and the title and clears the inline display"; "a request while visible loads at once and publishes the protein"; "a request while hidden only publishes the protein"; "becoming visible, by layout or by crossing 951 px, loads the waiting protein once"; "structure-close forgets the protein"; "clear closes a loaded viewer and does nothing when empty"; "isStructureVisible: always below 951 px; on desktop docked follows the sidebar and floating is visible".
- `layout-geometry.test.ts` (unit): "splitSidebar honours the fraction within the 120 and 220 px minimums"; "a short sidebar keeps the legend at its minimum"; "fractionStep moves 5 %, or 20 % with Shift".
- `interaction-controller.test.ts`: "a selection requests its last protein's structure".
- `structure-viewer.component.test.ts`: "the close button is named Close structure"; "opens on a click whose detail has no modifierKeys" still passes with the element's default `autoShow`.
- `apps/web/tests/workbench-structure.spec.ts` (e2e): "before any click the sidebar shows the Structure footer under a full-height legend"; "clicking a protein shows the structure under a divider and the plot keeps its size"; "the divider moves by drag and by keyboard, survives a reload and never resizes the plot"; "Close structure brings the footer back"; "loading another dataset clears the structure".
- `pnpm perf:counts` passes (the search-select reset closes `#myStructureViewer .close-button`).

Every command runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Code from earlier tasks is anchored as those tasks write it: Task 2.2's `Workbench.tsx`, `Sidebar.tsx`, `workbench-status.ts` and `workbench.css`; Task 2.5's `ExploreControls` object in `runtime.ts`; Task 2.9's `handleSelectionChange(proteinIds)`. Read each file before editing it.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/web/src/workbench/layout-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fractionStep, splitSidebar } from './layout-geometry';

describe('splitSidebar', () => {
  it('splitSidebar honours the fraction within the 120 and 220 px minimums', () => {
    expect(splitSidebar(600, 0.5)).toEqual({ legend: 300, structure: 300 });
    expect(splitSidebar(600, 0.1)).toEqual({ legend: 120, structure: 480 });
    expect(splitSidebar(600, 0.8)).toEqual({ legend: 380, structure: 220 });
  });

  it('a short sidebar keeps the legend at its minimum', () => {
    expect(splitSidebar(300, 0.5)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(300, 0.8)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(80, 0.5)).toEqual({ legend: 80, structure: 0 });
  });
});

describe('fractionStep', () => {
  it('fractionStep moves 5 %, or 20 % with Shift', () => {
    expect(fractionStep('ArrowUp', false)).toBeCloseTo(-0.05, 10);
    expect(fractionStep('ArrowDown', false)).toBeCloseTo(0.05, 10);
    expect(fractionStep('ArrowUp', true)).toBeCloseTo(-0.2, 10);
    expect(fractionStep('ArrowDown', true)).toBeCloseTo(0.2, 10);
    expect(fractionStep('ArrowLeft', false)).toBe(0);
    expect(fractionStep('Enter', true)).toBe(0);
  });
});
```

Create `apps/web/src/explore/structure-controller.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT } from './layout-defaults';
import { resetLayoutForTests, updateLayout } from './layout-state';
import {
  createStructureController,
  isStructureVisible,
  type StructureController,
} from './structure-controller';
import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';

/** The viewer's surface the controller uses, over a real EventTarget. */
function fakeViewer() {
  const events = new EventTarget();
  const viewer = {
    autoShow: true,
    showTips: true,
    title: 'Protein Structure',
    proteinId: null as string | null,
    style: {
      display: 'none',
      removeProperty(name: string) {
        if (name === 'display') this.display = '';
        return '';
      },
    },
    loadProtein: vi.fn((proteinId: string) => {
      viewer.proteinId = proteinId;
    }),
    // As the element does: forget the protein, then tell listeners.
    close: vi.fn(() => {
      viewer.proteinId = null;
      events.dispatchEvent(new CustomEvent('structure-close', { detail: { proteinId: null } }));
    }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  return viewer;
}

/** `(min-width: 951px)`, answered by the test. */
function fakeDesktopQuery(matches: boolean) {
  const events = new EventTarget();
  const query = {
    matches,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    set(next: boolean) {
      query.matches = next;
      events.dispatchEvent(new Event('change'));
    },
  };
  return query;
}

const controllers: StructureController[] = [];

function setup({ desktop = true } = {}) {
  const viewer = fakeViewer();
  const desktopQuery = fakeDesktopQuery(desktop);
  const controller = createStructureController({
    viewer: viewer as never,
    desktopQuery: desktopQuery as never,
  });
  controllers.push(controller);
  return { viewer, desktopQuery, controller };
}

beforeEach(() => {
  resetLayoutForTests();
  resetWorkbenchStatusForTests();
});

afterEach(() => {
  while (controllers.length) controllers.pop()!.dispose();
});

describe('isStructureVisible', () => {
  it('isStructureVisible: always below 951 px; on desktop docked follows the sidebar and floating is visible', () => {
    const collapsed = { ...DEFAULT_LAYOUT, sidebarOpen: false };
    expect(isStructureVisible(collapsed, false)).toBe(true);
    expect(isStructureVisible(DEFAULT_LAYOUT, true)).toBe(true);
    expect(isStructureVisible(collapsed, true)).toBe(false);
    expect(isStructureVisible({ ...collapsed, structurePlacement: 'floating' }, true)).toBe(true);
  });
});

describe('createStructureController', () => {
  it('sets autoShow, showTips and the title and clears the inline display', () => {
    const { viewer } = setup();
    expect(viewer.autoShow).toBe(false);
    expect(viewer.showTips).toBe(false);
    expect(viewer.title).toBe('Structure');
    expect(viewer.style.display).toBe('');
  });

  it('a request while visible loads at once and publishes the protein', () => {
    const { viewer, controller } = setup();
    controller.request('P12345');
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P12345');
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });

  it('a request while hidden only publishes the protein', () => {
    const { viewer, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P12345');
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });

  it('becoming visible, by layout or by crossing 951 px, loads the waiting protein once', () => {
    const { viewer, desktopQuery, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    updateLayout({ sidebarWidth: 320 });
    expect(viewer.loadProtein).toHaveBeenCalledOnce();

    updateLayout({ sidebarOpen: false });
    controller.request('P2');
    desktopQuery.set(false);
    expect(viewer.loadProtein).toHaveBeenCalledTimes(2);
    expect(viewer.loadProtein).toHaveBeenLastCalledWith('P2');
    desktopQuery.set(true);
    desktopQuery.set(false);
    expect(viewer.loadProtein).toHaveBeenCalledTimes(2);
  });

  it('structure-close forgets the protein', () => {
    const { viewer, controller } = setup();
    controller.request('P1');
    viewer.close();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    // Hidden and shown again: nothing waits, so nothing loads.
    updateLayout({ sidebarOpen: false });
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).toHaveBeenCalledOnce();
  });

  it('clear closes a loaded viewer and does nothing when empty', () => {
    const { viewer, controller } = setup();
    controller.request('P1');
    controller.clear();
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    controller.clear();
    expect(viewer.close).toHaveBeenCalledOnce();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
  });

  it('clear forgets a protein that waits while the structure is hidden', () => {
    const { viewer, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    controller.clear();
    expect(viewer.close).not.toHaveBeenCalled();
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    updateLayout({ sidebarOpen: true });
    expect(viewer.loadProtein).not.toHaveBeenCalled();
  });

  it('dispose stops following the layout, the breakpoint and the viewer', () => {
    const { viewer, desktopQuery, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    controller.dispose();
    updateLayout({ sidebarOpen: true });
    desktopQuery.set(false);
    expect(viewer.loadProtein).not.toHaveBeenCalled();
    viewer.close();
    expect(getWorkbenchStatus().structureProteinId).toBe('P1');
  });
});
```

In `apps/web/src/explore/workbench-status.test.ts` (its `beforeEach` already calls `resetWorkbenchStatusForTests()`), add `structureProteinId: null` to every expected object that compares the whole status with `toEqual` (Task 2.2 wrote two: in "starts empty" and in "merges a patch and notifies once"), and add inside its `describe`:

```ts
  it('structureProteinId starts null and takes the published protein', () => {
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    setWorkbenchStatus({ structureProteinId: 'P12345' });
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });
```

In `apps/web/src/explore/interaction-controller.test.ts`:
- in `setup(autoSync)`, replace `structureViewer: {} as never,` with `requestStructure: vi.fn(),`;
- delete the case "a selection loads its last protein" that Task 2.9 added, and append:

```ts
describe('interaction controller structure requests', () => {
  it("a selection requests its last protein's structure", () => {
    const requestStructure = vi.fn();
    const controller = createInteractionController({
      plotElement: { selectedAnnotation: 'family', getCurrentData: () => data } as never,
      legendElement: { autoSync: true, forceSync: vi.fn() } as never,
      requestStructure,
    });

    controller.handleSelectionChange(['p0', 'p1']);
    expect(requestStructure).toHaveBeenCalledExactlyOnceWith('p1');

    // Clearing the selection leaves the structure as it is.
    controller.handleSelectionChange([]);
    expect(requestStructure).toHaveBeenCalledOnce();
  });
});
```

In `apps/web/src/explore/interaction-controller.eat.test.ts` (`setup()`, :53-57), replace `structureViewer: { loadProtein: vi.fn() } as never,` with `requestStructure: vi.fn(),`.

In `packages/core/src/components/structure-viewer/structure-viewer.component.test.ts`, append inside `describe('protspace-structure-viewer resource links', …)` (it mounts a viewer with a protein, so the header renders):

```ts
  it('the close button is named Close structure', async () => {
    const root = await mount();
    const button = root.querySelector<HTMLButtonElement>('button.close-button')!;
    expect(button.getAttribute('aria-label')).toBe('Close structure');
    expect(button.getAttribute('type')).toBe('button');
    // A Lucide icon, not the old text glyph.
    expect(button.querySelector('svg.ps-icon')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts src/explore/structure-controller.test.ts src/explore/workbench-status.test.ts src/explore/interaction-controller.test.ts src/explore/interaction-controller.eat.test.ts`
Expected: FAIL: `Failed to resolve import "./layout-geometry"` and `"./structure-controller"`; the status cases fail because the snapshot has no `structureProteinId` (`undefined`, not `null`); "a selection requests its last protein's structure" fails with a TypeError on `structureViewer.loadProtein`, since `structureViewer` is not passed any more and `requestStructure` does not exist yet.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/structure-viewer.component.test.ts`
Expected: FAIL: `aria-label` is `null` (the button has no name and holds the text `✕`).

- [ ] **Step 3: Write the geometry, the controller and the status field**

Create `apps/web/src/workbench/layout-geometry.ts`:

```ts
/**
 * Pure geometry of the workbench's sidebar column. Sizes here are shell literals, not tokens
 * (design decision 5); the stored layout's ranges live in explore/layout-defaults.ts.
 */

/** The legend keeps at least this much of the sidebar column's height. */
const LEGEND_MIN_HEIGHT = 120;
/** The docked structure keeps at least this much, under the divider. */
const STRUCTURE_MIN_HEIGHT = 220;
/** One arrow key moves the divider by this share of the column; Shift moves four times as far. */
const FRACTION_STEP = 0.05;

/**
 * How `height` px of the sidebar column (the divider's own height left out) split between the
 * legend and the docked structure for the legend's `fraction`: the fraction's share, with the
 * legend at least 120 px and the structure at least 220 px. When the column cannot hold both, the
 * legend gets 120 px (or all of it) and the structure the rest. workbench.css computes the same
 * clamp for `--wb-legend-height`; the divider uses this one to store what it shows.
 */
export function splitSidebar(
  height: number,
  fraction: number,
): { legend: number; structure: number } {
  const total = Math.max(0, height);
  const legend =
    total < LEGEND_MIN_HEIGHT + STRUCTURE_MIN_HEIGHT
      ? Math.min(LEGEND_MIN_HEIGHT, total)
      : Math.min(Math.max(total * fraction, LEGEND_MIN_HEIGHT), total - STRUCTURE_MIN_HEIGHT);
  return { legend, structure: total - legend };
}

/** The divider's step for a key: ArrowUp gives the legend 5 % less, ArrowDown 5 % more; 0 otherwise. */
export function fractionStep(key: string, shift: boolean): number {
  const step = shift ? 4 * FRACTION_STEP : FRACTION_STEP;
  if (key === 'ArrowUp') return -step;
  if (key === 'ArrowDown') return step;
  return 0;
}
```

Create `apps/web/src/explore/structure-controller.ts`:

```ts
import type { ProtspaceStructureViewer } from '@protspace/core';
import type { LayoutState } from './layout-defaults';
import { getLayout, subscribeLayout } from './layout-state';
import { setWorkbenchStatus } from './workbench-status';

/**
 * Whether the structure can be seen with this layout. Below 951 px the stacked sidebar never
 * collapses, so it always can; on desktop a floating card always can, and a docked one only while
 * the sidebar is open.
 */
export function isStructureVisible(layout: LayoutState, desktop: boolean): boolean {
  if (!desktop) return true;
  return layout.structurePlacement === 'floating' || layout.sidebarOpen;
}

export interface StructureController {
  /** Shows `proteinId` now if the structure can be seen, or keeps it until it can. */
  request(proteinId: string): void;
  /** Forgets the protein (a new dataset). Closes the viewer only if it holds one. */
  clear(): void;
  dispose(): void;
}

interface StructureControllerOptions {
  viewer: ProtspaceStructureViewer;
  /** `matchMedia('(min-width: 951px)')` in the app; a fake in tests. */
  desktopQuery: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
}

/**
 * What the structure viewer shows, and when (design decision 2). A protein requested while the
 * structure is hidden (docked in a collapsed sidebar) only waits behind the rail's dot: no
 * AlphaFold request and no Mol* start in a hidden box. It loads once a layout or breakpoint change
 * makes the structure visible. The viewer no longer shows or hides itself: the shell places it
 * from `structureProteinId` in the workbench status.
 */
export function createStructureController({
  viewer,
  desktopQuery,
}: StructureControllerOptions): StructureController {
  // Properties, not attributes: Lit reads auto-show="false" as true.
  viewer.autoShow = false;
  viewer.showTips = false;
  viewer.title = 'Structure';
  viewer.style.removeProperty('display');

  // The protein waiting for the structure to be seen; null once it loads or is forgotten.
  let waiting: string | null = null;

  const visible = () => isStructureVisible(getLayout(), desktopQuery.matches);
  const publish = (proteinId: string | null) => setWorkbenchStatus({ structureProteinId: proteinId });
  const load = (proteinId: string) => {
    waiting = null;
    viewer.loadProtein(proteinId);
  };
  const loadWaiting = () => {
    if (waiting !== null && visible()) load(waiting);
  };
  const forget = () => {
    waiting = null;
    publish(null);
  };

  const unsubscribe = subscribeLayout(loadWaiting);
  desktopQuery.addEventListener('change', loadWaiting);
  viewer.addEventListener('structure-close', forget);

  return {
    request(proteinId) {
      publish(proteinId);
      if (visible()) load(proteinId);
      else waiting = proteinId;
    },
    clear() {
      // close() dispatches structure-close, which forgets the protein.
      if (viewer.proteinId) viewer.close();
      else forget();
    },
    dispose() {
      unsubscribe();
      desktopQuery.removeEventListener('change', loadWaiting);
      viewer.removeEventListener('structure-close', forget);
    },
  };
}
```

In `apps/web/src/explore/workbench-status.ts`, add to `interface WorkbenchStatus`:

```ts
  /** The protein the structure viewer shows or waits to show (the rail's dot); null for none. */
  structureProteinId: string | null;
```

and `structureProteinId: null` to the initial status `EMPTY` (the object `resetWorkbenchStatusForTests()` restores), beside the fields Tasks 2.6 and 2.10 added there.

- [ ] **Step 4: Route selections through the controller**

In `apps/web/src/explore/interaction-controller.ts`:

1. Drop `ProtspaceStructureViewer` from the `@protspace/core` type import.
2. In `interface InteractionControllerOptions`, replace `structureViewer: ProtspaceStructureViewer;` with:

```ts
  /** Asks for a protein's structure; the structure controller decides when it loads. */
  requestStructure(proteinId: string): void;
```

3. In `interface InteractionController`, delete `handleStructureClose(event: Event): void;` and, in the returned object, delete `handleStructureClose(event) { … }` (the structure controller listens to `structure-close` now).
4. Change the destructured parameter of `createInteractionController` from `structureViewer` to `requestStructure`.
5. In `handleSelectionChange` (Task 2.9's `(proteinIds: readonly string[])` form), replace the call `structureViewer.loadProtein(selectedProteins[selectedProteins.length - 1]);` with:

```ts
        requestStructure(selectedProteins[selectedProteins.length - 1]);
```

In `packages/core/src/components/structure-viewer/structure-viewer.ts`:

1. Add `import { icon } from '../kit/icon';` after the `header-links` import.
2. In `render()`, inside `<div class="header-actions">` (:424-428), replace the whole `${this.showCloseButton ? … : ''}` expression (today it renders `<button class="close-button" @click=${this._handleClose}>✕</button>`) with:

```ts
                ${this.showCloseButton
                  ? html`<button
                      type="button"
                      class="close-button"
                      aria-label="Close structure"
                      @click=${this._handleClose}
                    >
                      ${icon('x')}
                    </button>`
                  : ''}
```

In `packages/core/src/components/structure-viewer/structure-viewer.styles.ts`, in the `.close-button` rule (:156-166), replace `font-size: 1.25rem;`, `padding: 0.5rem 0.7rem;` and `line-height: 1;` with:

```css
    display: inline-grid;
    place-items: center;
    padding: 6px;
```

- [ ] **Step 5: Run the unit tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts src/explore/structure-controller.test.ts src/explore/workbench-status.test.ts src/explore/interaction-controller.test.ts src/explore/interaction-controller.eat.test.ts`
Expected: PASS (3 geometry cases, 9 controller cases, the status and interaction cases).

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/`
Expected: PASS, including "the close button is named Close structure" and "opens on a click whose detail has no modifierKeys, as on an unmodified click" (the element's default `autoShow` is still true).

- [ ] **Step 6: Write the failing e2e spec and its helpers**

Append to `apps/web/tests/helpers/explore.ts`:

```ts
/** The structure section of the sidebar: the docked viewer, or its empty footer. */
export function structurePanel(page: Page): Locator {
  return page.locator('[data-workbench="structure"]');
}

/** Drags the divider between the legend and the structure by `dy` pixels and releases it. */
export async function dragDivider(page: Page, dy: number): Promise<void> {
  const box = await page
    .getByRole('separator', { name: 'Resize legend and structure' })
    .boundingBox();
  if (!box) throw new Error('The legend/structure divider is not shown');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Mol*'s global, with a viewer that loads nothing and draws nothing. */
const MOLSTAR_STUB = `window.molstar = { Viewer: { create: async () => ({
  plugin: { representation: { structure: { themes: { colorThemeRegistry: { add() {} } } } } },
  loadStructureFromUrl: async () => {},
  dispose() {},
}) } };`;

const ANY_ORIGIN = { 'access-control-allow-origin': '*' };

/**
 * Answers the structure viewer's requests (AlphaFold's prediction, model file and TED domains,
 * and the Mol* bundle) offline, so a structure "loads" every time and Mol* mounts a viewer that
 * draws nothing. Specs assert where the viewer is and what it holds, never its 3D picture.
 */
export async function stubStructureRequests(page: Page): Promise<void> {
  await page.route('https://www.alphafold.ebi.ac.uk/api/prediction/**', (route) =>
    route.fulfill({
      headers: ANY_ORIGIN,
      json: [{ cifUrl: 'https://alphafold.ebi.ac.uk/files/stub-model.cif', modelVersion: 4 }],
    }),
  );
  await page.route('https://alphafold.ebi.ac.uk/files/**', (route) =>
    route.fulfill({ headers: ANY_ORIGIN, contentType: 'text/plain', body: 'data_stub\n' }),
  );
  await page.route('https://alphafold.ebi.ac.uk/api/domains/**', (route) =>
    route.fulfill({ headers: ANY_ORIGIN, json: { annotations: [] } }),
  );
  await page.route('https://cdn.jsdelivr.net/npm/molstar@*/build/viewer/molstar.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: MOLSTAR_STUB }),
  );
  await page.route('https://cdn.jsdelivr.net/npm/molstar@*/build/viewer/molstar.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
}

/**
 * Clicks the protein nearest the middle of the plot, clear of the tool strip and the status
 * corner, and returns its id.
 */
export async function clickProteinNearPlotCentre(page: Page): Promise<string> {
  const target = await page.locator('#myPlot').evaluate((element) => {
    const plot = element as HTMLElement & {
      _plotData: { length: number; xs: ArrayLike<number>; ys: ArrayLike<number> };
      dataToClient(x: number, y: number): { x: number; y: number } | null;
      pickInteractivePointAt(x: number, y: number): { id: string } | null;
    };
    const rect = plot.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    let best: { id: string; x: number; y: number; distance: number } | null = null;
    for (let slot = 0; slot < plot._plotData.length; slot++) {
      const at = plot.dataToClient(plot._plotData.xs[slot], plot._plotData.ys[slot]);
      if (!at) continue;
      const distance = Math.hypot(at.x - centreX, at.y - centreY);
      if (best && distance >= best.distance) continue;
      // What a click there picks: the topmost interactive protein, not always this slot's.
      const hit = plot.pickInteractivePointAt(at.x - rect.left, at.y - rect.top);
      if (hit) best = { id: hit.id, x: at.x, y: at.y, distance };
    }
    if (!best) throw new Error('No protein to click on the plot');
    return best;
  });
  await page.mouse.click(target.x, target.y);
  return target.id;
}

/**
 * Starts counting changes of `#myPlot`'s size; the returned function reads the count. A layout
 * change that moves only panels must leave it at 0 (design decision 4).
 */
export async function watchPlotResizes(page: Page): Promise<() => Promise<number>> {
  const counter = await page.locator('#myPlot').evaluateHandle((plot) => {
    const size = () => `${plot.clientWidth}x${plot.clientHeight}`;
    const state = { count: 0, last: size() };
    new ResizeObserver(() => {
      const next = size();
      if (next === state.last) return;
      state.last = next;
      state.count++;
    }).observe(plot);
    return state;
  });
  return () => counter.evaluate((state) => state.count);
}
```

Create `apps/web/tests/workbench-structure.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import { PHOSPHATASE_1587_FIXTURE } from './helpers/fixtures';
import {
  clickProteinNearPlotCentre,
  dragDivider,
  importUserFile,
  openExplore,
  structurePanel,
  stubStructureRequests,
  waitForExploreDataLoad,
  watchPlotResizes,
} from './helpers/explore';

const workbench = (page: Page) => page.locator('.workbench');
const footer = (page: Page) => structurePanel(page).locator('[data-workbench="structure-empty"]');
const divider = (page: Page) =>
  page.getByRole('separator', { name: 'Resize legend and structure' });

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** The legend fraction protspace:layout:v1 holds, if any. */
async function storedLegendFraction(page: Page): Promise<number | undefined> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as { legendFraction?: number }).legendFraction;
  }, LAYOUT_STORAGE_KEY);
}

test.beforeEach(async ({ page }) => {
  await stubStructureRequests(page);
});

test('before any click the sidebar shows the Structure footer under a full-height legend', async ({
  page,
}) => {
  await openExplore(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(footer(page)).toContainText('Structure');
  await expect(footer(page)).toContainText('Click a protein to view it');
  await expect(page.locator('#myStructureViewer')).toBeHidden();
  await expect(divider(page)).toBeHidden();

  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  const legend = (await page.locator('#myLegend').boundingBox())!;
  const bar = (await footer(page).boundingBox())!;
  expectNear(bar.height, 44);
  expectNear(bar.y + bar.height, body.y + body.height);
  // The legend runs from the top of the column down to the footer.
  expectNear(legend.y, body.y);
  expectNear(legend.y + legend.height, bar.y);
});

test('clicking a protein shows the structure under a divider and the plot keeps its size', async ({
  page,
}) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const before = await plot.boundingBox();
  const resizes = await watchPlotResizes(page);

  const id = await clickProteinNearPlotCentre(page);

  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  const viewer = page.locator('#myStructureViewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveJSProperty('proteinId', id);
  await expect(footer(page)).toBeHidden();
  await expect(divider(page)).toBeVisible();
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '50');

  const legend = (await page.locator('#myLegend').boundingBox())!;
  const line = (await divider(page).boundingBox())!;
  const shown = (await viewer.boundingBox())!;
  expectNear(line.y, legend.y + legend.height);
  expectNear(shown.y, line.y + line.height);
  expect(await plot.boundingBox()).toEqual(before);
  expect(await resizes()).toBe(0);
});

test('the divider moves by drag and by keyboard, survives a reload and never resizes the plot', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '50');
  const resizes = await watchPlotResizes(page);
  const legend = page.locator('#myLegend');
  const start = (await legend.boundingBox())!.height;

  await dragDivider(page, -60);
  await expect
    .poll(async () => Math.abs((await legend.boundingBox())!.height - (start - 60)))
    .toBeLessThanOrEqual(2);
  const dragged = Number(await divider(page).getAttribute('aria-valuenow'));
  expect(dragged).toBeLessThan(50);
  expect(await storedLegendFraction(page)).toBeCloseTo(dragged / 100, 1);

  await divider(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged + 5));
  await page.keyboard.press('Shift+ArrowUp');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged - 15));
  expect(Math.round((await storedLegendFraction(page))! * 100)).toBe(dragged - 15);
  expect(await resizes()).toBe(0);

  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', String(dragged - 15));
});

test('Close structure brings the footer back', async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();

  await page.getByRole('button', { name: 'Close structure' }).click();

  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.locator('#myStructureViewer')).toBeHidden();
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);
});

test('loading another dataset clears the structure', async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');

  await importUserFile(page, PHOSPHATASE_1587_FIXTURE);
  await waitForExploreDataLoad(page, { proteinCount: 1587 });

  await expect(workbench(page)).toHaveAttribute('data-structure', 'none');
  await expect(footer(page)).toBeVisible();
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);
});
```

- [ ] **Step 7: Run the spec to see it fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure`
Expected: FAIL: the root has no `data-structure` attribute and `[data-workbench="structure"]` does not exist, so every case times out on its first assertion; nothing else in the spec errors (the helpers resolve).

- [ ] **Step 8: Build the structure section**

Create `apps/web/src/workbench/StructurePanel.tsx`:

```tsx
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Box } from 'lucide-react';
import { LEGEND_FRACTION } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { fractionStep, splitSidebar } from './layout-geometry';

/** The divider's height; the legend and the docked structure share the column's height minus it. */
const DIVIDER_HEIGHT = 9;

/** The sidebar column, the workbench body the section and the aside are placed in. */
const columnOf = (element: Element) => element.closest<HTMLElement>('[data-workbench="body"]');

/**
 * The fraction the column shows for a requested one: within the stored range, then within
 * splitSidebar's pixel minimums at this column height, so what is stored is what the user saw.
 */
function shownFraction(requested: number, column: HTMLElement): number {
  const fraction = Math.min(LEGEND_FRACTION.max, Math.max(LEGEND_FRACTION.min, requested));
  const available = column.clientHeight - DIVIDER_HEIGHT;
  if (available <= 0) return fraction;
  return splitSidebar(available, fraction).legend / available;
}

interface LegendDividerProps {
  /** The legend's share of the column: the preview while one runs, else the stored value. */
  fraction: number;
  onPreview(fraction: number | null): void;
}

/**
 * The separator between the legend and the docked structure (design decision 2). A drag or an
 * arrow key previews through `--wb-legend-fraction`; the layout is written once, on pointerup or
 * keyup. Neither changes the plot's box (decision 4).
 */
function LegendDivider({ fraction, onPreview }: LegendDividerProps) {
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);

  const preview = (next: number) => {
    pending.current = next;
    onPreview(next);
  };
  const commit = () => {
    const next = pending.current;
    pending.current = null;
    if (next !== null) updateLayout({ legendFraction: next });
    onPreview(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const column = columnOf(event.currentTarget);
    if (!dragging.current || !column) return;
    const legendHeight =
      event.clientY - column.getBoundingClientRect().top - DIVIDER_HEIGHT / 2;
    preview(shownFraction(legendHeight / (column.clientHeight - DIVIDER_HEIGHT), column));
  };
  const onPointerEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = fractionStep(event.key, event.shiftKey);
    const column = columnOf(event.currentTarget);
    if (step === 0 || !column) return;
    event.preventDefault();
    preview(shownFraction((pending.current ?? fraction) + step, column));
  };
  const onKeyUp = () => {
    if (!dragging.current && pending.current !== null) commit();
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize legend and structure"
      aria-valuemin={Math.round(LEGEND_FRACTION.min * 100)}
      aria-valuemax={Math.round(LEGEND_FRACTION.max * 100)}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      className="wb-divider"
      data-workbench="divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
}

interface StructurePanelProps {
  legendFraction: number;
  onLegendFractionPreview(fraction: number | null): void;
}

/**
 * The structure section: a sibling of the sidebar's aside, never inside it, so placing it never
 * moves #myStructureViewer to another parent (its disconnect would dispose Mol*). It holds the
 * divider, the 44 px empty footer and the viewer, which the structure controller drives. Where it
 * sits, and which part shows, is CSS from the workbench root's data-structure.
 */
export function StructurePanel({ legendFraction, onLegendFractionPreview }: StructurePanelProps) {
  return (
    <section className="wb-structure" data-workbench="structure" aria-label="Structure">
      <LegendDivider fraction={legendFraction} onPreview={onLegendFractionPreview} />
      <div className="wb-structure-empty" data-workbench="structure-empty">
        <Box size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="wb-structure-empty-title">Structure</span>
        <span className="wb-structure-empty-hint">Click a protein to view it</span>
      </div>
      <protspace-structure-viewer
        id="myStructureViewer"
        height="100%"
        show-header="true"
        show-close-button="true"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      ></protspace-structure-viewer>
    </section>
  );
}
```

Replace `apps/web/src/workbench/Sidebar.tsx` (Task 2.2's file; the viewer leaves it for `StructurePanel`) with:

```tsx
import { memo } from 'react';

/**
 * The flush right sidebar (design decision 2): the legend, above the structure section that
 * StructurePanel renders as the aside's sibling, so placing the structure never moves either
 * element. Memoised and without props, so the legend is never re-created or moved.
 */
export const Sidebar = memo(function Sidebar() {
  return (
    <aside id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      ></protspace-legend>
    </aside>
  );
});
```

In `apps/web/src/workbench/Workbench.tsx`:

1. Replace `import type { CSSProperties } from 'react';` with `import { useState, type CSSProperties } from 'react';`, and add `import { StructurePanel } from './StructurePanel';` and `import { useWorkbenchStatus } from './use-workbench-status';`.
2. In `Workbench()`, after `const mode = useLayoutMode();`, add:

```tsx
  const { structureProteinId } = useWorkbenchStatus();
  // The divider's drag or key preview; null while the stored fraction shows.
  const [legendFractionPreview, setLegendFractionPreview] = useState<number | null>(null);
  const legendFraction = legendFractionPreview ?? layout.legendFraction;
  // What the sidebar column holds under the legend: the empty footer, or the docked viewer.
  const structure = structureProteinId === null ? 'none' : 'docked';
```

3. Change the root `<div className="workbench" data-layout={mode}>` to `<div className="workbench" data-layout={mode} data-structure={structure}>`.
4. Change the style of `div.wb-body` to:

```tsx
        style={
          {
            '--wb-sidebar-width': `${layout.sidebarWidth}px`,
            '--wb-legend-fraction': String(legendFraction),
          } as CSSProperties
        }
```

5. Inside `div.wb-body`, directly after `<Sidebar />`, add:

```tsx
        <StructurePanel
          legendFraction={legendFraction}
          onLegendFractionPreview={setLegendFractionPreview}
        />
```

In `apps/web/src/workbench/workbench.css`, delete Task 2.2's `#myStructureViewer { … }` rule and the comment above it (`/* The viewer still shows and hides itself, at its own height, until Task 2.11. */`), then append:

```css
/* ── Sidebar column: the legend over the structure (Task 2.11) ───────────── */

.workbench[data-layout='desktop'] [data-workbench='body'] {
  /* The legend's height: the stored or previewed fraction of what the 9 px divider leaves, at
     least 120 px, and at most what leaves the structure 220 px. splitSidebar in
     layout-geometry.ts is the same rule. */
  --wb-legend-height: clamp(
    120px,
    calc((100% - 9px) * var(--wb-legend-fraction, 0.5)),
    calc(100% - 229px)
  );
}

.workbench[data-layout='desktop'] #myLegend {
  flex: none;
  height: calc(100% - 44px);
}

.workbench[data-layout='desktop'][data-structure='docked'] #myLegend {
  height: var(--wb-legend-height);
}

.wb-structure {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--ps-surface);
}

.workbench[data-layout='desktop'] .wb-structure {
  position: absolute;
  right: var(--wb-rail-width, 0px);
  bottom: 0;
  width: var(--wb-sidebar-live-width, var(--wb-sidebar-width));
  z-index: 3;
  border-left: 1px solid var(--ps-border);
}

.workbench[data-layout='desktop'][data-structure='none'] .wb-structure {
  height: 44px;
}

.workbench[data-layout='desktop'][data-structure='docked'] .wb-structure {
  top: var(--wb-legend-height);
}

.workbench[data-layout='narrow'] .wb-structure {
  border-top: 1px solid var(--ps-border);
}

.workbench[data-layout='narrow'][data-structure='docked'] .wb-structure {
  height: 420px;
}

.wb-divider {
  flex: none;
  display: grid;
  place-items: center;
  height: 9px;
  box-sizing: border-box;
  border-top: 1px solid var(--ps-border);
  cursor: row-resize;
  touch-action: none;
}

.wb-divider::before {
  content: '';
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: var(--ps-border-strong);
}

.wb-divider:hover::before,
.wb-divider:focus-visible::before {
  background: var(--ps-text-muted);
}

.wb-divider:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: calc(-1 * var(--ps-focus-width));
}

.workbench:not([data-layout='desktop']) .wb-divider,
.workbench:not([data-structure='docked']) .wb-divider {
  display: none;
}

.wb-structure-empty {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--ps-space-2);
  height: 44px;
  box-sizing: border-box;
  padding: 0 var(--ps-space-2) 0 var(--ps-space-3);
  color: var(--ps-text-muted);
}

.workbench[data-layout='desktop'] .wb-structure-empty {
  border-top: 1px solid var(--ps-border);
}

.wb-structure-empty-title {
  color: var(--ps-text);
  font-weight: var(--ps-weight-semibold);
}

.wb-structure-empty-hint {
  min-width: 0;
  overflow: hidden;
  font-size: var(--ps-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workbench:not([data-structure='none']) .wb-structure-empty {
  display: none;
}

/* Outer rules beat the viewer's :host rules: no card chrome, and it fills the section. */
.workbench #myStructureViewer {
  flex: 1 1 0;
  width: 100%;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.workbench[data-structure='none'] #myStructureViewer {
  display: none;
}
```

In `apps/web/src/custom-elements.d.ts`, in the `'protspace-structure-viewer'` entry, delete the `title?: string;`, `'show-tips'?: string;` and `'auto-show'?: string;` members (the controller sets those as properties).

In `apps/web/src/explore/runtime.ts`:

1. Add the imports:

```ts
import { DESKTOP_MIN_WIDTH } from './layout-defaults';
import { createStructureController } from './structure-controller';
```

2. Directly after `const lifecycle = createLifecycle();` (which follows the `getElements()` destructuring), add:

```ts
  // What the structure viewer shows and when: a protein loads only where it can be seen.
  const structureController = createStructureController({
    viewer: structureViewer,
    desktopQuery: window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`),
  });
  lifecycle.addCleanup(() => structureController.dispose());
```

3. In `createInteractionController({ … })`, replace `structureViewer,` with `requestStructure: (proteinId) => structureController.request(proteinId),`.
4. In the `ExploreControls` object, replace the body of `clearStructure` (today's viewer hide, `structureViewer.style.display = 'none'`) with `structureController.clear();`.
5. Delete the `addTrackedEventListener(lifecycle, structureViewer, 'structure-close', interactionController.handleStructureClose);` call (:374-379); keep the `structure-load` and `structure-error` listeners.

- [ ] **Step 9: Run the task's tests**

Run: `pnpm --filter @protspace/core build`, then (sandbox disabled) `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure`
Expected: PASS, 5 tests. At 1280×720 the column is 628 px (720 − 48 − 44), so the legend and structure share 619 px: the drag leaves the divider at about 40, ArrowDown makes it 45 and Shift+ArrowUp 25, all inside the 120 and 220 px minimums.

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench src/explore/structure-controller.test.ts src/explore/workbench-status.test.ts src/explore/interaction-controller.test.ts src/explore/interaction-controller.eat.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS; the count before this task plus one case.

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; the count before plus the two new files and the new cases (the data-renderer and dataset-controller tests go through `ExploreControls.clearStructure`, unchanged by this task).

Run: `pnpm type-check && pnpm knip`
Expected: clean. (`splitSidebar`, `fractionStep`, `createStructureController`, `isStructureVisible` and the five helpers each have a consumer in this commit.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in Chromium: `workbench-helpers`, `workbench-shell` (the same `#myStructureViewer` instance across 951 px), the narrow checks in `eat-visualization.spec.ts` and `dataset-reload.spec.ts` (:611 dispatches on `#myStructureViewer`).

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS, every budget unchanged. In `search-select`, the pick shows the docked structure, its reset finds `#myStructureViewer` visible, clicks `.close-button` and sees it hidden (`data-structure="none"` hides the viewer).

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --write apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/src/explore/runtime.ts apps/web/src/explore/interaction-controller.ts apps/web/src/explore/interaction-controller.test.ts apps/web/src/explore/interaction-controller.eat.test.ts apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts apps/web/src/custom-elements.d.ts packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-structure.spec.ts
git add apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/src/explore/runtime.ts apps/web/src/explore/interaction-controller.ts apps/web/src/explore/interaction-controller.test.ts apps/web/src/explore/interaction-controller.eat.test.ts apps/web/src/explore/workbench-status.ts apps/web/src/explore/workbench-status.test.ts apps/web/src/custom-elements.d.ts packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-structure.spec.ts
git commit -m "feat(web): dock the structure under the legend with a divider"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.12: Sidebar rail, collapse and resize

The sidebar gets its 44 px icon rail (decision 2), which stays when the sidebar collapses: Legend, Structure (with a dot while a protein waits) and, at its foot, Collapse or Expand. Collapsing, expanding and dragging the left edge resize the plot exactly once (decision 4): opening slides the sidebar in over the plot and then commits the plot's width; closing commits first and slides out after; a drag previews over the plot and commits on release. Width and open state persist. A `panel-toggle` perf segment holds the budget, and every perf run pins the layout and the light colour scheme.

**Files:**

- Create: `apps/web/src/workbench/Rail.tsx`, `use-sidebar-transition.ts`
- Modify: `apps/web/src/workbench/Workbench.tsx`, `Sidebar.tsx`, `StructurePanel.tsx`, `workbench.css`, `layout-geometry.ts`, `layout-geometry.test.ts`, `apps/web/src/explore/layout-defaults.ts`, `packages/core/src/components/kit/icon.ts` (`list`, `box`, `panel-right-close`, `panel-right-open`), `packages/core/src/styles/theme.ts` (re-adds `--ps-duration`, which Task 1.11 removed), `apps/web/src/custom-elements.d.ts` (`expanded` on the kit buttons)
- Modify: `apps/web/tests/helpers/tour-storage-state.ts`, `apps/web/tests/helpers/perf/scenarios.ts` (`SEGMENTS` :47-61, `newPerfContext` :140-146, segments), `apps/web/tests/perf/budgets.json`, `perf/README.md` (`--scenarios` row :128), `apps/web/tests/perf-scale.spec.ts` (:148), `apps/web/tests/helpers/explore.ts` (`rail`, `collapseSidebar`, `expandSidebar`, `dragSidebarEdge`, `seedLayout`, `readLayout`)
- Create: `apps/web/tests/workbench-sidebar.spec.ts`

**Interfaces:**

- Consumes: the layout store and hooks (2.2); `structureProteinId` (2.11); the structure section, which slides with the aside (2.11); `isStructureVisible` (2.11); `ps-icon-button` (`pressed`, `tooltip-placement`); `window.__protspacePerfCounters` under `?perfCounters=1`; `TOUR_STORAGE_KEY`.
- Produces:
  - `layout-defaults.ts`: `RAIL_WIDTH = 44`, `MIN_PLOT_WIDTH = 480`.
  - `layout-geometry.ts`: `clampSidebarToWindow(width: number, windowWidth: number): number` (at most `windowWidth − RAIL_WIDTH − MIN_PLOT_WIDTH`, at least 240 when that fits; render only); `sidebarStep(key: string, shift: boolean, width: number): number` (ArrowLeft +16, ArrowRight −16, four times that with Shift, Home → 240, End → 480, clamped); `type SidebarPhase = 'open' | 'opening' | 'closing' | 'collapsed'`; `plotRightInset(phase: SidebarPhase, width: number): number` (`open` → width + rail; `opening`, `closing` and `collapsed` → rail only, so the plot changes once per toggle).
  - `use-sidebar-transition.ts`: `useSidebarTransition(open: boolean, targets: { aside: RefObject<HTMLElement | null>; structure: RefObject<HTMLElement | null> }): SidebarPhase` (WAAPI slide of the aside and the docked structure; commits on `Animation.finished`, at once under reduced motion).
  - DOM: root `data-sidebar="open|opening|closing|collapsed"`; `--wb-rail-width: 44px`; `--wb-sidebar-live-width` (the drag preview; equals the committed width otherwise); collapsed, the aside and the docked structure keep their size and are `visibility: hidden` and `inert`, with no transform left once the slide has finished; `nav[data-workbench="rail"][aria-label="Panels"]` with `ps-icon-button`s "Legend" (`list`; `pressed` while open; opens the sidebar or collapses it), "Structure: <id>" (`box`; a 7 px accent dot with a 2 px ring while a protein is available; opens the sidebar when docked and collapsed) or "Structure: click a protein to view it" (disabled), and at the foot "Collapse sidebar" or "Expand sidebar" (`panel-right-close`/`panel-right-open`, `aria-expanded`, `aria-controls="wb-sidebar"`), tooltips to the left; `div[role="separator"][aria-orientation="vertical"][aria-label="Resize sidebar"][aria-controls="wb-sidebar"][data-workbench="sidebar-edge"]` with `aria-valuemin="240"`, `aria-valuemax="480"`, `aria-valuenow` (a pointer drag uses pointer capture, previews and commits on pointerup or lostpointercapture; keys commit on keyup; Enter toggles collapse). Below 951 px: no rail, no edge, the sidebar always shown.
  - Perf: `exploreStorageState(baseUrl: string, options?: { layout?: LayoutState }): BrowserContextOptions['storageState']` in `tests/helpers/tour-storage-state.ts` (the tour seen, plus the layout under `LAYOUT_STORAGE_KEY` when given); `tourCompletedStorageState(baseUrl)` returns `exploreStorageState(baseUrl)`. `newPerfContext` and `perf-scale.spec.ts` seed `DEFAULT_LAYOUT` and pass `colorScheme: 'light'`. Segment `'panel-toggle': { repeatable: true }`: act clicks "Collapse sidebar"; reset clicks "Expand sidebar" and waits for `data-sidebar="open"`; `pixels: true`; budget `{ restage: 0, restagePos: 0, restageStyle: 0, render: 1, processData: 0, gridRebuild: 1, legendUpdate: 0, legendRebuild: 0, glSync: 0, bufferBytes: 0, glIsPerRender: 0 }`; `perf/README.md` lists `panel` in the `--scenarios` row (:128) and says that perf runs pin the layout and the light colour scheme.
  - Helpers: `rail(page)`, `collapseSidebar(page)`, `expandSidebar(page)`, `dragSidebarEdge(page, dx: number)`, `seedLayout(page, patch: Partial<LayoutState>)` (an init script before navigation), `readLayout(page): Promise<LayoutState | null>`.
  - Implementation notes (no interface change): the collapse toggle's `aria-expanded` reaches the inner `<button>` through `PsIconButton.expanded` (the kit forwards it since the block 2 review, commit `1656f034`); the edge is exported from `Sidebar.tsx` as `SidebarEdge` and rendered by the workbench as a sibling of the aside, so it can sit above the structure section; `collapseSidebar` and `expandSidebar` wait for the phase to settle (`data-sidebar="collapsed"` / `"open"`), so the perf act covers the slide too.

**Tests:**

- `layout-geometry.test.ts` (unit): "clampSidebarToWindow keeps the plot at 480 px"; "sidebarStep handles arrows, Shift, Home and End within 240–480"; "plotRightInset moves the plot once per toggle".
- `apps/web/tests/workbench-sidebar.spec.ts` (e2e):
  - "the rail keeps Legend, Structure and Collapse sidebar, named for assistive tech, when collapsed"
  - "collapsing widens #myPlot by the sidebar width with one render, and expanding narrows it with one" (perf counters)
  - "with reduced motion, collapse and expand still resize the plot once each" (Review Focus 3)
  - "dragging the edge previews over the plot and resizes it once on release, clamped to 240–480"
  - "the edge separator moves by keyboard and commits once"
  - "width and collapsed state survive a reload, and layout never reaches the URL"
  - "a corrupt or oversized stored layout loads safely": garbage loads the defaults; a stored 480 px on a 1000 px window keeps the plot at least 480 px (Review Focus 2)
  - "a zoomed-in view keeps its centre protein across collapse and expand" (within 2 px)
  - "the legend settings dialog is fully visible after collapse and expand" (Review Focus 5)
  - "a protein clicked while collapsed waits behind the Structure dot; Structure opens the sidebar and loads it"
- `pnpm perf:counts` passes with `panel-toggle` (record it once with `PERF_UPDATE_BUDGETS=1` and review the diff); the other segments' budgets are unchanged.

Every command runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `Workbench.tsx`, `Sidebar.tsx` and `workbench.css` are Task 2.2's, with Task 2.11's edits; the anchors below use the names those tasks gave (`useLayout()`'s `layout`, `useLayoutMode()`'s result, `structureProteinId`, `legendFraction`, `setLegendFractionPreview`, `structure`). Read each file before editing it.

- [ ] **Step 1: Write the failing geometry tests**

In `apps/web/src/workbench/layout-geometry.test.ts`, change the import to:

```ts
import {
  clampSidebarToWindow,
  fractionStep,
  plotRightInset,
  sidebarStep,
  splitSidebar,
} from './layout-geometry';
```

and append:

```ts
describe('clampSidebarToWindow', () => {
  it('clampSidebarToWindow keeps the plot at 480 px', () => {
    expect(clampSidebarToWindow(300, 1280)).toBe(300);
    expect(clampSidebarToWindow(480, 1280)).toBe(480);
    // 1000 − 44 (rail) − 480 (plot) leaves the sidebar 476 px.
    expect(clampSidebarToWindow(480, 1000)).toBe(476);
    expect(clampSidebarToWindow(300, 951)).toBe(300);
    expect(clampSidebarToWindow(480, 951)).toBe(427);
    // Narrower still, the sidebar keeps its own 240 px minimum.
    expect(clampSidebarToWindow(300, 700)).toBe(240);
  });
});

describe('sidebarStep', () => {
  it('sidebarStep handles arrows, Shift, Home and End within 240–480', () => {
    expect(sidebarStep('ArrowLeft', false, 300)).toBe(316);
    expect(sidebarStep('ArrowRight', false, 300)).toBe(284);
    expect(sidebarStep('ArrowLeft', true, 300)).toBe(364);
    expect(sidebarStep('ArrowRight', true, 300)).toBe(240);
    expect(sidebarStep('ArrowLeft', false, 476)).toBe(480);
    expect(sidebarStep('Home', false, 300)).toBe(240);
    expect(sidebarStep('End', true, 300)).toBe(480);
    expect(sidebarStep('Tab', false, 300)).toBe(300);
  });
});

describe('plotRightInset', () => {
  it('plotRightInset moves the plot once per toggle', () => {
    expect(plotRightInset('open', 300)).toBe(344);
    // Closing widens the plot at once, under the sidebar that is still sliding out.
    expect(plotRightInset('closing', 300)).toBe(44);
    expect(plotRightInset('collapsed', 300)).toBe(44);
    // Opening slides the sidebar in over the plot; the plot narrows only once it is open.
    expect(plotRightInset('opening', 300)).toBe(44);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts`
Expected: FAIL: `clampSidebarToWindow is not a function` (and likewise `sidebarStep`, `plotRightInset`); the three Task 2.11 cases still pass.

- [ ] **Step 3: Add the constants and the geometry**

Append to `apps/web/src/explore/layout-defaults.ts`:

```ts
/** The icon rail at the sidebar's right edge, shown at desktop widths. */
export const RAIL_WIDTH = 44;
/** The plot keeps at least this width beside a sidebar at desktop widths (rendering clamps the sidebar). */
export const MIN_PLOT_WIDTH = 480;
```

In `apps/web/src/workbench/layout-geometry.ts`, add at the top:

```ts
import { MIN_PLOT_WIDTH, RAIL_WIDTH, SIDEBAR_WIDTH } from '../explore/layout-defaults';
```

and append:

```ts
/** One arrow key moves the sidebar edge this many pixels; Shift moves four times as far. */
const WIDTH_STEP = 16;

/**
 * The sidebar width to render in a window this wide: the stored width, narrowed so the plot keeps
 * 480 px beside the sidebar and the 44 px rail, but never below the sidebar's 240 px minimum.
 * Render only: the store keeps the user's width for a wider window.
 */
export function clampSidebarToWindow(width: number, windowWidth: number): number {
  return Math.min(width, Math.max(SIDEBAR_WIDTH.min, windowWidth - RAIL_WIDTH - MIN_PLOT_WIDTH));
}

/**
 * The width the sidebar edge's keys ask for (the WAI-ARIA window splitter): ArrowLeft widens the
 * sidebar by 16 px and ArrowRight narrows it, four times as far with Shift; Home and End go to 240
 * and 480 px. Other keys keep `width`. The result stays within 240–480.
 */
export function sidebarStep(key: string, shift: boolean, width: number): number {
  const step = shift ? 4 * WIDTH_STEP : WIDTH_STEP;
  let next = width;
  if (key === 'ArrowLeft') next = width + step;
  else if (key === 'ArrowRight') next = width - step;
  else if (key === 'Home') next = SIDEBAR_WIDTH.min;
  else if (key === 'End') next = SIDEBAR_WIDTH.max;
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, next));
}

/** Where the sidebar is in its slide: settled open or collapsed, or sliding either way. */
export type SidebarPhase = 'open' | 'opening' | 'closing' | 'collapsed';

/**
 * The plot's right inset: the sidebar and the rail while open, the rail alone otherwise. Opening
 * slides the sidebar over the plot and narrows the plot only once it is open; closing widens the
 * plot at once, under the sliding sidebar. Either way the plot's box changes once (decision 4).
 */
export function plotRightInset(phase: SidebarPhase, width: number): number {
  return phase === 'open' ? width + RAIL_WIDTH : RAIL_WIDTH;
}
```

- [ ] **Step 4: Run the geometry tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing e2e spec and its helpers**

In `apps/web/tests/helpers/explore.ts`, add below the `@playwright/test` import:

```ts
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  type LayoutState,
} from '../../src/explore/layout-defaults';
```

and append:

```ts
/** The icon rail at the sidebar's right edge. */
export function rail(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Panels' });
}

/** Collapses the sidebar from the rail and waits until its slide has ended. */
export async function collapseSidebar(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'collapsed');
}

/** Expands the sidebar from the rail and waits until it is open and the plot has narrowed. */
export async function expandSidebar(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'open');
}

/** Drags the sidebar's left edge by `dx` pixels (negative widens the sidebar) and releases it. */
export async function dragSidebarEdge(page: Page, dx: number): Promise<void> {
  const box = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
  if (!box) throw new Error('The sidebar edge is not shown');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

/** Stores `patch` over the default layout before every navigation of `page`. */
export async function seedLayout(page: Page, patch: Partial<LayoutState>): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: LAYOUT_STORAGE_KEY,
    value: JSON.stringify({ ...DEFAULT_LAYOUT, ...patch }),
  });
}

/** The layout protspace:layout:v1 holds, or null when nothing readable is stored. */
export async function readLayout(page: Page): Promise<LayoutState | null> {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as LayoutState);
    } catch {
      return null;
    }
  }, LAYOUT_STORAGE_KEY);
}
```

Create `apps/web/tests/workbench-sidebar.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY } from '../src/explore/layout-defaults';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  dragSidebarEdge,
  expandSidebar,
  openExplore,
  rail,
  readLayout,
  seedLayout,
  sidebar,
  stubStructureRequests,
  waitForExploreDataLoad,
  watchPlotResizes,
} from './helpers/explore';

const workbench = (page: Page) => page.locator('.workbench');
const edge = (page: Page) => page.getByRole('separator', { name: 'Resize sidebar' });

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Renders the plot has drawn, from the perf counters (`?perfCounters=1`). */
function renders(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __protspacePerfCounters: { render: number } })
        .__protspacePerfCounters.render,
  );
}

/** The render count once it has stopped moving, so a test's own renders start from rest. */
async function settledRenders(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await renders(page);
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
  return last;
}

/** Both resizes of a toggle, each with one render: collapse, then expand back. */
async function expectOneResizePerToggle(page: Page): Promise<void> {
  const plot = page.locator('#myPlot');
  const open = (await plot.boundingBox())!;
  const resizes = await watchPlotResizes(page);
  const before = await settledRenders(page);

  await collapseSidebar(page);
  expectNear((await plot.boundingBox())!.width - open.width, DEFAULT_LAYOUT.sidebarWidth);
  expect(await resizes()).toBe(1);
  const collapsed = await settledRenders(page);
  expect(collapsed - before).toBe(1);

  await expandSidebar(page);
  expect(await plot.boundingBox()).toEqual(open);
  expect(await resizes()).toBe(2);
  expect((await settledRenders(page)) - collapsed).toBe(1);
}

type PlotProbe = HTMLElement & {
  _plotData: {
    length: number;
    xs: ArrayLike<number>;
    ys: ArrayLike<number>;
    proteinIds: string[];
    originalIndices: ArrayLike<number> | null;
  };
  _scales: { x(value: number): number };
  _transform: { k: number };
  dataToClient(x: number, y: number): { x: number; y: number } | null;
  getProteinClientPosition(id: string): { x: number; y: number } | null;
};

/** The protein drawn nearest the plot's centre, its offset from the centre, and px per data unit. */
function centreProtein(page: Page) {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as PlotProbe;
    const rect = plot.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    let best = { slot: -1, dx: 0, dy: 0, distance: Infinity };
    for (let slot = 0; slot < plot._plotData.length; slot++) {
      const at = plot.dataToClient(plot._plotData.xs[slot], plot._plotData.ys[slot]);
      if (!at) continue;
      const distance = Math.hypot(at.x - centreX, at.y - centreY);
      if (distance < best.distance) best = { slot, dx: at.x - centreX, dy: at.y - centreY, distance };
    }
    const index = plot._plotData.originalIndices?.[best.slot] ?? best.slot;
    return {
      id: plot._plotData.proteinIds[index],
      dx: best.dx,
      dy: best.dy,
      scale: (plot._scales.x(1) - plot._scales.x(0)) * plot._transform.k,
    };
  });
}

/** Where `id` is drawn now, relative to the plot's centre, and px per data unit. */
function offsetOf(page: Page, id: string) {
  return page.locator('#myPlot').evaluate((element, proteinId) => {
    const plot = element as PlotProbe;
    const rect = plot.getBoundingClientRect();
    const at = plot.getProteinClientPosition(proteinId)!;
    return {
      dx: at.x - (rect.left + rect.width / 2),
      dy: at.y - (rect.top + rect.height / 2),
      scale: (plot._scales.x(1) - plot._scales.x(0)) * plot._transform.k,
    };
  }, id);
}

test('the rail keeps Legend, Structure and Collapse sidebar, named for assistive tech, when collapsed', async ({
  page,
}) => {
  await openExplore(page);
  const panels = rail(page);
  const legend = panels.getByRole('button', { name: 'Legend', exact: true });
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await expect(
    panels.getByRole('button', { name: 'Structure: click a protein to view it' }),
  ).toBeDisabled();
  await expect(panels.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await collapseSidebar(page);

  await expect(panels).toBeVisible();
  expectNear((await panels.boundingBox())!.width, 44);
  await expect(legend).toHaveAttribute('aria-pressed', 'false');
  await expect(
    panels.getByRole('button', { name: 'Structure: click a protein to view it' }),
  ).toBeVisible();
  await expect(panels.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(sidebar(page)).toHaveAttribute('inert', '');
  await expect(page.locator('#myLegend')).toBeHidden();
  await expect(edge(page)).toBeHidden();

  // Legend opens the sidebar again.
  await legend.click();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myLegend')).toBeVisible();
});

test('collapsing widens #myPlot by the sidebar width with one render, and expanding narrows it with one', async ({
  page,
}) => {
  await openExplore(page, '?perfCounters=1');
  await expectOneResizePerToggle(page);
});

test('with reduced motion, collapse and expand still resize the plot once each', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExplore(page, '?perfCounters=1');
  await expectOneResizePerToggle(page);
});

test('dragging the edge previews over the plot and resizes it once on release, clamped to 240–480', async ({
  page,
}) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const start = (await plot.boundingBox())!;
  const resizes = await watchPlotResizes(page);
  const box = (await edge(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 10 });
  // Mid-drag the sidebar is wider, over the plot; the plot itself has not changed.
  await expect.poll(async () => (await sidebar(page).boundingBox())!.width).toBe(400);
  expect(await plot.boundingBox()).toEqual(start);
  expect(await resizes()).toBe(0);
  await page.mouse.up();

  await expect.poll(async () => (await plot.boundingBox())!.width).toBe(start.width - 100);
  expect(await resizes()).toBe(1);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '400');
  expect((await readLayout(page))?.sidebarWidth).toBe(400);

  await dragSidebarEdge(page, -300);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '480');
  await dragSidebarEdge(page, 400);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '240');
  expect((await readLayout(page))?.sidebarWidth).toBe(240);
});

test('the edge separator moves by keyboard and commits once', async ({ page }) => {
  await openExplore(page);
  const resizes = await watchPlotResizes(page);
  await edge(page).focus();

  // A held key repeats keydown; the width is written once, on keyup.
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '348');
  expect(await resizes()).toBe(0);
  await page.keyboard.up('ArrowLeft');
  await expect.poll(resizes).toBe(1);
  expect((await readLayout(page))?.sidebarWidth).toBe(348);

  await page.keyboard.press('End');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '480');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '416');
  await page.keyboard.press('Home');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '240');
  await expect.poll(resizes).toBe(4);

  // Enter collapses; focus moves to the control that brings the sidebar back.
  await page.keyboard.press('Enter');
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'collapsed');
  await expect(rail(page).getByRole('button', { name: 'Expand sidebar' })).toBeFocused();
});

test('width and collapsed state survive a reload, and layout never reaches the URL', async ({
  page,
}) => {
  await openExplore(page);
  await dragSidebarEdge(page, -60);
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '360');
  await collapseSidebar(page);
  expect(await readLayout(page)).toMatchObject({ sidebarWidth: 360, sidebarOpen: false });

  await page.reload();
  await waitForExploreDataLoad(page);
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'collapsed');
  await expandSidebar(page);
  expectNear((await sidebar(page).boundingBox())!.width, 360);

  const url = new URL(page.url());
  const allowed = ['dataset', 'annotation', 'projection', 'tooltip', 'density'];
  expect([...url.searchParams.keys()].filter((key) => !allowed.includes(key))).toEqual([]);
  expect(url.href).not.toMatch(/sidebar|layout|legendFraction|floating/i);
});

test('a corrupt or oversized stored layout loads safely', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, '{"sidebarWidth": "wide", oops'),
    LAYOUT_STORAGE_KEY,
  );
  await openExplore(page);
  expectNear((await sidebar(page).boundingBox())!.width, DEFAULT_LAYOUT.sidebarWidth);
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  expect(errors).toEqual([]);

  // Init scripts run in order on every navigation: this one now wins.
  await seedLayout(page, { sidebarWidth: 480 });
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.reload();
  await waitForExploreDataLoad(page);
  expect((await page.locator('#myPlot').boundingBox())!.width).toBeGreaterThanOrEqual(480);
  expectNear((await sidebar(page).boundingBox())!.width, 476);
  // Clamping at render never rewrites what the user stored.
  expect((await readLayout(page))?.sidebarWidth).toBe(480);
  expect(errors).toEqual([]);
});

test('a zoomed-in view keeps its centre protein across collapse and expand', async ({ page }) => {
  await openExplore(page);
  const box = (await page.locator('#myPlot').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -240);
  await expect
    .poll(() => page.locator('#myPlot').evaluate((plot) => (plot as PlotProbe)._transform.k))
    .toBeGreaterThan(2);
  const start = await centreProtein(page);

  await collapseSidebar(page);
  const collapsed = await offsetOf(page, start.id);
  // The data at the centre stays at the centre; offsets from it scale with the fit.
  const ratio = collapsed.scale / start.scale;
  expectNear(collapsed.dx, start.dx * ratio, 2);
  expectNear(collapsed.dy, start.dy * ratio, 2);

  await expandSidebar(page);
  const back = await offsetOf(page, start.id);
  expectNear(back.dx, start.dx, 2);
  expectNear(back.dy, start.dy, 2);
});

test('the legend settings dialog is fully visible after collapse and expand', async ({ page }) => {
  await openExplore(page);
  await collapseSidebar(page);
  await expandSidebar(page);

  await page.locator('protspace-legend').getByRole('button', { name: 'Legend settings' }).click();
  const overlay = page.locator('protspace-legend .modal-overlay');
  await expect(overlay).toBeVisible();
  // position: fixed; inset: 0 covers the viewport only while no ancestor keeps a transform.
  const viewport = page.viewportSize()!;
  expect(await overlay.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  // Nothing of the shell paints over it: not the rail, not the structure footer under the legend.
  for (const [x, y] of [
    [viewport.width - 22, viewport.height / 2],
    [viewport.width - 200, viewport.height - 22],
  ]) {
    const legendOnTop = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px, py) === document.querySelector('protspace-legend'),
      [x, y],
    );
    expect(legendOnTop, `${x},${y}`).toBe(true);
  }
  await page.keyboard.press('Escape');
});

test('a protein clicked while collapsed waits behind the Structure dot; Structure opens the sidebar and loads it', async ({
  page,
}) => {
  await stubStructureRequests(page);
  await openExplore(page);
  await collapseSidebar(page);

  const id = await clickProteinNearPlotCentre(page);

  const structure = rail(page).getByRole('button', { name: `Structure: ${id}` });
  await expect(structure).toBeEnabled();
  await expect(rail(page).locator('[data-workbench="structure-dot"]')).toBeVisible();
  // Hidden structures load nothing.
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);

  await structure.click();
  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
});
```

- [ ] **Step 6: Run the spec to see it fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-sidebar`
Expected: FAIL: there is no `navigation` named "Panels" and no separator named "Resize sidebar", so the rail, edge and toggle cases time out; the two layout cases fail on the missing edge or the missing `data-sidebar` attribute; "a corrupt or oversized stored layout" fails on the 476 px sidebar (the sidebar renders its stored 480 px).

- [ ] **Step 7: Add the rail's icons**

In `packages/core/src/components/kit/icon.ts`, add `Box`, `List`, `PanelRightClose` and `PanelRightOpen` to the `lucide` import, and to `ICONS` (keeping the map in alphabetical order):

```ts
  box: Box,
  list: List,
  'panel-right-close': PanelRightClose,
  'panel-right-open': PanelRightOpen,
```

- [ ] **Step 8: Write the slide**

The slide reads the theme's panel duration, which Task 1.11 trimmed as unused. In `packages/core/src/styles/theme.ts`, in the `sizes` block, add directly after `--ps-duration-fast: 120ms;`:

```css
  --ps-duration: 160ms; /* panels: the sidebar's slide */
```

The style lint's "uses every token theme.ts defines" check scans `apps/web/src` too, so the read in `use-sidebar-transition.ts` counts.

Create `apps/web/src/workbench/use-sidebar-transition.ts`:

```ts
import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { SidebarPhase } from './layout-geometry';

interface SlideTargets {
  aside: RefObject<HTMLElement | null>;
  /** The structure section while it sits in the sidebar column (not floating). */
  structure: RefObject<HTMLElement | null>;
}

/** The theme's panel duration and easing (design decision 8), read where theme.ts sets them. */
function slideTiming(): KeyframeAnimationOptions {
  const style = getComputedStyle(document.documentElement);
  // No fallback: a missing --ps-duration makes animate() throw, which the e2e suite catches.
  return {
    duration: Number.parseFloat(style.getPropertyValue('--ps-duration')),
    easing: style.getPropertyValue('--ps-ease').trim(),
  };
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The sidebar's slide (design decision 4). Opening reports 'opening' (the sidebar shows over the
 * plot and slides in) and then 'open', which narrows the plot; closing reports 'closing' at once,
 * which widens the plot under the still-shown sidebar, then slides it out before 'collapsed'.
 * Either way the plot's box changes once (see plotRightInset).
 *
 * The slide is a Web Animation without fill, so no transform stays on the sidebar at rest: the
 * legend's fixed-position dialogs need an ancestor without one. The phase follows
 * `Animation.finished`, never `transitionend`, which a 0 ms transition does not fire; under
 * reduced motion there is no slide and the phase settles at once, in the same order.
 */
export function useSidebarTransition(open: boolean, targets: SlideTargets): SidebarPhase {
  const [phase, setPhase] = useState<SidebarPhase>(open ? 'open' : 'collapsed');
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    // React's "adjust state while rendering": the phase moves in the same render as `open`.
    setShownOpen(open);
    if (prefersReducedMotion()) setPhase(open ? 'open' : 'collapsed');
    else setPhase(open ? 'opening' : 'closing');
  }

  const { aside, structure } = targets;
  useLayoutEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return;
    const settled: SidebarPhase = phase === 'opening' ? 'open' : 'collapsed';
    // Off to the right by its own width, under the rail.
    const away: Keyframe = { transform: 'translateX(100%)' };
    const rest: Keyframe = { transform: 'none' };
    const timing = slideTiming();
    const animations = [aside.current, structure.current]
      .filter((element): element is HTMLElement => element !== null)
      .map((element) => element.animate(phase === 'opening' ? [away, rest] : [rest, away], timing));
    let cancelled = false;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        // Commit before the frame paints the sidebar back at rest (the animation has no fill).
        if (!cancelled) flushSync(() => setPhase(settled));
      },
      () => {
        // Cancelled: a toggle in mid-slide or an unmount; the next phase owns the sidebar now.
      },
    );
    return () => {
      cancelled = true;
      for (const animation of animations) animation.cancel();
    };
  }, [phase, aside, structure]);

  return phase;
}
```

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles`
Expected: PASS: the lint's token checks find `--ps-duration` defined and read.

- [ ] **Step 9: Write the rail and the edge**

The collapse toggle sets `expanded` on `ps-icon-button`, which the JSX typings do not list yet. In `apps/web/src/custom-elements.d.ts`, replace

```ts
type ButtonKeys = 'variant' | 'size' | 'disabled' | 'describedBy';
```

with

```ts
type ButtonKeys = 'variant' | 'size' | 'disabled' | 'describedBy' | 'expanded';
```

(both kit buttons forward `expanded`, a `'true' | 'false'` string, to their inner button as `aria-expanded` since the block 2 review).

Create `apps/web/src/workbench/Rail.tsx`:

```tsx
import type { Ref } from 'react';
import { updateLayout } from '../explore/layout-state';

interface RailProps {
  sidebarOpen: boolean;
  /** The protein the structure viewer shows or waits to show; null for none. */
  structureProteinId: string | null;
  /** Whether the structure sits in the sidebar column rather than floating over the plot. */
  structureDocked: boolean;
  /** The collapse toggle, for a caller that moves focus to it. */
  toggleRef?: Ref<HTMLElement>;
}

/**
 * The 44 px icon rail at the sidebar's right edge (design decision 2). It stays when the sidebar
 * collapses, so the legend and a waiting structure stay one click away. Hidden below 951 px.
 */
export function Rail({ sidebarOpen, structureProteinId, structureDocked, toggleRef }: RailProps) {
  const toggleSidebar = () => updateLayout({ sidebarOpen: !sidebarOpen });
  // A docked structure in a collapsed sidebar waits; opening the sidebar loads it.
  const showStructure = () => {
    if (structureDocked && !sidebarOpen) updateLayout({ sidebarOpen: true });
  };
  return (
    <nav className="wb-rail" data-workbench="rail" aria-label="Panels">
      <ps-icon-button
        icon="list"
        label="Legend"
        tooltip-placement="left"
        pressed={sidebarOpen}
        onClick={toggleSidebar}
      ></ps-icon-button>
      <span className="wb-rail-item">
        <ps-icon-button
          icon="box"
          label={
            structureProteinId === null
              ? 'Structure: click a protein to view it'
              : `Structure: ${structureProteinId}`
          }
          tooltip-placement="left"
          disabled={structureProteinId === null}
          onClick={showStructure}
        ></ps-icon-button>
        {structureProteinId !== null && (
          <span className="wb-rail-dot" data-workbench="structure-dot" aria-hidden="true"></span>
        )}
      </span>
      <span className="wb-rail-spacer" aria-hidden="true"></span>
      <ps-icon-button
        ref={toggleRef}
        icon={sidebarOpen ? 'panel-right-close' : 'panel-right-open'}
        label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        tooltip-placement="left"
        expanded={sidebarOpen ? 'true' : 'false'}
        aria-controls="wb-sidebar"
        onClick={toggleSidebar}
      ></ps-icon-button>
    </nav>
  );
}
```

Replace `apps/web/src/workbench/Sidebar.tsx` (Task 2.11's version: the memoised aside with `#myLegend`) with:

```tsx
import { memo, useRef, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { SIDEBAR_WIDTH } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { sidebarStep } from './layout-geometry';

interface SidebarProps {
  ref?: Ref<HTMLElement>;
  /** A collapsed or collapsing sidebar: out of the tab order and the accessibility tree. */
  inert?: boolean;
}

/**
 * The flush right sidebar (design decision 2): the legend, above the structure section that
 * StructurePanel renders as the aside's sibling, so placing the structure never moves either
 * element. Memoised: it re-renders only when the sidebar becomes inert or interactive again, and
 * the legend is never re-created or moved. The ref is the slide's target (use-sidebar-transition).
 */
export const Sidebar = memo(function Sidebar({ ref, inert }: SidebarProps) {
  return (
    <aside ref={ref} inert={inert} id="wb-sidebar" data-workbench="sidebar" aria-label="Sidebar">
      <protspace-legend
        id="myLegend"
        data-driver-id="legend"
        auto-sync="true"
        auto-hide="true"
        scatterplot-selector="#myPlot"
      ></protspace-legend>
    </aside>
  );
});

interface SidebarEdgeProps {
  /** The width shown: the drag or key preview, else the committed width. */
  width: number;
  /** The widest this window allows (the plot keeps 480 px), at most 480. */
  maxWidth: number;
  onPreview(width: number | null): void;
  onCollapse(): void;
}

const EDGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * The sidebar's draggable left edge (design decisions 2 and 4; the WAI-ARIA window splitter). A
 * drag or an arrow key previews the width through --wb-sidebar-live-width, which moves the sidebar
 * over the plot without resizing it; the width is written once, on release or keyup, and the plot
 * resizes once. Enter collapses the sidebar. Rendered by the workbench as the aside's sibling, so
 * it sits above the structure section too.
 */
export function SidebarEdge({ width, maxWidth, onPreview, onCollapse }: SidebarEdgeProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const pending = useRef<number | null>(null);
  const clampWidth = (value: number) =>
    Math.min(maxWidth, Math.max(SIDEBAR_WIDTH.min, Math.round(value)));

  const preview = (next: number) => {
    pending.current = next;
    onPreview(next);
  };
  const commit = () => {
    const next = pending.current;
    pending.current = null;
    if (next !== null) updateLayout({ sidebarWidth: next });
    onPreview(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    // The sidebar is on the right: moving its edge left widens it.
    preview(clampWidth(start.startWidth + start.startX - event.clientX));
  };
  const onPointerEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCollapse();
      return;
    }
    if (!EDGE_KEYS.has(event.key)) return;
    event.preventDefault();
    preview(Math.min(maxWidth, sidebarStep(event.key, event.shiftKey, pending.current ?? width)));
  };
  const onKeyUp = () => {
    if (!drag.current && pending.current !== null) commit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls="wb-sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      className="wb-sidebar-edge"
      data-workbench="sidebar-edge"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
}
```

In `apps/web/src/workbench/StructurePanel.tsx`, give the section a ref and `inert`: add `type Ref` to the `react` import, add to `StructurePanelProps`

```tsx
  ref?: Ref<HTMLElement>;
  /** Out of the tab order while the sidebar is collapsed or collapsing. */
  inert?: boolean;
```

destructure `ref` and `inert` in `StructurePanel(…)`, and add `ref={ref}` and `inert={inert}` to its `<section>`.

- [ ] **Step 10: Drive the phase from the workbench**

In `apps/web/src/workbench/Workbench.tsx`:

1. Change Task 2.11's `import { useState, type CSSProperties } from 'react';` to `import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';`, and add:

```tsx
import { SIDEBAR_WIDTH } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { clampSidebarToWindow, plotRightInset } from './layout-geometry';
import { Rail } from './Rail';
import { useSidebarTransition } from './use-sidebar-transition';
```

and change `import { Sidebar } from './Sidebar';` to `import { Sidebar, SidebarEdge } from './Sidebar';`.

2. Above `export function Workbench`, add:

```tsx
function subscribeWindowWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

const getWindowWidth = () => window.innerWidth;
```

3. In `Workbench()`, after Task 2.11's `const structure = …;`, add (with `mode` standing for the `useLayoutMode()` result the component already reads for `data-layout`):

```tsx
  const desktop = mode === 'desktop';
  const windowWidth = useSyncExternalStore(subscribeWindowWidth, getWindowWidth);
  const asideRef = useRef<HTMLElement>(null);
  const structureRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLElement>(null);
  // The edge's drag or key preview; null while the committed width shows.
  const [sidebarWidthPreview, setSidebarWidthPreview] = useState<number | null>(null);
  // The committed width this window can give the sidebar, so the plot keeps 480 px (render only).
  const sidebarWidth = clampSidebarToWindow(layout.sidebarWidth, windowWidth);
  const phase = useSidebarTransition(layout.sidebarOpen, {
    aside: asideRef,
    structure: structureRef,
  });
  // On desktop a collapsed or collapsing sidebar is inert; below 951 px it always shows.
  const sidebarHidden = desktop && (phase === 'collapsed' || phase === 'closing');
```

4. On the root `div.workbench`, add `data-sidebar={phase}` and `data-sidebar-resizing={sidebarWidthPreview !== null ? '' : undefined}`.
5. In the style object of `div.wb-body`, replace the `'--wb-sidebar-width'` entry (Task 2.2 set it from the stored width) with:

```tsx
          '--wb-sidebar-width': `${sidebarWidth}px`,
          '--wb-sidebar-live-width': `${sidebarWidthPreview ?? sidebarWidth}px`,
          '--wb-plot-right': `${plotRightInset(phase, sidebarWidth)}px`,
```

6. Replace `<Sidebar />` with `<Sidebar ref={asideRef} inert={sidebarHidden} />`, and add `ref={structureRef}` and `inert={sidebarHidden}` to `<StructurePanel …>`.
7. Directly after `<StructurePanel … />`, still inside `div.wb-body`, add:

```tsx
        <SidebarEdge
          width={sidebarWidthPreview ?? sidebarWidth}
          maxWidth={clampSidebarToWindow(SIDEBAR_WIDTH.max, windowWidth)}
          onPreview={setSidebarWidthPreview}
          onCollapse={() => {
            updateLayout({ sidebarOpen: false });
            // The edge hides with the sidebar: keep focus on the control that brings it back.
            railToggleRef.current?.focus();
          }}
        />
        <Rail
          sidebarOpen={layout.sidebarOpen}
          structureProteinId={structureProteinId}
          structureDocked={layout.structurePlacement === 'docked'}
          toggleRef={railToggleRef}
        />
```

In `apps/web/src/workbench/workbench.css`:

1. In Task 2.2's `[data-workbench='plot']` rule, change `inset: 0 var(--wb-sidebar-width) 0 0;` to `inset: 0 var(--wb-plot-right) 0 0;` (the narrow rule's `inset: auto` still overrides it below 951 px).
2. In Task 2.2's `[data-workbench='sidebar']` rule, change `right: 0;` to `right: var(--wb-rail-width);` and `width: var(--wb-sidebar-live-width);` (the narrow rule's `position: static` and `width: auto` still win below 951 px). Add no z-index there: the aside paints over the plot by DOM order (it follows `main`), and a z-index would make it a stacking context that traps the legend's `position: fixed` dialogs (`.modal-overlay`, `z-index: var(--z-modal)`) under the structure section, the edge and the rail.
3. Append:

```css
/* ── Rail, collapse and the sidebar edge (Task 2.12) ──────────────────────── */

.workbench[data-layout='desktop'] {
  --wb-rail-width: 44px;
}

/* The sidebar slides out past the rail; nothing may scroll it into view. */
.workbench[data-layout='desktop'] [data-workbench='body'] {
  overflow: clip;
}

/* A z-index would make the sidebar a stacking context and trap the legend's position: fixed
   dialogs under the structure, the edge and the rail. It is lifted over a floating card only while
   it slides or its edge is dragged, when no legend dialog is open. */
.workbench[data-sidebar='opening'] #wb-sidebar,
.workbench[data-sidebar='closing'] #wb-sidebar,
.workbench[data-sidebar-resizing] #wb-sidebar {
  z-index: 2;
}

/* Collapsed: laid out at full size (the legend and Mol* keep theirs), hidden and inert. */
.workbench[data-layout='desktop'][data-sidebar='collapsed'] #wb-sidebar,
.workbench[data-layout='desktop'][data-sidebar='collapsed'] .wb-structure {
  visibility: hidden;
}

.wb-sidebar-edge {
  display: none;
}

.workbench[data-layout='desktop'][data-sidebar='open'] .wb-sidebar-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(var(--wb-rail-width) + var(--wb-sidebar-live-width) - 4px);
  z-index: 4;
  display: block;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}

.wb-sidebar-edge::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 1px;
  width: 5px;
  height: 36px;
  margin-top: -18px;
  border-radius: 3px;
  background: var(--ps-border-strong);
}

.wb-sidebar-edge:hover::before,
.wb-sidebar-edge:focus-visible::before {
  background: var(--ps-text-muted);
}

.wb-sidebar-edge:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
}

.wb-rail {
  display: none;
}

.workbench[data-layout='desktop'] .wb-rail {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ps-space-1);
  width: var(--wb-rail-width);
  box-sizing: border-box;
  padding: var(--ps-space-2) 0;
  border-left: 1px solid var(--ps-border);
  background: var(--ps-surface-muted);
}

.wb-rail-item {
  position: relative;
  display: inline-flex;
}

.wb-rail-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: var(--ps-radius-full);
  background: var(--ps-accent);
  box-shadow: 0 0 0 2px var(--ps-surface-muted);
  pointer-events: none;
}

.wb-rail-spacer {
  flex: 1;
}
```

- [ ] **Step 11: Run the spec**

Run: `pnpm --filter @protspace/core build`, then (sandbox disabled) `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-sidebar workbench-structure workbench-shell`
Expected: PASS: 10 sidebar tests, Task 2.11's 5 structure tests (the section now slides and hides with the aside), and Task 2.2's shell tests (the plot's right edge is still the sidebar's left edge, 300 px wide).

- [ ] **Step 12: Pin the perf layout and add the `panel-toggle` segment**

Replace `apps/web/tests/helpers/tour-storage-state.ts` with:

```ts
import type { BrowserContextOptions } from '@playwright/test';
import { LAYOUT_STORAGE_KEY, type LayoutState } from '../../src/explore/layout-defaults';
import { TOUR_STORAGE_KEY } from '../../src/tour/storage-key';

/**
 * Explore's local storage for a Playwright context: the product tour's "already seen" flag, and a
 * stored layout when one is given.
 *
 * Playwright hands each run a fresh profile, so the tour's localStorage guard is always empty and
 * the tour auto-starts on `data-loaded`. Nothing dismisses it, so driver.js keeps a dimming overlay
 * and an animated popover composited over the canvas, which for the perf suite inflates the very
 * numbers it exists to produce (measured on 5K: clickPoint 28.35ms -> 7.00ms, zoomInOut 1.75ms ->
 * 1.17ms once suppressed). The perf suite also pins the layout: the sidebar's width sets the plot's
 * size, so an unpinned layout would make runs incomparable (design decision 4).
 *
 * Lives here rather than inline in each config so the keys and the origin they are scoped to
 * cannot drift apart: storage state is matched by origin, so a config seeding the right key against
 * the wrong origin silently seeds nothing. The keys come from the app modules that own them.
 */
export function exploreStorageState(
  baseUrl: string,
  options: { layout?: LayoutState } = {},
): BrowserContextOptions['storageState'] {
  const localStorage = [{ name: TOUR_STORAGE_KEY, value: 'true' }];
  if (options.layout) {
    localStorage.push({ name: LAYOUT_STORAGE_KEY, value: JSON.stringify(options.layout) });
  }
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage }] };
}

/** The tour already seen, and nothing else: what every e2e context starts with. */
export function tourCompletedStorageState(baseUrl: string): BrowserContextOptions['storageState'] {
  return exploreStorageState(baseUrl);
}
```

In `apps/web/tests/helpers/perf/scenarios.ts`:

1. Add `collapseSidebar` and `expandSidebar` to the import from `'../explore'`; replace `import { tourCompletedStorageState } from '../tour-storage-state';` with `import { exploreStorageState } from '../tour-storage-state';`; and add `import { DEFAULT_LAYOUT } from '../../../src/explore/layout-defaults';`.
2. In `SEGMENTS`, after `resize: { repeatable: true },`, add `'panel-toggle': { repeatable: true },`.
3. Replace `newPerfContext` with:

```ts
/**
 * A context with the viewport and pixel ratio the segments assume, past the tour, with the layout
 * and the colour scheme pinned: the sidebar's width sets the plot's size, which feeds the point
 * scale and the Auto contour strength, so an unpinned layout would make runs incomparable.
 */
export function newPerfContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  return browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    storageState: exploreStorageState(baseUrl, { layout: DEFAULT_LAYOUT }),
  });
}
```

4. In `buildSegments`, change the doc comment `/** Segments 2–11 in run order; …` to `/** Segments 2–12 in run order; …`, and add after the `resize` segment object:

```ts
    {
      name: 'panel-toggle',
      // Collapsing widens the plot under the sliding sidebar: one resize, one render and one grid
      // rebuild (design decision 4). The reset expands it back to the pinned width.
      act: () => collapseSidebar(page),
      reset: () => expandSidebar(page),
      pixels: true,
    },
```

In `apps/web/tests/perf-scale.spec.ts`, replace `import { tourCompletedStorageState } from './helpers/tour-storage-state';` with:

```ts
import { DEFAULT_LAYOUT } from '../src/explore/layout-defaults';
import { exploreStorageState } from './helpers/tour-storage-state';
```

and, in `openPage`'s `browser.newContext({ … })` (:145-149), replace `storageState: tourCompletedStorageState(BASE_URL),` with:

```ts
    colorScheme: 'light',
    storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT }),
```

In `apps/web/tests/perf/budgets.json`, add after the `"resize"` block:

```json
    "panel-toggle": {
      "restage": 0,
      "restagePos": 0,
      "restageStyle": 0,
      "render": 1,
      "processData": 0,
      "gridRebuild": 1,
      "legendUpdate": 0,
      "legendRebuild": 0,
      "glSync": 0,
      "bufferBytes": 0,
      "glIsPerRender": 0
    },
```

In `perf/README.md`:

1. In the first paragraph, change `wheel, resize, search, import.` to `wheel, resize, sidebar collapse, search, import.`
2. In the `--scenarios` row of the flag table (:128), change the meaning to `` `annotation`, `projection` (both switches), `legend`, `camera`, `resize`, `panel`, `search` ``.
3. After the paragraph that starts `Each segment runs settle → snapshot → act`, add:

```md
Every run pins the layout and the colour scheme. Its browser context stores `DEFAULT_LAYOUT`
(`apps/web/src/explore/layout-defaults.ts`) under `protspace:layout:v1`, so the sidebar is open at
its default width with the structure docked and closed, and asks for the light colour scheme. The
sidebar's width sets the plot's size, which feeds the point scale and the Auto contour strength,
so an unpinned layout would make runs incomparable.
```

- [ ] **Step 13: Run the perf counts and record the new segment**

Run (sandbox disabled; `pnpm perf:fetch --only phosphatase` once first if `perf/datasets/phosphatase.parquetbundle` is missing): `pnpm perf:counts`
Expected: PASS. `panel-toggle` reads restage 0, render 1, gridRebuild 1, bufferBytes 0B and pixels `same`; every other row is within its budget.

Run (sandbox disabled): `PERF_UPDATE_BUDGETS=1 pnpm perf:counts`, then `git diff apps/web/tests/perf/budgets.json`
Expected: only `recordedAt` changes (the recorded `panel-toggle` maxima equal the block above). If any other segment's numbers moved, restore those lines with `git checkout -p apps/web/tests/perf/budgets.json` and report it: the layout pin must not change the other segments' counts.

- [ ] **Step 14: Run the full suites**

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; the count before this task plus the three geometry cases.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS, count unchanged (the icon map grew and `theme.ts` regained `--ps-duration`, which the style lint finds read in `use-sidebar-transition.ts`).

Run: `pnpm type-check && pnpm knip`
Expected: clean. (`RAIL_WIDTH` and `MIN_PLOT_WIDTH` are read by `layout-geometry.ts`; the six helpers and `exploreStorageState` have consumers in this commit; `tourCompletedStorageState` is still used by both Playwright configs.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in Chromium. The plot is 44 px narrower than before (the rail); specs that measure the legend or the plot (`legend-double-click`, `numeric-binning` :1763-1773 at 1100 px, `eat-visualization`) stay green because the sidebar keeps its 300 px.

- [ ] **Step 15: Commit**

```bash
pnpm exec prettier --write apps/web/src/workbench/Rail.tsx apps/web/src/workbench/use-sidebar-transition.ts apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/workbench.css apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/explore/layout-defaults.ts packages/core/src/components/kit/icon.ts packages/core/src/styles/theme.ts apps/web/src/custom-elements.d.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/perf/scenarios.ts apps/web/tests/perf/budgets.json perf/README.md apps/web/tests/perf-scale.spec.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-sidebar.spec.ts
git add apps/web/src/workbench/Rail.tsx apps/web/src/workbench/use-sidebar-transition.ts apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/Sidebar.tsx apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/workbench.css apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/explore/layout-defaults.ts packages/core/src/components/kit/icon.ts packages/core/src/styles/theme.ts apps/web/src/custom-elements.d.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/perf/scenarios.ts apps/web/tests/perf/budgets.json perf/README.md apps/web/tests/perf-scale.spec.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-sidebar.spec.ts
git commit -m "feat(web): add the sidebar rail, collapse and resize"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

### Task 2.13: Floating structure and "View structure" in the tooltip

On desktop the structure pops out into a floating card over the plot (decision 2): draggable by its header, resizable from its corner, kept inside the plot area, and docked again from its header. The card never resizes the plot and the viewer is never re-parented. While the structure is docked and the sidebar collapsed, a click on a protein pins its tooltip with "View structure" (decision 15), which opens the sidebar. Core gains additive API for both: a header slot and part on the viewer, and tooltip actions on the scatterplot.

**Files:**

- Modify: `packages/core/src/components/structure-viewer/structure-viewer.ts` (header :398-432)
- Create: `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (click :1440-1466, hover clear :1586-1600, render :1735-1744), `scatter-plot.events.ts`, `tooltips/protein-tooltip.ts`, `tooltips/protein-tooltip.styles.ts`
- Create: `packages/core/src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/components/kit/icon.ts` (`picture-in-picture-2`, `panel-right`)
- Create: `apps/web/src/workbench/use-floating-card.ts`
- Modify: `apps/web/src/workbench/StructurePanel.tsx`, `Workbench.tsx`, `workbench.css`, `layout-geometry.ts`, `layout-geometry.test.ts`, `apps/web/src/explore/structure-controller.ts`, `structure-controller.test.ts`, `runtime.ts`
- Modify: `docs/developers/api/index.md`
- Modify: `apps/web/tests/helpers/explore.ts` (`floatStructure`, `dockStructure`), `apps/web/tests/workbench-structure.spec.ts`
- Line numbers in `scatter-plot.ts` (here and in Step 4) are from before Tasks 2.1, 2.4 and 2.8, which move them by about +40 and −11; find each block by the code quoted.

**Interfaces:**

- Consumes: the layout store (`structurePlacement`, `floatingRect`, `FLOATING_CARD`); `useLayoutMode`; the structure section and controller (2.11); the sidebar phases and rail (2.12); `pushLayer`; `ps-icon-button`, `ps-button`.
- Produces (core):
  - Viewer: `<slot name="header-actions">` before the close button; `part="header"` on the header.
  - Scatterplot: `tooltipActions: readonly TooltipAction[]` (property only, default `[]`), `export interface TooltipAction { id: string; label: string }`. With actions, a plain click pins the tooltip at the point with a row of buttons named by `label`; the pin is a layer (Escape, outside press) and also ends on the next click, a zoom or pan, a hover of another point, a data change, or `tooltipActions` becoming empty. Event `tooltip-action` with `detail: TooltipActionDetail` (`{ id: string; proteinId: string }`, bubbles, composed). With no actions nothing changes for embedders.
  - The core index exports `type TooltipAction` and `type TooltipActionDetail`.
- Produces (app):
  - Structure controller: its options gain `plotElement: Pick<ProtspaceScatterplot, 'tooltipActions' | 'addEventListener' | 'removeEventListener'>`; it sets `plotElement.tooltipActions = [{ id: 'view-structure', label: 'View structure' }]` while docked, collapsed and on desktop, and `[]` otherwise; on `tooltip-action` with id `view-structure` it calls `updateLayout({ sidebarOpen: true })`, which loads the waiting protein.
  - `layout-geometry.ts`: `clampFloatRect(rect: FloatingRect | null, bounds: { width: number; height: number }): FloatingRect` (`null` → the default 340 × 360 card at `FLOATING_CARD.inset` from the bottom-right; size at least 280 × 240 and at most the bounds; position inside the bounds); `floatStep(key: string, shift: boolean): { dx: number; dy: number }` (16 px, 64 px with Shift).
  - `use-floating-card.ts`: `useFloatingCard(sectionRef, plotRef): void` (header drag from a pointerdown on the viewer's `part="header"` outside buttons and links; corner resize; keyboard move and resize; re-clamps when the plot area resizes; writes `{ structurePlacement, floatingRect }` on release only).
  - DOM: root `data-structure="none|docked|floating"`; floating, `section.wb-structure` reads `--wb-float-x`, `--wb-float-y`, `--wb-float-w`, `--wb-float-h`, uses `--ps-surface-raised`, `--ps-radius-lg` and `--ps-shadow-lg`, keeps the 44 px header and shows `[data-workbench="float-grip"]` ("Resize structure"); a `ps-icon-button[slot="header-actions"]` inside `#myStructureViewer` reads "Pop out structure" (`picture-in-picture-2`) while docked on desktop and "Dock structure" (`panel-right`) while floating; below 951 px the effective placement is docked and the button is absent, the stored placement kept.
  - Docs: the viewer's slot and part, and the scatterplot's `tooltipActions` and `tooltip-action`, in `docs/developers/api/index.md`.
  - Helpers: `floatStructure(page)`, `dockStructure(page)`.
  - Implementation notes (no interface change): a click on "View structure" also calls `request(proteinId)` with the tooltip's protein before opening the sidebar, so the structure shown is the one the tooltip named even if the selection changed in between; the pin's layer counts the whole plot as inside (`elements: [plot]`), because presses on the plot end the pin through the click and zoom handlers; the pinned tooltip's position is recomputed from its protein on every render; a resize of a zoomed-in view (which re-centres it through `syncTransform`, Task 2.1) ends the pin like a pan does; the floating card is focusable (`tabindex="0"`) for the arrow-key move, and its grip is a `<button>` named "Resize structure" for the arrow-key resize.

**Tests:**

- `structure-viewer.browser.test.ts`: "slotted header actions render before the close button"; "the header is exposed as part header".
- `scatter-plot.tooltip-actions.browser.test.ts`: "without actions a click does not pin"; "with actions a click pins the tooltip and a hover elsewhere does not clear it"; "the action button dispatches tooltip-action with the protein id"; "Escape and a press outside unpin"; "emptying tooltipActions unpins".
- `layout-geometry.test.ts`: "clampFloatRect defaults to the bottom-right inset"; "keeps a card inside a plot that shrank"; "enforces the 280 × 240 minimum".
- `structure-controller.test.ts`: "offers View structure only while docked and collapsed on desktop"; "View structure opens the sidebar, which loads the waiting protein".
- `apps/web/tests/workbench-structure.spec.ts` (e2e, added cases):
  - "Pop out floats the card over the plot without resizing it"
  - "docking and floating keep the same viewer and do not reload the structure": the same `.molstar-mount` node and one `structure-load` (Review Focus 1)
  - "the card drags and resizes, survives a reload, and a card stored outside the plot or left outside by a shrinking window renders inside it" (Review Focus 2)
  - "below 951 px there is no Pop out and a stored floating card shows docked"
  - "while collapsed and docked, View structure in the pinned tooltip opens the sidebar"

Every command runs from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `Workbench.tsx`, `StructurePanel.tsx`, `workbench.css` and `structure-controller.ts` carry Tasks 2.11 and 2.12's edits, which the anchors below name; read each file before editing it.

- [ ] **Step 1: Write the failing core tests**

Create `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtspaceStructureViewer } from './structure-viewer';
import './structure-viewer';

beforeEach(() => {
  // A viewer starts loading a frame after proteinId changes; no load is under test here.
  vi.stubGlobal('requestAnimationFrame', () => 1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(): Promise<ProtspaceStructureViewer> {
  document.body.innerHTML = `
    <protspace-structure-viewer>
      <button slot="header-actions" id="pop-out" type="button">Pop out</button>
    </protspace-structure-viewer>`;
  const viewer = document.querySelector('protspace-structure-viewer')!;
  viewer.proteinId = 'P12345';
  await viewer.updateComplete;
  return viewer;
}

describe('protspace-structure-viewer header', () => {
  it('slotted header actions render before the close button', async () => {
    const viewer = await mount();
    const actions = viewer.shadowRoot!.querySelector('.header-actions')!;
    const slot = actions.querySelector<HTMLSlotElement>('slot[name="header-actions"]')!;
    const action = document.getElementById('pop-out')!;
    expect(slot.assignedElements()).toEqual([action]);
    const close = actions.querySelector('.close-button')!.getBoundingClientRect();
    expect(close.width).toBeGreaterThan(0);
    expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(close.left);
  });

  it('the header is exposed as part header', async () => {
    const viewer = await mount();
    expect(viewer.shadowRoot!.querySelector('.header')!.part.contains('header')).toBe(true);
  });
});
```

Create `packages/core/src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { ESCAPE_ORDER, onEscapeFallback } from '../kit/layers';
import type { ProtspaceScatterplot } from './scatter-plot';
import type { TooltipAction, TooltipActionDetail } from './scatter-plot.events';
import './scatter-plot';

const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
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

async function mountPlot(actions: readonly TooltipAction[] = [VIEW_STRUCTURE]) {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.tooltipActions = actions;
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  // Hit tests read the point grid, rebuilt on a frame after the data and the size.
  for (let i = 0; i < 3; i++) await frame();
  await plot.updateComplete;
  return plot;
}

/** A mouse event on the plot's interaction layer at client coordinates. */
function mouse(plot: ProtspaceScatterplot, type: 'click' | 'mousemove', at: { x: number; y: number }) {
  plot
    .shadowRoot!.querySelector('svg')!
    .dispatchEvent(
      new MouseEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, composed: true }),
    );
}

const at = (plot: ProtspaceScatterplot, id: string) => plot.getProteinClientPosition(id)!;

const pinned = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    'protspace-protein-tooltip.pinned',
  );

function escape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

describe('scatterplot tooltip actions', () => {
  it('without actions a click does not pin', async () => {
    const plot = await mountPlot([]);
    const clicks = vi.fn();
    plot.addEventListener('protein-click', clicks);
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(clicks).toHaveBeenCalledOnce();
    expect(pinned(plot)).toBeNull();
  });

  it('with actions a click pins the tooltip and a hover elsewhere does not clear it', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    const tip = pinned(plot)!;
    await tip.updateComplete;
    expect(tip.shadowRoot!.textContent).toContain('P2');

    // Empty plot: the hover there ends the hover tooltip, not the pin.
    const rect = plot.getBoundingClientRect();
    mouse(plot, 'mousemove', { x: rect.left + 8, y: rect.bottom - 8 });
    await frame();
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    // Another protein's hover ends it.
    mouse(plot, 'mousemove', at(plot, 'P3'));
    await frame();
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('the action button dispatches tooltip-action with the protein id', async () => {
    const plot = await mountPlot();
    const actions = vi.fn();
    plot.addEventListener('tooltip-action', (event) =>
      actions((event as CustomEvent<TooltipActionDetail>).detail),
    );
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    const tip = pinned(plot)!;
    await tip.updateComplete;
    const button = tip.shadowRoot!.querySelector('ps-button')!;
    expect(button.textContent?.trim()).toBe('View structure');

    button.click();

    expect(actions).toHaveBeenCalledExactlyOnceWith({ id: 'view-structure', proteinId: 'P2' });
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('Escape and a press outside unpin', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    escape();
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();

    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('emptying tooltipActions unpins', async () => {
    const plot = await mountPlot();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    plot.tooltipActions = [];
    await plot.updateComplete;

    expect(pinned(plot)).toBeNull();
    // Its layer went with it: Escape reaches the fallbacks again.
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts`
Expected: FAIL: the viewer has no `slot[name="header-actions"]` (null) and its `.header` has no part; "without actions a click does not pin" passes already; every case with actions finds no `protspace-protein-tooltip.pinned` (null).

- [ ] **Step 3: Add the header slot and part**

In `packages/core/src/components/structure-viewer/structure-viewer.ts`:

1. Add a doc comment above `@customElement('protspace-structure-viewer')`:

```ts
/**
 * A protein's 3D structure (Mol*), its resource links and colouring.
 *
 * @slot header-actions - Buttons placed in the header, before the close button.
 * @csspart header - The header row: title, protein id, links and actions.
 */
```

2. In `render()`, change `<div class="header">` to `<div class="header" part="header">`, and in `<div class="header-actions">` insert `<slot name="header-actions"></slot>` before the `${this.showCloseButton ? … : ''}` expression (Task 2.11's close button stays as it is).

Add the icons the pop-out button renders: in `packages/core/src/components/kit/icon.ts`, add `PanelRight` and `PictureInPicture2` to the `lucide` import and, to `ICONS` (alphabetical order), `'panel-right': PanelRight,` and `'picture-in-picture-2': PictureInPicture2,`.

- [ ] **Step 4: Add tooltip actions to the scatterplot**

Append to `packages/core/src/components/scatter-plot/scatter-plot.events.ts`:

```ts
/** A button a pinned protein tooltip offers (`ProtspaceScatterplot.tooltipActions`). */
export interface TooltipAction {
  /** Returned in `tooltip-action`'s detail. */
  id: string;
  /** The button's text, which is also its accessible name. */
  label: string;
}

/** `tooltip-action`: a pinned tooltip's button was pressed. */
export interface TooltipActionDetail {
  id: string;
  /** The protein the tooltip was pinned on. */
  proteinId: string;
}
```

In `packages/core/src/index.ts`, add `TooltipAction` and `TooltipActionDetail` to the type export from `'./components/scatter-plot/scatter-plot.events'` (beside `RendererDegradedDetail`).

In `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.ts`:

1. Add after the `protein-tooltip.styles` import:

```ts
import '../../kit/button';
import type { TooltipAction } from '../scatter-plot.events';
```

2. In `class ProtspaceProteinTooltip`, add after the `view` property:

```ts
  /** Buttons under the details while the tooltip is pinned; each dispatches `protein-tooltip-action`. */
  @property({ attribute: false }) actions: readonly TooltipAction[] = [];
```

3. In `render()`, after the closing `</div>` of `.tooltip-content` (still inside `.tooltip`), add:

```ts
        ${this.actions.length > 0
          ? html`<div class="tooltip-actions">
              ${this.actions.map(
                (action) =>
                  html`<ps-button size="sm" variant="secondary" @click=${() => this._act(action.id)}
                    >${action.label}</ps-button
                  >`,
              )}
            </div>`
          : ''}
```

4. Add the method after `render()`:

```ts
  private _act(id: string): void {
    // Stays in the plot's shadow root: the plot adds the protein and re-dispatches it.
    this.dispatchEvent(new CustomEvent('protein-tooltip-action', { detail: { id }, bubbles: true }));
  }
```

In `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts`, add after the `:host(.visible)` rule:

```css
  /* A pinned tooltip takes the pointer, for its action buttons. */
  :host(.pinned) {
    pointer-events: auto;
  }

  .tooltip-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ps-space-1-5);
    padding: var(--ps-space-2) var(--ps-space-3);
    border-top: 1px solid var(--ps-border);
  }
```

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Imports: add `import { pushLayer } from '../kit/layers';`, and add `TooltipAction` and `TooltipActionDetail` to the type import from `'./scatter-plot.events'` (:39-43).
2. Add `'tooltipActions',` and `'_pinnedTooltip',` to `NO_ADDITIONAL_RENDER_KEYS` (:107-113): neither changes what WebGL draws. Below that set, add:

```ts
const NO_TOOLTIP_ACTIONS: readonly TooltipAction[] = [];
```

3. After `@property({ type: Boolean, attribute: 'eat-overlay-enabled' }) eatOverlayEnabled = true;` (:161), add:

```ts
  /**
   * Buttons a plain click on a protein offers in its tooltip, which then stays (pinned) until
   * Escape, a press outside the plot, the next click, a zoom or pan, a hover of another protein,
   * a data or projection change, or until this becomes empty. A button dispatches
   * `tooltip-action` with its id and the protein. Empty (the default) keeps tooltips hover-only.
   */
  @property({ attribute: false }) tooltipActions: readonly TooltipAction[] = [];
```

4. After `@state() private _tooltipHeight: number | null = null;` (:170), add:

```ts
  // The tooltip a plain click pinned while tooltipActions offered buttons, at its protein.
  @state() private _pinnedTooltip: { point: PlotDataPoint; view: TooltipView } | null = null;
  // Releases the pin's layer (kit/layers.ts), through which Escape and outside presses end it.
  private _releasePinnedTooltip: (() => void) | null = null;
```

5. In `_interactionHost()`, at the end of `onTransform: (t) => { … }` (:1195-1199), add:

```ts
        // A zoom or pan moves the protein away from its pinned tooltip.
        this._unpinTooltip();
```

6. In `disconnectedCallback()`, after `this._tooltipData = null;` (:526), add `this._unpinTooltip();`.
7. In `willUpdate(…)`, after `this._reconcileFocus(changedProperties);`, add `this._reconcilePinnedTooltip(changedProperties);`.
8. In `_reconcileTooltipMeasurement` (:908), change the condition to `if (changedProperties.has('_tooltipData') || changedProperties.has('_pinnedTooltip')) {`; in `_measureTooltipHeight` (:920), change both `!this._tooltipData` tests (the early return and the one inside the `then` callback) to `!this._tooltipData && !this._pinnedTooltip`.
9. At the top of `_handleMouseOver(event, point)` (:1410), add:

```ts
    // Another protein's hover ends a pin.
    if (this._pinnedTooltip && this._pinnedTooltip.point.id !== point.id) this._unpinTooltip();
```

10. In `_handleClick(event, point)` (:1440), after the `this.dispatchEvent(new CustomEvent<ProteinClickDetail>('protein-click', …));` statement, add:

```ts
    if (view && this.tooltipActions.length > 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      this._pinTooltip(point, view);
    }
```

11. In `_handleCanvasClick(event)` (:1544), after `if (!this._scales) return;`, add:

```ts
    // Any click on the plot ends a pin; a plain click on a protein pins anew below.
    this._unpinTooltip();
```

12. Replace `_estimateTooltipHeight()` and `_getTooltipStyle()` (:1670-1690) with:

```ts
  /** The tooltip on screen: the pinned one, at its protein, else the hovered protein's. */
  private _shownTooltip(): { x: number; y: number; view: TooltipView } | null {
    const pinned = this._pinnedTooltip;
    if (!pinned) return this._tooltipData;
    const scales = this._scales;
    if (!scales) return null;
    const t = this._transform;
    return {
      x: scales.x(pinned.point.x) * t.k + t.x,
      y: scales.y(pinned.point.y) * t.k + t.y,
      view: pinned.view,
    };
  }

  private _estimateTooltipHeight(): number {
    const shown = this._shownTooltip();
    if (!shown) return TOOLTIP_FALLBACK_HEIGHT;
    return estimateTooltipHeight(shown.view, effectiveTooltipWidth(this._mergedConfig.width));
  }

  private _getTooltipStyle() {
    const shown = this._shownTooltip();
    if (!shown) return '';
    const config = this._mergedConfig;
    return computeTooltipStyle({
      x: shown.x,
      y: shown.y,
      height: this._tooltipHeight ?? this._estimateTooltipHeight(),
      viewportWidth: config.width,
      viewportHeight: config.height,
    });
  }

  private _renderTooltip() {
    const shown = this._shownTooltip();
    if (!shown) return '';
    const pinned = this._pinnedTooltip !== null;
    // Shift-focus fades the hover tooltip; a pinned one stays.
    const className = pinned ? 'visible pinned' : this._focusedValues ? '' : 'visible';
    return html`
      <protspace-protein-tooltip
        class=${className}
        style="${this._getTooltipStyle()}"
        .view=${shown.view}
        .actions=${pinned ? this.tooltipActions : NO_TOOLTIP_ACTIONS}
        @protein-tooltip-action=${this._handleTooltipAction}
      ></protspace-protein-tooltip>
    `;
  }

  private _pinTooltip(point: PlotDataPoint, view: TooltipView): void {
    this._pinnedTooltip = { point, view };
    // Presses on the plot end the pin through the click and zoom handlers; the layer handles
    // Escape and presses anywhere else.
    this._releasePinnedTooltip ??= pushLayer({
      close: () => this._unpinTooltip(),
      elements: [this],
    });
  }

  private _unpinTooltip(): void {
    this._releasePinnedTooltip?.();
    this._releasePinnedTooltip = null;
    this._pinnedTooltip = null;
  }

  /** A pin ends with its data, with its points' positions, or with the last action. */
  private _reconcilePinnedTooltip(changedProperties: Map<string, unknown>): void {
    if (!this._pinnedTooltip) return;
    const actionsGone = changedProperties.has('tooltipActions') && this.tooltipActions.length === 0;
    if (actionsGone || this._geometryInputsChanged(changedProperties)) this._unpinTooltip();
  }

  private _handleTooltipAction = (event: Event) => {
    const pinned = this._pinnedTooltip;
    if (!pinned) return;
    const { id } = (event as CustomEvent<{ id: string }>).detail;
    this._unpinTooltip();
    this.dispatchEvent(
      new CustomEvent<TooltipActionDetail>('tooltip-action', {
        detail: { id, proteinId: pinned.point.id },
        bubbles: true,
        composed: true,
      }),
    );
  };
```

13. In `render()`, replace the whole conditional that renders `<protspace-protein-tooltip>` (the `${this._tooltipData ? … : ''}` expression, :1735-1744) with `${this._renderTooltip()}`.

- [ ] **Step 5: Run the core tests**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts`
Expected: PASS, 2 + 5 tests.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot src/components/structure-viewer`
Expected: PASS, including `scatter-plot.tooltip-measure.test.ts` (no pin: the measure works as before) and `structure-viewer.component.test.ts`.

Run: `pnpm --filter @protspace/core build`
Expected: the build succeeds (the app imports core's `dist`).

- [ ] **Step 6: Write the failing app unit tests**

In `apps/web/src/workbench/layout-geometry.test.ts`, add `clampFloatRect` and `floatStep` to the import from `./layout-geometry`, and append:

```ts
describe('clampFloatRect', () => {
  // The plot area at 1280 × 720 with the sidebar open: 1280 − 300 − 44 by 720 − 48 − 44.
  const area = { width: 936, height: 628 };

  it('clampFloatRect defaults to the bottom-right inset', () => {
    expect(clampFloatRect(null, area)).toEqual({ x: 582, y: 254, width: 340, height: 360 });
  });

  it('keeps a card inside a plot that shrank', () => {
    const card = { x: 500, y: 300, width: 340, height: 360 };
    expect(clampFloatRect(card, area)).toEqual(card);
    expect(clampFloatRect(card, { width: 656, height: 508 })).toEqual({
      x: 316,
      y: 148,
      width: 340,
      height: 360,
    });
    expect(clampFloatRect({ ...card, x: 5000, y: -300 }, area)).toEqual({
      x: 596,
      y: 0,
      width: 340,
      height: 360,
    });
  });

  it('enforces the 280 × 240 minimum', () => {
    expect(clampFloatRect({ x: 10, y: 10, width: 100, height: 50 }, area)).toEqual({
      x: 10,
      y: 10,
      width: 280,
      height: 240,
    });
    // A plot area smaller than the minimum: the card fills it.
    expect(clampFloatRect(null, { width: 250, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 200,
    });
  });
});

describe('floatStep', () => {
  it('floatStep moves 16 px, or 64 px with Shift', () => {
    expect(floatStep('ArrowLeft', false)).toEqual({ dx: -16, dy: 0 });
    expect(floatStep('ArrowDown', false)).toEqual({ dx: 0, dy: 16 });
    expect(floatStep('ArrowUp', true)).toEqual({ dx: 0, dy: -64 });
    expect(floatStep('ArrowRight', true)).toEqual({ dx: 64, dy: 0 });
    expect(floatStep('Enter', false)).toEqual({ dx: 0, dy: 0 });
  });
});
```

In `apps/web/src/explore/structure-controller.test.ts`:

1. Add `getLayout` to the import from `./layout-state`.
2. Add, below `fakeDesktopQuery`:

```ts
/** The plot's surface the controller uses: its tooltip actions and the tooltip-action event. */
function fakePlot() {
  const events = new EventTarget();
  return {
    tooltipActions: [] as readonly { id: string; label: string }[],
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
}
```

3. Replace Task 2.11's `setup()` with:

```ts
function setup({ desktop = true } = {}) {
  const viewer = fakeViewer();
  const plot = fakePlot();
  const desktopQuery = fakeDesktopQuery(desktop);
  const controller = createStructureController({
    viewer: viewer as never,
    plotElement: plot as never,
    desktopQuery: desktopQuery as never,
  });
  controllers.push(controller);
  return { viewer, plot, desktopQuery, controller };
}
```

4. Append inside `describe('createStructureController', …)`:

```ts
  it('offers View structure only while docked and collapsed on desktop', () => {
    const { plot, desktopQuery } = setup();
    const viewStructure = [{ id: 'view-structure', label: 'View structure' }];
    expect(plot.tooltipActions).toEqual([]);
    updateLayout({ sidebarOpen: false });
    expect(plot.tooltipActions).toEqual(viewStructure);
    updateLayout({ structurePlacement: 'floating' });
    expect(plot.tooltipActions).toEqual([]);
    updateLayout({ structurePlacement: 'docked' });
    expect(plot.tooltipActions).toEqual(viewStructure);
    desktopQuery.set(false);
    expect(plot.tooltipActions).toEqual([]);
    desktopQuery.set(true);
    expect(plot.tooltipActions).toEqual(viewStructure);
    updateLayout({ sidebarOpen: true });
    expect(plot.tooltipActions).toEqual([]);
  });

  it('View structure opens the sidebar, which loads the waiting protein', () => {
    const { viewer, plot, controller } = setup();
    updateLayout({ sidebarOpen: false });
    controller.request('P1');
    expect(viewer.loadProtein).not.toHaveBeenCalled();

    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'view-structure', proteinId: 'P1' } }),
    );

    expect(getLayout().sidebarOpen).toBe(true);
    expect(viewer.loadProtein).toHaveBeenCalledExactlyOnceWith('P1');
    expect(plot.tooltipActions).toEqual([]);
  });

  it('ignores other tooltip actions', () => {
    const { viewer, plot } = setup();
    updateLayout({ sidebarOpen: false });
    plot.dispatchEvent(
      new CustomEvent('tooltip-action', { detail: { id: 'copy-id', proteinId: 'P1' } }),
    );
    expect(getLayout().sidebarOpen).toBe(false);
    expect(viewer.loadProtein).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts src/explore/structure-controller.test.ts`
Expected: FAIL: `clampFloatRect is not a function`, `floatStep is not a function`; the three new controller cases fail (`tooltipActions` stays `[]`; the sidebar stays collapsed); Task 2.11's cases still pass.

- [ ] **Step 8: Add the geometry and the controller's tooltip action**

In `apps/web/src/workbench/layout-geometry.ts`, change the `layout-defaults` import to:

```ts
import {
  FLOATING_CARD,
  MIN_PLOT_WIDTH,
  RAIL_WIDTH,
  SIDEBAR_WIDTH,
  type FloatingRect,
} from '../explore/layout-defaults';
```

and append:

```ts
/** One arrow key moves or resizes the floating card this many pixels; Shift four times as far. */
const FLOAT_STEP = 16;

/**
 * Where the floating structure card goes in a plot area of `bounds`: the stored rectangle, or for
 * null the default 340 × 360 card 14 px in from the bottom-right corner. Its size is at least
 * 280 × 240 and at most the plot area, and it is moved inside the plot area. Render only: a card
 * stored outside a smaller window shows inside it, and storage keeps the user's rectangle.
 */
export function clampFloatRect(
  rect: FloatingRect | null,
  bounds: { width: number; height: number },
): FloatingRect {
  const areaWidth = Math.max(0, bounds.width);
  const areaHeight = Math.max(0, bounds.height);
  const width = Math.min(
    Math.max(rect?.width ?? FLOATING_CARD.defaultWidth, FLOATING_CARD.minWidth),
    areaWidth,
  );
  const height = Math.min(
    Math.max(rect?.height ?? FLOATING_CARD.defaultHeight, FLOATING_CARD.minHeight),
    areaHeight,
  );
  const x = rect ? rect.x : areaWidth - FLOATING_CARD.inset - width;
  const y = rect ? rect.y : areaHeight - FLOATING_CARD.inset - height;
  return {
    x: Math.min(Math.max(x, 0), areaWidth - width),
    y: Math.min(Math.max(y, 0), areaHeight - height),
    width,
    height,
  };
}

/** The floating card's move (or resize) for an arrow key; zero for other keys. */
export function floatStep(key: string, shift: boolean): { dx: number; dy: number } {
  const step = shift ? 4 * FLOAT_STEP : FLOAT_STEP;
  if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (key === 'ArrowRight') return { dx: step, dy: 0 };
  if (key === 'ArrowUp') return { dx: 0, dy: -step };
  if (key === 'ArrowDown') return { dx: 0, dy: step };
  return { dx: 0, dy: 0 };
}
```

In `apps/web/src/explore/structure-controller.ts`:

1. Change the imports to:

```ts
import type {
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  TooltipAction,
  TooltipActionDetail,
} from '@protspace/core';
import type { LayoutState } from './layout-defaults';
import { getLayout, subscribeLayout, updateLayout } from './layout-state';
import { setWorkbenchStatus } from './workbench-status';

/** "View structure" in a pinned protein tooltip. */
const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };
```

2. In `interface StructureControllerOptions`, add:

```ts
  /** The plot whose pinned tooltip offers "View structure". */
  plotElement: Pick<ProtspaceScatterplot, 'tooltipActions' | 'addEventListener' | 'removeEventListener'>;
```

and destructure `plotElement` in `createStructureController({ viewer, plotElement, desktopQuery })`.

3. Replace everything from `const unsubscribe = subscribeLayout(loadWaiting);` to the end of the function with:

```ts
  const request = (proteinId: string) => {
    publish(proteinId);
    if (visible()) load(proteinId);
    else waiting = proteinId;
  };

  // "View structure" is offered only where a click cannot show the structure: docked in a
  // collapsed sidebar, on desktop (design decision 2). A visible or floating one loads on click.
  const offerViewStructure = () => {
    const layout = getLayout();
    const offer =
      desktopQuery.matches && layout.structurePlacement === 'docked' && !layout.sidebarOpen;
    if (offer !== plotElement.tooltipActions.length > 0) {
      plotElement.tooltipActions = offer ? [VIEW_STRUCTURE] : [];
    }
  };
  const onLayoutChange = () => {
    offerViewStructure();
    loadWaiting();
  };
  const onTooltipAction = (event: Event) => {
    const { id, proteinId } = (event as CustomEvent<TooltipActionDetail>).detail;
    if (id !== VIEW_STRUCTURE.id) return;
    // Wait for the tooltip's protein, then open the sidebar, which loads it.
    request(proteinId);
    updateLayout({ sidebarOpen: true });
  };

  const unsubscribe = subscribeLayout(onLayoutChange);
  desktopQuery.addEventListener('change', onLayoutChange);
  viewer.addEventListener('structure-close', forget);
  plotElement.addEventListener('tooltip-action', onTooltipAction);
  offerViewStructure();

  return {
    request,
    clear() {
      // close() dispatches structure-close, which forgets the protein.
      if (viewer.proteinId) viewer.close();
      else forget();
    },
    dispose() {
      unsubscribe();
      desktopQuery.removeEventListener('change', onLayoutChange);
      viewer.removeEventListener('structure-close', forget);
      plotElement.removeEventListener('tooltip-action', onTooltipAction);
    },
  };
```

In `apps/web/src/explore/runtime.ts`, in `createStructureController({ … })` (Task 2.11), add `plotElement,` after `viewer: structureViewer,`.

- [ ] **Step 9: Run the app unit tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts src/explore/structure-controller.test.ts`
Expected: PASS (10 geometry cases, 12 controller cases).

- [ ] **Step 10: Write the failing e2e cases and their helpers**

Append to `apps/web/tests/helpers/explore.ts`:

```ts
/** Pops the structure out of the sidebar into its floating card over the plot. */
export async function floatStructure(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pop out structure' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-structure', 'floating');
}

/** Docks the floating structure card under the legend again. */
export async function dockStructure(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Dock structure' }).click();
  await expect(page.locator('.workbench')).toHaveAttribute('data-structure', 'docked');
}
```

In `apps/web/tests/workbench-structure.spec.ts`, add `collapseSidebar`, `dockStructure`, `floatStructure`, `plotArea`, `readLayout` and `seedLayout` to the import from `./helpers/explore`, add below `storedLegendFraction`:

```ts
/** The floating card lies inside the plot area. */
async function expectCardInsidePlotArea(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const area = (await plotArea(page).boundingBox())!;
      const card = (await structurePanel(page).boundingBox())!;
      return (
        card.x >= area.x - 0.5 &&
        card.y >= area.y - 0.5 &&
        card.x + card.width <= area.x + area.width + 0.5 &&
        card.y + card.height <= area.y + area.height + 0.5
      );
    })
    .toBe(true);
}
```

and append:

```ts
test('Pop out floats the card over the plot without resizing it', async ({ page }) => {
  await openExplore(page);
  const plot = page.locator('#myPlot');
  const before = await plot.boundingBox();
  const resizes = await watchPlotResizes(page);
  await clickProteinNearPlotCentre(page);

  await floatStructure(page);

  // The default card: 340 × 360, 14 px in from the plot area's bottom-right corner.
  const area = (await plotArea(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expectNear(card.width, 340);
  expectNear(card.height, 360);
  expectNear(area.x + area.width - (card.x + card.width), 14);
  expectNear(area.y + area.height - (card.y + card.height), 14);
  // The legend takes the whole sidebar column.
  const body = (await page.locator('[data-workbench="body"]').boundingBox())!;
  expectNear((await page.locator('#myLegend').boundingBox())!.height, body.height);
  await expect(page.getByRole('button', { name: 'Dock structure' })).toBeVisible();
  expect(await plot.boundingBox()).toEqual(before);
  expect(await resizes()).toBe(0);
});

test('docking and floating keep the same viewer and do not reload the structure', async ({
  page,
}) => {
  await openExplore(page);
  const viewer = page.locator('#myStructureViewer');
  await viewer.evaluate((element) => {
    const loads: string[] = [];
    (window as unknown as { __structureLoads: string[] }).__structureLoads = loads;
    element.addEventListener('structure-load', (event) =>
      loads.push((event as CustomEvent<{ status: string }>).detail.status),
    );
  });
  const loads = () =>
    page.evaluate(() => (window as unknown as { __structureLoads: string[] }).__structureLoads);
  await clickProteinNearPlotCentre(page);
  await expect.poll(loads).toEqual(['loading', 'loaded']);
  const viewerBefore = await viewer.elementHandle();
  const mountBefore = await viewer.locator('.molstar-mount').elementHandle();

  await floatStructure(page);
  await dockStructure(page);
  await floatStructure(page);

  const viewerAfter = await viewer.elementHandle();
  const mountAfter = await viewer.locator('.molstar-mount').elementHandle();
  expect(await page.evaluate(([a, b]) => a !== null && a === b, [viewerBefore, viewerAfter])).toBe(
    true,
  );
  expect(
    await page.evaluate(
      ([a, b]) => a !== null && a === b && a.isConnected,
      [mountBefore, mountAfter],
    ),
  ).toBe(true);
  expect(await loads()).toEqual(['loading', 'loaded']);
});

test('the card drags and resizes, survives a reload, and a card stored outside the plot or left outside by a shrinking window renders inside it', async ({
  page,
}) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  const card = structurePanel(page);
  const start = (await card.boundingBox())!;

  // Drag by the header's title: the header's links and buttons do not drag.
  const title = (await page.locator('#myStructureViewer .title').boundingBox())!;
  const grabX = title.x + title.width / 2;
  const grabY = title.y + title.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX - 200, grabY - 100, { steps: 8 });
  await page.mouse.up();
  const moved = (await card.boundingBox())!;
  expectNear(moved.x, start.x - 200);
  expectNear(moved.y, start.y - 100);

  // Resize from the corner grip.
  const grip = (await page.getByRole('button', { name: 'Resize structure' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const resized = (await card.boundingBox())!;
  expectNear(resized.width, 380);
  expectNear(resized.height, 390);
  const stored = (await readLayout(page))!;
  expect(stored.structurePlacement).toBe('floating');
  expect(stored.floatingRect).toMatchObject({ width: 380, height: 390 });

  // After a reload the card comes back where it was, once a protein shows.
  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  const reloaded = (await card.boundingBox())!;
  expectNear(reloaded.x, resized.x);
  expectNear(reloaded.y, resized.y);

  // A shrinking window keeps the card inside the plot area, and storage keeps the user's rect.
  await page.setViewportSize({ width: 1000, height: 600 });
  await expectCardInsidePlotArea(page);
  expect(await readLayout(page)).toEqual(stored);

  // A card stored outside the plot shows inside it.
  await page.setViewportSize({ width: 1280, height: 720 });
  await seedLayout(page, {
    structurePlacement: 'floating',
    floatingRect: { x: 5000, y: -300, width: 340, height: 360 },
  });
  await page.reload();
  await waitForExploreDataLoad(page);
  await clickProteinNearPlotCentre(page);
  await expect(workbench(page)).toHaveAttribute('data-structure', 'floating');
  await expectCardInsidePlotArea(page);
});

test('below 951 px there is no Pop out and a stored floating card shows docked', async ({
  page,
}) => {
  await seedLayout(page, { structurePlacement: 'floating' });
  await page.setViewportSize({ width: 900, height: 800 });
  await openExplore(page);
  await clickProteinNearPlotCentre(page);

  await expect(workbench(page)).toHaveAttribute('data-structure', 'docked');
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out structure' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dock structure' })).toHaveCount(0);
  expect((await readLayout(page))?.structurePlacement).toBe('floating');
  // Stacked: the structure follows the legend.
  const legend = (await page.locator('#myLegend').boundingBox())!;
  expect((await structurePanel(page).boundingBox())!.y).toBeGreaterThanOrEqual(
    legend.y + legend.height - 1,
  );
});

test('while collapsed and docked, View structure in the pinned tooltip opens the sidebar', async ({
  page,
}) => {
  await openExplore(page);
  await collapseSidebar(page);
  const id = await clickProteinNearPlotCentre(page);

  const action = page.locator('#myPlot').getByRole('button', { name: 'View structure' });
  await expect(action).toBeVisible();
  // A hidden structure loads nothing until it is asked for.
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', null);

  await action.click();

  await expect(workbench(page)).toHaveAttribute('data-sidebar', 'open');
  await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
  await expect(action).toBeHidden();
});
```

- [ ] **Step 11: Run them to see them fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure`
Expected: the five Task 2.11 cases pass, and so does "while collapsed and docked, View structure in the pinned tooltip opens the sidebar" (core's pin and the controller's action landed in Steps 4 and 8; it needs no shell change). The four floating cases FAIL: there is no "Pop out structure" button yet, so each times out on `floatStructure` or on the missing `data-structure="floating"`.

- [ ] **Step 12: Float the card in the shell**

Create `apps/web/src/workbench/use-floating-card.ts`:

```ts
import { useLayoutEffect, type RefObject } from 'react';
import type { FloatingRect } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { clampFloatRect, floatStep } from './layout-geometry';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';

/** Whether a press starts on the viewer's header, away from its buttons and links. */
function pressesHeader(event: PointerEvent): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    if (target.matches('a, button, input, select, textarea, [role="button"]')) return false;
    if (target.part.contains('header')) return true;
  }
  return false;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  start: FloatingRect;
}

const FLOAT_PROPERTIES = ['--wb-float-x', '--wb-float-y', '--wb-float-w', '--wb-float-h'];

/**
 * Moves the floating structure card by the viewer's header and resizes it from its corner grip;
 * the arrow keys do the same on the focused card and grip (design decision 2). The card stays
 * inside the plot area, also when the plot area shrinks, without rewriting the stored rect; the
 * layout is written once per gesture, on release or keyup. Only the section's --wb-float-*
 * properties change: the plot's box never does, and the viewer is never re-parented.
 */
export function useFloatingCard(
  sectionRef: RefObject<HTMLElement | null>,
  plotRef: RefObject<HTMLElement | null>,
): void {
  const layout = useLayout();
  const floating = useLayoutMode() === 'desktop' && layout.structurePlacement === 'floating';
  const stored = layout.floatingRect;

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const plot = plotRef.current;
    if (!floating || !section || !plot) return;

    const bounds = () => ({ width: plot.clientWidth, height: plot.clientHeight });
    const grip = () => section.querySelector<HTMLElement>('[data-workbench="float-grip"]');
    let rect = clampFloatRect(stored, bounds());
    let gesture: Gesture | null = null;
    let keyed = false;

    const paint = (next: FloatingRect) => {
      rect = next;
      section.style.setProperty('--wb-float-x', `${next.x}px`);
      section.style.setProperty('--wb-float-y', `${next.y}px`);
      section.style.setProperty('--wb-float-w', `${next.width}px`);
      section.style.setProperty('--wb-float-h', `${next.height}px`);
    };
    const commit = () =>
      updateLayout({
        structurePlacement: 'floating',
        floatingRect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    // Resizing keeps the top-left corner where it is.
    const resized = (from: FloatingRect, width: number, height: number) => {
      const area = bounds();
      return clampFloatRect(
        {
          ...from,
          width: Math.min(width, area.width - from.x),
          height: Math.min(height, area.height - from.y),
        },
        area,
      );
    };
    const moved = (from: FloatingRect, dx: number, dy: number) =>
      clampFloatRect({ ...from, x: from.x + dx, y: from.y + dy }, bounds());

    paint(rect);
    // The window and the sidebar resize the plot area: keep the stored card inside it.
    const observer = new ResizeObserver(() => {
      if (!gesture) paint(clampFloatRect(stored, bounds()));
    });
    observer.observe(plot);

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const handle = grip();
      const kind =
        handle && event.composedPath().includes(handle)
          ? 'resize'
          : pressesHeader(event)
            ? 'move'
            : null;
      if (!kind) return;
      event.preventDefault();
      section.setPointerCapture(event.pointerId);
      gesture = {
        kind,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        start: rect,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const { start } = gesture;
      paint(
        gesture.kind === 'move'
          ? moved(start, dx, dy)
          : resized(start, start.width + dx, start.height + dy),
      );
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture = null;
      commit();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { dx, dy } = floatStep(event.key, event.shiftKey);
      if (dx === 0 && dy === 0) return;
      const handle = grip();
      const resizing = handle !== null && event.target === handle;
      // Only the card itself or its grip: keys inside the viewer belong to the viewer.
      if (!resizing && event.target !== section) return;
      event.preventDefault();
      keyed = true;
      paint(resizing ? resized(rect, rect.width + dx, rect.height + dy) : moved(rect, dx, dy));
    };
    const onKeyUp = () => {
      if (!keyed) return;
      keyed = false;
      commit();
    };

    section.addEventListener('pointerdown', onPointerDown);
    section.addEventListener('pointermove', onPointerMove);
    section.addEventListener('pointerup', onPointerEnd);
    section.addEventListener('pointercancel', onPointerEnd);
    section.addEventListener('lostpointercapture', onPointerEnd);
    section.addEventListener('keydown', onKeyDown);
    section.addEventListener('keyup', onKeyUp);
    return () => {
      observer.disconnect();
      section.removeEventListener('pointerdown', onPointerDown);
      section.removeEventListener('pointermove', onPointerMove);
      section.removeEventListener('pointerup', onPointerEnd);
      section.removeEventListener('pointercancel', onPointerEnd);
      section.removeEventListener('lostpointercapture', onPointerEnd);
      section.removeEventListener('keydown', onKeyDown);
      section.removeEventListener('keyup', onKeyUp);
      for (const name of FLOAT_PROPERTIES) section.style.removeProperty(name);
    };
  }, [floating, stored, sectionRef, plotRef]);
}
```

In `apps/web/src/workbench/StructurePanel.tsx`:

1. Add `import type { StructurePlacement } from '../explore/layout-defaults';` (merge with the existing `layout-defaults` import).
2. Add to `StructurePanelProps`:

```tsx
  /** Where the structure shows: in the sidebar column, or floating over the plot. */
  placement: StructurePlacement;
  /** Whether it may float here: desktop widths only (below 951 px it always docks). */
  canFloat: boolean;
```

3. Destructure `placement` and `canFloat` in `StructurePanel(…)`, add `const floating = placement === 'floating';` at the top of its body, and add `tabIndex={floating ? 0 : undefined}` to the `<section>` (a floating card takes focus, so the arrow keys can move it).
4. Replace the self-closed `<protspace-structure-viewer …></protspace-structure-viewer>` with (same attributes, now with a child):

```tsx
      <protspace-structure-viewer
        id="myStructureViewer"
        height="100%"
        show-header="true"
        show-close-button="true"
        auto-sync="true"
        scatterplot-selector="#myPlot"
      >
        {canFloat && (
          <ps-icon-button
            slot="header-actions"
            size="sm"
            icon={floating ? 'panel-right' : 'picture-in-picture-2'}
            label={floating ? 'Dock structure' : 'Pop out structure'}
            onClick={() => updateLayout({ structurePlacement: floating ? 'docked' : 'floating' })}
          ></ps-icon-button>
        )}
      </protspace-structure-viewer>
      {floating && (
        <button
          type="button"
          className="wb-float-grip"
          data-workbench="float-grip"
          aria-label="Resize structure"
        ></button>
      )}
```

In `apps/web/src/workbench/Workbench.tsx`:

1. Change the `react` import to `import { createRef, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';` and add `import { useFloatingCard } from './use-floating-card';`.
2. Above `function subscribeWindowWidth`, add:

```tsx
/** A slide target that is never there: the structure while it floats over the plot. */
const NO_SLIDE_TARGET = createRef<HTMLElement>();
```

3. Move Task 2.12's `const desktop = mode === 'desktop';` above Task 2.11's `const structure = …;`, and replace that `structure` line with:

```tsx
  // Floating is desktop-only: below 951 px a stored floating card shows docked (storage keeps it).
  const placement = desktop ? layout.structurePlacement : 'docked';
  const structure = structureProteinId === null ? 'none' : placement;
```

4. In the `useSidebarTransition(…)` call, change `structure: structureRef,` to `structure: structure === 'floating' ? NO_SLIDE_TARGET : structureRef,`.
5. After the `useSidebarTransition(…)` call, add:

```tsx
  const bodyRef = useRef<HTMLDivElement>(null);
  // The plot area the floating card stays inside: Task 2.2's main[data-workbench="plot"].
  const plotAreaRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    plotAreaRef.current =
      bodyRef.current?.querySelector<HTMLElement>('[data-workbench="plot"]') ?? null;
  }, []);
  useFloatingCard(structureRef, plotAreaRef);
```

6. Add `ref={bodyRef}` to `div.wb-body`.
7. On `<StructurePanel …>`, change `inert={sidebarHidden}` to `inert={sidebarHidden && structure !== 'floating'}` and add `placement={placement}` and `canFloat={desktop}`.
8. On `<Rail …>`, change `structureDocked={layout.structurePlacement === 'docked'}` to `structureDocked={placement === 'docked'}`.

In `apps/web/src/workbench/workbench.css`:

1. In Task 2.12's collapsed rule, change the selector `.workbench[data-layout='desktop'][data-sidebar='collapsed'] .wb-structure` to `.workbench[data-layout='desktop'][data-sidebar='collapsed']:not([data-structure='floating']) .wb-structure` (a floating card stays when the sidebar collapses).
2. Append:

```css
/* ── The floating structure card (Task 2.13) ──────────────────────────────── */

.workbench[data-layout='desktop'][data-structure='floating'] #myLegend {
  height: 100%;
}

/* Above the plot; under the sidebar while it slides or is resized over the plot area (Task 2.12
   lifts it then). */
.workbench[data-layout='desktop'][data-structure='floating'] .wb-structure {
  top: var(--wb-float-y);
  right: auto;
  bottom: auto;
  left: var(--wb-float-x);
  z-index: 1;
  width: var(--wb-float-w);
  height: var(--wb-float-h);
  border: 1px solid var(--ps-border);
  border-radius: var(--ps-radius-lg);
  background: var(--ps-surface-raised);
  box-shadow: var(--ps-shadow-lg);
}

.workbench[data-structure='floating'] #myStructureViewer::part(header) {
  cursor: grab;
  user-select: none;
}

.wb-structure:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: var(--ps-focus-offset);
}

.wb-float-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: nwse-resize;
  touch-action: none;
}

.wb-float-grip::before {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border-right: 2px solid var(--ps-border-strong);
  border-bottom: 2px solid var(--ps-border-strong);
  border-bottom-right-radius: 2px;
}

.wb-float-grip:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: calc(-1 * var(--ps-focus-width));
}
```

- [ ] **Step 13: Run the task's tests**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure workbench-sidebar`
Expected: PASS: 10 structure cases and Task 2.12's 10 sidebar cases (in "a protein clicked while collapsed waits behind the Structure dot", the click now also pins the tooltip; the press on the rail closes the pin before it opens the sidebar).

- [ ] **Step 14: Document the new API**

In `docs/developers/api/index.md`:

1. In the Scatterplot's Properties table, add after the `config` row:

```md
| `tooltipActions`                    | `readonly TooltipAction[]`            | `[]`          | Buttons a pinned tooltip offers (see below)    |
```

2. In the Scatterplot's Events table, add after the `protein-hover` row:

```md
| `tooltip-action`         | `{ id, proteinId }`                              | A pinned tooltip's button was pressed |
```

3. After the paragraph that begins "`modifierKeys` on `protein-click` is", add:

```md
`tooltipActions` takes `{ id, label }` objects (`TooltipAction`) and is a property only. While it
holds any, a plain click on a protein pins its tooltip at the protein with one button per action.
The pin ends on Escape, a press outside the plot, the next click, a zoom or pan, a hover of another
protein, a data or projection change, or when `tooltipActions` becomes empty. A button dispatches
`tooltip-action` (bubbles, composed) with the action's `id` and the pinned `proteinId`
(`TooltipActionDetail`). Empty, the default, keeps tooltips hover-only.
```

4. In the Structure Viewer section, add after its Events table:

```md
### Slots and parts

| Name                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `header-actions` (slot) | Buttons placed in the header, before the close button    |
| `header` (part)         | The header row: title, protein id, links and the buttons |
```

- [ ] **Step 15: Run the full suites**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run`
Expected: PASS; the count before this task plus two browser files (7 tests).

Run: `pnpm --filter @protspace/app exec vitest --run`
Expected: PASS; the count before plus the new geometry and controller cases.

Run: `pnpm type-check && pnpm knip && pnpm docs:build`
Expected: clean. (`TooltipAction` and `TooltipActionDetail` are public exports; `clampFloatRect`, `floatStep`, `useFloatingCard`, `floatStructure` and `dockStructure` have consumers in this commit.)

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e`
Expected: PASS in Chromium. With the sidebar open the plot offers no tooltip actions, so `multi-annotation-tooltip.spec.ts` and every other hover-tooltip check behave as before.

Run (sandbox disabled): `pnpm perf:counts`
Expected: PASS, every budget unchanged (the pinned layout keeps the sidebar open, so no tooltip pins in any segment).

- [ ] **Step 16: Commit**

```bash
pnpm exec prettier --write packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.events.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts packages/core/src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts packages/core/src/index.ts packages/core/src/components/kit/icon.ts apps/web/src/workbench/use-floating-card.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/explore/runtime.ts docs/developers/api/index.md apps/web/tests/helpers/explore.ts apps/web/tests/workbench-structure.spec.ts
git add packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.events.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts packages/core/src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts packages/core/src/index.ts packages/core/src/components/kit/icon.ts apps/web/src/workbench/use-floating-card.ts apps/web/src/workbench/StructurePanel.tsx apps/web/src/workbench/Workbench.tsx apps/web/src/workbench/workbench.css apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/src/explore/structure-controller.ts apps/web/src/explore/structure-controller.test.ts apps/web/src/explore/runtime.ts docs/developers/api/index.md apps/web/tests/helpers/explore.ts apps/web/tests/workbench-structure.spec.ts
git commit -m "feat(web): float the structure and offer it from the tooltip"
```

(The commit needs the sandbox disabled: the hook runs lint-staged, type-check, knip and the docs build.)

---

## Phase 2 exit

- [ ] `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run` and `pnpm --filter @protspace/app exec vitest --run` pass; counts reported against the phase-start baseline.
- [ ] `PLAYWRIGHT_PORT=8475 pnpm test:e2e` passes in Chromium, including the `workbench`, `foundation` and `kit-gallery` projects; `E2E_BROWSERS=firefox,webkit PLAYWRIGHT_PORT=8475 pnpm test:e2e` passes the tagged tests.
- [ ] `pnpm perf:counts` passes with the `panel-toggle` segment and every other budget unchanged.
- [ ] `pnpm perf` at 573K stays within the budgets recorded for PR #526, including `panel-toggle` (headed Chrome on a real GPU after `pnpm perf:fetch`; the user runs it, or the orchestrator with the sandbox disabled).
- [ ] `pnpm precommit` and `pnpm format:check` pass on the final tree.
- [ ] `grep -rn "protspace-control-bar\|protspace-tips\|show-tour-button\|Explore.css" packages/core/src apps/web/src apps/web/tests docs/developers` prints nothing (the user guide waits for phase 7).
- [ ] Screenshots for the user, light theme: `/explore` at 1280×720 and 1440×900 with the sidebar open, collapsed, the structure docked and floating, the help menu and the shortcuts dialog open; the view bar at 951 px and at a width that shows More.
- [ ] Tick 2.1–2.13 in `openspec/changes/explore-workbench/tasks.md`.
- [ ] Carry-overs recorded for later plans: move annotation select (4.11), search (4.5) and the query builder (4.4) out of `components/control-bar/`; the Filter rail item and `panel` field (4.4); Clear, Isolate and Reset to the selection bar (4.2); the selection's Escape into `onEscapeFallback` (4.1); docs captures (7.1); the theme choice and the layout store (design decision 10 vs `protspace:theme`, 6.1); an icon-only More so stage 2 frees real room, and the app bar and view bar below about 520 px (5.2, 5.3); the tooltip pin surviving a brush or lasso drag (4.2); the Import panel's `role="menu"` holding plain buttons (4.8); `scatter-plot.ts` past 2,400 lines (8.1); the annotation select's API docs for `statisticsRows` and `annotationDefinitions` (4.11).

<!-- prettier-ignore-end -->
