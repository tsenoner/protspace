## Context

The Biocentral TMbed adapter currently serializes a valid negative prediction as the
categorical string `none`. The web bundle reader applies a shared missing-value policy
to all categorical annotations, and that policy intentionally treats `none`
case-insensitively as absent data. Consequently, a successfully computed negative
TMbed prediction is displayed as `N/A`, making it indistinguishable from proteins for
which no prediction was produced.

This behavior crosses the Python annotation producer, the parquet bundle contract, and
the TypeScript visualization consumer. The fix must preserve the generic importer's
established missing-value semantics while making newly produced TMbed data unambiguous.

## Goals / Non-Goals

**Goals:**

- Preserve a successful TMbed negative prediction as a visible categorical value in
  the web application.
- Keep genuinely absent Biocentral predictions represented as missing values.
- Keep FASTA-provided sequences available to sequence-backed annotation sources even
  when UniProt cannot resolve their identifiers.
- Exercise the producer value through the generated Python-to-TypeScript bundle
  contract so future sentinel collisions fail in CI.
- Keep user-facing annotation documentation aligned with the emitted vocabulary.

**Non-Goals:**

- Changing the generic web missing-value token set.
- Rewriting or migrating already generated `.parquetbundle` files.
- Changing TMbed topology interpretation for alpha helices, beta barrels, or mixed
  predictions.
- Adding contextual bundle-reader rules for one annotation name.

## Decisions

### Emit `non-transmembrane` for a successful negative TMbed prediction

The Biocentral adapter will return `non-transmembrane` when a TMbed result contains
neither an alpha-helical nor a beta-barrel segment. The phrase is explicit, is not in
the consumer's missing-value token set, and does not imply that the protein is soluble
or intracellular.

Alternatives considered:

- Keep `none` and remove it from the generic missing-value set. This would change the
  interpretation of arbitrary imported datasets and turn commonly used missing
  sentinels into visible categories.
- Translate `none` only when reading `predicted_transmembrane`. This would add
  domain-specific repair logic to the generic bundle consumer and would still leave
  the on-disk producer contract ambiguous.
- Use `soluble`. This is biologically narrower than "no predicted transmembrane
  segment" and can mislabel secreted or otherwise non-membrane proteins.

### Preserve empty-string output for an unavailable or malformed TMbed result

The adapter will return an empty string when Biocentral provides no TMbed prediction or
provides a TMbed prediction object whose optional `value` payload is `None`, empty,
non-string, blank, or contains unsupported labels. A usable topology is a string made
only from TMbed's `B`, `b`, `H`, `h`, `S`, `i`, `o`, and `.` labels. The payload guard
runs before topology labels are scanned. This retains the distinction at the producer:
a valid topology with no membrane segment is `non-transmembrane`, while an unavailable
or malformed topology remains missing.

Both `predicted_signal_peptide` and `predicted_transmembrane` derive from that same
optional topology payload. A shared extractor therefore owns the missing-payload check
before either annotation interprets the topology, preventing one annotation from
inventing a completed negative result when the other reports missing data.

### Pass FASTA sequences to the sources that consume them

When a requested source consumes sequences, the standalone `annotate` command will
parse the FASTA into a canonical identifier-to-sequence map and pass it to
`ProteinAnnotationManager`. UniProt-only and taxonomy-only requests will retain the
streaming identifier scan without materializing the full sequence map. HDF5 inputs
continue to omit a local sequence map and retain their existing UniProt-fallback
behavior.

Sequence precedence is source-specific. Biocentral predicts the sequence supplied in
the FASTA, using UniProt only as a fallback for identifiers with no local sequence.
InterPro indexes precomputed matches by sequence hash, so it uses UniProt's canonical
sequence when available and falls back to the FASTA sequence for identifiers UniProt
cannot resolve. This keeps FASTA-only identifiers annotatable without replacing valid
canonical InterPro matches when the submitted sequence differs.

The hosted prep service already normalizes FASTA headers and supplies that normalized
file to `protspace annotate`; regression coverage pins that normalization preserves the
sequence as well as the canonical identifier.

### Cover both the adapter and the cross-language seam

Focused Python regressions will construct the real Biocentral `Prediction` model and
assert the adapter vocabulary for completed and absent payloads. The generated bundle
contract will derive its negative transmembrane and missing TMbed-derived fixture values
from the real adapter and assert that TypeScript preserves the former as a category and
the latter as `N/A`. This avoids duplicated hand-written constants that could allow
producer and contract fixtures to drift apart.

## Risks / Trade-offs

- [Existing bundles still contain ambiguous `none` values] → Document that the fix
  applies to newly generated annotations; users must regenerate an affected bundle to
  recover the distinction.
- [Downstream consumers may expect the old literal] → Treat the value as a categorical
  contract correction and document the new vocabulary in both CLI and web metadata.
- [Contract fixture imports more producer code] → Use a minimal synthetic TMbed
  prediction and retain the real bundle CLI as the serialization boundary.
- [FASTA and UniProt sequences differ] → Keep the submitted sequence authoritative
  for Biocentral predictions and the canonical sequence authoritative for InterPro's
  precomputed hash lookup, with the other source as fallback in each case.

## Migration Plan

Deploy the producer vocabulary and web documentation together. No storage migration is
performed. Newly annotated bundles will carry `non-transmembrane`; existing bundles can
be regenerated with the updated CLI. Rollback consists of reverting the producer value
and its associated tests/documentation.

## Open Questions

None.
