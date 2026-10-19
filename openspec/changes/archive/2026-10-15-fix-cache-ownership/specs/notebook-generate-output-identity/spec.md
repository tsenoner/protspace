## ADDED Requirements

### Requirement: Each Generate action produces a distinguishable bundle

The Preparation notebook SHALL name each generated bundle so that bundles from
different Generate actions are told apart after download. A fixed name makes a
browser file the user opens ambiguous — a second download lands beside the first
as a copy, and opening the earlier file shows the earlier coordinates, which
reads as a stale projection.

#### Scenario: A second Generate action downloads another bundle

- **WHEN** a user runs Generate twice in one session
- **THEN** the second bundle's file name differs from the first
- **AND** the notebook reports the name it wrote

### Requirement: The panel states which parameters affect which methods

The Preparation notebook SHALL state that the reducer parameter controls apply
only to the methods that consume them. PCA and MDS take no neighbourhood or
perplexity parameter, so changing a slider and regenerating returns a
bit-identical PCA view — the default first projection — which reads as a cache
that ignored the change.

#### Scenario: A user changes a parameter that the selected method ignores

- **WHEN** the parameter controls are shown
- **THEN** the panel names the methods each parameter group applies to
