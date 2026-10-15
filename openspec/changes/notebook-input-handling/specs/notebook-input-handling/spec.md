## ADDED Requirements

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
