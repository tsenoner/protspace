## ADDED Requirements

### Requirement: The reliability filter is identified by column, not by condition shape

The reliability control SHALL treat a numeric condition on an eat-confidence column as its own,
at any depth in the query and regardless of operator or logical operator, however that condition
was built. Changing the control SHALL replace those conditions rather than adding another beside
them. Identity SHALL rest on the column alone: an eat-confidence column exists only to drive this
filter, so no marker distinguishing a control-authored condition from a hand-built one may be
required to recognise it.

#### Scenario: A hand-built condition is recognised

- **WHEN** the user builds a condition on an eat-confidence column with any operator
- **AND** then changes the reliability control
- **THEN** exactly one reliability condition remains in the query

#### Scenario: A condition nested in a group

- **WHEN** a reliability condition sits inside a filter group
- **THEN** changing the control replaces it in place rather than duplicating it at the top level

#### Scenario: Another base annotation is untouched

- **WHEN** two annotations both carry EAT predictions and both have a reliability condition
- **THEN** changing one leaves the other's condition unchanged

### Requirement: Curated proteins stay visible in every mode

The reliability control SHALL offer bounding below, bounding above, and a band, and proteins
without a confidence score — the curated ones — SHALL remain visible in all three. They are
retained by the presence chip each mode's condition carries, not by a negation's complement;
`filter-query-semantics` fixes how each mode is encoded.

#### Scenario: Each mode keeps curated proteins

- **WHEN** any of the three modes is applied
- **THEN** proteins with no confidence score remain visible

#### Scenario: A bound that constrains nothing emits no condition

- **WHEN** the control is at its default position
- **THEN** the query carries no reliability condition

### Requirement: Deriving the control position respects the logical operator

Reading the control's position back from the query SHALL account for negation: a negated
less-than is a LOWER bound while a bare less-than is an UPPER bound.

#### Scenario: Negated and bare forms of one operator

- **WHEN** the query carries a negated `less than X`
- **THEN** the control reads a lower bound at X
- **WHEN** the query carries a bare `less than X`
- **THEN** the control reads an upper bound at X

### Requirement: A query matching nothing does not blank the plot

Applying a query whose result is empty SHALL clear the filter channel rather than pushing an
empty active filter, which the scatter plot reads as "hide everything".

#### Scenario: A self-contradicting query

- **WHEN** the evaluated query matches no proteins
- **THEN** the filter channel is cleared and the plot is not blanked

### Requirement: Switching the coloured-by annotation repositions the control

When the selected annotation changes, the control SHALL be told the new base's reliability state
even when that state has not changed since it was last written, because the control is otherwise
still showing the previous base's position.

#### Scenario: Switching between two transferred annotations

- **WHEN** two annotations carry EAT predictions with different reliability positions
- **AND** the user switches the coloured-by annotation
- **THEN** the control shows the newly selected annotation's position
