> **Reconciled 2026-08-12 before archiving.** The migration shipped, but the checklist was
> never brought back into line with it: some tasks were done and left unticked, and all of
> phase 5 was superseded by a later change that solved the same problem differently. Each
> box below now reflects what is actually true, with the evidence. One genuine gap survived
> the reconciliation — the untested TS-write → Python-read seam — and was carried forward to
> #445 rather than closed, so archiving this change does not bury it.
>
> **Refs:** `#66` (v2 writer), `#55` (EAT/transfer) and `#60` (chore) are
> `tsenoner/protspace-legacy` PRs from before the merge — bare `#N` here resolves
> against this repo and lands on unrelated frontend PRs. Every other `#N` below is
> this repo.

## 0. Pre-cutover freeze (carry branches, don't drain — Decision D5)

- [x] 0.1 Announce a short freeze on protspace: no new merges to `main` after the snapshot until archived — moot in the end; the incremental re-sync in 1.4 handled upstream commits without a freeze
- [x] 0.2 Inventory open branches to carry from the now-archived `tsenoner/protspace-legacy`: #66 (v2 writer), #55 (EAT/transfer), #60 (chore). filter-repo carries all refs; nothing needs to land first — the inventory is this line, and 1.4 records all three landing
- [x] 0.3 Note web-side branches already in-repo (#306 v2 reader, #295 stats, #233) — they ride through the restructure, no cross-repo action

## 1. History import

- [x] 1.1 Fresh clone protspace from origin (NOT the stale local clone, which is 54 behind)
- [x] 1.2 `git filter-repo --to-subdirectory-filter apps/protspace` on the fresh clone (rewrites all refs)
- [x] 1.3 In protspace_web: add remote, fetch, `git merge --allow-unrelated-histories` onto the migration branch
- [x] 1.4 Carried branches (#66, #55, #60) landed on old `main` upstream and rode through the deterministic re-sync merge — no monorepo re-open needed
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
- [x] 2.8 Re-target in-flight branches that touched moved dirs: #295 (`app/`→`apps/web`, `services/`→`apps/prep`) — trivial path-move fixups. #295 is closed; no branch is still in flight against the pre-move layout

## 3. Release & CI reconciliation

- [x] 3.1 Move `python-semantic-release` config into `apps/protspace/pyproject.toml`; repoint `version_toml` / `version_variables` to the new paths
- [x] 3.2 Fix protspace `Dockerfile` for `apps/protspace` build context (`COPY` paths, data path, `image.source` label); prep Dockerfile for `apps/prep`
- [x] 3.3 Merge the two workflow sets into one path-filtered set: PyPI release job runs only on `apps/protspace/**`; web deploy on `apps/web/**`+`packages/**`; prep image on `apps/prep/**`; tests via `turbo --affected` or path filters
- [x] 3.4 Dry-run both publish paths on the migration branch (PyPI dry-run + a test prep image build) before archiving the old repo. Secrets/settings to move first: see `ci-migration.md` — overtaken by the real thing: both paths have since published for real (`protspace` 4.11.1 to PyPI, and the prep image builds on every PR)

## 4. Cutover & cleanup

- [x] 4.1 Apply repo-wide MIT (Decision D4): MIT `LICENSE` in every app dir + TS/root; MIT `license` fields + image labels. (`pymmseqs`/mmseqs2 verified MIT, so no GPL to accommodate.)
- [x] 4.2 Merge the migration (plumbing) branch; run full `turbo build`/`test`, prep tests, and an end-to-end prep→bundle→web-read smoke — merged; the prep→bundle→web-read smoke is now the standing `Bundle format contract` CI job
- [x] 4.3 Archive the `protspace` GitHub repo; update README/badges/Colab links pointing at the old repo — `tsenoner/protspace-legacy` is `archived: true`; the last stale doc/Colab links were repointed in #391

## 5. First monorepo feature PR: format v2 + bundle contract (Decision D5)

> **Superseded, not abandoned.** The bundle contract shipped a month later via
> `add-bundle-contract-test` (archived 2026-07-20), which reached the same goal by a
> deliberately different route and is the live spec: `bundle-format-contract`. Two of the
> decisions below were not merely skipped but **reversed**, so this section is kept as the
> record of what was tried, and the boxes are ticked as _resolved elsewhere_:
>
> - **5.3 committed golden fixtures → generated per run.** The shipped spec requires the
>   opposite: "The contract suite SHALL NOT read any `.parquetbundle` checked into the
>   repository", because a committed fixture goes stale silently.
> - **5.7 hand-maintained CI path filter → no path filter.** The shipped spec: "without a
>   hand-maintained path filter — a filter is a copy of an import graph, and when it is
>   wrong the job does not fail, it silently does not run."
>
> The `schema.json` idea (5.2) was dropped by decision (2026-08-12): with one producer and
> one consumer, both in-repo and both covered end-to-end by an unskippable CI job, a
> declarative schema would be a third copy of the format to keep in step rather than a
> guarantee. See the `bundle-format-contract` spec for what is actually enforced.

- [x] 5.1 Land v2 writer (#66, `apps/protspace`) + v2 reader (#306, `packages/*`) together in one PR — v2 shipped; pinned by `test_bundle_version.py` and `v2-roundtrip.test.ts`
- [x] 5.2 ~~create `packages/bundle-contract/` with `schema.json`~~ — dropped by decision; no declarative schema, the contract is behavioural
- [x] 5.3 ~~Generate and commit golden fixtures~~ — **reversed**: fixtures are generated per run, never committed
- [x] 5.4 Python contract test — shipped as the generator driving the real `protspace bundle` CLI as a subprocess, so the CLI's rename and version-stamping are inside the tested surface
- [x] 5.5 TS contract test — shipped: the reader is exercised over 3-, 4- and 5-part bundles and the zero-byte settings sentinel, across both conversion implementations
- [x] 5.6 Confirm whether web-export → CLI round-trip flow exists; add the TS-write → Python-read test only if it does — **confirmed: it does, and the test is missing.** Carried forward to #445 so it is not buried by this archive. The TS writer exports `.parquetbundle` (`bundle-roundtrip.test.ts`) and the CLI consumes one (`protspace transfer -b`, `protspace style`), so the flow exists — but the shipped contract only covers Python-write → TS-read. This seam is untested; it needs its own change
- [x] 5.7 Wire the contract tests into CI — shipped as a standalone `Bundle format contract` job that **cannot** be silently skipped (fails rather than skips when the Python toolchain is missing)
