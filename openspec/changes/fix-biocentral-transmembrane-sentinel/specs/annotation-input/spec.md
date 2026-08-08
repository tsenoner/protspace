## ADDED Requirements

### Requirement: FASTA annotation inputs retain their sequences

The standalone annotation producer SHALL pass sequences supplied in a FASTA input to
sequence-backed annotation sources using the same canonical identifiers as its output.

#### Scenario: A FASTA identifier is not resolved by UniProt

- **WHEN** `protspace annotate` receives a FASTA entry whose identifier UniProt cannot
  resolve
- **THEN** the entry's FASTA sequence remains available to Biocentral and InterPro
- **AND** the hosted prep pipeline preserves that sequence when it passes its normalized
  FASTA to `protspace annotate`

#### Scenario: A FASTA sequence differs from the UniProt canonical sequence

- **WHEN** `protspace annotate` receives a FASTA sequence for an identifier that UniProt
  resolves to a different canonical sequence
- **THEN** Biocentral receives the FASTA sequence it is being asked to predict
- **AND** InterPro receives the UniProt canonical sequence used by its precomputed
  sequence-hash index

#### Scenario: Requested annotations do not consume sequences

- **WHEN** `protspace annotate` receives a FASTA input and the requested annotation
  sources are UniProt-only or taxonomy-only
- **THEN** the command extracts identifiers without materializing the FASTA sequences
