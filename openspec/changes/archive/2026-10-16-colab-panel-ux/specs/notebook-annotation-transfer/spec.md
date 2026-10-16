## ADDED Requirements

### Requirement: The EAT cell calibrates a distance cutoff by default

The Preparation notebook's EAT cell SHALL transfer with an automatic distance cutoff, as
`protspace transfer --max-distance auto`, unless the user picks a numeric cutoff or none, and
SHALL report how many queries were near and how many distant.

#### Scenario: References from one family only

- **WHEN** every reference is a toxin and most queries are far from all of them
- **THEN** the cell reports how many queries are distant and marks them in `COL__neighbor`

### Requirement: The EAT cell can leave distant queries unpredicted

The EAT cell SHALL offer leaving distant queries unpredicted, as `--skip-distant`, off by
default, available whenever a cutoff is set.

#### Scenario: Skip distant queries

- **WHEN** the user ticks the option with the automatic cutoff
- **THEN** only near queries receive a predicted value

### Requirement: The EAT cell offers its neighbour report

The EAT cell SHALL write the neighbour report `protspace transfer --report` writes next to the
transferred bundle, and SHALL offer it for download from a button of its own.

#### Scenario: Download the report

- **WHEN** a transfer finished and the user clicks the report button
- **THEN** a TSV with one row per query and neighbour downloads

### Requirement: The EAT cell works on a released protspace without these options

The EAT cell SHALL run the transfer without a cutoff or report, disable those options and say
that they need a newer protspace, when the installed `run_transfer` has neither.

#### Scenario: protspace 4.16.8

- **WHEN** the notebook runs on protspace 4.16.8
- **THEN** the transfer completes and the cell says the cutoff and the report need a newer release

### Requirement: The Transfer notebook marks distant transfers

The Transfer notebook SHALL run its example transfer with the automatic distance cutoff and SHALL
report how many of the predicted proteins are near a reference and how many distant. Its steps
that read the transfer's output SHALL say to run the transfer first when that output is missing.

#### Scenario: The example run

- **WHEN** the user runs every cell of the Transfer notebook
- **THEN** step 4 shows the neighbourhood column and the near and distant counts

#### Scenario: Step 4 before step 3

- **WHEN** step 4 runs while step 3 has not written its report
- **THEN** it stops, saying to run step 3 again and read its error
