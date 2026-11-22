## ADDED Requirements

### Requirement: The install cell stops when pip changed a loaded package

The install cell of each Colab notebook SHALL stop with a message naming every distribution
whose installed version pip changed while a module from it was already imported, and telling
the user to restart the session and run the cell again. Once it has stopped, it SHALL stop again
on every re-run in the same session, and SHALL pass after a restart when pip changes nothing.

#### Scenario: Colab had numpy loaded and pip upgraded it

- **WHEN** numpy is imported before the install and pip changes its installed version
- **THEN** the cell stops, naming numpy with both versions and _Runtime → Restart session_

#### Scenario: Re-running without a restart

- **WHEN** the cell stopped once and the user runs it again in the same session
- **THEN** it stops again with the same names

#### Scenario: After the restart

- **WHEN** the session was restarted and pip changes nothing
- **THEN** the cell completes

### Requirement: The Methods sliders stay within the accepted ranges

Every Methods slider SHALL offer only values `DimensionReductionConfig` accepts for its
parameter, with its default on the slider's step grid; perplexity SHALL be an integer slider from
5 to 50. A parameter group SHALL wrap to the next row before its slider tracks lose their width.

#### Scenario: The largest perplexity

- **WHEN** the user moves the perplexity slider to its maximum and generates t-SNE
- **THEN** the run uses perplexity 50 and does not fail on the parameter

#### Scenario: A narrow Colab pane

- **WHEN** the panel is 800 px wide with UMAP and t-SNE selected
- **THEN** the parameter groups wrap and every slider keeps a usable track (#346)

### Requirement: The panel says what failed and what to do about it

When Generate fails, the panel SHALL name the step that failed and the error, and SHALL give the
advice that matches the error when it recognises it, the general troubleshooting list only
otherwise. Log lines and errors that tell a CLI user to pass a flag SHALL name the panel's control
instead.

#### Scenario: A stale package after the install

- **WHEN** Generate fails on an error raised by a package loaded before the install
- **THEN** the panel tells the user to restart the session and run all cells again
- **AND** does not list the UniProt, Biocentral or annotation advice

#### Scenario: A cache warning that names a CLI flag

- **WHEN** protspace logs that the cached annotations are all empty and names `--refetch`
- **THEN** the panel's line names _Fetch annotations again_ under Annotations instead of the flag

### Requirement: The panel skips a UniProt fetch no identifier can match

Before fetching annotations, the panel SHALL check the identifiers against the UniProt accession
format. When none matches, it SHALL fetch nothing from UniProt, use the custom CSV alone when one
is given, and say so in either case.

#### Scenario: TRINITY identifiers with a CSV

- **WHEN** Generate runs on an `.h5` whose identifiers are `TRINITY_…` with the Default annotations
  and a custom CSV
- **THEN** the panel says no identifier is a UniProt accession and uses the CSV alone

### Requirement: The panel keeps its settings across a session restart

Generate SHALL save the panel's settings in the runtime, and building the panel SHALL restore
them, loading a saved path that still holds a file. With nothing saved, the panel SHALL load the
newest file the upload cell left in the runtime. A path field's change SHALL clear the status the
previous path left.

#### Scenario: Restart after a run

- **WHEN** the user generated a bundle from an `.h5` and a CSV, restarted the session and ran all
- **THEN** the panel shows the same tab, paths, methods and annotation choice, with the `.h5` loaded

#### Scenario: A new path after a failed load

- **WHEN** a load said no file was received and the path field then changes
- **THEN** that message is gone
