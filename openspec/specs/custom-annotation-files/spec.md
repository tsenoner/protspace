# custom-annotation-files Specification

## Purpose

How a user's annotation table given to `-a` is recognised, parsed, keyed, merged, checked against the input and encoded, the same way in every command that takes one; and `project` refusing annotation and statistics options with a pointer to the commands that take them.

## Requirements

### Requirement: A custom annotation file is recognised by its suffix in every command

`prepare`, `annotate`, `stats` and `bundle` SHALL read an `-a` value ending in `.csv`, `.tsv` or
`.txt`, compared case-insensitively, as a custom annotation file through one shared loader. Every
other `-a` value of `prepare` and `annotate` SHALL remain an annotation source or group name.

#### Scenario: An upper-case or .txt suffix

- **WHEN** a command receives `-a labels.CSV` or `-a labels.txt`
- **THEN** the file is read as a custom annotation file instead of failing as an unknown annotation

#### Scenario: A file with another suffix

- **WHEN** `prepare` or `annotate` receives `-a labels.xlsx` and that file exists
- **THEN** the command fails with a message naming the accepted suffixes, without a traceback

#### Scenario: A file name holding a comma

- **WHEN** `-a "labels, v2.csv"` names an existing file
- **THEN** that file is read whole instead of being split into `labels` and ` v2.csv`

#### Scenario: A missing file

- **WHEN** `prepare -i seqs.fasta -a typo.csv` is run and `typo.csv` does not exist
- **THEN** it fails with a usage error naming the file before anything is embedded

#### Scenario: A source name that is also a file name

- **WHEN** `-a default` is given and the working directory holds a file named `default`
- **THEN** `default` is read as the annotation group

### Requirement: The delimiter is sniffed from the header

The loader SHALL choose the delimiter among tab, comma and semicolon by which one splits the header
line into the most fields, independent of the file's extension. When the header splits into one
field under every candidate, the loader SHALL warn that the file has a single column.

#### Scenario: A tab-separated file named .csv

- **WHEN** a tab-separated file named `labels.csv` is loaded
- **THEN** its columns reach the output

#### Scenario: A semicolon-separated file

- **WHEN** a semicolon-separated `.csv` is loaded
- **THEN** its columns reach the output

#### Scenario: A one-column file

- **WHEN** a file's header contains none of the candidate delimiters
- **THEN** a warning says the file parsed to a single column and names the accepted delimiters

### Requirement: The id column is resolved by one rule

The id column SHALL be the column named `identifier` or `protein_id` (case-insensitive) in any
position; otherwise the column named `id` (case-insensitive); otherwise the first column. Two
columns matching the first rule SHALL be an error naming them. `stats` and `bundle` SHALL resolve a parquet annotation table's id column
with the same rule.

#### Scenario: protein_id is not the first column

- **WHEN** a file has the columns `family,protein_id,group`
- **THEN** `protein_id` holds the ids and `family` and `group` reach the output

#### Scenario: identifier is not the first column

- **WHEN** a file has the columns `family,identifier,group`
- **THEN** `identifier` holds the ids

#### Scenario: No id-named column

- **WHEN** a file has the columns `ProteinID,family`
- **THEN** the first column holds the ids

#### Scenario: Two id-named columns

- **WHEN** a file has both an `identifier` and a `protein_id` column
- **THEN** loading fails with a message naming both

#### Scenario: stats and bundle agree on a parquet

- **WHEN** a parquet annotation table's id column is `ProteinID`, first, with no id-named column
- **THEN** `stats -a` and `bundle -a` both key the table on `ProteinID`

### Requirement: Cells are read as text

The loader SHALL read every cell as a string and keep an empty cell empty. It SHALL accept CRLF,
lone CR and mixed line endings and a UTF-8 byte-order mark. Header names and id values SHALL be
stripped of surrounding whitespace. Plain-text cells SHALL be encoded into the v2 cell grammar the
same way `bundle -a` encodes a hand-written table, so `;` outside parentheses separates values.

#### Scenario: An empty cell

