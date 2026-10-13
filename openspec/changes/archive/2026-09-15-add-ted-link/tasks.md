## 1. Regression Coverage

- [x] 1.1 Add focused TED URL-builder and rendered-header regression tests.
- [x] 1.2 Run the focused tests against the current implementation and record the expected RED failure.

## 2. Minimal Implementation

- [x] 2.1 Add the TED URL builder using the existing base-accession normalization.
- [x] 2.2 Render the TED anchor beside UniProt and InterPro with matching safe new-tab behavior.
- [x] 2.3 Run the focused tests and record GREEN.

## 3. Verification

- [x] 3.1 Repeat the original browser reproduction and verify the TED label and exact href.
- [x] 3.2 Run the affected package checks and the repository-mandated `pnpm precommit` gate.
- [x] 3.3 Update the Explore descriptions and regenerate their shared structure-viewer screenshot.
- [x] 3.4 Rebind the duplicate-badge capture spec to the renamed scatter-plot internals so the
      image pipeline runs, and regenerate the GIF it produces.
- [x] 3.5 Merge `main`, resolve the docs-screenshot pipeline conflicts, and apply the
      reuse/simplification review findings.
