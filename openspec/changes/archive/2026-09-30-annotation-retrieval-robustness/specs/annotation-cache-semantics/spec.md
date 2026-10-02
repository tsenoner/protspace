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
InterPro rows, and cannot be repaired locally. The same refresh drops the InterPro-N predictions
that older InterPro values include, which cannot be told apart from member-database matches in a
cached cell.

#### Scenario: A legacy cache is asked for protein families

- **WHEN** a run requests `protein_families` from a cache stamped before the family fix
- **THEN** ProtSpace refetches the UniProt source once and reuses cached values from the other
  sources
- **AND** the rewritten cache is stamped current, so the next run does not refetch

#### Scenario: A legacy cache is asked for an InterPro column

- **WHEN** a run requests `pfam` from a cache stamped before the InterPro fix
- **THEN** ProtSpace refetches the InterPro source once and reuses cached UniProt values

#### Scenario: A legacy cache holds no sequences for the InterPro refresh

- **WHEN** a run requests `pfam` from a cache stamped before the InterPro fix that has no
  `sequence` column
- **THEN** ProtSpace also refetches the UniProt source, so InterPro has sequences to look up

#### Scenario: A legacy cache is not asked for the affected columns

- **WHEN** a run requests neither `protein_families` nor any InterPro column from such a cache
- **THEN** ProtSpace refetches nothing and leaves the stale columns out of the cache it writes

#### Scenario: The refresh fails

- **WHEN** the refetch triggered by a legacy cache loses data
- **THEN** no stale value of that source is written back under a current stamp
- **AND** a later run fetches that source again

### Requirement: Caches written before the root and TMbed fixes are refreshed

ProtSpace SHALL NOT reuse cached `root` or `predicted_transmembrane` values written before the
lineage-root and TMbed-label fixes, which are stamped version 2 or earlier. A run that requests
such a column SHALL refetch its source (taxonomy or Biocentral) once and stamp the rewritten cache
as current. A run that requests neither SHALL drop them from the cache it writes. Cached values
from other sources SHALL be reused. A refresh SHALL refetch every column of the refreshed source
that the cache holds, not only the requested ones, and return only the requested ones. The old
`root` is the deepest unranked clade of the lineage and cannot be recomputed from the cache, and
the old `none` reads as a missing value.

#### Scenario: A version-2 cache is asked for both columns

- **WHEN** a run requests `root`, `predicted_transmembrane` and columns from UniProt, InterPro and
  TED from a cache stamped version 2
- **THEN** ProtSpace refetches taxonomy and Biocentral once each and fetches no other source
- **AND** the rewritten cache is stamped current, so the next run fetches nothing

#### Scenario: Only one of the columns is requested

- **WHEN** a run requests `root` but not `predicted_transmembrane` from such a cache, or the
  other way round
- **THEN** ProtSpace refetches only the source of the requested column

#### Scenario: The cache holds no organism identifiers for the root refresh

- **WHEN** a run requests `root` from a version-2 cache that has no `organism_id` column
- **THEN** ProtSpace also refetches the UniProt source, so taxonomy has organisms to look up

#### Scenario: The cache holds no sequences for the Biocentral refresh

- **WHEN** a run without a FASTA requests `predicted_transmembrane` from a version-2 cache that
  has no `sequence` column
- **THEN** ProtSpace also refetches the UniProt source, so Biocentral has sequences to predict from
- **AND** a FASTA holding every sequence of the run makes the UniProt refetch unnecessary

#### Scenario: The refresh keeps the source's other cached columns

- **WHEN** a run requests `predicted_transmembrane` but no other Biocentral column from a
  version-2 cache that holds `predicted_membrane`
- **THEN** the one Biocentral refetch also refreshes `predicted_membrane`, which stays in the cache
  and out of the run's result
- **AND** a later run that requests `predicted_membrane` fetches nothing

#### Scenario: A run without an annotation selection

- **WHEN** a run that selects no annotations, and so requests the default group, reads a
  version-2 cache holding `root` and `predicted_transmembrane`
- **THEN** ProtSpace fetches neither taxonomy nor Biocentral, and neither stale column is cached
  as current

#### Scenario: A version-2 cache is not asked for the affected columns

- **WHEN** a run requests neither `root` nor `predicted_transmembrane` from such a cache
- **THEN** ProtSpace refetches nothing and leaves both columns out of the cache it writes

#### Scenario: The Biocentral refresh fails

- **WHEN** the Biocentral refetch triggered by a version-2 cache fails
- **THEN** no `none` value is written back under a current stamp, and the cached values of the
  other Biocentral columns are kept
- **AND** a later run fetches Biocentral again

## MODIFIED Requirements

### Requirement: Legacy PDB annotation caches are refreshed safely

ProtSpace SHALL NOT reuse an annotation cache containing `xref_pdb` as authoritative
when that cache lacks the current annotation-semantics marker. It SHALL refetch the
UniProt source once and reuse cached values from other sources, except cached columns
that a later semantics change also marks stale: those are refreshed or dropped as
"Caches written before the family and InterPro fixes are refreshed" says. An unversioned
cache predates every change in the version table, so its `protein_families` and InterPro
columns are among them.

#### Scenario: Complete legacy PDB cache is reused

- **WHEN** an unversioned annotation cache contains `xref_pdb` and every requested
  annotation
- **THEN** ProtSpace refetches the UniProt source and stamps the rewritten cache as
  current

#### Scenario: Legacy cache has unaffected source data

- **WHEN** an unversioned annotation cache contains `xref_pdb` alongside cached values
  of a source no later semantics change affects, such as TED
- **THEN** ProtSpace refetches only the UniProt source and reuses those cached values

