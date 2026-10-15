## ADDED Requirements

### Requirement: PDB availability preserves UniProt evidence state

ProtSpace SHALL emit the UniProt-derived PDB availability annotation as `True` only when a resolved UniProt entry has at least one PDB cross-reference, as `False` only when a resolved UniProt entry has no PDB cross-reference, and as an empty value when no UniProt entry was resolved.

#### Scenario: Resolved entry has a PDB structure

- **WHEN** a protein resolves to a UniProt entry with one or more PDB cross-references
- **THEN** ProtSpace emits `True` for `xref_pdb`

#### Scenario: Resolved entry has no PDB structure

- **WHEN** a protein resolves to a UniProt entry without any PDB cross-reference
- **THEN** ProtSpace emits `False` for `xref_pdb`

#### Scenario: Protein has no resolved UniProt entry

- **WHEN** a protein identifier does not resolve to a UniProt entry
- **THEN** ProtSpace emits an empty value for `xref_pdb`
- **AND** downstream missing-value handling can present the annotation as `N/A`

#### Scenario: Cached PDB availability is loaded again

- **WHEN** ProtSpace loads persisted `xref_pdb` values containing the canonical empty, `False`, and `True` states
- **THEN** the annotation manager emits those same three states unchanged
- **AND** a cached `False` value does not become `True` during transformation
