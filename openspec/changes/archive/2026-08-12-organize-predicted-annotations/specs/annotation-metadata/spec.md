## ADDED Requirements

### Requirement: Canonical annotation-metadata registry

The frontend SHALL provide a single canonical registry, in `@protspace/utils`, mapping known
annotation column names to metadata: a human-friendly `label`, a `source`
(`UniProt` | `InterPro` | `Taxonomy` | `TED` | `Biocentral` | `Other`), an `isPredicted` boolean,
a short `description`, and an optional `docsUrl`. This registry SHALL be the single source of truth
consumed by annotation grouping, the legend, and the documentation popover, replacing the hardcoded
source map currently in `annotation-categories.ts`.

#### Scenario: Known annotation resolves to its metadata

- **WHEN** code requests metadata for a known column such as `ec`
- **THEN** it receives the registry entry (label `"EC number"`, source `UniProt`,
  `isPredicted` false, a non-empty description)

#### Scenario: Registry is the only source map

- **WHEN** annotation grouping, the legend badge, and the docs popover need source / predicted /
  description information
- **THEN** they all read it from this registry and no other hardcoded annotation source list
  remains in the codebase

### Requirement: Predicted-annotation detection with prefix fallback

The system SHALL classify an annotation as predicted when its registry entry has
`isPredicted: true`, and otherwise SHALL fall back to treating any column whose name begins with
the `predicted_` prefix as predicted. All other annotations SHALL be treated as experimental.

#### Scenario: Registry-flagged prediction

- **WHEN** the active column is `predicted_membrane` (registry `isPredicted: true`)
- **THEN** it is classified as predicted

#### Scenario: Unknown predicted column via prefix fallback

- **WHEN** the column `predicted_custom_thing` is not present in the registry
- **THEN** it is classified as predicted because of the `predicted_` prefix

#### Scenario: Experimental column

- **WHEN** the column `ec` is evaluated
- **THEN** it is classified as experimental (not predicted)

### Requirement: Graceful handling of unknown columns

For any column not present in the registry, the system SHALL synthesize metadata rather than fail:
a prettified label derived from the column name, source `Other`, an empty description (so no
documentation popover is shown), and `isPredicted` determined by the `predicted_` prefix fallback.

#### Scenario: Custom column renders without metadata

- **WHEN** a user loads a bundle containing a custom column `my_score`
- **THEN** the app displays it with a readable label, places it in the `Other` group, shows no
  documentation popover, and does not mark it predicted

### Requirement: Documentation page generated from the registry

The repository SHALL include a generator that produces the VitePress annotation reference page
(`docs/guide/annotations.md`) from the registry, with a stable per-annotation anchor that each
`docsUrl` targets, plus a check mode that fails when the committed page is out of sync with the
registry. This keeps inline descriptions and the docs page from drifting.

#### Scenario: Generated page matches the registry

- **WHEN** the generator runs in check mode against an up-to-date committed `annotations.md`
- **THEN** the check passes with no diff

#### Scenario: Drift is detected

- **WHEN** the registry changes (e.g. an annotation description is edited) but the docs page is not
  regenerated
- **THEN** the check mode reports the page is stale and fails
