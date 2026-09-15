## 1. Implementation

- [x] 1.1 Default `preserve_existing_cache_on_uniprot_failure` to `True` in
      `ProteinAnnotationManager.__init__` and update its docstring
- [x] 1.2 Drop the `preserve_existing_cache_on_uniprot_failure=bool(refresh_columns)`
      argument in `ReductionPipeline._fetch_annotations` so the migration path
      inherits the general guarantee

## 2. Tests

- [x] 2.1 A lost UniProt batch does not create the cache
- [x] 2.2 A lost UniProt batch leaves an existing cache untouched
- [x] 2.3 A complete retrieval still writes the cache
- [x] 2.4 The existing migration scenario still passes unchanged

## 3. Gates

- [x] 3.1 `ruff check` / `ruff format --check`
- [x] 3.2 Python suite (`-m "not slow"`)
- [x] 3.3 `openspec validate --strict`
- [x] 3.4 `pnpm precommit`

## 4. Archive

- [x] 4.1 Run the archive as the last commit on the branch, before merge

## 5. Review follow-ups

- [x] 5.1 Retry transient HTTP failures with backoff in `paginated_get`
- [x] 5.2 Let `--refetch annotations` write the cache regardless
- [x] 5.3 Pipeline-level regression tests for both
- [x] 5.4 Correct the row-partial rationale and rename the deferred fix to provenance
- [x] 5.5 Fold the subsumed migration scenario into the general requirement
- [x] 5.6 Drop the misfiled, stale cache scenario from `fasta-sequence-metadata`
- [x] 5.7 Document the behaviour in `docs/guide/python-cli.md`
- [x] 5.8 Rewrite the skip-write warning to say what actually happened

## 6. Generalise beyond UniProt

- [x] 6.1 Failure signals for taxonomy, TED and Biocentral retrievers
- [x] 6.2 Track `incomplete_sources` on the manager
- [x] 6.3 Cache per source instead of all-or-nothing
- [x] 6.4 Warn from `annotate`, without failing the hosted prepare job
- [x] 6.5 Document the whole fetch/cache model in `docs/guide/fetching-and-caching.md`
