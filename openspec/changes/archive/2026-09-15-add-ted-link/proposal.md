## Why

The protein structure viewer links selected proteins to UniProt and InterPro, but it omits TED even though TED provides a directly addressable UniProt-based protein page. Adding the missing link lets users move from a selected ProtSpace protein to its TED domain predictions without manually reconstructing the URL.

## What Changes

- Add TED as an external resource in the structure viewer header beside UniProt and InterPro.
- Build TED URLs from the normalized base UniProt accession used by the existing resource links.
- Add regression coverage for the URL contract and rendered header link.
- Update the Explore documentation and regenerate the structure-viewer screenshot to show TED.
- Repair the duplicate-badge capture spec, which bound to scatter-plot internals renamed on
  `main` and so could not run at all, blocking any docs-image regeneration.

## Capabilities

### New Capabilities

- `protein-resource-links`: External protein-resource links exposed by the structure viewer, including accession normalization and safe new-tab behavior.

### Modified Capabilities

None.

## Impact

- Affects the structure viewer header and its pure URL-building helpers in `packages/core`.
- Adds focused Vitest coverage in the same package.
- Updates the Explore resource-link descriptions and regenerates their shared structure-viewer
  screenshot.
- Repairs `scripts/docs-screenshots/capture-animations.spec.ts` and regenerates
  `duplicate-badges.gif` as a side effect of unblocking that pipeline.
- Adds no dependencies, API changes, data migrations, or styling changes.
