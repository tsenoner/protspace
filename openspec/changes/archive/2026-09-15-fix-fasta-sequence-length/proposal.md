## Why

Protein sequences that cannot be mapped to UniProt currently export an empty
`length` annotation even when the preparation pipeline already parsed their
sequence from FASTA. This discards reliable local metadata and causes ProtSpace
to display the sequence length as unavailable.

## What Changes

- Derive a missing sequence length from the matching local FASTA sequence.
- Supply normalized FASTA sequences to the standalone `protspace annotate`
  command used by the hosted preparation service.
- Preserve FASTA access when `protspace prepare` loads a directory of HDF5
  embeddings with `-f`.
- Apply the same fallback when a complete annotation cache satisfies the run.
- Count amino-acid residues rather than FASTA terminator or gap markers.
- Preserve a non-empty length returned by UniProt.
- Keep the existing missing-value behavior when neither source provides a
  sequence length.
- Add regression coverage for the fallback and precedence behavior.
- Document the missing-only FASTA fallback and UniProt precedence.

## Capabilities

### New Capabilities

- `fasta-sequence-metadata`: Defines how FASTA-derived sequence metadata fills
  gaps left by external annotation sources.

### Modified Capabilities

None.

## Impact

- Affects the Python annotation orchestration in
  `apps/protspace/src/protspace/data/annotations/manager.py`, the standalone
  annotation command, the HDF5-directory preparation path, and the
  complete-cache branch in `apps/protspace/src/protspace/data/processors/pipeline.py`.
- Adds focused manager, standalone annotation, and warm-cache pipeline tests.
- Updates both annotation references to describe FASTA fallback behavior.
- Does not change public APIs, file formats, dependencies, or UniProt precedence.
