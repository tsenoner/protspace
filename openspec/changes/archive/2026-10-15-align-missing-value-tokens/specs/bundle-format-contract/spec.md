## ADDED Requirements

### Requirement: Producer and reader read the same cells as missing

The Python package SHALL treat an annotation cell as missing exactly when the web reader
does: a null, a non-finite number, a blank string, or a string that, trimmed and
lower-cased, is one of the web reader's missing-value spellings. Python SHALL hold one
definition of this, used by every Python reader of annotation cells (the Dash plot,
`protspace stats` and `protspace transfer`). The contract suite SHALL fail when the two
sides' spellings or matching rules differ.

#### Scenario: A spelling is added on one side only

- **WHEN** a missing-value spelling is added to the web reader's set but not to Python's, or
  the reverse
- **THEN** the contract suite fails

#### Scenario: One side changes how it matches

- **WHEN** either side stops trimming, stops comparing case-insensitively, or stops treating
  a blank cell as missing
- **THEN** the contract suite fails

#### Scenario: A cell spelled like a missing value in another case

- **WHEN** an annotation cell holds `N/A`, `NULL`, `None`, or `na` padded with spaces
- **THEN** the Dash plot shows it as N/A, `protspace stats` leaves it out of every category,
  and `protspace transfer` treats the protein as missing a value in that column

### Requirement: Producer categories are never spelled like a missing value

The Python producer SHALL NOT write a fixed category, or any hit of a multi-hit category,
that the web reader would read as missing. A test SHALL run each fixed producer vocabulary
through the shared missing-value definition, and SHALL fail on any string literal in the
annotation producer modules spelled like a missing value.

#### Scenario: A producer's negative category is renamed to a missing spelling

- **WHEN** a fixed producer vocabulary (for example TMbed's `non-transmembrane`) is changed
  to a value such as `none`
- **THEN** the Python test suite fails, naming the value

#### Scenario: A new producer writes a literal missing spelling

- **WHEN** a module under the annotation retrievers, transformers or parsers gains a string
  literal spelled like a missing value
- **THEN** the Python test suite fails, naming the file and line
