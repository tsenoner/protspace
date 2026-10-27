## 1. Measure

- [x] 1.1 Time the current UniProt fetch on the snake toxin example's 5,015 accessions, split into
      batch time and inactive-entry time, and save its values for comparison

## 2. Bulk resolution

- [x] 2.1 Add the bulk helpers: an `accession:` search for inactive records and a `upi:` UniParc
      search with `fields=upi,sequence`, both through `paginated_get` on the fetch's session
- [x] 2.2 Move the per-entry logic into `_resolve_one`, unchanged
- [x] 2.3 Rewrite `_resolve_inactive_entries` as bulk first, `_resolve_one` for every unsettled
      accession, in input order, with the same counts
- [x] 2.4 Show the nested progress bar only for the per-entry fallback

## 3. Tests

- [x] 3.1 Unit tests: deleted + merged batch costs three requests and yields the per-entry values;
      unsettled accessions (not in the search, target inactive, UniParc id missing) fall back;
      a failing bulk request falls back without losing an accession
- [x] 3.2 Update the session, release and `Retry-After` tests to the new request sequence
- [x] 3.3 Re-run the snake toxin timing, check every value equals the saved per-entry values

## 4. Docs and checks

- [x] 4.1 Update `apps/protspace/CLAUDE.md` (UniProt ID validation and retrieval notes)
- [x] 4.2 `ruff`, fast suite, notebook tests (default ipywidgets and 7.7.1), `pnpm precommit`
