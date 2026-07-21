# Agent Instructions — protspace

Canonical instructions for **all** AI coding agents (Codex, Claude Code, Cursor, Copilot, etc.)
working in this repository. This file is the single source of truth; tool-specific files
(e.g. `.claude/CLAUDE.md`) import it.

## Spec-driven development with OpenSpec (default workflow)

This project uses [OpenSpec](https://openspec.dev/) for all non-trivial work. Plan the change
as a spec **before** writing implementation code.

- **Plan in OpenSpec, not elsewhere.** Proposals, design, spec deltas, and task lists live in
  `openspec/changes/<change-name>/`. Do **not** save plans, specs, or design docs under `docs/`,
  scratch files, or other ad-hoc locations.
- **Use the workflow commands/skills:**
  - `/opsx:propose <idea>` — create a change and generate its artifacts (proposal, design, specs, tasks)
  - `/opsx:apply` — implement the change's tasks
  - `/opsx:archive` — merge spec deltas into `openspec/specs/` and archive the change
  - `/opsx:explore` — investigate/clarify before committing to a change
  - If slash commands are unavailable, invoke the equivalent OpenSpec skill or run the `openspec` CLI directly.
- **`openspec/specs/` is the source of truth** for current behavior. Read the relevant specs
  before proposing a change.
- **Trivial changes** (typo, one-line fix, formatting, dependency bump) do not need a full
  proposal — use judgment.

**Local setup (one time per machine):**

```bash
npm i -g @fission-ai/openspec   # the workflow skills shell out to this CLI
openspec init                   # generates per-tool skills/commands for this repo
```

Only this `AGENTS.md` and the `openspec/` directory (specs + changes) are committed. The per-tool
skills/commands under `.claude/` and `.codex/`, and Codex's global prompts in `~/.codex/prompts/`,
are CLI-generated and gitignored — regenerate them with `openspec init` / `openspec update`.

## Before committing

Always run `pnpm precommit` before creating any git commit. It runs:

- Prettier (format)
- ESLint (lint)
- TypeScript (typecheck)
- Vitest (tests)

It is JS-only; Python workspace members are covered by their own CI workflows (see below).

## Python workspace members (uv)

The Python packages are uv workspace members (root `[tool.uv.workspace]`) sharing one root
`uv.lock`. A new **top-level** member needs three things it does not get for free:

- **Its own workflow** in `.github/workflows/` (GitHub runs workflows only from the repo root),
  path-filtered on the member's directory **and** `uv.lock` — a dependency bump reaches it through
  the root lock alone. See `prep-ci.yml` for a worked example.
- **Its own `[tool.ruff]`**, with `target-version` matching its `requires-python`. Ruff resolves the
  nearest _ancestor_ config, so a member without one silently inherits another member's rules and
  target version — or ruff's defaults if no ancestor has a `[tool.ruff]` table.
- **Test/lint-only deps in `[dependency-groups]`**, not `[project.optional-dependencies]`.
  Groups sync by default; extras do not, and a `dev` extra is installable by consumers.

A member nested inside another — currently only `apps/protspace/packages/protlabel` — needs
neither of the first two: `protspace-ci.yml` already lints and tests it via `packages/`, and it
inherits `apps/protspace`'s ruff config, which is correct only while their `requires-python`
floors agree.

## Commit style

Angular-style commit messages, subject under 72 characters:

- `feat(scope): description` — new features
- `fix(scope): description` — bug fixes
- `refactor(scope): description` — code refactoring
- `docs(scope): description` — documentation changes
- `test(scope): description` — test additions/changes
- `chore(scope): description` — maintenance tasks
