## MODIFIED Requirements

### Requirement: Every scheduled removal is declared once with its removal version

The package SHALL keep one registry of scheduled removals. Each entry SHALL name the feature, the first version that must not contain it, and the warning shown to users. Every deprecation warning the package prints SHALL take its text and removal version from that registry, so the warning, the help text and the release checks cannot name different versions.

#### Scenario: A warning states the registered removal version

- **WHEN** any deprecation warning is printed
- **THEN** the version it names is the removal version registered for that feature

#### Scenario: The scheduled removals

- **WHEN** the registry is read
- **THEN** it holds producing 3-D projections, `protspace serve`, reading v1/v2 bundles, reading 3-D projections, and taking `identifier` as the protein ID column of a table without a manifest, each due for removal in 5.0.0
