# annotation-cache-semantics Specification

## Purpose

How cached annotation results stay correct across format and schema changes: refreshing caches written by an older layout rather than trusting them, and keeping repeated reads of a cached value idempotent.

## Requirements

### Requirement: Legacy PDB annotation caches are refreshed safely

ProtSpace SHALL NOT reuse an annotation cache containing `xref_pdb` as authoritative
when that cache lacks the current annotation-semantics marker. It SHALL refetch the
UniProt source once and reuse cached values from other sources.

#### Scenario: Complete legacy PDB cache is reused

- **WHEN** an unversioned annotation cache contains `xref_pdb` and every requested
  annotation
- **THEN** ProtSpace refetches the UniProt source and stamps the rewritten cache as
  current

#### Scenario: Legacy cache has unaffected source data

- **WHEN** an unversioned annotation cache contains `xref_pdb` alongside cached
  InterPro values
- **THEN** ProtSpace refetches only the UniProt source and reuses the cached InterPro
  values

#### Scenario: Legacy cache is missing a newly requested source

- **WHEN** an unversioned annotation cache contains `xref_pdb` and a run requests an
  annotation from a source the cache lacks
- **THEN** ProtSpace fetches that source in addition to refreshing UniProt

#### Scenario: Cached taxonomy depends on the UniProt organism identifier

- **WHEN** an unversioned annotation cache contains `xref_pdb` and cached taxonomy
  values, and the run requests taxonomy
- **THEN** ProtSpace keeps the cached organism identifier available to the taxonomy
  lookup

#### Scenario: An unresolved protein precedes a taxonomy-bearing protein

- **WHEN** the first cached row has no taxonomy values and a later row does
- **THEN** ProtSpace still reuses the cached taxonomy for the rows that carry it

#### Scenario: Legacy cache has no PDB annotation

- **WHEN** an unversioned annotation cache does not contain `xref_pdb`
- **THEN** ProtSpace reuses it without a forced UniProt refresh

#### Scenario: A UniProt batch fails during migration

- **WHEN** a migration-triggered UniProt refresh cannot retrieve one or more batches
- **THEN** ProtSpace does not mark the legacy cache as current, so a subsequent run
  retries the migration

### Requirement: Cached signal-peptide booleans are idempotent

ProtSpace SHALL preserve exact canonical `True` and `False` signal-peptide values when
cached InterPro annotations pass through the shared transformer again.

#### Scenario: UniProt is refetched with cached InterPro values

- **WHEN** a run refetches UniProt while retaining cached `signal_peptide` values
  containing `True` and `False`
- **THEN** ProtSpace emits the same `True` and `False` values unchanged

### Requirement: An incomplete annotation retrieval never overwrites the cache

ProtSpace SHALL NOT write the annotation cache when a retrieval did not complete,
unless the run explicitly asked to refetch. A failed batch yields the full
annotation schema with empty values, so persisting it would make a later run's
column-based completeness check read the cache as current and serve those empty
values instead of refetching. An explicit refetch is the documented repair for a
cache already holding such values, so it writes regardless.

#### Scenario: A UniProt batch fails while creating the cache

- **WHEN** a run with `--keep-tmp` and no existing cache loses one or more
  UniProt batches
- **THEN** ProtSpace does not create the annotation cache
- **AND** the run still returns every annotation it did retrieve

#### Scenario: A UniProt batch fails with a cache already present

- **WHEN** a run with `--keep-tmp` loses one or more UniProt batches and an
  annotation cache already exists
- **THEN** ProtSpace leaves the existing cache unchanged
- **AND** a subsequent run retries the retrieval

#### Scenario: UniProt is unreachable entirely

- **WHEN** a UniProt retrieval raises before producing any rows
- **THEN** ProtSpace does not write the annotation cache

#### Scenario: Declining to write is reported

- **WHEN** ProtSpace skips an annotation cache write because UniProt retrieval
  failed
- **THEN** it warns and names the cache path it left alone

#### Scenario: A complete UniProt retrieval still writes the cache

- **WHEN** a run with `--keep-tmp` retrieves every requested UniProt batch
- **THEN** ProtSpace writes the annotation cache as before

#### Scenario: An explicit refetch rewrites the cache regardless

- **WHEN** `--refetch annotations` is requested and the retrieval loses batches
- **THEN** ProtSpace still writes the annotation cache
- **AND** a cache already holding empty values is replaced by what this run
  recovered

#### Scenario: A transient HTTP failure is retried before it counts as a loss

- **WHEN** a request to an annotation API times out, cannot connect, or returns
  a retryable status
- **THEN** ProtSpace retries it with backoff up to a bounded number of attempts
- **AND** only a request still failing after those attempts counts as lost data
