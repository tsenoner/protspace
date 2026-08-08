## Why

Biocentral emits a valid protein-level `predicted_transmembrane` category named
`none`, but the web reader reserves `none` as a missing-value token. As a result,
proteins with a successful “no transmembrane segment” prediction are displayed as
N/A and cannot be distinguished from proteins whose prediction is actually absent.

## What Changes

- Encode successful TMbed predictions with no membrane-spanning segment using a
  non-reserved categorical label.
- Preserve absent or malformed Biocentral predictions, including TMbed prediction
  objects whose optional payload is `None`, empty, non-string, or contains unsupported
  topology labels, as missing values for both derived TMbed annotations.
- Preserve FASTA sequences through the standalone `annotate` command when a requested
  source needs them, using source-appropriate precedence when UniProt also supplies a
  canonical sequence.
- Add regression coverage across the Python annotation producer and TypeScript
  bundle consumer boundary.
- Update generated annotation documentation to describe the corrected category.

## Capabilities

### New Capabilities

- `annotation-input`: Require standalone FASTA annotation inputs to retain their
  sequences for sequence-backed annotation sources.

### Modified Capabilities

- `bundle-format-contract`: Require producer-emitted categorical values to remain
  distinguishable from the consumer's missing-value sentinel set.

## Impact

- Python FASTA annotation input and TMbed extraction in `apps/protspace`.
- The hosted prep pipeline's normalized-FASTA handoff to `protspace annotate`.
- The generated cross-language bundle fixture and contract assertions.
- Annotation metadata/documentation describing `predicted_transmembrane` values.
- No dependency, API, or bundle-layout changes.
