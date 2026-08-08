## Why

The protein structure viewer links selected proteins to UniProt and InterPro, but it omits TED even though TED provides a directly addressable UniProt-based protein page. Adding the missing link lets users move from a selected ProtSpace protein to its TED domain predictions without manually reconstructing the URL.

## What Changes

- Add TED as an external resource in the structure viewer header beside UniProt and InterPro.
- Build TED URLs from the normalized base UniProt accession used by the existing resource links.
- Add regression coverage for the URL contract and rendered header link.
- Update the Explore documentation and generated structure-viewer screenshot to show TED,
  including stale image-pipeline readiness checks that blocked regeneration.

## Capabilities

### New Capabilities

- `protein-resource-links`: External protein-resource links exposed by the structure viewer, including accession normalization and safe new-tab behavior.

### Modified Capabilities

None.

## Impact

- Affects the structure viewer header and its pure URL-building helpers in `packages/core`.
- Adds focused Vitest coverage in the same package.
- Updates the Explore resource-link descriptions, their shared generated screenshot, and the
  image-pipeline readiness checks.
- Adds no dependencies, API changes, data migrations, or styling changes.
