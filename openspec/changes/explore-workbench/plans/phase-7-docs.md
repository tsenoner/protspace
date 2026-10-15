# Explore Workbench, Phase 7: Docs, docs media and tour (shared page helpers, capture runner with light/dark variants and GIF budget, every docs image regenerated, tour rewrite plus What's new, user guide and developer docs) — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the docs match the workbench and keep them that way. The e2e tests and the docs captures share one set of page helpers in `apps/web/tests/helpers/`, which find controls by role and name and wait for signals, not timers. One capture runner turns a manifest of entries (one per image: name, kind, viewport, themes, dataset, layout, setup and steps, target, GIF budget, the docs pages that show it) into every image under `docs/explore/images/`: desktop PNGs at 1280×720 and device scale 2, phone and tablet PNGs on an emulated Pixel 7, `-dark` twins of the main screenshots, GIFs recorded at 1× and converted under a 3 MiB budget, and the five example thumbnails, which move here from the `examples-live` e2e project. A file-only lint in the pre-commit hook keeps the manifest, the image files and the docs pages in step (references, outputs, `-dark` pairs, GIF sizes, orphans, anchors, stale terms). Every image is regenerated; the images named after the removed control bar are deleted; the docs show the dark twins when VitePress is dark. The product tour is rewritten for the workbench with a step list per layout and pointer type, under a new storage key; returning visitors (the old key set) get a short "What's new" tour once. The user guide is rewritten around the workbench (the control-bar page splits into "Bars and Tools" and "Filtering"; new sections for the sidebar, light and dark, help and the tour, keyboard shortcuts, phones and tablets) and the developer docs gain theming for embedders.

**Architecture:** The helpers stay in `apps/web/tests/helpers/` (e2e, `apps/web/tsconfig.e2e.json`, ESM) and are imported by the captures in `scripts/docs-screenshots/` (root Playwright config, CommonJS, `scripts/tsconfig.json`, strict), so every helper the captures reach is strict-clean and free of `import.meta`. The runner is three layers: `capture-plan.ts` (types, constants, file naming, variant expansion, manifest validation, the GIF ladder; pure, no Node or Playwright values, so the app's Vitest can test it), `runner.ts` (Playwright: one `test.describe` per entry and theme with its own context options, the open-and-wait path, the shutter, video and the GIF sidecar), and `scenes/*.ts` (the entries, grouped by docs page, concatenated by `manifest.ts`). `gif.ts` converts recorded videos after the run; `check.ts` runs the pure checks of `docs-lint.ts` against the files on disk in the pre-commit hook, and `apps/web/src/explore/docs-images.test.ts` runs the same checks against the docs pages in `pnpm test`. The tour becomes data (`apps/web/src/tour/tour-steps.ts`, no driver.js) mapped to driver.js steps at start time by `product-tour.ts`, which `runtime.ts` and the Help menu load lazily.

**Tech Stack:** Playwright 1.61 (root config for the captures; `apps/web/tests/playwright.config.ts` projects `workbench` Desktop Chrome 1280×720 and `mobile` Pixel 7 for the e2e), ffmpeg (`/opt/homebrew/bin/ffmpeg`; two-pass palette GIF), tsx, Vitest 4.1.9 (app: node), VitePress (default theme, markdown-it-attrs), driver.js ^1.4.0, React 19, Lit 3, the kit (`ps-*`, `kit/layers.ts`).

**Spec:** `openspec/changes/explore-workbench/design.md`: decision 19 (docs media pipeline) is the core; also 20 (testing), 16 (dark variants; exports and thumbnails light), 17 (phone captures, the phone tour), 18 (files of about 800 lines, one way to do each job), 1 ("Take the tour" in Help), 11 (one Escape order), and the Migration Plan (new tour key; What's new once for returning visitors). `proposal.md` for scope (capabilities `docs-media-generation`, `explore-help`, `e2e-validation`). `tasks.md` section 7, rewritten to this plan's sixteen tasks in the commit that adds the plan. Research notes `.superpowers/research/phase-7/R1`–`R3` map the current code with file:line; the user adopted every recommended answer in them (Rulings records them and where notes disagreed). Not pulled in: the `example-datasets` spec delta and every other spec file (8.3), deleting `tokens.ts`/`mixins.ts`/`overlay-mixins.ts` and emptying the style lint's `LEGACY` (8.1), the real-device pass (8.2), retiring `feat/mobile-responsive` (8.4).

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. This plan was written against `a8cb13ca` (phase 6 complete). If an anchor has moved, apply the intended change to the current code and say so in the report.

## Global Constraints

From phases 1–6, unchanged:

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
- Runtime elements are rendered by React exactly once, unconditionally, with stable ids, never keyed or moved; phone, tablet and landscape layouts are CSS on the same tree. The ids `#myPlot` and `#progressive-loading` and the `data-driver-id` values `scatterplot`, `legend`, `other-row`, `import`, `projections`, `search`, `selection`, `data-actions`, `help` and `theme` are kept for the tour, the e2e and the perf suites (this phase adds `view-bar`, `dataset`, `rail`, `more`, `search-toggle`). `#myDataLoader` stays mounted, hidden. `#myStructureViewer` never changes parent (a disconnect disposes Mol*).
- React → runtime goes through the layout store or DOM events on elements the runtime wires by id; a React component may also call a public method of a core element it finds by id, but never reads runtime state off an element. Runtime → React goes through `workbench-status.ts` or `layout-state.ts`. React sets kit properties through props and listens to `ps-*` events with a ref and `addEventListener`.
- The shell (`apps/web/src/workbench/`) imports `@protspace/core` only as types (ESLint guard, `eslint.config.mjs`); values it needs come from `@protspace/utils` or the app's own modules (`apps/web/src/explore/*`, `apps/web/src/lib/*`). Kit elements are used as custom-element tags.
- No ancestor of `#myImportMenu`, `#myExportMenu`, or any element that holds a popover gets `display: none` in any layout: a `popover="manual"` inside a `display: none` subtree opens as a 0×0 box. On phones and in landscape `[data-workbench='app-bar-actions']` is rendered at 0×0 and hides every child except `.wb-data-actions` and `ps-menu` (`workbench.css` ~911 and ~1569).
- One plot resize per layout change; the plot never animates. A theme change is not a layout change: it never changes `#myPlot`'s box.
- Layout persists only under `protspace:layout:v1`; layout never goes into the URL. The theme persists only under `protspace:theme` (JSON through `setStorageItem`; `DEFAULT_THEME = 'system'`). Stored legend settings, `protspace_publishState` and the OPFS `protspace-last-import` directory keep their keys and formats.
- The legend's public surface, DOM contract and persistence stay as phases 3–6 left them. `scatter-plot.ts`, `legend.ts` and `structure-viewer.ts` take no change this phase.
- E2E: desktop specs stay `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Phone, tablet and landscape specs are `apps/web/tests/mobile-*.spec.ts` (project `mobile`, Pixel 7). Specs reach controls through helpers (`helpers/explore.ts`, `helpers/workbench.ts`, `helpers/legend.ts`, `helpers/mobile.ts`, `helpers/theme.ts`, `helpers/a11y.ts`, and this phase's `helpers/plot.ts`, `helpers/structure.ts`, `helpers/figure.ts`, `helpers/examples.ts`) that find them by role, accessible name or tag; a helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement, state and computed colours, not 3D pixels.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) also checks `apps/web/src/workbench/workbench.css` and `apps/web/src/tour/product-tour.css` for raw colours and for reads of `--ps-*` variables `theme.ts` does not define. Sizes come from tokens: `--ps-touch-target` 40 px, `--ps-control-sm` 28, `--ps-control-md` 32, spaces `--ps-space-0-5` 2 … `-6` 24 px (no 16), radii `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`.
- `ps-icon-button` (`icon`, `label`, `pressed`, `size`, `tooltip-placement`, `expanded`, `hasPopup`), `ps-button` (`variant`), `ps-menu`/`ps-menu-item` (`menuitem`, `menuitemradio`), `ps-dialog` (`heading`, `size`; role `dialog` named by its heading). `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void` (exported from `@protspace/core`), `ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 }`.

Environment (from the phase 1–6 ledgers; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run need the Bash sandbox disabled (`EPERM listen ::1` inside it). `--project unit` works inside the sandbox.
- `pnpm add`/`pnpm install` and `git commit` need the sandbox disabled (the hook needs network and writes outside it). Stage files by path, never `git add -A`.
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; use `pnpm --filter @protspace/app exec vitest --run <file>` and `pnpm --filter @protspace/utils exec vitest --run <file>`.
- App unit tests run in node with no DOM and cannot load Lit (`apps/web/vitest.config.ts`): stub `localStorage`, `window`, `document` and `matchMedia` with `vi.stubGlobal` (`layout-state.test.ts:38,266-271`). An app test cannot import `node:fs` (`tsconfig.app.json` has no Node types); it reads a repository file through `import.meta.glob('<relative path>', { query: '?raw', import: 'default', eager: true })` and lists files through the keys of a non-eager `import.meta.glob`, as `src/explore/example-datasets-docs.test.ts` does, and it may import a pure module from outside `src/` by relative path (that test imports `docs/scripts/machine-path`). React components are covered by e2e only.
- `@protspace/utils` `getStorageItem`/`setStorageItem` JSON-encode: anything reading such a key raw uses `JSON.parse`/`JSON.stringify`. The tour key is not JSON: its value is the bare kind string.
- Playwright contexts default to `colorScheme: 'light'`; `page.emulateMedia({ colorScheme })` flips `prefers-color-scheme` live. The perf contexts pin the light theme and the layout through `exploreStorageState` (`tests/helpers/tour-storage-state.ts`).
- `pnpm perf:counts` imports `perf/datasets/phosphatase.parquetbundle` (fetch once with `pnpm perf:fetch --only phosphatase`, network, sandbox disabled); budgets live in `apps/web/tests/perf/budgets.json`.
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing. The docs build scans untracked files under `docs/`: leave no scratch markdown there. Relative image paths in markdown and in raw `<img src>` become Vite imports, so a missing image fails `docs:build`; VitePress checks dead page links but never anchors.
- Playwright's `ControlOrMeta` sends Meta on a macOS host but the app reads the modifier from the user agent (Control in headless Chromium); use `Control` explicitly in specs that need the modifier.
- The plot area holds two `role="status"` regions (status corner and selection bar): scope `getByRole('status')` to its element. The dataset button's accessible name is `{name}, {n} proteins, switch dataset` (`datasetSwitcher` helper). Use `--project=mobile` (with `=`) for the mobile project.
- The e2e Mol* stub (`MOLSTAR_STUB` in `tests/helpers/workbench.ts`, installed by `stubStructureRequests(page)`) builds a viewer that draws nothing; e2e asserts placement and state. The docs captures load the real Mol* (jsDelivr) and AlphaFold, so a structure capture needs network.
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race), the `numeric-binning` "hover point" test under full-suite load, `mobile-plot-touch.spec.ts:351`; re-run once alone before investigating.
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.
- The captures (phase 7): they start their own Vite server and a headed Chromium on macOS (`headless: !!process.env.CI`, for GPU WebGL), so run them with the sandbox disabled. The product demo is `apps/web/public/data.parquetbundle`; the other examples need `pnpm examples:fetch` (network, sandbox disabled; `swissprot` is large). The old captures at `a8cb13ca` are the reference for what each image shows: `git show a8cb13ca:scripts/docs-screenshots/capture-static.spec.ts` (interface-overview 177, scatterplot-example 186, legend-panel 195, structure-viewer 204, figure-editor 507–656, filter 662, export 751, contours 823 and 856), `capture-animations.spec.ts` (zoom 157, select-single 207, select-box 347, duplicate-badges 459, legend-toggle 681, legend-reorder 781, legend-others 878; `clusterScreenPoints` at 28), `capture-eat-static.spec.ts` (21, 38), `capture-eat-animations.spec.ts` (eat-connectors 91, eat-reliability 136), `eat-helpers.ts` (`pickProvenanceDemoPair` 91), `helpers.ts` (visual indicators 578–919).

**Execution rule (user, 2026-10-13):** per task, run only the unit test files for the code you touch plus at most ONE e2e spec file (filtered with `-g "<title>"` and `--project workbench` or `--project=mobile` as needed), and capture only the task's own images (`pnpm docs:screenshots -g "<file>"`, `pnpm docs:animations -g "<file>" && pnpm docs:gifs <name>`). The full suites, the full e2e run, `pnpm perf:counts`, `pnpm perf` and the full `pnpm docs:images` run once, in "Phase 7 exit". Every task lists the existing e2e specs its change could reach under "Unrun at task time" so the exit run checks them first.

Baseline: run the suites at the start of the phase and use those counts, not phase 6's: `pnpm --filter @protspace/core exec vitest --run` (sandbox disabled), `pnpm --filter @protspace/utils exec vitest --run`, `pnpm --filter @protspace/app exec vitest --run`, `PLAYWRIGHT_PORT=8475 pnpm test:e2e` and `pnpm perf:counts`. Record them in `.superpowers/sdd/phase-7-docs/progress.md`; every task report gives the counts of the files it ran before and after, and the list of image files it wrote or deleted with their sizes.

Phase 7:

- **Shared helpers.** The captures import helpers from `apps/web/tests/helpers/` by relative path (`../../apps/web/tests/helpers/<module>`). Every helper module the captures reach is listed in `scripts/tsconfig.json` `include` and passes `pnpm type-check:scripts` (strict, `noUnusedLocals`, `noUnusedParameters`). Such a module never uses `import.meta` and never imports `helpers/fixtures.ts` or `helpers/example-fixtures.ts` (both resolve files with `import.meta.url`); `apps/web/src/explore/example-datasets.ts` is fine (its `import.meta.env?.` is written for Node). Capture code never reads `shadowRoot`. The scenes (`scripts/docs-screenshots/scenes/**`) contain no `waitForTimeout` and no `.evaluate(`: plot data reads that have no DOM go through typed helpers (`helpers/plot.ts`), and pacing goes through `cap.hold(ms)`, whose `waitForTimeout` in `runner.ts` is the only timer in capture code. `indicators.ts` may inject its overlays with `page.evaluate`/`addInitScript`. `scripts/tsconfig.json` uses lib ES2023 (Task 7.1). `capture-plan.ts` and `docs-lint.ts` are also compiled by `apps/web/tsconfig.app.json` (target ES2020, through `docs-images.test.ts`); the hoisted `@types/node` supplies `at`/`replaceAll` types there, but keep these two pure modules to ES2020 calls anyway (no `replaceAll`, `Array.prototype.at`, `Object.hasOwn`).
- **Capture server.** The root `playwright.config.ts` starts its own server: `pnpm turbo run build --filter=@protspace/app^... && pnpm --filter @protspace/app exec vite --port <port> --strictPort`, port `process.env.DOCS_CAPTURE_PORT ?? '8096'`, `reuseExistingServer: false`, no `VITE_STARTUP_DATASET_URL`, `timeout: 180_000`, `gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 }`. `PLAYWRIGHT_BASE_URL` set → no server, as today. `workers: 1`, `retries: 0`, `fullyParallel: false`, `headless: !!process.env.CI`. Projects: `docs-png` (`testMatch: /capture-png\.spec\.ts$/`, video off) and `docs-gif` (`testMatch: /capture-gif\.spec\.ts$/`, no `video` option: Playwright 1.61 makes `video` worker-scoped, so each GIF test opens its own context with `recordVideo`, Task 7.4).
- **Capture contexts.** Viewports: `desktop` 1280×720 (Desktop Chrome; `deviceScaleFactor` 2 for PNGs unless the entry says `scale: 1`, 1 for GIFs); `phone` = `devices['Pixel 7']` (412×839, touch, coarse pointer) without `defaultBrowserType`; `tablet` = the same descriptor at 800×1280. Phone and tablet PNGs are captured at device scale 2, not Pixel 7's 2.625 (touch emulation comes from `isMobile`/`hasTouch`, not the scale; the docs show them 240–320 px wide). `colorScheme` = the variant's theme with the theme left on System (`exploreStorageState(baseURL, { layout, theme: 'system' })`, which also marks the tour seen); `reducedMotion: 'reduce'` for PNGs, `'no-preference'` for GIFs. URL: `/explore?perfCounters=1`, or `/explore?dataset=<id>&perfCounters=1` for an example. Order: load (product demo asserted, never the e2e fixture), `waitForExploreDataLoad`, `plotSettled`, entry `setup`, entry `steps`, then (PNG, unless `keepPointer`) park the pointer at (1, 1) and assert no kit tooltip is open, then the shutter (`animations: 'disabled'`, `caret: 'hide'`).
- **Files.** Every output lives under `docs/explore/images/`. File name = entry name, plus `-dark` for the dark variant, plus `.png` or `.gif` (`interface-overview.png`, `interface-overview-dark.png`, `examples/demo.png`, `zoom.gif`). Names are lowercase kebab-case, optionally under `examples/`. Test titles are the file names, so `-g "<file>"` captures one image.
- **Variants.** `-dark` twins for PNG screenshots on the phase-6 exit list only (Rulings); GIFs, example thumbnails, menu crops, EAT crops and the figure editor's close-ups are light only. A dark twin is never a GIF.
- **GIFs.** Recorded as `.webm` into `temp-videos/` (git-ignored) with a JSON sidecar; converted after the run by `pnpm docs:gifs`: ffmpeg `palettegen=stats_mode=diff` then `paletteuse=dither=bayer:bayer_scale=5`, start at 30 fps and 1000 px wide, and step down the ladder fps 30 → 20 → 15, then width 1000 → 800 → 640 (at 15 fps) until the file fits the entry's budget (default `DEFAULT_GIF_BUDGET` = 3 × 1024 × 1024 bytes, per-entry `budgetBytes` override). Over budget at the last rung fails the run, keeps the `.webm` and leaves the previous GIF in place. The trim at the start is measured (end of `setup`), not a constant. Cursor, click and key overlays (`indicators.ts`) appear in GIFs only and read `--ps-*` tokens.
- **Docs images in the pages.** A light image with a dark twin is written as a pair: `![alt](./images/x.png){.light-only}` immediately followed by `![alt](./images/x-dark.png){.dark-only}` (raw `<img>`: `class="light-only"` and `class="dark-only" loading="lazy"`). The VitePress config carries one head rule: `html.dark img.light-only,html:not(.dark) img.dark-only{display:none}`. A page task commits an old image's deletion together with the edit that removes its reference. A raw `<img>` in a pair carries no `display` in its inline `style` (an inline `display` beats the head rule and shows both twins), sits on one line, and its dark twin is on the very next line with `loading="lazy"`. Markdown images are lazy already (`markdown.image.lazyLoading: true`, `docs/.vitepress/config.mts:32`). If Task 7.9 finds markdown-it-attrs drops the class on images, every later pair is a raw `<img>` pair, and 7.9's report and the ledger say so.
- **Docs lint.** `pnpm docs:images:check` (`tsx scripts/docs-screenshots/check.ts`) runs in `pnpm precommit` between `docs:examples:check` and `docs:build`, finishes in under 3 s, and fails on: a manifest output missing on disk; a file under `docs/explore/images/` (README and non-image files aside) with no manifest entry and not in `LEGACY_IMAGES`; a GIF over its budget; an entry whose `docs` pages do not reference its output, or a page referencing a file under `images/` that does not exist; an image file no page references; a `-dark` file without its light twin, a light image with a twin referenced without the pair markup, or a `-dark` image referenced outside a pair; a link whose `#anchor` matches no heading slug or `{#id}` on the target page; a stale term on a page not in `STALE_PAGES`; an output still listed in `LEGACY_IMAGES` (a page task removes each file it regenerates from the set in the same commit). `LEGACY_IMAGES` and `STALE_PAGES` only shrink; each page task removes its entries; Task 7.16 deletes both. The lint reads the pages VitePress builds: `docs/superpowers/**` and `README.md` files are skipped (mirroring `srcExclude` in `docs/.vitepress/config.mts:38`). Heading slugs follow VitePress 1.6.4's `slugify` (`What's new?` → `what-s-new`; "Help, shortcuts and the tour" → `help-shortcuts-and-the-tour`). The lint does not see links from the app into the docs (`DOCS_URL` in `apps/web/src`); the phase exit checks those.
- **Stale terms** (regexes, case-insensitive, on `docs/index.md`, `docs/explore/**/*.md`, `docs/guide/**/*.md`): `control bar`, `isolate button`, `apply & isolate`, `cog icon`, `tips popover`, `take a tour`, `extract (values )?from other`, `settings dialog`.
- **Tour.** Key `TOUR_STORAGE_KEY = 'protspace:tour:v2'`, value = the kind shown (`'full'` or `'whats-new'`), written when a tour starts. `LEGACY_TOUR_STORAGE_KEY = 'driver.overviewTour'` is read, never written or removed. With the new key holding any value nothing starts; else a legacy value `'true'` starts What's new; else the full tour. Every storage access is in `try`/`catch` (blocked storage starts nothing and throws nothing). Steps are built when a tour starts, from the layout mode (`getLayoutMode()`), `matchMedia('(pointer: coarse)')` and `isMacOrIos()`. driver.js loads lazily (`import('../tour/product-tour')`) from `runtime.ts` and `help-actions.ts`; nothing imports it statically. `animate: false` under `prefers-reduced-motion: reduce`. No test, helper or capture spells a tour key literal; they import the constants.

Copy (exact strings; tests and helpers key on them):

| Where | Text |
| --- | --- |
| Full tour, desktop (11 steps, in order) | "Welcome to ProtSpace", "Import & Export", "The View Bar", "Search Proteins", "Interactive Scatterplot", "Selection Tools", "Legend Panel", "Expand Hidden Categories", "The Sidebar", "Light or Dark", "You're All Set!" |
| Full tour, tablet (10) | the desktop list without "The Sidebar" |
| Full tour, phone and landscape (10) | "Welcome to ProtSpace", "Your Data", "The View Bar", "More Options", "Search Proteins", "Interactive Scatterplot", "Selection Tools", "Legend Panel", "Expand Hidden Categories", "You're All Set!" |
| What's new, desktop (6) | "What's new in ProtSpace", "The View Bar", "The Sidebar", "Selection Tools", "Light or Dark", "That's it" |
| What's new, tablet (5) | the desktop list without "The Sidebar" |
| What's new, phone and landscape (6) | "What's new in ProtSpace", "The View Bar", "More Options", "Legend Panel", "Selection Tools", "That's it" |
| Tour buttons | first step: "Skip" (`.driver-tour-skip-btn`) before the next button "Start Tour"; What's new first step also "Full tour" (`.driver-tour-full-btn`); last step "Finish"; others "Next", "Back" |
| Docs: new pages | `docs/explore/controls.md` "# Bars and Tools"; `docs/explore/filter.md` "# Filtering"; sidebar entries "Bars and Tools" → `/explore/controls`, "Filtering" → `/explore/filter` (replacing "Control Bar Features") |

Step targets (`data-driver-id`, light DOM): welcome → none, centred, spotlight on `help` (desktop, tablet) or `more` (phone, landscape); "Import & Export" → `data-actions`; "Your Data" → `dataset`; "The View Bar" → `view-bar`; "More Options" → `more`; "Search Proteins" → `search` (desktop, tablet) or `search-toggle` (phone, landscape); "Interactive Scatterplot" → `scatterplot`; "Selection Tools" → `selection`; "Legend Panel" → `legend`; "Expand Hidden Categories" → `other-row` inside `legend`'s shadow root; "The Sidebar" → `rail`; "Light or Dark" → `theme`; the end steps → none, centred. On a coarse pointer (tablet included) the plot, legend and Other texts use touch words (tap, double-tap, drag, pinch, hold the handle) and never "click", "hover" or "mouse wheel"; the legend text contains "double-tap". The modifier reads ⌘ on Mac and iOS, Ctrl elsewhere.

## Review Focus

1. **A returning visitor sees the wrong tour, or one every time.** The old key present but What's new never shown, shown on every load, or the full tour replayed; a blocked `localStorage` throwing on load; a test or capture seeding the old literal and so starting What's new mid-run (the perf suite measured a tour overlay as 7 → 28 ms on a click). Pinned by Task 7.1 (`storage-key.test.ts`: no test, helper, capture or perf-harness file spells a key literal; `seedTourSeen`), Task 7.7 (`storage-key.test.ts` `chooseTour` cases; `product-tour.test.ts` blocked storage and the key written as the kind; `product-tour.spec.ts` What's new: once, a reload shows nothing, "Full tour" switches).
2. **The tour points at nothing on a phone or tablet, or talks mouse to a finger.** A step targeting the hidden Import trigger, Help, search box, rail or theme button on a phone; a popover off a 360-px screen; a close button under 40 px; "click" and "hover" on a touch screen; the legend steps aiming at a folded panel or the Filter panel. Pinned by Task 7.6 (`tour-steps.test.ts`: per-mode targets, coarse wording), Task 7.7 (layout prep to `panel: 'legend'`, `panelFolded: false`; a missing target is dropped; the tablet pass) and Task 7.8 (C11/C12 at 390×664 and 740×360, What's new on a phone, the dark popover).
3. **The docs show both images, or the wrong one, in dark mode.** markdown-it-attrs not emitting the class, a pair written in the wrong order, a dark twin fetched eagerly on every page view, `<picture>` following the OS instead of the docs toggle. Pinned by Task 7.5 (the pair rules in `docs-lint.ts`, run by `docs-images.test.ts` and the hook) and Task 7.9 (the head rule, and a check of the built HTML for `class="light-only"`/`"dark-only"` on the first pair).
4. **Links that land nowhere after the control-bar page goes.** Eleven links point into `control-bar.md` anchors; VitePress checks pages, not anchors, so a renamed heading breaks silently; external bookmarks to `/docs/explore/control-bar` 404 (accepted: no stub). Pinned by Task 7.5 (anchor check), Task 7.9 (every link moved, no page links `/explore/control-bar`) and Task 7.15 (`grep -rn "/explore/control-bar" docs` prints nothing); the app's own links into the docs are checked at the phase exit.
5. **Docs images that show something a user never sees, or weigh too much.** A capture taken from a server pinned to the e2e fixture, with the tour or a kit tooltip over it, in the OS's dark scheme for a light-only image (the thumbnails were body screenshots that followed the OS), or a GIF at 6 MB (today's are 2.6–6 MB, about 41 MB in all). Pinned by Task 7.2 (`expectProductDemo`), Task 7.3 (contexts pin `colorScheme` per variant; the tour marked seen; pointer parked and tooltips asserted closed; thumbnails light), Task 7.4 (the ladder and the failing budget) and Task 7.5 (sizes checked in the hook).

## Rulings

Settled open questions (R1 Q1–Q8, R2 Q1–Q8, R3 Q1–Q7; the user adopted every recommended answer, so these record the decision and where notes disagreed):

- Capture specs stay in `scripts/docs-screenshots/` under the root Playwright config (CommonJS) and import the shared helpers from `apps/web/tests/helpers/`; Task 7.1 proves one import and `type-check:scripts` before anything else (R1 Q1). The helper modules the captures reach are listed in `scripts/tsconfig.json` `include`, so strict errors show when a helper changes, not when a capture first imports it.
- Desktop PNGs 1280×720 at device scale 2 (sharp on retina; the size the workbench is designed and e2e-tested for); GIF video at 1× (R1 Q2). Example thumbnails stay 1280×720 at scale 1, as today: they show at thumbnail size and scale 2 would quadruple five files.
- Dark variants for PNG screenshots only, from the phase-6 exit list (R1 Q3, R2 Q3). "GIFs light-only except one theme-switch pair" means the theme switch is shown as a light/dark PNG pair, not a GIF; every GIF is light.
- No docs image of the tour (R3 Q5 over R2's table and the phase-6 exit list, which named "a tour step"): driver.js popovers are an entry to maintain for little reader value; the overview page describes the tour in text.
- GIF budget 3 MiB (3,145,728 bytes) per GIF with a per-entry override; the fps/width ladder steps down before failing; over budget at the last rung fails the run (R1 Q4).
- Signals over timers: `waitForExploreDataLoad`, then `plotSettled` (`?perfCounters=1` and the perf suite's `settle()`, already proven), role visibility for dialogs and menus, the viewer's `structure-load` event for structures (R1 Q8); animation pacing is explicit `cap.hold(ms)`, countable in review. PNGs run under `reducedMotion: 'reduce'`, so transitions need no settle pause.
- The runner starts its own server on 8096 (not 8080, 8091, 8479, 8475 or 8310) without `VITE_STARTUP_DATASET_URL`, never reusing one (R1 Q5); `expectProductDemo` still guards the load path in case `PLAYWRIGHT_BASE_URL` points at a pinned server.
- Cursor, click and key overlays kept, theme-aware (token colours), GIF-only (R1 Q6); in a PNG the same `cap` calls act without overlays.
- One manifest entry per image (name, kind, viewport, themes, dataset, layout, setup/steps, target, budget, docs pages), with `setup`/`steps` as functions (R1 §3.2). The entries live in `scenes/<area>.ts` modules concatenated by `manifest.ts`, so each page task owns one file and no file nears 800 lines.
- The lint runs in `pnpm precommit` as `docs:images:check` (R1 Q7), and the docs-pinning tests live in `apps/web/src/explore/docs-images.test.ts` (R2 Q4). Both: the pure checks live once in `scripts/docs-screenshots/docs-lint.ts`; the hook adds what needs the file system and the manifest (outputs on disk, sizes), the app test pins the rules with small cases and runs the docs-only checks on the real pages. AGENTS.md's pre-commit description changes in the commit that adds the check.
- `control-bar.md` splits into `explore/controls.md` ("Bars and Tools") and `explore/filter.md` ("Filtering") and is deleted with no stub (R2 Q1); the anchor check covers the moved links.
- Dark images in the docs: one head `<style>` rule plus `{.light-only}`/`{.dark-only}` pairs named `<name>-dark.png`, the dark twin lazy (R2 Q2); verified in the built HTML in the first commit that uses a pair (Task 7.9). `<picture>` is rejected (it follows the OS, not the docs toggle).
- No numbered-callout overview images: plain captures of each bar plus a table keyed by control name (R2 Q5).
- Phones and tablets are a section of `explore/index.md` with portrait, More sheet and structure sheet captures (light and dark) and one tablet capture (light) (R2 Q6).
- The shortcuts doc points to Help → Keyboard shortcuts and names five keys: ⌘K / Ctrl+K, ⌘Z / Ctrl+Z (with ⇧ to redo), Escape, Shift + hover, `i` (R2 Q7).
- A FAQ entry on dark mode says exports and figures are always light and links to `/explore/#light-and-dark` (R2 Q8).
- Tour key `protspace:tour:v2`, value = the kind shown (R3 Q1); the legacy key is kept, never written or removed, so a rollback does not replay the old tour (R3 Q2).
- No Help item for What's new: its last step points at Help → Take the tour, its first step has a "Full tour" button (R3 Q3).
- A returning visitor on a phone gets the phone What's new (R3 Q4).
- driver.js is lazy-loaded from `runtime.ts` (R3 Q6), so it leaves the explore chunk.
- The theme is its own tour step on desktop and tablet; on phones it is named in the "More Options" step (R3 Q7).
- Example thumbnails move from `examples-live` to the runner, pinned light (R1 risk 7); `examples-live` keeps its assertions (protein count, curated view, no drift, no fallback) and loses only the screenshot.
- The tour takes its place in the one Escape order (decision 11): while it runs it holds a layer from `pushLayer`, so the Escape that closes it closes nothing else (R3 risk: driver.js closes on keyup, the app's Escape runs on keydown and would also clear a selection).
- A tour step whose target is missing or 0×0 when the tour starts is dropped rather than shown centred (R3 §3); a layout-mode change during a tour ends it (R3 risk).
- The phone welcome step spotlights More, whose sheet holds Help & shortcuts (R3 §3): the generalised `spotlight(selector)` replaces `spotlightHelp`.
- `#driver-dummy-element`'s `aria-haspopup`/`aria-expanded`/`aria-controls` are stripped on every popover render, and `workbench-a11y.spec.ts` drops its exclusion (R3 §3).

From the plan review (two judges; every finding verified against `a8cb13ca` and applied):

- A GIF test opens its own context with `recordVideo` (`video` is worker-scoped in Playwright 1.61; `test.use({ video })` in a describe is a load error); the trim runs from page creation, and `docs-gif` sets no `video` (Task 7.4).
- Phone and tablet PNGs are captured at device scale 2, not Pixel 7's 2.625 (several-MB files shown 240–320 px wide); touch comes from `isMobile`/`hasTouch` (Task 7.3).
- `adoptTheme` is not exported, so the embedding docs say an iframe imports `@protspace/core` itself; exporting it would be a core API change outside this phase (Task 7.16).
- VitePress 1.6.4 slugs turn `'` into a separator: "What's new?" → `what-s-new` (Task 7.5).
- `importing-data.md` (:151, :152) and `eat.md` :78 also link into `control-bar.md`, so Task 7.9 moves them; `eat.md` then has no stale term and leaves `STALE_PAGES` in 7.9.
- An output still listed in `LEGACY_IMAGES` fails the lint, which enforces the shrink; the allowlist cases are guarded so they still assert once a set is empty (Task 7.5). `STALE_TERMS` becomes module-private when the allowlists go (Task 7.16).
- The EAT provenance pair is read by a new helper, `provenancePair` in `helpers/plot.ts`, with its spec case: a scene may not evaluate in the page (Task 7.14).
- The figure editor's content is slotted into `ps-dialog`, so scenes query it from `protspace-publish-modal`, never from the role-`dialog` locator (Task 7.13).
- The view-bar and Export menu locators and a `draftFilterCondition` helper live in `helpers/explore.ts`, not in a scene, and the scene uses 7.2's `searchReport` (decision 19: one set of helpers) (Task 7.9).
- The tour imports `pushLayer` from `@protspace/core/kit` (the shell already loads it; a core value import from Help's lazy path would load all of core early) and opens the legend with `openPanel('legend')` (decision 18: one way to do each job); a layout-mode change and a superseded start each have a unit test (Task 7.7).
- The select-single GIF captions the modifier "Ctrl/⌘ + click" whatever the host OS: the page runs a Windows user agent (Task 7.11).
- The GIF overlay root re-enters the top layer on a click, key or label, not on every pointer move (Task 7.4).
- The lint and the app test skip `docs/superpowers/**` as VitePress's `srcExclude` does (Task 7.5); the FAQ keeps "Is my data uploaded to a server?" verbatim because the landing page links to its slug (Task 7.15).
- The phase exit commits the fully regenerated image set as its own commit (captures are not byte-stable) and checks the app's links into the docs.
- The judges' size concern: structures, figure editor and EAT were one task; EAT is now Task 7.14 and the later tasks are renumbered (7.15 importing/exporting/phones/FAQ, 7.16 developer docs).

Plan shape:

- Sixteen tasks in four review blocks of four: 7.1–7.4 (helpers, runner, GIFs), 7.5–7.8 (lint, tour), 7.9–7.12 (pages with their images), 7.13–7.16 (structures and figure editor, EAT, importing/exporting/phones/FAQ, developer docs and allowlists retired). The EAT page is its own task (7.14), split from structures and the figure editor, because those three pages with eight PNGs, two GIFs and a new helper would not fit one implementer's budget. The tour lands before the overview page, whose "Help, shortcuts and the tour" section describes it. The control-bar split (7.9) lands before the overview rewrite (7.10), so the overview links to pages that exist.
- `tasks.md` section 7 is rewritten to list these sixteen tasks in the commit that adds the plan; the ticks land at the end of the phase.

## File structure

`scripts/` and the root

- `playwright.config.ts` (M 7.3 server, `docs-png`; M 7.4 `docs-gif`, top-level `video` gone): the capture config.
- `package.json` (M 7.3 `docs:screenshots`; M 7.4 `docs:animations`, `docs:gifs`; M 7.5 `docs:images:check`, `precommit`): scripts. `docs:images` stays `pnpm docs:screenshots && pnpm docs:animations && pnpm docs:gifs`.
- `scripts/tsconfig.json` (M 7.1, 7.2): the shared helper modules in `include`.
- `scripts/docs-screenshots/capture-plan.ts` (C 7.3; M 7.4 ladder, sidecar type): pure types, constants, naming, variants, validation, ladder.
- `scripts/docs-screenshots/runner.ts` (C 7.3; M 7.4 GIF branch): registers one test per variant; open, wait, shutter, video, sidecar.
- `scripts/docs-screenshots/capture-png.spec.ts` (C 7.3), `capture-gif.spec.ts` (C 7.4): one line each, `registerCaptures(kind)`.
- `scripts/docs-screenshots/manifest.ts` (C 7.3; M 7.4, 7.9–7.15): `MANIFEST`, the scenes concatenated.
- `scripts/docs-screenshots/scenes/examples.ts` (C 7.3), `scenes/scatterplot.ts` (C 7.4 zoom; M 7.11), `scenes/clip.ts` (C 7.9), `scenes/controls.ts` (C 7.9; M 7.15 `export-menu` docs gain `explore/exporting.md`), `scenes/overview.ts` (C 7.10), `scenes/legend.ts` (C 7.12), `scenes/structures.ts`, `scenes/figure-editor.ts` (C 7.13), `scenes/eat.ts` (C 7.14), `scenes/import-export.ts`, `scenes/phones.ts` (C 7.15): the entries by docs area.
- `scripts/docs-screenshots/indicators.ts` (C 7.4, ported from `helpers.ts` 578–919): GIF overlays.
- `scripts/docs-screenshots/gif.ts` (C 7.4, replaces `convert-to-gif.ts`): conversion with the ladder and the budget.
- `scripts/docs-screenshots/docs-lint.ts` (C 7.5; M 7.9–7.14 `LEGACY_IMAGES` shrinks to empty, M 7.9–7.15 `STALE_PAGES` shrinks to empty; M 7.16 allowlists deleted, `STALE_TERMS` module-private; it then exports `headingSlug`, `imageRefs`, `lintDocs`, `lintManifest`, `pageAnchors` and the four types): pure docs and manifest checks.
- `scripts/docs-screenshots/check.ts` (C 7.5): the hook's CLI.
- `scripts/docs-screenshots/paths.ts`: kept.
- Deleted: `capture-static.spec.ts`, `capture-eat-static.spec.ts` (7.3); `capture-animations.spec.ts`, `capture-eat-animations.spec.ts`, `helpers.ts`, `eat-helpers.ts`, `convert-to-gif.ts` (7.4). The old capture specs are edited in 7.1 only to prove the import; `scripts/docs-screenshots/helpers.ts` (M 7.1 import proof; M 7.3 the exports only the static captures used removed; D 7.4).
- `docs/scripts/generate-examples.mts` (M 7.3): the missing-thumbnail message names the runner.
- `AGENTS.md` (M 7.5): the pre-commit description lists `docs:images:check`.
- `CONTRIBUTING.md` (M 7.3 thumbnails and `docs:images` lines; M 7.16 the source tree and the docs-images section).

`apps/web/tests`

- `helpers/explore.ts` (M 7.1 strict; M 7.2 `searchProteins`, `pasteIntoSearch`, `toast`; M 7.7 `dismissTourIfPresent`; M 7.9 the menu locators `projectionMenu`, `colorByMenu`, `contoursTrigger`, `contoursMenu`, `exportTrigger`, `exportList`, `searchReport` exported, `draftFilterCondition`), `helpers/legend.ts` (M 7.1; M 7.2 `doubleClickLegendRow`, `dragLegendRow`), `helpers/workbench.ts` (M 7.1 strict, `plotArea` removed), `helpers/mobile.ts`, `helpers/theme.ts`, `helpers/perf/probes.ts` (M 7.1 strict only), `helpers/tour-storage-state.ts` (M 7.1 `seedTourSeen`; M 7.7 seen value `'full'`).
- `helpers/plot.ts` (C 7.2; M 7.14 `provenancePair`), `helpers/structure.ts`, `helpers/figure.ts`, `helpers/examples.ts` (C 7.2).
- `workbench-helpers.spec.ts` (M 7.1, 7.2, 7.9, 7.14): one case per new helper.
- `examples-live.spec.ts` (M 7.2 helpers from `examples.ts`; M 7.3 screenshot removed), `figure-editor.spec.ts`, `eat-visualization.spec.ts`, `workbench-feedback.spec.ts`, `workbench-search.spec.ts`, `legend-double-click.spec.ts` (M 7.2: local copies replaced), `url-view-state.spec.ts`, `dataset-reload.spec.ts`, `workbench-escape.spec.ts`, `product-tour.spec.ts` (M 7.1 key seeds), specs importing `plotArea` from `helpers/workbench` (M 7.1).
- `product-tour.spec.ts` (M 7.7 rewritten), `workbench-theme.spec.ts`, `workbench-view-bar.spec.ts`, `workbench-a11y.spec.ts` (M 7.7), `mobile-bars.spec.ts` (M 7.8).
- `playwright.config.ts` (M 7.3 comment about `docs:images` and :8080).

`apps/web/src`

- `explore/docs-images.test.ts` (C 7.3; M 7.4, 7.5, 7.16).
- `tour/storage-key.ts` (M 7.6 `TourKind`; M 7.7 key, legacy key, `chooseTour`), `tour/storage-key.test.ts` (C 7.1; M 7.7).
- `tour/tour-steps.ts`, `tour/tour-steps.test.ts` (C 7.6).
- `tour/product-tour.ts`, `tour/product-tour.test.ts` (M 7.7; M 7.8 only if phone positioning needs it), `tour/product-tour.css` (M 7.7 "Full tour" button; M 7.8 coarse sizes, popover width).
- `explore/runtime.ts`, `workbench/help-actions.ts` (M 7.7).
- `workbench/ViewBar.tsx`, `AppBar.tsx`, `Rail.tsx`, `MoreMenu.tsx`, `SearchToggle.tsx`, `custom-elements.d.ts` (M 7.6 driver ids).

`docs`

- `.vitepress/config.mts` (M 7.9 sidebar and head rule).
- `explore/controls.md`, `explore/filter.md` (C 7.9); `explore/control-bar.md` (D 7.9).
- `explore/index.md` (M 7.9 links; M 7.10 rewrite; M 7.15 phones section), `explore/scatterplot.md` (M 7.9 links; M 7.11), `explore/legend.md` (M 7.9 link; M 7.12), `explore/structures.md` (M 7.10 pair; M 7.13), `explore/figure-editor.md` (M 7.9 link; M 7.13), `explore/eat.md` (M 7.9 links, out of `STALE_PAGES`; M 7.14), `explore/exporting.md` (M 7.9 link; M 7.15), `explore/importing-data.md` (M 7.9 links; M 7.15), `guide/faq.md` (M 7.15; its "Is my data uploaded to a server?" heading kept, the landing page links to it).
- `explore/images/**` (regenerated per task; see each task), `explore/images/README.md` (M 7.3 thumbnails; M 7.16 rewrite).
- `developers/architecture.md` (M 7.7 tour), `developers/embedding.md` (M 7.16 theming, components table), `developers/api/index.md` (M 7.16 only if a breaking note is missing).

`openspec/changes/explore-workbench/tasks.md` (M with the plan; ticks at the phase end). `.superpowers/sdd/phase-7-docs/progress.md` (baseline counts).

---

### Task 7.1: Shared page helpers reachable from the docs captures

The spike decision 19 depends on: the captures import the e2e helpers and `pnpm type-check:scripts` stays green. The helper modules the captures will reach become strict-clean (no behaviour change), `plotArea` gets one home, and every tour-key seed in tests and captures goes through one helper so Task 7.7 can change the key in one place.

**Files:**

- Modify: `scripts/tsconfig.json` (`include` adds `../apps/web/tests/helpers/explore.ts`, `legend.ts`, `workbench.ts`, `mobile.ts`, `theme.ts`, `tour-storage-state.ts`, `perf/probes.ts`)
- Modify: `apps/web/tests/helpers/explore.ts`, `legend.ts`, `workbench.ts`, `mobile.ts`, `theme.ts`, `perf/probes.ts` (strict-mode fixes only: null checks, unused parameters; no behaviour change)
- Modify: `apps/web/tests/helpers/workbench.ts` (`plotArea` deleted), every spec that imported `plotArea` from `./helpers/workbench` (import it from `./helpers/explore`; same locator `[data-workbench="plot"]`)
- Modify: `apps/web/tests/helpers/tour-storage-state.ts` (`seedTourSeen`)
- Modify: `apps/web/tests/url-view-state.spec.ts` (:266), `dataset-reload.spec.ts` (:387, :465, :494), `workbench-escape.spec.ts` (:33), `eat-visualization.spec.ts` (:34), `product-tour.spec.ts` (:204)
- Modify: `scripts/docs-screenshots/helpers.ts` (its `dismissProductTour` and `waitForDataLoad` deleted; it imports `dismissTourIfPresent` and `waitForExploreDataLoad` from `../../apps/web/tests/helpers/explore`), its callers `capture-static.spec.ts`, `capture-animations.spec.ts`, `capture-eat-static.spec.ts`, `capture-eat-animations.spec.ts`, `eat-helpers.ts` (the old captures stay broken at runtime; they must type-check)
- Create: `apps/web/src/tour/storage-key.test.ts`
- Modify: `apps/web/tests/workbench-helpers.spec.ts`

**Interfaces:**

- Consumes: `TOUR_STORAGE_KEY` (`apps/web/src/tour/storage-key.ts`, today `'driver.overviewTour'`); `exploreStorageState(baseUrl, { layout?, theme? })`, `tourCompletedStorageState` (`tour-storage-state.ts`); `waitForExploreDataLoad(page, { timeout?, proteinCount?, changedFrom? })`, `dismissTourIfPresent(page)`, `plotArea(page)` (`helpers/explore.ts`).
- Produces:
  - `tour-storage-state.ts`: `seedTourSeen(page: Page): Promise<void>` — an init script that writes the same key and value `exploreStorageState` seeds, from one module-private `TOUR_SEEN: { name: string; value: string }` (`{ name: TOUR_STORAGE_KEY, value: 'true' }`; Task 7.7 changes the value to `'full'`). `exploreStorageState` reads `TOUR_SEEN` too.
  - `helpers/explore.ts` is the only exporter of `plotArea`.
  - `scripts/docs-screenshots/helpers.ts` no longer exports `dismissProductTour` or `waitForDataLoad`.
  - `pnpm type-check:scripts` checks the listed helper modules under the root strict settings.

**Tests:**

- `apps/web/src/tour/storage-key.test.ts`: "no test, helper or capture spells the tour storage key" — a raw `import.meta.glob` of `../../tests/**/*.ts`, `../../../../scripts/**/*.ts` and `../../../../perf/*.{ts,mjs}` (the perf harness, Review Focus 1); no file contains the literal value of `TOUR_STORAGE_KEY` (quoted with `'` or `"`). `tests/helpers/tour-storage-state.ts` imports the constant, so it passes.
- `workbench-helpers.spec.ts`: "seedTourSeen keeps the tour from starting" — empty `storageState`, `seedTourSeen`, open Explore, wait for the data load: the stored value is the seen value and no `.driver-popover` appears within 2 s (a `toPass`/negative visibility window, not `waitForTimeout`).
- Verification: `pnpm type-check:scripts`; `pnpm --filter @protspace/app exec vitest --run src/tour/storage-key.test.ts`; `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts`; `pnpm knip`.
- Unrun at task time: `url-view-state.spec.ts`, `dataset-reload.spec.ts`, `workbench-escape.spec.ts`, `eat-visualization.spec.ts`, `product-tour.spec.ts`, and the specs whose `plotArea` import moved (at `a8cb13ca`: `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts`).

**Commit:** `test(web): share the page helpers with the docs captures`

Notes for the implementer, checked against `a8cb13ca` with a scratch copy of the tree:

- Listing the seven helper modules under the scripts tsconfig yields exactly three errors, all in code the e2e config (ES2023 lib, non-strict) accepts: `explore.ts` (`new Error(msg, { cause })` in the catch of `waitForLoadingOverlayRemoved`, line 44, and of `waitForViewState`, line 541) is `TS2554 Expected 0-1 arguments` because the root `lib` is ES2020, which has no error `cause`; and `mobile.ts` `touchTargetsBelow` never reads its `page` parameter (`TS6133`). `legend.ts`, `workbench.ts`, `theme.ts`, `tour-storage-state.ts` and `perf/probes.ts` are already strict-clean. The fix is the scripts tsconfig's `lib` (ES2023, the e2e config's) and `_page`; the helpers' code does not change otherwise.
- Only `workbench-structure.spec.ts` imports `plotArea` from `./helpers/workbench` today; `mobile-plot-touch.spec.ts` and the others already import it from `./helpers/explore`. `helpers/workbench.ts` does not use `plotArea` itself.
- `capture-eat-static.spec.ts` and `capture-eat-animations.spec.ts` import neither deleted helper; they need no edit (they reach `waitForExploreDataLoad` through `eat-helpers.ts`'s `loadEatExampleBundle`).
- The tour-key literal appears today in exactly six files outside `src/`: `url-view-state.spec.ts:266`, `dataset-reload.spec.ts:387,465,494`, `workbench-escape.spec.ts:33`, `eat-visualization.spec.ts:34`, `product-tour.spec.ts:204` and `scripts/docs-screenshots/helpers.ts:30`.

- [ ] **Step 1: Write the failing key test**

Create `apps/web/src/tour/storage-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOUR_STORAGE_KEY } from './storage-key';

/**
 * Tests, helpers and captures keep the product tour from starting through
 * `tests/helpers/tour-storage-state.ts`, which imports the key from here. A literal copy anywhere
 * else goes stale when the key changes, and the tour then starts in the middle of a run (the perf
 * suite once measured its overlay as a click going from 7 to 28 ms). Read as raw text, as
 * example-datasets-docs.test.ts reads the docs, because `tsconfig.app.json` has no Node types.
 */
const SOURCES = {
  ...import.meta.glob('../../tests/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../../scripts/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  // The perf harness's config and spec sit at the repo root; top level only (perf/ holds a
  // Python env and large datasets).
  ...import.meta.glob('../../../../perf/*.{ts,mjs}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
} as Record<string, string>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the tour storage key', () => {
  it('reads the e2e and capture sources', () => {
    const files = Object.keys(SOURCES);
    expect(files).toContain('../../tests/helpers/tour-storage-state.ts');
    expect(files).toContain('../../../../perf/playwright.config.ts');
    expect(files.some((file) => file.startsWith('../../../../scripts/docs-screenshots/'))).toBe(
      true,
    );
  });

  it('is spelled by no test, helper or capture', () => {
    const literal = new RegExp(`['"\`]${escapeRegExp(TOUR_STORAGE_KEY)}['"\`]`);
    const spelled = Object.entries(SOURCES)
      .filter(([, text]) => literal.test(text))
      .map(([file]) => file);
    expect(spelled).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/storage-key.test.ts`
Expected: FAIL, 1 of 2 tests. "is spelled by no test, helper or capture" lists six files: `../../tests/dataset-reload.spec.ts`, `../../tests/eat-visualization.spec.ts`, `../../tests/product-tour.spec.ts`, `../../tests/url-view-state.spec.ts`, `../../tests/workbench-escape.spec.ts` and `../../../../scripts/docs-screenshots/helpers.ts`. "reads the e2e and capture sources" passes (if it fails, the glob reaches nothing outside `src/`: stop and report, the rest of the phase's docs tests use the same globs).

- [ ] **Step 3: Write the failing e2e case**

In `apps/web/tests/workbench-helpers.spec.ts`, after the line `import { DEFAULT_EXAMPLE_DATASET, EXAMPLE_DATASETS } from '../src/explore/example-datasets';` add:

```ts
import { TOUR_STORAGE_KEY } from '../src/tour/storage-key';
```

In the `./helpers/explore` import list, replace

```ts
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';
```

with

```ts
  waitForExploreDataLoad,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';
import { exploreStorageState, seedTourSeen } from './helpers/tour-storage-state';
```

Append at the end of the file (after the closing `});` of `test.describe('explore helpers', …)`):

```ts

test.describe('tour storage helpers', () => {
  // Empty storage, as in a context a test opens itself: only seedTourSeen marks the tour seen.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('seedTourSeen keeps the tour from starting', async ({ page, baseURL }) => {
    await seedTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    // The same entry the e2e contexts start with.
    const state = exploreStorageState(baseURL!);
    const seen =
      typeof state === 'object'
        ? state.origins[0].localStorage.find((entry) => entry.name === TOUR_STORAGE_KEY)?.value
        : undefined;
    expect(seen).toBeTruthy();
    expect(await page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY)).toBe(seen);

    // The tour would start 800 ms after the first load: a 2 s window in which it must not show.
    const shown = await page
      .locator('.driver-popover')
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(
        () => true,
        () => false,
      );
    expect(shown).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-helpers.spec.ts -g "seedTourSeen"`
Expected: FAIL before any test runs: the spec does not load, because `./helpers/tour-storage-state` has no export `seedTourSeen` (Playwright reports the import error for `workbench-helpers.spec.ts`).

- [ ] **Step 5: Add `seedTourSeen`**

In `apps/web/tests/helpers/tour-storage-state.ts`:

Replace `import type { BrowserContextOptions } from '@playwright/test';` with:

```ts
import type { BrowserContextOptions, Page } from '@playwright/test';
```

After the line `import { THEME_STORAGE_KEY, type ThemeChoice } from '../../src/explore/theme-defaults';` insert:

```ts

/**
 * The stored entry that marks the product tour as seen. Every test and capture that suppresses the
 * tour seeds it from here, through `exploreStorageState` or `seedTourSeen`, so a change of key or
 * value happens in this one place (storage-key.test.ts fails on any other spelling of the key).
 */
const TOUR_SEEN: { name: string; value: string } = { name: TOUR_STORAGE_KEY, value: 'true' };
```

In `exploreStorageState`, replace

```ts
  const localStorage = [{ name: TOUR_STORAGE_KEY, value: 'true' }];
```

with

```ts
  const localStorage = [{ ...TOUR_SEEN }];
```

Append at the end of the file:

```ts

/**
 * Marks the product tour as seen before any of the page's scripts run: for a page whose context
 * does not start from `exploreStorageState`, such as one a test opens with `browser.newContext`.
 * Blocked storage (a document without it) is ignored.
 */
export async function seedTourSeen(page: Page): Promise<void> {
  await page.addInitScript(({ name, value }) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // No storage to write to: nothing to seed.
    }
  }, TOUR_SEEN);
}
```

- [ ] **Step 6: Route every spec seed through it**

`apps/web/tests/url-view-state.spec.ts`: after `import { STARTUP_DATASET_URL } from './helpers/fixtures';` add `import { seedTourSeen } from './helpers/tour-storage-state';`. In the top-level `test.beforeAll(async ({ browser }, workerInfo) => {…})`, replace

```ts
    await page.addInitScript(() => {
      try {
        localStorage.setItem('driver.overviewTour', 'true');
      } catch {
        /* ignore */
      }
    });
```

with

```ts
    await seedTourSeen(page);
```

`apps/web/tests/dataset-reload.spec.ts`: after `import { readStoredImport } from './helpers/opfs';` add `import { seedTourSeen } from './helpers/tour-storage-state';`. In "queued user imports win over corrupted OPFS fallback recovery", replace

```ts
    await page.addInitScript(() => {
      localStorage.setItem('driver.overviewTour', 'true');

      const originalDefine = customElements.define.bind(customElements);
```

with

```ts
    await seedTourSeen(page);
    await page.addInitScript(() => {
      const originalDefine = customElements.define.bind(customElements);
```

In "OPFS access restrictions show a toast without blocking the current session load" and "unsupported browsers show an OPFS support toast without blocking the current session load" (both occurrences), replace

```ts
    await page.addInitScript(() => {
      localStorage.setItem('driver.overviewTour', 'true');
      Object.defineProperty(navigator.storage, 'getDirectory', {
```

with

```ts
    await seedTourSeen(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.storage, 'getDirectory', {
```

(Init scripts run in the order they were added, both before the page's scripts, so splitting the seed out changes nothing.)

`apps/web/tests/workbench-escape.spec.ts`: before `import { stubStructureRequests } from './helpers/workbench';` add `import { seedTourSeen } from './helpers/tour-storage-state';`. In `loadEatFixture`, replace

```ts
  await page.addInitScript(() => localStorage.setItem('driver.overviewTour', 'true'));
```

with

```ts
  await seedTourSeen(page);
```

`apps/web/tests/eat-visualization.spec.ts`: after `import { STARTUP_URL_GLOB } from './helpers/fixtures';` add `import { seedTourSeen } from './helpers/tour-storage-state';`. Replace

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('driver.overviewTour', 'true');
  });
});
```

with

```ts
test.beforeEach(async ({ page }) => {
  await seedTourSeen(page);
});
```

`apps/web/tests/product-tour.spec.ts`: after `import { test, expect, type Page } from '@playwright/test';` add `import { TOUR_STORAGE_KEY } from '../src/tour/storage-key';`. In "does not auto-start on subsequent visits", replace

```ts
    const storageValue = await page.evaluate(() => localStorage.getItem('driver.overviewTour'));
```

with

```ts
    const storageValue = await page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY);
```

(`expect(storageValue).toBe('true')` on the next line stays; Task 7.7 rewrites this spec.)

- [ ] **Step 7: Route the old captures through the shared load helpers**

`scripts/docs-screenshots/helpers.ts`:

After `import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';` insert:

```ts

// The load and tour helpers are the e2e suite's, shared with the captures (design decision 19).
export { dismissTourIfPresent, waitForExploreDataLoad } from '../../apps/web/tests/helpers/explore';
```

Delete the whole `dismissProductTour` function with its JSDoc (from `/**` ` * Dismiss the product tour by setting the localStorage flag` through the closing `}` of `export async function dismissProductTour`).

Delete `waitForDataLoad` with its JSDoc (from ` * Wait for the scatterplot to finish loading data and for the first render`'s `/**` through its closing `}`) and the module-private `assertProductStartupDataset` with its JSDoc (from ` * The captures photograph the product demo` 's `/**` through its closing `}`), which only `waitForDataLoad` called. Task 7.2's `expectProductDemo` replaces it. Everything from `/**` ` * Wait for the legend to populate with items` on stays.

`scripts/docs-screenshots/capture-static.spec.ts`: in the `./helpers` import list replace `  dismissProductTour,\n  waitForDataLoad,` with

```ts
  dismissTourIfPresent,
  waitForExploreDataLoad,
```

and in the `createSharedCapturePage` callback replace

```ts
  await dismissProductTour(page);
  await waitForDataLoad(page);
```

with

```ts
  await waitForExploreDataLoad(page);
  await dismissTourIfPresent(page);
```

`scripts/docs-screenshots/capture-animations.spec.ts`: the same import-list replacement, and the same two-line replacement in its three `test.beforeEach` blocks ("Zoom Animation", "Scatterplot Animation Captures", "Legend Animation Captures"; indented four spaces there):

```ts
    await waitForExploreDataLoad(page);
    await dismissTourIfPresent(page);
```

`scripts/docs-screenshots/eat-helpers.ts`: replace `import { dismissProductTour, waitForDataLoad } from './helpers';` with

```ts
import { dismissTourIfPresent, waitForExploreDataLoad } from './helpers';
```

and in `loadEatExampleBundle` replace

```ts
  await dismissProductTour(page);
  await waitForDataLoad(page, { expectedProteinCount: EAT_EXAMPLE.proteins });
```

with

```ts
  await waitForExploreDataLoad(page, { proteinCount: EAT_EXAMPLE.proteins });
  await dismissTourIfPresent(page);
```

These captures stay broken at runtime until Tasks 7.3 and 7.4 delete them; they only have to load and type-check.

- [ ] **Step 8: Put the helpers under the scripts tsconfig (the spike)**

Replace `scripts/tsconfig.json` with:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": [
    "**/*.ts",
    "**/*.mts",
    "../apps/web/src/vite-env.d.ts",
    "../apps/web/tests/helpers/explore.ts",
    "../apps/web/tests/helpers/legend.ts",
    "../apps/web/tests/helpers/workbench.ts",
    "../apps/web/tests/helpers/mobile.ts",
    "../apps/web/tests/helpers/theme.ts",
    "../apps/web/tests/helpers/tour-storage-state.ts",
    "../apps/web/tests/helpers/perf/probes.ts"
  ]
}
```

The `lib` matches `apps/web/tsconfig.e2e.json`, which the helpers are written against: the root's ES2020 lib has no `Error` `cause`, which `explore.ts` passes twice. The helpers run in Node 24 and Chromium, which have it.

Run: `pnpm type-check:scripts`
Expected: one error, `apps/web/tests/helpers/mobile.ts(270,41): error TS6133: 'page' is declared but its value is never read.` (Without the `lib` line there would also be two `TS2554` errors at `explore.ts` 44 and 541.) If more appear, the helpers changed since `a8cb13ca`: fix each with a null check or an `_`-prefixed parameter, no behaviour change, and list them in the report.

In `apps/web/tests/helpers/mobile.ts`, replace

```ts
export async function touchTargetsBelow(page: Page, root: Locator, min = 40): Promise<string[]> {
```

with

```ts
export async function touchTargetsBelow(_page: Page, root: Locator, min = 40): Promise<string[]> {
```

(The callers keep passing `page`; ESLint's `argsIgnorePattern: '^_'` covers the name.)

Run: `pnpm type-check:scripts`
Expected: no errors.

Prove the runtime import too: the root config is CommonJS and `apps/web` is `"type": "module"`, so load the old captures through Playwright's loader.

Run: `pnpm exec playwright test --list`
Expected: the old capture titles are listed (for example `zoom.gif - Zooming and panning animation`) and no "Error: … helpers/explore" load error. (`--list` starts no server; the root config has none yet.)

- [ ] **Step 9: Give `plotArea` one home**

In `apps/web/tests/helpers/workbench.ts`, delete

```ts
/** The plot area: the floating structure card stays inside it. */
export function plotArea(page: Page): Locator {
  return page.locator('[data-workbench="plot"]');
}

```

(`Locator` stays imported: `structurePanel` and `rail` use it.)

In `apps/web/tests/workbench-structure.spec.ts`, replace

```ts
  importUserFile,
  openExplore,
  waitForExploreDataLoad,
} from './helpers/explore';
```

with

```ts
  importUserFile,
  openExplore,
  plotArea,
  waitForExploreDataLoad,
} from './helpers/explore';
```

and in its `./helpers/workbench` import list replace

```ts
  floatStructure,
  plotArea,
  rail,
```

with

```ts
  floatStructure,
  rail,
```

Run: `grep -n "plotArea" apps/web/tests/helpers/workbench.ts`
Expected: no output. A spec that still imports `plotArea` from `./helpers/workbench` fails the app type-check in Step 10 (`has no exported member 'plotArea'`); at `a8cb13ca` only `workbench-structure.spec.ts` did.

- [ ] **Step 10: Run the task's checks**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/storage-key.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm type-check:scripts && pnpm --filter @protspace/app type-check`
Expected: no errors (the second covers the specs through `tsconfig.e2e.json`).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-helpers.spec.ts`
Expected: PASS, 11 tests (the 10 existing and "seedTourSeen keeps the tour from starting").

Run: `pnpm knip`
Expected: no issues (`seedTourSeen` is used by six specs; the re-export in `scripts/docs-screenshots/helpers.ts` by the old capture specs).

Run: `pnpm exec prettier --check scripts/tsconfig.json scripts/docs-screenshots/helpers.ts scripts/docs-screenshots/capture-static.spec.ts scripts/docs-screenshots/capture-animations.spec.ts scripts/docs-screenshots/eat-helpers.ts apps/web/src/tour/storage-key.test.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/mobile.ts apps/web/tests/helpers/workbench.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/workbench-structure.spec.ts apps/web/tests/url-view-state.spec.ts apps/web/tests/dataset-reload.spec.ts apps/web/tests/workbench-escape.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/product-tour.spec.ts`
Expected: all files pass.

Unrun at task time (the exit runs them): `url-view-state.spec.ts`, `dataset-reload.spec.ts`, `workbench-escape.spec.ts`, `eat-visualization.spec.ts`, `product-tour.spec.ts`, `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts`.

- [ ] **Step 11: Commit**

```bash
git add scripts/tsconfig.json scripts/docs-screenshots/helpers.ts scripts/docs-screenshots/capture-static.spec.ts scripts/docs-screenshots/capture-animations.spec.ts scripts/docs-screenshots/eat-helpers.ts apps/web/src/tour/storage-key.test.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/mobile.ts apps/web/tests/helpers/workbench.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/workbench-structure.spec.ts apps/web/tests/url-view-state.spec.ts apps/web/tests/dataset-reload.spec.ts apps/web/tests/workbench-escape.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/product-tour.spec.ts
git commit -m "test(web): share the page helpers with the docs captures"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

### Task 7.2: Page helpers the captures need

The actions the captures need that the helpers lack, each proven by a `workbench-helpers.spec.ts` case, and the spec-local copies replaced by them. Plot reads that have no DOM (`getProteinClientPosition`, `getDuplicateStacks`) sit behind typed helpers, so capture code never calls `page.evaluate`.

**Files:**

- Create: `apps/web/tests/helpers/plot.ts`, `helpers/structure.ts`, `helpers/figure.ts`, `helpers/examples.ts`
- Modify: `apps/web/tests/helpers/explore.ts` (`pasteIntoSearch`, `searchProteins`, `toast`), `helpers/legend.ts` (`doubleClickLegendRow`, `dragLegendRow`)
- Modify: `scripts/tsconfig.json` (`include` adds the four new modules)
- Modify: `apps/web/tests/workbench-helpers.spec.ts`
- Modify: `apps/web/tests/figure-editor.spec.ts` (local `openFigureEditor` → `helpers/figure`), `eat-visualization.spec.ts` (local `getProteinScreenPosition` → `proteinScreenPosition`), `workbench-feedback.spec.ts` (local `toast`, `selectBySearch` → `toast`, `searchProteins`), `workbench-search.spec.ts` (local `paste` → `pasteIntoSearch`), `legend-double-click.spec.ts` (local `legendRow` and `realDoubleClick` → `legendRow`, `doubleClickLegendRow`), `examples-live.spec.ts` (local `serveProductDemo`, `refuseProductionFallback`, `localFile` → `helpers/examples`; it still writes thumbnails until 7.3)

**Interfaces:**

- Consumes: `searchInput`, `selectionBar`, `exportAction(page, 'Figure editor…')`, `waitForExploreDataLoad` (`helpers/explore.ts`); `legend`, `legendRow(page, value)` (`helpers/legend.ts`); `Point` (`helpers/mobile.ts`); `settle(page, capMs)` (`helpers/perf/probes.ts`, needs `?perfCounters` in the page URL, which exposes `window.__protspacePerfCounters`); the scatterplot's public `getProteinClientPosition(id)`, `getDuplicateStacks()`, `getCurrentData()`, `dataToClient(x, y)`; the viewer's bubbling `structure-load` event (`detail.proteinId`, `detail.status` `'loading' | 'loaded'`); the legend row's drag handle (`button` named `Reorder {value}`); `ps-dialog heading="Figure editor"` (role `dialog`, name "Figure editor"); Sonner toasts `[data-sonner-toast]`; `EXAMPLE_MANIFEST` (`apps/web/src/explore/example-manifest.ts`), `exampleServedPath` (`example-served-path.ts`), `EXAMPLE_DATASETS` (`example-datasets.ts`).
- Produces:
  - `helpers/plot.ts`: `plotSettled(page: Page, capMs = 3_000): Promise<void>` (throws "load the page with ?perfCounters=1" when the counters are absent, else `settle`); `proteinScreenPosition(page: Page, id: string): Promise<Point>` (throws when not plotted); `clusterScreenPoints(page: Page, value: string, limit = 50): Promise<Point[]>` (client positions of plotted proteins whose value for the colouring annotation contains `value`, case-insensitive, as the old capture helper); `duplicateStacks(page: Page): Promise<Array<{ key: string; x: number; y: number; count: number }>>` (client coordinates).
  - `helpers/structure.ts`: `watchStructureLoads(page: Page): Promise<void>` (idempotent; records each `structure-load` detail in the page); `waitForStructureLoaded(page: Page, proteinId: string, timeout = 30_000): Promise<void>` (status `'loaded'` for that protein, then two frames). Arm with `watchStructureLoads` before the click.
  - `helpers/figure.ts`: `figureEditor(page: Page): Locator` (`getByRole('dialog', { name: 'Figure editor' })`); `openFigureEditor(page: Page): Promise<Locator>` (Export → "Figure editor…", the dialog visible, its preview canvas drawn with a non-zero size).
  - `helpers/examples.ts`: `exampleFile(id: string): string` (absolute path of the served file under `apps/web/public`, resolved from `process.cwd()`, which is the repo root for both Playwright configs; throws a clear error if `apps/web/public` is not there); `exampleFetched(id: string): boolean`; `refuseProductionFallback(page: Page): Promise<string[]>` (aborts `https://protspace.app/**`, returns the live list of refused URLs); `serveProductDemo(page: Page, startupGlob: string): Promise<void>` (routes the pinned startup request to the product demo file; the e2e passes `STARTUP_URL_GLOB`); `expectProductDemo(page: Page): Promise<void>` (throws naming the fixture when the page loaded a `/@fs/…parquetbundle`); `openExample(page: Page, id: string, options?: { search?: string; timeout?: number; proteinCount?: number }): Promise<void>` (goto `/explore?dataset=<id>` plus `options.search`, wait for the manifest's or the given protein count).
  - `helpers/explore.ts`: `pasteIntoSearch(page: Page, text: string): Promise<void>`; `searchProteins(page: Page, ids: readonly string[]): Promise<void>` (one id: fill and Enter; several: paste joined with newlines; resolves when the selection bar or the search report shows); `toast(page: Page, text: string | RegExp): Locator`.
  - `helpers/legend.ts`: `doubleClickLegendRow(page: Page, value: string, gapMs = 120): Promise<void>` (a real mouse double click, as `realDoubleClick`); `dragLegendRow(page: Page, from: string, to: string): Promise<void>` (hover the row, press its "Reorder {from}" handle, move in steps to the middle of row `to`, release).

**Tests:**

- `workbench-helpers.spec.ts`, one case each: `plotSettled` resolves after a zoom on a `?perfCounters=1` page and rejects with its message on a page without it; `proteinScreenPosition` lands on a plotted protein (hover there shows that protein's tooltip); `clusterScreenPoints` returns points that hover-identify as the asked category; `duplicateStacks` returns client points inside the plot (or an empty list on a dataset without duplicates — use one that has them, e.g. the EAT fixture via `serveExampleFixtures`); `waitForStructureLoaded` resolves after a click with `stubStructureRequests` (the stub fires `structure-load` `'loaded'`; if it does not, say so in the report and wait on the viewer's loaded state instead); `openFigureEditor` returns the visible dialog; `searchProteins` with two ids selects them (selection bar "2 proteins selected"); `pasteIntoSearch` with one known and one unknown id shows the report; `toast` finds a notification by text; `doubleClickLegendRow` shows only that category; `dragLegendRow` moves a row (order read with `legendRowValues`); `openExample` loads a fixture-served example; `expectProductDemo` rejects on the e2e server (which pins the fixture).
- Verification: `pnpm type-check:scripts`; `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts`; `pnpm knip`.
- Unrun at task time: `figure-editor.spec.ts`, `eat-visualization.spec.ts`, `workbench-feedback.spec.ts`, `workbench-search.spec.ts`, `legend-double-click.spec.ts`, `examples-live.spec.ts` (opt-in, `RUN_EXAMPLES_E2E=1`).

**Commit:** `test(web): page helpers for plot, structure, figure and examples`

Notes for the implementer (checked against `a8cb13ca` plus Task 7.1 in a scratch copy: both `tsc -p scripts/tsconfig.json` and `tsc -p apps/web/tsconfig.e2e.json` pass with the code below, and Prettier leaves it as written):

- `structure-load` bubbles but is not composed; `#myStructureViewer` is in the light DOM, so a `document` listener hears it. The e2e Mol\* stub (`MOLSTAR_STUB`) resolves `loadStructureFromUrl`, after which `structure-viewer.ts` dispatches `'loaded'` (`_dispatchStructureLoadEvent('loaded')`, after `_displayStructure`).
- An annotation column is stored four ways (`packages/utils/src/types.ts` `AnnotationData`: `Int32Array`, `sparse-multi`, `csr`, dense arrays). The old capture helper read only two; `clusterScreenPoints` reads all four, as `getProteinAnnotationIndices` does, inside the page (no module there to import it from).
- Duplicate stacks exist only while the legend setting "Show duplicate counts and spread overlaps" is on (`enableDuplicateStackUI`), and exact duplicates show in some projections only, so the `duplicateStacks` case walks the startup fixture's projections until one has stacks. The old capture found them in the ToxProt demo's PCA, and the fixture is that demo as first shipped. If no projection of the fixture has any, switch the case to the EAT role fixture (`serveExampleFixtures(page)`, `openExample(page, e2eExample('eat').id, { proteinCount: e2eExample('eat').count })`) and say so in the report.
- The figure dialog's content is slotted into `ps-dialog`, so its preview canvas is found from `protspace-publish-modal`, not from the dialog locator (the same reason `openLegendSettings` returns its element). The old spec-local `openFigureEditor` dispatched `open-publish-editor` to dodge an old menu; the helper clicks the real Export menu item.
- `helpers/examples.ts` must not import `helpers/fixtures.ts` (it resolves paths with `import.meta.url`), so `serveProductDemo` takes the startup glob as an argument.
- Every wait below is a signal or a locator assertion. The one fixed pause is `doubleClickLegendRow`'s `gapMs`, the gap between a hand's two clicks, which the old spec-local helper had too; Task 7.4's no-timer test covers `scripts/docs-screenshots/`, not these helpers.

- [ ] **Step 1: Write the failing helper cases**

In `apps/web/tests/workbench-helpers.spec.ts` (as Task 7.1 left it), replace the imports from `./helpers/example-fixtures` down to `./helpers/tour-storage-state`:

```ts
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import {
  appBar,
  chooseTool,
  clearSelection,
```

with

```ts
import { e2eExample, serveExampleFixtures } from './helpers/example-fixtures';
import { expectProductDemo, openExample } from './helpers/examples';
import {
  appBar,
  applyFirstCategoryFilter,
  chooseTool,
  clearSelection,
  clearStatusChip,
  closeFilterPanel,
```

then in the same `./helpers/explore` list replace

```ts
  getCurrentDatasetName,
  getSelectedProteinIds,
```

with

```ts
  getCurrentDatasetName,
  getFirstLegendItemValue,
  getProteinCount,
  getSelectedProteinIds,
```

replace

```ts
  openImportMenu,
  pickExample,
  plotArea,
  queryBuilder,
  resetIsolation,
  searchInput,
  selectAnnotation,
```

with

```ts
  openImportMenu,
  pasteIntoSearch,
  pickExample,
  plotArea,
  queryBuilder,
  resetIsolation,
  searchInput,
  searchProteins,
  selectAnnotation,
  selectionBar,
```

and replace

```ts
  statusChip,
  waitForExploreDataLoad,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';
import { exploreStorageState, seedTourSeen } from './helpers/tour-storage-state';
```

with

```ts
  statusChip,
  toast,
  waitForExploreDataLoad,
  waitForProteinCount,
  type ViewState,
} from './helpers/explore';
import { figureEditor, openFigureEditor } from './helpers/figure';
import {
  closeLegendSettings,
  doubleClickLegendRow,
  dragLegendRow,
  legendRowValues,
  toggleLegendSetting,
} from './helpers/legend';
import {
  clusterScreenPoints,
  duplicateStacks,
  plotSettled,
  proteinScreenPosition,
} from './helpers/plot';
import { waitForStructureLoaded, watchStructureLoads } from './helpers/structure';
import { exploreStorageState, seedTourSeen } from './helpers/tour-storage-state';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';
```

Append at the end of the file (after the `tour storage helpers` describe; `plotProjections` is the spec's existing module-level function):

```ts

/** The first `count` protein ids of the loaded dataset. */
function firstProteinIds(page: Page, count: number): Promise<string[]> {
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

/** A protein drawn on top at its own position, clear of the plot's edges: a hover there shows it. */
function unoccludedProtein(page: Page): Promise<string> {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as HTMLElement & {
      data: { protein_ids: string[] };
      getProteinClientPosition(id: string): { x: number; y: number } | null;
      pickInteractivePointAt(x: number, y: number): { id: string } | null;
    };
    const rect = plot.getBoundingClientRect();
    const margin = 80;
    for (const id of plot.data.protein_ids.slice(0, 500)) {
      const at = plot.getProteinClientPosition(id);
      if (!at) continue;
      if (at.x < rect.left + margin || at.x > rect.right - margin) continue;
      if (at.y < rect.top + margin || at.y > rect.bottom - margin) continue;
      if (plot.pickInteractivePointAt(at.x - rect.left, at.y - rect.top)?.id === id) return id;
    }
    throw new Error('No unoccluded protein among the first 500');
  });
}

const plotTooltip = (page: Page) => page.locator('#myPlot protspace-protein-tooltip');

/** Whether `point` lies inside `box`. */
const inside = (
  point: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number },
) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

test.describe('capture helpers', () => {
  test('plotSettled resolves after a zoom, and needs ?perfCounters=1', async ({ page }) => {
    await openExplore(page, '?perfCounters=1');
    const box = (await plotArea(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await plotSettled(page);

    await openExplore(page);
    await expect(plotSettled(page)).rejects.toThrow('load the page with ?perfCounters=1');
  });

  test('proteinScreenPosition lands on a plotted protein', async ({ page }) => {
    await openExplore(page);
    const id = await unoccludedProtein(page);

    const at = await proteinScreenPosition(page, id);
    await page.mouse.move(at.x, at.y);
    await expect(plotTooltip(page)).toContainText(id);

    await expect(proteinScreenPosition(page, 'NOT_A_PROTEIN_ZZZ')).rejects.toThrow(
      'NOT_A_PROTEIN_ZZZ is not plotted',
    );
  });

  test('clusterScreenPoints finds the points of one category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    const points = await clusterScreenPoints(page, value, 10);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(10);
    const box = (await page.locator('#myPlot').boundingBox())!;
    for (const point of points) expect(inside(point, box)).toBe(true);

    // A hover on one of them names the category (a neighbour may be drawn over some).
    const named: boolean[] = [];
    for (const point of points.slice(0, 5)) {
      await page.mouse.move(point.x, point.y);
      named.push(
        await plotTooltip(page)
          .filter({ hasText: value })
          .waitFor({ timeout: 1_500 })
          .then(
            () => true,
            () => false,
          ),
      );
    }
    expect(named).toContain(true);
    expect(await clusterScreenPoints(page, 'NO_SUCH_CATEGORY_ZZZ')).toEqual([]);
  });

  test('duplicateStacks returns the stacks on the plot', async ({ page }) => {
    await openExplore(page);
    expect(await duplicateStacks(page)).toEqual([]);
    await toggleLegendSetting(page, 'Show duplicate counts and spread overlaps');
    await closeLegendSettings(page);

    // Exact duplicates show in some projections and not others: take the first that has them.
    let stacked = false;
    for (const projection of await plotProjections(page)) {
      await selectProjection(page, projection);
      stacked = await expect
        .poll(async () => (await duplicateStacks(page)).length, { timeout: 5_000 })
        .toBeGreaterThan(0)
        .then(
          () => true,
          () => false,
        );
      if (stacked) break;
    }
    expect(stacked, 'a projection of the startup fixture has duplicate stacks').toBe(true);
    const box = (await page.locator('#myPlot').boundingBox())!;
    for (const stack of await duplicateStacks(page)) {
      expect(stack.count).toBeGreaterThan(1);
      expect(inside(stack, box)).toBe(true);
    }
  });

  test('waitForStructureLoaded resolves once the clicked protein has loaded', async ({ page }) => {
    await stubStructureRequests(page);
    await openExplore(page);
    await expect(waitForStructureLoaded(page, 'ANY')).rejects.toThrow('watchStructureLoads');

    await watchStructureLoads(page);
    await watchStructureLoads(page);
    const id = await clickProteinNearPlotCentre(page);
    await waitForStructureLoaded(page, id);
    await expect(page.locator('#myStructureViewer')).toHaveJSProperty('proteinId', id);
    await expect(waitForStructureLoaded(page, 'NOT_A_PROTEIN_ZZZ', 1_000)).rejects.toThrow();
  });

  test('openFigureEditor opens the figure editor', async ({ page }) => {
    await openExplore(page);
    const dialog = await openFigureEditor(page);
    await expect(dialog).toBeVisible();
    await expect(figureEditor(page)).toBeVisible();
  });

  test('searchProteins selects the given ids', async ({ page }) => {
    await openExplore(page);
    const ids = await firstProteinIds(page, 2);

    await searchProteins(page, ids);
    await expect(selectionBar(page)).toContainText('2 proteins selected');
    await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids);

    await clearSelection(page);
    await searchProteins(page, ids.slice(0, 1));
    await expect.poll(() => getSelectedProteinIds(page)).toEqual(ids.slice(0, 1));
  });

  test('pasteIntoSearch reports found and missing ids', async ({ page }) => {
    await openExplore(page);
    const [id] = await firstProteinIds(page, 1);

    await pasteIntoSearch(page, `${id}\nNOT_A_PROTEIN_ZZZ`);
    await expect(page.locator('protspace-protein-search .search-report')).toContainText(
      '1 of 2 found',
    );
  });

  test('toast finds a notification by its text', async ({ page }) => {
    await openExplore(page);
    await applyFirstCategoryFilter(page);
    await closeFilterPanel(page);
    await clearStatusChip(page, 'filter');

    await expect(toast(page, 'Filter removed')).toBeVisible();
    await expect(toast(page, /^Filter rem/)).toBeVisible();
    await expect(toast(page, 'NO_SUCH_NOTIFICATION')).toHaveCount(0);
  });

  test('doubleClickLegendRow shows only that category', async ({ page }) => {
    await openExplore(page);
    const value = await getFirstLegendItemValue(page);

    await doubleClickLegendRow(page, value);
    await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([value]);
  });

  test('dragLegendRow moves a row above another', async ({ page }) => {
    await openExplore(page);
    const rows = (await legendRowValues(page)).filter(
      (value) => value !== 'Other' && value !== '__NA__',
    );
    const [first, second] = rows;

    await dragLegendRow(page, second, first);
    await expect
      .poll(async () => {
        const order = await legendRowValues(page);
        return order.indexOf(second) < order.indexOf(first);
      })
      .toBe(true);
  });

  test('openExample opens an example by its link', async ({ page }) => {
    await serveExampleFixtures(page);
    const example = e2eExample('other');

    await openExample(page, example.id, { proteinCount: example.count });
    expect(await getProteinCount(page)).toBe(example.count);
    expect(new URL(page.url()).searchParams.get('dataset')).toBe(example.id);
  });

  test('expectProductDemo refuses the e2e startup fixture', async ({ page }) => {
    await openExplore(page);
    await expect(expectProductDemo(page)).rejects.toThrow('E2E startup fixture');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-helpers.spec.ts -g "capture helpers"`
Expected: FAIL before any test runs: the spec does not load (`./helpers/examples`, `./helpers/figure`, `./helpers/plot` and `./helpers/structure` do not exist; `pasteIntoSearch`, `searchProteins`, `toast`, `doubleClickLegendRow`, `dragLegendRow` are not exported).

- [ ] **Step 3: Create `helpers/plot.ts`**

Create `apps/web/tests/helpers/plot.ts`:

```ts
/**
 * Plot reads that have no DOM to find by role: where a protein, a category or a duplicate stack
 * sits on screen, and whether the plot has stopped drawing. Each reads the scatterplot's public
 * automation methods (`getProteinClientPosition`, `getDuplicateStacks`, `dataToClient`), so a spec
 * or a docs capture asks for a point by name and never evaluates in the page itself.
 */
import type { Page } from '@playwright/test';
import type { Point } from './mobile';
import { settle } from './perf/probes';

/** The scatterplot's data and automation methods, as these reads use them. */
interface PlotAutomation extends HTMLElement {
  data?: {
    protein_ids: string[];
    annotations?: Record<string, { values: Array<string | null> }>;
    annotation_data?: Record<string, unknown>;
  } | null;
  selectedAnnotation?: string;
  getProteinClientPosition(proteinId: string): Point | null;
  getDuplicateStacks(): Array<{ key: string; x: number; y: number; count: number }>;
  dataToClient(x: number, y: number): Point | null;
}

/**
 * Waits until the plot has stopped drawing: the perf counters and GL probes hold still for two
 * frames and 200 ms (`settle`). Needs `?perfCounters=1` in the page URL, which exposes the
 * counters; throws at once without it, and at `capMs` when the plot keeps drawing.
 */
export async function plotSettled(page: Page, capMs = 3_000): Promise<void> {
  const counted = await page.evaluate(() => window.__protspacePerfCounters !== undefined);
  if (!counted) {
    throw new Error('plotSettled reads the perf counters: load the page with ?perfCounters=1');
  }
  await settle(page, capMs);
}

/** Viewport coordinates of a protein's marker; throws when the protein is not plotted. */
export async function proteinScreenPosition(page: Page, id: string): Promise<Point> {
  const position = await page
    .locator('#myPlot')
    .evaluate(
      (element, proteinId) => (element as PlotAutomation).getProteinClientPosition(proteinId),
      id,
    );
  if (!position) {
    throw new Error(`Protein ${id} is not plotted, or the scatter plot has no geometry yet`);
  }
  return position;
}

/**
 * Viewport coordinates of up to `limit` plotted proteins whose value for the colour-by annotation
 * contains `value` (case-insensitive), inside the plot and without outliers: points further than
 * twice the median absolute deviation from the median, on either axis, are dropped. Spread evenly
 * over the matches. Empty when nothing matches.
 */
export async function clusterScreenPoints(page: Page, value: string, limit = 50): Promise<Point[]> {
  return page.locator('#myPlot').evaluate(
    (element, { needle, max }) => {
      const plot = element as PlotAutomation;
      const annotation = plot.selectedAnnotation;
      const data = plot.data;
      if (!data || !annotation) return [];
      const labels = data.annotations?.[annotation]?.values;
      const rows = data.annotation_data?.[annotation];
      if (!labels || !rows) return [];

      // The column's storage shapes (packages/utils annotation-data-access.ts).
      const codesAt = (index: number): readonly number[] => {
        if (rows instanceof Int32Array) return rows[index] < 0 ? [] : [rows[index]];
        if (Array.isArray(rows)) return (rows[index] as number[] | undefined) ?? [];
        const shaped = rows as {
          kind?: string;
          base?: Int32Array;
          overrides?: Map<number, number[]>;
          offsets?: Int32Array;
          codes?: Int32Array;
        };
        if (shaped.kind === 'sparse-multi' && shaped.base && shaped.overrides) {
          const override = shaped.overrides.get(index);
          if (override) return override;
          return shaped.base[index] < 0 ? [] : [shaped.base[index]];
        }
        if (shaped.kind === 'csr' && shaped.offsets && shaped.codes) {
          return Array.from(
            shaped.codes.subarray(shaped.offsets[index], shaped.offsets[index + 1]),
          );
        }
        return [];
      };

      const lower = needle.toLowerCase();
      const rect = plot.getBoundingClientRect();
      const points: Array<{ x: number; y: number }> = [];
      data.protein_ids.forEach((id, index) => {
        const matches = codesAt(index).some((code) =>
          (labels[code] ?? '').toLowerCase().includes(lower),
        );
        if (!matches) return;
        // null when the protein is not plotted (filtered or isolated away)
        const at = plot.getProteinClientPosition(id);
        if (!at) return;
        if (at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) return;
        points.push(at);
      });
      if (points.length === 0) return [];

      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };
      const medX = median(points.map((p) => p.x));
      const medY = median(points.map((p) => p.y));
      const madX = median(points.map((p) => Math.abs(p.x - medX))) * 1.4826;
      const madY = median(points.map((p) => Math.abs(p.y - medY))) * 1.4826;
      const kept = points.filter(
        (p) =>
          (madX === 0 || Math.abs(p.x - medX) <= 2 * madX) &&
          (madY === 0 || Math.abs(p.y - medY) <= 2 * madY),
      );
      const cluster = kept.length > 0 ? kept : points;
      const step = Math.max(1, Math.ceil(cluster.length / max));
      return cluster.filter((_, index) => index % step === 0).slice(0, max);
    },
    { needle: value, max: limit },
  );
}

/**
 * The duplicate stacks in the current view, at their viewport coordinates. Empty unless the
 * legend's "Show duplicate counts and spread overlaps" setting is on.
 */
export async function duplicateStacks(
  page: Page,
): Promise<Array<{ key: string; x: number; y: number; count: number }>> {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as PlotAutomation;
    return plot.getDuplicateStacks().flatMap((stack) => {
      const at = plot.dataToClient(stack.x, stack.y);
      return at ? [{ key: stack.key, x: at.x, y: at.y, count: stack.count }] : [];
    });
  });
}
```

- [ ] **Step 4: Create `helpers/structure.ts`**

Create `apps/web/tests/helpers/structure.ts`:

```ts
/**
 * Waiting for a structure to load, by the viewer's own signal: `#myStructureViewer` dispatches a
 * bubbling `structure-load` event with `status: 'loaded'` once Mol* has shown the protein (or, in
 * the e2e suite, once `stubStructureRequests`' viewer has taken it). Replaces fixed sleeps.
 */
import type { Page } from '@playwright/test';

/** What each `structure-load` event said, in order; kept on the window by `watchStructureLoads`. */
type StructureLoadLog = Array<{ proteinId: string; status: string }>;
type LoadWatchingWindow = Window & { __structureLoads?: StructureLoadLog };

/**
 * Starts recording the viewer's `structure-load` events in the page. Call it before the click that
 * loads a structure; calling it again keeps the one recorder. A navigation drops it.
 */
export async function watchStructureLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as LoadWatchingWindow;
    if (win.__structureLoads) return;
    const log: StructureLoadLog = [];
    win.__structureLoads = log;
    document.addEventListener('structure-load', (event) => {
      const detail = (event as CustomEvent<{ proteinId: string; status: string }>).detail;
      log.push({ proteinId: detail.proteinId, status: detail.status });
    });
  });
}

/**
 * Waits until the viewer reports `proteinId` loaded, then for two frames so its canvas has drawn.
 * Throws when `watchStructureLoads` was not called on this page.
 */
export async function waitForStructureLoaded(
  page: Page,
  proteinId: string,
  timeout = 30_000,
): Promise<void> {
  const watching = await page.evaluate(() =>
    Array.isArray((window as LoadWatchingWindow).__structureLoads),
  );
  if (!watching) {
    throw new Error('Call watchStructureLoads(page) before the click that loads the structure');
  }
  await page.waitForFunction(
    (id) =>
      ((window as LoadWatchingWindow).__structureLoads ?? []).some(
        (load) => load.proteinId === id && load.status === 'loaded',
      ),
    proteinId,
    { timeout, polling: 100 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
```

- [ ] **Step 5: Create `helpers/figure.ts`**

Create `apps/web/tests/helpers/figure.ts`:

```ts
/** The figure editor, opened from the Export menu as a person opens it. */
import { expect, type Locator, type Page } from '@playwright/test';
import { exportAction } from './explore';

/** The figure editor's dialog, named by its heading. */
export const figureEditor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Figure editor' });

/**
 * Export → "Figure editor…", then waits for the dialog and for its preview canvas to have a size,
 * which it gets once the first preview is drawn. Returns the dialog.
 */
export async function openFigureEditor(page: Page): Promise<Locator> {
  await exportAction(page, 'Figure editor…');
  const dialog = figureEditor(page);
  await expect(dialog).toBeVisible();
  // The canvas is slotted into the dialog, so it is found from the modal, not from the dialog.
  const canvas = page.locator('protspace-publish-modal .publish-preview-canvas');
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const preview = element as HTMLCanvasElement;
        return preview.width > 0 && preview.height > 0;
      }),
    )
    .toBe(true);
  return dialog;
}
```

- [ ] **Step 6: Create `helpers/examples.ts`**

Create `apps/web/tests/helpers/examples.ts`:

```ts
/**
 * The product's example bundles, as the dev server serves them from `apps/web/public` once
 * `pnpm examples:fetch` has run: where each file is, routing the product demo and the production
 * fallback, and opening an example by its `?dataset=` link. Shared by the opt-in `examples-live`
 * e2e project and the docs captures, so it never uses `import.meta` (the root Playwright config
 * loads it as CommonJS) and resolves files from the working directory, which is the repository
 * root under both Playwright configs.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET, findExampleDataset } from '../../src/explore/example-datasets';
import { EXAMPLE_MANIFEST } from '../../src/explore/example-manifest';
import { exampleServedPath } from '../../src/explore/example-served-path';
import { waitForExploreDataLoad } from './explore';

function publicDir(): string {
  const dir = path.join(process.cwd(), 'apps/web/public');
  if (!existsSync(dir)) {
    throw new Error(
      `No apps/web/public under ${process.cwd()}: run Playwright from the repository root`,
    );
  }
  return dir;
}

/** Absolute path of an example's bundle as the app serves it (fetched, or committed). */
export function exampleFile(id: string): string {
  const record = EXAMPLE_MANIFEST.examples[id];
  if (!record) throw new Error(`The example manifest has no "${id}"`);
  return path.join(publicDir(), exampleServedPath(record));
}

/** Whether the example's bundle is on disk; a release-hosted one needs `pnpm examples:fetch`. */
export function exampleFetched(id: string): boolean {
  return existsSync(exampleFile(id));
}

/**
 * Aborts every request to protspace.app, where a development build fetches an example it has no
 * local file for, so a missing file fails instead of loading the deployed copy. Returns the list of
 * refused URLs, which grows as requests are refused.
 */
export async function refuseProductionFallback(page: Page): Promise<string[]> {
  const refused: string[] = [];
  await page.route('https://protspace.app/**', (route) => {
    refused.push(route.request().url());
    return route.abort();
  });
  return refused;
}

/**
 * Answers the startup demo's request (matched by `startupGlob`) with the product demo, for a
 * server that pins the startup load to a test fixture (`VITE_STARTUP_DATASET_URL`).
 */
export async function serveProductDemo(page: Page, startupGlob: string): Promise<void> {
  const demo = exampleFile(DEFAULT_EXAMPLE_DATASET.id);
  await page.route(startupGlob, (route) =>
    route.fulfill({ path: demo, contentType: 'application/octet-stream' }),
  );
}

/**
 * Throws when the page loaded the e2e startup fixture (a `/@fs/…parquetbundle`) instead of the
 * product demo: the sign of a server started for the e2e suite.
 */
export async function expectProductDemo(page: Page): Promise<void> {
  const pinned = await page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => name.includes('/@fs/') && name.endsWith('.parquetbundle')) ?? null,
  );
  if (pinned) {
    throw new Error(
      `The app at ${new URL(page.url()).origin} loaded the E2E startup fixture (${pinned}), ` +
        'not the product demo: use a server started without VITE_STARTUP_DATASET_URL.',
    );
  }
}

/**
 * Opens `/explore?dataset=<id>` (plus `options.search`, which starts with `&`) and waits until the
 * plot holds the example: the manifest's protein count, or `options.proteinCount` for a fixture
 * served in its place. The wait defaults to 180 s for a large example, else 60 s.
 */
export async function openExample(
  page: Page,
  id: string,
  options: { search?: string; timeout?: number; proteinCount?: number } = {},
): Promise<void> {
  const entry = findExampleDataset(id);
  if (!entry) throw new Error(`The example catalog has no "${id}"`);
  const timeout = options.timeout ?? (entry.large ? 180_000 : 60_000);
  const proteinCount = options.proteinCount ?? EXAMPLE_MANIFEST.examples[id].proteins;
  await page.goto(`/explore?dataset=${encodeURIComponent(id)}${options.search ?? ''}`);
  await waitForExploreDataLoad(page, { timeout, proteinCount });
}
```

(`expectProductDemo` is the old capture helper `assertProductStartupDataset`, which Task 7.1 deleted from `scripts/docs-screenshots/helpers.ts`, with the e2e wording.)

- [ ] **Step 7: Add the search, toast and legend actions**

In `apps/web/tests/helpers/explore.ts`, after the `selectionBarAction` definition (the line `): Locator => selectionBar(page).getByRole('button', { name, exact: true });`) insert:

```ts

/** The search's report under the field: found and missing ids, or why a hit is not shown. */
const searchReport = (page: Page): Locator =>
  page.locator('protspace-protein-search .search-report');

/** Pastes `text` into the search box, as a browser does on ⌘V / Ctrl+V. */
export async function pasteIntoSearch(page: Page, text: string): Promise<void> {
  await searchInput(page).focus();
  await searchInput(page).evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }, text);
}

/**
 * Selects proteins through the search box: one id is typed and entered, several are pasted one per
 * line. Resolves once the selection bar or the search's report shows.
 */
export async function searchProteins(page: Page, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) throw new Error('searchProteins needs at least one id');
  if (ids.length === 1) {
    await searchInput(page).fill(ids[0]);
    await searchInput(page).press('Enter');
  } else {
    await pasteIntoSearch(page, ids.join('\n'));
  }
  await expect(
    selectionBar(page).or(searchReport(page)).filter({ visible: true }).first(),
  ).toBeVisible();
}

/** A notification (a Sonner toast) by its text. */
export const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: text });
```

(`pasteIntoSearch` is `workbench-search.spec.ts`'s `paste`, moved; `toast` is `workbench-feedback.spec.ts`'s, widened to a RegExp.)

Append to `apps/web/tests/helpers/legend.ts` (it can use the module-private `legendItem`):

```ts

/**
 * A real double click on a row: click (detail 1), a pause, click (detail 2) and dblclick, as a
 * hand makes one. Playwright's `dblclick()` sends the two clicks back to back, which the legend
 * cannot tell from one click being repeated.
 */
export async function doubleClickLegendRow(page: Page, value: string, gapMs = 120): Promise<void> {
  const box = await legendRow(page, value).boundingBox();
  if (!box) throw new Error(`No legend row for ${value}`);
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.waitForTimeout(gapMs);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

/**
 * Drags row `from` by its "Reorder …" handle onto the middle of row `to`, with the mouse and in
 * steps, which is what Sortable reads as a drag. Hovers the row first, which shows its handle.
 */
export async function dragLegendRow(page: Page, from: string, to: string): Promise<void> {
  await legendRow(page, from).hover();
  const handle = await legendItem(page, from)
    .getByRole('button', { name: /^Reorder / })
    .boundingBox();
  if (!handle) throw new Error(`No drag handle on the legend row ${from}`);
  const target = await legendItem(page, to).boundingBox();
  if (!target) throw new Error(`No legend row for ${to}`);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.up();
}
```

(The handle's name is `Reorder {display value}` (`legend-row.ts`), which differs from the raw value for N/A, so it is found by its prefix inside the row.)

- [ ] **Step 8: Put the new modules under the scripts tsconfig**

In `scripts/tsconfig.json`, replace

```json
    "../apps/web/tests/helpers/perf/probes.ts"
```

with

```json
    "../apps/web/tests/helpers/perf/probes.ts",
    "../apps/web/tests/helpers/plot.ts",
    "../apps/web/tests/helpers/structure.ts",
    "../apps/web/tests/helpers/figure.ts",
    "../apps/web/tests/helpers/examples.ts"
```

Run: `pnpm type-check:scripts`
Expected: no errors. (`examples.ts` reaches `apps/web/src/explore/example-datasets.ts`, whose `import.meta.env?.` is typed by `vite-env.d.ts`, already in the include list.)

- [ ] **Step 9: Run the helper cases**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-helpers.spec.ts -g "capture helpers"`
Expected: PASS, 13 tests. If "clusterScreenPoints finds the points of one category" fails only on its hover check because the tooltip does not show the colour-by value, assert the hovered protein instead (`plotTooltip(page)` visible after the move) and say so in the report; do not weaken the inside-the-plot and limit checks.

- [ ] **Step 10: Replace the spec-local copies**

`apps/web/tests/figure-editor.spec.ts`: replace

```ts
import { dismissTourIfPresent, exportMenu, waitForExploreDataLoad } from './helpers/explore';
```

with

```ts
import { dismissTourIfPresent, waitForExploreDataLoad } from './helpers/explore';
import { openFigureEditor } from './helpers/figure';
```

and delete the local `async function openFigureEditor(page: Page): Promise<void> { … }` (from that line through its closing `}` and the blank line after it, just above `/** Inject an inset via state mutation`). Its three call sites (`await openFigureEditor(page);`) stay as they are.

`apps/web/tests/eat-visualization.spec.ts`: after `import { STARTUP_URL_GLOB } from './helpers/fixtures';` add

```ts
import { proteinScreenPosition } from './helpers/plot';
```

delete the local `async function getProteinScreenPosition(` … `}` (the whole function, just above `async function sampleEncodedExportMarkers(`), and rename its four call sites `getProteinScreenPosition(page, …)` to `proteinScreenPosition(page, …)` (the `A0JMF6`, the two `O88488` and the `transfer.target` reads).

`apps/web/tests/workbench-feedback.spec.ts`: replace `import { expect, test, type Locator, type Page } from '@playwright/test';` with `import { expect, test, type Page } from '@playwright/test';`; in the `./helpers/explore` list replace `  searchInput,` with `  searchProteins,` and add `  toast,` after `  statusChip,`; delete

```ts
const toast = (page: Page, text: string): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: text });

```

and

```ts
async function selectBySearch(page: Page, id: string): Promise<void> {
  await searchInput(page).fill(id);
  await searchInput(page).press('Enter');
  await expect(selectionBar(page)).toBeVisible();
}

```

and replace both `await selectBySearch(page, await firstProteinId(page));` with

```ts
    await searchProteins(page, [await firstProteinId(page)]);
```

(`selectionBar` stays imported: "with a selection the toast sits above the selection bar" measures it.)

`apps/web/tests/workbench-search.spec.ts`: in the `./helpers/explore` list add `  pasteIntoSearch,` after `  openExplore,`; delete the local `paste` function with its one-line comment ("Pastes `text` into the search box…") (through its closing `}` and blank line, just above `type Transform`); rename both `await paste(page, ` to `await pasteIntoSearch(page, `.

`apps/web/tests/legend-double-click.spec.ts`: after `} from './helpers/explore';` add

```ts
import { doubleClickLegendRow, legendRow } from './helpers/legend';
```

delete the local `const legendRow = (page: Page, value: string) =>` and `async function realDoubleClick(` (both, through `realDoubleClick`'s closing `}` and the blank line, just above `test.describe('Legend double-click'`), rename the three `await realDoubleClick(page, value);` to `await doubleClickLegendRow(page, value);`, and in the file's opening comment replace

```ts
 * milliseconds apart. Playwright's `dblclick()` sends them back to back, so these specs press
 * the button themselves with a pause between the clicks.
```

with

```ts
 * milliseconds apart. Playwright's `dblclick()` sends them back to back, so these specs use
 * `doubleClickLegendRow`, which pauses between the clicks.
```

(The shared `legendRow` anchors on the row's count, `^{value}( · …)?: N proteins, `, where the local one anchored on `^{value}:`; both name the same button.)

`apps/web/tests/examples-live.spec.ts`: replace the imports

```ts
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import { EXAMPLE_MANIFEST } from '../src/explore/example-manifest';
import { exampleServedPath } from '../src/explore/example-served-path';
import {
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  getViewState,
  waitForExploreDataLoad,
} from './helpers/explore';
```

with

```ts
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../src/explore/example-datasets';
import {
  exampleFetched,
  exampleFile,
  openExample,
  refuseProductionFallback,
  serveProductDemo,
} from './helpers/examples';
import {
  collectDefaultViewDriftWarnings,
  curatedViewOf,
  dismissTourIfPresent,
  getViewState,
} from './helpers/explore';
```

delete the line `const PUBLIC_DIR = path.join(REPO_ROOT, 'apps/web/public');`, delete the local `localFile`, `serveProductDemo` and `refuseProductionFallback` with their comments (from the comment that starts "Where `pnpm examples:fetch` puts a release-hosted file" to just above `async function waitForLegendItems(`), and in the test body replace

```ts
      const record = EXAMPLE_MANIFEST.examples[entry.id];
      expect(
        existsSync(localFile(entry.id)),
        `${path.relative(REPO_ROOT, localFile(entry.id))} is missing; run \`pnpm examples:fetch\`.`,
      ).toBe(true);

      const driftWarnings = collectDefaultViewDriftWarnings(page);
      const fallbacks: string[] = [];
      await refuseProductionFallback(page, fallbacks);
      await serveProductDemo(page);

      await page.goto(`/explore?dataset=${entry.id}`);
      await dismissTourIfPresent(page);
      // The manifest's count, so the wait cannot pass on another dataset.
      await waitForExploreDataLoad(page, { timeout: loadTimeout, proteinCount: record.proteins });
```

with

```ts
      expect(
        exampleFetched(entry.id),
        `${path.relative(REPO_ROOT, exampleFile(entry.id))} is missing; run \`pnpm examples:fetch\`.`,
      ).toBe(true);

      const driftWarnings = collectDefaultViewDriftWarnings(page);
      const fallbacks = await refuseProductionFallback(page);
      await serveProductDemo(page, STARTUP_URL_GLOB);

      // Waits for the manifest's count, so the wait cannot pass on another dataset.
      await openExample(page, entry.id, { timeout: loadTimeout });
      await dismissTourIfPresent(page);
```

The rest (the curated-view, URL, drift and fallback assertions, `waitForLegendItems` and the thumbnail screenshot) stays until Task 7.3.

- [ ] **Step 11: Run the task's checks**

Run: `pnpm type-check:scripts && pnpm --filter @protspace/app type-check`
Expected: no errors (the second checks every edited spec through `tsconfig.e2e.json`).

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project workbench workbench-helpers.spec.ts`
Expected: PASS, 24 tests (Task 7.1's 11 and the 13 capture-helper cases).

Run: `pnpm knip`
Expected: no issues. Each new export has a consumer: the helper cases use all of them, and `examples-live.spec.ts`, `figure-editor.spec.ts`, `eat-visualization.spec.ts`, `workbench-feedback.spec.ts`, `workbench-search.spec.ts` and `legend-double-click.spec.ts` use theirs.

Run: `pnpm exec prettier --check scripts/tsconfig.json apps/web/tests/helpers/plot.ts apps/web/tests/helpers/structure.ts apps/web/tests/helpers/figure.ts apps/web/tests/helpers/examples.ts apps/web/tests/helpers/explore.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/figure-editor.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/workbench-feedback.spec.ts apps/web/tests/workbench-search.spec.ts apps/web/tests/legend-double-click.spec.ts apps/web/tests/examples-live.spec.ts`
Expected: all files pass.

Unrun at task time (the exit runs them): `figure-editor.spec.ts`, `eat-visualization.spec.ts`, `workbench-feedback.spec.ts`, `workbench-search.spec.ts`, `legend-double-click.spec.ts`, `examples-live.spec.ts` (opt-in, `RUN_EXAMPLES_E2E=1`).

- [ ] **Step 12: Commit**

```bash
git add scripts/tsconfig.json apps/web/tests/helpers/plot.ts apps/web/tests/helpers/structure.ts apps/web/tests/helpers/figure.ts apps/web/tests/helpers/examples.ts apps/web/tests/helpers/explore.ts apps/web/tests/helpers/legend.ts apps/web/tests/workbench-helpers.spec.ts apps/web/tests/figure-editor.spec.ts apps/web/tests/eat-visualization.spec.ts apps/web/tests/workbench-feedback.spec.ts apps/web/tests/workbench-search.spec.ts apps/web/tests/legend-double-click.spec.ts apps/web/tests/examples-live.spec.ts
git commit -m "test(web): page helpers for plot, structure, figure and examples"
```

(Sandbox disabled: the hook runs `pnpm precommit`.)

### Task 7.3: Capture runner for screenshots; the example thumbnails move here

The manifest, the runner and the PNG project, proven on the five example thumbnails, which leave `examples-live`. The root config starts its own server, contexts pin the colour scheme per variant, and the old static captures are deleted (their images stay until their page task regenerates them).

**Files:**

- Create: `scripts/docs-screenshots/capture-plan.ts`, `runner.ts`, `capture-png.spec.ts`, `manifest.ts`, `scenes/examples.ts`
- Create: `apps/web/src/explore/docs-images.test.ts`
- Modify: `playwright.config.ts` (root: server, `docs-png` replaces `screenshots`; `animations` untouched until 7.4)
- Modify: `package.json` (`docs:screenshots` → `playwright test --project=docs-png`)
- Modify: `apps/web/tests/examples-live.spec.ts` (screenshot, `THUMBNAIL_DIR`, `EXAMPLES_THUMBNAIL_DIR`, `mkdirSync` and `waitForLegendItems` deleted; assertions kept), `apps/web/tests/playwright.config.ts` (the comment about `docs:images` reusing :8080)
- Modify: `docs/scripts/generate-examples.mts` (:147-149 message: capture with `pnpm docs:screenshots -g "examples/<id>.png"`), `CONTRIBUTING.md` (:324, :335-337), `docs/explore/images/README.md` (the thumbnails paragraph)
- Modify: `scripts/docs-screenshots/helpers.ts` (the exports only the deleted static captures used go: `createSharedCapturePage`, `waitForStructureViewer`, `clickProteinPoint`, the `awaitTwoFrames` export, `SCREENSHOT_VIEWPORT`, and the imports they leave unused; the file itself goes in 7.4)
- Delete: `scripts/docs-screenshots/capture-static.spec.ts`, `capture-eat-static.spec.ts`
- Regenerate: `docs/explore/images/examples/{demo,beta-lactamase,human-fly,swissprot,three-finger-toxins}.png`

Why `helpers.ts` and the images README are in the list (the commit must pass the hook): `scripts/docs-screenshots/helpers.ts` loses the exports only the two deleted static captures used (`createSharedCapturePage`, `waitForStructureViewer`, `clickProteinPoint`, the export of `awaitTwoFrames`) and the module constant `SCREENSHOT_VIEWPORT`, or knip reports them unused and `tsc` the leftover imports; `docs/explore/images/README.md` also gets its "Capturing against another port" section and its screenshot bullet corrected, since this task makes both wrong.

**Interfaces:**

- Consumes: `exploreStorageState`, `seedTourSeen` (7.1); `waitForExploreDataLoad` (`helpers/explore.ts`); `plotSettled` (`helpers/plot.ts`), `openExample`, `expectProductDemo`, `exampleFetched` (`helpers/examples.ts`) (7.2); `DEFAULT_LAYOUT`, `type LayoutState` (`apps/web/src/explore/layout-defaults.ts`); `EXAMPLE_DATASETS` (`example-datasets.ts`, catalog order), `EXAMPLE_MANIFEST` (protein counts); `IMAGES_DIR` (`paths.ts`); `devices` (`@playwright/test`).
- Produces:
  - `capture-plan.ts` (imports only types from `@playwright/test` and `layout-defaults.ts`):
    - `type Theme = 'light' | 'dark'`; `type CaptureKind = 'png' | 'gif'`; `type ViewportName = 'desktop' | 'tablet' | 'phone'`.
    - `interface Clip { x: number; y: number; width: number; height: number }`.
    - `export interface CaptureApi { readonly kind: CaptureKind; readonly theme: Theme; hold(ms: number): Promise<void>; click(target: Locator | { x: number; y: number }, options?: { label?: string }): Promise<void>; press(key: string, options?: { label?: string }): Promise<void>; moveTo(target: Locator | { x: number; y: number }, options?: { steps?: number }): Promise<void>; drag(from: { x: number; y: number }, to: { x: number; y: number }, options?: { steps?: number }): Promise<void>; label(text: string): Promise<void> }` — in PNG captures `hold` and `label` resolve at once and `click`/`press`/`moveTo`/`drag` act without overlays (Task 7.4 adds the GIF overlays).
    - `interface CaptureEntry { name: string; kind: CaptureKind; viewport: ViewportName | { width: number; height: number }; themes?: readonly Theme[] /* default ['light'] */; scale?: 1 | 2 /* PNG desktop, default 2 */; dataset?: string /* 'demo' (default: the startup demo) or an example id */; layout?: Partial<LayoutState>; setup?: (page: Page, cap: CaptureApi) => Promise<void>; steps?: (page: Page, cap: CaptureApi) => Promise<void>; target?: (page: Page) => Locator | Promise<Locator | Clip> /* default: the viewport */; keepPointer?: boolean; timeoutMs?: number; budgetBytes?: number /* GIF only */; gif?: { fps?: number; width?: number }; docs: readonly string[] /* pages relative to docs/, e.g. 'explore/index.md' */ }`.
    - `const DESKTOP_VIEWPORT = { width: 1280, height: 720 }`, `const TABLET_VIEWPORT = { width: 800, height: 1280 }`, `const DEFAULT_GIF_BUDGET = 3 * 1024 * 1024`.
    - `outputFile(name: string, kind: CaptureKind, theme: Theme): string` (`'x', 'png', 'dark'` → `'x-dark.png'`).
    - `interface CaptureVariant { entry: CaptureEntry; theme: Theme; file: string }`; `captureVariants(entries: readonly CaptureEntry[], kind?: CaptureKind): CaptureVariant[]` (manifest order, light before dark).
    - `validateManifest(entries: readonly CaptureEntry[]): string[]` (one message per problem: duplicate name, a name that is not lowercase kebab-case under an optional `examples/`, an extension in the name, `dark` on a GIF, `budgetBytes` or `gif` on a PNG, `scale` on a GIF or a non-desktop entry, empty `docs`, a `docs` path not ending in `.md`).
  - `runner.ts`: `registerCaptures(kind: CaptureKind): void` — throws when `validateManifest(MANIFEST)` reports anything; one `test.describe(file)` per variant of that kind with `test.use(...)` (viewport, device descriptor without `defaultBrowserType`, `deviceScaleFactor`, `colorScheme`, `reducedMotion`, `storageState: exploreStorageState(baseURL, { layout: { ...DEFAULT_LAYOUT, ...entry.layout }, theme: 'system' })`); the test titled `file` opens, waits and shoots in the order of the Global Constraints; an example whose file is not fetched fails with "run `pnpm examples:fetch`".
  - `capture-png.spec.ts`: `registerCaptures('png')`.
  - `manifest.ts`: `export const MANIFEST: readonly CaptureEntry[] = [...EXAMPLE_CAPTURES]` (later tasks append their scenes).
  - `scenes/examples.ts`: `export const EXAMPLE_CAPTURES: CaptureEntry[]` — one entry per `EXAMPLE_DATASETS` id: name `examples/<id>`, `kind: 'png'`, `viewport: 'desktop'`, `scale: 1`, `themes: ['light']`, `dataset: <id>`, `target: [data-workbench="body"]`, `timeoutMs` 240 000 for `large` entries, `docs: ['explore/example-datasets.md']`; steps wait until the legend shows rows.

**Tests:**

- `apps/web/src/explore/docs-images.test.ts` (imports `../../../../scripts/docs-screenshots/capture-plan`): `outputFile` names (light, dark, under `examples/`); `captureVariants` expands `themes` light-then-dark, defaults to light, filters by kind, keeps manifest order; `validateManifest` returns one message for each bad case listed above and none for a valid PNG, dark PNG and GIF entry.
- Verification: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`; `pnpm exec playwright test --project=docs-png --list` lists exactly the five `examples/<id>.png` titles; `pnpm docs:screenshots -g "examples/"` (sandbox disabled; `pnpm examples:fetch` first; if `swissprot` cannot be fetched, capture the others and leave its old file for the exit run, and say so); `pnpm docs:examples:check`; `pnpm type-check:scripts`; `pnpm knip`.
- Unrun at task time: `examples-live.spec.ts` (opt-in).

**Commit:** `feat(docs): capture runner with the example thumbnails`

Notes for the implementer (the code below was type-checked under `scripts/tsconfig.json` and `tsconfig.app.json` in a scratch copy of the tree with Tasks 7.1 and 7.2 applied, and `playwright test --list --project=docs-png` with this config listed the five thumbnail titles, which proves the CommonJS root config loads the ESM helpers at run time):

- The context options go through `test.use` inside each file's `test.describe`. Playwright refuses a worker-scoped option there ("Cannot use({ … }) in a describe group, because it forces a new worker"): `defaultBrowserType` (hence the descriptor without it) and `video` (which is why Task 7.4 records its own context). `viewport`, `userAgent`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `colorScheme`, `reducedMotion` and `storageState` are test-scoped and allowed. `storageState` is a fixture function because it needs `baseURL`.
- The tour is marked seen by `exploreStorageState` itself (it reads Task 7.1's `TOUR_SEEN`), so the runner does not also call `seedTourSeen`.
- An entry with `dataset` (including `'demo'`, as the thumbnail of the demo has) opens `/explore?dataset=<id>&perfCounters=1` through `openExample`; an entry without one opens `/explore?perfCounters=1`, the startup demo. Both then run `expectProductDemo` and `plotSettled` (cap 10 s, since a large example's first draws run long).
- `capture-plan.ts` is imported by an app test, so it must stay free of Node and Playwright values (types only). The test does not import `manifest.ts`: the scenes import `expect` from `@playwright/test`, which must not load under Vitest. The runner validates the manifest at registration, and Task 7.5's hook check does too.
- No file under `scripts/docs-screenshots/` may contain the word `shadowRoot`, and only `runner.ts` the word `waitForTimeout` (Task 7.4's test reads every file there as text, comments included). The code below keeps to that.

- [ ] **Step 1: Write the failing pure tests**

Create `apps/web/src/explore/docs-images.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  outputFile,
  validateManifest,
  type CaptureEntry,
} from '../../../../scripts/docs-screenshots/capture-plan';

/**
 * Pins the docs media pipeline's pure rules (scripts/docs-screenshots/capture-plan.ts): how an
 * entry's files are named, which files it expands to, and which entries the runner refuses.
 * The runner and the pre-commit lint both rely on them, and neither runs in `pnpm test`.
 */

/** A valid desktop screenshot entry, with `overrides` applied. */
function entry(overrides: Partial<CaptureEntry> & { name: string }): CaptureEntry {
  return { kind: 'png', viewport: 'desktop', docs: ['explore/index.md'], ...overrides };
}

describe('outputFile', () => {
  it.each([
    ['interface-overview', 'png', 'light', 'interface-overview.png'],
    ['interface-overview', 'png', 'dark', 'interface-overview-dark.png'],
    ['examples/demo', 'png', 'light', 'examples/demo.png'],
    ['zoom', 'gif', 'light', 'zoom.gif'],
  ] as const)('names %s (%s, %s) %s', (name, kind, theme, file) => {
    expect(outputFile(name, kind, theme)).toBe(file);
  });
});

describe('captureVariants', () => {
  const entries = [
    entry({ name: 'paired', themes: ['dark', 'light'] }),
    entry({ name: 'zoom', kind: 'gif' }),
    entry({ name: 'plain' }),
  ];

  it('expands every entry in manifest order, light before dark, light by default', () => {
    expect(captureVariants(entries).map((variant) => [variant.file, variant.theme])).toEqual([
      ['paired.png', 'light'],
      ['paired-dark.png', 'dark'],
      ['zoom.gif', 'light'],
      ['plain.png', 'light'],
    ]);
  });

  it('keeps only the asked kind', () => {
    expect(captureVariants(entries, 'png').map((variant) => variant.file)).toEqual([
      'paired.png',
      'paired-dark.png',
      'plain.png',
    ]);
    expect(captureVariants(entries, 'gif').map((variant) => variant.file)).toEqual(['zoom.gif']);
  });

  it('hands each variant its entry', () => {
    expect(captureVariants(entries, 'gif')[0].entry).toBe(entries[1]);
  });
});

describe('validateManifest', () => {
  it('accepts a screenshot, a light and dark screenshot, a thumbnail and a GIF', () => {
    expect(
      validateManifest([
        entry({ name: 'interface-overview' }),
        entry({ name: 'legend-panel', themes: ['light', 'dark'], scale: 1 }),
        entry({ name: 'examples/demo', docs: ['explore/example-datasets.md'] }),
        entry({ name: 'zoom', kind: 'gif', budgetBytes: 2_000_000, gif: { fps: 20 } }),
        entry({ name: 'more-sheet', viewport: 'phone', themes: ['light', 'dark'] }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['a name used twice', [entry({ name: 'twice' }), entry({ name: 'twice' })]],
    ['an uppercase name', [entry({ name: 'Interface-Overview' })]],
    ['a name with spaces', [entry({ name: 'interface overview' })]],
    ['a name in another folder', [entry({ name: 'gifs/zoom' })]],
    ['a name with an extension', [entry({ name: 'zoom.gif' })]],
    ['a name ending in -dark', [entry({ name: 'overview-dark' })]],
    ['a dark GIF', [entry({ name: 'zoom', kind: 'gif', themes: ['light', 'dark'] })]],
    ['a budget on a screenshot', [entry({ name: 'shot', budgetBytes: 1_000 })]],
    ['GIF settings on a screenshot', [entry({ name: 'shot', gif: { fps: 15 } })]],
    ['a scale on a GIF', [entry({ name: 'zoom', kind: 'gif', scale: 1 })]],
    ['a scale on a phone screenshot', [entry({ name: 'shot', viewport: 'phone', scale: 2 })]],
    ['no docs page', [entry({ name: 'shot', docs: [] })]],
    ['a docs page that is not markdown', [entry({ name: 'shot', docs: ['explore/index'] })]],
  ])('reports %s once', (_, entries) => {
    expect(validateManifest(entries)).toHaveLength(1);
  });
});

describe('the GIF budget', () => {
  it('defaults to 3 MiB', () => {
    expect(DEFAULT_GIF_BUDGET).toBe(3_145_728);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL, the file does not load: `Failed to resolve import "../../../../scripts/docs-screenshots/capture-plan"` (no such module yet).

- [ ] **Step 3: Create `capture-plan.ts`**

Create `scripts/docs-screenshots/capture-plan.ts`:

```ts
/**
 * The docs media manifest's vocabulary: what one capture entry says, how its output files are
 * named, which files it expands to, and the checks every entry must pass. Pure (types from
 * Playwright and the app, no Node or Playwright values), so the app's Vitest can test it
 * (`apps/web/src/explore/docs-images.test.ts`) and the hook's lint can read it without a browser.
 */
import type { Locator, Page } from '@playwright/test';
import type { LayoutState } from '../../apps/web/src/explore/layout-defaults';

export type Theme = 'light' | 'dark';
export type CaptureKind = 'png' | 'gif';
export type ViewportName = 'desktop' | 'tablet' | 'phone';

/** A rectangle of the page, in CSS pixels from the viewport's top left. */
export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a scene's `setup` and `steps` act through. In a screenshot, `hold` and `label` resolve at
 * once and the pointer and keys act without overlays; in a GIF, `hold` paces the recording and
 * every action shows its overlay.
 */
export interface CaptureApi {
  readonly kind: CaptureKind;
  readonly theme: Theme;
  hold(ms: number): Promise<void>;
  click(target: Locator | { x: number; y: number }, options?: { label?: string }): Promise<void>;
  press(key: string, options?: { label?: string }): Promise<void>;
  moveTo(target: Locator | { x: number; y: number }, options?: { steps?: number }): Promise<void>;
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: { steps?: number },
  ): Promise<void>;
  label(text: string): Promise<void>;
}

/** One docs image: what to open, what to do, what to shoot, and the pages that show it. */
export interface CaptureEntry {
  /** File stem under docs/explore/images/, lowercase kebab-case, optionally under `examples/`. */
  name: string;
  kind: CaptureKind;
  viewport: ViewportName | { width: number; height: number };
  /** Default `['light']`; `'dark'` adds `<name>-dark.png` (screenshots only). */
  themes?: readonly Theme[];
  /** Device scale of a desktop screenshot; default 2. */
  scale?: 1 | 2;
  /** An example's catalog id, opened by its `?dataset=` link; default the startup demo. */
  dataset?: string;
  /** Stored before the page loads, over the default layout. */
  layout?: Partial<LayoutState>;
  /** Brings the page to the scene's start; a GIF is trimmed to start where it ends. */
  setup?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** The scene: the state to shoot, or the actions to record. */
  steps?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** What to shoot; default the viewport. */
  target?: (page: Page) => Locator | Promise<Locator | Clip>;
  /** Leave the pointer where the steps put it (a hover state), instead of parking it. */
  keepPointer?: boolean;
  /** The test's timeout; default 90 s. */
  timeoutMs?: number;
  /** A GIF's size limit; default `DEFAULT_GIF_BUDGET`. */
  budgetBytes?: number;
  /** Where a GIF's fps and width ladder starts. */
  gif?: { fps?: number; width?: number };
  /** The docs pages that show the image, relative to docs/, e.g. 'explore/index.md'. */
  docs: readonly string[];
}

export const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
export const TABLET_VIEWPORT = { width: 800, height: 1280 };
/** 3 MiB. */
export const DEFAULT_GIF_BUDGET = 3 * 1024 * 1024;

/** An entry's output file for one theme: `x.png`, `x-dark.png`, `examples/demo.png`, `zoom.gif`. */
export function outputFile(name: string, kind: CaptureKind, theme: Theme): string {
  return `${name}${theme === 'dark' ? '-dark' : ''}.${kind}`;
}

/** One output file of an entry. */
export interface CaptureVariant {
  entry: CaptureEntry;
  theme: Theme;
  file: string;
}

const THEME_ORDER: readonly Theme[] = ['light', 'dark'];

/** Every output file, in manifest order, light before dark; only those of `kind` when given. */
export function captureVariants(
  entries: readonly CaptureEntry[],
  kind?: CaptureKind,
): CaptureVariant[] {
  return entries
    .filter((entry) => kind === undefined || entry.kind === kind)
    .flatMap((entry) => {
      const themes = entry.themes ?? ['light'];
      return THEME_ORDER.filter((theme) => themes.includes(theme)).map((theme) => ({
        entry,
        theme,
        file: outputFile(entry.name, entry.kind, theme),
      }));
    });
}

const NAME = /^(examples\/)?[a-z0-9]+(-[a-z0-9]+)*$/;

/** One message per problem in the manifest; empty when every entry is valid. */
export function validateManifest(entries: readonly CaptureEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const at = `"${entry.name}"`;
    if (seen.has(entry.name)) problems.push(`${at}: the name is used twice`);
    seen.add(entry.name);
    if (/\.[a-z0-9]+$/i.test(entry.name)) {
      problems.push(`${at}: the name has an extension; the runner adds .png or .gif`);
    } else if (!NAME.test(entry.name)) {
      problems.push(`${at}: the name is not lowercase kebab-case (optionally under examples/)`);
    } else if (entry.name.endsWith('-dark')) {
      problems.push(`${at}: a name ending in -dark is the dark variant's; use themes instead`);
    }
    if (entry.kind === 'gif' && entry.themes?.includes('dark')) {
      problems.push(`${at}: a GIF is light only; show the dark theme in a screenshot`);
    }
    if (entry.kind === 'png' && (entry.budgetBytes !== undefined || entry.gif !== undefined)) {
      problems.push(`${at}: budgetBytes and gif apply to GIFs only`);
    }
    if (entry.scale !== undefined && (entry.kind !== 'png' || entry.viewport !== 'desktop')) {
      problems.push(`${at}: scale applies to desktop screenshots only`);
    }
    if (entry.docs.length === 0) {
      problems.push(`${at}: docs names no page that shows the image`);
    }
    for (const page of entry.docs) {
      if (!page.endsWith('.md')) problems.push(`${at}: docs page "${page}" is not a .md file`);
    }
  }
  return problems;
}
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, 22 tests (4 `outputFile`, 3 `captureVariants`, 1 + 13 `validateManifest`, 1 budget).

- [ ] **Step 4: Create the thumbnails scene, the manifest and the runner**

Create `scripts/docs-screenshots/scenes/examples.ts`:

```ts
import { expect } from '@playwright/test';
import { EXAMPLE_DATASETS } from '../../../apps/web/src/explore/example-datasets';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import type { CaptureEntry } from '../capture-plan';

/**
 * The Example datasets page's thumbnails, one per catalog example in menu order: the workbench
 * body on the example's curated view, light, at 1× (they show at thumbnail size, and 2× would
 * quadruple five files for nothing). They came from the `examples-live` e2e project before.
 */
export const EXAMPLE_CAPTURES: CaptureEntry[] = EXAMPLE_DATASETS.map((example) => ({
  name: `examples/${example.id}`,
  kind: 'png',
  viewport: 'desktop',
  scale: 1,
  themes: ['light'],
  dataset: example.id,
  ...(example.large && { timeoutMs: 240_000 }),
  steps: async (page) => {
    await expect.poll(async () => (await legendRowValues(page)).length).toBeGreaterThan(0);
  },
  target: (page) => page.locator('[data-workbench="body"]'),
  docs: ['explore/example-datasets.md'],
}));
```

Create `scripts/docs-screenshots/manifest.ts`:

```ts
import type { CaptureEntry } from './capture-plan';
import { EXAMPLE_CAPTURES } from './scenes/examples';

/** Every docs image, one entry each; the scenes are grouped by the docs page that shows them. */
export const MANIFEST: readonly CaptureEntry[] = [...EXAMPLE_CAPTURES];
```

Create `scripts/docs-screenshots/runner.ts`:

```ts
/**
 * Turns the manifest into Playwright tests: one `test.describe` per output file, with its own
 * viewport, device, colour scheme, motion setting and stored layout, holding one test titled with
 * the file name (so `-g "<file>"` captures one image). Each test opens Explore, waits for the data
 * and for the plot to stop drawing, runs the entry's setup and steps through a `CaptureApi`, parks
 * the pointer, and shoots.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEFAULT_LAYOUT } from '../../apps/web/src/explore/layout-defaults';
import {
  exampleFetched,
  expectProductDemo,
  openExample,
} from '../../apps/web/tests/helpers/examples';
import { waitForExploreDataLoad } from '../../apps/web/tests/helpers/explore';
import { plotSettled } from '../../apps/web/tests/helpers/plot';
import { exploreStorageState } from '../../apps/web/tests/helpers/tour-storage-state';
import {
  captureVariants,
  DESKTOP_VIEWPORT,
  TABLET_VIEWPORT,
  validateManifest,
  type CaptureApi,
  type CaptureEntry,
  type CaptureKind,
  type CaptureVariant,
  type Clip,
  type Theme,
  type ViewportName,
} from './capture-plan';
import { MANIFEST } from './manifest';
import { IMAGES_DIR } from './paths';

const DEFAULT_TIMEOUT_MS = 90_000;
/** How long the plot may keep drawing after a load before the capture fails. */
const SETTLE_CAP_MS = 10_000;

type Point = { x: number; y: number };
type Device = Pick<
  BrowserContextOptions,
  'viewport' | 'userAgent' | 'deviceScaleFactor' | 'isMobile' | 'hasTouch'
>;

/**
 * A device descriptor without `defaultBrowserType`, which a describe group cannot set (it would
 * need a worker of its own); every capture runs in the project's Chromium.
 */
function descriptor(name: 'Desktop Chrome' | 'Pixel 7'): Device {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name];
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

/** Desktop Chrome at 1280×720; a Pixel 7 (412×839, touch); the same phone at 800×1280. */
const DEVICES: Record<ViewportName, Device> = {
  desktop: { ...descriptor('Desktop Chrome'), viewport: DESKTOP_VIEWPORT },
  phone: descriptor('Pixel 7'),
  tablet: { ...descriptor('Pixel 7'), viewport: TABLET_VIEWPORT },
};

/** The context a variant is captured in, except its stored state, which needs the base URL. */
function contextOptions({ entry, theme }: CaptureVariant): BrowserContextOptions {
  const { viewport } = entry;
  const base = typeof viewport === 'object' ? { ...DEVICES.desktop, viewport } : DEVICES[viewport];
  const desktopLike = typeof viewport === 'object' || viewport === 'desktop';
  return {
    ...base,
    // Phones and tablets at 2, not Pixel 7's 2.625: touch comes from isMobile/hasTouch, and the
    // docs show these 240-320 px wide.
    deviceScaleFactor: entry.kind === 'gif' ? 1 : desktopLike ? (entry.scale ?? 2) : 2,
    colorScheme: theme,
    reducedMotion: entry.kind === 'png' ? 'reduce' : 'no-preference',
  };
}

/**
 * The tour marked seen, the theme left on System (so `colorScheme` picks it), and the entry's
 * layout over the default one.
 */
function storedState(entry: CaptureEntry, baseURL: string | undefined) {
  if (!baseURL) throw new Error('The capture config sets no baseURL');
  return exploreStorageState(baseURL, {
    layout: { ...DEFAULT_LAYOUT, ...entry.layout },
    theme: 'system',
  });
}

/**
 * Opens the entry's dataset (the startup demo, or an example by its `?dataset=` link) with the
 * perf counters on, refuses an e2e fixture, and waits until the plot has stopped drawing.
 */
async function openEntry(page: Page, entry: CaptureEntry): Promise<void> {
  if (entry.dataset) {
    if (!exampleFetched(entry.dataset)) {
      throw new Error(`The "${entry.dataset}" example is not on disk: run \`pnpm examples:fetch\``);
    }
    await openExample(page, entry.dataset, { search: '&perfCounters=1' });
  } else {
    await page.goto('/explore?perfCounters=1');
    await waitForExploreDataLoad(page);
  }
  await expectProductDemo(page);
  await plotSettled(page, SETTLE_CAP_MS);
}

const isLocator = (target: Locator | Point): target is Locator =>
  typeof (target as Locator).boundingBox === 'function';

/** The pointer and keys of a screenshot scene: actions without overlays, no pacing. */
function screenshotApi(page: Page, theme: Theme): CaptureApi {
  return {
    kind: 'png',
    theme,
    hold: async () => {},
    click: async (target) => {
      if (isLocator(target)) await target.click();
      else await page.mouse.click(target.x, target.y);
    },
    press: async (key) => {
      await page.keyboard.press(key);
    },
    moveTo: async (target, options) => {
      if (isLocator(target)) {
        await target.hover();
        return;
      }
      await page.mouse.move(target.x, target.y, { steps: options?.steps });
    },
    drag: async (from, to, options) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: options?.steps ?? 20 });
      await page.mouse.up();
    },
    label: async () => {},
  };
}

/**
 * Moves the pointer off every control and checks that no kit tooltip is left open, so neither a
 * hover state nor a tooltip ends up in the picture.
 */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator('ps-tooltip .tip').filter({ visible: true })).toHaveCount(0);
}

const isClip = (target: Locator | Clip): target is Clip =>
  typeof (target as Clip).width === 'number';

async function shoot(page: Page, entry: CaptureEntry, file: string): Promise<void> {
  const out = path.join(IMAGES_DIR, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const options = { path: out, animations: 'disabled', caret: 'hide' } as const;
  const target = entry.target ? await entry.target(page) : null;
  if (!target) await page.screenshot(options);
  else if (isClip(target)) await page.screenshot({ ...options, clip: target });
  else await target.screenshot(options);
}

/** Registers one test per output file of `kind`; throws when the manifest is invalid. */
export function registerCaptures(kind: CaptureKind): void {
  const problems = validateManifest(MANIFEST);
  if (problems.length > 0) {
    throw new Error(`The docs capture manifest is invalid:\n${problems.join('\n')}`);
  }
  for (const variant of captureVariants(MANIFEST, kind)) {
    const { entry, theme, file } = variant;
    test.describe(file, () => {
      test.use({
        ...contextOptions(variant),
        storageState: async ({ baseURL }, use) => {
          await use(storedState(entry, baseURL));
        },
      });

      test(file, async ({ page }) => {
        test.setTimeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const cap = screenshotApi(page, theme);
        await openEntry(page, entry);
        await entry.setup?.(page, cap);
        await entry.steps?.(page, cap);
        if (!entry.keepPointer) await parkPointer(page);
        await shoot(page, entry, file);
      });
    });
  }
}
```

Create `scripts/docs-screenshots/capture-png.spec.ts`:

```ts
import { registerCaptures } from './runner';

registerCaptures('png');
```

- [ ] **Step 5: Start the capture server from the root config**

Replace the root `playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The docs media captures in scripts/docs-screenshots/ (`pnpm docs:screenshots`, and
 * `pnpm docs:animations` until the GIF runner replaces it): the runner turns each manifest entry
 * into one test per output file, and docs/explore/images/README.md describes the pipeline.
 *
 * It starts its own dev server on DOCS_CAPTURE_PORT (default 8096), with this checkout's packages
 * built first and without VITE_STARTUP_DATASET_URL, so the captures show the product demo, never
 * the fixture an e2e server pins. It never reuses a running server. PLAYWRIGHT_BASE_URL points the
 * captures at one instead, and starts nothing.
 */
const PORT = process.env.DOCS_CAPTURE_PORT ?? '8096';
if (!/^\d+$/.test(PORT)) {
  throw new Error(`DOCS_CAPTURE_PORT must be a port number, got "${PORT}"`);
}
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './scripts/docs-screenshots',

  // One capture at a time, in manifest order, never retried: a failure is a broken scene.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',

  // Each capture sets its own; this covers the old animation captures.
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The runner shoots each image itself.
    screenshot: 'off',
    // Headed on macOS for the system GPU's WebGL; CI runs headless on SwiftShader.
    headless: !!process.env.CI,
    // Video recording for the old animation captures.
    video: {
      mode: 'on',
      size: { width: 1536, height: 864 },
    },
  },

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm turbo run build --filter=@protspace/app^... && pnpm --filter @protspace/app exec vite --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // Set empty, so a value in the caller's shell cannot pin the startup demo to a fixture.
        env: { VITE_STARTUP_DATASET_URL: '' },
        gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
      },

  projects: [
    {
      // Screenshots: one test per PNG in the manifest (runner.ts sets each one's device).
      name: 'docs-png',
      use: { ...devices['Desktop Chrome'], video: 'off' },
      testMatch: /capture-png\.spec\.ts$/,
    },
    {
      name: 'animations',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1536, height: 864 },
        video: {
          mode: 'on',
          size: { width: 1536, height: 864 },
        },
      },
      // Any `capture-*animations.spec.ts` registers itself; no per-file listing.
      testMatch: /animations\.spec\.ts$/,
    },
  ],

  outputDir: './test-results/',
});
```

(The `animations` project and the top-level `video` stay as they were until Task 7.4; `headless` moves from the two projects to `use`. `trace: 'on-first-retry'` never fires with `retries: 0`; it is kept as before.)

In the root `package.json`, replace

```json
    "docs:screenshots": "playwright test --project=screenshots",
```

with

```json
    "docs:screenshots": "playwright test --project=docs-png",
```

- [ ] **Step 6: Delete the old static captures and what only they used**

Run: `git rm scripts/docs-screenshots/capture-static.spec.ts scripts/docs-screenshots/capture-eat-static.spec.ts`

In `scripts/docs-screenshots/helpers.ts`:

- replace `import { test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';` with `import type { Page, TestInfo } from '@playwright/test';`, and `import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';` with `import { TEMP_VIDEOS_DIR } from './paths';`;
- delete the `SCREENSHOT_VIEWPORT` constant with its JSDoc ("Viewport every capture runs at…");
- replace `export async function awaitTwoFrames(page: Page): Promise<void> {` with `async function awaitTwoFrames(page: Page): Promise<void> {` (`waitForLegend` still calls it);
- delete `waitForStructureViewer` and `clickProteinPoint` with their JSDoc (from "Wait for the structure viewer to load a protein." to just above "Toggle a legend item visibility.");
- delete `createSharedCapturePage` with its JSDoc (from "Share one pre-loaded page across every test in a static-capture spec." to just above `/** Pick an annotation from the control bar's dropdown by its data key. */`).

Run: `pnpm type-check:scripts`
Expected: no errors. (An error naming `test`, `BrowserContext` or `IMAGES_DIR` as unused means an import line was missed.)

- [ ] **Step 7: The thumbnails leave `examples-live`**

In `apps/web/tests/examples-live.spec.ts` (as Task 7.2 left it):

- delete `import { mkdirSync } from 'node:fs';` and replace `import { expect, test, type Page } from '@playwright/test';` with `import { expect, test } from '@playwright/test';`;
- in the file's opening comment replace

```ts
 * the URL or logging a drift warning. Each view is then captured as the Example
 * datasets page's thumbnail, `docs/explore/images/examples/<id>.png`
 * (`EXAMPLES_THUMBNAIL_DIR` redirects them, e.g. to review a candidate view
 * without touching the docs).
 */
```

with

```ts
 * the URL or logging a drift warning. The Example datasets page's thumbnails of
 * these views come from the docs capture runner (`pnpm docs:screenshots -g
 * "examples/"`, scripts/docs-screenshots/scenes/examples.ts), not from here.
 */
```

- delete the `THUMBNAIL_DIR` constant (both lines, `const THUMBNAIL_DIR =` and its `process.env.EXAMPLES_THUMBNAIL_DIR ?? …` line), the whole `waitForLegendItems` function, and the `test.beforeAll(() => { mkdirSync(THUMBNAIL_DIR, … });` block with the blank line after it;
- at the end of the test body, replace

```ts
      expect(fallbacks).toEqual([]);

      await waitForLegendItems(page, loadTimeout);
      await page
        .locator('[data-workbench="body"]')
        .screenshot({ path: path.join(THUMBNAIL_DIR, `${entry.id}.png`) });
```

with

```ts
      expect(fallbacks).toEqual([]);
```

(`REPO_ROOT`, `fileURLToPath` and `path` stay: the missing-file message uses them.)

In `apps/web/tests/playwright.config.ts`, replace

```ts
          // Stop the server with the run. A pinned server left on :8080 would be
          // picked up by `pnpm docs:images` (the root config starts none), whose
          // captures would then photograph the fixture instead of the product demo.
```

with

```ts
          // Stop the server with the run, so a pinned server is never left on :8080.
          // (`pnpm docs:images` starts its own on :8096 and refuses a pinned one.)
```

and replace

```ts
    // The product's examples, opened from the files the product serves (not fixtures):
    // each must land on its curated view, and the run writes the Example datasets page's
    // thumbnails. Run `pnpm examples:fetch` first, then opt in via RUN_EXAMPLES_E2E=1.
```

with

```ts
    // The product's examples, opened from the files the product serves (not fixtures):
    // each must land on its curated view (the page's thumbnails come from the docs
    // captures). Run `pnpm examples:fetch` first, then opt in via RUN_EXAMPLES_E2E=1.
```

- [ ] **Step 8: Point the docs at the runner**

`docs/scripts/generate-examples.mts`, in the missing-thumbnail check, replace

```ts
        `"${id}": docs/explore/images/examples/${id}.png is missing; capture it with the examples-live Playwright project.`,
```

with

```ts
        `"${id}": docs/explore/images/examples/${id}.png is missing; capture it with \`pnpm docs:screenshots -g "examples/${id}.png"\`.`,
```

`CONTRIBUTING.md`: replace

```
pnpm docs:images   # Generate all documentation images (screenshots, animations, GIFs)
```

with

```
pnpm docs:images   # Generate all documentation images (starts its own app server on :8096)
```

and replace

```
  with `pnpm docs:examples`. Its thumbnails come from the opt-in `examples-live` E2E project
  (see `docs/explore/images/README.md`).
```

with

```
  with `pnpm docs:examples`. Its thumbnails come from the docs captures
  (`pnpm docs:screenshots -g "examples/"`; see `docs/explore/images/README.md`).
```

`docs/explore/images/README.md`: replace the bullet

```
- Static screenshots: `capture-static.spec.ts`, named by the test title
```

with

```
- Screenshots: the entries in `manifest.ts` (grouped in `scenes/`), captured by `runner.ts` and
  named by the entry (`-dark` for the dark variant)
```

replace the whole "## Capturing against another port" section (heading, paragraph and code block) with

````
## The capture server

The captures start their own dev server on `:8096` (`DOCS_CAPTURE_PORT` moves it), with this
checkout's packages built and without the E2E startup fixture, and stop it afterwards. To capture
from a server that is already running, point them at it; a server started for the E2E suite, which
pins the startup demo to a test fixture, is refused:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8095 pnpm docs:screenshots
```
````

and replace the whole "## The example thumbnails" section with

````
## The example thumbnails

`examples/<id>.png` are the [Example Datasets](../example-datasets.md) page's thumbnails, one per
catalog example (`scenes/examples.ts`). Each opens the example by its `?dataset=` link from the file
the product serves and shoots the workbench body on its curated view, light, in a 1280×720 window. The
release-hosted bundles must be fetched first:

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "examples/"
```

`pnpm docs:examples:check` fails when a card's thumbnail is missing. The opt-in `examples-live` E2E
project still checks that every example lands on its curated view; it writes no images.
````

(The README's GIF and EAT sections stay as they are until Task 7.16 rewrites the file.)

- [ ] **Step 9: List and capture the thumbnails**

Run: `pnpm exec playwright test --project=docs-png --list`
Expected: exactly five tests, `examples/demo.png`, `examples/three-finger-toxins.png`, `examples/human-fly.png`, `examples/beta-lactamase.png`, `examples/swissprot.png` (catalog order; each title shows as `examples/<id>.png › examples/<id>.png`), `Total: 5 tests in 1 file`.

Run (sandbox disabled, network): `pnpm examples:fetch`
Expected: the release-hosted bundles land under `apps/web/public/examples/`. If `swissprot` (large) cannot be fetched, go on with the others and say so.

Run (sandbox disabled; starts the server on :8096, opens a headed Chromium): `pnpm docs:screenshots -g "examples/"`
Expected: 5 passed (4 if `swissprot` is missing: its test fails saying the example is not on disk and to run `pnpm examples:fetch`; keep its old file for the exit run). The five files under `docs/explore/images/examples/` are rewritten, all five the same size (`file docs/explore/images/examples/*.png`: the workbench body of a 1280×720 window at scale 1, so 1280 wide; the old ones are 1260 × 544), light, the workbench body on each example's curated view with the legend filled and no tour or tooltip. Open them and compare with the `a8cb13ca` versions (`git show a8cb13ca:docs/explore/images/examples/demo.png > "$TMPDIR/demo-before.png"`); report each file's size before and after.

- [ ] **Step 10: Run the task's checks**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, 22 tests.

Run: `pnpm docs:examples:check && pnpm type-check:scripts && pnpm --filter @protspace/app type-check`
Expected: all pass (the thumbnails exist; `examples-live.spec.ts` type-checks without the screenshot code).

Run: `pnpm knip`
Expected: no issues. (`capture-plan.ts`'s exports are used by `runner.ts`, `manifest.ts`, the scene and the app test; `DEFAULT_GIF_BUDGET` by the app test until Task 7.4's runner uses it.)

Run: `pnpm exec prettier --check playwright.config.ts package.json scripts/docs-screenshots/capture-plan.ts scripts/docs-screenshots/runner.ts scripts/docs-screenshots/capture-png.spec.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/scenes/examples.ts scripts/docs-screenshots/helpers.ts apps/web/src/explore/docs-images.test.ts apps/web/tests/examples-live.spec.ts apps/web/tests/playwright.config.ts docs/scripts/generate-examples.mts CONTRIBUTING.md docs/explore/images/README.md`
Expected: all files pass.

Unrun at task time: `examples-live.spec.ts` (opt-in; the exit runs it).

- [ ] **Step 11: Commit**

```bash
git add playwright.config.ts package.json scripts/docs-screenshots/capture-plan.ts scripts/docs-screenshots/runner.ts scripts/docs-screenshots/capture-png.spec.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/scenes/examples.ts scripts/docs-screenshots/helpers.ts apps/web/src/explore/docs-images.test.ts apps/web/tests/examples-live.spec.ts apps/web/tests/playwright.config.ts docs/scripts/generate-examples.mts CONTRIBUTING.md docs/explore/images/README.md docs/explore/images/examples
git commit -m "feat(docs): capture runner with the example thumbnails"
```

(Sandbox disabled: the hook runs `pnpm precommit`. The two deleted specs were staged by `git rm` in Step 6.)

### Task 7.4: GIF recording with a size budget

The GIF half of the runner: video per entry at 1×, a sidecar with the measured trim, theme-aware overlays, and a converter that walks the fps/width ladder and fails over budget. Proven on `zoom.gif`; the old animation captures and their helpers are deleted.

**Files:**

- Create: `scripts/docs-screenshots/capture-gif.spec.ts`, `gif.ts`, `indicators.ts`, `scenes/scatterplot.ts`
- Modify: `scripts/docs-screenshots/capture-plan.ts` (ladder, sidecar), `runner.ts` (GIF branch, overlays behind `CaptureApi`), `manifest.ts` (`...SCATTERPLOT_CAPTURES`)
- Modify: `playwright.config.ts` (`docs-gif` replaces `animations`; the top-level `video` goes), `package.json` (`docs:animations` → `playwright test --project=docs-gif`; `docs:gifs` → `tsx scripts/docs-screenshots/gif.ts`)
- Modify: `apps/web/src/explore/docs-images.test.ts`
- Delete: `scripts/docs-screenshots/capture-animations.spec.ts`, `capture-eat-animations.spec.ts`, `helpers.ts`, `eat-helpers.ts`, `convert-to-gif.ts`
- Regenerate: `docs/explore/images/zoom.gif`

**Interfaces:**

- Consumes: everything 7.3 produces; `TEMP_VIDEOS_DIR`, `IMAGES_DIR` (`paths.ts`); the old indicators (`git show a8cb13ca:scripts/docs-screenshots/helpers.ts`, 578–919) and the old zoom scene (`capture-animations.spec.ts` 127–198); `proteinScreenPosition`, `plotSettled` (7.2).
- Produces:
  - `capture-plan.ts`: `interface GifSettings { fps: number; width: number }`; `const GIF_START: GifSettings = { fps: 30, width: 1000 }`; `gifLadder(start?: Partial<GifSettings>): GifSettings[]` — the start, then each lower fps of 20 and 15, then each narrower width of 800 and 640 at the last fps (`gifLadder()` = 30/1000, 20/1000, 15/1000, 15/800, 15/640; `gifLadder({ fps: 20, width: 800 })` = 20/800, 15/800, 15/640); `interface GifSidecar { name: string; trimStartMs: number; budgetBytes: number; start: GifSettings }`.
  - `runner.ts` for GIFs: each GIF test takes the `browser` fixture and opens its own context with `contextOptions(variant)` (device scale 1, `reducedMotion: 'no-preference'`), `baseURL`, `storageState: storedState(entry, baseURL)` and `recordVideo: { dir: testInfo.outputPath('video'), size: <viewport> }` (`video` is worker-scoped in Playwright 1.61 and cannot be set per describe); `trimStartMs` = time from page creation (when its video starts) to the end of `setup`; on pass the video is saved as `TEMP_VIDEOS_DIR/<name>.webm` with `<name>.json` (`GifSidecar`); on failure nothing is saved and an older recording of that name is removed. The `docs-gif` project sets no `video`. `CaptureApi` in a GIF: `hold(ms)` waits (the only timer in capture code), `click`/`press`/`moveTo`/`drag` show the overlays, `label(text)` shows a caption.
  - `indicators.ts`: `installIndicators(page: Page): Promise<void>`; `showCursor(page: Page, at: { x: number; y: number }): Promise<void>`; `showClick(page: Page, at: { x: number; y: number }): Promise<void>`; `showKey(page: Page, label: string): Promise<void>`; `showLabel(page: Page, text: string): Promise<void>` — page-side elements styled with `--ps-*` tokens, so they follow the page's theme; used only by `runner.ts`.
  - `gif.ts` (CLI): `tsx scripts/docs-screenshots/gif.ts [--keep] [name…]` — converts every (or each named) `.webm` with its sidecar; per rung prints fps, width and size; writes `IMAGES_DIR/<name>.gif` at the first rung within budget; exits 1 listing each GIF still over budget at the last rung (its `.webm` kept, the previous GIF untouched); deletes the `.webm` and `.json` after a success unless `--keep`. Requires `ffmpeg` on `PATH` (clear error if missing).
  - `capture-gif.spec.ts`: `registerCaptures('gif')`.
  - `scenes/scatterplot.ts`: `export const SCATTERPLOT_CAPTURES: CaptureEntry[]` with `zoom` (`kind: 'gif'`, desktop, steps port the old zoom and pan with `cap.moveTo`, wheel steps and `cap.hold`, `docs: ['explore/scatterplot.md']`).

**Tests:**

- `docs-images.test.ts`: "no capture module waits on a timer or reaches into a shadow root" — a raw glob of `../../../../scripts/docs-screenshots/**/*.ts`: no file contains `shadowRoot`; no file under `scenes/` contains `waitForTimeout` or `.evaluate(`; `waitForTimeout` appears in `runner.ts` only (inside `hold`) — lands here, once the old captures are deleted; `gifLadder()` and `gifLadder({ fps: 20, width: 800 })` give the lists above; `gifLadder({ width: 640 })` steps fps only; `DEFAULT_GIF_BUDGET` is 3,145,728; `validateManifest` accepts the GIF entry shape and still rejects `themes: ['dark']` on a GIF.
- Verification: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`; `pnpm docs:animations -g "zoom.gif" && pnpm docs:gifs zoom` (sandbox disabled): the new `zoom.gif` is at most 3 MiB, its first frame shows the loaded plot (no loading screen), the cursor overlay is visible; `pnpm type-check:scripts`; `pnpm knip`.
- Unrun at task time: none (no e2e spec touched).

**Commit:** `feat(docs): GIF captures with a per-GIF size budget`

**Why each GIF opens its own context:** Playwright makes `video` a worker-scoped option, and `test.use({ video })` inside a `test.describe` is a load error ("Cannot use({ video }) in a describe group, because it forces a new worker"). A GIF test therefore opens a context with the same options as a screenshot's (`contextOptions` and `storedState` from Task 7.3) plus `recordVideo`. That also makes the trim exact: the video starts with the page, so `trimStartMs` runs from the page's creation to the end of `setup`.

Notes for the implementer (the code below was type-checked under `scripts/tsconfig.json` and `tsconfig.app.json` in a scratch copy with Tasks 7.1–7.3 applied, Prettier leaves it as written, and `playwright test --list` with this config lists the five thumbnails under `docs-png` and `zoom.gif` under `docs-gif`):

- Task 7.3 already pins `DEFAULT_GIF_BUDGET` (3,145,728) and the GIF cases of `validateManifest` (a GIF entry with `budgetBytes` and `gif` accepted, a dark GIF rejected); this task adds the ladder and the source checks.
- The overlays' root is a `popover="manual"` element that is hidden and shown again on every click, key and label (not on pointer moves), so it is the newest entry in the top layer and draws above an open menu or dialog; with `pointer-events: none` it takes no input and no kit layer sees it. The pointer dot also follows every `pointermove` by itself (a capture-phase window listener), so a glide `page.mouse.move(…, { steps })` shows as one smooth movement.
- The scene's wheel steps call `page.mouse.wheel` directly: `CaptureApi` has no wheel action, and the zoom is shown by the caption "Scroll to zoom" and the moving plot. The old capture's "panning" was only in its title; this one pans with `cap.drag`, which the default Move and zoom tool turns into a pan (`selectionMode` is false at load).
- The zoom centres on the demo's "three-finger toxin" proteins when the colouring annotation has that value (as the old capture did), else on the plot's upper right.
- Only `runner.ts` may contain the word `waitForTimeout`, exactly once (in `hold`), and no capture file the word `shadowRoot`, comments included; the new test reads the files as text.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/explore/docs-images.test.ts` (as Task 7.3 left it), add `gifLadder,` to the `capture-plan` import list after `DEFAULT_GIF_BUDGET,`:

```ts
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  gifLadder,
  outputFile,
  validateManifest,
  type CaptureEntry,
} from '../../../../scripts/docs-screenshots/capture-plan';
```

and append at the end of the file:

```ts

describe('gifLadder', () => {
  const rungs = (ladder: ReturnType<typeof gifLadder>) =>
    ladder.map(({ fps, width }) => `${fps}/${width}`);

  it('steps the frame rate down, then the width', () => {
    expect(rungs(gifLadder())).toEqual(['30/1000', '20/1000', '15/1000', '15/800', '15/640']);
  });

  it("starts at an entry's own settings", () => {
    expect(rungs(gifLadder({ fps: 20, width: 800 }))).toEqual(['20/800', '15/800', '15/640']);
  });

  it('steps only the frame rate from the narrowest width', () => {
    expect(rungs(gifLadder({ width: 640 }))).toEqual(['30/640', '20/640', '15/640']);
  });
});

/**
 * The capture code as text: decision 19 replaced the old captures' hand-written shadow-root
 * lookups and fixed sleeps with role locators, typed plot reads and signals. Pacing a GIF is the
 * one place a fixed wait belongs, and it is `cap.hold`, so it is countable in review.
 */
const CAPTURE_SOURCES = import.meta.glob('../../../../scripts/docs-screenshots/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SCRIPTS = '../../../../scripts/docs-screenshots/';

describe('the capture code', () => {
  it('is read', () => {
    expect(Object.keys(CAPTURE_SOURCES)).toContain(`${SCRIPTS}runner.ts`);
    expect(Object.keys(CAPTURE_SOURCES)).toContain(`${SCRIPTS}scenes/scatterplot.ts`);
  });

  it('never reaches into a shadow root', () => {
    const offenders = Object.entries(CAPTURE_SOURCES)
      .filter(([, text]) => text.includes('shadowRoot'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('keeps timers and page evaluation out of the scenes', () => {
    const offenders = Object.entries(CAPTURE_SOURCES)
      .filter(([file]) => file.startsWith(`${SCRIPTS}scenes/`))
      .filter(([, text]) => text.includes('waitForTimeout') || text.includes('.evaluate('))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("waits on a timer only in the runner's hold", () => {
    const timed = Object.entries(CAPTURE_SOURCES)
      .filter(([, text]) => text.includes('waitForTimeout'))
      .map(([file]) => file);
    expect(timed).toEqual([`${SCRIPTS}runner.ts`]);
    const runner = CAPTURE_SOURCES[`${SCRIPTS}runner.ts`];
    expect(runner.match(/waitForTimeout/g)).toHaveLength(1);
    expect(runner).toMatch(/hold: async \(ms\) => \{\s*await page\.waitForTimeout\(ms\);/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL, 6 of 29 tests: the three `gifLadder` cases (`gifLadder is not a function`), "is read" (no `scenes/scatterplot.ts` yet), "never reaches into a shadow root" (`helpers.ts`, `capture-animations.spec.ts`), and "waits on a timer only in the runner's hold" (`capture-animations.spec.ts`, `capture-eat-animations.spec.ts`, `helpers.ts`; the runner's PNG-only `hold` has no timer yet). "keeps timers and page evaluation out of the scenes" passes (`scenes/examples.ts` is clean), as do Task 7.3's 22.

- [ ] **Step 3: Add the ladder and the sidecar to `capture-plan.ts`**

Append to `scripts/docs-screenshots/capture-plan.ts`:

```ts

/** A GIF's frame rate and width in pixels. */
export interface GifSettings {
  fps: number;
  width: number;
}

/** Where a GIF's ladder starts unless its entry says otherwise. */
export const GIF_START: GifSettings = { fps: 30, width: 1000 };

const LADDER_FPS = [20, 15];
const LADDER_WIDTHS = [800, 640];

/**
 * The settings a GIF is converted at, in order, until one fits its budget: the start, then each
 * lower frame rate of 20 and 15, then each narrower width of 800 and 640 at the last rate.
 * `gifLadder()` is 30/1000, 20/1000, 15/1000, 15/800, 15/640.
 */
export function gifLadder(start: Partial<GifSettings> = {}): GifSettings[] {
  const first = { ...GIF_START, ...start };
  const ladder = [first];
  for (const fps of LADDER_FPS) {
    if (fps < first.fps) ladder.push({ fps, width: first.width });
  }
  const { fps } = ladder[ladder.length - 1];
  for (const width of LADDER_WIDTHS) {
    if (width < first.width) ladder.push({ fps, width });
  }
  return ladder;
}

/**
 * What the runner writes beside a GIF's recording (`temp-videos/<name>.json`) for `gif.ts`: where
 * the scene starts in the video, the size limit and the ladder's first rung.
 */
export interface GifSidecar {
  name: string;
  trimStartMs: number;
  budgetBytes: number;
  start: GifSettings;
}
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts -t gifLadder`
Expected: PASS, 3 tests.

- [ ] **Step 4: Create the overlays**

Create `scripts/docs-screenshots/indicators.ts` (the old `initVisualIndicators`, `showClickIndicator`, `showKeyboardIndicator` and `showActionLabel`, ported to `--ps-*` tokens and the top layer):

```ts
/**
 * The GIF overlays: a dot that follows the pointer, a ripple where it clicks or starts a drag, a
 * key cap for each key press, and a caption. Page-side elements styled with the app's `--ps-*`
 * tokens only, so they follow the page's theme. Their root is a manual popover, raised on each use,
 * so it shows above open menus and dialogs in the top layer. Only `runner.ts` uses them, for GIFs:
 * screenshots never show them.
 */
import type { Page } from '@playwright/test';

interface Indicators {
  cursor(x: number, y: number): void;
  click(x: number, y: number): void;
  key(text: string): void;
  label(text: string): void;
}
type IndicatorWindow = Window & { __docsCaptureIndicators?: Indicators };

/** Installs the overlays in every document the page loads; call it before the first navigation. */
export async function installIndicators(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const css = `
      #docs-capture-indicators {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        overflow: visible;
        pointer-events: none;
      }
      #docs-capture-indicators * {
        box-sizing: border-box;
        pointer-events: none;
      }
      #docs-capture-indicators .cursor {
        position: fixed;
        left: 0;
        top: 0;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        border: 2px solid var(--ps-accent);
        border-radius: var(--ps-radius-full);
        background: color-mix(in srgb, var(--ps-accent) 30%, transparent);
        box-shadow: var(--ps-shadow-sm);
        display: none;
      }
      #docs-capture-indicators .ripple {
        position: fixed;
        width: 56px;
        height: 56px;
        margin: -28px 0 0 -28px;
        border: 3px solid var(--ps-accent);
        border-radius: var(--ps-radius-full);
        animation: docs-capture-ripple 600ms ease-out forwards;
      }
      @keyframes docs-capture-ripple {
        from { transform: scale(0.2); opacity: 1; }
        to { transform: scale(1); opacity: 0; }
      }
      #docs-capture-indicators .key,
      #docs-capture-indicators .label {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        font-family: var(--ps-font-sans);
        font-weight: var(--ps-weight-semibold);
        white-space: nowrap;
        display: none;
      }
      #docs-capture-indicators .key {
        bottom: 40px;
        padding: var(--ps-space-3) var(--ps-space-6);
        border-radius: var(--ps-radius-lg);
        background: var(--ps-tooltip-bg);
        color: var(--ps-tooltip-text);
        font-size: var(--ps-text-xl);
        box-shadow: var(--ps-shadow-lg);
      }
      #docs-capture-indicators .label {
        bottom: 112px;
        padding: var(--ps-space-2) var(--ps-space-5);
        border-radius: var(--ps-radius);
        background: var(--ps-accent);
        color: var(--ps-text-on-accent);
        font-size: var(--ps-text-lg);
        box-shadow: var(--ps-shadow-md);
      }
    `;
    let root: HTMLElement | null = null;
    const timers = new Map<string, number>();

    // `raise`: re-show the root so it sits above whatever entered the top layer since. A click, a
    // key or a label raises; a pointer move does not, or a 30-step drag would leave and re-enter
    // the top layer 30 times (60 toggle events) while a menu or a drag is live.
    const part = (name: string, raise = true): HTMLElement => {
      if (!root) {
        root = document.createElement('div');
        root.id = 'docs-capture-indicators';
        root.setAttribute('popover', 'manual');
        root.setAttribute('aria-hidden', 'true');
        const style = document.createElement('style');
        style.textContent = css;
        root.append(style);
        for (const kind of ['cursor', 'key', 'label']) {
          const element = document.createElement('div');
          element.className = kind;
          root.append(element);
        }
        document.body.append(root);
      }
      if (raise || !root.matches(':popover-open')) {
        if (root.matches(':popover-open')) root.hidePopover();
        root.showPopover();
      }
      return root.querySelector<HTMLElement>(`.${name}`) ?? root;
    };

    const flash = (name: string, text: string, ms: number) => {
      const element = part(name);
      element.textContent = text;
      element.style.display = 'block';
      window.clearTimeout(timers.get(name));
      timers.set(
        name,
        window.setTimeout(() => {
          element.style.display = 'none';
        }, ms),
      );
    };

    const indicators: Indicators = {
      cursor(x, y) {
        const cursor = part('cursor', false);
        cursor.style.transform = `translate(${x}px, ${y}px)`;
        cursor.style.display = 'block';
      },
      click(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        part('cursor').after(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
      },
      key(text) {
        flash('key', text, 900);
      },
      label(text) {
        flash('label', text, 1600);
      },
    };
    (window as IndicatorWindow).__docsCaptureIndicators = indicators;

    // The dot follows every pointer move Playwright makes, so a glide shows as one.
    window.addEventListener(
      'pointermove',
      (event) => {
        if (document.body) indicators.cursor(event.clientX, event.clientY);
      },
      { capture: true, passive: true },
    );
  });
}

/** Calls one overlay in the page; fails when `installIndicators` did not run before the load. */
async function call(
  page: Page,
  method: keyof Indicators,
  args: Array<string | number>,
): Promise<void> {
  await page.evaluate(
    ({ name, values }) => {
      const indicators = (window as IndicatorWindow).__docsCaptureIndicators;
      if (!indicators) {
        throw new Error('installIndicators(page) was not called before the page loaded');
      }
      (indicators[name] as (...input: Array<string | number>) => void)(...values);
    },
    { name: method, values: args },
  );
}

/** Shows the pointer dot at `at` (it also follows every pointer move by itself). */
export async function showCursor(page: Page, at: { x: number; y: number }): Promise<void> {
  await call(page, 'cursor', [at.x, at.y]);
}

/** A ripple at `at`, for a click or the press that starts a drag. */
export async function showClick(page: Page, at: { x: number; y: number }): Promise<void> {
  await call(page, 'click', [at.x, at.y]);
}

/** A key cap at the bottom centre, e.g. "Ctrl + Z", for 0.9 s. */
export async function showKey(page: Page, label: string): Promise<void> {
  await call(page, 'key', [label]);
}

/** A caption above the key cap, e.g. "Scroll to zoom", for 1.6 s. */
export async function showLabel(page: Page, text: string): Promise<void> {
  await call(page, 'label', [text]);
}
```

- [ ] **Step 5: Give the runner its GIF branch**

Replace `scripts/docs-screenshots/runner.ts` with (Task 7.3's file plus `pointOf`, `keyLabel`, `recordingApi`, `recordGif` and the branch in `registerCaptures`; the screenshot path is unchanged):

```ts
/**
 * Turns the manifest into Playwright tests: one `test.describe` per output file, with its own
 * viewport, device, colour scheme, motion setting and stored layout, holding one test titled with
 * the file name (so `-g "<file>"` captures one image). Each test opens Explore, waits for the data
 * and for the plot to stop drawing, and runs the entry's setup and steps through a `CaptureApi`.
 * A screenshot then parks the pointer and shoots. A GIF is recorded at 1× in a context of its own
 * (Playwright sets `video` per worker, not per test) and saved, with a sidecar giving where the
 * scene starts, for `gif.ts` to convert.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEFAULT_LAYOUT } from '../../apps/web/src/explore/layout-defaults';
import {
  exampleFetched,
  expectProductDemo,
  openExample,
} from '../../apps/web/tests/helpers/examples';
import { waitForExploreDataLoad } from '../../apps/web/tests/helpers/explore';
import { plotSettled } from '../../apps/web/tests/helpers/plot';
import { exploreStorageState } from '../../apps/web/tests/helpers/tour-storage-state';
import {
  captureVariants,
  DEFAULT_GIF_BUDGET,
  DESKTOP_VIEWPORT,
  GIF_START,
  TABLET_VIEWPORT,
  validateManifest,
  type CaptureApi,
  type CaptureEntry,
  type CaptureKind,
  type CaptureVariant,
  type Clip,
  type GifSidecar,
  type Theme,
  type ViewportName,
} from './capture-plan';
import { installIndicators, showClick, showCursor, showKey, showLabel } from './indicators';
import { MANIFEST } from './manifest';
import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';

const DEFAULT_TIMEOUT_MS = 90_000;
/** How long the plot may keep drawing after a load before the capture fails. */
const SETTLE_CAP_MS = 10_000;

type Point = { x: number; y: number };
type Device = Pick<
  BrowserContextOptions,
  'viewport' | 'userAgent' | 'deviceScaleFactor' | 'isMobile' | 'hasTouch'
>;

/**
 * A device descriptor without `defaultBrowserType`, which a describe group cannot set (it would
 * need a worker of its own); every capture runs in the project's Chromium.
 */
function descriptor(name: 'Desktop Chrome' | 'Pixel 7'): Device {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name];
  return { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };
}

/** Desktop Chrome at 1280×720; a Pixel 7 (412×839, touch); the same phone at 800×1280. */
const DEVICES: Record<ViewportName, Device> = {
  desktop: { ...descriptor('Desktop Chrome'), viewport: DESKTOP_VIEWPORT },
  phone: descriptor('Pixel 7'),
  tablet: { ...descriptor('Pixel 7'), viewport: TABLET_VIEWPORT },
};

/** The context a variant is captured in, except its stored state, which needs the base URL. */
function contextOptions({ entry, theme }: CaptureVariant): BrowserContextOptions {
  const { viewport } = entry;
  const base = typeof viewport === 'object' ? { ...DEVICES.desktop, viewport } : DEVICES[viewport];
  const desktopLike = typeof viewport === 'object' || viewport === 'desktop';
  return {
    ...base,
    // Phones and tablets at 2, not Pixel 7's 2.625: touch comes from isMobile/hasTouch, and the
    // docs show these 240-320 px wide.
    deviceScaleFactor: entry.kind === 'gif' ? 1 : desktopLike ? (entry.scale ?? 2) : 2,
    colorScheme: theme,
    reducedMotion: entry.kind === 'png' ? 'reduce' : 'no-preference',
  };
}

/**
 * The tour marked seen, the theme left on System (so `colorScheme` picks it), and the entry's
 * layout over the default one.
 */
function storedState(entry: CaptureEntry, baseURL: string | undefined) {
  if (!baseURL) throw new Error('The capture config sets no baseURL');
  return exploreStorageState(baseURL, {
    layout: { ...DEFAULT_LAYOUT, ...entry.layout },
    theme: 'system',
  });
}

/**
 * Opens the entry's dataset (the startup demo, or an example by its `?dataset=` link) with the
 * perf counters on, refuses an e2e fixture, and waits until the plot has stopped drawing.
 */
async function openEntry(page: Page, entry: CaptureEntry): Promise<void> {
  if (entry.dataset) {
    if (!exampleFetched(entry.dataset)) {
      throw new Error(`The "${entry.dataset}" example is not on disk: run \`pnpm examples:fetch\``);
    }
    await openExample(page, entry.dataset, { search: '&perfCounters=1' });
  } else {
    await page.goto('/explore?perfCounters=1');
    await waitForExploreDataLoad(page);
  }
  await expectProductDemo(page);
  await plotSettled(page, SETTLE_CAP_MS);
}

const isLocator = (target: Locator | Point): target is Locator =>
  typeof (target as Locator).boundingBox === 'function';

/** A target's centre on screen: the point itself, or the middle of the element's box. */
async function pointOf(target: Locator | Point): Promise<Point> {
  if (!isLocator(target)) return target;
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Nothing to point at: ${target.toString()}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Control: 'Ctrl',
  Meta: '⌘',
  Shift: '⇧',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A key as the key cap shows it: "Control+z" → "Ctrl + Z". */
function keyLabel(key: string): string {
  return key
    .split('+')
    .map((part) => KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ');
}

/** The pointer and keys of a screenshot scene: actions without overlays, no pacing. */
function screenshotApi(page: Page, theme: Theme): CaptureApi {
  return {
    kind: 'png',
    theme,
    hold: async () => {},
    click: async (target) => {
      if (isLocator(target)) await target.click();
      else await page.mouse.click(target.x, target.y);
    },
    press: async (key) => {
      await page.keyboard.press(key);
    },
    moveTo: async (target, options) => {
      if (isLocator(target)) {
        await target.hover();
        return;
      }
      await page.mouse.move(target.x, target.y, { steps: options?.steps });
    },
    drag: async (from, to, options) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: options?.steps ?? 20 });
      await page.mouse.up();
    },
    label: async () => {},
  };
}

/**
 * The pointer and keys of a GIF scene: the pointer glides to each target, every click and key
 * press shows its overlay, and `hold` paces the recording. `hold` is the only timer in the
 * capture code; everything else waits for a signal.
 */
function recordingApi(page: Page, theme: Theme): CaptureApi {
  const glideTo = async (at: Point, steps = 12) => {
    await page.mouse.move(at.x, at.y, { steps });
    await showCursor(page, at);
  };
  return {
    kind: 'gif',
    theme,
    hold: async (ms) => {
      await page.waitForTimeout(ms);
    },
    click: async (target, options) => {
      const at = await pointOf(target);
      await glideTo(at);
      if (options?.label) await showLabel(page, options.label);
      await showClick(page, at);
      await page.mouse.click(at.x, at.y);
    },
    press: async (key, options) => {
      await showKey(page, options?.label ?? keyLabel(key));
      await page.keyboard.press(key);
    },
    moveTo: async (target, options) => {
      await glideTo(await pointOf(target), options?.steps ?? 15);
    },
    drag: async (from, to, options) => {
      await glideTo(from);
      await showClick(page, from);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: options?.steps ?? 20 });
      await page.mouse.up();
    },
    label: async (text) => {
      await showLabel(page, text);
    },
  };
}

/**
 * Moves the pointer off every control and checks that no kit tooltip is left open, so neither a
 * hover state nor a tooltip ends up in the picture.
 */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await expect(page.locator('ps-tooltip .tip').filter({ visible: true })).toHaveCount(0);
}

const isClip = (target: Locator | Clip): target is Clip =>
  typeof (target as Clip).width === 'number';

async function shoot(page: Page, entry: CaptureEntry, file: string): Promise<void> {
  const out = path.join(IMAGES_DIR, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const options = { path: out, animations: 'disabled', caret: 'hide' } as const;
  const target = entry.target ? await entry.target(page) : null;
  if (!target) await page.screenshot(options);
  else if (isClip(target)) await page.screenshot({ ...options, clip: target });
  else await target.screenshot(options);
}

const recording = (name: string, extension: 'webm' | 'json') =>
  path.join(TEMP_VIDEOS_DIR, `${name}.${extension}`);

/**
 * Records a GIF scene in a context of its own, sized to the viewport at 1×. Saves the video and
 * its sidecar only when the scene passes; a failed one also removes an older recording of the
 * same name, so `gif.ts` never converts a stale one.
 */
async function recordGif(
  browser: Browser,
  baseURL: string | undefined,
  variant: CaptureVariant,
  outputDir: string,
): Promise<void> {
  const { entry, theme } = variant;
  const options = contextOptions(variant);
  if (!options.viewport) throw new Error(`${variant.file}: no viewport`);
  const context = await browser.newContext({
    ...options,
    baseURL,
    storageState: storedState(entry, baseURL),
    recordVideo: { dir: outputDir, size: options.viewport },
  });
  const page = await context.newPage();
  // The video starts with the page: the scene starts this long into it.
  const started = Date.now();
  let trimStartMs = 0;
  try {
    await installIndicators(page);
    const cap = recordingApi(page, theme);
    await openEntry(page, entry);
    await entry.setup?.(page, cap);
    trimStartMs = Date.now() - started;
    await entry.steps?.(page, cap);
  } catch (error) {
    await context.close();
    fs.rmSync(recording(entry.name, 'webm'), { force: true });
    fs.rmSync(recording(entry.name, 'json'), { force: true });
    throw error;
  }
  await context.close();
  const video = page.video();
  if (!video) throw new Error(`${variant.file}: the context recorded no video`);
  fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });
  await video.saveAs(recording(entry.name, 'webm'));
  const sidecar: GifSidecar = {
    name: entry.name,
    trimStartMs,
    budgetBytes: entry.budgetBytes ?? DEFAULT_GIF_BUDGET,
    start: { ...GIF_START, ...entry.gif },
  };
  fs.writeFileSync(recording(entry.name, 'json'), `${JSON.stringify(sidecar, null, 2)}\n`);
}

/** Registers one test per output file of `kind`; throws when the manifest is invalid. */
export function registerCaptures(kind: CaptureKind): void {
  const problems = validateManifest(MANIFEST);
  if (problems.length > 0) {
    throw new Error(`The docs capture manifest is invalid:\n${problems.join('\n')}`);
  }
  for (const variant of captureVariants(MANIFEST, kind)) {
    const { entry, theme, file } = variant;
    test.describe(file, () => {
      if (kind === 'gif') {
        test(file, async ({ browser, baseURL }, testInfo) => {
          test.setTimeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS);
          await recordGif(browser, baseURL, variant, testInfo.outputPath('video'));
        });
        return;
      }

      test.use({
        ...contextOptions(variant),
        storageState: async ({ baseURL }, use) => {
          await use(storedState(entry, baseURL));
        },
      });

      test(file, async ({ page }) => {
        test.setTimeout(entry.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const cap = screenshotApi(page, theme);
        await openEntry(page, entry);
        await entry.setup?.(page, cap);
        await entry.steps?.(page, cap);
        if (!entry.keepPointer) await parkPointer(page);
        await shoot(page, entry, file);
      });
    });
  }
}
```

- [ ] **Step 6: The converter, the GIF spec and the zoom scene**

Create `scripts/docs-screenshots/gif.ts`:

```ts
#!/usr/bin/env tsx
/**
 * `pnpm docs:gifs [--keep] [name…]`: converts the GIF captures `pnpm docs:animations` recorded in
 * temp-videos/ (`<name>.webm` with its `<name>.json` sidecar) into docs/explore/images/<name>.gif.
 *
 * Each video is cut where its scene starts (the sidecar's measured `trimStartMs`) and converted
 * with ffmpeg's two-pass palette, first at the entry's starting fps and width, then down the
 * ladder (`gifLadder`) until the file fits the entry's budget. A GIF still over budget at the last
 * rung fails the run: its recording is kept and the GIF already in the docs is left as it was.
 * A converted recording is deleted unless `--keep` is given. With names, only those convert.
 *
 * Needs ffmpeg on PATH (`brew install ffmpeg`).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { gifLadder, type GifSettings, type GifSidecar } from './capture-plan';
import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.toString().trim();
    throw new Error(`ffmpeg failed: ${reason}`);
  }
}

function hasFfmpeg(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

/** Converts at one rung, two-pass (palette, then the GIF); returns the GIF's size in bytes. */
function convert(video: string, out: string, trimStartMs: number, rung: GifSettings): number {
  const palette = `${out}.palette.png`;
  const frames =
    `trim=start=${(trimStartMs / 1000).toFixed(3)},setpts=PTS-STARTPTS,` +
    `fps=${rung.fps},scale=${rung.width}:-1:flags=lanczos`;
  try {
    ffmpeg(['-i', video, '-vf', `${frames},palettegen=stats_mode=diff`, palette]);
    ffmpeg([
      '-i',
      video,
      '-i',
      palette,
      '-lavfi',
      `[0:v]${frames}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop',
      '0',
      out,
    ]);
  } finally {
    fs.rmSync(palette, { force: true });
  }
  return fs.statSync(out).size;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/**
 * Converts one recording; returns why it failed, or null once its GIF is in the docs within
 * budget.
 */
function convertRecording(name: string, keep: boolean): string | null {
  const video = path.join(TEMP_VIDEOS_DIR, `${name}.webm`);
  const sidecarFile = path.join(TEMP_VIDEOS_DIR, `${name}.json`);
  if (!fs.existsSync(video) || !fs.existsSync(sidecarFile)) {
    return `${name}: no recording; run \`pnpm docs:animations -g "${name}.gif"\``;
  }
  const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')) as GifSidecar;
  const scratch = path.join(TEMP_VIDEOS_DIR, `${name}.gif`);
  const out = path.join(IMAGES_DIR, `${name}.gif`);
  console.log(`${name} (budget ${megabytes(sidecar.budgetBytes)})`);
  try {
    for (const rung of gifLadder(sidecar.start)) {
      const bytes = convert(video, scratch, sidecar.trimStartMs, rung);
      const fits = bytes <= sidecar.budgetBytes;
      console.log(
        `  ${rung.fps} fps, ${rung.width} px: ${megabytes(bytes)}${fits ? '' : ' (over)'}`,
      );
      if (!fits) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(scratch, out);
      if (!keep) {
        fs.rmSync(video);
        fs.rmSync(sidecarFile);
      }
      return null;
    }
    return `${name}: over its ${megabytes(sidecar.budgetBytes)} budget at the last rung; shorten the scene or raise its budgetBytes`;
  } catch (error) {
    return `${name}: ${(error as Error).message}`;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const named = args.filter((arg) => !arg.startsWith('--'));
  if (!hasFfmpeg()) {
    console.error('ffmpeg is not on PATH: install it (`brew install ffmpeg`).');
    return 1;
  }
  const recorded = fs.existsSync(TEMP_VIDEOS_DIR)
    ? fs
        .readdirSync(TEMP_VIDEOS_DIR)
        .filter((file) => file.endsWith('.webm'))
        .map((file) => file.slice(0, -'.webm'.length))
    : [];
  const names = named.length > 0 ? named : recorded;
  if (names.length === 0) {
    console.log('No recordings in temp-videos/: run `pnpm docs:animations` first.');
    return 0;
  }
  const failures = names.flatMap((name) => convertRecording(name, keep) ?? []);
  if (failures.length > 0) {
    console.error(`\n${failures.length} GIF(s) not written:\n${failures.join('\n')}`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
```

Create `scripts/docs-screenshots/capture-gif.spec.ts`:

```ts
import { registerCaptures } from './runner';

registerCaptures('gif');
```

Create `scripts/docs-screenshots/scenes/scatterplot.ts`:

```ts
import { plotArea } from '../../../apps/web/tests/helpers/explore';
import { clusterScreenPoints } from '../../../apps/web/tests/helpers/plot';
import type { Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

/** Where the zoom GIF zooms: the centre of the demo's three-finger toxins, else the plot's upper right. */
async function zoomTarget(page: Page): Promise<{ x: number; y: number }> {
  const points = await clusterScreenPoints(page, 'three-finger toxin');
  if (points.length > 0) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  const box = await plotArea(page).boundingBox();
  if (!box) throw new Error('The plot area is not shown');
  return { x: box.x + box.width * 0.75, y: box.y + box.height * 0.25 };
}

/** Wheel steps of a smooth zoom, 50 ms apart; negative `delta` zooms in. */
async function wheel(page: Page, cap: CaptureApi, delta: number): Promise<void> {
  for (let step = 0; step < 20; step++) {
    await page.mouse.wheel(0, delta);
    await cap.hold(50);
  }
}

/** The scatterplot page's captures (docs/explore/scatterplot.md). */
export const SCATTERPLOT_CAPTURES: CaptureEntry[] = [
  {
    // Zoom in on a cluster with the wheel, drag to pan, and zoom back out.
    name: 'zoom',
    kind: 'gif',
    viewport: 'desktop',
    steps: async (page, cap) => {
      const target = await zoomTarget(page);
      await cap.moveTo(target, { steps: 15 });
      await cap.hold(800);
      await cap.label('Scroll to zoom');
      await wheel(page, cap, -50);
      await cap.hold(1000);
      await cap.label('Drag to pan');
      const panned = { x: target.x - 160, y: target.y + 90 };
      await cap.drag(target, panned, { steps: 30 });
      await cap.hold(1000);
      await wheel(page, cap, 50);
      await cap.hold(1000);
    },
    docs: ['explore/scatterplot.md'],
  },
];
```

Replace `scripts/docs-screenshots/manifest.ts` with:

```ts
import type { CaptureEntry } from './capture-plan';
import { EXAMPLE_CAPTURES } from './scenes/examples';
import { SCATTERPLOT_CAPTURES } from './scenes/scatterplot';

/** Every docs image, one entry each; the scenes are grouped by the docs page that shows them. */
export const MANIFEST: readonly CaptureEntry[] = [...EXAMPLE_CAPTURES, ...SCATTERPLOT_CAPTURES];
```

- [ ] **Step 7: The `docs-gif` project and the scripts**

Replace the root `playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The docs media captures in scripts/docs-screenshots/ (`pnpm docs:screenshots` for the PNGs,
 * `pnpm docs:animations` for the GIF recordings, which `pnpm docs:gifs` converts): the runner
 * turns each manifest entry into one test per output file, and docs/explore/images/README.md
 * describes the pipeline.
 *
 * It starts its own dev server on DOCS_CAPTURE_PORT (default 8096), with this checkout's packages
 * built first and without VITE_STARTUP_DATASET_URL, so the captures show the product demo, never
 * the fixture an e2e server pins. It never reuses a running server. PLAYWRIGHT_BASE_URL points the
 * captures at one instead, and starts nothing.
 */
const PORT = process.env.DOCS_CAPTURE_PORT ?? '8096';
if (!/^\d+$/.test(PORT)) {
  throw new Error(`DOCS_CAPTURE_PORT must be a port number, got "${PORT}"`);
}
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './scripts/docs-screenshots',

  // One capture at a time, in manifest order, never retried: a failure is a broken scene.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',

  // Each capture sets its own (90 s unless its entry says otherwise).
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The runner shoots each image itself.
    screenshot: 'off',
    // Headed on macOS for the system GPU's WebGL; CI runs headless on SwiftShader.
    headless: !!process.env.CI,
  },

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm turbo run build --filter=@protspace/app^... && pnpm --filter @protspace/app exec vite --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // Set empty, so a value in the caller's shell cannot pin the startup demo to a fixture.
        env: { VITE_STARTUP_DATASET_URL: '' },
        gracefulShutdown: { signal: 'SIGINT', timeout: 15_000 },
      },

  projects: [
    {
      // Screenshots: one test per PNG in the manifest (runner.ts sets each one's device).
      name: 'docs-png',
      use: { ...devices['Desktop Chrome'], video: 'off' },
      testMatch: /capture-png\.spec\.ts$/,
    },
    {
      // GIFs: one test per GIF in the manifest; runner.ts records each in a context of its own.
      name: 'docs-gif',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /capture-gif\.spec\.ts$/,
    },
  ],

  outputDir: './test-results/',
});
```

In the root `package.json`, replace

```json
    "docs:animations": "playwright test --project=animations",
    "docs:gifs": "tsx scripts/docs-screenshots/convert-to-gif.ts",
```

with

```json
    "docs:animations": "playwright test --project=docs-gif",
    "docs:gifs": "tsx scripts/docs-screenshots/gif.ts",
```

(`docs:images` stays `pnpm docs:screenshots && pnpm docs:animations && pnpm docs:gifs`.)

- [ ] **Step 8: Delete the old animation captures**

Run: `git rm scripts/docs-screenshots/capture-animations.spec.ts scripts/docs-screenshots/capture-eat-animations.spec.ts scripts/docs-screenshots/helpers.ts scripts/docs-screenshots/eat-helpers.ts scripts/docs-screenshots/convert-to-gif.ts`

(Task 7.14 ports `pickProvenanceDemoPair` from `git show a8cb13ca:scripts/docs-screenshots/eat-helpers.ts`.)

Run: `ls scripts/docs-screenshots scripts/docs-screenshots/scenes`
Expected: `capture-gif.spec.ts capture-plan.ts capture-png.spec.ts gif.ts indicators.ts manifest.ts paths.ts runner.ts scenes` and `examples.ts scatterplot.ts`.

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, 29 tests (Task 7.3's 22, 3 `gifLadder`, 4 capture-code checks).

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/storage-key.test.ts`
Expected: PASS, 2 tests (its glob of `scripts/**/*.ts` still finds `scripts/docs-screenshots/`).

Run: `pnpm type-check:scripts`
Expected: no errors.

Run: `pnpm exec playwright test --list`
Expected: six tests: the five `examples/<id>.png` under `[docs-png]` and `zoom.gif › zoom.gif` under `[docs-gif]`.

- [ ] **Step 10: Record and convert `zoom.gif`**

Run: `ls -l docs/explore/images/zoom.gif`
Expected: about 5.5 MB (5,465,244 bytes at `a8cb13ca`). Note the size for the report.

Run (sandbox disabled; starts the server on :8096 and a headed Chromium): `pnpm docs:animations -g "zoom.gif"`
Expected: 1 passed; `temp-videos/zoom.webm` and `temp-videos/zoom.json` exist. `cat temp-videos/zoom.json` shows `"name": "zoom"`, a `trimStartMs` of a few seconds (the load and settle), `"budgetBytes": 3145728` and `"start": { "fps": 30, "width": 1000 }`.

Run: `pnpm docs:gifs zoom`
Expected: one line per rung tried (`30 fps, 1000 px: … MiB`, then lower rungs while over), stopping at the first within 3.00 MiB; exit 0; `temp-videos/zoom.webm` and `.json` deleted. If even `15 fps, 640 px` is over, the run exits 1 naming `zoom`, keeps the `.webm` and leaves the old GIF: shorten the scene's holds (the 1000 ms ones first) or give the entry `gif: { fps: 20 }`, re-record, and report what changed. Do not raise `budgetBytes` without saying so.

Check the result: `ls -l docs/explore/images/zoom.gif` (at most 3,145,728 bytes); `ffprobe -v error -show_entries stream=width,height,r_frame_rate -of csv=p=0 docs/explore/images/zoom.gif` (the rung's width and rate). Open the GIF and check by eye: the first frame shows the loaded plot (no loading overlay, no tour), the pointer dot glides to the cluster, the "Scroll to zoom" and "Drag to pan" captions show, the plot zooms in, pans and zooms out, and the GIF is light. Report the size before and after and the rung used.

- [ ] **Step 11: Run the task's checks**

Run: `pnpm knip`
Expected: no issues (`gif.ts` is reached through the `docs:gifs` script; `indicators.ts`'s five exports through `runner.ts`; `GifSettings` through `gif.ts`; `GIF_START`, `GifSidecar` and `DEFAULT_GIF_BUDGET` through `runner.ts`).

Run: `pnpm exec prettier --check playwright.config.ts package.json scripts/docs-screenshots/capture-plan.ts scripts/docs-screenshots/runner.ts scripts/docs-screenshots/indicators.ts scripts/docs-screenshots/gif.ts scripts/docs-screenshots/capture-gif.spec.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/scenes/scatterplot.ts apps/web/src/explore/docs-images.test.ts`
Expected: all files pass.

Unrun at task time: none.

- [ ] **Step 12: Commit**

```bash
git add playwright.config.ts package.json scripts/docs-screenshots/capture-plan.ts scripts/docs-screenshots/runner.ts scripts/docs-screenshots/indicators.ts scripts/docs-screenshots/gif.ts scripts/docs-screenshots/capture-gif.spec.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/scenes/scatterplot.ts apps/web/src/explore/docs-images.test.ts docs/explore/images/zoom.gif
git commit -m "feat(docs): GIF captures with a per-GIF size budget"
```

(Sandbox disabled: the hook runs `pnpm precommit`. The five deleted files were staged by `git rm` in Step 8.)

### Task 7.5: Docs media lint in the pre-commit hook

One set of pure checks that keeps the manifest, the image files and the pages in step, run by the hook against the disk and by `pnpm test` against the pages. The two shrinking allowlists hold what the page tasks have not yet replaced.

**Files:**

- Create: `scripts/docs-screenshots/docs-lint.ts`, `scripts/docs-screenshots/check.ts`
- Modify: `package.json` (`"docs:images:check": "tsx scripts/docs-screenshots/check.ts"`; `precommit` = `pnpm lint-staged && pnpm quality && pnpm docs:annotations:check && pnpm docs:examples:check && pnpm docs:images:check && pnpm docs:build`)
- Modify: `AGENTS.md` ("Before committing": the backticked command list and a bullet for `docs:images:check`)
- Modify: `apps/web/src/explore/docs-images.test.ts`
- Modify: any docs page whose link anchor does not resolve today (fix the link; list them in the report)

**Interfaces:**

- Consumes: `MANIFEST` (`manifest.ts`), `captureVariants`, `DEFAULT_GIF_BUDGET` (`capture-plan.ts`); `IMAGES_DIR` (`paths.ts`); docs under `docs/` (excluding `.vitepress/`, `superpowers/` and `README.md` files, as VitePress's `srcExclude` does).
- Produces (`docs-lint.ts`, no Node or Playwright imports):
  - `interface DocsPage { path: string /* relative to docs/, e.g. 'explore/index.md' */; text: string }`.
  - `interface ImageRef { page: string; file: string /* relative to docs/explore/images */; classes: readonly string[]; lazy: boolean; line: number }`; `imageRefs(page: DocsPage): ImageRef[]` (markdown images with an optional `{.class}` block and raw `<img src class loading>`, from `./images/…`, `../explore/images/…` or `/explore/images/…`).
  - `headingSlug(text: string): string` (VitePress 1.6.4's: accents dropped, every run of whitespace and punctuation (the apostrophe included) to one `-`, `-` trimmed, a leading digit prefixed with `_`, lowercase); `pageAnchors(page: DocsPage): Set<string>` (heading slugs plus explicit `{#id}`).
  - `interface MediaOutput { file: string; kind: 'png' | 'gif'; budgetBytes: number; docs: readonly string[] }`; `interface ImageFile { file: string; bytes?: number }`.
  - `lintDocs(pages: readonly DocsPage[], files: readonly ImageFile[]): string[]` — the docs-side checks: refs to missing files, orphan files, the dark-pair rules, anchors (links `/explore/<page>#a`, `./<page>.md#a`, `<page>#a`, `#a`, and `/guide/…`), stale terms outside `STALE_PAGES`.
  - `lintManifest(outputs: readonly MediaOutput[], files: readonly ImageFile[], pages: readonly DocsPage[]): string[]` — outputs present, every file covered by an output or `LEGACY_IMAGES`, GIF bytes within budget, every output referenced by each of its `docs` pages; an output still listed in `LEGACY_IMAGES` fails ("an entry makes it, so remove it from LEGACY_IMAGES").
  - `const STALE_TERMS: readonly RegExp[]` (the Global Constraints list); `const LEGACY_IMAGES: ReadonlySet<string>` (every file under `docs/explore/images/` today except the five thumbnails and `zoom.gif`); `const STALE_PAGES: ReadonlySet<string>` (today's matches: `explore/control-bar.md`, `explore/index.md`, `explore/scatterplot.md`, `explore/legend.md`, `explore/figure-editor.md`, `explore/eat.md`, `explore/importing-data.md`, `guide/faq.md`; recompute and use what the check finds).
  - `check.ts`: reads the pages and the image files (with sizes) from disk, maps `MANIFEST` through `captureVariants` to `MediaOutput`s, prints every message of `lintDocs` and `lintManifest`, exits 1 if any; under 3 s.

**Tests:**

- `docs-images.test.ts`, rule cases on small in-memory pages: `headingSlug` ("Numeric range conditions" → `numeric-range-conditions`, "7. Filter Button" → `_7-filter-button`, "Light and dark" → `light-and-dark`, "What's new?" → `what-s-new`: VitePress's slugify turns the apostrophe into a separator, see the note below); `imageRefs` reads `{.light-only}`, raw `<img class loading>` and all three path forms; a pair in the right order passes; a dark twin first, a missing `.dark-only`, an eager raw dark twin, a `-dark` image alone and a `-dark` file without a light twin each fail with one message; an orphan file fails; a broken `#anchor` fails, an explicit `{#id}` resolves; a stale term fails on a page outside `STALE_PAGES`; `lintManifest` fails a missing output, an uncovered file, a GIF one byte over budget, and an output its page does not reference.
- `docs-images.test.ts`, the real docs: `lintDocs` over `import.meta.glob('../../../../docs/**/*.md', raw)` (minus `README.md` and `superpowers/**`, as `srcExclude`) and the keys of `import.meta.glob('../../../../docs/explore/images/**/*.{png,gif}')` returns no messages; `LEGACY_IMAGES` lists only files that exist; `STALE_PAGES` lists only pages that still match a stale term (the lists only shrink).
- Verification: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`; `time pnpm docs:images:check` (passes, under 3 s); `pnpm docs:build`; `pnpm knip`; `pnpm exec prettier --check AGENTS.md package.json`.
- Unrun at task time: none.

Notes for the implementer:

- The slug rule is copied from VitePress 1.6.4 (`node_modules/.pnpm/vitepress@1.6.4*/node_modules/vitepress/dist/node/chunk-*.js`, `const slugify = …`): NFKD, combining marks dropped, control characters dropped, every run of whitespace and of ``~`!@#$%^&*()-_+=[]{}|\;:"'“”‘’<>,.?/`` becomes one `-`, `-` trimmed at both ends, a leading digit gets `_`, then lowercase. So `What's new?` is `what-s-new`, not `whatsnew`/`whats-new`, and `_` in `ted_domains` becomes `-` (which is why `guide/annotations.md` uses explicit `{#ted_domains}` ids). markdown-it-anchor runs on every heading level and de-duplicates repeats as `slug-1`, `slug-2`.
- A relative image path resolves against the page's folder: `./images/latency-vs-proteins.png` on `guide/performance.md` is `docs/guide/images/…`, outside the pipeline, and `imageRefs` must ignore it. Only paths that resolve under `docs/explore/images/` are refs.
- The app compiles these modules for target ES2020 (`apps/web/tsconfig.app.json`); the hoisted `@types/node` supplies `at`/`replaceAll` types there, so `tsc` would not catch them, but keep the pure modules to ES2020 calls anyway: no `String.prototype.replaceAll`, no `Array.prototype.at`, no `Object.hasOwn`. `matchAll` and regex lookbehind are fine.
- At `a8cb13ca` every `#anchor` link in `docs/` resolves under these rules (checked while writing this plan: 0 broken). If the real-docs test reports one, fix the link in that page, not the rule, and name it in the report.
- A file under `docs/explore/images/` that is neither PNG nor GIF (`check.ts` also lists `.jpg`, `.jpeg`, `.webp`, `.svg`) fails `lintManifest` as uncovered, so a stray format cannot slip in; the app test globs only PNG and GIF.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/explore/docs-images.test.ts` exists (Task 7.3 created it, Task 7.4 extended it). Add this import next to its existing `capture-plan` import (keep the `vitest` import it already has; add `describe`, `expect`, `it` to it if one is missing):

```ts
import {
  headingSlug,
  imageRefs,
  LEGACY_IMAGES,
  lintDocs,
  lintManifest,
  pageAnchors,
  STALE_PAGES,
  STALE_TERMS,
  type DocsPage,
  type ImageFile,
  type ImageRef,
  type MediaOutput,
} from '../../../../scripts/docs-screenshots/docs-lint';
```

Append at the end of the file:

```ts
// ─── docs-lint.ts: the rules on small pages ──────────────────────────────────

const lintPage = (path: string, ...lines: string[]): DocsPage => ({ path, text: lines.join('\n') });
const onDisk = (...names: string[]): ImageFile[] => names.map((file) => ({ file }));
const PAIR = ['![A](./images/a.png){.light-only}', '![A](./images/a-dark.png){.dark-only}'];

describe('docs lint: headingSlug', () => {
  it.each([
    ['Numeric range conditions', 'numeric-range-conditions'],
    ['7. Filter Button', '_7-filter-button'],
    ['Light and dark', 'light-and-dark'],
    ["What's new?", 'what-s-new'],
    ['Selecting items (canvas + sidebar)', 'selecting-items-canvas-sidebar'],
    ['`predicted_membrane`', 'predicted-membrane'],
    ['Café **au lait**', 'cafe-au-lait'],
  ])('slugs %s as VitePress does', (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });
});

describe('docs lint: pageAnchors', () => {
  it('reads slugs, explicit ids and repeats, and skips front matter and code', () => {
    const anchors = pageAnchors(
      lintPage(
        'explore/a.md',
        '---',
        '# a YAML comment, not a heading',
        '---',
        '# Page',
        '## Setup {#custom-id}',
        '## Usage',
        '## Usage',
        '```bash',
        '# a shell comment, not a heading',
        '```',
      ),
    );
    expect([...anchors].sort()).toEqual(['custom-id', 'page', 'usage', 'usage-1']);
  });
});

describe('docs lint: imageRefs', () => {
  it('reads markdown and raw images in all three path forms, in page order', () => {
    const explore = lintPage(
      'explore/a.md',
      '![A](./images/a.png){.light-only}',
      '![A](./images/a-dark.png){.dark-only}',
      '<img src="./images/b.png" class="light-only" alt="B" width="1280" height="720" />',
      '<img src="./images/b-dark.png" class="dark-only" loading="lazy" alt="B" />',
      '![C](/explore/images/examples/c.png)',
    );
    const guide = lintPage(
      'guide/x.md',
      '![D](../explore/images/d.gif)',
      '![Not ours](./images/chart.png)',
      '`![in code](../explore/images/e.png)`',
    );
    const ref = (page: string, file: string, line: number, classes: string[], lazy = true): ImageRef => ({
      page,
      file,
      classes,
      lazy,
      line,
    });
    expect(imageRefs(explore)).toEqual([
      ref('explore/a.md', 'a.png', 1, ['light-only']),
      ref('explore/a.md', 'a-dark.png', 2, ['dark-only']),
      ref('explore/a.md', 'b.png', 3, ['light-only'], false),
      ref('explore/a.md', 'b-dark.png', 4, ['dark-only']),
      ref('explore/a.md', 'examples/c.png', 5, []),
    ]);
    expect(imageRefs(guide)).toEqual([ref('guide/x.md', 'd.gif', 1, [])]);
  });
});

describe('docs lint: light and dark pairs', () => {
  const files = onDisk('a.png', 'a-dark.png');

  it('passes a light image followed by its dark twin', () => {
    expect(lintDocs([lintPage('explore/a.md', ...PAIR)], files)).toEqual([]);
  });

  it('passes a raw pair whose dark twin loads lazily', () => {
    const raw = lintPage(
      'explore/a.md',
      '<img src="./images/a.png" class="light-only" alt="A" loading="eager" />',
      '<img src="./images/a-dark.png" class="dark-only" alt="A" loading="lazy" />',
    );
    expect(lintDocs([raw], files)).toEqual([]);
  });

  it.each([
    ['the dark twin first', [PAIR[1], PAIR[0]], /a-dark\.png is shown outside a light\/dark pair/],
    ['no .dark-only', [PAIR[0], '![A](./images/a-dark.png)'], /a-dark\.png needs \{\.dark-only\}/],
    ['no .light-only', ['![A](./images/a.png)', PAIR[1]], /a\.png needs \{\.light-only\}/],
    [
      'an eager raw dark twin',
      [
        '<img src="./images/a.png" class="light-only" alt="A" />',
        '<img src="./images/a-dark.png" class="dark-only" alt="A" />',
      ],
      /a-dark\.png must load lazily/,
    ],
  ])('fails %s with one message', (_, lines, message) => {
    const messages = lintDocs([lintPage('explore/a.md', ...lines)], files);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(message);
  });

  it('fails a -dark image shown without its light twin before it', () => {
    const pages = [lintPage('explore/a.md', ...PAIR), lintPage('explore/b.md', PAIR[1])];
    expect(lintDocs(pages, files)).toEqual([
      expect.stringMatching(/^explore\/b\.md:1: a-dark\.png is shown outside a light\/dark pair/),
    ]);
  });

  it('fails a -dark file without its light twin', () => {
    expect(lintDocs([], onDisk('b-dark.png'))).toEqual([
      'b-dark.png: a -dark image needs its light twin b.png',
    ]);
  });
});

describe('docs lint: files', () => {
  it('fails a file no page shows', () => {
    expect(lintDocs([], onDisk('a.png'))).toEqual([
      'a.png: no docs page shows it; delete it or show it on a page',
    ]);
  });

  it('fails a page showing a file that does not exist', () => {
    expect(lintDocs([lintPage('explore/a.md', '![x](./images/gone.png)')], [])).toEqual([
      'explore/a.md:1: gone.png does not exist',
    ]);
  });
});

describe('docs lint: anchors', () => {
  const target = lintPage('explore/a.md', '# A', '## Real heading {#custom}', '## Other part');

  it('resolves links in every form', () => {
    const pages = [
      target,
      lintPage('explore/index.md', '# Overview', '## Light and dark'),
      lintPage(
        'explore/b.md',
        '# B',
        '## Local',
        '[1](/explore/a#custom) [2](./a.md#other-part) [3](a#other-part) [4](#local)',
        '[5](/explore/#light-and-dark) [6](../explore/a.md#a) [7](/explore/a.html#other-part)',
        '[external](https://example.com/page#frag) [unknown page](/explore/nowhere#x)',
        '```md',
        '[in a fence](#nowhere)',
        '```',
        'Inline code is no link: `[x](#nowhere)`',
      ),
    ];
    expect(lintDocs(pages, [])).toEqual([]);
  });

  it('fails an anchor no heading has', () => {
    const pages = [target, lintPage('guide/data-format.md', 'See [it](/explore/a#nope).')];
    expect(lintDocs(pages, [])).toEqual([
      'guide/data-format.md:1: /explore/a#nope points at no heading on explore/a.md',
    ]);
  });
});

describe('docs lint: stale terms', () => {
  it('fails removed UI named in the user guide', () => {
    expect(lintDocs([lintPage('explore/new-page.md', '# New', 'Open the Control Bar.')], [])).toEqual(
      ['explore/new-page.md:2: "Control Bar" names removed UI'],
    );
  });

  it('leaves the developer docs alone', () => {
    const api = lintPage('developers/api/index.md', 'The control bar is removed.');
    expect(lintDocs([api], [])).toEqual([]);
  });

  it('leaves a page in STALE_PAGES alone until its rewrite', () => {
    // Empty once every page task has run (7.15); Task 7.16 deletes this case with the set. Until
    // then an empty set must still flag a stale term, so the case never passes with no assertion.
    if (STALE_PAGES.size === 0) {
      expect(lintDocs([lintPage('explore/x.md', 'Use the control bar.')], [])).toHaveLength(1);
      return;
    }
    for (const path of STALE_PAGES) {
      expect(lintDocs([lintPage(path, 'Use the control bar.')], [])).toEqual([]);
    }
  });
});

describe('docs lint: manifest', () => {
  const output = (file: string, extra: Partial<MediaOutput> = {}): MediaOutput => ({
    file,
    kind: 'png',
    budgetBytes: 3 * 1024 * 1024,
    docs: ['explore/a.md'],
    ...extra,
  });
  const shows = (...files: string[]) =>
    lintPage('explore/a.md', ...files.map((file) => `![x](./images/${file})`));

  it('passes outputs on disk, shown by their page, within budget', () => {
    const gif = output('z.gif', { kind: 'gif', budgetBytes: 100 });
    const files = [
      { file: 'a.png', bytes: 5 },
      { file: 'z.gif', bytes: 100 },
    ];
    expect(lintManifest([output('a.png'), gif], files, [shows('a.png', 'z.gif')])).toEqual([]);
  });

  it('fails an output missing on disk', () => {
    expect(lintManifest([output('a.png')], [], [shows('a.png')])).toEqual([
      expect.stringMatching(/^a\.png: in the manifest but not on disk/),
    ]);
  });

  it('fails a file no entry makes', () => {
    expect(lintManifest([], [{ file: 'stray.png' }], [])).toEqual([
      expect.stringMatching(/^stray\.png: no manifest entry makes it/),
    ]);
  });

  it('fails a GIF one byte over its budget', () => {
    const gif = output('z.gif', { kind: 'gif', budgetBytes: 100 });
    expect(lintManifest([gif], [{ file: 'z.gif', bytes: 101 }], [shows('z.gif')])).toEqual([
      'z.gif: 101 bytes, over its 100-byte budget',
    ]);
  });

  it('fails an output its page does not show', () => {
    expect(lintManifest([output('a.png')], [{ file: 'a.png' }], [shows()])).toEqual([
      'a.png: explore/a.md does not show it',
    ]);
  });

  it('fails an output whose page does not exist', () => {
    const lost = output('a.png', { docs: ['explore/none.md'] });
    expect(lintManifest([lost], [{ file: 'a.png' }], [])).toEqual([
      'a.png: its docs page explore/none.md does not exist',
    ]);
  });

  it('lets a legacy image stand without an entry, but not once an entry makes it', () => {
    // Empty after Task 7.14: an uncovered file must then fail, so the case still asserts.
    if (LEGACY_IMAGES.size === 0) {
      expect(lintManifest([], [{ file: 'x.png' }], [])).toEqual([
        expect.stringMatching(/^x\.png: no manifest entry makes it/),
      ]);
      return;
    }
    for (const file of [...LEGACY_IMAGES].slice(0, 1)) {
      expect(lintManifest([], [{ file }], [])).toEqual([]);
      const made = output(file);
      expect(lintManifest([made], [{ file }], [shows(file)])).toEqual([
        `${file}: an entry makes it, so remove it from LEGACY_IMAGES`,
      ]);
    }
  });
});

// ─── docs-lint.ts: the real docs ─────────────────────────────────────────────

const DOCS_ROOT = '../../../../docs/';
const IMAGES_ROOT = '../../../../docs/explore/images/';
const realPageTexts = import.meta.glob('../../../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const REAL_PAGES: DocsPage[] = Object.entries(realPageTexts)
  // Mirrors `srcExclude` in docs/.vitepress/config.mts: these are not built pages.
  .filter(([key]) => !key.endsWith('/README.md'))
  .filter(([key]) => !key.startsWith(`${DOCS_ROOT}superpowers/`))
  .map(([key, text]) => ({ path: key.slice(DOCS_ROOT.length), text }));
const REAL_FILES: ImageFile[] = Object.keys(
  import.meta.glob('../../../../docs/explore/images/**/*.{png,gif}'),
).map((key) => ({ file: key.slice(IMAGES_ROOT.length) }));

describe('docs lint: the real docs', () => {
  it('finds the pages and the images', () => {
    expect(REAL_PAGES.map((page) => page.path)).toContain('explore/index.md');
    expect(REAL_FILES.map((file) => file.file)).toContain('examples/demo.png');
  });

  it('passes every page and image', () => {
    expect(lintDocs(REAL_PAGES, REAL_FILES)).toEqual([]);
  });

  it('LEGACY_IMAGES lists only files that exist', () => {
    const names = new Set(REAL_FILES.map((file) => file.file));
    expect([...LEGACY_IMAGES].filter((file) => !names.has(file))).toEqual([]);
  });

  it('STALE_PAGES lists only pages that still use a stale term', () => {
    const stillStale = (path: string) => {
      const text = REAL_PAGES.find((page) => page.path === path)?.text ?? '';
      return STALE_TERMS.some((term) => term.test(text));
    };
    expect([...STALE_PAGES].filter((path) => !stillStale(path))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL. The whole file fails to load: `Failed to resolve import "../../../../scripts/docs-screenshots/docs-lint"`, because the module does not exist yet. Note the count of the file's earlier tests (7.3, 7.4) from the last passing run in the ledger; they must pass again in Step 4.

- [ ] **Step 3: Write `docs-lint.ts`**

Create `scripts/docs-screenshots/docs-lint.ts`:

```ts
/**
 * The docs media and link checks, as pure functions over page texts and file lists. The
 * pre-commit hook runs them against the disk and the capture manifest (`check.ts`); the app's
 * Vitest runs them against the pages it globs (`apps/web/src/explore/docs-images.test.ts`). So
 * this module imports nothing from Node or Playwright.
 *
 * A page is named relative to `docs/` (`explore/index.md`); an image file relative to
 * `docs/explore/images/` (`zoom.gif`, `examples/demo.png`).
 */

/** A docs page: its path relative to `docs/` and its markdown. */
export interface DocsPage {
  path: string;
  text: string;
}

/** One image a page shows from `docs/explore/images/`. */
export interface ImageRef {
  page: string;
  /** Relative to `docs/explore/images/`. */
  file: string;
  classes: readonly string[];
  /**
   * Fetched only once shown: every markdown image (the VitePress config lazy-loads them) and a
   * raw `<img>` with `loading="lazy"`.
   */
  lazy: boolean;
  /** 1-based. */
  line: number;
}

/** One file the capture manifest writes, and the pages that must show it. */
export interface MediaOutput {
  file: string;
  kind: 'png' | 'gif';
  budgetBytes: number;
  /** Relative to `docs/`. */
  docs: readonly string[];
}

/** An image file on disk. The hook knows its size; the app test does not. */
export interface ImageFile {
  file: string;
  bytes?: number;
}

/** Names of removed UI the user guide must not use any more. */
export const STALE_TERMS: readonly RegExp[] = [
  /control bar/i,
  /isolate button/i,
  /apply & isolate/i,
  /cog icon/i,
  /tips popover/i,
  /take a tour/i,
  /extract (values )?from other/i,
  /settings dialog/i,
];

/**
 * Images from the old layout that their page task has not yet regenerated or deleted. Only
 * shrinks: each page task removes what it replaces, and Task 7.16 deletes the set.
 */
export const LEGACY_IMAGES: ReadonlySet<string> = new Set([
  'control-bar-annotated.png',
  'control-bar-annotation.png',
  'control-bar-contours.png',
  'control-bar-export.png',
  'control-bar-projection.png',
  'duplicate-badges.gif',
  'eat-annotation-badge.png',
  'eat-connectors.gif',
  'eat-legend-section.png',
  'eat-reliability.gif',
  'figure-editor-overlays.png',
  'figure-editor-overview.png',
  'figure-editor-presets.png',
  'figure-editor-zoom-inset.png',
  'filter-query-builder.png',
  'interface-overview.png',
  'legend-others.gif',
  'legend-panel.png',
  'legend-reorder.gif',
  'legend-toggle.gif',
  'scatterplot-contours.png',
  'scatterplot-example.png',
  'select-box.gif',
  'select-single.gif',
  'structure-viewer.png',
]);

/**
 * User-guide pages that still name removed UI until their page task rewrites them. Only
 * shrinks; Task 7.16 deletes the set.
 */
export const STALE_PAGES: ReadonlySet<string> = new Set([
  'explore/control-bar.md',
  'explore/eat.md',
  'explore/figure-editor.md',
  'explore/importing-data.md',
  'explore/index.md',
  'explore/legend.md',
  'explore/scatterplot.md',
  'guide/faq.md',
]);

/** The pages the stale-term check reads: the user guide, not the developer docs. */
const USER_GUIDE = /^(index\.md|explore\/.+\.md|guide\/.+\.md)$/;
const IMAGES_DIR = 'explore/images/';
const DARK = /-dark\.(png|gif)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const lightTwinOf = (file: string): string => file.replace(/-dark(\.[a-z]+)$/, '$1');
const darkTwinOf = (file: string): string => file.replace(/(\.[a-z]+)$/, '-dark$1');

/** The page's lines with front matter and fenced code blanked, so line numbers still count. */
function prose(text: string): string[] {
  const lines = text.split('\n');
  let inFrontMatter = lines[0]?.trim() === '---';
  let fence: string | null = null;
  return lines.map((line, index) => {
    if (inFrontMatter) {
      if (index > 0 && line.trim() === '---') inFrontMatter = false;
      return '';
    }
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker;
      return '';
    }
    return line;
  });
}

/** A line with its inline code spans blanked: a link or image written as code is neither. */
const withoutInlineCode = (line: string): string =>
  line.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));

/** `target` resolved against the folder of `fromPage`, as a path relative to `docs/`. */
function resolve(fromPage: string, target: string): string | null {
  const parts = target.startsWith('/') ? [] : fromPage.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)(\{[^}\n]*\})?/g;
const HTML_IMG = /<img\b[^>]*>/gi;

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
}

/** The file under `docs/explore/images/` that `src` on `page` names, or null. */
function imageFile(page: string, src: string): string | null {
  if (SCHEME.test(src)) return null;
  const path = resolve(page, src.split(/[?#]/)[0]);
  return path !== null && path.startsWith(IMAGES_DIR) ? path.slice(IMAGES_DIR.length) : null;
}

/** The images `page` shows from `docs/explore/images/`, in page order. */
export function imageRefs(page: DocsPage): ImageRef[] {
  const refs: ImageRef[] = [];
  prose(page.text).forEach((raw, index) => {
    const text = withoutInlineCode(raw);
    const found: Array<{ at: number; ref: ImageRef }> = [];
    for (const match of text.matchAll(MD_IMAGE)) {
      const file = imageFile(page.path, match[1]);
      if (file === null) continue;
      const classes = [...(match[2] ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const ref = { page: page.path, file, classes, lazy: true, line: index + 1 };
      found.push({ at: match.index ?? 0, ref });
    }
    for (const match of text.matchAll(HTML_IMG)) {
      const src = attribute(match[0], 'src');
      const file = src === null ? null : imageFile(page.path, src);
      if (file === null) continue;
      const classes = (attribute(match[0], 'class') ?? '').split(/\s+/).filter(Boolean);
      const lazy = attribute(match[0], 'loading') === 'lazy';
      found.push({ at: match.index ?? 0, ref: { page: page.path, file, classes, lazy, line: index + 1 } });
    }
    found.sort((a, b) => a.at - b.at).forEach(({ ref }) => refs.push(ref));
  });
  return refs;
}

/** VitePress's slugify (vitepress 1.6), applied to a heading's text without its markup. */
const SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The anchor VitePress gives a heading with this markdown text. */
export function headingSlug(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(SPECIAL, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$/;
const ATTRS = /[ \t]*\{([^}]*)\}[ \t]*$/;

/** Every anchor on the page: heading slugs (repeats as `slug-1`, `slug-2`) and explicit `{#id}`. */
export function pageAnchors(page: DocsPage): Set<string> {
  const anchors = new Set<string>();
  for (const line of prose(page.text)) {
    const heading = HEADING.exec(line)?.[1];
    if (heading === undefined) continue;
    const attrs = ATTRS.exec(heading);
    const id = attrs ? /#([^\s#.}]+)/.exec(attrs[1])?.[1] : undefined;
    if (id) {
      anchors.add(id);
      continue;
    }
    const slug = headingSlug((attrs ? heading.slice(0, attrs.index) : heading).replace(/[ \t]+#+$/, ''));
    let unique = slug;
    for (let n = 1; anchors.has(unique); n++) unique = `${slug}-${n}`;
    anchors.add(unique);
  }
  return anchors;
}

const MD_LINK = /(?<!!)\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REF_LINK = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HREF = /\bhref\s*=\s*"([^"]*)"/gi;

function linksOn(line: string): string[] {
  const text = withoutInlineCode(line);
  const links = [...text.matchAll(MD_LINK), ...text.matchAll(HREF)].map((match) => match[1]);
  const reference = REF_LINK.exec(text)?.[1];
  return reference ? [...links, reference] : links;
}

/** The page a link's path part names, or null when it names none of `known` (VitePress checks those). */
function linkedPage(from: string, target: string, known: ReadonlySet<string>): string | null {
  if (target === '') return from;
  const resolved = resolve(from, target.replace(/\.html$/, ''));
  if (resolved === null) return null;
  const candidates =
    target.endsWith('/') || resolved === ''
      ? [resolved === '' ? 'index.md' : `${resolved}/index.md`]
      : resolved.endsWith('.md')
        ? [resolved]
        : [`${resolved}.md`, `${resolved}/index.md`];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function decode(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function anchorProblems(pages: readonly DocsPage[]): string[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const known = new Set(byPath.keys());
  const anchorSets = new Map<string, Set<string>>();
  const anchorsOf = (path: string): Set<string> => {
    let anchors = anchorSets.get(path);
    if (!anchors) {
      anchors = pageAnchors(byPath.get(path)!);
      anchorSets.set(path, anchors);
    }
    return anchors;
  };
  const problems: string[] = [];
  for (const page of pages) {
    prose(page.text).forEach((line, index) => {
      for (const href of linksOn(line)) {
        const hash = href.indexOf('#');
        if (hash < 0 || SCHEME.test(href)) continue;
        const target = linkedPage(page.path, href.slice(0, hash), known);
        const anchor = decode(href.slice(hash + 1));
        if (target === null || anchor === '' || anchorsOf(target).has(anchor)) continue;
        problems.push(`${page.path}:${index + 1}: ${href} points at no heading on ${target}`);
      }
    });
  }
  return problems;
}

function staleProblems(pages: readonly DocsPage[]): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    if (!USER_GUIDE.test(page.path) || STALE_PAGES.has(page.path)) continue;
    const lines = page.text.split('\n');
    for (const term of STALE_TERMS) {
      const index = lines.findIndex((line) => term.test(line));
      if (index < 0) continue;
      const words = term.exec(lines[index])?.[0] ?? '';
      problems.push(`${page.path}:${index + 1}: "${words}" names removed UI`);
    }
  }
  return problems;
}

function imageProblems(pages: readonly DocsPage[], files: readonly ImageFile[]): string[] {
  const problems: string[] = [];
  const onDisk = new Set(files.map((file) => file.file));
  const twinless = new Set(
    [...onDisk].filter((file) => DARK.test(file) && !onDisk.has(lightTwinOf(file))),
  );
  for (const file of twinless) {
    problems.push(`${file}: a -dark image needs its light twin ${lightTwinOf(file)}`);
  }
  const shown = new Set<string>();
  for (const page of pages) {
    const refs = imageRefs(page);
    // One message per image and its twin: a pair written backwards is one mistake, not two.
    const pairProblems = new Map<string, string>();
    const note = (ref: ImageRef, text: string) => {
      const key = lightTwinOf(ref.file);
      if (!pairProblems.has(key)) pairProblems.set(key, `${page.path}:${ref.line}: ${text}`);
    };
    for (const ref of refs) {
      shown.add(ref.file);
      if (!onDisk.has(ref.file)) problems.push(`${page.path}:${ref.line}: ${ref.file} does not exist`);
    }
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      if (!onDisk.has(ref.file) || twinless.has(ref.file)) continue;
      if (DARK.test(ref.file)) {
        note(ref, `${ref.file} is shown outside a light/dark pair: put it on the line after its light twin, with {.dark-only}`);
        continue;
      }
      const twin = darkTwinOf(ref.file);
      if (!onDisk.has(twin)) {
        if (ref.classes.includes('light-only')) {
          note(ref, `${ref.file} is marked light-only but has no dark twin, so dark mode shows nothing`);
        }
        continue;
      }
      const next = refs[i + 1];
      if (!next || next.file !== twin || next.line > ref.line + 1) {
        note(ref, `${ref.file} has a dark twin: follow it on the next line with ${twin} and {.dark-only}`);
        continue;
      }
      i++; // the pair consumes its dark twin
      if (!ref.classes.includes('light-only')) {
        note(ref, `${ref.file} needs {.light-only} (class="light-only") in its pair`);
      } else if (!next.classes.includes('dark-only')) {
        note(next, `${twin} needs {.dark-only} (class="dark-only") in its pair`);
      } else if (!next.lazy) {
        note(next, `${twin} must load lazily (loading="lazy"), or every light reader fetches it too`);
      }
    }
    problems.push(...pairProblems.values());
  }
  for (const file of onDisk) {
    if (!shown.has(file) && !twinless.has(file)) {
      problems.push(`${file}: no docs page shows it; delete it or show it on a page`);
    }
  }
  return problems;
}

/**
 * The checks that need only the pages and the image files: refs to missing files, orphans, the
 * light/dark pair rules, `#anchor` links, and names of removed UI in the user guide.
 */
export function lintDocs(pages: readonly DocsPage[], files: readonly ImageFile[]): string[] {
  return [...imageProblems(pages, files), ...anchorProblems(pages), ...staleProblems(pages)];
}

/**
 * The checks that need the capture manifest: every output on disk, within its budget and shown by
 * each page its entry names; every file made by an entry or still in `LEGACY_IMAGES`.
 */
export function lintManifest(
  outputs: readonly MediaOutput[],
  files: readonly ImageFile[],
  pages: readonly DocsPage[],
): string[] {
  const problems: string[] = [];
  const onDisk = new Map(files.map((file) => [file.file, file]));
  const byPath = new Map(pages.map((page) => [page.path, page]));
  for (const output of outputs) {
    const file = onDisk.get(output.file);
    if (!file) {
      problems.push(`${output.file}: in the manifest but not on disk; capture it`);
    } else if (output.kind === 'gif' && file.bytes !== undefined && file.bytes > output.budgetBytes) {
      problems.push(`${output.file}: ${file.bytes} bytes, over its ${output.budgetBytes}-byte budget`);
    }
    if (LEGACY_IMAGES.has(output.file)) {
      problems.push(`${output.file}: an entry makes it, so remove it from LEGACY_IMAGES`);
    }
    for (const doc of output.docs) {
      const page = byPath.get(doc);
      if (!page) problems.push(`${output.file}: its docs page ${doc} does not exist`);
      else if (!imageRefs(page).some((ref) => ref.file === output.file)) {
        problems.push(`${output.file}: ${doc} does not show it`);
      }
    }
  }
  const made = new Set(outputs.map((output) => output.file));
  for (const file of files) {
    if (!made.has(file.file) && !LEGACY_IMAGES.has(file.file)) {
      problems.push(
        `${file.file}: no manifest entry makes it; add one under scripts/docs-screenshots/scenes/ or delete the file`,
      );
    }
  }
  return problems;
}
```

Two consequences to keep in mind: `lintManifest` runs `imageRefs` once per output and page, which is cheap (some 60 outputs, a few hundred lines a page); and the "remove it from LEGACY_IMAGES" rule is what makes each page task shrink the set when it regenerates a file, since a file both made and legacy would otherwise pass silently.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS: the earlier 7.3/7.4 tests plus 35 new ones (7 slugs, 1 anchors, 1 refs, 8 pair cases, 2 file cases, 2 anchor cases, 3 stale-term cases, 7 manifest cases, 4 real-docs cases). If "passes every page and image" fails on a `#anchor`, fix that link in its page (the heading it meant is usually renamed; use `pageAnchors` output in a scratch `it` to see the page's anchors, then delete the scratch) and list the page and line in the report. If it fails on a stale term in a page not in `STALE_PAGES`, add the page to `STALE_PAGES` only if that page's task (7.9–7.15) rewrites it; otherwise fix the wording. If "STALE_PAGES lists only pages that still use a stale term" fails, drop the named page from the set.

- [ ] **Step 5: Write `check.ts`**

Create `scripts/docs-screenshots/check.ts`:

```ts
/**
 * `pnpm docs:images:check`, in the pre-commit hook: the docs-lint rules against the disk. Every
 * image under docs/explore/images/ must come from the capture manifest (or still be listed in
 * LEGACY_IMAGES), be shown by the pages its entry names, and keep GIFs within their budget; the
 * pages' image refs, light/dark pairs, #anchor links and user-guide wording must hold. Reads
 * files only; runs no browser.
 */
import * as fs from 'fs';
import * as path from 'path';
import { captureVariants, DEFAULT_GIF_BUDGET } from './capture-plan';
import {
  lintDocs,
  lintManifest,
  type DocsPage,
  type ImageFile,
  type MediaOutput,
} from './docs-lint';
import { MANIFEST } from './manifest';
import { IMAGES_DIR } from './paths';

const DOCS_DIR = path.join(__dirname, '../../docs');
/** Every image format, so a stray JPEG or SVG fails as uncovered instead of slipping past. */
const IMAGE_FILE = /\.(png|gif|jpe?g|webp|svg)$/i;

/** Every file under `dir`, skipping dot folders (`.vitepress`) and node_modules. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const posix = (file: string): string => file.split(path.sep).join('/');

const pages: DocsPage[] = walk(DOCS_DIR)
  .filter((file) => file.endsWith('.md') && path.basename(file) !== 'README.md')
  // Mirrors `srcExclude` in docs/.vitepress/config.mts: these are not built pages.
  .filter((file) => !posix(path.relative(DOCS_DIR, file)).startsWith('superpowers/'))
  .map((file) => ({ path: posix(path.relative(DOCS_DIR, file)), text: fs.readFileSync(file, 'utf8') }));

const files: ImageFile[] = walk(IMAGES_DIR)
  .filter((file) => IMAGE_FILE.test(file))
  .map((file) => ({ file: posix(path.relative(IMAGES_DIR, file)), bytes: fs.statSync(file).size }));

const outputs: MediaOutput[] = captureVariants(MANIFEST).map(({ entry, file }) => ({
  file,
  kind: entry.kind,
  budgetBytes: entry.budgetBytes ?? DEFAULT_GIF_BUDGET,
  docs: entry.docs,
}));

const problems = [...lintDocs(pages, files), ...lintManifest(outputs, files, pages)];
if (problems.length > 0) {
  console.error(`docs:images:check: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    'Capture an image with `pnpm docs:screenshots -g "<file>"` or ' +
      '`pnpm docs:animations -g "<file>" && pnpm docs:gifs <name>`; see docs/explore/images/README.md.',
  );
  process.exit(1);
}
console.log(`✓ ${files.length} docs images match the manifest (${outputs.length} outputs) and ${pages.length} pages.`);
```

`captureVariants(MANIFEST)` with no kind returns every variant of both kinds in manifest order (Task 7.3's contract), each `{ entry, theme, file }` with `file` like `x-dark.png`.

In `package.json` `scripts`, add after the `"docs:examples:check"` line:

```json
    "docs:images:check": "tsx scripts/docs-screenshots/check.ts",
```

and replace the `precommit` value:

```json
    "precommit": "pnpm lint-staged && pnpm quality && pnpm docs:annotations:check && pnpm docs:examples:check && pnpm docs:images:check && pnpm docs:build",
```

knip finds `check.ts` through the `tsx …` script, as it finds `gif.ts` through `docs:gifs`.

- [ ] **Step 6: Run the check**

Run: `time pnpm docs:images:check`
Expected: `✓ 31 docs images match the manifest (6 outputs) and 29 pages.` (31 files: the 25 legacy ones, the five thumbnails and `zoom.gif`; 29 pages at `a8cb13ca`; take the real numbers) and a wall time under 3 s. If it is slower, measure where the time goes (`node --cpu-prof` is overkill; first try `time pnpm exec tsx -e "require('./scripts/docs-screenshots/manifest')"`): the manifest import pulls in `@playwright/test` through the helpers. Say the time in the report; if it is over 3 s, report it rather than restructuring the manifest.

Then prove it fails: rename `docs/explore/images/zoom.gif` to `zoom.gif.bak`, run `pnpm docs:images:check`, expect exit 1 with `zoom.gif: in the manifest but not on disk; capture it`, and rename it back. Check `git status --short docs/explore/images` shows nothing afterwards.

- [ ] **Step 7: AGENTS.md**

In `AGENTS.md` ("## Before committing"), replace:

```md
Always run `pnpm precommit` before any git commit. It is
`lint-staged && quality && docs:annotations:check && docs:examples:check && docs:build`:
```

with:

```md
Always run `pnpm precommit` before any git commit. It is
`lint-staged && quality && docs:annotations:check && docs:examples:check && docs:images:check && docs:build`:
```

and insert after the `docs:examples:check` bullet (the one ending "the bundle manifest and its prose (`docs/scripts/example-details.ts`)"):

```md
- `docs:images:check` — every image under `docs/explore/images/` must come from the capture
  manifest (`scripts/docs-screenshots/`) and be shown by the pages its entry names; `-dark` twins
  are written as light/dark pairs, GIFs stay within their size budget, every `#anchor` link
  resolves, and the user guide names no removed UI
```

- [ ] **Step 8: Run what the task touches**

Run, in order:

- `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts` — PASS, as in Step 4.
- `pnpm type-check:scripts` — PASS (`docs-lint.ts` and `check.ts` are under `scripts/`, strict with `noUnusedLocals`/`noUnusedParameters`).
- `pnpm --filter @protspace/app type-check` — PASS (the test imports `docs-lint.ts` under the app's settings; run `pnpm --filter @protspace/core build` first if core's `dist` is missing or older than the last core change).
- `pnpm docs:images:check` — PASS.
- `pnpm docs:build` — PASS.
- `pnpm knip` — PASS: every export of `docs-lint.ts` has an importer (`check.ts` imports `lintDocs`, `lintManifest`, `DocsPage`, `ImageFile`, `MediaOutput`; the test imports the rest, `ImageRef` included).
- `pnpm exec prettier --check AGENTS.md package.json scripts/docs-screenshots/docs-lint.ts scripts/docs-screenshots/check.ts apps/web/src/explore/docs-images.test.ts` — if it reports a file, run `pnpm exec prettier --write` on that file and check again.

Report the new test count of `docs-images.test.ts`, the time of `pnpm docs:images:check`, and any link you fixed. No image file is written or deleted by this task.

- [ ] **Step 9: Commit**

```bash
git add scripts/docs-screenshots/docs-lint.ts scripts/docs-screenshots/check.ts package.json AGENTS.md apps/web/src/explore/docs-images.test.ts
git commit -m "chore(docs): check docs images and links in the pre-commit hook"
```

Add any page whose link you fixed in Step 4 to the `git add` line. The hook now runs `docs:images:check` itself; it must pass.

### Task 7.6: Tour steps as data for every layout

The tour's content as plain data: one function returns the steps for a kind and a context (layout mode, coarse pointer, Mac), with no driver.js import, so every list is unit-tested. The new targets get their `data-driver-id`.

**Files:**

- Create: `apps/web/src/tour/tour-steps.ts`, `apps/web/src/tour/tour-steps.test.ts`
- Modify: `apps/web/src/tour/storage-key.ts` (`TourKind`)
- Modify: `apps/web/src/workbench/ViewBar.tsx` (root `div`: `data-driver-id="view-bar"`), `AppBar.tsx` (dataset `button`: `data-driver-id="dataset"`), `Rail.tsx` (`nav`: `data-driver-id="rail"`), `MoreMenu.tsx` (`ps-button.wb-more`: `data-driver-id="more"`), `SearchToggle.tsx` (`ps-icon-button`: `data-driver-id="search-toggle"`), `apps/web/src/custom-elements.d.ts` (only if `ps-button`/`ps-icon-button` lack a `'data-driver-id'` prop type)

**Interfaces:**

- Consumes: `type LayoutMode` (`apps/web/src/explore/layout-defaults.ts`: `'desktop' | 'tablet' | 'phone' | 'landscape'`); `hasStructureSheet(mode)` (`apps/web/src/explore/layout-mode.ts`: true for `'phone'` and `'landscape'`, a pure function; the module builds its media queries only on first `getLayoutMode()` call, so importing it in a node test is safe); the Copy table and step targets in the Global Constraints; today's step copy (`product-tour.ts` 164–300) as the starting text, corrected per R3 §1 (Filter is a sidebar panel, drop a file anywhere, the dataset name opens the Import menu, no duplicate Import step, Contours named).
- Produces:
  - `storage-key.ts`: `export type TourKind = 'full' | 'whats-new'` (the module stays a leaf).
  - `tour-steps.ts`: `interface TourContext { mode: LayoutMode; coarse: boolean; mac: boolean }`; `interface TourStepSpec { id: TourStepId; title: string; description: string /* HTML */; target: string | { host: string; inner: string } | null /* light-DOM selector; shadow pair; null = centred */; spotlight?: string /* selector lifted above the overlay on a centred step */ }`; `type TourStepId = 'welcome' | 'whats-new' | 'data' | 'dataset' | 'view-bar' | 'more' | 'search' | 'plot' | 'selection' | 'legend' | 'other' | 'sidebar' | 'theme' | 'finish' | 'end'`; `tourSteps(kind: TourKind, ctx: TourContext): TourStepSpec[]` (titles per the Copy table; `landscape` gets the phone lists). Selectors are `[data-driver-id="<id>"]`; the Other step is `{ host: '[data-driver-id="legend"]', inner: '[data-driver-id="other-row"]' }`.
  - `TourContext` and `TourStepSpec` are exported (the test imports both; Task 7.7's `product-tour.ts` imports them); `TourStepId` stays module-private (no importer, knip).
  - Descriptions: the welcome names where the tour lives again (Help, or Help & shortcuts in More on phones); "Import & Export" covers the dataset name, examples, the last file, "Open a file…", dropping a file anywhere, FASTA going to the server, and the Export menu; "The View Bar" names Projection (with its details), Color by, Contours, Filter, and More on narrow windows; "Search Proteins" keeps ⌘K/Ctrl+K and adds the found/missing report; "Selection Tools" adds the status chips with ✕ and ⌘Z/Ctrl+Z undo; "The Sidebar" names Legend, Structure (a dot when a protein is loaded) and Filter, collapse, the draggable edge and the floating structure; "Light or Dark" names System, Light, Dark; "More Options" lists Contours, Filter, Import, Export, Theme, Help & shortcuts, Feedback and the dot; the What's new texts say what changed (the view bar replaces the control bar; sidebar panels, fold, resize, floating structure; tools and the selection bar on the plot, chips, undo; dark mode); "That's it" points at Help → Take the tour (More → Help & shortcuts on phones).
  - Wording rules this task fixes in code: keyboard chords (⌘K, ⌘Z, the ⌘/Ctrl click modifier) appear only on a fine pointer (`coarse: false`); every "click" becomes "tap" on a coarse pointer; the plot, legend and Other texts on a coarse pointer use tap, double-tap, drag, pinch and "hold the handle", never "click", "hover" or "mouse wheel".

**Tests:**

- `tour-steps.test.ts`: the titles for each (kind, mode) equal the Copy table; landscape equals phone; no phone or landscape step targets `search`, `import`, `data-actions`, `help`, `theme`, `rail` or `projections`; no tablet step targets `rail`; the welcome spotlight is `help` on desktop and tablet and `more` on phone; with `coarse: true` the plot, legend and Other descriptions match none of `/click|hover|mouse wheel/i` and the legend's contains "double-tap" (tablet included); with `coarse: false` the plot text names the mouse wheel; `mac: true` writes ⌘, `mac: false` Ctrl; every non-null string target is a `[data-driver-id="…"]` selector from the Global Constraints list; ids are unique within a list.
- Verification: `pnpm --filter @protspace/app exec vitest --run src/tour/tour-steps.test.ts`; `pnpm --filter @protspace/app exec tsc -p tsconfig.app.json --noEmit` (or `pnpm type-check`); `pnpm knip`.
- Unrun at task time: `workbench-view-bar.spec.ts`, `workbench-sidebar.spec.ts`, `mobile-bars.spec.ts` (attributes only).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/tour/tour-steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LayoutMode } from '../explore/layout-defaults';
import type { TourKind } from './storage-key';
import { tourSteps, type TourContext, type TourStepSpec } from './tour-steps';

const MODES: readonly LayoutMode[] = ['desktop', 'tablet', 'phone', 'landscape'];
const KINDS: readonly TourKind[] = ['full', 'whats-new'];

/** The Copy table of the plan's Global Constraints. */
const FULL_DESKTOP = [
  'Welcome to ProtSpace',
  'Import & Export',
  'The View Bar',
  'Search Proteins',
  'Interactive Scatterplot',
  'Selection Tools',
  'Legend Panel',
  'Expand Hidden Categories',
  'The Sidebar',
  'Light or Dark',
  "You're All Set!",
];
const FULL_PHONE = [
  'Welcome to ProtSpace',
  'Your Data',
  'The View Bar',
  'More Options',
  'Search Proteins',
  'Interactive Scatterplot',
  'Selection Tools',
  'Legend Panel',
  'Expand Hidden Categories',
  "You're All Set!",
];
const NEW_DESKTOP = [
  "What's new in ProtSpace",
  'The View Bar',
  'The Sidebar',
  'Selection Tools',
  'Light or Dark',
  "That's it",
];
const NEW_PHONE = [
  "What's new in ProtSpace",
  'The View Bar',
  'More Options',
  'Legend Panel',
  'Selection Tools',
  "That's it",
];
const withoutSidebar = (titles: string[]) => titles.filter((title) => title !== 'The Sidebar');

/** The data-driver-id values the Global Constraints keep or add. */
const DRIVER_IDS = [
  'scatterplot',
  'legend',
  'other-row',
  'import',
  'projections',
  'search',
  'selection',
  'data-actions',
  'help',
  'theme',
  'view-bar',
  'dataset',
  'rail',
  'more',
  'search-toggle',
];

const context = (mode: LayoutMode, coarse = false, mac = false): TourContext => ({
  mode,
  coarse,
  mac,
});
const titles = (steps: TourStepSpec[]) => steps.map((step) => step.title);
const driverId = (selector: string) => /^\[data-driver-id="([a-z-]+)"\]$/.exec(selector)?.[1];
/** The data-driver-id each step points at: its light-DOM target or its shadow host. */
const targetIds = (steps: TourStepSpec[]) =>
  steps.flatMap((step) =>
    step.target === null
      ? []
      : typeof step.target === 'string'
        ? [driverId(step.target)]
        : [driverId(step.target.host), driverId(step.target.inner)],
  );
const step = (steps: TourStepSpec[], id: TourStepSpec['id']) => {
  const found = steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
};

describe('tourSteps', () => {
  it.each([
    ['full', 'desktop', FULL_DESKTOP],
    ['full', 'tablet', withoutSidebar(FULL_DESKTOP)],
    ['full', 'phone', FULL_PHONE],
    ['full', 'landscape', FULL_PHONE],
    ['whats-new', 'desktop', NEW_DESKTOP],
    ['whats-new', 'tablet', withoutSidebar(NEW_DESKTOP)],
    ['whats-new', 'phone', NEW_PHONE],
    ['whats-new', 'landscape', NEW_PHONE],
  ] as const)('the %s tour on %s has the titles of the Copy table', (kind, mode, expected) => {
    expect(titles(tourSteps(kind, context(mode)))).toEqual(expected);
  });

  it('gives a phone on its side the phone lists', () => {
    for (const kind of KINDS) {
      for (const coarse of [false, true]) {
        expect(tourSteps(kind, context('landscape', coarse))).toEqual(
          tourSteps(kind, context('phone', coarse)),
        );
      }
    }
  });

  it('points at nothing a phone or a tablet hides', () => {
    const hiddenOnPhones = ['search', 'import', 'data-actions', 'help', 'theme', 'rail', 'projections'];
    for (const kind of KINDS) {
      for (const mode of ['phone', 'landscape'] as const) {
        const ids = targetIds(tourSteps(kind, context(mode, true)));
        for (const hidden of hiddenOnPhones) expect(ids, `${kind} on ${mode}`).not.toContain(hidden);
      }
      expect(targetIds(tourSteps(kind, context('tablet')))).not.toContain('rail');
    }
  });

  it('spotlights Help on the first step on desktop and tablet, More on a phone', () => {
    for (const kind of KINDS) {
      for (const mode of MODES) {
        const [first] = tourSteps(kind, context(mode));
        expect(first.target).toBeNull();
        expect(first.spotlight).toBe(
          mode === 'phone' || mode === 'landscape'
            ? '[data-driver-id="more"]'
            : '[data-driver-id="help"]',
        );
      }
    }
  });

  it('talks touch on a coarse pointer, tablet included', () => {
    for (const mode of MODES) {
      const steps = tourSteps('full', context(mode, true));
      for (const id of ['plot', 'legend', 'other'] as const) {
        expect(step(steps, id).description, `${id} on ${mode}`).not.toMatch(
          /click|hover|mouse wheel/i,
        );
      }
      expect(step(steps, 'legend').description).toContain('double-tap');
    }
    const phoneNew = tourSteps('whats-new', context('phone', true));
    expect(step(phoneNew, 'legend').description).toContain('double-tap');
    expect(step(phoneNew, 'legend').description).not.toMatch(/click|hover|mouse wheel/i);
  });

  it('talks mouse on a fine pointer', () => {
    const steps = tourSteps('full', context('desktop'));
    expect(step(steps, 'plot').description).toMatch(/mouse wheel/i);
    expect(step(steps, 'legend').description).toMatch(/double-click/i);
  });

  it('writes the modifier as the keyboard shows it', () => {
    const text = (mac: boolean) =>
      tourSteps('full', context('desktop', false, mac))
        .map((spec) => spec.description)
        .join('\n');
    expect(text(true)).toContain('⌘');
    expect(text(true)).not.toContain('Ctrl');
    expect(text(false)).toContain('Ctrl');
    expect(text(false)).not.toContain('⌘');
  });

  it('targets only the data-driver-id values the shell keeps, each id once per list', () => {
    for (const kind of KINDS) {
      for (const mode of MODES) {
        for (const coarse of [false, true]) {
          const steps = tourSteps(kind, context(mode, coarse));
          for (const spec of steps) {
            const selectors = [
              ...(spec.target === null
                ? []
                : typeof spec.target === 'string'
                  ? [spec.target]
                  : [spec.target.host, spec.target.inner]),
              ...(spec.spotlight ? [spec.spotlight] : []),
            ];
            for (const selector of selectors) {
              expect(DRIVER_IDS, `${spec.id}: ${selector}`).toContain(driverId(selector));
            }
          }
          const ids = steps.map((spec) => spec.id);
          expect(new Set(ids).size, `${kind} on ${mode}`).toBe(ids.length);
        }
      }
    }
  });

  it('points the Other step into the legend shadow root', () => {
    expect(step(tourSteps('full', context('desktop')), 'other').target).toEqual({
      host: '[data-driver-id="legend"]',
      inner: '[data-driver-id="other-row"]',
    });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/tour-steps.test.ts`
Expected: FAIL, the suite cannot load: `./tour-steps` does not exist and `TourKind` is not exported by `./storage-key` (vitest reports the missing module; the type import alone would only fail `tsc`).

- [ ] **Step 3: Add `TourKind` to the leaf module**

In `apps/web/src/tour/storage-key.ts`, append after the `TOUR_STORAGE_KEY` export (the key itself changes in Task 7.7, not here):

```ts

/** Which tour a visitor was shown: the full tour or the short "What's new" tour (Task 7.7). */
export type TourKind = 'full' | 'whats-new';
```

- [ ] **Step 4: Write `tour-steps.ts`**

Create `apps/web/src/tour/tour-steps.ts`:

```ts
/**
 * The product tour's steps as data: the full tour and the short "What's new" tour, for each layout
 * mode, pointer type and keyboard (design decisions 1, 16 and 17; the Migration Plan). No driver.js
 * here: `product-tour.ts` maps these specs to driver.js steps when a tour starts, so every list is
 * unit-tested in node. Targets are `data-driver-id` hosts in the light DOM; the Other row is the
 * one target inside a shadow root.
 */
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import type { TourKind } from './storage-key';

/** What the steps depend on, read when a tour starts. */
export interface TourContext {
  mode: LayoutMode;
  /** `(pointer: coarse)`: touch words, no keyboard shortcuts. */
  coarse: boolean;
  /** ⌘ on Mac and iOS, Ctrl elsewhere. */
  mac: boolean;
}

type TourStepId =
  | 'welcome'
  | 'whats-new'
  | 'data'
  | 'dataset'
  | 'view-bar'
  | 'more'
  | 'search'
  | 'plot'
  | 'selection'
  | 'legend'
  | 'other'
  | 'sidebar'
  | 'theme'
  | 'finish'
  | 'end';

export interface TourStepSpec {
  id: TourStepId;
  title: string;
  /** HTML, set as the popover's description. */
  description: string;
  /** A light-DOM selector, an element inside a host's shadow root, or null for a centred step. */
  target: string | { host: string; inner: string } | null;
  /** On a centred step: the control lifted above the overlay, where the tour can be found again. */
  spotlight?: string;
}

const driverId = (name: string): string => `[data-driver-id="${name}"]`;

const EXTERNAL_ICON =
  '<svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

const link = (href: string, text: string): string =>
  `<a href="${href}" target="_blank" rel="noopener">${text}${EXTERNAL_ICON}</a>`;

/** ⌘K on a Mac, Ctrl+K elsewhere, as a key cap. */
const chord = (ctx: TourContext, key: string): string =>
  ctx.mac ? `<kbd><span class="mod-key">⌘</span>${key}</kbd>` : `<kbd>Ctrl+${key}</kbd>`;

/** The modifier alone, for "hold it and click". */
const modifier = (ctx: TourContext): string =>
  ctx.mac ? '<kbd><span class="mod-key">⌘</span></kbd>' : '<kbd>Ctrl</kbd>';

const shift = (ctx: TourContext): string => (ctx.mac ? '<kbd>⇧</kbd>' : '<kbd>Shift</kbd>');

/** "Click" on a mouse, "Tap" on a touch screen. */
const press = (ctx: TourContext): string => (ctx.coarse ? 'Tap' : 'Click');

/** Where Take the tour lives: Help, or More → Help & shortcuts on a phone. */
const tourHome = (ctx: TourContext): string =>
  hasStructureSheet(ctx.mode)
    ? '<strong>More</strong> → <strong>Help &amp; shortcuts</strong> → <strong>Take the tour</strong>'
    : '<strong>Help</strong> → <strong>Take the tour</strong>';

const homeSpotlight = (ctx: TourContext): string =>
  driverId(hasStructureSheet(ctx.mode) ? 'more' : 'help');

type StepBuilder = (ctx: TourContext, kind: TourKind) => TourStepSpec;

const STEPS: Record<TourStepId, StepBuilder> = {
  welcome: (ctx) => ({
    id: 'welcome',
    title: 'Welcome to ProtSpace',
    description: `This short tour shows the main parts of the workbench. Skip it if you like: ${tourHome(ctx)} plays it again any time.`,
    target: null,
    spotlight: homeSpotlight(ctx),
  }),

  'whats-new': (ctx) => ({
    id: 'whats-new',
    title: "What's new in ProtSpace",
    description: `ProtSpace has a new layout. This tour shows what moved and what is new in a few steps; <strong>Full tour</strong> shows everything instead, and ${tourHome(ctx)} plays it later.`,
    target: null,
    spotlight: homeSpotlight(ctx),
  }),

  data: (ctx) => ({
    id: 'data',
    title: 'Import & Export',
    description: `${press(ctx)} the <strong>dataset name</strong> or <strong>Import</strong> to load one of the <strong>examples</strong>, reopen your <strong>last file</strong>, or choose <strong>Open a file…</strong>. You can also drop a file anywhere on the page. A <code>.parquetbundle</code> loads entirely in your browser; a <code>.fasta</code> is sent to our server to be embedded first. <strong>Export</strong> holds the <strong>Figure editor</strong>, a quick PNG or PDF, the protein IDs and the <code>.parquetbundle</code>. ${link('/docs/guide/data-preparation', 'Learn how to prepare your data')}.`,
    target: driverId('data-actions'),
  }),

  dataset: (ctx) => ({
    id: 'dataset',
    title: 'Your Data',
    description: `${press(ctx)} the <strong>dataset name</strong> to load one of the <strong>examples</strong>, reopen your <strong>last file</strong>, or choose <strong>Open a file…</strong>. A <code>.parquetbundle</code> loads entirely on your device; a <code>.fasta</code> is sent to our server to be embedded first.`,
    target: driverId('dataset'),
  }),

  'view-bar': (ctx, kind) => ({
    id: 'view-bar',
    title: 'The View Bar',
    description: hasStructureSheet(ctx.mode)
      ? kind === 'whats-new'
        ? 'The view bar replaces the control bar. <strong>Projection</strong> picks the 2D map and <strong>Color by</strong> the annotation that colours the points; everything else is in <strong>More</strong>.'
        : '<strong>Projection</strong> picks the 2D map (UMAP, PCA and others) and <strong>Color by</strong> the annotation that colours the points. Everything else is in <strong>More</strong>.'
      : kind === 'whats-new'
        ? 'The view bar replaces the control bar: <strong>Projection</strong> (with its details beside it), <strong>Color by</strong>, <strong>Contours</strong> and <strong>Filter</strong> sit here. In a narrow window, what does not fit moves into <strong>More</strong>.'
        : '<strong>Projection</strong> picks the 2D map (UMAP, PCA and others); the button beside it shows how the map was made and how well it keeps neighbours. <strong>Color by</strong> picks the annotation that colours the points, <strong>Contours</strong> draws density rings for each colour, and <strong>Filter</strong> opens the Filter panel in the sidebar. In a narrow window, what does not fit moves into <strong>More</strong>.',
    target: driverId('view-bar'),
  }),

  more: () => ({
    id: 'more',
    title: 'More Options',
    description:
      '<strong>More</strong> holds <strong>Contours</strong>, <strong>Filter</strong>, <strong>Import</strong>, <strong>Export</strong>, the <strong>Theme</strong> (System, Light or Dark), <strong>Help &amp; shortcuts</strong> and <strong>Feedback</strong>. A dot on the button means contours or a filter are on.',
    target: driverId('more'),
  }),

  search: (ctx) => ({
    id: 'search',
    title: 'Search Proteins',
    description: hasStructureSheet(ctx.mode)
      ? `${press(ctx)} the search button to search over the app bar. Type a protein ID to find it, or <strong>paste</strong> a list of IDs to select them all at once; a message says how many were found and which were not.`
      : `${ctx.coarse ? 'Tap here' : `Press ${chord(ctx, 'K')} or click here`} to search. Type a protein ID to find it, or <strong>paste</strong> a list of IDs to select them all at once; a message says how many were found and which were not.`,
    target: driverId(hasStructureSheet(ctx.mode) ? 'search-toggle' : 'search'),
  }),

  plot: (ctx) => ({
    id: 'plot',
    title: 'Interactive Scatterplot',
    description: ctx.coarse
      ? 'Each point is a protein. <strong>Tap</strong> a point to select it and see its details and its 3D structure (when there is one). <strong>Drag</strong> to pan and <strong>pinch</strong> to zoom. Both axes share one scale, so distances read the same in every direction.'
      : `Each point is a protein. <strong>Hover</strong> a point for its details, <strong>drag</strong> to pan and zoom with the mouse wheel. <strong>Click</strong> a point to select it and see its 3D structure (when there is one); hold ${modifier(ctx)} and click to add a point to the selection or take it out. Both axes share one scale, so distances read the same in every direction.`,
    target: driverId('scatterplot'),
  }),

  selection: (ctx, kind) => {
    const undo = ctx.coarse
      ? ''
      : ` ${chord(ctx, 'Z')} undoes the last step (add ${shift(ctx)} to redo).`;
    return {
      id: 'selection',
      title: 'Selection Tools',
      description:
        kind === 'whats-new'
          ? `The selection tools now sit on the plot. A selection opens a bar with <strong>Show only these</strong>, <strong>Zoom to them</strong>, <strong>Copy IDs</strong> and <strong>Clear</strong>; chips in the corner say what is hidden, and their ✕ shows it again.${undo}`
          : `<strong>Box select</strong> and <strong>Lasso select</strong> select the points you drag around; <strong>Move and zoom</strong> pans again and <strong>Fit to view</strong> shows every point. With a selection, the bar at the bottom of the plot offers <strong>Show only these</strong>, <strong>Zoom to them</strong>, <strong>Copy IDs</strong> and <strong>Clear</strong>. Chips in the corner say what is hidden; their ✕ shows it again.${undo}`,
      target: driverId('selection'),
    };
  },

  legend: (ctx) => ({
    id: 'legend',
    title: 'Legend Panel',
    description: ctx.coarse
      ? `<strong>Tap</strong> a row to hide or show its category, <strong>double-tap</strong> to show only that one. A row's <strong>⋯</strong> offers <em>Show only this</em> and <em>Colour and shape</em>; hold its handle and drag to reorder (higher rows are drawn on top).${hasStructureSheet(ctx.mode) ? ' The panel folds down to its header to give the plot more room.' : ''}`
      : '<strong>Click</strong> a row to hide or show its category, <strong>double-click</strong> to show only that one. Hover a row for its eye, its drag handle (higher rows are drawn on top) and <strong>⋯</strong> (<em>Show only this</em>, <em>Colour and shape</em>). Drag a category onto <strong>Other</strong> to merge it. The sort button in the header orders the rows; the sliders button opens <strong>Legend settings</strong>.',
    target: driverId('legend'),
  }),

  other: (ctx) => ({
    id: 'other',
    title: 'Expand Hidden Categories',
    description: `When an annotation has many values, the least frequent are grouped into <strong>Other</strong>. ${press(ctx)} <strong>View</strong> to list them, search them and add any back to the legend.`,
    target: { host: driverId('legend'), inner: driverId('other-row') },
  }),

  sidebar: (_ctx, kind) => ({
    id: 'sidebar',
    title: 'The Sidebar',
    description:
      kind === 'whats-new'
        ? '<strong>Legend</strong>, <strong>Structure</strong> and <strong>Filter</strong> are now panels of the sidebar. Collapse it from this rail, drag its left edge to resize it, and pop the structure out to float it over the plot.'
        : 'The rail switches the sidebar between <strong>Legend</strong>, <strong>Structure</strong> (a dot shows when a protein is loaded) and <strong>Filter</strong>, and collapses the sidebar to give the plot the whole width. Drag the sidebar\'s left edge to resize it, and pop the structure out to float it over the plot.',
    target: driverId('rail'),
  }),

  theme: (_ctx, kind) => ({
    id: 'theme',
    title: 'Light or Dark',
    description:
      kind === 'whats-new'
        ? 'ProtSpace now has a dark theme. <strong>System</strong> follows your device; <strong>Light</strong> and <strong>Dark</strong> stay as you set them. Exports and figures stay light.'
        : '<strong>System</strong> follows your device; <strong>Light</strong> and <strong>Dark</strong> stay as you set them. The plot and the structure follow the theme; exports and figures are always light.',
    target: driverId('theme'),
  }),

  finish: (ctx) => ({
    id: 'finish',
    title: "You're All Set!",
    description: `You know the essentials. ${hasStructureSheet(ctx.mode) ? '<strong>More</strong> → <strong>Help &amp; shortcuts</strong>' : '<strong>Help</strong>'} has the keyboard shortcuts and plays this tour again. For more, read the ${link('/docs/', 'documentation')}. Happy exploring!`,
    target: null,
  }),

  end: (ctx) => ({
    id: 'end',
    title: "That's it",
    description: `That is what changed. For the whole tour, open ${tourHome(ctx)}.`,
    target: null,
  }),
};

/** Steps shown only at desktop widths, where the rail is. */
const desktopOnly = (mode: LayoutMode, ids: TourStepId[]): TourStepId[] =>
  mode === 'desktop' ? ids : [];

function stepIds(kind: TourKind, mode: LayoutMode): TourStepId[] {
  if (hasStructureSheet(mode)) {
    return kind === 'full'
      ? ['welcome', 'dataset', 'view-bar', 'more', 'search', 'plot', 'selection', 'legend', 'other', 'finish']
      : ['whats-new', 'view-bar', 'more', 'legend', 'selection', 'end'];
  }
  return kind === 'full'
    ? [
        'welcome',
        'data',
        'view-bar',
        'search',
        'plot',
        'selection',
        'legend',
        'other',
        ...desktopOnly(mode, ['sidebar']),
        'theme',
        'finish',
      ]
    : ['whats-new', 'view-bar', ...desktopOnly(mode, ['sidebar']), 'selection', 'theme', 'end'];
}

/** The steps of `kind` for the window `ctx` describes, in order. */
export function tourSteps(kind: TourKind, ctx: TourContext): TourStepSpec[] {
  return stepIds(kind, ctx.mode).map((id) => STEPS[id](ctx, kind));
}
```

Notes for the implementer:

- `hasStructureSheet` is the one "phone, upright or on its side" predicate (decision 18: one way to do each job); do not add a second.
- The coarse texts are the only place the words "tap", "double-tap" and "pinch" appear; a coarse desktop (a touch laptop) also gets them, by design.
- Run `pnpm exec prettier --write apps/web/src/tour/tour-steps.ts apps/web/src/tour/tour-steps.test.ts` after writing; it may wrap the long id arrays differently, which is fine.

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/tour-steps.test.ts`
Expected: PASS, 16 tests (8 from the `it.each`, 8 more). If "talks touch" fails, the failing description contains one of the banned words: reword that text, never the test.

- [ ] **Step 6: Give the new targets their `data-driver-id`**

Each edit adds one attribute; nothing else in these components changes.

`apps/web/src/workbench/ViewBar.tsx`, in `ViewBar`'s returned root `div`:

```tsx
    <div ref={bar} role="group" aria-label="View" data-workbench="view-bar" data-stage={stage}>
```

becomes

```tsx
    <div
      ref={bar}
      role="group"
      aria-label="View"
      data-workbench="view-bar"
      data-driver-id="view-bar"
      data-stage={stage}
    >
```

`apps/web/src/workbench/AppBar.tsx`, the dataset `button` (`className="wb-dataset"`): after the line `data-workbench="dataset"` add

```tsx
          data-driver-id="dataset"
```

`apps/web/src/workbench/Rail.tsx`, in `Rail`'s returned `nav`:

```tsx
    <nav className="wb-rail" data-workbench="rail" aria-label="Panels">
```

becomes

```tsx
    <nav className="wb-rail" data-workbench="rail" data-driver-id="rail" aria-label="Panels">
```

`apps/web/src/workbench/MoreMenu.tsx`, the `ps-button` with `className="wb-more"`: after the line `className="wb-more"` add

```tsx
        data-driver-id="more"
```

`apps/web/src/workbench/SearchToggle.tsx`, the `ps-icon-button` with `className="wb-search-toggle"`: after the line `className="wb-search-toggle"` add

```tsx
      data-driver-id="search-toggle"
```

`custom-elements.d.ts` needs no change: TypeScript accepts hyphenated `data-*` attributes on any JSX element, and `ThemeMenu.tsx` and `HelpMenu.tsx` already put `data-driver-id` on `ps-icon-button`. Change it only if `tsc` below reports an error on one of these lines.

- [ ] **Step 7: Type-check, knip and format**

Run: `pnpm --filter @protspace/app exec tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (The app reads core's `dist`; if it reports missing `@protspace/core` types, run `pnpm --filter @protspace/core build` first.)

Run: `pnpm knip`
Expected: no findings. `tourSteps`, `TourContext` and `TourStepSpec` are imported by `tour-steps.test.ts`; `TourKind` by `tour-steps.ts`.

Run: `pnpm exec prettier --check apps/web/src/tour apps/web/src/workbench/ViewBar.tsx apps/web/src/workbench/AppBar.tsx apps/web/src/workbench/Rail.tsx apps/web/src/workbench/MoreMenu.tsx apps/web/src/workbench/SearchToggle.tsx`
Expected: all files pass.

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/`
Expected: PASS (`tour-steps.test.ts`, the unchanged `product-tour.test.ts` and 7.1's `storage-key.test.ts`).

No e2e run here: the attributes change no behaviour. `workbench-view-bar.spec.ts`, `workbench-sidebar.spec.ts` and `mobile-bars.spec.ts` are unrun at task time (the phase exit runs them).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/tour/tour-steps.ts apps/web/src/tour/tour-steps.test.ts apps/web/src/tour/storage-key.ts apps/web/src/workbench/ViewBar.tsx apps/web/src/workbench/AppBar.tsx apps/web/src/workbench/Rail.tsx apps/web/src/workbench/MoreMenu.tsx apps/web/src/workbench/SearchToggle.tsx
git commit -m "feat(web): tour steps for every layout as data"
```

(Sandbox disabled for the commit: the hook needs it.)

### Task 7.7: Tour rewrite: new key, What's new, lazy driver.js

`product-tour.ts` drives the 7.6 steps for the layout at start time, under the new key, with the What's new tour for returning visitors, reduced motion, the one Escape order and a clean dummy anchor. `runtime.ts` and Help load it lazily. Desktop and tablet are proven here; phones in 7.8.

**Files:**

- Modify: `apps/web/src/tour/storage-key.ts` (key, legacy key, `chooseTour`), `storage-key.test.ts`
- Modify: `apps/web/src/tour/product-tour.ts` (rewrite around `startTour`), `product-tour.test.ts`, `product-tour.css` (the "Full tour" button styled as Skip)
- Modify: `apps/web/src/explore/runtime.ts` (:12 static import gone; :704-713 the `data-loaded` start), `apps/web/src/workbench/help-actions.ts`
- Modify: `apps/web/tests/helpers/tour-storage-state.ts` (seen value `'full'`), `helpers/explore.ts` (`dismissTourIfPresent`)
- Modify: `apps/web/tests/product-tour.spec.ts` (rewritten), `workbench-theme.spec.ts` (:381 step-2 title "Import & Export"), `workbench-view-bar.spec.ts` (:137 same), `workbench-a11y.spec.ts` (:144-146 exclusion and comment dropped)
- Modify: `docs/developers/architecture.md` (a short "Tour" paragraph: steps as data, the two keys, lazy load)

**Interfaces:**

- Consumes: `tourSteps`, `TourContext`, `TourStepSpec` (7.6); `TourKind` (7.6); `openPanel(panel)` (`layout-state.ts`: `updateLayout({ sidebarOpen: true, panel, panelFolded: false })`, which writes nothing when the layout already matches), `getLayout`, `updateLayout`, `resetLayoutForTests` (tests), `getLayoutMode`, `subscribeLayoutMode` (`layout-mode.ts`); `isMacOrIos` (`@protspace/utils`); `pushLayer` (`@protspace/core/kit`, the entry the shell already loads in `pages/Explore.tsx:4`; `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void`); `waitForElement` (`wait-for-element.ts`); `seedTourSeen` (7.1); `TOUR_SEEN` (7.1, module-private in `tour-storage-state.ts`, today `{ name: TOUR_STORAGE_KEY, value: 'true' }`); 7.1's `storage-key.test.ts` (the literal guard "no test, helper or capture spells the tour storage key").
- Produces:
  - `storage-key.ts`: `TOUR_STORAGE_KEY = 'protspace:tour:v2'`; `LEGACY_TOUR_STORAGE_KEY = 'driver.overviewTour'`; `chooseTour(read: (key: string) => string | null): TourKind | null` (null when the v2 key holds any value; `'whats-new'` when the legacy value is `'true'`; else `'full'`). Callers wrap `read` in `try`/`catch`; a throwing read means no tour.
  - `product-tour.ts`: `startTour(kind: TourKind, options?: { force?: boolean }): void` (`startProductTour` is removed). Unforced and the v2 key set → nothing. Writes the key as `kind` (in `try`/`catch`). Calls `openPanel('legend')` (sidebar open on the Legend panel, unfolded; nothing written when it already is). Builds `tourSteps(kind, { mode: getLayoutMode(), coarse: matchMedia('(pointer: coarse)').matches, mac: isMacOrIos() })`, drops steps whose target is missing or 0×0, maps the rest to driver.js steps (shadow pairs resolve lazily and are cleaned up on deselect, as `shadowStep` does), and calls `setConfig({ …base, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, steps })` then `drive()`. While running it holds `pushLayer({ close: destroy, elements: [popover], dismissOnOutsidePress: false })` and a `subscribeLayoutMode` listener that destroys the tour; both are released on destroy. The welcome/What's new first step adds "Skip" (`.driver-tour-skip-btn`) and, for What's new, "Full tour" (`.driver-tour-full-btn`: destroys, then `startTour('full', { force: true })`). `spotlight(selector, on)` generalises `spotlightHelp` (glow on the host's inner `button` when it has a shadow root, else on the host). Every popover render strips `aria-haspopup`, `aria-expanded` and `aria-controls` from `#driver-dummy-element`.
  - `runtime.ts`: on the first `data-loaded`, after 800 ms: `const kind = chooseTour(safeRead); if (kind) void import('../tour/product-tour').then((m) => m.startTour(kind))`.
  - `help-actions.ts`: `startTour()` → `import('../tour/product-tour').then((m) => m.startTour('full', { force: true }))`.
  - `tour-storage-state.ts`: `TOUR_SEEN.value = 'full'`.
  - `dismissTourIfPresent`: matches the dialog named "Welcome to ProtSpace" or "What's new in ProtSpace" and clicks "Skip".
  - Implementation details this task fixes (module-private, no interface change): the layout patch is `openPanel('legend')`, which writes nothing when the layout already matches, and the targets are measured two animation frames later, after React has committed it (a collapsed sidebar or the Filter panel would otherwise drop the legend steps); a newer start supersedes one still waiting for those frames; driver.js overwrites `aria-haspopup`/`aria-expanded`/`aria-controls` on each highlighted element and removes them when it moves on, which would strip the dataset button's and More's own `aria-haspopup="dialog"`/`aria-expanded`, so the tour saves each light-DOM target's three attributes when it starts and puts them back after each highlight (on every element but the active one) and when it ends.

**Tests:**

- `storage-key.test.ts`: `chooseTour` → `'full'` with nothing stored; `'whats-new'` with legacy `'true'`; `null` with the v2 key (any value) with and without the legacy key; `'full'` with a legacy value other than `'true'`; the literal guard now also covers `LEGACY_TOUR_STORAGE_KEY`'s value in tests and captures.
- `product-tour.test.ts` (driver.js mocked, `matchMedia` and `localStorage` stubbed): opens a collapsed sidebar, switches `panel` to `'legend'` and unfolds the panel before `drive`; `animate: false` under reduced motion and `true` otherwise; the key is written as the kind; an unforced start with the key set does nothing; a forced start with the key set runs; a throwing `localStorage` starts nothing on the unforced path and throws nothing; a step whose target is absent is dropped; the What's new list is used for `'whats-new'`; (added) the Escape layer does not close on an outside press and closing it ends the tour; (added) a target's own aria attributes come back when the tour ends; a layout-mode change ends the tour and releases its listener; a second start before the first has measured drives once, with the second kind (13 tests).
- `product-tour.spec.ts` (project `product-tour`, empty storage): auto-starts; progress "1 of 11"; forward and back through the desktop titles and targets (each highlighted element is the step's `data-driver-id` host or the Other row); Skip, close and Finish end it; no auto-start on the next visit (key = `'full'`, read via `TOUR_STORAGE_KEY`); Help → Take the tour restarts it; with the Filter panel open, Take the tour shows the legend; a collapsed sidebar opens; the welcome spotlights Help; Escape right after the start leaves no spotlight; Escape during a Help-started tour with a selection keeps the selection; under `reducedMotion: 'reduce'` the body has `driver-simple`, not `driver-fade`; at 800×1000 (tablet) every highlighted target has a box and there is no "The Sidebar" step; `describe('What's new')` seeding only `LEGACY_TOUR_STORAGE_KEY = 'true'`: starts with "What's new in ProtSpace", every step highlights its target, Finish leaves the key `'whats-new'`, a reload starts nothing, "Full tour" switches to "Welcome to ProtSpace" step 1 of 11 and leaves the key `'full'`; seeded with the v2 key, nothing starts.
- Verification: `pnpm --filter @protspace/app exec vitest --run src/tour/`; `PLAYWRIGHT_PORT=8475 pnpm test:e2e product-tour.spec.ts`; `pnpm knip`; the explore chunk no longer contains driver.js, and the tour chunk imports the kit, not all of core (Step 12's greps on the build).
- Unrun at task time: `workbench-theme.spec.ts`, `workbench-view-bar.spec.ts`, `workbench-a11y.spec.ts`, `workbench-help.spec.ts`, `workbench-helpers.spec.ts` (the `seedTourSeen` case), `mobile-bars.spec.ts` (the phone tour stays fixme until 7.8), every spec that calls `dismissTourIfPresent`, the perf suites (seeding changed).

- [ ] **Step 1: Write the failing unit tests**

Edit `apps/web/src/tour/storage-key.test.ts` as 7.1 wrote it (its two tests, "reads the e2e and capture sources" and "is spelled by no test, helper or capture", keep their names).

Replace its import line

```ts
import { TOUR_STORAGE_KEY } from './storage-key';
```

with

```ts
import { chooseTour, LEGACY_TOUR_STORAGE_KEY, TOUR_STORAGE_KEY } from './storage-key';
```

In "is spelled by no test, helper or capture", replace

```ts
    const literal = new RegExp(`['"\`]${escapeRegExp(TOUR_STORAGE_KEY)}['"\`]`);
```

with (both keys: a stale seed of the old key would now start What's new mid-run)

```ts
    const keys = [TOUR_STORAGE_KEY, LEGACY_TOUR_STORAGE_KEY].map(escapeRegExp).join('|');
    const literal = new RegExp(`['"\`](?:${keys})['"\`]`);
```

Append at the end of the file:

```ts

const reader =
  (stored: Record<string, string>) =>
  (key: string): string | null =>
    stored[key] ?? null;

describe('chooseTour', () => {
  it('gives a first visit the full tour', () => {
    expect(chooseTour(reader({}))).toBe('full');
  });

  it("gives a visitor who saw the old tour What's new", () => {
    expect(chooseTour(reader({ [LEGACY_TOUR_STORAGE_KEY]: 'true' }))).toBe('whats-new');
  });

  it.each(['full', 'whats-new', 'anything'])(
    'starts nothing once the tour key holds %s, with or without the old key',
    (value) => {
      expect(chooseTour(reader({ [TOUR_STORAGE_KEY]: value }))).toBeNull();
      expect(
        chooseTour(reader({ [TOUR_STORAGE_KEY]: value, [LEGACY_TOUR_STORAGE_KEY]: 'true' })),
      ).toBeNull();
    },
  );

  it('reads only the value true as a returning visitor', () => {
    expect(chooseTour(reader({ [LEGACY_TOUR_STORAGE_KEY]: 'false' }))).toBe('full');
  });

  it('keeps the old key apart from the new one', () => {
    expect(TOUR_STORAGE_KEY).toBe('protspace:tour:v2');
    expect(LEGACY_TOUR_STORAGE_KEY).not.toBe(TOUR_STORAGE_KEY);
  });
});
```

The `toBe('protspace:tour:v2')` is the one place outside `storage-key.ts` that spells the key: this file is under `src/`, outside the guarded globs.

Replace the contents of `apps/web/src/tour/product-tour.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayout, resetLayoutForTests, updateLayout } from '../explore/layout-state';
import { startTour } from './product-tour';
import { TOUR_STORAGE_KEY } from './storage-key';
import { tourSteps, type TourContext } from './tour-steps';

const driverApi = vi.hoisted(() => ({ drive: vi.fn(), setConfig: vi.fn(), destroy: vi.fn() }));
const layers = vi.hoisted(() => {
  const release = vi.fn();
  return {
    release,
    push: vi.fn((_layer: { close(): void; dismissOnOutsidePress?: boolean }) => release),
  };
});
const mode = vi.hoisted(() => ({ value: 'desktop' as 'desktop' | 'tablet' | 'phone' | 'landscape' }));
const modeListeners = vi.hoisted(() => new Set<() => void>());

vi.mock('driver.js', () => ({
  driver: () => ({
    ...driverApi,
    getActiveIndex: () => 0,
    hasNextStep: () => true,
    hasPreviousStep: () => true,
    moveNext: vi.fn(),
    movePrevious: vi.fn(),
  }),
}));
vi.mock('./product-tour.css', () => ({}));
// The real kit registers Lit elements, which node cannot load.
vi.mock('@protspace/core/kit', () => ({ pushLayer: layers.push }));
vi.mock('@protspace/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@protspace/utils')>()),
  isMacOrIos: () => false,
}));
vi.mock('../explore/layout-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../explore/layout-mode')>()),
  getLayoutMode: () => mode.value,
  subscribeLayoutMode: (listener: () => void) => {
    modeListeners.add(listener);
    return () => modeListeners.delete(listener);
  },
}));

type FakeElement = {
  getBoundingClientRect(): { width: number; height: number };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  shadowRoot: { querySelector(selector: string): FakeElement | null };
};

/** A shown element (or a 0×0 one), with attributes and an optional shadow root's contents. */
function fakeElement(
  size = 10,
  attributes: Record<string, string> = {},
  shadow: Record<string, FakeElement> = {},
): FakeElement {
  const attrs = new Map(Object.entries(attributes));
  return {
    getBoundingClientRect: () => ({ width: size, height: size }),
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    shadowRoot: { querySelector: (selector) => shadow[selector] ?? null },
  };
}

const selector = (id: string) => `[data-driver-id="${id}"]`;
const DESKTOP: TourContext = { mode: 'desktop', coarse: false, mac: false };

const store = new Map<string, string>();
const media = { reduced: false, coarse: false };
let elements = new Map<string, FakeElement>();

/** Every desktop target shown, the Other row inside the legend's shadow root. */
function showDesktopTargets(): void {
  elements = new Map(
    ['data-actions', 'view-bar', 'search', 'scatterplot', 'selection', 'rail', 'theme', 'help'].map(
      (id) => [selector(id), fakeElement()],
    ),
  );
  elements.set(selector('legend'), fakeElement(10, {}, { [selector('other-row')]: fakeElement() }));
}

const lastConfig = () =>
  driverApi.setConfig.mock.calls.at(-1)![0] as {
    animate: boolean;
    steps: Array<{ popover?: { title?: string } }>;
  };
const drivenTitles = () => lastConfig().steps.map((step) => step.popover?.title);
const lastLayer = () => layers.push.mock.calls.at(-1)![0];
const driven = () => vi.waitFor(() => expect(driverApi.drive).toHaveBeenCalledOnce());
/** Long enough for the two stubbed animation frames a start waits for. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  driverApi.drive.mockReset();
  media.reduced = false;
  media.coarse = false;
  mode.value = 'desktop';
  modeListeners.clear();
  showDesktopTargets();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.stubGlobal('document', {
    querySelector: (query: string) => elements.get(query) ?? null,
    getElementById: () => null,
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? media.reduced
        : query === '(pointer: coarse)'
          ? media.coarse
          : false,
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  resetLayoutForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startTour', () => {
  it('opens a collapsed sidebar on the legend, unfolded, before driving', async () => {
    updateLayout({ sidebarOpen: false, panel: 'filter', panelFolded: true });
    let layoutWhenDriven: ReturnType<typeof getLayout> | undefined;
    driverApi.drive.mockImplementation(() => {
      layoutWhenDriven = getLayout();
    });

    startTour('full', { force: true });
    await driven();

    expect(layoutWhenDriven).toMatchObject({
      sidebarOpen: true,
      panel: 'legend',
      panelFolded: false,
    });
  });

  it.each([
    [true, false],
    [false, true],
  ])('under reduced motion %s, animates %s', async (reduced, animate) => {
    media.reduced = reduced;
    startTour('full', { force: true });
    await driven();
    expect(lastConfig().animate).toBe(animate);
  });

  it('writes the kind it starts under the tour key', async () => {
    startTour('whats-new');
    expect(store.get(TOUR_STORAGE_KEY)).toBe('whats-new');
    await driven();
  });

  it('does not start by itself once a tour was recorded', async () => {
    store.set(TOUR_STORAGE_KEY, 'whats-new');
    startTour('full');
    await settle();
    expect(driverApi.drive).not.toHaveBeenCalled();
    expect(store.get(TOUR_STORAGE_KEY)).toBe('whats-new');
  });

  it('starts when forced, whatever was recorded', async () => {
    store.set(TOUR_STORAGE_KEY, 'whats-new');
    startTour('full', { force: true });
    await driven();
    expect(store.get(TOUR_STORAGE_KEY)).toBe('full');
  });

  it('starts nothing and throws nothing when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => startTour('full')).not.toThrow();
    await settle();
    expect(driverApi.drive).not.toHaveBeenCalled();
  });

  it('drops a step whose target is missing or has no box', async () => {
    elements.delete(selector('rail'));
    elements.set(selector('theme'), fakeElement(0));
    startTour('full', { force: true });
    await driven();
    expect(drivenTitles()).toEqual(
      tourSteps('full', DESKTOP)
        .map((step) => step.title)
        .filter((title) => title !== 'The Sidebar' && title !== 'Light or Dark'),
    );
  });

  it("drives the What's new list for whats-new", async () => {
    startTour('whats-new', { force: true });
    await driven();
    expect(drivenTitles()).toEqual(tourSteps('whats-new', DESKTOP).map((step) => step.title));
  });

  it('holds an Escape layer that ignores outside presses; closing it ends the tour', async () => {
    startTour('full', { force: true });
    await driven();
    const layer = lastLayer();
    expect(layer.dismissOnOutsidePress).toBe(false);
    driverApi.destroy.mockClear();
    layers.release.mockClear();

    layer.close();

    expect(driverApi.destroy).toHaveBeenCalledOnce();
    expect(layers.release).toHaveBeenCalledOnce();
  });

  it('gives each target back its own aria state when the tour ends', async () => {
    const actions = fakeElement(10, { 'aria-haspopup': 'dialog' });
    elements.set(selector('data-actions'), actions);
    startTour('full', { force: true });
    await driven();
    // What driver.js does to a highlighted element, and when it moves on.
    actions.setAttribute('aria-expanded', 'true');
    actions.removeAttribute('aria-haspopup');

    lastLayer().close();

    expect(actions.getAttribute('aria-haspopup')).toBe('dialog');
    expect(actions.getAttribute('aria-expanded')).toBeNull();
  });

  it('ends when the layout mode changes, and lets go of its listener', async () => {
    startTour('full', { force: true });
    await driven();
    expect(modeListeners.size).toBe(1);
    driverApi.destroy.mockClear();
    for (const listener of [...modeListeners]) listener();
    expect(driverApi.destroy).toHaveBeenCalledOnce();
    expect(layers.release).toHaveBeenCalled();
    expect(modeListeners.size).toBe(0);
  });

  it('a second start before the first has measured drives once, the second kind', async () => {
    startTour('full', { force: true });
    startTour('whats-new', { force: true });
    await driven();
    await settle();
    expect(driverApi.drive).toHaveBeenCalledOnce();
    expect(drivenTitles()).toEqual(tourSteps('whats-new', DESKTOP).map((step) => step.title));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/storage-key.test.ts src/tour/product-tour.test.ts`
Expected: FAIL. `storage-key.test.ts`: `chooseTour` and `LEGACY_TOUR_STORAGE_KEY` are not exported (`chooseTour is not a function`), and the key is still `driver.overviewTour`. `product-tour.test.ts`: `startTour` is not exported by `./product-tour` (`startTour is not a function`).

- [ ] **Step 3: The keys and `chooseTour`**

Replace the contents of `apps/web/src/tour/storage-key.ts` (it keeps 7.6's `TourKind`):

```ts
/**
 * The product tour's localStorage keys, and the choice between the full tour, What's new and no
 * tour (the Migration Plan).
 *
 * A leaf module on purpose. `product-tour.ts` imports `driver.js` and its CSS, so a Playwright
 * config cannot import from it; keeping the keys here lets the app that writes them and the
 * harness helper that seeds them share one definition instead of two literals that drift silently
 * — a stale copy in the harness means the tour runs over the measured window with nothing failing.
 */

/** Which tour a visitor was shown: the full tour or the short "What's new" tour. */
export type TourKind = 'full' | 'whats-new';

/** Holds the kind shown, as the bare string (not JSON), written when a tour starts. */
export const TOUR_STORAGE_KEY = 'protspace:tour:v2';

/**
 * The pre-workbench tour's key, `'true'` once seen. Read to spot a returning visitor; never written
 * or removed, so a rollback of this release does not replay the old tour to everyone.
 */
export const LEGACY_TOUR_STORAGE_KEY = 'driver.overviewTour';

/**
 * The tour this visit gets: none once a tour was recorded, What's new for a visitor who saw the old
 * tour, else the full tour. A `read` that throws (blocked storage) must be caught by the caller and
 * means no tour, or the tour would replay on every visit.
 */
export function chooseTour(read: (key: string) => string | null): TourKind | null {
  if (read(TOUR_STORAGE_KEY) !== null) return null;
  return read(LEGACY_TOUR_STORAGE_KEY) === 'true' ? 'whats-new' : 'full';
}
```

- [ ] **Step 4: Rewrite `product-tour.ts`**

Replace the contents of `apps/web/src/tour/product-tour.ts`:

```ts
/**
 * The ProtSpace product tour (design decisions 1, 11, 16 and 17; the Migration Plan). The steps are
 * data (`tour-steps.ts`); this module builds the list for the window when a tour starts, drops a
 * step whose target is not on screen, and drives the rest with driver.js. The runtime and the Help
 * menu import it lazily, so driver.js and its CSS stay out of the explore chunk.
 *
 * The Other row lives in the legend's shadow root: its step uses driver.js's `() => Element` form,
 * resolved when the step activates, and cleans up what `document.querySelectorAll` cannot reach.
 */

import { type Config, driver, type DriveStep, type PopoverDOM, type State } from 'driver.js';
// The kit entry, not '@protspace/core': Help imports this module from the shell, and a value
// import of core there would load all of core early (eslint.config.mjs:81-84). kit.mjs and
// core.mjs share one kit chunk, so there is one layer stack.
import { pushLayer } from '@protspace/core/kit';
import { isMacOrIos } from '@protspace/utils';
import { getLayoutMode, subscribeLayoutMode } from '../explore/layout-mode';
import { openPanel } from '../explore/layout-state';
import './product-tour.css';
import { TOUR_STORAGE_KEY, type TourKind } from './storage-key';
import { tourSteps, type TourStepSpec } from './tour-steps';
import { waitForElement } from './wait-for-element';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const COARSE_POINTER = '(pointer: coarse)';
/** The attributes driver.js sets on a highlighted element and removes when it moves on. */
const ARIA_STATE = ['aria-haspopup', 'aria-expanded', 'aria-controls'] as const;

const driverObj = driver();

/** What a running tour holds: its Escape layer and its layout-mode listener. */
let running: { release: () => void; unsubscribe: () => void } | null = null;
/** The control the first step lifted above the overlay, until that step is left. */
let spotlit: string | null = null;
/** Each light-DOM target's own aria state, put back when driver.js leaves it. */
let savedAria: Array<{ element: Element; values: Array<string | null> }> = [];
/** Bumped by every start: a start superseded while its layout settles never drives. */
let startCount = 0;

// ---------------------------------------------------------------------------
// Shadow DOM
// ---------------------------------------------------------------------------

/** An element inside a host's shadow root, or undefined (a dropped or centred step). */
function shadowEl(hostSelector: string, innerSelector: string): Element | undefined {
  const host = document.querySelector(hostSelector);
  return host?.shadowRoot?.querySelector(innerSelector) ?? undefined;
}

/** What driver.js cannot remove inside a shadow root after a step is deselected. */
function cleanupShadowElement(element: Element | undefined): void {
  if (!element) return;
  element.classList.remove('driver-active-element', 'driver-no-interaction');
  for (const name of ARIA_STATE) element.removeAttribute(name);
}

// ---------------------------------------------------------------------------
// Spotlight (the first step)
// ---------------------------------------------------------------------------

/**
 * Lifts the control where the tour lives (Help, or More on a phone) above the overlay and outlines
 * it, while the centred first step shows. A kit button glows on its inner `<button>`, so the ring
 * follows its rounded shape; a plain element glows itself. Lifting the host works because the bars
 * create no stacking context.
 */
function setSpotlight(selector: string, on: boolean): void {
  const host = document.querySelector<HTMLElement>(selector);
  if (!host) return;
  const glow = host.shadowRoot?.querySelector<HTMLElement>('button') ?? host;
  if (on) {
    // Above the driver.js overlay (z-index ~100000); the focus token follows the theme.
    host.style.zIndex = '100001';
    glow.style.boxShadow = '0 0 0 3px var(--ps-focus)';
    glow.style.transition = 'box-shadow 0.3s ease';
  } else {
    host.style.removeProperty('z-index');
    glow.style.removeProperty('box-shadow');
    glow.style.removeProperty('transition');
  }
}

function clearSpotlight(): void {
  if (spotlit !== null) setSpotlight(spotlit, false);
  spotlit = null;
}

// ---------------------------------------------------------------------------
// Aria state
// ---------------------------------------------------------------------------

function saveAria(steps: readonly TourStepSpec[]): void {
  savedAria = steps.flatMap((step) => {
    if (typeof step.target !== 'string') return [];
    const element = document.querySelector(step.target);
    return element ? [{ element, values: ARIA_STATE.map((name) => element.getAttribute(name)) }] : [];
  });
}

/** Puts back every saved target's own attributes, except on the element highlighted now. */
function restoreAria(active?: Element): void {
  for (const { element, values } of savedAria) {
    if (element === active) continue;
    ARIA_STATE.forEach((name, index) => {
      const value = values[index];
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    });
  }
}

/**
 * driver.js anchors a centred step to its own invisible 0×0 `#driver-dummy-element` and marks it as
 * a popup button, which a plain `<div>` may not be (axe aria-allowed-attr).
 */
function stripDummyAria(): void {
  const dummy = document.getElementById('driver-dummy-element');
  for (const name of ARIA_STATE) dummy?.removeAttribute(name);
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

/** Every way out: Skip, Finish, the close button, the overlay, Escape and a layout change. */
function endTour(): void {
  clearSpotlight();
  running?.release();
  running?.unsubscribe();
  running = null;
  driverObj.destroy();
  restoreAria();
  savedAria = [];
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const moveNext = async (driverOpts: { config: Config; state: State }) => {
  if (driverObj.hasNextStep() && driverOpts.config.steps) {
    const stepIndex = driverObj.getActiveIndex() ?? 0;
    const nextStep = driverOpts.config.steps[stepIndex + 1];

    if (nextStep && typeof nextStep.element === 'string') {
      await waitForElement(nextStep.element).catch(() => {
        /* element may already be visible – continue anyway */
      });
    }

    driverObj.moveNext();
  }
};

const movePrevious = async (driverOpts: { config: Config; state: State }) => {
  if (driverObj.hasPreviousStep() && driverOpts.config.steps) {
    const stepIndex = driverObj.getActiveIndex() ?? 0;
    const previousStep = driverOpts.config.steps[stepIndex - 1];

    if (previousStep && typeof previousStep.element === 'string') {
      await waitForElement(previousStep.element).catch(() => {
        /* continue anyway */
      });
    }
  }

  driverObj.movePrevious();
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const onPopoverRender = (popover: PopoverDOM): void => {
  // driver.js marks the dummy anchor right after this hook returns, on the first step.
  queueMicrotask(stripDummyAria);
  setTimeout(() => {
    popover.wrapper.addEventListener('click', (event) => event.stopPropagation());
    // Keep the close button from being focused automatically.
    popover.closeButton?.blur();
  }, 5);
};

function footerButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

/** A step when it is on screen now: centred, or a target with a box. */
function isShown(target: TourStepSpec['target']): boolean {
  if (target === null) return true;
  const element =
    typeof target === 'string' ? document.querySelector(target) : shadowEl(target.host, target.inner);
  if (!element) return false;
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function toDriveStep(spec: TourStepSpec, index: number, count: number, kind: TourKind): DriveStep {
  const last = index === count - 1;
  const popover: NonNullable<DriveStep['popover']> = {
    title: spec.title,
    description: spec.description,
    onPrevClick: async (_element, _step, options) => movePrevious(options),
    onNextClick: last
      ? () => endTour()
      : async (_element, _step, options) => {
          // driver.js skips onDeselected when a step is left during its highlight transition, so
          // Next clears the first step's spotlight itself; endTour covers every other way out.
          clearSpotlight();
          await moveNext(options);
        },
  };

  if (index === 0) {
    popover.showButtons = ['close', 'next'];
    popover.nextBtnText = 'Start Tour';
    popover.onPopoverRender = (dom) => {
      onPopoverRender(dom);
      dom.nextButton.insertAdjacentElement(
        'beforebegin',
        footerButton('Skip', 'driver-tour-skip-btn', endTour),
      );
      if (kind === 'whats-new') {
        dom.nextButton.insertAdjacentElement(
          'beforebegin',
          footerButton('Full tour', 'driver-tour-full-btn', () => {
            endTour();
            startTour('full', { force: true });
          }),
        );
      }
      if (spec.spotlight) {
        setSpotlight(spec.spotlight, true);
        spotlit = spec.spotlight;
      }
    };
  }
  if (last) {
    popover.showButtons = ['close', 'previous', 'next'];
    popover.nextBtnText = 'Finish';
  }

  const step: DriveStep = { popover };
  const { target } = spec;
  if (typeof target === 'string') {
    step.element = target;
  } else if (target) {
    step.element = () => shadowEl(target.host, target.inner) as Element;
    step.onDeselected = () => cleanupShadowElement(shadowEl(target.host, target.inner));
  }
  return step;
}

const BASE_CONFIG: Config = {
  showProgress: true,
  disableActiveInteraction: true,
  // driver.js sets the overlay path's `style.fill` to this string, so a token works; the scrim
  // carries its own alpha (light 0.45, dark 0.65), hence opacity 1.
  overlayColor: 'var(--ps-scrim)',
  overlayOpacity: 1,
  stagePadding: 8,
  stageRadius: 8,

  doneBtnText: 'Finish',
  nextBtnText: 'Next',
  prevBtnText: 'Back',

  onPopoverRender,
  onHighlighted: (element) => {
    stripDummyAria();
    restoreAria(element);
  },
  // Every user close (the close button, an overlay click) comes through here, even during a
  // step's highlight transition, when driver.js skips `onDeselected` and `onDestroyed`.
  onDestroyStarted: () => endTour(),
};

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/** The recorded kind; undefined when storage cannot be read (blocked site data). */
function readSeen(): string | null | undefined {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

function writeSeen(kind: TourKind): boolean {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, kind);
    return true;
  } catch {
    return false;
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function drive(kind: TourKind): void {
  const steps = tourSteps(kind, {
    mode: getLayoutMode(),
    coarse: matchMedia(COARSE_POINTER).matches,
    mac: isMacOrIos(),
  }).filter((step) => isShown(step.target));
  if (steps.length === 0) return;

  saveAria(steps);
  driverObj.setConfig({
    ...BASE_CONFIG,
    animate: !matchMedia(REDUCED_MOTION).matches,
    steps: steps.map((step, index) => toDriveStep(step, index, steps.length, kind)),
  });
  running = {
    // Escape closes the tour and nothing else (decision 11). driver.js closes on keyup, after the
    // page's keydown handlers would already have cleared a selection.
    release: pushLayer({
      close: endTour,
      get elements() {
        const popover = document.querySelector('.driver-popover');
        return popover ? [popover] : [];
      },
      dismissOnOutsidePress: false,
    }),
    // A step list fits one layout: rotating a phone or resizing across a breakpoint ends the tour.
    unsubscribe: subscribeLayoutMode(endTour),
  };
  driverObj.drive();
}

/**
 * Starts the `kind` tour at its first step. Unforced (the first-visit start), it runs only when no
 * tour was recorded and the record can be written, so blocked storage never replays it; forced
 * (Help → Take the tour, the Full tour button) it always runs. The key is written as the kind when
 * the tour starts, so closing it early counts as seen.
 */
export function startTour(kind: TourKind, options: { force?: boolean } = {}): void {
  if (!options.force && readSeen() !== null) return;
  if (!writeSeen(kind) && !options.force) return;
  if (running) endTour();

  // The legend steps need the legend on screen: the sidebar open on the Legend panel, a phone's
  // panel unfolded. openPanel writes nothing when they already are.
  openPanel('legend');
  const start = ++startCount;
  // React commits that layout on its next render: measure the targets two frames later.
  void nextFrame()
    .then(() => nextFrame())
    .then(() => {
      if (start === startCount) drive(kind);
    });
}
```

Notes for the implementer:

- `startProductTour` and `ProductTourOptions` are gone; `help-actions.ts` (Step 6) is their only other caller. `getLayout` and `updateLayout` are no longer imported here; `openPanel` is.
- If `tsc` rejects the `get elements()` getter in the `pushLayer` argument, keep it: `Layer.elements` is `readonly Element[]`, which a getter satisfies. Report it if your TypeScript version disagrees, and fall back to `elements: []` (with `dismissOnOutsidePress: false` the stack never reads it).

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/`
Expected: PASS: `storage-key.test.ts` 9 tests (7.1's two, then 7 `chooseTour` cases counting the 3-way `it.each`), `product-tour.test.ts` 13, `tour-steps.test.ts` 16. If the literal guard fails, it names the file still spelling a key: replace the literal with the imported constant (the seeds were all moved to `TOUR_STORAGE_KEY` in 7.1).

- [ ] **Step 6: Lazy loads from the runtime and Help**

In `apps/web/src/explore/runtime.ts`, replace the import line

```ts
import { startProductTour } from '../tour/product-tour';
```

with

```ts
import { chooseTour, type TourKind } from '../tour/storage-key';
```

After the `addTrackedEventListener` function (right before `export async function initializeExploreRuntime`), add:

```ts
/**
 * The tour this visit gets on its first load. Storage that cannot be read starts none: with no
 * record to write, the tour would replay on every visit.
 */
function firstVisitTour(): TourKind | null {
  try {
    return chooseTour((key) => localStorage.getItem(key));
  } catch {
    return null;
  }
}
```

Replace the `data-loaded` listener that starts the tour (today :704-713):

```ts
  addTrackedEventListener(
    lifecycle,
    dataLoader,
    'data-loaded',
    () => {
      lifecycle.scheduleTimeout(() => {
        startProductTour();
      }, 800);
    },
    { once: true },
  );
```

with

```ts
  addTrackedEventListener(
    lifecycle,
    dataLoader,
    'data-loaded',
    () => {
      lifecycle.scheduleTimeout(() => {
        const kind = firstVisitTour();
        // driver.js and its CSS load only when a tour runs, so they stay out of the explore chunk.
        if (kind) void import('../tour/product-tour').then((tour) => tour.startTour(kind));
      }, 800);
    },
    { once: true },
  );
```

In `apps/web/src/workbench/help-actions.ts`, replace `startTour`:

```ts
/** Starts the product tour from its first step; its code loads on first use. */
export function startTour(): void {
  void import('../tour/product-tour').then(({ startProductTour }) =>
    startProductTour({ force: true }),
  );
}
```

with

```ts
/** Starts the full product tour from its first step; its code loads on first use. */
export function startTour(): void {
  void import('../tour/product-tour').then((tour) => tour.startTour('full', { force: true }));
}
```

- [ ] **Step 7: The "Full tour" button looks like Skip**

In `apps/web/src/tour/product-tour.css`, the focus rule

```css
.driver-popover-footer .driver-popover-prev-btn:focus-visible,
.driver-popover-footer .driver-popover-next-btn:focus-visible,
.driver-popover-footer .driver-popover-close-btn-text:focus-visible,
.driver-popover-footer .driver-tour-skip-btn:focus-visible {
```

becomes

```css
.driver-popover-footer .driver-popover-prev-btn:focus-visible,
.driver-popover-footer .driver-popover-next-btn:focus-visible,
.driver-popover-footer .driver-popover-close-btn-text:focus-visible,
.driver-popover-footer .driver-tour-skip-btn:focus-visible,
.driver-popover-footer .driver-tour-full-btn:focus-visible {
```

and the Skip section at the end of the file

```css
/* ── Skip button (ghost, first step only) ─────────────────── */

.driver-popover-footer .driver-tour-skip-btn,
.driver-popover-footer .driver-tour-skip-btn:focus {
```

…

```css
.driver-popover-footer .driver-tour-skip-btn:hover {
  background: none;
  color: var(--ps-text);
}
```

becomes (same declarations, both buttons):

```css
/* ── Skip and Full tour (ghost, first step only) ──────────── */

.driver-popover-footer .driver-tour-skip-btn,
.driver-popover-footer .driver-tour-skip-btn:focus,
.driver-popover-footer .driver-tour-full-btn,
.driver-popover-footer .driver-tour-full-btn:focus {
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

.driver-popover-footer .driver-tour-skip-btn:hover,
.driver-popover-footer .driver-tour-full-btn:hover {
  background: none;
  color: var(--ps-text);
}
```

- [ ] **Step 8: Test helpers seed and dismiss the new tour**

In `apps/web/tests/helpers/tour-storage-state.ts` (as 7.1 left it), replace

```ts
const TOUR_SEEN: { name: string; value: string } = { name: TOUR_STORAGE_KEY, value: 'true' };
```

with

```ts
const TOUR_SEEN: { name: string; value: string } = {
  name: TOUR_STORAGE_KEY,
  value: 'full' satisfies TourKind,
};
```

and its import `import { TOUR_STORAGE_KEY } from '../../src/tour/storage-key';` with `import { TOUR_STORAGE_KEY, type TourKind } from '../../src/tour/storage-key';`. 7.1's "seedTourSeen keeps the tour from starting" (`workbench-helpers.spec.ts`) compares the stored value with the one `exploreStorageState` seeds, not a literal, so it needs no change.

In `apps/web/tests/helpers/explore.ts`, replace the function `dismissTourIfPresent` (whole body, as 7.1 left it) with:

```ts
/** The first step of either tour; driver.js names its popover dialog after the step's title. */
const TOUR_FIRST_STEP = /^(Welcome to ProtSpace|What's new in ProtSpace)$/;

export async function dismissTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole('dialog', { name: TOUR_FIRST_STEP });
  const skipButton = page.locator('.driver-tour-skip-btn');

  if (await tourDialog.isVisible()) {
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
    } else {
      await page.locator('.driver-popover-close-btn').click();
    }
    await expect(tourDialog).toBeHidden();
    return;
  }

  // A first step still rendering: its Skip is already there.
  if ((await skipButton.count()) > 0) {
    await skipButton.click();
    await page.waitForSelector('.driver-popover', { state: 'detached', timeout: 5_000 });
  }
}
```

- [ ] **Step 9: Specs that name the old step 2, and the axe exclusion**

`apps/web/tests/workbench-theme.spec.ts`, in "the tour's popover, its arrow and its overlay are dark in Dark":

```ts
    // The welcome step is centred with no arrow; step 2 points at Import, so its arrow shows. The
    // arrow is a border triangle: only the side named in its class is painted.
    await popover.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import Your Data');
```

becomes

```ts
    // The welcome step is centred with no arrow; step 2 points at Import and Export, so its arrow
    // shows. The arrow is a border triangle: only the side named in its class is painted.
    await popover.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import & Export');
```

`apps/web/tests/workbench-view-bar.spec.ts`, replace the whole test "the tour's projections step highlights the view bar group" with:

```ts
  test("the tour's view bar step highlights the view bar", async ({ page }) => {
    await openExplore(page);
    await appBar(page).getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();

    const title = page.locator('.driver-popover .driver-popover-title');
    await expect(title).toHaveText('Welcome to ProtSpace');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('Import & Export');
    await page.locator('.driver-popover-next-btn').click();
    await expect(title).toHaveText('The View Bar');

    await expect(viewBar(page)).toHaveClass(/driver-active-element/);
  });
```

(`viewBar` is already imported there; the `projections` id stays on the group, which the first test of the file still checks.)

`apps/web/tests/workbench-a11y.spec.ts`, in the entry named `'the first tour step'`, delete these four lines (the tour now strips the dummy's attributes itself):

```ts
    // driver.js 1.4 anchors a step without an element to its own invisible 0×0
    // #driver-dummy-element and sets aria-expanded/aria-haspopup on it, a plain <div> (axe
    // aria-allowed-attr). Follow-up: fix upstream or drop the dummy anchor in the tour rewrite (7.4).
    axe: { exclude: ['#driver-dummy-element'] },
```

- [ ] **Step 10: Rewrite the tour spec**

Replace the contents of `apps/web/tests/product-tour.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { LEGACY_TOUR_STORAGE_KEY, TOUR_STORAGE_KEY } from '../src/tour/storage-key';
import {
  appBar,
  getSelectedProteinIds,
  openFilter,
  waitForExploreDataLoad,
} from './helpers/explore';
import { box } from './helpers/mobile';
import { seedTourSeen } from './helpers/tour-storage-state';
import {
  clickProteinNearPlotCentre,
  collapseSidebar,
  stubStructureRequests,
} from './helpers/workbench';

/**
 * The product tour on a 1280×720 desktop and an 800×1000 tablet (project `product-tour`, empty
 * storage, so the first visit starts it). The phone tours are mobile-bars.spec.ts's.
 */

type Step = { title: string; target: string | null };

/** The full desktop tour: each step's title and the data-driver-id it highlights (null: centred). */
const FULL: readonly Step[] = [
  { title: 'Welcome to ProtSpace', target: null },
  { title: 'Import & Export', target: 'data-actions' },
  { title: 'The View Bar', target: 'view-bar' },
  { title: 'Search Proteins', target: 'search' },
  { title: 'Interactive Scatterplot', target: 'scatterplot' },
  { title: 'Selection Tools', target: 'selection' },
  { title: 'Legend Panel', target: 'legend' },
  { title: 'Expand Hidden Categories', target: 'other-row' },
  { title: 'The Sidebar', target: 'rail' },
  { title: 'Light or Dark', target: 'theme' },
  { title: "You're All Set!", target: null },
];

const WHATS_NEW: readonly Step[] = [
  { title: "What's new in ProtSpace", target: null },
  { title: 'The View Bar', target: 'view-bar' },
  { title: 'The Sidebar', target: 'rail' },
  { title: 'Selection Tools', target: 'selection' },
  { title: 'Light or Dark', target: 'theme' },
  { title: "That's it", target: null },
];

const popover = (page: Page): Locator => page.locator('.driver-popover');
const title = (page: Page): Locator => popover(page).locator('.driver-popover-title');
const progress = (page: Page): Locator => popover(page).locator('.driver-popover-progress-text');
const nextButton = (page: Page): Locator => popover(page).locator('.driver-popover-next-btn');

/** Opens Explore and waits for the tour, which starts 800 ms after the first load. */
async function openWithTour(page: Page): Promise<void> {
  await stubStructureRequests(page);
  await page.goto('/explore');
  await waitForExploreDataLoad(page);
  await expect(popover(page)).toBeVisible({ timeout: 10_000 });
}

async function next(page: Page, expected: string): Promise<void> {
  await nextButton(page).click();
  await expect(title(page)).toHaveText(expected);
}

async function expectHighlighted(page: Page, target: string | null): Promise<void> {
  if (target === null) {
    // A centred step anchors to driver.js's own #driver-dummy-element; nothing else is lit.
    await expect(
      page.locator('.driver-active-element:not(#driver-dummy-element)'),
    ).toHaveCount(0);
    return;
  }
  // CSS locators pierce shadow roots, so this finds the Other row inside the legend too.
  await expect(page.locator(`[data-driver-id="${target}"]`)).toHaveClass(
    /(^|\s)driver-active-element(\s|$)/,
  );
}

/** From the first step to the last, checking each title and highlight; stays on the last. */
async function walk(page: Page, steps: readonly Step[]): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    await expect(title(page)).toHaveText(steps[i].title);
    await expectHighlighted(page, steps[i].target);
    if (i < steps.length - 1) await next(page, steps[i + 1].title);
  }
}

async function skip(page: Page): Promise<void> {
  await popover(page).locator('.driver-tour-skip-btn').click();
  await expect(popover(page)).toHaveCount(0);
}

async function takeTheTour(page: Page): Promise<void> {
  await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(popover(page)).toBeVisible();
}

const storedTour = (page: Page): Promise<string | null> =>
  page.evaluate((key) => localStorage.getItem(key), TOUR_STORAGE_KEY);

/**
 * A tour that stays off leaves no signal: watch for its popover for 2 s after the load, which
 * covers the 800 ms start delay and the lazy load of the tour's code.
 */
async function expectNoTourStarts(page: Page): Promise<void> {
  const started = await popover(page)
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
  expect(started, 'a tour started').toBe(false);
}

/** The pre-workbench tour seen: what a returning visitor's browser holds. */
async function seedLegacyTourSeen(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, 'true');
    } catch {
      // about:blank has no storage.
    }
  }, LEGACY_TOUR_STORAGE_KEY);
}

test.describe('Product Tour', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTour(page);
  });

  test('auto-starts on the first visit with the full tour', async ({ page }) => {
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
    await expect(popover(page).locator('.driver-tour-full-btn')).toHaveCount(0);
  });

  test('walks forward through every desktop step, each on its control', async ({ page }) => {
    await walk(page, FULL);
  });

  test('goes back a step', async ({ page }) => {
    await next(page, FULL[1].title);
    await next(page, FULL[2].title);
    await popover(page).locator('.driver-popover-prev-btn').click();
    await expect(title(page)).toHaveText(FULL[1].title);
  });

  test('Skip on the first step ends it', async ({ page }) => {
    await skip(page);
  });

  test('the close button ends it', async ({ page }) => {
    await next(page, FULL[1].title);
    await popover(page).locator('.driver-popover-close-btn').click();
    await expect(popover(page)).toHaveCount(0);
  });

  test('Finish on the last step ends it', async ({ page }) => {
    await walk(page, FULL);
    await expect(nextButton(page)).toHaveText('Finish');
    await nextButton(page).click();
    await expect(popover(page)).toHaveCount(0);
  });

  test('records the full tour and does not start again', async ({ page }) => {
    await skip(page);
    expect(await storedTour(page)).toBe('full');

    await page.goto('/');
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('Help → Take the tour starts it again', async ({ page }) => {
    await skip(page);
    await takeTheTour(page);
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
  });

  test('starting the tour opens a collapsed sidebar', async ({ page }) => {
    await skip(page);
    await collapseSidebar(page);

    await takeTheTour(page);

    // Its legend steps need the legend on screen.
    await expect(page.locator('.workbench')).toHaveAttribute('data-sidebar', 'open');
    await expect(page.locator('#myLegend')).toBeVisible();
  });

  test('with the Filter panel open, Take the tour shows the legend', async ({ page }) => {
    await skip(page);
    await openFilter(page);
    await expect(page.locator('#myLegend')).toBeHidden();

    await takeTheTour(page);

    await expect(page.locator('#myLegend')).toBeVisible();
    for (const step of FULL.slice(1, 7)) await next(page, step.title);
    await expectHighlighted(page, 'legend');
  });

  test('the welcome step spotlights Help', async ({ page }) => {
    // Lifted above the tour's overlay while the welcome step shows, and put back after it.
    const helpHost = page.locator('[data-driver-id="help"]');
    await expect(helpHost).toHaveCSS('z-index', '100001');
    // Drawn above the overlay: Help is the topmost element at its own centre. driver.js turns off
    // pointer events on the page while a tour runs, and hit testing skips such elements, so Help
    // takes them back for the probe.
    const helpBox = (await helpHost.boundingBox())!;
    expect(
      await page.evaluate(
        ({ x, y }) => {
          const host = document.querySelector<HTMLElement>('[data-driver-id="help"]')!;
          host.style.setProperty('pointer-events', 'auto', 'important');
          const top = document.elementFromPoint(x, y);
          host.style.removeProperty('pointer-events');
          return top?.closest('[data-driver-id="help"]') !== null;
        },
        { x: helpBox.x + helpBox.width / 2, y: helpBox.y + helpBox.height / 2 },
      ),
    ).toBe(true);
    await next(page, FULL[1].title);
    await expect(helpHost).not.toHaveCSS('z-index', '100001');
  });

  test('Escape right after the tour starts leaves no spotlight on Help', async ({ page }) => {
    await skip(page);

    await appBar(page).getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    // Inside the welcome step's 400 ms highlight transition, when driver.js skips onDeselected.
    await page.locator('.driver-tour-skip-btn').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);

    await expect(page.locator('[data-driver-id="help"]')).not.toHaveAttribute('style', /z-index/);
    await expect(page.locator('[data-driver-id="help"] button')).toHaveCSS('box-shadow', 'none');
  });

  test('Escape during a tour started from Help keeps the selection', async ({ page }) => {
    await skip(page);
    const id = await clickProteinNearPlotCentre(page);
    await expect.poll(() => getSelectedProteinIds(page)).toEqual([id]);

    await takeTheTour(page);
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);

    // The tour was the top layer: that Escape closed it and reached nothing else.
    expect(await getSelectedProteinIds(page)).toEqual([id]);
  });
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the tour does not animate', async ({ page }) => {
    await openWithTour(page);
    const body = page.locator('body');
    await expect(body).toHaveClass(/(^|\s)driver-simple(\s|$)/);
    await expect(body).not.toHaveClass(/(^|\s)driver-fade(\s|$)/);
  });
});

test.describe('on a tablet', () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test('every step points at a control on screen, with no Sidebar step', async ({ page }) => {
    await openWithTour(page);
    const expected = FULL.map((step) => step.title).filter((name) => name !== 'The Sidebar');
    await expect(progress(page)).toHaveText(`1 of ${expected.length}`);

    const titles: string[] = [];
    for (let i = 0; i < expected.length + 2; i++) {
      const current = ((await title(page).textContent()) ?? '').trim();
      titles.push(current);
      const lit = page.locator('.driver-active-element:not(#driver-dummy-element)');
      if ((await lit.count()) > 0) {
        const target = await box(lit.first());
        expect(target.width, `step "${current}" highlights a shown control`).toBeGreaterThan(0);
        expect(target.height).toBeGreaterThan(0);
      }
      if (((await nextButton(page).textContent()) ?? '').trim() === 'Finish') break;
      await nextButton(page).click();
      await expect(title(page)).not.toHaveText(current);
    }
    expect(titles).toEqual(expected);
  });
});

test.describe("What's new", () => {
  test.beforeEach(async ({ page }) => {
    await seedLegacyTourSeen(page);
    await openWithTour(page);
  });

  test('a returning visitor gets it once, each step on its control', async ({ page }) => {
    await expect(popover(page).locator('.driver-tour-skip-btn')).toBeVisible();
    await expect(popover(page).locator('.driver-tour-full-btn')).toHaveText('Full tour');
    await expect(progress(page)).toHaveText(`1 of ${WHATS_NEW.length}`);

    await walk(page, WHATS_NEW);
    await expect(nextButton(page)).toHaveText('Finish');
    await nextButton(page).click();
    await expect(popover(page)).toHaveCount(0);
    expect(await storedTour(page)).toBe('whats-new');

    await page.reload();
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('Full tour switches to the full tour', async ({ page }) => {
    await popover(page).locator('.driver-tour-full-btn').click();
    await expect(title(page)).toHaveText('Welcome to ProtSpace');
    await expect(progress(page)).toHaveText(`1 of ${FULL.length}`);
    expect(await storedTour(page)).toBe('full');
  });
});

test.describe('with a tour already recorded', () => {
  test('nothing starts', async ({ page }) => {
    await seedTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });

  test('nothing starts, even with the old key there too', async ({ page }) => {
    await seedTourSeen(page);
    await seedLegacyTourSeen(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    await expectNoTourStarts(page);
  });
});
```

- [ ] **Step 11: The architecture page**

In `docs/developers/architecture.md`, insert after the "## Theme" section (before "## Filter panel"):

```md
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
```

- [ ] **Step 12: Run the tests this task touches**

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/`
Expected: PASS (38 tests: storage-key 9, product-tour 13, tour-steps 16).

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e product-tour.spec.ts`
Expected: PASS, 19 tests in project `product-tour` (13 in "Product Tour", 1 reduced motion, 1 tablet, 2 What's new, 2 recorded). If "every step points at a control on screen" lists a tablet title out of order or missing, a target was 0×0 at start and dropped: report which, do not loosen the test.

Run: `pnpm knip`
Expected: no findings (`chooseTour` has `runtime.ts`; `LEGACY_TOUR_STORAGE_KEY` the tests; `startTour` the lazy imports; `startProductTour` is gone everywhere).

Check that driver.js left the explore chunk:

Run: `pnpm turbo run build --filter=@protspace/app && grep -c 'from"./product-tour-' apps/web/dist/assets/runtime-*.js; ls apps/web/dist/assets/ | grep product-tour`
(If no `runtime-*.js` exists, run `grep -l 'from"./product-tour-' apps/web/dist/assets/*.js` instead and expect no hit: the product-tour chunk is reached only through `import(`.)
Expected: the count is `0` (before this task the runtime chunk held `import{startProductTour as …}from"./product-tour-….js"`), and `product-tour-*.js` and `product-tour-*.css` exist as their own chunks, loaded through `import(` from the runtime and the Explore chunk. Also check that the tour chunk does not pull in all of core: list its static imports with `grep -o 'from"./[^"]*"' apps/web/dist/assets/product-tour-*.js`, then `grep -l "protspace-scatterplot" ` on each named chunk; expect no hit (the kit chunk it imports defines `ps-*` elements only). Quote the grep lines in the report.

Run: `pnpm exec prettier --check apps/web/src/tour apps/web/src/explore/runtime.ts apps/web/src/workbench/help-actions.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/explore.ts apps/web/tests/product-tour.spec.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/workbench-view-bar.spec.ts apps/web/tests/workbench-a11y.spec.ts docs/developers/architecture.md`
Expected: all pass (run `--write` first if not).

Unrun at task time (the phase exit runs them first): `workbench-theme.spec.ts`, `workbench-view-bar.spec.ts`, `workbench-a11y.spec.ts`, `workbench-help.spec.ts`, `workbench-helpers.spec.ts`, `mobile-bars.spec.ts`, every spec calling `dismissTourIfPresent`, and the perf suites (their seeded value is now `'full'` under the new key).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/tour/storage-key.ts apps/web/src/tour/storage-key.test.ts apps/web/src/tour/product-tour.ts apps/web/src/tour/product-tour.test.ts apps/web/src/tour/product-tour.css apps/web/src/explore/runtime.ts apps/web/src/workbench/help-actions.ts apps/web/tests/helpers/tour-storage-state.ts apps/web/tests/helpers/explore.ts apps/web/tests/product-tour.spec.ts apps/web/tests/workbench-theme.spec.ts apps/web/tests/workbench-view-bar.spec.ts apps/web/tests/workbench-a11y.spec.ts docs/developers/architecture.md
git commit -m "feat(web): workbench tour and a What's new tour for return visits"
```

(Sandbox disabled for the commit: the hook needs it.)

### Task 7.8: The tour on phones

The phone and landscape tours from 7.6, made to fit: touch-sized buttons, popovers inside a 360-px screen, and the two phone tour tests fixme'd 'task 7.4' back on, plus What's new on a phone and the dark popover.

**Files:**

- Modify: `apps/web/src/tour/product-tour.css` (`@media (pointer: coarse)`: `.driver-popover-close-btn` and the footer buttons at least `var(--ps-touch-target)` square; `.driver-popover { max-width: min(300px, calc(100vw - 32px)) }`)
- Modify: `apps/web/src/tour/product-tour.ts`, `tour-steps.ts` (only if a phone step needs a side or alignment to stay on screen; say what changed)
- Modify: `apps/web/tests/mobile-bars.spec.ts` (C11/C12 `test.fixme(true, 'task 7.4')` removed; new cases)

**Interfaces:**

- Consumes: `startTour`, the phone lists and coarse wording (7.6, 7.7); `LEGACY_TOUR_STORAGE_KEY` (7.7, `apps/web/src/tour/storage-key.ts`); helpers `box`, `expectWithinViewport`, `moreButton` (`helpers/mobile.ts`), `stubStructureRequests` (`helpers/workbench.ts`), `htmlTheme` (`helpers/theme.ts`), `viewBar`, `waitForExploreDataLoad` (`helpers/explore.ts`), all already imported by `mobile-bars.spec.ts`; the style lint rules for `product-tour.css` (raw colours and reads of `--ps-*` names `theme.ts` does not define fail; `--ps-touch-target` is 40 px, `--ps-space-1` 4 px).
- Produces: no new exports. Behaviour: on a coarse pointer every tour button is at least 40×40 px and every popover stays inside the viewport at 390×664 and 740×360.

**Tests:**

- `mobile-bars.spec.ts` "the product tour on a phone": C11 (390×664) and C12 (740×360) as written (every popover on screen, close ≥ 40×40, a highlighted target has a box, last title "You're All Set!", the legend steps say "double-tap" and never "click"); new: "a returning visitor gets What's new on a phone" (legacy seed: first title "What's new in ProtSpace", six steps, each on screen, More highlighted on the "More Options" step); new: "the tour popover is dark in Dark" (`colorScheme: 'dark'`, theme System: the popover's background equals the resolved `--ps-surface-raised`, not white).
- Verification: `PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-bars.spec.ts --project=mobile -g "product tour"`; `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`.
- Unrun at task time: `mobile-a11y.spec.ts`, the rest of `mobile-bars.spec.ts`.

Notes for the implementer:

- C11/C12 change in one way besides losing the fixme: after each tap on Next the loop waits until the title changes. driver.js animates a step change (the mobile project runs with motion), and without the wait the next iteration can read the old popover and tap Next twice, which drops a title from the list the test asserts. Titles are unique within a list (7.6's test pins that), so "the title changed" is the step-changed signal.
- More is a `ps-button`: its accessible button is inside the shadow root, while driver.js puts `driver-active-element` on the host that carries `data-driver-id="more"`. The new What's new test checks the class on that host and uses `moreButton` for the accessible state 7.7 restores after the tour.
- driver.js keeps a popover on screen by itself when it fits: with no side free it sits centred at the bottom (`driver.js.mjs` `ae()`, the `C` branch). The CSS below makes sure it fits: narrower than the screen, and in a short landscape screen a description that scrolls rather than a popover taller than 360 px. Change `tour-steps.ts` or `product-tour.ts` only if a test still finds a popover off screen after Step 4, and say which step and what changed.

- [ ] **Step 1: Turn the phone tour tests back on, and add the new cases**

In `apps/web/tests/mobile-bars.spec.ts`, add after the `import { DARK_SURFACE, htmlTheme, themeButton } from './helpers/theme';` line:

```ts
import { LEGACY_TOUR_STORAGE_KEY } from '../src/tour/storage-key';
```

In `test.describe('the product tour on a phone', …)`, inside the C11/C12 test body, delete the line

```ts
      test.fixme(true, 'task 7.4');
```

and in its loop replace

```ts
        const next = popover.locator('.driver-popover-next-btn');
        if (/finish|done/i.test(((await next.textContent()) ?? '').trim())) break;
        await next.tap();
      }
```

with

```ts
        const next = popover.locator('.driver-popover-next-btn');
        if (/finish|done/i.test(((await next.textContent()) ?? '').trim())) break;
        await next.tap();
        // driver.js animates the change: read the next step only once its title shows.
        await expect(popover.locator('.driver-popover-title')).not.toHaveText(titles.at(-1)!);
      }
```

Then, still inside `test.describe('the product tour on a phone', …)`, after the closing `}` of the `for (const { label, viewport } of […])` loop, add:

```ts

  test("a returning visitor gets What's new on a phone", async ({ page }) => {
    // The pre-workbench tour seen: what a returning visitor's browser holds.
    await page.addInitScript((key) => {
      try {
        localStorage.setItem(key, 'true');
      } catch {
        // about:blank has no storage.
      }
    }, LEGACY_TOUR_STORAGE_KEY);
    await stubStructureRequests(page);
    await page.goto('/explore');
    await waitForExploreDataLoad(page);

    const popover = page.locator('.driver-popover');
    const title = popover.locator('.driver-popover-title');
    const more = viewBar(page).locator('[data-driver-id="more"]');
    const titles: string[] = [];
    for (let step = 0; step < 10; step++) {
      await expect(popover).toBeVisible({ timeout: 10_000 });
      await expect(async () => {
        await expectWithinViewport(page, popover);
      }).toPass();
      const current = ((await title.textContent()) ?? '').trim();
      titles.push(current);
      if (current === 'More Options') {
        await expect(more).toHaveClass(/(^|\s)driver-active-element(\s|$)/);
      }

      const next = popover.locator('.driver-popover-next-btn');
      if (/finish/i.test(((await next.textContent()) ?? '').trim())) {
        await next.tap();
        break;
      }
      await next.tap();
      await expect(title).not.toHaveText(current);
    }

    expect(titles).toEqual([
      "What's new in ProtSpace",
      'The View Bar',
      'More Options',
      'Legend Panel',
      'Selection Tools',
      "That's it",
    ]);
    await expect(popover).toHaveCount(0);
    // driver.js overwrote More's own popup state while it was lit; the tour put it back.
    await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test.describe('in Dark', () => {
    test.use({ colorScheme: 'dark' });

    test('the tour popover is dark in Dark', async ({ page }) => {
      await stubStructureRequests(page);
      await page.goto('/explore');
      await waitForExploreDataLoad(page);
      const popover = page.locator('.driver-popover');
      await expect(popover).toBeVisible({ timeout: 10_000 });
      // Nothing stored: the theme is System, and the OS is dark.
      expect(await htmlTheme(page)).toBe('system');

      // The token as the page resolves it, painted on a probe.
      const raised = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--ps-surface-raised)';
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      });
      expect(raised).not.toBe('rgb(255, 255, 255)');
      await expect(popover).toHaveCSS('background-color', raised);
    });
  });
```

The checks on `moreButton(page)`'s `aria-expanded`: `ps-button` maps the host's `aria-expanded`/`aria-haspopup` attributes to properties and renders them on its inner `<button>` (`packages/core/src/components/kit/button.ts:24-37`), so after 7.7 restores the host attribute a Lit update carries it to the button `moreButton` resolves, and `toHaveAttribute`'s retries cover that update. It must not be missing.

- [ ] **Step 2: Run them to see them fail**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-bars.spec.ts --project=mobile -g "product tour"`
Expected: FAIL. C11 and C12 fail on `close.width` (driver.css draws the ✕ 32×28 px, under 40); at 740×360 the popover may also leave the screen. "a returning visitor gets What's new on a phone" fails on the same close size only if it checked it; it may pass already (its texts and steps come from 7.6/7.7). "the tour popover is dark in Dark" passes already (6.9 tokenised the popover); it is here to pin that on a phone. Note which fail in the report.

- [ ] **Step 3: Touch sizes and a popover that fits**

In `apps/web/src/tour/product-tour.css`, in the `.driver-popover` rule at the top, replace

```css
  max-width: 380px;
```

with

```css
  max-width: min(380px, calc(100vw - 32px));
```

and append at the end of the file:

```css

/* ── Touch screens (design decision 17) ───────────────────── *
 *
 * Finger-sized close and footer buttons, a popover that leaves a 16 px margin on a 360 px phone,
 * footer buttons that wrap rather than overflow (What's new has Skip, Full tour and Start Tour),
 * and on a short landscape screen a description that scrolls, so the popover stays under 360 px.
 */

@media (pointer: coarse) {
  .driver-popover {
    max-width: min(300px, calc(100vw - 32px));
  }

  .driver-popover .driver-popover-close-btn {
    width: var(--ps-touch-target);
    height: var(--ps-touch-target);
  }

  .driver-popover-footer .driver-popover-navigation-btns {
    flex-wrap: wrap;
    justify-content: flex-end;
    row-gap: var(--ps-space-1);
  }

  .driver-popover-footer .driver-popover-prev-btn,
  .driver-popover-footer .driver-popover-next-btn,
  .driver-popover-footer .driver-tour-skip-btn,
  .driver-popover-footer .driver-tour-full-btn {
    min-width: var(--ps-touch-target);
    min-height: var(--ps-touch-target);
  }
}

@media (pointer: coarse) and (max-height: 500px) {
  .driver-popover .driver-popover-description {
    max-height: 40vh;
    overflow-y: auto;
  }
}
```

`--ps-touch-target` and `--ps-space-1` are tokens `theme.ts` defines (the style lint checks); `300px`, `380px`, `32px` and `40vh` are size literals, which the lint allows. The `500px` matches `LANDSCAPE_PHONE_MAX_HEIGHT` (`layout-defaults.ts`), the landscape layout's height limit.

The close button's ✕ glyph stays where driver.css centres it; the 40 px box overlaps the title's right end only for a title longer than the popover allows, which none of the phone titles is.

- [ ] **Step 4: Run them to see them pass**

Run (sandbox disabled): `PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-bars.spec.ts --project=mobile -g "product tour"`
Expected: PASS, 4 tests (C11, C12, What's new on a phone, dark). If a popover is still off screen, the failing assertion names the edge and the step (`step "…"`) through the title list: for a bottom edge in landscape, lower the `max-height` above (35vh); for a side edge, give that step a `side` in `product-tour.ts`'s mapping only for `hasStructureSheet` modes, and report it as an interface addition (`TourStepSpec` has no `side` today). If C11's legend steps fail on "click", the coarse wording of 7.6 is wrong for that step: fix the text in `tour-steps.ts` and its unit test still passes.

Run: `pnpm --filter @protspace/core exec vitest --run --project unit src/styles/style-lint.test.ts`
Expected: PASS (no raw colour, no undefined `--ps-*` read in `product-tour.css`).

Run: `pnpm --filter @protspace/app exec vitest --run src/tour/`
Expected: PASS, unchanged counts (38), unless Step 4 touched `tour-steps.ts` or `product-tour.ts`.

Run: `pnpm exec prettier --check apps/web/src/tour/product-tour.css apps/web/tests/mobile-bars.spec.ts`
Expected: pass.

Unrun at task time: `mobile-a11y.spec.ts` and the rest of `mobile-bars.spec.ts` (the phase exit runs `mobile-bars.spec.ts --project=mobile` in full, then the mobile project three times).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tour/product-tour.css apps/web/tests/mobile-bars.spec.ts
git commit -m "feat(web): the tour on phones and in landscape"
```

Add `apps/web/src/tour/product-tour.ts` and `apps/web/src/tour/tour-steps.ts` (and their tests) only if Step 4 changed them. (Sandbox disabled for the commit: the hook needs it.)

### Task 7.9: Bars and Filtering pages replace the control-bar page

`control-bar.md` splits into "Bars and Tools" and "Filtering", with plain captures of each menu and the filter panel (the first light/dark pair, so the VitePress head rule lands here). Every link into the old page moves; the `control-bar-*` images and `filter-query-builder.png` are deleted.

**Files:**

- Create: `docs/explore/controls.md`, `docs/explore/filter.md`, `scripts/docs-screenshots/scenes/controls.ts`, `scripts/docs-screenshots/scenes/clip.ts`
- Delete: `docs/explore/control-bar.md`; `docs/explore/images/control-bar-annotated.png`, `control-bar-projection.png`, `control-bar-annotation.png`, `control-bar-export.png`, `control-bar-contours.png`, `filter-query-builder.png`
- Create images: `projection-menu.png`, `color-by-menu.png`, `contours-menu.png`, `export-menu.png`, `search-messages.png`, `filter-panel.png`, `filter-panel-dark.png`; regenerate `scatterplot-contours.png`, `eat-annotation-badge.png`
- Modify: `docs/.vitepress/config.mts` (sidebar: "Bars and Tools", "Filtering" replace "Control Bar Features"; `head` gains the `<style>` rule)
- Modify: `docs/explore/index.md` (the `control-bar-annotated` image and the control-bar link only; the rewrite is 7.10), `exporting.md` (:53), `figure-editor.md` (:19), `scatterplot.md` (:40, :58, :106, :182), `eat.md` (:27, :78, :112, :143), `legend.md` (:252), `importing-data.md` (:151, :152): links to `/explore/controls#…` or `/explore/filter#…`
- Modify: `apps/web/tests/helpers/explore.ts` (the menu locators and `draftFilterCondition` move here from the scene; `searchReport` exported), `apps/web/tests/workbench-helpers.spec.ts` (two cases)
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs-lint.ts` (`LEGACY_IMAGES` loses the regenerated and deleted files; `STALE_PAGES` loses `explore/control-bar.md` and `explore/eat.md`)

Why `importing-data.md` and `eat.md` :78 are in the list, and why `eat.md` leaves `STALE_PAGES` here: `importing-data.md` :151 and :152 and `eat.md` :78 also link into `control-bar.md` (`#_10-contours` twice, `#_6-isolate-button`), and VitePress fails `docs:build` on a link to a deleted page; and once `eat.md` :143's link text "Control Bar Features" changes, `eat.md` names no removed UI any more, so the 7.5 test "STALE_PAGES lists only pages that still use a stale term" requires it to leave `STALE_PAGES` here rather than in its own page task (7.14).

**Interfaces:**

- Consumes: the runner (7.3): `CaptureEntry` (`name`, `kind`, `viewport`, `themes`, `dataset`, `setup`, `steps`, `target`, `docs`), `Clip`; `projectionTrigger`, `colorByTrigger`, `annotationSelect`, `openExportMenu`, `exportMenu`, `openFilter`, `filterPanel`, `filterApplyButton`, `queryBuilder`, `setContours`, `searchInput`, `pasteIntoSearch`, `plotArea`, `viewBar`, `getViewState`, `waitForExploreDataLoad`, the module-private `quoted` (CSS attribute escaping) and 7.2's module-private `searchReport` (`protspace-protein-search .search-report`) (`helpers/explore.ts`); `legendRowValues` (`helpers/legend.ts`); `plotSettled` (`helpers/plot.ts`, 7.2); `DEFAULT_EXAMPLE_DATASET` (`apps/web/src/explore/example-datasets.ts`); `lintDocs`, `LEGACY_IMAGES`, `STALE_PAGES` (7.5); the old captures for content (`git show a8cb13ca:scripts/docs-screenshots/capture-static.spec.ts` 316–489, 662–860; `capture-eat-static.spec.ts` 38–62).
- Produces:
  - `helpers/explore.ts` (shared, so a layout change is fixed in one place, decision 19): `projectionMenu(page)`, `colorByMenu(page)`, `contoursTrigger(page)`, `contoursMenu(page)`, `exportTrigger(page)`, `exportList(page)` (all `(page: Page) => Locator`); `searchReport(page)` (7.2's module-private locator, now exported); `draftFilterCondition(page: Page, row: number, annotation: string, values?: readonly string[]): Promise<Locator>` (opens the Filter panel, adds a condition row when `row` is the next one, picks `annotation` and each categorical value, closes the value picker, never applies; returns the row). `setContours` uses `contoursTrigger`.
  - `scenes/clip.ts`: `around(locators: readonly Locator[], pad = 12): Promise<Clip>` (the union of their boxes plus `pad`, clamped to the viewport); used by 7.10–7.15.
  - `scenes/controls.ts`: `export const CONTROLS_CAPTURES: CaptureEntry[]` — `projection-menu`, `color-by-menu`, `contours-menu`, `export-menu` (trigger plus open menu, light), `search-messages` (the report after pasting found and unknown ids, light), `filter-panel` (sidebar Filter panel with two conditions and the live count, `themes: ['light', 'dark']`), `scatterplot-contours` (plot area, Contours on), `eat-annotation-badge` (`docs: ['explore/controls.md', 'explore/eat.md']`).
  - `controls.md` headings (anchors other pages link to): "## App bar" → "### Dataset menu", "### Search", "### Import", "### Export", "### Theme", "### Help"; "## View bar" → "### Projection", "### Color by", "### Contours", "### Filter", "### More"; "## Plot tools" → "### Selection tools", "### Selection bar", "### Status chips", "### Undo and redo". `filter.md`: "## Building a filter", "## Numeric range conditions" (moved from control-bar §7), "## Draft, Apply and Cancel" (the disabled-Apply reason), "## Removing a filter" (chip ✕, Reset with Undo), "## Reliability and the filter" (the EAT slider and the draft), "## Filter or Show only".
  - The head rule (exact): `['style', {}, 'html.dark img.light-only,html:not(.dark) img.dark-only{display:none}']`.

Old anchor → new link, for every page that linked into `control-bar.md`:

| Old link | New link |
| --- | --- |
| `/explore/control-bar#_2-annotation-selector` | `/explore/controls#color-by` |
| `/explore/control-bar#_3-search` | `/explore/controls#search` |
| `/explore/control-bar#_6-isolate-button` | `/explore/controls#selection-bar` |
| `/explore/control-bar#_7-filter-button` | `/explore/filter#building-a-filter` |
| `/explore/control-bar#_10-contours` | `/explore/controls#contours` |
| `/explore/control-bar` | `/explore/controls#projection` (scatterplot :182) or `/explore/controls` + `/explore/filter` (the "Next Steps" lists) |

**Tests:**

- `workbench-helpers.spec.ts`: "the view-bar and Export menus open beside their triggers" (each of `projectionMenu`, `colorByMenu`, `contoursMenu`, `exportList` visible after its trigger is clicked, Escape between) and "draftFilterCondition drafts without applying" (two conditions, chips counted, Apply enabled, the plot unfiltered). This is the task's one e2e spec, run filtered.
- `pnpm docs:images:check` and `docs-images.test.ts` pass with the smaller allowlists (no page links `/explore/control-bar`; every moved anchor resolves; the filter-panel pair passes the pair rules).
- `pnpm docs:build`, then the built `docs/.vitepress/dist/explore/filter.html` contains `class="light-only"` and `class="dark-only"` on the two `img` elements and the `<style>` rule in its head (grep; quote the lines in the report). If markdown-it-attrs drops the class on images, switch the pair to raw `<img>` and say so.
- Verification: `pnpm docs:screenshots -g "projection-menu.png|color-by-menu.png|contours-menu.png|export-menu.png|search-messages.png|filter-panel|scatterplot-contours.png|eat-annotation-badge.png"` (sandbox disabled); `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`; `pnpm docs:images:check`; `pnpm docs:build`; prettier on the changed markdown; `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts --project workbench -g "menus open beside|draftFilterCondition"`.
- Unrun at task time: the specs calling `setContours` (`workbench-view-bar.spec.ts`, `url-view-state.spec.ts`), and the rest of `workbench-helpers.spec.ts`.

- [ ] **Step 1: The menu locators and the filter draft in the shared helpers**

The scenes below open each view-bar menu and draft a filter. Those locators belong with the other control helpers, so a control that moves is fixed once for the e2e and the captures. Write the spec cases first.

In `apps/web/tests/workbench-helpers.spec.ts`, add `colorByMenu`, `colorByTrigger`, `contoursMenu`, `contoursTrigger`, `draftFilterCondition`, `exportList`, `exportTrigger`, `filterApplyButton`, `projectionMenu`, `projectionTrigger` to the import from `./helpers/explore` (keep the names already imported; add only the missing ones), and append:

```ts
test.describe('view-bar menus and the filter draft', () => {
  test('the view-bar and Export menus open beside their triggers', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    const pairs: Array<[Locator, Locator]> = [
      [projectionTrigger(page), projectionMenu(page)],
      [colorByTrigger(page), colorByMenu(page)],
      [contoursTrigger(page), contoursMenu(page)],
      [exportTrigger(page), exportList(page)],
    ];
    for (const [trigger, menu] of pairs) {
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
  });

  test('draftFilterCondition drafts without applying', async ({ page }) => {
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    const { annotation } = await getViewState(page);
    const values = (await legendRowValues(page)).slice(0, 2);
    const first = await draftFilterCondition(page, 0, annotation ?? '', values);
    await expect(first.locator('.value-chip')).toHaveCount(values.length);
    const second = await draftFilterCondition(page, 1, 'length');
    await expect(second.getByLabel('Comparison operator')).toBeVisible();
    await expect(filterApplyButton(page)).toBeEnabled();
  });
});
```

(`Locator` joins the `@playwright/test` type import; `getViewState`, `waitForExploreDataLoad` and `legendRowValues` are imported already or come from `./helpers/explore` and `./helpers/legend`. If the fixture dataset has no `length` column, use any numeric annotation it has and say which.)

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts --project workbench -g "menus open beside|draftFilterCondition"`
Expected: FAIL before any test runs, with a module error naming the first missing export (`projectionMenu`).

In `apps/web/tests/helpers/explore.ts`:

- export 7.2's `searchReport` (`const searchReport` → `export const searchReport`; keep its selector `protspace-protein-search .search-report`, the element whose id is `protein-search-report`);
- after the `annotationSelect` definition insert:

```ts

/** The open Projection menu. */
export const projectionMenu = (page: Page): Locator =>
  page.locator('protspace-projection-select').getByRole('menu', { name: 'Projection' });

/** The open Color by list. */
export const colorByMenu = (page: Page): Locator =>
  annotationSelect(page).locator('.dropdown-menu');

/** The view bar's Contours button (its name gains the mode). */
export const contoursTrigger = (page: Page): Locator =>
  viewBar(page).getByRole('button', { name: /^Contours/ });

/** The open Contours menu. */
export const contoursMenu = (page: Page): Locator =>
  page.locator('protspace-contours-menu').getByRole('menu', { name: 'Contours' });

/** The app bar's Export button and its open menu. */
export const exportTrigger = (page: Page): Locator =>
  exportMenu(page).getByRole('button', { name: 'Export', exact: true });
export const exportList = (page: Page): Locator =>
  exportMenu(page).getByRole('menu', { name: 'Export', exact: true });
```

- in `setContours`, replace `const contours = viewBar(page).getByRole('button', { name: /^Contours/ });` with `const contours = contoursTrigger(page);`;
- after `applyFirstCategoryFilter` insert (same selectors, same `quoted`; `applyFirstCategoryFilter` stays as it is):

```ts

/**
 * Drafts condition `row` (0-based) in the Filter panel and leaves it unapplied: adds a row when
 * `row` is the next one, picks `annotation`, then each categorical value in `values` (none for a
 * numeric annotation: fill its range through the row's labelled fields). Returns the row.
 */
export async function draftFilterCondition(
  page: Page,
  row: number,
  annotation: string,
  values: readonly string[] = [],
): Promise<Locator> {
  await openFilter(page);
  const builder = queryBuilder(page);
  const rows = builder.locator('protspace-query-condition-row');
  if (row >= (await rows.count())) {
    await builder.getByRole('button', { name: '+ Add condition' }).click();
    await expect(rows).toHaveCount(row + 1);
  }
  const condition = rows.nth(row);
  await condition.locator('.annotation-select-trigger').click();
  await builder
    .locator(`.annotation-picker-item[data-annotation="${quoted(annotation)}"]`)
    .first()
    .click();
  if (values.length === 0) return condition;
  for (const value of values) {
    const item = builder.locator(`.value-picker-item[data-value="${quoted(value)}"]`).first();
    if (!(await item.isVisible())) await condition.locator('.value-chip-add').click();
    await item.click();
  }
  // Escape closes the value picker (a layer) and nothing else.
  await page.keyboard.press('Escape');
  await expect(builder.locator('.value-picker-item').first()).toBeHidden();
  await expect(condition.locator('.value-chip')).toHaveCount(values.length);
  return condition;
}
```

(Move these after the definitions they read if ESLint's `no-use-before-define` complains; `const` arrow helpers are only called at run time, so the order is otherwise free.)

Run the same command. Expected: PASS, 2 tests. Then `pnpm type-check:scripts` — PASS (`helpers/explore.ts` is in `scripts/tsconfig.json` since 7.1).

- [ ] **Step 2: The crop helper and the scenes**

Create `scripts/docs-screenshots/scenes/clip.ts`:

```ts
import type { Locator } from '@playwright/test';
import type { Clip } from '../capture-plan';

/**
 * The smallest viewport rectangle holding every locator's box, grown by `pad` on each side and
 * clamped to the viewport: a menu crop holds its trigger and the open menu. Throws when a locator
 * has no box (hidden or detached), so a crop never silently shrinks to what happened to show.
 */
export async function around(locators: readonly Locator[], pad = 12): Promise<Clip> {
  if (locators.length === 0) throw new Error('around() needs at least one locator');
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [index, locator] of locators.entries()) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`around(): locator ${index} has no box (hidden or detached)`);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  const viewport = locators[0].page().viewportSize();
  if (!viewport) throw new Error('around(): the page has no fixed viewport');
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  const width = Math.min(viewport.width, Math.ceil(right + pad)) - x;
  const height = Math.min(viewport.height, Math.ceil(bottom + pad)) - y;
  return { x, y, width, height };
}
```

Create `scripts/docs-screenshots/scenes/controls.ts`:

```ts
/**
 * Captures for docs/explore/controls.md (Bars and Tools) and docs/explore/filter.md: each view-bar
 * menu open beside its trigger, the search report, the Export menu, the Filter panel holding a
 * two-condition draft, the plot with contours, and the EAT badge in Color by.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET } from '../../../apps/web/src/explore/example-datasets';
import {
  annotationSelect,
  colorByMenu,
  colorByTrigger,
  contoursMenu,
  contoursTrigger,
  draftFilterCondition,
  exportList,
  exportTrigger,
  filterPanel,
  openExportMenu,
  pasteIntoSearch,
  plotArea,
  projectionMenu,
  projectionTrigger,
  queryBuilder,
  searchInput,
  searchReport,
  setContours,
} from '../../../apps/web/tests/helpers/explore';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import type { CaptureEntry } from '../capture-plan';
import { around } from './clip';

/** The EAT example's curated colouring, the column its transfers fill. */
const EAT_ANNOTATION = 'toxin_class';
/** Ids no dataset holds, for the search report's "Not found" list. */
const UNKNOWN_IDS = ['X00001', 'X00002'];

const search = (page: Page): Locator => page.locator('#myProteinSearch');

/**
 * Builds a draft in the Filter panel and leaves it unapplied: the colouring annotation is one of
 * the two largest legend categories, AND length is between 60 and 120. The live count shows; Apply
 * is enabled.
 */
async function draftTwoConditions(page: Page): Promise<void> {
  const annotation = DEFAULT_EXAMPLE_DATASET.defaultView.annotation;
  const values = (await legendRowValues(page)).slice(0, 2);
  await draftFilterCondition(page, 0, annotation, values);
  const second = await draftFilterCondition(page, 1, 'length');
  await second.getByLabel('Comparison operator').selectOption('between');
  await second.getByLabel('Minimum value').fill('60');
  await second.getByLabel('Maximum value').fill('120');
  await expect(queryBuilder(page).locator('.match-count')).toHaveText(/^[1-9][\d,]* of [\d,]+ proteins? match$/);
}

export const CONTROLS_CAPTURES: CaptureEntry[] = [
  {
    name: 'projection-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      await projectionTrigger(page).click();
      await expect(projectionMenu(page)).toBeVisible();
    },
    target: (page) => around([projectionTrigger(page), projectionMenu(page)]),
  },
  {
    name: 'color-by-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      await colorByTrigger(page).click();
      await expect(colorByMenu(page)).toBeVisible();
    },
    target: (page) => around([colorByTrigger(page), colorByMenu(page)]),
  },
  {
    name: 'contours-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    setup: async (page) => {
      await setContours(page, 'on');
      await plotSettled(page);
    },
    steps: async (page) => {
      await contoursTrigger(page).click();
      await expect(contoursMenu(page)).toBeVisible();
    },
    target: (page) => around([contoursTrigger(page), contoursMenu(page)]),
  },
  {
    name: 'export-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      await openExportMenu(page);
    },
    target: (page) => around([exportTrigger(page), exportList(page)]),
  },
  {
    name: 'search-messages',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      // Focusing the empty box lists the dataset's first ids: three real ones to paste.
      await searchInput(page).click();
      const suggestions = search(page).getByRole('option');
      await expect(suggestions.first()).toBeVisible();
      const found = (await suggestions.allTextContents())
        .map((text) => text.trim())
        .filter(Boolean)
        .slice(0, 3);
      await searchInput(page).press('Escape');
      await expect(suggestions).toHaveCount(0);
      await pasteIntoSearch(page, [...found, ...UNKNOWN_IDS].join('\n'));
      const total = found.length + UNKNOWN_IDS.length;
      await expect(searchReport(page)).toContainText(`${found.length} of ${total} found`);
      await expect(searchReport(page)).toContainText('Not found');
    },
    target: (page) => around([search(page), searchReport(page)]),
  },
  {
    name: 'filter-panel',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    docs: ['explore/filter.md'],
    steps: draftTwoConditions,
    target: (page) => filterPanel(page),
  },
  {
    name: 'scatterplot-contours',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    setup: async (page) => {
      await setContours(page, 'on');
      await plotSettled(page);
    },
    target: (page) => plotArea(page),
  },
  {
    name: 'eat-annotation-badge',
    kind: 'png',
    viewport: 'desktop',
    dataset: 'three-finger-toxins',
    docs: ['explore/controls.md', 'explore/eat.md'],
    steps: async (page) => {
      await colorByTrigger(page).click();
      const row = annotationSelect(page)
        .locator(`.dropdown-item[data-annotation="${EAT_ANNOTATION}"]`)
        .first();
      await expect(row.locator('.eat-badge')).toBeVisible();
      // The list scrolls and the row sits below the fold.
      await row.scrollIntoViewIfNeeded();
    },
    target: (page) => colorByMenu(page),
  },
];
```

In `scripts/docs-screenshots/manifest.ts`, add next to the other scene imports:

```ts
import { CONTROLS_CAPTURES } from './scenes/controls';
```

and append `...CONTROLS_CAPTURES` as the last element of the `MANIFEST` array literal (after `...SCATTERPLOT_CAPTURES`, or after whatever scene a task before this one appended last).

In `scripts/docs-screenshots/docs-lint.ts`, delete these eight lines from the `LEGACY_IMAGES` set:

```ts
  'control-bar-annotated.png',
  'control-bar-annotation.png',
  'control-bar-contours.png',
  'control-bar-export.png',
  'control-bar-projection.png',
  'eat-annotation-badge.png',
  'filter-query-builder.png',
  'scatterplot-contours.png',
```

and these two from `STALE_PAGES`:

```ts
  'explore/control-bar.md',
  'explore/eat.md',
```

- [ ] **Step 3: Run the checks to see them fail**

Run: `pnpm exec playwright test --project=docs-png --list`
Expected: the five `examples/<id>.png` titles plus `projection-menu.png`, `color-by-menu.png`, `contours-menu.png`, `export-menu.png`, `search-messages.png`, `filter-panel.png`, `filter-panel-dark.png`, `scatterplot-contours.png`, `eat-annotation-badge.png` (14 tests).

Run: `pnpm docs:images:check`
Expected: FAIL (exit 1). Among the messages: `projection-menu.png: in the manifest but not on disk; capture it` (and the same for the other five new files and `filter-panel-dark.png`), `projection-menu.png: its docs page explore/controls.md does not exist`, `filter-panel.png: its docs page explore/filter.md does not exist`, and `control-bar-annotated.png: no manifest entry makes it; …` for each file that left `LEGACY_IMAGES` but is still on disk. This is the failing test: the manifest names images and pages that do not exist yet.

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL in "docs lint: the real docs › passes every page and image": `explore/control-bar.md:1: "Control Bar" names removed UI` and similar lines for `explore/control-bar.md` (it left `STALE_PAGES` but still exists). `explore/eat.md:143: "Control Bar" names removed UI` too.

- [ ] **Step 4: Capture the images**

With the sandbox disabled (the runner starts its own Vite server on 8096 and a headed Chromium), and the EAT example on disk:

```bash
pnpm examples:fetch --only three-finger-toxins
pnpm docs:screenshots -g "projection-menu.png|color-by-menu.png|contours-menu.png|export-menu.png|search-messages.png|filter-panel|scatterplot-contours.png|eat-annotation-badge.png"
```

(If `pnpm examples:fetch` takes no `--only`, run `pnpm examples:fetch`; it skips files already present.)

Expected: 9 passed. Open each new file and check it shows what its name says:

- the three menus and the Export menu: the trigger and the open menu, nothing clipped, no hover highlight, no tooltip;
- `search-messages.png`: the search box and the report "3 of 5 found" with `X00001` and `X00002` under "Not found";
- `filter-panel.png` and `filter-panel-dark.png`: the panel with condition 1 (protein family, two values as chips) and condition 2 (length between 60 and 120), the "N of 7,831 proteins match" line, Apply enabled; the dark one on the dark surface;
- `scatterplot-contours.png`: the plot area with rings;
- `eat-annotation-badge.png`: the Color by menu with the `toxin_class` row and its EAT badge in view.

If the value picker closes after each pick so the second value is not chosen, the `isVisible` check in `draftFilterCondition` reopens it; if the chips count still differs, say so in the report. Report each file with its size (`ls -l docs/explore/images/{projection-menu,color-by-menu,contours-menu,export-menu,search-messages,filter-panel,filter-panel-dark,scatterplot-contours,eat-annotation-badge}.png`).

- [ ] **Step 5: The two new pages**

Create `docs/explore/controls.md`:

````md
# Bars and Tools

The Explore page has two bars above the plot and a set of tools on the plot itself. The **app bar**
holds the dataset, search, Import and Export, the theme and help. The **view bar** below it
chooses what the plot shows. The **plot tools** select proteins and narrow the view.
[Interface Overview](/explore/) shows where each one sits; this page describes what each control
does.

## App bar

From left to right: the ProtSpace wordmark (back to the home page), the dataset menu, the search
box, **Import** and **Export**, **Theme**, **Help**, **Feedback** and **GitHub**. On a phone the
search box opens from a search button, and Theme and Help move into the view bar's **More** sheet.

### Dataset menu

The dataset's name and protein count, for example **Venom toxins (demo) · 7,831 proteins**. A long
name is shortened; hover it for the full name. Click it to open the same panel as
[Import](#import), where you can switch to another dataset.

### Search

Find specific proteins by ID:

1. Click inside the search box or press **⌘ K** (Mac) / **Ctrl + K** to focus it
2. Type the start of a protein ID (matching is anchored to the start, not anywhere inside)
3. Click a suggestion, or press **Enter** to take the highlighted row: the first row is highlighted
   as soon as you type, and the arrow keys move the highlight. Hovering does not move it, so a
   reflexive **Enter** on an ID you already selected deselects it
4. An unselected protein joins your selection, the box clears, and the list closes. One that is
   already selected is listed with a `✓`, gains a `✕` on hover or highlight, and is **removed**
   instead, leaving your query and the open list in place so you can prune several in a row

Focusing an empty box lists up to 10 proteins from your current selection, mixed in dataset order
with the first unselected IDs. **Escape** in the search box closes the list and empties the box; it
never clears the selection.

Paste several IDs at once (separated by newlines or spaces) and every matching protein is selected.
Pasting a list only ever adds. When something does not go as asked, a short report opens under the
box:

![The search box with its report after pasting five IDs: "3 of 5 found", and the two unknown IDs listed under Not found](./images/search-messages.png)

| Report                                       | When                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| **N of M found**, with a **Not found** list  | A pasted list held IDs the dataset does not contain; **Copy** takes all |
| **No protein … in this dataset**             | You pressed **Enter** on an ID the dataset does not contain             |
| **… is already selected**                    | The ID you asked for is in your selection already                       |
| **… is selected but hidden in this view**    | It is selected, but a filter, Show only or a hidden category hides it   |

### Import

Click **Import**, or the [dataset name](#dataset-menu), to open the panel:

- **Open a file…** opens a file picker for a `.parquetbundle` or a FASTA file (`.fasta`, `.fa`,
  `.fna`) from your computer. For FASTA, ProtSpace sends the sequences to the prep service, which
  computes embeddings and projections and then opens the resulting bundle automatically. See
  [Importing Data](/explore/importing-data) for the full flow, size limits, and privacy
  implications. You can also drop either file type anywhere on the page.
- **Last file** reopens the file you imported last, which ProtSpace keeps in your browser. It
  shows only while another dataset is on screen.
- **Examples** lists the startup demo and the datasets behind the ProtSpace paper's figures;
  [Example Datasets](/explore/example-datasets) describes each one. Each item's label gives the
  protein count and download size, and its **ⓘ** icon says what the example is and what its
  curated view shows, with a link to its section of that page; **About these examples** above the
  list links to the whole page. Large examples carry a **Large** badge, and their ⓘ also gives the
  download size and the memory and time they take to open. The example currently loaded is
  disabled and marked with a check; its ⓘ still opens.

Choosing an example loads it and puts `dataset=<id>` in the URL, so the link is shareable and the
browser's **Back** button returns to whatever was shown before. The file you imported stays stored
in your browser (see
[Data & Settings Persistence](/explore/importing-data#data-settings-persistence)): **Last file**
reopens it, and visiting the app again without a `dataset` parameter brings it back. A link such as
`/explore?dataset=<id>`, with the id from the example's section of
[Example Datasets](/explore/example-datasets), loads the example the same way. An unknown id shows
a warning and the app starts up normally.

An example opens on its curated view: the projection, colour-by annotation and tooltip fields
chosen for it. A menu choice always opens that view with contours off, so the previous dataset's
`annotation`, `projection`, `tooltip` and `density` parameters don't carry over (**Back** still
returns to them); in a link, those parameters win over the curated ones. Changes you make to an
example aren't kept: it reopens in its curated state every time.

While an example downloads, the loading screen shows how much of it has arrived and offers
**Cancel download** until decoding starts. Cancelling leaves the current plot and the URL as they
were, with no message; on an empty page (a link opened fresh) it removes the `dataset` parameter
and runs the startup load instead. If an example fails to download, whether you chose it from the
menu or went **Back** or **Forward** to it, ProtSpace shows an error with a **Retry** button and
leaves the current plot and the URL as they were. Only a link opened on an empty page falls back to
the startup load.

### Export

Click **Export** to save your visualization or its data:

![The Export menu open under its button: Figure editor…, Quick PNG, Quick PDF, Protein IDs (.txt) and Data bundle (.parquetbundle)](./images/export-menu.png)

| Item                             | Saves                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| **Figure editor…**               | A publication figure, laid out in the editor                  |
| **Quick PNG**                    | A raster image of the current view with legend                |
| **Quick PDF**                    | A PDF of the current view with legend                         |
| **Protein IDs (.txt)**           | The visible proteins' identifiers, one per line               |
| **Data bundle (.parquetbundle)** | All data and, with **Include legend settings**, your settings |

See [Exporting Results](/explore/exporting) for image options (dimensions, legend size, font) and
the [Figure Editor](/explore/figure-editor) for publication figures.

### Theme

**Theme** switches the page between **System** (follow your operating system, the default),
**Light** and **Dark**. ProtSpace remembers your choice in this browser. The plot, the legend and
the structure viewer follow the theme; exported images and figures are always light.

### Help

**Help** opens **Documentation** (these pages), **Keyboard shortcuts** (every shortcut, grouped by
where it works) and **Take the tour** (the guided tour of the page). On a phone they are under
**More → Help & shortcuts**.

## View bar

The view bar sits under the app bar and holds what changes the picture: **Projection**,
**Color by**, **Contours** and **Filter**. When the window is too narrow for all of them, Contours
and then Filter move into **More**.

### Projection

Switch between the projections your bundle carries:

![The Projection menu open under its button, listing the bundle's projections with the current one checked](./images/projection-menu.png)

| Method     | Best For                           |
| ---------- | ---------------------------------- |
| **PCA**    | Initial overview, finding outliers |
| **UMAP**   | General exploration, balanced view |
| **t-SNE**  | Finding clusters                   |
| **PaCMAP** | Fast alternative to t-SNE          |
| **MDS**    | Preserving distances               |

Different projections reveal different patterns, so try switching between them. The button beside
**Projection** opens the projection's details: how it was made and how faithful it is to the
embedding (see [Projection Metadata](/explore/scatterplot#projection-metadata)).

When you switch projections, the points glide from where they are to their new positions over about
0.8 seconds, so you can follow where each group goes. This also works while **Show only these** is
on. While the points move, duplicate-count badges, expanded stacks and EAT connectors are hidden,
and hovering shows no tooltip. If your system asks for reduced motion, the points jump to their new
positions at once.

::: info URL persistence
Your current projection is reflected in the page URL, so refresh, browser back/forward navigation,
and shared links reopen the same view when possible. A bare `/explore` URL stays unchanged on first
load; ProtSpace writes projection and annotation params after you change the view or when it needs
to normalize an invalid URL value.
:::

::: tip 3D Projections
3D projections load normally and are shown as their X/Y view; the third (Z) dimension is not
rendered in the web viewer.
:::

### Color by

Choose which annotation colours the points:

![The Color by menu open under its button: a search field and the annotations grouped by source](./images/color-by-menu.png)

- **Grouped categories**: annotations are organized into sections, one per source (Biocentral,
  InterPro, TED, Taxonomy, UniProt, Other)
- **Search**: type to filter annotations by name (case-insensitive)
- **Keyboard navigation**: use the arrow keys to move the highlight, **Enter** to select,
  **Escape** to close. Hovering does not move the arrow-key highlight, and **Enter** picks the row
  under the pointer whenever one is hovered.

Only categories present in your dataset appear in the menu. Any columns that don't match a known
category appear under **Other**. See the
[ProtSpace Python package](https://github.com/tsenoner/protspace) for the complete list of
available annotations per source.

::: info ⚡ Predicted badge
A ⚡ badge next to an annotation name marks a **computational prediction** rather than curated or
experimental data. Hover it for the tooltip "Predicted: computational, not experimentally
curated". The same badge appears next to the legend title when a predicted annotation is active.

Flagged annotations are:

- **Signal peptide (Phobius)**, de-novo topology predictor
- **TED domains**, domains parsed from predicted AlphaFold structures
- All **Biocentral** columns: Subcellular location, Membrane, Signal peptide, Transmembrane
- Any other column whose name starts with `predicted_`

Reference signature-database matches (Pfam, CATH-Gene3D, SUPERFAMILY, SMART, CDD, PANTHER) and
curated data (UniProt, Taxonomy) are deliberately **not** flagged. See
[Annotations](/guide/annotations) for the full column reference.
:::

::: info STATS badge
A **STATS** badge marks an annotation that the bundle scored **for the projection you are currently
viewing**. It carries no number; it only says the scores exist. Hover it for the tooltip "Quality
statistics available: select this annotation and open the projection metadata panel".

The badge disappears when you switch to a projection the annotation was not scored on. Select the
annotation and open the [projection details](/explore/scatterplot#projection-metadata) to read the
numbers, or see [Separation Scores](/explore/separation-scores) for what they mean.
:::

![The Color by menu of the three-finger toxins example, with the EAT badge beside toxin_class](./images/eat-annotation-badge.png)

::: info EAT badge
An **EAT** badge marks an annotation in which some proteins carry a value **transferred from a
nearby annotated protein** instead of a curated record of their own, not to be confused with the ⚡
badge. Hover it for the tooltip "Embedding Annotation Transfer predictions available". Select the
annotation to see which proteins those are, and to get the `Predicted (transferred)` controls in the
[legend](/explore/legend). See [Transferred Annotations (EAT)](/explore/eat) for the whole feature.
:::

::: info Tooltip-only annotations
`gene_name`, `protein_name`, and `uniprot_kb_id` are left out of Color by but are still shown in the
[tooltip](/explore/scatterplot#protein-tooltip) on hover.
:::

### Contours

**Contours** draws density rings over the points, so you can see where each category concentrates
even where its points pile on top of each other. While Auto or Always is selected, the button is
highlighted and names the mode: **Contours: Auto** or **Contours: Always**. On a narrow window the
modes are in **More**.

![The Contours menu open under its button, with Always checked among Off, Auto and Always](./images/contours-menu.png)

| Mode              | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| **Off** (default) | No contours                                                         |
| **Auto**          | Fades out as you zoom in; faint or hidden when few points are shown |
| **Always**        | Full strength at every zoom level                                   |

Auto and Always draw the same rings and fill; only their strength differs. Auto sets it from how
many points are visible, how large the plot is and how far you have zoomed in. It does not check
whether points actually overlap.

![The demo dataset with Contours set to Always: each protein family's cluster is outlined by rings in its legend colour](./images/scatterplot-contours.png)

How to read them:

- Every legend colour gets its own set of rings in that colour. Each ring inward marks a doubling
  of density, and a light fill deepens toward the densest core.
- A spot needs more than 5 points of one colour close together (about 7 piled on one spot) before it
  gets a ring, so scattered points get none.
- Hidden categories are left out, and selected points are drawn on top of the contours.
- Categories that share a colour share rings. Past 16 colours, the 15 largest keep their own rings
  and the rest share one grey set. N/A rings are light grey, so they are faint on a light
  background.
- The rings are computed on a fixed grid across the plot, so they sit in the same place on every
  screen and at every browser zoom, and lines are equally thick everywhere.

The menu works from the keyboard: with the button focused, **Enter** or **Space** opens it, the
arrow keys, **Home** and **End** move the highlight, **Enter** picks, and **Escape** closes it.

::: tip Auto on small datasets
Auto counts the visible points. In the full view of a plot about 1000 px wide it shows nothing below
about 360 visible points and reaches full strength from about 2,700, and a wider plot needs more.
Points you hide, filter out or leave out with **Show only these** do not count. For a small dataset,
such as a FASTA upload, or a small subset, pick **Always**.
:::

::: info URL persistence
The mode is kept in the page URL as `density=auto` for Auto or `density=on` for Always; Off leaves
the parameter out. A shared link opens with the same mode.
:::

::: warning Not in exported images yet
Contours are not drawn in exported images (Quick PNG and PDF, the
[Figure Editor](/explore/figure-editor) and its zoom insets): the file shows the points only. The
Figure Editor preview shows exactly what will be exported. Tracked in
[#498](https://github.com/tsenoner/protspace/issues/498).
:::

::: info Devices without contour support
Contours need floating-point render targets with float blending (`EXT_color_buffer_float` and
`EXT_float_blend`), and many iPhone and iPad browsers lack `EXT_float_blend`. On such a device, or
when the graphics driver refuses the contour shaders or buffers, choosing Auto or Always (or opening
a link with `density=`) shows a one-time **Contours unavailable** notice: "Contours are unavailable
on this device, so the Contours setting has no effect. Points are drawn as usual.", followed by the
cause in brackets, such as `(EXT_float_blend missing)`. The link keeps its `density=` parameter, so
it still shows contours on a device that supports them.
:::

### Filter

**Filter** opens the Filter panel in the sidebar, in place of the legend, where you build a query
from annotation values. While a filter is applied the button shows how many conditions it has.
[Filtering](/explore/filter) describes the panel.

### More

**More** appears when the window is too narrow for the whole view bar and holds what no longer fits:
the contour modes, then Filter. A dot on it says that something inside is on (contours, or an
applied filter). On a phone, **More** opens a sheet that also holds Import, Export, Theme,
Help & shortcuts and Feedback.

## Plot tools

### Selection tools

The tool strip in the plot's corner picks what a drag on the plot does:

| Tool              | A drag on the plot                         |
| ----------------- | ------------------------------------------ |
| **Move and zoom** | Pans; the scroll wheel zooms (the default) |
| **Box select**    | Draws a rectangle and selects inside it    |
| **Lasso select**  | Draws a free outline and selects inside it |

**Fit to view** zooms back to show every protein, as a double-click on the plot does. See
[Box Selection](/explore/scatterplot#box-selection) and
[Lasso Selection](/explore/scatterplot#lasso-selection) for details.

### Selection bar

While proteins are selected, a bar at the bottom of the plot shows how many and offers:

- **Show only these** hides every other protein. The plot's status corner then shows a
  **Showing only** chip; its ✕ (**Show all proteins**) brings them back.
- **Zoom to them** fits the view to the selection.
- **Copy IDs** copies the selected IDs, one per line.
- **Clear** empties the selection.

**Escape** also clears the selection; pressed again, it returns to **Move and zoom**. Escape in the
search box only closes the suggestion list and empties the box; it never clears the selection,
however many times you press it.

### Status chips

The plot's bottom-left corner counts the proteins on screen (**N proteins**) and shows a chip for
each way the view is narrowed:

| Chip                              | Its ✕                      |
| --------------------------------- | -------------------------- |
| **Filtered · N conditions**       | **Remove filter**          |
| **Showing only N proteins · K steps** | **Show all proteins**  |
| **N categories hidden**           | **Show hidden categories** |

Clicking the Filtered chip opens the [Filter panel](/explore/filter).

### Undo and redo

**⌘ Z** (Mac) / **Ctrl + Z** undoes the last selection, **Show only these** or filter step, and
**⇧ ⌘ Z** / **Shift + Ctrl + Z** redoes it. Removing a filter also shows a notification with an
**Undo** button. **Help → Keyboard shortcuts** lists every shortcut.

## Tips

- **Compare projections**: patterns that appear in several projections are more reliable
- **Use search**: find known proteins quickly to orient yourself
- **Export often**: save interesting views for later

## Next Steps

- [Filtering](/explore/filter) - Build annotation filters
- [Viewing 3D Structures](/explore/structures) - AlphaFold integration
- [Exporting Results](/explore/exporting) - Detailed export options
````

Create `docs/explore/filter.md`:

````md
# Filtering

The Filter panel shows only the proteins whose annotations match a query you build. Open it with
**Filter** in the [view bar](/explore/controls#filter) (inside **More** on a narrow window, and a tab
of the folding panel on a phone). It takes the legend's place in the sidebar, and its **✕** returns
to the legend. While a filter is applied, the Filter button shows how many conditions it has, the
sidebar rail's Filter icon carries a dot, and the plot's status corner shows a
**Filtered · N conditions** chip.

![The Filter panel with two conditions, protein family is one of two families and length is between 60 and 120, and the live count of matching proteins above Reset, Cancel and Apply](./images/filter-panel.png){.light-only}
![The Filter panel with two conditions, protein family is one of two families and length is between 60 and 120, and the live count of matching proteins above Reset, Cancel and Apply](./images/filter-panel-dark.png){.dark-only}

## Building a filter

1. Each row is a condition: choose an annotation, then click **+** to pick values
2. Click **+ Add condition** for another row, and combine rows with **AND**, **OR**, or **NOT**
3. Click **+ Add group** for nested logic (a parenthesised group of conditions)
4. The live count shows how many proteins match the query
5. Click **Apply** to filter the plot; the panel stays open

::: tip Logical Operators

- **AND**: Protein must match both conditions
- **OR**: Protein must match either condition
- **NOT**: Protein must have a value for the annotation **and** not match the condition

The first condition can optionally be set to **NOT** for immediate negation.

**NOT** deliberately excludes proteins with no value (N/A) for the annotation
being negated. Negating one protein family, for example, means "belongs to some
other family", not "belongs to some other family, or has no family assigned at
all". To include unannotated proteins as well, add an explicit **N/A** condition
with **OR**.
:::

::: tip Missing values

Annotations offer presence entries alongside their real values:

- **N/A**: proteins with no value for this annotation — listed whenever the
  annotation actually has missing values
- **Any value**: proteins that have some value — any value at all; always offered

**Any value** is exclusive: selecting it clears the other values, since "Any
value or X" is just "Any value".

Numeric annotations offer the same two entries next to their comparison, so
`≥ 0.7` plus **N/A** reads "at least 0.7, or no score at all". A presence entry
on its own is a complete condition — no bounds needed.
:::

## Numeric range conditions

Some annotations hold numbers rather than categories (for example `length`). When you pick a
numeric annotation, the row **switches to numeric mode automatically**: the **+** value picker is
replaced by a range input. There is no query text to type; you choose an operator and fill in the
bound(s):

| Operator  | Fields shown | Matches                                 |
| --------- | ------------ | --------------------------------------- |
| `>`       | min          | value **strictly** greater than min     |
| `≥`       | min          | value greater than or equal to min      |
| `<`       | max          | value **strictly** less than max        |
| `≤`       | max          | value less than or equal to max         |
| `between` | min and max  | min ≤ value ≤ max (**both ends** in)    |

`>` is the default operator on a new numeric condition. Switching operators clears any bound the
new operator does not use, so a hidden value cannot silently re-constrain the filter.

For example, `length` `between` `100` and `300` matches proteins with 100 ≤ length ≤ 300 (both ends
included), while `length` `>` `500` excludes a protein of exactly length 500.

Comparisons use the **raw numeric value**, not the legend's bin labels, so the bin settings in the
[legend](/explore/legend) do not affect which proteins a numeric condition matches.

A condition with a missing bound matches nothing, and the live count only appears once the
condition is complete.

::: warning Missing values
A protein with no value for the annotation never matches a comparison. Wrapping the condition in
**NOT** re-includes those proteins, because NOT is the complement of the matched set. To include
them directly, add the **N/A** entry next to the comparison.
:::

## Draft, Apply and Cancel

What you change in the panel is a draft: the plot keeps the filter last applied until you click
**Apply**. **Cancel** returns the conditions to that filter.

Apply is enabled only when applying would change something. While it is disabled, the line under
the count says why:

| Reason                                            | What to do                                    |
| ------------------------------------------------- | --------------------------------------------- |
| **Add a condition**                               | The query is empty                            |
| **Choose an annotation for condition N**          | Condition N has no annotation yet             |
| **Choose a value for condition N**                | Condition N has no value yet                  |
| **Enter a number for condition N**                | Condition N's comparison lacks a bound        |
| **No proteins match**                             | Loosen the query: an empty plot is not shown  |
| **Every protein matches; nothing to filter**      | Tighten the query                             |
| **No changes to apply**                           | The draft equals the filter already applied   |

Applying a filter is a step you can undo with **⌘ Z** (Mac) / **Ctrl + Z**, and redo with
**⇧ ⌘ Z** / **Shift + Ctrl + Z**.

## Removing a filter

**Reset** in the panel clears the query and shows every protein again; the panel stays open. The
✕ on the plot's **Filtered** chip (**Remove filter**) does the same from the plot. Either way a
**Filter removed** notification offers **Undo**, which brings the filter back.

## Reliability and the filter

For a dataset with transferred annotations, the reliability control in the legend's
**Predicted (transferred)** section is a front end for this filter: moving it writes one condition
on the annotation's EAT confidence, which you can see and edit here, and editing that condition
moves the control. See [Filtering By Reliability](/explore/eat#filtering-by-reliability).

## Filter or Show only

Both narrow the plot, in different ways:

- **Filter** keeps the proteins whose annotations match a query ("every reviewed protein in these
  two families").
- **Show only these**, in the [selection bar](/explore/controls#selection-bar), keeps the proteins
  you selected by hand, with a click, a box, a lasso or a pasted list.

They can be on at the same time. Each has its own chip in the plot's status corner, and each chip's
✕ removes only that one.
````

The `≥` and `≤` rows are not in the old §7 table; the numeric operator select offers them (`query-numeric-input.ts`: `gt`, `gte`, `lt`, `lte`, `between`) and the old page's "Numeric comparisons" tip named them, so the table now lists all five and the tip is folded in. The old "Apply & Isolate", "Isolate" and "query builder modal" wording is gone.

- [ ] **Step 6: Delete the old page and images; move every link**

```bash
git rm docs/explore/control-bar.md
git rm docs/explore/images/control-bar-annotated.png docs/explore/images/control-bar-projection.png docs/explore/images/control-bar-annotation.png docs/explore/images/control-bar-export.png docs/explore/images/control-bar-contours.png docs/explore/images/filter-query-builder.png
```

`docs/.vitepress/config.mts`: replace

```ts
  head: [['link', { rel: 'icon', href: '/docs/favicon.svg' }]],
```

with

```ts
  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.svg' }],
    // Docs images come in light/dark pairs ({.light-only} then {.dark-only}, the dark twin lazy);
    // VitePress's appearance toggle puts .dark on <html>, so only one of each pair shows.
    ['style', {}, 'html.dark img.light-only,html:not(.dark) img.dark-only{display:none}'],
  ],
```

and in the "Using the Explore Page" sidebar items replace

```ts
          { text: 'Control Bar Features', link: '/explore/control-bar' },
```

with

```ts
          { text: 'Bars and Tools', link: '/explore/controls' },
          { text: 'Filtering', link: '/explore/filter' },
```

`docs/explore/index.md` (7.10 rewrites the rest): delete the line

```md
![Control Bar - showing all buttons and dropdowns with numbered annotations](./images/control-bar-annotated.png)
```

and the blank line after it, and in item 10 of the control-bar list replace `[Contours](/explore/control-bar#_10-contours)` with `[Contours](/explore/controls#contours)`.

`docs/explore/exporting.md` (:53), `docs/explore/figure-editor.md` (:19), `docs/explore/scatterplot.md` (:40), `docs/explore/importing-data.md` (:151 and :152): replace every `(/explore/control-bar#_10-contours)` with `(/explore/controls#contours)`.

`docs/explore/scatterplot.md`:

- :58 `[search box](/explore/control-bar#_3-search)` → `[search box](/explore/controls#search)`
- :106 `[Annotation dropdown](/explore/control-bar#_2-annotation-selector)` → `[Color by menu](/explore/controls#color-by)`
- :182 `[Projection selector](/explore/control-bar)` → `[Projection menu](/explore/controls#projection)`

`docs/explore/eat.md`:

- :27 `[Annotation dropdown](/explore/control-bar#_2-annotation-selector)` → `[Color by menu](/explore/controls#color-by)`
- :78 `[isolation](/explore/control-bar#_6-isolate-button)` → `[Show only these](/explore/controls#selection-bar)`
- :112 `[filter query](/explore/control-bar#_7-filter-button)` → `[filter](/explore/filter#building-a-filter)`
- :143, the line `- [Control Bar Features](/explore/control-bar) - the annotation dropdown and the filter query builder`, becomes the two lines:

  ```md
  - [Bars and Tools](/explore/controls) - Color by and the other controls
  - [Filtering](/explore/filter) - the filter panel the reliability control writes into
  ```

`docs/explore/legend.md` :252, the line `- [Control Bar Features](/explore/control-bar) - projections, filters, export, and import`, becomes:

```md
- [Bars and Tools](/explore/controls) - projections, Color by, contours, search, import and export
- [Filtering](/explore/filter) - filter by annotation values
```

Then check that nothing links to the old page: `grep -rn "/explore/control-bar" docs --exclude-dir=.vitepress` and `grep -n "control-bar" docs/.vitepress/config.mts` print nothing (the API reference mentions the `<protspace-control-bar>` element, which is not a link to the page; leave it).

- [ ] **Step 7: Run the checks to see them pass**

Run: `pnpm docs:images:check`
Expected: PASS (`✓ … docs images match the manifest …`). If a moved link's anchor does not resolve, the message names the page, line and link: fix the link (the headings above are the anchors).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, same count as after 7.5 (no test added here).

Run: `pnpm docs:build`
Expected: PASS (no dead link: every link to `/explore/control-bar` is gone; the deleted images are referenced nowhere).

Then check the pair and the head rule in the built page:

```bash
grep -o '<img[^>]*filter-panel[^>]*>' docs/.vitepress/dist/explore/filter.html
grep -o '<style>html.dark img.light-only[^<]*</style>' docs/.vitepress/dist/explore/filter.html
```

Expected: two `img` tags, the first with `class="light-only"`, the second with `class="dark-only"` and `loading="lazy"`; and the one `<style>` line. Quote all three lines in the report. If either `img` lacks its class (markdown-it-attrs did not attach `{.…}` to the image), replace the two markdown lines in `filter.md` with raw tags on two lines, and say so in the report:

```html
<img src="./images/filter-panel.png" class="light-only" alt="The Filter panel with two conditions, protein family is one of two families and length is between 60 and 120, and the live count of matching proteins above Reset, Cancel and Apply" />
<img src="./images/filter-panel-dark.png" class="dark-only" loading="lazy" alt="The Filter panel with two conditions, protein family is one of two families and length is between 60 and 120, and the live count of matching proteins above Reset, Cancel and Apply" />
```

(Then the later page tasks write their pairs as raw tags too; say this in the report so the ledger records it.)

- [ ] **Step 8: Format and the remaining checks**

```bash
pnpm exec prettier --write docs/explore/controls.md docs/explore/filter.md docs/explore/index.md docs/explore/exporting.md docs/explore/figure-editor.md docs/explore/scatterplot.md docs/explore/eat.md docs/explore/legend.md docs/explore/importing-data.md docs/.vitepress/config.mts scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/scenes/clip.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-helpers.spec.ts
pnpm exec prettier --check docs/explore/controls.md docs/explore/filter.md docs/.vitepress/config.mts scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/scenes/clip.ts
pnpm type-check:scripts
pnpm knip
pnpm docs:images:check
```

Expected: all pass. Prettier may realign the markdown tables; rerun `pnpm docs:images:check` after it (line numbers in messages move, anchors do not). `knip` passes because `around` is imported by `scenes/controls.ts` and `CONTROLS_CAPTURES` by `manifest.ts`.

Report: the files created and deleted with sizes (`ls -l` of the nine images; the six deleted ones from `git show a8cb13ca --stat` are not needed, just their names), the three grep lines from Step 7, and the `docs-images.test.ts` count.

- [ ] **Step 9: Commit**

```bash
git add docs/explore/controls.md docs/explore/filter.md docs/.vitepress/config.mts docs/explore/index.md docs/explore/exporting.md docs/explore/figure-editor.md docs/explore/scatterplot.md docs/explore/eat.md docs/explore/legend.md docs/explore/importing-data.md scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/scenes/clip.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts apps/web/tests/helpers/explore.ts apps/web/tests/workbench-helpers.spec.ts docs/explore/images/projection-menu.png docs/explore/images/color-by-menu.png docs/explore/images/contours-menu.png docs/explore/images/export-menu.png docs/explore/images/search-messages.png docs/explore/images/filter-panel.png docs/explore/images/filter-panel-dark.png docs/explore/images/scatterplot-contours.png docs/explore/images/eat-annotation-badge.png
git commit -m "docs(explore): split the control-bar page into bars and filtering"
```

The `git rm` of Step 6 already staged the deleted page and six images; `git status --short` before the commit shows them as `D` and nothing unstaged under `docs/` or `scripts/docs-screenshots/`.

### Task 7.10: Interface overview page and its images

`explore/index.md` rewritten around the workbench's areas, with the main screenshots in light and dark, the sidebar GIF, and the sections for the sidebar, light and dark, help and the tour, and the keyboard shortcuts.

**Files:**

- Create: `scripts/docs-screenshots/scenes/overview.ts`
- Modify: `docs/explore/index.md` (rewrite, except the phones section which 7.15 adds), `docs/explore/structures.md` (the `structure-viewer` reference becomes a pair; text is 7.13's)
- Regenerate: `interface-overview.png`, `scatterplot-example.png`, `legend-panel.png`, `structure-viewer.png`; create `interface-overview-dark.png`, `app-bar.png`, `app-bar-dark.png`, `view-bar.png`, `view-bar-dark.png`, `legend-panel-dark.png`, `structure-viewer-dark.png`, `theme-switch.png`, `theme-switch-dark.png`, `sidebar-fold-resize.gif`
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs-lint.ts` (`LEGACY_IMAGES` and `STALE_PAGES` shrink: `explore/index.md` leaves)

**Interfaces:**

- Consumes: the runner and GIFs (7.3, 7.4): `type CaptureEntry`, `type CaptureApi` (`capture-plan.ts`; in a GIF `cap.click(target, { label? })`, `cap.moveTo(target, { steps? })`, `cap.drag(from, to, { steps? })` show the overlays, `cap.hold(ms)` is the only pause; in a PNG they act without overlays); `around` (7.9, `scenes/clip.ts`: `around(locators: readonly Locator[], pad = 12): Promise<Clip>`); `appBar`, `viewBar`, `plotArea`, `sidebar` (`helpers/explore.ts`); `collapseSidebar`, `expandSidebar`, `dragSidebarEdge`, `rail`, `structurePanel` (`helpers/workbench.ts`), and `clickProteinNearPlotCentre(page): Promise<string>` (same module: clicks the protein nearest the plot's centre, selecting it, which loads its structure, and returns its id); `legend` (`helpers/legend.ts`, the `protspace-legend` host); `themeButton` (`helpers/theme.ts`); `watchStructureLoads`, `waitForStructureLoaded` (7.2); `proteinScreenPosition` (7.2); the tour copy (7.6–7.7) for the "Help, shortcuts and the tour" section; `HelpMenu.tsx` item names ("Documentation", "Keyboard shortcuts", "Take the tour"); 7.9's `controls.md` headings (anchors `#dataset-menu`, `#search`, `#import`, `#export`, `#theme`, `#help`, `#view-bar`, `#projection`, `#color-by`, `#contours`, `#filter`, `#more`, `#plot-tools`, `#selection-tools`, `#selection-bar`, `#status-chips`, `#undo-and-redo`) and `/explore/filter`; `LEGACY_IMAGES`, `STALE_PAGES` (`docs-lint.ts`, 7.5: `ReadonlySet<string>` of file names relative to `docs/explore/images/` and page paths relative to `docs/`); `MANIFEST` (`manifest.ts`).
- Produces:
  - `scenes/overview.ts`: `export const OVERVIEW_CAPTURES: CaptureEntry[]` — `interface-overview` (full page, a protein selected and its structure loaded for real; light and dark; `timeoutMs` for Mol*), `app-bar` and `view-bar` (strips; light and dark), `scatterplot-example` (plot area, light), `legend-panel` (sidebar legend; light and dark; `docs` index), `structure-viewer` (docked viewer, real Mol*; light and dark; `docs: ['explore/index.md', 'explore/structures.md']`), `theme-switch` (Theme menu open; light and dark), `sidebar-fold-resize` (GIF: collapse to the rail, expand, drag the edge; light).
  - `index.md` headings: "## Page layout", "## App bar", "## View bar", "## Plot", "## Sidebar", "## Light and dark", "## Help, shortcuts and the tour", "## Keyboard shortcuts", "## Next steps" (7.15 inserts "## Phones and tablets" before "## Next steps"). "Light and dark" says System follows the OS, the choice is remembered, the plot and the structure follow, exports and figures stay light. "Keyboard shortcuts" points at Help → Keyboard shortcuts and names ⌘K/Ctrl+K, ⌘Z/Ctrl+Z (⇧ to redo), Escape, Shift + hover and `i`. "Help, shortcuts and the tour" says the full tour runs on the first visit, a returning visitor sees What's new once, Help → Take the tour replays it (More → Help & shortcuts on phones). The App bar and View bar sections are short and link to `/explore/controls#…` for detail.
  - Anchors other pages will link to: `#light-and-dark` (7.15's FAQ), `#help-shortcuts-and-the-tour`, `#keyboard-shortcuts`, `#sidebar` (VitePress slugs: the comma in "Help, shortcuts and the tour" becomes a separator).

**Tests:**

- `pnpm docs:images:check` and `docs-images.test.ts` pass (pairs on index and structures; `explore/index.md` out of `STALE_PAGES`).
- Verification: `pnpm docs:screenshots -g "interface-overview|app-bar|view-bar|scatterplot-example.png|legend-panel|structure-viewer|theme-switch"`; `pnpm docs:animations -g "sidebar-fold-resize.gif" && pnpm docs:gifs sidebar-fold-resize` (sandbox disabled, network for Mol*); `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`; `pnpm docs:build`; prettier.
- Unrun at task time: none.

Notes for the implementer:

- Scenes contain no `waitForTimeout`, no `.evaluate(` and no `shadowRoot` (7.4's test in `docs-images.test.ts` fails them). Pacing in the GIF is `cap.hold(ms)`; everything else waits on a signal (an attribute, a role's visibility, `waitForStructureLoaded`). `clickProteinNearPlotCentre` and `boundingBox()` are allowed: the first is a helper, the second is not an evaluate.
- A click on a protein selects it, loads its structure and pins its tooltip at the point. The overview keeps the pinned tooltip: it is what a user sees after that click. The runner parks the pointer at (1, 1) before the shutter and asserts no kit tooltip is open; the plot's pinned tooltip is not a kit tooltip.
- The structure captures load the real Mol* (jsDelivr) and AlphaFold. The product demo is reviewed UniProt venom proteins, which have AlphaFold models; if `waitForStructureLoaded` times out, the protein nearest the centre had none: report its id, do not swap in a stub.
- Markdown pairs use `{.light-only}`/`{.dark-only}`, which 7.9 verified in the built HTML. If 7.9 found markdown-it-attrs drops the class and switched its pair to raw `<img>`, write this page's markdown pairs as raw `<img>` too (light twin first, dark twin on the next line with `loading="lazy"`).
- A raw `<img>` in a pair keeps `display` out of its inline `style`: an inline `display: block` beats the head rule's `display: none` (7.9) and both twins would show. The pair lint (7.5) reads each tag on one line, the dark twin on the line right after the light one, with `loading="lazy"`.

- [ ] **Step 1: Write the scenes**

Create `scripts/docs-screenshots/scenes/overview.ts`:

```ts
/**
 * The interface overview (`docs/explore/index.md`): the whole workbench, each bar, the plot, the
 * legend, the docked structure, the Theme menu, and a GIF of the sidebar folding and resizing.
 * Ported from the old static captures (interface-overview 177, scatterplot-example 186,
 * legend-panel 195, structure-viewer 204 at a8cb13ca), on the workbench's helpers.
 */
import { expect, type Page } from '@playwright/test';
import { appBar, plotArea, viewBar } from '../../../apps/web/tests/helpers/explore';
import { legend } from '../../../apps/web/tests/helpers/legend';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';
import { themeButton } from '../../../apps/web/tests/helpers/theme';
import {
  clickProteinNearPlotCentre,
  rail,
  structurePanel,
} from '../../../apps/web/tests/helpers/workbench';
import type { CaptureEntry } from '../capture-plan';
import { around } from './clip';

/** Mol* loads from jsDelivr and the model from AlphaFold: allow for both on a slow network. */
const STRUCTURE_TIMEOUT_MS = 180_000;

/** Selects the protein nearest the plot's centre and waits until Mol* has drawn its structure. */
async function showStructure(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const proteinId = await clickProteinNearPlotCentre(page);
  await waitForStructureLoaded(page, proteinId, 90_000);
}

const themeMenu = (page: Page) => page.getByRole('menu', { name: 'Theme', exact: true });

export const OVERVIEW_CAPTURES: CaptureEntry[] = [
  {
    name: 'interface-overview',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    timeoutMs: STRUCTURE_TIMEOUT_MS,
    steps: showStructure,
    docs: ['explore/index.md'],
  },
  {
    name: 'app-bar',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    target: (page) => appBar(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'view-bar',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    target: (page) => viewBar(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'scatterplot-example',
    kind: 'png',
    viewport: 'desktop',
    target: (page) => plotArea(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'legend-panel',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    target: (page) => legend(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'structure-viewer',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    timeoutMs: STRUCTURE_TIMEOUT_MS,
    steps: showStructure,
    target: (page) => structurePanel(page),
    docs: ['explore/index.md', 'explore/structures.md'],
  },
  {
    name: 'theme-switch',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await themeButton(page).click();
      await expect(themeMenu(page)).toBeVisible();
    },
    target: (page) => around([themeButton(page), themeMenu(page)]),
    docs: ['explore/index.md'],
  },
  {
    name: 'sidebar-fold-resize',
    kind: 'gif',
    viewport: 'desktop',
    steps: async (page, cap) => {
      const workbench = page.locator('.workbench');
      await cap.hold(800);

      await cap.click(rail(page).getByRole('button', { name: 'Collapse sidebar' }));
      await expect(workbench).toHaveAttribute('data-sidebar', 'collapsed');
      await cap.hold(1_200);

      await cap.click(rail(page).getByRole('button', { name: 'Expand sidebar' }));
      await expect(workbench).toHaveAttribute('data-sidebar', 'open');
      await cap.hold(1_000);

      const edge = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
      if (!edge) throw new Error('The sidebar edge is not shown');
      const from = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
      const wider = { x: from.x - 120, y: from.y };
      await cap.moveTo(from, { steps: 15 });
      await cap.hold(300);
      await cap.drag(from, wider, { steps: 30 });
      await cap.hold(800);
      await cap.drag(wider, from, { steps: 30 });
      await cap.hold(1_200);
    },
    docs: ['explore/index.md'],
  },
];
```

`collapseSidebar`, `expandSidebar` and `dragSidebarEdge` act without the GIF's cursor and click overlays, so the GIF goes through `cap` with the same locators those helpers use (the rail's "Collapse sidebar"/"Expand sidebar" buttons, the separator "Resize sidebar"); `sidebar`, `proteinScreenPosition` are not needed here. If a helper or `CaptureApi` member named above has a different signature in the 7.2–7.4 code, follow the code and say so in the report.

In `scripts/docs-screenshots/manifest.ts`, add next to the other scene imports

```ts
import { OVERVIEW_CAPTURES } from './scenes/overview';
```

and append `...OVERVIEW_CAPTURES` as the last element of the `MANIFEST` array (after the scenes 7.3, 7.4 and 7.9 put there).

- [ ] **Step 2: Run the media check to see it fail**

Run: `pnpm docs:images:check`
Expected: FAIL (exit 1). Among the messages: the new outputs missing on disk (`interface-overview-dark.png`, `app-bar.png`, `app-bar-dark.png`, `view-bar.png`, `view-bar-dark.png`, `legend-panel-dark.png`, `structure-viewer-dark.png`, `theme-switch.png`, `theme-switch-dark.png`, `sidebar-fold-resize.gif`), and outputs `explore/index.md` does not reference (`app-bar.png`, `view-bar.png`, `theme-switch.png`, `sidebar-fold-resize.gif`, the dark twins).

Run: `pnpm exec playwright test --project=docs-png --list -g "interface-overview|app-bar|view-bar|scatterplot-example.png|legend-panel|structure-viewer|theme-switch"`
Expected: 13 titles: `interface-overview.png`, `interface-overview-dark.png`, `app-bar.png`, `app-bar-dark.png`, `view-bar.png`, `view-bar-dark.png`, `scatterplot-example.png`, `legend-panel.png`, `legend-panel-dark.png`, `structure-viewer.png`, `structure-viewer-dark.png`, `theme-switch.png`, `theme-switch-dark.png`.

- [ ] **Step 3: Capture the images**

Run (sandbox disabled, network for Mol* and AlphaFold): `pnpm docs:screenshots -g "interface-overview|app-bar|view-bar|scatterplot-example.png|legend-panel|structure-viewer|theme-switch"`
Expected: 13 passed; the files above written under `docs/explore/images/` (desktop 1280×720 at device scale 2: the full page is 2560×1440).

Run (sandbox disabled): `pnpm docs:animations -g "sidebar-fold-resize.gif" && pnpm docs:gifs sidebar-fold-resize`
Expected: 1 passed, then the converter prints its rungs and writes `docs/explore/images/sidebar-fold-resize.gif` at most 3,145,728 bytes.

Open each image and check, before writing the page: the overview shows a selected protein with its structure drawn in the sidebar and the selection bar on the plot, and no tour or kit tooltip; the dark twins have the dark surface (the plot's background is dark, the structure's canvas too); the Theme crop shows the button and the open menu with System checked; the GIF starts on the loaded plot, folds to the rail, comes back and widens and narrows the sidebar, with the cursor overlay visible. Report each file with its size (`ls -l docs/explore/images/{interface-overview,app-bar,view-bar,scatterplot-example,legend-panel,structure-viewer,theme-switch}*.png docs/explore/images/sidebar-fold-resize.gif`).

- [ ] **Step 4: Rewrite the overview page**

Replace the contents of `docs/explore/index.md`:

```md
# Interface Overview

The Explore page is a workbench for protein embeddings: a map of your proteins in the middle, two bars above it, and a sidebar beside it.

<img src="./images/interface-overview.png" class="light-only" alt="The Explore workbench: the app bar and view bar at the top, the scatterplot with one protein selected, and the sidebar with the legend and the protein's 3D structure" width="1280" height="720" loading="eager" fetchpriority="high" />
<img src="./images/interface-overview-dark.png" class="dark-only" alt="The Explore workbench: the app bar and view bar at the top, the scatterplot with one protein selected, and the sidebar with the legend and the protein's 3D structure" width="1280" height="720" loading="lazy" />

## Page layout

| Area        | Where             | What it holds                                                          |
| ----------- | ----------------- | ---------------------------------------------------------------------- |
| **App bar** | Top               | The dataset name, search, Import, Export, the theme and Help           |
| **View bar** | Below the app bar | Projection, Color by, Contours and Filter                             |
| **Plot**    | Centre            | The scatterplot, its tools, the selection bar and the status chips     |
| **Sidebar** | Right             | The Legend, Structure and Filter panels, switched from the rail        |

## App bar

![The app bar: the ProtSpace logo, the dataset name and protein count, search, Import, Export, Theme and Help](./images/app-bar.png){.light-only}
![The app bar: the ProtSpace logo, the dataset name and protein count, search, Import, Export, Theme and Help](./images/app-bar-dark.png){.dark-only}

- **Dataset name** shows what is loaded and how many proteins it holds. Click it for the [dataset menu](/explore/controls#dataset-menu): the example datasets, your last file and **Open a file…**.
- **Search** finds proteins by ID; paste a list of IDs to select them all at once. See [Search](/explore/controls#search).
- **Import** and **Export** load data and save images, figures and data. See [Importing Data](/explore/importing-data) and [Exporting Results](/explore/exporting).
- **Theme** switches between System, Light and Dark; see [Light and dark](#light-and-dark).
- **Help** has the documentation, the keyboard shortcuts and the tour; see [Help, shortcuts and the tour](#help-shortcuts-and-the-tour).

## View bar

![The view bar: Projection with its details button, Color by, Contours and Filter](./images/view-bar.png){.light-only}
![The view bar: Projection with its details button, Color by, Contours and Filter](./images/view-bar-dark.png){.dark-only}

- **Projection** picks the 2D map: PCA, UMAP, t-SNE, PaCMAP, MDS or LocalMAP. The button beside it opens the [projection details](/explore/scatterplot#projection-metadata), with the projection's quality scores and settings.
- **Color by** picks the annotation that colours the points.
- **Contours** draws density rings for each legend colour: Off, Auto or Always.
- **Filter** opens the [Filter panel](/explore/filter) in the sidebar.

The bar never wraps. In a narrow window the labels shorten first, then Contours and Filter move into **More**. Each control is described on [Bars and Tools](/explore/controls#view-bar).

## Plot

The plot shows your proteins as points in 2D. Points close together have similar embeddings. Both axes share one scale, so a distance reads the same in every direction.

![The scatterplot, with the tool strip in its top-left corner and the protein count in its bottom-left corner](./images/scatterplot-example.png)

- **Scroll** to zoom and **drag** to pan; **double-click** the background to reset the zoom.
- **Click** a point to select it and see its structure; **⌘/Ctrl + click** adds a point to the selection or takes it out.
- The [tool strip](/explore/controls#selection-tools) in the top-left corner switches between Move and zoom, Box select and Lasso select, and fits every point back in view.
- With a selection, the [selection bar](/explore/controls#selection-bar) at the bottom offers Show only these, Zoom to them, Copy IDs and Clear.
- [Status chips](/explore/controls#status-chips) in the bottom-left corner, beside the protein count, say what is hidden; their ✕ shows it again, and [Undo](/explore/controls#undo-and-redo) takes back the last step.

[Navigating the Scatterplot](/explore/scatterplot) has the details.

## Sidebar

The rail on the sidebar's right edge switches between its three panels and folds the sidebar away:

- **Legend** shows the categories of the current colouring.
- **Structure** shows the selected protein in 3D; a dot on its rail button means a protein is loaded.
- **Filter** builds a [filter](/explore/filter) from annotation values.

**Collapse sidebar**, the rail's last button, folds the sidebar to the rail and gives the plot the whole width; **Expand sidebar** brings it back. Drag the sidebar's left edge to make it wider or narrower.

![Folding the sidebar to the rail, bringing it back, then dragging its left edge](./images/sidebar-fold-resize.gif)

### Legend

<img src="./images/legend-panel.png" class="light-only" alt="The legend: the colour-by annotation in its header with the sort and settings buttons, and one row per category with its count" width="300" />
<img src="./images/legend-panel-dark.png" class="dark-only" alt="The legend: the colour-by annotation in its header with the sort and settings buttons, and one row per category with its count" width="300" loading="lazy" />

- Click a row to hide or show its category; double-click it to show only that one.
- Drag a row by its handle to reorder; higher rows are drawn on top in the plot.
- The sliders button in the header opens **Legend settings**; the sort button orders the rows.
- Scored datasets add [separation score strips](/explore/separation-scores) above the rows.
- Annotations with [transferred values](/explore/eat) add a `Predicted (transferred)` section.

[Using the Legend](/explore/legend) has the details.

### Structure

Selecting a protein loads its AlphaFold structure under the legend. A row of links under its title opens the protein's [AlphaFold Database](https://alphafold.ebi.ac.uk/), [UniProt](https://www.uniprot.org/), [InterPro](https://www.interpro.org/) and [TED](https://ted.cathdb.info/) entries in new tabs. Drag the divider above it to share the height with the legend, or pop the structure out to float over the plot.

<img src="./images/structure-viewer.png" class="light-only" alt="The structure panel: the protein's name and links, the pLDDT-coloured AlphaFold model, and its colour control" width="300" />
<img src="./images/structure-viewer-dark.png" class="dark-only" alt="The structure panel: the protein's name and links, the pLDDT-coloured AlphaFold model, and its colour control" width="300" loading="lazy" />

[Viewing 3D Structures](/explore/structures) has the details.

## Light and dark

![The Theme menu open in the app bar, with System, Light and Dark](./images/theme-switch.png){.light-only}
![The Theme menu open in the app bar, with System, Light and Dark](./images/theme-switch-dark.png){.dark-only}

The Theme button in the app bar offers three choices:

- **System** follows your operating system's light or dark setting, and changes when it does.
- **Light** and **Dark** stay as you set them.

Your choice is remembered in this browser. The plot, the legend and the 3D structure follow the theme. Exports and figures are always light, so a figure looks the same whichever theme you made it in. On a phone the Theme choice is in **More**.

## Help, shortcuts and the tour

**Help** at the right end of the app bar has three items:

- **Documentation** opens these pages in a new tab.
- **Keyboard shortcuts** lists every shortcut, grouped by where it works.
- **Take the tour** plays the product tour from its first step.

The tour runs once by itself, the first time you open Explore. It points at each part of the workbench in turn; **Skip**, the ✕ or <kbd>Esc</kbd> ends it at any step. If you used ProtSpace before this layout, you see a short **What's new** tour once instead, which shows what moved; its **Full tour** button switches to the whole tour. On a phone, Help is in **More** → **Help & shortcuts**, and the tour uses touch gestures.

## Keyboard shortcuts

**Help** → **Keyboard shortcuts** lists them all. The ones you will use most:

| Keys                        | What they do                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- |
| <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> | Focus the search box                                                      |
| <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> | Undo the last selection, show-only or filter step; add <kbd>⇧</kbd> to redo |
| <kbd>Esc</kbd>              | Close the open menu or dialog; otherwise clear the selection, then return to Move and zoom |
| <kbd>Shift</kbd> + hover    | Focus the category of the point under the pointer                               |
| <kbd>i</kbd>                | In the legend, show only the focused category                                   |

## Next steps

- [Importing Data](/explore/importing-data): load your protein data
- [Bars and Tools](/explore/controls): every control in the bars and on the plot
- [Navigating the Scatterplot](/explore/scatterplot): move around and select proteins
- [Using the Legend](/explore/legend): hide, reorder and style categories
- [Filtering](/explore/filter): narrow the plot to the proteins you need
- [Viewing 3D Structures](/explore/structures): the AlphaFold viewer
```

Then run `pnpm exec prettier --write docs/explore/index.md` (it re-pads the tables; the raw `<img>` lines stay one per line).

Check against the code before committing, and correct the page, not the code, where it differs:

- The Help items' names: `HelpMenu.tsx` ("Documentation", "Keyboard shortcuts", "Take the tour").
- The rail's names: `Rail.tsx` ("Collapse sidebar"/"Expand sidebar", the Structure dot `data-workbench="structure-dot"`).
- The projection list: the projections the Python CLI writes (as the old page listed them); the corners (`#myPlotTools` top-left in `workbench.css`, `protspace-plot-status` bottom-left in `plot-status.styles.ts`); the plot tool names: `plot-tools.ts` ("Move and zoom", "Box select", "Lasso select", "Fit to view"); the selection bar: `selection-bar.ts`.
- The shortcuts: `apps/web/src/workbench/shortcuts.ts` (`Mod K`, `Mod Z`, `Shift Mod Z`, `Escape`, `Shift` hold over a point, `I` on a focused legend row).
- The tour words: 7.6's titles "What's new in ProtSpace", the "Full tour" button and "Skip".
- The anchors into `controls.md` and `filter.md`: 7.9's headings. The media check fails a link whose anchor no heading makes.

In `docs/explore/structures.md`, replace the line

```md
<img src="./images/structure-viewer.png" alt="Structure Viewer - showing 3D protein structure" style="max-width: 50%; display: block; margin: 1em 0;" />
```

with (7.13 rewrites the text around it)

```md
<img src="./images/structure-viewer.png" class="light-only" alt="The structure panel: the protein's name and links, the pLDDT-coloured AlphaFold model, and its colour control" style="max-width: 50%; margin: 1em 0;" />
<img src="./images/structure-viewer-dark.png" class="dark-only" alt="The structure panel: the protein's name and links, the pLDDT-coloured AlphaFold model, and its colour control" style="max-width: 50%; margin: 1em 0;" loading="lazy" />
```

(`display: block` leaves the inline style, or it would override the head rule and show both twins.)

- [ ] **Step 5: Shrink the allowlists**

In `scripts/docs-screenshots/docs-lint.ts`, delete from `LEGACY_IMAGES` the four files this task regenerated:

```ts
  'interface-overview.png',
  'legend-panel.png',
  'scatterplot-example.png',
  'structure-viewer.png',
```

and from `STALE_PAGES`:

```ts
  'explore/index.md',
```

(Leave every other entry: their page tasks remove them.)

- [ ] **Step 6: Run the checks to see them pass**

Run: `pnpm docs:images:check`
Expected: PASS (exit 0, no messages, under 3 s).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, the same count as after 7.9. The real-docs case finds no message: the pairs on `index.md` and `structures.md` are in order with lazy dark twins, every `#anchor` resolves, `explore/index.md` matches no stale term, and `STALE_PAGES`/`LEGACY_IMAGES` list only pages and files that still qualify. If the stale-term check names `explore/index.md`, the page still says something the plan retired (for example "control bar" or "settings dialog"): reword it.

Run: `pnpm docs:build`
Expected: the build succeeds (every image the pages import exists; no dead page link). Then confirm the hero pair: `grep -o '<img[^>]*interface-overview[^>]*>' docs/.vitepress/dist/explore/index.html` shows the light twin with `class="light-only"` and the dark twin with `class="dark-only"` and `loading="lazy"`; quote both lines in the report.

Run: `pnpm exec prettier --check docs/explore/index.md docs/explore/structures.md scripts/docs-screenshots/scenes/overview.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts`
Expected: pass.

Run: `pnpm type-check:scripts && pnpm knip`
Expected: no errors and no findings (`OVERVIEW_CAPTURES` is used by `manifest.ts`).

- [ ] **Step 7: Commit**

```bash
git add scripts/docs-screenshots/scenes/overview.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/index.md docs/explore/structures.md docs/explore/images/interface-overview.png docs/explore/images/interface-overview-dark.png docs/explore/images/app-bar.png docs/explore/images/app-bar-dark.png docs/explore/images/view-bar.png docs/explore/images/view-bar-dark.png docs/explore/images/scatterplot-example.png docs/explore/images/legend-panel.png docs/explore/images/legend-panel-dark.png docs/explore/images/structure-viewer.png docs/explore/images/structure-viewer-dark.png docs/explore/images/theme-switch.png docs/explore/images/theme-switch-dark.png docs/explore/images/sidebar-fold-resize.gif
git commit -m "docs(explore): interface overview for the workbench"
```

(Sandbox disabled for the commit: the hook needs it, and it runs `docs:images:check` and `docs:build`.)

### Task 7.11: Scatterplot page and its images

`explore/scatterplot.md` describes the plot as it is now: the tool strip, the selection bar, the status chips and undo, "N proteins", the keep-proportions rule, the tooltip's "View structure" and the projection details beside Projection. Its three remaining GIFs and two new screenshots are captured.

**Files:**

- Modify: `scripts/docs-screenshots/scenes/scatterplot.ts` (append), `docs/explore/scatterplot.md`
- Regenerate: `select-single.gif`, `select-box.gif`, `duplicate-badges.gif`; create `plot-tools-selection-bar.png`, `plot-tools-selection-bar-dark.png`, `tooltip-projection-card.png`, `tooltip-projection-card-dark.png`
- Modify: `scripts/docs-screenshots/docs-lint.ts` (`LEGACY_IMAGES` loses the three GIFs; `STALE_PAGES` loses `explore/scatterplot.md`)

**Interfaces:**

- Consumes: `SCATTERPLOT_CAPTURES` (7.4); `around` (7.9); `chooseTool`, `selectionBar`, `selectionBarAction`, `statusChip`, `plotArea` (`helpers/explore.ts`); `proteinScreenPosition`, `clusterScreenPoints`, `duplicateStacks` (7.2); the projection details trigger in the view bar (`protspace-projection-metadata`); the strings `plot-tools.ts` ("Move and zoom", "Box select", "Lasso select", "Fit to view"), `selection-bar.ts` ("Show only these", "Zoom to them", "Copy IDs", "Clear"), `plot-status.ts` ("N proteins", "Showing only … · K steps", "Remove filter", "Show hidden categories"); the old scenes (select-single 207, select-box 347, duplicate-badges 459).
- Also consumed (existing, unchanged): `type CaptureApi`, `type CaptureEntry` (`capture-plan.ts`, 7.3; `cap.click(target, { label })`, `cap.press(key, { label })`, `cap.moveTo(target, { steps })`, `cap.drag(from, to, { steps })`, `cap.label(text)`, `cap.hold(ms)`); `viewBar`, `clickLegendItem`, `selectProjection(page, name)` (`helpers/explore.ts`); `legendRowValues`, `toggleLegendSetting(page, 'Show duplicate counts and spread overlaps')`, `closeLegendSettings` (`helpers/legend.ts`); `clickProteinNearPlotCentre` (`helpers/workbench.ts`); `plotTooltip`, `type Point` (`helpers/mobile.ts`); `EXAMPLE_MANIFEST.examples.demo.projections` (`apps/web/src/explore/example-manifest.ts`, holds `'ProtT5 — PCA 2'`); the projection details trigger `button` named "View projection metadata" and its card `#projection-metadata-content` (`role="tooltip"`, `visibility: hidden` until hover or pin; `projection-metadata.ts:288-302`, `.styles.ts:88-121`) inside `#myProjectionMetadata` (`ViewBar.tsx:24`); the spider's SVG nodes `.dup-spiderfy-node-circle` in `#myPlot`'s shadow root (`spiderfy-layer.ts:118`; Playwright's CSS pierces it) and the badge at (+10, −10) px from a stack's centre (`BADGE_OFFSET`).
- Produces:
  - `SCATTERPLOT_CAPTURES` gains `select-single` (click a protein, ⌘/Ctrl-click a second; GIF), `select-box` (box tool drag, the selection bar appears; GIF), `duplicate-badges` (zoom to a stack, open it; GIF, `gif: { fps: 20, width: 800 }` start as today), `plot-tools-selection-bar` (tool strip, selection bar and a status chip, `around` crop of the plot's corners or the plot area; light and dark), `tooltip-projection-card` (a pinned tooltip and the open projection details card; `keepPointer: true`; light and dark). All `docs: ['explore/scatterplot.md']`.
  - `scatterplot.md`: headings kept where other pages link to them (check with the anchor lint); "### Point Position" gains the keep-proportions note (one scale for both axes, live and in exports, wide windows show margin).

**Tests:**

- `pnpm docs:images:check` and `docs-images.test.ts` pass; the three GIFs are within budget.
- Verification: `pnpm docs:animations -g "select-single.gif|select-box.gif|duplicate-badges.gif" && pnpm docs:gifs select-single select-box duplicate-badges`; `pnpm docs:screenshots -g "plot-tools-selection-bar|tooltip-projection-card"`; the app test; `pnpm docs:build`; prettier.
- Unrun at task time: none.

Anchors other pages use today and that must keep resolving: `#navigation` (exporting.md), `#projection-metadata` (index.md after 7.10, controls.md after 7.9), `#protein-tooltip`, `#box-selection`, `#lasso-selection` (control-bar.md before 7.9, so possibly controls.md). The rewrite below keeps every one of those headings. If `pnpm docs:images:check` still reports an anchor on this page that no longer resolves, give the new heading an explicit id with the old slug (`## New heading {#old-slug}`) rather than editing the other page, and say so in the report.

- [ ] **Step 1: Shrink the allowlists (the failing state)**

In `scripts/docs-screenshots/docs-lint.ts`:

(a) In the `LEGACY_IMAGES` set literal, delete the three string entries `'select-single.gif'`, `'select-box.gif'` and `'duplicate-badges.gif'` (one per line in the literal; leave every other entry).

(b) In the `STALE_PAGES` set literal, delete the entry `'explore/scatterplot.md'`.

- [ ] **Step 2: Add the five entries to the scatterplot scenes**

In `scripts/docs-screenshots/scenes/scatterplot.ts` (created by Task 7.4 with the `zoom` entry):

(a) Make sure these imports are present, merging into the file's existing import statements from the same module rather than duplicating them (7.4 already imports some of them, e.g. `CaptureEntry` and `plotSettled`; keep whichever it has):

```ts
import { expect, type Locator, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { EXAMPLE_MANIFEST } from '../../../apps/web/src/explore/example-manifest';
import {
  chooseTool,
  clickLegendItem,
  plotArea,
  selectProjection,
  selectionBar,
  selectionBarAction,
  statusChip,
  viewBar,
} from '../../../apps/web/tests/helpers/explore';
import {
  closeLegendSettings,
  legendRowValues,
  toggleLegendSetting,
} from '../../../apps/web/tests/helpers/legend';
import { plotTooltip, type Point } from '../../../apps/web/tests/helpers/mobile';
import { clickProteinNearPlotCentre } from '../../../apps/web/tests/helpers/workbench';
import { clusterScreenPoints, duplicateStacks } from '../../../apps/web/tests/helpers/plot';
```

(b) Above the `export const SCATTERPLOT_CAPTURES` declaration, add the scene functions:

```ts
// ─── Selection, duplicates and the plot's own chrome (Task 7.11) ───────────────

/** Two families of the demo's default colouring (protein_families) that form their own clusters. */
const PLA2 = 'phospholipase A2';
const THREE_FINGER = 'three-finger toxin';

/** The legend's raw value for a category whose value contains `needle`, case-insensitive. */
async function legendValue(page: Page, needle: string): Promise<string> {
  const values = await legendRowValues(page);
  const value = values.find((v) => v.toLowerCase().includes(needle.toLowerCase()));
  if (!value) throw new Error(`No legend row contains "${needle}"; rows: ${values.join(', ')}`);
  return value;
}

/** A plotted point of `value`'s cluster nearest the cluster's median, in client pixels. */
async function clusterMiddle(page: Page, value: string): Promise<Point> {
  const points = await clusterScreenPoints(page, value, 400);
  if (points.length === 0) throw new Error(`No plotted protein of "${value}"`);
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const mid = Math.floor(points.length / 2);
  const target = { x: xs[mid], y: ys[mid] };
  const distance = (p: Point) => Math.hypot(p.x - target.x, p.y - target.y);
  return points.reduce((best, p) => (distance(p) < distance(best) ? p : best));
}

/**
 * A drag that boxes `value`'s cluster with a 20 px margin, kept clear of the tool strip (left
 * 72 px) and the status corner and selection bar (bottom 56 px).
 */
async function clusterBox(page: Page, value: string): Promise<{ from: Point; to: Point }> {
  const points = await clusterScreenPoints(page, value, 400);
  if (points.length === 0) throw new Error(`No plotted protein of "${value}"`);
  const plot = await plotArea(page).boundingBox();
  if (!plot) throw new Error('The plot area is not shown');
  const pad = 20;
  const clampX = (x: number) => Math.min(Math.max(x, plot.x + 72), plot.x + plot.width - 8);
  const clampY = (y: number) => Math.min(Math.max(y, plot.y + 8), plot.y + plot.height - 56);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    from: { x: clampX(Math.min(...xs) - pad), y: clampY(Math.min(...ys) - pad) },
    to: { x: clampX(Math.max(...xs) + pad), y: clampY(Math.max(...ys) + pad) },
  };
}

/** The selection bar's count reads `text` (its visible count span is aria-hidden). */
async function expectSelected(page: Page, text: string): Promise<void> {
  await expect(selectionBar(page)).toContainText(text);
}

/** The modifier that adds a protein to the selection: the app accepts ⌘ or Ctrl on a click. */
const ADD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
/**
 * One neutral caption: the page runs Desktop Chrome's Windows user agent, so the app's own keycaps
 * read Ctrl, while a GIF made on a Mac would otherwise say ⌘.
 */
const ADD_LABEL = 'Ctrl/⌘ + click';

async function selectSingleSteps(page: Page, cap: CaptureApi): Promise<void> {
  const third = (await legendRowValues(page)).find(
    (v) =>
      v !== 'Other' &&
      v !== '__NA__' &&
      !v.toLowerCase().includes(PLA2.toLowerCase()) &&
      !v.toLowerCase().includes(THREE_FINGER.toLowerCase()),
  );
  if (!third) throw new Error('The legend has no third family to select from');
  const first = await clusterMiddle(page, PLA2);
  const second = await clusterMiddle(page, THREE_FINGER);
  const last = await clusterMiddle(page, third);

  await cap.hold(500);
  await cap.moveTo(first, { steps: 15 });
  await cap.hold(300);
  await cap.click(first, { label: 'Click' });
  await expectSelected(page, '1 protein selected');
  await cap.hold(1200);

  for (const [point, count] of [
    [second, '2 proteins selected'],
    [last, '3 proteins selected'],
  ] as const) {
    await cap.moveTo(point, { steps: 15 });
    await cap.hold(300);
    await page.keyboard.down(ADD_KEY);
    await cap.click(point, { label: ADD_LABEL });
    await page.keyboard.up(ADD_KEY);
    await expectSelected(page, count);
    await cap.hold(1200);
  }

  await cap.press('Escape', { label: 'Esc' });
  await expect(selectionBar(page)).toBeHidden();
  await cap.hold(1000);
}

async function selectBoxSteps(page: Page, cap: CaptureApi): Promise<void> {
  const boxTool = page
    .getByRole('toolbar', { name: 'Plot tools' })
    .getByRole('button', { name: 'Box select', exact: true });
  await cap.hold(500);
  await cap.moveTo(boxTool, { steps: 15 });
  await cap.click(boxTool, { label: 'Box select' });
  await expect(boxTool).toHaveAttribute('aria-pressed', 'true');
  await cap.hold(500);

  const area = await clusterBox(page, PLA2);
  await cap.moveTo(area.from, { steps: 15 });
  await cap.hold(300);
  await cap.drag(area.from, area.to, { steps: 30 });
  await expect(selectionBar(page)).toBeVisible();
  await cap.hold(1500);

  const showOnly = selectionBarAction(page, 'Show only these');
  await cap.moveTo(showOnly, { steps: 15 });
  await cap.click(showOnly, { label: 'Show only these' });
  await expect(statusChip(page, 'isolation')).toBeVisible();
  await cap.hold(1500);

  const showAll = statusChip(page, 'isolation').getByRole('button', {
    name: 'Show all proteins',
    exact: true,
  });
  await cap.moveTo(showAll, { steps: 15 });
  await cap.click(showAll, { label: 'Show all proteins' });
  await expect(statusChip(page, 'isolation')).toHaveCount(0);
  await cap.hold(1000);
}

/** PCA stacks identical projections densely enough to badge; the badges are a legend setting. */
async function duplicateBadgesSetup(page: Page): Promise<void> {
  const pca = EXAMPLE_MANIFEST.examples.demo.projections.find((name) => name.includes('PCA'));
  if (!pca) throw new Error('The demo has no PCA projection');
  await selectProjection(page, pca);
  await toggleLegendSetting(page, 'Show duplicate counts and spread overlaps');
  await closeLegendSettings(page);
  await expect.poll(async () => (await duplicateStacks(page)).length).toBeGreaterThan(0);
}

async function duplicateBadgesSteps(page: Page, cap: CaptureApi): Promise<void> {
  // The largest stack, nearest the median of all stacks, so it sits inside the cluster mass.
  const stacks = await duplicateStacks(page);
  const xs = stacks.map((s) => s.x).sort((a, b) => a - b);
  const ys = stacks.map((s) => s.y).sort((a, b) => a - b);
  const mid = { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
  const anchor = [...stacks].sort(
    (a, b) =>
      b.count - a.count ||
      Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y),
  )[0];

  await cap.hold(500);
  await cap.moveTo(anchor, { steps: 20 });
  await cap.hold(500);
  // The zoom keys off the pointer, which now rests on the stack.
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, -50);
    await cap.hold(50);
  }
  // Stacks are rebuilt on every zoom; read the anchor's new position once it is back.
  const findAnchor = async () =>
    (await duplicateStacks(page)).find((s) => s.key === anchor.key);
  await expect.poll(async () => (await findAnchor()) !== undefined).toBe(true);
  const target = await findAnchor();
  if (!target) throw new Error(`Stack ${anchor.key} dropped during the zoom`);
  await cap.hold(400);

  await cap.moveTo(target, { steps: 8 });
  await cap.click(target, { label: 'Click' });
  const nodes = page.locator('#myPlot .dup-spiderfy-node-circle');
  await expect(nodes.first()).toBeVisible();
  await cap.hold(1100);

  // The spider node farthest from the badge, which sits at (+10, −10) px from the stack.
  const badge = { x: target.x + 10, y: target.y - 10 };
  let farthest: Point | null = null;
  let farthestDistance = -1;
  for (let i = 0; i < (await nodes.count()); i++) {
    const box = await nodes.nth(i).boundingBox();
    if (!box) continue;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const distance = Math.hypot(centre.x - badge.x, centre.y - badge.y);
    if (distance > farthestDistance) [farthest, farthestDistance] = [centre, distance];
  }
  if (!farthest) throw new Error('The spider opened with no node on screen');
  await cap.moveTo(farthest, { steps: 10 });
  await cap.click(farthest, { label: 'Click' });
  await expectSelected(page, '1 protein selected');
  await cap.hold(1500);

  // The badge collapses the spider; the click lands outside the stacked point's hit radius.
  await cap.moveTo(badge, { steps: 6 });
  await cap.click(badge, { label: 'Click' });
  await expect(nodes).toHaveCount(0);
  await cap.hold(900);
}

/** The tool strip with Box select on, the selection bar, and a "1 category hidden" chip. */
async function plotChromeSteps(page: Page, cap: CaptureApi): Promise<void> {
  await chooseTool(page, 'Box select');
  const area = await clusterBox(page, PLA2);
  await cap.drag(area.from, area.to, { steps: 10 });
  await expect(selectionBar(page)).toBeVisible();
  await clickLegendItem(page, await legendValue(page, THREE_FINGER));
  await expect(statusChip(page, 'hidden')).toBeVisible();
}

const projectionCard = (page: Page): Locator =>
  page.locator('#myProjectionMetadata #projection-metadata-content');

/**
 * A click pins a protein's tooltip with "View structure" while the docked structure is folded
 * away with the sidebar; hovering the projection details button then opens its card. A pinned
 * tooltip survives the pointer leaving the plot (only a press outside ends it).
 */
async function tooltipCardSteps(page: Page, cap: CaptureApi): Promise<void> {
  await clickProteinNearPlotCentre(page);
  await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
  const trigger = viewBar(page).getByRole('button', {
    name: 'View projection metadata',
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await cap.moveTo(trigger, { steps: 1 });
  await expect(projectionCard(page)).toBeVisible();
}
```

(c) Append these entries inside the `SCATTERPLOT_CAPTURES` array literal, after the `zoom` entry:

```ts
  {
    name: 'select-single',
    kind: 'gif',
    viewport: 'desktop',
    steps: selectSingleSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'select-box',
    kind: 'gif',
    viewport: 'desktop',
    steps: selectBoxSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'duplicate-badges',
    kind: 'gif',
    viewport: 'desktop',
    gif: { fps: 20, width: 800 },
    setup: duplicateBadgesSetup,
    steps: duplicateBadgesSteps,
    timeoutMs: 120_000,
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'plot-tools-selection-bar',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: plotChromeSteps,
    target: (page) => plotArea(page),
    docs: ['explore/scatterplot.md'],
  },
  {
    name: 'tooltip-projection-card',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    layout: { sidebarOpen: false },
    steps: tooltipCardSteps,
    target: (page) =>
      around(
        [
          plotTooltip(page),
          projectionCard(page),
          viewBar(page).getByRole('button', { name: 'View projection metadata', exact: true }),
        ],
        16,
      ),
    keepPointer: true,
    docs: ['explore/scatterplot.md'],
  },
```

The scenes keep to the capture rules: no `waitForTimeout`, no `.evaluate(`, no `shadowRoot` (the spider nodes are found with Playwright's piercing CSS). Every pause is a `cap.hold`, and `page.mouse.wheel` is the one raw input (the `CaptureApi` has no wheel; the cursor overlay already rests on the stack from the `cap.moveTo` before it).

- [ ] **Step 3: Run the checks and see them fail**

Run: `pnpm type-check:scripts`
Expected: PASS (the scene code type-checks; a failure here is a typo to fix before going on).

Run: `pnpm exec playwright test --project=docs-gif --list | grep -E "select-single|select-box|duplicate-badges"` and `pnpm exec playwright test --project=docs-png --list | grep -E "plot-tools-selection-bar|tooltip-projection-card"`
Expected: the titles `select-single.gif`, `select-box.gif`, `duplicate-badges.gif`, and `plot-tools-selection-bar.png`, `plot-tools-selection-bar-dark.png`, `tooltip-projection-card.png`, `tooltip-projection-card-dark.png`.

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL in the real-docs case: `lintDocs` reports stale terms on `explore/scatterplot.md`, now that it left `STALE_PAGES` (the Box Selection steps still say "Click the **Select** button in the control bar").

Run: `pnpm docs:images:check`
Expected: exit 1, listing the four missing outputs `plot-tools-selection-bar.png`, `plot-tools-selection-bar-dark.png`, `tooltip-projection-card.png`, `tooltip-projection-card-dark.png`; the three old GIFs over the 3,145,728-byte budget (`select-single.gif` 6,006,162, `select-box.gif` 4,470,654, `duplicate-badges.gif` 5,110,066); and the new outputs not referenced by `explore/scatterplot.md`.

- [ ] **Step 4: Capture the images**

With the Bash sandbox disabled (the runner starts its own server on 8096 and a headed Chromium; the plain clicks load real structures from AlphaFold, so it needs network):

Run: `pnpm docs:animations -g "select-single.gif|select-box.gif|duplicate-badges.gif" && pnpm docs:gifs select-single select-box duplicate-badges`
Expected: three tests pass; the converter prints each rung's fps, width and size and writes each GIF at the first rung within 3 MiB (`duplicate-badges` starts at 20 fps, 800 px). If a GIF is still over budget at 15 fps and 640 px, the run exits 1 and keeps its `.webm`: shorten that scene's `cap.hold` pauses (the last hold first, then the ones after each step) and re-run that one GIF, rather than raising its budget. Report the final rung and size of each.

Run: `pnpm docs:screenshots -g "plot-tools-selection-bar|tooltip-projection-card"`
Expected: four tests pass and write the four PNGs.

Run: `ls -l docs/explore/images/select-single.gif docs/explore/images/select-box.gif docs/explore/images/duplicate-badges.gif docs/explore/images/plot-tools-selection-bar*.png docs/explore/images/tooltip-projection-card*.png`
Expected: seven files; each GIF at most 3,145,728 bytes.

Open each image and check what it shows: the GIFs start on the loaded plot (no loading screen) with the cursor overlay; `select-single` ends with the selection cleared by Esc; `select-box` shows the dashed box, the selection bar, then the "Showing only … · 1 step" chip and its removal; `duplicate-badges` opens a spider, selects one node and collapses it; `plot-tools-selection-bar` shows the tool strip with Box select pressed, the selection bar and the "1 category hidden" chip; `tooltip-projection-card` shows the pinned tooltip with View structure and the open card, and its `-dark` twin is dark around a dark card.

- [ ] **Step 5: Rewrite the scatterplot page**

Replace the whole of `docs/explore/scatterplot.md` with the text below. It already uses the links Task 7.9 moved (`/explore/controls#contours`, `/explore/controls#search`, `/explore/controls#color-by`, `/explore/controls#projection`). If Task 7.9 placed the light/dark pair in `docs/explore/filter.md` as raw `<img>` tags because markdown-it-attrs dropped the class (check with `grep -n "filter-panel" docs/explore/filter.md`), write the two pairs below in that same raw form instead (`<img src="./images/x.png" alt="…" class="light-only" />` then `<img src="./images/x-dark.png" alt="…" class="dark-only" loading="lazy" />`).

````md
# Navigating the Scatterplot

The scatterplot is the main visualization area where proteins appear as points. Learn how to navigate, select, and explore your data.

## Quick Reference

| Action                   | How                                                                 |
| ------------------------ | ------------------------------------------------------------------- |
| Zoom in/out              | Mouse wheel, or pinch on a touch screen                             |
| Pan                      | Drag the background with **Move and zoom** on                       |
| Fit every protein        | Double-click the background, or **Fit to view** in the tool strip   |
| Focus a category         | Hold **Shift** and hover a point                                    |
| Select one               | Click a point                                                       |
| Add or remove one        | **⌘/Ctrl** + click a point                                          |
| Box or lasso select      | Pick **Box select** or **Lasso select** in the tool strip, then drag |
| Clear the selection      | Press **Escape**, or **Clear** in the selection bar                 |
| Back to **Move and zoom** | Press **Escape** again                                              |
| Undo / redo              | **⌘/Ctrl + Z** / **⇧ + ⌘/Ctrl + Z**                                  |
| Focus search             | **⌘/Ctrl + K**                                                      |

## Navigation

![Zooming and panning](./images/zoom.gif)

- **Zoom**: Scroll wheel or pinch gesture
- **Pan**: Drag the background while **Move and zoom** is the active tool
- **Reset**: Double-click the background, or press **Fit to view** at the bottom of the tool strip,
  to fit all proteins

Dots grow as you zoom in, so single proteins stay easy to see and to hover: a dot's radius is ×1.4
at 4× zoom, ×2 at 16×, and never more than ×4. Zooming out never shrinks them below their unzoomed
size, which you set with the shape size in the [legend](/explore/legend#shared-settings). Until you
pick one, it [follows the dataset's protein count](/explore/legend#default-dot-size): 10 up to
10,000 proteins, smaller for larger datasets. Dots are
also a little larger on a big plot and a little smaller on a small one (×0.8 to ×1.5 against a
1000 × 700 px plot), and the same size on every pixel density. Hovering picks a dot anywhere within
its drawn radius, or within 4 px of its centre when it is smaller than that.

To see where categories concentrate when their points overlap, turn on
[Contours](/explore/controls#contours).

## Status corner

The bottom-left corner of the plot shows how many proteins you can see, as `N proteins`, followed by
`· Zoomed in` while you are zoomed in. Proteins of hidden legend values are not counted, and in a
narrowed view only the proteins in that view count. Each protein id counts once, so a protein that
appears on more than one point is not counted twice.

Beside the count, a chip says each way the view is narrowed:

| Chip                                 | Press the text to          | Its ✕                      |
| ------------------------------------ | -------------------------- | -------------------------- |
| `Filtered · N conditions`            | open the Filter panel      | **Remove filter**          |
| `Showing only N proteins · K steps`  | (nothing to open)          | **Show all proteins**      |
| `N categories hidden`                | open the legend            | **Show hidden categories** |

See [Filtering](/explore/filter) for the filter and [Show And Hide Values](/explore/legend#show-and-hide-values)
for hidden categories.

## Selection

![The plot with Box select on, the selection bar and a hidden-category chip](./images/plot-tools-selection-bar.png){.light-only}
![The plot with Box select on, the selection bar and a hidden-category chip](./images/plot-tools-selection-bar-dark.png){.dark-only}

The tool strip in the plot's top-left corner picks what a drag on the plot does: **Move and zoom**
(the default), **Box select** or **Lasso select**. **Fit to view** sits below them. Box and lasso
are unavailable while the view holds fewer than two points.

### Single & Multi-Select

![Single selection](./images/select-single.gif)

- **Click** a point to select it, and show its structure
- **⌘ + click** (Mac) or **Ctrl + click** (Windows, Linux) to add a point to the selection, or
  remove it
- Click the only selected point again to deselect it
- Choose an already selected (marked) suggestion in the [search box](/explore/controls#search) to
  deselect it

### Box Selection

![Box selection](./images/select-box.gif)

1. Pick **Box select** in the tool strip
2. Drag to draw a rectangle
3. All proteins inside are added to the selection

### Lasso Selection

1. Pick **Lasso select** in the tool strip
2. Drag to draw a freeform outline around proteins
3. Release to add all enclosed proteins to the selection

The lasso needs at least 3 points to form a valid area.

::: tip Adding to a selection
While **Box select** or **Lasso select** is on, every click, box and lasso adds to the selection,
and a click on a selected protein removes it. With **Move and zoom**, a click selects just that
protein.
:::

### The selection bar

While proteins are selected, a bar at the bottom of the plot shows how many and what you can do
with them:

- **Show only these** narrows the plot to the selection. Each time you do it is one step of the
  `Showing only … · K steps` chip; its ✕ (**Show all proteins**) brings every protein back.
- **Zoom to them** fits the view to the selected proteins.
- **Copy IDs** copies their identifiers, one per line.
- **Clear** empties the selection.

### Clearing

- Press **Escape** to clear the selection (first press), then to go back to **Move and zoom**
  (second press). Escape closes an open menu, popover or pinned tooltip first.
- Press **Clear** in the selection bar

### Undo and redo

**⌘Z** (Mac) or **Ctrl+Z** undoes the last selection change, **Show only these** step, or filter
Apply or Reset; **⇧⌘Z** or **Ctrl+Shift+Z** redoes it. Undo does nothing while the cursor is in a
text field, where these keys edit the text.

## Understanding the Display

### Point Position

Points close together have similar embeddings - often indicating similar structure, function, or evolutionary history.

Both axes share one scale, so a cluster keeps its shape whatever the size of the window: the plot
fits the data's extent inside the plot area and centres it, and a window wider than the data shows
margin at the sides (a taller one, above and below). Opening or closing the sidebar changes how
much room the plot has, never the clusters' proportions. Exported images use the same rule, so a
figure has the shape you see on screen. A projection whose first axis spans much more than its
second, as PCA often does, shows as a band rather than filling the plot.

### Point Colors

- **Categorical** (reviewed, protein family, species): Unique color per category
- **Multi-label** (EC numbers, domains): Pie charts showing multiple values

### Protein Tooltip

Hover over a point to see a tooltip with details about that protein:

- **Protein ID** and **UniProtKB ID** (if available)
- **Protein name** and **Gene name** (if available)
- **Annotation values** for the currently selected annotation
- **Scores** (for InterPro domain annotations, e.g., E-values) or **evidence codes** (for GO terms, subcellular location, etc., e.g., EXP, IDA)

Protein name, gene name, and UniProtKB ID are tooltip-only and don't appear in the
[Color by menu](/explore/controls#color-by).

When the structure cannot be seen (on a desktop, while the sidebar is collapsed with the structure
docked in it), a click on a point pins its tooltip with a **View structure** button, which opens
the sidebar and shows that protein's structure. On a phone, a tap pins the tooltip and **View
structure** expands the structure sheet. A pinned tooltip closes on **Escape**, a press outside
the plot, the next click, or a pan or zoom.

### Focusing a Category

Hold **Shift** while hovering a point to see where its category sits: every protein sharing one of its values in the current annotation stays bright, everything else fades. Move to another point to switch category; release **Shift** or move off the point to go back.

- Hovering a point in the legend's **Other** group focuses the whole group
- Hidden legend values stay hidden, and the tooltip is hidden while focusing
- Focus is only a preview: it does not change the selection, and it is off while proteins are selected

### Duplicate Points

When multiple proteins share the exact same coordinates, a **count badge** appears on the point
once **Show duplicate counts and spread overlaps** is on in the [legend settings](/explore/legend#settings).
Click a stacked point to spread it into a spider layout showing each protein; click a protein in
the spider to select it, and click the badge or press **Escape** to fold it again.

![Duplicate-count badges persist across projections](./images/duplicate-badges.gif)

### Projection Metadata

![A pinned protein tooltip and the projection details card](./images/tooltip-projection-card.png){.light-only}
![A pinned protein tooltip and the projection details card](./images/tooltip-projection-card-dark.png){.dark-only}

A small ⓘ button sits beside **Projection** in the view bar. Hover it (or focus it with the
keyboard) to open a **Projection Metadata** card describing the current projection. Click the
button to pin the card open, so you can scroll it and read the ⓘ popovers inside without keeping
the pointer on the card. **Escape** or a click outside closes it; switching projections updates it.

::: tip
The button only appears when the loaded bundle has something to show: reduction parameters,
faithfulness metrics, or statistics for the annotation you are colouring by, either its separation
in this projection or, for a clustering, its Recovers table. Any one is enough, so a bundle prepared
with `--stats` but no projection metadata still gets a card, and a clustering found in another
projection gets one on Recovers alone. A bundle carrying none of them shows no button at all.
:::

The card's header is the projection's own name. Below it, in order:

- **Separation, scored on `<annotation>`**, how cleanly the current annotation's categories separate
  in this projection, with the source embedding's own scores beside them as a reference. Documented on
  [Separation Scores](/explore/separation-scores).
- **Recovers**, only when the current annotation is a `cluster_elbow_*` / `cluster_silhouette_*`
  clustering: how closely that clustering reproduces each real annotation. Documented under
  [Cluster Annotations](/explore/separation-scores#cluster-annotations).
- **Faithfulness to the embedding**, described below.
- **How it was made**, described below.

#### Faithfulness to the embedding

How well the 2D or 3D layout preserves the structure of the original high-dimensional embedding, as
one labelled row per metric under two group headings. Every row carries its value and its own ⓘ
popover.

**Local — are the same proteins still neighbours?**

- **kNN Overlap**, fraction of each point's k nearest neighbors preserved in the projection
- **Trustworthiness**, penalizes points pulled together in the projection that were far apart
- **Continuity**, penalizes points pushed apart in the projection that were close together

**Global — is the overall layout preserved?**

- **Random Triplet**, fraction of random point triplets whose relative ordering survives
- **Spearman Distance**, rank correlation between high-dimensional and projected pairwise distances

The neighborhood size `k`, the high-dimensional distance metric, and the source embedding are the
same for every metric, so no row repeats them: one scope line covers all of them, such as
`811 proteins compared`, gaining `· subsampled` when the comparison ran on a subsample. These
metrics travel in the projection metadata (`info_json.quality`), not in the statistics part, so they
appear whether or not the bundle was built with `--stats`.

#### How it was made

The parameters the dimensionality-reduction method was run with, read from the bundle's projection
metadata table. **Source** names the embedding the projection was computed from, which is useful
when a bundle contains projections from several embeddings. The rest depend on the method:

- **PCA**, `N Components`, plus `Explained Variance Ratio` (one value per component)
- **UMAP**, `N Neighbors`, `Min Dist`, `Metric`, `Random State`, and the rest of the UMAP
  parameter set

Two things are deliberately absent from the list: the dimension count, which you already pick in the
[Projection menu](/explore/controls#projection), and the projection's name, which is the card header
rather than a row.

#### Across the whole card

Values anywhere on the card are formatted for readability: whole numbers print as-is, other numbers
are rounded to three decimals (two for explained-variance values), booleans show as **Yes**/**No**,
lists are comma-separated, and a value that is missing or could not be computed shows as `N/A`.

Whenever the card carries any scores at all, separation or faithfulness, it ends with a footer
reading `All scores are for the full dataset.`, becoming
`All scores are for the full dataset, not this view.` while a filter or isolation narrows the plot,
for the reason on [Separation Scores](/explore/separation-scores#scores-cover-the-whole-dataset).
````

Then format it: `pnpm exec prettier --write docs/explore/scatterplot.md` (Prettier realigns the tables).

The links `/explore/legend#settings` and `/explore/legend#show-and-hide-values` point at headings `legend.md` has today ("## Settings", "## Show And Hide Values"); Task 7.12 keeps both.

- [ ] **Step 6: Run the checks and see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS (no stale term on the page; both pairs in order; no orphan; every anchor resolves). Give the test count before and after.

Run: `time pnpm docs:images:check`
Expected: PASS in under 3 s.

Run: `pnpm type-check:scripts && pnpm knip`
Expected: PASS.

Run: `pnpm docs:build`
Expected: PASS (every image path resolves; no dead page link).

Run: `pnpm exec prettier --write scripts/docs-screenshots/scenes/scatterplot.ts scripts/docs-screenshots/docs-lint.ts docs/explore/scatterplot.md && pnpm exec prettier --check scripts/docs-screenshots/scenes/scatterplot.ts scripts/docs-screenshots/docs-lint.ts docs/explore/scatterplot.md`
Expected: PASS (the write only reflows; re-read any file it changed).

No e2e spec and no app code changed; the full suites wait for the phase exit.

- [ ] **Step 7: Commit**

With the Bash sandbox disabled (the hook runs `pnpm precommit`):

```bash
git add scripts/docs-screenshots/scenes/scatterplot.ts scripts/docs-screenshots/docs-lint.ts docs/explore/scatterplot.md docs/explore/images/select-single.gif docs/explore/images/select-box.gif docs/explore/images/duplicate-badges.gif docs/explore/images/plot-tools-selection-bar.png docs/explore/images/plot-tools-selection-bar-dark.png docs/explore/images/tooltip-projection-card.png docs/explore/images/tooltip-projection-card-dark.png
git commit -m "docs(explore): scatterplot page for the workbench"
```

Report the seven image files with their sizes (and each GIF's final fps and width), and `git status` showing nothing else changed.

### Task 7.12: Legend page and its images

`explore/legend.md` describes the 28-px rows, the hover eye, handle and "⋯" menu, "Show only this", the Other popover with search and "Add to legend", the settings popover that applies as it changes, and the Sort menu. Three GIFs and two popover screenshots.

**Files:**

- Create: `scripts/docs-screenshots/scenes/legend.ts`
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs/explore/legend.md`, `scripts/docs-screenshots/docs-lint.ts` (`LEGACY_IMAGES` loses the three GIFs; `STALE_PAGES` loses `explore/legend.md`)
- Regenerate: `legend-toggle.gif`, `legend-reorder.gif`, `legend-others.gif`; create `legend-settings.png`, `legend-settings-dark.png`, `legend-other-popover.png`, `legend-other-popover-dark.png`

**Interfaces:**

- Consumes: the runner (7.3, 7.4); `around` (7.9); `legend`, `legendRow`, `legendRowAction`, `clickLegendItem`, `openLegendOther`, `addFromOther`, `openLegendSettings`, `setLegendSort` (`helpers/legend.ts`); `dragLegendRow`, `doubleClickLegendRow` (7.2); strings `legend-row-menu.ts` ("Show only this", "Colour and shape"), `legend-header.ts` (Sort legend: "By count", "By name", "By separation", "Your order", "Reverse order"), the settings popover's title "Legend settings"; the old scenes (legend-toggle 681, legend-reorder 781, legend-others 878).
- Also consumed (existing, unchanged): `type CaptureApi`, `type CaptureEntry` (`capture-plan.ts`, 7.3; `cap.click`, `cap.press`, `cap.moveTo`, `cap.drag`, `cap.label`, `cap.hold`); `MANIFEST` in `manifest.ts` (7.3, extended by 7.4, 7.9, 7.10); `legendRowValues`, `isLegendItemHidden`, `legendSortButton`, `legendOtherDialog`, `legendSettingsDialog` (`helpers/legend.ts`); `statusChip` (`helpers/explore.ts`); the row's controls by name: hover eye `Hide {value}` / `Show {value}`, handle `Reorder {value}` (`legend-row.ts:185-210`), the Other row's `View items grouped under Other` (`:169`); the Other popover's search box (`ps-input type="search"`, role `searchbox`, name "Search Other categories") and its `Add to legend: {name}` buttons (`legend-other-popover.ts:126-146`); the sort menu "Sort legend" (`legend-header.ts:164-180`); the colour picker opens only from ⋯ → "Colour and shape" (`legend.ts:414-425`; the swatch is part of the row's toggle button).
- Produces:
  - `scenes/legend.ts`: `export const LEGEND_CAPTURES: CaptureEntry[]` — `legend-toggle` (click hides, eye shows, double-click shows only this; GIF), `legend-reorder` (drag a row by its handle; GIF), `legend-others` (open Other, search, Add to legend; GIF), `legend-settings` (settings popover open beside the legend; light and dark), `legend-other-popover` (Other popover open; light and dark). All `docs: ['explore/legend.md']`.
  - `legend.md`: "Manual order" → "Your order"; the settings section says changes apply at once and Reset restores defaults; the Sort section lists the menu; the swatch also opens from ⋯ → "Colour and shape"; headings other pages link to keep their slugs.

**Tests:**

- `pnpm docs:images:check` and `docs-images.test.ts` pass; the GIFs are within budget.
- Verification: `pnpm docs:animations -g "legend-toggle.gif|legend-reorder.gif|legend-others.gif" && pnpm docs:gifs legend-toggle legend-reorder legend-others`; `pnpm docs:screenshots -g "legend-settings|legend-other-popover"`; the app test; `pnpm docs:build`; prettier.
- Unrun at task time: none.

Headings other pages link to, which the rewrite keeps: "## Show And Hide Values" (`#show-and-hide-values`, scatterplot.md after 7.11), "## Settings" (`#settings`, scatterplot.md after 7.11), "### Shared Settings" (`#shared-settings`, scatterplot.md), "### Default dot size" (`#default-dot-size`, scatterplot.md, eat.md, guide/styling.md), "## Predicted Annotations" (`#predicted-annotations`, eat.md). "### Sorting" becomes "## Sorting" (same slug `#sorting`). If `pnpm docs:images:check` reports any other link into this page that no longer resolves, give the new heading an explicit id with the old slug (`## New heading {#old-slug}`) and say so in the report.

The demo's default colouring (protein_families) is the data: it has a "Phospholipase A2" family, a three-finger toxin family, an N/A row and an Other row (the old GIFs used all four). The scenes find each by substring and fail with the legend's rows in the message if one is missing.

- [ ] **Step 1: Shrink the allowlists (the failing state)**

In `scripts/docs-screenshots/docs-lint.ts`:

(a) In the `LEGACY_IMAGES` set literal, delete the three string entries `'legend-toggle.gif'`, `'legend-reorder.gif'` and `'legend-others.gif'`.

(b) In the `STALE_PAGES` set literal, delete the entry `'explore/legend.md'`.

- [ ] **Step 2: Write the legend scenes**

Create `scripts/docs-screenshots/scenes/legend.ts`:

```ts
/**
 * The legend page's captures (docs/explore/legend.md): hiding and showing, reordering, the Other
 * popover, and the two popovers as stills. The demo colours by protein family.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { statusChip } from '../../../apps/web/tests/helpers/explore';
import {
  doubleClickLegendRow,
  isLegendItemHidden,
  legend,
  legendOtherDialog,
  legendRow,
  legendRowValues,
  legendSettingsDialog,
  legendSortButton,
  openLegendOther,
  openLegendSettings,
} from '../../../apps/web/tests/helpers/legend';

const PLA2 = 'phospholipase A2';
const THREE_FINGER = 'three-finger toxin';
const NA = '__NA__';
const OTHER = 'Other';

/** The legend's raw value for a category whose value contains `needle`, case-insensitive. */
async function legendValue(page: Page, needle: string): Promise<string> {
  const values = await legendRowValues(page);
  const value = values.find((v) => v.toLowerCase().includes(needle.toLowerCase()));
  if (!value) throw new Error(`No legend row contains "${needle}"; rows: ${values.join(', ')}`);
  return value;
}

/** The text a row's name starts with: N/A's raw value is a sentinel, every other one is its label. */
const label = (value: string): string => (value === NA ? 'N/A' : value);

const otherViewButton = (page: Page): Locator =>
  legend(page).getByRole('button', { name: 'View items grouped under Other', exact: true });

/** The open Other popover's element: the scope for its slotted search box and rows. */
const otherPopover = (page: Page): Locator =>
  legend(page).locator('protspace-legend-other-popover');

async function toggleSteps(page: Page, cap: CaptureApi): Promise<void> {
  const hidden = await legendValue(page, PLA2);
  const only = await legendValue(page, THREE_FINGER);

  await cap.hold(500);
  // A click on the row hides the category.
  await cap.moveTo(legendRow(page, hidden), { steps: 15 });
  await cap.hold(300);
  await cap.click(legendRow(page, hidden), { label: 'Click' });
  await expect.poll(() => isLegendItemHidden(page, hidden)).toBe(true);
  await cap.hold(1000);

  // The row's eye, shown on hover, brings it back.
  const eye = legend(page).getByRole('button', { name: `Show ${hidden}`, exact: true });
  await cap.moveTo(eye, { steps: 10 });
  await cap.hold(300);
  await cap.click(eye, { label: 'Show' });
  await expect.poll(() => isLegendItemHidden(page, hidden)).toBe(false);
  await cap.hold(1000);

  // A double click shows only that category; the plot's chip counts the hidden rest.
  await cap.moveTo(legendRow(page, only), { steps: 15 });
  await cap.hold(300);
  await cap.label('Double-click');
  await doubleClickLegendRow(page, only);
  await expect.poll(() => legendRowValues(page, { visible: true })).toEqual([only]);
  await expect(statusChip(page, 'hidden')).toBeVisible();
  await cap.hold(1500);

  // The chip's ✕ shows every category again.
  const showAll = statusChip(page, 'hidden').getByRole('button', {
    name: 'Show hidden categories',
    exact: true,
  });
  await cap.moveTo(showAll, { steps: 20 });
  await cap.hold(300);
  await cap.click(showAll, { label: 'Show all' });
  await expect(statusChip(page, 'hidden')).toHaveCount(0);
  await cap.hold(1000);
}

async function reorderSteps(page: Page, cap: CaptureApi): Promise<void> {
  const values = (await legendRowValues(page)).filter((v) => v !== OTHER);
  if (values.length < 3) throw new Error(`Too few legend rows to reorder: ${values.join(', ')}`);
  // N/A to the top, as the old GIF did; the last row if N/A is missing or already first.
  const moving = values.includes(NA) && values[0] !== NA ? NA : values[values.length - 1];
  const top = values[0];

  await cap.hold(500);
  await cap.moveTo(legendRow(page, label(moving)), { steps: 15 });
  await cap.hold(400);
  const handle = legend(page).getByRole('button', {
    name: `Reorder ${label(moving)}`,
    exact: true,
  });
  const from = await handle.boundingBox();
  const to = await legendRow(page, label(top)).boundingBox();
  if (!from || !to) throw new Error('The drag handle or the first row has no box');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await cap.moveTo(start, { steps: 6 });
  await cap.label('Drag');
  // Above the first row's middle, so the row lands first.
  await cap.drag(start, { x: start.x, y: to.y + 2 }, { steps: 30 });
  await expect.poll(async () => (await legendRowValues(page))[0]).toBe(moving);
  await expect(legendSortButton(page)).toHaveAccessibleName(/^Sort: Your order/);
  await cap.hold(1500);

  // The sort button names the order; its menu puts the rows back by count.
  await cap.moveTo(legendSortButton(page), { steps: 15 });
  await cap.click(legendSortButton(page), { label: 'Sort' });
  const byCount = legend(page).getByRole('menuitemradio', { name: 'By count', exact: true });
  await expect(byCount).toBeVisible();
  await cap.hold(1200);
  await cap.moveTo(byCount, { steps: 10 });
  await cap.click(byCount, { label: 'By count' });
  await expect(legendSortButton(page)).toHaveAccessibleName(/^Sort: By count/);
  await cap.hold(1200);
}

async function othersSteps(page: Page, cap: CaptureApi): Promise<void> {
  await expect(otherViewButton(page)).toBeVisible();
  await cap.hold(500);
  await cap.moveTo(otherViewButton(page), { steps: 15 });
  await cap.hold(300);
  await cap.click(otherViewButton(page), { label: 'View' });
  await expect(legendOtherDialog(page)).toBeVisible();
  await cap.hold(1200);

  // The third category listed (largest first), found again by typing the first word of its name.
  const adds = otherPopover(page).getByRole('button', { name: /^Add to legend: / });
  const count = await adds.count();
  if (count === 0) throw new Error('The Other popover lists no category');
  const name = ((await adds.nth(Math.min(2, count - 1)).getAttribute('aria-label')) ?? '').replace(
    /^Add to legend: /,
    '',
  );
  const term = name.split(/\s+/)[0].slice(0, 8);
  const search = otherPopover(page).getByRole('searchbox', {
    name: 'Search Other categories',
  });
  await cap.moveTo(search, { steps: 10 });
  await cap.click(search, { label: 'Search' });
  for (const character of term) {
    await page.keyboard.type(character);
    await cap.hold(120);
  }
  const add = otherPopover(page).getByRole('button', {
    name: `Add to legend: ${name}`,
    exact: true,
  });
  await expect(add).toBeVisible();
  await cap.hold(1000);

  await cap.moveTo(add, { steps: 10 });
  await cap.hold(300);
  await cap.click(add, { label: 'Add to legend' });
  await expect(legendRow(page, name)).toBeVisible();
  await cap.hold(800);
  await cap.press('Escape', { label: 'Esc' });
  await expect(legendOtherDialog(page)).toBeHidden();
  await cap.hold(1500);
}

export const LEGEND_CAPTURES: CaptureEntry[] = [
  {
    name: 'legend-toggle',
    kind: 'gif',
    viewport: 'desktop',
    steps: toggleSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-reorder',
    kind: 'gif',
    viewport: 'desktop',
    steps: reorderSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-others',
    kind: 'gif',
    viewport: 'desktop',
    steps: othersSteps,
    timeoutMs: 120_000,
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-settings',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await openLegendSettings(page);
    },
    target: (page) => around([legend(page), legendSettingsDialog(page)]),
    docs: ['explore/legend.md'],
  },
  {
    name: 'legend-other-popover',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await openLegendOther(page);
    },
    target: (page) => around([legend(page), legendOtherDialog(page)]),
    docs: ['explore/legend.md'],
  },
];
```

`openLegendSettings` and `openLegendOther` return locators; the arrow bodies discard them, so `steps` stays `Promise<void>`.

In `scripts/docs-screenshots/manifest.ts`, add the import next to the other scene imports:

```ts
import { LEGEND_CAPTURES } from './scenes/legend';
```

and append `...LEGEND_CAPTURES` as the last element of the `MANIFEST` array literal.

- [ ] **Step 3: Run the checks and see them fail**

Run: `pnpm type-check:scripts`
Expected: PASS.

Run: `pnpm exec playwright test --project=docs-gif --list | grep legend` and `pnpm exec playwright test --project=docs-png --list | grep legend`
Expected: `legend-toggle.gif`, `legend-reorder.gif`, `legend-others.gif`; `legend-settings.png`, `legend-settings-dark.png`, `legend-other-popover.png`, `legend-other-popover-dark.png` (plus `legend-panel.png` and `legend-panel-dark.png` from 7.10).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL in the real-docs case: stale terms on `explore/legend.md`, now that it left `STALE_PAGES` ("cog icon" in Settings, "settings dialog" three times, "control bar" in Predicted Annotations).

Run: `pnpm docs:images:check`
Expected: exit 1, listing the four missing PNG outputs, the three GIFs over the 3,145,728-byte budget (`legend-toggle.gif` 4,724,156, `legend-reorder.gif` 3,444,447, `legend-others.gif` 5,910,720), and the four PNG outputs not referenced by `explore/legend.md`.

- [ ] **Step 4: Capture the images**

With the Bash sandbox disabled:

Run: `pnpm docs:animations -g "legend-toggle.gif|legend-reorder.gif|legend-others.gif" && pnpm docs:gifs legend-toggle legend-reorder legend-others`
Expected: three tests pass; each GIF is written at the first rung within 3 MiB (report the rung and size). If one is over budget at 15 fps and 640 px, the run exits 1 and keeps its `.webm`: shorten that scene's `cap.hold` pauses (the longest first) and re-run that GIF, rather than raising its budget.

If `legend-reorder` fails at the `legendRowValues(page)[0]` poll (the drop did not reorder), the drag reached Sortable too fast for it to start: replace the `cap.label('Drag')` and `cap.drag(…)` lines with `await cap.label('Drag'); await dragLegendRow(page, label(moving), label(top));` (Task 7.2's helper, proven against the legend; add `dragLegendRow` to the import) and say so in the report; the cursor overlay then shows the start and end of the drag but not the path.

Run: `pnpm docs:screenshots -g "legend-settings|legend-other-popover"`
Expected: four tests pass.

Run: `ls -l docs/explore/images/legend-toggle.gif docs/explore/images/legend-reorder.gif docs/explore/images/legend-others.gif docs/explore/images/legend-settings*.png docs/explore/images/legend-other-popover*.png`
Expected: seven files; each GIF at most 3,145,728 bytes.

Open each one: `legend-toggle` hides Phospholipase A2, shows it from the eye, double-clicks the three-finger family to show only it (the "… categories hidden" chip appears), then clears the chip; `legend-reorder` lifts N/A to the top (Sort reads "Your order") and sorts back by count; `legend-others` opens the popover, filters it, adds a category, and closes it with Esc; the two stills show the popover beside the legend, and each `-dark` twin is dark.

- [ ] **Step 5: Rewrite the legend page**

Replace the whole of `docs/explore/legend.md` with the text below. If Task 7.9 placed the light/dark pair in `docs/explore/filter.md` as raw `<img>` tags because markdown-it-attrs dropped the class (`grep -n "filter-panel" docs/explore/filter.md`), write the two pairs below in that raw form instead (`<img src="./images/x.png" alt="…" class="light-only" />` then `<img src="./images/x-dark.png" alt="…" class="dark-only" loading="lazy" />`).

````md
# Using the Legend

The legend panel lets you filter, customize, and explore protein annotations. Most annotations are categorical, but scalar numeric annotations such as `length` are handled a little differently.

## Rows

Each category is one row: its colour, its name and its protein count. A long name ends in an
ellipsis and shows in full on hover. Hovering a row shows three controls at its right:

- an **eye**, which hides or shows the category,
- a **drag handle**, which moves the row (see [Reordering](#reordering-and-draw-order)),
- a **⋯** menu with **Show only this** and **Colour and shape**.

On a touch screen the controls are always shown and every row is a 40 px target.

## Show And Hide Values

Click any legend row to toggle its visibility:

![Hiding, showing and showing only one category](./images/legend-toggle.gif)

- Click once, or press its eye, to hide that value. A hidden row stays in the list, dimmed, with a
  crossed-out eye.
- Click again, or press the eye again, to show it.
- Double-click a row, or choose **Show only this** from its ⋯ menu, to show that value and hide the
  rest.
- Double-click the only shown value again (its ⋯ menu then reads **Show all**) to show all values.
- If only one value remains visible, clicking it restores the full set.

While categories are hidden, the plot's status corner shows `N categories hidden`; its ✕ shows them
all again. On a touch screen, tap a row to hide or show it and double-tap it to show only that value.

From the keyboard: the arrow keys, **Home** and **End** move between rows, **Enter** hides or shows
the focused row, and **i** shows only it.

## Reordering And Draw Order

Drag a row by its handle up or down to change the draw order in the scatterplot. Items near the top
are drawn on top of items below them.

![Dragging a row to the top, then sorting by count again](./images/legend-reorder.gif)

Dragging switches the annotation's order to **Your order**. On a touch screen, hold the handle for a
moment, then drag. From the keyboard, focus a row's handle, press **Space** to pick the row up, move
it with the arrow keys and press **Space** again to drop it (**Escape** cancels).

## The "Other" Group

Categorical annotations group less frequent values into `Other` once the visible list exceeds the
current legend cap (**Max legend items** in the [settings](#settings)). The row reads
`Other · N categories`.

![Searching Other and adding a category to the legend](./images/legend-others.gif)

- Press **View** on the `Other` row to open a popover listing the grouped values, largest first,
  each with its count.
- Type in its search box to find one, then press **Add to legend** to give it its own row (the
  legend cap rises by one). **Add all** moves every value out of `Other`.
- Drag a row onto `Other` to group it there again.

![The Other popover open beside the legend](./images/legend-other-popover.png){.light-only}
![The Other popover open beside the legend](./images/legend-other-popover-dark.png){.dark-only}

Numeric annotations do **not** use `Other`. They are binned directly from the raw numeric values.

## Transferred Annotations (EAT)

When the selected annotation carries values borrowed from nearby annotated proteins, a `Predicted (transferred)` section appears at the very top of the legend panel, above the separation strips. It holds a `Show` checkbox that adds the borrowed values to the plot and the legend rows, or removes them so those proteins fall back to `N/A`; a reliability filter — a mode dropdown (`Hide below`, `Hide above`, `Keep between`) with a slider, plus a second slider for the band — that hides predictions falling outside the chosen range; and a count of `Observed` against `Predicted by EAT` proteins. Curated values are never hidden by it in any mode, and the section is absent for annotations that have no transferred values.

See [Transferred Annotations (EAT)](/explore/eat) for where the borrowed values come from and how to read them in the plot.

## Separation Score Strips

When the dataset was prepared with statistics and the selected annotation was scored in the current projection, two strips appear near the top of the legend panel, above the category list: one for `Silhouette`, one for `Davies–Bouldin`. Each plots one dot per category, in that category's legend color, so you can see which values sit apart from the rest and which overlap.

- Hovering a dot highlights the matching legend row, and hovering a row highlights its dot.
- Clicking a dot toggles that category, exactly like clicking its legend row.
- While a filter or isolation narrows the view, the strips are replaced by the note `Separation scores are hidden while the view is filtered.`

See [Separation Scores](/explore/separation-scores) for what the numbers mean and how they are computed.

## Sorting

The sort button in the legend's header names the active order, such as `By count`. Press it to open
the **Sort legend** menu:

- **By count**, largest first (categorical annotations)
- **By name** (categorical) or **By value** (numeric)
- **By separation**, only when the selected annotation carries per-category
  [separation scores](/explore/separation-scores) for the current projection: categories ordered by
  how cleanly each one separates. It is display-only: it reorders the list without changing which
  categories fall into `Other`, and it keeps working while the view is filtered.
- **Your order**, the order you dragged the rows into
- **Reverse order**, a checkbox that flips the active order:
  - Numeric `By value`: low-to-high vs high-to-low
  - `Your order`: reverses your order
  - `By separation`: best-separating first vs worst-separating first
  - `By count` and `By name`: the reverse of each

## Settings

The gear in the legend's header opens **Legend settings** for the selected annotation. Changes apply
as you make them: there is no Save button. A number applies a moment after you stop typing, or at
once on **Enter** or when you leave the field.

![The Legend settings popover open beside the legend](./images/legend-settings.png){.light-only}
![The Legend settings popover open beside the legend](./images/legend-settings-dark.png){.dark-only}

**Reset**, at the bottom, restores the defaults for the selected annotation: its colours, order,
hidden categories, palette and item count, and the dataset's point size. It is unavailable while
nothing is changed.

### Shared Settings

| Setting                     | What it does                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Palette**                 | Picks the active palette for the selected annotation from its swatches.                                                                                                                                                                                                                                                                                                           |
| **Max legend items**        | Categorical annotations: maximum number of visible values before grouping into `Other`. Numeric annotations (labelled `Bins`): target maximum number of bins.                                                                                                                                                                                                                      |
| **Shape size / Point size** | Adjusts marker size in the scatterplot (range 1 to 64; a larger size from a bundle or an earlier session is capped at 64). The default follows the dataset's protein count, see [Default dot size](#default-dot-size). The size you pick holds for every annotation of the dataset. Numeric annotations use the label `Point size` because numeric legends always render circles. |
| **Show duplicate counts and spread overlaps** | Shows duplicate count badges and spreads overlapping points when you expand them.                                                                                                                                                                                                                                                                               |

### Default dot size

Until you pick a size, the dot size follows how many proteins the dataset has, so a large dataset
opens with dots small enough that one category does not cover the others:

| Proteins in the dataset | Up to 10,000 | 20,000 | 40,000 | 100,000 | 570,000 |
| ----------------------- | ------------ | ------ | ------ | ------- | ------- |
| Default shape size      | 10           | 6      | 4      | 2       | 1       |

The count is the whole dataset, so hiding categories, filtering or isolating does not change it.
Legend settings show the dataset's default under the size field. A size you type is stored for the
dataset and exported with **Include legend settings**. A size a bundle sets for an annotation, other
than 10 or 30, also overrides the default. To return to the default, clear the size field. This
drops the size you picked and every size a bundle set per annotation, but keeps the annotation's
other settings. `Reset` does the same for the size, and also resets the selected annotation's
colours, order and hidden values.

### Numeric Bin Distribution

When the selected annotation is numeric and a numeric gradient palette is active, an extra `Bin distribution` control appears:

- `Linear`
- `Quantile`
- `Logarithmic`

`Quantile` is the default distribution, automatically falling back to `Linear` when the number of distinct values is small enough that quantile edges would collapse. `Logarithmic` is only available when all non-null values are strictly positive; otherwise ProtSpace falls back to `Quantile` (and from there to `Linear`, as above).

### Reverse Gradient Direction

Numeric annotations also have a `Reverse gradient` switch in Legend settings.

- Off: lower numeric values use the low end of the selected gradient and higher values use the high end.
- On: the gradient is flipped so higher numeric values receive the colors that would normally be used for lower values, and vice versa.

This setting is saved with the rest of the numeric legend settings and is restored on reload or bundle import.

## Numeric Annotations

Scalar numeric annotations are stored as raw numbers and binned in the browser from the current numeric settings.

### Numeric Labels

Numeric legend labels are display summaries for humans:

- They use `min - max` formatting instead of comparison syntax like `<`.
- Integer-only data stays integer-only in the legend.
- Decimal labels only appear when the source data actually needs decimal precision.
- Single-value bins are shown as a single number.

The exact runtime bin edges are still used for membership. The displayed label is a summary of the values observed in that bin.

### Why Fewer Bins Can Appear Than The Max

For numeric annotations, `Max legend items` (`Bins`) is a target cap, not a hard guarantee. You can request `10` bins and still see fewer when the data does not support all of them.

Common reasons:

- A linear or logarithmic interval ends up empty, so it is dropped from the realized legend.
- Quantile cut points collapse because many proteins share the same value.
- A constant numeric column produces exactly one bin.
- An all-null numeric column produces zero bins.
- Very narrow ranges can collapse after precision/topology normalization.

This is why you might see `10` requested bins become `9`, and `9` become `8`, without anything being wrong.

## Predicted Annotations

Some annotations are computational predictions rather than experimentally curated records. When one
is selected, the legend header shows a ⚡ **Predicted** badge next to the annotation title, followed
by the note `Computationally predicted, not experimentally curated.` The same ⚡ marker appears next
to the annotation in the view bar's **Color by** menu.

The badge marks columns produced by a machine-learning model, a de-novo sequence-topology
predictor, or predicted 3D structure. Reference signature matches such as Pfam, CATH-Gene3D and
SUPERFAMILY, and curated or factual UniProt and Taxonomy fields, are not badged. Any unknown column
whose name starts with `predicted_` is treated as a prediction.

Which built-in columns carry the badge is listed per annotation in the
[Annotations reference](/guide/annotations), which is generated from the same table the app reads.

The ⚡ badge is a property of the whole column and is decided from the annotation's name, not from
its values, so it is not the same thing as the `EAT` badge, which marks an otherwise curated column
in which some individual proteins carry a transferred value.

## Colors, Gradients, And Shapes

### Categorical Palettes

Categorical annotations use discrete palettes. ProtSpace keeps the established categorical options for contrast and colorblind safety:

- Kelly's Colors
- Okabe-Ito
- Tol Bright
- Set2
- Dark2
- Tableau 10

Colors stay attached to categories when you reorder them.

### Numeric Gradients

Gradients are only shown for numeric annotations. ProtSpace currently ships five curated sequential gradients:

- `Batlow`: scientific-publication oriented sequential ramp from Fabio Crameri's Scientific Colour Maps (default)
- `Cividis`: colorblind-friendly sequential gradient
- `Viridis`: balanced perceptually uniform sequential gradient
- `Inferno`: high-contrast dark-to-bright ramp
- `Plasma`: vivid exploratory sequential ramp

These were chosen because they are either perceptually uniform, publication-friendly, accessibility-aware, or visually distinctive for ordered data. Rainbow-style maps are intentionally excluded because they are a poor default for numeric interpretation.

Numeric bin colors are derived from the gradient and the selected distribution. They are not manually edited per bin.

If an imported bundle or saved browser state references an unsupported numeric gradient ID, ProtSpace falls back to `batlow`.

### Special Categories

| Category  | Color     | Shape  |
| --------- | --------- | ------ |
| **Other** | `#888888` | Circle |
| **N/A**   | `#DDDDDD` | Circle |

### Shapes

Every category renders as a circle by default. To give a category another colour or shape (square, diamond, plus, triangle-up, triangle-down), choose **Colour and shape** from its row's ⋯ menu: the popover has a Shape section underneath the colour picker.

Numeric and multi-label annotations always render as circles; per-category shape assignment is not available for those.

## Saved Settings

Legend settings are saved per dataset and per annotation in the browser.

- Saved examples: visibility, palette, ordering, numeric binning settings, and duplicate-count preferences
- Numeric binning settings such as palette, gradient direction, strategy, and target bin count are restored on reload/import
- Numeric hidden values and your order are only restored when the current numeric topology still matches the saved one
- The shape size is the exception: it is saved once per dataset, applies to every annotation, and
  travels in exported bundles with **Include legend settings**
- Use `Reset` in Legend settings to clear saved preferences for the selected annotation; it also
  clears the dataset's shape size and every annotation's own size, including sizes a bundle set
  per annotation, so the [default](#default-dot-size) applies to every annotation again

## Styling From The Python CLI

`protspace style` can pre-set legend styling inside a bundle, but its keys are categorical only. For
a numeric annotation the web app reinterprets or ignores most of them, because numeric legend
entries are bin IDs such as `num:quantile:150:200` rather than per-value keys.

`Bin distribution` and `Reverse gradient` are UI-only settings and cannot be authored from
the CLI.

See [How CLI keys are reinterpreted for numeric columns](/guide/styling#how-cli-keys-are-reinterpreted-for-numeric-columns)
for the per-key reference.

## Multi-Label Annotations

When proteins have multiple values, such as multiple EC numbers:

- Points display as pie charts
- Each slice represents one value
- All unique values appear in the legend

## Next Steps

- [Separation Scores](/explore/separation-scores) - the strips at the top of the legend panel, and how well each category separates
- [Bars and Tools](/explore/controls) - projections, colour, contours, search, import and export
- [Filtering](/explore/filter) - narrow the plot to proteins that match conditions
- [Viewing 3D Structures](/explore/structures) - AlphaFold integration
````

Then format it: `pnpm exec prettier --write docs/explore/legend.md`.

Before committing, check the one fact the old page gave that the code may have changed since: `grep -n "Reverse gradient" packages/core/src/components/legend/legend-settings-popover.ts` shows the switch's label is `Reverse gradient` (it is at `:231` at `a8cb13ca`); if it reads otherwise, use its label in the two places above.

- [ ] **Step 6: Run the checks and see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS (no stale term on the page; both pairs in order; every anchor resolves, including `#reordering-and-draw-order` and `#settings` within the page). Give the test count before and after.

Run: `time pnpm docs:images:check`
Expected: PASS in under 3 s.

Run: `pnpm type-check:scripts && pnpm knip`
Expected: PASS (`LEGEND_CAPTURES` is consumed by `manifest.ts`).

Run: `pnpm docs:build`
Expected: PASS.

Run: `pnpm exec prettier --write scripts/docs-screenshots/scenes/legend.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/legend.md && pnpm exec prettier --check scripts/docs-screenshots/scenes/legend.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/legend.md`
Expected: PASS (the write only reflows; re-read any file it changed).

No e2e spec and no app code changed; the full suites wait for the phase exit.

- [ ] **Step 7: Commit**

With the Bash sandbox disabled:

```bash
git add scripts/docs-screenshots/scenes/legend.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/legend.md docs/explore/images/legend-toggle.gif docs/explore/images/legend-reorder.gif docs/explore/images/legend-others.gif docs/explore/images/legend-settings.png docs/explore/images/legend-settings-dark.png docs/explore/images/legend-other-popover.png docs/explore/images/legend-other-popover-dark.png
git commit -m "docs(explore): legend page for the workbench"
```

Report the seven image files with their sizes (and each GIF's final fps and width), whether `legend-reorder` needed the `dragLegendRow` fallback, and `git status` showing nothing else changed.

### Task 7.13: Structures and figure editor pages

Two pages and their images: the structure docked and floating (with the divider, the rail dot, "View structure", the pick list for several selected proteins, the phone sheet), and the figure editor as a full-screen dialog with dark chrome and a light preview.

**Files:**

- Create: `scripts/docs-screenshots/scenes/structures.ts`, `scenes/figure-editor.ts`
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs/explore/structures.md`, `docs/explore/figure-editor.md`, `scripts/docs-screenshots/docs-lint.ts` (`LEGACY_IMAGES` loses the four figure-editor files; `STALE_PAGES` loses `explore/figure-editor.md`; `explore/eat.md` already left it in Task 7.9)
- Create images: `structure-floating.png`, `structure-floating-dark.png`, `figure-editor-overview-dark.png`; regenerate `figure-editor-overview.png`, `figure-editor-presets.png`, `figure-editor-overlays.png`, `figure-editor-zoom-inset.png`

**Interfaces:**

- Consumes: the runner (7.3, 7.4): `CaptureEntry` (`name`, `kind`, `viewport`, `themes`, `dataset`, `layout`, `setup`, `steps`, `target`, `timeoutMs`, `docs`), `CaptureApi` (exported from `capture-plan.ts`; `click`, `drag`, `hold`); `clickProteinNearPlotCentre(page): Promise<string>` (`helpers/workbench.ts`, returns the clicked protein's id); `plotArea` (`helpers/explore.ts`, 7.1); `watchStructureLoads`, `waitForStructureLoaded`, `openFigureEditor`, `plotSettled` (7.2); `LEGACY_IMAGES`, `STALE_PAGES` (7.5); the layout field `structurePlacement: 'docked' | 'floating'` (`layout-defaults.ts`); the old figure-editor scenes (`git show a8cb13ca:scripts/docs-screenshots/capture-static.spec.ts`, 507–656).
- Produces:
  - `scenes/structures.ts`: `STRUCTURE_CAPTURES` — `structure-floating` (floating card over the plot, real Mol*; light and dark; `docs: ['explore/structures.md']`). (`structure-viewer` stays in `scenes/overview.ts`, Task 7.10.)
  - `scenes/figure-editor.ts`: `FIGURE_EDITOR_CAPTURES` — `figure-editor-overview` (light and dark), `figure-editor-presets`, `figure-editor-overlays`, `figure-editor-zoom-inset` (light); `docs: ['explore/figure-editor.md']`.
  - Page text: `structures.md` (divider, pop-out and dock on desktop only, the rail dot when the sidebar is collapsed, "View structure" in the tooltip, choosing among several selected proteins, the folded bottom sheet on phones); `figure-editor.md` (opened from Export → "Figure editor…", a full-screen dialog, Escape and Close, Undo for New figure and Reset, the chrome follows the theme while the preview and the export stay light).

**Tests:**

- `pnpm docs:images:check` and `docs-images.test.ts` pass.
- Verification: `pnpm docs:screenshots -g "structure-floating|figure-editor-"` (sandbox disabled, network for Mol*); the app test; `pnpm docs:build`; `pnpm type-check:scripts`; `pnpm knip`; prettier.
- Unrun at task time: none (no e2e spec touched).

Note on the figure editor's DOM: `figureEditor(page)` (`getByRole('dialog', { name: 'Figure editor' })`) is the native `<dialog>` inside `ps-dialog`'s shadow root, and the editor's content (preview canvas, tools, "Label text", `.publish-section`, the overlay list) is slotted into `ps-dialog`, so a locator scoped to that dialog finds none of it (`helpers/legend.ts:160-161` and `dataset-recovery.spec.ts:128-131` record the same). Scope every content query to the modal host `protspace-publish-modal`, as `editor(page)` below does; `openFigureEditor` already asserts the dialog is visible.

- [ ] **Step 1: The scenes**

Create `scripts/docs-screenshots/scenes/structures.ts`:

```ts
/**
 * Captures for docs/explore/structures.md. The docked viewer (`structure-viewer`) belongs to the
 * overview's scenes; this is the floating card. It loads a real AlphaFold model in the real Mol*,
 * so it needs network.
 */
import { plotArea } from '../../../apps/web/tests/helpers/explore';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';
import { clickProteinNearPlotCentre } from '../../../apps/web/tests/helpers/workbench';
import type { CaptureEntry } from '../capture-plan';

export const STRUCTURE_CAPTURES: CaptureEntry[] = [
  {
    name: 'structure-floating',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    // Floating from the start, so Mol* draws its one model in the card's own box: popping out
    // after the load would resize a drawn canvas, with no signal for its redraw.
    layout: { structurePlacement: 'floating' },
    timeoutMs: 120_000,
    docs: ['explore/structures.md'],
    setup: async (page) => {
      await watchStructureLoads(page);
      const id = await clickProteinNearPlotCentre(page);
      await waitForStructureLoaded(page, id, 60_000);
      await plotSettled(page);
    },
    target: (page) => plotArea(page),
  },
];
```

Create `scripts/docs-screenshots/scenes/figure-editor.ts`:

```ts
/**
 * Captures for docs/explore/figure-editor.md: the editor whole (light and dark: its chrome follows
 * the theme, its preview stays light), the presets grid, and the preview with overlays and with a
 * zoom inset, drawn with the editor's own tools.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { openFigureEditor } from '../../../apps/web/tests/helpers/figure';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

type Spot = { x: number; y: number };

/**
 * Where the overlays go, as fractions of the preview canvas (0,0 its top-left corner). The legend
 * takes the right of the figure, so every spot stays in the left two thirds. Chosen against the
 * demo's curated view; if a capture frames empty space, move these and capture again.
 */
const SPOTS = {
  circle: { centre: { x: 0.56, y: 0.38 }, edge: { x: 0.61, y: 0.38 } },
  circleLabel: { x: 0.53, y: 0.27 },
  arrow: { from: { x: 0.2, y: 0.22 }, to: { x: 0.3, y: 0.4 } },
  arrowLabel: { x: 0.13, y: 0.17 },
  insetSource: { from: { x: 0.38, y: 0.48 }, to: { x: 0.45, y: 0.54 } },
  insetTarget: { from: { x: 0.06, y: 0.66 }, to: { x: 0.3, y: 0.66 } },
  empty: { x: 0.01, y: 0.01 },
};

/**
 * The editor's content. It is slotted into ps-dialog, so it is not inside the <dialog> that
 * `figureEditor(page)` (role dialog) finds: query it from the modal host instead.
 */
const editor = (page: Page): Locator => page.locator('protspace-publish-modal');

const previewCanvas = (page: Page): Locator =>
  editor(page).locator('canvas.publish-preview-canvas');

const tool = (page: Page, name: 'Select' | 'Circle' | 'Arrow' | 'Label' | 'Zoom Inset'): Locator =>
  editor(page).getByRole('button', { name, exact: true });

/** A spot on the preview canvas in page coordinates. */
async function onCanvas(page: Page, spot: Spot): Promise<Spot> {
  const box = await previewCanvas(page).boundingBox();
  if (!box) throw new Error('The figure preview canvas has no box');
  return { x: box.x + box.width * spot.x, y: box.y + box.height * spot.y };
}

/** Places a label at `spot` and gives it `text` through the sidebar's "Label text" field. */
async function addLabel(page: Page, cap: CaptureApi, spot: Spot, text: string): Promise<void> {
  await tool(page, 'Label').click();
  await cap.click(await onCanvas(page, spot));
  const field = editor(page).getByRole('textbox', { name: 'Label text' }).last();
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue(text);
}

/** Back to the Select tool, and a click on the canvas corner clears the selection's handles. */
async function deselect(page: Page, cap: CaptureApi): Promise<void> {
  await tool(page, 'Select').click();
  await cap.click(await onCanvas(page, SPOTS.empty));
  await expect(editor(page).locator('.publish-overlay-item.selected')).toHaveCount(0);
}

export const FIGURE_EDITOR_CAPTURES: CaptureEntry[] = [
  {
    name: 'figure-editor-overview',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
  },
  {
    name: 'figure-editor-presets',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    target: (page) =>
      editor(page)
        .locator('.publish-section')
        .filter({ has: page.getByText('Presets', { exact: true }) }),
  },
  {
    name: 'figure-editor-overlays',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    steps: async (page, cap) => {
      await tool(page, 'Circle').click();
      await cap.drag(await onCanvas(page, SPOTS.circle.centre), await onCanvas(page, SPOTS.circle.edge));
      await addLabel(page, cap, SPOTS.circleLabel, 'Cluster 1');
      await tool(page, 'Arrow').click();
      await cap.drag(await onCanvas(page, SPOTS.arrow.from), await onCanvas(page, SPOTS.arrow.to));
      await addLabel(page, cap, SPOTS.arrowLabel, 'Cluster 2');
      await expect(editor(page).getByText('Overlays (4)', { exact: true })).toBeVisible();
      await deselect(page, cap);
    },
  },
  {
    name: 'figure-editor-zoom-inset',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    steps: async (page, cap) => {
      // Two drags: the source rectangle, then the target (its height follows the source's shape).
      await tool(page, 'Zoom Inset').click();
      await cap.drag(
        await onCanvas(page, SPOTS.insetSource.from),
        await onCanvas(page, SPOTS.insetSource.to),
      );
      await cap.drag(
        await onCanvas(page, SPOTS.insetTarget.from),
        await onCanvas(page, SPOTS.insetTarget.to),
      );
      await expect(editor(page).getByText('Zoom Insets (1)', { exact: true })).toBeVisible();
      await deselect(page, cap);
      // The inset renders from the plot in a separate pass; the perf counters settle after it.
      await plotSettled(page);
    },
  },
];
```

In `scripts/docs-screenshots/manifest.ts`, add next to the other scene imports:

```ts
import { FIGURE_EDITOR_CAPTURES } from './scenes/figure-editor';
import { STRUCTURE_CAPTURES } from './scenes/structures';
```

and append `...STRUCTURE_CAPTURES, ...FIGURE_EDITOR_CAPTURES` at the end of the `MANIFEST` array literal.

In `scripts/docs-screenshots/docs-lint.ts`, delete these four lines from `LEGACY_IMAGES`:

```ts
  'figure-editor-overlays.png',
  'figure-editor-overview.png',
  'figure-editor-presets.png',
  'figure-editor-zoom-inset.png',
```

and from `STALE_PAGES` the line `'explore/figure-editor.md',`.

- [ ] **Step 2: Run the checks to see them fail**

Run: `pnpm exec playwright test --project=docs-png --list | grep -E "structure-floating|figure-editor-"`
Expected: `structure-floating.png`, `structure-floating-dark.png`, `figure-editor-overview.png`, `figure-editor-overview-dark.png`, `figure-editor-presets.png`, `figure-editor-overlays.png`, `figure-editor-zoom-inset.png`.

Run: `pnpm docs:images:check`
Expected: FAIL. Among the messages: `structure-floating.png: in the manifest but not on disk; capture it`, `structure-floating-dark.png: …`, `figure-editor-overview-dark.png: …`, `structure-floating.png: explore/structures.md does not show it`, and `explore/figure-editor.md:9: "control bar" names removed UI` (the page left `STALE_PAGES` before its rewrite).

- [ ] **Step 3: Capture the images**

Sandbox disabled; network (AlphaFold, the Mol* bundle on jsDelivr):

```bash
pnpm docs:screenshots -g "structure-floating|figure-editor-"
```

Expected: 7 PNG tests pass. Open every file and check:

- `structure-floating.png` / `-dark.png`: the plot area with the floating card at its bottom-right, a drawn structure (not the loading veil), the card's header with Dock structure;
- `figure-editor-overview.png`: the whole dialog, preview left, sidebar right; `-dark.png`: dark sidebar and toolbar, the preview still white;
- `figure-editor-presets.png`: the Presets grid only;
- `figure-editor-overlays.png`: a circle with "Cluster 1" near it and an arrow with "Cluster 2", no selection handles, the sidebar's "Overlays (4)";
- `figure-editor-zoom-inset.png`: the source rectangle, the magnified target with points in it and connector lines, "Zoom Insets (1)".

If a figure-editor capture times out on a locator, check first that it is scoped to `editor(page)`, not to the dialog (see the note above). If the circle or the inset frames empty space, adjust `SPOTS` in `scenes/figure-editor.ts` (positions are fractions of the preview canvas), capture that image again, and give the final values in the report. If the inset's target is blank (its render not yet in), say so: there is no other signal to wait on in a scene, and the phase-exit run repeats it. Report each file with its size.

- [ ] **Step 4: The pages**

Replace the whole of `docs/explore/structures.md` (Task 7.10 turned its `structure-viewer` image into a pair; this keeps that pair) with:

````md
# Viewing 3D Structures

ProtSpace shows the predicted 3D structure of the protein you click, from the
[AlphaFold Database](https://alphafold.ebi.ac.uk/), next to the plot.

<img src="./images/structure-viewer.png" class="light-only" alt="The structure viewer docked in the sidebar under the legend, showing an AlphaFold model coloured by pLDDT, with the protein's ID and resource links in its header" style="max-width: 50%" />
<img src="./images/structure-viewer-dark.png" class="dark-only" alt="The structure viewer docked in the sidebar under the legend, showing an AlphaFold model coloured by pLDDT, with the protein's ID and resource links in its header" style="max-width: 50%" loading="lazy" />

## How It Works

When you click a protein with a UniProt accession:

1. Its structure opens in the structure viewer, under the legend in the sidebar
2. A row of links to [AlphaFold Database](https://alphafold.ebi.ac.uk/),
   [UniProt](https://www.uniprot.org/), [InterPro](https://www.interpro.org/), and
   [TED](https://ted.cathdb.info/) appears under the title; each opens in a new tab
3. The AlphaFold structure file is fetched directly from the
   [AlphaFold Database API](https://alphafold.ebi.ac.uk/api-docs); the
   [3D-Beacons API](https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/) is used only to look up the model
   page link
4. Optional TED domain annotations are requested from
   `https://alphafold.ebi.ac.uk/api/domains/{accession}`; the structure still loads if annotations
   are unavailable

::: tip Supported Structures
Currently, ProtSpace supports **AlphaFold structures** only. PDB experimental structures are not yet
integrated.
:::

## Where the Structure Shows

### Docked in the sidebar

On a desktop window the viewer sits under the legend. Drag the divider between them to give either
more room; with the divider focused, the arrow keys move it, and **Home** and **End** move it to
either end.

### Floating over the plot

**Pop out structure** in the viewer's header moves it into a card over the plot, at its
bottom-right corner. Drag the card's header to move it and its corner grip to resize it; with the
card focused, the arrow keys move it (with **Shift**, farther), and with the grip focused they resize
it. **Dock structure** puts it back under the legend, opening the sidebar if it was collapsed. The
card keeps its place and size the next time you pop it out. Popping out is offered on desktop
windows only.

![The structure floating in a card over the bottom-right of the plot, with Dock structure in its header](./images/structure-floating.png){.light-only}
![The structure floating in a card over the bottom-right of the plot, with Dock structure in its header](./images/structure-floating-dark.png){.dark-only}

### With the sidebar collapsed

While the sidebar is collapsed to its rail, a click still chooses the protein, but nothing is
downloaded until the structure is visible. A dot on the rail's **Structure** button says one is
waiting; click the button, or **View structure** in the protein's pinned tooltip, to open the
sidebar and load it.

### On phones

On a phone, and on any screen in landscape that is less than 500 px tall, the structure is a sheet
at the bottom of the screen. It opens folded to its header when you tap a protein; **View
structure** in the protein's tooltip, the header or its chevron (**Show the structure**) unfolds
it, and the chevron (**Hide the structure**) folds it again. While it is unfolded, a tap on the plot
does not pin a tooltip under it. On a tablet the structure always has its own place on screen.

## Several Selected Proteins

With more than one protein selected, the protein ID in the viewer's header becomes a menu of the
selected proteins (with a search field when there are many). Pick one to show its structure instead.

## Confidence and Domain Coloring

Structures initially use **predicted Local Distance Difference Test (pLDDT)** confidence scores,
the same scheme used on the [AlphaFold Database](https://alphafold.ebi.ac.uk/). Regions in **blue**
are high-confidence, **yellow** moderate, and **red** low-confidence. This helps you quickly spot
which parts of the model are more reliable.

Use the **Color by** control to switch between **pLDDT** and **TED domains** without reloading the
structure. TED mode assigns a consistent categorical color to every segment of a domain and shows
residues without a TED assignment in gray. The TED domains option is disabled when valid
annotations are unavailable for the selected protein.

The viewer's background follows the page's theme; the model's colours do not change with it.

## Viewer Controls

| Action                         | Effect                                    |
| ------------------------------ | ----------------------------------------- |
| **Color by pLDDT/TED domains** | Switch the loaded structure's color theme |
| **Left drag**                  | Rotate the structure                      |
| **Right drag**                 | Pan the view                              |
| **Scroll**                     | Zoom in/out                               |
| **Double-click**               | Reset the view                            |

## When Structures Aren't Available

Not all proteins have AlphaFold structures. When no structure is found, the viewer displays:

> "No 3D structure was found for \<Protein ID\>"

## Next Steps

- [Exporting Results](/explore/exporting) - Save your findings
- [FAQ](/guide/faq) - Common questions
````

Before you commit this text, check three of its claims against the code and correct the sentence if the code says otherwise (say which in the report): the floating card's default spot (`floatingRect: null` = "the default spot at the plot area's bottom-right corner", `layout-defaults.ts`); that the card keeps its rect (`floatingRect` persists in `protspace:layout:v1`); and that the structure viewer's background follows the theme while Mol*'s model colours do not (`structure-viewer` takes `--ps-surface`, phase 6). The raw `<img>` pair keeps `style="max-width: 50%"` from the old tag but no `display`: an inline `display` would beat the head rule and show both images.

`docs/explore/figure-editor.md`: replace the block from the line starting `<img src="./images/figure-editor-overview.png"` through the line `The editor opens as a full-screen modal with a **preview canvas** on the left and a **settings sidebar** on the right.` (lines 5–12 at `a8cb13ca`) with:

```md
<img src="./images/figure-editor-overview.png" class="light-only" alt="The Figure Editor filling the window: the live preview of the figure on the left with the overlay toolbar under it, and the settings sidebar on the right with journal presets, dimensions, legend and overlay controls" width="1280" height="720" loading="eager" fetchpriority="high" />
<img src="./images/figure-editor-overview-dark.png" class="dark-only" alt="The Figure Editor in the dark theme: dark sidebar and toolbar around the same white figure preview" width="1280" height="720" loading="lazy" />

## Opening the Figure Editor

1. Click **Export** in the app bar
2. Choose **Figure editor…**

The editor opens as a full-screen dialog with a **preview canvas** on the left and a **settings
sidebar** on the right. **Close**, the dialog's **×** and **Escape** close it; when an overlay or
inset is selected, the first **Escape** only deselects it.

::: info Figures stay light in dark mode
The editor's sidebar, toolbar and footer follow the page's theme, but the preview and the exported
figure are always light: a white (or transparent) background with the light colours. A figure looks
the same whichever theme you made it in.
:::
```

Then, in the same file, replace the overlays image line (`![Figure Editor with four overlays placed on the demo map: …](./images/figure-editor-overlays.png)`) with:

```md
![The Figure Editor with four overlays on the demo map: a circle with the label "Cluster 1" beside it, and an arrow with the label "Cluster 2"; the sidebar lists them under Overlays (4)](./images/figure-editor-overlays.png)
```

and the zoom-inset image line (`![Figure Editor with a zoom inset placed: …](./images/figure-editor-zoom-inset.png)`) with:

```md
![The Figure Editor with a zoom inset: a dashed source rectangle around a small cluster, the magnified target rectangle in the lower left with a solid border and connector lines, and Zoom Insets (1) in the sidebar with its Dot size and Border controls](./images/figure-editor-zoom-inset.png)
```

The footer table already describes New figure and Reset with **Undo** and Close with × and Escape (lines 236–242 at `a8cb13ca`); leave it. If the file still says "modal" anywhere else (`grep -n -i modal docs/explore/figure-editor.md`), change it to "dialog".

- [ ] **Step 5: Run the checks to see them pass**

```bash
pnpm docs:images:check
pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts
pnpm docs:build
```

Expected: all PASS. `docs:images:check` covers: every new output on disk and shown by its page; `structure-floating` and `figure-editor-overview` written as pairs (dark twin lazy); `explore/figure-editor.md` with no stale term. The app test count is unchanged from 7.12.

- [ ] **Step 6: Format and the remaining checks**

```bash
pnpm exec prettier --write docs/explore/structures.md docs/explore/figure-editor.md scripts/docs-screenshots/scenes/structures.ts scripts/docs-screenshots/scenes/figure-editor.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts
pnpm type-check:scripts
pnpm knip
pnpm docs:images:check
```

Expected: all pass (the two `*_CAPTURES` are used by `manifest.ts`). Prettier leaves raw `<img>` lines as written; keep each `<img>` on one line, since the pair rule reads consecutive lines.

Report: the images written with sizes (`ls -l` of the seven files), any `SPOTS` change, the claims checked in Step 4, and the app test count.

- [ ] **Step 7: Commit**

```bash
git add scripts/docs-screenshots/scenes/structures.ts scripts/docs-screenshots/scenes/figure-editor.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/structures.md docs/explore/figure-editor.md docs/explore/images/structure-floating.png docs/explore/images/structure-floating-dark.png docs/explore/images/figure-editor-overview.png docs/explore/images/figure-editor-overview-dark.png docs/explore/images/figure-editor-presets.png docs/explore/images/figure-editor-overlays.png docs/explore/images/figure-editor-zoom-inset.png
git commit -m "docs(explore): structures and figure editor pages"
```

### Task 7.14: EAT page and its images

The EAT page on the current UI: its legend-section screenshot and its two GIFs (provenance connectors, the reliability filter) recaptured on the three-finger toxins example, and the page's remaining names for removed UI corrected. The capture needs a provenance pair read from the plot, which no helper offers yet, so `helpers/plot.ts` gains `provenancePair` with its spec case.

**Files:**

- Create: `scripts/docs-screenshots/scenes/eat.ts`
- Modify: `apps/web/tests/helpers/plot.ts` (`provenancePair`), `apps/web/tests/workbench-helpers.spec.ts` (one case for it)
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs/explore/eat.md`, `scripts/docs-screenshots/docs-lint.ts` (`LEGACY_IMAGES` loses the three EAT files; `STALE_PAGES` is untouched: `explore/eat.md` left it in Task 7.9)
- Regenerate: `eat-legend-section.png`, `eat-connectors.gif`, `eat-reliability.gif`

**Interfaces:**

- Consumes: the runner (7.3, 7.4): `CaptureEntry` (`name`, `kind`, `viewport`, `dataset`, `setup`, `steps`, `target`, `timeoutMs`, `docs`), `CaptureApi` (exported from `capture-plan.ts`; `click`, `moveTo`, `press`, `label`, `hold`); `plotArea` (`helpers/explore.ts`, 7.1); `openExample`, `proteinScreenPosition`, `plotSettled` (7.2); `legend` (`helpers/legend.ts`); `e2eExample`, `serveExampleFixtures` (`helpers/example-fixtures.ts`, spec only: they use `import.meta.url`, so no capture module may import them); `LEGACY_IMAGES` (7.5); the plot element's `data.protein_ids`, `data.annotation_predicted[annotation][i].source` and its public `getProteinClientPosition(id)` (`scatter-plot.ts`); the old scenes (`git show a8cb13ca:scripts/docs-screenshots/capture-eat-static.spec.ts` 21, 38; `capture-eat-animations.spec.ts` 91, 136; `pickProvenanceDemoPair` in `eat-helpers.ts` 91).
- Produces:
  - `helpers/plot.ts`: `provenancePair(page: Page, annotation: string, options?: { maxDependants?: number; clearancePx?: number }): Promise<{ source: string; target: string; dependantCount: number }>` — the port of `pickProvenanceDemoPair`. It lives in a helper because a helper may evaluate in the page and a scene may not (Global Constraints, "Shared helpers"); `helpers/plot.ts` is in `scripts/tsconfig.json`'s `include` since 7.2.
  - `scenes/eat.ts`: `EAT_CAPTURES` — `eat-legend-section` (light), `eat-connectors` and `eat-reliability` (GIFs), all `dataset: 'three-finger-toxins'`, `docs: ['explore/eat.md']`.
  - `eat.md`: the current names (Color by, the Filter panel); its links already moved in 7.9.

**Tests:**

- `workbench-helpers.spec.ts` "provenancePair finds a source and one of its dependants" on the EAT example fixture (the task's one e2e spec, run filtered).
- `pnpm docs:images:check` and `docs-images.test.ts` pass; both GIFs within budget.
- Verification: `pnpm docs:screenshots -g "eat-legend-section.png"`; `pnpm docs:animations -g "eat-connectors.gif|eat-reliability.gif" && pnpm docs:gifs eat-connectors eat-reliability` (sandbox disabled, network, `pnpm examples:fetch`); the app test; `pnpm docs:build`; `pnpm type-check:scripts`; `pnpm knip`; prettier.
- Unrun at task time: the rest of `workbench-helpers.spec.ts` (runs at the phase exit).

- [ ] **Step 1: Write the failing helper test**

In `apps/web/tests/workbench-helpers.spec.ts`, add `provenancePair` and `proteinScreenPosition` to the import from `./helpers/plot` (Task 7.2 added that import; keep its other names), and `openExample` to the import from `./helpers/examples` (likewise). `e2eExample` and `serveExampleFixtures` are already imported from `./helpers/example-fixtures` (line 3 at `a8cb13ca`). Append at the end of the file:

```ts
test.describe('provenancePair', () => {
  test('finds a source and one of its dependants', async ({ page }) => {
    // The EAT example's fixture: its toxin_class carries transferred values and their sources.
    await serveExampleFixtures(page);
    await openExample(page, 'three-finger-toxins', { proteinCount: e2eExample('eat').count });
    // No clearance: the fixture's islands are tighter than the real example's.
    const pair = await provenancePair(page, 'toxin_class', { clearancePx: 0 });
    expect(pair.source).not.toBe(pair.target);
    expect(pair.dependantCount).toBeGreaterThanOrEqual(2);
    expect(pair.dependantCount).toBeLessThanOrEqual(20);
    // Both are plotted: proteinScreenPosition throws for a protein that is not.
    await proteinScreenPosition(page, pair.source);
    await proteinScreenPosition(page, pair.target);
  });
});
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts --project workbench -g "provenancePair"`
Expected: FAIL before any test runs, with a module error naming `provenancePair` (`does not provide an export named 'provenancePair'`, or the TypeScript/esbuild equivalent), because `helpers/plot.ts` does not export it yet.

- [ ] **Step 2: Add `provenancePair` to `helpers/plot.ts`**

Append to `apps/web/tests/helpers/plot.ts` (it already imports `type Page` from `@playwright/test`; add the import if it does not):

```ts
/**
 * A pair for showing EAT provenance connectors on `annotation`: `source`, a protein other
 * proteins borrowed their value from and that is not itself transferred, and `target`, one of
 * those dependants. Picks the source with the most dependants within 2..`maxDependants` (the
 * renderer draws at most 20 lines: MAX_PROVENANCE_CONNECTORS in
 * apps/web/src/explore/eat-provenance.ts; past it the extra lines are dropped without notice).
 * Both proteins stand `clearancePx` clear of every other plotted protein, so a click there picks
 * that protein and not a neighbour (4 px: the plot's smallest hit radius). Read at call time, not
 * hard-coded, so a rebuilt bundle cannot silently give an empty GIF. Throws when nothing
 * qualifies.
 */
export async function provenancePair(
  page: Page,
  annotation: string,
  options: { maxDependants?: number; clearancePx?: number } = {},
): Promise<{ source: string; target: string; dependantCount: number }> {
  const { maxDependants = 20, clearancePx = 4 } = options;
  const pair = await page.locator('#myPlot').evaluate(
    (element, { key, cap, clearance }) => {
      const plot = element as Element & {
        data?: {
          protein_ids: string[];
          annotation_predicted?: Record<string, Array<{ source?: string } | null>>;
        } | null;
        getProteinClientPosition(proteinId: string): { x: number; y: number } | null;
      };
      const ids = plot.data?.protein_ids;
      const cells = plot.data?.annotation_predicted?.[key];
      if (!ids || !cells) return null;
      const positions = ids.map((id) => plot.getProteinClientPosition(id));
      const standsClear = (index: number | undefined): boolean => {
        const here = index === undefined ? null : positions[index];
        if (!here) return false;
        return positions.every(
          (other, j) =>
            j === index || !other || Math.hypot(other.x - here.x, other.y - here.y) > clearance,
        );
      };
      const indexById = new Map(ids.map((id, index) => [id, index]));
      const dependants = new Map<string, string[]>();
      cells.forEach((cell, i) => {
        const source = cell?.source;
        if (!source) return;
        const list = dependants.get(source);
        if (list) list.push(ids[i]);
        else dependants.set(source, [ids[i]]);
      });
      const ranked = [...dependants.entries()]
        .filter(([source, targets]) => {
          const sourceIndex = indexById.get(source);
          // In the dataset, and not itself transferred: clicking a transferred protein draws its
          // own single source line instead of the fan-out.
          return targets.length >= 2 && sourceIndex !== undefined && !cells[sourceIndex];
        })
        .sort((a, b) => b[1].length - a[1].length);
      for (const [source, targets] of ranked) {
        if (targets.length > cap || !standsClear(indexById.get(source))) continue;
        const target = targets.find((id) => standsClear(indexById.get(id)));
        if (target) return { source, target, dependantCount: targets.length };
      }
      return null;
    },
    { key: annotation, cap: maxDependants, clearance: clearancePx },
  );
  if (!pair) {
    throw new Error(
      `No provenance pair for "${annotation}": needs a non-transferred source with 2-${maxDependants} ` +
        `dependants, it and one of them ${clearancePx} px clear of every other protein`,
    );
  }
  return pair;
}
```

Run: `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts --project workbench -g "provenancePair"`
Expected: PASS, 1 test. If it throws "No provenance pair" on the fixture even with `clearancePx: 0`, the fixture's sources all have more than 20 dependants: pass `maxDependants: 1000` in the spec only, and say so in the report.

Then `pnpm type-check:scripts` (the helper is in `scripts/tsconfig.json`'s `include` since 7.2) — PASS.

- [ ] **Step 3: The scenes**

Create `scripts/docs-screenshots/scenes/eat.ts`:

```ts
/**
 * Captures for docs/explore/eat.md, on the Snake three-finger toxins example, which opens coloured
 * by toxin_class with every transfer shown and the reliability filter at 0. The product demo has
 * no transferred annotations. Needs `pnpm examples:fetch` (a release asset).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { plotArea } from '../../../apps/web/tests/helpers/explore';
import { legend } from '../../../apps/web/tests/helpers/legend';
import {
  plotSettled,
  proteinScreenPosition,
  provenancePair,
} from '../../../apps/web/tests/helpers/plot';
import type { CaptureEntry } from '../capture-plan';

const DATASET = 'three-finger-toxins';
const ANNOTATION = 'toxin_class';

const eatSection = (page: Page): Locator =>
  legend(page).getByRole('region', { name: 'Embedding Annotation Transfer' });
const connectors = (page: Page): Locator =>
  page.locator('#myPlot').locator('line.eat-provenance-connector');

/** A spot to rest the pointer between clicks: the plot's right margin, clear of the points. */
async function restingSpot(page: Page): Promise<{ x: number; y: number }> {
  const box = await plotArea(page).boundingBox();
  if (!box) throw new Error('The plot area has no box');
  return { x: box.x + box.width - 48, y: box.y + box.height / 2 };
}

export const EAT_CAPTURES: CaptureEntry[] = [
  {
    name: 'eat-legend-section',
    kind: 'png',
    viewport: 'desktop',
    dataset: DATASET,
    docs: ['explore/eat.md'],
    steps: async (page) => {
      // The counts row renders a frame after the section itself.
      await expect(
        eatSection(page).getByRole('region', { name: 'Transferred annotation counts' }),
      ).toBeVisible();
    },
    target: (page) => eatSection(page),
  },
  {
    name: 'eat-connectors',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    timeoutMs: 120_000,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      const { target } = await provenancePair(page, ANNOTATION);
      await cap.moveTo(await proteinScreenPosition(page, target), { steps: 15 });
    },
    steps: async (page, cap) => {
      const { source, target, dependantCount } = await provenancePair(page, ANNOTATION);
      const rest = await restingSpot(page);

      // One transferred protein: a single dashed line back to its source.
      await cap.label('Click a transferred protein');
      await cap.click(await proteinScreenPosition(page, target));
      await expect(connectors(page)).toHaveCount(1);
      await cap.moveTo(rest, { steps: 12 });
      await cap.hold(1600);

      // Read now: the first click opened the structure under the legend; the plot did not move,
      // but a stale read is the one thing that can land a click on a neighbour.
      const sourceAt = await proteinScreenPosition(page, source);
      await cap.moveTo(sourceAt, { steps: 15 });
      await cap.label('Click its source');
      await cap.click(sourceAt);
      await expect(connectors(page)).toHaveCount(dependantCount);
      await cap.moveTo(rest, { steps: 12 });
      await cap.hold(1600);

      // Escape clears the connectors, and the selection with them.
      await cap.label('Esc to clear');
      await cap.press('Escape');
      await expect(connectors(page)).toHaveCount(0);
      await cap.hold(800);
    },
  },
  {
    name: 'eat-reliability',
    kind: 'gif',
    viewport: 'desktop',
    dataset: DATASET,
    docs: ['explore/eat.md'],
    setup: async (page, cap) => {
      await expect(eatSection(page)).toBeVisible();
      await cap.moveTo(eatSection(page), { steps: 15 });
    },
    steps: async (page, cap) => {
      const percent = eatSection(page).getByRole('spinbutton', {
        name: 'EAT reliability filter percentage',
      });
      // Up in stages, so the rings thin out visibly rather than snapping to the end state.
      for (const value of ['40', '70', '90']) {
        await cap.label(`Hide below ${value}%`);
        await percent.fill(value);
        await cap.press('Enter');
        await plotSettled(page);
        await cap.hold(800);
      }
      await cap.hold(800);
      // Back to 0: every prediction returns and the filter condition is removed.
      await cap.label('Back to 0%');
      await percent.fill('0');
      await cap.press('Enter');
      await plotSettled(page);
      await cap.hold(1600);
    },
  },
];
```

The reliability GIF does not open the Filter panel: the panel takes the legend's place in the sidebar, so opening it would hide the control the GIF is about. The page text says where the condition shows up instead.

In `scripts/docs-screenshots/manifest.ts`, add next to the other scene imports:

```ts
import { EAT_CAPTURES } from './scenes/eat';
```

and append `...EAT_CAPTURES` at the end of the `MANIFEST` array literal.

In `scripts/docs-screenshots/docs-lint.ts`, delete these three lines from `LEGACY_IMAGES` (after this the set is empty: Tasks 7.9–7.14 have regenerated or deleted every image that was on disk at `a8cb13ca`; leave it as an empty `new Set<string>()` for Task 7.16 to delete):

```ts
  'eat-connectors.gif',
  'eat-legend-section.png',
  'eat-reliability.gif',
```

- [ ] **Step 4: The new entries are listed**

Run: `pnpm exec playwright test --project=docs-png --list | grep -E "eat-legend"` and `pnpm exec playwright test --project=docs-gif --list | grep -E "eat-(connectors|reliability)"`
Expected: `eat-legend-section.png`; and `eat-connectors.gif`, `eat-reliability.gif`.

Run: `pnpm docs:images:check`
Expected: PASS. The three files from `a8cb13ca` are on disk under the same names and `eat.md` shows them, so the manifest now covers them; the check cannot tell old bytes from new. The failing test of this task is Step 1's; the captures below are what replace the images.

- [ ] **Step 5: Capture the images**

Sandbox disabled; network; the EAT example on disk:

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "eat-legend-section.png"
pnpm docs:animations -g "eat-connectors.gif|eat-reliability.gif" && pnpm docs:gifs eat-connectors eat-reliability
```

Expected: 1 PNG test passes, 2 GIF tests pass, and `docs:gifs` prints each rung and writes both GIFs within 3 MiB (the old ones were 2.9 and 2.6 MB at a larger size). Open every file and check:

- `eat-legend-section.png`: the Predicted (transferred) block with Show, the reliability control and the Observed / Predicted by EAT counts;
- `eat-connectors.gif`: one dashed line, then a fan of lines, then none; the cursor and the three labels; `eat-reliability.gif`: rings thinning at 40, 70, 90 % and all back at 0 %.

Report each file with its size and the ladder rung each GIF landed on.

- [ ] **Step 6: The page**

`docs/explore/eat.md`:

- the image line `![The EAT badge in the annotation dropdown](./images/eat-annotation-badge.png)` → `![The Color by menu of the three-finger toxins example, with the EAT badge beside toxin_class](./images/eat-annotation-badge.png)`
- the image line `![The Predicted (transferred) legend controls](./images/eat-legend-section.png)` → `![The Predicted (transferred) section at the top of the legend: Show, the reliability filter with its mode, slider and percentage, and the Observed and Predicted by EAT counts](./images/eat-legend-section.png)`
- in "The mirror runs both ways: edit or delete that condition in the filter builder and the control follows", `in the filter builder` → `in the [Filter panel](/explore/filter#reliability-and-the-filter)`
- in the tip "The EAT confidence column is filter-only", `is not offered in the Annotation dropdown` → `is not offered in Color by`, and `It exists in the filter column picker` → `It exists in the Filter panel's annotation picker`

Check: `grep -n -i "dropdown\|control bar\|isolat" docs/explore/eat.md`. Expected: only "a mode dropdown" (the reliability control's own mode select, which is a dropdown) and "isolate a confidence band" in the modes table, which describes the band, not the removed button. Anything else naming removed UI: reword it.

- [ ] **Step 7: Run the checks to see them pass**

```bash
pnpm docs:images:check
pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts
pnpm docs:build
```

Expected: all PASS. `docs:images:check` covers: the three outputs on disk and shown by `explore/eat.md`; both GIFs within 3,145,728 bytes; no EAT file left in `LEGACY_IMAGES`. The app test count is unchanged from 7.13.

Then `PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-helpers.spec.ts --project workbench -g "provenancePair"` once more — PASS.

- [ ] **Step 8: Format and the remaining checks**

```bash
pnpm exec prettier --write docs/explore/eat.md scripts/docs-screenshots/scenes/eat.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts apps/web/tests/helpers/plot.ts apps/web/tests/workbench-helpers.spec.ts
pnpm type-check:scripts
pnpm knip
pnpm docs:images:check
```

Expected: all pass (`provenancePair` is used by `scenes/eat.ts` and the spec; `EAT_CAPTURES` by `manifest.ts`).

Report: the images written with sizes, the GIF ladder rungs, and the counts of the spec case and the app test.

- [ ] **Step 9: Commit**

```bash
git add scripts/docs-screenshots/scenes/eat.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts apps/web/tests/helpers/plot.ts apps/web/tests/workbench-helpers.spec.ts docs/explore/eat.md docs/explore/images/eat-legend-section.png docs/explore/images/eat-connectors.gif docs/explore/images/eat-reliability.gif
git commit -m "docs(explore): EAT page on the workbench"
```

### Task 7.15: Importing, exporting, phones and tablets, FAQ

The remaining user-guide pages: importing (drop anywhere, the Import menu and dataset name, the loading screen), exporting (the Export menu image, exports always light), the "Phones and tablets" section of the overview with its captures, and the FAQ (the gear, a dark-mode entry). After this task both allowlists are empty.

**Files:**

- Create: `scripts/docs-screenshots/scenes/import-export.ts`, `scenes/phones.ts`
- Modify: `scripts/docs-screenshots/manifest.ts`, `docs/explore/importing-data.md`, `docs/explore/exporting.md`, `docs/explore/index.md` ("## Phones and tablets"), `docs/guide/faq.md`, `scripts/docs-screenshots/docs-lint.ts` (`STALE_PAGES` loses `explore/importing-data.md`, `guide/faq.md` and any page still listed; both sets end empty)
- Modify: `scripts/docs-screenshots/scenes/controls.ts` (Task 7.9's file; the `export-menu` entry's `docs` gains `'explore/exporting.md'`)
- Create images: `toast.png`, `toast-dark.png`, `loading-overlay.png`, `loading-overlay-dark.png`, `phone-layout.png`, `phone-layout-dark.png`, `phone-more-sheet.png`, `phone-more-sheet-dark.png`, `phone-structure-sheet.png`, `phone-structure-sheet-dark.png`, `tablet-layout.png` (phone and tablet PNGs at device scale 2, Task 7.3's `contextOptions`)

**Interfaces:**

- Consumes: the runner (7.3); `around` (7.9); `holdNextRequest`, `pickExample`, `openImportMenu`, `exportAction`, `toast` (`helpers/explore.ts`, 7.2); `moreButton`, `moreSheet`, `bottomPanel`, `structureSheet`, `proteinNear`, `tap` (`helpers/mobile.ts`); `watchStructureLoads`, `waitForStructureLoaded` (7.2); `export-menu.png` (7.9) for `exporting.md`.
- Also consumed (existing, unchanged): `type CaptureApi`, `type CaptureEntry` (`capture-plan.ts`, 7.3; `viewport: 'phone' | 'tablet'`, Pixel 7 at 412×839 and 800×1280); `MANIFEST` (`manifest.ts`); `CONTROLS_CAPTURES` and its `export-menu` entry (`scenes/controls.ts`, 7.9); `importMenu` (`helpers/explore.ts`); `legendRowValues` (`helpers/legend.ts`); `panelTab`, `plotTooltip`, `themeSegment` (`helpers/mobile.ts`); `findExampleDataset(id)` and its `url` (`./examples/<file>` for a release-hosted example; `apps/web/src/explore/example-datasets.ts:233`); the loading overlay `#progressive-loading` with its card `.ps-loading__card` and, while an example downloads, its "Cancel download" button (`loading-overlay.ts:109-128`; the `example-datasets.spec.ts:505-516` precedent holds the download the same way); the export notification "Export ready." (`notifications.ts:216`, 4 s; Sonner pauses a toast's timer while the pointer is over it); the phone layout's `.workbench[data-sheet]` (`'folded' | 'expanded'`) and the pinned tooltip's "View structure" (`mobile-plot-touch.spec.ts:178-194`); on phones and tablets a structure loads as soon as it is asked for, folded or not (`isStructureVisible`, `structure-controller.ts:26-29`); 7.10's `docs/explore/index.md` headings, "## Light and dark" (`#light-and-dark`) and "## Next steps".
- Produces:
  - `scenes/import-export.ts`: `IMPORT_EXPORT_CAPTURES` — `toast` (the notification that confirms a Quick PNG export, the download accepted by Playwright; crop around the toast and its close button; light and dark; `docs: ['explore/exporting.md']`), `loading-overlay` (an example load held with `holdNextRequest`; light and dark; `docs: ['explore/importing-data.md']`). `export-menu`'s entry (7.9) adds `'explore/exporting.md'` to its `docs`.
  - `scenes/phones.ts`: `PHONE_CAPTURES` — `phone-layout` (phone, bottom panel unfolded), `phone-more-sheet` (More sheet open with the Theme row), `phone-structure-sheet` (structure sheet folded to its header after a tap, real Mol*) — each light and dark; `tablet-layout` (tablet, light). All `docs: ['explore/index.md']`.
  - `index.md` "## Phones and tablets": the four layouts by width (951+, 641–950, ≤640, landscape ≤500 px tall), the More sheet, the folding panel with Legend and Filter tabs, the structure sheet, touch gestures.
  - `faq.md`: "### Can I customize colors?" says the gear opens Legend settings; a new "### Why are my figures light in dark mode?" (or similar) under Visualization, linking `/explore/#light-and-dark`.
  - `exporting.md`: the Export menu image, a note that exports and figures are always light.

**Tests:**

- `pnpm docs:images:check` and `docs-images.test.ts` pass with `LEGACY_IMAGES` and `STALE_PAGES` empty.
- Verification: `pnpm docs:screenshots -g "toast|loading-overlay|phone-|tablet-layout.png"` (sandbox disabled, network for Mol*); the app test; `pnpm docs:build`; prettier.
- Unrun at task time: none.

`bottomPanel`, `structureSheet` and `openImportMenu` exist but are not imported: the scenes below reach the same elements through `panelTab`, `.workbench[data-sheet]` and `pickExample` (which calls `openImportMenu`), so they do not import them.

- [ ] **Step 1: Empty the allowlists (the failing state)**

In `scripts/docs-screenshots/docs-lint.ts`:

(a) In the `STALE_PAGES` set literal, delete `'explore/importing-data.md'` and `'guide/faq.md'`, and every other entry still there (Tasks 7.9–7.14 removed theirs; if one remains, its page still matches a stale term after its own task: report it, and fix the term on that page in this task only if it is one line). The literal ends as an empty set with its declared type unchanged, e.g. `export const STALE_PAGES: ReadonlySet<string> = new Set([]);`.

(b) Check `LEGACY_IMAGES`: Tasks 7.9–7.14 have removed every entry, so it must already be an empty set. If any entry is left, stop: the image it names was not regenerated by its page task. Report it as a blocker instead of capturing it here.

- [ ] **Step 2: Write the import and export scenes**

Create `scripts/docs-screenshots/scenes/import-export.ts`:

```ts
/**
 * Captures for the importing and exporting pages: the notification an export ends with, and the
 * loading card an example download shows.
 */
import { expect, type Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';
import { around } from './clip';
import { findExampleDataset } from '../../../apps/web/src/explore/example-datasets';
import {
  exportAction,
  holdNextRequest,
  importMenu,
  pickExample,
  toast,
} from '../../../apps/web/tests/helpers/explore';

/** A release-hosted example: its download is the one held, so its file need not be fetched. */
const LOADING_EXAMPLE = 'three-finger-toxins';

const exportReady = (page: Page) => toast(page, 'Export ready.');

async function exportToastSteps(page: Page, cap: CaptureApi): Promise<void> {
  const download = page.waitForEvent('download');
  await exportAction(page, 'Quick PNG');
  await download;
  await expect(exportReady(page)).toBeVisible();
  await expect(
    exportReady(page).getByRole('button', { name: 'Dismiss notification' }),
  ).toBeVisible();
  // The toast closes itself after 4 s; Sonner pauses that while the pointer rests on it.
  await cap.moveTo(exportReady(page), { steps: 1 });
}

async function loadingOverlaySteps(page: Page): Promise<void> {
  const example = findExampleDataset(LOADING_EXAMPLE);
  if (!example) throw new Error(`The catalog has no "${LOADING_EXAMPLE}" example`);
  // Held until the page closes, so the card stays on its first frame for the shutter.
  await holdNextRequest(page, `**/${example.url.replace(/^\.\//, '')}`);
  await pickExample(page, LOADING_EXAMPLE);
  await expect(importMenu(page).locator('[data-driver-id="import-own-dataset"]')).toBeHidden();
  const overlay = page.locator('#progressive-loading');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Cancel download' })).toBeVisible();
}

export const IMPORT_EXPORT_CAPTURES: CaptureEntry[] = [
  {
    name: 'toast',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: exportToastSteps,
    target: (page) => around([exportReady(page)], 16),
    keepPointer: true,
    docs: ['explore/exporting.md'],
  },
  {
    name: 'loading-overlay',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: loadingOverlaySteps,
    target: (page) => around([page.locator('#progressive-loading .ps-loading__card')], 40),
    docs: ['explore/importing-data.md'],
  },
];
```

- [ ] **Step 3: Write the phone and tablet scenes**

Create `scripts/docs-screenshots/scenes/phones.ts`:

```ts
/**
 * The overview's "Phones and tablets" captures on an emulated Pixel 7: the phone layout, the More
 * sheet and the structure sheet (light and dark), and the tablet layout (light). The structure
 * loads the real Mol* and AlphaFold, so these need network.
 */
import { expect, type Page } from '@playwright/test';
import type { CaptureEntry } from '../capture-plan';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import {
  moreButton,
  moreSheet,
  panelTab,
  plotTooltip,
  proteinNear,
  tap,
  themeSegment,
} from '../../../apps/web/tests/helpers/mobile';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';

const workbench = (page: Page) => page.locator('.workbench');

/** The panel under the plot shows the legend, unfolded, with its rows. */
async function phoneLayoutSteps(page: Page): Promise<void> {
  await expect(panelTab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await legendRowValues(page)).length).toBeGreaterThan(0);
}

async function moreSheetSteps(page: Page): Promise<void> {
  await moreButton(page).tap();
  await expect(moreSheet(page)).toBeVisible();
  await expect(themeSegment(page, 'System')).toBeVisible();
}

/**
 * A tap selects a protein: its tooltip pins with View structure, and the structure sheet opens
 * folded to its header below the plot while the structure loads behind it.
 */
async function structureSheetSteps(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const protein = await proteinNear(page, 0.5, 0.35);
  await tap(page, protein);
  await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
  await expect(plotTooltip(page).getByRole('button', { name: 'View structure' })).toBeVisible();
  await waitForStructureLoaded(page, protein.id, 90_000);
}

/** The tablet keeps the structure beside the legend under the plot; a tap shows one there. */
async function tabletSteps(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const protein = await proteinNear(page, 0.5, 0.45);
  await tap(page, protein);
  await waitForStructureLoaded(page, protein.id, 90_000);
}

export const PHONE_CAPTURES: CaptureEntry[] = [
  {
    name: 'phone-layout',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: phoneLayoutSteps,
    docs: ['explore/index.md'],
  },
  {
    name: 'phone-more-sheet',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: moreSheetSteps,
    docs: ['explore/index.md'],
  },
  {
    name: 'phone-structure-sheet',
    kind: 'png',
    viewport: 'phone',
    themes: ['light', 'dark'],
    steps: structureSheetSteps,
    timeoutMs: 150_000,
    docs: ['explore/index.md'],
  },
  {
    name: 'tablet-layout',
    kind: 'png',
    viewport: 'tablet',
    steps: tabletSteps,
    timeoutMs: 150_000,
    docs: ['explore/index.md'],
  },
];
```

In `scripts/docs-screenshots/manifest.ts`, add the imports next to the other scene imports:

```ts
import { IMPORT_EXPORT_CAPTURES } from './scenes/import-export';
import { PHONE_CAPTURES } from './scenes/phones';
```

and append `...IMPORT_EXPORT_CAPTURES, ...PHONE_CAPTURES` as the last elements of the `MANIFEST` array literal.

In `scripts/docs-screenshots/scenes/controls.ts`, in the entry whose `name` is `'export-menu'`, add `'explore/exporting.md'` to its `docs` array (e.g. `docs: ['explore/controls.md']` becomes `docs: ['explore/controls.md', 'explore/exporting.md']`; keep whatever pages it lists already).

- [ ] **Step 4: Run the checks and see them fail**

Run: `pnpm type-check:scripts`
Expected: PASS.

Run: `pnpm exec playwright test --project=docs-png --list | grep -E "toast|loading-overlay|phone-|tablet-layout"`
Expected: `toast.png`, `toast-dark.png`, `loading-overlay.png`, `loading-overlay-dark.png`, `phone-layout.png`, `phone-layout-dark.png`, `phone-more-sheet.png`, `phone-more-sheet-dark.png`, `phone-structure-sheet.png`, `phone-structure-sheet-dark.png`, `tablet-layout.png`.

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL in the real-docs case: stale terms on `explore/importing-data.md` ("control bar" in the Import Button section) and `guide/faq.md` ("cog icon"), now that `STALE_PAGES` is empty.

Run: `pnpm docs:images:check`
Expected: exit 1, listing the eleven missing outputs, the eleven outputs not referenced by their pages, and `export-menu.png` not referenced by `explore/exporting.md`.

- [ ] **Step 5: Capture the images**

With the Bash sandbox disabled (headed Chromium, the 8096 server, network for Mol* and AlphaFold):

Run: `pnpm docs:screenshots -g "toast|loading-overlay|phone-|tablet-layout.png"`
Expected: eleven tests pass.

If `phone-structure-sheet` or `tablet-layout` times out in `waitForStructureLoaded`, first re-run that one image alone (`-g "phone-structure-sheet.png"`): AlphaFold and jsDelivr are remote. If it still never sees `'loaded'`, report the last `structure-load` status the page recorded; do not swap the wait for a timer.

Run: `ls -l docs/explore/images/toast*.png docs/explore/images/loading-overlay*.png docs/explore/images/phone-*.png docs/explore/images/tablet-layout.png`
Expected: eleven files.

Open each one: `toast` is the "Export ready." notification with the file name and its ✕; `loading-overlay` is the card "Downloading Snake three-finger toxins (EAT)…" with its bar and Cancel download; `phone-layout` shows the bars, the plot and the legend panel under it with the Legend and Filter tabs; `phone-more-sheet` shows the More sheet with Contours, Filter, Import data, Export, Theme (System chosen), Help & shortcuts and Feedback; `phone-structure-sheet` shows the pinned tooltip with View structure and the folded sheet naming the protein; `tablet-layout` shows the plot over the legend and the loaded structure. Each `-dark` twin is dark.

- [ ] **Step 6: Importing page**

In `docs/explore/importing-data.md`:

(a) Replace the line

```md
Both the drop zone and the **Import** button accept either kind.
```

with

```md
You can drop either kind anywhere on the page, or open it from the **Import** menu.
```

(b) Replace everything from the heading `## Drag and Drop (Recommended)` up to (not including) the heading `## FASTA Upload (Instant Prep)` with:

```md
## Drag and Drop (Recommended)

The easiest way to load data:

1. Locate your `.parquetbundle` or FASTA file on your computer
2. Drag it over the ProtSpace page; `Drop to open this file` appears over the workbench
3. Drop it
4. Data loads automatically

::: tip Drop Anywhere
The drop works anywhere on the page: the plot, the legend, the bars. When nothing is loaded, the
plot says `Drop a file or pick an example`, with **Open a file…** and **Pick an example** buttons.
:::

## The Import Menu

**Import** in the app bar opens the Import menu, and so does the dataset's name at the left of the
app bar. On a phone, tap the dataset's name, or open **More** and choose **Import data**. The menu
holds:

- **Open a file…**, which opens your system's file picker for a `.parquetbundle` or FASTA file
- **Last file**, which reopens the file you imported last, from this browser's storage
- **Examples**, the [example datasets](/explore/example-datasets); each opens in its curated view
```

(c) Directly under the heading `## What Happens When You Load Data` (before the line `After successfully loading a file:`), insert:

```md
While a dataset loads, a card over the page says what is happening and how far it has got: for a
file, that it is being read in your browser; for an example, `Downloading …` with a
**Cancel download** button, then `Opening …`; then `Drawing N proteins`. A file you open never
leaves your computer; only a FASTA file is sent to the server, for embedding.

![The loading card while an example downloads](./images/loading-overlay.png){.light-only}
![The loading card while an example downloads](./images/loading-overlay-dark.png){.dark-only}
```

(d) In "## Data & Settings Persistence", the two links in the "Examples always reopen…" and "Annotation and projection persist in the URL" items read `/explore/controls#contours` (Task 7.9 moved them). Check: `grep -rn "/explore/control-bar" docs` prints nothing. If it prints a line, Task 7.9 missed a link: fix it here and report it.

(e) In "## Need a Data File?", replace `If you only have sequences, drop the FASTA straight onto the scatterplot, see` with `If you only have sequences, drop the FASTA file anywhere on the page, see`.

If Task 7.9 placed its pair in `docs/explore/filter.md` as raw `<img>` tags (`grep -n "filter-panel" docs/explore/filter.md`), write every pair in this task in that raw form instead (`<img src="./images/x.png" alt="…" class="light-only" />` then `<img src="./images/x-dark.png" alt="…" class="dark-only" loading="lazy" />`).

- [ ] **Step 7: Exporting page**

In `docs/explore/exporting.md`:

(a) Replace the line `Click **Export** in the top bar to open its menu:` with:

```md
Click **Export** in the app bar to open its menu (on a phone: **More**, then **Export**):

![The Export menu open under the Export button](./images/export-menu.png)
```

(b) Replace the paragraph

```md
**Include legend settings**, below them, decides whether a data bundle carries your legend
settings. Every export confirms with a message naming the downloaded file.
```

with

```md
**Include legend settings**, below them, decides whether a data bundle carries your legend
settings. Every export confirms with a message naming the downloaded file:

![The notification after an export](./images/toast.png){.light-only}
![The notification after an export](./images/toast-dark.png){.dark-only}
```

(c) Directly before the heading `## Parquet Export`, insert:

```md
::: info Exports are always light
Quick PNG and PDF, the Figure Editor's preview and its exports always use the light colours (a
white background and the light greys for `Other` and `N/A`), whatever theme the app shows, so a
figure looks the same whoever made it. See [Light and dark](/explore/#light-and-dark).
:::
```

(d) Replace the "## What Gets Exported" table and the line under it,

```md
| State             | Exported Data          |
| ----------------- | ---------------------- |
| Proteins isolated | Only isolated proteins |
| No isolation      | All proteins           |

Use isolation to export specific subsets.
```

with

```md
| State                                          | Exported Data       |
| ---------------------------------------------- | ------------------- |
| After **Show only these** (the plot narrowed)  | Only those proteins |
| No **Show only these** step                    | All proteins        |

To export a subset, select its proteins and press **Show only these** in the selection bar.
```

- [ ] **Step 8: Phones and tablets in the overview**

In `docs/explore/index.md` (as Task 7.10 wrote it), insert this section directly before the heading `## Next steps`:

```md
## Phones and tablets

ProtSpace picks a layout from the window's size, and the same page works with touch:

| Window                                        | Layout                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 951 px wide and more                          | The desktop workbench described above                                                        |
| 641 to 950 px wide (tablets)                  | The plot on top; the legend and the structure side by side below it                          |
| 640 px wide or less (phones)                  | One fixed screen: the bars, the plot, and a panel under it                                   |
| A phone on its side (500 px tall or less)     | The page scrolls once past the bars to a plot-and-legend view; the structure opens on the right |

<p>
<img src="./images/phone-layout.png" alt="ProtSpace on a phone: the bars, the plot and the legend panel" width="240" class="light-only" loading="lazy" />
<img src="./images/phone-layout-dark.png" alt="ProtSpace on a phone: the bars, the plot and the legend panel" width="240" class="dark-only" loading="lazy" />
<img src="./images/phone-more-sheet.png" alt="The More sheet on a phone" width="240" class="light-only" loading="lazy" />
<img src="./images/phone-more-sheet-dark.png" alt="The More sheet on a phone" width="240" class="dark-only" loading="lazy" />
<img src="./images/phone-structure-sheet.png" alt="A pinned tooltip and the folded structure sheet on a phone" width="240" class="light-only" loading="lazy" />
<img src="./images/phone-structure-sheet-dark.png" alt="A pinned tooltip and the folded structure sheet on a phone" width="240" class="dark-only" loading="lazy" />
</p>

On a phone:

- The app bar keeps the wordmark, the dataset's name and a search button, which opens search over
  the bar. The view bar keeps **Projection**, **Color by** and **More**.
- **More** opens a sheet with everything else: **Contours**, **Filter**, **Import data**,
  **Export**, **Theme** (System, Light, Dark), **Help & shortcuts** (Documentation, Keyboard
  shortcuts, Take the tour) and **Feedback**. A dot on **More** says something in it is active,
  such as contours or a filter.
- The panel under the plot holds the legend and the Filter panel, switched by the **Legend** and
  **Filter** tabs. Its chevron folds it to its header to give the plot the room.
- Tapping a protein selects it and pins its tooltip. Its structure opens in a sheet at the bottom,
  folded to its header so the plot and the tooltip stay in view; the header's chevron, or **View
  structure** in the tooltip, expands it. While it is expanded, a tap on the plot opens no tooltip.

<img src="./images/tablet-layout.png" alt="ProtSpace on a tablet: the plot above the legend and the structure" width="320" loading="lazy" />

On every touch screen:

- Drag to pan, pinch to zoom; a tap on empty space or a pan closes a pinned tooltip.
- Tap a legend row to hide or show it, and double-tap it to show only that category. The row's
  eye, handle and ⋯ menu are always shown, and every control is at least 40 px.
- To reorder the legend, hold a row's handle for a moment, then drag it.
```

- [ ] **Step 9: FAQ**

In `docs/guide/faq.md`, under "## Visualization". Keep the heading `### Is my data uploaded to a server?` exactly as it is: the landing page links to its slug (`apps/web/src/landing/WorkflowOverview.tsx:17`) and no check covers links from the app into the docs.

(a) Replace the answer under `### Can I customize colors?` (the line starting `Yes! Click the **cog icon**`) with:

```md
Yes. The gear in the legend's header opens **Legend settings**: pick a palette from its swatches
(colorblind-safe ones included), set how many categories show before the rest are grouped into
`Other`, and change the point size. Changes apply at once. To recolour one category, choose
**Colour and shape** from its row's ⋯ menu. Your choices are kept per dataset and annotation in
this browser. See [Settings](/explore/legend#settings).
```

(b) Directly after that answer (before `### What are multi-label annotations?`), insert:

```md
### Why are my figures light when the app is dark?

ProtSpace has a light and a dark theme: **Theme** in the app bar, or in **More** on a phone, with
**System** following your device. Exports always use the light colours: Quick PNG and PDF, the
Figure Editor's preview and its exports have a white background and the light greys, so a figure
looks the same whoever made it. See [Light and dark](/explore/#light-and-dark).

### Can I use ProtSpace on a phone or tablet?

Yes. Below 951 px the page rearranges for smaller screens and touch: on a phone the legend sits in
a panel under the plot, and the controls that do not fit are in **More**. See
[Phones and tablets](/explore/#phones-and-tablets).
```

Then format the four pages: `pnpm exec prettier --write docs/explore/importing-data.md docs/explore/exporting.md docs/explore/index.md docs/guide/faq.md` (it realigns the tables; it leaves the raw `<img>` block as written).

- [ ] **Step 10: Run the checks and see them pass**

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS: no stale term on any page with `STALE_PAGES` empty; the markdown pairs and the raw `<img>` pairs in order, each dark twin lazy; no orphan image; every anchor resolves, including `/explore/#light-and-dark` and `/explore/#phones-and-tablets` (index.md) and `/explore/legend#settings`. Give the test count before and after.

Run: `time pnpm docs:images:check`
Expected: PASS in under 3 s, with `LEGACY_IMAGES` and `STALE_PAGES` empty.

Run: `pnpm type-check:scripts && pnpm knip`
Expected: PASS (`IMPORT_EXPORT_CAPTURES` and `PHONE_CAPTURES` are consumed by `manifest.ts`).

Run: `pnpm docs:build`
Expected: PASS. Then `grep -o 'class="dark-only"[^>]*' docs/.vitepress/dist/explore/index.html | head -3` shows the phone twins with `loading="lazy"`.

Run: `pnpm exec prettier --write scripts/docs-screenshots/scenes/import-export.ts scripts/docs-screenshots/scenes/phones.ts scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts && pnpm exec prettier --check scripts/docs-screenshots/scenes/import-export.ts scripts/docs-screenshots/scenes/phones.ts scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/importing-data.md docs/explore/exporting.md docs/explore/index.md docs/guide/faq.md`
Expected: PASS.

No e2e spec and no app code changed; the full suites wait for the phase exit.

- [ ] **Step 11: Commit**

With the Bash sandbox disabled:

```bash
git add scripts/docs-screenshots/scenes/import-export.ts scripts/docs-screenshots/scenes/phones.ts scripts/docs-screenshots/scenes/controls.ts scripts/docs-screenshots/manifest.ts scripts/docs-screenshots/docs-lint.ts docs/explore/importing-data.md docs/explore/exporting.md docs/explore/index.md docs/guide/faq.md docs/explore/images/toast.png docs/explore/images/toast-dark.png docs/explore/images/loading-overlay.png docs/explore/images/loading-overlay-dark.png docs/explore/images/phone-layout.png docs/explore/images/phone-layout-dark.png docs/explore/images/phone-more-sheet.png docs/explore/images/phone-more-sheet-dark.png docs/explore/images/phone-structure-sheet.png docs/explore/images/phone-structure-sheet-dark.png docs/explore/images/tablet-layout.png
git commit -m "docs(explore): importing, exporting, phones and the FAQ"
```

Report the eleven image files with their sizes, whether any `STALE_PAGES` entry other than the two named was left for this task, and `git status` showing nothing else changed.

### Task 7.16: Developer docs, the images README, allowlists retired

The developer docs catch up: theming for embedders and the full components table in `embedding.md`, the breaking notes checked, `CONTRIBUTING.md` and the images README describing the runner, the `-dark` convention, the lint and the thumbnails' home. The empty allowlists and their code go.

**Files:**

- Modify: `docs/developers/embedding.md` ("## Theming" after "Basic HTML Setup"; the components table gains `protspace-selection-bar`, `protspace-plot-status`, `protspace-query-builder`, `protspace-publish-modal` and a row for the `ps-*` kit)
- Modify: `docs/developers/api/index.md` (only if a note is missing: control bar removed :309-311, `file-dropped` :152-153, `selectedCount`/Clear/Isolate :603, `allow-drop` :763; list what was checked)
- Modify: `CONTRIBUTING.md` (:143 source tree without `control-bar/`; the docs-images section: `pnpm docs:images`, `-g` for one image, `pnpm docs:gifs`, `pnpm docs:images:check`, the 8096 server, `pnpm examples:fetch`)
- Modify: `docs/explore/images/README.md` (rewrite: manifest and scenes, runner, file naming and `-dark`, the GIF ladder and budget, the lint, where the thumbnails come from)
- Modify: `scripts/docs-screenshots/docs-lint.ts` (`LEGACY_IMAGES`, `STALE_PAGES` and their branches deleted; `STALE_TERMS` no longer exported), `scripts/docs-screenshots/check.ts` (its header comment stops naming `LEGACY_IMAGES`), `apps/web/src/explore/docs-images.test.ts` (allowlist cases deleted; the real-docs run unchanged; one case pinning that no allowlist is left)

**Interfaces:**

- Consumes: `adoptTheme` behaviour (`packages/core/src/components/kit/adopt-theme.ts`; runs when `@protspace/core` or `@protspace/core/kit` is imported, `kit/index.ts:6`, adopting the token sheet in `@layer ps-theme`, `adopt-theme.ts:9-13`), the theme selectors (`styles/theme.ts:141-146`: `:root[data-theme='dark']`, `[data-theme='system']` under `prefers-color-scheme: dark`); the element list in `packages/core/src/index.ts` and `components/publish/index.ts`; `lintDocs`, `lintManifest`, `LEGACY_IMAGES`, `STALE_PAGES`, `STALE_TERMS` and the docs-lint cases as Task 7.5 wrote them.
- Produces: `embedding.md` "## Theming": importing core adopts the tokens; `data-theme="dark"` or `"system"` on `<html>` (absent = light); an unlayered `:root { --ps-accent: … }` overrides in both themes; components in another document (an iframe) need core imported in that document; the `--protspace-*` colour properties are gone (link to `style-architecture.md`). `docs-lint.ts` exports `headingSlug`, `imageRefs`, `lintDocs`, `lintManifest`, `pageAnchors` and its four types, and no allowlist.
- Why the iframe advice is "import core there": `adoptTheme` is not exported (`kit/index.ts` imports it and calls it; neither `kit/index.ts` nor `src/index.ts` re-exports it). Exporting it is a core API change with no consumer in this phase, so the section says what works today: load `@protspace/core` in the iframe, which adopts the tokens into that document.

**Tests:**

- `docs-images.test.ts` still passes without the allowlist cases, plus "docs-lint keeps no allowlist" (`Object.keys` of the module namespace is exactly the five functions); `pnpm docs:images:check`; `pnpm docs:build`; `pnpm knip` (no unused export left in `docs-lint.ts`); prettier on the changed markdown.
- Unrun at task time: none.

- [ ] **Step 1: Check the precondition**

Run: `grep -n -A3 "LEGACY_IMAGES: ReadonlySet\|STALE_PAGES: ReadonlySet" scripts/docs-screenshots/docs-lint.ts`
Expected: both sets empty after Task 7.15 (`new Set([])` or `new Set<string>()`, no string inside). If either still lists a file or page, stop: that page task is unfinished. Report what is left instead of deleting a set that still holds something.

- [ ] **Step 2: Write the failing test**

In `apps/web/src/explore/docs-images.test.ts`, add below the named `docs-lint` import:

```ts
import * as docsLint from '../../../../scripts/docs-screenshots/docs-lint';
```

and append to the end of the file:

```ts
describe('docs lint: no allowlist left', () => {
  it('exports only the checks: every image comes from the manifest, every page is current', () => {
    expect(Object.keys(docsLint).sort()).toEqual([
      'headingSlug',
      'imageRefs',
      'lintDocs',
      'lintManifest',
      'pageAnchors',
    ]);
  });
});
```

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: FAIL in "exports only the checks", the received array also holding `LEGACY_IMAGES`, `STALE_PAGES` and `STALE_TERMS`. Every other case passes.

- [ ] **Step 3: Retire the allowlists**

In `scripts/docs-screenshots/docs-lint.ts`:

1. `STALE_TERMS` stays, unexported (its only importer was the STALE_PAGES test deleted below). Replace

   ```ts
   export const STALE_TERMS: readonly RegExp[] = [
   ```

   with

   ```ts
   const STALE_TERMS: readonly RegExp[] = [
   ```

2. Delete both sets with their comments: from the line `/**` that opens "Images from the old layout that their page task has not yet regenerated or deleted." through the closing `]);` of `export const STALE_PAGES: ReadonlySet<string> = new Set([`.

3. In `staleProblems`, replace

   ```ts
       if (!USER_GUIDE.test(page.path) || STALE_PAGES.has(page.path)) continue;
   ```

   with

   ```ts
       if (!USER_GUIDE.test(page.path)) continue;
   ```

4. In `lintManifest`, delete

   ```ts
       if (LEGACY_IMAGES.has(output.file)) {
         problems.push(`${output.file}: an entry makes it, so remove it from LEGACY_IMAGES`);
       }
   ```

   and replace

   ```ts
       if (!made.has(file.file) && !LEGACY_IMAGES.has(file.file)) {
   ```

   with

   ```ts
       if (!made.has(file.file)) {
   ```

5. Replace `lintManifest`'s doc comment

   ```ts
   /**
    * The checks that need the capture manifest: every output on disk, within its budget and shown by
    * each page its entry names; every file made by an entry or still in `LEGACY_IMAGES`.
    */
   ```

   with

   ```ts
   /**
    * The checks that need the capture manifest: every output on disk, within its budget and shown by
    * each page its entry names; every image file made by an entry.
    */
   ```

In `scripts/docs-screenshots/check.ts`, replace in the header comment

```ts
 * image under docs/explore/images/ must come from the capture manifest (or still be listed in
 * LEGACY_IMAGES), be shown by the pages its entry names, and keep GIFs within their budget; the
```

with

```ts
 * image under docs/explore/images/ must come from the capture manifest, be shown by the pages its
 * entry names, and keep GIFs within their budget; the
```

(then let Prettier rewrap the comment).

In `apps/web/src/explore/docs-images.test.ts`:

- remove `LEGACY_IMAGES,`, `STALE_PAGES,` and `STALE_TERMS,` from the named `docs-lint` import;
- delete the case `it('leaves a page in STALE_PAGES alone until its rewrite', …)` in "docs lint: stale terms";
- delete the case `it('lets a legacy image stand without an entry, but not once an entry makes it', …)` in "docs lint: manifest";
- delete the cases `it('LEGACY_IMAGES lists only files that exist', …)` and `it('STALE_PAGES lists only pages that still use a stale term', …)` in "docs lint: the real docs".

`grep -n "LEGACY_IMAGES\|STALE_PAGES\|STALE_TERMS" apps/web/src/explore/docs-images.test.ts scripts/docs-screenshots/*.ts` now prints only the two `STALE_TERMS` lines inside `docs-lint.ts` (its declaration and its use in `staleProblems`).

Run: `pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts`
Expected: PASS, three fewer tests than before Step 2 (four deleted, one added). "passes every page and image" still passes: with `STALE_PAGES` gone every user-guide page is checked for stale terms, and 7.9–7.15 left none.

Run: `pnpm docs:images:check`
Expected: PASS: every image file is a manifest output.

- [ ] **Step 4: Theming for embedders, and the components table**

In `docs/developers/embedding.md`, in the "## Components Overview" table, add these rows after the `Data Loader` row:

```md
| Selection bar    | `<protspace-selection-bar>`                                                                   | The selected count; Show only these, Zoom to them, Copy IDs, Clear |
| Status corner    | `<protspace-plot-status>`                                                                     | Protein count and a chip per filter, Show only or hidden categories |
| Filter           | `<protspace-query-builder>`                                                                   | Build and apply an annotation filter                |
| Figure editor    | `<protspace-publish-modal>`                                                                   | Publication figures; registered by `@protspace/core/publish` |
| Kit              | `<ps-button>`, `<ps-icon-button>`, `<ps-menu>`, `<ps-popover>`, `<ps-dialog>`, `<ps-tooltip>`, … | The design-system elements the others are built from |
```

Replace the sentence under "Importing `@protspace/core` once registers every element." —

```md
The [API Reference](/developers/api/) lists every control, including the query builder and the
projection details card.
```

with

```md
`<protspace-publish-modal>` is the exception: it lives in the `@protspace/core/publish` entry, so a
host loads it only when a figure is wanted. The [API Reference](/developers/api/) lists every
control, including the projection details card.
```

Insert this section after "## Basic HTML Setup" ends, that is directly before the line `## Auto-Sync Feature`:

````md
## Theming

Importing `@protspace/core` (or `@protspace/core/kit`) adds the design tokens to the page once: a
stylesheet of `--ps-*` custom properties on `:root`, in the `ps-theme` cascade layer. Every
component reads its colours, type sizes, spacing and radii from these tokens, so they are the one
place to restyle them.

### Light and dark

The page is light unless `<html>` carries `data-theme="dark"` (always dark) or
`data-theme="system"` (dark while the operating system prefers dark, following a change live):

```js
document.documentElement.dataset.theme = 'system'; // or 'dark'; delete it for light
```

With no `data-theme`, or any other value, the tokens hold their light values. Set the attribute
before the components first render to avoid a light flash. The scatterplot and the structure
viewer restyle themselves when the theme changes, without reloading anything. Exports (PNG, PDF and
the figure editor's output) always use the light colours on white.

### Your own colours

The tokens sit in a cascade layer, so any unlayered rule of yours wins over them, whatever its
specificity:

```css
/* Both themes */
:root {
  --ps-accent: #7c3aed;
}

/* Dark only: under data-theme="dark", and under "system" while the OS prefers dark */
:root[data-theme='dark'] {
  --ps-accent: #a78bfa;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme='system'] {
    --ps-accent: #a78bfa;
  }
}
```

A rule inside another cascade layer (Tailwind's `@layer base`, for example) does not override a
token; keep token overrides unlayered. The tokens are listed, light and dark, in
`packages/core/src/styles/theme.ts`; the ones a host most often sets are `--ps-accent`,
`--ps-surface`, `--ps-surface-raised`, `--ps-text`, `--ps-text-muted`, `--ps-border` and
`--ps-plot-bg`.

### Components in another document

The tokens are added to the document that imports the module. Components rendered into an
`<iframe>` need `@protspace/core` imported by a script inside that iframe, which adds the tokens to
the iframe's own document.

::: warning BREAKING
The `--protspace-*` colour properties (the scatterplot's background, brush, tooltip and overlay
colours; the structure viewer's `--protspace-viewer-bg`, `-border`, `-header-bg`, `-text`,
`-text-muted`, `-error`, `-loading`) are removed. A host that set them sets the `--ps-*` token the
component now reads instead. Size properties such as `--protspace-viewer-height` stay. See
[Component properties](./style-architecture.md#component-properties).
:::
````

- [ ] **Step 5: Check the breaking notes in the API reference**

Run:

```bash
grep -n "BREAKING" docs/developers/api/index.md
grep -n "protspace-control-bar\|file-dropped\|selectedCount\|allow-drop" docs/developers/api/index.md | head -20
```

Expected (as at `a8cb13ca`): a `::: warning BREAKING` block naming `<protspace-control-bar>` as removed (~:309-311), one for `file-dropped` (~:152-153), the `**BREAKING:**` line for `selectedCount`, Clear and Isolate (~:603), and the `allow-drop` note marked **BREAKING** (~:763). If all four are present, change nothing in the file; list the four line numbers in the report. If one is missing, add a `::: warning BREAKING` block at the element's section, in the style of the `file-dropped` one, saying what was removed and what replaces it, and name it in the report.

- [ ] **Step 6: CONTRIBUTING.md**

In the "### Monorepo Structure" tree, replace the line

```
│       ├── control-bar/
```

with

```
│       ├── kit/              # ps-* elements: buttons, menus, popovers, dialogs
```

In "## Documentation", insert this paragraph directly before the line `**Documentation standards:**`:

````md
**Docs images:** every image under `docs/explore/images/` comes from one capture manifest, its
entries grouped by docs page in `scripts/docs-screenshots/scenes/`
(`docs/explore/images/README.md` describes the pipeline). The captures start their own app server
on port 8096 (`DOCS_CAPTURE_PORT` changes it) and a headed Chromium; the examples other than the
startup demo need `pnpm examples:fetch` first.

```bash
pnpm docs:images                                          # every screenshot and GIF
pnpm docs:screenshots -g "filter-panel"                   # the PNGs whose file name matches (light and -dark)
pnpm docs:animations -g "zoom.gif" && pnpm docs:gifs zoom # one GIF: record it, then convert it under its budget
pnpm docs:images:check                                    # the pre-commit lint: manifest, files, pages, anchors
```
````

If Task 7.3 left the `pnpm docs:images` line in the "**Working on docs:**" block describing the old pipeline ("screenshots, animations, GIFs"), leave it: it is still true.

- [ ] **Step 7: The images README**

Replace the whole of `docs/explore/images/README.md` with:

````md
# Documentation Images

Every image in this folder is generated: one capture manifest names each file, and one runner makes
it. Do not edit or add an image by hand; `pnpm docs:images:check` (in `pnpm precommit`) fails on a
file no manifest entry makes.

## Generating images

```bash
pnpm docs:images                                          # everything: screenshots, then animations, then GIFs
pnpm docs:screenshots -g "legend-settings"                # the PNGs whose file name matches
pnpm docs:animations -g "zoom.gif" && pnpm docs:gifs zoom # one GIF: record the video, then convert it
pnpm docs:images:check                                    # the lint, without a browser
```

`-g` matches the test titles, which are the file names (`legend-settings.png`,
`legend-settings-dark.png`, `zoom.gif`, `examples/demo.png`), so a part of a name captures both
variants and `|` captures several images.

The captures start their own Vite server on port 8096 (`DOCS_CAPTURE_PORT` to change it), never
reuse one, and serve the product demo as the startup dataset. With `PLAYWRIGHT_BASE_URL` set they
use that server instead; a server that pins the startup load to an E2E fixture is refused. They run
a headed Chromium on macOS, for GPU WebGL. Captures of the other examples need their files first:

```bash
pnpm examples:fetch
```

Structure captures load the real Mol\* and AlphaFold models, so they need network.

## Where each image comes from

`scripts/docs-screenshots/`:

- `scenes/*.ts`: the entries, one module per docs area (`controls.ts`, `legend.ts`,
  `structures.ts`, …), concatenated by `manifest.ts`. One entry per image: its name, PNG or GIF,
  viewport (`desktop` 1280×720, `tablet` 800×1280, `phone` a Pixel 7 at 412×839), themes, dataset,
  layout, setup and steps, what to crop, and the docs pages that show it.
- `capture-plan.ts`: the entry types, file naming, the light/dark variants, the manifest's own
  validation and the GIF ladder (pure; the app's Vitest tests it).
- `runner.ts`: one Playwright test per image and theme. It opens Explore, waits for the data and
  for the plot to settle, runs the entry, parks the pointer, checks no tooltip is open and takes the
  picture. Desktop PNGs are taken at device scale 2 with reduced motion; GIFs are recorded at scale
  1. Steps wait for signals (a dialog visible, a structure loaded, the plot settled); the only pause
  is `cap.hold(ms)`, which paces a GIF.
- `indicators.ts`: the cursor, click and key overlays a GIF shows, in the page's theme.
- `gif.ts`: the video-to-GIF converter. `check.ts` and `docs-lint.ts`: the lint.

To find which pages show an image, see its entry's `docs`, or grep the docs for its file name.

## File names and dark twins

A file is named after its entry: `name.png` or `name.gif`, lowercase kebab-case, optionally under
`examples/`. A screenshot with a dark variant gets a twin, `name-dark.png`, captured with the
browser in dark mode and the app's theme on System. Only screenshots have twins: GIFs, the example
thumbnails, the menu crops and the EAT crops are light only.

A page shows a pair as two images on consecutive lines, the light one first; the docs site hides
whichever does not match its appearance (a `<style>` rule in `docs/.vitepress/config.mts`):

```md
![Alt text](./images/filter-panel.png){.light-only}
![Alt text](./images/filter-panel-dark.png){.dark-only}
```

As raw HTML, the dark twin also loads lazily, so light readers never fetch it; never give a paired
image an inline `display` style, which would beat that rule:

```html
<img src="./images/x.png" class="light-only" alt="…" width="1280" height="720" />
<img src="./images/x-dark.png" class="dark-only" alt="…" width="1280" height="720" loading="lazy" />
```

## GIFs and their budget

A GIF entry is recorded as a `.webm` in `temp-videos/` (git-ignored) with a JSON sidecar holding
the time to trim from the start (the end of the entry's setup). `pnpm docs:gifs [name…]` converts
each with a two-pass ffmpeg palette and walks a ladder until the file fits the entry's budget:
30 fps at 1000 px wide, then 20 and 15 fps, then 800 and 640 px at 15 fps. The budget is 3 MiB
(3,145,728 bytes) unless the entry sets `budgetBytes`. A GIF still over budget at the last rung
fails the run, keeps its `.webm`, and leaves the previous GIF in place: shorten the entry's steps
or its `hold`s. `ffmpeg` must be on your `PATH`.

## The lint

`pnpm docs:images:check` runs in `pnpm precommit` and reads only files. It fails when:

- a manifest output is missing, or a file here has no manifest entry;
- a GIF is over its budget;
- a page shows a file that does not exist, a file is shown by no page, or a page an entry names
  does not show it;
- a `-dark` file has no light twin, or a pair is not written as above;
- a link's `#anchor` matches no heading on its page (VitePress checks pages, never anchors);
- the user guide names removed UI (the control bar, the Isolate button and the like).

`apps/web/src/explore/docs-images.test.ts` runs the same rules on small cases and on the real docs
in `pnpm test`.

## The example thumbnails

`examples/<id>.png` are the [Example Datasets](../example-datasets.md) page's thumbnails, one per
catalog example, from `scenes/examples.ts`: 1280×720 at scale 1, always light, each example opened
from the files the product serves.

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "examples/"
```

`pnpm docs:examples:check` fails when a card's thumbnail is missing. The opt-in `examples-live` E2E
project still opens every example and checks its curated view, but writes no image.
````

Before writing it, check each fact against the code as the earlier tasks left it and correct the README where it differs (say which in the report): the port and its variable (`playwright.config.ts`), the viewports and scales and `reducedMotion` (`capture-plan.ts`, `runner.ts`), the ladder and `DEFAULT_GIF_BUDGET` (`capture-plan.ts`), the CLI of `gif.ts` (`--keep`, names), the sidecar and `temp-videos/` (`paths.ts`), and the scene module names (`ls scripts/docs-screenshots/scenes`).

- [ ] **Step 8: Run what the task touches**

```bash
pnpm exec prettier --write docs/developers/embedding.md CONTRIBUTING.md docs/explore/images/README.md scripts/docs-screenshots/docs-lint.ts scripts/docs-screenshots/check.ts apps/web/src/explore/docs-images.test.ts
pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts
pnpm type-check:scripts
pnpm docs:images:check
pnpm docs:build
pnpm knip
pnpm exec prettier --check docs/developers/embedding.md CONTRIBUTING.md docs/explore/images/README.md scripts/docs-screenshots/docs-lint.ts scripts/docs-screenshots/check.ts apps/web/src/explore/docs-images.test.ts
```

Expected: all pass. `docs:build` checks the new `./style-architecture.md#component-properties` page link (VitePress) and `docs:images:check` its anchor (`### Component properties` → `component-properties`). `knip` passes: `docs-lint.ts` exports five functions and four types, all imported by `check.ts` or the test (the namespace import counts as using the functions). Report the `docs-images.test.ts` count before and after, the four API-reference lines from Step 5, and any README fact you corrected. No image file is written or deleted.

- [ ] **Step 9: Commit**

```bash
git add docs/developers/embedding.md CONTRIBUTING.md docs/explore/images/README.md scripts/docs-screenshots/docs-lint.ts scripts/docs-screenshots/check.ts apps/web/src/explore/docs-images.test.ts
git commit -m "docs(developers): theming for embedders and the docs image pipeline"
```

Add `docs/developers/api/index.md` to the `git add` line only if Step 5 changed it.

## Phase 7 exit

Run once, after Task 7.16 and the last block's fixes, in this order (sandbox disabled where noted):

1. Unrun-first: every spec listed under "Unrun at task time" by any task, first `product-tour.spec.ts`, `mobile-bars.spec.ts --project=mobile`, `workbench-a11y.spec.ts`, `mobile-a11y.spec.ts --project=mobile`, `workbench-theme.spec.ts`, `workbench-view-bar.spec.ts`, `workbench-help.spec.ts`, `figure-editor.spec.ts`, `eat-visualization.spec.ts`, `workbench-feedback.spec.ts`, `workbench-search.spec.ts`, `legend-double-click.spec.ts`, `url-view-state.spec.ts`, `dataset-reload.spec.ts`, `workbench-escape.spec.ts`, `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts --project=mobile`, `workbench-sidebar.spec.ts`, `workbench-helpers.spec.ts` (`examples-live.spec.ts`, changed in 7.2 and 7.3, runs opt-in in step 3).
2. Suites against the baseline counts: `pnpm --filter @protspace/utils exec vitest --run`; `pnpm --filter @protspace/core exec vitest --run` (unit and browser, sandbox disabled); `pnpm --filter @protspace/app exec vitest --run`.
3. Full e2e: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (every project); then `--project=mobile` three times and `product-tour.spec.ts --repeat-each 5`; `pnpm examples:fetch` then `RUN_EXAMPLES_E2E=1 PLAYWRIGHT_PORT=8475 pnpm test:e2e examples-live.spec.ts` (assertions only, no thumbnails written).
4. `pnpm perf:counts` (all budgets; the tour stays off in measured runs under the new key) and `pnpm perf` at 573K within the phase-6 numbers.
5. The full pipeline from a clean `temp-videos/`: `pnpm docs:images` (sandbox disabled, network). Every GIF within budget, then `pnpm docs:images:check`. Every committed image is rewritten (captures are not byte-stable: GPU rasterisation, video timing), so judge by content, not bytes: compare by eye against the per-task images. If the set is good, commit it as `docs(explore): regenerate every docs image` (the hook re-runs `docs:images:check` and `docs:build`). If a capture regressed, `git restore docs/explore/images` and fix the scene first. Afterwards `git status` shows no change under `docs/explore/images/`. Report the total size of `docs/explore/images/` before (about 41 MB of GIFs at `a8cb13ca`) and after.
6. `pnpm quality`, `pnpm format:check`, `pnpm docs:annotations:check`, `pnpm docs:examples:check`, `pnpm docs:images:check`, `pnpm docs:build`; the explore chunk carries no driver.js. The app's links into the docs, which the lint cannot see: `grep -rn 'DOCS_URL}' apps/web/src` and confirm every linked page and `#anchor` exists in the built site (`FeatureShowcase.tsx`, `WorkflowOverview.tsx` including `guide/faq#is-my-data-uploaded-to-a-server`, and `EXAMPLES_DOCS_URL`'s `explore/example-datasets#<id>`).
7. For the user: `pnpm docs:preview` (or the built site) in light and dark, switching with the docs' appearance toggle — every paired image swaps and no page shows both; the regenerated images side by side with the `a8cb13ca` ones as the before/after review set (design 20); the tour's first and a middle step on desktop, tablet (800×1280) and phone (412×839), the What's new tour on desktop and phone, in light and dark. Visual review items for the user's call: GIF pacing and legibility after the ladder; the menu crops' padding.
8. `tasks.md` section 7 ticked; the ledger records the exit counts.

<!-- prettier-ignore-end -->
