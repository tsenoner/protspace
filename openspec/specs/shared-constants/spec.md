# shared-constants Specification

## Purpose

The Python package and the web app must hold the same values for a family of constants
(missing-value tokens, the N/A key and colour, Kelly's colours, palette ids, point shapes,
boolean labels). This capability keeps them in step by construction: one source file,
generated into a committed module per language and checked on every pull request, while the
rules both sides implement stay pinned by running both on the same inputs.

## Requirements

### Requirement: Shared constants have one source

Every constant both sides must agree on SHALL be defined once, in the shared source
`contracts/shared-constants.json`, together with the reason it is shared. This covers the
missing-value tokens, the `__NA__` sentinel, the N/A swatch colour, Kelly's colours in slot
order, the categorical and gradient palette ids, the default categorical and numeric palettes,
the labels of an Arrow boolean column, the point shapes, and the column names the web reader never
shows as an annotation. Neither language SHALL hold a hand-written
copy of these values. Each SHALL read them from its generated module, and the names existing
code imports SHALL stay importable from where they were.

#### Scenario: A missing-value spelling is added

- **WHEN** a contributor adds a spelling to `MISSING_VALUE_TOKENS` in
  `contracts/shared-constants.json` and regenerates
- **THEN** the Python package's `protspace.core.constants.MISSING_VALUE_TOKENS` and the web's
  `MISSING_VALUE_TOKENS` both contain it, and no other file is edited

#### Scenario: A palette is added to one language only

- **WHEN** `COLOR_SCHEMES` in `color-scheme.ts` gains a palette whose id
  `contracts/shared-constants.json` does not list, or loses one it does list
- **THEN** the TypeScript type check fails

#### Scenario: A Python re-export is replaced by a literal

- **WHEN** one of the Python names re-exported from the generated module (for example
  `KELLYS_COLORS` in `settings_converter.py`) is redefined as a hand-written value
- **THEN** the Python test suite fails, naming the constant

#### Scenario: A column name the web reader hides

- **WHEN** a name is added to `NON_ANNOTATION_COLUMNS` in `contracts/shared-constants.json` and the
  modules are regenerated
- **THEN** the web reader leaves a column of that name out of the annotations, and the Python
  custom annotation loader renames a later column of that name, with no other file edited

### Requirement: Generated modules are committed and checked

The generator SHALL write `packages/utils/src/generated/shared-constants.ts` and
`apps/protspace/src/protspace/_generated/shared_constants.py`, and both SHALL be committed.
`pnpm shared-constants:check` SHALL fail, naming the stale file and the command that
regenerates it, whenever either committed module differs from what the source generates. The
check SHALL run in `pnpm precommit` and in a CI job that runs on every pull request with no
path filter.

#### Scenario: A generated module is edited by hand

- **WHEN** a pull request changes only `apps/protspace/src/protspace/_generated/shared_constants.py`
- **THEN** the unfiltered CI job fails on `pnpm shared-constants:check`

#### Scenario: The source changes without regenerating

- **WHEN** `contracts/shared-constants.json` is edited and the generated modules are not
  regenerated
- **THEN** `pnpm precommit` fails and names `pnpm shared-constants`

#### Scenario: The generated modules pass their language's formatter

- **WHEN** the generator has run
- **THEN** `prettier --check` passes on the TypeScript module and `ruff format --check` and
  `ruff check` pass on the Python module

### Requirement: The Python package needs nothing outside its own directory

The Python package SHALL ship its shared constants inside `protspace` itself, so that a wheel
or sdist built from `apps/protspace` imports and runs without the repository's `contracts/`
or `packages/` directories.

#### Scenario: The package is installed from its wheel

- **WHEN** the protspace wheel is built from `apps/protspace` and installed outside the
  repository
- **THEN** `protspace._generated.shared_constants` is importable and every module that
  re-exports from it imports

### Requirement: The source is validated before generation

The generator SHALL refuse to write when the source is malformed (an unknown kind, a value of
the wrong type, a duplicate entry, a name that is not upper snake case, a doc line over 80
characters) or breaks an invariant. The invariants are: every missing-value token is trimmed
and lower-case; `NA_VALUE`, lower-cased, is a missing-value token; no palette id is both
categorical and gradient; `DEFAULT_CATEGORICAL_PALETTE_ID` is a categorical palette id;
`DEFAULT_NUMERIC_PALETTE_ID` is a gradient palette id;
`ARROW_BOOLEAN_LABELS` is exactly the false label then the true label.

#### Scenario: An upper-case token is added

- **WHEN** `MISSING_VALUE_TOKENS` gains `N/A`
- **THEN** the generator exits non-zero, says that the matcher compares lower-cased cells,
  and writes nothing

#### Scenario: The numeric default is not a gradient

- **WHEN** `DEFAULT_NUMERIC_PALETTE_ID` names a categorical palette
- **THEN** the generator exits non-zero and writes nothing

#### Scenario: The categorical default is not a categorical palette

- **WHEN** `DEFAULT_CATEGORICAL_PALETTE_ID` names a gradient or unknown palette
- **THEN** the generator exits non-zero and writes nothing

### Requirement: Behaviour stays pinned by running both implementations

Behavioural rules SHALL NOT be moved into the shared source: how a value is used, such as
how a cell is matched against the missing-value tokens, is code. The bundle contract suite
SHALL keep checking them by running the Python and TypeScript implementations on the same
probe inputs.

#### Scenario: One side stops lower-casing before matching

- **WHEN** the TypeScript `normalizeMissingValue` stops lower-casing, while the shared tokens
  are unchanged
- **THEN** `pnpm shared-constants:check` still passes and the bundle contract suite fails
