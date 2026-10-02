## Why

`NOT` in the query builder was a bare index complement, so `NOT (annotation is X)` also returned
every protein with no value for that annotation. "Not an enzyme" answered with the un-annotated
majority, and asking the intended question meant bolting `AND NOT (is N/A)` onto every negated
condition. There was no way to say "has a value, whichever one", and the numeric side had no
presence concept at all, so `>` and `<` could never keep a null.

The EAT reliability slider was built on the defect: it spelled its filter `NOT(EAT_confidence < x)`
and relied on the complement sweeping curated proteins (which carry no confidence score) back in.
Fixing `NOT` without restating that filter would have hidden every curated point.

Retroactive: the code shipped in #416 and is on `main`. Written now because `openspec/specs/` is the
source of truth and holds no filter-query capability at all — nothing records what `NOT` means,
which every saved query depends on.

## What Changes

- **BREAKING** `NOT` means "has a value **and** does not match" — the matches subtracted from the
  proteins carrying a value — instead of a set complement. Every existing saved query containing a
  `NOT` changes result: proteins that are N/A on the negated annotation are no longer returned. In exchange
  `NOT (is N/A)` now means exactly "has any value", and the hand-written `AND NOT (is N/A)` guard
  becomes redundant.
- New presence sentinel `ANY_VALUE` (`'__ANY__'`), the exact complement of the existing `NA_VALUE`
  over a given annotation. Categorical conditions carry it among their `values`; numeric conditions
  carry it in a new `presence` field.
- Presence sentinels are **unioned** with the comparison rather than replacing it, so
  `>= 0.5` plus an N/A chip reads "at least 0.5, or no value at all". No comparison operator ever
  matches a null on its own.
- `ANY_VALUE` is **exclusive**: selecting it replaces the rest of the selection and locks the
  remaining options out, because "any value OR X" is just "any value".
- New inclusive numeric operators `gte` and `lte` alongside the existing exclusive `gt`/`lt`.
- Readiness rule stated once for both kinds: a numeric condition constrains the result when it has
  the bounds its operator requires **OR** it carries a presence chip. An unready condition stays a
  match-all no-op.
- The EAT reliability filter is restated as `EAT_confidence >= x` **plus an N/A presence chip**,
  replacing `NOT(EAT_confidence < x)`. It now states "confidence at least x, or no confidence score
  at all" directly instead of depending on `NOT`'s old null-sweeping side effect.

## Capabilities

### New Capabilities

- `filter-query-semantics`: what a filter condition matches — the presence sentinels, how `AND`/`OR`/`NOT`
  combine conditions, when a condition constrains anything at all, and the live match counts the
  builder previews before Apply.

### Modified Capabilities

<!-- The EAT overlay requirements live in the unarchived `add-eat-visualization` change rather
     than in openspec/specs/, so there is no committed requirement to modify. Its five stale
     `NOT(EAT_confidence < x)` requirements were corrected in place by #416; this change owns the
     filter-side rule they now depend on. -->

## Impact

- **Query semantics:** `packages/core/src/components/control-bar/query-evaluate.ts` (NOT scoping,
  `proteinsWithAnyValue`, `collectAnnotations`), `query-numeric-helpers.ts` (operator table,
  readiness, `matchesNumericValue`, `countNumericMatches`), `query-types.ts` (`ANY_VALUE`,
  `NumericCondition.presence`, `gte`/`lte`).
- **Query builder UI:** `query-condition-row.ts`, `query-value-picker.ts`, `query-numeric-input.ts`,
  and the shared `query-presence.ts` chip/label renderer.
- **EAT mirror:** `control-bar.ts` — `setEatConfidenceThreshold` and the reliability-condition
  recognizer that keys the legend slider off the query.
- **Saved queries:** `FilterQuery` is persisted in bundle settings. Old queries still load — the new
  fields are optional — but a stored `NOT` evaluates differently, and a stored
  `NOT(EAT_confidence < x)` no longer keeps curated points. There is no migration.
- **Not included:** making the numeric row's live match count `logicalOp`-aware (a `NOT`'d numeric
  row still previews the un-negated count — the categorical picker was taught about `NOT`, the
  numeric side never receives it); reliability-condition ownership, which is fixed separately in
  #427 by keying on a declared owner instead of the condition's shape.
