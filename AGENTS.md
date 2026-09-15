# Agent Instructions — protspace

Canonical instructions for **all** AI coding agents (Codex, Claude Code, Cursor, Copilot, etc.)
working in this repository; tool-specific files (e.g. `.claude/CLAUDE.md`) import it.

## Spec-driven development with OpenSpec (default workflow)

Plan non-trivial work as an [OpenSpec](https://openspec.dev/) spec **before** writing
implementation code. Proposals, design, spec deltas, and task lists live in
`openspec/changes/<change-name>/`; do **not** save plans, specs, or design docs under `docs/`,
scratch files, or other ad-hoc locations.

- **Use the workflow commands** — or the equivalent OpenSpec skill, or the `openspec` CLI, when
  slash commands are unavailable:
  - `/opsx:propose <idea>` — create a change and its artifacts (proposal, design, specs, tasks)
  - `/opsx:apply` — implement the change's tasks
  - `/opsx:archive` — merge spec deltas into `openspec/specs/` and archive the change; run it as
    the **last commit on the branch, before the merge** — see below
  - `/opsx:explore` — investigate/clarify before committing to a change
- **`openspec/specs/` is the source of truth** for current behavior; read the relevant specs first.
- **Trivial changes** (typo, one-line fix, formatting, dependency bump) do not need a full
  proposal — use judgment.

### Archive before the merge, not after

Run `/opsx:archive` on the branch, commit the result, and let CI go green on that commit.
Deferred to "after the merge" it does not happen — the PR is closed and the branch is gone —
leaving `openspec/specs/` describing behavior the code no longer has, which the next change
reads as current.

Before archiving, tick off `tasks.md` including anything the review added, and reread
`proposal.md` / `design.md` against the final diff: rationale written before a review is often
stale by the end of it, and archiving freezes it.

One-time CLI setup is in [CONTRIBUTING.md](CONTRIBUTING.md#openspec-one-time-per-machine).

## Before committing

Always run `pnpm precommit` before any git commit. It is
`lint-staged && quality && docs:annotations:check && docs:build`:

- ESLint `--fix` and Prettier `--write`, on staged files only (lint-staged)
- TypeScript typecheck, Knip, and Knip dependency validation (`pnpm quality`)
- `docs:annotations:check` — the generated annotation reference must match its source
- `docs:build`, a full VitePress build (a dead internal link fails it)

**It runs no tests at all.** Run `pnpm test` yourself; `pnpm test:e2e` (below) and
`pnpm test:contract` are separate again. It is also JS-only — Python workspace members
have their own CI workflows (see below).

lint-staged only inspects **staged** files, so unstaged work passes `pnpm precommit` and
still fails CI's `format:check` — also run `pnpm format:check` when anything is unstaged.

### A user-visible change is not done until the docs and the notebooks say so

Move these in the same PR — `pnpm precommit` covers none, and all three have shipped stale:

- **The published docs** (`docs/guide/`), for anything reaching a CLI flag, an option default,
  or the bundle format. `docs/guide/annotations.md` is generated, so edit its source instead.
- **The Colab notebooks** (`apps/protspace/notebooks/`), for anything a notebook restates — a
  model list, an install command, a flag. Prettier and ruff's CI paths both skip them, so
  nothing tells you when they drift; import from the package rather than retype, as the prep
  notebook does with `EMBEDDER_MODELS`.
- **`apps/protspace/CLAUDE.md`**, for a new command, test file, or dependency.

Pin a fact that has to live in two places with a test, not a comment asking the next reader to
keep them in step — see `apps/protspace/tests/test_docs_extras_sync.py`.

## End-to-end tests (Playwright)

`e2e.yml` alone drives the real app in a browser; the unit suites run in jsdom, which has no
WebGL. Canvas-dependent wiring — EAT provenance connectors, isolation, dataset swap — is
exercised nowhere else.

It runs nightly on `main`, and on PRs touching the web app, `packages/`, or the root files
those resolve through — `e2e.yml` owns the exact list.

Dispatch it by hand when your change could reach the app by a route that list misses — a
transitive dependency, a shared config, a generated asset — because a wrong `paths:` filter
does not fail, it silently never runs. Not whenever the filter simply didn't match: a PR with
no TS/JS and no root-file changes cannot reach the app, and the run costs ~10 min to confirm
nothing.

```bash
gh workflow run e2e.yml --ref <branch>   # in CI, any branch
pnpm test:e2e                            # locally
```

**Never dismiss a red run as flaky on the strength of local passes.** The regression behind
this rule failed 6/6 in CI and 0/17 locally. Compare against the nightly's history on `main`
(`gh run list --workflow=e2e.yml --event=schedule`), not your machine.

## Python workspace members (uv)

The Python packages are uv workspace members (root `[tool.uv.workspace]`) sharing one root
`uv.lock`. A new **top-level** member needs three things it does not get for free:

- **Its own workflow** in `.github/workflows/` (GitHub runs workflows only from the repo root),
  path-filtered on the member's directory **and** `uv.lock` — a dependency bump reaches it
  through the root lock alone. Copy `prep-ci.yml`.
- **Its own `[tool.ruff]`** with `target-version` matching its `requires-python`. Ruff resolves
  the nearest _ancestor_ config, so a member without one silently inherits another member's rules
  and target version — or ruff's defaults if no ancestor has one.
- **Test/lint-only deps in `[dependency-groups]`**, not `[project.optional-dependencies]`. Groups
  sync by default; extras do not, and a `dev` extra is installable by consumers.

A member nested inside another — currently only `apps/protspace/packages/protlabel` — needs
neither of the first two: `protspace-ci.yml` lints and tests it via `packages/`, and it inherits
`apps/protspace`'s ruff config, correct only while their `requires-python` floors agree.

## Commit style

Angular-style `type(scope): description`, subject under 72 characters; types are `feat`,
`fix`, `refactor`, `docs`, `test`, `chore`. No hook or CI job lints commit messages — the
type you write is what semantic-release parses for `apps/protspace/` releases (see below).

## Referring to issues from before the monorepo merge

Bare `#N` resolves against **this** repo, which inherited the frontend's numbering. The
standalone Python repo's issues did not come with it — they live at
`tsenoner/protspace-legacy#N` and must be written out in full. A bare `#57` here silently
lands on an unrelated frontend PR: it returns HTTP 200, so nothing flags it.

Three were transferred rather than stranded and are bare numbers here: legacy `#31` → `#324`,
`#59` → `#320`, `#64` → `#318`.

In a doc citing several, qualify once on a definitional line (`**Issues:**`, `**Refs:**`) and
keep the body bare, rather than expanding every mention — full qualification turns headings
into `### 2.3 tsenoner/protspace-legacy#57: ...`. Code comments and docstrings always qualify
in full, since no definitional line travels with them.

## Never squash-merge a PR that touches `apps/protspace/`

**Mixing frontend and backend in one PR is fine** — it is one of the reasons the repos were
merged; the release tooling works _per commit_. `protspace-release.yml`, the repo's only
semantic-release and the version authority for the **PyPI package alone**, is
`paths:`-filtered to `apps/protspace/**` plus its own workflow file, so a PR touching neither
cannot release — web-only work triggers `deploy.yml` (a Pages deploy, not a version bump).
Within it, `commit_parser = "conventional-monorepo"` with `path_filters = ["."]`
(`apps/protspace/pyproject.toml`) counts **only commits that touch `apps/protspace/`**, so a
`feat(core):` commit touching only `packages/` cannot inflate the Python version or changelog.

**Squash-merging destroys that scoping.** The one squashed commit touches _all_ the PR's
paths, so it passes the path filter if _anything_ in the PR touched `apps/protspace/`, and its
single message is parsed as a whole — GitHub's default squash body
(`squash_merge_commit_message: COMMIT_MESSAGES`) lists every branch commit subject, so a
frontend `feat:` bumps the Python package. Observed 2026-07-24: PR #387, titled
`refactor(protspace): …`, carried `fix(ci): relock uv.lock` in its squash body and cut v4.9.1.
Use a merge commit or rebase merge — both keep each commit's own paths and own type.

**This is now enforced:** the repo has `allow_squash_merge: false`, so no PR shows a squash
button — repo-wide, including frontend-only PRs, because the setting cannot be scoped to a
path. Do not re-enable it to "unblock" a PR: the button being absent is the fix, and this
section is the reason it was turned off.

Commit types still matter, per commit:

- Want no release from a backend-touching commit? Give it a non-releasing type (`ci` /
  `chore` / `refactor` / `test` / `docs`). A real `fix:` or `feat:` under `apps/protspace/`
  earns a release; that is correct.
- Use `feat:` only for changes visible to **package users**. Dev-only work — tooling, CI,
  test harnesses, internal refactors — takes `chore:` / `ci:` / `test:` / `refactor:`, so it
  cannot trigger an unwanted minor bump.
