## Why

Biocentral emits a valid protein-level `predicted_transmembrane` category named
`none`, but the web reader reserves `none` as a missing-value token. As a result,
proteins with a successful “no transmembrane segment” prediction are displayed as
N/A and cannot be distinguished from proteins whose prediction is actually absent.

`main` shipped the label (`non-transmembrane`), the empty-payload case for
`predicted_transmembrane`, and FASTA sequences in `protspace annotate` (PR 495) while
this change was in review. What this change still adds: an empty or malformed TMbed
payload is missing for the signal peptide too (main still wrote `False`), a malformed
payload is never read as a topology, each sequence-backed source gets the sequence it
needs, and caches written before are refreshed.

## What Changes

- Encode successful TMbed predictions with no membrane-spanning segment using a
  non-reserved categorical label (already on main; specified here at the bundle
  boundary).
- Preserve absent or malformed Biocentral predictions, including TMbed prediction
  objects whose optional payload is `None`, empty, non-string, or contains unsupported
  topology labels, as missing values for both derived TMbed annotations.
- Use source-appropriate sequence precedence when both the FASTA and UniProt supply a
  sequence: Biocentral predicts the submitted sequence, InterPro looks up the canonical
  one.
- Record the TMbed payload change as annotation cache semantics version 4, so caches
  written before it are refreshed rather than reused; a stale column of a source the
  refresh refetches anyway is refreshed with it instead of being dropped.
- Add regression coverage across the Python annotation producer and TypeScript
  bundle consumer boundary.

## Capabilities

### New Capabilities

- `annotation-input`: Require standalone FASTA annotation inputs to retain their
  sequences for sequence-backed annotation sources.

### Modified Capabilities

- `bundle-format-contract`: Require producer-emitted categorical values to remain
  distinguishable from the consumer's missing-value sentinel set.
- `annotation-cache-semantics`: Refresh cached TMbed columns written before the payload
  validation.

## Impact

- Python FASTA annotation input and TMbed extraction in `apps/protspace`.
- The hosted prep pipeline's normalized-FASTA handoff to `protspace annotate`.
- The generated cross-language bundle fixture and contract assertions.
- The annotation cache's legacy-refresh rules (`data/annotations/cache.py`).
- No dependency, API, or bundle-layout changes.
