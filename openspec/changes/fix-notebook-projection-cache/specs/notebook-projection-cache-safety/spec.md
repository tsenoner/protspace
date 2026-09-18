## ADDED Requirements

### Requirement: Preparation notebook Generate actions use current projection inputs

The Preparation notebook SHALL recompute dimensionality-reduction projections on every Generate action and SHALL NOT read cached projection coordinates from an earlier action. This projection refresh SHALL NOT disable compatible caching for other intermediate stages.

#### Scenario: Reducer parameters change between Generate actions

- **WHEN** a user changes a dimensionality-reduction parameter and activates Generate again
- **THEN** the selected reducer runs with the current parameter value
- **AND** the downloaded bundle contains coordinates produced by that run

#### Scenario: Input data changes without changing its logical embedding name

- **WHEN** a user changes the input embeddings while the embedding name, method, and reducer parameters match an earlier Generate action
- **THEN** the reducer runs against the current embedding matrix
- **AND** cached coordinates from the earlier input are not used

#### Scenario: Compatible non-projection intermediates remain reusable

- **WHEN** the notebook requests fresh projections
- **THEN** only the projection stage is explicitly refreshed
- **AND** retained query, embedding, and annotation intermediates remain eligible for reuse when their cache identity matches the current input

### Requirement: Preparation notebook caches are owned by their inputs

The Preparation notebook SHALL partition retained query FASTA files by query text and SHALL publish them only after validated extraction completes. It SHALL partition embedding, annotation, and projection intermediates by the content of the selected input file, and embedding H5 files SHALL additionally be owned by their producing backend and model.

#### Scenario: UniProt query changes between Generate actions

- **WHEN** a user generates from one UniProt query and then selects a different query
- **THEN** the second action SHALL NOT reuse the first query's downloaded FASTA

#### Scenario: Disjoint FASTA input replaces the current input

- **WHEN** a user generates embeddings from one FASTA file and then selects a disjoint FASTA file
- **THEN** the second action SHALL use an embedding cache owned by the second FASTA content
- **AND** the downloaded bundle SHALL NOT contain the union of both inputs

#### Scenario: Sequence changes without changing its identifier

- **WHEN** a FASTA sequence changes while its identifier and selected embedder remain unchanged
- **THEN** the changed FASTA content SHALL select a different embedding cache
- **AND** the sequence SHALL be embedded from its current residues

#### Scenario: Embedding backend changes for the same input and model

- **WHEN** a user generates an embedding with one backend and then selects the other backend for the same input and model
- **THEN** the second backend SHALL use a different embedding H5 cache
- **AND** identifiers produced by the first backend SHALL NOT satisfy the second backend's resume check

#### Scenario: Embedding backend remains unchanged

- **WHEN** a user repeats Generate with the same input, backend, and model
- **THEN** the notebook SHALL select the same embedding H5 cache
- **AND** the backend's existing resume behavior SHALL remain available

#### Scenario: Query FASTA extraction is interrupted

- **WHEN** query FASTA extraction fails after writing part of its output
- **THEN** the query-addressed final cache path SHALL NOT expose those incomplete bytes
- **AND** incomplete temporary output SHALL be removed

#### Scenario: Query FASTA extraction completes

- **WHEN** the downloaded query result is completely extracted
- **THEN** the complete FASTA SHALL be atomically published at the query-addressed cache path
- **AND** the published file SHALL use normal new-file permissions under the process umask
- **AND** a later Generate action for that query MAY reuse it

### Requirement: Annotation cache reuse validates identifiers

The reduction pipeline SHALL reuse a retained annotation cache only when its identifiers include every identifier requested by the current run. The cache MAY contain identifiers outside the current request.

#### Scenario: Requested identifiers are missing from the cache

- **WHEN** a retained annotation cache contains identifiers from an earlier input
- **AND** the current run requests one or more identifiers absent from that cache
- **THEN** annotations SHALL be fetched for the current identifiers
- **AND** incompatible cached rows SHALL NOT be returned as the current metadata

#### Scenario: A source fails while rebuilding for missing identifiers

- **WHEN** a retained annotation cache is rebuilt because requested identifiers are missing from it
- **AND** one annotation source does not complete
- **THEN** the sources that did complete SHALL replace the retained cache
- **AND** the incomplete source's columns SHALL NOT be cached

#### Scenario: Cache contains a superset of requested identifiers

- **WHEN** a retained annotation cache contains every identifier requested by the current run
- **AND** it also contains identifiers outside the current request
- **THEN** the retained cache SHALL remain eligible for reuse
- **AND** a run that reuses it without fetching SHALL leave the larger retained cache unchanged
