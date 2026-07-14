## Context

Grounded in the actual repo state (2026-07-11):

- This repo **already contains Python**: `services/protspace-prep/` (FastAPI, own `pyproject.toml`,
  pytest suite, Dockerfile, shipped via `.github/workflows/publish-images.yml`) and `perf/` (a
  matplotlib plotting util). Neither is currently in a uv workspace.
- `protspace-prep` depends on `protspace` two ways: `import parse_identifier` from
  `protspace.data.loaders.h5`, and subprocess calls to the `protspace` CLI (`embed`, `annotate`,
  `project`, `bundle`). It pins `protspace>=0.6`; protspace is at 4.4.0.
- The bundle format has **two writers** (Python `protspace bundle`; TS
  `packages/utils/src/parquet/bundle-writer.ts` → `exportParquetBundle`, backing the Explore export
  feature in `app/src/explore/export-handler.ts`) and a TS reader
  (`packages/core/src/components/data-loader/utils/bundle.ts`). Delimiter is `---PARQUET_DELIMITER---`
  on both sides today — in sync by manual luck, no shared test.
- The web app reads bundles entirely client-side (hyparquet in-browser) — **no Python at runtime in
  the browser**. Python is only involved server-side in `protspace-prep` and offline in the CLI.

## Goals / Non-Goals

**Goals:** one checkout; one uv workspace with prep source-pinned to protspace; move web to `apps/web`;
a shared, tested bundle contract; one version with PyPI publish gated on Python changes; history preserved.

**Non-Goals:** runtime behavior changes; bundle-format redesign; TS type codegen; schema versioning/reader
branching; touching `deploy-protspace-backend` (it deploys built images, unchanged).

## Target layout

```
protspace_web/                 (monorepo, uniformly MIT-licensed — see Decision D4)
├─ apps/
│  ├─ web/                      # was app/  (@protspace/app, vite)          — MIT
│  ├─ protspace/                # was protspace repo (uv member, PyPI: lib+CLI+legacy Dash) — MIT
│  │  └─ package.json           # thin turbo bridge → uv run {pytest,ruff,build}
│  └─ prep/                     # was services/protspace-prep (uv member, FastAPI) — MIT
├─ packages/
│  ├─ core/ utils/ react-bridge # TS libs, unchanged                        — MIT
│  └─ bundle-contract/          # schema.json + fixtures/*.parquetbundle
├─ pnpm-workspace.yaml          # packages: [apps/web, packages/*]
├─ turbo.json                   # existing tasks; now also sees apps/protspace
├─ pyproject.toml               # NEW root: [tool.uv.workspace] members=[apps/protspace, apps/prep]
├─ LICENSE                      # MIT (TS/root); per-directory MIT LICENSE files under the Python apps
└─ (per-dir LICENSE in apps/protspace, apps/prep = MIT)
```

## Migration mechanics

**History import (filter-repo):**

```bash
# fresh clone of protspace — local working clone is 54 behind origin; fetch/reset to origin first
git clone <protspace-origin> protspace-import && cd protspace-import
git filter-repo --to-subdirectory-filter apps/protspace     # rewrites ALL refs into the subdir

# in protspace_web
git remote add protspace-src ../protspace-import && git fetch protspace-src
git merge --allow-unrelated-histories protspace-src/main
git mv app apps/web
#   + root pyproject.toml (uv workspace)
#   + edit pnpm-workspace.yaml → [apps/web, packages/*]
#   + add apps/protspace/package.json bridge
```

Blame and history survive under `apps/protspace/`. Carried PR branches (from `git fetch protspace-src`)
land path-prefixed and can be re-opened as monorepo PRs.

