## 1. Regression and Fix

- [x] 1.1 Add a focused regression test for unresolved, resolved-without-PDB, and resolved-with-PDB annotations, then verify the unresolved case fails on current code.
- [x] 1.2 Implement the minimal context-aware PDB transformation and verify the focused test passes.

## 2. Verification

- [x] 2.1 Re-run the mixed mapped/unmapped manager reproduction and confirm the unmapped PDB annotation is empty.
- [x] 2.2 Run the affected Python test suite and lint checks.
- [x] 2.3 Run the repository-mandated `pnpm precommit` gate.

## 3. Cache Round-Trip Review Follow-up

- [x] 3.1 Add a manager/cache round-trip regression test for canonical empty, `False`, and `True` PDB values, then verify the `False` case fails on current code.
- [x] 3.2 Make PDB transformation idempotent for persisted canonical boolean strings and verify the focused regression passes.
- [x] 3.3 Re-run strict OpenSpec validation, affected and full Python tests, Ruff, `pnpm precommit`, and the bundle contract.

## 4. Cache Migration and Documentation Review Follow-up

- [x] 4.1 Add a failing regression proving that a complete legacy PDB cache is
      refetched and rewritten with the current annotation-cache semantics marker.
- [x] 4.2 Implement the smallest source-scoped legacy cache invalidation and verify
      unaffected cached sources remain on the shared merge path.
- [x] 4.3 Add a failing mixed cached-InterPro/refetched-UniProt regression and make
      signal-peptide canonicalization idempotent.
- [x] 4.4 Update canonical PDB value documentation, regenerate the derived guide,
      and validate the OpenSpec change strictly.
- [x] 4.5 Run affected and full Python tests, Ruff, the bundle contract, and the
      repository-mandated `pnpm precommit` gate.

## 5. Taxonomy Migration Review Follow-up

- [x] 5.1 Add a failing production-path regression proving cached taxonomy survives a
      UniProt cache migration and repeated reuse while stale UniProt fields do not.
- [x] 5.2 Preserve the cached taxonomy lookup dependency only until taxonomy is
      rehydrated, without retaining stale UniProt outputs or changing source refetching.
- [x] 5.3 Run focused, affected, full Python, Ruff, bundle contract, strict OpenSpec,
      docs/generated, and repository precommit verification.

## 6. Order-Independent Cache Schema Review Follow-up

- [x] 6.1 Reverse the mixed mapped/unmapped migration regression and verify a later-only
      cached taxonomy field is omitted on the current writer path.
- [x] 6.2 Build the Parquet annotation schema from all records while preserving existing
      first-seen column order and missing-value behavior.
- [x] 6.3 Run focused, affected, full Python, Ruff, strict OpenSpec, bundle contract,
      docs/generated, and repository precommit verification.

## 7. Migration Source Selection and Failure Safety Review Follow-up

- [x] 7.1 Add a failing regression proving a legacy PDB migration still fetches a
      newly required non-UniProt source.
- [x] 7.2 Make the migration UniProt refresh additive to the derived source plan and
      verify the focused regression passes.
- [x] 7.3 Add a failing regression proving a partial UniProt batch failure leaves the
      legacy cache unstamped and available for a later retry.
- [x] 7.4 Propagate UniProt batch-failure state and suppress only failed migration
      writes, without changing ordinary or explicit-refetch cache behavior.
- [x] 7.5 Correct the design's missing-context statement and run focused, affected,
      full Python, Ruff, strict OpenSpec, bundle contract, docs/generated, and
      repository precommit verification.
