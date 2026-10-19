## MODIFIED Requirements

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

### Requirement: `protspace convert` warns about 3-D projections it keeps

Without `--flatten-3d`, `protspace convert` SHALL keep 3-D projections as they are and SHALL print a warning naming them, the removal version for reading 3-D projections, recomputing with the 2-D method, and `--flatten-3d`. With `--flatten-3d`, the line naming the flattened projections SHALL say that only for PCA is the X/Y view the same as the 2-D projection.

#### Scenario: Converting a v2 bundle with a 3-D projection

- **WHEN** a user converts a v2 bundle holding `UMAP 3` without `--flatten-3d`
- **THEN** the v3 output keeps `UMAP 3` as 3-D and a warning names it, recomputing with the 2-D method, and `--flatten-3d`

#### Scenario: Flattening says what the X/Y view is

- **WHEN** a user converts a bundle holding `UMAP 3` with `--flatten-3d`
- **THEN** the output names `UMAP 3 -> UMAP 3 (X/Y)` and says that only for PCA is the X/Y view the same as the 2-D projection
