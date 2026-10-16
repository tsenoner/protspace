# deprecation-policy Specification

## Purpose

How protspace announces a feature it will remove, in the Python package and the web app, how its release process refuses to publish a version that still contains a feature past the version it was promised to be removed in, and which upgrade path outlives the removals.

## Requirements

### Requirement: Every scheduled removal is declared once with its removal version

The package SHALL keep one registry of scheduled removals. Each entry SHALL name the feature, the first version that must not contain it, and the warning shown to users. Every deprecation warning the package prints SHALL take its text and removal version from that registry, so the warning, the help text and the release checks cannot name different versions.

#### Scenario: A warning states the registered removal version

- **WHEN** any deprecation warning is printed
- **THEN** the version it names is the removal version registered for that feature

#### Scenario: The scheduled removals

- **WHEN** the registry is read
- **THEN** it holds producing 3-D projections, `protspace serve`, reading v1/v2 bundles, reading 3-D projections, and taking `identifier` as the protein ID column of a table without a manifest, each due for removal in 5.0.0

### Requirement: The web app names the same removal versions as the registry

Wherever the web app tells users, or its code documents, when reading v1/v2 bundles or 3-D projections ends, it SHALL name the removal version the registry holds for that feature, and the package's tests SHALL fail when the two differ.

#### Scenario: The registry's removal version changes

- **WHEN** the registered removal version for reading v1/v2 bundles is changed and the web app's legacy-format notice is not
- **THEN** the package's tests fail, naming the web source that differs

#### Scenario: The 3-D notice drifts

- **WHEN** the web app's 3-D projection notice names a release other than the registered removal version for reading 3-D projections
- **THEN** the package's tests fail

### Requirement: Reading a bundle with 3-D projections warns that it is deprecated

Each Python read of a bundle's projections SHALL log one deprecation warning when the bundle holds a projection with finite `z` values, naming the bundle, its 3-D projections, the removal version, recomputing with the 2-D method, and `protspace convert --flatten-3d`. The warning SHALL say that the X/Y view `--flatten-3d` keeps is the same as the 2-D projection only for PCA, and for non-linear methods is the 3-D layout seen from one side. `protspace stats` SHALL warn the same way for a projection directory with 3-D projections. The projections SHALL still be read as before. Reads that do not touch projections, and the writers' own reads of their input, SHALL NOT warn.

#### Scenario: Transferring annotations on a 3-D bundle

- **WHEN** a user runs `protspace transfer` on a bundle holding `UMAP 3`
- **THEN** one WARNING line names the bundle and `UMAP 3`, says reading 3-D projections ends in protspace 5.0.0, recommends recomputing with the 2-D method, and names `protspace convert --flatten-3d`
- **AND** it says the X/Y view equals the 2-D projection only for PCA

#### Scenario: Exporting a 3-D bundle as a table

- **WHEN** a user runs `protspace export` on a bundle holding `UMAP 3` with `-p "UMAP 3"`
- **THEN** one 3-D deprecation warning names `UMAP 3`
- **AND** the table holds `UMAP 3_x` and `UMAP 3_y`, its X/Y view, and no `z` column

#### Scenario: A 2-D bundle

- **WHEN** a bundle holding only 2-D projections is read
- **THEN** no 3-D deprecation warning is logged

### Requirement: The web app tells a user who imports 3-D projections

When a user imports a bundle holding one or more 3-D projections, the web app SHALL show a non-blocking notice that 3-D projections are shown as their X/Y view, that this view is the same as the 2-D projection only for PCA, that reading them ends in ProtSpace 5.0.0, and that recomputing with the 2-D method or `protspace convert --flatten-3d` turns them into 2-D. The bundle SHALL load as before. Datasets the app serves itself SHALL NOT show the notice.

#### Scenario: Importing a 3-D bundle

- **WHEN** a user imports a bundle holding a 3-D projection
- **THEN** the notice names the 3-D projections, the X/Y view, PCA as the one method whose X/Y view is its 2-D projection, ProtSpace 5.0.0, recomputing with the 2-D method, and `protspace convert --flatten-3d`
- **AND** the bundle is shown as before

#### Scenario: A served dataset or a 2-D import

