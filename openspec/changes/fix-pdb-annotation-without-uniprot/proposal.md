## Why

ProtSpace currently converts an empty PDB cross-reference into `False` even when the protein has no matching UniProt entry. This reports a negative UniProt fact where no UniProt evidence exists; the annotation must remain missing so clients display `N/A`.

## What Changes

- Preserve an empty `xref_pdb` value for proteins without a resolved UniProt identifier.
- Continue emitting `False` for resolved UniProt entries that have no PDB cross-reference.
- Continue emitting `True` for resolved UniProt entries with one or more PDB cross-references.
- Preserve all three canonical values when transformed annotations are loaded from cache.
- Automatically refresh legacy UniProt caches whose persisted PDB values predate the
  three-state contract, then mark rewritten caches with the current annotation semantics.
- Preserve cached signal-peptide booleans when UniProt or another source is refetched.
- Document the empty PDB state as unavailable/`N/A` in the canonical and generated
  annotation references.
- Add regression coverage for all three states without changing unrelated annotation behavior.

## Capabilities

### New Capabilities

- `uniprot-annotation-semantics`: Defines how UniProt-derived PDB availability distinguishes positive, negative, and unavailable evidence.
- `annotation-cache-semantics`: Defines migration and idempotency requirements for
  persisted annotation values.

### Modified Capabilities

None.

## Impact

- Affects the Python annotation transformation and incremental-cache paths in
  `apps/protspace` and their focused tests.
- Changes the emitted categorical value for unmapped proteins from `False` to missing/empty; existing frontend missing-value handling already renders that value as `N/A`.
- Causes a one-time UniProt refresh when an unversioned annotation cache contains
  `xref_pdb`; other legacy annotation caches remain reusable.
- Updates the Python and web annotation references and regenerates the derived guide.
- Does not change the bundle format, public CLI flags, dependencies, or behavior of mapped UniProt entries.
