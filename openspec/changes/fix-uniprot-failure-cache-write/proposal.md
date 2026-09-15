## Why

A single failed UniProt batch permanently poisons the `--keep-tmp` annotation
cache.

A failed batch is not an exception — `UniProtRetriever` absorbs it and
substitutes `dict.fromkeys(UNIPROT_ANNOTATIONS, "")`, so the affected proteins
get the **full schema with empty values**. The manager records this
(`uniprot_fetch_failed = retriever.failed_batch_count > 0`) but only acts on it
when `preserve_existing_cache_on_uniprot_failure` is set, and that flag is
opt-in: it defaults to `False`, and the pipeline passes it only as
`bool(refresh_columns)`, for the legacy-PDB migration.

So an ordinary run writes the cache. The next run computes
`missing = required - cached_annotations`, which is purely **column**-based,
finds nothing missing, logs `Using cached annotations`, and serves the empty
values. The "All cached annotations are empty" warning does not fire either,
because it asks whether _every_ value is empty and the successful batches
populated theirs.

One transient blip on a batch of 100 therefore yields 100 permanently empty
proteins, indistinguishable in the output from proteins that genuinely have no
UniProt data, until someone runs `--refetch annotations`.

## What Changes

- Default `preserve_existing_cache_on_uniprot_failure` to `True`, so any run
  that could not retrieve all of UniProt leaves the existing cache alone.
- Stop scoping the guarantee to migration-triggered refreshes in the pipeline,
  so the first `--keep-tmp` run — the one that creates the cache — is covered.
- Generalize the existing spec requirement from "during migration" to any
  UniProt retrieval failure.
- Add regression coverage for a partial batch failure, which no test covered.

## Impact

After a partial failure the run's **successful** fetches are also not cached, so
the next run refetches everything. That is wasted work rather than wrong data,
and it self-heals; the previous default traded it for data that is silently
wrong and does not. The run itself still returns every annotation it managed to
fetch — only the cache write is skipped.
