## Why

The Python package and the web app have to agree on a family of constants: the spellings
that mean "missing", the `__NA__` sentinel, the N/A swatch colour, Kelly's colours in slot
order, the palette ids a styles file may name, the labels of a boolean column, and the
point shapes. Today each of these is written out by hand in both languages. Some are pinned
by Python tests that pull values out of the TypeScript source with regexes
(`_web_palette_ids` and friends in `test_style_warnings.py`). Those tests break when the
source is reformatted, and they only run when Python files change, because
`protspace-ci.yml` is path-filtered. Others are not pinned at all and rely on a "same order
as the web frontend" comment. PR #543 added a contract-suite check for the missing-value
tokens. That check catches drift, but every change still means editing two files and
waiting for CI to say whether they match.

## What Changes

- New source of truth: `contracts/shared-constants.json` holds every shared constant once,
  with its rationale. Constants that have different names in the two languages get one
  name here.
- New generator `scripts/shared-constants/generate-shared-constants.mts`. It validates the
  source and writes two committed modules: `packages/utils/src/generated/shared-constants.ts`
  and `apps/protspace/src/protspace/_generated/shared_constants.py`. The Python module lives
  inside the package, so the wheel and sdist need nothing from outside `apps/protspace`.
- `pnpm shared-constants:check` fails when either committed module differs from what the
  source generates. It runs in `pnpm precommit` and in the unfiltered `bundle-contract.yml`
  job, which runs on every pull request whatever paths it touches.
- The existing names stay where they are, re-exported from the generated modules, so no
  import site changes. Python keeps `MISSING_VALUE_TOKENS`, `NA_INTERNAL`,
  `NA_PINNED_COLOR`, `KELLYS_COLORS`, `_CATEGORICAL_PALETTE_IDS`, `_GRADIENT_PALETTE_IDS`,
  `ARROW_BOOLEAN_LABELS` and `ALLOWED_SHAPES`. TypeScript keeps `MISSING_VALUE_TOKENS`,
  `NA_VALUE`, `NA_DEFAULT_COLOR`, `KELLYS_COLORS`, `DEFAULT_NUMERIC_PALETTE_ID`,
  `GRADIENT_COLOR_SCHEME_IDS` and `PointShape`. The web's `COLOR_SCHEMES` is typed against
  the generated palette ids, so a palette with no colours, or colours under an id the source
  does not list, is a compile error.
- The web's v3 bundle writer checks a `bool` column's labels against the shared
  `ARROW_BOOLEAN_LABELS` instead of a literal `'true'`/`'false'`.
- Removed: the regex-over-TypeScript palette tests in `test_style_warnings.py`, and the two
  TypeScript files `protspace-ci.yml` watched only for them.
- Kept: the bundle contract suite's behavioural checks, such as the missing-value verdict
  table. Matching rules are code, not data, so a shared list cannot pin them. The suite also
  keeps its token-set comparison, which compares the values each side actually uses, not
  the generated files.
- No value changes, so this ships as `refactor:`/`chore:`/`test:` commits with no release.

## Capabilities

### New Capabilities

- `shared-constants`: one source for the constants the Python package and the web app must
  agree on, generated into a committed module per language and checked on every pull
  request.

### Modified Capabilities

None. `bundle-format-contract` already requires that the two sides read the same cells as
missing, and that requirement still holds: the contract suite keeps comparing both the
token sets and the per-spelling verdicts. This change only alters how the token values reach
each side.

## Impact

- New: `contracts/shared-constants.json`, `contracts/README.md`, the generator, and the two
  generated modules, plus the `apps/protspace/src/protspace/_generated/` package.
- Python: `core/constants.py`, `data/io/settings_converter.py`,
  `utils/add_annotation_style.py` and `data/annotations/encoding.py` re-export from the
  generated module. `tests/test_style_warnings.py` loses its TypeScript regexes. New
  `tests/test_shared_constants.py`.
- TypeScript (`@protspace/utils`): `visualization/missing-values.ts`, `color-scheme.ts`,
  `numeric-binning.ts`, `types.ts` and `parquet/bundle-writer.ts`.
- Tooling: `package.json` (`shared-constants`, `shared-constants:check`, `precommit`),
  `.github/workflows/bundle-contract.yml` (new check step), and
  `.github/workflows/protspace-ci.yml` (two TS paths dropped).
- Docs: `AGENTS.md`, `CONTRIBUTING.md` and `apps/protspace/CLAUDE.md`.