#### Scenario: Legacy cache also holds InterPro values

- **WHEN** an unversioned annotation cache contains `xref_pdb` alongside cached
  InterPro values, and the run requests an InterPro column
- **THEN** ProtSpace refetches the InterPro source as well as UniProt, because the
  InterPro fix marks those values stale

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

- **WHEN** an unversioned annotation cache does not contain `xref_pdb`, and the run
  requests neither `protein_families` nor an InterPro column
- **THEN** ProtSpace reuses it without a forced UniProt refresh

#### Scenario: A UniProt batch fails during migration

- **WHEN** a migration-triggered UniProt refresh cannot retrieve one or more batches
- **THEN** ProtSpace writes no stale value under the current marker: it leaves the legacy
  cache as it was, or, when another source finished, writes a current cache without the
  stale columns
- **AND** a subsequent run that requests a stale column retries the migration

### Requirement: An incomplete annotation retrieval never overwrites the cache

ProtSpace SHALL NOT cache annotations from a source whose retrieval did not
complete, unless the run explicitly asked to refetch. Such a source emits empty
values that are indistinguishable from a real absence, so persisting them would
make a later run's column-based completeness check read the cache as current and
serve the gaps instead of refetching. Sources that did complete are still
cached, so one unavailable source does not discard the others' work. Where the
cache already holds current values for the incomplete source's columns, those
values are kept unchanged beside the completed sources, for the proteins the
cache holds them for. An explicit refetch is the documented repair for a cache
already holding such values, so it writes regardless.

#### Scenario: A UniProt batch fails while creating the cache

- **WHEN** a run with `--keep-tmp` and no existing cache loses one or more
  UniProt batches, and every requested annotation comes from UniProt
- **THEN** ProtSpace does not create the annotation cache
- **AND** the run still returns every annotation it did retrieve

#### Scenario: One source fails while another completes

- **WHEN** a run requests annotations from two sources and only one of them
  completes
- **THEN** ProtSpace caches the completed source's columns
- **AND** omits the incomplete source's columns, so the next run fetches only
  that source

#### Scenario: A source fails whose values the cache already holds

- **WHEN** a source loses data, the cache already holds current values for some
  of its columns, and another source fetched in the same run completes
- **THEN** ProtSpace caches the completed source's values
- **AND** keeps the failed source's cached values unchanged, leaving out the
  columns the failed source was to add
- **AND** writes no row for a protein the failed source has no cached value for,
  so the next run fetches it

#### Scenario: The failed source's cached column is stale

- **WHEN** a source loses data and its cached column predates the column's current
  semantics
- **THEN** ProtSpace does not keep that column in any cache it writes, so no stale
  value is stamped current

#### Scenario: A source other than UniProt does not complete

- **WHEN** a taxonomy batch, a TED lookup or a Biocentral prediction fails
- **THEN** ProtSpace treats that source as incomplete for caching, exactly as it
  treats an incomplete UniProt retrieval

#### Scenario: A lost UniProt batch leaves a sequence lookup without a sequence

- **WHEN** UniProt loses a batch, and InterPro or Biocentral is asked for a protein
  that has no sequence from the FASTA or from UniProt
- **THEN** ProtSpace treats that source as incomplete, so its empty value for the
  protein is not cached as "no match"
- **AND** sequences supplied by a FASTA keep the source cacheable

#### Scenario: A Biocentral column is added to a cache without sequences

- **WHEN** a run without a FASTA requests a Biocentral column from a cache that holds no
  `sequence` column
- **THEN** ProtSpace fetches the sequences from UniProt before Biocentral, so Biocentral's empty
  values are never cached for want of a sequence
- **AND** a FASTA holding every sequence of the run makes the UniProt fetch unnecessary

#### Scenario: The standalone annotate command reports an incomplete source

- **WHEN** `protspace annotate` finishes with a source that did not complete
- **THEN** it still writes the requested output file
- **AND** it warns which source was incomplete and that the affected values
  cannot be told apart from a genuine absence

#### Scenario: A UniProt batch fails with a cache already present

- **WHEN** a run with `--keep-tmp` loses one or more UniProt batches and an
  annotation cache already holds UniProt values
- **THEN** ProtSpace leaves those cached UniProt values unchanged, and leaves the
  cache untouched when no other source finished
- **AND** a subsequent run retries the retrieval

#### Scenario: UniProt is unreachable entirely

- **WHEN** a UniProt retrieval raises before producing any rows
- **THEN** ProtSpace caches no UniProt value from that run

#### Scenario: Declining to write is reported

- **WHEN** ProtSpace skips an annotation cache write because a source failed
- **THEN** it warns and names the cache path it left alone

#### Scenario: A complete UniProt retrieval still writes the cache

- **WHEN** a run with `--keep-tmp` retrieves every requested UniProt batch
- **THEN** ProtSpace writes the annotation cache as before

#### Scenario: An explicit refetch clears what it could not replace

- **WHEN** `--refetch annotations` is requested and the retrieval loses batches
- **THEN** ProtSpace rewrites the annotation cache without the failed source's
  columns, rather than leaving the cached values in place
- **AND** the next run fetches that source instead of reading the values the
  refetch was asked to replace

#### Scenario: A source fetched one request per protein is retried sparingly

- **WHEN** a source is fetched with one request per protein rather than in
  batches
- **THEN** ProtSpace retries each request with a smaller budget, so a full
  outage does not pay the default backoff once per protein

#### Scenario: A transient HTTP failure is retried before it counts as a loss

- **WHEN** a request to an annotation API times out, cannot connect, or returns
  a retryable status
- **THEN** ProtSpace retries it with backoff up to a bounded number of attempts
- **AND** only a request still failing after those attempts counts as lost data
