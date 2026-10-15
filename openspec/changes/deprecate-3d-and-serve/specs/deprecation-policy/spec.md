## Purpose

How the protspace Python package announces a feature it will remove, and how its release process refuses to publish a version that still contains a feature past the version it was promised to be removed in.

## ADDED Requirements

### Requirement: Every scheduled removal is declared once with its removal version

The package SHALL keep one registry of scheduled removals. Each entry SHALL name the feature, the first version that must not contain it, and the warning shown to users. Every deprecation warning the package prints SHALL take its text and removal version from that registry, so the warning, the help text and the release checks cannot name different versions.

#### Scenario: A warning states the registered removal version

- **WHEN** any deprecation warning is printed
- **THEN** the version it names is the removal version registered for that feature

#### Scenario: The scheduled removals

- **WHEN** the registry is read
- **THEN** it holds 3-D projections, `protspace serve`, and reading v1/v2 bundles, each due for removal in 5.0.0

### Requirement: The web app names the same removal version for v1/v2 bundles

Wherever the web app tells users, or its code documents, when reading v1/v2 bundles ends, it SHALL name the removal version the registry holds for reading v1/v2 bundles, and the package's tests SHALL fail when the two differ.

#### Scenario: The registry's removal version changes

- **WHEN** the registered removal version for reading v1/v2 bundles is changed and the web app's legacy-format notice is not
- **THEN** the package's tests fail, naming the web source that differs

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
