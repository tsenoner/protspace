## Context

Annotation retrieval runs in `ProteinAnnotationManager.to_pd()`. It fetches UniProt, taxonomy,
InterPro, TED and Biocentral in that order, merges and transforms the results, and writes
`{output}/tmp/all_annotations.parquet` once, in `_write_cache_and_frame`. Whether and what to
fetch is decided one level up, in `ReductionPipeline._fetch_annotations`, which holds the
cache-read logic: fill-in per identifier (PR #404), the legacy TED-label rewrite, the stale-column
refresh driven by `CACHE_SEMANTICS_CHANGES`, and `--refetch`. `protspace annotate` builds the
manager directly with `output_path=None`, so it never reads or writes a cache. The hosted prep
service calls `annotate` exactly that way, with the `default` annotation group.

Each source reports "did not complete" to the manager through one counter or flag:
`UniProtRetriever.failed_batch_count`, `TaxonomyRetriever.failed_batch_count`,
`InterProRetriever.failed_batch_count`, `TedRetriever.failed_lookup_count` and
`BiocentralPredictionRetriever.prediction_failed`. A source that did not complete is kept out of
the cache (spec `annotation-cache-semantics`, "An incomplete annotation retrieval never overwrites
the cache"). That spec also says a transient HTTP failure is retried before it counts as a loss.
Every GET honours this through `http_utils.get_with_retry`. The InterPro POST does not.

The embed completeness contract (`embed-completeness` spec, `data/embedding/store.py`) sets how
coverage problems are reported: `expected = requested − skipped`, never a hard failure for a long
sequence, skip messages on stderr at warning level, and none of the substrings in
`apps/prep/src/protspace_prep/pipeline.py:_BIOCENTRAL_DOWN_PATTERNS`. Biocentral predictions
follow the same reporting rules.

The work runs as three parallel tracks on one branch, plus an integration step. See "Track
partition" below.

## Goals / Non-Goals

**Goals:**

- No silent data loss:
  - every protein that shares a sequence gets its InterPro values;
  - family names are never truncated;
  - a bundle carries only annotation columns.
- A long annotation run survives a late failure: finished sources stay cached, TED retries its
  failed lookups before giving up, and `annotate` can resume.
- Each run records the UniProt release its annotations came from.
- Caches written by the buggy code are refreshed, not reused.
- `annotate` without `--cache-dir` behaves exactly as today, because the prep service depends on
  it.

**Non-Goals:**

- Checkpoints _within_ a source, such as a TED journal that resumes a crashed 20-hour TED pass
  halfway through. The final retry pass covers transient failures; a killed process still redoes
  that one source. Candidate follow-up.
- Per-identifier retrieval provenance: recording which proteins a source actually covered, so an
  incomplete source could cache the proteins it did retrieve. This changes the cache contract
  every source relies on.
- Recording the release of the `-q` query download, the taxonomy API, InterPro or AlphaFold DB.
  `uniprot_release:` is the UniProtKB release of the annotation data.
- Provenance inside the bundle, as key-value metadata on the annotations table (critique G15).
- Hiding `organism_id`/`sequence` in the web app for bundles that already carry them. The
  example rebuild replaces those bundles.
- The faithfulness ceiling (PR #452), `prepare --embeddings uniprot`, the `manhattan` row in the
  docs' metric table, and the first-input-only `proteins:` count in `run.log`. All were noticed
  during the research and are left to their own changes.

## Decisions

### InterPro fans matches out per sequence

`fetch_annotations` builds `md5 → [identifiers]`, the same shape
`biocentral_retriever.py:121-129` and the embedder already use. It still submits each distinct
MD5 once. `_parse_interpro_results` creates a row for every identifier in each group and gives it
the group's parsed values. A group whose sequence InterPro does not know (`found: false`) stays
empty for all of its identifiers, as a single protein does today. Identifiers without a sequence
keep today's behaviour.

_Alternative, dedupe identifiers upstream in the manager:_ rejected. The retriever is where MD5s
are computed, and every caller of the retriever would otherwise have to remember to dedupe.

### InterPro POSTs use the shared retry policy

`http_utils` gains `post_with_retry(url, json, timeout, attempts)`. It has the same policy as
`get_with_retry`:

- 4 attempts, exponential backoff capped at 30 s, `Retry-After` honoured;
- timeouts, connection errors, `ChunkedEncodingError` and the statuses in `RETRYABLE_STATUS`
  (408, 425, 429, 500, 502, 503, 504) are retried;
- any other status, including a 4xx and a 5xx outside that set such as 501, is raised at once.

Both functions share one private loop, so they cannot drift apart. InterPro is batched (100 MD5s
per request), so it gets the default budget, not the small per-protein one. The per-attempt
timeout stays at 30 s: the slowest batch observed took 24 s, and the retry covers the tail. A
batch that still fails after the last attempt increments `failed_batch_count`, as today.

A lost batch now costs four attempts and at least 7 s of backoff, and up to about two minutes
with timeouts. During a full outage that would be paid for each of the ~5,700 Swiss-Prot
batches, over 10 hours of sleep alone, although the first lost batch already makes the source
incomplete. So, as in TED's final pass, 10 batches lost in a row stop the loop: the remaining
batches count as lost without a request, and one error says how many were skipped. A batch that
gets through resets the count.

### Biocentral predicts in bounded batches

After the existing dedupe, the unique sequences are cut into consecutive batches of at most
`_BATCH_SIZE` (1,000):

- One health check runs for the whole source, then one `api.predict(...)` per batch.
- The batch results, which are keyed by sequence hash, are merged, and duplicates are fanned back
  out as today.
- A batch that raises or returns nothing is counted in `failed_batch_count`, and the loop moves on.
- `prediction_failed` stays the manager-facing signal. It is `True` when the health check failed
  or any batch failed, so `manager.py` needs no change.
- Sequences of any length are sent; the upstream "longer than the recommended" warning stays
  suppressed.
- One progress bar covers the source.

When batches failed, one summary goes to stderr at warning level. It gives the proteins without
a prediction and the failed batches (for example `Biocentral predictions missing for 1,000 of
2,500 proteins (1 of 3 batches failed); they are not cached and will be requested again`). The
wording avoids every `_BIOCENTRAL_DOWN_PATTERNS` substring. The per-batch error line may name the
exception, which can legitimately be an outage.

_Alternative, retry each failed batch:_ deferred. `BiocentralServerTask` already polls a task
with its own failure budget, and a batch that failed is refetched on the next run because the
source stays uncached.

### TED retries failed lookups in a final pass

The first pass is unchanged: one GET per accession, `attempts=2`, and 404 counts as a genuine
absence. Accessions whose lookup raised are collected instead of counted. After the first pass
they get one more lookup each, with the default budget (`MAX_ATTEMPTS`, backoff and
`Retry-After`), by which time any transient outage has usually passed.

The final pass stops early after 10 consecutive failures and counts every remaining accession as
failed. Without that, a full outage would pay the full backoff for each of up to 573K accessions.
`failed_lookup_count` counts only lookups still failing after the final pass. It stays the
manager-facing signal, so `manager.py` needs no change. One warning gives how many lookups were
recovered and how many were still lost, with the first few accessions.

_Alternative, cache the successful TED values and refetch only the failed accessions:_ rejected
for now (Non-Goals). The cache cannot yet tell "not fetched" apart from "no domains" for a row
that exists.

### The UniProt release is observed where responses arrive

`paginated_get` gains an optional `on_response(response)` callback, called for every page. The
`UniProtRetriever` passes one that adds `response.headers["X-UniProt-Release"]`, when present, to
`self.releases: set[str]`. It does the same for its single-entry calls (inactive-entry
resolution, UniParc). No extra request is made. This is the only interface Track 3 depends on
Track 1 for (see "Track partition").

### InterPro columns hold member-database matches only

The InterPro Matches API now also returns InterPro-N matches: AI predictions that carry
`"source": "InterPro-N"` and the member library they predict, sometimes at an older release
(`Pfam 37.3` next to Pfam 38.2 matches), with no signature name and no match-level score. The
retriever mapped matches by `signatureLibraryRelease.library` alone, so a signature that only
InterPro-N predicts landed in `pfam`, `cdd`, `prints` and the others as an unscored hit. In 300
Swiss-Prot proteins that happened for 9 in `pfam` and 11 in `cdd`, about 3 % of proteins.

`_parse_interpro_results` skips every match whose `source`, compared lower-case, is `interpro-n`.
A match without a `source` field is a member-database match, as in every response before
InterPro-N and in the existing test fixtures. The member database's own match of the same
signature is kept, with its score. Tests use two results captured from the live API.

The InterPro columns change meaning again, but cache version 2 is not released yet and already
refreshes every InterPro column of an older cache, so the filter joins version 2 instead of adding
version 3. A cache that a pre-release build of this branch wrote is stamped version 2 and keeps its
InterPro-N values; such a cache needs `--refetch interpro` once.

_Alternative, keep InterPro-N matches and document them:_ rejected. The registry describes these
columns as the member databases' reference annotations, not predictions (`isPredicted: false`),
and the unscored hits cannot be told apart from CDD, SUPERFAMILY, PRINTS and PROSITE matches,
which carry no match-level score either. Only a blocklist of the one known predicted source is
used, not an allowlist of member sources: a renamed native `source` would otherwise empty a whole
column, and the empty values would be cached as "no match".

### Lookups share one session and run a bounded number at a time

At Swiss-Prot scale TED took about 23 hours and InterPro about 4. The clients, not the servers,
set that pace. Measured against the live APIs with Swiss-Prot accessions:

| Source           | Client today                        | Measured alternative                        |
| ---------------- | ----------------------------------- | ------------------------------------------- |
| TED (AFDB)       | `requests.get`, 7 req/s, ≈ 23 h     | one session, 8 parallel: 124 req/s, ≈ 1.3 h |
| InterPro Matches | one POST at a time, 35 MD5/s, 3.8 h | one session, 4 parallel: 92 MD5/s, ≈ 1.5 h  |
| UniProt          | `requests.get`, 208 entries/s       | one session, sequential: 308/s, ≈ 31 min    |

No 429 and no 5xx came back in 680 TED requests at up to 16 in parallel.

`http_utils` gains three pieces:

- `get_with_retry`, `post_with_retry` and `paginated_get` take an optional `session`. Without one
  they call `requests.get`/`requests.post` as before, so the taxonomy retriever is unchanged.
- `pooled_session(connections)` returns a `requests.Session` whose connection pool holds that many
  connections per host. When a server answers any request on the session with `Retry-After`,
  every later attempt on the session waits until that time, not only the thread that received
  it. Under concurrency, one request's backoff would otherwise leave the others firing at a
  server that asked for a pause.
- `map_in_order(fn, items, workers)` runs at most `workers` calls at once and yields their results
  in input order. It submits at most `2 × workers` calls ahead of the result it yields, so a 573K
  input never holds 573K futures. With `workers <= 1` it calls `fn` inline, one item at a time.
  Closing the iterator early cancels the queued calls and waits for the running ones, so no
  request outlives the fetch. An interrupt cancels the queue without waiting.

The retrievers use them as follows:

- **TED** sends up to `ted_retriever.MAX_CONCURRENT_REQUESTS` (8) lookups at once, in the first
  pass and in the final pass. Each lookup returns its value or its error rather than raising, and
  the results are consumed in input order, so failure counting, the final pass and its breaker
  work on the same sequence as before. The CATH names still load lazily, now under a lock, so
  parallel lookups do not download them twice.
- **InterPro** sends up to `interpro_retriever.MAX_CONCURRENT_REQUESTS` (4) match batches at once,
  with the same retry budget and MD5 fan-out.
- **UniProt** reuses one session for its batches, inactive-entry lookups, UniParc and
  secondary-accession searches, one request at a time. Parallel batches would save about 10
  minutes of 31. They would also need the per-batch inactive-entry resolution, the result list
  and the release set made safe for threads. UniProt is not on the critical path.

The breakers count failures in input order, as the results are consumed. After 10 lost InterPro
batches or 10 failed TED final-pass lookups in a row, the loop stops, the queued requests are
cancelled, and the running ones finish. Everything not yet consumed counts as lost, whether or
not its request completed. Once a service is down, the requests made are therefore bounded by the
breaker's limit plus the `2 × workers` submitted ahead. A lookup that succeeds resets the count,
as before.

The limits are module constants and constructor keywords (`max_concurrent_requests`). This
follows how the retrievers expose `CHUNK_SIZE`, `_BATCH_SIZE` and the attempt budgets. There is no
CLI flag, and no environment variable: the `protspace` package reads none, and only the prep
service is configured that way. The defaults are the measured, polite levels, and nothing raises
them unless a caller asks.

_Alternative, seed TED from its bulk file (Zenodo, 19.9 GB):_ rejected. The download alone takes
1.1 to 4 hours here, and the result needs a per-domain MD5 check against sequence changes, exact
formatting parity and cache integration. The fixed crawl does the same in about 1.3 hours with
the API's exact semantics. No InterPro or UniProt bulk file carries the scores the retrievers
emit.

_Alternative, `asyncio` with `httpx` or `aiohttp`:_ rejected. It would add a dependency and a
second retry implementation, and would gain nothing over threads for about 10 requests in flight.

### Family names are parsed by sentence, per section

For each text of each `SIMILARITY` comment, in UniProt order:

1. Drop a leading `In the <…> section; ` qualifier, case-insensitively. Examples are
   `N-terminal`, `C-terminal`, `central`, `2nd` and `3rd`.
2. Drop the `Belongs to the ` / `belongs to the ` prefix.
3. Keep the first sentence. A sentence ends at a `.` followed by whitespace or the end of the
   text, and never at a `.` inside parentheses. So `(TC 3.A.3)` and `2.5.1.x` survive, while
   `X superfamily. Y family. Z subfamily` keeps its first level, `X superfamily`, as today.
4. `encode_field` the name and append that text's best evidence code, as today.

Distinct names are joined with `;`, the reserved multi-value delimiter already used by `ec`, GO
and `cc_subcellular_location`, and the first occurrence of a repeated name is kept. Entries with
one family (about 99 %) produce the same value as before, unless their name contained a `.`.

`UniProtTransformer.transform_protein_families` stops cutting at `,` or `;`. It has to pass the
parser's value through unchanged. Its `rsplit("|")` would corrupt a multi-valued cell, and cached
values are re-transformed on every resumed run. No family name in the 573K cache contains a comma.
`--no-scores` already strips evidence per `;`-separated hit (`scores.py`).

The web reader already splits multi-hit cells on `;` (`bundle-format-contract`). The registry
description "Protein family membership (first family)" is updated in the integration step.

_Alternative, keep `protein_families` single-valued and take the first section's family:_
rejected. It drops real family assignments of multi-domain proteins, such as CAD (P27708) with
four.

### Legacy caches refresh the two affected sources once

`encoding.CACHE_SEMANTICS_CHANGES` gains version 2, covering `protein_families` and every InterPro
column. That is `pfam, superfamily, cath, signal_peptide, smart, cdd, panther, prosite, prints`
and `pfam_clan`. The names are written out literally, because importing `INTERPRO_ANNOTATIONS`
into `encoding.py` would create a cycle, and a test pins the two lists together. The existing
machinery then does the rest:

- a run that requests one of these columns refetches its source once and restamps the cache;
  an InterPro refresh of a cache without a `sequence` column also refetches UniProt, as a missing
  InterPro column already does, because InterPro is looked up by sequence;
- a run that does not request them drops them;
- other sources are reused.

_Alternative, repair InterPro in place by copying values within each identical-sequence group:_
rejected. The cache's `sequence` column holds UniProt's sequence, while InterPro was looked up
with the FASTA's sequence where one was supplied, so the groups cannot be rebuilt reliably.
`CACHE_SEMANTICS_CHANGES` exists for values that cannot be repaired locally. The cost is one
InterPro refetch per legacy cache, and only for runs that ask for InterPro.

### The cache is checkpointed after each fetched source

In `to_pd`, after each source _fetched over the network this run_ completes (whether or not it
lost data), the manager writes a checkpoint through the same code path as the final write. That
path:

- merges the completed sources with the cached values of every source not fetched this run;
- transforms the result;
- drops incomplete sources and their dependents;
- honours `protect_cached_columns`;
- keeps cached rows outside the run when the columns match (`_with_retained_rows`).

`protect_cached_columns` keeps what the cache already holds for an incomplete source instead of
dropping it. It used to do that by skipping the whole write, which also discarded every source
that did finish: one InterPro batch lost after its retries cost a completed 18-40 hour TED pass.
The write now goes ahead with the incomplete source's cached values read back from the file and
kept unchanged, for the proteins the cache holds them for. A protein the cache holds no value
for is left out and fetched by the next run, because an empty cell would read as "no
annotation". A column stored under superseded semantics is never kept, so a failed legacy
refresh cannot stamp its stale values current. Only when no other fetched source finished is
the write skipped, leaving the file as it was. Kept UniProt values keep the release the cache
recorded for them.

InterPro and Biocentral look proteins up by sequence, taken from the FASTA or else from UniProt.
When UniProt loses a batch, a protein of that batch has no sequence, and these sources return
an empty value for it that is not a real absence. So when UniProt is incomplete and one of them
is asked for a protein with no sequence, that source is incomplete too. Sequences from a FASTA
keep it cacheable.

The final write is unchanged. Two rules keep a checkpoint from storing a value nobody retrieved:

- **Pending sources keep their cached columns.** Until a source completes in this run, the
  checkpoint carries whatever the cache held for it. The source's columns come from the manager's
  `cached_data` even when that source is due to be fetched. Otherwise, adding `smart` to a cache
  holding `pfam` would drop `pfam` at the first checkpoint, before InterPro has run.
- **New rows wait for their pending sources.** A row for an identifier the cache did not hold is
  written only once every column in the checkpoint has a retrieved value for it. In a fill-in run
  the new rows therefore reach disk with the last source that fills them in. In a fresh or
  full-source run, a pending source has no column yet, so every row is written at every
  checkpoint.

A checkpoint costs one merge, one transform and one staged parquet write: at most five per run,
none on a cache hit. The final write already pays this once. Task 3.6 measures it at Swiss-Prot
scale.

_Alternative, a separate cache file per source:_ rejected. It is a new on-disk layout with a
migration, and the "which columns belong to which source" logic already exists for one file.

### `annotate` shares the cache logic instead of copying it

The body of `ReductionPipeline._fetch_annotations` that decides what to fetch moves into a new
module, `data/annotations/cache.py`. That covers the TED-label rewrite, stale columns, `--refetch`,
fill-in, the legacy UniProt fallback and the warm-cache fast path. The function takes the headers,
the annotation list, the sequences, the cache path and the refetch stages, and returns the frame,
the manager's incomplete sources and the UniProt releases. `ReductionPipeline._fetch_annotations`
stays, as the thin caller that also merges a CSV, because tests and the notebook reach
annotations through the pipeline.

`annotate` gains two options:

- `--cache-dir DIR`: created if missing. It uses `DIR/all_annotations.parquet`, the same name and
  format as `prepare`'s `{output}/tmp/`, so `annotate --cache-dir out/tmp` reuses a `prepare`
  run's annotations.
- `--refetch STAGES`: annotation stages only (`uniprot, taxonomy, interpro, ted, biocentral`,
  shorthand `annotations`). It is rejected without `--cache-dir`, because there is nothing to
  refetch around.

The refetch parsing and the stage sets move from `prepare.py` into `cli/common_options.py`, so
both commands validate the same way. `annotate` always writes its `-o` file from the run's frame,
never by copying the cache, so internal columns stay out unless requested. Without `--cache-dir`
the command constructs the manager with `output_path=None`, as today, so the prep service's
behaviour and `test_bundle_version.py`'s fake-manager test do not change.

### The release travels with the cache and ends in `run.log`

The cache carries a `protspace_uniprot_release` attribute next to the cache-semantics version
(`DataFrame.attrs`, which pandas round-trips through parquet key-value metadata). It holds a
sorted, comma-separated string:

- a UniProt fetch for every identifier stamps the releases observed;
- a fill-in fetch adds its releases to the cached stamp;
- a cache without a stamp contributes `unknown`.

The pipeline exposes the resolved set after `_fetch_annotations`. `prepare` keeps the pipeline
instance and writes `uniprot_release: <value>` under `## Annotations` in `run.log`:

| Case                                                     | Value written                  |
| -------------------------------------------------------- | ------------------------------ |
| Releases seen, or read from the cache                    | the releases, joined with `, ` |
| UniProt data used, release not knowable                  | `unknown`                      |
| No UniProt data used (CSV-only, or no UniProt accession) | `none`                         |

The attribute is added only when the value is known. This avoids noise in the attribute-equality
assertions of existing tests that mock the retriever. A run whose identifiers include no UniProt
accession makes no UniProt request (`UniProtRetriever.queried_accessions` is 0), so it records
no release, and its cache carries an empty stamp that later runs read as `none` too. A fetch
replaced by a test reports no count and still reads as `unknown`.

### Internal columns are stripped where a bundle's annotations are written

`data/io/bundle.py` drops `INTERNAL_ANNOTATIONS` (`organism_id`, `sequence`) from the annotations
table in `write_bundle` and in `replace_annotations_in_bundle`. Between them these two cover every
path that writes a bundle: `prepare`, `bundle`, `transfer` and the notebook's EAT cell. The drop
runs before the format-version stamp, and the constant is imported inside the function to keep
`data/io` free of an import cycle. `BaseProcessor` already drops them, so `prepare` output is
unchanged.

The columns are internal for four reasons:

- `configuration.py:38-41` documents them as "fetched only to drive other lookups";
- `prepare` strips them unconditionally (`base_processor.py:194-197`), even when requested;
- the annotation-metadata registry has no entry for either;
- no web or Python reader of bundles uses them.

The explicit request that `annotate -a sequence` honours still reaches the user, in `annotate`'s
own parquet output, which is not a bundle.

## Track partition

The three tracks touch disjoint files and can merge in any order. Interfaces between them are
frozen here.

Source paths below are relative to `apps/protspace/src/protspace/` and test files to
`apps/protspace/tests/`. Docs, `packages/` and `apps/protspace/` paths are relative to the
repository root.

**Track 1: retrievers.**

- Source: `data/annotations/retrievers/http_utils.py`, `interpro_retriever.py`,
  `biocentral_retriever.py`, `ted_retriever.py` and `uniprot_retriever.py`, all in that
  directory.
- Tests: `test_http_retry.py`, `test_interpro_annotation_retriever.py`,
  `test_biocentral_retriever.py`, `test_ted_retriever.py`, `test_uniprot_annotation_retriever.py`.

**Track 2: parser and bundle.**

- Source: `data/parsers/uniprot_parser.py`, `data/annotations/transformers/uniprot_transforms.py`,
  `data/io/bundle.py`, and `data/processors/base_processor.py` only if it switches to the shared
  drop.
- Tests: `test_uniprot_parser_encoding.py`, `test_transformer.py`, `test_bundle_overlay.py`, the
  protein-family test methods of `test_annotation_manager.py` (and nothing else in that file),
  plus the new `test_protein_families_parser.py` and `test_bundle_internal_columns.py`.

**Track 3: pipeline.**

- Source: `data/annotations/manager.py`, the new `data/annotations/cache.py`,
  `data/processors/pipeline.py`, `cli/annotate.py`, `cli/prepare.py`, `cli/common_options.py`.
- Tests: `test_annotate_cli.py`, plus the new `test_annotation_checkpoints.py`,
  `test_annotate_cache_dir.py` and `test_run_log.py`.
- Existing tests the refactor breaks may also be fixed: `test_bundle_version.py`,
  `test_pipeline_utils.py` except its version-stamp assertions, and `test_annotation_manager.py`
  except Track 2's protein-family methods.

**Integration, after the three tracks are merged.**

- `data/annotations/encoding.py` and the version-stamp assertions in `test_pipeline_utils.py`.
- `docs/guide/python-cli.md` and `docs/guide/fetching-and-caching.md`.
- `docs/scripts/annotation-details.ts`, `packages/utils/src/visualization/annotation-metadata.ts`
  and the generated `docs/guide/annotations.md`.
- `apps/protspace/CLAUDE.md`.
- `apps/protspace/notebooks/*.ipynb`, only if a notebook restates changed behaviour.

**Throughput and InterPro-N (tasks section 6), on the integrated branch.**

- Source: Track 1's retriever files, plus the version-2 comment in `data/annotations/encoding.py`.
- Tests: Track 1's test files, and `test_annotation_retrieval_e2e.py`, whose fake servers move
  from `requests.get`/`requests.post` to `requests.Session`.
- Docs: `docs/guide/fetching-and-caching.md`, the InterPro source text in
  `docs/scripts/annotation-details.ts` and the generated `docs/guide/annotations.md`.

Frozen interfaces:

- Failure signals stay as they are: `failed_batch_count` for InterPro, `prediction_failed` for
  Biocentral and `failed_lookup_count` for TED. `manager.py` reads nothing new from Tracks 1 or 2.
- `UniProtRetriever.releases: set[str]`, filled from `X-UniProt-Release`, is produced by Track 1
  and consumed by Track 3. Track 3 tolerates its absence and a `Mock` value: anything that is not
  a set counts as "no release observed". Its tests stub the attribute, so Track 3 does not wait
  for Track 1.
- `ReductionPipeline._fetch_annotations(headers, embedding_sets=None)` keeps its signature and
  behaviour, including its use of `ProteinAnnotationManager._fetch_*`, which tests monkeypatch.
- `protein_families` values are `;`-joined `name|EVIDENCE` hits. Only Track 2 produces them;
  Tracks 1 and 3 treat them as opaque.

## Risks / Trade-offs

- **Upgrading refetches UniProt and InterPro once for a legacy cache** (hours at Swiss-Prot
  scale). → Only for runs that request those columns, and the values being replaced are wrong for
  about 2 % (families) and about 15 % (InterPro, duplicate sequences) of Swiss-Prot. The docs say
  so.
- **`protein_families` becomes multi-valued for multi-section entries.** Legend counts, EAT
  targets and `--stats-annotation` treat these proteins like any multi-valued `ec` cell. → The
  registry description and the docs state it, and the example rebuild's verification gates check
  it.
- **Checkpoints add I/O and a transform per source.** → Bounded by five per run, skipped on a
  cache hit, measured in task 3.6. The final write already pays the same cost once.
- **The TED final pass can add time during a partial outage.** → Only for the failed accessions,
  cut off after 10 consecutive failures.
- **Parallel requests load the public APIs harder.** → The defaults (8 for AlphaFold DB, 4 for
  InterPro) are the levels measured without a single 429 or 5xx. A `Retry-After` pauses every
  request on the session, and the retry budgets and breakers are unchanged.
- **Ctrl-C waits for the requests in flight.** → The queue is cancelled at once, but Python cannot
  stop a running thread. The process exits when the running requests finish, which takes at most
  one request's retry budget and is usually well under a second.
- **A cache written by a pre-release build of this branch keeps InterPro-N values.** → It is
  stamped version 2, the version the filter joins. Only development caches are affected, and
  `--refetch interpro` repairs one.
- **Sequence-dependent sources are cached per identifier, not per sequence.** This is inherited
  from `prepare`, and `annotate --cache-dir` now exposes it too. → The docs tell users to use a
  separate cache directory, or `--refetch interpro,biocentral`, when the sequences behind the
  identifiers change (for example mature-peptide against full-length FASTA, critique G8).
- **Two tracks' tests break on one shared fixture.** → File ownership above. Where a shared test
  file must change, its hunks are split by owner: Track 2 edits only the protein-family methods of
  `test_annotation_manager.py`, and the integration step edits only the version-stamp assertions
  of `test_pipeline_utils.py`.

## Migration Plan

No user action is needed. The first run after upgrading:

- stamps any cache it writes with version 2 and, when UniProt was fetched, with the release;
- refreshes `protein_families` and the InterPro columns once, where the run requests them;
- writes bundles without `organism_id`/`sequence`.

Bundles already published keep their columns until they are rebuilt. Rollback is a version
downgrade, but not a harmless one for a cache this version wrote. Older versions read a
version-2 cache as current, and any run of theirs that is not a pure cache hit passes the cached
`protein_families` through their first-family transform again. That transform corrupts the new
values: `CarA family|IC;CarB family|IC` becomes `CarA family|IC|IC`, and
`inositol 1,4,5-trisphosphate 5-phosphatase family|IEA` becomes `inositol 1|IEA`. The result
reaches the bundle and is written back to the cache stamped version 1, so it stays until the
next upgrade refreshes it. After a downgrade, delete `{output}/tmp/all_annotations.parquet` or
run once with `--refetch uniprot`. The docs say so.

## Open Questions

None blocking. TED's bulk downloads (critique G25) are settled: the bounded-concurrency crawl is
faster than downloading them (see "Lookups share one session"). Two follow-ups for after the
rebuild:

- Whether TED at Swiss-Prot scale still needs an in-source journal, now that the pass takes about
  an hour and a half instead of a day.
- Whether provenance should also travel inside bundles (critique G15).
