## 1. Regression Coverage

- [x] 1.1 Update the focused Biocentral retriever test to require the unambiguous negative TMbed category and observe it fail.
- [x] 1.2 Extend the generated Python-to-TypeScript bundle contract with a negative TMbed prediction and observe the consumer assertion fail.

## 2. Producer and Documentation

- [x] 2.1 Change the Biocentral TMbed adapter to emit `non-transmembrane` for a completed negative prediction.
- [x] 2.2 Update CLI and web annotation descriptions to document the corrected categorical vocabulary.

## 3. Verification

- [x] 3.1 Run the focused Python retriever and cross-language contract tests and confirm they pass.
- [x] 3.2 Regenerate annotation documentation and verify generated files are current.
- [x] 3.3 Run the affected Python lint/test gates and the repository-wide `pnpm precommit` gate.
- [x] 3.4 Verify a newly produced bundle displays the negative TMbed category separately from missing values.

## 4. Review Regression Coverage

- [x] 4.1 Add focused real-model regressions for `None` and empty TMbed payloads and observe the expected failures.
- [x] 4.2 Extend the generated bundle contract with an adapter-derived missing TMbed payload and observe the expected failure.

## 5. Missing Payload Fix

- [x] 5.1 Return the established missing representation before scanning absent TMbed topology payloads.

## 6. Review Verification

- [x] 6.1 Run the focused Biocentral and cross-language bundle contract tests and confirm they pass.
- [x] 6.2 Run Ruff, the complete non-slow ProtSpace Python suite, strict OpenSpec validation, and `pnpm precommit`.
- [x] 6.3 Prepare the verified change for the inline review follow-up and CI run.

## 7. Follow-up Review Regression Coverage

- [x] 7.1 Add focused real-model regressions proving missing TMbed payloads remain
      missing for signal peptide and observe the expected failures.
- [x] 7.2 Extend the generated bundle contract to expose missing signal peptide as
      `N/A` and observe the expected failure.
- [x] 7.3 Add CLI regression coverage proving FASTA sequences reach the annotation
      manager and strengthen the hosted normalized-FASTA handoff assertion.

## 8. Follow-up Review Fixes

- [x] 8.1 Parse and pass FASTA sequences through `protspace annotate` while preserving
      HDF5 behavior.
- [x] 8.2 Centralize optional TMbed topology extraction for both derived annotations.

## 9. Follow-up Review Verification

- [x] 9.1 Run focused ProtSpace, hosted-prep, and cross-language contract tests.
- [x] 9.2 Run Ruff, the complete relevant Python suites, strict OpenSpec validation,
      and `pnpm precommit`.
- [x] 9.3 Prepare the verified change for the review reply and pushed CI run.

## 10. Malformed Payload and Spec Ownership Regressions

- [x] 10.1 Add real-model regressions proving malformed TMbed payloads remain missing
      for both derived annotations and observe the expected failures.
- [x] 10.2 Add a producer/consumer regression proving a malformed TMbed payload reaches
      TypeScript as `N/A` and observe the expected failure.
- [x] 10.3 Move the FASTA sequence requirement from `bundle-format-contract` to its
      owning `annotation-input` capability within this change.

## 11. Malformed Payload Fix

- [x] 11.1 Restrict the shared TMbed topology extractor to non-blank strings containing
      only supported topology labels while preserving all valid topology semantics.

## 12. Final Review Verification

- [x] 12.1 Run focused ProtSpace and cross-language contract tests.
- [x] 12.2 Run Ruff, the complete relevant Python and hosted-prep suites, strict OpenSpec
      validation, and `pnpm precommit`.
- [x] 12.3 Prepare the verified change for inline review replies and pushed CI.

## 13. Source Precedence and Optimized-Path Regressions

- [x] 13.1 Add a manager regression proving InterPro prefers a UniProt canonical
      sequence while Biocentral prefers the submitted FASTA sequence, and observe it
      fail.
- [x] 13.2 Add a CLI regression proving UniProt-only FASTA annotation does not parse or
      retain sequences, and observe it fail.
- [x] 13.3 Extend the optimized bundle conversion contract with the negative and missing
      TMbed sentinel assertions.

## 14. Source-Aware Sequence Handling and Documentation

- [x] 14.1 Apply source-specific sequence precedence in the annotation manager.
- [x] 14.2 Parse FASTA sequences only when a requested annotation source consumes them.
- [x] 14.3 Document that mixed TMbed predictions expose both transmembrane categories.

## 15. Latest Review Verification

- [x] 15.1 Run focused annotation-manager, CLI, and bundle-contract checks.
- [x] 15.2 Run Ruff, the complete relevant Python and hosted-prep suites, strict OpenSpec
      validation, and `pnpm precommit`.
- [x] 15.3 Prepare the verified changes and per-item dispositions for the newest review
      reply.
