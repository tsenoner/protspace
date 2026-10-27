# notebook-input-handling Specification

## Purpose

How the Preparation notebook gets an input into the Colab runtime, names an HDF5 input, and decides which input Generate runs on, without blocking Run all or failing silently.

## Requirements

### Requirement: An uploaded HDF5 is always named before Generate loads it

The Preparation notebook's HDF5 tab SHALL offer an embedder choice whose default,
_Auto-detect_, resolves the name as the CLI does for a single input. A chosen embedder SHALL be
passed as the embedding name. Generate SHALL never call the loader without a name for an HDF5
input.

#### Scenario: A file from the Embeddings notebook without a model_name attribute

- **WHEN** the user loads `seqs_esm2_650m.h5`, which has no `model_name` attribute, and leaves
  the embedder on Auto-detect
- **THEN** the Ready line reports the embedding name `esm2_650m` and where it came from
- **AND** Generate produces a bundle whose projections are labelled `ESM2-650M`

#### Scenario: The user picks the embedder

- **WHEN** the user picks `prot_t5` for a file named `results.h5`
- **THEN** Generate names the embedding `prot_t5`

### Requirement: Files reach the runtime without the widget transport

The notebook SHALL NOT send HDF5 or FASTA files through `ipywidgets.FileUpload`. It SHALL take
a path in the runtime, and SHALL provide a separate upload cell that runs Colab's chunked
`files.upload()` only when the user asks for it, so _Run all_ never waits at a file picker.

#### Scenario: Run all with nothing to upload

- **WHEN** the user runs every cell without ticking the upload cell's checkbox
- **THEN** no file picker is shown and the panel is displayed

#### Scenario: Upload from the computer

- **WHEN** the user ticks the checkbox and runs the upload cell with an `.h5` file
- **THEN** the file is written into the runtime and its path fills the HDF5 tab's path field

#### Scenario: Re-uploading a corrected file under the same name

- **WHEN** the user uploads `toxins.h5`, then uploads a changed `toxins.h5` again
- **THEN** the HDF5 tab loads the second upload, not the first

#### Scenario: A path that holds no file

- **WHEN** the user loads a path where no file exists
- **THEN** the tab says no file was received at that path and how to get one there

### Requirement: Generate runs on the selected tab's input or refuses

Generate SHALL use the input of the currently selected input tab. When that tab has no input
ready, it SHALL print what to do and run nothing. Before starting, it SHALL print which input it
runs on, including the protein count when known.

#### Scenario: Empty selected tab

- **WHEN** the HDF5 tab is selected, an example was selected earlier, and no HDF5 file was loaded
- **THEN** Generate prints that the HDF5 tab has no file loaded and does not process the example

#### Scenario: Echo before the run

- **WHEN** Generate starts on a loaded HDF5 file
- **THEN** it prints the file name, the number of proteins and the embedding name first

### Requirement: The panel stays responsive and shows its errors

Building the panel SHALL NOT perform network I/O. Generate SHALL be disabled while it runs and
re-enabled afterwards, whatever the outcome. Exceptions raised in widget callbacks and
protspace's log lines SHALL appear in the panel's output.

#### Scenario: Run all on a slow connection

- **WHEN** the panel cell runs
- **THEN** it finishes without fetching the example dataset
- **AND** the example is fetched, with a timeout, when Generate needs it

#### Scenario: A second click during a run

- **WHEN** Generate is running
- **THEN** the Generate button is disabled

### Requirement: The panel offers the CLI's metric and defaults, in 2-D

The Methods section SHALL offer the CLI's distance metrics for UMAP and t-SNE, and its UMAP
`min_dist` default SHALL equal the CLI's. The notebook SHALL produce 2-D projections only and
SHALL NOT offer a dimension choice.

#### Scenario: Cosine UMAP

- **WHEN** the user selects UMAP and the cosine metric
- **THEN** the bundle's UMAP projection records `metric: cosine`

### Requirement: Annotations can come from the CSV alone

The Annotations section SHALL offer a CSV-only choice that fetches nothing from UniProt, and
SHALL refuse it, before any work, when no CSV is given.

#### Scenario: CSV only

- **WHEN** the user picks CSV only and gives a CSV
- **THEN** the bundle carries the CSV's columns and no source is queried

### Requirement: The Embeddings notebook stamps the model name

`ClickThrough_GenerateEmbeddings.ipynb` SHALL write the model's short key as the `model_name`
root attribute of the HDF5 file it produces.

