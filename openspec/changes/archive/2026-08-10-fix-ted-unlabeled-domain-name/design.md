## Context

`TedRetriever._format_domains` serializes every TED domain as a label followed by its pLDDT score.
For domains whose AlphaFold/TED payload carries `cath_label: "-"`, the formatter currently replaces
the source label with `unclassified`. The serialized value is then consumed unchanged by the web
application, exports, and score-stripping logic.

## Goals / Non-Goals

**Goals:**

- Preserve TED's `-` label for domains without a CATH assignment.
- Retain pLDDT formatting and the existing semicolon-separated domain structure.
- Protect the behavior with a focused backend regression test and align user documentation.

**Non-Goals:**

- Changing how TED domains are fetched or how CATH names are resolved.
- Changing labeled TED domains, confidence values, or frontend rendering.
- Refactoring the annotation serialization format.

## Decisions

### Change the label at the retrieval boundary

The formatter will emit `-|{plddt}` in its existing unlabeled-domain branch. Fixing the value at
the backend boundary keeps every consumer consistent and avoids UI-specific substitutions.

Alternative considered: translate `unclassified` to `-` in the frontend. This would leave exports
and other consumers with the incorrect value and duplicate source-specific knowledge downstream.

### Preserve the surrounding serialized contract

The implementation will change only the fallback label. Score rounding, CATH-name encoding, and
semicolon joining remain unchanged, which keeps the behavioral impact limited to issue #342.

### Migrate legacy cache values on read

The annotation cache stores already-formatted values and never re-runs the formatter, so a cache
written before this fix keeps serving `unclassified`. ProtSpace will rewrite those values to `-` when
it reads the cache, at the single point where the cache enters the pipeline — which dominates both
reuse sites: the full-hit short-circuit and the partial-fetch path, where
`determine_sources_to_fetch` reports `ted: False` whenever the column is present, so the manager
merges the stored value straight through. The repair is persisted, keeping it a one-time cost rather
than a rewrite on every resumed run.

The rewrite is the exact inverse of the formatter change: the old unlabeled branch differed from
today's only in the literal it emitted, so substituting it reproduces a TED refetch of that column
without a single HTTP call. That matters because `TedRetriever` issues one sequential request per
accession, making `--refetch ted` a several-hundred-thousand-request operation at Swiss-Prot scale to
correct a string ProtSpace can derive locally. It follows the precedent already in the repo, where
`encoding.migrate_legacy_annotation_table` repairs v1 cells on read.

Alternative considered: warn and let users run `--refetch ted`. Rejected — it charges the user a full
network refetch for a deterministic local substitution, and a warning that is ignored leaves the
wrong label in the output. The migration is scoped to `TED_ANNOTATIONS` and anchored to a domain
boundary, so it cannot alter unrelated cached annotations or a CATH name that merely contains the
word.

## Risks / Trade-offs

- Existing consumers may group on the literal `unclassified` value → document the output change and
  cover the new literal with a regression test.
- A broad formatter change could affect labeled domains → implement only the fallback-branch
  substitution and run the complete TED retriever test module.
- Rewriting a user's cache in a read path could corrupt it → the rewrite only touches
  `TED_ANNOTATIONS` columns, only writes when a value actually changed, and the cache is a
  regenerable intermediate artifact the pipeline already rewrites on the partial-fetch path.

## Migration Plan

No user action is required. The intermediate annotation cache stores already-formatted
`ted_domains` strings and does not re-run the formatter for cached columns, so ProtSpace rewrites
the legacy label to `-` when it reads the cache and persists the repair. Rolling back requires
`protspace prepare ... --refetch ted` to restore the previous literal. The committed public
phosphatase example bundle is refreshed in place because it stores formatted TED values and is
downloadable independently of the preparation cache.

## Open Questions

None.
