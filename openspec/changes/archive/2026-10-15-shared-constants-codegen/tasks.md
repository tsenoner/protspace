## 1. Source and generator

- [x] 1.1 Write `contracts/shared-constants.json` with every constant in the design's inventory (values copied unchanged, each with its `doc`), and `contracts/README.md` stating what belongs there (data only; rules go to `tests/contract`)
- [x] 1.2 Write `scripts/shared-constants/generate-shared-constants.mts`: structural validation, invariants, TypeScript render through Prettier, ruff-stable Python render, write and `--check` modes
- [x] 1.3 Add `shared-constants` and `shared-constants:check` to `package.json`; generate both modules and add the hand-written `apps/protspace/src/protspace/_generated/__init__.py`
- [x] 1.4 Confirm the generated Python passes `ruff check` and `ruff format --check`, and the generated TypeScript passes `prettier --check` and ESLint
- [x] 1.5 Confirm each validation fails as specified (upper-case token, numeric default not a gradient, duplicate, unknown kind, overlong doc line) and writes nothing

## 2. Python re-exports

- [x] 2.1 `core/constants.py`: `MISSING_VALUE_TOKENS` from the generated module, comment pointing at the source
- [x] 2.2 `data/io/settings_converter.py`: `NA_INTERNAL`, `NA_PINNED_COLOR`, `KELLYS_COLORS` from the generated module
- [x] 2.3 `utils/add_annotation_style.py`: `_CATEGORICAL_PALETTE_IDS`, `_GRADIENT_PALETTE_IDS`, `ALLOWED_SHAPES` from the generated module
- [x] 2.4 `data/annotations/encoding.py`: `ARROW_BOOLEAN_LABELS` from the generated module
- [x] 2.5 `tests/test_style_warnings.py`: delete `_web_source_match`, `_web_palette_ids`, `_web_gradient_palette_ids` and the tests built on them; keep the `kellys`-is-categorical assertion as a plain Python test
- [x] 2.6 New `tests/test_shared_constants.py`: every Python re-export equals (or is derived from) the generated value; the generated module imports nothing

## 3. TypeScript re-exports

- [x] 3.1 `visualization/missing-values.ts`: `MISSING_VALUE_TOKENS`, `NA_VALUE`, `NA_DEFAULT_COLOR` from the generated module; module comment points at the source
- [x] 3.2 `visualization/color-scheme.ts`: `KELLYS_COLORS` re-exported; `COLOR_SCHEMES` `satisfies Record<PaletteId, readonly string[]>` over the generated ids
- [x] 3.3 `visualization/numeric-binning.ts`: `DEFAULT_NUMERIC_PALETTE_ID` re-exported, `GRADIENT_COLOR_SCHEME_IDS` built from `GRADIENT_PALETTE_IDS`
- [x] 3.4 `types.ts`: `PointShape` derived from `POINT_SHAPES`
- [x] 3.5 `parquet/bundle-writer.ts`: a `bool` column's labels checked against `ARROW_BOOLEAN_LABELS`
- [x] 3.6 Mutation check: removing a palette id from the source makes `COLOR_SCHEMES` fail the type check

## 4. Wiring

- [x] 4.1 `pnpm precommit` runs `pnpm shared-constants:check`
- [x] 4.2 `bundle-contract.yml` runs `pnpm shared-constants:check` (header comment updated)
- [x] 4.3 `protspace-ci.yml`: drop `color-scheme.ts` / `numeric-binning.ts` from `paths:` and fix the header comment
- [x] 4.4 Contract suite: update the comments that call Python's token set a copy of the web's; keep the token-set and verdict assertions

## 5. Docs

- [x] 5.1 `AGENTS.md`: precommit list gains the check; "pin a fact that lives in two places" names `contracts/shared-constants.json` for constants
- [x] 5.2 `CONTRIBUTING.md`: how to change a shared constant
- [x] 5.3 `apps/protspace/CLAUDE.md`: `_generated/` in the package structure, `test_style_warnings.py` row updated, `test_shared_constants.py` row added

## 6. Verification

- [x] 6.1 `uv run pytest -m "not slow"` and `uv run ruff check` / `ruff format --check` in `apps/protspace`
- [x] 6.2 `pnpm test:ci`, `pnpm test:contract`, `pnpm format:check`, `pnpm precommit`
- [x] 6.3 Build the wheel and import the generated module from it in a clean environment outside the repo
- [x] 6.4 Reread proposal and design against the final diff; archive the change as the last commit
