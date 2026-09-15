## Context

The query builder evaluates a `FilterQuery` — a list of conditions and groups — into a `Set<number>`
of protein indices (`query-evaluate.ts`). Conditions come in two kinds that had drifted apart:
categorical conditions selected values from a list that already contained the `NA_VALUE` sentinel,
while numeric conditions had only an operator and one or two bounds and no concept of a missing
value at all.

`NOT` lived at the combining level, applied as `allIndices ∖ itemResult`. Because a protein missing
a value simply fails every condition, complementing swept all of them in. Two consequences shaped
this change:

1. Users wrote `NOT (X) AND NOT (is N/A)` by hand, and the second half is the part that is hard to
   discover — a negation that silently answers with the un-annotated majority looks like a data bug,
   not a semantics choice.
2. The EAT reliability slider (`control-bar.setEatConfidenceThreshold`) had been built to exploit the
   sweep: `NOT(EAT_confidence < x)` kept curated proteins visible only because they are null and the
   complement returned them. That made the reliability filter's correctness depend on a defect.

The description of what a filter means also had no home. `openspec/specs/` carries no filter-query
capability, so nothing outside the source recorded that `NOT` had changed meaning for every saved
query.

## Goals / Non-Goals

**Goals:**

- Make `NOT` mean what a user reading it expects, without a companion guard condition.
- Give both condition kinds one shared vocabulary for presence (`has a value` / `has no value`), so
  the numeric side can express what the categorical side already could.
- Let the EAT reliability filter state its intent directly rather than depend on `NOT`'s behaviour.
- Record the resulting semantics in `openspec/specs/` so the next change reads them as current.

**Non-Goals:**

- Reworking the evaluator into a three-valued (Kleene / SQL-NULL) model — see Risks.
- Teaching the numeric row's live match count about `logicalOp`. The categorical picker was made
  `NOT`-aware; the numeric preview still shows the un-negated count for a negated row. It is a
  behaviour change that needs its own decision, and it affects a preview rather than a result.
- Fixing reliability-condition ownership (removing the N/A chip in the builder orphans the slider).
  #427 fixes it by keying on a declared owner instead of the condition's shape.
- Migrating stored queries. See Migration Plan.

## Decisions

**`NOT` scopes to "has a value", it does not complement.**
`itemResult = proteinsWithAnyValue(annotations(item)) ∖ itemResult`. The alternative — keeping the
complement and having the UI append an implicit `AND NOT (is N/A)` — was rejected because it puts
the semantics in the builder, so a query constructed anywhere else (bundle settings, the EAT mirror,
a future API) gets the old behaviour. Scoping inside the evaluator makes `NOT` self-contained.

For a group, the scope is the proteins carrying a value for **at least one** of the annotations the
group touches, not all of them. "All" would drop a protein annotated for one of two columns, which
is a stricter reading than a user negating a group intends; for the single-condition case that
dominates, the two coincide.

**Presence sentinels rather than a `nullHandling` mode.**
`ANY_VALUE = '__ANY__'` joins the existing `NA_VALUE = '__NA__'`, and both are values the condition
carries — in `values` for a categorical condition, in a new optional `presence` array for a numeric
one. A per-condition enum (`includeNulls: 'never' | 'always'`) was the alternative; sentinels won
because the categorical side already worked that way, so the picker, the chip row, the counts and
the evaluator all needed one rule instead of two. The cost is that `presence` is a three-state
concept modelled as an unbounded array (only `[]`, `[NA_VALUE]` and `[ANY_VALUE]` are reachable).

`ANY_VALUE` lives in `query-types.ts`, not in `missing-values.ts` next to `NA_VALUE`: it is a
filter-query concept and nothing in the data pipeline ever produces it. Its display label lives in
`query-presence.ts` instead, which keeps `query-types.ts` presentation-free while still giving the
three components that render a sentinel — picker, categorical chip row, numeric chip row — a single
`displayFilterValue` to read it through.

