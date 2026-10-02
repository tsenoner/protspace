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

## 8. Simplification and Code Review Follow-up

- [x] 8.1 Consolidate the annotation-cache version marker beside the existing bundle
      format version, read it through a named helper, and compare with `<` so a newer
      cache is not refetched and downgraded by older code.
- [x] 8.2 Fold the mapping-state rule into `transform_xref_pdb` and name the persisted
      `"True"`/`"False"` vocabulary once, shared by the UniProt and InterPro transforms.
- [x] 8.3 Remove the write-only failure counter and the production-side guard that
      existed only to tolerate bare test doubles, setting the attribute on the mocks.
- [x] 8.4 Share header and row construction between `DataFormatter` and
      `AnnotationWriter`, and add a failing regression proving a later-only annotation
      key is dropped from the in-memory path.
- [x] 8.5 Treat a `NaN` cell as missing in PDB transformation and add a failing
      regression proving it was otherwise read as a PDB hit.
- [x] 8.6 Read the UniProt failure counter outside the broad `except` so a counter
      problem cannot discard a successful fetch.
- [x] 8.7 Run focused, affected, full Python, Ruff, strict OpenSpec, docs/generated,
      and repository precommit verification.

## 9. Migration Scope and Outage Safety Review Follow-up

- [x] 9.1 Add a failing regression proving a run that never surfaces `xref_pdb` still
      pays a full UniProt refetch, and gate the migration on actual consumption.
- [x] 9.2 Add a failing regression proving an unrequested stale `xref_pdb` is carried
      into a cache stamped as current, and drop the column instead of refreshing it.
- [x] 9.3 Extend the migration-failure regression to prove the run's own output is
      blanked, and fall back to the preserved cached UniProt values.
- [x] 9.4 Verify the three PDB states, the migration, the no-refetch gate, and the
      outage fallback end to end on a mixed mapped/unmapped UniProt dataset.
- [x] 9.5 Run focused, affected, full Python, Ruff, strict OpenSpec, docs/generated,
      and repository precommit verification.

## 10. Cache Version Semantics Review Follow-up

- [x] 10.1 Add a failing regression proving a later version entry re-runs the PDB
      refresh for caches already stamped for it and loses the column.
- [x] 10.2 Map each cache version to the columns whose meaning changed at it, derive
      the cache version from that table, and derive the stale columns and the sources
      to refresh from it instead of naming `xref_pdb` in the pipeline.
- [x] 10.3 Verify the unrequested-column drop, the outage fallback, and the taxonomy
      carve-out still hold once they are keyed on the derived stale set.
- [x] 10.4 Run focused, affected, full Python, Ruff, strict OpenSpec, docs/generated,
      and repository precommit verification.
