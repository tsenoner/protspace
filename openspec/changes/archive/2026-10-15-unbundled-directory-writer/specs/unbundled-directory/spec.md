## ADDED Requirements

### Requirement: A directory names each bundle part by its fixed file name

A ProtSpace parquet directory SHALL store the three core parts as `selected_annotations.parquet`, `projections_metadata.parquet` and `projections_data.parquet`, settings as `settings.parquet` and statistics as `statistics.parquet`, and every writer of a directory (`prepare --no-bundled`, `extract_bundle_to_dir`, `protspace project`, `protspace style` on a directory, `ArrowReader.save_data`) SHALL write through the single `write_directory` helper that holds those names.

#### Scenario: Unbundled pipeline output

- **WHEN** `protspace prepare --no-bundled` runs with statistics and settings
- **THEN** the output directory holds the three core files plus `settings.parquet` and `statistics.parquet`
- **AND** `ArrowReader` reads it back with every protein

#### Scenario: An extracted bundle

- **WHEN** a bundle is extracted with `extract_bundle_to_dir`
- **THEN** the directory holds the same files, with the same values, as the unbundled pipeline output for that data

#### Scenario: A projections-only directory

- **WHEN** `protspace project` writes its output
- **THEN** the directory holds only the two projection files, and no annotations, settings or statistics file

### Requirement: A directory write is atomic

Each file of a directory SHALL be published by a staged write and rename, so an interrupted write leaves the previous file and never a truncated one.

#### Scenario: A write is interrupted

- **WHEN** writing a directory part fails partway
- **THEN** the file of that name holds its previous content or does not exist

### Requirement: Settings supersede a legacy visualization_state.json

A writer that writes `settings.parquet` SHALL remove a `visualization_state.json` in the same directory, because the reader prefers that file over the settings, and a writer that writes no settings SHALL leave it in place.

#### Scenario: Restyling a directory an older style touched

- **WHEN** a directory holding `visualization_state.json` is styled
- **THEN** the file is removed and the new styles are read from `settings.parquet`

#### Scenario: Writing projections into a styled directory

- **WHEN** a directory holding `visualization_state.json` is rewritten without settings
- **THEN** `visualization_state.json` is kept

### Requirement: Styling a directory writes settings and keeps every other file

`protspace style <dir> <out>` SHALL write the styles to `settings.parquet` through the same styling pass as a bundle, and SHALL keep every other part byte for byte: in place it SHALL write only `settings.parquet`, and into another directory it SHALL copy the other parts and remove any part the input lacks.

#### Scenario: Styling into a new directory

- **WHEN** a directory with statistics is styled into a new directory
- **THEN** the core files and `statistics.parquet` are byte-identical to the input's
- **AND** `settings.parquet` equals the settings that styling the bundle of the same data writes

#### Scenario: Styling in place

- **WHEN** a directory is styled in place
- **THEN** only `settings.parquet` is written, and the core files are not rewritten

#### Scenario: Styling into a directory that held another dataset

- **WHEN** the input has no `statistics.parquet` and the output directory already holds one
- **THEN** the output directory no longer holds `statistics.parquet`

### Requirement: Styling keeps the settings of annotations it does not style

`protspace style` SHALL keep the stored settings of every annotation its styles do not name, for flat (Python-written) settings and for the frontend's settings envelope, on a bundle and on a directory.

#### Scenario: Styling one of two styled annotations

- **WHEN** settings hold an entry for `kingdom` and the styles name only `organism`
- **THEN** the written settings still hold the `kingdom` entry unchanged

### Requirement: The reader carries a directory's statistics without depending on them

`ArrowReader` SHALL load a directory whose `statistics.parquet` is unreadable, and `ArrowReader.save_data` SHALL write the statistics it read back out unchanged.

#### Scenario: A corrupt statistics file

- **WHEN** a directory's `statistics.parquet` is not valid parquet
- **THEN** `ArrowReader` loads the directory
- **AND** `save_data` writes the same statistics bytes to its output
