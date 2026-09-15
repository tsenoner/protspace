## 1. Regression Coverage

- [x] 1.1 Add a focused manager test for deriving an empty UniProt length from a matching FASTA sequence.
- [x] 1.2 Run the focused test and record the expected RED failure against the current implementation.

## 2. Root-Cause Fix

- [x] 2.1 Enrich only missing primary annotation lengths from matching local FASTA sequences before downstream merging.
- [x] 2.2 Add coverage proving that an existing UniProt length is preserved.
- [x] 2.3 Run the focused tests and record GREEN results.

## 3. Verification

- [x] 3.1 Re-run the original unmapped-protein reproduction and confirm the output contains the FASTA-derived length.
- [x] 3.2 Run the affected Python package's lint, format, and non-slow test checks.
- [x] 3.3 Run the repository-mandated `pnpm precommit` gate before publishing.

## 4. Review Follow-up: Complete Cache Hits

- [x] 4.1 Add a warm-cache pipeline regression for an empty cached length with
      a matching FASTA sequence and record the expected RED failure.
- [x] 4.2 Apply the same missing-only FASTA fallback on the complete-cache path
      without refetching annotations or rewriting the cache.
- [x] 4.3 Prove that a non-empty cached length remains authoritative.
- [x] 4.4 Run strict OpenSpec validation and all affected/full verification gates.

## 5. Review Follow-up: Standalone Annotation and Documentation

- [x] 5.1 Add a CLI regression proving normalized FASTA sequence data supplies a
      missing length and record the expected RED failure.
- [x] 5.2 Pass normalized FASTA identifier-to-sequence data through
      `protspace annotate` to the existing manager fallback.
- [x] 5.3 Update both annotation references with missing-only FASTA fallback and
      UniProt-over-FASTA precedence.
- [x] 5.4 Run focused, package, docs, OpenSpec, and repository verification gates.

## 6. Review Follow-up: Edge Cases

- [x] 6.1 Add regressions for FASTA marker counting, UniProt failure schema
      uniformity, and directory-HDF5 FASTA propagation; record the expected RED
      failures.
- [x] 6.2 Exclude `*` and `-` from FASTA-derived residue counts.
- [x] 6.3 Preserve the complete UniProt schema on top-level retrieval failure.
- [x] 6.4 Attach `-f` FASTA input to directory-loaded HDF5 embedding sets.
- [x] 6.5 Synchronize user-facing annotation metadata and identifier-matching
      documentation.
- [x] 6.6 Run focused, package, docs, OpenSpec, and repository verification gates.

## 7. Review Follow-up: Schema-Uniform Failure Fallout

- [x] 7.1 Load the EC name map only for rows that carry an EC number, so an
      offline UniProt failure no longer triggers an ExPASy download.
- [x] 7.2 Skip the annotation cache write when UniProt retrieval fails wholesale
      so the next run re-fetches instead of reusing empty rows.
- [x] 7.3 Emit the empty-cache warning before the FASTA length fallback.
- [x] 7.4 Leave a marker-only FASTA sequence's length missing instead of `0`.
- [x] 7.5 Copy filled annotation rows and keep the `length` key on every row.
- [x] 7.6 Reuse `parse_fasta_normalized` in `ReductionPipeline._extract_sequences`.
- [x] 7.7 Re-run the package lint, format, and non-slow test gates.
