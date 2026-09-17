## 1. Transfer scope (#393)

- [x] 1.1 Add `Rule.is_open`; an open rule matches every protein.
- [x] 1.2 Apply query-over-reference precedence only between two explicit rules, so an open rule never starves the other set.
- [x] 1.3 Keep the "explicit rule matched nothing" error, and give the open-rule case its own message.
- [x] 1.4 Update the CLI docstring, option help and the "nothing transferred" warning, which all assumed rules were required.
- [x] 1.5 Tests: open-rule classification, self-transfer end to end, query-only no longer a silent no-op, no self-sourced predictions.
- [x] 1.6 Verify on the 832-protein phosphatase fixture — reproduces the manuscript's 91.55% EC / 99.06% family held-out accuracy with no rules.
- [x] 1.7 Apply the "explicit rule matched nothing" error to the **reference** side too — it was the same silent exit-0 no-op, only unfixed. Surfaces via the existing `ValueError -> typer.BadParameter` path (exit 2).
- [x] 1.8 Rename `_matches` to `_matches_explicit`: it returns `False` for an open rule (the opposite of `is_open`'s contract), and only `classify`'s branch structure keeps that unreachable.

## 2. Glyph outline (#369)

- [x] 2.1 Hoist the isotropic pixel scale so the ring and the outline share one definition.
- [x] 2.2 Measure the outline in device pixels instead of as a fraction of the sprite.
- [x] 2.3 Apply it to both filled dots and predicted rings; budget-cap it against ring width.
- [x] 2.4 Anti-alias the outline's inner edge.
- [x] 2.5 Rewrite the characterization assertion that pinned the outline being skipped on rings.

## 3. Verification

- [x] 3.1 `uv run pytest apps/protspace/tests` (807 passed, 2 skipped) + `uv run ruff check`. Run it from `apps/protspace/`, as CI does: a _bare_ `uv run pytest` at the repo root resolves `configfile` to the root `pyproject.toml`, which defines no `[tool.pytest.ini_options]`, so `apps/prep` loses its `asyncio_mode = "auto"` and 47 async tests fail with "async def functions are not natively supported". Both CI jobs set `working-directory` to their own app and are unaffected.
- [x] 3.2 `pnpm test:ci` across core/utils/app; `pnpm format:check`; `pnpm precommit` on every commit.
- [x] 3.3 Playwright `eat-visualization` against the real phosphatase bundle — proves the shader compiles and the encoding still samples correctly.
- [x] 3.4 Archive this change before the merge (`/opsx:archive`).
