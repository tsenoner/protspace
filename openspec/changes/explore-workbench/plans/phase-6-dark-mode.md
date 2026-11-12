# Explore Workbench, Phase 6: Dark mode (theme switch and first paint, plot and Mol\* colours from tokens with light exports, remaining surfaces, palette contrast and accessibility in both themes) — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dark theme next to the light one (design decision 16). A theme switch (System, Light, Dark) sits in the app bar between Export and Help on desktop and tablet, and in the More sheet on phones; the choice persists under `protspace:theme` and an inline script in `index.html` sets `data-theme` before first paint, on `/explore` only, so the page never flashes white and the landing, privacy and docs pages keep their look. Everything on the explore page follows: the shell, the kit, the legend, the plot's background, neutral point greys (Other, N/A), its overlays (brush, lasso, EAT connectors and endpoint ring, spiderfy), the tooltip and projection card, the structure frame and the Mol* canvas, the loading veils, the notifications, the wordmark and the product tour. Category palettes do not change; the default palettes pass a contrast gate on the dark plot background. Exports and the figure editor's preview stay light whatever the theme. Role tokens and the main states pass contrast and axe checks in both colour schemes. The default flips from Light to System in the phase's last commit.

**Architecture:** Tokens stay the single source (`packages/core/src/styles/theme.ts`, `@layer ps-theme`, light on `:root`, dark under `[data-theme='dark']` and under `[data-theme='system']` when the OS prefers dark); this phase adds the plot tokens and a handful of role tokens, and the CSS cascade does all the theming that CSS can do. The app owns the choice: a leaf module `apps/web/src/explore/theme-defaults.ts` (key, choices, default) and a store `apps/web/src/explore/theme-state.ts` (`getTheme`/`subscribeTheme`/`setTheme`/`applyTheme`, JSON-encoded through `@protspace/utils` storage) that the React shell reads with `useSyncExternalStore`; `Explore.tsx` applies the attribute in a layout effect and removes it on unmount. `index.html` carries a marked boot `<script>` (after the GitHub Pages redirect) and an unlayered first-paint `<style>` with the literal dark surface. Core never imports the app: what JavaScript must know about the theme (the WebGL renderer, Mol*) it learns from one core watcher, `observeTheme` (`packages/core/src/utils/theme-observer.ts`: a `MutationObserver` on `<html>`'s `data-theme`, `class` and `style`, plus the `prefers-color-scheme` change event), and from the token values themselves, compared before anything is redrawn. The plot's `PlotTheme` (replacing `BackgroundColorCache`) reads `--ps-plot-other` and `--ps-plot-na`, and on a real change restyles through the existing colour-only path (`invalidateGetters` → `invalidateCategoryStyles` → one render). The style getters take the neutral greys as an input; exports stage through separate light getters and a fixed white knockout. Surfaces still on the legacy `tokens.ts` colour aliases move to `--ps-*`; a colour-only lint keeps the legacy modules honest until phase 8 deletes them.

**Tech Stack:** Lit 3 (legacy decorators), TypeScript 6, Vite 8, Vitest 4.1.9 (core: jsdom `unit` and Chromium `browser` projects; utils and app: node), Playwright 1.61 (projects `workbench` Desktop Chrome 1280×720 for `workbench-*.spec.ts`, `mobile` Pixel 7 for `mobile-*.spec.ts`, `perf-counts`; `colorScheme` emulation; `@axe-core/playwright` ^4.13), React 19, Sonner 2, driver.js (tour), Mol* 3.44.0 UMD from jsDelivr, the kit (`ps-*`, `kit/layers.ts`, `@floating-ui/dom`), Lucide 0.462.

**Spec:** `openspec/changes/explore-workbench/design.md`: decision 16 (dark mode) is the core; also 5 (tokens on `:root`, `@layer ps-theme`, the style lint), 6 (palette Cool: the accent values per theme), 8 (the kit), 10 (stores and `protspace:theme`), 17 (phones: the Theme row in the More sheet), 18 (one way to do each job; files of about 800 lines), 20 (testing: axe in both themes, a contrast check of the role tokens). `proposal.md` for scope. `tasks.md` section 6, rewritten to this plan's thirteen tasks in the commit that adds the plan. Research notes `.superpowers/research/phase-6/R1`–`R3` map the current code with file:line; the user adopted every recommended answer in them (see Rulings for where notes disagreed and how it was settled). Not pulled in: the docs images and their dark variants (7.2, 7.3; the list of dark captures is in "Phase 6 exit"), the tour's rewrite and "What's new" tour (7.4; this phase only restyles the tour), the user guide's theme section (7.5), deleting `tokens.ts`, `mixins.ts` and `overlay-mixins.ts` and emptying `LEGACY` (8.1), the real-device pass (8.2).

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. This plan was written against `a5a81b25` (phase 5 complete). If an anchor has moved, apply the intended change to the current code and say so in the report.

## Global Constraints

From phases 1–5, unchanged:

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
- Runtime elements are rendered by React exactly once, unconditionally, with stable ids, never keyed or moved; phone, tablet and landscape layouts are CSS on the same tree. The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions` and `help` are kept for the tour, the e2e and the perf suites. `#myDataLoader` stays mounted, hidden. `#myStructureViewer` never changes parent (a disconnect disposes Mol*).
- React → runtime goes through the layout store or DOM events on elements the runtime wires by id; a React component may also call a public method of a core element it finds by id, but never reads runtime state off an element. Runtime → React goes through `workbench-status.ts` or `layout-state.ts`. React sets kit properties through props and listens to `ps-*` events with a ref and `addEventListener`.
- The shell (`apps/web/src/workbench/`) imports `@protspace/core` only as types (ESLint guard, `eslint.config.mjs`); values it needs come from `@protspace/utils` or the app's own modules (`apps/web/src/explore/*`, `apps/web/src/lib/*`). Kit elements are used as custom-element tags.
- No ancestor of `#myImportMenu`, `#myExportMenu`, or any element that holds a popover gets `display: none` in any layout: a `popover="manual"` inside a `display: none` subtree opens as a 0×0 box. On phones and in landscape `[data-workbench='app-bar-actions']` is rendered at 0×0 and hides every child except `.wb-data-actions` and `ps-menu` (`workbench.css` ~911 and ~1569).
- One plot resize per layout change; the plot never animates. A theme change is not a layout change: it never changes `#myPlot`'s box.
- Layout persists only under `protspace:layout:v1`; layout never goes into the URL. Stored legend settings, `protspace_publishState` and the OPFS `protspace-last-import` directory keep their keys and formats.
- The legend's public surface, DOM contract and persistence stay as phases 3–5 left them. The legend adds no window listener. New legend logic goes into `legend-*.ts` modules or controllers, not `legend.ts` (2,188 lines); report `wc -l legend.ts` when touched. `scatter-plot.ts` (2,622 lines) and `structure-viewer.ts` (625) take only wiring this phase; new logic goes into modules beside them (`styling/plot-theme.ts`, `utils/theme-observer.ts`); report `wc -l` of each when touched.
- E2E: desktop specs stay `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Phone, tablet and landscape specs are `apps/web/tests/mobile-*.spec.ts` (project `mobile`, Pixel 7). Specs reach controls through helpers (`helpers/explore.ts`, `helpers/workbench.ts`, `helpers/legend.ts`, `helpers/mobile.ts`, and this phase's `helpers/theme.ts` and `helpers/a11y.ts`) that find them by role, accessible name or tag; a helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement, state and computed colours, not 3D pixels (except the WebGL plot pixels this phase samples, as `density-layer.spec.ts:67-85` does).
- Docs: the developer docs (`docs/developers/`) change in the commit that changes the public API or the architecture they describe. The user guide (`docs/explore/`) and its images wait for phase 7 (7.5 documents the theme switch), except a statement that would become false.
- `pnpm docs:images` stays broken at runtime until phase 7; `pnpm type-check:scripts` (in the hook) must stay green.

The kit, the layer stack and the style lint as phases 1–5 left them (read `packages/core/src/components/kit/` for the exact API; these facts override older descriptions):

- Tokens live in `@layer ps-theme` in `theme.ts`: `lightRoles` and `sizes` on `:root` (`color-scheme: light`), `darkRoles` under `:root[data-theme='dark']` and under `@media (prefers-color-scheme: dark) { :root[data-theme='system'] }` (`color-scheme: dark`). A `data-theme='system'` page already follows the OS live in pure CSS. Role tokens (26, same names in both blocks): `--ps-surface`, `-surface-muted`, `-surface-raised`, `-surface-hover`, `--ps-border`, `-border-strong`, `-border-control`, `--ps-text`, `-text-muted`, `-text-faint`, `-text-on-accent`, `--ps-accent`, `-accent-hover`, `-accent-text`, `-accent-tint`, `--ps-focus`, `--ps-danger`, `--ps-warning`, `--ps-success`, `--ps-tooltip-bg`, `--ps-tooltip-text`, `--ps-scrim`, `--ps-shadow-sm`, `-md`, `-lg`. Dark `--ps-surface` is `#0f172a`. Sizes include `--ps-control-sm` 28, `-md` 32, `--ps-row` 28, `--ps-touch-target` 40 px; spaces `--ps-space-0-5` 2 … `-6` 24 px (no 16); radii `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`; type `--ps-text-xs` 11 … `-xl` 20; `--ps-focus-width`, `--ps-focus-offset`; `--ps-duration-fast` 120 ms, `--ps-duration` 160 ms, `--ps-ease`. A task that needs a token `theme.ts` lacks adds it in the commit that first uses it (the unused-token check scans core sources and `apps/web/src` `.ts`/`.tsx`/`.css` for a reader).
- `adoptTheme()` (`kit/adopt-theme.ts`) runs when `@protspace/core/kit` is imported, which only the lazy Explore chunk does (`pages/Explore.tsx:4`, `App.tsx:10`, `Suspense fallback={null}`); landing and privacy never load the token sheet on a cold load.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) checks every core stylesheet outside its `LEGACY` set (7 modules: `projection-metadata.styles.ts`, `scatter-plot.styles.ts`, `protein-tooltip.styles.ts`, `structure-viewer.styles.ts`, `./mixins.ts`, `./overlay-mixins.ts`, `./tokens.ts`): no raw colour, no `oklch()`/`lab()`/`color()`, no literal font size, no `--ps-*` declaration, no `var()` read of a variable `theme.ts` does not define except `RUNTIME_VARS` (`--available-height`, `--available-width`, `--picker-room`; Task 6.6 adds `--protspace-tooltip-max-height` and `--protspace-tooltip-effective-width`, set inline by `tooltip-position.ts`). Task 6.6 also adds the colour-only helpers `ownCssOf`, `OWNER`, `STRIP_COMMENTS`, `LEGACY_VARS`, `COLOUR_ALIASES`, `colourViolations` and `STILL_COLOURED`, module-level in the same file. A `LEGACY` entry must still violate; a task whose module comes out fully clean removes its line in the same commit. `cssViolations(cssText)`, `cssOf(path)`, `COLOUR`, `DEFINED`, `CORE_SRC`, `WEB_SRC` are module-level in the test file. Every task states its LEGACY count (7 unless a module comes out fully clean).
- `customElement` comes from `../../utils/safe-custom-element`, never from `lit/decorators.js`. Feature elements import kit modules by file (`import '../kit/menu'`), not the kit barrel.
- `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void`, `topLayer()`, `onEscapeFallback(order, handle)`, `ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 }`.
- `ps-menu` (`anchor`, `open`, `placement`, `label`, `searchable`): sets `aria-haspopup`/`aria-expanded` on its anchor; `ps-close` before `ps-select` (`detail: { value, checked }`); focuses the checked `type="radio"` item on open. `ps-menu-item` (`value`, `type` `item|checkbox|radio`, `checked`) → `menuitemradio` with `aria-checked`, a check icon when checked. `ps-segmented` (`.options: SegmentedOption[]`, `value`, `label`; renders `role="radiogroup"` with `role="radio"` segments; `change` with `detail.value`). `ps-icon-button` (`icon: IconName`, `label`, `pressed`, `size`, `tooltip-placement`, `expanded`, `hasPopup`). `ps-dialog` (`open`, `heading`, `size` sm/md/lg/full/sheet, `dismissible`; `dismiss()`; `ps-close`).
- Icon keys present in `kit/icon.ts`: `arrow-down-0-1`, `arrow-down-1-0`, `arrow-down-a-z`, `arrow-down-narrow-wide`, `arrow-down-wide-narrow`, `arrow-down-z-a`, `arrow-up-down`, `box`, `check`, `chevron-down`, `chevron-up`, `circle-help`, `copy`, `download`, `ellipsis`, `external-link`, `eye`, `eye-off`, `filter`, `grip-vertical`, `info`, `lasso`, `list`, `maximize`, `minus`, `mouse-pointer`, `panel-right`, `panel-right-close`, `panel-right-open`, `picture-in-picture-2`, `search`, `sliders-horizontal`, `sparkles`, `square-dashed`, `square-pen`, `target`, `undo-2`, `upload`, `x`, `zoom-in`. This phase adds `sun`, `moon` and `sun-moon` (Task 6.2). The React shell uses `lucide-react` with `strokeWidth={1.75}`.
- Core's Vite build keeps `/^lit(\/|$)/`, `/^@floating-ui\//`, `d3` and `@protspace/utils` external.

Environment (from the phase 1–5 ledgers; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run need the Bash sandbox disabled (`EPERM listen ::1` inside it). `--project unit` works inside the sandbox. A browser test can size the page with `page.viewport(width, height)` from `vitest/browser`; browser tests that set `document.documentElement.dataset.theme` delete it in `afterEach`, as `styles/theme.browser.test.ts` does.
- `pnpm add`/`pnpm install` and `git commit` need the sandbox disabled (the hook needs network and writes outside it). Stage files by path, never `git add -A`.
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; use `pnpm --filter @protspace/app exec vitest --run <file>` and `pnpm --filter @protspace/utils exec vitest --run <file>`.
- App unit tests run in node with no DOM and cannot load Lit (`apps/web/vitest.config.ts`): stub `localStorage`, `window`, `document` and `matchMedia` with `vi.stubGlobal` (`layout-state.test.ts:38,266-271`); an app test that needs a core value imports it from core's source by relative path or mocks `@protspace/core`. A core test may read a repository file with `readFileSync` and a path joined from `fileURLToPath(import.meta.url)` (not `new URL(…, import.meta.url)`, which knip reads as an import). An app test cannot import `node:fs` (`tsconfig.app.json` has no Node types); it reads a file through `import.meta.glob('<relative path>', { query: '?raw', import: 'default', eager: true })`, as `src/explore/example-datasets-docs.test.ts` does. React components are covered by e2e only. Core jsdom tests cannot open `ps-popover`, `ps-menu` or `ps-dialog`, and jsdom resolves no custom property from the adopted theme: a test that reads computed colours or tokens is a `*.browser.test.ts` (real `localStorage`: clear it in `afterEach`).
- `@protspace/utils` `getStorageItem`/`setStorageItem` JSON-encode: a stored theme reads `"dark"` with the quotes, so anything reading the key raw (the boot script, e2e seeding) uses `JSON.parse`/`JSON.stringify`.
- `apps/web/index.html` has no CSP (GitHub Pages); its only inline script is the spa-github-pages redirect, which `replaceState`s `/?/explore` to `/explore` and must run before any path check. Vite leaves classic inline scripts and `<style>` untouched in dev and build. Vite `base` is `/`.
- Playwright contexts default to `colorScheme: 'light'`; the perf contexts pin it (`tests/helpers/perf/scenarios.ts:157`, `tests/perf-scale.spec.ts:150`, root `perf/playwright.config.ts:26`). `page.emulateMedia({ colorScheme })` flips `prefers-color-scheme` live without a reload.
- `pnpm perf:counts` imports `perf/datasets/phosphatase.parquetbundle` (fetch once with `pnpm perf:fetch --only phosphatase`, network, sandbox disabled); budgets live in `apps/web/tests/perf/budgets.json` (`PERF_UPDATE_BUDGETS=1 pnpm perf:counts` re-records; review the diff). Segments are listed in `SEGMENTS` (`tests/helpers/perf/scenarios.ts:55-70`) and defined as `{ name, act, reset?, setup?, pixels?, capture? }` entries further down the same file; `pixels: true` checks that the reset restores the frame. The `idle` segment requires 0 of everything.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build scans untracked files under `docs/`: leave no scratch markdown there.
- Playwright's `ControlOrMeta` sends Meta on a macOS host but the app reads the modifier from the user agent (Control in headless Chromium); use `Control` explicitly in specs that need the modifier.
- The plot area holds two `role="status"` regions (status corner and selection bar): scope `getByRole('status')` to its element. The dataset button's accessible name is `{name}, {n} proteins, switch dataset` (`datasetSwitcher` helper). Use `--project=mobile` (with `=`) for the mobile project.
- The e2e Mol* stub (`MOLSTAR_STUB` in `tests/helpers/workbench.ts:50-54`, installed by `stubStructureRequests(page)`) builds a viewer whose `plugin` has only `representation`; Mol* draws nothing in e2e.
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race), the `numeric-binning` "hover point" test under full-suite load, `mobile-plot-touch.spec.ts:351` (grip/header toggle, once in a full-file run); re-run once alone before investigating. The scatterplot's Lit "scheduled an update after an update completed" dev warning predates this phase (8.1 owns it).
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.

**Execution rule (user, 2026-10-13):** per task, run only the unit/browser test files for the code you touch plus at most ONE e2e spec file (filtered with `-g "<title>"` and `--project workbench` or `--project=mobile` as needed). The full suites, the full e2e run, `pnpm perf:counts` and `pnpm perf` run once, in "Phase 6 exit" — except that Task 6.4's one e2e spec is the `perf-counts` project, because it adds a segment and must record its budget. Every task lists the existing e2e specs its change could reach under "Unrun at task time" so the exit run checks them first.

Baseline: run the suites at the start of the phase and use those counts, not phase 5's: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`, `PLAYWRIGHT_PORT=8475 pnpm test:e2e` and `pnpm perf:counts`. Record them in `.superpowers/sdd/phase-6-dark-mode/progress.md`; every task report gives the counts of the files it ran before and after, its LEGACY count, and `wc -l` of `scatter-plot.ts`, `legend.ts` and `structure-viewer.ts` when it touches them.

Phase 6:

- **Theme choice.** `ThemeChoice = 'system' | 'light' | 'dark'`. Storage key `protspace:theme`, written through `setStorageItem` (JSON: `"dark"`). Any other stored value, a missing key or a throwing `localStorage` gives `DEFAULT_THEME`. `DEFAULT_THEME` is `'light'` from Task 6.1 until Task 6.13 flips it to `'system'` (the store and the boot script together, pinned equal by a test). The attribute on `<html>` is exactly the choice (`data-theme="system"` stays `system`; CSS follows the OS); it is present only while `/explore` is mounted (and from the boot script on a cold load of `/explore`). No cross-tab sync: another tab keeps its theme until it reloads.
- **Boot.** In `apps/web/index.html` `<head>`, after the `<!-- End Single Page Apps for GitHub Pages -->` comment: `<script data-theme-boot>` (classic, inline, ES5, no module) that returns unless `location.pathname` matches `/^\/explore\/?$/`, reads `localStorage.getItem('protspace:theme')` through `JSON.parse` inside `try`/`catch`, accepts only `'system'`, `'light'`, `'dark'`, else the default literal, and sets `document.documentElement.setAttribute('data-theme', t)`; then `<style data-theme-boot>` (unlayered) with `:root[data-theme='dark'], :root[data-theme='dark'] body { color-scheme: dark; background: #0f172a; }` and the same two selectors for `[data-theme='system']` inside `@media (prefers-color-scheme: dark)`. `#0f172a` is pinned to dark `--ps-surface` by `theme-boot.test.ts`.
- **New tokens (light / dark), each added by the task that first reads it:**

  | Token | Light | Dark | Task | Reader |
  | --- | --- | --- | --- | --- |
  | `--ps-plot-bg` | `#ffffff` | `#0b1120` | 6.4 | `scatter-plot.styles.ts` host background, spiderfy node rim (6.6) |
  | `--ps-plot-other` | `#888888` | `#64748b` | 6.4 | `PlotTheme` (TS), legend Other swatch and score-strip dot (6.7) |
  | `--ps-plot-na` | `#dddddd` | `#2a3547` | 6.4 | `PlotTheme` (TS), legend N/A swatch (6.7) |
  | `--ps-paper` | `#ffffff` | (same; declared once on `:root`) | 6.5 | figure editor preview |
  | `--ps-paper-check` | `#e2e8f0` | (same; declared once on `:root`) | 6.5 | figure editor preview checkerboard |
  | `--ps-plot-connector` | `#475569` | `#94a3b8` | 6.6 | EAT connector line |
  | `--ps-eat` | `#7c3aed` | `#a78bfa` | 6.6 | tooltip EAT confidence fill |
  | `--ps-eat-endpoint` | `#0f766e` | `#2dd4bf` | 6.6 | EAT endpoint ring |
  | `--ps-swatch-stroke` | `#394150` | `#94a3b8` | 6.7 | legend swatch outline |
  | `--ps-logo-filter` | `none` | `invert(1) hue-rotate(180deg)` | 6.9 | the wordmark `img` |

  Changed: light `--ps-danger` `#dc2626` → `#b91c1c` (6.10). The light plot values equal today's literals (`NEUTRAL_VALUE_COLOR` `#888888`, `NA_DEFAULT_COLOR` `#DDDDDD`, connector `#475569`, endpoint `#0f766e`, `LEGEND_STYLES.colors.defaultStroke` `#394150`), so nothing in light moves. `--ps-paper` and `--ps-paper-check` sit in a `fixedRoles` block included in `:root` only (exports are light in both themes). Other overlay colours map to existing roles: brush and lasso stroke `--ps-accent`, fill `color-mix(in srgb, var(--ps-accent) 15%, transparent)` (the light `--ps-accent-tint` is opaque and would hide the points); overlay chips (`.plot-indicator`, `.connector-status`) and the tooltip `--ps-surface-raised` / `--ps-border` / `--ps-shadow-md`; their text `--ps-text` and `--ps-text-muted`; hover `--ps-surface-hover`; spiderfy line `color-mix(in srgb, var(--ps-text) 35%, transparent)`; loading veils `color-mix(in srgb, var(--ps-surface) 90%, transparent)` (structure) and `80%` (plot); modal overlay `--ps-scrim`.
- **Neutral greys.** `PlotNeutrals = { other, na }`; `LIGHT_NEUTRALS = { other: NEUTRAL_VALUE_COLOR, na: NA_DEFAULT_COLOR }`. On screen, Other points take `neutrals.other`; an N/A value takes `neutrals.na` only when its mapped colour equals `NA_DEFAULT_COLOR` case-insensitively (a user-picked or bundle-stored N/A colour stays as given; a non-N/A category coloured `#DDDDDD` is untouched). The density pass's neutral key is the key of `neutrals.other`. Contours keep their 0.15 lighten toward white in both themes (no token). No GPU selection ring is added.
- **Exports are light.** Every export stages through light getters (`PointStyleState.exportGetters()`), draws with the white knockout `[1, 1, 1]`, and fills its own background as today (quick exports `'white'`, figure editor `#ffffff` or transparent). The figure editor previews on `--ps-paper` with a `--ps-paper-check` checkerboard in both themes. Duplicate badges keep their constants (they read on both backgrounds and are shared with exports).
- **Re-render rule.** A theme change re-renders the plot at most once, through the colour-only restyle, and only when `--ps-plot-other` or `--ps-plot-na` resolved to a different string. Re-setting `data-theme` to its current value, an OS flip under an explicit Light or Dark, and attribute changes on ancestors other than `<html>` never render. Budget for the new perf segment `theme-switch` (act: `data-theme='dark'`, reset: `'light'`, `pixels: true`): `render` 1, `restagePos` 0, `processData` 0, `gridRebuild` 0, `legendUpdate` 0, `legendRebuild` 0, `restage` ≤ 1, `restageStyle` ≤ 1; `load` and `idle` keep the baseline budgets.
- **Mol\*.** The canvas background is `--ps-surface` resolved on the structure viewer host, applied with `plugin.canvas3d?.setProps({ renderer: { backgroundColor } })` (a `0xRRGGBB` number) after each viewer is created and on each theme notification whose value differs from the last applied. No `canvas3d` (the e2e stub, a failed WebGL init) is a no-op. The CDN `molstar.css` light skin stays (its chrome is hidden).
- **Contrast gates (Task 6.10).** Role tokens in both themes: `--ps-text`, `--ps-text-muted`, `--ps-accent-text` ≥ 4.5:1 on the four surfaces and on `--ps-accent-tint` composited over `--ps-surface`; `--ps-text-on-accent` ≥ 4.5:1 on `--ps-accent`; `--ps-tooltip-text` ≥ 4.5:1 on `--ps-tooltip-bg`; `--ps-danger` ≥ 4.5:1 on `--ps-surface`, `-raised`, `-hover`; `--ps-border-control`, `--ps-accent`, `--ps-focus` ≥ 3:1 on the surfaces; `--ps-text-faint` ≥ 3:1 on `--ps-surface` (dark only); `--ps-plot-other`, `--ps-plot-connector`, `--ps-eat-endpoint` ≥ 3:1 on `--ps-plot-bg`; `--ps-eat` ≥ 3:1 on `--ps-surface-raised`; `--ps-swatch-stroke` ≥ 3:1 on `--ps-surface`. `--ps-plot-na` is exempt (de-emphasised by design). Default categorical palettes against dark `--ps-plot-bg`: every `kellys` colour ≥ 2:1 except the allow-listed `#2B3D26` (slot 18) and `#222222` (slot 20); every `okabeIto`, `tolBright`, `set2`, `dark2`, `tableau10` colour ≥ 3:1 except the allow-listed `okabeIto` `#000000`; each allow-listed colour must really be below its gate (the list only shrinks); gradients are out of scope; palettes do not change.
- **Axe.** `@axe-core/playwright` with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, one new spec per project (`workbench-a11y.spec.ts`, `mobile-a11y.spec.ts`), each state run in `colorScheme: 'light'` and `'dark'` (`test.use`) with the theme on System, each first asserting `getComputedStyle(document.documentElement).colorScheme` equals the scheme. Not the whole suite.

Copy (exact strings; tests and helpers key on them):

| Where | Text |
| --- | --- |
| App bar theme button (6.2) | `ps-icon-button` label "Theme" (its tooltip and accessible name), `data-driver-id="theme"`, icon `sun-moon` (System), `sun` (Light), `moon` (Dark) |
| Theme menu (6.2) | `ps-menu` label "Theme", placement `bottom-end`; `ps-menu-item type="radio"` values `system`, `light`, `dark`, text "System", "Light", "Dark" (`THEME_LABELS`) |
| More sheet Theme row (6.2) | Lucide `Sun` icon, visible label "Theme" (`aria-hidden`), `ps-segmented label="Theme"` with segments "System", "Light", "Dark"; between "Export" and "Help & shortcuts" |

## Review Focus

1. **A white flash, or the theme leaking off `/explore`.** A cold load of `/explore` with Dark stored paints white until the lazy chunk adopts the tokens; a GitHub Pages deep link (`/?/explore`) checks the path before the redirect and sets nothing; after the wordmark's SPA link to `/`, `data-theme="dark"` and `color-scheme: dark` stay on `<html>` and darken the landing's scrollbars and controls; a stored `"blue"` or a throwing `localStorage` breaks the page. Pinned by Task 6.1 (`theme-boot.test.ts`: script order after the redirect, path rule, parsing, `#0f172a` and the key pinned; `workbench-theme.spec.ts`: first paint with the Explore chunk delayed, the `/?/explore` deep link, `/` and `/privacy` unthemed, the attribute gone after the wordmark) and Task 6.13 (the default and the boot literal pinned equal).
2. **Extra renders from the theme watcher.** A mutation record for an unchanged `data-theme` (the layout effect re-sets it on mount), an OS flip under an explicit Light, the sidebar's slide setting attributes on the plot's ancestors, or a re-read on every draw adds renders or forced style recalcs at 573K. Pinned by Task 6.4 (`plot-theme.test.ts` no-change cases; `scatter-plot.theme.browser.test.ts` "a plot mounted in dark … with no theme restyle", since the perf contexts pin Light; `perf-counts` `load`/`idle` unchanged and the new `theme-switch` budget) and Task 6.8 (the viewer applies a background only when its value changed).
3. **Exports that go dark.** The export stages through the live getters, takes the live background as its knockout, or the figure editor previews a transparent figure on slate with its dark legend text vanishing. Pinned by Task 6.3 (`point-style-state.test.ts` `exportGetters`, `scatter-plot.export-style.test.ts`: export getters light while live ones are dark, knockout `[1, 1, 1]`) and Task 6.5 (a quick PNG exported in Dark equals the one exported in Light pixel for pixel; the preview backdrop stays light in Dark).
4. **Half-dark surfaces.** A card that hard-codes a light background while inheriting dark `--ps-text` (the projection card sits in the light DOM), the tooltip, the plot indicator and connector chip, the structure frame and its loading veil, toasts, the tour popover and its arrow, the wordmark; a legacy module that keeps reading a `tokens.ts` colour alias, which resolves to nothing once 6.9 strips them. Pinned by Tasks 6.6, 6.8, 6.9 (dark computed-colour browser tests per surface; the colour-only lint with its shrinking `STILL_COLOURED` set; the web CSS lint) and Tasks 6.11–6.12 (axe in both schemes on the composed page).
5. **The neutral greys.** A user-picked N/A colour overwritten by the dark grey; Other getting its own contour slot in dark because the density key stayed `#888888`; the legend's Other and N/A swatches disagreeing with the plot. Pinned by Task 6.3 (`style-getters.test.ts` N/A rule; `density-pass.test.ts` passed neutral key), Task 6.4 (`scatter-plot.theme.browser.test.ts` samples an Other pixel ≈ `#64748b` in dark) and Task 6.7 (`legend.theme.browser.test.ts` same rule for swatches).

## Rulings

Settled open questions (R1 Q1–Q9, R2 Q1–Q8, R3 Q1–Q7; the user adopted every recommended answer, so these record the decision and where notes disagreed):

- Desktop and tablet switch: a `ps-icon-button` "Theme" with a radio `ps-menu`, between the Import/Export pair and Help (R1 Q1, decision 1's order): about 38 px of bar where a three-segment control would starve the tablet's search; the icon shows the current choice.
- Phones and landscape: a `ps-segmented` Theme row in the More sheet between Export and Help & shortcuts (decision 17, mockup frame 4); the sheet stays open on change, like Contours, and the theme never lights the More dot. The desktop ThemeMenu's button is hidden there by the existing app-bar-actions rule; its `ps-menu` stays rendered at 0×0.
- Store: `apps/web/src/explore/theme-state.ts` with its leaf `theme-defaults.ts`, own key `protspace:theme` (JSON through `setStorageItem`), not a field of `protspace:layout:v1` (R1 Q2; decisions 10 and 16 already name the key). The leaf lets Playwright helpers import the key without loading `@protspace/utils`.
- `data-theme="system"` stays on the element and CSS follows the OS live; nothing resolves it to `light`/`dark` in the attribute (R1 Q3).
- Core consumers learn of changes through `observeTheme(onChange, doc?)` in `packages/core/src/utils/theme-observer.ts` (not `styles/`, whose exports must be stylesheets), watching `<html>`'s `data-theme`/`class`/`style` and the `prefers-color-scheme` change (R1 Q4). `isDarkTheme` and the app's `resolvedTheme()` are not added: every consumer reads and compares token values, so a resolved scheme would have no reader (knip) and would miss an embedder's own token overrides.
- Boot script only on `/explore` (path `/^\/explore\/?$/`), placed after the GitHub Pages redirect, plus an unlayered first-paint `<style>` with the literal `#0f172a`, pinned by test (R1 Q9); `Explore.tsx` applies the attribute in `useLayoutEffect` (an SPA arrival from `/` is themed before the workbench paints) and removes it on unmount, so the landing, privacy and docs keep their look.
- The default flips to System in the last commit of the phase (R1 Q8), after every surface is dark; until then `DEFAULT_THEME = 'light'` in both the store and the boot script, so no dark-OS user sees a half-dark page mid-branch.
- Wordmark: a `--ps-logo-filter` token (`none` / `invert(1) hue-rotate(180deg)`, as the approved mockup), not a second SVG (R1 Q5, R3 Q4): a `<picture>` media query would follow the OS, not a stored Dark.
- The tour CSS and its two TS colours move to tokens in Task 6.9 (R1 Q6, R3 Q2): decision 16 lists the tour; 7.4 changes steps, not styling.
- The style lint reaches `apps/web/src/workbench/workbench.css` and `apps/web/src/tour/product-tour.css` (colours and `--ps-*` reads), not `index.css` (landing territory), in Task 6.9 with the tour fixed in the same commit (R1 Q7).
- "Selection ring" means the brush and lasso outline (stroke `--ps-accent`, fill `color-mix(in srgb, var(--ps-accent) 15%, transparent)`) and the EAT endpoint ring; no GPU ring is drawn (R2 Q1).
- Contours keep the 0.15 lighten toward white in both themes; no contour token (R2 Q2): lightening raises contrast on dark; mixing toward the background would lower it.
- Plot background: light `#ffffff` (exports, pixel tests and docs images unchanged), dark `#0b1120`, a step darker than the `#0f172a` panels (R2 Q3).
- R2's `--ps-plot-ring` and R3's `--ps-eat-endpoint` are the same colour for the same mark: one token, `--ps-eat-endpoint` (named for what it marks, beside `--ps-eat`); the connector line keeps `--ps-plot-connector` (R2 table, R3 Q3).
- The legend's Other colour is unified with the plot's: `OTHER_COLOR` in `visual-encoding.ts` becomes `NEUTRAL_VALUE_COLOR` (`#888888`, was `#999999`), so a light export's legend matches its points; on screen the Other swatch and the score strips' Other dot read `--ps-plot-other` (R2 Q4). Stored legend settings keep whatever colour they hold.
- On-screen legend swatches keep their SVG presentation attributes (the data colour, light, which tests and exports read); stylesheet rules in the legend's row styles override `fill` for Other and default-coloured N/A and `stroke` for every swatch (`--ps-swatch-stroke`), since a stylesheet rule beats a presentation attribute and the selected-row outline rule stays more specific. Inline `style` is not used (it would beat the selected outline).
- The figure editor previews on fixed light paper: `--ps-paper` with a `--ps-paper-check` checkerboard behind every figure (a white figure paints over it), the same in both themes (R2 Q5, R3 Q5). One owner: Task 6.5.
- Point rim darkening (×0.5) is not changed in this phase; the phase-exit visual review screenshots Kelly's `#222222` and `#2B3D26` on the dark plot and the user decides (R2 Q6).
- Mol*'s background is `--ps-surface` (`#0f172a` dark), so the docked and floating card matches its panel (R2 Q7). The structure frame's own background also moves to `--ps-surface` (R3 had suggested `--ps-surface-raised`), so frame and canvas meet without a seam; the floating card's elevation comes from its shadow and border.
- Palette gate (R2 Q8, R3 palette test): on the dark `--ps-plot-bg`, Kelly ≥ 2:1 (which is slots 0–17 and slot 19) with `#2B3D26` and `#222222` allow-listed, the other categorical defaults ≥ 3:1 with `okabeIto` `#000000` allow-listed; palettes unchanged; gradients out of scope. The test lives in core (`packages/core/src/styles/palette-contrast.test.ts`), because the background comes from `theme.ts`; utils keeps no copy of the plot background.
- `tokens.ts` loses every colour declaration in Task 6.9; its non-colour aliases (`--z-*`, `--font-*`, `--text-*` sizes, spacing, radius, breakpoints) stay for 8.1, so the seven LEGACY modules stay listed unless one comes out fully clean (R3 Q1). A colour-only check covers the legacy modules from Task 6.6, with a `STILL_COLOURED` set that only shrinks (6.6 removes three, 6.8 three, 6.9 the last) and is deleted when empty.
- EAT colours: two tokens, `--ps-eat` (`#7c3aed` / `#a78bfa`) and `--ps-eat-endpoint` (`#0f766e` / `#2dd4bf`), keeping their distinction from selection (R3 Q3).
- Light `--ps-danger` deepens to red-700 `#b91c1c` (6.5:1 on the hover surface; `#dc2626` was 4.41:1, failing on a hovered danger button) (R3 Q6).
- Axe: one new spec per project, about ten states × both schemes through Playwright's `colorScheme` with the theme on System; the rest of the suite is not parameterised (R3 Q7). Until Task 6.13 flips the default, both specs seed `"system"` through `seedTheme`; Task 6.13 deletes those lines.
- The plot's colour custom properties on `:host` (`--protspace-bg-color`, `--protspace-selection-color`, `--protspace-highlight-color`, `--protspace-default-stroke`, `--protspace-tooltip-*`, `--protspace-brush-stroke`, `--protspace-brush-fill`) and the viewer's colour ones (`--protspace-viewer-bg`, `-border`, `-header-bg`, `-text`, `-text-muted`, `-error`, `-loading`) are removed, not re-pointed: an embedder themes through the `--ps-*` tokens (decision 5's one list), which a host-declared alias would block. Their sizing properties stay. `docs/developers/style-architecture.md` changes in the same commits.
- `PlotTheme` replaces `BackgroundColorCache` (one reader for the plot's themed values): it keeps that class's broad lazy invalidation for the knockout background and adds the narrow `observeTheme` trigger, which calls back only when the neutral greys changed. A background-only change invalidates and does not render (the knockout has no visible effect, `PREDICTED_INTERIOR_FILL = 0`).
- The density pass gets the neutral colour through a renderer option `getNeutralColor` rather than reading `--ps-plot-other` itself, so the renderer stays free of DOM reads.
- Sonner keeps `theme="light"`; its token mapping matches `[data-sonner-theme]` of any value (`.wb-body [data-sonner-toaster][data-sonner-theme]`, 0,3,0 against Sonner's 0,2,0, so it wins whatever order the sheets load in), and the tokens carry the theme (R3 C).
- Perf runs pin the light theme explicitly (decision 4): `exploreStorageState` gains a `theme` option and the three perf contexts pass `'light'` (closes the phase-2 m4 note for `perf:webgl` too).
- The phone Theme row's e2e test goes into `mobile-bars.spec.ts` and runs at the exit: Task 6.2's one e2e spec is `workbench-theme.spec.ts` (user's one-spec rule).
- The 800 px tablet bar is measured at task time, in Task 6.2's own spec (`workbench-theme.spec.ts`, `workbench` project at 800×1000, which is a tablet because layout mode is width-only), with a named remedy (tablet-only rules: drop the separator, then narrow the gap; never hide the Theme button); the `mobile`-project twins run first at the exit (plan review).
- `createStyleGetters(data, styleConfig, model?, neutrals = LIGHT_NEUTRALS)`: the greys are the fourth parameter, since the real third is `model?: VisibilityModel`. `_neutrals` stays an instance arrow field (the export-style test replaces it by assignment) (plan review).
- `PlotTheme.neutrals()` caches a read, `connect()` runs the theme check once (a first connect has read nothing, so it does nothing) and there is no public `invalidate()`; `_readNeutrals` returns `LIGHT_NEUTRALS` by identity when the values are light, so `exportGetters()`' per-point `sameNeutrals` check is one comparison. A browser case pins that a plot mounted in dark adds no theme restyle, since the perf contexts pin Light and would not see it (plan review).
- The colour-only lint checks a module's own sheets (`ownCssOf`), not the composed `cssOf`, because `scatterplotStyles` composes `tokens` and `overlayMixins` (plan review).
- Brush and lasso fill with `color-mix(in srgb, var(--ps-accent) 15%, transparent)`, not `--ps-accent-tint`, which is opaque in light and would hide the points (plan review).
- The score strips' Other dot rule lives in `category-score-strip.styles.ts` (the strip's own shadow root, which the legend's sheet cannot reach); `docs/explore/legend.md` changes `#999999` to `#888888` in the same commit (plan review).
- Mol*: the `--segmented-*` colour hooks go with the viewer's `.color-mode-group` bridge (their only writer); `_applyViewerBackground` returns on an empty `--ps-surface`, so the mocked-loader suites stay unedited (plan review).
- `design.md` (decisions 10 and 16) is brought in line with these rulings in Task 6.1's commit, not in the commit that adds this plan, because the plan commit stages only the plan and `tasks.md` (plan review asked for the plan commit).
- The axe helper keeps the annotation picker's old breadth through `tags: null` (every rule), so moving that test onto the helper does not narrow it (plan review).
- Tests that assert Light set it explicitly (`chooseTheme(page, 'Light')` or `seedTheme(page, 'light')`), so nothing but Task 6.1's "nothing stored" test depends on `DEFAULT_THEME`; Task 6.13 replaces that test and keeps its "explicit Light ignores a dark OS" check as its own test (plan review).

Plan shape:

- Thirteen tasks in three review blocks: 6.1–6.4, 6.5–6.8, 6.9–6.13 (five tasks; 6.13 is one small commit and must be reviewed with the accessibility specs it edits). The switch (6.1–6.2) lands first behind a Light default, then the plot's plumbing with light exports (6.3) before the plot follows the theme (6.4), then the surfaces (6.5–6.9), then the gates (6.10–6.12), then the default (6.13).
- `tasks.md` section 6 is rewritten to list these thirteen tasks in the commit that adds the plan; the ticks land at the end of the phase.

## File structure

`packages/core/src`

- `styles/theme.ts` (M 6.4 `--ps-plot-bg`/`-other`/`-na`; 6.5 `fixedRoles` `--ps-paper`, `--ps-paper-check`; 6.6 `--ps-plot-connector`, `--ps-eat`, `--ps-eat-endpoint`; 6.7 `--ps-swatch-stroke`; 6.9 `--ps-logo-filter` and the header comment; 6.10 light `--ps-danger`): the token source.
- `styles/theme.test.ts` (M 6.4 light plot values pinned to the TS constants; 6.10 the contrast gates on `test-support/contrast.ts`).
- `styles/palette-contrast.test.ts` (C 6.10): default palettes on the dark plot background.
- `test-support/contrast.ts` (C 6.10): token parsing, compositing and WCAG contrast for the two contrast tests.
- `styles/style-lint.test.ts` (M 6.6 colour-only check and `STILL_COLOURED`; M 6.8 shrink; M 6.9 web CSS check, `STILL_COLOURED` deleted).
- `styles/tokens.ts` (M 6.9): colour declarations stripped; non-colour aliases stay.
- `styles/mixins.ts`, `styles/overlay-mixins.ts` (M 6.8): `segmentedControlMixin`, loading and modal overlays on tokens.
- `utils/theme-observer.ts`, `utils/theme-observer.test.ts` (C 6.4): `observeTheme`.
- `components/kit/icon.ts` (M 6.2): `sun`, `moon`, `sun-moon`.
- `components/scatter-plot/styling/plot-neutrals.ts` (C 6.3; tested through `style-getters.test.ts` and `point-style-state.test.ts`): `PlotNeutrals`, `LIGHT_NEUTRALS`, `sameNeutrals`.
- `components/scatter-plot/styling/style-getters.ts`, `style-getters.test.ts` (M 6.3): neutrals input, the N/A rule.
- `components/scatter-plot/styling/point-style-state.ts`, `point-style-state.test.ts` (M 6.3): `neutrals()` host input, `exportGetters()`.
- `components/scatter-plot/webgl/renderer/density-pass.ts`, `density-pass.test.ts`, `webgl-renderer.ts`, `webgl-renderer.density.test.ts` (M 6.3): the neutral key as a parameter and the `getNeutralColor` option.
- `components/scatter-plot/styling/plot-theme.ts`, `plot-theme.test.ts` (C 6.4); `background-color-cache.ts`, `background-color-cache.test.ts` (D 6.4, behaviour moved into `PlotTheme` and its test).
- `components/scatter-plot/scatter-plot.ts` (M 6.3 export style, knockout, neutrals source; M 6.4 `PlotTheme` and its restyle).
- `components/scatter-plot/scatter-plot.export-style.test.ts` (C 6.3): export getters and knockout.
- `components/scatter-plot/scatter-plot.theme.browser.test.ts` (C 6.4; M 6.6 overlay chrome cases): real WebGL and computed colours in dark.
- `components/scatter-plot/scatter-plot.styles.ts` (M 6.4 host background; M 6.6 overlays and chips), `tooltips/protein-tooltip.styles.ts`, `projection-metadata/projection-metadata.styles.ts` (M 6.6), `projection-metadata/projection-metadata.theme.browser.test.ts` (C 6.6).
- `components/legend/visual-encoding.ts` (+ test), `legend-row.ts`, `legend-score-strips.ts`, `category-score-strip.ts`, `category-score-strip.styles.ts` (the strip's own shadow sheet: `circle.other { fill: var(--ps-plot-other) }`), `legend-score-strips.test.ts`, `legend/styles/row.ts` (M 6.7); `legend/legend.theme.browser.test.ts` (C 6.7).
- `components/publish/publish-modal.styles.ts`, `publish-modal.browser.test.ts` (M 6.5): the paper preview.
- `components/structure-viewer/molstar-loader.ts`, `molstar-loader.test.ts`, `structure-viewer.ts`, `structure-viewer.styles.ts`, `structure-viewer.component.test.ts`, `structure-viewer.browser.test.ts` (M 6.8).

`packages/utils/src`: no change.

`apps/web`

- `index.html` (M 6.1 boot script and first-paint style; M 6.13 default literal).
- `src/explore/theme-defaults.ts` (C 6.1; M 6.2 `THEME_LABELS`; M 6.13 default): leaf constants.
- `src/explore/theme-state.ts`, `theme-state.test.ts` (C 6.1; M 6.13 default test): the store.
- `src/explore/theme-boot.test.ts` (C 6.1): the boot script and style, run in node.
- `src/pages/Explore.tsx` (M 6.1): `applyTheme` in a layout effect.
- `src/workbench/use-theme.ts`, `ThemeMenu.tsx` (C 6.2); `AppBar.tsx`, `MoreSheet.tsx` (M 6.2).
- `src/workbench/workbench.css` (M 6.2 only if the tablet bar needs it; M 6.9 wordmark filter, Sonner selector and close button, the explore `body` background).
- `src/tour/product-tour.css`, `product-tour.ts` (M 6.9).
- `src/custom-elements.d.ts`: no change (`icon` is typed from `IconName`, which grows with the core build).
- `tests/helpers/theme.ts` (C 6.1; M 6.2): `seedTheme`, `htmlTheme`, `DARK_SURFACE`, `themeButton`, `chooseTheme`.
- `tests/helpers/a11y.ts` (C 6.11): `expectNoAxeViolations`, `expectColorScheme`.
- `tests/helpers/mobile.ts` (M 6.2): `themeSegment`.
- `tests/helpers/workbench.ts` (M 6.8): the Mol* stub's `canvas3d`.
- `tests/helpers/tour-storage-state.ts`, `tests/helpers/perf/scenarios.ts`, `tests/perf-scale.spec.ts`, `tests/perf/budgets.json` (M 6.4); root `perf/playwright.config.ts` (M 6.4).
- `tests/workbench-theme.spec.ts` (C 6.1; M 6.2, 6.5, 6.9, 6.13).
- `tests/mobile-bars.spec.ts` (M 6.2), `tests/workbench-structure.spec.ts` (M 6.8), `tests/workbench-a11y.spec.ts` (C 6.11; M 6.13), `tests/mobile-a11y.spec.ts` (C 6.12; M 6.13), `tests/workbench-filter.spec.ts` (M 6.11: its axe call uses the helper), `tests/multi-annotation-tooltip.spec.ts` (M 6.11: same).

Docs: `docs/developers/architecture.md` (M 6.1: the theme store and the boot script), `docs/developers/style-architecture.md` (M 6.4 design-token paragraph: System and the plot tokens; M 6.6 and 6.8: the colour component properties removed, theming through `--ps-*`; M 6.9: one sentence on the colour rule for legacy modules and the web stylesheets), `docs/explore/legend.md` (M 6.7: Other is `#888888` in the Special Categories table). `openspec/changes/explore-workbench/design.md` (M 6.1: decision 10 no longer puts the theme in the layout store; decision 16 records `data-theme="system"`, the selection ring, the contours and the Mol* background as ruled below). `openspec/changes/explore-workbench/tasks.md` (M with the plan; ticks at the phase end). `.superpowers/sdd/phase-6-dark-mode/progress.md` (baseline counts).

---

### Task 6.1: Theme store, first-paint boot and `/explore`-only scope

The theme choice gets its own store and key, and `/explore` gets its theme before first paint: a marked inline script in `index.html` sets `data-theme` from storage on a cold load of `/explore` only, and an unlayered style paints the dark surface before the lazy chunk adopts the tokens. `Explore.tsx` applies the attribute on mount and removes it on unmount. The default stays Light until Task 6.13, so nothing changes for anyone yet; the tests drive Dark by seeding storage.

**Files:**

- Create: `apps/web/src/explore/theme-defaults.ts`, `apps/web/src/explore/theme-state.ts`, `apps/web/src/explore/theme-state.test.ts`, `apps/web/src/explore/theme-boot.test.ts`
- Modify: `apps/web/index.html` (boot `<script data-theme-boot>` and `<style data-theme-boot>` after the GitHub Pages block)
- Modify: `apps/web/src/pages/Explore.tsx` (`useLayoutEffect(() => applyTheme(), [])`)
- Create: `apps/web/tests/helpers/theme.ts`, `apps/web/tests/workbench-theme.spec.ts`
- Modify: `docs/developers/architecture.md` (the theme store beside the layout store; the boot script; `/explore`-only scope)
- Modify: `openspec/changes/explore-workbench/design.md` (decisions 10 and 16 brought in line with this plan's Rulings; Step 13b)

**Interfaces:**

- Consumes: `getStorageItem<T>(key, fallback)`, `setStorageItem<T>(key, value)` (`@protspace/utils`, JSON-encoding; both swallow a throwing `localStorage`); `openExplore(page, search?)`, `waitForExploreDataLoad(page, options?)`, `appBar(page)` (`tests/helpers/explore.ts`); the wordmark link `[data-workbench='home']`, accessible name "ProtSpace home" (`AppBar.tsx`, the `<Link to="/" data-workbench="home" aria-label="ProtSpace home">`); dark `--ps-surface` `#0f172a` in `packages/core/src/styles/theme.ts` (`const darkRoles = css\``…). The pattern to copy for the store is `apps/web/src/explore/layout-state.ts` (`getLayout`/`subscribeLayout`/`updateLayout`/`resetLayoutForTests`) and its test's `localStorage` stub (`layout-state.test.ts:19-44`).
- Produces:
  - `theme-defaults.ts` (leaf, no imports): `export type ThemeChoice = 'system' | 'light' | 'dark'`; `export const THEME_STORAGE_KEY = 'protspace:theme'`; `export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']`; `export const DEFAULT_THEME: ThemeChoice = 'light'` (comment: Task 6.13 flips it to `'system'` with the boot script's literal).
  - `theme-state.ts`: `parseTheme(raw: unknown): ThemeChoice` (a member of `THEME_CHOICES`, else `DEFAULT_THEME`); `getTheme(): ThemeChoice` (read once through `getStorageItem(THEME_STORAGE_KEY, null)` and parsed, then cached; a throwing storage gives the default); `subscribeTheme(listener: () => void): () => void`; `setTheme(choice: ThemeChoice): void` (equal to the current choice → nothing; else caches it, writes it with `setStorageItem`, sets `dataset.theme` on the applied root if one is applied, and notifies each listener once); `applyTheme(root: HTMLElement = document.documentElement): () => void` (sets `root.dataset.theme = getTheme()` and remembers `root`; the returned cleanup deletes the attribute and forgets the root); `resetThemeForTests(): void` (drops the cache, the listeners and the applied root).
  - `index.html`: the boot pair exactly as "Phase 6 → Boot" says, with the default literal `'light'`, the key literal `'protspace:theme'`, and the two `data-theme-boot` markers (the test finds them by marker). The script uses the bare globals `location`, `localStorage` and `document` (the test shadows them).
  - `Explore.tsx`: `useLayoutEffect(() => applyTheme(), [])` before the existing runtime effect; nothing else changes.
  - `tests/helpers/theme.ts`: `seedTheme(page: Page, value: ThemeChoice | string): Promise<void>` (an `addInitScript` that writes `JSON.stringify(value)` under `THEME_STORAGE_KEY` only when the key is absent, so a reload keeps what the page stored; imports the key from `../../src/explore/theme-defaults`); `htmlTheme(page: Page): Promise<string | null>` (`<html>`'s `data-theme`); `export const DARK_SURFACE = 'rgb(15, 23, 42)'`.
  - `architecture.md`: a short "Theme" section beside the layout section.

**Tests:**

- `theme-state.test.ts` (node; stubs `localStorage`, `document.documentElement` as `{ dataset: {} }`): "defaults to DEFAULT_THEME with nothing stored"; "defaults when storage throws"; "parseTheme rejects 'blue', null, 1 and an object"; "reads a stored JSON choice once" (`getItem` called once across two `getTheme()`); "setTheme writes '\"dark\"' under protspace:theme, notifies once and sets the applied root's data-theme"; "setTheme with the current choice does nothing (no write, no notify)"; "setTheme before applyTheme stores without touching any element"; "applyTheme sets data-theme and its cleanup deletes it"; "an unsubscribed listener is not called".
- `theme-boot.test.ts` (node; reads `apps/web/index.html` and `packages/core/src/styles/theme.ts` as text; extracts the boot script by `data-theme-boot` and runs it with `new Function` under stubbed `location`, `localStorage`, `document.documentElement.setAttribute`): "the boot script comes after the GitHub Pages redirect script"; "/explore with \"dark\" stored sets dark"; "/explore/ is themed too"; "nothing stored, garbage, '\"blue\"' and a throwing localStorage set DEFAULT_THEME"; "/, /privacy and /explore-foo set nothing"; "the script's key equals THEME_STORAGE_KEY"; "the first-paint style's colour equals dark --ps-surface in theme.ts"; "the first-paint style covers data-theme dark and, under prefers-color-scheme dark, system".
- `workbench-theme.spec.ts` (project `workbench`): "a cold load with Dark stored paints the dark surface before the Explore chunk runs" (`seedTheme(page, 'dark')`; `page.route` holds the request for `/src/pages/Explore.tsx` (dev server path) until the sample is taken; an init script records `getComputedStyle(document.body).backgroundColor` on the first animation frame; expect `DARK_SURFACE`; then release and expect `.workbench` background `DARK_SURFACE`); "System stored follows a dark OS before the chunk runs" (`colorScheme: 'dark'` via `test.use` in its describe, `seedTheme(page, 'system')`); "the GitHub Pages deep link /?/explore is themed" (`seedTheme(page, 'dark')`, `page.goto('/?/explore')`, `htmlTheme` → `dark`); "only /explore is themed" (with Dark stored, `/` and `/privacy` have no `data-theme` and a white body; on `/explore` the attribute is `dark`, and after a click on the wordmark the landing has no `data-theme` and `getComputedStyle(documentElement).colorScheme` is not `dark`); "with nothing stored the page is Light" (`htmlTheme` → `light`; Task 6.13 changes this test).
- Unrun at task time (exit): `workbench-shell.spec.ts` (the attribute on `<html>`), `kit-gallery.spec.ts` (sets its own `data-theme`), `example-datasets.spec.ts` (navigations between `/` and `/explore`), `product-tour.spec.ts`.

LEGACY count: 7.

Two environment facts this task relies on (checked against the code at `a5a81b25`):

- `apps/web/tsconfig.app.json` carries no Node types, so an app unit test cannot import `node:fs`. `theme-boot.test.ts` reads both files through `import.meta.glob(…, { query: '?raw', import: 'default', eager: true })`, as `src/explore/example-datasets-docs.test.ts` reads the docs page.
- With `PLAYWRIGHT_PORT` the suite runs the Vite dev server, which serves the lazy page as `/src/pages/Explore.tsx` (`App.tsx`: `lazy(() => import('./pages/Explore'))`). `main.tsx` imports `./index.css` before React renders, so by the time the app asks for that chunk the landing's `@layer base` white body rule is in the page and no token sheet is: the moment the boot style has to win on its own. The spec's route also matches a production build's `assets/Explore-*.js`, for a run against `PLAYWRIGHT_BASE_URL`.

- [ ] **Step 1: Write the failing store test**

Create `apps/web/src/explore/theme-state.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './theme-defaults';
import {
  applyTheme,
  getTheme,
  parseTheme,
  resetThemeForTests,
  setTheme,
  subscribeTheme,
} from './theme-state';

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

/** `<html>` as the store sees it: only its dataset. */
let root: { dataset: Record<string, string | undefined> };
const asElement = (value: typeof root) => value as unknown as HTMLElement;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  root = { dataset: {} };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: root });
  resetThemeForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme store', () => {
  it('defaults to DEFAULT_THEME with nothing stored', () => {
    expect(getTheme()).toBe(DEFAULT_THEME);
    expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('defaults when storage throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    expect(getTheme()).toBe(DEFAULT_THEME);
  });

  it("parseTheme rejects 'blue', null, 1 and an object", () => {
    for (const raw of ['blue', 'Dark', null, undefined, 1, { theme: 'dark' }, ['dark']]) {
      expect(parseTheme(raw)).toBe(DEFAULT_THEME);
    }
    for (const choice of ['system', 'light', 'dark'] as const) {
      expect(parseTheme(choice)).toBe(choice);
    }
  });

  it('reads a stored JSON choice once', () => {
    store.set(THEME_STORAGE_KEY, '"dark"');
    expect(getTheme()).toBe('dark');
    expect(getTheme()).toBe('dark');
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it(`setTheme writes '"dark"' under protspace:theme, notifies once and sets the applied root's data-theme`, () => {
    applyTheme(asElement(root));
    const listener = vi.fn();
    subscribeTheme(listener);

    setTheme('dark');

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('protspace:theme', '"dark"');
    expect(listener).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('dark');
    expect(getTheme()).toBe('dark');
  });

  it('setTheme with the current choice does nothing (no write, no notify)', () => {
    const listener = vi.fn();
    subscribeTheme(listener);

    setTheme(getTheme());

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('setTheme before applyTheme stores without touching any element', () => {
    setTheme('dark');

    expect(store.get(THEME_STORAGE_KEY)).toBe('"dark"');
    expect(root.dataset.theme).toBeUndefined();
    applyTheme(asElement(root));
    expect(root.dataset.theme).toBe('dark');
  });

  it('applyTheme sets data-theme and its cleanup deletes it', () => {
    store.set(THEME_STORAGE_KEY, '"dark"');
    // No argument: the document's root element, as Explore.tsx calls it.
    const cleanup = applyTheme();
    expect(root.dataset.theme).toBe('dark');

    cleanup();
    expect('theme' in root.dataset).toBe(false);
    // The root is forgotten: a later choice is stored but never written back onto it.
    setTheme('system');
    expect('theme' in root.dataset).toBe(false);
    expect(store.get(THEME_STORAGE_KEY)).toBe('"system"');
  });

  it('an unsubscribed listener is not called', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    unsubscribe();

    setTheme('dark');

    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing boot test**

Create `apps/web/src/explore/theme-boot.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './theme-defaults';

/**
 * Pins index.html's first-paint pair to the app and to the tokens (AGENTS.md: a fact that lives
 * in two places gets a test). The boot script repeats the storage key, the choices and the
 * default, and the boot style repeats dark --ps-surface, because neither can import anything.
 * Both files are read via `?raw`: tsconfig.app.json carries no Node types.
 */
const raw = (modules: Record<string, unknown>) => (Object.values(modules)[0] ?? '') as string;
const INDEX_HTML = raw(
  import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }),
);
const THEME_TS = raw(
  import.meta.glob('../../../../packages/core/src/styles/theme.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

const BOOT_SCRIPT = INDEX_HTML.match(/<script data-theme-boot>([\s\S]*?)<\/script>/)?.[1] ?? '';
const BOOT_STYLE = INDEX_HTML.match(/<style data-theme-boot>([\s\S]*?)<\/style>/)?.[1] ?? '';

/**
 * Runs the boot script at `pathname` with `getItem` as localStorage's, and returns the
 * data-theme it set (null: none). The script uses the bare globals, which the parameters shadow.
 */
function runBoot(pathname: string, getItem: (key: string) => string | null): string | null {
  let theme: string | null = null;
  const location = { pathname };
  const localStorage = { getItem };
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === 'data-theme') theme = value;
      },
    },
  };
  new Function('location', 'localStorage', 'document', BOOT_SCRIPT)(
    location,
    localStorage,
    document,
  );
  return theme;
}

/** A storage holding `value` (already JSON) under the theme key. */
const holding = (value: string | null) => (key: string) =>
  key === THEME_STORAGE_KEY ? value : null;

describe('the first-paint boot in index.html', () => {
  it('is found', () => {
    expect(BOOT_SCRIPT.trim()).not.toBe('');
    expect(BOOT_STYLE.trim()).not.toBe('');
    expect(THEME_TS).toContain('const darkRoles');
  });

  it('the boot script comes after the GitHub Pages redirect script', () => {
    const redirectEnd = INDEX_HTML.indexOf('<!-- End Single Page Apps for GitHub Pages -->');
    expect(redirectEnd).toBeGreaterThan(0);
    // The redirect turns /?/explore into /explore; a path check before it would see "/".
    expect(INDEX_HTML.indexOf('<script data-theme-boot>')).toBeGreaterThan(redirectEnd);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeGreaterThan(redirectEnd);
    expect(INDEX_HTML.indexOf('<style data-theme-boot>')).toBeLessThan(
      INDEX_HTML.indexOf('</head>'),
    );
  });

  it('/explore with "dark" stored sets dark', () => {
    expect(runBoot('/explore', holding('"dark"'))).toBe('dark');
    expect(runBoot('/explore', holding('"system"'))).toBe('system');
    expect(runBoot('/explore', holding('"light"'))).toBe('light');
  });

  it('/explore/ is themed too', () => {
    expect(runBoot('/explore/', holding('"dark"'))).toBe('dark');
  });

  it.each([
    ['nothing stored', holding(null)],
    ['garbage', holding('{not json')],
    ['"blue"', holding('"blue"')],
    ['a number', holding('1')],
    ['a bare dark (not JSON)', holding('dark')],
    [
      'a throwing localStorage',
      () => {
        throw new Error('SecurityError: storage is disabled');
      },
    ],
  ])('%s sets DEFAULT_THEME', (_case, getItem) => {
    expect(runBoot('/explore', getItem)).toBe(DEFAULT_THEME);
  });

  it.each(['/', '/privacy', '/explore-foo', '/explore/x', '/dev/kit', '/docs/'])(
    '%s sets nothing',
    (pathname) => {
      expect(runBoot(pathname, holding('"dark"'))).toBeNull();
    },
  );

  it("the script's key equals THEME_STORAGE_KEY", () => {
    const getItem = vi.fn(holding('"dark"'));
    runBoot('/explore', getItem);
    expect(getItem).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY);
    expect(BOOT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it("the first-paint style's colour equals dark --ps-surface in theme.ts", () => {
    const darkRoles = THEME_TS.match(/const darkRoles = css`([\s\S]*?)`/)?.[1] ?? '';
    const darkSurface = darkRoles.match(/--ps-surface:\s*(#[0-9a-f]{6})\b/i)?.[1];
    expect(darkSurface).toBeDefined();
    const colours = [...BOOT_STYLE.matchAll(/background:\s*(#[0-9a-f]{3,8})\b/gi)].map((match) =>
      match[1].toLowerCase(),
    );
    expect(colours).toEqual([darkSurface!.toLowerCase(), darkSurface!.toLowerCase()]);
  });

  it('the first-paint style covers data-theme dark and, under prefers-color-scheme dark, system', () => {
    const style = BOOT_STYLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const [outside, media = ''] = style.split('@media (prefers-color-scheme: dark)');
    expect(outside).toMatch(
      /:root\[data-theme='dark'\], :root\[data-theme='dark'\] body \{ color-scheme: dark; background: #[0-9a-f]{6}; \}/i,
    );
    expect(media).toMatch(
      /:root\[data-theme='system'\], :root\[data-theme='system'\] body \{ color-scheme: dark; background: #[0-9a-f]{6}; \}/i,
    );
    // Nothing themes a page outside these two cases: no light rule, no bare :root.
    expect(outside).not.toContain("data-theme='system'");
    expect(style).not.toContain("data-theme='light'");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: FAIL, both files: `Failed to resolve import "./theme-defaults"` (and `"./theme-state"`): neither module exists yet.

- [ ] **Step 4: Create the leaf constants**

Create `apps/web/src/explore/theme-defaults.ts`:

```ts
/**
 * The explore page's theme choice (design decision 16): its storage key, its values and its
 * default. A leaf module with no imports, so the Playwright helpers can import it as well.
 * index.html's boot script repeats the key, the values and the default, because it runs before
 * any module; theme-boot.test.ts pins them to these.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Its own key, never a field of the layout: JSON-encoded through @protspace/utils storage. */
export const THEME_STORAGE_KEY = 'protspace:theme';

/** In the order the switch offers them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * The choice with nothing (or nothing valid) stored. Light while the phase's surfaces turn dark;
 * Task 6.13 flips it to 'system', together with the boot script's literal in index.html.
 */
export const DEFAULT_THEME: ThemeChoice = 'light';
```

- [ ] **Step 5: Create the store**

Create `apps/web/src/explore/theme-state.ts`:

```ts
import { getStorageItem, setStorageItem } from '@protspace/utils';
import { DEFAULT_THEME, THEME_CHOICES, THEME_STORAGE_KEY, type ThemeChoice } from './theme-defaults';

/**
 * The explore page's theme choice (design decision 16): System, Light or Dark, kept under its own
 * key beside the layout store. The React shell subscribes with useSyncExternalStore. The choice
 * is written as is to data-theme on the root Explore applies it to, and only while it is applied:
 * 'system' stays 'system' and the token sheet's media query follows the OS. No cross-tab sync:
 * another tab keeps its theme until it reloads.
 */

/** A choice from anything stored: one of THEME_CHOICES, else the default. */
export function parseTheme(raw: unknown): ThemeChoice {
  return THEME_CHOICES.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : DEFAULT_THEME;
}

let theme: ThemeChoice | null = null;
let appliedRoot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The choice: read from storage on the first call (a throwing storage gives the default). */
export function getTheme(): ThemeChoice {
  theme ??= parseTheme(getStorageItem<unknown>(THEME_STORAGE_KEY, null));
  return theme;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Commits a choice: stored, written to the applied root and announced; the same choice does nothing. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === getTheme()) return;
  theme = choice;
  setStorageItem(THEME_STORAGE_KEY, choice);
  if (appliedRoot) appliedRoot.dataset.theme = choice;
  for (const listener of [...listeners]) listener();
}

/**
 * Writes the choice to `root`'s data-theme and keeps it there until the returned cleanup, which
 * removes the attribute: the landing, privacy and docs pages keep their look.
 */
export function applyTheme(root: HTMLElement = document.documentElement): () => void {
  root.dataset.theme = getTheme();
  appliedRoot = root;
  return () => {
    delete root.dataset.theme;
    if (appliedRoot === root) appliedRoot = null;
  };
}

export function resetThemeForTests(): void {
  theme = null;
  appliedRoot = null;
  listeners.clear();
}
```

- [ ] **Step 6: Run the store test**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: `theme-state.test.ts` PASS, 9 tests. `theme-boot.test.ts` FAIL in 13 of 19: "is found" (`BOOT_SCRIPT` is empty), the order test, the two `/explore` tests ("dark" and the trailing slash), the six default rows, the key test, the colour test and the selector test (1 + 1 + 2 + 6 + 1 + 1 + 1). The six "sets nothing" rows already pass, because an empty script sets nothing (`runBoot` returns `null`).

- [ ] **Step 7: Add the boot pair to `index.html`**

In `apps/web/index.html`, insert right after the line `    <!-- End Single Page Apps for GitHub Pages -->` (and before `  </head>`):

```html

    <!-- The explore page's theme before first paint (design decision 16), on /explore only and
         after the redirect above, which turns /?/explore into /explore. theme-boot.test.ts pins
         the key, the choices, the default and the colour to theme-defaults.ts and theme.ts. -->
    <script data-theme-boot>
      (function () {
        if (!/^\/explore\/?$/.test(location.pathname)) return;
        var theme = 'light';
        try {
          var stored = JSON.parse(localStorage.getItem('protspace:theme'));
          if (stored === 'system' || stored === 'light' || stored === 'dark') theme = stored;
        } catch (error) {
          // No storage (private mode, blocked site data) or a value that is not JSON: the default.
        }
        document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
    <style data-theme-boot>
      /* The dark surface until the explore chunk adopts the tokens. Unlayered, so it beats the
         landing's @layer base white body; #0f172a is dark --ps-surface. */
      :root[data-theme='dark'],
      :root[data-theme='dark'] body {
        color-scheme: dark;
        background: #0f172a;
      }
      @media (prefers-color-scheme: dark) {
        :root[data-theme='system'],
        :root[data-theme='system'] body {
          color-scheme: dark;
          background: #0f172a;
        }
      }
    </style>
```

Then run `pnpm exec prettier --write apps/web/index.html` and check with `git diff apps/web/index.html` that Prettier changed nothing outside the new block (it may reflow the block's comments; the test strips whitespace and comments, so its shape does not matter).

- [ ] **Step 8: Run the unit tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: PASS. `theme-state.test.ts` 9 tests, `theme-boot.test.ts` 19 tests (found, order, dark, trailing slash, 6 default rows, 6 path rows, key, colour, selectors).

- [ ] **Step 9: Apply the theme while Explore is mounted**

In `apps/web/src/pages/Explore.tsx`, replace the import line

```ts
import { useEffect } from 'react';
```

with

```ts
import { useEffect, useLayoutEffect } from 'react';
```

and replace

```ts
import { useExploreUrlStateSync } from '../explore/use-url-state-sync';
```

with

```ts
import { applyTheme } from '../explore/theme-state';
import { useExploreUrlStateSync } from '../explore/use-url-state-sync';
```

Then, in `const Explore = () => {`, insert between the line `  const { attachController } = useExploreUrlStateSync(searchParams, setSearchParams);` and the `  useEffect(() => {` that starts the runtime:

```tsx

  // The theme choice on <html> while this page is mounted (design decision 16): a layout effect,
  // so an arrival from the landing page is themed before the workbench paints; removed on leaving,
  // so the landing and privacy pages keep their look. A cold load already has it from index.html.
  useLayoutEffect(() => applyTheme(), []);
```

- [ ] **Step 10: Write the e2e helper**

Create `apps/web/tests/helpers/theme.ts`:

```ts
/**
 * The explore page's theme (design decision 16): seeding the stored choice, reading the one on
 * <html>, and the colours the specs compare against. The key comes from the app's leaf module.
 */
import type { Page } from '@playwright/test';
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';

/** Dark --ps-surface (#0f172a, slate-900) as getComputedStyle reports it. */
export const DARK_SURFACE = 'rgb(15, 23, 42)';

/**
 * Stores `value` as the theme choice before any page script runs, JSON-encoded as the app writes
 * it. Only when the key is absent, so a reload keeps what the page itself stored since. Any
 * string is accepted, so a spec can store an invalid one.
 */
export async function seedTheme(page: Page, value: ThemeChoice | string): Promise<void> {
  await page.addInitScript(
    ({ key, stored }) => {
      try {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, stored);
      } catch {
        // about:blank and opaque origins have no storage.
      }
    },
    { key: THEME_STORAGE_KEY, stored: JSON.stringify(value) },
  );
}

/** `<html>`'s data-theme, or null when the page has none. */
export async function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}
```

- [ ] **Step 11: Write the e2e spec**

Create `apps/web/tests/workbench-theme.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { appBar, openExplore, waitForExploreDataLoad } from './helpers/explore';
import { DARK_SURFACE, htmlTheme, seedTheme } from './helpers/theme';

/**
 * The explore page's theme (design decision 16): the stored choice, the first paint of a cold
 * load, the scope to /explore, and (Task 6.2 on) the switch.
 */

const WHITE = 'rgb(255, 255, 255)';

const workbench = (page: Page) => page.locator('.workbench');
const backgroundOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor);

/** The lazy Explore chunk: its dev-server path, or a production build's asset. */
const EXPLORE_CHUNK = /\/(src\/pages\/Explore\.tsx|assets\/Explore-[^/]*\.js)(\?|$)/;

/**
 * Loads `path` with the Explore chunk held back, so no token sheet is in the page. Returns the
 * body's background on the first animation frame (`first`) and again once the app has asked for
 * the chunk (`beforeChunk`: index.css is applied by then, the tokens are not), and `release`,
 * which lets the chunk through.
 */
async function loadWithExploreChunkHeld(
  page: Page,
  path = '/explore',
): Promise<{ first: string; beforeChunk: string; release: () => void }> {
  await page.addInitScript(() => {
    const sample = () => {
      if (!document.body) {
        requestAnimationFrame(sample);
        return;
      }
      (window as unknown as { __firstPaint?: string }).__firstPaint = getComputedStyle(
        document.body,
      ).backgroundColor;
    };
    requestAnimationFrame(sample);
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    EXPLORE_CHUNK,
    async (route) => {
      await gate;
      await route.fallback().catch(() => {});
    },
    { times: 1 },
  );
  const requested = page.waitForRequest(EXPLORE_CHUNK);
  await page.goto(path, { waitUntil: 'commit' });
  await requested;
  const first = (await (
    await page.waitForFunction(
      () => (window as unknown as { __firstPaint?: string }).__firstPaint ?? null,
    )
  ).jsonValue()) as string;
  const beforeChunk = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  return { first, beforeChunk, release };
}

test.describe('theme choice', () => {
  test('a cold load with Dark stored paints the dark surface before the Explore chunk runs', async ({
    page,
  }) => {
    await seedTheme(page, 'dark');
    const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

    expect(first).toBe(DARK_SURFACE);
    // The landing's white body rule is in the page now, layered; the boot style still wins.
    expect(beforeChunk).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('dark');
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    ).toBe('dark');

    release();
    await waitForExploreDataLoad(page);
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
  });

  test('the GitHub Pages deep link /?/explore is themed', async ({ page }) => {
    await seedTheme(page, 'dark');
    const { first, release } = await loadWithExploreChunkHeld(page, '/?/explore');

    // The redirect ran first: the path the boot script checked was already /explore.
    expect(new URL(page.url()).pathname).toBe('/explore');
    expect(first).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('dark');
    release();
    await waitForExploreDataLoad(page);
  });

  test('only /explore is themed', async ({ page }) => {
    await seedTheme(page, 'dark');
    for (const path of ['/', '/privacy']) {
      await page.goto(path);
      expect(await htmlTheme(page)).toBeNull();
      await expect.poll(() => backgroundOf(page.locator('body'))).toBe(WHITE);
    }

    await openExplore(page);
    expect(await htmlTheme(page)).toBe('dark');

    // Leaving through the wordmark's SPA link: Explore unmounts and takes the attribute with it.
    await appBar(page).getByRole('link', { name: 'ProtSpace home' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect.poll(() => htmlTheme(page)).toBeNull();
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    ).not.toBe('dark');
    await expect.poll(() => backgroundOf(page.locator('body'))).toBe(WHITE);
  });

  test('with nothing stored the page is Light', async ({ page }) => {
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('light');
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
    // An explicit Light ignores the OS.
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
  });
});

test.describe('theme choice on a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  test('System stored follows a dark OS before the chunk runs', async ({ page }) => {
    await seedTheme(page, 'system');
    const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

    expect(first).toBe(DARK_SURFACE);
    expect(beforeChunk).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');

    release();
    await waitForExploreDataLoad(page);
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');
  });
});
```

- [ ] **Step 12: Run the e2e spec**

Run (sandbox disabled: the run starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-theme.spec.ts`
Expected: PASS, 5 tests.

If "a cold load…" fails because `first` is `rgba(0, 0, 0, 0)`, the chunk route did not match and the sample came from a page that never waited (check `EXPLORE_CHUNK` against the request URL in the trace); if it fails with a white `first`, the boot pair is not ahead of the module script. Do not loosen the assertion.

Unrun at task time (the exit runs them first): `workbench-shell.spec.ts`, `kit-gallery.spec.ts`, `example-datasets.spec.ts`, `product-tour.spec.ts`.

- [ ] **Step 13: Document the theme store**

In `docs/developers/architecture.md`, insert before the line `## Filter panel`:

```md
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

```

- [ ] **Step 13b: Bring design.md in line with the phase's rulings**

`design.md` is the change's source of truth and is reread against the final diff before archiving, so record now what the phase settled. In `openspec/changes/explore-workbench/design.md`:

1. Decision 10, first paragraph: delete ", and the theme choice" at the end of the list of what the layout store holds (it wraps across two lines; the sentence then ends "… and floating rectangle.") so the store no longer claims the theme, and replace the paragraph's last sentence ("The theme choice gets its own key, …") with: "The theme choice has its own store, `apps/web/src/explore/theme-state.ts`, and its own key, `protspace:theme`, which an inline script in `apps/web/index.html` reads before first paint (decision 16)." Keep the file's line width (about 100 characters).
2. Decision 16: after the bullet that starts "The Mol\* viewer's background follows the theme." add these bullets (one sentence each):

```md
- `data-theme="system"` stays on `<html>` as chosen; the token sheet's media query follows the OS
  live, so nothing resolves it to light or dark in the attribute. The attribute is set only while
  `/explore` is mounted.
- "Selection ring" means the brush and lasso outline and the EAT endpoint ring; no GPU ring is
  drawn around selected points.
- Contour lines keep their lighten toward white in both themes; they get no token.
- The Mol\* canvas takes `--ps-surface`, so the structure card matches its panel.
```

Run: `pnpm exec prettier --check openspec/changes/explore-workbench/design.md`
Expected: pass (re-wrap by hand if not; do not let `--write` reflow other paragraphs).

- [ ] **Step 14: Type-check and format**

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors (the e2e helper and spec are in `tsconfig.e2e.json`, the store and its tests in `tsconfig.app.json`).

Run: `pnpm exec prettier --check apps/web/index.html apps/web/src/explore/theme-defaults.ts apps/web/src/explore/theme-state.ts apps/web/src/explore/theme-state.test.ts apps/web/src/explore/theme-boot.test.ts apps/web/src/pages/Explore.tsx apps/web/tests/helpers/theme.ts apps/web/tests/workbench-theme.spec.ts docs/developers/architecture.md`
Expected: all files pass (fix with `--write` and re-run Step 8 if Prettier reflowed `index.html`).

The full app suite, the full e2e run and the specs listed under Unrun run once at the phase exit (execution rule).

- [ ] **Step 15: Commit**

```bash
git add apps/web/index.html apps/web/src/explore/theme-defaults.ts apps/web/src/explore/theme-state.ts apps/web/src/explore/theme-state.test.ts apps/web/src/explore/theme-boot.test.ts apps/web/src/pages/Explore.tsx apps/web/tests/helpers/theme.ts apps/web/tests/workbench-theme.spec.ts docs/developers/architecture.md openspec/changes/explore-workbench/design.md
git commit -m "feat(web): theme store and a dark first paint on /explore"
```

(Sandbox disabled for the commit. Knip: `getTheme`, `setTheme`, `subscribeTheme`, `parseTheme` and `resetThemeForTests` are consumed by `theme-state.test.ts`, `applyTheme` by `Explore.tsx`; `DARK_SURFACE`, `seedTheme` and `htmlTheme` by `workbench-theme.spec.ts`.)

Report: the counts of `theme-state.test.ts` (9) and `theme-boot.test.ts` (19), the e2e count (5), LEGACY 7, and any anchor that had moved.

### Task 6.2: The theme switch in the app bar and the More sheet

Desktop and tablet get a "Theme" icon button between the Import/Export pair and Help, opening a radio menu (System, Light, Dark) whose icon shows the current choice. Phones and landscape get a Theme row with a segmented control in the More sheet between Export and Help & shortcuts. Both write through `setTheme`; the attribute follows at once.

**Files:**

- Modify: `packages/core/src/components/kit/icon.ts` (`sun`, `moon`, `sun-moon` from `lucide`), `packages/core/src/components/kit/icon.test.ts` (only if it enumerates keys)
- Modify: `apps/web/src/explore/theme-defaults.ts` (`THEME_LABELS`)
- Create: `apps/web/src/workbench/use-theme.ts`, `apps/web/src/workbench/ThemeMenu.tsx`
- Modify: `apps/web/src/workbench/AppBar.tsx` (`<ThemeMenu />` after the separator, before `<HelpMenu />`), `apps/web/src/workbench/MoreSheet.tsx` (the Theme row at the placeholder comment, which goes), `apps/web/src/workbench/workbench.css` (only if the tablet bar or the sheet row needs a rule)
- Modify: `apps/web/tests/helpers/theme.ts` (`themeButton`, `chooseTheme`), `apps/web/tests/helpers/mobile.ts` (`themeSegment`), `apps/web/tests/workbench-theme.spec.ts`, `apps/web/tests/mobile-bars.spec.ts`

**Interfaces:**

- Consumes: `ThemeChoice`, `THEME_CHOICES` (`theme-defaults.ts`), `getTheme`, `setTheme`, `subscribeTheme` (`theme-state.ts`) (6.1); `HelpMenu.tsx` as the pattern (`ps-icon-button` + `ps-menu placement="bottom-end"`, anchor set in an effect, `ps-select` listener); MoreSheet's Contours row as the pattern (`wb-sheet-row wb-sheet-row-static`, icon, `aria-hidden` label, `ps-segmented` with a `change` listener in an effect); `useWorkbenchStatus` (the More dot reads only `densityLayer` and `appliedFilterConditions`); helpers `seedTheme`, `htmlTheme`, `DARK_SURFACE` (6.1), `openExplore`, `appBar` (`helpers/explore.ts`), `openExplorePhone`, `moreButton`, `moreSheetContent` (`helpers/mobile.ts`), and `mobile-bars.spec.ts`'s file-level `openMoreSheet(page): Promise<Locator>`.
- Produces:
  - `icon.ts`: keys `sun` (`Sun`), `moon` (`Moon`), `sun-moon` (`SunMoon`); `IconName` grows with them.
  - `theme-defaults.ts`: `export const THEME_LABELS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }`.
  - `use-theme.ts`: `useTheme(): ThemeChoice` (`useSyncExternalStore(subscribeTheme, getTheme)`).
  - `ThemeMenu.tsx`: `ThemeMenu()` with no props, memo-free; renders `<ps-icon-button data-driver-id="theme" label="Theme" icon={…}>` (icon per Copy table) and `<ps-menu label="Theme" placement="bottom-end">` with three `<ps-menu-item type="radio" value={choice} checked={choice === theme}>` from `THEME_CHOICES` / `THEME_LABELS`; `ps-select` → `setTheme(value as ThemeChoice)`. No layer of its own (the menu is one).
  - `MoreSheet.tsx`: the Theme row (Copy table) with `options = THEME_CHOICES.map((value) => ({ value, label: THEME_LABELS[value] }))` (module constant), `value={theme}` from `useTheme()`, `change` → `setTheme`; the sheet stays open.
  - `tests/helpers/theme.ts`: `themeButton(page: Page): Locator` (`appBar(page).getByRole('button', { name: 'Theme' })`); `chooseTheme(page: Page, label: 'System' | 'Light' | 'Dark'): Promise<void>` (clicks the button, then `page.getByRole('menuitemradio', { name: label })`, waits for the menu to close).
  - `tests/helpers/mobile.ts`: `themeSegment(page: Page, label: 'System' | 'Light' | 'Dark'): Locator` (`moreSheetContent(page).getByRole('radio', { name: label })`).

**Tests:**

- `icon.test.ts`: "has the theme switch's icons" (`sun`, `moon`, `sun-moon` render an SVG with children). The file does not enumerate keys; this case is the failing test for the new keys.
- `workbench-theme.spec.ts`: "Dark from the app bar themes the page, survives a reload and is stored as JSON" (`chooseTheme(page, 'Dark')` → `htmlTheme` `dark`, `.workbench` background `DARK_SURFACE`; reload → still `dark`; `localStorage['protspace:theme'] === '"dark"'`); "the menu marks the current choice and opens on it" (`menuitemradio` "Dark" has `aria-checked="true"` and focus after reopening); "the button's icon shows the choice" (its `icon` property: `sun` after Light, `moon` after Dark, `sun-moon` after System); "System follows the OS live" (`chooseTheme(page, 'System')`, `page.emulateMedia({ colorScheme: 'dark' })` → `.workbench` background `DARK_SURFACE` with `data-theme` still `system`; back to `light` → white, no reload); "Escape closes the theme menu and returns focus to the button"; and, at 800×1000 (a tablet: layout mode is width-only), "the Theme button sits between Export and Help, and the dataset name and search still fit" (the measurement of `mobile-explore-layout.spec.ts`'s "the dataset name and the search placeholder fit", run here at task time because commit `3f987c91` sized the tablet bar to just fit and the button takes about 38 px from search).
- `mobile-bars.spec.ts` (runs at the exit): "the More sheet's Theme row switches the theme and the sheet stays open" (`themeSegment(page, 'Dark')` → `htmlTheme` `dark`, the sheet still visible); "the theme never lights the More dot" (after Dark, More's name is still "More view options"); "landscape's More sheet has the Theme row" (740×360); "the portrait tablet bar shows the Theme button and keeps the dataset name and search unclipped" (800×1280, measured as `mobile-explore-layout.spec.ts`'s "the dataset name and the search placeholder fit" measures at 800×1000). Two existing tests change with the row and the second `ps-menu`: C3's "no Theme row yet" assertion becomes "the Theme row is there", and C1/C2's `[data-workbench="app-bar-actions"] > ps-menu` display check reads both menus (a single-element `evaluate` on two matches fails Playwright's strict mode).
- Unrun at task time (exit): `mobile-bars.spec.ts` (edited, run first), `mobile-explore-layout.spec.ts` ("the app bar on an 800 px tablet": the Theme button takes about 38 px from search), `workbench-help.spec.ts` (bar order), `workbench-shell.spec.ts` (app bar layout), `mobile-shell.spec.ts`, `workbench-view-bar.spec.ts` (tablet bar widths), `kit-gallery.spec.ts`.

LEGACY count: 7.

Facts this task relies on (checked at `a5a81b25`):

- `ps-menu` sets `aria-haspopup`/`aria-expanded` on its `anchor` (the `ps-icon-button` host), focuses the checked radio on open (`menu.ts` `onOpen`), and on a pick sets every radio item's `checked` itself, closes, refocuses the anchor's inner button, then dispatches `ps-select`. React re-renders the items with the same `checked` values after `setTheme`, so nothing fights.
- React 19 sets `icon`, `label`, `checked`, `options` and `value` on the kit elements as properties (each is a declared property); `data-driver-id` stays an attribute. So a spec reads the button's choice from `ps-icon-button[data-driver-id="theme"]`'s `icon` property, and never from an attribute.
- `ps-segmented` renders `role="radiogroup"` (named by `label`) with `role="radio"` buttons carrying `aria-checked`, and dispatches a bubbling `change` with `detail.value` after setting its own `value`.
- On phones and in landscape, `workbench.css` (`.workbench[data-layout='phone'|'landscape'] [data-workbench='app-bar-actions'] > :not(.wb-data-actions, ps-menu)`) hides every action except the data actions and `ps-menu` hosts: the Theme button hides and its `ps-menu` stays rendered at 0×0, with no CSS change.
- The app imports core's built types: after `icon.ts` changes, `pnpm --filter @protspace/core build` runs before the app's type-check, or `icon={'sun-moon'}` fails to type.

- [ ] **Step 1: Write the failing icon test**

In `packages/core/src/components/kit/icon.test.ts`, add inside `describe('icon', () => {`, after the test `'defaults to 16px'`:

```ts
  it.each(['sun', 'moon', 'sun-moon'] as const)("has the theme switch's icon %s", (name) => {
    const markup = iconMarkup(name, 16);
    expect(markup).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(markup).toMatch(/<(path|circle) /);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/icon.test.ts`
Expected: FAIL, 3 tests: `TypeError: Cannot read properties of undefined (reading '2')` in `iconMarkup` (`ICONS[name]` has no `sun`, `moon` or `sun-moon`).

- [ ] **Step 3: Add the three icons**

In `packages/core/src/components/kit/icon.ts`, in the `from 'lucide'` import list, insert `Moon,` after `Minus,`, and insert `Sun,` and `SunMoon,` after `SquarePen,`:

```ts
  Minus,
  Moon,
  MousePointer,
```

```ts
  SquarePen,
  Sun,
  SunMoon,
  Target,
```

In `const ICONS = {`, insert `moon: Moon,` after `minus: Minus,`, and `sun: Sun,` and `'sun-moon': SunMoon,` after `'square-pen': SquarePen,`:

```ts
  minus: Minus,
  moon: Moon,
  'mouse-pointer': MousePointer,
```

```ts
  'square-pen': SquarePen,
  sun: Sun,
  'sun-moon': SunMoon,
  target: Target,
```

(`lucide@0.462.0` exports all three; `lucide-react@0.462.0` exports `Sun` for the More sheet.)

- [ ] **Step 4: Run the icon test**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/kit/icon.test.ts`
Expected: PASS, 6 tests (3 existing + 3 new).

Run: `pnpm --filter @protspace/core build`
Expected: the build succeeds (the app's type-check below reads `IconName` from `dist`).

- [ ] **Step 5: Write the failing e2e tests**

In `apps/web/tests/helpers/theme.ts`, replace the import block

```ts
import type { Page } from '@playwright/test';
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';
```

with

```ts
import { expect, type Locator, type Page } from '@playwright/test';
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';
import { appBar } from './explore';
```

and append to the file:

```ts

/** The app bar's Theme button (desktop and tablet; hidden on phones and in landscape). */
export const themeButton = (page: Page): Locator =>
  appBar(page).getByRole('button', { name: 'Theme', exact: true });

/** Picks a theme from the app bar's Theme menu and waits for the menu to close. */
export async function chooseTheme(page: Page, label: 'System' | 'Light' | 'Dark'): Promise<void> {
  const menu = page.getByRole('menu', { name: 'Theme', exact: true });
  await themeButton(page).click();
  await expect(menu).toBeVisible();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect(menu).toBeHidden();
}
```

In `apps/web/tests/workbench-theme.spec.ts`, replace the two helper imports

```ts
import { appBar, openExplore, waitForExploreDataLoad } from './helpers/explore';
import { DARK_SURFACE, htmlTheme, seedTheme } from './helpers/theme';
```

with

```ts
import { THEME_STORAGE_KEY } from '../src/explore/theme-defaults';
import { appBar, openExplore, waitForExploreDataLoad } from './helpers/explore';
import { chooseTheme, DARK_SURFACE, htmlTheme, seedTheme, themeButton } from './helpers/theme';
```

and append to the end of the file:

```ts

test.describe('the theme switch', () => {
  /** The Theme button's `icon` property: the icon the button shows. */
  const shownIcon = (page: Page) =>
    appBar(page)
      .locator('ps-icon-button[data-driver-id="theme"]')
      .evaluate((button) => (button as HTMLElement & { icon: string }).icon);

  test('Dark from the app bar themes the page, survives a reload and is stored as JSON', async ({
    page,
  }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');

    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe(
      '"dark"',
    );

    await page.reload();
    await waitForExploreDataLoad(page);
    expect(await htmlTheme(page)).toBe('dark');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
  });

  test('the menu marks the current choice and opens on it', async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');

    await themeButton(page).click();
    const item = (name: string) => page.getByRole('menuitemradio', { name, exact: true });
    await expect(item('Dark')).toHaveAttribute('aria-checked', 'true');
    await expect(item('Dark')).toBeFocused();
    await expect(item('System')).toHaveAttribute('aria-checked', 'false');
    await expect(item('Light')).toHaveAttribute('aria-checked', 'false');
    await expect(themeButton(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test("the button's icon shows the choice", async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'Light');
    expect(await shownIcon(page)).toBe('sun');
    await chooseTheme(page, 'Dark');
    expect(await shownIcon(page)).toBe('moon');
    await chooseTheme(page, 'System');
    expect(await shownIcon(page)).toBe('sun-moon');
  });

  test('System follows the OS live', async ({ page }) => {
    await openExplore(page);
    await chooseTheme(page, 'System');
    expect(await htmlTheme(page)).toBe('system');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(WHITE);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => backgroundOf(workbench(page))).toBe(DARK_SURFACE);
    expect(await htmlTheme(page)).toBe('system');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => backgroundOf(workbench(page))).toBe(WHITE);
  });

  test('Escape closes the theme menu and returns focus to the button', async ({ page }) => {
    await openExplore(page);
    await themeButton(page).focus();
    await page.keyboard.press('Enter');

    const menu = page.getByRole('menu', { name: 'Theme', exact: true });
    await expect(menu).toBeVisible();
    // Whatever the default, the menu opens on the checked choice.
    await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(themeButton(page)).toBeFocused();
  });
});

test.describe('the theme switch on an 800 px tablet', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('the Theme button sits between Export and Help, and the dataset name and search still fit', async ({
    page,
  }) => {
    await openExplore(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    const sides = async (locator: Locator) => {
      const b = (await locator.boundingBox())!;
      return { left: b.x, right: b.x + b.width };
    };
    const exported = await sides(appBar(page).getByRole('button', { name: 'Export', exact: true }));
    const theme = await sides(themeButton(page));
    const help = await sides(appBar(page).getByRole('button', { name: 'Help', exact: true }));
    expect(exported.right).toBeLessThanOrEqual(theme.left);
    expect(theme.right).toBeLessThanOrEqual(help.left);
    const fits = await page.evaluate(() => {
      const widthOf = (text: string, element: Element) => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = getComputedStyle(element).font;
        return context.measureText(text).width;
      };
      const name = document.querySelector('.wb-dataset-name')!;
      const input = document
        .querySelector('#myProteinSearch')!
        .shadowRoot!.querySelector<HTMLInputElement>('input')!;
      return {
        // The demo dataset's name, the longest an example has on this bar.
        name: widthOf('Venom toxins (demo)', name) <= parseFloat(getComputedStyle(name).maxWidth),
        placeholder: widthOf(input.placeholder, input) <= input.clientWidth,
      };
    });
    expect(fits).toEqual({ name: true, placeholder: true });
  });
});
```

(`appBar` is now used by the 6.1 wordmark test, `shownIcon` and the tablet test; `Page`, `Locator`, `backgroundOf`, `workbench` and `WHITE` are the file's own from Task 6.1. The measurement in `page.evaluate` reads the search's shadow root directly, as `mobile-explore-layout.spec.ts` does; it is a spec's measurement, not a helper.)

- [ ] **Step 6: Run them to see them fail**

Run (sandbox disabled; a short timeout, because each test fails waiting for the Theme button): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-theme.spec.ts -g "the theme switch" --timeout=15000`
Expected: FAIL, 6 tests (the five above and the tablet test, whose title also matches): each times out waiting for `getByRole('button', { name: 'Theme' })` in the app bar (there is no Theme button yet).

- [ ] **Step 7: Add the labels and the hook**

In `apps/web/src/explore/theme-defaults.ts`, insert after the `THEME_CHOICES` declaration:

```ts

/** What the switch calls each choice: the app bar's menu items and the More sheet's segments. */
export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
```

Create `apps/web/src/workbench/use-theme.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { ThemeChoice } from '../explore/theme-defaults';
import { getTheme, subscribeTheme } from '../explore/theme-state';

/** The explore page's theme choice; re-renders when it changes. */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
```

- [ ] **Step 8: Create the app bar's Theme menu**

Create `apps/web/src/workbench/ThemeMenu.tsx`:

```tsx
import type { PsMenu } from '@protspace/core';
import { useEffect, useRef } from 'react';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../explore/theme-defaults';
import { setTheme } from '../explore/theme-state';
import { useTheme } from './use-theme';

/** The button's icon shows the current choice. */
const THEME_ICONS = {
  system: 'sun-moon',
  light: 'sun',
  dark: 'moon',
} as const satisfies Record<ThemeChoice, string>;

/**
 * The app bar's theme switch (design decision 16), between Import/Export and Help on desktop and
 * tablet: an icon button opening a radio menu. On phones and in landscape the button is hidden
 * with the other actions (its ps-menu stays rendered) and the More sheet's Theme row takes over.
 */
export function ThemeMenu() {
  const theme = useTheme();
  const trigger = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.anchor = trigger.current;
    const onSelect = (event: Event) => {
      setTheme((event as CustomEvent<{ value: string }>).detail.value as ThemeChoice);
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
        data-driver-id="theme"
        icon={THEME_ICONS[theme]}
        label="Theme"
        onClick={toggle}
      ></ps-icon-button>
      <ps-menu ref={menu} label="Theme" placement="bottom-end">
        {THEME_CHOICES.map((choice) => (
          <ps-menu-item key={choice} type="radio" value={choice} checked={choice === theme}>
            {THEME_LABELS[choice]}
          </ps-menu-item>
        ))}
      </ps-menu>
    </>
  );
}
```

- [ ] **Step 9: Put it in the app bar**

In `apps/web/src/workbench/AppBar.tsx`, replace

```ts
import { SearchToggle } from './SearchToggle';
```

with

```ts
import { SearchToggle } from './SearchToggle';
import { ThemeMenu } from './ThemeMenu';
```

and in the `<div data-workbench="app-bar-actions">` block replace

```tsx
        <DataActions />
        <span className="wb-separator" aria-hidden="true" />
        <HelpMenu />
```

with

```tsx
        <DataActions />
        <span className="wb-separator" aria-hidden="true" />
        {/* Decision 1's order: Import and Export, the theme switch, Help, Feedback, GitHub. */}
        <ThemeMenu />
        <HelpMenu />
```

- [ ] **Step 10: Run the desktop e2e tests**

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors (needs Step 4's core build for the new icon names).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-theme.spec.ts`
Expected: PASS, 11 tests (Task 6.1's 5 and these 6).

If the tablet test fails on `placeholder: false` (or `name: false`), make room on the tablet bar only, under `.workbench[data-layout='tablet']` in `apps/web/src/workbench/workbench.css`: first hide the `.wb-separator` before the Theme button there; if that is not enough, narrow the gap between the bar's actions. Never hide the Theme button and never change the desktop bar. Re-run the spec and report the measured widths (`input.clientWidth` and the placeholder's text width) before and after.

- [ ] **Step 11: Add the More sheet's Theme row**

In `apps/web/src/workbench/MoreSheet.tsx`:

Replace the `lucide-react` import list's `MessageSquare,` line with

```ts
  MessageSquare,
  Sun,
```

Replace

```ts
import { focusFilterTitle, openPanel } from '../explore/layout-state';
```

with

```ts
import { focusFilterTitle, openPanel } from '../explore/layout-state';
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '../explore/theme-defaults';
import { setTheme } from '../explore/theme-state';
```

and replace

```ts
import { useWorkbenchStatus } from './use-workbench-status';
```

with

```ts
import { useTheme } from './use-theme';
import { useWorkbenchStatus } from './use-workbench-status';
```

After the `CONTOUR_OPTIONS` constant, insert:

```ts

/** The theme choices as the segmented control offers them, named as the app bar's menu names them. */
const THEME_OPTIONS = THEME_CHOICES.map((value) => ({ value, label: THEME_LABELS[value] }));
```

In the component's doc comment, replace `Contours applies in place and keeps the sheet open.` with `Contours and Theme apply in place and keep the sheet open.`

In `export function MoreSheet(…)`, replace

```ts
  const contours = useRef<HTMLElement>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
```

with

```ts
  const contours = useRef<HTMLElement>(null);
  const themeControl = useRef<HTMLElement>(null);
  const { densityLayer, appliedFilterConditions } = useWorkbenchStatus();
  // Not part of the More dot, which marks only what changes the view (Contours, a filter).
  const theme = useTheme();
```

After the Contours `useEffect` (the one ending `return () => element.removeEventListener('change', onChange);\n  }, []);` whose handler calls `pick(mode)`), insert:

```ts

  // A theme applies at once, like Contours: the sheet stays open.
  useEffect(() => {
    const element = themeControl.current;
    if (!element) return;
    const onChange = (event: Event) => {
      setTheme((event as CustomEvent<{ value: ThemeChoice }>).detail.value);
    };
    element.addEventListener('change', onChange);
    return () => element.removeEventListener('change', onChange);
  }, []);
```

Replace the placeholder line

```tsx
          {/* Task 6.1 adds the Theme row here (System, Light, Dark), as mockup frame 4 shows. */}
```

with

```tsx
          <div className="wb-sheet-row wb-sheet-row-static">
            <Sun className="wb-sheet-icon" {...ICON} />
            {/* The radio group carries the name; the word is for the eye. */}
            <span className="wb-sheet-label" aria-hidden="true">
              Theme
            </span>
            <ps-segmented
              ref={themeControl}
              label="Theme"
              options={THEME_OPTIONS}
              value={theme}
            ></ps-segmented>
          </div>
```

The existing `.wb-sheet-row ps-segmented { flex: none; }` and `.wb-sheet-row-static` rules lay the row out as the Contours row; `workbench.css` needs no change.

- [ ] **Step 12: Add the phone helper and the phone tests (run at the exit)**

In `apps/web/tests/helpers/mobile.ts`, insert after the `moreSheetContent` export:

```ts

/** A segment of the More sheet's Theme row, by its text. */
export const themeSegment = (page: Page, label: 'System' | 'Light' | 'Dark'): Locator =>
  moreSheetContent(page).getByRole('radio', { name: label, exact: true });
```

In `apps/web/tests/mobile-bars.spec.ts`:

(a) Add `themeSegment,` to the `./helpers/mobile` import list after `tap,`:

```ts
  tap,
  themeSegment,
  touchTargetsBelow,
```

and add after the `import { stubStructureRequests } from './helpers/workbench';` line:

```ts
import { DARK_SURFACE, htmlTheme, themeButton } from './helpers/theme';
```

(b) In the C1/C2 test (`${label}: the bars fit with whole labels and 40 px targets…`), replace

```ts
      await expect(appBar(page).getByRole('button', { name: 'Help', exact: true })).toBeHidden();
      // The Help menu's popover host stays rendered: no display: none above a popover.
      expect(
        await appBar(page)
          .locator('[data-workbench="app-bar-actions"] > ps-menu')
          .evaluate((menu) => getComputedStyle(menu).display),
      ).toBe('contents');
```

with

```ts
      await expect(appBar(page).getByRole('button', { name: 'Help', exact: true })).toBeHidden();
      await expect(themeButton(page)).toBeHidden();
      // The Theme and Help menus' popover hosts stay rendered: no display: none above a popover.
      expect(
        await appBar(page)
          .locator('[data-workbench="app-bar-actions"] > ps-menu')
          .evaluateAll((menus) => menus.map((menu) => getComputedStyle(menu).display)),
      ).toEqual(['contents', 'contents']);
```

(c) In C3 (`'C3: the More sheet opens on screen and runs an action'`), replace

```ts
    // Theme arrives with the theme switch (Task 6.1); GitHub is not offered on a phone.
    await expect(rows.getByText(/Theme/)).toHaveCount(0);
```

with

```ts
    await expect(rows.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    // GitHub is not offered on a phone.
```

(d) In `test.describe('the bars on a phone on its side', () => {`, add after the C9 test:

```ts

  test("landscape's More sheet has the Theme row", async ({ page }) => {
    await openExplorePhone(page);
    const rows = await openMoreSheet(page);
    const theme = rows.getByRole('radiogroup', { name: 'Theme' });
    await theme.scrollIntoViewIfNeeded();
    await expectWithinViewport(page, theme);

    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await expect(moreSheet(page)).toBeVisible();
  });
```

(e) In `test.describe('the bars on a portrait tablet', () => {`, add after C10:

```ts

  test('the portrait tablet bar shows the Theme button and keeps the dataset name and search unclipped', async ({
    page,
  }) => {
    await openExplorePhone(page);
    await expect(workbench(page)).toHaveAttribute('data-layout', 'tablet');
    await expect(themeButton(page)).toBeVisible();

    // Decision 1's order: Export, then Theme, then Help.
    const exported = await box(exportTrigger(page));
    const theme = await box(themeButton(page));
    const help = await box(appBar(page).getByRole('button', { name: 'Help', exact: true }));
    expect(exported.x + exported.width).toBeLessThanOrEqual(theme.x);
    expect(theme.x + theme.width).toBeLessThanOrEqual(help.x);

    // As mobile-explore-layout.spec.ts measures at 800×1000: the one more button leaves both whole.
    const fits = await page.evaluate(() => {
      const widthOf = (text: string, element: Element) => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = getComputedStyle(element).font;
        return context.measureText(text).width;
      };
      const name = document.querySelector('.wb-dataset-name')!;
      const input = document
        .querySelector('#myProteinSearch')!
        .shadowRoot!.querySelector<HTMLInputElement>('input')!;
      return {
        // The demo dataset's name, the longest an example has on this bar.
        name: widthOf('Venom toxins (demo)', name) <= parseFloat(getComputedStyle(name).maxWidth),
        placeholder: widthOf(input.placeholder, input) <= input.clientWidth,
      };
    });
    expect(fits).toEqual({ name: true, placeholder: true });
  });
```

(f) In `test.describe('the More sheet', () => {`, add after the test `'the More dot shows with a filter applied'`:

```ts

  test("the More sheet's Theme row switches the theme and the sheet stays open", async ({
    page,
  }) => {
    const rows = await openMoreSheet(page);
    // Between Export and Help & shortcuts, as mockup frame 4 has it.
    const exported = await box(rows.getByRole('button', { name: /^Export/ }));
    const theme = await box(rows.getByRole('radiogroup', { name: 'Theme' }));
    const help = await box(rows.getByRole('button', { name: 'Help & shortcuts', exact: true }));
    expect(exported.y).toBeLessThan(theme.y);
    expect(theme.y).toBeLessThan(help.y);

    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await expect(themeSegment(page, 'Dark')).toHaveAttribute('aria-checked', 'true');
    await expect(moreSheet(page)).toBeVisible();
    await expect
      .poll(() => workbench(page).evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(DARK_SURFACE);
  });

  test('the theme never lights the More dot', async ({ page }) => {
    await openMoreSheet(page);
    await themeSegment(page, 'Dark').tap();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await moreSheet(page).getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(moreSheet(page)).toBeHidden();

    await expect(moreButton(page)).toHaveAccessibleName('More view options');
    await expect(viewBar(page).locator('.wb-more-dot')).toBeHidden();
  });
```

(`workbench`, `exportTrigger`, `openMoreSheet` are the file's own helpers; `box`, `expectWithinViewport`, `moreSheet`, `moreButton`, `viewBar`, `appBar` are already imported.)

These four tests and the edited C1–C3 run at the phase exit (execution rule: this task's one e2e spec is `workbench-theme.spec.ts`). The portrait tablet test is the Pixel 7 twin of this task's 800 px desktop-project measurement in `workbench-theme.spec.ts`; if Step 10 needed a tablet rule, it already covers both.

- [ ] **Step 13: Re-run the affected checks**

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors (`MoreSheet.tsx`, the helpers and `mobile-bars.spec.ts` type-check).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-theme.spec.ts`
Expected: PASS, 11 tests (the same spec, re-run after the More sheet edit, which renders on desktop too inside the closed sheet).

Run: `pnpm exec prettier --check packages/core/src/components/kit/icon.ts packages/core/src/components/kit/icon.test.ts apps/web/src/explore/theme-defaults.ts apps/web/src/workbench/use-theme.ts apps/web/src/workbench/ThemeMenu.tsx apps/web/src/workbench/AppBar.tsx apps/web/src/workbench/MoreSheet.tsx apps/web/tests/helpers/theme.ts apps/web/tests/helpers/mobile.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/mobile-bars.spec.ts`
Expected: all files pass.

Unrun at task time (the exit runs them first): `mobile-bars.spec.ts` (edited), `mobile-explore-layout.spec.ts` (800 px tablet bar), `workbench-help.spec.ts`, `workbench-shell.spec.ts`, `mobile-shell.spec.ts`, `workbench-view-bar.spec.ts`, `kit-gallery.spec.ts`.

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/components/kit/icon.ts packages/core/src/components/kit/icon.test.ts apps/web/src/explore/theme-defaults.ts apps/web/src/workbench/use-theme.ts apps/web/src/workbench/ThemeMenu.tsx apps/web/src/workbench/AppBar.tsx apps/web/src/workbench/MoreSheet.tsx apps/web/tests/helpers/theme.ts apps/web/tests/helpers/mobile.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/mobile-bars.spec.ts
git commit -m "feat(web): theme switch in the app bar and the More sheet"
```

(Sandbox disabled for the commit. Knip: `THEME_LABELS` is read by `ThemeMenu.tsx` and `MoreSheet.tsx`, `useTheme` by both, `themeButton` and `chooseTheme` by `workbench-theme.spec.ts` (and `themeButton` by `mobile-bars.spec.ts`), `themeSegment` by `mobile-bars.spec.ts`.)

Report: `icon.test.ts` 6, `workbench-theme.spec.ts` 11, LEGACY 7; whether the tablet bar needed a rule (Step 10) and the measured placeholder width against `input.clientWidth`.

### Task 6.3: Plot neutrals as an input; exports always stage light

The plot's style getters take the neutral greys (Other, N/A) as an input instead of baking `NEUTRAL_VALUE_COLOR`, the density pass takes the neutral key as a parameter, and exports stage through their own light getters with a fixed white knockout. The live view still passes `LIGHT_NEUTRALS`, so nothing visible changes; Task 6.4 makes the input follow the theme. Landing the split first means the test that exports stay light exists before anything can turn dark.

**Files:**

- Create: `packages/core/src/components/scatter-plot/styling/plot-neutrals.ts`
- Modify: `packages/core/src/components/scatter-plot/styling/style-getters.ts`, `style-getters.test.ts`
- Modify: `packages/core/src/components/scatter-plot/styling/point-style-state.ts`, `point-style-state.test.ts`
- Modify: `packages/core/src/components/scatter-plot/webgl/renderer/density-pass.ts`, `density-pass.test.ts`, `webgl-renderer.ts`, `webgl-renderer.density.test.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts` (`_neutrals` source, style host input, renderer options, `exportStyle`, `captureAtResolution` knockout)
- Create: `packages/core/src/components/scatter-plot/scatter-plot.export-style.test.ts`

**Interfaces:**

- Consumes: `NEUTRAL_VALUE_COLOR` (`scatter-plot/config.ts`), `NA_DEFAULT_COLOR`, `isNAValue`, `toInternalValue` (`@protspace/utils`; `isNAValue(value: string)` compares with `'__NA__'`, so it takes the internal key), `createStyleGetters(data, styleConfig, model?)` and its `colorsOfValues` (used by `getColors` and by `createStylePass` through `style-pass.ts`), `PointStyleState`/`PointStyleHost`, `WebGLRendererOptions` (`webgl-renderer.ts:153`), `buildSlotPalette`, `buildRecordSlotPalette`, `paletteFromEntries` and the module `NEUTRAL_KEY` (`density-pass.ts`), `resolveColor` (`webgl/color-utils.ts`), `ScatterPlot._createWebglRenderer` (`scatter-plot.ts:481-528`) and `captureAtResolution` (`:2455-2552`); test support: `createPlot`/`PlotInternals` (`test-support/plot-fixture.ts`), `createPassScratch` (`webgl/renderer/pass-staging.ts`), `createMockCanvas` (`webgl/renderer/test-support/mock-webgl2.ts`), `internalsOf(renderer).contourPalette` (`webgl/renderer/test-support/renderer-internals.ts`), and the `vi.mock('./webgl', …)` renderer stub of `scatter-plot.gpu-marks.test.ts`.
- Produces:
  - `plot-neutrals.ts`: `export interface PlotNeutrals { readonly other: string; readonly na: string }`; `export const LIGHT_NEUTRALS: PlotNeutrals` (frozen, `{ other: NEUTRAL_VALUE_COLOR, na: NA_DEFAULT_COLOR }`); `export function sameNeutrals(a: PlotNeutrals, b: PlotNeutrals): boolean` (case-insensitive, trimmed).
  - `createStyleGetters(data, styleConfig, model?, neutrals: PlotNeutrals = LIGHT_NEUTRALS)`: **the neutrals are the fourth parameter**, after the existing optional `model` (the skeleton wrote it as the third; the real third parameter is `model`). Every `NEUTRAL_VALUE_COLOR` in `colorsOfValues` and `getColors` becomes `neutrals.other`; a value with `isNAValue(key)` whose mapped colour equals `NA_DEFAULT_COLOR` case-insensitively yields `neutrals.na` (only when `neutrals.na` is not itself the default, so light keeps the data's string); any other N/A colour is kept.
  - `PointStyleHost.neutrals(): PlotNeutrals` (new required input); `build()` passes it; `PointStyleState.exportGetters(): StyleGetters` (returns `getters()` when `sameNeutrals(host.neutrals(), LIGHT_NEUTRALS)`, else getters built over `model()` with `LIGHT_NEUTRALS`, cached until `invalidateGetters()`/`refreshGetters()`/`releaseDataset()` or until `getters()` is rebuilt).
  - `density-pass.ts`: `export function neutralKeyOf(color: string): number` (the colour's 24-bit key, as `colorKey` computes for staged colours; a `#rrggbb` string is parsed directly, anything else through `resolveColor`; `neutralKeyOf(NEUTRAL_VALUE_COLOR)` equals today's `NEUTRAL_KEY`, 0x888888); `buildSlotPalette(colors, count, gamma, marked = null, neutralKey = neutralKeyOf(NEUTRAL_VALUE_COLOR))` and `buildRecordSlotPalette(staged, gamma, firstDrawn = staged.firstDrawn, neutralKey = …)` pass it to `paletteFromEntries(entries, gamma, neutralKey)`, which uses it where `NEUTRAL_KEY` was.
  - `WebGLRendererOptions.getNeutralColor?: () => string` (default `() => NEUTRAL_VALUE_COLOR`); the contour palette is built with `neutralKeyOf(this.getNeutralColor())`.
  - `scatter-plot.ts`: `private readonly _neutrals = (): PlotNeutrals => LIGHT_NEUTRALS` (an instance arrow field, so a test can replace it; Task 6.4 replaces its body); the `PointStyleState` host gets `neutrals: () => this._neutrals()`; the renderer gets `getNeutralColor: () => this._neutrals().other`; `exportStyle` takes `getColors`, `getPointSize`, `getShape`, `isPredicted`, `isMultilabel`, `getDepth` and `createStylePass` from `style.exportGetters()` (the live `style` keeps `getters()`/`stageGetters()`; the export's `getOpacity` stays `this._getOpacity`); `captureAtResolution` always passes the knockout `[1, 1, 1]` (module constant `EXPORT_KNOCKOUT`) and no longer reads `getComputedStyle(this)` (the `'transparent'` branch and the `resolveColor` import go).

**Tests:**

- `style-getters.test.ts`: "Other values take neutrals.other"; "an all-Other point takes neutrals.other"; "a default-coloured N/A takes neutrals.na (any letter case)"; "a user-picked N/A colour is kept"; "a regular category coloured #DDDDDD keeps its colour"; "the style pass's colours follow the neutrals too"; "without a neutrals argument every existing expectation holds" (the existing tests unchanged).
- `point-style-state.test.ts`: "exportGetters is getters() while the neutrals are light"; "with dark neutrals, exportGetters colours Other #888888 while getters() colours it with the dark grey"; "invalidateGetters drops the light export getters too".
- `density-pass.test.ts`: "neutralKeyOf('#888888') equals the default key"; "a passed neutral key takes the tail slot over the cap"; "the default key keeps today's palettes".
- `webgl-renderer.density.test.ts`: "the contour palette uses getNeutralColor's key".
- `scatter-plot.export-style.test.ts` (jsdom, mocking `WebGLRenderer` and capturing its options as the existing render-path tests do; overriding `_neutrals` to dark): "exportStyle.getColors gives #888888 for Other while style.getColors gives the dark grey"; "captureAtResolution passes the knockout [1, 1, 1] whatever the background option, including 'transparent' and 'rgba(0,0,0,0)'".
- Unrun at task time (exit): `figure-editor.spec.ts`, `workbench-import-export.spec.ts` (exports), `density-layer.spec.ts` (contour palette), `eat-visualization.spec.ts`.

LEGACY count: 7. Report `wc -l scatter-plot.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Every test here is a `--project unit` test (jsdom or node), so the sandbox can stay on. No utils change: core's tests import the built `@protspace/utils` as it is.

- [ ] **Step 1: Write the failing style-getters tests**

In `packages/core/src/components/scatter-plot/styling/style-getters.test.ts`, replace the import block at the top of the file:

```ts
import { describe, it, expect } from 'vitest';
import type { StyleConfig } from './style-getters';
import { createStyleGetters } from './style-getters';
import type { VisualizationData, PlotDataPoint } from '@protspace/utils';
```

with:

```ts
import { describe, it, expect } from 'vitest';
import type { StyleConfig } from './style-getters';
import { createStyleGetters } from './style-getters';
import type { VisualizationData, PlotData, PlotDataPoint } from '@protspace/utils';
import type { PlotNeutrals } from './plot-neutrals';
import { createPassScratch } from '../webgl/renderer/pass-staging';
```

Then add this `describe` block inside the top-level `describe('style-getters', () => { … })`, directly after the closing `});` of `describe('EAT glyph classification', …)`:

```ts
  describe('neutral greys', () => {
    const DARK: PlotNeutrals = { other: '#64748b', na: '#2a3547' };

    const config = (overrides: Partial<StyleConfig> = {}): StyleConfig => ({
      selectedProteinIds: [],
      highlightedProteinIds: [],
      selectedAnnotation: 'fam',
      hiddenAnnotationValues: [],
      otherAnnotationValues: [],
      zOrderMapping: null,
      colorMapping: null,
      shapeMapping: null,
      sizes: { base: 10 },
      opacities: { base: 1, selected: 1, faded: 0.3 },
      ...overrides,
    });

    const point = (i: number): PlotDataPoint => ({ id: `p${i}`, x: 0, y: 0, originalIndex: i });

    /** Values A, B and C, one protein each, and a fourth protein holding both B and C. */
    const families = (): VisualizationData => ({
      protein_ids: ['p0', 'p1', 'p2', 'p3'],
      projections: [{ name: 'test', data: new Float32Array(8), dimension: 2 }],
      annotations: {
        fam: {
          values: ['A', 'B', 'C'],
          colors: ['#ff0000', '#00ff00', '#0000ff'],
          shapes: ['circle', 'circle', 'circle'],
        },
      },
      annotation_data: { fam: [[0], [1], [2], [1, 2]] },
    });

    /** Protein 0 is N/A coloured `naColor`; protein 1 is the regular value A coloured #DDDDDD. */
    const withNA = (naColor: string): VisualizationData => ({
      protein_ids: ['p0', 'p1'],
      projections: [{ name: 'test', data: new Float32Array(4), dimension: 2 }],
      annotations: {
        fam: {
          values: [null, 'A'],
          colors: [naColor, '#DDDDDD'],
          shapes: ['circle', 'circle'],
        },
      },
      annotation_data: { fam: [[0], [1]] },
    });

    it('Other values take neutrals.other', () => {
      const getters = createStyleGetters(
        families(),
        config({ otherAnnotationValues: ['B'] }),
        undefined,
        DARK,
      );
      expect(getters.getColors(point(1))).toEqual(['#64748b']);
      expect(getters.getColors(point(0))).toEqual(['#ff0000']);
      // A value the mapping gives no colour falls back to the same grey.
      const unmapped = createStyleGetters(
        families(),
        config({ colorMapping: { A: '#ff0000' } }),
        undefined,
        DARK,
      );
      expect(unmapped.getColors(point(2))).toEqual(['#64748b']);
    });

    it('an all-Other point takes neutrals.other', () => {
      const getters = createStyleGetters(
        families(),
        config({ otherAnnotationValues: ['B', 'C'] }),
        undefined,
        DARK,
      );
      expect(getters.getColors(point(3))).toEqual(['#64748b']);
      // No selected annotation: every point is neutral.
      const none = createStyleGetters(families(), config({ selectedAnnotation: '' }), undefined, DARK);
      expect(none.getColors(point(0))).toEqual(['#64748b']);
    });

    it('a default-coloured N/A takes neutrals.na (any letter case)', () => {
      for (const color of ['#DDDDDD', '#dddddd']) {
        const getters = createStyleGetters(withNA(color), config(), undefined, DARK);
        expect(getters.getColors(point(0)), color).toEqual(['#2a3547']);
      }
      // Through the legend's mapping too.
      const mapped = createStyleGetters(
        withNA('#ff00ff'),
        config({ colorMapping: { __NA__: '#DdDdDd', A: '#ff0000' } }),
        undefined,
        DARK,
      );
      expect(mapped.getColors(point(0))).toEqual(['#2a3547']);
    });

    it('a user-picked N/A colour is kept', () => {
      const getters = createStyleGetters(withNA('#ff00ff'), config(), undefined, DARK);
      expect(getters.getColors(point(0))).toEqual(['#ff00ff']);
    });

    it('a regular category coloured #DDDDDD keeps its colour', () => {
      const getters = createStyleGetters(withNA('#DDDDDD'), config(), undefined, DARK);
      expect(getters.getColors(point(1))).toEqual(['#DDDDDD']);
    });

    it("the style pass's colours follow the neutrals too", () => {
      const getters = createStyleGetters(
        families(),
        config({ otherAnnotationValues: ['B'] }),
        undefined,
        DARK,
      );
      const pd: PlotData = {
        length: 4,
        xs: new Float32Array(4),
        ys: new Float32Array(4),
        zs: null,
        originalIndices: null,
        proteinIds: ['p0', 'p1', 'p2', 'p3'],
      };
      const pass = getters.createStylePass();
      const scratch = createPassScratch(4);
      pass.resolve(pd, 4, scratch);
      const colorsOfSlot = (slot: number) => pass.records.colors[scratch.record[slot]];
      expect(colorsOfSlot(1)).toEqual(['#64748b']);
      expect(colorsOfSlot(0)).toEqual(['#ff0000']);
    });

    it('without a neutrals argument every existing expectation holds', () => {
      const other = createStyleGetters(families(), config({ otherAnnotationValues: ['B'] }));
      expect(other.getColors(point(1))).toEqual(['#888888']);
      const na = createStyleGetters(withNA('#DDDDDD'), config());
      expect(na.getColors(point(0))).toEqual(['#DDDDDD']);
    });
  });
```

- [ ] **Step 2: Write the failing point-style-state tests**

In `packages/core/src/components/scatter-plot/styling/point-style-state.test.ts`, replace the imports:

```ts
import { DEFAULT_CONFIG } from '../config';
import { PointStyleState } from './point-style-state';
```

with:

```ts
import { DEFAULT_CONFIG, NEUTRAL_VALUE_COLOR } from '../config';
import { LIGHT_NEUTRALS, type PlotNeutrals } from './plot-neutrals';
import { PointStyleState } from './point-style-state';

const DARK: PlotNeutrals = { other: '#64748b', na: '#2a3547' };
```

In `makeState()`, add the input after `canDrawMarks: true,` in the `inputs` object:

```ts
    neutrals: LIGHT_NEUTRALS as PlotNeutrals,
```

and the host function after `canDrawMarks: () => inputs.canDrawMarks,` in the `new PointStyleState({ … })` call:

```ts
    neutrals: () => inputs.neutrals,
```

Append at the end of the file:

```ts
describe('exportGetters()', () => {
  const p3 = { id: 'p3', x: 0, y: 0, originalIndex: 3 };

  it('is getters() while the neutrals are light', () => {
    const { state } = makeState();
    expect(state.exportGetters()).toBe(state.getters());
  });

  it('with dark neutrals, colours Other #888888 while getters() colours it with the dark grey', () => {
    const { inputs, state } = makeState();
    inputs.otherAnnotationValues = ['B'];
    inputs.neutrals = DARK;
    expect(state.getters().getColors(p3)).toEqual(['#64748b']);
    expect(state.exportGetters().getColors(p3)).toEqual([NEUTRAL_VALUE_COLOR]);
    // Built once while the live getters stand.
    expect(state.exportGetters()).toBe(state.exportGetters());
  });

  it('invalidateGetters drops the light export getters too', () => {
    const { inputs, state } = makeState();
    inputs.neutrals = DARK;
    const first = state.exportGetters();
    state.invalidateGetters();
    const second = state.exportGetters();
    expect(second).not.toBe(first);
    state.refreshGetters();
    expect(state.exportGetters()).not.toBe(second);
  });
});
```

- [ ] **Step 3: Write the failing density tests**

In `packages/core/src/components/scatter-plot/webgl/renderer/density-pass.test.ts`, add `neutralKeyOf,` to the `from './density-pass'` import list (after `densityFieldsKey,`) and a new import below that block:

```ts
import { NEUTRAL_VALUE_COLOR } from '../../config';
```

Below the `redBytes` helper (`const redBytes = (p: SlotPalette) => …`), add:

```ts
/** `n` staged points of one colour, given as 0–255 channels. */
const stagedRgb = (r: number, g: number, b: number, n: number): number[] =>
  Array.from({ length: n }, () => [r / 255, g / 255, b / 255, 1]).flat();

const slotRgb = (p: SlotPalette, s: number) =>
  [0, 1, 2].map((c) => Math.round(p.keys[s * 3 + c] * 255));

/** Sixteen reds, red k with 17 - k points, then 50 points of the dark Other grey #64748b. */
const redsAndDarkGrey = () =>
  new Float32Array([
    ...stagedReds(Array.from({ length: 16 }, (_, i) => [i + 1, 16 - i] as [number, number])),
    ...stagedRgb(0x64, 0x74, 0x8b, 50),
  ]);

describe('neutralKeyOf', () => {
  it("neutralKeyOf('#888888') equals the default key", () => {
    expect(neutralKeyOf(NEUTRAL_VALUE_COLOR)).toBe(0x888888);
    expect(neutralKeyOf('#64748B')).toBe(0x64748b);
    expect(neutralKeyOf(' #2a3547 ')).toBe(0x2a3547);
  });
});
```

Inside `describe('buildSlotPalette', …)`, after the last case (`'keys N/A grey exactly as staged and linearises its ring colour'`), add:

```ts
  it('a passed neutral key takes the tail slot over the cap', () => {
    const staged = redsAndDarkGrey();
    const p = buildSlotPalette(staged, staged.length / 4, 2.2, null, neutralKeyOf('#64748b'));
    expect(p.count).toBe(16);
    expect(p.tailSlot).toBe(0);
    expect(slotRgb(p, 0)).toEqual([0x64, 0x74, 0x8b]);
    // The fifteen most populous reds keep their own slots; the dark grey has none of its own.
    expect(redBytes(p).slice(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("the default key keeps today's palettes", () => {
    const staged = redsAndDarkGrey();
    const count = staged.length / 4;
    const p = buildSlotPalette(staged, count, 2.2);
    expect(p.tailSlot).toBe(0);
    expect(slotRgb(p, 0)).toEqual([0x88, 0x88, 0x88]);
    // Without its key the dark grey is just another colour: the most populous, so its own slot.
    expect(redBytes(p)).toEqual([136, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0x64]);
    expect(buildSlotPalette(staged, count, 2.2, null, neutralKeyOf(NEUTRAL_VALUE_COLOR))).toEqual(p);
  });
```

(Populations: red k has `16 - (k - 1)` points, so red 15 has 2 and red 16 has 1; with the dark grey's key passed, the 15 own slots go to reds 1–15; without it, to the dark grey (50) and reds 1–14, ordered by first appearance, so the grey is last.)

In `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.density.test.ts`, add two imports below `import type { MockGLOptions } from './test-support/mock-webgl2';`:

```ts
import { createMockCanvas } from './test-support/mock-webgl2';
import { WebGLRenderer } from './webgl-renderer';
```

Inside `describe('density layer, contour', () => { const contour: Config = …; … })`, after the case `'composites between the runs off the atlas unit, then re-binds the atlas'`, add:

```ts
  it("the contour palette uses getNeutralColor's key", () => {
    // Sixteen reds and the dark Other grey over 50 points: past the 16-slot cap, so the palette
    // pools the least populous colours into the neutral grey's tail slot.
    const reds = Array.from(
      { length: 16 },
      (_, i) => `#${(i + 1).toString(16).padStart(2, '0')}0000`,
    );
    const { pd, style } = categories([...reds, '#64748b']);
    const paletteWith = (getNeutralColor?: () => string) => {
      const { canvas } = createMockCanvas();
      const renderer = new WebGLRenderer(canvas, {
        getScales: () => ({
          x: d3.scaleLinear().domain([0, 1]).range([0, 800]),
          y: d3.scaleLinear().domain([0, 1]).range([0, 600]),
        }),
        getTransform: () => d3.zoomIdentity,
        getConfig: () => contour as never,
        style,
        getNeutralColor,
      });
      renderer.render(pd);
      const palette = internalsOf(renderer).contourPalette!;
      renderer.destroy();
      return palette;
    };
    const slotRgb = (p: { keys: Float32Array }, s: number) =>
      [0, 1, 2].map((c) => Math.round(p.keys[s * 3 + c] * 255));

    const themed = paletteWith(() => '#64748b');
    expect(themed.tailSlot).toBe(0);
    expect(slotRgb(themed, 0)).toEqual([0x64, 0x74, 0x8b]);
    // Without the option the light grey keys the tail slot, as before.
    const light = paletteWith();
    expect(light.tailSlot).toBe(0);
    expect(slotRgb(light, 0)).toEqual([0x88, 0x88, 0x88]);
  });
```

- [ ] **Step 4: Write the failing export-style test**

Create `packages/core/src/components/scatter-plot/scatter-plot.export-style.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 *
 * Exports stay light: whatever neutral greys the live view draws Other and N/A with, an export
 * stages through light getters and knocks out against white.
 *
 * The element is never appended (no Lit lifecycle, no WebGL): the renderer is a stub that keeps
 * the options the plot built it with.
 */
import { vi, describe, it, expect } from 'vitest';
import type { PlotDataPoint, VisualizationData } from '@protspace/utils';
import type { WebGLStyleGetters } from './webgl/types';
import type { PlotNeutrals } from './styling/plot-neutrals';

/** The options of each renderer the plot built. */
const constructed = vi.hoisted(
  () => [] as { style: WebGLStyleGetters; exportStyle: WebGLStyleGetters }[],
);

// Every colour resolves to black, so a knockout taken from any colour the export is given
// reads [0, 0, 0]; only a fixed white knockout reads [1, 1, 1].
vi.mock('./webgl/color-utils', () => ({
  resolveColor: (): [number, number, number] => [0, 0, 0],
}));

vi.mock('./webgl', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  WebGLRenderer: class {
    constructor(_canvas: unknown, options: (typeof constructed)[number]) {
      constructed.push(options);
    }
    setSelectionActive() {}
    prewarm() {}
  },
}));

import { createPlot, type PlotInternals } from './test-support/plot-fixture';

const DARK: PlotNeutrals = { other: '#64748b', na: '#2a3547' };
const IDS = ['p0', 'p1', 'p2', 'p3', 'p4'];

function makeData(): VisualizationData {
  const fams = ['A', 'B', 'A', 'B', 'A'];
  return {
    protein_ids: IDS,
    projections: [
      { name: 'umap', data: Float32Array.from(IDS.flatMap((_, i) => [i, i])), dimension: 2 },
    ],
    annotations: {
      fam: { values: ['A', 'B'], colors: ['#ff0000', '#00ff00'], shapes: ['circle', 'circle'] },
    },
    annotation_data: { fam: Int32Array.from(fams, (f) => (f === 'A' ? 0 : 1)) },
  } as unknown as VisualizationData;
}

const point = (i: number): PlotDataPoint => ({ id: IDS[i], x: i, y: i, originalIndex: i });

/** A plot with B in Other, drawing its neutral greys dark, as Task 6.4's theme will. */
function makeDarkPlot(): PlotInternals {
  const el = createPlot({
    data: makeData(),
    selectedAnnotation: 'fam',
    otherAnnotationValues: ['B'],
  });
  el._processData();
  (el as unknown as { _neutrals: () => PlotNeutrals })._neutrals = () => DARK;
  return el;
}

/** The live and export style getters `el` hands a renderer it builds now. */
function rendererStyles(el: PlotInternals) {
  Object.defineProperty(el, '_canvas', { value: document.createElement('canvas') });
  el._createWebglRenderer();
  const { style, exportStyle } = constructed.at(-1)!;
  return { live: style, exported: exportStyle };
}

describe('exports stage light', () => {
  it('exportStyle.getColors gives #888888 for Other while style.getColors gives the dark grey', () => {
    const { live, exported } = rendererStyles(makeDarkPlot());
    expect(live.getColors(point(1))).toEqual(['#64748b']);
    expect(exported.getColors(point(1))).toEqual(['#888888']);
    // A category of its own keeps its colour in both.
    expect(exported.getColors(point(0))).toEqual(['#ff0000']);
  });

  it.each([undefined, '#ffffff', 'white', 'transparent', 'rgba(0,0,0,0)', '#0b1120'])(
    'captureAtResolution passes the knockout [1, 1, 1] whatever the background option (%s)',
    (backgroundColor) => {
      const el = createPlot();
      const renderToCanvas = vi.fn((..._args: unknown[]) => document.createElement('canvas'));
      el._webglRenderer = { renderToCanvas } as never;
      el.captureAtResolution(100, 80, backgroundColor === undefined ? {} : { backgroundColor });
      expect(renderToCanvas).toHaveBeenCalledTimes(1);
      expect(renderToCanvas.mock.calls[0][6]).toEqual([1, 1, 1]);
    },
  );
});
```

- [ ] **Step 5: Run the new tests and watch them fail**

Run:

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/components/scatter-plot/styling/style-getters.test.ts \
  src/components/scatter-plot/styling/point-style-state.test.ts \
  src/components/scatter-plot/webgl/renderer/density-pass.test.ts \
  src/components/scatter-plot/webgl/renderer/webgl-renderer.density.test.ts \
  src/components/scatter-plot/scatter-plot.export-style.test.ts
```

Expected: FAIL. `style-getters.test.ts`: the file loads (its `./plot-neutrals` import is type-only and erased) and the neutral cases get `#888888`/`#DDDDDD`, since the fourth argument is ignored. `point-style-state.test.ts`: the whole file fails to load, `Failed to resolve import "./plot-neutrals"` (it imports `LIGHT_NEUTRALS` as a value). `density-pass.test.ts`: `neutralKeyOf is not a function`. `webgl-renderer.density.test.ts`: the themed palette's slot 0 is `[136, 136, 136]` (the option is ignored). `scatter-plot.export-style.test.ts`: the live Other is `#888888` too (nothing reads `_neutrals` yet), and every knockout case reads `[0, 0, 0]` (the mocked `resolveColor` of the given colour, or of `getComputedStyle(this).backgroundColor` for `'transparent'`). Every pre-existing case in the other files passes.

- [ ] **Step 6: Create `plot-neutrals.ts`**

Create `packages/core/src/components/scatter-plot/styling/plot-neutrals.ts`:

```ts
import { NA_DEFAULT_COLOR } from '@protspace/utils';
import { NEUTRAL_VALUE_COLOR } from '../config';

/**
 * The greys the plot draws neutral points with: Other values, and N/A values whose colour is the
 * default `NA_DEFAULT_COLOR`. The live view takes them from the theme; an export always uses
 * the light ones, so a figure is the same in both themes.
 */
export interface PlotNeutrals {
  readonly other: string;
  readonly na: string;
}

/** The light greys, which are also the data's own colours for Other and N/A. */
export const LIGHT_NEUTRALS: PlotNeutrals = Object.freeze({
  other: NEUTRAL_VALUE_COLOR,
  na: NA_DEFAULT_COLOR,
});

const sameColor = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether two sets of greys draw the same colours (compared trimmed, ignoring letter case). */
export function sameNeutrals(a: PlotNeutrals, b: PlotNeutrals): boolean {
  return a === b || (sameColor(a.other, b.other) && sameColor(a.na, b.na));
}
```

- [ ] **Step 7: Make the style getters take the neutrals**

In `packages/core/src/components/scatter-plot/styling/style-getters.ts`:

1. Delete the first line, `import { NEUTRAL_VALUE_COLOR } from '../config';` (nothing else in the file reads it once step 3 below lands).
2. In the value import from `'@protspace/utils'` (the block that starts `getProteinAnnotationCount,`), add `isNAValue,` and `NA_DEFAULT_COLOR,` so it reads:

```ts
import {
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  getProteinAnnotationValues,
  isMultilabelAnnotationDataCached,
  isNAValue,
  isNumericAnnotation,
  NA_DEFAULT_COLOR,
  normalizeShapeName,
  toInternalValue,
} from '@protspace/utils';
```

   and below `import { CategoryStyles, createCategoryStylePass } from './style-pass';` add:

```ts
import { LIGHT_NEUTRALS, type PlotNeutrals } from './plot-neutrals';
```

3. Replace the signature of `createStyleGetters`:

```ts
export function createStyleGetters(
  data: VisualizationData | null,
  styleConfig: StyleConfig,
  model?: VisibilityModel,
) {
```

with:

```ts
export function createStyleGetters(
  data: VisualizationData | null,
  styleConfig: StyleConfig,
  model?: VisibilityModel,
  // The greys of Other and default-coloured N/A points: the theme's on screen, light in exports.
  neutrals: PlotNeutrals = LIGHT_NEUTRALS,
) {
```

4. Replace the whole `colorsOfValues` const (from `const colorsOfValues = (annotationValueArray: readonly string[]): string[] => {` to its closing `};`) with:

```ts
  // An N/A value drawn in the default N/A grey takes the theme's grey; a user-picked or
  // bundle-stored N/A colour is the data's and stays. Light needs no substitution, so a light
  // view keeps the data's own colour strings.
  const naDefault = NA_DEFAULT_COLOR.toLowerCase();
  const naSubstitute = neutrals.na.trim().toLowerCase() === naDefault ? null : neutrals.na;
  const colorOfKey = (key: string): string => {
    const color = valueToColor.get(key);
    if (color === undefined) return neutrals.other;
    if (naSubstitute !== null && isNAValue(key) && color.toLowerCase() === naDefault) {
      return naSubstitute;
    }
    return color;
  };

  const colorsOfValues = (annotationValueArray: readonly string[]): string[] => {
    // Defensive guard
    if (annotationValueArray.length === 0) return [neutrals.other];

    if (annotationValueArray.every((v) => otherValuesSet.has(v))) {
      return [neutrals.other];
    }

    const colors = annotationValueArray
      .map((v) => {
        const key = toInternalValue(v);
        if (hiddenKeysSet.has(key)) return undefined;
        if (otherValuesSet.has(v)) return neutrals.other;
        return colorOfKey(key);
      })
      .filter((v) => v !== undefined);

    // Remove multiple neutral colors from multiple other annotations
    return [...new Set(colors)];
  };
```

5. In `getColors`, replace `if (!data || !styleConfig.selectedAnnotation) return [NEUTRAL_VALUE_COLOR];` with:

```ts
    if (!data || !styleConfig.selectedAnnotation) return [neutrals.other];
```

After this, `grep -n NEUTRAL_VALUE_COLOR packages/core/src/components/scatter-plot/styling/style-getters.ts` prints nothing.

- [ ] **Step 8: Give the style state a neutrals input and light export getters**

In `packages/core/src/components/scatter-plot/styling/point-style-state.ts`:

1. Below `import { createStyleGetters } from './style-getters';` add:

```ts
import { LIGHT_NEUTRALS, sameNeutrals, type PlotNeutrals } from './plot-neutrals';
```

2. In `interface PointStyleHost`, after `shapeMapping(): Record<string, string> | null;` add:

```ts
  /** The greys the live view draws Other and default-coloured N/A points with: the theme's. */
  neutrals(): PlotNeutrals;
```

3. In `class PointStyleState`, after the `_unmarkedGetters` field (the block ending `} | null = null;` under the comment `// The getters over the model with nothing marked (`stageGetters`), …`), add:

```ts
  // The light getters an export stages while the live view's greys are not light, with the
  // getters they were built beside (`exportGetters`).
  private _exportGetters: { from: StyleGetters; getters: StyleGetters } | null = null;
```

4. In `releaseDataset()`, replace `this._styleGetters = null;` with:

```ts
    this._styleGetters = null;
    this._exportGetters = null;
```

5. Replace the three methods `getters()`, `invalidateGetters()` and `refreshGetters()`:

```ts
  /** The style getters for the current data and visual state, which an export stages. */
  getters(): StyleGetters {
    if (!this._styleGetters) {
      this._styleGetters = this.build();
    }
    return this._styleGetters;
  }

  /** Build the getters again on their next use. */
  invalidateGetters() {
    this._styleGetters = null;
  }

  /** Build the getters again now. */
  refreshGetters() {
    this._styleGetters = this.build();
  }
```

with:

```ts
  /** The style getters for the current data and visual state, in the theme's neutral greys. */
  getters(): StyleGetters {
    if (!this._styleGetters) {
      this._styleGetters = this.build();
    }
    return this._styleGetters;
  }

  /**
   * The style getters an export stages: {@link getters} with the light neutral greys whatever
   * the theme, so a figure exported in dark is the one exported in light. The live getters
   * themselves while their greys are light; otherwise built once beside them.
   */
  exportGetters(): StyleGetters {
    const getters = this.getters();
    if (sameNeutrals(this.host.neutrals(), LIGHT_NEUTRALS)) return getters;
    const cached = this._exportGetters;
    if (cached?.from === getters) return cached.getters;
    this._exportGetters = { from: getters, getters: this.build(this.model(), LIGHT_NEUTRALS) };
    return this._exportGetters.getters;
  }

  /** Build the getters again on their next use. */
  invalidateGetters() {
    this._styleGetters = null;
    this._exportGetters = null;
  }

  /** Build the getters again now. */
  refreshGetters() {
    this._styleGetters = this.build();
    this._exportGetters = null;
  }
```

6. Replace the head of `build()`:

```ts
  private build(model: VisibilityModel = this.model()): StyleGetters {
```

with:

```ts
  private build(
    model: VisibilityModel = this.model(),
    neutrals: PlotNeutrals = this.host.neutrals(),
  ): StyleGetters {
```

   and its last argument `model,` (just before the closing `);` of the `createStyleGetters(` call) with:

```ts
      model,
      neutrals,
```

- [ ] **Step 9: Pass the neutral key into the density palette**

In `packages/core/src/components/scatter-plot/webgl/renderer/density-pass.ts`:

1. Below `import { IDENTITY_RESCALE } from './rescale';` add:

```ts
import { resolveColor } from '../color-utils';
```

2. Replace:

```ts
const NEUTRAL_KEY = parseInt(NEUTRAL_VALUE_COLOR.slice(1), 16);
```

with:

```ts
/**
 * The density key of `color`: its 24-bit RGB, as `colorKey` reads a staged colour. The palette
 * pools the colours past the cap into the neutral grey's slot, so this must be the key of the grey
 * the points are staged with (the theme's Other grey), or Other gets a contour of its own.
 */
export function neutralKeyOf(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) return parseInt(hex[1], 16);
  const [r, g, b] = resolveColor(color);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

const DEFAULT_NEUTRAL_KEY = neutralKeyOf(NEUTRAL_VALUE_COLOR);
```

3. Replace the doc comment and signature of `buildSlotPalette`:

```ts
/**
 * The density slots of the `count` staged points, ordered by the first point of
 * each colour to draw. With `marked` (by draw index), marked points draw after
 * every other point, as staging orders a selection.
 */
export function buildSlotPalette(
  colors: Float32Array,
  count: number,
  gamma: number,
  marked: Uint8Array | null = null,
): SlotPalette {
```

with:

```ts
/**
 * The density slots of the `count` staged points, ordered by the first point of
 * each colour to draw. With `marked` (by draw index), marked points draw after
 * every other point, as staging orders a selection. Past the cap, the colours
 * left over pool into the slot keyed `neutralKey` (see {@link neutralKeyOf}).
 */
export function buildSlotPalette(
  colors: Float32Array,
  count: number,
  gamma: number,
  marked: Uint8Array | null = null,
  neutralKey: number = DEFAULT_NEUTRAL_KEY,
): SlotPalette {
```

   and its last line `return paletteFromEntries(entries, gamma);` (the first of the two) with `return paletteFromEntries(entries, gamma, neutralKey);`.

4. Replace the signature of `buildRecordSlotPalette`:

```ts
export function buildRecordSlotPalette(
  staged: StagedRecords,
  gamma: number,
  firstDrawn: ArrayLike<number> = staged.firstDrawn,
): SlotPalette {
```

with:

```ts
export function buildRecordSlotPalette(
  staged: StagedRecords,
  gamma: number,
  firstDrawn: ArrayLike<number> = staged.firstDrawn,
  neutralKey: number = DEFAULT_NEUTRAL_KEY,
): SlotPalette {
```

   and its `return paletteFromEntries(entries, gamma);` with `return paletteFromEntries(entries, gamma, neutralKey);`.

5. In `paletteFromEntries`, replace the signature `function paletteFromEntries(entries: SlotEntries, gamma: number): SlotPalette {` with:

```ts
function paletteFromEntries(entries: SlotEntries, gamma: number, neutralKey: number): SlotPalette {
```

   and its two uses of `NEUTRAL_KEY`:

```ts
      .filter(([key]) => key !== NEUTRAL_KEY)
```
```ts
    slots = [NEUTRAL_KEY, ...own.map(([key]) => key)];
```

   with:

```ts
      .filter(([key]) => key !== neutralKey)
```
```ts
    slots = [neutralKey, ...own.map(([key]) => key)];
```

After this, `grep -n NEUTRAL_KEY packages/core/src/components/scatter-plot/webgl/renderer/density-pass.ts` prints only `DEFAULT_NEUTRAL_KEY` lines.

In `packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts`:

1. Add `neutralKeyOf,` to the `from './density-pass'` import list (after `buildRecordSlotPalette,`), and below `import { perfCounters } from '../../../../utils/perf-counters';` add:

```ts
import { NEUTRAL_VALUE_COLOR } from '../../config';
```

2. In `interface WebGLRendererOptions`, after `getKnockoutColor?: () => readonly [number, number, number];` add:

```ts
  /** The grey Other points are staged with, which keys the contours' tail slot. `NEUTRAL_VALUE_COLOR` unless given. */
  getNeutralColor?: () => string;
```

3. After the field `private readonly getKnockoutColor: () => readonly [number, number, number];` add:

```ts
  private readonly getNeutralColor: () => string;
```

   and in the constructor, after `this.getKnockoutColor = options.getKnockoutColor ?? (() => [1, 1, 1]);` add:

```ts
    this.getNeutralColor = options.getNeutralColor ?? (() => NEUTRAL_VALUE_COLOR);
```

4. In `private densityFrame(camera: CameraParams)`, replace:

```ts
    this.contourPalette ??= staged
      ? buildRecordSlotPalette(
          staged,
          this.gamma,
          marked ? markedFirstDrawn(staged, ids, colors, marked, count) : undefined,
        )
      : buildSlotPalette(colors, count, this.gamma, marked);
```

with:

```ts
    if (!this.contourPalette) {
      // Other's grey pools the colours past the cap, so it never gets a contour of its own.
      const neutralKey = neutralKeyOf(this.getNeutralColor());
      this.contourPalette = staged
        ? buildRecordSlotPalette(
            staged,
            this.gamma,
            marked ? markedFirstDrawn(staged, ids, colors, marked, count) : undefined,
            neutralKey,
          )
        : buildSlotPalette(colors, count, this.gamma, marked, neutralKey);
    }
```

(The next line, `if (this.contourPalette.count === 0) return null;`, is unchanged; TypeScript narrows `contourPalette` to non-null after the block.)

- [ ] **Step 10: Wire the plot: neutrals source, light export getters, white knockout**

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Replace the import `import { resolveColor } from './webgl/color-utils';` with:

```ts
import { LIGHT_NEUTRALS, type PlotNeutrals } from './styling/plot-neutrals';
```

2. Directly above `const HIT_RADIUS_MIN_PX = 4;` (the first constant after the imports), add:

```ts
/** An export's knockout colour: white, whatever the theme or the figure's background (exports are light). */
const EXPORT_KNOCKOUT = [1, 1, 1] as const;
```

3. In the `private readonly _style = new PointStyleState({ … })` host object, after `shapeMapping: () => this._shapeMapping,` add:

```ts
    neutrals: () => this._neutrals(),
```

4. Directly after the field `private _background = new BackgroundColorCache(this);` (with its comment `/** Resolved plot background; see the class for what invalidates it. */`) add:

```ts
  /** The greys the live view draws Other and default-coloured N/A points with. */
  private readonly _neutrals = (): PlotNeutrals => LIGHT_NEUTRALS;
```

5. In `private _createWebglRenderer()`, replace everything from `const style = this._style;` down to and including the `exportStyle: { … },` entry:

```ts
    const style = this._style;
    const styles = {
      getColors: (p: PlotDataPoint) => style.getters().getColors(p),
      getPointSize: (p: PlotDataPoint) => style.getters().getPointSize(p),
      getShape: (p: PlotDataPoint) => style.getters().getPointShape(p),
      isPredicted: (p: PlotDataPoint) => style.getters().isPredicted(p),
      isMultilabel: () => style.getters().isMultilabel(),
    };
    this._webglRenderer = new WebGLRenderer(this._canvas, {
      getScales: () => this._scales,
      getTransform: () => this._transform,
      getConfig: () => this._mergedConfig,
      // The live view stages nothing marked while it draws the marks on the GPU.
      style: {
        ...styles,
        getOpacity: (p: PlotDataPoint) => style.stageModel().opacityOf(p),
        getDepth: (p: PlotDataPoint) => style.stageGetters().getDepth(p),
        createStylePass: () => style.stageGetters().createStylePass(style.stageModel()),
        getPointMarks: (pd: PlotData) => style.pointMarks(pd),
      },
      // An export stages the selection with every other style.
      exportStyle: {
        ...styles,
        getOpacity: (p: PlotDataPoint) => this._getOpacity(p),
        getDepth: (p: PlotDataPoint) => style.getters().getDepth(p),
        // The getters above resolve the visibility model per point; a pass
        // resolves it once, for every point it stages.
        createStylePass: () => style.getters().createStylePass(style.model()),
      },
```

with:

```ts
    const style = this._style;
    type Getters = ReturnType<PointStyleState['getters']>;
    // The per-point getters over the live getters (the theme's greys) or the export's light ones.
    const pointStyles = (getters: () => Getters) => ({
      getColors: (p: PlotDataPoint) => getters().getColors(p),
      getPointSize: (p: PlotDataPoint) => getters().getPointSize(p),
      getShape: (p: PlotDataPoint) => getters().getPointShape(p),
      isPredicted: (p: PlotDataPoint) => getters().isPredicted(p),
      isMultilabel: () => getters().isMultilabel(),
    });
    const exported = () => style.exportGetters();
    this._webglRenderer = new WebGLRenderer(this._canvas, {
      getScales: () => this._scales,
      getTransform: () => this._transform,
      getConfig: () => this._mergedConfig,
      // The live view stages nothing marked while it draws the marks on the GPU.
      style: {
        ...pointStyles(() => style.getters()),
        getOpacity: (p: PlotDataPoint) => style.stageModel().opacityOf(p),
        getDepth: (p: PlotDataPoint) => style.stageGetters().getDepth(p),
        createStylePass: () => style.stageGetters().createStylePass(style.stageModel()),
        getPointMarks: (pd: PlotData) => style.pointMarks(pd),
      },
      // An export stages the selection with every other style, in the light greys.
      exportStyle: {
        ...pointStyles(exported),
        getOpacity: (p: PlotDataPoint) => this._getOpacity(p),
        getDepth: (p: PlotDataPoint) => exported().getDepth(p),
        // The getters above resolve the visibility model per point; a pass
        // resolves it once, for every point it stages.
        createStylePass: () => exported().createStylePass(style.model()),
      },
```

   and after the next entry, `getKnockoutColor: () => this._background.get(),`, add:

```ts
      getNeutralColor: () => this._neutrals().other,
```

6. In `public captureAtResolution(…)`, replace the last argument of `this._webglRenderer.renderToCanvas(…)`:

```ts
      resolveColor(
        backgroundColor === 'transparent'
          ? getComputedStyle(this).backgroundColor
          : backgroundColor,
      ),
    );
```

with:

```ts
      EXPORT_KNOCKOUT,
    );
```

   (`backgroundColor` stays in the destructuring: the fill at the end of the method still reads it.) After this, `grep -n "resolveColor\|getComputedStyle(this)" packages/core/src/components/scatter-plot/scatter-plot.ts` prints nothing.

- [ ] **Step 11: Run the tests and watch them pass**

Run the command of Step 5 again.

Expected: PASS, every case in the five files (the new ones: 7 in `style-getters.test.ts`, 3 in `point-style-state.test.ts`, 3 in `density-pass.test.ts`, 1 in `webgl-renderer.density.test.ts`, 7 in `scatter-plot.export-style.test.ts`).

- [ ] **Step 12: Run the scatter plot's unit tests, type-check and lint**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit src/components/scatter-plot
pnpm --filter @protspace/core type-check
pnpm --filter @protspace/core exec eslint \
  src/components/scatter-plot/styling/plot-neutrals.ts \
  src/components/scatter-plot/styling/style-getters.ts \
  src/components/scatter-plot/styling/point-style-state.ts \
  src/components/scatter-plot/webgl/renderer/density-pass.ts \
  src/components/scatter-plot/webgl/renderer/webgl-renderer.ts \
  src/components/scatter-plot/scatter-plot.ts \
  src/components/scatter-plot/scatter-plot.export-style.test.ts
pnpm exec prettier --check packages/core/src/components/scatter-plot
wc -l packages/core/src/components/scatter-plot/scatter-plot.ts
```

Expected: all pass; the folder's count is the baseline's plus 21. `scatter-plot.ts` is about 2,630 lines (record it). In particular `scatter-plot.gpu-marks.test.ts` ("an export still stages the selection") and `scatter-plot.capture-badges*.test.ts` stay green: the export getters are the live ones while the neutrals are light, and the knockout is no longer read from the element. If Prettier reports a file, run `pnpm exec prettier --write <file>` and re-check.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/components/scatter-plot/styling/plot-neutrals.ts \
  packages/core/src/components/scatter-plot/styling/style-getters.ts \
  packages/core/src/components/scatter-plot/styling/style-getters.test.ts \
  packages/core/src/components/scatter-plot/styling/point-style-state.ts \
  packages/core/src/components/scatter-plot/styling/point-style-state.test.ts \
  packages/core/src/components/scatter-plot/webgl/renderer/density-pass.ts \
  packages/core/src/components/scatter-plot/webgl/renderer/density-pass.test.ts \
  packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.ts \
  packages/core/src/components/scatter-plot/webgl/renderer/webgl-renderer.density.test.ts \
  packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/scatter-plot.export-style.test.ts
git commit -m "refactor(core): plot neutrals as an input, exports always light"
```

(Sandbox disabled: the hook runs `pnpm precommit`. Knip: `PlotNeutrals`, `LIGHT_NEUTRALS` and `sameNeutrals` are imported by `point-style-state.ts`, `style-getters.ts` and `scatter-plot.ts`; `neutralKeyOf` by `webgl-renderer.ts`.)

Report: the counts of the five files before and after, the scatter-plot folder count, LEGACY 7, `wc -l scatter-plot.ts`.

### Task 6.4: The plot's background and neutral greys follow the theme

The plot reads its background and its Other and N/A greys from new tokens, and re-renders through the colour-only path when, and only when, a theme change gives them a different value. A core watcher, `observeTheme`, reports theme changes; `PlotTheme` replaces `BackgroundColorCache`. The perf suite gets a `theme-switch` segment and pins the light theme.

**Files:**

- Modify: `packages/core/src/styles/theme.ts` (`--ps-plot-bg`, `--ps-plot-other`, `--ps-plot-na` in both role blocks), `packages/core/src/styles/theme.test.ts`
- Create: `packages/core/src/utils/theme-observer.ts`, `packages/core/src/utils/theme-observer.test.ts`
- Create: `packages/core/src/components/scatter-plot/styling/plot-theme.ts`, `plot-theme.test.ts`
- Delete: `packages/core/src/components/scatter-plot/styling/background-color-cache.ts`, `background-color-cache.test.ts` (their cases move into `plot-theme.test.ts`)
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.ts`, `scatter-plot.styles.ts` (host `background: var(--ps-plot-bg)`; `--protspace-bg-color` goes)
- Create: `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts`
- Modify: `apps/web/tests/helpers/tour-storage-state.ts` (`theme` option), `apps/web/tests/helpers/perf/scenarios.ts` (`theme-switch` segment; context pins `theme: 'light'`), `apps/web/tests/perf-scale.spec.ts`, `perf/playwright.config.ts` (pin `theme: 'light'`), `apps/web/tests/perf/budgets.json` (`theme-switch` recorded)
- Modify: `docs/developers/style-architecture.md` (design tokens: `system` follows the OS; the plot tokens; the example `--protspace-bg-color` goes)

**Interfaces:**

- Consumes: `PlotNeutrals`, `LIGHT_NEUTRALS`, `sameNeutrals` (`styling/plot-neutrals.ts`), `_neutrals` (the instance arrow field `private readonly _neutrals = (): PlotNeutrals => LIGHT_NEUTRALS` beside `_background` in `scatter-plot.ts`), `getNeutralColor`, `exportGetters` (6.3); `resolveColor` (`webgl/color-utils.ts`); `_handleColorMappingChange`'s colour-only branch (`scatter-plot.ts`: `_style.invalidateGetters()`, `_webglRenderer?.invalidateCategoryStyles()`, `_renderLoop.request()`); `BackgroundColorCache` (`styling/background-color-cache.ts`, whose behaviour and test cases move); `adoptTheme()` (`components/kit/adopt-theme.ts`) and the mounting pattern of `scatter-plot.touch.browser.test.ts` (`protspace-scatterplot` appended with an explicit size, `getProteinClientPosition(id)`); `THEME_STORAGE_KEY`, `ThemeChoice` (`apps/web/src/explore/theme-defaults.ts`, 6.1); `exploreStorageState(baseUrl, { layout })` (`tests/helpers/tour-storage-state.ts`), `SEGMENTS` and `buildSegments` in `tests/helpers/perf/scenarios.ts`, `newPerfContext`; the segment runner `segment()` in `tests/helpers/perf/probes.ts` (it settles after `act` and after `reset`, and compares plot pixels across the round trip when `pixels: true`); `writeBudgets` behaviour of `PERF_UPDATE_BUDGETS=1` (`tests/helpers/perf/report.ts`: three runs, the max per count, `recordedAt` = HEAD).
- Produces:
  - Tokens (light / dark): `--ps-plot-bg` `#ffffff` / `#0b1120`, `--ps-plot-other` `#888888` / `#64748b`, `--ps-plot-na` `#dddddd` / `#2a3547`, in `lightRoles` and `darkRoles` (light values equal the constants, pinned by `theme.test.ts`).
  - `theme-observer.ts`: `export function observeTheme(onChange: () => void, doc: Document = document): () => void` — a `MutationObserver` on `doc.documentElement` with `attributeFilter: ['data-theme', 'class', 'style']` plus the `change` event of `matchMedia('(prefers-color-scheme: dark)')`; calls `onChange()` once per batch of records and once per media change; guarded where `MutationObserver` or `matchMedia` is missing; the returned function disconnects both. Raw notifications: consumers compare values. (Task 6.8 consumes it for Mol*.)
  - `plot-theme.ts`: `export class PlotTheme { constructor(host: HTMLElement, onChange: () => void); neutrals(): PlotNeutrals; background(): readonly [number, number, number]; connect(): void; disconnect(): void }`. `neutrals()` reads `--ps-plot-other` and `--ps-plot-na` with one `getComputedStyle(host)`, trimmed, each falling back to its `LIGHT_NEUTRALS` value when empty (jsdom, a page without the sheet), cached (also when read detached); `background()` behaves as `BackgroundColorCache.get()` did (same lazy invalidation: attribute mutations on the host and its ancestors across shadow roots, `<head>` child changes, a scheme flip, reconnect). `connect()` (idempotent) also subscribes `observeTheme`; on a notification it re-reads the neutrals only if they were read before, and calls `onChange` once when `!sameNeutrals(old, new)`; the background is just invalidated. `connect()` runs that same check once, so a theme change while detached is noticed on reconnect (a first connect has read nothing and does nothing). `disconnect()` stops both and keeps the cached greys for that check.
  - `scatter-plot.ts`: `private readonly _theme = new PlotTheme(this, () => this._handleThemeChange())` replacing `_background`; `_neutrals` returns `this._theme.neutrals()`; `getKnockoutColor: () => this._theme.background()`; `connect`/`disconnect` where `_background`'s were; `private _handleThemeChange()` does the colour-only restyle (`_style.invalidateGetters()`, and with points `_webglRenderer?.invalidateCategoryStyles()` and `_renderLoop.request()`).
  - `scatter-plot.styles.ts`: the host's `background: var(--ps-plot-bg)`; the `--protspace-bg-color` declaration goes. Other colour properties stay until Task 6.6.
  - `exploreStorageState(baseUrl, options: { layout?: LayoutState; theme?: ThemeChoice } = {})` writes `JSON.stringify(theme)` under `THEME_STORAGE_KEY` when given; `newPerfContext`, `perf-scale.spec.ts` and `perf/playwright.config.ts` pass `theme: 'light'`.
  - `scenarios.ts`: `SEGMENTS['theme-switch'] = { repeatable: true }` and a segment `{ name: 'theme-switch', act: set document.documentElement.dataset.theme = 'dark' (the runner settles), reset: set it to 'light', pixels: true }`, placed after `panel-expand`.
  - `budgets.json`: `theme-switch` recorded with `PERF_UPDATE_BUDGETS=1` and checked against the Phase 6 budget (render 1, restagePos/processData/gridRebuild/legendUpdate/legendRebuild 0, restage and restageStyle ≤ 1); `load` and `idle` unchanged; `recordedAt` updated.

**Tests:**

- `theme.test.ts`: "light --ps-plot-other equals NEUTRAL_VALUE_COLOR and light --ps-plot-na equals NA_DEFAULT_COLOR (case-insensitive)"; "both role blocks define --ps-plot-bg, --ps-plot-other and --ps-plot-na".
- `theme-observer.test.ts` (jsdom): "a data-theme change notifies once"; "class and style changes on <html> notify"; "a prefers-color-scheme change notifies" (stubbed `matchMedia` with a controllable `change`); "attribute changes on <body> or deeper do not notify"; "the returned function stops both"; "no MutationObserver or matchMedia: nothing throws".
- `plot-theme.test.ts` (jsdom, `getComputedStyle` stubbed to return chosen token values): the moved `BackgroundColorCache` cases; "neutrals fall back to the light values when the tokens are empty"; "a data-theme flip that changes the greys calls onChange once"; "re-setting data-theme to its value does not call onChange"; "an OS flip with no change in the greys does not call onChange"; "a class change on an ancestor below <html> does not call onChange"; "nothing read yet: a flip does not call onChange"; "disconnect stops notifications".
- `scatter-plot.theme.browser.test.ts` (Chromium, real WebGL; `adoptTheme()`; `afterEach` deletes `data-theme`): "in dark the host background is #0b1120"; "in dark an Other point's pixel is the dark grey (±3 per channel after blending)"; "switching dark → light requests one render and restyles colour only" (spies on `invalidateCategoryStyles` and the render loop); "re-setting data-theme='dark' renders nothing"; "captureAtResolution in dark gives #888888 Other points on #ffffff"; "a plot mounted in dark draws in the dark greys from the start, with no theme restyle" (a dark load adds no render).
- `perf-counts` project (this task's one e2e run): `theme-switch` within budget; `load` and `idle` unchanged from the baseline.
- Unrun at task time (exit): `density-layer.spec.ts` (plot background pixel samples), `brush-selection.spec.ts`, `figure-editor.spec.ts`, `zoom-indicator.spec.ts`, `perf-timing.spec.ts`/`pnpm perf` (pinned context; it consumes `buildSegments`, so it now runs a `theme-switch` segment), `perf-scale.spec.ts` (pinned context, also consumes `buildSegments`; `pnpm perf:scale` is opt-in and not run at the exit, but the spec must type-check under `pnpm quality`).

LEGACY count: 7. Report `wc -l scatter-plot.ts`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `--project unit` runs inside the sandbox; `--project browser`, the app build and `pnpm perf:counts` need it disabled.

- [ ] **Step 1: Write the failing token tests**

In `packages/core/src/styles/theme.test.ts`, replace the imports:

```ts
import { expect, it } from 'vitest';
import { theme } from './theme';
```

with:

```ts
import { expect, it } from 'vitest';
import { NA_DEFAULT_COLOR } from '@protspace/utils';
import { NEUTRAL_VALUE_COLOR } from '../components/scatter-plot/config';
import { theme } from './theme';
```

Append at the end of the file:

```ts
// The light plot greys are the data's own colours, which exports always draw with: a light
// theme must draw exactly what an export does.
it('light --ps-plot-other equals NEUTRAL_VALUE_COLOR and light --ps-plot-na equals NA_DEFAULT_COLOR (case-insensitive)', () => {
  const light = hexes(':root');
  expect(light.get('--ps-plot-other')?.toLowerCase()).toBe(NEUTRAL_VALUE_COLOR.toLowerCase());
  expect(light.get('--ps-plot-na')?.toLowerCase()).toBe(NA_DEFAULT_COLOR.toLowerCase());
});

it('both role blocks define --ps-plot-bg, --ps-plot-other and --ps-plot-na', () => {
  for (const sel of [':root', ":root[data-theme='dark']", ":root[data-theme='system']"]) {
    const t = hexes(sel);
    for (const name of ['--ps-plot-bg', '--ps-plot-other', '--ps-plot-na']) {
      expect(t.get(name), `${name} in ${sel}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
  expect(hexes(":root[data-theme='dark']").get('--ps-plot-bg')).toBe('#0b1120');
});
```

- [ ] **Step 2: Write the failing observer test**

Create `packages/core/src/utils/theme-observer.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 *
 * The one place core hears that the page's theme may have changed. Its calls are raw: the
 * consumers compare token values before they redraw anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeTheme } from './theme-observer';

const root = document.documentElement;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A `prefers-color-scheme` query whose change event the test fires. */
function stubScheme() {
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal('matchMedia', () => media);
  return { media, fire: () => listeners.forEach((fn) => fn()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ['data-theme', 'class', 'style', 'lang']) root.removeAttribute(name);
  document.body.removeAttribute('data-theme');
  document.body.removeAttribute('class');
});

describe('observeTheme', () => {
  it('a data-theme change notifies once', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    root.dataset.theme = 'dark';
    root.dataset.theme = 'light';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('class and style changes on <html> notify', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    root.className = 'dark';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    root.style.setProperty('--ps-plot-other', '#123456');
    await tick();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a prefers-color-scheme change notifies', () => {
    const scheme = stubScheme();
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    scheme.media.matches = true;
    scheme.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('attribute changes on <body> or deeper do not notify', async () => {
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    const panel = document.body.appendChild(document.createElement('div'));
    document.body.dataset.theme = 'dark';
    document.body.className = 'sliding';
    panel.style.width = '10px';
    // Nor an attribute of <html> that does not theme it.
    root.setAttribute('lang', 'en');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    panel.remove();
    stop();
  });

  it('the returned function stops both', async () => {
    const scheme = stubScheme();
    const onChange = vi.fn();
    const stop = observeTheme(onChange);
    stop();
    root.dataset.theme = 'dark';
    scheme.fire();
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(scheme.media.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('no MutationObserver or matchMedia: nothing throws', () => {
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(() => observeTheme(vi.fn())()).not.toThrow();
  });
});
```

- [ ] **Step 3: Write the failing PlotTheme test (with the moved background cases)**

Create `packages/core/src/components/scatter-plot/styling/plot-theme.test.ts`. The first `describe` is `background-color-cache.test.ts` moved over: the cases are the same, `cache.get()` is `theme.background()`, the class takes an `onChange`, and the old "re-reads after invalidate()" case becomes "re-reads after a reconnect" (`PlotTheme` has no public `invalidate`).

```ts
/**
 * @vitest-environment jsdom
 *
 * The renderer reads the plot background on every draw, and the style getters read the neutral
 * greys whenever they are built: both stay off the forced-style-recalculation path, and both
 * follow anything that can restyle them. A theme change that gives the greys new values asks for
 * one restyle; anything else asks for none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../webgl/color-utils', () => ({
  // Distinct, checkable output per input colour (jsdom has no canvas to parse with).
  resolveColor: vi.fn((css: string) => [css.length, 0, 0] as [number, number, number]),
}));

import { PlotTheme } from './plot-theme';
import { LIGHT_NEUTRALS } from './plot-neutrals';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const root = document.documentElement;

describe('PlotTheme background', () => {
  let host: HTMLElement;
  let reads: ReturnType<typeof vi.spyOn>;
  let theme: PlotTheme;

  beforeEach(() => {
    host = document.createElement('div');
    host.style.backgroundColor = 'rgb(1, 2, 3)'; // 12 chars
    document.body.appendChild(host);
    reads = vi.spyOn(window, 'getComputedStyle');
    theme = new PlotTheme(host, vi.fn());
    theme.connect();
  });

  afterEach(() => {
    theme.disconnect();
    reads.mockRestore();
    document.body.replaceChildren();
    document.head.replaceChildren();
  });

  it('reads computed style once however many times it is asked', () => {
    expect(theme.background()).toEqual([12, 0, 0]);
    theme.background();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('re-reads after a reconnect', () => {
    theme.background();
    host.style.backgroundColor = 'rgb(10, 20, 30)'; // 15 chars
    theme.connect();
    expect(theme.background()).toEqual([15, 0, 0]);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('sees an attribute change on the host in the same task, before observers are delivered', () => {
    theme.background();
    host.style.backgroundColor = 'rgb(10, 20, 30)';
    expect(theme.background()).toEqual([15, 0, 0]);
  });

  it('drops the value when an ancestor is restyled', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    wrapper.appendChild(host);
    theme.connect();
    theme.background();

    wrapper.className = 'dark';
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('follows the host through a shadow root to the element that contains it', async () => {
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const shadow = outer.attachShadow({ mode: 'open' });
    shadow.appendChild(host);
    theme.connect();
    theme.background();

    outer.setAttribute('data-theme', 'dark');
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('drops the value when a stylesheet is added to <head>', async () => {
    theme.background();
    document.head.appendChild(document.createElement('style'));
    await tick();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  describe('prefers-color-scheme', () => {
    let media: { matches: boolean; addEventListener: unknown; removeEventListener: unknown };
    let fire: () => void;

    beforeEach(() => {
      fire = () => {};
      media = {
        matches: false,
        addEventListener: (_: string, fn: () => void) => (fire = fn),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal('matchMedia', () => media);
      theme.connect();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('drops the value when the change event fires', () => {
      theme.background();
      fire();
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
    });

    it('drops the value before the change event fires, which waits for the next frame', () => {
      theme.background();
      media.matches = true;
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
      theme.background();
      expect(reads).toHaveBeenCalledTimes(2);
    });
  });

  it('does not keep a value read while detached', () => {
    host.remove();
    theme.background();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('forgets the value once disconnected', () => {
    theme.background();
    theme.disconnect();
    theme.background();
    expect(reads).toHaveBeenCalledTimes(2);
  });
});

describe('PlotTheme neutral greys', () => {
  const LIGHT = { '--ps-plot-other': '#888888', '--ps-plot-na': '#dddddd' };
  const DARK = { '--ps-plot-other': ' #64748b', '--ps-plot-na': '#2a3547 ' };
  const DARK_NEUTRALS = { other: '#64748b', na: '#2a3547' };

  let tokens: Record<string, string>;
  let reads: ReturnType<typeof vi.spyOn>;
  let host: HTMLElement;
  let onChange: ReturnType<typeof vi.fn>;
  let theme: PlotTheme;

  /** What `getComputedStyle` resolves the tokens to from now on (jsdom has no cascade for them). */
  const resolveTokens = (next: Record<string, string>) => {
    tokens = next;
  };

  /** A `prefers-color-scheme` query whose change event the test fires; reconnects to it. */
  function stubScheme() {
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    }));
    theme.connect();
    return () => listeners.forEach((fn) => fn());
  }

  beforeEach(() => {
    tokens = LIGHT;
    reads = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          backgroundColor: 'rgb(255, 255, 255)',
          getPropertyValue: (name: string) => tokens[name] ?? '',
        }) as unknown as CSSStyleDeclaration,
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    onChange = vi.fn();
    theme = new PlotTheme(host, onChange);
    theme.connect();
  });

  afterEach(() => {
    theme.disconnect();
    reads.mockRestore();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.body.removeAttribute('class');
    root.removeAttribute('data-theme');
  });

  it('reads both greys with one computed-style read, trimmed, and keeps them', () => {
    resolveTokens(DARK);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
    theme.neutrals();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('neutrals fall back to the light values when the tokens are empty', () => {
    resolveTokens({});
    expect(theme.neutrals()).toEqual(LIGHT_NEUTRALS);
  });

  it('a data-theme flip that changes the greys calls onChange once', async () => {
    theme.neutrals();
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
  });

  it('re-setting data-theme to its value does not call onChange', async () => {
    theme.neutrals();
    // Explore's layout effect sets the attribute the boot script already set.
    root.dataset.theme = 'light';
    await tick();
    root.dataset.theme = 'light';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an OS flip with no change in the greys does not call onChange', () => {
    const fire = stubScheme();
    theme.neutrals();
    fire();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an OS flip that changes the greys calls onChange once', () => {
    const fire = stubScheme();
    theme.neutrals();
    resolveTokens(DARK);
    fire();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a class change on an ancestor below <html> does not call onChange', async () => {
    const wrapper = document.createElement('section');
    document.body.appendChild(wrapper);
    wrapper.appendChild(host);
    theme.connect();
    theme.neutrals();
    // Even with new token values: only <html> and the OS scheme theme the page.
    resolveTokens(DARK);
    wrapper.className = 'dark';
    document.body.className = 'sliding';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('nothing read yet: a flip does not call onChange', async () => {
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    // Nor does it force a style read.
    expect(reads).not.toHaveBeenCalled();
  });

  it('disconnect stops notifications', async () => {
    theme.neutrals();
    theme.disconnect();
    resolveTokens(DARK);
    root.dataset.theme = 'dark';
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a change while disconnected is noticed on reconnect', () => {
    theme.neutrals();
    theme.disconnect();
    resolveTokens(DARK);
    theme.connect();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(theme.neutrals()).toEqual(DARK_NEUTRALS);
  });
});
```

- [ ] **Step 4: Write the failing browser test**

Create `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

/** The private members these cases watch. */
interface PlotPrivates {
  _webglRenderer: {
    invalidateCategoryStyles(): void;
    invalidateDepthOrder(): void;
    invalidateStyleCache(): void;
  } | null;
  _renderLoop: { request(): void };
}

const root = document.documentElement;
// Pure red: its blends with its ×0.5 rim and with white keep R ≥ 127, so no edge pixel can come
// near the slate #64748b the capture case counts.
const FAMILY_A = [0xff, 0x00, 0x00];
const DARK_OTHER = [0x64, 0x74, 0x8b];
const LIGHT_OTHER = [0x88, 0x88, 0x88];

beforeAll(() => adoptTheme());
afterEach(() => {
  root.removeAttribute('data-theme');
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const near = (rgb: number[], want: number[]) => rgb.every((c, i) => Math.abs(c - want[i]) <= 3);

/** Four proteins far apart: P1 and P4 in family A, P2 and P3 in B, which the plot draws as Other. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    projections: [
      { name: 'umap', dimension: 2, data: new Float32Array([0, 0, 0, 10, 10, 0, 10, 10]) },
    ],
    annotations: {
      fam: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#ff0000', '#cc3311'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { fam: Int32Array.from([0, 1, 1, 0]) },
  } as unknown as VisualizationData;
}

/** The RGB the plot's WebGL canvas holds at a protein's centre. */
function pixelAt(plot: ProtspaceScatterplot, id: string): number[] {
  const canvas = plot.shadowRoot!.querySelector('canvas')!;
  const rect = canvas.getBoundingClientRect();
  const at = plot.getProteinClientPosition(id);
  if (!at || rect.width === 0) return [-1, -1, -1];
  const x = Math.round((at.x - rect.left) * (canvas.width / rect.width));
  const y = Math.round((at.y - rect.top) * (canvas.height / rect.height));
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

/** A drawn plot: mounted at 480×360 with opaque points, so a centre pixel is the point's colour. */
async function mountPlot(): Promise<ProtspaceScatterplot> {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.otherAnnotationValues = ['B'];
  plot.config = { baseOpacity: 1 };
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  await vi.waitFor(() => expect(near(pixelAt(plot, 'P1'), FAMILY_A)).toBe(true), {
    timeout: 5_000,
  });
  return plot;
}

describe('scatterplot theme', () => {
  it('in dark the host background is #0b1120', async () => {
    const plot = await mountPlot();
    expect(getComputedStyle(plot).backgroundColor).toBe('rgb(255, 255, 255)');
    root.dataset.theme = 'dark';
    expect(getComputedStyle(plot).backgroundColor).toBe('rgb(11, 17, 32)');
  });

  it("in dark an Other point's pixel is the dark grey (±3 per channel after blending)", async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => {
      const rgb = pixelAt(plot, 'P2');
      expect(near(rgb, DARK_OTHER), `P2 is ${rgb}`).toBe(true);
    });
  });

  it('switching dark → light requests one render and restyles colour only', async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    const privates = plot as unknown as PlotPrivates;
    const renderer = privates._webglRenderer!;
    const restyle = vi.spyOn(renderer, 'invalidateCategoryStyles');
    const resort = vi.spyOn(renderer, 'invalidateDepthOrder');
    const restage = vi.spyOn(renderer, 'invalidateStyleCache');
    const request = vi.spyOn(privates._renderLoop, 'request');

    root.dataset.theme = 'light';
    await tick();

    expect(restyle).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(resort).not.toHaveBeenCalled();
    expect(restage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), LIGHT_OTHER)).toBe(true));
  });

  it("re-setting data-theme='dark' renders nothing", async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    const privates = plot as unknown as PlotPrivates;
    const restyle = vi.spyOn(privates._webglRenderer!, 'invalidateCategoryStyles');
    const request = vi.spyOn(privates._renderLoop, 'request');

    root.dataset.theme = 'dark';
    await tick();

    expect(restyle).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('captureAtResolution in dark gives #888888 Other points on #ffffff', async () => {
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));

    const out = plot.captureAtResolution(480, 360);
    const data = out.getContext('2d')!.getImageData(0, 0, out.width, out.height).data;
    let light = 0;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [data[i], data[i + 1], data[i + 2]];
      if (near(rgb, LIGHT_OTHER)) light++;
      if (near(rgb, DARK_OTHER)) dark++;
    }
    expect(Array.from(data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(light).toBeGreaterThan(0);
    // The live view's dark grey never reaches the export (its rims and anti-aliasing are
    // neutral greys, never the slate-blue #64748b).
    expect(dark).toBe(0);
  });

  it('a plot mounted in dark draws in the dark greys from the start, with no theme restyle', async () => {
    const proto = customElements.get('protspace-scatterplot')!.prototype as unknown as {
      _handleThemeChange(): void;
    };
    const restyle = vi.spyOn(proto, '_handleThemeChange');
    root.dataset.theme = 'dark';
    const plot = await mountPlot();
    await vi.waitFor(() => expect(near(pixelAt(plot, 'P2'), DARK_OTHER)).toBe(true));
    // Review Focus 2: a dark load adds no render. If the greys were first read while the plot was
    // detached (the light fallback), connect() would flip them to dark and restyle once.
    expect(restyle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the new tests and watch them fail**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/theme.test.ts \
  src/utils/theme-observer.test.ts \
  src/components/scatter-plot/styling/plot-theme.test.ts
```

Expected: FAIL. `theme.test.ts`: the two new cases (`--ps-plot-other` is undefined); the existing two pass. `theme-observer.test.ts` and `plot-theme.test.ts`: the file fails to load, `Failed to resolve import "./theme-observer"` / `"./plot-theme"`.

Then, with the sandbox disabled:

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/scatter-plot.theme.browser.test.ts
```

Expected: FAIL, 6 cases: the host background is `rgb(255, 255, 255)` in dark (`--protspace-bg-color` is `var(--surface)`); P2's pixel stays `#888888` in dark (the greys are the light constants), so the next three cases time out in their dark wait; the capture case also times out there; the dark-mount case fails at `vi.spyOn` (`_handleThemeChange` does not exist yet).

- [ ] **Step 6: Add the plot tokens**

In `packages/core/src/styles/theme.ts`, in `const lightRoles = css\`…\``, after `--ps-shadow-lg: 0 12px 32px -12px rgb(15 23 42 / 0.24), 0 2px 6px rgb(15 23 42 / 0.06);` add:

```css
  --ps-plot-bg: #ffffff; /* the plot's background, as exports draw it */
  --ps-plot-other: #888888; /* Other points: NEUTRAL_VALUE_COLOR, what exports draw */
  --ps-plot-na: #dddddd; /* N/A points in the default N/A colour: NA_DEFAULT_COLOR */
```

In `const darkRoles = css\`…\``, after `--ps-shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.75), 0 0 0 1px #24324a;` add:

```css
  --ps-plot-bg: #0b1120; /* a step darker than the panels */
  --ps-plot-other: #64748b; /* slate-500, 4:1 on the plot */
  --ps-plot-na: #2a3547; /* de-emphasised, as #dddddd is on white */
```

- [ ] **Step 7: Create `observeTheme`**

Create `packages/core/src/utils/theme-observer.ts`:

```ts
/**
 * Calls `onChange` when the page's theme may have changed: an attribute that themes `<html>`
 * (`data-theme`, `class`, `style`) changed, once per batch of mutations, or the OS colour scheme
 * flipped. The calls are raw, even for a `data-theme` re-set to the value it had or an OS flip
 * under an explicit theme: a consumer reads its tokens and compares them before it redraws
 * anything. Returns the function that stops watching.
 *
 * Attributes below `<html>` are not watched: the workbench's slide animates attributes on the
 * plot's ancestors, and nothing there sets the theme.
 */
export function observeTheme(onChange: () => void, doc: Document = document): () => void {
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => onChange());
    observer.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
  }
  const scheme =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => onChange();
  scheme?.addEventListener?.('change', onScheme);
  return () => {
    observer?.disconnect();
    scheme?.removeEventListener?.('change', onScheme);
  };
}
```

- [ ] **Step 8: Create `PlotTheme` and delete `BackgroundColorCache`**

Create `packages/core/src/components/scatter-plot/styling/plot-theme.ts`:

```ts
import { observeTheme } from '../../../utils/theme-observer';
import { resolveColor } from '../webgl/color-utils';
import { LIGHT_NEUTRALS, sameNeutrals, type PlotNeutrals } from './plot-neutrals';

type Rgb = readonly [number, number, number];

const parentAcrossShadow = (node: Node): Node | null =>
  node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;

/**
 * The plot's themed values, read from computed style and kept until something that can restyle
 * them happens: the background, which the renderer takes as its knockout colour on every draw,
 * and the neutral greys (`--ps-plot-other`, `--ps-plot-na`) the style getters draw Other and
 * default-coloured N/A points with.
 *
 * Reading computed style forces a synchronous style recalculation whenever the document has
 * pending style changes, which a render that follows any DOM or class change has, so both are
 * cached. The background is dropped on anything that could restyle the host: attribute changes
 * (class, style, data-theme, ...) on the host or any ancestor across shadow boundaries, a
 * stylesheet or `<style>` added to or removed from `<head>`, a `prefers-color-scheme` flip, and
 * re-attachment to the document. Dropping it never asks for a render: the knockout has no
 * visible effect (`PREDICTED_INTERIOR_FILL` is 0).
 *
 * The greys follow the theme. On a theme change (`observeTheme`: `<html>`'s `data-theme`, `class`
 * or `style`, or the OS scheme) they are read again if they were read before, and `onChange`
 * runs once when either resolves to another value. Re-setting `data-theme` to its value, an OS
 * flip under an explicit theme, and attribute changes below `<html>` (the sidebar's slide) never
 * run it, which keeps a theme watcher from adding renders on load or while idle. Rules inserted
 * through the CSSOM (`insertRule`, `adoptedStyleSheets`) cannot be observed: an embedder that
 * restyles the plot that way touches an attribute of `<html>` (the greys) or of the plot (the
 * background) for the next draw to read the new values.
 */
export class PlotTheme {
  private _background: Rgb | null = null;
  private _neutrals: PlotNeutrals | null = null;
  private _observer: MutationObserver | null = null;
  private _scheme: MediaQueryList | null = null;
  /** The scheme the cached background was read under. */
  private _schemeDark = false;
  private _stopTheme: (() => void) | null = null;

  constructor(
    private readonly _host: HTMLElement,
    private readonly _onChange: () => void,
  ) {}

  /** The neutral greys: one computed-style read, the light greys where a token is unset. */
  neutrals(): PlotNeutrals {
    return (this._neutrals ??= this._readNeutrals());
  }

  /** The resolved background; read from computed style only when no valid value is cached. */
  background(): Rgb {
    // Mutations are delivered as a microtask; a read in the same task as the change must not
    // see the old colour.
    if (this._observer?.takeRecords().length) this._background = null;
    // Likewise a `prefers-color-scheme` flip, whose change event waits for the next frame.
    if (this._scheme && this._scheme.matches !== this._schemeDark) this._background = null;
    if (this._background) return this._background;
    const color = resolveColor(getComputedStyle(this._host).backgroundColor);
    // A detached host has no computed style to cache.
    if (this._host.isConnected) {
      this._background = color;
      this._schemeDark = this._scheme?.matches ?? false;
    }
    return color;
  }

  /** Start watching for restyles; call from `connectedCallback`. Idempotent. */
  connect(): void {
    this.disconnect();
    if (typeof MutationObserver !== 'undefined') {
      this._observer = new MutationObserver(this._invalidateBackground);
      for (let node: Node | null = this._host; node; node = parentAcrossShadow(node)) {
        if (node instanceof Element) this._observer.observe(node, { attributes: true });
      }
      const head = this._host.ownerDocument.head;
      if (head) this._observer.observe(head, { childList: true, subtree: true });
    }
    if (typeof matchMedia === 'function') {
      this._scheme = matchMedia('(prefers-color-scheme: dark)');
      this._scheme.addEventListener?.('change', this._invalidateBackground);
    }
    this._stopTheme = observeTheme(this._onTheme, this._host.ownerDocument);
    // A theme change while the plot was detached went unheard.
    this._onTheme();
  }

  /** Stop watching; call from `disconnectedCallback`. The greys stay, for `connect` to compare. */
  disconnect(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._scheme?.removeEventListener?.('change', this._invalidateBackground);
    this._scheme = null;
    this._stopTheme?.();
    this._stopTheme = null;
    this._background = null;
  }

  private _invalidateBackground = () => {
    this._background = null;
  };

  private _onTheme = () => {
    this._background = null;
    const before = this._neutrals;
    if (!before) return;
    const after = this._readNeutrals();
    if (sameNeutrals(before, after)) return;
    this._neutrals = after;
    this._onChange();
  };

  private _readNeutrals(): PlotNeutrals {
    const style = getComputedStyle(this._host);
    const read = {
      other: style.getPropertyValue('--ps-plot-other').trim() || LIGHT_NEUTRALS.other,
      na: style.getPropertyValue('--ps-plot-na').trim() || LIGHT_NEUTRALS.na,
    };
    // The light greys by identity, so exportGetters' sameNeutrals check (once per point per
    // getter during an export) takes its `a === b` fast path.
    return sameNeutrals(read, LIGHT_NEUTRALS) ? LIGHT_NEUTRALS : read;
  }
}
```

Delete the old class and its test:

```bash
git rm packages/core/src/components/scatter-plot/styling/background-color-cache.ts \
  packages/core/src/components/scatter-plot/styling/background-color-cache.test.ts
```

- [ ] **Step 9: Wire the plot**

In `packages/core/src/components/scatter-plot/scatter-plot.ts`:

1. Replace `import { BackgroundColorCache } from './styling/background-color-cache';` with:

```ts
import { PlotTheme } from './styling/plot-theme';
```

   and Task 6.3's `import { LIGHT_NEUTRALS, type PlotNeutrals } from './styling/plot-neutrals';` with:

```ts
import type { PlotNeutrals } from './styling/plot-neutrals';
```

2. Replace the two fields (Task 6.3 left `_neutrals` right after `_background`):

```ts
  /** Resolved plot background; see the class for what invalidates it. */
  private _background = new BackgroundColorCache(this);
```
```ts
  /** The greys the live view draws Other and default-coloured N/A points with. */
  private readonly _neutrals = (): PlotNeutrals => LIGHT_NEUTRALS;
```

   with:

```ts
  /** The plot's themed values: the knockout background and the neutral greys (see the class). */
  private readonly _theme = new PlotTheme(this, () => this._handleThemeChange());

  /** The greys the live view draws Other and default-coloured N/A points with: the theme's. */
  private readonly _neutrals = (): PlotNeutrals => this._theme.neutrals();
```

3. In `_createWebglRenderer()`, replace `getKnockoutColor: () => this._background.get(),` with:

```ts
      getKnockoutColor: () => this._theme.background(),
```

4. In `connectedCallback()`, replace `this._background.connect();` with `this._theme.connect();`; in `disconnectedCallback()`, replace `this._background.disconnect();` with `this._theme.disconnect();`.

5. Directly after the arrow method `private _handleColorMappingChange = (event: Event) => { … };` (it ends with `this._renderLoop.request();\n    }\n  };`), add:

```ts
  /**
   * The theme gave the neutral greys new values (`PlotTheme` compares them): restyle colour only,
   * as a colour-only legend change does. One render; nothing re-sorted or re-staged.
   */
  private _handleThemeChange() {
    this._style.invalidateGetters();
    if (this._plotData.length > 0) {
      this._webglRenderer?.invalidateCategoryStyles();
      this._renderLoop.request();
    }
  }
```

After this, `grep -n "_background\|BackgroundColorCache\|LIGHT_NEUTRALS" packages/core/src/components/scatter-plot/scatter-plot.ts` prints nothing.

In `packages/core/src/components/scatter-plot/scatter-plot.styles.ts`, in the `:host` rule of `scatterplotStylesCore`, delete the line:

```css
    --protspace-bg-color: var(--surface);
```

and replace `background: var(--protspace-bg-color);` with:

```css
    background: var(--ps-plot-bg);
```

(`scatter-plot.styles.ts` stays in `LEGACY`: its other raw colours go in Task 6.6.)

- [ ] **Step 10: Run the core tests and watch them pass**

```bash
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/theme.test.ts \
  src/styles/style-lint.test.ts \
  src/utils/theme-observer.test.ts \
  src/components/scatter-plot
```

Expected: PASS. New: 2 in `theme.test.ts`, 6 in `theme-observer.test.ts`, 20 in `plot-theme.test.ts` (10 moved, 10 new); `background-color-cache.test.ts` (10) is gone. `style-lint.test.ts` passes: the three tokens have readers (`--ps-plot-bg` in `scatter-plot.styles.ts`, the two greys as strings in `plot-theme.ts`) and LEGACY is still 7. The jsdom plot suites keep their counts: with no token sheet the greys fall back to the light ones, so nothing in them restyles.

With the sandbox disabled:

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/scatter-plot/scatter-plot.theme.browser.test.ts \
  src/styles/theme.browser.test.ts \
  src/components/scatter-plot/scatter-plot.touch.browser.test.ts
```

Expected: PASS (6 new; the other two files at their baseline counts).

If only the dark-mount case fails (`_handleThemeChange` called once), the greys were read while the plot was still detached and cached as the light fallback. Fix it in `PlotTheme.neutrals()`, not in the test: return `this._readNeutrals()` without caching while `!this._host.isConnected`, so the first cached read happens connected. Re-run `plot-theme.test.ts` and `scatter-plot.export-style.test.ts` after that change.

- [ ] **Step 11: Pin the light theme in the perf contexts**

In `apps/web/tests/helpers/tour-storage-state.ts`, below `import { TOUR_STORAGE_KEY } from '../../src/tour/storage-key';` add:

```ts
import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';
```

In the doc comment above `exploreStorageState`, replace the two lines:

```ts
 * Explore's local storage for a Playwright context: the product tour's "already seen" flag, and a
 * stored layout when one is given.
```

with:

```ts
 * Explore's local storage for a Playwright context: the product tour's "already seen" flag, and a
 * stored layout and theme when they are given.
```

and the line:

```ts
 * size, so an unpinned layout would make runs incomparable (design decision 4).
```

with:

```ts
 * size, so an unpinned layout would make runs incomparable (design decision 4). It pins the
 * theme too, so a run never measures the dark plot or depends on the default theme.
```

Then replace the function:

```ts
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
```

with:

```ts
export function exploreStorageState(
  baseUrl: string,
  options: { layout?: LayoutState; theme?: ThemeChoice } = {},
): BrowserContextOptions['storageState'] {
  const localStorage = [{ name: TOUR_STORAGE_KEY, value: 'true' }];
  if (options.layout) {
    localStorage.push({ name: LAYOUT_STORAGE_KEY, value: JSON.stringify(options.layout) });
  }
  if (options.theme) {
    // JSON-encoded, as the theme store writes it through setStorageItem.
    localStorage.push({ name: THEME_STORAGE_KEY, value: JSON.stringify(options.theme) });
  }
  return { cookies: [], origins: [{ origin: new URL(baseUrl).origin, localStorage }] };
}
```

In `apps/web/tests/helpers/perf/scenarios.ts`, in `newPerfContext`, replace `storageState: exploreStorageState(baseUrl, { layout: DEFAULT_LAYOUT }),` with:

```ts
    storageState: exploreStorageState(baseUrl, { layout: DEFAULT_LAYOUT, theme: 'light' }),
```

and in its doc comment replace the two lines:

```ts
 * A context with the viewport and pixel ratio the segments assume, past the tour, with the layout
 * and the colour scheme pinned: the sidebar's width sets the plot's size, which feeds the point
```

with:

```ts
 * A context with the viewport and pixel ratio the segments assume, past the tour, with the layout,
 * the stored theme (light) and the colour scheme pinned: the sidebar's width sets the plot's size,
 * which feeds the point
```

In `apps/web/tests/perf-scale.spec.ts`, in `openPage`, replace `storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT }),` with:

```ts
    storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT, theme: 'light' }),
```

In `perf/playwright.config.ts`, replace `storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT }),` with:

```ts
    storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT, theme: 'light' }),
```

and in the comment above it replace the two lines:

```ts
    // the helper for what it costs when it runs. The layout and the light theme are pinned, as
    // newPerfContext pins them: the sidebar's width sets the plot's size (design decision 4).
```

with:

```ts
    // the helper for what it costs when it runs. The layout, the stored light theme and the light
    // colour scheme are pinned, as newPerfContext pins them: the sidebar's width sets the plot's
    // size (design decision 4).
```

- [ ] **Step 12: Add the `theme-switch` perf segment**

In `apps/web/tests/helpers/perf/scenarios.ts`:

1. In `const SEGMENTS = { … }`, after `'panel-expand': { repeatable: true },` add:

```ts
  'theme-switch': { repeatable: true },
```

2. In `buildSegments`, after the `panel-expand` entry (the object that ends `act: () => expandSidebar(page),\n    },`), add:

```ts
    {
      name: 'theme-switch',
      // Dark gives the plot's neutral greys new values: one colour-only restyle and one render,
      // nothing re-sorted, re-processed or rebuilt (design decision 16). The attribute is what
      // every consumer watches, so the segment sets it rather than going through the menu.
      act: () =>
        page.evaluate(() => {
          document.documentElement.dataset.theme = 'dark';
        }),
      reset: () =>
        page.evaluate(() => {
          document.documentElement.dataset.theme = 'light';
        }),
      pixels: true,
    },
```

3. Replace the doc comment `/** Segments 2–12 in run order; `load` is measured by `measureLoad`. */` with:

```ts
/** Segments 2–13 in run order; `load` is measured by `measureLoad`. */
```

- [ ] **Step 13: Record and check the budget (this task's one e2e run)**

Build the packages the app imports, type-check the app (its e2e project includes `tests/`), then record the budget. Sandbox disabled for all of them; `perf/datasets/phosphatase.parquetbundle` was fetched at the phase baseline (`pnpm perf:fetch --only phosphatase` otherwise).

```bash
pnpm --filter @protspace/core build
pnpm --filter @protspace/app type-check
PERF_UPDATE_BUDGETS=1 pnpm perf:counts
git diff apps/web/tests/perf/budgets.json
```

Expected: the diff adds a `"theme-switch"` block and changes `recordedAt`, nothing else. The block must read `"restagePos": 0`, `"processData": 0`, `"gridRebuild": 0`, `"legendUpdate": 0`, `"legendRebuild": 0`, `"render": 1`, `"restage"` 0 or 1, `"restageStyle"` 0 or 1 (`glSync`, `bufferBytes` and `glIsPerRender` as recorded). If `render` is above 1 or any of the zeros is not 0, the theme watcher re-renders more than once: stop and fix the code, not the budget. If the recording moved any other segment's numbers (`load` and `idle` in particular), restore those lines to their committed values by hand, keep only the `theme-switch` block and `recordedAt`, and say so in the report.

Then check every budget against the edited file:

```bash
pnpm perf:counts
```

Expected: PASS; `theme-switch` within budget, `load` and `idle` at their committed budgets (`idle` all 0), and the `theme-switch` pixel check holds (the reset restores the light frame).

- [ ] **Step 14: Update the developer docs**

In `docs/developers/style-architecture.md`, under `### Design tokens`, replace the paragraph:

```md
Colours, font sizes, spacing, radii, shadows and durations are `--ps-*` tokens, declared only in
`packages/core/src/styles/theme.ts` (light values on `:root`, dark values under
`[data-theme='dark']`). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.
```

with:

```md
Colours, font sizes, spacing, radii, shadows and durations are `--ps-*` tokens, declared only in
`packages/core/src/styles/theme.ts` (light values on `:root`, dark values under
`[data-theme='dark']`, and under `[data-theme='system']` while the OS prefers dark, so a
`system` page follows the OS live). New styles read these tokens and declare none:
`packages/core/src/styles/style-lint.test.ts` fails a stylesheet that hard-codes a colour or a
font size, declares a `--ps-*` token, or reads a variable `theme.ts` does not define. Modules
written before the tokens are listed in its `LEGACY` set, which only shrinks.

The scatter plot reads three tokens for what it draws: `--ps-plot-bg` (its background),
`--ps-plot-other` (Other points) and `--ps-plot-na` (N/A points whose colour is the default
`#DDDDDD`; a picked N/A colour is kept). Their light values are the data's own colours. When a
theme change gives either grey a new value, the plot restyles its points once, colour only;
anything else (re-setting `data-theme`, an OS flip under an explicit theme) redraws nothing.
Exports always draw the light values on white.
```

and in `### Component properties`, replace:

```css
--protspace-bg-color            /* component background */
--protspace-viewer-height       /* element sizing */
```

with:

```css
--protspace-height              /* element sizing */
--protspace-viewer-height       /* element sizing */
```

and `1. **Always reference tokens**: `--protspace-bg-color: var(--ps-surface)`` with:

```md
1. **Always reference tokens**: `--protspace-border-radius: var(--ps-radius)`
```

- [ ] **Step 15: Format, lint and commit**

```bash
pnpm exec prettier --check \
  packages/core/src/styles/theme.ts packages/core/src/styles/theme.test.ts \
  packages/core/src/utils/theme-observer.ts packages/core/src/utils/theme-observer.test.ts \
  packages/core/src/components/scatter-plot \
  apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/perf/scenarios.ts \
  apps/web/tests/perf-scale.spec.ts apps/web/tests/perf/budgets.json perf/playwright.config.ts \
  docs/developers/style-architecture.md
pnpm --filter @protspace/core exec eslint src/utils/theme-observer.ts \
  src/components/scatter-plot/styling/plot-theme.ts src/components/scatter-plot/scatter-plot.ts
wc -l packages/core/src/components/scatter-plot/scatter-plot.ts
git add packages/core/src/styles/theme.ts packages/core/src/styles/theme.test.ts \
  packages/core/src/utils/theme-observer.ts packages/core/src/utils/theme-observer.test.ts \
  packages/core/src/components/scatter-plot/styling/plot-theme.ts \
  packages/core/src/components/scatter-plot/styling/plot-theme.test.ts \
  packages/core/src/components/scatter-plot/scatter-plot.ts \
  packages/core/src/components/scatter-plot/scatter-plot.styles.ts \
  packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts \
  apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/perf/scenarios.ts \
  apps/web/tests/perf-scale.spec.ts apps/web/tests/perf/budgets.json perf/playwright.config.ts \
  docs/developers/style-architecture.md
git commit -m "feat(core): plot background and neutral greys follow the theme"
```

(The two deleted files were staged by `git rm` in Step 8. Sandbox disabled for the commit: the hook runs `pnpm precommit`, whose docs build checks the edited developer page. Knip: `observeTheme` is imported by `plot-theme.ts`, `PlotTheme` by `scatter-plot.ts`, and `ThemeChoice`/`THEME_STORAGE_KEY` by the e2e helper.)

Report: counts of the files run before and after, the `theme-switch` budget block as committed, LEGACY 7, `wc -l scatter-plot.ts` (about 2,640).

### Task 6.5: Exports and the figure editor preview stay light in dark

The figure editor previews every figure on fixed light paper (a white figure covers the checkerboard; a transparent one shows it), the same in both themes, so its dark-text legend never sits on slate. E2E proves the export path end to end: a quick PNG exported in Dark is pixel-identical to the one exported in Light.

**Files:**

- Modify: `packages/core/src/styles/theme.ts` (a `fixedRoles` block in `:root` only: `--ps-paper`, `--ps-paper-check`)
- Modify: `packages/core/src/components/publish/publish-modal.styles.ts` (`.publish-preview-canvas` background), `publish-modal.browser.test.ts`
- Modify: `apps/web/tests/workbench-theme.spec.ts`

**Interfaces:**

- Consumes: `exportGetters`, the white knockout (6.3); the plot tokens (6.4); `chooseTheme(page, 'System' | 'Light' | 'Dark')`, `htmlTheme(page)` (`tests/helpers/theme.ts`, 6.1–6.2); `openExplore(page)`, `exportAction(page, 'Quick PNG' | 'Figure editor…')` (`tests/helpers/explore.ts`); the figure editor's Background `<select class="publish-select">` with options `white` / `transparent` (`publish/sections/presets-options-section.ts:79-93`); the `publish-modal.browser.test.ts` module helpers `mount()` (returns `{ opener, modal, internals, native }`) and `ModalInternals._updateState(partial)`, its `beforeAll(() => adoptTheme())` and its `afterEach` that empties `document.body`; `protspace-publish-modal`'s `plotElement` property and `_redraw()` (it captures through `plotElement.captureAtResolution(w, h, { dpr, backgroundColor, resetView })`, then `composeFigure` fills `#ffffff` for a white figure); the preview `<canvas class="publish-preview-canvas">` in the modal's shadow root.
- Produces:
  - `theme.ts`: `const fixedRoles = css\`--ps-paper: #ffffff; --ps-paper-check: #e2e8f0;\`` interpolated into the `:root` rule only, with a comment that exports are light in both themes.
  - `.publish-preview-canvas { background: repeating-conic-gradient(var(--ps-paper-check) 0 25%, var(--ps-paper) 0 50%) 50% / 16px 16px; }` (no `--ps-surface`).

**Tests:**

- `publish-modal.browser.test.ts`: "the preview's backdrop is the light paper in dark" (`data-theme='dark'`: the computed `background-image` holds `rgb(255, 255, 255)` and `rgb(226, 232, 240)`, not the dark surface); "a white figure still previews white".
- `workbench-theme.spec.ts`: "a quick PNG exported in Dark equals the one exported in Light" (export, `chooseTheme(page, 'Dark')`, export again; decode both downloads in the page with `createImageBitmap` and compare their `getImageData` buffers; also the top-left pixel is white); "the figure editor previews a transparent figure on light paper in Dark" (open the editor, choose the transparent background, read the preview canvas's computed background image).
- Unrun at task time (exit): `figure-editor.spec.ts`, `workbench-import-export.spec.ts`.

LEGACY count: 7.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. The browser test, the e2e run and the commit need the sandbox disabled.

- [ ] **Step 1: Write the failing browser tests**

In `packages/core/src/components/publish/publish-modal.browser.test.ts`, append at the end of the file:

```ts
describe('protspace-publish-modal preview paper', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  const preview = (modal: HTMLElement) =>
    modal.shadowRoot!.querySelector<HTMLCanvasElement>('.publish-preview-canvas')!;

  it("the preview's backdrop is the light paper in dark", async () => {
    document.documentElement.dataset.theme = 'dark';
    const { modal } = await mount();
    const style = getComputedStyle(preview(modal));
    // Exports are light in both themes, so the figure is previewed on light paper:
    // white with a slate-200 checkerboard, never the dark surface.
    expect(style.backgroundImage).toContain('rgb(255, 255, 255)');
    expect(style.backgroundImage).toContain('rgb(226, 232, 240)');
    expect(style.backgroundImage).not.toContain('rgb(15, 23, 42)');
    expect(style.backgroundColor).not.toBe('rgb(15, 23, 42)');
  });

  it('a white figure still previews white', async () => {
    document.documentElement.dataset.theme = 'dark';
    const { modal, internals } = await mount();
    // A plot whose capture is fully transparent: only the figure's own background shows.
    modal.plotElement = Object.assign(document.createElement('div'), {
      captureAtResolution: (width: number, height: number) =>
        Object.assign(document.createElement('canvas'), { width, height }),
    });
    internals._updateState({ background: 'white' });
    await modal.updateComplete;
    const canvas = preview(modal);
    await vi.waitFor(() => {
      expect(canvas.width).toBeGreaterThan(300);
      const pixel = Array.from(canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data);
      expect(pixel).toEqual([255, 255, 255, 255]);
    });
  });
});
```

(`300` is a bare canvas's default width: a larger one means `_redraw` has sized the canvas to the figure's `widthPx` and drawn it.)

- [ ] **Step 2: Run them and watch the first fail**

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/publish/publish-modal.browser.test.ts
```

Expected: FAIL, 1 case: "the preview's backdrop is the light paper in dark" (`backgroundImage` is `none`; the backdrop is `background: var(--ps-surface)`, `rgb(15, 23, 42)` in dark). "a white figure still previews white" passes already: it pins that a white figure keeps covering the backdrop once the backdrop changes. Every existing case passes.

- [ ] **Step 3: Add the fixed paper tokens**

In `packages/core/src/styles/theme.ts`, after the closing backtick of `const darkRoles = css\`…\`;` add:

```ts
// Fixed light roles, declared once on :root and never redefined for dark: exports are light in
// both themes, so the figure editor previews them on light paper whatever the theme.
const fixedRoles = css`
  --ps-paper: #ffffff;
  --ps-paper-check: #e2e8f0; /* slate-200: the checkerboard behind a transparent figure */
`;
```

and in `export const theme = css\`…\``, replace the `:root` rule:

```ts
    :root {
      color-scheme: light;
      ${lightRoles}
      ${sizes}
    }
```

with:

```ts
    :root {
      color-scheme: light;
      ${lightRoles}
      ${fixedRoles}
      ${sizes}
    }
```

- [ ] **Step 4: Preview on the paper**

In `packages/core/src/components/publish/publish-modal.styles.ts`, in the `.publish-preview-canvas` rule, replace:

```css
      /* Behind a transparent figure only; a white one paints its own background. */
      background: var(--ps-surface);
```

with:

```css
      /* Fixed light paper in both themes (exports are light): a white figure paints over it; a
         transparent one shows the checkerboard, never the dark surface its legend text would
         vanish on. */
      background: repeating-conic-gradient(var(--ps-paper-check) 0 25%, var(--ps-paper) 0 50%)
        50% / 16px 16px;
```

- [ ] **Step 5: Run the browser tests and the style checks**

```bash
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/publish/publish-modal.browser.test.ts \
  src/styles/theme.browser.test.ts
pnpm --filter @protspace/core exec vitest --run --project unit \
  src/styles/style-lint.test.ts src/styles/theme.test.ts src/components/publish
```

Expected: PASS. `publish-modal.browser.test.ts` gains 2 cases. `style-lint.test.ts` passes: `publish-modal.styles.ts` is not in `LEGACY` and holds no raw colour, both new tokens are defined in `theme.ts`, and each has a reader (the preview rule). LEGACY stays 7.

- [ ] **Step 6: Write the e2e cases**

In `apps/web/tests/workbench-theme.spec.ts` (Task 6.1 created it, Task 6.2 extended it):

1. Add at the top, beside the existing imports, `import fs from 'node:fs';`; add `type Page` to the existing `@playwright/test` import (it already imports `test` and `expect`) unless it is there; extend the existing `./helpers/explore` import with `exportAction` (it already imports `openExplore`); and extend the existing `./helpers/theme` import with `chooseTheme` and `htmlTheme` where either is missing.
2. Append at the end of the file:

```ts
test.describe('exports stay light in Dark', () => {
  /** Exports a quick PNG and returns the downloaded file, base64-encoded. */
  async function quickPng(page: Page): Promise<string> {
    const download = page.waitForEvent('download');
    await exportAction(page, 'Quick PNG');
    const file = await download;
    return fs.readFileSync(await file.path()).toString('base64');
  }

  test('a quick PNG exported in Dark equals the one exported in Light', async ({ page }) => {
    await openExplore(page);
    // Explicit, so the test holds whatever DEFAULT_THEME is (Task 6.13 makes it System).
    await chooseTheme(page, 'Light');
    expect(await htmlTheme(page)).toBe('light');
    const light = await quickPng(page);
    await chooseTheme(page, 'Dark');
    expect(await htmlTheme(page)).toBe('dark');
    const dark = await quickPng(page);

    // Decode both in the page and compare every pixel: the export never reads the theme.
    const result = await page.evaluate(async ([a, b]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      let differing = 0;
      if (x.data.length === y.data.length) {
        for (let i = 0; i < x.data.length; i++) if (x.data[i] !== y.data[i]) differing++;
      }
      return {
        light: [x.width, x.height],
        dark: [y.width, y.height],
        differing,
        topLeft: Array.from(y.data.slice(0, 4)),
      };
    }, [light, dark] as const);

    expect(result.dark).toEqual(result.light);
    expect(result.differing).toBe(0);
    expect(result.topLeft).toEqual([255, 255, 255, 255]);
  });

  test('the figure editor previews a transparent figure on light paper in Dark', async ({
    page,
  }) => {
    await openExplore(page);
    await chooseTheme(page, 'Dark');
    await exportAction(page, 'Figure editor…');
    const modal = page.locator('protspace-publish-modal');
    const preview = modal.locator('.publish-preview-canvas');
    await expect(preview).toBeVisible();
    await modal
      .locator('select.publish-select')
      .filter({ has: page.locator('option[value="transparent"]') })
      .selectOption('transparent');

    const backdrop = await preview.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backdrop).toContain('rgb(255, 255, 255)');
    expect(backdrop).toContain('rgb(226, 232, 240)');
    expect(backdrop).not.toContain('rgb(15, 23, 42)');
    // The rest of the editor is dark: only the paper is fixed.
    expect(await htmlTheme(page)).toBe('dark');
  });
});
```

- [ ] **Step 7: Run the e2e cases (this task's one e2e spec)**

```bash
pnpm --filter @protspace/core build
PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-theme.spec.ts --project workbench -g "exports stay light"
```

Expected: PASS, 2 tests. (`pnpm test:e2e` builds the packages itself; the explicit core build keeps `pnpm --filter @protspace/app type-check` in the hook on the new `dist`.) If the PNG comparison fails with `differing > 0`, the export path reads the theme somewhere (the live getters, the live background as knockout, or a CSS colour of the legend): find it, do not loosen the test.

- [ ] **Step 8: Format and commit**

```bash
pnpm exec prettier --check packages/core/src/styles/theme.ts \
  packages/core/src/components/publish/publish-modal.styles.ts \
  packages/core/src/components/publish/publish-modal.browser.test.ts \
  apps/web/tests/workbench-theme.spec.ts
git add packages/core/src/styles/theme.ts \
  packages/core/src/components/publish/publish-modal.styles.ts \
  packages/core/src/components/publish/publish-modal.browser.test.ts \
  apps/web/tests/workbench-theme.spec.ts
git commit -m "feat(core): figure preview on fixed light paper"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

Report: `publish-modal.browser.test.ts` count before and after, the 2 e2e tests, LEGACY 7; unrun at task time: `figure-editor.spec.ts`, `workbench-import-export.spec.ts`.

### Task 6.6: Plot overlays, tooltip and projection card on tokens

Everything the plot draws in CSS or SVG over the points reads tokens: brush and lasso, the EAT connectors and endpoint ring, spiderfy lines and nodes, the plot indicator and the connector chip, the protein tooltip and the projection card (which sits in the light DOM and so inherited dark text onto a light card). Three legacy modules become colour-free, and a colour-only check starts guarding the legacy set.

**Files:**

- Modify: `packages/core/src/styles/theme.ts` (`--ps-plot-connector`, `--ps-eat`, `--ps-eat-endpoint`)
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.styles.ts` (colour `--protspace-*` properties removed; overlays read tokens), `tooltips/protein-tooltip.styles.ts`, `projection-metadata/projection-metadata.styles.ts`
- Modify: `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts` (overlay and tooltip cases)
- Create: `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts`
- Modify: `packages/core/src/styles/style-lint.test.ts` (colour-only check, `STILL_COLOURED`)
- Modify: `docs/developers/style-architecture.md` (the scatter plot's colour properties are gone; theme through `--ps-*`)

**Interfaces:**

- Consumes: `--ps-plot-bg` (6.4); R3's mapping for each declaration (`.superpowers/research/phase-6/R3-surfaces-a11y.md` §2.A) and the Phase 6 overlay mapping; `cssViolations`, `cssOf`, `COLOUR`, `DEFINED`, `RUNTIME_VARS`, `LEGACY`, `MODULES`, `flatten`, `paths` (style lint, module-level); `adoptTheme()` (`components/kit/adopt-theme.ts`); `scatterplotStyles` (`scatter-plot.styles.ts`, an array `[tokens, overlayMixins, scatterplotStylesCore]`); `adoptStyles` (`lit`); the `protspace-protein-tooltip` element (`.view: TooltipView`, `className = 'visible'`, as `protein-tooltip.browser.test.ts` mounts it); `protspace-projection-metadata` (`.projection`, as `projection-metadata.browser.test.ts` mounts it). The overlay assertions use a probe host carrying `scatterplotStyles` (the same sheet the plot's shadow root adopts) with the marks the plot draws (`.brush-container rect.selection`, `.lasso-path`, `.eat-provenance-connector`, `.eat-provenance-endpoint`, `.dup-spiderfy-node-circle`, `.plot-indicator`, `.connector-status`), so they need no dataset or WebGL.
- Produces:
  - Tokens `--ps-plot-connector` (`#475569` / `#94a3b8`), `--ps-eat` (`#7c3aed` / `#a78bfa`), `--ps-eat-endpoint` (`#0f766e` / `#2dd4bf`).
  - `scatter-plot.styles.ts`: `:host` keeps only non-colour `--protspace-*` properties (sizes, opacities, transitions, `--protspace-brush-stroke-width`, `--protspace-border-radius`); brush and lasso `stroke: var(--ps-accent)`, fill `color-mix(in srgb, var(--ps-accent) 15%, transparent)` (see the note below); host border `var(--ps-border)`; `.plot-indicator`, `.connector-status` on `--ps-surface-raised` / `--ps-border` / `--ps-shadow-md` with text `--ps-text-muted` / `--ps-text` and button hover `--ps-surface-hover`; `.dup-spiderfy-line` `color-mix(in srgb, var(--ps-text) 35%, transparent)`; `.dup-spiderfy-node-circle` stroke `var(--ps-plot-bg)`; `.eat-provenance-connector` `var(--ps-plot-connector)`; `.eat-provenance-endpoint` `var(--ps-eat-endpoint)`.
  - `protein-tooltip.styles.ts` and `projection-metadata.styles.ts`: no raw colour and no `tokens.ts` colour alias (R3 mapping; the decorative UniProt separator `--ps-text-faint`; the EAT confidence fill `var(--ps-eat)`, its track `--ps-border-strong`; the projection card's `--text-caption` → `--ps-text-xs`, `--protspace-highlight-color` → `--ps-accent-text`).
  - `style-lint.test.ts`: `const STILL_COLOURED = new Set<string>([structure-viewer.styles.ts, ./mixins.ts, ./overlay-mixins.ts, ./tokens.ts])` (paths as in `LEGACY`); `LEGACY_VARS` (every custom property `tokens.ts` declares) and `COLOUR_ALIASES` (those whose value holds a raw colour), computed from `tokens.ts`'s `cssText`; `ownCssOf(path)` (a module's own sheets: a sheet another module exports by name, such as `tokens`, `overlayMixins` or `srOnlyMixin`, is checked as that module); `colourViolations(cssText)`; test `it.each(LEGACY minus STILL_COLOURED)('%s hard-codes no colour')`: no declaration whose value matches `COLOUR`, no `var()` read of a `COLOUR_ALIASES` name, and every `var()` it reads is a `DEFINED` token, a `RUNTIME_VARS` name, a custom property `tokens.ts` declares, or one the module itself declares; test `it.each([...STILL_COLOURED])('%s still holds a colour')` (a clean entry fails: delete its line). `RUNTIME_VARS` gains `--protspace-tooltip-max-height` and `--protspace-tooltip-effective-width` (set inline at run time by `tooltips/tooltip-position.ts`, read by `protein-tooltip.styles.ts`).

Brush fill note: light `--ps-accent-tint` is opaque `#e0f2fe`, so a brush or lasso filled with it would hide the points it covers (the SVG sits over the canvas). The fill keeps today's 15 % translucency as `color-mix(in srgb, var(--ps-accent) 15%, transparent)`: the same look in light (`#007ab5` at 15 % for `#0072b5` at 15 %) and the dark accent at 15 % in dark.

**Tests:**

- `scatter-plot.theme.browser.test.ts`: in dark, "the brush selection and lasso stroke with the dark accent"; "the EAT connector reads #94a3b8 and the endpoint #2dd4bf"; "the spiderfy node rim is the dark plot background"; "the plot indicator and connector chip sit on the dark raised surface with light text"; "the tooltip card is dark with readable text and the EAT bar violet-400"; one light case each pins the light values unchanged ("in light the connector stays #475569 and the endpoint #0f766e"; "in light the tooltip stays white with the violet-600 EAT bar").
- `projection-metadata.theme.browser.test.ts`: "in dark the card is the raised surface and its text the dark text tokens" (mounted in the light DOM under a `data-theme='dark'` root, as in the app); "in light it keeps the light card".
- `style-lint.test.ts`: the new checks pass for the three cleaned modules and fail for a sample with `var(--surface)` or `#fff` (one expectation added to the first "flags…" test); "%s still holds a colour" passes for the four `STILL_COLOURED` modules.
- Unrun at task time (exit): `eat-visualization.spec.ts` (connectors, endpoint), `multi-annotation-tooltip.spec.ts`, `mobile-plot-touch.spec.ts` (touch card), `zoom-indicator.spec.ts`, `brush-selection.spec.ts`, `glyph-outline` (opt-in).

LEGACY count: 7 (each of the three modules still has literal font sizes or reads a `tokens.ts` non-colour alias, so the last LEGACY test keeps them listed). `STILL_COLOURED`: 4.

- [ ] **Step 1: Write the failing colour-only lint**

In `packages/core/src/styles/style-lint.test.ts`:

(a) Replace the `RUNTIME_VARS` comment and declaration (currently

```ts
/** Set at run time by kit code (position.ts) and the query pickers (picker-placement.ts), not tokens. */
const RUNTIME_VARS = new Set(['--available-height', '--available-width', '--picker-room']);
```

) with:

```ts
/**
 * Set at run time, not tokens: by kit code (position.ts), the query pickers (picker-placement.ts)
 * and the plot's tooltip placement (tooltips/tooltip-position.ts).
 */
const RUNTIME_VARS = new Set([
  '--available-height',
  '--available-width',
  '--picker-room',
  '--protspace-tooltip-max-height',
  '--protspace-tooltip-effective-width',
]);
```

(b) Directly after the `cssOf` function (it ends with `.join('\n');\n}`), add:

```ts
/** Each sheet a module exports by name (tokens, overlayMixins, srOnlyMixin…), mapped to that module. */
const OWNER = new Map<unknown, string>();
for (const [path, exports] of Object.entries(MODULES)) {
  for (const value of Object.values(exports)) if (!Array.isArray(value)) OWNER.set(value, path);
}

/**
 * The CSS a module writes itself. A stylesheet that composes another module's named sheet
 * (scatter-plot.styles.ts composes tokens and overlayMixins) does not answer for it: that sheet is
 * checked as its own module.
 */
function ownCssOf(path: string): string {
  return Object.values(MODULES[path] ?? {})
    .flatMap(flatten)
    .filter((sheet) => (OWNER.get(sheet) ?? path) === path)
    .map((sheet) => sheet.cssText)
    .join('\n');
}

const STRIP_COMMENTS = /\/\*[\s\S]*?\*\//g;
/** Every custom property tokens.ts declares; phase 8 deletes the module. */
const LEGACY_VARS = new Map(
  [...cssOf('./tokens.ts').replace(STRIP_COMMENTS, '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)].map(
    ([, name, value]) => [name, value.trim()] as const,
  ),
);
/** The tokens.ts properties that hold a colour: always light, so reading one breaks dark mode. */
const COLOUR_ALIASES = new Set(
  [...LEGACY_VARS].filter(([, value]) => COLOUR.test(value)).map(([name]) => name),
);

/**
 * The colour half of cssViolations, for modules still in LEGACY: a declaration that hard-codes a
 * colour, reads a tokens.ts colour alias, or reads a variable nothing defines (theme.ts,
 * RUNTIME_VARS, tokens.ts or the module itself). Literal font sizes and tokens.ts's non-colour
 * aliases (z-index, spacing, fonts) wait for phase 8.
 */
function colourViolations(cssText: string): string[] {
  const declarations = [
    ...cssText.replace(STRIP_COMMENTS, '').matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g),
  ].map(([, property, raw]) => [property, raw.trim()] as const);
  const own = new Set(
    declarations.map(([property]) => property).filter((property) => property.startsWith('--')),
  );
  const known = (name: string) =>
    !COLOUR_ALIASES.has(name) &&
    (DEFINED.has(name) || RUNTIME_VARS.has(name) || LEGACY_VARS.has(name) || own.has(name));
  return declarations
    .filter(
      ([, value]) =>
        COLOUR.test(value) ||
        [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, name]) => !known(name)),
    )
    .map(([property, value]) => `${property}: ${value}`);
}

/**
 * LEGACY modules that still hold a colour. A task that takes a module's last colour out deletes
 * its line: "still holds a colour" fails for a clean entry, so this list only shrinks.
 */
const STILL_COLOURED = new Set<string>([
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
  './tokens.ts',
]);
```

`OWNER`, `ownCssOf`, `LEGACY_VARS`, `COLOUR_ALIASES` and `colourViolations` must sit after `MODULES`, `COLOUR`, `RUNTIME_VARS`, `DEFINED`, `flatten` and `cssOf` (they read them at module load).

(c) In the first test, `it('flags raw colours, literal font sizes, stray tokens and unknown variables', …)`, add after its last `expect(…).toEqual([…]);` (the one ending `'gap: var(--spacing-sm)',\n    ]);`):

```ts
    // The colour-only check: tokens.ts colour aliases and undefined variables fail; its other
    // aliases, literal font sizes and the module's own properties pass.
    expect(
      colourViolations(
        '.a { color: var(--surface); background: #fff; border-color: var(--nowhere); gap: var(--spacing-sm); font-size: 12px; --gap: 2px; margin: var(--gap); max-height: var(--available-height); }',
      ),
    ).toEqual(['color: var(--surface)', 'background: #fff', 'border-color: var(--nowhere)']);
```

(d) Directly before the last test, `it.each([...LEGACY])('%s still needs its legacy exemption', …)`, add:

```ts
  it.each(paths.filter((path) => LEGACY.has(path) && !STILL_COLOURED.has(path)))(
    '%s hard-codes no colour',
    (path) => {
      expect(colourViolations(ownCssOf(path))).toEqual([]);
    },
  );

  it.each([...STILL_COLOURED])('%s still holds a colour', (path) => {
    expect(MODULES[path], `${path} no longer exists; delete it from STILL_COLOURED`).toBeDefined();
    expect(
      colourViolations(ownCssOf(path)).length,
      `${path} is colour-free; delete it from STILL_COLOURED`,
    ).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the lint to see it fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: FAIL in exactly three tests, "…/projection-metadata.styles.ts hard-codes no colour", "…/scatter-plot.styles.ts hard-codes no colour" and "…/protein-tooltip.styles.ts hard-codes no colour", each listing declarations such as `background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95))`, `color: #475569`, `color: var(--text-primary)` and, for the scatter plot, `--protspace-selection-color: #ff8a3d` and `stroke: #0f766e`. The "flags…" test, the four "still holds a colour" tests and every other test pass. If the scatter plot's list contains `rgba(255, 255, 255, 0.8)` or `var(--surface)` declarations from `overlayMixins` or `tokens`, `ownCssOf` is not excluding composed sheets: fix that first.

- [ ] **Step 3: Write the failing browser tests**

(a) In `packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts` (created by Task 6.4), merge these names into the file's imports, adding only those it does not import yet (Task 6.4 already imports from `vitest` and imports `adoptTheme`):

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptStyles } from 'lit';
import type { TooltipView } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { scatterplotStyles } from './scatter-plot.styles';
import './tooltips/protein-tooltip';
```

Then append at the end of the file (the new top-level names are `overlayChannels`, `overlayProbe`, `TOOLTIP_VIEW`, `mountTooltip` and `styleOf`; if Task 6.4's code already declares one of them, rename the new one throughout this block):

```ts
/** `rgb()`/`rgba()` or Chrome's `color(srgb … / a)` (a computed color-mix) as [r, g, b, alpha]. */
function overlayChannels(value: string): [number, number, number, number] {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255));
    return [r, g, b, Number(srgb[4] ?? 1)];
  }
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)];
  throw new Error(`Unparsed colour: ${value}`);
}

/**
 * A host carrying the plot's own stylesheet (scatterplotStyles, as the plot's shadow root adopts
 * it) with the marks the plot draws over its points, so each overlay's colour is read without a
 * dataset or WebGL.
 */
function overlayProbe(): ShadowRoot {
  const host = document.createElement('div');
  host.className = 'overlay-probe';
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, scatterplotStyles);
  root.innerHTML = `
    <svg width="200" height="200">
      <g class="brush-container"><rect class="selection" width="20" height="20"></rect></g>
      <path class="lasso-path" d="M0 0 L20 20 L0 20 Z"></path>
      <line class="eat-provenance-connector" x1="0" y1="0" x2="20" y2="20"></line>
      <circle class="eat-provenance-endpoint" cx="10" cy="10" r="4"></circle>
      <circle class="dup-spiderfy-node-circle" cx="30" cy="30" r="4"></circle>
    </svg>
    <div class="plot-indicator">1,000 points</div>
    <div class="connector-status"><span>2 connectors off screen</span><button type="button">×</button></div>`;
  document.body.append(host);
  return root;
}

const TOOLTIP_VIEW: TooltipView = {
  proteinId: 'P12345',
  geneName: ['KIN1'],
  proteinName: ['Serine kinase'],
  uniprotKbId: ['KIN1_HUMAN'],
  blocks: [
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

/** A hover tooltip with an EAT-transferred annotation, as the plot shows it. */
async function mountTooltip(): Promise<ShadowRoot> {
  const tooltip = document.createElement('protspace-protein-tooltip');
  tooltip.view = TOOLTIP_VIEW;
  tooltip.className = 'visible';
  document.body.append(tooltip);
  await tooltip.updateComplete;
  return tooltip.shadowRoot!;
}

const styleOf = (root: ShadowRoot, selector: string) =>
  getComputedStyle(root.querySelector(selector)!);

describe('plot overlays, chips and tooltip follow the theme', () => {
  beforeAll(() => adoptTheme());
  afterEach(() => {
    document.querySelectorAll('.overlay-probe, protspace-protein-tooltip').forEach((el) => el.remove());
    document.documentElement.removeAttribute('data-theme');
  });

  it('the brush selection and lasso stroke with the dark accent', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    for (const selector of ['.brush-container rect.selection', '.lasso-path']) {
      // sky-400, the dark --ps-accent.
      expect(styleOf(root, selector).stroke).toBe('rgb(56, 189, 248)');
      const [r, g, b, alpha] = overlayChannels(styleOf(root, selector).fill);
      expect([r, g, b]).toEqual([56, 189, 248]);
      // Translucent, so the points under a brush stay visible.
      expect(alpha).toBeCloseTo(0.15, 2);
    }
  });

  it('the EAT connector reads #94a3b8 and the endpoint #2dd4bf', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    expect(styleOf(root, '.eat-provenance-connector').stroke).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.eat-provenance-endpoint').stroke).toBe('rgb(45, 212, 191)');
  });

  it('in light the connector stays #475569 and the endpoint #0f766e', () => {
    const root = overlayProbe();
    expect(styleOf(root, '.eat-provenance-connector').stroke).toBe('rgb(71, 85, 105)');
    expect(styleOf(root, '.eat-provenance-endpoint').stroke).toBe('rgb(15, 118, 110)');
  });

  it('the spiderfy node rim is the dark plot background', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    // #0b1120, the dark --ps-plot-bg.
    expect(styleOf(root, '.dup-spiderfy-node-circle').stroke).toBe('rgb(11, 17, 32)');
  });

  it('the plot indicator and connector chip sit on the dark raised surface with light text', () => {
    document.documentElement.dataset.theme = 'dark';
    const root = overlayProbe();
    const indicator = styleOf(root, '.plot-indicator');
    const chip = styleOf(root, '.connector-status');
    // #162036, the dark --ps-surface-raised; #1e293b, the dark --ps-border.
    expect(indicator.backgroundColor).toBe('rgb(22, 32, 54)');
    expect(indicator.borderTopColor).toBe('rgb(30, 41, 59)');
    expect(indicator.color).toBe('rgb(148, 163, 184)');
    expect(chip.backgroundColor).toBe('rgb(22, 32, 54)');
    expect(chip.color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, '.connector-status button').color).toBe('rgb(148, 163, 184)');
  });

  it('the tooltip card is dark with readable text and the EAT bar violet-400', async () => {
    document.documentElement.dataset.theme = 'dark';
    const root = await mountTooltip();
    expect(styleOf(root, '.tooltip').backgroundColor).toBe('rgb(22, 32, 54)');
    expect(styleOf(root, '.tooltip').borderTopColor).toBe('rgb(30, 41, 59)');
    // #131d33, the dark --ps-surface-muted, under the dark --ps-text.
    expect(styleOf(root, '.tooltip-header').backgroundColor).toBe('rgb(19, 29, 51)');
    expect(styleOf(root, '.tooltip-protein-id').color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, '.tooltip-annotation-header').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.tooltip-annotation').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.eat-confidence-track > span').backgroundColor).toBe(
      'rgb(167, 139, 250)',
    );
  });

  it('in light the tooltip stays white with the violet-600 EAT bar', async () => {
    const root = await mountTooltip();
    expect(styleOf(root, '.tooltip').backgroundColor).toBe('rgb(255, 255, 255)');
    expect(styleOf(root, '.tooltip-protein-id').color).toBe('rgb(15, 23, 42)');
    expect(styleOf(root, '.eat-confidence-track > span').backgroundColor).toBe(
      'rgb(124, 58, 237)',
    );
  });
});
```

(b) Create `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Projection } from '@protspace/utils';
import { adoptTheme } from '../../kit/adopt-theme';
import './projection-metadata';

type ProjectionMetadataElement = HTMLElement & {
  projection: Projection | null;
  updateComplete: Promise<unknown>;
};

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

/**
 * The card as the view bar holds it: in the page's light DOM, so its text inherits the page's
 * theme and its own background must follow too.
 */
async function mount(): Promise<ShadowRoot> {
  const el = document.createElement('protspace-projection-metadata') as ProjectionMetadataElement;
  el.projection = {
    name: 'ProtT5 — UMAP 2',
    metadata: {
      n_components: 2,
      quality: {
        knn_overlap: { value: 0.57, scope: 'local', k: 15, seed: 42, sampled: false },
      },
    },
  } as Projection;
  document.body.append(el);
  await el.updateComplete;
  return el.shadowRoot!;
}

const styleOf = (root: ShadowRoot, selector: string) =>
  getComputedStyle(root.querySelector(selector)!);

describe('protspace-projection-metadata theme', () => {
  it('in dark the card is the raised surface and its text the dark text tokens', async () => {
    document.documentElement.dataset.theme = 'dark';
    const root = await mount();
    // #162036 --ps-surface-raised, #1e293b --ps-border, #131d33 --ps-surface-muted.
    expect(styleOf(root, '.content').backgroundColor).toBe('rgb(22, 32, 54)');
    expect(styleOf(root, '.content').borderTopColor).toBe('rgb(30, 41, 59)');
    expect(styleOf(root, '.header').backgroundColor).toBe('rgb(19, 29, 51)');
    // #f1f5f9 --ps-text, #94a3b8 --ps-text-muted.
    expect(styleOf(root, '.header').color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, 'dt').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, 'dd').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.section-heading').color).toBe('rgb(148, 163, 184)');
    // The caption tier is the 11 px token, which also resolves in the light DOM.
    expect(styleOf(root, '.section-heading').fontSize).toBe('11px');
  });

  it('in light it keeps the light card', async () => {
    const root = await mount();
    expect(styleOf(root, '.content').backgroundColor).toBe('rgb(255, 255, 255)');
    expect(styleOf(root, '.header').backgroundColor).toBe('rgb(248, 250, 252)');
    expect(styleOf(root, '.header').color).toBe('rgb(15, 23, 42)');
    expect(styleOf(root, 'dt').color).toBe('rgb(71, 85, 105)');
  });
});
```

- [ ] **Step 4: Run the browser tests to see them fail**

Run (sandbox disabled; browser mode listens on a local port): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/scatter-plot.theme.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts`
Expected: Task 6.4's cases pass. New FAILs: the brush/lasso test (stroke `rgb(0, 114, 181)`), the dark EAT test (`rgb(71, 85, 105)`, the light connector), the spiderfy test (`rgba(255, 255, 255, 0.95)`), the chips test (`rgba(255, 255, 255, 0.95)`), the dark tooltip test (`rgba(255, 255, 255, 0.95)`), both projection-card tests (the dark card is `rgba(255, 255, 255, 0.95)`; the light header colour is inherited, not `rgb(15, 23, 42)`). The two light plot cases already pass (the light values do not move).

- [ ] **Step 5: Add the three tokens**

In `packages/core/src/styles/theme.ts`, at the end of `lightRoles` (after the `--ps-plot-*` lines Task 6.4 added, before the closing backtick), add:

```css
  --ps-plot-connector: #475569; /* slate-600: EAT connector lines on the plot */
  --ps-eat: #7c3aed; /* violet-600: the EAT reliability bar in the tooltip */
  --ps-eat-endpoint: #0f766e; /* teal-700: the ring on an EAT connector's source */
```

and at the end of `darkRoles` (after its `--ps-plot-*` lines):

```css
  --ps-plot-connector: #94a3b8; /* slate-400 */
  --ps-eat: #a78bfa; /* violet-400 */
  --ps-eat-endpoint: #2dd4bf; /* teal-400 */
```

- [ ] **Step 6: Move the scatter plot's stylesheet to tokens**

Replace the whole content of `packages/core/src/components/scatter-plot/scatter-plot.styles.ts` with the file below. Against Task 6.4's version it changes only the `:host` custom properties (every colour property goes; `background: var(--ps-plot-bg)` stays as 6.4 set it), the host border, the brush and lasso, `.plot-indicator`, the two spiderfy rules, the two EAT rules and the three `.connector-status` colour rules. If 6.4 left anything else in the file different from this listing, keep 6.4's version of that part and report it.

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
    width: var(--protspace-width);
    height: var(--protspace-height);
    position: relative;
    background: var(--ps-plot-bg);
    border: 1px solid var(--ps-border);
    border-radius: var(--protspace-border-radius);
    overflow: hidden;
    margin: 0;
    padding: 0;
  }

  .container {
    width: 100%;
    height: 100%;
    position: relative;
    margin: 0;
    padding: 0;
  }

  svg,
  canvas {
    position: absolute;
    top: 0;
    left: 0;
  }

  svg {
    z-index: var(--z-svg);
    pointer-events: all;
    /* d3-zoom pans and pinches the plot; the browser must not also scroll or zoom the page. */
    touch-action: none;
  }

  canvas {
    z-index: var(--z-canvas);
    pointer-events: none;
  }

  /* Duplicate badges, spiderfied stacks and EAT connectors already sit at the
     new projection's positions; hide them while the points glide there. */
  :host([data-morphing]) .badges-canvas,
  :host([data-morphing]) .overlay-container {
    opacity: 0;
  }

  /* D3 brush (drag-to-select rectangle). The fill is the accent at 15 %, not --ps-accent-tint:
     the light tint is opaque and would hide the points under the brush. */
  .brush-container rect.selection {
    fill: color-mix(in srgb, var(--ps-accent) 15%, transparent);
    stroke: var(--ps-accent);
    stroke-width: var(--protspace-brush-stroke-width);
    /* Keep the outline thin even when the brush group is scaled by zoom transforms */
    vector-effect: non-scaling-stroke;
    shape-rendering: crispEdges;
  }

  .brush-container rect.overlay {
    cursor: crosshair;
  }

  .brush-container .handle {
    /* If anything renders, hide it — selection should be just a simple rectangle. */
    display: none;
  }

  /* Lasso (freeform selection path) */
  .lasso-path {
    fill: color-mix(in srgb, var(--ps-accent) 15%, transparent);
    stroke: var(--ps-accent);
    stroke-width: var(--protspace-brush-stroke-width);
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
    vector-effect: non-scaling-stroke;
  }

  /* Base loading overlay styles provided by overlayMixins */
  .loading-spinner {
    /* Override size from base mixin */
    width: 3rem;
    height: 3rem;
  }

  /* Small status chips overlaid on the plot (visible point count bottom-left,
     numeric recompute notice bottom-right). Same card look as the top-left
     projection-metadata trigger. */
  .plot-indicator {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    height: 2rem;
    padding: 0 0.625rem;
    box-sizing: border-box;
    background: var(--ps-surface-raised);
    border: 1px solid var(--ps-border);
    box-shadow: var(--ps-shadow-md);
    color: var(--ps-text-muted);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    letter-spacing: 0.01em;
    border-radius: 0.375rem;
    pointer-events: none;
    user-select: none;
  }

  /* Duplicate stack spiderfy UI (SVG overlay) */

  .dup-spiderfy {
    pointer-events: all;
  }

  .dup-spiderfy-line {
    stroke: color-mix(in srgb, var(--ps-text) 35%, transparent);
    stroke-width: 1px;
    pointer-events: none;
  }

  .dup-spiderfy-node {
    cursor: pointer;
    pointer-events: all;
  }

  /* The rim separates a node from the points behind it, so it is the plot's own background. */
  .dup-spiderfy-node-circle {
    stroke: var(--ps-plot-bg);
    stroke-width: 1.5px;
    pointer-events: all;
    cursor: pointer;
  }

  /* EAT provenance connectors (SVG overlay). Positions inherit the parent zoom transform. */
  .connector-lines-layer {
    pointer-events: none;
  }

  .eat-provenance-connector {
    stroke: var(--ps-plot-connector);
    stroke-linecap: round;
    opacity: 0.82;
  }

  .eat-provenance-endpoint {
    fill: none;
    stroke: var(--ps-eat-endpoint);
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
  }

  .connector-status {
    position: absolute;
    top: var(--ps-space-2);
    left: 50%;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    max-width: min(32rem, calc(100% - 2rem));
    padding: 0.25rem 0.375rem 0.25rem 0.625rem;
    box-sizing: border-box;
    transform: translateX(-50%);
    background: var(--ps-surface-raised);
    border: 1px solid var(--ps-border);
    box-shadow: var(--ps-shadow-md);
    color: var(--ps-text);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    border-radius: 0.375rem;
  }

  .connector-status span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connector-status button {
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--ps-text-muted);
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .connector-status button:hover,
  .connector-status button:focus-visible {
    background: var(--ps-surface-hover);
    color: var(--ps-text);
    outline: none;
  }
`;

export const scatterplotStyles = [tokens, overlayMixins, scatterplotStylesCore];
```

- [ ] **Step 7: Move the protein tooltip to tokens**

In `packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts`, change only these declarations (each anchored by its rule's selector; nothing else in the file changes):

| Rule | Old | New |
| --- | --- | --- |
| `.tooltip` | `background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));` | `background: var(--ps-surface-raised);` |
| `.tooltip` | `border: 1px solid var(--protspace-tooltip-border, #d9e2ec);` | `border: 1px solid var(--ps-border);` |
| `.tooltip` | the three-line `box-shadow:` declaration (`var(--protspace-tooltip-shadow, …)`, `0 10px 40px rgba(0, 0, 0, 0.1);`) | `box-shadow: var(--ps-shadow-md);` |
| `.tooltip-header` | `color: #334155;` / `border-bottom: 1px solid #e2e8f0;` / `background: #f8fafc;` | `color: var(--ps-text);` / `border-bottom: 1px solid var(--ps-border);` / `background: var(--ps-surface-muted);` |
| `.tooltip-protein-id` | `color: #0f172a;` | `color: var(--ps-text);` |
| `.tooltip-uniprot-separator` | `color: #94a3b8;` | `color: var(--ps-text-faint);` (a decorative "·") |
| `.tooltip-uniprot-id` | `color: #475569;` | `color: var(--ps-text-muted);` |
| `.tooltip-gene-name` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.tooltip-protein-name` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.tooltip-content .label` | `color: #334155;` | `color: var(--ps-text);` |
| `.tooltip-annotations` | `border-top: 1px solid #f1f5f9;` | `border-top: 1px solid var(--ps-border);` |
| `.tooltip-annotation-header` | `color: #94a3b8;` | `color: var(--ps-text-muted);` (readable text: was 2.6:1 on white) |
| `.tooltip-annotation` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.tooltip-annotation-score` | `color: #94a3b8;` | `color: var(--ps-text-muted);` |
| `.tooltip-annotation-raw-label` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.tooltip-annotation-raw-value` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.tooltip-annotation-evidence` | `color: #94a3b8;` | `color: var(--ps-text-muted);` |
| `.eat-provenance` | `background: #f8fafc;` | `background: var(--ps-surface-muted);` |
| `.eat-provenance-heading, .eat-provenance-source` | `color: #475569;` | `color: var(--ps-text-muted);` |
| `.eat-provenance-source` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.eat-confidence-track` | `background: #e2e8f0;` | `background: var(--ps-border-strong);` |
| `.eat-confidence-track > span` | `background: #7c3aed;` | `background: var(--ps-eat);` |
| `.tooltip-primary` | `border-top: 1px solid #f1f5f9;` / `color: #334155;` | `border-top: 1px solid var(--ps-border);` / `color: var(--ps-text);` |

After the edit, `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(|protspace-tooltip-(bg|border|shadow)" packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts` prints nothing.

- [ ] **Step 8: Move the projection card to tokens**

In `packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts`, change only these declarations (each anchored by its rule's selector):

| Rule | Old | New |
| --- | --- | --- |
| `.content` | `background: var(--protspace-tooltip-bg, rgba(255, 255, 255, 0.95));` | `background: var(--ps-surface-raised);` |
| `.content` | `border: 1px solid var(--protspace-tooltip-border, #d9e2ec);` | `border: 1px solid var(--ps-border);` |
| `.content` | the three-line `box-shadow:` declaration | `box-shadow: var(--ps-shadow-md);` |
| `.header` | `color: var(--text-primary);` / `border-bottom: 1px solid #e2e8f0;` / `background: #f8fafc;` | `color: var(--ps-text);` / `border-bottom: 1px solid var(--ps-border);` / `background: var(--ps-surface-muted);` |
| `dt` | `color: #475569;` | `color: var(--ps-text-muted);` |
| `dd` | `color: #64748b;` | `color: var(--ps-text-muted);` |
| `.scope-heading, .section-scope, .card-scope` | `color: var(--text-muted);` / `font-size: var(--text-caption);` | `color: var(--ps-text-muted);` / `font-size: var(--ps-text-xs);` |
| `.annotation-stats` | `color: #475569;` | `color: var(--ps-text-muted);` |
| `.stat-heading` | `color: var(--text-primary);` | `color: var(--ps-text);` |
| `.stat-annotation-chip` | `background: #eef2f7;` / `color: var(--text-primary);` | `background: var(--ps-surface-hover);` / `color: var(--ps-text);` |
| `.stat-group-label, .stat-caveat` | `color: var(--text-muted);` / `font-size: var(--text-caption);` | `color: var(--ps-text-muted);` / `font-size: var(--ps-text-xs);` |
| `.stat-metric-embedding` (the rule whose only declaration is the colour) | `color: var(--text-muted);` | `color: var(--ps-text-muted);` |
| `.recovers-meta` | `color: var(--panel-text-muted, #94a3b8);` | `color: var(--ps-text-muted);` |
| `.recovers-coverage` | `color: var(--panel-text-muted, #94a3b8);` / `font-size: var(--text-caption, 0.6875rem);` | `color: var(--ps-text-muted);` / `font-size: var(--ps-text-xs);` |
| `.recovers-more` | `color: var(--protspace-highlight-color, #00a3e0);` / `font-size: var(--text-caption, 0.6875rem);` | `color: var(--ps-accent-text);` / `font-size: var(--ps-text-xs);` |
| `.stat-direction` | `color: var(--text-muted);` | `color: var(--ps-text-muted);` |
| `.section-heading` | `font-size: var(--text-caption);` / `color: var(--text-secondary);` | `font-size: var(--ps-text-xs);` / `color: var(--ps-text-muted);` |
| `.stat-columns span` | `font-size: var(--text-caption);` / `color: var(--text-secondary);` | `font-size: var(--ps-text-xs);` / `color: var(--ps-text-muted);` |

After the edit, `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(|var\(--(text|panel|protspace)-" packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts` prints nothing. (`--text-caption` was never declared in the light DOM where this element sits, so captions fell back to the inherited size; `--ps-text-xs` is the 11 px the token meant.)

- [ ] **Step 9: Document the change**

In `docs/developers/style-architecture.md`:

(a) In the Component Prefixes table, change the row

```
| Scatter-plot         | `--protspace-*`        |
```

to

```
| Scatter-plot         | `--protspace-*` (sizes only) |
```

and let Prettier re-align the table (`pnpm exec prettier --write docs/developers/style-architecture.md`).

(b) Directly before the `### Component Prefixes` heading, add:

```md
The scatter plot no longer has colour properties: its background, border, brush and lasso, the
overlay chips, EAT connectors and spiderfy marks, the protein tooltip and the projection card
read `--ps-*` tokens (`--ps-plot-bg`, `--ps-accent`, `--ps-surface-raised`, `--ps-plot-connector`,
`--ps-eat`, `--ps-eat-endpoint` and the role colours), so setting those on `:root` restyles it in
both themes. A host-declared colour property would block the theme, so none is offered. Its
remaining `--protspace-*` properties are sizes, opacities and timings.
```

- [ ] **Step 10: Run the task's tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/styles/theme.test.ts src/styles/styles-integrity.test.ts src/components/scatter-plot/tooltips/tooltip-position.test.ts src/components/scatter-plot/scatter-plot.provenance.test.ts`
Expected: PASS. The style lint's three "hard-codes no colour" tests and four "still holds a colour" tests pass, "uses every token theme.ts defines" passes (each new token has a reader), and all seven "still needs its legacy exemption" tests still pass (literal font sizes and `tokens.ts` non-colour reads remain).

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/scatter-plot/scatter-plot.theme.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts src/components/scatter-plot/projection-metadata/projection-metadata.browser.test.ts src/components/scatter-plot/tooltips/protein-tooltip.browser.test.ts src/components/scatter-plot/scatter-plot.tooltip-actions.browser.test.ts`
Expected: PASS, every test (Task 6.4's, the seven new plot-file cases, the two projection-card cases, and the existing tooltip and projection-card tests unchanged). Report the counts before and after.

Run: `pnpm exec prettier --check packages/core/src/styles/theme.ts packages/core/src/styles/style-lint.test.ts packages/core/src/components/scatter-plot/scatter-plot.styles.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts docs/developers/style-architecture.md`
Expected: all files pass (run `--write` on any that do not, then re-check).

No e2e spec runs at task time; the exit runs `eat-visualization.spec.ts`, `multi-annotation-tooltip.spec.ts`, `mobile-plot-touch.spec.ts`, `zoom-indicator.spec.ts` and `brush-selection.spec.ts` first.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/styles/theme.ts packages/core/src/styles/style-lint.test.ts packages/core/src/components/scatter-plot/scatter-plot.styles.ts packages/core/src/components/scatter-plot/tooltips/protein-tooltip.styles.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.styles.ts packages/core/src/components/scatter-plot/scatter-plot.theme.browser.test.ts packages/core/src/components/scatter-plot/projection-metadata/projection-metadata.theme.browser.test.ts docs/developers/style-architecture.md
git commit -m "feat(core): plot overlays, tooltip and projection card on tokens"
```

(Sandbox disabled: the hook needs it.) Report: LEGACY 7, `STILL_COLOURED` 4, the test counts, and that `scatter-plot.ts` was not touched.

### Task 6.7: Legend swatches follow the plot's neutral greys

The legend shows Other and default-coloured N/A with the same themed greys as the plot, and every swatch gets an outline that stays visible on the dark panel. The Other item's data colour unifies with the plot's `#888888`, so light exports' legends match their points.

**Files:**

- Modify: `packages/core/src/styles/theme.ts` (`--ps-swatch-stroke`)
- Modify: `packages/core/src/components/legend/visual-encoding.ts`, `visual-encoding.test.ts` (the only test that pins `#999999` for Other; the other `#999999` literals in legend and plot tests are fixture colours, not the Other encoding, and stay)
- Modify: `packages/core/src/components/legend/legend-row.ts` (swatch classes), `legend/styles/row.ts` (fill and stroke rules)
- Modify: `packages/core/src/components/legend/legend-score-strips.ts`, `legend-score-strips.test.ts`, `category-score-strip.ts`, `category-score-strip.styles.ts` (the Other dot's flag, class and rule; see the note below)
- Create: `packages/core/src/components/legend/legend.theme.browser.test.ts`
- Modify: `docs/explore/legend.md` (the Special Categories table says Other is `#999999`, which becomes false)

Note on the strip's rule: the dots are drawn inside `protspace-score-strip`'s own shadow root, which the legend's `styles/strips.ts` cannot reach, so the `.other` rule goes into the strip's sheet, `category-score-strip.styles.ts` (where its `circle` rules already live). `styles/strips.ts` does not change.

**Interfaces:**

- Consumes: `--ps-plot-other`, `--ps-plot-na` (6.4); `NEUTRAL_VALUE_COLOR` (`scatter-plot/config.ts`, `'#888888'`), `NA_DEFAULT_COLOR` (`'#DDDDDD'`), `isNAValue`, `NA_VALUE`, `LEGEND_VALUES` (`legend/config.ts` re-exports); `renderLegendSymbol(shape, color, size)` (`legend-row.ts:21`), `renderLegendRow(item, view, handlers)` and the types `LegendRowView`, `LegendRowHandlers` (`legend-row.ts`), the Other row's `OTHER_SYMBOL_COLOR` (`legend-row.ts:14`, `'#888'`), `.legend-item.selected .legend-symbol path` (`styles/row.ts:85`); `legendStyles` (`legend.styles.ts`); `ScoreStripPoint` and the strip's `fill="${point.color}"` (`category-score-strip.ts:9-18, :114`), `OTHER_POINT_COLOR` (`legend-score-strips.ts:8`, `'#888'`) and `stripPoints` (`:51-69`); `mountLegendWithScatterplot`, `settleLegend` (`test-support/legend-scatterplot-harness.ts`), `categoricalData`, `TWELVE` (`test-support/legend-fixtures.ts`); `adoptTheme()`; `adoptStyles`, `render` (`lit`).
- Produces:
  - Token `--ps-swatch-stroke` (`#394150` / `#94a3b8`).
  - `visual-encoding.ts`: `OTHER_COLOR = NEUTRAL_VALUE_COLOR`.
  - `renderLegendSymbol(shape, color, size, tone?: 'other' | 'na')`: the SVG keeps its `fill`/`stroke` attributes (the data colour and `LEGEND_STYLES.colors.defaultStroke`); `tone` adds class `swatch-other` or `swatch-na` to the path. The Other row passes `'other'` (its symbol colour attribute becomes `NEUTRAL_VALUE_COLOR`; `OTHER_SYMBOL_COLOR` goes); a row whose item `isNAValue(item.value)` and whose colour equals `NA_DEFAULT_COLOR` case-insensitively passes `'na'`.
  - `styles/row.ts`: `.legend-symbol path:not([fill='none']) { stroke: var(--ps-swatch-stroke); }` (an outline-only shape keeps its colour stroke), `.legend-symbol path.swatch-other { fill: var(--ps-plot-other); }`, `.legend-symbol path.swatch-na { fill: var(--ps-plot-na); }`, placed before the selected rule, which is more specific and still wins.
  - `ScoreStripPoint.other?: true` set for points whose category has no legend row (colour stays `OTHER_POINT_COLOR`, the data grey); the strip adds class `other` to that dot; `category-score-strip.styles.ts` `circle.other { fill: var(--ps-plot-other); }`.

**Tests:**

- `legend.theme.browser.test.ts` (`data-theme='dark'`): "the Other swatch fills with the dark Other grey"; "a default-coloured N/A swatch fills with the dark N/A grey"; "an N/A coloured by the user keeps its colour" (a row drawn by `renderLegendRow` under `legendStyles`, plus a regular category coloured `#DDDDDD`); "a swatch outline reads --ps-swatch-stroke and a selected row's outline is still the accent"; "the score strip's Other dot is the dark Other grey"; one light case: "in light the swatches keep their data colours" (`#888888`, `#dddddd`, outline `#394150`).
- `visual-encoding.test.ts`: "Other's colour is NEUTRAL_VALUE_COLOR".
- `legend-score-strips.test.ts`: the existing "derives one point per scored category…" expects `other: true` on the grey points.
- Unrun at task time (exit): `workbench-legend.spec.ts`, `numeric-binning.spec.ts`, `legend-double-click.spec.ts`, `mobile-legend.spec.ts`, `figure-editor.spec.ts` (legend colours in the figure).

LEGACY count: 7 (as after 6.6). `legend.ts` is not touched.

- [ ] **Step 1: Write the failing unit tests**

(a) In `packages/core/src/components/legend/visual-encoding.test.ts`, add the import

```ts
import { NEUTRAL_VALUE_COLOR } from '../scatter-plot/config';
```

after the `./visual-encoding` import, and replace the first test of `describe('getVisualEncoding', …)`:

```ts
    it('returns special color for Other category', () => {
      const encoding = getVisualEncoding(0, 'Other');
      expect(encoding.color).toBe('#999999');
      expect(encoding.shape).toBe('circle');
    });
```

with:

```ts
    it("Other's colour is NEUTRAL_VALUE_COLOR", () => {
      // The plot draws Other points in this grey, so a light export's legend matches its points.
      const encoding = getVisualEncoding(0, 'Other');
      expect(encoding.color).toBe(NEUTRAL_VALUE_COLOR);
      expect(encoding.shape).toBe('circle');
    });
```

(b) In `packages/core/src/components/legend/legend-score-strips.test.ts`, in the test "derives one point per scored category in the row's colour, grey for a category in Other", change the two `Z` lines:

```ts
      { category: 'Z', value: -0.2, color: '#888', embedding: null },
```

to

```ts
      { category: 'Z', value: -0.2, color: '#888', embedding: null, other: true },
```

and

```ts
      { category: 'Z', value: 2, color: '#888', embedding: null },
```

to

```ts
      { category: 'Z', value: 2, color: '#888', embedding: null, other: true },
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/visual-encoding.test.ts src/components/legend/legend-score-strips.test.ts`
Expected: FAIL in two tests: "Other's colour is NEUTRAL_VALUE_COLOR" (`'#999999'` received, `'#888888'` expected) and "derives one point per scored category…" (the received `Z` points have no `other` property). Every other test passes.

- [ ] **Step 3: Write the failing browser test**

Create `packages/core/src/components/legend/legend.theme.browser.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptStyles, render } from 'lit';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceLegend } from './legend';
import { LEGEND_VALUES, NA_VALUE } from './config';
import { legendStyles } from './legend.styles';
import { renderLegendRow, type LegendRowHandlers, type LegendRowView } from './legend-row';
import './category-score-strip';
import type { LegendItem } from './types';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Ten rows, Other (J, K and L) and an N/A row large enough to stay in the list. */
async function mountLegend(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(
    categoricalData({ [NA_VALUE]: 20, ...TWELVE }),
    'family',
  );
  await settleLegend(legend);
  await frame();
  return legend;
}

const swatch = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<SVGPathElement>(
    `.legend-item[data-value="${value}"] .legend-symbol path`,
  )!;

const noop = () => {};
const HANDLERS: LegendRowHandlers = {
  onClick: noop,
  onDoubleClick: noop,
  onKeyDown: noop,
  onHandleKeyDown: noop,
  onHover: noop,
  onFocus: noop,
  onToggle: noop,
  onMenu: noop,
  onViewOther: noop,
  onNamePointerEnter: noop,
  onPointerDown: noop,
};
const VIEW: LegendRowView = {
  classes: 'legend-item',
  symbolSize: 10,
  tabbable: true,
  draggable: false,
  picked: false,
  hasMenu: true,
};

/** One row as the legend draws it, under the legend's own stylesheet. */
function drawRow(item: LegendItem): SVGPathElement {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, legendStyles);
  document.body.append(host);
  render(renderLegendRow(item, VIEW, HANDLERS), root);
  return root.querySelector<SVGPathElement>('.legend-symbol path')!;
}

const item = (value: string, color: string): LegendItem => ({
  value,
  color,
  shape: 'circle',
  count: 1,
  isVisible: true,
  zOrder: 0,
});

describe('legend swatches in dark', () => {
  it('the Other swatch fills with the dark Other grey', async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    // #64748b, the dark --ps-plot-other: the colour the plot draws Other points in.
    expect(getComputedStyle(swatch(legend, LEGEND_VALUES.OTHER)).fill).toBe('rgb(100, 116, 139)');
  });

  it('a default-coloured N/A swatch fills with the dark N/A grey', async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    const path = swatch(legend, NA_VALUE);
    // The data colour stays light (exports draw it); only the screen follows the theme.
    expect(path.getAttribute('fill')?.toLowerCase()).toBe('#dddddd');
    // #2a3547, the dark --ps-plot-na.
    expect(getComputedStyle(path).fill).toBe('rgb(42, 53, 71)');
  });

  it('an N/A coloured by the user keeps its colour', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(getComputedStyle(drawRow(item(NA_VALUE, '#ff00aa'))).fill).toBe('rgb(255, 0, 170)');
    // A regular category that happens to be the N/A grey is not N/A.
    expect(getComputedStyle(drawRow(item('A', '#DDDDDD'))).fill).toBe('rgb(221, 221, 221)');
  });

  it("a swatch outline reads --ps-swatch-stroke and a selected row's outline is still the accent", async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    // #94a3b8, the dark --ps-swatch-stroke: a dark fill (Kelly's #222222) keeps its edge.
    expect(getComputedStyle(swatch(legend, 'A')).stroke).toBe('rgb(148, 163, 184)');
    legend.shadowRoot!.querySelector('.legend-item[data-value="B"]')!.classList.add('selected');
    // #38bdf8, the dark --ps-accent, 2 px.
    expect(getComputedStyle(swatch(legend, 'B')).stroke).toBe('rgb(56, 189, 248)');
    expect(getComputedStyle(swatch(legend, 'B')).strokeWidth).toBe('2px');
  });

  it("the score strip's Other dot is the dark Other grey", async () => {
    document.documentElement.dataset.theme = 'dark';
    const strip = document.createElement('protspace-score-strip');
    strip.points = [
      { category: 'A', value: 0.5, color: '#ff0000' },
      { category: 'Z', value: -0.2, color: '#888', other: true },
    ];
    strip.label = 'Silhouette';
    document.body.append(strip);
    await strip.updateComplete;
    const [rowDot, otherDot] = strip.shadowRoot!.querySelectorAll('circle');
    expect(getComputedStyle(rowDot).fill).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(otherDot).fill).toBe('rgb(100, 116, 139)');
  });
});

describe('legend swatches in light', () => {
  it('in light the swatches keep their data colours', async () => {
    const legend = await mountLegend();
    expect(getComputedStyle(swatch(legend, LEGEND_VALUES.OTHER)).fill).toBe('rgb(136, 136, 136)');
    expect(getComputedStyle(swatch(legend, NA_VALUE)).fill).toBe('rgb(221, 221, 221)');
    // #394150, LEGEND_STYLES.colors.defaultStroke, the light --ps-swatch-stroke.
    expect(getComputedStyle(swatch(legend, 'A')).stroke).toBe('rgb(57, 65, 80)');
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.theme.browser.test.ts`
Expected: FAIL in four tests: the Other swatch (`rgb(136, 136, 136)`, the `#888` attribute), the default N/A swatch (`rgb(221, 221, 221)`), the outline (`rgb(57, 65, 80)`, the attribute), and the strip's Other dot (`rgb(136, 136, 136)`). "an N/A coloured by the user keeps its colour" and the light test pass already (they pin what must not change). If the N/A test fails on the attribute line instead, the fixture's N/A row did not get `NA_DEFAULT_COLOR`: report the colour it has before going on.

- [ ] **Step 5: Add the swatch outline token**

In `packages/core/src/styles/theme.ts`, at the end of `lightRoles` (after the tokens Task 6.6 added), add:

```css
  --ps-swatch-stroke: #394150; /* a legend swatch's outline: LEGEND_STYLES.colors.defaultStroke */
```

and at the end of `darkRoles`:

```css
  --ps-swatch-stroke: #94a3b8; /* slate-400: keeps a dark swatch's edge on the dark panel */
```

- [ ] **Step 6: Unify the Other colour**

In `packages/core/src/components/legend/visual-encoding.ts`, add after `import { LEGEND_VALUES } from './config';`:

```ts
import { NEUTRAL_VALUE_COLOR } from '../scatter-plot/config';
```

and replace

```ts
/** Fixed color for the synthetic "Other" category. */
const OTHER_COLOR = '#999999';
```

with

```ts
/**
 * Fixed color for the synthetic "Other" category: the plot's Other grey, so a light export's
 * legend matches its points. On screen the swatch shows the themed --ps-plot-other.
 */
const OTHER_COLOR = NEUTRAL_VALUE_COLOR;
```

- [ ] **Step 7: Tone the row swatches**

In `packages/core/src/components/legend/legend-row.ts`:

(a) Replace the `./config` import

```ts
import {
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
```

with

```ts
import { NEUTRAL_VALUE_COLOR } from '../scatter-plot/config';
import {
  isNAValue,
  LEGEND_DEFAULTS,
  LEGEND_STYLES,
  LEGEND_VALUES,
  NA_DEFAULT_COLOR,
  SHAPE_PATH_GENERATORS,
  toDisplayValue,
} from './config';
```

(b) Delete

```ts
/** Other's dot. A literal until phase 6 adds the neutral point tokens. */
const OTHER_SYMBOL_COLOR = '#888';
```

(c) Replace the doc comment and signature of `renderLegendSymbol`

```ts
/**
 * A legend symbol drawn with the same paths as the WebGL shader's shapes. The SVG is the size plus
 * 3 px on each side, room for the selected outline. A selected row's outline comes from CSS
 * (`.legend-item.selected .legend-symbol path`), which beats these attributes.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
): TemplateResult {
```

with

```ts
/**
 * A legend symbol drawn with the same paths as the WebGL shader's shapes. The SVG is the size plus
 * 3 px on each side, room for the selected outline. Its fill and stroke attributes hold the data
 * colours, light, as exports draw them. On screen the row styles outline it with
 * --ps-swatch-stroke, and a `tone` fills Other and a default-coloured N/A with the plot's themed
 * greys (--ps-plot-other, --ps-plot-na). A selected row's outline
 * (`.legend-item.selected .legend-symbol path`) beats both.
 */
export function renderLegendSymbol(
  shape: string | null,
  color: string,
  size: number = LEGEND_DEFAULTS.symbolSize,
  tone?: 'other' | 'na',
): TemplateResult {
```

(d) In the same function's template, change the opening of the `<path` element from

```ts
        <path
          d="${path}"
```

to

```ts
        <path
          class=${tone ? `swatch-${tone}` : nothing}
          d="${path}"
```

(e) In `renderLegendRow`, after `const tabindex = view.tabbable ? '0' : '-1';` add:

```ts
  // A default-coloured N/A follows the themed N/A grey, as the plot's points do (Task 6.3's rule);
  // a colour the user picked, or one a bundle stored, stays as given.
  const naTone =
    isNAValue(item.value) && item.color.toLowerCase() === NA_DEFAULT_COLOR.toLowerCase();
```

and replace

```ts
          >${isOther
            ? renderLegendSymbol('circle', OTHER_SYMBOL_COLOR, view.symbolSize)
            : renderLegendSymbol(item.shape, item.color, view.symbolSize)}</span
```

with

```ts
          >${isOther
            ? renderLegendSymbol('circle', NEUTRAL_VALUE_COLOR, view.symbolSize, 'other')
            : renderLegendSymbol(
                item.shape,
                item.color,
                view.symbolSize,
                naTone ? 'na' : undefined,
              )}</span
```

(Prettier decides the final wrapping.)

(f) In `packages/core/src/components/legend/styles/row.ts`, insert between the `.legend-symbol { … }` rule and the `/* Selected in the plot: … */` comment:

```css
  /* The swatch's attributes hold the data colours (light, as exports draw them). On screen the
     outline and the neutral greys follow the theme: a stylesheet rule beats a presentation
     attribute, and the selected outline below is more specific than these. An outline-only shape
     (fill none) keeps its colour stroke. */
  .legend-symbol path:not([fill='none']) {
    stroke: var(--ps-swatch-stroke);
  }

  .legend-symbol path.swatch-other {
    fill: var(--ps-plot-other);
  }

  .legend-symbol path.swatch-na {
    fill: var(--ps-plot-na);
  }

```

- [ ] **Step 8: Flag the strip's Other dots**

(a) In `packages/core/src/components/legend/category-score-strip.ts`, add to `ScoreStripPoint` after `embedding?: number | null;`:

```ts
  /**
   * The category has no legend row (it sits in Other). Its `color` stays the data grey; on screen
   * the dot takes the themed --ps-plot-other.
   */
  other?: true;
```

and change the dot's class binding

```ts
            class="${point.category === this.highlighted ? 'is-highlighted' : ''}"
```

to

```ts
            class="${[
              point.category === this.highlighted ? 'is-highlighted' : '',
              point.other ? 'other' : '',
            ]
              .join(' ')
              .trim()}"
```

(b) In `packages/core/src/components/legend/category-score-strip.styles.ts`, after the `circle.is-highlighted { … }` rule, add:

```css
    /* A category in Other: the plot's themed Other grey, not the data grey in the attribute. */
    circle.other {
      fill: var(--ps-plot-other);
    }
```

(c) In `packages/core/src/components/legend/legend-score-strips.ts`, replace the comment on `OTHER_POINT_COLOR`

```ts
/** A scored category grouped under Other has no row colour; its dot is grey. */
```

with

```ts
/**
 * A scored category grouped under Other has no row colour; its dot is grey. The point is flagged
 * `other`, and on screen the strip fills it with the themed --ps-plot-other.
 */
```

and in `stripPoints` replace

```ts
    points.push({
      category: score.category,
      value,
      color: colorByValue.get(score.category) ?? OTHER_POINT_COLOR,
      embedding: pickEmbedding?.(score) ?? null,
    });
```

with

```ts
    const rowColor = colorByValue.get(score.category);
    const point: ScoreStripPoint = {
      category: score.category,
      value,
      color: rowColor ?? OTHER_POINT_COLOR,
      embedding: pickEmbedding?.(score) ?? null,
    };
    if (rowColor === undefined) point.other = true;
    points.push(point);
```

- [ ] **Step 9: Correct the user guide's Other colour**

In `docs/explore/legend.md`, Special Categories table, change `| **Other** | \`#999999\` | Circle |` to `| **Other** | \`#888888\` | Circle |` (the table keeps its alignment; both values are seven characters).

- [ ] **Step 10: Run the task's tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/legend/visual-encoding.test.ts src/components/legend/legend-score-strips.test.ts src/components/legend/legend-row.test.ts src/components/legend/category-score-strip.component.test.ts src/components/legend/legend.score-sync.test.ts src/components/legend/legend-data-processor.test.ts src/styles/style-lint.test.ts src/styles/theme.test.ts`
Expected: PASS, including "uses every token theme.ts defines" (`--ps-swatch-stroke` is read by `styles/row.ts`; `--ps-plot-other` and `--ps-plot-na` gain more readers) and every style-lint test with LEGACY 7 and `STILL_COLOURED` 4 unchanged.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/legend/legend.theme.browser.test.ts src/components/legend/legend.styles.browser.test.ts src/components/legend/legend.rows.browser.test.ts src/components/legend/legend.other.browser.test.ts`
Expected: PASS, the six new tests and the existing ones unchanged. Report the counts before and after.

Run: `pnpm exec prettier --check packages/core/src/styles/theme.ts packages/core/src/components/legend/visual-encoding.ts packages/core/src/components/legend/visual-encoding.test.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/styles/row.ts packages/core/src/components/legend/legend-score-strips.ts packages/core/src/components/legend/legend-score-strips.test.ts packages/core/src/components/legend/category-score-strip.ts packages/core/src/components/legend/category-score-strip.styles.ts packages/core/src/components/legend/legend.theme.browser.test.ts docs/explore/legend.md`
Expected: all pass (`--write` any that do not, then re-check).

No e2e spec runs at task time; the exit runs `workbench-legend.spec.ts`, `numeric-binning.spec.ts`, `legend-double-click.spec.ts`, `mobile-legend.spec.ts` and `figure-editor.spec.ts` first.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/styles/theme.ts packages/core/src/components/legend/visual-encoding.ts packages/core/src/components/legend/visual-encoding.test.ts packages/core/src/components/legend/legend-row.ts packages/core/src/components/legend/styles/row.ts packages/core/src/components/legend/legend-score-strips.ts packages/core/src/components/legend/legend-score-strips.test.ts packages/core/src/components/legend/category-score-strip.ts packages/core/src/components/legend/category-score-strip.styles.ts packages/core/src/components/legend/legend.theme.browser.test.ts docs/explore/legend.md
git commit -m "feat(core): legend swatches follow the plot's neutral greys"
```

(Sandbox disabled: the hook needs it.) Report: LEGACY 7, the test counts, and that `legend.ts` was not touched.

### Task 6.8: The structure viewer and Mol* follow the theme

The structure frame, its header, footer, loading veil and segmented colour control read tokens, as do the shared loading and modal overlays. The Mol* canvas takes `--ps-surface` as its background after it is created and whenever the theme changes it. Three more legacy modules become colour-free.

**Files:**

- Modify: `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` (colour `--protspace-viewer-*` properties removed; frame `--ps-surface`), `packages/core/src/styles/mixins.ts` (`segmentedControlMixin`), `packages/core/src/styles/overlay-mixins.ts`
- Modify: `packages/core/src/components/structure-viewer/molstar-loader.ts`, `molstar-loader.test.ts`
- Modify: `packages/core/src/components/structure-viewer/structure-viewer.ts`, `structure-viewer.component.test.ts`, `structure-viewer.browser.test.ts`
- Modify: `packages/core/src/styles/style-lint.test.ts` (`STILL_COLOURED` loses three)
- Modify: `apps/web/tests/helpers/workbench.ts` (`MOLSTAR_STUB` gets `canvas3d`), `apps/web/tests/workbench-structure.spec.ts`
- Modify: `docs/developers/style-architecture.md` (the viewer's colour properties are gone; the component-prefix table)

**Interfaces:**

- Consumes: `observeTheme(onChange: () => void, doc?: Document): () => void` (`packages/core/src/utils/theme-observer.ts`, 6.4; guarded where `matchMedia` is missing, as in jsdom); the colour-only lint, `colourViolations`, `ownCssOf` and `STILL_COLOURED` (6.6); R3's mapping (§2.A structure viewer, `segmentedControlMixin`, `overlay-mixins`) with the frame on `--ps-surface` (Rulings); `createMolstarViewer(container, tedDomains)` and its returned `MolstarViewer` (`molstar-loader.ts:20-29`), the `MolstarPlugin` typing (`:91-128`), `RawMolstarViewer` (`:130-134`); the viewer's creation point in `_loadStructure` (`structure-viewer.ts:260-265`, `this._viewer = viewer;`) and `connectedCallback`/`disconnectedCallback` (`:108-125`); `StructureService.loadStructure` (a static method of `@protspace/utils`' `StructureService`); `stubStructureRequests(page)`, `clickProteinNearPlotCentre(page)` (`helpers/workbench.ts`); `openExplore` (`helpers/explore.ts`); `chooseTheme(page, 'System' | 'Light' | 'Dark')` (`helpers/theme.ts`, 6.2).
- Produces:
  - `MolstarPlugin.canvas3d?: { setProps(props: { renderer: { backgroundColor: number } }): void }`.
  - `MolstarViewer.setBackground(color: number): void` (`plugin.canvas3d?.setProps({ renderer: { backgroundColor: color } })`).
  - `export function molstarColor(css: string): number | null` in `molstar-loader.ts` (`#rrggbb` or `#rgb` → `0xRRGGBB`; `rgb(r g b)` / `rgb(r, g, b)` → the number; anything else `null`).
  - `structure-viewer.ts`: while connected, `observeTheme` → `_applyViewerBackground()`; also called right after `this._viewer = viewer`. `_applyViewerBackground()` reads `getComputedStyle(this).getPropertyValue('--ps-surface')`, returns when no viewer exists or the value is empty (jsdom, a page without the token sheet), converts with `molstarColor`, and calls `setBackground` only when the number differs from the last one applied to that viewer (a `WeakMap<MolstarViewer, number>`).
  - `structure-viewer.styles.ts`, `mixins.ts`, `overlay-mixins.ts`: colour-free per the lint (the plot's loading veil `color-mix(in srgb, var(--ps-surface) 80%, transparent)`, the viewer's `90%`). The segmented control's `--segmented-*` colour hooks go (the viewer's `.color-mode-group` bridge was their only writer); `--segmented-padding-x` stays.
  - `STILL_COLOURED = { './tokens.ts' }`.
  - `MOLSTAR_STUB`: the viewer's `plugin` gets `canvas3d: { setProps(p) { window.__molstarBackground = p.renderer.backgroundColor; } }`.

**Tests:**

- `molstar-loader.test.ts`: "setBackground passes the colour to canvas3d.setProps"; "setBackground without canvas3d does nothing"; "molstarColor reads #0f172a as 0x0f172a, #fff as 0xffffff and rgb(15 23 42) as 0x0f172a, and rejects 'transparent'".
- `structure-viewer.component.test.ts` (jsdom, a stubbed `window.molstar` whose plugin has `canvas3d`, `StructureService.loadStructure` spied, `getComputedStyle` giving a chosen `--ps-surface`): "the background is applied once the viewer is created"; "a theme notification with a new surface applies it once"; "a notification with the same surface applies nothing"; "disconnect stops listening".
- `structure-viewer.browser.test.ts`: "in dark the frame, header and footer read the dark surfaces and text"; "the loading veil is a translucent dark surface in dark".
- `workbench-structure.spec.ts` (this task's e2e, `-g "background"`): "Mol*'s background follows the theme" (`stubStructureRequests`, open a structure, `chooseTheme(page, 'Dark')` → `window.__molstarBackground === 0x0f172a`; `chooseTheme(page, 'Light')` → `0xffffff`).
- Unrun at task time (exit): the rest of `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts` (structure sheet), `mobile-explore-layout.spec.ts` (L2), `workbench-loading.spec.ts` (overlay mixins).

LEGACY count: 7 (each of the three modules still has literal font sizes or reads a `tokens.ts` non-colour alias). `STILL_COLOURED`: 1. Report `wc -l structure-viewer.ts` (625 before).

- [ ] **Step 1: Write the failing Mol* loader tests**

In `packages/core/src/components/structure-viewer/molstar-loader.test.ts`:

(a) Change the import `import { createMolstarViewer } from './molstar-loader';` to:

```ts
import { createMolstarViewer, molstarColor } from './molstar-loader';
```

(b) Inside `describe('Mol* color theme adapter', …)`, after its last test (`it('applies overlapping theme requests in order', …)`, before the describe's closing `});`), add:

```ts
  it('setBackground passes the colour to canvas3d.setProps', async () => {
    const { rawViewer } = installRawViewer(vi.fn(applyThemeUpdate));
    const setProps = vi.fn();
    Object.assign(rawViewer.plugin, { canvas3d: { setProps } });
    const viewer = await createMolstarViewer(document.createElement('div'), domains);

    viewer.setBackground(0x0f172a);

    expect(setProps).toHaveBeenCalledOnce();
    expect(setProps).toHaveBeenCalledWith({ renderer: { backgroundColor: 0x0f172a } });
  });

  it('setBackground without canvas3d does nothing', async () => {
    // A failed WebGL start leaves Mol* without a canvas, as does the e2e stub before this task.
    installRawViewer(vi.fn(applyThemeUpdate));
    const viewer = await createMolstarViewer(document.createElement('div'), domains);
    expect(() => viewer.setBackground(0xffffff)).not.toThrow();
  });
```

(c) At the end of the file, add:

```ts
describe('molstarColor', () => {
  it("reads #0f172a as 0x0f172a, #fff as 0xffffff and rgb(15 23 42) as 0x0f172a, and rejects 'transparent'", () => {
    expect(molstarColor('#0f172a')).toBe(0x0f172a);
    expect(molstarColor(' #FFF ')).toBe(0xffffff);
    expect(molstarColor('rgb(15 23 42)')).toBe(0x0f172a);
    expect(molstarColor('rgb(15, 23, 42)')).toBe(0x0f172a);
    expect(molstarColor('transparent')).toBeNull();
    expect(molstarColor('rgb(15 23 42 / 0.5)')).toBeNull();
    expect(molstarColor('')).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing component tests**

In `packages/core/src/components/structure-viewer/structure-viewer.component.test.ts`:

(a) Add after the `vitest` import:

```ts
import { StructureService, type StructureData } from '@protspace/utils';
```

(b) Append at the end of the file:

```ts
const STRUCTURE: StructureData = {
  proteinId: PROTEIN_ID,
  source: 'alphafold',
  url: 'blob:structure',
  format: 'mmcif',
  isBinary: false,
  tedDomains: [],
  metadata: { confidence: 'high', method: 'predicted', version: 'v6' },
};

describe('protspace-structure-viewer Mol* background', () => {
  // What --ps-surface resolves to on the viewer: jsdom resolves no token, so the test chooses it.
  let surface = '#ffffff';
  const setProps = vi.fn();
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    surface = '#ffffff';
    setProps.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) => {
      const style = realGetComputedStyle(element, pseudo);
      const read = style.getPropertyValue.bind(style);
      style.getPropertyValue = (name: string) => (name === '--ps-surface' ? surface : read(name));
      return style;
    });
    // Mol*'s script and stylesheet count as loaded; window.molstar is a viewer with a canvas.
    for (const [tag, id] of [
      ['script', 'molstar-script'],
      ['link', 'molstar-style'],
    ] as const) {
      const element = document.createElement(tag);
      element.id = id;
      document.head.append(element);
    }
    window.molstar = {
      Viewer: {
        create: vi.fn(async () => ({
          loadStructureFromUrl: vi.fn(async () => undefined),
          dispose: vi.fn(),
          plugin: {
            representation: { structure: { themes: { colorThemeRegistry: { add: vi.fn() } } } },
            canvas3d: { setProps },
          },
        })),
      },
    } as unknown as typeof window.molstar;
    vi.spyOn(StructureService, 'loadStructure').mockResolvedValue({ ...STRUCTURE });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    delete (window as unknown as { molstar?: unknown }).molstar;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A viewer that has loaded a structure, its first background applied. */
  async function mountLoaded() {
    const viewer = document.createElement('protspace-structure-viewer');
    viewer.autoSync = false;
    viewer.proteinId = PROTEIN_ID;
    document.body.appendChild(viewer);
    await vi.waitFor(() => expect(setProps).toHaveBeenCalledOnce());
    return viewer;
  }

  it('the background is applied once the viewer is created', async () => {
    await mountLoaded();
    expect(setProps).toHaveBeenCalledWith({ renderer: { backgroundColor: 0xffffff } });
  });

  it('a theme notification with a new surface applies it once', async () => {
    await mountLoaded();
    surface = '#0f172a';
    document.documentElement.dataset.theme = 'dark';
    await vi.waitFor(() => expect(setProps).toHaveBeenCalledTimes(2));
    expect(setProps).toHaveBeenLastCalledWith({ renderer: { backgroundColor: 0x0f172a } });
    await tick();
    expect(setProps).toHaveBeenCalledTimes(2);
  });

  it('a notification with the same surface applies nothing', async () => {
    await mountLoaded();
    // An attribute change that leaves --ps-surface as it was (System on a light OS, say).
    document.documentElement.dataset.theme = 'system';
    await tick();
    expect(setProps).toHaveBeenCalledOnce();
  });

  it('disconnect stops listening', async () => {
    const viewer = await mountLoaded();
    viewer.remove();
    const apply = vi.spyOn(
      viewer as unknown as { _applyViewerBackground(): void },
      '_applyViewerBackground',
    );
    surface = '#0f172a';
    document.documentElement.dataset.theme = 'dark';
    await tick();
    expect(apply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/molstar-loader.test.ts src/components/structure-viewer/structure-viewer.component.test.ts`
Expected: FAIL: "setBackground passes the colour…" and "setBackground without canvas3d…" (`viewer.setBackground is not a function`), the `molstarColor` test (`molstarColor is not a function`), and the first three background tests (`vi.waitFor` times out: `setProps` is never called). "disconnect stops listening" also times out in `mountLoaded`. Every existing test passes.

- [ ] **Step 4: Write the failing browser tests**

In `packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts`, append at the end of the file:

```ts
/** `rgb()`/`rgba()` or Chrome's `color(srgb … / a)` (a computed color-mix) as [r, g, b, alpha]. */
function channels(value: string): [number, number, number, number] {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255));
    return [r, g, b, Number(srgb[4] ?? 1)];
  }
  const rgb = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)];
  throw new Error(`Unparsed colour: ${value}`);
}

describe('protspace-structure-viewer in dark', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('in dark the frame, header and footer read the dark surfaces and text', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    const root = viewer.shadowRoot!;
    const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
    // #0f172a --ps-surface (the colour Mol*'s canvas takes) and #1e293b --ps-border.
    expect(getComputedStyle(viewer).backgroundColor).toBe('rgb(15, 23, 42)');
    expect(getComputedStyle(viewer).borderTopColor).toBe('rgb(30, 41, 59)');
    expect(style('.viewer-container').backgroundColor).toBe('rgb(15, 23, 42)');
    // #131d33 --ps-surface-muted for the header band and the footer.
    expect(style('.header').backgroundColor).toBe('rgb(19, 29, 51)');
    expect(style('.color-toolbar').backgroundColor).toBe('rgb(19, 29, 51)');
    // #94a3b8 --ps-text-muted.
    expect(style('.color-toolbar').color).toBe('rgb(148, 163, 184)');
    expect(style('.close-button').color).toBe('rgb(148, 163, 184)');
    // The segmented control: #334155 --ps-border-strong, unpressed text muted.
    expect(style('.segmented').borderTopColor).toBe('rgb(51, 65, 85)');
    expect(style('.segmented-btn[aria-pressed="false"]').color).toBe('rgb(148, 163, 184)');
  });

  it('the loading veil is a translucent dark surface in dark', async () => {
    document.documentElement.dataset.theme = 'dark';
    const viewer = await mount();
    // requestAnimationFrame is stubbed, so nothing loads: show the veil as a load does.
    (viewer as unknown as { _isLoading: boolean })._isLoading = true;
    await viewer.updateComplete;
    const veil = viewer.shadowRoot!.querySelector('.loading-overlay')!;
    const [r, g, b, alpha] = channels(getComputedStyle(veil).backgroundColor);
    expect([r, g, b]).toEqual([15, 23, 42]);
    expect(alpha).toBeCloseTo(0.9, 2);
  });
});
```

- [ ] **Step 5: Run them to see them fail**

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts`
Expected: FAIL in the two new tests (the frame is `rgb(255, 255, 255)` from `tokens.ts`'s `--surface`; the veil is `rgba(255, 255, 255, 0.9)`, channels `[255, 255, 255]`). The existing tests pass.

- [ ] **Step 6: Give the Mol\* viewer a background**

In `packages/core/src/components/structure-viewer/molstar-loader.ts`:

(a) In `export interface MolstarViewer`, after `setColorTheme: (mode: StructureColorMode) => Promise<void>;` add:

```ts
  /** Paints the canvas behind the structure (a `0xRRGGBB` number); a no-op without a canvas. */
  setBackground: (color: number) => void;
```

(b) In `interface MolstarPlugin`, after the `managers: { … };` member (before the interface's closing `}`), add:

```ts
  /** The 3D canvas. Absent when WebGL failed to start, and in the e2e stub. */
  canvas3d?: { setProps(props: { renderer: { backgroundColor: number } }): void };
```

(c) Directly before `export async function createMolstarViewer(`, add:

```ts
/**
 * A CSS colour as Mol*'s `Color` (a `0xRRGGBB` number): `#rrggbb`, `#rgb`, `rgb(r g b)` or
 * `rgb(r, g, b)`. Anything else (a keyword, an alpha, a colour function) is `null`.
 */
export function molstarColor(css: string): number | null {
  const value = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return parseInt(digits, 16);
  }
  const rgb = /^rgb\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*\)$/.exec(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.slice(1, 4).map(Number);
  if (r > 255 || g > 255 || b > 255) return null;
  return (r << 16) | (g << 8) | b;
}
```

(d) In `createMolstarViewer`'s returned object, after the `setColorTheme: (mode) => { … },` member, add:

```ts
    setBackground: (color) => {
      plugin.canvas3d?.setProps({ renderer: { backgroundColor: color } });
    },
```

- [ ] **Step 7: Apply it from the viewer, on creation and on theme changes**

In `packages/core/src/components/structure-viewer/structure-viewer.ts`:

(a) Change the `./molstar-loader` import to:

```ts
import {
  createMolstarViewer,
  molstarColor,
  prefetchMolstar,
  type MolstarViewer,
  type StructureColorMode,
} from './molstar-loader';
```

and add after the `../common/resource-links.styles` import:

```ts
import { observeTheme } from '../../utils/theme-observer';
```

(b) After `private _scatterplotElement: Element | null = null;` add:

```ts
  private _stopThemeObserver: (() => void) | null = null;
  /** The background last given to each Mol* viewer, so a theme change that keeps it repaints nothing. */
  private _appliedBackground = new WeakMap<MolstarViewer, number>();
```

(c) In `connectedCallback()`, after `super.connectedCallback();` add:

```ts
    this._stopThemeObserver ??= observeTheme(() => this._applyViewerBackground());
```

(d) In `disconnectedCallback()`, after `super.disconnectedCallback();` add:

```ts
    this._stopThemeObserver?.();
    this._stopThemeObserver = null;
```

(e) In `_loadStructure()`, change

```ts
      this._viewer = viewer;
```

to

```ts
      this._viewer = viewer;
      this._applyViewerBackground();
```

(f) Directly before `private async _displayStructure(`, add:

```ts
  /**
   * Gives the Mol* canvas the panel's surface colour (design decision 16), so the docked and the
   * floating card match their frame in both themes: once per viewer, then again only when a theme
   * change resolves --ps-surface to a different colour. Without the token sheet (jsdom, an
   * embedder that never adopted it) Mol* keeps its own background.
   */
  private _applyViewerBackground(): void {
    const viewer = this._viewer;
    if (!viewer) return;
    const surface = getComputedStyle(this).getPropertyValue('--ps-surface').trim();
    if (!surface) return;
    const color = molstarColor(surface);
    if (color === null || this._appliedBackground.get(viewer) === color) return;
    this._appliedBackground.set(viewer, color);
    viewer.setBackground(color);
  }
```

The early return on an empty `--ps-surface` also keeps `structure-viewer.coloring.test.ts` and `structure-viewer.prefetch.test.ts` working: their `vi.mock('./molstar-loader', …)` factories export neither `molstarColor` nor `setBackground`, and jsdom resolves no token, so neither is reached.

- [ ] **Step 8: Move the viewer, the segmented control and the overlays to tokens**

(a) Replace the whole content of `packages/core/src/components/structure-viewer/structure-viewer.styles.ts` with (only colour declarations change, plus the `.color-mode-group` bridge going; no earlier phase-6 task touches this file):

```ts
import { css } from 'lit';
import { tokens } from '../../styles/tokens';
import { overlayMixins } from '../../styles/overlay-mixins';
import { segmentedControlMixin } from '../../styles/mixins';

const structureViewerStylesCore = css`
  :host {
    /* Sizes only: every colour comes from a --ps-* token (theme.ts), so an embedder restyles the
       viewer in both themes by setting those on :root. The frame is the panel's surface, the
       colour the Mol* canvas also takes, so frame and canvas meet without a seam. */
    --protspace-viewer-width: 100%;
    --protspace-viewer-height: 100%;
    --protspace-viewer-border-radius: 6px;

    display: flex;
    flex-direction: column;
    width: 100%;

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

  /* Touch: the close and protein-pick buttons are 40 px targets (the app's header is 44 px). */
  @media (pointer: coarse) {
    .close-button,
    .protein-pick {
      min-width: var(--ps-touch-target);
      min-height: var(--ps-touch-target);
    }

    .segmented > .segmented-btn {
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

  /* Base loading overlay styles provided by overlayMixins */
  .loading-overlay {
    /* Extend with column layout for text */
    flex-direction: column;
    background: color-mix(in srgb, var(--ps-surface) 90%, transparent);
  }

  .loading-text {
    color: var(--ps-text-muted);
    font-size: 0.875rem;
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
    z-index: var(--z-overlay);
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
    z-index: var(--z-canvas);
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
    font-size: 0.875rem;
  }

  .viewer-content,
  .molstar-mount {
    width: 100%;
    height: 100%;
    border-radius: 0 0 6px 6px;
  }

  .color-toolbar,
  .tips {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ps-surface-muted);
    border-top: 1px solid var(--ps-border);
    color: var(--ps-text-muted);
    font-size: 0.75rem;
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

  /* The TED button's ps-tooltip follows it, so the mixin's :last-child misses its end corners. */
  .segmented > .segmented-btn:has(+ ps-tooltip:last-child) {
    border-top-right-radius: calc(var(--radius) - var(--border-width));
    border-bottom-right-radius: calc(var(--radius) - var(--border-width));
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

  /* Spin animation provided by overlayMixins */

  /* ----------------------------- Responsive ------------------------------------ */

  /* Below desktop the viewer has half a panel row: keep only the colour legend. The host's size
     is the shell's to set (the workbench fills its structure section). */
  @media (max-width: 950px) {
    .interaction-tip {
      display: none;
    }
  }
`;

export const structureViewerStyles = [
  tokens,
  overlayMixins,
  segmentedControlMixin,
  structureViewerStylesCore,
];
```

(The `color-mode-group` class stays on the element in `structure-viewer.ts`; with no rule it is inert.)

(b) In `packages/core/src/styles/mixins.ts`, `segmentedControlMixin`:

- In the doc comment, replace `Colors go through --segmented-* hooks that fall back to tokens.` with `Colours read the --ps-* tokens.`
- `.segmented`: `border: var(--border-width) solid var(--segmented-border, var(--border));` → `border: var(--border-width) solid var(--ps-border-strong);`; `background: var(--segmented-bg, var(--surface));` → `background: var(--ps-surface);`
- `.segmented > .segmented-btn`: `color: var(--segmented-text, var(--text-secondary));` → `color: var(--ps-text-muted);`
- `.segmented > .segmented-btn + .segmented-btn`: `border-left: var(--border-width) solid var(--segmented-border, var(--border));` → `border-left: var(--border-width) solid var(--ps-border-strong);`
- `.segmented > .segmented-btn:hover:not(:disabled):not([aria-pressed='true'])`: `background: var(--segmented-hover-bg, var(--hover-bg-alt));` → `background: var(--ps-surface-hover);`; `color: var(--segmented-hover-text, var(--text-primary));` → `color: var(--ps-text);`
- `.segmented > .segmented-btn:focus-visible`: the `box-shadow` becomes

```css
    box-shadow:
      0 0 0 1px var(--ps-focus),
      0 0 0 3px var(--ps-accent-tint);
```

- `.segmented > .segmented-btn[aria-pressed='true']:focus-visible`: the `box-shadow` becomes

```css
    box-shadow:
      inset 0 0 0 1px var(--ps-text-on-accent),
      0 0 0 1px var(--ps-focus),
      0 0 0 3px var(--ps-accent-tint);
```

Nothing else in `mixins.ts` changes (`--segmented-padding-x`, which `.segmented--icon` declares, stays; `srOnlyMixin` is untouched).

(c) In `packages/core/src/styles/overlay-mixins.ts`, `overlayMixins`:

- `.loading-overlay`: `background: rgba(255, 255, 255, 0.8);` → `background: color-mix(in srgb, var(--ps-surface) 80%, transparent);`
- `.loading-spinner`: `border: 2px solid var(--border);` → `border: 2px solid var(--ps-border);`; `border-top: 2px solid var(--primary);` → `border-top: 2px solid var(--ps-accent);`
- `.modal-overlay`: `background: rgba(0, 0, 0, 0.5);` → `background: var(--ps-scrim);`
- `.modal-content`: `background: var(--surface);` → `background: var(--ps-surface-raised);`; `box-shadow: var(--shadow-lg);` → `box-shadow: var(--ps-shadow-lg);`
- `.tooltip`: `background: rgba(255, 255, 255, 0.95);` → `background: var(--ps-surface-raised);`; `border: var(--border-width) solid var(--border);` → `border: var(--border-width) solid var(--ps-border);`; `box-shadow: var(--shadow-md);` → `box-shadow: var(--ps-shadow-md);`

(d) In `packages/core/src/styles/style-lint.test.ts`, replace the `STILL_COLOURED` declaration Task 6.6 wrote:

```ts
const STILL_COLOURED = new Set<string>([
  '../components/structure-viewer/structure-viewer.styles.ts',
  './mixins.ts',
  './overlay-mixins.ts',
  './tokens.ts',
]);
```

with

```ts
const STILL_COLOURED = new Set<string>(['./tokens.ts']);
```

- [ ] **Step 9: Give the e2e Mol\* stub a canvas, and write the e2e test**

(a) In `apps/web/tests/helpers/workbench.ts`, replace `MOLSTAR_STUB`:

```ts
/** Mol*'s global, with a viewer that loads nothing and draws nothing. */
const MOLSTAR_STUB = `window.molstar = { Viewer: { create: async () => ({
  plugin: { representation: { structure: { themes: { colorThemeRegistry: { add() {} } } } } },
  loadStructureFromUrl: async () => {},
  dispose() {},
}) } };`;
```

with

```ts
/**
 * Mol*'s global, with a viewer that loads nothing and draws nothing. Its canvas records the last
 * background the viewer set in `window.__molstarBackground` (a 0xRRGGBB number).
 */
const MOLSTAR_STUB = `window.molstar = { Viewer: { create: async () => ({
  plugin: {
    representation: { structure: { themes: { colorThemeRegistry: { add() {} } } } },
    canvas3d: { setProps(p) { window.__molstarBackground = p.renderer.backgroundColor; } },
  },
  loadStructureFromUrl: async () => {},
  dispose() {},
}) } };`;
```

(b) In `apps/web/tests/workbench-structure.spec.ts`, add after the `./helpers/workbench` import block:

```ts
import { chooseTheme } from './helpers/theme';
```

and append at the end of the file:

```ts
test("Mol*'s background follows the theme", async ({ page }) => {
  await openExplore(page);
  await clickProteinNearPlotCentre(page);
  await expect(page.locator('#myStructureViewer')).toBeVisible();
  const background = () =>
    page.evaluate(
      () => (window as unknown as { __molstarBackground?: number }).__molstarBackground ?? null,
    );

  // The light --ps-surface, applied when the viewer was created.
  await expect.poll(background).toBe(0xffffff);
  await chooseTheme(page, 'Dark');
  await expect.poll(background).toBe(0x0f172a);
  await chooseTheme(page, 'Light');
  await expect.poll(background).toBe(0xffffff);
});
```

- [ ] **Step 10: Document the change**

In `docs/developers/style-architecture.md`:

(a) In the Component Prefixes table, change the row `| Structure-viewer | \`--protspace-viewer-*\` |` to `| Structure-viewer | \`--protspace-viewer-*\` (sizes only) |`, and let Prettier re-align the table.

(b) Replace the line that begins `1. **Always reference tokens**` in "Rules for these" (Task 6.4 may have changed its example; replace the whole line, whatever follows the bold text) with:

```md
1. **Sizes only**: colours come from the `--ps-*` tokens, so a component property never holds a
   colour (`--protspace-viewer-height: 100%`)
```

and, if the example block above it (`--protspace-bg-color /* component background */` before Task 6.4) still lists a colour property, replace that line with `--protspace-viewer-width        /* element sizing */`.

(c) Directly after the scatter-plot paragraph Task 6.6 added before `### Component Prefixes`, add:

```md
The structure viewer's colour properties (`--protspace-viewer-bg`, `-border`, `-header-bg`,
`-text`, `-text-muted`, `-error`, `-loading`) are gone too: its frame, header, footer, loading veil
and colour-mode control read the tokens, and the Mol\* canvas takes `--ps-surface` as its
background, set again whenever a theme change gives that token another value. Its
`--protspace-viewer-width`, `-height` and `-border-radius` stay.
```

- [ ] **Step 11: Run the task's tests**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/components/structure-viewer/molstar-loader.test.ts src/components/structure-viewer/molstar-loader.prefetch.test.ts src/components/structure-viewer/structure-viewer.component.test.ts src/components/structure-viewer/structure-viewer.coloring.test.ts src/components/structure-viewer/structure-viewer.prefetch.test.ts src/components/structure-viewer/structure-viewer.events.test.ts src/styles/style-lint.test.ts src/styles/styles-integrity.test.ts`
Expected: PASS. The style lint now runs "hard-codes no colour" on six modules and "still holds a colour" on `tokens.ts` alone; the seven "still needs its legacy exemption" tests still pass.

Run (sandbox disabled): `pnpm --filter @protspace/core exec vitest --run --project browser src/components/structure-viewer/structure-viewer.browser.test.ts src/components/scatter-plot/scatter-plot.theme.browser.test.ts`
Expected: PASS (the plot file covers the plot's shadow root, which also adopts `overlayMixins`). Report the counts before and after.

Run (sandbox disabled; the run builds the packages): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-structure.spec.ts --project workbench -g "background"`
Expected: PASS, 1 test.

Run: `pnpm exec prettier --check packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/styles/mixins.ts packages/core/src/styles/overlay-mixins.ts packages/core/src/components/structure-viewer/molstar-loader.ts packages/core/src/components/structure-viewer/molstar-loader.test.ts packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts packages/core/src/styles/style-lint.test.ts apps/web/tests/helpers/workbench.ts apps/web/tests/workbench-structure.spec.ts docs/developers/style-architecture.md`
Expected: all pass (`--write` any that do not, then re-check).

Run: `wc -l packages/core/src/components/structure-viewer/structure-viewer.ts` and report it (about 650).

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/components/structure-viewer/structure-viewer.styles.ts packages/core/src/styles/mixins.ts packages/core/src/styles/overlay-mixins.ts packages/core/src/components/structure-viewer/molstar-loader.ts packages/core/src/components/structure-viewer/molstar-loader.test.ts packages/core/src/components/structure-viewer/structure-viewer.ts packages/core/src/components/structure-viewer/structure-viewer.component.test.ts packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts packages/core/src/styles/style-lint.test.ts apps/web/tests/helpers/workbench.ts apps/web/tests/workbench-structure.spec.ts docs/developers/style-architecture.md
git commit -m "feat(core): structure viewer and Mol* follow the theme"
```

(Sandbox disabled: the hook needs it.) Report: LEGACY 7, `STILL_COLOURED` 1, the test counts and `wc -l structure-viewer.ts`. Exit runs first: the rest of `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts`, `mobile-explore-layout.spec.ts`, `workbench-loading.spec.ts`.

### Task 6.9: Wordmark, notifications, tour and legacy colours

The remaining surfaces follow the theme: the wordmark (a filter token), Sonner's notifications (the token mapping no longer keyed on Sonner's own light theme, plus its close button), the explore page's `body`, and the product tour (its CSS, its driver.js arrow and close button, its overlay colour and the highlighted button's glow). `tokens.ts` loses its colour declarations, the colour-only check covers every legacy module, and the style lint reaches the web app's two explore stylesheets.

**Files:**

- Modify: `packages/core/src/styles/theme.ts` (`--ps-logo-filter`; the header comment about `data-theme` rewritten: the explore page sets it, System follows the OS)
- Modify: `packages/core/src/styles/tokens.ts` (colour declarations stripped)
- Modify: `packages/core/src/styles/style-lint.test.ts` (`STILL_COLOURED` deleted; web CSS check)
- Modify: `apps/web/src/workbench/workbench.css` (wordmark filter, Sonner selector and close button, `body` on explore)
- Modify: `apps/web/src/tour/product-tour.css`, `apps/web/src/tour/product-tour.ts`
- Modify: `apps/web/tests/workbench-theme.spec.ts`
- Modify: `docs/developers/style-architecture.md` (one sentence: legacy modules hold no colour; the web stylesheets are linted for colour)

**Interfaces:**

- Consumes: the colour-only check and `STILL_COLOURED = { './tokens.ts' }` (6.6, 6.8); `WEB_SRC`, `COLOUR`, `DEFINED`, `readFileSync`, `join` (style lint, module level); `[data-workbench='home'] img` (`workbench.css:47`), the Sonner block (`workbench.css:1233-1306`, `WorkbenchToaster.tsx:27` keeps `theme="light"`); R3 §2.C's tour mapping (driver.js `.driver-popover`, the four `.driver-popover-arrow-side-*` classes, the close button, `product-tour.ts:87` glow, `:309-310` overlay); `chooseTheme`, `seedTheme`, `DARK_SURFACE` (`helpers/theme.ts`, 6.1–6.2); `openExplore`, `appBar`, `applyFirstCategoryFilter`, `closeFilterPanel`, `clearStatusChip` (`helpers/explore.ts`); the Help menu's "Take the tour".
- Produces:
  - Token `--ps-logo-filter` (light `none`, dark `invert(1) hue-rotate(180deg)`); `[data-workbench='home'] img { filter: var(--ps-logo-filter); }`.
  - `workbench.css`: `.wb-body [data-sonner-toaster][data-sonner-theme] { … }` (the same token mapping, matching any Sonner theme value, at 0,3,0 so it outranks Sonner's 0,2,0 theme rule regardless of load order); the close button's hover from `--ps-surface-hover`, `--ps-border-strong`, `--ps-text` (its rest colours `--ps-surface-raised`, `--ps-border`, `--ps-text-muted` are already mapped); `:root[data-theme] body { background: var(--ps-surface); }`.
  - `product-tour.css`: no raw colour (R3 mapping; arrows per side with `--ps-surface-raised`; focus halos `outline: var(--ps-focus-width) solid var(--ps-focus)`; every footer button's colours restated for `:focus`, which driver.css paints light at higher specificity); `product-tour.ts`: `overlayColor: 'var(--ps-scrim)'`, `overlayOpacity: 1`, glow `0 0 0 3px var(--ps-focus)`.
  - `tokens.ts`: no declaration whose value is a colour (palette, danger, UI colours, borders, text hierarchy, the old dark-mode pair, shadows); every non-colour alias stays.
  - `style-lint.test.ts`: `STILL_COLOURED` and its test are deleted (the colour-only check now runs on every `LEGACY` module); `const WEB_CSS = ['workbench/workbench.css', 'tour/product-tour.css']` read from `WEB_SRC`; `function webCssViolations(cssText: string): string[]` (module-private); test `it.each(WEB_CSS)('%s reads colours from tokens')`: comments stripped, no declaration value matching `COLOUR`, and every `var(--ps-…)` it reads is `DEFINED`.

**Tests:**

- `style-lint.test.ts`: "flags a raw colour and an undefined token in a web stylesheet"; the web CSS check passes for both files; the colour-only check passes for all seven LEGACY modules (tokens.ts included); the existing "uses every token" test covers `--ps-logo-filter` (read by `workbench.css`).
- `workbench-theme.spec.ts` (this task's e2e, describe "dark surfaces"): "the wordmark is inverted in Dark and plain in Light" (computed `filter`); "a toast is dark in Dark, and so is its hovered close button" (Reset a filter chip → "Filter removed"; the toast's computed background is the dark raised surface; the hovered close button the dark hover surface, not Sonner's light grey); "the tour's popover, its arrow and its overlay are dark in Dark" (Help → Take the tour; `.driver-popover` background and the title colour; the overlay `path` fill is the dark scrim; on step 2 the arrow's visible border colour equals the dark raised surface); "the explore body is the page surface, dark in Dark".
- Unrun at task time (exit): `product-tour.spec.ts`, `workbench-feedback.spec.ts` (toasts), `workbench-help.spec.ts`, `mobile-bars.spec.ts` (C11/C12 stay fixme for 7.4), `workbench-shell.spec.ts`, `kit-gallery.spec.ts`, and every spec whose page holds the scatter plot or the structure viewer (they compose `tokens.ts`; a colour read left behind by 6.6/6.8 would now resolve to nothing, which the colour-only check is there to catch first).

LEGACY count: 7 (each still reads a `tokens.ts` alias or a font variable outside `theme.ts`, unless one comes out fully clean; the last LEGACY test says so).

Before you start: Tasks 6.6 and 6.8 added the colour-only check to `style-lint.test.ts` and shrank `STILL_COLOURED` to `{ './tokens.ts' }`. Read that file first and find, by name: the `STILL_COLOURED` declaration, the `it.each(…)('%s hard-codes no colour', …)` test (whose list is `LEGACY` minus `STILL_COLOURED`) and the `it.each([...STILL_COLOURED])('%s still holds a colour', …)` test. If a name differs, apply the same change to what is there and say so in the report.

- [ ] **Step 1: Write the failing lint tests**

In `packages/core/src/styles/style-lint.test.ts`:

1. Delete the `STILL_COLOURED` declaration (the whole `const STILL_COLOURED = new Set<string>([…]);` statement and its comment).
2. In the `'%s hard-codes no colour'` test, replace the list it iterates (the expression that filters `LEGACY` by `STILL_COLOURED`, e.g. `[...LEGACY].filter((path) => !STILL_COLOURED.has(path))`) with `[...LEGACY]`. Leave its body, and `COLOUR_ALIASES` if 6.6 declared one, as they are: once `tokens.ts` holds no colour, `COLOUR_ALIASES` is empty and the "every `var()` is declared somewhere" rule catches a read of a removed alias.
3. Delete the whole `it.each([...STILL_COLOURED])('%s still holds a colour', …)` test.
4. After the `cssViolations` function (before `function sourceFiles`), add:

```ts
/** The web app's explore stylesheets (index.css belongs to the landing page): colours from tokens. */
const WEB_CSS = ['workbench/workbench.css', 'tour/product-tour.css'];

/** A web stylesheet's raw colours, and its reads of --ps-* tokens theme.ts does not define. */
function webCssViolations(cssText: string): string[] {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const [, property, raw] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const value = raw.trim();
    const unknownToken = [...value.matchAll(/var\(\s*(--ps-[\w-]+)/g)].some(
      ([, name]) => !DEFINED.has(name),
    );
    if (COLOUR.test(value) || unknownToken) found.push(`${property}: ${value}`);
  }
  return found;
}
```

5. Inside `describe('style lint', …)`, after the `'uses every token theme.ts defines'` test, add:

```ts
  it('flags a raw colour and an undefined token in a web stylesheet', () => {
    expect(
      webCssViolations(
        '.a:hover { color: #334155; border: 1px solid var(--ps-nope); background: var(--ps-surface); font-size: 12px; } /* #fff */',
      ),
    ).toEqual(['color: #334155', 'border: 1px solid var(--ps-nope)']);
  });

  it.each(WEB_CSS)('%s reads colours from tokens', (file) => {
    expect(webCssViolations(readFileSync(join(WEB_SRC, file), 'utf8'))).toEqual([]);
  });
```

(`readFileSync` and `join` are already imported at the top of the file.)

- [ ] **Step 2: Run the lint tests to verify they fail**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: FAIL, exactly these:
- `tour/product-tour.css reads colours from tokens` — about 33 entries such as `color: #334155`, `background: #f1f5f9`, `box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), …`.
- `./tokens.ts hard-codes no colour` — `--primary: #00a3e0`, `--surface: #ffffff`, …, `--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.08)` (it ran under `STILL_COLOURED` until now).

`workbench/workbench.css reads colours from tokens` and the sample test PASS already (workbench.css holds no raw colour today). Every other test passes.

- [ ] **Step 3: Write the failing e2e tests**

Append to `apps/web/tests/workbench-theme.spec.ts` (Tasks 6.1, 6.2 and 6.5 created and extended it). First make sure the file's imports include the following; merge the names into the existing `import { … } from './helpers/explore'` and `import { … } from './helpers/theme'` lines rather than adding duplicate import statements:

```ts
import {
  appBar,
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  openExplore,
} from './helpers/explore';
import { chooseTheme, DARK_SURFACE, seedTheme } from './helpers/theme';
```

Then append at the end of the file:

```ts
test.describe('dark surfaces', () => {
  // Dark role values from theme.ts, as computed colours (block-scoped: other describes in this
  // file may name their own).
  const DARK_RAISED = 'rgb(22, 32, 54)'; // --ps-surface-raised #162036
  const DARK_HOVER = 'rgb(30, 41, 59)'; // --ps-surface-hover #1e293b
  const DARK_TEXT = 'rgb(241, 245, 249)'; // --ps-text #f1f5f9
  const DARK_SCRIM = 'rgba(2, 6, 23, 0.65)'; // --ps-scrim

  test('the wordmark is inverted in Dark and plain in Light', async ({ page }) => {
    await openExplore(page);
    const wordmark = page.locator("[data-workbench='home'] img");
    await expect(wordmark).toHaveCSS('filter', 'none');

    await chooseTheme(page, 'Dark');
    await expect(wordmark).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');

    await chooseTheme(page, 'Light');
    await expect(wordmark).toHaveCSS('filter', 'none');
  });

  test('a toast is dark in Dark, and so is its hovered close button', async ({ page }) => {
    await seedTheme(page, 'dark');
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);
    await clearStatusChip(page, 'filter');

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Filter removed' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCSS('background-color', DARK_RAISED);
    await expect(toast).toHaveCSS('color', DARK_TEXT);

    // Sonner's own hover paints its light grey (--gray2) at a higher specificity than a plain rule.
    const close = toast.getByRole('button', { name: 'Dismiss notification' });
    await close.hover();
    await expect(close).toHaveCSS('background-color', DARK_HOVER);
  });

  test("the tour's popover, its arrow and its overlay are dark in Dark", async ({ page }) => {
    await seedTheme(page, 'dark');
    await openExplore(page);
    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    const popover = page.locator('.driver-popover');
    const title = popover.locator('.driver-popover-title');
    await expect(title).toHaveText('Welcome to ProtSpace');
    await expect(popover).toHaveCSS('background-color', DARK_RAISED);
    await expect(title).toHaveCSS('color', DARK_TEXT);
    await expect(page.locator('.driver-overlay path')).toHaveCSS('fill', DARK_SCRIM);

    // The welcome step is centred with no arrow; step 2 points at Import, so its arrow shows. The
    // arrow is a border triangle: only the side named in its class is painted.
    await popover.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import Your Data');
    const arrowColour = () =>
      popover.locator('.driver-popover-arrow').evaluate((arrow) => {
        const side = /driver-popover-arrow-side-(left|right|top|bottom)\b/.exec(
          arrow.className,
        )?.[1];
        return side ? getComputedStyle(arrow).getPropertyValue(`border-${side}-color`) : 'none';
      });
    await expect.poll(arrowColour).toBe(DARK_RAISED);
  });

  test('the explore body is the page surface, dark in Dark', async ({ page }) => {
    await openExplore(page);
    // An unlayered override of the token reaches <body>: it paints --ps-surface, not index.css's
    // white bg-background (which sits in a cascade layer and would ignore the override).
    const override = await page.addStyleTag({ content: ':root { --ps-surface: rgb(1, 2, 3); }' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 2, 3)');
    await override.evaluate((tag) => tag.remove());

    await chooseTheme(page, 'Dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_SURFACE);
  });
});
```

- [ ] **Step 4: Run the e2e tests to verify they fail**

Run (sandbox disabled: Playwright starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-theme.spec.ts --project workbench -g "dark surfaces"`
Expected: FAIL, 4 tests:
- wordmark: `filter` is `none` after Dark (no token yet).
- toast: the toast's background and text already pass (the existing mapping, keyed on Sonner's light theme, reads the tokens); the hovered close button fails with `rgb(248, 248, 248)` (Sonner's `--gray2`).
- tour: the popover's background is `rgb(255, 255, 255)` (driver.css), the title colour `rgb(51, 65, 85)`.
- body: `rgb(255, 255, 255)` instead of `rgb(1, 2, 3)` (nothing paints the body from the token).

- [ ] **Step 5: Add the logo token and rewrite the theme header comment**

In `packages/core/src/styles/theme.ts`, replace the header paragraph:

```ts
 * Light values sit on :root. Dark values apply under [data-theme='dark'], and under
 * [data-theme='system'] when the OS prefers dark. Until the theme switch lands nothing sets
 * data-theme, so pages stay light. All of it sits in the `ps-theme` cascade layer, so any
 * unlayered page rule, even `:root { --ps-accent: … }`, overrides a token in both themes.
```

with:

```ts
 * Light values sit on :root. Dark values apply under [data-theme='dark'], and under
 * [data-theme='system'] when the OS prefers dark, so System follows the OS live in CSS alone. The
 * explore page sets data-theme on <html> while it is mounted (apps/web/src/explore/theme-state.ts;
 * on a cold load, the boot script in apps/web/index.html before first paint); other pages leave it
 * unset and stay light. All of it sits in the `ps-theme` cascade layer, so any unlayered page
 * rule, even `:root { --ps-accent: … }`, overrides a token in both themes.
```

(If an earlier task already edited this paragraph, keep its additions and replace only the "Until the theme switch lands …" sentence.)

In `lightRoles`, after the line

```ts
  --ps-shadow-lg: 0 12px 32px -12px rgb(15 23 42 / 0.24), 0 2px 6px rgb(15 23 42 / 0.06);
```

add:

```ts
  --ps-logo-filter: none;
```

In `darkRoles`, after the line

```ts
  --ps-shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.75), 0 0 0 1px #24324a;
```

add:

```ts
  --ps-logo-filter: invert(1) hue-rotate(180deg); /* the wordmark's dark ink turned light, hues kept */
```

- [ ] **Step 6: Strip the colours from `tokens.ts`**

Replace the whole of `packages/core/src/styles/tokens.ts` with:

```ts
import { css } from 'lit';

/**
 * Legacy aliases from before the --ps-* tokens (packages/core/src/styles/theme.ts). Only modules in
 * style-lint.test.ts's LEGACY set compose this sheet, for its non-colour values: spacing,
 * breakpoints, radii, type sizes and weights, transitions, z-indexes and component sizing. It
 * holds no colour: colours are --ps-* tokens, which follow the page's theme, and the style lint
 * fails a colour here. Task 8.1 deletes this file.
 */
export const tokens = css`
  :host {
    display: block;
    font-family: var(--font-family);

    /* Spacing Scale (4px base unit) */
    --spacing-2xs: 0.125rem; /*  2px */
    --spacing-xs: 0.25rem; /*  4px */
    --spacing-sm: 0.5rem; /*  8px */
    --spacing-md: 0.75rem; /* 12px */
    --spacing-lg: 1rem; /* 16px */

    /* Breakpoints (mobile-first approach) */
    --breakpoint-xs: 550px; /* Mobile */
    --breakpoint-sm: 600px; /* Small tablets */
    --breakpoint-md: 800px; /* Tablets */
    --breakpoint-lg: 950px; /* Small desktop */
    --breakpoint-xl: 1200px; /* Desktop */
    --breakpoint-2xl: 1450px; /* Large desktop */

    /* Border & Radius */
    --border-width: 1px;
    --radius: 0.25rem; /* 4px */
    --radius-pill: 0.75rem; /* 12px */

    /* Typography Scale */
    --font-family: system-ui, -apple-system, sans-serif;
    --text-xs: 0.625rem; /* 10px */
    /* 11px. Named for its role, not slotted into the xs/sm/base/md ramp: it sits between
       --text-xs and --text-sm, so any scale name for it would read as the wrong size. */
    --text-caption: 0.6875rem;
    --text-sm: 0.75rem; /* 12px */
    --text-base: 0.875rem; /* 14px */
    --text-md: 1rem; /* 16px */

    /* Font Weights */
    --font-normal: 400;
    --font-medium: 500;
    --font-semibold: 600;
    --font-bold: 700;

    /* Animations */
    --transition-fast: all 0.1s ease;
    --transition: all 0.15s ease;

    /* Layout */
    --dropdown-offset: 0.3125rem; /* 5px */

    /* Z-Index Scale */
    --z-base: 1;
    --z-canvas: 1;
    --z-badges: 2;
    --z-svg: 3;
    --z-overlay: 10;
    --z-tooltip: 20;
    --z-dropdown: 100;
    --z-modal: 1000;
    --z-above-modal: 1001;

    /* Component sizing */
    --input-padding-y: 0.375rem; /* 6px */
    --input-padding-x: 0.5625rem; /* 9px */
    --button-padding-y: 0.3rem;
    --button-padding-x: 0.75rem;
  }
`;
```

This removes the Color Palette, Destructive Actions, Additional UI Colors, Border Variations, Text Hierarchy (`--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`), Dark Mode Support and Shadows groups; every alias in the file above is unchanged. Then check nothing outside the LEGACY modules still reads a removed alias:

Run: `grep -rnE 'var\(--(primary(-hover|-light|-alpha-[0-9]+)?|surface(-dark)?|border(-light|-hover|-dark)?|muted|text-(dark|light|primary|secondary|tertiary|muted)|focus-ring(-bg)?|danger(-hover|-border)?|hint|scrollbar|hover-bg(-alt)?|active-bg|disabled-bg|shadow-(sm|md|lg))\s*[,)]' packages/core/src`
Expected: no output. (`apps/web/src/index.css` reads shadcn's own `--primary`, `--muted`, `--border` on the landing page; those are not these aliases and are out of scope.) A hit in a core module means 6.6 or 6.8 left a read behind: map it to its `--ps-*` role per R3 §2.A and list it in the report.

- [ ] **Step 7: Put the tour on tokens**

Replace the whole of `apps/web/src/tour/product-tour.css` with:

```css
/* Import driver.js base styles */
@import 'driver.js/dist/driver.css';

/*
 * ProtSpace theme overrides for driver.js. Every colour is a --ps-* token
 * (packages/core/src/styles/theme.ts), so the tour follows the explore page's theme. driver.css
 * paints its own light colours on the popover, its arrow, the close button and the footer
 * buttons (including their :hover and :focus states); each is overridden here. The overlay's
 * colour is set in product-tour.ts (overlayColor). style-lint.test.ts fails a raw colour here.
 */

/* ── Popover container ────────────────────────────────────── */

.driver-popover {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 0.875rem;
  line-height: 1.5;
  border-radius: 0.5rem;
  background-color: var(--ps-surface-raised);
  color: var(--ps-text);
  box-shadow: var(--ps-shadow-lg);
  border: 1px solid var(--ps-border);
  max-width: 380px;
}

/* driver.css draws the arrow as a 5 px white border and clears three sides per placement; only the
   side left showing takes the popover's colour, so the other three stay transparent. */
.driver-popover-arrow-side-left {
  border-left-color: var(--ps-surface-raised);
}

.driver-popover-arrow-side-right {
  border-right-color: var(--ps-surface-raised);
}

.driver-popover-arrow-side-top {
  border-top-color: var(--ps-surface-raised);
}

.driver-popover-arrow-side-bottom {
  border-bottom-color: var(--ps-surface-raised);
}

/* The ✕ in the corner. */
.driver-popover-close-btn {
  color: var(--ps-text-muted);
}

.driver-popover-close-btn:hover,
.driver-popover-close-btn:focus {
  color: var(--ps-text);
}

.driver-popover-close-btn:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: calc(-1 * var(--ps-focus-width));
}

/* ── Typography ───────────────────────────────────────────── */

.driver-popover .driver-popover-title {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: var(--ps-text);
}

.driver-popover .driver-popover-description {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 0.875rem;
  color: var(--ps-text-muted);
  line-height: 1.6;
}

.driver-popover .driver-popover-progress-text {
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 0.75rem;
  color: var(--ps-text-muted);
}

/* ── Links inside descriptions ────────────────────────────── */

.driver-popover .driver-popover-description a {
  color: var(--ps-accent-text);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  font-weight: 500;
  transition: color 0.2s ease;
}

.driver-popover .driver-popover-description a:hover {
  color: var(--ps-accent-hover);
}

.driver-popover .driver-popover-description a .external-link-icon {
  display: inline-block;
  width: 0.75em;
  height: 0.75em;
  vertical-align: baseline;
  margin-left: 0.15em;
  position: relative;
  top: 0.05em;
}

/* ── Inline code ──────────────────────────────────────────── */

.driver-popover .driver-popover-description code {
  background: var(--ps-surface-hover);
  border: 1px solid var(--ps-border);
  border-radius: 0.25rem;
  padding: 0.1rem 0.35rem;
  font-size: 0.8125rem;
  font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', monospace;
  color: var(--ps-text);
}

/* ── Modifier key glyph (⌘) size bump ────────────────────── */

.driver-popover .driver-popover-description .mod-key {
  font-size: 1rem;
  line-height: 0;
  vertical-align: -0.0625rem;
}

/* ── Keyboard shortcut badges ────────────────────────────── */

.driver-popover .driver-popover-description kbd {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  background: var(--ps-surface-hover);
  border: 1px solid var(--ps-border);
  border-radius: 0.25rem;
  padding: 0.1rem 0.35rem;
  font-size: 0.8125rem;
  font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', monospace;
  color: var(--ps-text);
  box-shadow: 0 1px 0 var(--ps-border-strong);
  vertical-align: baseline;
  line-height: 1.4;
}

/* ── Shared button base ───────────────────────────────────── *
 *
 * driver.js base uses `.driver-popover-footer button` (0,1,1 specificity)
 * with a `font` shorthand that resets font-size, and
 * `.driver-popover-footer button:hover, …:focus` (0,2,1) with a light
 * background. Every rule here is qualified with `.driver-popover-footer`, and
 * each button's colours are restated for :focus, so ours always win.
 */

.driver-popover-footer .driver-popover-prev-btn,
.driver-popover-footer .driver-popover-next-btn,
.driver-popover-footer .driver-popover-close-btn-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.5;
  padding: 0.375rem 1rem; /* slightly more generous than toolbar for readability */
  border-radius: 0.25rem;
  white-space: nowrap;
  box-sizing: border-box;
  text-shadow: none; /* override driver.js white text-shadow */
}

.driver-popover-footer .driver-popover-prev-btn:focus-visible,
.driver-popover-footer .driver-popover-next-btn:focus-visible,
.driver-popover-footer .driver-popover-close-btn-text:focus-visible,
.driver-popover-footer .driver-tour-skip-btn:focus-visible {
  outline: var(--ps-focus-width) solid var(--ps-focus);
  outline-offset: var(--ps-focus-offset);
}

/* ── Primary button (Next / Finish) ───────────────────────── */

.driver-popover-footer .driver-popover-next-btn,
.driver-popover-footer .driver-popover-next-btn:focus,
.driver-popover-footer .driver-popover-close-btn-text,
.driver-popover-footer .driver-popover-close-btn-text:focus {
  background: var(--ps-accent);
  border: 1px solid var(--ps-accent);
  color: var(--ps-text-on-accent);
}

.driver-popover-footer .driver-popover-next-btn:hover,
.driver-popover-footer .driver-popover-close-btn-text:hover {
  background: var(--ps-accent-hover);
  border-color: var(--ps-accent-hover);
  box-shadow: var(--ps-shadow-sm);
}

/* ── Secondary button (Back) ──────────────────────────────── */

.driver-popover-footer .driver-popover-prev-btn,
.driver-popover-footer .driver-popover-prev-btn:focus {
  background: var(--ps-surface);
  border: 1px solid var(--ps-border-control);
  color: var(--ps-text);
}

.driver-popover-footer .driver-popover-prev-btn:hover {
  background: var(--ps-surface-hover);
  box-shadow: var(--ps-shadow-sm);
}

/* ── Skip button (ghost, first step only) ─────────────────── */

.driver-popover-footer .driver-tour-skip-btn,
.driver-popover-footer .driver-tour-skip-btn:focus {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  color: var(--ps-text-muted);
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  text-shadow: none;
  cursor: pointer;
  padding: 0.375rem 0.5rem;
  transition: color 0.2s ease;
}

.driver-popover-footer .driver-tour-skip-btn:hover {
  background: none;
  color: var(--ps-text);
}
```

What changed besides the colour mapping (R3 §2.C): the popover's own background and text (driver.css's `#fff`/`#2d2d2d`), the four arrow sides, the close button, `:focus` restated on every footer button (driver.css's `button:focus` at 0,2,1 painted `#f7f7f7` over our 0,2,0 base, which would be a light box under light text in Dark), the skip button's driver.css white text-shadow and hover background reset, and the focus halos as one outline (the three `:focus-visible:hover` box-shadow combinations go: an outline does not clash with the hover shadow). The skip button's light grey `#94a3b8` (2.6:1 on white) becomes `--ps-text-muted`.

In `apps/web/src/tour/product-tour.ts`, in `spotlightHelp`, replace:

```ts
    // Glow on the rounded button so there are no corner artifacts
    button.style.boxShadow = '0 0 0 3px #00a3e0, 0 0 12px rgba(0, 163, 224, 0.5)';
```

with:

```ts
    // Glow on the rounded button so there are no corner artifacts; the focus token follows the theme
    button.style.boxShadow = '0 0 0 3px var(--ps-focus)';
```

and in the `driverObj.setConfig({ … })` call, replace:

```ts
  overlayColor: '#334155',
  overlayOpacity: 0.5,
```

with:

```ts
  // driver.js sets the overlay path's `style.fill` to this string, so a token works; the scrim
  // carries its own alpha (light 0.45, dark 0.65), hence opacity 1.
  overlayColor: 'var(--ps-scrim)',
  overlayOpacity: 1,
```

- [ ] **Step 8: Wordmark, notifications and body in `workbench.css`**

In `apps/web/src/workbench/workbench.css`:

1. After the `.workbench { … }` rule (the first rule, ending `line-height: var(--ps-leading-tight);\n}`), add:

```css
/* The page behind the workbench (overscroll, landscape scrolling). The explore page sets
   data-theme on <html> only while it is mounted; index.css's white body would show otherwise. */
:root[data-theme] body {
  background: var(--ps-surface);
}
```

2. In the `[data-workbench='home'] img` rule, after `height: 22px;`, add:

```css
  /* Dark: invert the dark ink, then turn the hues back (the mockup's treatment). */
  filter: var(--ps-logo-filter);
```

(The header comment's "no filter on an ancestor of the legend or the bars" is about ancestors; the image has no children.)

3. Replace:

```css
/* Sonner's light palette, from the tokens. */
.wb-body [data-sonner-toaster][data-sonner-theme='light'] {
```

with:

```css
/* Sonner's palette, from the tokens. WorkbenchToaster keeps Sonner on theme="light"; the tokens
   carry the page's theme, so this rule matches any Sonner theme, and outranks Sonner's own theme
   rule (0,3,0 against 0,2,0) whatever order the sheets load in. */
.wb-body [data-sonner-toaster][data-sonner-theme] {
```

4. After the rule `.wb-body [data-sonner-toaster] [data-sonner-toast] [data-close-button] { … }` (border-color, background, color), add:

```css
/* Sonner's own hover (its light --gray2 and --gray5) sits at 0,5,0; this one at 0,6,0. */
.wb-body [data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-close-button]:hover {
  border-color: var(--ps-border-strong);
  background: var(--ps-surface-hover);
  color: var(--ps-text);
}
```

- [ ] **Step 9: One sentence in the developer docs**

In `docs/developers/style-architecture.md`, section "Custom Properties → Design tokens", after the sentence that ends "Modules written before the tokens are listed in its `LEGACY` set, which only shrinks." add:

```md
A `LEGACY` module may still read a non-colour alias from `tokens.ts` (spacing, type, z-index), but
no colour: `tokens.ts` declares none, and the lint fails a legacy module that hard-codes one or
reads an alias nothing declares. The web app's `workbench.css` and `tour/product-tour.css` are
held to the colour rule too.
```

If Task 6.6 already added a sentence about the colour-only check there, merge this one into it instead of repeating it.

- [ ] **Step 10: Run the lint and the touched unit tests to verify they pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/styles/theme.test.ts`
Expected: PASS. Both `WEB_CSS` entries pass; `'%s hard-codes no colour'` passes for all seven LEGACY modules; `'%s still needs its legacy exemption'` passes for all seven (tokens.ts still reads `var(--font-family)`, which `theme.ts` does not define); `'uses every token theme.ts defines'` passes (`--ps-logo-filter` is read by `workbench.css`). If `'%s still needs its legacy exemption'` fails for a module, it came out fully clean: delete its line from `LEGACY` and report the new count. If `'%s hard-codes no colour'` fails for a module other than tokens.ts, it reads a colour alias Step 6 removed: map it per R3 §2.A and report it.

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/product-tour.test.ts`
Expected: PASS (it mocks the stylesheet; this checks `product-tour.ts` still loads).

- [ ] **Step 11: Run the e2e tests to verify they pass**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-theme.spec.ts --project workbench -g "dark surfaces"`
Expected: PASS, 4 tests.

- [ ] **Step 12: Format and commit**

Run: `pnpm exec prettier --check packages/core/src/styles/theme.ts packages/core/src/styles/tokens.ts packages/core/src/styles/style-lint.test.ts apps/web/src/workbench/workbench.css apps/web/src/tour/product-tour.css apps/web/src/tour/product-tour.ts apps/web/tests/workbench-theme.spec.ts docs/developers/style-architecture.md`
Expected: all files pass (fix with `--write` and re-run if not).

Commit (sandbox disabled; the hook runs `pnpm precommit`):

```bash
git add packages/core/src/styles/theme.ts packages/core/src/styles/tokens.ts packages/core/src/styles/style-lint.test.ts apps/web/src/workbench/workbench.css apps/web/src/tour/product-tour.css apps/web/src/tour/product-tour.ts apps/web/tests/workbench-theme.spec.ts docs/developers/style-architecture.md
git commit -m "feat(web): wordmark, toasts and tour follow the theme"
```

Report: the lint and app test counts before and after, the 4 e2e results, the LEGACY count, any alias read Step 6's grep or Step 10 found, and the unrun specs listed above.

### Task 6.10: Contrast gates for the role tokens and the default palettes

The role-token contrast test grows to every pair the UI relies on, in both themes, including translucent tokens composited over their surface, and the plot tokens on the plot background. Light `--ps-danger` deepens to pass on the hover surface. A palette test gates the default categorical palettes against the dark plot background, with an exact allow-list.

**Files:**

- Create: `packages/core/src/test-support/contrast.ts`
- Modify: `packages/core/src/styles/theme.ts` (light `--ps-danger: #b91c1c`), `packages/core/src/styles/theme.test.ts`
- Create: `packages/core/src/styles/palette-contrast.test.ts`

**Interfaces:**

- Consumes: `theme.cssText` (`theme.ts`), the existing `hexes`/`lum`/`ratio` in `theme.test.ts` (moved), every token of the "New tokens" table (6.4–6.9): `--ps-plot-bg`, `--ps-plot-other`, `--ps-plot-connector`, `--ps-eat`, `--ps-eat-endpoint`, `--ps-swatch-stroke`; `COLOR_SCHEMES` (`@protspace/utils`, built; ids `kellys`, `okabeIto`, `tolBright`, `set2`, `dark2`, `tableau10`, gradients `viridis`, `inferno`, `plasma`, `cividis`, `batlow`).
- Produces:
  - `test-support/contrast.ts`: `tokensOf(selector: ':root' | ":root[data-theme='dark']"): Map<string, string>` (the raw `--ps-*` values declared in that block of `theme.cssText`, comments stripped; every rule with exactly that selector is merged, so a separate `:root` rule such as 6.5's fixed roles counts; the dark map falls back to `:root` for tokens the dark block does not redeclare); `toHex(value: string, over?: string): string` (`#rrggbb` lower-cased as is, `#rgb` expanded; `rgb(r g b)`, `rgb(r g b / a)` and the comma forms composited over `over`, which a translucent value requires; anything else throws); `contrast(a: string, b: string): number` (WCAG ratio of two opaque colours, each passed through `toHex`).
  - `theme.ts`: light `--ps-danger: #b91c1c; /* red-700, 5.9:1 on the hover surface */`.

**Tests:**

- `theme.test.ts` (both themes via `it.each`): the two existing tests on the helper; "focus reaches 3:1 on every surface"; "tooltip text reaches 4.5:1 on the tooltip background"; "text and accent text reach 4.5:1 on the accent tint over the surface" (`--ps-text`, `--ps-text-muted`, `--ps-accent-text`); "danger reaches 4.5:1 on the surface, the raised surface and the hover surface" (red before the change in light: 4.41 on the hover surface); "plot Other, connector and EAT endpoint reach 3:1 on the plot background"; "the EAT colour reaches 3:1 on the raised surface"; "the swatch outline reaches 3:1 on the surface"; dark only: "faint text reaches 3:1 on the surface"; plus "toHex composites a translucent token over its backdrop, and refuses one without".
- `palette-contrast.test.ts`: "Kelly's colours reach 2:1 on the dark plot background, except the allow-listed #2B3D26 and #222222"; "Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 reach 3:1, except Okabe-Ito's #000000"; "every allow-listed colour is really below its gate" (so the list only shrinks).
- Unrun at task time (exit): `kit-gallery.spec.ts` (danger button), `workbench-feedback.spec.ts` (confirm dialog's danger button).

LEGACY count: 7.

Measured with these formulas (so the gates are not guesses): light text/muted/accent text on the tint 15.6/6.6/5.2, dark 12.0/5.1/6.2; focus light 3.7–4.1, dark 6.8–8.3; danger light `#dc2626` 4.41 on hover (fails), `#b91c1c` 6.5/6.5/5.9, dark 6.5/5.9/5.3; Other/connector/endpoint on the plot background light 3.5/7.6/5.5, dark 4.0/7.3/10.1; EAT on raised light 5.7, dark 6.0; swatch outline light 10.3, dark 7.0; dark faint text 3.75. On dark `--ps-plot-bg` `#0b1120`: Kelly's lowest passing slot is `#882D17`/`#654522` at 2.18, the two failures `#2B3D26` 1.61 and `#222222` 1.18; Okabe-Ito `#000000` 1.12; the lowest passing 3:1 colour is Tol Bright `#AA3377` at 3.09.

- [ ] **Step 1: Write the contrast helper**

Create `packages/core/src/test-support/contrast.ts`:

```ts
import { theme } from '../styles/theme';

/**
 * The token blocks a test can read: the light roles, the dark ones, and the system block (the dark
 * roles under the OS media query, which Task 6.4's "both role blocks" test reads).
 */
type ThemeBlock = ':root' | ":root[data-theme='dark']" | ":root[data-theme='system']";

/** Every innermost rule of theme.cssText as [selector, body], comments stripped. */
function rules(): Array<[string, string]> {
  const css = theme.cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [
    selector.trim(),
    body,
  ]);
}

/** The --ps-* values declared by the rules whose selector is exactly `selector`, merged. */
function declared(selector: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const [ruleSelector, body] of rules()) {
    if (ruleSelector !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--ps-[\w-]+)\s*:\s*([^;]+);/g))
      values.set(name, value.trim());
  }
  return values;
}

/**
 * The raw token values one theme ships, as theme.ts declares them. The dark block redeclares only
 * the roles; anything it leaves out (sizes, the fixed paper roles) falls back to :root, as in CSS.
 */
export function tokensOf(selector: ThemeBlock): Map<string, string> {
  const light = declared(':root');
  return selector === ':root' ? light : new Map([...light, ...declared(selector)]);
}

const hexByte = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * `value` as an opaque `#rrggbb`. A translucent `rgb(… / a)` is composited over `over` (itself
 * any opaque form); without a backdrop it has no single colour, so that throws.
 */
export function toHex(value: string, over?: string): string {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v))
    return `#${[...v.slice(1)].map((digit) => digit + digit).join('')}`;
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!rgb) throw new Error(`Not a colour contrast.ts can read: ${value}`);
  const [, r, g, b, a] = rgb;
  const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  if (alpha >= 1) return `#${[r, g, b].map((c) => hexByte(Number(c))).join('')}`;
  if (over === undefined) throw new Error(`${value} is translucent: pass the colour under it`);
  const base = toHex(over);
  return `#${[r, g, b]
    .map((c, i) => {
      const under = parseInt(base.slice(1 + 2 * i, 3 + 2 * i), 16);
      return hexByte(alpha * Number(c) + (1 - alpha) * under);
    })
    .join('')}`;
}

/** WCAG 2 relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two opaque colours (any form `toHex` reads), from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(toHex(a)), luminance(toHex(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
```

- [ ] **Step 2: Rewrite the role-token tests on the helper, with the new gates**

In `packages/core/src/styles/theme.test.ts`, replace everything from the line `const hexes = (selector: string) => {` through the end of the second existing test (the `it.each(...)('control boundaries reach 3:1 on every surface (%s)', …);` block, ending `  },\n);`) with the block below. Keep every test Task 6.4 (or a later task) added to this file; where one calls `hexes(sel)`, call `tokensOf(sel)` instead (same `Map<string, string>` shape; values are raw, so `#888888` reads as before; a test that relied on `hexes` dropping non-hex values must `toHex` them). In the imports, replace `import { theme } from './theme';` with the line below and keep every other import (Task 6.4's `NA_DEFAULT_COLOR` from `@protspace/utils` and `NEUTRAL_VALUE_COLOR` from `../components/scatter-plot/config`, which its kept test reads), so the import block reads:

```ts
import { expect, it } from 'vitest';
import { NA_DEFAULT_COLOR } from '@protspace/utils';
import { NEUTRAL_VALUE_COLOR } from '../components/scatter-plot/config';
import { contrast, tokensOf, toHex } from '../test-support/contrast';
```

Keep `import { theme } from './theme';` as well only if a test you kept still reads `theme` directly.

The replacement block:

```ts
const THEMES = [':root', ":root[data-theme='dark']"] as const;
const SURFACES = [
  '--ps-surface',
  '--ps-surface-muted',
  '--ps-surface-raised',
  '--ps-surface-hover',
] as const;

/** A token's raw value in one theme; a token missing from theme.ts fails by name. */
function token(t: Map<string, string>, name: string): string {
  const value = t.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

/** Contrast of `fg` on `bg` in one theme, both tokens; `bg` may be translucent over `under`. */
function ratio(t: Map<string, string>, fg: string, bg: string, under?: string): number {
  const back = toHex(token(t, bg), under === undefined ? undefined : toHex(token(t, under)));
  return contrast(toHex(token(t, fg), back), back);
}

it('toHex composites a translucent token over its backdrop, and refuses one without', () => {
  expect(toHex('#0F172A')).toBe('#0f172a');
  expect(toHex('#fff')).toBe('#ffffff');
  expect(toHex('rgb(56 189 248 / 0.16)', '#0f172a')).toBe('#16324b');
  expect(toHex('rgba(0, 0, 0, 0.5)', '#ffffff')).toBe('#808080');
  expect(() => toHex('rgb(56 189 248 / 0.16)')).toThrow(/translucent/);
  expect(() => toHex('transparent')).toThrow();
  expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
});

// Design decision 20's role-token check. --ps-text-faint is left out on purpose: it is for
// disabled text and decorative icons only.
it.each(THEMES)('text roles reach 4.5:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const fg of ['--ps-text', '--ps-text-muted', '--ps-accent-text'])
    for (const bg of SURFACES)
      expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  expect(ratio(t, '--ps-text-on-accent', '--ps-accent')).toBeGreaterThanOrEqual(4.5);
});

// WCAG 1.4.11: a control's boundary and the selected-segment ring need 3:1 on what they sit on.
it.each(THEMES)('control boundaries reach 3:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const fg of ['--ps-border-control', '--ps-accent'])
    for (const bg of ['--ps-surface', '--ps-surface-muted', '--ps-surface-raised'])
      expect(ratio(t, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('focus reaches 3:1 on every surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const bg of SURFACES)
    expect(ratio(t, '--ps-focus', bg), `--ps-focus on ${bg}`).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('tooltip text reaches 4.5:1 on the tooltip background (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-tooltip-text', '--ps-tooltip-bg')).toBeGreaterThanOrEqual(
    4.5,
  );
});

// A selected row or item: the tint is translucent in dark, so it is composited over the surface.
it.each(THEMES)('text and accent text reach 4.5:1 on the accent tint over the surface (%s)', (sel) => {
  const t = tokensOf(sel);
  for (const fg of ['--ps-text', '--ps-text-muted', '--ps-accent-text'])
    expect(
      ratio(t, fg, '--ps-accent-tint', '--ps-surface'),
      `${fg} on the tint`,
    ).toBeGreaterThanOrEqual(4.5);
});

// A hovered danger button keeps its red text on the hover surface (kit button.styles.ts).
it.each(THEMES)(
  'danger reaches 4.5:1 on the surface, the raised surface and the hover surface (%s)',
  (sel) => {
    const t = tokensOf(sel);
    for (const bg of ['--ps-surface', '--ps-surface-raised', '--ps-surface-hover'])
      expect(ratio(t, '--ps-danger', bg), `--ps-danger on ${bg}`).toBeGreaterThanOrEqual(4.5);
  },
);

// Marks on the plot. --ps-plot-na is exempt: N/A points are de-emphasised by design.
it.each(THEMES)(
  'plot Other, connector and EAT endpoint reach 3:1 on the plot background (%s)',
  (sel) => {
    const t = tokensOf(sel);
    for (const fg of ['--ps-plot-other', '--ps-plot-connector', '--ps-eat-endpoint'])
      expect(ratio(t, fg, '--ps-plot-bg'), `${fg} on --ps-plot-bg`).toBeGreaterThanOrEqual(3);
  },
);

it.each(THEMES)('the EAT colour reaches 3:1 on the raised surface (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-eat', '--ps-surface-raised')).toBeGreaterThanOrEqual(3);
});

it.each(THEMES)('the swatch outline reaches 3:1 on the surface (%s)', (sel) => {
  expect(ratio(tokensOf(sel), '--ps-swatch-stroke', '--ps-surface')).toBeGreaterThanOrEqual(3);
});

// Light faint text is 2.6:1 by design (disabled text only); dark keeps decorative icons visible.
it('faint text reaches 3:1 on the surface in dark', () => {
  expect(
    ratio(tokensOf(":root[data-theme='dark']"), '--ps-text-faint', '--ps-surface'),
  ).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 3: Run the role-token tests to verify the danger gate fails**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/theme.test.ts`
Expected: FAIL, exactly one test: `danger reaches 4.5:1 on the surface, the raised surface and the hover surface (:root)` with `--ps-danger on --ps-surface-hover: expected 4.41… to be greater than or equal to 4.5` (`#dc2626` on `#f1f5f9`). Every other test passes, in both themes, including the two moved ones and the tests Task 6.4 added. A `… is not declared` error means a token from the "New tokens" table is missing: stop and report it (an earlier task did not land it).

- [ ] **Step 4: Deepen the light danger red**

In `packages/core/src/styles/theme.ts`, `lightRoles`, replace:

```ts
  --ps-danger: #dc2626; /* red-600 */
```

with:

```ts
  --ps-danger: #b91c1c; /* red-700, 5.9:1 on the hover surface */
```

- [ ] **Step 5: Run the role-token tests to verify they pass**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/theme.test.ts`
Expected: PASS (20 tests from this block — 1 helper test, 9 `it.each` × 2 themes, 1 dark-only — plus the tests Task 6.4 added).

- [ ] **Step 6: Write the palette test**

Create `packages/core/src/styles/palette-contrast.test.ts`:

```ts
import { COLOR_SCHEMES } from '@protspace/utils';
import { describe, expect, it } from 'vitest';
import { contrast, tokensOf } from '../test-support/contrast';

/**
 * Design decision 16: category palettes do not change in dark; the defaults must still read on
 * the dark plot background. Kelly's 21 colours are the default and need 2:1 (it trades contrast for
 * count); the other categorical palettes 3:1 (WCAG 1.4.11 for graphics). Gradients are out of
 * scope: their dark stops are meant to sink.
 */
const PLOT_BG = tokensOf(":root[data-theme='dark']").get('--ps-plot-bg')!;

const GATES = {
  kellys: 2,
  okabeIto: 3,
  tolBright: 3,
  set2: 3,
  dark2: 3,
  tableau10: 3,
} as const;
type Gated = keyof typeof GATES;

/**
 * Colours below their gate, kept because a palette is a published standard and the point's
 * outline still bounds them (the rim darkening is reviewed at the phase exit). Only shrinks: the
 * last test fails while a listed colour passes.
 */
const ALLOWED: Record<Gated, readonly string[]> = {
  kellys: ['#2B3D26', '#222222'], // Dark Olive Green 1.6:1, Very Dark Gray 1.2:1
  okabeIto: ['#000000'], // 1.1:1
  tolBright: [],
  set2: [],
  dark2: [],
  tableau10: [],
};

/** The palette's colours below its gate on the dark plot background, in palette order. */
const below = (id: Gated): string[] =>
  (COLOR_SCHEMES[id] as readonly string[]).filter((colour) => contrast(colour, PLOT_BG) < GATES[id]);

describe('default palettes on the dark plot background', () => {
  it('the dark plot background is #0b1120', () => {
    expect(PLOT_BG).toBe('#0b1120');
  });

  it("Kelly's colours reach 2:1 on the dark plot background, except the allow-listed #2B3D26 and #222222", () => {
    expect(below('kellys')).toEqual([...ALLOWED.kellys]);
  });

  it.each(['okabeIto', 'tolBright', 'set2', 'dark2', 'tableau10'] as const)(
    "Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 reach 3:1, except Okabe-Ito's #000000 (%s)",
    (id) => {
      expect(below(id)).toEqual([...ALLOWED[id]]);
    },
  );

  it('every allow-listed colour is really below its gate', () => {
    for (const id of Object.keys(ALLOWED) as Gated[])
      for (const colour of ALLOWED[id]) {
        expect(COLOR_SCHEMES[id] as readonly string[], `${colour} is in ${id}`).toContain(colour);
        expect(contrast(colour, PLOT_BG), `${id} ${colour}`).toBeLessThan(GATES[id]);
      }
  });
});
```

- [ ] **Step 7: Run the palette test**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/palette-contrast.test.ts`
Expected: PASS, 8 tests. This test pins today's palettes rather than driving a change (palettes do not change in this phase); to see it bite, temporarily delete `'#222222'` from `ALLOWED.kellys` and re-run: the Kelly test fails with `['#2B3D26', '#222222']` received; restore it. If `@protspace/utils` fails to resolve, build it first: `pnpm --filter @protspace/utils build`.

- [ ] **Step 8: Run the other style tests that read `theme.ts`**

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/styles/styles-integrity.test.ts`
Expected: PASS (the danger value is the only `theme.ts` change; `contrast.ts` is not a stylesheet and sits outside `styles/`).

Run (sandbox disabled: browser mode starts a server): `pnpm --filter @protspace/core exec vitest --run --project browser src/styles/theme.browser.test.ts`
Expected: PASS (it pins no danger value).

- [ ] **Step 9: Format and commit**

Run: `pnpm exec prettier --check packages/core/src/test-support/contrast.ts packages/core/src/styles/theme.ts packages/core/src/styles/theme.test.ts packages/core/src/styles/palette-contrast.test.ts`
Expected: all pass (fix with `--write` and re-run if not).

Commit (sandbox disabled; the hook runs `pnpm precommit`):

```bash
git add packages/core/src/test-support/contrast.ts packages/core/src/styles/theme.ts packages/core/src/styles/theme.test.ts packages/core/src/styles/palette-contrast.test.ts
git commit -m "fix(core): darker light danger red, contrast gates for tokens"
```

Report: `theme.test.ts` and `palette-contrast.test.ts` counts before and after, the danger ratio before and after (4.41 → 5.91 on the hover surface), LEGACY count 7, and the unrun specs listed above.

### Task 6.11: Accessibility of the desktop workbench in both colour schemes

One new spec runs axe over about a dozen main states of the desktop workbench, once with the OS light and once dark, with the theme on System, and fixes what it finds. A shared helper replaces the two existing hand-rolled axe calls.

**Files:**

- Create: `apps/web/tests/helpers/a11y.ts`, `apps/web/tests/workbench-a11y.spec.ts`
- Modify: `apps/web/tests/workbench-filter.spec.ts` (the test "the open panel has no axe violations", `:185-193`), `apps/web/tests/multi-annotation-tooltip.spec.ts` (the test "the open picker has no accessibility violations", `:108-122`): their axe calls use the helper
- Modify: whatever style or element a found violation lives in (expected: colour contrast in a `*.styles.ts`, `workbench.css` or a token; a missing name in a template)

**Interfaces:**

- Consumes: `AxeBuilder` (`@axe-core/playwright` ^4.13, default export; `include`, `exclude`, `withTags`, `disableRules`, `analyze`); `seedTheme` (6.1), `themeButton` (6.2) from `helpers/theme.ts`; `openExplore`, `appBar`, `annotationSelect`, `colorByTrigger`, `selectAnnotation`, `openImportMenu`, `applyFirstCategoryFilter`, `closeFilterPanel`, `clearStatusChip`, `exportAction` (`helpers/explore.ts`); `openLegendSettings`, `openLegendOther` (`helpers/legend.ts`; `order` has 18 values, so the default 10 rows put eight under Other, as `workbench-legend.spec.ts` uses it); `stubStructureRequests`, `clickProteinNearPlotCentre` (`helpers/workbench.ts`); the figure editor from Export → "Figure editor…" (a `ps-dialog` with heading "Figure editor"); Help → "Take the tour" (first step "Welcome to ProtSpace"). The `workbench` project's default `storageState` marks the tour completed, so it never starts on its own.
- Produces:
  - `helpers/a11y.ts`: `expectNoAxeViolations(page: Page, options: { include?: string; exclude?: string[]; disableRules?: string[]; tags?: readonly string[] | null } = {}): Promise<void>` (waits until no finite animation or transition runs, so a fading popover or toast is measured at its final colours; tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` by default, `tags: null` for every rule; expects the list of `rule id: targets` lines to equal `[]`, so a failure reads as one line per violation); `expectColorScheme(page: Page, scheme: 'light' | 'dark'): Promise<void>` (polls until `getComputedStyle(document.documentElement).colorScheme === scheme`).
  - `workbench-a11y.spec.ts`: `for (const colorScheme of ['light', 'dark'] as const) test.describe(…, () => { test.use({ colorScheme }); … })`; `beforeEach` `seedTheme(page, 'system')` (marked for Task 6.13 to delete), `stubStructureRequests(page)` and `openExplore(page)`; each test calls `expectColorScheme` first. States (12): idle workbench; theme menu open; Color by picker open; legend settings popover; legend Other popover; filter panel with one condition; Import menu; Help menu; figure editor dialog; a toast; structure docked (stubbed Mol*); tour step 1.
  - A violation needing more than a small local change gets `disableRules` (or `exclude`) scoped to that state with a comment naming the follow-up, and is listed in the report for the block review.

**Tests:**

- `workbench-a11y.spec.ts` (this task's e2e): 12 states × 2 schemes, no violations.
- `workbench-filter.spec.ts` "the open panel has no axe violations" and `multi-annotation-tooltip.spec.ts` "the open picker has no accessibility violations" keep their scope and disabled rule through the helper (run at the exit). The picker's test ran every axe rule before (no tags) and keeps that breadth through the helper's `tags: null`.
- Unrun at task time (exit): `workbench-filter.spec.ts`, `multi-annotation-tooltip.spec.ts`, and any spec covering an element a fix touched (name them in the report).

LEGACY count: 7.

- [ ] **Step 1: Write the helper**

Create `apps/web/tests/helpers/a11y.ts`:

```ts
/**
 * Accessibility checks for the e2e specs: axe over the WCAG 2.0 and 2.1 A/AA rules, and a check
 * that the page really renders in the colour scheme a test asked for.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Resolves once no finite animation or transition is running (a popover's or a toast's fade), so
 * axe measures colours at their final opacity. Infinite ones (a spinner) are ignored.
 */
async function animationsSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getComputedTiming().endTime !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}

/**
 * Runs axe on the page (or on `include`) and fails with one `rule: targets` line per violation.
 * `disableRules` and `exclude` are for a known, commented exception in one state only. `tags`
 * defaults to the four WCAG A/AA sets; `tags: null` runs every axe rule (best practices too), as
 * the annotation picker's test always ran.
 */
export async function expectNoAxeViolations(
  page: Page,
  options: {
    include?: string;
    exclude?: string[];
    disableRules?: string[];
    tags?: readonly string[] | null;
  } = {},
): Promise<void> {
  await animationsSettled(page);
  let builder = new AxeBuilder({ page });
  const tags = options.tags === undefined ? WCAG_TAGS : options.tags;
  if (tags) builder = builder.withTags([...tags]);
  if (options.include) builder = builder.include(options.include);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const { violations } = await builder.analyze();
  expect(
    violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => JSON.stringify(node.target)).join(', ')}`,
    ),
    'axe violations (rule: targets)',
  ).toEqual([]);
}

/** Asserts the page renders in `scheme`: the theme took effect before anything is measured. */
export async function expectColorScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe(scheme);
}
```

- [ ] **Step 2: Move the two existing axe calls onto the helper**

In `apps/web/tests/workbench-filter.spec.ts`, delete the line `import AxeBuilder from '@axe-core/playwright';`, add `import { expectNoAxeViolations } from './helpers/a11y';` after the `./helpers/explore` import, and in the test `'the open panel has no axe violations'` replace:

```ts
    const results = await new AxeBuilder({ page })
      .include('#wb-filter-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
```

with:

```ts
    await expectNoAxeViolations(page, { include: '#wb-filter-panel' });
```

In `apps/web/tests/multi-annotation-tooltip.spec.ts`, delete `import AxeBuilder from '@axe-core/playwright';`, add `import { expectNoAxeViolations } from './helpers/a11y';` after the `./helpers/explore` import, and in the test `'the open picker has no accessibility violations'` replace:

```ts
    const results = await new AxeBuilder({ page })
      .include('protspace-annotation-select')
      // Each listbox row keeps its eye toggle and ⓘ beside the option, inside a role="none"
      // wrapper (Task 4.16, ruling R5 Q5); this rule counts those buttons as listbox children.
      // Every other rule runs.
      .disableRules(['aria-required-children'])
      .analyze();
    expect(results.violations).toEqual([]);
```

with:

```ts
    await expectNoAxeViolations(page, {
      include: 'protspace-annotation-select',
      // Each listbox row keeps its eye toggle and ⓘ beside the option, inside a role="none"
      // wrapper (Task 4.16, ruling R5 Q5); this rule counts those buttons as listbox children.
      // Every other rule runs.
      disableRules: ['aria-required-children'],
      tags: null,
    });
```

If either file still uses `expect` elsewhere (both do), keep its `@playwright/test` import as it is.

- [ ] **Step 3: Write the spec**

Create `apps/web/tests/workbench-a11y.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { expectColorScheme, expectNoAxeViolations } from './helpers/a11y';
import {
  annotationSelect,
  appBar,
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  colorByTrigger,
  exportAction,
  openExplore,
  openImportMenu,
  selectAnnotation,
} from './helpers/explore';
import { openLegendOther, openLegendSettings } from './helpers/legend';
import { seedTheme, themeButton } from './helpers/theme';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';

/**
 * Design decision 20: axe on the workbench's main states in both themes. The theme stays on
 * System and Playwright emulates the OS scheme, so one spec covers light and dark without
 * touching the switch; the rest of the suite runs light only.
 */

type AxeOptions = NonNullable<Parameters<typeof expectNoAxeViolations>[1]>;

interface State {
  name: string;
  /** Brings the workbench, loaded and idle, into the state. */
  open(page: Page): Promise<void>;
  /** A commented exception for this state only. */
  axe?: AxeOptions;
}

const help = (page: Page) => appBar(page).getByRole('button', { name: 'Help', exact: true });

const STATES: State[] = [
  { name: 'the idle workbench', open: async () => {} },
  {
    name: 'the theme menu',
    open: async (page) => {
      await themeButton(page).click();
      await expect(page.getByRole('menu', { name: 'Theme' })).toBeVisible();
    },
  },
  {
    name: 'the Color by picker',
    open: async (page) => {
      await colorByTrigger(page).click();
      await expect(annotationSelect(page).locator('.dropdown-item').first()).toBeVisible();
    },
    // As in multi-annotation-tooltip.spec.ts: each listbox row keeps its eye toggle and ⓘ beside
    // the option in a role="none" wrapper (Task 4.16, ruling R5 Q5), which this rule counts as
    // listbox children. The idle state runs the rule on the rest of the page.
    axe: { disableRules: ['aria-required-children'] },
  },
  {
    name: 'the legend settings popover',
    open: async (page) => {
      await openLegendSettings(page);
    },
  },
  {
    name: 'the legend Other popover',
    open: async (page) => {
      // 'order' has 18 values, so the default 10 rows leave eight under Other.
      await selectAnnotation(page, 'order');
      await openLegendOther(page);
    },
  },
  {
    name: 'the filter panel with one condition',
    open: async (page) => {
      await applyFirstCategoryFilter(page);
    },
  },
  {
    name: 'the Import menu',
    open: async (page) => {
      await openImportMenu(page);
    },
  },
  {
    name: 'the Help menu',
    open: async (page) => {
      await help(page).click();
      await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
    },
  },
  {
    name: 'the figure editor',
    open: async (page) => {
      await exportAction(page, 'Figure editor…');
      await expect(page.getByRole('dialog', { name: 'Figure editor' })).toBeVisible();
    },
  },
  {
    name: 'a toast',
    open: async (page) => {
      await applyFirstCategoryFilter(page);
      await closeFilterPanel(page);
      await clearStatusChip(page, 'filter');
      const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Filter removed' });
      await expect(toast).toBeVisible();
      // A hovered toast does not time out while axe runs.
      await toast.hover();
    },
  },
  {
    name: 'the docked structure',
    open: async (page) => {
      await clickProteinNearPlotCentre(page);
      await expect(page.locator('.workbench')).toHaveAttribute('data-structure', 'docked');
      await expect(page.locator('#myStructureViewer')).toBeVisible();
      await expect(page.locator('#myStructureViewer .loading-overlay')).toHaveCount(0);
    },
  },
  {
    name: 'the first tour step',
    open: async (page) => {
      await help(page).click();
      await page.getByRole('menuitem', { name: 'Take the tour' }).click();
      await expect(page.locator('.driver-popover .driver-popover-title')).toHaveText(
        'Welcome to ProtSpace',
      );
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe with the OS in ${colorScheme}`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      // Task 6.13 deletes this line: System becomes the default.
      await seedTheme(page, 'system');
      await stubStructureRequests(page);
      await openExplore(page);
    });

    for (const state of STATES) {
      test(`${state.name} has no violations`, async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await state.open(page);
        await expectNoAxeViolations(page, state.axe);
      });
    }
  });
}
```

- [ ] **Step 4: Run the spec and record what it finds**

Run (sandbox disabled: Playwright starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-a11y.spec.ts --project workbench`
Expected: 24 tests run. This is the first time dark contrast is measured on composed pages, so failures are possible and not known in advance; each failing test prints its violations as `rule-id: ["selector", …]` lines. Write every distinct violation (rule, state, scheme, target) into the report before fixing anything. A failure in `expectColorScheme` (not axe) means the theme did not apply: stop and report it, since that is a 6.1/6.2 defect, not an accessibility one.

- [ ] **Step 5: Fix each violation, smallest change first**

Work through the list from Step 4, one violation at a time, in this order of preference:

1. **`color-contrast` on our own element.** Read the element's text and background tokens (DevTools, or `getComputedStyle` in a `page.evaluate`). If readable text uses `--ps-text-faint`, change it to `--ps-text-muted` (Global Constraints: faint is for disabled text and decorative icons only). If a module still hard-codes a light colour or reads the wrong role (e.g. `--ps-surface` text on `--ps-accent`), map it to the right role token in that module's `*.styles.ts` or in `workbench.css`. Then re-run that module's own tests: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts` and the module's own `*.test.ts`/`*.browser.test.ts` (browser: sandbox disabled).
2. **A role-token pair that fails** (both colours are tokens and the tokens are right): do not change `theme.ts` here; the contrast gates of Task 6.10 pin the pairs. Scope `disableRules: ['color-contrast']` to that state with a comment `// Follow-up: <token> on <token> is <ratio>:1 in <scheme>; for the block review`, and report it.
3. **A missing accessible name or a wrong ARIA attribute in our template** (`button-name`, `aria-*`, `label`, `list`/`listitem`): add the label or fix the attribute in the template (a `ps-*` element's `label`, an `aria-label`, a `role`), keeping existing accessible names that helpers and specs key on. Re-run the element's unit or browser test.
4. **Third-party DOM** (Sonner's `[data-sonner-toast]`, driver.js's `.driver-popover`, Mol*'s canvas): fix with CSS in `workbench.css` or `tour/product-tour.css` when the violation is a colour; otherwise scope `exclude: ['<selector>']` to that state with a comment naming the library and the follow-up.
5. **Anything bigger** than about 20 lines, or one that would change a public API, a DOM contract or an accessible name a spec uses: scope `disableRules` to that state with a comment `// Follow-up: <what>; for the block review`, and list it in the report.

A state's `axe` option holds every exception for it, e.g.:

```ts
    // Follow-up: <what and why>; for the block review.
    axe: { disableRules: ['color-contrast'] },
```

Never add an exception to the idle state or to `helpers/a11y.ts`; never disable a rule for both schemes when only one fails (split the state's `axe` on `colorScheme` instead, by turning `axe` into `axe?: (scheme: 'light' | 'dark') => AxeOptions` and passing `state.axe?.(colorScheme)`).

- [ ] **Step 6: Run the spec to verify it passes**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-a11y.spec.ts --project workbench`
Expected: PASS, 24 tests (12 states × 2 schemes), every exception commented and reported.

- [ ] **Step 7: Run the touched unit tests**

For every core or app module a fix touched, run its unit and browser test files (Step 5 named them); then `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/styles/theme.test.ts` if any stylesheet or token changed.
Expected: PASS, counts unchanged except tests a fix added.

- [ ] **Step 8: Format and commit**

Run: `pnpm exec prettier --check apps/web/tests/helpers/a11y.ts apps/web/tests/workbench-a11y.spec.ts apps/web/tests/workbench-filter.spec.ts apps/web/tests/multi-annotation-tooltip.spec.ts` plus every file a fix touched.
Expected: all pass (fix with `--write` and re-run if not).

Commit (sandbox disabled; the hook runs `pnpm precommit`, whose knip step checks that both helper exports have a spec using them):

```bash
git add apps/web/tests/helpers/a11y.ts apps/web/tests/workbench-a11y.spec.ts apps/web/tests/workbench-filter.spec.ts apps/web/tests/multi-annotation-tooltip.spec.ts
git add <every file a fix touched, by path>
git commit -m "test(web): axe on the desktop workbench in both themes"
```

If a fix is a product change large enough to review on its own (more than one module), commit it first as `fix(<core|web>): <what>` with its own tests, then the spec commit above.

Report: the 24 results, every violation found (rule, state, scheme, target) and what was done with it (fixed in which file, or the scoped exception and its follow-up), the unit counts of touched files before and after, LEGACY count, and the specs covering touched elements as unrun at task time.

### Task 6.12: Accessibility of the phone layout in both colour schemes

The phone gets the same axe check on its own states: the More sheet with its Theme row, the bottom panel unfolded on Legend and on Filter, and the folded structure sheet, each in both colour schemes with the theme on System. Fixes follow the rule of Task 6.11.

**Files:**

- Create: `apps/web/tests/mobile-a11y.spec.ts`
- Modify: whatever style or element a found violation lives in

**Interfaces:**

- Consumes: `expectNoAxeViolations(page, { include?, exclude?, disableRules? })`, `expectColorScheme(page, scheme)` (`helpers/a11y.ts`, 6.11); `seedTheme` (`helpers/theme.ts`, 6.1); `openExplorePhone` (stubs the structure requests itself, loads `/explore`, closes the tour), `moreButton`, `moreSheet`, `moreSheetContent`, `panelTab`, `panelFold`, `bottomPanel`, `proteinNearRightEdge`, `tap`, `structureSheet` (`helpers/mobile.ts`); `filterPanel` (`helpers/explore.ts`); `mobile-bars.spec.ts`'s file-level `openMoreSheet` pattern (copied locally: `moreButton(page).tap()`, then `moreSheet` visible); the Theme row from Task 6.2 (`ps-segmented label="Theme"`, a `radiogroup` named "Theme" in the sheet).
- Produces: `mobile-a11y.spec.ts` (project `mobile`, Pixel 7 412×839 with touch) with the same light/dark `describe` loop as `workbench-a11y.spec.ts` and `seedTheme(page, 'system')` in `beforeEach` (marked for Task 6.13 to delete). States (6): idle phone screen; More sheet open; bottom panel on Legend, unfolded; bottom panel on Filter; structure sheet folded after a tap (stubbed Mol*); landscape (740×360) idle.

**Tests:**

- `mobile-a11y.spec.ts` (this task's e2e, `--project=mobile`): 6 states × 2 schemes, no violations.
- Unrun at task time (exit): any spec covering an element a fix touched.

LEGACY count: 7.

- [ ] **Step 1: Write the spec**

Create `apps/web/tests/mobile-a11y.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { expectColorScheme, expectNoAxeViolations } from './helpers/a11y';
import { filterPanel } from './helpers/explore';
import {
  bottomPanel,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelFold,
  panelTab,
  proteinNearRightEdge,
  structureSheet,
  tap,
} from './helpers/mobile';
import { seedTheme } from './helpers/theme';

/**
 * Design decision 20 on phones: axe on the phone layout's own states in both themes, as
 * workbench-a11y.spec.ts does on desktop. The theme stays on System and Playwright emulates the
 * OS scheme.
 */

type AxeOptions = NonNullable<Parameters<typeof expectNoAxeViolations>[1]>;

interface State {
  name: string;
  /** Brings the phone screen, loaded and idle, into the state. */
  open(page: Page): Promise<void>;
  /** A commented exception for this state only. */
  axe?: AxeOptions;
}

const workbench = (page: Page) => page.locator('.workbench');

const STATES: State[] = [
  {
    name: 'the idle phone screen',
    open: async (page) => {
      await expect(workbench(page)).toHaveAttribute('data-layout', 'phone');
    },
  },
  {
    name: 'the More sheet with its Theme row',
    open: async (page) => {
      await moreButton(page).tap();
      await expect(moreSheet(page)).toBeVisible();
      await expect(moreSheetContent(page).getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    },
  },
  {
    name: 'the bottom panel on Legend, unfolded',
    open: async (page) => {
      await expect(panelTab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
      await expect(panelFold(page)).toHaveAccessibleName('Fold panel');
      await expect(bottomPanel(page).locator('#myLegend')).toBeVisible();
    },
  },
  {
    name: 'the bottom panel on Filter',
    open: async (page) => {
      await panelTab(page, 'Filter').tap();
      await expect(panelTab(page, 'Filter')).toHaveAttribute('aria-selected', 'true');
      await expect(filterPanel(page)).toBeVisible();
    },
  },
  {
    name: 'the folded structure sheet after a tap',
    open: async (page) => {
      await tap(page, await proteinNearRightEdge(page));
      await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
      await expect(structureSheet(page)).toBeVisible();
      await expect(page.locator('#myStructureViewer .loading-overlay')).toHaveCount(0);
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe on a phone with the OS in ${colorScheme}`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      // Task 6.13 deletes this line: System becomes the default.
      await seedTheme(page, 'system');
      await openExplorePhone(page);
    });

    for (const state of STATES) {
      test(`${state.name} has no violations`, async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await state.open(page);
        await expectNoAxeViolations(page, state.axe);
      });
    }

    test.describe('landscape', () => {
      test.use({ viewport: { width: 740, height: 360 } });

      test('the idle landscape screen has no violations', async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');
        await expectNoAxeViolations(page);
      });
    });
  });
}
```

Notes for the states: `openExplorePhone` already calls `stubStructureRequests`, so the tap loads the stub viewer. The phone panel starts unfolded on Legend (as `mobile-legend.spec.ts` G6 relies on); the Legend state asserts it rather than driving it, so a changed default fails loudly. `bottomPanel(page).locator('#myLegend')` matches the legend inside the sidebar; if the legend's id moved in an earlier phase, use `bottomPanel(page).locator('protspace-legend')` instead and say so in the report.

- [ ] **Step 2: Run the spec and record what it finds**

Run (sandbox disabled: Playwright starts its own server): `PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-a11y.spec.ts --project=mobile`
Expected: 12 tests run (5 states + landscape, × 2 schemes). Failures are possible and not known in advance; each prints its violations as `rule-id: ["selector", …]` lines. Write every distinct violation (rule, state, scheme, target) into the report before fixing. A violation that `workbench-a11y.spec.ts` also reports on desktop and that Task 6.11 left as a scoped exception gets the same exception here, with the same follow-up comment. A failure in `expectColorScheme` means the theme did not apply on the phone: stop and report it.

- [ ] **Step 3: Fix each violation, smallest change first**

Apply Task 6.11 Step 5's order to each violation, restated for the phone:

1. `color-contrast` on our own element: readable text on `--ps-text-faint` becomes `--ps-text-muted`; a hard-coded or wrong role becomes the right `--ps-*` role, in the element's `*.styles.ts` or in `workbench.css` (phone rules sit under `.workbench[data-layout='phone']`, landscape under `[data-layout='landscape']`). Re-run that module's own unit/browser tests and `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts` (browser tests: sandbox disabled).
2. A role-token pair that fails with correct tokens: no `theme.ts` change here; scope `axe: { disableRules: ['color-contrast'] }` to that state with `// Follow-up: <token> on <token> is <ratio>:1 in <scheme>; for the block review`, and report it.
3. A missing name or wrong ARIA attribute in our template: fix it in the template, keeping accessible names helpers key on (`More view options`, `Fold panel`/`Unfold panel`, `Show the structure`/`Hide the structure`, the tab names).
4. Third-party DOM (Sonner, driver.js, Mol*): CSS for a colour; else `exclude` scoped to that state with a comment.
5. Anything larger than about 20 lines or touching a public API, a DOM contract or a spec-keyed name: scope `disableRules` to that state with a `// Follow-up: …; for the block review` comment and report it.

For the landscape test, an exception goes in its own `expectNoAxeViolations(page, { … })` call with the comment above it. Never add an exception to the idle phone state or to `helpers/a11y.ts`; if only one scheme fails, make `axe` a function of the scheme as Task 6.11 Step 5 describes.

- [ ] **Step 4: Run the spec to verify it passes**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-a11y.spec.ts --project=mobile`
Expected: PASS, 12 tests, every exception commented and reported.

- [ ] **Step 5: Run the touched unit tests**

For every core or app module a fix touched, run its unit and browser test files; then `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts src/styles/theme.test.ts` if any stylesheet or token changed.
Expected: PASS, counts unchanged except tests a fix added. With no fix, skip this step and say so.

- [ ] **Step 6: Format and commit**

Run: `pnpm exec prettier --check apps/web/tests/mobile-a11y.spec.ts` plus every file a fix touched.
Expected: all pass (fix with `--write` and re-run if not).

Commit (sandbox disabled; the hook runs `pnpm precommit`):

```bash
git add apps/web/tests/mobile-a11y.spec.ts
git add <every file a fix touched, by path; omit this line when nothing was fixed>
git commit -m "test(web): axe on the phone layout in both themes"
```

Report: the 12 results, every violation found (rule, state, scheme, target) and what was done with it, unit counts of touched files before and after, LEGACY count, and the specs covering touched elements (likely `mobile-bars.spec.ts`, `mobile-legend.spec.ts`, `mobile-explore-layout.spec.ts`, `mobile-plot-touch.spec.ts`) as unrun at task time.

### Task 6.13: The default follows the system

The last commit of the phase: with nothing stored, the explore page follows the OS. The store's default and the boot script's literal flip together, and the accessibility specs stop seeding System because it is now the default.

**Files:**

- Modify: `apps/web/src/explore/theme-defaults.ts` (`DEFAULT_THEME = 'system'`; the comment goes), `apps/web/index.html` (the boot default literal)
- Modify: `apps/web/src/explore/theme-state.test.ts` (default expectations, if any hard-code `'light'`)
- Modify: `apps/web/tests/workbench-theme.spec.ts` (the "nothing stored" test), `apps/web/tests/workbench-a11y.spec.ts`, `apps/web/tests/mobile-a11y.spec.ts` (the `seedTheme(page, 'system')` lines go)

**Interfaces:**

- Consumes: `DEFAULT_THEME`, the boot script and `theme-boot.test.ts`'s "nothing stored … set DEFAULT_THEME" case (6.1, which now checks `'system'` through the constant); `htmlTheme`, `DARK_SURFACE` (6.1); in `workbench-theme.spec.ts` the file-level `loadWithExploreChunkHeld(page, path?)`, `backgroundOf(locator)`, `workbench(page)` and `WHITE` (6.1); `seedTheme` in the two accessibility specs (6.11, 6.12).
- Produces: `DEFAULT_THEME = 'system'` in both places; `theme-boot.test.ts` unchanged and green (it compares with the constant).

**Tests:**

- `theme-state.test.ts`: one case added, "with nothing stored the choice is System"; the rest are green unchanged (none hard-codes `'light'`: they compare with `DEFAULT_THEME` or use `'dark'`, which is never the default). `theme-boot.test.ts`: unchanged; it fails between the two flips, which is the point of the pin.
- `workbench-theme.spec.ts` (this task's e2e): "with nothing stored the page follows the OS" replaces "with nothing stored the page is Light": `data-theme` is `system`; with `colorScheme: 'dark'` the first paint and `.workbench` are `DARK_SURFACE`; with `'light'` they are white; and "an explicit Light ignores the OS" (Light seeded, `colorScheme: 'dark'`: `data-theme` `light`, `.workbench` white), which keeps the deleted test's last check.
- Unrun at task time (exit): `workbench-a11y.spec.ts`, `mobile-a11y.spec.ts` (seeding removed), every spec (the default changed; Playwright's light `colorScheme` keeps them light).

LEGACY count: 7.

Before starting, confirm the files this task edits still read as Tasks 6.1, 6.11 and 6.12 left them:

- `grep -n "DEFAULT_THEME" apps/web/src/explore/theme-defaults.ts` shows `export const DEFAULT_THEME: ThemeChoice = 'light';` under a comment naming Task 6.13.
- `grep -n "var theme = " apps/web/index.html` shows `        var theme = 'light';` inside `<script data-theme-boot>`.
- `grep -n "nothing stored" apps/web/tests/workbench-theme.spec.ts` shows the single test `'with nothing stored the page is Light'`.
- `grep -n "toBe('light')" apps/web/tests/workbench-theme.spec.ts`: every hit except the one inside `'with nothing stored the page is Light'` follows a `chooseTheme(page, 'Light')` or a `seedTheme(page, 'light')` (Task 6.5's quick-PNG test chooses Light first). Fix any other default-dependent assertion the same way before flipping.
- `grep -n "seedTheme" apps/web/tests/workbench-a11y.spec.ts apps/web/tests/mobile-a11y.spec.ts` shows, in each file, one import and one `await seedTheme(page, 'system');` in `test.beforeEach`.

If one of them differs, apply the intended change to what is there and say so in the report.

- [ ] **Step 1: Write the failing default test**

In `apps/web/src/explore/theme-state.test.ts`, add inside `describe('theme store', () => {`, after the test `'defaults to DEFAULT_THEME with nothing stored'`:

```ts

  it('with nothing stored the choice is System', () => {
    // Design decision 16: the explore page follows the OS until the user picks a theme.
    expect(getTheme()).toBe('system');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: FAIL, 1 test: `with nothing stored the choice is System`: `expected 'light' to be 'system'`. The other 9 in `theme-state.test.ts` and all 19 in `theme-boot.test.ts` pass.

- [ ] **Step 3: Flip the store's default**

In `apps/web/src/explore/theme-defaults.ts`, replace

```ts
/**
 * The choice with nothing (or nothing valid) stored. Light while the phase's surfaces turn dark;
 * Task 6.13 flips it to 'system', together with the boot script's literal in index.html.
 */
export const DEFAULT_THEME: ThemeChoice = 'light';
```

with

```ts
/** The choice with nothing (or nothing valid) stored: follow the OS (design decision 16). */
export const DEFAULT_THEME: ThemeChoice = 'system';
```

- [ ] **Step 4: Run the tests: the pin catches the boot script**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: `theme-state.test.ts` PASS, 10 tests. `theme-boot.test.ts` FAIL, 6 tests: every row of `'%s sets DEFAULT_THEME'` (`expected 'light' to be 'system'`): the boot script still defaults to Light. This is the drift the test exists to catch.

- [ ] **Step 5: Flip the boot script's default**

In `apps/web/index.html`, inside `<script data-theme-boot>`, replace

```js
        var theme = 'light';
```

with

```js
        var theme = 'system';
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/theme-state.test.ts src/explore/theme-boot.test.ts`
Expected: PASS. `theme-state.test.ts` 10 tests, `theme-boot.test.ts` 19 tests.

- [ ] **Step 6: The "nothing stored" e2e test follows the OS**

In `apps/web/tests/workbench-theme.spec.ts`, delete the whole test inside `test.describe('theme choice', () => {`:

```ts
  test('with nothing stored the page is Light', async ({ page }) => {
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('light');
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
    // An explicit Light ignores the OS.
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await backgroundOf(workbench(page))).toBe(WHITE);
  });
```

and append to the end of the file:

```ts

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`nothing stored on a ${colorScheme} OS`, () => {
    test.use({ colorScheme });

    test('with nothing stored the page follows the OS', async ({ page }) => {
      const surface = colorScheme === 'dark' ? DARK_SURFACE : WHITE;
      const { first, beforeChunk, release } = await loadWithExploreChunkHeld(page);

      expect(await htmlTheme(page)).toBe('system');
      if (colorScheme === 'dark') {
        expect(first).toBe(DARK_SURFACE);
      } else {
        // A light OS paints no boot colour: the body is transparent until index.css whitens it.
        expect(first).not.toBe(DARK_SURFACE);
      }
      expect(beforeChunk).toBe(surface);

      release();
      await waitForExploreDataLoad(page);
      expect(await htmlTheme(page)).toBe('system');
      await expect.poll(() => backgroundOf(workbench(page))).toBe(surface);
    });
  });
}

// The deleted Light test also checked that an explicit Light ignores a dark OS; keep that check.
test.describe('Light stored on a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  test('an explicit Light ignores the OS', async ({ page }) => {
    await seedTheme(page, 'light');
    await openExplore(page);
    expect(await htmlTheme(page)).toBe('light');
    await expect.poll(() => backgroundOf(workbench(page))).toBe(WHITE);
  });
});
```

(`seedTheme` is already in the file's `./helpers/theme` import from Task 6.1; add it if it is missing.)

After the deletion, `openExplore` is still used by other tests in the file (the 6.1 wordmark test and the Task 6.2 switch tests); leave its import. Check with `grep -n "openExplore(" apps/web/tests/workbench-theme.spec.ts` (at least one hit besides the import).

- [ ] **Step 7: The accessibility specs stop seeding System**

In `apps/web/tests/workbench-a11y.spec.ts` and in `apps/web/tests/mobile-a11y.spec.ts`:

- delete the line `    await seedTheme(page, 'system');` (its indentation may differ) in `test.beforeEach`, together with the comment line directly above it if that comment names Task 6.13 or says System is not yet the default;
- remove `seedTheme` from the `./helpers/theme` import; if it was the only name imported there, delete the import line.

Then check: `grep -n "seedTheme" apps/web/tests/workbench-a11y.spec.ts apps/web/tests/mobile-a11y.spec.ts` prints nothing. Each test still starts with `expectColorScheme(page, colorScheme)`, which now holds through the default: with nothing stored the page is `system` and follows Playwright's `colorScheme`.

`seedTheme` keeps its consumer (`workbench-theme.spec.ts`), so knip stays green.

- [ ] **Step 8: Run the e2e spec**

Run: `pnpm --filter @protspace/app type-check`
Expected: no errors.

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-theme.spec.ts`
Expected: PASS, every test in the file: two more than before this task (the Light test went; the two `follows the OS` tests and "an explicit Light ignores the OS" came). The 6.2 switch tests do not depend on the default (the Escape test focuses whichever radio is checked; the icon test chooses each theme before reading the icon).

Run: `pnpm exec prettier --check apps/web/index.html apps/web/src/explore/theme-defaults.ts apps/web/src/explore/theme-state.test.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/workbench-a11y.spec.ts apps/web/tests/mobile-a11y.spec.ts`
Expected: all files pass.

Unrun at task time (the exit runs them first, then every spec): `workbench-a11y.spec.ts`, `mobile-a11y.spec.ts`. Every other spec runs in Playwright's default light `colorScheme` and the perf contexts pin `theme: 'light'` (Task 6.4), so the new default should change nothing there; the exit's full run confirms it.

- [ ] **Step 9: Commit**

```bash
git add apps/web/index.html apps/web/src/explore/theme-defaults.ts apps/web/src/explore/theme-state.test.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/workbench-a11y.spec.ts apps/web/tests/mobile-a11y.spec.ts
git commit -m "feat(web): follow the system theme by default"
```

(Sandbox disabled for the commit. This is the phase's last product commit; the block review reads it together with Tasks 6.11 and 6.12, whose specs it edits.)

Report: `theme-state.test.ts` 10, `theme-boot.test.ts` 19, the `workbench-theme.spec.ts` count, LEGACY 7.

## Phase 6 exit

Run once, after Task 6.13 and the last block's fixes, in this order (sandbox disabled where noted):

1. Unrun-first: the tablet bar first, because commit `3f987c91` sized it to just fit and the Theme button takes about 38 px from search (Task 6.2 measures it at task time in the `workbench` project; these are its `mobile`-project twins):

   ```
   PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-explore-layout.spec.ts --project=mobile -g "800 px tablet"
   PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-bars.spec.ts --project=mobile -g "portrait tablet"
   ```

   If the placeholder no longer fits, fix the bar in `workbench.css` (tablet rules only) and re-run both; never drop the Theme button. Then every spec listed under "Unrun at task time" by any task, first `mobile-bars.spec.ts`, `workbench-a11y.spec.ts`, `mobile-a11y.spec.ts`, `workbench-theme.spec.ts`, `workbench-structure.spec.ts`, `figure-editor.spec.ts`, `workbench-import-export.spec.ts`, `eat-visualization.spec.ts`, `product-tour.spec.ts`, `density-layer.spec.ts`.
2. Suites against the baseline counts: `pnpm --filter @protspace/utils exec vitest --run`; `pnpm --filter @protspace/core exec vitest --run` (unit and browser, sandbox disabled); `pnpm --filter @protspace/app exec vitest --run`.
3. Full e2e: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (every project); then `--project=mobile` three times and `workbench-theme.spec.ts` with `--repeat-each 10` (first-paint and live-flip timing).
4. `pnpm perf:counts` (all budgets, `theme-switch` included, `load` and `idle` at the baseline) and `pnpm perf` at 573K within the phase-5 numbers (pinned light theme: no change expected); `theme-switch` appears in `pnpm perf` output. `pnpm perf:scale` is not run (opt-in), but `perf-scale.spec.ts` must still type-check (`pnpm quality`, step 5).
5. `pnpm quality`, `pnpm format:check`, `pnpm docs:annotations:check`, `pnpm docs:examples:check`, `pnpm docs:build`; `LEGACY` count, `wc -l` of `scatter-plot.ts`, `legend.ts`, `structure-viewer.ts`, `workbench.css`.
6. Screenshots for the user, light and dark, at 1280×720 (idle with a dataset that has Other and N/A; legend settings and Other popovers; filter panel; tooltip and projection card; EAT connectors; docked and floating structure with a real Mol* load, not the stub; figure editor with a transparent figure; a toast; tour step 1; theme menu open), 800×1280 tablet, 412×839 phone (More sheet with the Theme row; bottom panel; structure sheet) and 740×360 landscape. Compare with `mockups/workbench-dark.png`. Visual review items for the user's call: the point rim darkening on Kelly's `#222222` and `#2B3D26` over `#0b1120` (R2 Q6, deferred here); the phone tap dim (`phone-dim.ts`, 0.25) on the dark plot; Mol*'s own overlays on a dark canvas; Sonner's close button.
7. Phase 7 captures that need dark variants (from R3), for the 7.2 runner: the workbench overview; the legend with its popovers; the plot tooltip and the projection card; the docked and the floating structure viewer; the filter panel; the figure editor (dark chrome, light preview); toasts and the loading overlay; a tour step; the More sheet and the phone bottom panel; the theme switch itself (desktop menu and phone row). Example-gallery thumbnails stay light (they are export renders). Captures set `colorScheme: 'dark'` with the theme on System (or seed `protspace:theme`).
8. `tasks.md` section 6 ticked; the ledger records the exit counts.

<!-- prettier-ignore-end -->
