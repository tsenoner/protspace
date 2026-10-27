## ADDED Requirements

### Requirement: The Transfer notebook runs on the v3 Snake Toxin bundle

The Transfer notebook SHALL fetch `snake_toxin_v3.parquetbundle` from the `examples` release, the v3
bundle with annotations fetched for its proteins by the current package, and its text SHALL give the
counts of that bundle. The v1 `snake_toxin.parquetbundle` it used before can only be read until
protspace 5.0.0.

#### Scenario: The example is fetched

- **WHEN** the Transfer notebook's fetch cell runs
- **THEN** it downloads `snake_toxin_v3.parquetbundle` and the example's embeddings
