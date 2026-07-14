## Why

The Python backend (`protspace`, PyPI, currently v4.4.0) and this web repo change together but
live apart, with **two contracts crossing the repo boundary and no shared test for either**:

1. **Bundle format** — the `.parquetbundle` layout (`---PARQUET_DELIMITER---`, 3/4 parts, per-table
   columns). Written by Python (`protspace bundle`) and by TS (`exportParquetBundle`), read by TS
   (`packages/core/.../bundle.ts`). Both sides encode it by hand.
2. **Python API/CLI** — `services/protspace-prep` (a FastAPI service already in this repo) imports
   `protspace.data.loaders.h5.parse_identifier` and shells out to `protspace embed/annotate/project/bundle`.
   It pins **`protspace>=0.6`** from PyPI while protspace is actually at **4.4.0** — a stale, loose,
   cross-repo pin.

The drift this invites is live right now: a coordinated **format-v2** change is open on both repos
simultaneously — protspace #66 (`feat/annotation-encoding-v2`, writer) and web #306
(`feat/annotation-encoding-v2`, reader) — with nothing tying them together. Same team, sole owners;
separate maintenance buys nothing.

## What Changes

- **Merge `protspace` into this repo** as `apps/protspace`, preserving git history via `git filter-repo`.
  Original repo is archived. The whole repo is **MIT** — `pymmseqs`/mmseqs2 are both MIT, so the Python
  side carries no GPL dependency and needs no separate license. See design Decision D4.
- **Move `services/protspace-prep` → `apps/prep`** (apps = deployables), in the same change so paths/CI
  churn once.
- **One uv workspace** with two real Python members: `apps/protspace` and `apps/prep`.
  Repoint prep at protspace via `[tool.uv.sources] protspace = { workspace = true }` — killing the
  `>=0.6` PyPI pin and putting the two in lockstep, tested together in one PR.
- **Move `app/` → `apps/web`**; `packages/*` unchanged. pnpm + turbo pick up the Python member through
  a thin `apps/protspace/package.json` bridge (`test`/`lint`/`build` → `uv run …`).
- **Introduce a shared bundle contract** (`packages/bundle-contract/`): one `schema.json` (delimiter,
  part order/filenames, per-table columns/dtypes/nullability) plus committed golden `.parquetbundle`
  fixtures. Both Python and TS assert against it; the format's two writers cross-validate against the
  fixtures in both directions.
- **One version, PyPI only on a Python change**: keep `python-semantic-release` as the single version
  authority; gate the actual PyPI publish on `apps/protspace/**` changing. Web deploys on its own
  path-filtered job. Reconcile the two repos' CI (`ci`/`deploy`/`e2e`/`publish-images` + `ci`/`publish`/`release`)
  into one path-filtered set.

Non-goals: no change to either app's runtime behavior (structural merge only); no bundle-format redesign
(the contract pins whatever format ships at cutover); **no TS type codegen** from the schema (deferred —
fixtures + schema-equality tests are the initial guardrail); no `schema_version` metadata/reader branching
(additive-only evolution until a real breaking change forces it).

## Open PRs at cutover

**Cutover is decoupled from feature work (Decision D5): cut over first, no PR blocks it.** `git filter-repo`
rewrites **all refs**, so in-flight branches come across path-prefixed; GitHub PR objects (numbers, review
threads, approvals) cannot move. The freeze is about **carrying branches** before archiving the old repo,
not draining PRs. Verified conflict surface: #306/#233 are `packages`-only (no conflict with the
`app→apps/web` move); #66/#55 arrive pre-prefixed under `apps/protspace/`; only #295 needs trivial
path-move fixups.

| PR(s)                                                 | Handling                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| protspace #66 (v2 writer) **+** web #306 (v2 reader)  | **The flagship.** Both live in the monorepo after import (#66 carried, #306 in-repo). Land v2 as the **first monorepo PR**, adding `schema.json`+fixtures with it — contract written once, against v2. |
| web #295 (projection statistics in bundle pipeline)   | Touches `app/`+`services/`; owner re-targets onto post-cutover `apps/web`/`apps/prep` (path-move fixups). Fold its columns into `schema.json` when v2 lands.                                           |
| protspace #55 (EAT engine + `transfer`, Python-only)  | Carried by filter-repo under `apps/protspace/`; re-open as a monorepo PR. (Landing it on old protspace first is fine too, but not required.)                                                           |
| protspace #60 (draft chore) · web #233 (context menu) | Unrelated — carry or land/close; no cutover interaction.                                                                                                                                               |

## Capabilities

### New Capabilities

- `bundle-contract`: A single source-of-truth schema and golden-fixture set for the `.parquetbundle`
  format, validated by both the Python producer and the TS reader/writer, with CI failing on drift and
  the Python API/CLI surface that `protspace-prep` depends on verified against in-repo `protspace` source.
