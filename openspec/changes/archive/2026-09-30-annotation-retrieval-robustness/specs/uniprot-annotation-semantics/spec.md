## ADDED Requirements

### Requirement: Protein family names are kept whole

ProtSpace SHALL derive each `protein_families` value from UniProt's sequence-similarity statement
by removing the `Belongs to the` prefix and keeping the first sentence. A sentence ends only at a
`.` followed by whitespace or the end of the text, and never at a `.` inside parentheses. Family
names carry transporter classification numbers such as `(TC 3.A.3)`, and cutting at the first `.`
truncated 9,090 Swiss-Prot family names to fragments such as `… (TC 3`.

#### Scenario: A family name contains a transporter classification number

- **WHEN** a UniProt entry's similarity text is
  `Belongs to the cation transport ATPase (P-type) (TC 3.A.3) family. Type IIA subfamily`
- **THEN** ProtSpace emits `cation transport ATPase (P-type) (TC 3.A.3) family`

#### Scenario: A hierarchical classification is given

- **WHEN** the similarity text is
  `Belongs to the metallo-dependent hydrolases superfamily. DHOase family. CAD subfamily`
- **THEN** ProtSpace emits the first level, `metallo-dependent hydrolases superfamily`

#### Scenario: The text has no prefix

- **WHEN** the similarity text does not start with `Belongs to the`
- **THEN** ProtSpace emits its first sentence unchanged

#### Scenario: The entry has an evidence code

- **WHEN** the similarity text carries evidence
- **THEN** the emitted family keeps its evidence code after a pipe, as before

#### Scenario: The entry has no similarity statement

- **WHEN** a UniProt entry has no sequence-similarity comment
- **THEN** ProtSpace emits an empty `protein_families` value

### Requirement: Each family of a multi-section entry is emitted

ProtSpace SHALL emit, for a UniProt entry whose similarity statements assign different sections of
the protein to families (`In the N-terminal section; belongs to the X family`), the family named
in each statement rather than the section qualifier. It SHALL join distinct families with the
reserved multi-value delimiter `;`, in UniProt's order, each followed by its own evidence code.
Taking the text before the first `.` produced 4,688 Swiss-Prot pseudo-families like
`In the N-terminal section`, and reading only the first statement dropped the protein's other
families.

#### Scenario: Two sections belong to two families

- **WHEN** an entry has the statements
  `In the N-terminal section; belongs to the aspartokinase family` and
  `In the C-terminal section; belongs to the homoserine dehydrogenase family`
- **THEN** ProtSpace emits `aspartokinase family` and `homoserine dehydrogenase family` as two
  values of one cell, in that order

#### Scenario: Numbered sections and hierarchical names combine

- **WHEN** an entry has statements for the N-terminal, 2nd, 3rd and C-terminal sections, some
  naming a superfamily followed by a family and subfamily
- **THEN** ProtSpace emits one value per statement, each the first level of that statement's
  classification

#### Scenario: Two sections name the same family

- **WHEN** two statements of one entry name the same family
- **THEN** that family appears once

#### Scenario: Multi-family values pass through the transformer unchanged

- **WHEN** a multi-family `protein_families` value, fresh or read back from the annotation cache,
  passes through the annotation transformer
- **THEN** every family and its evidence code are preserved unchanged

#### Scenario: Scores are stripped per family

- **WHEN** output is written with `--no-scores`
- **THEN** each family of a multi-family value loses its evidence code, and none of the families
  is dropped
