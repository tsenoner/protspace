## ADDED Requirements

### Requirement: A cached projection belongs to the data it was computed from

Cached projection coordinates SHALL be reused only when the embedding matrix and
its identifier order are the same as the run that produced them, in addition to
the existing method, dimension count, and reducer parameters. The logical
embedding name is not evidence of data identity: a resumed embedding cache, a
re-embedded input, a different intersection, or a reordered input all keep the
name while changing the matrix.

#### Scenario: Input data changes without changing its logical embedding name

- **WHEN** an embedding set carries the same name, method, and reducer parameters as an earlier run but a different matrix
- **THEN** the reducer runs against the current matrix
- **AND** the earlier coordinates are not reused

#### Scenario: The same proteins arrive in a different order

- **WHEN** an embedding set holds the same matrix rows as an earlier run under a different identifier order
- **THEN** the reducer runs again rather than pairing the cached coordinates with the reordered identifiers

#### Scenario: An input grows between runs

- **WHEN** proteins are added to an input that keeps its embedding name
- **THEN** the projection is recomputed for every protein in the current run
- **AND** no projection is emitted whose row count differs from the current identifier count

#### Scenario: Nothing about the input changed

- **WHEN** a run repeats with the same matrix, identifier order, method, dimensions, and parameters
- **THEN** the cached coordinates are reused without running the reducer

#### Scenario: Projections are explicitly refreshed

- **WHEN** a run requests the `projections` refetch stage
- **THEN** cached coordinates are ignored regardless of data identity

### Requirement: An embedding cache is owned by the backend and model that produced it

An embedding HDF5 SHALL record the backend and resolved model that produced it,
and a run SHALL refuse to resume from a file another producer wrote. Both
backends resume by identifier alone, so without this a Local-produced vector
satisfies a Biocentral run's resume check and the two are silently mixed in one
dataset.

#### Scenario: A different backend resumes from the same file

- **WHEN** a run embeds into an HDF5 recorded as produced by the other backend
- **THEN** the run fails with an error naming the file, the recorded producer, and the remedies (select that backend, choose another output, or refetch the embeddings)
- **AND** the existing file is left untouched rather than extended or deleted

#### Scenario: The same producer resumes

- **WHEN** a run embeds into an HDF5 recorded as produced by the same backend and model
- **THEN** the existing identifiers are reused and only outstanding sequences are embedded

#### Scenario: A file predates producer tracking

- **WHEN** a run resumes from an HDF5 that records no producer
- **THEN** the run adopts the file, records the current producer, and reports that it did so

### Requirement: A cached embedding belongs to the sequence it was computed from

An embedding HDF5 SHALL record, per protein, a digest of the residues the vector
was computed from, and a run SHALL re-embed a protein whose current residues
differ from that digest. Resume matches on identifier alone, so an identifier
whose sequence changed otherwise keeps a vector of the previous residues.

#### Scenario: A sequence changes while its identifier does not

- **WHEN** a run embeds a FASTA whose residues for an already-embedded identifier changed
- **THEN** that protein is embedded again and its stored vector and digest are replaced
- **AND** proteins whose residues are unchanged are not embedded again

#### Scenario: A protein predates sequence digests

- **WHEN** a stored protein carries no residue digest
- **THEN** it is reused as before and the run does not fail

### Requirement: An embedding load returns only the proteins that were requested

Embedding a FASTA SHALL return only that FASTA's proteins, even when the
embedding cache holds more. A cache shared by successive inputs accumulates
every protein it has ever embedded, and returning the accumulation silently
unions unrelated datasets into one bundle.

#### Scenario: A disjoint input reuses the same embedding cache

- **WHEN** a FASTA is embedded into a cache that already holds a disjoint input's proteins
- **THEN** the returned embedding set holds only the current FASTA's proteins
- **AND** the retained cache keeps the proteins it already had

### Requirement: A retained query FASTA is owned by its query text

A retained query FASTA SHALL be addressed by the query that produced it, for
every caller that retains one. A single shared file name reuses one query's
sequences for a different query whenever both write to the same output
directory.

#### Scenario: A second query reuses the same output directory

- **WHEN** a run downloads sequences for one query and a later run requests a different query with the same retained cache directory
- **THEN** the second run downloads its own sequences instead of reusing the first query's FASTA

#### Scenario: The same query runs again

- **WHEN** a run repeats a query whose retained FASTA is present and complete
- **THEN** the retained FASTA is reused without downloading it again

### Requirement: Annotation reuse is decided per identifier and per source

Annotation retrieval SHALL fetch a source only for the identifiers whose values
the retained cache cannot supply, and SHALL reuse cached values for the rest.
Requesting annotations for identifiers a cache does not hold is the routine
"added sequences to an existing run" case, and re-fetching every source for
every identifier can cost hours at Swiss-Prot scale.

#### Scenario: The cache covers some of the requested identifiers

- **WHEN** a run requests annotations for identifiers the retained cache only partly covers
- **THEN** each source is fetched only for the identifiers missing from the cache
- **AND** cached values supply the identifiers the cache already holds
- **AND** the returned annotations cover every requested identifier

#### Scenario: Taxonomy is reused for organisms already cached

- **WHEN** identifiers missing from the cache resolve to organisms the cached taxonomy already covers
- **THEN** no taxonomy lookup is made for those organisms
- **AND** organisms the cache does not cover are looked up

#### Scenario: The cache holds none of the requested identifiers

- **WHEN** a retained cache describes an entirely different input
- **THEN** every source is fetched for the current identifiers
- **AND** the cached rows are not returned as the current run's annotations

#### Scenario: A cached superset survives a run that fetches

- **WHEN** a run fetches annotations for identifiers missing from a cache that also holds identifiers outside the request
- **AND** the run's columns are the columns the cache already holds
- **THEN** the retained cache keeps its other identifiers' rows alongside the newly fetched ones

#### Scenario: A source fails while filling in missing identifiers

- **WHEN** a source does not complete for the identifiers being filled in
- **THEN** that source's columns are not written to the cache as empty values for those identifiers
- **AND** the run still returns everything it did retrieve