**Presence unions with the comparison; nulls are outside the numeric domain.**
`matchesNumericValue` returns `presence.includes(NA_VALUE)` for a null before it looks at the
operator, and `true` for any non-null when `ANY_VALUE` is present. So `>= 0.5` + N/A is a union, not
a modified comparison. This is what lets the reliability filter be written as one condition.

**`ANY_VALUE` is exclusive, enforced in three places.**
"Any value OR X" is just "any value". The picker locks the remaining entries (`is-disabled` +
`aria-disabled`, click and keyboard both inert), the categorical select handler replaces the
selection, and the numeric chip handler clears both bounds and disables the operator. Locking rather
than silently ignoring is deliberate: a selection that has no effect is worse than one that is
visibly unavailable.

**One readiness rule, derived from one operator table.**
`numericFieldsFor(operator)` is the only statement of which bounds an operator needs; `hasNumericBounds`
derives from it and `isNumericConditionReady` is `hasNumericBounds || presence.length > 0`. Adding
`gte`/`lte` therefore touched one table. The `<option>` list in `query-numeric-input` is the one
un-type-checked half of that table — a sixth operator would type-check while the dropdown silently
omitted it.

**Previews are computed from the same definitions as results.**
The value picker's `NOT` count is `|matched ∩ has-value| − |that slice carrying v|` rather than
`|matched| − |carriers|`, which fixes both old errors at once (N/A proteins swept in; a multi-label
protein removed once per missing label). It is cross-checked against `evaluateQuery` for the same
single condition in `query-value-picker.test.ts`. `countNumericMatches` walks `protein_ids.length`
and normalizes a missing slot to null, matching `evaluateNumericCondition` exactly, so a sparse
column cannot make the preview undershoot the result.

Both count paths run per keystroke, so the picker memoizes its dataset walk and invalidates on the
four inputs the counts depend on (`data`, `annotation`, `matchedIndices`, `logicalOp`).
`matchedIndices` compares by reference, which holds because the builder hands down a freshly built
`Set` on each evaluation rather than mutating one in place.

## Risks / Trade-offs

**Saved `NOT` queries silently change result.** → Accepted, and the reason this is marked BREAKING.
The old result was the one users worked around, and a migration that appended `AND NOT (is N/A)` to
every stored `NOT` would preserve a behaviour nobody asked for. The one stored form that mattered —
the EAT reliability filter — is rewritten by the slider on load rather than migrated.

**The reliability condition is recognized by shape, not identity.** → `_isReliabilityConditionForKey`
matches "numeric, this column, `gte`, not negated, carries N/A". A user who hand-builds that exact
condition adopts the slider, and removing the N/A chip in the builder orphans it. Mitigated by
scoping the match to the resolved eat-confidence column of a specific base; fixed properly in #427.

**`proteinsWithAnyValue` walks the dataset once per `NOT` evaluation.** → Mitigated by hoisting the
record lookups out of the row loop and precomputing an `isRealValue` table per _declared_ value
rather than calling `toInternalValue` per label per protein — the table is as long as the category
list, not the protein list.

**A three-valued evaluator would be simpler.** → If `evaluateCondition` returned `{matched, defined}`
pairs, `NOT` would fall out as `defined ∖ matched` and both `collectAnnotations` and
`proteinsWithAnyValue` would disappear. Not taken here: it rewrites every combinator and the counting
paths that mirror them, for no user-visible difference. Recorded as the natural next refactor.

## Migration Plan

No data migration. `FilterQuery` is persisted in bundle settings; `presence` is optional and absent
in old bundles, `ANY_VALUE` never appears in one, so old queries load unchanged. A stored `NOT`
evaluates under the new rule, which is the intended change. A stored `NOT(EAT_confidence < x)` is
not migrated — on load the slider seeds from `eatConfidenceThreshold` and writes the new
`>= x` + N/A condition, so the reliability filter is re-derived rather than converted.

## Open Questions

- Should the numeric row's live count become `logicalOp`-aware, matching the categorical picker? It
  is the one place a preview can still disagree with the result.
- Should `presence` become a nullable enum now that only three states are reachable, or wait for the
  Kleene refactor that would remove it entirely?
