## MODIFIED Requirements

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
