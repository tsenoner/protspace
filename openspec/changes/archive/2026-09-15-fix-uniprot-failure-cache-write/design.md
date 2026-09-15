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

Writing the good rows and omitting the failed ones sounds better but is not,
under the current completeness check. That check is column-based, so a cache
missing _rows_ still reads as complete, and the omitted proteins would then be
absent from the bundle entirely — a worse failure than an empty annotation.

Making the check row-aware is the real fix, and it belongs with the warm-cache
work in #481. This change deliberately does the cheap, correct thing first.

### Keep the failure visible

`to_pd` already warns when it declines to write. That warning is the only signal
the user gets that this run's annotations were not cached, so it stays, and it
names the path.

## Risks

A long `prepare` run that hits one bad batch now caches nothing, so a rerun
refetches every protein. For Swiss-Prot-scale inputs that is a real cost in time
and API load. It is accepted because the alternative is a cache that is
confidently wrong and never repairs itself, and because the condition is
transient by nature — the rerun that pays the cost is also the one that fixes
the data.
