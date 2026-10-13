# filter-query-semantics Specification

## Purpose

What a filter condition in the query builder matches: the presence sentinels that select proteins by whether they have a value at all, how `AND`/`OR`/`NOT` combine conditions once a missing value is a first-class case, when a condition constrains the result at all, and the live match counts the builder previews before Apply.

## Requirements

### Requirement: NOT is scoped to proteins that carry a value

`NOT` SHALL mean "carries a value for the negated annotation **and** does not match", i.e.
`difference(proteinsWithAnyValue(annotations), matches)` — NOT a complement of the matched set over
all protein indices. The scope SHALL be the proteins holding at least one real (non-N/A) label for
at least one annotation the negated item references; for a group, "at least one" rather than "all"
keeps the negation as permissive as possible. A protein that is N/A on the negated annotation SHALL
NOT be returned by a `NOT`.

#### Scenario: Negating a categorical value

- **WHEN** a condition is `NOT (family is Kinase)` and the dataset holds kinases, non-kinases, and
  proteins with no family annotation
- **THEN** the non-kinases are returned
- **AND** the proteins with no family annotation are not returned

#### Scenario: Negating N/A means "has any value"

- **WHEN** a condition is `NOT (family is N/A)`
- **THEN** exactly the proteins carrying at least one real family label are returned
- **AND** the result equals the condition `family is Any value`

#### Scenario: The old N/A guard is now redundant

- **WHEN** a query pairs `NOT (family is Kinase)` with the hand-written guard
  `AND NOT (family is N/A)`
- **THEN** the result is the same as the first condition alone

#### Scenario: Negating a group

- **WHEN** a group over two annotations is negated
- **THEN** the scope is the proteins carrying a value for either annotation
- **AND** only a protein that is N/A across both is dropped by the scoping

#### Scenario: Negating a numeric annotation

- **WHEN** a condition is `NOT (confidence > 0.8)` and some proteins have no confidence value
- **THEN** the proteins whose confidence is at most `0.8` are returned
- **AND** the proteins with no confidence value are not returned

#### Scenario: Negating an unconfigured condition

- **WHEN** a `NOT` is applied to a condition that has no selected values and no bounds
- **THEN** the condition matches every protein, so the negation matches none
- **AND** Apply remains disabled because no condition is configured

### Requirement: Presence sentinels select proteins by whether a value exists

The system SHALL provide two presence sentinels that are exact complements of each other over a
given annotation: `NA_VALUE` (`'__NA__'`) selects the proteins missing a value, and `ANY_VALUE`
(`'__ANY__'`) selects precisely the rest. Categorical conditions SHALL carry them among their
`values`; numeric conditions SHALL carry them in a separate `presence` field. Both kinds SHALL
evaluate them identically. `ANY_VALUE` SHALL be offered first in the value picker, ahead of the
declared values, and SHALL be rendered as "Any value" through the same label path as N/A.

#### Scenario: Any value on a categorical annotation

- **WHEN** a condition is `family is Any value`
- **THEN** every protein carrying at least one real family label is returned
- **AND** proteins with no family label are not returned

#### Scenario: Multi-label protein carrying both real labels and nulls

- **WHEN** a protein resolves to a mix of real labels and N/A for the annotation
- **THEN** it matches `Any value`
- **AND** it also matches `is N/A`, because it carries that label too

#### Scenario: Any value leads the picker

- **WHEN** the value picker opens for an annotation and `Any value` is not already selected
- **THEN** `Any value` is the first entry, ahead of the annotation's declared values

#### Scenario: A sentinel reads the same wherever it is shown

- **WHEN** a sentinel is rendered in the value picker, on a categorical value chip, or on a numeric
  presence chip
- **THEN** all three show the same label for it, resolved through one shared display function
- **AND** searching the picker for that label matches the sentinel entry

### Requirement: A presence chip is unioned with the numeric comparison

A numeric condition's presence chips SHALL be unioned with its comparison, not replace it: `>= 0.5`
carrying an N/A chip SHALL read "at least 0.5, or no value at all". A null (missing) value SHALL be
matched ONLY by an explicit `NA_VALUE` chip — no comparison operator SHALL ever match a null, since
a missing value sits outside the numeric domain. An `ANY_VALUE` chip SHALL match every non-null
value regardless of the comparison.

#### Scenario: Threshold plus N/A

