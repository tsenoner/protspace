## ADDED Requirements

### Requirement: Inactive UniProt entries are resolved per batch, not per entry

UniProt retrieval SHALL resolve the inactive entries of a batch (accessions the batch endpoint
does not return) with at most three requests per batch, plus pagination: one search for the
inactive entries' records, one fetch of the active entries they were merged into, and one UniParc
search for the sequences of the deleted ones. An accession these requests leave unsettled SHALL be
resolved one by one, as before. Every accession SHALL receive the same values, and count as
merged or deleted the same way, as when every inactive entry was resolved one by one. Resolving
each entry with its own two requests made the 5,015-protein snake toxin example spend about 20
minutes on annotations.

#### Scenario: A batch holds deleted and merged entries

- **WHEN** a batch's accessions include deleted entries with a UniParc id and entries merged into
  active entries
- **THEN** the batch's inactive entries cost one search, one fetch of the merge targets and one
  UniParc search
- **AND** each merged accession carries its target's values and each deleted accession its UniParc
  sequence and length, with every other value empty

#### Scenario: The bulk requests leave an accession unsettled

- **WHEN** the search does not return an accession, or a merge target is not returned as active,
  or a deleted entry's UniParc id is not returned
- **THEN** that accession alone is resolved one by one, with the same result as before

#### Scenario: A bulk request fails

- **WHEN** one of the bulk requests raises after its attempts
- **THEN** the accessions it was to settle are resolved one by one, and none of them is lost

#### Scenario: The bulk requests share the session

- **WHEN** the bulk requests are sent
- **THEN** they go through the fetch's one session, one at a time, honouring a `Retry-After` on it
- **AND** the release header of each response is recorded
