## ADDED Requirements

### Requirement: A transfer neighbourhood column is labelled after its base annotation

For a column named `<BASE>__neighbor` that is not in the registry, the system SHALL synthesize
metadata labelled "<base label> — EAT neighbourhood", with the base annotation's source, not marked
predicted, and with a description saying that the value records whether the protein's nearest
reference lay within the transfer's distance cutoff.

#### Scenario: Neighbourhood column of a known annotation

- **WHEN** metadata is requested for `ec__neighbor`
- **THEN** its label is `EC number — EAT neighbourhood`, its source is `UniProt`, and it is not
  predicted

#### Scenario: Neighbourhood column of a custom annotation

- **WHEN** metadata is requested for `toxin_family__neighbor`
- **THEN** its label is `Toxin family — EAT neighbourhood` and its source is `Other`
