## ADDED Requirements

### Requirement: Every input field of the panel has an example

The Preparation panel SHALL offer a ready example for each field that takes the user's own input,
so a user can see what the field takes without bringing a file: the `.h5` and FASTA tabs and the
custom-annotations field SHALL each have a button that puts an example file into the runtime and
fills the field with its path, and the UniProt tab SHALL offer example queries that fill in and
set the query. The FASTA example's custom-annotations CSV SHALL hold one row per protein of that
FASTA. An example that cannot be fetched SHALL be reported in its tab, with nothing filled in.

#### Scenario: Trying the FASTA tab without a file

- **WHEN** the user clicks Use the example in the Sequences (FASTA) tab
- **THEN** a FASTA of snake-venom proteins is written to the runtime, its path fills the field, the
  tab reports it ready with its record count and first protein ID, and Generate runs on it

#### Scenario: Custom annotations for the FASTA example

- **WHEN** the user then clicks Use the example under the custom-annotations field
- **THEN** the field holds the path of a CSV with `venom_family` for each protein of that FASTA

#### Scenario: An example query

- **WHEN** the user picks an example in the UniProt query tab
- **THEN** the query field shows it and it is set for Generate

#### Scenario: No connection

- **WHEN** the example cannot be fetched
- **THEN** the tab says so and its path field stays empty