- **WHEN** the default dataset, an example, or a user's 2-D bundle loads
- **THEN** no 3-D notice is shown

### Requirement: `protspace convert --flatten-3d` turns 3-D projections into 2-D

With `--flatten-3d`, `protspace convert` SHALL write each 3-D projection as a 2-D projection holding its X and Y coordinates, named with an ` (X/Y)` suffix and marked as flattened from 3-D in its metadata, and SHALL drop the quality figures computed on the 3-D layout (its faithfulness in the metadata and its statistics rows). It SHALL do this for v3 inputs as well as v1/v2 inputs, and leave 2-D projections untouched.

#### Scenario: Flattening a v3 bundle

- **WHEN** a user runs `protspace convert in.parquetbundle out.parquetbundle --flatten-3d` on a v3 bundle holding `PCA 2` and `UMAP 3`
- **THEN** `out.parquetbundle` is v3 with `PCA 2` unchanged and a 2-D `UMAP 3 (X/Y)` whose coordinates are the X and Y of `UMAP 3`
- **AND** the output names each flattened projection

### Requirement: `--flatten-3d` is the one exception to leaving a v3 input untouched

The `bundle-conversion` capability requires `protspace convert` to leave a v3 input untouched. `--flatten-3d` SHALL be the one exception: a v3 input that holds at least one 3-D projection SHALL be rewritten when the flag is given. A v3 input SHALL still be left untouched, with nothing written, when the flag is absent or the input holds no 3-D projection.

#### Scenario: A v3 bundle with 3-D projections and the flag

- **WHEN** `protspace convert in.parquetbundle --in-place --flatten-3d` runs on a v3 bundle holding `UMAP 3`
- **THEN** `in.parquetbundle` is rewritten with `UMAP 3 (X/Y)` in place of `UMAP 3`

#### Scenario: A v3 bundle with 3-D projections and no flag

- **WHEN** `protspace convert in.parquetbundle out.parquetbundle` runs without `--flatten-3d` on a v3 bundle holding `UMAP 3`
- **THEN** the command says the bundle is already current, `in.parquetbundle` is unchanged and `out.parquetbundle` is not created
- **AND** a warning names `UMAP 3` and `--flatten-3d`

#### Scenario: A v3 bundle with nothing to flatten

- **WHEN** `--flatten-3d` is given for a v3 bundle holding only 2-D projections
- **THEN** nothing is written and the command says the bundle is already current

### Requirement: `protspace convert` warns about 3-D projections it keeps

Without `--flatten-3d`, `protspace convert` SHALL keep 3-D projections as they are and SHALL print a warning naming them, the removal version for reading 3-D projections, recomputing with the 2-D method, and `--flatten-3d`. With `--flatten-3d`, the line naming the flattened projections SHALL say that only for PCA is the X/Y view the same as the 2-D projection.

#### Scenario: Converting a v2 bundle with a 3-D projection

- **WHEN** a user converts a v2 bundle holding `UMAP 3` without `--flatten-3d`
- **THEN** the v3 output keeps `UMAP 3` as 3-D and a warning names it, recomputing with the 2-D method, and `--flatten-3d`

#### Scenario: Flattening says what the X/Y view is

- **WHEN** a user converts a bundle holding `UMAP 3` with `--flatten-3d`
- **THEN** the output names `UMAP 3 -> UMAP 3 (X/Y)` and says that only for PCA is the X/Y view the same as the 2-D projection

### Requirement: `protspace convert` remains the upgrade path after the removals

`protspace convert` SHALL keep its own reader for v1/v2 bundles and 3-D projections when the general readers drop them, so a file written by any earlier release can still be upgraded. That retained reader SHALL NOT be a registry entry, and the release checks SHALL NOT require its removal.

#### Scenario: The release gate at 5.0.0

- **WHEN** the release gate lists what must be removed before 5.0.0
- **THEN** the list does not include `protspace convert` or its legacy reader

### Requirement: Requesting a 3-D projection warns that it is deprecated

When a run of `protspace prepare` or `protspace project` requests one or more methods with dimension suffix `3`, the package SHALL log one deprecation warning for the run, naming the requested 3-D methods, the removal version, and the 2-D variant to use instead. The 3-D projections SHALL still be computed and written as before. A run requesting only 2-D methods SHALL NOT print the warning.

