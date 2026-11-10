## Why

UniProt retrieval resolves every accession the batch endpoint does not return (an inactive
entry: deleted or merged) with its own requests: one entry lookup, then one UniParc lookup for a
deleted entry's sequence. The Preparation notebook's "Snake Toxin incl. TrEMBL" example (5,015
proteins, 3,018 of them TrEMBL) has thousands of such entries, because TrEMBL has dropped many of
them since the example was built, so its annotation fetch takes about 20 minutes on Colab and
longer locally, at about two inactive entries a second. UniProt can answer the same questions for
a whole batch at once: a `uniprotkb/search` on `accession:` returns the inactive entries with their
reason, merge target and UniParc id, and a `uniparc/search` on `upi:` returns many sequences.

## What Changes

- Inactive entries of a batch are resolved with a bounded number of requests per batch instead of
  per entry: one search for the inactive entries, one accessions fetch for the merge targets, and
  one UniParc search for the deleted entries' sequences.
- An accession the bulk requests leave unanswered (not returned by the search, a merge target
  that is not active, a UniParc id not returned, or a bulk request that failed) is resolved one by
  one exactly as today, so values and counts do not change.
- The nested "Resolving inactive entries" progress bar appears only for that per-entry fallback.
- All requests still go through the one `PooledSession`, one at a time, recording the release
  header of every response.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `annotation-source-retrieval`: adds a requirement that inactive UniProt entries are resolved in
  bulk, with the per-entry lookup only as a fallback, and with the same values as before.

## Impact

- `apps/protspace/src/protspace/data/annotations/retrievers/uniprot_retriever.py`
  (`_resolve_inactive_entries` and two new bulk helpers).
- `apps/protspace/tests/test_uniprot_annotation_retriever.py`.
- No CLI, notebook, cache or bundle change; the notebook picks the speed-up up with the next
  release of the package it installs.
