# Explore Workbench, Phase 8B: Verification, Device Pass, Spec Files, PR Text and Archive — Implementation Plan

<!-- Code snippets keep the indentation of the files they edit, so Prettier leaves this plan as written. -->
<!-- prettier-ignore-start -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the change. First prove the merged tree (workbench + `perf/improvements` + `main` at `44af7d97`) works as a whole: every unit, browser, contract, Python, e2e (desktop, phone, tour), accessibility and perf check runs once on `d071e1da` or its successor, with the 573K v3 bundle rebuilt, and what fails is fixed test-first. The user then checks the app on real phones, a tablet and desktop browsers from a checklist; while they do, the 29 capability spec files are written from the final code and tests (10 new, 19 modified), checked by a header-check script and `openspec validate --strict`. The proposal, design and task list are brought in line with what shipped; the PR description is rewritten short and plain; a dry-run archive in `$TMPDIR` proves the deltas merge without losing text. Last, and only after PR #526 has merged: `main` is merged again if it moved, #555 is retargeted to `main`, the full suites and the spec checks run once more, and `openspec archive explore-workbench` lands as the last commit with CI green.

**Architecture:** No new runtime structure. Code changes happen only in the fixer tasks (8.16, 8.18) and in conflict resolution (8.28), each test-first and scoped to what a failing check or the user's device notes name. Spec files live in `openspec/changes/explore-workbench/specs/<capability>/spec.md`: a new capability holds only `## ADDED Requirements`; a modified one copies each changed requirement whole from `openspec/specs/<capability>/spec.md` and edits it. One-off tooling (the header-check script and its self-test) lives in the git-ignored `.superpowers/sdd/phase-8b-wrapup/`, so it survives `$TMPDIR` cleanup and never ships. `openspec/specs/` is edited only by the archive (8.30).

**Tech Stack:** OpenSpec CLI 1.4.1 (`/opt/homebrew/bin/openspec`: `validate`, `change show`, `archive -y`), bash + awk (header check), Vitest 4.1.9 (utils, core `unit` + `browser`, app, `tests/contract`), Playwright 1.61 (`apps/web/tests/playwright.config.ts`, default projects include `workbench`, `mobile`, `product-tour`; `perf-counts`), `node perf/perf.mjs` (`pnpm perf`), uv + pytest + ruff (`apps/protspace`), `protspace convert` (v1 → v3 bundle), `gh` 2.83 (PR state, base, checks), Prettier.

**Spec:** `openspec/changes/explore-workbench/design.md`: decision 21 (delivery: one PR, merged without squashing; the spec files written from the final code, then the archive as the last commit) is the core; 20 (testing: e2e both projects, accessibility in both themes, perf at 573K within budget plus the panel-toggle scenario, manual Safari/Firefox pass), 17 (phones and tablets; the real-device pass on iOS Safari and Android Chrome, Risks), 18 (code structure; the recorded exceptions feed the PR's follow-up note); every other decision only as a pointer to code: the specs describe the final code and tests, never design.md's wording. `proposal.md` (the capability list: 10 new, 17 modified, plus `table-export` and `structure-coloring` added by this phase). `tasks.md` section 8, part B (rewritten by the plan commit as 8.15–8.30, text under File structure). Research notes `.superpowers/research/phase-8b/R1-specs-after-merge.md` (spec content, header lines, archive) and `R2-verify-pr-archive.md` (verification, device checklist, PR text, CI), and the older `.superpowers/research/phase-8/R2-specs.md` §1 and §3 (delta format, per-capability source and evidence maps; its §3 annotation-presentation line and §8 Q3 are superseded). Not pulled in: any new feature, any `.github/workflows/*` edit, GitHub issues, the landing page, splitting `scatter-plot.ts` or the other files over 800 lines, type-checking core tests, the decimal comma in docs images, and the four earlier open calls.

**Worktree:** `/Users/heispv/Documents/protspace_web/protspace-workbench`, branch `feat/explore-workbench`. Run every command from there. This plan was written against `d071e1da` (pushed; `origin/main` at `44af7d97`, `origin/perf/improvements` at `cb4513d4`, PR #526 open, PR #555's base `perf/improvements`). If an anchor has moved, apply the intended change to the current code and say so in the report.

## Global Constraints

From phases 1–8A, unchanged:

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
- The legend's public surface (`legend.api.test.ts`: `METHODS` and `GETTERS`), DOM contract (`legend.dom-contract.test.ts`) and persistence stay as phases 3–8A left them.
- E2E: desktop specs stay `apps/web/tests/workbench-*.spec.ts` (project `workbench`: Desktop Chrome, 1280×720). Phone, tablet and landscape specs are `apps/web/tests/mobile-*.spec.ts` (project `mobile`, Pixel 7). Specs reach controls through helpers (`helpers/explore.ts`, `helpers/workbench.ts`, `helpers/legend.ts`, `helpers/mobile.ts`, `helpers/theme.ts`, `helpers/a11y.ts`, `helpers/plot.ts`, `helpers/structure.ts`, `helpers/figure.ts`, `helpers/examples.ts`) that find them by role, accessible name or tag; a helper never uses `shadowRoot` inside `page.evaluate`. Every exported helper is used by a spec in the same commit (knip). Assert placement, state and computed colours, not 3D pixels.
- The style lint (`packages/core/src/styles/style-lint.test.ts`) also checks `apps/web/src/workbench/workbench.css` and `apps/web/src/tour/product-tour.css` for raw colours and for reads of `--ps-*` variables `theme.ts` does not define; it accepts a module's own non-`--ps-` custom properties and has no allowlist. Sizes come from tokens: `--ps-touch-target` 40 px, `--ps-control-sm` 28, `--ps-control-md` 32, spaces `--ps-space-0-5` 2 … `-6` 24 px (no 16), radii `--ps-radius-sm` 4, `--ps-radius` 6, `-lg` 10, `-full`.
- `ps-icon-button` (`icon`, `label`, `pressed`, `size`, `tooltip-placement`, `expanded`, `hasPopup`), `ps-button` (`variant`), `ps-menu`/`ps-menu-item` (`menuitem`, `menuitemradio`), `ps-dialog` (`heading`, `size`; role `dialog` named by its heading), `ps-tooltip` (`text`, `placement`, `anchor` defaulting to the previous element sibling, `names-target`), `ps-segmented` (`SegmentedOption { value, label, disabled?, tooltip? }`; a disabled option is `aria-disabled`, arrow keys skip it, a press on it shows its reason). `kit/layers.ts`: `pushLayer({ close, elements, dismissOnOutsidePress? }): () => void`, `ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 }`.
- Docs images: a light image with a dark twin is written as a pair (`{.light-only}` then `{.dark-only}`); `pnpm docs:images:check` runs in the hook (not in CI: user decision); captures run `pnpm docs:screenshots -g "<file>"` / `pnpm docs:animations -g "<file>" && pnpm docs:gifs <name>` on their own server (port 8096, sandbox disabled, real Mol* from jsDelivr for structure captures). The decimal comma in four figure-editor images comes from the macOS Region and is accepted: never recapture for it.

Environment (from the phase 1–8A ledgers and the 8B research; trust these over older notes):

- Vitest browser mode starts a local server, so `--project browser` and the full core run need the Bash sandbox disabled (`EPERM listen ::1` inside it). `--project unit` works inside the sandbox. `__screenshots__/` folders under `packages/core/src` are git-ignored failure captures, not baselines.
- `pnpm add`/`pnpm install`, `git commit` (the hook needs network and writes outside the sandbox), `git merge` with conflicts resolved by the hook-checked commit, `pnpm test:e2e`, `pnpm perf*`, `pnpm docs:gifs`, and `uv run` on a cold cache need the sandbox disabled. Stage files by path, never `git add -A` (except `git add -A openspec` in 8.30, which stages the archive's renames).
- Core imports the BUILT `@protspace/utils`: after changing utils, run `pnpm --filter @protspace/utils build` before core tests. The app imports core's `dist`: after changing core, run `pnpm --filter @protspace/core build` before the app's unit tests or type-check. `pnpm test:e2e` and `pnpm perf:counts` build the packages themselves.
- Root-level `pnpm vitest` does not work; use `pnpm --filter @protspace/app exec vitest --run <file>` and `pnpm --filter @protspace/utils exec vitest --run <file>`. `pnpm test` (turbo) drops `TMPDIR`; prefer the package-scoped runs and add them up.
- App unit tests run in node with no DOM and cannot load Lit (`apps/web/vitest.config.ts`); React components are covered by e2e only.
- jsdom has no 2D canvas: canvas pixel tests are `*.browser.test.ts`.
- Playwright contexts default to `colorScheme: 'light'`. Tests that assert light must choose Light first (the default theme is System).
- Playwright's `ControlOrMeta` sends Meta on a macOS host but the app reads the modifier from the user agent (Control in headless Chromium); use `Control` explicitly in specs that need the modifier.
- The plot area holds two `role="status"` regions (status corner and selection bar): scope `getByRole('status')` to its element. Use `--project=mobile` (with `=`) for the mobile project.
- The e2e Mol* stub (`MOLSTAR_STUB`, installed by `stubStructureRequests(page)`) builds a viewer that draws nothing; e2e asserts placement and state.
- Known flakes, not caused by this phase: `example-datasets.spec.ts:828` (URL fallback race), the `numeric-binning` "hover point" test under full-suite load, `mobile-plot-touch.spec.ts:351`, `workbench-structure.spec.ts` grip-resize poll (~:399) under load; re-run once alone before investigating. AGENTS.md: never call a red CI run flaky on the strength of local passes; compare with the nightly on `main` (`gh run list --workflow=e2e.yml --event=schedule`).
- The pre-commit hook does not run `pnpm format:check`, but CI does: run `pnpm exec prettier --check <your files>` before committing (spec `.md` files included; `openspec/` is not prettier-ignored). A git-ignored file under `.superpowers/` is checked with `pnpm exec prettier --check --ignore-path .prettierignore <file>`: Prettier also reads `.gitignore`, so without `--ignore-path` it skips the file and passes without checking anything. Perf runs write JSON into `perf/results/`, which fails `format:check`: move them to the scratchpad before any check. The docs build scans untracked files under `docs/`: leave no scratch markdown there.
- Only stop processes you started yourself, by the PID you recorded; check a port's owner with `ps -p <pid> -o command=` before killing anything ("Claude Helper" belongs to the desktop app).
- To explore unfamiliar code: `cd /Users/heispv/Documents/protspace_web/protspace_web && graphify query "<question>"` (built from `main`; read the worktree's files). Never run `graphify update`.
- Never edit `.github/workflows/*`. **Never `git push`, `gh pr edit`, `gh pr ready` or retarget a PR without the user's OK in chat, asked by the orchestrator** (agents report "ready to push" instead). Never open GitHub issues. Never touch branches other than `feat/explore-workbench`.
- The OpenSpec CLI prints dozens of `ERROR: failed to copy trust settings of system certificate` lines in the sandbox: pipe every call through `2>&1 | grep -v "trust settings"` and pass `--no-interactive` to `validate`. There are no `/opsx:*` commands in this worktree: drive the CLI directly.
- `gh` may not reach `api.github.com` from the sandbox; retry once with the sandbox disabled, and if it still fails, report and let the orchestrator ask the user for the PR or CI state.
- `$TMPDIR` and the session scratchpad get cleaned between sessions (the phase-4 v3 bundle is gone): anything a later task needs goes under `.superpowers/sdd/phase-8b-wrapup/` (git-ignored), or is rebuilt by the task that needs it.
- Python: `uv run --directory apps/protspace …`; CI (`protspace-ci.yml`) runs `ruff check src/ packages/ tests/`, `ruff format --check src/ packages/ tests/` and `pytest -m "not slow" -q` on this PR, because `apps/protspace/**` changed (`deprecations.py`). `test_deprecations.py` and `test_docs_extras_sync.py` read web and docs paths.

**Execution rule (user, 2026-10-13, restated 2026-10-19):** per task, run only the unit/browser test files for the code you touch plus at most ONE e2e spec file (filtered with `-g "<title>"` and `--project workbench` or `--project=mobile` as needed). The full suites, both e2e projects, `pnpm perf:counts` and `pnpm perf` at 573K run twice in this phase: in Task 8.15 and in Task 8.29. A fixer task lists the specs its change could reach under "Unrun at task time"; 8.29 runs them first.

**Baseline:** Task 8.15 is the phase's baseline run: its counts are the numbers every later report compares with, recorded in `.superpowers/sdd/phase-8b-wrapup/progress.md`. Reference only (not a baseline): 8A exit utils 502, core 3400/252 files, app 964 + 1 skipped, e2e 476, `--project=mobile` 90, tour 21; after the merge (`8d5cee0f`) utils 514, core 3384, app 954; pytest 2027 in `../protspace-rebase`. The 573K reference is the 8A polish A/B table's B column (HEAD `46176145`) in `.superpowers/sdd/phase-8a-cleanup/phase-8a-polish-report.md` §4.

Phase 8B:

- **Paths.** Plan: `openspec/changes/explore-workbench/plans/phase-8b-verify-specs-archive.md`. Ledger and one-off files: `.superpowers/sdd/phase-8b-wrapup/` (File structure lists them). The orchestrator writes ledger lines in `progress.md` one per line, at column 0, in the forms `Task 8.N: dispatched (BASE <sha>)`, `Task 8.N: complete (<sha or no commit>)` and `Task 8.N: skipped (<reason>)`; later tasks grep them. Scratch data: `SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b` (the v3 bundle at `$SCRATCH/v3/573K_swissprot.parquetbundle`, perf JSONs at `$SCRATCH/perf/`).
- **The 573K bundle.** Only the v3 file rebuilt by `uv run --directory apps/protspace protspace convert <abs path of perf/datasets/573K_swissprot.parquetbundle> $SCRATCH/v3/573K_swissprot.parquetbundle` is used for timing. Expected about 36 MB on disk (the v1 input is 44.9 MB) and about 31 MB heap in the perf report; if it is not, stop and report. `perf/datasets/573K_swissprot.parquetbundle` itself is never passed to `pnpm perf`.
- **Perf rule.** Two `pnpm perf --datasets $SCRATCH/v3/573K_swissprot.parquetbundle --runs 4` runs on a quiet machine (load average reported). A segment is suspect only when both runs exceed the reference's busy time by more than 20 ms **and** by more than 10 %, or raise INP by 16 ms or more (two 8 ms steps). A suspect segment gets exactly one interleaved A/B (`pnpm perf --url <46176145 preview> --compare <HEAD preview> --datasets <v3> --runs 5`, both `vite preview` builds on ports 8302/8303 from a temporary worktree removed afterwards); a ratio inside 0.9–1.1 is noise and closes it. A real gap of tens of ms gets a cheap diagnosis and a few-line fix or a written note (user memory: no over-engineering for small perf deltas). `pnpm perf:counts` must pass every budget with no re-record.
- **The capability list (29).** New (ADDED only): `explore-workbench-layout`, `explore-theming`, `explore-ui-kit`, `plot-proportions`, `legend-panel`, `selection-workflow`, `explore-import-export`, `explore-help`, `explore-mobile-layout`, `docs-media-generation`. Modified: `query-builder-filtering`, `query-builder-controls`, `protein-search-feedback`, `annotation-presentation`, `category-focus`, `density-contours`, `scatterplot-point-size`, `eat-annotation-overlay`, `eat-reliability-filter`, `eat-provenance-connectors`, `example-datasets`, `support-contact`, `prep-failure-routing`, `e2e-validation`, `webgl-perf-harness`, `perf-checks`, `protein-resource-links`, `table-export`, `structure-coloring`. No delta for `point-visibility`, `stats-auto-clustering`, `imported-dataset-persistence`, `deprecation-policy`, `explore-loading-overlay`, `scatterplot-zoom-indicator`: their text holds; new specs use their terms and point at them by name instead of restating them.
- **Delta format.** One file per capability, `openspec/changes/explore-workbench/specs/<cap>/spec.md`, with no title or Purpose. Sections in this order: `## RENAMED Requirements` (`- FROM: \`### Requirement: <old>\`` / `- TO: \`### Requirement: <new>\``), `## MODIFIED Requirements` (using the new name after a rename), `## ADDED Requirements`, `## REMOVED Requirements` (each with `**Reason**:` and `**Migration**:`; none is planned). Requirements are `### Requirement: <name>` followed by normative text using SHALL; every requirement has at least one `#### Scenario: <name>` (exactly four hashes) with `- **WHEN** …`, `- **THEN** …`, `- **AND** …` bullets. A MODIFIED header is copied byte-for-byte from the main spec, and its block is the whole requirement (text and every scenario) copied first and then edited: anything left out is deleted at archive. Prose lines wrap at 100 columns, as in `openspec/specs/category-focus/spec.md`.
- **Spec content rules.** Written from the code and tests at the task's HEAD, never from `design.md`, `proposal.md` or this plan's prose (where they disagree with the code, the code wins and the task's report names the disagreement for 8.24). Each requirement states user-visible or contract behaviour; element ids, storage keys, event names and URL parameters may appear where they are a contract; file paths, line numbers, class names of internal controllers, phase numbers and plan task ids never do. A new capability has 4–8 requirements. Every scenario is backed by a named test or, for behaviour only a person can see, by a named code path; the map lives in `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (one `## <cap>` section per capability, one line per scenario: `- <Requirement> / <Scenario> → <test file>: "<test title>"`, the key copied whole from the spec file; several refs joined by `; `; a further title of the same file as `; "<title>"`; trailing ` (<note>)` allowed; a templated title cited as it runs; `code: <file> <what>` for a code path, a config or a listing), never in the spec. `check-evidence.py` (Task 8.20) enforces that format. Each behaviour is stated in exactly one capability: the ownership table in Rulings decides which.
- **Spec checks per spec task.** `pnpm exec prettier --write openspec/changes/explore-workbench/specs`; `openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"` (passes from Task 8.20 on); `openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings"` lists every capability written so far with its delta count; `bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs` exits 0 (WARN lines explained in `spec-evidence.md`); `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <the task's capabilities>` prints `evidence: 0 problem(s)` (from Task 8.20 on). Commit `docs(openspec): …`, one commit per task.
- **`openspec/specs/` is read-only until 8.30**, which edits it only through `openspec archive` plus the Purpose lines.
- **The gate.** Tasks 8.28–8.30 start only when `gh pr view 526 --json state --jq .state` prints `MERGED` and the user has said to go on. Before that, a gated task's agent stops at its first step and reports BLOCKED. Nothing in blocks 1–3 may archive, edit `openspec/specs/`, retarget #555, or merge `main` again.
- **The archive is last.** After 8.30's commit nothing lands on the branch. If a change is needed afterwards, the orchestrator `git revert`s the archive commit, the fix lands test-first, the spec deltas it affects are updated, and 8.27, 8.29's checks and 8.30 run again.
- **PR text.** `.superpowers/pr-description.md` is the source the orchestrator pastes with `gh pr edit 555 --body-file` after the user's OK. Short (at most 15 lines), plain English, no internal names: never "workbench", "mobile-responsive", "phase", "OpenSpec", "controller", "kit", "ps-", "protspace-", a task id or a SHA. Follow-ups are a short note, not issues.
- **Kept as they are (user):** phone legend row order, the landscape eye-only legend, the compact touch card, the "Theme" label; `docs:images:check` local only; the decimal comma. The device checklist lists them under "decided, do not report".

## Review Focus

1. **Main-spec text is lost or overwritten without an error at the archive.** A MODIFIED block copied without one of its scenarios, a header off by one character (the archive then treats it as missing or merges the wrong block), an ADDED requirement whose name already exists, or a main spec that `main` edited after our copy was taken: the archive replaces the whole requirement with our block and nothing fails. Pinned by Task 8.19 (`check-headers.sh`, including the WARN for a MODIFIED block with fewer scenarios than main, self-tested on fixtures), Task 8.27 (dry-run archive: per-requirement diff of all 19 changed main specs, `TBD` exactly in the 10 new ones) and Task 8.28 (main-spec drift check of the 19 modified capabilities after the re-merge), rerun in 8.29.
2. **The merged tree fails where no targeted run looked.** `main` brought 351 commits into a UI it was not written for: the Table (.tsv) export through the More sheet on phones, deprecation and 3-D notices in the restyled toaster, the recovery banner, the score-strip caveat, Python tests that read the moved docs pages; only nine conflicted e2e specs ran after the merge. Pinned by Task 8.15 (every suite and both e2e projects, contract tests, pytest and ruff, `pnpm precommit`, `format:check`) and its fixes in 8.16.
3. **A real phone behaves unlike the emulator.** The 250 ms hold before a legend drag and a fast drag across rows, a tap on the disabled TED option, the landscape scroll at ≤500 px, the tour's "Interactive Scatterplot" popover over the legend, Safari's download of a Table (.tsv) or PNG after a slow save prompt (the 60 s Blob URL), and the floating card over Copy IDs and Clear. No automated test drives a real touch screen or a real Safari download. Pinned by Task 8.17 (the checklist, one line per item) and Task 8.18 (each failure fixed with a test that fails first, in the `mobile` project where it can).
4. **The specs promise what the code does not do.** Text taken from `design.md` or from main's older wording: "the stored import is cleared" when an example is chosen, a Contours trigger that reads "Contours" while Off, a settings Save button, a `⚡ Predicted` badge, "Showing only N categories", the site header's Feedback button. Pinned by Tasks 8.20–8.23 (every scenario mapped to a test in `spec-evidence.md`, every cited title checked by `check-evidence.py`; each task runs three cited tests) and Task 8.25 (the deltas rechecked against every code commit after the spec block, device fixes included).
5. **Perf is compared on the wrong file or read from noise.** The v1 573K file (45 MB, different code path) against the v3 reference fakes a regression; one loaded-machine run reads as a 10–17 ms regression, as it did at the 8A exit. Pinned by Task 8.15 (rebuild with `protspace convert`, size and heap check, two runs, the A/B rule only past both 20 ms and 10 %) and Task 8.29 (the same rule, run when any commit since 8.15 touched the plot path).

## Rulings

- **Archive after #526 merges** (R1 Q5, R2 Q1; user): block 4 is gated on `MERGED`; then `main` is merged again if it moved, #555 retargeted, checks rerun, archive last with CI green.
- **Specs written during the device pass** (R2 Q2; user): block 2 runs while the user tests; device fixes (8.18) wait until the block's review is done, so one writer is in the worktree at a time; 8.25 rechecks the deltas against every code commit after block 2's base.
- **`table-export` gets a MODIFIED delta** (R1 Q1 over R2 Q3; orchestrator): `The web app exports the visible proteins as a table` names the app bar's Export menu (the More sheet's Export on phones) and the item "Table (.tsv)", and the isolation scenario says "Show only these"; both scenarios kept word-for-word otherwise; `The web table holds coordinates and annotations` is untouched. The rows rule is stated only here; `explore-import-export` names the item in the menu list.
- **`structure-coloring` gets one ADDED requirement** (R1 Q2; orchestrator): "A disabled structure colour option says why" — the reasons "Available once the structure has loaded" and "TED domain annotations are unavailable for this protein" (from `structure-viewer.ts` `_tedButtonTitle`). The generic mechanism (press shows the reason, arrow keys skip) belongs to `explore-ui-kit`.
- **`annotation-presentation` modifies only `Legend marks predicted annotations`** (R1 Q3; orchestrator): the sparkles mark (`role="img"`, "Predicted annotation") with the tooltip "Predicted: computational, not experimentally curated". `Friendly annotation labels at display sites` and `The annotation dropdown groups annotations by source` stay ("dropdown" is not reworded). No REMOVED (R2-specs §3's "remove the Predicted group" is obsolete: main already removed it).
- **Purpose text in the archive commit** (R1 Q4; orchestrator): the 10 generated `TBD` Purposes become one plain sentence each in 8.30's commit, and so do the two modified specs whose Purpose names removed UI (`query-builder-filtering` line 5 "from the control bar"; `annotation-presentation` line 5 if the merged text contradicts it).
- **No GitHub issues** (R2 Q4; user): the three follow-ups are one short note in the PR text.
- **#555 is marked ready for review by the user** (R2 Q5): the orchestrator offers it once 8.29's CI is green, before 8.30, so review lands before the specs freeze; agents never run `gh pr ready`.
- **Renamed requirements** (R1 §1; settled here so 8.19's fixtures, 8.22, 8.23 and 8.24 agree): `category-focus` `The Tips popover lists Shift + Hover` → `The keyboard shortcut list names Shift + Hover`; `query-builder-filtering` `Filter query builder is opened from the control bar` → `Filter queries are built in the Filter panel`.
- **The header check is a git-ignored script, not a $TMPDIR one-off** (R1 §3 said `$TMPDIR`): block 4 needs it again after `$TMPDIR` may be cleaned, and it must not ship. It also warns when a MODIFIED block has fewer scenarios than main's requirement (R1 §5's partial-copy risk), and checks that a capability without a main spec has only ADDED. Committed nowhere.
- **The loading overlay's copy, Tab blocking and focus return go in `explore-import-export`** (R2-specs Q2): `explore-loading-overlay`'s three requirements still hold and get no delta.
- **No delta for six main specs that hold** (R1 table): `point-visibility`, `stats-auto-clustering`, `imported-dataset-persistence`, `deprecation-policy`, `explore-loading-overlay`, `scatterplot-zoom-indicator`. `selection-workflow` says "Show only these isolates the selection (point-visibility)"; `legend-panel` points at "the cluster caveat (stats-auto-clustering)".
- **`e2e-validation` modifies two requirements**: `Browser compatibility coverage is explicit` (drops go through the shell's drop target to `#myDataLoader`, not the scatterplot) and `Heavyweight and live suites are explicit` (its scenario says `examples-live` writes the thumbnails; the docs image pipeline does now).
- **Ownership table** (one behaviour, one capability): layout regions, sidebar, rail, divider, docked/floating structure, layout persistence, drop target, empty state, where notifications appear → `explore-workbench-layout`; tokens, type, theme choice and first paint, what follows the theme, light exports, contrast gates → `explore-theming`; top layer, the Escape order, outside press, icon-button names, focus ring, reduced motion, Lucide, plural counts, disabled segmented options → `explore-ui-kit`; one scale for both axes, export fit, one render per panel change, kept centre, zoom insets → `plot-proportions` (the perf budget itself → `perf-checks`); rows, row actions, hidden state, header, sort, Other popover, settings popover and its storage key → `legend-panel` (shape size → `scatterplot-point-size`; the predicted mark → `annotation-presentation`); tool strip, selection bar, status chips including the filter chip's ✕, undo/redo, Undo notifications, the confirmation before clearing stored data, the structure's protein pick → `selection-workflow`; Import menu and dataset name, Export menu list and its contours note, export confirmations, figure editor dialog, loading overlay copy, the FASTA upload note → `explore-import-export` (example ordering and the stored import → `example-datasets`; TSV rows → `table-export`); help menu, shortcut list, tour → `explore-help`; breakpoints, More sheet and its dot, bottom panel, structure sheet, landscape, touch targets, phone dialogs, phone Ctrl/⌘K → `explore-mobile-layout`; draft, Cancel, disabled-Apply reason, live count, Reset with Undo → `query-builder-filtering`; Feedback placement and the notification close button → `support-contact`; notification actions → `prep-failure-routing`; the link row in every placement → `protein-resource-links`.
- **Modified capabilities: change only what is false** (R1 §1): each spec task reads the whole main spec; the headers listed per task are the expected set; any other requirement the code contradicts is added to the delta and named in the report.
- **Device-fix scope** (shape): 8.18 holds only what the user reports as broken; the four decided calls are not reopened; a fix that changes a captured docs scene recaptures that scene only.
- **Perf reference and A/B** (R2 §1): the 8A polish B column, two runs, A/B only on a suspect segment (Global Constraints). 8.29 reruns 573K if any commit since 8.15's HEAD (8.16, 8.18, 8.28's merge, or 8.29's own fixes) changed `packages/utils/src/visualization/`, `packages/core/src/components/scatter-plot/` or `packages/core/src/components/legend/` (the `git log <8.15 HEAD>..HEAD -- <the three paths>` output, together with 8.28's `Plot path touched:` line, decides); `perf:counts` always.
- **Stale lines** (R1 §2, R2 §1): `design.md:38` stays (it describes the branch as it was); `:406` becomes 34 ported tests; `:254`, `:309`, `:439`, `:467-468`, `:480`, `:511` (the open question, now answered: the user, in this phase) and the long line at `:350` are fixed; `proposal.md:40`, `:93-95`, `:142` and the Modified list (+ `table-export`, `structure-coloring`) are fixed; `tasks.md` 8B is rewritten by the plan commit and ticked by 8.24 and 8.30.
- **The PR text carries no capability list** (R1 §2 suggested one): the user asked for short and jargon-free; the specs speak for themselves at the archive.
- **`examples-live` is not run** (opt-in, network; thumbnails unchanged since 8A). The Firefox/WebKit compatibility projects run in CI; locally only if their browsers are installed (8.15 checks `~/Library/Caches/ms-playwright` before the first full run).
- **The perf rule needs both thresholds** (plan review): a segment is suspect only past 20 ms **and** 10 % of the reference busy time, or INP +16 ms; "or 10 %" made 2–3 ms of noise on the small segments start a 30-minute A/B.
- **TED reason on a phone** (plan review): `ps-segmented` shows a disabled option's reason on every press and hides it on the next press elsewhere (focusout); the checklist's P4 asks for that, not for a second tap on the same option to hide it.
- **Device tests carry a `device <id>:` title prefix** (plan review): `P1:`–`P10:` and `L1:`–`L4:` already prefix other `mobile-*` tests, so `-g "P2"` would run them too. A touch hold is sent with `helpers/mobile.ts` `touchDrag(page, point, dy, restMs)`; `dragLegendRow` is a mouse drag.
- **One evidence format, one checker** (plan review): `check-evidence.py` (8.20) looks up every ref before it looks for the spec file, accepts a further title of the same file as `; "<title>"`, trailing ` (<note>)` groups, `code:` refs and templated titles (`test.each` `%s`, `${…}`) cited as they run; 8.21–8.23, 8.25, 8.28 and 8.29 must run it. Both reviewers' proposals (nested-parenthesis notes; same-file continuation and templates) are merged into one regex; the split no longer needs a closing quote before `; `, so a `code:` ref can be followed by a file ref. 8.22's and 8.23's evidence lines were rewritten to the format (full requirement names as keys, no "same test", configs and listings as `code:`); all 29 sections pass the checker against `d071e1da`.
- **Stale-term greps over the specs skip three known kinds of line** (plan review): the RENAMED `- FROM:` lines (in the deltas), `query-builder-filtering`'s Purpose (8.30 rewrites it; an archive never touches a Purpose), `support-contact`'s site-header sentence (true for the landing and Privacy pages), and `explore-workbench-layout`'s lines saying /explore replaces the site header and other pages keep it (neither judge caught these; without the exclusion 8.23, 8.27 and 8.29 could never print nothing).
- **8.29 repeats 8.27's dry run and its `compare-requirements.py`** (plan review): its own raw-text classifier would flag every rewritten spec's last requirement (the archive changes blank lines); 8.29 formats the copy first and compares CHECK lines with 8.27's report. 8.29 stops before fixing when it finds more than one failure, so the fixes go out as separate briefs.
- **`query-builder-filtering`'s proposal line is replaced in any case** (plan review): `filterActive` left with the control bar; the plot's `filtersActive` and the Filter button's count report an applied filter.
- **8.25 also fixes a proposal line its spec change makes stale**, since 8.24 has already run.
- **The new specs' Purpose for `explore-workbench-layout`** says phones and tablets specialise it in `explore-mobile-layout`, because it also states what happens below 951 px.
- **The user's dev server reloads while agents rebuild packages** (plan review): the checklist tells the user a self-reload is not a finding, so block 2 does not have to wait for the device pass.

Plan shape:

- Sixteen tasks in four review blocks; 8.29 is dispatched as two briefs: Part A (Steps 1–12, local, ends "ready to push") and Part B (Steps 13–15, after the user-approved push). Block 1: 8.15 verification, 8.16 its fixes, 8.17 the device checklist (orchestrator, no agent), 8.18 device fixes; reviewed after 8.16 (if it changed code) and after 8.18. Block 2: 8.19 header check, 8.20–8.23 spec files; reviewed after 8.23 (8.19 is small, so the block is effectively four). Block 3: 8.24 reconcile, 8.25 spec recheck (after 8.18), 8.26 PR text, 8.27 dry-run archive. Block 4 (gated): 8.28 re-merge and retarget, 8.29 final run and CI, 8.30 archive; reviewed after 8.29, and 8.30's diff is shown to the user before the push.
- Execution order is the numbering, except that 8.18 runs when the user's notes arrive (after block 2's review if block 2 is still running), and 8.25 waits for 8.18.

## File structure

`.superpowers/sdd/phase-8b-wrapup/` (git-ignored; never committed)

- `progress.md` (orchestrator): the ledger (line forms under Global Constraints, Paths).
- `verification-report.md` (C 8.15; appended by 8.16 `## 8.16 fixes`, 8.28 `## 8.28 merge`, 8.29 `## Final run`): suite counts against the reference, failures, perf tables, the v3 bundle's size and heap.
- `screens/shoot.mjs` (C 8.15; R 8.29): `node .superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs <base-url> <prefix>`, eight screenshots into `screenshots/`. `screenshots/` (C 8.15 `p8b-verify-*.png`, 8.29 `p8b-final-*.png`).
- `device-checklist.md` (C 8.17): what the user checks on each device. `device-notes.md` (C 8.17, orchestrator): the user's results, verbatim, which 8.18's brief is filled from.
- `check-headers.sh` (C 8.19): the delta header and structure check. `check-headers.test.sh` (C 8.19): its fixture self-test.
- `spec-evidence.md` (C 8.20; M 8.21–8.23, 8.25 `## Recheck`, 8.28 `## Main drift`): scenario → test map per capability; WARN explanations. `check-evidence.py` (C 8.20; R 8.21–8.23, 8.25, 8.28, 8.29): the evidence-map checker.
- `check-pr-text.sh` (C 8.26; R 8.29): the PR-text check.
- `dry-run-report.md` (C 8.27; M 8.29 `## Final dry run`): the dry-run archive's results. `compare-requirements.py` (C 8.27; R 8.29, 8.30): the per-requirement archive comparison.

`openspec/changes/explore-workbench/specs/` (C, one `spec.md` per folder)

- 8.20: `explore-workbench-layout/`, `explore-theming/`, `explore-ui-kit/`, `plot-proportions/`.
- 8.21: `legend-panel/`, `selection-workflow/`, `explore-import-export/`, `explore-help/`, `table-export/`.
- 8.22: `explore-mobile-layout/`, `docs-media-generation/`, `category-focus/`, `density-contours/`, `scatterplot-point-size/`, `annotation-presentation/`, `support-contact/`, `protein-resource-links/`, `structure-coloring/`.
- 8.23: `query-builder-filtering/`, `query-builder-controls/`, `protein-search-feedback/`, `eat-annotation-overlay/`, `eat-reliability-filter/`, `eat-provenance-connectors/`, `example-datasets/`, `prep-failure-routing/`, `e2e-validation/`, `webgl-perf-harness/`, `perf-checks/`.
- Any of them (M 8.18, 8.25, 8.27, 8.28) when a fix, a recheck, the dry run or `main`'s drift changes what they must say.

`openspec/changes/explore-workbench/`

- `proposal.md` (M 8.24): stale lines; Modified list gains `table-export` and `structure-coloring`; capability lines match the written specs.
- `design.md` (M 8.24): stale lines in decisions 9, 13, 15, 17, 19, 21, Risks and Open Questions.
- `tasks.md` (M plan commit: 8B rewritten as 8.15–8.30; M 8.24 ticks done items; M 8.30 ticks the rest). The plan commit writes section 8's heading and its 8B block as below (8.24 and 8.30 match open items with `^- \[ \] (8\.\d+) ` and treat lines indented by six spaces as continuations):

  ```markdown
  ## 8. Wrap-up (plan for part A: `plans/phase-8a-cleanup.md`; part B: `plans/phase-8b-verify-specs-archive.md`)
  …
  8B. Verification, specs and archive:

  - [x] Merged with `main` through `perf/improvements`; main's Table (TSV) export ported into the
        Export menu
  - [ ] 8.15 Full verification on the merged tree
  - [ ] 8.16 Fixes for what the verification found
  - [ ] 8.17 The device checklist goes to the user
  - [ ] 8.18 Device fixes
  - [ ] 8.19 The header-check script and its self-test
  - [ ] 8.20 Spec files for the shell capabilities
  - [ ] 8.21 Spec files for the workflow capabilities and the table export
  - [ ] 8.22 Spec files for phones, docs media and the controls that moved
  - [ ] 8.23 Spec files for the behaviour changes; the whole change validated
  - [ ] 8.24 The proposal, design and task list match what shipped
  - [ ] 8.25 The specs rechecked against the commits after the spec block
  - [ ] 8.26 The PR description
  - [ ] 8.27 A dry-run archive
  - [ ] 8.28 After #526 merges: merge `main` again if it moved; the PR retargeted
  - [ ] 8.29 The final full run, the spec checks once more, CI green
  - [ ] 8.30 The archive, as the last commit
  ```
- Whole folder (R 8.30): moved to `openspec/changes/archive/<YYYY-MM-DD>-explore-workbench/` by `openspec archive`.

`openspec/specs/` (M 8.30 only): 19 modified `spec.md` merged; 10 new folders with written Purposes; `query-builder-filtering/spec.md` (and `annotation-presentation/spec.md` if needed) Purpose line.

`.superpowers/pr-description.md` (M 8.26; M 8.29 the "Builds on #526" line and, once the device pass is done, the Tests line): the PR body source.

Code, tests and docs: only what 8.16, 8.18 and 8.28 name from failing checks, the user's notes, or merge conflicts; unknown now.

Git: merge commit from `origin/main` (8.28, only if `main` moved); the archive commit (8.30). Remote: pushes and `gh pr edit` only by the orchestrator after the user's OK.

---

### Task 8.15: Full verification on the merged tree

Nothing has run in full since `main` came in (`dfc6def4`): only targeted suites and the nine conflicted e2e specs. This task runs every check once on HEAD, rebuilds the 573K v3 bundle, and writes one report; it changes no tracked file. Its counts are the phase baseline.

**Files:**

- Create: `.superpowers/sdd/phase-8b-wrapup/verification-report.md`
- Create (git-ignored, kept for Task 8.29): `.superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs` (the screenshot script), `.superpowers/sdd/phase-8b-wrapup/screenshots/p8b-verify-*.png`
- Create (scratch, untracked): `$SCRATCH/v3/573K_swissprot.parquetbundle`, `$SCRATCH/perf/*.json`, `$SCRATCH/logs/*.log`
- No tracked file changes. If a check fails, do not fix it: record it (8.16 fixes).

**Interfaces:**

- Consumes: HEAD (`d071e1da` or later); `perf/datasets/573K_swissprot.parquetbundle` (v1, 44.9 MB) and `perf/datasets/phosphatase.parquetbundle` (for `perf:counts`); `protspace convert IN OUT` (`docs/guide/python-cli.md` "`protspace convert`"); the reference counts and the 8A polish perf table (Global Constraints, Baseline); the CI list in R2 §1 (which workflows run on #555).
- Consumes (for the screenshots): the startup fixture `apps/web/tests/fixtures/demo_toxprot_7831.parquetbundle` (what `STARTUP_DATASET_URL` in `apps/web/tests/helpers/fixtures.ts` points the dev server at); the tour key `protspace:tour:v2` with value `full` and the theme key `protspace:theme` holding a JSON string (`apps/web/tests/helpers/tour-storage-state.ts` `exploreStorageState`); the Export trigger and list inside `#myExportMenu` (button and menu both named "Export", `helpers/explore.ts` `exportTrigger`/`exportList`); the More button (name starts "More view options", inside `[data-workbench="view-bar"]`), the More dialog (named "More") and its Export row (a button whose name starts "Export", inside `ps-dialog`) as `helpers/mobile.ts` and `mobile-bars.spec.ts` C4 find them; "Pop out structure" and `data-structure="floating"` (`helpers/workbench.ts` `floatStructure`); the plot's `dataToClient`/`pickInteractivePointAt` (as `clickProteinNearPlotCentre` uses them).
- Produces: `verification-report.md` with sections `## Commit` (HEAD SHA, date, load average), `## Suites` (table: suite, command, passed/failed/skipped, reference, delta, new or removed files), `## E2E` (full default run; `--project=mobile` three runs; `product-tour.spec.ts --repeat-each 5`; each failure with spec:line, title, error's first line, alone-rerun result), `## Python` (pytest count, ruff check, ruff format --check), `## Checks` (`pnpm lint`, `pnpm quality`, `pnpm format:check`, `pnpm test:contract`, `pnpm shared-constants:check`, `pnpm docs:annotations:check`, `pnpm docs:examples:check`, `pnpm docs:images:check`, `pnpm docs:build`, `pnpm precommit`: exit code each), `## Perf` (`perf:counts` per segment; the v3 file's size; two 573K runs as INP/LoAF/busy/restage per segment next to the reference, heap; A/B if the perf rule triggered), `## Failures for 8.16` (numbered F1…, each: check, reproduction command, first error, suspected area, whether it predates the merge if cheaply known via `git log -S` or a run at `46176145`). The `## Suites` counts are the phase baseline.
- Produces for 8.16: the numbered failure list. For 8.29: the exact command list (Steps 2–11 below), reused verbatim, and `screens/shoot.mjs <base-url> <prefix>` (writes `<prefix>-desktop-export-{light,dark}.png`, `<prefix>-phone-more-sheet-{light,dark}.png`, `<prefix>-phone-export-{light,dark}.png`, `<prefix>-tablet-light.png`, `<prefix>-floating-structure-light.png`).

**Tests (the run itself, in this order; sandbox disabled where Global Constraints say so):**

- Build: `pnpm --filter @protspace/utils build && pnpm --filter @protspace/core build`.
- Unit: utils, core (unit + browser, sandbox disabled), app (package-scoped, Global Constraints); `pnpm test:contract`.
- Python: `uv run --directory apps/protspace ruff check src/ packages/ tests/`, `uv run --directory apps/protspace ruff format --check src/ packages/ tests/`, `uv run --directory apps/protspace pytest -m "not slow" -q`.
- E2E: `PLAYWRIGHT_PORT=8475 pnpm test:e2e` (all default projects), then `PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=mobile` three times, then `PLAYWRIGHT_PORT=8475 pnpm test:e2e product-tour.spec.ts --repeat-each 5`. Failures rerun once alone; known flakes named as such only if they pass alone.
- Perf: `pnpm perf:counts`; rebuild the v3 bundle; check size; two 573K runs; the A/B only per the perf rule; move every JSON out of `perf/results/` to `$SCRATCH/perf/`.
- Checks: `pnpm lint`, `pnpm quality`, `pnpm shared-constants:check`, the four docs checks, `pnpm docs:build`, `pnpm format:check`, then `pnpm precommit` as one command.
- Screenshots (for the device pass and the user): desktop 1280×720 light and dark with the Export menu open showing "Table (.tsv)"; phone (Pixel 7 emulation) More sheet → Export menu; into `.superpowers/sdd/phase-8b-wrapup/screenshots/` (`p8b-verify-*.png`).
- `git status --short` is empty at the end (no tracked change; `perf/results/` empty).

Every command block below starts from the worktree and sets the two paths it uses; the Bash tool does not keep the working directory or variables between calls, so keep the first two lines of each block:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
```

Long runs (the full core suite, every e2e run, both perf runs, `pnpm precommit`) can pass the Bash tool's 10-minute limit: start them with the Bash tool's `run_in_background` and read the log when it reports the exit. Every run writes its full output to `$SCRATCH/logs/<name>.log` and prints only the exit code and the tail, so the transcript stays small. Never use ports 8080, 8091 or 8479.

- [ ] **Step 1: Record the commit and the machine state; create the folders**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
mkdir -p "$SCRATCH/logs" "$SCRATCH/perf" "$SCRATCH/v3" \
  .superpowers/sdd/phase-8b-wrapup/screens .superpowers/sdd/phase-8b-wrapup/screenshots
git rev-parse HEAD; git log -1 --format='%h %ci %s'
git status --short; ls perf/results
sysctl -n vm.loadavg
git merge-base --is-ancestor origin/main HEAD && echo "main 44af7d97+ in HEAD"
git merge-base --is-ancestor origin/perf/improvements HEAD && echo "perf/improvements in HEAD"
```

Expected: HEAD is `d071e1da` or a later commit of this branch; `git status --short` prints nothing; `perf/results` is empty (if it holds JSON from an earlier run, `mv perf/results/* "$SCRATCH/perf/"`); both ancestry lines print. If the status is not clean, stop and report BLOCKED with the output: a run on a dirty tree is not a baseline. Write the SHA, the date and the load average into the report's `## Commit` (Step 12 has the template).

- [ ] **Step 2: Build utils and core**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm --filter @protspace/utils build > "$SCRATCH/logs/build-utils.log" 2>&1; echo "utils build exit=$?"
pnpm --filter @protspace/core build > "$SCRATCH/logs/build-core.log" 2>&1; echo "core build exit=$?"
tail -3 "$SCRATCH/logs/build-core.log"
```

Expected: both exit 0 (core tests import the built utils; the app's tests import core's `dist`). A build failure is F1 in the report; the suites after it still run where they can.

- [ ] **Step 3: The unit and browser suites, and the contract tests**

Run utils and app inside the sandbox; core (its `browser` project starts a local server) and the contract tests (they run `uv run`) with the sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm --filter @protspace/utils exec vitest --run > "$SCRATCH/logs/utils.log" 2>&1; echo "utils exit=$?"
grep -E "Test Files|Tests  " "$SCRATCH/logs/utils.log"
pnpm --filter @protspace/app exec vitest --run > "$SCRATCH/logs/app.log" 2>&1; echo "app exit=$?"
grep -E "Test Files|Tests  " "$SCRATCH/logs/app.log"
```

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm --filter @protspace/core exec vitest --run > "$SCRATCH/logs/core.log" 2>&1; echo "core exit=$?"
grep -E "Test Files|Tests  |Unhandled|Errors" "$SCRATCH/logs/core.log"
pnpm test:contract > "$SCRATCH/logs/contract.log" 2>&1; echo "contract exit=$?"
grep -E "Test Files|Tests  " "$SCRATCH/logs/contract.log"
```

Expected (reference, not a gate): utils 514, core 3384, app 954 (after the merge, `8d5cee0f`); utils may be higher since `3fa20201` added a test, core since `01d70f28`/`d071e1da`. Every run exits 0, and core reports no "Unhandled Errors" block (vitest exits 1 on one even when every test passes, as the 8A exit found). For each suite, record passed/failed/skipped and the test-file count. For a difference from the reference, list the test files added or removed since `8d5cee0f`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git diff --name-status 8d5cee0f HEAD -- '*.test.ts' '*.browser.test.ts' | head -20
```

Any failing test: rerun its file alone (`pnpm --filter <pkg> exec vitest --run <file>`, core with `--project unit` or `--project browser`) and record both results as an Fn.

- [ ] **Step 4: Python lint, format and tests**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
uv run --directory apps/protspace ruff check src/ packages/ tests/ > "$SCRATCH/logs/ruff-check.log" 2>&1; echo "ruff check exit=$?"; tail -3 "$SCRATCH/logs/ruff-check.log"
uv run --directory apps/protspace ruff format --check src/ packages/ tests/ > "$SCRATCH/logs/ruff-format.log" 2>&1; echo "ruff format exit=$?"; tail -3 "$SCRATCH/logs/ruff-format.log"
uv run --directory apps/protspace pytest -m "not slow" -q > "$SCRATCH/logs/pytest.log" 2>&1; echo "pytest exit=$?"; tail -5 "$SCRATCH/logs/pytest.log"
```

Run with the sandbox disabled if `uv` needs to fill a cold cache. Expected: all three exit 0; pytest about 2027 passed (the count in `../protspace-rebase` after main's merge). `test_deprecations.py` and `test_docs_extras_sync.py` read web and docs paths this branch moved: a failure there is an Fn with the path it looked for.

- [ ] **Step 5: The full e2e run, then mobile three times, then the tour five times**

Sandbox disabled (each run starts its own server on 8475). Run them one after the other, never in parallel (they share the port). First check whether Firefox and WebKit are installed for Playwright:

```bash
ls ~/Library/Caches/ms-playwright | grep -E "^(firefox|webkit)-" || echo "no firefox/webkit: run with E2E_BROWSERS=chromium"
```

If it prints the fallback line, put `E2E_BROWSERS=chromium` in front of the full run below and record `url-view-state-firefox` and `url-view-state-webkit` as "CI only (browser not installed)".

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
PLAYWRIGHT_PORT=8475 pnpm test:e2e --reporter=line > "$SCRATCH/logs/e2e-full.log" 2>&1; echo "e2e full exit=$?"
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" "$SCRATCH/logs/e2e-full.log"
grep -E "^\s+[0-9]+\) \[" "$SCRATCH/logs/e2e-full.log" | head -30
grep -E "workbench-a11y" "$SCRATCH/logs/e2e-full.log" | head
```

If a Firefox or WebKit project still fails to launch with "Executable doesn't exist", rerun the full suite with `E2E_BROWSERS=chromium` in front, record the two projects as "CI only (browser not installed)", and do not count that as a failure (Rulings: the compatibility projects run in CI). `workbench-a11y.spec.ts` (axe on the main states in both themes, design decision 20) runs inside the `workbench` project; its result gets its own line in `## E2E`.

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
for i in 1 2 3; do
  PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=mobile --reporter=line > "$SCRATCH/logs/e2e-mobile-$i.log" 2>&1; echo "mobile run $i exit=$?"
  grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" "$SCRATCH/logs/e2e-mobile-$i.log"
done
PLAYWRIGHT_PORT=8475 pnpm test:e2e product-tour.spec.ts --repeat-each 5 --reporter=line > "$SCRATCH/logs/e2e-tour.log" 2>&1; echo "tour exit=$?"
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" "$SCRATCH/logs/e2e-tour.log"
```

Expected: every run exits 0. References (not gates): full run 476 at the 8A exit (main's tests came in since, so a higher count is expected; report the difference); `--project=mobile` about 90 per run (80-odd after main's pruning is possible: count with `pnpm exec playwright test -c apps/web/tests/playwright.config.ts --project=mobile --list | tail -1`); tour 21 per repeat, 105 in all.

For each failure: copy its `spec:line`, title and the first line of its error from the log into `## E2E`, then rerun it alone once (sandbox disabled):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec-file> -g "<test title>" --project <project> --reporter=line 2>&1 | tail -15
```

(`--project=mobile` with `=` for the mobile project.) A failure is a known flake only if it is on the Global Constraints list **and** passes alone; everything else becomes an Fn, including a test that fails in the full run and passes alone but is not on the list (record it as "passes alone, not a known flake").

- [ ] **Step 6: The work counts**

Sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm perf:counts > "$SCRATCH/logs/perf-counts.log" 2>&1; echo "perf:counts exit=$?"
tail -40 "$SCRATCH/logs/perf-counts.log"
git diff --stat apps/web/tests/perf/budgets.json
```

Expected: exit 0, every segment within its budget, `budgets.json` unchanged (no re-record: never set `PERF_UPDATE_BUDGETS`). Copy the per-segment counts table from the log into `## Perf`. A segment over budget is an Fn with the segment, the counter, the count and the budget.

- [ ] **Step 7: Rebuild the 573K v3 bundle and check it**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
V1="$PWD/perf/datasets/573K_swissprot.parquetbundle"
V3="$SCRATCH/v3/573K_swissprot.parquetbundle"
stat -f '%z %N' "$V1"
rm -f "$V3"
uv run --directory apps/protspace protspace convert "$V1" "$V3" > "$SCRATCH/logs/convert.log" 2>&1; echo "convert exit=$?"; tail -5 "$SCRATCH/logs/convert.log"
stat -f '%z %N' "$V3"
```

Both paths are absolute because `--directory` changes the working directory. Run with the sandbox disabled if `uv` needs network. Expected: the v1 file is 44,899,797 bytes; convert exits 0; the v3 file is about 36 MB (between 33 and 39 MB). If convert fails or the size is outside that range, stop and report BLOCKED with the log tail: a wrong file fakes a regression (Review Focus 5). `perf/datasets/573K_swissprot.parquetbundle` itself is never passed to `pnpm perf`.

- [ ] **Step 8: Two 573K timing runs**

Close other heavy work first (no e2e or build running). Sandbox disabled; each run builds the app and serves it on 8301:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
for i in 1 2; do
  sysctl -n vm.loadavg
  pnpm perf --datasets "$SCRATCH/v3/573K_swissprot.parquetbundle" --runs 4 > "$SCRATCH/logs/perf-573k-$i.log" 2>&1; echo "perf run $i exit=$?"
  grep -E "heap|^[a-z-]+ +[0-9-]" "$SCRATCH/logs/perf-573k-$i.log" | head -20
  mv perf/results/*.json "$SCRATCH/perf/" 2>/dev/null; ls perf/results
done
```

Expected: both exit 0; the header line names `573K_swissprot` and shows a heap of about 31 MB (28–34 MB; the v1 file shows about 219 MB: if you see that, the wrong file was measured, stop and report). `perf/results` is empty after each move.

Fill the `## Perf` table with, per segment, INP/LoAF/busy/restage for both runs next to the reference (the 8A polish B column, HEAD `46176145`):

| segment | reference INP/LoAF/busy/restage |
| --- | --- |
| import | 72/83/305/58 |
| annotation-switch | 40/56/75/39 |
| projection-switch | 48/76/154/38 |
| projection-switch-instant | 40/68/98/34 |
| legend-isolate | 56/0/33/0 |
| hover | -/0/90/0 |
| camera | 40/0/82/0 |
| resize | -/0/88/0 |
| panel-toggle | 56/0/56/0 |
| panel-expand | 56/0/81/0 |
| theme-switch | -/0/18/0 |
| search-select | 40/0/32/0 |

Apply the perf rule: a segment is **suspect** only when **both** runs show busy more than 20 ms above the reference **and** more than 10 % above it, or INP 16 ms or more above it (two 8 ms steps). Mark each suspect segment in the table. If none is suspect, write "no suspect segment" and skip Step 9.

- [ ] **Step 9: One interleaved A/B, only if Step 8 found a suspect segment**

Build `46176145` in a temporary worktree and HEAD here, serve both with `vite preview`, compare once, then remove the worktree. Sandbox disabled throughout (install, build, ports):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
git worktree add "$SCRATCH/wt-ref" 46176145 > "$SCRATCH/logs/ab-worktree.log" 2>&1; echo "worktree exit=$?"
pnpm --dir "$SCRATCH/wt-ref" install --frozen-lockfile > "$SCRATCH/logs/ab-install.log" 2>&1; echo "install exit=$?"
pnpm --dir "$SCRATCH/wt-ref" turbo run build --filter=@protspace/app > "$SCRATCH/logs/ab-build-ref.log" 2>&1; echo "ref build exit=$?"
pnpm turbo run build --filter=@protspace/app > "$SCRATCH/logs/ab-build-head.log" 2>&1; echo "head build exit=$?"
nohup pnpm --dir "$SCRATCH/wt-ref/apps/web" exec vite preview --port 8302 --strictPort > "$SCRATCH/logs/ab-preview-ref.log" 2>&1 &
nohup pnpm --dir apps/web exec vite preview --port 8303 --strictPort > "$SCRATCH/logs/ab-preview-head.log" 2>&1 &
```

Check both answer (`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8302/explore` and the same for 8303 print `200`; if not yet, check again after the previews log "Local:"), then:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
sysctl -n vm.loadavg
pnpm perf --url http://localhost:8302 --compare http://localhost:8303 --datasets "$SCRATCH/v3/573K_swissprot.parquetbundle" --runs 5 > "$SCRATCH/logs/perf-ab.log" 2>&1; echo "A/B exit=$?"
grep -E "heap|→" "$SCRATCH/logs/perf-ab.log" | head -20
mv perf/results/*.json "$SCRATCH/perf/" 2>/dev/null; rm -rf perf/results/*-pixels; ls perf/results
```

Stop the two previews you started, and only those: for each port, `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` gives the PID; check `ps -p <pid> -o command=` names `vite preview --port <port>`, then `kill <pid>`. Remove the worktree: `git worktree remove --force "$SCRATCH/wt-ref"` and confirm `git worktree list` no longer shows it.

Reading: A is `46176145`, B is HEAD. A suspect segment whose busy and restage ratios fall inside 0.9–1.1 is noise: write "noise (ratio x.xx)" and close it. A ratio outside that range is a real gap: record it as an Fn with both numbers, the ratio, and a note that the fix is a cheap diagnosis and a few-line change or a written note (user memory: no over-engineering for tens of ms).

- [ ] **Step 10: The repository checks, then the pre-commit chain as one command**

`perf/results/` must be empty first (Step 8 moved the JSON; `ls perf/results` prints nothing), or `format:check` fails on it. Sandbox disabled (the docs build and the hook chain need it):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
ls perf/results
for c in lint quality shared-constants:check docs:annotations:check docs:examples:check docs:images:check docs:build format:check; do
  pnpm "$c" > "$SCRATCH/logs/check-$c.log" 2>&1; echo "$c exit=$?"
done
pnpm precommit > "$SCRATCH/logs/check-precommit.log" 2>&1; echo "precommit exit=$?"; tail -5 "$SCRATCH/logs/check-precommit.log"
```

Expected: every line `exit=0`. `pnpm precommit` runs lint-staged first; with nothing staged it prints that there are no staged files and goes on. For a non-zero exit, put the first error line (`grep -m3 -iE "error|fail|✖" "$SCRATCH/logs/check-<name>.log"`) into an Fn. `pnpm test:contract`'s exit from Step 3 goes into this table too.

- [ ] **Step 11: Screenshots for the device pass**

Create `.superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs` (git-ignored; it resolves `@playwright/test` from the repo's `node_modules`; Task 8.29 reuses it):

```js
// One-off screenshots for the phase 8B device pass and final run. Git-ignored; never committed.
// Usage: node .superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs <base-url> <prefix>
// Needs an app server at <base-url> serving the e2e startup fixture (see the task's Step 11).
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [baseUrl, prefix] = process.argv.slice(2);
if (!baseUrl || !prefix) {
  console.error('usage: shoot.mjs <base-url> <prefix>');
  process.exit(2);
}
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, `${prefix}-${name}.png`);

async function waitForServer(url, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no server at ${url}`);
}

// The tour already seen and the theme chosen, before any page script runs (the keys and
// formats of apps/web/tests/helpers/tour-storage-state.ts).
async function openContext(browser, options, theme) {
  const context = await browser.newContext(options);
  await context.addInitScript((t) => {
    localStorage.setItem('protspace:tour:v2', 'full');
    localStorage.setItem('protspace:theme', JSON.stringify(t));
  }, theme);
  return context;
}

// The data is in the plot and the loading overlay is gone (helpers/explore.ts
// waitForExploreDataLoad).
async function openExplore(page) {
  await page.goto(`${baseUrl}/explore`);
  await page.waitForFunction(
    () => (document.querySelector('#myPlot')?.data?.protein_ids?.length ?? 0) > 0,
    undefined,
    { timeout: 60_000, polling: 100 },
  );
  await page.waitForFunction(() => !document.getElementById('progressive-loading'), undefined, {
    timeout: 60_000,
    polling: 100,
  });
  await page.waitForTimeout(500);
}

const exportList = (page) =>
  page.locator('#myExportMenu').getByRole('menu', { name: 'Export', exact: true });

async function desktopExport(browser, theme) {
  const context = await openContext(browser, { viewport: { width: 1280, height: 720 } }, theme);
  const page = await context.newPage();
  await openExplore(page);
  await page
    .locator('#myExportMenu')
    .getByRole('button', { name: 'Export', exact: true })
    .click();
  await exportList(page).getByRole('menuitem', { name: 'Table (.tsv)', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot(`desktop-export-${theme}`) });
  await context.close();
}

async function phoneExport(browser, theme) {
  const context = await openContext(browser, { ...devices['Pixel 7'] }, theme);
  const page = await context.newPage();
  await openExplore(page);
  await page
    .locator('[data-workbench="view-bar"]')
    .getByRole('button', { name: /^More view options/ })
    .tap();
  await page.getByRole('dialog', { name: 'More', exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(`phone-more-sheet-${theme}`) });
  await page
    .locator('ps-dialog')
    .filter({ has: page.getByRole('dialog', { name: 'More', exact: true }) })
    .getByRole('button', { name: /^Export/ })
    .tap();
  await exportList(page).getByRole('menuitem', { name: 'Table (.tsv)', exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot(`phone-export-${theme}`) });
  await context.close();
}

async function tablet(browser) {
  const context = await openContext(
    browser,
    { ...devices['Pixel 7'], viewport: { width: 800, height: 1280 } },
    'light',
  );
  const page = await context.newPage();
  await openExplore(page);
  await page.screenshot({ path: shot('tablet-light') });
  await context.close();
}

// Selects the protein nearest the plot's centre (helpers/workbench.ts
// clickProteinNearPlotCentre), then pops the structure out.
async function floatingStructure(browser) {
  const context = await openContext(browser, { viewport: { width: 1280, height: 720 } }, 'light');
  const page = await context.newPage();
  await openExplore(page);
  const target = await page.locator('#myPlot').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let best = null;
    for (let slot = 0; slot < element._plotData.length; slot++) {
      const at = element.dataToClient(element._plotData.xs[slot], element._plotData.ys[slot]);
      if (!at) continue;
      const distance = Math.hypot(at.x - cx, at.y - cy);
      if (best && distance >= best.distance) continue;
      if (element.pickInteractivePointAt(at.x - rect.left, at.y - rect.top)) {
        best = { x: at.x, y: at.y, distance };
      }
    }
    if (!best) throw new Error('No protein to click on the plot');
    return best;
  });
  await page.mouse.click(target.x, target.y);
  await page.getByRole('button', { name: 'Pop out structure' }).click();
  await page.locator('[data-structure="floating"]').waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: shot('floating-structure-light') });
  await context.close();
}

await waitForServer(`${baseUrl}/explore`);
const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    await desktopExport(browser, theme);
    await phoneExport(browser, theme);
  }
  await tablet(browser);
  await floatingStructure(browser);
} finally {
  await browser.close();
}
console.log(fs.readdirSync(OUT).filter((f) => f.startsWith(prefix)).join('\n'));
```

Start a dev server on 8476 with the e2e startup fixture, run the script, then stop the server. Sandbox disabled (the server binds a port; the structure fetch goes to the network):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
VITE_STARTUP_DATASET_URL="/@fs$PWD/apps/web/tests/fixtures/demo_toxprot_7831.parquetbundle" \
  nohup pnpm --dir apps/web exec vite --port 8476 --strictPort > "$SCRATCH/logs/shots-server.log" 2>&1 &
node .superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs http://localhost:8476 p8b-verify > "$SCRATCH/logs/shots.log" 2>&1; echo "shots exit=$?"; tail -10 "$SCRATCH/logs/shots.log"
PID=$(lsof -nP -iTCP:8476 -sTCP:LISTEN -t); ps -p "$PID" -o command=
```

If the `ps` line is this worktree's `vite --port 8476 --strictPort`, `kill "$PID"`; never kill anything else. Expected: `shots exit=0` and eight files `p8b-verify-desktop-export-{light,dark}.png`, `p8b-verify-phone-more-sheet-{light,dark}.png`, `p8b-verify-phone-export-{light,dark}.png`, `p8b-verify-tablet-light.png`, `p8b-verify-floating-structure-light.png`. Open each with the Read tool and check: the Export menu lists "Table (.tsv)"; the dark images are dark; the phone Export menu sits inside the screen. If the floating card shows the viewer's own "WebGL does not seem to be available", that is headless Chromium (8A block 3 review), not a finding. A shot that fails or shows something wrong (e.g. the menu clipped, the sheet's Export row missing) is an Fn.

- [ ] **Step 12: Write the report and leave the tree clean**

Write `.superpowers/sdd/phase-8b-wrapup/verification-report.md` with the measured values (every `…` below is a value you measured, not text to keep):

```markdown
# Phase 8B verification

## Commit

HEAD … (date …), load average at start …, before perf run 1 …, before perf run 2 ….
Logs: `$SCRATCH/logs/` (session scratchpad, cleaned between sessions).

## Suites

| suite | command | passed / failed / skipped | files | reference | delta | new or removed test files |
| --- | --- | --- | --- | --- | --- | --- |
| utils | `pnpm --filter @protspace/utils exec vitest --run` | … | … | 514 | … | … |
| core (unit + browser) | `pnpm --filter @protspace/core exec vitest --run` | … | … | 3384 | … | … |
| app | `pnpm --filter @protspace/app exec vitest --run` | … | … | 954 | … | … |
| contract | `pnpm test:contract` | … | … | not run before | … | … |

These counts are the phase 8B baseline.

## E2E

| run | passed / failed / flaky / skipped | reference |
| --- | --- | --- |
| full, default projects | … | 476 (8A exit) |
| `--project=mobile` run 1 / 2 / 3 | … / … / … | 90 (8A exit) |
| `product-tour.spec.ts --repeat-each 5` | … | 105 |

Accessibility: `workbench-a11y.spec.ts` … passed / … failed (both themes, decision 20).

Failures: `spec:line` — title — first error line — alone rerun: pass/fail — known flake: yes/no.

## Python

pytest … passed (reference 2027); ruff check exit …; ruff format --check exit ….

## Checks

| check | exit |
| --- | --- |
| `pnpm lint` | … |
| … every check of Step 10, and `pnpm test:contract` … | … |

## Perf

perf:counts: exit …; table of segments and counts; budgets.json unchanged: yes/no.
v3 bundle: … bytes (v1 44,899,797); heap run 1 … MB, run 2 … MB.

| segment | reference | run 1 | run 2 | suspect |
| --- | --- | --- | --- | --- |
| import | 72/83/305/58 | … | … | … |
| … the twelve segments of Step 8 … | | | | |

A/B: not triggered | per segment A→B and ratio, verdict.

## Screenshots

`screenshots/p8b-verify-*.png`: the eight files, one line each on what it shows.

## Failures for 8.16

F1. Check: … Reproduce: `…` First error: … Suspected area: … Predates the merge: yes (how) / no / unknown.
(Or: "None.")
```

To fill "predates the merge" cheaply: `git log -S'<a distinctive string from the error>' --oneline -3` names the commit that brought the code; a commit not reachable from `46176145` (`git merge-base --is-ancestor <sha> 46176145` fails) came with the merge. Do not run suites at `46176145` for this; write "unknown" instead.

Then:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git status --short; ls perf/results; git worktree list
```

Expected: `git status --short` prints nothing; `perf/results` is empty; `git worktree list` shows no `wt-ref`.

**Commit:** none (report only).

Report: status, the `## Suites` and `## E2E` counts, the Fn list (or "none"), the perf verdict, and the eight screenshot paths for the orchestrator to send with the device checklist.

### Task 8.16: Fixes for what the verification found (placeholder)

The orchestrator fills this task's brief from `verification-report.md` § "Failures for 8.16"; if that section is empty, the task is skipped and recorded as "nothing to fix". Each failure becomes one fix with its own failing test first; fixes that touch different areas may be split into 8.16a/8.16b briefs run one after the other.

**Files:** unknown until 8.15 reports; each brief names them. Limits: no file outside the failure's area; no `.github/workflows/*`; no `openspec/` file (specs are not written yet); docs images only when a fix changes a captured scene (recapture that scene with its own command, then `pnpm docs:images:check`).

**Interfaces:**

- Consumes: `verification-report.md` (failure Fn: reproduction command, first error); Global Constraints (all of them bind a fix); the perf rule for a perf finding.
- Produces: per failure, a commit whose test failed before the fix and passes after; the report appends `## 8.16 fixes` to `verification-report.md` (Fn → commit SHA, test name, before/after counts of the files run, "Unrun at task time" specs).

**Tests:**

- For each Fn: the reproduction command fails before the fix and passes after; the touched files' unit/browser tests; at most one e2e spec (the failing one).
- A failure that predates the merge and is not user-facing may be recorded instead of fixed, with the orchestrator's ruling in the ledger.

**Brief (the orchestrator fills these lines before dispatch; everything below them is the fixer contract every 8.16 brief carries unchanged):**

- Failures in this brief: `F… — <check> — <first error>` (copied from `## Failures for 8.16`).
- Files the brief allows: `<paths>`.
- Orchestrator rulings for this brief (e.g. "F3 predates the merge and is not user-facing: record, do not fix"): `<lines or none>`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`, and each command block starts with `cd /Users/heispv/Documents/protspace_web/protspace-workbench` (the Bash tool does not keep the working directory). Scratch files go under `SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b`.

Steps 1–6 repeat once per failure, in the order the brief lists them; Step 7 runs once at the end.

- [ ] **Step 1: Reproduce the failure exactly as reported**

Run the failure's reproduction command from `verification-report.md` (sandbox disabled for e2e, core browser tests, perf, `uv run` on a cold cache and the docs build). Expected: it fails with the reported first error. If it passes now, rerun it once more; if it passes twice, write "Fn: does not reproduce at <HEAD sha> (two runs)" in `## 8.16 fixes`, change nothing, and go to the next failure. If it fails with a different error, stop and report the new error (the brief was written for the old one).

Find the cause before writing any code: read the code at the first error's frame and `git log --oneline -5 -- <that file>`; for a failure that came with the merge, `git show <sha> -- <file>` of the commit that changed it on `main`'s side. Write the cause in one or two sentences in your notes; the fix and its test follow from it.

- [ ] **Step 2: Write the failing test**

Pick the test by the failure's kind:

- **A unit, browser or contract test failed:** that test is the failing test. Change it only if the cause is the test (a stale expectation after the merge); then the fix is the test change and the commit type is `test(<scope>)`. Never loosen an assertion to make it pass: a changed expectation must name the new behaviour the code now has on purpose, with the commit that made it so in a one-line comment.
- **An e2e test failed:** that test is the failing test. If the cause is in app or core code that has unit or browser tests, also add a unit or browser test there that fails for the same cause (it fails faster and pins the cause where it lives).
- **A check failed (lint, knip, type-check, format, docs checks, shared-constants, ruff):** the check is the failing test. No new test unless the cause is behaviour (e.g. a docs check that found a removed UI name the guide still uses: the fix is the text, the check is the test).
- **A Python test failed:** that pytest test is the failing test (`uv run --directory apps/protspace pytest <path>::<test> -q`).
- **A perf count over budget:** the `perf:counts` segment is the failing test; if the cause is a render or rebuild the code should skip, also add a unit test in the file that pins the skip rule (as `scatter-plot.render-coalescing.test.ts` does for hover). Never re-record budgets to make it pass.
- **A perf timing gap that survived the A/B (Task 8.15 Step 9):** no test first. One cheap diagnosis (a `--trace` run of the one segment: `pnpm perf --datasets "$SCRATCH/v3/573K_swissprot.parquetbundle" --scenarios <scenario> --runs 3 --trace`, sandbox disabled, where `<scenario>` is the segment's name or its prefix ending at a `-`, as `repeatableSegments` in `apps/web/tests/helpers/perf/scenarios.ts` matches it: e.g. `panel` runs `panel-toggle` and `panel-expand`, `theme` runs `theme-switch`, `hover` runs `hover`; an unknown prefix fails listing the valid ones, and `import` is measured only in a full run and cannot be selected; the traces land in `perf/results/<stamp>-traces/`: move them to `$SCRATCH/perf/` afterwards), then either a fix of a few lines with one interleaved A/B of that scenario showing a busy ratio inside 0.9–1.1 (`46176145` from a temporary `git worktree add "$SCRATCH/wt-ref" 46176145` with `pnpm --dir "$SCRATCH/wt-ref" install --frozen-lockfile` and `pnpm --dir "$SCRATCH/wt-ref" turbo run build --filter=@protspace/app`, HEAD from `pnpm turbo run build --filter=@protspace/app`; served by `pnpm --dir <app dir> exec vite preview --port 8302|8303 --strictPort`; `pnpm perf --url http://localhost:8302 --compare http://localhost:8303 --datasets "$SCRATCH/v3/573K_swissprot.parquetbundle" --scenarios <scenario> --runs 5`; stop both previews by their PIDs and `git worktree remove --force "$SCRATCH/wt-ref"` afterwards), or a written note in `## 8.16 fixes` (cause, size, why no fix) for the orchestrator. Do not restructure code for a gap of tens of ms. If `$SCRATCH/v3/573K_swissprot.parquetbundle` is gone (the scratchpad is cleaned between sessions), rebuild it first: `mkdir -p "$SCRATCH/v3" && uv run --directory apps/protspace protspace convert "$PWD/perf/datasets/573K_swissprot.parquetbundle" "$SCRATCH/v3/573K_swissprot.parquetbundle"` (absolute paths; about 36 MB; never time the 44.9 MB v1 file).

Write the new test with complete code in the file that owns the behaviour, next to its closest existing test, with a name that states the behaviour ("the Table export is offered in the phone More sheet's Export menu"), not the bug.

- [ ] **Step 3: Run the test and see it fail for the cause**

Run only that test: `pnpm --filter @protspace/utils exec vitest --run <file> -t "<name>"`, `pnpm --filter @protspace/core exec vitest --run --project unit <file> -t "<name>"` (or `--project browser`, sandbox disabled), `pnpm --filter @protspace/app exec vitest --run <file> -t "<name>"`, or `PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec> -g "<title>" --project workbench` (`--project=mobile` for a `mobile-*` spec; sandbox disabled). If the test is in core and the code under test is in utils, run `pnpm --filter @protspace/utils build` first; if it is in the app and the code is in core, `pnpm --filter @protspace/core build` first.

Expected: FAIL with an error that shows the cause from Step 1 (write the expected message in the report). A test that passes here does not test the failure: rewrite it.

- [ ] **Step 4: Apply the smallest fix**

Edit only the files the brief allows. The fix follows every Global Constraint (tokens only in core styles; one plot resize per layout change; no new export without a consumer in the same commit; helpers reach controls by role, name or tag; the ids and `data-driver-id` values stay). A fix that changes what a captured docs scene shows recaptures that scene only, on its own server (sandbox disabled): `pnpm docs:screenshots -g "<file name>"` or `pnpm docs:animations -g "<name>.gif" && pnpm docs:gifs <name>`, light and dark twins together; then `pnpm docs:images:check`. Never recapture for the decimal comma.

- [ ] **Step 5: Run the test, the touched files' tests and the reproduction again**

Run the Step 3 command: PASS. Then every test file of the files you changed (package-scoped commands of Step 3, whole files, no `-t`), after the builds Step 3 names. Then the Fn reproduction command from `verification-report.md`: it passes. Record each file's test count before and after.

At most one e2e spec in this task per failure: the failing one. List under "Unrun at task time" every other e2e spec the change could reach (`grep -rln "<changed helper, element id or label>" apps/web/tests/*.spec.ts`), and `pnpm perf:counts` if the change touches `packages/core/src/components/scatter-plot/`, `packages/core/src/components/legend/` or `packages/utils/src/visualization/`. Task 8.29 runs that list first.

- [ ] **Step 6: Commit the fix**

Run `pnpm exec prettier --check <every changed file>` (fix with `--write` if needed). Stage by path, never `git add -A`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git add <each changed file by path>
git commit -m "fix(<scope>): <what the user sees now>"
```

(`test(<scope>): …` when the cause was the test; scopes as in `git log`: `web`, `core`, `utils`, `docs`, `protspace`, `perf`.) A commit touching `apps/protspace/` takes `fix:`/`feat:` only for a change package users see; a stale test or path there takes `test(protspace):` or `chore(protspace):` (AGENTS.md: semantic-release counts every `fix:` under `apps/protspace/` as a release). Subject under 72 characters, one or two lines, no `Co-Authored-By` or Claude trailer. Run the commit with the sandbox disabled (the hook runs `pnpm precommit`); never `--no-verify`, never amend. If the hook fails, fix the cause and commit again. Example: `fix(web): keep the Table export in the phone More sheet`.

- [ ] **Step 7: Append the record and leave the tree clean**

Append to `.superpowers/sdd/phase-8b-wrapup/verification-report.md`:

```markdown
## 8.16 fixes

| Fn | cause (one line) | commit | test (file: "name") | files run: before → after | unrun at task time |
| --- | --- | --- | --- | --- | --- |
| F1 | … | <sha> | … | … | … |

Recorded, not fixed (orchestrator's ruling): Fn — why.
Did not reproduce: Fn — two runs at <sha>.
```

Then `git status --short` prints nothing (the report is git-ignored).

**Commit:** one per fix, `fix(<scope>): <what the user sees now>` or `test(<scope>): …` for a test-only cause (e.g. `fix(web): keep the Table export in the phone More sheet`).

Report: status (DONE, DONE_WITH_CONCERNS or BLOCKED), the commits, one line per Fn (fixed / recorded / did not reproduce), the unrun list, concerns.

### Task 8.17: The device checklist goes to the user (orchestrator, no agent)

The user checks the app by hand on an iPhone (Safari), an Android phone (Chrome), a tablet, and desktop Chrome, Safari and Firefox. The orchestrator writes `device-checklist.md` from the text below, sends it to the user with 8.15's screenshots, and records their answers verbatim in `device-notes.md`. Block 2 starts at once; nothing waits on the answers except 8.18 and 8.25.

**Files:**

- Create: `.superpowers/sdd/phase-8b-wrapup/device-checklist.md`, `.superpowers/sdd/phase-8b-wrapup/device-notes.md`.

**Interfaces:**

- Consumes: HEAD after 8.16; the user's own dev server (`pnpm dev` from this worktree serves port 8080 on all interfaces: `http://<mac-ip>:8080/explore` from a phone on the same network; plain http over the LAN is not a secure context, so "Last file" and the recovery banner are off there; Android Chrome through `chrome://inspect` port forwarding to `localhost:8080` keeps them).
- Produces: the checklist, each item with an id the notes refer to:
  - Phone, upright (each in light and dark): P1 the product tour's "Interactive Scatterplot" step does not hide the legend rows it talks about; P2 hold a legend row's handle (about ¼ s), then drag it fast across several rows: it lands where dropped; P3 More → Export → Table (.tsv): the file downloads and opens (iPhone: also Quick PNG); P4 tap a point, open its 3D structure, and while "TED domains" is greyed out, tap it: a short reason appears; tap anywhere else: it goes away; P5 the segmented controls (structure colours, More sheet rows): the selected ring and the track border look clean; P6 tap a point near the bottom edge: the card is fully visible, not under the selection bar; P7 the structure sheet does not cover Copy IDs or Clear.
  - Phone, sideways (≤500 px tall): L1 the page scrolls once past the bars to the plot and legend; the eye-only legend hides and shows categories.
  - Tablet: T1 the panel under the plot (Legend and Filter tabs, structure beside the legend); T2 Export menu with Table (.tsv).
  - Desktop (Chrome, Safari, Firefox): D1 sidebar fold, unfold and edge drag; D2 structure docked and floating, the floating card's default leaves Copy IDs and Clear clickable; D3 Export → Table (.tsv), Quick PNG, Quick PDF, Protein IDs, Data bundle; in Safari, wait about 30 s at the save prompt before saving: the download still completes; D4 Theme: System, Light, Dark, and System follows the OS switch live; D5 Ctrl/⌘K opens search, Escape closes layers one at a time.
  - Decided, do not report: the phone legend's row order, the landscape eye-only legend, the compact touch card showing one annotation, the theme button reading "Theme", the decimal comma in the figure editor's docs images.
  - Reply format: item id, device and browser, pass or what happened (a screenshot helps).
- Produces for 8.18: `device-notes.md` (the user's words, then the orchestrator's list of failing ids, each with the device).

**Tests:** none (manual). The orchestrator confirms every item has an answer before filling 8.18; an unanswered item is asked once more, not assumed to pass.

The orchestrator does these steps itself; no agent is dispatched. Never start, stop or restart the user's dev server on 8080 (or anything on 8091 or 8479): the user runs `pnpm dev` themselves.

- [ ] **Step 1: Look up the Mac's address on the local network**

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

Expected: one IPv4 address such as `192.168.1.23`. If both print nothing (no Wi-Fi or Ethernet address), leave `<mac-ip>` in the checklist and tell the user to read it from System Settings → Network.

- [ ] **Step 2: Write the checklist**

Write `.superpowers/sdd/phase-8b-wrapup/device-checklist.md` with this text, replacing `<mac-ip>` with Step 1's address and `<HEAD>` with `git rev-parse --short HEAD`:

```markdown
# Device check for the new explore page

Version: `<HEAD>` on `feat/explore-workbench`.

## Before you start

1. In this worktree run `pnpm dev` (it serves the app on port 8080 to your network).
2. On a phone or tablet on the same Wi-Fi, open `http://<mac-ip>:8080/explore`.
   Over plain http from another device, "Last file" in the Import menu and the "restore your last
   file" banner are switched off by the browser; that is expected. On Android you can keep them:
   connect the phone by USB, open `chrome://inspect` on the Mac, forward port 8080, and open
   `http://localhost:8080/explore` on the phone.
3. On the Mac, open `http://localhost:8080/explore` in Chrome, Safari and Firefox.
4. Do each phone item once in light and once in dark (the Theme row in the More sheet).
5. While you test, agents rebuild the app's packages for their own test runs. If the page reloads
   by itself, start the item again; that reload is not something to report.

## Phone, upright (iPhone Safari and Android Chrome)

- **P1** Start the tour (More → Help & shortcuts → Take the tour). On the "Interactive Scatterplot" step, the tour's
  box does not hide the legend rows it talks about.
- **P2** In the legend, hold a row's drag handle (the grip next to its count) for about a quarter of a second,
  then drag it quickly across several rows. It lands where you let go.
- **P3** More → Export → Table (.tsv): the file downloads and opens. On the iPhone also try
  Quick PNG.
- **P4** Tap a point, open its 3D structure, and while "TED domains" is greyed out, tap it: a short
  reason appears; tap anywhere else: it goes away.
- **P5** Look at the segmented controls (the structure's colour choice, the rows in the More
  sheet): the ring around the selected option and the border of the track look clean, with no
  doubled or clipped edge.
- **P6** Tap a point close to the bottom edge of the plot: its card is fully visible and not
  under the selection bar.
- **P7** With proteins selected and the structure sheet open, Copy IDs and Clear are not covered.

## Phone, sideways

- **L1** Turn the phone sideways. The page scrolls once past the top bars to the plot and the
  legend. The legend shows only the eye buttons, and they hide and show categories.

## Tablet

- **T1** The panel sits under the plot with Legend and Filter tabs, and the structure sits beside
  the legend.
- **T2** The Export menu lists Table (.tsv).

## Desktop: Chrome, Safari and Firefox

- **D1** Fold the sidebar, unfold it, and drag its left edge to resize it.
- **D2** Open a structure docked, then pop it out (floating). Where the floating card first
  appears, Copy IDs and Clear in the selection bar can still be clicked.
- **D3** Export → Table (.tsv), Quick PNG, Quick PDF, Protein IDs and Data bundle each download.
  In Safari, wait about 30 seconds at the save prompt before you save: the download still
  completes.
- **D4** Theme: System, Light and Dark work, and with System chosen, switching the Mac between
  light and dark changes the page right away.
- **D5** Ctrl+K (⌘K on the Mac) opens search; with several things open, Escape closes them one at
  a time.

## Already decided: no need to report

- The order of the legend rows on a phone.
- The sideways legend showing only the eye buttons.
- The small touch card showing one annotation.
- The theme button reading "Theme".
- The decimal comma in the figure editor's docs pictures.

## How to reply

One line per item: item id, device and browser, then "pass" or what happened. A screenshot helps.
For example: `P2, iPhone 15 Safari, the row jumped back to its old place after a fast drag`.
```

- [ ] **Step 3: Send it to the user with 8.15's screenshots**

Send `device-checklist.md` and the eight `p8b-verify-*.png` files from `.superpowers/sdd/phase-8b-wrapup/screenshots/` (`SendUserFile`, `status: "normal"`), with one line: block 2 (the spec files) starts now and does not wait for the answers; fixes for anything that fails come after.

- [ ] **Step 4: Record the answers verbatim**

Create `.superpowers/sdd/phase-8b-wrapup/device-notes.md` when the first answer arrives:

```markdown
# Device notes

## The user's answers (verbatim)

<date> — <the user's message, unedited, with any screenshot paths>

## Status per item

| item | iPhone Safari | Android Chrome | tablet | Chrome | Safari | Firefox |
| --- | --- | --- | --- | --- | --- | --- |
| P1 … P7, L1 | … | … | n/a | n/a | n/a | n/a |
| T1, T2 | n/a | n/a | … | n/a | n/a | n/a |
| D1 … D5 | n/a | n/a | n/a | … | … | … |

(each cell: pass, fail, or "no answer")

## Failing items for 8.18

- <id> — <device and browser> — <what happened, in the user's words>
```

Append each later answer under "The user's answers" with its date. Copy the user's words as written; the status table and the failing list are the orchestrator's reading of them. A report about one of the decided items goes under "Decided, not reopened" with a one-line reply to the user, not into the failing list (Rulings: the four calls stay).

- [ ] **Step 5: Ask once for anything unanswered**

When the user says they are done, every cell that should have an answer and has "no answer" is asked about once, in one message listing the item ids and devices. An item still unanswered after that is recorded as "not checked" (not as a pass) and named in the PR text's Tests line decision (Task 8.26 claims the device pass only if every item passed). Then fill Task 8.18's brief from "Failing items for 8.18", or record "8.18: nothing failed, skipped" in the ledger.

**Commit:** none.

### Task 8.18: Device fixes (placeholder)

The orchestrator fills this brief from `device-notes.md` (failing items only). Each failing item becomes one fix with a test that fails first, in the `mobile` project when the behaviour can be emulated, otherwise a unit or browser test of the code path the device exposed. If nothing failed, the task is skipped and recorded. It runs after block 2's review when block 2 is still running.

**Files:** unknown until the notes; each brief names them. If a fix changes behaviour a spec delta states (block 2 written), the same commit edits that delta and reruns the spec checks. A fix that changes a captured docs scene recaptures that scene only.

**Interfaces:**

- Consumes: `device-notes.md` (item id, device, what happened); the item's area (P1 `apps/web/src/tour/tour-steps.ts` / `product-tour.ts`; P2 legend drag in `packages/core/src/components/legend/` and `helpers/mobile.ts` `touchDrag(page, point, dy, restMs)`; P3/T2/D3 `export-menu.ts`, `apps/web/src/explore/export-handler.ts`, `packages/utils` download helper (Blob URL kept 60 s, `3fa20201`); P4/P5 `kit/segmented.ts`, `kit/choice.styles.ts`, `structure-viewer.ts`; P6 `touch-tooltip-insets.ts`; P7/D2 `layout-defaults.ts` `FLOATING_CARD`, `SELECTION_BAR`, `layout-geometry.ts`; L1 `workbench.css` landscape rules, `phone-dim.ts`); the spec-check commands (Global Constraints) when a delta changes.
- Produces: per item, a commit; `## 8.18 fixes` appended to `device-notes.md` (item → commit, test, which spec delta changed, "Unrun at task time" specs); the list of items to recheck on the device, which the orchestrator sends to the user.

**Tests:** per item, the new test fails before and passes after; the touched files' tests; at most one e2e spec; spec checks if a delta changed.

**Brief (the orchestrator fills these lines before dispatch; everything below them is the contract every 8.18 brief carries unchanged):**

- Failing items: `<id> — <device and browser> — <the user's words>` (copied from `device-notes.md` § "Failing items for 8.18"), with any screenshot paths.
- Files the brief allows: `<paths>` (start from the item's area in Interfaces).
- Block 2 state: `<"spec deltas written up to Task 8.2x" or "no deltas yet">`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`; each command block starts with `cd /Users/heispv/Documents/protspace_web/protspace-workbench` (the Bash tool does not keep the working directory). Never touch the user's servers on 8080, 8091 or 8479; e2e uses `PLAYWRIGHT_PORT=8475`.

Where the code lives, for the items the checklist named (read the item's files before anything else):

| item | code | closest existing tests |
| --- | --- | --- |
| P1 tour step over the legend | `apps/web/src/tour/tour-steps.ts`, `product-tour.ts`, `product-tour.css` | `tour-steps.test.ts`, `product-tour.test.ts`, `product-tour.spec.ts` |
| P2 hold-then-drag a legend row | `packages/core/src/components/legend/` (reorder controller, `legend-row.ts`) | `legend.*.test.ts`, `mobile-legend.spec.ts` G2/G3 with `helpers/mobile.ts` `touchDrag(page, point, dy, restMs)` (a CDP touch: down, rest `restMs` ≥ 250, ten moves one frame apart, up); `helpers/legend.ts` `dragLegendRow` is a mouse drag and cannot send a touch hold |
| P3, T2, D3 exports and downloads | `packages/core/src/components/export-menu/export-menu.ts`, `apps/web/src/explore/export-handler.ts`, `packages/utils/src/visualization/export-utils.ts` (`DOWNLOAD_URL_TTL_MS = 60_000`) | `export-menu.browser.test.ts`, `export-handler.test.ts`, `export-utils.test.ts`, `mobile-bars.spec.ts` (C4: Export in the More sheet) |
| P4, P5 segmented options and the TED reason | `packages/core/src/components/kit/segmented.ts`, `kit/choice.styles.ts`, `structure-viewer.ts` (`_tedButtonTitle`, `_colorOptions`) | `kit/fields.browser.test.ts`, `structure-viewer.browser.test.ts`, `structure-viewer.coloring.test.ts`, `mobile-plot-touch.spec.ts` (P9) |
| P6 card at the bottom edge | `apps/web/src/explore/touch-tooltip-insets.ts` | `touch-tooltip-insets.test.ts`, `mobile-plot-touch.spec.ts` |
| P7, D2 structure over the selection bar | `apps/web/src/explore/layout-defaults.ts` (`FLOATING_CARD`, `SELECTION_BAR`), `apps/web/src/workbench/layout-geometry.ts` | `layout-geometry.test.ts`, `layout-defaults.test.ts`, `workbench-structure.spec.ts`, `mobile-plot-touch.spec.ts` |
| L1 landscape scroll and eye-only legend | `apps/web/src/workbench/workbench.css` (landscape rules), `apps/web/src/explore/phone-dim.ts` | `phone-dim.test.ts`, `mobile-explore-layout.spec.ts` |
| D1, D4, D5 sidebar, theme, search and Escape | `apps/web/src/workbench/` (`Sidebar.tsx`, `use-sidebar-transition.ts`, `AppBar.tsx`), `apps/web/src/explore/theme-state.ts`, `kit/layers.ts` | `workbench-sidebar.spec.ts`, `workbench-theme.spec.ts`, `workbench-escape.spec.ts`, `layers.test.ts` |

Steps 1–6 repeat once per failing item, in the brief's order; Step 7 runs once at the end. The four decided calls (phone legend row order, landscape eye-only legend, compact touch card, the "Theme" label) are never reopened here, even if a note touches them: report such a note back instead.

- [ ] **Step 1: Find the cause from the note and the code**

Read the user's words and screenshot, then the item's code. Decide which of these the failure is, and write it in one or two sentences:

- **Emulatable**: layout, sizes, overlap, focus, a touch sequence the e2e can send (`page.touchscreen`, `helpers/mobile.ts` `touchDrag` with `restMs` ≥ 250, `touchGesture`, `tap`), anything the Pixel 7 project or a resized page reproduces.
- **Device-only**: a browser behaviour Chromium does not have (Safari's download after a slow save prompt, iOS rubber-band scroll, a real long-press menu). The test then pins the code path the device exposed (e.g. the Blob URL is still valid 30 s after the click; `touch-action` or `user-select` on the handle; the event the code listens to).

If the cause cannot be found from the note (e.g. "it felt wrong" with no screenshot), stop for that item and report the question the orchestrator should ask the user; go on with the next item.

- [ ] **Step 2: Write the failing test**

- **Emulatable:** a new test in the `mobile-*` spec that owns the area (table above), using the shared helpers by role, name or tag (Global Constraints: no hand-written selectors, no `shadowRoot` inside `page.evaluate`), titled `device <item id>: <behaviour>`, e.g. `test('device P2: a fast drag after the hold lands the row where it is dropped', …)` (plain `P1:`–`P10:` and `L1:`–`L4:` are already other tests' title prefixes in the `mobile-*` specs, so `-g "P2"` would also run them). Tablet and landscape cases resize the page inside the `mobile` project (`test.use({ viewport: { width: 800, height: 1280 } })`, `{ width: 844, height: 390 }`), as `mobile-explore-layout.spec.ts` does. Desktop-only items (D1–D5) go in the matching `workbench-*.spec.ts`. When the cause sits in a unit-tested module (geometry, insets, a controller), add the unit or browser test there too.
- **Device-only:** a unit or browser test of the exposed path in the module's own test file (e.g. in `export-utils.test.ts`, with fake timers: the Blob URL is not revoked before `DOWNLOAD_URL_TTL_MS`), named for the behaviour the device needs.

Assert placement, state and computed styles; never 3D pixels (the e2e Mol* stub draws nothing).

- [ ] **Step 3: Run it and see it fail for the cause**

One of (sandbox disabled for e2e and core browser tests):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
PLAYWRIGHT_PORT=8475 pnpm test:e2e <mobile-spec>.spec.ts --project=mobile -g "device <item id>:" --reporter=line 2>&1 | tail -20
PLAYWRIGHT_PORT=8475 pnpm test:e2e <workbench-spec>.spec.ts --project workbench -g "device <item id>:" --reporter=line 2>&1 | tail -20
pnpm --filter @protspace/core exec vitest --run --project browser <file> -t "<name>" 2>&1 | tail -15
pnpm --filter @protspace/core exec vitest --run --project unit <file> -t "<name>" 2>&1 | tail -15
pnpm --filter @protspace/app exec vitest --run <file> -t "<name>" 2>&1 | tail -15
pnpm --filter @protspace/utils exec vitest --run <file> -t "<name>" 2>&1 | tail -15
```

(After a utils change run `pnpm --filter @protspace/utils build` before core tests; after a core change `pnpm --filter @protspace/core build` before the app's tests; `pnpm test:e2e` builds the packages itself.) Expected: FAIL, showing the behaviour the user saw (write the message in the report). If it passes, the test does not reproduce the device: make it closer to what the user did (the hold time, the drag speed, the viewport, the theme), and if it still cannot fail, record the item as "not reproducible in emulation", fix only if the code path is clearly wrong by reading, and mark the item for the user's recheck.

- [ ] **Step 4: Apply the smallest fix**

Inside the brief's files only; every Global Constraint holds (tokens only in core styles, `--ps-touch-target` for coarse-pointer sizes, one plot resize per layout change, runtime elements never moved or keyed, no `display: none` on any ancestor of `#myImportMenu`/`#myExportMenu`, the ids and `data-driver-id` values kept, no new export without a consumer in the same commit).

If block 2 has written a delta that states the behaviour you changed (`grep -rn "<the behaviour's words>" openspec/changes/explore-workbench/specs/`), edit that requirement or scenario in the same commit, keeping its header byte-for-byte, and update its line in `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (`<Requirement> / <Scenario> → <test file>: "<test title>"`) to name your new test.

If the fix changes what a captured docs scene shows (`grep -n "<element or label>" scripts/docs-screenshots/manifest.ts` and the scene files), recapture only that scene, its light and dark twins together, sandbox disabled: `pnpm docs:screenshots -g "<file name>"` (or `pnpm docs:animations -g "<name>.gif" && pnpm docs:gifs <name>`), then `pnpm docs:images:check`. Never recapture for the decimal comma.

- [ ] **Step 5: Run it again, the touched files' tests, and the spec checks if a delta changed**

The Step 3 command: PASS. Every test file of the files you changed (whole files, package-scoped as in Step 3). The one e2e spec from Step 3, whole (`PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec> --project=mobile` or `--project workbench`): PASS, with its count before and after. This is the task's one e2e spec for this item; list every other spec the change could reach under "Unrun at task time" (`grep -rln "<changed helper, id or label>" apps/web/tests/*.spec.ts`), plus `pnpm perf:counts` when the change touches `packages/core/src/components/scatter-plot/`, `packages/core/src/components/legend/` or `packages/utils/src/visualization/`. Task 8.29 runs them first.

If a delta changed:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" | head -c 400
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "headers exit=$?"
```

Expected: validate passes (from Task 8.20 on), the deltas list parses, `headers exit=0`.

- [ ] **Step 6: Commit the item**

`pnpm exec prettier --check <every changed file>`, then stage by path (never `git add -A`) and commit with the sandbox disabled (the hook runs `pnpm precommit`; never `--no-verify`, never amend):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git add <each changed code, test, docs image and spec file by path>
git commit -m "fix(<scope>): <what the user sees now>"
```

Subject under 72 characters, one or two lines, no `Co-Authored-By` or Claude trailer; e.g. `fix(core): keep the TED reason on screen after a tap in Safari`. A delta edit rides in the same commit as its fix.

- [ ] **Step 7: Append the record and the recheck list**

Append to `.superpowers/sdd/phase-8b-wrapup/device-notes.md`:

```markdown
## 8.18 fixes

| item | device | cause (one line) | commit | test (file: "title") | spec delta changed | unrun at task time |
| --- | --- | --- | --- | --- | --- | --- |
| P2 | … | … | <sha> | `mobile-legend.spec.ts`: "device P2: …" | <cap>/<requirement> or none | … |

Not reproducible in emulation: <items and what was changed, if anything>.
Questions for the user: <items whose cause the note did not show>.

## Recheck on the device

- <item id> on <device and browser>: <what to do and what should now happen>
```

`git status --short` prints nothing at the end (the notes and evidence files are git-ignored).

**Commit:** one per item, e.g. `fix(core): keep the TED reason on screen after a tap in Safari`.

Report: status (DONE, DONE_WITH_CONCERNS or BLOCKED), commits, one line per item (fixed / not reproducible / question for the user), the spec deltas changed, the unrun list, and the recheck list for the orchestrator to send to the user.

### Task 8.19: The header-check script and its self-test

Before any delta exists, a script that catches the archive's silent failures: a MODIFIED or REMOVED header or a RENAMED FROM missing from the main spec, an ADDED header that already exists, a MODIFIED block that still uses a renamed-away name, MODIFIED/REMOVED/RENAMED in a capability that has no main spec, and (warning) a MODIFIED block with fewer scenarios than main's requirement. A fixture self-test proves each message.

**Files:**

- Create: `.superpowers/sdd/phase-8b-wrapup/check-headers.sh`
- Create: `.superpowers/sdd/phase-8b-wrapup/check-headers.test.sh`
- Fixtures are built by the test under `$TMPDIR/check-headers-fixtures/` and removed afterwards; no tracked file changes.

**Interfaces:**

- Consumes: R1 §3's awk script (the starting point); the delta format (Global Constraints); `openspec/specs/<cap>/spec.md` headers (`### Requirement: …`, `#### Scenario: …`).
- Produces: `bash check-headers.sh <change-dir> <specs-dir>`:
  - exit 0, no output, when clean; exit 1 with one line per error, each `<cap>: <message>: <requirement>` where message is one of `RENAMED FROM not in main`, `ADDED already in main`, `MODIFIED not in main`, `REMOVED not in main`, `MODIFIED uses the old name`, `delta section in a new capability` (a folder with no `<specs-dir>/<cap>/spec.md` holding `## MODIFIED`, `## REMOVED` or `## RENAMED`);
  - exit 2 with `no delta specs in <change-dir>/specs` when the folder has none;
  - `WARN <cap>: fewer scenarios than main (<n> < <m>): <requirement>` lines for a MODIFIED block with fewer `#### Scenario:` lines than main's block of the same (or renamed-from) name; warnings never change the exit code.
  - Header comparison is byte-exact after stripping the `### Requirement: ` prefix and trailing whitespace; a RENAMED pair adds the TO name and marks the FROM name as renamed.
- Produces: `bash check-headers.test.sh` prints `ok <case>` per case and exits 0 only if all pass.

**Tests (`check-headers.test.sh` cases):**

- clean: a main spec with two requirements, a delta modifying one with the same scenario count, adding a new name → exit 0, no output.
- each error message above, one fixture each (six cases) → exit 1 and exactly that line.
- rename: RENAMED FROM/TO then MODIFIED under the new name → exit 0; MODIFIED under the old name → `MODIFIED uses the old name`.
- fewer scenarios: MODIFIED block with one scenario where main has two → exit 0 and the WARN line.
- empty change folder → exit 2.
- the real change today (no `specs/`) → exit 2.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`, inside the sandbox (no network, no server). The two files are git-ignored (`.superpowers/` is in `.gitignore`): nothing is staged or committed. Both scripts must run under macOS's `/bin/bash` 3.2 and BWK `awk` (no associative arrays in bash, no `gawk` extensions), as written below.

How the script works, so a reader can check it: each delta file is read twice by one `awk` call. Pass 1 (`FNR == NR`) collects the RENAMED pairs wherever the section sits (`to_from[TO] = FROM`, `renamed[FROM]`). Pass 2 checks every `### Requirement:` header against the section it is in, and counts the `#### Scenario:` lines of each MODIFIED block, closing a block at the next `##`/`###` header or the end of the file. Main's headers and per-requirement scenario counts are read once in `BEGIN`. A MODIFIED or REMOVED name counts as "in main" when it is in main or is the TO of a rename whose FROM is in main. Header names may contain backticks (main has headers such as ``### Requirement: `protspace convert` SHALL …``), so a RENAMED line drops only its one closing backtick.

- [ ] **Step 1: Write the self-test first**

Create `.superpowers/sdd/phase-8b-wrapup/check-headers.test.sh` with exactly this content. (The `modified-missing` fixture writes a header ending in a space through `sed 's/@SP@/ /'`, so the case does not depend on an editor keeping trailing whitespace.)

```bash
#!/usr/bin/env bash
# Self-test for check-headers.sh: builds fixtures under $TMPDIR, prints "ok <case>" per case.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/check-headers.sh"
root=$(cd "$here/../../.." && pwd)
fx="${TMPDIR:-/tmp}/check-headers-fixtures"
rm -rf "$fx"
mkdir -p "$fx"
failed=0

# A main spec "demo" with two requirements: Alpha (two scenarios) and Beta (one).
main_spec() {
  mkdir -p "$1/specs/demo"
  cat > "$1/specs/demo/spec.md" <<'MD'
# demo Specification

## Purpose

Fixture.

## Requirements

### Requirement: Alpha
The system SHALL alpha.

#### Scenario: First
- **WHEN** one
- **THEN** two

#### Scenario: Second
- **WHEN** three
- **THEN** four

### Requirement: Beta
The system SHALL beta.

#### Scenario: Only
- **WHEN** five
- **THEN** six
MD
}

# new_case <name>: a fresh main/ and change/ pair; prints the case folder.
new_case() {
  d="$fx/$1"
  mkdir -p "$d/change/specs"
  main_spec "$d/main"
  echo "$d"
}

# delta <case-dir> <cap>: stdin becomes change/specs/<cap>/spec.md.
delta() {
  mkdir -p "$1/change/specs/$2"
  cat > "$1/change/specs/$2/spec.md"
}

# expect <case> <case-dir> <exit> <expected output>
expect() {
  out=$(bash "$script" "$2/change" "$2/main/specs" 2>&1)
  code=$?
  if [ "$code" -eq "$3" ] && [ "$out" = "$4" ]; then
    echo "ok $1"
  else
    echo "FAIL $1: exit $code (want $3)"
    echo "  got:  $out"
    echo "  want: $4"
    failed=1
  fi
}

d=$(new_case clean)
delta "$d" demo <<'MD'
## MODIFIED Requirements

### Requirement: Beta
The system SHALL beta, now better.

#### Scenario: Only
- **WHEN** five
- **THEN** seven

## ADDED Requirements

### Requirement: Gamma
The system SHALL gamma.

#### Scenario: New
- **WHEN** eight
- **THEN** nine
MD
expect clean "$d" 0 ""

d=$(new_case renamed-from-missing)
delta "$d" demo <<'MD'
## RENAMED Requirements

- FROM: `### Requirement: Alfa`
- TO: `### Requirement: Alpha two`
MD
expect renamed-from-missing "$d" 1 "demo: RENAMED FROM not in main: Alfa"

d=$(new_case added-exists)
delta "$d" demo <<'MD'
## ADDED Requirements

### Requirement: Beta
The system SHALL beta again.

#### Scenario: Only
- **WHEN** five
- **THEN** six
MD
expect added-exists "$d" 1 "demo: ADDED already in main: Beta"

# The first header ends in a space (written as @SP@): trailing whitespace still matches Beta.
d=$(new_case modified-missing)
sed 's/@SP@/ /' <<'MD' | delta "$d" demo
## MODIFIED Requirements

### Requirement: Beta@SP@
The system SHALL beta.

#### Scenario: Only
- **WHEN** five
- **THEN** six

### Requirement: beta
The system SHALL beta.

#### Scenario: Only
- **WHEN** five
- **THEN** six
MD
expect modified-missing "$d" 1 "demo: MODIFIED not in main: beta"

d=$(new_case removed-missing)
delta "$d" demo <<'MD'
## REMOVED Requirements

### Requirement: Delta
**Reason**: gone.
**Migration**: none.
MD
expect removed-missing "$d" 1 "demo: REMOVED not in main: Delta"

d=$(new_case old-name)
delta "$d" demo <<'MD'
## RENAMED Requirements

- FROM: `### Requirement: Beta`
- TO: `### Requirement: Beta renamed`

## MODIFIED Requirements

### Requirement: Beta
The system SHALL beta.

#### Scenario: Only
- **WHEN** five
- **THEN** six
MD
expect old-name "$d" 1 "demo: MODIFIED uses the old name: Beta"

d=$(new_case new-capability)
delta "$d" fresh <<'MD'
## ADDED Requirements

### Requirement: Fresh
The system SHALL be fresh.

#### Scenario: New
- **WHEN** one
- **THEN** two

## MODIFIED Requirements

### Requirement: Stale
The system SHALL be stale.

#### Scenario: Old
- **WHEN** one
- **THEN** two
MD
expect new-capability "$d" 1 "fresh: delta section in a new capability: Stale"

d=$(new_case rename-ok)
delta "$d" demo <<'MD'
## RENAMED Requirements

- FROM: `### Requirement: Alpha`
- TO: `### Requirement: Alpha renamed`

## MODIFIED Requirements

### Requirement: Alpha renamed
The system SHALL alpha.

#### Scenario: First
- **WHEN** one
- **THEN** two

#### Scenario: Second, reworded
- **WHEN** three
- **THEN** four
MD
expect rename-ok "$d" 0 ""

d=$(new_case fewer-scenarios)
delta "$d" demo <<'MD'
## RENAMED Requirements

- FROM: `### Requirement: Alpha`
- TO: `### Requirement: Alpha renamed`

## MODIFIED Requirements

### Requirement: Alpha renamed
The system SHALL alpha.

#### Scenario: First
- **WHEN** one
- **THEN** two
MD
expect fewer-scenarios "$d" 0 "WARN demo: fewer scenarios than main (1 < 2): Alpha renamed"

d="$fx/empty"
mkdir -p "$d/change" "$d/main/specs"
expect empty "$d" 2 "no delta specs in $d/change/specs"

# The real change: before any delta exists the script reports none (exit 2); once deltas
# exist it must reach a verdict (exit 0 or 1), never "no delta specs".
real="$root/openspec/changes/explore-workbench"
out=$(bash "$script" "$real" "$root/openspec/specs" 2>&1)
code=$?
if [ -d "$real/specs" ]; then
  if [ "$code" -eq 0 ] || [ "$code" -eq 1 ]; then echo "ok real-change (exit $code)"; else
    echo "FAIL real-change: exit $code: $out"; failed=1; fi
else
  if [ "$code" -eq 2 ] && [ "$out" = "no delta specs in $real/specs" ]; then echo "ok real-change"; else
    echo "FAIL real-change: exit $code: $out"; failed=1; fi
fi

rm -rf "$fx"
exit "$failed"
```

- [ ] **Step 2: Run it and watch it fail**

```bash
mkdir -p .superpowers/sdd/phase-8b-wrapup
bash .superpowers/sdd/phase-8b-wrapup/check-headers.test.sh; echo "exit $?"
```

Expected: every case prints `FAIL <case>: exit 127 (want …)` with `got:  bash: …/check-headers.sh: No such file or directory`, and the last line is `exit 1`. The script does not exist yet; the test is what defines it.

- [ ] **Step 3: Write the script**

Create `.superpowers/sdd/phase-8b-wrapup/check-headers.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Delta header check for an OpenSpec change (phase 8B; git-ignored, never committed).
# Usage: bash check-headers.sh <change-dir> <specs-dir>
# Exit 0: clean. Exit 1: one "<cap>: <message>: <requirement>" line per error.
# Exit 2: usage error, or no delta specs. WARN lines never change the exit code.
set -u
if [ "$#" -ne 2 ]; then
  echo "usage: bash check-headers.sh <change-dir> <specs-dir>" >&2
  exit 2
fi
change=${1%/}
main=${2%/}

found=0
for f in "$change"/specs/*/spec.md; do
  [ -f "$f" ] && found=1
done
if [ "$found" -eq 0 ]; then
  echo "no delta specs in $change/specs"
  exit 2
fi

fail=0
for f in "$change"/specs/*/spec.md; do
  cap=$(basename "$(dirname "$f")")
  base="$main/$cap/spec.md"
  isnew=0
  [ -f "$base" ] || isnew=1
  awk -v cap="$cap" -v base="$base" -v isnew="$isnew" '
    function name(line,   s) {
      s = line
      sub(/^.*### Requirement: /, "", s)
      sub(/[ \t\r]+$/, "", s)
      return s
    }
    function fromto(line,   s) {
      s = name(line)
      sub(/`$/, "", s)
      sub(/[ \t]+$/, "", s)
      return s
    }
    BEGIN {
      cur = ""
      if (!isnew) {
        while ((getline l < base) > 0) {
          if (l ~ /^### Requirement: /) { cur = name(l); have[cur] = 1; mainn[cur] = 0 }
          else if (l ~ /^#### Scenario:/ && cur != "") mainn[cur]++
          else if (l ~ /^## / || l ~ /^### /) cur = ""
        }
        close(base)
      }
      bad = 0; nw = 0; cur = ""
    }
    # Pass 1: collect the renames, wherever the RENAMED section sits.
    FNR == NR {
      if ($0 ~ /^## /) { sec1 = ($0 ~ /^## RENAMED Requirements/) ? "RENAMED" : "" ; next }
      if (sec1 == "RENAMED" && $0 ~ /FROM:/) { last_from = fromto($0); next }
      if (sec1 == "RENAMED" && $0 ~ /TO:/) { t = fromto($0); to_from[t] = last_from; renamed[last_from] = 1; next }
      next
    }
    # Pass 2: check every header.
    /^## / {
      endblock()
      sec = ""
      if ($0 ~ /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/) sec = $2
      next
    }
    sec == "RENAMED" && /FROM:/ {
      s = fromto($0)
      if (isnew) { print cap ": delta section in a new capability: " s; bad = 1 }
      else if (!(s in have)) { print cap ": RENAMED FROM not in main: " s; bad = 1 }
      next
    }
    sec == "RENAMED" && /TO:/ { next }
    /^### / {
      endblock()
      if ($0 !~ /^### Requirement: /) next
      h = name($0)
      if (isnew) {
        if (sec == "MODIFIED" || sec == "REMOVED") { print cap ": delta section in a new capability: " h; bad = 1 }
        next
      }
      if (sec == "ADDED" && (h in have) && !(h in renamed)) { print cap ": ADDED already in main: " h; bad = 1 }
      else if ((sec == "MODIFIED" || sec == "REMOVED") && !(h in have) && !((h in to_from) && (to_from[h] in have))) { print cap ": " sec " not in main: " h; bad = 1 }
      else if (sec == "MODIFIED" && (h in renamed)) { print cap ": MODIFIED uses the old name: " h; bad = 1 }
      else if (sec == "MODIFIED") { cur = h; curn = 0 }
      next
    }
    /^#### Scenario:/ { if (cur != "") curn++; next }
    function endblock(   m) {
      if (cur == "") return
      m = (cur in mainn) ? mainn[cur] : ((cur in to_from) && (to_from[cur] in mainn) ? mainn[to_from[cur]] : -1)
      if (m >= 0 && curn < m) warns[++nw] = "WARN " cap ": fewer scenarios than main (" curn " < " m "): " cur
      cur = ""
    }
    END {
      endblock()
      for (i = 1; i <= nw; i++) print warns[i]
      exit bad
    }
  ' "$f" "$f" || fail=1
done
exit "$fail"
```

- [ ] **Step 4: Run the self-test and see it pass**

```bash
bash .superpowers/sdd/phase-8b-wrapup/check-headers.test.sh; echo "exit $?"
```

Expected, exactly:

```text
ok clean
ok renamed-from-missing
ok added-exists
ok modified-missing
ok removed-missing
ok old-name
ok new-capability
ok rename-ok
ok fewer-scenarios
ok empty
ok real-change
exit 0
```

`ok real-change` (without an exit code in brackets) means the real change has no `specs/` folder yet and the script said `no delta specs in …/openspec/changes/explore-workbench/specs` with exit 2. From Task 8.20 on the same case prints `ok real-change (exit 0)`.

If a case fails, fix the script, not the test: the test's expected lines are the interface Tasks 8.20–8.30 rely on.

- [ ] **Step 5: Run the script on the real change once by hand**

```bash
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench; echo "exit $?"
```

Expected: the first prints `no delta specs in openspec/changes/explore-workbench/specs` and `exit 2`; the second prints the usage line on stderr and `exit 2`.

- [ ] **Step 6: Confirm nothing tracked changed**

```bash
git status --short
ls "${TMPDIR:-/tmp}/check-headers-fixtures" 2>&1 | head -1
```

Expected: `git status --short` prints nothing (both files are under the ignored `.superpowers/`); the fixture folder is gone (`No such file or directory`).

**Commit:** none (git-ignored files). The report pastes Step 4's output and Step 5's two exit codes.

### Task 8.20: Spec files for the shell capabilities

The first four new capabilities: the layout, the theming, the kit and the plot's proportions. They are written from the shell, the kit and the scale code and their tests; this is the first task after which `openspec validate explore-workbench --strict` passes.

**Files:**

- Create: `openspec/changes/explore-workbench/specs/explore-workbench-layout/spec.md`, `…/explore-theming/spec.md`, `…/explore-ui-kit/spec.md`, `…/plot-proportions/spec.md`
- Create: `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (sections for these four)
- Create: `.superpowers/sdd/phase-8b-wrapup/check-evidence.py` (git-ignored helper, reused by 8.21–8.23, 8.25 and 8.28)

**Interfaces:**

- Consumes (sources, read in the worktree): layout — `apps/web/src/workbench/{Workbench,AppBar,ViewBar,Sidebar,Rail,PanelFold,StructurePanel,PlotArea,EmptyState,WorkbenchToaster}.tsx`, `use-layout.ts`, `use-floating-card.ts`, `layout-geometry.ts`, `view-bar-overflow.ts`, `use-view-bar-stage.ts`, `use-file-drop.ts`, `use-sidebar-transition.ts`, `apps/web/src/explore/{layout-state,layout-defaults,file-drop}.ts` (`LAYOUT_STORAGE_KEY = 'protspace:layout:v1'`, `SIDEBAR_WIDTH { min: 240, max: 480, default: 300 }`, `LEGEND_FRACTION`, `FLOATING_CARD`, `MIN_PLOT_WIDTH 480`, `RAIL_WIDTH 44`); theming — `packages/core/src/styles/theme.ts`, `kit/adopt-theme.ts`, `utils/theme-observer.ts`, `apps/web/src/explore/{theme-state,theme-defaults}.ts` (`THEME_STORAGE_KEY = 'protspace:theme'`), `apps/web/index.html` boot script, `apps/web/src/index.css` `@theme inline`, `style-lint.test.ts`, palette contrast tests; kit — `packages/core/src/components/kit/*` (`layers.ts` `ESCAPE_ORDER`, `focus.ts`, `position.ts`, `icon.ts`, `segmented.ts`); proportions — `packages/utils/src/visualization/scales.ts` (`padDomain`, `fitScales`), `data-processor.ts` `createScales`, `export-renderer.ts` `createExportScales`, the scatterplot's resize and centre code. Evidence: `workbench-shell.spec.ts`, `workbench-sidebar.spec.ts`, `workbench-structure.spec.ts`, `workbench-view-bar.spec.ts`, `workbench-feedback.spec.ts`, `foundation.spec.ts`, `workbench-theme.spec.ts`, `theme*.test.ts`, kit `*.browser.test.ts`, `layers.test.ts`, `kit-gallery.spec.ts`, `workbench-escape.spec.ts`, `workbench-a11y.spec.ts`, `scales.test.ts`, `layout-geometry.test.ts`, `layout-state.test.ts`, `view-bar-overflow.test.ts`.
- Consumes from Task 8.19: `bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh <change-dir> <specs-dir>` (exit 0 and no output when clean; exit 2 and `no delta specs in <change-dir>/specs` while there are none).
- Produces: four ADDED-only files. Expected requirement topics (names chosen by the writer, 4–8 each, from the ownership table):
  - `explore-workbench-layout`: no site navigation on /explore and the app bar names the dataset and its protein count; the view bar is one row that never wraps (labels shorten, then items move into More); the sidebar's rail, collapse and edge resize (240–480 px, mouse and keyboard) with one plot resize per change; the legend/structure divider; docked or floating structure (floating only at ≥951 px; the default card clears the selection bar); layout stored under `protspace:layout:v1`, never in the URL, a corrupt stored value loads the defaults; a drop target over the whole page and the empty state; notifications at the plot's bottom edge.
  - `explore-theming`: one `--ps-*` token sheet on the document, adopted once by core; component styles read tokens only (the lint); the type scale and self-hosted Inter at a fixed 16 px root; System/Light/Dark stored under `protspace:theme`, applied before first paint, only while /explore is mounted, System following the OS live; the plot, structure viewer and overlays follow the theme; exports and the figure editor's preview stay light; contrast gates for role tokens and default palettes.
  - `explore-ui-kit`: popovers and dialogs in the top layer, never clipped; one Escape order (top layer, then EAT connectors, then the selection, then the tool); outside press-and-release closes; an icon-only button's label is its accessible name and its tooltip; one focus ring with a forced-colors fallback; reduced motion; Lucide icons only; plural-aware counts; a disabled segmented option keeps focus and hover, arrow keys skip it, a press shows its reason.
  - `plot-proportions`: one pixels-per-unit for both axes, centred; the export uses the same fit; one render and one grid rebuild per panel change; the viewed centre is kept across a resize; explicit zoom-inset domains are honoured.
- Produces: `spec-evidence.md` created with the header line `# Spec evidence (phase 8B)` and four `## <cap>` sections; one line per scenario, `- <Requirement> / <Scenario> → <test file>: "<test title>"` (the test file as a bare file name or a repo-relative path), several refs joined by `; `; several titles of one file may follow it as `; "<title>"`; a trailing ` (<note>)` after a title is allowed; a templated title (`test.each`, a template literal) is cited as it runs; a named code path, a config or a listing is written `code: <file> <what>`.
- Produces (addition): `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` — exit 0 when every scenario of each named capability has an evidence line and every cited title is in its tracked test file; Tasks 8.21, 8.22, 8.23, 8.25 and 8.28 must run it on the capabilities they write or edit, expecting `evidence: 0 problem(s)`.

**Tests:**

- The spec checks (Global Constraints): prettier; `openspec validate explore-workbench --strict` now passes; `change show --deltas-only` lists the four capabilities; `check-headers.sh` exits 0.
- Every scenario has an evidence line; the report runs three cited tests (one unit, one browser, one e2e via `-g`) and gives their results.
- `grep -nE "control bar|Tips|⚡|\\.ts\\b|:[0-9]+\\b" openspec/changes/explore-workbench/specs/*/spec.md` prints nothing (no removed UI, no file references).

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `openspec`, `prettier`, `python3`, the grep checks and `--project unit`/utils Vitest work inside the sandbox; the browser Vitest run, the e2e run and `git commit` need it disabled (Global Constraints, Environment).

How the files below were written, so a fact that moved since can be fixed the same way: each requirement states what the code at `d071e1da` does, each scenario is backed by the tests its evidence line names (titles copied from the test files), and nothing is taken from `design.md`. Three rules the OpenSpec CLI and the checks enforce: **the first line of a requirement's text must contain SHALL or MUST** (`openspec validate --strict` reads only that line: a SHALL on the second line fails with `must contain SHALL or MUST`); every requirement has at least one `#### Scenario:`; and the specs hold no file path, line number, `:<digit>` (so ratios are written "4.5 to 1"), the word "Tips", "control bar" or "⚡". Prettier escapes `Mol*` as `Mol\*`, so the files below already carry the escape.

- [ ] **Step 1: See the change fail validation**

```bash
ls openspec/changes/explore-workbench/specs 2>&1 | head -1
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "check-headers exit $?"
```

Expected: `ls` reports `No such file or directory`; `validate` says the change has issues, among them that it must have at least one delta; the header check prints `no delta specs in openspec/changes/explore-workbench/specs` and `check-headers exit 2`.

- [ ] **Step 2: Write the evidence checker**

Create `.superpowers/sdd/phase-8b-wrapup/check-evidence.py` with exactly this content:

```python
"""Spec-evidence check (phase 8B; git-ignored, never committed).

Usage, from the worktree root:
  python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>...

For each capability it checks that every ref in the `## <cap>` section of
.superpowers/sdd/phase-8b-wrapup/spec-evidence.md names a tracked file that
holds the cited title, and that every `#### Scenario:` of
openspec/changes/explore-workbench/specs/<cap>/spec.md has a line
`- <Requirement> / <Scenario> → <refs>` there.
A ref is `<test file>: "<test title>"` (a bare file name or a repo-relative
path). Several titles of one file may follow it as `; "<title>"`. One or more trailing
` (<note>)` after a title are allowed. A title built by test.each or a template
literal is cited as it runs and matched against the source's template.
A ref `code: <file> <function> …` is a named code path and is not looked up.
Refs are separated by `; `. Exit 0 when clean, 1 otherwise.
"""
import os
import re
import subprocess
import sys

EVIDENCE = '.superpowers/sdd/phase-8b-wrapup/spec-evidence.md'
SPECS = 'openspec/changes/explore-workbench/specs'
REF_SPLIT = re.compile(r'\s*;\s+(?=(?:[\w./\-]+: "|"|code(?: path)?: ))')
REF = re.compile(r'(?:([\w./\-]+): )?"(.*)"(?:\s+\((?:[^()"]|\([^()"]*\))*\))*')
# A title built by test.each / a template literal: match it against the source's template.
TEMPLATE = re.compile(r"'([^'\n]*(?:%[sdifj#]|\$\{)[^'\n]*)'|`([^`\n]*\$\{[^`\n]*)`")
PLACEHOLDER = re.compile(r'%[sdifj#]|\\\$\\\{[^}]*\\\}')

files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
evidence = open(EVIDENCE, encoding='utf8').read()
bad = 0


def problem(message):
    global bad
    print(message)
    bad += 1


def has_title(text, title):
    if title in text:
        return True
    for single, backtick in TEMPLATE.findall(text):
        if re.fullmatch(PLACEHOLDER.sub('.+', re.escape(single or backtick)), title):
            return True
    return False


for cap in sys.argv[1:]:
    section = re.search(r'^## ' + re.escape(cap) + r'\n(.*?)(?=^## |\Z)', evidence, re.M | re.S)
    if not section:
        problem(f'{cap}: no section in {EVIDENCE}')
        continue
    lines = {}
    for line in section.group(1).splitlines():
        if line.startswith('- ') and ' → ' in line:
            key, refs = line[2:].split(' → ', 1)
            lines[key.strip()] = refs
    # Refs first, so a renamed or missing test shows up even before the spec file exists.
    for key, refs in lines.items():
        name = None  # a bare "title" after `; ` belongs to the file named before it
        for ref in REF_SPLIT.split(refs):
            ref = ref.strip()
            if ref.startswith(('code: ', 'code path: ')):
                name = None
                continue
            match = REF.fullmatch(ref)
            if not match:
                problem(f'{cap}: unparsed ref: {ref}')
                continue
            name = match.group(1) or name
            if name is None:
                problem(f'{cap}: a title with no file before it: {ref}')
                continue
            title = match.group(2)
            # A bare file name must match one tracked file; a path must be one.
            paths = [f for f in files if f == name or ('/' not in name and f.endswith('/' + name))]
            if len(paths) != 1:
                problem(f'{cap}: {name} matches {len(paths)} tracked files')
                continue
            if not has_title(open(paths[0], encoding='utf8').read(), title):
                problem(f'{cap}: title not in {name}: {title}')
    spec = f'{SPECS}/{cap}/spec.md'
    if not os.path.exists(spec):
        problem(f'{cap}: no spec file {spec}')
        continue
    requirement = None
    for line in open(spec, encoding='utf8'):
        if line.startswith('### Requirement: '):
            requirement = line[len('### Requirement: '):].strip()
        elif line.startswith('#### Scenario: '):
            key = f'{requirement} / {line[len("#### Scenario: "):].strip()}'
            if key not in lines:
                problem(f'{cap}: no evidence for: {key}')
print(f'evidence: {bad} problem(s)')
sys.exit(1 if bad else 0)
```

- [ ] **Step 3: Write the evidence map first**

The evidence map is this task's test: it names, before any spec text exists, the tests each scenario must rest on. Create `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` with exactly this content:

````markdown
# Spec evidence (phase 8B)

One line per scenario: `<Requirement> / <Scenario> → <test file>: "<test title>"`, several tests
separated by `; `; several titles of one file may follow it as `; "<title>"`; a trailing
` (<note>)` after a title is allowed; a templated title is cited as it runs. A scenario only a
person can see cites `code: <file> <what>` instead.

## explore-workbench-layout

- The explore page is a workbench with its own app bar / No site navigation on /explore → workbench-shell.spec.ts: "explore is a workbench without the site navigation"
- The explore page is a workbench with its own app bar / The dataset and its size → workbench-shell.spec.ts: "the app bar names the dataset and its protein count"
- The explore page is a workbench with its own app bar / Other pages keep the site header → workbench-shell.spec.ts: "the landing and privacy pages keep the site header"
- The view bar keeps one row / Common desktop widths → workbench-view-bar.spec.ts: "the view bar is 44 px, one row and does not overflow at 1440, 1280, 1024 and 951 px"
- The view bar keeps one row / Narrowing and widening → workbench-view-bar.spec.ts: "narrowing moves Contours, then Filter, into More, and widening brings them back"; workbench-view-bar.spec.ts: "a window jittering ±4 px around a threshold keeps its stage"
- The view bar keeps one row / More marks an active control inside it → workbench-view-bar.spec.ts: "More shows a dot with contours on, and Auto there sets density=auto in the URL"
- The sidebar folds to a rail and resizes / Collapse and expand from the rail → workbench-sidebar.spec.ts: "the rail keeps Legend, Structure and Collapse sidebar, named for assistive tech, when collapsed"
- The sidebar folds to a rail and resizes / Dragging the edge → workbench-sidebar.spec.ts: "dragging the edge previews over the plot and resizes it once on release, clamped to 240–480"; layout-geometry.test.ts: "clampSidebarToWindow keeps the plot at 480 px"
- The sidebar folds to a rail and resizes / Moving the edge by keyboard → workbench-sidebar.spec.ts: "the edge separator moves by keyboard and commits once"; layout-geometry.test.ts: "sidebarStep handles arrows, Shift, Home and End within 240–480"
- The sidebar folds to a rail and resizes / A protein clicked while collapsed → workbench-sidebar.spec.ts: "a protein clicked while collapsed waits behind the Structure dot; Structure opens the sidebar and loads it"
- The legend and the structure share the sidebar under a divider / A first protein click → workbench-structure.spec.ts: "clicking a protein shows the structure under a divider and the plot keeps its size"; layout-geometry.test.ts: "splitSidebar honours the fraction within the 120 and 220 px minimums"
- The legend and the structure share the sidebar under a divider / Moving the divider → workbench-structure.spec.ts: "the divider moves by drag and by keyboard, survives a reload and never resizes the plot"; layout-geometry.test.ts: "fractionStep moves 5 %, or 20 % with Shift"
- The legend and the structure share the sidebar under a divider / Closing the structure → workbench-structure.spec.ts: "Close structure brings the footer back"; workbench-structure.spec.ts: "loading another dataset clears the structure"
- The structure docks in the sidebar or floats over the plot / Pop out → workbench-structure.spec.ts: "Pop out floats the card over the plot without resizing it"; workbench-structure.spec.ts: "docking and floating keep the same viewer and do not reload the structure"
- The structure docks in the sidebar or floats over the plot / The default card clears the selection bar → workbench-structure.spec.ts: "the default floating card leaves Copy IDs and Clear clickable"
- The structure docks in the sidebar or floats over the plot / A card stored outside the plot → workbench-structure.spec.ts: "the card drags and resizes, survives a reload, and a card stored outside the plot or left outside by a shrinking window renders inside it"; layout-geometry.test.ts: "enforces the 280 × 240 minimum"
- The structure docks in the sidebar or floats over the plot / Below desktop width → workbench-structure.spec.ts: "below 951 px there is no Pop out and a stored floating card shows docked"
- The layout is stored per browser, never in the URL / Reload keeps the layout → workbench-sidebar.spec.ts: "width and collapsed state survive a reload, and layout never reaches the URL"; layout-state.test.ts: "writes once per update, to protspace:layout:v1 only"
- The layout is stored per browser, never in the URL / A corrupt stored layout → workbench-sidebar.spec.ts: "a corrupt or oversized stored layout loads safely"; layout-state.test.ts: "loads the defaults from garbage JSON, an array or null"; layout-state.test.ts: "falls back per field on wrong types, NaN, Infinity and an unknown placement"; layout-state.test.ts: "loads the defaults when getItem throws, and survives a throwing setItem"
- Files are opened by dropping them anywhere, or from the empty state / Dropping on the sidebar → workbench-loading.spec.ts: "a file dragged over the sidebar shows the drop area and a drop loads it"; workbench-loading.spec.ts: "a drop over the docked structure loads the file"
- Files are opened by dropping them anywhere, or from the empty state / Dragging a legend row → workbench-loading.spec.ts: "dragging a legend row does not show the drop area"
- Files are opened by dropping them anywhere, or from the empty state / Nothing loaded → workbench-loading.spec.ts: "with the demo download aborted, the empty state shows and Open a file… opens the file chooser"; workbench-loading.spec.ts: "Pick an example opens the Import panel at the button"; workbench-loading.spec.ts: "a drop on the empty plot loads the file and the empty state goes"; workbench-loading.spec.ts: "on a short plot the empty state never covers the banner's buttons"
- Notifications appear over the plot's bottom edge / A notification beside the sidebar → workbench-feedback.spec.ts: "a toast sits inside the plot's horizontal span, does not intersect #myLegend and has a close button named Dismiss notification"
- Notifications appear over the plot's bottom edge / A notification with a selection → workbench-feedback.spec.ts: "with a selection the toast sits above the selection bar"

## explore-theming

- One token sheet styles the explore page / Tokens reach inside components → theme.browser.test.ts: "reaches inside shadow roots without the component declaring anything"; theme.browser.test.ts: "lets a plain, unlayered page rule override a token in light and in dark"; adopt-theme.test.ts: "puts light values on :root and dark values under data-theme="dark" and system"
- One token sheet styles the explore page / The sheet is added once → adopt-theme.test.ts: "adds the token sheet to a document exactly once"; workbench-shell.spec.ts: "tokens and the kit are ready before the explore runtime loads"
- One token sheet styles the explore page / The lint rejects a raw colour → style-lint.test.ts: "flags raw colours, literal font sizes, stray tokens and unknown variables"; style-lint.test.ts: "defines every --ps token a stylesheet reads"
- The explore page sets its own type / Fonts on /explore → foundation.spec.ts: "explore keeps a 16px root, adopts the tokens and self-hosts Inter"
- The user chooses System, Light or Dark / Choosing Dark → workbench-theme.spec.ts: "Dark from the app bar themes the page, survives a reload and is stored as JSON"; workbench-theme.spec.ts: "the menu marks the current choice and opens on it"; workbench-theme.spec.ts: "the button's icon shows the choice"; theme-state.test.ts: "defaults when storage throws"
- The user chooses System, Light or Dark / First paint → workbench-theme.spec.ts: "a cold load with Dark stored paints the dark surface before the Explore chunk runs"; workbench-theme.spec.ts: "System stored follows a dark OS before the chunk runs"; workbench-theme.spec.ts: "the GitHub Pages deep link /?/explore is themed"
- The user chooses System, Light or Dark / System follows the OS → workbench-theme.spec.ts: "System follows the OS live"; workbench-theme.spec.ts: "an explicit Light ignores the OS"
- The user chooses System, Light or Dark / Other pages stay light → workbench-theme.spec.ts: "only /explore is themed"
- Everything on screen follows the theme / Dark plot → scatter-plot.theme.browser.test.ts: "in dark the host background is #0b1120"; scatter-plot.theme.browser.test.ts: "in dark an Other point's pixel is the dark grey (±3 per channel after blending)"
- Everything on screen follows the theme / Switching theme → scatter-plot.theme.browser.test.ts: "switching dark → light requests one render and restyles colour only"
- Everything on screen follows the theme / Dark surfaces around the plot → workbench-theme.spec.ts: "a toast is dark in Dark, and so is its hovered close button"; workbench-theme.spec.ts: "the tour's popover, its arrow and its overlay are dark in Dark"; workbench-structure.spec.ts: "Mol*'s background follows the theme"
- Exports stay light / Quick PNG in Dark → workbench-theme.spec.ts: "a quick PNG exported in Dark equals the one exported in Light"
- Exports stay light / Figure editor preview in Dark → workbench-theme.spec.ts: "the figure editor previews a transparent figure on light paper in Dark"
- Both themes meet contrast minimums / Text on surfaces → theme.test.ts: "text roles reach 4.5:1 on every surface (%s)"; theme.test.ts: "control boundaries reach 3:1 on every surface (%s)"; theme.test.ts: "focus reaches 3:1 on every surface (%s)"
- Both themes meet contrast minimums / Palette on the dark plot → palette-contrast.test.ts: "Kelly's colours reach 2:1 on the dark plot background, except the allow-listed #2B3D26 and #222222"

## explore-ui-kit

- Menus, popovers and dialogs open in the top layer / A popover inside a clipping ancestor → popover.browser.test.ts: "opens in the top layer, where an ancestor with overflow and a transform cannot clip it"
- Menus, popovers and dialogs open in the top layer / A popover at the screen's corner → popover.browser.test.ts: "flips and shifts to stay on screen at the bottom-right corner"; popover.browser.test.ts: "shrinks to fit and scrolls when neither side has room"
- Menus, popovers and dialogs open in the top layer / A dialog closes → dialog.browser.test.ts: "closes on a real Escape key, once, and returns focus to the opener"; dialog.browser.test.ts: "opens as a modal dialog, labelled by its heading, with focus on the autofocus element"
- Escape takes one step per press / Escape after an EAT click → workbench-escape.spec.ts: "an EAT click: Escape 1 hides the connectors and keeps the selection, 2 clears the selection, 3 returns to Move"; layers.test.ts: "runs the fallbacks in ascending order when no layer is open, stopping at the first that handles it"
- Escape takes one step per press / A layer is open → layers.test.ts: "does not reach the fallbacks while a layer is open"; layers.test.ts: "a handler that calls preventDefault keeps Escape from the fallbacks"
- A press outside closes the topmost layer / Press outside → layers.test.ts: "closes the top layer when the press starts and ends outside it"; layers.test.ts: "counts elements inside a shadow root as inside the layer"
- A press outside closes the topmost layer / Drag out of a layer → layers.test.ts: "keeps the layer open for a drag that starts inside and ends outside"; layers.test.ts: "keeps the layer open when the press starts outside and ends inside"
- An icon-only button is named by its label / Name and tooltip → button.browser.test.ts: "uses its label as the accessible name"; button.browser.test.ts: "shows its label as a tooltip on keyboard focus and hides it on Escape"; button.browser.test.ts: "reports a toggle state through aria-pressed only when pressed is set"
- An icon-only button is named by its label / Hover → button.browser.test.ts: "shows the tooltip after 500ms of hover and hides it when the pointer leaves"; button.browser.test.ts: "a touch pointerenter does not show the tooltip; a mouse pointerenter does after 500 ms"
- An icon-only button is named by its label / Icons → icon.test.ts: "renders a Lucide icon as an inline, decorative SVG at the requested size"
- One focus ring for keyboard focus / A focused field → fields.browser.test.ts: "draws one focus ring, on the field, not a second one on the inner input"; menu.browser.test.ts: "marks the focused search field in forced colours"
- One focus ring for keyboard focus / Hover is not focus → menu.browser.test.ts: "rings a keyboard-focused item but not a hovered one"
- Motion follows the user's setting / Reduced motion → legend.styles.browser.test.ts: "turns the row transitions off under reduced motion"; product-tour.spec.ts: "the tour does not animate"; workbench-sidebar.spec.ts: "with reduced motion, collapse and expand still resize the plot once each"
- Counts read in the right plural / One and many → selection-bar.browser.test.ts: "count text is plural-aware: 1 protein selected, 1,234 proteins selected"; count-text.test.ts: "picks one or other by plural rules"
- A disabled choice says why / Pressing a disabled option → fields.browser.test.ts: "clicking a disabled option shows its reason and still selects nothing"; fields.browser.test.ts: "tapping a disabled option shows its reason and selects nothing"; fields.browser.test.ts: "a disabled option is aria-disabled, not natively disabled"
- A disabled choice says why / Arrow keys → fields.browser.test.ts: "arrow keys skip a disabled option"

## plot-proportions

- Both axes share one scale / A wide plot → scales.test.ts: "a wide box narrows x and centres it; y keeps its full range"; scales.test.ts: "x and y share one pixels-per-unit"; scales.test.ts: "grows each axis by 5% of its span on both sides"
- Both axes share one scale / A tall plot → scales.test.ts: "a tall box narrows y and centres it; x keeps its full range"
- Both axes share one scale / A flat projection → scales.test.ts: "a zero x span takes the full x range and y stays finite"
- An export keeps the plot's proportions / Exporting at another size → export-renderer.test.ts: "default path: fits the padded extent inside the scaled margins with one scale, centred"; export-renderer.test.ts: "an export has the live plot's shape at the same aspect"
- A panel change resizes the plot once / Collapse and expand → workbench-sidebar.spec.ts: "collapsing widens #myPlot by the sidebar width with one render, and expanding narrows it with one"
- A panel change resizes the plot once / Reduced motion → workbench-sidebar.spec.ts: "with reduced motion, collapse and expand still resize the plot once each"
- A panel change resizes the plot once / Floating the structure → workbench-structure.spec.ts: "Pop out floats the card over the plot without resizing it"; workbench-structure.spec.ts: "the divider moves by drag and by keyboard, survives a reload and never resizes the plot"
- A resize keeps the viewed centre / Zoomed in across a collapse → workbench-sidebar.spec.ts: "a zoomed-in view keeps its centre protein across collapse and expand"; scatter-plot.resize.test.ts: "keeps the data under the view centre across a resize"
- A resize keeps the viewed centre / Not zoomed → scatter-plot.resize.test.ts: "an identity transform stays identity after a resize"
- A zoom inset shows exactly its region / An inset from a source rectangle → figure-editor.spec.ts: "inset content reflects the source rect region"; export-renderer.test.ts: "dataDomain path: full-bleed range with no padding and no margins"
````

Then run the checker:

```bash
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py explore-workbench-layout explore-theming explore-ui-kit plot-proportions; echo "exit $?"
```

Expected: four lines `<cap>: no spec file openspec/changes/explore-workbench/specs/<cap>/spec.md`, `evidence: 4 problem(s)`, `exit 1`. The checker looks up every ref before it looks for the spec file, so no `title not in …`, `unparsed ref` or `matches <n> tracked files` line may appear: every cited title exists at HEAD. If one does (a test was renamed after `d071e1da`), find the test's current title with `grep -n "<part of the old title>" <file>` and correct the evidence line; if the test itself is gone or now asserts something else, change the scenario in Steps 4–7 to what the code does and name it in the report as a disagreement for 8.24.

- [ ] **Step 4: Write `explore-workbench-layout`**

Create `openspec/changes/explore-workbench/specs/explore-workbench-layout/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: The explore page is a workbench with its own app bar

The /explore page SHALL replace the site header with a 48 px app bar (`role="banner"`) that has no
site navigation: no Home or Docs link and no Resources menu; the ProtSpace mark SHALL link to `/`.
The app bar SHALL name the loaded dataset and its protein count, formatted in the browser's
locale, as "{name} · {count} proteins". Below it a view bar, the plot area and a right-hand
sidebar (`role="complementary"`, named "Sidebar", 300 px wide by default) SHALL share the screen.
The landing and privacy pages SHALL keep the site header.

#### Scenario: No site navigation on /explore

- **WHEN** the user opens /explore
- **THEN** the page shows the app bar and no Home link, Docs link or Resources menu
- **AND** the ProtSpace mark links to `/`

#### Scenario: The dataset and its size

- **WHEN** a dataset is loaded
- **THEN** the app bar shows the dataset's name followed by "· N proteins", N being its protein
  count in the browser's number format

#### Scenario: Other pages keep the site header

- **WHEN** the user opens the landing page or the privacy page
- **THEN** the site header with its navigation is shown

### Requirement: The view bar keeps one row

The view bar SHALL hold Projection with its details, Color by, Contours and Filter in a single row
at least 44 px tall that never wraps or overflows. When the row runs out of width it SHALL first
drop the visible keys "Projection", "Color by" and "Contours" (the accessible names keep them),
then move Contours, then Filter, into its More menu, and SHALL bring them back as the width
returns. A window resized back and forth by a few pixels around a threshold SHALL keep its stage.

#### Scenario: Common desktop widths

- **WHEN** the window is 1440, 1280, 1024 or 951 px wide
- **THEN** the view bar is one row that does not overflow

#### Scenario: Narrowing and widening

- **WHEN** the window narrows until the row no longer fits
- **THEN** Contours moves into More, then Filter
- **AND** widening the window brings them back into the row

#### Scenario: More marks an active control inside it

- **WHEN** Contours sits in More and a contour mode other than Off is on
- **THEN** More shows a dot

### Requirement: The sidebar folds to a rail and resizes

The sidebar SHALL keep a 44 px rail with Legend, Structure and Filter items and a Collapse sidebar
/ Expand sidebar toggle that stays visible, named and stateful (`aria-pressed`, `aria-expanded`)
while the sidebar is collapsed; what the Filter item opens is query-builder-filtering's. A
collapsed sidebar SHALL be inert. Its left edge SHALL be a separator the user drags
or moves with the arrow keys (Shift for larger steps, Home and End for the ends): a drag SHALL
preview over the plot and commit on release. The width SHALL stay within 240–480 px and SHALL be
clamped further so the plot keeps at least 480 px of the window.

#### Scenario: Collapse and expand from the rail

- **WHEN** the user collapses the sidebar
- **THEN** the rail stays visible at 44 px with Legend, Structure and Expand sidebar
- **AND** Legend opens the sidebar again

#### Scenario: Dragging the edge

- **WHEN** the user drags the sidebar's edge past 480 px or below 240 px and releases
- **THEN** the drag previews over the plot and the width is committed on release, clamped to
  240–480 px

#### Scenario: Moving the edge by keyboard

- **WHEN** the edge separator has focus and the user presses an arrow key
- **THEN** the width changes by one step and is committed once

#### Scenario: A protein clicked while collapsed

- **WHEN** the sidebar is collapsed and the user clicks a protein
- **THEN** the rail's Structure button shows a dot, and Structure opens the sidebar with that
  protein's structure

### Requirement: The legend and the structure share the sidebar under a divider

Before any protein is clicked the sidebar SHALL show the legend at full height over a Structure
footer. Once a structure opens, a divider SHALL split the sidebar between the legend (at least
120 px) and the structure (at least 220 px); the divider SHALL move by drag and by keyboard (5 %
per arrow, 20 % with Shift), and its position SHALL be kept across a reload. Moving the divider
SHALL NOT resize the plot. Close structure SHALL bring the footer back, and loading another
dataset SHALL clear the structure.

#### Scenario: A first protein click

- **WHEN** the user clicks a protein
- **THEN** its structure shows under a divider and the plot keeps its size

#### Scenario: Moving the divider

- **WHEN** the user drags the divider or moves it with the keyboard and reloads
- **THEN** the legend and structure keep the new split and the plot is never resized

#### Scenario: Closing the structure

- **WHEN** the user presses Close structure
- **THEN** the legend fills the sidebar again over the Structure footer

### Requirement: The structure docks in the sidebar or floats over the plot

At 951 px and wider the structure SHALL offer Pop out, which floats it as a card over the plot,
and Dock structure, which puts it back; switching SHALL keep the same viewer and SHALL NOT reload
the structure or resize the plot. The floating card SHALL be at least 280 × 240 px, move by its
header and resize by its grip (a 24 px target) with the pointer or the keyboard, stay inside the
plot area, and be kept across a reload. The default card SHALL leave the selection bar's Copy IDs
and Clear clickable. Below 951 px there SHALL be no Pop out, and a stored floating card SHALL show
docked.

#### Scenario: Pop out

- **WHEN** the user presses Pop out
- **THEN** the structure floats as a card over the plot and the plot keeps its size

#### Scenario: The default card clears the selection bar

- **WHEN** the card floats at its default place while proteins are selected
- **THEN** Copy IDs and Clear on the selection bar stay clickable

#### Scenario: A card stored outside the plot

- **WHEN** the stored card lies outside the plot area, or a shrinking window leaves it outside
- **THEN** the card renders inside the plot area

#### Scenario: Below desktop width

- **WHEN** the window is narrower than 951 px and the stored placement is floating
- **THEN** the structure shows docked and no Pop out is offered

### Requirement: The layout is stored per browser, never in the URL

The layout SHALL be stored under the localStorage key `protspace:layout:v1` and SHALL NOT appear
in the URL: the sidebar's open state and width, the legend/structure split, the structure's
placement and the floating card. A stored value of the wrong type, out of range, non-finite or
unparsable, or a storage that throws, SHALL load the defaults for the fields it affects, and the
page SHALL still load.

#### Scenario: Reload keeps the layout

- **WHEN** the user collapses or resizes the sidebar and reloads
- **THEN** the sidebar has the same width and state
- **AND** the URL holds no layout parameter

#### Scenario: A corrupt stored layout

- **WHEN** `protspace:layout:v1` holds garbage, an array, or out-of-range numbers
- **THEN** the page loads with the defaults for the bad fields, sizes clamped to their ranges

### Requirement: Files are opened by dropping them anywhere, or from the empty state

A file dragged over any part of the workbench (plot, sidebar, docked structure) SHALL show a drop
area reading "Drop to open this file", and dropping it SHALL load it. Dragging a legend row SHALL
NOT show the drop area. A file dropped outside the workbench, such as on the loading overlay, SHALL
NOT be opened by the browser. When nothing is loaded the plot SHALL show an empty state, "Drop a
file or pick an example", with Open a file… and Pick an example; it SHALL never cover the recovery
banner's buttons.

#### Scenario: Dropping on the sidebar

- **WHEN** the user drags a file over the sidebar and drops it
- **THEN** the drop area shows during the drag and the file loads

#### Scenario: Dragging a legend row

- **WHEN** the user drags a legend row
- **THEN** no drop area shows

#### Scenario: Nothing loaded

- **WHEN** startup ends with no dataset on screen
- **THEN** the empty state shows, Open a file… opens the file chooser and Pick an example opens
  the Import panel at the button
- **AND** a file dropped on the plot loads and the empty state goes

### Requirement: Notifications appear over the plot's bottom edge

Notifications SHALL sit inside the plot area's horizontal span, at most 360 px wide, without
overlapping the legend, and above the selection bar while proteins are selected.

#### Scenario: A notification beside the sidebar

- **WHEN** a notification shows
- **THEN** it lies within the plot's horizontal span and does not intersect the legend

#### Scenario: A notification with a selection

- **WHEN** proteins are selected and a notification shows
- **THEN** it sits above the selection bar
````

- [ ] **Step 5: Write `explore-theming`**

Create `openspec/changes/explore-workbench/specs/explore-theming/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: One token sheet styles the explore page

Every colour, font, size and radius the explore page's components use SHALL come from one set of
`--ps-*` custom properties declared on the document's root, with light values by default and dark
values under `data-theme="dark"` (and under `data-theme="system"` when the OS prefers dark). Core
SHALL add this sheet to a document exactly once, before the explore runtime loads, and component
shadow roots SHALL read the tokens without declaring them, so a plain page rule overriding a token
reaches every component in light and in dark. Component stylesheets SHALL NOT hold raw colours,
literal font sizes or reads of undefined tokens; the style lint enforces this.

#### Scenario: Tokens reach inside components

- **WHEN** a page rule sets a `--ps-*` token on the root
- **THEN** components inside shadow roots use the new value, in light and in dark

#### Scenario: The sheet is added once

- **WHEN** core's token sheet is adopted into a document twice
- **THEN** the document holds it once

#### Scenario: The lint rejects a raw colour

- **WHEN** a component stylesheet holds a raw colour, a literal font size, or reads a `--ps-*`
  token the sheet does not define
- **THEN** the style lint fails naming it

### Requirement: The explore page sets its own type

The explore page SHALL keep a 16 px root font size and set its text in Inter served from the app's
own origin; no font SHALL be loaded from a third-party font service.

#### Scenario: Fonts on /explore

- **WHEN** /explore loads
- **THEN** the root font size is 16 px, Inter is available, and every font request goes to the
  app's own origin

### Requirement: The user chooses System, Light or Dark

The app bar SHALL offer a Theme menu with System, Light and Dark that marks the current choice,
opens on it, and shows the choice in its button's icon. The choice SHALL be stored as JSON under
the localStorage key `protspace:theme`; with nothing valid stored, or a storage that throws, it
SHALL be System. System SHALL follow the operating system's colour scheme, live; Light and Dark
SHALL ignore it. The choice SHALL apply only to /explore (also when reached through the GitHub
Pages deep link `/?/explore`), and the stored choice SHALL paint before the explore code runs, so
a cold load never flashes the other theme.

#### Scenario: Choosing Dark

- **WHEN** the user picks Dark and reloads
- **THEN** the page is dark, and `protspace:theme` holds `"dark"`

#### Scenario: First paint

- **WHEN** /explore loads cold with Dark stored, or with System stored on a dark OS
- **THEN** the dark surface is painted before the explore code runs

#### Scenario: System follows the OS

- **WHEN** System is chosen and the OS switches between light and dark
- **THEN** the page follows without a reload

#### Scenario: Other pages stay light

- **WHEN** Dark is stored and the user opens a page other than /explore
- **THEN** that page is not themed

### Requirement: Everything on screen follows the theme

Everything the explore page draws SHALL follow the theme: the plot's background and its neutral
colours (Other, N/A, connectors), the structure viewer's frame and Mol\*'s background,
notifications, the product tour's popover and overlay, the legend's swatches and the wordmark. A
theme change SHALL restyle the plot's colours with one render and SHALL NOT change the plot's size
or the view.

#### Scenario: Dark plot

- **WHEN** the theme is Dark
- **THEN** the plot's background and an Other point use the dark values

#### Scenario: Switching theme

- **WHEN** the theme switches from Dark to Light
- **THEN** the plot renders once with the light colours and its view is unchanged

#### Scenario: Dark surfaces around the plot

- **WHEN** the theme is Dark
- **THEN** a notification, the tour's popover and the structure viewer's background are dark

### Requirement: Exports stay light

Exported images SHALL NOT depend on the theme: a quick PNG exported in Dark SHALL equal the one
exported in Light, and the figure editor SHALL preview a figure on light paper in either theme.

#### Scenario: Quick PNG in Dark

- **WHEN** the user exports a Quick PNG in Dark and again in Light
- **THEN** the two images are equal

#### Scenario: Figure editor preview in Dark

- **WHEN** the figure editor is open in Dark
- **THEN** its preview shows the figure on light paper

### Requirement: Both themes meet contrast minimums

In light and in dark, body text, muted text and accent text SHALL reach a contrast ratio of at
least 4.5 to 1 on every surface they sit on, as SHALL tooltip text and danger text; control
boundaries, the selected-segment ring and the focus ring SHALL reach at least 3 to 1; the plot's
Other colour, connectors and EAT endpoints SHALL reach at least 3 to 1 on the plot background.
On the dark plot background the colours of Kelly's palette SHALL reach at least 2 to 1, and those
of Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 at least 3 to 1, except for an explicit
allow-list.

#### Scenario: Text on surfaces

- **WHEN** the token values are checked in light and in dark
- **THEN** text, muted text and accent text reach 4.5 to 1 on each surface

#### Scenario: Palette on the dark plot

- **WHEN** Kelly's palette is drawn on the dark plot background
- **THEN** every colour outside the allow-list reaches 2 to 1
````

- [ ] **Step 6: Write `explore-ui-kit`**

Create `openspec/changes/explore-workbench/specs/explore-ui-kit/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: Menus, popovers and dialogs open in the top layer

Menus, popovers and tooltips SHALL open as popovers and dialogs as modal dialogs in the browser's
top layer, so no ancestor's overflow, transform or stacking can clip or cover them. A popover SHALL
sit next to its anchor and flip or shift to stay on screen, shrinking and scrolling when neither
side has room. A dialog SHALL be named by its heading, move focus inside on open, and return focus
to the control that opened it when it closes.

#### Scenario: A popover inside a clipping ancestor

- **WHEN** a popover opens from an anchor inside an ancestor with overflow hidden and a transform
- **THEN** the popover is fully visible

#### Scenario: A popover at the screen's corner

- **WHEN** a popover opens from an anchor at the bottom-right corner
- **THEN** it flips and shifts to stay on screen

#### Scenario: A dialog closes

- **WHEN** a modal dialog closes on Escape or its close button
- **THEN** focus returns to the control that opened it

### Requirement: Escape takes one step per press

Each Escape press SHALL do exactly one thing: close the topmost open layer (menu, popover, dialog,
pinned panel); with no layer open, hide the EAT connectors; then clear the selection; then return
the selection tool to Move and zoom. A handler of the page's own that handles Escape first SHALL
keep it from these steps.

#### Scenario: Escape after an EAT click

- **WHEN** an EAT click shows connectors and a selection, and the user presses Escape three times
- **THEN** the first press hides the connectors and keeps the selection, the second clears the
  selection, and the third returns to Move and zoom

#### Scenario: A layer is open

- **WHEN** a popover is open over a selection and the user presses Escape
- **THEN** only the popover closes

### Requirement: A press outside closes the topmost layer

A press that starts and ends outside the topmost layer SHALL close it; a drag that starts inside
and ends outside, or a press that starts outside and ends inside, SHALL NOT. Content inside the
layer's shadow roots or slotted into it SHALL count as inside.

#### Scenario: Press outside

- **WHEN** the user presses and releases outside an open popover
- **THEN** it closes

#### Scenario: Drag out of a layer

- **WHEN** the user starts a drag inside an open popover and releases outside it
- **THEN** it stays open

### Requirement: An icon-only button is named by its label

An icon-only button SHALL take its label as its accessible name and SHALL show the same label as a
tooltip on keyboard focus or after 500 ms of mouse hover, hidden again by Escape, by leaving, or by
a press; a touch SHALL NOT show it. Its icon SHALL be a decorative Lucide SVG. A toggle SHALL
report its state through `aria-pressed`, and a menu button its menu through `aria-haspopup` and
`aria-expanded`.

#### Scenario: Name and tooltip

- **WHEN** an icon-only button with the label "Legend settings" gets keyboard focus
- **THEN** its accessible name is "Legend settings" and the tooltip shows that text

#### Scenario: Hover

- **WHEN** the mouse rests on the button for 500 ms
- **THEN** the tooltip shows, and it hides when the pointer leaves

#### Scenario: Icons

- **WHEN** a kit icon renders
- **THEN** it is an inline Lucide SVG hidden from assistive technology, at the size asked for

### Requirement: One focus ring for keyboard focus

Every control SHALL show one keyboard focus ring in the focus colour, on the control and not a
second one inside it, only on keyboard focus (not on hover); under forced colours the ring and
focused fields SHALL use system colours.

#### Scenario: A focused field

- **WHEN** a text field takes keyboard focus
- **THEN** one ring is drawn around the field

#### Scenario: Hover is not focus

- **WHEN** the mouse hovers a menu item that does not have keyboard focus
- **THEN** no focus ring is drawn on it

### Requirement: Motion follows the user's setting

When the user asks for reduced motion, kit and explore transitions and animations SHALL stop, and
the actions they accompany SHALL still complete.

#### Scenario: Reduced motion

- **WHEN** the OS asks for reduced motion
- **THEN** legend rows change without transitions and the tour does not animate

### Requirement: Counts read in the right plural

Every count the explore page shows in words SHALL be grouped in the browser's number format and
use the singular for one and the plural otherwise.

#### Scenario: One and many

- **WHEN** 1 protein and then 1,234 proteins are selected
- **THEN** the selection reads "1 protein selected" and then "1,234 proteins selected"

### Requirement: A disabled choice says why

An option of a segmented control MAY be disabled with a reason. A disabled option SHALL be
`aria-disabled` and stay focusable, SHALL look faint (`GrayText` under forced colours), SHALL be
skipped by the arrow keys, and a press or tap on it SHALL show its reason and select nothing.

#### Scenario: Pressing a disabled option

- **WHEN** the user presses a disabled option
- **THEN** its reason shows, the value does not change and no change event fires

#### Scenario: Arrow keys

- **WHEN** the user moves through the options with the arrow keys
- **THEN** focus skips the disabled option
````

- [ ] **Step 7: Write `plot-proportions`**

Create `openspec/changes/explore-workbench/specs/plot-proportions/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: Both axes share one scale

The scatterplot SHALL draw a projection with one pixels-per-unit for x and y, so distances read
the same in every direction whatever the plot's shape. The data's extent, padded by 5 % of its
span on each side, SHALL be fitted inside the plot's margins and centred along the axis that has
room to spare; an axis whose span is zero SHALL take the full range of its side and stay finite.

#### Scenario: A wide plot

- **WHEN** the plot is wider than the padded data's aspect
- **THEN** y uses its full range, x is narrowed to the same pixels-per-unit and centred

#### Scenario: A tall plot

- **WHEN** the plot is taller than the padded data's aspect
- **THEN** x uses its full range, y is narrowed to the same pixels-per-unit and centred

#### Scenario: A flat projection

- **WHEN** every point has the same x
- **THEN** x takes its full range and every position stays finite

### Requirement: An export keeps the plot's proportions

A quick export or a figure SHALL fit the same padded extent with one scale for both axes, centred,
inside margins scaled from a fixed reference, so the exported figure has the live plot's shape at
the same aspect.

#### Scenario: Exporting at another size

- **WHEN** the plot is exported at a size other than the screen's
- **THEN** the export fits the padded extent with one scale, centred, at the live plot's aspect

### Requirement: A panel change resizes the plot once

Collapsing or expanding the sidebar, or committing a new sidebar width, SHALL resize the plot once
and render it once, with or without reduced motion. Moving the legend/structure divider, popping
the structure out or docking it, and switching the theme SHALL NOT resize the plot.

#### Scenario: Collapse and expand

- **WHEN** the user collapses the sidebar and expands it again
- **THEN** the plot widens by the sidebar's width with one render, and narrows back with one

#### Scenario: Reduced motion

- **WHEN** the OS asks for reduced motion and the user collapses and expands the sidebar
- **THEN** the plot still resizes once each time

#### Scenario: Floating the structure

- **WHEN** the user pops the structure out over the plot
- **THEN** the plot keeps its size

### Requirement: A resize keeps the viewed centre

When the plot changes size, the data point under the centre of the view SHALL stay under the
centre at the same zoom; a view that was not zoomed SHALL stay fitted.

#### Scenario: Zoomed in across a collapse

- **WHEN** the user zooms in on a protein at the view's centre, then collapses and expands the
  sidebar
- **THEN** the same protein stays at the centre

#### Scenario: Not zoomed

- **WHEN** the view is fitted and the plot resizes
- **THEN** the view stays fitted to the new size

### Requirement: A zoom inset shows exactly its region

A figure's zoom inset that names an explicit data region SHALL map that region to the inset's full
area, with no padding and no margins, and SHALL draw only the points inside it.

#### Scenario: An inset from a source rectangle

- **WHEN** the user adds a zoom inset for a rectangle of the plot in the figure editor
- **THEN** the inset shows that rectangle's points filling its area
````

- [ ] **Step 8: Run the spec checks**

These are the spec checks every spec task runs (Global Constraints, "Spec checks per spec task"), plus the evidence checker and the line-length check:

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" \
  | sed -n '/^{/,$p' \
  | jq -r '.deltas | group_by(.spec)[] | "\(.[0].spec) \(map(.operation) | group_by(.) | map("\(.[0])=\(length)") | join(","))"'
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "check-headers exit $?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py explore-workbench-layout explore-theming explore-ui-kit plot-proportions
grep -nE "control bar|Tips|⚡|\.ts\b|:[0-9]+\b" openspec/changes/explore-workbench/specs/*/spec.md
python3 -c "import glob; [print(f, i) for f in glob.glob('openspec/changes/explore-workbench/specs/*/spec.md') for i, l in enumerate(open(f, encoding='utf8'), 1) if len(l.rstrip('\n')) > 100]"
git status --short openspec
```

Expected:

- Prettier lists the four files, all `(unchanged)`.
- `Change 'explore-workbench' is valid`.
- `change show` (its first line, a deprecation warning, is dropped by the `sed`) lists exactly:

  ```text
  explore-theming ADDED=6
  explore-ui-kit ADDED=8
  explore-workbench-layout ADDED=8
  plot-proportions ADDED=5
  ```

- `check-headers exit 0` with no other output (new capabilities hold only ADDED).
- `evidence: 0 problem(s)`.
- The forbidden-words grep and the line-length check print nothing.
- `git status --short openspec` shows the four new `spec.md` files (`?? openspec/changes/explore-workbench/specs/`) and nothing else.

If `validate` reports `must contain SHALL or MUST` for a requirement, its first text line lacks the keyword: reflow so SHALL is on that line. If a check fails for another reason, fix the spec file, not the check.

- [ ] **Step 9: Run three cited tests**

One unit, one browser and one e2e test from the evidence map:

```bash
pnpm --filter @protspace/utils exec vitest --run src/visualization/scales.test.ts
pnpm --filter @protspace/core exec vitest --run --project browser src/components/kit/fields.browser.test.ts -t "disabled option"
PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-sidebar.spec.ts --project workbench -g "a corrupt or oversized stored layout loads safely"
```

The second and third need the sandbox disabled (the browser run starts a local server; the e2e builds the packages and serves on 8475). Expected: `scales.test.ts` 10 passed; the `fields.browser.test.ts` run passes every test whose name contains "disabled option" (the `ps-segmented` and coarse-pointer cases); the e2e: 1 passed. A failure here is a finding about HEAD, not about the spec: record it in the report and the ledger for the orchestrator (8.16's scope), and leave the spec as the code and the other tests say.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git add openspec/changes/explore-workbench/specs/explore-workbench-layout/spec.md \
  openspec/changes/explore-workbench/specs/explore-theming/spec.md \
  openspec/changes/explore-workbench/specs/explore-ui-kit/spec.md \
  openspec/changes/explore-workbench/specs/plot-proportions/spec.md
git commit -m "docs(openspec): specify the explore shell, theming, kit and proportions"
```

Commit with the sandbox disabled (the hook runs `pnpm precommit`, which builds the docs). `spec-evidence.md` and `check-evidence.py` are git-ignored and are not staged.

Report: Step 8's outputs (the `change show` listing, both exit codes), Step 9's three results, the commit hash, and any place where the code at HEAD made you change a requirement or an evidence line (each as a disagreement for 8.24).

### Task 8.21: Spec files for the workflow capabilities and the table export

Four new capabilities for the everyday tasks (legend, selection, import and export, help) and the one MODIFIED requirement of `table-export`, which now lives in the app bar's Export menu.

**Files:**

- Create: `openspec/changes/explore-workbench/specs/legend-panel/spec.md`, `…/selection-workflow/spec.md`, `…/explore-import-export/spec.md`, `…/explore-help/spec.md`, `…/table-export/spec.md`
- Modify: `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (five sections)

**Interfaces:**

- Consumes (sources): legend — `packages/core/src/components/legend/{legend,legend-row,legend-header,legend-list,legend-row-menu,legend-other-popover,legend-settings-popover,palette-swatches,legend-score-strips}.ts`, `controllers/*` (persistence key `protspace:legend:{datasetHash}:{annotation}`); selection — `packages/core/src/components/plot-tools/{plot-tools,selection-bar,plot-status}.ts` (chip texts "Filtered · N conditions", "Showing only N proteins · N steps", hidden categories), `apps/web/src/explore/{selection-controller,undo-controller,undo-history,status-controller,workbench-status,structure-controller,confirm-dialog,recovery-banner}.ts`; import/export — `packages/core/src/components/{import-menu,export-menu,publish}/`, `apps/web/src/explore/{import-controller,export-handler,loading-overlay}.ts` (`QUICK_EXPORTS`: Quick PNG, Quick PDF, Protein IDs (.txt), Table (.tsv), Data bundle (.parquetbundle); the note "Quick exports leave out contours."); help — `apps/web/src/workbench/{HelpMenu,ShortcutsDialog}.tsx`, `shortcuts.ts`, `help-actions.ts`, `apps/web/src/tour/{product-tour,tour-steps,storage-key}.ts` (`TOUR_STORAGE_KEY 'protspace:tour:v2'`, `LEGACY_TOUR_STORAGE_KEY 'driver.overviewTour'`); table — `openspec/specs/table-export/spec.md:63-78` (header `The web app exports the visible proteins as a table`, copied whole), `export-handler.ts` TSV path, `MoreSheet.tsx` Export row (opens `#myExportMenu`). Evidence: `workbench-legend.spec.ts`, `legend.*.test.ts`/`*.browser.test.ts`, `legend.persistence-compat.test.ts`, `workbench-selection.spec.ts`, `workbench-undo.spec.ts`, `workbench-feedback.spec.ts`, `plot-status.browser.test.ts`, `selection-bar.browser.test.ts`, `undo-history.test.ts`, `workbench-import-export.spec.ts` ("names its six exports"), `workbench-loading.spec.ts`, `figure-editor.spec.ts`, `export-handler.test.ts`, `export-menu.browser.test.ts`, `eat-visualization.spec.ts` (TSV "same set as the ID export"), `workbench-help.spec.ts`, `product-tour.spec.ts`, `shortcuts.test.ts`, `tour-steps.test.ts`, `storage-key.test.ts`.
- Consumes from Task 8.19: `check-headers.sh` (exit 0, no output, when clean; `WARN …` lines for a MODIFIED block with fewer scenarios than main).
- Consumes from Task 8.20: the four shell specs (ownership: the drop target, the empty state and where notifications sit are `explore-workbench-layout`'s; the Escape order, reduced motion and plural counts are `explore-ui-kit`'s; one render per panel change is `plot-proportions`'); `spec-evidence.md` (its header and line format: `- <Requirement> / <Scenario> → <test file>: "<test title>"`, refs joined by `; `, a further title of the same file as `; "<title>"`, trailing ` (<note>)` allowed, a templated title cited as it runs, `code: <file> <what>` for a named code path); `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (exit 0 when every scenario has a line and every cited title exists).
- Produces: four ADDED-only files (4–8 requirements each) and `table-export/spec.md` with `## MODIFIED Requirements` holding exactly `### Requirement: The web app exports the visible proteins as a table` (text names the app bar's Export menu and, on phones, the More sheet's Export; item "Table (.tsv)"; scenario "Filter and isolation" says "a filter query or Show only these"; scenario "Hidden legend category" word-for-word). Expected topics:
  - `legend-panel`: rows with truncation and full name on hover (28 px, 40 px on coarse pointers); row actions (eye, handle, ⋯ with Show only this / Colour and shape) and their keyboard equivalents; hidden rows stay, dimmed; header with display name, sort button showing the active order, settings; the searchable Other popover with Add to legend; the settings popover applies live, Reset restores defaults, stored per dataset and annotation under the existing key; score strips point at the cluster caveat (stats-auto-clustering).
  - `selection-workflow`: the tool strip with roving focus; the selection bar (count, Show only these, Zoom to them, Copy IDs, Clear) where Show only these isolates the selection (point-visibility); status chips that open their place and have ✕ (the filter chip's ✕ removes the filter); Ctrl/⌘Z and Shift redo outside text fields, the history cleared by a new dataset; Undo notifications for Reset filter and New figure, a confirmation before clearing stored data; choosing which selected protein the structure shows.
  - `explore-import-export`: Import and the dataset name open one menu (examples, Last file, Open a file… with formats; the FASTA upload note); the Export menu's items (named, in order) and its contours note; every export confirms with a notification naming the file; the figure editor is a modal dialog whose Close keeps its state and Escape closes it; the loading overlay says a local file is read in the browser, blocks Tab and returns focus, keeps `#progressive-loading`.
  - `explore-help`: the help menu (Documentation, Keyboard shortcuts, Take the tour), keyboard-navigable; the complete shortcut list; the full tour on a first visit, "What's new" once for holders of the legacy key; steps per layout, a step whose target is missing is dropped; focus returns to Help when the tour ends.

**Tests:** the spec checks; `check-headers.sh` exits 0 with no WARN for `table-export`; three cited tests run per the 8.20 rule; the same `grep` as 8.20 prints nothing; `grep -c "Table (.tsv)" openspec/changes/explore-workbench/specs/table-export/spec.md` ≥ 1 and the TSV rows rule appears in no other delta.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `openspec`, `prettier`, `python3`, the grep checks and the app's Vitest work inside the sandbox; the browser Vitest run, the e2e run and `git commit` need it disabled (Global Constraints, Environment).

The files below were written from the code and tests at `d071e1da`, never from `design.md`, by the rules Task 8.20 states: **the first line of each requirement's text contains SHALL** (`openspec validate --strict` reads only that line); every requirement has a `#### Scenario:`; no file path, line number, `:<digit>`, "Tips", "control bar" or "⚡". Where these capabilities touch behaviour another capability owns, they name it instead of restating it: Show only these isolates the selection (point-visibility); the score strips' caveat is stats-auto-clustering's; the table's rows rule is stated only in `table-export`, which `explore-import-export` merely lists as a menu item; the drop on the loading overlay and the notification's place belong to `explore-workbench-layout`, the undo blocked during a load to `selection-workflow`.

- [ ] **Step 1: See what is missing**

```bash
ls openspec/changes/explore-workbench/specs
grep -c "Table (.tsv)" openspec/changes/explore-workbench/specs/table-export/spec.md; echo "exit $?"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" \
  | sed -n '/^{/,$p' | jq -r '[.deltas[].spec] | unique | join(" ")'
```

Expected: `ls` lists only `explore-theming explore-ui-kit explore-workbench-layout plot-proportions`; `grep` fails with `No such file or directory` (`exit 2`); `change show` names the same four capabilities.

- [ ] **Step 2: Add the evidence map for the five capabilities first**

Append to `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (after Task 8.20's `## plot-proportions` section; keep one blank line between sections) exactly this text:

````markdown
## legend-panel

- Legend rows are compact and keep their full names / A long name at 240 px → legend.rows.browser.test.ts: "at 240 px a 70-character name stays on one line, ends in an ellipsis, and the count of 123,456 is fully visible"; workbench-legend.spec.ts: "a long name ends in an ellipsis and its full name is in the row's accessible name"; workbench-legend.spec.ts: "the legend fills the sidebar column flush, with no card border"
- Legend rows are compact and keep their full names / Hovering a truncated name → legend.rows.browser.test.ts: "hovering a truncated name shows its full text after 500 ms; a name that fits shows nothing"; legend.rows.browser.test.ts: "a 500 ms touch hold on a truncated name shows it, and the click that ends it does not toggle"; legend.rows.browser.test.ts: "moving 12 px first cancels it, and the tap toggles"
- Legend rows are compact and keep their full names / Coarse pointer → legend.rows.browser.test.ts: "under a coarse pointer rows are 40 px and the actions always show"; workbench-legend.spec.ts: "legend rows are 28 px with their actions hidden until hover"
- Each row has its own actions / Hiding a category → workbench-legend.spec.ts: "the eye hides a category and the row stays, dimmed"; legend.rows.browser.test.ts: "the actions are transparent at rest and opaque on hover and focus-within, and never move the label"
- Each row has its own actions / Show only this → workbench-legend.spec.ts: "Show only this from the ⋯ menu isolates the category"; legend.rows.browser.test.ts: "the ⋯ menu opens on its button, and Show only this isolates"
- Each row has its own actions / Dragging a row → legend.rows.browser.test.ts: "at 240 px the handle a hover reveals is under the pointer, and dragging it reorders the rows"; workbench-helpers.spec.ts: "dragLegendRow moves a row above another"
- Rows reorder from the keyboard / Moving a row → legend.keyboard-reorder.test.ts: "picks a row up with Space on its handle and announces it"; legend.keyboard-reorder.test.ts: "moves the picked row one place, switches to manual and fires one legend-zorder-change"; legend.keyboard-reorder.test.ts: "drops the row where it is on Enter and announces it"; legend.keyboard-reorder.test.ts: "ignores Space on the Other handle; N/A is picked up like any category"; legend.keyboard-reorder.test.ts: "moves focus between rows with the arrows, Home and End"
- Rows reorder from the keyboard / Cancelling → legend.keyboard-reorder.test.ts: "restores the order and the sort mode on Escape and announces it"; legend.keyboard-reorder.test.ts: "puts focus back on the picked row's handle after Escape"
- The legend header names the annotation and its sort / Picking By name → workbench-legend.spec.ts: "the header shows the display name and the active sort; picking By name reorders the list and stores it"; legend.sort-menu.browser.test.ts: "picking By name applies without Save, persists sortMode alpha-asc and runs one legendUpdate"; legend.sort-menu.browser.test.ts: "By separation appears only with scores or while active"; legend.header.test.ts: "with one row the sort button is hidden"
- The legend header names the annotation and its sort / The active sort → legend.header.test.ts: "the sort button is named Sort: {label}"; legend.header.test.ts: "the title is the display name, never the key"; legend.sort-menu.browser.test.ts: "at 240 px the title truncates and the sort and settings buttons stay fully visible"
- Categories under Other can be brought back / Searching and adding → workbench-legend.spec.ts: "View opens Other; a search and Add to legend bring a category back"; legend-other-popover.browser.test.ts: "lists items by count, largest first, then by name"; legend-other-popover.browser.test.ts: "search filters case-insensitively on display names, N/A included"; legend.other.browser.test.ts: "Add all closes it"
- Categories under Other can be brought back / Closing → legend-other-popover.browser.test.ts: "Escape and an outside press close it and return focus to View"; legend-other-popover.browser.test.ts: "the panel is a dialog named Other categories and the search field has focus on open"
- Legend settings apply live and are stored per dataset and annotation / A palette pick → legend.settings.browser.test.ts: "a palette pick recolours the rows, is stored at once and runs one legendUpdate"; legend-settings-popover.browser.test.ts: "there is no Save or Cancel and no title attribute"; legend-settings-popover.browser.test.ts: "typing 2 then 5 fires one settings-change {maxVisibleValues: 25} after 300 ms"
- Legend settings apply live and are stored per dataset and annotation / Reset → legend.settings.browser.test.ts: "Reset keeps the popover open with the defaults and focuses the checked swatch"
- Legend settings apply live and are stored per dataset and annotation / Reload → workbench-legend.spec.ts: "settings and the sort apply live and survive a reload under the same protspace:legend: key"
- Legend settings apply live and are stored per dataset and annotation / Records stored by earlier versions → legend.persistence-compat.test.ts: "reads a record written before phase 3 unchanged"; legend.persistence-compat.test.ts: "writes the same key and field set"; legend.persistence-compat.test.ts: "a live edit keeps every field it did not touch"
- Score strips stay beside the rows / Hovering a scored row → legend.score-strips.test.ts: "fills both strips’ value gutters when a legend row is hovered"; legend.score-strips.test.ts: "a touch pointerenter on a row fills no strip gutter"; legend.score-strips.test.ts: "caveats the strips for an auto-clustering, and only for one"

## selection-workflow

- A tool strip picks how the plot is selected / Box select → workbench-selection.spec.ts: "Box select selects by dragging; Escape clears, then returns to Move"; workbench-selection.spec.ts: "the tool strip sits in the plot's top-left with its tools named"; plot-tools.browser.test.ts: "with selection disabled, Box and Lasso are disabled"
- A tool strip picks how the plot is selected / Keyboard → plot-tools.browser.test.ts: "the toolbar is one Tab stop: the current tool; arrows still reach Fit"; plot-tools.browser.test.ts: "under a coarse pointer the tool buttons are 40 px"
- The selection bar acts on the selected proteins / Showing the bar → workbench-selection.spec.ts: "a box selection shows the bar with its count; Clear empties it and focus stays on the tool strip"; selection-bar.browser.test.ts: "the count is announced from a live region that stays rendered while hidden"; selection-bar.browser.test.ts: "toolbar named Selection with the four buttons"
- The selection bar acts on the selected proteins / Show only these → workbench-selection.spec.ts: "Show only these isolates and the bar hides"; selection-bar.browser.test.ts: "Show only these is disabled when canIsolate is false"
- The selection bar acts on the selected proteins / Copy IDs → workbench-selection.spec.ts: "Copy IDs writes the ids to the clipboard and says so"
- The selection bar acts on the selected proteins / Clear → workbench-selection.spec.ts: "a box selection shows the bar with its count; Clear empties it and focus stays on the tool strip"; workbench-selection.spec.ts: "Zoom to them changes the plot's transform"
- Status chips show what narrows the view / Applying a filter → workbench-selection.spec.ts: "applying a filter shows 'Filtered · 1 condition'; the chip opens the filter; its ✕ removes the filter"; plot-status.browser.test.ts: "chips render in the order filter, isolation, hidden"; plot-status.browser.test.ts: "each ✕ has its own accessible name and fires status-clear with its kind"
- Status chips show what narrows the view / Show only these → workbench-selection.spec.ts: "Show only these shows the isolation chip with its size and 1 step; its ✕ returns the full view"; plot-status.browser.test.ts: "count text groups and pluralises; Zoomed in appended"; workbench-selection.spec.ts: "the status corner shows the protein count; the plot draws none of its own"
- Status chips show what narrows the view / Hiding a category → workbench-selection.spec.ts: "hiding a legend category shows '1 category hidden'; its ✕ shows it again"; plot-status.browser.test.ts: "removing a focused chip moves focus to the next chip, else the count"
- Undo and redo step through selection changes / Undo and redo a box selection → workbench-undo.spec.ts: "box select → Ctrl+Z empties → Ctrl+Shift+Z restores"; undo-controller.test.ts: "Mod is ⌘ on Mac and Ctrl elsewhere"; undo-history.test.ts: "the 101st entry drops the oldest"; undo-history.test.ts: "entries past 2M ids drop the oldest"
- Undo and redo step through selection changes / Undo Show only these → workbench-undo.spec.ts: "Show only these → Ctrl+Z returns the full view and the selection"; workbench-undo.spec.ts: "filter Apply → Ctrl+Z removes it and the chip goes; redo brings it back"
- Undo and redo step through selection changes / In the search box → workbench-undo.spec.ts: "Ctrl+Z in the search box is left to the browser and leaves the selection"; undo-controller.test.ts: "an open dialog blocks it"; workbench-loading.spec.ts: "Ctrl+Z during a load changes nothing"
- Undo and redo step through selection changes / A new dataset → workbench-undo.spec.ts: "a new dataset clears the history"
- Undoable resets offer an Undo / Reset in the Filter panel → workbench-feedback.spec.ts: "Reset in the Filter panel shows Filter removed; Undo restores the chip and its count"
- Undoable resets offer an Undo / A newer step → workbench-feedback.spec.ts: "a newer step dismisses the stale Undo toast"
- Undoable resets offer an Undo / New figure → publish-modal.browser.test.ts: "New figure, then Undo, restores overlays and insets"; publish-modal.browser.test.ts: "Reset, then Undo, restores the state"
- Clearing stored data asks first / Confirming → workbench-feedback.spec.ts: "Clear stored data opens the confirmation; Cancel keeps the banner; Clear data clears it and loads the default"
- Clearing stored data asks first / Cancelling → workbench-feedback.spec.ts: "Clear stored data opens the confirmation; Cancel keeps the banner; Clear data clears it and loads the default"
- The user picks which selected protein the structure shows / Several proteins selected → workbench-structure.spec.ts: "a box selection of several proteins lets the header pick which one shows"

## explore-import-export

- Import and the dataset name open one Import panel / The dataset name → workbench-import-export.spec.ts: "the dataset name opens the Import panel and an example switches the dataset"; import-menu.browser.test.ts: "toggleFrom(datasetButton) anchors the panel to it, sets aria-expanded on it only and returns focus to it on Escape"; import-menu.browser.test.ts: "lists the examples with the Large badge; the current one is disabled with a check and keeps its ⓘ"
- Import and the dataset name open one Import panel / Last file → workbench-import-export.spec.ts: "after a user import then an example, Last file reopens the import"; import-menu.browser.test.ts: "the Last file row shows only with lastFile and fires open-last-file"
- Import and the dataset name open one Import panel / Open a file → import-menu.browser.test.ts: "Open a file… closes the panel, then dispatches open-file-dialog"; workbench-import-export.spec.ts: "Open a file… opens the file chooser"; import-menu.browser.test.ts: "the panel is a dialog named Import with the FASTA note, and opening focuses Open a file…"; import-menu.browser.test.ts: "ArrowDown and ArrowUp move between the actions and skip the disabled example"
- The Export menu lists every export / The items → workbench-import-export.spec.ts: "the menu names its six exports and the contours note"; export-menu.browser.test.ts: "Quick PNG and Quick PDF are described by the contours note"; export-menu.browser.test.ts: "the checkbox keeps the menu open and travels as includeLegendSettings"; export-menu.browser.test.ts: "each quick item dispatches export with its type and the EXPORT_DEFAULTS sizes, and closes the menu"
- The Export menu lists every export / Figure editor → export-menu.browser.test.ts: "Figure editor… fires open-publish-editor and no export"; workbench-import-export.spec.ts: "the figure editor opens from Export"
- Every export says it is done / Quick PNG → workbench-import-export.spec.ts: "Quick PNG downloads a file and shows Export ready."; export-handler.test.ts: "each quick export type toasts with the returned file name"; export-handler.test.ts: "the bundle toasts its file name and the unplaced count"
- Every export says it is done / Protein IDs → workbench-import-export.spec.ts: "Protein IDs downloads a .txt"
- Every export says it is done / A failed export → export-handler.test.ts: "a throw toasts the failure"; export-handler.publish.test.ts: "a publish-export failure calls showExportError and does not toast"
- The figure editor is a modal dialog that keeps its work / Escape → publish-modal.browser.test.ts: "Escape with an item selected deselects it and keeps the dialog open; a second Escape closes it and fires close with the state"; workbench-escape.spec.ts: "in the figure editor, Escape never clears the plot’s selection"; publish-modal.browser.test.ts: "a press on the backdrop does not close it"
- The figure editor is a modal dialog that keeps its work / Closing keeps the figure → publish-modal.browser.test.ts: "focus returns to the opener from the footer Close and from the dialog ✕"; publish-state-store.test.ts: "round-trips a state under protspace_publishState"; code: export-handler.ts openPublishEditor hands the editor loadPublishState() and its close listener stores the state with savePublishState
- The loading overlay says what is happening / A local file → workbench-loading.spec.ts: "importing a local bundle says it is read in the browser and never mentions an upload"; loading-overlay.test.ts: "the copy picks the source kind"
- The loading overlay says what is happening / Tab during a load → workbench-loading.spec.ts: "the overlay blocks Tab from reaching the app bar"
- The loading overlay says what is happening / Focus after a load → workbench-loading.spec.ts: "focus comes back to the app bar after a load, not to the page"

## explore-help

- A Help menu in the app bar / Keyboard → workbench-help.spec.ts: "Help opens a keyboard-navigable menu and Escape returns focus to Help"; workbench-help.spec.ts: "the plot has no tips button"
- A Help menu in the app bar / Documentation → workbench-help.spec.ts: "Documentation opens the docs in a new tab"
- The keyboard shortcuts are listed in one place / Opening the list → workbench-help.spec.ts: "Keyboard shortcuts opens a dialog listing the search shortcut; Escape closes it and returns focus to Help"; workbench-help.spec.ts: "Keyboard shortcuts opens from the keyboard with focus inside the dialog"; shortcuts.test.ts: "every group has a title and at least one shortcut"; shortcuts.test.ts: "lists the Escape steps in the order one press at a time takes them"; shortcuts.test.ts: "the History group lists undo and redo"; shortcuts.test.ts: "the legend group lists I"; shortcuts.test.ts: "the Figure editor group lists Delete, then Escape that deselects before it closes"
- The keyboard shortcuts are listed in one place / The platform's modifier → shortcuts.test.ts: "formats Mod as ⌘ on Mac and Ctrl elsewhere"
- The tour runs once, in the version the visitor needs / First visit → product-tour.spec.ts: "auto-starts on the first visit with the full tour"; storage-key.test.ts: "gives a first visit the full tour"; product-tour.test.ts: "writes the kind it starts under the tour key"
- The tour runs once, in the version the visitor needs / Returning visitor → product-tour.spec.ts: "a returning visitor gets it once, each step on its control"; product-tour.spec.ts: "Full tour switches to the full tour"; storage-key.test.ts: "gives a visitor who saw the old tour What's new"
- The tour runs once, in the version the visitor needs / Tour recorded → product-tour.spec.ts: "nothing starts"; product-tour.spec.ts: "nothing starts, even with the old key there too"; product-tour.test.ts: "starts nothing and throws nothing when storage is blocked"
- The tour runs once, in the version the visitor needs / From the Help menu → product-tour.spec.ts: "Help → Take the tour starts it again"; workbench-help.spec.ts: "Take the tour starts the tour"
- Each step points at a control the layout shows / On a tablet → product-tour.spec.ts: "every step points at a control on screen, with no Sidebar step"; tour-steps.test.ts: "talks touch on a coarse pointer, tablet included"; tour-steps.test.ts: "spotlights Help on the first step on desktop and tablet, More on a phone"
- Each step points at a control the layout shows / A missing target → product-tour.test.ts: "drops a step whose target is missing or has no box"
- Each step points at a control the layout shows / A collapsed sidebar → product-tour.spec.ts: "starting the tour opens a collapsed sidebar"; product-tour.spec.ts: "with the Filter panel open, Take the tour shows the legend"
- Ending the tour gives the page back / Focus after the tour → product-tour.spec.ts: "focus goes back to Help when the tour ends"; product-tour.test.ts: "gives each target back its own aria state when the tour ends"
- Ending the tour gives the page back / Escape during the tour → product-tour.spec.ts: "Escape during a tour started from Help keeps the selection"

## table-export

- The web app exports the visible proteins as a table / Hidden legend category → export-utils.test.ts: "excludes proteins matching a hidden regular value"; eat-visualization.spec.ts: "exports the visible proteins as a table, the same set as the ID export"; workbench-import-export.spec.ts: "the menu names its six exports and the contours note"; mobile-bars.spec.ts: "C4: Export in the sheet opens the Export menu, which an outside tap closes"
- The web app exports the visible proteins as a table / Filter and isolation → eat-visualization.spec.ts: "exports the visible proteins as a table, the same set as the ID export"; code: export-utils.ts visibleProteinIndices starts from the plot's current data, which the filter and Show only these have already narrowed, for the ID and the table export alike
````

Then:

```bash
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py legend-panel selection-workflow explore-import-export explore-help table-export; echo "exit $?"
```

Expected: five lines `<cap>: no spec file openspec/changes/explore-workbench/specs/<cap>/spec.md`, `evidence: 5 problem(s)`, `exit 1`, and no `title not in …` line. If a `title not in …` line appears (a test renamed after `d071e1da`), find the current title with `grep -n "<part of it>" <file>` and fix the evidence line; if the test is gone or now asserts something else, change the scenario in Steps 3–8 to what the code does and name it in the report as a disagreement for 8.24.

- [ ] **Step 3: Check the main requirement `table-export` modifies**

```bash
grep -n "^### Requirement: The web app exports the visible proteins as a table$" openspec/specs/table-export/spec.md
sed -n '/^### Requirement: The web app exports the visible proteins as a table$/,/^### Requirement: The web table holds/p' \
  openspec/specs/table-export/spec.md | grep -c "^#### Scenario:"
```

Expected: one line (line 63 at `d071e1da`; the number may move, the text must not), and `2`: the block has exactly the scenarios "Hidden legend category" and "Filter and isolation". If `main` changed this requirement since (the header differs or a third scenario exists), copy the current main block whole into Step 8's file instead and apply the same two edits (the text's first sentence; "isolation" → "Show only these" in the scenario's WHEN line); report it.

- [ ] **Step 4: Write `legend-panel`**

Create `openspec/changes/explore-workbench/specs/legend-panel/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: Legend rows are compact and keep their full names

Each legend row SHALL be 28 px tall (40 px under a coarse pointer) and show its symbol, its name
on one line and its count, which stays fully visible. A name too long for the row SHALL end in an
ellipsis; the row's accessible name SHALL hold the full name, and the full name SHALL show after
500 ms of mouse hover or a 500 ms touch hold on the truncated name (a hold that moves 12 px first
is a tap). The legend SHALL fill the sidebar's column flush, without a card border.

#### Scenario: A long name at 240 px

- **WHEN** the sidebar is 240 px wide and a category's name has 70 characters
- **THEN** the name stays on one line and ends in an ellipsis, and its count is fully visible
- **AND** the row's accessible name holds the full name

#### Scenario: Hovering a truncated name

- **WHEN** the mouse rests on a truncated name for 500 ms
- **THEN** its full text shows; a name that fits shows nothing

#### Scenario: Coarse pointer

- **WHEN** the primary pointer is coarse
- **THEN** rows are 40 px tall and their actions always show

### Requirement: Each row has its own actions

Under a fine pointer a row's actions SHALL be hidden until the row is hovered or holds focus, and
SHALL never move its label. The actions SHALL be an eye that hides or shows the category (named
"Hide {name}" or "Show {name}"), a handle to drag the row, and a ⋯ menu with Show only this (Show
all when the row is the only one shown) and Colour and shape. A hidden category's row SHALL stay in
the list, dimmed, with ", hidden" at the end of its accessible name.

#### Scenario: Hiding a category

- **WHEN** the user presses a row's eye
- **THEN** the category is hidden on the plot, its row stays in the list dimmed, and its
  accessible name ends in ", hidden"

#### Scenario: Show only this

- **WHEN** the user picks Show only this from a row's ⋯ menu
- **THEN** that category is the only one visible

#### Scenario: Dragging a row

- **WHEN** the user drags a row by its handle above another row
- **THEN** the rows reorder

### Requirement: Rows reorder from the keyboard

Space on a row's handle SHALL pick the row up and announce it; the arrow keys SHALL move it one
place at a time, switching the sort to Your order; Enter SHALL drop it where it is; Escape SHALL
put back the order and the sort mode it had and return focus to the handle. Each step SHALL be
announced. The Other row SHALL NOT be picked up; N/A SHALL be picked up like any category. Without
a picked row, the arrow keys, Home and End SHALL move focus between rows.

#### Scenario: Moving a row

- **WHEN** the user presses Space on a handle, then ArrowDown, then Enter
- **THEN** the row moves one place down, the sort becomes Your order and the drop is announced

#### Scenario: Cancelling

- **WHEN** the user picks a row up, moves it, and presses Escape
- **THEN** the order and the sort mode are restored and focus is on the row's handle

### Requirement: The legend header names the annotation and its sort

The header SHALL show the annotation's display name, never its key, then a sort button named
"Sort: {order}" and a Legend settings button. The sort menu SHALL offer By count, By name (By
value for a numeric annotation), Your order, By separation (only when the projection has scores or
while it is the active order) and Reverse order. A pick SHALL apply at once, without a Save step,
and be stored. With one row the sort button SHALL be hidden. At 240 px the title SHALL truncate and
both buttons stay fully visible.

#### Scenario: Picking By name

- **WHEN** the annotation Order is shown and the user picks By name
- **THEN** the header reads "Order", the rows are sorted by name and the order is stored

#### Scenario: The active sort

- **WHEN** an annotation is shown with its default order
- **THEN** the sort button is named "Sort: By count, largest first"

### Requirement: Categories under Other can be brought back

When the legend groups categories under Other, the Other row's View button SHALL open a dialog
named "Other categories" with focus in its search field, listing those categories by count,
largest first, then by name. The search SHALL filter by display name, N/A included. Each row's Add
to legend button (named with its category) SHALL move that category into the legend and keep the
dialog open with focus on the next row's button; Add all SHALL add every one and close it. Escape
or a press outside SHALL close it and return focus to View.

#### Scenario: Searching and adding

- **WHEN** the user opens Other, types part of a name and presses Add to legend on the match
- **THEN** that category gets its own legend row and the dialog stays open

#### Scenario: Closing

- **WHEN** the dialog is open and the user presses Escape
- **THEN** it closes and focus returns to View

### Requirement: Legend settings apply live and are stored per dataset and annotation

Legend settings SHALL open in a popover named "Legend settings: {annotation}" under the settings
button, with the palettes as a radio group named Palette, Max legend items and, for a numeric
annotation, its bins and bin distribution. Every change SHALL apply at once, with no
Save or Cancel; typed numbers SHALL apply after a short pause or on Enter. Reset SHALL restore the
defaults and keep the popover open. Settings and the sort SHALL be stored under the localStorage
key `protspace:legend:{datasetHash}:{annotation}` with the field set earlier versions wrote, and
SHALL survive a reload.

#### Scenario: A palette pick

- **WHEN** the user picks a palette
- **THEN** the rows recolour at once and the choice is stored

#### Scenario: Reset

- **WHEN** the user presses Reset
- **THEN** the defaults apply and the popover stays open

#### Scenario: Reload

- **WHEN** the user changes Max legend items and the palette, then reloads
- **THEN** both are kept, under the same `protspace:legend:` key

#### Scenario: Records stored by earlier versions

- **WHEN** a legend record written by an earlier version is loaded
- **THEN** it is read unchanged and written back with the same key and fields

### Requirement: Score strips stay beside the rows

When the projection has separation scores, the legend SHALL show the score strips beside its rows,
with the cluster caveat (stats-auto-clustering) where it applies, and hovering a row with a mouse
SHALL mark that row's values on both strips; a touch SHALL NOT.

#### Scenario: Hovering a scored row

- **WHEN** the mouse hovers a legend row of a scored annotation
- **THEN** both strips mark that row's values
````

- [ ] **Step 5: Write `selection-workflow`**

Create `openspec/changes/explore-workbench/specs/selection-workflow/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: A tool strip picks how the plot is selected

The plot's top-left corner SHALL hold a tool strip with Move and zoom, Box select, Lasso select
and Fit to view, each named for assistive technology, the current tool pressed. The strip SHALL be
one Tab stop (the current tool) whose arrow keys move between the tools, Fit to view included.
Box select and Lasso select SHALL be disabled while selection is unavailable. Under a coarse
pointer the tool buttons SHALL be 40 px.

#### Scenario: Box select

- **WHEN** the user chooses Box select and drags over the plot
- **THEN** the proteins inside the box are selected

#### Scenario: Keyboard

- **WHEN** the current tool has focus and the user presses the arrow keys
- **THEN** focus moves between the tools and reaches Fit to view

### Requirement: The selection bar acts on the selected proteins

While proteins are selected, a toolbar named Selection SHALL show at the bottom centre of the plot
with the count ("1 protein selected", "1,234 proteins selected", announced from a live region)
and the actions Show only these, Zoom to them, Copy IDs and Clear, which form one Tab stop moved by
the arrow keys. Show only these SHALL isolate the selection (point-visibility) and hide the bar,
and SHALL be disabled when the selection cannot be isolated. Zoom to them SHALL zoom the plot onto
the selection. Copy IDs SHALL write the ids, one per line, to the clipboard and say "Copied N
protein IDs". Clear SHALL empty the selection, and focus SHALL stay on the tool strip rather than
fall to the page.

#### Scenario: Showing the bar

- **WHEN** the user box-selects several proteins
- **THEN** the selection bar shows their count

#### Scenario: Show only these

- **WHEN** the user presses Show only these
- **THEN** only the selected proteins remain on the plot and the bar hides

#### Scenario: Copy IDs

- **WHEN** two proteins are selected and the user presses Copy IDs
- **THEN** the clipboard holds their two ids and "Copied 2 protein IDs" shows

#### Scenario: Clear

- **WHEN** the user presses Clear
- **THEN** the selection is empty and focus is on the tool strip

### Requirement: Status chips show what narrows the view

The plot's bottom-left corner SHALL show the protein count (with " · Zoomed in" while zoomed, as a
`role="status"` region) and, in this order, a chip for each active narrowing: "Filtered · N
conditions", "Showing only N proteins · N steps" and "N categories hidden", each plural-aware. The
filter and hidden-categories chips SHALL open where they are changed (the Filter panel; the
legend); every chip SHALL have its own ✕ with its own accessible name that undoes what it shows:
the filter chip's ✕ removes the filter, the isolation chip's ✕ returns the full view, and the
hidden chip's ✕ shows the hidden categories. Removing a focused chip SHALL move focus to the next
chip, else to the count. The plot SHALL draw no count of its own.

#### Scenario: Applying a filter

- **WHEN** the user applies a filter with one condition
- **THEN** a chip reads "Filtered · 1 condition", pressing it opens the filter, and its ✕
  removes the filter

#### Scenario: Show only these

- **WHEN** the user isolates a selection
- **THEN** a chip reads "Showing only N proteins · 1 step", and its ✕ returns the full view

#### Scenario: Hiding a category

- **WHEN** the user hides one legend category
- **THEN** a chip reads "1 category hidden", and its ✕ shows it again

### Requirement: Undo and redo step through selection changes

Mod+Z (⌘ on Apple platforms, Ctrl elsewhere) SHALL undo the last selection step (a selection, Show
only these, a filter applied or removed) and Mod+Shift+Z SHALL redo it. Neither SHALL act while
focus is in a text field (the browser's own undo applies there), while a dialog is open, or while
a dataset loads. A new step SHALL clear what could be redone; the history SHALL keep the newest
100 steps and drop the oldest past a total of 2,000,000 ids, and loading another dataset SHALL
clear it.

#### Scenario: Undo and redo a box selection

- **WHEN** the user box-selects, presses Ctrl+Z, then Ctrl+Shift+Z
- **THEN** the selection empties, then comes back

#### Scenario: Undo Show only these

- **WHEN** the user isolates a selection and presses Ctrl+Z
- **THEN** the full view and the selection return

#### Scenario: In the search box

- **WHEN** focus is in the search box and the user presses Ctrl+Z
- **THEN** the selection is unchanged

#### Scenario: A new dataset

- **WHEN** another dataset loads
- **THEN** nothing can be undone

### Requirement: Undoable resets offer an Undo

Removing the filter with Reset in the Filter panel or with the filter chip's ✕ SHALL show a "Filter
removed" notification with an Undo button that restores the filter, its chip and its count; a
newer step SHALL dismiss that notification. In the figure editor, New figure and Reset SHALL offer
Undo, which brings the previous figure back.

#### Scenario: Reset in the Filter panel

- **WHEN** the user resets an applied filter and presses Undo in the notification
- **THEN** the filter, its chip and its count come back

#### Scenario: A newer step

- **WHEN** a "Filter removed" notification shows and the user makes another selection change
- **THEN** the notification goes

#### Scenario: New figure

- **WHEN** the user presses New figure in the figure editor and then Undo
- **THEN** the overlays and insets come back

### Requirement: Clearing stored data asks first

The recovery banner's Clear stored data SHALL open a dialog named "Clear stored data?" whose Cancel
has focus and keeps the banner; only its Clear data SHALL clear the stored data and load the
default dataset.

#### Scenario: Confirming

- **WHEN** the user presses Clear stored data, then Clear data
- **THEN** the stored data is cleared and the default dataset loads

#### Scenario: Cancelling

- **WHEN** the user presses Clear stored data, then Cancel
- **THEN** the banner stays and nothing is cleared

### Requirement: The user picks which selected protein the structure shows

When several proteins are selected, the structure viewer's header SHALL show a "Structure protein"
button whose menu lists the selected proteins with the shown one checked; picking another SHALL
show its structure and keep the selection.

#### Scenario: Several proteins selected

- **WHEN** the user box-selects several proteins and picks another one from the structure's header
- **THEN** the structure of that protein shows and the selection is unchanged
````

- [ ] **Step 6: Write `explore-import-export`**

Create `openspec/changes/explore-workbench/specs/explore-import-export/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: Import and the dataset name open one Import panel

The app bar's Import button and the dataset name SHALL open the same Import panel, a dialog named
Import, under whichever was pressed, with focus on its first action. The panel SHALL offer Open a
file…, which opens the file chooser; Last file, only while a file the user imported is stored in
the browser, which reopens it; and the example datasets, the current one disabled with a check.
It SHALL say which files are read in the browser and which are sent to the server
(".parquetbundle files are read in your browser. FASTA files (.fasta, .fa, .fna) are sent to the
server for embedding."). The arrow keys SHALL move between its actions, skipping the disabled
example; Escape, a press outside or Tab out of it SHALL close it, Escape returning focus to the
button that opened it.

#### Scenario: The dataset name

- **WHEN** the user presses the dataset name and picks an example
- **THEN** the Import panel opens under the name and the example replaces the dataset

#### Scenario: Last file

- **WHEN** the user imported a file, then loaded an example, and opens Import
- **THEN** Last file is offered and reopens the imported file

#### Scenario: Open a file

- **WHEN** the user picks Open a file…
- **THEN** the panel closes and the file chooser opens

### Requirement: The Export menu lists every export

The app bar's Export button SHALL open a menu named Export with, in this order: Figure editor…,
Quick PNG, Quick PDF, Protein IDs (.txt), Table (.tsv) and Data bundle (.parquetbundle), then an
Include legend settings checkbox, checked by default and again for each new dataset, that applies
to the data bundle and keeps the menu open, and the note "Quick exports leave out contours.",
which describes Quick PNG and Quick PDF. A quick item SHALL close the menu and export at once at
the default sizes; Escape SHALL close the menu and return focus to its button.

#### Scenario: The items

- **WHEN** the user opens Export
- **THEN** it names the six exports in order, the checked Include legend settings and the contours
  note

#### Scenario: Figure editor

- **WHEN** the user picks Figure editor…
- **THEN** the figure editor opens and nothing is exported

### Requirement: Every export says it is done

A finished export SHALL show the notification "Export ready." naming the file it wrote; a data
bundle that leaves out proteins the loaded file holds SHALL also say how many and that `protspace
convert` keeps them. An export that fails SHALL say so in a notification, or, for the figure
editor, inside the editor, which stays open.

#### Scenario: Quick PNG

- **WHEN** the user picks Quick PNG
- **THEN** a PNG downloads and "Export ready." shows with its file name

#### Scenario: Protein IDs

- **WHEN** the user picks Protein IDs (.txt)
- **THEN** a .txt file downloads

#### Scenario: A failed export

- **WHEN** an export fails
- **THEN** a notification says it failed

### Requirement: The figure editor is a modal dialog that keeps its work

The figure editor SHALL open as a modal dialog named Figure editor that a press on the backdrop
does not close. Escape SHALL first deselect a selected item, then close the editor; it SHALL never
clear the plot's selection. Closing it by Escape, its Close button or its ✕ SHALL keep its state
under the localStorage key `protspace_publishState` for the next opening and SHALL return focus to
the control that opened it.

#### Scenario: Escape

- **WHEN** an item is selected in the figure editor and the user presses Escape twice
- **THEN** the first press deselects it, the second closes the editor, and the plot's selection
  stays

#### Scenario: Closing keeps the figure

- **WHEN** the user closes the figure editor
- **THEN** its state is kept for the next opening and focus returns to the control that opened it

### Requirement: The loading overlay says what is happening

While a dataset loads, the overlay `#progressive-loading` SHALL cover the workbench and say what
it is doing: a local file is "Reading your file in the browser" and "Reading {name}…", never an
upload; an example is "Opening {label}"; a stored file is reopened "from this browser". While it
shows, Tab SHALL NOT reach the workbench. When the load ends, focus SHALL return to the control
that started it, not to the page.

#### Scenario: A local file

- **WHEN** the user imports a local bundle
- **THEN** the overlay says the file is read in the browser and never mentions an upload

#### Scenario: Tab during a load

- **WHEN** a load is under way and the user presses Tab
- **THEN** focus does not reach the app bar

#### Scenario: Focus after a load

- **WHEN** the user starts loading an example from the dataset name and it finishes
- **THEN** focus is on the dataset name
````

- [ ] **Step 7: Write `explore-help`**

Create `openspec/changes/explore-workbench/specs/explore-help/spec.md` with exactly this content:

````markdown
## ADDED Requirements

### Requirement: A Help menu in the app bar

The app bar SHALL hold a Help button that opens a menu with Documentation, Keyboard shortcuts and
Take the tour, moved through with the arrow keys; Escape SHALL close it and return focus to Help.
Documentation SHALL open the docs in a new tab that cannot reach back into the explore page. The
plot SHALL carry no help button of its own.

#### Scenario: Keyboard

- **WHEN** the user opens Help and presses the arrow keys, then Escape
- **THEN** focus moves through the three items, the menu closes and focus is on Help

#### Scenario: Documentation

- **WHEN** the user picks Documentation
- **THEN** the docs open in a new tab with no access to the explore page

### Requirement: The keyboard shortcuts are listed in one place

Keyboard shortcuts SHALL open a dialog, with focus inside, listing every keyboard and pointer
shortcut of the explore page in titled groups, Mod written as ⌘ on Apple platforms and Ctrl
elsewhere. The list SHALL name the search shortcut, the legend's I, undo and redo under History,
the figure editor's Delete and its Escape that deselects before it closes, and the Escape steps in
the order one press at a time takes them. Escape SHALL close the dialog and return focus to Help.

#### Scenario: Opening the list

- **WHEN** the user picks Keyboard shortcuts
- **THEN** a dialog lists the shortcuts, the search shortcut among them
- **AND** Escape closes it and focus returns to Help

#### Scenario: The platform's modifier

- **WHEN** the list is shown on a Mac and elsewhere
- **THEN** Mod reads ⌘ on the Mac and Ctrl elsewhere

### Requirement: The tour runs once, in the version the visitor needs

On a visit with no tour recorded the full product tour SHALL start by itself; a visitor whose
browser holds the earlier tour's key `driver.overviewTour` set to `true` SHALL get the shorter
"What's new" tour instead, with a Full tour button that switches to the full tour. Starting a tour
SHALL record its kind under the localStorage key `protspace:tour:v2`, after which no tour starts by
itself; the earlier key SHALL be read, never written or removed. If storage is blocked, no tour
SHALL start by itself. Take the tour SHALL start the full tour at any time.

#### Scenario: First visit

- **WHEN** a visitor with no tour recorded opens /explore
- **THEN** the full tour starts

#### Scenario: Returning visitor

- **WHEN** a visitor who saw the earlier tour opens /explore
- **THEN** What's new runs once, each step on its control

#### Scenario: Tour recorded

- **WHEN** a tour is already recorded, with or without the earlier key
- **THEN** no tour starts

#### Scenario: From the Help menu

- **WHEN** the user picks Take the tour
- **THEN** the full tour starts again

### Requirement: Each step points at a control the layout shows

The tour SHALL pick its steps for the layout: every step SHALL point at a control on screen, a
step whose target is missing or has no box SHALL be dropped, and the steps SHALL speak of touch
under a coarse pointer and of the mouse under a fine one, writing the modifier as the keyboard
shows it. The first step SHALL spotlight Help (More on a phone). Starting the tour SHALL open a
collapsed sidebar on the legend, unfolded, and show the legend if the Filter panel was open.

#### Scenario: On a tablet

- **WHEN** the tour runs on a tablet
- **THEN** every step points at a control on screen and there is no Sidebar step

#### Scenario: A missing target

- **WHEN** a step's target is not on the page
- **THEN** the tour skips that step

#### Scenario: A collapsed sidebar

- **WHEN** the sidebar is collapsed and the user starts the tour
- **THEN** the sidebar opens on the legend

### Requirement: Ending the tour gives the page back

The tour SHALL end with Finish, Skip, its close button or Escape; when it ends, focus SHALL return
to Help, every target SHALL get its own state back, and the plot's selection SHALL be kept.

#### Scenario: Focus after the tour

- **WHEN** the tour ends
- **THEN** focus is on Help

#### Scenario: Escape during the tour

- **WHEN** proteins are selected and the user ends a tour with Escape
- **THEN** the selection is kept
````

- [ ] **Step 8: Write `table-export`**

Create `openspec/changes/explore-workbench/specs/table-export/spec.md` with exactly this content. It is main's requirement copied whole, with two edits: the first sentence names the app bar's Export menu, the More sheet on phones and the item "Table (.tsv)", and says "isolation (Show only these)"; the scenario "Filter and isolation" says "a filter query or Show only these". "Hidden legend category" is word-for-word main's. `The web table holds coordinates and annotations` is not touched.

````markdown
## MODIFIED Requirements

### Requirement: The web app exports the visible proteins as a table

The Export menu in the app bar (on a phone, the More sheet's Export opens the same menu) SHALL
offer a "Table (.tsv)" item whose rows are exactly the proteins the Protein IDs export writes in
the same state: after the filter query (the EAT reliability filter included), isolation (Show only
these) and hidden legend categories of the coloured annotation.

#### Scenario: Hidden legend category

- **WHEN** the user hides one category of the coloured annotation and exports the table
- **THEN** the table has no row for a protein whose only value is that category
- **AND** its rows are the ids the Protein IDs export writes in the same state

#### Scenario: Filter and isolation

- **WHEN** a filter query or Show only these is active
- **THEN** only the proteins it keeps are rows of the table
````

Prove the copy is whole and only the intended lines changed:

```bash
sed -n '/^### Requirement: The web app exports the visible proteins as a table$/,/^### Requirement: The web table holds/p' \
  openspec/specs/table-export/spec.md | sed '$d' | sed '$d' > "$TMPDIR/table-main.md"
sed -n '/^### Requirement:/,$p' openspec/changes/explore-workbench/specs/table-export/spec.md > "$TMPDIR/table-delta.md"
diff "$TMPDIR/table-main.md" "$TMPDIR/table-delta.md"; echo "diff exit $?"
rm "$TMPDIR/table-main.md" "$TMPDIR/table-delta.md"
```

Expected, exactly (`diff exit 1`, two hunks, nothing else):

```text
3,5c3,6
< The Export menu SHALL offer a Table (TSV) format whose rows are exactly the proteins the Protein
< IDs export writes in the same state: after the filter query (the EAT reliability filter
< included), isolation and hidden legend categories of the coloured annotation.
---
> The Export menu in the app bar (on a phone, the More sheet's Export opens the same menu) SHALL
> offer a "Table (.tsv)" item whose rows are exactly the proteins the Protein IDs export writes in
> the same state: after the filter query (the EAT reliability filter included), isolation (Show only
> these) and hidden legend categories of the coloured annotation.
15c16
< - **WHEN** a filter query or isolation is active
---
> - **WHEN** a filter query or Show only these is active
```

- [ ] **Step 9: Run the spec checks**

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" \
  | sed -n '/^{/,$p' \
  | jq -r '.deltas | group_by(.spec)[] | "\(.[0].spec) \(map(.operation) | group_by(.) | map("\(.[0])=\(length)") | join(","))"'
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "check-headers exit $?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py legend-panel selection-workflow explore-import-export explore-help table-export
grep -nE "control bar|Tips|⚡|\.ts\b|:[0-9]+\b" openspec/changes/explore-workbench/specs/*/spec.md
python3 -c "import glob; [print(f, i) for f in glob.glob('openspec/changes/explore-workbench/specs/*/spec.md') for i, l in enumerate(open(f, encoding='utf8'), 1) if len(l.rstrip('\n')) > 100]"
grep -c "Table (.tsv)" openspec/changes/explore-workbench/specs/table-export/spec.md
grep -rl "Protein IDs export writes" openspec/changes/explore-workbench/specs
git status --short openspec
```

Expected:

- Prettier lists the nine files, all `(unchanged)`.
- `Change 'explore-workbench' is valid`.
- `change show` lists exactly:

  ```text
  explore-help ADDED=5
  explore-import-export ADDED=5
  explore-theming ADDED=6
  explore-ui-kit ADDED=8
  explore-workbench-layout ADDED=8
  legend-panel ADDED=7
  plot-proportions ADDED=5
  selection-workflow ADDED=7
  table-export MODIFIED=1
  ```

- `check-headers exit 0` and no other output: the `table-export` block keeps main's two scenarios, so there is no WARN.
- `evidence: 0 problem(s)`.
- The forbidden-words grep and the line-length check print nothing.
- `1` (the item is named once, in the requirement's text).
- Only `openspec/changes/explore-workbench/specs/table-export/spec.md`: the rows rule is stated nowhere else.
- `git status --short openspec` shows the five new folders and nothing else.

If `validate` reports `must contain SHALL or MUST`, the requirement's first text line lacks the keyword: reflow. Any other failure: fix the spec file, not the check.

- [ ] **Step 10: Run three cited tests**

```bash
pnpm --filter @protspace/app exec vitest --run src/explore/undo-history.test.ts
pnpm --filter @protspace/core exec vitest --run --project browser src/components/export-menu/export-menu.browser.test.ts
PLAYWRIGHT_PORT=8475 pnpm test:e2e eat-visualization.spec.ts --project eat-visualization -g "exports the visible proteins as a table"
```

The second and third need the sandbox disabled. `eat-visualization.spec.ts` has a Playwright project of its own (`eat-visualization`), not `workbench`. Expected: `undo-history.test.ts` all passed (9 tests); `export-menu.browser.test.ts` all passed; the e2e: 1 passed. A failure is a finding about HEAD: record it in the report and the ledger for the orchestrator, and leave the spec as the code and the other tests say.

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git add openspec/changes/explore-workbench/specs/legend-panel/spec.md \
  openspec/changes/explore-workbench/specs/selection-workflow/spec.md \
  openspec/changes/explore-workbench/specs/explore-import-export/spec.md \
  openspec/changes/explore-workbench/specs/explore-help/spec.md \
  openspec/changes/explore-workbench/specs/table-export/spec.md
git commit -m "docs(openspec): specify the legend, selection, import, export and help"
```

Commit with the sandbox disabled (the hook runs `pnpm precommit`). `spec-evidence.md` is git-ignored and is not staged.

Report: Step 8's diff, Step 9's outputs (the `change show` listing, both exit codes), Step 10's three results, the commit hash, and each place where the code at HEAD made you change a requirement or an evidence line (as a disagreement for 8.24).

### Task 8.22: Spec files for phones, docs media and the controls that moved

Two new capabilities (phones and tablets; the docs image pipeline) and seven modified ones whose text names UI that moved or changed: the Tips popover, the control bar's Contours menu, the settings Save button, the ⚡ badge, the site header's Feedback button, the structure's link row in its new placements, and the disabled TED option's reason.

**Files:**

- Create: `openspec/changes/explore-workbench/specs/explore-mobile-layout/spec.md`, `…/docs-media-generation/spec.md`, `…/category-focus/spec.md`, `…/density-contours/spec.md`, `…/scatterplot-point-size/spec.md`, `…/annotation-presentation/spec.md`, `…/support-contact/spec.md`, `…/protein-resource-links/spec.md`, `…/structure-coloring/spec.md`
- Modify: `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md`

**Interfaces:**

- Consumes (sources): mobile — `apps/web/src/workbench/{MoreSheet,MoreMenu,PanelTabs,PanelFold,SearchToggle}.tsx`, `use-layout-mode.ts`, `apps/web/src/explore/{layout-mode,phone-dim,touch-tooltip-insets}.ts`, `packages/core/src/utils/breakpoints.ts` (`PHONE_MAX_WIDTH 640`, `DESKTOP_MIN_WIDTH 951`, `LANDSCAPE_PHONE_MAX_HEIGHT 500`), `--ps-touch-target` 40 px on `pointer: coarse`; `git show archive/mobile-landing:openspec/changes/mobile-responsive-ui/specs/explore-mobile-layout/spec.md` as a starting point only (drop "Desktop layouts are unchanged"; rewrite "The control bar fits a phone"; keep only what today's code and `mobile-*.spec.ts` do); docs — `scripts/docs-screenshots/{manifest,runner,capture-plan,capture-png.spec,capture-gif.spec,gif,docs-lint,check}.ts`, `apps/web/tests/helpers/*`, `docs/explore/images/README.md`, `docs-images.test.ts`; moved controls — `shortcuts.ts` (`keys: ['Shift']`, "Hold over a point to focus its category"), `contours-menu.ts` (trigger shows key and value; tooltip), `legend-settings-popover.ts` (live apply, Reset), `legend-header.ts` (`PREDICTED_NOTE`, the sparkles `role="img"` "Predicted annotation"), `AppBar.tsx` / `MoreSheet.tsx` Feedback, notifications' close button (`apps/web/src/explore/notifications.ts`, `WorkbenchToaster.tsx`), `structure-viewer.ts` link row in docked, floating and phone sheet, `_tedButtonTitle` / `_colorOptions`. Main-spec headers to copy byte-for-byte: `category-focus` `:186 The Tips popover lists Shift + Hover` (RENAMED to `The keyboard shortcut list names Shift + Hover`, then MODIFIED under the new name); `density-contours` `:15 The Contours control SHALL offer Off, Auto and Always`; `scatterplot-point-size` `:165 The legend shape size SHALL default from the dataset's protein count and never exceed 64` (its Save scenario around `:200-206`); `annotation-presentation` `:42 Legend marks predicted annotations` (only this one); `support-contact` `:52 Feedback action in header`; `protein-resource-links` `:15 Structure viewer exposes protein resource links`. Evidence: `mobile-*.spec.ts` (project `mobile`), `docs-images.test.ts`, `workbench-help.spec.ts`, `shortcuts.test.ts`, `density-layer.spec.ts`, `workbench-view-bar.spec.ts`, `legend-settings-popover.browser.test.ts`, `legend.shape-size.test.ts`, `legend.header.test.ts`, `workbench-feedback.spec.ts`, `notifications.test.ts`, `workbench-structure.spec.ts`, `structure-viewer.coloring.test.ts`, `structure-viewer.browser.test.ts`, `fields.browser.test.ts`.
- Produces: `explore-mobile-layout` (ADDED: the four layouts by width and height; the phone's fixed screen and bars; the More sheet with its contents and a dot when something inside is active; the folding bottom panel with Legend and Filter tabs, the tablet's panel under the plot; the structure sheet that opens folded and the tooltip rule while it is expanded; touch targets ≥40 px keyed on `pointer: coarse`; dialogs and popovers fit a phone; Ctrl/⌘K opens search on a phone); `docs-media-generation` (ADDED: one manifest entry per image; shared role-based helpers with the e2e; signal waits; `-dark` twins as pairs; GIF size budgets; the example thumbnails from this pipeline; `docs:images:check` in the pre-commit hook). Seven modified files: the six listed headers, plus `support-contact` ADDED `Every notification on the explore page can be dismissed` (the close button named "Dismiss notification", ownership table); `structure-coloring` ADDED `A disabled structure colour option says why` (Rulings) with scenarios for "still loading" and "no TED domains".
- Produces: the RENAMED name `The keyboard shortcut list names Shift + Hover` exactly (8.24 and the header check use it).
- Consumes from Task 8.19: `bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh <change-dir> <specs-dir>` (exit 0 and no output when clean; `WARN <cap>: fewer scenarios than main (<n> < <m>): <requirement>` for a MODIFIED block that lost a scenario).
- Consumes from Tasks 8.20–8.21: `spec-evidence.md` (header and the sections of the nine capabilities written so far) and its line format (`- <Requirement> / <Scenario> → <file>: "<title>"`, refs joined by `; `, a further title of the same file as `; "<title>"`, trailing ` (<note>)` allowed, `code: <file> <what>` for a code path); `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (prints `evidence: <n> problem(s)`, exit 0 when clean); the shell and workflow specs own the behaviours the ownership table gives them.

**Tests:** the spec checks; `check-headers.sh` exits 0 with no WARN (the renamed `category-focus` block keeps main's one scenario, rewritten); `check-evidence.py` over the nine capabilities prints `evidence: 0 problem(s)`; three cited tests per capability group run (one `--project=mobile` e2e via `-g`); the 8.20 `grep` prints nothing except the RENAMED `- FROM:` line; `grep -n "⚡" openspec/changes/explore-workbench/specs/annotation-presentation/spec.md` prints nothing.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Every `openspec` call is filtered with `2>&1 | grep -v "trust settings"`. `git commit`, `--project browser` and `pnpm test:e2e` need the sandbox disabled.

Three notes that hold for the whole task:

- **The 8.20 grep and the RENAMED line.** `category-focus`'s `## RENAMED Requirements` must name the old header, which contains "Tips"; the archive needs that line. So the stale-wording grep in this task skips `- FROM:` lines (Step 12). Everything else must be clean.
- **Write from the code.** Where a sentence below and the code at your HEAD disagree (8.16 or 8.18 may have changed something), the code wins: change the sentence, keep the scenario's evidence line true, and name the disagreement in the report for 8.24.
- **SHALL on the first line.** The first text line of each requirement contains SHALL (`openspec validate --strict` reads only that line; a SHALL on the second line fails with `must contain SHALL or MUST`).

- [ ] **Step 1: See the nine capabilities missing**

Run:

```bash
for cap in explore-mobile-layout docs-media-generation category-focus density-contours \
  scatterplot-point-size annotation-presentation support-contact protein-resource-links \
  structure-coloring; do
  [ -f "openspec/changes/explore-workbench/specs/$cap/spec.md" ] && echo "present $cap" \
    || echo "missing $cap"
done
grep -c "^## " .superpowers/sdd/phase-8b-wrapup/spec-evidence.md
```

Expected (the failing check): nine `missing` lines, because 8.20 and 8.21 wrote the other nine folders; `spec-evidence.md` exists (8.20 created it) and holds the nine `## <cap>` sections of 8.20 and 8.21 (count 9). If any of the nine here is `present`, stop and report: another task wrote it.

Then confirm the main-spec headers this task copies are still where 8.19's fixtures and this plan expect them (a `main` merge can move them):

```bash
grep -n "^### Requirement: The Tips popover lists Shift + Hover$" openspec/specs/category-focus/spec.md
grep -n "^### Requirement: The Contours control SHALL offer Off, Auto and Always$" openspec/specs/density-contours/spec.md
grep -n "^### Requirement: The legend shape size SHALL default from the dataset's protein count and never exceed 64$" openspec/specs/scatterplot-point-size/spec.md
grep -n "^### Requirement: Legend marks predicted annotations$" openspec/specs/annotation-presentation/spec.md
grep -n "^### Requirement: Feedback action in header$" openspec/specs/support-contact/spec.md
grep -n "^### Requirement: Structure viewer exposes protein resource links$" openspec/specs/protein-resource-links/spec.md
grep -n "^### Requirement: A disabled structure colour option says why$" openspec/specs/structure-coloring/spec.md
```

Expected: the first six print one line each (`:186`, `:15`, `:165`, `:42`, `:52`, `:15`); the last prints nothing (an ADDED name must not exist in main). Then read each of those six requirement blocks whole in `openspec/specs/` (from its header to the next `### Requirement:`), and read the rest of each of the six main specs once: any other requirement the code at HEAD contradicts goes into the delta too (Rulings, "change only what is false") and is named in the report.

- [ ] **Step 2: Write `explore-mobile-layout`**

Create `openspec/changes/explore-workbench/specs/explore-mobile-layout/spec.md`:

```markdown
## ADDED Requirements

### Requirement: The layout follows the window's width and height

The explore page SHALL pick one of four layouts from the window alone: `landscape` for a window in
landscape orientation that is at most 500 px tall and narrower than 951 px; otherwise `desktop`
from 951 px wide, `phone` up to 640 px wide, and `tablet` between the two. Every layout SHALL be the
same page restyled: crossing a breakpoint or turning the device SHALL keep each runtime element (the
plot, the legend, the structure viewer, the Import and Export menus, the protein search and the
query builder) as the same element, and SHALL resize the plot once.

#### Scenario: Four windows, one set of elements

- **WHEN** one session is shown at 1280 × 720, 800 × 1280, 390 × 844 and 740 × 360 px, then at
  1280 × 720 px again
- **THEN** the layouts are desktop, tablet, phone, landscape and desktop
- **AND** no runtime element is replaced along the way

#### Scenario: Turning a phone

- **WHEN** a 412 × 839 px phone is turned to 839 × 412 px and back
- **THEN** the layout becomes landscape and then phone again, the runtime elements stay the same,
  and the plot resizes exactly once per turn

#### Scenario: A short window wins over its width

- **WHEN** the window is in landscape orientation, at most 500 px tall and narrower than 951 px
- **THEN** the layout is landscape, even at a width that would otherwise be a phone's

### Requirement: Below 951 px the legend and the Filter share a panel under the plot

Below 951 px the plot SHALL come first and the legend SHALL sit in a panel below it, with Legend
and Filter tabs that switch the panel's content without resizing the plot. The tabs SHALL be a tab
list whose tabs control their tab panels, switched by click and by the arrow keys, Home and End. On
a phone the page SHALL fit one screen without scrolling the page or overflowing it sideways, the
plot SHALL keep at least 30% of the window's height in either tab, and a fold button SHALL fold the
panel to its 45 px header and unfold it again ("Fold panel" / "Unfold panel"), which resizes the
plot once and is kept in the stored layout. Opening the Filter from a status chip SHALL unfold the
panel. On a tablet the plot SHALL take about three fifths of the height below the bars, and the
structure viewer SHALL share the panel's row with the legend, each half as wide, with an empty
footer in its place until a protein is chosen; the first protein shown there SHALL NOT resize the
plot.

#### Scenario: A phone shows the plot and the panel on one screen

- **WHEN** the explore page loads on a 412 × 839 px phone
- **THEN** the plot is at least 30% of the window's height and ends where the panel begins
- **AND** the page neither scrolls nor overflows sideways

#### Scenario: A small phone in the Filter tab

- **WHEN** the window is 360 × 640 px and the user switches between the Legend and Filter tabs
- **THEN** the plot keeps at least 30% of the height in both, above the panel, and the page does not
  scroll

#### Scenario: Switching tabs keeps the plot

- **WHEN** the user taps the Filter tab and then the Legend tab
- **THEN** the panel keeps its height and position, the tapped tab is selected and focused, and the
  plot is not resized

#### Scenario: Folding the panel survives a reload

- **WHEN** the user taps Fold panel and reloads the page
- **THEN** the panel is folded to its 45 px header with the tabs still visible, its button reads
  "Unfold panel", and folding resized the plot once

#### Scenario: A filter chip unfolds the panel

- **WHEN** a filter is applied, the panel is folded, and the user opens the filter's status chip
- **THEN** the panel unfolds on the Filter tab and focus moves to the Filter heading

#### Scenario: A tablet puts the legend and the structure side by side

- **WHEN** a protein is tapped on a 768 × 1024 px tablet
- **THEN** the plot takes about three fifths of the height below the bars, and the structure viewer
  sits beside the legend in the row below, as tall and as wide as the legend

#### Scenario: A tablet's first protein does not resize the plot

- **WHEN** no protein is shown on a tablet and the user taps one
- **THEN** the empty footer beside the legend gives way to the structure viewer and the plot is not
  resized

### Requirement: A phone's bars keep the essentials and search opens over the app bar

On a phone the app bar and the view bar SHALL each be one 48 px row. The app bar SHALL show the
ProtSpace wordmark linking home, the dataset name and a search button; Import, Export, Theme, Help,
Feedback and GitHub SHALL be hidden there (the More sheet offers them), while their menus stay
rendered so they can still open. The view bar SHALL show Projection with its details button, Color
by and More. Labels SHALL show whole, each picker SHALL keep at least 48 px of its value, and
every control in both bars SHALL be at least 40 × 40 px. The search button (named "Search
proteins") and Ctrl+K or ⌘K SHALL open the search over the app bar with focus in its field; Ctrl+K
or ⌘K SHALL do nothing while a modal dialog is open. "Close search", Escape once nothing else takes it, and focus
leaving the overlay by keyboard SHALL close it, and "Close search" SHALL return focus to the search
button. A tablet SHALL keep the desktop bars.

#### Scenario: The bars on a phone

- **WHEN** the explore page opens at 360 × 740 or 412 × 839 px
- **THEN** both bars are 48 px tall, the app bar shows the wordmark, the dataset name and the search
  button, and the view bar shows Projection, its details button, Color by and More
- **AND** Import, Export, Theme and Help are hidden, no label is cut off, and every control is at
  least 40 × 40 px

#### Scenario: Searching from the search button

- **WHEN** the user taps the search button, pastes an ID and closes the search
- **THEN** the search opens over the app bar with focus in its field, the pasted ID's protein is
  selected, and Close search returns focus to the search button

#### Scenario: Ctrl+K on a phone

- **WHEN** a phone with a hardware keyboard has no dialog open and the user presses Ctrl+K
- **THEN** the search opens over the app bar with focus in its field, upright and on its side alike

#### Scenario: Ctrl+K under a dialog

- **WHEN** the Keyboard shortcuts dialog is open and the user presses Ctrl+K
- **THEN** the search stays closed, during the dialog and after it closes

#### Scenario: A tablet keeps the desktop bars

- **WHEN** the window is an 800 × 1280 px tablet
- **THEN** the app bar shows Import, Export, the Theme button and Help, with the dataset name and
  the search field unclipped

### Requirement: The More sheet holds what a phone's bars leave out

On a phone, upright or on its side, More SHALL open a bottom sheet: a modal dialog named "More" with
a close button, which Escape or a press on its backdrop also closes, returning focus to More. The
sheet SHALL hold, in order: Contours as a radio group (Off, Auto, Always), Filter with its applied
condition count, Import data, Export, Theme as a radio group (System, Light, Dark), Help & shortcuts
and Feedback; it SHALL NOT offer GitHub. Contours and Theme SHALL apply at once and keep the sheet
open. Every other row SHALL close the sheet first and then act: Filter shows the Filter tab and
focuses its heading, Import data opens the Import panel under the dataset name, Export opens the
Export menu anchored to More, and Help & shortcuts unfolds Documentation, Keyboard shortcuts and
Take the tour in place. The sheet SHALL fit the window and scroll inside itself, keeping its header
in view. While a contour mode other than Off or a filter is applied, More SHALL show a dot and its
accessible name SHALL gain ", N active"; the theme SHALL never light the dot.

#### Scenario: The sheet's rows

- **WHEN** the user taps More on a phone
- **THEN** the sheet shows the Contours and Theme radio groups and the Filter, Import data, Export,
  Help & shortcuts and Feedback rows, inside the window, with no GitHub link

#### Scenario: Contours applies in place

- **WHEN** the user picks Auto in the sheet's Contours group and then closes the sheet
- **THEN** the contour mode becomes Auto while the sheet stays open
- **AND** once it closes, More reads "More view options, 1 active" and shows its dot

#### Scenario: Export from the sheet

- **WHEN** the user taps Export in the sheet
- **THEN** the sheet closes, the Export menu opens within the window under More, and a tap outside
  it or Escape closes it, Escape returning focus to More

#### Scenario: A filter lights the dot

- **WHEN** a filter keeping some proteins is applied
- **THEN** More reads "More view options, 1 active", shows its dot, and the sheet's Filter row reads
  "1 condition"

#### Scenario: The theme leaves the dot dark

- **WHEN** the user picks Dark in the sheet's Theme group
- **THEN** the page turns dark while the sheet stays open, and after it closes More still reads
  "More view options" without a dot

#### Scenario: A short screen

- **WHEN** the sheet opens on a phone on its side
- **THEN** it fits the window with its heading in view, and its last row is reached by scrolling the
  sheet

#### Scenario: Escape one layer at a time

- **WHEN** a protein is selected and the user opens the sheet and presses Escape twice
- **THEN** the first Escape closes the sheet and returns focus to More with the selection kept, and
  the second clears the selection

### Requirement: The structure opens as a sheet on a phone

On a phone, upright or on its side, the structure viewer SHALL be a sheet. Upright it SHALL span the
window's width along its bottom edge; on its side it SHALL sit in the right-hand column, under the
legend. A protein shown while no structure is open SHALL open the sheet folded, showing only its
grip and header (56 px together), with the viewer, its colour controls and its resource links out
of sight, the Tab order and the accessibility tree. The grip and the header row SHALL fold and
expand the sheet, the header's close button SHALL NOT, and the toggle SHALL be named "Hide the
structure" while expanded. Expanded upright, the sheet SHALL rise to the window's bottom edge and take at most half
of its height, leaving part of the plot in view; on its side it SHALL cover the right half, at least
200 px tall. Folding or expanding SHALL never resize the plot, the expanded sheet SHALL take the
panel it covers out of the Tab order, and under reduced motion it SHALL move without a transition.
While the sheet is expanded, a tap on a protein above it SHALL select that protein without opening a
tooltip; while it is folded, the tapped protein's tooltip SHALL lie clear of it, and the tooltip's
"View structure" SHALL expand it. Closing the structure SHALL reset the sheet, so the next protein
opens it folded again.

#### Scenario: A first tap opens the sheet folded

- **WHEN** the user taps a protein on a phone with no structure open
- **THEN** the sheet shows only its 56 px header strip at the bottom edge, below the plot
- **AND** the protein's tooltip is shown with "View structure" and does not overlap the sheet

#### Scenario: Expanding the sheet

- **WHEN** the user taps the folded sheet's grip or header
- **THEN** the sheet spans the window's width, ends at its bottom edge, and is at most half of its
  height, with the plot still in view above it

#### Scenario: Tapping above an expanded sheet

- **WHEN** the sheet is expanded and the user taps a protein above it
- **THEN** the protein is selected, the sheet stays expanded, and no tooltip opens

#### Scenario: View structure expands the sheet

- **WHEN** the sheet is folded, a tapped protein's tooltip is shown, and the user taps "View
  structure"
- **THEN** the sheet expands and the tooltip closes

#### Scenario: Closing starts over

- **WHEN** the user closes the structure and then taps another protein
- **THEN** the sheet opens folded again

#### Scenario: The sheet never resizes the plot

- **WHEN** the user folds and expands the sheet
- **THEN** the plot keeps its size

#### Scenario: The sheet on a phone on its side

- **WHEN** a protein is tapped and its sheet expanded on a 740 × 360 px screen
- **THEN** the folded sheet first sits under the legend in the right-hand column, and the expanded
  sheet covers at least half the width, is at least 200 px tall and lies within the window
- **AND** its close button covers none of its resource links

### Requirement: A phone on its side scrolls once to a full-screen plot

In the landscape layout the app bar and the view bar SHALL share one 44 px row, with the search
button before Projection in the Tab order and the search overlay covering the whole row. The page
SHALL scroll past that row to a plot-and-legend row exactly one screen tall, with the legend to the
right of the plot. There the legend's rows SHALL show each category's name, count and eye only,
keeping at least 110 px for the name, and the legend header SHALL fit with its sort button.

#### Scenario: Turning the phone sideways

- **WHEN** the explore page is open at 740 × 360 px and the page is scrolled to its end
- **THEN** the plot lies wholly inside the screen, the plot-and-legend row is the screen's height,
  and the legend sits to the right of the plot

#### Scenario: The landscape bar

- **WHEN** the explore page opens at 740 × 360 px
- **THEN** the app bar and the view bar sit side by side in one 44 px row that fits the screen
- **AND** Tab moves from the search button to Projection, and the search overlay spans the row

#### Scenario: The legend column

- **WHEN** the explore page opens at 740 × 360 or 844 × 390 px
- **THEN** each legend row shows its eye but no drag handle or row menu, its name keeps at least
  110 px, and the legend header does not overflow

### Requirement: A touch screen gets finger-sized targets and touch gestures

Under a coarse pointer every control the explore page draws (the legend's row controls and header
buttons, the bars, the structure viewer's resource links, colour options, close button and protein
pick, a filter value's remove button, the segmented options) SHALL be at least 40 × 40 px; a fine
pointer keeps the compact sizes. On the plot, a pinch SHALL zoom the plot and never the page, a
one-finger drag SHALL pan it, and a tap on a point SHALL select it and pin a compact card inside the plot,
clear of the tool strip, the status corner and the protein it names. A tap on empty space or the
start of a pan SHALL close the card. In the legend, a tap SHALL hide or show a category, a double
tap SHALL show only that category even where the browser sends no double-click, a swipe that starts
on a drag handle SHALL scroll the rows, and a long press on a drag handle SHALL lift the row to
reorder it. On a phone, and on any touch screen in dark, unselected points SHALL fade to 25% rather
than the plot's usual 15%, so the plot around a tapped protein stays readable.

#### Scenario: Pinching the plot

- **WHEN** two fingers spread apart on the plot
- **THEN** the plot zooms in, and the page itself neither scrolls nor zooms

#### Scenario: Tapping near the edge

- **WHEN** a protein near the right edge of the plot is tapped
- **THEN** its card lies wholly inside the plot, overlaps neither the tool strip nor the status
  corner, and nothing in it is cut off

#### Scenario: Closing the card

- **WHEN** a card is pinned and the user taps empty plot space, or pans the plot
- **THEN** the card closes

#### Scenario: The legend under a finger

- **WHEN** the legend is shown on a phone
- **THEN** each row's eye, drag handle and menu button and the header's sort and settings buttons
  are at least 40 × 40 px, and a one-line row is at most 44 px tall

#### Scenario: Reordering by touch

- **WHEN** the user presses a drag handle for longer than a quarter second and drags down past the
  next row
- **THEN** the two rows swap places, and a quick swipe from a handle scrolls the list instead

#### Scenario: A double tap without a double-click

- **WHEN** the browser sends no double-click event and the user taps a legend row twice quickly
- **THEN** only that category is shown

#### Scenario: Dimming on a dark touch screen

- **WHEN** the page is dark on a touch screen of any layout, or the layout is a phone's
- **THEN** unselected points fade to 25%, and elsewhere to the plot's own 15%

### Requirement: Dialogs and popovers fit a phone

On a phone every dialog, menu and popover the explore page opens SHALL lie within the window or
scroll inside itself, with its close or cancel control on screen without scrolling the page: the
More sheet, the Import panel, the Export menu, the Color by picker and its info bubble, the
projection details card, the legend's settings popover, the colour picker and the Other popover
opened from a full-width legend row, the Filter builder with its actions, the confirmation dialogs
and the Figure editor. The Figure editor SHALL stack its preview above its settings upright and
place them side by side on a phone on its side, with 40 px targets.

#### Scenario: The legend settings on a phone

- **WHEN** the user opens the legend's settings on a phone
- **THEN** the popover lies within the window and its Reset button is on screen and at least 40 px
  tall

#### Scenario: The Figure editor on a phone

- **WHEN** the Figure editor opens on a phone, upright and on its side
- **THEN** it lies within the window, stacked upright and side by side on its side, and its
  controls are at least 40 px

#### Scenario: A confirmation on a 360 px phone

- **WHEN** the user taps the dataset name, and later "Clear stored data" in the recovery banner,
  on a 360 × 740 px phone
- **THEN** the Import panel and the "Clear stored data?" dialog each lie within the window, the
  dialog's Cancel and Clear data buttons included

#### Scenario: Popovers from a legend row

- **WHEN** the colour picker or the Other popover opens from a full-width legend row on a phone
- **THEN** it stays inside the window

#### Scenario: The Filter builder on a phone

- **WHEN** the user opens the Filter tab on a phone
- **THEN** the builder shows with its Reset, Cancel and Apply actions on screen
```

- [ ] **Step 3: Write `docs-media-generation`**

Create `openspec/changes/explore-workbench/specs/docs-media-generation/spec.md`:

```markdown
## ADDED Requirements

### Requirement: Every documentation image comes from one capture manifest

Every file under `docs/explore/images/` SHALL be made by exactly one entry of the capture manifest;
no image is added or edited by hand. Each entry SHALL carry a unique lowercase kebab-case name,
optionally under `examples/`, with no file extension and not ending in `-dark`, its kind (PNG or
GIF), its viewport (`desktop` 1280 × 720, `tablet` 800 × 1280, `phone` 412 × 839, or a custom
size), its themes, its dataset and steps, what to crop, and the documentation pages that show it.
`pnpm docs:images` SHALL regenerate every image, and `pnpm docs:screenshots -g "<name>"` and
`pnpm docs:animations -g "<name>"` SHALL capture the entries whose file names match. Screenshots
SHALL be taken at device scale 2 with reduced motion (a desktop entry may set its own scale); GIFs
SHALL be recorded at scale 1.

#### Scenario: A name used twice

- **WHEN** two manifest entries share a name
- **THEN** the manifest's validation reports that the name is used twice, once

#### Scenario: A file no entry makes

- **WHEN** a file sits under `docs/explore/images/` that no manifest entry produces
- **THEN** `pnpm docs:images:check` fails naming the file

#### Scenario: An output missing on disk

- **WHEN** a manifest entry's output file does not exist
- **THEN** `pnpm docs:images:check` fails naming the missing output

### Requirement: Captures drive the app the way the end-to-end suite does

The capture scenes SHALL reach the app through the same helpers as the end-to-end suite, which find
controls by role, accessible name or tag and never reach into a shadow root, and SHALL wait for
signals (a dialog visible, a structure loaded, the plot settled) rather than for time. A scene SHALL
hold no timer and SHALL NOT evaluate code in the page; the only pause in capture code SHALL be the
runner's hold, which paces a GIF. Every timer inside the shared helpers a scene imports SHALL be
counted by a test, so a new one shows in review. Before taking a picture the runner SHALL wait for
the data and for the plot to settle, park the pointer and check that no tooltip is open.

#### Scenario: A scene reaches into a shadow root

- **WHEN** capture code reads an element's `shadowRoot`
- **THEN** the docs image tests fail naming the file

#### Scenario: A timer in a scene

- **WHEN** a scene waits on a timeout or evaluates code in the page
- **THEN** the docs image tests fail naming the scene

#### Scenario: A new timer in a shared helper

- **WHEN** a helper a scene imports gains a timer
- **THEN** the docs image tests fail until the counted timers are updated

### Requirement: A screenshot's dark twin is shown as a pair

A screenshot entry MAY ask for a dark variant, captured with the browser in dark mode and the app's
theme on System, and saved as the light file's twin `<name>-dark.png`. GIFs and the example
thumbnails SHALL be light only. A page SHALL show a pair as two images on consecutive lines, the
light one first and marked `{.light-only}`, the dark one marked `{.dark-only}`; written as raw HTML,
the dark twin SHALL load lazily and neither image SHALL carry an inline `display` style. A raw image
with a width SHALL also give its height.

#### Scenario: A pair written as the docs expect

- **WHEN** a page shows a light image followed on the next line by its dark twin
- **THEN** the docs lint passes it

#### Scenario: A dark image without its light twin

- **WHEN** a page shows a `-dark` image without its light twin before it, or a `-dark` file has no
  light twin on disk
- **THEN** the docs lint fails

#### Scenario: A raw pair with an inline display

- **WHEN** a raw HTML pair gives an image an inline `display` style
- **THEN** the docs lint fails, because both twins would show

#### Scenario: A dark GIF entry

- **WHEN** a GIF entry asks for the dark theme
- **THEN** the manifest's validation reports that a GIF is light only

### Requirement: GIFs fit a size budget

Each GIF SHALL fit its entry's budget, 3 MiB (3,145,728 bytes) unless the entry sets its own.
`pnpm docs:gifs` SHALL convert each recording with a two-pass palette and step down a fixed ladder
until the file fits: 25 fps at 1000 px wide, then 20 and 15 fps, then 800 and 640 px at 15 fps. A
GIF still over budget at the last step SHALL fail the run, keep its recording and leave the
previous GIF in place.

#### Scenario: The default budget

- **WHEN** a GIF entry sets no budget
- **THEN** its budget is 3 MiB

#### Scenario: The ladder

- **WHEN** a recording converts over its budget
- **THEN** the converter tries a lower frame rate first, then a narrower width at 15 fps

#### Scenario: One byte over

- **WHEN** a GIF on disk is one byte over its budget
- **THEN** `pnpm docs:images:check` fails naming it

### Requirement: The example thumbnails come from the capture pipeline

The Example datasets page's thumbnails, `examples/<id>.png`, SHALL be manifest entries like every
other image: one per catalog example in menu order, each the workbench body on the example's curated
view, light only, at scale 1. No end-to-end project SHALL write them.

#### Scenario: Every example has a thumbnail

- **WHEN** the docs lint reads the real docs
- **THEN** every catalog example's thumbnail exists, is made by an entry and is shown by the Example
  datasets page

### Requirement: The image check runs before every commit

`pnpm docs:images:check` SHALL run in `pnpm precommit`, reading only files and starting no browser.
It SHALL fail when a manifest output is missing or a file has no entry; when a GIF is over its
budget; when a page shows a file that does not exist, a file is shown by no page, or a page an entry
names does not show it; when a dark twin is written or stored wrongly; when a link's `#anchor`
matches no heading on its page; and when the user guide names removed UI. The same rules SHALL run
as unit tests on small cases and on the real docs.

#### Scenario: An anchor no heading has

- **WHEN** a docs link points at `page#anchor` and that page has no heading with that anchor
- **THEN** the docs lint fails naming the link

#### Scenario: Removed UI in the user guide

- **WHEN** a user-guide page names removed UI outside code and front matter
- **THEN** the docs lint fails, reporting each line, and the developer docs are not checked

#### Scenario: The real docs pass

- **WHEN** the docs lint runs on the repository's docs
- **THEN** every page and image passes
```

- [ ] **Step 4: Write `category-focus` (renamed, then modified)**

Create `openspec/changes/explore-workbench/specs/category-focus/spec.md`. The FROM line is the main header byte for byte (`openspec/specs/category-focus/spec.md:186`); the MODIFIED block uses the new name and keeps main's one scenario, rewritten:

```markdown
## RENAMED Requirements

- FROM: `### Requirement: The Tips popover lists Shift + Hover`
- TO: `### Requirement: The keyboard shortcut list names Shift + Hover`

## MODIFIED Requirements

### Requirement: The keyboard shortcut list names Shift + Hover

The Keyboard shortcuts dialog, opened from the Help menu (on a phone from Help & shortcuts in the
More sheet), SHALL list `Shift` in its Plot section with the action "Hold over a point to focus its
category". The key SHALL read `⇧` on Apple platforms and `Shift` elsewhere. The plot SHALL offer no
tips button of its own.

#### Scenario: Opening the keyboard shortcut list

- **WHEN** the user opens Help, then Keyboard shortcuts
- **THEN** the dialog's Plot section shows `Shift` (`⇧` on Apple platforms) with "Hold over a point
  to focus its category"
- **AND** the plot shows no tips button
```

- [ ] **Step 5: Write `density-contours`**

Create `openspec/changes/explore-workbench/specs/density-contours/spec.md`. The block is main's `:15` requirement with its three scenarios (Default mode, Picking a mode, Keyboard use), edited: the view bar instead of the control bar, the More menu and More sheet, the pick applied after the paint, the trigger that always shows key and value, no "active" style:

```markdown
## MODIFIED Requirements

### Requirement: The Contours control SHALL offer Off, Auto and Always

The view bar SHALL offer a Contours menu with the modes Off, Auto and Always, in that order, with
Off as the default. Where the view bar has moved Contours into its More menu, and on a phone in the More
sheet, the same three modes SHALL be offered there and SHALL act as a pick in the menu does. Always
SHALL be the `on` value of `densityLayer` and of the URL. Each mode SHALL show a one-line hint: Off
"No contours", Auto "Fades out as you zoom in; faint or hidden when few points are shown", Always
"Full strength at every zoom level". A pick SHALL show on the trigger at once and, after the next
paint, SHALL set the scatter plot's `densityLayer` configuration and dispatch
`density-layer-change` with `{ densityLayer }`; picking the mode already in use SHALL dispatch
nothing. The trigger SHALL show the word "Contours" followed by the mode's name, "Off", "Auto" or
"Always", which together are its accessible name, and its tooltip SHALL say that there is one ring
set per legend colour and that contours are not included in exports. The menu SHALL be operable
from the keyboard: Enter or Space opens it on the current mode, the arrow keys and Home/End move
the highlight, Enter or Space picks the highlighted mode, and Escape closes it.

#### Scenario: Default mode

- **WHEN** a dataset loads with no `density` URL parameter
- **THEN** the Contours mode is Off, the trigger reads "Contours Off", and the plot draws points
  only

#### Scenario: Picking a mode

- **WHEN** the user picks Always from the Contours menu
- **THEN** the menu closes, the trigger reads "Contours Always", the plot draws contours, and
  `density-layer-change` fires with `{ densityLayer: 'on' }` after the next paint

#### Scenario: Keyboard use

- **WHEN** the trigger has focus and the user presses Enter, then the down arrow, then Enter
- **THEN** the menu opens on the current mode and the next mode is picked
```

- [ ] **Step 6: Write `scatterplot-point-size`**

Create `openspec/changes/explore-workbench/specs/scatterplot-point-size/spec.md`. The block is main's `:165` requirement with all nine scenarios; edited: the settings popover instead of a dialog, live apply instead of Save, the size field empty while the default is in use, the hint's text. The seven other scenarios are copied unchanged:

```markdown
## MODIFIED Requirements

### Requirement: The legend shape size SHALL default from the dataset's protein count and never exceed 64

The legend's default shape size SHALL be `clamp(round(10 · (10000 / N)^⅔), 1, 10)`, where `N` is
the number of proteins in the whole dataset, and SHALL be 10 when `N` is 0.
`N` SHALL count every protein of the loaded dataset, so hiding categories, filtering or isolating
SHALL NOT change the default. The legend's settings popover SHALL accept whole sizes from 1 to 64
and SHALL cap a larger entry at 64, showing the capped value. A larger size from a bundle, top-level
or per-annotation, or from browser storage SHALL be capped at 64 as well, and a capped top-level
bundle size SHALL be stored as 64. The popover's size field SHALL show a picked size and stay empty
while the default is in use; its placeholder SHALL give the dataset's default, and its hint SHALL
read "Default for this dataset: <default>; clear the field to use it." A typed size SHALL apply
300 ms after the last keystroke, or at once on Enter or when the field loses focus; the popover has
no Save button. Emptying the size field SHALL clear the shape size as Reset does, so the default
applies, and SHALL keep the annotation's other settings. The point size SHALL be
`max(10, round(8 · shapeSize))`.

#### Scenario: Default for a small dataset

- **WHEN** a dataset of 5,000 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 10 and dots are drawn at point size 80

#### Scenario: Default for a large dataset

- **WHEN** a dataset of 105,562 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 2 and dots are drawn at point size 16

#### Scenario: Default for Swiss-Prot

- **WHEN** a dataset of 573,649 proteins loads with no stored or bundled shape size
- **THEN** the shape size is 1 and dots are drawn at point size 10

#### Scenario: Hiding categories or isolating

- **WHEN** the user hides categories of a 40,000-protein dataset, or isolates 1,000 of its proteins
- **THEN** the shape size stays 4, the default for 40,000 proteins

#### Scenario: The popover names the default

- **WHEN** the user opens the legend settings on a 105,562-protein dataset without a picked size
- **THEN** the size field is empty, its placeholder is 2, and its hint reads "Default for this
  dataset: 2; clear the field to use it."

#### Scenario: Emptying the size field

- **WHEN** the user picked shape size 10 on a 40,000-protein dataset, then empties the size field
- **THEN** once the typing pauses or the field loses focus, no size is stored for the dataset and
  the dots return to the default shape size 4

#### Scenario: Oversized entry

- **WHEN** the user types 640 into the shape size field
- **THEN** 64 is applied and the field shows 64

#### Scenario: Oversized bundle size

- **WHEN** a bundle with a top-level `"shapeSize": 200` is imported
- **THEN** dots are drawn at shape size 64 (point size 512) and 64 is stored for the dataset

#### Scenario: Oversized stored size

- **WHEN** the browser holds a shape size of 200 for the dataset or the annotation
- **THEN** the legend loads it as 64
```

Before moving on, check the edited text against the code once more: the hint string is in `legend-settings-popover.ts` (`Default for this dataset: ${this.defaultShapeSize}; clear the field to use it.`), the delay is `SETTINGS_INPUT_DEBOUNCE_MS` (300), and `fieldText` returns `''` for a `null` size. Then read the rest of `openspec/specs/scatterplot-point-size/spec.md` for any other "settings dialog" or "Save" wording: if one appears in another requirement, add that requirement to this file as a second MODIFIED block (copied whole, edited only there) and name it in the report.

- [ ] **Step 7: Write `annotation-presentation`**

Create `openspec/changes/explore-workbench/specs/annotation-presentation/spec.md` (only `:42`; `Friendly annotation labels at display sites` and `The annotation dropdown groups annotations by source` stay as main has them; no REMOVED):

```markdown
## MODIFIED Requirements

### Requirement: Legend marks predicted annotations

When the active coloring annotation is predicted, the legend header SHALL show a sparkles mark after
its title, exposed to assistive technology as an image named "Predicted annotation", whose tooltip
reads "Predicted: computational, not experimentally curated". The header SHALL show no other badge
or note for it. When the active annotation is experimental, no such mark or tooltip SHALL be shown.

#### Scenario: Predicted annotation active

- **WHEN** `predicted_membrane` is the active coloring annotation
- **THEN** the legend header shows the sparkles mark named "Predicted annotation", whose tooltip
  reads "Predicted: computational, not experimentally curated"

#### Scenario: Experimental annotation active

- **WHEN** `ec` is the active coloring annotation
- **THEN** the legend header shows no predicted mark or tooltip
```

- [ ] **Step 8: Write `support-contact`**

Create `openspec/changes/explore-workbench/specs/support-contact/spec.md`. The MODIFIED block is main's `:52` requirement with its one scenario kept word-for-word and a second added; the ADDED requirement is the notification close button (Rulings: ownership table):

```markdown
## MODIFIED Requirements

### Requirement: Feedback action in header

The site header SHALL present a prominent Feedback button that opens a `mailto:` to the support
inbox, available on both desktop and mobile navigation. The explore page, which shows no site
header, SHALL offer the same `mailto:` in its app bar as an icon link named "Feedback" with the
tooltip "Feedback", and on a phone as the More sheet's Feedback row, which closes the sheet as the
mail client opens.

#### Scenario: Header feedback button present

- **WHEN** a page that renders the header is displayed
- **THEN** a "Feedback" button is shown in the navigation, and its target is a `mailto:` to `hello@protspace.app` whose subject identifies feedback

#### Scenario: Feedback on the explore page

- **WHEN** the explore page is open on a desktop, or its More sheet is open on a phone
- **THEN** a link named "Feedback" is offered with the same `mailto:` target
- **AND** on a phone, activating it closes the sheet

## ADDED Requirements

### Requirement: Every notification on the explore page can be dismissed

Every notification the explore page shows SHALL carry a close button named "Dismiss notification",
beside any action the notification offers, so a user can remove it before it times out.

#### Scenario: A notification with an action

- **WHEN** removing the filter shows the "Filter removed" notification with its Undo action
- **THEN** the notification also shows a button named "Dismiss notification"
```

The scenario `Header feedback button present` keeps main's unwrapped long line: it is copied, not rewritten (Prettier leaves Markdown prose as written).

- [ ] **Step 9: Write `protein-resource-links`**

Create `openspec/changes/explore-workbench/specs/protein-resource-links/spec.md`. The block is main's `:15` requirement with its three scenarios kept word-for-word and two added for the placements and the pinned tooltip:

```markdown
## MODIFIED Requirements

### Requirement: Structure viewer exposes protein resource links

When a protein is selected and the structure viewer header is shown, the system SHALL expose
AlphaFold, UniProt, InterPro, and TED as external resource links for that protein, presented as
one ordered row in which every entry carries the same label treatment, the same indication that
it leaves the application, and the same safe new-tab behavior.

The row SHALL sit under the viewer's header in a row of its own that wraps rather than clips, and
every link SHALL stay visible and usable in each placement of the viewer: docked in the sidebar at
its narrowest (240 px), in the floating card at its narrowest (280 px), and in the phone's structure
sheet once it is expanded; the folded sheet shows only the header. A protein tooltip pinned with a
mouse SHALL offer the same row above its actions; the compact card a tap pins on a touch screen
SHALL NOT, leaving the links to the structure sheet.

The row SHALL be rendered from a single ordered definition of those destinations rather than from
per-destination markup, and the header title SHALL NOT itself be a link.

#### Scenario: The row lists every resource in order

- **WHEN** the structure viewer renders a selected protein
- **THEN** its header shows AlphaFold, UniProt, InterPro, and TED in that order
- **AND** each opens in a new tab without granting the destination access to the opener

#### Scenario: Resource links are distinguishable from the accession beside them

- **WHEN** the structure viewer header renders its resource row
- **THEN** each entry is marked as leaving the application rather than presented in the same
  treatment as the protein identifier

#### Scenario: The title is not a hidden link

- **WHEN** the structure viewer header renders its title
- **THEN** the title carries no link target, and AlphaFold is reachable from the resource row

#### Scenario: The narrowest placements

- **WHEN** the structure is docked in a 240 px sidebar, or floating in a 280 px card
- **THEN** every resource link is visible inside the viewer and the TED link is the topmost element
  at its centre

#### Scenario: A pinned tooltip offers the row

- **WHEN** the sidebar is collapsed and the user clicks a protein, pinning its tooltip with "View
  structure"
- **THEN** the tooltip shows AlphaFold, UniProt, InterPro and TED links, in that order
- **AND** a tap on a touch screen pins a compact card without them
```

- [ ] **Step 10: Write `structure-coloring`**

Create `openspec/changes/explore-workbench/specs/structure-coloring/spec.md` (one ADDED requirement; the generic mechanism, a press showing the reason and arrow keys skipping a disabled option, belongs to `explore-ui-kit`):

```markdown
## ADDED Requirements

### Requirement: A disabled structure colour option says why

The structure viewer's colour control SHALL keep the TED domains option on screen when it cannot be
used, disabled, with a tooltip that gives the reason: "Available once the structure has loaded"
while the structure is loading, and "TED domain annotations are unavailable for this protein" once
it has loaded without TED domains. The pLDDT option SHALL be disabled while the structure is
loading. A disabled option SHALL change nothing when it is pressed, and its reason SHALL come from
the tooltip, not from a native `title`. When TED domains are available, the option's tooltip SHALL
read "Color residues by TED domain".

#### Scenario: Still loading

- **WHEN** a structure is still loading
- **THEN** the TED domains option is disabled and hovering it shows "Available once the structure
  has loaded"

#### Scenario: No TED domains

- **WHEN** the structure has loaded and the protein has no TED domains
- **THEN** the TED domains option is disabled with the reason "TED domain annotations are
  unavailable for this protein"
- **AND** pressing it leaves the structure coloured by pLDDT
```

- [ ] **Step 11: Add the evidence lines**

Append to `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (one `## <cap>` section per capability, one line per scenario, in the spec's order). Before appending, check each cited title still exists, so a renamed test is caught here and not by the reviewer:

```bash
grep -c "same runtime elements survive 1280, 800, 390 and 740×360" apps/web/tests/mobile-shell.spec.ts
grep -c "the More sheet opens on screen and runs an action" apps/web/tests/mobile-bars.spec.ts
grep -c "hovering the disabled TED option shows why it is disabled" packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts
grep -c "an emptied size fires shapeSize: null and shows the default as placeholder" packages/core/src/components/legend/legend-settings-popover.browser.test.ts
grep -c "reports %s once, and why" apps/web/src/explore/docs-images.test.ts
```

Expected: `1` each. A `0` means the title moved: find it with `grep -rn "<a few words>" apps packages scripts` and cite the current title.

```bash
cat >> .superpowers/sdd/phase-8b-wrapup/spec-evidence.md <<'EOF'

## explore-mobile-layout

- The layout follows the window's width and height / Four windows, one set of elements → apps/web/tests/mobile-shell.spec.ts: "the same runtime elements survive 1280, 800, 390 and 740×360"
- The layout follows the window's width and height / Turning a phone → apps/web/tests/mobile-explore-layout.spec.ts: "rotating from 412×839 to 839×412 and back keeps the same runtime elements and resizes the plot once per rotation"
- The layout follows the window's width and height / A short window wins over its width → apps/web/src/explore/layout-mode.test.ts: "takes landscape first, then desktop, then phone, else tablet"
- Below 951 px the legend and the Filter share a panel under the plot / A phone shows the plot and the panel on one screen → apps/web/tests/mobile-explore-layout.spec.ts: "L1: the plot comes first and the legend panel sits below it, on one screen"
- Below 951 px the legend and the Filter share a panel under the plot / A small phone in the Filter tab → apps/web/tests/mobile-explore-layout.spec.ts: "at 360×640 the plot keeps at least 30% of the screen"
- Below 951 px the legend and the Filter share a panel under the plot / Switching tabs keeps the plot → apps/web/tests/mobile-explore-layout.spec.ts: "on a tablet, the Filter tab swaps the panel without resizing the plot"; "the Filter tab keeps the panel height (no plot resize)"
- Below 951 px the legend and the Filter share a panel under the plot / Folding the panel survives a reload → apps/web/tests/mobile-explore-layout.spec.ts: "the fold survives a reload"
- Below 951 px the legend and the Filter share a panel under the plot / A filter chip unfolds the panel → apps/web/tests/mobile-explore-layout.spec.ts: "a status chip's filter opens the Filter tab unfolded"
- Below 951 px the legend and the Filter share a panel under the plot / A tablet puts the legend and the structure side by side → apps/web/tests/mobile-explore-layout.spec.ts: "L3: on a tablet, the legend and the structure share the row under the plot"
- Below 951 px the legend and the Filter share a panel under the plot / A tablet's first protein does not resize the plot → apps/web/tests/mobile-explore-layout.spec.ts: "on a tablet with no protein, the right half shows the empty footer and a first tap does not resize the plot"
- A phone's bars keep the essentials and search opens over the app bar / The bars on a phone → apps/web/tests/mobile-bars.spec.ts: "C1: the bars fit with whole labels and 40 px targets at 360 px"; "C2: the bars fit with whole labels and 40 px targets at 412 px"
- A phone's bars keep the essentials and search opens over the app bar / Searching from the search button → apps/web/tests/mobile-bars.spec.ts: "the search button opens search over the app bar; a pasted ID selects its protein; Close search returns focus to the button"
- A phone's bars keep the essentials and search opens over the app bar / Ctrl+K on a phone → apps/web/tests/mobile-bars.spec.ts: "Ctrl+K opens search over the app bar with focus in the field"
- A phone's bars keep the essentials and search opens over the app bar / Ctrl+K under a dialog → apps/web/tests/mobile-bars.spec.ts: "Ctrl+K under a modal dialog leaves search closed"
- A phone's bars keep the essentials and search opens over the app bar / A tablet keeps the desktop bars → apps/web/tests/mobile-bars.spec.ts: "C10: a portrait tablet (800×1280) keeps the desktop bars"; "the portrait tablet bar shows the Theme button and keeps the dataset name and search unclipped"
- The More sheet holds what a phone's bars leave out / The sheet's rows → apps/web/tests/mobile-bars.spec.ts: "C3: the More sheet opens on screen and runs an action"
- The More sheet holds what a phone's bars leave out / Contours applies in place → apps/web/tests/mobile-bars.spec.ts: "C3: the More sheet opens on screen and runs an action"
- The More sheet holds what a phone's bars leave out / Export from the sheet → apps/web/tests/mobile-bars.spec.ts: "C4: Export in the sheet opens the Export menu, which an outside tap closes"
- The More sheet holds what a phone's bars leave out / A filter lights the dot → apps/web/tests/mobile-bars.spec.ts: "the More dot shows with a filter applied"
- The More sheet holds what a phone's bars leave out / The theme leaves the dot dark → apps/web/tests/mobile-bars.spec.ts: "the More sheet's Theme row switches the theme and the sheet stays open"; "the theme never lights the More dot"
- The More sheet holds what a phone's bars leave out / A short screen → apps/web/tests/mobile-bars.spec.ts: "C9: the More sheet fits the short screen and scrolls inside"
- The More sheet holds what a phone's bars leave out / Escape one layer at a time → apps/web/tests/mobile-bars.spec.ts: "Escape closes the sheet, then a second Escape clears the selection"
- The structure opens as a sheet on a phone / A first tap opens the sheet folded → apps/web/tests/mobile-plot-touch.spec.ts: "P4: a first tap opens the sheet folded beside the tooltip"; apps/web/tests/mobile-explore-layout.spec.ts: "L2: the structure opens as a sheet along the bottom edge"
- The structure opens as a sheet on a phone / Expanding the sheet → apps/web/tests/mobile-explore-layout.spec.ts: "L2: the structure opens as a sheet along the bottom edge"; apps/web/tests/mobile-plot-touch.spec.ts: "the grip and the header row toggle the sheet; the close button does not"
- The structure opens as a sheet on a phone / Tapping above an expanded sheet → apps/web/tests/mobile-plot-touch.spec.ts: "P5: an expanded sheet covers no tooltip and leaves the plot in view"
- The structure opens as a sheet on a phone / View structure expands the sheet → apps/web/tests/mobile-plot-touch.spec.ts: "P5: an expanded sheet covers no tooltip and leaves the plot in view"
- The structure opens as a sheet on a phone / Closing starts over → apps/web/tests/mobile-plot-touch.spec.ts: "P5: an expanded sheet covers no tooltip and leaves the plot in view"
- The structure opens as a sheet on a phone / The sheet never resizes the plot → apps/web/tests/mobile-plot-touch.spec.ts: "folding and expanding the sheet never resizes the plot"
- The structure opens as a sheet on a phone / The sheet on a phone on its side → apps/web/tests/mobile-plot-touch.spec.ts: "P9: the structure folds under the legend and expands over the right half"
- A phone on its side scrolls once to a full-screen plot / Turning the phone sideways → apps/web/tests/mobile-explore-layout.spec.ts: "L4: turned sideways, the page scrolls past the bar to a full-screen plot"
- A phone on its side scrolls once to a full-screen plot / The landscape bar → apps/web/tests/mobile-bars.spec.ts: "the landscape bar is one 44 px row with search before Projection in Tab order"
- A phone on its side scrolls once to a full-screen plot / The legend column → apps/web/tests/mobile-explore-layout.spec.ts: "at 740×360 the rows keep readable names and the header fits"; "at 844×390 the rows keep readable names and the header fits"
- A touch screen gets finger-sized targets and touch gestures / Pinching the plot → apps/web/tests/mobile-plot-touch.spec.ts: "P1: a pinch zooms the plot, not the page"
- A touch screen gets finger-sized targets and touch gestures / Tapping near the edge → apps/web/tests/mobile-plot-touch.spec.ts: "P2: a tap near the right edge shows the tooltip inside the plot"; "P2b: a tap pins the compact card, clear of the protein it names"
- A touch screen gets finger-sized targets and touch gestures / Closing the card → apps/web/tests/mobile-plot-touch.spec.ts: "P3: a tap on empty space or a pan closes the tooltip"
- A touch screen gets finger-sized targets and touch gestures / The legend under a finger → apps/web/tests/mobile-legend.spec.ts: "G1: each row control and header button is a 40 px touch target"
- A touch screen gets finger-sized targets and touch gestures / Reordering by touch → apps/web/tests/mobile-legend.spec.ts: "G3: a long press on a drag handle lifts the row to reorder it"; "G2: a swipe that starts on a drag handle scrolls the rows without reordering them"
- A touch screen gets finger-sized targets and touch gestures / A double tap without a double-click → apps/web/tests/mobile-legend.spec.ts: "G5: a double tap isolates a category, even where the browser sends no dblclick"
- A touch screen gets finger-sized targets and touch gestures / Dimming on a dark touch screen → apps/web/src/explore/phone-dim.test.ts: "fades unselected points less on a dark touch screen of any layout, and only there"; "fades unselected points less on a phone, and gives the plot's own fade back elsewhere"
- Dialogs and popovers fit a phone / The legend settings on a phone → apps/web/tests/mobile-legend.spec.ts: "G7: the settings popover fits the screen with its controls in reach"
- Dialogs and popovers fit a phone / The Figure editor on a phone → apps/web/tests/mobile-legend.spec.ts: "G8: the Figure editor fits the screen, stacked upright and side by side sideways, with 40 px targets"
- Dialogs and popovers fit a phone / A confirmation on a 360 px phone → apps/web/tests/mobile-bars.spec.ts: "the confirm dialog and the Import panel fit a 360 px screen"
- Dialogs and popovers fit a phone / Popovers from a legend row → apps/web/tests/mobile-legend.spec.ts: "the colour picker and the Other popover opened from a full-width row stay inside the viewport"
- Dialogs and popovers fit a phone / The Filter builder on a phone → apps/web/tests/mobile-bars.spec.ts: "C6: the Filter tab shows the builder with its actions on screen"

## docs-media-generation

- Every documentation image comes from one capture manifest / A name used twice → apps/web/src/explore/docs-images.test.ts: "reports a name used twice once, and why"
- Every documentation image comes from one capture manifest / A file no entry makes → apps/web/src/explore/docs-images.test.ts: "fails a file no entry makes"
- Every documentation image comes from one capture manifest / An output missing on disk → apps/web/src/explore/docs-images.test.ts: "fails an output missing on disk"
- Captures drive the app the way the end-to-end suite does / A scene reaches into a shadow root → apps/web/src/explore/docs-images.test.ts: "never reaches into a shadow root"
- Captures drive the app the way the end-to-end suite does / A timer in a scene → apps/web/src/explore/docs-images.test.ts: "keeps timers and page evaluation out of the scenes"; "waits on a timer only in the runner's hold"
- Captures drive the app the way the end-to-end suite does / A new timer in a shared helper → apps/web/src/explore/docs-images.test.ts: "counts every timer in the helpers it imports"
- A screenshot's dark twin is shown as a pair / A pair written as the docs expect → apps/web/src/explore/docs-images.test.ts: "passes a light image followed by its dark twin"
- A screenshot's dark twin is shown as a pair / A dark image without its light twin → apps/web/src/explore/docs-images.test.ts: "fails a -dark image shown without its light twin before it"; "fails a -dark file without its light twin"
- A screenshot's dark twin is shown as a pair / A raw pair with an inline display → apps/web/src/explore/docs-images.test.ts: "fails a raw pair with an inline display, which shows both twins"
- A screenshot's dark twin is shown as a pair / A dark GIF entry → apps/web/src/explore/docs-images.test.ts: "reports a dark GIF once, and why"
- GIFs fit a size budget / The default budget → apps/web/src/explore/docs-images.test.ts: "defaults to 3 MiB"
- GIFs fit a size budget / The ladder → apps/web/src/explore/docs-images.test.ts: "steps the frame rate down, then the width"
- GIFs fit a size budget / One byte over → apps/web/src/explore/docs-images.test.ts: "fails a GIF one byte over its budget"
- The example thumbnails come from the capture pipeline / Every example has a thumbnail → apps/web/src/explore/docs-images.test.ts: "passes every page and image" (real docs); code path: scripts/docs-screenshots/scenes/examples.ts EXAMPLE_CAPTURES (one entry per EXAMPLE_DATASETS item); apps/web/tests/examples-live.spec.ts writes no image
- The image check runs before every commit / An anchor no heading has → apps/web/src/explore/docs-images.test.ts: "fails an anchor no heading has"
- The image check runs before every commit / Removed UI in the user guide → apps/web/src/explore/docs-images.test.ts: "reports every line that names removed UI, and skips code and front matter"; "leaves the developer docs alone"
- The image check runs before every commit / The real docs pass → apps/web/src/explore/docs-images.test.ts: "passes every page and image"; code path: package.json "precommit" runs `pnpm docs:images:check`

## category-focus

- The keyboard shortcut list names Shift + Hover / Opening the keyboard shortcut list → code path: apps/web/src/workbench/shortcuts.ts SHORTCUT_GROUPS, Plot group `{ keys: ['Shift'], action: 'Hold over a point to focus its category' }`, rendered by ShortcutsDialog.tsx with formatKeys (`⇧` on Apple, `Shift` elsewhere); apps/web/tests/workbench-help.spec.ts: "Keyboard shortcuts opens a dialog listing the search shortcut; Escape closes it and returns focus to Help"; "the plot has no tips button"

## density-contours

- The Contours control SHALL offer Off, Auto and Always / Default mode → packages/core/src/components/contours-menu/contours-menu.browser.test.ts: "the trigger's name starts with Contours"; "offers Off, Auto and Always with their hints"
- The Contours control SHALL offer Off, Auto and Always / Picking a mode → packages/core/src/components/contours-menu/contours-menu.browser.test.ts: "a menu pick dispatches density-layer-change after the paint"; apps/web/tests/workbench-view-bar.spec.ts: "picking a projection, an annotation and a contour mode updates the plot, the legend and the URL"
- The Contours control SHALL offer Off, Auto and Always / Keyboard use → packages/core/src/components/kit/menu.browser.test.ts: "focuses the checked item when it opens"; "selects with Enter, tells the owner, closes and returns focus to the anchor"
- (text, More menu and sheet) → apps/web/tests/workbench-view-bar.spec.ts: "More shows a dot with contours on, and Auto there sets density=auto in the URL"; apps/web/tests/mobile-bars.spec.ts: "C3: the More sheet opens on screen and runs an action"; contours-menu.browser.test.ts: "re-picking the mode on screen dispatches nothing and drops a waiting pick"

## scatterplot-point-size

- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Default for a small dataset → packages/core/src/components/legend/legend.shape-size.test.ts: "starts a fresh dataset at 10, drawn as point size 80"; packages/core/src/components/legend/legend-helpers.test.ts: "keeps 10 up to 10,000 proteins"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Default for a large dataset → packages/core/src/components/legend/legend-helpers.test.ts: "shrinks with the protein count as (10,000 / N)^(2/3)"; legend.shape-size.test.ts: "defaults a large dataset by its protein count when the annotation stores the filler 10"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Default for Swiss-Prot → packages/core/src/components/legend/legend-helpers.test.ts: "never goes below the smallest size the dialog accepts"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Hiding categories or isolating → packages/core/src/components/legend/legend.shape-size.test.ts: "sizes dots by the whole dataset's protein count, also with categories hidden"; "counts the whole dataset, not the filtered view"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / The popover names the default → packages/core/src/components/legend/legend.shape-size.test.ts: "names the default in the settings popover and returns to it from an emptied field"; legend-settings-popover.browser.test.ts: "an emptied size fires shapeSize: null and shows the default as placeholder"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Emptying the size field → packages/core/src/components/legend/legend-settings-popover.browser.test.ts: "an emptied size fires shapeSize: null and shows the default as placeholder"; "Enter or leaving the field fires at once"; "commits exactly SETTINGS_INPUT_DEBOUNCE_MS after the last input"; legend.shape-size.test.ts: "an emptied size field returns the dataset to its default on Save" (the title is older than the popover; the test drives `pick(null)`, no Save)
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Oversized entry → packages/core/src/components/legend/legend-settings-popover.browser.test.ts: "640 becomes 64 in the field and in the event"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Oversized bundle size → packages/core/src/components/legend/legend.shape-size.test.ts: "caps a bundle size at 64 and saves the capped size"
- The legend shape size SHALL default from the dataset's protein count and never exceed 64 / Oversized stored size → packages/core/src/components/legend/legend.shape-size.test.ts: "caps a stored size at 64"
- (text: no Save) → packages/core/src/components/legend/legend-settings-popover.browser.test.ts: "there is no Save or Cancel and no title attribute"

## annotation-presentation

- Legend marks predicted annotations / Predicted annotation active → packages/core/src/components/legend/legend.header.test.ts: "a predicted annotation shows the sparkles icon named Predicted annotation, and no ⚡ or note"
- Legend marks predicted annotations / Experimental annotation active → packages/core/src/components/legend/legend.header.test.ts: "a predicted annotation shows the sparkles icon named Predicted annotation, and no ⚡ or note" (its family legend has no predicted mark)

## support-contact

- Feedback action in header / Header feedback button present → code path: apps/web/src/components/Header.tsx Feedback CTA (`FEEDBACK_HREF`, desktop and mobile menus); apps/web/tests/workbench-shell.spec.ts: "the landing and privacy pages keep the site header"; apps/web/src/lib/support.test.ts: "targets the support inbox and encodes subject and body"
- Feedback action in header / Feedback on the explore page → apps/web/tests/mobile-bars.spec.ts: "Feedback closes the sheet as it opens the mail client"; "C3: the More sheet opens on screen and runs an action"; code path: apps/web/src/workbench/AppBar.tsx `<a href={FEEDBACK_HREF} aria-label="Feedback">` with `<ps-tooltip text="Feedback">` (no desktop e2e asserts it)
- Every notification on the explore page can be dismissed / A notification with an action → apps/web/tests/workbench-feedback.spec.ts: "a toast sits inside the plot's horizontal span, does not intersect #myLegend and has a close button named Dismiss notification"

## protein-resource-links

- Structure viewer exposes protein resource links / The row lists every resource in order → packages/core/src/components/structure-viewer/structure-viewer.component.test.ts: "renders every resource link, in order, as a safe new-tab link"
- Structure viewer exposes protein resource links / Resource links are distinguishable from the accession beside them → packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts: "the title is 13 px semibold with an icon, and the links take the accent text colour"
- Structure viewer exposes protein resource links / The title is not a hidden link → packages/core/src/components/structure-viewer/structure-viewer.component.test.ts: "renders the title as plain text, not a hidden AlphaFold link"
- Structure viewer exposes protein resource links / The narrowest placements → apps/web/tests/workbench-structure.spec.ts: "the TED link is clickable docked at 240 px and floating at 280 px"; packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts: "at 240 px wide every resource link is visible and inside the host box"
- Structure viewer exposes protein resource links / A pinned tooltip offers the row → apps/web/tests/workbench-structure.spec.ts: "the pinned View structure tooltip offers the links"; apps/web/tests/mobile-plot-touch.spec.ts: "P2b: a tap pins the compact card, clear of the protein it names"
- (text, phone sheet) → apps/web/tests/mobile-plot-touch.spec.ts: "P9: the structure folds under the legend and expands over the right half"; code path: apps/web/src/workbench/workbench.css folded-sheet rule hides `::part(links)` and `::part(body)`

## structure-coloring

- A disabled structure colour option says why / Still loading → packages/core/src/components/structure-viewer/structure-viewer.browser.test.ts: "hovering the disabled TED option shows why it is disabled"; structure-viewer.coloring.test.ts: "keeps the color toolbar mounted but disabled while a structure loads"
- A disabled structure colour option says why / No TED domains → packages/core/src/components/structure-viewer/structure-viewer.coloring.test.ts: "disables TED coloring when no assignments are available"; "TED without domains is aria-disabled and a change event for it applies nothing"
EOF
```

If Step 1 or Step 6 added a MODIFIED block not listed here, add its scenarios' lines under the same section before running the checks.

- [ ] **Step 12: Format and run the spec checks**

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" \
  | grep -oE '"(explore-mobile-layout|docs-media-generation|category-focus|density-contours|scatterplot-point-size|annotation-presentation|support-contact|protein-resource-links|structure-coloring)"' \
  | sort -u
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py explore-mobile-layout docs-media-generation category-focus density-contours scatterplot-point-size annotation-presentation support-contact protein-resource-links structure-coloring
grep -nE "control bar|Tips|⚡|\\.ts\\b|:[0-9]+\\b" openspec/changes/explore-workbench/specs/*/spec.md \
  | grep -v -- "- FROM:"
grep -n "⚡" openspec/changes/explore-workbench/specs/annotation-presentation/spec.md
awk 'length > 100 { print FILENAME ":" FNR }' \
  openspec/changes/explore-workbench/specs/{explore-mobile-layout,docs-media-generation,category-focus,density-contours,scatterplot-point-size,annotation-presentation,protein-resource-links,structure-coloring}/spec.md
```

Expected:

- Prettier rewrites nothing of substance (it may re-indent a continuation line; read `git diff --stat` on the folder to be sure).
- `validate --strict`: `Change 'explore-workbench' is valid`. A failure names the file and requirement (most often a requirement without a `#### Scenario:` or a scenario header with three hashes): fix it there.
- The `change show` grep prints the nine names. If the JSON keys capabilities differently (e.g. under `"specName"` or a path), run the command without the second grep once, find where a capability's name sits, and grep that field instead.
- `check-headers.sh`: no output and `exit 0`. A `WARN … fewer scenarios than main` line is not expected for these files (every MODIFIED block keeps at least main's count); if one appears, the block lost a scenario in copying: restore it from `openspec/specs/<cap>/spec.md`, do not explain it away. Record "no WARN" in `spec-evidence.md` under `## category-focus` (the renamed block keeps main's one scenario, rewritten).
- `evidence: 0 problem(s)`. An `unparsed ref`, `no evidence for` or `title not in` line names an evidence line to fix (the evidence format of Global Constraints (Spec content rules); the key is the full requirement name, never shortened): fix the line, never the checker.
- The stale-wording grep prints nothing. The `- FROM:` line in `category-focus` names "Tips" by necessity and is the only line the filter drops; if anything else prints, reword it.
- The `⚡` grep prints nothing.
- The `awk` check prints only `scatterplot-point-size`'s requirement header (headers are copied byte for byte, never wrapped). `support-contact` is left out on purpose: it keeps main's long scenario line, copied unchanged. `awk` may count bytes, so a line that is long only because of `⇧`, `×` or `—` is fine. Any other hit is a line to rewrap by hand (Prettier preserves prose wrapping).

- [ ] **Step 13: Run three cited tests, one per group**

```bash
# phones, unit (sandbox on is fine)
pnpm --filter @protspace/app exec vitest --run src/explore/layout-mode.test.ts src/explore/phone-dim.test.ts
# docs media, unit
pnpm --filter @protspace/app exec vitest --run src/explore/docs-images.test.ts
# moved controls, browser (sandbox disabled)
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/structure-viewer/structure-viewer.browser.test.ts \
  src/components/legend/legend-settings-popover.browser.test.ts
# phones, e2e on the mobile project (sandbox disabled)
PLAYWRIGHT_PORT=8475 pnpm test:e2e mobile-bars.spec.ts --project=mobile \
  -g "C3: the More sheet opens on screen and runs an action"
```

Expected: all pass (the counts of each file in the report). A failure here is a code regression since 8.15, not a spec problem: stop and report it with the failing test's first error; do not edit the spec to match a broken test.

- [ ] **Step 14: Commit**

`git status --short` must show only the nine new folders under `openspec/changes/explore-workbench/specs/` (the evidence file is git-ignored). Then (sandbox disabled; the hook runs `pnpm precommit`):

```bash
git add openspec/changes/explore-workbench/specs/explore-mobile-layout \
  openspec/changes/explore-workbench/specs/docs-media-generation \
  openspec/changes/explore-workbench/specs/category-focus \
  openspec/changes/explore-workbench/specs/density-contours \
  openspec/changes/explore-workbench/specs/scatterplot-point-size \
  openspec/changes/explore-workbench/specs/annotation-presentation \
  openspec/changes/explore-workbench/specs/support-contact \
  openspec/changes/explore-workbench/specs/protein-resource-links \
  openspec/changes/explore-workbench/specs/structure-coloring
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git commit -m "docs(openspec): specify phones, docs media and the moved controls"
```

Report: the outputs of Step 12's commands (validate line, the nine names, the header check's exit, both greps empty), Step 13's pass counts, the commit hash, every sentence you changed because the code disagreed with this plan (for 8.24), and any requirement beyond the six listed headers you added to a modified delta and why.

### Task 8.23: Spec files for the behaviour changes, and the whole change validated

Eleven modified capabilities whose behaviour changed: the filter's draft, the pickers' Escape and focus, search reporting, the EAT controls and connectors, choosing examples, notification actions, the e2e and perf harnesses. It ends with the whole change passing strict validation and the header check.

**Files:**

- Create: `openspec/changes/explore-workbench/specs/query-builder-filtering/spec.md`, `…/query-builder-controls/spec.md`, `…/protein-search-feedback/spec.md`, `…/eat-annotation-overlay/spec.md`, `…/eat-reliability-filter/spec.md`, `…/eat-provenance-connectors/spec.md`, `…/example-datasets/spec.md`, `…/prep-failure-routing/spec.md`, `…/e2e-validation/spec.md`, `…/webgl-perf-harness/spec.md`, `…/perf-checks/spec.md`
- Modify: `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md`

**Interfaces:**

- Consumes (headers to copy byte-for-byte, R1 §1): `query-builder-filtering` `:9 Filter query builder is opened from the control bar` (RENAMED to `Filter queries are built in the Filter panel`, then MODIFIED), `:38 Applying a filter isolates the view to matched proteins` (`:46` "the control bar reports `filterActive`" → its new owner), `:54 Reset All clears the active filter` (Undo); ADDED: the draft and Cancel, the disabled Apply's reason, the live match count. `query-builder-controls` `:9 Query builder controls carry the design system's focus indicator`, `:37 The picker option lists are navigable by keyboard` (Escape inside a modal → the Escape order), `:159 Composing a shared stylesheet must not reorder another component's cascade`. `protein-search-feedback` `:79 Generic no-match feedback remains available`; ADDED: the unknown-ID message, the found/missing report with Copy missing IDs, a single hit centred and zoomed, several hits selected. `eat-annotation-overlay` `:101 EAT overlay controls are conditional, accessible, and persisted`, `:258 Reliability threshold filters sub-threshold predictions` (and the export surface colour where its text names it). `eat-reliability-filter` ADDED only: the control writes the applied filter at once and mirrors into an open draft; editing the draft moves the control only on Apply. `eat-provenance-connectors` `:125 Connector state is dismissable and non-colour-dependent` (its place in the Escape order). `example-datasets` `:48 Choosing an example from the Import menu` ("Open a file…", "Last file", examples keep the stored import, the app bar's Import menu and the More sheet on phones, the dataset name opens the same menu), `:194 Request precedence` (`:231` "named in the control bar" → the app bar). `prep-failure-routing` `:62 Notifications support an optional action` (up to two, link or callback; `:37` and `:51-54` untouched). `e2e-validation` `:49 Browser compatibility coverage is explicit`, `:105 Heavyweight and live suites are explicit` (Rulings). `webgl-perf-harness` ADDED: measured runs pin the sidebar layout (`DEFAULT_LAYOUT`) and the light theme (`perf-scale.spec.ts` `colorScheme: 'light'`, `exploreStorageState(…, { layout: DEFAULT_LAYOUT, theme: 'light' })`). `perf-checks` `:61 A segment's reset SHALL restore the plot's pixels` (the colour scheme pinned); ADDED: the panel-toggle segment budgeted at one render and one grid rebuild, and the hover segment at zero renders (`apps/web/tests/helpers/perf/scenarios.ts`, perf budgets). Sources: `apps/web/src/workbench/{FilterPanel,FilterControl}.tsx`, `apps/web/src/explore/filter-controller.ts`, `packages/core/src/components/query-builder/`, `protein-search.ts`, `legend-eat-controls.ts`, `eat-provenance.ts`, `import-controller.ts`, `example-datasets.ts`, `notifications.ts`, `use-file-drop.ts` → `#myDataLoader` `file-dropped`, `scripts/docs-screenshots/` (thumbnails), `perf-scale.spec.ts`, `perf-counts.spec.ts`. Evidence: `workbench-filter.spec.ts`, `numeric-binning.spec.ts`, `filter-controller.test.ts`, query-builder tests, `workbench-search.spec.ts`, `eat-visualization.spec.ts`, `interaction-controller.eat.test.ts`, `workbench-escape.spec.ts`, `example-datasets.spec.ts`, `import-controller.test.ts`, `notifications.test.ts`, `file-drop.test.ts`, `docs-images.test.ts`, `perf-counts.spec.ts`, `perf-scale.spec.ts`.
- Produces: eleven delta files; the RENAMED name `Filter queries are built in the Filter panel` exactly.
- Consumes from Task 8.19: `bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh <change-dir> <specs-dir>` (exit 0 and no output when clean; exit 1 with `<cap>: <message>: <requirement>` lines; `WARN …` lines for a MODIFIED block with fewer scenarios than main).
- Consumes from Tasks 8.20–8.22: the 18 delta files written so far (ownership: the Filter rail item's place is `explore-workbench-layout`'s, the filter chip's ✕ is `selection-workflow`'s, the phone panel's Filter tab is `explore-mobile-layout`'s); `spec-evidence.md` and its line format (`- <Requirement> / <Scenario> → <file>: "<title>"`, refs joined by `; `, a further title of the same file as `; "<title>"`, trailing ` (<note>)` allowed, `code: <file> <what>` for a code path, a config or a listing); `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (prints `evidence: <n> problem(s)`, exit 0 when clean).

**Tests:** the spec checks for the whole change: `openspec validate explore-workbench --strict` passes; `change show --deltas-only` lists all 29 capabilities; `check-headers.sh` exits 0 with every WARN explained in `spec-evidence.md`; `ls openspec/changes/explore-workbench/specs | wc -l` is 29 and matches the Global Constraints list exactly (`comm` against it prints nothing); three cited tests run per the 8.20 rule (one `numeric-binning` or `workbench-filter` e2e via `-g`); `grep -rnE "control bar|Tips popover|⚡|presses Save|site header" openspec/changes/explore-workbench/specs` prints nothing beyond the `- FROM:` lines, `support-contact`'s retained site-header sentence and `explore-workbench-layout`'s site-header lines (Step 13); `check-evidence.py` over the eleven capabilities, then over all 29, prints `evidence: 0 problem(s)`.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Every `openspec` call is filtered with `2>&1 | grep -v "trust settings"`. `git commit`, `--project browser` and `pnpm test:e2e` need the sandbox disabled.

Three notes that hold for the whole task:

- **Requirements beyond the listed headers.** Reading the main specs against the code at `d071e1da` found four more requirements whose text is false; they are in the deltas below and named in the report (Rulings: "change only what is false"): `query-builder-filtering` `Loading a new dataset clears active filters` and `numeric-binning e2e suite passes against the query builder` (both name a `filterActive` that only the deleted control bar had; the plot's property is `filtersActive`), and `eat-annotation-overlay` `Overlay coalesces categories without mutating curated data` (its last scenario says an export keeps the live plot surface inside transferred markers; exports use white, since they are always light). Re-read the whole of each main spec anyway: if HEAD moved (8.16, 8.18), more may apply.
- **The final greps and the lines that must stay.** The RENAMED `- FROM:` lines name the old headers ("Tips popover", "control bar") because the archive matches them; and `support-contact` (8.22) keeps main's true sentence that the landing and Privacy pages' site header shows Feedback. `explore-workbench-layout` (8.20) says /explore replaces the site header and the other pages keep it. Step 13's grep skips exactly those; everything else must be clean.
- **Write from the code.** Where a sentence below and the code at your HEAD disagree, the code wins: change the sentence, keep the evidence line true, and name the disagreement in the report for 8.24.

- [ ] **Step 1: See the eleven capabilities missing and confirm the headers**

```bash
for cap in query-builder-filtering query-builder-controls protein-search-feedback \
  eat-annotation-overlay eat-reliability-filter eat-provenance-connectors example-datasets \
  prep-failure-routing e2e-validation webgl-perf-harness perf-checks; do
  [ -f "openspec/changes/explore-workbench/specs/$cap/spec.md" ] && echo "present $cap" \
    || echo "missing $cap"
done
ls openspec/changes/explore-workbench/specs | wc -l
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
```

Expected (the failing check): eleven `missing` lines; the folder holds 18 capabilities (8.20–8.22); validation already passes on those 18. If any of the eleven is `present`, stop and report.

Then confirm each header this task copies, byte for byte, in its main spec:

```bash
check() { grep -nxF "### Requirement: $2" "openspec/specs/$1/spec.md" || echo "MISSING $1: $2"; }
check query-builder-filtering "Filter query builder is opened from the control bar"
check query-builder-filtering "Applying a filter isolates the view to matched proteins"
check query-builder-filtering "Reset All clears the active filter"
check query-builder-filtering "Loading a new dataset clears active filters"
check query-builder-filtering "numeric-binning e2e suite passes against the query builder"
check query-builder-controls "Query builder controls carry the design system's focus indicator"
check query-builder-controls "The picker option lists are navigable by keyboard"
check query-builder-controls "Composing a shared stylesheet must not reorder another component's cascade"
check protein-search-feedback "Generic no-match feedback remains available"
check eat-annotation-overlay "EAT overlay controls are conditional, accessible, and persisted"
check eat-annotation-overlay "Overlay coalesces categories without mutating curated data"
check eat-annotation-overlay "Reliability threshold filters sub-threshold predictions"
check eat-provenance-connectors "Connector state is dismissable and non-colour-dependent"
check example-datasets "Choosing an example from the Import menu"
check example-datasets "Request precedence"
check prep-failure-routing "Notifications support an optional action"
check e2e-validation "Browser compatibility coverage is explicit"
check e2e-validation "Heavyweight and live suites are explicit"
check perf-checks "A segment's reset SHALL restore the plot's pixels"
```

Expected: nineteen `<line>:### Requirement: …` lines and no `MISSING`. Then confirm no ADDED name below already exists in its main spec:

```bash
for pair in \
  "query-builder-filtering|The Filter panel edits a draft that Apply commits and Cancel discards" \
  "query-builder-filtering|A disabled Apply says why" \
  "query-builder-filtering|The panel counts the matches as the query changes" \
  "protein-search-feedback|An unknown ID is reported by name" \
  "protein-search-feedback|A pasted list reports what was found and what was not" \
  "protein-search-feedback|One hit is brought into view; several are selected in place" \
  "protein-search-feedback|A hit the current view hides is still selected" \
  "eat-reliability-filter|The control writes the applied filter, and an open draft follows it" \
  "webgl-perf-harness|Measured runs pin the layout and the theme" \
  "perf-checks|The counts gate budgets the layout, theme and hover segments"; do
  cap=${pair%%|*}; name=${pair#*|}
  grep -qxF "### Requirement: $name" "openspec/specs/$cap/spec.md" && echo "EXISTS $cap: $name"
done; echo done
```

Expected: only `done`.

- [ ] **Step 2: Write `query-builder-filtering`**

Create `openspec/changes/explore-workbench/specs/query-builder-filtering/spec.md`. RENAMED first; then the five MODIFIED blocks, each main's requirement with all its scenarios, edited; then three ADDED:

```markdown
## RENAMED Requirements

- FROM: `### Requirement: Filter query builder is opened from the control bar`
- TO: `### Requirement: Filter queries are built in the Filter panel`

## MODIFIED Requirements

### Requirement: Filter queries are built in the Filter panel

The view bar's Filter button SHALL open the sidebar's Filter panel in place of the legend and move
focus to the panel's "Filter" heading; it SHALL never close the panel, and opening it SHALL NOT
resize the plot. On a desktop the rail's Filter item SHALL open the panel too and show as pressed
while it is open, and the panel's "Close filter" button SHALL return to the legend with focus on the
rail's Filter item; below 951 px the panel is the Filter tab (explore-mobile-layout). The panel
SHALL hold the `protspace-query-builder` element under its own heading, with no title or close
button of the builder's own, and SHALL show exactly one empty condition row while no filter is
applied. Which panel is open is part of the stored layout; the filter itself is not stored.

#### Scenario: Opening the panel seeds an empty condition

- **WHEN** the user clicks the view bar's `Filter` button with no applied filter
- **THEN** the Filter panel is shown in place of the legend, its heading has focus, and it contains
  one `protspace-query-condition-row`
- **AND** the plot is not resized

#### Scenario: The rail's Filter and Close filter

- **WHEN** the user opens the Filter panel from the rail and then presses "Close filter"
- **THEN** the rail's Filter item shows as pressed while the panel is open, and afterwards the
  legend is shown again with focus on the rail's Filter item

#### Scenario: A reload keeps the panel, not the filter

- **WHEN** a filter is applied and the page is opened again
- **THEN** the Filter panel is still the one shown, with one empty condition row and no filter
  applied

### Requirement: Applying a filter isolates the view to matched proteins

The query builder SHALL evaluate the query and, on the primary `Apply` action, drive the
scatter-plot's dedicated filter channel: the matched protein ids are written to
`filteredProteinIds` and `filtersActive` is set. The view bar's Filter button SHALL then show the
number of applied conditions (its accessible name reads, for example, "Filter, 1 condition
applied"), the rail's Filter item SHALL show a dot, and the plot SHALL show the filter's status chip
(selection-workflow). After applying, `getCurrentData().protein_ids` SHALL contain exactly the
matched proteins (the plot data is physically culled to the matched set), and the Filter panel
SHALL stay open, its draft now equal to the applied filter. The primary `Apply` button SHALL be
disabled when the query has no configured condition, matches zero proteins, matches the entire
dataset, or equals the filter already applied.

#### Scenario: Applying a single-condition filter

- **WHEN** the user sets one condition (e.g. a numeric `between` range) and clicks `Apply`
- **THEN** `getCurrentData().protein_ids` contains exactly the proteins matching the condition
- **AND** the plot's `filtersActive` is set and the Filter button reads "Filter, 1 condition
  applied"
- **AND** the Filter panel stays open, and Apply is disabled with "No changes to apply"

#### Scenario: Zero-match query disables Apply and leaves the view unchanged

- **WHEN** a query matches no proteins (e.g. a numeric range above every value)
- **THEN** the match count reads `0 of N proteins match`, the primary `Apply` button is disabled
  with the reason "No proteins match", and the view stays on the full dataset (it cannot be
  applied, so it neither collapses to empty nor falls back via a stale filter)

### Requirement: Reset All clears the active filter

The query builder SHALL provide `Reset`, which clears the applied filter and the draft (the filter
channel is released: `filteredProteinIds = []`, `filtersActive = false`; the Filter button's count,
the rail's dot and the filter chip go), and seeds a fresh empty condition while leaving the panel
open for a new query. A Reset that removed an applied filter SHALL be one step of the undo history,
so Undo brings the filter back; a Reset with nothing applied records nothing.

#### Scenario: Reset restores the full dataset

- **WHEN** a filter is active and the user clicks `Reset`
- **THEN** the filter is cleared and the full dataset is visible again
- **AND** the panel stays open with one empty condition row

#### Scenario: Undo after Reset

- **WHEN** the user resets an applied filter and then chooses Undo
- **THEN** the filter is applied again, with its status chip and its condition count

### Requirement: Loading a new dataset clears active filters

Loading a replacement dataset SHALL clear any active query-builder filter and its draft, so the
replacement renders unfiltered and the Filter panel shows one empty condition row.

#### Scenario: Replacement dataset renders unfiltered

- **WHEN** a filter is active and a new dataset is loaded
- **THEN** the plot's `filtersActive` is false and the full replacement dataset is visible

### Requirement: numeric-binning e2e suite passes against the query builder

The `numeric-binning` Playwright project SHALL drive the shipped query-builder UI — the numeric
operator+range input for numeric annotations and the value picker for categorical annotations — in
the Filter panel, and assert on the filter model (`getCurrentData().protein_ids` subset and the
plot's `filtersActive`), not the removed `.filter-menu` DOM or numeric bin value-picker. All tests
in the project SHALL pass.

#### Scenario: Full numeric-binning project is green

- **WHEN** `pnpm test:e2e --project=numeric-binning` is run against the shipped UI
- **THEN** every test passes

## ADDED Requirements

### Requirement: The Filter panel edits a draft that Apply commits and Cancel discards

Edits in the Filter panel SHALL change a draft only: neither the plot nor the legend changes until
Apply. Apply SHALL make the draft the applied filter. `Cancel` SHALL be enabled only while the draft
differs from the applied filter, and SHALL return the draft to it, or to one empty condition row
while no filter is applied. Removing the filter elsewhere (the filter chip's ✕) SHALL leave a
changed draft as it is and reset an unchanged one to one empty row.

#### Scenario: An edit waits for Apply

- **WHEN** the user adds a value to a condition and does not press Apply
- **THEN** the plot's filter channel is unchanged

#### Scenario: Cancel restores the applied filter

- **WHEN** a filter is applied, the user adds a second condition, and presses Cancel
- **THEN** the draft holds the applied filter's one condition again, Cancel is disabled, and the
  filter stays applied

#### Scenario: Removing the filter with a changed draft

- **WHEN** the draft differs from the applied filter and the filter is removed from its chip
- **THEN** the filter is removed and the draft keeps its edits

### Requirement: A disabled Apply says why

While Apply is disabled the panel SHALL show the reason under the match count, and the Apply button
SHALL be described by it: "Add a condition" when no row is configured; "Choose an annotation for
condition N" for a negated row without an annotation; "Choose a value for condition N" or "Enter a
number for condition N" for a row with an annotation but nothing to match, numbering conditions in
display order with groups' conditions included; "No changes to apply" when the draft equals the
applied filter; "No proteins match" and "Every protein matches; nothing to filter" for the counts.
While a count is pending no reason SHALL show, so a stale count is never quoted.

#### Scenario: An incomplete row

- **WHEN** the first condition has a categorical annotation and no value
- **THEN** the reason reads "Choose a value for condition 1" and Apply is disabled

#### Scenario: Apply is described by its reason

- **WHEN** Apply is disabled
- **THEN** its accessible description is the visible reason

### Requirement: The panel counts the matches as the query changes

The Filter panel SHALL show, in a status region, how many proteins the draft keeps as
"<n> of <N proteins> match", counted over the whole loaded dataset, and SHALL count again after each
edit, once typing pauses. The builder SHALL count only while the panel is on screen; a panel that
comes on screen SHALL count the latest data and draft.

#### Scenario: The count follows an edit

- **WHEN** the panel opens on the seeded empty row and the user then sets a categorical condition
- **THEN** the count first reads the whole dataset's size, then a smaller number, ending in
  "proteins match" or "protein match"

#### Scenario: A hidden panel does not count

- **WHEN** the data changes while the Filter panel is not shown, and the panel is then opened
- **THEN** the builder received no data while hidden, and gets the latest when it is shown
```

Check the reason texts against `applyBlockText` in `packages/core/src/components/query-builder/query-apply-state.ts` and the count text against `query-builder.ts`'s `.match-count` template before going on; quote them exactly.

- [ ] **Step 3: Write `query-builder-controls`**

Create `openspec/changes/explore-workbench/specs/query-builder-controls/spec.md` (three MODIFIED blocks, all scenarios kept; the second block changes only its Escape sentence and that scenario):

```markdown
## MODIFIED Requirements

### Requirement: Query builder controls carry the design system's focus indicator

Every interactive control in the query builder SHALL show the design system's focus indicator rather
than the browser's default. The query builder's stylesheet SHALL compose the kit's shared focus-ring
sheet and read the `--ps-*` tokens instead of restating the ring, because the row and picker
components have their own shadow roots and inherit custom properties but not component classes from
the Filter panel around them. Where a control's box needs the ring placed differently, as the
pickers' search fields and the number fields draw it on their border, the stylesheet SHALL change
only the ring's offset, never its colour or width.

#### Scenario: Focusing the comparison operator

- **WHEN** a user tabs to the numeric comparison operator control
- **THEN** it shows the design system's focus ring
- **AND** not the browser's default focus ring, which follows the operating system accent colour and
  can render as an unrelated colour

#### Scenario: A control that draws the ring on its border

- **WHEN** a number field or a picker's search field has keyboard focus
- **THEN** it shows the same ring, in the design system's focus colour and width, on its border
- **AND** the stylesheet keeps only the offset as a local declaration for that control

#### Scenario: Picker rendered outside the Filter panel's shadow root

- **WHEN** a picker component renders in its own shadow root
- **THEN** its controls are styled identically to the same controls elsewhere in the app

### Requirement: The picker option lists are navigable by keyboard

Both query builder pickers SHALL support the same keyboard contract as the app's other searchable
dropdowns: `ArrowDown` and `ArrowUp` walk the filtered list and SHALL clamp at each end rather than
wrapping, `Enter` commits the current row, and `Escape` closes the dropdown. An open picker SHALL be
the top layer of the page's Escape order, so `Escape` closes only the picker and not the dialog
around it or anything the next Escape would close. Opening a closed picker from its trigger SHALL
be possible with `Enter` or `Space`. This contract SHALL be stated once and shared by every
component that implements a searchable listbox, so the keyboard does not behave differently from
one dropdown to the next.

#### Scenario: Walking the list

- **WHEN** the picker is open and the user presses ArrowDown repeatedly
- **THEN** the highlight advances one row at a time through the filtered list
- **AND** stops on the last row rather than wrapping to the first

#### Scenario: Escape with a picker open

- **WHEN** the user presses Escape with a picker open in the query builder
- **THEN** the picker closes
- **AND** the layer below it, such as a dialog around the builder, stays open

#### Scenario: Opening from the trigger

- **WHEN** the trigger has keyboard focus and the user presses Enter or Space
- **THEN** the picker opens
- **AND** does not immediately toggle back shut from the same keypress

#### Scenario: A locked-out list

- **WHEN** every entry is locked out because the exclusive "Any value" sentinel is selected
- **THEN** the arrows do not move the highlight and Enter commits nothing, matching the pointer

### Requirement: Composing a shared stylesheet must not reorder another component's cascade

A stylesheet that is itself an array of sheets SHALL be positioned so that any sheet written to
override the shared foundation sheets keeps its place after them. The framework deduplicates a
flattened style array by keeping each sheet's **last** position, so nesting the foundation sheets
inside a composed stylesheet moves them to wherever that stylesheet is listed. Where sheets collide
at equal specificity, the ordering constraint SHALL be documented at the point that depends on it.

#### Scenario: A composed sheet is added to a component that already lists the foundations

- **WHEN** a component's style array contains both the foundation sheets and a composed sheet that
  re-lists them
- **THEN** the sheets that override the foundations still take effect
- **AND** rules such as the query builder's own host layout, listed after its shared sheet, keep the
  values they had before the composed sheet was introduced
```

- [ ] **Step 4: Write `protein-search-feedback`**

Create `openspec/changes/explore-workbench/specs/protein-search-feedback/spec.md`:

```markdown
## MODIFIED Requirements

### Requirement: Generic no-match feedback remains available

The protein search SHALL show generic no-match feedback only while a non-empty query being typed
matches no available protein ID at all. Once the query is submitted with Enter, the report for an
unknown ID SHALL take its place.

#### Scenario: Query matches nothing

- **WHEN** a non-empty query prefix-matches no available protein ID
- **THEN** the search feedback displays `No matching protein IDs found`

#### Scenario: No-match feedback is a rendered popup

- **WHEN** the no-match feedback is displayed
- **THEN** the input reports `aria-expanded` as true and `aria-controls` names the rendered popup
- **AND** the message is announced to assistive technology

#### Scenario: Submitting a query that matches nothing

- **WHEN** the user presses Enter on a query that matches no available protein ID
- **THEN** the no-match feedback gives way to the report "No protein <query> in this dataset"

## ADDED Requirements

### Requirement: An unknown ID is reported by name

When the user submits an ID with Enter that the dataset does not hold, the search SHALL report
"No protein <ID> in this dataset" in its popup, announce it, keep the typed text and change no
selection. When the submitted ID is already selected it SHALL report "<ID> is already selected".
Escape SHALL first close the report, keeping the text, and then empty the field; typing SHALL also
close the report.

#### Scenario: An unknown ID

- **WHEN** the user types `NOT_A_PROTEIN_ZZZ` and presses Enter
- **THEN** the report and the announcement read "No protein NOT_A_PROTEIN_ZZZ in this dataset", the
  field keeps the text, and nothing is selected

#### Scenario: Escape after a report

- **WHEN** the report is shown and the user presses Escape twice
- **THEN** the first Escape closes the report and keeps the text, and the second empties the field

### Requirement: A pasted list reports what was found and what was not

Pasting several IDs (separated by commas, semicolons, spaces or new lines, in any letter case) SHALL
select every ID the dataset holds and, when any is missing or already selected, report
"<found> of <total> found" with a "Not found" list of at most 50 missing IDs followed by "and N
more", and a "Copy missing IDs" button that copies every missing ID, one per line. The button SHALL
read "Copied", or "Could not copy" when the clipboard refuses, for a moment, and the report SHALL
stay. The announcement SHALL be the headline plus the missing count ("2 of 4 found, 2 not found"),
never the list. A paste whose IDs are all found and new SHALL show no report.

#### Scenario: Two of four found

- **WHEN** the user pastes two known IDs and two unknown ones
- **THEN** the two known proteins are selected, the report reads "2 of 4 found" and lists the two
  unknown IDs, and the announcement reads "2 of 4 found, 2 not found"

#### Scenario: Copying the missing IDs

- **WHEN** the user presses Copy missing IDs
- **THEN** the clipboard holds the missing IDs one per line, the button reads "Copied", and the
  report stays on screen

#### Scenario: A long list of missing IDs

- **WHEN** more than 50 pasted IDs are missing
- **THEN** the report lists 50 of them and says how many more there are, and Copy takes them all

### Requirement: One hit is brought into view; several are selected in place

A single protein found with Enter SHALL be selected, centred in the plot and zoomed in on. A pasted
list SHALL be selected without moving the view, and the selection bar's "Zoom to them" SHALL then
bring the selection into view.

#### Scenario: A single hit

- **WHEN** the user types a known ID and presses Enter
- **THEN** the protein is selected, the view zooms in at least eightfold, and the protein sits at
  the plot's centre to within 2 px

#### Scenario: A pasted list

- **WHEN** the user pastes three known IDs
- **THEN** the three proteins are selected, the view does not move, and no report is shown
- **AND** "Zoom to them" in the selection bar then changes the view

### Requirement: A hit the current view hides is still selected

When a found protein is hidden in the current view, for example by a filter, the search SHALL
still select it, SHALL NOT move the view, and SHALL report "<ID> is selected but hidden in
this view".

#### Scenario: A protein the filter hides

- **WHEN** a filter is applied and the user submits the ID of a protein it hides
- **THEN** the protein is selected, the view does not move, and the report reads "<ID> is selected
  but hidden in this view"
```

- [ ] **Step 5: Write `eat-annotation-overlay`**

Create `openspec/changes/explore-workbench/specs/eat-annotation-overlay/spec.md`. Three MODIFIED blocks, each main's requirement with every scenario copied first (`:101` has ten, `:182` nine, `:258` six): in `:101` only the mirror sentence changes; in `:182` the knockout sentence and the last AND of "Hollow cue survives overlapping markers"; in `:258` the mirror sentence and the "Slider and filter mirror two-way" scenario:

```markdown
## MODIFIED Requirements

### Requirement: EAT overlay controls are conditional, accessible, and persisted

For datasets with normalized EAT cells, the annotation selector SHALL mark every base annotation
that has transferred values. When one of those bases is selected, the transferred-annotation legend
SHALL provide an EAT overlay switch and native range plus numeric percentage threshold controls
beside the observed/transferred population key. The range and numeric controls SHALL represent one
value and remain synchronized. The accessible group SHALL default to overlay enabled and threshold
`0` — every prediction shown and the filter box clean — and its threshold SHALL mirror two-way with
the applied `EAT_confidence >= x or N/A` query filter (`eat-reliability-filter` states how a draft
open in the Filter panel follows it). The complete control SHALL be absent when the selected
annotation has no usable EAT cells, including confidence-view and non-EAT selections. Optional
`eatOverlayEnabled` and `eatConfidenceThreshold` bundle settings SHALL validate, normalize, write
even when they are the only settings, and on dataset load seed the slider (which derives the filter
condition only above `0`).

#### Scenario: EAT-capable dataset

- **WHEN** a dataset with normalized EAT cells loads without embedded EAT settings
- **THEN** the switch is enabled and on, the threshold is `0%`, and both controls have accessible
  names and keyboard behavior
- **AND** the controls are contained by an accessible EAT-labelled group
- **AND** the group is rendered inside the transferred-annotation legend section

#### Scenario: EAT annotations are discoverable

- **WHEN** the annotation selector opens for a dataset containing transfers for `ec` and
  `protein_families`
- **THEN** both base rows expose a text-labelled EAT marker to sighted and assistive-technology
  users
- **AND** ordinary annotations and generated confidence views do not receive that marker

#### Scenario: Range and percentage entry stay synchronized

- **WHEN** the user changes either the threshold slider or the bounded `0` to `100` percentage
  input
- **THEN** the other control reflects the same normalized threshold
- **AND** one `eat-overlay-change` contract drives the shared reliability query filter

#### Scenario: Selected annotation has no transfers

- **WHEN** an EAT-capable dataset selects a base without transferred cells or a generated
  confidence view
- **THEN** the complete EAT control group is absent without leaving responsive-grid spacing

#### Scenario: Constrained view temporarily has no transferred rows

- **WHEN** filtering or isolation reduces an EAT-capable dataset to a population with no predicted
  rows
- **THEN** capable annotation markers and selected-base EAT controls remain available from the
  stable loaded dataset
- **AND** population counts and rendering still reflect only the constrained view

#### Scenario: Dataset without EAT

- **WHEN** a dataset without normalized EAT cells loads
- **THEN** the complete EAT control group is absent from the rendered DOM and accessibility tree
- **AND** no empty group spacing or orphaned EAT label remains

#### Scenario: Embedded settings omit the optional threshold

- **WHEN** bundle settings are present but omit `eatConfidenceThreshold`
- **THEN** restore uses `DEFAULT_EAT_CONFIDENCE_THRESHOLD` rather than a separate literal fallback

#### Scenario: Embedded settings round-trip

- **WHEN** a bundle is exported with overlay disabled and threshold `0.75`, then reloaded
- **THEN** the overlay is restored disabled and the reliability slider seeds `0.75`, deriving its
  `EAT_confidence >= 0.75 or N/A` query filter

#### Scenario: Embedded settings restore from OPFS

- **WHEN** a persisted bundle with overlay disabled and threshold `0.75` is replayed from OPFS
- **THEN** its normalized embedded EAT settings override dataset-reset defaults in both the reliability
  slider and its shared query filter
- **AND** settings absent from the bundle retain the enabled and `0` defaults

#### Scenario: Invalid optional setting

- **WHEN** an otherwise valid settings object contains a non-boolean overlay flag or a threshold
  outside `[0,1]`
- **THEN** normalization drops the invalid optional value and retains the valid settings object
```

Continue the same file with the other two blocks. For `Overlay coalesces categories without mutating curated data`, copy `openspec/specs/eat-annotation-overlay/spec.md` from its header line to the line before `### Requirement: Reliability threshold filters sub-threshold predictions` verbatim, then make exactly these two edits in the copy:

Replace the sentence

```markdown
preserving a visible hollow interior. The interior SHALL use an opaque plot-surface knockout so
overlapping observed or transferred markers cannot fill the hollow cue by showing through it.
```

with

```markdown
preserving a visible hollow interior. The interior SHALL use an opaque plot-surface knockout so
overlapping observed or transferred markers cannot fill the hollow cue by showing through it. The
knockout SHALL be the plot's background on screen, which follows the theme, and white in every
export, since exports are always light.
```

and in `#### Scenario: Hollow cue survives overlapping markers` replace

```markdown
- **AND** transparent export keeps non-marker pixels transparent while retaining the live
  plot-surface colour inside transferred markers
```

with

```markdown
- **AND** transparent export keeps non-marker pixels transparent while filling transferred markers'
  interiors with white, the light plot surface every export uses
```

Then the third block:

```markdown
### Requirement: Reliability threshold filters sub-threshold predictions

The reliability threshold SHALL hide predictions whose transferred confidence is below its position
by driving a shared `EAT_confidence >= x or N/A` query-filter condition, not by dimming points.
Transferred predictions render at full opacity while visible. Curated (non-transferred) points, which
carry no confidence, SHALL always remain visible regardless of the threshold. At position `0` the
threshold SHALL create no condition, so every point is shown and the filter box stays clean. The
slider and the applied query filter SHALL mirror two-way: moving the slider upserts or removes the
condition in the applied filter at once, applying an edit of that condition in the Filter panel
moves the slider, and each direction guards on the threshold value so they do not oscillate.
Existing hidden, selected, highlighted, and selection-fade precedence SHALL remain consistent for
the points that stay visible.

#### Scenario: Default shows every prediction

- **WHEN** the reliability threshold is at its default position `0`
- **THEN** no reliability condition exists and every transferred and curated point is visible

#### Scenario: Sub-threshold predictions are filtered out

- **WHEN** the threshold is raised above `0`
- **THEN** an `EAT_confidence >= x or N/A` condition is applied and predictions with confidence below `x`
  are removed from the visible set
- **AND** curated points, which have no confidence, remain visible

#### Scenario: Slider and filter mirror two-way

- **WHEN** the user moves the slider, or edits the equivalent `EAT_confidence >= x or N/A` condition
  in the Filter panel and applies it
- **THEN** the other control reflects the same normalized threshold without oscillating
- **AND** an edit of the condition that is not applied leaves the slider where it was

#### Scenario: Hidden category wins

- **WHEN** a transferred point's effective category is hidden in the legend
- **THEN** its opacity and interactivity are exactly zero regardless of confidence or highlight

#### Scenario: Connector highlight wins

- **WHEN** a transferred point is highlighted as a connector endpoint
- **THEN** it receives selected opacity while retaining hollow geometry

#### Scenario: Opacity-tier membership invalidation

- **WHEN** `baseOpacity`, `selectedOpacity`, or `fadedOpacity` is configured at zero and selection
  or highlight changes which opacity tier applies to a point
- **THEN** cached interactable membership is recomputed and reflects the new zero/non-zero state
- **AND** when all tiers are positive, highlight-only changes reuse the default membership cache
```

The blocks above were copied from main at `d071e1da`; before writing, `diff` each against the current main text (`sed -n '/^### Requirement: EAT overlay controls/,/^### Requirement: Overlay coalesces/p' openspec/specs/eat-annotation-overlay/spec.md`, and the same for `Reliability threshold`) and confirm the only differences are the edits named above. A difference you did not expect means `main` changed the text: take main's and re-apply the edits.

- [ ] **Step 6: Write `eat-reliability-filter`**

Create `openspec/changes/explore-workbench/specs/eat-reliability-filter/spec.md` (ADDED only):

```markdown
## ADDED Requirements

### Requirement: The control writes the applied filter, and an open draft follows it

Moving the reliability control SHALL change the applied filter at once, with no Apply, after a
short debounce while a thumb is dragged. A draft open in the Filter panel SHALL follow: a draft
equal to the applied filter SHALL become the new applied filter, and a draft with edits of its own
SHALL keep them and change only that column's reliability condition, under the draft's own
condition, so its row keeps its count and any half-typed bound. In the other direction, editing the
reliability condition in the draft SHALL move the control only when the draft is applied; Reset,
or removing the filter from its chip, SHALL return the control to its default position.

#### Scenario: A clean draft follows the control

- **WHEN** the Filter panel's draft equals the applied filter and the user moves the reliability
  control
- **THEN** the applied filter carries the new reliability condition and the draft equals it

#### Scenario: A changed draft keeps its edits

- **WHEN** the draft has an extra empty condition and the user sets the reliability control to 50%
- **THEN** the filter is applied with the reliability condition, and the draft keeps both of its
  rows and gains the reliability condition with a lower bound of 0.5, so Cancel is enabled

#### Scenario: A draft edit moves the control only on Apply

- **WHEN** the user edits the reliability condition in the draft
- **THEN** the control does not move until the user applies the draft, and after a Reset it returns
  to its default position
```

- [ ] **Step 7: Write `eat-provenance-connectors`**

Create `openspec/changes/explore-workbench/specs/eat-provenance-connectors/spec.md` (main's `:125` with all five scenarios; the Escape sentence and the Keyboard dismissal scenario edited):

```markdown
## MODIFIED Requirements

### Requirement: Connector state is dismissable and non-colour-dependent

Connectors SHALL use a dashed stroke plus endpoint emphasis and text status, so provenance does not
depend on color alone. Empty-space click, deselection, annotation change, overlay disable, data
replacement, Escape, and an accessible close control SHALL clear connectors and connector-owned
highlights. Escape SHALL clear the connectors only when no popover, menu or dialog takes it, and
before anything else in the page's Escape order: the selection stays, and the next Escape clears
it.

Endpoint emphasis SHALL use an unfilled halo sized from the drawn dot radius, so it localizes the
termini without covering the encoded protein markers and grows only as the dots themselves do.

#### Scenario: Empty-space dismissal

- **WHEN** the user clicks plot space without activating a point
- **THEN** all connectors, status, and connector endpoint highlights clear

#### Scenario: Keyboard dismissal

- **WHEN** connectors are active and the user presses Escape or activates the labelled close control
- **THEN** connector state clears without changing the selected annotation, the projection or the
  selection
- **AND** after Escape, a second Escape clears the selection and a third returns to Move and zoom

#### Scenario: Context change dismissal

- **WHEN** the active annotation changes, the overlay turns off, the dataset is replaced, or protein
  selection becomes empty
- **THEN** stale connector state and connector-owned highlights clear

#### Scenario: Endpoint category becomes hidden

- **WHEN** an active pair's source or target category becomes legend-hidden
- **THEN** the active connector request and connector-owned highlights clear immediately

#### Scenario: Connector highlight makes an endpoint non-interactable

- **WHEN** connector-owned highlighting applies a configured zero selected-opacity tier to a
  previously interactable source or target
- **THEN** the pair is suppressed after post-highlight authoritative revalidation
- **AND** no connector geometry, status, or connector-owned highlight remains for an empty request
```

The third Escape returns to Move and zoom only when a selection tool other than Move was active (as in the test, which picks Box select first); if you think the AND reads as unconditional, write "a third returns a selection tool to Move and zoom".

- [ ] **Step 8: Write `example-datasets`**

Create `openspec/changes/explore-workbench/specs/example-datasets/spec.md`. Two MODIFIED blocks; `:48` is rewritten (its five scenarios kept, two edited); `:194` keeps its long text and eleven scenarios with three edits only.

```markdown
## MODIFIED Requirements

### Requirement: Choosing an example from the Import menu

The Import menu SHALL be one panel in the app bar, opened by Import, by the dataset name, and on a
phone by the More sheet's Import data. It SHALL offer "Open a file…" first, with the formats it
reads; then, while an imported file is stored and is not the dataset on screen, a "Last file" row
that reopens it; then every catalog entry under an "Examples" heading: the demo first, then the rest
by ascending protein count. The heading SHALL carry an "About these examples" link to the Example
datasets documentation page, opening in a new tab, and the hint "Examples open in a curated view;
your changes aren't kept." Each item SHALL show its label and an info control that reveals its
description, its insight and a "Learn more" link to its documentation section; the info control
SHALL NOT load the example. Entries marked large SHALL show a "Large" badge, and their info SHALL
state the download size, the expected browser memory and the load time. The currently loaded
example SHALL be disabled and checked, and SHALL keep its info control in the list; the dataset
name in the app bar has none. Choosing an item SHALL load that example and open it on its curated
default view, and SHALL keep the user's stored import, which "Last file" then reopens.

#### Scenario: Choose an example

- **WHEN** the user chooses an example other than the one loaded
- **THEN** the example loads on its curated default view, the stored import is kept, and the item for that example becomes disabled

#### Scenario: A user file is loaded

- **WHEN** the current dataset is a user import
- **THEN** no example item is disabled

#### Scenario: Learn about an example

- **WHEN** the user opens an example's info control in the Import menu
- **THEN** its description, its insight and a link to `/docs/explore/example-datasets#<id>` are shown, and the example is not loaded

#### Scenario: A large example

- **WHEN** the Import menu lists `swissprot`
- **THEN** its item shows a "Large" badge, and its info states the download size, the expected browser memory and the load time

#### Scenario: The menu says examples reopen curated

- **WHEN** the Import menu lists at least one example
- **THEN** the "Examples" heading shows the "About these examples" link and the hint that changes made to an example are not kept

#### Scenario: Last file after an example

- **WHEN** the user imports a file and then chooses an example
- **THEN** the Import menu offers the imported file under "Last file", and choosing it reopens that
  file
- **AND** while the imported file is on screen, no "Last file" row is offered
```

For `Request precedence`, copy `openspec/specs/example-datasets/spec.md` from `### Requirement: Request precedence` to the line before `### Requirement: Example download progress and cancel` verbatim (one long paragraph and eleven scenarios), then make exactly these edits in the copy:

1. In the paragraph, replace `Once that example has decoded and begun replacing the stored import and the plot, a Back/Forward that changes only the view parameters SHALL NOT cancel it:` with `Once that example has decoded and begun replacing the plot (a menu choice keeps the stored import), a Back/Forward that changes only the view parameters SHALL NOT cancel it:`.
2. In `#### Scenario: A Back/Forward lands while a menu example replaces the plot`, replace `after the example has begun replacing the stored import and the plot` with `after the example has begun replacing the plot`, and `the example finishes replacing them and is named in the control bar,` with `the example finishes replacing it and is named in the app bar,`.

Nothing else in that block changes (main's other sentences about "replacing the stored import" describe the startup restore and user imports, which do replace it).

- [ ] **Step 9: Write `prep-failure-routing`**

Create `openspec/changes/explore-workbench/specs/prep-failure-routing/spec.md` (only `:62`; `:37` and `:51-54` hold):

```markdown
## MODIFIED Requirements

### Requirement: Notifications support an optional action

The notification primitive SHALL accept up to two optional actions, a primary `action` and a
`secondaryAction`, each either a link (a label and an href) or a callback (a label and an
`onClick`), and SHALL render them as the toast's action controls, the secondary one beside the
primary. Activating either SHALL dismiss the toast and SHALL let the same notification show again
at once, so a Retry that fails again can say so.

#### Scenario: Action forwarded to the toast

- **WHEN** a notification is emitted with an `action` of `{ label, href }`
- **THEN** the toast is created with an action control bearing that label
- **AND** activating it navigates to the href — `mailto:` links via the current
  window, `http(s)` links in a new tab with `noopener`

#### Scenario: A callback and a secondary action

- **WHEN** a notification is emitted with an `action` of `{ label, onClick }` and a
  `secondaryAction` of `{ label, href }`
- **THEN** the toast shows both controls, the first running the callback and the second opening the
  link

#### Scenario: No action when omitted

- **WHEN** a notification is emitted without an `action`
- **THEN** the toast is created without an action control
```

- [ ] **Step 10: Write `e2e-validation`**

Create `openspec/changes/explore-workbench/specs/e2e-validation/spec.md`. Both blocks are main's requirements with all scenarios; in `:49` "scatterplot file-drop/runtime wiring" becomes the data loader's drop wiring (twice); in `:105` the thumbnails leave `examples-live`:

```markdown
## MODIFIED Requirements

### Requirement: Browser compatibility coverage is explicit

The default E2E suite SHALL execute all retained critical application journeys in Chromium. Firefox and WebKit SHALL execute only explicit compatibility scenarios. Both SHALL cover a deep-link refresh journey, consolidated duplicate/empty/partial-invalid URL normalization, a History API back/forward journey, and the dropped-file journey, in which a `file-dropped` event on the data loader (`#myDataLoader`), as the page's drop target sends it, loads a bundle through the runtime. Firefox SHALL additionally cover OPFS persistence through `@opfs-browser`; WebKit SHALL omit that scenario while the pinned Playwright build does not provide a usable OPFS implementation.

#### Scenario: Listing the default URL projects

- **WHEN** Playwright lists the Chromium, Firefox, and WebKit URL-state projects
- **THEN** Chromium includes the complete retained URL-state suite
- **AND** Firefox and WebKit each include only the tagged compatibility journeys
- **AND** unusable WebKit OPFS coverage is excluded rather than reported as a permanent skip

#### Scenario: A bundle crosses browser-owned import boundaries

- **WHEN** the compatibility projects are listed
- **THEN** Chromium, Firefox, and WebKit include the dropped-file journey through the data loader
- **AND** Chromium and Firefox include the OPFS persist/reload journey

#### Scenario: WebKit exercises History API compatibility

- **WHEN** the WebKit compatibility project runs its navigation journeys
- **THEN** the History API journey awaits browser-native `popstate` for back and forward traversal
- **AND** it verifies both the exact traversed URL and the applied application view
- **AND** a first-attempt WebKit failure retains its trace diagnostics

### Requirement: Heavyweight and live suites are explicit

An E2E project that requires a local heavyweight fixture, a downloaded example bundle or a live service not present in a normal checkout SHALL be excluded from the default project list and SHALL require its environment opt-in to equal `1` exactly. The large-bundle project SHALL read the Swiss-Prot bundle from the `perf-datasets` copy fetched by `pnpm perf:fetch`. The `examples-live` project SHALL open every catalog example from the files fetched by `pnpm examples:fetch` and assert that each opens on its `defaultView` with no URL write and no drift warning. It SHALL write no image: the documentation thumbnails come from the docs image pipeline (`docs-media-generation`).

#### Scenario: The default suite is listed without the large fixture

- **WHEN** `RUN_LARGE_BUNDLE_E2E` is unset
- **THEN** the large-bundle project is absent rather than reported as a skipped default test

#### Scenario: A developer opts into the large fixture suite

- **WHEN** `RUN_LARGE_BUNDLE_E2E=1` and `pnpm perf:fetch` has downloaded the Swiss-Prot bundle
- **THEN** Playwright includes the large-bundle project

#### Scenario: The default suite is listed without the live examples

- **WHEN** `RUN_EXAMPLES_E2E` is unset
- **THEN** the `examples-live` project is absent

#### Scenario: A developer opts into the live examples suite

- **WHEN** `RUN_EXAMPLES_E2E=1` after `pnpm examples:fetch`
- **THEN** Playwright includes the `examples-live` project, which opens each catalog example on its `defaultView` and writes no image

#### Scenario: A false-like value is supplied for the live suite

- **WHEN** `RUN_LIVE_E2E=0`
- **THEN** Playwright excludes the live FASTA project

#### Scenario: A developer opts into the live suite

- **WHEN** `RUN_LIVE_E2E=1`
- **THEN** Playwright includes the live FASTA project
```

(Main's two paragraphs are single long lines; they stay that way, as copied.)

- [ ] **Step 11: Write `webgl-perf-harness` and `perf-checks`**

Create `openspec/changes/explore-workbench/specs/webgl-perf-harness/spec.md`:

```markdown
## ADDED Requirements

### Requirement: Measured runs pin the layout and the theme

The WebGL benchmark and the scale benchmark SHALL open the explore page in a browser context whose
stored state holds the default layout (the sidebar open at its default width) and the light theme,
and whose colour scheme is light. The sidebar's width sets the plot's size, which feeds the point
scale and the Auto contour strength, and a dark plot draws other colours, so an unpinned layout or
theme would make runs incomparable. The pinning SHALL live in the harness's context, beside the
tour suppression, not in a branch of application code.

#### Scenario: A benchmark run opens the application

- **WHEN** the benchmark or the scale run opens the explore page
- **THEN** the sidebar is open at its default width, the theme is Light, and the browser reports a
  light colour scheme, whatever layout or theme the developer's own browser has stored

#### Scenario: A normal visit

- **WHEN** a user opens the explore page outside the benchmark
- **THEN** their stored layout and theme apply
```

Create `openspec/changes/explore-workbench/specs/perf-checks/spec.md`:

```markdown
## MODIFIED Requirements

### Requirement: A segment's reset SHALL restore the plot's pixels

Every segment that changes view state SHALL end with a reset through the UI, and a screenshot of the
plot taken before the segment SHALL equal one taken after the reset. The segments SHALL run in a
browser context with the default layout and the light theme stored and a light colour scheme, so
the plot's size and colours are the same in every run, and the theme segment's reset SHALL return
the page to light.

#### Scenario: A projection switch and back

- **WHEN** the projection is switched and switched back
- **THEN** the plot's pixels match the ones before the switch

#### Scenario: Collapsing the sidebar and back

- **WHEN** the sidebar is collapsed and expanded again
- **THEN** the plot's pixels match the ones before the collapse

#### Scenario: Dark and back

- **WHEN** the page is switched to the dark theme and back to light
- **THEN** the plot's pixels match the ones before the switch

## ADDED Requirements

### Requirement: The counts gate budgets the layout, theme and hover segments

`pnpm perf:counts` SHALL include a `panel-toggle` segment that collapses the sidebar (its reset
expands it), a `panel-expand` segment that expands a collapsed sidebar, a `theme-switch` segment
that sets the dark theme (its reset sets light), and a `hover` segment that moves the pointer over
several points. Their budgets SHALL be: `panel-toggle` and `panel-expand` one render and one
point-grid rebuild, with no re-stage, data processing, legend update or upload; `theme-switch` one
render and nothing else; `hover` nothing at all, renders included.

#### Scenario: Collapsing the sidebar

- **WHEN** the panel-toggle segment collapses the sidebar
- **THEN** the counters record one render and one grid rebuild, and nothing re-stages

#### Scenario: Switching to dark

- **WHEN** the theme-switch segment sets the dark theme
- **THEN** the counters record one render, and no re-stage, data processing or grid rebuild

#### Scenario: Hovering points

- **WHEN** the hover segment moves the pointer over several points
- **THEN** every counter stays at zero, renders included
```

Check the budgets once more against `apps/web/tests/perf/budgets.json` (`segments.panel-toggle`, `panel-expand`, `theme-switch`, `hover`): `render` 1/1/1/0, `gridRebuild` 1/1/0/0, every other key 0. If a budget was re-recorded since `d071e1da`, write the numbers it holds now and say so in the report.

- [ ] **Step 12: Add the evidence lines**

Check the cited titles first (a `0` means a renamed test: find and cite its current title):

```bash
grep -c "Apply filters and the panel stays" apps/web/tests/workbench-filter.spec.ts
grep -c "a draft edit of the reliability condition moves the slider only on Apply" apps/web/src/explore/filter-controller.test.ts
grep -c "a successful menu choice keeps the stored import" apps/web/src/explore/example-dataset-load.test.ts
grep -c "an EAT click: Escape 1 hides the connectors" apps/web/tests/workbench-escape.spec.ts
grep -c "a dropped file still flows through the runtime" apps/web/tests/url-view-state.spec.ts
grep -c "captureAtResolution passes the knockout" packages/core/src/components/scatter-plot/scatter-plot.export-style.test.ts
```

Expected: `1` each. Then append (every line in the evidence format of Global Constraints (Spec content rules): the key is the requirement and scenario exactly as in the spec file, each ref `<file>: "<title>"` or a following `; "<title>"` of the same file, and `code: <file> <what>` for a config, a budget or a listing):

```bash
cat >> .superpowers/sdd/phase-8b-wrapup/spec-evidence.md <<'EOF'

## query-builder-filtering

- Filter queries are built in the Filter panel / Opening the panel seeds an empty condition → apps/web/tests/workbench-filter.spec.ts: "the view bar's Filter opens the panel in place of the legend, the structure footer stays, and #myPlot does not resize"; apps/web/src/explore/filter-controller.test.ts: "a shown panel gets one empty condition, the materialized snapshot and a clean state"
- Filter queries are built in the Filter panel / The rail's Filter and Close filter → apps/web/tests/workbench-filter.spec.ts: "the rail's Filter is pressed; Close returns to the legend and focus to the rail item"
- Filter queries are built in the Filter panel / A reload keeps the panel, not the filter → apps/web/tests/workbench-filter.spec.ts: "after a reload the panel is still Filter, with no filter applied"
- Applying a filter isolates the view to matched proteins / Applying a single-condition filter → apps/web/tests/workbench-filter.spec.ts: "Apply filters and the panel stays"; apps/web/tests/numeric-binning.spec.ts: "numeric range filters isolate to the matching subset and reset restores the full view"
- Applying a filter isolates the view to matched proteins / Zero-match query disables Apply and leaves the view unchanged → apps/web/tests/numeric-binning.spec.ts: "zero-match query disables Apply & Isolate and leaves the view unchanged (no fall-back to full data)"; apps/web/src/explore/filter-controller.test.ts: "does not blank the plot when the query matches nothing"
- Reset All clears the active filter / Reset restores the full dataset → apps/web/src/explore/filter-controller.test.ts: "Reset empties both and fires reset; a Reset with nothing applied records nothing"
- Reset All clears the active filter / Undo after Reset → apps/web/tests/workbench-feedback.spec.ts: "Reset in the Filter panel shows Filter removed; Undo restores the chip and its count"
- Loading a new dataset clears active filters / Replacement dataset renders unfiltered → apps/web/tests/numeric-binning.spec.ts: "loading a new dataset clears active filters before rendering the replacement data"; apps/web/src/explore/filter-controller.test.ts: "a dataset reset clears the filter and the draft"
- numeric-binning e2e suite passes against the query builder / Full numeric-binning project is green → code: apps/web/tests/playwright.config.ts the numeric-binning project, run whole by 8.15 and 8.29
- The Filter panel edits a draft that Apply commits and Cancel discards / An edit waits for Apply → apps/web/src/explore/filter-controller.test.ts: "a draft edit does not touch the plot until Apply"
- The Filter panel edits a draft that Apply commits and Cancel discards / Cancel restores the applied filter → apps/web/tests/workbench-filter.spec.ts: "Cancel restores the applied filter"; apps/web/src/explore/filter-controller.test.ts: "Cancel restores the applied query, or the seed when nothing is applied"
- The Filter panel edits a draft that Apply commits and Cancel discards / Removing the filter with a changed draft → apps/web/src/explore/filter-controller.test.ts: "clear() with a dirty draft keeps the draft"; "clear() removes the filter and rebases a clean draft to the seed"
- A disabled Apply says why / An incomplete row → apps/web/tests/workbench-filter.spec.ts: "an incomplete row says 'Choose a value for condition 1' and Apply is disabled"
- A disabled Apply says why / Apply is described by its reason → packages/core/src/components/query-builder/query-builder.browser.test.ts: "Apply is described by the visible reason"; packages/core/src/components/query-builder/query-apply-state.test.ts: "an annotation without a value blocks with its number"; "asks for a number on a numeric row without a bound or a presence chip"; "waits for the count, then refuses no match and every match"
- The panel counts the matches as the query changes / The count follows an edit → apps/web/tests/workbench-filter.spec.ts: "the live count updates after an edit"
- The panel counts the matches as the query changes / A hidden panel does not count → apps/web/src/explore/filter-controller.test.ts: "the builder gets data only while the panel shows, and the latest when it shows"

## query-builder-controls

- Query builder controls carry the design system's focus indicator / Focusing the comparison operator → code path: packages/core/src/components/query-builder/query-builder.styles.ts `queryBuilderStyles` composes `focusRing` (kit-shared.styles.ts `:focus-visible` ring from `--ps-focus`, `--ps-focus-width`); apps/web/tests/workbench-filter.spec.ts: "the open panel has no axe violations"
- Query builder controls carry the design system's focus indicator / A control that draws the ring on its border → code path: query-builder.styles.ts `.annotation-picker-input:focus-visible, .value-picker-input:focus-visible, .numeric-field:focus-visible { outline-offset: -1px }`
- Query builder controls carry the design system's focus indicator / Picker rendered outside the Filter panel's shadow root → code path: query-condition-row.ts, query-value-picker.ts, query-numeric-input.ts `static styles = queryBuilderStyles`; packages/core/src/styles/style-lint.test.ts (tokens only)
- The picker option lists are navigable by keyboard / Walking the list → packages/core/src/components/query-builder/query-condition-row.test.ts: "moves the highlight with ArrowDown and ArrowUp, clamped at both ends"
- The picker option lists are navigable by keyboard / Escape with a picker open → packages/core/src/components/query-builder/query-condition-row.test.ts: "the open annotation picker is a layer, so Escape closes it before the dialog around it"; query-value-picker.test.ts: "an open picker is a layer, so Escape closes it before the dialog around it"
- The picker option lists are navigable by keyboard / Opening from the trigger → packages/core/src/components/query-builder/query-condition-row.test.ts: "opens from the keyboard with Enter and with Space"
- The picker option lists are navigable by keyboard / A locked-out list → packages/core/src/components/query-builder/query-value-picker.test.ts: "refuses to highlight or select locked-out entries"
- Composing a shared stylesheet must not reorder another component's cascade / A composed sheet is added to a component that already lists the foundations → code path: packages/core/src/components/query-builder/query-builder.ts `static styles = [queryBuilderStyles, queryBuilderHostStyles]` (the host rules last); packages/core/src/components/query-builder/query-builder.browser.test.ts: "at 260 px wide a row stacks and nothing overflows horizontally"

## protein-search-feedback

- Generic no-match feedback remains available / Query matches nothing → packages/core/src/components/protein-search/protein-search.component.test.ts: "still reports no matches when nothing prefix-matches"
- Generic no-match feedback remains available / No-match feedback is a rendered popup → protein-search.component.test.ts: "reports the combobox as expanded while the no-match message is on screen"
- Generic no-match feedback remains available / Submitting a query that matches nothing → protein-search.component.test.ts: "an unknown ID shows 'No protein X in this dataset', keeps the input and dispatches nothing"
- An unknown ID is reported by name / An unknown ID → apps/web/tests/workbench-search.spec.ts: "an unknown ID shows the message and keeps the text"; protein-search.component.test.ts: "an already-selected ID reports it"
- An unknown ID is reported by name / Escape after a report → apps/web/tests/workbench-search.spec.ts: "an unknown ID shows the message and keeps the text"; protein-search.component.test.ts: "the report closes on Escape, keeping the text, and on typing"
- A pasted list reports what was found and what was not / Two of four found → apps/web/tests/workbench-search.spec.ts: "pasting a list reports found and missing, and Copy missing IDs copies them"
- A pasted list reports what was found and what was not / Copying the missing IDs → apps/web/tests/workbench-search.spec.ts: "pasting a list reports found and missing, and Copy missing IDs copies them"; protein-search.component.test.ts: "Copy missing IDs writes all of them, one per line"; "Copy missing IDs confirms with 'Copied' for 2 s"; "a refused clipboard says 'Could not copy'"
- A pasted list reports what was found and what was not / A long list of missing IDs → protein-search.component.test.ts: "more than 50 missing shows 50 and 'and N more'"; resolve-ids.test.ts: "caps the report at 50 missing IDs"
- One hit is brought into view; several are selected in place / A single hit → apps/web/tests/workbench-search.spec.ts: "a single hit moves the protein to the plot centre ±2 px"
- One hit is brought into view; several are selected in place / A pasted list → apps/web/tests/workbench-search.spec.ts: "a pasted list selects without zooming and the selection bar offers Zoom to them"
- A hit the current view hides is still selected / A protein the filter hides → apps/web/tests/workbench-search.spec.ts: "a protein the filter hides is selected, and the report says it is hidden"

## eat-annotation-overlay

- EAT overlay controls are conditional, accessible, and persisted / EAT-capable dataset → packages/core/src/components/legend/legend.eat-controls.test.ts: "renders the controls with counts"; "puts the switch and the mode on the kit, keeping their names"
- EAT overlay controls are conditional, accessible, and persisted / EAT annotations are discoverable → packages/core/src/components/annotation-select/annotation-select.component.test.ts: "marks only EAT-capable annotation options with a text badge"
- EAT overlay controls are conditional, accessible, and persisted / Range and percentage entry stay synchronized → legend.eat-controls.test.ts: "syncs the overlay switch with the scatter plot and emits threshold changes for the filter"
- EAT overlay controls are conditional, accessible, and persisted / Selected annotation has no transfers → legend.eat-controls.test.ts: "uses stable dataset capability and omits controls for a non-EAT selection"
- EAT overlay controls are conditional, accessible, and persisted / Constrained view temporarily has no transferred rows → legend.eat-controls.test.ts: "uses stable dataset capability and omits controls for a non-EAT selection" (unchanged from main)
- EAT overlay controls are conditional, accessible, and persisted / Dataset without EAT → legend.eat-controls.test.ts: "uses stable dataset capability and omits controls for a non-EAT selection" (unchanged from main)
- EAT overlay controls are conditional, accessible, and persisted / Embedded settings omit the optional threshold → packages/utils/src/parquet/settings-validation.test.ts: "accepts bounded optional settings" (unchanged from main)
- EAT overlay controls are conditional, accessible, and persisted / Embedded settings round-trip → packages/utils/src/parquet/bundle-writer.test.ts: "writes a settings part when EAT settings are the only persisted state"; legend.eat-controls.test.ts: "restores a bundle threshold as a lower bound, whatever mode the control was in" (unchanged from main)
- EAT overlay controls are conditional, accessible, and persisted / Embedded settings restore from OPFS → apps/web/src/explore/dataset-controller.eat.test.ts: "applies embedded EAT settings after an OPFS reload while retaining OPFS legend precedence"
- EAT overlay controls are conditional, accessible, and persisted / Invalid optional setting → packages/utils/src/parquet/settings-validation.test.ts: "drops each invalid optional setting independently"
- (text: the applied filter) → apps/web/src/explore/filter-controller.test.ts: "forward: upserts a single "EAT_confidence >= x or N/A" condition and applies it"
- Overlay coalesces categories without mutating curated data / Observed and transferred category share a hue → packages/core/src/components/scatter-plot/scatter-plot.eat-materialization.test.ts: "coalesces only while enabled and invalidates the cached view on toggle" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Prediction-only category → apps/web/tests/eat-visualization.spec.ts: "renders and explores EAT transfers from the real phosphatase bundle" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Multi-valued transferred category → packages/core/src/components/data-loader/legacy/conversion.test.ts: "retains ordered multi-valued transfers with aligned score and evidence metadata" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Sparse multi-hit prediction at target scale → code: packages/core/src/components/scatter-plot/scatter-plot.eat-materialization.test.ts the materialized overlay view (unchanged from main)
- Overlay coalesces categories without mutating curated data / Sparse multi-hit prediction disables incompatible shape selection → packages/core/src/components/legend/controllers/scatterplot-sync-controller.test.ts: "returns true for a sparse materialized four-label prediction" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Hollow outline remains legible across point sizes → apps/web/tests/glyph-outline.spec.ts: "glyph outline appearance across point sizes"; packages/core/src/components/scatter-plot/webgl/renderer/point-shaders.test.ts: "makes the predicted interior hollow via a single revertible flag" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Hollow cue survives overlapping markers → packages/core/src/components/scatter-plot/paint-depth.test.ts: "keeps selection contiguous while painting predicted markers last within each tier"; packages/core/src/components/scatter-plot/scatter-plot.export-style.test.ts: "captureAtResolution passes the knockout [1, 1, 1] whatever the background option (transparent)" (the edited AND)
- Overlay coalesces categories without mutating curated data / Overlay disabled → packages/core/src/components/scatter-plot/scatter-plot.eat-materialization.test.ts: "coalesces only while enabled and invalidates the cached view on toggle" (unchanged from main)
- Overlay coalesces categories without mutating curated data / Grayscale and image export → apps/web/tests/eat-visualization.spec.ts: "renders and explores EAT transfers from the real phosphatase bundle" (unchanged from main)
- Reliability threshold filters sub-threshold predictions / Default shows every prediction → packages/core/src/components/legend/legend.eat-controls.test.ts: "renders the controls with counts"; filter-controller.test.ts: "forward: dragging to 0 removes the eat condition, clears the filter channel and rebases a clean draft"
- Reliability threshold filters sub-threshold predictions / Sub-threshold predictions are filtered out → apps/web/tests/eat-visualization.spec.ts: "keeps curated points visible while the reliability filter hides low-confidence EAT predictions"
- Reliability threshold filters sub-threshold predictions / Slider and filter mirror two-way → apps/web/src/explore/filter-controller.test.ts: "a draft edit of the reliability condition moves the slider only on Apply"; "guards the loop: an Apply echoing the forward value does not move the legend again"
- Reliability threshold filters sub-threshold predictions / Hidden category wins → packages/core/src/components/scatter-plot/scatter-plot.filter-render.test.ts: "hidden-value point (family B) has opacity 0; visible-value point (family A) has opacity > 0" (unchanged from main)
- Reliability threshold filters sub-threshold predictions / Connector highlight wins → packages/core/src/components/scatter-plot/scatter-plot.provenance.test.ts: "caps requests at 20 and replaces highlighted ids with connector endpoints" (unchanged from main)
- Reliability threshold filters sub-threshold predictions / Opacity-tier membership invalidation → packages/core/src/components/scatter-plot/scatter-plot.visibility-model-memo.test.ts: "flipping %s → cache MISS with the new opacity" (unchanged from main)

## eat-reliability-filter

- The control writes the applied filter, and an open draft follows it / A clean draft follows the control → apps/web/src/explore/filter-controller.test.ts: "slider with a clean draft → the draft equals the new applied query"
- The control writes the applied filter, and an open draft follows it / A changed draft keeps its edits → apps/web/tests/eat-visualization.spec.ts: "with a dirty draft, moving the slider in the legend updates the draft’s reliability row and keeps the other edit"; filter-controller.test.ts: "slider with a dirty draft → only the reliability condition changes in the draft, the draft’s condition id is kept"
- The control writes the applied filter, and an open draft follows it / A draft edit moves the control only on Apply → apps/web/src/explore/filter-controller.test.ts: "a draft edit of the reliability condition moves the slider only on Apply"
- (text: debounce) → packages/core/src/components/legend/legend.eat-controls.test.ts: "debounces the threshold apply: display stays live, the emit defers ~150ms"

## eat-provenance-connectors

- Connector state is dismissable and non-colour-dependent / Empty-space dismissal → apps/web/src/explore/interaction-controller.eat.test.ts: "clears connectors when EAT is disabled or a click has no provenance" (unchanged from main)
- Connector state is dismissable and non-colour-dependent / Keyboard dismissal → apps/web/tests/workbench-escape.spec.ts: "an EAT click: Escape 1 hides the connectors and keeps the selection, 2 clears the selection, 3 returns to Move"
- Connector state is dismissable and non-colour-dependent / Context change dismissal → packages/core/src/components/scatter-plot/scatter-plot.provenance.test.ts: "clears connector-owned highlights and stale state on an annotation change"; "releases the dataset-owned lookup when data identity changes" (unchanged from main)
- Connector state is dismissable and non-colour-dependent / Endpoint category becomes hidden → packages/core/src/components/scatter-plot/provenance/connector-overlay-controller.test.ts: "clears geometry and status" (unchanged from main)
- Connector state is dismissable and non-colour-dependent / Connector highlight makes an endpoint non-interactable → scatter-plot.provenance.test.ts: "suppresses a pair that becomes non-interactable under connector-owned highlighting"

## example-datasets

- Choosing an example from the Import menu / Choose an example → apps/web/src/explore/example-dataset-load.test.ts: "a successful menu choice keeps the stored import"; apps/web/tests/example-datasets.spec.ts: "menu choices push dataset= and Back/Forward walk through them"
- Choosing an example from the Import menu / A user file is loaded → packages/core/src/components/import-menu/import-menu.browser.test.ts: "lists the examples with the Large badge; the current one is disabled with a check and keeps its ⓘ"
- Choosing an example from the Import menu / Learn about an example → apps/web/tests/example-datasets.spec.ts: "the menu links the examples page, marks large examples, and explains an item without loading it"; import-menu.browser.test.ts: "an example's info control explains it without loading it"
- Choosing an example from the Import menu / A large example → apps/web/tests/example-datasets.spec.ts: "the menu links the examples page, marks large examples, and explains an item without loading it"
- Choosing an example from the Import menu / The menu says examples reopen curated → apps/web/tests/example-datasets.spec.ts: "the menu links the examples page, marks large examples, and explains an item without loading it"; import-menu.browser.test.ts: "the examples docs link opens in a new tab"
- Choosing an example from the Import menu / Last file after an example → apps/web/tests/workbench-import-export.spec.ts: "after a user import then an example, Last file reopens the import"; import-menu.browser.test.ts: "the Last file row shows only with lastFile and fires open-last-file"
- (text: opened by the dataset name; More sheet) → apps/web/tests/workbench-import-export.spec.ts: "the dataset name opens the Import panel and an example switches the dataset"; apps/web/tests/mobile-bars.spec.ts: "Import data opens the Import panel under the dataset name"
- Request precedence / A menu choice during the startup restore → apps/web/src/explore/persisted-dataset.test.ts: "a menu choice made while startup reads the stored import wins, and the import is not restored"
- Request precedence / A menu choice during the startup demo → persisted-dataset.test.ts: "with no stored import, a menu choice made first is the only example fetched"
- Request precedence / A corrupt restore during a click → persisted-dataset.test.ts: "a corrupt stored import found after a click is cleared without loading the demo"
- Request precedence / Two quick Backs to the same dataset → apps/web/tests/example-datasets.spec.ts: "a second quick Back onto another entry of the dataset still loading keeps that entry's view (b1)"
- Request precedence / Back during a pending menu load → example-datasets.spec.ts: "Back while an example chosen from the menu is still loading cancels it (b1)"
- Request precedence / Back once the menu example is rendering → example-datasets.spec.ts: "Back after a menu example has begun replacing the plot lets it finish on its own entry (b1)"
- Request precedence / A Back/Forward lands while a menu example replaces the plot → apps/web/src/explore/dataset-controller.dataset-changes.test.ts: "labels a load superseded while loadData was awaiting as shown, but neither writes the URL nor applies the view"
- Request precedence / Forward during the startup restore → example-datasets.spec.ts: "Forward to an example while the stored import restores shows the example on its entry"
- Request precedence / Forward during the startup restore to an example that fails → example-datasets.spec.ts: "Forward to an example that fails while the stored import restores falls back to the import"
- Request precedence / Back/Forward during a FASTA preparation → example-datasets.spec.ts: "Forward to an example during a FASTA preparation aborts it and shows the example"
- Request precedence / Back to an entry without a dataset → example-datasets.spec.ts: "Back to an entry without dataset= while an example is loading runs the startup load instead (b2)"

## prep-failure-routing

- Notifications support an optional action / Action forwarded to the toast → apps/web/src/lib/notify.test.ts: "forwards an action to sonner as a label and onClick handler"
- Notifications support an optional action / A callback and a secondary action → notify.test.ts: "forwards a callback action and a secondary action (sonner cancel) that run on click"; "lets a notification show again right after one of its actions was used"
- Notifications support an optional action / No action when omitted → notify.test.ts: "omits the action key when no action is provided"

## e2e-validation

- Browser compatibility coverage is explicit / Listing the default URL projects → code: apps/web/tests/playwright.config.ts url-view-state-firefox and -webkit grep @cross-browser; `pnpm exec playwright test -c apps/web/tests/playwright.config.ts --list --project=url-view-state-webkit` lists only those tests (unchanged from main)
- Browser compatibility coverage is explicit / A bundle crosses browser-owned import boundaries → apps/web/tests/url-view-state.spec.ts: "a dropped file still flows through the runtime" (tag @cross-browser, listed by the Chromium, Firefox and WebKit url-view-state projects); apps/web/tests/workbench-loading.spec.ts: "a drop on the empty plot loads the file and the empty state goes"
- Browser compatibility coverage is explicit / WebKit exercises History API compatibility → code: apps/web/tests/url-view-state.spec.ts the @cross-browser History journeys; apps/web/tests/playwright.config.ts url-view-state-webkit trace retain-on-first-failure in CI (unchanged from main)
- Heavyweight and live suites are explicit / The default suite is listed without the large fixture → code: apps/web/tests/playwright.config.ts optIn('RUN_LARGE_BUNDLE_E2E') (unchanged from main)
- Heavyweight and live suites are explicit / A developer opts into the large fixture suite → code: apps/web/tests/playwright.config.ts optIn('RUN_LARGE_BUNDLE_E2E') (unchanged from main)
- Heavyweight and live suites are explicit / The default suite is listed without the live examples → code: apps/web/tests/playwright.config.ts optIn('RUN_EXAMPLES_E2E') (unchanged from main)
- Heavyweight and live suites are explicit / A developer opts into the live examples suite → code: apps/web/tests/examples-live.spec.ts asserts defaultView with no URL write; its header says the thumbnails come from scripts/docs-screenshots/scenes/examples.ts
- Heavyweight and live suites are explicit / A false-like value is supplied for the live suite → code: apps/web/tests/playwright.config.ts optIn('RUN_LIVE_E2E') (unchanged from main)
- Heavyweight and live suites are explicit / A developer opts into the live suite → code: apps/web/tests/playwright.config.ts optIn('RUN_LIVE_E2E') (unchanged from main)

## webgl-perf-harness

- Measured runs pin the layout and the theme / A benchmark run opens the application → code path: perf/playwright.config.ts `use: { colorScheme: 'light', storageState: exploreStorageState(BASE_URL, { layout: DEFAULT_LAYOUT, theme: 'light' }) }`; apps/web/tests/perf-scale.spec.ts `openPage` (same context options); apps/web/tests/helpers/tour-storage-state.ts `exploreStorageState`
- Measured runs pin the layout and the theme / A normal visit → code path: the pinning exists only in the harness contexts above; apps/web/src has no benchmark branch (`grep -rn "exploreStorageState" apps/web/src` prints nothing)

## perf-checks

- A segment's reset SHALL restore the plot's pixels / A projection switch and back → apps/web/tests/perf-counts.spec.ts: "perf counts per interaction stay within budget" (segment projection-switch, pixels true) (unchanged from main)
- A segment's reset SHALL restore the plot's pixels / Collapsing the sidebar and back → perf-counts.spec.ts: "perf counts per interaction stay within budget" (segment panel-toggle, pixels true, reset expandSidebar)
- A segment's reset SHALL restore the plot's pixels / Dark and back → perf-counts.spec.ts: "perf counts per interaction stay within budget" (segment theme-switch, pixels true); code: apps/web/tests/helpers/perf/scenarios.ts newPerfContext pins the context
- The counts gate budgets the layout, theme and hover segments / Collapsing the sidebar → perf-counts.spec.ts: "perf counts per interaction stay within budget"; code: apps/web/tests/perf/budgets.json segments.panel-toggle (render 1, gridRebuild 1, others 0)
- The counts gate budgets the layout, theme and hover segments / Switching to dark → perf-counts.spec.ts: "perf counts per interaction stay within budget"; code: apps/web/tests/perf/budgets.json segments.theme-switch (render 1, others 0)
- The counts gate budgets the layout, theme and hover segments / Hovering points → perf-counts.spec.ts: "perf counts per interaction stay within budget"; code: apps/web/tests/perf/budgets.json segments.hover (all 0)
EOF
```

If Step 1 found a header elsewhere that also had to change, add its scenarios' lines in that capability's section.

- [ ] **Step 13: Format and run the spec checks for the whole change**

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py query-builder-filtering query-builder-controls protein-search-feedback eat-annotation-overlay eat-reliability-filter eat-provenance-connectors example-datasets prep-failure-routing e2e-validation webgl-perf-harness perf-checks
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py $(ls openspec/changes/explore-workbench/specs)
```

Expected: validation prints `Change 'explore-workbench' is valid`; the header check prints nothing (or only WARN lines) and `exit 0`; both evidence runs print `evidence: 0 problem(s)` (the second covers all 29 capabilities). An `unparsed ref` or `title not in` line means an evidence line breaks the evidence format (Global Constraints, Spec content rules) or cites a renamed test: fix the line, never the checker. No WARN is expected: every MODIFIED block in 8.20–8.23 keeps at least main's scenario count. If a WARN appears, open the named block next to main's requirement: a scenario lost in copying is restored; one dropped on purpose (behaviour removed) is explained under `## <cap>` in `spec-evidence.md` with the code that removed it. `ERROR`-class lines (exit 1) name the header to fix; fix and rerun.

Then the 29-capability checks:

```bash
cat > "$TMPDIR/caps-expected.txt" <<'EOF'
annotation-presentation
category-focus
density-contours
docs-media-generation
e2e-validation
eat-annotation-overlay
eat-provenance-connectors
eat-reliability-filter
example-datasets
explore-help
explore-import-export
explore-mobile-layout
explore-theming
explore-ui-kit
explore-workbench-layout
legend-panel
perf-checks
plot-proportions
prep-failure-routing
protein-resource-links
protein-search-feedback
query-builder-controls
query-builder-filtering
scatterplot-point-size
selection-workflow
structure-coloring
support-contact
table-export
webgl-perf-harness
EOF
ls openspec/changes/explore-workbench/specs | wc -l
ls openspec/changes/explore-workbench/specs | comm -3 - "$TMPDIR/caps-expected.txt"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" \
  > "$TMPDIR/deltas.json"
for cap in $(cat "$TMPDIR/caps-expected.txt"); do
  grep -q "\"$cap\"" "$TMPDIR/deltas.json" || echo "not in change show: $cap"
done
for d in openspec/changes/explore-workbench/specs/*/; do
  c=$(basename "$d")
  [ -f "openspec/specs/$c/spec.md" ] && echo "modified $c" || echo "new $c"
done | cut -d" " -f1 | sort | uniq -c
```

Expected: `29`; `comm` prints nothing; no `not in change show` line (if every capability is reported missing, the JSON names them differently: read `$TMPDIR/deltas.json` once and grep the field that holds the capability); the last command counts 19 `modified` and 10 `new`. The ten new ones must be exactly the Global Constraints' New list.

Then the stale-wording and width checks:

```bash
grep -rnE "control bar|Tips popover|⚡|presses Save|site header" openspec/changes/explore-workbench/specs \
  | grep -v -- "- FROM:" \
  | grep -vE "^openspec/changes/explore-workbench/specs/support-contact/spec.md:[0-9]+:(The site header SHALL present|inbox, available|header, SHALL offer|The explore page, which shows no site)" \
  | grep -vE "^openspec/changes/explore-workbench/specs/explore-workbench-layout/spec.md:[0-9]+:.*site header"
grep -rnE "\.ts\b|:[0-9]+\b" openspec/changes/explore-workbench/specs/{query-builder-filtering,query-builder-controls,protein-search-feedback,eat-annotation-overlay,eat-reliability-filter,eat-provenance-connectors,example-datasets,prep-failure-routing,e2e-validation,webgl-perf-harness,perf-checks}/spec.md
```

Expected: both print nothing. The first grep's exceptions are the RENAMED `- FROM:` lines (the archive needs the old names), `support-contact`'s Feedback requirement, whose site-header sentence is main's and still true for the landing and Privacy pages, and `explore-workbench-layout`'s lines saying /explore replaces the site header and the other pages keep it; adjust the last pattern to the actual line starts if Prettier wrapped them differently, and list in the report every line the exceptions dropped. Any other hit is wording to fix.

- [ ] **Step 14: Run three cited tests**

```bash
# unit (sandbox on is fine)
pnpm --filter @protspace/app exec vitest --run src/explore/filter-controller.test.ts src/lib/notify.test.ts
# browser (sandbox disabled)
pnpm --filter @protspace/core exec vitest --run --project browser \
  src/components/query-builder/query-builder.browser.test.ts
# e2e (sandbox disabled)
PLAYWRIGHT_PORT=8475 pnpm test:e2e workbench-filter.spec.ts --project workbench \
  -g "Apply filters and the panel stays"
```

Also confirm the compatibility listing the `e2e-validation` delta relies on (no browser run; listing only):

```bash
for p in url-view-state url-view-state-firefox url-view-state-webkit; do
  pnpm exec playwright test -c apps/web/tests/playwright.config.ts --list --project=$p \
    -g "a dropped file still flows through the runtime" | tail -1
done
```

Expected: the three test runs pass (counts in the report); each listing ends with `Total: 1 test in 1 file`. A failing test is a code regression since 8.15: stop and report it; do not bend the spec to it.

- [ ] **Step 15: Commit**

`git status --short` must show only the eleven new folders under `openspec/changes/explore-workbench/specs/`. Then (sandbox disabled):

```bash
git add openspec/changes/explore-workbench/specs/query-builder-filtering \
  openspec/changes/explore-workbench/specs/query-builder-controls \
  openspec/changes/explore-workbench/specs/protein-search-feedback \
  openspec/changes/explore-workbench/specs/eat-annotation-overlay \
  openspec/changes/explore-workbench/specs/eat-reliability-filter \
  openspec/changes/explore-workbench/specs/eat-provenance-connectors \
  openspec/changes/explore-workbench/specs/example-datasets \
  openspec/changes/explore-workbench/specs/prep-failure-routing \
  openspec/changes/explore-workbench/specs/e2e-validation \
  openspec/changes/explore-workbench/specs/webgl-perf-harness \
  openspec/changes/explore-workbench/specs/perf-checks
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git commit -m "docs(openspec): specify the filter, search, EAT, examples and harnesses"
```

Report: the validate line, the header check's output and exit, the 29/`comm`/19+10 results, the greps (and the lines their exceptions dropped), the three test results and the three listings, the commit hash, the four requirements added beyond the listed headers (named in this task's notes) plus any others, and every sentence changed because the code disagreed with this plan.

### Task 8.24: The proposal, design and task list match what shipped

AGENTS.md asks for `proposal.md` and `design.md` to be reread against the final diff before the archive freezes them. This task fixes the stale lines the research listed, adds the two newly modified capabilities to the proposal, checks each capability line against the written spec, and ticks the done items in `tasks.md`.

**Files:**

- Modify: `openspec/changes/explore-workbench/proposal.md` (`:40` BREAKING; `:93-95` `annotation-presentation`; Modified list: + `table-export`, + `structure-coloring`; `:142` Branches; any capability line that disagrees with its spec)
- Modify: `openspec/changes/explore-workbench/design.md` (`:254`, `:309`, `:350` rewrap, `:406`, `:439`, `:467-468`, `:480`, `:511` Open Questions)
- Modify: `openspec/changes/explore-workbench/tasks.md` (tick 8.15–8.23 that are done, and the 8.16/8.18 items with "(nothing to fix)" when skipped)

**Interfaces:**

- Consumes: the written specs (8.20–8.23); the reports' code-vs-design disagreements (the ledger `.superpowers/sdd/phase-8b-wrapup/progress.md`, lines for Tasks 8.20–8.23); `git diff origin/main...HEAD --stat` and `git log --oneline origin/perf/improvements..HEAD | wc -l`; facts: `dfc6def4` (perf → workbench merge), `6b203667` (main → perf merge), 34 phone tests ported (`mobile` project now about 80 tests: count with `pnpm exec playwright test -c apps/web/tests/playwright.config.ts --project=mobile --list | tail -1`), `docs/explore/images/` file counts (`ls … | sed 's/.*\.//' | sort | uniq -c`: today 51 PNG, 10 GIF, plus the `examples/` folder's 5 thumbnails), plot-status chip text "Showing only N proteins · N steps" (`plot-status.ts`, the isolation chip's `countNoun(size, 'protein', 'proteins')`), `file-dropped` re-dispatched on `#myDataLoader` (`apps/web/src/workbench/use-file-drop.ts`, read by `apps/web/src/explore/runtime.ts`).
- Produces (texts): proposal BREAKING adds "The scatterplot no longer handles file drops; the page's drop target sends them to the data loader (`file-dropped` on `#myDataLoader`)."; `annotation-presentation` line: "the legend header's predicted marker becomes the icon set's sparkles mark with a tooltip; main's source-grouped annotation picker is kept"; new Modified lines: "`table-export`: the Table (.tsv) export is an item of the app bar's Export menu (the More sheet on phones); isolation is Show only these." and "`structure-coloring`: a disabled colour option says why it is disabled."; Branches/delivery: "merged with `main` through `perf/improvements` (`6b203667`, `dfc6def4`); the PR targets `perf/improvements` until #526 merges, then `main`"; design Open Questions answered ("The user, in phase 8B, on iOS Safari, Android Chrome, a tablet and desktop Chrome, Safari and Firefox"). No other wording change in `design.md`; in `proposal.md` only a capability line that disagrees with its written spec changes besides the lines above.

**Tests:**

- `grep -nE "control-bar-events|Showing only 3 categories|38 phone tests|17 screenshots|rebased onto|Predicted\" group|filterActive. gets a new owner" openspec/changes/explore-workbench/{proposal,design}.md` prints nothing.
- The proposal's Modified list names exactly the 19 modified capabilities and the New list the 10 new ones (`comm` against `ls openspec/changes/explore-workbench/specs`, split by whether `openspec/specs/<cap>/spec.md` exists).
- No line this task added is over 100 characters (checked on the diff, counting characters, not bytes: the files hold `·`, `→` and `✕`).
- `openspec validate explore-workbench --strict` passes; `pnpm exec prettier --check` on the three files.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. `git commit` needs the sandbox disabled (the hook builds the docs). Edit by the quoted text, not by line number: the line numbers above are from `d071e1da`, and the plan commit has rewritten `tasks.md` since.

- [ ] **Step 1: Run the checks and see them fail**

```bash
grep -nE "control-bar-events|Showing only 3 categories|38 phone tests|17 screenshots|rebased onto|Predicted\" group|filterActive. gets a new owner" \
  openspec/changes/explore-workbench/{proposal,design}.md

P=openspec/changes/explore-workbench/proposal.md
awk '/^### New Capabilities/{s=1;next} /^##+ /{s=0} s && /^- `/' "$P" \
  | sed -E 's/^- `([^`]+)`.*/\1/' | sort > "$TMPDIR/p8b-prop-new.txt"
awk '/^### Modified Capabilities/{s=1;next} /^##+ /{s=0} s && /^- `/' "$P" \
  | sed -E 's/^- `([^`]+)`.*/\1/' | sort > "$TMPDIR/p8b-prop-mod.txt"
: > "$TMPDIR/p8b-spec-new.txt"; : > "$TMPDIR/p8b-spec-mod.txt"
for d in openspec/changes/explore-workbench/specs/*/; do
  c=$(basename "$d")
  if [ -f "openspec/specs/$c/spec.md" ]; then echo "$c" >> "$TMPDIR/p8b-spec-mod.txt"
  else echo "$c" >> "$TMPDIR/p8b-spec-new.txt"; fi
done
sort -o "$TMPDIR/p8b-spec-new.txt" "$TMPDIR/p8b-spec-new.txt"
sort -o "$TMPDIR/p8b-spec-mod.txt" "$TMPDIR/p8b-spec-mod.txt"
echo "== new (proposal | specs)"; comm -3 "$TMPDIR/p8b-prop-new.txt" "$TMPDIR/p8b-spec-new.txt"
echo "== modified (proposal | specs)"; comm -3 "$TMPDIR/p8b-prop-mod.txt" "$TMPDIR/p8b-spec-mod.txt"
wc -l < "$TMPDIR/p8b-spec-new.txt"; wc -l < "$TMPDIR/p8b-spec-mod.txt"
```

Expected (the failing checks): the grep prints `design.md:254` (`control-bar-events.ts`), `design.md:309` (`Showing only 3 categories`), `design.md:406` (`38 phone tests`), `design.md:439` (`17 screenshots`), `design.md:467` (`rebased onto`), `proposal.md:87` (`filterActive` gets a new owner) and `proposal.md:94` (`"Predicted" group`); the new-list `comm` prints nothing; the modified-list `comm` prints `table-export` and `structure-coloring` in the second column (written as specs, missing from the proposal); the spec counts are 10 and 19. If the spec counts are not 10 and 19, stop and report: 8.20–8.23 are not done.

- [ ] **Step 2: Collect the facts the new text states**

```bash
git log -1 --format='%h %s' 6b203667
git log -1 --format='%h %s' dfc6def4
pnpm exec playwright test -c apps/web/tests/playwright.config.ts --project=mobile --list 2>&1 | tail -1
ls docs/explore/images | sed -nE 's/.*\.(png|gif)$/\1/p' | sort | uniq -c
ls docs/explore/images/examples | wc -l
grep -n "Showing only" packages/core/src/components/plot-tools/plot-status.ts
grep -n "'file-dropped'" apps/web/src/workbench/use-file-drop.ts apps/web/src/explore/runtime.ts
git diff origin/main...HEAD --stat | tail -1
git log --oneline origin/perf/improvements..HEAD | wc -l
grep -nE "^Task 8\.(1[5-9]|2[0-3])" .superpowers/sdd/phase-8b-wrapup/progress.md
grep -niE "disagree|design\.md says|proposal says" .superpowers/sdd/phase-8b-wrapup/progress.md
```

Expected: `6b203667 chore: merge main into perf/improvements`; `dfc6def4 chore: merge origin/perf/improvements into feat/explore-workbench`; the mobile list ends with `Total: 80 tests in …` (about 80; use the printed number nowhere in the text, it only confirms "34 ported" is still the right story: the four landing-page tests were not ported); `51 png` and `10 gif` (if 8.16 or 8.18 recaptured or added images, use the printed counts in Step 7's text instead of 51 and 10); `5` thumbnails; `plot-status.ts` shows `` `Showing only ${countNoun(size, 'protein', 'proteins')} · ${countNoun(steps, 'step', 'steps')}` ``; `use-file-drop.ts` dispatches and `runtime.ts` listens for `'file-dropped'`. Note the diff stat line and the commit count for the report. The last two greps give the done tasks and the spec writers' code-vs-design notes (used in Steps 9 and 10).

- [ ] **Step 3: proposal.md — the BREAKING bullet names the file-drop move**

In `openspec/changes/explore-workbench/proposal.md`, under "## What Changes", replace:

```markdown
- **BREAKING** (for embedders only): `protspace-control-bar` is replaced by separate elements.
  `@protspace/core` is not published; the developer docs change in the same PR.
```

with:

```markdown
- **BREAKING** (for embedders only): `protspace-control-bar` is replaced by separate elements.
  `@protspace/core` is not published; the developer docs change in the same PR. The scatterplot no
  longer handles file drops; the page's drop target sends them to the data loader (`file-dropped`
  on `#myDataLoader`).
```

- [ ] **Step 4: proposal.md — the annotation-presentation line, and the two new Modified lines**

Under "### Modified Capabilities", replace:

```markdown
- `annotation-presentation`: the annotation picker groups by source and marks predicted annotations
  with an icon (matching the code, which no longer has a "Predicted" group); display names are used
  at every text site; the legend's predicted marker uses the icon set.
```

with:

```markdown
- `annotation-presentation`: the legend header's predicted marker becomes the icon set's sparkles
  mark with a tooltip; main's source-grouped annotation picker is kept.
```

Then, directly after the last item of that list:

```markdown
- `protein-resource-links`: the structure header's link row stays usable in the narrow sidebar, the
  floating card and the folded phone sheet.
```

add:

```markdown
- `table-export`: the Table (.tsv) export is an item of the app bar's Export menu (the More sheet on
  phones); isolation is Show only these.
- `structure-coloring`: a disabled colour option says why it is disabled.
```

- [ ] **Step 5: proposal.md — Branches**

Under "## Impact", replace:

```markdown
- **Branches**: built on `perf/improvements` (PR #526); `feat/mobile-responsive` is retired once its
  tests pass on the new layout.
```

with:

```markdown
- **Branches**: built on `perf/improvements` (PR #526) and merged with `main` through it
  (`6b203667`, `dfc6def4`); the PR targets `perf/improvements` until #526 merges, then `main`.
  `feat/mobile-responsive` is retired: its phone tests pass on the new layout.
```

- [ ] **Step 6: design.md — decisions 9, 13 and 15**

In `openspec/changes/explore-workbench/design.md`, under "### 9. The control bar is split", replace:

```markdown
into controllers in `apps/web/src/explore/`, next to `control-bar-events.ts`. **BREAKING** for
```

with:

```markdown
into controllers in `apps/web/src/explore/`. **BREAKING** for
```

Under "### 13. Selection, status and undo", replace:

```markdown
  conditions", "Showing only 3 categories · 2 steps", "4 categories hidden". Each opens the place to
```

with:

```markdown
  conditions", "Showing only 12 proteins · 2 steps", "4 categories hidden". Each opens the place to
```

Under "### 15. Search, messages, import and export", replace the over-long bullet:

```markdown
- **Export menu.** Figure editor, quick PNG, quick PDF, protein IDs, table (TSV), data bundle. The note that
  contours are not part of quick exports moves from a hover title into the menu.
```

with:

```markdown
- **Export menu.** Figure editor, quick PNG, quick PDF, protein IDs, Table (.tsv), data bundle. The
  note that contours are not part of quick exports moves from a hover title into the menu.
```

- [ ] **Step 7: design.md — decisions 17 and 19**

Under "### 17. Phones and tablets", replace:

```markdown
The mobile branch's 38 phone tests (Playwright project `mobile`, Pixel 7) are ported to the new
layout first and used as acceptance tests. The branch is then retired, not merged. Its spec's
requirement that the desktop layout stays unchanged is superseded.
```

with:

```markdown
The mobile branch's phone tests (Playwright project `mobile`, Pixel 7; 34 of its 38, without the
four landing-page tests) are ported to the new layout first and used as acceptance tests. The
branch is then retired, not merged. Its spec's requirement that the desktop layout stays unchanged
is superseded.
```

(Line 38's "38 phone e2e tests" describes the mobile branch as it was and stays.)

Under "### 19. Docs media pipeline", replace the whole bullet:

```markdown
- All 17 screenshots, 9 GIFs and the 5 example thumbnails are regenerated. The thumbnails move here
  from the `examples-live` e2e suite, so every docs image comes from one pipeline. New captures cover the
  sidebar fold and resize, the floating structure, the selection bar, the filter panel, search
  messages, the theme switch and the phone layout. Images named after the old layout
  (`control-bar-*.png`) are replaced and deleted. The main screenshots get dark variants, shown when
  the docs are in dark mode.
```

with (51 and 10 are Step 2's counts; use the printed ones if they differ):

```markdown
- Every screenshot and GIF (51 PNG and 10 GIF files, dark twins included) and the 5 example
  thumbnails are regenerated. The thumbnails move here from the `examples-live` e2e suite, so every
  docs image comes from one pipeline. New captures cover the sidebar fold and resize, the floating
  structure, the selection bar, the filter panel, search messages, the theme switch and the phone
  layout. Images named after the old layout (`control-bar-*.png`) are replaced and deleted. The main
  screenshots get dark variants, shown when the docs are in dark mode.
```

- [ ] **Step 8: design.md — delivery, the #526 risk, and the open question**

Under "### 21. Delivery", replace:

```markdown
- Branch `feat/explore-workbench`, created from `perf/improvements` at 7e94b858, rebased onto
  `main` when PR #526 merges.
```

with:

```markdown
- Branch `feat/explore-workbench`, created from `perf/improvements` at 7e94b858 and merged with
  `main` through it (`6b203667` merged `main` into `perf/improvements`, `dfc6def4` merged that
  here). The PR targets `perf/improvements` until #526 merges, then `main`.
```

Under "## Risks / Trade-offs", replace:

```markdown
  and the resize path; rebase as #526 moves.
```

with:

```markdown
  and the resize path; it merges `perf/improvements` as #526 moves, and `main` once #526 merges.
```

Under "## Open Questions", replace:

```markdown
- Who runs the real-device check on iOS Safari and Android Chrome, and when.
```

with:

```markdown
- Who runs the real-device check on iOS Safari and Android Chrome, and when. Answered: the user,
  in phase 8B, on iOS Safari, Android Chrome, a tablet and desktop Chrome, Safari and Firefox.
```

- [ ] **Step 9: proposal.md — every capability line against its written spec**

Print each capability's proposal line next to the requirements its spec holds:

```bash
for d in openspec/changes/explore-workbench/specs/*/; do
  c=$(basename "$d")
  echo "== $c"
  awk -v c="$c" 'index($0, "- `" c "`:") == 1 {p=1; print; next} p && /^  /{print; next} {p=0}' \
    openspec/changes/explore-workbench/proposal.md
  grep -E "^### Requirement:|^- (FROM|TO):" "$d/spec.md" | sed 's/^/    /'
done
```

For each of the 29, the line may summarise less than the spec holds (that is fine), but it must not name behaviour the spec does not state or that the ownership table (Rulings) gives to another capability. Fix only such a line, with the smallest wording change, written from the spec's requirement names. Two lines are known to need this if the specs follow the ownership table; check them and apply the text only when the spec confirms it:

- `explore-workbench-layout`: if its spec has no requirement for the tool strip, the status chips or the Import menu (they belong to `selection-workflow` and `explore-import-export`), replace:

  ```markdown
  - `explore-workbench-layout`: the app bar, the view bar that never wraps, tools and status on the
    plot, the sidebar with its icon rail, divider, resizing and persistence, the docked or floating
    structure viewer, the shared Import/dataset menu, the drop target and the empty state.
  ```

  with:

  ```markdown
  - `explore-workbench-layout`: the app bar, the view bar that never wraps, the sidebar with its icon
    rail, divider, resizing and persistence, the docked or floating structure viewer, the drop
    target, the empty state and where notifications appear.
  ```

  (Drop "and where notifications appear" if the spec has no requirement for it.)

- `query-builder-filtering`: replace it in any case (`filterActive` is gone with the control bar: the plot's `filtersActive` and the Filter button's count report an applied filter; the chip and its ✕ belong to `selection-workflow`):

  ```markdown
  - `query-builder-filtering`: the query builder moves from a control-bar modal to the sidebar's
    Filter panel; edits are a draft until Apply, Cancel discards, a disabled Apply says why, the
    active filter shows as a chip, Reset offers Undo, and `filterActive` gets a new owner.
  ```

  with:

  ```markdown
  - `query-builder-filtering`: the query builder moves from a control-bar modal to the sidebar's
    Filter panel; edits are a draft until Apply, Cancel discards, a disabled Apply says why, the
    match count updates as the draft changes, Reset offers Undo, and the plot's `filtersActive` with
    the Filter button's count report an applied filter.
  ```

  (Drop "the match count updates as the draft changes, " if the spec has no live-count requirement.)

Every other line you change: quote the old and new text in the report with the spec requirement that made the change necessary.

- [ ] **Step 10: The spec writers' code-vs-design notes**

For each note Step 2's last grep printed (a place where `design.md` or `proposal.md` claims something the code does not do): if it is a proposal capability line, Step 9 has fixed it; if it is one of the `design.md` lines this task edits, the edit above covers it; anything else in `design.md` is not edited here (the design records the decisions as taken; the plan's Rulings fix the list of stale lines). List each such remaining note in the report, quoted with its line, as "proposed further fix" for the orchestrator.

- [ ] **Step 11: Tick the done items in tasks.md**

From Step 2's ledger grep, take the tasks whose line reads `complete`, and the ones recorded as skipped (`8.16` or `8.18` with "skipped" / "nothing to fix"). 8.24 counts as done (this commit completes it). Write them as two comma-separated lists and run, for example with 8.15, 8.17, 8.19–8.24 done and 8.16 skipped:

```bash
python3 -I - openspec/changes/explore-workbench/tasks.md "8.15,8.17,8.19,8.20,8.21,8.22,8.23,8.24" "8.16" <<'EOF'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
done = {t for t in sys.argv[2].split(',') if t}
skipped = {t for t in sys.argv[3].split(',') if t}
lines = path.read_text().split('\n')
ticked = []
for i, line in enumerate(lines):
    m = re.match(r'^- \[ \] (8\.\d+) ', line)
    if not m or m.group(1) not in done | skipped:
        continue
    lines[i] = line.replace('- [ ]', '- [x]', 1)
    last = i
    while last + 1 < len(lines) and lines[last + 1].startswith('      '):
        last += 1
    if m.group(1) in skipped and not lines[last].endswith('(nothing to fix)'):
        lines[last] += ' (nothing to fix)'
    ticked.append(m.group(1))
path.write_text('\n'.join(lines))
print('ticked:', ', '.join(ticked))
missing = sorted((done | skipped) - set(ticked))
if missing:
    sys.exit('not found as open items: ' + ', '.join(missing))
EOF
grep -nE "^- \[[ x]\] 8\.(1[5-9]|2[0-9]|30) " openspec/changes/explore-workbench/tasks.md
grep -n "planned after #526" openspec/changes/explore-workbench/tasks.md
```

Expected: `ticked:` lists exactly the ids you passed, no "not found" exit; the item list shows them as `[x]`, and 8.25–8.30 (and 8.18 if the device pass is not done) still `[ ]`. 8.18 is ticked only when the ledger says it is complete or skipped. If the section heading still reads "part B is planned after #526 merges" (the last grep prints it), replace that phrase in the heading with "part B: `plans/phase-8b-verify-specs-archive.md`" (the plan commit already wrote this heading, so normally the grep prints nothing).

- [ ] **Step 12: Run the checks and see them pass**

Rerun Step 1's commands. Expected: the stale-text grep prints nothing; both `comm` commands print nothing; counts 10 and 19. Then:

```bash
git diff -U0 openspec/changes/explore-workbench/proposal.md openspec/changes/explore-workbench/design.md \
  openspec/changes/explore-workbench/tasks.md | grep '^+[^+]' | perl -CSD -lne 'print if length > 101'
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
pnpm exec prettier --check openspec/changes/explore-workbench/proposal.md \
  openspec/changes/explore-workbench/design.md openspec/changes/explore-workbench/tasks.md 2>&1 \
  | grep -v "trust settings"
git status --short
```

Expected: the length check prints nothing (101 allows for the diff's leading `+`; a tasks.md line made longer by "(nothing to fix)" is the one exception you may leave, say so in the report); `Change 'explore-workbench' is valid`; Prettier passes; `git status --short` lists exactly the three files as ` M`.

- [ ] **Step 13: Commit**

Commit (sandbox disabled):

```bash
git add openspec/changes/explore-workbench/proposal.md openspec/changes/explore-workbench/design.md \
  openspec/changes/explore-workbench/tasks.md
git commit -m "docs(openspec): bring the proposal and design in line with the code"
git log -1 --format=%B
```

Expected: the hook passes; the message is the one line above with no trailer.

Report: Step 1's failing output, Step 2's facts (diff stat line, commit count, mobile test total, image counts), every capability line changed in Step 9 (old → new, with the requirement that required it), Step 10's "proposed further fix" list (or "none"), the ticked ids, Step 12's output and the commit hash.

### Task 8.25: The specs rechecked against the commits after the spec block

Device fixes (8.18) and anything else that landed after block 2's base can make a delta false. This task lists every code commit since block 2 started, decides for each whether a written requirement or scenario changed, and updates the deltas; when there were no such commits it records that and changes nothing. It runs only after 8.18 is done or skipped.

**Files:**

- Modify (only as needed): `openspec/changes/explore-workbench/specs/*/spec.md`
- Modify: `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (a `## Recheck` section)

**Interfaces:**

- Consumes: block 2's base SHA (the ledger's "Task 8.19: dispatched (BASE <sha>)" line; the orchestrator writes ledger lines at column 0 as `Task 8.N: dispatched (BASE <sha>)`, `Task 8.N: complete (<sha or no commit>)`, `Task 8.N: skipped (<reason>)`); `git log --format='%h %s' <base>..HEAD -- apps packages scripts perf`; `device-notes.md` `## 8.18 fixes`; the ownership table (which capability a behaviour belongs to).
- Consumes from Tasks 8.19–8.20: `check-headers.sh` (exit 0 when clean) and `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (prints `evidence: <n> problem(s)`; the evidence line format `- <Requirement> / <Scenario> → <file>: "<title>"`, a further title of the same file as `; "<title>"`, `code: <file> <what>` for a code path).
- Consumes from Task 8.24: `proposal.md`'s capability lines and its Step 9 rule (a capability line names only what that capability's spec states).
- Produces: the `## Recheck` section: one line per commit (`<sha> <subject> → <cap>/<requirement> changed | no spec impact (why)`); updated deltas with their evidence lines.

**Tests:** the spec checks; for each changed requirement, its new evidence test runs; if nothing changed, `git status --short` is empty except the git-ignored evidence file.

**Commit:** `docs(openspec): follow the device fixes in the specs` (only if a delta changed; otherwise none).

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Every `openspec` call is filtered with `2>&1 | grep -v "trust settings"`. `git commit`, `--project browser` and `pnpm test:e2e` need the sandbox disabled. This task reads code and writes only spec text and the evidence file: it never changes code or tests. A commit whose code looks wrong is reported, not fixed.

- [ ] **Step 1: Check the task may start, and find the base**

```bash
L=.superpowers/sdd/phase-8b-wrapup/progress.md
grep -n "^Task 8.18:" "$L"
grep -n "^Task 8.19: dispatched (BASE" "$L"
grep -n "^## 8.18 fixes" .superpowers/sdd/phase-8b-wrapup/device-notes.md
```

Expected: a `Task 8.18: complete …` or `Task 8.18: skipped …` line (the user's notes had no failing item), and one `Task 8.19: dispatched (BASE <sha>)` line. If 8.18 is only `dispatched`, or has no line at all, stop and report BLOCKED: this task runs after the device fixes. Set the base from the 8.19 line:

```bash
L=.superpowers/sdd/phase-8b-wrapup/progress.md
BASE=$(grep -o "^Task 8.19: dispatched (BASE [0-9a-f]*" "$L" | awk '{print $NF}')
git cat-file -t "$BASE" && git merge-base --is-ancestor "$BASE" HEAD && echo "base ok $BASE"
```

Expected: `commit` and `base ok <sha>`. A missing or non-ancestor base (the ledger was edited by hand, or history was rewritten) is reported to the orchestrator; do not guess another base.

- [ ] **Step 2: List the commits to recheck**

Each command block that uses `$BASE` sets it again (the Bash tool keeps no variables between calls):

```bash
L=.superpowers/sdd/phase-8b-wrapup/progress.md
BASE=$(grep -o "^Task 8.19: dispatched (BASE [0-9a-f]*" "$L" | awk '{print $NF}')
git log --reverse --format='%h %s' "$BASE"..HEAD -- apps packages scripts perf
git log --reverse --format='%h %s' "$BASE"..HEAD -- openspec/changes/explore-workbench/specs
```

The first list is what this task decides on. `perf` is included beside `apps`, `packages` and `scripts` because `webgl-perf-harness` and `perf-checks` describe code there. The second list shows which deltas already moved after the base: 8.20–8.23's own commits, and any 8.18 commit that edited a delta in the same commit as its fix (8.18's rule).

Expected: 8.20–8.23's commits appear only in the second list (they touch `openspec/` alone). If the first list is empty, go to Step 7: nothing landed in code since the specs were written.

Then read 8.18's own account, which names for each fix the delta it changed, if any:

```bash
sed -n '/^## 8.18 fixes/,$p' .superpowers/sdd/phase-8b-wrapup/device-notes.md
```

- [ ] **Step 3: Decide each commit**

For each SHA of the first list, in order:

```bash
git show --stat --format='%h %s%n%n%b' <sha>
git show <sha> -- '*.test.ts' '*.spec.ts'
```

The tests a fix added or changed say what behaviour it changed; read the code diff (`git show <sha> -- <path>`) where they do not. Map each changed source file to the capability that states its behaviour (the ownership table in the plan's Rulings decides; the common cases):

| Changed path | Capability |
| --- | --- |
| `apps/web/src/workbench/{Workbench,AppBar,ViewBar,Sidebar,Rail,StructurePanel,PlotArea,EmptyState,WorkbenchToaster}.tsx`, `use-layout.ts`, `use-floating-card.ts`, `layout-geometry.ts`, `view-bar-overflow.ts`, `apps/web/src/explore/{layout-state,layout-defaults,file-drop}.ts`, desktop rules of `workbench.css` | `explore-workbench-layout` |
| `MoreSheet.tsx`, `MoreMenu.tsx`, `PanelTabs.tsx`, `PanelFold.tsx`, `SearchToggle.tsx`, `use-layout-mode.ts`, `explore/{layout-mode,phone-dim,touch-tooltip-insets}.ts`, `workbench.css` rules under `data-layout='phone'`, `'tablet'` or `'landscape'` or `pointer: coarse`, `core/src/utils/breakpoints.ts`, the plot's touch handling | `explore-mobile-layout` |
| `core/src/styles/theme.ts`, `kit/adopt-theme.ts`, `utils/theme-observer.ts`, `explore/theme-*.ts`, `apps/web/index.html` boot script | `explore-theming` |
| `core/src/components/kit/*` (layers, focus, tooltip, segmented, menu, dialog, popover) | `explore-ui-kit` |
| `utils/src/visualization/scales.ts`, `data-processor.ts`, `export-renderer.ts`, the plot's resize and centre code | `plot-proportions` |
| `core/src/components/legend/*` | `legend-panel`; shape size → `scatterplot-point-size`; `legend-header.ts` predicted mark → `annotation-presentation`; `legend-eat-controls.ts` → `eat-annotation-overlay` / `eat-reliability-filter` |
| `core/src/components/plot-tools/*`, `explore/{selection-controller,undo-controller,undo-history,status-controller,workbench-status,structure-controller,confirm-dialog,recovery-banner}.ts` | `selection-workflow` |
| `core/src/components/{import-menu,export-menu,publish}/`, `explore/{import-controller,export-handler,loading-overlay}.ts`, the utils download helper | `explore-import-export`; TSV rows → `table-export`; example list, stored import → `example-datasets` |
| `HelpMenu.tsx`, `ShortcutsDialog.tsx`, `shortcuts.ts`, `help-actions.ts`, `apps/web/src/tour/*` | `explore-help`; the Shift row → `category-focus` |
| `core/src/components/structure-viewer/*` | link row → `protein-resource-links`; colour options → `structure-coloring`; placement → `explore-workbench-layout` / `explore-mobile-layout` |
| `core/src/components/query-builder/*`, `FilterPanel.tsx`, `FilterControl.tsx`, `explore/filter-controller.ts` | `query-builder-filtering` / `query-builder-controls` |
| `core/src/components/protein-search/*` | `protein-search-feedback` |
| `core/src/components/contours-menu/*` | `density-contours` |
| `explore/notifications.ts`, `apps/web/src/lib/notify.ts` | `prep-failure-routing`; the close button, Feedback → `support-contact` |
| `core/src/components/scatter-plot/provenance/*`, `explore/eat-provenance.ts` | `eat-provenance-connectors` |
| `scripts/docs-screenshots/*`, `explore/docs-images.test.ts` | `docs-media-generation` |
| `apps/web/tests/helpers/perf/*`, `perf-counts.spec.ts`, `apps/web/tests/perf/budgets.json`, `perf-scale.spec.ts`, `perf/*` | `perf-checks` / `webgl-perf-harness` |
| `apps/web/tests/playwright.config.ts` | `e2e-validation` |

Six capabilities have no delta (`point-visibility`, `stats-auto-clustering`, `imported-dataset-persistence`, `deprecation-policy`, `explore-loading-overlay`, `scatterplot-zoom-indicator`). If a commit changes behaviour one of them states, that main spec is now false: report it to the orchestrator (a new MODIFIED delta for it is a scope decision, not this task's), and record the line as `→ <cap> (no delta): main spec now false, reported`.

Then, in the capability's delta, find every sentence and scenario about the behaviour the commit touched:

```bash
grep -n -i "<two or three words of the behaviour>" openspec/changes/explore-workbench/specs/<cap>/spec.md
```

Decide with these rules:

- **Changed** — the commit changes something a requirement or scenario states: a number (a size, a delay, a count, a budget), a label or message, an order, a placement, which control does what, an event, a key, a stored value; or it adds behaviour to a requirement that claims to describe its area completely (e.g. the More sheet's row list, the reasons Apply gives).
- **No spec impact** — a refactor or a test-only commit; a fix that makes the code do what a requirement already says (a device bug against a true spec); a style change below what any requirement states (a colour token, a margin no scenario measures); a docs image recapture.
- **Already followed** — 8.18's commit edited the delta itself: check its edit against the code as for a change (the sentence is true, the scenario count did not drop, the evidence line names the new test), then record it as such.

Note each decision as you go, in the form the `## Recheck` section takes (Step 6).

- [ ] **Step 4: For each changed requirement, show the stale text first**

For every requirement decided **Changed**, write down the exact phrase in the delta that is now false, and show it is there:

```bash
grep -n -F "<the stale phrase, exactly as the delta has it>" openspec/changes/explore-workbench/specs/<cap>/spec.md
```

Expected (the failing check): one hit per phrase. Then run the commit's new or changed test that proves the new behaviour, so the edit is written from a passing test, not from the commit message:

```bash
# a unit test (app or utils): sandbox on
pnpm --filter @protspace/app exec vitest --run <src/… file> -t "<title>"
# a core browser test (sandbox disabled)
pnpm --filter @protspace/core exec vitest --run --project browser <src/… file> -t "<title>"
# an e2e (sandbox disabled; at most one e2e spec for the whole task)
PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec file> --project <workbench or the spec's own project> -g "<title>"   # --project=mobile (with =) for a mobile-* spec
```

Expected: it passes on HEAD. If it fails, the code is broken, not the spec: stop and report the failure; change no delta for it.

- [ ] **Step 5: Edit the deltas**

Edit only the requirements decided **Changed**, in place:

- An ADDED requirement (a new capability's, or an ADDED block of a modified one): rewrite the sentence and the scenario it affects; add a scenario when the commit added behaviour no scenario covers. Keep 4–8 requirements per new capability.
- A MODIFIED requirement: edit inside the block, which stays the whole requirement; never remove one of main's scenarios to make a statement true (rewrite it), so the header check's scenario count still holds.
- A behaviour now owned by another capability (the commit moved it): move the statement to the owner per the ownership table, and say so in the report.
- Wording rules as in 8.20–8.23: SHALL, user-visible or contract terms, no file paths, line numbers, class names, phase numbers or task ids; prose wrapped at 100 columns; `#### Scenario:` with **WHEN**/**THEN**/**AND** bullets.

Re-run the grep from Step 4 for each phrase:

```bash
grep -n -F "<the stale phrase>" openspec/changes/explore-workbench/specs/<cap>/spec.md
```

Expected: no output now.

If a changed requirement is named in its capability's `proposal.md` line (`grep -n "<cap>" openspec/changes/explore-workbench/proposal.md`), check that line against the edited spec by Task 8.24 Step 9's rule (the line names only what the spec states) and fix it in this task's commit (add `proposal.md` to the `git add` in Step 8).

- [ ] **Step 6: Write the `## Recheck` section and update the evidence lines**

Append to `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md`, one line per commit of Step 2's first list, in order (fill the brackets from Step 3; every commit gets a line):

```bash
L=.superpowers/sdd/phase-8b-wrapup/progress.md
BASE=$(grep -o "^Task 8.19: dispatched (BASE [0-9a-f]*" "$L" | awk '{print $NF}')
{
  echo
  echo "## Recheck"
  echo
  echo "Base $BASE, HEAD $(git rev-parse --short HEAD), $(date +%Y-%m-%d)."
  echo
  # one line per commit, e.g.:
  # - 1a2b3c4d fix(core): keep the TED reason on screen after a tap in Safari → structure-coloring/A disabled structure colour option says why changed (scenario "Still loading": the reason stays after a tap)
  # - 5e6f7a8b fix(web): keep the floating card clear of Copy IDs → no spec impact (the code now does what explore-workbench-layout's floating-card scenario says)
  # - 9c0d1e2f test(web): pin the More sheet's Export row → no spec impact (test only)
} >> .superpowers/sdd/phase-8b-wrapup/spec-evidence.md
```

Write the real lines in place of the three comment lines (the examples show the three forms; `changed` names the requirement exactly as its `### Requirement:` header has it). For every requirement that changed, replace its scenarios' lines in that capability's `## <cap>` section with lines naming the test from Step 4 (format: `<Requirement> / <Scenario> → <test file>: "<test title>"`), and add lines for new scenarios.

If Step 2's first list was empty, the section holds the header lines and one line: `- no code commit since the base: nothing to recheck`.

- [ ] **Step 7: Run the spec checks**

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <every capability Step 5 edited>
grep -rnE "control bar|Tips popover|⚡|presses Save" openspec/changes/explore-workbench/specs | grep -v -- "- FROM:"
git status --short
```

Expected: `Change 'explore-workbench' is valid`; the header check prints nothing (or only the WARN lines `spec-evidence.md` already explains) and `exit 0`; `evidence: 0 problem(s)` (skip the evidence run when no capability was edited); the grep prints nothing; `git status --short` lists only the `spec.md` files Step 5 edited and `proposal.md` if Step 5 fixed its line (nothing at all when no requirement changed: the evidence file is git-ignored).

- [ ] **Step 8: Commit, only if a delta changed**

If `git status --short` is empty, there is no commit: report "no delta changed" with the `## Recheck` lines.

Otherwise (sandbox disabled):

```bash
git add openspec/changes/explore-workbench/specs/<cap>/spec.md   # each edited file, by path (and proposal.md if Step 5 fixed a line)
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git commit -m "docs(openspec): follow the device fixes in the specs"
```

Report: the base and HEAD, the `## Recheck` lines, every requirement changed (old phrase → new text, its evidence test and result), anything reported for a capability without a delta, the spec checks' output, and the commit hash or "no commit".

### Task 8.26: The PR description

The PR text is rewritten for reviewers who know `main` but not this branch: what the page now looks like, that the Table (.tsv) export moved into the new Export menu, how to merge, what was tested, and the three follow-ups as a short note. It is written to the git-ignored source file; the orchestrator asks the user before pasting it into #555.

**Files:**

- Modify: `.superpowers/pr-description.md`

**Interfaces:**

- Consumes: the current text (5 lines: layout, "Draft:" line, tests line); R2 §3(c) proposed text; 8.15/8.16 counts (`.superpowers/sdd/phase-8b-wrapup/verification-report.md`, `## Failures for 8.16` and `## 8.16 fixes`); `.superpowers/sdd/phase-8b-wrapup/device-notes.md` (whether the device pass is done and passed); `gh pr view 526 --json state --jq .state`; the follow-ups: some core files are still over 800 lines (`publish-overlay-controller.ts`, `publish-compositor.ts`, `runtime.ts`, `bundle-v3.ts`, `legacy/conversion.ts`, `webgl-renderer.ts`, and `scatter-plot.ts` by design), core unit tests are not type-checked, the legend code for row actions also handles sorting.
- Produces: the body, at most 15 lines, in this order: one paragraph on the new layout (top bar, toolbar above the plot, a sidebar for the legend and 3D structure that folds away; dark mode; phones and tablets; updated tour; refreshed docs and screenshots; the plot keeping the data's proportions); one line "The Table (.tsv) export from `main` now sits in the new Export menu (under More on phones)."; one line "Builds on #526: merge that first. Use a merge commit, not squash." (8.29 removes the first sentence once #555 targets `main`); a **Tests:** line stating what passed (unit, end-to-end on desktop and phone, performance checks) and, only if the device pass passed, "checked by hand on a phone, a tablet and desktop browsers"; a **Follow-ups (not in this PR):** line naming the three in plain words, without file names.

**Tests:**

- `wc -l .superpowers/pr-description.md` ≤ 15.
- `grep -niE "workbench|mobile-responsive|phase|openspec|controller|\bkit\b|ps-|protspace-|[0-9a-f]{7,}|8\.[0-9]+" .superpowers/pr-description.md` prints nothing. (With `-i`, `[0-9a-f]{7,}` also matches ordinary words made of the letters a–f, such as "feedback": avoid them.)
- The text holds "Table (.tsv)", "merge commit, not squash", a `**Tests:**` line and a `**Follow-ups (not in this PR):**` line, and no "Draft".
- `pnpm exec prettier --check --ignore-path .prettierignore .superpowers/pr-description.md`. The `--ignore-path` is needed: Prettier also reads `.gitignore`, which ignores `.superpowers/`, so a plain `--check` on this file skips it and passes without checking anything.
- The report shows the full text for the orchestrator to put to the user.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. This task writes no tracked file and makes no commit. Never run `gh pr edit`: the orchestrator pastes the text after the user's OK.

- [ ] **Step 1: Write the check and see it fail on the current text**

Save the check as a git-ignored script, so 8.29 can rerun it after it drops the "Builds on #526" sentence:

```bash
mkdir -p .superpowers/sdd/phase-8b-wrapup
cat > .superpowers/sdd/phase-8b-wrapup/check-pr-text.sh <<'EOF'
#!/usr/bin/env bash
# Checks the PR body source: length, banned internal words, required lines.
set -u
f=${1:-.superpowers/pr-description.md}
fail=0
n=$(wc -l < "$f" | tr -d ' ')
if [ "$n" -le 15 ]; then echo "ok length ($n lines)"; else echo "FAIL length ($n lines > 15)"; fail=1; fi
hits=$(grep -niE "workbench|mobile-responsive|phase|openspec|controller|\bkit\b|ps-|protspace-|[0-9a-f]{7,}|8\.[0-9]+" "$f")
if [ -z "$hits" ]; then echo "ok words"; else echo "FAIL words:"; echo "$hits"; fail=1; fi
for want in "Table (.tsv)" "merge commit, not squash" "**Tests:**" "**Follow-ups (not in this PR):**"; do
  if grep -qF "$want" "$f"; then echo "ok has: $want"; else echo "FAIL missing: $want"; fail=1; fi
done
if grep -q "Draft" "$f"; then echo "FAIL still says Draft"; fail=1; else echo "ok no Draft"; fi
exit $fail
EOF
bash .superpowers/sdd/phase-8b-wrapup/check-pr-text.sh; echo "exit $?"
```

Expected (the failing check): `ok length (5 lines)`, `ok words`, `FAIL missing: Table (.tsv)`, `FAIL missing: merge commit, not squash`, `ok has: **Tests:**`, `FAIL missing: **Follow-ups (not in this PR):**`, `FAIL still says Draft`, `exit 1`.

- [ ] **Step 2: Collect the facts the text states**

```bash
gh pr view 526 --json state --jq .state
sed -n '/^## Failures for 8.16/,/^## /p' .superpowers/sdd/phase-8b-wrapup/verification-report.md | head -40
sed -n '/^## 8.16 fixes/,$p' .superpowers/sdd/phase-8b-wrapup/verification-report.md | head -40
cat .superpowers/sdd/phase-8b-wrapup/device-notes.md 2>/dev/null | head -80
```

(`gh` may need the sandbox disabled; if it still cannot reach the API, assume `OPEN` and say so in the report.)

Decide three things and note them for the report:

1. **#526 state.** `OPEN` (expected before the gate): the merge line reads "Builds on #526: merge that first. Use a merge commit, not squash." `MERGED`: it reads "Use a merge commit, not squash." only.
2. **Tests passed.** Every failure listed under "Failures for 8.16" has a fix under "8.16 fixes" (or an orchestrator ruling in the ledger that records it instead of fixing it, which must not be a user-facing failure). If a failure is still open, stop and report BLOCKED: the Tests line cannot say the suites pass.
3. **Device pass.** It passed when `device-notes.md` has an answer for every checklist item and every failing item is fixed and rechecked by the user (an `## 8.18 fixes` section whose items the user confirmed, or no failing item). Only then does the Tests line end with "; checked by hand on a phone, a tablet and desktop browsers". If the file is missing or items are open, leave that clause out and say so in the report (8.29 adds it once the pass is done).

- [ ] **Step 3: Write the description**

Overwrite `.superpowers/pr-description.md` with the text below (shown for #526 `OPEN` and the device pass passed; apply Step 2's two decisions to the merge line and the Tests line):

```markdown
A new layout for the explore page: a top bar, a toolbar above the plot, and a sidebar on the right
for the legend and 3D structure that can be folded away. Also adds dark mode, support for phones
and tablets, an updated product tour, and refreshed docs and screenshots. The plot now uses one
scale for both axes, so clusters keep their shape on every screen and in exported figures.

The Table (.tsv) export from `main` now sits in the new Export menu (under More on phones).

Builds on #526: merge that first. Use a merge commit, not squash.

**Tests:** unit, end-to-end (desktop and phone) and performance checks pass; checked by hand on a
phone, a tablet and desktop browsers.

**Follow-ups (not in this PR):** a few large source files still need splitting, the core package's
unit tests are not type-checked, and the legend code for row actions also handles sorting.
```

The file ends with one newline after the last line (14 lines; 13 without the device clause, when the Tests line reads "**Tests:** unit, end-to-end (desktop and phone) and performance checks pass." on one line). Do not add a heading, a capability list, counts, commit hashes or file names.

- [ ] **Step 4: Run the check and see it pass**

```bash
bash .superpowers/sdd/phase-8b-wrapup/check-pr-text.sh; echo "exit $?"
pnpm exec prettier --check --ignore-path .prettierignore .superpowers/pr-description.md 2>&1 | grep -v "trust settings"
git status --short
```

Expected: every line starts with `ok` (`ok length (14 lines)`, or 13 without the device clause), `exit 0`; Prettier prints "All matched files use Prettier code style!" (if it reports an issue, run the same command with `--write` and rerun the check); `git status --short` is empty (the file is git-ignored).

- [ ] **Step 5: Report**

No commit. Report: Step 1's failing output, Step 2's three decisions with their evidence (the #526 state, the open-failure check, the device-pass state), the full text of `.superpowers/pr-description.md` as written, and Step 4's output. The orchestrator shows the text to the user and, after their OK, runs `gh pr edit 555 --body-file .superpowers/pr-description.md`.

### Task 8.27: A dry-run archive in $TMPDIR

The archive's merge is the step nothing else checks. This task runs it on a copy of `openspec/` in `$TMPDIR`, compares every changed main spec requirement by requirement, and fixes in the delta files whatever would lose or garble text. The repo's `openspec/specs/` is not touched.

**Files:**

- Modify (only to fix findings): `openspec/changes/explore-workbench/specs/*/spec.md`
- Create: `.superpowers/sdd/phase-8b-wrapup/dry-run-report.md`
- Create: `.superpowers/sdd/phase-8b-wrapup/compare-requirements.py` (git-ignored; the requirement-by-requirement comparison, reused by 8.29 and 8.30)
- Scratch: `$TMPDIR/os-dry/` (removed at the end)

**Interfaces:**

- Consumes: R1 §3 "Dry-run archive" commands (`cp -R openspec "$TMPDIR/os-dry/"`, `openspec archive explore-workbench -y` inside it, `openspec validate --specs --strict --no-interactive`); the header check (`bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs`, 8.19); the 29-capability list and the delta format (Global Constraints); `spec-evidence.md` (WARN explanations, 8.20–8.23, 8.25).
- Facts about `openspec archive` 1.4.1 (probed on a copy at `d071e1da`): it prints `Task status: …`, then `Specs to update:` with one `<cap>: create|update` line per capability, then per spec `+ N added`, `~ N modified`, `→ N renamed`, then `Totals: + A, ~ M, - R, → N`, `Specs updated successfully.` and `Change 'explore-workbench' archived as '<YYYY-MM-DD>-explore-workbench'.`; open boxes in `tasks.md` only print `Warning: N incomplete task(s) found. Continuing due to --yes flag.`. A MODIFIED or RENAMED requirement is replaced in place with the delta's block, keeping its position. A new spec is written as `# <cap> Specification`, `## Purpose`, `TBD - created by archiving change explore-workbench. Update Purpose after archive.`, `## Requirements` with no blank lines around the two headings; every spec the archive rewrites also loses the blank line after `## Purpose` and `## Requirements` and gains a trailing blank line. `pnpm exec prettier --write` restores all of that, so the copy is formatted before it is diffed.
- Produces: `dry-run-report.md` with: the archive's output (filtered); `openspec validate --specs --strict` result (63 specs); `grep -rln TBD $TMPDIR/os-dry/openspec/specs` (exactly the 10 new capabilities); `diff -rq openspec/specs $TMPDIR/os-dry/openspec/specs` (exactly 10 new folders and 19 changed `spec.md`, nothing else); per changed spec, each requirement classified as unchanged / modified as intended / added / renamed, with any requirement that lost a scenario or sentence the delta did not mean to drop flagged; the archive's target folder name (`openspec/changes/archive/<YYYY-MM-DD>-explore-workbench/`) and that `plans/`, `mockups/`, `.openspec.yaml` moved with it. This procedure (Steps 2–6, with `compare-requirements.py`) is reused verbatim by 8.29.
- Produces: `python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py <old-specs-dir> <new-specs-dir> <change-specs-dir>`: one line per requirement of every capability the change touches (`<cap>: unchanged|added|modified as intended|renamed|renamed and modified as intended: <requirement>`, prefixed `FLAG ` when the merged text is not what the delta or the old spec says), `FLAG <cap>: lost: <requirement>` for an old requirement that is gone without a REMOVED or RENAMED entry, `CHECK <cap>: scenario not kept by name: <requirement> / <scenario>` for each scenario of a MODIFIED requirement that the merged block no longer has by name, and a last line `summary: <f> FLAG, <c> CHECK`; exit 1 when any FLAG was printed, else 0.

**Tests:** the counts above; zero flagged requirements after the fixes; every CHECK line explained in the report (the scenario was rewritten on purpose, with the new scenario's name, and the reason is in `spec-evidence.md`); the spec checks if a delta changed; `git status --short` shows only the delta fixes (no `openspec/specs/` change); `$TMPDIR/os-dry` removed.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench` (a `( cd "$D" && … )` subshell is the one exception: `openspec archive` works on the `openspec/` folder under the current directory). Pipe every `openspec` call through `grep -v "trust settings"`. `git commit` needs the sandbox disabled.

- [ ] **Step 1: Preconditions**

```bash
ls openspec/changes/explore-workbench/specs | wc -l
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
git status --short
ls openspec/specs | wc -l
grep -rln TBD openspec/specs
```

Expected: `29`; `Change 'explore-workbench' is valid`; the header check exits 0 (WARN lines allowed: each is explained in `spec-evidence.md`); `git status --short` empty; `53`; the TBD grep prints nothing. If any of these differ, stop and report: an earlier task is not done.

- [ ] **Step 2: Write the comparison script**

Create `.superpowers/sdd/phase-8b-wrapup/compare-requirements.py`:

```python
#!/usr/bin/env python3
"""Compare main specs before and after an archive, requirement by requirement.

Usage: python3 -I compare-requirements.py OLD_SPECS NEW_SPECS CHANGE_SPECS

OLD_SPECS is openspec/specs before the archive, NEW_SPECS the same folder after it, CHANGE_SPECS
the change's specs/ folder (the deltas). For every capability with a delta it prints one line per
requirement of the merged spec, FLAG lines for text the archive lost or garbled, CHECK lines for
scenarios of a MODIFIED requirement that the merged block no longer has by name, and a summary.
Exits 1 when any FLAG was printed. Text is compared with whitespace collapsed, so wrapping and
blank lines do not count.
"""
import re
import sys
from pathlib import Path

SECTION = re.compile(r'^## (\S.*?)\s*$')
REQUIREMENT = re.compile(r'^### Requirement: (.+?)\s*$')
SCENARIO = re.compile(r'^#### Scenario: (.+?)\s*$')
RENAME = re.compile(r'^\s*-\s*(FROM|TO):\s*`### Requirement: (.+?)`\s*$')


def parse(text):
    """Requirement blocks in order, as (section, name, body lines); a block ends at the next
    '## ' or '### Requirement:' heading. In a delta the section is ADDED, MODIFIED, REMOVED or
    RENAMED; in a main spec it is 'Requirements'."""
    blocks, section, name, body = [], None, None, []
    for line in text.splitlines():
        sec, req = SECTION.match(line), REQUIREMENT.match(line)
        if sec or req:
            if name is not None:
                blocks.append((section, name, body))
            name, body = None, []
            if sec:
                section = sec.group(1).replace(' Requirements', '').strip()
            else:
                name = req.group(1)
            continue
        if name is not None:
            body.append(line)
    if name is not None:
        blocks.append((section, name, body))
    return blocks


def renames(text):
    """{old name: new name} from the RENAMED section's FROM/TO pairs."""
    pairs, pending = {}, None
    for line in text.splitlines():
        m = RENAME.match(line)
        if not m:
            continue
        if m.group(1) == 'FROM':
            pending = m.group(2)
        elif pending is not None:
            pairs[pending] = m.group(2)
            pending = None
    return pairs


def norm(lines):
    return ' '.join(' '.join(lines).split())


def scenarios(lines):
    return [m.group(1) for m in map(SCENARIO.match, lines) if m]


def main(old_dir, new_dir, change_dir):
    flags = checks = 0

    def flag(message):
        nonlocal flags
        flags += 1
        print('FLAG ' + message)

    for delta_path in sorted(change_dir.glob('*/spec.md')):
        cap = delta_path.parent.name
        delta_text = delta_path.read_text()
        delta = parse(delta_text)
        added = {n: b for s, n, b in delta if s == 'ADDED'}
        modified = {n: b for s, n, b in delta if s == 'MODIFIED'}
        removed = {n for s, n, b in delta if s == 'REMOVED'}
        renamed = renames(delta_text)
        new_from = {new: old for old, new in renamed.items()}

        new_path, old_path = new_dir / cap / 'spec.md', old_dir / cap / 'spec.md'
        if not new_path.exists():
            flag(f'{cap}: no spec after the archive')
            continue
        merged = parse(new_path.read_text())
        merged_map = {n: b for _, n, b in merged}

        if not old_path.exists():
            if [n for _, n, _ in merged] != [n for s, n, _ in delta if s == 'ADDED']:
                flag(f'{cap}: the new spec does not hold exactly the ADDED requirements in order')
            for _, n, body in merged:
                if norm(body) != norm(added.get(n, ['<not in the delta>'])):
                    flag(f'{cap}: added text differs: {n}')
                else:
                    print(f'{cap}: added: {n}')
            continue

        old_map = {n: b for _, n, b in parse(old_path.read_text())}
        for _, n, body in merged:
            if n in added:
                kind, expected = 'added', added[n]
            elif n in modified:
                kind = 'renamed and modified as intended' if n in new_from else 'modified as intended'
                expected = modified[n]
                base = old_map.get(new_from.get(n, n), [])
                kept = scenarios(body)
                for s in scenarios(base):
                    if s not in kept:
                        checks += 1
                        print(f'CHECK {cap}: scenario not kept by name: {n} / {s}')
            elif n in new_from:
                kind, expected = 'renamed', old_map.get(new_from[n], ['<missing>'])
            else:
                kind, expected = 'unchanged', old_map.get(n, ['<not in the old spec>'])
            if norm(body) == norm(expected):
                print(f'{cap}: {kind}: {n}')
            else:
                flag(f'{cap}: {kind}: {n}')
        for n in old_map:
            if n in removed:
                if n in merged_map:
                    flag(f'{cap}: REMOVED but still present: {n}')
            elif n not in merged_map and n not in renamed:
                flag(f'{cap}: lost: {n}')

    print(f'summary: {flags} FLAG, {checks} CHECK')
    return 1 if flags else 0


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(*(Path(a) for a in sys.argv[1:4])))
```

- [ ] **Step 3: Prove the script catches a lost scenario (its failing test)**

Build a one-capability fixture whose MODIFIED block leaves out one of main's two scenarios, archive it in a copy, and run the script:

```bash
F="$TMPDIR/os-cmp-fixture"; rm -rf "$F"; mkdir -p "$F/old/cap-a" "$F/new/cap-a" "$F/change/cap-a"
cat > "$F/old/cap-a/spec.md" <<'EOF'
# cap-a Specification

## Purpose

Fixture.

## Requirements

### Requirement: Kept as is

The thing SHALL stay.

#### Scenario: Stays

- **WHEN** nothing happens
- **THEN** it stays

### Requirement: Edited

The thing SHALL change.

#### Scenario: First

- **WHEN** one
- **THEN** one

#### Scenario: Second

- **WHEN** two
- **THEN** two
EOF
cat > "$F/change/cap-a/spec.md" <<'EOF'
## MODIFIED Requirements

### Requirement: Edited

The thing SHALL change now.

#### Scenario: First

- **WHEN** one
- **THEN** one
EOF
# the merged spec as the archive writes it: the edited block replaced, "Kept as is" garbled
sed -e 's/The thing SHALL stay\./The thing SHALL stay put./' "$F/old/cap-a/spec.md" \
  | awk '/^### Requirement: Edited/{exit} {print}' > "$F/new/cap-a/spec.md"
sed -n '/^### Requirement: Edited/,$p' "$F/change/cap-a/spec.md" >> "$F/new/cap-a/spec.md"
python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py "$F/old" "$F/new" "$F/change"; echo "exit $?"
sed -i '' -e 's/The thing SHALL stay put\./The thing SHALL stay./' "$F/new/cap-a/spec.md"
python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py "$F/old" "$F/new" "$F/change"; echo "exit $?"
rm -rf "$F"
```

Expected, first run:

```
FLAG cap-a: unchanged: Kept as is
CHECK cap-a: scenario not kept by name: Edited / Second
cap-a: modified as intended: Edited
summary: 1 FLAG, 1 CHECK
exit 1
```

Second run (the garbled sentence restored): `cap-a: unchanged: Kept as is`, the same CHECK line, `cap-a: modified as intended: Edited`, `summary: 0 FLAG, 1 CHECK`, `exit 0`. If either run differs, fix the script before going on.

- [ ] **Step 4: Archive a copy of openspec/**

```bash
D="$TMPDIR/os-dry"; rm -rf "$D"; mkdir -p "$D"; cp -R openspec "$D/"
( cd "$D" && openspec archive explore-workbench -y 2>&1 | grep -v "trust settings" ) \
  | tee "$TMPDIR/os-dry-archive.txt"
pnpm exec prettier --write --config .prettierrc --ignore-path .prettierignore "$D/openspec/specs" 2>&1 \
  | grep -v "trust settings" | grep -v "(unchanged)"
( cd "$D" && openspec validate --specs --strict --no-interactive 2>&1 | grep -v "trust settings" | tail -1 )
```

Expected: the archive output lists 29 capabilities under `Specs to update:` (10 `create`, 19 `update`; check with `grep -cE ": create$" "$TMPDIR/os-dry-archive.txt"` → 10 and `grep -cE ": update$" "$TMPDIR/os-dry-archive.txt"` → 19), a `Totals:` line, `Specs updated successfully.` and `Change 'explore-workbench' archived as '<today>-explore-workbench'.` A `Warning: N incomplete task(s) found` line is expected now (8.25–8.30 are open). Prettier lists the 29 specs the archive wrote, and only those (it restores the blank lines around `## Purpose` and `## Requirements`; the 34 untouched specs print `(unchanged)` and are filtered out). Validation ends `Totals: 63 passed, 0 failed (63 items)`.

If the archive refuses (a validation error, a header it cannot find), that is a finding: record the message, fix the delta (Step 7), and rerun from Step 4.

- [ ] **Step 5: The counts**

```bash
D="$TMPDIR/os-dry"
grep -rln TBD "$D/openspec/specs" | sed -E 's#.*/specs/([^/]+)/spec.md#\1#' | sort > "$TMPDIR/os-dry-tbd.txt"
for d in openspec/changes/explore-workbench/specs/*/; do c=$(basename "$d"); [ -f "openspec/specs/$c/spec.md" ] || echo "$c"; done \
  | sort > "$TMPDIR/os-dry-new.txt"
comm -3 "$TMPDIR/os-dry-tbd.txt" "$TMPDIR/os-dry-new.txt"; wc -l < "$TMPDIR/os-dry-tbd.txt"
diff -rq openspec/specs "$D/openspec/specs" | sort > "$TMPDIR/os-dry-diff.txt"
grep -c "^Only in $D/openspec/specs: " "$TMPDIR/os-dry-diff.txt"
grep -c " differ$" "$TMPDIR/os-dry-diff.txt"
grep -vE "^Only in $D/openspec/specs: | differ$" "$TMPDIR/os-dry-diff.txt"
A=$(ls -d "$D"/openspec/changes/archive/*-explore-workbench); echo "$A"; ls -A "$A"
test ! -e "$D/openspec/changes/explore-workbench" && echo "change folder moved"
grep -rnE "control bar|control-bar|Tips popover|Tips & Shortcuts|⚡|presses Save|site header" "$D/openspec/specs" \
  | grep -vE "/query-builder-filtering/spec.md:[0-9]+:The filter query builder: opening it from the control bar" \
  | grep -vE "/support-contact/spec.md:[0-9]+:(The site header SHALL present|inbox, available|header, SHALL offer|The explore page, which shows no site)" \
  | grep -vE "/explore-workbench-layout/spec.md:[0-9]+:.*site header"
```

Expected: the `comm` prints nothing and the TBD count is `10` (exactly the new capabilities); `10` folders only in the copy and `19` changed files; the `grep -vE` on `os-dry-diff.txt` prints nothing (no other difference: no unchanged main spec rewritten, nothing only in the repo); the archive folder is `…/openspec/changes/archive/<today>-explore-workbench` holding `.openspec.yaml`, `design.md`, `mockups`, `plans`, `proposal.md`, `specs`, `tasks.md`; `change folder moved`; the last grep prints nothing. It leaves out three known kinds of line: `query-builder-filtering`'s Purpose, which 8.30 rewrites (an archive never touches a Purpose); `support-contact`'s site-header sentence, which is main's text and still true for the landing and Privacy pages; and `explore-workbench-layout`'s lines saying /explore replaces the site header and the other pages keep it. Adjust the `support-contact` pattern to the line starts 8.22 actually wrote. Any other hit is a finding even though no FLAG covers it: a main-spec requirement that names removed UI and that no delta modifies (8.23 modifies the two `query-builder-filtering` requirements that name `control-bar`/`filterActive` at `d071e1da`; a hit now means a requirement no delta covers). Fix it in Step 7 by adding the requirement to the capability's `## MODIFIED Requirements`, copied whole from the main spec and edited only where the code differs, with its evidence lines.

- [ ] **Step 6: Requirement by requirement**

```bash
D="$TMPDIR/os-dry"
python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py openspec/specs "$D/openspec/specs" \
  openspec/changes/explore-workbench/specs > "$TMPDIR/os-dry-compare.txt"; echo "exit $?"
cat "$TMPDIR/os-dry-compare.txt"
grep -E "^(FLAG|CHECK)" "$TMPDIR/os-dry-compare.txt"
for c in $(sed -n 's/ differ$//p' "$TMPDIR/os-dry-diff.txt" | sed -E 's#.*/specs/([^/]+)/spec.md and .*#\1#'); do
  echo "== $c: $(diff "openspec/specs/$c/spec.md" "$D/openspec/specs/$c/spec.md" | grep -c '^<') lines out, \
$(diff "openspec/specs/$c/spec.md" "$D/openspec/specs/$c/spec.md" | grep -c '^>') lines in"
done
```

Expected after the deltas are right: every merged requirement of the 29 capabilities is listed; no FLAG line; `summary: 0 FLAG, <c> CHECK`; `exit 0`. Then read `diff -u openspec/specs/<cap>/spec.md "$D/openspec/specs/<cap>/spec.md"` for each of the 19 changed specs: every removed `-` line must belong to a requirement the delta names (MODIFIED, RENAMED), and each removed sentence or scenario must be one the delta means to drop (the code no longer does it, per the capability's evidence in `spec-evidence.md`).

Classify each CHECK line in the report:

- **intended**: the old scenario is rewritten under a new name (give the new name) because the behaviour changed, and `spec-evidence.md` (the capability's section or its WARN explanation) says so. Expected example: `CHECK category-focus: scenario not kept by name: The keyboard shortcut list names Shift + Hover / Opening the Tips popover` (replaced by the shortcut-list scenario).
- **finding**: anything else, including a dropped sentence in the requirement text that the code still does.

- [ ] **Step 7: Fix the findings in the deltas (only if Step 4–6 found any)**

For each FLAG, each CHECK classified as a finding, and each stale-term hit from Step 5, in `openspec/changes/explore-workbench/specs/<cap>/spec.md`:

- a lost scenario or sentence of a MODIFIED requirement: copy it back from `openspec/specs/<cap>/spec.md` into the delta's block at the same place, word for word, editing it only where the code now behaves differently (then it is a rewrite: name the test that shows the new behaviour);
- a header the archive could not match: copy the header byte for byte from the main spec;
- `unchanged` flagged (text changed without a delta): the delta's block was matched to the wrong requirement; fix the delta's header;
- `lost`: add the missing requirement to the delta's RENAMED or REMOVED section only if the code dropped it (REMOVED needs `**Reason**:` and `**Migration**:`); otherwise restore it by removing whatever replaced it.

For every scenario added or restored, add its evidence line under the capability's section in `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (`<Requirement> / <Scenario> → <test file>: "<test title>"`), and run that test (unit or browser package-scoped, or one e2e via `-g`, per Global Constraints).

Then run the spec checks and repeat Steps 4–6 until there is no FLAG and every CHECK is intended:

```bash
pnpm exec prettier --write openspec/changes/explore-workbench/specs 2>&1 | grep -v "trust settings" | grep -v unchanged
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" | head -c 400; echo
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
```

Expected: `Change 'explore-workbench' is valid`; the JSON parses (starts with `{`); the header check exits 0.

- [ ] **Step 8: Write the report**

Create `.superpowers/sdd/phase-8b-wrapup/dry-run-report.md`:

```markdown
# Dry-run archive (phase 8B)

## Dry run at <git rev-parse --short HEAD>, <date>

### Archive output

<"$TMPDIR/os-dry-archive.txt", verbatim>

### Counts

- `openspec validate --specs --strict`: <Totals line> (expected 63 passed)
- TBD Purposes: <n> (expected 10), exactly the new capabilities: yes|no
- `diff -rq`: <n> new folders (expected 10), <n> changed spec.md (expected 19), other: none|<lines>
- Archive folder: openspec/changes/archive/<YYYY-MM-DD>-explore-workbench/ holding .openspec.yaml,
  design.md, mockups/, plans/, proposal.md, specs/, tasks.md

### Requirements

<"$TMPDIR/os-dry-compare.txt", verbatim, from the last run>

### CHECK lines

- <cap>: <requirement> / <old scenario> → intended: rewritten as "<new scenario>" (<reason>)

### Findings and fixes

- <FLAG or CHECK line> → <what the delta lost> → fixed in <cap>/spec.md (<restored or rewritten
  scenario, its evidence test>) | none

### Diff size per changed spec

<Step 6's "== <cap>: N lines out, M lines in" lines>
```

8.29 appends a `## Final dry run` section in the same shape.

- [ ] **Step 9: Clean up and check the tree**

```bash
rm -rf "$TMPDIR/os-dry" "$TMPDIR"/os-dry-*.txt
test ! -e "$TMPDIR/os-dry" && echo removed
git status --short
git diff --stat -- openspec/specs
```

Expected: `removed`; `git status --short` lists only delta files under `openspec/changes/explore-workbench/specs/` that Step 7 changed (nothing when there were no findings); the `openspec/specs` diff is empty.

- [ ] **Step 10: Commit (only if a delta changed)**

Commit (sandbox disabled):

```bash
git add $(git diff --name-only -- openspec/changes/explore-workbench/specs)
git commit -m "docs(openspec): keep main's scenarios in the modified specs"
git log -1 --format=%B
```

Expected: the hook passes; one line, no trailer. With no findings there is no commit; say so.

Report: Step 1's preconditions, Step 3's two fixture runs, the archive output, the counts, the FLAG/CHECK lines and their classification, every fix (with its evidence test and result), Step 9's output, and the commit hash or "no commit".

### Task 8.28: GATED — after #526 merges: merge main again if it moved, retarget #555

Starts only when #526 is merged and the user has said to go on. If `main` moved past what this branch holds, it is merged in (a merge commit, as before), conflicts are resolved with the tests, and any main-spec change to the 19 modified capabilities is copied into the deltas. #555 is then pointed at `main`, by GitHub or, with the user's OK, by the orchestrator.

**Files:**

- Merge commit (only if `origin/main` is not an ancestor of HEAD); conflict files unknown until then.
- Modify (only as needed): `openspec/changes/explore-workbench/specs/*/spec.md`, `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md`
- Modify (git-ignored): `.superpowers/sdd/phase-8b-wrapup/verification-report.md` (a `## 8.28 merge` section: conflicts, tests run, unrun specs, the spec count after the merge; Task 8.29 reads it)

**Interfaces:**

- Consumes: `gh pr view 526 --json state,mergedAt,mergeCommit` (must be `MERGED`, else stop BLOCKED); `git fetch origin`; `git merge-base --is-ancestor origin/main HEAD`; the main commit this branch last merged (`44af7d97`); `git diff 44af7d97..origin/main --stat -- openspec/specs/` and per modified capability `git diff 44af7d97..origin/main -- openspec/specs/<cap>/spec.md`; the archived changes `main` added (`ls openspec/changes/archive` new entries, any still-open change in `openspec/changes/` that touches our 29 capabilities); `gh pr view 555 --json baseRefName`.
- Consumes: `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (Task 8.20: prints `evidence: <n> problem(s)`, exit 0 when every scenario of the named capabilities has an evidence line `- <Requirement> / <Scenario> → <file>: "<title>"` and every cited title exists).
- Consumes: `bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh <change-dir> <specs-dir>` (Task 8.19: exit 0 clean; exit 1 with `<cap>: <message>: <requirement>` lines; `WARN <cap>: fewer scenarios than main (<n> < <m>): <requirement>` lines that do not change the exit code; exit 2 when there are no deltas); `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (one `## <cap>` section per capability, its WARN explanations, a `## Recheck` section from 8.25); the RENAMED names `The keyboard shortcut list names Shift + Hover` (`category-focus`) and `Filter queries are built in the Filter panel` (`query-builder-filtering`).
- Produces: HEAD contains `origin/main`; a `## Main drift` section in `spec-evidence.md` (per modified capability: unchanged, or which requirement main changed and how the delta now carries it); the merge report (conflicts and how each was resolved, tests run); a line for the orchestrator: "#555 base is <base>; retarget needed: yes/no".
- Produces for 8.29: `## 8.28 merge` in `verification-report.md` with the merged `origin/main` SHA, "plot path touched: yes/no" (whether the merge changed `packages/utils/src/visualization/`, `packages/core/src/components/scatter-plot/` or `packages/core/src/components/legend/`), the unrun specs, and the number of capabilities in `openspec/specs/` after the merge (53 before; the archive adds 10).

**Tests:** `git merge-base --is-ancestor origin/main HEAD`; the touched files' tests and one e2e spec per conflicted area (more runs in 8.29); `check-headers.sh` exits 0 against the merged `openspec/specs`; `openspec validate explore-workbench --strict` passes; `pnpm precommit` passes on the merge commit.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`; each command block starts with `cd` there (the Bash tool does not keep the working directory or variables). Never `git push`, `gh pr edit`, `gh pr ready` or retarget: the orchestrator does that after asking the user. Never touch branches other than `feat/explore-workbench`. Stage by path; `git add -A` is not allowed in this task.

The 19 modified capabilities, used by several steps (paste the line at the top of a block that needs it):

```bash
MODIFIED_CAPS="query-builder-filtering query-builder-controls protein-search-feedback annotation-presentation category-focus density-contours scatterplot-point-size eat-annotation-overlay eat-reliability-filter eat-provenance-connectors example-datasets support-contact prep-failure-routing e2e-validation webgl-perf-harness perf-checks protein-resource-links table-export structure-coloring"
NEW_CAPS="explore-workbench-layout explore-theming explore-ui-kit plot-proportions legend-panel selection-workflow explore-import-export explore-help explore-mobile-layout docs-media-generation"
```

- [ ] **Step 1: The gate**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
gh pr view 526 --json state,mergedAt,mergeCommit
gh pr view 555 --json baseRefName,state,isDraft
```

Run with the sandbox disabled if `gh` cannot reach `api.github.com`; if it still fails, stop and report BLOCKED ("gh cannot reach GitHub; ask the user whether #526 is merged").

Expected: #526's `state` is `MERGED`, and the orchestrator's brief says the user has said to go on. If the state is anything else, or the brief does not carry the user's go-ahead, stop here and report **BLOCKED: #526 is <state>**; change nothing. Note #555's `baseRefName` (GitHub retargets it to `main` by itself when #526's branch was deleted on merge).

- [ ] **Step 2: Fetch and decide whether a merge is needed**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git status --short
git fetch origin --prune 2>&1 | tail -5
git rev-parse --short origin/main HEAD
git merge-base --is-ancestor origin/main HEAD && echo "main already in HEAD" || echo "main moved"
git log --oneline HEAD..origin/main | wc -l
git log --oneline --first-parent HEAD..origin/main | head -20
```

`git fetch` needs the network: sandbox disabled. Expected: `git status --short` prints nothing (if not, stop BLOCKED with the output). GitHub's merge of #526 creates a merge commit on `main`, so "main moved" is the usual answer even when nothing else landed; the merge is then trivial or close to it.

If it prints "main already in HEAD": there is nothing to merge. Note "no merge needed (origin/main <sha> is an ancestor of HEAD)" and "plot path touched: no" for Step 9's record, and go to Step 6 (the header check still runs; Step 7's drift diff then shows only what `main` changed after `44af7d97` that HEAD already holds).

- [ ] **Step 3: Preview the merge and main's spec changes before merging**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git merge-tree --write-tree --name-only HEAD origin/main | tail -n +2 | sed '/^$/,$d' | head -40
git diff --stat 44af7d97 origin/main -- openspec/specs/ | tail -25
git diff --name-status 44af7d97 origin/main -- openspec/changes/ | head -30
git diff --stat HEAD...origin/main -- packages/utils/src/visualization/ packages/core/src/components/scatter-plot/ packages/core/src/components/legend/ | tail -3
git diff --name-only HEAD...origin/main -- pnpm-lock.yaml '**/package.json' uv.lock
```

Read the output, record it for the report:

- The first command lists the files that will conflict (an empty list: a clean merge).
- The second lists the main specs `main` changed since this branch last merged it. Note which of them are in `$MODIFIED_CAPS`, and whether any of `$NEW_CAPS` now exists on `main` (`git ls-tree --name-only origin/main openspec/specs/ | sed 's|openspec/specs/||'` and compare). A new capability whose folder `main` created is a naming clash: stop and report BLOCKED with the two specs' paths; the orchestrator decides whether ours becomes a MODIFIED delta.
- The third lists changes `main` archived or opened. Any change still open under `openspec/changes/` (not under `archive/`) that names one of our 29 capabilities in its `specs/` folder (`git ls-tree -r --name-only origin/main openspec/changes/ | grep -v '/archive/' | grep '/specs/'`) is reported to the orchestrator: whichever archives second must carry the other's text.
- The fourth says whether the plot path changes ("plot path touched: yes" if it prints any file; Task 8.29 then reruns 573K perf).
- The fifth says whether dependencies change (Step 4 installs if so).

- [ ] **Step 4: Merge, resolving conflicts with the tests**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git merge --no-ff --no-commit origin/main 2>&1 | tail -20
git diff --name-only --diff-filter=U
```

If the list of unmerged files is empty, go to Step 5. Otherwise resolve each file, by the rule the first merge used (`.superpowers/sdd/merge-perf/resolutions.md`): this branch's structure and UI stay; what `main`'s commit did to behaviour is re-applied on top, in the file that owns that job here; files this branch deleted stay deleted (port what `main` changed in them to their successor, or drop it where this branch removed the behaviour); a test `main` pruned stays pruned. For each conflicted file:

1. `git log --oneline 44af7d97..origin/main -- <file>` and `git show <sha> -- <file>` for what `main` meant.
2. Edit the file to hold both intents; remove every conflict marker (`grep -n '^<<<<<<<\|^=======$\|^>>>>>>>' <file>` prints nothing).
3. `git add <file>` (by path).

A conflict in `openspec/specs/` cannot come from this branch (it never edits them before the archive): take `main`'s side (`git checkout --theirs <file> && git add <file>`). Write one line per file for the report: `<file> — ours did … / main did … / kept …`.

If Step 3's fifth command printed a lockfile or `package.json`, run `pnpm install --frozen-lockfile` (sandbox disabled) after resolving; a lockfile conflict is resolved by taking `main`'s `pnpm-lock.yaml`, re-applying this branch's dependency changes in the `package.json` files, and running `pnpm install` (sandbox disabled) to regenerate it, then `git add pnpm-lock.yaml`. A `uv.lock` conflict the same way: take `main`'s `uv.lock` (`git checkout --theirs uv.lock`), run `uv lock` from the worktree root (the lock is the root workspace's; sandbox disabled), then `git add uv.lock`.

- [ ] **Step 5: Test what the merge touched, then commit the merge**

Build, then run the tests of every file that conflicted or that `main` changed in `packages/` or `apps/web/src/` (`git diff --name-only HEAD...MERGE_HEAD -- packages apps/web/src | head -60` is the list `main` brings in: three dots, from the merge base to `main`'s tip; their test files are the `*.test.ts`/`*.browser.test.ts` next to them):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
pnpm --filter @protspace/utils build > /dev/null 2>&1; echo "utils build exit=$?"
pnpm --filter @protspace/core build > /dev/null 2>&1; echo "core build exit=$?"
pnpm --filter @protspace/utils exec vitest --run <utils test files> 2>&1 | grep -E "Test Files|Tests  |FAIL"
pnpm --filter @protspace/core exec vitest --run <core test files> 2>&1 | grep -E "Test Files|Tests  |FAIL|Unhandled"
pnpm --filter @protspace/app exec vitest --run <app test files> 2>&1 | grep -E "Test Files|Tests  |FAIL"
```

(Core with the sandbox disabled when the list holds a `*.browser.test.ts`.) Then one e2e spec per conflicted area, sandbox disabled: the spec that covers the file (`grep -rln "<component tag, id or label of the file>" apps/web/tests/*.spec.ts | head -3`, pick the closest; `--project workbench` for `workbench-*`, `--project=mobile` for `mobile-*`):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec> --project <project> --reporter=line 2>&1 | tail -8
```

If `main` changed Python code or tests (`git diff --name-only HEAD...MERGE_HEAD -- apps/protspace | head`), also run `uv run --directory apps/protspace pytest -m "not slow" -q <the changed test files> 2>&1 | tail -3` and `uv run --directory apps/protspace ruff check src/ packages/ tests/`.

Expected: everything passes. A failure caused by the merge is fixed here, in the conflicted file it comes from, before the commit: write the failing case first if no test catches it, then the fix (the merge commit carries it; record it in the report). A failure that is on `main` itself is reported, not fixed here. To tell, run the same test on `main` alone in a temporary worktree (never `git stash`: the stash stack is shared): `git worktree add "$TMPDIR/wt-main" origin/main`, `pnpm --dir "$TMPDIR/wt-main" install --frozen-lockfile` (sandbox disabled), the same test command with `--dir "$TMPDIR/wt-main"`, then `git worktree remove --force "$TMPDIR/wt-main"`.

List under "Unrun at task time" every other e2e spec the conflicted files reach; Task 8.29 runs the full suites anyway.

Commit the merge with the sandbox disabled (the hook runs `pnpm precommit` on it; never `--no-verify`):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git diff --name-only --diff-filter=U
git commit -m "chore: merge origin/main into feat/explore-workbench"
git log -1 --format='%h %p %s'
git merge-base --is-ancestor origin/main HEAD && echo "main in HEAD"
```

Expected: no unmerged files; the commit has two parents; "main in HEAD". If the hook's lint-staged rewrote a file that only `main` changed (Prettier or ESLint `--fix`), name the file in the report. If the hook fails, fix the cause, `git add` the fix by path, and commit again.

- [ ] **Step 6: The deltas against the merged main specs**

Now `openspec/specs/` holds `main`'s current specs. Run the header check and strict validation:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "headers exit=$?"
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
ls openspec/specs | wc -l
```

Expected: `headers exit=0` (a new `ADDED already in main` or `MODIFIED not in main` line means `main` added or renamed a requirement our delta also names: Step 7 handles it); validate passes; the spec count is 53 plus the capabilities `main` added (record it).

- [ ] **Step 7: Carry main's spec changes into the deltas**

For each capability in `$MODIFIED_CAPS`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
MODIFIED_CAPS="query-builder-filtering query-builder-controls protein-search-feedback annotation-presentation category-focus density-contours scatterplot-point-size eat-annotation-overlay eat-reliability-filter eat-provenance-connectors example-datasets support-contact prep-failure-routing e2e-validation webgl-perf-harness perf-checks protein-resource-links table-export structure-coloring"
for c in $MODIFIED_CAPS; do
  n=$(git diff 44af7d97 HEAD -- "openspec/specs/$c/spec.md" | grep -c '^[-+][^-+]')
  echo "$c: $n changed lines on main"
done
```

A capability with 0 changed lines is "unchanged". For each one with changes, read `git diff 44af7d97 HEAD -- openspec/specs/<cap>/spec.md` and place every changed line in its requirement (the nearest `### Requirement:` above it). Then, per changed requirement:

- **Our delta MODIFIES it (or RENAMES it, then MODIFIES the new name):** our block was copied from the `44af7d97` text and then edited. Rebuild it: copy the whole requirement again from the merged `openspec/specs/<cap>/spec.md` (header byte-for-byte; every scenario), then re-apply our edits, which are the difference between the `44af7d97` requirement (`git show 44af7d97:openspec/specs/<cap>/spec.md`) and our current block. Where `main`'s new text and ours say different things about the same behaviour, the code at HEAD decides: run the scenario's evidence test from `spec-evidence.md` and write what the code does. If `main` renamed the requirement, our MODIFIED header (or RENAMED FROM) takes the new name.
- **Our delta does not touch it:** no delta change; the archive keeps `main`'s text. Check that none of our ADDED requirements (in this capability or a new one) now states the same behaviour differently; if one does, the code decides as above and the ADDED text changes.
- **`main` added a requirement whose name one of our ADDED requirements uses** (the header check printed `ADDED already in main`): if they state the same behaviour, turn ours into a MODIFIED block of `main`'s requirement (copied whole, then edited); if not, rename ours.
- **`main` removed a requirement our delta MODIFIES** (`MODIFIED not in main`): drop our block and, if the behaviour still exists in the code, move it to an ADDED requirement under a name `main` does not use.

Write the section in `.superpowers/sdd/phase-8b-wrapup/spec-evidence.md` (append; one line per modified capability):

```markdown
## Main drift

Merged origin/main <sha> (previous merge 44af7d97). Capabilities in openspec/specs: <n>.

- query-builder-filtering: unchanged
- <cap>: main changed `<requirement>` (<one line: what>); our MODIFIED block re-copied from main and our edits re-applied | not in our delta, no change | …
- New capabilities on main overlapping ours: none | <list>
- Open changes on main touching our capabilities: none | <list>
```

Update each changed scenario's evidence line in its `## <cap>` section if the test behind it changed.

- [ ] **Step 8: Check and commit the delta changes**

Skip this step if Step 7 changed no `spec.md`. Otherwise:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
pnpm exec prettier --write openspec/changes/explore-workbench/specs
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
openspec change show explore-workbench --json --deltas-only 2>&1 | grep -v "trust settings" | head -c 400; echo
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "headers exit=$?"
python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <every capability Step 7 changed>
pnpm exec prettier --check openspec/changes/explore-workbench/specs
git status --short
```

Expected: validate passes; the deltas parse; `evidence: 0 problem(s)` (a scenario carried from main gets its evidence line in that capability's section, in Task 8.20's format); `headers exit=0`, and any WARN line is either explained in `spec-evidence.md` already or gets its explanation now (a WARN for a re-copied block means a scenario was left out: copy it back unless the code dropped that behaviour, and say which); Prettier is clean; `git status --short` lists only the changed `spec.md` files. Commit them with the sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git add openspec/changes/explore-workbench/specs/<cap>/spec.md   # each changed file by path
git commit -m "docs(openspec): follow main's spec changes in the deltas"
```

- [ ] **Step 9: #555's base, the record, and the report**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
gh pr view 555 --json baseRefName,headRefOid --jq '.baseRefName + " " + .headRefOid'
git rev-parse HEAD
git status --short
```

Append to `.superpowers/sdd/phase-8b-wrapup/verification-report.md`:

```markdown
## 8.28 merge

Merged origin/main <sha> into <pre-merge HEAD> as <merge sha> (or: no merge needed).
Conflicts: none | one line per file: ours did … / main did … / kept ….
Fixed in the merge: none | <what, with its test>.
Tests run: <files and counts>; e2e: <spec — passed/failed>.
Plot path touched: yes/no (<files>).
Capabilities in openspec/specs after the merge: <n> (archive target: <n + 10>).
Unrun at task time: <specs>, perf:counts.
Lint-staged rewrote main-only files: none | <files>.
```

Expected: `git status --short` prints nothing. Report to the orchestrator: the merge and delta commits (or "no merge needed"), "#555 base is <base>; retarget needed: yes/no" (yes when the base is not `main`; the orchestrator asks the user before `gh pr edit 555 --base main`), "ready to push <HEAD sha>" (never push yourself), the open-change and new-capability findings, and concerns.

**Commit:** `chore: merge origin/main into feat/explore-workbench` (only if `main` moved); `docs(openspec): follow main's spec changes in the deltas` (only if a delta changed).

### Task 8.29: GATED — the final full run, the spec checks once more, CI green

The second and last full run, on the tree that will be archived: every suite and e2e project from 8.15, `perf:counts`, 573K perf only if the re-merge touched the plot path, the header check and the dry-run archive again, then the push (with the user's OK) and every CI workflow green on the pushed tip. The PR text's "Builds on #526" sentence goes once #555 targets `main`.

**Files:**

- Modify: `.superpowers/sdd/phase-8b-wrapup/verification-report.md` (`## Final run` section), `.superpowers/sdd/phase-8b-wrapup/dry-run-report.md` (`## Final dry run`), `.superpowers/pr-description.md` (drop "Builds on #526: merge that first.")
- Fixes only for failures this run finds, each test-first, each with its spec recheck (8.25's rule).
- Create (git-ignored): `.superpowers/sdd/phase-8b-wrapup/screenshots/p8b-final-*.png`

**Interfaces:**

- Consumes: 8.15's command list (repeated in Steps 3–8 below); the perf rule and the plot-path condition (Global Constraints, Rulings); 8.27's dry-run procedure, repeated in Step 9 below with `python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py <old-specs-dir> <new-specs-dir> <change-specs-dir>` (8.27: one line per requirement, `FLAG …` for lost or garbled text, `CHECK <cap>: scenario not kept by name: <requirement> / <scenario>` for a scenario renamed, and a last line `summary: <f> FLAG, <c> CHECK`; exit 1 on any FLAG); `bash .superpowers/sdd/phase-8b-wrapup/check-pr-text.sh` (8.26: prints `ok …`/`FAIL …` lines for length ≤ 15, banned words, the required lines and no "Draft"; exit 0 when all pass); `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>…` (8.20: `evidence: 0 problem(s)` when clean); `gh pr view 555 --json baseRefName,headRefOid`; `gh run list --branch feat/explore-workbench --limit 20` / `gh pr checks 555` (workflows expected: `ci.yml`, `e2e.yml`, `bundle-contract.yml`, `protspace-ci.yml`, `prep-ci.yml`, `publish-images.yml`, `example-bundles.yml`); the nightly history on `main` for any red e2e (`gh run list --workflow=e2e.yml --event=schedule`).
- Consumes (from earlier tasks, by these names): `verification-report.md` § `## Suites`, `## E2E`, `## Perf` (8.15's baseline counts and perf table), `## 8.16 fixes` and `## 8.28 merge` (its "Plot path touched: yes/no", "Capabilities in openspec/specs after the merge: <n>" and "Unrun at task time" lines); `device-notes.md` § `## 8.18 fixes` (its "unrun at task time" column); `dry-run-report.md` (8.27's report: its `### CHECK lines` section lists every CHECK line it classified as intended); `.superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs <base-url> <prefix>` (8.15: writes `<prefix>-desktop-export-{light,dark}.png`, `<prefix>-phone-more-sheet-{light,dark}.png`, `<prefix>-phone-export-{light,dark}.png`, `<prefix>-tablet-light.png`, `<prefix>-floating-structure-light.png` into `screenshots/`, and waits for the server itself); `check-headers.sh <change-dir> <specs-dir>` (8.19: exit 0 clean, 1 on an error line, WARN lines never change the exit code).
- Produces: `## Final run` counts against 8.15's baseline; the final dry-run report; "ready to push <sha>" for the orchestrator, then, after the user's OK and the push, every workflow's conclusion on that SHA; screenshots for the user (`p8b-final-*.png`: desktop light and dark with the Export menu open, phone More sheet, tablet, floating structure at 1280×720) in `.superpowers/sdd/phase-8b-wrapup/screenshots/`.

**Tests:** every 8.15 check passes (unrun specs from 8.16/8.18/8.28 first); `check-headers.sh` exits 0; the dry run's counts hold (10 TBD, 10 new + 19 changed) and `compare-requirements.py` ends `summary: 0 FLAG, <c> CHECK` with the CHECK lines 8.27 classified as intended; CI green on the pushed tip; a red CI run is investigated, never called flaky from local passes.

The task has two parts, dispatched as two briefs. **Part A** (Steps 1–12) runs locally and ends with "ready to push <sha>": stop there and report. The orchestrator asks the user, pushes, and (with the user's OK) retargets #555 if Task 8.28 said so. **Part B** (Steps 13–15) is dispatched after the push, to a fresh agent with this whole task text; it starts at Step 13. Never `git push`, `gh pr edit`, `gh pr ready` or retarget yourself.

Every command block starts from the worktree and sets the paths it uses (the Bash tool keeps neither the directory nor variables between calls):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
```

Long runs (core, every e2e run, perf, `pnpm precommit`, the CI watch) go through the Bash tool's `run_in_background`; read the log when it reports the exit. Never ports 8080, 8091 or 8479.

- [ ] **Step 1: The gate and the starting state**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
mkdir -p "$SCRATCH/logs" "$SCRATCH/perf" "$SCRATCH/v3"
gh pr view 526 --json state --jq .state
gh pr view 555 --json baseRefName,headRefOid --jq '.baseRefName + " " + .headRefOid'
grep -n "^## 8.28 merge" -A10 .superpowers/sdd/phase-8b-wrapup/verification-report.md
git rev-parse --short HEAD; git status --short; ls perf/results; sysctl -n vm.loadavg
git fetch origin 2>&1 | tail -2; git merge-base --is-ancestor origin/main HEAD && echo "main in HEAD"
```

(`gh` and `git fetch` with the sandbox disabled if they cannot reach GitHub; if `gh` still fails, report BLOCKED and ask for the PR states.) Expected: `MERGED`; the `## 8.28 merge` section exists; `git status --short` and `perf/results` are empty; "main in HEAD". If #526 is not `MERGED`, the brief lacks the user's go-ahead, 8.28 has not run, or `main` moved again since 8.28 (no "main in HEAD"), stop and report **BLOCKED** with the reason; change nothing. Note #555's base: `main`, or `perf/improvements` still (then the orchestrator retargets after asking the user; the local run goes on).

- [ ] **Step 2: First, every spec left unrun since 8.15**

Collect the list:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
grep -n -i "unrun" .superpowers/sdd/phase-8b-wrapup/verification-report.md .superpowers/sdd/phase-8b-wrapup/device-notes.md .superpowers/sdd/phase-8b-wrapup/progress.md 2>/dev/null
```

Run each named e2e spec alone, once, sandbox disabled (`--project workbench` for `workbench-*`, `--project=mobile` for `mobile-*`, none for the others):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec>.spec.ts --reporter=line 2>&1 | tail -6
```

Expected: each passes. A failure goes to Step 11 as a finding (with this output), and the full runs below still happen.

- [ ] **Step 3: Build, then the unit and browser suites and the contract tests**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm --filter @protspace/utils build > "$SCRATCH/logs/final-build-utils.log" 2>&1; echo "utils build exit=$?"
pnpm --filter @protspace/core build > "$SCRATCH/logs/final-build-core.log" 2>&1; echo "core build exit=$?"
pnpm --filter @protspace/utils exec vitest --run > "$SCRATCH/logs/final-utils.log" 2>&1; echo "utils exit=$?"; grep -E "Test Files|Tests  " "$SCRATCH/logs/final-utils.log"
pnpm --filter @protspace/app exec vitest --run > "$SCRATCH/logs/final-app.log" 2>&1; echo "app exit=$?"; grep -E "Test Files|Tests  " "$SCRATCH/logs/final-app.log"
```

Sandbox disabled for these two (a browser server; `uv run`):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm --filter @protspace/core exec vitest --run > "$SCRATCH/logs/final-core.log" 2>&1; echo "core exit=$?"; grep -E "Test Files|Tests  |Unhandled|Errors" "$SCRATCH/logs/final-core.log"
pnpm test:contract > "$SCRATCH/logs/final-contract.log" 2>&1; echo "contract exit=$?"; grep -E "Test Files|Tests  " "$SCRATCH/logs/final-contract.log"
```

Expected: every exit 0; core shows no "Unhandled Errors". Counts are compared with 8.15's `## Suites`: every difference is explained by a commit since 8.15 (`git diff --name-status <8.15 HEAD> HEAD -- '*.test.ts' | head -30`, where `<8.15 HEAD>` is the SHA in the report's `## Commit`).

- [ ] **Step 4: Python lint, format and tests**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
uv run --directory apps/protspace ruff check src/ packages/ tests/ > "$SCRATCH/logs/final-ruff-check.log" 2>&1; echo "ruff check exit=$?"
uv run --directory apps/protspace ruff format --check src/ packages/ tests/ > "$SCRATCH/logs/final-ruff-format.log" 2>&1; echo "ruff format exit=$?"
uv run --directory apps/protspace pytest -m "not slow" -q > "$SCRATCH/logs/final-pytest.log" 2>&1; echo "pytest exit=$?"; tail -3 "$SCRATCH/logs/final-pytest.log"
```

(Sandbox disabled if `uv` needs to fill its cache.) Expected: all exit 0; the pytest count against 8.15's, differences explained by `main`'s commits from the re-merge.

- [ ] **Step 5: The full e2e run, mobile three times, the tour five times**

Sandbox disabled; one after the other:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
PLAYWRIGHT_PORT=8475 pnpm test:e2e --reporter=line > "$SCRATCH/logs/final-e2e-full.log" 2>&1; echo "e2e full exit=$?"
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" "$SCRATCH/logs/final-e2e-full.log"
grep -E "^\s+[0-9]+\) \[" "$SCRATCH/logs/final-e2e-full.log" | head -30
```

If 8.15 recorded the Firefox/WebKit projects as "CI only (browser not installed)", run this with `E2E_BROWSERS=chromium` in front, as 8.15 did.

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
for i in 1 2 3; do
  PLAYWRIGHT_PORT=8475 pnpm test:e2e --project=mobile --reporter=line > "$SCRATCH/logs/final-e2e-mobile-$i.log" 2>&1; echo "mobile run $i exit=$?"
  grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" "$SCRATCH/logs/final-e2e-mobile-$i.log"
done
PLAYWRIGHT_PORT=8475 pnpm test:e2e product-tour.spec.ts --repeat-each 5 --reporter=line > "$SCRATCH/logs/final-e2e-tour.log" 2>&1; echo "tour exit=$?"
grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)" "$SCRATCH/logs/final-e2e-tour.log"
```

Expected: every run exits 0, counts against 8.15's `## E2E`. A failure is rerun once alone (`PLAYWRIGHT_PORT=8475 pnpm test:e2e <spec> -g "<title>" --project <project> --reporter=line 2>&1 | tail -15`); it is a known flake only if it is on the Global Constraints list **and** passes alone. Anything else is a Step 11 finding.

- [ ] **Step 6: The work counts, always**

Sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm perf:counts > "$SCRATCH/logs/final-perf-counts.log" 2>&1; echo "perf:counts exit=$?"; tail -40 "$SCRATCH/logs/final-perf-counts.log"
git diff --stat apps/web/tests/perf/budgets.json
```

Expected: exit 0, every budget met, `budgets.json` unchanged (never re-record).

- [ ] **Step 7: 573K timing, only if the re-merge touched the plot path**

Decide from two facts: `Plot path touched:` in `## 8.28 merge`, and the commits since 8.15's HEAD (the SHA in `verification-report.md`'s `## Commit`) on the plot path:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git log --oneline <8.15 HEAD>..HEAD -- packages/utils/src/visualization/ packages/core/src/components/scatter-plot/ packages/core/src/components/legend/
```

If the `git log` prints nothing **and** `Plot path touched:` says `no`, write "573K not rerun: no commit since 8.15 touched the plot path (Rulings)" and go to Step 8. Otherwise (any commit listed: an 8.16 or 8.18 fix, 8.28's merge, a fix of this task; or `yes`) run it, and name those commits in the report: rebuild the v3 bundle if it is gone, check it, and run twice (sandbox disabled):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
V3="$SCRATCH/v3/573K_swissprot.parquetbundle"
[ -f "$V3" ] || uv run --directory apps/protspace protspace convert "$PWD/perf/datasets/573K_swissprot.parquetbundle" "$V3" > "$SCRATCH/logs/final-convert.log" 2>&1
stat -f '%z %N' "$V3"
for i in 1 2; do
  sysctl -n vm.loadavg
  pnpm perf --datasets "$V3" --runs 4 > "$SCRATCH/logs/final-perf-573k-$i.log" 2>&1; echo "perf run $i exit=$?"
  grep -E "heap|^[a-z-]+ +[0-9-]" "$SCRATCH/logs/final-perf-573k-$i.log" | head -20
  mv perf/results/*.json "$SCRATCH/perf/" 2>/dev/null; ls perf/results
done
```

Expected: the v3 file is about 36 MB (33–39 MB; otherwise stop and report: never time the 44.9 MB v1 file); heap about 31 MB. Compare each segment's INP/LoAF/busy/restage with the reference (the 8A polish B column, HEAD `46176145`): import 72/83/305/58, annotation-switch 40/56/75/39, projection-switch 48/76/154/38, projection-switch-instant 40/68/98/34, legend-isolate 56/0/33/0, hover -/0/90/0, camera 40/0/82/0, resize -/0/88/0, panel-toggle 56/0/56/0, panel-expand 56/0/81/0, theme-switch -/0/18/0, search-select 40/0/32/0. A segment is suspect only when both runs show busy more than 20 ms above the reference **and** more than 10 % above it, or INP 16 ms or more above it (two 8 ms steps). A suspect segment gets exactly one interleaved A/B, sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
git worktree add "$SCRATCH/wt-ref" 46176145 > /dev/null 2>&1; echo "worktree exit=$?"
pnpm --dir "$SCRATCH/wt-ref" install --frozen-lockfile > "$SCRATCH/logs/final-ab-install.log" 2>&1; echo "install exit=$?"
pnpm --dir "$SCRATCH/wt-ref" turbo run build --filter=@protspace/app > "$SCRATCH/logs/final-ab-build-ref.log" 2>&1; echo "ref build exit=$?"
pnpm turbo run build --filter=@protspace/app > "$SCRATCH/logs/final-ab-build-head.log" 2>&1; echo "head build exit=$?"
nohup pnpm --dir "$SCRATCH/wt-ref/apps/web" exec vite preview --port 8302 --strictPort > "$SCRATCH/logs/final-ab-preview-ref.log" 2>&1 &
nohup pnpm --dir apps/web exec vite preview --port 8303 --strictPort > "$SCRATCH/logs/final-ab-preview-head.log" 2>&1 &
```

When `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8302/explore` and the same for 8303 print `200`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
pnpm perf --url http://localhost:8302 --compare http://localhost:8303 --datasets "$SCRATCH/v3/573K_swissprot.parquetbundle" --runs 5 > "$SCRATCH/logs/final-perf-ab.log" 2>&1; echo "A/B exit=$?"
grep -E "heap|→" "$SCRATCH/logs/final-perf-ab.log" | head -20
mv perf/results/*.json "$SCRATCH/perf/" 2>/dev/null; rm -rf perf/results/*-pixels; ls perf/results
```

Stop the two previews by PID (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`, confirm with `ps -p <pid> -o command=` that it is `vite preview --port <port>`, then `kill <pid>`), and `git worktree remove --force "$SCRATCH/wt-ref"`. A busy and restage ratio inside 0.9–1.1 is noise; outside it is a Step 11 finding (cheap diagnosis and a few-line fix or a written note; no restructuring for tens of ms).

- [ ] **Step 8: The repository checks and the pre-commit chain**

`ls perf/results` prints nothing first. Sandbox disabled:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
ls perf/results
for c in lint quality shared-constants:check docs:annotations:check docs:examples:check docs:images:check docs:build format:check; do
  pnpm "$c" > "$SCRATCH/logs/final-check-$c.log" 2>&1; echo "$c exit=$?"
done
pnpm precommit > "$SCRATCH/logs/final-check-precommit.log" 2>&1; echo "precommit exit=$?"; tail -3 "$SCRATCH/logs/final-check-precommit.log"
```

Expected: every line `exit=0`. A non-zero exit is a Step 11 finding with its first error (`grep -m3 -iE "error|fail|✖" <log>`).

- [ ] **Step 9: The header check and the dry-run archive, once more**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "headers exit=$?"
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
```

Expected: `headers exit=0`, every WARN line already explained in `spec-evidence.md`; validate passes. Then the dry run on a copy, the same procedure as Task 8.27 Steps 4–6 (the repository's `openspec/` is never archived here):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
D="$TMPDIR/os-dry"; rm -rf "$D"; mkdir -p "$D"; cp -R openspec "$D/"
( cd "$D" && openspec archive explore-workbench -y 2>&1 | grep -v "trust settings" ) > "$TMPDIR/os-dry-archive.txt"
tail -40 "$TMPDIR/os-dry-archive.txt"
grep -cE ": create$" "$TMPDIR/os-dry-archive.txt"; grep -cE ": update$" "$TMPDIR/os-dry-archive.txt"
pnpm exec prettier --write --config .prettierrc --ignore-path .prettierignore "$D/openspec/specs" 2>&1 \
  | grep -v "trust settings" | grep -v "(unchanged)"
( cd "$D" && openspec validate --specs --strict --no-interactive 2>&1 | grep -v "trust settings" | tail -1 )
```

Expected: `10` create and `19` update lines; `Specs updated successfully.` and `Change 'explore-workbench' archived as '<today>-explore-workbench'.` in the archive output (a `Warning: N incomplete task(s) found` line is expected: 8.30 ticks the last boxes); Prettier lists only the 29 specs the archive wrote (it restores the blank lines the archive drops around `## Purpose` and `## Requirements`); validation ends `Totals: <n> passed, 0 failed (<n> items)` where `<n>` is `## 8.28 merge`'s "Capabilities in openspec/specs after the merge" plus 10.

The counts and the stale-term check:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
D="$TMPDIR/os-dry"
grep -rln TBD "$D/openspec/specs" | sed -E 's#.*/specs/([^/]+)/spec.md#\1#' | sort > "$TMPDIR/os-dry-tbd.txt"
for d in openspec/changes/explore-workbench/specs/*/; do c=$(basename "$d"); [ -f "openspec/specs/$c/spec.md" ] || echo "$c"; done \
  | sort > "$TMPDIR/os-dry-new.txt"
comm -3 "$TMPDIR/os-dry-tbd.txt" "$TMPDIR/os-dry-new.txt"; wc -l < "$TMPDIR/os-dry-tbd.txt"
diff -rq openspec/specs "$D/openspec/specs" | sort > "$TMPDIR/os-dry-diff.txt"
grep -c "^Only in $D/openspec/specs: " "$TMPDIR/os-dry-diff.txt"
grep -c " differ$" "$TMPDIR/os-dry-diff.txt"
grep -vE "^Only in $D/openspec/specs: | differ$" "$TMPDIR/os-dry-diff.txt"
ls -A "$D"/openspec/changes/archive/*-explore-workbench
test ! -e "$D/openspec/changes/explore-workbench" && echo "change folder moved"
grep -rnE "control bar|control-bar|Tips popover|Tips & Shortcuts|⚡|presses Save|site header" "$D/openspec/specs" \
  | grep -vE "/query-builder-filtering/spec.md:[0-9]+:The filter query builder: opening it from the control bar" \
  | grep -vE "/support-contact/spec.md:[0-9]+:(The site header SHALL present|inbox, available|header, SHALL offer|The explore page, which shows no site)" \
  | grep -vE "/explore-workbench-layout/spec.md:[0-9]+:.*site header"
```

Expected: the `comm` prints nothing and the TBD count is `10` (`docs-media-generation explore-help explore-import-export explore-mobile-layout explore-theming explore-ui-kit explore-workbench-layout legend-panel plot-proportions selection-workflow`); `10` folders only in the copy and `19` changed files; the `grep -vE` on `os-dry-diff.txt` prints nothing; the archive folder holds `.openspec.yaml`, `design.md`, `mockups`, `plans`, `proposal.md`, `specs`, `tasks.md`; `change folder moved`; the stale-term grep prints nothing (it leaves out `query-builder-filtering`'s Purpose, which 8.30 rewrites, `support-contact`'s site-header sentence, true for the landing and Privacy pages, and `explore-workbench-layout`'s site-header lines; use the same patterns 8.27's report recorded if they were adjusted there). Any other hit is a Step 11 finding.

Requirement by requirement:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
D="$TMPDIR/os-dry"
python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py openspec/specs "$D/openspec/specs" \
  openspec/changes/explore-workbench/specs > "$TMPDIR/os-dry-compare.txt"; echo "exit $?"
grep -E "^(FLAG|CHECK|summary)" "$TMPDIR/os-dry-compare.txt"
sed -n '/^### CHECK lines/,/^### /p' .superpowers/sdd/phase-8b-wrapup/dry-run-report.md
```

Expected: `exit 0`; no FLAG line; `summary: 0 FLAG, <c> CHECK`; every CHECK line is one 8.27 classified as intended (its `### CHECK lines` section), unless a commit since 8.27 (an 8.18 device fix, 8.28's drift, a fix of this task) explains a new one: name the commit. A FLAG, or a CHECK no commit explains, is a Step 11 finding. If `compare-requirements.py` is missing (the folder was cleaned), report BLOCKED: 8.27 must be rerun first.

Clean up: `rm -rf "$TMPDIR/os-dry" "$TMPDIR"/os-dry-*.txt`, then `git status --short` prints nothing (nothing in `openspec/specs/` changed).

Append to `.superpowers/sdd/phase-8b-wrapup/dry-run-report.md`:

```markdown
## Final dry run

HEAD <sha>, origin/main <sha>. Archive output: 10 create, 19 update, errors: none.
validate --specs --strict: pass (<n> specs). TBD in: <the 10>. diff -rq: 10 new + 19 changed, nothing else.
Archive folder: <YYYY-MM-DD>-explore-workbench (plans/, mockups/, .openspec.yaml, specs/ moved).
Stale-term grep: nothing | <hits>.
Compare output: <summary line>.
CHECK lines (verbatim, each with "as in 8.27" or the commit that explains it):
<lines>
```

- [ ] **Step 10: Screenshots for the user**

Sandbox disabled. Start a dev server on 8476 with the e2e startup fixture, run 8.15's script with the `p8b-final` prefix, and stop only that server:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
SCRATCH=/private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b
VITE_STARTUP_DATASET_URL="/@fs$PWD/apps/web/tests/fixtures/demo_toxprot_7831.parquetbundle" \
  nohup pnpm --dir apps/web exec vite --port 8476 --strictPort > "$SCRATCH/logs/final-shots-server.log" 2>&1 &
node .superpowers/sdd/phase-8b-wrapup/screens/shoot.mjs http://localhost:8476 p8b-final > "$SCRATCH/logs/final-shots.log" 2>&1; echo "shots exit=$?"; tail -10 "$SCRATCH/logs/final-shots.log"
PID=$(lsof -nP -iTCP:8476 -sTCP:LISTEN -t); ps -p "$PID" -o command=
```

If the `ps` line is this worktree's `vite --port 8476 --strictPort`, `kill "$PID"`. Expected: `shots exit=0` and eight `p8b-final-*.png` files. Open each with the Read tool: the Export menu lists "Table (.tsv)" (desktop light and dark, phone), the phone More sheet shows its rows, the tablet shows the panel under the plot, the floating card sits above the selection bar. (A "WebGL does not seem to be available" message in the structure card is headless Chromium.) If `shoot.mjs` is missing, report it and go on without screenshots.

- [ ] **Step 11: Fix what this run found, each test-first**

Skip if Steps 2–10 found nothing. If there is more than one finding, or one whose fix needs code in more than one file, stop after Step 10 instead: report the findings in the form of 8.15's `## Failures for 8.16` (numbered, each with its reproduction command and first error) and change nothing; the orchestrator dispatches them as fix briefs under 8.16's fixer contract plus this step's spec recheck (item 5), then resumes this task here to rerun the full run each finding came from. Otherwise, for the one finding:

1. Reproduce it with the single command that showed it.
2. Write a test that fails for its cause (the failing test itself when it is a test; a unit or browser test where the cause lives; for a check, the check), run it, see it fail with the cause.
3. Apply the smallest fix inside the area (every Global Constraint holds; no `.github/workflows/*`; docs scenes recaptured only if the fix changes them: `pnpm docs:screenshots -g "<file>"`, light and dark twins, then `pnpm docs:images:check`).
4. Run the test, the touched files' test files and the reproduction command: they pass. At most one e2e spec per finding.
5. Spec recheck: if the fix changes behaviour a delta states (`grep -rn "<the behaviour's words>" openspec/changes/explore-workbench/specs/`), edit that requirement or scenario in the same commit (headers byte-for-byte), update its line in `spec-evidence.md` and add a line to its `## Recheck` section (`<sha> <subject> → <cap>/<requirement> changed`), then run `pnpm exec prettier --write openspec/changes/explore-workbench/specs`, `openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"`, the header check (exit 0) and `python3 .superpowers/sdd/phase-8b-wrapup/check-evidence.py <cap>` (`evidence: 0 problem(s)`).
6. `pnpm exec prettier --check <changed files>`; `git add <files by path>`; `git commit -m "fix(<scope>): <what the user sees now>"` (or `test(<scope>): …`; under 72 characters, at most two lines, no trailer), sandbox disabled, never `--no-verify`.

After the fixes, rerun Step 9's header check and dry run if any delta changed, and rerun the one full run the finding came from (e.g. the `--project=mobile` run, or `pnpm precommit`); the rest of the full run is not repeated unless a fix touched `packages/` or `apps/web/src/` shared by other areas, in which case rerun Steps 3 and 5. A red CI run later goes through this step too.

- [ ] **Step 12: Write the final-run record and stop: ready to push**

Append to `.superpowers/sdd/phase-8b-wrapup/verification-report.md`:

```markdown
## Final run

HEAD <sha> (date, load average). #555 base: <base>. Unrun specs from 8.16/8.18/8.28: <spec — result>.

| suite / run | 8.15 baseline | final | delta and why |
| --- | --- | --- | --- |
| utils | … | … | … |
| core (unit + browser) | … | … | … |
| app | … | … | … |
| contract | … | … | … |
| pytest | … | … | … |
| e2e full | … | … | … |
| mobile ×3 | … | … | … |
| tour ×5 | … | … | … |

Checks: every Step 8 check, ruff check and format: exit … each.
perf:counts: pass/fail; budgets unchanged. 573K: not rerun (reason) | runs and verdict.
Fixes in this task: none | <sha subject — finding — test>.
Screenshots: screenshots/p8b-final-*.png (eight).
```

Then:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git status --short; ls perf/results; git worktree list
git log --oneline origin/feat/explore-workbench..HEAD
git rev-parse HEAD
```

Expected: no tracked change, `perf/results` empty, no `wt-ref` worktree. Report **"ready to push <sha>"** with the commits not yet on `origin/feat/explore-workbench`, the `## Final run` table, the dry-run result, the screenshot paths, and "#555 base is <base>; retarget needed: yes/no". Stop here. Part B starts when the orchestrator says the push is done.

- [ ] **Step 13: (Part B, after the push) Every workflow on the pushed tip**

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
git fetch origin 2>&1 | tail -2
git rev-parse HEAD origin/feat/explore-workbench
gh pr view 555 --json baseRefName,headRefOid --jq '.baseRefName + " " + .headRefOid'
gh run list --branch feat/explore-workbench --limit 20 --json name,headSha,status,conclusion,workflowName --jq '.[] | select(.headSha=="'"$(git rev-parse HEAD)"'") | .workflowName + " | " + .status + " | " + (.conclusion // "")'
```

(Sandbox disabled for `gh` and `git fetch` if needed.) Expected: the two SHAs are equal and match #555's `headRefOid`; #555's base is `main` (if it is not, report it: the orchestrator retargets after asking the user, and CI reruns on the new base). The runs for this SHA include `CI - Code Quality` (`ci.yml`), `E2E Tests (Playwright)` (`e2e.yml`), `Bundle format contract (Python ↔ TypeScript)` (`bundle-contract.yml`), `protspace CI (Python)` (`protspace-ci.yml`), `prep CI (Python)` (`prep-ci.yml`), `Publish container images` (`publish-images.yml`) and `Example bundles` (`example-bundles.yml`). A missing workflow is checked against its `paths:` filter in `.github/workflows/<file>` and the PR's three-dot diff (`git diff --name-only origin/main...HEAD | head`): report it as "not triggered, because …" or as a finding.

Wait for them, in the background (Bash `run_in_background`):

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
gh pr checks 555 --watch --interval 60 > /private/tmp/claude-501/-Users-heispv-Documents-protspace-web-protspace-workbench/54de585e-d1f2-4654-b4da-56d084c7baf0/scratchpad/p8b/logs/final-ci.log 2>&1; echo "checks exit=$?"
```

Then `tail -40` that log. Expected: exit 0, every check `pass` (a `skipping` check is fine when its workflow's conditions say so; name it).

- [ ] **Step 14: (Part B) A red run is investigated, never called flaky from local passes**

For each failing check: `gh run view <run-id> --log-failed | tail -60` for the first error. For a red `E2E Tests (Playwright)`, compare with the nightly on `main`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
gh run list --workflow=e2e.yml --event=schedule --limit 10 --json conclusion,headSha,createdAt --jq '.[] | .createdAt + " " + .conclusion + " " + .headSha[0:8]'
```

If the same test fails on the nightly too, it is `main`'s, and the report says so with the nightly run's id; otherwise it is this branch's, whatever a local run says (AGENTS.md: a regression once failed 6/6 in CI and 0/17 locally). Fix it through Step 11, then report "ready to push <new sha>" again; after the next push, Step 13 again. Never rerun a failed job in the hope it passes, and never call it flaky.

- [ ] **Step 15: (Part B) The PR text once #555 targets main**

When Step 13 shows #555's base is `main`, drop the first sentence of the "Builds on" line in `.superpowers/pr-description.md`:

```bash
cd /Users/heispv/Documents/protspace_web/protspace-workbench
grep -n "Builds on #526" .superpowers/pr-description.md
sed -i '' 's/Builds on #526: merge that first\. //' .superpowers/pr-description.md
grep -n "merge commit" .superpowers/pr-description.md
grep -n "^\*\*Tests:\*\*" -A1 .superpowers/pr-description.md
bash .superpowers/sdd/phase-8b-wrapup/check-pr-text.sh; echo "exit $?"
pnpm exec prettier --check --ignore-path .prettierignore .superpowers/pr-description.md
```

The `--ignore-path` is needed: Prettier also reads `.gitignore`, which ignores `.superpowers/`, so without it the file is skipped and the check passes without checking anything.

If the Tests line still reads `**Tests:** unit, end-to-end (desktop and phone) and performance checks pass.` (8.26 left the device clause out because the device pass was not finished) and `device-notes.md` now shows every item answered and every failing item fixed and rechecked by the user, replace that line with these two lines in the same edit, then rerun the check:

```markdown
**Tests:** unit, end-to-end (desktop and phone) and performance checks pass; checked by hand on a
phone, a tablet and desktop browsers.
```

Expected: the first `grep` shows the line before the edit; afterwards the line reads "Use a merge commit, not squash." and "#526" appears nowhere (`grep -c "#526"` is 0); `check-pr-text.sh` prints only `ok …` lines and `exit 0`; Prettier passes. If the base is still `perf/improvements`, leave the file unchanged and say so. The file is git-ignored: no commit. Show the full text in the report; the orchestrator asks the user before `gh pr edit 555 --body-file .superpowers/pr-description.md`.

Report (Part B): every workflow's name and conclusion on `<sha>`, any investigation from Step 14, the PR text, and "CI green on <sha>" or what is still red. The orchestrator then offers to mark #555 ready for review (the user's call) before Task 8.30.

**Commit:** fix commits only if this run finds failures; otherwise none.

### Task 8.30: GATED — the archive, as the last commit

With #555 targeting `main`, CI green on the tip, the device pass done and the user's go-ahead, the change is archived: `tasks.md` fully ticked, `openspec archive explore-workbench -y` merges the 29 deltas and moves the change folder, the 10 new specs (and the stale modified Purposes) get one-sentence Purposes, and everything lands in one commit. Nothing lands after it.

**Files:**

- Modify: `openspec/changes/explore-workbench/tasks.md` (every box ticked, review-added items included) before the archive
- Move (by the CLI): `openspec/changes/explore-workbench/` → `openspec/changes/archive/<YYYY-MM-DD>-explore-workbench/`
- Modify (by the CLI): the 19 `openspec/specs/<cap>/spec.md`; Create (by the CLI): the 10 new `openspec/specs/<cap>/spec.md`
- Modify (by hand): the 10 new specs' `## Purpose`; `openspec/specs/query-builder-filtering/spec.md` Purpose (line 5 names the control bar); `openspec/specs/annotation-presentation/spec.md` Purpose only if it contradicts the merged text

**Interfaces:**

- Consumes: R1 §3 "The archive (C4, exact steps)"; the Purpose style of `openspec/specs/category-focus/spec.md:3-5` (one or two plain sentences: what the capability covers, no file names); 8.29's green SHA (the ledger's "Task 8.29: complete" line); the user's go-ahead (asked by the orchestrator, recorded in the ledger); `.superpowers/sdd/phase-8b-wrapup/check-headers.sh` (8.19) and `compare-requirements.py` (8.27); the archive's output format and the `TBD - created by archiving change explore-workbench. Update Purpose after archive.` line it writes into each new spec (8.27's facts).
- Produces: one commit `docs(openspec): archive explore-workbench`; `grep -rln TBD openspec/specs` empty; 63 capabilities in `openspec/specs/`; no `openspec/changes/explore-workbench/`; "ready to push <sha>" for the orchestrator; after the push, CI green on that SHA (all workflows of 8.29).

**Tests:**

- Before: `openspec validate explore-workbench --strict` passes; `check-headers.sh` exits 0; `grep -c "\- \[ \]" openspec/changes/explore-workbench/tasks.md` is 0.
- After: `openspec validate --specs --strict --no-interactive` passes (63); `grep -rln TBD openspec/specs` empty; `grep -n "control bar" openspec/specs/query-builder-filtering/spec.md` prints nothing; `compare-requirements.py` against HEAD's specs prints no FLAG and the same CHECK lines as 8.29's final dry run; `git diff --cached --stat` shows only `openspec/` paths; `pnpm exec prettier --write openspec` then `pnpm format:check` and `pnpm precommit` (the hook) pass.
- `git log -1 --format=%B` has no trailer.

All commands run from `/Users/heispv/Documents/protspace_web/protspace-workbench`. Pipe every `openspec` call through `grep -v "trust settings"`. `gh` and `git commit` may need the sandbox disabled. Never `git push`: report "ready to push <sha>" and stop; the orchestrator pushes after the user's OK.

- [ ] **Step 1: The gate (stop here unless every line holds)**

```bash
gh pr view 526 --json state --jq .state
gh pr view 555 --json baseRefName,headRefOid --jq '.baseRefName + " " + .headRefOid'
git fetch origin
git rev-parse HEAD origin/feat/explore-workbench
git merge-base --is-ancestor origin/main HEAD && echo "main is in HEAD"
git status --short
grep -nE "^Task 8\.(2[5-9])|go-ahead|archive" .superpowers/sdd/phase-8b-wrapup/progress.md | tail -12
ls openspec/changes
```

Expected, all of:

- `MERGED`;
- `main <sha>` where `<sha>` equals both `git rev-parse` lines (the pushed tip is HEAD);
- `main is in HEAD`;
- `git status --short` empty;
- the ledger has "Task 8.29: complete" naming this same SHA with CI green, 8.25 and 8.28 complete or skipped, and the user's go-ahead for the archive recorded after 8.29;
- `openspec/changes` holds `archive` and `explore-workbench` only (if `main` brought another open change, say so in the report: it does not block the archive, but its deltas must not touch our 29 capabilities; check with `ls openspec/changes/<other>/specs`).

If any line differs, stop: report BLOCKED with the line that failed. Do not tick, archive or edit anything.

- [ ] **Step 2: Tick every box and reread the proposal and design**

```bash
grep -nE "^[[:space:]]*- \[ \]" openspec/changes/explore-workbench/tasks.md
perl -pi -e 's/^(\s*)- \[ \] /$1- [x] /' openspec/changes/explore-workbench/tasks.md
grep -c -- "- \[ \]" openspec/changes/explore-workbench/tasks.md
grep -nE "until #526 merges|planned after #526|rebase" openspec/changes/explore-workbench/{proposal,design,tasks}.md
```

Expected: the first grep lists the items still open (at least 8.28–8.30, plus any review-added item and any earlier item the orchestrator left open); the count is `0`. The last grep prints `proposal.md`'s Branches line and `design.md`'s delivery bullet ("The PR targets `perf/improvements` until #526 merges, then `main`"), which are still true as history and stay; anything else it prints (a line claiming work is still to come) is reported and fixed only if it names something this branch did not do. 8.30 itself is ticked here, before the archive, because the archive freezes the file and nothing lands after this commit.

- [ ] **Step 3: The checks before the archive (they must pass)**

```bash
openspec validate explore-workbench --strict --no-interactive 2>&1 | grep -v "trust settings"
bash .superpowers/sdd/phase-8b-wrapup/check-headers.sh openspec/changes/explore-workbench openspec/specs; echo "exit $?"
ls openspec/changes/explore-workbench/specs | wc -l
ls openspec/specs | wc -l
grep -rln TBD openspec/specs
rm -rf "$TMPDIR/os-before"; mkdir -p "$TMPDIR/os-before"; cp -R openspec/specs "$TMPDIR/os-before/specs"
```

Expected: `Change 'explore-workbench' is valid`; the header check exits 0 (the WARN lines, if any, are the ones 8.29 listed); `29`; `53` (if 8.28's merge brought new main specs, the number 8.29 recorded; then every later "63" is that number plus 10); the TBD grep prints nothing. The copy of `openspec/specs` is Step 6's "before" side.

- [ ] **Step 4: Archive**

```bash
openspec archive explore-workbench -y 2>&1 | grep -v "trust settings" | tee "$TMPDIR/archive-output.txt"
grep -cE ": create$" "$TMPDIR/archive-output.txt"
grep -cE ": update$" "$TMPDIR/archive-output.txt"
ls -d openspec/changes/archive/*-explore-workbench
ls -A openspec/changes/archive/*-explore-workbench
test ! -e openspec/changes/explore-workbench && echo "change folder moved"
grep -rln TBD openspec/specs | sed -E 's#openspec/specs/([^/]+)/spec.md#\1#' | sort
```

Expected: `Task status: ✓ Complete` (no "incomplete task" warning), `Specs to update:` with `10` create and `19` update lines, a `Totals:` line, `Specs updated successfully.`, `Change 'explore-workbench' archived as '<today>-explore-workbench'.`; the folder holds `.openspec.yaml`, `design.md`, `mockups`, `plans`, `proposal.md`, `specs`, `tasks.md`; `change folder moved`; the TBD list is exactly `docs-media-generation`, `explore-help`, `explore-import-export`, `explore-mobile-layout`, `explore-theming`, `explore-ui-kit`, `explore-workbench-layout`, `legend-panel`, `plot-proportions`, `selection-workflow`. If the archive refuses, stop: nothing has moved; report the message (the fix goes through 8.27's procedure, not through `--no-validate`).

- [ ] **Step 5: Write the Purposes**

Read each new spec's requirement names first (`grep "^### Requirement:" openspec/specs/<cap>/spec.md`). Each Purpose below is written from the topic list the spec tasks were given; before writing it, check every item it names against the spec's requirements and delete an item the spec does not state (do not add items the spec lacks). Then run:

```bash
python3 -I - <<'EOF'
from pathlib import Path

TBD = 'TBD - created by archiving change explore-workbench. Update Purpose after archive.'
PURPOSES = {
    'explore-workbench-layout': """\
The explore page's workbench layout (phones and tablets specialise it in explore-mobile-layout):
the app bar with the dataset name, the view bar that stays one row, the right sidebar with its icon
rail, folding, resizing and the divider between legend and structure, the docked or floating
structure viewer, the stored layout, the page-wide drop target, the empty state, and where
notifications appear.""",
    'explore-theming': """\
The look every part of the explore page shares: one set of `--ps-*` design tokens, the type scale
and self-hosted font, the System, Light and Dark themes applied before the first paint, what
follows the theme (the plot, the structure viewer, overlays) and what stays light (exports and
the figure editor's preview), and the contrast the colours must keep.""",
    'explore-ui-kit': """\
The shared controls the explore page is built from and the rules they all follow: popovers and
dialogs in the top layer, one order for Escape, closing on an outside press, named icon-only
buttons with tooltips, one focus ring, reduced motion, one icon set, counts that read right in
the singular and plural, and disabled options that say why.""",
    'plot-proportions': """\
How the scatterplot maps data to the screen: one scale for both axes, centred, in the live plot
and in exports, a single redraw when the panels around the plot change, the viewed centre kept
across a resize, and explicit zoom-inset ranges honoured.""",
    'legend-panel': """\
The legend in the sidebar: its rows and their actions (hide, reorder, show only this, colour and
shape), hidden categories, the header with the annotation's name, the sort order and the settings,
the searchable Other popover, and settings that apply as they change and are stored per dataset
and annotation.""",
    'selection-workflow': """\
Working with a selection and seeing how the view is narrowed: the plot's tool strip, the
selection bar and its actions, the status chips for a filter, an isolated view or hidden
categories, undo and redo with their notifications, the confirmation before clearing stored data,
and choosing which selected protein the structure viewer shows.""",
    'explore-import-export': """\
Getting data in and figures out: the Import menu shared by the Import button and the dataset
name, the Export menu and its items, the notification each export gives, the figure editor's
dialog, and the loading screen shown while a file is read.""",
    'explore-help': """\
Help on the explore page: the help menu, the complete keyboard shortcut list, and the product
tour, in full on a first visit and as a short What's new tour for returning visitors, with steps
that fit each layout.""",
    'explore-mobile-layout': """\
The explore page on phones and tablets: which layout a screen's width and height get, the phone's
fixed screen and bars, the More sheet, the folding bottom panel with its Legend and Filter tabs,
the structure sheet, touch targets sized for fingers, dialogs and popovers that fit a phone, and
search from the keyboard.""",
    'docs-media-generation': """\
How the documentation's screenshots, GIFs and example thumbnails are made: one manifest entry per
image, page helpers shared with the end-to-end tests, waits on signals instead of fixed pauses,
light and dark twins written as pairs, size budgets for GIFs, and the check the pre-commit hook
runs.""",
}

for cap, purpose in PURPOSES.items():
    path = Path('openspec/specs') / cap / 'spec.md'
    text = path.read_text()
    if text.count(TBD) != 1:
        raise SystemExit(f'{cap}: expected one TBD line, found {text.count(TBD)}')
    path.write_text(text.replace(TBD, purpose))
    print(f'{cap}: purpose written')

QBF = Path('openspec/specs/query-builder-filtering/spec.md')
OLD = ('The filter query builder: opening it from the control bar, building a condition against one '
       'annotation with a type-appropriate input, and what applying, resetting or loading a new '
       'dataset does to the active filter.')
NEW = """\
The filter query builder: building conditions in the Filter panel against one annotation with a
type-appropriate input, keeping edits as a draft until Apply, and what applying, resetting or
loading a new dataset does to the active filter."""
text = QBF.read_text()
if text.count(OLD) != 1:
    raise SystemExit('query-builder-filtering: the Purpose line is not the expected one; edit it by hand')
QBF.write_text(text.replace(OLD, NEW))
print('query-builder-filtering: purpose rewritten')
EOF
grep -rln TBD openspec/specs
sed -n '3,8p' openspec/specs/query-builder-filtering/spec.md
grep -n "control bar" openspec/specs/query-builder-filtering/spec.md
```

Expected: ten `purpose written` lines and `query-builder-filtering: purpose rewritten`; the TBD grep prints nothing; the Purpose reads as above; `control bar` is found nowhere in the file (the merged requirements no longer name it after the RENAMED/MODIFIED blocks; if a line still does, report it: the delta missed it). If the script stops on the `query-builder-filtering` check (the Purpose changed since `d071e1da`, e.g. through 8.28's merge), print lines 3–6, replace only the "opening it from the control bar" clause with "building conditions in the Filter panel" by hand, and say so. If the spec has no draft requirement, drop "keeping edits as a draft until Apply, " from `NEW`.

Then `annotation-presentation`:

```bash
sed -n '3,6p' openspec/specs/annotation-presentation/spec.md
grep -nE "⚡|Predicted\" group|Predicted group" openspec/specs/annotation-presentation/spec.md
```

Expected: the Purpose "How annotations are surfaced to the reader: the source-grouped dropdown with per-row predicted badges, friendly labels at every display site, the legend's marking of predicted values, and the per-annotation documentation popover." still matches the merged text (the dropdown requirement still says "predicted badge"; the legend requirement now describes the sparkles mark, which "the legend's marking of predicted values" covers), and the grep prints nothing. Leave the Purpose as it is in that case; change it only if the grep prints a line or the Purpose names something no requirement states, and then only that clause.

- [ ] **Step 6: The checks after the archive**

```bash
pnpm exec prettier --write openspec 2>&1 | grep -v "trust settings" | grep -v "(unchanged)"
openspec validate --specs --strict --no-interactive 2>&1 | grep -v "trust settings" | tail -1
ls openspec/specs | wc -l
grep -rln TBD openspec/specs
python3 -I .superpowers/sdd/phase-8b-wrapup/compare-requirements.py "$TMPDIR/os-before/specs" openspec/specs \
  openspec/changes/archive/*-explore-workbench/specs | grep -E "^(FLAG|CHECK|summary)"
sed -n '/^## Final dry run/,$p' .superpowers/sdd/phase-8b-wrapup/dry-run-report.md | grep "^CHECK" | head -20
grep -nE "control bar|control-bar" openspec/specs/query-builder-filtering/spec.md
openspec list 2>&1 | grep -v "trust settings"
rm -rf "$TMPDIR/os-before"
```

Expected: Prettier lists the 29 merged specs (blank lines around `## Purpose` and `## Requirements` restored) and possibly the archived `tasks.md`; validation ends `Totals: 63 passed, 0 failed (63 items)`; `63`; no TBD; the comparison prints `summary: 0 FLAG, <c> CHECK` with exactly the CHECK lines 8.29's final dry run explained (compare the two lists by eye); the `control bar|control-bar` grep prints nothing; `openspec list` no longer lists `explore-workbench`.

If any of these fails (a FLAG, a CHECK 8.29 did not explain, a `control bar` / `control-bar` line, a validation error), do not commit: report the output and stop. Nothing is committed, so no revert is needed. The tree holds an archive made only by this task (Step 1 found it clean); the orchestrator undoes it with `git restore --staged --worktree -- openspec && git clean -fd -- openspec`, has the delta fixed through 8.27's procedure, and runs this task again from Step 2.

- [ ] **Step 7: Stage and check the commit's scope**

```bash
git add -A openspec
git diff --cached --stat | tail -1
git diff --cached --name-only | grep -v '^openspec/'
git diff --cached --name-status | grep -c '^R'
git diff --cached --name-status -- openspec/specs | awk '{print $1}' | sort | uniq -c
pnpm format:check 2>&1 | grep -v "trust settings" | tail -2
```

Expected: the stat line names a large rename (the change folder with `plans/` and `mockups/`); the `grep -v '^openspec/'` prints nothing; the renames count is the number of files the change folder held; under `openspec/specs` there are `10 A` and `19 M` (`query-builder-filtering`'s Purpose edit is inside one of the 19); `format:check` ends "All matched files use Prettier code style!".

- [ ] **Step 8: Commit**

Commit (sandbox disabled; the hook runs `pnpm precommit`, the last of the checks):

```bash
git commit -m "docs(openspec): archive explore-workbench"
git log -1 --format=%B
git status --short
git rev-parse --short HEAD
```

Expected: the hook passes; the message is the single line above with no trailer; `git status --short` is empty. If the hook fails, fix only what it names inside `openspec/` (formatting), restage with `git add -A openspec` and commit again; anything outside `openspec/` is a stop-and-report.

Report "ready to push <sha>" with: Step 1's gate lines, the archive output, the TBD list before Step 5, the twelve Purpose texts as written (and any item you dropped from one, with the reason), Step 6's validation line and comparison summary, Step 7's stat and status counts, and the commit hash. Do not push.

- [ ] **Step 9: CI on the archive commit (after the orchestrator has pushed with the user's OK)**

When the orchestrator says the commit is pushed:

```bash
gh pr view 555 --json headRefOid,baseRefName --jq '.headRefOid + " " + .baseRefName'
gh pr checks 555
gh run list --branch feat/explore-workbench --limit 20
```

Expected: the head is the archive commit and the base `main`; every workflow 8.29 listed (`ci.yml`, `e2e.yml`, `bundle-contract.yml`, `protspace-ci.yml`, `prep-ci.yml`, `publish-images.yml`, `example-bundles.yml`, as path filters select them for this commit) finishes green on that SHA. A red run is investigated against the nightly on `main` (`gh run list --workflow=e2e.yml --event=schedule`), never called flaky from local passes; a fix means the orchestrator reverts the archive commit (Global Constraints, "The archive is last"). Report each workflow's conclusion.

## Phase 8 exit

1. **Counts:** 8.15's baseline and 8.29's final run in `verification-report.md`: utils, core (unit + browser, files), app, contract, pytest, full e2e (default projects), `--project=mobile` three times, `product-tour.spec.ts` five times; every difference explained.
2. **E2E:** both runs green, failures fixed or ruled known flakes after an alone rerun; CI's `e2e.yml` green on the archive commit.
3. **Perf:** `pnpm perf:counts` passes every budget in both runs; 573K on the rebuilt v3 bundle (about 36 MB, heap about 31 MB) at or within the perf rule of the 8A polish reference; any A/B result recorded.
4. **Checks:** `pnpm quality`, `pnpm lint`, `pnpm format:check`, `pnpm test:contract`, `pnpm shared-constants:check`, the four docs checks, `pnpm docs:build`, `pnpm precommit`, ruff and pytest: all 0 on the final tip and on the archive commit.
5. **Specs:** `openspec validate --specs --strict` passes for 63 capabilities; no `TBD`; no `openspec/changes/explore-workbench/`; the archive commit is the branch's last; CI green on it.
6. **Device pass:** every checklist item answered; failures fixed, rechecked by the user, and reflected in the specs (8.25).
7. **Screenshots for the user:** 8.15's and 8.29's sets, light and dark where it matters.
8. **Records:** `tasks.md` ticked in the archive; the ledger closes with the PR state (#555 base `main`, ready for review per the user, merge commit not squash); the exit report tells the user that their memory entries "Explore workbench redesign" and "Explore perf PR" should now say done and merged (agents cannot write the memory directory).

<!-- prettier-ignore-end -->
