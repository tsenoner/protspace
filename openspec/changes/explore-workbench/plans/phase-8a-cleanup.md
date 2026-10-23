# Explore Workbench, Phase 8A: Cleanup (tokens and legacy sheets gone, ps-segmented disabled options, legend and projection-details splits, hover render fix, floating card default, phone Ctrl/⌘K, e2e helpers, branch archive) — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the code cleanup design decision 18 asks for, without touching anything that waits for `main`. Every core stylesheet reads `--ps-*` tokens only: the protein tooltip, the projection details card, the scatter plot and the structure viewer leave the legacy aliases, so `styles/tokens.ts`, `styles/mixins.ts` and `styles/overlay-mixins.ts` are deleted together with the dead overlay rules and the 14 `--protspace-*` properties nothing reads, and the style lint's `LEGACY` allowlist and the code that served it are gone (the lint accepts a module reading a custom property it declares itself). The structure viewer's pLDDT / TED choice becomes the kit's `ps-segmented`, which gains disabled options with a reason. `legend.ts` (2,188 lines) splits into four controllers and ends at about 1,000 lines; `projection-metadata.ts` (821) moves its pure formatting into a module of its own; `scatter-plot.ts` is a recorded exception and gives up only its export compositing. Four follow-ups from the ledgers land: a hover no longer redraws every WebGL point, the floating structure card's default position clears the selection bar, Ctrl/⌘K opens search on a phone, and the e2e specs reach the figure editor through the shared helpers. The unused `protspace-legend-state-change` event goes. The local branch `feat/mobile-responsive` is kept as `archive/mobile-landing` and deleted.

**Architecture:** No new runtime structure. Styles: each element sheet reads theme tokens directly, `z-index` values become literal numbers, hosts that composed `tokens` set `font-family: var(--ps-font-sans)` themselves. Legend: the element keeps its properties, state, lifecycle, render and public API; four plain controller classes in `legend/controllers/` (`LegendDataController`, `ItemActionsController`, `ReorderController`, `SettingsController`) take the element itself as their host (type-only import) and read and write its state directly, so a move is cut-and-paste with `this.` → `this.host.`; the members they touch lose `private`. Projection details: pure functions in `projection-metadata-format.ts`. Scatter plot: pure compositing in `export-capture.ts`. Moves change no behaviour; the existing suites are the oracle.

**Tech Stack:** Lit 3 (`css`, `ReactiveControllerHost`), TypeScript, Vitest 4.1.9 (core `unit` project jsdom/node, `browser` project Chromium via `@vitest/browser-playwright`; app node), Playwright 1.61 (`apps/web/tests/playwright.config.ts` projects `workbench`, `mobile`), React 19 (the shell), git (branch refs only in Task 8.14).

**Spec:** `openspec/changes/explore-workbench/design.md`: decision 18 (code structure: about 800 lines per element file, the copied mixins and the unread component properties deleted, one way to do each recurring job) is the core; also 5 (tokens on `:root`, components only read them, the lint), 7 (the type scale 11/12/13/14/16/20, Inter), 8 (the kit: `ps-segmented`, `ps-tooltip`), 2 (the floating structure card), 4 (one render per change; the plot never animates), 20 (testing), 21 (delivery: many small commits, phases leave the app working). `proposal.md` for scope (its Impact section and the `explore-help` capability line change in Task 8.5). `tasks.md` section 8: this plan is part A; it is rewritten with this plan's tasks when the plan is committed (Rulings). Research notes `.superpowers/research/phase-8/R1-cleanup.md` (this plan), `R2-specs.md` and `R3-verify-retire.md` (part B, except the branch retirement). Not pulled in: the rebase onto `main`, the Table (TSV) export, `.github/workflows/*`, the spec files, the PR text, the archive, the real-device pass (all part B).

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. This plan was written against `16e73279` (phase 7 complete). If an anchor has moved, apply the intended change to the current code and say so in the report.

## Global Constraints

From phases 1–7, unchanged:

- Every design token is a CSS custom property named `--ps-*`, declared only in `packages/core/src/styles/theme.ts`.
- New core stylesheets hold no raw colours (`#…`, `rgb()`, `hsl()`, `white`, `black`) and no literal font sizes; they read `--ps-*` tokens. Size literals such as `360px` for widths are fine.
- New code never declares tokens on `:host`; tokens come from `:root`.
- `css` literals live only in `*.styles.ts` files or `styles/` folders (ESLint rule in `eslint.config.mjs`; `styles-integrity.test.ts` finds them by glob). Non-style modules must not live in `packages/core/src/styles/`, because the integrity test treats every export there as a stylesheet.
- Kit elements use the `ps-` tag prefix; feature elements keep `protspace-`.
- Icons come from Lucide only, at stroke width 1.75 and sizes 14, 16 or 20 px.
- Popovers use `popover="manual"`; dialogs use `<dialog>.showModal()`. Both render in the top layer.
- Fonts are self-hosted; never load a third-party font CDN.
- Target browsers: the last two versions of Chrome, Edge, Firefox and Safari.
- Every new export needs a consumer in the same commit (knip runs in the pre-commit hook); the task's own test file importing it is enough. Public kit API is exported from `packages/core/src/components/kit/index.ts`, which `packages/core/src/index.ts` re-exports. Exported types with no importer fail knip: keep option and view-model types module-private unless a consumer imports them.
- Commits: Angular `type(scope): subject` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), subject under 72 characters, at most two lines, never a `Co-Authored-By` or Claude trailer. Commit when the task's tests pass. The husky hook runs `pnpm precommit` (lint-staged, type-check, knip, docs checks, docs build); never bypass it on a task's final commit. Type-coupled changes land in one commit.
- Run core tests package-scoped: `pnpm --filter @protspace/core exec vitest --run --project unit <file>` or `--project browser <file>`.
- Dev and e2e servers use ports other than 8080, 8091 (the user's) and 8479 (the user's preview of this worktree; never stop it). For e2e set `PLAYWRIGHT_PORT`, e.g. `PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec>`.
- `--ps-text-faint` is for disabled text and decorative icons only; readable secondary text, hints, placeholders, keycaps and group labels use `--ps-text-muted`.
- Runtime elements are rendered by React exactly once, unconditionally, with stable ids, never keyed or moved; phone, tablet and landscape layouts are CSS on the same tree. The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions`, `help`, `theme`, `view-bar`, `dataset`, `rail`, `more`, `search-toggle` are kept for the tour, the e2e and the perf suites. `#myDataLoader` stays mounted, hidden. `#myStructureViewer` never changes parent (a disconnect disposes Mol*).
- React → runtime goes through the layout store or DOM events on elements the runtime wires by id; a React component may also call a public method of a core element it finds by id, but never reads runtime state off an element. Runtime → React goes through `workbench-status.ts` or `layout-state.ts`. React sets kit properties through props and listens to `ps-*` events with a ref and `addEventListener`.
- The shell (`apps/web/src/workbench/`) imports `@protspace/core` only as types (ESLint guard, `eslint.config.mjs`); values it needs come from `@protspace/utils` or the app's own modules (`apps/web/src/explore/*`, `apps/web/src/lib/*`). Kit elements are used as custom-element tags.
- No ancestor of `#myImportMenu`, `#myExportMenu`, or any element that holds a popover gets `display: none` in any layout.
- One plot resize per layout change; the plot never animates. A theme change is not a layout change: it never changes `#myPlot`'s box.
- Layout persists only under `protspace:layout:v1`; layout never goes into the URL. The theme persists only under `protspace:theme`. Stored legend settings (`protspace:legend:{datasetHash}:{annotation}`), `protspace_publishState` and the OPFS `protspace-last-import` directory keep their keys and formats.
- The legend's public surface (`legend.api.test.ts`: `METHODS` and `GETTERS`), DOM contract (`legend.dom-contract.test.ts`) and persistence stay as phases 3–7 left them.
- E2E: desktop specs stay `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Phone, tablet and landscape specs are `apps/web/tests/mobile-*.spec.ts` (project `mobile`, Pixel 7). Specs reach controls through helpers (`helpers/explore.ts`, `helpers/workbench.ts`, `helpers/legend.ts`, `helpers/mobile.ts`, `helpers/theme.ts`, `helpers/a11y.ts`, `helpers/plot.ts`, `helpers/structure.ts`, `helpers/figure.ts`, `helpers/examples.ts`) that find them by role, accessible name or tag; a helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement, state and computed colours, not 3D pixels.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) also checks `apps/web/src/workbench/workbench.css` and `apps/web/src/tour/product-tour.css` for raw colours and for reads of `--ps-*` variables `theme.ts` does not define. Sizes come from tokens: `--ps-touch-target` 40 px, `--ps-control-sm` 28, `--ps-control-md` 32, spaces `--ps-space-0-5` 2 … `-6` 24 px (no 16), radii `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`.
- `ps-icon-button` (`icon`, `label`, `pressed`, `size`, `tooltip-placement`, `expanded`, `hasPopup`), `ps-button` (`variant`), `ps-menu`/`ps-menu-item` (`menuitem`, `menuitemradio`), `ps-dialog` (`heading`, `size`; role `dialog` named by its heading), `ps-tooltip` (`text`, `placement`, `anchor` defaulting to the previous element sibling, `names-target`). `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void`, `ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 }`.
- Docs images: a light image with a dark twin is written as a pair (`{.light-only}` then `{.dark-only}`); `pnpm docs:images:check` runs in the hook; captures run `pnpm docs:screenshots -g "<file>"` / `pnpm docs:animations -g "<file>" && pnpm docs:gifs <name>` on their own server (port 8096, sandbox disabled, real Mol* from jsDelivr for structure captures).

Environment (from the phase 1–7 ledgers; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run need the Bash sandbox disabled (`EPERM listen ::1` inside it). `--project unit` works inside the sandbox. `__screenshots__/` folders under `packages/core/src` are git-ignored failure captures, not baselines: no screenshot baseline needs updating when a size changes.
- `pnpm add`/`pnpm install` and `git commit` need the sandbox disabled (the hook needs network and writes outside it). Stage files by path, never `git add -A`. `git branch` (Task 8.14) writes refs only and works inside the sandbox.
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests (this phase changes no utils). The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; use `pnpm --filter @protspace/app exec vitest --run <file>` and `pnpm --filter @protspace/utils exec vitest --run <file>`.
- App unit tests run in node with no DOM and cannot load Lit (`apps/web/vitest.config.ts`); React components are covered by e2e only.
- jsdom has no 2D canvas (`getContext('2d')` returns null and logs "Not implemented"): canvas pixel tests are `*.browser.test.ts`.
- Playwright contexts default to `colorScheme: 'light'`. Tests that assert light must choose Light first (the default theme is System).
- Playwright's `ControlOrMeta` sends Meta on a macOS host but the app reads the modifier from the user agent (Control in headless Chromium); use `Control` explicitly in specs that need the modifier. `protein-search.ts` accepts either `metaKey` or `ctrlKey`.
- The plot area holds two `role="status"` regions (status corner and selection bar): scope `getByRole('status')` to its element. Use `--project=mobile` (with `=`) for the mobile project.
- The e2e Mol* stub (`MOLSTAR_STUB`, installed by `stubStructureRequests(page)`) builds a viewer that draws nothing; e2e asserts placement and state.
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race), the `numeric-binning` "hover point" test under full-suite load, `mobile-plot-touch.spec.ts:351`; re-run once alone before investigating.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build scans untracked files under `docs/`: leave no scratch markdown there.
- Only stop processes you started yourself, by the PID you recorded; check a port's owner with `ps -p <pid> -o command=` before killing anything ("Claude Helper" belongs to the desktop app).
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.
- Never edit `.github/workflows/*` (agents are blocked; part B's business). Never push. Never touch branches other than `feat/explore-workbench`, except the two refs Task 8.14 names.

**Execution rule (user, 2026-10-13):** per task, run only the unit/browser test files for the code you touch plus at most ONE e2e spec file (filtered with `-g "<title>"` and `--project workbench` or `--project=mobile` as needed). The full suites, the full e2e run, both e2e projects, `pnpm perf:counts`, `pnpm perf` and the full `pnpm docs:images` run once, in "Phase 8A exit". Every task lists the existing specs its change could reach under "Unrun at task time" so the exit run checks them first.

Baseline: run the suites at the start of the phase and use those counts, not phase 7's (phase 7 exit: utils 502; core 3367 / 247 files; app 961 + 1 skipped; full e2e 476; `--project=mobile` 89; `product-tour.spec.ts` 21): `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`, `PLAYWRIGHT_PORT=8475 pnpm test:e2e` and `pnpm perf:counts`. Record them in `.superpowers/sdd/phase-8a-cleanup/progress.md`; every task report gives the counts of the files it ran before and after.

Phase 8A:

- **Type mapping** (literal rem sizes and legacy aliases to the scale, design decision 7; no new token): `0.625rem` (10 px) → `var(--ps-text-xs)` (11 px, user decision); `--text-caption` (11 px) → `var(--ps-text-xs)`; `0.75rem` → `var(--ps-text-sm)` (12); `0.8125rem` → `var(--ps-text-base)` (13); `0.875rem` → `var(--ps-text-md)` (14); `1rem` → `var(--ps-text-lg)` (16); `--font-medium` → `var(--ps-weight-medium)`; a literal `font-weight: 600` stays a literal (the lint does not check weights; change it only inside a rule the task already edits, to `var(--ps-weight-semibold)`). Non-type aliases: `--radius` → `var(--ps-radius-sm)` (4 px); `--border-width` → `1px`; `--spacing-xs` → `var(--ps-space-1)`, `--spacing-sm` → `var(--ps-space-2)`.
- **z-index** is written as a literal number (theme.ts has no layer tokens; the lint does not check `z-index`): `--z-canvas` → `1`, `--z-svg` → `3`, `--z-overlay` → `10`. The stacking order inside each shadow root must not change.
- **Fonts.** `tokens`' `:host` set `font-family: var(--font-family)` (system-ui). A host that composed `tokens` sets `font-family: var(--ps-font-sans)` on its own `:host` (scatter plot in 8.2, structure viewer in 8.4). The protein tooltip inherits the plot's. The visible change, system-ui → Inter inside the plot's chips, the tooltip and the structure viewer, is intended (decision 7).
- **LEGACY only shrinks**, and loses a module in the commit that cleans or deletes it: 7 at the start; 4 after 8.1 (`protein-tooltip.styles.ts`, `projection-metadata.styles.ts` and `./tokens.ts`, which the own-property rule makes clean, leave); 3 after 8.2 (`scatter-plot.styles.ts`); gone after 8.4 (the structure viewer leaves and the three legacy sheets are deleted with `LEGACY` and the code that served it). An export loses its module the moment its last importer goes (knip): `srOnlyMixin` in 8.1; `tokens`, `segmentedControlMixin` and `overlayMixins` (whole files) in 8.4.
- **Moves are move-only.** A split task changes no behaviour, keeps comments with their code, and rewrites only what the move forces (`this.x` → `this.host.x`, a method made non-private, an import). No reformatting of moved bodies beyond Prettier. Each split task's report lists a **moved-member map** (`ProtspaceLegend._handleScatterplotDataChange` → `controllers/data-controller.ts LegendDataController.onDataChange`, …), which part B's rebase uses to re-home `main`'s edits to `legend.ts` (data-change and annotation code) and `projection-metadata.ts` (render).
- **Legend controllers' host.** `LegendDataController`, `ItemActionsController`, `ReorderController` and `SettingsController` (in `packages/core/src/components/legend/controllers/`, re-exported from `controllers/index.ts`) are plain classes: `constructor(private readonly host: ProtspaceLegend)` with `import type { ProtspaceLegend } from '../legend'`. A member of `ProtspaceLegend` that a controller reads or writes drops `private` (keeping `@state()`/`@property()`); only members a controller touches lose it. Its state fields, getters and helper methods sit under one section comment in `legend.ts`: "Read and written by the legend's controllers (controllers/*); not public API." The controller instance fields a controller reads (`_scatterplotController`, `_persistenceController`, `_eatControls`, `_keyboard`, `_otherPopover`, `_colorPicker`, `_rowMenu`) lose `private` but stay in the Controllers section, so the reactive controllers register in the same order. The four new controller fields (`_data`, `_actions`, `_reorder`, `_settings`) are `readonly`. State only moved code uses moves into the controller as a private field. The four new controllers call each other only through the host's fields (`this.host._reorder.clear()`), never by import (and never `this.host._data.updateItems()`; see the next rule); a type-only import of an older controller's exported type (`PersistenceCallbacks`) is allowed.
- **`_updateLegendItems` stays the one entry.** `ProtspaceLegend._updateLegendItems(): void` stays on the element as a one-line delegate to `this._data.updateItems()`, and every moved caller calls `this.host._updateLegendItems()`. `updateItems()` has exactly that one caller, so `perfCounters.legendUpdate` (incremented at the start of `updateItems()`, moved with its body) still counts the calls tests spy on (`legend.sort-menu.browser.test.ts`, `legend.settings.browser.test.ts`, `legend.numeric-settings.test.ts`, `legend.shape-size.test.ts`). `perfCounters.legendRebuild` stays at the start of `rebuildItems()`. Every other moved method is reached through its controller field; tests that called it on the element call it on the field (`(el as AnyLegend)._actions.extractFromOther('cat1')`).
- **Line counts.** Every task that edits one of these reports `wc -l`: `legend.ts` (2,188 → about 1,000 after 8.9, ceiling 1,100); `projection-metadata.ts` (821 → at most 650 after 8.6); `scatter-plot.ts` (2,643; the recorded exception, about 2,600 after 8.10: report the count; there is no ceiling). Any new module stays under 800 lines.
- **Visible changes allowed this phase, and only these:** the tooltip's 10 px annotation header becomes 11 px; the plot's chips, tooltip and structure viewer render in Inter; the structure viewer's colour choice takes the kit's segmented look (surface chip with an accent ring instead of an accent fill); the floating card's default position rises above the selection bar; Ctrl/⌘K opens search on a phone. Anything else that looks different is a defect.
- **Part B stays easy.** Do not touch `export-menu.ts`, `export-handler.ts`, `notifications.ts`, `dataset-controller.ts` or any OpenSpec spec file; do not rename or move a file except those this plan splits; keep `tasks.md`'s part-B items untouched.

## Review Focus

1. **Text loses its size, font or stacking with no error when the legacy aliases go.** The protein tooltip reads `--text-caption` only by inheritance from the plot's `:host`; the plot's SVG (brush, lasso, spider) and chips stack by `--z-svg`/`--z-overlay`, so an undefined variable silently drops them under the canvas; the structure viewer's loading veil and error box stack by `--z-overlay`. Pinned by Task 8.1 (tooltip computed sizes in `protein-tooltip.browser.test.ts`; the lint now checks the tooltip), Task 8.2 (`scatter-plot.theme.browser.test.ts`: SVG `z-index` 3 above the canvas's 1, chips 11 px / 500 in Inter), Task 8.4 (viewer veil and error at `z-index` 10, the lint with no exemptions).
2. **The structure's TED choice misbehaves once it is a kit control.** An arrow key or a click lands on a disabled TED and recolours (calling `setColorTheme('ted-domains')` without domains), the reason "Available once the structure has loaded" cannot be read because a native `disabled` button gets no hover or focus, or the group shrinks below 40 px on touch, or the kit's wider 13 px labels push the row out of a 240 px docked sidebar. Pinned by Task 8.3 (`fields.browser.test.ts` disabled-option cases) and Task 8.4 (`structure-viewer.coloring.test.ts`, `structure-viewer.browser.test.ts`, including the 240 px row case).
3. **The legend split drifts behaviour.** Settings stop persisting per dataset and annotation, the Escape order or keyboard reorder's Escape-restore breaks, `legendUpdate`/`legendRebuild` count twice or never, a drag to Other stops merging. Pinned by Tasks 8.7–8.9 (the existing legend suites run unchanged except for the controller-field call sites; `perfCounters.legendUpdate` equals `_updateLegendItems` calls; `legend.api.test.ts` untouched) and the exit's `pnpm perf:counts` (legend counters per segment unchanged).
4. **A hover that no longer redraws leaves something stale.** The tooltip's position or measured height (`_tooltipHeight`, the second pass) stops updating, a Shift-focus fade stops, or a hovered spider node no longer reacts. Pinned by Task 8.10 (`scatter-plot.render-coalescing.test.ts` cases; `scatter-plot.tooltip-measure.test.ts` and `scatter-plot.spider.browser.test.ts` run unchanged).
5. **The floating card's new default lands somewhere worse.** It moves a card the user placed, rides under the app bar on a short plot, or still covers Copy IDs at 1280×720 with the sidebar open. Pinned by Task 8.11 (`layout-geometry.test.ts` default, stored and short-plot cases; `workbench-structure.spec.ts` trial click on Copy IDs).

## Rulings

Settled open questions (R1 Q1–Q5 and the notes of R1 §1 and R3 that belong to part A; the user's 2026-10-16 decisions bind):

- **scatter-plot.ts is a recorded exception** (R1 Q1): design.md decision 18 gets the exception and a follow-up (Task 8.5); filing an issue is left to the user. Only the export compositing moves (Task 8.10), into a pure `export-capture.ts`: it is the one cut that needs no private state. Isolation and tooltip/pin are not moved: their tests reach the element's privates (`_isolationHistory`, `_isolationMode`, `_plotDataBuild`, `_measureTooltipHeight`, `_tooltipMeasureToken`), and the code shares state with the `updated()` reconcilers on the hottest path, so a move is not "clean".
- **legend.ts ends at about 1,000 lines** (R1 Q1; user: 900–1,000): four controllers (data pipeline 8.7; item actions and keyboard reorder 8.8; settings 8.9). Ceiling 1,100; Task 8.9 records the reached count in design.md decision 18.
- **Legend controllers take the element as host** (R1 B1 said "host interface"): the moved code reads and writes about 30 members; a callbacks object (the older controllers' pattern) would double each as a getter/setter pair, and a separate host interface would repeat each member's type. A type-only import of `ProtspaceLegend` plus non-private members keeps the move a cut-and-paste. `docs/developers/architecture.md` says which controllers use which pattern (Task 8.7).
- **Tests follow moved methods to the controller field**; only `_updateLegendItems` stays on the element, because it is the perf-counted entry tests spy on (Global Constraints).
- **`protspace-legend-state-change` is deleted** (R1 §1 note 9): no listener in the app, the docs or `main`. Its dispatcher and seven calls go in Task 8.8, with the two test stubs that replaced it.
- **The structure viewer uses `ps-segmented`** (R1 Q2; design 18 one way): `SegmentedOption` gains `disabled?: boolean` and `tooltip?: string`. A disabled option is `aria-disabled="true"`, not native `disabled`, so it keeps hover and focus for its `ps-tooltip`; arrow keys skip it; a click on it changes nothing. The viewer loses its own segmented CSS and takes the kit's look (Task 8.3, 8.4).
- **10 px becomes 11 px** (R1 Q3; user): `0.625rem` → `--ps-text-xs`; no new token.
- **Floating card default** (R1 Q4; user): `FLOATING_CARD.bottomInset = 64` (the selection bar's 12 px offset, its 38 px height, and the 14 px inset) for the default (null) rectangle only; a stored rectangle is untouched. On a plot too short for the card above the band, the default card keeps its size and sits at the top (Task 8.11).
- **Closed without code** (R1 Q5; user): `_snapMount` (a CSS fix cannot cover fractional offsets from the floating card or the splitter); `use-app-bar-sides.ts` (no CSS-only centring exists); the phone tour's "Interactive Scatterplot" popover over the top legend rows. Carried to part B's device checklist: that popover, the fast legend drag, the landscape ≤500 px scroll, the legend handle's 250 ms hold.
- **Earlier open calls stay as they are** (user): phone legend row order, the landscape eye-only legend, the compact touch card, the "Theme" label. No task.
- **Info buttons for Contours, Filter and Export** are dropped from `proposal.md` (R2 Q1; user): never built; Export has its menu note (Task 8.5).
- **The lint accepts a module's own custom properties** (R1 §1 gap; user): `cssViolations` treats a `var(--x)` as known when the checked CSS declares `--x` (any non-`--ps-` name), as `colourViolations` already did; declaring a `--ps-*` property is still flagged, and a literal font size behind an own property is still flagged. "The checked CSS" is everything `cssOf(path)` returns for that module, so a sheet composing another sheet counts its declarations as own; after 8.4 no element composes a sheet that declares custom properties (Task 8.1).
- **tokens.ts leaves LEGACY in 8.1, before it is deleted** (consequence of the rule above): its only violation was `font-family: var(--font-family)`, which it declares itself, and the "still needs its legacy exemption" test fails a clean listed module. If the implementer finds a different set of LEGACY modules clean under the new rule, LEGACY loses exactly those and the report says so.
- **No guard test against re-importing the deleted sheets** (R1 §4 optional): a deleted module cannot be imported without failing type-check.
- **The scatter plot's read properties stay**: `--protspace-width`, `--protspace-height` (documented embedder API, `embedding.md`), `--protspace-border-radius`, `--protspace-brush-stroke-width`; the 11 unread ones and the viewer's three `--protspace-viewer-*` go (the 14).
- **_tooltipData joins NO_ADDITIONAL_RENDER_KEYS** (R1 note 3 confirms: each hover sets a new `{x, y, view}`, which runs `_renderLoop.request()`, a full `WebGLRenderer.render` and `_updateSelectionOverlays`; nothing in WebGL draws hover, Shift focus goes through `_focusedValues`). `_tooltipHeight` joins too (it caused the second pass) (Task 8.10).
- **Phone Ctrl/⌘K** (R1 note 8): the app bar opens search itself while it is compact and closed; `protein-search.ts`'s own handler stays for every other layout (Task 8.12).
- **E2E specs**: the four specs R1 named, and `workbench-helpers.spec.ts` (its :461 spells `protspace-publish-modal .publish-preview-canvas`), swap their hand-written `page.locator('protspace-publish-modal')` (and `.publish-preview-canvas`) for `figureEditorContent(page)` (and `figurePreviewCanvas(page)`); how each spec opens the editor stays as it is (`workbench-escape.spec.ts` keeps its `open-publish-editor` dispatch: that is setup, not a selector). `figure-editor.spec.ts`'s `document.querySelector` reads inside `evaluate` and its two `page.locator('protspace-publish-modal …')` chains stay (R1 note 6) (Task 8.13).
- **feat/mobile-responsive** (R3 Q7; user): `archive/mobile-landing` points at the branch's tip `1a6e3405` (all 55 commits), not at cherry-picks of the nine landing commits: those interleave with the branch's layout and header commits they may build on, and a rewritten branch could be broken with nothing to tell. The nine SHAs are listed in Task 8.14's report for whoever picks the landing work up. Then `feat/mobile-responsive` is deleted. Neither is pushed (Task 8.14).
- **tasks.md**: the commit that adds this plan rewrites section 8 as "8A" (Tasks 8.1–8.14 below) and "8B, planned after #526 merges" (rebase, TSV export, verification and device pass, spec files, PR text and branch note, archive), numbered from 8.15 when part B is planned, and points the section header's plan link at this file (`plans/phase-8a-cleanup.md`). No task edits `tasks.md`; the exit ticks 8.1–8.14.
- **Docs images**: text sizes change (tooltip header, Inter in the plot and viewer, the viewer's control), so the exit regenerates every docs image in one commit, as phase 7's exit did.
- **The viewer binds the control's value with `live()`** (plan review): `_handleColorModeChange` can roll `_colorMode` back within one update, and a plain property binding would then skip the write and leave the control showing the refused mode (Task 8.4).
- **Kit segmented options stay on one line, and the viewer's row is pinned at 240 px** (plan review): the kit's 13 px labels are wider than the viewer's old 12 px buttons, and the 240 px docked sidebar is a pinned layout, so an eye check over regenerated images is not enough. `white-space: nowrap` on the kit's option (Task 8.3) turns a squeeze into measurable overflow; Task 8.4's browser case measures it; if it fails, only the viewer's toolbar gap and padding narrow, never the kit's chips.
- **design.md decision 5 is brought in line** (plan review): it is what part B's spec files are written from, and after this phase its lint sentence (now the own-property rule) and its "layers" size (no layer tokens; `z-index` is plain numbers) would be false (Task 8.5).
- **The export-compositing comment is rewritten, not kept** (plan review; one reviewer asked to make it optional): its "the drawImage below" is false once the code moves, so the six-line rewrite stays; the 2,600-line figure for `scatter-plot.ts` is a report, not a ceiling (Task 8.10).
- **The floating card's new default goes in even if the old one did not cover the bar in the e2e** (plan review): the user's 2026-10-16 decision binds; a passing fail-first run is reported as a finding, not a stop (Task 8.11).
- **Greps skip unrelated `LEGACY_*` names and Tailwind's `--breakpoint-sm`** (plan review): the lint's `LEGACY` is matched as `LEGACY([^_A-Z]|$)`; Task 8.5 searches `--breakpoint-` in the developer docs only, so `apps/web/src/index.css` (the landing page) is never touched.
- **The perf run uses phase 7's v3 bundle** in the orchestrator session's scratchpad, not `perf/datasets/573K_swissprot.parquetbundle`, which is a different, older file (exit step 4).

Plan shape:

- Fourteen tasks in four review blocks: 8.1–8.4 (styles and the kit's disabled option; LEGACY gone), 8.5–8.8 (developer and design docs; projection details split; the legend's data pipeline, item actions and reorder), 8.9–8.12 (legend settings; scatter-plot hover and export compositing; floating card; phone search), 8.13–8.14 (e2e helpers; branch archive). Styles go first so the splits move code that is already on tokens; the tooltip's sheet lands before the plot drops `tokens` (Review Focus 1).

## File structure

`packages/core/src/styles`

- `style-lint.test.ts` (M 8.1 own-property rule, LEGACY 7 → 4; M 8.2 LEGACY 4 → 3; M 8.4 `LEGACY`, `LEGACY_VARS`, `COLOUR_ALIASES`, `colourViolations`, `OWNER`, `ownCssOf`, the first test's third block and the two LEGACY tests deleted): the style lint.
- `mixins.ts` (M 8.1 `srOnlyMixin` deleted; D 8.4), `overlay-mixins.ts` (D 8.4), `tokens.ts` (D 8.4).

`packages/core/src/components/scatter-plot`

- `tooltips/protein-tooltip.styles.ts` (M 8.1): type tokens; out of LEGACY.
- `tooltips/protein-tooltip.browser.test.ts` (M 8.1): computed sizes.
- `tooltips/tooltip-height-estimate.ts` (M 8.1 comment only: the header row's 11 px).
- `projection-metadata/projection-metadata.styles.ts` (M 8.1): kit `srOnly`, type tokens; out of LEGACY.
- `projection-metadata/projection-metadata.browser.test.ts` (M 8.1): computed sizes, sr-only still hidden.
- `scatter-plot.styles.ts` (M 8.2): no `tokens`/`overlayMixins`, 11 unread properties and the dead spinner rule gone, literal z-index, type tokens, `font-family` on `:host`.
- `scatter-plot.theme.browser.test.ts` (M 8.2): stacking, chip type, host font.
- `projection-metadata/projection-metadata-format.ts` (C 8.6), `projection-metadata-format.test.ts` (C 8.6): pure metadata splitting and formatting.
- `projection-metadata/projection-metadata.ts` (M 8.6): imports the format module.
- `scatter-plot.ts` (M 8.10): `_tooltipData`, `_tooltipHeight` in `NO_ADDITIONAL_RENDER_KEYS`; `captureAtResolution` composes through `export-capture.ts`.
- `scatter-plot.render-coalescing.test.ts` (M 8.10): a tooltip change renders nothing.
- `export-capture.ts` (C 8.10), `export-capture.browser.test.ts` (C 8.10): pure export compositing.

`packages/core/src/components/kit`

- `segmented.ts` (M 8.3): `SegmentedOption.disabled`, `SegmentedOption.tooltip`; arrow keys skip disabled options.
- `choice.styles.ts` (M 8.3): the disabled option's look; options on one line (`white-space: nowrap`).
- `fields.browser.test.ts` (M 8.3): disabled-option cases.

`packages/core/src/components/structure-viewer`

- `structure-viewer.ts` (M 8.4): the colour choice is a `ps-segmented`.
- `structure-viewer.styles.ts` (M 8.4): no legacy sheets; loading overlay, spinner and `spin` local on tokens; `--protspace-viewer-*` gone; `font-family` on `:host`.
- `structure-viewer.coloring.test.ts`, `structure-viewer.browser.test.ts` (M 8.4).

`packages/core/src/components/legend`

- `legend.ts` (M 8.7, 8.8, 8.9): state, lifecycle, render, public API, wiring.
- `controllers/data-controller.ts` (C 8.7): `LegendDataController`.
- `controllers/item-actions-controller.ts` (C 8.8): `ItemActionsController`.
- `controllers/reorder-controller.ts` (C 8.8): `ReorderController`.
- `controllers/settings-controller.ts` (C 8.9): `SettingsController`.
- `controllers/index.ts` (M 8.7, 8.8, 8.9): re-exports.
- Tests updated for call sites only: `legend-extract.test.ts`, `legend.numeric-settings.test.ts`, `legend.shape-size.test.ts`, `legend.rows.test.ts`, `legend.score-strips.test.ts`, `legend.sort-menu.browser.test.ts`, `legend.settings.browser.test.ts` (and any other test that calls a moved method; the implementer greps `\._[a-zA-Z]+\(` in `legend/*.test.ts`); `legend.score-sync.test.ts` (8.8).
- `controllers/data-controller.test.ts` (C 8.7), `controllers/reorder-controller.test.ts` (C 8.8): direct cases for the two controllers whose behaviour the element suites do not name directly; `ItemActionsController` and `SettingsController` are pinned by the existing legend suites through `_actions` / `_settings`.
- Comment-only edits that follow moved names: `controllers/persistence-controller.ts`, `controllers/scatterplot-sync-controller.ts` (8.7), `legend-data-processor.ts` (8.8); `controllers/data-controller.ts` (M 8.8: `_reorder.clear()`).

`apps/web`

- `src/explore/layout-defaults.ts` (M 8.11 `FLOATING_CARD.bottomInset`), `src/workbench/layout-geometry.ts` (M 8.11), `src/workbench/layout-geometry.test.ts` (M 8.11).
- `src/workbench/AppBar.tsx` (M 8.12): Ctrl/⌘K opens search while compact.
- `src/dev/KitGallery.tsx` (M 8.3): a disabled option with a reason.
- `src/landing/ExplorerFrame.tsx` (M 8.5 comment only).
- `src/explore/data-renderer.ts` (M 8.7, comment only: the moved `computeAnnotationCounts`).
- `tests/workbench-structure.spec.ts` (M 8.11), `tests/mobile-bars.spec.ts` (M 8.12), `tests/mobile-legend.spec.ts`, `tests/workbench-escape.spec.ts`, `tests/workbench-import-export.spec.ts`, `tests/workbench-theme.spec.ts`, `tests/workbench-helpers.spec.ts` (M 8.13); `tests/kit-gallery.spec.ts` runs unchanged as 8.3's e2e.

`docs` and `openspec`

- `docs/developers/style-architecture.md` (M 8.5), `docs/developers/embedding.md` (M 8.5), `docs/developers/architecture.md` (M 8.7, 8.8, 8.9: the legend's file table and the controller paragraph).
- `openspec/changes/explore-workbench/design.md` (M 8.5 decision 5 own-property lint rule and no layer tokens, decision 18 exception and follow-up; M 8.9 the legend's reached size), `proposal.md` (M 8.5 info buttons dropped; Impact line on the deleted sheets).

Git refs (8.14): `archive/mobile-landing` (C), `feat/mobile-responsive` (D). Ledger `.superpowers/sdd/phase-8a-cleanup/progress.md` (orchestrator).

---

### Task 8.1: The lint accepts a module's own properties; tooltip and projection details on tokens

The style lint learns that a module reading a custom property it declares itself is fine, which `--card-gap` and the plot's `--protspace-*` sizes need once their modules leave `LEGACY`. The protein tooltip and the projection details card then move their literal font sizes and `--text-caption` reads onto the type tokens (10 px becomes 11 px), and the card composes the kit's `srOnly` instead of `srOnlyMixin`, which leaves `mixins.ts`. This lands before the plot drops `tokens`, so the tooltip never loses its caption size by inheritance.

**Files:**

- Modify: `packages/core/src/styles/style-lint.test.ts` (`cssViolations` own-property rule; a new case after the first test; `LEGACY` loses three entries; the `OWNER` doc comment at :63 stops naming `srOnlyMixin`)
- Modify: `packages/core/src/styles/mixins.ts` (delete `srOnlyMixin` and its doc comment)
- Modify: `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts` (12 literal sizes, 2 `--text-caption` reads)
- Modify: `packages/core/src/components/scatter-plot/tooltips/tooltip-height-estimate.ts` (comment only: the header row is 11 px; constants unchanged)
- Modify: `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts`
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts` (`srOnly` from `../../kit/kit-shared.styles`; sizes in `.header`, `.item`, `.annotation-stats`)
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`

**Interfaces:**

- Consumes: `cssViolations(cssText: string): string[]`, `colourViolations`, `LEGACY`, `DEFINED`, `RUNTIME_VARS`, `cssOf(path)` (`style-lint.test.ts`); `srOnly` (`components/kit/kit-shared.styles.ts`, class `.sr-only`, the same rules as `srOnlyMixin`); the type mapping (Global Constraints); `proteinTooltipStyles` (`protein-tooltip.styles.ts`: `.tooltip-annotation-header`, `.tooltip-annotation-evidence`, `.eat-provenance-heading`/`.eat-provenance-source` among others); `projectionMetadataStyles` (`.header`, `.item`, `.annotation-stats`); `adoptTheme` (`components/kit/adopt-theme.ts`); `TooltipView` (`@protspace/utils`; blocks are `{ key, label, displayValues, numericValue, numericType, scores, evidence, predicted }`, `predicted` a `PredictedCell` `{ value, confidence, source }`).
- Produces:
  - `cssViolations`: a `var(--name)` is unknown only when `name` is not in `DEFINED`, not in `RUNTIME_VARS` and not declared (`--name:`, any name not starting `--ps-`) anywhere in the `cssText` it is given. A declaration whose property starts with `--ps-` is still a violation; a literal `font-size`/`font` is still a violation whatever variable it goes through.
  - `LEGACY` = `{ scatter-plot.styles.ts, structure-viewer.styles.ts, ./mixins.ts, ./overlay-mixins.ts }` (4).
  - `mixins.ts` exports `segmentedControlMixin` only.
  - Computed sizes: tooltip annotation header 11 px (was 10), evidence caption and EAT provenance lines 11 px, every other tooltip size unchanged in px; projection details `.header` 13 px, `.item` and the stats grid 12 px.

**Tests:**

- `style-lint.test.ts`: "accepts a module reading a custom property it declares": `cssViolations(':host { --gap: 2px; } .a { margin: var(--gap); }')` is `[]`; `cssViolations(':host { --ps-gap: 2px; } .a { margin: var(--gap); }')` is `['--ps-gap: 2px', 'margin: var(--gap)']`; `cssViolations(':host { --size: 12px; } .a { font-size: var(--size); }')` is `['font-size: var(--size)']`.
- `style-lint.test.ts`: the `'%s reads colours and font sizes from tokens'` cases now include the tooltip, projection-metadata and `tokens.ts` modules and pass; `'%s still needs its legacy exemption'` passes for the four left.
- `protein-tooltip.browser.test.ts`: "the annotation header and the evidence caption are 11 px" (also the EAT provenance lines, and the header row still fits the height estimate's 16 px row); "the protein name is 13 px and the annotation rows 12 px" (unchanged sizes pinned).
- `projection-metadata.browser.test.ts`: "the card's header is 13 px and its rows 12 px"; "the screen-reader text stays visually hidden" (an `.sr-only` node's box is 1×1 and clipped).
- Run: `style-lint.test.ts`, `styles-integrity.test.ts`, `tooltip-height-estimate.test.ts` (`--project unit`), the two browser files (`--project browser`, sandbox disabled).
- Unrun at task time (exit): `multi-annotation-tooltip.spec.ts`, `eat-visualization.spec.ts`, `mobile-plot-touch.spec.ts`, `workbench-view-bar.spec.ts` (projection details).

LEGACY count: 4.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `--project unit` runs inside the sandbox; `--project browser` needs the sandbox disabled (`EPERM listen ::1` otherwise). No utils change, no core build needed (nothing in the app reads these files).

- [ ] **Step 1: Write the failing lint case and shrink LEGACY**

In `packages/core/src/styles/style-lint.test.ts`, replace the `LEGACY` set:

```ts
const LEGACY = new Set<string>([
  '../components/scatter-plot/projection-metadata/projection-metadata.styles.ts',
  '../components/scatter-plot/scatter-plot.styles.ts',
  '../components/scatter-plot/tooltips/protein-tooltip.styles.ts',
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
  './tokens.ts',
]);
```

with:

```ts
const LEGACY = new Set<string>([
  '../components/scatter-plot/scatter-plot.styles.ts',
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
]);
```

(`tokens.ts` leaves too: its one violation, `font-family: var(--font-family)`, reads a property it declares itself, so under the new rule it is clean and `'%s still needs its legacy exemption'` would fail it.)

Then, inside `describe('style lint', () => { … })`, directly after the closing `});` of the first test `it('flags raw colours, literal font sizes, stray tokens and unknown variables', …)`, add:

```ts
  it('accepts a module reading a custom property it declares', () => {
    expect(cssViolations(':host { --gap: 2px; } .a { margin: var(--gap); }')).toEqual([]);
    // Declaring a token is still flagged, and declaring one does not make --gap known.
    expect(cssViolations(':host { --ps-gap: 2px; } .a { margin: var(--gap); }')).toEqual([
      '--ps-gap: 2px',
      'margin: var(--gap)',
    ]);
    // A literal font size is still a literal behind an own property.
    expect(cssViolations(':host { --size: 12px; } .a { font-size: var(--size); }')).toEqual([
      'font-size: var(--size)',
    ]);
  });
```

- [ ] **Step 2: Run the lint to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`

Expected: FAIL in four places:
- "accepts a module reading a custom property it declares": the first expectation gets `['margin: var(--gap)']` (`cssViolations` knows only `DEFINED` and `RUNTIME_VARS`).
- `'../components/scatter-plot/tooltips/protein-tooltip.styles.ts reads colours and font sizes from tokens'`: 12 literal `font-size` declarations (`0.875rem`, `0.75rem`, `1rem` ×4, `0.75rem`, `0.8125rem`, `0.625rem`, `0.75rem`, `0.875rem`, `0.8125rem`) and the two `font-size: var(--text-caption)`.
- `'../components/scatter-plot/projection-metadata/projection-metadata.styles.ts reads …'`: `font-size: 0.8125rem`, `font-size: 0.75rem` ×2, and the two `var(--card-gap)` reads (`top: calc(100% + var(--card-gap))`, `height: var(--card-gap)`).
- `'./tokens.ts reads …'`: `font-family: var(--font-family)`.

Every other case passes, including `'%s still needs its legacy exemption'` for the four left.

- [ ] **Step 3: Teach `cssViolations` a module's own properties**

In `packages/core/src/styles/style-lint.test.ts`, replace the whole `cssViolations` function and its doc comment:

```ts
/**
 * Declarations that hard-code a colour or a font size, declare a token outside theme.ts, or read a
 * variable theme.ts does not define (a legacy one resolves to nothing once tokens.ts goes).
 */
function cssViolations(cssText: string): string[] {
  const found: string[] = [];
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, property, raw] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = raw.trim();
    const declaration = `${property}: ${value}`;
    const unknownVar = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name) && !RUNTIME_VARS.has(name),
    );
```

with:

```ts
/**
 * Declarations that hard-code a colour or a font size, declare a token outside theme.ts, or read a
 * variable that neither theme.ts, RUNTIME_VARS nor the checked CSS itself declares. A module may
 * read a property it declares (--card-gap, the plot's --protspace-* sizes); a sheet it composes
 * counts as its own, since cssOf returns both.
 */
function cssViolations(cssText: string): string[] {
  const found: string[] = [];
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)];
  const own = new Set(
    declarations
      .map(([, property]) => property)
      .filter((property) => property.startsWith('--') && !property.startsWith('--ps-')),
  );
  for (const [, property, raw] of declarations) {
    const value = raw.trim();
    const declaration = `${property}: ${value}`;
    const unknownVar = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name) && !RUNTIME_VARS.has(name) && !own.has(name),
    );
```

The rest of the function (from `if (property.startsWith('--ps-') || COLOUR.test(value) || unknownVar)` to its closing `}`) stays as it is.

In the same file, replace the doc comment above `const OWNER`:

```ts
/** Each sheet a module exports by name (tokens, overlayMixins, srOnlyMixin…), mapped to that module. */
```

with:

```ts
/** Each sheet a module exports by name (tokens, overlayMixins, segmentedControlMixin…), mapped to that module. */
```

(Step 10's `srOnlyMixin` grep must print nothing; Task 8.4 deletes `OWNER` with this comment.)

- [ ] **Step 4: Run the lint again**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`

Expected: FAIL only for the tooltip (its 12 literal font sizes and two `--text-caption` reads) and projection-metadata (the three literal font sizes; the `--card-gap` reads now pass). The new case, `./tokens.ts` and every other module pass; the first test's existing blocks still pass (`gap: var(--spacing-sm)` is not declared in that CSS, so it is still flagged).

- [ ] **Step 5: Write the failing tooltip size tests**

In `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts`, add this after the closing `});` of `describe('protspace-protein-tooltip links', …)` (the end of the file):

```ts

/** A hover tooltip with an evidence-coded annotation and an EAT-transferred one. */
const TYPED_VIEW: TooltipView = {
  proteinId: 'P12345',
  geneName: ['KIN1'],
  proteinName: ['Serine kinase'],
  uniprotKbId: ['KIN1_HUMAN'],
  blocks: [
    {
      key: 'family',
      label: 'Protein family',
      displayValues: ['Kinase'],
      numericValue: null,
      numericType: 'float',
      scores: [],
      evidence: ['IC'],
      predicted: null,
    },
    {
      key: 'ec',
      label: 'EC number',
      displayValues: ['2.7.11.1'],
      numericValue: null,
      numericType: 'float',
      scores: [],
      evidence: [],
      predicted: { value: '2.7.11.1', confidence: 0.8, source: 'Q99999' },
    },
  ],
};

describe('protspace-protein-tooltip type sizes', () => {
  async function mountTyped(): Promise<ShadowRoot> {
    const tooltip = document.createElement('protspace-protein-tooltip');
    tooltip.view = TYPED_VIEW;
    tooltip.className = 'visible';
    document.body.append(tooltip);
    await tooltip.updateComplete;
    return tooltip.shadowRoot!;
  }

  const fontSize = (root: ShadowRoot, selector: string) =>
    getComputedStyle(root.querySelector(selector)!).fontSize;

  it('the annotation header and the evidence caption are 11 px', async () => {
    // Mounted on its own, outside a plot: the sizes cannot come from the plot's :host.
    const root = await mountTyped();
    expect(fontSize(root, '.tooltip-annotation-header')).toBe('11px');
    expect(fontSize(root, '.tooltip-annotation-evidence')).toBe('11px');
    expect(fontSize(root, '.eat-provenance-heading')).toBe('11px');
    expect(fontSize(root, '.eat-provenance-source')).toBe('11px');
    // tooltip-height-estimate.ts budgets 16 px for the header row, its 2 px margin included.
    const header = root.querySelector('.tooltip-annotation-header')!.getBoundingClientRect();
    expect(header.height + 2).toBeLessThanOrEqual(16);
  });

  it('the protein name is 13 px and the annotation rows 12 px', async () => {
    const root = await mountTyped();
    expect(fontSize(root, '.tooltip')).toBe('14px');
    expect(fontSize(root, '.tooltip-header')).toBe('12px');
    expect(fontSize(root, '.tooltip-protein-id')).toBe('16px');
    expect(fontSize(root, '.tooltip-gene-name')).toBe('12px');
    expect(fontSize(root, '.tooltip-protein-name')).toBe('13px');
    expect(fontSize(root, '.tooltip-annotation')).toBe('12px');
  });
});
```

(`TooltipView` and `adoptTheme` are already imported at the top of the file; the file's `beforeAll(() => adoptTheme())` and `afterEach` cover the new block.)

- [ ] **Step 6: Write the projection details size tests**

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts`, replace the first two import lines:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type { Projection } from '@protspace/utils';
import { topLayer } from '../../kit/layers';
```

with:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type { Projection, ProjectionStatisticRow } from '@protspace/utils';
import { adoptTheme } from '../../kit/adopt-theme';
import { topLayer } from '../../kit/layers';
```

Then add at the end of the file, after the closing `});` of `describe('protspace-projection-metadata on a phone', …)`:

```ts

type ScoredCard = ProjectionMetadataElement & {
  statisticsRows?: readonly ProjectionStatisticRow[];
  selectedAnnotation: string;
};

describe('protspace-projection-metadata type', () => {
  beforeAll(() => adoptTheme());

  /** A card with parameters and a scored annotation, so every row type renders. */
  async function mountScored(): Promise<ShadowRoot> {
    const el = document.createElement('protspace-projection-metadata') as ScoredCard;
    el.projection = { name: 'ProtT5 — UMAP 2', metadata: { n_components: 2 } } as Projection;
    el.statisticsRows = [
      {
        space_kind: 'projection',
        space_name: 'ProtT5 — UMAP 2',
        annotation: 'major_group',
        stat_family: 'annotation_validity',
        label_kind: 'annotation',
        metric: 'silhouette',
        metric_kind: 'validity',
        value: 0.326,
      } as ProjectionStatisticRow,
    ];
    el.selectedAnnotation = 'major_group';
    document.body.append(el);
    await el.updateComplete;
    return el.shadowRoot!;
  }

  it("the card's header is 13 px and its rows 12 px", async () => {
    const root = await mountScored();
    const fontSize = (selector: string) =>
      getComputedStyle(root.querySelector(selector)!).fontSize;
    expect(fontSize('.header')).toBe('13px');
    expect(fontSize('.item')).toBe('12px');
    expect(fontSize('.annotation-stats')).toBe('12px');
  });

  it('the screen-reader text stays visually hidden', async () => {
    const root = await mountScored();
    const hidden = root.querySelector<HTMLElement>('.annotation-stats .sr-only')!;
    expect(hidden.textContent).toContain('is better');
    const box = hidden.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    const style = getComputedStyle(hidden);
    expect(style.position).toBe('absolute');
    expect(style.overflow).toBe('hidden');
    expect(style.clip).toBe('rect(0px, 0px, 0px, 0px)');
  });
});
```

(The `beforeAll` sits in the new block, after the existing describes, so the tests above run as before.)

- [ ] **Step 7: Run the browser tests to see the tooltip fail**

Run (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts \
  src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts
```

Expected: one FAIL, "the annotation header and the evidence caption are 11 px": the header is `10px` (`0.625rem`); had it passed, the evidence caption would read `12px` and the EAT lines `14px`, because `var(--text-caption)` is not defined outside the plot's `:host` and the size falls back to the parent's. Every other test passes, including the four new pins (the projection details already measure 13/12/12 px and `srOnlyMixin` already hides the text): they guard the sizes through the move.

- [ ] **Step 8: Move the tooltip onto the type tokens**

In `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts`, make these replacements (each anchor is unique in the file):

1. In `.tooltip`: `    box-shadow: var(--ps-shadow-md);\n    font-size: 0.875rem;` → `    box-shadow: var(--ps-shadow-md);\n    font-size: var(--ps-text-md);`
2. In `.tooltip-header`:
   ```css
       padding: 0.625rem 0.75rem;
       font-size: 0.75rem;
       font-weight: 600;
   ```
   →
   ```css
       padding: 0.625rem 0.75rem;
       font-size: var(--ps-text-sm);
       font-weight: var(--ps-weight-semibold);
   ```
3. `  .tooltip-protein-id {\n    font-size: 1rem;` → `  .tooltip-protein-id {\n    font-size: var(--ps-text-lg);`
4. `  .tooltip-protein-id-main {\n    font-size: 1rem;` → `  .tooltip-protein-id-main {\n    font-size: var(--ps-text-lg);`
5. `  .tooltip-uniprot-separator {\n    font-size: 1rem;` → `  .tooltip-uniprot-separator {\n    font-size: var(--ps-text-lg);`
6. `  .tooltip-uniprot-id {\n    font-size: 1rem;` → `  .tooltip-uniprot-id {\n    font-size: var(--ps-text-lg);`
7. In `.tooltip-gene-name`: `    font-size: 0.75rem;\n    margin-bottom: 0.25rem;` → `    font-size: var(--ps-text-sm);\n    margin-bottom: 0.25rem;`
8. In `.tooltip-protein-name`: `    font-size: 0.8125rem;\n    line-height: 1.4;` → `    font-size: var(--ps-text-base);\n    line-height: 1.4;`
9. In `.tooltip-annotation-header`:
   ```css
     .tooltip-annotation-header {
       font-size: 0.625rem;
       font-weight: 600;
   ```
   →
   ```css
     .tooltip-annotation-header {
       font-size: var(--ps-text-xs);
       font-weight: var(--ps-weight-semibold);
   ```
10. `  .tooltip-annotation {\n    font-size: 0.75rem;` → `  .tooltip-annotation {\n    font-size: var(--ps-text-sm);`
11. In `.tooltip-annotation-evidence`: `    font-size: var(--text-caption);\n    font-variant-numeric: tabular-nums;` → `    font-size: var(--ps-text-xs);\n    font-variant-numeric: tabular-nums;`
12. In `.eat-provenance-heading, .eat-provenance-source`: `    gap: 0.5rem;\n    font-size: var(--text-caption);` → `    gap: 0.5rem;\n    font-size: var(--ps-text-xs);`
13. In the compact `:is(…)` rule: `    ) {\n    font-size: 0.875rem;` → `    ) {\n    font-size: var(--ps-text-md);`
14. In `.tooltip-primary`: `    color: var(--ps-text);\n    font-size: 0.8125rem;` → `    color: var(--ps-text);\n    font-size: var(--ps-text-base);`

Check: `grep -n "font-size" packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts` prints 14 lines, every one `var(--ps-text-xs|sm|base|md|lg)`; `grep -n "rem;" …` still prints the padding/margin/radius lines only.

- [ ] **Step 9: Move the projection details onto the type tokens and the kit's srOnly**

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, replace the head of the file:

```ts
import { css } from 'lit';
import { srOnlyMixin } from '../../../styles/mixins';

export const projectionMetadataStyles = [
  srOnlyMixin,
  css`
```

with:

```ts
import { css } from 'lit';
import { srOnly } from '../../kit/kit-shared.styles';

export const projectionMetadataStyles = [
  srOnly,
  css`
```

Then, in the same file:

1. In `.header`:
   ```css
         padding: 0.625rem 0.75rem;
         font-size: 0.8125rem;
         font-weight: 600;
   ```
   →
   ```css
         padding: 0.625rem 0.75rem;
         font-size: var(--ps-text-base);
         font-weight: var(--ps-weight-semibold);
   ```
2. In `.item`: `      margin-bottom: 0.5rem;\n      font-size: 0.75rem;` → `      margin-bottom: 0.5rem;\n      font-size: var(--ps-text-sm);`
3. In `.annotation-stats`: `      padding: 0.625rem 0.75rem;\n      font-size: 0.75rem;` → `      padding: 0.625rem 0.75rem;\n      font-size: var(--ps-text-sm);`

- [ ] **Step 10: Delete srOnlyMixin**

In `packages/core/src/styles/mixins.ts`, delete from the blank line after the closing `` `; `` of `segmentedControlMixin` to the end of the file, i.e. this block:

```ts

/**
 * Screen-reader-only text
 * Visually hidden but still announced by assistive technology
 */
export const srOnlyMixin = css`
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

so the file ends with `segmentedControlMixin`'s closing `` `; `` and a newline. Then `grep -rn "srOnlyMixin" packages apps docs` prints nothing.

- [ ] **Step 11: Update the height estimate's comment**

In `packages/core/src/components/scatter-plot/tooltips/tooltip-height-estimate.ts`, in the doc comment above `HEADER_HEIGHT`, replace:

```ts
 * Header section (.tooltip-header)
 *   padding: 0.625rem top + 0.625rem bottom = 10 + 10 = 20 px
 *   font-size: 0.75rem → 12 px, line-height default 1.2 → ~15 px
```

with:

```ts
 * Header section (.tooltip-header)
 *   padding: 0.625rem top + 0.625rem bottom = 10 + 10 = 20 px
 *   font-size: --ps-text-sm → 12 px, line-height default 1.2 → ~15 px
```

replace:

```ts
 * Protein-name row (.tooltip-protein-name)
 *   font-size: 0.8125rem (13 px), line-height 1.4 → ~18 px
```

with:

```ts
 * Protein-name row (.tooltip-protein-name)
 *   font-size: --ps-text-base (13 px), line-height 1.4 → ~18 px
```

replace:

```ts
 * Gene-name row (.tooltip-gene-name)
 *   font-size: 0.75rem (12 px), line-height default → ~15 px
```

with:

```ts
 * Gene-name row (.tooltip-gene-name)
 *   font-size: --ps-text-sm (12 px), line-height default → ~15 px
```

and replace:

```ts
 *   block header row (.tooltip-annotation-header):
 *     font-size: 0.625rem (10 px), margin-bottom 0.125rem (2 px) → ~16 px
 *   "Value:" row (.tooltip-annotation with raw class):
 *     font-size: 0.75rem (12 px) → ~16 px (reuses the annotation row height)
 *   each displayValues row (.tooltip-annotation):
 *     font-size: 0.75rem (12 px), gap between rows 0.25rem (4 px) → ~16 px per row
```

with:

```ts
 *   block header row (.tooltip-annotation-header):
 *     font-size: --ps-text-xs (11 px), margin-bottom 0.125rem (2 px) → ~16 px
 *   "Value:" row (.tooltip-annotation with raw class):
 *     font-size: --ps-text-sm (12 px) → ~16 px (reuses the annotation row height)
 *   each displayValues row (.tooltip-annotation):
 *     font-size: --ps-text-sm (12 px), gap between rows 0.25rem (4 px) → ~16 px per row
```

The constants stay: Step 5's test pins the 11 px header row inside its 16 px budget.

- [ ] **Step 12: Run the touched tests**

Run:

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/style-lint.test.ts src/styles/styles-integrity.test.ts \
  src/components/scatter-plot/tooltips/tooltip-height-estimate.test.ts
```

Expected: PASS. In `style-lint.test.ts` the `'… reads colours and font sizes from tokens'` cases include the tooltip, projection-metadata and `./tokens.ts` paths (three more than at the baseline); `'%s hard-codes no colour'` and `'%s still needs its legacy exemption'` run 4 cases each (were 7).

Then (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts \
  src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts
```

Expected: PASS, `protein-tooltip.browser.test.ts` 6 tests (4 + 2), `projection-metadata.browser.test.ts` 7 tests (5 + 2).

If the header-row height check fails (the row is taller than 14 px), report the measured height and raise `BLOCK_HEADER_ROW` to the measured row plus its 2 px margin, rounded up; do not change any other constant. Then re-run `src/components/scatter-plot/tooltips/tooltip-height-estimate.test.ts` and update only the expected heights that the new constant moves, naming each in the report and adding that test file to Step 13's `prettier --check` and `git add`.

- [ ] **Step 13: Format check and commit**

```bash
pnpm exec prettier --check packages/core/src/styles/style-lint.test.ts packages/core/src/styles/mixins.ts \
  packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts \
  packages/core/src/components/scatter-plot/tooltips/tooltip-height-estimate.ts \
  packages/core/src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts
```

Fix any file it lists with `pnpm exec prettier --write <that file>` (only that file). Then (sandbox disabled, the hook runs `pnpm precommit`):

```bash
git add packages/core/src/styles/style-lint.test.ts packages/core/src/styles/mixins.ts \
  packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts \
  packages/core/src/components/scatter-plot/tooltips/tooltip-height-estimate.ts \
  packages/core/src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts
git commit -m "refactor(core): tooltip and projection details read type tokens"
```

Report: the test counts of the five files before and after, `LEGACY` = 4, and the measured annotation-header row height.

### Task 8.2: The scatter plot's sheet reads tokens only

`scatter-plot.styles.ts` stops composing `tokens` and `overlayMixins`: it sets its own `font-family`, writes `z-index` as numbers, reads the type tokens, and loses the 11 custom properties nothing reads and the dead `.loading-spinner` override (the plot renders no loading overlay). It leaves `LEGACY`. `tokens` and `overlayMixins` keep one importer, the structure viewer, until Task 8.4.

**Files:**

- Modify: `packages/core/src/components/scatter-plot/scatter-plot.styles.ts`
- Modify: `packages/core/src/styles/style-lint.test.ts` (`LEGACY` loses `scatter-plot.styles.ts`)
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts`

**Interfaces:**

- Consumes: `scatterplotStyles` (exported array, consumed by `scatter-plot.ts` `static styles` and by `overlayProbe()` in `scatter-plot.theme.browser.test.ts`); the type and z-index mappings (Global Constraints); `styleOf(root, selector)`, `overlayProbe(): ShadowRoot` (a `div.overlay-probe` whose open shadow root adopts `scatterplotStyles` and holds an `svg`, `.plot-indicator` and `.connector-status`) and the `describe('plot overlays, chips and tooltip follow the theme')` block in `scatter-plot.theme.browser.test.ts`; Task 8.1's `LEGACY` (4 entries) and own-property rule in `style-lint.test.ts`.
- Produces:
  - `export const scatterplotStyles = [scatterplotStylesCore]` (still an array; `scatter-plot.ts` unchanged).
  - `:host` declares only `--protspace-width: 100%`, `--protspace-height: 600px`, `--protspace-border-radius: 6px`, `--protspace-brush-stroke-width: 1px`, and gains `font-family: var(--ps-font-sans)`; deleted: `--protspace-point-size`, `-point-size-highlighted`, `-point-size-selected`, `-point-opacity-base`, `-point-opacity-selected`, `-point-opacity-faded`, `-stroke-width-base`, `-stroke-width-highlighted`, `-stroke-width-selected`, `-transition-duration`, `-transition-easing`.
  - `svg { z-index: 3 }`, `canvas { z-index: 1 }`, `.plot-indicator` and `.connector-status` `z-index: 10`; their `font-size: var(--ps-text-xs)`, `font-weight: var(--ps-weight-medium)`; `.connector-status button { font-size: var(--ps-text-lg) }`.
  - The `.loading-spinner` rule and its comment deleted.
  - `LEGACY` = `{ structure-viewer.styles.ts, ./mixins.ts, ./overlay-mixins.ts }` (3).

**Tests:**

- `scatter-plot.theme.browser.test.ts`: "the plot's SVG layer stacks above its canvas" (computed `z-index` of the probe's `svg` is `3`, of a `canvas` `1`; the `.plot-indicator` chip's `10`); "the point-count chip is 11 px, weight 500, in Inter" (computed `font-size` `11px`, `font-weight` `500`, `font-family` starting with `"Inter Variable"`, for `.plot-indicator` and `.connector-status`; the chip's close button 16 px); "the plot host keeps the documented size properties" (`--protspace-height` is `600px`, `--protspace-width` `100%`, `--protspace-border-radius` `6px`, `--protspace-brush-stroke-width` `1px`, and `--protspace-point-size` is empty).
- `style-lint.test.ts` passes with `scatter-plot.styles.ts` checked by `'%s reads colours and font sizes from tokens'`.
- Run: `style-lint.test.ts`, `styles-integrity.test.ts` (unit), `scatter-plot.theme.browser.test.ts`, `scatter-plot.spider.browser.test.ts` (browser, sandbox disabled).
- Unrun at task time (exit): `brush-selection.spec.ts`, `zoom-indicator.spec.ts`, `eat-visualization.spec.ts`, `workbench-theme.spec.ts`, `perf:counts`.

LEGACY count: 3.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `--project unit` runs inside the sandbox; `--project browser` needs it disabled.

- [ ] **Step 1: Write the failing theme tests**

In `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts`, in `overlayProbe()`, add a canvas to the probe's markup. Replace:

```ts
  root.innerHTML = `
    <svg width="200" height="200">
```

with:

```ts
  root.innerHTML = `
    <canvas width="20" height="20"></canvas>
    <svg width="200" height="200">
```

(A canvas is not focusable, so "the connector chip button shows the focus ring in dark", which tabs to the probe's only focusable control, is unaffected.)

Then, inside `describe('plot overlays, chips and tooltip follow the theme', () => { … })`, directly after the closing `});` of `it('the spiderfy node rim is the dark plot background', …)`, add:

```ts
  it("the plot's SVG layer stacks above its canvas", () => {
    const root = overlayProbe();
    // Brush, lasso and spider marks live in the SVG and must sit over the WebGL canvas.
    expect(styleOf(root, 'svg').zIndex).toBe('3');
    expect(styleOf(root, 'canvas').zIndex).toBe('1');
    expect(styleOf(root, '.plot-indicator').zIndex).toBe('10');
    expect(styleOf(root, '.connector-status').zIndex).toBe('10');
  });

  it('the point-count chip is 11 px, weight 500, in Inter', () => {
    const root = overlayProbe();
    for (const selector of ['.plot-indicator', '.connector-status']) {
      const chip = styleOf(root, selector);
      expect(chip.fontSize, selector).toBe('11px');
      expect(chip.fontWeight, selector).toBe('500');
      expect(chip.fontFamily, selector).toMatch(/^"Inter Variable"/);
    }
    expect(styleOf(root, '.connector-status button').fontSize).toBe('16px');
  });

  it('the plot host keeps the documented size properties', () => {
    const host = overlayProbe().host;
    const prop = (name: string) => getComputedStyle(host).getPropertyValue(name).trim();
    expect(prop('--protspace-height')).toBe('600px');
    expect(prop('--protspace-width')).toBe('100%');
    expect(prop('--protspace-border-radius')).toBe('6px');
    expect(prop('--protspace-brush-stroke-width')).toBe('1px');
    // Declared for years, read by nothing: gone.
    expect(prop('--protspace-point-size')).toBe('');
    expect(prop('--protspace-transition-duration')).toBe('');
  });
```

(`afterEach` in that describe already removes `.overlay-probe` hosts.)

- [ ] **Step 2: Shrink LEGACY**

In `packages/core/src/styles/style-lint.test.ts`, delete this line from the `LEGACY` set:

```ts
  '../components/scatter-plot/scatter-plot.styles.ts',
```

so `LEGACY` holds `structure-viewer.styles.ts`, `./mixins.ts` and `./overlay-mixins.ts`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`

Expected: FAIL, one case: `'../components/scatter-plot/scatter-plot.styles.ts reads colours and font sizes from tokens'` gets `['font-size: var(--text-sm)', 'font-size: var(--text-caption)', 'font-size: var(--text-caption)', 'font-size: 1rem']`: the first from the composed `overlayMixins`' `.tooltip`, the others from the plot's chips and the chip button. The `--z-*`, `--radius`, `--spacing-sm` and `--border-width` reads are not listed, because the composed `tokens` declares them and Task 8.1's own-property rule accepts that; a font size must still read a `--ps-text-*` token.

Then (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/scatter-plot.theme.browser.test.ts
```

Expected: FAIL, two of the three new cases: "the point-count chip is 11 px, weight 500, in Inter" (`fontFamily` is `system-ui, -apple-system, sans-serif`, from `tokens`' `:host`) and "the plot host keeps the documented size properties" (`--protspace-point-size` is `80px`). "the plot's SVG layer stacks above its canvas" passes already (`tokens` still defines `--z-svg` 3, `--z-canvas` 1, `--z-overlay` 10): it guards the stacking through the change. Every existing case passes.

- [ ] **Step 4: Rewrite the plot's sheet on tokens**

In `packages/core/src/components/scatter-plot/scatter-plot.styles.ts`:

1. Replace the imports and the head of `:host`:

```ts
import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';

const scatterplotStylesCore = css`
  :host {
    /* Sizes, opacities and timings only: every colour comes from a --ps-* token (theme.ts), so an
       embedder restyles the plot in both themes by setting those on :root. */

    /* Layout */
    --protspace-width: 100%;
    --protspace-height: 600px;
    --protspace-border-radius: 6px;

    /* Points */
    --protspace-point-size: 80px;
    --protspace-point-size-highlighted: 120px;
    --protspace-point-size-selected: 150px;
    --protspace-point-opacity-base: 0.8;
    --protspace-point-opacity-selected: 1;
    --protspace-point-opacity-faded: 0.2;

    /* Selection */
    --protspace-stroke-width-base: 1px;
    --protspace-stroke-width-highlighted: 2px;
    --protspace-stroke-width-selected: 3px;

    /* Transitions */
    --protspace-transition-duration: 0.2s;
    --protspace-transition-easing: ease-in-out;

    /* Brush */
    --protspace-brush-stroke-width: 1px;

    display: block;
```

with:

```ts
import { css } from 'lit';

const scatterplotStylesCore = css`
  :host {
    /* Sizes only: every colour comes from a --ps-* token (theme.ts), so an embedder restyles the
       plot in both themes by setting those on :root. --protspace-width and --protspace-height
       are the documented embedder API (docs/developers/embedding.md). */

    /* Layout */
    --protspace-width: 100%;
    --protspace-height: 600px;
    --protspace-border-radius: 6px;

    /* Brush */
    --protspace-brush-stroke-width: 1px;

    display: block;
    font-family: var(--ps-font-sans);
```

2. In `svg { … }`: `    z-index: var(--z-svg);` → `    z-index: 3;`
3. In `canvas { … }`: `    z-index: var(--z-canvas);` → `    z-index: 1;`
4. Delete the dead spinner override, this whole block with the blank line after it:

```css
  /* Base loading overlay styles provided by overlayMixins */
  .loading-spinner {
    /* Override size from base mixin */
    width: 3rem;
    height: 3rem;
  }

```

5. In `.plot-indicator { … }`:
   - `    left: 0.5rem;\n    z-index: var(--z-overlay);` → `    left: 0.5rem;\n    z-index: 10;`
   - ```css
         color: var(--ps-text-muted);
         font-size: var(--text-caption);
         font-weight: var(--font-medium);
         letter-spacing: 0.01em;
     ```
     →
     ```css
         color: var(--ps-text-muted);
         font-size: var(--ps-text-xs);
         font-weight: var(--ps-weight-medium);
         letter-spacing: 0.01em;
     ```
6. In `.connector-status { … }`:
   - `    left: 50%;\n    z-index: var(--z-overlay);` → `    left: 50%;\n    z-index: 10;`
   - ```css
         color: var(--ps-text);
         font-size: var(--text-caption);
         font-weight: var(--font-medium);
         border-radius: 0.375rem;
     ```
     →
     ```css
         color: var(--ps-text);
         font-size: var(--ps-text-xs);
         font-weight: var(--ps-weight-medium);
         border-radius: 0.375rem;
     ```
7. In `.connector-status button { … }`: `    font: inherit;\n    font-size: 1rem;` → `    font: inherit;\n    font-size: var(--ps-text-lg);`
8. Replace the export:

```ts
export const scatterplotStyles = [tokens, overlayMixins, scatterplotStylesCore];
```

with:

```ts
export const scatterplotStyles = [scatterplotStylesCore];
```

Check: `grep -nE -- "--z-|--text-|--font-|tokens|overlay" packages/core/src/components/scatter-plot/scatter-plot.styles.ts` prints only four lines: the two selectors `:host([data-morphing]) .overlay-container` and `.brush-container rect.overlay {`, and the two comments that say "(SVG overlay)" (`Duplicate stack spiderfy UI` and `EAT provenance connectors`); no `--z-`, `--text-`, `--font-` or `tokens`. `tokens` and `overlayMixins` are still imported by `structure-viewer.styles.ts`, so knip stays green.

- [ ] **Step 5: Run the touched tests**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/style-lint.test.ts src/styles/styles-integrity.test.ts
```

Expected: PASS; `scatter-plot.styles.ts` is now among the `'… reads colours and font sizes from tokens'` cases, and the two LEGACY `it.each` blocks run 3 cases each.

Then (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/scatter-plot.theme.browser.test.ts \
  src/components/scatter-plot/scatter-plot.spider.browser.test.ts
```

Expected: PASS, `scatter-plot.theme.browser.test.ts` three more tests than at the baseline; `scatter-plot.spider.browser.test.ts` unchanged (the spider nodes are SVG and still stack above the canvas).

- [ ] **Step 6: Format check and commit**

```bash
pnpm exec prettier --check packages/core/src/components/scatter-plot/scatter-plot.styles.ts \
  packages/core/src/styles/style-lint.test.ts \
  packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts
```

Then (sandbox disabled):

```bash
git add packages/core/src/components/scatter-plot/scatter-plot.styles.ts \
  packages/core/src/styles/style-lint.test.ts \
  packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts
git commit -m "refactor(core): scatter plot styles read tokens only"
```

Report: the test counts of the four files before and after, `LEGACY` = 3, and `wc -l packages/core/src/components/scatter-plot/scatter-plot.styles.ts`.

### Task 8.3: ps-segmented gains disabled options with a reason

The kit's segmented control learns what the structure viewer's TED button needs: an option can be disabled and can carry a tooltip that says why. A disabled option is `aria-disabled`, not native `disabled`, so hover and focus still reach its tooltip; arrow keys skip it and a click on it changes nothing. The kit gallery shows one, which is the change's consumer.

**Files:**

- Modify: `packages/core/src/components/kit/segmented.ts`
- Modify: `packages/core/src/components/kit/choice.styles.ts` (`segmentedStyles`: the disabled look)
- Modify: `packages/core/src/components/kit/fields.browser.test.ts` (`describe('ps-segmented')`; `describe('choice controls under a coarse pointer')`)
- Modify: `apps/web/src/dev/KitGallery.tsx` (`STRUCTURE_COLOURS`: the TED option disabled with a tooltip)
- Not modified: `apps/web/tests/kit-gallery.spec.ts` (it checks that every kit tag is defined and that the page logs no error; it enumerates no option states). It runs unchanged as this task's e2e spec.

**Interfaces:**

- Consumes: `PsSegmented` (`options: SegmentedOption[]`, `value`, `label`; renders `[role="radiogroup"]` with `button[role="radio"][data-value][aria-checked]`, roving `tabindex`; dispatches `change` with `detail: { value }`, `bubbles: true`); `'./tooltip'` (`ps-tooltip`: `text`; anchored to its previous element sibling by default; adds itself to that element's `ariaDescribedByElements`; shows its `.tip` popover 500 ms after `pointerenter`, or on `:focus-visible` focus); `segmentedStyles` (`kitHost`, `focusRing`, the group and button rules); the `mount<T>(markup)` helper and the `coarse(body)` helper in `fields.browser.test.ts`; `userEvent`, `cdp` (`vitest/browser`).
- Produces:
  - `export interface SegmentedOption { value: string; label: string; disabled?: boolean; tooltip?: string }` (exported as today from `kit/index.ts`).
  - An option with `disabled: true` renders `aria-disabled="true"` and no native `disabled`; clicking it, or Space/Enter on it, dispatches nothing and leaves `value`.
  - An option with `tooltip` renders `<ps-tooltip text=${tooltip}>` directly after its button inside the group, so it describes that button.
  - Roving tab stop: the checked option even when it is disabled (its reason stays reachable); with no checked option, the first enabled option; with none enabled, the first option.
  - Arrow keys move to the next or previous enabled option, wrapping, skipping disabled ones; with no other enabled option, an arrow does nothing (no event; `preventDefault` still called).
  - Style: `button[aria-disabled='true']` takes `color: var(--ps-text-faint)` and `cursor: not-allowed`; the checked chip keeps its ring when disabled; every option is one line (`white-space: nowrap` on `button`, so a squeeze shows as measurable overflow, not text spilling out of a fixed-height chip; Task 8.4 pins the viewer's row at 240 px); the coarse-pointer sizes are unchanged (34 px options in a 40 px group).

**Tests:**

- `fields.browser.test.ts` (`ps-segmented`): "a disabled option is aria-disabled and stays focusable for its reason"; "clicking a disabled option changes nothing and dispatches no change" (a click and Space/Enter); "arrow keys skip a disabled option" (options a, b disabled, c: ArrowRight from a lands on c and dispatches `c`; ArrowLeft from c lands on a); "with only the checked option enabled, an arrow changes nothing"; "an option's tooltip describes its button" (hover the disabled option: its `ps-tooltip` shows; the button's `ariaDescribedByElements` holds it); "a checked option that is disabled is the tab stop" (and the first enabled one with no value, the first with none enabled).
- `fields.browser.test.ts` (coarse pointer): the existing 34/40 px case passes with a disabled option that has a tooltip.
- Run: `fields.browser.test.ts` (browser, sandbox disabled); e2e `kit-gallery.spec.ts` (`--project kit-gallery`).
- Unrun at task time (exit): `mobile-bars.spec.ts` (MoreSheet's `ps-segmented` rows).

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Browser tests and `git commit` need the sandbox disabled.

- [ ] **Step 1: Write the failing kit tests**

In `packages/core/src/components/kit/fields.browser.test.ts`, inside `describe('ps-segmented', () => { … })`, directly after the closing `});` of `it('keeps one option reachable by Tab when no value is set', …)`, add:

```ts
  /** Options a, b and c with b disabled and explained; a is checked. */
  async function withDisabled(): Promise<{ el: PsSegmented; radios: HTMLElement[] }> {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true, tooltip: 'Available once B has loaded' },
      { value: 'c', label: 'C' },
    ];
    el.value = 'a';
    await el.updateComplete;
    const radios = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="radio"]')];
    return { el, radios };
  }

  it('a disabled option is aria-disabled and stays focusable for its reason', async () => {
    const { el, radios } = await withDisabled();
    expect(radios.map((r) => r.getAttribute('aria-disabled'))).toEqual([null, 'true', null]);
    // Not native disabled: that would drop hover and focus, and with them the tooltip.
    expect(radios[1].hasAttribute('disabled')).toBe(false);
    radios[1].focus();
    expect(el.shadowRoot!.activeElement).toBe(radios[1]);
    const style = getComputedStyle(radios[1]);
    // #94a3b8, the light --ps-text-faint (disabled text).
    expect(style.color).toBe('rgb(148, 163, 184)');
    expect(style.cursor).toBe('not-allowed');
  });

  it('clicking a disabled option changes nothing and dispatches no change', async () => {
    const { el, radios } = await withDisabled();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    // A DOM click: Playwright's own click waits for an aria-disabled element to become enabled.
    radios[1].click();
    radios[1].focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await el.updateComplete;
    expect(el.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('arrow keys skip a disabled option', async () => {
    const { el, radios } = await withDisabled();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    radios[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(el.value).toBe('c');
    expect(onChange.mock.calls.map(([event]) => event.detail)).toEqual([{ value: 'c' }]);
    expect(el.shadowRoot!.activeElement).toBe(radios[2]);
    await userEvent.keyboard('{ArrowLeft}');
    await el.updateComplete;
    expect(el.value).toBe('a');
    expect(el.shadowRoot!.activeElement).toBe(radios[0]);
  });

  it('with only the checked option enabled, an arrow changes nothing', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
      { value: 'c', label: 'C', disabled: true },
    ];
    el.value = 'a';
    await el.updateComplete;
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    const first = el.shadowRoot!.querySelector<HTMLElement>('[role="radio"]')!;
    first.focus();
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    first.dispatchEvent(key);
    await el.updateComplete;
    // The key is still the group's: the page does not scroll.
    expect(key.defaultPrevented).toBe(true);
    expect(el.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(el.shadowRoot!.activeElement).toBe(first);
  });

  it("an option's tooltip describes its button", async () => {
    const { radios } = await withDisabled();
    const tooltip = radios[1].nextElementSibling as HTMLElement & { text: string };
    expect(tooltip.localName).toBe('ps-tooltip');
    expect(tooltip.text).toBe('Available once B has loaded');
    // The tooltip binds to its anchor a microtask after it connects.
    await expect.poll(() => radios[1].ariaDescribedByElements?.includes(tooltip)).toBe(true);
    await userEvent.hover(radios[1]);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
    // Options without a reason get no tooltip.
    expect(radios[0].nextElementSibling).toBe(radios[1]);
  });

  it('a checked option that is disabled is the tab stop', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    const stops = () =>
      [...el.shadowRoot!.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('tabindex'));
    el.options = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
    ];
    el.value = 'a';
    await el.updateComplete;
    expect(stops()).toEqual(['0', '-1']);
    // No value: the first enabled option.
    el.value = '';
    await el.updateComplete;
    expect(stops()).toEqual(['-1', '0']);
    // Nothing enabled: the first option, so the group stays reachable.
    el.options = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B', disabled: true },
    ];
    await el.updateComplete;
    expect(stops()).toEqual(['0', '-1']);
  });
```

Then, in `describe('choice controls under a coarse pointer')`, in `it('segmented options are 34 px tall inside a 40 px group and at least 34 px wide', …)`, replace:

```ts
      el.options = [
        { value: 'off', label: 'Off' },
        { value: 'auto', label: 'Auto' },
        { value: 'on', label: 'Always' },
      ];
```

with:

```ts
      el.options = [
        { value: 'off', label: 'Off' },
        { value: 'auto', label: 'Auto' },
        // A disabled option with a reason keeps the same box; its tooltip adds none.
        { value: 'on', label: 'Always', disabled: true, tooltip: 'Needs a density layer' },
      ];
```

- [ ] **Step 2: Run the kit tests to see them fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts`

Expected (Vitest strips types, so the new option fields do not stop the run): FAIL in five of the six new cases:
- "a disabled option is aria-disabled…": `aria-disabled` is `[null, null, null]`.
- "clicking a disabled option…": `el.value` is `'b'` and `change` fired once.
- "arrow keys skip a disabled option": the arrow lands on `b`.
- "with only the checked option enabled…": the arrow moves to `b` and dispatches it.
- "an option's tooltip describes its button": `nextElementSibling` of `b` is the `c` button, not a `ps-tooltip`.

"a checked option that is disabled is the tab stop" fails on its second expectation (with no value the stop is still the first option, `a`, which is disabled). The existing cases, the coarse-pointer case included, pass.

- [ ] **Step 3: Implement disabled options and their tooltip**

Replace the whole of `packages/core/src/components/kit/segmented.ts` with:

```ts
import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { segmentedStyles } from './choice.styles';
import './tooltip';

export interface SegmentedOption {
  value: string;
  label: string;
  /**
   * Shown but not choosable. The option is aria-disabled, not native disabled, so hover and focus
   * still reach its tooltip; a click or an arrow key never selects it.
   */
  disabled?: boolean;
  /** A ps-tooltip for the option, typically why it is disabled. */
  tooltip?: string;
}

/** A small set of mutually exclusive choices: a radio group with arrow-key movement. */
@customElement('ps-segmented')
export class PsSegmented extends LitElement {
  static styles = segmentedStyles;

  @property({ attribute: false }) options: SegmentedOption[] = [];
  @property() value = '';
  @property() label = '';

  render() {
    const selected = this.options.findIndex((option) => option.value === this.value);
    // The checked option is the tab stop even when disabled, so its reason stays reachable;
    // otherwise the first enabled one, or the first one when none is.
    const stop =
      selected >= 0 ? selected : Math.max(0, this.options.findIndex((option) => !option.disabled));
    return html`<div
      part="group"
      role="radiogroup"
      aria-label=${this.label || nothing}
      @keydown=${this.onKeydown}
    >
      ${this.options.map(
        (option, index) =>
          html`<button
              type="button"
              role="radio"
              aria-checked=${String(index === selected)}
              aria-disabled=${option.disabled ? 'true' : nothing}
              tabindex=${index === stop ? 0 : -1}
              data-value=${option.value}
              @click=${() => {
                if (!option.disabled) this.select(option.value);
              }}
            >
              ${option.label}
            </button>
            ${option.tooltip ? html`<ps-tooltip text=${option.tooltip}></ps-tooltip>` : nothing}`,
      )}
    </div>`;
  }

  private select(value: string, focus = false): void {
    if (value !== this.value) {
      this.value = value;
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value } }));
    }
    if (focus) {
      void this.updateComplete.then(() =>
        this.renderRoot.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)?.focus(),
      );
    }
  }

  private onKeydown = (event: KeyboardEvent) => {
    const step = ['ArrowRight', 'ArrowDown'].includes(event.key)
      ? 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key)
        ? -1
        : 0;
    const count = this.options.length;
    if (step === 0 || count === 0) return;
    event.preventDefault();
    const current = this.options.findIndex((option) => option.value === this.value);
    // From the checked option (or from just outside either end), the next enabled one, wrapping.
    const start = current < 0 ? (step > 0 ? -1 : count) : current;
    for (let offset = 1; offset <= count; offset++) {
      const index = (((start + step * offset) % count) + count) % count;
      if (index === current) return;
      if (!this.options[index].disabled) {
        this.select(this.options[index].value, true);
        return;
      }
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ps-segmented': PsSegmented;
  }
}
```

(If Prettier reflows the template, keep Prettier's version: only the element order matters, the tooltip being the button's next element sibling. The `ps-tooltip` host is `display: contents` and its panel is a fixed popover, so it adds no flex item and no gap.)

- [ ] **Step 4: Style the disabled option; options stay on one line**

In `packages/core/src/components/kit/choice.styles.ts`, in `segmentedStyles`, in the `button { … }` rule, after `      font: inherit;` add:

```css
      white-space: nowrap;
```

(A chip has a fixed height, so a label that wrapped would spill out of it; on one line a squeeze shows as horizontal overflow that a test can measure. The MoreSheet's `ps-segmented` rows have short labels and are unaffected; `mobile-bars.spec.ts` at the exit checks them.)

Then, directly after the rule

```css
    button[aria-checked='true'] {
      background: var(--ps-surface);
      color: var(--ps-text);
      box-shadow:
        inset 0 0 0 1px var(--ps-accent),
        var(--ps-shadow-sm);
    }
```

add:

```css
    /* Disabled, not native disabled (its tooltip needs hover and focus): faint text, and the
       checked chip keeps its ring. */
    button[aria-disabled='true'] {
      color: var(--ps-text-faint);
      cursor: not-allowed;
    }
```

- [ ] **Step 5: Run the kit tests**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts`

Expected: PASS, six more tests than at the baseline (the coarse-pointer case passes with its disabled option).

Also run the style lint, which checks `choice.styles.ts`: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`. Expected: PASS.

- [ ] **Step 6: Show a disabled option in the kit gallery**

In `apps/web/src/dev/KitGallery.tsx`, replace:

```tsx
const STRUCTURE_COLOURS: SegmentedOption[] = [
  { value: 'plddt', label: 'pLDDT' },
  { value: 'ted', label: 'TED domains' },
];
```

with:

```tsx
const STRUCTURE_COLOURS: SegmentedOption[] = [
  { value: 'plddt', label: 'pLDDT' },
  {
    value: 'ted',
    label: 'TED domains',
    disabled: true,
    tooltip: 'Available once the structure has loaded',
  },
];
```

The app type-checks against core's `dist`, so build core before the app's type-check (the hook runs it): `pnpm --filter @protspace/core build`, then `pnpm --filter @protspace/app type-check`. Expected: no error (before the build it fails: `disabled` does not exist in type `SegmentedOption`).

- [ ] **Step 7: Run the kit gallery e2e**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e kit-gallery.spec.ts --project kit-gallery`

Expected: PASS, 1 test (every kit tag defined, no console error in light or dark, the gallery's Escape checks).

- [ ] **Step 8: Format check and commit**

```bash
pnpm exec prettier --check packages/core/src/components/kit/segmented.ts \
  packages/core/src/components/kit/choice.styles.ts \
  packages/core/src/components/kit/fields.browser.test.ts apps/web/src/dev/KitGallery.tsx
```

Then (sandbox disabled):

```bash
git add packages/core/src/components/kit/segmented.ts \
  packages/core/src/components/kit/choice.styles.ts \
  packages/core/src/components/kit/fields.browser.test.ts apps/web/src/dev/KitGallery.tsx
git commit -m "feat(core): segmented options can be disabled with a reason"
```

Report: `fields.browser.test.ts` counts before and after, the kit-gallery run.

### Task 8.4: The structure viewer on the kit's segmented control and on tokens; the legacy sheets go

The viewer's pLDDT / TED buttons become a `ps-segmented` with the TED option disabled and explained while it cannot apply. Its sheet stops composing `tokens`, `overlayMixins` and `segmentedControlMixin`: the loading veil, spinner and `spin` keyframes move into it on tokens, the three unread `--protspace-viewer-*` properties go, and its sizes read the type tokens. That leaves the three legacy sheets without an importer, so they are deleted, and with `LEGACY` empty the lint's legacy machinery goes too.

**Files:**

- Modify: `packages/core/src/components/structure-viewer/structure-viewer.ts` (imports; a `_colorOptions` getter after `_tedButtonTitle`; the `.color-toolbar` template in `render()`; `_tedButtonTitle` and `_handleColorModeChange` unchanged)
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` (whole file)
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts` (the `colorButton`/`expectActiveColorMode` helpers and their call sites; one new case)
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts` (`describe('protspace-structure-viewer color mode')`, the coarse-pointer colour case, the two dark cases that read `.segmented`; three new cases)
- Delete: `packages/core/src/styles/tokens.ts`, `packages/core/src/styles/mixins.ts`, `packages/core/src/styles/overlay-mixins.ts`
- Modify: `packages/core/src/styles/style-lint.test.ts` (delete `LEGACY`, `OWNER`, `ownCssOf`, `STRIP_COMMENTS`, `LEGACY_VARS`, `COLOUR_ALIASES`, `colourViolations`, the first test's `colourViolations` block, `'%s hard-codes no colour'`, `'%s still needs its legacy exemption'`; `'%s reads colours and font sizes from tokens'` runs over every path)

**Interfaces:**

- Consumes: Task 8.3's `SegmentedOption { value; label; disabled?; tooltip? }` and `PsSegmented` (`options`, `value`, `label`; `change` event with `detail.value`, `bubbles: true`; options render as `button[role="radio"][data-value][aria-checked]` with `aria-disabled="true"` when disabled, each option's `ps-tooltip` as the button's next element sibling; group `[role="radiogroup"]` 40 px tall under a coarse pointer with 34 px options); `StructureColorMode` (`'plddt' | 'ted-domains'`, `molstar-loader.ts`); `_colorMode`, `_canChangeColorMode`, `_hasTedDomains`, `_tedButtonTitle`, `_handleColorModeChange(mode)`, `_isLoading`, `_error`, `_viewer`, `_structureData` (`structure-viewer.ts`); the type, z-index and alias mappings (Global Constraints); `overlay-mixins.ts`' `.loading-overlay`/`.loading-spinner`/`@keyframes spin` rules (copied, on tokens); Task 8.1's `cssViolations` own-property rule and Task 8.2's `LEGACY` (3 entries) in `style-lint.test.ts`; in the browser test, `mount()`, `deepActiveElement` (`../kit/focus`), `colourChannels`, `cdp`, `userEvent`.
- Produces:
  - Template: `<span class="color-toolbar-label">Color by</span><ps-segmented class="color-mode" label="Structure color mode" .options=${this._colorOptions} .value=${live(this._colorMode)} @change=${(e: CustomEvent<{ value: string }>) => this._handleColorModeChange(e.detail.value as StructureColorMode)}></ps-segmented>`, where `_colorOptions` returns `[{ value: 'plddt', label: 'pLDDT', disabled: !this._canChangeColorMode }, { value: 'ted-domains', label: 'TED domains', disabled: !this._canChangeColorMode || !this._hasTedDomains, tooltip: this._tedButtonTitle }]`. `live()` (from `lit/directives/live.js`) re-sets the control's value whenever it differs from `_colorMode`, so a request the viewer refuses or rolls back within one update never leaves the control showing the other mode. The `.segmented`, `.segmented-btn`, `data-color-mode` and `aria-pressed` markup goes.
  - `export const structureViewerStyles = [structureViewerStylesCore]`; `:host` gains `font-family: var(--ps-font-sans)` and loses `--protspace-viewer-width|height|border-radius`; `.loading-overlay` (`position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; background: color-mix(in srgb, var(--ps-surface) 90%, transparent)`), `.loading-spinner` (2.5rem, `2px solid var(--ps-border)`, top `var(--ps-accent)`, `animation: spin 1s linear infinite`), `@keyframes spin`, all local; `.error-container` `z-index: 10`, `.empty-container` `z-index: 1`; `.loading-text`, `.empty-message` `var(--ps-text-md)`, `.color-toolbar`/`.tips` `var(--ps-text-sm)`; the viewer's segmented rules (coarse `min-height`, `:has(+ ps-tooltip:last-child)`) deleted.
  - Style lint: `cssViolations` is checked for every module; no allowlist, no colour-only path.

**Tests:**

- `structure-viewer.coloring.test.ts`: `colorButton(element, mode)` (now async) awaits the viewer's and the `ps-segmented`'s `updateComplete` and returns `[role="radio"][data-value="${mode}"]` from the control's shadow root; the checked state is `aria-checked`, the disabled state `aria-disabled`; every existing case passes with the new helpers; new: "TED without domains is aria-disabled and a change event for it applies nothing" (a `change` dispatched on the control for `ted-domains`, and a click on the option: `setColorTheme` not called, pLDDT still checked).
- `structure-viewer.browser.test.ts`: "the checked colour option is the kit's chip" (replaces the accent-fill case: computed `box-shadow` contains `rgb(0, 122, 181)`, background the surface white); "hovering the disabled TED option shows why it is disabled" (`aria-disabled="true"`, hover shows its `ps-tooltip` "Available once the structure has loaded"); coarse pointer: "the resource links are 40 px targets and the colour control is a 40 px group" (each option ≥ 34 × 34); dark: the segmented track border reads `--ps-border-strong` (rgb(51, 65, 85)) and an unchecked enabled option `--ps-text-muted` (rgb(148, 163, 184)); "the focused checked colour option shows the library ring" (Tab reaches the checked option inside `ps-segmented`'s shadow root); new "the loading veil and the error box sit above the viewer at z-index 10" (and the spinner spins with the accent edge); new "the viewer host renders in Inter" (and declares no `--protspace-viewer-height`); new "at 240 px the colour row fits on one line inside the host" (toolbar `scrollWidth` ≤ `clientWidth`, the group inside the host, each chip's label inside the chip).
- `style-lint.test.ts`: every module passes `cssViolations`; the first test keeps its two `cssViolations` blocks, and Task 8.1's own-property case stays.
- Run: the three viewer test files (`structure-viewer.coloring.test.ts`, `structure-viewer.component.test.ts` unit; `structure-viewer.browser.test.ts` browser), `style-lint.test.ts`, `styles-integrity.test.ts` (sandbox disabled for browser); e2e `workbench-structure.spec.ts -g "Pop out"` (one spec, `--project workbench`).
- Unrun at task time (exit): the rest of `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts` (structure sheet), `workbench-theme.spec.ts`, `workbench-a11y.spec.ts`, `mobile-a11y.spec.ts`.

LEGACY: deleted. One commit: the viewer drops the sheets' last import, and knip fails an orphaned file or export, so the deletion lands with it.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Browser tests, e2e and `git commit` need the sandbox disabled.

- [ ] **Step 1: Write the failing coloring tests**

In `packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts`:

1. Replace the two type imports below `import './structure-viewer';`:

```ts
import type { ProtspaceStructureViewer } from './structure-viewer';
import type { StructureColorMode } from './molstar-loader';
```

with:

```ts
import type { ProtspaceStructureViewer } from './structure-viewer';
import type { StructureColorMode } from './molstar-loader';
import type { PsSegmented } from '../kit/segmented';
```

2. Replace the two helpers `colorButton` and `expectActiveColorMode`:

```ts
function colorButton(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  return element.shadowRoot?.querySelector<HTMLButtonElement>(`[data-color-mode="${mode}"]`);
}

function expectActiveColorMode(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const inactiveMode: StructureColorMode = mode === 'plddt' ? 'ted-domains' : 'plddt';
  expect(colorButton(element, mode)?.getAttribute('aria-pressed')).toBe('true');
  expect(colorButton(element, inactiveMode)?.getAttribute('aria-pressed')).toBe('false');
  expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
    mode === 'plddt' ? 'pLDDT confidence' : 'TED domains',
  );
}
```

with:

```ts
/** The viewer's colour control (a ps-segmented), once the viewer and the control have rendered. */
async function colorControl(element: ProtspaceStructureViewer): Promise<PsSegmented | null> {
  await element.updateComplete;
  const control = element.shadowRoot?.querySelector('ps-segmented') ?? null;
  await control?.updateComplete;
  return control;
}

async function colorButton(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const control = await colorControl(element);
  return (
    control?.shadowRoot?.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${mode}"]`) ??
    null
  );
}

/** A kit option is disabled by aria-disabled, never native disabled (its tooltip needs hover). */
function isDisabled(button: HTMLButtonElement | null): boolean {
  expect(button, 'the colour option is rendered').not.toBeNull();
  return button!.getAttribute('aria-disabled') === 'true';
}

async function expectActiveColorMode(element: ProtspaceStructureViewer, mode: StructureColorMode) {
  const inactiveMode: StructureColorMode = mode === 'plddt' ? 'ted-domains' : 'plddt';
  expect((await colorButton(element, mode))?.getAttribute('aria-checked')).toBe('true');
  expect((await colorButton(element, inactiveMode))?.getAttribute('aria-checked')).toBe('false');
  expect(element.shadowRoot?.querySelector('.color-description')?.textContent).toContain(
    mode === 'plddt' ? 'pLDDT confidence' : 'TED domains',
  );
}
```

3. Update the call sites, test by test (inside `describe('structure viewer color control')`):

- `it('defaults to pLDDT and enables TED coloring when domains exist', …)`: replace

  ```ts
      expectActiveColorMode(element, 'plddt');
      expect(colorButton(element, 'ted-domains')?.disabled).toBe(false);
  ```

  with

  ```ts
      await expectActiveColorMode(element, 'plddt');
      expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false);
  ```

- `it('keeps the color toolbar mounted but disabled while a structure loads', …)`: replace

  ```ts
      expect(colorButton(element, 'plddt')?.disabled).toBe(true);
      expect(colorButton(element, 'ted-domains')?.disabled).toBe(true);

      structureLoad.resolve();
      await vi.waitFor(() => expect(colorButton(element, 'ted-domains')?.disabled).toBe(false));
  ```

  with

  ```ts
      expect(isDisabled(await colorButton(element, 'plddt'))).toBe(true);
      expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(true);

      structureLoad.resolve();
      await vi.waitFor(async () =>
        expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false),
      );
  ```

- `it('disables TED coloring when no assignments are available', …)`: replace

  ```ts
      const tedButton = colorButton(element, 'ted-domains');

      expect(tedButton?.disabled).toBe(true);
  ```

  with

  ```ts
      const tedButton = await colorButton(element, 'ted-domains');

      expect(isDisabled(tedButton)).toBe(true);
  ```

  (the two expectations after it, no `title` and the `ps-tooltip` sibling's text containing "unavailable", stay as they are).

- `it('switches the loaded representation to TED and back to pLDDT', …)`: replace its body after `const element = await renderViewer(domains);` with

  ```ts

      (await colorButton(element, 'ted-domains'))?.click();
      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenCalledWith('ted-domains'));
      await element.updateComplete;
      await expectActiveColorMode(element, 'ted-domains');

      (await colorButton(element, 'plddt'))?.click();
      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
      await element.updateComplete;
      await expectActiveColorMode(element, 'plddt');
  ```

- `it('honors a rapid return to pLDDT while TED coloring is still applying', …)`: replace

  ```ts
      colorButton(element, 'ted-domains')?.click();
      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));
      colorButton(element, 'plddt')?.click();
      tedChange.resolve();

      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
      await element.updateComplete;
      expectActiveColorMode(element, 'plddt');
  ```

  with

  ```ts
      (await colorButton(element, 'ted-domains'))?.click();
      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('ted-domains'));
      (await colorButton(element, 'plddt'))?.click();
      tedChange.resolve();

      await vi.waitFor(() => expect(mocks.setColorTheme).toHaveBeenLastCalledWith('plddt'));
      await element.updateComplete;
      await expectActiveColorMode(element, 'plddt');
  ```

- `it('restores the previous mode when a theme change fails', …)`: replace

  ```ts
      colorButton(element, 'ted-domains')?.click();
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
      await element.updateComplete;
      expectActiveColorMode(element, 'plddt');
  ```

  with

  ```ts
      (await colorButton(element, 'ted-domains'))?.click();
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
      await element.updateComplete;
      await expectActiveColorMode(element, 'plddt');
  ```

- `it('ignores a completed color change from a replaced viewer', …)`: replace the first

  ```ts
      colorButton(element, 'ted-domains')?.click();
  ```

  with

  ```ts
      (await colorButton(element, 'ted-domains'))?.click();
  ```

  and the three final expectations

  ```ts
      expect(colorButton(element, 'plddt')?.getAttribute('aria-pressed')).toBe('true');
      expect(colorButton(element, 'ted-domains')?.getAttribute('aria-pressed')).toBe('false');
      expect(colorButton(element, 'ted-domains')?.disabled).toBe(true);
  ```

  with

  ```ts
      expect((await colorButton(element, 'plddt'))?.getAttribute('aria-checked')).toBe('true');
      expect((await colorButton(element, 'ted-domains'))?.getAttribute('aria-checked')).toBe(
        'false',
      );
      expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(true);
  ```

- `it('ignores a stale structure load that settles while its replacement is loading', …)`: replace

  ```ts
      expect(colorButton(element, 'plddt')?.disabled).toBe(true);

      replacementStructureLoad.resolve();
      await vi.waitFor(() => expect(colorButton(element, 'plddt')?.disabled).toBe(false));
  ```

  with

  ```ts
      expect(isDisabled(await colorButton(element, 'plddt'))).toBe(true);

      replacementStructureLoad.resolve();
      await vi.waitFor(async () =>
        expect(isDisabled(await colorButton(element, 'plddt'))).toBe(false),
      );
  ```

- `it('does not reset a replacement viewer theme when a stale structure load finishes', …)`: replace

  ```ts
      await vi.waitFor(() => expect(colorButton(element, 'ted-domains')).not.toBeNull());

      colorButton(element, 'ted-domains')?.click();
  ```

  with

  ```ts
      await vi.waitFor(async () =>
        expect(isDisabled(await colorButton(element, 'ted-domains'))).toBe(false),
      );

      (await colorButton(element, 'ted-domains'))?.click();
  ```

  (A disabled option ignores the click, as the native-disabled button did; waiting for it to be enabled states the precondition the old `not.toBeNull()` wait relied on.)

4. Add a case directly after the closing `});` of `it('disables TED coloring when no assignments are available', …)`:

```ts
  it('TED without domains is aria-disabled and a change event for it applies nothing', async () => {
    const element = await renderViewer([]);
    const ted = await colorButton(element, 'ted-domains');
    expect(isDisabled(ted)).toBe(true);

    // Neither a stray change event nor a click on the disabled option recolours.
    const control = await colorControl(element);
    control!.dispatchEvent(
      new CustomEvent('change', { bubbles: true, detail: { value: 'ted-domains' } }),
    );
    ted!.click();
    await element.updateComplete;

    expect(mocks.setColorTheme).not.toHaveBeenCalled();
    await expectActiveColorMode(element, 'plddt');
  });
```

Check: `grep -n "data-color-mode\|aria-pressed\|\.disabled)" packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts` prints nothing.

- [ ] **Step 2: Write the failing browser tests**

In `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts`:

1. After the `mount()` function (before `describe('protspace-structure-viewer header', …)`), add:

```ts

/** The viewer's colour control and its options, once the viewer and the control have rendered. */
async function colorControl(viewer: ProtspaceStructureViewer) {
  await viewer.updateComplete;
  const control = viewer.shadowRoot!.querySelector('ps-segmented')!;
  await control.updateComplete;
  const option = (mode: string) =>
    control.shadowRoot!.querySelector<HTMLElement>(`[role="radio"][data-value="${mode}"]`)!;
  return { control, option };
}

/**
 * Stands in for a loaded structure with TED domains (requestAnimationFrame is stubbed, so nothing
 * loads), which enables both colour options.
 */
async function enableColorModes(viewer: ProtspaceStructureViewer): Promise<void> {
  const internals = viewer as unknown as { _viewer: unknown; _structureData: unknown };
  internals._viewer = { setBackground: () => true, dispose() {} };
  internals._structureData = {
    tedDomains: [{ domainNumber: 1, segments: [{ start: 1, end: 10 }] }],
  };
  viewer.requestUpdate();
  await viewer.updateComplete;
}
```

2. Replace the whole `describe('protspace-structure-viewer color mode', () => { … })` block with:

```ts
describe('protspace-structure-viewer color mode', () => {
  it("the checked colour option is the kit's chip", async () => {
    const viewer = await mount();
    const { option } = await colorControl(viewer);
    const checked = option('plddt');
    expect(checked.getAttribute('aria-checked')).toBe('true');
    // The kit's look: a surface chip ringed in the accent (#007ab5), not an accent fill.
    expect(getComputedStyle(checked).boxShadow).toContain('rgb(0, 122, 181)');
    expect(getComputedStyle(checked).backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('hovering the disabled TED option shows why it is disabled', async () => {
    // requestAnimationFrame is stubbed, so the structure never loads and TED stays disabled.
    const viewer = await mount();
    const { option } = await colorControl(viewer);
    const ted = option('ted-domains');
    expect(ted.getAttribute('aria-disabled')).toBe('true');
    const tooltip = ted.nextElementSibling as HTMLElement & { text: string };
    expect(tooltip.localName).toBe('ps-tooltip');
    expect(tooltip.text).toBe('Available once the structure has loaded');

    await userEvent.hover(ted);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
  });

  it('the loading veil and the error box sit above the viewer at z-index 10', async () => {
    const viewer = await mount();
    const internals = viewer as unknown as { _isLoading: boolean; _error: string | null };
    internals._isLoading = true;
    internals._error = 'Structure not available';
    await viewer.updateComplete;
    const root = viewer.shadowRoot!;
    expect(getComputedStyle(root.querySelector('.loading-overlay')!).zIndex).toBe('10');
    expect(getComputedStyle(root.querySelector('.error-container')!).zIndex).toBe('10');
    const spinner = getComputedStyle(root.querySelector('.loading-spinner')!);
    expect(spinner.animationName).toBe('spin');
    // #007ab5, the light --ps-accent, on the spinner's moving edge.
    expect(spinner.borderTopColor).toBe('rgb(0, 122, 181)');
  });

  it('the viewer host renders in Inter', async () => {
    const viewer = await mount();
    expect(getComputedStyle(viewer).fontFamily).toMatch(/^"Inter Variable"/);
    // The size properties nothing read are gone.
    expect(getComputedStyle(viewer).getPropertyValue('--protspace-viewer-height').trim()).toBe('');
  });

  it('at 240 px the colour row fits on one line inside the host', async () => {
    const viewer = await mount('240px');
    await enableColorModes(viewer);
    const { control, option } = await colorControl(viewer);
    const toolbar = viewer.shadowRoot!.querySelector<HTMLElement>('.color-toolbar')!;
    // Nothing is pushed past the toolbar's edge…
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    const host = viewer.getBoundingClientRect();
    const group = control.shadowRoot!.querySelector('[role="radiogroup"]')!.getBoundingClientRect();
    expect(group.right).toBeLessThanOrEqual(host.right + 0.5);
    // …and each label stays inside its chip (Task 8.3 made chips one line).
    for (const mode of ['plddt', 'ted-domains']) {
      const chip = option(mode);
      expect(chip.scrollWidth, mode).toBeLessThanOrEqual(chip.clientWidth);
    }
  });
});
```

The 240 px docked sidebar is a pinned layout (the resource-link case above and the e2e "TED link is clickable docked at 240 px"), and the kit's 13 px labels are wider than the viewer's old 12 px buttons. If this case fails after Step 6, narrow the row inside the viewer's sheet only (`.color-toolbar { gap: var(--ps-space-1-5); padding: 0.35rem var(--ps-space-1); }`) and report the measured widths; do not change the kit's chip sizes.

3. In `describe('protspace-structure-viewer under a coarse pointer')`, replace the whole `it('the resource links and the colour-mode buttons are 40 px tall', …)` with:

```ts
  it('the resource links are 40 px targets and the colour control is a 40 px group', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const viewer = await mount();
      const links = viewer.shadowRoot!.querySelectorAll('.header-link');
      expect(links.length).toBe(4);
      for (const link of links) {
        const box = link.getBoundingClientRect();
        expect(box.height, link.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.width, link.textContent!.trim()).toBeGreaterThanOrEqual(40 - 0.5);
      }
      // The kit's touch sizes: 34 px options inside a 40 px group.
      const { control, option } = await colorControl(viewer);
      const group = control.shadowRoot!.querySelector('[role="radiogroup"]')!;
      expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(40 - 0.5);
      for (const mode of ['plddt', 'ted-domains']) {
        const box = option(mode).getBoundingClientRect();
        expect(box.height, mode).toBeGreaterThanOrEqual(34 - 0.5);
        expect(box.width, mode).toBeGreaterThanOrEqual(34 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
```

4. In `describe('protspace-structure-viewer in dark')`, in `it('in dark the frame, header and footer read the dark surfaces and text', …)`, replace:

```ts
    // The segmented control: #334155 --ps-border-strong, unpressed text muted.
    expect(style('.segmented').borderTopColor).toBe('rgb(51, 65, 85)');
    expect(style('.segmented-btn[aria-pressed="false"]').color).toBe('rgb(148, 163, 184)');
```

with:

```ts
    // The colour control, enabled as after a load: #334155 --ps-border-strong around the track,
    // the unchecked option in --ps-text-muted.
    await enableColorModes(viewer);
    const { control, option } = await colorControl(viewer);
    const track = control.shadowRoot!.querySelector('[role="radiogroup"]')!;
    expect(getComputedStyle(track).borderTopColor).toBe('rgb(51, 65, 85)');
    expect(getComputedStyle(option('ted-domains')).color).toBe('rgb(148, 163, 184)');
```

5. Replace the whole `it('the focused selected colour segment shows the library ring, offset from its fill', …)` with:

```ts
  it('the focused checked colour option shows the library ring', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    await enableColorModes(viewer);
    const { option } = await colorControl(viewer);
    const checked = option('plddt');
    // The checked option is the control's one tab stop, inside ps-segmented's shadow root.
    for (let step = 0; step < 20 && deepActiveElement() !== checked; step++) await userEvent.tab();
    expect(deepActiveElement()).toBe(checked);
    const style = getComputedStyle(checked);
    // sky-400, the dark --ps-focus, 2 px out from the chip.
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineColor).toBe('rgb(56, 189, 248)');
    expect(style.outlineOffset).toBe('2px');
  });
```

Check: `grep -n "segmented-btn\|data-color-mode\|aria-pressed\|'\.segmented'" packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts` prints nothing.

- [ ] **Step 3: Empty LEGACY and delete the lint's legacy code**

In `packages/core/src/styles/style-lint.test.ts`:

1. Delete the `LEGACY` doc comment and set (Task 8.2 left three entries):

```ts
/**
 * Modules written before the tokens existed. A phase that migrates a module deletes its line. The
 * last test fails while a listed module is already clean, so this list only shrinks.
 */
const LEGACY = new Set<string>([
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
]);

```

2. Delete everything between the closing `}` of `function cssOf(path: string): string` (and its following blank line) and the doc comment of `function cssViolations` — that is, the whole run of: the `/** Each sheet a module exports by name … */` comment and the `OWNER` map with its `for` loop; `ownCssOf` and its doc comment; `const STRIP_COMMENTS`; `LEGACY_VARS` and its comment; `COLOUR_ALIASES` and its comment; `colourViolations` and its doc comment. After the edit, `function cssOf` is followed by one blank line and then the `cssViolations` doc comment that begins `Declarations that hard-code a colour or a font size`.

3. In the first test, `it('flags raw colours, literal font sizes, stray tokens and unknown variables', …)`, delete its last block:

```ts
    // The colour-only check: tokens.ts colour aliases and undefined variables fail; its other
    // aliases, literal font sizes and the module's own properties pass.
    expect(
      colourViolations(
        '.a { color: var(--surface); background: #fff; border-color: var(--nowhere); gap: var(--spacing-sm); font-size: 12px; --gap: 2px; margin: var(--gap); max-height: var(--available-height); }',
      ),
    ).toEqual(['color: var(--surface)', 'background: #fff', 'border-color: var(--nowhere)']);
```

4. Replace:

```ts
  it.each(paths.filter((path) => !LEGACY.has(path)))(
    '%s reads colours and font sizes from tokens',
    (path) => {
      expect(cssViolations(cssOf(path))).toEqual([]);
    },
  );
```

with:

```ts
  it.each(paths)('%s reads colours and font sizes from tokens', (path) => {
    expect(cssViolations(cssOf(path))).toEqual([]);
  });
```

5. Delete the last two tests (from the blank line before the first to the line before the closing `});` of `describe('style lint')`):

```ts

  it.each([...LEGACY])('%s hard-codes no colour', (path) => {
    expect(colourViolations(ownCssOf(path))).toEqual([]);
  });

  it.each([...LEGACY])('%s still needs its legacy exemption', (path) => {
    expect(MODULES[path], `${path} no longer exists; delete it from LEGACY`).toBeDefined();
    expect(
      cssViolations(cssOf(path)).length,
      `${path} is clean; delete it from LEGACY`,
    ).toBeGreaterThan(0);
  });
```

Check: `grep -nE "LEGACY|colourViolations|ownCssOf|OWNER|STRIP_COMMENTS|COLOUR_ALIASES" packages/core/src/styles/style-lint.test.ts` prints nothing. The `MODULES` doc comment ("Every style module except the token file itself, …") stays true: the glob keeps `./*.ts` so a future shared sheet is checked.

- [ ] **Step 4: Run the tests to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/components/structure-viewer/structure-viewer.coloring.test.ts`

Expected: FAIL.
- `style-lint.test.ts`: three `'… reads colours and font sizes from tokens'` cases fail. `structure-viewer.styles.ts` gets `['font-size: var(--text-sm)', 'font-size: var(--text-sm)', 'font-size: 0.875rem', 'font-size: 0.875rem', 'font-size: 0.75rem']` (the first two from the composed `overlayMixins` and `segmentedControlMixin`; their `--z-*`, `--radius`, `--border-width` and `--spacing-*` reads pass because the composed `tokens` declares them). `./mixins.ts` and `./overlay-mixins.ts` fail on their `var(--border-width)`, `var(--radius)`, `var(--spacing-*)`, `var(--z-*)`, `var(--font-medium)` and `var(--text-sm)` reads, which nothing in them declares. `./tokens.ts` passes. Steps 6–7 make the first pass and delete the other two.
- `structure-viewer.coloring.test.ts`: every case that reads a colour option fails (there is no `ps-segmented` yet): through `isDisabled` with "the colour option is rendered: expected null not to be null", through `expectActiveColorMode` with `expected undefined to be 'true'`; the new case fails with them.

Then (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts`

Expected: FAIL in the colour cases (`querySelector('ps-segmented')` is null: "the checked colour option…", "hovering the disabled TED option…", the coarse-pointer colour case, the dark frame case, the focus-ring case) and in "the viewer host renders in Inter" (`system-ui, …`; `--protspace-viewer-height` is `100%`) and "at 240 px the colour row fits on one line inside the host" (no `ps-segmented`). "the loading veil and the error box sit above the viewer at z-index 10" passes already (`tokens` defines `--z-overlay`, `overlayMixins` the spinner): it guards the move. The other cases pass.

- [ ] **Step 5: The colour control becomes a ps-segmented**

In `packages/core/src/components/structure-viewer/structure-viewer.ts`:

1. Imports. Replace `import { LitElement, html, nothing, type PropertyValues } from 'lit';` with:

```ts
import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
```

and replace `import '../kit/tooltip';` with:

```ts
import '../kit/segmented';
import type { SegmentedOption } from '../kit/segmented';
```

(`ps-segmented` imports `ps-tooltip` itself, and the viewer renders no other `ps-tooltip`.)

2. Directly after the `_tedButtonTitle` getter (the one returning `'Available once the structure has loaded'` / `'Color residues by TED domain'` / `'TED domain annotations are unavailable for this protein'`), add:

```ts

  /** pLDDT once the structure has loaded; TED also needs domains, and says why when it cannot. */
  private get _colorOptions(): SegmentedOption[] {
    return [
      { value: 'plddt', label: 'pLDDT', disabled: !this._canChangeColorMode },
      {
        value: 'ted-domains',
        label: 'TED domains',
        disabled: !this._canChangeColorMode || !this._hasTedDomains,
        tooltip: this._tedButtonTitle,
      },
    ];
  }
```

3. In `render()`, replace the colour toolbar:

```ts
              <div class="color-toolbar">
                <span class="color-toolbar-label">Color by</span>
                <div
                  class="segmented color-mode-group"
                  role="group"
                  aria-label="Structure color mode"
                >
                  <button
                    type="button"
                    class="segmented-btn"
                    data-color-mode="plddt"
                    aria-pressed=${this._colorMode === 'plddt'}
                    .disabled=${!this._canChangeColorMode}
                    @click=${() => this._handleColorModeChange('plddt')}
                  >
                    pLDDT
                  </button>
                  <button
                    type="button"
                    class="segmented-btn"
                    data-color-mode="ted-domains"
                    aria-pressed=${this._colorMode === 'ted-domains'}
                    .disabled=${!this._canChangeColorMode || !this._hasTedDomains}
                    @click=${() => this._handleColorModeChange('ted-domains')}
                  >
                    TED domains
                  </button>
                  <ps-tooltip text=${this._tedButtonTitle}></ps-tooltip>
                </div>
              </div>
```

with:

```ts
              <div class="color-toolbar">
                <span class="color-toolbar-label">Color by</span>
                <!-- live(): the control picks a mode itself; a request the viewer refuses or rolls
                     back must still put the control back on the viewer's mode. -->
                <ps-segmented
                  class="color-mode"
                  label="Structure color mode"
                  .options=${this._colorOptions}
                  .value=${live(this._colorMode)}
                  @change=${(event: CustomEvent<{ value: string }>) =>
                    this._handleColorModeChange(event.detail.value as StructureColorMode)}
                ></ps-segmented>
              </div>
```

`_handleColorModeChange` is unchanged: it already ignores a request without a viewer, for the current mode, or for TED without domains.

- [ ] **Step 6: The viewer's sheet on tokens, without the legacy sheets**

Replace the whole of `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` with:

```ts
import { css } from 'lit';

const structureViewerStylesCore = css`
  :host {
    /* Every colour comes from a --ps-* token (theme.ts), so an embedder restyles the viewer in both
       themes by setting those on :root. The frame is the panel's surface, the colour the Mol*
       canvas also takes, so frame and canvas meet without a seam. */
    display: flex;
    flex-direction: column;
    width: 100%;
    font-family: var(--ps-font-sans);

    box-shadow: var(--ps-shadow-md);
    box-sizing: border-box;
    position: relative;
    background: var(--ps-surface);
    border: 1px solid var(--ps-border);
    flex-shrink: 1;
    flex-grow: 1;
    min-height: 150px;
    border-radius: 6px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.4rem 0.4rem 1.2rem;
    background: var(--ps-surface-muted);
    border-radius: 6px 6px 0 0;
  }

  .header-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-2);
    font-size: var(--ps-text-base);
    font-weight: var(--ps-weight-semibold);
    color: var(--ps-text);
    margin: 0;
  }

  /* Two stacked rows: what this is, then where it goes. */
  .header-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .protein-id {
    font-size: var(--ps-text-base);
    color: var(--ps-text-muted);
  }

  /* With several selected proteins the id is a ghost button that opens the menu of them. */
  .protein-pick {
    display: inline-flex;
    align-items: center;
    gap: var(--ps-space-1);
    min-height: var(--ps-control-sm);
    padding: 0 var(--ps-space-1-5);
    border: 0;
    border-radius: var(--ps-radius);
    background: transparent;
    color: var(--ps-text-muted);
    font-family: inherit;
    font-size: var(--ps-text-base);
    cursor: pointer;
  }

  .protein-pick:hover,
  .protein-pick[aria-expanded='true'] {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
  }

  .protein-pick:focus-visible {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }

  /* The links row continues the header's band and ends it with the header's line. */
  .resource-links {
    background: var(--ps-surface-muted);
    border-bottom: 1px solid var(--ps-border);
  }

  .close-button {
    background: none;
    border: none;
    display: inline-grid;
    place-items: center;
    color: var(--ps-text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 0.25rem;
    transition: color 0.2s;
  }

  .close-button:hover {
    color: var(--ps-text);
    background: var(--ps-surface-hover);
  }

  /* Touch: the close and protein-pick buttons are 40 px targets (the app's header is 44 px). The
     colour control is ps-segmented, which sizes itself for touch. */
  @media (pointer: coarse) {
    .close-button,
    .protein-pick {
      min-width: var(--ps-touch-target);
      min-height: var(--ps-touch-target);
    }
  }

  .viewer-container {
    position: relative;
    width: 100%;
    /* Take only the height the header and footer leave, so the footer never overflows */
    flex: 1 1 0;
    min-height: 0;
    background: var(--ps-surface);
    border-radius: 0 0 6px 6px;
  }

  /* The veil over the viewer while a structure loads. */
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10;
    background: color-mix(in srgb, var(--ps-surface) 90%, transparent);
  }

  .loading-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 2px solid var(--ps-border);
    border-top: 2px solid var(--ps-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .loading-text {
    color: var(--ps-text-muted);
    font-size: var(--ps-text-md);
    margin-top: 1rem;
  }

  .error-container {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface);
    z-index: 10;
    padding: 2rem;
    border-radius: 0 0 6px 6px;
    text-align: center;
  }

  .error-title {
    color: var(--ps-danger);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-container {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface);
    z-index: 1;
    padding: 2rem;
    text-align: center;
  }

  .empty-title {
    color: var(--ps-text);
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .empty-message {
    color: var(--ps-text-muted);
    font-size: var(--ps-text-md);
  }

  .viewer-content,
  .molstar-mount {
    width: 100%;
    height: 100%;
    border-radius: 0 0 6px 6px;
  }

  /* Mol*'s layout is absolutely positioned: the mount holds it, so the canvas follows the mount's
     whole-pixel box (_snapMount). */
  .molstar-mount {
    position: relative;
  }

  .color-toolbar,
  .tips {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface-muted);
    border-top: 1px solid var(--ps-border);
    color: var(--ps-text-muted);
    font-size: var(--ps-text-sm);
  }

  .color-toolbar {
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
  }

  /* Without tips the toolbar is the panel's last row, so it carries the bottom corners */
  .color-toolbar:last-child {
    border-radius: 0 0 6px 6px;
  }

  .color-toolbar-label {
    font-weight: 600;
  }

  .tips {
    flex-direction: column;
    padding: 0.2rem 0.5rem;
    border-radius: 0 0 6px 6px;
  }

  .tips strong {
    font-weight: 600;
  }

  /* The body part only groups the rows for a host; it adds no box. */
  .body {
    display: contents;
  }

  /* ----------------------------- Responsive ------------------------------------ */

  /* Below desktop the viewer has half a panel row: keep only the colour legend. The host's size
     is the shell's to set (the workbench fills its structure section). */
  @media (max-width: 950px) {
    .interaction-tip {
      display: none;
    }
  }
`;

export const structureViewerStyles = [structureViewerStylesCore];
```

What changed against the old sheet, and nothing else: the three `--protspace-viewer-*` lines and their "Sizes only" wording; `font-family` on `:host` (it came from `tokens`' `:host`); the coarse `.segmented > .segmented-btn` rule; `.loading-overlay` now whole (it was split between `overlayMixins` and an override), `.loading-spinner` and `@keyframes spin` copied from `overlayMixins`; `z-index` 10 and 1 for `--z-overlay` and `--z-canvas`; `0.875rem` → `var(--ps-text-md)` twice and `0.75rem` → `var(--ps-text-sm)`; the `:has(+ ps-tooltip:last-child)` rule and the "provided by overlayMixins" comments; the three legacy sheets in the export.

- [ ] **Step 7: Delete the legacy sheets**

```bash
git rm packages/core/src/styles/tokens.ts packages/core/src/styles/mixins.ts \
  packages/core/src/styles/overlay-mixins.ts
```

Check: `grep -rnE "styles/tokens|styles/mixins|overlay-mixins|overlayMixins|segmentedControlMixin|srOnlyMixin" packages/core/src apps/web/src` prints nothing (`docs/` is Task 8.5's).

- [ ] **Step 8: Run the touched tests**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/style-lint.test.ts src/styles/styles-integrity.test.ts \
  src/components/structure-viewer/structure-viewer.coloring.test.ts \
  src/components/structure-viewer/structure-viewer.component.test.ts
```

Expected: PASS. `style-lint.test.ts`: the `'… reads colours and font sizes from tokens'` cases cover every module (the three deleted ones are gone from the glob; `structure-viewer.styles.ts` joins), the two LEGACY `it.each` blocks are gone, and the own-property case stays. `structure-viewer.coloring.test.ts`: one more test than at the baseline.

Then (sandbox disabled):

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/structure-viewer/structure-viewer.browser.test.ts
```

Expected: PASS, three more tests than at the baseline (the colour describe has five cases, was two).

Then the one e2e spec (sandbox disabled; it builds the packages):

```bash
PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure.spec.ts --project workbench -g "Pop out"
```

Expected: PASS (the Mol* stub draws nothing; the card's placement and the toolbar are unchanged in size).

- [ ] **Step 9: Format check and commit**

```bash
pnpm exec prettier --check packages/core/src/components/structure-viewer/structure-viewer.ts \
  packages/core/src/components/structure-viewer/structure-viewer.styles.ts \
  packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts \
  packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts \
  packages/core/src/styles/style-lint.test.ts
```

Then (sandbox disabled; the hook's knip confirms no orphaned export or file):

```bash
git add packages/core/src/components/structure-viewer/structure-viewer.ts \
  packages/core/src/components/structure-viewer/structure-viewer.styles.ts \
  packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts \
  packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts \
  packages/core/src/styles/style-lint.test.ts
git commit -m "refactor(core): structure viewer on ps-segmented; legacy sheets go"
```

(The three deletions are already staged by `git rm` in Step 7.)

Report: the counts of the five test files before and after, `git show --stat HEAD` (three files deleted), and that `LEGACY` no longer exists.

### Task 8.5: Developer and design docs describe the final style setup

The developer docs still teach the legacy composition, breakpoints in `tokens.ts`, the `LEGACY` rule, and viewer size properties that are gone. They now describe what is: one token sheet, the lint without exemptions, the plot's four size properties, no viewer properties. The design records `scatter-plot.ts` as the exception to the 800-line rule with its follow-up, and the proposal drops the info buttons that were never built and says the legacy sheets are deleted.

**Files:**

- Modify: `docs/developers/style-architecture.md` (the paragraph after "Import Order"'s code block; "Breakpoints" and the breakpoint-comment example under "Media Query Rules"; "Design tokens" paragraph; "Component properties" and "Component Prefixes"; the "Simple Component" example; the migration checklist's `LEGACY` line; the scatter-plot sheet's line count)
- Modify: `docs/developers/embedding.md` (the BREAKING note under "Components in another document")
- Modify: `apps/web/src/landing/ExplorerFrame.tsx` (the doc comment above `const UI`; no import)
- Modify: `openspec/changes/explore-workbench/design.md` (decision 5: the lint's own-property rule, no layer tokens; decision 18: one bullet for the exception)
- Modify: `openspec/changes/explore-workbench/proposal.md` (the `explore-help` capability line drops the info buttons; the Impact section's Core bullet says the legacy sheets are deleted)

**Interfaces:**

- Consumes: the final style code of Tasks 8.1–8.4 (no `tokens.ts`, `mixins.ts`, `overlay-mixins.ts`; `cssViolations` checks every module and accepts a module's own non-`--ps-` properties; `RUNTIME_VARS` lists `--available-height`, `--available-width`, `--picker-room`, `--protspace-tooltip-max-height`, `--protspace-tooltip-effective-width`; `scatterplotStyles`' four properties `--protspace-width` 100%, `--protspace-height` 600px, `--protspace-border-radius` 6px, `--protspace-brush-stroke-width` 1px; `z-index` written as numbers; the viewer declares no property); `packages/core/src/utils/breakpoints.ts` (`PHONE_MAX_WIDTH` 640, `DESKTOP_MIN_WIDTH` 951, `LANDSCAPE_PHONE_MAX_HEIGHT` 500, `PHONE_MEDIA`, `LANDSCAPE_PHONE_MEDIA`, `COMPACT_MEDIA`); `kitHost`, `focusRing` (`components/kit/kit-shared.styles.ts`); the anchors other pages link: `style-architecture.md#component-properties` and `#theming-the-legend` (from `embedding.md`), `/developers/style-architecture` (from `contributing.md`). Their headings ("Component properties", "Theming the legend") keep their text.
- Produces:
  - design.md decision 18 bullet, verbatim: "`scatter-plot.ts` (about 2,600 lines) is a recorded exception: its isolation, tooltip and pin code and the `updated()` reconcilers share private state on the plot's hottest path, so this change moves out only the export compositing. Follow-up: split it in a change of its own after this one merges."
  - design.md decision 5 says what the code now does: sizes list no "layers" (stacking is plain `z-index` numbers per shadow root), and the lint bullet names the own-property rule (Step 10 gives the text).
  - No page anchor that another page links to changes (`pnpm docs:images:check` checks anchors; `docs:build` checks pages).

**Tests:**

- `grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-|--breakpoint-" docs/developers` prints only the embedding BREAKING note's lines naming the removed viewer properties, and `grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-" apps/web/src` prints nothing (`LEGACY_TOUR_STORAGE_KEY` in `apps/web/src/tour/` is a storage key, not the lint's list, which the pattern skips).
- `grep -nE "tokens\.ts|overlay-mixins|info buttons" openspec/changes/explore-workbench/proposal.md` prints only the Impact bullet's line saying the three sheets are deleted.
- `pnpm docs:images:check`, `pnpm docs:build` (the hook runs both), `pnpm exec prettier --check` on the edited files.
- No code test changes.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `git commit` needs the sandbox disabled (the hook builds the docs).

- [ ] **Step 1: See what still teaches the legacy setup**

Run:

```bash
grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-|--breakpoint-" docs/developers
grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-" apps/web/src
```

(Two commands: `apps/web/src/index.css`'s `--theme(--breakpoint-sm)` is Tailwind's, for the landing page, and must not change, so `--breakpoint-` is searched in the developer docs only.)

Expected (the failing check): hits in `docs/developers/style-architecture.md` (the composition paragraph, "Defined in `tokens.ts`", `--breakpoint-lg` in the media-query example, the `LEGACY` paragraph, the viewer properties that "stay", the Component Prefixes row, the checklist), in `docs/developers/embedding.md` (the BREAKING note) and in `apps/web/src/landing/ExplorerFrame.tsx` ("copied from packages/core/src/styles/tokens.ts").

- [ ] **Step 2: Rewrite the composition paragraph**

In `docs/developers/style-architecture.md`, under "## Import Order", replace the paragraph after the code block:

```markdown
New styles read `--ps-*` tokens (see Custom Properties) and do not compose the legacy `tokens`,
`buttonMixin` or `overlayMixins`; only modules in `LEGACY` still use them, in the older order
`tokens`, mixins, `themeStyles`, features, `responsiveStyles`.
```

with:

```markdown
Styles read `--ps-*` tokens (see Custom Properties). There are no alias sheets or style mixins to
compose: an element that renders its own text sets `font-family: var(--ps-font-sans)` on its
`:host`, or composes `kitHost`, which also sets the base size and colour.
```

- [ ] **Step 3: Point the breakpoints at breakpoints.ts**

Replace the "### Breakpoints" section, from its heading to the line before "### Media Query Rules":

````markdown
### Breakpoints

Defined in `tokens.ts`:

```css
--breakpoint-xs: 550px; /* Mobile */
--breakpoint-sm: 600px; /* Small tablets */
--breakpoint-md: 800px; /* Tablets */
--breakpoint-lg: 950px; /* Small desktop */
--breakpoint-xl: 1200px; /* Desktop */
--breakpoint-2xl: 1450px; /* Large desktop */
```

````

with:

````markdown
### Breakpoints

Defined in `packages/core/src/utils/breakpoints.ts` (design decision 17), the values the web app's
layouts switch at:

| Constant                     | Value  | Layout                                                    |
| ---------------------------- | ------ | --------------------------------------------------------- |
| `PHONE_MAX_WIDTH`            | 640 px | phone at or below this width                              |
| `DESKTOP_MIN_WIDTH`          | 951 px | the desktop workbench at or above this width              |
| `LANDSCAPE_PHONE_MAX_HEIGHT` | 500 px | landscape phone at or below this height, below desktop    |

A shadow-DOM stylesheet cannot see the workbench's `data-layout` attribute, so it uses the
module's ready-made queries: `PHONE_MEDIA`, `LANDSCAPE_PHONE_MEDIA` and `COMPACT_MEDIA` (either
phone layout).

```typescript
import { css, unsafeCSS } from 'lit';
import { PHONE_MEDIA } from '../../utils/breakpoints';

export const rowStyles = css`
  @media ${unsafeCSS(PHONE_MEDIA)} {
    /* phone */
  }
`;
```

````

Then, under "### Media Query Rules", replace the example:

```css
@media (max-width: 950px) {
  /* --breakpoint-lg */
  :host {
    max-width: unset;
  }
}
```

with:

```css
@media (max-width: 950px) {
  /* below DESKTOP_MIN_WIDTH */
  :host {
    max-width: unset;
  }
}
```

- [ ] **Step 4: Describe the lint as it is**

Under "### Design tokens", replace:

```markdown
`[data-theme='dark']`, and under `[data-theme='system']` while the OS prefers dark, so a
`system` page follows the OS live). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.
A `LEGACY` module may still read a non-colour alias from `tokens.ts` (spacing, type, z-index), but
no colour: `tokens.ts` declares none, and the lint fails a legacy module that hard-codes one or
reads an alias nothing declares. The web app's `workbench.css` and `tour/product-tour.css` are
held to the colour rule too.
```

with:

```markdown
`[data-theme='dark']`, and under `[data-theme='system']` while the OS prefers dark, so a
`system` page follows the OS live). Stylesheets read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` checks every core stylesheet, with no exemptions.
It fails one that hard-codes a colour or a font size, declares a `--ps-*` token, or reads a
variable that neither `theme.ts` nor the stylesheet itself declares. A module may read a
component property it declares (the scatter plot's `--protspace-height`, the projection card's
`--card-gap`); the few values code sets at run time (`--protspace-tooltip-max-height`, the kit's
`--available-height`, …) are listed in the test. `z-index` values are plain numbers: there are no
layer tokens. The web app's `workbench.css` and `tour/product-tour.css` are held to the colour
rule too.
```

- [ ] **Step 5: Component properties: the plot's four sizes, none for the viewer**

Replace the section from "### Component properties" to the line before "### Theming the legend" (its heading text stays, `embedding.md` links `#component-properties`):

````markdown
### Component properties

Older components still expose custom properties of their own:

```
--[component-prefix]-[category]-[property]-[modifier?]
```

**Examples:**

```css
--protspace-height              /* element sizing */
--protspace-width               /* element sizing */
```

Rules for these:

1. **Sizes only**: colours come from the `--ps-*` tokens, so a component property never holds a
   colour (`--protspace-height: 100%`)
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Group with comments**: `/* Layout */`, `/* Sizing */`

The scatter plot no longer has colour properties: its background, border, brush and lasso, the
overlay chips, EAT connectors and spiderfy marks, the protein tooltip and the projection card
read `--ps-*` tokens (`--ps-plot-bg`, `--ps-accent`, `--ps-surface-raised`, `--ps-plot-connector`,
`--ps-eat`, `--ps-eat-endpoint` and the role colours), so setting those on `:root` restyles it in
both themes. A host-declared colour property would block the theme, so none is offered. Its
remaining `--protspace-*` properties are sizes, opacities and timings.

The structure viewer's colour properties (`--protspace-viewer-bg`, `-border`, `-header-bg`,
`-text`, `-text-muted`, `-error`, `-loading`) are gone too: its frame, header, footer, loading veil
and colour-mode control read the tokens, and the Mol\* canvas takes `--ps-surface` as its
background, set again whenever a theme change gives that token another value. Its
`--protspace-viewer-width`, `-height` and `-border-radius` stay.

### Component Prefixes

| Component            | Prefix                              |
| -------------------- | ----------------------------------- |
| Legend               | `--ps-*` tokens only                |
| Scatter-plot         | `--protspace-*` (sizes only)        |
| Structure-viewer     | `--protspace-viewer-*` (sizes only) |
| Kit and new elements | `--ps-*` tokens only                |

````

with:

````markdown
### Component properties

The scatter plot is the one element with custom properties of its own, four sizes on its `:host`:

| Property                         | Default | Sets                                      |
| -------------------------------- | ------- | ----------------------------------------- |
| `--protspace-width`              | `100%`  | the element's width                       |
| `--protspace-height`             | `600px` | the element's height                      |
| `--protspace-border-radius`      | `6px`   | its corner radius                         |
| `--protspace-brush-stroke-width` | `1px`   | the outline of the box and lasso selection |

Rules for a component property:

1. **Sizes only**: colours come from the `--ps-*` tokens, so a component property never holds a
   colour (`--protspace-height: 100%`)
2. **Define in `:host` only**
3. **Use only when** a runtime override is needed, or the value is used 3+ times
4. **Name it** `--[component-prefix]-[property]`, and group it under a comment (`/* Layout */`)

The scatter plot has no colour properties: its background, border, brush and lasso, the overlay
chips, EAT connectors and spiderfy marks, the protein tooltip and the projection card read
`--ps-*` tokens (`--ps-plot-bg`, `--ps-accent`, `--ps-surface-raised`, `--ps-plot-connector`,
`--ps-eat`, `--ps-eat-endpoint` and the role colours), so setting those on `:root` restyles it in
both themes. A host-declared colour property would block the theme, so none is offered. Its point
size, opacity, stroke and transition properties, which nothing read, are gone as well.

The structure viewer has no properties of its own. Its frame, header, footer, loading veil and
colour-mode control read the tokens, and the Mol\* canvas takes `--ps-surface` as its background,
set again whenever a theme change gives that token another value. Its size comes from its host,
as the workbench's structure section and floating card set it.

### Component Prefixes

| Component            | Prefix                       |
| -------------------- | ---------------------------- |
| Legend               | `--ps-*` tokens only         |
| Scatter-plot         | `--protspace-*` (sizes only) |
| Structure-viewer     | `--ps-*` tokens only         |
| Kit and new elements | `--ps-*` tokens only         |

````

- [ ] **Step 6: The example, the checklist and the sheet's size**

Under "### Simple Component", replace the code block:

```typescript
// search.styles.ts
import { css } from 'lit';
import { tokens } from '../../styles/tokens';

const searchStylesCore = css`
  :host {
    /* ... */
  }
  .search-input {
    /* ... */
  }
`;

export const searchStyles = [tokens, searchStylesCore];
```

with:

```typescript
// search.styles.ts
import { css } from 'lit';
import { focusRing, kitHost } from '../kit/kit-shared.styles';

const searchStylesCore = css`
  :host {
    display: block;
  }
  .search-input {
    font-size: var(--ps-text-base);
    color: var(--ps-text);
    border: 1px solid var(--ps-border);
    border-radius: var(--ps-radius);
  }
`;

export const searchStyles = [kitHost, focusRing, searchStylesCore];
```

Under "## Migration Checklist", replace:

```markdown
- [ ] Read only `--ps-*` tokens; remove the module from `LEGACY` in `style-lint.test.ts`
```

with:

```markdown
- [ ] Read only `--ps-*` tokens (`style-lint.test.ts` checks every stylesheet)
```

Under "### scatter-plot", replace:

```markdown
Host-level CSS stays in the 183-line `scatter-plot.styles.ts`, which is inside the 150–300 band
```

with:

```markdown
Host-level CSS stays in the 221-line `scatter-plot.styles.ts`, which is inside the 150–300 band
```

(Task 8.2 leaves the sheet at 221 lines; if `wc -l packages/core/src/components/scatter-plot/scatter-plot.styles.ts` prints another number, write that one.)

- [ ] **Step 7: The embedding BREAKING note**

In `docs/developers/embedding.md`, replace the note:

```markdown
::: warning BREAKING
The `--protspace-*` colour properties (the scatterplot's background, brush, tooltip and overlay
colours; the structure viewer's `--protspace-viewer-bg`, `-border`, `-header-bg`, `-text`,
`-text-muted`, `-error`, `-loading`) are removed. A host that set them sets the `--ps-*` token the
component now reads instead. Size properties such as the scatterplot's `--protspace-height` stay. See
[Component properties](./style-architecture.md#component-properties).
:::
```

with:

```markdown
::: warning BREAKING
The `--protspace-*` colour properties (the scatterplot's background, brush, tooltip and overlay
colours; the structure viewer's `--protspace-viewer-bg`, `-border`, `-header-bg`, `-text`,
`-text-muted`, `-error`, `-loading`) are removed. A host that set them sets the `--ps-*` token the
component now reads instead. Also removed, because nothing read them: the scatterplot's point
size, opacity, stroke and transition properties, and the structure viewer's
`--protspace-viewer-width`, `-height` and `-border-radius` (size the viewer element itself). The
scatterplot's `--protspace-width`, `--protspace-height`, `--protspace-border-radius` and
`--protspace-brush-stroke-width` stay. See
[Component properties](./style-architecture.md#component-properties).
:::
```

- [ ] **Step 8: The landing frame's comment**

In `apps/web/src/landing/ExplorerFrame.tsx`, replace:

```tsx
/** Surface tokens copied from packages/core/src/styles/tokens.ts. */
```

with:

```tsx
/**
 * The explorer's light surface colours as plain values: the landing page never imports core, whose
 * tokens live in packages/core/src/styles/theme.ts.
 */
```

(The values are the landing page's own and do not all equal `theme.ts`'s; the comment no longer claims they were copied.)

- [ ] **Step 9: Check the developer docs and commit them**

Run:

```bash
grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-|--breakpoint-" docs/developers
grep -rnE "tokens\.ts|overlay-mixins|overlayMixins|srOnlyMixin|segmentedControlMixin|LEGACY([^_A-Z]|$)|--protspace-viewer-" apps/web/src
```

(Two commands: `apps/web/src/index.css`'s `--theme(--breakpoint-sm)` is Tailwind's, for the landing page, and must not change, so `--breakpoint-` is searched in the developer docs only.)

Expected: the first command prints only `docs/developers/embedding.md` lines inside the BREAKING note (the line naming `--protspace-viewer-bg` and the line naming `--protspace-viewer-width`); the second prints nothing.

```bash
pnpm exec prettier --write docs/developers/style-architecture.md docs/developers/embedding.md
pnpm exec prettier --check docs/developers/style-architecture.md docs/developers/embedding.md \
  apps/web/src/landing/ExplorerFrame.tsx
git diff --stat
```

Expected: Prettier only realigns the two new tables; `git diff --stat` lists the three files. Then:

```bash
pnpm docs:images:check && pnpm docs:build
```

Expected: both pass (no anchor or page another page links to changed).

Commit (sandbox disabled):

```bash
git add docs/developers/style-architecture.md docs/developers/embedding.md \
  apps/web/src/landing/ExplorerFrame.tsx
git commit -m "docs(developers): style architecture without the legacy sheets"
```

- [ ] **Step 10: Record the lint, the stacking and the exception in design.md**

Decision 5 is what part B's spec files are written from, and two of its sentences stop being true in this phase. In `openspec/changes/explore-workbench/design.md`, under "### 5. Design tokens on the document root", replace:

```markdown
  and neutral point greys); and sizes (control heights 28/32 px, list row 28 px, radii, the type
  scale, spacing, motion durations, layers). Role values are literal colours from the slate and cyan
  ramps, named in comments; the ramps are not variables, so every variable has a user.
```

with:

```markdown
  and neutral point greys); and sizes (control heights 28/32 px, list row 28 px, radii, the type
  scale, spacing, motion durations). Stacking order is not a token: each shadow root writes its few
  `z-index` values as plain numbers. Role values are literal colours from the slate and cyan ramps,
  named in comments; the ramps are not variables, so every variable has a user.
```

and replace:

```markdown
- A unit test fails when a core stylesheet contains a raw colour, a pixel font size or a `var(--…)`
  that `theme.ts` does not define, and when `theme.ts` defines a token nothing uses.
```

with:

```markdown
- A unit test fails when a core stylesheet contains a raw colour, a literal font size, a `--ps-*`
  declaration or a `var(--…)` that neither `theme.ts` nor the stylesheet itself declares (a
  component may read its own size properties, such as the scatter plot's `--protspace-height`),
  and when `theme.ts` defines a token nothing uses.
```

Then, under "### 18. Code structure targets", directly after the first bullet:

```markdown
- No element file over about 800 lines; `legend.ts`, `control-bar.ts` and `publish-modal.ts` are
  split as described above.
```

add the bullet:

```markdown
- `scatter-plot.ts` (about 2,600 lines) is a recorded exception: its isolation, tooltip and pin
  code and the `updated()` reconcilers share private state on the plot's hottest path, so this
  change moves out only the export compositing. Follow-up: split it in a change of its own after
  this one merges.
```

(Task 8.9 later extends the first bullet with the legend's reached size; this one stays the second bullet.)

- [ ] **Step 11: Drop the info buttons and record the deleted sheets in proposal.md**

In `openspec/changes/explore-workbench/proposal.md`, under "## Capabilities" (the `explore-help` item), replace:

```markdown
- `explore-help`: the help menu, the complete keyboard shortcut list, the full tour for new visitors
  and the "What's new" tour for returning ones, and info buttons for Contours, Filter and Export.
```

with:

```markdown
- `explore-help`: the help menu, the complete keyboard shortcut list, the full tour for new visitors
  and the "What's new" tour for returning ones.
```

Under "## Impact", replace the Core bullet:

```markdown
- **Core (`packages/core`)**: a new `components/kit/` (controls, layer stack); `styles/theme.ts`
  replaces `styles/tokens.ts` and most of `mixins.ts` / `overlay-mixins.ts`; the legend split into
  focused files; `control-bar.ts` replaced by separate elements; the figure editor moved onto
  `ps-dialog` and split; the scatterplot reads its background and neutral colours from tokens,
  resizes once per layout change and keeps the viewed centre; the structure viewer gains docked and
  floating modes and themed backgrounds; the export renderer uses the shared scale function.
```

with:

```markdown
- **Core (`packages/core`)**: a new `components/kit/` (controls, layer stack); `styles/theme.ts`
  replaces `styles/tokens.ts`, `mixins.ts` and `overlay-mixins.ts`, which are deleted; the legend
  split into focused files; `control-bar.ts` replaced by separate elements; the figure editor moved
  onto `ps-dialog` and split; the scatterplot reads its background and neutral colours from tokens,
  resizes once per layout change and keeps the viewed centre; the structure viewer gains docked and
  floating modes and themed backgrounds; the export renderer uses the shared scale function.
```

(The `explore-help` spec delta, if it names the info buttons, is part B's spec-file work: do not edit any file under `openspec/changes/explore-workbench/specs/`.)

- [ ] **Step 12: Check the OpenSpec docs and commit them**

```bash
grep -nE "tokens\.ts|overlay-mixins|info buttons" openspec/changes/explore-workbench/proposal.md
pnpm exec prettier --check openspec/changes/explore-workbench/design.md \
  openspec/changes/explore-workbench/proposal.md
```

Expected: the grep prints only the Impact bullet's line `replaces \`styles/tokens.ts\`, \`mixins.ts\` and \`overlay-mixins.ts\`, which are deleted; the legend`; Prettier passes.

Commit (sandbox disabled):

```bash
git add openspec/changes/explore-workbench/design.md openspec/changes/explore-workbench/proposal.md
git commit -m "docs(openspec): record the lint, the scatter-plot exception; drop info buttons"
```

Report: the two greps' output, the `docs:build` result, and both commits' hashes.

### Task 8.6: Projection details: formatting moves into its own module

`projection-metadata.ts` (821 lines) keeps its element, render and layer code; its pure metadata splitting and formatting (:622–814) and `modalCoverage` (:105–125) move into `projection-metadata-format.ts` as exported functions with their own unit tests. Move only: the card renders exactly as before.

**Files:**

- Create: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.ts`
- Create: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts`
- Modify: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`

**Interfaces:**

- Consumes: `ProtspaceProjectionMetadata` privates `_splitMetadata()` (:627), `_qualityEntries` (:711), `_qualityScopeLine` (:744), `_isJsonField` (:754), `_tryParseJson` (:761), `_formatMetadataKey` (:772), `_formatMetadataValue` (:785), `_formatSingleValue` (:802); module-level `interface MetadataRow` (:35), `interface QualityEntry` (:95), `function modalCoverage(entries: readonly ClusterAgreementEntry[]): number | null` (:110); `Projection` (`metadata?: Record<string, unknown> & { dimension?: 2 | 3 }`), `ClusterAgreementEntry` (`{ annotation; metrics; categories: number | null; scored: number | null }`), `NA_DISPLAY` (`'N/A'`), `countNoun`, `formatStatValue`, `metricDisplay` (`@protspace/utils`). No module constant of `projection-metadata.ts` is read by the moved code (`SCOPE_HEADINGS`, `RECOVERS_*`, `SEPARATION_SCOPE_DESCRIPTION` stay with the render code that reads them).
- Produces (`projection-metadata-format.ts`):
  - `export interface MetadataRow { label: string; value: string; description: string; scope?: string | null }` (the element imports it for `_renderSection`).
  - `export function splitMetadata(metadata: Projection['metadata'] | undefined): { parameters: MetadataRow[]; quality: MetadataRow[]; qualityScope: string }` (the body of `_splitMetadata`, reading `metadata` where it read `this.projection.metadata`; `undefined` → `{ parameters: [], quality: [], qualityScope: '' }`).
  - `export function modalCoverage(entries: readonly ClusterAgreementEntry[]): number | null`.
  - `export function formatMetadataKey(key: string): string` and `export function formatMetadataValue(value: unknown, key: string): string` (exported for the test).
  - Module-private: `QualityEntry`, `qualityEntries`, `qualityScopeLine`, `isJsonField`, `tryParseJson`, `formatSingleValue`.
  - The element calls `splitMetadata(this.projection?.metadata)` in `render()` and `modalCoverage(entries)` in `_renderRecovers`; `projection-metadata.ts` ≤ 650 lines (about 590).

**Tests:**

- `projection-metadata-format.test.ts` (`--project unit`, node): "splitMetadata separates parameters from quality metrics"; "a JSON-string field is parsed into its quality entries"; "an empty or missing metadata gives no rows"; "formatMetadataKey turns a snake_case or camelCase key into words"; "formatMetadataValue gives explained variance two decimals and other fractions three" (the current code prints `0.71`, not `71%`; the test pins what the code does); "modalCoverage picks the coverage most entries share and ignores unscored ones"; "modalCoverage of no scored entries is null".
- Run: the new test, `projection-metadata.component.test.ts` (unit), `projection-metadata.browser.test.ts`, `projection-metadata.theme.browser.test.ts` (browser, sandbox disabled).
- Unrun at task time (exit): `workbench-view-bar.spec.ts` (projection details).

Report the moved-member map and `wc -l projection-metadata.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. The new test is a `--project unit` test (node, no DOM) and runs inside the sandbox; the folder run in Step 5 includes two browser files and needs the sandbox disabled. No utils change: core's tests import the built `@protspace/utils` as it is.

- [ ] **Step 1: Write the failing format tests**

Create `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ClusterAgreementEntry } from '@protspace/utils';
import {
  formatMetadataKey,
  formatMetadataValue,
  modalCoverage,
  splitMetadata,
} from './projection-metadata-format';

/** One faithfulness entry as the backend writes it: the value plus its provenance. */
function qualityEntry(value: number | null, scope: 'local' | 'global') {
  return { value, scope, k: 15, seed: 42, sampled: false, sample_size: 1428 };
}

/** One Recovers row; only `scored` matters to modalCoverage. */
const recovered = (annotation: string, scored: number | null): ClusterAgreementEntry => ({
  annotation,
  metrics: [],
  categories: null,
  scored,
});

describe('splitMetadata', () => {
  it('splitMetadata separates parameters from quality metrics', () => {
    const { parameters, quality, qualityScope } = splitMetadata({
      dimension: 2,
      name: 'ProtT5 — UMAP 2',
      n_neighbors: 15,
      min_dist: 0.1,
      quality: {
        knn_overlap: qualityEntry(0.5776844070961717, 'local'),
        spearman_distance: qualityEntry(0.53, 'global'),
      },
    });

    // `dimension` and `name` are not parameters; the reducer's knobs carry no description.
    expect(parameters).toEqual([
      { label: 'N Neighbors', value: '15', description: '' },
      { label: 'Min Dist', value: '0.100', description: '' },
    ]);
    // Registry metrics take the registry's spelling, formatStatValue's two decimals and a scope.
    expect(quality.map(({ label, value, scope }) => ({ label, value, scope }))).toEqual([
      { label: 'kNN Overlap', value: '0.58', scope: 'local' },
      { label: 'Spearman Distance', value: '0.53', scope: 'global' },
    ]);
    expect(quality.every((row) => row.description.length > 0)).toBe(true);
    expect(qualityScope).toBe('1,428 proteins compared');
  });

  it('a JSON-string field is parsed into its quality entries', () => {
    const { parameters, quality, qualityScope } = splitMetadata({
      info_json: JSON.stringify({
        n_components: 2,
        quality: {
          trustworthiness: { value: 0.97, scope: 'local', sampled: true, sample_size: 5000 },
        },
      }),
    });
    expect(parameters).toEqual([{ label: 'N Components', value: '2', description: '' }]);
    expect(quality).toHaveLength(1);
    expect(quality[0]).toMatchObject({ label: 'Trustworthiness', value: '0.97', scope: 'local' });
    expect(qualityScope).toBe('5,000 proteins compared · subsampled');

    // A JSON-named field that does not parse stays one parameter, shown as written.
    expect(splitMetadata({ info_json: 'not json' }).parameters).toEqual([
      { label: 'Info Json', value: 'not json', description: '' },
    ]);
  });

  it('an empty or missing metadata gives no rows', () => {
    const empty = { parameters: [], quality: [], qualityScope: '' };
    expect(splitMetadata(undefined)).toEqual(empty);
    expect(splitMetadata({})).toEqual(empty);
    expect(splitMetadata({ dimension: 2, name: 'PCA 2' })).toEqual(empty);
  });

  it('a metric the backend skipped reads N/A', () => {
    const { quality } = splitMetadata({ quality: { continuity: qualityEntry(null, 'local') } });
    expect(quality[0]).toMatchObject({ label: 'Continuity', value: 'N/A', scope: 'local' });
  });
});

describe('metadata formatting', () => {
  it('formatMetadataKey turns a snake_case or camelCase key into words', () => {
    expect(formatMetadataKey('n_neighbors')).toBe('N Neighbors');
    expect(formatMetadataKey('minDist')).toBe('Min Dist');
    expect(formatMetadataKey('random_state')).toBe('Random State');
  });

  it('formatMetadataValue gives explained variance two decimals and other fractions three', () => {
    expect(formatMetadataValue([0.71234, 0.2], 'explained_variance_ratio')).toBe('0.71, 0.20');
    expect(formatMetadataValue(0.12345, 'min_dist')).toBe('0.123');
    expect(formatMetadataValue(15, 'n_neighbors')).toBe('15');
    expect(formatMetadataValue(true, 'whiten')).toBe('Yes');
    expect(formatMetadataValue(null, 'seed')).toBe('N/A');
    expect(formatMetadataValue({ a: 1 }, 'extra')).toBe('{"a":1}');
  });
});

describe('modalCoverage', () => {
  it('modalCoverage picks the coverage most entries share and ignores unscored ones', () => {
    expect(
      modalCoverage([
        recovered('family', 811),
        recovered('ec', 192),
        recovered('order', 811),
        recovered('kingdom', null),
        recovered('phylum', null),
      ]),
    ).toBe(811);
    // A tie keeps the first value seen.
    expect(modalCoverage([recovered('ec', 192), recovered('family', 811)])).toBe(192);
  });

  it('modalCoverage of no scored entries is null', () => {
    expect(modalCoverage([])).toBeNull();
    expect(modalCoverage([recovered('family', null)])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts`
Expected: FAIL, the whole file: `Failed to resolve import "./projection-metadata-format"` (the module does not exist yet).

- [ ] **Step 3: Create the format module (moved code)**

Create `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.ts`. Every body below is the current method's body with `this._x(` → `x(` and `this.projection.metadata` → `metadata`; the doc comments move with their code.

```ts
/**
 * The projection details card's pure metadata handling: splitting a projection's metadata into
 * reduction parameters and faithfulness metrics, and formatting keys and values for display. The
 * element (projection-metadata.ts) renders what these return.
 */
import type { ClusterAgreementEntry, Projection } from '@protspace/utils';
import { NA_DISPLAY, countNoun, formatStatValue, metricDisplay } from '@protspace/utils';

/** One rendered `<dt>/<dd>` pair. An empty `description` renders no ⓘ. */
export interface MetadataRow {
  label: string;
  value: string;
  description: string;
  /** Faithfulness scope ("local" / "global"), rendered as a group heading. Null groups first. */
  scope?: string | null;
}

/** A faithfulness metric before display: the raw key is kept so it can be looked up. */
interface QualityEntry {
  metric: string;
  scope: string | null;
  value: unknown;
  /** Proteins the comparison ran over. Shared by every faithfulness metric in a projection. */
  sampleSize: number | null;
  /** Whether that was a subsample rather than everything — a real caveat, previously hidden. */
  sampled: boolean;
}

/**
 * The coverage most annotations in a block share. Modal, not maximal: the interesting case is the
 * one annotation that covers far fewer proteins than the rest, and comparing against the majority
 * is what makes it stand out. Null when nothing carries coverage.
 */
export function modalCoverage(entries: readonly ClusterAgreementEntry[]): number | null {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (entry.scored === null) continue;
    counts.set(entry.scored, (counts.get(entry.scored) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reduction parameters and projection quality, kept apart. They answer different
 * questions: the parameters are what was asked for, the quality is what came out, and
 * a single flat list invites reading `n_neighbors` and `trustworthiness` as peers.
 */
export function splitMetadata(metadata: Projection['metadata'] | undefined): {
  parameters: MetadataRow[];
  quality: MetadataRow[];
  /** One line under the faithfulness heading saying what it was computed over. */
  qualityScope: string;
} {
  if (!metadata) return { parameters: [], quality: [], qualityScope: '' };

  const parameterEntries: Array<[string, unknown]> = [];
  const qualityEntryList: QualityEntry[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'dimension' || lowerKey === 'dimensions' || lowerKey === 'name') {
      continue;
    }

    if (isJsonField(lowerKey) && typeof value === 'string') {
      const parsed = tryParseJson(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [innerKey, innerValue] of Object.entries(parsed)) {
          if (
            innerKey.toLowerCase() === 'quality' &&
            !!innerValue &&
            typeof innerValue === 'object' &&
            !Array.isArray(innerValue)
          ) {
            qualityEntryList.push(...qualityEntries(innerValue as Record<string, unknown>));
          } else {
            parameterEntries.push([innerKey, innerValue]);
          }
        }
        continue;
      }
    }

    if (lowerKey === 'quality' && !!value && typeof value === 'object' && !Array.isArray(value)) {
      qualityEntryList.push(...qualityEntries(value as Record<string, unknown>));
      continue;
    }

    parameterEntries.push([key, value]);
  }

  const parameters: MetadataRow[] = parameterEntries.map(([key, value]) => ({
    label: formatMetadataKey(key),
    value: formatMetadataValue(value, key),
    // Reduction parameters are the reducer's own knobs, documented by the reducer; only
    // the metrics below have a registry entry to explain them.
    description: '',
  }));

  const quality: MetadataRow[] = qualityEntryList.map(({ metric, scope, value }) => {
    const display = metricDisplay(metric);
    // A description is exactly what "the registry knows this metric" means, so it also
    // decides whether the registry's spelling ("kNN Overlap") beats the prettified key.
    const known = display.description.length > 0;
    return {
      // The scope is a group heading now, not a suffix on every row. "(local)" / "(global)"
      // on each of five labels cost more width than the panel has — "Spearman Distance
      // (global) ⓘ" pushed its own value onto a second line.
      label: known ? display.label : formatMetadataKey(metric),
      // These are statistics, so they follow `formatStatValue` like every other score in
      // the app rather than the generic metadata formatter's own rounding — which is still
      // right for reduction parameters, and still handles the `value: null` a skipped
      // metric is written as.
      value:
        typeof value === 'number' && Number.isFinite(value)
          ? formatStatValue(value)
          : formatMetadataValue(value, metric),
      description: display.description,
      scope,
    };
  });

  return { parameters, quality, qualityScope: qualityScopeLine(qualityEntryList) };
}

/**
 * One entry per faithfulness metric, tagged with its scope ("local" neighbourhoods vs "global"
 * layout). The shared provenance each metric carries (k, seed, sampling, source embedding) is
 * dropped: it repeats per metric and would bury the five numbers worth reading.
 */
function qualityEntries(quality: Record<string, unknown>): QualityEntry[] {
  return Object.entries(quality).map(([metric, entry]): QualityEntry => {
    if (!entry || typeof entry !== 'object' || !('value' in entry)) {
      return { metric, scope: null, value: entry, sampleSize: null, sampled: false };
    }
    const {
      value,
      scope,
      sample_size: sampleSize,
      sampled,
    } = entry as {
      value: unknown;
      scope?: unknown;
      sample_size?: unknown;
      sampled?: unknown;
    };
    return {
      metric,
      scope: typeof scope === 'string' ? scope : null,
      value,
      sampleSize: typeof sampleSize === 'number' && Number.isFinite(sampleSize) ? sampleSize : null,
      sampled: sampled === true,
    };
  });
}

/**
 * What the faithfulness numbers were computed over, which the panel dropped entirely: the
 * provenance repeats identically on every metric, so it belongs once under the section
 * rather than on each row. `sampled` is the part that matters — above a threshold the
 * backend compares a subsample, and nothing said so.
 */
function qualityScopeLine(entries: QualityEntry[]): string {
  const withSize = entries.find((entry) => entry.sampleSize !== null);
  if (!withSize) return '';
  const proteins = `${countNoun(withSize.sampleSize!, 'protein', 'proteins')} compared`;
  return entries.some((entry) => entry.sampled) ? `${proteins} · subsampled` : proteins;
}

/**
 * Check if a key indicates a JSON field
 */
function isJsonField(key: string): boolean {
  return key === 'info' || key === 'info_json' || key.includes('json');
}

/**
 * Safely parse JSON string
 */
function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Format metadata key to Title Case
 */
export function formatMetadataKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format metadata value with appropriate precision
 */
export function formatMetadataValue(value: unknown, key: string): string {
  if (value == null) return NA_DISPLAY;

  const lowerKey = key.toLowerCase();
  const isVarianceRatio =
    lowerKey.includes('explained_variance') || lowerKey.includes('variance_ratio');

  if (Array.isArray(value)) {
    return value.map((item) => formatSingleValue(item, isVarianceRatio)).join(', ');
  }

  return formatSingleValue(value, isVarianceRatio);
}

/**
 * Format a single metadata value
 */
function formatSingleValue(value: unknown, isVarianceRatio: boolean): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(isVarianceRatio ? 2 : 3);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}
```

Two rewrites the move forces, and only these: the local `qualityEntries` array of `_splitMetadata` is renamed `qualityEntryList`, because the module function `qualityEntries` (was `this._qualityEntries`) now shares its scope; and `const rawMetadata = this.projection.metadata;` goes, the loop reading `metadata` directly. Prettier joins `qualityEntries`' `sampleSize:` onto one line, since the body sits two spaces further left than it did in the class.

- [ ] **Step 4: Run the format tests and see them pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: The element imports the module and loses the moved code**

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`:

1. After `import { projectionMetadataStyles } from './projection-metadata.styles';` add:

```ts
import { modalCoverage, splitMetadata, type MetadataRow } from './projection-metadata-format';
```

2. Delete the module-level `MetadataRow` interface and its doc comment (from `/** One rendered \`<dt>/<dd>\` pair. An empty \`description\` renders no ⓘ. */` through its closing `}`, :34–41), with the blank line after it.

3. Delete the module-level `QualityEntry` interface and the `modalCoverage` function with their doc comments (from `/** A faithfulness metric before display: the raw key is kept so it can be looked up. */` through `modalCoverage`'s closing `}`, :94–125), with the blank line after it. `SEPARATION_SCOPE_DESCRIPTION` stays the last constant before `@customElement('protspace-projection-metadata')`.

4. In `render()`, replace

```ts
    const { parameters, quality, qualityScope } = this._splitMetadata();
```

with

```ts
    const { parameters, quality, qualityScope } = splitMetadata(this.projection?.metadata);
```

5. Delete every member from the doc comment `/**\n   * Reduction parameters and projection quality, kept apart.` (directly after `_statScopeLine`'s closing `}`) through the closing `}` of `_formatSingleValue`, and the blank line before that doc comment: that is `_splitMetadata`, `_qualityEntries`, `_qualityScopeLine`, `_isJsonField`, `_tryParseJson`, `_formatMetadataKey`, `_formatMetadataValue`, `_formatSingleValue` and their doc comments. The class now ends with `_statScopeLine`:

```ts
    return parts.join(' · ');
  }
}

declare global {
```

`_renderSection(title: string, id: string, rows: MetadataRow[], scopeLine = '')` and `_renderRecovers`'s `this._recoversPopulation = modalCoverage(entries);` are unchanged: they now resolve to the imported names. The `@protspace/utils` imports stay as they are: the element still uses each of them (`metricDisplay`, `formatStatValue`, `countNoun`, `NA_DISPLAY` and `ClusterAgreementEntry` in its render code).

Check nothing still names a moved member:

Run: `grep -n "_splitMetadata\|_qualityEntries\|_qualityScopeLine\|_isJsonField\|_tryParseJson\|_formatMetadata\|_formatSingleValue\|interface MetadataRow\|interface QualityEntry\|function modalCoverage" packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts`
Expected: no output.

Run: `wc -l packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.ts`
Expected: 586 and about 245 lines; `projection-metadata.ts` at most 650.

- [ ] **Step 6: Run the card's suites**

Run (sandbox disabled: the browser project starts a local server): `pnpm --filter @protspace/core exec vitest --run src/components/scatter-plot/projection-metadata`
Expected: PASS: the new file (8), `projection-metadata.component.test.ts`, `projection-metadata.browser.test.ts` and `projection-metadata.theme.browser.test.ts`, each with the count it had before this task (record both).

Run: `pnpm --filter @protspace/core type-check`
Expected: no errors.

Run: `pnpm exec prettier --check packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts`
Expected: all files pass (run `pnpm exec prettier --write` on them if not, then re-check).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.ts \
  packages/core/src/components/scatter-plot/projection-metadata/projection-metadata-format.test.ts
git commit -m "refactor(core): move projection details formatting to its own module"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`). knip sees each new export consumed: `splitMetadata`, `modalCoverage` and `MetadataRow` by the element, `formatMetadataKey` and `formatMetadataValue` by the test.

Report: test counts before and after, `wc -l` of both files, and the moved-member map:

- `projection-metadata.ts` module `interface MetadataRow` → `projection-metadata-format.ts` `export interface MetadataRow`
- module `interface QualityEntry` → `QualityEntry` (module-private)
- module `function modalCoverage` → `export function modalCoverage`
- `ProtspaceProjectionMetadata._splitMetadata()` → `export function splitMetadata(metadata)`
- `._qualityEntries` → `qualityEntries` (private)
- `._qualityScopeLine` → `qualityScopeLine` (private)
- `._isJsonField` → `isJsonField` (private)
- `._tryParseJson` → `tryParseJson` (private)
- `._formatMetadataKey` → `export function formatMetadataKey`
- `._formatMetadataValue` → `export function formatMetadataValue`
- `._formatSingleValue` → `formatSingleValue` (private)

### Task 8.7: Legend: the data pipeline moves into LegendDataController

The legend's data pipeline (data change, annotation change, counts, item rebuild and update, persisted-settings apply, shape size, numeric signatures and manual order; `legend.ts` :958–1442 and `_syncNumericSettingsFromPersistence` :493–532) moves into `controllers/data-controller.ts`. The controller takes the element as its host and reads its state directly (Global Constraints); `_updateLegendItems` stays on the element as the one counted entry. Move only.

**Files:**

- Create: `packages/core/src/components/legend/controllers/data-controller.ts`
- Create: `packages/core/src/components/legend/controllers/data-controller.test.ts`
- Modify: `packages/core/src/components/legend/controllers/index.ts` (export `LegendDataController`)
- Modify: `packages/core/src/components/legend/legend.ts`
- Modify: legend tests that call a moved method (`legend.numeric-settings.test.ts` `_applyPersistedSettings`, `_syncNumericSettingsFromPersistence`; `legend.settings.browser.test.ts` spies on `_rebuildLegendItems`)
- Modify (comments only, they name moved methods): `packages/core/src/components/legend/controllers/persistence-controller.ts` (:382), `packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts` (:256), `apps/web/src/explore/data-renderer.ts` (:152, names `_computeAnnotationCounts`)
- Modify: `docs/developers/architecture.md` (legend table :64 row for `legend.ts`; a row for `controllers/data-controller.ts`; the sentence after the table (:77) and the "Reactive Controllers Pattern" lead-in (:121) stop saying every controller is a Lit reactive controller; the callbacks paragraph says the four new controllers take the element as host, the older ones talk through callbacks)

**Interfaces:**

- Consumes: `ProtspaceLegend` (type-only import from `'../legend'`); its members the moved code touches, which this task makes non-private and gathers under one section comment (the full list is in Step 5: `data`, `selectedAnnotation`, `annotationData`, `annotationValues`, `proteinIds`, `isolationMode`, `isolationHistory`, `maxVisibleValues`, `shapeSize`, `getAllPersistedSettings()` are public already; `_legendItems`, `_otherItems`, `_hiddenValues`, `_annotationSortModes`, `_preIsolationVisibleValues`, `_enableDuplicateStackUI`, `_selectedPaletteId`, `_numericSettingsByAnnotation`, `_numericManualOrderIdsByAnnotation`, `_eatCounts`, `_categoryScores`, `_isClusterAnnotation`, `_countSource`, `_pendingExtractValue`, `_pendingMergeValue`, `_datasetProteinCount`, `_annotationShapeSize`, `_processorContext`, the getters `_hostDriven`, `_currentSortMode`, `_visibleValues`, the methods `_updateLegendItems`, `_isNumericAnnotation`, `_isCurrentAnnotationNumeric`, `_closeAnnotationOverlays`, `_clearKeyboardReorderState`, `_dispatchError`, and the controller fields `_scatterplotController`, `_persistenceController`, `_eatControls`); `perfCounters` (`../../../utils/perf-counters`); `LegendDataProcessor`, `resolvePersistedSettings`, `resolveNumericAnnotationDisplaySettings`, `normalizeSortModeForType`, … (as `legend.ts` imports them today); `PersistenceCallbacks` (`controllers/persistence-controller.ts`, exported) for the return type of `currentSettings()`.
- Produces (`LegendDataController`, `constructor(private readonly host: ProtspaceLegend)`), each the moved body of the method named after it:
  - `onDataChange(data: ScatterplotData, selectedAnnotation: string, selectedProjectionName: string): void` ← `_handleScatterplotDataChange` (with `_updateAnnotationValues` as the private helper `updateAnnotationValues`).
  - `onAnnotationChange(annotation: string): void` ← `_handleAnnotationChange`.
  - `refreshAnnotationData(): void` ← `_updateAnnotationDataFromData`.
  - `hasSelectedEatAnnotation(): boolean`, `ensureSortModeDefaults(): void`.
  - `rebuildItems(): void` ← `_rebuildLegendItems` (keeps `perfCounters.legendRebuild++` first; calls `this.host._updateLegendItems()`).
  - `updateItems(): void` ← the body of `_updateLegendItems` (keeps `perfCounters.legendUpdate++` first). Its only caller is `ProtspaceLegend._updateLegendItems()`.
  - `applyPersistedSettings(settings: LegendPersistedSettings): void`, `resolveShapeSize(): number`, `clearShapeSize(): void`, `normalizeSortMode(annotationName: string, sortMode: LegendSortMode | undefined): LegendSortMode`, `buildNumericManualOrderIds(annotationName: string): string[] | undefined`, `setNumericManualOrderIds(annotationName: string, orderIds: string[] | undefined): void`, `syncNumericSettingsFromPersistence(): void`.
  - `currentSettings(): ReturnType<PersistenceCallbacks['getCurrentSettings']>` ← the body of `PersistenceController`'s `getCurrentSettings` callback.
  - Private: `updateAnnotationValues`, `computeAnnotationCounts`, `getPersistedCategoriesForProcessing`, `getNumericOrderValues`, `computeNumericSettingsSignatures`.
  - `ProtspaceLegend`: field `readonly _data = new LegendDataController(this)` (first in the Controllers section, before the controllers whose callbacks use it); `_updateLegendItems(): void { this._data.updateItems(); }`; every other call site of a moved method calls `this._data.<method>()`; the `ScatterplotSyncController` callbacks call `this._data.onDataChange(…)`/`onAnnotationChange(…)`; `PersistenceController`'s `onSettingsLoaded` calls `this._data.applyPersistedSettings(s)` and `getCurrentSettings` is `() => this._data.currentSettings()`.
  - Stays on the element: `_isNumericAnnotation`, `_isCurrentAnnotationNumeric` (now in the shared section), `_isMultilabelAnnotation`, `_hasSameProteinIds` (still private, used only by the element), `_closeAnnotationOverlays`, `_dispatchError` (shared section), `_announceStatus`.
  - Section layout this task sets up (8.8 and 8.9 add to it): `legend.ts` gets one section headed `// Read and written by the legend's controllers (controllers/*); not public API.` between "Internal State" and "Controllers"; it holds the shared state fields, then the shared getters and methods. The controller instance fields a controller reads (`_scatterplotController`, `_persistenceController`, `_eatControls` here) lose `private` but stay where they are in the Controllers section, whose header says so: moving them would change the order the reactive controllers register in.

**Tests:**

- `data-controller.test.ts` (jsdom, the `mountLegendWithScatterplot` harness from `test-support/legend-scatterplot-harness.ts`, `createLocalStorageMock`, `perfCounters` mocked to a live set as `scatter-plot.resize.test.ts` does): "is the legend's data pipeline; updateItems counts one legendUpdate per _updateLegendItems call" (call `legend._updateLegendItems()` twice, expect `legendUpdate` +2 and `updateItems` called twice); "normalizeSortMode keeps a numeric annotation off categorical modes" (numeric `size-desc` → `alpha-asc`, `manual` kept; categorical `undefined` → `size-desc`).
- Every existing legend test passes; call sites of moved methods updated (`el._data.applyPersistedSettings(...)`, `el._data.syncNumericSettingsFromPersistence()`, the rebuild spy on `legend._data.rebuildItems`); tests that replace or spy on `_updateLegendItems` unchanged.
- Run: `pnpm --filter @protspace/core exec vitest --run src/components/legend` (both projects; sandbox disabled) — the legend folder is the touched code; e2e `workbench-legend.spec.ts`.
- Unrun at task time (exit): `numeric-binning.spec.ts`, `legend-double-click.spec.ts`, `mobile-legend.spec.ts`, `perf:counts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `--project unit` runs inside the sandbox; the legend folder run and anything with `--project browser` need the sandbox disabled (Vitest browser mode listens on a port). Test files are not type-checked (`packages/core/tsconfig.json` excludes `**/*.test.ts`), so the casts in them only document intent; `pnpm --filter @protspace/core type-check` checks the production code.

**Moves are move-only.** The new file's bodies are the old ones with `this.` → `this.host.` for the element's members and `this.<newName>` for a moved method calling another moved method; comments travel with their code. Do not reformat beyond Prettier. If an anchor below has moved (an earlier phase-8 task touched the file), apply the intended change to the current code and say so in the report.

- [ ] **Step 1: Write the failing controller test**

First record the legend folder's own baseline (the phase baseline has whole-suite totals only). Run (sandbox disabled) `pnpm --filter @protspace/core exec vitest --run src/components/legend` once and record the files and tests; Step 10 here, Task 8.8's legend-folder step and Task 8.9's compare against it (each later task records its own "before" the same way).

Create `packages/core/src/components/legend/controllers/data-controller.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PerfCounters from '../../../utils/perf-counters';

// A live counter set, as `scatter-plot.resize.test.ts` does: `perfCounters` is null unless the
// page URL carries `?perfCounters`.
vi.mock('../../../utils/perf-counters', async (importOriginal) => {
  const actual = await importOriginal<typeof PerfCounters>();
  return { ...actual, perfCounters: actual.createPerfCounters() };
});

import { perfCounters } from '../../../utils/perf-counters';
import type { ProtspaceLegend } from '../legend';
import { categoricalData, numericData, TWELVE } from '../test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from '../test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from '../test-support/local-storage-mock';
import { LegendDataController } from './data-controller';

vi.stubGlobal('localStorage', createLocalStorageMock());

const counters = perfCounters!;

type DataInternals = ProtspaceLegend & {
  _data: LegendDataController;
  _updateLegendItems(): void;
};

async function mount(...args: Parameters<typeof mountLegendWithScatterplot>) {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settleLegend(legend);
  return legend as DataInternals;
}

describe('LegendDataController', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it("is the legend's data pipeline; updateItems counts one legendUpdate per _updateLegendItems call", async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    expect(legend._data).toBeInstanceOf(LegendDataController);
    const updateItems = vi.spyOn(legend._data, 'updateItems');
    const before = counters.legendUpdate;

    legend._updateLegendItems();
    legend._updateLegendItems();

    // Read synchronously: the item pass runs inside the call, before any re-render.
    expect(counters.legendUpdate - before).toBe(2);
    expect(updateItems).toHaveBeenCalledTimes(2);
  });

  it('normalizeSortMode keeps a numeric annotation off categorical modes', async () => {
    const numeric = await mount(numericData([1, 2, 3, 4, 5, null]), 'length');
    expect(numeric._data.normalizeSortMode('length', 'size-desc')).toBe('alpha-asc');
    expect(numeric._data.normalizeSortMode('length', 'manual')).toBe('manual');
    expect(numeric._data.normalizeSortMode('length', undefined)).toBe('alpha-asc');
    document.body.innerHTML = '';

    const categorical = await mount(categoricalData(TWELVE), 'family');
    expect(categorical._data.normalizeSortMode('family', undefined)).toBe('size-desc');
    expect(categorical._data.normalizeSortMode('family', 'alpha-asc')).toBe('alpha-asc');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/controllers/data-controller.test.ts`

Expected: the file fails to load with `Failed to resolve import "./data-controller"` (the module does not exist yet), 0 tests run.

- [ ] **Step 3: Create the controller and export it**

Create `packages/core/src/components/legend/controllers/data-controller.ts`. The bodies are cut from `legend.ts` (Step 6 deletes them there): `_handleScatterplotDataChange` … `_ensureSortModeDefaults` (:958–1113, without `_isMultilabelAnnotation`, `_isNumericAnnotation`, `_isCurrentAnnotationNumeric` and `_hasSameProteinIds` at :1115–1134), `_rebuildLegendItems` … `_normalizeSortModeForAnnotation` (:1140–1433), `_syncNumericSettingsFromPersistence` (:493–532) and the `getCurrentSettings` callback (:305–332). One comment changes, `_applyPersistedSettings` → `applyPersistedSettings` inside `updateItems`:

```ts
import {
  DEFAULT_NUMERIC_STRATEGY,
  annotationCategoryScores,
  getNumericBinLabelMap,
  getNumericBinLowerBoundMap,
  getOrderedNumericBinIds,
  hasEatPredictionsForAnnotation,
  isAutoClusterColumn,
  isNumericAnnotation,
  materializeNumericAnnotation,
  normalizeNumericPaletteId,
  resolveNumericAnnotationDisplaySettings,
  type NumericBinningStrategy,
} from '@protspace/utils';
import { perfCounters } from '../../../utils/perf-counters';
import { LEGEND_DEFAULTS, LEGEND_VALUES, toInternalValue } from '../config';
import { computeEatPopulationCounts } from '../eat-population-counts';
import { LegendDataProcessor } from '../legend-data-processor';
import {
  SHAPE_SIZE_FILLER,
  calculatePointSize,
  defaultShapeSize,
  valueToKey,
} from '../legend-helpers';
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  resolvePersistedSettings,
  type ResolvedLegendSettings,
} from '../legend-items-state';
import type { ProtspaceLegend } from '../legend';
import type {
  LegendItem,
  LegendPersistedSettings,
  LegendSortMode,
  PersistedCategoryData,
  ScatterplotData,
} from '../types';
import type { PersistenceCallbacks } from './persistence-controller';

/**
 * The legend's data pipeline: the scatterplot's data and annotation changes, the counts, the
 * item pass and its rebuild, the stored settings' apply, the shape size, the numeric order and
 * signatures. A plain class over its element: it reads and writes the legend's state directly
 * (the members `legend.ts` lists as read and written by its controllers).
 *
 * `updateItems()` has one caller, `ProtspaceLegend._updateLegendItems()`, so
 * `perfCounters.legendUpdate` counts exactly the calls tests and the perf budgets spy on.
 */
export class LegendDataController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** The record `PersistenceController` stores for the selected annotation. */
  currentSettings(): ReturnType<PersistenceCallbacks['getCurrentSettings']> {
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();
    return {
      maxVisibleValues: this.host.maxVisibleValues,
      shapeSize: this.host._annotationShapeSize ?? SHAPE_SIZE_FILLER,
      sortMode: normalizeSortModeForType(
        this.host._annotationSortModes[this.host.selectedAnnotation],
        isNumericAnnotation,
      ),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      selectedPaletteId: isNumericAnnotation
        ? normalizeNumericPaletteId(this.host._selectedPaletteId)
        : normalizeCategoricalPaletteId(this.host._selectedPaletteId),
      numericSettings: isNumericAnnotation
        ? {
            strategy:
              this.host._numericSettingsByAnnotation[this.host.selectedAnnotation]?.strategy ??
              DEFAULT_NUMERIC_STRATEGY,
            reverseGradient:
              this.host._numericSettingsByAnnotation[this.host.selectedAnnotation]
                ?.reverseGradient ?? false,
            signature: this.host.annotationData.numericMetadata?.signature ?? '',
            topologySignature: this.host.annotationData.numericMetadata?.topologySignature ?? '',
            manualOrderIds: this.buildNumericManualOrderIds(this.host.selectedAnnotation),
          }
        : undefined,
    };
  }

  onDataChange(
    data: ScatterplotData,
    selectedAnnotation: string,
    selectedProjectionName: string,
  ): void {
    // A pending edit lands on the annotation it was made for, before the plot moves to another.
    if (selectedAnnotation !== this.host.selectedAnnotation) this.host._closeAnnotationOverlays();
    this.host._clearKeyboardReorderState();
    const scatterplot = this.host._scatterplotController.scatterplot;
    this.host._eatControls.mirrorOverlayEnabled(scatterplot?.eatOverlayEnabled ?? true);
    // The reliability slider position is legend-owned now (it drives the query
    // filter, not scatter-plot dimming), so it is preserved across data-change
    // rather than re-read from the scatter plot.
    this.host.data = {
      annotations: data.annotations,
      protein_ids: data.protein_ids,
      numeric_annotation_data: data.numeric_annotation_data,
      annotation_predicted: data.annotation_predicted,
    };
    this.host.selectedAnnotation = selectedAnnotation;
    this.host.annotationData = {
      name: selectedAnnotation,
      values: data.annotations[selectedAnnotation].values,
      colors: data.annotations[selectedAnnotation].colors,
      shapes: data.annotations[selectedAnnotation].shapes,
      kind: data.annotations[selectedAnnotation].kind,
      sourceKind: data.annotations[selectedAnnotation].sourceKind,
      numericMetadata: data.annotations[selectedAnnotation].numericMetadata,
      runtime: data.annotations[selectedAnnotation].runtime,
    };
    this.updateAnnotationValues(data, selectedAnnotation);
    this.host._eatCounts = computeEatPopulationCounts(
      data,
      selectedAnnotation,
      this.host._eatControls.overlayEnabled,
    );
    // Taken from the unsliced element, not from the incoming payload.
    // `sliceWith` in utils strips `statisticsRows` from a filtered or isolated
    // view on purpose (a slice must not carry scores that describe the whole dataset), so
    // reading them off `data` made every filter look identical to "this annotation was never
    // scored" -- which is why this used to need a sticky per-annotation memory to tell the two
    // apart. The scores are whole-dataset facts about the annotation, so the legend reads them
    // from the whole dataset and decides separately whether to plot them (`_renderScoreStrips`).
    // Same escape hatch the dataset hash in `updated()` already uses, and the same source the
    // sibling projection-metadata panel is handed.
    const statisticsRows = scatterplot?.data?.statisticsRows ?? data.statisticsRows;
    this.host._categoryScores = annotationCategoryScores(
      statisticsRows,
      selectedAnnotation,
      selectedProjectionName,
    );
    this.host._isClusterAnnotation = isAutoClusterColumn(statisticsRows, selectedAnnotation);
    this.host.proteinIds = data.protein_ids;

    // Sync isolation state
    const { isolationMode, isolationHistory } =
      this.host._scatterplotController.getIsolationState();

    // Save visible values before entering isolation so "Other" items stay grouped
    if (isolationMode && !this.host.isolationMode) {
      this.host._preIsolationVisibleValues = this.host._visibleValues;
    }

    this.host.isolationMode = isolationMode;
    this.host.isolationHistory = isolationHistory;
  }

  onAnnotationChange(annotation: string): void {
    // A value still being typed belongs to the annotation it was typed for.
    this.host._closeAnnotationOverlays();
    this.host._clearKeyboardReorderState();
    this.host.selectedAnnotation = annotation;
    this.host._hiddenValues = [];
    // Reset pre-isolation visible values so the new annotation uses maxVisibleValues
    // instead of being constrained to the old annotation's visible set
    if (this.host.isolationMode) {
      this.host._preIsolationVisibleValues = new Set<string>();
    }
    this.host._scatterplotController.forceSync();
  }

  refreshAnnotationData(): void {
    const annotationInfo = this.host.data?.annotations?.[this.host.selectedAnnotation] ?? null;
    this.host.annotationData = annotationInfo
      ? {
          name: this.host.selectedAnnotation,
          values: annotationInfo.values,
          colors: annotationInfo.colors,
          shapes: annotationInfo.shapes,
          kind: annotationInfo.kind,
          sourceKind: annotationInfo.sourceKind,
          numericMetadata: annotationInfo.numericMetadata,
          runtime: annotationInfo.runtime,
        }
      : { name: '', values: [] };
  }

  private updateAnnotationValues(data: ScatterplotData, selectedAnnotation: string): void {
    this.host._countSource = {
      colData: data.annotation_data[selectedAnnotation],
      values: data.annotations[selectedAnnotation].values,
      proteinCount: data.protein_ids.length,
    };
  }

  /**
   * Legend counts, isolation applied: from the synced storage, or from the public
   * `annotationValues` array when there is none. Either way the processor only ever
   * sees the counted map.
   *
   * Recomputed per rebuild rather than cached: the bincount is ~2 ms at 573K,
   * cheaper than the array scan it replaces, and it depends on the isolation
   * state, which changes independently of the storage.
   */
  private computeAnnotationCounts(knownValues: string[]): ReadonlyMap<string, number> {
    const isolating = this.host.isolationMode && this.host.isolationHistory?.length > 0;
    const filteredIndices = isolating
      ? LegendDataProcessor.getFilteredIndices(
          true,
          this.host.isolationHistory,
          this.host.proteinIds,
        )
      : null;
    const source = this.host._countSource;
    if (!source) {
      // The array holds one value per protein in `proteinIds` order, so the filter's
      // protein indices address it directly.
      return LegendDataProcessor.countAnnotationFrequencies(
        this.host.annotationValues,
        filteredIndices,
        knownValues,
      );
    }
    // Protein order while host-driven, the order a per-protein `annotationValues` feed
    // gives, so the legend comes out the same whether its host feeds it or it counts the
    // synced storage. Tied counts keep this order, which settles their rows and colours.
    return LegendDataProcessor.countFromStorage(
      source.colData,
      source.values,
      source.proteinCount,
      filteredIndices,
      knownValues,
      this.host._hostDriven,
    );
  }

  hasSelectedEatAnnotation(): boolean {
    const stableData = this.host._scatterplotController.scatterplot?.data ?? this.host.data;
    return hasEatPredictionsForAnnotation(stableData, this.host.selectedAnnotation);
  }

  ensureSortModeDefaults(): void {
    const annotationNames = this.host.data?.annotations
      ? Object.keys(this.host.data.annotations)
      : [];
    if (annotationNames.length === 0) return;

    const updated: Record<string, LegendSortMode> = { ...this.host._annotationSortModes };
    for (const aname of annotationNames) {
      updated[aname] = this.normalizeSortMode(aname, updated[aname]);
    }
    this.host._annotationSortModes = updated;
  }

  /**
   * Rebuild legend items and apply persisted z-order.
   * Use when forcing a full rebuild outside the updated() lifecycle.
   */
  rebuildItems(): void {
    if (perfCounters) perfCounters.legendRebuild++;
    this.host._updateLegendItems();

    if (
      !this.host._isNumericAnnotation() &&
      this.host._persistenceController.hasPendingCategories()
    ) {
      this.host._legendItems = this.host._persistenceController.applyPendingZOrder(
        this.host._legendItems,
      );
    }
  }

  private getPersistedCategoriesForProcessing(): Record<string, PersistedCategoryData> {
    if (!this.host._isNumericAnnotation()) {
      return this.host._persistenceController.pendingCategories;
    }

    return {};
  }

  private getNumericOrderValues(): Map<string, number> {
    return getNumericBinLowerBoundMap(this.host.annotationData);
  }

  buildNumericManualOrderIds(annotationName: string): string[] | undefined {
    if (!annotationName) return undefined;
    const manualOrderIds = this.host._numericManualOrderIdsByAnnotation[annotationName];
    if (manualOrderIds?.length) {
      return manualOrderIds;
    }

    if (annotationName !== this.host.selectedAnnotation || !this.host._isNumericAnnotation()) {
      return undefined;
    }

    return numericOrderFromItems(this.host._legendItems);
  }

  setNumericManualOrderIds(annotationName: string, orderIds: string[] | undefined): void {
    if (!annotationName) return;

    if (!orderIds || orderIds.length === 0) {
      const rest = { ...this.host._numericManualOrderIdsByAnnotation };
      delete rest[annotationName];
      this.host._numericManualOrderIdsByAnnotation = rest;
      return;
    }

    this.host._numericManualOrderIdsByAnnotation = {
      ...this.host._numericManualOrderIdsByAnnotation,
      [annotationName]: [...orderIds],
    };
  }

  updateItems(): void {
    if (perfCounters) perfCounters.legendUpdate++;
    // Aligned with PersistenceController's isNumericAnnotation callback so the
    // processor and the persistence layer agree on numeric-ness in transient states.
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();
    // Ahead of the bincount below, which is O(proteins) and has nothing to count for
    // an annotation with no values at all.
    if (!this.host.annotationData?.values?.length) {
      this.host._legendItems = [];
      return;
    }
    const knownValues = isNumericAnnotation
      ? this.host.annotationData.values.map((value) => toInternalValue(value))
      : [];
    const frequencies = this.computeAnnotationCounts(knownValues);
    if (!isNumericAnnotation && frequencies.size === 0) {
      this.host._legendItems = [];
      return;
    }

    try {
      // Get persisted categories from persistence controller
      const persistedCategories = this.getPersistedCategoriesForProcessing();

      // Get pending values for extract/merge operations
      // undefined = no pending operation, string = value (including '__NA__' for N/A)
      const pendingExtract = this.host._pendingExtractValue;
      const pendingMerge = this.host._pendingMergeValue;

      // Use visibleValues to preserve the current visible set when:
      // - There are persisted settings in localStorage
      // - There are pending extract/merge operations
      // - There are already legend items (e.g., switching sort mode before persistence)
      // When none of these apply (true initial load), use empty set so maxVisibleValues is respected.
      const hasPendingOps = pendingExtract !== undefined || pendingMerge !== undefined;
      const hasExistingItems = this.host._legendItems.some((i) => i.value !== LEGEND_VALUES.OTHER);
      const visibleValues = this.host.isolationMode
        ? this.host._preIsolationVisibleValues
        : this.host._persistenceController.hasPersistedSettings() ||
            hasPendingOps ||
            hasExistingItems
          ? this.host._visibleValues
          : new Set<string>();
      const numericOrderValues = this.getNumericOrderValues();
      const numericDisplayLabels = getNumericBinLabelMap(this.host.annotationData);
      const numericManualOrderIds = isNumericAnnotation
        ? (this.buildNumericManualOrderIds(this.host.selectedAnnotation) ?? [])
        : [];
      const existingLegendItems =
        isNumericAnnotation && this.host._currentSortMode.startsWith('manual')
          ? getOrderedNumericBinIds(this.host.annotationData, 'manual', numericManualOrderIds).map(
              (id, index) => ({
                value: id,
                displayValue: numericDisplayLabels.get(id) ?? id,
                color: '',
                shape: 'circle',
                count: 0,
                isVisible: true,
                zOrder: index,
              }),
            )
          : this.host._legendItems;

      const { legendItems, otherItems } = LegendDataProcessor.processLegendItems(
        this.host._processorContext,
        this.host.annotationData.name || this.host.selectedAnnotation,
        frequencies,
        this.host.maxVisibleValues,
        this.host.isolationMode,
        existingLegendItems,
        this.host._currentSortMode,
        persistedCategories,
        visibleValues,
        numericOrderValues,
        !isNumericAnnotation,
        pendingExtract,
        pendingMerge,
        isNumericAnnotation,
      );

      // Apply hidden values
      if (this.host._hiddenValues.length > 0) {
        this.host._legendItems = legendItems.map((item: LegendItem) => ({
          ...item,
          isVisible: !this.host._hiddenValues.includes(valueToKey(item.value)),
        }));
      } else {
        this.host._legendItems = legendItems;
      }
      this.host._otherItems = otherItems;

      if (isNumericAnnotation) {
        // Only once the annotation itself reads as numeric: a plot-side numeric column whose
        // legend data has not caught up yet keeps the processor's labels and colours.
        if (this.host._isNumericAnnotation()) {
          this.host._legendItems = applyDerivedNumericColors(
            applyNumericDisplayLabels(this.host._legendItems, this.host.annotationData),
            this.host.annotationData,
          );
        }
      } else if (this.host._selectedPaletteId !== 'kellys') {
        this.host._legendItems = applyPaletteColors(
          this.host._legendItems,
          this.host._selectedPaletteId,
        );
      }

      // Clear pending extract/merge values after they've been applied
      this.host._pendingExtractValue = undefined;
      this.host._pendingMergeValue = undefined;
      // Note: We do NOT clear pendingCategories here because subsequent update cycles
      // (triggered by property changes in applyPersistedSettings) may rebuild legend items
      // and need the persisted colors/shapes. Categories are cleared when loadSettings()
      // is called for a new annotation.

      // Sync with scatterplot
      this.host._scatterplotController.dispatchZOrderChange();
      this.host._scatterplotController.dispatchColorMappingChange();
      this.host._scatterplotController.syncOtherValues();
      this.host._scatterplotController.syncHiddenValues();
    } catch (error) {
      this.host._dispatchError(
        'Failed to process legend data',
        'data-processing',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  applyPersistedSettings(settings: LegendPersistedSettings): void {
    try {
      const resolved: ResolvedLegendSettings = resolvePersistedSettings(settings, {
        isNumeric: this.host._isCurrentAnnotationNumeric(),
        liveNumeric: this.host._numericSettingsByAnnotation[this.host.selectedAnnotation],
        signatures: (binCount, strategy, paletteId, reverseGradient) =>
          this.computeNumericSettingsSignatures(binCount, strategy, paletteId, reverseGradient),
      });

      if (resolved.clearPendingCategories) {
        this.host._persistenceController.clearPendingCategories();
      }
      this.host.maxVisibleValues = resolved.maxVisibleValues;
      this.host._annotationShapeSize = resolved.annotationShapeSize;
      this.host.shapeSize = this.resolveShapeSize();
      this.host._hiddenValues = resolved.hiddenValues;
      this.host._selectedPaletteId = resolved.paletteId;

      if (resolved.numeric) {
        const { manualOrderIds, ...numericSettings } = resolved.numeric;
        this.host._numericSettingsByAnnotation = {
          ...this.host._numericSettingsByAnnotation,
          [this.host.selectedAnnotation]: numericSettings,
        };
        this.setNumericManualOrderIds(this.host.selectedAnnotation, manualOrderIds);
      }

      this.host._annotationSortModes = {
        ...this.host._annotationSortModes,
        [this.host.selectedAnnotation]: resolved.sortMode,
      };

      this.host._enableDuplicateStackUI = resolved.enableDuplicateStackUI === true;
      this.host._scatterplotController.updateConfig({
        pointSize: calculatePointSize(this.host.shapeSize),
        enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      });
      this.host._scatterplotController.syncNumericAnnotationSettings();
    } catch (error) {
      this.host._dispatchError(
        'Failed to apply persisted settings',
        'persistence',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * The dataset's stored size (picked, or a bundle's top-level size), else the annotation's own,
   * else the default from the dataset's protein count; capped at the dialog's bound.
   */
  resolveShapeSize(): number {
    return Math.min(
      this.host._persistenceController.loadShapeSize() ??
        this.host._annotationShapeSize ??
        defaultShapeSize(this.host._datasetProteinCount),
      LEGEND_DEFAULTS.maxSymbolSize,
    );
  }

  /**
   * Forget the dataset's picked size and every annotation's own, so the default from the
   * protein count applies; that default is never stored.
   */
  clearShapeSize(): void {
    this.host._persistenceController.clearShapeSize(Object.keys(this.host.data?.annotations ?? {}));
    this.host._annotationShapeSize = null;
    this.host.shapeSize = this.resolveShapeSize();
  }

  private computeNumericSettingsSignatures(
    binCount: number,
    strategy: NumericBinningStrategy,
    paletteId: string,
    reverseGradient: boolean,
  ): { signature: string | null; topologySignature: string | null } {
    const rawNumericValues =
      this.host._scatterplotController.scatterplot?.data?.numeric_annotation_data?.[
        this.host.selectedAnnotation
      ] ?? this.host.data?.numeric_annotation_data?.[this.host.selectedAnnotation];

    if (!rawNumericValues) {
      return {
        signature: this.host.annotationData.numericMetadata?.signature ?? null,
        topologySignature: this.host.annotationData.numericMetadata?.topologySignature ?? null,
      };
    }

    const metadata = materializeNumericAnnotation(rawNumericValues, {
      binCount,
      strategy,
      paletteId,
      reverseGradient,
    }).annotation.numericMetadata;
    return {
      signature: metadata?.signature ?? null,
      topologySignature: metadata?.topologySignature ?? null,
    };
  }

  normalizeSortMode(annotationName: string, sortMode: LegendSortMode | undefined): LegendSortMode {
    const annotation =
      this.host.data?.annotations?.[annotationName] ??
      (annotationName === this.host.selectedAnnotation ? this.host.annotationData : undefined);
    const isNumeric = isNumericAnnotation(annotation);

    return normalizeSortModeForType(sortMode, isNumeric);
  }

  syncNumericSettingsFromPersistence(): void {
    const annotationEntries = Object.entries(this.host.data?.annotations ?? {});
    if (annotationEntries.length === 0) {
      return;
    }

    const persistedSettings = this.host.getAllPersistedSettings();
    const nextNumericSettings = { ...this.host._numericSettingsByAnnotation };
    let didChange = false;

    for (const [annotationName, annotation] of annotationEntries) {
      if (!isNumericAnnotation(annotation)) {
        continue;
      }

      const persisted = persistedSettings[annotationName];
      const { settings: nextSettings } = resolveNumericAnnotationDisplaySettings({
        persistedSettings: persisted,
        liveSettings: nextNumericSettings[annotationName],
        defaultBinCount: LEGEND_DEFAULTS.maxVisibleValues,
      });

      const currentSettings = nextNumericSettings[annotationName];
      if (
        !currentSettings ||
        currentSettings.binCount !== nextSettings.binCount ||
        currentSettings.strategy !== nextSettings.strategy ||
        currentSettings.paletteId !== nextSettings.paletteId ||
        currentSettings.reverseGradient !== nextSettings.reverseGradient
      ) {
        nextNumericSettings[annotationName] = nextSettings;
        didChange = true;
      }
    }

    if (didChange) {
      this.host._numericSettingsByAnnotation = nextNumericSettings;
      this.host._scatterplotController.syncNumericAnnotationSettings();
    }
  }
}
```

In `packages/core/src/components/legend/controllers/index.ts`, after `export { DragController } from './drag-controller';` add a blank line and:

```ts
export { LegendDataController } from './data-controller';
```

- [ ] **Step 4: legend.ts imports**

In `packages/core/src/components/legend/legend.ts` (the moved code took these imports with it):

Delete:

```ts
import { perfCounters } from '../../utils/perf-counters';
```

Replace:

```ts
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  getNumericBinLabelMap,
  getNumericBinLowerBoundMap,
  getOrderedNumericBinIds,
  isNumericAnnotation,
  materializeNumericAnnotation,
  normalizeNumericPaletteId,
  resolveNumericAnnotationDisplaySettings,
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  hasEatPredictionsForAnnotation,
  isPredictedAnnotation,
  getAnnotationMeta,
  annotationCategoryScores,
  isAutoClusterColumn,
  type NumericBinningStrategy,
  type NumericAnnotationDisplaySettingsMap,
  type EatReliabilityState,
  type CategoryScore,
} from '@protspace/utils';
```

with:

```ts
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  isNumericAnnotation,
  normalizeNumericPaletteId,
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  isPredictedAnnotation,
  getAnnotationMeta,
  type NumericAnnotationDisplaySettingsMap,
  type EatReliabilityState,
  type CategoryScore,
} from '@protspace/utils';
```

Replace:

```ts
  toDisplayValue,
  toInternalValue,
} from './config';
```

with:

```ts
  toDisplayValue,
} from './config';
```

Replace:

```ts
import { ScatterplotSyncController, PersistenceController, DragController } from './controllers';
```

with:

```ts
import {
  ScatterplotSyncController,
  PersistenceController,
  DragController,
  LegendDataController,
} from './controllers';
```

Replace:

```ts
import {
  LegendDataProcessor,
  createProcessorContext,
  type LegendProcessorContext,
} from './legend-data-processor';
```

with:

```ts
import { createProcessorContext, type LegendProcessorContext } from './legend-data-processor';
```

Replace:

```ts
  defaultShapeSize,
  SHAPE_SIZE_FILLER,
  getDefaultSortMode,
```

with:

```ts
  defaultShapeSize,
  getDefaultSortMode,
```

Replace:

```ts
import { computeEatPopulationCounts, type EatPopulationCounts } from './eat-population-counts';
```

with:

```ts
import type { EatPopulationCounts } from './eat-population-counts';
```

Replace:

```ts
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  displayedOrder,
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

with:

```ts
import {
  applyPaletteColors,
  displayedOrder,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
} from './legend-items-state';
```

Replace:

```ts
  OtherItem,
  ScatterplotData,
  LegendPersistedSettings,
  PersistedCategoryData,
```

with:

```ts
  OtherItem,
  PersistedCategoryData,
```

- [ ] **Step 5: legend.ts state: one section for what the controllers read and write**

Replace everything from the `// Internal State` section header (its first rule line, `  // ─────…` right after `autoHide: boolean = true;`) through the closing `  });` of `private _persistenceController = new PersistenceController(this, {` (today :192–333) with the block below. What it does: the state only the element uses stays private under "Internal State"; the state the data pipeline reads or writes moves, keeping its decorators and doc comments, under the new section without `private`; the getters `_hostDriven`, `_currentSortMode`, `_visibleValues` and the methods `_updateLegendItems` (now the one-line delegate), `_isNumericAnnotation`, `_isCurrentAnnotationNumeric`, `_closeAnnotationOverlays`, `_clearKeyboardReorderState`, `_dispatchError` follow in the same section (Step 6 deletes them where they were); `_data` heads the Controllers section; `_scatterplotController` and `_persistenceController` lose `private` and call `_data`.

```ts
  // ─────────────────────────────────────────────────────────────────
  // Internal State
  // ─────────────────────────────────────────────────────────────────

  @state() private _sortedLegendItems: LegendItem[] = [];
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() private _sortMenu: HTMLElement | null = null;
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() private _settingsAnchor: HTMLElement | null = null;
  @state() private _statusMessage = '';
  /**
   * Category under the pointer, from a legend row or from a score strip. Read by
   * `_renderLegendItem` (the row's `legend-item-score-hover` class) and by `_renderScoreStrips`
   * (each strip's `highlighted` binding), so a hover in either place lights up both.
   */
  @state() private _hoveredCategory: string | null = null;
  private _announceManualPromotionOnNextReorder = false;

  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;
  // Touch: the last tap on a row (a second one soon after isolates), the pointer behind the last
  // row click (a dblclick after touch taps is ignored) and the last row press (older Safari sends
  // clicks with no pointer type).
  private _lastTap: { valueKey: string; time: number } | null = null;
  private _lastClickPointer = 'mouse';
  private _lastRowPointerDown: { pointerType: string; time: number } | null = null;

  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  @query('protspace-legend-settings-popover')
  private _settingsPopover?: ProtspaceLegendSettingsPopover;

  // ─────────────────────────────────────────────────────────────────
  // Read and written by the legend's controllers (controllers/*); not public API.
  // ─────────────────────────────────────────────────────────────────

  @state() _legendItems: LegendItem[] = [];
  @state() _otherItems: OtherItem[] = [];
  @state() _hiddenValues: string[] = [];
  @state() _annotationSortModes: Record<string, LegendSortMode> = {};
  _preIsolationVisibleValues: Set<string> = new Set();
  /**
   * "Show duplicate counts and spread overlaps" for the selected annotation. Live state: the
   * stored record reads it, so an unrelated save never writes false over a stored true.
   */
  @state() _enableDuplicateStackUI = false;
  @state() _selectedPaletteId = 'kellys';
  @state() _numericSettingsByAnnotation: NumericAnnotationDisplaySettingsMap = {};
  @state() _numericManualOrderIdsByAnnotation: Record<string, string[]> = {};
  @state() _eatCounts: EatPopulationCounts | null = null;
  @state() _categoryScores: CategoryScore[] = [];
  /**
   * Whether the current annotation is one of the backend's auto-clustering membership
   * columns, whose separation scores are optimistic by construction. Derived alongside
   * `_categoryScores` because both need `statisticsRows`, which render time does not see.
   */
  @state() _isClusterAnnotation = false;
  /**
   * The annotation storage the legend counts from, captured on every scatterplot
   * data change. Counting straight out of it (`countFromStorage`) replaces the
   * flat `annotationValues` array, which cost one interned string per protein
   * and misaligned isolation filtering. `null` means "no synced storage": a host
   * that feeds the public `annotationValues` property instead.
   */
  _countSource: {
    colData: AnnotationData;
    values: (string | null)[];
    proteinCount: number;
  } | null = null;

  // Pending extract/merge values for next update cycle.
  // undefined = no pending operation, string = value to extract/merge (including '__NA__' for N/A)
  _pendingExtractValue: string | undefined = undefined;
  _pendingMergeValue: string | undefined = undefined;

  /**
   * Protein count of the whole dataset, taken with its hash in `updated()` from the same
   * unfiltered data, so a filter, an isolation or hidden categories never change it. It sets
   * the default shape size.
   */
  _datasetProteinCount = 0;

  /**
   * The selected annotation's own shape size from a bundle or browser storage, or null when it
   * holds a filler. Its persisted record keeps this, never the live size, so neither a picked
   * size nor the computed default is ever stored or exported as the annotation's own.
   */
  _annotationShapeSize: number | null = null;

  // Instance-specific processor context (avoids global state conflicts)
  _processorContext: LegendProcessorContext = createProcessorContext();

  /** `autoSync` is off; its doc lists what that changes. */
  get _hostDriven(): boolean {
    return !this.autoSync;
  }

  get _currentSortMode(): LegendSortMode {
    return this._data.normalizeSortMode(
      this.selectedAnnotation,
      this._annotationSortModes[this.selectedAnnotation],
    );
  }

  /**
   * Get the set of currently visible values (from legend items, excluding "Other").
   * Used to preserve membership when sort mode changes.
   * N/A items use '__NA__' as their value.
   */
  get _visibleValues(): Set<string> {
    const visible = new Set<string>();

    // Collect visible values from current _legendItems (excluding "Other")
    if (this._legendItems.length > 0) {
      this._legendItems.forEach((item) => {
        if (item.value !== LEGEND_VALUES.OTHER) {
          visible.add(item.value);
        }
      });
    }

    // If visible is empty but we have pendingCategories, use those instead.
    // This handles the case where _legendItems only has "Other" during restore.
    if (visible.size === 0) {
      const pendingCategories = this._persistenceController.pendingCategories;
      if (Object.keys(pendingCategories).length > 0) {
        for (const key of Object.keys(pendingCategories)) {
          if (key !== LEGEND_VALUES.OTHER) {
            visible.add(key);
          }
        }
      }
    }

    return visible;
  }

  /**
   * The one entry to the item pass. `LegendDataController.updateItems` has no other caller, so
   * `perfCounters.legendUpdate` counts exactly these calls, the ones tests spy on and replace.
   */
  _updateLegendItems(): void {
    this._data.updateItems();
  }

  _isNumericAnnotation(): boolean {
    return isNumericAnnotation(this.annotationData);
  }

  _isCurrentAnnotationNumeric(): boolean {
    const sourceAnnotation =
      this._scatterplotController.scatterplot?.data?.annotations?.[this.selectedAnnotation];
    return isNumericAnnotation(sourceAnnotation) || this._isNumericAnnotation();
  }

  /** Closes the annotation's own overlays, landing their pending edits on it first. */
  _closeAnnotationOverlays(): void {
    this._closeSettings();
    this._colorPicker.close();
  }

  _clearKeyboardReorderState(): void {
    this._keyboard.clear();
    this._announceManualPromotionOnNextReorder = false;
  }

  _dispatchError(message: string, source: LegendErrorSource, originalError?: Error): void {
    const detail: LegendErrorEventDetail = createLegendErrorEventDetail(message, source, {
      annotation: this.selectedAnnotation || undefined,
      originalError,
    });
    this.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.ERROR, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    console.error(`[protspace-legend] ${source}: ${message}`, originalError);
  }

  // ─────────────────────────────────────────────────────────────────
  // Controllers (a field without `private` is read by controllers/* too; not public API)
  // ─────────────────────────────────────────────────────────────────

  /** The data pipeline (controllers/data-controller.ts); the callbacks below call it. */
  readonly _data = new LegendDataController(this);

  _scatterplotController = new ScatterplotSyncController(this, {
    onDataChange: (data, annotation, projectionName) =>
      this._data.onDataChange(data, annotation, projectionName),
    onAnnotationChange: (annotation) => this._data.onAnnotationChange(annotation),
    getHiddenValues: () => this._hiddenValues,
    getOtherItems: () => this._otherItems,
    getLegendItems: () => this._legendItems,
    getOtherConcreteValues: () => computeOtherConcreteValues(this._otherItems),
    getAutoHide: () => this.autoHide,
    getNumericAnnotationSettings: () => this._numericSettingsByAnnotation,
    getAnnotationSortModes: () => this._annotationSortModes,
    getNumericManualOrderIds: () => this._numericManualOrderIdsByAnnotation,
  });

  _persistenceController = new PersistenceController(this, {
    onSettingsLoaded: (settings) => this._data.applyPersistedSettings(settings),
    getLegendItems: () => this._legendItems,
    getHiddenValues: () => this._hiddenValues,
    shouldPersistCategories: () => !this._isCurrentAnnotationNumeric(),
    shouldPersistCategoryEncodings: () => !this._isCurrentAnnotationNumeric(),
    isNumericAnnotation: () => this._isCurrentAnnotationNumeric(),
    getCurrentSettings: () => this._data.currentSettings(),
  });
```

- [ ] **Step 6: legend.ts call sites and the moved bodies**

`_eatControls` is read by the controller:

Replace:

```ts
  private _eatControls = new EatReliabilityController(this, {
```

with:

```ts
  _eatControls = new EatReliabilityController(this, {
```

The drag controller's numeric order:

Replace:

```ts
        this._setNumericManualOrderIds(this.selectedAnnotation, numericOrderFromItems(items));
```

with:

```ts
        this._data.setNumericManualOrderIds(this.selectedAnnotation, numericOrderFromItems(items));
```

`_clearKeyboardReorderState` is in the shared section now; delete its old copy (between `_canDragLegendItem` and `_restoreKeyboardReorderSnapshot`):

Delete:

```ts
  private _clearKeyboardReorderState(): void {
    this._keyboard.clear();
    this._announceManualPromotionOnNextReorder = false;
  }
```

In `_restoreKeyboardReorderSnapshot`:

Replace:

```ts
      this._setNumericManualOrderIds(this.selectedAnnotation, snapshot.numericManualOrderIds);
```

with:

```ts
      this._data.setNumericManualOrderIds(this.selectedAnnotation, snapshot.numericManualOrderIds);
```

Delete the method `private _syncNumericSettingsFromPersistence(): void {` (today :493–532) through its closing `}` and the blank line after it; it is `LegendDataController.syncNumericSettingsFromPersistence` now.

In `_commitManualOrderFromVisibleValues`:

Replace:

```ts
    if (this._isNumericAnnotation()) {
      this._setNumericManualOrderIds(this.selectedAnnotation, visibleOrder);
```

with:

```ts
    if (this._isNumericAnnotation()) {
      this._data.setNumericManualOrderIds(this.selectedAnnotation, visibleOrder);
```

In the "Computed Properties" section delete the getters `_currentSortMode` (:593–598), `_hostDriven` (:606–609) and `_visibleValues` (:611–642) with their doc comments; they are in the shared section now. `_annotationDisplayName` stays where it is.

In `updated()`:

Replace:

```ts
      this._updateAnnotationDataFromData();
      this._ensureSortModeDefaults();
```

with:

```ts
      this._data.refreshAnnotationData();
      this._data.ensureSortModeDefaults();
```

Replace:

```ts
      this._syncNumericSettingsFromPersistence();
    }
```

with:

```ts
      this._data.syncNumericSettingsFromPersistence();
    }
```

Replace:

```ts
      changedProperties.has('isolationHistory')
    ) {
      this._rebuildLegendItems();
    }
```

with:

```ts
      changedProperties.has('isolationHistory')
    ) {
      this._data.rebuildItems();
    }
```

In `setFileSettings`:

Replace:

```ts
      this._legendItems = [];
      this._rebuildLegendItems();
    }
```

with:

```ts
      this._legendItems = [];
      this._data.rebuildItems();
    }
```

The pipeline itself. Delete from `  private _handleScatterplotDataChange(` (today :958) through the closing `}` of `_ensureSortModeDefaults` (`    this._annotationSortModes = updated;` then `  }`, today :1113) and the blank line after it: `_handleScatterplotDataChange`, `_handleAnnotationChange`, `_updateAnnotationDataFromData`, `_updateAnnotationValues`, `_computeAnnotationCounts` (with its doc comment), `_hasSelectedEatAnnotation`, `_ensureSortModeDefaults`. Then the two numeric helpers that moved to the shared section leave their old place, and `_isMultilabelAnnotation` and `_hasSameProteinIds` stay:

Replace:

```ts
  private _isMultilabelAnnotation(): boolean {
    return this._scatterplotController.isMultilabelAnnotation(this.selectedAnnotation);
  }

  private _isNumericAnnotation(): boolean {
    return isNumericAnnotation(this.annotationData);
  }

  private _isCurrentAnnotationNumeric(): boolean {
    const sourceAnnotation =
      this._scatterplotController.scatterplot?.data?.annotations?.[this.selectedAnnotation];
    return isNumericAnnotation(sourceAnnotation) || this._isNumericAnnotation();
  }
```

with:

```ts
  private _isMultilabelAnnotation(): boolean {
    return this._scatterplotController.isMultilabelAnnotation(this.selectedAnnotation);
  }
```

Delete from the `// Legend Item Processing` section header (its first rule line, today :1136) through the closing `}` of `_normalizeSortModeForAnnotation` (`    return normalizeSortModeForType(sortMode, isNumeric);` then `  }`, today :1433) and the blank line after it. That removes the "Legend Item Processing" and "Settings Persistence" headers and `_rebuildLegendItems`, `_getPersistedCategoriesForProcessing`, `_getNumericOrderValues`, `_buildNumericManualOrderIds`, `_setNumericManualOrderIds`, `_updateLegendItems`, `_applyPersistedSettings`, `_resolveShapeSize`, `_clearShapeSize`, `_computeNumericSettingsSignatures`, `_normalizeSortModeForAnnotation`. The "Item Interactions" header that follows stays.

In `_reverseZOrder` and `_applySortMode`:

Replace:

```ts
      this._setNumericManualOrderIds(
        this.selectedAnnotation,
        [...this._sortedLegendItems]
```

with:

```ts
      this._data.setNumericManualOrderIds(
        this.selectedAnnotation,
        [...this._sortedLegendItems]
```

Replace:

```ts
      if (isNumeric) this._setNumericManualOrderIds(this.selectedAnnotation, shown);
```

with:

```ts
      if (isNumeric) this._data.setNumericManualOrderIds(this.selectedAnnotation, shown);
```

`_dispatchError` and `_closeAnnotationOverlays` are in the shared section now; delete their old copies (after `_announceStatus`, and under "Settings Popover"):

Delete:

```ts
  private _dispatchError(message: string, source: LegendErrorSource, originalError?: Error): void {
    const detail: LegendErrorEventDetail = createLegendErrorEventDetail(message, source, {
      annotation: this.selectedAnnotation || undefined,
      originalError,
    });
    this.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.ERROR, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    console.error(`[protspace-legend] ${source}: ${message}`, originalError);
  }
```

Delete:

```ts
  /** Closes the annotation's own overlays, landing their pending edits on it first. */
  private _closeAnnotationOverlays(): void {
    this._closeSettings();
    this._colorPicker.close();
  }
```

In `_applyDisplaySettings` and `_handleSettingsReset`:

Replace:

```ts
        // An emptied size field returns the dataset to its default, as Reset does for the size.
        this._clearShapeSize();
```

with:

```ts
        // An emptied size field returns the dataset to its default, as Reset does for the size.
        this._data.clearShapeSize();
```

Replace:

```ts
    this.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this._clearShapeSize();
```

with:

```ts
    this.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this._data.clearShapeSize();
```

Replace:

```ts
      this._setNumericManualOrderIds(this.selectedAnnotation, undefined);
```

with:

```ts
      this._data.setNumericManualOrderIds(this.selectedAnnotation, undefined);
```

In `render()` and `_renderScoreStrips`:

Replace:

```ts
        ${this._hasSelectedEatAnnotation()
```

with:

```ts
        ${this._data.hasSelectedEatAnnotation()
```

Replace:

```ts
      // scores themselves are read from the unsliced dataset (see `_handleScatterplotDataChange`)
```

with:

```ts
      // scores themselves are read from the unsliced dataset (see `LegendDataController.onDataChange`)
```

Then check nothing still calls a moved name on the element:

```bash
grep -nE "_(handleScatterplotDataChange|handleAnnotationChange|updateAnnotationDataFromData|updateAnnotationValues|computeAnnotationCounts|hasSelectedEatAnnotation|ensureSortModeDefaults|rebuildLegendItems|getPersistedCategoriesForProcessing|getNumericOrderValues|buildNumericManualOrderIds|setNumericManualOrderIds|applyPersistedSettings|resolveShapeSize|clearShapeSize|computeNumericSettingsSignatures|normalizeSortModeForAnnotation|syncNumericSettingsFromPersistence)\b" packages/core/src/components/legend/legend.ts
```

Expected: no output.

- [ ] **Step 7: Comments that name the moved methods**

In `packages/core/src/components/legend/controllers/persistence-controller.ts` (the doc comment of `applyPendingZOrder`, :381–383), replace:

```ts
   * Note: This method does NOT clear pendingCategories because subsequent update
   * cycles (triggered by property changes in _applyPersistedSettings) need them
   * for _visibleValues to work correctly. Categories are naturally overwritten
```

with:

```ts
   * Note: This method does NOT clear pendingCategories because subsequent update
   * cycles (triggered by property changes in `LegendDataController.applyPersistedSettings`)
   * need them for _visibleValues to work correctly. Categories are naturally overwritten
```

In `packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts` (:256), replace:

```ts
   * (see legend `_handleScatterplotDataChange` / `processLegendItems`). So an active
```

with:

```ts
   * (see `LegendDataController.onDataChange` / `processLegendItems`). So an active
```

In `apps/web/src/explore/data-renderer.ts` (:152, a comment only), replace:

```ts
    // order (its `_computeAnnotationCounts`), which picks the rows and colours of tied
```

with:

```ts
    // order (`LegendDataController.computeAnnotationCounts`), which picks the rows and colours of tied
```

- [ ] **Step 8: The tests' call sites**

In `packages/core/src/components/legend/legend.numeric-settings.test.ts`, in `type LegendTestElement`, replace:

```ts
  _applyPersistedSettings: (settings: LegendPersistedSettings) => void;
  _syncNumericSettingsFromPersistence: () => void;
```

with:

```ts
  _data: {
    applyPersistedSettings: (settings: LegendPersistedSettings) => void;
    syncNumericSettingsFromPersistence: () => void;
  };
```

then replace `    el._applyPersistedSettings({` with `    el._data.applyPersistedSettings({` and `    el._syncNumericSettingsFromPersistence();` with `    el._data.syncNumericSettingsFromPersistence();` (one each). The `_updateLegendItems = vi.fn()` and `_dispatchLegendStateChange = vi.fn()` stubs stay (the controller calls `this.host._updateLegendItems()`, so the stub still catches it; Task 8.8 removes the event stubs).

In `packages/core/src/components/legend/legend.settings.browser.test.ts`, replace:

```ts
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
```

with:

```ts
/**
 * Counts the item passes: `perfCounters.legendUpdate` and `legendRebuild` are incremented once
 * each, at the start of `LegendDataController.updateItems` (reached only through the element's
 * `_updateLegendItems`) and `rebuildItems`, so the spies count what the perf budgets count.
 */
function spies(legend: ProtspaceLegend) {
  const internals = legend as unknown as {
    _updateLegendItems(): void;
    _data: { rebuildItems(): void };
  };
  return {
    update: vi.spyOn(internals, '_updateLegendItems'),
    rebuild: vi.spyOn(internals._data, 'rebuildItems'),
  };
}
```

Then make sure no legend test still names a moved method:

```bash
grep -rnE "_(handleScatterplotDataChange|rebuildLegendItems|applyPersistedSettings|syncNumericSettingsFromPersistence|normalizeSortModeForAnnotation|setNumericManualOrderIds|buildNumericManualOrderIds|clearShapeSize|resolveShapeSize)\b" packages/core/src/components/legend --include="*.test.ts"
```

Expected: no output.

- [ ] **Step 9: Run the new test, the type-check and the linters**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/controllers/data-controller.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @protspace/core type-check`
Expected: no errors. (A "declared but never read" error names an import Step 4 should have removed; a "Property '…' is private" error names a member Step 5 missed: drop its `private` and move it into the shared section.)

Run: `pnpm exec eslint packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/data-controller.ts packages/core/src/components/legend/controllers/data-controller.test.ts packages/core/src/components/legend/controllers/index.ts`
Expected: no errors.

Run: `pnpm exec prettier --write packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/data-controller.ts packages/core/src/components/legend/controllers/data-controller.test.ts` then `git diff --stat` (Prettier only re-wraps; no line of a moved body changes beyond wrapping).

- [ ] **Step 10: The legend folder, both projects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run src/components/legend`
Expected: every file passes; the count is the baseline's legend-folder count plus 2 (`data-controller.test.ts`). Record before/after counts. If a test fails, the move drifted: compare the failing path's body with the original in `git show HEAD:packages/core/src/components/legend/legend.ts`; do not change the test's assertion.

- [ ] **Step 11: The one e2e spec**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-legend.spec.ts`
Expected: all pass (same count as the baseline).

- [ ] **Step 12: Developer docs**

In `docs/developers/architecture.md`, in the legend's module table, replace the `legend.ts` row's text `Properties, state, controller wiring, lifecycle, public API, the data pipeline and item actions` with `Properties, state, controller wiring, lifecycle, render, public API, item actions, keyboard reorder and settings`, and add this row directly under it:

```md
| `controllers/data-controller.ts` | `LegendDataController`: the data pipeline (data and annotation changes, counts, the item pass and its rebuild, stored settings, shape size, numeric order). Takes the element as its host |
```

Under "### Reactive Controllers Pattern", replace the paragraph and list:

```md
Communication between controllers and host component happens through callback interfaces, enabling:

- Testability (controllers can be tested in isolation)
- Reusability (controllers can be used by other components)
- Maintainability (concerns are clearly separated)
```

with:

```md
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
element's fields (`host._data`, …), never by import, and every item pass goes through
`ProtspaceLegend._updateLegendItems()`, the one call `perfCounters.legendUpdate` counts.
```

Two older sentences in the same file stop being true once four controllers are plain classes. Directly after the legend's module table, replace:

```md
Templates take explicit view models and handlers; controllers are Lit reactive controllers that
keep their own transient state and timers; the pure functions return new arrays that `legend.ts`
assigns before it syncs the plot.
```

with:

```md
Templates take explicit view models and handlers; the controllers beside the templates are Lit
reactive controllers that keep their own transient state and timers, and the `controllers/` classes
that hold the legend's own logic are plain classes over the element (below); the pure functions
return new arrays that `legend.ts` assigns before it syncs the plot.
```

and under "### Reactive Controllers Pattern" replace:

```md
Controllers implement Lit's `ReactiveController` interface:
```

with:

```md
The callback-based controllers implement Lit's `ReactiveController` interface:
```

Run: `pnpm exec prettier --write docs/developers/architecture.md` (it re-pads the table's columns), then `pnpm exec prettier --check docs/developers/architecture.md apps/web/src/explore/data-renderer.ts packages/core/src/components/legend/controllers/persistence-controller.ts packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.settings.browser.test.ts packages/core/src/components/legend/controllers/index.ts`.
Expected: all files pass.

- [ ] **Step 13: Line counts and the moved-member map**

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/data-controller.ts`
Expected: `legend.ts` about 1,660, `data-controller.ts` about 590 (under 800).

The report carries this moved-member map (part B re-homes `main`'s edits with it):

| `ProtspaceLegend` (before) | `controllers/data-controller.ts` `LegendDataController` |
| --- | --- |
| `_handleScatterplotDataChange` | `onDataChange` |
| `_handleAnnotationChange` | `onAnnotationChange` |
| `_updateAnnotationDataFromData` | `refreshAnnotationData` |
| `_updateAnnotationValues` | `updateAnnotationValues` (private) |
| `_computeAnnotationCounts` | `computeAnnotationCounts` (private) |
| `_hasSelectedEatAnnotation` | `hasSelectedEatAnnotation` |
| `_ensureSortModeDefaults` | `ensureSortModeDefaults` |
| `_rebuildLegendItems` | `rebuildItems` |
| `_getPersistedCategoriesForProcessing` | `getPersistedCategoriesForProcessing` (private) |
| `_getNumericOrderValues` | `getNumericOrderValues` (private) |
| `_buildNumericManualOrderIds` | `buildNumericManualOrderIds` |
| `_setNumericManualOrderIds` | `setNumericManualOrderIds` |
| `_updateLegendItems` (body) | `updateItems` (the element keeps `_updateLegendItems` as a one-line delegate) |
| `_applyPersistedSettings` | `applyPersistedSettings` |
| `_resolveShapeSize` | `resolveShapeSize` |
| `_clearShapeSize` | `clearShapeSize` |
| `_computeNumericSettingsSignatures` | `computeNumericSettingsSignatures` (private) |
| `_normalizeSortModeForAnnotation` | `normalizeSortMode` |
| `_syncNumericSettingsFromPersistence` | `syncNumericSettingsFromPersistence` |
| `_persistenceController`'s `getCurrentSettings` callback | `currentSettings` |

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/components/legend/controllers/data-controller.ts packages/core/src/components/legend/controllers/data-controller.test.ts packages/core/src/components/legend/controllers/index.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.settings.browser.test.ts packages/core/src/components/legend/controllers/persistence-controller.ts packages/core/src/components/legend/controllers/scatterplot-sync-controller.ts apps/web/src/explore/data-renderer.ts docs/developers/architecture.md
git commit -m "refactor(core): move the legend's data pipeline into a controller"
```

(Sandbox disabled for the commit; the hook runs type-check, knip and the docs build. Knip: `LegendDataController` is imported by `legend.ts` through `controllers/index.ts` and by its test.)

Report: the legend-folder counts before and after, `data-controller.test.ts` 2, `workbench-legend.spec.ts` count, the moved-member map above, `wc -l legend.ts`, and any anchor that had moved.

### Task 8.8: Legend: item actions and keyboard reorder move into controllers; the unused event goes

Row clicks, double-clicks, extract and merge with Other, the drop highlight, sort mode and order direction (`legend.ts` :1443–1681) move into `ItemActionsController`; the keyboard reorder's commit, move, restore and clear (:454–592) and the drag callbacks' bodies move into `ReorderController`. `protspace-legend-state-change`, which nothing listens to, is deleted with its dispatcher, its seven calls and the two test stubs.

**Files:**

- Create: `packages/core/src/components/legend/controllers/item-actions-controller.ts`
- Create: `packages/core/src/components/legend/controllers/reorder-controller.ts`
- Create: `packages/core/src/components/legend/controllers/reorder-controller.test.ts`
- Modify: `packages/core/src/components/legend/controllers/index.ts`
- Modify: `packages/core/src/components/legend/legend.ts`
- Modify: `packages/core/src/components/legend/controllers/data-controller.ts` (its two `_clearKeyboardReorderState()` calls become `_reorder.clear()`)
- Modify: legend tests calling a moved method (`legend-extract.test.ts` `_handleExtractFromOther`, `_handleExtractAllFromOther`; `legend.rows.test.ts` `_toggleLegendOrderDirection`; `legend.score-strips.test.ts`, `legend.score-sync.test.ts` and `legend.sort-menu.browser.test.ts` `_applySortMode`; `legend.shape-size.test.ts` `_handleItemClick`; the `_dispatchLegendStateChange` stubs in `legend.numeric-settings.test.ts` :34, :83 and `legend.shape-size.test.ts` :31, :65 deleted)
- Modify (comment only): `packages/core/src/components/legend/legend-data-processor.ts` (:556 names `_reverseZOrder`)
- Modify: `docs/developers/architecture.md` (two table rows; `legend.ts` row)

**Interfaces:**

- Consumes: Task 8.7's `LegendDataController` through the host (`this.host._data.setNumericManualOrderIds(annotationName, orderIds)`) and `this.host._updateLegendItems()`; Task 8.7's shared section in `legend.ts` (`// Read and written by the legend's controllers (controllers/*); not public API.`) and the members it already holds; `ProtspaceLegend` members the moved code also touches, made non-private here: `_sortedLegendItems`, `_announceManualPromotionOnNextReorder`, `_lastRowPointerDown` (the row template's `onPointerDown` still writes it), the getter `_annotationDisplayName`, the methods `_dispatchItemAction`, `_announceStatus` (all moved into the shared section), and the controller fields `_keyboard`, `_otherPopover` (lose `private`, stay in place); `LegendReorderSnapshot` (`legend-list.ts`), `LegendKeyboardController` callbacks `toggle`, `isolate`, `snapshot`, `restore`, `move`; `DragCallbacks` (`controllers/drag-controller.ts`) `setLegendItems`, `onMergeToOther`, `onSortModeChange`, `onDropComplete`.
- Produces:
  - `ItemActionsController` (`constructor(private readonly host: ProtspaceLegend)`): `rowClick(value: string, event: MouseEvent): void` ← `_handleItemMouseClick`; `rowDoubleClick(value: string): void` ← `_handleItemMouseDoubleClick`; `toggle(value: string): void` ← `_handleItemClick`; `isolate(value: string, items?: LegendItem[]): void` ← `_handleItemDoubleClick`; `extractFromOther(value: string): void`; `extractAllFromOther(): void`; `mergeToOther(value: string): void`; `highlightDropped(value: string): Promise<void>` ← `_highlightDroppedItem`; `applySortMode(mode: LegendSortMode): void`; `toggleOrderDirection(): void` ← `_toggleLegendOrderDirection`; private `isolateFromFirstClick`, `reverseZOrder`. The click-pairing state `_firstClick`, `_lastTap`, `_lastClickPointer` moves in as private fields (nothing on the element reads it); `_lastRowPointerDown` stays on the element.
  - `ReorderController` (`constructor(private readonly host: ProtspaceLegend)`): `clear(): void` ← `_clearKeyboardReorderState`; `restore(snapshot: LegendReorderSnapshot): void` ← `_restoreKeyboardReorderSnapshot`; `move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null` ← `_moveFocusedManualItem`; `snapshot(): LegendReorderSnapshot` (the `LegendKeyboardController` `snapshot` callback body); `setItemsFromDrag(items: LegendItem[]): void` and `onDragSortModeChange(mode: LegendSortMode): void` (the `DragController` `setLegendItems` and `onSortModeChange` callback bodies); private `commitManualOrder(orderedValues: string[]): boolean` ← `_commitManualOrderFromVisibleValues`.
  - `ProtspaceLegend`: fields `readonly _actions = new ItemActionsController(this)`, `readonly _reorder = new ReorderController(this)` right after `_data`; the `DragController`, `LegendKeyboardController`, `LegendRowMenu`, `OtherPopoverControl` and sort-menu handler objects call these (`toggle: (v) => this._actions.toggle(v)`, `restore: (s) => this._reorder.restore(s)`, `setLegendItems: (items) => this._reorder.setItemsFromDrag(items)`, …); row templates call `this._actions.rowClick` / `rowDoubleClick` / `toggle`; `clearForNewDataset`, `_openSettings` and `LegendDataController.onDataChange`/`onAnnotationChange` call `_reorder.clear()`.
  - Deleted: `_dispatchLegendStateChange` and every call; the event name appears nowhere in the repo.

**Tests:**

- `reorder-controller.test.ts` (jsdom, the harness): "move promotes a sorted list to manual and moves the row one place"; "restore after a move puts the order back and keeps a colour changed meanwhile" (the phase-3 A4 rule).
- Every existing legend test passes with the call sites moved to `_actions`/`_reorder`; `legend.escape-order.browser.test.ts`, `legend.keyboard-reorder.test.ts`, `controllers/drag-controller.test.ts` unchanged and green.
- `grep -rn "protspace-legend-state-change\|_dispatchLegendStateChange" packages apps docs` (node_modules and build output excluded) prints nothing.
- Run: the legend folder (both projects, sandbox disabled); e2e `legend-double-click.spec.ts`.
- Unrun at task time (exit): `workbench-legend.spec.ts`, `mobile-legend.spec.ts`, `numeric-binning.spec.ts`, `workbench-escape.spec.ts`, `perf:counts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`; the legend-folder run, `--project browser`, the e2e run and the commits need the sandbox disabled. Moves are move-only, as in Task 8.7: bodies keep their comments, `this.` becomes `this.host.` for the element's members, a moved method calling another moved method in the same controller calls `this.<newName>`, and one in another controller goes through the host field (`this.host._reorder.clear()`). Anchors are quoted as Task 8.7 leaves the file; if one has moved, apply the intended change and say so.

Two commits: the event first (Steps 1–4), then the move (Steps 5–19).

- [ ] **Step 1: Find the event and its stubs**

Run: `grep -rn "protspace-legend-state-change\|_dispatchLegendStateChange" packages apps docs --exclude-dir=node_modules --exclude-dir=dist`
Expected (the check this commit makes pass): 13 lines: in `legend.ts` the dispatcher (2 lines: its declaration and the event name) and 7 calls; `legend.numeric-settings.test.ts` :34 and :83; `legend.shape-size.test.ts` :31 and :65.

- [ ] **Step 2: Delete the dispatcher and its seven calls**

In `packages/core/src/components/legend/legend.ts` delete the method (between `_restoreKeyboardReorderSnapshot` and `_commitManualOrderFromVisibleValues`) and the blank line after it:

```ts
  private _dispatchLegendStateChange(): void {
    window.dispatchEvent(
      new CustomEvent('protspace-legend-state-change', {
        detail: {
          annotation: this.selectedAnnotation,
          scatterplotSelector: this.scatterplotSelector,
        },
      }),
    );
  }
```

Then delete the line `this._dispatchLegendStateChange();` (with its indentation) in each of: `_dragController`'s `onReorder` callback, `_restoreKeyboardReorderSnapshot`, `_commitManualOrderFromVisibleValues`, `_reverseZOrder`, `_applySortMode`, `_toggleLegendOrderDirection` (inside its numeric `if`) and `_applyDisplaySettings`. Nothing else in those methods changes. `scatterplotSelector` stays: `connectedCallback` reads it.

- [ ] **Step 3: Delete the two test stubs**

In `packages/core/src/components/legend/legend.numeric-settings.test.ts` delete `  _dispatchLegendStateChange: () => void;` (in `type LegendTestElement`) and `    el._dispatchLegendStateChange = vi.fn();` (in `configureNumeric`). In `packages/core/src/components/legend/legend.shape-size.test.ts` delete `  _dispatchLegendStateChange: () => void;` (in `type ShapeSizeLegend`) and `  el._dispatchLegendStateChange = vi.fn();` (in `makeLegend`).

Run: `grep -rn "protspace-legend-state-change\|_dispatchLegendStateChange" packages apps docs --exclude-dir=node_modules --exclude-dir=dist`
Expected: no output.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.numeric-settings.test.ts src/components/legend/legend.shape-size.test.ts src/components/legend/legend.keyboard-reorder.test.ts src/components/legend/legend.rows.test.ts` and `pnpm --filter @protspace/core type-check`
Expected: all pass with the baseline counts; no type errors.

- [ ] **Step 4: Commit the event's removal**

```bash
pnpm exec prettier --check packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.shape-size.test.ts
git add packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.shape-size.test.ts
git commit -m "refactor(core): drop the legend state event nobody listens to"
```

(Sandbox disabled for the commit.)

- [ ] **Step 5: Write the failing reorder test**

Create `packages/core/src/components/legend/controllers/reorder-controller.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtspaceLegend } from '../legend';
import { categoricalData, TWELVE } from '../test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from '../test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from '../test-support/local-storage-mock';
import { ReorderController } from './reorder-controller';

vi.stubGlobal('localStorage', createLocalStorageMock());

async function setup(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
  await settleLegend(legend);
  return legend;
}

const reorder = (legend: ProtspaceLegend) =>
  (legend as unknown as { _reorder: ReorderController })._reorder;
const order = (legend: ProtspaceLegend) =>
  Array.from(legend.shadowRoot!.querySelectorAll<HTMLElement>('.legend-item')).map(
    (row) => row.dataset.value,
  );
const sortMode = (legend: ProtspaceLegend) => legend.getAllPersistedSettings().family.sortMode;

describe('ReorderController', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('move promotes a sorted list to manual and moves the row one place', async () => {
    const legend = await setup();
    expect(reorder(legend)).toBeInstanceOf(ReorderController);
    expect(order(legend).slice(0, 3)).toEqual(['A', 'B', 'C']);

    const first = reorder(legend).move('B', -1);
    await settleLegend(legend);

    expect(first?.moved.value).toBe('B');
    expect(first?.promoted).toBe(true);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'A', 'C']);
    expect(sortMode(legend)).toBe('manual');

    // Already manual: the next move promotes nothing, and the top row cannot move up.
    expect(reorder(legend).move('A', 1)?.promoted).toBe(false);
    await settleLegend(legend);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'C', 'A']);
    expect(reorder(legend).move('B', -1)).toBeNull();
  });

  it('restore after a move puts the order back and keeps a colour changed meanwhile', async () => {
    const legend = await setup();
    // Manual first, so nothing re-derives the rows after the restore (as
    // legend.escape-order.browser.test.ts does).
    reorder(legend).move('B', -1);
    await settleLegend(legend);
    const snapshot = reorder(legend).snapshot();

    reorder(legend).move('C', -1);
    await settleLegend(legend);
    expect(order(legend).slice(0, 3)).toEqual(['B', 'C', 'A']);
    legend._legendItems = legend._legendItems.map((item) =>
      item.value === 'A' ? { ...item, color: '#00ff00' } : item,
    );
    await settleLegend(legend);

    reorder(legend).restore(snapshot);
    await settleLegend(legend);

    expect(order(legend).slice(0, 3)).toEqual(['B', 'A', 'C']);
    expect(sortMode(legend)).toBe('manual');
    expect(legend._legendItems.find((item) => item.value === 'A')?.color).toBe('#00ff00');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/controllers/reorder-controller.test.ts`
Expected: the file fails to load with `Failed to resolve import "./reorder-controller"`, 0 tests run.

- [ ] **Step 7: Create the two controllers and export them**

Create `packages/core/src/components/legend/controllers/item-actions-controller.ts`. The methods are cut from `legend.ts`'s "Item Interactions" section (Step 12 deletes them there), from `_handleItemMouseClick` through `_toggleLegendOrderDirection`; the click-pairing fields come from the element's "Internal State" with their comment (the part about the last row press stays on the element with `_lastRowPointerDown`):

```ts
import { LEGEND_VALUES, toDisplayValue } from '../config';
import type { ProtspaceLegend } from '../legend';
import {
  clickPointerType,
  isDoubleTap,
  isolateItem,
  isolationBase,
  isSecondClickOfDouble,
  updateItemsVisibility,
  valueToKey,
  type FirstClick,
} from '../legend-helpers';
import {
  displayedOrder,
  normalizeSortModeForType,
  reorderByValues,
  reverseKeepingOtherLast,
  reverseSortMode,
} from '../legend-items-state';
import type { LegendItem, LegendSortMode } from '../types';

/**
 * What a row, the Other popover and the sort menu do to the legend: toggle, isolate, extract
 * from and merge into Other, the drop highlight, the sort mode and the order direction. A plain
 * class over its element: it reads and writes the legend's state directly (the members
 * `legend.ts` lists as read and written by its controllers).
 */
export class ItemActionsController {
  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;
  // Touch: the last tap on a row (a second one soon after isolates) and the pointer behind the
  // last row click (a dblclick after touch taps is ignored).
  private _lastTap: { valueKey: string; time: number } | null = null;
  private _lastClickPointer = 'mouse';

  constructor(private readonly host: ProtspaceLegend) {}

  /**
   * Toggles, except on the second click of a mouse double-click (`isSecondClickOfDouble`). The
   * second of two quick taps on one row isolates it (`isDoubleTap`), as a double-click does.
   */
  rowClick(value: string, event: MouseEvent): void {
    const valueKey = valueToKey(value);
    const pointerType = clickPointerType(event, this.host._lastRowPointerDown);
    this._lastClickPointer = pointerType;
    if (isSecondClickOfDouble(this._firstClick, valueKey, { detail: event.detail, pointerType })) {
      return;
    }
    if (isDoubleTap(this._lastTap, { valueKey, time: event.timeStamp, pointerType })) {
      this._lastTap = null;
      this.isolateFromFirstClick(value);
      return;
    }
    const touch = pointerType === 'touch' || pointerType === 'pen';
    this._lastTap = touch ? { valueKey, time: event.timeStamp } : null;

    const itemsBefore = this.host._legendItems;
    this.toggle(value);
    this._firstClick =
      event.detail === 1 ? { valueKey, itemsBefore, itemsAfter: this.host._legendItems } : null;
  }

  rowDoubleClick(value: string): void {
    // Touch and pen double taps isolated on their second tap already.
    if (this._lastClickPointer === 'touch' || this._lastClickPointer === 'pen') return;
    this.isolateFromFirstClick(value);
  }

  private isolateFromFirstClick(value: string): void {
    const first = this._firstClick;
    this._firstClick = null;
    this.isolate(value, isolationBase(first, valueToKey(value), this.host._legendItems));
  }

  toggle(value: string): void {
    const valueKey = valueToKey(value);
    const result = updateItemsVisibility(this.host._legendItems, this.host._hiddenValues, valueKey);

    this.host._legendItems = result.items;
    this.host._hiddenValues = result.hiddenValues;

    const item = this.host._legendItems.find((i) => valueToKey(i.value) === valueKey);
    this.host._announceStatus(`${toDisplayValue(value)} ${item?.isVisible ? 'shown' : 'hidden'}`);

    this.host._scatterplotController.syncHiddenValues();
    this.host._dispatchItemAction(value, 'toggle');
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  isolate(value: string, items: LegendItem[] = this.host._legendItems): void {
    const result = isolateItem(items, value);

    this.host._legendItems = result.items;
    this.host._hiddenValues = result.hiddenValues;

    const visibleCount = result.items.filter((i) => i.isVisible).length;
    this.host._announceStatus(
      visibleCount === 1 ? `Isolated ${toDisplayValue(value)}` : 'All items shown',
    );

    this.host._scatterplotController.syncHiddenValues();
    this.host._dispatchItemAction(value, 'isolate');
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  extractFromOther(value: string): void {
    // Set pending extract value - will be used by processor to add this item to visible set
    this.host._pendingExtractValue = value;

    // Increase maxVisibleValues to accommodate the extracted item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.host.maxVisibleValues = this.host.maxVisibleValues + 1;

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the extract operation.

    this.host._announceStatus(`Extracted ${toDisplayValue(value)} from Other category`);
    this.host._dispatchItemAction(value, 'extract');
    // Save settings after the update cycle completes
    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  extractAllFromOther(): void {
    const nonOtherCount = this.host._legendItems.filter(
      (i) => i.value !== LEGEND_VALUES.OTHER,
    ).length;
    const targetMaxVisibleValues = nonOtherCount + this.host._otherItems.length;

    this.host._otherPopover.close();

    this.host._announceStatus('Extracted all items from Other category');
    for (const item of this.host._otherItems) {
      this.host._dispatchItemAction(item.value, 'extract');
    }
    this.host.maxVisibleValues = targetMaxVisibleValues;

    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  mergeToOther(value: string): void {
    // Set pending merge value - will be used by processor to remove this item from visible set
    this.host._pendingMergeValue = value;

    // Decrease maxVisibleValues to remove space for the merged item
    // This triggers updated() which calls _updateLegendItems() with pending value still set
    this.host.maxVisibleValues = Math.max(1, this.host.maxVisibleValues - 1);

    // Don't call _updateLegendItems() explicitly - the maxVisibleValues change will trigger
    // updated() which calls it. If we call it here, it will be called twice and the
    // pending value will be cleared after the first call, causing the second call to not
    // respect the merge operation.

    this.host._announceStatus(`Moved ${toDisplayValue(value)} to Other category`);
    // Save settings after the update cycle completes
    this.host.updateComplete.then(() => {
      this.host._persistenceController.saveSettings();
    });
  }

  async highlightDropped(value: string): Promise<void> {
    // Wait for Lit to render the new item order. The second await covers an update that the
    // first one's `updated()` schedules (the data pipeline still writes state there).
    await this.host.updateComplete;
    await this.host.updateComplete;

    const items = this.host.shadowRoot?.querySelectorAll('.legend-item');
    if (!items) return;

    for (const el of items) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.getAttribute('data-value') === value) {
        htmlEl.classList.add('legend-item-just-dropped');
        // The handle, as before the main button moved ahead of it in the row; Other has no usable one.
        const focusTarget =
          htmlEl.querySelector<HTMLElement>('.drag-handle:not(:disabled)') ??
          htmlEl.querySelector<HTMLElement>('.legend-item-main');
        focusTarget?.focus();
        this.host._announceStatus(
          this.host._announceManualPromotionOnNextReorder
            ? `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}. Switched ${this.host._annotationDisplayName} to Manual order.`
            : `Moved ${htmlEl.dataset.displayValue ?? toDisplayValue(value)}.`,
        );
        this.host._announceManualPromotionOnNextReorder = false;
        htmlEl.addEventListener(
          'animationend',
          () => {
            htmlEl.classList.remove('legend-item-just-dropped');
          },
          { once: true },
        );
        break;
      }
    }
  }

  private reverseZOrder(): void {
    if (this.host._legendItems.length <= 1) return;

    const currentMode = this.host._currentSortMode;
    if (
      this.host._isNumericAnnotation() &&
      currentMode === 'manual' &&
      !this.host._numericManualOrderIdsByAnnotation[this.host.selectedAnnotation]?.length
    ) {
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        [...this.host._sortedLegendItems]
          .filter((item) => item.value !== LEGEND_VALUES.OTHER)
          .map((item) => item.value),
      );
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: reverseSortMode(currentMode),
    };

    if (!this.host._isNumericAnnotation()) {
      // Always reverse the visible items directly, keeping "Other" at the end.
      this.host._legendItems = reverseKeepingOtherLast(this.host._legendItems);
    } else {
      this.host._updateLegendItems();
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /**
   * Applies a sort-menu pick at once and stores it, as the settings dialog's Save applied an
   * order. "Your order" starts from the order on screen, whatever sorted it.
   */
  applySortMode(mode: LegendSortMode): void {
    const isNumeric = this.host._isCurrentAnnotationNumeric();
    const next = normalizeSortModeForType(mode, isNumeric);
    this.host._keyboard.clear();
    if (next === 'manual' && !this.host._currentSortMode.startsWith('manual')) {
      const shown = displayedOrder(this.host._sortedLegendItems, isNumeric);
      if (isNumeric) this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, shown);
      else this.host._legendItems = reorderByValues(this.host._legendItems, shown);
    }
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: next,
    };
    this.host._updateLegendItems();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
  }

  toggleOrderDirection(): void {
    if (this.host._legendItems.length <= 1) return;
    this.host._reorder.clear();

    if (this.host._isNumericAnnotation() && !this.host._currentSortMode.startsWith('manual')) {
      const nextMode: LegendSortMode =
        this.host._currentSortMode === 'alpha-desc' ? 'alpha-asc' : 'alpha-desc';
      this.host._annotationSortModes = {
        ...this.host._annotationSortModes,
        [this.host.selectedAnnotation]: nextMode,
      };
      this.host._updateLegendItems();
      this.host._scatterplotController.syncNumericAnnotationSettings();
      this.host._persistenceController.saveSettings();
      this.host.requestUpdate();
      return;
    }

    this.reverseZOrder();
  }
}
```

Create `packages/core/src/components/legend/controllers/reorder-controller.ts`. `restore`, `commitManualOrder` and `move` are cut from `legend.ts` (`_restoreKeyboardReorderSnapshot`, `_commitManualOrderFromVisibleValues`, `_moveFocusedManualItem`); `clear` is the shared section's `_clearKeyboardReorderState`; `snapshot`, `setItemsFromDrag` and `onDragSortModeChange` are the bodies of the `_keyboard` `snapshot` callback and the `_dragController` `setLegendItems` and `onSortModeChange` callbacks:

```ts
import { LEGEND_VALUES } from '../config';
import type { ProtspaceLegend } from '../legend';
import type { LegendReorderSnapshot } from '../legend-list';
import { numericOrderFromItems, reorderByValues } from '../legend-items-state';
import type { LegendItem, LegendSortMode } from '../types';

/**
 * The legend's side of a reorder: the keyboard reorder's snapshot, move, restore and clear
 * (`LegendKeyboardController` calls them through the legend), and what a drag commits
 * (`DragController`'s item and sort-mode callbacks). A plain class over its element: it reads
 * and writes the legend's state directly (the members `legend.ts` lists as read and written by
 * its controllers).
 */
export class ReorderController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** Drops a keyboard reorder in progress and the pending "switched to manual" announcement. */
  clear(): void {
    this.host._keyboard.clear();
    this.host._announceManualPromotionOnNextReorder = false;
  }

  /** What Escape puts back: the order, the sort mode and the numeric manual order. */
  snapshot(): LegendReorderSnapshot {
    return {
      annotation: this.host.selectedAnnotation,
      sortMode: this.host._currentSortMode,
      legendItems: this.host._legendItems.map((item) => ({ ...item })),
      otherItems: this.host._otherItems.map((item) => ({ ...item })),
      numericManualOrderIds: this.host._isNumericAnnotation()
        ? [...(this.host._numericManualOrderIdsByAnnotation[this.host.selectedAnnotation] ?? [])]
        : undefined,
    };
  }

  restore(snapshot: LegendReorderSnapshot): void {
    if (snapshot.annotation !== this.host.selectedAnnotation) {
      this.clear();
      return;
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: snapshot.sortMode,
    };
    if (this.host._isNumericAnnotation()) {
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        snapshot.numericManualOrderIds,
      );
    }
    // Only the order goes back: colour, shape and visibility set during the reorder stay.
    const live = new Map(this.host._legendItems.map((item) => [item.value, item]));
    this.host._legendItems = snapshot.legendItems.map((item) => ({
      ...(live.get(item.value) ?? item),
      zOrder: item.zOrder,
    }));
    this.host._otherItems = snapshot.otherItems.map((item) => ({ ...item }));
    this.clear();

    if (!snapshot.sortMode.startsWith('manual')) {
      this.host._updateLegendItems();
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._scatterplotController.syncOtherValues();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /** Returns whether the move switched the annotation to manual order. */
  private commitManualOrder(orderedValues: string[]): boolean {
    const visibleOrder = [...orderedValues];
    const didPromote = !this.host._currentSortMode.startsWith('manual');
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: 'manual',
    };

    if (this.host._isNumericAnnotation()) {
      this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, visibleOrder);
      this.host._updateLegendItems();
    } else {
      this.host._legendItems = reorderByValues(this.host._legendItems, visibleOrder);
    }

    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchZOrderChange();
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
    return didPromote;
  }

  move(value: string, direction: -1 | 1): { moved: LegendItem; promoted: boolean } | null {
    const orderedItems = this.host._sortedLegendItems.filter(
      (item) => item.value !== LEGEND_VALUES.OTHER,
    );
    const currentIndex = orderedItems.findIndex((item) => item.value === value);
    if (currentIndex === -1) return null;

    const nextIndex = Math.max(0, Math.min(orderedItems.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return null;

    const reordered = [...orderedItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const promoted = this.commitManualOrder(reordered.map((item) => item.value));
    return { moved, promoted };
  }

  /** A drag's new order: the items, and for a numeric annotation its stored manual order. */
  setItemsFromDrag(items: LegendItem[]): void {
    this.host._legendItems = items;
    if (this.host._isNumericAnnotation()) {
      // Exclude Other (synthetic) and NA (locked to legend end regardless of
      // sort) from the persisted manual order — they have no observable
      // position effect and would clutter the saved state.
      this.host._data.setNumericManualOrderIds(
        this.host.selectedAnnotation,
        numericOrderFromItems(items),
      );
    }
  }

  /** A drag switched the sort mode (to manual). */
  onDragSortModeChange(mode: LegendSortMode): void {
    this.host._announceManualPromotionOnNextReorder =
      mode === 'manual' && !this.host._currentSortMode.startsWith('manual');
    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: mode,
    };
    this.host._keyboard.clear();
    this.host._scatterplotController.syncNumericAnnotationSettings();
  }
}
```

In `packages/core/src/components/legend/controllers/index.ts`, after `export { LegendDataController } from './data-controller';` add:

```ts

export { ItemActionsController } from './item-actions-controller';

export { ReorderController } from './reorder-controller';
```

- [ ] **Step 8: legend.ts imports**

Replace:

```ts
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  LEGEND_EVENTS,
  toDisplayValue,
} from './config';
```

with:

```ts
import { LEGEND_DEFAULTS, LEGEND_STYLES, LEGEND_VALUES, LEGEND_EVENTS } from './config';
```

Replace:

```ts
  DragController,
  LegendDataController,
} from './controllers';
```

with:

```ts
  DragController,
  LegendDataController,
  ItemActionsController,
  ReorderController,
} from './controllers';
```

Replace:

```ts
import {
  LegendKeyboardController,
  renderLegendList,
  TruncatedNameTooltip,
  type LegendReorderSnapshot,
} from './legend-list';
```

with:

```ts
import { LegendKeyboardController, renderLegendList, TruncatedNameTooltip } from './legend-list';
```

Replace:

```ts
import {
  valueToKey,
  calculatePointSize,
  defaultShapeSize,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  updateItemsVisibility,
  isolateItem,
  isSecondClickOfDouble,
  isolationBase,
  isDoubleTap,
  clickPointerType,
  type FirstClick,
  computeOtherConcreteValues,
} from './legend-helpers';
```

with:

```ts
import {
  calculatePointSize,
  defaultShapeSize,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  computeOtherConcreteValues,
} from './legend-helpers';
```

Replace:

```ts
import {
  applyPaletteColors,
  displayedOrder,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
} from './legend-items-state';
```

with:

```ts
import {
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  sortItemsForDisplay,
} from './legend-items-state';
```

- [ ] **Step 9: legend.ts state: the shared section grows**

`_sortedLegendItems`, `_announceManualPromotionOnNextReorder` and `_lastRowPointerDown` move from "Internal State" to the shared section; `_firstClick`, `_lastTap` and `_lastClickPointer` are `ItemActionsController`'s now:

Replace:

```ts
  @state() private _sortedLegendItems: LegendItem[] = [];
  /** The sort button
```

with:

```ts
  /** The sort button
```

Replace:

```ts
  @state() private _hoveredCategory: string | null = null;
  private _announceManualPromotionOnNextReorder = false;

  // Kept until its dblclick arrives, which isolates from `isolationBase`.
  private _firstClick: FirstClick | null = null;
  // Touch: the last tap on a row (a second one soon after isolates), the pointer behind the last
  // row click (a dblclick after touch taps is ignored) and the last row press (older Safari sends
  // clicks with no pointer type).
  private _lastTap: { valueKey: string; time: number } | null = null;
  private _lastClickPointer = 'mouse';
  private _lastRowPointerDown: { pointerType: string; time: number } | null = null;

  @query
```

with:

```ts
  @state() private _hoveredCategory: string | null = null;

  @query
```

Replace:

```ts
  @state() _legendItems: LegendItem[] = [];
  @state() _otherItems: OtherItem[] = [];
```

with:

```ts
  @state() _legendItems: LegendItem[] = [];
  @state() _sortedLegendItems: LegendItem[] = [];
  @state() _otherItems: OtherItem[] = [];
```

After `_processorContext` in the shared section (the getter `_annotationDisplayName` moves here from "Computed Properties", Step 12 deletes its old copy):

Replace:

```ts
  _processorContext: LegendProcessorContext = createProcessorContext();
```

with:

```ts
  _processorContext: LegendProcessorContext = createProcessorContext();

  _announceManualPromotionOnNextReorder = false;
  /**
   * The last press on a row: older Safari sends clicks with no pointer type, so a row click
   * (`ItemActionsController.rowClick`) takes it from here.
   */
  _lastRowPointerDown: { pointerType: string; time: number } | null = null;

  /** The selected annotation's display name, never its key (decision 15). */
  get _annotationDisplayName(): string {
    const name = this.selectedAnnotation;
    return name ? annotationLabel(name, this.data?.annotations?.[name] ?? this.annotationData) : '';
  }
```

`_clearKeyboardReorderState` is `ReorderController.clear` now; `_dispatchItemAction` and `_announceStatus` move here from "Item Interactions":

Replace:

```ts
  _clearKeyboardReorderState(): void {
    this._keyboard.clear();
    this._announceManualPromotionOnNextReorder = false;
  }
```

with:

```ts
  _dispatchItemAction(value: string, action: 'toggle' | 'isolate' | 'extract'): void {
    this.dispatchEvent(createItemActionEvent(LEGEND_EVENTS.ITEM_CLICK, value, action));
  }

  _announceStatus(message: string): void {
    this._statusMessage = message;
    // Clear after announcement to allow repeated messages
    setTimeout(() => {
      this._statusMessage = '';
    }, 1000);
  }
```

- [ ] **Step 10: legend.ts controllers and their callbacks**

Replace:

```ts
  readonly _data = new LegendDataController(this);
```

with:

```ts
  readonly _data = new LegendDataController(this);
  /** Row, Other and sort-menu actions (controllers/item-actions-controller.ts). */
  readonly _actions = new ItemActionsController(this);
  /** Keyboard reorder and what a drag commits (controllers/reorder-controller.ts). */
  readonly _reorder = new ReorderController(this);
```

Replace:

```ts
    setLegendItems: (items) => {
      this._legendItems = items;
      if (this._isNumericAnnotation()) {
        // Exclude Other (synthetic) and NA (locked to legend end regardless of
        // sort) from the persisted manual order — they have no observable
        // position effect and would clutter the saved state.
        this._data.setNumericManualOrderIds(this.selectedAnnotation, numericOrderFromItems(items));
      }
    },
    onReorder: () => {
      this._scatterplotController.dispatchZOrderChange();
      this._persistenceController.saveSettings();
    },
    onMergeToOther: (value) => this._handleMergeToOther(value),
    onSortModeChange: (mode) => {
      this._announceManualPromotionOnNextReorder =
        mode === 'manual' && !this._currentSortMode.startsWith('manual');
      this._annotationSortModes = {
        ...this._annotationSortModes,
        [this.selectedAnnotation]: mode,
      };
      this._keyboard.clear();
      this._scatterplotController.syncNumericAnnotationSettings();
    },
    onDropComplete: (value) => this._highlightDroppedItem(value),
```

with:

```ts
    setLegendItems: (items) => this._reorder.setItemsFromDrag(items),
    onReorder: () => {
      this._scatterplotController.dispatchZOrderChange();
      this._persistenceController.saveSettings();
    },
    onMergeToOther: (value) => this._actions.mergeToOther(value),
    onSortModeChange: (mode) => this._reorder.onDragSortModeChange(mode),
    onDropComplete: (value) => this._actions.highlightDropped(value),
```

Replace:

```ts
    onPick: (mode) => this._applySortMode(mode),
    onReverse: () => this._toggleLegendOrderDirection(),
```

with:

```ts
    onPick: (mode) => this._actions.applySortMode(mode),
    onReverse: () => this._actions.toggleOrderDirection(),
```

Replace:

```ts
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
```

with:

```ts
  _keyboard = new LegendKeyboardController(this, {
    getSortedItems: () => this._sortedLegendItems,
    canDrag: (item) => this._canDragLegendItem(item),
    toggle: (value) => this._actions.toggle(value),
    isolate: (value) => this._actions.isolate(value),
    snapshot: () => this._reorder.snapshot(),
    restore: (snapshot) => this._reorder.restore(snapshot),
    move: (value, direction) => this._reorder.move(value, direction),
```

Replace:

```ts
    isNumeric: () => this._isNumericAnnotation(),
    isolate: (value) => this._handleItemDoubleClick(value),
```

with:

```ts
    isNumeric: () => this._isNumericAnnotation(),
    isolate: (value) => this._actions.isolate(value),
```

Replace:

```ts
  private _otherPopover = new OtherPopoverControl(this, {
    getItems: () => this._otherItems,
    add: (value) => this._handleExtractFromOther(value),
    addAll: () => this._handleExtractAllFromOther(),
```

with:

```ts
  _otherPopover = new OtherPopoverControl(this, {
    getItems: () => this._otherItems,
    add: (value) => this._actions.extractFromOther(value),
    addAll: () => this._actions.extractAllFromOther(),
```

- [ ] **Step 11: legend.ts callers in the element**

In `clearForNewDataset`:

Replace:

```ts
    this._eatControls.mirror(DEFAULT_EAT_RELIABILITY);
    this._clearKeyboardReorderState();
```

with:

```ts
    this._eatControls.mirror(DEFAULT_EAT_RELIABILITY);
    this._reorder.clear();
```

In `_openSettings`:

Replace:

```ts
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this._clearKeyboardReorderState();
```

with:

```ts
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this._reorder.clear();
```

In `_scoreStripHandlers` and `_renderLegendItem`:

Replace:

```ts
      if (this._legendItems.some((item) => item.value === category)) {
        this._handleItemClick(category);
      }
```

with:

```ts
      if (this._legendItems.some((item) => item.value === category)) {
        this._actions.toggle(category);
      }
```

Replace:

```ts
      onClick: (e: MouseEvent) => this._handleItemMouseClick(item.value, e),
      onDoubleClick: () => this._handleItemMouseDoubleClick(item.value),
```

with:

```ts
      onClick: (e: MouseEvent) => this._actions.rowClick(item.value, e),
      onDoubleClick: () => this._actions.rowDoubleClick(item.value),
```

Replace:

```ts
      onToggle: () => this._handleItemClick(item.value),
```

with:

```ts
      onToggle: () => this._actions.toggle(item.value),
```

- [ ] **Step 12: legend.ts: the moved bodies leave**

Delete from `  private _restoreKeyboardReorderSnapshot(snapshot: LegendReorderSnapshot): void {` (right after `_canDragLegendItem`) through the closing `}` of `_moveFocusedManualItem` (`    return { moved, promoted };` then `  }`) and the blank line after it: `_restoreKeyboardReorderSnapshot`, `_commitManualOrderFromVisibleValues` (with its doc comment), `_moveFocusedManualItem`.

Delete the whole "Computed Properties" section, which now holds only `_annotationDisplayName` (in the shared section since Step 9):

Delete:

```ts
  // ─────────────────────────────────────────────────────────────────
  // Computed Properties
  // ─────────────────────────────────────────────────────────────────

  /** The selected annotation's display name, never its key (decision 15). */
  private get _annotationDisplayName(): string {
    const name = this.selectedAnnotation;
    return name ? annotationLabel(name, this.data?.annotations?.[name] ?? this.annotationData) : '';
  }
```

Delete the whole "Item Interactions" section: from its header (`  // ─────…` then `  // Item Interactions`) through the closing `}` of `_announceStatus` and the blank line after it, so the "Settings Popover" header follows `_hasSameProteinIds` directly. It held `_handleItemMouseClick` (with its doc comment), `_handleItemMouseDoubleClick`, `_isolateFromFirstClick`, `_handleItemClick`, `_handleItemDoubleClick`, `_handleExtractFromOther`, `_handleExtractAllFromOther`, `_handleMergeToOther`, `_highlightDroppedItem`, `_reverseZOrder`, `_applySortMode` (with its doc comment), `_toggleLegendOrderDirection`, and `_dispatchItemAction` and `_announceStatus`, which Step 9 put in the shared section.

Check:

```bash
grep -nE "_(handleItem|isolateFromFirstClick|handleExtract|handleMergeToOther|highlightDroppedItem|reverseZOrder|applySortMode|toggleLegendOrderDirection|clearKeyboardReorderState|restoreKeyboardReorderSnapshot|commitManualOrderFromVisibleValues|moveFocusedManualItem|firstClick|lastTap|lastClickPointer)" packages/core/src/components/legend/legend.ts
```

Expected: no output.

- [ ] **Step 13: The data controller and one comment**

In `packages/core/src/components/legend/controllers/data-controller.ts`, in both `onDataChange` and `onAnnotationChange`, replace `    this.host._clearKeyboardReorderState();` with `    this.host._reorder.clear();` (two lines).

In `packages/core/src/components/legend/legend-data-processor.ts` (:555–557), replace:

```ts
    // A categorical "Your order, reversed" holds its zOrders in display order (the legend's
    // `_reverseZOrder` writes them so): it buckets and numbers exactly as "Your order". A numeric
    // one re-derives from its manual bin ids each pass.
```

with:

```ts
    // A categorical "Your order, reversed" holds its zOrders in display order (the legend's
    // `ItemActionsController.reverseZOrder` writes them so): it buckets and numbers exactly as
    // "Your order". A numeric one re-derives from its manual bin ids each pass.
```

- [ ] **Step 14: The tests' call sites**

`packages/core/src/components/legend/legend-extract.test.ts`: after `type AnyLegend = HTMLElement & Record<string, unknown>;` add

```ts
/** The legend's item actions (controllers/item-actions-controller.ts). */
const actions = (el: AnyLegend) =>
  el._actions as { extractFromOther(value: string): void; extractAllFromOther(): void };
```

then replace every `(el as AnyLegend)._handleExtractFromOther(` with `actions(el).extractFromOther(` (6), every `(el as AnyLegend)._handleExtractAllFromOther()` with `actions(el).extractAllFromOther()` (6), `describe('_handleExtractFromOther', () => {` with `describe('extractFromOther', () => {` and `describe('_handleExtractAllFromOther', () => {` with `describe('extractAllFromOther', () => {`. `el._pendingExtractValue` stays (it is the element's).

`packages/core/src/components/legend/legend.rows.test.ts` (:219): replace

```ts
    (legend as unknown as { _toggleLegendOrderDirection(): void })._toggleLegendOrderDirection();
```

with

```ts
    (
      legend as unknown as { _actions: { toggleOrderDirection(): void } }
    )._actions.toggleOrderDirection();
```

`packages/core/src/components/legend/legend.score-strips.test.ts` (:203–204): replace

```ts
    (legend as unknown as { _applySortMode(mode: string): void })._applySortMode('silhouette-desc');
    // Same two-cycle wait legend.score-sync.test.ts documents: _applySortMode sets
```

with

```ts
    (
      legend as unknown as { _actions: { applySortMode(mode: string): void } }
    )._actions.applySortMode('silhouette-desc');
    // Same two-cycle wait legend.score-sync.test.ts documents: applySortMode sets
```

`packages/core/src/components/legend/legend.score-sync.test.ts`: replace the comment (:140–142)

```ts
    // _handleItemClick sets _legendItems; _sortedLegendItems (what the template renders)
    // only re-derives from it in the *next* updated() cycle, so this needs two chained
    // awaits, same as the existing _highlightDroppedItem (legend.ts).
```

with

```ts
    // ItemActionsController.toggle sets _legendItems; _sortedLegendItems (what the template
    // renders) only re-derives from it in the *next* updated() cycle, so this needs two chained
    // awaits, same as ItemActionsController.highlightDropped.
```

and (:219–220)

```ts
    (el as unknown as { _applySortMode(mode: string): void })._applySortMode('silhouette-desc');
    // Same two-cycle wait as the click-toggle test above: _applySortMode sets _legendItems;
```

with

```ts
    (el as unknown as { _actions: { applySortMode(mode: string): void } })._actions.applySortMode(
      'silhouette-desc',
    );
    // Same two-cycle wait as the click-toggle test above: applySortMode sets _legendItems;
```

`packages/core/src/components/legend/legend.sort-menu.browser.test.ts`: in `interface Internals` replace `  _applySortMode(mode: LegendSortMode): void;` with `  _actions: { applySortMode(mode: LegendSortMode): void };`, and every `internals(legend)._applySortMode(` with `internals(legend)._actions.applySortMode(` (6). The two `vi.spyOn(internals(legend), '_updateLegendItems')` stay.

`packages/core/src/components/legend/legend.shape-size.test.ts`: in `type ResettableLegend` delete `  _handleItemClick: (value: string) => void;`, and replace `    legend._handleItemClick('A');` with `    legend._actions.toggle('A');`.

Then:

```bash
grep -rnE "\._(handleItem|handleExtract|handleMergeToOther|applySortMode|toggleLegendOrderDirection|highlightDroppedItem|restoreKeyboardReorderSnapshot|moveFocusedManualItem|clearKeyboardReorderState)\b" packages/core/src/components/legend --include="*.test.ts"
```

Expected: no output.

- [ ] **Step 15: Run the new test, the type-check and the linters**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/controllers/reorder-controller.test.ts`
Expected: 2 passed.

Run: `pnpm --filter @protspace/core type-check`
Expected: no errors (an unused import or a "private" error points at a member or import Steps 8–9 missed).

Run: `pnpm exec eslint packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/item-actions-controller.ts packages/core/src/components/legend/controllers/reorder-controller.ts packages/core/src/components/legend/controllers/reorder-controller.test.ts packages/core/src/components/legend/controllers/data-controller.ts packages/core/src/components/legend/controllers/index.ts`
Expected: no errors.

Run: `pnpm exec prettier --write` on every file this task touched (the list in Step 19's `git add`).

- [ ] **Step 16: The legend folder, both projects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run src/components/legend`
Expected: every file passes; the count is Task 8.7's plus 2 (`reorder-controller.test.ts`). `legend.escape-order.browser.test.ts`, `legend.keyboard-reorder.test.ts` and `controllers/drag-controller.test.ts` pass without a change. A failure means the move drifted: compare the failing path with `git show HEAD:packages/core/src/components/legend/legend.ts` (the event commit of Step 4, the move's source); never change an assertion.

- [ ] **Step 17: The one e2e spec**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project legend-double-click legend-double-click.spec.ts`
Expected: all pass (the baseline's count).

- [ ] **Step 18: Developer docs**

In `docs/developers/architecture.md`, change the `legend.ts` row's text to `Properties, state, controller wiring, lifecycle, render, public API and settings`, and add these rows under the `controllers/data-controller.ts` row:

```md
| `controllers/item-actions-controller.ts` | `ItemActionsController`: row clicks and double-clicks (touch taps included), extract from and merge into Other, the drop highlight, the sort mode and the order direction. Takes the element as its host |
| `controllers/reorder-controller.ts` | `ReorderController`: the keyboard reorder's snapshot, move, restore and clear, and what a drag commits. Takes the element as its host |
```

In the "Reactive Controllers Pattern" paragraph Task 8.7 wrote, replace `` (`host._data`, …) `` with `` (`host._data`, `host._reorder`, …) ``.

Run: `pnpm exec prettier --write docs/developers/architecture.md`.

- [ ] **Step 19: Line counts, the map and the commit**

Run: `wc -l packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/*.ts`
Expected: `legend.ts` about 1,270, `item-actions-controller.ts` about 280, `reorder-controller.ts` about 140.

Moved-member map for the report:

| `ProtspaceLegend` (before) | After |
| --- | --- |
| `_handleItemMouseClick` | `controllers/item-actions-controller.ts` `ItemActionsController.rowClick` |
| `_handleItemMouseDoubleClick` | `ItemActionsController.rowDoubleClick` |
| `_isolateFromFirstClick` | `ItemActionsController.isolateFromFirstClick` (private) |
| `_handleItemClick` | `ItemActionsController.toggle` |
| `_handleItemDoubleClick` | `ItemActionsController.isolate` |
| `_handleExtractFromOther` | `ItemActionsController.extractFromOther` |
| `_handleExtractAllFromOther` | `ItemActionsController.extractAllFromOther` |
| `_handleMergeToOther` | `ItemActionsController.mergeToOther` |
| `_highlightDroppedItem` | `ItemActionsController.highlightDropped` |
| `_reverseZOrder` | `ItemActionsController.reverseZOrder` (private) |
| `_applySortMode` | `ItemActionsController.applySortMode` |
| `_toggleLegendOrderDirection` | `ItemActionsController.toggleOrderDirection` |
| fields `_firstClick`, `_lastTap`, `_lastClickPointer` | `ItemActionsController` private fields, same names |
| `_clearKeyboardReorderState` | `controllers/reorder-controller.ts` `ReorderController.clear` |
| `_restoreKeyboardReorderSnapshot` | `ReorderController.restore` |
| `_commitManualOrderFromVisibleValues` | `ReorderController.commitManualOrder` (private) |
| `_moveFocusedManualItem` | `ReorderController.move` |
| `_keyboard`'s `snapshot` callback | `ReorderController.snapshot` |
| `_dragController`'s `setLegendItems` / `onSortModeChange` callbacks | `ReorderController.setItemsFromDrag` / `onDragSortModeChange` |
| `_dispatchLegendStateChange` | deleted (Step 2) |

```bash
git add packages/core/src/components/legend/controllers/item-actions-controller.ts packages/core/src/components/legend/controllers/reorder-controller.ts packages/core/src/components/legend/controllers/reorder-controller.test.ts packages/core/src/components/legend/controllers/index.ts packages/core/src/components/legend/controllers/data-controller.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend-data-processor.ts packages/core/src/components/legend/legend-extract.test.ts packages/core/src/components/legend/legend.rows.test.ts packages/core/src/components/legend/legend.score-strips.test.ts packages/core/src/components/legend/legend.score-sync.test.ts packages/core/src/components/legend/legend.sort-menu.browser.test.ts packages/core/src/components/legend/legend.shape-size.test.ts docs/developers/architecture.md
git commit -m "refactor(core): move legend item actions and reorder into controllers"
```

(Sandbox disabled for the commit. Knip: both classes are imported by `legend.ts` through `controllers/index.ts`; `ReorderController` also by its test.)

Report: the legend-folder counts before and after each commit, `reorder-controller.test.ts` 2, `legend-double-click.spec.ts` count, the moved-member map, `wc -l legend.ts`, and any anchor that had moved.

### Task 8.9: Legend: settings move into SettingsController; the legend's size is recorded

The settings popover glue, live apply, reset, the colour and shape commits and their persistence (`legend.ts` :1714–1983, without `_closeAnnotationOverlays`) move into `SettingsController`. `legend.ts` ends at about 1,000 lines; design.md decision 18 records the number.

**Files:**

- Create: `packages/core/src/components/legend/controllers/settings-controller.ts`
- Modify: `packages/core/src/components/legend/controllers/index.ts`
- Modify: `packages/core/src/components/legend/legend.ts`
- Modify: `legend.numeric-settings.test.ts` (`_renderSettingsPopover`, `_applyDisplaySettings`, `_handleSettingsReset`), `legend.shape-size.test.ts` (`_applyDisplaySettings`, `_handleSettingsReset`); `legend.settings.browser.test.ts` calls no moved settings method (its spies changed in Task 8.7) and stays as it is; no other test calls one (Step 1 greps)
- Modify: `docs/developers/architecture.md` (table row; the `legend-settings-popover.ts` row names `SettingsController.apply` instead of `_applyDisplaySettings`)
- Modify: `openspec/changes/explore-workbench/design.md` (decision 18: the legend's reached size)

**Interfaces:**

- Consumes: Tasks 8.7–8.8's controllers through the host (`this.host._data.clearShapeSize()`, `this.host._data.setNumericManualOrderIds(…)`, `this.host._reorder.clear()`) and `this.host._updateLegendItems()`; the shared section in `legend.ts` and the members it already holds (`_legendItems`, `_hiddenValues`, `_annotationSortModes`, `_enableDuplicateStackUI`, `_selectedPaletteId`, `_numericSettingsByAnnotation`, `_datasetProteinCount`, `_annotationShapeSize`, `_processorContext`, `_isCurrentAnnotationNumeric`, …); `ProtspaceLegend` members made non-private here: `_sortMenu`, `_settingsAnchor`, `_settingsPopover` (keeps its `@query`; all three move into the shared section), and the controller fields `_colorPicker`, `_rowMenu` (lose `private`, stay in place; `_otherPopover` lost it in 8.8); `LegendDisplaySettings`, `protspace-legend-settings-popover` (`settings-change`, `settings-reset`, `ps-open`, `ps-close`; `flush()`, `focusFirst()`, `updateComplete`), `ColorPickerController` callbacks (`preview`, `commitColor`, `commitShape`).
- Produces (`SettingsController`, `constructor(private readonly host: ProtspaceLegend)`): `open(anchor: HTMLElement): void` ← `_openSettings`; `close(): void` ← `_closeSettings`; `apply(patch: Partial<LegendDisplaySettings>): void` ← `_applyDisplaySettings`; `reset(): void` ← `_handleSettingsReset`; `resetKeepingOpen(): Promise<void>` ← `_resetSettingsKeepingOpen`; `canReset(): boolean` ← `_canResetSettings`; `render(label: string)` ← `_renderSettingsPopover` (same return type, a Lit `TemplateResult`); `commitColor(value: string, color: string): void` ← `_handleColorChange`; `previewColor(value: string, color: string): void` ← `_previewColor`; `commitShape(value: string, shape: PointShape): void` ← `_handleShapeChange`; private `fieldShapeSize`, `displaySettings`, `syncColorsToPersistence` (← `_syncLegendColorsToPersistence`). `ProtspaceLegend`: field `readonly _settings = new SettingsController(this)` after `_reorder`; `_closeAnnotationOverlays` calls `this._settings.close()`; the header's `onSettings`, the colour picker's callbacks, `clearForNewDataset` and `render()` call the controller.
  - `legend.ts` ≤ 1,100 lines (target about 1,000; the move lands it near 980). The row-view building of `_renderLegendItem` is not moved. It reads `_keyboard`, `_otherPopover`, `_hoveredCategory`, `_categoryScores` and `selectedItems`, so a pure function would take five inputs to save about fifteen lines, which is not a clean cut. If the count is above 1,000, report it; above 1,100, stop and report BLOCKED with the count.
  - design.md decision 18, first bullet gains, verbatim with the real count: "`legend.ts` is split into the element (about N lines: state, lifecycle, render, public API) and controllers for its data pipeline, item actions, keyboard reorder and settings."

**Tests:**

- Every existing legend test passes with call sites moved to `_settings` (`el._settings.apply({ paletteId: 'kellys' })`, `el._settings.reset()`, `render(el._settings.render('Score'), container)`); the spies on `_updateLegendItems` still observe two calls in `legend.numeric-settings.test.ts` :138.
- `legend.persistence-compat.test.ts`, `legend.settings.browser.test.ts`, `legend.color-picker.browser.test.ts` unchanged and green.
- Run: the legend folder (both projects, sandbox disabled); e2e `workbench-legend.spec.ts -g "settings"`.
- Unrun at task time (exit): `numeric-binning.spec.ts`, `mobile-legend.spec.ts`, `perf:counts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`; the legend-folder run, the e2e run and the commits need the sandbox disabled. Moves are move-only, as in Tasks 8.7 and 8.8. Anchors are quoted as Task 8.8 leaves the file; if one has moved, apply the intended change and say so.

- [ ] **Step 1: Point the tests at the controller (the failing test)**

First confirm which tests call a settings method on the element:

```bash
grep -rnE "\._(openSettings|closeSettings|applyDisplaySettings|resetSettingsKeepingOpen|canResetSettings|renderSettingsPopover|handleColorChange|previewColor|handleShapeChange|handleSettingsReset|syncLegendColorsToPersistence)\b" packages/core/src/components/legend --include="*.test.ts"
```

Expected: `legend.numeric-settings.test.ts` (:104, :118, :128, :129, :149) and `legend.shape-size.test.ts` (:81, :140, :388, :446, :522), nothing else.

In `packages/core/src/components/legend/legend.numeric-settings.test.ts`, in `type LegendTestElement`, replace:

```ts
  _renderSettingsPopover: (label: string) => unknown;
  _applyDisplaySettings: (patch: Partial<LegendDisplaySettings>) => void;
  _handleSettingsReset: () => void;
```

with:

```ts
  _settings: {
    render: (label: string) => unknown;
    apply: (patch: Partial<LegendDisplaySettings>) => void;
    reset: () => void;
  };
```

then replace `    render(el._renderSettingsPopover('Score'), container);` with `    render(el._settings.render('Score'), container);`, every `    el._applyDisplaySettings(` with `    el._settings.apply(` (3), and `    el._handleSettingsReset();` with `    el._settings.reset();` (1). The `el._updateLegendItems = vi.fn()` stubs stay: the controller calls `this.host._updateLegendItems()`, so `expect(el._updateLegendItems).toHaveBeenCalledTimes(2)` (:138) still counts both edits.

In `packages/core/src/components/legend/legend.shape-size.test.ts`, in `type ShapeSizeLegend`, replace:

```ts
  _applyDisplaySettings: (patch: { shapeSize?: number | null }) => void;
  _handleSettingsReset: () => void;
```

with:

```ts
  _settings: {
    apply: (patch: { shapeSize?: number | null }) => void;
    reset: () => void;
  };
```

replace `  const pick = (shapeSize: number | null) => el._applyDisplaySettings({ shapeSize });` with `  const pick = (shapeSize: number | null) => el._settings.apply({ shapeSize });`, every `    el._handleSettingsReset();` with `    el._settings.reset();` (3), and

```ts
type ResettableLegend = ProtspaceLegend & {
  _handleSettingsReset: () => void;
};
```

with:

```ts
type ResettableLegend = ProtspaceLegend;
```

and `    legend._handleSettingsReset();` with `    legend._settings.reset();`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.numeric-settings.test.ts src/components/legend/legend.shape-size.test.ts`
Expected: the cases that edit settings fail with `TypeError: Cannot read properties of undefined (reading 'render')` / `(reading 'apply')` / `(reading 'reset')`: the element has no `_settings` yet. The other cases pass.

- [ ] **Step 3: Create the controller and export it**

Create `packages/core/src/components/legend/controllers/settings-controller.ts`. The methods are cut from `legend.ts`'s "Settings Popover" section (Step 7 deletes them there), from `_openSettings` through `_syncLegendColorsToPersistence`; `_closeAnnotationOverlays` is not among them (it is in the shared section since Task 8.7):

```ts
import { html } from 'lit';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  normalizeNumericPaletteId,
  type PointShape,
} from '@protspace/utils';
import { LEGEND_DEFAULTS, LEGEND_EVENTS, LEGEND_VALUES } from '../config';
import type { ProtspaceLegend } from '../legend';
import { calculatePointSize, defaultShapeSize, getDefaultSortMode } from '../legend-helpers';
import { applyPaletteColors, normalizeCategoricalPaletteId } from '../legend-items-state';
import type { LegendDisplaySettings, PersistedCategoryData } from '../types';

/**
 * The legend's settings: the settings popover (open, close, render), each edit applied live,
 * Reset, and the colour and shape commits from the picker with their stored categories. A plain
 * class over its element: it reads and writes the legend's state directly (the members
 * `legend.ts` lists as read and written by its controllers).
 */
export class SettingsController {
  constructor(private readonly host: ProtspaceLegend) {}

  /** The header's settings button: opens the settings popover under it, or closes it. */
  open(anchor: HTMLElement): void {
    if (this.host._settingsAnchor) {
      this.close();
      return;
    }
    // One legend overlay at a time; a keyboard reorder in progress is dropped, as the dialog did.
    this.host._reorder.clear();
    this.host._colorPicker.close();
    this.host._rowMenu.close();
    this.host._sortMenu = null;
    this.host._otherPopover.close();
    this.host._settingsAnchor = anchor;
    this.host.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.CUSTOMIZE, { bubbles: true, composed: true }),
    );
  }

  close(): void {
    if (!this.host._settingsAnchor) return;
    // A value typed but not yet committed is kept, not lost with the popover.
    this.host._settingsPopover?.flush();
    this.host._settingsAnchor = null;
  }

  /**
   * Applies one edit from the settings popover at once (design decision 12), then runs the tail
   * the dialog's Save ran, once: the items, the plot and the stored record follow.
   */
  apply(patch: Partial<LegendDisplaySettings>): void {
    const annotation = this.host.selectedAnnotation;
    const current = this.host._numericSettingsByAnnotation[annotation];
    const numeric = this.host._isCurrentAnnotationNumeric()
      ? {
          binCount: current?.binCount ?? this.host.maxVisibleValues,
          strategy: current?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
          paletteId: normalizeNumericPaletteId(current?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID),
          reverseGradient: current?.reverseGradient ?? false,
        }
      : null;

    if (patch.maxVisibleValues !== undefined) {
      this.host.maxVisibleValues = patch.maxVisibleValues;
      if (numeric) numeric.binCount = patch.maxVisibleValues;
    }
    if (patch.shapeSize !== undefined) {
      if (patch.shapeSize === null) {
        // An emptied size field returns the dataset to its default, as Reset does for the size.
        this.host._data.clearShapeSize();
      } else {
        const size = Math.min(patch.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
        if (size !== this.host.shapeSize) {
          this.host._persistenceController.saveShapeSize(size);
          this.host.shapeSize = size;
        }
      }
    }
    if (patch.paletteId !== undefined) {
      if (numeric) {
        numeric.paletteId = normalizeNumericPaletteId(patch.paletteId);
        this.host._selectedPaletteId = numeric.paletteId;
      } else {
        this.host._selectedPaletteId = normalizeCategoricalPaletteId(patch.paletteId);
        this.host._legendItems = applyPaletteColors(
          this.host._legendItems,
          this.host._selectedPaletteId,
        );
        // Ahead of the update below, which keeps stored colours over palette ones.
        this.syncColorsToPersistence();
      }
    }
    if (numeric && patch.numericStrategy !== undefined) numeric.strategy = patch.numericStrategy;
    if (numeric && patch.reverseGradient !== undefined) {
      numeric.reverseGradient = patch.reverseGradient;
    }
    if (patch.enableDuplicateStackUI !== undefined) {
      this.host._enableDuplicateStackUI = patch.enableDuplicateStackUI;
    }
    if (numeric) {
      this.host._numericSettingsByAnnotation = {
        ...this.host._numericSettingsByAnnotation,
        [annotation]: numeric,
      };
    }

    this.host._updateLegendItems();
    this.syncColorsToPersistence();
    this.host._scatterplotController.syncHiddenValues();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.host.shapeSize),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
    });
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /** Reset from the popover: today's scope, and the popover stays open on the defaults. */
  async resetKeepingOpen(): Promise<void> {
    this.reset();
    await this.host.updateComplete;
    const popover = this.host._settingsPopover;
    // Closed meanwhile, or removed with the legend: there is nothing to focus.
    if (!popover || this.host._settingsAnchor === null || !this.host.isConnected) return;
    await popover.updateComplete;
    // Reset disables itself once nothing is stored; focus moves to the palette, not the body.
    popover.focusFirst();
  }

  /** Something to reset: a record stored for the annotation, or a size picked for the dataset. */
  canReset(): boolean {
    return (
      this.host._persistenceController.hasPersistedSettings() ||
      this.host._persistenceController.loadShapeSize() !== null
    );
  }

  /**
   * The size the size field shows: the live one, capped at the field's bound, or null while it
   * is the dataset's default, which the empty field stands for (its placeholder names it).
   */
  private fieldShapeSize(): number | null {
    // The storage read last: this runs at every legend render, the popover closed or not.
    const isDefault =
      this.host._annotationShapeSize === null &&
      this.host.shapeSize === defaultShapeSize(this.host._datasetProteinCount) &&
      this.host._persistenceController.loadShapeSize() === null;
    return isDefault ? null : Math.min(this.host.shapeSize, LEGEND_DEFAULTS.maxSymbolSize);
  }

  /**
   * The popover's view of the live state; there is no draft. A fresh object at each render is
   * fine: the popover's `settings` compares field by field, so an unchanged one re-renders nothing.
   */
  private displaySettings(isNumeric: boolean): LegendDisplaySettings {
    const numeric = this.host._numericSettingsByAnnotation[this.host.selectedAnnotation];
    return {
      maxVisibleValues: this.host.maxVisibleValues,
      shapeSize: this.fieldShapeSize(),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
      paletteId: isNumeric
        ? normalizeNumericPaletteId(numeric?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID)
        : normalizeCategoricalPaletteId(this.host._selectedPaletteId),
      numericStrategy: numeric?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
      reverseGradient: numeric?.reverseGradient ?? false,
    };
  }

  /**
   * The settings popover, rendered once as the last child of `.legend-container` and never keyed:
   * it flushes a pending edit when removed, so a remount would send a stale `settings-change`.
   */
  render(label: string) {
    const open = this.host._settingsAnchor !== null;
    const isNumeric = this.host._isCurrentAnnotationNumeric();
    return html`<protspace-legend-settings-popover
      .anchor=${this.host._settingsAnchor}
      .open=${open}
      .settings=${this.displaySettings(isNumeric)}
      .numeric=${isNumeric}
      .defaultShapeSize=${defaultShapeSize(this.host._datasetProteinCount)}
      .logBinningAvailable=${this.host.annotationData.numericMetadata?.logSupported ?? true}
      .canReset=${open && this.canReset()}
      .annotationLabel=${label}
      @settings-change=${(event: CustomEvent<Partial<LegendDisplaySettings>>) =>
        this.apply(event.detail)}
      @settings-reset=${() => void this.resetKeepingOpen()}
      @ps-open=${() => this.host._settingsPopover?.focusFirst()}
      @ps-close=${() => {
        this.host._settingsAnchor = null;
      }}
    ></protspace-legend-settings-popover>`;
  }

  commitColor(value: string, newColor: string): void {
    // Update the color immediately
    this.host._legendItems = this.host._legendItems.map((item) =>
      item.value === value ? { ...item, color: newColor } : item,
    );

    // Sync to persistence
    this.syncColorsToPersistence();

    // Update scatterplot and save (color-only change, no z-order change)
    this.host._scatterplotController.dispatchColorMappingChange(true);
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  /**
   * Shows a colour while it is dragged: the row repaints now, the plot when the edit commits. The
   * item is changed in place, as before the split, so a drag does not re-sort the list or
   * re-derive the score strips on every tick.
   */
  previewColor(value: string, color: string): void {
    const item = this.host._legendItems.find((i) => i.value === value);
    if (!item) return;
    item.color = color;
    this.host.requestUpdate();
  }

  commitShape(value: string, newShape: PointShape): void {
    // Update the shape immediately
    this.host._legendItems = this.host._legendItems.map((item) =>
      item.value === value ? { ...item, shape: newShape } : item,
    );

    // Sync to persistence
    this.syncColorsToPersistence();

    // Update scatterplot and save (shape change, no z-order change)
    this.host._scatterplotController.dispatchColorMappingChange(true);
    this.host._persistenceController.saveSettings();
    this.host.requestUpdate();
  }

  reset(): void {
    // Remove localStorage and clear pending categories
    this.host._persistenceController.removeSettings();
    this.host._persistenceController.clearPendingCategories();

    // Reset all settings to defaults. The shape size is the dataset's, so it is cleared for every
    // annotation rather than stored, and the default from the protein count applies again.
    this.host.maxVisibleValues = LEGEND_DEFAULTS.maxVisibleValues;
    this.host._data.clearShapeSize();
    const isNumericAnnotation = this.host._isCurrentAnnotationNumeric();

    this.host._selectedPaletteId = isNumericAnnotation ? DEFAULT_NUMERIC_PALETTE_ID : 'kellys';
    if (isNumericAnnotation) {
      this.host._numericSettingsByAnnotation = {
        ...this.host._numericSettingsByAnnotation,
        [this.host.selectedAnnotation]: {
          binCount: LEGEND_DEFAULTS.maxVisibleValues,
          strategy: DEFAULT_NUMERIC_STRATEGY,
          paletteId: DEFAULT_NUMERIC_PALETTE_ID,
          reverseGradient: false,
        },
      };
      this.host._data.setNumericManualOrderIds(this.host.selectedAnnotation, undefined);
    }

    this.host._annotationSortModes = {
      ...this.host._annotationSortModes,
      [this.host.selectedAnnotation]: isNumericAnnotation
        ? 'alpha-asc'
        : getDefaultSortMode(this.host.selectedAnnotation),
    };

    this.host._hiddenValues = [];
    this.host._enableDuplicateStackUI = false;

    // Reset slot tracker so colors are reassigned from scratch
    this.host._processorContext.slotTracker.reset();

    // Clear legend items so processor creates fresh ones with default colors
    this.host._legendItems = [];

    this.host._scatterplotController.updateConfig({
      pointSize: calculatePointSize(this.host.shapeSize),
      enableDuplicateStackUI: this.host._enableDuplicateStackUI,
    });

    this.host._updateLegendItems();
    this.host._scatterplotController.syncNumericAnnotationSettings();
    this.host._scatterplotController.dispatchColorMappingChange();
    this.host.requestUpdate();
  }

  private syncColorsToPersistence(): void {
    const categories: Record<string, PersistedCategoryData> = {};
    const persistVisualEncodings = !this.host._isCurrentAnnotationNumeric();
    this.host._legendItems.forEach((item) => {
      if (item.value !== LEGEND_VALUES.OTHER) {
        categories[item.value] = {
          zOrder: item.zOrder,
          color: persistVisualEncodings ? item.color : '',
          shape: persistVisualEncodings ? item.shape : '',
        };
      }
    });
    this.host._persistenceController.setPendingCategories(categories);
  }
}
```

In `packages/core/src/components/legend/controllers/index.ts`, after `export { ReorderController } from './reorder-controller';` add:

```ts

export { SettingsController } from './settings-controller';
```

- [ ] **Step 4: legend.ts imports**

Replace:

```ts
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  isNumericAnnotation,
  normalizeNumericPaletteId,
  annotationLabel,
```

with:

```ts
import {
  isNumericAnnotation,
  annotationLabel,
```

Delete:

```ts
import type { PointShape } from '@protspace/utils';
```

Replace:

```ts
  ItemActionsController,
  ReorderController,
} from './controllers';
```

with:

```ts
  ItemActionsController,
  ReorderController,
  SettingsController,
} from './controllers';
```

Replace:

```ts
import {
  calculatePointSize,
  defaultShapeSize,
  getDefaultSortMode,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  computeOtherConcreteValues,
} from './legend-helpers';
```

with:

```ts
import {
  calculatePointSize,
  getItemClasses,
  isItemSelected,
  createItemActionEvent,
  computeOtherConcreteValues,
} from './legend-helpers';
```

Replace:

```ts
import {
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  sortItemsForDisplay,
} from './legend-items-state';
```

with:

```ts
import { sortItemsForDisplay } from './legend-items-state';
```

Replace:

```ts
  OtherItem,
  PersistedCategoryData,
  LegendErrorEventDetail,
  LegendErrorSource,
  LegendDisplaySettings,
} from './types';
```

with:

```ts
  OtherItem,
  LegendErrorEventDetail,
  LegendErrorSource,
} from './types';
```

(`html` from `lit` stays: `render()` uses it; `import './legend-settings-popover';` and the `ProtspaceLegendSettingsPopover` type stay: the element registers the tag and types `_settingsPopover`.)

- [ ] **Step 5: legend.ts state: the settings anchors join the shared section**

Replace:

```ts
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() private _sortMenu: HTMLElement | null = null;
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() private _settingsAnchor: HTMLElement | null = null;
  @state() private _statusMessage = '';
```

with:

```ts
  @state() private _statusMessage = '';
```

Replace:

```ts
  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;

  @query('protspace-legend-settings-popover')
  private _settingsPopover?: ProtspaceLegendSettingsPopover;
```

with:

```ts
  @query('.legend-items')
  private _legendItemsEl?: HTMLDivElement;
```

Replace:

```ts
  @state() _legendItems: LegendItem[] = [];
  @state() _sortedLegendItems: LegendItem[] = [];
```

with:

```ts
  @state() _legendItems: LegendItem[] = [];
  @state() _sortedLegendItems: LegendItem[] = [];
  /** The sort button while its menu is open (the menu's anchor); null when closed. */
  @state() _sortMenu: HTMLElement | null = null;
  /** The settings button while the settings popover is open under it (design decision 12). */
  @state() _settingsAnchor: HTMLElement | null = null;
  @query('protspace-legend-settings-popover')
  _settingsPopover?: ProtspaceLegendSettingsPopover;
```

- [ ] **Step 6: legend.ts controllers and callers**

Replace:

```ts
  _closeAnnotationOverlays(): void {
    this._closeSettings();
```

with:

```ts
  _closeAnnotationOverlays(): void {
    this._settings.close();
```

Replace:

```ts
  readonly _reorder = new ReorderController(this);
```

with:

```ts
  readonly _reorder = new ReorderController(this);
  /** Settings popover, live edits, picker commits (controllers/settings-controller.ts). */
  readonly _settings = new SettingsController(this);
```

Replace:

```ts
    onSettings: (anchor) => this._openSettings(anchor),
```

with:

```ts
    onSettings: (anchor) => this._settings.open(anchor),
```

Replace:

```ts
  private _colorPicker = new ColorPickerController(this, {
    getItem: (value) => this._legendItems.find((item) => item.value === value),
    preview: (value, color) => this._previewColor(value, color),
    commitColor: (value, color) => this._handleColorChange(value, color),
    commitShape: (value, shape) => this._handleShapeChange(value, shape),
```

with:

```ts
  _colorPicker = new ColorPickerController(this, {
    getItem: (value) => this._legendItems.find((item) => item.value === value),
    preview: (value, color) => this._settings.previewColor(value, color),
    commitColor: (value, color) => this._settings.commitColor(value, color),
    commitShape: (value, shape) => this._settings.commitShape(value, shape),
```

Replace:

```ts
  private _rowMenu = new LegendRowMenu(this, {
```

with:

```ts
  _rowMenu = new LegendRowMenu(this, {
```

In `clearForNewDataset`:

Replace:

```ts
    // A value typed into the settings popover belongs to the dataset it was typed for.
    this._closeSettings();
```

with:

```ts
    // A value typed into the settings popover belongs to the dataset it was typed for.
    this._settings.close();
```

In `render()` (Prettier may join this line with the one above it):

Replace:

```ts
        ${this._renderSettingsPopover(title)}
```

with:

```ts
        ${this._settings.render(title)}
```

- [ ] **Step 7: legend.ts: the settings section leaves**

Delete the whole "Settings Popover" section: from its header (`  // ─────…` then `  // Settings Popover`) through the closing `}` of `_syncLegendColorsToPersistence` (`    this._persistenceController.setPendingCategories(categories);` then `  }`) and the blank line after it, so the "Rendering" header follows `_hasSameProteinIds`. It held `_openSettings`, `_closeSettings`, `_applyDisplaySettings`, `_resetSettingsKeepingOpen`, `_canResetSettings`, `_fieldShapeSize`, `_displaySettings`, `_renderSettingsPopover`, `_handleColorChange`, `_previewColor`, `_handleShapeChange`, `_handleSettingsReset`, `_syncLegendColorsToPersistence`, each with its doc comment.

Check:

```bash
grep -nE "_(openSettings|closeSettings|applyDisplaySettings|resetSettingsKeepingOpen|canResetSettings|fieldShapeSize|displaySettings|renderSettingsPopover|handleColorChange|previewColor|handleShapeChange|handleSettingsReset|syncLegendColorsToPersistence)\b" packages/core/src/components/legend/legend.ts
grep -n "private _" packages/core/src/components/legend/legend.ts
```

Expected: the first prints nothing. The second lists only element-only members: `_statusMessage`, `_hoveredCategory`, `_legendItemsEl`, `_dragController`, `_headerHandlers`, `_sortMenuHandlers`, `_nameTooltip`, `_canDragLegendItem`, `_isMultilabelAnnotation`, `_hasSameProteinIds`, `_headerModel`, `_renderSortMenu`, `_setHoveredCategory`, `_stripPoints`, `_scoreStripHandlers`, `_renderScoreStrips`, `_renderLegendItem` (and nothing a controller reads).

- [ ] **Step 8: Run the two tests, the type-check and the linters**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/legend.numeric-settings.test.ts src/components/legend/legend.shape-size.test.ts`
Expected: all pass, the same counts as before Step 1.

Run: `pnpm --filter @protspace/core type-check`
Expected: no errors.

Run: `pnpm exec eslint packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/settings-controller.ts packages/core/src/components/legend/controllers/index.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.shape-size.test.ts`
Expected: no errors.

Run: `pnpm exec prettier --write packages/core/src/components/legend/legend.ts packages/core/src/components/legend/controllers/settings-controller.ts packages/core/src/components/legend/controllers/index.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.shape-size.test.ts`

- [ ] **Step 9: The legend folder, both projects**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run src/components/legend`
Expected: every file passes with Task 8.8's count (this task adds no test). `legend.persistence-compat.test.ts`, `legend.settings.browser.test.ts`, `legend.color-picker.browser.test.ts` and `legend.api.test.ts` pass unchanged. A failure means the move drifted: compare with `git show HEAD:packages/core/src/components/legend/legend.ts`; never change an assertion.

- [ ] **Step 10: The one e2e spec**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-legend.spec.ts -g "settings"`
Expected: the settings test(s) pass ("settings and the sort apply live and survive a reload under the same protspace:legend: key" among them).

- [ ] **Step 11: Developer docs**

In `docs/developers/architecture.md`: change the `legend.ts` row's text to `Properties, state, controller wiring, lifecycle, render and public API`; in the `legend-settings-popover.ts` row replace `` (`_applyDisplaySettings`) `` with `` (`SettingsController.apply`) ``; add this row under the `controllers/reorder-controller.ts` row:

```md
| `controllers/settings-controller.ts` | `SettingsController`: the settings popover (open, close, render), each edit applied live (`apply`), Reset, and the colour and shape commits from the picker. Takes the element as its host |
```

and in the "Reactive Controllers Pattern" paragraph replace `` (`host._data`, `host._reorder`, …) `` with `` (`host._data`, `host._reorder`, `host._settings`, …) ``.

Run: `pnpm exec prettier --write docs/developers/architecture.md`, then `grep -n "_applyDisplaySettings\|_handleSettingsReset" docs/developers/architecture.md` (expected: no output).

- [ ] **Step 12: Line counts and the map**

Run: `wc -l packages/core/src/components/legend/*.ts packages/core/src/components/legend/controllers/*.ts | sort -n | tail -15`
Expected: `legend.ts` about 980 (≤ 1,100; see the ruling under Interfaces), `settings-controller.ts` about 305, every legend module under 800.

Moved-member map for the report:

| `ProtspaceLegend` (before) | `controllers/settings-controller.ts` `SettingsController` |
| --- | --- |
| `_openSettings` | `open` |
| `_closeSettings` | `close` |
| `_applyDisplaySettings` | `apply` |
| `_resetSettingsKeepingOpen` | `resetKeepingOpen` |
| `_canResetSettings` | `canReset` |
| `_fieldShapeSize` | `fieldShapeSize` (private) |
| `_displaySettings` | `displaySettings` (private) |
| `_renderSettingsPopover` | `render` |
| `_handleColorChange` | `commitColor` |
| `_previewColor` | `previewColor` |
| `_handleShapeChange` | `commitShape` |
| `_handleSettingsReset` | `reset` |
| `_syncLegendColorsToPersistence` | `syncColorsToPersistence` (private) |

- [ ] **Step 13: Commit the move**

```bash
git add packages/core/src/components/legend/controllers/settings-controller.ts packages/core/src/components/legend/controllers/index.ts packages/core/src/components/legend/legend.ts packages/core/src/components/legend/legend.numeric-settings.test.ts packages/core/src/components/legend/legend.shape-size.test.ts docs/developers/architecture.md
git commit -m "refactor(core): move legend settings into a controller"
```

(Sandbox disabled for the commit. Knip: `SettingsController` is imported by `legend.ts` through `controllers/index.ts`.)

- [ ] **Step 14: Record the size in design.md and commit**

Take N from Step 12's `wc -l legend.ts`, rounded to the nearest ten (for example 976 → 980). In `openspec/changes/explore-workbench/design.md`, decision 18 ("### 18. Code structure targets"), replace the first bullet:

```md
- No element file over about 800 lines; `legend.ts`, `control-bar.ts` and `publish-modal.ts` are
  split as described above.
```

with (N filled in):

```md
- No element file over about 800 lines; `legend.ts`, `control-bar.ts` and `publish-modal.ts` are
  split as described above. `legend.ts` is split into the element (about N lines: state,
  lifecycle, render, public API) and controllers for its data pipeline, item actions, keyboard
  reorder and settings.
```

Task 8.5's bullet for the `scatter-plot.ts` exception stays as it is. Run `pnpm exec prettier --check openspec/changes/explore-workbench/design.md`, then:

```bash
git add openspec/changes/explore-workbench/design.md
git commit -m "docs(openspec): record the legend split"
```

(Sandbox disabled for the commit.)

Report: the legend-folder counts before and after, the e2e count, the moved-member map, `wc -l` of `legend.ts` and of every legend module (Step 12), the N written into design.md, and any anchor that had moved.

### Task 8.10: Scatter plot: a hover redraws no points; export compositing in its own module

Every hover sets a new `_tooltipData`, which is not in `NO_ADDITIONAL_RENDER_KEYS`, so each one runs a full WebGL render of every point (all 573K) and the selection overlays, and the measured `_tooltipHeight` runs it again. Both keys join the set: the tooltip is template only. Then, as the one small extraction the recorded exception allows, `captureAtResolution`'s badge compositing and background fill move into a pure `export-capture.ts`.

**Files:**

- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (`NO_ADDITIONAL_RENDER_KEYS` :123–133 and its comment :117–122; the `./webgl` import :38; `captureAtResolution` :2480–2574; `_captureExportBadges` :2584–2610 keeps its renderer and overlay calls)
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.render-coalescing.test.ts`
- Create: `packages/core/src/components/scatter-plot/export-capture.ts`
- Create: `packages/core/src/components/scatter-plot/export-capture.browser.test.ts`

**Interfaces:**

- Consumes: `NO_ADDITIONAL_RENDER_KEYS` (module `ReadonlySet<string>`), `_reconcileSelectionOverlays(changedProperties: Map<string, unknown>)` (:975: requests a render and `_updateSelectionOverlays()` unless the selection is unchanged and every changed key is in the set), `_renderLoop`, `_webglRenderer.render`; the render-coalescing test's harness (`makePlot()` → `{ el, renderer }`, `frames.run()`, `vi.spyOn(renderer, 'render')`, `vi.spyOn(el, '_updateSelectionOverlays')`, `el._reconcileSelectionOverlays(...)` as in the case at :161); `computeSizeScaleFactor(refWidth, refHeight, displayWidth, displayHeight): number` (`./webgl`, `sqrt(ref area / display area)`), `EXPORT_KNOCKOUT` (stays in `scatter-plot.ts`), `this._mergedConfig` (`Required<ScatterplotConfig>`, `width`/`height` numbers).
- Produces:
  - `NO_ADDITIONAL_RENDER_KEYS` also holds `'_tooltipData'` and `'_tooltipHeight'`; the comment names the tooltip as template-only.
  - `export-capture.ts`: `export function compositeExportCanvas(webglCanvas: HTMLCanvasElement, badgesCanvas: HTMLCanvasElement | null, backgroundColor: string | undefined): HTMLCanvasElement` (draws `badgesCanvas` over `webglCanvas` stretched to its size when it has a size, then returns a new canvas filled with `backgroundColor` under it unless that is empty or `'transparent'`, else `webglCanvas`; the moved body of :2542–2573); `export function exportBadgeScale(output: { width: number; height: number }, dpr: number, reference: { width: number; height: number } | undefined, live: { width: number; height: number }): number` (`dpr × computeSizeScaleFactor(…)` with logical output dims, the body of :2591–2603). `captureAtResolution` and `_captureExportBadges` call them; their signatures and results are unchanged.
  - `scatter-plot.ts` about 2,600 lines (2,599 when this task's edits are applied to `16e73279`'s file; no earlier task of this phase edits it). Report the count; the exception is recorded, so there is no ceiling, and a line or two of Prettier drift is not a failure.

**Tests:**

- `scatter-plot.render-coalescing.test.ts`: "a tooltip change does not render" (`el._reconcileSelectionOverlays(new Map([['_tooltipData', null]]))`, `frames.run()`, renderer `render` and `_updateSelectionOverlays` not called); "a measured tooltip height does not render" (same with `_tooltipHeight`); "a tooltip change with a selection change still renders" (both keys: render called once).
- `export-capture.browser.test.ts` (Chromium canvas): "fills the background under the points"; "an empty or 'transparent' background returns the WebGL canvas itself"; "badges are drawn over the points at the output size"; "exportBadgeScale is dpr at the live size and scales with the reference" (values from the current formula).
- Run: `scatter-plot.render-coalescing.test.ts`, `scatter-plot.tooltip-measure.test.ts`, `scatter-plot.capture-badges.test.ts`, `scatter-plot.capture-badges-geometry.test.ts`, `scatter-plot.export-style.test.ts`, `scatter-plot.shift-focus.test.ts` (unit); `export-capture.browser.test.ts`, `scatter-plot.spider.browser.test.ts`, `scatter-plot.tooltip-actions.browser.test.ts`, `scatter-plot.theme.browser.test.ts` (browser, sandbox disabled); e2e `multi-annotation-tooltip.spec.ts`.
- Unrun at task time (exit): `figure-editor.spec.ts`, `workbench-import-export.spec.ts` (exports), `mobile-plot-touch.spec.ts`, `perf:counts`, `pnpm perf`.

Report `wc -l scatter-plot.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Unit tests (`--project unit`, jsdom) run inside the sandbox; the browser files and the e2e spec start local servers and need the sandbox disabled. No utils change.

**Part 1: a hover redraws no points.**

- [ ] **Step 1: Write the failing render-coalescing cases**

In `packages/core/src/components/scatter-plot/scatter-plot.render-coalescing.test.ts`, inside `describe('render coalescing', () => { … })`, directly after the closing `});` of `it('a selection change in an update with other keys updates the overlays once', …)`, add:

```ts
  it('a tooltip change does not render', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');
    const overlays = vi.spyOn(el, '_updateSelectionOverlays');

    // A hover sets a new { x, y, view } every time; nothing in WebGL draws it.
    el._reconcileSelectionOverlays(new Map<string, unknown>([['_tooltipData', null]]));
    frames.run();
    expect(render).not.toHaveBeenCalled();
    expect(overlays).not.toHaveBeenCalled();
  });

  it('a measured tooltip height does not render', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');
    const overlays = vi.spyOn(el, '_updateSelectionOverlays');

    el._reconcileSelectionOverlays(new Map<string, unknown>([['_tooltipHeight', null]]));
    frames.run();
    expect(render).not.toHaveBeenCalled();
    expect(overlays).not.toHaveBeenCalled();
  });

  it('a tooltip change with a selection change still renders', () => {
    const { el, renderer } = makePlot();
    const render = vi.spyOn(renderer, 'render');

    el.selectedProteinIds = ['p0'];
    el._reconcileSelectionOverlays(
      new Map<string, unknown>([
        ['_tooltipData', null],
        ['selectedProteinIds', []],
      ]),
    );
    frames.run();
    expect(render).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run it and see the first two fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/scatter-plot.render-coalescing.test.ts`
Expected: FAIL, 2 tests: "a tooltip change does not render" and "a measured tooltip height does not render", each `expected "spy" to not be called at all, but actually been called 1 times` (neither key is in `NO_ADDITIONAL_RENDER_KEYS`, so `canSkipRender` is false and the frame renders). "a tooltip change with a selection change still renders" and every existing case pass.

- [ ] **Step 3: Add both keys to the set**

In `packages/core/src/components/scatter-plot/scatter-plot.ts`, replace the comment and the set (:117–133):

```ts
// Reactive keys whose changes need no catch-all WebGL redraw in updated(): they
// affect only the template or are rendered by the selection block. Zoom
// transforms already redraw through the interaction controller's RAF. Both
// writers of _mergedConfig render themselves: the resize path draws on the spot,
// and a config merge happens inside the update its `config` change already
// renders, so its echo update redrew the same frame again.
const NO_ADDITIONAL_RENDER_KEYS: ReadonlySet<string> = new Set([
  'selectedProteinIds',
  'highlightedProteinIds',
  '_focusedValues',
  '_isZoomedIn',
  '_mergedConfig',
  'tooltipActions',
  'tapTooltips',
  'touchTooltipInsets',
  '_pinnedTooltip',
]);
```

with

```ts
// Reactive keys whose changes need no catch-all WebGL redraw in updated(): they
// affect only the template (the hover tooltip among them) or are rendered by the
// selection block. Zoom transforms already redraw through the interaction
// controller's RAF. Both writers of _mergedConfig render themselves: the resize
// path draws on the spot, and a config merge happens inside the update its
// `config` change already renders, so its echo update redrew the same frame again.
const NO_ADDITIONAL_RENDER_KEYS: ReadonlySet<string> = new Set([
  'selectedProteinIds',
  'highlightedProteinIds',
  '_focusedValues',
  '_isZoomedIn',
  '_mergedConfig',
  'tooltipActions',
  'tapTooltips',
  'touchTooltipInsets',
  '_pinnedTooltip',
  '_tooltipData',
  '_tooltipHeight',
]);
```

Nothing else changes. A hover's Shift focus still renders: `_updateFocus` changes `_focusedValues`, which `_reconcileSelectionOverlays` treats as a selection change. The tooltip's measurement is untouched: `_reconcileTooltipMeasurement` reads `changedProperties.has('_tooltipData')` itself and does not go through the set.

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/scatter-plot.render-coalescing.test.ts src/components/scatter-plot/scatter-plot.tooltip-measure.test.ts src/components/scatter-plot/scatter-plot.shift-focus.test.ts`
Expected: PASS, every case in the three files (render-coalescing gains 3; record each file's count before and after).

- [ ] **Step 5: Run the hover suites in a browser**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/scatter-plot.spider.browser.test.ts src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts src/components/scatter-plot/scatter-plot.theme.browser.test.ts`
Expected: PASS, each file at its earlier count (the spider's "a mouse resting on a spider node leaves the spider alone" case still sees zero mutations).

Run (sandbox disabled: the run starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e multi-annotation-tooltip.spec.ts`
Expected: PASS, every test in the spec (its own project, `multi-annotation-tooltip`).

- [ ] **Step 6: Commit**

Run: `pnpm exec prettier --check packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/scatter-plot.render-coalescing.test.ts`
Expected: both pass.

```bash
git add packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/scatter-plot.render-coalescing.test.ts
git commit -m "fix(core): a hover no longer redraws every point"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`).

**Part 2: export compositing in its own module.**

- [ ] **Step 7: Write the failing compositing tests**

Create `packages/core/src/components/scatter-plot/export-capture.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compositeExportCanvas, exportBadgeScale } from './export-capture';

/** A 2D canvas of the given size, optionally painted. */
function canvas(
  width: number,
  height: number,
  paint?: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  if (paint) paint(element.getContext('2d')!);
  return element;
}

/** One pixel's RGBA. */
function pixel(element: HTMLCanvasElement, x: number, y: number): number[] {
  return Array.from(element.getContext('2d')!.getImageData(x, y, 1, 1).data);
}

/** A 4×4 canvas with one red point in its top-left pixel; the rest is transparent. */
const onePoint = () =>
  canvas(4, 4, (ctx) => {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1);
  });

describe('compositeExportCanvas', () => {
  it('fills the background under the points', () => {
    const points = onePoint();
    const out = compositeExportCanvas(points, null, '#0000ff');
    expect(out).not.toBe(points);
    expect([out.width, out.height]).toEqual([4, 4]);
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it("an empty or 'transparent' background returns the WebGL canvas itself", () => {
    const points = onePoint();
    expect(compositeExportCanvas(points, null, 'transparent')).toBe(points);
    expect(compositeExportCanvas(points, null, '')).toBe(points);
    expect(compositeExportCanvas(points, null, undefined)).toBe(points);
    expect(pixel(points, 3, 3)[3]).toBe(0);
  });

  it('badges are drawn over the points at the output size', () => {
    const points = canvas(8, 8, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 8);
    });
    // Half the output's size: a live badge canvas stretched to the export.
    const badges = canvas(4, 4, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 2, 2);
    });
    const out = compositeExportCanvas(points, badges, '#0000ff');
    // Stretched 2×, the badge's 2×2 corner covers the output's 4×4 corner, over the points;
    // the points cover the background everywhere else.
    expect(pixel(out, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, 6, 6)).toEqual([255, 0, 0, 255]);
    // An empty badge canvas is skipped: drawImage of a 0 × 0 canvas would throw.
    expect(() => compositeExportCanvas(canvas(4, 4), canvas(0, 0), 'transparent')).not.toThrow();
  });
});

describe('exportBadgeScale', () => {
  it('exportBadgeScale is dpr at the live size and scales with the reference', () => {
    const live = { width: 800, height: 600 };
    // A 2× export of the live size: the dots keep their size, so badges scale by dpr alone.
    expect(exportBadgeScale({ width: 1600, height: 1200 }, 2, undefined, live)).toBe(2);
    // A larger output at dpr 1: sqrt(1600 × 400 / (800 × 600)).
    expect(exportBadgeScale({ width: 1600, height: 400 }, 1, undefined, live)).toBeCloseTo(
      Math.sqrt(4 / 3),
      10,
    );
    // A reference replaces the output's logical size (an inset sized like the main plot).
    expect(
      exportBadgeScale({ width: 3200, height: 1800 }, 2, { width: 800, height: 600 }, live),
    ).toBe(2);
    expect(
      exportBadgeScale({ width: 400, height: 300 }, 1, { width: 1600, height: 1200 }, live),
    ).toBe(2);
  });
});
```

- [ ] **Step 8: Run it and see it fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/export-capture.browser.test.ts`
Expected: FAIL, the whole file: `Failed to resolve import "./export-capture"` (the module does not exist yet).

- [ ] **Step 9: Create the module (moved code)**

Create `packages/core/src/components/scatter-plot/export-capture.ts`. The two function bodies are the code of `captureAtResolution` (:2542–2573) and `_captureExportBadges` (:2591–2603) as they are, with `pointSizeReference` → `reference`, `this._mergedConfig` → `live` and `webglCanvas` → `output` in the second; the comments move with them.

```ts
/**
 * The plot's image export, after the WebGL render: the duplicate-stack badges composited over the
 * points and the figure's background filled under both. Pure: the plot (captureAtResolution)
 * passes the canvases and sizes in.
 */
import { computeSizeScaleFactor } from './webgl';

/**
 * `badgesCanvas` drawn over `webglCanvas`, stretched to its size, then the points and badges on a
 * new canvas over `backgroundColor`. An empty or `'transparent'` background returns `webglCanvas`
 * itself.
 */
export function compositeExportCanvas(
  webglCanvas: HTMLCanvasElement,
  badgesCanvas: HTMLCanvasElement | null,
  backgroundColor: string | undefined,
): HTMLCanvasElement {
  if (badgesCanvas && badgesCanvas.width > 0 && badgesCanvas.height > 0) {
    const ctx = webglCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(
        badgesCanvas,
        0,
        0,
        badgesCanvas.width,
        badgesCanvas.height,
        0,
        0,
        webglCanvas.width,
        webglCanvas.height,
      );
    }
  }

  // Apply background color if the canvas has transparency
  if (backgroundColor && backgroundColor !== 'transparent') {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = webglCanvas.width;
    outputCanvas.height = webglCanvas.height;
    const ctx = outputCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      ctx.drawImage(webglCanvas, 0, 0);
      return outputCanvas;
    }
  }

  return webglCanvas;
}

/**
 * The badge scale of an export: dpr × the size factor the exported dots use (#302), so a badge
 * keeps its size relative to the dots at any output size.
 */
export function exportBadgeScale(
  output: { width: number; height: number },
  dpr: number,
  reference: { width: number; height: number } | undefined,
  live: { width: number; height: number },
): number {
  // output.width/height are PHYSICAL (logical × dpr); reference
  // and the live config dims are LOGICAL. Use logical reference dims so
  // sizeScaleFactor matches the dots' factor exactly and the dpr applied below
  // is not squared (mirrors ExportRenderer.initializeOffscreenContext). No-op
  // at dpr = 1.
  const logicalWidth = output.width / dpr;
  const logicalHeight = output.height / dpr;
  const sizeScaleFactor = computeSizeScaleFactor(
    reference?.width ?? logicalWidth,
    reference?.height ?? logicalHeight,
    live.width,
    live.height,
  );
  return dpr * sizeScaleFactor;
}
```

- [ ] **Step 10: Run the compositing tests and see them pass**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/export-capture.browser.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 11: The plot composes through the module**

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Replace the import line

```ts
import { WebGLRenderer, computeSizeScaleFactor, pointRadiusCss } from './webgl';
```

with

```ts
import { WebGLRenderer, pointRadiusCss } from './webgl';
import { compositeExportCanvas, exportBadgeScale } from './export-capture';
```

(`computeSizeScaleFactor` has no other use in the file; `grep -n computeSizeScaleFactor scatter-plot.ts` must print nothing after this step.)

2. In `captureAtResolution`, replace everything from the comment `// Composite with badges canvas if present.` to the method's closing `}`, which today reads:

```ts
    // Composite with badges canvas if present. For the unzoomed (resetView)
    // capture, render the full-extent badge set at the OUTPUT geometry via
    // the overlay controller (#301/#302): positions go through the same
    // export scales as the WebGL dots and the badge canvas matches
    // webglCanvas's physical dims, so the drawImage below is a 1:1 copy
    // (equal src/dst rects). The inset path (dataDomain set) keeps the live
    // canvas — its badge handling is a separate, pre-existing concern — and
    // the non-resetView path keeps the live canvas stretched to the output
    // dims, exactly as before.
    const badgesCanvas =
      resetView && !dataDomain
        ? this._captureExportBadges(webglCanvas, dpr, pointSizeReference)
        : this._badgesCanvas;
    if (badgesCanvas && badgesCanvas.width > 0 && badgesCanvas.height > 0) {
      …
    }

    // Apply background color if the canvas has transparency
    if (backgroundColor && backgroundColor !== 'transparent') {
      …
    }

    return webglCanvas;
  }
```

with

```ts
    // Composite with badges canvas if present. For the unzoomed (resetView) capture, render the
    // full-extent badge set at the OUTPUT geometry via the overlay controller (#301/#302), through
    // the WebGL dots' export scales and at webglCanvas's physical dims, so it composites 1:1. The
    // inset path (dataDomain set) keeps the live canvas — its badge handling is a separate,
    // pre-existing concern — and the non-resetView path keeps the live canvas stretched to the
    // output dims, exactly as before.
    const badgesCanvas =
      resetView && !dataDomain
        ? this._captureExportBadges(webglCanvas, dpr, pointSizeReference)
        : this._badgesCanvas;
    return compositeExportCanvas(webglCanvas, badgesCanvas, backgroundColor);
  }
```

The comment says the same thing in six lines instead of nine; "the drawImage below" no longer has a "below", which is the one wording change the move forces.

3. In `_captureExportBadges`, delete from the comment line `// webglCanvas.width/height are PHYSICAL (logical × dpr); pointSizeReference` through the `);` closing `const sizeScaleFactor = computeSizeScaleFactor(…)` (13 lines; they now live in `exportBadgeScale`), and replace

```ts
      badgeScale: dpr * sizeScaleFactor,
```

with

```ts
      badgeScale: exportBadgeScale(webglCanvas, dpr, pointSizeReference, this._mergedConfig),
```

The method now reads:

```ts
  private _captureExportBadges(
    webglCanvas: HTMLCanvasElement,
    dpr: number,
    pointSizeReference?: { width: number; height: number },
  ): HTMLCanvasElement | null {
    const scales = this._webglRenderer?.createExportScales(webglCanvas.width, webglCanvas.height);
    if (!scales) return null;
    return this._dupOverlay.captureBadges({
      scales,
      width: webglCanvas.width,
      height: webglCanvas.height,
      badgeScale: exportBadgeScale(webglCanvas, dpr, pointSizeReference, this._mergedConfig),
    });
  }
```

Its doc comment ("Badge capture at export geometry (#301/#302): … the same dpr × sizeScaleFactor rule …") stays as it is.

Run: `wc -l packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/export-capture.ts`
Expected: `scatter-plot.ts` about 2,600 (2,599 on `16e73279`'s file; report the number, no ceiling); `export-capture.ts` about 75.

- [ ] **Step 12: Run the export suites**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot/scatter-plot.capture-badges.test.ts src/components/scatter-plot/scatter-plot.capture-badges-geometry.test.ts src/components/scatter-plot/scatter-plot.export-style.test.ts src/components/scatter-plot/scatter-plot.render-coalescing.test.ts`
Expected: PASS, each file at its count after Step 4 (the geometry file's `badgeScale = dpr(1) × sqrt((1600·400)/(800·600))` case pins `exportBadgeScale` through the element; "export and the data extent see a render that was only requested" still captures once).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/export-capture.browser.test.ts src/components/scatter-plot/scatter-plot.theme.browser.test.ts`
Expected: PASS (the theme file's capture case composites through the module).

Run: `pnpm --filter @protspace/core type-check`
Expected: no errors.

Run: `pnpm exec prettier --check packages/core/src/components/scatter-plot/scatter-plot.ts packages/core/src/components/scatter-plot/export-capture.ts packages/core/src/components/scatter-plot/export-capture.browser.test.ts`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/export-capture.ts \
  packages/core/src/components/scatter-plot/export-capture.browser.test.ts
git commit -m "refactor(core): move export compositing out of the scatter plot"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`; knip sees both new exports consumed by `scatter-plot.ts`).

Report: each run file's count before and after; `wc -l scatter-plot.ts` after each commit (about 2,645, then about 2,599); the moved-member map: `captureAtResolution` badge `drawImage` and background fill → `export-capture.ts compositeExportCanvas`; `_captureExportBadges` logical-dims and `computeSizeScaleFactor` lines → `export-capture.ts exportBadgeScale`.

### Task 8.11: The floating structure card's default clears the selection bar

The default floating card (340 × 360, 14 px from the plot area's bottom-right corner) covers Copy IDs and Clear whenever the plot is narrower than about 708 px plus the bar, which includes 1280 px with the sidebar open. The default rectangle now stands above the selection bar's band; a card the user moved keeps its place.

**Files:**

- Modify: `apps/web/src/explore/layout-defaults.ts` (`FLOATING_CARD` :16–23)
- Modify: `apps/web/src/workbench/layout-geometry.ts` (`clampFloatRect` :111–138 and its doc comment)
- Modify: `apps/web/src/workbench/layout-geometry.test.ts` (`describe('clampFloatRect')` :99–138)
- Modify: `apps/web/tests/workbench-structure.spec.ts` ("Pop out floats the card over the plot without resizing it" :189–219; a new test after it; the `./helpers/explore` import)

**Interfaces:**

- Consumes: `FLOATING_CARD` (`minWidth` 280, `minHeight` 240, `defaultWidth` 340, `defaultHeight` 360, `inset` 14), `clampFloatRect(rect: FloatingRect | null, bounds: { width: number; height: number }): FloatingRect` (its only callers: `use-floating-card.ts` :55, :81 and `moveFloatRect`/`resizeFloatRect`, which always pass a non-null rect); selection bar geometry (`packages/core/src/components/plot-tools/selection-bar.styles.ts`: `:host { bottom: var(--ps-space-3) }` 12 px, the `.bar` with `role="toolbar"` about 38 px tall); e2e helpers `openExplore`, `plotArea`, `selectionBar`, `selectionBarAction(page, 'Copy IDs' | 'Clear')` (`helpers/explore.ts`), `clickProteinNearPlotCentre`, `floatStructure`, `structurePanel` (`helpers/workbench.ts`), `expectNear` (local to the spec).
- Produces:
  - `FLOATING_CARD.bottomInset: 64` (comment: the selection bar's 12 px offset, its 38 px height and the 14 px inset, so the default card clears Copy IDs and Clear).
  - `clampFloatRect(null, bounds)`: `x = width − inset − cardWidth` as today; `y = height − bottomInset − cardHeight`; then the same clamping (a plot too short gives `y = 0`). A non-null `rect` is computed exactly as today.

**Tests:**

- `layout-geometry.test.ts`: "clampFloatRect defaults above the selection bar" (`clampFloatRect(null, { width: 936, height: 628 })` is `{ x: 582, y: 204, width: 340, height: 360 }`; replaces "clampFloatRect defaults to the bottom-right inset"); "a stored card keeps its place" (the existing "keeps a card inside a plot that shrank" and "enforces the 280 × 240 minimum" cases unchanged); "on a plot too short for the card above the bar, the default sits at the top" (`{ width: 936, height: 400 }` → `{ x: 582, y: 0, width: 340, height: 360 }`).
- `workbench-structure.spec.ts` (project `workbench`): the "Pop out floats the card…" expectations become right gap 14 and bottom gap 64; new "the default floating card leaves Copy IDs and Clear clickable" (select one protein, float the structure, `await selectionBarAction(page, 'Copy IDs').click({ trial: true })` and the same for Clear succeed, i.e. nothing covers them; the card's bottom is above the bar's top).
- Run: `layout-geometry.test.ts`, `layout-state.test.ts` (app unit); e2e `workbench-structure.spec.ts` (that one spec, `--project workbench`).
- Unrun at task time (exit): `docs:images` (the floating-structure capture moves).

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. App unit tests run in node inside the sandbox; the e2e runs start their own server and need the sandbox disabled. This task changes no core code, so no package build is needed before the app's tests.

- [ ] **Step 1: Write the failing geometry tests**

In `apps/web/src/workbench/layout-geometry.test.ts`, inside `describe('clampFloatRect', () => { … })`, replace

```ts
  it('clampFloatRect defaults to the bottom-right inset', () => {
    expect(clampFloatRect(null, area)).toEqual({ x: 582, y: 254, width: 340, height: 360 });
  });
```

with

```ts
  it('clampFloatRect defaults above the selection bar', () => {
    // 14 px from the right edge; 64 px from the bottom, clear of the bar's 12 px offset and
    // 38 px height (Copy IDs and Clear stay clickable).
    expect(clampFloatRect(null, area)).toEqual({ x: 582, y: 204, width: 340, height: 360 });
  });

  it('a stored card keeps its place', () => {
    // Only the default moved: a card the user placed low over the bar stays there.
    const low = { x: 582, y: 254, width: 340, height: 360 };
    expect(clampFloatRect(low, area)).toEqual(low);
  });

  it('on a plot too short for the card above the bar, the default sits at the top', () => {
    expect(clampFloatRect(null, { width: 936, height: 400 })).toEqual({
      x: 582,
      y: 0,
      width: 340,
      height: 360,
    });
  });
```

The cases "keeps a card inside a plot that shrank" and "enforces the 280 × 240 minimum" stay as they are (the minimum case's default in a 250 × 200 area still clamps to `{ x: 0, y: 0, width: 250, height: 200 }`).

- [ ] **Step 2: Run them and see the default cases fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts`
Expected: FAIL, 2 tests: "clampFloatRect defaults above the selection bar" (`y` is 254, expected 204) and "on a plot too short for the card above the bar, the default sits at the top" (`y` is 26, expected 0). "a stored card keeps its place" and every other case pass.

- [ ] **Step 3: Add bottomInset and use it for the default**

In `apps/web/src/explore/layout-defaults.ts`, replace

```ts
/** The floating structure card in px; its default spot is `inset` from the plot's bottom-right. */
export const FLOATING_CARD = {
  minWidth: 280,
  minHeight: 240,
  defaultWidth: 340,
  defaultHeight: 360,
  inset: 14,
} as const;
```

with

```ts
/**
 * The floating structure card in px. Its default spot is `inset` from the plot's right edge and
 * `bottomInset` from its bottom: the selection bar's 12 px offset, its 38 px height and the 14 px
 * inset, so the default card clears Copy IDs and Clear.
 */
export const FLOATING_CARD = {
  minWidth: 280,
  minHeight: 240,
  defaultWidth: 340,
  defaultHeight: 360,
  inset: 14,
  bottomInset: 64,
} as const;
```

In `apps/web/src/workbench/layout-geometry.ts`, replace the doc comment of `clampFloatRect`

```ts
/**
 * Where the floating structure card goes in a plot area of `bounds`: the stored rectangle, or for
 * null the default 340 × 360 card 14 px in from the bottom-right corner. Its size is at least
 * 280 × 240 and at most the plot area, and it is moved inside the plot area. Render only: a card
 * stored outside a smaller window shows inside it, and storage keeps the user's rectangle.
 */
```

with

```ts
/**
 * Where the floating structure card goes in a plot area of `bounds`: the stored rectangle, or for
 * null the default 340 × 360 card 14 px in from the right edge and 64 px up from the bottom, above
 * the selection bar (a plot too short for that puts it at the top). Its size is at least 280 × 240
 * and at most the plot area, and it is moved inside the plot area. Render only: a card stored
 * outside a smaller window shows inside it, and storage keeps the user's rectangle.
 */
```

and in its body replace

```ts
  const y = rect ? rect.y : areaHeight - FLOATING_CARD.inset - height;
```

with

```ts
  const y = rect ? rect.y : areaHeight - FLOATING_CARD.bottomInset - height;
```

The clamp below it (`Math.min(Math.max(y, 0), areaHeight - height)`) already turns a negative default into 0.

- [ ] **Step 4: Run the geometry and layout tests and see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/workbench/layout-geometry.test.ts src/explore/layout-state.test.ts`
Expected: PASS, both files (`layout-geometry.test.ts` gains 2; record each file's count before and after).

- [ ] **Step 5: Update the Pop out spec and add the selection bar test**

In `apps/web/tests/workbench-structure.spec.ts`:

1. Add `selectionBar` and `selectionBarAction` to the `./helpers/explore` import, which becomes:

```ts
import {
  chooseTool,
  getSelectedProteinIds,
  importUserFile,
  openExplore,
  plotArea,
  selectionBar,
  selectionBarAction,
  waitForExploreDataLoad,
} from './helpers/explore';
```

2. In `test('Pop out floats the card over the plot without resizing it', …)`, replace

```ts
  // The default card: 340 × 360, 14 px in from the plot area's bottom-right corner.
  const area = (await plotArea(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expectNear(card.width, 340);
  expectNear(card.height, 360);
  expectNear(area.x + area.width - (card.x + card.width), 14);
  expectNear(area.y + area.height - (card.y + card.height), 14);
```

with

```ts
  // The default card: 340 × 360, 14 px in from the plot area's right edge and 64 px up from its
  // bottom, above the selection bar.
  const area = (await plotArea(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expectNear(card.width, 340);
  expectNear(card.height, 360);
  expectNear(area.x + area.width - (card.x + card.width), 14);
  expectNear(area.y + area.height - (card.y + card.height), 64);
```

3. Directly after that test's closing `});`, add:

```ts
test('the default floating card leaves Copy IDs and Clear clickable', async ({ page }) => {
  // 1280 × 720 with the sidebar open: the narrowest desktop plot the default card sits over.
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await floatStructure(page);
  await expect(selectionBar(page)).toBeVisible();

  // A trial click runs every actionability check, the hit test included, and clicks nothing: it
  // fails if the card intercepts the pointer.
  for (const name of ['Copy IDs', 'Clear'] as const) {
    await selectionBarAction(page, name).click({ trial: true, timeout: 5_000 });
  }
  const bar = (await selectionBar(page).boundingBox())!;
  const card = (await structurePanel(page).boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
});
```

The other tests that start from the default card need no change: "the card moves and resizes from the keyboard…" moves it 64 px up from wherever it starts, and "a press, a cancelled drag or a key that moves nothing leaves the default card unstored" checks the 14 px right gap, which is unchanged, and Shift+ArrowDown now moves the card the full 64 px to the bottom edge before its arrow keys find nothing to move.

- [ ] **Step 6: Run the new test against the old default, then the spec**

To see the new test fail against the old default, temporarily set `bottomInset: 14` in `layout-defaults.ts` (an edit, not a stash: the stash stack is shared with other worktrees), then

Run (sandbox disabled: the run starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-structure.spec.ts -g "Copy IDs and Clear"`
Expected: FAIL, 1 test: the trial click on Copy IDs or Clear times out after 5 s with "`<section …>` intercepts pointer events" (the card covers it). If it passes, the old default did not cover the bar at this size: record both boxes in the report as a finding for the reviewer, restore `bottomInset: 64` and go on (the user decided on the higher default regardless; the test still guards the new one).

Set `bottomInset: 64` again, then

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-structure.spec.ts`
Expected: PASS, every test in the spec (one more than before; record both counts).

Run: `git diff --stat` and confirm `apps/web/src/explore/layout-defaults.ts` holds `bottomInset: 64`.

- [ ] **Step 7: Commit**

Run: `pnpm exec prettier --check apps/web/src/explore/layout-defaults.ts apps/web/src/workbench/layout-geometry.ts apps/web/src/workbench/layout-geometry.test.ts apps/web/tests/workbench-structure.spec.ts`
Expected: all pass.

```bash
git add apps/web/src/explore/layout-defaults.ts apps/web/src/workbench/layout-geometry.ts \
  apps/web/src/workbench/layout-geometry.test.ts apps/web/tests/workbench-structure.spec.ts
git commit -m "fix(web): the floating structure card starts above the selection bar"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`).

Report: the test counts before and after, the Step 6 failure message, and that `docs/explore/structures.md`'s "at its bottom-right corner" still describes the card (no docs edit; the exit regenerates `structure-floating.png` and its dark twin).

### Task 8.12: Ctrl/⌘K opens search on a phone

On a phone (and landscape phone) search is closed behind the app bar's search button, and Ctrl/⌘K focuses an input that is `display: none`, so nothing happens. While the bar is compact and search is closed, the app bar now opens search on Ctrl/⌘K, as the search button does.

**Files:**

- Modify: `apps/web/src/workbench/AppBar.tsx` (`AppBar`, :75–110: a new effect after `closeSearch`)
- Modify: `apps/web/tests/mobile-bars.spec.ts` (`test.describe('search on a phone')` :567: a new test after "search stays open when the window loses focus")

**Interfaces:**

- Consumes: `AppBar`'s `compact` (`hasStructureSheet(layoutMode)`: phone or landscape), `searchOpen` (`compact && searchWanted`), `openSearch()` (`flushSync(() => setSearchWanted(true))`, then `ProtspaceProteinSearch.focusInput()` on `#myProteinSearch`); `protein-search.ts`'s window `keydown` handler (`_handleBodyKeydown`, `(metaKey || ctrlKey) && key === 'k'` → `preventDefault()` and focus the input; unchanged); e2e helpers `appBar`, `searchInput` (`helpers/explore.ts`), `openExplorePhone`, `searchToggle` (`helpers/mobile.ts`), the spec's local `workbench(page)` (`.workbench`).
- Produces: a `useEffect` in `AppBar` that, while `compact && !searchOpen`, adds a `window` `keydown` listener: `(event.metaKey || event.ctrlKey) && event.key === 'k' && !event.isComposing` → `event.preventDefault()`, `openSearch()`; removed when the condition ends or on unmount. Desktop and tablet behaviour unchanged (no listener there; `protein-search.ts` focuses the visible field as before).

**Tests:**

- `mobile-bars.spec.ts` (`--project=mobile`, Pixel 7): "Ctrl+K opens search over the app bar with focus in the field" (search closed first; `page.keyboard.press('Control+k')`: `appBar` has `data-search-open`, the search button is `aria-expanded="true"`, `searchInput` is focused; the same on a phone on its side, 740 × 360).
- Run: that spec, filtered with `-g "with focus in the field"` (the new title's unique words; `-g` is a regular expression, so "Ctrl+K" would not match itself).
- Unrun at task time (exit): `workbench-search.spec.ts` (desktop Ctrl+K), `mobile-a11y.spec.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. The e2e runs start their own server and need the sandbox disabled. Playwright's `ControlOrMeta` sends Meta on a macOS host while the app reads the modifier the page sees, so the spec presses `Control` explicitly (Global Constraints).

- [ ] **Step 1: Write the failing phone test**

In `apps/web/tests/mobile-bars.spec.ts`, inside `test.describe('search on a phone', () => { … })`, directly after the closing `});` of `test('search stays open when the window loses focus', …)`, add:

```ts
  test('Ctrl+K opens search over the app bar with focus in the field', async ({ page }) => {
    await openExplorePhone(page);
    await expect(searchInput(page)).toBeHidden();

    // A hardware keyboard on a phone: the shortcut opens search as the search button does.
    await page.keyboard.press('Control+k');
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput(page)).toBeFocused();

    // On its side too; Escape closes search first and hands focus back to the search button.
    await page.keyboard.press('Escape');
    await expect(appBar(page)).not.toHaveAttribute('data-search-open');
    await page.setViewportSize({ width: 740, height: 360 });
    await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');
    await expect(searchInput(page)).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(appBar(page)).toHaveAttribute('data-search-open', '');
    await expect(searchInput(page)).toBeFocused();
  });
```

Every name it uses is already imported or declared in the file (`appBar`, `searchInput` from `./helpers/explore`; `openExplorePhone`, `searchToggle` from `./helpers/mobile`; the module-level `workbench`).

- [ ] **Step 2: Run it and see it fail**

Run (sandbox disabled: the run starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=mobile mobile-bars.spec.ts -g "with focus in the field" --timeout=20000`
Expected: FAIL, 1 test: `expect(locator).toHaveAttribute` on the app bar times out with `data-search-open` absent (the search's own handler focused the hidden field and nothing opened search).

- [ ] **Step 3: The app bar opens search on Ctrl/⌘K while compact and closed**

In `apps/web/src/workbench/AppBar.tsx`, inside `AppBar`, directly after

```tsx
  const closeSearch = (returnFocus: boolean) => {
    setSearchWanted(false);
    if (returnFocus) toggleRef.current?.focus();
  };
```

add:

```tsx
  // Ctrl/⌘K on a phone. Closed, the field is display: none, so the search's own shortcut focuses
  // nothing: open search as the search button does, which shows the field and focuses it. Wider,
  // or with search open, the search's own handler is enough and this listener is gone.
  useEffect(() => {
    if (!compact || searchOpen) return;
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'k' || event.isComposing) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [compact, searchOpen]);
```

`globalThis.KeyboardEvent` is the DOM event: the file imports React's `KeyboardEvent` type for `onKeyDown`, which would otherwise shadow it. `openSearch` is recreated each render but only calls the stable `setSearchWanted` and reads the element by id, so the listener from the render that registered it is correct; the effect re-runs when `compact` or `searchOpen` changes, and opening search (which sets `searchOpen`) removes the listener. The search's window handler may run before or after this one: it calls `preventDefault()` and focuses the field, which is either still hidden (no effect) or already shown (focus stays in the field).

- [ ] **Step 4: Run it and see it pass**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=mobile mobile-bars.spec.ts -g "search on a phone"`
Expected: PASS, every test in `describe('search on a phone')` (one more than before; record both counts).

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors.

Run: `pnpm exec prettier --check apps/web/src/workbench/AppBar.tsx apps/web/tests/mobile-bars.spec.ts`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workbench/AppBar.tsx apps/web/tests/mobile-bars.spec.ts
git commit -m "fix(web): Ctrl or Cmd+K opens search on a phone"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`).

Report: the `search on a phone` counts before and after, and the Step 2 failure message.

### Task 8.13: The e2e specs reach the figure editor through the shared helpers

Four specs still spell the figure editor's host and preview selectors by hand although `helpers/figure.ts` exports them, so a change to the editor's markup would need five edits instead of one (design 19: one set of helpers). Locator swaps only; each test asserts what it asserted before. A fifth spelling, in the helpers' own spec, goes too, so the rule "only `figure-editor.spec.ts` names the modal" holds.

**Files:**

- Modify: `apps/web/tests/mobile-legend.spec.ts` (:206 `page.locator('protspace-publish-modal')`; import)
- Modify: `apps/web/tests/workbench-escape.spec.ts` (:181, :185; import)
- Modify: `apps/web/tests/workbench-import-export.spec.ts` (:241, :255; import)
- Modify: `apps/web/tests/workbench-theme.spec.ts` (:303–304, the modal and `.publish-preview-canvas`; import)
- Modify: `apps/web/tests/workbench-helpers.spec.ts` (:460–462 in "openFigureEditor opens the figure editor"; import). Without it the task's own check (`grep` lists only `figure-editor.spec.ts`) fails.

**Interfaces:**

- Consumes: `figureEditorContent(page): Locator` (`page.locator('protspace-publish-modal')`), `figurePreviewCanvas(page): Locator` (`figureEditorContent(page).locator('canvas.publish-preview-canvas')`) from `apps/web/tests/helpers/figure.ts`. The specs' `getByRole('dialog', { name: 'Figure editor' … })` locators are role locators, not hand-written markup, and stay (one passes `exact: true`, which `figureEditor(page)` does not).
- Produces: no hand-written `protspace-publish-modal` or `publish-preview-canvas` selector in any spec except `figure-editor.spec.ts` (its `document.querySelector` reads inside `evaluate` stay, R1 note 6, and so do its two `page.locator('protspace-publish-modal …')` chains at :276 and :437, which the ruling leaves with that file); how each test opens the editor is unchanged (`workbench-escape.spec.ts` keeps its `open-publish-editor` dispatch).

**Tests:**

- `grep -n "protspace-publish-modal\|publish-preview-canvas" apps/web/tests/*.spec.ts` lists only `figure-editor.spec.ts`.
- Run: `workbench-import-export.spec.ts -g "figure editor"` (`--project workbench`); `pnpm --filter @protspace/app exec tsc -p tsconfig.e2e.json` (the e2e tsconfig has `noEmit`).
- Unrun at task time (exit): `mobile-legend.spec.ts`, `workbench-escape.spec.ts`, `workbench-theme.spec.ts`, `workbench-helpers.spec.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. This is a locator swap with no behaviour to drive red first: the "failing" check is the grep, which lists the hand-written selectors before the swap and none after.

- [ ] **Step 1: See the hand-written selectors**

Run: `grep -n "protspace-publish-modal\|publish-preview-canvas" apps/web/tests/*.spec.ts | grep -v "^apps/web/tests/figure-editor.spec.ts"`
Expected (the target of this task), 8 lines:

```
apps/web/tests/mobile-legend.spec.ts:206:      const modal = page.locator('protspace-publish-modal');
apps/web/tests/workbench-escape.spec.ts:181:    const editor = page.locator('protspace-publish-modal');
apps/web/tests/workbench-escape.spec.ts:185:    const canvas = (await editor.locator('canvas.publish-preview-canvas').boundingBox())!;
apps/web/tests/workbench-helpers.spec.ts:461:      .locator('protspace-publish-modal .publish-preview-canvas')
apps/web/tests/workbench-import-export.spec.ts:241:    await expect(page.locator('protspace-publish-modal')).toBeAttached();
apps/web/tests/workbench-import-export.spec.ts:255:    await expect(page.locator('protspace-publish-modal')).toHaveCount(0);
apps/web/tests/workbench-theme.spec.ts:303:    const modal = page.locator('protspace-publish-modal');
apps/web/tests/workbench-theme.spec.ts:304:    const preview = modal.locator('.publish-preview-canvas');
```
 If a line number has moved, apply the swap at the line that holds the same code.

- [ ] **Step 2: mobile-legend.spec.ts**

After `import { exportMenu, selectAnnotation } from './helpers/explore';` add:

```ts
import { figureEditorContent } from './helpers/figure';
```

In `test('G8: the Figure editor fits the screen, …')`, replace

```ts
      const modal = page.locator('protspace-publish-modal');
```

with

```ts
      const modal = figureEditorContent(page);
```

The comment above it ("The editor's content is slotted into the dialog, so it is found from the modal's host.") stays: it explains why the content, not the dialog, is measured.

- [ ] **Step 3: workbench-escape.spec.ts**

After the `./helpers/explore` import block (the line `} from './helpers/explore';`) add:

```ts
import { figureEditorContent, figurePreviewCanvas } from './helpers/figure';
```

In `test('in the figure editor, Escape never clears the plot’s selection', …)`, replace

```ts
    const editor = page.locator('protspace-publish-modal');
```

with

```ts
    const editor = figureEditorContent(page);
```

and replace

```ts
    const canvas = (await editor.locator('canvas.publish-preview-canvas').boundingBox())!;
```

with

```ts
    const canvas = (await figurePreviewCanvas(page).boundingBox())!;
```

The `exportMenu(page).evaluate(… 'open-publish-editor' …)` dispatch above them stays (setup, not a selector).

- [ ] **Step 4: workbench-import-export.spec.ts**

After the `./helpers/explore` import block (`} from './helpers/explore';`) add:

```ts
import { figureEditorContent } from './helpers/figure';
```

In `test('the figure editor opens from Export', …)`, replace

```ts
    await expect(page.locator('protspace-publish-modal')).toBeAttached();
```

with

```ts
    await expect(figureEditorContent(page)).toBeAttached();
```

In `test('Escape closes the figure editor and the selection stays', …)`, replace

```ts
    await expect(page.locator('protspace-publish-modal')).toHaveCount(0);
```

with

```ts
    await expect(figureEditorContent(page)).toHaveCount(0);
```

- [ ] **Step 5: workbench-theme.spec.ts**

After the `./helpers/explore` import block (`} from './helpers/explore';`) add:

```ts
import { figureEditorContent, figurePreviewCanvas } from './helpers/figure';
```

In `test('the figure editor previews a transparent figure on light paper in Dark', …)`, replace

```ts
    const modal = page.locator('protspace-publish-modal');
    const preview = modal.locator('.publish-preview-canvas');
```

with

```ts
    const modal = figureEditorContent(page);
    const preview = figurePreviewCanvas(page);
```

`modal` stays: the test reads the background `select.publish-select` from it.

- [ ] **Step 6: workbench-helpers.spec.ts**

Replace the import

```ts
import { figureEditor, openFigureEditor } from './helpers/figure';
```

with

```ts
import { figureEditor, figurePreviewCanvas, openFigureEditor } from './helpers/figure';
```

In `test('openFigureEditor opens the figure editor', …)`, replace

```ts
    const size = await page
      .locator('protspace-publish-modal .publish-preview-canvas')
      .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
```

with

```ts
    const size = await figurePreviewCanvas(page).evaluate((canvas: HTMLCanvasElement) => [
      canvas.width,
      canvas.height,
    ]);
```

(Prettier's layout of that call; run `pnpm exec prettier --write apps/web/tests/workbench-helpers.spec.ts` if it chooses another.)

- [ ] **Step 7: Check the selectors are gone and the specs type-check**

Run: `grep -n "protspace-publish-modal\|publish-preview-canvas" apps/web/tests/*.spec.ts | grep -v "^apps/web/tests/figure-editor.spec.ts"`
Expected: no output.

Run: `pnpm --filter @protspace/app exec tsc -p tsconfig.e2e.json`
Expected: no errors.

Run: `pnpm exec prettier --check apps/web/tests/mobile-legend.spec.ts apps/web/tests/workbench-escape.spec.ts apps/web/tests/workbench-import-export.spec.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/workbench-helpers.spec.ts`
Expected: all pass.

- [ ] **Step 8: Run one spec**

Run (sandbox disabled: the run starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-import-export.spec.ts -g "figure editor"`
Expected: PASS, 2 tests ("the figure editor opens from Export", "Escape closes the figure editor and the selection stays").

- [ ] **Step 9: Commit**

```bash
git add apps/web/tests/mobile-legend.spec.ts apps/web/tests/workbench-escape.spec.ts \
  apps/web/tests/workbench-import-export.spec.ts apps/web/tests/workbench-theme.spec.ts \
  apps/web/tests/workbench-helpers.spec.ts
git commit -m "test(e2e): reach the figure editor through the shared helpers"
```

Run the commit with the sandbox disabled (the hook runs `pnpm precommit`; knip now sees `figureEditorContent` and `figurePreviewCanvas` imported by specs).

Report: the Step 1 and Step 7 grep outputs and the Step 8 count.

### Task 8.14: feat/mobile-responsive is archived as archive/mobile-landing and deleted

The unmerged local branch `feat/mobile-responsive` holds nine landing-page commits the workbench did not carry over (design excludes the landing page). The user agreed to keep them on a local branch `archive/mobile-landing` and delete the old branch. Refs only: no file in the worktree changes, nothing is pushed.

**Files:**

- None in the worktree. Git refs: create `archive/mobile-landing`; delete `feat/mobile-responsive`.

**Interfaces:**

- Consumes: `feat/mobile-responsive` at `1a6e3405` (`1a6e340576cf74b3bd425bffbed762138983e57b`, "docs(openspec): bring mobile-responsive-ui up to the reviewed design"), merge base with `main` `fbd99730` (`fbd997307757d06ba508761ad96c030e57448dc1`), no upstream configured; the nine landing commits `ed02b8d3`, `3e9a2678`, `570a3ad3`, `241cfaca`, `a5dd1350`, `d47909a4`, `a5b3c467`, `e62d3d2e`, `dfe24eee` (paths `apps/web/index.html`, `apps/web/src/components`, `apps/web/src/landing`, `apps/web/src/pages/NotFound.tsx`, `apps/web/src/pages/Privacy.tsx`).
- Produces: `archive/mobile-landing` → `1a6e3405`; no `feat/mobile-responsive`; no remote ref for either.

**Tests (verification, in order; stop and report BLOCKED on any mismatch):**

- Before: `git rev-parse feat/mobile-responsive` is `1a6e3405…`; `git worktree list` shows no worktree on it; `git branch -r --list '*mobile*'` is empty; `git branch --list archive/mobile-landing` is empty.
- Create: `git branch archive/mobile-landing feat/mobile-responsive`.
- Verify: `git rev-parse archive/mobile-landing` equals the old tip; `git log fbd99730..archive/mobile-landing -- <the landing paths>` lists exactly the nine SHAs; each passes `git merge-base --is-ancestor <sha> archive/mobile-landing`; `git rev-list --count fbd99730..archive/mobile-landing` is 55.
- Delete: `git branch -D feat/mobile-responsive`; then `git branch --list feat/mobile-responsive` is empty and `git status --short` on `feat/explore-workbench` is clean.
- Never `git push`.

Report: the commands' outputs and the nine SHAs with subjects. Commit: none (refs only).

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`, inside the sandbox: `git branch` writes refs only, under the main checkout's `.git`, which the sandbox allows. Branches are shared by every worktree of this repository, so these commands act on the one `feat/mobile-responsive` ref the user agreed to retire and touch no other branch. No command here changes `feat/explore-workbench`, its index or its files, and none may run `git checkout`, `git switch`, `git reset`, `git stash`, `git push` or `git gc`.

- [ ] **Step 1: Check the starting state**

Run each and compare with the expected output; on any difference stop and report BLOCKED with the output.

Run: `git rev-parse feat/mobile-responsive`
Expected: `1a6e340576cf74b3bd425bffbed762138983e57b`

Run: `git worktree list | grep -F '[feat/mobile-responsive]'`
Expected: no output (no worktree has the branch checked out, so it can be deleted).

Run: `git branch -r --list '*mobile*'`
Expected: no output (it was never pushed).

Run: `git config --get branch.feat/mobile-responsive.remote`
Expected: no output, exit status 1 (no upstream).

Run: `git branch --list archive/mobile-landing`
Expected: no output (the name is free).

Run: `git rev-list --count fbd99730..feat/mobile-responsive`
Expected: `55`

Run: `git status --short`
Expected: no output (the worktree on `feat/explore-workbench` is clean; remember its HEAD with `git rev-parse HEAD` for Step 4).

- [ ] **Step 2: Create the archive branch**

Run: `git branch archive/mobile-landing feat/mobile-responsive`
Expected: no output, exit status 0.

- [ ] **Step 3: Verify the archive holds the landing work**

Run: `git rev-parse archive/mobile-landing`
Expected: `1a6e340576cf74b3bd425bffbed762138983e57b` (equal to Step 1's tip).

Run: `git rev-list --count fbd99730..archive/mobile-landing`
Expected: `55`

Run: `git log --format='%h %s' --abbrev=8 fbd99730..archive/mobile-landing -- apps/web/index.html apps/web/src/components apps/web/src/landing apps/web/src/pages/NotFound.tsx apps/web/src/pages/Privacy.tsx`
Expected: exactly these nine lines, newest first:

```
dfe24eee fix(web): drop the open-menu header styling once the menu is hidden
e62d3d2e test(landing): cover the phone layout, tap tooltips and the menu
a5b3c467 feat(landing): keep chip group labels in view while the row scrolls
d47909a4 feat(web): tune the privacy and 404 pages for phones, add theme-color
a5dd1350 feat(landing): give landing links and buttons finger-sized targets
241cfaca feat(web): make the header menu touch-sized and easy to dismiss
570a3ad3 feat(landing): fit the showcase controls and legend to phones
3e9a2678 feat(landing): lead the phone hero with one primary action
ed02b8d3 feat(landing): inspect map points by tap on touch screens
```

(If git prints longer abbreviations because a prefix is ambiguous, compare the leading eight characters.)

Run:

```bash
for sha in ed02b8d3 3e9a2678 570a3ad3 241cfaca a5dd1350 d47909a4 a5b3c467 e62d3d2e dfe24eee; do
  git merge-base --is-ancestor "$sha" archive/mobile-landing && echo "ok $sha" || echo "MISSING $sha"
done
```

Expected: nine `ok …` lines, no `MISSING`.

- [ ] **Step 4: Delete the old branch**

Run: `git branch -D feat/mobile-responsive`
Expected: `Deleted branch feat/mobile-responsive (was 1a6e3405).` (git may print a longer abbreviation.) `-D`, not `-d`: the branch is not merged into anything, which is why it is archived first.

Run: `git branch --list feat/mobile-responsive`
Expected: no output.

Run: `git branch --list archive/mobile-landing`
Expected: `  archive/mobile-landing`

Run: `git branch -r --list '*mobile*'`
Expected: no output (nothing was pushed).

Run: `git status --short && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD`
Expected: no status lines; `feat/explore-workbench`; the same HEAD as in Step 1.

- [ ] **Step 5: Report**

No commit: only refs changed. Report every command's output from Steps 1–4, and the nine landing commits with their subjects (Step 3's `git log` output) for whoever picks the landing phone work up, with one line saying the commits interleave with the branch's layout and header commits, so they are kept as the whole branch (55 commits on `fbd99730`) rather than cherry-picked.

## Phase 8A exit

1. **Baseline already recorded** at the phase start; compare against it.
2. **Unit and browser suites:** `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/app exec vitest --run`. Counts in the exit report against the baseline; new files listed. `scatter-plot.render-coalescing.test.ts`'s two tooltip cases are the hover's render pin (no perf segment drives a hover).
3. **E2E, both projects:** `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (all default projects), then `--project=mobile` three times, then `product-tour.spec.ts` once. Run every task's "Unrun at task time" spec first and alone. A red run is investigated, never called flaky on local passes alone (AGENTS.md); the known flakes are re-run once alone.
4. **Perf:** `pnpm perf:counts` (every budget; the legend counters per segment equal the baseline's; it needs `perf/datasets/phosphatase.parquetbundle`, present today; if missing, `pnpm perf:fetch --only phosphatase`, network, sandbox disabled) and `pnpm perf --datasets /private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p4/v3/573K_swissprot.parquetbundle --runs 4` (warm-up included; the v3 bundle phase 7's exit report calls `scratchpad/p4/v3/573K_swissprot.parquetbundle`, 36 MB), every segment at or below phase 7's numbers in `.superpowers/sdd/phase-7-docs/phase-7-exit-report.md`. `perf/datasets/573K_swissprot.parquetbundle` is a different (older, 45 MB) file: do not substitute it. If the v3 file is gone, report that instead of running on another dataset.
5. **Checks:** `pnpm quality`, `pnpm format:check`, `pnpm docs:annotations:check`, `pnpm docs:examples:check`, `pnpm docs:images:check`, `pnpm docs:build`, then `pnpm precommit` once as one command.
6. **Docs images:** text sizes, fonts and the structure control changed. The captures read `dist`, so first `pnpm --filter @protspace/utils build && pnpm --filter @protspace/core build`, then run the full `pnpm docs:images` (sandbox disabled, network for Mol* and AlphaFold), check `pnpm docs:images:check`, and commit the regenerated set alone as `docs(explore): regenerate every docs image`. Review the diff of the tooltip, structure and floating-card images by eye.
7. **Sizes and leftovers:** `wc -l` of every element file in `packages/core/src` over 600 lines (only `scatter-plot.ts` above 800, recorded); `legend.ts`, `projection-metadata.ts` and the new modules; `grep -rnE "styles/tokens|overlay-mixins|styles/mixins|LEGACY([^_A-Z]|$)|protspace-legend-state-change|--protspace-viewer-|--text-caption|var\(--z-" packages/core/src apps/web/src` prints nothing (the pattern skips unrelated names such as `LEGACY_SHAPE_SIZE_KEY` and `LEGACY_TOUR_STORAGE_KEY`).
8. **Screenshots for the user** (light and dark where it matters, into `.superpowers/sdd/phase-8a-cleanup/screenshots/`): the structure viewer's colour control with TED disabled and its tooltip; the same at a 240 px docked sidebar (the kit's 13 px labels on one row); a hover tooltip with an annotation header and evidence; the plot's chips; the floating card's default with the selection bar at 1280×720, sidebar open; the phone with search opened by Ctrl+K; the projection details card.
9. **Records:** tick 8.1–8.14 in `tasks.md` in one `docs(openspec): tick phase 8A of the explore workbench` commit; the exit report lists the moved-member maps of 8.6–8.9 for part B's rebase, the line counts, and part B's device-checklist carry-overs (the phone tour's "Interactive Scatterplot" popover over the legend, the fast legend drag, the landscape ≤500 px scroll, the legend handle's 250 ms hold). The exit report also tells the user that their memory entry "Mobile responsive UI" (which names the local branch `feat/mobile-responsive`) should now point at `archive/mobile-landing`; agents cannot write the memory directory.

<!-- prettier-ignore-end -->
