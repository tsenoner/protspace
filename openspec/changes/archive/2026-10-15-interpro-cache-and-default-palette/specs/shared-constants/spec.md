## MODIFIED Requirements

### Requirement: Shared constants have one source

Every constant both sides must agree on SHALL be defined once, in the shared source
`contracts/shared-constants.json`, together with the reason it is shared. This covers the
missing-value tokens, the `__NA__` sentinel, the N/A swatch colour, Kelly's colours in slot
order, the categorical and gradient palette ids, the default categorical and numeric palettes,
the labels of an Arrow boolean column, and the point shapes. Neither language SHALL hold a hand-written
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
