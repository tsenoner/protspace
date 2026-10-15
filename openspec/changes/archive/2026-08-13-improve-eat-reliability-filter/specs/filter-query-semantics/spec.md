## MODIFIED Requirements

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
