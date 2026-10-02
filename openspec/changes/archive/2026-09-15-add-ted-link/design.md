## Context

The structure viewer header currently renders AlphaFold, UniProt, and InterPro destinations. Each destination URL is assembled in `header-links.ts`; UniProt and InterPro share `getBaseAccession()` so versioned protein IDs target the canonical accession. Issue #344 requests a TED link using `https://ted.cathdb.info/uniprot/<UniProtID>`.

## Goals / Non-Goals

**Goals:**

- Render TED beside the existing UniProt and InterPro links for every selected protein.
- Reuse the existing base-accession normalization and URL encoding contract.
- Preserve the existing safe new-tab attributes and visual treatment.
- Protect the URL builder and rendered behavior with focused tests.

**Non-Goals:**

- Redesign the structure viewer header or link styles.
- Add TED annotations, data fetching, availability checks, or navigation tracking.
- Refactor all resource links into a new abstraction.

## Decisions

### Extend the existing helper-and-template pattern

Add a pure `buildTedUrl()` helper beside the existing destination builders, then render TED as a sibling header link separated by the existing middle-dot element. This keeps normalization in one tested boundary and follows the current component structure.

Alternatives considered:

- **Inline the TED URL in the Lit template.** Smaller in line count, but it duplicates normalization/encoding behavior and makes the URL contract harder to test independently.
- **Replace all links with a resource-descriptor array.** This could reduce repeated markup, but it expands issue scope and refactors working links for no user benefit.

### Test the observable link and the URL boundary

Add a jsdom component regression that renders a versioned protein ID and asserts the whole rendered link row in order — label, href, `target`, and `rel` for UniProt, InterPro, and TED. Asserting the row rather than the TED anchor alone is what makes "beside" testable: a check scoped to TED still passes if the other two links disappear. Add focused pure-helper cases for the exact TED pattern, version stripping, and encoding. Together they prevent an unused builder from appearing to fix the issue.

## Risks / Trade-offs

- **TED may not have a page for every UniProt accession** → Match the existing UniProt/InterPro behavior: expose the deterministic destination and let the external service report availability.
- **The extra label could tighten header space** → Reuse the compact link styles and add no layout rules. `.header-links` is a non-wrapping flex row, but its parent `.header-info` wraps, so a third label pushes the whole group onto its own line rather than overflowing.

## Migration Plan

No migration is required. The change is additive and can be rolled back by reverting the helper, anchor, tests, and spec artifacts.

## Open Questions

None. The issue supplies the canonical URL format and the existing header establishes placement and interaction behavior.
