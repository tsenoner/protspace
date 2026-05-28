# Agent Instructions — protspace_web

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

## Commit style

Angular-style commit messages, subject under 72 characters:

- `feat(scope): description` — new features
- `fix(scope): description` — bug fixes
- `refactor(scope): description` — code refactoring
- `docs(scope): description` — documentation changes
- `test(scope): description` — test additions/changes
- `chore(scope): description` — maintenance tasks