- **WHEN** a condition is `confidence >= 0.5` carrying an N/A chip
- **THEN** proteins whose confidence is at least `0.5` are returned
- **AND** proteins with no confidence value are also returned
- **AND** proteins whose confidence is below `0.5` are not returned

#### Scenario: A comparison alone never keeps a null

- **WHEN** a condition is `confidence < 0.5` with no presence chip
- **THEN** proteins with no confidence value are not returned

#### Scenario: Any value on a numeric annotation

- **WHEN** a condition carries an `Any value` chip
- **THEN** every protein with a non-null value for that annotation is returned
- **AND** proteins with no value are not returned

### Requirement: Any value is exclusive

Selecting `ANY_VALUE` SHALL replace the rest of the selection rather than join it, because "any
value OR X" is just "any value" and "any value OR N/A" is everything. While it is selected the
remaining choices SHALL be locked out rather than silently ignored. On the categorical side the
picker SHALL mark every entry `aria-disabled` and refuse selection by pointer or keyboard. On the
numeric side adding the chip SHALL clear both bounds and disable the operator and value fields, and
the N/A chip SHALL no longer be offered.

#### Scenario: Selecting Any value over an existing selection

- **WHEN** a categorical condition already selects `Kinase` and the user picks `Any value`
- **THEN** the condition's values become exactly `[Any value]`

#### Scenario: The picker locks out while Any value is selected

- **WHEN** `Any value` is selected and the user clicks or presses Enter on another entry
- **THEN** the selection does not change
- **AND** every entry reports `aria-disabled="true"`

#### Scenario: Adding the Any value chip to a numeric condition

- **WHEN** a numeric condition is `>= 0.5` and the user adds the `Any value` chip
- **THEN** its presence becomes exactly `[Any value]` and both bounds are cleared
- **AND** the operator dropdown and the value fields are disabled
- **AND** the `+ N/A` chip button is no longer offered

### Requirement: A condition constrains the result only when it is configured

A condition SHALL constrain the result when it is _configured_, and SHALL otherwise be a match-all
no-op, symmetric across the two kinds. A categorical condition SHALL be configured when it has at
least one selected value. A numeric condition SHALL be configured when it has every bound its
operator requires **OR** it carries a presence chip — a presence chip is meaningful on its own. The
operator → required-bounds table SHALL be stated once (`gt`/`gte` need `min`, `lt`/`lte` need `max`,
`between` needs both) and readiness SHALL be derived from it. Apply SHALL be gated on at least one
configured condition existing anywhere in the query — alongside the result being neither empty nor
the whole dataset — so a query of nothing but no-ops cannot be applied as if it were a real filter.

#### Scenario: A presence chip alone is enough

- **WHEN** a numeric condition has no bounds but carries an N/A chip
- **THEN** it is configured, it returns the proteins with no value, and Apply is enabled

#### Scenario: A bound-less comparison is a no-op

- **WHEN** a numeric condition is `>` with an empty min field and no presence chip
- **THEN** it matches every protein
- **AND** Apply is disabled unless some other condition is configured

#### Scenario: An empty categorical condition is a no-op

- **WHEN** a categorical condition has no selected values
- **THEN** it matches every protein

#### Scenario: An emptied group is a no-op

- **WHEN** a group's last condition is removed
- **THEN** the empty group matches every protein rather than intersecting the query down to nothing

#### Scenario: A configured condition on a missing column

- **WHEN** a configured condition names an annotation the dataset does not carry
- **THEN** it matches no protein

### Requirement: Numeric comparisons offer inclusive and exclusive operators

The numeric operator set SHALL be `gt`, `gte`, `lt`, `lte`, and `between`. `>` and `<` SHALL be
exclusive at the boundary; `>=`, `<=` and `between` SHALL be inclusive at both ends. Switching
operator SHALL null out the bound the new operator does not use, so a hidden value cannot linger and
silently re-constrain the filter on switching back.

#### Scenario: Inclusive versus exclusive at the boundary

- **WHEN** a protein's value is exactly `0.5`
- **THEN** it matches `>= 0.5` and `<= 0.5` and `between 0.5 and 0.9`
- **AND** it does not match `> 0.5` or `< 0.5`

#### Scenario: Switching operator drops the unused bound

- **WHEN** a condition is `between 0.2 and 0.8` and the operator changes to `>=`
- **THEN** `min` is kept and `max` is set to null
- **AND** switching back to `between` leaves the condition unconfigured until a new max is entered

