# table-export Specification

## Purpose

The tabular export of a bundle, from the CLI (`protspace export`, `read_bundle_table`) and from the web app's Table format: which proteins and columns it holds and how cells are written.

## Requirements

### Requirement: The CLI exports a bundle as a table

`protspace export INPUT OUTPUT` SHALL write a tab-separated table with a header and one row per
protein of the bundle's annotations: `protein_id` first, then `<projection>_x` and
`<projection>_y` for each projection named with `-p/--projection`, then every annotation column in bundle order, `cluster_*` and EAT `__pred_*`
columns included.

#### Scenario: With a projection

- **WHEN** `-p "UMAP 2"` is given
- **THEN** the table has `UMAP 2_x` and `UMAP 2_y` columns after `protein_id`, and no `_z` column

#### Scenario: EAT and cluster columns

- **WHEN** the bundle carries `fam__pred_value`, `fam__pred_confidence`, `fam__pred_source` and a
  `cluster_elbow_<projection>` column
- **THEN** all of them are columns of the table with their values

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

### Requirement: An unknown projection is a usage error

A projection name the bundle does not hold SHALL fail with a usage error that lists the available
names, and nothing SHALL be written.

#### Scenario: Misspelt projection

- **WHEN** `-p` names a projection the bundle does not hold
- **THEN** the command fails naming the available projections, and OUTPUT is not created

### Requirement: The web app exports the visible proteins as a table

The Export menu SHALL offer a Table (TSV) format whose rows are exactly the proteins the Protein
IDs export writes in the same state: after the filter query (the EAT reliability filter
included), isolation and hidden legend categories of the coloured annotation.

#### Scenario: Hidden legend category

- **WHEN** the user hides one category of the coloured annotation and exports the table
- **THEN** the table has no row for a protein whose only value is that category
- **AND** its rows are the ids the Protein IDs export writes in the same state

#### Scenario: Filter and isolation

- **WHEN** a filter query or isolation is active
- **THEN** only the proteins it keeps are rows of the table

### Requirement: The web table holds coordinates and annotations

The web table SHALL have a `protein_id` column, the selected projection's coordinates as
`<projection>_x` and `<projection>_y`, and one column per annotation:
categorical labels joined with `;`, numeric raw values, missing values empty. The synthetic
EAT-confidence view SHALL NOT be a column; an annotation with EAT predictions SHALL hold curated
values only and be followed by its `__pred_value`, `__pred_confidence` and `__pred_source`
columns.

#### Scenario: Transferred values

- **WHEN** an annotation carries EAT predictions
- **THEN** a predicted protein's base cell is empty and its `__pred_value`, `__pred_confidence`
  and `__pred_source` cells hold the prediction

#### Scenario: Numeric annotation

- **WHEN** a numeric annotation is shown in bins
- **THEN** the table holds the raw value, not the bin label
