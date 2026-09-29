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
connection mid-body, or returns a retryable status (408, 425, 429, 500, 502, 503 or 504), using
the same backoff, `Retry-After` handling and attempt budget as the other batched annotation
requests. Only a request that still fails after those attempts SHALL count as a lost batch. A lost
batch makes the whole InterPro source incomplete and uncached, so one unretried timeout among
thousands of batches costs a full refetch on the next run. After 10 batches in a row are lost,
counted in the order the batches were submitted, InterPro retrieval SHALL start no further batch
and SHALL count every batch whose matches it has not used as lost: each lost batch costs its full
retry budget, and asking thousands more during an outage adds hours without saving the source.

#### Scenario: A transient failure recovers

- **WHEN** an InterPro match request first returns 503 and then succeeds
- **THEN** the batch's matches are used
- **AND** the InterPro source counts as complete

#### Scenario: The server asks the client to wait

- **WHEN** an InterPro match request returns 429 with a `Retry-After` header
- **THEN** the retry waits as long as the header asks, capped at the shared maximum backoff

#### Scenario: A client error is not retried

- **WHEN** an InterPro match request returns a status outside the retryable set, such as a
  non-retryable 4xx or a 501
- **THEN** it is not retried and its batch counts as lost

#### Scenario: Retries are exhausted

- **WHEN** an InterPro match request fails on every attempt
- **THEN** its batch counts as lost, the InterPro source is incomplete, and the other batches'
  matches are still returned

#### Scenario: The service stays down

- **WHEN** 10 InterPro match batches in a row are lost after their retries
- **THEN** no further batch is started, and every remaining batch counts as lost
- **AND** one error states how many batches were not used

#### Scenario: The service comes back

- **WHEN** a batch is answered after fewer than 10 lost batches in a row
- **THEN** the count of lost batches in a row starts again from zero

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
after this final pass SHALL make the TED source incomplete. TED is one request per accession,
over half a million at Swiss-Prot scale, so without this a single lookup that fails its small
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

### Requirement: InterPro columns hold member-database matches only

InterPro retrieval SHALL leave out every match whose source is InterPro-N, so that each InterPro
column holds only the matches its member database made. The InterPro Matches API returns
InterPro-N's AI-predicted matches under the name of the member library they predict, without a
signature name or a match-level score. Mapped by library, they became unscored hits for about 3 %
of Swiss-Prot proteins in `pfam`, in columns the annotation registry describes as reference
annotations rather than predictions.

#### Scenario: A signature only InterPro-N predicts

- **WHEN** InterPro returns a Pfam signature for a protein only as an InterPro-N match
- **THEN** that protein's `pfam` value does not contain the signature

#### Scenario: A member-database match has an InterPro-N twin

- **WHEN** InterPro returns the same signature for a protein both from its member database and
  from InterPro-N
- **THEN** the value lists the signature once, with the member database's score

#### Scenario: A match names no source

- **WHEN** a match in the response has no `source` field
- **THEN** it is treated as a member-database match and kept

### Requirement: Annotation lookups reuse connections and run a bounded number at a time

TED and InterPro retrieval SHALL send their requests over one reused connection pool per source,
with at most 8 TED lookups and 4 InterPro match batches in flight by default, and SHALL produce
the same values, in the same order and with the same failure counts, as sending one request at a
time. UniProt retrieval SHALL send all its requests over one reused connection pool, one at a
time. A request that is slow to finish SHALL NOT stop the other requests of its source from being
sent while it runs, and once a pass stops early no request of it SHALL be attempted again. A new
connection per request and one request at a time made TED take about 23 hours and InterPro about 4
at Swiss-Prot scale; the measured parallel rates bring each to about 1.5 hours without a 429 or
5xx from either service.

#### Scenario: Parallel results match sequential ones

- **WHEN** the same TED accessions or InterPro batches are fetched once with one request at a
  time and once with the default concurrency, and the responses arrive in a different order
- **THEN** every protein receives the same values, the results keep the input order, and the
  same lookups and batches count as failed

#### Scenario: The defaults stay polite

- **WHEN** a run fetches TED and InterPro without overriding the limits
- **THEN** no more than 8 TED lookups and 4 InterPro batches are in flight at any time

#### Scenario: The server asks for a pause

- **WHEN** any TED, InterPro or UniProt request, a single-attempt UniProt lookup included,
  receives a retryable status with a `Retry-After` header
- **THEN** no request of that source is attempted before that time, capped at the shared maximum
  backoff, even by a request that was already waiting out an earlier, shorter pause

#### Scenario: One request is slow

- **WHEN** one TED lookup or InterPro batch takes far longer than the others, such as a lookup
  that times out
- **THEN** the other requests go on being sent while it runs: every other TED first-pass lookup,
  and up to 64 per concurrent request ahead of it in the passes whose results are used in input
  order (the TED final pass and InterPro)

#### Scenario: A service goes down during a parallel pass

- **WHEN** TED final-pass lookups or InterPro batches fail 10 in a row, counted in input order
- **THEN** no request is started beyond those already submitted, at most 64 per concurrent
  request ahead of the last result used
- **AND** a request still retrying makes no further attempt, so the fetch ends once the attempts
  in flight end

#### Scenario: The fetch is interrupted

- **WHEN** a TED or InterPro fetch is interrupted
- **THEN** no queued request is started and no request in flight is attempted again, and the
  process stops once the attempts in flight end

#### Scenario: UniProt reuses its connection

- **WHEN** UniProt retrieval fetches batches, resolves inactive entries, reads UniParc and
  searches secondary accessions
- **THEN** every request goes through one session, one at a time
- **AND** the release header of every response is still recorded
