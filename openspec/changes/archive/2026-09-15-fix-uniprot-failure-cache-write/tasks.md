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