#### Scenario: A 3-D method is requested

- **WHEN** a user runs `protspace project -i emb.h5 -m pca2,umap3`
- **THEN** one WARNING line says 3-D projections are deprecated and will be removed in protspace 5.0.0, names `umap3`, and suggests `umap2`
- **AND** both projections are written and the command exits 0

#### Scenario: Several 3-D methods are requested

- **WHEN** a run requests `umap3` and `pca3`
- **THEN** a single warning names both

#### Scenario: Only 2-D methods are requested

- **WHEN** a run requests `pca2,umap2`
- **THEN** no deprecation warning is printed

### Requirement: `protspace prepare` checks its methods before embedding

`protspace prepare` SHALL parse its `-m` methods before any embedding starts, so that for a FASTA or `-q` input the 3-D deprecation warning comes before the embeddings are computed, and a malformed method spec fails as a usage error before any embedding work.

#### Scenario: A FASTA input with a 3-D method

- **WHEN** a user runs `protspace prepare -i seqs.fasta -m umap3`
- **THEN** the 3-D deprecation warning is printed before the sequences are embedded, and only once

#### Scenario: A malformed method spec with a FASTA input

- **WHEN** a user runs `protspace prepare -i seqs.fasta -m "umap2:bogus=5"`
- **THEN** the command exits with a usage error naming the unknown parameter, and nothing is embedded

### Requirement: The help text marks 3-D methods as deprecated

The `-m/--methods` help of every command that accepts projection methods SHALL say that 3-D methods are deprecated and name the removal version.

#### Scenario: Reading the methods help

- **WHEN** a user runs `protspace project --help` or `protspace prepare --help`
- **THEN** the `-m/--methods` help says 3-D methods are deprecated and removed in protspace 5.0.0

### Requirement: The local viewer warns that it is deprecated

`protspace serve` SHALL be marked deprecated in `protspace --help` and in its own `--help`, and running it SHALL print a deprecation warning naming the removal version and pointing to https://protspace.app/explore, where a bundle is read in the browser and never uploaded. The viewer SHALL still start as before. The top-level quick start SHALL NOT suggest `protspace serve`.

#### Scenario: Listing commands

- **WHEN** a user runs `protspace --help`
- **THEN** `serve` is shown as deprecated and the quick start names only the web app

#### Scenario: Starting the viewer

- **WHEN** a user runs `protspace serve data.parquetbundle`
- **THEN** a warning says `protspace serve` is deprecated, will be removed in protspace 5.0.0, and names https://protspace.app/explore
- **AND** the viewer then starts as before

### Requirement: The test suite fails once the package version reaches a removal version

The package's tests SHALL fail when the package's own version is equal to or later than any registered removal version, naming each overdue feature, so every pull request after a version bump to that release is red until the feature is removed and its registry entry deleted.

#### Scenario: The version is bumped to 5.0.0 with a feature still registered

- **WHEN** the package version is 5.0.0 and the registry still lists a feature due in 5.0.0
- **THEN** the deprecation test fails and names that feature

#### Scenario: All removals are still in the future

- **WHEN** the package version is earlier than every registered removal version
- **THEN** the deprecation test passes

### Requirement: The release workflow refuses to publish a version past a removal version

Before the release step creates a version, the release workflow SHALL compute the version it is about to release, without changing the repository, and SHALL fail, listing every registered feature still due, when that version is equal to or later than the feature's removal version. When no release is due, the check SHALL pass and the workflow's existing no-release handling SHALL be unchanged.

#### Scenario: The next release would be 5.0.0

- **WHEN** the commits since the last release would produce 5.0.0 and the registry still lists features due in 5.0.0
- **THEN** the release job fails before any version, tag or changelog is written, and its log lists each feature and what to remove

#### Scenario: The next release is earlier than every removal version

- **WHEN** the commits since the last release would produce 4.17.0
- **THEN** the check passes and the release proceeds as before

#### Scenario: No release is due

- **WHEN** semantic-release finds nothing to release (for example the run triggered by a release's own version-bump commit)
- **THEN** the check passes and the release step's no-op handling reports no release, as before
