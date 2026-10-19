## MODIFIED Requirements

### Requirement: Table cells hold display values

A cell of the CLI table SHALL hold the value the app displays: score and evidence suffixes
removed, v2 percent-encoding decoded, multiple hits joined with `;`. A missing value, and a
coordinate of a protein the projection does not place, SHALL be empty. A boolean cell SHALL be
`true` or `false`, an integer cell SHALL be written without a decimal part even when its column
has gaps, and a whole-number float SHALL be written without its `.0`, as the web export writes
them.

#### Scenario: A scored, encoded categorical cell

- **WHEN** a cell holds `Name%3B with semicolon|0.9`
- **THEN** the table holds `Name; with semicolon`

#### Scenario: An unplaced protein

- **WHEN** a protein has no coordinates in a projection named with `-p`
- **THEN** its coordinate cells are empty and its annotations are still written

#### Scenario: Booleans and numbers

- **WHEN** a bundle has a boolean column, an integer column with a missing cell, and a float
  column holding `2.0`
- **THEN** the table holds `true`/`false`, `1` rather than `1.0`, and `2`, as the web Table
  export does for the same proteins
