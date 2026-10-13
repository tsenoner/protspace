# fasta-sequence-metadata Specification

## Purpose

Defines how ProtSpace fills protein metadata that the primary annotation source
(UniProt) leaves empty, using sequences the user already supplied locally.

Today that is sequence length: an H5 key that is not a resolvable UniProt
accession gets no length back, even when the FASTA behind those embeddings
carries the sequence. These requirements fix the precedence (a UniProt value
always wins), the residue-counting rule (`*` terminators and `-` gaps are not
residues), and the paths the fallback must reach — `prepare`, `annotate`, and
the warm annotation cache alike.

## Requirements

### Requirement: Missing sequence length falls back to FASTA

The annotation pipeline SHALL derive a protein's sequence length from its
matching local FASTA sequence when the primary annotation source does not
provide a sequence length.

#### Scenario: Unmapped protein has a FASTA sequence

- **WHEN** a protein's UniProt annotation has an empty sequence length and a
  matching non-empty FASTA sequence is available
- **THEN** the output length equals the number of residues in that FASTA
  sequence

#### Scenario: FASTA sequence contains non-residue markers

- **WHEN** a matching FASTA sequence contains `*` terminator or `-` gap markers
- **THEN** those markers are excluded from the derived residue count

#### Scenario: UniProt provides a sequence length

- **WHEN** a protein has both a non-empty UniProt sequence length and a matching
  FASTA sequence
- **THEN** the output retains the UniProt sequence length

#### Scenario: Standalone annotation command receives FASTA input

- **WHEN** `protspace annotate` receives a FASTA file containing a protein whose
  UniProt annotation has an empty sequence length
- **THEN** the output length equals the number of residues in the matching FASTA
  sequence

#### Scenario: Complete annotation cache has a missing sequence length

- **WHEN** a complete annotation cache has an empty sequence length and a
  matching non-empty FASTA sequence is available
- **THEN** the warm-cache output length equals the number of residues in that
  FASTA sequence without refetching annotations

#### Scenario: Complete annotation cache has an existing sequence length

- **WHEN** a complete annotation cache has a non-empty sequence length and a
  matching FASTA sequence is available
- **THEN** the warm-cache output retains the cached sequence length

#### Scenario: Directory-based HDF5 input supplies a FASTA file

- **WHEN** `protspace prepare` receives a directory of HDF5 files and a FASTA
  file through `-f`
- **THEN** the annotation pipeline can use matching sequences from that FASTA
  file for the missing-length fallback

#### Scenario: UniProt retrieval fails before producing rows

- **WHEN** UniProt retrieval fails and a matching local FASTA sequence is
  available for only some proteins
- **THEN** the output retains a uniform length column and fills the matching
  proteins independently of row order

#### Scenario: No source provides a sequence length

- **WHEN** a protein's UniProt annotation has an empty sequence length and no
  matching non-empty FASTA sequence is available
- **THEN** the output sequence length remains missing

#### Scenario: Matching FASTA sequence contains only non-residue markers

- **WHEN** a matching FASTA sequence consists solely of `*` terminator or `-`
  gap markers
- **THEN** the output sequence length remains missing rather than becoming zero

#### Scenario: Warm cache holds no annotation values at all

- **WHEN** every cached annotation value is empty and the FASTA fallback fills
  the sequence length
- **THEN** the empty-cache warning is still emitted
