## ADDED Requirements

### Requirement: The EAT cell lists only columns it can fill

The EAT cell SHALL list only annotation columns with at least one value and at least one gap,
each with its count of values set and missing, and SHALL preselect none.

#### Scenario: A UniProt column on non-UniProt IDs

- **WHEN** the bundle has an `ec` column that is empty for every protein, and a `family` column
  set for some proteins
- **THEN** the list offers `family` with its counts and not `ec`, and nothing is selected

### Requirement: The EAT cell and the Transfer notebook show their progress and downloads

The EAT cell SHALL disable its button while a transfer runs, and SHALL show each step with the
elapsed time and the bundle's size while the download is prepared. When done, it SHALL say that
the download started. The Transfer notebook SHALL say when each download is prepared and started,
and SHALL offer the transferred bundle for download.

#### Scenario: A transfer on 5,035 proteins

- **WHEN** the user clicks Transfer & download
- **THEN** the button is disabled until the cell shows "Done in", and the status names the step
  while it runs