- **WHEN** a row of the file leaves a cell empty
- **THEN** the protein's value for that column is empty, not `nan`

#### Scenario: CRLF line endings

- **WHEN** the file uses CRLF or mixed CR/LF line endings
- **THEN** every column and row is read as with LF endings

#### Scenario: A semicolon inside parentheses

- **WHEN** a cell reads `Membrane (single-pass; type I)`
- **THEN** it is one value

### Requirement: Several files are merged, never replaced

When several custom annotation files are given, the loader SHALL join them on the id column. A
non-id column defined by two files SHALL be an error naming the column and both files. The same
file given twice SHALL be read once.

#### Scenario: A second file adds columns

- **WHEN** `prepare -a meta.csv -a neighbor.csv` is run
- **THEN** the bundle carries the columns of both files

#### Scenario: Two files define one column

- **WHEN** two files both have a `family` column
- **THEN** the command fails with a message naming `family` and both files

### Requirement: Each file's ids are checked against the input

The loader SHALL report, per file, how many of its ids match an input protein, and SHALL warn when
any of a file's ids match none, showing examples of the unmatched ids and of the input's ids. Its
result SHALL hold exactly one row per input protein, in input order, empty where no file has a row.

#### Scenario: Accessions against full UniProt headers

- **WHEN** the file's ids are `P60000` and the input's are `sp|P60000|TX0_CONSP`
- **THEN** a warning names unmatched ids from the file and example ids from the input

#### Scenario: A file covering part of the input

- **WHEN** every id in the file matches an input protein but some proteins have no row
- **THEN** no warning is given and those proteins have empty values

### Requirement: annotate takes custom annotation files beside source names

`annotate -a` SHALL accept custom annotation files beside source names and SHALL fetch nothing when
given only files. File columns SHALL override fetched columns of the same name. An unknown source
name SHALL be a usage error without a traceback.

#### Scenario: annotate with only a CSV

- **WHEN** `annotate -i emb.h5 -a labels.csv -o ann.parquet` is run
- **THEN** no annotation source is fetched and `ann.parquet` holds the file's columns for every
  input protein

#### Scenario: An unknown source name

- **WHEN** `annotate -a not_a_source` is run
- **THEN** it fails with a usage error listing the groups, without a traceback

### Requirement: stats scores a custom annotation file without rewriting it

`stats -a` SHALL accept a custom annotation file, score it, and write the table with its
per-protein cluster columns to `<file stem>.annotations.parquet` in the projections directory,
leaving the file and every other file in that directory unchanged.

#### Scenario: stats with a CSV

- **WHEN** `stats -i emb.h5 -p proj -a labels.csv -o stats.parquet` is run
- **THEN** the file is unchanged and `proj/labels.annotations.parquet` holds its columns plus the
  cluster columns, for every projected protein

#### Scenario: An unbundled prepare directory

- **WHEN** `-p` is a `prepare --no-bundled` directory holding `selected_annotations.parquet`
- **THEN** `stats -a labels.csv` leaves that file unchanged

### Requirement: bundle takes a custom annotation file

`bundle -a` SHALL accept a custom annotation file in place of a parquet. A `stats -a` or
`bundle -a` input that is neither SHALL be a usage error naming what `-a` accepts.

#### Scenario: bundle with a CSV

- **WHEN** `bundle -p proj -a labels.csv -o out.parquetbundle` is run
- **THEN** the bundle carries the file's columns

#### Scenario: A non-parquet, non-CSV file

- **WHEN** `bundle -a` or `stats -a` names a file that is neither
- **THEN** the command fails with a usage error naming what `-a` accepts

### Requirement: project points to the commands that annotate and score

`project` SHALL reject `-a/--annotations` and `--stats` with a usage error that names
`protspace prepare … -a … --stats` and the `annotate`, `stats` and `bundle` steps. Neither option
SHALL appear in `project --help`, which SHALL name `prepare`.

#### Scenario: A v4.4-style project call

- **WHEN** `project -i emb.h5 -m umap2 -a labels.csv -o proj` is run
- **THEN** it fails without computing a projection, and the message names `prepare` and `bundle`
