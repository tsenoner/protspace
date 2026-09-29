## ADDED Requirements

### Requirement: InterPro annotations reach every protein that shares a sequence

InterPro retrieval SHALL give every requested protein the matches of its own sequence, including
when several proteins have an identical sequence. InterPro is queried by sequence MD5, so identical
sequences are one lookup. Keeping one identifier per MD5 leaves the others empty, and an empty value
cannot be told apart from "no InterPro match". Shipped data lost InterPro for 88,238 Swiss-Prot
rows this way.

#### Scenario: Two proteins have the same sequence

- **WHEN** two requested proteins have identical sequences and InterPro reports matches for that
  sequence
- **THEN** both proteins receive the same InterPro values
- **AND** the MD5 is submitted to InterPro once

#### Scenario: A duplicated sequence has no InterPro match

- **WHEN** several requested proteins share a sequence that InterPro does not know
- **THEN** each of them has empty InterPro values, exactly as a single unmatched protein does

#### Scenario: Unique sequences are unaffected

- **WHEN** every requested protein has a distinct sequence
- **THEN** each protein receives the matches of its own sequence, as before

### Requirement: An InterPro match request is retried before its batch counts as lost

InterPro retrieval SHALL retry a match request that times out, cannot connect, drops its
connection mid-body, or returns a retryable status (408, 425, 429 or 5xx), using the same
backoff, `Retry-After` handling and attempt budget as the other batched annotation requests. Only a
request that still fails after those attempts SHALL count as a lost batch. A lost batch makes the
whole InterPro source incomplete and uncached, so one unretried timeout among thousands of batches
costs a full refetch on the next run.

#### Scenario: A transient failure recovers

- **WHEN** an InterPro match request first returns 503 and then succeeds
- **THEN** the batch's matches are used
- **AND** the InterPro source counts as complete

#### Scenario: The server asks the client to wait

- **WHEN** an InterPro match request returns 429 with a `Retry-After` header
- **THEN** the retry waits as long as the header asks, capped at the shared maximum backoff

#### Scenario: A client error is not retried

- **WHEN** an InterPro match request returns a non-retryable 4xx status
- **THEN** it is not retried and its batch counts as lost

#### Scenario: Retries are exhausted

- **WHEN** an InterPro match request fails on every attempt
- **THEN** its batch counts as lost, the InterPro source is incomplete, and the other batches'
  matches are still returned

### Requirement: Biocentral predictions are requested in bounded batches

Biocentral prediction SHALL submit unique sequences in batches of at most 1,000 per prediction
request, after removing duplicate sequences and before fanning predictions back out to every
protein that shares a sequence. Sending every sequence in one request is untested beyond a few
thousand sequences, and an example-scale run would be one request of 100,000 to 485,000
sequences.

#### Scenario: More sequences than one batch holds

- **WHEN** predictions are requested for 2,500 unique sequences
- **THEN** three prediction requests are made, none carrying more than 1,000 sequences
- **AND** every protein receives the predictions for its sequence

#### Scenario: Duplicates span the input

- **WHEN** several proteins share a sequence
- **THEN** that sequence is submitted once in total
- **AND** every protein that shares it receives its predictions

#### Scenario: A very long sequence is included

- **WHEN** a requested sequence is longer than 2,000 residues
- **THEN** it is submitted like any other sequence
- **AND** its length alone never makes the source fail

### Requirement: A failed Biocentral batch loses only its own proteins

Biocentral prediction SHALL keep the predictions of every batch that succeeded when another
batch fails, and SHALL mark the source incomplete so its columns are not cached. The shortfall
SHALL be reported once on stderr at warning level, giving how many proteins lack predictions and
how many batches failed. That report SHALL contain none of the substrings the prep service
matches to classify a failure as `BIOCENTRAL_UNAVAILABLE`: a coverage shortfall must not read as
a service outage.

#### Scenario: One of several batches fails

- **WHEN** one prediction batch raises and the other batches succeed
- **THEN** proteins in the successful batches receive their predictions
- **AND** proteins in the failed batch have empty prediction values
- **AND** the Biocentral source is incomplete, so its columns are not cached

#### Scenario: The standalone command still succeeds

- **WHEN** `protspace annotate` finishes after a Biocentral batch failed
- **THEN** it writes its output and exits zero, warning that Biocentral was incomplete

#### Scenario: The shortfall report cannot be mistaken for an outage

- **WHEN** the shortfall report is emitted
- **THEN** it is written to stderr at warning level
- **AND** it contains none of the prep service's `BIOCENTRAL_UNAVAILABLE` substrings

### Requirement: A failed TED lookup is retried after every other accession

TED retrieval SHALL look up again, after the first pass over all accessions, every accession
whose lookup failed in that pass, using the default attempt budget. Only lookups still failing
after this final pass SHALL make the TED source incomplete. TED is one request per accession, 18
to 40 hours at Swiss-Prot scale, so without this a single lookup that fails its small
first-pass budget discards the whole source.

#### Scenario: A lookup fails during a brief outage

- **WHEN** a TED lookup fails in the first pass and succeeds in the final pass
- **THEN** its domains are used
- **AND** the TED source counts as complete and is cached

#### Scenario: A lookup keeps failing

- **WHEN** a TED lookup fails in both the first and the final pass
- **THEN** the TED source is incomplete and is not cached
- **AND** a warning states how many lookups were recovered and how many are still lost, naming
  the first few accessions

#### Scenario: The service stays down

- **WHEN** consecutive lookups in the final pass keep failing
- **THEN** the final pass stops after a bounded number of consecutive failures and counts every
  remaining accession as failed, rather than paying the full backoff once per accession

#### Scenario: An accession AlphaFold does not know

- **WHEN** a TED lookup returns 404
- **THEN** the accession has no domains, is not retried in the final pass, and does not count as
  failed

#### Scenario: The first pass keeps its small budget

- **WHEN** the first pass looks up an accession
- **THEN** it uses the small per-protein attempt budget, so a full outage does not multiply the
  default backoff by the number of proteins
