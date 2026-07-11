## 0. Pre-cutover: drain open PRs (see proposal table)

- [ ] 0.1 Land protspace #66 (v2 writer) + web #306 (v2 reader) together, so the monorepo is born on format v2 (Decision D5: land-first)
- [ ] 0.2 Land or rebase web #295 (projection statistics) so `schema.json` will include the stats columns
- [ ] 0.3 Land protspace #55 (EAT/transfer) if review is close; otherwise mark its branch to carry through filter-repo
- [ ] 0.4 Land or close the unrelated protspace #60 and web #233 on their own repos
- [ ] 0.5 Announce a short freeze on protspace: no new merges to `main` after the snapshot until archived

## 1. History import

- [ ] 1.1 Fresh clone protspace from origin (NOT the stale local clone, which is 54 behind)
- [ ] 1.2 `git filter-repo --to-subdirectory-filter apps/protspace` on the fresh clone (rewrites all refs)
- [ ] 1.3 In protspace_web: add remote, fetch, `git merge --allow-unrelated-histories` onto a migration branch
- [ ] 1.4 Push carried PR branches (e.g. #55 if not landed) and re-open them as monorepo PRs
- [ ] 1.5 Verify history/blame resolve under `apps/protspace/`

## 2. Layout & workspace wiring

- [ ] 2.1 `git mv app apps/web`; update `pnpm-workspace.yaml` → `packages: [apps/web, packages/*]`
- [ ] 2.2 Fix web config globs referencing `app/`: `package.json` (`--filter @protspace/app`, `app/tests/playwright.config.ts`), `knip.jsonc` (`"app"` entry), any tsconfig path
- [ ] 2.3 `git mv services/protspace-prep apps/prep` (Decision D2); fix its Dockerfile/CI path references
- [ ] 2.4 Add root `pyproject.toml` with `[tool.uv.workspace] members = ["apps/protspace", "apps/prep"]` (exclude `perf/` per Decision D3)
- [ ] 2.5 Repoint `apps/prep/pyproject.toml`: drop `protspace>=0.6`, add `[tool.uv.sources] protspace = { workspace = true }`; `uv lock`
- [ ] 2.6 Add `apps/protspace/package.json` turbo bridge (`test`/`lint`/`build` → `uv run …`)
- [ ] 2.7 Confirm `turbo run test` runs both TS and Python; `uv sync` resolves the workspace

## 3. Shared bundle contract

- [ ] 3.1 Create `packages/bundle-contract/` with `schema.json` describing the v2 format (delimiter, part order/filenames, per-table columns/dtypes/nullability)
- [ ] 3.2 Generate and commit golden fixtures (`fixtures/*.parquetbundle`: one 3-part, one 4-part) from Python
- [ ] 3.3 Python contract test: constants match `schema.json`; producer arrow schema equals `schema.json`; committed fixture round-trips
- [ ] 3.4 TS contract test: constants match `schema.json`; TS reader parses the Python-written fixture (extend/point `bundle-roundtrip.test.ts` at the shared fixture)
- [ ] 3.5 Confirm whether web-export → CLI round-trip flow exists; add the TS-write → Python-read test only if it does

## 4. Release & CI reconciliation

- [ ] 4.1 Move `python-semantic-release` config into `apps/protspace/pyproject.toml`; repoint `version_toml` / `version_variables` to the new paths
- [ ] 4.2 Fix protspace `Dockerfile` for `apps/protspace` build context (`COPY` paths, data path, `image.source` label)
- [ ] 4.3 Merge the two workflow sets into one path-filtered set: PyPI release job runs only on `apps/protspace/**`; web deploy on `apps/web/**`+`packages/**`; prep image on `services/protspace-prep/**`; tests via `turbo --affected` or path filters
- [ ] 4.4 Dry-run both publish paths on the migration branch (PyPI dry-run + a test prep image build) before archiving the old repo

## 5. Cutover & cleanup

- [ ] 5.1 Apply split-license (Decision D4): per-directory `LICENSE` (GPL-3.0 in `apps/protspace`+`apps/prep`, MIT for TS/root); fix root Apache-vs-MIT mismatch → MIT; correct `license` fields + image labels; get legal sanity-check on the `pymmseqs` GPL linkage
- [ ] 5.2 Merge the migration branch; run full `turbo build`/`test`, prep tests, and an end-to-end prep→bundle→web-read smoke
- [ ] 5.3 Archive the `protspace` GitHub repo; update README/badges/Colab links pointing at the old repo
- [ ] 5.4 As the first real monorepo PR (or as part of cutover per D5), confirm format v2 writer+reader+fixtures live and green together
