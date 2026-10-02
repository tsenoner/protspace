## Why

Some annotations shipped in a `.parquetbundle` are ML **predictions** (e.g. Biocentral's
`predicted_subcellular_location`, `predicted_membrane`, `predicted_transmembrane`,
`predicted_signal_peptide`), while most are experimental/curated (UniProt, InterPro, Taxonomy,
TED). The frontend currently treats them all identically, so a user cannot tell predicted data
from curated data, and there is no in-app explanation of what each annotation actually means
(those descriptions only live in the backend repo's `docs/annotations.md`). This resolves
GitHub issue #221.

## What Changes

- Introduce a single **annotation-metadata registry** in `@protspace/utils` as the canonical
  source of truth for each known annotation: `label`, `source`, `isPredicted`, `description`,
  and optional `docsUrl`. Seeded from the backend's `annotations.md`; the `predicted_` column
  prefix is the robust fallback convention for columns not in the registry.
- Add a dedicated **"Predicted" group** to the annotation dropdown, driven by the registry.
  This replaces the hardcoded source map in
  `packages/core/src/components/control-bar/annotation-categories.ts` (its grouping logic moves
  to read from the registry, keeping `groupAnnotations` callers working).
- Show a **`⚡ Predicted` badge + short note** in the legend header when the active annotation
  is predicted, signalling the values come from a model rather than curation.
- Surface per-annotation documentation via an **info-icon → popover** in the dropdown (and the
  legend header) showing the `description` plus an optional "learn more" link to `docsUrl`.
- Generate a VitePress **`docs/guide/annotations.md` reference page from the same registry**
  (build/check script) with one `#anchor` per annotation, so `docsUrl` targets exist and inline
  text cannot drift from the docs page.
- Unknown / custom columns **degrade gracefully**: prettified label, no description, treated as
  experimental (no badge, no group).

Non-goals: no backend changes (frontend-only, consuming the existing `predicted_` convention);
no renaming of data values or export columns; the registry only changes _displayed_ labels.

## Capabilities

### New Capabilities

- `annotation-metadata`: A canonical frontend registry describing each known annotation
  (label, source, predicted flag, description, docs link), the `predicted_` fallback convention,
  graceful handling of unknown columns, and the docs-page generation/consistency contract.
- `annotation-presentation`: How annotation metadata is surfaced in the UI — the "Predicted"
  dropdown group, the legend predicted badge/note, and the info-icon documentation popover.

### Modified Capabilities

<!-- No existing OpenSpec capability covers annotation grouping/legend; the only existing spec
     is prep-observability (backend). Behavior is introduced as new capabilities above. -->

## Impact

- **New:** `packages/utils/src/visualization/annotation-metadata.ts` (registry + lookup helpers),
  exported from `packages/utils/src/index.ts`.
- **Modified:** `packages/core/src/components/control-bar/annotation-categories.ts` (group from
  registry, add `Predicted` group), `annotation-select.ts` (info icon + predicted styling),
  `query-condition-row.ts` (consumes `groupAnnotations`), the legend component/renderer
  (`legend.ts` / legend renderer header) for the predicted badge + popover, plus associated
  `.styles` files.
- **Docs:** new `docs/guide/annotations.md` (generated) + VitePress sidebar entry in
  `docs/.vitepress/config.mts`; a generator/check script under the docs/scripts tooling.
- **Tests:** `annotation-select.test.ts` updates; new unit tests for the registry helpers and
  grouping; browser verification of dropdown group, legend badge, and popover.
- No API, dependency, or data-format changes.