#### Scenario: A file it writes is loaded

- **WHEN** a file written by the Embeddings notebook with ESM2-650M is given to `protspace prepare`
  or to the Preparation notebook
- **THEN** it is named `esm2_650m` from the attribute

### Requirement: The panel leaves missing annotation cells missing

The Preparation notebook SHALL build its annotations table with the package's
`align_annotations`, as `protspace prepare` does, so an empty cell of a custom CSV, a null the
annotations hand back, and a protein they do not cover are all missing in the bundle and never
the label `nan`. Under a released protspace without `align_annotations`, the notebook's fallback
SHALL do the same.

#### Scenario: A CSV with empty cells

- **WHEN** Generate runs on a CSV whose rows leave some cells empty
- **THEN** those cells are missing in the bundle, and no cell holds `nan`

#### Scenario: The released package

- **WHEN** the installed protspace has no `align_annotations` and reads empty CSV cells as nulls
- **THEN** the bundle the panel writes is the same as with the current package

### Requirement: The install cell stops when pip changed a loaded package

The install cell of each Colab notebook SHALL install without replacing a distribution this
session has already imported, holding each such distribution at its loaded version, and SHALL use
a plain install only when that cannot be resolved. As a safety net, it SHALL stop with a message
naming every loaded distribution whose installed version changed anyway, and telling the user to
restart the session and run the cell again. Once it has stopped, it SHALL stop again on every
re-run in the same session, and SHALL pass after a restart when nothing changes.

#### Scenario: Colab had numpy loaded and protspace's dependencies ask for a newer one

- **WHEN** numpy 2.1.3 is imported before the install, and a dependency of protspace declares
  numpy >= 2.4.1
- **THEN** the install keeps numpy 2.1.3, and the cell completes without asking for a restart

#### Scenario: A loaded package changed all the same

- **WHEN** the installed version of a loaded distribution changed during the install
- **THEN** the cell stops, naming it with both versions and _Runtime → Restart session_

#### Scenario: Re-running without a restart

- **WHEN** the cell stopped once and the user runs it again in the same session
- **THEN** it stops again with the same names

### Requirement: The Methods sliders stay within the accepted ranges

Every Methods slider SHALL offer only values the installed protspace accepts for its parameter,
with its default on the slider's step grid. Perplexity SHALL be an integer slider from 5 up to the
installed protspace's ceiling (500 when it has none). Before Generate does any work, the panel
SHALL check the selected methods' parameters against the input's protein count. It SHALL say so
under the sliders while they change, and refuse at Generate. Every visible slider SHALL keep a
track at least 120 px wide at any panel width, the parameter groups wrapping to new rows.

#### Scenario: Perplexity 30 on 20 proteins

- **WHEN** t-SNE is selected with perplexity 30 for an `.h5` of 20 proteins
- **THEN** the Methods section says the perplexity is not below 20 proteins, and Generate stops
  before loading anything

#### Scenario: Every method at 1440 px

- **WHEN** all six methods are selected and the panel is 1,440 px wide
- **THEN** every slider track is at least 120 px wide

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

### Requirement: Generate shows where the run stands until the download starts

Generate SHALL show the step it is on as "Step k of n" with the step's name, a progress bar, and
the time since the click, refreshed while a step runs. The reduction step SHALL count its
projections. The last step SHALL show the bundle's size while the download is prepared. The final
state SHALL say that the download started and that the browser saves the file when the transfer
ends, and the panel SHALL offer every bundle in the runtime's `output/` folder for download by a
button.

#### Scenario: A run on an .h5 with PCA and UMAP

- **WHEN** Generate runs on an `.h5` with PCA and UMAP selected
- **THEN** the panel shows steps 1 to 5, including "Reducing dimensions (UMAP 2, 2 of 2)" and
  "Preparing the download", and ends with a full bar and "Download started"
- **AND** the bundle is listed for a Download bundle click

### Requirement: The panel is checked by a rendering harness

The repository SHALL contain a harness that renders the Preparation panel with ipywidgets 7.7.1
and 8 in a headless browser. It SHALL go through panel widths, light and dark themes, method
selections and accordion sections. In each state it SHALL check slider track widths, horizontal
overflow, text contrast and the visibility of Generate, and it SHALL fail when a check fails.

#### Scenario: A regression in the dark-mode headers

- **WHEN** the harness runs on a notebook whose collapsed section titles are near-black in Colab's
  dark mode
- **THEN** it reports their contrast for each state and exits with failure

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