### Requirement: The EAT reliability filter retains proteins with no confidence score

The legend's reliability control SHALL drive one query condition per configured bound on the
selected base's eat-confidence column — `gte` for "at least", `lte` for "at most", or `between` for
a band — each un-negated and each carrying an `NA_VALUE` presence chip, stating "confidence inside
the selected range, or no confidence score at all" directly, so curated proteins (which carry no
confidence value) stay visible in every mode. It SHALL NOT be expressed as `NOT (confidence < x)`,
which retained nulls only as a side effect of the old complement semantics and would now hide every
curated protein. A position that constrains nothing SHALL emit no condition at all. The
eat-confidence column SHALL be resolved by runtime identity (role plus base annotation) rather than
by name suffix, and only the selected base's conditions SHALL be replaced, leaving other bases'
filters and unrelated user conditions untouched.

#### Scenario: Raising the slider above zero

- **WHEN** the reliability control for a transferred base is in "at least" mode and moves to `0.75`
- **THEN** the query gains exactly one condition `<base's eat-confidence column> >= 0.75` with an
  N/A presence chip
- **AND** predictions below `0.75` are filtered out while curated proteins remain visible

#### Scenario: Bounding from above

- **WHEN** the control is in "at most" mode at `0.4`
- **THEN** the query gains exactly one condition `<base's eat-confidence column> <= 0.4` with an N/A
  presence chip
- **AND** curated proteins remain visible

#### Scenario: A band

- **WHEN** the control is in "between" mode over `0.4` to `0.6`
- **THEN** the query gains exactly one `between` condition inclusive on both ends, with an N/A
  presence chip
- **AND** curated proteins remain visible

#### Scenario: Returning the control to a position that constrains nothing

- **WHEN** the "at least" bound returns to `0`, or the "at most" bound returns to `1`, or the band
  covers the whole range
- **THEN** that base's reliability condition is removed from the query
- **AND** if no configured condition remains, the filter is cleared and every protein returns

#### Scenario: Two transferred bases

- **WHEN** one base's control is tuned while another base already has a reliability condition
- **THEN** only the tuned base's condition is replaced
- **AND** the other base's condition and any unrelated user conditions are preserved

#### Scenario: Reading the position back out of the query

- **WHEN** the control needs to reflect the query
- **THEN** a condition counts as this base's reliability filter when it is numeric and names that
  exact column, at any depth in the query, whatever its operator and however it was built
- **AND** the position is derived from the bound that is present, accounting for negation, and
  defaults to "at least `0`" when no such condition exists

### Requirement: Live match previews agree with the applied filter

The counts the builder shows before Apply SHALL be computed the same way the filter itself matches,
so a preview never disagrees with the result it predicts. The value picker's per-value counts SHALL
be relative to the query with the current condition excluded, and SHALL account for the row's
logical operator: `AND` counts the carriers within the already-matched set; `OR` counts the union of
the matched set with the whole-dataset carriers; `NOT` counts the has-a-value slice of the matched
set minus the proteins in that slice carrying the value, which equals evaluating the same single
`NOT` condition. A multi-label protein SHALL be counted once per value, however many of its labels
miss. The numeric row's count SHALL walk the protein count rather than the value array's length,
normalizing a missing slot to null, and SHALL be `0` for an unconfigured condition or a missing
column.

#### Scenario: NOT preview matches the applied result

- **WHEN** a categorical row's operator is `NOT` and the picker lists per-value counts
- **THEN** each count equals the number of proteins that applying that single `NOT` condition would
  return
- **AND** proteins that are N/A on the annotation are not counted

#### Scenario: Multi-label protein counted once

- **WHEN** a protein carries three labels and the `NOT` preview is computed for a value it does not
  carry
- **THEN** the protein is removed from the count at most once

#### Scenario: Numeric count over a sparse column

- **WHEN** a numeric column holds fewer entries than the dataset has proteins and the condition
  carries an N/A chip
- **THEN** the missing rows count as null and are matched by the chip
- **AND** the preview equals the number of proteins the applied filter returns

#### Scenario: Typing in the value search does not rescan the dataset

- **WHEN** the user types into the value picker's search box
- **THEN** the per-value counts are reused rather than recomputed, and are invalidated only when the
  data, annotation, matched set, or logical operator changes
