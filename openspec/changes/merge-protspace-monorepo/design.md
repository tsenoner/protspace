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
protspace_web/                 (monorepo, split-licensed — see Decision D4)
├─ apps/
│  ├─ web/                      # was app/  (@protspace/app, vite)          — MIT
│  ├─ protspace/                # was protspace repo (uv member, PyPI: lib+CLI+legacy Dash) — GPL-3.0
│  │  └─ package.json           # thin turbo bridge → uv run {pytest,ruff,build}
│  └─ prep/                     # was services/protspace-prep (uv member, FastAPI) — GPL-3.0
├─ packages/
│  ├─ core/ utils/ react-bridge # TS libs, unchanged                        — MIT
│  └─ bundle-contract/          # schema.json + fixtures/*.parquetbundle
├─ pnpm-workspace.yaml          # packages: [apps/web, packages/*]
├─ turbo.json                   # existing tasks; now also sees apps/protspace
├─ pyproject.toml               # NEW root: [tool.uv.workspace] members=[apps/protspace, apps/prep]
├─ LICENSE                      # MIT (TS/root) + per-directory LICENSE files for GPL Python dirs
└─ (per-dir LICENSE in apps/protspace, apps/prep = GPL-3.0)
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

Because filter-repo imports a _snapshot_, the cutover is a moment, not a range. Anything landing on
protspace after the snapshot — but not carried as a branch — is stranded once the repo is archived.

```
  drain/carry all open branches ──▶ fetch origin/main (NOT the stale local) ──▶ filter-repo import
        ──▶ merge into monorepo ──▶ archive protspace ──▶ first monorepo PR = format v2 (writer+reader+fixtures)
```

Order of operations, format-touching PRs first (see proposal table): land protspace #66 + web #306
(and #295) before cutover so `schema.json`/fixtures are written once against v2; land or carry #55;
land/close the unrelated #60/#233 on their own repos.

## Decisions

- **D1 — History:** `git filter-repo` (preserve). Chosen.
- **D2 — Where does `protspace-prep` live?** **Decided: move `services/protspace-prep` → `apps/prep`**
  (apps = deployables convention; done in the same change so paths/CI churn once, not twice).
- **D3 — Is `perf/` a workspace member?** It's a throwaway plotting util with its own deps. Leave it out
  of the uv workspace unless it starts importing `protspace`. **Recommend: exclude.**
- **D4 — License:** **Decided: split-license per directory, not a repo-wide relicense.** A whole-repo
  permissive relicense is _not available_: `protspace` imports `pymmseqs` (`from pymmseqs.commands import
easy_search` in `data/loaders/similarity.py`) → mmseqs2, which is **GPL-3.0** and not ours to relicense.
  Importing it is linking, so the combined Python work stays GPL regardless of the label on our own files.
  - `apps/protspace` → **GPL-3.0** (linked GPL dep).
  - `apps/prep` → **GPL-3.0** (imports `protspace`, a GPL work → derivative).
  - `apps/web`, `packages/*` → **MIT** (separate process; reads `.parquetbundle` client-side and calls
    prep over HTTP — both arm's-length under GPL-3.0, not AGPL, so no copyleft reaches the frontend).
    The parquetbundle/HTTP boundary is the GPL firewall.
  - Carry per-directory `LICENSE` files; fix the pre-existing mismatch (root LICENSE is Apache-2.0 while
    `@protspace/core`/`utils` declare MIT) by settling the TS side on **MIT**.
  - Escaping GPL on the Python side would require replacing the `pymmseqs` _import_ with an mmseqs
    _binary subprocess_ (mere aggregation) — a real code change, out of scope here.
  - **Caveat:** this is the conservative engineering read (keep GPL where GPL is linked); get a legal
    sanity-check on the `pymmseqs` linkage before publishing any license label.
- **D5 — v2 timing:** land the coordinated v2 pair before cutover (simplest, contract written once) vs.
  cutover-then-unify into one flagship PR (best demo of monorepo value, more git choreography). **Open — recommend land-first.**

## Risks

- **Stranded work** if a branch is neither landed nor carried before archive → enforce the freeze checklist.
- **Stale local clone** (54 behind origin) imported by mistake → import from a fresh clone of origin.
- **CI reconciliation** is the largest mechanical surface; do it on a branch with both publish flows
  exercised (dry-run PyPI + a test image build) before archiving the old repo, so nothing silently breaks.
- **`protspace>=0.6` was never really 4.4-tested**; the source pin may surface latent incompatibilities in
  prep — that's the point, but budget for a few prep-test fixes at cutover.
