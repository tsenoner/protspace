## MODIFIED Requirements

### Requirement: The web app exports the visible proteins as a table

The Export panel (Export… under the dataset name; on a phone, the More sheet's Export) SHALL
offer a "Table" choice, downloaded as a .tsv, whose rows are exactly the proteins the Protein IDs
export writes in the same state: after the filter query (the EAT reliability filter included),
isolation (Show only these) and hidden legend categories of the coloured annotation.

#### Scenario: Hidden legend category

- **WHEN** the user hides one category of the coloured annotation and exports the table
- **THEN** the table has no row for a protein whose only value is that category
- **AND** its rows are the ids the Protein IDs export writes in the same state

#### Scenario: Filter and isolation

- **WHEN** a filter query or Show only these is active
- **THEN** only the proteins it keeps are rows of the table
