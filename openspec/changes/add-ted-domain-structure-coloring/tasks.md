## 1. TED Structure Data

- [x] 1.1 Add a failing StructureService regression test for valid TED domains and discontinuous segments
- [x] 1.2 Parse optional TED domains into typed StructureData without failing structure loading
- [x] 1.3 Cover unavailable and malformed TED responses
- [x] 1.4 Add a failing regression for a TED request that never settles
- [x] 1.5 Bound the optional TED request and fall back to no domains on timeout

## 2. Mol\* Color Themes

- [x] 2.1 Add failing tests for deterministic domain colors, discontinuous ranges, and neutral unassigned residues
- [x] 2.2 Register the TED color provider and expose reversible pLDDT/TED theme switching in the Mol\* adapter
- [x] 2.3 Exercise the registered provider for atomic element, bond, and coarse locations

## 3. Structure Viewer Control

- [x] 3.1 Add failing component tests for the color control's default, enabled, disabled, and switching states
- [x] 3.2 Add the accessible two-mode color control and mode-specific explanatory text
- [x] 3.3 Add failing regressions for rapid reverse selection and stale viewer completion
- [x] 3.4 Sequence theme updates and ignore requests invalidated by viewer cleanup
- [x] 3.5 Add a failing stale-load regression and remove the redundant post-load theme write

## 4. Documentation

- [x] 4.1 Document TED retrieval, coloring, availability, and the color-mode control

## 5. Verification

- [x] 5.1 Re-run focused unit tests and the original browser reproduction
- [x] 5.2 Run the repository test suite and mandated `pnpm precommit` gate
- [x] 5.3 Re-run strict OpenSpec, focused and broad tests, browser proof, and bundle contract
