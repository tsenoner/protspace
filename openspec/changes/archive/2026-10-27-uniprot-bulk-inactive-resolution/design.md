## Context

`UniProtRetriever.fetch_annotations` fetches accessions in batches of 100 through
`/uniprotkb/accessions`, which returns active entries only. Each accession it does not return
goes through `_resolve_inactive_entries`, one at a time:

1. `GET /uniprotkb/{acc}.json` (`_fetch_one_with_timeout`). An active answer (a merged entry
   redirected to its target) is used as is. An inactive stub carries `inactiveReason` and, for a
   deleted entry, `extraAttributes.uniParcId`.
2. A `MERGED` stub's first `mergeDemergeTo` target is fetched the same way; if active, its values
   are used under the requested accession.
3. Otherwise the entry counts as deleted and `GET /uniparc/{upi}.json` recovers its sequence.
4. If step 1 raises, a `sec_acc:` search is tried instead.

Measured on the snake toxin example: about 45-55 of every 100 TrEMBL accessions are inactive
(mostly "Not part of a reference proteome"), each costing two sequential requests, at about two
entries a second.

UniProt answers the same questions in bulk (checked against the live API, release 2026_03):

- `GET /uniprotkb/search?query=accession:A OR accession:B …` returns one record per inactive
  accession: the same stub step 1 receives (`entryType: Inactive`, `inactiveReason`,
  `extraAttributes.uniParcId`). A merged accession comes back as an inactive `MERGED` stub with
  `mergeDemergeTo`, where step 1 followed the 303 redirect to the target instead.
- `GET /uniprotkb/accessions?accessions=T1,T2…` returns the active merge targets.
- `GET /uniparc/search?query=upi:U1 OR upi:U2 …&fields=upi,sequence` returns the sequences.

## Goals / Non-Goals

**Goals:**

- A bounded number of requests per batch for its inactive entries (three, plus pagination),
  instead of about two per entry.
- The same values, counts and release record as the per-entry path for every accession.

**Non-Goals:**

- Concurrency. All requests stay on one session, one at a time, as the
  `annotation-source-retrieval` spec requires for UniProt; the request count is what was slow.
- Seeding the notebook's annotation cache from the example's published bundle. Those bundles are
  legacy v1 files (reading them is removed in 5.0.0), carry values from an older parser, and would
  still need the fetch for every non-default column.

## Decisions

- **Each stage in bulk, then per entry for what it missed.** One classification decides what an
  inactive record is (active after all, merged into a target, deleted with or without a UniParc
  id), whichever request returned it. Each stage looks up alone only what its bulk request left
  unanswered, with the request the old code used: a record the search did not return (the
  single-entry endpoint, then a `sec_acc:` search), a merge target the accessions fetch did not
  return (the single-entry endpoint, which follows a chain of merges), a UniParc id the UniParc
  search did not return (the single UniParc lookup). A failed bulk request sends its whole stage
  down that path, with a warning. A first version kept the old per-entry code whole as the
  fallback; review replaced it because it was a second copy of the same classification, and it
  fetched a missed merge target's record twice.
- **Match search records by `primaryAccession`.** The search returns the stub keyed by the
  requested accession; a record for any other accession is ignored, so a record can never be
  filed under the wrong protein.
- **A merged entry takes its first `mergeDemergeTo` target**, as the per-entry path does.
- **UniParc via search with `fields=upi,sequence`.** The full records carry every
  cross-reference and are several times larger. The length is taken from the sequence when the
  record does not state it, as `_fetch_uniparc_sequence` already does.
- **One session.** The bulk requests use the fetch's `PooledSession` and `on_response`, so the
  `Retry-After` pause and the release record cover them like every other UniProt request.

## Risks / Trade-offs

- [The search caps a query's length or result count] → Batches hold at most 100 accessions
  (about 3 KB of query), well within limits, and results are read through `paginated_get`.
- [The search stops returning inactive entries] → Every accession then falls back to the per-entry
  path: as slow as today, never wrong.
- [A merged entry's values could differ between following the redirect and fetching the target
  by accession] → Both return the target's full UniProtKB JSON; the before/after comparison on the
  snake toxin example checks the values are identical.
