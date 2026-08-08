## Why

Protein structures currently show only AlphaFold pLDDT confidence colors, so users cannot see where TED predicts structural domain boundaries. Adding TED domain coloring makes the structure viewer useful for comparing domain organization with the embedding while preserving the existing confidence view.

## What Changes

- Fetch TED domain assignments alongside AlphaFold structure metadata without making TED availability a prerequisite for viewing a structure.
- Add a structure-viewer control that switches between the existing pLDDT confidence theme and categorical TED domain colors.
- Color every inclusive residue segment belonging to the same TED domain consistently, including discontinuous domains, and render unassigned residues neutrally.
- Keep pLDDT as the default and disable TED coloring when no valid domain assignments are available.

## Capabilities

### New Capabilities

- `structure-coloring`: Defines structure-viewer color modes, TED domain retrieval, residue mapping, and unavailable-data behavior.

### Modified Capabilities

None.

## Impact

- Affects the shared structure data service and its public `StructureData` result.
- Extends the Mol\* adapter and structure-viewer component UI.
- Adds requests to the existing AlphaFold DB TED domains endpoint; no new package dependency is required.
