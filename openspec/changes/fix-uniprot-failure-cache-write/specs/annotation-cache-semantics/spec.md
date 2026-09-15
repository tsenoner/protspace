## ADDED Requirements

### Requirement: A failed UniProt retrieval never overwrites the annotation cache

ProtSpace SHALL NOT write the annotation cache when a UniProt retrieval did not
complete, whether it failed wholesale or lost individual batches. A failed batch
yields the full annotation schema with empty values, so persisting it would make
a later run's column-based completeness check read the cache as current and
serve those empty values instead of refetching.

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
