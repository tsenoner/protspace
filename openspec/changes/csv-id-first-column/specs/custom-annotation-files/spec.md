## RENAMED Requirements

- FROM: `### Requirement: The id column is resolved by one rule`
- TO: `### Requirement: The first column holds the ids`

## MODIFIED Requirements

### Requirement: The first column holds the ids

The loader SHALL take a custom annotation file's first column as its id column, whatever its
header; no column name SHALL take precedence over it. A later column whose header is exactly one of
the reserved names `identifier`, `protein_id`, `id`, `uniprot`, `entry`, `projection_name`, `x`,
`y` or `z` SHALL be kept as an annotation renamed `<name>_annotation` (numbered when the file
already has that name), and a warning SHALL name the file, the column and its new name. `stats` and
`bundle` SHALL resolve a parquet annotation table's id column by one rule: the column named
`protein_id` or `identifier`, else the first column. A parquet with both SHALL be an error naming
them.

#### Scenario: protein_id is not the first column

- **WHEN** a file has the columns `family,protein_id,group`
- **THEN** `family` holds the ids, and `protein_id` reaches the output as `protein_id_annotation`
  with a warning naming the rename

#### Scenario: identifier is not the first column

- **WHEN** `prepare -a labels.csv` reads a file with the columns `seq,identifier,group`
- **THEN** the run succeeds, `seq` holds the ids, and the bundle carries `identifier_annotation`
  and `group`

#### Scenario: A column named id

- **WHEN** a file has the columns `accession,id,family`
- **THEN** `accession` holds the ids and `id` reaches the output as `id_annotation`

#### Scenario: No id-named column

- **WHEN** a file has the columns `ProteinID,family`
- **THEN** the first column holds the ids

#### Scenario: Two id-named columns

- **WHEN** a file has the columns `accession,identifier,protein_id`
- **THEN** `accession` holds the ids, and `identifier_annotation` and `protein_id_annotation` reach
  the output, instead of the file being refused

#### Scenario: A name that only differs in case

- **WHEN** a file has the columns `accession,Protein_ID`
- **THEN** `Protein_ID` reaches the output under its own name

#### Scenario: stats' table is one bundle accepts

- **WHEN** `stats -a labels.csv` scores a file whose columns are `seq,protein_id,grp`
- **THEN** `labels.annotations.parquet` holds the ids in `identifier` and the annotation in
  `protein_id_annotation`, and `bundle -a` on it carries both `grp` and the cluster columns

#### Scenario: stats and bundle agree on a parquet

- **WHEN** a parquet annotation table's id column is `ProteinID`, first, with no `protein_id` or
  `identifier` column
- **THEN** `stats -a` and `bundle -a` both key the table on `ProteinID`

#### Scenario: A parquet naming its ids twice

- **WHEN** a parquet annotation table has both an `identifier` and a `protein_id` column
- **THEN** `bundle -a` fails with a message naming both
