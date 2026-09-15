## ADDED Requirements

### Requirement: Legacy PDB annotation caches are refreshed safely

ProtSpace SHALL NOT reuse an annotation cache containing `xref_pdb` as authoritative
when that cache lacks the current annotation-semantics marker. It SHALL refetch the
UniProt source because persisted positive values are ambiguous, preserve cached values
from unaffected sources, and mark the transformed replacement cache as current.

#### Scenario: Complete legacy PDB cache is reused

- **WHEN** `all_annotations.parquet` contains every requested annotation including
  `xref_pdb` but lacks the current annotation-cache version
- **THEN** ProtSpace refetches the UniProt annotations instead of returning the cache
  fast path
- **AND** the rewritten cache carries the current annotation-cache version

#### Scenario: Legacy cache has unaffected source data

- **WHEN** a legacy PDB cache also contains cached annotations from another source
- **THEN** ProtSpace preserves those unaffected source columns while refreshing the
  UniProt columns

#### Scenario: Legacy cache is missing a newly requested source

- **WHEN** a legacy PDB cache lacks a requested annotation owned by a non-UniProt source
- **THEN** ProtSpace fetches that missing source in addition to refreshing UniProt
- **AND** the requested annotation is present in the current run's output

#### Scenario: Cached taxonomy depends on the UniProt organism identifier

- **WHEN** a legacy PDB cache contains taxonomy annotations and their cached
  `organism_id` lookup key, and taxonomy is not being refetched
- **THEN** ProtSpace retains the lookup key long enough to rehydrate the cached taxonomy
- **AND** merges that taxonomy against the freshly fetched UniProt annotations
- **AND** subsequent reuse of the migrated cache preserves the taxonomy without another
  migration refresh

#### Scenario: An unresolved protein precedes a taxonomy-bearing protein

- **WHEN** an unresolved protein without taxonomy keys is the first migrated record and
  a later resolved protein has a cached taxonomy annotation
- **THEN** the rewritten Parquet schema includes that later taxonomy annotation
- **AND** subsequent reuse of the migrated cache preserves its values

#### Scenario: Legacy cache has no PDB annotation

- **WHEN** an unversioned annotation cache does not contain `xref_pdb`
- **THEN** ProtSpace applies the existing incremental-cache rules without forcing a
  UniProt refresh for this migration

#### Scenario: A UniProt batch fails during migration

- **WHEN** a migration-triggered UniProt refresh cannot retrieve one or more batches
- **THEN** ProtSpace does not replace the legacy cache or mark it as current
- **AND** a subsequent run retries the migration

### Requirement: Cached signal-peptide booleans are idempotent

ProtSpace SHALL preserve exact canonical `True` and `False` signal-peptide values when
cached InterPro annotations pass through the shared transformer again.

#### Scenario: UniProt is refetched with cached InterPro values

- **WHEN** a run refetches UniProt while retaining cached `signal_peptide` values
  containing `True` and `False`
- **THEN** ProtSpace emits the same `True` and `False` values unchanged
