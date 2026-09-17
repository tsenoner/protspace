## Context

`preserve_existing_cache_on_uniprot_failure` was introduced for the legacy-PDB
migration: if a migration-triggered refresh failed, the cache must not be
replaced or marked current, so a later run retries. That is why the pipeline
passes `bool(refresh_columns)` rather than a constant.

The reasoning generalizes. Nothing about the migration makes a failed UniProt
fetch safer to persist in any other run; the migration was simply the case
someone was looking at when the flag was added.

## Decisions

### Default to True rather than passing True at each call site

Three call sites construct the manager in `_fetch_annotations`. Two write a
cache (`output_path=cache_path`); the third passes `output_path=None` and can
never write one. Flipping the default covers all of them, including the
`bool(refresh_columns)` site once its explicit argument is dropped, and means a
future call site inherits the safe behavior instead of having to remember.

The parameter stays in the signature: the caller that genuinely wants the old
behavior can still ask for it, and the migration path documents _why_ it cares.

### Skip the whole write, rather than writing only the successful rows

Writing the good rows and omitting the failed ones sounds better, but the read
side cannot notice the omission: `_extract_cached_source` iterates the cache's
own rows and never compares them against `self.headers`. A row-partial cache
would therefore leave those proteins silently blank on every later run — the
exact poisoning this change is fixing, with `NaN` instead of `""`.

(An earlier draft of this section claimed the omitted proteins would vanish from
the bundle. They would not: `run()` builds `full_metadata` from `all_headers`
and left-merges the annotation frame onto it, so a protein missing from the
cache keeps its row and its projection. The conclusion holds; the reason above
is the real one.)

### The deferred fix is provenance, not row-awareness

#483 and an earlier draft of this document named "make the completeness check
row-aware" as the deeper fix. That is the wrong target. Empty is legitimately
ambiguous here by design: `UniProtRetriever` emits the identical all-empty row
for headers that are not UniProt accessions at all, and for inactive or deleted
entries. A check that refetched all-empty rows would refetch every non-UniProt
identifier on every run, forever, for a permanently empty result — and
`CACHE_SEMANTICS_CHANGES` exists precisely because this codebase has already
been burned by reading `""` as a signal.

The deeper fix is to record which identifiers were actually retrieved, so the
completeness check consults provenance instead of inferring from the schema. The
channel already exists: `annotation_cache_version_attrs()` writes parquet
key-value metadata, and `stale_cache_columns()` is the precedent for "present
but not to be trusted". That fix would retire this flag and cover every source,
not just UniProt.

### Retry before treating a failure as data loss

Skipping the write is only safe if failures are rare. Nothing in the package
retried: `paginated_get` was a bare `requests.get`, and UniProt is fetched 100
accessions at a time, so a Swiss-Prot run is ~5,730 sequential requests. At even
a 0.05% per-request failure rate the chance of a clean run is ~6%, which would
have made the cache effectively unwritable at exactly the scale `--keep-tmp`
exists for. Bounded retry with backoff now sits in `paginated_get`, so it also
covers taxonomy, and only a request still failing after those attempts counts as
lost data.

### An explicit refetch overrides the guard

`--refetch annotations` is the documented remedy for a cache already holding
empty values. Declining to write on that path would strand the poisoned cache
and discard the good data the repair just recovered, so the explicit request
wins. This is the one place where writing a partly empty cache is better than
keeping what is there.

### Keep the failure visible

`to_pd` already warns when it declines to write. That warning is the only signal
the user gets that this run's annotations were not cached, so it stays, and it
names the path.

## Risks

A long `prepare` run whose batch still fails after all retries caches nothing,
so a rerun refetches every protein. Retry makes that rare rather than routine,
and `--refetch annotations` gives an explicit way out, but the cost is real at
Swiss-Prot scale. It is accepted because the alternative is a cache that is
confidently wrong and never repairs itself.

### Per source, not all-or-nothing

Extending the guard to taxonomy, TED and Biocentral by skipping the whole write
whenever any source failed would repeat the mistake retry was added to fix:
Biocentral is known to be intermittently unavailable, so an opt-in flaky source
would block caching an expensive UniProt fetch. Instead each source reports
whether it completed, and only the incomplete ones are left out of the cache.
The column-based completeness check then refetches exactly those next run, which
is the mechanism already used for a cache that never had the column.

The one case that still skips entirely is when dropping would overwrite an
existing cache with fewer columns — keeping what is on disk is strictly better
than replacing it with less.

### `annotate` warns rather than failing

`protspace annotate` writes the user's deliverable, not a cache, so it is always
written: a partial result beats no result. It does not exit non-zero, because
`apps/prep` treats a non-zero exit as a failed job and would discard a bundle the
user can still use — the same "never hard-fail, warn on stderr" rule the embed
path follows. It warns and names the incomplete source instead.

## Review follow-ups

Two bugs the per-source design introduced, both found before merge:

- Dropping UniProt while keeping taxonomy produced a cache that read as complete
  but could not be resolved — taxonomy is looked up by `organism_id`, a UniProt
  column, so the next run lost every rank. `SOURCE_CACHE_DEPENDENTS` now drops a
  source together with anything read back through it.
- `failed_lookup_count` counted AlphaFold 404s, which are the normal answer for
  an accession TED does not model. That marked TED incomplete on essentially
  every real run, so its column would never have been cached.

The retry precondition was also under-scoped: it was argued for all sources but
implemented only in `paginated_get`, leaving TED — one request per protein, so
two orders of magnitude more requests than UniProt — unretried. TED now uses the
helper with a reduced attempt budget, since a per-item caller cannot afford the
default backoff on a full outage.

Finally, `--refetch` originally turned the whole guard off, which let a
partially-failed repair write empty values straight back into the cache. The
guard now stays on and only the _protection of existing columns_ is lifted: the
failed source's columns are removed rather than overwritten with empties, so the
repair clears what it could not replace instead of stranding it.
