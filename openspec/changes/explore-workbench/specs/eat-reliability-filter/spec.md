## ADDED Requirements

### Requirement: The control writes the applied filter, and an open draft follows it

Moving the reliability control SHALL change the applied filter at once, with no Apply, after a
short debounce while a thumb is dragged. A draft open in the Filter panel SHALL follow: a draft
equal to the applied filter SHALL become the new applied filter, and a draft with edits of its own
SHALL keep them and change only that column's reliability condition, under the draft's own
condition, so its row keeps its count and any half-typed bound. In the other direction, editing the
reliability condition in the draft SHALL move the control only when the draft is applied; Reset,
or removing the filter from its chip, SHALL return the control to its default position.

#### Scenario: A clean draft follows the control

- **WHEN** the Filter panel's draft equals the applied filter and the user moves the reliability
  control
- **THEN** the applied filter carries the new reliability condition and the draft equals it

#### Scenario: A changed draft keeps its edits

- **WHEN** the draft has an extra empty condition and the user sets the reliability control to 50%
- **THEN** the filter is applied with the reliability condition, and the draft keeps both of its
  rows and gains the reliability condition with a lower bound of 0.5, so Cancel is enabled

#### Scenario: A draft edit moves the control only on Apply

- **WHEN** the user edits the reliability condition in the draft
- **THEN** the control does not move until the user applies the draft, and after a Reset it returns
  to its default position
