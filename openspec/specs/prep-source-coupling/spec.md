# prep-source-coupling Specification

## Purpose

How `apps/prep` consumes the `protspace` package: from in-repo workspace source rather than a published version range, so a change that breaks an API or CLI subcommand prep depends on fails in the same change instead of surfacing after a release.

## Requirements

### Requirement: prep consumes protspace from in-repo source

`apps/prep` SHALL depend on `protspace` as a uv workspace source rather than a published
version range, so the API surface it imports and the CLI subcommands it invokes are
exercised against the in-repo `protspace` rather than the last release. A change that
breaks a consumed API SHALL be observable as a failing prep test within that same change,
not deferred until a downstream PyPI release.

#### Scenario: Breaking a consumed API is caught in the same change

- **WHEN** a change alters the signature or behaviour of a `protspace` API or CLI
  subcommand that `apps/prep` depends on
- **THEN** the prep test suite fails in CI within that change, against in-repo source

#### Scenario: The dependency is not pinned to a release

- **WHEN** `apps/prep`'s dependency on `protspace` is resolved
- **THEN** it resolves through the uv workspace, not to a version published on PyPI
