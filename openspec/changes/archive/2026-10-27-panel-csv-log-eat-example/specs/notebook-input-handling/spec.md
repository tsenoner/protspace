## ADDED Requirements

### Requirement: The panel says when a custom CSV applies and keeps routine lines quiet

The line beside Generate SHALL name the custom-annotations file whenever that field holds one,
whatever tab is selected, and SHALL say how to leave it out. The panel SHALL print the annotation
cache's fill-in of proteins it lacks as an INFO line with both counts, and SHALL leave out the
package's `Missing annotations: set()` line.

#### Scenario: The FASTA example's CSV left in place

- **WHEN** the custom-annotations field holds `example_snake_venom_families.csv` and the Example
  tab is selected
- **THEN** the line beside Generate names that file and says to empty the field to leave it out

#### Scenario: Earlier runs fetched some of the proteins

- **WHEN** the cache holds 559 of 5,015 requested proteins
- **THEN** the panel prints "INFO: Fetching annotations for 4,456 of 5,015 proteins; the others
  were fetched by an earlier run in this runtime", and no WARNING
