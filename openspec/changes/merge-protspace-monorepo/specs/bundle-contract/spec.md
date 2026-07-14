## ADDED Requirements

### Requirement: Single source-of-truth bundle schema

The repository SHALL define the `.parquetbundle` format exactly once, in a shared
`packages/bundle-contract/schema.json`, covering the delimiter bytes, the part order and filenames
(`selected_annotations`, `projections_metadata`, `projections_data`, optional `settings`), and each
core table's columns, dtypes, and nullability. The Python side and the TS side SHALL each keep their
own delimiter/filename constants, and a test on each side SHALL assert those constants match the shared
schema, so the two encoders cannot silently diverge.

#### Scenario: Python constants match the schema

- **WHEN** the Python contract test runs
- **THEN** the delimiter and core filenames used by `protspace.data.io.bundle` equal the values in
  `schema.json`

#### Scenario: TS constants match the schema

- **WHEN** the TS contract test runs
- **THEN** the delimiter and filenames exported from `@protspace/utils` equal the values in `schema.json`

### Requirement: Golden fixtures round-trip across languages

The repository SHALL commit golden `.parquetbundle` fixtures (at least one 3-part and one 4-part with
settings). The Python producer SHALL be verified to write bundles whose per-part arrow schema equals
`schema.json` (columns, dtypes, and nullability). The TS reader SHALL be verified to parse the committed
Python-written fixture into the expected shape. The TS writer's output SHALL round-trip through the TS
reader.

#### Scenario: Python producer matches the schema

- **WHEN** Python builds a bundle from the reference fixture data
- **THEN** each core part's arrow schema equals `schema.json`, including nullability

#### Scenario: TS reads the Python-written fixture (ingest path)

- **WHEN** the TS reader loads the committed golden fixture
- **THEN** `extractRowsFromParquetBundle` yields the expected columns and row shape

#### Scenario: TS writer round-trips through the TS reader

- **WHEN** the TS writer encodes reference data and the TS reader parses it back
- **THEN** the parsed shape matches the input

### Requirement: CI fails on contract drift

CI SHALL run the Python and TS contract tests on any change touching the bundle format, the schema, or
the fixtures, and SHALL fail if a producer no longer matches `schema.json` or a fixture no longer parses.
Format evolution SHALL be additive-only: new nullable columns are allowed; column renames or dtype changes
require a deliberate update to `schema.json` and its fixtures in the same change.

#### Scenario: A drifting producer is caught

- **WHEN** a change alters a written column's dtype without updating `schema.json`
- **THEN** the Python producer contract test fails in CI

#### Scenario: A stale fixture is caught

- **WHEN** the format changes but a committed golden fixture is not regenerated
- **THEN** a contract test fails in CI

### Requirement: Python API/CLI contract verified against in-repo source

`services/protspace-prep` SHALL depend on `protspace` as a uv workspace source (not a PyPI version
range), so the API surface it imports (`protspace.data.loaders.h5.parse_identifier`) and the CLI
subcommands it invokes (`embed`, `annotate`, `project`, `bundle`) are exercised against the in-repo
`protspace` source. A change to that surface SHALL be observable as a failing prep test in the same
change, not deferred to a downstream PyPI release.

#### Scenario: Breaking a consumed API is caught in the same change

- **WHEN** a change alters the signature or behavior of a `protspace` API or CLI subcommand that
  `protspace-prep` depends on
- **THEN** `protspace-prep`'s test suite fails in CI within that change, against in-repo source
