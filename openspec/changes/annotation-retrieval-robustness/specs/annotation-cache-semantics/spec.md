## ADDED Requirements

### Requirement: Each fetched annotation source is persisted as soon as it finishes

ProtSpace SHALL write the annotation cache after each annotation source fetched in a run finishes,
before it fetches the next source. Each such checkpoint SHALL follow the same rules as the final
cache write: incomplete sources and their dependents are left out, protected cached columns are
kept, and cached rows outside the run are retained when the columns match. Sources finish hours
apart at Swiss-Prot scale, and a single write at the end throws away every finished source when a
later one crashes.

#### Scenario: The run is interrupted during a later source

- **WHEN** a run with `--keep-tmp` fetches UniProt and InterPro and is then interrupted while
  fetching TED
- **THEN** the cache holds the UniProt and InterPro columns
- **AND** the next identical run fetches only TED

#### Scenario: A later source does not complete

- **WHEN** UniProt completes and a later source in the same run loses data
- **THEN** the cache written after UniProt keeps its UniProt columns
- **AND** the incomplete source's columns are not written

#### Scenario: A source is due to be fetched but has not run yet

- **WHEN** a checkpoint is written while a source that already has cached columns is still
  waiting to be fetched in this run
- **THEN** the checkpoint keeps that source's cached columns unchanged

#### Scenario: Proteins are being filled in

- **WHEN** a run fills in proteins the cache does not hold, and a checkpoint is written before
  every source has been fetched for them
- **THEN** the checkpoint holds no row for those proteins
- **AND** their rows are written once every column in the cache has a retrieved value for them

#### Scenario: Nothing is fetched

- **WHEN** every requested annotation is served from the cache
- **THEN** no checkpoint is written

#### Scenario: Caching is off

- **WHEN** a run uses `--no-keep-tmp`, or `annotate` runs without `--cache-dir`
- **THEN** no cache file is written at any point

### Requirement: The annotate command resumes from a cache directory

`protspace annotate` SHALL accept `--cache-dir DIR` and, when given it, read and write the same
annotation cache as `prepare`, at `DIR/all_annotations.parquet`, applying the same reuse, fill-in,
legacy-refresh and incomplete-source rules. It SHALL accept `--refetch` with the annotation
stages `uniprot`, `taxonomy`, `interpro`, `ted`, `biocentral` and the shorthand `annotations`,
and SHALL reject `--refetch` without `--cache-dir`. Without `--cache-dir` the command SHALL
behave as it did before, reading and writing no cache. The hosted prep service relies on that.

#### Scenario: An interrupted annotate run is repeated

- **WHEN** `protspace annotate --cache-dir DIR` is interrupted after some sources finished and
  is run again with the same arguments
- **THEN** the finished sources are read from `DIR` and only the remaining sources are fetched
- **AND** the output file equals what one uninterrupted run would have written

#### Scenario: annotate reuses a prepare cache

- **WHEN** `protspace annotate --cache-dir OUT/tmp` requests annotations that a previous
  `protspace prepare -o OUT` run cached for the same proteins
- **THEN** no annotation API is called

#### Scenario: A source is refetched explicitly

- **WHEN** `protspace annotate --cache-dir DIR --refetch interpro` runs against a cache that
  already holds InterPro columns
- **THEN** InterPro is fetched again and the cache is rewritten with the new values

#### Scenario: Refetch without a cache

- **WHEN** `protspace annotate --refetch uniprot` runs without `--cache-dir`
- **THEN** the command fails with a usage error before any API is called

#### Scenario: No cache directory is given

- **WHEN** `protspace annotate` runs without `--cache-dir`
- **THEN** it fetches every requested source, writes only its output file, and creates no cache

#### Scenario: The output file never carries internal columns by accident

- **WHEN** `protspace annotate --cache-dir DIR` writes its output from a cache that holds
  `organism_id` and `sequence`
- **THEN** the output contains those columns only if the user requested them by name

### Requirement: Caches written before the family and InterPro fixes are refreshed

ProtSpace SHALL NOT reuse cached `protein_families` or InterPro values written before the
family-name parsing and the InterPro duplicate-sequence fixes. A run that requests such a column
SHALL refetch its source once and stamp the rewritten cache as current. A run that does not
request it SHALL drop it from the cache it writes. Cached values from other sources SHALL be
reused. The old values are wrong for about 2 % of Swiss-Prot families and 15 % of Swiss-Prot
InterPro rows, and cannot be repaired locally.

#### Scenario: A legacy cache is asked for protein families

- **WHEN** a run requests `protein_families` from a cache stamped before the family fix
- **THEN** ProtSpace refetches the UniProt source once and reuses cached values from the other
  sources
- **AND** the rewritten cache is stamped current, so the next run does not refetch

#### Scenario: A legacy cache is asked for an InterPro column

- **WHEN** a run requests `pfam` from a cache stamped before the InterPro fix
- **THEN** ProtSpace refetches the InterPro source once and reuses cached UniProt values

#### Scenario: A legacy cache is not asked for the affected columns

- **WHEN** a run requests neither `protein_families` nor any InterPro column from such a cache
- **THEN** ProtSpace refetches nothing and leaves the stale columns out of the cache it writes

#### Scenario: The refresh fails

- **WHEN** the refetch triggered by a legacy cache loses data
- **THEN** no stale value of that source is written back under a current stamp
- **AND** a later run fetches that source again
