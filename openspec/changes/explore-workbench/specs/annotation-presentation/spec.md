## MODIFIED Requirements

### Requirement: Legend marks predicted annotations

When the active coloring annotation is predicted, the legend header SHALL show a sparkles mark after
its title, exposed to assistive technology as an image named "Predicted annotation", whose tooltip
reads "Predicted: computational, not experimentally curated". The header SHALL show no other badge
or note for it. When the active annotation is experimental, no such mark or tooltip SHALL be shown.

#### Scenario: Predicted annotation active

- **WHEN** `predicted_membrane` is the active coloring annotation
- **THEN** the legend header shows the sparkles mark named "Predicted annotation", whose tooltip
  reads "Predicted: computational, not experimentally curated"

#### Scenario: Experimental annotation active

- **WHEN** `ec` is the active coloring annotation
- **THEN** the legend header shows no predicted mark or tooltip
