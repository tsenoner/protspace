## ADDED Requirements

### Requirement: The panel's output stays compact

The Preparation notebook SHALL NOT draw a transient (`leave=False`) progress bar, so that no closed
bar leaves an empty slot in Colab's output, and the panel SHALL leave out package log lines that
its status card or progress bar already show (the bundle saved, each projection applied, a
reference file downloaded), while warnings still show.

#### Scenario: Many batches with inactive UniProt entries

- **WHEN** the UniProt fetch resolves inactive entries in dozens of batches
- **THEN** only the overall "Fetching UniProt annotations" bar shows, with no blank space below it

#### Scenario: A finished run

- **WHEN** Generate finishes
- **THEN** the log shows no "Saved bundled output", "Applying …" or "Bundle written" line, and the
  status card names the bundle and its size
