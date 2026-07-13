## 0. Pre-cutover freeze (carry branches, don't drain — Decision D5)

- [ ] 0.1 Announce a short freeze on protspace: no new merges to `main` after the snapshot until archived
- [ ] 0.2 Inventory open branches to carry: #66 (v2 writer), #55 (EAT/transfer), #60 (chore). filter-repo carries all refs; nothing needs to land first
- [ ] 0.3 Note web-side branches already in-repo (#306 v2 reader, #295 stats, #233) — they ride through the restructure, no cross-repo action

## 1. History import

- [x] 1.1 Fresh clone protspace from origin (NOT the stale local clone, which is 54 behind)
- [x] 1.2 `git filter-repo --to-subdirectory-filter apps/protspace` on the fresh clone (rewrites all refs)
- [x] 1.3 In protspace_web: add remote, fetch, `git merge --allow-unrelated-histories` onto the migration branch
- [ ] 1.4 Push carried branches (#66, #55, #60) — now under `apps/protspace/` — as monorepo branches; re-open as PRs
- [x] 1.5 Verify history/blame resolve under `apps/protspace/`

### Re-syncing upstream protspace after import (if v2 or other commits land on old `main` while this PR is open)

`filter-repo --to-subdirectory-filter apps/protspace` is deterministic: same input commits + same filter → same rewritten SHAs. So already-imported commits stay common ancestors, and pulling new upstream work is an incremental merge, not a re-import:

```
# re-clone protspace main, re-run the SAME filter-repo, then in protspace_web on the migration branch:
git fetch <re-filtered protspace>
git merge protspace/main          # NO --allow-unrelated-histories this time
```

Git brings in only the new commits and conflicts only on genuinely overlapping content (v2/#66 is annotation-encoding, orthogonal to the path/CI/license plumbing here, so overlap ≈ 0).

Caveat: this holds only for **append-only** upstream `main`. If upstream **rebases/force-pushes** `main` (rewriting existing SHAs), determinism breaks and the incremental merge fails — you're back to cherry-pick/re-import. This is what the 0.1 freeze protects.

## 2. Layout & workspace wiring

- [x] 2.1 `git mv app apps/web`; update `pnpm-workspace.yaml` → `packages: [apps/web, packages/*]`
- [x] 2.2 Fix web config globs referencing `app/`: `package.json` (`--filter @protspace/app`, `app/tests/playwright.config.ts`), `knip.jsonc` (`"app"` entry), any tsconfig path
- [x] 2.3 `git mv services/protspace-prep apps/prep` (Decision D2); fix its Dockerfile/CI path references
- [x] 2.4 Add root `pyproject.toml` with `[tool.uv.workspace] members = ["apps/protspace", "apps/prep"]` (exclude `perf/` per Decision D3)
- [x] 2.5 Repoint `apps/prep/pyproject.toml`: drop `protspace>=0.6`, add `[tool.uv.sources] protspace = { workspace = true }`; `uv lock`
- [x] 2.6 Add `apps/protspace/package.json` turbo bridge (`test`/`lint`/`build` → `uv run …`)
- [x] 2.7 Confirm `turbo run test` runs both TS and Python; `uv sync` resolves the workspace
- [ ] 2.8 Re-target in-flight branches that touched moved dirs: #295 (`app/`→`apps/web`, `services/`→`apps/prep`) — trivial path-move fixups

## 3. Release & CI reconciliation

- [x] 3.1 Move `python-semantic-release` config into `apps/protspace/pyproject.toml`; repoint `version_toml` / `version_variables` to the new paths
- [x] 3.2 Fix protspace `Dockerfile` for `apps/protspace` build context (`COPY` paths, data path, `image.source` label); prep Dockerfile for `apps/prep`
- [x] 3.3 Merge the two workflow sets into one path-filtered set: PyPI release job runs only on `apps/protspace/**`; web deploy on `apps/web/**`+`packages/**`; prep image on `apps/prep/**`; tests via `turbo --affected` or path filters
- [ ] 3.4 Dry-run both publish paths on the migration branch (PyPI dry-run + a test prep image build) before archiving the old repo

## 4. Cutover & cleanup

- [ ] 4.1 Apply split-license (Decision D4): per-directory `LICENSE` (GPL-3.0 in `apps/protspace`+`apps/prep`, MIT for TS/root); fix root Apache-vs-MIT mismatch → MIT; correct `license` fields + image labels; get legal sanity-check on the `pymmseqs` GPL linkage
- [ ] 4.2 Merge the migration (plumbing) branch; run full `turbo build`/`test`, prep tests, and an end-to-end prep→bundle→web-read smoke
- [ ] 4.3 Archive the `protspace` GitHub repo; update README/badges/Colab links pointing at the old repo

## 5. First monorepo feature PR: format v2 + bundle contract (Decision D5)

- [ ] 5.1 Land v2 writer (#66, `apps/protspace`) + v2 reader (#306, `packages/*`) together in one PR
- [ ] 5.2 In the same PR, create `packages/bundle-contract/` with `schema.json` describing the **v2** format (delimiter, part order/filenames, per-table columns/dtypes/nullability; include #295 stats columns if landed)
- [ ] 5.3 Generate and commit golden fixtures (`fixtures/*.parquetbundle`: one 3-part, one 4-part) from Python
- [ ] 5.4 Python contract test: constants match `schema.json`; producer arrow schema equals `schema.json`; committed fixture round-trips
- [ ] 5.5 TS contract test: constants match `schema.json`; TS reader parses the Python-written fixture (point `bundle-roundtrip.test.ts` at the shared fixture)
- [ ] 5.6 Confirm whether web-export → CLI round-trip flow exists; add the TS-write → Python-read test only if it does
- [ ] 5.7 Wire the contract tests into the path-filtered CI from 3.3; confirm writer+reader+fixtures are green together