**uv workspace + source pin (closes contract #2):**

```toml
# root pyproject.toml
[tool.uv.workspace]
members = ["apps/protspace", "apps/prep"]      # prep moved from services/protspace-prep

# apps/prep/pyproject.toml
dependencies = [ ..., "protspace" ]      # drop the >=0.6 version spec
[tool.uv.sources]
protspace = { workspace = true }
```

Now a change to `parse_identifier` or a CLI signature breaks prep's tests in the same PR.

**Turbo bridge (`apps/protspace/package.json`):**

```json
{
  "name": "@protspace/backend",
  "scripts": { "test": "uv run pytest", "lint": "uv run ruff check", "build": "uv build" }
}
```

**Config paths that shift (mechanical, but in the critical path):**

- `python-semantic-release` config → `apps/protspace/pyproject.toml`; `version_toml` and
  `version_variables` repointed to `apps/protspace/pyproject.toml:project.version` and
  `apps/protspace/src/protspace/__init__.py:__version__`.
- protspace `Dockerfile`: build context becomes `apps/protspace` (its `COPY . /src`, `COPY data/…`,
  and `image.source` label all assume the old repo root).
- Two `ci.yml` + publish flows reconcile into one path-filtered set; `publish-images.yml` (prep image)
  and `release.yml` (protspace → PyPI) now share the workspace install.

## Shared contract (`packages/bundle-contract/`)

- `schema.json` — delimiter bytes; part order + filenames (`selected_annotations`, `projections_metadata`,
  `projections_data`, optional `settings`); per-table columns / dtypes / **nullability**.
- `fixtures/` — committed golden bundles: one 3-part, one 4-part (with settings). Generated by Python and
  checked in.
- Each side keeps its own thin delimiter/filename constants (Python `data/io/bundle.py`, TS
  `@protspace/utils`); a test asserts they match `schema.json`.

**Contract tests (2×2, both directions):**

| Writer → Reader | Test                                                                                          | Load-bearing?                                  |
| --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Python → TS     | Python writes golden fixture; TS `extractRowsFromParquetBundle` asserts shape                 | **Yes — the ingest path**                      |
| TS → TS         | Existing `bundle-roundtrip.test.ts`                                                           | Yes (export/re-import)                         |
| Python → Python | protspace read of committed fixture asserts schema `== schema.json` (cols/dtypes/nullability) | Yes (producer contract)                        |
| TS → Python     | only if web exports are fed back to the CLI                                                   | Confirm the flow exists before spending a test |

Serialization quirks (timestamps, decimals) are where pyarrow and hyparquet disagree most — the golden
fixture catches those; pure schema comparison would not. **Evolution rule: additive-only** (new nullable
columns fine; renames/type changes need a deliberate bump). Reader version-branching deferred until a real
breaking change.

## Migration sequencing & the freeze window

**The cutover is decoupled from feature work (Decision D5).** filter-repo imports a _snapshot_ and
rewrites _all_ refs, so in-flight branches come across with it — the cutover does not wait on any PR.
Anything landing on protspace after the snapshot that is _not_ carried as a branch is stranded once the
repo is archived, so the freeze is about carrying branches, not draining PRs.

```
  carry all open branches ──▶ fetch origin/main (NOT the stale 54-behind local) ──▶ filter-repo import
     (plumbing only: workspace · prep→apps/prep · app→apps/web · CI; NO contract pkg yet)
        ──▶ merge into monorepo ──▶ archive protspace
        ──▶ FIRST monorepo feature PR = format v2: writer(#66) + reader(#306) + schema.json + fixtures, green together
```

Conflict surface with the `app→apps/web` / `services→apps/prep` moves (verified against the open PRs):

- **#306 (v2 reader):** `packages`/`docs` only → no conflict with the moves. Stays an in-repo branch.
- **#66 (v2 writer):** arrives pre-prefixed under `apps/protspace/` via filter-repo → no conflict.
- **#233:** `packages` only → clean. **#295:** touches `app/`+`services/` → trivial path-move fixups
  (git rename resolution), not logical conflicts; its owner re-targets post-cutover.
- **#55 (Python-only):** carried by filter-repo under `apps/protspace/`; re-open as a monorepo PR.

Cost of decoupling: a short window between cutover and the v2 PR with no bundle-contract test — which is
exactly today's status quo (no shared test exists), so no regression.

## Decisions

- **D1 — History:** `git filter-repo` (preserve). Chosen.
- **D2 — Where does `protspace-prep` live?** **Decided: move `services/protspace-prep` → `apps/prep`**
  (apps = deployables convention; done in the same change so paths/CI churn once, not twice).
- **D3 — Is `perf/` a workspace member?** It's a throwaway plotting util with its own deps. Leave it out
  of the uv workspace unless it starts importing `protspace`. **Recommend: exclude.**
- **D4 — License:** **Decided: repo-wide MIT.** An earlier draft split-licensed the Python side as
  GPL-3.0 on the belief that `protspace`'s `pymmseqs` import (`from pymmseqs.commands import easy_search`
  in `data/loaders/similarity.py`) linked a GPL mmseqs2. That premise was wrong: both
  [`pymmseqs`](https://github.com/heispv/pymmseqs) and upstream
  [mmseqs2](https://github.com/soedinglab/MMseqs2) are **MIT**, so no GPL dependency is linked and
  nothing forces copyleft.
  - `apps/protspace`, `apps/prep`, `apps/web`, `packages/*` → all **MIT**.
  - Root `LICENSE` plus each per-directory `LICENSE` are MIT; the whole repo is uniformly MIT.
  - **Verified:** `pymmseqs` (heispv/pymmseqs) and mmseqs2 (soedinglab/MMseqs2) both publish MIT
    license metadata — there is no copyleft dependency to accommodate.
- **D5 — v2 timing:** **Decided: decouple.** Cut over first (plumbing only — no PR blocks it), let
  filter-repo carry #66's branch in and keep #306 as an in-repo branch, then land v2 as the first
  monorepo feature PR that _also_ debuts `schema.json` + fixtures. Neither slow (not land-first) nor
  hard (no cross-repo rebase — both v2 halves are same-repo after import; the verified conflict surface
  is trivial). Contract is written once, against v2. Rejected: land-first (blocks the merge on review)
  and pre-cutover cross-repo unify (needless choreography).

## Risks

- **Stranded work** if a branch is neither landed nor carried before archive → enforce the freeze checklist.
- **Stale local clone** (54 behind origin) imported by mistake → import from a fresh clone of origin.
- **CI reconciliation** is the largest mechanical surface; do it on a branch with both publish flows
  exercised (dry-run PyPI + a test image build) before archiving the old repo, so nothing silently breaks.
- **`protspace>=0.6` was never really 4.4-tested**; the source pin may surface latent incompatibilities in
  prep — that's the point, but budget for a few prep-test fixes at cutover.
